#!/usr/bin/env node
/* Console health & performance report — run ON 152:
 *     cd /apps/console/server && set -a; . ../.env; set +a; node /apps/console/healthcheck.cjs
 * Optional: --slow 500   (flag API endpoints slower than N ms; default 800)
 *
 * Reports: replica index coverage (the #1 cause of slow pages), table sizes/rowcounts,
 * per-endpoint API timings, DB connection headroom, and the slowest live queries.
 * READ-ONLY. Safe to run any time, including during an incident.
 */
// Must match the app: node-pg parses `timestamp without time zone` in the process TZ, and this
// host runs Asia/Riyadh. Without pinning UTC every timestamp reads 3h early (see ecosystem config).
process.env.TZ = 'UTC';
const { Client } = require('pg');
const http = require('http');

const _si = process.argv.indexOf('--slow');
const SLOW = Number((_si >= 0 && process.argv[_si + 1]) || (process.argv.find(a => a.startsWith('--slow=')) || '').split('=')[1] || 800) || 800;
const PORT = process.env.PORT || 4600;
const bar = (n, max, w = 28) => '█'.repeat(Math.max(0, Math.round((n / (max || 1)) * w))).padEnd(w, '·');
const ms = n => (n >= 1000 ? (n / 1000).toFixed(2) + 's' : n + 'ms');

// the indexes the metric/feed queries depend on — must exist on the REPLICA
const NEEDED = [
  ['payments', 'created_at'], ['onboarding_orders', 'created_at'], ['activation_logs', 'created_at'],
  ['eligibility_logs', 'created_at'], ['nafath_logs', 'created_at'], ['delivery_requests', 'created_at'],
  ['change_plan_logs', 'created_at'], ['checkouts', 'created_at'], ['seller_deductions', 'created_at'],
];

async function section(t) { console.log('\n\x1b[1m' + t + '\x1b[0m\n' + '─'.repeat(t.length)); }

