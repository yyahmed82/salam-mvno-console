/* cstOracle.js — Arqami live connector (16 Sep 2026): reads the audit table of the number-ownership API in Oracle EBPROD
 * (APPS.YY_REGISTER_NUMBER_AUDIT — one row per request: REQUEST_TIME, SUCCESS 'Y'/other, DURATION_MS) and keeps the console
 * read model cst_arqami_minutes (one row per KSA minute) filled:
 *
 *   backfill(days)   per-day aggregation for the last N days that have no Oracle rows yet (history → daily traffic)
 *   poll()           every CST_ORACLE_POLL_SEC (60 s) re-aggregates the last CST_ORACLE_POLL_WINDOW_MIN (12) minutes
 *                    by Oracle's own clock (SYSDATE) — no time-zone guesswork, the partial current minute is overwritten
 *                    on the next poll
 *   refreshDay(day)  full re-aggregation of one day (the "Refresh" button, and the hourly self-heal of today)
 *
 * The aggregation is exactly the operator's DBeaver query:
 *   TO_CHAR(TRUNC(CAST(REQUEST_TIME AS DATE),'MI'),'HH24:MI'), COUNT(*), SUM(SUCCESS='Y'), SUM(SUCCESS<>'Y'), ROUND(AVG(DURATION_MS)), MAX(DURATION_MS)
 *
 * Backends (CST_ORACLE_MODE = jdbc | oracledb, auto = jdbc when the bridge is compiled and Java is present):
 *   jdbc     EBPROD is Oracle 9i (9.2.0.6): no current native client connects to it (thin needs 12.1+, Instant Client 21/23 need
 *            11.2.0.4+, the 11.2 client is no longer a public download) — Oracle's JDBC driver still does, which is how DBeaver
 *            gets in. So one long-lived JVM (server/jdbc/ArqamiBridge.java + ojdbc11.jar, Temurin JDK under CST_ORACLE_JAVA)
 *            runs beside Node and executes the same read-only SELECTs over stdin / stdout. ~120 MB RSS, one connection.
 *   oracledb node-oracledb for 12.1+ servers (thin) or with an Instant Client under CST_ORACLE_CLIENT_DIR (thick, 11.2+).
 * Credentials live ONLY in /apps/unified/.env:
 *   CST_ORACLE_HOST=172.31.1.42  CST_ORACLE_PORT=1521  CST_ORACLE_SERVICE=EBPROD  CST_ORACLE_USER=apps  CST_ORACLE_PASSWORD=…
 *   optional: CST_ORACLE_TABLE (APPS.YY_REGISTER_NUMBER_AUDIT) · CST_ORACLE_TIME_COL (REQUEST_TIME) · CST_ORACLE_SUCCESS_COL (SUCCESS)
 *             CST_ORACLE_DURATION_COL (DURATION_MS) · CST_ORACLE_BACKFILL_DAYS (30) · CST_ORACLE_POLL_SEC (60) · CST_ORACLE_POLL_WINDOW_MIN (12)
 *             CST_ORACLE_DISABLED=1 to keep the connector off without touching the credentials
 * Nothing is written to Oracle: the pool opens read-only sessions and every statement is a SELECT. */
'use strict';
const db = require('./db');

const E = process.env;
const C = () => db.console;
const n = v => Number(v) || 0;
const KSA = 3 * 3600e3;
const todayKsa = () => new Date(Date.now() + KSA).toISOString().slice(0, 10);
const ident = (v, d) => { const s = String(v || d).trim(); if (!/^[A-Za-z0-9_$.]+$/.test(s)) throw new Error('bad identifier in CST_ORACLE_* env: ' + s); return s; };

const cfg = () => ({
  host: E.CST_ORACLE_HOST || '', port: n(E.CST_ORACLE_PORT) || 1521, service: E.CST_ORACLE_SERVICE || '', user: E.CST_ORACLE_USER || '', password: E.CST_ORACLE_PASSWORD || '',
  table: E.CST_ORACLE_TABLE || 'APPS.YY_REGISTER_NUMBER_AUDIT', timeCol: E.CST_ORACLE_TIME_COL || 'REQUEST_TIME', okCol: E.CST_ORACLE_SUCCESS_COL || 'SUCCESS', durCol: E.CST_ORACLE_DURATION_COL || 'DURATION_MS',
  backfillDays: Math.min(365, n(E.CST_ORACLE_BACKFILL_DAYS) || 30), pollSec: Math.max(20, n(E.CST_ORACLE_POLL_SEC) || 60), windowMin: Math.max(3, n(E.CST_ORACLE_POLL_WINDOW_MIN) || 12),
  disabled: /^(1|true|yes)$/i.test(E.CST_ORACLE_DISABLED || ''),
  clientDir: E.CST_ORACLE_CLIENT_DIR || '/opt/oracle/instantclient_21_23',
  mode: (E.CST_ORACLE_MODE || 'auto').toLowerCase(), java: E.CST_ORACLE_JAVA || '/opt/java/bin/java', jdbcDir: E.CST_ORACLE_JDBC_DIR || require('path').join(__dirname, '..', 'jdbc'),
  connect: E.CST_ORACLE_CONNECT || 'service',
});
const configured = () => { const c = cfg(); return !!(c.host && c.service && c.user && c.password) && !c.disabled; };

