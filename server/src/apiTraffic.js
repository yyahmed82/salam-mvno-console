/* Digital-API traffic reader — the source behind the ops "Digital-API traffic" Grafana dashboard.
 *
 * ── COLLECTOR MODE (preferred — set API_LOG_HOSTS) ──────────────────────────────────────────
 * When API_LOG_HOSTS is set, apiLogCollector.js pulls api_logger.production.log increments over
 * SSH from the api hosts into the console's OWN Postgres (api_traffic_events, 7-day retention)
 * and EVERY query fn here (overview / p95Stats / techFailStats) reads that table instead of
 * MySQL — same output shapes, plus a per-host dimension (`host` filter param + `hosts` list).
 * err_class is precomputed at ingest by errclass.classifyClass (no SQL mirror needed).
 * mode() → 'collector' | 'mysql' | 'unconfigured'; the MySQL path below stays as the fallback.
 *
 * A cron script on the salam_api host tails api_logger.production.log every 5 min and INSERTs one
 * row per API call into MySQL on the Clara host:
 *   host 172.31.43.175:3306 · db `grafana` · table `transaction_logs`
 *   columns: log_date (DATETIME, **UTC** — the script writes response-header Date converted to UTC),
 *            path, transaction_id (nullable), response_code, response_message, duration (string).
 *
 * We READ that DB directly (same pattern as osbLog.js): read-only, mysql2, env-configured,
 * INERT until configured, graceful "not configured" everywhere. Enable with:
 *   API_TRAFFIC_URL = mysql://user:pass@172.31.43.175:3306/grafana
 *   (or API_TRAFFIC_DB_HOST / PORT / USER / PASSWORD / NAME)
 * Optional schema overrides (defaults match the ingest script):
 *   API_TRAFFIC_TABLE=transaction_logs  API_TRAFFIC_TIME_COL=log_date  API_TRAFFIC_PATH_COL=path
 *   API_TRAFFIC_CODE_COL=response_code  API_TRAFFIC_MSG_COL=response_message
 *   API_TRAFFIC_DUR_COL=duration        API_TRAFFIC_TXN_COL=transaction_id
 * Semantics knobs:
 *   API_TRAFFIC_SUCCESS_CODES  responseCodes that count as success (default '00,0,000,0000,200,600'
 *                              — '00/600 = ok' per the BSS code map; calibrate against the live data)
 *   API_TRAFFIC_DURATION_UNIT  'ms' (default) or 's' — how the log's duration field is expressed
 *
 * (The log line format itself — response.headers.Date → UTC ts, request.path, txn-id from
 *  request.body, response.body.responseCode/responseMessage, str(duration) — is documented and
 *  parsed in apiLogCollector.js, which mirrors the ops Python parser exactly.)
 *
 * TIMEZONE NOTE (MySQL mode): log_date holds UTC, so every window compares against UTC_TIMESTAMP() (never NOW(),
 * whose meaning depends on the server session tz), and time buckets are computed tz-free as
 * "minutes since 2000-01-01" via TIMESTAMPDIFF and reconstructed in JS with Date.UTC.
 * Never interpolate untrusted values — identifiers are env-sourced and sanitised; user input is bound.
 */
'use strict';

const ident = s => String(s || '').replace(/[^A-Za-z0-9_]/g, '');   // safe SQL identifier (env-sourced)

const CFG = () => ({
  url: process.env.API_TRAFFIC_URL || '',
  host: process.env.API_TRAFFIC_DB_HOST || '', port: Number(process.env.API_TRAFFIC_DB_PORT || 3306),
  user: process.env.API_TRAFFIC_DB_USER || '', password: process.env.API_TRAFFIC_DB_PASSWORD || '',
  database: process.env.API_TRAFFIC_DB_NAME || 'grafana',
  table: ident(process.env.API_TRAFFIC_TABLE || 'transaction_logs'),
  tcol: ident(process.env.API_TRAFFIC_TIME_COL || 'log_date'),
  pcol: ident(process.env.API_TRAFFIC_PATH_COL || 'path'),
  ccol: ident(process.env.API_TRAFFIC_CODE_COL || 'response_code'),
  mcol: ident(process.env.API_TRAFFIC_MSG_COL || 'response_message'),
  dcol: ident(process.env.API_TRAFFIC_DUR_COL || 'duration'),
  xcol: ident(process.env.API_TRAFFIC_TXN_COL || 'transaction_id'),
  successCodes: String(process.env.API_TRAFFIC_SUCCESS_CODES || '00,0,000,0000,200,600')
    .split(',').map(s => s.trim()).filter(Boolean),
  durMult: (process.env.API_TRAFFIC_DURATION_UNIT || 'ms').toLowerCase() === 's' ? 1000 : 1
});

