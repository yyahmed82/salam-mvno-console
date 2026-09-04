/* BI PAYMENT REPORT — STEP 2b: the identity addendum for journeys ③ Recharge and ④ Invoice.
 *
 * WHY A SECOND PASS
 * biExtract.js reports identity three different ways because the data supports three different
 * things (see its header). For recharge and invoice it emitted a proxy comparing
 * customer_mobile_number to target_mobile_number. THAT PROXY IS DEAD: measured over 12 months it
 * came back 3,509,083 self vs 24 other — 100.0% one bucket. The app writes both columns with the
 * same value, so the comparison is a constant, not a signal. Shipping it would have been worse
 * than shipping nothing.
 *
 * WHAT THIS MEASURES INSTEAD
 * Whether the paying mobile HAS AN ACCOUNT, by membership of users / guests:
 *     has_user_account   — the mobile exists in users
 *     guest_record_only  — not in users, but exists in guests
 *     no_record          — in neither (POSA, dealer-assisted, or a number never registered)
 *
 * THIS IS NOT SESSION STATE, and the README sheet must say so in these words: the app does not
 * record whether the payer was authenticated at the moment of a recharge or bill payment. It says
 * whether that mobile is a registered customer. It is a real, varying, defensible cut — but it is
 * NOT "logged in vs not logged in", and must never be labelled as such.
 *
 * COST / SAFETY — same discipline as biExtract.js
 *   · replica only, one month per pass, throttled, aggregates only
 *   · EXISTS, never LEFT JOIN: duplicate users for one mobile would otherwise fan out the counts
 *     and silently inflate every number in the sheet
 *   · both sides indexed: index_users_on_mobile_number, idx_pay_cust_mobile
 *
 * Run ON 152 (off-peak):
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/biIdentity.js                       # → /tmp/bi/identity-YYYY-MM.json
 *   node src/biIdentity.js --from 2026-07 --to 2026-08
 */
'use strict';
const fs = require('fs');
const db = require('./db');

const OUTDIR = process.env.OUTDIR || '/tmp/bi';
const PAUSE_MS = Number(process.env.PAUSE_MS) || 4000;
const arg = f => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const FROM = arg('--from') || '2025-09';
const TO   = arg('--to')   || '2026-08';

const q = (sql, p = []) => db.source.query(sql, p).then(r => r.rows);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* journeys ③ and ④ only — the ones biExtract could not segment */
const SCOPE = `p.payment_on_type IN ('recharge','postpaid_service_recharge','bill','advanced_postpaid_payment')`;

const JOURNEY = `CASE WHEN p.payment_on_type IN ('recharge','postpaid_service_recharge')
                      THEN '3_recharge' ELSE '4_invoice' END`;

const ANS = `(p.payment_commit_response IS NOT NULL AND p.payment_commit_response::text NOT IN ('{}','null'))`;
const OUTCOME = `CASE
  WHEN p.status = 'success'            THEN 'success'
  WHEN p.status IN ('fail','failed')   THEN 'failed'
  WHEN p.status = 'pending' AND ${ANS} THEN 'stuck_callback'
  WHEN p.status = 'pending'            THEN 'never_attempted'
  ELSE coalesce(p.status,'—') END`;

/* EXISTS, not JOIN — see header. */
const ACCOUNT = `CASE
  WHEN p.customer_mobile_number IS NULL OR p.customer_mobile_number = '' THEN 'no_mobile_recorded'
  WHEN EXISTS (SELECT 1 FROM users  u WHERE u.mobile_number = p.customer_mobile_number) THEN 'has_user_account'
  WHEN EXISTS (SELECT 1 FROM guests g WHERE g.mobile_number = p.customer_mobile_number) THEN 'guest_record_only'
  ELSE 'no_record' END`;

