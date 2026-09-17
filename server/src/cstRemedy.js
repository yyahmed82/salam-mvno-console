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
 *  · CST_REMEDY_EXECUTE_AS names a database user without a login that holds only SELECT on the reporting
 *    objects. The bridge drops into it immediately after connecting and never reverts, so a privileged
 *    connecting login (sa) stops being privileged before the first query — enforced by SQL Server, not by
 *    this file. The probe reports IS_SYSADMIN so the drop is visible rather than assumed.
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
  nolock: E.CST_REMEDY_NOLOCK !== '0', executeAs: (E.CST_REMEDY_EXECUTE_AS || '').trim(),
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
      CST_REMEDY_NOLOCK: c.nolock ? '1' : '0', CST_REMEDY_JDBC_EXTRA: c.jdbcExtra, CST_REMEDY_JDBC_URL: c.jdbcUrl,
      CST_REMEDY_EXECUTE_AS: c.executeAs ? ident(c.executeAs) : ''
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
  /* who the session actually is. With CST_REMEDY_EXECUTE_AS in place the connecting login is sa but the
   * effective user is the SELECT-only one and IS_SYSADMIN comes back 0 — that is the proof the drop worked,
   * and it is shown on the page rather than taken on trust. */
  const v = await query(`SELECT @@VERSION AS VERSION, DB_NAME() AS DB, SUSER_SNAME() AS LOGIN_NAME,
      ORIGINAL_LOGIN() AS CONNECTED_AS, USER_NAME() AS DB_USER, IS_SRVROLEMEMBER('sysadmin') AS IS_SYSADMIN,
      GETDATE() AS SERVER_TIME`, [], 30000);
  out.server = v[0] ? String(v[0].VERSION || '').split('\n')[0] : null;
  out.db = v[0] && v[0].DB; out.login = v[0] && v[0].LOGIN_NAME; out.serverTime = v[0] && v[0].SERVER_TIME;
  out.connectedAs = v[0] && v[0].CONNECTED_AS; out.dbUser = v[0] && v[0].DB_USER;
  out.isSysadmin = v[0] && v[0].IS_SYSADMIN === 1;
  out.privilegeDrop = cfg().executeAs
    ? (out.isSysadmin ? 'FAILED — the session still has sysadmin rights' : `active — connected as ${out.connectedAs}, running as ${out.dbUser}`)
    : (out.isSysadmin ? 'none — this session has sysadmin rights on the whole instance' : 'not configured');
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

/* ---------------------------------------------------------------- the view, as ARSystem actually holds it
 * Confirmed against dbo.ITC_CITC_MOH on 17 Sep 2026 (SQL Server 2016 SP2-CU17, 824 898 rows, 777 112 distinct
 * Service_RequestID). Names are not guessed: every one below came back from INFORMATION_SCHEMA. `resolve()`
 * still checks them against the live schema before use, so a rename in Remedy surfaces as a named missing
 * column rather than a broken statement. */
const COL = {
  key: 'Service_RequestID', incident: 'Incident_Number', created: 'Creation_Date', resolved: 'Resolved_Date',
  serviceId: 'ITC_Service_Id', order: 'ITC_Order_Number', shipTo: 'ITC_Ship_to_1', customer: 'ITC_Customer_Number',
  name: 'Customer_Name', idType: 'ID_Type', idNumber: 'ID_Number', custType: 'Customer_type',
  provider: 'Provider_name', problem: 'Problem_Code', t1: 'Categorization_Tier_1', t2: 'Categorization_Tier_2',
  t3: 'Categorization_Tier_3', statusReason: 'Status_Reason', action: 'ITC_Action_Taken', status: 'Status',
  statusCode: 'Status_Code', resolution: 'Resolution', ttype: 'Trouble_Ticket_Types', product: 'ITC_Product_Name',
  source: 'ITC_Source', activation: 'Activation_Date', svcStatus: 'Service_Status',
  complaintSub: 'CITC_Complaint_SubTypeCode', complaint: 'CITC_Complaint_TypeCode',
  mainType: 'CITC_Service_MainTypeCode', subType: 'CITC_Service_SubTypeCode'
};
/* what the one search box looks in. Every one of these is an identifier an engineer actually has in hand when
 * CST forwards a complaint — the REQ number, the Remedy incident, the customer number, the service, the order,
 * or the national id off the complaint form. */
