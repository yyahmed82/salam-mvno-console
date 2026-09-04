/* OSB integration-layer log reader — the BSS READ-path SOAP faults (response 1500 / "OSB-382000")
 * that hit list-invoices / get-account / get-sub during the IMPACT R7.2 Siebel CNE go-live are logged
 * in a SEPARATE MySQL DB (logs.uil_logs on the OSB side), NOT in the selfcare Postgres replica.
 *
 * READ-ONLY and INERT until configured. Enable by pointing it at that DB (get the real host from the
 * DMS/API-GW HLD or the OSB/BSS team — NOT 172.31.38.145, which is a FIXED/FTTH server, not MVNO):
 *   OSB_LOG_URL = mysql://user:pass@<osb-mysql-host>:3306/logs   (or OSB_DB_HOST/PORT/USER/PASSWORD/NAME)
 * Schema is configurable (the console has only observed it via screenshots), defaults below:
 *   OSB_LOG_TABLE=uil_logs  OSB_LOG_TIME_COL=insert_date_time  OSB_LOG_CODE_COL=response_code
 *   OSB_LOG_MSG_COL=response_message  OSB_LOG_API_COL=api_name  OSB_FAULT_CODE=1500
 * Never interpolate untrusted values — identifiers are env-sourced and sanitised; the fault code is bound.
 */
const ident = s => String(s || '').replace(/[^A-Za-z0-9_]/g, '');   // safe SQL identifier (env-sourced)
const CFG = () => ({
  url: process.env.OSB_LOG_URL || '',
  host: process.env.OSB_DB_HOST || '', port: Number(process.env.OSB_DB_PORT || 3306),
  user: process.env.OSB_DB_USER || '', password: process.env.OSB_DB_PASSWORD || '', database: process.env.OSB_DB_NAME || 'logs',
  table: ident(process.env.OSB_LOG_TABLE || 'uil_logs'),
  tcol: ident(process.env.OSB_LOG_TIME_COL || 'insert_date_time'),
  ccol: ident(process.env.OSB_LOG_CODE_COL || 'response_code'),
  mcol: ident(process.env.OSB_LOG_MSG_COL || 'response_message'),
  acol: ident(process.env.OSB_LOG_API_COL || 'api_name'),
  faultCode: String(process.env.OSB_FAULT_CODE || '1500')
});

function configured() { return !!(process.env.OSB_LOG_URL || process.env.OSB_DB_HOST); }

/* A URL whose password contains a raw '@' or ':' is ambiguous — different drivers split it
 * differently, so it may silently authenticate as the wrong user or with a truncated password.
 * Catch it at config time and say so, instead of letting it surface as "Access denied". */
