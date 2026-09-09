/* alertHistory.js — ALERT HISTORY EXPORT (XLSX): every incident of a business over a period, with every update.
 *   GET /api/alerts/history?segment=mvno|fixed&days=30&format=xlsx        (cap: export · audited alert.history.export)
 * Sheets: Summary (per rule: incidents, breaches, re-opens, acked, MTTA, reminders), Incidents (one row per incident:
 * fired / last seen / resolved, breach + re-open counts, ack by/at, minutes to ack, reminder level, ServiceNow),
 * Updates (incident_comments — ack / handover / snooze / resolve / reminders / re-opens, oldest first), Audit
 * (audit_log rows for incident actions), Reminders (alert_reminders rows). Built for the SLA review (10 Sep 2026). */
'use strict';
const db = require('./db');
const segment = require('./segment');

const ksa = iso => { if (!iso) return ''; try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', ''); } catch (_) { return String(iso); } };
const min = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 60000) : '';
const who = e => e ? String(e).split('@')[0] : '';

async function data(seg, days) {
  const C = db.console; const where = segment.sqlWhere('a', 'rule_key', seg);
  const inc = (await C.query(`SELECT a.*, r.alert_class FROM alerts a LEFT JOIN alert_rules r ON r.key=a.rule_key WHERE ${where} AND a.fired_at >= now() - ($1 || ' days')::interval ORDER BY a.fired_at DESC`, [String(days)])).rows;
  const ids = inc.map(a => a.id);
  const upd = ids.length ? (await C.query(`SELECT c.alert_id, c.author, c.body, c.created_at FROM incident_comments c WHERE c.alert_id = ANY($1::bigint[]) ORDER BY c.created_at ASC`, [ids])).rows : [];
  const aud = (await C.query(`SELECT actor, role, action, target, detail, at FROM audit_log WHERE at >= now() - ($1 || ' days')::interval AND (action LIKE 'incident.%' OR action LIKE 'alert.%' OR action LIKE 'ack_sla.%') ORDER BY at ASC`, [String(days)]).catch(() => ({ rows: [] }))).rows
    .filter(x => !x.target || ids.includes(Number(x.target)) || !/^\d+$/.test(String(x.target)));
  const rem = ids.length ? (await C.query(`SELECT * FROM alert_reminders WHERE alert_id = ANY($1::bigint[]) ORDER BY sent_at ASC`, [ids]).catch(() => ({ rows: [] }))).rows : [];
  return { inc, upd, aud, rem };
}

