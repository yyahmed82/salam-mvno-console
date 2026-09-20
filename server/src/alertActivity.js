/* alertActivity.js — WHO DID WHAT on alerts (11 Sep 2026).
 *
 * One log of every CONSOLE-USER action on incidents, rules and the alerting configuration, in plain words:
 *   "m.basha.tcs · Acknowledged incident #14415 Off-hours unusual activity (P2)"
 *   "y.yahmed.sns · Rule edited — threshold 500 → 300 · severity P2 → P1"
 *   "a.pandey.tcs · Handed over ack: m.basha.tcs → a.pandey.tcs — night shift"
 * Two sources, merged and humanised server-side so the screen, the mail and the export always agree:
 *   1. audit_log  — every audited action (incident.*, alert.*, rule.*, ack_sla.*, anomaly, errclass, latency, agents)
 *   2. alert_rule_changes — the FIELD-LEVEL before → after of each rule edit (audit_log only keeps the new values)
 * Segment-scoped (Mobile / Fixed) by joining the incident's or rule's key; console-wide configuration actions are
 * marked scope 'config' and shown on both sides. Export: ?format=xlsx (capability 'export', audited).
 */
'use strict';
const db = require('./db');
const segment = require('./segment');

const BUILD = '2026-09-11c';   // bumped whenever this module changes — visible in the API answer, so a stale deploy is obvious
const ACTION_RE = '^(incident\\.|alert\\.|alerts\\.|rule\\.|rules\\.|ack_sla\\.|alert_flap|anomaly\\.|errclass\\.|monitoring\\.latency|escalation\\.|gateways\\.|agent\\.|oncall\\.)';

const ksa = iso => { if (!iso) return ''; try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', ''); } catch (_) { return String(iso); } };
const who = e => e ? String(e).split('@')[0] : '—';
const val = v => (v === null || v === undefined || v === '') ? '∅' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
const short = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };

/* ---- STRUCTURED BEFORE → AFTER (11 Sep 2026) ---------------------------------------------------------------
 * The Detail column shows a git-style diff: field, old value (red), new value (green).
 *  - RULE edits carry their own field-level history (alert_rule_changes) — used as-is.
 *  - CONFIGURATION saves don't: audit_log keeps only the values that were saved. So each save is diffed against
 *    the PREVIOUS save of the same action — that row IS the state it replaced. The first save ever recorded has
 *    nothing to compare with and says so instead of pretending the old value was empty.
 *  - Incident actions (ack, resolve, snooze…) are not field edits: they keep their plain sentence. */
const RESOLVE_REASON = { fixed: 'Fixed / mitigated', duplicate: 'Duplicate of another incident', false_positive: 'False positive — rule to review', single_customer: 'Single customer / retry storm', maintenance: 'Planned maintenance / expected', cleared: 'Condition cleared by itself' };
const FIELD_LABEL = {
  threshold: 'Threshold', min_sample: 'Min sample', window_hours: 'Window (hours)', severity: 'Severity', team: 'Team',
  enabled: 'Enabled', name: 'Name', description: 'Description', runbook: 'Runbook', trigger_codes: 'Trigger codes',
  metric_key: 'Metric', operator: 'Operator', channel: 'Channel', active_from: 'Active from (KSA)', active_to: 'Active to (KSA)',
  dim: 'Dimension filter', count_by: 'Counts by', min_customers: 'Customer floor', single_customer_severity: 'Severity below floor',
  alert_class: 'Class', segment: 'Business', reopenMin: 'Re-open window (min)', clearHoldMin: 'Clear hold (min)',
  mode: 'Mode', z: 'Sensitivity (σ)', lookbackWeeks: 'Lookback (weeks)', minSample: 'Min sample', volFloor: 'Volume floor',
};
const labelOf = f => FIELD_LABEL[f] || FIELD_LABEL[String(f).split('.').pop()] || String(f).replace(/[._]/g, ' ');
const SKIP_KEY = new Set(['at', 'ts', 'sim', 'ip', 'ua', 'segment']);
function flat(o, prefix = '', out = {}, depth = 0) {
  if (o === null || o === undefined) return out;
  if (typeof o !== 'object' || Array.isArray(o)) { out[prefix || 'value'] = o; return out; }
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 3) flat(v, key, out, depth + 1);
    else out[key] = v;
  }
  return out;
}
const sameVal = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
function diffObjects(prev, next) {
  const A = flat(prev || {}), B = flat(next || {});
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter(k => !SKIP_KEY.has(String(k).split('.').pop()));
  const out = [];
  for (const k of keys) if (!sameVal(A[k], B[k])) out.push({ field: k, label: labelOf(k), from: A[k] === undefined ? null : A[k], to: B[k] === undefined ? null : B[k] });
  return out.slice(0, 40);
}
const changeText = ch => ch.map(c => `${c.label}: ${val(short(c.from, 60))} → ${val(short(c.to, 60))}`).join(' · ');

