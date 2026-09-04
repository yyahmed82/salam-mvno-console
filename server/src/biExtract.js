/* BI PAYMENT REPORT — STEP 2 of 3: EXTRACTION.  Sep 2025 → Aug 2026 (12 complete months).
 *
 * WHY 12 AND NOT 20
 * BI asked for Jan 2025 onward. The replica cannot serve it: payments starts 2025-02-14 and then
 * has a SIX-MONTH HOLE (Mar–Aug 2025, zero rows) before resuming complete from Sep 2025. Probably
 * the archival job — payments carries archived / archived_at. onboarding_orders (2022-01) and
 * checkouts (2022-06) have no such gap, so this is specific to payments. 2025-09 → 2026-08 is the
 * longest unbroken window that exists. That caveat goes in the README sheet, not a footnote.
 *
 * NO PRODUCTION IMPACT — how that is actually achieved, not merely claimed:
 *   · reads db.source = salam_replica. (On 152 today PROD_DATABASE_URL also resolves to the
 *     replica — open DBA ticket — so no path here reaches the live DB.)
 *   · ONE MONTH PER PASS, every pass driven by idx_src_payments_created / (status, created_at).
 *   · aggregates only. No row-level export of 5.4 M rows; the detail sheet is failures only.
 *   · a deliberate pause between months (PAUSE_MS) so 12 passes are not one sustained burst.
 *   · statement_timeout is already 60 s on the source pool; a slow month fails loudly instead of
 *     holding a connection. Re-run just that month with --from/--to if it does.
 *
 * THE FOUR JOURNEYS — and the honest identity story
 *   ① New SIM   payment_on_type='OnboardingOrder' → onboarding_orders.number_order_type = 0
 *   ② MNP       same join, number_order_type = 1
 *   ③ Recharge  payment_on_type IN ('recharge','postpaid_service_recharge')
 *   ④ Invoice   payment_on_type IN ('bill','advanced_postpaid_payment')
 *
 *   LOGGED vs NOT LOGGED is only recorded where a payment hangs off an order or a checkout
 *   (polymorphic orderable_type / checkoutable_type = User | Guest | AnonymousUser). Measured:
 *     · onboarding_orders → 99.99% AnonymousUser. Correct behaviour — you have no account before
 *       buying your first SIM. So ① and ② get NO logged/guest split; claiming one would invent it.
 *     · checkouts        → User 36k / Guest 11.8k / AnonymousUser 9.5k. A real split.
 *     · recharge + bill  → payment_on_id is NULL on 100% of rows. NO identity link exists at all.
 *   For ③ and ④ we therefore report a BEHAVIOURAL proxy, named for exactly what it measures:
 *       self_number  = customer_mobile_number = target_mobile_number
 *       other_number = they differ (paying for someone else — the guest-style flow)
 *   It is NOT session state. The README sheet says so in those words.
 *
 * Run ON 152 (off-peak):
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/biExtract.js                          # all 12 months → /tmp/bi/YYYY-MM.json
 *   node src/biExtract.js --from 2026-03 --to 2026-05   # re-run a subset
 *   PAUSE_MS=8000 node src/biExtract.js            # gentler on a busy replica
 */
'use strict';
const fs = require('fs');
const db = require('./db');

const OUTDIR = process.env.OUTDIR || '/tmp/bi';
const PAUSE_MS = Number(process.env.PAUSE_MS) || 4000;
const arg = f => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const FROM = arg('--from') || '2025-09';
const TO   = arg('--to')   || '2026-08';

/* ---- shared SQL fragments — identical definitions to the 20 Aug catalog ------------------- */

/* EVERY fragment below qualifies its columns with p. — non-negotiable, not style.
 * onboarding_orders ALSO has a `status` column, so the moment the LEFT JOIN is added a bare
 * `status` is ambiguous and Postgres refuses the query. (It cost a second failed run of all 12
 * months.) payments is aliased p in every query here, joined or not, so p. is always valid. */

/* did the gateway answer at all? (the console funnel's ANS predicate, verbatim) */
const ANS = `(p.payment_commit_response IS NOT NULL AND p.payment_commit_response::text NOT IN ('{}','null'))`;

/* reason: fail_reason first, else "code · message" from the stored gateway snapshot.
 * analytics.DECLINE_EXPR verbatim — UPG/salam leave fail_reason empty and put the truth there. */
