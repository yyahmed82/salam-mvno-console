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
  'seller_deductions',
  /* VAS / SERVICE LOGS (4 Sep 2026) — behind the CMS "Service Logs" page and the Sub360 VAS
   * panel. Prod probe (salam_production) proved the CMS tabs (boosters/toogles/…) are FILTERS
   * over ONE polymorphic table: public.service_logs (~3.76M rows). services/service_groups
   * first (FK parents for names/groups). Initial pull via windowed backfill, incremental after. */
  'services', 'service_groups', 'service_logs',
  // SMS/OTP health (Monitoring ④ + Unifonic incident forensics): otps powers the sent→verified
  // funnel (the app discards the SMS gateway response, so this is the delivery evidence);
  // sms_vendors shows which vendor (Unifonic/Msegat) is live.
  'otps', 'sms_vendors',
  /* LOGIN VISIBILITY. users is the ONLY table a login writes to: AuthenticationController#create
   * calls Trackable#update_tracked_fields! the moment the password is accepted, setting
   * current_sign_in_at / last_sign_in_at / current_sign_in_ip / sign_in_count / platform /
   * app_version. Without it the console cannot see that anyone logged in — the snapshot simply
   * stops at the last full copy, which reads exactly like "sign-in tracking is broken" and cost
   * us a wrong conclusion once. Kept LAST: the first pass is a large catch-up and must not delay
   * the operational tables above. Credential columns are never copied — see SKIP_COLUMNS. */
  'users'
];

/* Columns that must NEVER be replicated, per table. The console is an ops replica: it needs to
 * know WHEN someone signed in, never WHAT would let anyone sign in as them. password_digest and
 * otp_secret_key are exactly that material (otp_secret_key is the TOTP seed — holding it is
 * equivalent to being able to mint the customer's login OTP), so they are dropped at the source
 * query and never travel over the wire. */
const SKIP_COLUMNS = {
  users: ['password_digest', 'otp_secret_key', 'reset_password_token', 'confirmation_token',
    'unlock_token', 'authentication_token', 'encrypted_password']
};

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
    // timezone=UTC is REQUIRED: the sync's cutoff compares `created_at <= now() - lag` against a
    // `timestamp WITHOUT time zone` column, so a non-UTC session shifts the window by the offset.
    options: `-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=${stmtMs} -c idle_in_transaction_session_timeout=${stmtMs + 60000}`
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
/* Non-primary UNIQUE indexes. An UPSERT can name only ONE conflict target, so any OTHER unique
 * index is a second way the insert can fail — and `users` has one on mobile_number. Partial
 * indexes (indpred) and expression indexes (attnum 0) are excluded: their predicate cannot be
 * evaluated here, so a delete built from them could remove a row that would not have collided. */
async function uniqueKeys(pool, schema, table) {
  const r = await pool.query(
    /* attname::text is REQUIRED: attname is type `name`, so array_agg would return name[] (oid
     * 1003), for which node-pg has no array parser — it hands back the literal string
     * "{mobile_number}" and every array method on it fails. text[] parses correctly. */
    `SELECT i.indexrelid::regclass::text AS name, array_agg(a.attname::text ORDER BY k.ord) AS cols
       FROM pg_index i
       JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indrelid = ($1)::regclass AND i.indisunique AND NOT i.indisprimary
        AND i.indpred IS NULL AND i.indexprs IS NULL
      GROUP BY i.indexrelid`, [`"${schema}"."${table}"`]);
  // belt and braces: if any driver still hands back the literal "{a,b}", parse it here
  const toArr = v => Array.isArray(v) ? v
    : String(v || '').replace(/^\{|\}$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).filter(Boolean);
  return r.rows.map(x => ({ name: x.name, cols: toArr(x.cols) })).filter(x => x.cols.length);
}
async function primaryKey(pool, schema, table) {
  const r = await pool.query(
    `SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = ($1)::regclass AND i.indisprimary`, [`"${schema}"."${table}"`]);
  return r.rows.map(x => x.attname);
}
/* JSON SAFETY. A json/jsonb column on our side is often plain text on prod (or holds '' / a
 * non-JSON string). Passing that through raw makes Postgres reject the WHOLE batch with
 * "invalid input syntax for type json" — one poison row then blocks the table on every tick,
 * silently, until someone notices the data is stale. (Observed: delivery_requests froze for
 * 18h from 2026-08-29 17:40 on exactly this.) So we guarantee valid JSON, without losing data:
 *   ''  -> NULL          (empty string has no JSON representation)
 *   valid JSON -> as-is  (untouched)
 *   anything else -> encoded as a JSON string, so the original text survives and is queryable */
