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

/* What each source looks like when it is alive. Cheap queries only — these run on every health call.
 * Row counts come from the statistics collector (n_live_tup), not count(*): /api/health is asked on every page and
 * three exact counts over order_attempts / dealers / error_events were three table scans per call (7 Oct review). */
const EST = (tbl) => `(SELECT greatest(coalesce((SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = '${tbl}' AND schemaname = current_schema()), 0),
                                coalesce((SELECT reltuples FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = '${tbl}' AND n.nspname = current_schema()), 0))::int)`;
async function status() {
  const [ops, opsBeta, nexus, payments] = await Promise.all([
    probe(db.ops, `SELECT
        ${EST('order_attempts')}                                          AS attempts,
        (SELECT max(started_at) FROM order_attempts)                      AS newest_attempt,
        ${EST('dealers')}                                                 AS dealers,
        ${EST('error_events')}                                            AS error_events,
        (SELECT last_ts FROM ingest_state WHERE source='replica' LIMIT 1) AS ingest_cursor,
        current_database()                                                AS db,
        current_schema()                                                  AS schema`),
    probe(db.opsBeta, `SELECT current_schema() AS schema, (SELECT max(started_at) FROM order_attempts) AS newest_attempt`),
    probe(db.nexus, `SELECT current_database() AS db, now() AS server_now`),
    probe(db.payments, `SELECT current_database() AS db, now() AS server_now`),
  ]);
  return { enabled: roles.FIXED_ENABLED, views: roles.FIXED_VIEWS, ops, opsBeta, nexus, payments };
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
  // frontend config for the Fixed pages (Maps key etc.) — never secrets beyond a browser key
  app.get('/api/fixed/config', gate, (req, res) => res.json({
    mapsKey: process.env.GMAPS_KEY || null, mapId: process.env.GMAPS_MAP_ID || null,
    source: db.ops ? (db.ops.schema || 'public') : null, beta: !!db.opsBeta, nexus: !!db.nexus, payments: !!db.payments }));

  /* SUB-MODULES — one file per Fixed page, each exports mount(app, { gate, wrap, audit, requireCap, db, f360 }).
   * Optional: a missing file is simply a page that has not shipped yet. Keep this list in the hub's TAB_ORDER. */
  const deps = { gate, wrap, audit, requireCap: arguments[1] && arguments[1].requireCap, requireView, db, f360, roles };
  // page-level gates (matrix columns): each module answers to its own Fixed view; everything else stays on 'fixed'
  const VIEW_OF = { fixedMap: 'fixed_maps', fixedErrors: 'fixed_errors', fixedErrorTrend: 'fixed_errors', fixedAlerts: 'fixed_alerts', fixedDash: 'fixed_reports', fixedReport: 'fixed_reports', fixedDocs: 'fixed_explore' };
  const gateFor = v => requireView ? requireView(v) : gate;
  for (const m of ['fixedMap', 'fixedErrors', 'fixedErrorTrend', 'fixedDash', 'fixedAlerts', 'fixedDocs', 'fixedReport', 'fixedCustomer', 'fixedChannel', 'fixedEpWatch']) {
    try { const mod = require('./' + m); if (typeof mod.mount === 'function') { mod.mount(app, VIEW_OF[m] ? { ...deps, gate: gateFor(VIEW_OF[m]) } : deps); console.log(`[fixed] mounted ${m}`); } }
    catch (e) { if (e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(m)) continue; console.error(`[fixed] ${m} failed to mount:`, e.message); }
  }
}

module.exports = { mount, status };
