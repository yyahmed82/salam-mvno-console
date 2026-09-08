/* snTicket.js — ServiceNow (ServiceHub) WRITE path + incident comms mail. Phase 1 of docs/SERVICENOW-INTEGRATION-PLAN.md.
 *
 *   console incident ──(L1 confirms)──▶ POST /api/now/table/incident ──▶ INC number stored on alerts.sn_*
 *                                        ▲ work notes / comments (PATCH)        │
 *                                        └──── poller every SN_SYNC_MIN ◀───────┘  state · assigned-to · last update
 *
 * Credentials stay in ENV (SN_URL / SN_USER / SN_PASS — see servicenow.js). Everything the ITSM team may want to
 * change lives in console_settings key 'servicenow' (Settings → Notifications → ServiceNow):
 *   writeEnabled     master switch — OFF = dry run: the console shows exactly what it WOULD create, sends nothing
 *   groupMobile / groupFixed   assignment_group display names per business
 *   category / subcategory     defaults (per-rule override later)
 *   impactedService  default text for the comms mail
 * Priority is NOT set directly: ServiceNow derives it from impact × urgency (P1 → 1/1, P2 → 2/2, P3 → 3/3).
 * correlation_id 'ops-console:<alert id>' makes the create idempotent and lets ServiceNow link back.
 *
 * Comms mail = the L1 "Critical Incident Notification" (priority, ticket, reported, description, impact, service,
 * status, bridge) rendered by the console, reviewed by L1, sent Bcc to the lists in console_settings key 'comms'
 * ({ mobile: { P1: [..], P2: [..], P3: [..], bridge, from }, fixed: {...} }) and logged in incident_comms. */
'use strict';
const db = require('./db');
const settings = require('./settings');
const notify = require('./notify');
const { segOf, SHORT, LABEL } = require('./segment');
const sn = require('./servicenow');

const C = db.console;
const SYNC_MIN = Number(process.env.SN_SYNC_MIN || 3);
const CONSOLE_URL = process.env.CONSOLE_PUBLIC_URL || process.env.CONSOLE_BASE_URL || 'https://salam.sa/unified-console/';

const SN_DEFAULTS = { writeEnabled: false, groupMobile: process.env.SN_GROUP || 'MVNO-MS-App-Digital-Chnls', groupFixed: process.env.SN_GROUP_FIXED || '',
  category: '', subcategory: '', impactedService: '', callerMode: 'sender' /* sender | service */ };
const COMMS_DEFAULTS = { mobile: { P1: '', P2: '', P3: '', bridge: '', from: '' }, fixed: { P1: '', P2: '', P3: '', bridge: '', from: '' } };

async function getSnConfig() { const c = (await settings.getSetting('servicenow')) || {}; return { ...SN_DEFAULTS, ...c }; }
async function setSnConfig(patch) {
  const cur = await getSnConfig(); const next = { ...cur };
  for (const k of Object.keys(SN_DEFAULTS)) if (patch && k in patch) next[k] = k === 'writeEnabled' ? !!patch[k] : String(patch[k] == null ? '' : patch[k]).trim();
  if (!['sender', 'service'].includes(next.callerMode)) next.callerMode = 'sender';
  await settings.setSetting('servicenow', next); return next;
}
async function getCommsConfig() {
  const c = (await settings.getSetting('comms')) || {};
  return { mobile: { ...COMMS_DEFAULTS.mobile, ...(c.mobile || {}) }, fixed: { ...COMMS_DEFAULTS.fixed, ...(c.fixed || {}) } };
}
async function setCommsConfig(patch) {
  const cur = await getCommsConfig(); const next = { mobile: { ...cur.mobile }, fixed: { ...cur.fixed } };
  for (const biz of ['mobile', 'fixed']) if (patch && patch[biz] && typeof patch[biz] === 'object')
    for (const k of Object.keys(COMMS_DEFAULTS.mobile)) if (k in patch[biz]) next[biz][k] = String(patch[biz][k] == null ? '' : patch[biz][k]).trim();
  await settings.setSetting('comms', next); return next;
}
const splitList = s => String(s || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+$/.test(x));

