#!/usr/bin/env node
/* DMS DATA-TIER DISCOVERY — what can 152 actually reach, and what is in there?
 *
 * WHY
 * Before building anything for dealers we need three facts, in order:
 *   1. which Clara / MaxScale endpoints are reachable from 152 at all (firewall, not credentials)
 *   2. which of them answer as MySQL, and as which server version / role
 *   3. what schemas and tables exist, and which of them look dealer-related
 * Guessing any of these wastes a SOC ticket, so this asks the network and the catalogue directly.
 *
 * ONE FACT WE ALREADY HAVE: the console reads logs.uil_logs over MySQL on 172.31.43.72, which is
 * one of the three Clara nodes in the HLD. So the route 152 → 43.72:3306 is already open and
 * already has a working credential. That credential may or may not see the DMS schemas — this
 * script reports exactly which, rather than assuming either way.
 *
 * READ-ONLY BY CONSTRUCTION. It runs SHOW DATABASES, reads information_schema, and — only with
 * --counts — SELECT count(*) on candidate tables. It never reads a customer row, never writes,
 * and never prints a password.
 *
 * Usage (from /apps/console/server, after `set -a; . ../.env; set +a`):
 *   node dms-discover.cjs                 # TCP probe every known endpoint + enumerate what we can
 *   node dms-discover.cjs --probe         # reachability only, no login attempts
 *   node dms-discover.cjs --url mysql://user:pass@host:3306/db
 *   node dms-discover.cjs --reuse-osb     # try the working OSB credential against the other nodes
 *   node dms-discover.cjs --schema dms_db --counts    # row counts for candidate tables
 *   node dms-discover.cjs --json          # machine-readable, for pasting back here
 */
'use strict';

const net = require('net');
const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const JSONOUT = has('--json');
const out = { probed: [], servers: [], notes: [] };
const say = (...a) => { if (!JSONOUT) console.log(...a); };

/* Endpoints from the DMS HLD data tier. VIPs first: if a VIP answers, prefer it — it survives a
 * node failover, a pinned node does not. */
const TARGETS = [
  { host: '172.16.1.115', port: 3306, role: 'Clara VIP (primary DMS data store)' },
  { host: '172.31.43.75', port: 3306, role: 'MaxScale proxy VIP' },
  { host: '172.31.43.75', port: 4006, role: 'MaxScale read/write listener (common port)' },
  { host: '172.31.43.84', port: 3306, role: 'MaxScale node .84' },
  { host: '172.31.43.72', port: 3306, role: 'Clara node .72 — ALREADY USED for logs.uil_logs' },
  { host: '172.31.43.73', port: 3306, role: 'Clara node .73' },
  { host: '172.31.43.74', port: 3306, role: 'Clara node .74' }
];

/* Table-name signals. Deliberately broad: the point is to SEE the vocabulary this schema uses,
 * not to confirm a guess. Anything matching is listed for a human to judge. */
const DEALER_WORDS = /(dealer|seller|agent|merchant|outlet|branch|shop|store|pos|distributor|partner|reseller|commission|incentive|target|stock|inventory|sim|msisdn|activation|order|subscriber|customer|user|wallet|balance|topup|recharge|voucher|kyc|document)/i;

function tcp(host, port, timeout = 2500) {
  return new Promise(resolve => {
    const t0 = Date.now(); const s = new net.Socket(); let done = false;
    const finish = r => { if (done) return; done = true; try { s.destroy(); } catch (_) {} resolve(r); };
    s.setTimeout(timeout);
    s.once('connect', () => finish({ ok: true, ms: Date.now() - t0 }));
    s.once('timeout', () => finish({ ok: false, error: 'timeout' }));
    s.once('error', e => finish({ ok: false, error: e.code || e.message }));
    s.connect(port, host);
  });
}

const maskUrl = u => String(u || '').replace(/:\/\/([^:]+):[^@]*@/, '://$1:****@');

