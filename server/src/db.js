const { Pool } = require('pg');

const SOURCE_URL = process.env.SOURCE_DATABASE_URL
  || 'postgres://postgres:postgres@db:5432/salam_development_11';
const CONSOLE_URL = process.env.CONSOLE_DATABASE_URL
  || 'postgres://postgres:postgres@db:5432/mvno_console';

/* Every connection MUST run with the session timezone pinned to UTC.
 *
 * The app stores created_at/updated_at as `timestamp WITHOUT time zone` holding UTC. When Postgres
 * compares such a column against a timestamptz — `created_at >= now() - interval '1 hour'`, or a
 * bound $1::timestamptz parameter — it converts using the SESSION timezone. Server 121 defaults to
 * Asia/Riyadh (+3), which silently shifted every window 3 hours into the future: "last hour"
 * matched nothing, "last 6h" matched only the overlapping tail, and dashboards read zero while the
 * data was demonstrably present (max(created_at) 4 minutes old, h1=0, h6=1408).
 *
 * `options: '-c timezone=UTC'` applies at connection startup, so it covers pooled connections and
 * anything the driver opens later. Do not remove — pair it with TZ=UTC on the process
 * (ecosystem.prod.config.js), which fixes the Node side of the same problem. */
const PG_UTC = { options: '-c timezone=UTC' };

/* max was 4. The console now serves several panels concurrently (login funnel, payments funnel,
 * health ping, screens-flow), and a single slow query could hold a quarter of the pool — with
 * four in flight the health check's own `SELECT 1` never got a client and reported the replica
 * DOWN. Eight is still modest against the replica's connection limit and removes that cliff. */
// PG_APP_NAME tags every replica/console connection (pg_stat_activity.application_name) so the DBA can tell
// a laptop session ('salam_unified_local') from the prod instance ('salam_unified').
const APP_NAME = process.env.PG_APP_NAME || 'salam_unified';
/* 30 Sep 2026: the two agent processes load this same module; ecosystem.prod.config.js gives them small pools
 * (SOURCE_POOL_MAX / CONSOLE_POOL_MAX / OPS_POOL_MAX) so three processes do not each hold a full console-sized pool on 121. */
const source = new Pool({ connectionString: SOURCE_URL, max: Number(process.env.SOURCE_POOL_MAX) || 8, statement_timeout: 60000, application_name: APP_NAME, idleTimeoutMillis: 30000, ...PG_UTC });
const console_ = new Pool({ connectionString: CONSOLE_URL, max: Number(process.env.CONSOLE_POOL_MAX) || 4, application_name: APP_NAME, idleTimeoutMillis: 30000, ...PG_UTC });

/* UPG payment-gateway DB — OPTIONAL third pool (read-only role `upg_console_ro`).
 * Enables end-to-end payment correlation: app payment → gateway charge → state transitions →
 * webhook back. Unset UPG_DATABASE_URL and every UPG feature degrades to "not configured"
 * rather than erroring. Small pool + short timeout: this is a live production gateway DB and
 * the console must never be able to load it. */
const UPG_URL = process.env.UPG_DATABASE_URL || '';
const upg = UPG_URL
  ? new Pool({ connectionString: UPG_URL, max: 2,
      statement_timeout: Number(process.env.UPG_STATEMENT_TIMEOUT_MS) || 15000,
      idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
      application_name: 'salam_console_ro',   // visible in UPG pg_stat_activity — auditable & killable
      ...PG_UTC })
  : null;
if (upg) upg.on('error', e => { try { console.error('[UPG pool]', e.message); } catch (_) {} });

/* ---- Fixed / Salam Home side (unified console, stage 1) — ALL READ-ONLY, ALL OPTIONAL ----
 * OPS_DATABASE_URL      → sda_ops_beta: the Operations Console read model (dealers, order_attempts,
 *                         api_calls, error_events, alert_rules, incident_log, ops_docs, users).
 *                         Still written by the salam-dealer-ops watcher (opsb-ingest-watch); we only read.
 * NEXUS_DATABASE_URL    → nexus (workflow_states / api_logs / staff): live PII unmask + spot lookups only.
 *                         Never bulk-read from the console — that is the ingester's job (Phase 5).
 * PAYMENTS_DATABASE_URL → payments_v2 (applications / invoices / payments) for B2C payment health.
 * Unset = the matching Fixed feature reports "not configured"; nothing errors at boot.
 * Same guard rails as UPG: tiny pool, short statement timeout, distinct application_name so the DBA
 * can see (and kill) us in pg_stat_activity. */
/* The dealer-ops URLs are Prisma-style: `?schema=beta&connection_limit=2&pool_timeout=30&sslmode=disable`.
 * node-pg ignores `schema` (it would silently read `public` = the PROD read model instead of the beta one),
 * so we strip the Prisma-only params and pin search_path per connection from `schema=`. */
const roPool = (url, name, max = 3, timeoutMs = 15000) => {
  if (!url) return null;
  let schema = null;
  try {
    const u = new URL(url);
    schema = u.searchParams.get('schema');
    for (const k of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'connect_timeout']) u.searchParams.delete(k);
    url = u.toString();
  } catch (_) { /* unparsable → hand it to pg as-is */ }
  // READ-ONLY AT THE DRIVER: every Fixed-side connection starts with default_transaction_read_only=on, so even a
  // read-write role (sda_ops_app while the DBA grants a RO one) cannot INSERT/UPDATE/DDL from this console.
  const opts = `-c timezone=UTC -c default_transaction_read_only=on` + (schema ? ` -c search_path=${schema.replace(/[^a-zA-Z0-9_]/g, '')},public` : '');
  const pool = new Pool({ connectionString: url, max, statement_timeout: timeoutMs,
    idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, application_name: name, options: opts });
  pool.schema = schema || 'public';
  return pool;
};
const ops      = roPool(process.env.OPS_DATABASE_URL      || '', 'salam_unified_ops_ro',      Number(process.env.OPS_POOL_MAX) || 3);
const opsBeta  = roPool(process.env.OPS_BETA_DATABASE_URL || '', 'salam_unified_opsbeta_ro',  Number(process.env.OPS_BETA_POOL_MAX) || 2);   // B2C read model (Web e-purchase + Salam Home app) — the errors board runs its chip counts in parallel
const nexus    = roPool(process.env.NEXUS_DATABASE_URL    || '', 'salam_unified_nexus_ro',    2);
const payments = roPool(process.env.PAYMENTS_DATABASE_URL || '', 'salam_unified_payments_ro', 2);
for (const [n, p] of [['OPS', ops], ['OPS_BETA', opsBeta], ['NEXUS', nexus], ['PAYMENTS', payments]])
  if (p) p.on('error', e => { try { console.error(`[${n} pool]`, e.message); } catch (_) {} });

// belt & braces: if a server/role default ever overrides the startup option, force it per-connection
const pinUtc = pool => pool.on('connect', c => { c.query("SET TIME ZONE 'UTC'").catch(() => {}); });
pinUtc(source); pinUtc(console_); if (upg) pinUtc(upg); if (ops) pinUtc(ops); if (opsBeta) pinUtc(opsBeta); if (nexus) pinUtc(nexus); if (payments) pinUtc(payments);

module.exports = { source, console: console_, upg, upgConfigured: !!upg,
  ops, opsConfigured: !!ops, opsBeta, opsBetaConfigured: !!opsBeta, nexus, nexusConfigured: !!nexus, payments, paymentsConfigured: !!payments,
  SOURCE_URL, CONSOLE_URL };
