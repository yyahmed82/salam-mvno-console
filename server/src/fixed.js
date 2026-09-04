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
        current_database()                                                AS db,
        current_schema()                                                  AS schema`),
    probe(db.nexus, `SELECT current_database() AS db, now() AS server_now`),
    probe(db.payments, `SELECT current_database() AS db, now() AS server_now`),
  ]);
  return { enabled: roles.FIXED_ENABLED, views: roles.FIXED_VIEWS, ops, nexus, payments };
}

function mount(app, { requireView, audit } = {}) {
  const gate = requireView ? requireView('fixed') : (req, res, next) => next();
  const f360 = require('./fixed360');
  const wrap = fn => async (req, res) => {
    try { res.json(await fn(req.query || {}, req)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
  // GET /api/fixed/ping — proves the stage-1 wiring (unified console → sda_ops_beta / nexus / payments_v2)
  app.get('/api/fixed/ping', wrap(() => status()));
  // Phase 1 — Fixed / Salam Home dashboards over the dealer-ops read model (view: fixed)
  app.get('/api/fixed/summary',   gate, wrap(q => f360.summary(q)));
  app.get('/api/fixed/b2c',       gate, wrap(q => f360.b2cOverview(q)));
  app.get('/api/fixed/attempts',  gate, wrap(async (q, req) => { const r = await f360.attempts(q);
    if (audit && q.find) audit(req, 'fixed.search', String(q.find).slice(0, 40), { rows: r.rows.length }); return r; }));
  app.get('/api/fixed/dealers',   gate, wrap(q => f360.dealers(q)));
  app.get('/api/fixed/errors',    gate, wrap(q => f360.errorFeed(q)));
}

module.exports = { mount, status };
