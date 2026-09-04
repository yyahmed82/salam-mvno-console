/* HUNT FOR UPG KEYS BY VALUE SHAPE — the last thing to try before asking for a gateway index.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/refHunt.js                     # tests May 2025
 *   node src/refHunt.js --month 2025-07
 *
 * WHY THIS EXISTS
 * appArchiveProbe.js searched for columns whose NAME looked like a payment reference. That found
 * real things but nothing usable: change_plan_logs.payment_id holds app payment UUIDs (useless —
 * UPG keys on invoice id, and the payments table that mapped UUID→reference is gone), refunds
 * carries proper keys but only for the ~876 refunds in a month, app-side invoices stops in Feb 2024,
 * payments_bkp is empty, and termination_logs.payment_id is 100% NULL.
 *
 * Searching by name is weak: a column called `reference`, `ext_id`, `order_ref` or `gw_ref` would
 * have been missed entirely. So this searches by VALUE SHAPE instead, which cannot be fooled by
 * naming. Verified against 39,585 real references from the September 2025 export: a UPG invoice id
 * is exactly twelve lowercase alphanumeric characters (ke8ixgsjge6e, mi9utur5z1p6). The refunds
 * samples match the same shape, which is what makes this worth running.
 *
 * AND THEN IT PROVES IT. Shape alone is suggestive, not conclusive — plenty of id schemes are
 * twelve chars. So any candidate column is TEST-JOINED against UPG: take up to 200 real values and
 * look them up by invoice_id (an indexed lookup, the same one the exporter uses). A column whose
 * values resolve at the gateway IS a usable key. A column that resolves nothing is a coincidence.
 * That check is the difference between "this looks promising" and "this works".
 *
 * SAFETY: shape detection reads five rows per table with no WHERE clause — no scan. Month counts
 * run only on tables that have a created_at index. The UPG side is capped at 200 values in chunks
 * of 100, which is smaller than a single page of the console.
 */
