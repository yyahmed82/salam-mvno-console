/* fixedAlerts.js — Fixed "Alerts" page backend (mounted by fixed.js; view gate `fixed`).
 *
 *   GET /api/fixed/alerts/rules            unified engine: alert_rules WHERE segment='fixed' (+ fixed_ metric catalog,
 *                                          + latest metric_snapshots value per rule so the page shows "now")
 *   GET /api/fixed/alerts/history?days=7   unified engine: alerts WHERE segment='fixed' OR rule_key LIKE 'fixed_%'
 *   GET /api/fixed/alerts/prod?days=7      TRANSITION ONLY — the prod Operations Console's own engine, read-only from
 *                                          db.ops (sda_ops.public alert_rules + alert_events), so the page can show
 *                                          "prod engine vs unified engine" side by side during the parity week
 *                                          (plan Phase 3). Retire this route with the prod engine.
 *
 * WRITES: toggling / editing a Fixed rule goes through the EXISTING shared endpoints in api.js —
 *   PATCH /api/rules/:id  (cap editRules)  ·  GET /api/rules/:id/history  ·  POST /api/rules/test
 * Nothing here duplicates them; the frontend (fixed-alerts.js) calls them directly. All SQL parameterised, read-only. */

function days(q, dflt = 7) { const n = Number(q.days); return Number.isFinite(n) && n > 0 ? Math.min(90, n) : dflt; }

async function rules(db) {
  const c = db.console;
  const rules = (await c.query(
    `SELECT r.*, mc.unit, mc.higher_is_bad, mc.label AS metric_label
       FROM alert_rules r LEFT JOIN metric_catalog mc ON mc.key = r.metric_key
      WHERE r.segment = 'fixed'
      ORDER BY CASE r.severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, r.name`)).rows;
  const catalog = (await c.query(`SELECT * FROM metric_catalog WHERE key LIKE 'fixed\\_%' ORDER BY key`)).rows;
  // latest snapshot per (metric, window, dim) — what the runner will compare on the next tick
  const snaps = (await c.query(
    `SELECT DISTINCT ON (metric_key, window_hours, dim) metric_key, window_hours, dim, value, sample, sim_now
       FROM metric_snapshots WHERE metric_key LIKE 'fixed\\_%'
      ORDER BY metric_key, window_hours, dim, sim_now DESC`)).rows;
  const dimMatch = (sd, rd) => Object.keys(rd || {}).every(k => String((sd || {})[k]) === String(rd[k]));
  for (const r of rules) {
    const s = snaps.find(s => s.metric_key === r.metric_key && Number(s.window_hours) === Number(r.window_hours) && dimMatch(s.dim, r.dim));
    r.latest = s ? { value: s.value, sample: s.sample, at: s.sim_now } : null;
  }
  return { rules, catalog, opsConfigured: !!db.ops };
}

async function history(db, q) {
  const d = days(q);
  const rows = (await db.console.query(
    `SELECT a.id, a.rule_id, a.rule_key, a.name, a.severity, a.team, a.status, a.metric_key, a.operator, a.threshold,
            a.observed_value, a.sample, a.window_hours, a.dim, a.message, a.fired_at, a.last_seen_at, a.resolved_at,
            a.peak_value, a.breach_count, a.ack_by, a.assignee
       FROM alerts a
      WHERE (a.segment = 'fixed' OR a.rule_key LIKE 'fixed\\_%') AND a.fired_at >= now() - ($1::int||' days')::interval
      ORDER BY (a.status='open') DESC, a.fired_at DESC LIMIT 500`, [d])).rows;
  return { days: d, rows };
}

async function prod(db, q) {
  if (!db.ops) return { configured: false, rules: [], events: [], days: days(q) };
  const d = days(q);
  const rules = (await db.ops.query(
    `SELECT key, name, description, team, severity, metric, operator, threshold, window_hours, min_sample, channel,
            active_start, active_end, scope, params, enabled, builtin, updated_at
       FROM alert_rules ORDER BY severity, name`)).rows;
  const events = (await db.ops.query(
    `SELECT rule_key, rule_name, team, severity, status, metric_value, threshold, metric_text, detail,
            window_from, window_to, fired_at
       FROM alert_events
      WHERE status = 'FIRED' AND fired_at >= now() - ($1::int||' days')::interval
      ORDER BY fired_at DESC LIMIT 300`, [d])).rows;
  // last evaluation per rule (any status) so the page can show "last checked / last value"
  const last = (await db.ops.query(
    `SELECT DISTINCT ON (rule_key) rule_key, status, metric_value, metric_text, detail, fired_at
       FROM alert_events ORDER BY rule_key, fired_at DESC`)).rows;
  return { configured: true, days: d, rules, events, last };
}

function mount(app, { gate, wrap, db }) {
  app.get('/api/fixed/alerts/rules',   gate, wrap(() => rules(db)));
  app.get('/api/fixed/alerts/history', gate, wrap(q => history(db, q)));
  app.get('/api/fixed/alerts/prod',    gate, wrap(q => prod(db, q)));
}

module.exports = { mount, rules, history, prod };
