/* ackSla.js — ACKNOWLEDGEMENT SLA: reminders + management escalation for alerts nobody has acknowledged.
 *
 * L1 already receives every alert by mail (digest + PDF report / SOP) the moment it fires. This module is the
 * "nobody picked it up" safety net (10 Sep 2026):
 *
 *   fired ──5 min──▶ Reminder 1  → every member of the business (mail_alert users of that side), amber notice
 *         ──15 min─▶ Reminder 2  → same audience, orange warning (+ Teams / WhatsApp when ChatOps is enabled)
 *         ──30 min─▶ Reminder 3  → same audience, red critical + ESCALATION mail to management (for information)
 *         ──every N min after──▶ Reminder 3 repeats (P1 by default) until someone acknowledges
 *
 * Everything is CONFIGURABLE per business (Mobile / Fixed) and per priority (P1 / P2 / P3) — Settings ▸ SLA ▸
 * "Acknowledgement SLA". Timing uses alerts.opened_wall (real clock) like escalation.js, so replay / sim clocks
 * never fire reminders. A reminder stops the moment the alert is acknowledged, snoozed or resolved; correlated
 * children (an open provider root above them) are not reminded separately — the root is.
 *
 * Model (console_settings key 'ack_sla'):
 *   { enabled: true,
 *     mobile: { enabled, management: 'a@salam.sa, b@salam.sa', chatops: true,
 *               P1: { r1: 5, r2: 15, r3: 30, repeat: 30, management: true },
 *               P2: { r1: 15, r2: 30, r3: 60, repeat: 60, management: true },
 *               P3: { r1: 30, r2: 60, r3: 120, repeat: 0, management: false } },
 *     fixed:  { ...same shape... } }
 *
 * State: alerts.ack_reminder_level (0..3 = highest reminder sent), alerts.ack_reminder_at (last send), and the
 * table alert_reminders (one row per send: level, recipients, management, channels) — the audit + dashboard feed.
 * Dashboard: GET /api/ack-sla/status?segment= → overdue alerts per side with elapsed / level / next due, used by
 * the home page notice, the Alerts page banner and the STATUS cell chip. */
'use strict';
const db = require('./db');
const SEG = require('./segment');
const settings = { get: k => require('./settings').getSetting(k), set: (k, v) => require('./settings').setSetting(k, v) };

const PRIORITIES = ['P1', 'P2', 'P3'];
const BUSINESSES = ['mobile', 'fixed'];
const SEG_OF_BIZ = { mobile: 'mvno', fixed: 'fixed' };
const DEFAULT_LADDER = {
  P1: { r1: 5,  r2: 15, r3: 30,  repeat: 30, management: true },
  P2: { r1: 15, r2: 30, r3: 60,  repeat: 60, management: true },
  P3: { r1: 30, r2: 60, r3: 120, repeat: 0,  management: false },
};
const bizDefaults = () => ({ enabled: true, management: '', chatops: true, P1: { ...DEFAULT_LADDER.P1 }, P2: { ...DEFAULT_LADDER.P2 }, P3: { ...DEFAULT_LADDER.P3 } });
const DEFAULTS = { enabled: true, mobile: bizDefaults(), fixed: bizDefaults() };
const LEVEL = {
  1: { word: 'Reminder 1', pill: 'REMINDER 1 · UNACKNOWLEDGED', color: '#d97706', bg: '#fff7ed', border: '#f59e0b', fg: '#9a3412', tone: 'notice' },
  2: { word: 'Reminder 2', pill: 'REMINDER 2 · ATTENTION REQUIRED', color: '#ea580c', bg: '#fff1f2', border: '#f97316', fg: '#9a3412', tone: 'warning' },
  3: { word: 'Reminder 3', pill: 'REMINDER 3 · ESCALATED TO MANAGEMENT', color: '#dc2626', bg: '#fef2f2', border: '#dc2626', fg: '#7f1d1d', tone: 'critical' },
};
const TICK_MS = 60 * 1000;
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : d; };

