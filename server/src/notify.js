/* Alert email notifications — mirrors the dealers ops console digest.
 * Recipients = console_users with mail_alert=true (managed in User management).
 * SMTP reuses the same env as OTP (SMTP_HOST/PORT/SECURE/USER/PASS/FROM).
 * Dev (no SMTP): logs + returns the rendered HTML so it can be previewed in the UI. */
const db = require('./db');

const smtpConfigured = () => !!process.env.SMTP_HOST;   // auth is optional (local relays / Mailpit need none)

/* Circuit breaker: if the relay rejects us (e.g. 554 Access denied because this host is not
 * whitelisted), retrying every sync tick just floods the log with identical errors forever and
 * delays each alert run. Open the circuit after N consecutive failures, retry occasionally, and
 * log ONCE per state change instead of every attempt. */
const MAIL_FAIL_OPEN_AFTER = Number(process.env.MAIL_FAIL_OPEN_AFTER || 3);
const MAIL_RETRY_MIN = Number(process.env.MAIL_RETRY_MIN || 30);
const mailCb = { fails: 0, openedAt: 0, lastErr: null };
function mailBlocked() {
  if (mailCb.fails < MAIL_FAIL_OPEN_AFTER) return false;
  const dueIn = MAIL_RETRY_MIN * 60000 - (Date.now() - mailCb.openedAt);
  if (dueIn <= 0) { mailCb.openedAt = Date.now(); return false; }   // let one probe through
  return true;
}
function mailOk() {
  if (mailCb.fails >= MAIL_FAIL_OPEN_AFTER) console.log('[MAIL] recovered — sending again');
  mailCb.fails = 0; mailCb.lastErr = null;
}
function mailFail(msg) {
  mailCb.fails++; mailCb.lastErr = msg;
  if (mailCb.fails === MAIL_FAIL_OPEN_AFTER) {
    mailCb.openedAt = Date.now();
    console.error(`[MAIL] send failed ${mailCb.fails}x — pausing email for ${MAIL_RETRY_MIN}m. Last error: ${msg}`);
    console.error('[MAIL] fix: whitelist this host on the SMTP relay, or set a permitted SMTP_FROM.');
  } else if (mailCb.fails < MAIL_FAIL_OPEN_AFTER) {
    console.error('[MAIL] send failed:', msg);
  }
}
function mailStatus() { return { failures: mailCb.fails, paused: mailBlocked(), lastError: mailCb.lastErr }; }
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const opLabel = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };

function ksa(iso) {
  try {
    return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .replace(',', '');
  } catch (e) { return String(iso); }
}
function fmtVal(v, unit) {
  if (v == null) return '—';
  v = Number(v);
  return (unit === 'rate' || unit === 'ratio') ? (v * 100).toFixed(1) + '%' : (Number.isInteger(v) ? v : v.toFixed(2));
}

// recipients opted into a given channel: 'mail_alert' (alerts) or 'mail_report' (reports)
// seg (optional) = 'mvno' | 'fixed' → only users whose BUSINESS covers that side (console_users.business: mobile | fixed | both).
// A Fixed-team user never receives a Mobile alert mail and vice versa; 'both' receives both mails.
async function recipients(column = 'mail_alert', seg) {
  const col = column === 'mail_report' ? 'mail_report' : 'mail_alert';
  const SEG = require('./segment');
  const biz = seg && SEG.BUSINESS_OF[seg] ? SEG.BUSINESS_OF[seg] : null;
  try {
    const r = await db.console.query(
      `SELECT email, name, business FROM console_users WHERE enabled=true AND ${col}=true${biz ? ` AND (business = $1 OR business = 'both' OR business IS NULL)` : ''} ORDER BY email`,
      biz ? [biz] : []);
    return r.rows;
  } catch (e) { return []; }
}