async function main() {
  console.log(`\n=== Salam Console — health & performance ===  ${new Date().toISOString()}`);

  // ---------- 1. SOURCE REPLICA: indexes + sizes ----------
  const src = new Client({ connectionString: process.env.SOURCE_DATABASE_URL, statement_timeout: 20000, options: '-c timezone=UTC' });
  await src.connect();
  await section('1. Replica indexes (missing = slow dashboards)');
  const idx = await src.query(`
    SELECT t.relname AS table, a.attname AS col, count(i.indexrelid) AS n
    FROM pg_class t
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'created_at'
    LEFT JOIN pg_index i ON i.indrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE t.relkind = 'r' AND t.relname = ANY($1)
    GROUP BY 1,2 ORDER BY 1`, [NEEDED.map(n => n[0])]);
  const have = new Map(idx.rows.map(r => [r.table, Number(r.n)]));
  let missing = [];
  for (const [tbl] of NEEDED) {
    const n = have.get(tbl);
    if (n === undefined) console.log(`  ?    ${tbl.padEnd(22)} (table not found)`);
    else if (n > 0)      console.log(`  \x1b[32mOK\x1b[0m   ${tbl.padEnd(22)} created_at indexed`);
    else { console.log(`  \x1b[31mMISS\x1b[0m ${tbl.padEnd(22)} NO created_at index  ← causes seq scans`); missing.push(tbl); }
  }
  if (missing.length) {
    console.log('\n  \x1b[33mFIX (run on the replica, safe/online):\x1b[0m');
    for (const t of missing) console.log(`    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_src_${t}_created ON ${t} (created_at DESC);`);
  }

  await section('2. Replica table sizes');
  const sz = await src.query(`
    SELECT relname AS table, n_live_tup AS rows, pg_size_pretty(pg_total_relation_size(relid)) AS size
    FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8`);
  for (const r of sz.rows) console.log(`  ${String(r.table).padEnd(22)} ${String(r.rows).padStart(10)} rows   ${r.size}`);

  /* Clock / freshness: "0 rows in the last 6h" is almost always a timezone or lag problem,
   * not missing data. Show, for each table, the newest row in UTC *and* KSA next to real now,
   * plus how many rows actually fall inside the last 1h/6h/24h windows. */
  await section('2b. Data clock (newest row vs now) + rows in recent windows');
  const nowSrv = await src.query(`SELECT now() AT TIME ZONE 'UTC' AS utc, now() AT TIME ZONE 'Asia/Riyadh' AS ksa`);
  console.log(`  server now   UTC ${String(nowSrv.rows[0].utc).slice(0, 19)}   KSA ${String(nowSrv.rows[0].ksa).slice(0, 19)}`);
  console.log(`  this host    UTC ${new Date().toISOString().slice(0, 19)}\n`);
  for (const tbl of ['payments', 'onboarding_orders', 'checkouts', 'activation_logs', 'delivery_requests']) {
    try {
      const r = await src.query(`
        SELECT max(created_at) AS newest,
               count(*) FILTER (WHERE created_at >= now() - interval '1 hour')  AS h1,
               count(*) FILTER (WHERE created_at >= now() - interval '6 hours')  AS h6,
               count(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS h24
        FROM ${tbl} WHERE created_at >= now() - interval '48 hours'`);
      const x = r.rows[0];
      const lag = x.newest ? Math.round((Date.now() - new Date(x.newest).getTime()) / 60000) : null;
      const ksa = x.newest ? new Date(x.newest).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' }) : '—';
      console.log(`  ${tbl.padEnd(20)} newest ${x.newest ? new Date(x.newest).toISOString().slice(0, 19) : '(none in 48h)'}Z` +
        ` = ${ksa} KSA  (${lag == null ? '—' : lag + 'm ago'})`);
      console.log(`  ${''.padEnd(20)} rows: 1h=${x.h1}  6h=${x.h6}  24h=${x.h24}`);
    } catch (e) { console.log(`  ${tbl}: ${e.message}`); }
  }

  /* Per-table sync state — the definitive answer to "prod has rows the console can't see".
   * A stuck/lagging watermark on ONE table is invisible in the aggregate "sync ok" status. */
  await section('2c. prod-sync state per table (watermark = how far each table is filled)');
  try {
    const cdb = new Client({ connectionString: process.env.CONSOLE_DATABASE_URL, statement_timeout: 15000, options: '-c timezone=UTC' });
    await cdb.connect();
    const st = await cdb.query(`
      SELECT table_name, watermark, last_run_at, last_status, rows_synced, left(coalesce(last_error,''),60) AS err
      FROM prod_sync_state ORDER BY watermark NULLS FIRST`);
    console.log('  table                 watermark (UTC)      lag      last run   status');
    for (const r of st.rows) {
      const wl = r.watermark ? Math.round((Date.now() - new Date(r.watermark).getTime()) / 60000) : null;
      const rl = r.last_run_at ? Math.round((Date.now() - new Date(r.last_run_at).getTime()) / 60000) : null;
      const flag = wl != null && wl > 60 ? '\x1b[31m' : wl != null && wl > 20 ? '\x1b[33m' : '\x1b[32m';
      console.log(`  ${String(r.table_name).padEnd(21)} ${r.watermark ? new Date(r.watermark).toISOString().slice(0, 19) : '(never)'.padEnd(19)}` +
        ` ${flag}${(wl == null ? '—' : wl + 'm').padStart(6)}\x1b[0m  ${(rl == null ? '—' : rl + 'm ago').padStart(9)}  ${r.last_status || '—'}${r.err ? ' · ' + r.err : ''}`);
    }
    await cdb.end();
    console.log('\n  lag = how far BEHIND real-now each table is filled. Red >60m = that table is stuck/lagging.');
  } catch (e) { console.log('  (could not read prod_sync_state: ' + e.message + ')'); }

  /* Decisive test for "prod has rows we never pull": compare PROD's own clock to PROD's newest
   * rows. The sync's cutoff is `created_at <= now() - lag`, so if prod stores timestamps that run
   * AHEAD of prod's now() (timezone mismatch), the newest rows are permanently excluded. */
  if (process.env.PROD_DATABASE_URL) {
    await section('2d. PROD clock vs PROD newest rows (why rows may never be pulled)');
    const p = new Client({ connectionString: process.env.PROD_DATABASE_URL, statement_timeout: 20000, options: '-c timezone=UTC' });
    try {
      await p.connect();
      const t = await p.query(`SELECT now() AS n, current_setting('TimeZone') AS tz`);
      console.log(`  prod now(): ${new Date(t.rows[0].n).toISOString().slice(0, 19)}Z   (server TimeZone = ${t.rows[0].tz})`);
      for (const tbl of ['onboarding_orders', 'payments']) {
        const r = await p.query(`SELECT max(created_at) AS c, max(updated_at) AS u FROM ${tbl}`);
        const cd = r.rows[0].c ? new Date(r.rows[0].c) : null, ud = r.rows[0].u ? new Date(r.rows[0].u) : null;
        const dc = cd ? Math.round((new Date(t.rows[0].n) - cd) / 60000) : null;
        if (tbl === 'payments' && dc != null) global.__upstreamLagMin = dc;   // used in the verdict
        console.log(`  ${tbl.padEnd(19)} max(created_at)=${cd ? cd.toISOString().slice(0, 19) : '—'}Z  → ${dc == null ? '—' : (dc >= 0 ? dc + 'm behind now' : '\x1b[31m' + (-dc) + 'm AHEAD of now ← rows are excluded by the sync cutoff\x1b[0m')}`);
        if (ud) console.log(`  ${''.padEnd(19)} max(updated_at)=${ud.toISOString().slice(0, 19)}Z`);
        // how many rows would the sync's own window actually see right now?
        const w = await p.query(`SELECT count(*)::int n FROM ${tbl} WHERE created_at > now() - interval '3 hours' AND created_at <= now() - interval '2 minutes'`);
        console.log(`  ${''.padEnd(19)} rows the sync CAN see in its window (last 3h, minus 2m cutoff): ${w.rows[0].n}`);
      }
      await p.end();
    } catch (e) { console.log('  (prod check skipped: ' + e.message + ')'); try { await p.end(); } catch (_) {} }
  }

  await section('3. Live queries on the replica (running now)');
  const act = await src.query(`
    SELECT pid, state, round(extract(epoch from (now()-query_start))*1000) AS ms, left(regexp_replace(query,'\\s+',' ','g'),90) AS q
    FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()
    ORDER BY query_start LIMIT 8`);
  if (!act.rows.length) console.log('  (idle — nothing running)');
  for (const r of act.rows) console.log(`  ${String(r.ms).padStart(7)}ms ${String(r.state).padEnd(8)} ${r.q}`);

  const conn = await src.query(`SELECT count(*)::int AS used, current_setting('max_connections')::int AS max FROM pg_stat_activity`);
  console.log(`\n  connections: ${conn.rows[0].used} / ${conn.rows[0].max}`);
  await src.end();

  // ---------- 2. API endpoint timings ----------
  await section(`4. API endpoint timings (flagging > ${SLOW}ms)`);
  // NOTE: use the SAME params the UI sends (from/to or hours) — a wrong param name silently
  // falls back to the default window and makes a slow endpoint look fast.
  const iso = d => new Date(d).toISOString();
  const now = Date.now(), D = 24 * 3600e3;
  const r7 = `?from=${encodeURIComponent(iso(now - 7 * D))}&to=${encodeURIComponent(iso(now))}`;
  const r30 = `?from=${encodeURIComponent(iso(now - 30 * D))}&to=${encodeURIComponent(iso(now))}`;
  const EPS = [
    ['/api/health', ''],
    ['/api/home', '?hours=24'], ['/api/home', r7], ['/api/home', r30],   // ← what the range buttons call
    ['/api/funnel', r30], ['/api/onboarding-flow', r30],
    ['/api/journey-health', ''], ['/api/noc', ''], ['/api/anomalies', ''],
    ['/api/alerts', '?status=open'],
    ['/api/growth/summary', ''], ['/api/errors/summary', '?windowHours=24'],
    ['/api/sync-health', ''], ['/api/apigw/connectivity', ''],
  ];
  const call = (path) => new Promise(res => {
    const t0 = Date.now();
    const req = http.get({ host: '127.0.0.1', port: PORT, path, headers: { 'X-Console-User': process.env.CONSOLE_ADMIN_USER || '' } },
      r => { r.resume(); r.on('end', () => res({ ms: Date.now() - t0, code: r.statusCode })); });
    req.on('error', () => res({ ms: Date.now() - t0, code: 0 }));
    req.setTimeout(30000, () => { req.destroy(); res({ ms: Date.now() - t0, code: -1 }); });
  });
  const timings = [];
  for (const [p, q] of EPS) {
    const a = await call(p + q);          // 1st = cold (or already-warm cache)
    const b = await call(p + q);          // 2nd = should be served from the response cache
    const label = p + (q === r30 ? ' [30d]' : q === r7 ? ' [7d]' : q);
    timings.push({ p: label, ms: a.ms, ms2: b.ms, code: a.code });
  }
  const max = Math.max(...timings.map(t => t.ms));
  console.log('     1st       2nd(cached)');
  for (const t of timings) {
    const flag = t.code !== 200 ? `\x1b[31m[${t.code === -1 ? 'TIMEOUT' : t.code}]\x1b[0m` : (t.ms > SLOW ? '\x1b[33mSLOW\x1b[0m' : '    ');
    const gain = (t.ms > 400 && t.ms2 < t.ms / 3) ? '\x1b[32m✓cached\x1b[0m' : '';
    console.log(`  ${ms(t.ms).padStart(7)} ${ms(t.ms2).padStart(8)} ${flag} ${bar(t.ms, max, 18)} ${t.p} ${gain}`);
  }
  try {
    const cs = await new Promise(res => http.get({ host: '127.0.0.1', port: PORT, path: '/api/cache-stats' }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', () => res('')));
    if (cs) console.log('\n  response cache: ' + cs);
  } catch (e) {}

  // ---------- 3. verdict ----------
  await section('5. Verdict');
  // only flag endpoints that are slow AND stay slow when cached — a slow cold path that
  // serves in ms afterwards is fine (users hit the cache).
  const slow = timings.filter(t => t.ms > SLOW && t.ms2 > SLOW && t.code === 200);
  const coldOnly = timings.filter(t => t.ms > SLOW && t.ms2 <= SLOW && t.code === 200);
  if (coldOnly.length) console.log(`  ℹ ${coldOnly.length} endpoint(s) slow on first build but cached after: ${coldOnly.map(s => s.p).join(', ')}`);
  if (missing.length) console.log(`  ✗ ${missing.length} missing index(es) — run the CREATE INDEX lines in section 1. This is almost certainly the cause of slow pages.`);
  else console.log('  ✓ all created_at indexes present');
  if (slow.length) console.log(`  ✗ ${slow.length} slow endpoint(s): ${slow.map(s => s.p.split('?')[0]).join(', ')}`);
  else console.log(`  ✓ no endpoint slower than ${SLOW}ms`);
  const bad = timings.filter(t => t.code !== 200);
  if (bad.length) console.log(`  ✗ ${bad.length} endpoint(s) not returning 200: ${bad.map(b => b.p + ' → ' + b.code).join(', ')}`);
  if (global.__upstreamLagMin != null) {
    if (global.__upstreamLagMin > 60)
      console.log(`\n  \x1b[31m✗ UPSTREAM STALE: the prod source (${(process.env.PROD_DATABASE_URL || '').replace(/\/\/[^@]*@/, '//***@')}) is ${global.__upstreamLagMin}m behind its own clock.\x1b[0m` +
        `\n    Our sync is fine — it cannot pull rows the source never received. This is a DBA/replication issue.`);
    else console.log(`  ✓ upstream prod source is current (${global.__upstreamLagMin}m behind its own clock)`);
  }
  console.log('');
}
main().catch(e => { console.error('healthcheck failed:', e.message); process.exit(1); });