function mysqlConfigured() { return !!(process.env.API_TRAFFIC_URL || process.env.API_TRAFFIC_DB_HOST); }
function collectorMode() { return !!process.env.API_LOG_HOSTS; }           // SSH collector wins when set
function configured() { return collectorMode() || mysqlConfigured(); }
function mode() { return collectorMode() ? 'collector' : (mysqlConfigured() ? 'mysql' : 'unconfigured'); }

/* Same malformed-URL early detection as osbLog.js — an unescaped '@'/'#'/'?' in the password splits
 * the URL wrong and surfaces as a misleading "Access denied" (this literally happened with OSB). */
function urlProblem(url) {
  if (!url) return null;
  const after = url.replace(/^[a-z0-9+]+:\/\//i, '');
  const at = (after.match(/@/g) || []).length;
  if (at === 0) return 'no "@" separating credentials from host — the URL is malformed';
  if (at > 1) return 'the password contains an unescaped "@" — percent-encode it as %40';
  const creds = after.slice(0, after.lastIndexOf('@'));
  if (creds.includes('#')) return 'the password contains an unescaped "#" — it truncates the URL. Percent-encode it as %23';
  if (creds.includes('?')) return 'the password contains an unescaped "?" — percent-encode it as %3F';
  try { new URL(url); } catch (e) { return `not a parseable URL (${e.code || e.message})`; }
  return null;
}

/* Auth-failure latch (same rationale as osbLog.js): repeated bad-credential probes from a server IP
 * can lock the account / trip SOC alerting — latch OFF after a few consecutive rejections. */
const AUTH_ERRORS = ['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_NOT_SUPPORTED_AUTH_MODE'];
const MAX_AUTH_FAILS = Number(process.env.API_TRAFFIC_MAX_AUTH_FAILS || 3);
let _pool = null, _driverErr = null, _authFails = 0, _lockedOut = null;

function pool() {
  if (!configured()) return null;
  if (_lockedOut) { _driverErr = _lockedOut; return null; }
  if (_pool) return _pool;
  const c = CFG();
  const bad = urlProblem(c.url);
  if (bad) { _driverErr = `API_TRAFFIC_URL is malformed: ${bad}`; return null; }
  let mysql;
  try { mysql = require('mysql2/promise'); }
  catch (e) { _driverErr = 'mysql2 driver not installed — add it to server/package.json and rebuild'; return null; }
  _pool = c.url
    ? mysql.createPool(c.url + (c.url.includes('?') ? '&' : '?') + 'connectionLimit=3')
    : mysql.createPool({ host: c.host, port: c.port, user: c.user, password: c.password, database: c.database, connectionLimit: 3 });
  return _pool;
}

function noteResult(err) {
  if (!err) { _authFails = 0; return; }
  if (!AUTH_ERRORS.includes(err.code)) return;          // network blips are retried, bad creds are not
  if (++_authFails >= MAX_AUTH_FAILS) {
    _lockedOut = `stopped after ${_authFails} consecutive credential rejections (${err.code}) — `
      + 'fix API_TRAFFIC_URL / the MySQL grant and restart the console.';
    console.error('API-traffic reader: ' + _lockedOut);
    if (_pool) { try { _pool.end(); } catch (e) {} _pool = null; }
  }
}

async function ping() {
  if (collectorMode()) return require('./apiLogCollector').ping();
  if (!configured()) return { ok: false, configured: false };
  const p = pool(); if (!p) return { ok: false, configured: true, error: _driverErr || 'no pool' };
  const t0 = Date.now();
  try { await p.query('SELECT 1'); noteResult(null); return { ok: true, configured: true, ms: Date.now() - t0 }; }
  catch (e) { noteResult(e); return { ok: false, configured: true, error: e.message, code: e.code, ms: Date.now() - t0 }; }
}

function status() {
  const m = mode();
  if (m === 'collector') {
    // per-host watermark/lag/last error + cached event count/newest ts, from the collector
    const col = require('./apiLogCollector').status();
    return { ...col, configured: true, mode: m, table: 'api_traffic_events',
      successCodes: CFG().successCodes, durationUnit: CFG().durMult === 1000 ? 's' : 'ms' };
  }
  const c = CFG();
  // mask everything between the first ':' after the user and the LAST '@' (osbLog lesson)
  const masked = c.url ? c.url.replace(/^([a-z0-9+]+:\/\/[^:/@]+:).*(@[^@]*)$/i, '$1****$2') : null;
  return { configured: configured(), mode: m, table: c.table,
    target: masked || (c.host ? `${c.host}:${c.port}/${c.database}` : null),
    successCodes: c.successCodes, durationUnit: c.durMult === 1000 ? 's' : 'ms',
    urlProblem: urlProblem(c.url), lockedOut: _lockedOut, authFailures: _authFails };
}

/* ---- shared SQL fragments (all identifiers env-sourced + sanitised above) ---- */
// duration → milliseconds, NULL-safe (CAST of junk yields 0 with a warning; NULLIF guards '')
const DUR = c => `(CAST(NULLIF(\`${c.dcol}\`,'') AS DECIMAL(14,3)) * ${c.durMult})`;
const SUCCESS = c => `\`${c.ccol}\` IN (${c.successCodes.map(() => '?').join(',')})`;

/* Business/Technical split on the response code + message — MIRRORS errclass.js (the console-wide
 * SSOT): n-Cnnn app codes → business first, then TECH codes/text → technical, else business.
 * Kept as a lowercase REGEXP so it runs identically on MySQL 5.7 and 8.x. If you edit
 * errclass.js TECH_CODE/TECH_TEXT, update this fragment too. */
// NB: written with {0,1} instead of '?' so the SQL literal can never be mistaken for a bind
// placeholder by any driver/tooling that scans the statement text.
const TECH_RE = 'timeout|timed[ -]{0,1}out|etimedout|econnrefused|econnreset|connection (reset|refused|closed)'
  + '|sslexception|i/o error|service (is ){0,1}not available|osb-382000|crmexception|soapfault|soap:fault'
  + '|internal server error|gateway timeout|bad gateway|unreachable';
const CLS = c => `CASE
    WHEN COALESCE(\`${c.ccol}\`,'') REGEXP '^[0-9]{3}-C' OR LOWER(COALESCE(\`${c.mcol}\`,'')) REGEXP '[0-9]{3}-c[0-9]{3}' THEN 'business'
    WHEN \`${c.ccol}\` IN ('1500','5002','408','500','502','503','504','715') THEN 'technical'
    WHEN LOWER(COALESCE(\`${c.mcol}\`,'')) REGEXP '${TECH_RE}' THEN 'technical'
    ELSE 'business' END`;

// tz-free minute bucket: minutes since 2000-01-01 (both operands are plain DATETIMEs — no session-tz
// conversion anywhere). Reconstructed client-side via bucketToIso().
const EPOCH2K = Date.UTC(2000, 0, 1);
const MINS = c => `TIMESTAMPDIFF(MINUTE, '2000-01-01 00:00:00', \`${c.tcol}\`)`;
const bucketToIso = m => new Date(EPOCH2K + m * 60000).toISOString();

const clampHours = h => Math.max(1, Math.min(168, Number(h) || 24));

/* PII guard: the ingest pipeline is not supposed to carry MSISDNs, but response messages are free
 * text — mask any KSA-mobile-looking digit run before it leaves the server (same spirit as
 * roles.maskDeep / assist.scrubPII). */
function maskText(s) {
  if (s == null) return s;
  return String(s)
    .replace(/(\+?966|00966|0)?5\d{8}/g, m => m.slice(0, 2) + '*******' + m.slice(-2))  // KSA mobiles
    .replace(/\b[12]\d{9}\b/g, m => m.slice(0, 2) + '******' + m.slice(-2));            // national/iqama IDs
}

/* ═══ COLLECTOR (PG) MODE — same output shapes, read from console-DB api_traffic_events ══════
 * err_class was computed at ingest (errclass.classifyClass, the SSOT) and response_message was
 * masked at ingest, so the SQL here is plain filters + aggregates — no CLS/SUCCESS mirrors.
 * `host` is the extra dimension (which api box the line came from); rows are UTC timestamptz
 * so now()-relative windows are safe (db.js pins every session to UTC). pglast-validated. */
function pgWhere({ mins, api, host }) {
  const params = [String(mins)];
  let w = `WHERE ts >= now() - ($1 || ' minutes')::interval`;
  if (api)  { params.push(api);  w += ` AND path = $${params.length}`; }
  if (host) { params.push(host); w += ` AND host = $${params.length}`; }
  return { w, params };
}

async function pgP95Stats({ hours = 1, api = null, host = null } = {}) {
  const db = require('./db');
  const mins = clampHours(hours) * 60;
  const { w, params } = pgWhere({ mins, api, host });
  const ga = await db.console.query(
    `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95, count(*)::bigint AS cnt
     FROM api_traffic_events ${w}`, params);
  const pa = await db.console.query(
    `SELECT path AS api, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95, count(*)::bigint AS cnt
     FROM api_traffic_events ${w} GROUP BY path ORDER BY cnt DESC LIMIT 100`, params);
  const g = ga.rows[0] || {};
  return {
    global: g.p95 != null ? { p95: Number(g.p95), count: Number(g.cnt) } : { p95: null, count: Number(g.cnt || 0) },
    byApi: pa.rows.map(r => ({ api: r.api || '(none)', p95: r.p95 == null ? null : Number(r.p95), count: Number(r.cnt) }))
  };
}

async function pgTechFailStats({ hours = 1, host = null } = {}) {
  const db = require('./db');
  const mins = clampHours(hours) * 60;
  const { w, params } = pgWhere({ mins, host });
  const r = await db.console.query(
    `SELECT path AS api, count(*)::bigint AS total,
            (count(*) FILTER (WHERE err_class = 'technical'))::bigint AS tech
     FROM api_traffic_events ${w} GROUP BY path ORDER BY total DESC LIMIT 100`, params);
  let total = 0, tech = 0;
  const byApi = r.rows.map(x => {
    total += Number(x.total); tech += Number(x.tech);
    return { api: x.api || '(none)', total: Number(x.total), tech: Number(x.tech),
      rate: Number(x.total) > 0 ? Number(x.tech) / Number(x.total) : null };
  });
  return { global: { total, tech, rate: total > 0 ? tech / total : null }, byApi };
}

/* The filter lists (every path / host seen in the window) are two DISTINCT scans of the whole window — 3.3 s each
 * on 24 h in the 7 Oct review — for dropdowns whose content changes about never. Memoised 10 min per window. */
const _lists = new Map();                                      // mins → { at, apis, hosts }
async function pgFilterLists(mins) {
  const hit = _lists.get(mins);
  if (hit && Date.now() - hit.at < 10 * 60000) return hit;
  const db = require('./db');
  const apis = await db.console.query(
    `SELECT DISTINCT path AS api FROM api_traffic_events
     WHERE ts >= now() - ($1 || ' minutes')::interval ORDER BY 1 LIMIT 300`, [String(mins)]);
  const hosts = await db.console.query(
    `SELECT DISTINCT host FROM api_traffic_events
     WHERE ts >= now() - ($1 || ' minutes')::interval ORDER BY 1`, [String(mins)]);
  const v = { at: Date.now(), apis: apis.rows.map(r => r.api).filter(Boolean), hosts: hosts.rows.map(r => r.host).filter(Boolean) };
  _lists.set(mins, v);
  return v;
}
/* run the jobs at most `n` at a time: the console pool has 4 connections and every other request's auth lookup
 * shares them — eight window scans fired at once used to park everything else behind this page */
async function limited(n, jobs) {
  const out = new Array(jobs.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length) { const k = i++; out[k] = await jobs[k](); }
  }));
  return out;
}