const ID_FIELDS = [
  { key: 'req', col: COL.key, label: 'Complaint number (REQ / SRID)' },
  { key: 'incident', col: COL.incident, label: 'Remedy incident / work order' },
  { key: 'custId', col: COL.customer, label: 'Customer number' },
  { key: 'serviceId', col: COL.serviceId, label: 'Service id' },
  { key: 'orderNo', col: COL.order, label: 'Order number' },
  { key: 'idNumber', col: COL.idNumber, label: 'National / Iqama id' }
];
const PII = new Set([COL.name.toUpperCase(), COL.idNumber.toUpperCase()]);

/* identifiers are masked on the way out exactly like the rest of the console: last four digits of an id, the
 * initials of a name. `unmask` is a capability the route checks, and it audits — nothing here is ever stored. */
const maskId = v => { const s = String(v == null ? '' : v); return s.length <= 4 ? (s ? '••••' : null) : '•'.repeat(Math.min(8, s.length - 4)) + s.slice(-4); };
const maskName = v => String(v == null ? '' : v).trim().split(/\s+/).filter(Boolean).map(w => w[0] + '.').join(' ') || null;
function shapeRow(r, unmask) {
  const o = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'RN') continue;
    if (!unmask && PII.has(k)) { o[k] = k === COL.name.toUpperCase() ? maskName(v) : maskId(v); continue; }
    o[k] = v;
  }
  return o;
}
/* every column the search returns, in the order an operator reads a ticket */
const SEARCH_COLS = [COL.key, COL.incident, COL.created, COL.resolved, COL.status, COL.statusCode, COL.statusReason,
  COL.t1, COL.t2, COL.t3, COL.problem, COL.customer, COL.name, COL.idType, COL.idNumber, COL.custType,
  COL.serviceId, COL.order, COL.product, COL.svcStatus, COL.activation, COL.source, COL.provider,
  COL.action, COL.resolution, COL.ttype, COL.complaint, COL.complaintSub, COL.mainType, COL.subType];

/* resolve the names against the live view once, so a rename is reported instead of producing bad SQL */
async function resolve(names) {
  const cols = await viewColumns();
  const have = new Set(cols.map(c => c.name.toLowerCase()));
  const missing = names.filter(n => !have.has(String(n).toLowerCase()));
  if (missing.length) throw new Error('column(s) not present in ' + cfg().view + ': ' + missing.join(', ') + ' — the view changed shape');
  return true;
}

/* SEARCH — the ask: one box, any identifier, live. 47 786 of the 824 898 rows share a Service_RequestID with
 * another row (the view is a UNION ALL of incidents and work orders, joined to a code-mapping table that holds
 * duplicate tier triples), so the result is collapsed to ONE row per complaint with ROW_NUMBER and each ticket
 * carries `RAW_ROWS` — how many rows of the view it came from. Counting tickets without that collapse
 * overstates every figure by about 6 %. */
