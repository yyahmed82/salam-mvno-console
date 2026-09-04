/* UPG 12-MONTH PER-TRANSACTION EXPORT — the 20 Aug workbook, repeated for every month.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/upgMonthlyExport.js                          # 2025-09 → current month
 *   node src/upgMonthlyExport.js --from 2025-09 --to 2025-12
 *   node src/upgMonthlyExport.js --from 2026-03 --to 2026-03 --pii
 *
 * Writes, per month, into OUTDIR (default /tmp/upg):
 *   YYYY-MM-failures.csv   one row per FAILED app payment, final gateway outcome  (22 cols)
 *   YYYY-MM-attempts.csv   one row per gateway attempt on those references        (10 cols)
 *   YYYY-MM-voucher.json   voucher response-code breakdown, IF any is retained    (see below)
 *   YYYY-MM-meta.json      counts + timings, used by the workbook builder to self-check
 * Column sets are byte-identical to src/paymentFailureExport.js so the monthly workbooks match
 * Payment-Failures-Detail-20Aug2026.xlsx exactly.
 *
 * WHY THIS IS NOT JUST paymentFailureExport.js IN A LOOP — three things would break:
 *
 * 1. THE 60,000-REFERENCE CAP. upgLink.rowsForRefs slices its input at `max` and returns the
 *    first N. September 2025 alone has ~62,500 failures, so a whole-month call would silently
 *    DROP ~2,500 payments and still look successful. This script slices each month into day
 *    batches, so no single call approaches the cap and nothing is ever silently truncated.
 * 2. LOAD ON A LIVE GATEWAY. 12 months ≈ 553,000 references ≈ 1,850 chunked queries against
 *    production UPG. Run flat out that is a sustained hammering. Every chunk and every day is
 *    separated by a pause, and the whole job is designed to be run off-peak and resumed.
 * 3. RESUMABILITY. A 12-month run that dies in month 9 must not restart from month 1. Months
 *    whose output already exists are skipped unless --force is given.
 *
 * SAFETY CONTRACT (unchanged from the 20 Aug export)
 *   · read-only on both sides; app side is the REPLICA, never the live app DB
 *   · UPG lookups stay index-gated inside upgLink (payments(invoice_id)); if that index is
 *     missing the module refuses the lookup rather than seq-scanning the gateway
 *   · card data, tokens and secrets are never selected
 *   · PII masked by default; --pii produces an internal copy that must not leave the company
 *
 * VOUCHER TAB — READ THIS BEFORE PROMISING IT TO ANYONE
 * Voucher recharges write NO row to any database: RechargeController#voucher calls BSS directly.
 * The only record is the console's own API capture in api_traffic_events, which has SEVEN-DAY
 * retention (apiLogCollector prunes nightly) and only began collecting on 13 Aug 2026. So the
 * voucher breakdown CANNOT be reconstructed for Sep 2025 – early Aug 2026: that data was never
 * stored and what existed has since been pruned. This script emits the tab only for months where
 * rows genuinely survive, and writes an explicit "not retained" marker for the rest. It does not
 * estimate, extrapolate or carry the August figures backwards.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');
const upg = require('./upgLink');
const { classifyClass } = require('./errclass');

const arg = (f, d = null) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = f => process.argv.includes(f);

const OUTDIR     = arg('--outdir', process.env.OUTDIR || '/tmp/upg');
const PII        = has('--pii');
const FORCE      = has('--force');
const CHUNK      = Number(arg('--chunk', 300));         // refs per UPG query — upgLink default
const PAUSE_MS   = Number(arg('--pause', 300));         // between UPG chunks
const DAY_PAUSE  = Number(arg('--day-pause', 1500));    // between day slices
const SLICE_DAYS = Number(arg('--slice-days', 1));      // day batch size

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');

/* ---- the 20 Aug export's masking and CSV rules, verbatim -------------------------------- */
const mask = s => {
  const v = String(s == null ? '' : s);
  if (!v || PII) return v;
  return v.replace(/(\+?966|00966|0)?5\d{8}/g, m => m.slice(0, 4) + '****' + m.slice(-2))
          .replace(/\b[12]\d{9}\b/g, m => m.slice(0, 3) + '*****' + m.slice(-2))
          .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, e => e.split('@')[0].slice(0, 3) + '***@' + e.split('@')[1]);
};
const csv = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const iso = t => t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : '';

