/* alertJourney.js — the L1/L2 journey endpoints (11 Sep 2026): See → Own → Work → Close → Learn.
 *
 *  GET  /api/rules/identity                     which metrics can count distinct customers / services (and why not)
 *  POST /api/rules/preview                      "Test now" for the editor: current value + identity counts + the last
 *                                               7 days of snapshots scored against the rule → how often it would have
 *                                               fired, at which effective severity (single-customer floor applied)
 *  GET  /api/alerts/noise?segment&days          per-rule noise scorecard: fires, acked, time-to-ack, resolve reasons,
 *                                               single-customer share, re-opens — the "Learn" step for L2
 *  GET  /api/alerts/:id/timeline                one merged timeline of an incident: fired / re-opened / ack / handover
 *                                               / snooze / reminders / ServiceNow / comms / comments / agent triage /
 *                                               rule edits during the incident / severity moves / resolved
 *  GET  /api/alerts/:id/checklist               runbook steps + who ticked which (persistent)
 *  POST /api/alerts/:id/checklist  {step, done} tick / untick a step (logged on the incident)
 *
 * Mounted BEFORE /api/alerts/:id (same rule as alertHistory / alertActivity). */
'use strict';
const db = require('./db');
const segment = require('./segment');
const identity = require('./identity');
const { METRICS } = require('./metrics');

const C = () => db.console;
const OPS = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b, eq: (a, b) => a === b };
const REASONS = { fixed: 'Fixed / mitigated', duplicate: 'Duplicate of another incident', false_positive: 'False positive — threshold or rule to review', single_customer: 'Single customer / retry storm — no platform issue', maintenance: 'Planned maintenance / expected', cleared: 'Condition cleared by itself' };

/* split a runbook into steps — shared with the mails / ServiceNow / Guided Response (runbook.js) */
const { steps } = require('./runbook');

/* score one series of snapshots with a rule → { fires, ticks, points, first, last } */
function score(points, rule) {
  const isRate = ['rate', 'ratio'].includes(rule.unit);
  const cb = rule.count_by || 'events'; const minC = Number(rule.min_customers || 0);
  let fires = 0, downgraded = 0, ticks = 0, noIdentity = 0;
  const out = points.map(p => {
    let v = p.value, s = p.sample;
    if (cb !== 'events') {
      const n = cb === 'customers' ? p.customers : p.services, tot = cb === 'customers' ? p.customers_total : p.services_total;
      if (n == null) { noIdentity++; v = null; } else { v = isRate ? (Number(tot) > 0 ? Number(n) / Number(tot) : null) : Number(n); s = Number(tot); }
    }
    ticks++;
    const fired = v != null && Number(s) >= Number(rule.min_sample || 0) && OPS[rule.operator] && OPS[rule.operator](Number(v), Number(rule.threshold));
    let sev = rule.severity;
    if (fired && minC > 0 && p.customers != null && Number(p.customers) < minC) { sev = rule.single_customer_severity || 'P4'; downgraded++; }
    if (fired) fires++;
    return { sim_now: p.sim_now, value: v, sample: s, customers: p.customers, fired, severity: fired ? sev : null };
  });
  return { fires, downgraded, ticks, noIdentity, points: out };
}