/* ---------------------------------------------------------------- config */
let _cache = null, _cacheAt = 0;
async function getConfig() {
  if (_cache && Date.now() - _cacheAt < 15000) return _cache;
  const c = (await settings.get('ack_sla')) || {};
  const out = { enabled: c.enabled == null ? true : !!c.enabled };
  for (const b of BUSINESSES) {
    const src = c[b] || {}, d = bizDefaults();
    const biz = { enabled: src.enabled == null ? d.enabled : !!src.enabled, management: String(src.management || ''), chatops: src.chatops == null ? d.chatops : !!src.chatops };
    for (const p of PRIORITIES) {
      const s = src[p] || {}, dd = DEFAULT_LADDER[p];
      biz[p] = { r1: num(s.r1, dd.r1), r2: num(s.r2, dd.r2), r3: num(s.r3, dd.r3), repeat: num(s.repeat, dd.repeat), management: s.management == null ? dd.management : !!s.management };
    }
    out[b] = biz;
  }
  _cache = out; _cacheAt = Date.now();
  return out;
}
/* validates + normalises: ladders must be increasing (r1 < r2 < r3); 0 disables a step; repeat 0 = no repeat */
async function setConfig(patch) {
  const cur = await getConfig();
  const next = { enabled: 'enabled' in (patch || {}) ? !!patch.enabled : cur.enabled };
  for (const b of BUSINESSES) {
    const p = (patch && patch[b]) || {}, c = cur[b];
    const biz = { enabled: 'enabled' in p ? !!p.enabled : c.enabled, management: 'management' in p ? cleanList(p.management) : c.management, chatops: 'chatops' in p ? !!p.chatops : c.chatops };
    for (const pr of PRIORITIES) {
      const s = p[pr] || {}, cc = c[pr];
      const L = { r1: num(s.r1, cc.r1), r2: num(s.r2, cc.r2), r3: num(s.r3, cc.r3), repeat: num(s.repeat, cc.repeat), management: 'management' in s ? !!s.management : cc.management };
      if (L.r2 && L.r1 && L.r2 <= L.r1) throw new Error(`${b} ${pr}: reminder 2 (${L.r2} min) must come after reminder 1 (${L.r1} min)`);
      if (L.r3 && L.r3 <= Math.max(L.r1, L.r2)) throw new Error(`${b} ${pr}: reminder 3 (${L.r3} min) must come after reminder 2`);
      if (L.repeat && L.repeat < 5) throw new Error(`${b} ${pr}: repeat interval must be at least 5 min (or 0 to send reminder 3 once)`);
      biz[pr] = L;
    }
    next[b] = biz;
  }
  await settings.set('ack_sla', next); _cache = null;
  return next;
}
const cleanList = s => String(s || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).filter((x, i, a) => a.indexOf(x) === i).join(', ');
const listOf = s => cleanList(s).split(', ').filter(Boolean);