async function search(term, { field = null, contains = false, limit = 100, unmask = false } = {}) {
  const t = String(term == null ? '' : term).trim();
  if (t.length < 3) return { ok: false, error: 'search term must be at least 3 characters' };
  if (t.length > 64) return { ok: false, error: 'search term too long (64 characters max)' };
  const fields = field ? ID_FIELDS.filter(f => f.key === field) : ID_FIELDS;
  if (!fields.length) return { ok: false, error: 'unknown field: ' + field + ' (use ' + ID_FIELDS.map(f => f.key).join(', ') + ')' };
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  await resolve(SEARCH_COLS.concat(fields.map(f => f.col)));
  const where = fields.map(f => contains ? `${ident(f.col)} LIKE ?` : `${ident(f.col)} = ?`).join(' OR ');
  const binds = fields.map(() => contains ? `%${t}%` : t);
  const t0 = Date.now();
  const rows = await query(
    `WITH m AS (SELECT ${SEARCH_COLS.map(ident).join(', ')},
        ROW_NUMBER() OVER (PARTITION BY ${ident(COL.key)} ORDER BY ${ident(COL.created)} DESC) AS RN,
        COUNT(*) OVER (PARTITION BY ${ident(COL.key)}) AS RAW_ROWS
      FROM ${ident(cfg().view)} WHERE ${where})
     SELECT TOP ${lim} * FROM m WHERE RN = 1 ORDER BY ${ident(COL.created)} DESC`, binds);
  return {
    ok: true, term: t, field: field || 'any', contains, ms: Date.now() - t0, view: cfg().view,
    searched: fields.map(f => ({ key: f.key, column: f.col, label: f.label })),
    count: rows.length, truncated: rows.length >= lim, unmasked: !!unmask,
    tickets: rows.map(r => shapeRow(r, unmask))
  };
}

/* KPIs — ONE scan, everything else derived here. Grouping to (day, status, tier, source) after collapsing to one
 * row per complaint gives the board's own figures (escalated, still open, five-day breaches, median closure) on
 * live data instead of the runbook snapshot, plus the daily series, at the cost of a single pass over the window.
 * The window uses the SERVER's clock (GETDATE), never this host's: ARSystem runs on KSA time, three hours ahead
 * of the console, and guessing that offset is how date filters quietly lose a day. */
/* A TICKET IS NOT A ROW, AND NOT EVERY TICKET HAS A COMPLAINT NUMBER. The live data settled this on 18 Sep:
 * of 131 323 rows in a 90-day window, 10 174 carry NO Service_RequestID — and they hold 10 174 DISTINCT
 * Incident_Numbers, so they are 10 174 separate tickets that were never given a CST complaint number, not
 * duplicates of one another. Grouping them by Service_RequestID alone folded all of them into a single
 * phantom "ticket" and reported the whole lot as duplicate rows. The key is therefore the complaint number
 * when there is one and the Remedy incident when there is not, and the two populations are counted apart. */