async function probeAll() {
  say('\n▸ REACHABILITY from this host (TCP connect, 2.5s budget)\n');
  for (const t of TARGETS) {
    const r = await tcp(t.host, t.port);
    out.probed.push({ ...t, ...r });
    say(`  ${r.ok ? '✓' : '✗'}  ${(t.host + ':' + t.port).padEnd(22)} ${r.ok ? String(r.ms + ' ms').padEnd(8) : String(r.error).padEnd(8)} ${t.role}`);
  }
  const open = out.probed.filter(p => p.ok);
  say(`\n  ${open.length} of ${out.probed.length} endpoints reachable.`);
  if (!open.length) say('  → Nothing is open. This is a firewall/SOC question, not a credentials one.');
  return open;
}

async function enumerate(url, label) {
  let mysql; try { mysql = require('mysql2/promise'); }
  catch (e) { say('  ✗ mysql2 not installed here — run this from /apps/console/server'); return null; }
  const server = { label, url: maskUrl(url), schemas: [], error: null };
  let conn;
  try {
    conn = await mysql.createConnection({ uri: url, connectTimeout: 6000 });
    const [[ver]] = await conn.query('SELECT VERSION() v, @@hostname h, @@read_only ro, CURRENT_USER() u, DATABASE() d');
    server.version = ver.v; server.hostname = ver.h; server.read_only = !!ver.ro; server.user = ver.u; server.default_db = ver.d;
    say(`\n  connected · MySQL ${ver.v} · host ${ver.h} · user ${ver.u} · read_only=${ver.ro ? 'YES' : 'no'}`);

    /* Sizes and row estimates come from information_schema (the optimiser's own statistics):
     * no table is scanned, so this is safe against a production cluster. */
    const [rows] = await conn.query(
      `SELECT table_schema, count(*) tables, sum(table_rows) est_rows,
              round(sum(data_length + index_length)/1024/1024) mb
         FROM information_schema.tables
        WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys')
        GROUP BY table_schema ORDER BY mb DESC`);
    if (!rows.length) { say('  (no non-system schemas visible to this user)'); }
    rows.forEach(r => {
      server.schemas.push({ schema: r.table_schema, tables: Number(r.tables), est_rows: Number(r.est_rows || 0), mb: Number(r.mb || 0) });
      say(`    ${String(r.table_schema).padEnd(28)} ${String(r.tables).padStart(5)} tables  ${String(Number(r.est_rows || 0).toLocaleString()).padStart(14)} rows (est)  ${String(r.mb || 0).padStart(7)} MB`);
    });

    const only = val('--schema', '');
    for (const s of server.schemas) {
      if (only && s.schema !== only) continue;
      const [tabs] = await conn.query(
        `SELECT table_name, table_rows, round((data_length+index_length)/1024/1024) mb
           FROM information_schema.tables WHERE table_schema = ? ORDER BY (data_length+index_length) DESC`, [s.schema]);
      s.candidates = tabs.filter(t => DEALER_WORDS.test(t.table_name))
        .map(t => ({ table: t.table_name, est_rows: Number(t.table_rows || 0), mb: Number(t.mb || 0) }));
      s.biggest = tabs.slice(0, 8).map(t => ({ table: t.table_name, est_rows: Number(t.table_rows || 0), mb: Number(t.mb || 0) }));
      if (only || s.candidates.length) {
        say(`\n    ── ${s.schema}: ${s.candidates.length} dealer-related table name(s) of ${tabs.length}`);
        s.candidates.slice(0, 40).forEach(t =>
          say(`       ${t.table.padEnd(42)} ${String(t.est_rows.toLocaleString()).padStart(14)} rows (est) ${String(t.mb).padStart(6)} MB`));
      }
      if (only && has('--counts')) {
        say(`\n    exact counts (${s.schema}) — these DO scan, keep the list short:`);
        for (const t of s.candidates.slice(0, 15)) {
          try {
            const [[c]] = await conn.query(`SELECT count(*) n FROM \`${s.schema}\`.\`${t.table}\``);
            t.exact_rows = Number(c.n); say(`       ${t.table.padEnd(42)} ${String(t.exact_rows.toLocaleString()).padStart(14)}`);
          } catch (e) { t.count_error = e.message; say(`       ${t.table.padEnd(42)} ✗ ${e.message}`); }
        }
      }
    }
  } catch (e) {
    server.error = e.message;
    say(`  ✗ ${e.message}`);
    if (/Access denied/i.test(e.message)) say('    → reachable, but this credential has no rights here. Ask the DMS DBA for a read-only user.');
    if (/Unknown database/i.test(e.message)) say('    → connected; the database name in the URL does not exist. Drop the /db suffix to list what does.');
  } finally { if (conn) try { await conn.end(); } catch (_) {} }
  out.servers.push(server);
  return server;
}

