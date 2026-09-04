/* CAN WE EXTEND THE EXPORT BACK INTO 2025? — a cheap, read-only probe. Answers before we build.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/upgCoverageProbe.js                      # Jan → Aug 2025
 *   node src/upgCoverageProbe.js --from 2025-01 --to 2025-12
 *
 * WHY A PROBE AND NOT JUST A LONGER EXPORT RUN
 * upgMonthlyExport.js is APP-FIRST: it reads failed payments from the replica, then asks UPG what
 * happened to each reference. For Sep 2025 → Aug 2026 that works. For most of 2025 it cannot,
 * because the app side is empty: the replica's payments table starts 2025-02-14 and then has NO
 * ROWS AT ALL from March to August 2025 (archival), resuming complete in September. Pointed at
 * those months the exporter would run happily and produce empty workbooks — technically correct,
 * completely useless, and easy to mistake for "there were no failures".
 *
 * UPG is a DIFFERENT database and may well still hold those months. If it does, the data is
 * reachable — but only GATEWAY-FIRST (read UPG by date), which is a different query shape and a
 * different, thinner set of columns. This probe establishes three facts before anything is built:
 *
 *   1. how far back UPG's own data actually goes, and how much is there per month
 *   2. whether payments(created_at) is indexed — without it, a date-ranged read of a live gateway
 *      is a seq-scan and must not be attempted
 *   3. what the app replica can still contribute per month, i.e. how much of the app-side half of
 *      the workbook (payment_type, platform, mobile, journey) would be blank
 *
 * SAFETY: read-only. Existence checks (LIMIT 1) before counts, one month at a time, paused between
 * months, and every month independently fault-tolerant — a statement timeout on one month reports
 * "too slow" and moves on instead of aborting the probe. The UPG pool is max 2 connections with a
 * 15s statement timeout and application_name 'salam_console_ro', so anything this does is visible
 * in pg_stat_activity and killable by the UPG DBA at any moment.
 */
'use strict';
const db = require('./db');
const upg = require('./upgLink');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const FROM = arg('--from', '2025-01');
const TO   = arg('--to', '2025-08');
const PAUSE = Number(arg('--pause', 1200));

const pad = n => String(n).padStart(2, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const d10 = v => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : '—'));
const nextMonth = ym => { let [y, m] = ym.split('-').map(Number); if (++m > 12) { m = 1; y++; } return `${y}-${pad(m)}-01`; };
function months(from, to) {
  const out = []; let [y, m] = from.split('-').map(Number); const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++; } }
  return out;
}
const uq = (sql, p = []) => db.upg.query(sql, p).then(r => r.rows);
const sq = (sql, p = []) => db.source.query(sql, p).then(r => r.rows);