/* action → human label + one line saying exactly what was done */
function humanise(action, detail, extra, actor) {
  let d = detail;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = {}; } }
  if (!d || typeof d !== 'object') d = {};
  const M = {
    'incident.ack': ['Acknowledged', () => `Took ownership${d.to && actor && d.to !== actor ? ` — assigned to ${who(d.to)}` : ''}${d.note ? ` — "${short(d.note, 120)}"` : ''}`],
    'incident.reack': ['Ack taken over', () => `${who(d.from)} → ${who(d.to)}${d.note ? ` — "${short(d.note, 120)}"` : ''}`],
    'incident.handover': ['Ack handed over', () => `${who(d.from)} → ${who(d.to)}${d.note ? ` — "${short(d.note, 120)}"` : ''}`],
    'incident.assign': ['Assigned', () => d.assignee ? `Assignee set to ${who(d.assignee)}` : 'Assignee cleared'],
    'incident.snooze': ['Snoozed', () => d.until ? `Muted until ${ksa(d.until)} KSA` : 'Snoozed'],
    'incident.resolve': ['Resolved', () => `Closed as: ${RESOLVE_REASON[d.reason] || d.reason || 'fixed'}${d.note ? ` — "${short(d.note, 120)}"` : ''}${d.hold_hours ? ` · rule held ${d.hold_hours} h${d.hold_until ? ` (until ${ksa(d.hold_until)} KSA)` : ''} while its window drains` : ''}`],
    'alert.hold.release': ['Hold released', () => `${d.rule_key || 'the rule'} is evaluated again from the next sync`],
    'incident.checklist': ['Runbook step', () => `Step ${d.step} ${d.done === false ? 'un-ticked' : 'ticked'}`],
    'incident.comms': ['Customer comms', () => `${d.kind || 'initial'} — "${short(d.subject || '', 90)}" to ${Array.isArray(d.recipients) ? d.recipients.length : (d.recipients || 0)} recipient(s)${d.ok === false ? ' · FAILED' : ''}`],
    'incident.servicenow.create': ['ServiceNow created', () => `${d.number || ''}${d.group ? ` · group ${d.group}` : ''}${d.dryRun ? ' (dry run)' : ''}`],
    'incident.servicenow.link': ['ServiceNow linked', () => `${d.number || ''}`],
    'incident.servicenow.existing': ['ServiceNow existing', () => `${d.number || ''}`],
    'incident.servicenow.dryrun': ['ServiceNow dry run', () => `${d.number || ''}`],
    'incident.servicenow.note': ['ServiceNow note', () => `${d.number || ''} · ${d.kind || 'note'}${d.dryRun ? ' (dry run)' : ''}`],
    'alert.notify': ['Notified', () => `Channels: ${(d.channels || []).map(c => c.channel || c.name || c).join(', ') || '—'}${d.recipients ? ` · ${d.recipients} recipient(s)` : ''}`],
    'alert.history.export': ['Exported history', () => `${d.days || '?'} day(s) · ${d.incidents || 0} incident(s)`],
    'alert.cases.view': ['Affected cases previewed', () => `${d.metric || ''} — ${Number(d.counted || 0).toLocaleString()} counted of ${Number(d.population || 0).toLocaleString()} row(s) in the window`],
    'alert.cases.export': ['Affected cases exported', () => `${String(d.format || 'file').toUpperCase()} · ${d.metric || ''} — ${Number(d.counted ?? d.rows ?? d.cases ?? 0).toLocaleString()} counted of ${Number(d.population || 0).toLocaleString()} row(s)`],
    'rule.create': ['Rule created', () => extra || Object.keys(d).filter(k => k !== 'runbook').slice(0, 6).map(k => `${k}=${val(d[k])}`).join(' · ')],
    'rule.update': ['Rule edited', () => extra || Object.keys(d).map(k => `${k} → ${val(short(d[k], 60))}`).join(' · ')],
    'rules.reseed': ['Builtin rules re-seeded', () => `${d.rules || '?'} rule(s) in the catalogue`],
    'ack_sla.config': ['Acknowledgement SLA changed', () => `enabled=${d.enabled}${d.mobile ? ` · Mobile R1/R2/R3 ${[d.mobile.P1 && d.mobile.P1.r1, d.mobile.P1 && d.mobile.P1.r2, d.mobile.P1 && d.mobile.P1.r3].filter(x => x != null).join('/')}` : ''}`],
    'ack_sla.preview': ['SLA reminder preview', () => `${d.business || ''} R${d.level || '?'} → ${who(d.to)}`],
    'ack_sla.tick': ['SLA check run', () => `${d.checked || 0} checked · ${d.sent || 0} reminder(s) sent`],
    'alert_flap.config': ['Flap control changed', () => `re-open within ${d.reopenMin}min · clear-hold ${d.clearHoldMin}min`],
    'anomaly.config': ['Anomaly engine changed', () => Object.entries(d).slice(0, 6).map(([k, v]) => `${k}=${val(v)}`).join(' · ')],
    'errclass.save': ['Error classification changed', () => `${d.codes || d.n || '?'} code(s) re-classified`],
    'monitoring.latency_thresholds': ['Latency thresholds changed', () => Object.entries(d).slice(0, 6).map(([k, v]) => `${k}=${val(v)}`).join(' · ')],
    'escalation.config': ['Escalation policy changed', () => Object.entries(d).slice(0, 5).map(([k, v]) => `${k}=${val(v)}`).join(' · ')],
    'gateways.config': ['Payment gateways changed', () => Object.entries(d).slice(0, 6).map(([k, v]) => `${k}=${val(v)}`).join(' · ')],
    'agent.policy': ['Agent policy changed', () => `mode=${d.mode}${(d.autoTeam || []).length ? ` · auto-team ${d.autoTeam.length} rule(s)` : ''}${(d.autoResolveDup || []).length ? ` · auto-resolve-dup ${d.autoResolveDup.length}` : ''}`],
    'agent.run': ['Agent run manually', () => `${d.agent || ''}`],
    'agent.triage.feedback': ['Rated agent triage', () => d.helpful ? 'helpful 👍' : 'not helpful 👎'],
    'agent.signature.review': ['Signature reviewed', () => `status=${d.status}${d.owner_team ? ` · owner ${d.owner_team}` : ''}`],
  };
  const hit = M[action];
  if (hit) { let w = ''; try { w = hit[1](); } catch (_) {} return { label: hit[0], what: w }; }
  // unknown but audited action — still show it, with the raw detail so nothing is hidden
  return { label: action.replace(/[._]/g, ' ').replace(/^\w/, c => c.toUpperCase()), what: extra || short(JSON.stringify(d), 200).replace(/^\{\}$/, '') };
}

