/* PAYMENT ERROR CATALOG (final) — the authoritative business/technical segregation for the
 * "Drop in Renewal Revenue" thread, built from BOTH sides:
 *
 *   APP  (replica): funnel + rail from payment_commit_response.data->>'source' (the app stores
 *         the UPG payment snapshot — real rail lives there; card_type col is hardcoded "1").
 *         The app stores NO bank_message anywhere (probe 20 Aug: 20,525/20,525 empty) —
 *   UPG  (gateway, read-only, index-backed): the ONLY source of decline reasons. One aggregated
 *         range query over payments(created_at) — bank_message × source × status.
 *
 * Run ON 152:
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/paymentErrorCatalog.js 2026-08-01 2026-08-19
 * Output: console summary + /tmp/paymentErrorCatalog.json (scp back for the PDF/xlsx build). */
'use strict';
const db = require('./db');
const upg = require('./upgLink');
const { classifyClass } = require('./errclass');

const ANS = `(payment_commit_response IS NOT NULL AND payment_commit_response::text NOT IN ('{}','null'))`;

(async () => {
  const from = process.argv[2], to = process.argv[3];
  if (!from || !to) { console.error('usage: node src/paymentErrorCatalog.js YYYY-MM-DD YYYY-MM-DD'); process.exit(1); }
  const P = [from, to];
  const out = { from, to };

  // ---- APP SIDE ----------------------------------------------------------------------------
  out.funnel = (await db.source.query(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE status='success')::int success,
            count(*) FILTER (WHERE status IN ('fail','failed'))::int failed,
            count(*) FILTER (WHERE status='pending' AND NOT ${ANS})::int never_attempted,
            count(*) FILTER (WHERE status='pending' AND ${ANS})::int stuck_callback,
            coalesce(sum(amount) FILTER (WHERE status='pending' AND NOT ${ANS}),0)::numeric pending_sar,
            coalesce(sum(amount) FILTER (WHERE status IN ('fail','failed')),0)::numeric failed_sar
     FROM payments WHERE created_at >= $1 AND created_at < $2`, P)).rows[0];

  // real rail (from the stored UPG snapshot) for failed + per payment type
  out.failedByRail = (await db.source.query(
    `SELECT coalesce(payment_commit_response#>>'{data,source}','(none)') rail,
            coalesce(payment_on_type,'?') ptype, count(*)::int n
     FROM payments WHERE created_at >= $1 AND created_at < $2 AND status IN ('fail','failed')
     GROUP BY 1, 2 ORDER BY n DESC LIMIT 40`, P)).rows;
  out.dailyFunnel = (await db.source.query(
    `SELECT to_char(created_at,'YYYY-MM-DD') d,
            count(*)::int total,
            count(*) FILTER (WHERE status='success')::int success,
            count(*) FILTER (WHERE status='pending' AND NOT ${ANS})::int never_attempted,
            count(*) FILTER (WHERE status IN ('fail','failed'))::int failed
     FROM payments WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY 1`, P)).rows;

  // ---- UPG SIDE (reasons) --------------------------------------------------------------------
  // UPG has NO created_at-usable index for a period aggregate (verified 20 Aug) — so enrich
  // exactly OUR failed cohort by reference id instead (invoice_id IS indexed; proven in probe E).
  // This is better anyway: the reasons are for precisely the app's failed payments.
  out.upg = { configured: upg.configured() };
  if (upg.configured()) {
    const refs = (await db.source.query(
      `SELECT payment_reference_id r FROM payments
       WHERE created_at >= $1 AND created_at < $2 AND status IN ('fail','failed')
         AND payment_reference_id IS NOT NULL`, P)).rows.map(x => x.r);
    console.log(`enriching ${refs.length} failed refs at UPG (chunked, invoice_id-indexed)…`);
    const got = await upg.reasonsForRefs(refs);
    if (!got || got.error) out.upg.error = (got && got.error) || 'not configured';
    else {
      out.upg.requested = got.requested; out.upg.matched = got.matched;
      // aggregate + classify: wallet-NULL = rail semantics; Abandoned = never engaged;
      // otherwise errclass rules (declines = business; timeouts/unspecified = technical)
      // CLASSIFICATION (agreed with business 20 Aug): only platform faults count as TECHNICAL.
      // Abandonment (customer never engaged) and wallet-rail "no message" (Apple Pay / STC Pay
      // return no acquirer text by design — their PAID rows are blank too) are BUSINESS outcomes.
      // sub_class keeps the detail so the split stays auditable.
      const cls = {}, sub = {}, rows = {};
      for (const [ref, v] of Object.entries(got.byRef)) {
        if (v.status === 'PAID' || v.status === 'CAPTURED' || v.status === 'AUTHORIZED') {
          cls.later_paid = (cls.later_paid || 0) + 1; sub.later_paid = (sub.later_paid || 0) + 1; continue;
        }
        let s;
        if (v.msg === '(no message)') s = (v.source === 'APPLE_PAY' || v.source === 'STC_PAY') ? 'wallet_rail_no_msg' : 'no_message_card';
        else if (/abandon/i.test(v.msg)) s = 'abandoned';
        else s = classifyClass({ ok: false, response: v.msg }).cls;      // business | technical
        const c = s === 'technical' ? 'technical' : 'business';           // ← merge
        cls[c] = (cls[c] || 0) + 1; sub[s] = (sub[s] || 0) + 1;
        rows[`${v.msg}||${v.source || '?'}||${c}||${s}`] = (rows[`${v.msg}||${v.source || '?'}||${c}||${s}`] || 0) + 1;
      }
      out.upg.cls = cls; out.upg.subCls = sub;
      out.upg.reasonsCls = Object.entries(rows).map(([k, n]) => {
        const [msg, src, c, s] = k.split('||'); return { msg, src, cls: c, sub_class: s, n };
      }).sort((a, b) => b.n - a.n);
      out.upg.unmatched = refs.length - got.matched;
    }
  }

  // ---- console summary -----------------------------------------------------------------------
  const F = out.funnel;
  console.log(`\nAPP FUNNEL ${from} → ${to}: total ${F.total} · success ${F.success} · failed ${F.failed} (${Math.round(F.failed_sar).toLocaleString()} SAR) · never_attempted ${F.never_attempted} (${Math.round(F.pending_sar).toLocaleString()} SAR) · stuck_callback ${F.stuck_callback}`);
  console.log('\nFAILED BY REAL RAIL (from stored UPG snapshot):');
  const railAgg = {};
  out.failedByRail.forEach(r => railAgg[r.rail] = (railAgg[r.rail] || 0) + r.n);
  Object.entries(railAgg).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(7)}  ${k}`));
  if (out.upg.cls) {
    console.log(`\nUPG ENRICHMENT: matched ${out.upg.matched} rows for ${out.upg.requested} failed refs · ${out.upg.unmatched} refs with no UPG record`);
    const tot = Object.values(out.upg.cls).reduce((a, b) => a + b, 0) || 1;
    console.log('FAILED REFS BY CLASS (UPG truth · business = customer/bank outcome, technical = platform fault):');
    Object.entries(out.upg.cls).sort((a, b) => b[1] - a[1])
      .forEach(([k, n]) => console.log(`  ${String(n).padStart(7)}  ${k.padEnd(12)} ${(100 * n / tot).toFixed(1)}%`));
    console.log('  sub-classes:', JSON.stringify(out.upg.subCls));
    console.log('\nTOP REASONS (msg · source · class/sub):');
    out.upg.reasonsCls.slice(0, 25)
      .forEach(x => console.log(`  ${String(x.n).padStart(7)}  ${(x.cls + '/' + x.sub_class).padEnd(28)} ${x.msg.slice(0, 44)} · ${x.src}`));
  } else console.log('\nUPG: ' + (out.upg.error || 'not configured — reasons unavailable'));

  require('fs').writeFileSync('/tmp/paymentErrorCatalog.json', JSON.stringify(out));
  console.log('\nJSON → /tmp/paymentErrorCatalog.json');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