// generic sender — returns {sent, dev, error, recipients}. Dev (no SMTP) logs + does not send.
// `attachments` (optional) is passed straight to nodemailer: [{filename, content, contentType}].
async function sendHtml(to, subject, html, attachments, text) {
  const emails = (to || []).map(r => (typeof r === 'string' ? r : r.email));
  const base = { recipients: emails, subject };
  if (!emails.length) return { ...base, sent: false, reason: 'no recipients' };
  if (!smtpConfigured()) { console.log(`[MAIL] (dev/no-SMTP) would email ${emails.length}: ${subject}`); return { ...base, sent: false, dev: true }; }
  if (mailBlocked()) return { ...base, sent: false, error: 'email paused after repeated failures: ' + mailCb.lastErr, paused: true };
  try {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      // same internal-relay TLS knobs as otp.js (self-signed cert / no STARTTLS)
      ignoreTLS: process.env.SMTP_IGNORE_TLS === 'true',
      tls: process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false } : undefined,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
    const withLogo = [brand.attachment(), ...(attachments || [])];   // CID logo for the shell header
    /* BULK PRIVACY (8 Sep 2026): recipients of a digest / report / healthcheck do not know each other, so a
     * multi-recipient mail never lists them in To. MAIL_BULK_MODE=bcc (default): ONE message, To = the sender
     * address, everyone in Bcc. MAIL_BULK_MODE=individual: one personal message per recipient (N sends).
     * Single-recipient mails (OTP, ticket updates) are unchanged. */
    const mode = (process.env.MAIL_BULK_MODE || 'bcc').toLowerCase();
    const msg = { from: fromAddress(), subject, html, ...(text ? { text } : {}), attachments: withLogo };
    if (emails.length <= 1) await t.sendMail({ ...msg, to: emails[0] });
    else if (mode === 'individual') { for (const e of emails) await t.sendMail({ ...msg, to: e }); }
    else await t.sendMail({ ...msg, to: fromAddress(), bcc: emails.join(',') });
    mailOk();
    return { ...base, sent: true, bulk: emails.length > 1 ? mode : null };
  } catch (e) { mailFail(e.message); return { ...base, sent: false, error: e.message }; }
}

// shared branded email shell — the SAME template as the Undertaking Consent System mails (7 Sep 2026):
// table layout for mail clients, #0b3d2b header with the logo attached as a CID image (renders without
// "load images"), a system badge + optional status pill, white body, quiet footer. Every mail the console
// sends goes through it: OTP, sync health, alert digests, tickets. Keep it table-based — Outlook.
const brand = require('./mailBrand');
const SYSTEM_BADGE = process.env.MAIL_SYSTEM_BADGE || 'OPERATIONS CONSOLE';
const FOOTER = process.env.MAIL_FOOTER || '— Salam Operations Console · automated message';
/* The display name is enforced in code: /apps/unified/.env started life as a copy of the digital console's, so
   SMTP_FROM there says "Salam Digital Console". We keep the ADDRESS (the relay whitelists it) and put our own name
   on it — MAIL_FROM_NAME overrides. */