const HAS_SRID = `NULLIF(LTRIM(RTRIM(${'Service_RequestID'})), '') IS NOT NULL`;
const TICKET_KEY = `COALESCE(NULLIF(LTRIM(RTRIM(Service_RequestID)), ''), 'INC:' + Incident_Number)`;
const LAG_BUCKETS = [[0, 5, '0–5 days'], [6, 15, '6–15 days'], [16, 30, '16–30 days'], [31, 60, '31–60 days'], [61, 99999, 'over 60 days']];
async function kpis({ days = 90 } = {}) {
  const d = Math.min(3650, Math.max(1, Number(days) || 90));
  await resolve([COL.key, COL.created, COL.resolved, COL.status, COL.t1, COL.source]);
  const t0 = Date.now();
  const rows = await query(
    `WITH t AS (
       SELECT ${TICKET_KEY} AS K, MIN(${ident(COL.created)}) AS CREATED, MAX(${ident(COL.resolved)}) AS RESOLVED,
              MAX(${ident(COL.status)}) AS STATUS, MAX(${ident(COL.t1)}) AS TIER1, MAX(${ident(COL.source)}) AS SOURCE,
              MAX(CASE WHEN ${HAS_SRID} THEN 0 ELSE 1 END) AS NO_SRID, COUNT(*) AS RAW_ROWS
         FROM ${ident(cfg().view)}
        WHERE ${ident(COL.created)} >= DATEADD(day, -${d}, GETDATE())
        GROUP BY ${TICKET_KEY})
     SELECT CAST(CREATED AS date) AS DAY, STATUS, TIER1, SOURCE,
            COUNT(*) AS TICKETS, SUM(RAW_ROWS) AS RAW_ROWS, SUM(NO_SRID) AS NO_SRID,
            SUM(CASE WHEN RESOLVED IS NULL THEN 1 ELSE 0 END) AS STILL_OPEN,
            SUM(CASE WHEN RESOLVED IS NOT NULL THEN 1 ELSE 0 END) AS CLOSED,
            SUM(CASE WHEN RESOLVED IS NOT NULL THEN DATEDIFF(day, CREATED, RESOLVED) ELSE 0 END) AS LAG_SUM,
            SUM(CASE WHEN RESOLVED IS NOT NULL AND DATEDIFF(day, CREATED, RESOLVED) > 5 THEN 1 ELSE 0 END) AS CLOSED_LATE,
            SUM(CASE WHEN RESOLVED IS NULL AND DATEDIFF(day, CREATED, GETDATE()) > 5 THEN 1 ELSE 0 END) AS OPEN_LATE,
            ${LAG_BUCKETS.map(([a, b], i) => `SUM(CASE WHEN RESOLVED IS NOT NULL AND DATEDIFF(day, CREATED, RESOLVED) BETWEEN ${a} AND ${b} THEN 1 ELSE 0 END) AS LAG${i}`).join(',\n            ')}
       FROM t GROUP BY CAST(CREATED AS date), STATUS, TIER1, SOURCE`, [], 120000);
  const ms = Date.now() - t0;
  const N = v => Number(v) || 0;
  const tot = { tickets: 0, rawRows: 0, noSrid: 0, open: 0, closed: 0, lagSum: 0, closedLate: 0, openLate: 0, lag: LAG_BUCKETS.map(() => 0) };
  const by = { status: new Map(), tier1: new Map(), source: new Map(), day: new Map() };
  const bump = (m, k, r) => { const x = m.get(k) || { key: k, tickets: 0, open: 0, closed: 0, late: 0 }; x.tickets += N(r.TICKETS); x.open += N(r.STILL_OPEN); x.closed += N(r.CLOSED); x.late += N(r.CLOSED_LATE) + N(r.OPEN_LATE); m.set(k, x); };
  for (const r of rows) {
    tot.tickets += N(r.TICKETS); tot.rawRows += N(r.RAW_ROWS); tot.noSrid += N(r.NO_SRID); tot.open += N(r.STILL_OPEN); tot.closed += N(r.CLOSED);
    tot.lagSum += N(r.LAG_SUM); tot.closedLate += N(r.CLOSED_LATE); tot.openLate += N(r.OPEN_LATE);
    LAG_BUCKETS.forEach((_, i) => { tot.lag[i] += N(r['LAG' + i]); });
    bump(by.status, r.STATUS || '—', r); bump(by.tier1, r.TIER1 || '—', r);
    bump(by.source, r.SOURCE || '—', r); bump(by.day, String(r.DAY || '').slice(0, 10), r);
  }
  /* median closure from the buckets: the bucket holding the middle closed ticket, reported as its range rather
   * than a false precision — the exact median would need a second pass over every closed ticket. */
  let acc = 0, medianBucket = null; const half = tot.closed / 2;
  LAG_BUCKETS.forEach(([, , label], i) => { acc += tot.lag[i]; if (medianBucket === null && acc >= half && tot.closed) medianBucket = label; });
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : null;
  const list = m => [...m.values()].sort((a, b) => b.tickets - a.tickets);
  return {
    ok: true, days: d, ms, view: cfg().view, at: new Date().toISOString(),
    totals: {
      tickets: tot.tickets, rawRows: tot.rawRows,
      complaints: tot.tickets - tot.noSrid, withoutComplaintNo: tot.noSrid,
      withoutComplaintPct: pct(tot.noSrid, tot.tickets),
      duplicateRows: tot.rawRows - tot.tickets, duplicatePct: pct(tot.rawRows - tot.tickets, tot.rawRows),
      open: tot.open, openPct: pct(tot.open, tot.tickets), closed: tot.closed,
      breaches: tot.closedLate + tot.openLate, breachPct: pct(tot.closedLate + tot.openLate, tot.tickets),
      closedLate: tot.closedLate, openLate: tot.openLate,
      avgClosureDays: tot.closed ? Math.round(tot.lagSum / tot.closed * 10) / 10 : null,
      medianClosureBucket: medianBucket, perDay: Math.round(tot.tickets / d * 10) / 10
    },
    lag: LAG_BUCKETS.map(([, , label], i) => ({ label, tickets: tot.lag[i], pct: pct(tot.lag[i], tot.closed) })),
    byStatus: list(by.status), byTier1: list(by.tier1), bySource: list(by.source),
    daily: [...by.day.values()].map(x => x).sort((a, b) => a.key < b.key ? -1 : 1)
  };
}