/* ---- CLUSTER TRUTH -------------------------------------------------------------------
 * WHY THIS EXISTS, AND THE MISTAKE IT CORRECTED (21 Aug 2026)
 * The first pass showed the same schema at very different sizes per node — dms_audit_logs at
 * 70,864 MB on digdbp01 versus 91,419 MB on digdbp03, plus esmg inverted (4,765 MB vs 1 MB) — and
 * that was read as evidence of divergence, on the reasoning that data_length is "real bytes on
 * disk" rather than an estimate. THAT REASONING WAS WRONG.
 * This check proved all three nodes identical: Galera size=3, status=Primary, state=Synced, the
 * same wsrep_cluster_state_uuid, the SAME wsrep_last_committed, and max(insert_date_time) equal
 * to the second across all five endpoints.
 * The lesson, worth keeping: in a multi-master cluster each node owns its own tablespaces, so
 * data_length reflects fragmentation, purge timing and when that node last rebuilt — not content.
 * table_rows is worse still (per-node ANALYZE timing). NEITHER can compare content between nodes.
 * Only a logical check can: last_committed, a max(timestamp), or a checksum. Ask the server what
 * it thinks it is before inferring anything from its storage statistics. */
async function clusterState(url, label) {
  let mysql; try { mysql = require('mysql2/promise'); } catch (e) { return; }
  let c;
  try {
    c = await mysql.createConnection({ uri: url, connectTimeout: 6000 });
    const [[id]] = await c.query('SELECT @@server_id sid, @@hostname h, @@read_only ro, @@log_bin lb, @@version v');
    const g = {};
    try {
      const [rows] = await c.query(`SHOW GLOBAL STATUS WHERE Variable_name IN
        ('wsrep_cluster_size','wsrep_cluster_status','wsrep_local_state_comment','wsrep_ready',
         'wsrep_last_committed','wsrep_local_recv_queue_avg','wsrep_flow_control_paused','wsrep_cluster_state_uuid')`);
      rows.forEach(r => { g[r.Variable_name] = r.Value; });
    } catch (_) {}
    let slave = null;
    try { const [rs] = await c.query('SHOW SLAVE STATUS'); if (rs && rs.length) slave = rs[0]; } catch (_) {}
    const rec = { label, server_id: id.sid, hostname: id.h, read_only: !!id.ro, log_bin: !!id.lb, version: id.v,
      galera: Object.keys(g).length ? g : null,
      slave: slave ? { io: slave.Slave_IO_Running, sql: slave.Slave_SQL_Running,
        lag_sec: slave.Seconds_Behind_Master, master: slave.Master_Host, error: slave.Last_Error || null } : null };
    out.cluster = out.cluster || []; out.cluster.push(rec);
    say(`\n  ${label}`);
    say(`    hostname ${rec.hostname} · server_id ${rec.server_id} · read_only=${rec.read_only ? 'YES' : 'no'} · log_bin=${rec.log_bin ? 'on' : 'off'}`);
    if (rec.galera) {
      say(`    GALERA  size=${g.wsrep_cluster_size} status=${g.wsrep_cluster_status} state=${g.wsrep_local_state_comment} ready=${g.wsrep_ready}`);
      say(`            uuid=${g.wsrep_cluster_state_uuid} last_committed=${g.wsrep_last_committed} recv_queue_avg=${g.wsrep_local_recv_queue_avg} fc_paused=${g.wsrep_flow_control_paused}`);
    } else say('    GALERA  not a Galera node (no wsrep_* status)');
    if (rec.slave) say(`    REPLICA io=${rec.slave.io} sql=${rec.slave.sql} lag=${rec.slave.lag_sec}s master=${rec.slave.master}${rec.slave.error ? ' ERROR: ' + rec.slave.error : ''}`);
    else say('    REPLICA not configured as an async replica');
  } catch (e) { say(`\n  ${label}\n    ✗ ${e.message}`); }
  finally { if (c) try { await c.end(); } catch (_) {} }
}