const H1 = ['app_payment_id', 'created_at_utc', 'reference_id', 'payment_type', 'payment_on_id',
  'vendor', 'platform', 'rail', 'method', 'amount_sar', 'app_status', 'app_fail_reason',
  'customer_mobile', 'target_mobile', 'gateway_payment_id', 'gateway_status', 'bank_message',
  'gateway_transaction_id', 'gateway_attempts', 'ever_paid_at_gateway', 'CLASS', 'sub_class'];
const H2 = ['reference_id', 'attempt_no', 'gateway_payment_id', 'attempt_time_utc', 'status',
  'source_rail', 'method', 'amount_halalas', 'bank_message', 'gateway_transaction_id'];

/* ---- month / day helpers ----------------------------------------------------------------- */
function monthList(from, to) {
  const out = []; let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++; } }
  return out;
}
function daySlices(ym, step) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= last; d += step) {
    const end = Math.min(d + step, last + 1);
    out.push([`${ym}-${pad(d)}`, end > last ? `${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01` : `${ym}-${pad(end)}`]);
  }
  return out;
}

/* ---- one day slice: failed payments from the replica, answers from UPG -------------------- */
async function slice(from, to) {
  const app = (await db.source.query(`
    SELECT id::text app_payment_id, created_at, payment_reference_id ref, payment_on_type ptype,
           payment_on_id, vendor, platform, amount, status, fail_reason,
           customer_mobile_number mobile, target_mobile_number target,
           payment_commit_response#>>'{data,source}'  AS rail,
           payment_commit_response#>>'{data,method}'  AS method,
           payment_commit_response#>>'{data,id}'      AS gw_payment_id
    FROM payments
    WHERE created_at >= $1 AND created_at < $2 AND status IN ('fail','failed')
    ORDER BY created_at`, [from, to])).rows;
  if (!app.length) return { app, byRef: new Map(), matched: 0 };

  const refs = app.map(r => r.ref).filter(Boolean);
  // cap is per CALL — a day slice is far below it, which is the entire point of slicing
  const got = await upg.rowsForRefs(refs, { chunk: CHUNK, max: refs.length + 1, pause: PAUSE_MS });
  if (got && got.error) throw new Error('UPG: ' + got.error);
  return { app, byRef: (got && got.byRef) || new Map(), matched: (got && got.byRef) ? got.byRef.size : 0 };
}

/* ---- classification — identical ladder to paymentFailureExport.js ------------------------- */
function classify(p, rows) {
  const last = rows.length ? rows[rows.length - 1] : null;
  const paid = rows.some(r => ['PAID', 'CAPTURED', 'AUTHORIZED'].includes(String(r.status)));
  const msg = last && last.bank_message ? last.bank_message : '';
  const railV = (last && last.source) || p.rail || '';
  let s;
  if (paid) s = 'later_paid';
  else if (!msg) s = (railV === 'APPLE_PAY' || railV === 'STC_PAY') ? 'wallet_rail_no_msg'
                   : (rows.length ? 'no_message_card' : 'no_gateway_record');
  else if (/abandon/i.test(msg)) s = 'abandoned';
  else s = classifyClass({ ok: false, response: msg }).cls;
  const c = s === 'technical' ? 'TECHNICAL' : (s === 'later_paid' ? 'RECONCILIATION' : 'BUSINESS');
  return { s, c, msg, railV, last, paid };
}

