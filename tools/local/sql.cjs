#!/usr/bin/env node
/* Read-only SQL through the tunnel, using the URLs in .env.local — 152 has no psql, so run this from the laptop.
 *   node tools/local/sql.cjs OPS   "select count(*) from order_attempts"
 *   node tools/local/sql.cjs NEXUS "select now()"        (OPS | NEXUS | PAYMENTS | SOURCE | UPG)
 * Opens ONE connection, runs the statement inside a READ ONLY transaction, closes.
 *   --write   run the statement in a normal (read-write) transaction and COMMIT — for deliberate one-off DDL only. */
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const env = {};
for (const l of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (!m) continue;
  let v = m[2]; if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const args = process.argv.slice(2); const WRITE = args.includes('--write'); const [which, sql] = args.filter(a => a !== '--write');
const key = { OPS: 'OPS_DATABASE_URL', OPS_BETA: 'OPS_BETA_DATABASE_URL', NEXUS: 'NEXUS_DATABASE_URL', PAYMENTS: 'PAYMENTS_DATABASE_URL', SOURCE: 'SOURCE_DATABASE_URL', UPG: 'UPG_DATABASE_URL', CONSOLE: 'CONSOLE_DATABASE_URL' }[String(which || '').toUpperCase()];
if (!key || !sql) { console.error('usage: node tools/local/sql.cjs OPS|OPS_BETA|NEXUS|PAYMENTS|SOURCE|UPG|CONSOLE "<sql>"'); process.exit(2); }
let url = env[key]; if (!url) { console.error(key + ' not set in .env.local'); process.exit(2); }
let schema = null;
try { const u = new URL(url); schema = u.searchParams.get('schema'); for (const k of ['schema','connection_limit','pool_timeout']) u.searchParams.delete(k); url = u.toString(); } catch (_) {}
const { Client } = require(path.join(root, 'server', 'node_modules', 'pg'));
(async () => {
  const c = new Client({ connectionString: url, application_name: 'salam_unified_sqltool', statement_timeout: 30000 });
  await c.connect();
  if (schema) await c.query(`SET search_path TO ${schema.replace(/[^a-zA-Z0-9_]/g, '')}, public`);
  await c.query(WRITE ? 'BEGIN' : 'BEGIN READ ONLY');
  const t0 = Date.now(); const r = await c.query(sql);
  await c.query(WRITE ? 'COMMIT' : 'ROLLBACK'); await c.end();
  console.table(r.rows); console.error(`${r.rowCount} row(s) · ${Date.now() - t0} ms`);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
