/* cstRemedy.js — CST Escalations live connector (17 Sep 2026): read-only access to the Remedy AR System database
 * (SQL Server 172.30.1.14:1433 / ARSystem), the source of every CST ticket Salam answers.
 *
 * WHAT IT READS. `ITC_CITC_MOH` — the integration view CST itself is served from: a UNION ALL of HPD_Help_Desk
 * (incidents) and WOI_WorkOrder (work orders), both filtered `Trouble_Ticket_Types = N'CTT'`, keyed
 * `SRID AS Service_RequestID`. That is the same REQ number the RA export calls «رقم الشكوى لدى مقدم الخدمة»,
 * so console figures and CST's own figures are comparable line for line. `ITC_CITC_MOH_NEW` / `_now` (the DBA
 * team's de-duplicated rebuild) can be read instead by changing CST_REMEDY_VIEW — nothing here hard-codes it.
 *
 * WHY A JDBC BRIDGE. 152 has no internet, so every dependency ships by hand. The Node route (mssql → tedious)
 * hard-requires the @azure/identity tree even for SQL authentication — 67 MB into server/node_modules — while
 * Microsoft's JDBC driver is one 1.5 MB jar beside the ojdbc11 the Arqami bridge already uses. So this module
 * runs `server/jdbc/RemedyBridge.java` in a small JVM and speaks the same line protocol as cstOracle.js.
 *
 * PROD SAFETY (this is the live Remedy database — read-only for this work):
 *  · SELECT / WITH only, refused in the bridge before it reaches SQL Server.
 *  · READ UNCOMMITTED session (CST_REMEDY_NOLOCK=0 to disable): a console query must never take shared locks on
 *    tables the Remedy application is writing to.
 *  · Query timeout (CST_REMEDY_QUERY_SECS, 60 s), row caps on every call, one JVM, one connection.
 *  · NOTHING IS WRITTEN TO THE CONSOLE DATABASE FROM HERE. Ticket rows are read, answered and dropped; only the
 *    non-PII aggregates computed elsewhere are stored. Customer identifiers never land in unified_console.
 *  · Identifier searches are an explicit operator action and are audited by the route, never run on a timer.
 *
 * Env (secrets only in /apps/unified/.env):
 *   CST_REMEDY_HOST=172.30.1.14 · CST_REMEDY_PORT=1433 · CST_REMEDY_DATABASE=ARSystem
 *   CST_REMEDY_USER · CST_REMEDY_PASSWORD
 *   optional: CST_REMEDY_VIEW (dbo.ITC_CITC_MOH) · CST_REMEDY_MAP_TABLE (dbo.CITC_SDM_CODE_MAPPING)
 *             CST_REMEDY_JAVA (/opt/java/bin/java) · CST_REMEDY_JDBC_DIR (server/jdbc) · CST_REMEDY_QUERY_SECS (60)
 *             CST_REMEDY_NOLOCK=0 · CST_REMEDY_JDBC_EXTRA (appended to the URL) · CST_REMEDY_JDBC_URL (whole URL)
 *             CST_REMEDY_DISABLED=1 to keep the connector off without touching the credentials */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), net = require('net');

const E = process.env;
const n = v => Number(v) || 0;

const cfg = () => ({
  host: E.CST_REMEDY_HOST || '', port: n(E.CST_REMEDY_PORT) || 1433, database: E.CST_REMEDY_DATABASE || 'ARSystem',
  user: E.CST_REMEDY_USER || '', password: E.CST_REMEDY_PASSWORD || '',
  view: E.CST_REMEDY_VIEW || 'dbo.ITC_CITC_MOH', mapTable: E.CST_REMEDY_MAP_TABLE || 'dbo.CITC_SDM_CODE_MAPPING',
  java: E.CST_REMEDY_JAVA || E.CST_ORACLE_JAVA || '/opt/java/bin/java',
  jdbcDir: E.CST_REMEDY_JDBC_DIR || path.join(__dirname, '..', 'jdbc'),
  querySecs: Math.max(5, n(E.CST_REMEDY_QUERY_SECS) || 60),
  nolock: E.CST_REMEDY_NOLOCK !== '0',
  jdbcExtra: E.CST_REMEDY_JDBC_EXTRA || '', jdbcUrl: E.CST_REMEDY_JDBC_URL || '',
  disabled: /^(1|true|yes)$/i.test(E.CST_REMEDY_DISABLED || '')
});
const configured = () => { const c = cfg(); return !!((c.jdbcUrl || (c.host && c.database)) && c.user) && !c.disabled; };
/* a table / view name from .env reaches the SQL text, so it is charset-limited here — binds cannot carry an identifier */
function ident(v, d) {
  const s = String(v || d).trim();
  if (!/^[A-Za-z0-9_$.\[\]]+$/.test(s)) throw new Error('bad identifier in CST_REMEDY_* env: ' + s);
  return s;
}
const splitName = t => { const p = String(t).replace(/[\[\]]/g, '').split('.'); return p.length > 1 ? { schema: p[0], name: p.slice(1).join('.') } : { schema: 'dbo', name: p[0] }; };

