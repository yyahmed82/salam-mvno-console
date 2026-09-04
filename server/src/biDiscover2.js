/* BI 20-MONTH EXTRACT — STEP 1b: the three questions run #1 left open.
 *
 * WHAT RUN #1 SETTLED
 *   • the journey discriminator is payments.payment_on_type, NOT payment_type (no such column):
 *       recharge · advanced_postpaid_payment · Checkout · OnboardingOrder · bill ·
 *       postpaid_service_recharge · termination
 *   • payments is well indexed on created_at, status+created_at, payment_on_id, payment_on_type
 *   • onboarding_orders.number_order_type is NULL on ~82% of July rows — New SIM / MNP is only
 *     known for orders that got past number selection. That is a REPORTING CAVEAT, not a bug.
 *
 * WHAT RUN #1 GOT WRONG / LEFT OPEN — this script answers exactly these:
 *   1. DATE COVERAGE HAS NO YEAR. Run #1 printed "Fri Feb 14" because node-pg returns Date
 *      objects and the formatter sliced the JS toString(), not an ISO date. Until this is fixed
 *      we do not know whether the replica reaches Jan 2025 at all — the go/no-go for the request.
 *   2. NO IDENTITY COLUMN EXISTS ON payments. user_id / guest_id / customer_id are all absent;
 *      only payment_on_type matched. So "logged vs not logged" is NOT derivable from payments
 *      alone. The Rails side has three identities (anonymous_user / user / guest — see
 *      ApiController#authenticate_and_set_anonymous_user_or_user_or_guest), so the marker must
 *      live elsewhere. This looks for it instead of inventing one.
 *   3. WHAT payment_on_id POINTS AT for recharge / bill — needed to join a payment to a journey.
 *
 * Read-only. Per-month counts ride idx_src_payments_created; everything else is catalogue or a
 * single bounded month.
 *
 * Run ON 152:
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/biDiscover2.js
 */
'use strict';
const fs = require('fs');
const db = require('./db');

const q = (sql, p = []) => db.source.query(sql, p).then(r => r.rows);
const L = s => console.log(s);
const d10 = v => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const out = { generated_at: new Date().toISOString() };