function mount(app, { audit, requireCap, boardNow }) {
  /* ---- identity catalog ---- */
  app.get('/api/rules/identity', (req, res) => {
    try { res.json({ identity: identity.catalog(Object.keys(METRICS)) }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- Test now (editor) ---- */
  app.post('/api/rules/preview', requireCap('editRules'), async (req, res) => {
    try {
      const b = req.body || {};
      const m = METRICS[b.metric_key]; if (!m) return res.status(400).json({ error: 'unknown metric_key' });
      const rule = { operator: b.operator || 'gte', threshold: Number(b.threshold), min_sample: Number(b.min_sample || 0), severity: b.severity || 'P3',
        count_by: b.count_by || 'events', min_customers: Number(b.min_customers || 0), single_customer_severity: b.single_customer_severity || 'P4', unit: m.unit };
      const W = Number(b.window_hours || 1), dim = b.dim || {};
      const now = boardNow ? await boardNow(b.sim) : new Date().toISOString();
      // live value on the replica (what a sync would write now)
      const rows = await m.compute(db.source, now, W);
      const snap = rows.find(r => Object.keys(dim).every(k => String((r.dim || {})[k]) === String(dim[k]))) || rows.find(r => !Object.keys(r.dim || {}).length) || rows[0] || null;
      let ident = null, identityWhy = identity.why(b.metric_key);
      if (snap && identity.supports(b.metric_key)) { try { ident = await identity.counts(b.metric_key, now, W, snap.dim || {}); } catch (e) { identityWhy = 'identity query failed: ' + e.message; } }
      const live = score([{ sim_now: now, value: snap ? snap.value : null, sample: snap ? snap.sample : 0, ...(ident || {}) }], rule).points[0];
      // 7-day history of already-written snapshots for this (metric, window, dim)
      const days = Math.min(30, Number(b.days) || 7);
      const hist = (await C().query(
        `SELECT sim_now, value, sample, customers, customers_total, services, services_total FROM metric_snapshots
         WHERE metric_key=$1 AND window_hours=$2 AND dim=$3::jsonb AND sim_now >= now() - ($4||' days')::interval ORDER BY sim_now`,
        [b.metric_key, W, JSON.stringify(snap ? (snap.dim || {}) : dim), String(days)])).rows;
      const h = score(hist, rule);
      res.json({ now, unit: m.unit, value: live.value, sample: live.sample, would_fire: live.fired, severity: live.severity, rule_severity: rule.severity,
        enoughSample: live.value != null && Number(live.sample) >= rule.min_sample,
        customers: ident ? ident.customers : null, customers_total: ident ? ident.customers_total : null, services: ident ? ident.services : null, services_total: ident ? ident.services_total : null,
        identity: identity.supports(b.metric_key), identity_why: identityWhy, identity_what: identity.whatOf(b.metric_key),
        events_value: snap ? snap.value : null, events_sample: snap ? snap.sample : 0,
        history: { days, ticks: h.ticks, fires: h.fires, downgraded: h.downgraded, no_identity: h.noIdentity, points: h.points } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- noise scorecard (Learn) ---- */
  app.get('/api/alerts/noise', async (req, res) => {
    try {
      const seg = segment.forRequest(req, req.query.segment);
      const days = Math.min(180, Math.max(1, Number(req.query.days) || 7));
      const rows = (await C().query(
        `SELECT r.id AS rule_id, r.key AS rule_key, r.name, r.severity, r.team, r.enabled, r.alert_class, r.count_by, r.min_customers, r.metric_key, r.threshold, r.operator, r.window_hours,
                count(a.id)::int AS fires,
                count(a.id) FILTER (WHERE a.ack_at IS NOT NULL)::int AS acked,
                count(a.id) FILTER (WHERE a.status='open')::int AS open_now,
                count(a.id) FILTER (WHERE a.status='open' AND a.ack_at IS NULL)::int AS open_unacked,
                round(avg(EXTRACT(EPOCH FROM (a.ack_at - a.opened_wall))/60) FILTER (WHERE a.ack_at IS NOT NULL))::int AS mtta_min,
                round(avg(EXTRACT(EPOCH FROM (a.resolved_at - a.fired_at))/60) FILTER (WHERE a.resolved_at IS NOT NULL))::int AS mttr_min,
                count(a.id) FILTER (WHERE a.customers = 1)::int AS single_customer,
                count(a.id) FILTER (WHERE a.customers IS NOT NULL)::int AS with_identity,
                count(a.id) FILTER (WHERE a.rule_severity IS NOT NULL)::int AS downgraded,
                count(a.id) FILTER (WHERE a.resolve_reason='false_positive')::int AS false_positive,
                count(a.id) FILTER (WHERE a.resolve_reason='single_customer')::int AS closed_single,
                count(a.id) FILTER (WHERE a.resolve_reason='duplicate')::int AS duplicate,
                count(a.id) FILTER (WHERE a.resolve_reason='fixed')::int AS fixed,
                count(a.id) FILTER (WHERE a.resolve_reason='cleared' OR (a.status='resolved' AND a.resolve_reason IS NULL))::int AS cleared,
                coalesce(sum(a.reopen_count),0)::int AS reopens,
                count(a.id) FILTER (WHERE a.status='resolved' AND a.ack_at IS NULL)::int AS untouched,
                count(a.id) FILTER (WHERE (a.status='resolved' AND a.ack_at IS NULL)
                                       OR a.resolve_reason IN ('false_positive','single_customer','duplicate'))::int AS noise_any,
                max(a.fired_at) AS last_fired,
                EXISTS (SELECT 1 FROM metric_snapshots m
                         WHERE m.metric_key = r.metric_key AND m.window_hours = r.window_hours
                           AND m.dim @> r.dim AND m.sim_now >= now() - ($1||' days')::interval) AS has_data
         FROM alert_rules r
         LEFT JOIN alerts a ON a.rule_key = r.key AND a.fired_at >= now() - ($1||' days')::interval
         WHERE ${segment.sqlWhere('r', 'key', seg)}
         GROUP BY r.id ORDER BY fires DESC, r.name`, [String(days)])).rows;
      for (const r of rows) {
        /* noise score 0..100: share of firings nobody acted on or that were closed as noise. The buckets
         * OVERLAP — an incident nobody acknowledged and then closed as a false positive is in two of
         * them — so this counts the union, not the sum, which used to push the share past 100 %. */
        r.noise_share = r.fires ? Math.round(100 * r.noise_any / r.fires) : 0;
        r.single_share = r.with_identity ? Math.round(100 * r.single_customer / r.with_identity) : null;
        r.verdict = !r.fires ? (r.has_data ? 'quiet' : 'no-data') : r.noise_share >= 60 && r.fires >= 3 ? 'noisy' : r.single_share != null && r.single_share >= 50 && r.fires >= 3 ? 'retry-storms' : r.acked === 0 && r.fires >= 5 ? 'ignored' : 'healthy';
        r.hint = r.verdict === 'noisy' ? 'Raise the threshold or the min sample, or count by customers' : r.verdict === 'retry-storms' ? `Set a customer floor (min customers ≥ 2 → P4) or count by customers` : r.verdict === 'ignored' ? 'Nobody acknowledges it — lower severity, re-route the team or disable' : r.verdict === 'quiet' ? 'Did not fire in the period' : r.verdict === 'no-data' ? 'The metric has never produced a row for this dimension — there is nothing to measure, so no threshold will help. Check the source, not the rule.' : '';
      }
      const totals = rows.reduce((t, r) => { t.fires += r.fires; t.acked += r.acked; t.noisy += r.noise_any; t.single += r.single_customer; return t; }, { fires: 0, acked: 0, noisy: 0, single: 0 });
      res.json({ segment: seg, days, rules: rows, totals, reasons: REASONS });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- timeline (Work) ---- */
  app.get('/api/alerts/:id/timeline', async (req, res) => {
    try {
      const id = Number(req.params.id); if (!id) return res.status(400).json({ error: 'bad id' });
      const a = (await C().query(`SELECT * FROM alerts WHERE id=$1`, [id])).rows[0];
      if (!a) return res.status(404).json({ error: 'not found' });
      const ev = [];
      const push = (at, kind, title, detail, who, color) => { if (at) ev.push({ at, kind, title, detail: detail || null, who: who || null, color: color || null }); };
      push(a.opened_wall || a.fired_at, 'fired', `Fired · ${a.severity}${a.rule_severity && a.rule_severity !== a.severity ? ` (rule says ${a.rule_severity} — ${a.customers != null ? a.customers + ' customer(s)' : 'customer floor'})` : ''}`, a.message, 'runner', '#dc2626');
      const comments = (await C().query(`SELECT author, body, created_at FROM incident_comments WHERE alert_id=$1 ORDER BY created_at`, [id])).rows;
      for (const c of comments) push(c.created_at, c.author === 'system' ? 'system' : c.author === 'agent' ? 'agent' : 'comment', c.author === 'system' ? 'Update' : c.author === 'agent' ? 'Agent triage' : 'Comment', c.body, c.author, c.author === 'agent' ? '#0e9f5a' : c.author === 'system' ? '#0891b2' : null);
      const audit = (await C().query(`SELECT actor, action, detail, at FROM audit_log WHERE target=$1 AND (action LIKE 'incident.%' OR action LIKE 'alert.%' OR action LIKE 'servicenow.%' OR action LIKE 'comms.%') ORDER BY at`, [String(id)])).rows;
      const LABEL = { 'incident.ack': 'Acknowledged', 'incident.reack': 'Ack taken over', 'incident.handover': 'Ack handed over', 'incident.assign': 'Assigned', 'incident.snooze': 'Snoozed', 'incident.resolve': 'Resolved', 'incident.checklist': 'Runbook step', 'alert.cases.view': 'Affected cases previewed', 'alert.cases.export': 'Affected cases exported', 'incident.servicenow.create': 'ServiceNow ticket raised', 'incident.comms': 'Incident comms sent' };
      for (const x of audit) { const d = x.detail || {}; push(x.at, x.action, LABEL[x.action] || x.action, [d.reason ? `reason: ${REASONS[d.reason] || d.reason}` : null, d.note, d.to ? `to ${d.to}` : null, d.until ? `until ${d.until}` : null, d.assignee ? `→ ${d.assignee}` : null, d.step != null ? `step ${d.step} ${d.done === false ? 'unticked' : 'done'}` : null].filter(Boolean).join(' · ') || null, x.actor, x.action === 'incident.resolve' ? '#16a34a' : x.action.startsWith('incident.ack') || x.action === 'incident.handover' || x.action === 'incident.reack' ? '#0891b2' : null); }
      const rem = (await C().query(`SELECT level, elapsed_min, recipients, mail_ok, sent_at, management FROM alert_reminders WHERE alert_id=$1 ORDER BY sent_at`, [id]).catch(() => ({ rows: [] }))).rows;
      for (const r of rem) push(r.sent_at, 'reminder', `Ack reminder R${r.level}${r.management ? ' · management informed' : ''}`, `${r.elapsed_min} min without ack · ${r.recipients} recipient(s)${r.mail_ok === false ? ' · mail failed' : ''}`, 'ack-sla', '#d97706');
      const comms = (await C().query(`SELECT kind, subject, sent_by, sent_at, ok, array_length(sent_to,1) AS n FROM incident_comms WHERE alert_id=$1 ORDER BY sent_at`, [id]).catch(() => ({ rows: [] }))).rows;
      for (const c of comms) push(c.sent_at, 'comms', `Incident comms · ${c.kind}`, `${c.subject || ''} · ${c.n || 0} recipient(s)${c.ok ? '' : ' · failed'}`, c.sent_by, '#2563eb');
      if (a.sn_number) push(a.sn_created_at, 'servicenow', `ServiceNow ${a.sn_number}`, a.sn_state ? `state ${a.sn_state}` : null, a.sn_created_by, '#2563eb');
      const edits = (await C().query(`SELECT actor, action, changes, at FROM alert_rule_changes WHERE rule_key=$1 AND at >= $2::timestamptz - interval '1 hour' AND at <= COALESCE($3::timestamptz, now()) ORDER BY at`, [a.rule_key, a.opened_wall || a.fired_at, a.resolved_at]).catch(() => ({ rows: [] }))).rows;
      for (const e of edits) push(e.at, 'rule', `Rule ${e.action} during the incident`, Object.entries(e.changes || {}).map(([k, v]) => `${k}: ${v.from ?? '—'} → ${v.to ?? '—'}`).join(' · '), e.actor, '#7c3aed');
      const ticks = (await C().query(`SELECT step, done_by, done_at FROM incident_checklist WHERE alert_id=$1 ORDER BY done_at`, [id]).catch(() => ({ rows: [] }))).rows;
      if (a.status === 'resolved') push(a.resolved_at, 'resolved', `Resolved${a.resolve_reason ? ` · ${REASONS[a.resolve_reason] || a.resolve_reason}` : ''}`, a.note, a.resolved_by, '#16a34a');
      ev.sort((x, y) => new Date(x.at) - new Date(y.at));
      res.json({ alert: { id: a.id, name: a.name, severity: a.severity, rule_severity: a.rule_severity, status: a.status, customers: a.customers, services: a.services, ack_by: a.ack_by, ack_at: a.ack_at, assignee: a.assignee, fired_at: a.fired_at, last_seen_at: a.last_seen_at, resolved_at: a.resolved_at, resolve_reason: a.resolve_reason, breach_count: a.breach_count, reopen_count: a.reopen_count }, events: ev, checklist_done: ticks.length, reasons: REASONS });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- runbook checklist (Work) ---- */
  app.get('/api/alerts/:id/checklist', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const a = (await C().query(`SELECT a.id, a.rule_key, r.runbook FROM alerts a LEFT JOIN alert_rules r ON r.key=a.rule_key WHERE a.id=$1`, [id])).rows[0];
      if (!a) return res.status(404).json({ error: 'not found' });
      const ticks = (await C().query(`SELECT step, done_by, done_at FROM incident_checklist WHERE alert_id=$1`, [id])).rows;
      const byStep = Object.fromEntries(ticks.map(t => [t.step, t]));
      const list = steps(a.runbook).map((text, i) => ({ step: i + 1, text, done: !!byStep[i + 1], done_by: byStep[i + 1]?.done_by || null, done_at: byStep[i + 1]?.done_at || null }));
      res.json({ steps: list, done: list.filter(s => s.done).length, total: list.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/alerts/:id/checklist', requireCap('ackErrors'), async (req, res) => {
    try {
      const id = Number(req.params.id); const step = Number((req.body || {}).step); const done = (req.body || {}).done !== false;
      if (!id || !step) return res.status(400).json({ error: 'step required' });
      if (done) await C().query(`INSERT INTO incident_checklist (alert_id, step, done_by) VALUES ($1,$2,$3) ON CONFLICT (alert_id, step) DO UPDATE SET done_by=EXCLUDED.done_by, done_at=now()`, [id, step, req.actor]);
      else await C().query(`DELETE FROM incident_checklist WHERE alert_id=$1 AND step=$2`, [id, step]);
      await audit(req, 'incident.checklist', String(id), { step, done });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { mount, REASONS, steps, score };