const DECLINE = `COALESCE(
  NULLIF(p.fail_reason,''),
  NULLIF(regexp_replace(concat_ws(' · ',
    COALESCE(p.payment_commit_response#>>'{gateway,response,code}', p.payment_initialization_response#>>'{gateway,response,code}'),
    COALESCE(p.payment_commit_response#>>'{gateway,response,message}', p.payment_initialization_response#>>'{gateway,response,message}')
  ), ' \\([^)]*\\)$', ''), ''),
  '(no message)')`;

const CARD = `CASE p.card_type WHEN 0 THEN 'Apple Pay' WHEN 1 THEN 'Credit card' WHEN 2 THEN 'mada'
  WHEN 3 THEN 'Amex' WHEN 4 THEN 'STC Pay' WHEN 5 THEN 'Tasheel' WHEN 30 THEN 'Other'
  WHEN 60 THEN 'N/A' ELSE coalesce(p.card_type::text,'—') END`;

/* outcome, on the console's agreed definitions (paymentErrorReport.js v2):
 *   pending + no gateway answer → never_attempted (funnel gap, NOT an error)
 *   pending + gateway answered  → stuck_callback  (true technical: money may be taken) */
const OUTCOME = `CASE
  WHEN p.status = 'success'            THEN 'success'
  WHEN p.status IN ('fail','failed')   THEN 'failed'
  WHEN p.status = 'pending' AND ${ANS} THEN 'stuck_callback'
  WHEN p.status = 'pending'            THEN 'never_attempted'
  ELSE coalesce(p.status,'—') END`;

/* the four journeys. Anything else is reported as 'other' rather than silently dropped. */
const JOURNEY = `CASE
  WHEN p.payment_on_type = 'OnboardingOrder' AND o.number_order_type = 0 THEN '1_new_sim'
  WHEN p.payment_on_type = 'OnboardingOrder' AND o.number_order_type = 1 THEN '2_mnp'
  WHEN p.payment_on_type = 'OnboardingOrder'                             THEN '1_2_order_type_unknown'
  WHEN p.payment_on_type IN ('recharge','postpaid_service_recharge')     THEN '3_recharge'
  WHEN p.payment_on_type IN ('bill','advanced_postpaid_payment')         THEN '4_invoice'
  WHEN p.payment_on_type = 'Checkout'                                    THEN '5_checkout'
  ELSE 'other' END`;

/* identity, per journey — see the header for why these differ */
const IDENTITY = `CASE
  WHEN p.payment_on_type = 'OnboardingOrder' THEN 'order_' || lower(coalesce(o.orderable_type,'unknown'))
  WHEN p.payment_on_type = 'Checkout'        THEN 'checkout_' || lower(coalesce(c.checkoutable_type,'unknown'))
  WHEN p.customer_mobile_number IS NULL OR p.target_mobile_number IS NULL THEN 'proxy_unknown'
  WHEN p.customer_mobile_number = p.target_mobile_number THEN 'proxy_self_number'
  ELSE 'proxy_other_number' END`;

/* LEFT JOINs so a payment is never dropped because its parent row is missing.
 *
 * TYPE TRAP (cost one failed run of all 12 months): payments.payment_on_id is CHARACTER VARYING
 * while onboarding_orders.id and checkouts.id are UUID — `uuid = character varying` has no
 * operator. Cast the VARCHAR side, never the uuid side: casting o.id::text would throw away the
 * primary-key index and turn each month into a seq scan of an 8.4 M-row table.
 * The regex guard means a non-UUID value yields NULL (no match) instead of erroring the query —
 * discovery showed payment_on_id is either a UUID or NULL, but a guard costs nothing and this
 * runs unattended. */
const UUID_RE = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;
const AS_UUID = `(CASE WHEN p.payment_on_id ~ ${UUID_RE} THEN p.payment_on_id::uuid END)`;
const FROM_JOIN = `FROM payments p
  LEFT JOIN onboarding_orders o ON p.payment_on_type = 'OnboardingOrder' AND o.id = ${AS_UUID}
  LEFT JOIN checkouts        c ON p.payment_on_type = 'Checkout'         AND c.id = ${AS_UUID}`;

const WIN = `p.created_at >= $1 AND p.created_at < $2`;

