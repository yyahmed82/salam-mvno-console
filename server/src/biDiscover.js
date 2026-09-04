/* BI 20-MONTH EXTRACT — STEP 1 of 3: DISCOVERY. Read-only, cheap, no full scans.
 *
 * WHY THIS EXISTS
 * The BI request is "the 20 Aug catalog, but Jan 2025 → today, split by four journeys with a
 * logged / not-logged breakdown". Before writing a single aggregate over 20 months we need four
 * facts, and guessing any of them wastes a scan of a 4.1 M-row table:
 *
 *   1. Does the replica even HOLD Jan 2025?  (prod-sync may have a shorter horizon)
 *   2. Which column marks a payment as guest vs logged-in?
 *   3. What are the real payment_type values, and which map to the four journeys?
 *   4. Which columns are indexed, so every month query rides an index instead of scanning?
 *
 * WHAT IT READS
 * db.source = the PRODUCTION REPLICA, never production itself. (Note: on 152 today both
 * SOURCE_DATABASE_URL and PROD_DATABASE_URL resolve to salam_replica — open DBA ticket — so even
 * `--prod` reads the replica. Stated here so nobody believes this touched the live DB.)
 *
 * COST: every query is either a catalogue read (information_schema / pg_indexes, instant) or an
 * indexed min/max. The only GROUP BY is bounded to a single recent month.
 *
 * Run ON 152:
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/biDiscover.js            # prints findings + writes /tmp/bi-discover.json
 */
'use strict';
const fs = require('fs');
const db = require('./db');

const TABLES = ['payments', 'onboarding_orders', 'checkouts'];

/* one month that certainly has data, for shape probing — kept tiny on purpose */
const PROBE_FROM = process.env.PROBE_FROM || '2026-07-01';
const PROBE_TO   = process.env.PROBE_TO   || '2026-08-01';

const q = (sql, p = []) => db.source.query(sql, p).then(r => r.rows);
const line = s => console.log(s);
const out = { generated_at: new Date().toISOString(), probe_window: [PROBE_FROM, PROBE_TO] };

(async () => {
  /* ---- 1. columns, so nothing downstream is guessed ------------------------------------- */
  out.columns = {};
  for (const t of TABLES) {
    const cols = await q(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = $1 ORDER BY ordinal_position`, [t]);
    out.columns[t] = cols.map(c => `${c.column_name} ${c.data_type}`);
    line(`\n=== ${t} — ${cols.length} columns ===`);
    line(cols.map(c => c.column_name).join(', '));
  }

  /* ---- 2. indexes: which predicates the DB can actually serve --------------------------- */
  out.indexes = {};
  for (const t of TABLES) {
    const ix = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`, [t]);
    out.indexes[t] = ix.map(i => i.indexdef);
    line(`\n--- ${t} indexes (${ix.length}) ---`);
    ix.forEach(i => line('  ' + i.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, '')));
  }

  /* ---- 3. does the replica hold 20 months? ---------------------------------------------- */
  line('\n=== DATE COVERAGE (indexed min/max — this is the go/no-go for the whole request) ===');
  out.coverage = {};
  for (const t of TABLES) {
    try {
      const r = (await q(`SELECT min(created_at) lo, max(created_at) hi, count(*)::bigint n FROM ${t}`))[0];
      out.coverage[t] = r;
      line(`  ${t.padEnd(20)} ${String(r.lo).slice(0, 10)} → ${String(r.hi).slice(0, 10)}   ${r.n} rows`);
    } catch (e) { out.coverage[t] = { error: e.message }; line(`  ${t}: ${e.message}`); }
  }

  /* ---- 4. what the journey/segmentation columns actually contain ------------------------ */
  /* Bounded to ONE month so this stays cheap; we only need the vocabulary, not the totals. */
  const P = [PROBE_FROM, PROBE_TO];
  const probe = async (label, sql) => {
    try {
      const rows = await q(sql, P);
      out[label] = rows;
      line(`\n--- ${label} (${PROBE_FROM} → ${PROBE_TO}) ---`);
      rows.forEach(r => line('  ' + JSON.stringify(r)));
    } catch (e) { out[label] = { error: e.message }; line(`\n--- ${label}: ${e.message}`); }
  };

  await probe('payment_types',
    `SELECT payment_type, status, count(*)::int n FROM payments
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1,2 ORDER BY n DESC LIMIT 40`);

  /* logged vs guest: try every plausible marker; whichever returns non-null wins.
   * The Rails side has BOTH User and Guest (recharge_controller looks the mobile up in each),
   * so the payment row should carry one of these shapes. We report what exists rather than
   * assuming which. */
  const cols = new Set((out.columns.payments || []).map(c => c.split(' ')[0]));
  const candidates = ['user_id', 'guest_id', 'customer_id', 'payment_on_type', 'payable_type', 'source', 'channel'];
  out.identity_candidates = candidates.filter(c => cols.has(c));
  line(`\n--- identity columns present on payments: ${out.identity_candidates.join(', ') || 'NONE OF THE EXPECTED'} ---`);
  for (const c of out.identity_candidates) {
    await probe(`identity_${c}`,
      `SELECT ${/_id$/.test(c) ? `(${c} IS NOT NULL)` : c} AS v, count(*)::int n
         FROM payments WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1 ORDER BY n DESC LIMIT 10`);
  }

  await probe('onboarding_order_types',
    `SELECT number_order_type, flow_type, count(*)::int n FROM onboarding_orders
      WHERE created_at >= $1 AND created_at < $2 GROUP BY 1,2 ORDER BY n DESC LIMIT 30`);

  await probe('checkout_types',
    `SELECT checkout_type, count(*)::int n FROM checkouts
      WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY n DESC LIMIT 20`);

  /* how a payment links back to its journey row */
  await probe('payment_link_shape',
    `SELECT payment_type, count(*)::int n,
            count(*) FILTER (WHERE payment_on_id IS NOT NULL)::int with_link
       FROM payments WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1 ORDER BY n DESC LIMIT 20`);

  fs.writeFileSync('/tmp/bi-discover.json', JSON.stringify(out, null, 2));
  line('\n✓ wrote /tmp/bi-discover.json — scp it back and we build the extractor from these facts.');
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
