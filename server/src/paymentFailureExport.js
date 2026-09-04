/* PER-TRANSACTION EXPORT — every failed payment, our request side + the gateway's answer.
 *
 *   node src/paymentFailureExport.js 2026-08-01 2026-08-19 [--pii]
 *
 * Writes TWO CSVs to /tmp (152 has no xlsx lib; convert to Excel on the Mac):
 *   /tmp/payment-failures.csv          one row per FAILED app payment (the 20,536)
 *   /tmp/payment-failure-attempts.csv  one row per GATEWAY attempt on those references
 *                                      (customers retry: ~24k rows for ~20.5k payments)
 *
 * Columns are "what we sent" (amount, type, rail, platform, reference) and "what came back"
 * (gateway status, bank message, charge/transaction id, method, timestamps), plus the agreed
 * CLASS / sub-class. PII is MASKED by default — pass --pii for an internal copy (audited by
 * whoever runs it; never attach the --pii file to vendor/BI mail).
 * SECURITY: card data, secrets and access tokens are never selected. Read-only everywhere. */
'use strict';
const fs = require('fs');
const db = require('./db');
const upg = require('./upgLink');
const { classifyClass } = require('./errclass');

const PII = process.argv.includes('--pii');
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

(async () => {
  const from = process.argv[2], to = process.argv[3];
  if (!from || !to) { console.error('usage: node src/paymentFailureExport.js YYYY-MM-DD YYYY-MM-DD [--pii]'); process.exit(1); }

  console.log(`reading failed payments ${from} → ${to}${PII ? ' (PII UNMASKED — internal copy)' : ' (PII masked)'}…`);
  const app = (await db.source.query(`
    SELECT id::text app_payment_id, created_at, payment_reference_id ref, payment_on_type ptype,
           payment_on_id, vendor, platform, amount, status, fail_reason,
           customer_mobile_number mobile, target_mobile_number target,
           payment_commit_response#>>'{data,source}'  AS rail,
           payment_commit_response#>>'{data,method}'  AS method,
           payment_commit_response#>>'{data,id}'      AS gw_payment_id,
           payment_commit_response#>>'{data,status}'  AS gw_snapshot_status,
           payment_initialization_response#>>'{url}'  AS pay_page_url
    FROM payments
    WHERE created_at >= $1 AND created_at < $2 AND status IN ('fail','failed')
    ORDER BY created_at`, [from, to])).rows;
  console.log(`  ${app.length} failed payments`);

  const got = upg.configured() ? await upg.rowsForRefs(app.map(r => r.ref).filter(Boolean)) : null;
  if (got && got.error) console.log('  UPG: ' + got.error);
  const byRef = (got && got.byRef) || new Map();
  console.log(`  gateway records for ${byRef.size} references`);

  // ---- file 1: one row per failed app payment (final gateway outcome) ----
  const H1 = ['app_payment_id', 'created_at_utc', 'reference_id', 'payment_type', 'payment_on_id',
    'vendor', 'platform', 'rail', 'method', 'amount_sar', 'app_status', 'app_fail_reason',
    'customer_mobile', 'target_mobile', 'gateway_payment_id', 'gateway_status', 'bank_message',
    'gateway_transaction_id', 'gateway_attempts', 'ever_paid_at_gateway', 'CLASS', 'sub_class'];
  const out1 = [H1.join(',')];
  let cls = {}, sub = {};
  for (const p of app) {
    const rows = byRef.get(p.ref) || [];
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
    cls[c] = (cls[c] || 0) + 1; sub[s] = (sub[s] || 0) + 1;
    out1.push([p.app_payment_id, iso(p.created_at), p.ref, p.ptype, p.payment_on_id, p.vendor,
      p.platform, railV, (last && last.method) || p.method || '', p.amount, p.status,
      mask(p.fail_reason), mask(p.mobile), mask(p.target),
      (last && last.id) || p.gw_payment_id || '', (last && last.status) || '', msg,
      (last && last.transaction_id) || '', rows.length, paid ? 'yes' : 'no', c, s]
      .map(csv).join(','));
  }
  fs.writeFileSync('/tmp/payment-failures.csv', out1.join('\n'));

  // ---- file 2: every gateway attempt on those references ----
  const H2 = ['reference_id', 'attempt_no', 'gateway_payment_id', 'attempt_time_utc', 'status',
    'source_rail', 'method', 'amount_halalas', 'bank_message', 'gateway_transaction_id'];
  const out2 = [H2.join(',')];
  let attempts = 0;
  for (const p of app) {
    const rows = byRef.get(p.ref) || [];
    rows.forEach((r, i) => {
      attempts++;
      out2.push([p.ref, i + 1, r.id, iso(r.created_at), r.status, r.source, r.method,
        r.amount, r.bank_message, r.transaction_id].map(csv).join(','));
    });
  }
  fs.writeFileSync('/tmp/payment-failure-attempts.csv', out2.join('\n'));

  console.log(`\n/tmp/payment-failures.csv           ${app.length} rows`);
  console.log(`/tmp/payment-failure-attempts.csv   ${attempts} rows`);
  console.log('CLASS:', JSON.stringify(cls), '\nsub:', JSON.stringify(sub));
  console.log(PII ? '\n*** contains real MSISDNs — internal use only ***' : '\nPII masked (use --pii for an internal copy).');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