(async () => {
  /* ---- 1. THE GO/NO-GO: real dates, with years ------------------------------------------ */
  L('=== DATE COVERAGE (ISO — the run #1 bug fixed) ===');
  out.coverage = {};
  for (const t of ['payments', 'onboarding_orders', 'checkouts']) {
    const r = (await q(`SELECT min(created_at) lo, max(created_at) hi, count(*)::bigint n FROM ${t}`))[0];
    out.coverage[t] = { lo: d10(r.lo), hi: d10(r.hi), rows: r.n };
    L(`  ${t.padEnd(20)} ${d10(r.lo)} → ${d10(r.hi)}   ${r.n} rows`);
  }

  /* per-month volume: proves there are no holes in the 20 months, and sizes each extract pass */
  L('\n=== payments per month (a gap here = a gap in the BI report) ===');
  out.months = await q(
    `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
            count(*)::int total,
            count(*) FILTER (WHERE status = 'success')::int success,
            count(*) FILTER (WHERE status IN ('fail','failed'))::int failed,
            count(*) FILTER (WHERE status = 'pending')::int pending
       FROM payments
      WHERE created_at >= '2024-12-01'
      GROUP BY 1 ORDER BY 1`);
  out.months.forEach(m =>
    L(`  ${m.month}  total ${String(m.total).padStart(8)}  ok ${String(m.success).padStart(8)}` +
      `  fail ${String(m.failed).padStart(7)}  pend ${String(m.pending).padStart(7)}`));

  /* ---- 2. WHERE DOES "LOGGED vs GUEST" LIVE? -------------------------------------------- */
  L('\n=== identity: which tables could carry logged / guest ===');
  out.identity_tables = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public'
        AND (table_name ~ 'guest|anonymous|session|user' )
      ORDER BY 1`);
  L('  ' + out.identity_tables.map(r => r.table_name).join(', '));

  /* if a guests table exists, what identifies a guest and can we join on mobile? */
  const hasGuests = out.identity_tables.some(r => r.table_name === 'guests');
  out.has_guests_table = hasGuests;
  if (hasGuests) {
    out.guests_columns = (await q(
      `SELECT column_name FROM information_schema.columns WHERE table_name='guests' ORDER BY ordinal_position`))
      .map(r => r.column_name);
    L('\n  guests columns: ' + out.guests_columns.join(', '));
    const g = (await q(`SELECT min(created_at) lo, max(created_at) hi, count(*)::bigint n FROM guests`))[0];
    out.guests_coverage = { lo: d10(g.lo), hi: d10(g.hi), rows: g.n };
    L(`  guests coverage: ${d10(g.lo)} → ${d10(g.hi)}  ${g.n} rows`);
  } else {
    L('  NO guests table in the replica — the logged/guest split cannot come from here.');
  }

  /* the payments.extra JSON may carry the caller identity the columns do not */
  L('\n=== payments.extra — does the JSON carry an identity hint? (one bounded month) ===');
  out.extra_keys = await q(
    `SELECT k, count(*)::int n FROM (
       SELECT jsonb_object_keys(extra::jsonb) AS k FROM payments
        WHERE created_at >= '2026-07-01' AND created_at < '2026-08-01'
          AND extra IS NOT NULL AND extra::text NOT IN ('{}','null')
        LIMIT 200000) s
      GROUP BY 1 ORDER BY n DESC LIMIT 30`);
  out.extra_keys.forEach(r => L(`  ${r.k}  ${r.n}`));

  /* ---- 3. WHAT payment_on_id POINTS AT --------------------------------------------------- */
  L('\n=== payment_on_type → is payment_on_id resolvable? (one bounded month) ===');
  out.link_shape = await q(
    `SELECT payment_on_type, count(*)::int n,
            count(*) FILTER (WHERE payment_on_id IS NOT NULL)::int with_id,
            min(payment_on_id)::text lo_id, max(payment_on_id)::text hi_id
       FROM payments
      WHERE created_at >= '2026-07-01' AND created_at < '2026-08-01'
      GROUP BY 1 ORDER BY n DESC`);
  out.link_shape.forEach(r =>
    L(`  ${String(r.payment_on_type).padEnd(28)} n=${String(r.n).padStart(7)}  with_id=${String(r.with_id).padStart(7)}  ids ${r.lo_id}…${r.hi_id}`));

  /* ---- 4. THE LOGGED / GUEST SPLIT — found in the Rails models, verified here -----------
   * app/models/guest.rb:  has_many :onboarding_orders, as: :orderable
   *                       has_many :checkouts,         as: :checkoutable
   * So identity is POLYMORPHIC: orderable_type / checkoutable_type carry 'User' or 'Guest'.
   * That is the logged / not-logged marker BI asked for — but only for the journeys that hang
   * off an order or a checkout. Confirm the actual vocabulary rather than trusting the model. */
  L('\n=== LOGGED vs GUEST — polymorphic owner types (one bounded month) ===');
  out.orderable_types = await q(
    `SELECT orderable_type, count(*)::int n FROM onboarding_orders
      WHERE created_at >= '2026-07-01' AND created_at < '2026-08-01'
      GROUP BY 1 ORDER BY n DESC LIMIT 10`);
  L('  onboarding_orders.orderable_type:');
  out.orderable_types.forEach(r => L(`    ${String(r.orderable_type).padEnd(16)} ${r.n}`));

  out.checkoutable_types = await q(
    `SELECT checkoutable_type, count(*)::int n FROM checkouts
      WHERE created_at >= '2026-07-01' AND created_at < '2026-08-01'
      GROUP BY 1 ORDER BY n DESC LIMIT 10`);
  L('  checkouts.checkoutable_type:');
  out.checkoutable_types.forEach(r => L(`    ${String(r.checkoutable_type).padEnd(16)} ${r.n}`));

  /* recharge / bill are lowercase LABELS, not model names — so payment_on_id probably does NOT
   * point at an order/checkout. Test whether it resolves to a user id instead; if neither, the
   * logged/guest split for those two journeys has to come from somewhere else and we say so. */
  L('\n=== do recharge / bill payments resolve to a user? (sampled, indexed) ===');
  out.recharge_owner = await q(
    `WITH s AS (
       SELECT payment_on_type, payment_on_id FROM payments
        WHERE created_at >= '2026-07-01' AND created_at < '2026-08-01'
          AND payment_on_type IN ('recharge','bill','advanced_postpaid_payment')
        LIMIT 20000)
     SELECT s.payment_on_type,
            count(*)::int sampled,
            count(u.id)::int matches_user_id
       FROM s LEFT JOIN users u ON u.id = s.payment_on_id
      GROUP BY 1 ORDER BY sampled DESC`);
  out.recharge_owner.forEach(r =>
    L(`  ${String(r.payment_on_type).padEnd(28)} sampled=${r.sampled}  payment_on_id matches users.id: ${r.matches_user_id}`));

  /* platform is present on payments — useful as a secondary cut for BI */
  out.platforms = await q(
    `SELECT platform, count(*)::int n FROM payments
      WHERE created_at >= '2026-07-01' AND created_at < '2026-08-01'
      GROUP BY 1 ORDER BY n DESC LIMIT 15`);
  L('\n=== platform mix (July) ===');
  out.platforms.forEach(r => L(`  ${String(r.platform).padEnd(12)} ${r.n}`));

  fs.writeFileSync('/tmp/bi-discover2.json', JSON.stringify(out, null, 2));
  L('\n✓ wrote /tmp/bi-discover2.json');
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