/* ---------------------------------------------------------------- schema */
async function ensureSchema() {
  await db.console.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ack_reminder_level integer NOT NULL DEFAULT 0`);
  await db.console.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ack_reminder_at timestamptz`);
  await db.console.query(`CREATE TABLE IF NOT EXISTS alert_reminders (
      id bigserial PRIMARY KEY, alert_id bigint NOT NULL, level smallint NOT NULL, business text NOT NULL, severity text,
      elapsed_min integer NOT NULL, recipients integer NOT NULL DEFAULT 0, management integer NOT NULL DEFAULT 0,
      channels jsonb NOT NULL DEFAULT '[]'::jsonb, mail_ok boolean, error text, sent_at timestamptz NOT NULL DEFAULT now())`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_alert_reminders_alert ON alert_reminders (alert_id, sent_at DESC)`);
}

/* ---------------------------------------------------------------- what is due */
/* the level an alert should be at after `elapsedMin` and whether a send is due now */
function dueLevel(L, elapsedMin, have, lastAt, now) {
  let target = 0;
  if (L.r1 && elapsedMin >= L.r1) target = 1;
  if (L.r2 && elapsedMin >= L.r2) target = 2;
  if (L.r3 && elapsedMin >= L.r3) target = 3;
  if (target > have) return { level: target, kind: 'new' };
  if (have === 3 && L.repeat && lastAt && (now - new Date(lastAt)) / 60000 >= L.repeat) return { level: 3, kind: 'repeat' };
  return null;
}
function nextDue(L, elapsedMin, have, lastAt, now) {
  const steps = [[1, L.r1], [2, L.r2], [3, L.r3]].filter(([lv, m]) => m && lv > have);
  if (steps.length) return { level: steps[0][0], inMin: Math.max(0, Math.ceil(steps[0][1] - elapsedMin)) };
  if (have === 3 && L.repeat) { const since = lastAt ? (now - new Date(lastAt)) / 60000 : 0; return { level: 3, inMin: Math.max(0, Math.ceil(L.repeat - since)), repeat: true }; }
  return null;
}
async function openUnacked(now) {
  return (await db.console.query(
    `SELECT a.id, a.rule_key, a.name, a.severity, a.team, a.metric_key, a.operator, a.threshold, a.observed_value, a.sample, a.window_hours,
            a.message, a.fired_at, a.last_seen_at, a.opened_wall, a.breach_count, a.snoozed_until, a.ack_reminder_level, a.ack_reminder_at, a.sn_number,
            r.runbook, r.description, r.trigger_codes, r.segment, r.dim
       FROM alerts a LEFT JOIN alert_rules r ON r.key = a.rule_key
      WHERE a.status='open' AND a.ack_at IS NULL AND (a.snoozed_until IS NULL OR a.snoozed_until <= $1)
      ORDER BY CASE a.severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, a.opened_wall`, [now.toISOString()])).rows;
}
/* correlated children under an OPEN root are not reminded separately (the root is the incident) */
async function childKeys() {
  try { const corr = require('./correlation'); const roots = await corr.openRootKeys(db.console); const ch = new Set();
    for (const k of Object.keys(corr.SUPPRESSED_BY || {})) if (corr.suppressorOf(k, roots)) ch.add(k); return ch; } catch (_) { return new Set(); }
}
/* the live picture for the dashboard / banners */
async function status(seg) {
  const cfg = await getConfig(); const now = new Date();
  const rows = await openUnacked(now); const kids = await childKeys();
  const out = { enabled: cfg.enabled, now: now.toISOString(), mobile: side('mobile'), fixed: side('fixed') };
  function side(b) {
    const bc = cfg[b]; const s = SEG_OF_BIZ[b];
    const list = rows.filter(a => SEG.segOf(a) === s).map(a => {
      const L = bc[a.severity] || bc.P3; const elapsed = Math.max(0, (now - new Date(a.opened_wall || a.fired_at)) / 60000);
      const nd = (cfg.enabled && bc.enabled) ? nextDue(L, elapsed, Number(a.ack_reminder_level) || 0, a.ack_reminder_at, now) : null;
      return { id: a.id, name: a.name, severity: a.severity, team: a.team, elapsed_min: Math.round(elapsed), level: Number(a.ack_reminder_level) || 0,
        last_reminder_at: a.ack_reminder_at, next: nd, overdue: !!(L.r1 && elapsed >= L.r1), child: kids.has(a.rule_key), sn_number: a.sn_number };
    });
    const overdue = list.filter(x => x.overdue && !x.child);
    const worst = overdue.slice().sort((x, y) => y.level - x.level || y.elapsed_min - x.elapsed_min)[0] || null;
    return { enabled: cfg.enabled && bc.enabled, unacked: list.length, overdue: overdue.length, level3: overdue.filter(x => x.level >= 3).length,
      level2: overdue.filter(x => x.level === 2).length, level1: overdue.filter(x => x.level === 1).length, worst, alerts: list, management: listOf(bc.management).length };
  }
  if (seg) return { enabled: out.enabled, now: out.now, side: seg === 'fixed' ? out.fixed : out.mobile };
  return out;
}

/* ---------------------------------------------------------------- the tick */
async function tick(inject = {}) {
  const cfg = inject.cfg || await getConfig();
  if (!cfg.enabled) return { skipped: 'disabled', sent: 0 };
  const now = inject.now ? new Date(inject.now) : new Date();
  const rows = await openUnacked(now); const kids = await childKeys();
  let sent = 0; const events = [];
  for (const a of rows) {
    const seg = SEG.segOf(a); const b = seg === 'fixed' ? 'fixed' : 'mobile'; const bc = cfg[b];
    if (!bc.enabled) continue;
    if (kids.has(a.rule_key)) continue;
    const L = bc[a.severity] || bc.P3;
    const elapsed = Math.max(0, (now - new Date(a.opened_wall || a.fired_at)) / 60000);
    const have = Number(a.ack_reminder_level) || 0;
    const due = dueLevel(L, elapsed, have, a.ack_reminder_at, now);
    if (!due) continue;
    try {
      const r = await sendReminder(a, { level: due.level, repeat: due.kind === 'repeat', elapsedMin: Math.round(elapsed), business: b, seg, cfg: bc, siblings: rows.filter(x => x.id !== a.id && SEG.segOf(x) === seg) });
      await db.console.query(`UPDATE alerts SET ack_reminder_level=$1, ack_reminder_at=$2 WHERE id=$3`, [due.level, now.toISOString(), a.id]);
      events.push({ alert: a.id, severity: a.severity, business: b, level: due.level, repeat: due.kind === 'repeat', ...r }); sent++;
    } catch (e) { console.error('[ACK-SLA] reminder', a.id, e.message); events.push({ alert: a.id, level: due.level, error: e.message }); }
  }
  if (sent) console.log(`[ACK-SLA] ${sent} reminder(s) sent at ${now.toISOString()}`);
  return { sent, events, checked: rows.length };
}

/* ---------------------------------------------------------------- the mails */
const ksa = iso => { try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', ''); } catch (_) { return String(iso || '—'); } };
const OP = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };
const fmtVal = (v, unit) => v == null ? '—' : (unit === 'rate' || unit === 'ratio') ? (Number(v) * 100).toFixed(1) + '%' : (Number.isInteger(+v) ? String(v) : Number(v).toFixed(2));
const mins = m => m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
const sevColor = s => s === 'P1' ? '#dc2626' : s === 'P2' ? '#d97706' : '#64748b';

async function buildMail(a, { level, repeat, elapsedMin, business, seg, cfg, siblings, forManagement }) {
  const notify = require('./notify'); const esc = notify.esc;
  const LV = LEVEL[level]; const L = cfg[a.severity] || cfg.P3;
  const link = `${notify.CONSOLE_URL || 'https://salam.sa/unified-console/'}#${seg === 'fixed' ? 'fixed-alerts' : 'alerts'}?id=${a.id}`;
  const unit = (await db.console.query(`SELECT unit FROM metric_catalog WHERE key=$1`, [a.metric_key]).catch(() => ({ rows: [] }))).rows[0]?.unit || 'count';
  const steps = String(a.runbook || '').split(/\n+|(?=\d\)\s)/).map(x => x.trim()).filter(Boolean);
  const bizLabel = SEG.LABEL[seg], bizShort = SEG.SHORT[seg];
  const headline = forManagement
    ? `For information: a ${a.severity} ${bizShort} alert has been open for ${mins(elapsedMin)} without acknowledgement`
    : level === 1 ? `Nobody has acknowledged this ${a.severity} alert yet — ${mins(elapsedMin)} since it fired`
    : level === 2 ? `Still unacknowledged after ${mins(elapsedMin)} — this ${a.severity} needs an owner now`
    : `${repeat ? 'Still unacknowledged' : 'Unacknowledged'} after ${mins(elapsedMin)} — management has been informed`;
  const ask = forManagement
    ? `No action is expected from you. The ${bizLabel} team has received three reminders (${L.r1} / ${L.r2} / ${L.r3} min); this mail is the escalation step of the acknowledgement SLA${L.repeat ? ` and repeats every ${L.repeat} min until someone takes the alert` : ''}.`
    : level === 3
    ? `This is the third reminder. Management (${listOf(cfg.management).length || 0} contact${listOf(cfg.management).length === 1 ? '' : 's'}) has been copied for information${L.repeat ? ` and this reminder repeats every ${L.repeat} min until the alert is acknowledged` : ''}. Please take ownership now — one click on <b>Ack</b> stops every reminder.`
    : level === 2
    ? `Second reminder. The alert has not been acknowledged by anyone on L1 or L2 for ${mins(elapsedMin)}. If you are available, open it and press <b>Ack</b>; at ${L.r3} min management is informed automatically.`
    : `First reminder. Every ${bizShort} member receives this so that whoever is available can take it. Acknowledging (one click on <b>Ack</b>) stops the reminders and tells the team who owns it.`;
  const ladder = `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:10px 0 4px;font-size:11.5px">
      <tr>${[[1, L.r1], [2, L.r2], [3, L.r3]].map(([lv, m]) => `<td style="padding:4px 10px;border-radius:6px;margin-right:4px;background:${lv <= level ? LEVEL[lv].color : '#e2e8f0'};color:${lv <= level ? '#fff' : '#64748b'};font-weight:700;letter-spacing:.04em">${lv <= level ? '●' : '○'} R${lv} · ${m ? m + ' min' : 'off'}</td><td style="width:6px"></td>`).join('')}
      <td style="padding:4px 10px;border-radius:6px;background:${L.management && cfg.management ? (level >= 3 ? '#7f1d1d' : '#e2e8f0') : '#f1f5f9'};color:${level >= 3 && L.management ? '#fff' : '#64748b'};font-weight:700">${L.management && listOf(cfg.management).length ? 'MGMT at R3' : 'no mgmt step'}</td></tr></table>`;
  const detail = [
    ['Alert', `<b style="color:${sevColor(a.severity)}">${esc(a.severity)}</b> · <b>${esc(a.name)}</b>`],
    ['Business', `${bizLabel}${a.team ? ` · team ${esc(a.team)}` : ''}`],
    ['Observed', `<b>${fmtVal(a.observed_value, unit)}</b> vs threshold ${OP[a.operator] || a.operator} ${fmtVal(a.threshold, unit)} (sample ${a.sample ?? '—'}, ${a.window_hours}h window)`],
    ['Fired', `${ksa(a.opened_wall || a.fired_at)} KSA · open for <b>${mins(elapsedMin)}</b> · ${a.breach_count || 1} breach(es) · last seen ${ksa(a.last_seen_at)} KSA`],
    ['Metric', `<span style="font-family:monospace;font-size:12px">${esc(a.metric_key)}</span>`],
    ...(a.message ? [['Message', esc(a.message)]] : []),
    ...(a.description ? [['What it means', esc(a.description)]] : []),
    ...(a.trigger_codes ? [['Trigger codes', esc(a.trigger_codes)]] : []),
    ...(a.sn_number ? [['ServiceNow', esc(a.sn_number)]] : []),
  ];
  const kv = detail.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#64748b;font-size:12px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;font-size:13px;color:#20302a">${v}</td></tr>`).join('');
  const others = (siblings || []).slice(0, 8);
  const othersHtml = others.length ? `<div style="font-weight:800;font-size:12px;letter-spacing:.06em;color:#334155;margin:14px 0 6px">OTHER UNACKNOWLEDGED ${bizShort.toUpperCase()} ALERTS (${siblings.length})</div>
      <table style="border-collapse:collapse;width:100%;font-size:12.5px">${others.map(s => { const e = Math.round((Date.now() - new Date(s.opened_wall || s.fired_at)) / 60000); return `<tr><td style="padding:3px 8px 3px 0;white-space:nowrap"><b style="color:${sevColor(s.severity)}">${esc(s.severity)}</b></td><td style="padding:3px 8px 3px 0">${esc(s.name)}</td><td style="padding:3px 0;color:#64748b;white-space:nowrap">${mins(e)} · ${s.ack_reminder_level ? 'R' + s.ack_reminder_level : '—'}</td></tr>`; }).join('')}</table>` : '';
  const body = `
    <div style="background:${LV.bg};border:1px solid ${LV.border};border-left:5px solid ${LV.color};border-radius:8px;padding:12px 16px;margin-bottom:16px">
      <div style="font-weight:800;color:${LV.fg};font-size:14px;margin-bottom:4px">${forManagement ? '📣 ' : level === 3 ? '🚨 ' : level === 2 ? '⚠️ ' : '⏰ '}${esc(headline)}</div>
      <div style="font-size:12.5px;color:#334155">${ask}</div>
      ${ladder}
    </div>
    <table style="border-collapse:collapse;width:100%;margin-bottom:12px">${kv}</table>
    <div style="margin:6px 0 14px"><a href="${link}" style="display:inline-block;background:${forManagement ? '#0b3d2b' : LV.color};color:#fff;text-decoration:none;font-weight:800;padding:10px 18px;border-radius:8px;font-size:13px">${forManagement ? 'Open the incident ›' : 'Open & acknowledge ›'}</a>
      <span style="font-size:11.5px;color:#64748b;margin-left:10px">${bizShort} › Alerts › ${forManagement ? 'incident timeline and guide' : 'press Ack on the row'}</span></div>
    ${steps.length && !forManagement ? `<div style="font-weight:800;font-size:12px;letter-spacing:.06em;color:#334155;margin:10px 0 6px">SOP · RUNBOOK</div><ol style="margin:0 0 12px 18px;padding:0;font-size:13px;color:#20302a;line-height:1.6">${steps.map(x => `<li>${esc(x.replace(/^\d+\)\s*/, ''))}</li>`).join('')}</ol>` : ''}
    ${othersHtml}
    <div style="color:#94a3b8;font-size:12px;margin-top:16px">— Salam Operations Console · ${esc(bizLabel)} acknowledgement SLA · ${forManagement ? 'management is informed at reminder 3; ' : ''}reminders stop automatically on Ack / Snooze / Resolve · configurable in Settings › SLA</div>`;
  const html = notify.shell({ title: forManagement ? `Escalation — unacknowledged ${a.severity} · ${bizLabel}` : `${LV.word} — unacknowledged ${a.severity} · ${bizLabel}`,
    badge: `OPERATIONS CONSOLE · ${bizShort.toUpperCase()}`, pill: forManagement ? 'ESCALATION · FOR INFORMATION' : LV.pill, pillColor: forManagement ? '#7f1d1d' : LV.color, bodyHtml: body });
  const subject = forManagement
    ? `[Salam Ops · ${bizShort}] ESCALATION — ${a.severity} unacknowledged ${mins(elapsedMin)} — ${a.name}`
    : `[Salam Ops · ${bizShort}] ${LV.word.toUpperCase()}${repeat ? ' (repeat)' : ''} — ${a.severity} unacknowledged ${mins(elapsedMin)} — ${a.name}`;
  return { html, subject, link };
}