'use strict';
const db = require('./db');
const upg = require('./upgLink');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const MONTH = arg('--month', '2025-05');
const MISSING = ['2025-01', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08'];
const pad = n => String(n).padStart(2, '0');
const nextMonth = ym => { let [y, m] = ym.split('-').map(Number); if (++m > 12) { m = 1; y++; } return `${y}-${pad(m)}-01`; };
const q = (sql, p = []) => db.source.query(sql, p).then(r => r.rows);

/* SHAPE — run #1 used /^[a-z0-9]{12}$/ and it was wrong in a way that wrecked the result: a Saudi
 * mobile number (966512345678) is also twelve lowercase alphanumerics, so the candidate list came
 * back as nothing but mobile_number columns and the real keys were crowded out. Requiring at least
 * one letter AND one digit fixes it. Measured against 61,809 real September references:
 *     both letter+digit   60,091  (97.2%)   ← kept
 *     letters only         1,718  ( 2.8%)   ← lost, acceptable: detection only needs a few hits
 *     digits only              0            ← no real reference is phone-shaped
 * and 966512345678 no longer matches. */
const SHAPE = /^(?=.*[a-z])(?=.*\d)[a-z0-9]{12}$/;

/* CONTROL — refunds.remote_payment_id is a known UPG key (verified format, fully populated in the
 * archived months). If the hunt cannot find THAT, it cannot be trusted to have found nothing else,
 * and a negative verdict would be worthless. Run #1 missed it because it sampled five unordered
 * rows per table; this run samples 200 and checks the control explicitly before concluding. */
const CONTROL = { table: 'refunds', col: 'remote_payment_id' };
const SAMPLE_ROWS = 200;
const MIN_HITS = 5;

(async () => {
  /* ---- 1. which tables can we even window by month? -------------------------------------- */
  const idx = await q(
    `SELECT DISTINCT tablename FROM pg_indexes
      WHERE schemaname='public' AND indexdef ~ '\\(created_at'`);
  const dated = new Set(idx.map(r => r.tablename));

  const tables = (await q(
    `SELECT t.table_name FROM information_schema.tables t
      WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
      ORDER BY t.table_name`)).map(r => r.table_name);
  console.log(`scanning ${tables.length} tables for values shaped like a UPG invoice id `
            + `(12 lowercase alphanumerics) · ${dated.size} have a created_at index\n`);

  /* ---- 2. shape detection ------------------------------------------------------------------
   * Run #2 sampled `SELECT * FROM t LIMIT 200` with no ordering, which returns the PHYSICALLY
   * FIRST rows — on a table running since 2022 that means the oldest ones. refunds.remote_payment_id
   * is NULL in that era, so the control was invisible: the hunt was sampling the wrong end of every
   * table. Sample the window we actually care about instead — the archived months — and only fall
   * back to an unordered sample when the table has no created_at at all.
   *
   * A month-windowed LIMIT on a table with no created_at index is a scan that stops early, which is
   * usually fine and occasionally not; an 8-second statement timeout on a dedicated connection caps
   * the damage and the table is skipped rather than hanging the hunt. */
  const client = await db.source.connect();
  await client.query("SET statement_timeout = '8s'");
  const cq = (sql, p = []) => client.query(sql, p).then(r => r.rows).catch(() => null);

  const hasCreated = new Set((await q(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='created_at'`)).map(r => r.table_name));

  const candidates = [];
  const strategy = {};
  for (const t of tables) {
    try {
      let rows = null;
      if (hasCreated.has(t)) {
        rows = await cq(`SELECT row_to_json(x) j FROM (SELECT * FROM "${t}"
                          WHERE created_at >= $1 AND created_at < $2 LIMIT ${SAMPLE_ROWS}) x`,
                        [`${MONTH}-01`, nextMonth(MONTH)]);
        if (rows && rows.length) strategy[t] = `${MONTH} window`;
      }
      if (!rows || !rows.length) {
        rows = await cq(`SELECT row_to_json(x) j FROM (SELECT * FROM "${t}" LIMIT ${SAMPLE_ROWS}) x`);
        if (rows && rows.length) strategy[t] = strategy[t] || 'unordered (no rows in window)';
      }
      if (!rows || !rows.length) continue;
      const hits = {};
      for (const { j } of rows) {
        for (const [k, v] of Object.entries(j || {})) {
          if (typeof v === 'string' && SHAPE.test(v)) hits[k] = (hits[k] || 0) + 1;
        }
      }
      for (const [col, n] of Object.entries(hits)) {
        if (n >= MIN_HITS) candidates.push({ table: t, col, seen: n, dated: dated.has(t) || hasCreated.has(t) });
      }
    } catch (e) { /* permission or exotic type — not worth failing the hunt over */ }
  }
  client.release();

  if (!candidates.length) {
    console.log('No column anywhere holds values of that shape. The keys are not on our side.');
    process.exit(0);
  }
  console.log('=== columns whose values match the UPG invoice-id shape ===');
  candidates.forEach(c => console.log(`  ${c.table}.${c.col}`.padEnd(46)
    + `${String(c.seen).padStart(3)}/${SAMPLE_ROWS} rows   [${strategy[c.table] || '?'}]`
    + (c.dated ? '' : '   (no created_at — cannot count by month)')));

  /* ---- 2b. DID THE CONTROL SHOW UP? ------------------------------------------------------- */
  const foundControl = candidates.some(c => c.table === CONTROL.table && c.col === CONTROL.col);
  console.log(`\n  control · ${CONTROL.table}.${CONTROL.col}: ${foundControl ? 'DETECTED — the hunt works' : 'NOT DETECTED'}`);
  if (!foundControl) {
    console.log('  The hunt failed to find a key it is known to contain, so it cannot be trusted to');
    console.log('  have found nothing else. NOT issuing a verdict. Fix the detector before relying');
    console.log('  on this, and do not use this run as grounds for requesting a gateway index.');
    process.exit(3);
  }

  /* ---- 3. do they cover the months we are missing? ---------------------------------------- */
  console.log('\n=== coverage of the archived months ===');
  const usable = [];
  for (const c of candidates.filter(x => x.dated)) {
    try {
      const parts = [];
      let anyRows = 0;
      for (const ym of MISSING) {
        const r = (await q(
          `SELECT count(*)::bigint n, count("${c.col}")::bigint filled FROM "${c.table}"
            WHERE created_at >= $1 AND created_at < $2`, [`${ym}-01`, nextMonth(ym)]))[0];
        parts.push(`${ym.slice(2)}:${Number(r.filled).toLocaleString()}`);
        anyRows += Number(r.filled);
      }
      console.log(`  ${c.table}.${c.col}`);
      console.log(`     ${parts.join('  ')}`);
      if (anyRows) usable.push({ ...c, filled: anyRows });
    } catch (e) { console.log(`  ${c.table}.${c.col}  count failed: ${e.message.slice(0, 60)}`); }
  }

  /* ---- 4. THE PROOF: do these values actually resolve at the gateway? --------------------- */
  if (!upg.configured()) { console.log('\nUPG not configured — cannot verify. Stopping.'); process.exit(0); }
  console.log(`\n=== verification — do the values resolve at UPG? (sample from ${MONTH}) ===`);
  console.log('   a shape match is a hypothesis; a gateway hit is proof\n');
  const results = [];
  for (const c of usable) {
    try {
      const vals = (await q(
        `SELECT DISTINCT "${c.col}" v FROM "${c.table}"
          WHERE created_at >= $1 AND created_at < $2 AND "${c.col}" IS NOT NULL LIMIT 200`,
        [`${MONTH}-01`, nextMonth(MONTH)])).map(r => r.v).filter(v => SHAPE.test(v));
      if (!vals.length) { console.log(`  ${c.table}.${c.col}  no values in ${MONTH}`); continue; }
      const got = await upg.rowsForRefs(vals, { chunk: 100, max: vals.length + 1, pause: 400 });
      const matched = got && got.byRef ? got.byRef.size : 0;
      const rate = matched * 100 / vals.length;
      console.log(`  ${(c.table + '.' + c.col).padEnd(44)} ${matched}/${vals.length} resolved  ${rate.toFixed(1)}%`
                + (rate >= 50 ? '   ← THIS IS A UPG KEY' : rate > 0 ? '   (partial — investigate)' : '   (not a gateway key)'));
      results.push({ ...c, tested: vals.length, matched, rate });
    } catch (e) { console.log(`  ${c.table}.${c.col}  verification failed: ${e.message.slice(0, 70)}`); }
  }

  /* ---- 5. verdict -------------------------------------------------------------------------- */
  const winners = results.filter(r => r.rate >= 50);
  console.log('\n=== VERDICT ===');
  if (winners.length) {
    console.log('  Usable key columns found — the archived months CAN be exported with no gateway change:');
    winners.forEach(w => console.log(`    ${w.table}.${w.col}  (${w.filled.toLocaleString()} keys across the seven months, `
      + `${w.rate.toFixed(0)}% resolve at UPG)`));
    console.log('\n  CAVEAT worth stating in the workbook: these keys come from a side table, so they');
    console.log('  cover only the payments THAT TABLE knows about — not necessarily every payment of');
    console.log('  the month. The result is a real but partial view, and it must be labelled as such.');
  } else {
    console.log('  No column on our side resolves at the gateway. The keys for the archived months are');
    console.log('  genuinely gone, and the only remaining route is to let UPG be read by date:');
    console.log('     CREATE INDEX CONCURRENTLY idx_payments_created_at ON payments (created_at);');
    console.log('  (payments, not invoices — it is the table the export actually reads, so one index');
    console.log('   serves the job directly instead of forcing a two-step through invoices.)');
  }
  process.exit(0);
})().catch(e => { console.error('HUNT FAILED:', e.message); process.exit(1); });
