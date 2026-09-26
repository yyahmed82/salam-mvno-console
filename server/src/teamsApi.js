/* teamsApi.js — REST for responder teams (teams.js), team re-assignment, manual tickets and Agent 2's rule → team
 * mapping review. Mounted from api.js AFTER the session gate:
 *   require('./teamsApi').mount(app, { audit, requireCap, requireSuper })
 *
 *   GET  /api/teams                         registry (active) + the caller's memberships       any signed-in user
 *   GET  /api/teams/memberships             { email: [ {key, can_*} ] }                          super admin
 *   PUT  /api/teams/memberships/:email      replace one person's teams                            super admin
 *   GET  /api/teams/refund-desks            who handles refunds per business (refundDesk.js)      super admin
 *   PUT  /api/teams/refund-desks/:business  save one desk (team, approvers, cc, ticket, SLAs)      super admin
 *   GET  /api/teams/:key                    team + members + contract obligations                 any signed-in user
 *   PUT  /api/teams/:key                    create / edit (Settings › Teams)                      super admin
 *   PUT  /api/teams/:key/members            replace the member set                                super admin
 *   POST /api/alerts/manual                 open a ticket by hand, assigned to a team              ackErrors
 *   POST /api/alerts/:id/reassign           move an incident to another team (reason required)    ackErrors + canActOn
 *   GET  /api/rules/team-suggestions        Agent 2's proposals (proposed / decided)               alerts view
 *   POST /api/rules/team-suggestions/:id/approve | reject · POST …/approve-all · POST …/run      editRules */
'use strict';
const db = require('./db');
const teams = require('./teams');
const segment = require('./segment');

