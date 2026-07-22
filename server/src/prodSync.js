/* Incremental, READ-ONLY sync from the prod reporting replica → the local source replica.
 *
 * Safety model:
 *  - Prod connection is forced read-only (default_transaction_read_only=on) + statement/idle timeouts,
 *    single connection, TLS. We only ever SELECT from prod.
 *  - Per-table watermark (max updated_at/created_at already local) → pull only the delta since the dump.
 *  - Keyset pagination in bounded batches, small sleep between batches (gentle on prod).
 *  - Upsert (INSERT ... ON CONFLICT (pk) DO UPDATE) into the LOCAL replica → idempotent + resumable.
 *  - Progress persisted in console.prod_sync_state; safe to interrupt and re-run.
 *  - --dry-run reports how many rows WOULD move, touching nothing.
 *
 * Env: PROD_DATABASE_URL (postgres://user:pass@host:5432/db?sslmode=require)
 *      PROD_SYNC_BATCH (default 10000), PROD_SYNC_OVERLAP_HOURS (default 6),
 *      PROD_SYNC_SLEEP_MS (default 150), PROD_SYNC_CUTOFF_LAG_MIN (default 2)
 */
const { Pool } = require('pg');
const db = require('./db');                 // db.source = LOCAL replica (target), db.console = state

const DEFAULT_TABLES = [
  // low-churn reference/parent tables first so FK children resolve.
  // 'channels' MUST precede 'nafath_logs' (nafath_logs.channel_id → channels.id, fk_rails_d768a88037).
  'plans', 'sellers', 'settings', 'versions', 'channels', 'plan_channels',
  'onboarding_orders', 'checkouts', 'payments',
  'activation_logs', 'eligibility_logs', 'nafath_logs', 'change_plan_logs', 'delivery_requests',
  'seller_deductions'
];

const BATCH   = Number(process.env.PROD_SYNC_BATCH || 10000);
const OVERLAP = Number(process.env.PROD_SYNC_OVERLAP_HOURS || 6);
const SLEEP   = Number(process.env.PROD_SYNC_SLEEP_MS || 150);
const CUTOFF_LAG_MIN = Number(process.env.PROD_SYNC_CUTOFF_LAG_MIN || 2);

let _running = false;                        // single-run lock (per process)
const isRunning = () => _running;