/* ---------------------------------------------------------------- state (exposed on /api/cst/arqami/source) */
const state = { backend: null, driver: null, driverError: null, mode: null, clientError: null, pool: null, jvm: null, jvmInfo: null, jvmRestarts: 0, lastPoll: null, lastPollMs: null, lastPollRows: 0, lastError: null, lastErrorAt: null, polls: 0, backfill: null, timer: null, healTimer: null, busy: false };

function driver() {
  if (state.driver || state.driverError) return state.driver;
  try { state.driver = require('oracledb'); state.driver.outFormat = state.driver.OUT_FORMAT_OBJECT; state.driver.fetchAsString = []; }
  catch (e) { state.driverError = 'oracledb driver not installed in server/node_modules (deploy with --full): ' + e.message; return null; }
  /* thick mode when the Instant Client is present (EBPROD 11g rejects thin mode with NJS-138) */
  const dir = cfg().clientDir;
  if (dir && require('fs').existsSync(dir)) {
    try { state.driver.initOracleClient({ libDir: dir }); state.mode = 'thick ' + dir; }
    catch (e) { state.clientError = 'Instant Client at ' + dir + ' could not be loaded (libaio missing?): ' + e.message; state.mode = 'thin (thick init failed)'; console.error('[cst-oracle]', state.clientError); }
  } else state.mode = 'thin (no Instant Client at ' + dir + ')';
  return state.driver;
}
async function pool() {
  if (state.pool) return state.pool;
  const o = driver(); if (!o) throw new Error(state.driverError);
  const c = cfg();
  state.pool = await o.createPool({ user: c.user, password: c.password, connectString: `${c.host}:${c.port}/${c.service}`, poolMin: 0, poolMax: 2, poolIncrement: 1, poolTimeout: 120, queueTimeout: 30000, homogeneous: true });
  return state.pool;
}
async function withConn(fn, timeoutMs) {
  const p = await pool();
  const conn = await p.getConnection();
  try { conn.callTimeout = timeoutMs || 30000; return await fn(conn); }
  finally { try { await conn.close(); } catch (_) { /* pool handles it */ } }
}

