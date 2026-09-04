/* fixed.js — Fixed / Salam Home domain entry point for the unified console (stage 1: read `sda_ops*`).
 *
 * Phase 0 ships only the connectivity probe. Phase 1 adds the domain modules (fixed360.js, fixedMap.js,
 * fixedErrors.js …) and mounts their routes from here, so api.js never grows Fixed-specific SQL.
 * Every route lives under /api/fixed/* (namespacing contract, plan §2.1). */
const db = require('./db');
const roles = require('./roles');

async function probe(pool, sql, params = []) {
  if (!pool) return { configured: false };
  const t0 = Date.now();
  try {
    const r = await pool.query(sql, params);
    return { configured: true, ok: true, ms: Date.now() - t0, ...(r.rows[0] || {}) };
  } catch (e) { return { configured: true, ok: false, ms: Date.now() - t0, error: e.message }; }
}

/* What each source looks like when it is alive. Cheap queries only — these run on every health call. */
async function status() {
  const [ops, nexus, payments] = await Promise.all([
    probe(db.ops, `SELECT
        (SELECT count(*)::int FROM order_attempts)                       AS attempts,
        (SELECT max(started_at) FROM order_attempts)                      AS newest_attempt,
        (SELECT count(*)::int FROM dealers)                               AS dealers,
        (SELECT count(*)::int FROM error_events)                          AS error_events,
        (SELECT last_ts FROM ingest_state WHERE source='replica' LIMIT 1) AS ingest_cursor,
        current_database()                                                AS db`),
    probe(db.nexus, `SELECT current_database() AS db, now() AS server_now`),
    probe(db.payments, `SELECT current_database() AS db, now() AS server_now`),
  ]);
  return { enabled: roles.FIXED_ENABLED, views: roles.FIXED_VIEWS, ops, nexus, payments };
}

function mount(app) {
  // GET /api/fixed/ping — proves the stage-1 wiring (unified console → sda_ops_beta / nexus / payments_v2)
  app.get('/api/fixed/ping', async (req, res) => {
    try { res.json(await status()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { mount, status };