const state = { tcp: null, jvm: null, jvmInfo: null, jvmRestarts: 0, lastError: null, lastErrorAt: null, lastQueryMs: null, queries: 0, lastQueryAt: null, columns: null, columnsAt: null };

/* TCP PREFLIGHT. 152 and Remedy sit in different network zones, and the first live attempt found 1433 filtered.
 * A JDBC connect in that state spends its whole login timeout and then reports a driver error that reads like a
 * credentials problem. So the port is tested first and a closed path is reported as exactly that — the console
 * says the firewall has not been opened, instead of showing a stack trace to whoever opens the page. */
function reachable(timeoutMs = 4000) {
  const c = cfg();
  return new Promise(resolve => {
    const t0 = Date.now(), target = `${c.host}:${c.port}`;
    const done = (ok, error) => { state.tcp = { ok, ms: Date.now() - t0, target, error: error || null, at: new Date().toISOString() }; resolve(state.tcp); };
    if (!c.host) return done(false, 'CST_REMEDY_HOST is not set');
    let s;
    try { s = net.connect({ host: c.host, port: c.port }); } catch (e) { return done(false, e.message); }
    const end = (ok, err) => { try { s.destroy(); } catch (_) {} done(ok, err); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => end(true, null));
    s.once('timeout', () => end(false, `no answer from ${target} within ${timeoutMs} ms — the port is filtered by a firewall between this host and Remedy, not refused`));
    s.once('error', e => end(false, e.code === 'ECONNREFUSED' ? `${target} refused the connection — the host is reachable but nothing is listening on that port`
      : (e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH') ? `no route from this host to ${target}`
      : `${e.code || ''} ${e.message}`.trim()));
  });
}

/* ---------------------------------------------------------------- the JVM bridge (same protocol as cstOracle) */
const jvm = { proc: null, pending: new Map(), seq: 0, buf: '', starting: null };
function jarPath() {
  const dir = cfg().jdbcDir;
  let files = []; try { files = fs.readdirSync(dir); } catch (e) { throw new Error('jdbc directory not found: ' + dir); }
  const jar = files.filter(f => /^mssql-jdbc.*\.jar$/i.test(f)).sort().pop();
  if (!jar) throw new Error('no mssql-jdbc*.jar in ' + dir + ' — copy the Microsoft JDBC driver there (once, like ojdbc11)');
  return path.join(dir, jar);
}
const ready = () => { try { return !!jarPath() && fs.existsSync(cfg().java) && fs.existsSync(path.join(cfg().jdbcDir, 'RemedyBridge.class')); } catch (e) { return false; } };
function why() {
  const c = cfg();
  const out = [];
  try { jarPath(); } catch (e) { out.push(e.message); }
  if (!fs.existsSync(c.java)) out.push('java not found at ' + c.java);
  if (!fs.existsSync(path.join(c.jdbcDir, 'RemedyBridge.class'))) out.push('RemedyBridge.class not compiled in ' + c.jdbcDir + ' (deploy compiles it when the jar is present)');
  return out;
}

function jvmStart() {
  if (jvm.proc) return Promise.resolve(jvm.proc);
  if (jvm.starting) return jvm.starting;
  const c = cfg();
  jvm.starting = new Promise((ok, ko) => {
    let jar; try { jar = jarPath(); } catch (e) { return ko(e); }
    const env = Object.assign({}, process.env, {
      CST_REMEDY_HOST: c.host, CST_REMEDY_PORT: String(c.port), CST_REMEDY_DATABASE: c.database,
      CST_REMEDY_USER: c.user, CST_REMEDY_PASSWORD: c.password, CST_REMEDY_QUERY_SECS: String(c.querySecs),
      CST_REMEDY_NOLOCK: c.nolock ? '1' : '0', CST_REMEDY_JDBC_EXTRA: c.jdbcExtra, CST_REMEDY_JDBC_URL: c.jdbcUrl
    });
    delete env.JAVA_TOOL_OPTIONS;                       // an empty value still makes the JVM print a line on stderr
    const p = cp.spawn(c.java, ['-Xmx160m', '-XX:+UseSerialGC', '-Djava.awt.headless=true', '-cp', jar + ':' + c.jdbcDir, 'RemedyBridge'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', chunk => {
      jvm.buf += chunk; let i;
      while ((i = jvm.buf.indexOf('\n')) >= 0) {
        const line = jvm.buf.slice(0, i).trim(); jvm.buf = jvm.buf.slice(i + 1); if (!line) continue;
        let m; try { m = JSON.parse(line); } catch (_) { console.error('[cst-remedy] bridge: bad line', line.slice(0, 200)); continue; }
        if (m.ready) { state.jvmInfo = { url: m.url, java: m.java, nolock: m.nolock, querySecs: m.querySecs, since: new Date().toISOString() }; if (!settled) { settled = true; ok(p); } continue; }
        const w = jvm.pending.get(String(m.id)); if (!w) continue; jvm.pending.delete(String(m.id)); clearTimeout(w.t);
        if (m.error) w.ko(new Error(m.error)); else w.ok(m);
      }
    });
    p.stderr.setEncoding('utf8'); p.stderr.on('data', d => { const t = String(d).trim(); if (t) console.error('[cst-remedy] bridge:', t.slice(0, 300)); });
    p.on('exit', (code, sig) => {
      console.error(`[cst-remedy] bridge exited (${code === null ? sig : code})`); jvm.proc = null; jvm.starting = null; state.jvm = null; state.jvmRestarts++;
      for (const [, w] of jvm.pending) { clearTimeout(w.t); w.ko(new Error('bridge exited')); } jvm.pending.clear();
      if (!settled) { settled = true; ko(new Error('bridge exited before it was ready (code ' + code + ')')); }
    });
    p.on('error', e => { if (!settled) { settled = true; ko(e); } });
    jvm.proc = p; state.jvm = { pid: p.pid };
    setTimeout(() => { if (!settled) { settled = true; ko(new Error('bridge did not become ready in 30 s')); try { p.kill(); } catch (_) {} } }, 30000);
  }).finally(() => { jvm.starting = null; });
  return jvm.starting;
}
function stop() { if (jvm.proc) { try { jvm.proc.stdin.end(); jvm.proc.kill(); } catch (_) {} } }

const b64 = v => Buffer.from(String(v), 'utf8').toString('base64');
/* one entry point for every statement: SQL with ? placeholders + positional binds → rows with UPPERCASE keys */
async function query(sql, binds, timeoutMs) {
  if (!configured()) throw new Error('Remedy connector not configured (CST_REMEDY_* in .env)');
  const ms = timeoutMs || (cfg().querySecs + 10) * 1000;
  const p = await jvmStart();
  const id = String(++jvm.seq);
  const line = [id, b64(sql)].concat((binds || []).map(v => v == null ? 'null' : typeof v === 'number' ? 'n:' + v : 's:' + b64(v))).join('\t') + '\n';
  const t0 = Date.now();
  try {
    const m = await new Promise((ok, ko) => {
      const t = setTimeout(() => { jvm.pending.delete(id); ko(new Error('Remedy query timed out after ' + ms + ' ms')); }, ms);
      jvm.pending.set(id, { ok, ko, t });
      p.stdin.write(line, e => { if (e) { clearTimeout(t); jvm.pending.delete(id); ko(e); } });
    });
    state.queries++; state.lastQueryMs = m.ms != null ? m.ms : Date.now() - t0; state.lastQueryAt = new Date().toISOString();
    return m.rows || [];
  } catch (e) {
    state.lastError = String(e.message || e).slice(0, 300); state.lastErrorAt = new Date().toISOString();
    throw e;
  }
}

/* ---------------------------------------------------------------- what is actually there
 * The console does not guess Remedy's column names: it asks. `columns()` caches the view's real shape for an
 * hour, and every query built later resolves its columns against that list, so a rename in ARSystem shows up as
 * a named missing column instead of a broken SQL statement. */
async function columns(table) {
  const t = splitName(ident(table || cfg().view));
  const rows = await query(
    `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [t.schema, t.name]);
  return rows.map(r => ({ name: r.COLUMN_NAME, type: r.DATA_TYPE, len: r.CHARACTER_MAXIMUM_LENGTH, pos: r.ORDINAL_POSITION }));
}
async function viewColumns(force) {
  if (!force && state.columns && Date.now() - new Date(state.columnsAt).getTime() < 3600e3) return state.columns;
  const cols = await columns(cfg().view);
  state.columns = cols; state.columnsAt = new Date().toISOString();
  return cols;
}
/* pick the first column that exists, by exact name then by a loose match — how every later query finds its keys */
function pick(cols, candidates) {
  const names = cols.map(c => c.name);
  const low = names.map(x => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const cand of candidates) {
    const k = String(cand).toLowerCase().replace(/[^a-z0-9]/g, '');
    const i = low.indexOf(k);
    if (i >= 0) return names[i];
  }
  for (const cand of candidates) {
    const k = String(cand).toLowerCase().replace(/[^a-z0-9]/g, '');
    const i = low.findIndex(x => x.includes(k));
    if (i >= 0) return names[i];
  }
  return null;
}

/* PROBE — the first thing to run after the credentials are in place. Metadata only by default (instant);
 * `deep` adds the counts, which read the view itself and can take seconds on a busy Remedy. */
async function probe({ deep = false } = {}) {
  const c = cfg();
  const out = { view: c.view, database: c.database, at: new Date().toISOString() };
  /* the network first: no point starting a JVM and burning a login timeout on a path that is not open */
  if (!c.jdbcUrl) {
    const tcp = await reachable();
    out.tcp = tcp;
    if (!tcp.ok) return Object.assign(out, { ok: false, blocked: true,
      error: `cannot reach ${tcp.target}: ${tcp.error}`,
      next: `open TCP ${c.port} from this host to ${c.host} (the Remedy AR System database) — until then the page stays on the runbook snapshot` });
  }
  const t0 = Date.now();
  const v = await query(`SELECT @@VERSION AS VERSION, DB_NAME() AS DB, SUSER_SNAME() AS LOGIN_NAME, GETDATE() AS SERVER_TIME`, [], 30000);
  out.server = v[0] ? String(v[0].VERSION || '').split('\n')[0] : null;
  out.db = v[0] && v[0].DB; out.login = v[0] && v[0].LOGIN_NAME; out.serverTime = v[0] && v[0].SERVER_TIME;
  out.connectMs = Date.now() - t0;
  out.objects = (await query(
    `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE 'ITC[_]CITC[_]MOH%' OR TABLE_NAME LIKE 'CITC[_]SDM%' ORDER BY TABLE_NAME`, [], 30000))
    .map(r => ({ schema: r.TABLE_SCHEMA, name: r.TABLE_NAME, type: r.TABLE_TYPE }));
  out.columns = await viewColumns(true);
  try { out.mapColumns = await columns(c.mapTable); } catch (e) { out.mapColumnsError = e.message; }
  if (deep) {
    const cols = out.columns;
    const key = pick(cols, ['Service_RequestID', 'SRID', 'Service_Request_ID', 'RequestID']);
    const date = pick(cols, ['Submit_Date', 'Create_Date', 'Reported_Date', 'Submitted_Date', 'CreateDate']);
    out.keyColumn = key; out.dateColumn = date;
    const view = ident(c.view);
    const t1 = Date.now();
    const cnt = await query(`SELECT COUNT(*) AS N${key ? `, COUNT(DISTINCT ${ident(key)}) AS DISTINCT_KEYS` : ''}${date ? `, MIN(${ident(date)}) AS FIRST_AT, MAX(${ident(date)}) AS LAST_AT` : ''} FROM ${view}`);
    out.rows = cnt[0] ? n(cnt[0].N) : null;
    out.distinctKeys = cnt[0] && cnt[0].DISTINCT_KEYS != null ? n(cnt[0].DISTINCT_KEYS) : null;
    out.duplicates = out.rows != null && out.distinctKeys != null ? out.rows - out.distinctKeys : null;
    out.firstAt = cnt[0] && cnt[0].FIRST_AT; out.lastAt = cnt[0] && cnt[0].LAST_AT;
    out.countMs = Date.now() - t1;
  }
  return out;
}

/* a handful of rows exactly as the view holds them — for reading the real shape once, before any mapping is written */
async function sample(limit = 3) {
  const lim = Math.min(20, Math.max(1, n(limit) || 3));
  return query(`SELECT TOP ${lim} * FROM ${ident(cfg().view)}`);
}

function status() {
  const c = cfg();
  return {
    configured: configured(), disabled: c.disabled, host: c.host || null, port: c.port, database: c.database,
    view: c.view, mapTable: c.mapTable, user: c.user ? c.user : null,
    backend: 'jdbc bridge (' + c.java + ', ' + c.jdbcDir + ')', ready: ready(), blockers: why(),
    nolock: c.nolock, querySecs: c.querySecs, tcp: state.tcp,
    jvm: state.jvm, jvmInfo: state.jvmInfo, jvmRestarts: state.jvmRestarts,
    queries: state.queries, lastQueryAt: state.lastQueryAt, lastQueryMs: state.lastQueryMs,
    lastError: state.lastError, lastErrorAt: state.lastErrorAt,
    columnsKnown: state.columns ? state.columns.length : 0, columnsAt: state.columnsAt
  };
}

module.exports = { configured, cfg, query, columns, viewColumns, pick, probe, sample, status, stop, ident, reachable };