const FROM_NAME = process.env.MAIL_FROM_NAME || 'Salam Operations Console';
function fromAddress() {
  const raw = process.env.SMTP_FROM || 'noreply@salam.sa';
  const m = /<([^>]+)>/.exec(raw); const addr = (m ? m[1] : raw).trim();
  return `${FROM_NAME} <${addr}>`;
}
function shell({ title, pill, pillColor, bodyHtml, badge }) {
  const statusPill = pill ? `<span style="display:inline-block;background:${pillColor || '#1e5c44'};color:#ffffff;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;border-radius:6px;padding:3px 10px;margin-left:6px;">${esc(String(pill).toUpperCase())}</span>` : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>:root{color-scheme:light only} body{background:#f2f4f3 !important}</style></head><body bgcolor="#f2f4f3" style="margin:0;padding:0;background:#f2f4f3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f2f4f3" style="background:#f2f4f3;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:94%;">
  <tr><td bgcolor="#0b3d2b" style="background:#0b3d2b;border-radius:12px 12px 0 0;padding:28px 32px;">
    <img src="cid:${brand.CID}" alt="salam" height="44" style="display:block;height:44px;width:auto;border:0;">
    <div style="color:#ffffff;font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:19px;font-weight:700;padding-top:14px;">
      ${esc(title)}
    </div>
    <div style="padding-top:8px;">
      <span style="display:inline-block;background:#1e5c44;color:#c9f3de;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;border-radius:6px;padding:3px 10px;">${esc(badge || SYSTEM_BADGE)}</span>${statusPill}
    </div>
  </td></tr>
  <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e3e7e5;border-top:0;padding:26px 32px;font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.65;color:#20302a;">
    ${bodyHtml}
  </td></tr>
  <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e3e7e5;border-top:0;border-radius:0 0 12px 12px;padding:14px 32px 20px;font-family:Arial,sans-serif;font-size:11px;color:#8a978f;">
    ${esc(FOOTER)}
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
// plain text → the shell body (escaped, URLs linked, newlines kept) — for short transactional mails such as the OTP
function textToHtml(text) {
  return esc(String(text || '')).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0b7a4b;text-decoration:underline;">$1</a>').replace(/\n/g, '<br>');
}
async function sendText(to, subject, text, opts = {}) {
  const title = opts.title || String(subject).replace(/^Salam Operations Console\s*—\s*/i, '');
  return sendHtml(to, subject, shell({ title, pill: opts.pill, pillColor: opts.pillColor, badge: opts.badge, bodyHtml: textToHtml(text) }), [], text);
}

const CONSOLE_URL = process.env.CONSOLE_PUBLIC_URL || process.env.CONSOLE_BASE_URL || 'https://salam.sa/unified-console/';

const FL = require('./fixedLinks');
/* per-row destinations: Mobile rows → #alerts (incident or rule), Fixed rows → Fixed › Alerts plus the
 * rule's own "Inspect" deep link (map pre-filtered / error board) — the link the retired
 * Operations Console mailed, on the unified routes */
function segChip(e) {
  return FL.isFixed(e)
    ? '<span style="display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.3px;padding:1px 6px;border-radius:999px;background:#e6f4ec;color:#0b3d2b;margin-right:5px;vertical-align:1px">🏠 FIXED</span>'
    : '<span style="display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.3px;padding:1px 6px;border-radius:999px;background:#f1e9fe;color:#5b21b6;margin-right:5px;vertical-align:1px">📱 MOBILE</span>';
}
function openUrl(e, idByKey) {
  // Fixed rows open the Fixed incident view (#fixed-alerts — ack / snooze / guide, 8 Sep 2026), Mobile rows the Mobile one
  const board = FL.isFixed(e) ? 'fixed-alerts' : 'alerts';
  return `${CONSOLE_URL}#${board}${e.fired && idByKey[e.key] ? `?id=${idByKey[e.key]}` : `?rule=${encodeURIComponent(e.key)}`}`;
}
function inspectHtml(e, style) {
  const i = e.fired && FL.isFixed(e) ? FL.inspect(e.key) : null;
  return i ? `<a href="${i.url}" style="${style}">${esc(i.label)} ›</a>` : '';
}

function buildDigest(simNow, evals, reportNames = [], idByKey = {}, seg) {
  const SEG = require('./segment');
  const segLabel = seg ? SEG.LABEL[seg] : null;            // 'Mobile (MVNO)' | 'Fixed' — one mail per business
  const firing = evals.filter(e => e.fired);
  const th = 'padding:9px 12px;text-align:left;font-size:12px;color:#334155;background:#eef4f0;border-bottom:1px solid #dbe6df';
  const td = 'padding:10px 12px;font-size:13px;border-bottom:1px solid #eef2f6;vertical-align:top';
  const rows = evals.map(e => {
    const status = e.fired
      ? '<span style="color:#dc2626;font-weight:800">● FIRED</span>'
      : '<span style="color:#16a34a;font-weight:700">✓ ok</span>';
    const rowBg = e.fired ? 'background:#fdecec' : '';
    const thr = `${opLabel[e.operator] || e.operator} ${fmtVal(e.threshold, e.unit)}`
      + (e.min_sample ? ` · n≥${e.min_sample}` : '') + (e.active ? ` · ${e.active}` : '');
    return `<tr style="${rowBg}">
      <td style="${td}">${status}<div style="color:#94a3b8;font-size:11px;margin-top:2px">${esc(e.team || '')}</div></td>
      <td style="${td}">${segChip(e)}<b style="color:#0f172a">${esc(e.severity)} ${esc(e.name)}</b><div style="color:#94a3b8;font-size:11px;margin-top:2px">${esc(e.metric_key)}</div></td>
      <td style="${td};white-space:nowrap">${e.value == null ? '—' : fmtVal(e.value, e.unit)}${e.sample != null ? `<div style="color:#94a3b8;font-size:11px">sample ${e.sample}</div>` : ''}</td>
      <td style="${td};white-space:nowrap;color:#475569">${esc(thr)}</td>
      <td style="${td};color:#475569">${esc(e.counts || '')}</td>
      <td style="${td};white-space:nowrap"><a href="${openUrl(e, idByKey)}" style="color:#0e9f5a;font-weight:700;text-decoration:none">Open ›</a>${inspectHtml(e, 'display:block;margin-top:4px;color:#0e9f5a;font-weight:700;text-decoration:none;font-size:12px')}</td>
    </tr>`;
  }).join('');
  /* INTRO — the resume a reader needs before the table: what fired, how bad, where the detail
   * is. One line per firing alert (observed vs threshold + its attached report), or an all-clear. */
  const sevCount = {};
  firing.forEach(e => sevCount[e.severity] = (sevCount[e.severity] || 0) + 1);
  const sevLine = Object.entries(sevCount).sort().map(([s, n]) => `${n}× ${s}`).join(' · ');
  const intro = firing.length ? `
    <div style="background:#fdf6ec;border:1px solid #f3d9a4;border-left:4px solid #d97706;border-radius:8px;padding:12px 16px;margin-bottom:16px">
      <div style="font-weight:800;color:#7c2d12;font-size:13px;margin-bottom:6px">In short — ${firing.length} alert(s) need attention (${sevLine}), out of ${evals.length} rules evaluated.</div>
      ${firing.map((e, i) => `<div style="font-size:12.5px;color:#334155;margin:3px 0">
        ${segChip(e)}<b>${esc(e.severity)}</b> · <a href="${openUrl(e, idByKey)}" style="color:#0f172a;font-weight:700">${esc(e.name)}</a>${e.simulated ? ' <span style="color:#7c3aed;font-weight:800">(SIMULATED — test mail)</span>' : ''} — observed <b>${fmtVal(e.value, e.unit)}</b> vs threshold ${opLabel[e.operator] || e.operator} ${fmtVal(e.threshold, e.unit)} (sample ${e.sample ?? '—'}, ${e.window_hours}h)${reportNames[i] ? ` · full report attached: <span style="font-family:monospace;font-size:11px">${esc(reportNames[i])}</span>` : ''}${FL.isFixed(e) && FL.inspect(e.key) ? ` · inspect: ${inspectHtml(e, 'color:#0e9f5a;font-weight:700')}` : ''}
      </div>`).join('')}
      <div style="font-size:12px;color:#64748b;margin-top:8px">Each attached PDF carries the KPIs, the APIs and request/response evidence, the alert history and the step-by-step L1 action plan — read it before escalating.</div>
    </div>` : `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#14532d">
      <b>All clear.</b> ${evals.length} rules evaluated — nothing firing. No action needed.
    </div>`;
  const body = `${intro}
    <div style="color:#64748b;font-size:12px;margin-bottom:12px">At: ${ksa(simNow)} KSA · every row links to the console → ${seg === 'fixed' ? `<a href="${FL.alertsUrl()}" style="color:#0e9f5a">Fixed › Alerts</a> — acknowledge / history / rules; each row also carries an <b>Inspect</b> link to the map or the error board` : seg === 'mvno' ? `<a href="${CONSOLE_URL}#alerts" style="color:#0e9f5a">Mobile › Alerts</a> — acknowledge / history / rules` : `<a href="${CONSOLE_URL}#alerts" style="color:#0e9f5a">Alerts</a> (Mobile) · <a href="${FL.alertsUrl()}" style="color:#0e9f5a">Fixed › Alerts</a>`}</div>
    <table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #dbe6df">
      <tr><th style="${th}">Status</th><th style="${th}">Rule</th><th style="${th}">Metric</th><th style="${th}">Threshold</th><th style="${th}">Counts</th><th style="${th}">Details</th></tr>
      ${rows}
    </table>
    <div style="color:#94a3b8;font-size:12px;margin-top:14px">— Salam Operations Console · automated alert runner · reports attached per firing alert</div>`;
  const html = shell({ title: segLabel ? `${segLabel} alerts — Operations Console` : 'Alerts — Operations Console',
    badge: segLabel ? `OPERATIONS CONSOLE · ${SEG.SHORT[seg].toUpperCase()}` : undefined,
    pill: firing.length ? `${firing.length} FIRING` : 'ALL CLEAR',
    pillColor: firing.length ? '#dc2626' : '#16a34a', bodyHtml: body });
  const subject = `[Salam Ops${seg ? ' · ' + SEG.SHORT[seg] : ''}] ${firing.length} alert(s) — ${ksa(simNow)} KSA`;
  return { html, subject, firing: firing.length, total: evals.length, segment: seg || null };
}

/* ONE MAIL PER BUSINESS (8 Sep 2026). The evaluations are split by segment (segment.js: alert_rules.segment, fixed_*
 * prefix as fallback) and each side gets its own digest — its own subject ([Salam Ops · Fixed] / [Salam Ops · Mobile]),
 * its own PDFs, its own recipients: users with Mail alert ON whose business covers that side. A Fixed-team user never
 * sees a Mobile alert, a Mobile-team user never sees a Fixed one, 'both' receives the two mails. A side with nothing
 * firing sends nothing (no all-clear noise); the ALL CLEAR mail only exists on the test path. */
async function sendAlertDigest(simNow, evals, opts = {}) {
  const SEG = require('./segment');
  const testTo = opts.to ? (Array.isArray(opts.to) ? opts.to : [opts.to]).map(e => ({ email: String(e) })) : null;
  /* open-alert ids so every fired row/intro line deep-links to ITS incident (#alerts?id=N) */
  let idByKey = {};
  try {
    const r = await db.console.query(`SELECT rule_key, max(id) AS id FROM alerts WHERE status='open' GROUP BY 1`);
    r.rows.forEach(x => { idByKey[x.rule_key] = x.id; });
  } catch (e) { idByKey = {}; }
  const parts = [];
  for (const seg of SEG.SEGMENTS) {
    if (opts.segment && opts.segment !== seg) continue;                  // test path: only the side of the simulated rule
    const mine = evals.filter(e => SEG.segOf(e) === seg);
    if (!mine.length) continue;
    const firingN = mine.filter(e => e.fired).length;
    if (!firingN && !testTo) continue;                                   // live path: quiet side → no mail
    const to = testTo || await recipients('mail_alert', seg);
    /* per-alert PDF reports — best-effort and NEVER blocking: a broken report must not stop the
     * mail, and a storm is capped inside buildFiredReports. */
    let reports = { attachments: [], notes: [] };
    try { reports = await require('./alertReport').buildFiredReports(simNow, mine); }
    catch (e) { reports = { attachments: [], notes: ['report generation failed: ' + e.message] }; }
    let { html, subject, firing, total } = buildDigest(simNow, mine, reports.attachments.map(a => a.filename), idByKey, seg);
    if (testTo) subject = '[TEST] ' + subject;
    const r = to.length ? await sendHtml(to, subject, html, reports.attachments) : { sent: false, recipients: [] };
    parts.push({ segment: seg, label: SEG.LABEL[seg], firing, total, subject, recipients: r.recipients, sent: r.sent, dev: r.dev, error: r.error,
      reason: to.length ? undefined : `No recipients — no enabled user with "Mail alert" on and business = ${SEG.BUSINESS_OF[seg]} / both.`,
      previewHtml: html, attachments: reports.attachments.map(a => ({ filename: a.filename, bytes: a.content.length })), reportNotes: reports.notes });
  }
  /* summary in the shape the callers / Settings test button already read; previewHtml = the mails one after the other */
  const first = parts[0] || {};
  return { sent: parts.some(p => p.sent), dev: parts.some(p => p.dev), error: parts.map(p => p.error).filter(Boolean).join(' · ') || undefined,
    firing: parts.reduce((a, p) => a + p.firing, 0), total: evals.length, subject: parts.map(p => p.subject).join(' + ') || first.subject,
    recipients: [...new Set(parts.flatMap(p => p.recipients || []))], previewHtml: parts.map(p => p.previewHtml).join('<hr style="margin:32px 0;border:0;border-top:2px dashed #cbd5e1">'),
    attachments: parts.flatMap(p => p.attachments || []), reportNotes: parts.flatMap(p => p.reportNotes || []),
    reason: parts.length ? (parts.every(p => !p.sent) ? parts.map(p => p.reason || p.error).filter(Boolean).join(' · ') || undefined : undefined) : 'nothing firing on either side',
    mails: parts.map(({ previewHtml, ...p }) => p) };
}

/* ---- ACK HAND-OVER MAIL (8 Sep 2026) ----------------------------------------------------------------------------
 * When an acknowledgement changes hands the NEW holder gets one mail in the alert template, focused on that single
 * incident: who handed it over and why, observed vs threshold, breaches, the runbook steps, a deep link straight to
 * the incident on the right side (#alerts?id= / #fixed-alerts?id=) and the same PDF report the digest attaches.
 * The PREVIOUS holder gets a short notice (no PDF) so nobody keeps working an incident that is no longer theirs.
 * Best-effort: called after the DB change, never blocks the API. */
async function sendHandoverMail(alert, { from, to, by, note, kind } = {}) {
  const SEG = require('./segment');
  const seg = SEG.segOf(alert);
  const rule = (await db.console.query(`SELECT r.*, mc.unit FROM alert_rules r LEFT JOIN metric_catalog mc ON mc.key = r.metric_key WHERE r.key = $1`, [alert.rule_key]).catch(() => ({ rows: [] }))).rows[0] || {};
  const ev = { key: alert.rule_key, name: alert.name, severity: alert.severity, team: alert.team, metric_key: alert.metric_key, operator: alert.operator,
    threshold: alert.threshold, value: alert.observed_value, sample: alert.sample, window_hours: alert.window_hours, unit: rule.unit || 'count',
    segment: seg, fired: true, min_sample: rule.min_sample, description: rule.description, runbook: rule.runbook, trigger_codes: rule.trigger_codes };
  const now = new Date();
  let reports = { attachments: [], notes: [] };
  try { reports = await require('./alertReport').buildFiredReports(now, [ev], { max: 1 }); } catch (e) { reports = { attachments: [], notes: [e.message] }; }
  const link = `${CONSOLE_URL}#${seg === 'fixed' ? 'fixed-alerts' : 'alerts'}?id=${alert.id}`;
  const who = e => esc(String(e || '—').split('@')[0]);
  const steps = String(rule.runbook || '').split(/\n+|(?=\d\)\s)/).map(x => x.trim()).filter(Boolean);
  const detail = [
    ['Incident', `<b>${esc(alert.severity)} · ${esc(alert.name)}</b> ${segChip(ev)}`],
    ['Observed', `<b>${fmtVal(alert.observed_value, ev.unit)}</b> vs threshold ${opLabel[alert.operator] || alert.operator} ${fmtVal(alert.threshold, ev.unit)} (sample ${alert.sample ?? '—'}, ${alert.window_hours}h window)`],
    ['Fired', `${ksa(alert.fired_at)} KSA · last seen ${ksa(alert.last_seen_at)} KSA · ${alert.breach_count || 1} breach(es)`],
    ['Team', esc(alert.team || '—')], ['Metric', `<span style="font-family:monospace;font-size:12px">${esc(alert.metric_key)}</span>`],
    ...(alert.message ? [['Message', esc(alert.message)]] : []),
    ...(rule.trigger_codes ? [['Trigger codes', esc(rule.trigger_codes)]] : []),
  ];
  const kv = detail.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#64748b;font-size:12px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;font-size:13px;color:#20302a">${v}</td></tr>`).join('');
  const intro = `
    <div style="background:#eaf6ff;border:1px solid #bfdcf5;border-left:4px solid #0891b2;border-radius:8px;padding:12px 16px;margin-bottom:16px">
      <div style="font-weight:800;color:#0c4a6e;font-size:13px;margin-bottom:4px">${kind === 'reack' ? `${who(to)} took over this incident` : `${who(by)} handed this incident to you`}${from ? ` — it was acknowledged by ${who(from)}` : ''}.</div>
      ${note ? `<div style="font-size:13px;color:#334155;margin:4px 0"><b>Note:</b> ${esc(note)}</div>` : ''}
      <div style="font-size:12.5px;color:#334155;margin-top:6px">You are now the acknowledged owner. Open the incident to see the guide, the discussion and to snooze / resolve: <a href="${link}" style="color:#0e9f5a;font-weight:700">Open incident ›</a>${FL.isFixed(ev) && FL.inspect(ev.key) ? ` · inspect: ${inspectHtml(ev, 'color:#0e9f5a;font-weight:700')}` : ''}</div>
    </div>`;
  const body = `${intro}
    <table style="border-collapse:collapse;width:100%;margin-bottom:14px">${kv}</table>
    ${steps.length ? `<div style="font-weight:800;font-size:12px;letter-spacing:.06em;color:#334155;margin:10px 0 6px">RUNBOOK</div><ol style="margin:0 0 12px 18px;padding:0;font-size:13px;color:#20302a;line-height:1.6">${steps.map(x => `<li>${esc(x.replace(/^\d+\)\s*/, ''))}</li>`).join('')}</ol>` : ''}
    ${reports.attachments.length ? `<div style="font-size:12px;color:#64748b">Full report attached: <span style="font-family:monospace;font-size:11px">${esc(reports.attachments[0].filename)}</span> — KPIs, API evidence, history and the L1 action plan.</div>` : ''}
    <div style="color:#94a3b8;font-size:12px;margin-top:14px">— Salam Operations Console · ${esc(SEG.LABEL[seg])} alerts · this change is recorded on the incident and in the audit trail</div>`;
  const html = shell({ title: `Incident handed to you — ${SEG.LABEL[seg]} alerts`, badge: `OPERATIONS CONSOLE · ${SEG.SHORT[seg].toUpperCase()}`,
    pill: `${alert.severity} · ACTION NEEDED`, pillColor: alert.severity === 'P1' ? '#dc2626' : alert.severity === 'P2' ? '#d97706' : '#64748b', bodyHtml: body });
  const subject = `[Salam Ops · ${SEG.SHORT[seg]}] ${alert.severity} handed to you — ${alert.name}`;
  const out = { to: null, previous: null };
  try { out.to = await sendHtml([{ email: to }], subject, html, reports.attachments); } catch (e) { out.to = { sent: false, error: e.message }; }
  if (from && from !== to && kind !== 'ack') {
    const noteHtml = shell({ title: `Incident no longer yours — ${SEG.LABEL[seg]} alerts`, badge: `OPERATIONS CONSOLE · ${SEG.SHORT[seg].toUpperCase()}`, pill: 'FYI', pillColor: '#64748b',
      bodyHtml: `<div style="font-size:13.5px;color:#20302a"><b>${esc(alert.severity)} · ${esc(alert.name)}</b> ${segChip(ev)}<br><br>${kind === 'reack' ? `${who(to)} took over the acknowledgement you held.` : `${who(by)} handed the acknowledgement you held to ${who(to)}.`}${note ? ` <b>Note:</b> ${esc(note)}` : ''}<br><br><a href="${link}" style="color:#0e9f5a;font-weight:700">Open incident ›</a></div>` });
    try { out.previous = await sendHtml([{ email: from }], `[Salam Ops · ${SEG.SHORT[seg]}] ${alert.severity} ${alert.name} — ack moved to ${String(to).split('@')[0]}`, noteHtml, []); } catch (e) { out.previous = { sent: false, error: e.message }; }
  }
  return out;
}

module.exports = { recipients, sendHtml, sendText, textToHtml, buildDigest, sendAlertDigest, sendHandoverMail, smtpConfigured, mailStatus, esc, shell, fromAddress };
