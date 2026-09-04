/* HYPERPAY FAILURE EXPORT — every failed customer payment since the 3 Sep 2026 16:27 KSA
 * cutover, row-level, for the URGENT mail to the HyperPay team (STC Pay 100% failure case).
 * Includes the gateway's own ids + result code/description so HyperPay can trace their side.
 * UNMASKED by business decision (same precedent as the monthly workbooks — the gateway already
 * holds this data). Also exports the '(initiated — no gateway answer)' STC rows separately? No:
 * failures only — abandonment is not the defect.
 *
 * Run on 152:  cd /apps/console/server && set -a; . ../.env; set +a
 *              node src/hyperpayFailExport.js
 * Output: /tmp/hyperpay-failures.json → scp back → tools/build-hyperpay-failures-xlsx.py */
'use strict';
const db = require('./db');

(async () => {
  const from = process.env.HYPERPAY_CUTOVER || '2026-09-03T16:27:00+03:00';
  const rows = (await db.source.query(`
    SELECT p.created_at AT TIME ZONE 'UTC' + interval '3 hours' AS at_ksa,
           p.id::text AS payment_id,
           p.payment_reference_id AS checkout_id,
           p.payment_commit_response#>>'{payload,id}'            AS gateway_txn_id,
           lower(coalesce(nullif(p.payment_commit_response#>>'{payload,paymentBrand}',''),
                          nullif(p.payment_commit_response#>>'{type}',''), p.payment_method,'?')) AS brand,
           p.payment_commit_response#>>'{payload,result,code}'         AS result_code,
           p.payment_commit_response#>>'{payload,result,description}'  AS result_description,
           p.fail_reason,
           p.amount, p.status, p.platform, p.payment_on_type,
           p.customer_mobile_number AS customer_mobile
      FROM payments p
     WHERE p.created_at >= $1::timestamptz AND p.vendor ILIKE '%hyper%'
       AND p.status IN ('fail','failed')
     ORDER BY p.created_at`, [from])).rows;
  const summary = {};
  for (const r of rows) summary[r.brand] = (summary[r.brand] || 0) + 1;
  const fs = require('fs');
  const f = '/tmp/hyperpay-failures.json';
  fs.writeFileSync(f, JSON.stringify({ cutover: from, generated_at: new Date().toISOString(),
    total: rows.length, by_brand: summary, rows }));
  fs.chmodSync(f, 0o644);
  console.log(`wrote ${f} · ${rows.length} failures · by brand:`, JSON.stringify(summary));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