const coerce = (val, type) => {
  if (val == null) return null;
  if (type !== 'json' && type !== 'jsonb') return val;
  if (typeof val !== 'string') return JSON.stringify(val);
  const s = val.trim();
  if (s === '') return null;
  try { JSON.parse(s); return val; } catch (_) { return JSON.stringify(val); }
};

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
/* AUTO-CREATE (4 Sep 2026): the engine used to require the local table to pre-exist (the
 * original replica seed provided them) — a table newly added to DEFAULT_TABLES silently
 * skipped 'not present locally' (the VAS service-log tables). Now the local shell is created
 * from the PROD schema: analytics-loose types (varchars→text), pk carried over. */
async function createLocalFromProd(prod, prodSchema, table) {
  const pc = await columns(prod, prodSchema, table);
  if (!pc.length) throw new Error('prod columns unreadable for ' + table);
  const pkArr = await primaryKey(prod, prodSchema, table);
  const T = t => {
    const d = String(t).toLowerCase();
    if (/bigint|bigserial/.test(d)) return 'bigint';
    if (/int|serial/.test(d)) return 'integer';
    if (/uuid/.test(d)) return 'uuid';
    if (/bool/.test(d)) return 'boolean';
    if (/timestamp/.test(d)) return 'timestamptz';
    if (/^date$/.test(d)) return 'date';
    if (/numeric|decimal|double|real|money/.test(d)) return 'numeric';
    if (/jsonb?/.test(d)) return 'jsonb';
    return 'text';
  };
  const defs = pc.map(c => `"${c.column_name}" ${T(c.data_type)}`);
  if (pkArr.length === 1) defs.push(`PRIMARY KEY ("${pkArr[0]}")`);
  await db.source.query(`CREATE TABLE IF NOT EXISTS "public"."${table}" (${defs.join(', ')})`);
  console.log(`[PROD-SYNC] created local table public.${table} (${pc.length} cols) from prod schema`);
}

async function planTable(prod, table) {
  let [ls, ps] = await Promise.all([resolveSchema(db.source, table), resolveSchema(prod, table)]);
  if (!ps) return { skip: 'not present on prod' };
  if (!ls) {
    try { await createLocalFromProd(prod, ps.table_schema, table); ls = await resolveSchema(db.source, table); }
    catch (e) { return { skip: 'not present locally · auto-create failed: ' + e.message.slice(0, 80) }; }
  }
  if (!ls) return { skip: 'not present locally' };
  const localSchema = ls.table_schema, prodSchema = ps.table_schema;
  /* Serialised on purpose: db.source is a max-1 pool, so firing these together makes node-pg
   * queue them on the one client and emit the "client.query() while already executing" warning. */
  const lc = await columns(db.source, localSchema, table);
  const pkArr = await primaryKey(db.source, localSchema, table);
  const uniques = await uniqueKeys(db.source, localSchema, table);
  const pc = await columns(prod, prodSchema, table);
  if (!pkArr.length) return { skip: 'no primary key (local)' };
  const pk = pkArr[0];
  const prodCols = new Set(pc.map(c => c.column_name));
  const typeOf = Object.fromEntries(lc.map(c => [c.column_name, c.data_type]));
  const skip = new Set(SKIP_COLUMNS[table] || []);
  const cols = lc.map(c => c.column_name).filter(c => prodCols.has(c) && !skip.has(c));   // intersection, ordered by local
  if (!cols.includes(pk)) return { skip: 'pk missing on prod' };
  const has = c => cols.includes(c);
  const wmExpr = has('updated_at') && has('created_at') ? `COALESCE(updated_at, created_at)`
    : has('updated_at') ? 'updated_at' : has('created_at') ? 'created_at' : null;
  // only unique keys whose columns we actually carry can be checked against the incoming rows
  const uq = uniques.filter(u => u.cols.every(c => cols.includes(c)));
  return { table, pk, cols, typeOf, wmExpr, prodSchema, localSchema, uniques: uq };
}