/* ---------------------------------------------------------------- JDBC bridge (Oracle 9i path) */
const fs = require('fs'), path = require('path');
function jdbcReady() { const c = cfg(); return fs.existsSync(path.join(c.jdbcDir, 'ArqamiBridge.class')) && fs.existsSync(c.java) && fs.readdirSync(c.jdbcDir).some(f => /^ojdbc.*\.jar$/.test(f)); }
function backend() {
  if (state.backend) return state.backend;
  const c = cfg();
  state.backend = c.mode === 'jdbc' ? 'jdbc' : c.mode === 'oracledb' ? 'oracledb' : jdbcReady() ? 'jdbc' : 'oracledb';
  if (state.backend === 'jdbc') state.mode = 'jdbc bridge (' + c.java + ', ' + c.jdbcDir + ')';
  return state.backend;
}
const jvm = { proc: null, pending: new Map(), seq: 0, buf: '', starting: null };
function jvmStart() {
  if (jvm.proc) return Promise.resolve(jvm.proc);
  if (jvm.starting) return jvm.starting;
  const c = cfg();
  const jar = fs.readdirSync(c.jdbcDir).filter(f => /^ojdbc.*\.jar$/.test(f)).sort().pop();
  if (!jar) return Promise.reject(new Error('no ojdbc*.jar in ' + c.jdbcDir));
  jvm.starting = new Promise((ok, ko) => {
    const cp = require('child_process');
    const p = cp.spawn(c.java, ['-Xmx160m', '-XX:+UseSerialGC', '-Djava.awt.headless=true', '-cp', path.join(c.jdbcDir, jar) + ':' + c.jdbcDir, 'ArqamiBridge'],
      { env: Object.assign({}, process.env, { CST_ORACLE_HOST: c.host, CST_ORACLE_PORT: String(c.port), CST_ORACLE_SERVICE: c.service, CST_ORACLE_USER: c.user, CST_ORACLE_PASSWORD: c.password, CST_ORACLE_CONNECT: c.connect, JAVA_TOOL_OPTIONS: '' }), stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', chunk => {
      jvm.buf += chunk; let i;
      while ((i = jvm.buf.indexOf('\n')) >= 0) {
        const line = jvm.buf.slice(0, i).trim(); jvm.buf = jvm.buf.slice(i + 1); if (!line) continue;
        let m; try { m = JSON.parse(line); } catch (_) { console.error('[cst-oracle] bridge: bad line', line.slice(0, 200)); continue; }
        if (m.ready) { state.jvmInfo = { url: m.url, java: m.java, since: new Date().toISOString() }; if (!settled) { settled = true; ok(p); } continue; }
        const w = jvm.pending.get(String(m.id)); if (!w) continue; jvm.pending.delete(String(m.id)); clearTimeout(w.t);
        if (m.error) w.ko(new Error(m.error)); else w.ok(m);
      }
    });
    p.stderr.setEncoding('utf8'); p.stderr.on('data', d => { const t = String(d).trim(); if (t) console.error('[cst-oracle] bridge:', t.slice(0, 300)); });
    p.on('exit', (code, sig) => {
      console.error(`[cst-oracle] bridge exited (${code === null ? sig : code})`); jvm.proc = null; jvm.starting = null; state.jvm = null; state.jvmRestarts++;
      for (const [, w] of jvm.pending) { clearTimeout(w.t); w.ko(new Error('bridge exited')); } jvm.pending.clear();
      if (!settled) { settled = true; ko(new Error('bridge exited before it was ready (code ' + code + ')')); }
    });
    p.on('error', e => { if (!settled) { settled = true; ko(e); } });
    jvm.proc = p; state.jvm = { pid: p.pid };
    setTimeout(() => { if (!settled) { settled = true; ko(new Error('bridge did not become ready in 30 s')); try { p.kill(); } catch (_) {} } }, 30000);
  }).finally(() => { jvm.starting = null; });
  return jvm.starting;
}
const b64 = v => Buffer.from(String(v), 'utf8').toString('base64');
async function jdbcQuery(sql, binds, timeoutMs) {
  const p = await jvmStart();
  const id = String(++jvm.seq);
  const line = [id, b64(sql)].concat((binds || []).map(v => v == null ? 'null' : typeof v === 'number' ? 'n:' + v : 's:' + b64(v))).join('\t') + '\n';
  return new Promise((ok, ko) => {
    const t = setTimeout(() => { jvm.pending.delete(id); ko(new Error('bridge query timed out after ' + timeoutMs + ' ms')); try { p.kill(); } catch (_) {} }, timeoutMs || 30000);
    jvm.pending.set(id, { ok, ko, t });
    p.stdin.write(line, e => { if (e) { clearTimeout(t); jvm.pending.delete(id); ko(e); } });
  });
}
function jvmStop() { if (jvm.proc) { try { jvm.proc.stdin.end(); jvm.proc.kill(); } catch (_) {} } }

/* one entry point for every statement: SQL with ? placeholders + positional binds → rows with UPPERCASE keys */
async function query(sql, binds, timeoutMs) {
  if (backend() === 'jdbc') return (await jdbcQuery(sql, binds, timeoutMs)).rows;
  let k = 0; const named = sql.replace(/\?/g, () => ':' + (++k));
  return withConn(async conn => (await conn.execute(named, binds || [])).rows, timeoutMs);
}

