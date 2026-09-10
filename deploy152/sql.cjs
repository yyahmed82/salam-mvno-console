#!/usr/bin/env node
/* Command-line SQL runner for the SALAM console DB — READ-ONLY by policy.
 *
 * 152 has no psql, but it has Node + pg + the app's own .env, so this connects with the SAME
 * connection string and the SAME UTC pinning the app uses (both halves of the TZ fix), then prints
 * the result as a simple table. Use it to VERIFY what the dashboard shows against raw rows.
 *
 * Usage (from /apps/console/server, where the app and .env live):
 *   set -a; . ../.env; set +a           # load SOURCE_DATABASE_URL / CONSOLE_DATABASE_URL
 *   node sql.cjs "SELECT count(*) FROM onboarding_orders WHERE created_at >= now() - interval '1 day'"
 *   node sql.cjs -f query.sql           # run SQL from a file
 *   node sql.cjs --console "SELECT ..." # run against the CONSOLE db instead of the replica
 *   node sql.cjs --csv /tmp/out.csv "SELECT ..."   # write the result as CSV (UTF-8, header row) instead of a table
 *
 * Safety: refuses anything that isn't a single read (no INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/…);
 * wraps the query READ ONLY; 60s statement timeout. Source = replica (onboarding_orders, payments,
 * delivery_requests, activation_logs). --console = the console's own DB (rules, snapshots, sessions).
 */
'use strict';
process.env.TZ = 'UTC'; // half 1 of the TZ fix: node-pg parses `timestamp WITHOUT time zone` in process TZ

const args = process.argv.slice(2);
let useConsole = false, useProd = false, useNexus = false, fromFile = null, csvOut = null, sqlParts = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--console') useConsole = true;
  else if (a === '--prod') useProd = true;   // read-only peek at PRODUCTION (the sync source)
  else if (a === '--nexus') useNexus = true; // Fixed backend (nexus: workflow_states / api_logs) — read-only
  else if (a === '-f' || a === '--file') fromFile = args[++i];
  else if (a === '--csv') csvOut = args[++i];   // export: CSV file path (10 Sep 2026, RA extracts)
  // psql muscle memory: accept -c / --command so `csql -c "SELECT …"` works. Without this the
  // flag was joined INTO the query, which then failed the read-only guard with a misleading
  // "only read queries are allowed" — the query was fine, the wrapper had eaten the flag.
  else if (a === '-c' || a === '--command') { if (args[i + 1]) sqlParts.push(args[++i]); }
  else sqlParts.push(a);
}
let sql = fromFile ? require('fs').readFileSync(fromFile, 'utf8') : sqlParts.join(' ');
sql = (sql || '').trim().replace(/;\s*$/, '');
if (!sql) { console.error('No SQL given. Example:\n  node sql.cjs "SELECT now()"'); process.exit(2); }

// read-only guard: block any statement that could mutate, and block multiple statements.
// Keyword scan runs on a COPY with comments + string literals stripped, so a literal like
// '/bss/subscription/update-subscription-x' or a path containing "create-" can't false-trip it.
const scan = sql
  .replace(/--[^\n]*/g, ' ')            // -- line comments
  .replace(/\/\*[\s\S]*?\*\//g, ' ')    // /* block comments */
  .replace(/'(?:[^']|'')*'/g, "''");    // 'string literals' (incl. escaped '')
if (/;/.test(scan)) { console.error('Refusing multiple statements (`;` found). Run one query at a time.'); process.exit(2); }
if (!/^\s*(select|with|explain|show|table)\b/i.test(scan)) {
  console.error('Refusing: only read queries are allowed (SELECT / WITH / EXPLAIN / SHOW / TABLE).');
  console.error('Parsed query starts with: ' + JSON.stringify(sql.slice(0, 60)));
  console.error('Tip: pass the SQL as one quoted argument — csql "SELECT ..." (-c is accepted too).');
  process.exit(2);
}
if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|reindex|refresh|call|do)\b/i.test(scan)) {
  console.error('Refusing: statement contains a write/DDL keyword. This tool is read-only.'); process.exit(2);
}

/* --prod reads PRODUCTION directly (the same connection the replica sync pulls from). Same
 * read-only guards apply, and the tool never writes — but say so loudly, because a heavy query
 * here lands on the live database rather than the replica. */
const url = useNexus ? process.env.NEXUS_DATABASE_URL : useProd ? process.env.PROD_DATABASE_URL
  : (useConsole ? process.env.CONSOLE_DATABASE_URL : process.env.SOURCE_DATABASE_URL);
const which = useNexus ? 'NEXUS_DATABASE_URL' : useProd ? 'PROD_DATABASE_URL' : (useConsole ? 'CONSOLE_DATABASE_URL' : 'SOURCE_DATABASE_URL');
if (!url) { console.error(`Missing ${which} in env. Did you \`set -a; . ../.env; set +a\`?`); process.exit(2); }
if (useProd) console.error('⚠ Reading PRODUCTION (read-only, 60s timeout). Keep queries indexed and small.');

const { Pool } = require('pg'); // required only after guards pass (pg is the app's own dep on 152)
const pool = new Pool({ connectionString: url, max: 1, statement_timeout: 60000, options: '-c timezone=UTC' });

(async () => {
  const c = await pool.connect();
  try {
    await c.query("SET TIME ZONE 'UTC'");            // half 2: Postgres compares/renders in UTC
    await c.query('SET TRANSACTION READ ONLY').catch(() => {});
    const t0 = Date.now();
    const r = await c.query(sql);
    const ms = Date.now() - t0;
    const rows = r.rows || [];
    if (csvOut) {
      const cols = rows.length ? Object.keys(rows[0]) : (r.fields || []).map(f => f.name);
      const q = v => { const s = (v === null || v === undefined) ? '' : (v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      require('fs').writeFileSync(csvOut, '\ufeff' + [cols.join(',')].concat(rows.map(row => cols.map(k => q(row[k])).join(','))).join('\n') + '\n');
      console.error(`→ ${csvOut} (${rows.length} rows, ${cols.length} columns)`);
    }
    else if (!rows.length) { console.log('(0 rows)'); }
    else {
      const cols = Object.keys(rows[0]);
      const w = {}; cols.forEach(k => { w[k] = k.length; });
      const cell = v => (v === null || v === undefined) ? '∅' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      rows.forEach(row => cols.forEach(k => { w[k] = Math.max(w[k], cell(row[k]).length); }));
      const line = cols.map(k => k.padEnd(w[k])).join('  ');
      console.log(line);
      console.log(cols.map(k => '-'.repeat(w[k])).join('  '));
      rows.forEach(row => console.log(cols.map(k => cell(row[k]).padEnd(w[k])).join('  ')));
    }
    console.error(`\n(${rows.length} row${rows.length === 1 ? '' : 's'} · ${ms} ms · ${useNexus ? 'NEXUS (Fixed)' : useProd ? 'PRODUCTION' : useConsole ? 'CONSOLE' : 'SOURCE/replica'} db · UTC)`);
  } catch (e) {
    console.error('SQL error:', e.message);
    process.exitCode = 1;
  } finally {
    c.release(); await pool.end();
  }
})();