/* ---- low-level Table API (basic auth, hard timeout) ---- */
async function snReq(method, path, body, { timeoutMs = 15000 } = {}) {
  if (!sn.snConfigured()) throw new Error('ServiceNow not configured (SN_URL / SN_USER / SN_PASS)');
  const base = process.env.SN_URL.replace(/\/+$/, '');
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(base + path, { method, signal: ac.signal, body: body ? JSON.stringify(body) : undefined,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${process.env.SN_USER}:${process.env.SN_PASS}`).toString('base64') } });
    const text = await r.text().catch(() => '');
    if (!r.ok) throw new Error(`ServiceNow HTTP ${r.status}${text ? ': ' + text.slice(0, 300) : ''}`);
    return text ? JSON.parse(text) : {};
  } finally { clearTimeout(to); }
}
const dv = x => (x && typeof x === 'object') ? (x.display_value != null ? x.display_value : x.value) : x;
const q = s => encodeURIComponent(s);

async function lookupUser(email) {
  if (!email) return null;
  const j = await snReq('GET', `/api/now/table/sys_user?sysparm_query=${q(`email=${email}^active=true`)}&sysparm_fields=sys_id,name,email&sysparm_limit=1`);
  return (j.result || [])[0] || null;
}
async function listGroups(prefix) {
  const j = await snReq('GET', `/api/now/table/sys_user_group?sysparm_query=${q(`active=true^nameSTARTSWITH${prefix || 'MVNO'}^ORDERBYname`)}&sysparm_fields=sys_id,name,description&sysparm_limit=100`);
  return (j.result || []).map(g => ({ sys_id: g.sys_id, name: g.name, description: g.description }));
}
async function listChoices(element) {   // category / subcategory values the instance accepts
  const j = await snReq('GET', `/api/now/table/sys_choice?sysparm_query=${q(`name=incident^element=${element}^inactive=false^language=en^ORDERBYsequence`)}&sysparm_fields=value,label,dependent_value&sysparm_limit=200`);
  return (j.result || []).map(c => ({ value: c.value, label: c.label, dependent: c.dependent_value }));
}

/* ---- draft: what the console proposes to create for this alert ---- */
const IMPACT = { P1: '1', P2: '2', P3: '3', P4: '3' };
function fmtVal(v, unit) { if (v == null) return '—'; v = Number(v); return (unit === 'rate' || unit === 'ratio') ? (v * 100).toFixed(1) + '%' : (Number.isInteger(v) ? String(v) : v.toFixed(2)); }
const OP = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };
function ksa(iso) { try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', ''); } catch (e) { return String(iso || ''); } }
function incidentUrl(alert) { return `${CONSOLE_URL.replace(/\/+$/, '')}/#${segOf(alert) === 'fixed' ? 'fixed-alerts' : 'alerts'}?id=${alert.id}`; }

async function buildDraft(alert, actor) {
  const cfg = await getSnConfig();
  const seg = segOf(alert);
  const rule = (await C.query(`SELECT r.*, mc.unit FROM alert_rules r LEFT JOIN metric_catalog mc ON mc.key = r.metric_key WHERE r.key=$1`, [alert.rule_key]).catch(() => ({ rows: [] }))).rows[0] || {};
  const unit = rule.unit || alert.unit || 'count';
  const steps = String(rule.runbook || '').split(/\n+|(?=\d\)\s)/).map(x => x.trim()).filter(Boolean).slice(0, 6);
  const dim = alert.dim || {};
  const lines = [
    `Salam Operations Console — ${LABEL[seg]} alert ${alert.severity} · ${alert.name}`,
    `Metric: ${alert.metric_key} ${OP[alert.operator] || alert.operator} ${fmtVal(alert.threshold, unit)} — observed ${fmtVal(alert.observed_value, unit)} (sample ${alert.sample ?? '—'}, ${alert.window_hours ?? '—'}h window)`,
    `Fired: ${ksa(alert.fired_at)} KSA · last seen ${ksa(alert.last_seen_at)} KSA · ${alert.breach_count || 1} breach(es)`,
    `Team: ${alert.team || '—'}` + (dim.channel ? ` · Channel: ${dim.channel}` : '') + (dim.type ? ` · Type: ${dim.type}` : ''),
    ...(alert.message ? [`Message: ${alert.message}`] : []),
    ...(rule.trigger_codes ? [`Trigger codes: ${rule.trigger_codes}`] : []),
    ...(rule.description ? [`About this rule: ${rule.description}`] : []),
    ...(steps.length ? ['', 'Runbook:', ...steps.map((s, i) => `${i + 1}. ${s.replace(/^\d+\)\s*/, '')}`)] : []),
    '', `Console incident: ${incidentUrl(alert)}`,
    `Acknowledged by ${alert.ack_by || '—'}${alert.ack_at ? ` at ${ksa(alert.ack_at)} KSA` : ''} · sent by ${actor}`
  ];
  return {
    short_description: `[Ops Console] ${alert.severity} · ${alert.name}`.slice(0, 160),
    description: lines.join('\n'),
    impact: IMPACT[alert.severity] || '3', urgency: IMPACT[alert.severity] || '3',
    assignment_group: seg === 'fixed' ? cfg.groupFixed : cfg.groupMobile,
    category: cfg.category, subcategory: cfg.subcategory,
    caller_email: cfg.callerMode === 'sender' ? actor : '',
    correlation_id: `ops-console:${alert.id}`, correlation_display: 'Salam Ops Console',
    segment: seg, business: SHORT[seg], writeEnabled: !!cfg.writeEnabled, configured: sn.snConfigured()
  };
}

/* ---- create: idempotent per alert; dry run when writes are off or SN is not configured ---- */
async function createForAlert(alert, form, actor) {
  const cfg = await getSnConfig();
  if (alert.sn_number) return { ok: true, existing: true, number: alert.sn_number, sys_id: alert.sn_sys_id, state: alert.sn_state, link: sn.deepLink(alert.sn_sys_id) };
  const d = await buildDraft(alert, actor);
  const f = { ...d, ...(form || {}) };
  const payload = {
    short_description: String(f.short_description || d.short_description).slice(0, 160),
    description: String(f.description || d.description).slice(0, 4000),
    impact: String(f.impact || d.impact), urgency: String(f.urgency || d.urgency),
    correlation_id: d.correlation_id, correlation_display: d.correlation_display,
    work_notes: `Created from the Salam Operations Console by ${actor} (${LABEL[d.segment]} alert #${alert.id}${alert.ack_by ? `, acknowledged by ${alert.ack_by}` : ''}). ${incidentUrl(alert)}`
  };
  if (f.assignment_group) payload.assignment_group = f.assignment_group;   // display name — Table API resolves it
  if (f.category) payload.category = f.category;
  if (f.subcategory) payload.subcategory = f.subcategory;
  if (!cfg.writeEnabled || !sn.snConfigured()) {
    return { ok: false, dryRun: true, reason: !sn.snConfigured() ? 'ServiceNow credentials not set (SN_USER / SN_PASS on 152)' : 'ServiceNow writes are OFF (Settings → Notifications → ServiceNow)', payload };
  }
  // reuse an INC that already carries our correlation id (a retry after a lost response must not open a second ticket)
  try {
    const ex = await snReq('GET', `/api/now/table/incident?sysparm_query=${q(`correlation_id=${d.correlation_id}^active=true`)}&sysparm_fields=number,sys_id,state&sysparm_display_value=true&sysparm_limit=1`);
    const r = (ex.result || [])[0];
    if (r) return await linkAlert(alert, { number: r.number, sys_id: r.sys_id, state: dv(r.state) }, actor, { reused: true });
  } catch (e) { /* lookup is best-effort */ }
  if (f.caller_email) { try { const u = await lookupUser(f.caller_email); if (u) payload.caller_id = u.sys_id; } catch (e) { /* caller stays default */ } }
  const j = await snReq('POST', `/api/now/table/incident?sysparm_display_value=true&sysparm_fields=number,sys_id,state,priority,assignment_group`, payload);
  const r = j.result || {};
  if (!r.sys_id) throw new Error('ServiceNow returned no sys_id');
  return await linkAlert(alert, { number: r.number, sys_id: r.sys_id, state: dv(r.state) || 'New', priority: dv(r.priority), group: dv(r.assignment_group) }, actor, {});
}
async function linkAlert(alert, inc, actor, extra) {
  await C.query(`UPDATE alerts SET sn_number=$1, sn_sys_id=$2, sn_state=$3, sn_synced_at=now(), sn_created_by=$4, sn_created_at=COALESCE(sn_created_at, now()) WHERE id=$5`,
    [inc.number, inc.sys_id, inc.state || 'New', actor, alert.id]);
  await C.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1, 'system', $2)`,
    [alert.id, `ServiceNow ${inc.number} ${extra.reused ? 'linked' : 'created'} by ${actor}${inc.group ? ` → ${inc.group}` : ''}${inc.priority ? ` · ${inc.priority}` : ''}`]);
  return { ok: true, ...inc, link: sn.deepLink(inc.sys_id), reused: !!extra.reused };
}

/* ---- notes: console → ServiceNow (work note = internal, comment = customer-visible) ---- */
async function addNote(alert, text, kind, actor) {
  if (!alert.sn_sys_id) throw new Error('this incident is not linked to a ServiceNow ticket');
  const field = kind === 'comments' ? 'comments' : 'work_notes';
  const body = `[Ops Console · ${actor}] ${String(text || '').trim()}`.slice(0, 4000);
  const cfg = await getSnConfig();
  if (!cfg.writeEnabled || !sn.snConfigured()) return { ok: false, dryRun: true, field, body };
  await snReq('PATCH', `/api/now/table/incident/${alert.sn_sys_id}?sysparm_fields=sys_id`, { [field]: body });
  await C.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1, $2, $3)`, [alert.id, actor, `${field === 'comments' ? '💬' : '📝'} → ${alert.sn_number}: ${String(text).trim()}`]);
  return { ok: true, field };
}

