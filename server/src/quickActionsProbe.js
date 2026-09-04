/* THE SEVEN QUICK ACTIONS — what can actually be measured, and from where.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/quickActionsProbe.js                       # last 7 days
 *   node src/quickActionsProbe.js --hours 720           # last 30 days
 *
 * WHY A PROBE FIRST
 * The dashboard's App-screens-flow section must never show a journey whose numbers are a guess.
 * Two of the seven already have a VERIFIED mapping in api.js (the LANE / FLOW_SQL CASE):
 *     Request a SIM Swap  → Checkout, checkouts.checkout_type = 3   (sim_replacement)
 *     Renew Your Plan     → Checkout, checkouts.checkout_type = 6   (renewal)
 * The other five do not, and each could plausibly live in three different tables. This probe
 * answers, per journey: does a row exist, how many, in which table, and is there a failure signal
 * to build an error step from. Everything it prints is measured; nothing is inferred.
 *
 * THE ANSWER MAY BE "NOT MEASURABLE" AND THAT IS A RESULT
 * The voucher lane already taught us this: some app screens call BSS directly and write nothing,
 * so their only trace is the console's own 7-day API capture. Track Purchase in particular may be
 * a pure read — a lookup that changes no state and therefore leaves no row. A journey we cannot
 * count must be shown as "not instrumented", never as a zero, or the dashboard will report a
 * healthy 0% failure rate for something nobody is watching.
 *
 * Read-only. Bounded windows, indexed columns, LIMITed samples.
 */
'use strict';
const db = require('./db');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const H = Number(arg('--hours', 168));
const P = [`${H} hours`];
const q = (sql, p = P) => db.source.query(sql, p).then(r => r.rows).catch(e => ({ err: e.message }));
const qc = (sql, p = P) => db.console.query(sql, p).then(r => r.rows).catch(e => ({ err: e.message }));
const W = `created_at >= now() - $1::interval`;
const L = s => console.log(s);
const show = (label, rows) => {
  if (!rows) return L(`  ${label}: (no result)`);
  if (rows.err) return L(`  ${label}: ERROR ${rows.err.slice(0, 90)}`);
  if (!rows.length) return L(`  ${label}: 0 rows in the window`);
  rows.forEach(r => L('    ' + Object.entries(r).map(([k, v]) => `${k}=${v}`).join('  ')));
};