async function pgOverview({ hours = 24, api = null, host = null } = {}) {
  const db = require('./db');
  const c = CFG();
  const h = clampHours(hours), mins = h * 60;
  const bucket = h <= 1 ? 1 : h <= 6 ? 5 : 15;   // series granularity: 1/5/15-minute buckets
  const { w, params } = pgWhere({ mins, api, host });
  try {
    const [tot, codes, ser, slow, perApi, errs] = await limited(2, [
      () => db.console.query(
        `SELECT count(*)::bigint AS total, (count(*) FILTER (WHERE err_class = 'success'))::bigint AS ok
         FROM api_traffic_events ${w}`, params),
      () => db.console.query(
        `SELECT COALESCE(NULLIF(response_code, ''), '(none)') AS code, count(*)::bigint AS n,
                COALESCE(err_class, 'business') AS cls
         FROM api_traffic_events ${w} GROUP BY 1, 3 ORDER BY n DESC LIMIT 15`, params),
      () => db.console.query(
        `SELECT to_timestamp(floor(extract(epoch FROM ts) / $${params.length + 1}) * $${params.length + 1}) AS b,
                avg(duration_ms) AS avg_ms, max(duration_ms) AS max_ms, count(*)::bigint AS n
         FROM api_traffic_events ${w} GROUP BY 1 ORDER BY 1`, [...params, bucket * 60]),
      () => db.console.query(
        `SELECT ts AS at, host, path AS api, transaction_id AS txn, response_code AS code, duration_ms AS ms
         FROM api_traffic_events ${w} ORDER BY duration_ms DESC NULLS LAST LIMIT 20`, params),
      () => db.console.query(
        `SELECT path AS api, count(*)::bigint AS calls,
                (count(*) FILTER (WHERE err_class = 'success'))::bigint AS ok,
                (count(*) FILTER (WHERE err_class = 'business'))::bigint AS biz,
                (count(*) FILTER (WHERE err_class = 'technical'))::bigint AS tech,
                avg(duration_ms) AS avg_ms, max(duration_ms) AS max_ms
         FROM api_traffic_events ${w} GROUP BY 1 ORDER BY calls DESC LIMIT 100`, params),
      () => db.console.query(
        `SELECT COALESCE(NULLIF(response_code, ''), '(none)') AS code, response_message AS msg,
                count(*)::bigint AS n, COALESCE(err_class, 'business') AS cls
         FROM api_traffic_events ${w} AND err_class <> 'success' AND COALESCE(response_message, '') <> ''
         GROUP BY 1, 2, 4 ORDER BY n DESC LIMIT 15`, params)
    ]);
    const lists = await pgFilterLists(mins);
    let p95 = null;
    try { p95 = await pgP95Stats({ hours: h, api, host }); } catch (e) { /* p95 optional — table still renders */ }
    const p95ByApi = new Map((p95 && p95.byApi || []).map(r => [r.api, r.p95]));
    const total = Number(tot.rows[0].total) || 0, ok = Number(tot.rows[0].ok) || 0;
    return {
      configured: true, ok: true, mode: 'collector', hours: h, api: api || null, host: host || null,
      bucketMin: bucket, successCodes: c.successCodes, durationUnit: c.durMult === 1000 ? 's' : 'ms',
      gauges: { total, success: ok, failure: total - ok },
      codes: codes.rows.map(r => ({ code: r.code, count: Number(r.n), cls: r.cls })),
      series: ser.rows.map(r => ({ t: new Date(r.b).toISOString(),
        avg: r.avg_ms == null ? null : Math.round(Number(r.avg_ms)),
        max: r.max_ms == null ? null : Math.round(Number(r.max_ms)), n: Number(r.n) })),
      slowest: slow.rows.map(r => ({ at: r.at, api: r.api, txn: r.txn, code: r.code,
        ms: Math.round(Number(r.ms) || 0), host: r.host })),
      perApi: perApi.rows.map(r => {
        const calls = Number(r.calls) || 0, okN = Number(r.ok) || 0;
        return { api: r.api || '(none)', calls, success: okN, business: Number(r.biz) || 0, technical: Number(r.tech) || 0,
          successRate: calls > 0 ? okN / calls : null,
          avgMs: r.avg_ms == null ? null : Math.round(Number(r.avg_ms)),
          maxMs: r.max_ms == null ? null : Math.round(Number(r.max_ms)),
          p95Ms: p95ByApi.has(r.api || '(none)') ? Math.round(p95ByApi.get(r.api || '(none)')) : null };
      }),
      globalP95: p95 && p95.global && p95.global.p95 != null ? Math.round(p95.global.p95) : null,
      errors: errs.rows.map(r => ({ code: r.code, msg: maskText(r.msg), count: Number(r.n), cls: r.cls })),
      apis: lists.apis,
      hosts: lists.hosts
    };
  } catch (e) {
    return { configured: true, ok: false, mode: 'collector', error: e.message, code: e.code };
  }
}