/* ---------------------------------------------------------------- Oracle → minute rows */
function aggSql(where) {
  const c = cfg(); const t = ident(c.table), tc = ident(c.timeCol), ok = ident(c.okCol), du = ident(c.durCol);
  return `SELECT TO_CHAR(TRUNC(CAST(${tc} AS DATE)), 'YYYY-MM-DD') AS DAY,
                 TO_CHAR(TRUNC(CAST(${tc} AS DATE), 'MI'), 'HH24:MI') AS MINUTE_SLOT,
                 COUNT(*) AS REQUESTS,
                 SUM(CASE WHEN ${ok} = 'Y' THEN 1 ELSE 0 END) AS SUCCESS,
                 SUM(CASE WHEN ${ok} = 'Y' THEN 0 ELSE 1 END) AS FAILED,
                 ROUND(AVG(${du})) AS AVG_MS,
                 MAX(${du}) AS MAX_MS
          FROM ${t}
          WHERE ${where}
          GROUP BY TRUNC(CAST(${tc} AS DATE)), TRUNC(CAST(${tc} AS DATE), 'MI')
          ORDER BY 1, 2`;
}
const rowsOf = r => (r.rows || []).map(x => ({ day: x.DAY, slot: x.MINUTE_SLOT, requests: n(x.REQUESTS), success: n(x.SUCCESS), failed: n(x.FAILED), avg_ms: x.AVG_MS == null ? null : n(x.AVG_MS), max_ms: x.MAX_MS == null ? null : n(x.MAX_MS) }));

/* one KSA calendar day, by the table's own clock */
async function fetchDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('day must be YYYY-MM-DD');
  const tc = ident(cfg().timeCol);
  return rowsOf({ rows: await query(aggSql(`${tc} >= TO_DATE(?, 'YYYY-MM-DD') AND ${tc} < TO_DATE(?, 'YYYY-MM-DD') + 1`), [day, day], 180000) });
}
/* the last N minutes by Oracle's SYSDATE — crosses midnight correctly because DAY comes from the row */
async function fetchRecent(minutes) {
  const tc = ident(cfg().timeCol);
  return rowsOf({ rows: await query(aggSql(`${tc} >= SYSDATE - ? / 1440`), [Number(minutes)], 40000) });
}
/* what the table looks like — used by the source card and the deploy verification */
async function probe() {
  const c = cfg(); const t = ident(c.table), tc = ident(c.timeCol);
  const v = await query(`SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS') AS NOW_TXT, SYS_CONTEXT('USERENV', 'DB_NAME') AS DB, (SELECT banner FROM v$version WHERE rownum = 1) AS VER FROM DUAL`, [], 30000);
  const last = await query(`SELECT TO_CHAR(MAX(${tc}), 'YYYY-MM-DD HH24:MI:SS') AS LAST_, COUNT(*) AS TODAY_ROWS FROM ${t} WHERE ${tc} >= TRUNC(SYSDATE)`, [], 60000);
  return { db: v[0].DB, version: v[0].VER, oracleNow: v[0].NOW_TXT, lastRequest: last[0].LAST_, todayRows: n(last[0].TODAY_ROWS), backend: backend() };
}

