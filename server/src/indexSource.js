/* One-time: create created_at indexes on the source replica so metric queries
 * don't full-scan the big tables. Idempotent + best-effort (skips on no perms).
 * This is the ONLY thing that writes to the replica, and only DDL for read speed. */
const db = require('./db');

const IDX = [
  // created_at indexes — keep metric-window queries off full scans
  ['payments', 'idx_src_payments_created', '(created_at)'],
  ['payments', 'idx_src_payments_status_created', '(status, created_at)'],
  ['activation_logs', 'idx_src_actlog_created', '(created_at)'],
  ['eligibility_logs', 'idx_src_eliglog_created', '(created_at)'],
  ['nafath_logs', 'idx_src_nafath_created', '(created_at)'],
  ['onboarding_orders', 'idx_src_onb_created', '(created_at)'],
  ['change_plan_logs', 'idx_src_cpl_created', '(created_at)'],
  ['delivery_requests', 'idx_src_deliv_created', '(created_at)'],
  ['seller_deductions', 'idx_src_seller_created', '(created_at)'],
  // lookup-column indexes — make the per-transaction timeline fast (equality joins, was 20-30s full-scans)
  ['payments', 'idx_src_payments_on_id', '(payment_on_id)'],
  ['payments', 'idx_src_payments_cust_mobile', '(customer_mobile_number)'],
  ['payments', 'idx_src_payments_tgt_mobile', '(target_mobile_number)'],
  ['activation_logs', 'idx_src_actlog_order', '(onboarding_order_id)'],
  ['eligibility_logs', 'idx_src_eliglog_order', '(onboarding_order_id)'],
  ['nafath_logs', 'idx_src_nafath_nid', '(nationality_id_number)'],
  ['onboarding_orders', 'idx_src_onb_mobile', '(mobile_number)'],
  ['onboarding_orders', 'idx_src_onb_nid', '(nationality_id_number)'],
  ['change_plan_logs', 'idx_src_cpl_mobile', '(mobile_number)'],
  ['delivery_requests', 'idx_src_deliv_on_id', '(delivery_on_id)'],
  ['delivery_requests', 'idx_src_deliv_rcv_mobile', '(receiver_mobile)']
];

async function indexSource() {
  let made = 0, skipped = 0;
  for (const [tbl, name, cols] of IDX) {
    try {
      await db.source.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${tbl} ${cols}`);
      made++;
    } catch (e) {
      skipped++;
      console.log(`  index ${name} skipped: ${e.message}`);
    }
  }
  return { made, skipped };
}

module.exports = { indexSource };

if (require.main === module) {
  indexSource().then(r => { console.log(`source indexes ensured: ${r.made} ok, ${r.skipped} skipped`); return db.source.end(); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