function prodPool() {
  const raw = process.env.PROD_DATABASE_URL;
  if (!raw) throw new Error('PROD_DATABASE_URL is not set');
  const disable = /sslmode=disable/i.test(raw);
  // Strip sslmode from the connection string so pg-connection-string doesn't force verify-full,
  // then control TLS ourselves. Internal reporting replicas commonly use a self-signed cert.
  let url = raw.replace(/\bsslmode=[^&]*/i, '').replace(/\?&/, '?').replace(/&&/g, '&').replace(/[?&]$/, '');
  // Optional CA pinning: set PROD_CA_CERT (PEM contents) to verify instead of trusting blindly.
  const ca = process.env.PROD_CA_CERT;
  const ssl = disable ? false : (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false });
  const stmtMs = Number(process.env.PROD_SYNC_STMT_TIMEOUT_MS || 600000);   // 10 min — big-table catch-up (payments)
  return new Pool({
    connectionString: url, max: 1, ssl,
    application_name: 'salam-console-prod-sync',
    connectionTimeoutMillis: Number(process.env.PROD_SYNC_CONNECT_TIMEOUT_MS || 8000),   // fail fast when VPN is down
    // hard read-only + timeouts on the prod side
    options: `-c default_transaction_read_only=on -c statement_timeout=${stmtMs} -c idle_in_transaction_session_timeout=${stmtMs + 60000}`
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// locate a table in whatever (non-system) schema holds it — via pg_catalog (not privilege-filtered
// like information_schema, which can come back empty for role-based reporting grants).
async function resolveSchema(pool, table) {
  const r = await pool.query(
    `SELECT n.nspname AS table_schema,
            CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'BASE TABLE' END AS table_type
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = $1 AND c.relkind IN ('r','p','v','m')
       AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
     ORDER BY (n.nspname='public') DESC, (c.relkind IN ('r','p')) DESC, n.nspname
     LIMIT 1`, [table]);
  return r.rows[0] || null;   // { table_schema, table_type }
}
async function columns(pool, schema, table) {
  const r = await pool.query(
    `SELECT a.attname AS column_name, t.typname AS data_type
     FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
     WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`, [schema, table]);
  return r.rows;   // data_type = pg typname: 'jsonb','json','text','_text','uuid','timestamptz',...
}
async function primaryKey(pool, schema, table) {
  const r = await pool.query(
    `SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = ($1)::regclass AND i.indisprimary`, [`"${schema}"."${table}"`]);
  return r.rows.map(x => x.attname);
}
const coerce = (val, type) => (val == null) ? null
  : (type === 'jsonb' || type === 'json') ? (typeof val === 'string' ? val : JSON.stringify(val)) : val;

async function getState(table) {
  const r = await db.console.query(`SELECT * FROM prod_sync_state WHERE table_name=$1`, [table]);
  return r.rows[0] || null;
}
async function setState(table, patch) {
  const keys = Object.keys(patch);
  const cols = ['table_name', ...keys];
  const vals = [table, ...keys.map(k => patch[k])];
  const ph = cols.map((_, i) => '$' + (i + 1));
  const upd = keys.map(k => `${k}=EXCLUDED.${k}`).join(',');
  await db.console.query(
    `INSERT INTO prod_sync_state (${cols.join(',')}) VALUES (${ph.join(',')})
       ON CONFLICT (table_name) DO UPDATE SET ${upd}`, vals);
}

// Resolve the plan for one table: schemas (prod/local), shared columns, pk, watermark expression.
async function planTable(prod, table) {
  const [ls, ps] = await Promise.all([resolveSchema(db.source, table), resolveSchema(prod, table)]);
  if (!ls) return { skip: 'not present locally' };
  if (!ps) return { skip: 'not present on prod' };
  const localSchema = ls.table_schema, prodSchema = ps.table_schema;
  const [lc, pc, pkArr] = await Promise.all([
    columns(db.source, localSchema, table), columns(prod, prodSchema, table), primaryKey(db.source, localSchema, table)]);
  if (!pkArr.length) return { skip: 'no primary key (local)' };
  const pk = pkArr[0];
  const prodCols = new Set(pc.map(c => c.column_name));
  const typeOf = Object.fromEntries(lc.map(c => [c.column_name, c.data_type]));
  const cols = lc.map(c => c.column_name).filter(c => prodCols.has(c));   // intersection, ordered by local
  if (!cols.includes(pk)) return { skip: 'pk missing on prod' };
  const has = c => cols.includes(c);
  const wmExpr = has('updated_at') && has('created_at') ? `COALESCE(updated_at, created_at)`
    : has('updated_at') ? 'updated_at' : has('created_at') ? 'created_at' : null;
  return { table, pk, cols, typeOf, wmExpr, prodSchema, localSchema };
}

async function upsertBatch(local, schema, table, pk, cols, typeOf, rows) {
  if (!rows.length) return;
  const per = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params = [];
    const values = chunk.map(r => '(' + cols.map(c => { params.push(coerce(r[c], typeOf[c])); return '$' + params.length; }).join(',') + ')').join(',');
    const set = cols.filter(c => c !== pk).map(c => `"${c}"=EXCLUDED."${c}"`).join(',');
    const sql = `INSERT INTO "${schema}"."${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES ${values}
      ON CONFLICT ("${pk}") DO UPDATE SET ${set}`;
    await local.query(sql, params);
  }
}

// Sync one table. window = {from,to} (ISO) runs a bounded [from,to) test that does NOT
// advance the saved incremental watermark. Otherwise it's the normal delta-since-dump run.
async function syncTable(prod, table, { dryRun, window }) {
  const plan = await planTable(prod, table);
  if (plan.skip) return { table, rows: 0, skipped: plan.skip };
  const { pk, cols, typeOf, wmExpr, prodSchema, localSchema } = plan;
  if (!wmExpr) return { table, rows: 0, skipped: 'no created_at/updated_at watermark' };
  const PT = `"${prodSchema}"."${table}"`, LT = `"${localSchema}"."${table}"`;

  const windowed = !!(window && window.from);
  let st = await getState(table);
  let lower, upper, upperOp;
  if (windowed) {
    lower = new Date(window.from); upper = new Date(window.to); upperOp = '<';        // [from, to)
  } else {
    let startWm = st && st.watermark ? new Date(st.watermark) : null;
    if (!startWm) {
      const m = await db.source.query(`SELECT max(${wmExpr}) m FROM ${LT}`);
      startWm = m.rows[0].m ? new Date(m.rows[0].m) : new Date('1970-01-01');
    }
    lower = new Date(startWm.getTime() - OVERLAP * 3600e3);                            // small overlap re-pull
    upper = (await prod.query(`SELECT (now() - ($1||' minutes')::interval) c`, [CUTOFF_LAG_MIN])).rows[0].c;
    upperOp = '<=';                                                                     // (last, now-lag]
  }

  if (dryRun) {
    const lo = windowed ? lower : (st && st.watermark ? new Date(st.watermark) : lower);
    const loOp = windowed ? '>=' : '>';
    const c = await prod.query(
      `SELECT count(*)::bigint n FROM ${PT} WHERE ${wmExpr} ${loOp} $1 AND ${wmExpr} ${upperOp} $2`, [lo, upper]);
    await setState(table, { last_run_at: new Date().toISOString(), last_status: windowed ? 'dry-run·window' : 'dry-run', last_error: null });
    return { table, rows: Number(c.rows[0].n), dryRun: true, windowed };
  }

  await setState(table, { last_run_at: new Date().toISOString(), last_status: windowed ? 'window' : 'running', last_error: null });
  let lastWm = lower, lastId = '', total = 0;
  const selCols = cols.map(c => `"${c}"`).join(',');
  for (;;) {
    const q = await prod.query(
      `SELECT ${selCols}, ${wmExpr} AS __wm, ${pk}::text AS __id FROM ${PT}
       WHERE (${wmExpr}, ${pk}::text) > ($1, $2) AND ${wmExpr} ${upperOp} $3
       ORDER BY ${wmExpr}, ${pk}::text LIMIT $4`, [lastWm, lastId, upper, BATCH]);
    if (!q.rows.length) break;
    await upsertBatch(db.source, localSchema, table, pk, cols, typeOf, q.rows);
    const last = q.rows[q.rows.length - 1];
    lastWm = last.__wm; lastId = last.__id; total += q.rows.length;
    // windowed test never advances the incremental cursor — only counts
    const patch = windowed ? { rows_synced: (st ? Number(st.rows_synced) : 0) + total }
                           : { watermark: lastWm, last_id: lastId, rows_synced: (st ? Number(st.rows_synced) : 0) + total };
    await setState(table, patch);
    if (q.rows.length < BATCH) break;
    if (SLEEP) await sleep(SLEEP);
  }
  await setState(table, { last_status: windowed ? 'window·ok' : 'ok', last_run_at: new Date().toISOString() });
  return { table, rows: total, windowed, watermark: windowed ? undefined : lastWm };
}

// resolve a bounded window. date = 'YYYY-MM-DD' interpreted as a KSA calendar day.
function resolveWindow({ date, from, to }) {
  if (date) {
    const f = new Date(`${date}T00:00:00+03:00`);
    return { from: f.toISOString(), to: new Date(f.getTime() + 24 * 3600e3).toISOString(), label: date + ' (KSA)' };
  }
  if (from) return { from: new Date(from).toISOString(), to: new Date(to || Date.now()).toISOString(), label: `${from}→${to || 'now'}` };
  return null;
}

// Run a full pass over the configured tables. Guarded by a single-run lock.
async function run({ tables, dryRun = false, date, from, to } = {}) {
  if (_running) throw new Error('a prod sync is already running');
  _running = true;
  const window = resolveWindow({ date, from, to });
  const list = (tables && tables.length) ? tables : DEFAULT_TABLES;
  const started = Date.now();
  const results = [];
  let prod;
  try {
    prod = prodPool();
    await prod.query('SELECT 1');                 // reachable + read-only holds
    for (const t of list) {
      try { results.push(await syncTable(prod, t, { dryRun, window })); }
      catch (e) {
        results.push({ table: t, rows: 0, error: e.message });
        try { await setState(t, { last_status: 'error', last_error: e.message, last_run_at: new Date().toISOString() }); } catch (_) {}
      }
    }
  } finally {
    _running = false;
    if (prod) await prod.end().catch(() => {});
  }
  const rows = results.reduce((a, r) => a + (r.rows || 0), 0);
  return { dryRun, windowed: !!window, window, tables: list.length, rows, seconds: Math.round((Date.now() - started) / 1000), results };
}

// Diagnostic: list prod schemas + where each default table lives (read-only).
async function probe() {
  const prod = prodPool();
  try {
    await prod.query('SELECT 1');
    const schemas = (await prod.query(
      `SELECT n.nspname AS table_schema, count(*)::int AS tables
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
       GROUP BY 1 ORDER BY 2 DESC`)).rows;
    const found = [];
    for (const t of DEFAULT_TABLES) {
      const s = await resolveSchema(prod, t);
      found.push({ table: t, schema: s ? s.table_schema : null, type: s ? s.table_type : null });
    }
    return { schemas, found };
  } finally { await prod.end().catch(() => {}); }
}

// quick reachability check — is prod reachable right now (VPN up)? fails fast, never throws.
async function ping() {
  if (!process.env.PROD_DATABASE_URL) return { ok: false, reason: 'no PROD_DATABASE_URL' };
  let pool;
  try { pool = prodPool(); await pool.query('SELECT 1'); return { ok: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
  finally { if (pool) await pool.end().catch(() => {}); }
}

module.exports = { run, probe, ping, isRunning, DEFAULT_TABLES };

// ---- CLI: node src/prodSync.js [--dry-run] [--tables=a,b,c] ----
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--probe')) {
    probe().then(({ schemas, found }) => {
      console.log('\nprod schemas:');
      schemas.forEach(s => console.log(`  ${s.table_schema.padEnd(24)} ${s.tables} tables`));
      console.log('\ndefault tables on prod:');
      found.forEach(f => console.log(`  ${f.table.padEnd(20)} ${f.schema ? f.schema + ' · ' + f.type : 'NOT FOUND'}`));
      return db.source.end();
    }).catch(e => { console.error('probe failed:', e.message); process.exit(1); });
    return;
  }
  const dryRun = args.includes('--dry-run');
  const val = k => { const a = args.find(x => x.startsWith(k + '=')); return a ? a.split('=')[1] : null; };
  const tArg = val('--tables');
  const tables = tArg ? tArg.split(',').map(s => s.trim()).filter(Boolean) : null;
  const date = val('--date'), from = val('--from'), to = val('--to');
  run({ tables, dryRun, date, from, to }).then(out => {
    const win = out.window ? ` · window ${out.window.label}` : '';
    console.log(`\nprod-sync ${dryRun ? '(DRY RUN) ' : ''}done in ${out.seconds}s — ${out.rows} rows across ${out.tables} tables${win}`);
    for (const r of out.results) console.log(`  ${r.table.padEnd(20)} ${r.error ? 'ERROR: ' + r.error : r.skipped ? 'skipped (' + r.skipped + ')' : (r.rows + (r.dryRun ? ' would sync' : ' synced'))}`);
    return Promise.all([db.source.end(), db.console.end()]);
  }).catch(e => { console.error('prod-sync failed:', e.message); process.exit(1); });
}