/* p95 durations, global + per-API, over the last N hours. Collector mode reads Postgres;
 * otherwise the primary implementation uses MySQL 8 window functions and, on a 5.7 server
 * (no window functions → ER_PARSE_ERROR), falls back to capped raw durations + JS quantile. */
async function p95Stats({ hours = 1, api = null, host = null } = {}) {
  if (collectorMode()) return pgP95Stats({ hours, api, host });
  const p = pool(); if (!p) throw new Error(_driverErr || 'not configured');
  const c = CFG();
  const mins = clampHours(hours) * 60;
  const flt = api ? ` AND \`${c.pcol}\` = ?` : '';
  const base = `FROM \`${c.table}\` WHERE \`${c.tcol}\` >= (UTC_TIMESTAMP() - INTERVAL ? MINUTE)${flt}`;
  const params = api ? [mins, api] : [mins];
  try {
    const [ga] = await p.query(
      `SELECT dur AS p95, cnt FROM (
         SELECT ${DUR(c)} AS dur,
                ROW_NUMBER() OVER (ORDER BY ${DUR(c)}) AS rn,
                COUNT(*)    OVER ()                    AS cnt
         ${base}) x
       WHERE rn = GREATEST(1, CEIL(cnt * 0.95))`, params);
    const [pa] = await p.query(
      `SELECT api, dur AS p95, cnt FROM (
         SELECT \`${c.pcol}\` AS api, ${DUR(c)} AS dur,
                ROW_NUMBER() OVER (PARTITION BY \`${c.pcol}\` ORDER BY ${DUR(c)}) AS rn,
                COUNT(*)    OVER (PARTITION BY \`${c.pcol}\`)                      AS cnt
         ${base}) x
       WHERE rn = GREATEST(1, CEIL(cnt * 0.95))
       ORDER BY cnt DESC LIMIT 100`, params);
    noteResult(null);
    return {
      global: ga.length ? { p95: Number(ga[0].p95), count: Number(ga[0].cnt) } : { p95: null, count: 0 },
      byApi: pa.map(r => ({ api: r.api || '(none)', p95: Number(r.p95), count: Number(r.cnt) }))
    };
  } catch (e) {
    if (e.code !== 'ER_PARSE_ERROR') { noteResult(e); throw e; }
    // MySQL 5.7 fallback: capped raw pull + JS quantile
    const [rows] = await p.query(
      `SELECT \`${c.pcol}\` AS api, ${DUR(c)} AS dur ${base} LIMIT 200000`, params);
    noteResult(null);
    const all = [], byApi = new Map();
    for (const r of rows) {
      const d = Number(r.dur) || 0; all.push(d);
      (byApi.get(r.api) || byApi.set(r.api, []).get(r.api)).push(d);
    }
    const q95 = a => { if (!a.length) return null; a.sort((x, y) => x - y); return a[Math.max(0, Math.ceil(a.length * 0.95) - 1)]; };
    return {
      global: { p95: q95(all), count: all.length },
      byApi: [...byApi.entries()].map(([a, ds]) => ({ api: a || '(none)', count: ds.length, p95: q95(ds) }))
        .sort((x, y) => y.count - x.count).slice(0, 100)
    };
  }
}

