/* 12-MONTH JOURNEY-ERRORS PROBE — what can actually be extracted, before building extractors.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/journeyErrProbe.js
 *
 * PURPOSE: the team wants eligibility / BSS / APIGW errors monthly, Sep-2025 → Aug-2026, like
 * the UPG payment monthlies. Before writing an extractor, this answers per source:
 *   1. RETENTION — does the table actually hold 12 months? (min(created_at) tells the truth)
 *   2. VOLUME — rows per month, so the extractor can be sized and throttled correctly
 *   3. SIGNAL — do the failure columns carry data across the whole period (not just recently)?
 * It also DOCUMENTS the APIGW impossibility: api_traffic_events = 7-day retention, collector
 * live 13 Aug 2026 — min(ts) printed as proof for the report's caveat page.
 *
 * PROD SAFETY: replica only, read-only, ONE bounded query at a time with a pause between,
 * statement_timeout 30s, month counts use the created_at index. Nothing here touches the
 * primary or the UPG gateway.
 */
'use strict';
const db = require('./db');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const L = console.log;
const MONTHS = [];
for (let d = new Date(Date.UTC(2025, 8, 1)); d < new Date(Date.UTC(2026, 8, 1)); d.setUTCMonth(d.getUTCMonth() + 1))
  MONTHS.push([d.toISOString().slice(0, 10), new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)]);

async function q(pool, sql, p = []) {
  const c = await pool.connect();
  try { await c.query(`SET statement_timeout = 30000`); return (await c.query(sql, p)).rows; }
  finally { c.release(); }
}

(async () => {
  L('Journey-errors probe · Sep 2025 → Aug 2026 · one query at a time, 400ms pauses\n');

  /* ---- 1. retention: the oldest row per table decides everything ------------------------- */
  L('=== 1 · RETENTION (min/max timestamps) ===');
  for (const [name, pool, col, table] of [
    ['eligibility_logs', db.source, 'created_at', 'eligibility_logs'],
    ['activation_logs', db.source, 'created_at', 'activation_logs'],
    ['nafath_logs', db.source, 'created_at', 'nafath_logs'],
    ['onboarding_orders', db.source, 'created_at', 'onboarding_orders'],
    ['api_traffic_events (APIGW — expect ~7 days only)', db.console, 'ts', 'api_traffic_events'],
  ]) {
    try {
      const r = await q(pool, `SELECT min(${col}) lo, max(${col}) hi, count(*)::bigint n FROM ${table}`);
      L(`  ${name}: ${String(r[0].lo).slice(0, 10)} → ${String(r[0].hi).slice(0, 10)}  (${Number(r[0].n).toLocaleString()} rows)`);
    } catch (e) { L(`  ${name}: ERROR ${e.message.slice(0, 90)}`); }
    await sleep(400);
  }

  /* ---- 2. monthly volume + failure signal per replica source ------------------------------ */
  const SOURCES = [
    ['eligibility_logs', `SELECT count(*)::int n, count(*) FILTER (WHERE state = false)::int bad
       FROM eligibility_logs WHERE created_at >= $1 AND created_at < $2`],
    ['activation_logs', `SELECT count(*)::int n, count(*) FILTER (WHERE state = false)::int bad
       FROM activation_logs WHERE created_at >= $1 AND created_at < $2`],
    ['nafath_logs', `SELECT count(*)::int n,
        count(*) FILTER (WHERE lower(coalesce(status,'')) IN ('expired','rejected','failed','cancelled','denied'))::int bad
       FROM nafath_logs WHERE created_at >= $1 AND created_at < $2`],
    ['onboarding denials', `SELECT count(*)::int n,
        count(*) FILTER (WHERE is_eligible IS FALSE AND NULLIF(trim(nationality_id_number),'') IS NOT NULL)::int bad
       FROM onboarding_orders WHERE created_at >= $1 AND created_at < $2`],
  ];
  for (const [name, sql] of SOURCES) {
    L(`\n=== 2 · ${name} — rows / failures per month ===`);
    for (const [lo, hi] of MONTHS) {
      try {
        const r = await q(db.source, sql, [lo, hi]);
        L(`  ${lo.slice(0, 7)}  total ${String(r[0].n).padStart(9)}   failures ${String(r[0].bad).padStart(8)}`);
      } catch (e) { L(`  ${lo.slice(0, 7)}  ERROR ${e.message.slice(0, 80)}`); break; }
      await sleep(400);
    }
  }

  /* ---- 3. does the failure DETAIL exist across the period? (codes, not just counts) ------- */
  L('\n=== 3 · failure-code coverage — one early month vs one recent month ===');
  for (const [lo, hi] of [MONTHS[1], MONTHS[10]]) {
    L(`  -- activation_logs ${lo.slice(0, 7)} top failure codes:`);
    try {
      (await q(db.source,
        `SELECT coalesce(NULLIF(status_code,''), response->>'responseCode', '(none)') code, count(*)::int n
           FROM activation_logs WHERE created_at >= $1 AND created_at < $2 AND state = false
          GROUP BY 1 ORDER BY n DESC LIMIT 6`, [lo, hi]))
        .forEach(r => L(`     ${String(r.code).padEnd(18)} ${r.n}`));
    } catch (e) { L(`     ERROR ${e.message.slice(0, 80)}`); }
    await sleep(400);
    L(`  -- eligibility_logs ${lo.slice(0, 7)} top failure codes:`);
    try {
      (await q(db.source,
        `SELECT coalesce(NULLIF(status_code,''), '(none)') code, count(*)::int n
           FROM eligibility_logs WHERE created_at >= $1 AND created_at < $2 AND state = false
          GROUP BY 1 ORDER BY n DESC LIMIT 6`, [lo, hi]))
        .forEach(r => L(`     ${String(r.code).padEnd(18)} ${r.n}`));
    } catch (e) { L(`     ERROR ${e.message.slice(0, 80)}`); }
    await sleep(400);
  }

  /* ---- 4. lane attribution joins — do the FKs hold across the period? --------------------- */
  L('\n=== 4 · lane join sanity (activation → order → New SIM / MNP), one early month ===');
  try {
    (await q(db.source,
      `SELECT ((oo.number_order_type=1) IS TRUE) AS mnp, count(*)::int n
         FROM activation_logs al JOIN onboarding_orders oo ON oo.id = al.onboarding_order_id
        WHERE al.created_at >= $1 AND al.created_at < $2 AND al.state = false
        GROUP BY 1`, MONTHS[1])).forEach(r => L(`  ${r.mnp ? 'MNP   ' : 'NewSIM'} failures: ${r.n}`));
  } catch (e) { L(`  ERROR ${e.message.slice(0, 90)}`); }

  L('\n=== WHAT THIS DECIDES ===');
  L('  §1 names which sources truly hold 12 months (and proves the APIGW caveat with min(ts)).');
  L('  §2 sizes the extractor: monthly volumes → slice size and pauses.');
  L('  §3 proves the failure DETAIL (codes) exists in old months, not just row counts.');
  L('  §4 proves lane attribution works historically. Extractor gets built only on what passes.');
  process.exit(0);
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