async function sendReminder(a, ctx) {
  const notify = require('./notify');
  const { level, business, seg, cfg, elapsedMin, repeat } = ctx;
  const L = cfg[a.severity] || cfg.P3;
  const team = await notify.recipients('mail_alert', seg);
  let attachments = [];
  try { const rule = { key: a.rule_key, name: a.name, severity: a.severity, team: a.team, metric_key: a.metric_key, operator: a.operator, threshold: a.threshold, value: a.observed_value, sample: a.sample, window_hours: a.window_hours, segment: seg, fired: true, description: a.description, runbook: a.runbook, trigger_codes: a.trigger_codes };
    attachments = (await require('./alertReport').buildFiredReports(new Date(), [rule], { max: 1 })).attachments || []; } catch (_) { attachments = []; }
  const m = await buildMail(a, ctx);
  const out = { recipients: team.length, management: 0, channels: [], mail: null, mgmt: null };
  out.mail = await notify.sendHtml(team, m.subject, m.html, attachments).catch(e => ({ sent: false, error: e.message }));
  const mgmt = level >= 3 && L.management ? listOf(cfg.management) : [];
  if (mgmt.length) {
    const mm = await buildMail(a, { ...ctx, forManagement: true });
    out.mgmt = await notify.sendHtml(mgmt.map(email => ({ email })), mm.subject, mm.html, attachments).catch(e => ({ sent: false, error: e.message }));
    out.management = mgmt.length;
  }
  if (cfg.chatops && level >= 2) {
    try { const c = await require('./chatops').notifyIncident({ ...a, escTierLabel: `${LEVEL[level].word} — unacknowledged ${mins(elapsedMin)}${level >= 3 && mgmt.length ? ' · management informed' : ''}` },
        { kind: 'escalated', force: true, mention: level >= 3 ? `🚨 ${LEVEL[level].word}: nobody has acknowledged this ${a.severity} for ${mins(elapsedMin)} — take it now` : `⚠️ ${LEVEL[level].word}: unacknowledged ${mins(elapsedMin)} — who takes it?` });
      out.channels = (c && c.channels) || []; } catch (e) { out.channels = [{ error: e.message }]; }
  }
  const ok = !!(out.mail && out.mail.sent);
  await db.console.query(`INSERT INTO alert_reminders (alert_id, level, business, severity, elapsed_min, recipients, management, channels, mail_ok, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [a.id, level, business, a.severity, elapsedMin, out.recipients, out.management, JSON.stringify(out.channels), ok, out.mail && out.mail.error ? out.mail.error : (out.mail && out.mail.dev ? 'no SMTP (dev)' : null)]).catch(() => {});
  const line = `${LEVEL[level].word}${repeat ? ' (repeat)' : ''}: unacknowledged for ${mins(elapsedMin)} — mailed ${out.recipients} ${SEG.SHORT[seg]} member(s)${out.management ? `, escalation to ${out.management} management contact(s)` : ''}${out.channels.length ? `, ChatOps ${out.channels.map(c => c.channel || c.name || 'channel').join('/')}` : ''}${ok ? '' : out.mail && out.mail.dev ? ' (no SMTP configured)' : ` — mail failed: ${(out.mail && (out.mail.error || out.mail.reason)) || 'unknown'}`}`;
  await db.console.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`, [a.id, line]).catch(() => {});
  await db.console.query(`INSERT INTO audit_log (actor, role, action, target, detail) VALUES ('scheduler','system','incident.reminder',$1,$2)`, [String(a.id), JSON.stringify({ level, repeat: !!repeat, business, severity: a.severity, elapsed_min: elapsedMin, recipients: out.recipients, management: out.management, channels: out.channels, mail_ok: ok })]).catch(() => {});
  return { recipients: out.recipients, management: out.management, channels: out.channels, mail_ok: ok, error: out.mail && out.mail.error };
}