async function data({ seg, days = 30, user = '', action = '', q = '', limit = 500 }) {
  const C = db.console;
  const lim = Math.min(2000, Math.max(1, Number(limit) || 500));
  const p = [String(days)];
  let where = `a.at >= now() - ($1 || ' days')::interval AND a.action ~ '${ACTION_RE}' AND a.actor IS NOT NULL AND a.actor <> 'anonymous'`;
  if (user) { p.push('%' + String(user).toLowerCase() + '%'); where += ` AND lower(a.actor) LIKE $${p.length}`; }
  if (action && action !== 'all') { p.push(action === 'incident' ? '^incident\\.' : action === 'rule' ? '^rules?\\.' : action === 'config' ? '^(ack_sla|alert_flap|anomaly|errclass|monitoring|escalation|gateways|agent)' : '^' + action); where += ` AND a.action ~ $${p.length}`; }
  p.push(lim);

  /* audit rows + the incident / rule they touched (target is the alert id for incident.*, the rule id or key for rule.*) */
  /* The numeric id is computed in a CTE with a CASE guard: audit targets are free text (an alert id for
   * incident.*, a rule id OR key for rule.*, null for config actions), so casting inside a JOIN condition
   * would make Postgres try 'sla_ladder'::bigint on unrelated rows and fail the whole query (HTTP 500). */
  const rows = (await C.query(`
    WITH src AS (
      SELECT a.id, a.at, a.actor, a.role, a.action, a.target, a.detail, a.ip, a.ua,
             CASE WHEN a.target ~ '^[0-9]+$' THEN a.target::bigint END AS tid
        FROM audit_log a
       WHERE ${where}
       ORDER BY a.at DESC
       LIMIT $${p.length})
    SELECT s.*,
           al.name AS alert_name, al.severity AS alert_severity, al.rule_key AS alert_rule, al.status AS alert_status,
           r.name AS rule_name, r.key AS rule_key_j, r.severity AS rule_severity
      FROM src s
      LEFT JOIN alerts al      ON (s.action LIKE 'incident.%' OR s.action LIKE 'alert.cases.%' OR s.action = 'alert.notify') AND al.id = s.tid
      LEFT JOIN alert_rules r  ON s.action LIKE 'rule.%' AND (r.id = s.tid OR r.key = s.target)
     ORDER BY s.at DESC`, p)).rows;

  /* field-level rule diffs, keyed by the audit row they belong to (same actor, same rule, within 2 s) */
  const edits = (await C.query(`SELECT rule_id, rule_key, action, actor, changes, at FROM alert_rule_changes WHERE at >= now() - ($1 || ' days')::interval ORDER BY at DESC LIMIT 2000`, [String(days)]).catch(() => ({ rows: [] }))).rows;
  const diffOf = (actor, ruleKey, at) => {
    const t = new Date(at).getTime();
    const e = edits.find(x => x.actor === actor && (x.rule_key === ruleKey) && Math.abs(new Date(x.at).getTime() - t) < 4000);
    if (!e || !e.changes) return null;
    return Object.entries(e.changes).map(([k, v]) => ({ field: k, label: labelOf(k), from: v.from === undefined ? null : v.from, to: v.to === undefined ? null : v.to }));
  };

  /* CONFIGURATION saves: the state each save replaced = the previous save of the same action. Seed the chain with
   * the last save BEFORE the window so even the oldest row on screen has its "before". */
  const isCfgAction = a => !/^(incident|rule|rules)\./.test(a) && !/^alert\.(cases|notify|history)/.test(a);
  const cfgPrev = new Map();
  {
    const byAct = {};
    for (const r of rows) if (isCfgAction(r.action)) (byAct[r.action] ||= []).push(r);      // rows are newest-first
    const acts = Object.keys(byAct);
    let seed = {};
    if (acts.length) {
      const oldest = rows.filter(r => isCfgAction(r.action)).slice(-1)[0].at;
      const pr = await C.query(`SELECT DISTINCT ON (action) action, detail FROM audit_log WHERE action = ANY($1) AND at < $2 ORDER BY action, at DESC`, [acts, oldest]).catch(() => ({ rows: [] }));
      pr.rows.forEach(x => { seed[x.action] = x.detail; });
    }
    for (const [act, list] of Object.entries(byAct)) {
      let prev = seed[act];                                   // undefined = nothing recorded before this window
      for (const r of [...list].reverse()) { cfgPrev.set(r.id, prev); prev = r.detail; }
    }
  }

  const out = [];
  for (const r of rows) {
    const isInc = r.action.startsWith('incident.') || ((r.action.startsWith('alert.cases.') || r.action === 'alert.notify') && r.alert_name != null);
    const isRule = r.action.startsWith('rule.');
    const key = isInc ? r.alert_rule : isRule ? (r.rule_key_j || r.target) : null;
    const rowSeg = key ? (/^fixed_/.test(key) ? 'fixed' : 'mvno') : null;
    if (seg && seg !== 'all' && rowSeg && rowSeg !== seg) continue;          // incident/rule rows of the other business
    let changes = null, firstRecord = false;
    if (isRule) changes = diffOf(r.actor, r.rule_key_j || r.target, r.at);
    else if (isCfgAction(r.action) && cfgPrev.has(r.id)) {
      const prev = cfgPrev.get(r.id);
      firstRecord = prev === undefined || prev === null;
      changes = diffObjects(firstRecord ? {} : prev, r.detail);
      if (!changes.length) changes = null;                    // saved without changing anything
    }
    const extra = changes && changes.length ? changeText(changes) : null;
    const h = humanise(r.action, r.detail, extra, r.actor);
    out.push({
      id: r.id, at: r.at, at_ksa: ksa(r.at), actor: r.actor, actor_short: who(r.actor), role: r.role || '',
      action: r.action, label: h.label, what: h.what, changes: changes && changes.length ? changes : null, first_record: firstRecord && !!changes,
      scope: isInc ? 'incident' : isRule ? 'rule' : 'config',
      target_id: isInc ? Number(r.target) : (isRule ? (r.rule_key_j || r.target) : null),
      target_name: isInc ? (r.alert_name || `incident #${r.target}`) : isRule ? (r.rule_name || r.target) : '—',
      severity: isInc ? (r.alert_severity || '') : isRule ? (r.rule_severity || '') : '',
      status: isInc ? (r.alert_status || '') : '',
      segment: rowSeg || 'both', ip: r.ip || '', ua: r.ua || '',
    });
  }
  if (q) { const s = String(q).toLowerCase(); return out.filter(r => (r.actor + ' ' + r.action + ' ' + r.label + ' ' + r.what + ' ' + r.target_name + ' ' + r.severity).toLowerCase().includes(s)); }
  return out;
}