/* Freshness beats size for "is this node behind": one indexed max(<time col>) per node, compared.
 * Usage: --freshness dms_audit_logs.sim_activation_logs:created_date */
async function freshness(urls, spec) {
  const [tbl, col] = String(spec).split(':');
  const [schema, table] = String(tbl).split('.');
  if (!schema || !table || !col) { say('  --freshness needs schema.table:time_column'); return; }
  let mysql; try { mysql = require('mysql2/promise'); } catch (e) { return; }
  say(`\n▸ FRESHNESS · max(${col}) and count on ${schema}.${table}, per node\n`);
  out.freshness = [];
  for (const u of urls) {
    let c;
    try {
      c = await mysql.createConnection({ uri: u.url, connectTimeout: 6000 });
      const [[r]] = await c.query(`SELECT max(\`${col}\`) newest, min(\`${col}\`) oldest FROM \`${schema}\`.\`${table}\``);
      out.freshness.push({ node: u.label, newest: r.newest, oldest: r.oldest });
      say(`  ${u.label.padEnd(46)} newest ${String(r.newest)}`);
    } catch (e) { say(`  ${u.label.padEnd(46)} ✗ ${e.message}`); }
    finally { if (c) try { await c.end(); } catch (_) {} }
  }
  say('\n  Nodes whose newest row is materially older are BEHIND. That is the node not to read from.');
}

/* Column shapes for the tables we intend to build on — names, types, keys. No row is read. */
async function columns(url, schema, tables) {
  let mysql; try { mysql = require('mysql2/promise'); } catch (e) { return; }
  let c;
  try {
    c = await mysql.createConnection({ uri: url, connectTimeout: 6000 });
    out.columns = {};
    for (const t of tables) {
      const [cols] = await c.query(
        `SELECT column_name, column_type, is_nullable, column_key, extra
           FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position`, [schema, t]);
      if (!cols.length) { say(`\n  ── ${schema}.${t}  (not found)`); continue; }
      out.columns[t] = cols.map(x => ({ name: x.COLUMN_NAME || x.column_name, type: x.COLUMN_TYPE || x.column_type,
        nullable: (x.IS_NULLABLE || x.is_nullable) === 'YES', key: x.COLUMN_KEY || x.column_key, extra: x.EXTRA || x.extra }));
      say(`\n  ── ${schema}.${t}  (${cols.length} columns)`);
      out.columns[t].forEach(x => say(`     ${String(x.name).padEnd(34)} ${String(x.type).padEnd(24)}${x.key ? ' [' + x.key + ']' : ''}${x.nullable ? '' : ' NOT NULL'}`));
    }
  } catch (e) { say(`  ✗ ${e.message}`); }
  finally { if (c) try { await c.end(); } catch (_) {} }
}