/* FINDINGS — the questions the snapshot cannot answer. Each one is its own small query and carries its own
 * error, so a single failure never blanks the section (house rule: errors travel with results). */
async function findings({ days = 90 } = {}) {
  const d = Math.min(3650, Math.max(1, Number(days) || 90));
  const out = { days: d, at: new Date().toISOString(), items: [] };
  const add = async (id, title, note, sql, binds) => {
    const t0 = Date.now();
    try { out.items.push({ id, title, note, ms: Date.now() - t0, rows: await query(sql, binds || [], 120000) }); }
    catch (e) { out.items.push({ id, title, note, error: String(e.message || e).slice(0, 300) }); }
  };
  const V = ident(cfg().view);
  await add('duplicates', 'What the duplicate rows actually are',
    'A complaint appearing more than once in the view. If the copies differ only by the code columns it is fan-out from the mapping join, not two tickets.',
    `SELECT TOP 20 ${ident(COL.key)} AS SRID, COUNT(*) AS ROWS_IN_VIEW,
        COUNT(DISTINCT ${ident(COL.incident)}) AS INCIDENTS, COUNT(DISTINCT ${ident(COL.status)}) AS STATUSES,
        COUNT(DISTINCT ${ident(COL.t3)}) AS TIER3, COUNT(DISTINCT ${ident(COL.mainType)}) AS MAIN_CODES
      FROM ${V} WHERE ${ident(COL.created)} >= DATEADD(day, -${d}, GETDATE()) AND ${HAS_SRID}
      GROUP BY ${ident(COL.key)} HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC`);
  await add('open_ageing', 'Open complaints by age',
    'Still unresolved, grouped by how long they have been open on the server\'s own clock.',
    `WITH t AS (SELECT ${ident(COL.key)} AS K, MIN(${ident(COL.created)}) AS CREATED, MAX(${ident(COL.resolved)}) AS RESOLVED
        FROM ${V} WHERE ${ident(COL.created)} >= DATEADD(day, -${d}, GETDATE()) GROUP BY ${ident(COL.key)})
     SELECT CASE WHEN DATEDIFF(day, CREATED, GETDATE()) <= 5 THEN '0-5 days'
                 WHEN DATEDIFF(day, CREATED, GETDATE()) <= 15 THEN '6-15 days'
                 WHEN DATEDIFF(day, CREATED, GETDATE()) <= 30 THEN '16-30 days'
                 WHEN DATEDIFF(day, CREATED, GETDATE()) <= 60 THEN '31-60 days'
                 ELSE 'over 60 days' END AS AGE, COUNT(*) AS TICKETS
       FROM t WHERE RESOLVED IS NULL GROUP BY CASE WHEN DATEDIFF(day, CREATED, GETDATE()) <= 5 THEN '0-5 days'
                 WHEN DATEDIFF(day, CREATED, GETDATE()) <= 15 THEN '6-15 days'
                 WHEN DATEDIFF(day, CREATED, GETDATE()) <= 30 THEN '16-30 days'
                 WHEN DATEDIFF(day, CREATED, GETDATE()) <= 60 THEN '31-60 days' ELSE 'over 60 days' END`);
  await add('top_problems', 'Where the complaints concentrate',
    'The tier-1 / tier-2 / problem-code combinations carrying the most complaints in the window, with how many are still open.',
    `WITH t AS (SELECT ${ident(COL.key)} AS K, MAX(${ident(COL.t1)}) AS T1, MAX(${ident(COL.t2)}) AS T2,
        MAX(${ident(COL.problem)}) AS PROBLEM, MAX(${ident(COL.resolved)}) AS RESOLVED
        FROM ${V} WHERE ${ident(COL.created)} >= DATEADD(day, -${d}, GETDATE()) GROUP BY ${ident(COL.key)})
     SELECT TOP 25 T1, T2, PROBLEM, COUNT(*) AS TICKETS, SUM(CASE WHEN RESOLVED IS NULL THEN 1 ELSE 0 END) AS STILL_OPEN
       FROM t GROUP BY T1, T2, PROBLEM ORDER BY COUNT(*) DESC`);
  await add('no_complaint_no', 'Tickets with no CST complaint number',
    'CTT tickets in Remedy that carry no Service_RequestID — never escalated to CST, or the number was never written back. Counted apart from complaints everywhere on this page.',
    `SELECT CAST(${ident(COL.created)} AS date) AS DAY, COUNT(*) AS ROWS_IN_VIEW,
            COUNT(DISTINCT ${ident(COL.incident)}) AS DISTINCT_INCIDENTS, COUNT(DISTINCT ${ident(COL.status)}) AS STATUSES
       FROM ${V} WHERE ${ident(COL.created)} >= DATEADD(day, -${d}, GETDATE()) AND NOT (${HAS_SRID})
      GROUP BY CAST(${ident(COL.created)} AS date) ORDER BY 1 DESC`);
  await add('unmapped_codes', 'Complaints carrying no CST code',
    'Rows whose CITC code columns are null — the regulator classification the mapping table is supposed to supply did not resolve.',
    `SELECT COUNT(DISTINCT ${ident(COL.key)}) AS TICKETS,
            SUM(CASE WHEN ${ident(COL.complaint)} IS NULL THEN 1 ELSE 0 END) AS NO_COMPLAINT_CODE,
            SUM(CASE WHEN ${ident(COL.mainType)} IS NULL THEN 1 ELSE 0 END) AS NO_MAIN_CODE,
            SUM(CASE WHEN ${ident(COL.subType)} IS NULL THEN 1 ELSE 0 END) AS NO_SUB_CODE
       FROM ${V} WHERE ${ident(COL.created)} >= DATEADD(day, -${d}, GETDATE())`);
  return out;
}

