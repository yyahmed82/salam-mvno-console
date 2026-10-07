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
  ['delivery_requests', 'idx_src_deliv_rcv_mobile', '(receiver_mobile)'],
  ['checkouts', 'idx_src_checkouts_created', '(created_at DESC)'],
  /* refund exposure (26 Sep 2026): the detectors join orders to checkouts by the checkout CODE and pair port-in orders by
   * the ported number every 15 min over 30 days — neither column is indexed in the app (it never looks them up). */
  ['checkouts', 'idx_src_checkouts_code', '(checkout_id)'],
  ['onboarding_orders', 'idx_src_onb_mnp', '(mnp_number)'],
  /* users — added when `users` joined the sync (21 Aug 2026). The login funnel counts accepted
   * passwords with `WHERE current_sign_in_at >= $1` and freshness() takes `max(current_sign_in_at)`;
   * with no index both are sequential scans over ~505k rows. Two of them per page load was enough
   * to occupy the 4-connection source pool and make the health strip's own `SELECT 1` miss its
   * 4-second budget — the replica then reported DOWN while it was in fact merely busy. */
  ['users', 'idx_src_users_current_sign_in', '(current_sign_in_at DESC NULLS LAST)'],
  ['users', 'idx_src_users_mobile', '(mobile_number)'],
  ['users', 'idx_src_users_nid', '(nationality_id_number)'],
  /* 7 Oct 2026 — the console-slowness review (pg_stat_user_tables on 121): otps had 358k sequential scans (11.8 M rows,
   * 2.7 GB — the OTP funnel windows on created_at and the timeline lookups on otp_for had no index at all) and checkouts
   * 570k (the recharge / refund / errors joins are `c.id::text = p.payment_on_id`, which the uuid PK index cannot serve —
   * an index on the same expression can). Each of those scans read gigabytes on a server shared with production. */
  ['otps', 'idx_src_otps_created', '(created_at)'],
  ['otps', 'idx_src_otps_for', '(otp_for)'],
  ['checkouts', 'idx_src_checkouts_id_text', '((id::text))'],
  /* 7 Oct 2026, second pass (D4 scan deltas after alpha.140): onboarding_orders was still read whole 26 times in 18 min
   * and users 28 times. The feed row → timeline lookups are `WHERE id::text = $1` on payments and onboarding_orders
   * (the same uuid-cast shape as checkouts — served by an expression index), the visitor resolver asks
   * `upper(nationality_id_number) = $1`, the register funnel counts users by created_at, and the Customer 360 VAS tab
   * reads service_logs by the mobile column (the one unindexed lookup in that page, flagged by vasMeta since 4 Sep). */
  ['payments', 'idx_src_payments_id_text', '((id::text))'],
  ['onboarding_orders', 'idx_src_onb_id_text', '((id::text))'],
  ['onboarding_orders', 'idx_src_onb_nid_upper', '((upper(nationality_id_number)))'],
  ['users', 'idx_src_users_created', '(created_at)'],
  ['service_logs', 'idx_src_svclog_mobile', '(mobile_number)'],
  ['service_logs', 'idx_src_svclog_msisdn', '(msisdn)'],
  /* 7 Oct 2026 (alpha.147): numbers by ORDER (numbers.onboarding_order_id = the backend's `order.number`) — prodSync only
   * indexes numbers.identifier, while the flow guard, live BSS, refund radar and visitor lookups ask by order. */
  ['numbers', 'idx_src_numbers_order', '(onboarding_order_id)'],
  /* …and the selfcare seller (indirect-sale) orders by time — a few a day; serves the legacy dealer block of /api/dms/home
   * (`seller_id IS NOT NULL AND created_at >= …`) without walking the day's funnel. */
  ['onboarding_orders', 'idx_src_onb_seller_created', '(created_at) WHERE seller_id IS NOT NULL']
];

/* a plain single-column index is only attempted when that column exists on this replica (service_logs' mobile
 * column is discovered at runtime — subscriber.js — so both spellings are listed and the absent one is skipped) */
async function columnExists(tbl, cols) {
  const m = /^\((\w+)/.exec(cols); if (!m) return true;                 // expression index — let Postgres judge
  const r = await db.source.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, [tbl, m[1]]);
  return r.rowCount > 0;
}

async function indexSource() {
  let made = 0, skipped = 0, already = 0;
  for (const [tbl, name, cols] of IDX) {
    try {
      // already there? (cheap check — avoids re-running the build every boot)
      const ex = await db.source.query(`SELECT 1 FROM pg_class WHERE relkind='i' AND relname=$1`, [name]);
      if (ex.rowCount) { already++; continue; }
      if (!(await columnExists(tbl, cols))) { skipped++; console.log(`  index ${name} skipped: ${tbl}.${cols} is not on this replica`); continue; }
      // CONCURRENTLY: no table lock, so a busy/loading table doesn't block us (and vice versa).
      // Needs its own statement_timeout=0 — a big index build legitimately exceeds the default.
      const c = await db.source.connect();
      try {
        await c.query('SET statement_timeout = 0');
        await c.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON ${tbl} ${cols}`);
        made++;
      } finally { c.release(); }
    } catch (e) {
      skipped++;
      console.log(`  index ${name} skipped: ${e.message}`);
      // a failed CONCURRENTLY build leaves an INVALID index behind — drop it so the next boot retries
      try { await db.source.query(`DROP INDEX IF EXISTS ${name}`); } catch (_) {}
    }
  }
  return { made, skipped, already };
}

module.exports = { indexSource };

if (require.main === module) {
  indexSource().then(r => { console.log(`source indexes ensured: ${r.made} ok, ${r.skipped} skipped`); return db.source.end(); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
