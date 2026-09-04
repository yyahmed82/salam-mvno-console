/* QUICK ACTIONS — probe 2: the three gaps run #1 left open.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/quickActionsProbe2.js
 *
 * WHAT RUN #1 SETTLED
 *   SIM swap  = checkout_type 3 (868 in 7d, 106 failed) · Renew = checkout_type 6 (10,777 / 423)
 *   Recharge + Pay invoice = payments, split by account membership (users/guests/neither)
 *   Register  = users (5,387 in 7d) + otps
 *
 * WHAT IT GOT WRONG OR LEFT OPEN — this file answers exactly these three:
 *
 *   1. checkout_type 1 and 4 are NOT in the console's LANE map, and type 4 has 513 checkouts with
 *      ZERO payments in 7 days. A free flow of that size is almost certainly "Activate SIM card".
 *      Guessing which is which would put a wrong label on a dashboard row, so: read the actual
 *      rows and let their own columns say what they are.
 *
 *   2. delivery_requests has no `status` column — my assumption, wrong. Track Purchase still has
 *      no confirmed source. List the real columns instead of guessing a second time.
 *
 *   3. THE 100% "NON-OK" RATES ARE PROBABLY MY BUG, NOT AN OUTAGE. Run #1 counted an error as
 *      `response_code NOT IN ('','00','200')` and got exactly 785,404 of 785,404 on
 *      check-mobile-reservation, 246,734 of 246,734 on crm/list-resources, 31,602 of 31,602 on
 *      semati/check-eligibility. A genuine 100% failure on mobile reservation would have stopped
 *      onboarding dead, and it plainly has not. So the success vocabulary differs per endpoint.
 *      Print the ACTUAL response_code distribution per path and let the data define "ok" —
 *      before anyone escalates a number that is an artefact of my own WHERE clause.
 *
 * Read-only, bounded, LIMITed.
 */
'use strict';
const db = require('./db');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const H = Number(arg('--hours', 168));
const q = (sql, p = [`${H} hours`]) => db.source.query(sql, p).then(r => r.rows).catch(e => ({ err: e.message }));
const qc = (sql, p = [`${H} hours`]) => db.console.query(sql, p).then(r => r.rows).catch(e => ({ err: e.message }));
const L = console.log;
const show = (label, rows) => {
  if (!rows) return L(`  ${label}: (none)`);
  if (rows.err) return L(`  ${label}: ERROR ${rows.err.slice(0, 100)}`);
  if (!rows.length) return L(`  ${label}: 0 rows`);
  L(`  ${label}:`);
  rows.forEach(r => L('    ' + Object.entries(r)
    .map(([k, v]) => `${k}=${v === null ? '∅' : String(v).slice(0, 60)}`).join('  ')));
};

(async () => {
  L(`Quick-actions probe 2 · window = last ${H} hours\n`);

  /* ---- 1. what ARE checkout_type 1 and 4? ------------------------------------------------- */
  L('=== 1 · checkouts — the columns that describe a checkout ===');
  show('columns', await q(
    `SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) cols
       FROM information_schema.columns WHERE table_name='checkouts'`, []));

  L('\n=== 1b · sample rows for the UNMAPPED types (1 and 4) — their own data names them ===');
  for (const t of [1, 4]) {
    show(`checkout_type=${t}`, await q(
      `SELECT id::text, checkout_type, state, created_at
         FROM checkouts WHERE checkout_type=$2 AND created_at >= now()-$1::interval
        ORDER BY created_at DESC LIMIT 4`, [`${H} hours`, t]));
  }
  L('\n=== 1c · every type with its state mix (state tells you what the flow does) ===');
  show('type x state', await q(
    `SELECT checkout_type, coalesce(state,'∅') state, count(*)::int n
       FROM checkouts WHERE created_at >= now()-$1::interval
      GROUP BY 1,2 ORDER BY 1, n DESC`));

  /* ---- 2. Track Purchase: what does delivery_requests actually look like? ------------------ */
  L('\n=== 2 · delivery_requests — real columns, then the real state field ===');
  show('columns', await q(
    `SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) cols
       FROM information_schema.columns WHERE table_name='delivery_requests'`, []));
  show('recent rows', await q(
    `SELECT * FROM delivery_requests WHERE created_at >= now()-$1::interval
      ORDER BY created_at DESC LIMIT 3`));

  /* ---- 3. the success vocabulary, per endpoint -------------------------------------------- */
  L('\n=== 3 · response_code distribution for the paths that read 100% non-OK ===');
  L('    if one code dominates a "100% failing" endpoint, THAT code is its success value');
  for (const p of ['%check-mobile-reservation%', '%crm/list-resources%', '%semati/check-eligibility%',
                   '%crm/get-resource-reserve%', '%crm/number-reserve%']) {
    show(p.replace(/%/g, ''), await qc(
      `SELECT coalesce(response_code,'∅') code,
              coalesce(NULLIF(left(response_message,42),''),'∅') msg,
              count(*)::int n
         FROM api_traffic_events
        WHERE path ILIKE $2 AND ts >= now()-$1::interval
        GROUP BY 1,2 ORDER BY n DESC LIMIT 5`, [`${H} hours`, p]));
  }

  L('\n=== WHAT THIS DECIDES ===');
  L('  §1 names the two unmapped checkout types, so Activate SIM gets a real source or none.');
  L('  §2 gives Track Purchase a state column, or proves it is a read with nothing to count.');
  L('  §3 replaces my broken ok-test with the vocabulary each endpoint actually uses. Until it');
  L('     runs, treat every "100% non-OK" figure from probe 1 as unproven.');
  process.exit(0);
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