/* one in-memory cache for the expensive reads. Nothing about a ticket is written to the console database —
 * the cache holds only the aggregates, and it is dropped when the process restarts. */
const _cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.value, cached: true, cachedAt: new Date(hit.at).toISOString() };
  const value = await fn();
  _cache.set(key, { at: Date.now(), value });
  return value;
}

function status() {
  const c = cfg();
  return {
    configured: configured(), disabled: c.disabled, host: c.host || null, port: c.port, database: c.database,
    view: c.view, mapTable: c.mapTable, user: c.user ? c.user : null,
    backend: 'jdbc bridge (' + c.java + ', ' + c.jdbcDir + ')', ready: ready(), blockers: why(),
    nolock: c.nolock, querySecs: c.querySecs, executeAs: c.executeAs || null, tcp: state.tcp,
    jvm: state.jvm, jvmInfo: state.jvmInfo, jvmRestarts: state.jvmRestarts,
    queries: state.queries, lastQueryAt: state.lastQueryAt, lastQueryMs: state.lastQueryMs,
    lastError: state.lastError, lastErrorAt: state.lastErrorAt,
    columnsKnown: state.columns ? state.columns.length : 0, columnsAt: state.columnsAt
  };
}

module.exports = { configured, cfg, query, columns, viewColumns, pick, probe, sample, status, stop, ident, reachable,
  search, kpis, findings, cached, COL, ID_FIELDS };
