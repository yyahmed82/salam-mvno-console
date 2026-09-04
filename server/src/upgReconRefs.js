/* One-off reconciliation: classify the BI/UPG reference lists (upgReconRefs-*.json, extracted
 * from the xlsx exports) against the APP side (replica payments). Answers what the cohorts ARE:
 * app status mix, month distribution, payment types — so the UPG-side attempt coverage (3.0% /
 * 0.6% in the exports) can be interpreted correctly (old refs vs never-reached-gateway).
 *
 * Run ON 152:
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/upgReconRefs.js /apps/console/web/upgReconRefs-recharge.json
 *   node src/upgReconRefs.js /apps/console/web/upgReconRefs-status.json
 *
 * READ-ONLY on the replica; index-gated (refuses to run without payments(payment_reference_id)). */
'use strict';
const fs = require('fs');
const db = require('./db');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('usage: node src/upgReconRefs.js <refs.json>'); process.exit(1); }
  const { source, refs } = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`${source}: ${refs.length} refs`);

  const ix = await db.source.query(
    `SELECT indexdef FROM pg_indexes WHERE tablename='payments' AND indexdef ILIKE '%payment_reference_id%'`);
  if (!ix.rows.length) {
    console.error('REFUSING: payments(payment_reference_id) has no index — batch lookups would seq-scan the replica.');
    console.error('Create it first (pgAdmin, replica): CREATE INDEX CONCURRENTLY idx_payments_ref ON payments (payment_reference_id);');
    process.exit(2);
  }

  const agg = { found: 0, status: {}, month: {}, type: {}, day: {}, minAt: null, maxAt: null };
  const B = 2000;
  for (let i = 0; i < refs.length; i += B) {
    const r = await db.source.query(
      `SELECT status, payment_on_type, to_char(created_at, 'YYYY-MM') m,
              to_char(created_at, 'YYYY-MM-DD') d,
              min(created_at) mn, max(created_at) mx, count(*)::int n
       FROM payments WHERE payment_reference_id = ANY($1::text[])
       GROUP BY 1, 2, 3, 4`, [refs.slice(i, i + B)]);
    for (const row of r.rows) {
      agg.found += row.n;
      agg.status[row.status] = (agg.status[row.status] || 0) + row.n;
      agg.month[row.m] = (agg.month[row.m] || 0) + row.n;
      agg.type[row.payment_on_type] = (agg.type[row.payment_on_type] || 0) + row.n;
      // per-day (August) with per-status split — the funnel denominator for the UPG window
      if (row.m === '2026-08') {
        const dd = agg.day[row.d] = agg.day[row.d] || { total: 0 };
        dd.total += row.n; dd[row.status] = (dd[row.status] || 0) + row.n;
      }
      if (!agg.minAt || row.mn < agg.minAt) agg.minAt = row.mn;
      if (!agg.maxAt || row.mx > agg.maxAt) agg.maxAt = row.mx;
    }
    if ((i / B) % 10 === 0) process.stdout.write(`  ${i}/${refs.length}\r`);
  }
  console.log(`\nfound in app payments: ${agg.found} / ${refs.length} (${(100 * agg.found / refs.length).toFixed(1)}%)`);
  console.log('app status:', JSON.stringify(agg.status));
  console.log('payment_on_type:', JSON.stringify(agg.type));
  console.log('by month:', JSON.stringify(Object.fromEntries(Object.entries(agg.month).sort())));
  console.log('August by day (total/success/pending/fail):');
  for (const [d, v] of Object.entries(agg.day).sort())
    console.log(`  ${d}  ${String(v.total).padStart(6)}  s:${v.success || 0}  p:${v.pending || 0}  f:${v.fail || 0}`);
  console.log('date range:', agg.minAt, '→', agg.maxAt);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
