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
const source = new Pool({ connectionString: SOURCE_URL, max: Number(process.env.SOURCE_POOL_MAX) || 8, statement_timeout: 60000, ...PG_UTC });
const console_ = new Pool({ connectionString: CONSOLE_URL, max: 4, ...PG_UTC });

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

// belt & braces: if a server/role default ever overrides the startup option, force it per-connection
const pinUtc = pool => pool.on('connect', c => { c.query("SET TIME ZONE 'UTC'").catch(() => {}); });
pinUtc(source); pinUtc(console_); if (upg) pinUtc(upg);

module.exports = { source, console: console_, upg, upgConfigured: !!upg, SOURCE_URL, CONSOLE_URL };