/* Technical-failure share, global + per-API (errclass split on code + message). */
async function techFailStats({ hours = 1, host = null } = {}) {
  if (collectorMode()) return pgTechFailStats({ hours, host });
  const p = pool(); if (!p) throw new Error(_driverErr || 'not configured');
  const c = CFG();
  const mins = clampHours(hours) * 60;
  const [rows] = await p.query(
    `SELECT \`${c.pcol}\` AS api, COUNT(*) AS total,
            SUM(CASE WHEN NOT (${SUCCESS(c)}) AND (${CLS(c)}) = 'technical' THEN 1 ELSE 0 END) AS tech
     FROM \`${c.table}\`
     WHERE \`${c.tcol}\` >= (UTC_TIMESTAMP() - INTERVAL ? MINUTE)
     GROUP BY 1 ORDER BY total DESC LIMIT 100`, [...c.successCodes, mins]);
  noteResult(null);
  let total = 0, tech = 0;
  const byApi = rows.map(r => {
    total += Number(r.total); tech += Number(r.tech);
    return { api: r.api || '(none)', total: Number(r.total), tech: Number(r.tech),
      rate: Number(r.total) > 0 ? Number(r.tech) / Number(r.total) : null };
  });
  return { global: { total, tech, rate: total > 0 ? tech / total : null }, byApi };
}