(async () => {
  say('DMS DATA-TIER DISCOVERY — read-only\n' + '='.repeat(62));
  const open = await probeAll();
  if (has('--probe')) return done();

  const urls = [];
  const explicit = val('--url', '') || process.env.DMS_DB_URL || '';
  if (explicit) urls.push({ url: explicit, label: 'DMS_DB_URL / --url' });

  /* Reuse the credential we know works (OSB_LOG_URL → 43.72) against the other endpoints. A DBA
   * often grants one account across the cluster; if so we can enumerate today instead of waiting
   * on a ticket. If not, the Access-denied message says so plainly. */
  if (has('--reuse-osb') || !urls.length) {
    const osb = process.env.OSB_LOG_URL || '';
    if (osb) {
      urls.push({ url: osb, label: 'OSB_LOG_URL (known-good credential)' });
      const m = osb.match(/^(mysql:\/\/[^@]+@)([^:/]+)(:\d+)?(\/.*)?$/i);
      if (m && has('--reuse-osb')) {
        for (const t of open) {
          if (t.host === m[2] || t.port !== 3306) continue;
          urls.push({ url: `${m[1]}${t.host}:3306`, label: `OSB credential → ${t.host} (${t.role})` });
        }
      }
    } else out.notes.push('OSB_LOG_URL is not set, so there is no known-good MySQL credential to reuse.');
  }

  if (!urls.length) {
    say('\n▸ No credentials to try. Re-run with --url mysql://user:pass@host:3306 once the DMS DBA provides a read-only account.');
    return done();
  }
  // --cluster / --freshness / --columns are targeted follow-ups; they skip the full enumeration
  if (has('--cluster')) {
    say('\n▸ CLUSTER STATE — what each server says about itself');
    for (const u of urls) await clusterState(u.url, u.label);
    return done();
  }
  if (has('--freshness')) { await freshness(urls, val('--freshness', '')); return done(); }
  /* --list <schema>: EVERY table, not just the ones whose name matches the dealer vocabulary.
     Added because trms_wallet has nine tables and the keyword filter only surfaced four — the
     wallet statement lives in one of the five it hid. */
  if (has('--list')) {
    const schema = val('--list', '') || val('--schema', '');
    if (!schema) { say('  --list needs a schema name'); return done(); }
    let mysql; try { mysql = require('mysql2/promise'); } catch (e) { return done(); }
    let c;
    try {
      c = await mysql.createConnection({ uri: urls[0].url, connectTimeout: 6000 });
      const [rows] = await c.query(
        `SELECT table_name, table_rows, round((data_length+index_length)/1024/1024) mb
           FROM information_schema.tables WHERE table_schema = ? ORDER BY (data_length+index_length) DESC`, [schema]);
      say(`\n▸ ALL TABLES in ${schema} (${rows.length})\n`);
      rows.forEach(r => say(`  ${String(r.TABLE_NAME || r.table_name).padEnd(38)} ${String(Number(r.TABLE_ROWS || r.table_rows || 0).toLocaleString()).padStart(14)} rows (est) ${String(r.mb || 0).padStart(7)} MB`));
      out.list = rows.map(r => ({ table: r.TABLE_NAME || r.table_name, est_rows: Number(r.TABLE_ROWS || r.table_rows || 0), mb: Number(r.mb || 0) }));
    } catch (e) { say('  ✗ ' + e.message); }
    finally { if (c) try { await c.end(); } catch (_) {} }
    return done();
  }
  if (has('--columns')) {
    const schema = val('--schema', 'dms_v1');
    const tables = String(val('--tables', '')).split(',').map(s => s.trim()).filter(Boolean);
    if (!tables.length) { say('  --columns needs --tables a,b,c'); return done(); }
    say(`\n▸ COLUMNS · ${schema} · ${tables.length} table(s)`);
    await columns(urls[0].url, schema, tables);
    return done();
  }
  for (const u of urls) {
    say(`\n▸ ${u.label}  ${maskUrl(u.url)}`);
    await enumerate(u.url, u.label);
  }
  done();

  function done() {
    if (JSONOUT) console.log(JSON.stringify(out, null, 1));
    else {
      const reach = out.probed.filter(p => p.ok).map(p => `${p.host}:${p.port}`);
      const schemas = [...new Set(out.servers.flatMap(s => (s.schemas || []).map(x => x.schema)))];
      say('\n' + '='.repeat(62));
      say(`SUMMARY · reachable: ${reach.join(', ') || 'none'}`);
      say(`          schemas visible: ${schemas.join(', ') || 'none'}`);
      say('          next: pick a schema and re-run with --schema <name> [--counts]');
    }
    process.exit(0);
  }
})();
