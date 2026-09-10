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

const ACTION_RE = '^(incident\\.|alert\\.|alerts\\.|rule\\.|rules\\.|ack_sla\\.|alert_flap|anomaly\\.|errclass\\.|monitoring\\.latency|escalation\\.|gateways\\.|agent\\.|oncall\\.)';

const ksa = iso => { if (!iso) return ''; try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', ''); } catch (_) { return String(iso); } };
const who = e => e ? String(e).split('@')[0] : '—';
const val = v => (v === null || v === undefined || v === '') ? '∅' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
const short = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };

/* action → human label + one line saying exactly what was done */
function humanise(action, detail, extra) {
  let d = detail;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = {}; } }
  if (!d || typeof d !== 'object') d = {};
  const M = {
    'incident.ack': ['Acknowledged', () => `Took ownership${d.to && d.to !== d.by ? ` (${who(d.to)})` : ''}${d.note ? ` — "${short(d.note, 120)}"` : ''}`],
    'incident.reack': ['Ack taken over', () => `${who(d.from)} → ${who(d.to)}${d.note ? ` — "${short(d.note, 120)}"` : ''}`],
    'incident.handover': ['Ack handed over', () => `${who(d.from)} → ${who(d.to)}${d.note ? ` — "${short(d.note, 120)}"` : ''}`],
    'incident.assign': ['Assigned', () => d.assignee ? `Assignee set to ${who(d.assignee)}` : 'Assignee cleared'],
    'incident.snooze': ['Snoozed', () => d.until ? `Muted until ${ksa(d.until)} KSA` : 'Snoozed'],
    'incident.resolve': ['Resolved', () => 'Incident closed'],
    'incident.comms': ['Customer comms', () => `${d.kind || 'initial'} — "${short(d.subject || '', 90)}" to ${Array.isArray(d.recipients) ? d.recipients.length : (d.recipients || 0)} recipient(s)${d.ok === false ? ' · FAILED' : ''}`],
    'incident.servicenow.create': ['ServiceNow created', () => `${d.number || ''}${d.group ? ` · group ${d.group}` : ''}${d.dryRun ? ' (dry run)' : ''}`],
    'incident.servicenow.link': ['ServiceNow linked', () => `${d.number || ''}`],
    'incident.servicenow.existing': ['ServiceNow existing', () => `${d.number || ''}`],
    'incident.servicenow.dryrun': ['ServiceNow dry run', () => `${d.number || ''}`],
    'incident.servicenow.note': ['ServiceNow note', () => `${d.number || ''} · ${d.kind || 'note'}${d.dryRun ? ' (dry run)' : ''}`],
    'alert.notify': ['Notified', () => `Channels: ${(d.channels || []).map(c => c.channel || c.name || c).join(', ') || '—'}${d.recipients ? ` · ${d.recipients} recipient(s)` : ''}`],
    'alert.history.export': ['Exported history', () => `${d.days || '?'} day(s) · ${d.incidents || 0} incident(s)`],
    'alert.cases.export': ['Exported cases', () => `${d.rows || d.cases || '?'} row(s)`],
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
      LEFT JOIN alerts al      ON s.action LIKE 'incident.%' AND al.id = s.tid
      LEFT JOIN alert_rules r  ON s.action LIKE 'rule.%' AND (r.id = s.tid OR r.key = s.target)
     ORDER BY s.at DESC`, p)).rows;

  /* field-level rule diffs, keyed by the audit row they belong to (same actor, same rule, within 2 s) */
  const edits = (await C.query(`SELECT rule_id, rule_key, action, actor, changes, at FROM alert_rule_changes WHERE at >= now() - ($1 || ' days')::interval ORDER BY at DESC LIMIT 2000`, [String(days)]).catch(() => ({ rows: [] }))).rows;
  const diffOf = (actor, ruleKey, at) => {
    const t = new Date(at).getTime();
    const e = edits.find(x => x.actor === actor && (x.rule_key === ruleKey) && Math.abs(new Date(x.at).getTime() - t) < 4000);
    if (!e || !e.changes) return null;
    return Object.entries(e.changes).map(([k, v]) => `${k}: ${val(short(v.from, 50))} → ${val(short(v.to, 50))}`).join(' · ');
  };

  const out = [];
  for (const r of rows) {
    const isInc = r.action.startsWith('incident.');
    const isRule = r.action.startsWith('rule.');
    const key = isInc ? r.alert_rule : isRule ? (r.rule_key_j || r.target) : null;
    const rowSeg = key ? (/^fixed_/.test(key) ? 'fixed' : 'mvno') : null;
    if (seg && seg !== 'all' && rowSeg && rowSeg !== seg) continue;          // incident/rule rows of the other business
    const extra = isRule ? diffOf(r.actor, r.rule_key_j || r.target, r.at) : null;
    const h = humanise(r.action, r.detail, extra);
    out.push({
      id: r.id, at: r.at, at_ksa: ksa(r.at), actor: r.actor, actor_short: who(r.actor), role: r.role || '',
      action: r.action, label: h.label, what: h.what,
      scope: isInc ? 'incident' : isRule ? 'rule' : 'config',
      target_id: isInc ? Number(r.target) : (isRule ? (r.rule_key_j || r.target) : null),
      target_name: isInc ? (r.alert_name || `incident #${r.target}`) : isRule ? (r.rule_name || r.target) : '—',
      severity: isInc ? (r.alert_severity || '') : isRule ? (r.rule_severity || '') : '',
      status: isInc ? (r.alert_status || '') : '',
      segment: rowSeg || 'both', ip: r.ip || '', ua: r.ua || '',
    });
  }
  if (q) { const s = String(q).toLowerCase(); return out.filter(r => (r.actor + ' ' + r.label + ' ' + r.what + ' ' + r.target_name).toLowerCase().includes(s)); }
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
      res.json({ segment: seg, days, count: rows.length, users, activity: rows.slice(0, 800) });
    } catch (e) { console.error('[activity]', e.message); res.status(500).json({ error: 'activity log: ' + e.message }); }
  });
}
module.exports = { mount, data, xlsx, humanise };