/* One-shot payload for the Monitoring page: gauges, code distribution, duration trend,
 * top-20 slow calls, per-API health table (+ p95 merge) and the masked error-message list. */
async function overview({ hours = 24, api = null, host = null } = {}) {
  if (collectorMode()) return pgOverview({ hours, api, host });
  if (!configured()) return { configured: false, mode: mode() };
  const p = pool(); if (!p) return { configured: true, mode: 'mysql', ok: false, error: _driverErr || 'no pool' };
  const c = CFG();
  const h = clampHours(hours), mins = h * 60;
  const flt = api ? ` AND \`${c.pcol}\` = ?` : '';
  const W = `WHERE \`${c.tcol}\` >= (UTC_TIMESTAMP() - INTERVAL ? MINUTE)${flt}`;
  const wp = api ? [mins, api] : [mins];
  const bucket = h <= 1 ? 1 : h <= 6 ? 5 : 15;   // series granularity: 1/5/15-minute buckets
  try {
    const [tot] = await p.query(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN ${SUCCESS(c)} THEN 1 ELSE 0 END) AS ok
       FROM \`${c.table}\` ${W}`, [...c.successCodes, ...wp]);
    const [codes] = await p.query(
      `SELECT COALESCE(NULLIF(\`${c.ccol}\`,''),'(none)') AS code, COUNT(*) AS n,
              CASE WHEN ${SUCCESS(c)} THEN 'success' ELSE (${CLS(c)}) END AS cls
       FROM \`${c.table}\` ${W} GROUP BY 1, 3 ORDER BY n DESC LIMIT 15`, [...c.successCodes, ...wp]);
    const [ser] = await p.query(
      `SELECT (${MINS(c)} DIV ${bucket}) * ${bucket} AS m,
              AVG(${DUR(c)}) AS avg_ms, MAX(${DUR(c)}) AS max_ms, COUNT(*) AS n
       FROM \`${c.table}\` ${W} GROUP BY 1 ORDER BY 1`, wp);
    const [slow] = await p.query(
      `SELECT \`${c.tcol}\` AS at, \`${c.pcol}\` AS api, \`${c.xcol}\` AS txn,
              \`${c.ccol}\` AS code, ${DUR(c)} AS ms
       FROM \`${c.table}\` ${W} ORDER BY ${DUR(c)} DESC LIMIT 20`, wp);
    const [perApi] = await p.query(
      `SELECT \`${c.pcol}\` AS api, COUNT(*) AS calls,
              SUM(CASE WHEN ${SUCCESS(c)} THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN NOT (${SUCCESS(c)}) AND (${CLS(c)}) = 'business'  THEN 1 ELSE 0 END) AS biz,
              SUM(CASE WHEN NOT (${SUCCESS(c)}) AND (${CLS(c)}) = 'technical' THEN 1 ELSE 0 END) AS tech,
              AVG(${DUR(c)}) AS avg_ms, MAX(${DUR(c)}) AS max_ms
       FROM \`${c.table}\` ${W} GROUP BY 1 ORDER BY calls DESC LIMIT 100`,
      [...c.successCodes, ...c.successCodes, ...c.successCodes, ...wp]);
    const [errs] = await p.query(
      `SELECT COALESCE(NULLIF(\`${c.ccol}\`,''),'(none)') AS code, \`${c.mcol}\` AS msg, COUNT(*) AS n,
              (${CLS(c)}) AS cls
       FROM \`${c.table}\` ${W} AND NOT (${SUCCESS(c)}) AND COALESCE(\`${c.mcol}\`,'') <> ''
       GROUP BY 1, 2, 4 ORDER BY n DESC LIMIT 15`, [...wp, ...c.successCodes]);
    const [apis] = await p.query(
      `SELECT DISTINCT \`${c.pcol}\` AS api FROM \`${c.table}\`
       WHERE \`${c.tcol}\` >= (UTC_TIMESTAMP() - INTERVAL ? MINUTE) ORDER BY 1 LIMIT 300`, [mins]);
    let p95 = null;
    try { p95 = await p95Stats({ hours: h, api }); } catch (e) { /* p95 optional — table still renders */ }
    const p95ByApi = new Map((p95 && p95.byApi || []).map(r => [r.api, r.p95]));
    noteResult(null);
    const total = Number(tot[0].total) || 0, ok = Number(tot[0].ok) || 0;
    return {
      configured: true, ok: true, mode: 'mysql', hours: h, api: api || null, bucketMin: bucket,
      successCodes: c.successCodes, durationUnit: c.durMult === 1000 ? 's' : 'ms',
      gauges: { total, success: ok, failure: total - ok },
      codes: codes.map(r => ({ code: r.code, count: Number(r.n), cls: r.cls })),
      series: ser.map(r => ({ t: bucketToIso(Number(r.m)), avg: r.avg_ms == null ? null : Math.round(Number(r.avg_ms)), max: r.max_ms == null ? null : Math.round(Number(r.max_ms)), n: Number(r.n) })),
      slowest: slow.map(r => ({ at: r.at, api: r.api, txn: r.txn, code: r.code, ms: Math.round(Number(r.ms) || 0) })),
      perApi: perApi.map(r => {
        const calls = Number(r.calls) || 0, okN = Number(r.ok) || 0;
        return { api: r.api || '(none)', calls, success: okN, business: Number(r.biz) || 0, technical: Number(r.tech) || 0,
          successRate: calls > 0 ? okN / calls : null,
          avgMs: r.avg_ms == null ? null : Math.round(Number(r.avg_ms)),
          maxMs: r.max_ms == null ? null : Math.round(Number(r.max_ms)),
          p95Ms: p95ByApi.has(r.api || '(none)') ? Math.round(p95ByApi.get(r.api || '(none)')) : null };
      }),
      globalP95: p95 && p95.global && p95.global.p95 != null ? Math.round(p95.global.p95) : null,
      errors: errs.map(r => ({ code: r.code, msg: maskText(r.msg), count: Number(r.n), cls: r.cls })),
      apis: apis.map(r => r.api).filter(Boolean)
    };
  } catch (e) {
    noteResult(e);
    return { configured: true, ok: false, error: e.message, code: e.code };
  }
}