(async () => {
  L(`Quick-actions probe · window = last ${H} hours\n`);

  /* ---- 1. checkout_type: confirm 3 and 6, and reveal anything undocumented ---------------- */
  L('=== 1 · checkouts.checkout_type in the window (the two KNOWN journeys live here) ===');
  show('checkout_type', await q(
    `SELECT c.checkout_type,
            count(*)::int checkouts,
            count(*) FILTER (WHERE p.id IS NOT NULL)::int with_payment,
            count(*) FILTER (WHERE p.status = 'success')::int paid,
            count(*) FILTER (WHERE p.status IN ('fail','failed'))::int failed
       FROM checkouts c
       LEFT JOIN payments p ON p.payment_on_type = 'Checkout' AND p.payment_on_id = c.id::text
      WHERE c.${W} GROUP BY 1 ORDER BY 1`));
  L('  → 3 = SIM swap · 6 = renew plan · 2 change_plan · 5 ownership · 7 advanced postpaid');

  /* ---- 2. Activate SIM card ---------------------------------------------------------------- */
  L('\n=== 2 · Activate SIM card — which table, and is there a failure signal? ===');
  show('activation_logs by api', await q(
    `SELECT api, count(*)::int n, count(*) FILTER (WHERE state = false)::int failed
       FROM activation_logs WHERE ${W} GROUP BY 1 ORDER BY n DESC LIMIT 10`));
  show('activation_logs status_code (failures only)', await q(
    `SELECT coalesce(NULLIF(status_code,''),'(null)') code, count(*)::int n
       FROM activation_logs WHERE ${W} AND state = false GROUP BY 1 ORDER BY n DESC LIMIT 10`));

  /* ---- 3. Register to App ------------------------------------------------------------------ */
  L('\n=== 3 · Register to App — new users, and the OTP that gates them ===');
  show('users created', await q(`SELECT count(*)::int new_users FROM users WHERE ${W}`));
  show('otps.otp_for', await q(
    `SELECT coalesce(otp_for,'(null)') otp_for, count(*)::int n
       FROM otps WHERE ${W} GROUP BY 1 ORDER BY n DESC LIMIT 10`));
  L('  → registration OTP IS written to otps (login OTP is TOTP and never is — see loginTrace.js)');

  /* ---- 4. Recharge / 5. Pay invoice, for a NOT-LOGGED payer -------------------------------- */
  L('\n=== 4+5 · Recharge & Pay invoice — split by whether the paying mobile has an account ===');
  L('  (the same membership test as the BI identity pass: users → guests → neither)');
  show('by journey x account', await q(
    `SELECT CASE WHEN p.payment_on_type IN ('recharge','postpaid_service_recharge') THEN 'recharge'
                 ELSE 'invoice' END AS journey,
            CASE WHEN p.customer_mobile_number IS NULL OR p.customer_mobile_number = '' THEN 'no_mobile'
                 WHEN EXISTS (SELECT 1 FROM users u  WHERE u.mobile_number  = p.customer_mobile_number) THEN 'has_account'
                 WHEN EXISTS (SELECT 1 FROM guests g WHERE g.mobile_number = p.customer_mobile_number) THEN 'guest_only'
                 ELSE 'no_record' END AS who,
            count(*)::int n,
            count(*) FILTER (WHERE p.status = 'success')::int ok,
            count(*) FILTER (WHERE p.status IN ('fail','failed'))::int failed
       FROM payments p
      WHERE p.${W}
        AND p.payment_on_type IN ('recharge','postpaid_service_recharge','bill','advanced_postpaid_payment')
      GROUP BY 1,2 ORDER BY 1,3 DESC`));
  L('  → NOTE: this is ACCOUNT MEMBERSHIP, not session state. The app does not record whether the');
  L('    payer was signed in. Labelling these lanes "not logged in" would be inventing a fact.');

  /* ---- 6. Track Purchase -------------------------------------------------------------------- */
  L('\n=== 6 · Track Purchase — is it a read-only lookup with no row of its own? ===');
  show('delivery_requests', await q(
    `SELECT coalesce(status,'(null)') status, count(*)::int n FROM delivery_requests
      WHERE ${W} GROUP BY 1 ORDER BY n DESC LIMIT 10`));
  show('console API capture (7-day) for tracking paths', await qc(
    `SELECT path, count(*)::int n, count(*) FILTER (WHERE coalesce(response_code,'') NOT IN ('','00','200'))::int non_ok
       FROM api_traffic_events
      WHERE ts >= now() - $1::interval AND (path ILIKE '%track%' OR path ILIKE '%deliver%' OR path ILIKE '%order-status%')
      GROUP BY 1 ORDER BY n DESC LIMIT 10`));

  /* ---- 7. what the app actually calls, so nothing is missed -------------------------------- */
  L('\n=== 7 · the console API capture, busiest paths (7-day retention) ===');
  L('  use this to spot a quick action that writes NO db row but does call an API');
  show('paths', await qc(
    `SELECT path, count(*)::int n,
            count(*) FILTER (WHERE coalesce(response_code,'') NOT IN ('','00','200'))::int non_ok
       FROM api_traffic_events WHERE ts >= now() - $1::interval
      GROUP BY 1 ORDER BY n DESC LIMIT 25`));

  L('\n=== WHAT THIS DECIDES ===');
  L('  For each of the seven: a journey is BUILDABLE when it has a table, a row count in the');
  L('  window, and a failure signal. Anything without all three gets a "not instrumented" card');
  L('  in the flow — the same treatment the voucher lane already has — rather than a false zero.');
  process.exit(0);
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