(async () => {
  if (!upg.configured()) { console.error('UPG_DATABASE_URL not set — nothing to probe.'); process.exit(2); }
  const ping = await upg.ping();
  if (!ping.ok) { console.error('UPG unreachable:', ping.error || '(no detail)'); process.exit(2); }

  /* ---- 1. indexes decide what is even askable -------------------------------------------
   * Run #1 checked three named flags, found payments(created_at) missing and stopped there. That
   * was too quick a conclusion: if invoices(created_at) is indexed we can still reach any month
   * WITHOUT asking anyone for a new index — read invoices by date (indexed), then pull their
   * charges via payments(invoice_id) (also indexed). Same two-step shape the exporter already
   * uses. So: dump every index on both tables and let the actual catalogue decide, rather than a
   * hardcoded list of three. This is a catalogue read — no table data is touched. */
  const ix = await upg.indexes();
  console.log('=== UPG indexes — every index on payments and invoices ===');
  let invCreated = false, payCreatedAny = false;
  try {
    const all = await uq(`SELECT tablename, indexname, indexdef FROM pg_indexes
                           WHERE tablename IN ('payments','invoices') ORDER BY tablename, indexname`);
    for (const r of all) {
      const cols = (r.indexdef.match(/\(([^)]+)\)/) || [])[1] || '';
      console.log(`  ${r.tablename.padEnd(9)} ${r.indexname.padEnd(42)} (${cols})`);
      if (r.tablename === 'invoices' && /^\s*created_at/.test(cols)) invCreated = true;
      if (r.tablename === 'payments' && /created_at/.test(cols)) payCreatedAny = true;
    }
    if (!all.length) console.log('  (none returned — check the role can read pg_indexes)');
  } catch (e) { console.log('  index dump failed: ' + e.message.slice(0, 90)); }

  console.log('\n  routes:');
  console.log(`   A  payments(created_at) leading    : ${ix.pay_created ? 'YES' : 'NO'}  — direct date read of charges`);
  console.log(`   B  invoices(created_at) leading    : ${invCreated ? 'YES' : 'NO'}  — date read of invoices, then charges by invoice_id`);
  console.log(`      payments(invoice_id)            : ${ix.pay_invoice ? 'YES' : 'NO'}  — the second half of route B`);
  if (payCreatedAny && !ix.pay_created)
    console.log('      note: payments has a created_at index but NOT as the leading column — no help for a date range');
  const route = ix.pay_created ? 'A' : (invCreated && ix.pay_invoice ? 'B' : null);
  console.log(`\n  → usable route: ${route || 'NONE — a new index would be needed'}`);
  if (!route)
    console.log('    Without one of these, a date-ranged read of UPG is a sequential scan of a live\n'
              + '    production gateway. Not attempted. The ask would be: an index on invoices(created_at).');

  /* ---- 2. how far back does UPG go? min/max on an indexed column is cheap ---------------- */
  console.log('\n=== UPG coverage ===');
  for (const t of ['payments', 'invoices']) {
    try {
      const r = (await uq(`SELECT min(created_at) lo, max(created_at) hi FROM ${t}`))[0];
      console.log(`  ${t.padEnd(9)} ${d10(r.lo)} → ${d10(r.hi)}`);
    } catch (e) { console.log(`  ${t.padEnd(9)} could not read (${e.message.slice(0, 80)})`); }
  }

  /* ---- 3. per-month: does anything exist, and how much? ---------------------------------- */
  console.log('\n=== per month — UPG charges vs what the app replica still has ===');
  console.log('  month     UPG rows    UPG failed   app payments   app failed   verdict');
  const list = months(FROM, TO);
  const summary = [];
  for (const ym of list) {
    const P = [`${ym}-01`, nextMonth(ym)];
    let upgAll = null, upgFail = null, note = '';

    if (route === 'A') {
      try {
        // existence first — a LIMIT 1 on an index range costs almost nothing and tells us
        // whether an exact count is worth asking for at all
        const any = await uq(`SELECT 1 FROM payments WHERE created_at >= $1 AND created_at < $2 LIMIT 1`, P);
        if (!any.length) { upgAll = 0; upgFail = 0; }
        else {
          const r = (await uq(
            `SELECT count(*)::bigint n,
                    count(*) FILTER (WHERE upper(status) NOT IN ('PAID','CAPTURED','AUTHORIZED'))::bigint f
               FROM payments WHERE created_at >= $1 AND created_at < $2`, P))[0];
          upgAll = Number(r.n); upgFail = Number(r.f);
        }
      } catch (e) {
        note = /timeout/i.test(e.message) ? 'UPG count too slow (15s cap)' : e.message.slice(0, 40);
      }
    } else if (route === 'B') {
      // count INVOICES for the month — that is the unit route B iterates, and the number that
      // sizes the job (each invoice becomes one indexed lookup into payments)
      try {
        const any = await uq(`SELECT 1 FROM invoices WHERE created_at >= $1 AND created_at < $2 LIMIT 1`, P);
        if (!any.length) upgAll = 0;
        else {
          const r = (await uq(`SELECT count(*)::bigint n FROM invoices
                                WHERE created_at >= $1 AND created_at < $2`, P))[0];
          upgAll = Number(r.n);
        }
        upgFail = null;   // not knowable without reading the charges; sized in step 4
      } catch (e) {
        note = /timeout/i.test(e.message) ? 'invoice count too slow (15s cap)' : e.message.slice(0, 40);
      }
    } else note = 'no usable index';

    let appAll = 0, appFail = 0;
    try {
      const r = (await sq(
        `SELECT count(*)::bigint n, count(*) FILTER (WHERE status IN ('fail','failed'))::bigint f
           FROM payments WHERE created_at >= $1 AND created_at < $2`, P))[0];
      appAll = Number(r.n); appFail = Number(r.f);
    } catch (e) { /* replica is safe; if this fails, report it as zero and say so below */ }

    /* Verdict, corrected from run #1. That version required a UPG count before it would call a
     * month joinable, so when the index gate blanked the counts it reported "none" for February
     * 2025 — a month the replica clearly HAS (212,575 payments / 18,017 failed) and which the
     * existing app-first exporter can read today, because that path needs only payments(invoice_id).
     * App-side data is sufficient on its own to declare a month joinable. */
    const verdict = appFail > 0 ? 'FULL JOIN — run the existing exporter now'
      : note ? note
      : upgAll === 0 ? 'UPG has nothing either'
      : appAll === 0 ? 'GATEWAY-ONLY (app side archived)'
      : '—';
    console.log(`  ${ym}  ${String(upgAll ?? '?').padStart(10)}  ${String(upgFail ?? '?').padStart(12)}`
              + `  ${String(appAll).padStart(13)}  ${String(appFail).padStart(11)}   ${verdict}`);
    summary.push({ month: ym, upg_rows: upgAll, upg_failed: upgFail, app_rows: appAll, app_failed: appFail, verdict });
    await sleep(PAUSE);
  }

  /* ---- 4. if UPG has the months, what columns would a gateway-first export actually get? -- */
  const withData = summary.find(s => s.upg_rows > 0 && s.app_failed === 0);
  if (withData && route) {
    const M = withData.month;
    console.log(`\n=== ONE DAY of ${M}, priced end to end — this is what route ${route} really costs ===`);
    try {
      const D = [`${M}-15`, `${M}-16`];
      const t0 = Date.now();
      let charges = [];
      if (route === 'B') {
        const inv = await uq(`SELECT id, reference_id, channel, description, amount, status, created_at
                                FROM invoices WHERE created_at >= $1 AND created_at < $2`, D);
        const tInv = Date.now() - t0;
        const ids = inv.map(r => r.id).filter(Boolean);
        const t1 = Date.now();
        for (let i = 0; i < ids.length; i += 300) {
          const r = await uq(
            `SELECT invoice_id, id, status, source, method, amount, transaction_id,
                    coalesce(NULLIF(trim(bank_message),''),'(blank)') bank_message, created_at
               FROM payments WHERE invoice_id = ANY($1::text[])`, [ids.slice(i, i + 300)]);
          charges = charges.concat(r);
          await sleep(200);
        }
        const tPay = Date.now() - t1;
        const failed = charges.filter(c => !['PAID', 'CAPTURED', 'AUTHORIZED'].includes(String(c.status).toUpperCase()));
        console.log(`   invoices that day : ${inv.length.toLocaleString()}   (${tInv} ms, one indexed range read)`);
        console.log(`   charges resolved  : ${charges.length.toLocaleString()}   (${Math.ceil(ids.length / 300)} chunks, ${tPay} ms incl. pauses)`);
        console.log(`   non-paid charges  : ${failed.length.toLocaleString()}`);
        console.log(`   → a 31-day month ≈ ${(Math.ceil(ids.length / 300) * 31).toLocaleString()} chunk queries, `
                  + `≈ ${Math.round(tPay * 31 / 60000)} min at this pacing`);
        console.log('\n   sample non-paid charges:');
        failed.slice(0, 5).forEach(r => console.log('    ' + JSON.stringify({
          invoice_id: r.invoice_id, status: r.status, source: r.source, method: r.method,
          amount: r.amount, bank_message: r.bank_message, txn: r.transaction_id })));
        console.log('\n   invoices sample — the ONLY journey hints available without the app row:');
        inv.slice(0, 5).forEach(r => console.log('    ' + JSON.stringify({
          id: r.id, reference_id: r.reference_id, channel: r.channel,
          description: String(r.description || '').slice(0, 70), status: r.status })));
        const chans = {};
        for (const r of inv) chans[r.channel || '—'] = (chans[r.channel || '—'] || 0) + 1;
        console.log('   channel mix that day:', JSON.stringify(chans));
      } else {
        const rows = await uq(
          `SELECT invoice_id, status, source, method, amount, transaction_id,
                  coalesce(NULLIF(trim(bank_message),''),'(blank)') bank_message, created_at
             FROM payments WHERE created_at >= $1 AND created_at < $2
              AND upper(status) NOT IN ('PAID','CAPTURED','AUTHORIZED') ORDER BY created_at LIMIT 5`, D);
        console.log(`   (${Date.now() - t0} ms) sample non-paid charges:`);
        rows.forEach(r => console.log('    ' + JSON.stringify(r)));
      }
    } catch (e) { console.log('   day sample failed: ' + e.message.slice(0, 120)); }
  }

  /* ---- 5. the answer, stated plainly ------------------------------------------------------ */
  const joinable   = summary.filter(s => s.app_failed > 0);
  const gatewayOnly = summary.filter(s => s.app_failed === 0 && s.upg_rows > 0);
  const blocked    = summary.filter(s => s.app_failed === 0 && s.upg_rows === null);
  const empty      = summary.filter(s => s.app_failed === 0 && s.upg_rows === 0);
  console.log('\n=== VERDICT ===');
  console.log(`  FULL workbook, nothing new needed : ${joinable.map(s => `${s.month} (${s.app_failed.toLocaleString()} failures)`).join(', ') || 'none'}`);
  console.log(`  gateway-only, route ${route || '-'} available   : ${gatewayOnly.map(s => s.month).join(', ') || 'none'}`);
  console.log(`  blocked — no usable index         : ${blocked.map(s => s.month).join(', ') || 'none'}`);
  console.log(`  genuinely empty in UPG too        : ${empty.map(s => s.month).join(', ') || 'none'}`);
  if (joinable.length)
    console.log(`\n  RUN THIS NOW for the full months:\n    node src/upgMonthlyExport.js --from ${joinable[0].month} --to ${joinable[joinable.length - 1].month}`);
  if (blocked.length)
    console.log('\n  For the blocked months the ask to the UPG DBA is one index:\n'
              + '    CREATE INDEX CONCURRENTLY idx_invoices_created_at ON invoices (created_at);\n'
              + '  CONCURRENTLY so it does not lock the live gateway. With it, route B opens and those\n'
              + '  months become extractable without touching payments.');
  console.log('\n  Paste this output back and the extractor will be built for exactly the months that exist.');
  process.exit(0);
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