const nextMonth = ym => { let [y, m] = ym.split('-').map(Number); if (++m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2,'0')}-01`; };
function months(from, to) {
  const out = []; let [y, m] = from.split('-').map(Number); const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2,'0')}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

/* PREFLIGHT — the failure mode that would silently ruin this sheet is a FORMAT MISMATCH: if
 * payments stores 9665xxxxxxx and users stores 05xxxxxxxx, every row returns 'no_record' and the
 * output looks like a finding ("nobody has an account!") instead of a bug. So compare the shapes,
 * then measure real overlap on one month, and refuse to run 12 passes if the match rate is zero. */
async function preflight() {
  console.log('preflight — mobile number shapes (prefix · length · rows):');
  for (const [label, sql] of [
    ['payments', `SELECT left(customer_mobile_number,3) pfx, length(customer_mobile_number) len, count(*)::int n
                    FROM payments WHERE created_at >= '2026-07-01' AND created_at < '2026-08-01'
                     AND customer_mobile_number IS NOT NULL GROUP BY 1,2 ORDER BY n DESC LIMIT 4`],
    ['users',    `SELECT left(mobile_number,3) pfx, length(mobile_number) len, count(*)::int n
                    FROM users WHERE mobile_number IS NOT NULL GROUP BY 1,2 ORDER BY n DESC LIMIT 4`],
    ['guests',   `SELECT left(mobile_number,3) pfx, length(mobile_number) len, count(*)::int n
                    FROM guests WHERE mobile_number IS NOT NULL GROUP BY 1,2 ORDER BY n DESC LIMIT 4`],
  ]) {
    const rows = await q(sql);
    console.log(`   ${label.padEnd(9)} ` + rows.map(r => `${r.pfx}… len ${r.len} (${r.n})`).join('   ·   '));
  }

  /* real overlap on one month — the number that decides whether this is worth 12 passes */
  const t = (await q(
    `SELECT count(*)::int n,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM users u WHERE u.mobile_number = p.customer_mobile_number))::int in_users,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM guests g WHERE g.mobile_number = p.customer_mobile_number))::int in_guests
       FROM payments p
      WHERE p.created_at >= '2026-07-01' AND p.created_at < '2026-08-01' AND ${SCOPE}`))[0];
  const pct = n => t.n ? (n * 100 / t.n).toFixed(1) + '%' : '—';
  console.log(`\n   July sample: ${t.n} recharge+invoice payments · in users ${t.in_users} (${pct(t.in_users)})` +
              ` · in guests ${t.in_guests} (${pct(t.in_guests)})`);
  if (t.in_users === 0 && t.in_guests === 0) {
    console.log('\n   ✗ ZERO matches — formats almost certainly differ. NOT running 12 passes on a broken join.');
    console.log('     Compare the shapes printed above and normalise before re-running.');
    process.exit(2);
  }
  console.log('   ✓ the lookup discriminates — proceeding\n');
}

async function extractMonth(ym) {
  const P = [`${ym}-01`, nextMonth(ym)];
  const t0 = Date.now();
  const rows = await q(
    `SELECT ${JOURNEY} AS journey, ${ACCOUNT} AS account_status, ${OUTCOME} AS outcome,
            count(*)::int n, coalesce(sum(p.amount),0)::numeric sar
       FROM payments p
      WHERE p.created_at >= $1 AND p.created_at < $2 AND ${SCOPE}
      GROUP BY 1,2,3 ORDER BY 1,2,3`, P);
  return { month: ym, window: P, basis: 'account membership (users/guests) — NOT session state', rows, elapsed_ms: Date.now() - t0 };
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  await preflight();
  const list = months(FROM, TO);
  console.log(`identity addendum · ${list.length} months (${FROM} → ${TO}) · journeys 3 + 4 only\n`);
  for (const ym of list) {
    process.stdout.write(`  ${ym} … `);
    try {
      const M = await extractMonth(ym);
      fs.writeFileSync(`${OUTDIR}/identity-${ym}.json`, JSON.stringify(M, null, 1));
      const tot = M.rows.reduce((a, r) => a + r.n, 0);
      console.log(`${String(tot).padStart(7)} payments · ${M.rows.length} buckets · ${M.elapsed_ms} ms`);
    } catch (e) {
      console.log(`FAILED — ${e.message}`);
      console.log(`         re-run:  node src/biIdentity.js --from ${ym} --to ${ym}`);
    }
    await sleep(PAUSE_MS);
  }
  console.log(`\n✓ ${OUTDIR}/identity-*.json`);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