/* ---- poller: ServiceNow → console (state, assignee, last update) for every linked, not-closed alert ---- */
const CLOSED = /^(closed|cancell?ed)$/i;
let timer = null, lastSync = null, lastErr = null, busy = false;
async function syncLinked() {
  if (busy) return { skipped: 'busy' }; busy = true;
  try {
    if (!sn.snConfigured()) return { skipped: 'not configured' };
    const rows = (await C.query(`SELECT id, sn_number, sn_sys_id, sn_state FROM alerts WHERE sn_sys_id IS NOT NULL AND (sn_state IS NULL OR sn_state !~* '^(closed|cancell?ed)$') ORDER BY id DESC LIMIT 200`)).rows;
    if (!rows.length) { lastSync = new Date(); lastErr = null; return { checked: 0 }; }
    const j = await snReq('GET', `/api/now/table/incident?sysparm_query=${q(`sys_idIN${rows.map(r => r.sn_sys_id).join(',')}`)}&sysparm_display_value=true&sysparm_fields=sys_id,number,state,assigned_to,assignment_group,priority,sys_updated_on,resolved_at,close_notes&sysparm_limit=200`);
    const byId = new Map((j.result || []).map(x => [x.sys_id, x]));
    let changed = 0;
    for (const r of rows) {
      const x = byId.get(r.sn_sys_id); if (!x) continue;
      const state = dv(x.state) || r.sn_state, who = dv(x.assigned_to) || '';
      await C.query(`UPDATE alerts SET sn_state=$1, sn_synced_at=now() WHERE id=$2`, [state, r.id]);
      if (state !== r.sn_state) {
        changed++;
        await C.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1, 'system', $2)`,
          [r.id, `ServiceNow ${x.number}: ${r.sn_state || 'New'} → ${state}${who ? ` · assigned to ${who}` : ''}${CLOSED.test(state) && x.close_notes ? ` · ${String(x.close_notes).slice(0, 300)}` : ''}`]);
      }
    }
    lastSync = new Date(); lastErr = null;
    return { checked: rows.length, changed };
  } catch (e) { lastErr = e.message; console.error('[SN-SYNC]', e.message); return { error: e.message }; }
  finally { busy = false; }
}
function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => { syncLinked().catch(() => {}); }, SYNC_MIN * 60000);
  setTimeout(() => syncLinked().catch(() => {}), 20000);
  console.log(`[SN-SYNC] poller armed (${SYNC_MIN} min)`);
}
function status() { return { configured: sn.snConfigured(), lastSync, lastErr, everyMin: SYNC_MIN }; }

/* ---- incident comms mail (the L1 "Critical Incident Notification") ---- */
async function commsDraft(alert, actor, kind) {
  const seg = segOf(alert); const biz = seg === 'fixed' ? 'fixed' : 'mobile';
  const cfg = await getSnConfig(); const cc = (await getCommsConfig())[biz];
  const sev = alert.severity || 'P3';
  const prev = (await C.query(`SELECT kind, sent_at, sent_by, fields FROM incident_comms WHERE alert_id=$1 ORDER BY sent_at DESC LIMIT 1`, [alert.id])).rows[0];
  const k = kind || (prev ? 'update' : 'initial');
  const pf = (prev && prev.fields) || {};
  return {
    kind: k, segment: seg, business: SHORT[seg],
    title: pf.title || alert.name,
    priority: sev, ticket: alert.sn_number || '', reported: ksa(alert.fired_at) + ' KSA',
    description: pf.description || alert.name,
    impact: pf.impact || 'Yes',
    impacted_service: pf.impacted_service || cfg.impactedService || (seg === 'fixed' ? 'Fixed — FTTH / 5G home / e-purchase / Salam Home app' : 'Mobile (MVNO) digital channels'),
    status: k === 'resolved' ? 'Issue resolved — service restored; monitoring continues' : k === 'update' ? '' : 'All respective teams are on the bridge call and troubleshooting the issue',
    bridge: pf.bridge || cc.bridge || '',
    recipients: splitList(cc[sev] || cc.P3 || ''), from_label: cc.from || '',
    console_link: incidentUrl(alert), sn_link: alert.sn_sys_id ? sn.deepLink(alert.sn_sys_id) : '',
    previous: prev ? { kind: prev.kind, sent_at: prev.sent_at, sent_by: prev.sent_by } : null
  };
}
const escH = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function commsHtml(f, seg) {
  const row = (k, v, strong) => `<tr><td style="padding:7px 10px;border:1px solid #d9e2dd;background:#f4f7f5;color:#334155;font-size:12.5px;width:38%;vertical-align:top">${escH(k)}</td><td style="padding:7px 10px;border:1px solid #d9e2dd;font-size:13px;color:#20302a;${strong ? 'font-weight:700' : ''}">${v}</td></tr>`;
  const head = f.kind === 'resolved' ? 'Incident Resolved Notification' : f.kind === 'update' ? 'Incident Status Update' : (f.priority === 'P1' ? 'Critical Incident Notification' : 'Incident Notification');
  const body = `
    <div style="font-size:13.5px;color:#20302a;margin-bottom:12px">Dear Team,</div>
    <div style="text-align:center;font-weight:800;font-size:15px;color:#0b3d2b;margin:6px 0 10px">${escH(head)}</div>
    <table style="border-collapse:collapse;width:100%;margin-bottom:14px">
      ${row('Incident Priority', `<span style="display:inline-block;background:${f.priority === 'P1' ? '#dc2626' : f.priority === 'P2' ? '#d97706' : '#64748b'};color:#fff;font-weight:800;border-radius:6px;padding:1px 9px">${escH(f.priority)}</span>`)}
      ${row('Ticket Number', f.ticket ? (f.sn_link ? `<a href="${escH(f.sn_link)}" style="color:#0e9f5a;font-weight:700">${escH(f.ticket)}</a>` : `<b>${escH(f.ticket)}</b>`) : '<span style="color:#94a3b8">— (not yet raised in ServiceNow)</span>')}
      ${row('Reported Date & Time', escH(f.reported))}
      ${row('Issue Description', escH(f.description), true)}
      ${row('Business / Service Impact', escH(f.impact))}
      ${row('Impacted Service / Application Details', escH(f.impacted_service))}
      ${row('Status Update', escH(f.status).replace(/\n/g, '<br>'))}
    </table>
    ${f.bridge ? `<div style="font-size:13px;color:#20302a;margin-bottom:12px">Kindly join the bridge: <a href="${escH(f.bridge)}" style="color:#0e9f5a;font-weight:700">${escH(f.bridge.length > 70 ? f.bridge.slice(0, 70) + '…' : f.bridge)}</a></div>` : ''}
    <div style="font-size:12px;color:#64748b">Console incident: <a href="${escH(f.console_link)}" style="color:#0e9f5a">${escH(f.console_link)}</a></div>
    <div style="font-size:13px;color:#20302a;margin-top:16px">Regards,<br>${escH(f.from_label || (SHORT[seg] + ' L1 Team'))}</div>
    <div style="color:#94a3b8;font-size:11.5px;margin-top:14px">— sent from the Salam Operations Console · ${escH(LABEL[seg])} incidents</div>`;
  return notify.shell({ title: `${f.priority} — ${f.title}`, badge: `OPERATIONS CONSOLE · ${SHORT[seg].toUpperCase()}`, pill: f.kind === 'resolved' ? 'RESOLVED' : f.kind === 'update' ? 'UPDATE' : f.priority + ' · INCIDENT',
    pillColor: f.kind === 'resolved' ? '#0e9f5a' : f.priority === 'P1' ? '#dc2626' : f.priority === 'P2' ? '#d97706' : '#64748b', bodyHtml: body });
}
async function sendComms(alert, form, actor) {
  const seg = segOf(alert);
  const d = await commsDraft(alert, actor, form && form.kind);
  const f = { ...d, ...(form || {}) };
  f.recipients = splitList(Array.isArray(f.recipients) ? f.recipients.join(',') : f.recipients);
  if (!f.recipients.length) throw new Error(`no recipients — set the ${SHORT[seg]} ${f.priority} list in Settings → Notifications → Incident comms, or type addresses`);
  const subject = `${f.priority}-${f.title}${f.kind === 'update' ? ' - Update' : f.kind === 'resolved' ? ' - Resolved' : ''}`;
  const html = commsHtml(f, seg);
  const out = await notify.sendHtml(f.recipients.map(email => ({ email })), subject, html, []);
  const fields = { title: f.title, description: f.description, impact: f.impact, impacted_service: f.impacted_service, status: f.status, bridge: f.bridge };
  await C.query(`INSERT INTO incident_comms (alert_id, kind, subject, sent_to, sent_by, fields, ok, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [alert.id, f.kind, subject, f.recipients, actor, JSON.stringify(fields), !!out.sent, out.error || out.reason || null]);
  await C.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1, 'system', $2)`,
    [alert.id, `Comms mail (${f.kind}) "${subject}" ${out.sent ? `sent to ${f.recipients.length} recipient(s)` : `NOT sent — ${out.error || out.reason || 'dev'}`} by ${actor}`]);
  if (alert.sn_sys_id) { try { await addNote(alert, `Comms mail (${f.kind}) sent: "${subject}" to ${f.recipients.length} recipient(s)`, 'work_notes', actor); } catch (e) { /* best-effort */ } }
  return { ok: !!out.sent, subject, recipients: f.recipients.length, error: out.error || out.reason || undefined, dev: !!out.dev };
}
async function commsHistory(alertId) {
  return (await C.query(`SELECT id, kind, subject, sent_by, sent_at, ok, error, array_length(sent_to,1) AS n FROM incident_comms WHERE alert_id=$1 ORDER BY sent_at DESC`, [alertId])).rows;
}

module.exports = { getSnConfig, setSnConfig, getCommsConfig, setCommsConfig, buildDraft, createForAlert, addNote, syncLinked, start, status,
  lookupUser, listGroups, listChoices, commsDraft, commsHtml, sendComms, commsHistory, SN_DEFAULTS, COMMS_DEFAULTS };