function xlsx(seg, days, rows, actor) {
  const X = require('./xlsx');
  const byUser = {};
  rows.forEach(r => { const u = byUser[r.actor] = byUser[r.actor] || { n: 0, inc: 0, rule: 0, cfg: 0, first: r.at, last: r.at }; u.n++; u[r.scope === 'incident' ? 'inc' : r.scope === 'rule' ? 'rule' : 'cfg']++; if (r.at < u.first) u.first = r.at; if (r.at > u.last) u.last = r.at; });
  const S = [[`Alert activity — who did what — ${segment.LABEL[seg] || 'all'} — last ${days} day(s) — generated ${ksa(new Date().toISOString())} KSA by ${actor}`], [],
    ['Actions recorded', rows.length], ['Console users', Object.keys(byUser).length], [],
    ['User', 'Actions', 'On incidents', 'On rules', 'On configuration', 'First (KSA)', 'Last (KSA)']];
  Object.entries(byUser).sort((a, b) => b[1].n - a[1].n).forEach(([u, s]) => S.push([u, s.n, s.inc, s.rule, s.cfg, ksa(s.first), ksa(s.last)]));
  const A = [['When (KSA)', 'User', 'Role', 'What was done', 'Detail', 'Scope', 'Target', 'Severity', 'Status', 'Business', 'Action (raw)', 'IP']];
  rows.forEach(r => A.push([r.at_ksa, r.actor, r.role, r.label, r.what, r.scope, r.target_name, r.severity, r.status, r.segment, r.action, r.ip]));
  return X.build([
    { name: 'By user', rows: S, numericCols: [1, 2, 3, 4], widths: [30, 10, 13, 10, 16, 19, 19] },
    { name: 'Activity', rows: A, widths: [19, 26, 14, 24, 70, 10, 40, 9, 10, 10, 24, 15] },
  ]);
}

function mount(app, { audit }) {
  app.get('/api/alerts/activity', async (req, res) => {
    try {
      const seg = req.query.segment === 'all' ? 'all' : segment.forRequest(req, req.query.segment);
      const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
      const rows = await data({ seg, days, user: req.query.user || '', action: req.query.action || '', q: req.query.q || '', limit: req.query.limit });
      if (req.query.format === 'xlsx') {
        if (!(req.caps && req.caps.export)) return res.status(403).json({ error: `role ${req.roleName} lacks export` });
        if (audit) audit(req, 'alert.activity.export', null, { segment: seg, days, rows: rows.length });
        res.setHeader('Content-Disposition', `attachment; filename="alert_activity_${seg}_${days}d_${new Date().toISOString().slice(0, 10)}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return res.send(xlsx(seg, days, rows, req.actor || 'console'));
      }
      const users = [...new Set(rows.map(r => r.actor))].sort();
      res.json({ build: BUILD, segment: seg, days, count: rows.length, users, activity: rows.slice(0, 800) });
    } catch (e) { console.error('[activity]', e.message); res.status(500).json({ error: 'activity log: ' + e.message }); }
  });
}
module.exports = { mount, data, xlsx, humanise };