/* ---------------------------------------------------------------- minute rows → console DB */
async function upsert(rows, source) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  let ins = 0, upd = 0;
  const c = await C().connect();
  try {
    await c.query('BEGIN');
    for (const r of rows) {
      const x = await c.query(`INSERT INTO cst_arqami_minutes (day, slot, requests, success, failed, avg_ms, max_ms, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (day, slot) DO UPDATE SET requests = EXCLUDED.requests, success = EXCLUDED.success, failed = EXCLUDED.failed, avg_ms = EXCLUDED.avg_ms, max_ms = EXCLUDED.max_ms, source = EXCLUDED.source, imported_at = now()
        RETURNING (xmax = 0) AS inserted`, [r.day, r.slot, r.requests, r.success, r.failed, r.avg_ms, r.max_ms, source || 'oracle']);
      if (x.rows[0].inserted) ins++; else upd++;
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  return { inserted: ins, updated: upd };
}

/* ---------------------------------------------------------------- jobs */
async function refreshDay(day) {
  const t0 = Date.now(); const rows = await fetchDay(day); const u = await upsert(rows, 'oracle');
  await C().query(`INSERT INTO cst_imports (kind, name, rows, inserted, updated, by_user) VALUES ('arqami', $1, $2, $3, $4, 'oracle')`, [`oracle ${day}`, rows.length, u.inserted, u.updated]).catch(() => {});
  return { day, minutes: rows.length, requests: rows.reduce((s, r) => s + r.requests, 0), ...u, ms: Date.now() - t0 };
}
async function poll() {
  if (!configured() || state.busy) return null;
  state.busy = true; const t0 = Date.now();
  try {
    const rows = await fetchRecent(cfg().windowMin);
    const u = await upsert(rows, 'oracle');
    state.lastPoll = new Date().toISOString(); state.lastPollMs = Date.now() - t0; state.lastPollRows = rows.length; state.lastError = null; state.polls++;
    return { rows: rows.length, ...u, ms: state.lastPollMs };
  } catch (e) { state.lastError = e.message; state.lastErrorAt = new Date().toISOString(); console.error('[cst-oracle] poll:', e.message); return null; }
  finally { state.busy = false; }
}
/* history: every day of the window that has no Oracle row yet (CSV-imported days are re-read from the source of truth too) */
async function backfill(days, opts) {
  const o = opts || {}; const want = Math.min(365, Math.max(1, n(days) || cfg().backfillDays));
  if (state.backfill && state.backfill.running) return state.backfill;
  const today = todayKsa(); const list = [];
  for (let i = want; i >= 0; i--) list.push(new Date(new Date(today).getTime() - i * 864e5).toISOString().slice(0, 10));
  const have = o.force ? new Set() : new Set((await C().query(`SELECT day::text AS d FROM cst_arqami_minutes WHERE source = 'oracle' AND day < $1 GROUP BY 1 HAVING count(*) >= 1000`, [today])).rows.map(r => r.d));
  const todo = list.filter(d => !have.has(d));
  const job = state.backfill = { running: true, startedAt: new Date().toISOString(), days: todo.length, done: 0, minutes: 0, requests: 0, current: null, errors: [], finishedAt: null };
  (async () => {
    for (const d of todo) {
      job.current = d;
      try { const r = await refreshDay(d); job.minutes += r.minutes; job.requests += r.requests; console.log(`[cst-oracle] backfill ${d}: ${r.minutes} minutes · ${r.requests} requests · ${r.ms} ms`); }
      catch (e) { job.errors.push({ day: d, error: e.message }); console.error(`[cst-oracle] backfill ${d}:`, e.message); if (job.errors.length >= 3) break; }
      job.done++;
      await new Promise(r => setTimeout(r, 400));   // be gentle with EBPROD
    }
    job.running = false; job.current = null; job.finishedAt = new Date().toISOString();
  })();
  return job;
}

function status() {
  const c = cfg();
  const be = configured() ? backend() : null;
  return { configured: configured(), disabled: c.disabled, backend: be, driver: be === 'jdbc' ? jdbcReady() : !!driver(), driverError: be === 'jdbc' ? (jdbcReady() ? null : `JDBC bridge not ready: need ${c.java}, ${c.jdbcDir}/ArqamiBridge.class and ojdbc*.jar`) : state.driverError, mode: state.mode, clientError: state.clientError, jvm: state.jvm, jvmInfo: state.jvmInfo, jvmRestarts: state.jvmRestarts, host: c.host, port: c.port, service: c.service, user: c.user, table: c.table,
    columns: { time: c.timeCol, success: c.okCol, duration: c.durCol }, pollSec: c.pollSec, windowMin: c.windowMin, backfillDays: c.backfillDays,
    lastPoll: state.lastPoll, lastPollMs: state.lastPollMs, lastPollRows: state.lastPollRows, polls: state.polls, lastError: state.lastError, lastErrorAt: state.lastErrorAt, backfill: state.backfill, busy: state.busy };
}

function start() {
  if (!configured()) { console.log(`[cst-oracle] not configured (${cfg().disabled ? 'CST_ORACLE_DISABLED=1' : 'CST_ORACLE_HOST / SERVICE / USER / PASSWORD missing in .env'}) — Arqami stays on CSV imports`); return; }
  if (backend() === 'jdbc') { if (!jdbcReady()) { console.error('[cst-oracle] JDBC bridge not ready:', status().driverError); return; } }
  else if (!driver()) { console.error('[cst-oracle]', state.driverError); return; }
  const c = cfg();
  process.on('exit', jvmStop);
  console.log(`[cst-oracle] ${c.user}@${c.host}:${c.port}/${c.service} ${c.table} — ${state.mode} — poll every ${c.pollSec} s (window ${c.windowMin} min), backfill ${c.backfillDays} days`);
  setTimeout(() => { poll().then(() => backfill(c.backfillDays)).catch(e => console.error('[cst-oracle] start:', e.message)); }, 8000);
  state.timer = setInterval(() => poll(), c.pollSec * 1000);
  state.healTimer = setInterval(() => { if (!state.busy && !(state.backfill && state.backfill.running)) refreshDay(todayKsa()).catch(e => console.error('[cst-oracle] heal:', e.message)); }, 3600e3);   // hourly full re-read of today
  if (state.timer.unref) state.timer.unref(); if (state.healTimer.unref) state.healTimer.unref();
}

module.exports = { start, poll, backfill, refreshDay, fetchDay, probe, status, configured, query };