/* preview: mail one level to a single address (the requester) using a real open alert of that side, or a sample */
async function preview({ business, level, to, alertId }) {
  const cfg = await getConfig(); const b = BUSINESSES.includes(business) ? business : 'mobile'; const seg = SEG_OF_BIZ[b]; const lv = [1, 2, 3].includes(Number(level)) ? Number(level) : 1;
  const now = new Date();
  let a = null;
  if (alertId) a = (await db.console.query(`SELECT a.*, r.runbook, r.description, r.trigger_codes, r.segment FROM alerts a LEFT JOIN alert_rules r ON r.key=a.rule_key WHERE a.id=$1`, [alertId])).rows[0];
  if (!a) a = (await openUnacked(now)).find(x => SEG.segOf(x) === seg) || null;
  if (!a) a = { id: 0, rule_key: seg === 'fixed' ? 'fixed_sample' : 'sample', name: `Sample ${SEG.SHORT[seg]} alert (preview)`, severity: 'P1', team: seg === 'fixed' ? 'Fixed Ops' : 'MVNO Ops', metric_key: 'sample_metric', operator: 'gt', threshold: 10, observed_value: 42, sample: 120, window_hours: 1,
    message: 'preview — no real incident', fired_at: now, last_seen_at: now, opened_wall: new Date(now - 31 * 60000), breach_count: 1, runbook: '1) Open the incident guide 2) Check the source dashboard 3) Ack and hand over if needed', segment: seg };
  const elapsed = Math.max(1, Math.round((now - new Date(a.opened_wall || a.fired_at)) / 60000));
  const L = cfg[b][a.severity] || cfg[b].P3;
  const el = Math.max(elapsed, lv === 1 ? L.r1 : lv === 2 ? L.r2 : L.r3);
  const notify = require('./notify');
  const m = await buildMail(a, { level: lv, repeat: false, elapsedMin: el, business: b, seg, cfg: cfg[b], siblings: [] });
  const r = await notify.sendHtml([{ email: to }], `[PREVIEW] ${m.subject}`, m.html, []);
  let mgmt = null;
  if (lv === 3) { const mm = await buildMail(a, { level: 3, repeat: false, elapsedMin: el, business: b, seg, cfg: cfg[b], siblings: [], forManagement: true }); mgmt = await notify.sendHtml([{ email: to }], `[PREVIEW] ${mm.subject}`, mm.html, []); }
  return { alert: { id: a.id, name: a.name, severity: a.severity }, level: lv, to, mail: r, management_mail: mgmt };
}

async function history({ segment, limit = 50 } = {}) {
  const b = segment === 'fixed' ? 'fixed' : segment === 'mvno' ? 'mobile' : null;
  return (await db.console.query(`SELECT r.*, a.name, a.ack_by, a.ack_at, a.status FROM alert_reminders r LEFT JOIN alerts a ON a.id=r.alert_id ${b ? 'WHERE r.business=$2' : ''} ORDER BY r.sent_at DESC LIMIT $1`, b ? [limit, b] : [limit])).rows;
}

let timer = null;
function start() {
  if (timer) clearInterval(timer);
  ensureSchema().then(() => {
    timer = setInterval(() => { tick().catch(e => console.error('[ACK-SLA] tick failed:', e.message)); }, TICK_MS);
    setTimeout(() => tick().catch(() => {}), 20000);
    console.log('[ACK-SLA] acknowledgement-SLA reminder scheduler armed (60 s)');
  }).catch(e => console.error('[ACK-SLA] schema:', e.message));
  return { armed: true };
}

module.exports = { getConfig, setConfig, ensureSchema, tick, status, preview, history, start, dueLevel, nextDue, DEFAULTS, DEFAULT_LADDER, LEVEL, PRIORITIES, BUSINESSES };