/* ---- voucher lane: only where the capture actually survived -------------------------------- */
async function voucher(ym) {
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`, to = `${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01`;
  try {
    const r = await db.console.query(
      `SELECT coalesce(response_code,'—') code,
              coalesce(NULLIF(trim(response_message),''),'(no message)') msg,
              count(*)::int n, round(avg(duration_ms))::int avg_ms, max(duration_ms)::int max_ms
         FROM api_traffic_events
        WHERE path ILIKE '%voucher%' AND ts >= $1 AND ts < $2
        GROUP BY 1,2 ORDER BY n DESC`, [from, to]);
    const rows = r.rows || [];
    if (!rows.length) {
      return { retained: false, rows: [],
        note: 'No voucher rows for this month. Voucher recharges write no DB row (BSS is called '
            + 'directly); the only record is the console API capture, which has 7-day retention '
            + 'and started on 13 Aug 2026. Nothing was retained for this period.' };
    }
    return { retained: true, window: [from, to], rows };
  } catch (e) {
    return { retained: false, rows: [], note: 'voucher capture unavailable: ' + e.message };
  }
}

/* ---- one month --------------------------------------------------------------------------- */
async function doMonth(ym) {
  const f1 = path.join(OUTDIR, `${ym}-failures.csv`);
  const f2 = path.join(OUTDIR, `${ym}-attempts.csv`);
  const fm = path.join(OUTDIR, `${ym}-meta.json`);
  if (!FORCE && fs.existsSync(fm)) { console.log(`  ${ym}  already done — skipping (use --force to redo)`); return; }

  const t0 = Date.now();
  const out1 = [H1.join(',')], out2 = [H2.join(',')];
  const cls = {}, sub = {};
  let nFail = 0, nAttempt = 0, nMatched = 0;
  const slices = daySlices(ym, SLICE_DAYS);

  for (const [from, to] of slices) {
    let s;
    try { s = await slice(from, to); }
    catch (e) {
      console.log(`\n  ✗ ${from} → ${to} FAILED: ${e.message}`);
      console.log(`    re-run just this month:  node src/upgMonthlyExport.js --from ${ym} --to ${ym} --force`);
      throw e;
    }
    nMatched += s.matched;
    for (const p of s.app) {
      const rows = s.byRef.get(p.ref) || [];
      const { s: sc, c, msg, railV, last, paid } = classify(p, rows);
      cls[c] = (cls[c] || 0) + 1; sub[sc] = (sub[sc] || 0) + 1;
      nFail++;
      out1.push([p.app_payment_id, iso(p.created_at), p.ref, p.ptype, p.payment_on_id, p.vendor,
        p.platform, railV, (last && last.method) || p.method || '', p.amount, p.status,
        mask(p.fail_reason), mask(p.mobile), mask(p.target),
        (last && last.id) || p.gw_payment_id || '', (last && last.status) || '', msg,
        (last && last.transaction_id) || '', rows.length, paid ? 'yes' : 'no', c, sc]
        .map(csv).join(','));
      rows.forEach((r, i) => {
        nAttempt++;
        out2.push([p.ref, i + 1, r.id, iso(r.created_at), r.status, r.source, r.method,
          r.amount, r.bank_message, r.transaction_id].map(csv).join(','));
      });
    }
    process.stdout.write(`\r  ${ym}  ${from.slice(8)}–${to.slice(8)}  failures ${nFail}  attempts ${nAttempt}   `);
    await sleep(DAY_PAUSE);
  }

  fs.writeFileSync(f1, out1.join('\n'));
  fs.writeFileSync(f2, out2.join('\n'));
  const v = await voucher(ym);
  fs.writeFileSync(path.join(OUTDIR, `${ym}-voucher.json`), JSON.stringify(v, null, 1));
  const meta = { month: ym, failures: nFail, attempts: nAttempt, refs_matched_at_gateway: nMatched,
                 by_class: cls, by_sub_class: sub, pii_masked: !PII ? true : false,
                 slices: slices.length, elapsed_ms: Date.now() - t0,
                 voucher_retained: v.retained, generated_at: new Date().toISOString() };
  fs.writeFileSync(fm, JSON.stringify(meta, null, 1));
  console.log(`\r  ${ym}  ${String(nFail).padStart(7)} failures · ${String(nAttempt).padStart(7)} attempts · `
            + `${Math.round((Date.now() - t0) / 1000)}s · ${JSON.stringify(cls)}`);
}

(async () => {
  if (!upg.configured()) {
    console.error('UPG_DATABASE_URL is not set — this export needs the gateway. Nothing was run.');
    process.exit(2);
  }
  const ping = await upg.ping();
  if (!ping.ok) { console.error('UPG not reachable:', ping.error || '(no detail)'); process.exit(2); }
  const ix = await upg.indexes();
  if (!ix.pay_invoice) {
    console.error('UPG payments(invoice_id) index is missing. Refusing to run: without it every '
                + 'lookup seq-scans the live gateway. Raise with the UPG DBA first.');
    process.exit(2);
  }

  const now = new Date();
  const FROM = arg('--from', '2025-09');
  const TO   = arg('--to', `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`);
  fs.mkdirSync(OUTDIR, { recursive: true });
  const list = monthList(FROM, TO);

  console.log(`UPG monthly export · ${list.length} months (${FROM} → ${TO})`);
  console.log(`  gateway ping ${ping.ms}ms · payments_24h ${ping.payments_24h ?? 'n/a'}`);
  console.log(`  chunk ${CHUNK} refs · pause ${PAUSE_MS}ms · day slice ${SLICE_DAYS}d · day pause ${DAY_PAUSE}ms`);
  console.log(`  PII ${PII ? 'UNMASKED — internal copy, do not send externally' : 'masked'} · out ${OUTDIR}\n`);

  for (const ym of list) await doMonth(ym);

  console.log(`\n✓ ${OUTDIR}/  — copy the whole folder to the Mac, then:`);
  console.log('   python3 tools/build-upg-monthly-xlsx.py <folder> <outdir>');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