function xlsx(seg, days, d, actor) {
  const X = require('./xlsx'); const byId = {}; d.inc.forEach(a => byId[a.id] = a);
  // Summary per rule
  const per = {};
  for (const a of d.inc) {
    const p = per[a.rule_key] = per[a.rule_key] || { name: a.name, sev: a.severity, n: 0, br: 0, ro: 0, ack: 0, tta: [], rem: 0, open: 0, p1: 0 };
    p.n++; p.br += Number(a.breach_count || 0); p.ro += Number(a.reopen_count || 0); if (a.ack_at) { p.ack++; p.tta.push(min(a.fired_at, a.ack_at)); } if (a.status === 'open') p.open++; p.rem += Number(a.ack_reminder_level || 0) > 0 ? 1 : 0;
  }
  const S = [[`Alert history — ${segment.LABEL[seg]} — last ${days} day(s) — generated ${ksa(new Date().toISOString())} KSA by ${actor}`], [],
    ['Incidents', d.inc.length], ['Distinct rules', Object.keys(per).length], ['Acknowledged', d.inc.filter(a => a.ack_at).length], ['Still open', d.inc.filter(a => a.status === 'open').length],
    ['Reached a reminder', d.inc.filter(a => Number(a.ack_reminder_level) > 0).length], ['Re-opened (flap control)', d.inc.reduce((s, a) => s + Number(a.reopen_count || 0), 0)], [],
    ['Rule', 'Name', 'Severity', 'Incidents', 'Breaches', 'Re-opens', 'Acknowledged', 'Ack %', 'Median min to ack', 'Reached reminder', 'Still open']];
  Object.entries(per).sort((a, b) => b[1].n - a[1].n).forEach(([k, p]) => { const t = p.tta.filter(x => x !== '').sort((x, y) => x - y); const med = t.length ? t[Math.floor(t.length / 2)] : '';
    S.push([k, p.name, p.sev, p.n, p.br, p.ro, p.ack, p.n ? Math.round(100 * p.ack / p.n) + '%' : '', med, p.rem, p.open]); });
  const I = [['Id', 'Severity', 'Class', 'Name', 'Rule', 'Team', 'Status', 'Fired (KSA)', 'Last seen (KSA)', 'Resolved (KSA)', 'Open minutes', 'Breaches', 'Re-opens', 'Ack by', 'Ack at (KSA)', 'Minutes to ack', 'Assignee', 'Reminder level', 'Last reminder (KSA)', 'ServiceNow', 'Observed', 'Threshold', 'Message']];
  d.inc.forEach(a => I.push([a.id, a.severity, a.alert_class || '', a.name, a.rule_key, a.team || '', a.status, ksa(a.fired_at), ksa(a.last_seen_at), ksa(a.resolved_at), min(a.fired_at, a.resolved_at || a.last_seen_at), a.breach_count, a.reopen_count || 0, a.ack_by || '', ksa(a.ack_at), min(a.fired_at, a.ack_at), a.assignee || '', a.ack_reminder_level || 0, ksa(a.ack_reminder_at), a.sn_number || '', a.observed_value, a.threshold, a.message || '']));
  const U = [['Incident', 'Severity', 'Name', 'When (KSA)', 'Author', 'Update']];
  d.upd.forEach(u => { const a = byId[u.alert_id] || {}; U.push([u.alert_id, a.severity || '', a.name || '', ksa(u.created_at), who(u.author) || u.author, u.body]); });
  const A = [['When (KSA)', 'Actor', 'Role', 'Action', 'Incident', 'Detail']];
  d.aud.forEach(x => A.push([ksa(x.at), x.actor || '', x.role || '', x.action, x.target || '', typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail || {})]));
  const R = [['Sent (KSA)', 'Incident', 'Name', 'Severity', 'Level', 'Open for (min)', 'Team mailed', 'ACK holders', 'Management', 'ChatOps', 'Mail ok', 'Error']];
  d.rem.forEach(r => { const a = byId[r.alert_id] || {}; R.push([ksa(r.sent_at), r.alert_id, a.name || '', r.severity || '', 'R' + r.level, r.elapsed_min, r.recipients, r.holders || 0, r.management, (r.channels || []).map(c => c.channel || c.name || '').join('/'), r.mail_ok ? 'yes' : 'no', r.error || '']); });
  return X.build([
    { name: 'Summary', rows: S, numericCols: [3, 4, 5, 6, 8, 9, 10], widths: [30, 44, 9, 10, 10, 9, 12, 8, 14, 12, 9] },
    { name: 'Incidents', rows: I, numericCols: [0, 10, 11, 12, 15, 17, 20, 21], widths: [7, 8, 10, 40, 28, 12, 9, 19, 19, 19, 10, 9, 8, 22, 19, 10, 18, 9, 19, 14, 10, 10, 60] },
    { name: 'Updates', rows: U, widths: [9, 8, 40, 19, 18, 110] },
    { name: 'Audit', rows: A, widths: [19, 26, 12, 22, 9, 80] },
    { name: 'Reminders', rows: R, numericCols: [1, 5, 6, 7, 8], widths: [19, 9, 40, 8, 6, 12, 11, 10, 11, 12, 8, 30] },
  ]);
}

function mount(app, { audit }) {
  app.get('/api/alerts/history', async (req, res) => {
    if (!(req.caps && req.caps.export)) return res.status(403).json({ error: `role ${req.roleName} lacks export` });
    try {
      const seg = segment.forRequest(req, req.query.segment); const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
      const d = await data(seg, days);
      if (req.query.format === 'json') return res.json({ segment: seg, days, incidents: d.inc.length, updates: d.upd.length, audit: d.aud.length, reminders: d.rem.length });
      if (audit) audit(req, 'alert.history.export', null, { segment: seg, days, incidents: d.inc.length });
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Disposition', `attachment; filename="alert_history_${segment.SHORT[seg].toLowerCase()}_${days}d_${stamp}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(xlsx(seg, days, d, req.actor || 'console'));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
module.exports = { mount, data, xlsx };
