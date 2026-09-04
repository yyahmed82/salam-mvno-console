/* DMS (Clara) MariaDB — READ-ONLY connection + runtime schema discovery.
 *
 * WHAT THIS TALKS TO
 * The DMS data tier is a 3-node MariaDB 10.6 Galera cluster (mvno-digdbp01/02/03). All nodes are
 * Synced and hold identical data — verified by matching wsrep_last_committed and an identical
 * max(timestamp) across every endpoint, NOT by comparing storage statistics, which differ per
 * node purely from fragmentation and purge timing. Default target is the MaxScale VIP
 * 172.31.43.75, which load-balances and survives a node failover; a pinned node does not.
 *
 * WHY SCHEMA DISCOVERY RATHER THAN HARD-CODED SQL
 * We did not write this schema and cannot see a migration history. 128 tables in dms_v1 alone,
 * with real inconsistencies already visible (`external_refrence`, `fpe_vlaue_type`, tables that
 * exist twice in different letter-cases). Hard-coding a column name we have not verified produces
 * a query that fails at 2am for one dealer. Instead every table is probed once through
 * information_schema, cached, and each query is built ONLY from columns that actually exist —
 * missing ones come back null with a reason. A schema change degrades a field; it never 500s.
 *
 * READ-ONLY BY CONSTRUCTION: this module issues SELECT only. The account can write; we do not.
 *
 * Env:
 *   DMS_DB_URL = mysql://user:pass@172.31.43.75:3306      (no database — schemas are qualified)
 *   If unset, falls back to the OSB credential pointed at the MaxScale VIP, since the DMS cluster
 *   and the OSB log host are the same cluster (dms_audit_logs.uil_logs lives on it).
 *   DMS_DB_MAX (default 4) · DMS_DB_TIMEOUT_MS (default 15000)
 */
'use strict';

let mysql = null;
try { mysql = require('mysql2/promise'); } catch (e) { /* reported through status() */ }

const VIP = process.env.DMS_DB_HOST || '172.31.43.75';

function url() {
  if (process.env.DMS_DB_URL) return process.env.DMS_DB_URL;
  const osb = process.env.OSB_LOG_URL || '';
  // reuse the known-good credential, but always against the VIP and with no default database
  const m = osb.match(/^(mysql:\/\/[^@]+@)([^:/]+)(:\d+)?(\/.*)?$/i);
  return m ? `${m[1]}${VIP}:3306` : '';
}
const configured = () => !!url() && !!mysql;

let _pool = null;
function pool() {
  if (!configured()) throw new Error('DMS database not configured (set DMS_DB_URL, or OSB_LOG_URL to reuse its credential)');
  if (!_pool) _pool = mysql.createPool({
    uri: url(), connectionLimit: Number(process.env.DMS_DB_MAX) || 4,
    connectTimeout: 8000, waitForConnections: true, queueLimit: 0,
    // never let a bad predicate on a 362-million-row audit table hold a connection open
    timezone: 'Z'
  });
  return _pool;
}

const TIMEOUT = () => Number(process.env.DMS_DB_TIMEOUT_MS) || 15000;

async function q(sql, params = []) {
  const [rows] = await pool().query({ sql, timeout: TIMEOUT() }, params);
  return rows;
}

/* ---- schema cache: which columns really exist, per table ---- */
const _cols = new Map();          // "schema.table" -> Set(lowercased column names)
async function columnsOf(schema, table) {
  const key = `${schema}.${table}`.toLowerCase();
  if (_cols.has(key)) return _cols.get(key);
  let set = new Set();
  try {
    const rows = await q(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=?`, [schema, table]);
    rows.forEach(r => set.add(String(r.COLUMN_NAME || r.column_name).toLowerCase()));
  } catch (e) { /* leave empty — callers degrade to nulls */ }
  _cols.set(key, set);
  return set;
}
/* pick the first column that exists, from a list of plausible names — the schema uses several
 * spellings for the same idea (created_on / created_at / created_date) */
async function pick(schema, table, candidates) {
  const have = await columnsOf(schema, table);
  for (const c of candidates) if (have.has(String(c).toLowerCase())) return c;
  return null;
}
async function hasTable(schema, table) { return (await columnsOf(schema, table)).size > 0; }

/* WHICH COLUMNS ARE INDEXED — added after a per-dealer lookup on a 5.8 M-row table died with
 * "Query inactivity timeout". Probing for a column's EXISTENCE is not enough on tables this
 * size: a predicate on an unindexed column is a full scan, and on wallet_payment_initiate that
 * is 2.7 GB of it. Callers use this to choose a predicate the database can actually serve, and
 * to refuse with an explanation rather than hang when no usable index exists.
 * Only the FIRST column of each index is returned: that is the one a single-column WHERE can use. */
const _idx = new Map();
async function indexedCols(schema, table) {
  const key = `${schema}.${table}`.toLowerCase();
  if (_idx.has(key)) return _idx.get(key);
  const set = new Set();
  try {
    const rows = await q(
      `SELECT column_name, index_name FROM information_schema.statistics
        WHERE table_schema=? AND table_name=? AND seq_in_index=1`, [schema, table]);
    rows.forEach(r => set.add(String(r.COLUMN_NAME || r.column_name).toLowerCase()));
  } catch (e) { }
  _idx.set(key, set);
  return set;
}
/* one-off query with its own timeout — for user-initiated reports that are legitimately slower
 * than a dashboard tile, but still must not run forever */
async function qSlow(sql, params = [], ms = 60000) {
  const [rows] = await pool().query({ sql, timeout: ms }, params);
  return rows;
}

/* SELECT list built only from columns that exist; the rest come back as NULL so the shape of the
 * response never changes and the UI can say "not in this schema" instead of breaking. */
async function selectList(schema, table, wanted, alias = '') {
  const have = await columnsOf(schema, table);
  const p = alias ? alias + '.' : '';
  return wanted.map(c => have.has(c.toLowerCase()) ? `${p}\`${c}\`` : `NULL AS \`${c}\``).join(', ');
}

async function ping() {
  if (!configured()) return { configured: false };
  const t0 = Date.now();
  try {
    const r = await q('SELECT @@hostname h, @@version v, VERSION() vv');
    let galera = null;
    try {
      const g = await q(`SHOW GLOBAL STATUS WHERE Variable_name IN ('wsrep_cluster_size','wsrep_local_state_comment')`);
      galera = Object.fromEntries(g.map(x => [x.Variable_name, x.Value]));
    } catch (_) {}
    return { configured: true, ok: true, ms: Date.now() - t0, host: r[0].h, version: r[0].v,
      target: VIP, galera };
  } catch (e) { return { configured: true, ok: false, ms: Date.now() - t0, error: e.message, target: VIP }; }
}

function status() { return { configured: configured(), target: VIP, driver: !!mysql, cached_tables: _cols.size }; }

module.exports = { configured, q, qSlow, columnsOf, indexedCols, pick, hasTable, selectList, ping, status };