function urlProblem(url) {
  if (!url) return null;
  const after = url.replace(/^[a-z0-9+]+:\/\//i, '');
  const at = (after.match(/@/g) || []).length;
  if (at === 0) return 'no "@" separating credentials from host — the URL is malformed';
  if (at > 1) return 'the password contains an unescaped "@" — percent-encode it as %40';
  // '#' is the fragment delimiter: everything after it is DISCARDED, so host/port/database vanish
  // and the driver fails with something unrelated. '?' starts the query string, same idea.
  const creds = after.slice(0, after.lastIndexOf('@'));
  if (creds.includes('#')) return 'the password contains an unescaped "#" — it truncates the URL '
                               + '(host, port and database are lost). Percent-encode it as %23';
  if (creds.includes('?')) return 'the password contains an unescaped "?" — percent-encode it as %3F';
  try { new URL(url); } catch (e) { return `not a parseable URL (${e.code || e.message})`; }
  return null;
}

/* Repeated bad-credential attempts are not harmless: at one probe every 5 min that is ~288 failed
 * logins a day from a server IP, which can lock the account or trip SOC alerting. After a few
 * consecutive auth failures we latch OFF and report why, rather than hammering forever. */
const AUTH_ERRORS = ['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_NOT_SUPPORTED_AUTH_MODE'];
const MAX_AUTH_FAILS = Number(process.env.OSB_MAX_AUTH_FAILS || 3);
let _pool = null, _driverErr = null, _authFails = 0, _lockedOut = null;

function pool() {
  if (!configured()) return null;
  if (_lockedOut) { _driverErr = _lockedOut; return null; }
  if (_pool) return _pool;
  const c = CFG();
  const bad = urlProblem(c.url);
  if (bad) { _driverErr = `OSB_LOG_URL is malformed: ${bad}`; return null; }
  let mysql;
  try { mysql = require('mysql2/promise'); }
  catch (e) { _driverErr = "mysql2 driver not installed — add it to server/package.json and rebuild"; return null; }
  _pool = c.url
    ? mysql.createPool(c.url + (c.url.includes('?') ? '&' : '?') + 'connectionLimit=3')
    : mysql.createPool({ host: c.host, port: c.port, user: c.user, password: c.password, database: c.database, connectionLimit: 3 });
  return _pool;
}

/* Record the outcome of a connection attempt; latch off after repeated credential rejections. */
function noteResult(err) {
  if (!err) { _authFails = 0; return; }
  if (!AUTH_ERRORS.includes(err.code)) return;          // network blips are retried, bad creds are not
  if (++_authFails >= MAX_AUTH_FAILS) {
    _lockedOut = `stopped after ${_authFails} consecutive credential rejections (${err.code}) — `
      + 'fix OSB_LOG_URL / the MySQL grant and restart the console. Retrying would risk locking the account.';
    console.error('OSB log reader: ' + _lockedOut);
    if (_pool) { try { _pool.end(); } catch (e) {} _pool = null; }
  }
}

async function ping() {
  if (!configured()) return { ok: false, configured: false };
  const p = pool(); if (!p) return { ok: false, configured: true, error: _driverErr || 'no pool' };
  try { await p.query('SELECT 1'); noteResult(null); return { ok: true, configured: true }; }
  catch (e) { noteResult(e); return { ok: false, configured: true, error: e.message, code: e.code }; }
}

/* Live OSB fault view over the last N minutes: total, per-minute frequency series, and top APIs.
 * Matches rows whose response code = the fault code (default 1500) OR message mentions the OSB fault. */
async function faults({ minutes = 60 } = {}) {
  if (!configured()) return { configured: false };
  const p = pool(); if (!p) return { configured: true, ok: false, error: _driverErr || 'no pool' };
  const c = CFG();
  const m = Math.max(1, Math.min(1440, Number(minutes) || 60));
  const where = `(\`${c.ccol}\` = ? OR \`${c.mcol}\` LIKE '%OSB-382000%') AND \`${c.tcol}\` >= (NOW() - INTERVAL ? MINUTE)`;
  try {
    const [tot] = await p.query(`SELECT count(*) AS n FROM \`${c.table}\` WHERE ${where}`, [c.faultCode, m]);
    const [ser] = await p.query(
      `SELECT DATE_FORMAT(\`${c.tcol}\`, '%Y-%m-%d %H:%i') AS t, count(*) AS n
       FROM \`${c.table}\` WHERE ${where} GROUP BY 1 ORDER BY 1`, [c.faultCode, m]);
    const [byApi] = await p.query(
      `SELECT \`${c.acol}\` AS api, count(*) AS n
       FROM \`${c.table}\` WHERE ${where} GROUP BY 1 ORDER BY n DESC LIMIT 20`, [c.faultCode, m]);
    const [sample] = await p.query(
      `SELECT \`${c.mcol}\` AS msg FROM \`${c.table}\` WHERE ${where} ORDER BY \`${c.tcol}\` DESC LIMIT 1`, [c.faultCode, m]);
    const series = ser.map(r => ({ t: r.t, count: Number(r.n) }));
    const peak = series.reduce((mx, r) => Math.max(mx, r.count), 0);
    return {
      configured: true, ok: true, minutes: m, faultCode: c.faultCode,
      total: Number(tot[0].n), peakPerMin: peak,
      byApi: byApi.map(r => ({ api: r.api, count: Number(r.n) })),
      series, sampleMessage: (sample[0] && sample[0].msg) || null
    };
  } catch (e) { noteResult(e); return { configured: true, ok: false, error: e.message, code: e.code }; }
}

/* Per-transaction lookup — the UIL/OSB side of one call: api name, response code/message, and
 * (when the table has them) the REQUEST/RESPONSE payload columns. Column names differ between
 * UIL versions, so: the txn column is env-configurable (OSB_LOG_TXN_COL, default transaction_id),
 * we SELECT * with a tight LIMIT and keep only known-safe + payload-looking fields in JS, and an
 * unknown-column error latches the feature off with a clear note instead of erroring every call. */
let _txnColBad = null;
let _txnCol = null;                     // discovered/validated once, then cached for the process
let _txnIdxOk = null;                   // index-gate cache: null = unchecked, then true/false
const maskDigits = s => String(s == null ? '' : s)
  .replace(/(\+?966|00966|0)?5\d{8}/g, m => m.slice(0, 2) + '*******' + m.slice(-2))
  .replace(/\b[12]\d{9}\b/g, m => m.slice(0, 2) + '******' + m.slice(-2));

/* Auto-discover the transaction-id column: OSB_LOG_TXN_COL wins if set; otherwise SHOW COLUMNS
 * and pick the first transaction/txn-looking name. No match → latch off, LISTING the columns so
 * fixing it is a 10-second env edit rather than a schema hunt. */
async function resolveTxnCol(p, c) {
  if (_txnCol) return _txnCol;
  if (process.env.OSB_LOG_TXN_COL) { _txnCol = ident(process.env.OSB_LOG_TXN_COL); return _txnCol; }
  const [cols] = await p.query(`SHOW COLUMNS FROM \`${c.table}\``);
  const names = cols.map(r => r.Field);
  const hit = names.find(n => /^(uil[_-]?)?(transaction|txn)[_-]?id$/i.test(n))
           || names.find(n => /transaction|txn/i.test(n));
  if (!hit) {
    _txnColBad = `no transaction-id-like column in ${c.table} — set OSB_LOG_TXN_COL. Columns: ${names.slice(0, 30).join(', ')}`;
    return null;
  }
  _txnCol = ident(hit);
  console.log(`OSB log reader: transaction column auto-discovered → ${c.table}.${_txnCol}`);
  return _txnCol;
}

async function byTxn(txn) {
  if (!configured()) return { configured: false };
  if (_txnColBad) return { configured: true, ok: false, error: _txnColBad };
  const p = pool(); if (!p) return { configured: true, ok: false, error: _driverErr || 'no pool' };
  const c = CFG();
  let xcol;
  try { xcol = await resolveTxnCol(p, c); }
  catch (e) { noteResult(e); return { configured: true, ok: false, error: e.message, code: e.code }; }
  if (!xcol) return { configured: true, ok: false, error: _txnColBad };
  const t = String(txn || '').trim();
  if (!/^[\w.-]{4,64}$/.test(t)) return { configured: true, ok: false, error: 'invalid transaction id' };
  // INDEX GATE (same rule as the UPG pool): uil_logs is the OSB's full integration log — a
  // WHERE on an unindexed column is a full scan of a huge table ON THE OSB DB. Never run it.
  try {
    if (_txnIdxOk == null) {
      const [ix] = await p.query(`SHOW INDEX FROM \`${c.table}\``);
      _txnIdxOk = ix.some(r => Number(r.Seq_in_index) === 1 && r.Column_name === xcol);
    }
  } catch (e) { _txnIdxOk = false; }
  if (!_txnIdxOk) return { configured: true, ok: false,
    error: `${c.table}.${xcol} has no index — lookup skipped to protect the OSB DB. ` +
           `Ask the OSB/DB owner to run: CREATE INDEX idx_uil_txn ON ${c.table} (${xcol}); then restart the console` };
  try {
    const [rows] = await p.query(
      `SELECT /*+ MAX_EXECUTION_TIME(5000) */ * FROM \`${c.table}\` WHERE \`${xcol}\` = ? ORDER BY \`${c.tcol}\` DESC LIMIT 6`, [t]);
    noteResult(null);
    const KEEP = new RegExp(`^(${c.tcol}|${c.ccol}|${c.mcol}|${c.acol}|${xcol}|status|http.*|.*code|.*message|api.*|service.*|operation.*)$`, 'i');
    const PAYLOAD = /request|response|payload|body|xml|soap/i;
    const out = rows.map(r => {
      const row = { fields: {}, payloads: {} };
      for (const [k, v] of Object.entries(r)) {
        if (v == null || v === '') continue;
        if (PAYLOAD.test(k) && String(v).length > 60)
          row.payloads[k] = maskDigits(String(v)).slice(0, 6000);   // the request/response bodies
        else if (KEEP.test(k)) row.fields[k] = maskDigits(String(v)).slice(0, 400);
      }
      return row;
    });
    return { configured: true, ok: true, txn: t, table: c.table, rows: out };
  } catch (e) {
    noteResult(e);
    if (e.code === 'ER_BAD_FIELD_ERROR') {
      // env-forced column doesn't exist → clear the cache and latch with the fix
      _txnCol = null;
      _txnColBad = `${c.table} has no '${xcol}' column — fix OSB_LOG_TXN_COL (or unset it for auto-discovery) and restart`;
      return { configured: true, ok: false, error: _txnColBad };
    }
    return { configured: true, ok: false, error: e.message, code: e.code };
  }
}

function status() {
  const c = CFG();
  // Mask everything between the first ':' after the user and the LAST '@' — a password containing
  // '@' would otherwise leak past a lazy mask (this is how the password reached a screenshot).
  const masked = c.url ? c.url.replace(/^([a-z0-9+]+:\/\/[^:/@]+:).*(@[^@]*)$/i, '$1****$2') : null;
  return { configured: configured(), table: c.table, faultCode: c.faultCode,
    target: masked || (c.host ? `${c.host}:${c.port}/${c.database}` : null),
    urlProblem: urlProblem(c.url), lockedOut: _lockedOut, authFailures: _authFails };
}

/* IMPACTED CUSTOMERS for a fault window — the list BSS/Oracle keep asking for by mail as raw
 * pasted MSISDNs (see "RE: Increase in 1500 error", 26 Aug). One bounded query over the fault
 * rows in the window, identifiers extracted from every string field in JS (payload column names
 * vary between UIL versions, so regex-over-row beats guessing columns), aggregated per
 * identifier. Time-filtered on the indexed time column, LIMIT 4000 rows scanned,
 * MAX_EXECUTION_TIME 8s — the OSB DB is protected the same way byTxn protects it.
 * RETURNS RAW identifiers — the API layer masks by default and audits unmasked reads. */
async function impacted({ minutes = 360, limit = 4000 } = {}) {
  if (!configured()) return { configured: false };
  const p = pool(); if (!p) return { configured: true, ok: false, error: _driverErr || 'no pool' };
  const c = CFG();
  const m = Math.max(5, Math.min(7 * 1440, Number(minutes) || 360));
  const where = `(\`${c.ccol}\` = ? OR \`${c.mcol}\` LIKE '%OSB-382000%') AND \`${c.tcol}\` >= (NOW() - INTERVAL ? MINUTE)`;
  try {
    const [rows] = await p.query(
      `SELECT /*+ MAX_EXECUTION_TIME(8000) */ * FROM \`${c.table}\` WHERE ${where}
       ORDER BY \`${c.tcol}\` DESC LIMIT ${Math.min(8000, Math.max(100, Number(limit) || 4000))}`,
      [c.faultCode, m]);
    const agg = new Map();     // id -> { id, type, n, apis:Set, first, last }
    for (const r of rows) {
      const ts = r[c.tcol], api = r[c.acol] || '';
      const seen = new Set();  // one hit per row per identifier
      for (const v of Object.values(r)) {
        if (typeof v !== 'string' || v.length < 8 || v.length > 20000) continue;
        for (const mm of v.matchAll(/\b(?:966)?5\d{8}\b|\b[12]\d{9}\b|\b\d{9,10}15\b/g)) {
          let id = mm[0], type;
          if (/^(?:966)?5\d{8}$/.test(id)) { id = '966' + id.slice(-9); type = 'msisdn'; }
          else if (/^[12]\d{9}$/.test(id)) type = 'national_id';
          else type = 'account';
          const k = type + ':' + id;
          if (seen.has(k)) continue;
          seen.add(k);
          const a = agg.get(k) || { id, type, n: 0, apis: new Set(), first: ts, last: ts };
          a.n++; if (api) a.apis.add(String(api));
          if (ts < a.first) a.first = ts;
          if (ts > a.last) a.last = ts;
          agg.set(k, a);
        }
      }
    }
    noteResult(null);
    return { configured: true, ok: true, minutes: m, rows_scanned: rows.length,
      truncated: rows.length >= Math.min(8000, Number(limit) || 4000),
      impacted: [...agg.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, 500)
        .map(a => ({ id: a.id, type: a.type, hits: a.n, apis: [...a.apis].slice(0, 4).join(' · '),
                     first: a.first, last: a.last })) };
  } catch (e) { noteResult(e); return { configured: true, ok: false, error: e.message, code: e.code }; }
}

module.exports = { configured, ping, faults, status, byTxn, impacted };