async function upsertBatch(local, schema, table, pk, cols, typeOf, rows, uniques = []) {
  if (!rows.length) return;
  const per = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    /* RETIRE SUPERSEDED ROWS FIRST.
     * ON CONFLICT resolves the PK and nothing else, so an incoming row carrying a NEW id whose
     * mobile_number still belongs to an OLD local id raises
     *   duplicate key value violates unique constraint "index_users_on_mobile_number".
     * That is not corruption, it is the login flow: AuthenticationController#find_resource
     * DELETES the account of a DEACTIVATED subscriber, the customer re-registers, and prod
     * legitimately reissues the same number under a new id — while our snapshot still holds the
     * old one. The old row is dead upstream, so drop it, scoped to the values in THIS chunk and
     * never touching a row the batch is about to update anyway (pk <> ALL incoming ids). */
    for (const u of uniques) {
      const usable = chunk.filter(r => u.cols.every(c => r[c] != null && cols.includes(c)));
      if (!usable.length) continue;
      const p = [];
      const tuples = usable.map(r => '(' + u.cols.map(c => {
        p.push(coerce(r[c], typeOf[c])); return `$${p.length}::${typeOf[c] || 'text'}`;
      }).join(',') + ')').join(',');
      p.push(usable.map(r => String(r[pk])));
      const del = `DELETE FROM "${schema}"."${table}"
        WHERE (${u.cols.map(c => `"${c}"`).join(',')}) IN (${tuples})
          AND "${pk}"::text <> ALL($${p.length}::text[])`;
      try { await local.query(del, p); }
      catch (e) { throw new Error(`could not retire superseded rows on unique index ${u.name} (${u.cols.join(',')}): ${e.message}`); }
    }
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
  const { pk, cols, typeOf, wmExpr, prodSchema, localSchema, uniques } = plan;
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
    // surface the extra unique keys: they are what an ON CONFLICT (pk) upsert cannot resolve
    return { table, rows: Number(c.rows[0].n), dryRun: true, windowed,
      uniqueKeys: (uniques || []).map(u => `${u.name} (${u.cols.join(',')})`) };
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
    await upsertBatch(db.source, localSchema, table, pk, cols, typeOf, q.rows, uniques);
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
  /* New rows landed in the replica → every cached dashboard answer is now behind the data. Mark the response cache
   * stale so the next hit (and the keep-warm loop) recomputes instead of serving the pre-sync figures for another
   * TTL. Without this, after a backlog catch-up the KPI tiles kept showing the zeros computed while the replica
   * was 6 h behind — restored from the on-disk snapshot at boot and refreshed only on their own TTL. */
  if (!dryRun && rows > 0) { try { require('./respCache').invalidate(); console.log(`[prod-sync] ${rows} rows imported → response cache marked stale`); } catch (_) {} }
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

/* ON-DEMAND SINGLE-ROW REFRESH.
 * The scheduler runs every 30 minutes, which is fine for dashboards and useless when an operator
 * is watching one customer and asking "I just logged in — why don't I see it?". This pulls only
 * the rows matching one indexed lookup and upserts them, using the SAME plan (skipped credential
 * columns, unique-key retirement) as a full pass, so it can never import anything a normal sync
 * would not. Table/column are whitelisted — never taken from the request. */
const REFRESHABLE = { users: ['mobile_number', 'nationality_id_number', 'id'] };

async function refreshWhere(table, column, values) {
  const allowed = REFRESHABLE[table];
  if (!allowed) throw new Error(`table not refreshable: ${table}`);
  if (!allowed.includes(column)) throw new Error(`column not refreshable: ${column}`);
  const vals = (Array.isArray(values) ? values : [values]).map(String).filter(Boolean).slice(0, 25);
  if (!vals.length) return { table, rows: 0, skipped: 'no values' };
  const prod = prodPool();
  try {
    const plan = await planTable(prod, table);
    if (plan.skip) return { table, rows: 0, skipped: plan.skip };
    const { pk, cols, typeOf, prodSchema, localSchema, uniques } = plan;
    const sel = cols.map(c => `"${c}"`).join(',');
    const q = await prod.query(
      `SELECT ${sel} FROM "${prodSchema}"."${table}" WHERE "${column}"::text = ANY($1::text[]) LIMIT 50`, [vals]);
    if (q.rows.length) await upsertBatch(db.source, localSchema, table, pk, cols, typeOf, q.rows, uniques);
    return { table, rows: q.rows.length, matched_on: column };
  } finally { await prod.end().catch(() => {}); }
}

module.exports = { run, probe, ping, isRunning, DEFAULT_TABLES, SKIP_COLUMNS, refreshWhere };

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