function mount(app, { audit, requireCap, requireSuper }) {
  const C = db.console;
  teams.ensureSchema().catch(e => console.warn('[teams] schema:', e.message));
  const who = e => String(e || '—').split('@')[0];

  /* ---- registry ---- */
  app.get('/api/teams', async (req, res) => {
    try {
      const all = String(req.query.all || '') === '1';
      const rows = await teams.list({ all });
      const mine = await teams.teamsOf(req.actor);
      res.json({ teams: rows.map(t => ({ ...t, members: t.members })), mine, domains: teams.DOMAINS, levels: teams.LEVELS, businesses: teams.BUSINESSES });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/teams/memberships', requireSuper, async (req, res) => {
    try { res.json({ memberships: await teams.allMemberships() }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/teams/memberships/:email', requireSuper, async (req, res) => {
    try {
      const out = await teams.setUserTeams(req.params.email, (req.body || {}).teams || [], req.actor);
      await audit(req, 'team.user', req.params.email, { teams: out.map(t => t.key) });
      res.json({ ok: true, teams: out });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  /* ---- refund desks (26 Sep 2026): WHO HANDLES REFUNDS, per business — the executing team, the approvers, the copy list,
   * the internal ticket (P4 by default), the two SLA clocks, the agent's mode. Settings › Teams › Refund desks, super admin.
   * Registered before /api/teams/:key so the literal path is not swallowed by the parameter route. ---- */
  app.get('/api/teams/refund-desks', requireSuper, async (req, res) => {
    try { res.json(await require('./refundDesk').desksView()); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/teams/refund-desks/:business', requireSuper, async (req, res) => {
    try {
      const desk = require('./refundDesk'); const biz = String(req.params.business || '').toLowerCase();
      if (!desk.BUSINESSES.includes(biz)) return res.status(400).json({ error: `business must be one of ${desk.BUSINESSES.join(', ')}` });
      const p = await desk.setPolicy(biz, req.body || {}, req.actor);
      await audit(req, 'refund.desk', biz, { team: p.team, approvers: p.approvers, cc: p.cc, mode: p.mode, enabled: p.enabled, ticket_severity: p.ticket_severity, open_incident: p.open_incident, chatops: p.chatops, approve_within_h: p.approve_within_h, refund_within_h: p.refund_within_h, report_hour: p.report_hour });
      const view = await desk.desksView();
      res.json({ ok: true, desk: view.desks.find(d => d.business === biz) || p, rules: view.rules });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/teams/:key', async (req, res) => {
    try {
      const t = await teams.get(req.params.key); if (!t) return res.status(404).json({ error: 'no such team' });
      const [members, obligations, load] = await Promise.all([teams.membersOf(t.key), teams.obligationsFor(t), C.query(
        `SELECT count(*) FILTER (WHERE status='open')::int AS open, count(*) FILTER (WHERE status='open' AND ack_at IS NULL)::int AS unacked,
                count(*) FILTER (WHERE fired_at >= now() - interval '30 days')::int AS fired_30d,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (resolved_at - fired_at))/60) FILTER (WHERE status='resolved' AND fired_at >= now() - interval '30 days')::int AS mttr_min
           FROM alerts WHERE lower(team) = ANY($1)`, [[t.key, t.name, ...(t.aliases || [])].map(x => String(x).toLowerCase())]).then(r => r.rows[0])]);
      const rules = (await C.query(`SELECT key, name, severity, segment, enabled FROM alert_rules WHERE lower(team) = ANY($1) ORDER BY severity, name`, [[t.key, t.name, ...(t.aliases || [])].map(x => String(x).toLowerCase())])).rows;
      res.json({ team: t, members, obligations, load, rules });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/teams/:key', requireSuper, async (req, res) => {
    try {
      const t = await teams.upsert(req.params.key, req.body || {}, req.actor);
      await audit(req, 'team.upsert', t.key, { name: t.name, business: t.business, domain: t.domain, level: t.level, vendor_id: t.vendor_id, active: t.active });
      res.json({ ok: true, team: t });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.put('/api/teams/:key/members', requireSuper, async (req, res) => {
    try {
      const members = await teams.setMembers(req.params.key, (req.body || {}).members || [], req.actor);
      await audit(req, 'team.members', req.params.key, { members: members.map(m => m.email) });
      res.json({ ok: true, members });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  /* ---- manual ticket: an incident opened by a person, owned by a team from the first second ----
   * It is a normal alerts row (rule_key manual_ticket / fixed_manual_ticket, source='manual') so the ack SLA, the
   * reminders, the exec radar, the history XLSX and the vendor clocks all apply — nothing special-cased downstream. */
  app.post('/api/alerts/manual', requireCap('ackErrors'), async (req, res) => {
    try {
      const b = req.body || {};
      const seg = b.segment === 'fixed' ? 'fixed' : 'mvno';
      if (!segment.userSees(req.business || 'both', seg)) return res.status(403).json({ error: `You cannot open a ${segment.LABEL[seg]} ticket — not part of your business.` });
      const severity = ['P1', 'P2', 'P3', 'P4'].includes(b.severity) ? b.severity : 'P3';
      const name = String(b.title || b.name || '').trim().slice(0, 140); if (!name) return res.status(400).json({ error: 'title required' });
      const message = String(b.message || '').trim().slice(0, 2000) || null;
      const team = await teams.resolve(b.team); if (b.team && !team) return res.status(400).json({ error: `unknown team ${b.team}` });
      if (team && team.business !== 'both' && team.business !== segment.BUSINESS_OF[seg]) return res.status(400).json({ error: `${team.name} does not cover ${segment.LABEL[seg]}` });
      const customers = b.customers === '' || b.customers == null ? null : Math.max(0, Number(b.customers) || 0);
      const ruleKey = seg === 'fixed' ? 'fixed_manual_ticket' : 'manual_ticket';
      const row = (await C.query(
        `INSERT INTO alerts (rule_key, name, severity, team, status, metric_key, operator, threshold, observed_value, sample, window_hours, dim, message, fired_at, last_seen_at, peak_value, breach_count, segment, customers, source, created_by, priority_note)
         VALUES ($1,$2,$3,$4,'open','manual','eq',0,0,0,0,$5,$6,now(),now(),0,1,$7,$8,'manual',$9,$10) RETURNING *`,
        [ruleKey, name, severity, team ? team.key : null, JSON.stringify({ source: 'manual', channel: b.channel || null }), message, seg, customers, req.actor, String(b.priority_note || '').slice(0, 300) || null])).rows[0];
      await C.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`, [row.id, `Ticket opened by ${who(req.actor)}${team ? ` and assigned to ${team.name}` : ''}${message ? ` — ${message.slice(0, 200)}` : ''}`]).catch(() => {});
      await audit(req, 'incident.manual', row.id, { segment: seg, severity, team: team ? team.key : null, title: name });
      let mailed = null;
      if (team) { try { mailed = await mailTeam(row, team, { kind: 'opened', by: req.actor, note: message }); } catch (e) { mailed = { error: e.message }; } }
      res.json({ ok: true, alert: row, team: team ? { key: team.key, name: team.name } : null, mailed });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- reassign to another team: the ack is released so the new team's clock starts, the first ack is kept for MTTA ---- */
  app.post('/api/alerts/:id/reassign', requireCap('ackErrors'), async (req, res) => {
    try {
      const a = req.alertRow || (await C.query(`SELECT * FROM alerts WHERE id=$1`, [req.params.id])).rows[0];
      if (!a) return res.status(404).json({ error: 'not found' });
      if (a.status !== 'open') return res.status(400).json({ error: 'only an open incident can be re-assigned' });
      const b = req.body || {}; const note = String(b.note || b.reason || '').trim().slice(0, 300);
      if (!note) return res.status(400).json({ error: 'a reason is required — the receiving team reads it first' });
      const to = await teams.resolve(b.team); if (!to) return res.status(400).json({ error: `unknown team ${b.team || ''}` });
      const seg = segment.segOf(a);
      if (to.business !== 'both' && to.business !== segment.BUSINESS_OF[seg]) return res.status(400).json({ error: `${to.name} does not cover ${segment.LABEL[seg]} incidents` });
      const can = await teams.canActOn(req, a, 'reassign'); if (!can.ok) return res.status(403).json({ error: can.why });
      const from = await teams.resolve(a.team);
      if (from && from.key === to.key) return res.json({ ok: true, unchanged: true, team: to.key });
      await C.query(`UPDATE alerts SET team=$2, first_ack_at=COALESCE(first_ack_at, ack_at), ack_by=NULL, ack_at=NULL, assignee=NULL, ack_reminder_level=0, ack_reminder_at=NULL,
                       reassign_count=coalesce(reassign_count,0)+1, reassigned_at=now() WHERE id=$1`, [a.id, to.key]);
      await C.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`,
        [a.id, `Re-assigned: ${from ? from.name : (a.team || 'no team')} → ${to.name} by ${who(req.actor)} — ${note}${a.ack_by ? ` (ack released from ${who(a.ack_by)}; the ${to.name} ack clock starts now)` : ''}`]).catch(() => {});
      await audit(req, 'incident.reassign', a.id, { from: from ? from.key : a.team || null, to: to.key, note, via: can.via });
      let mailed = null; try { mailed = await mailTeam({ ...a, team: to.key }, to, { kind: 'reassigned', by: req.actor, note, from: from ? from.name : a.team }); } catch (e) { mailed = { error: e.message }; }
      res.json({ ok: true, from: from ? from.key : a.team || null, to: to.key, team: { key: to.key, name: to.name }, mailed });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- Agent 2 rule → team mapping review ---- */
  app.get('/api/rules/team-suggestions', async (req, res) => {
    try {
      const seg = segment.forRequest(req, req.query.segment);
      const status = String(req.query.status || 'proposed');
      const rows = (await C.query(`SELECT s.*, r.name AS rule_name, r.severity, r.enabled FROM alert_rule_team_suggestions s LEFT JOIN alert_rules r ON r.key=s.rule_key
          WHERE ${segment.sqlWhere('s', 'rule_key', seg)} ${status === 'all' ? '' : 'AND s.status=$1'} ORDER BY s.confidence DESC NULLS LAST, s.rule_key`, status === 'all' ? [] : [status])).rows;
      const counts = (await C.query(`SELECT status, count(*)::int n FROM alert_rule_team_suggestions WHERE ${segment.sqlWhere('alert_rule_team_suggestions', 'rule_key', seg)} GROUP BY status`)).rows;
      const last = (await C.query(`SELECT started_at, finished_at, ok, stats FROM agent_runs WHERE agent='incident.map' ORDER BY id DESC LIMIT 1`).catch(() => ({ rows: [] }))).rows[0] || null;
      res.json({ suggestions: rows, counts: Object.fromEntries(counts.map(c => [c.status, c.n])), segment: seg, lastRun: last });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  async function decide(req, id, approve) {
    const s = (await C.query(`SELECT * FROM alert_rule_team_suggestions WHERE id=$1`, [id])).rows[0]; if (!s) throw new Error('no such suggestion');
    if (s.status !== 'proposed') return s;
    if (approve) {
      const before = (await C.query(`SELECT id, key, team FROM alert_rules WHERE key=$1`, [s.rule_key])).rows[0];
      await C.query(`UPDATE alert_rules SET team=$2, operator_edited=true, updated_at=now() WHERE key=$1`, [s.rule_key, s.suggested_team]);
      if (before) await C.query(`INSERT INTO alert_rule_changes (rule_id, rule_key, action, actor, changes) VALUES ($1,$2,'update',$3,$4)`, [before.id, before.key, req.actor, JSON.stringify({ team: { from: before.team || null, to: s.suggested_team } })]).catch(() => {});
      await C.query(`UPDATE alerts SET team=$2 WHERE rule_key=$1 AND status='open' AND (team IS NULL OR team='' OR team=$3)`, [s.rule_key, s.suggested_team, s.current_team || '']);
    }
    await C.query(`UPDATE alert_rule_team_suggestions SET status=$2, decided_by=$3, decided_at=now(), updated_at=now() WHERE id=$1`, [id, approve ? 'applied' : 'rejected', req.actor]);
    await audit(req, approve ? 'rule.team.approve' : 'rule.team.reject', s.rule_key, { from: s.current_team, to: s.suggested_team, method: s.method, confidence: s.confidence });
    return { ...s, status: approve ? 'applied' : 'rejected' };
  }
  app.post('/api/rules/team-suggestions/:id/approve', requireCap('editRules'), async (req, res) => { try { res.json({ ok: true, suggestion: await decide(req, req.params.id, true) }); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/rules/team-suggestions/:id/reject', requireCap('editRules'), async (req, res) => { try { res.json({ ok: true, suggestion: await decide(req, req.params.id, false) }); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/rules/team-suggestions/approve-all', requireCap('editRules'), async (req, res) => {
    try {
      const seg = segment.forRequest(req, (req.body || {}).segment); const min = Number((req.body || {}).minConfidence) || 0.8;
      const ids = (await C.query(`SELECT id FROM alert_rule_team_suggestions WHERE status='proposed' AND coalesce(confidence,0) >= $1 AND ${segment.sqlWhere('alert_rule_team_suggestions', 'rule_key', seg)}`, [min])).rows.map(r => r.id);
      let n = 0; for (const id of ids) { await decide(req, id, true); n++; }
      res.json({ ok: true, applied: n, minConfidence: min });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/rules/team-suggestions/run', requireCap('editRules'), async (req, res) => {
    try { res.json(await require('./agentIncident').mapRules({ force: !!(req.body || {}).force })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- team mail (members + DL), best-effort ---- */
  async function mailTeam(alert, team, { kind, by, note, from } = {}) {
    const notify = require('./notify');
    const aud = await teams.audienceOf(team.key);
    const rcpt = aud.people.slice(); if (aud.dl) rcpt.push({ email: aud.dl, name: team.name });
    if (!rcpt.length) return { sent: false, reason: 'team has no members and no mail DL' };
    const seg = segment.segOf(alert);
    const link = `${notify.CONSOLE_URL}#${seg === 'fixed' ? 'fixed-alerts' : 'alerts'}?id=${alert.id}`;
    const esc = notify.esc;
    const head = kind === 'opened' ? `${who(by)} opened this ticket and assigned it to <b>${esc(team.name)}</b>.` : `${who(by)} re-assigned this incident${from ? ` from ${esc(from)}` : ''} to <b>${esc(team.name)}</b>.`;
    const body = `<div style="background:#eaf6ff;border:1px solid #bfdcf5;border-left:4px solid #0891b2;border-radius:8px;padding:12px 16px;margin-bottom:16px">
        <div style="font-weight:800;color:#0c4a6e;font-size:13px;margin-bottom:4px">${head}</div>${note ? `<div style="font-size:13px;color:#334155;margin:4px 0"><b>Reason / note:</b> ${esc(note)}</div>` : ''}
        <div style="font-size:12.5px;color:#334155;margin-top:6px">Nobody holds the acknowledgement yet — the ack SLA clock for ${esc(team.name)} is running. <a href="${link}" style="color:#0e9f5a;font-weight:700">Open the incident ›</a></div></div>
      <table style="border-collapse:collapse;width:100%">${[['Incident', `<b>${esc(alert.severity)} · ${esc(alert.name)}</b>`], ['Business', esc(segment.LABEL[seg])], ['Team', esc(team.name)], ...(alert.message ? [['Message', esc(alert.message)]] : []), ['Opened', esc(String(alert.fired_at || '').slice(0, 16).replace('T', ' ')) + ' UTC']]
        .map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#64748b;font-size:12px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;font-size:13px;color:#20302a">${v}</td></tr>`).join('')}</table>
      <div style="color:#94a3b8;font-size:12px;margin-top:14px">— Salam Operations Console · ${esc(segment.LABEL[seg])} incidents · recorded on the incident and in the audit trail</div>`;
    const html = notify.shell({ title: kind === 'opened' ? `New ticket for ${team.name}` : `Incident re-assigned to ${team.name}`, badge: `OPERATIONS CONSOLE · ${segment.SHORT[seg].toUpperCase()}`,
      pill: `${alert.severity} · ACTION NEEDED`, pillColor: alert.severity === 'P1' ? '#dc2626' : alert.severity === 'P2' ? '#d97706' : '#64748b', bodyHtml: body });
    return notify.sendHtml(rcpt, `[Salam Ops · ${segment.SHORT[seg]}] ${alert.severity} ${kind === 'opened' ? 'ticket' : 're-assigned'} for ${team.name} — ${alert.name}`, html, []);
  }
}
module.exports = { mount };