/* ---- latency thresholds (console_settings key 'api_latency_thresholds') --------------------
 * Read directly through db.console (NOT settings.js — settings→sync→metrics would make a require
 * cycle). Shape: { globalMs: Number, perApi: { '<path>': Number } }. The api_latency_p95 metric
 * emits value = p95 / effective-threshold, so per-API dim rows breach their OWN threshold while
 * the alert rule stays a plain 'gte 1.0' for the existing alertRunner comparator. */
const THRESH_DEFAULTS = { globalMs: 1500, perApi: {} };
async function latencyThresholds() {
  try {
    const db = require('./db');
    const r = await db.console.query(`SELECT value FROM console_settings WHERE key='api_latency_thresholds'`);
    if (!r.rowCount) return { ...THRESH_DEFAULTS };
    const v = r.rows[0].value || {};
    const globalMs = Number(v.globalMs) > 0 ? Number(v.globalMs) : THRESH_DEFAULTS.globalMs;
    // perApi = the effective per-API lines: history-derived (perApiAuto, apiLatencyBaseline.js) under manual overrides
    const manual = {}, perApiAuto = {};
    for (const [k, ms] of Object.entries(v.perApiAuto || {})) if (Number(ms) > 0) perApiAuto[k] = Number(ms);
    for (const [k, ms] of Object.entries(v.perApi || {})) if (Number(ms) > 0) manual[k] = Number(ms);
    return { globalMs, perApi: { ...perApiAuto, ...manual }, manual, perApiAuto, auto: v.auto || null };
  } catch (e) { return { ...THRESH_DEFAULTS }; }
}

module.exports = { configured, mode, ping, status, overview, p95Stats, techFailStats, latencyThresholds, THRESH_DEFAULTS, maskText };