const q = (sql, p) => db.source.query(sql, p).then(r => r.rows);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* month list, inclusive */
function months(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
const nextMonth = ym => {
  let [y, m] = ym.split('-').map(Number);
  if (++m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}-01`;
};

async function extractMonth(ym) {
  const P = [`${ym}-01`, nextMonth(ym)];
  const t0 = Date.now();
  const M = { month: ym, window: P };

  /* 1 · headline funnel — one pass, the report's top block */
  M.funnel = (await q(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE p.status='success')::int success,
            count(*) FILTER (WHERE p.status IN ('fail','failed'))::int failed,
            count(*) FILTER (WHERE p.status='pending' AND ${ANS})::int stuck_callback,
            count(*) FILTER (WHERE p.status='pending' AND NOT ${ANS})::int never_attempted,
            coalesce(sum(p.amount) FILTER (WHERE p.status='success'),0)::numeric success_sar,
            coalesce(sum(p.amount) FILTER (WHERE p.status IN ('fail','failed')),0)::numeric failed_sar
       FROM payments p WHERE ${WIN}`, P))[0];

  /* 2 · THE BI ASK: journey × identity × outcome */
  M.journey = await q(
    `SELECT ${JOURNEY} AS journey, ${IDENTITY} AS identity, ${OUTCOME} AS outcome,
            count(*)::int n, coalesce(sum(p.amount),0)::numeric sar
       ${FROM_JOIN} WHERE ${WIN}
      GROUP BY 1,2,3 ORDER BY 1,2,3`, P);

  /* 3 · why they failed — reason × journey, the catalog's core table */
  M.reasons = await q(
    `SELECT ${JOURNEY} AS journey, ${DECLINE} AS reason, coalesce(p.vendor,'—') vendor,
            ${CARD} AS rail, count(*)::int n, coalesce(sum(p.amount),0)::numeric sar
       ${FROM_JOIN}
      WHERE ${WIN} AND p.status IN ('fail','failed')
      GROUP BY 1,2,3,4 HAVING count(*) >= 1
      ORDER BY n DESC LIMIT 400`, P);

  /* 4 · supporting cuts, same shape as the 20 Aug catalog */
  M.byVendor = await q(
    `SELECT coalesce(p.vendor,'—') vendor, ${OUTCOME} AS outcome, count(*)::int n,
            coalesce(sum(p.amount),0)::numeric sar
       FROM payments p WHERE ${WIN} GROUP BY 1,2 ORDER BY n DESC`, P);

  M.byRail = await q(
    `SELECT ${CARD} AS rail, ${OUTCOME} AS outcome, count(*)::int n
       FROM payments p WHERE ${WIN} GROUP BY 1,2 ORDER BY n DESC`, P);

  M.byPlatform = await q(
    `SELECT coalesce(p.platform,'—') platform, ${OUTCOME} AS outcome, count(*)::int n
       FROM payments p WHERE ${WIN} GROUP BY 1,2 ORDER BY n DESC`, P);

  M.elapsed_ms = Date.now() - t0;
  return M;
}

/* PREFLIGHT — verify the join types before spending 12 passes on them. The first run of this
 * script died on all 12 months for one type mismatch; a two-second catalogue read prevents a
 * repeat, and prints the truth rather than trusting this file's assumptions. */
async function preflight() {
  const rows = await q(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE (table_name='payments'          AND column_name='payment_on_id')
         OR (table_name='onboarding_orders' AND column_name='id')
         OR (table_name='checkouts'         AND column_name='id')
      ORDER BY table_name`, []);
  console.log('preflight — join column types:');
  rows.forEach(r => console.log(`   ${r.table_name}.${r.column_name}: ${r.data_type}`));
  const t = Object.fromEntries(rows.map(r => [r.table_name, r.data_type]));
  if (t.payments !== 'character varying' || t.onboarding_orders !== 'uuid' || t.checkouts !== 'uuid') {
    console.log('   ! types differ from what the joins assume — check FROM_JOIN before trusting output');
  } else {
    console.log('   ✓ as expected: varchar → uuid cast is required and is applied\n');
  }
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  await preflight();
  const list = months(FROM, TO);
  console.log(`BI extract · ${list.length} months (${FROM} → ${TO}) · replica only · pause ${PAUSE_MS}ms\n`);

  for (const ym of list) {
    process.stdout.write(`  ${ym} … `);
    try {
      const M = await extractMonth(ym);
      fs.writeFileSync(`${OUTDIR}/${ym}.json`, JSON.stringify(M, null, 1));
      console.log(`${String(M.funnel.total).padStart(7)} payments · ` +
                  `${M.journey.length} journey rows · ${M.reasons.length} reasons · ${M.elapsed_ms} ms`);
    } catch (e) {
      console.log(`FAILED — ${e.message}`);
      console.log(`         re-run just this month:  node src/biExtract.js --from ${ym} --to ${ym}`);
    }
    await sleep(PAUSE_MS);        // deliberate gap: 12 passes, not one sustained burst
  }

  console.log(`\n✓ ${OUTDIR}/  — scp the folder back and run tools/build-bi-report.py`);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
