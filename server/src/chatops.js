/* ChatOps — push incidents to Slack and/or Microsoft Teams via Incoming Webhooks.
 *
 * Config lives in console_settings under key 'chatops':
 *   { enabled, slackUrl, teamsUrl, minSeverity, baseUrl, fixed: { teamsUrl, slackUrl, waTo, smsTo } }
 *   - slackUrl / teamsUrl : Incoming-Webhook URLs (either, both, or neither) — the MOBILE (MVNO) channels
 *   - fixed.*             : the FIXED business channels — its own Teams / Slack webhooks and its own WhatsApp
 *                           and SMS recipients. Same logic, same payloads, strictly separate destinations:
 *                           a Fixed alert (segment.js segOf() → 'fixed') goes ONLY to fixed.*, a Mobile alert
 *                           ONLY to the top-level channels; neither side ever falls back to the other.
 *                           The WhatsApp sender (phone-number id, token, template, relay) and the SMS provider
 *                           are shared — one business number, two recipient lists.
 *   - minSeverity         : 'P1' | 'P2' | 'P3'  (only notify at/above this)
 *   - baseUrl             : console URL used to build deep links to an incident
 *                           (Mobile → #alerts?incident=…, Fixed → #fixed-alerts?incident=…)
 *
 * No external deps: uses Node 18+ global fetch. Dev (no webhook URL): logs + returns
 * a preview so the Test button can show what *would* be posted.
 */
const settings = require('./settings');
const { segOf, SHORT } = require('./segment');

const SEV_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };
const SEV_COLOR = { P1: '#dc2626', P2: '#d97706', P3: '#2563eb', P4: '#64748b' };
const SEV_EMOJI = { P1: '🔴', P2: '🟠', P3: '🔵', P4: '⚪' };

const sms = require('./sms');
const DEFAULTS = { enabled: false, slackUrl: '', teamsUrl: '', minSeverity: 'P2', baseUrl: '',
  // WhatsApp via Meta Cloud API — 1:1 fan-out to on-call numbers (groups aren't supported by the
  // standard API). waTo = comma/space-separated recipients (E.164, no '+'). For business-initiated
  // (proactive) alerts, set waTemplate to an APPROVED template name; else free text (24h session only).
  waPhoneId: '', waToken: '', waTo: '', waTemplate: '', waTemplateLang: 'en', waApiVersion: 'v21.0',
  // waBaseUrl: where the Cloud API is reached. Default = Meta directly. 152 has no internet, so
  // in production this points at the RELAY on the reverse proxy (115), which forwards the exact
  // same paths to graph.facebook.com — e.g. http://172.31.38.115/warelay. Env WA_BASE_URL wins
  // over the stored setting so ops can repoint without a UI change.
  waBaseUrl: '',
  waGroupId: '',   // legacy (unused) — groups aren't supported by the Cloud API
  // SMS via Unifonic — creds in ENV; here only the toggle, recipients, and severity gate (P1 by default)
  smsEnabled: false, smsTo: '', smsMinSeverity: 'P1',
  // FIXED business channels (see header). Empty = the Fixed side has no channel of that kind.
  fixed: { teamsUrl: '', slackUrl: '', waTo: '', smsTo: '' } };
const FIXED_KEYS = Object.keys(DEFAULTS.fixed);

async function getConfig() {
  const c = (await settings.getSetting('chatops')) || {};
  return { ...DEFAULTS, ...c, fixed: { ...DEFAULTS.fixed, ...((c && c.fixed) || {}) } };
}
async function setConfig(patch) {
  const cur = await getConfig();
  const next = { ...cur, ...(patch || {}) };
  // fixed.* is merged key by key (strings only) so a partial form never wipes the other fields
  next.fixed = { ...cur.fixed };
  if (patch && patch.fixed && typeof patch.fixed === 'object') for (const k of FIXED_KEYS) if (k in patch.fixed) next.fixed[k] = String(patch.fixed[k] == null ? '' : patch.fixed[k]).trim();
  // an empty waToken means "keep the stored one" (so saving the form doesn't wipe the secret)
  if (patch && patch.waToken === '') next.waToken = cur.waToken;
  // never persist junk; clamp minSeverity
  if (!SEV_RANK[next.minSeverity]) next.minSeverity = 'P2';
  if (!SEV_RANK[next.smsMinSeverity]) next.smsMinSeverity = 'P1';
  if (!next.waApiVersion) next.waApiVersion = 'v21.0';
  await settings.setSetting('chatops', next);
  return next;
}

function esc(s) { return String(s == null ? '' : s); }
function fmtVal(v, unit) {
  if (v == null) return '—';
  v = Number(v);
  return (unit === 'rate' || unit === 'ratio') ? (v * 100).toFixed(1) + '%' : (Number.isInteger(v) ? v : v.toFixed(2));
}
const OP = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };

// Build a deep link to the incident (falls back to the alerts board of the alert's business).
function incidentLink(baseUrl, alert) {
  const b = (baseUrl || '').replace(/\/+$/, '');
  if (!b) return null;
  // ?id= is the deep link the alert view understands (same as the mail): scroll to the incident, open its guide
  const board = segOf(alert) === 'fixed' ? 'fixed-alerts' : 'alerts';
  return alert && alert.id ? `${b}/#${board}?id=${alert.id}` : `${b}/#${board}`;
}
// The destinations for one alert: Fixed alerts → cfg.fixed.*, everything else → the Mobile (top-level) channels.
function channelsFor(cfg, seg) {
  const f = (cfg && cfg.fixed) || {};
  return seg === 'fixed'
    ? { teamsUrl: f.teamsUrl || '', slackUrl: f.slackUrl || '', waTo: f.waTo || '', smsTo: f.smsTo || '', label: SHORT.fixed }
    : { teamsUrl: cfg.teamsUrl || '', slackUrl: cfg.slackUrl || '', waTo: cfg.waTo || '', smsTo: cfg.smsTo || '', label: SHORT.mvno };
}
const bizTag = alert => SHORT[segOf(alert)] || 'Mobile';

/* ---- payload builders (kept pure + exported so tests can assert them) ---- */
function slackPayload(alert, { baseUrl, kind = 'opened', mention } = {}) {
  const sev = alert.severity || 'P3';
  const link = incidentLink(baseUrl, alert);
  const title = `${SEV_EMOJI[sev] || ''} ${sev} · ${bizTag(alert)} · ${esc(alert.name)}`;
  const detail = `*${esc(alert.metric_key)}* ${OP[alert.operator] || alert.operator} ${fmtVal(alert.threshold, alert.unit)}` +
    ` — observed *${fmtVal(alert.observed_value, alert.unit)}* (n=${alert.sample ?? '—'}, ${alert.window_hours ?? '—'}h)`;
  const ctx = [`Business: ${bizTag(alert)}`];
  if (alert.team) ctx.push(`Team: ${esc(alert.team)}`);
  if (kind === 'escalated' && alert.escTierLabel) ctx.push(`Escalated to: ${esc(alert.escTierLabel)}`);
  if (mention) ctx.push(mention);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: title.slice(0, 150), emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: detail } }
  ];
  if (ctx.length) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: ctx.join('  ·  ') }] });
  if (link) blocks.push({ type: 'actions', elements: [
    { type: 'button', text: { type: 'plain_text', text: 'Open incident' }, url: link, style: sev === 'P1' ? 'danger' : 'primary' }
  ] });
  const kindWord = kind === 'escalated' ? 'escalated' : kind === 'test' ? 'test' : 'firing';
  return { text: `[${sev}] [${bizTag(alert)}] ${esc(alert.name)} ${kindWord}`, blocks,
    attachments: [{ color: SEV_COLOR[sev] || '#64748b', blocks: [] }] };
}

// Adaptive-Card colour by severity (AdaptiveCard enum: Good/Warning/Attention/Accent/Default)
const SEV_AC = { P1: 'Attention', P2: 'Warning', P3: 'Accent', P4: 'Default' };

/* Microsoft retired the O365 "Incoming Webhook" connector (May 2026); the replacement is a
 * Power Automate / Teams **Workflow** webhook. That endpoint accepts an Adaptive Card ONLY when
 * wrapped in a Bot-Framework envelope: { type:"message", attachments:[{ contentType:
 * "application/vnd.microsoft.card.adaptive", content:<card> }] }. A bare MessageCard returns
 * HTTP 202/200 but silently renders nothing — which is why posts "succeeded" yet never appeared. */
function teamsPayload(alert, { baseUrl, kind = 'opened', mention } = {}) {
  const sev = alert.severity || 'P3';
  const link = incidentLink(baseUrl, alert);
  const facts = [
    { title: 'Severity', value: sev },
    { title: 'Business', value: bizTag(alert) },
    { title: 'Metric', value: `${esc(alert.metric_key)} ${OP[alert.operator] || alert.operator} ${fmtVal(alert.threshold, alert.unit)}` },
    { title: 'Observed', value: `${fmtVal(alert.observed_value, alert.unit)} (n=${alert.sample ?? '—'}, ${alert.window_hours ?? '—'}h)` }
  ];
  if (alert.team) facts.push({ title: 'Team', value: esc(alert.team) });
  if (kind === 'escalated' && alert.escTierLabel) facts.push({ title: 'Escalated to', value: esc(alert.escTierLabel) });
  if (mention) facts.push({ title: 'On-call', value: esc(mention) });
  const body = [
    { type: 'TextBlock', size: 'Large', weight: 'Bolder', color: SEV_AC[sev] || 'Default',
      text: `${SEV_EMOJI[sev] || ''} ${sev} · ${bizTag(alert)} · ${esc(alert.name)}`, wrap: true },
    { type: 'FactSet', facts }
  ];
  if (alert.message && alert.message !== alert.name) body.splice(1, 0, { type: 'TextBlock', text: esc(alert.message), wrap: true, spacing: 'None' });
  const card = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard', version: '1.4', body,
    msteams: { width: 'Full' }
  };
  if (link) card.actions = [{ type: 'Action.OpenUrl', title: 'Open incident', url: link }];
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }] };
}

// WhatsApp has no rich cards — build a compact plain-text body.
function whatsappText(alert, { baseUrl, kind = 'opened', mention } = {}) {
  const sev = alert.severity || 'P3';
  const lines = [];
  const head = kind === 'escalated' ? 'ESCALATED' : kind === 'test' ? 'TEST' : 'INCIDENT';
  lines.push(`${SEV_EMOJI[sev] || ''} *${head} · ${sev} · ${bizTag(alert)}* — ${esc(alert.name)}`);
  lines.push(`${esc(alert.metric_key)} ${OP[alert.operator] || alert.operator} ${fmtVal(alert.threshold, alert.unit)}` +
    `  →  observed *${fmtVal(alert.observed_value, alert.unit)}* (n=${alert.sample ?? '—'}, ${alert.window_hours ?? '—'}h)`);
  if (alert.team) lines.push(`Team: ${esc(alert.team)}`);
  if (kind === 'escalated' && alert.escTierLabel) lines.push(`Escalated to: ${esc(alert.escTierLabel)}`);
  if (mention) lines.push(`On-call: ${esc(mention)}`);
  const link = incidentLink(baseUrl, alert);
  if (link) lines.push(link);
  return lines.join('\n');
}
// Body variables for the approved template (order must match the template you submit to Meta):
//   {{1}} severity · {{2}} incident name · {{3}} observed value · {{4}} owning team · {{5}} link
function waTemplateParams(alert, opts) {
  const sev = alert.severity || 'P?';
  const name = String(alert.name || alert.metric_key || 'incident').replace(/\s+/g, ' ').trim();
  const observed = alert.observed_value != null
    ? fmtVal(alert.observed_value, alert.unit) + (alert.sample != null ? ` (n=${alert.sample})` : '')
    : '—';
  const team = alert.team || (segOf(alert) === 'fixed' ? 'Fixed Ops' : 'Digital Ops');
  const link = incidentLink(opts && opts.baseUrl, alert) || 'console';
  // template params must be single-line and non-empty
  return [sev, name, observed, team, link].map(t => (String(t).replace(/[\r\n]+/g, ' ').trim() || '—'));
}
// 1:1 message to one recipient. Uses the approved template when configured (required for proactive
// business-initiated sends); otherwise plain text (only delivers inside a 24h customer-initiated window).
function whatsappPayload(alert, opts, to, cfg) {
  cfg = cfg || {};
  if (cfg.waTemplate) {
    return { messaging_product: 'whatsapp', to, type: 'template',
      template: { name: cfg.waTemplate, language: { code: cfg.waTemplateLang || 'en' },
        components: [{ type: 'body', parameters: waTemplateParams(alert, opts).map(text => ({ type: 'text', text })) }] } };
  }
  return { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: whatsappText(alert, opts) } };
}

async function postJson(url, body, headers) {
  if (typeof fetch !== 'function') throw new Error('global fetch unavailable (needs Node 18+)');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return { ok: true, status: res.status };
}

/* Notify all configured channels about one alert.
 * opts: { kind: 'opened'|'escalated'|'test', mention, cfg? } — cfg lets callers pass a
 * preloaded config (and tests inject a fake). Returns per-channel results + previews. */
async function notifyIncident(alert, opts = {}) {
  const cfg = opts.cfg || await getConfig();
  const kind = opts.kind || 'opened';
  // Which business owns this alert decides the destinations — never mixed (see header).
  const seg = segOf(alert);
  const ch = channelsFor(cfg, seg);
  const out = { skipped: false, segment: seg, business: ch.label, channels: [], slackPreview: null, teamsPreview: null };

  const popts = { baseUrl: cfg.baseUrl, kind, mention: opts.mention };
  const slack = slackPayload(alert, popts);
  const teams = teamsPayload(alert, popts);
  out.slackPreview = slack; out.teamsPreview = teams;
  const waRecipients = String(ch.waTo || '').split(/[,\s]+/).map(s => s.trim().replace(/^\+/, '')).filter(Boolean);
  if (cfg.waPhoneId && waRecipients.length) out.whatsappPreview = whatsappText(alert, popts);

  // Master switch: when off, dispatch NOTHING — this applies to tests too, so a test mirrors real
  // behaviour (no surprise sends to channels you've turned off). Previews above are still returned
  // so you can inspect message formatting without sending.
  if (!cfg.enabled) { out.skipped = 'chatops disabled'; return out; }
  // policy-driven escalations (force) and tests bypass the minSeverity gate
  if (kind !== 'test' && !opts.force) {
    const need = SEV_RANK[cfg.minSeverity] || 2;
    if ((SEV_RANK[alert.severity] || 9) > need) { out.skipped = `below minSeverity (${cfg.minSeverity})`; return out; }
  }

  for (const [name, url, body] of [['slack', ch.slackUrl, slack], ['teams', ch.teamsUrl, teams]]) {
    if (!url) continue;
    try { await postJson(url, body); out.channels.push({ name, sent: true }); }
    catch (e) { out.channels.push({ name, sent: false, error: e.message }); }
  }
  // WhatsApp via Meta Cloud API — 1:1 fan-out to each on-call number (groups aren't supported by the API).
  const waReady = cfg.waPhoneId && cfg.waToken && waRecipients.length > 0;
  if (waReady) {
    const waBase = (process.env.WA_BASE_URL || cfg.waBaseUrl || 'https://graph.facebook.com').replace(/\/+$/, '');
    const url = `${waBase}/${cfg.waApiVersion || 'v21.0'}/${cfg.waPhoneId}/messages`;
    let sent = 0, failed = 0, lastErr = null;
    for (const to of waRecipients) {
      try { await postJson(url, whatsappPayload(alert, popts, to, cfg), { Authorization: `Bearer ${cfg.waToken}` }); sent++; }
      catch (e) { failed++; lastErr = e.message; }
    }
    out.channels.push({ name: 'whatsapp', sent: sent > 0, count: sent, recipients: waRecipients.length,
      ...(failed ? { failed, error: lastErr } : {}), ...(cfg.waTemplate ? {} : { note: 'free-text (no template) — delivers only within a 24h session' }) });
  }
  // SMS via Unifonic — high-severity only (smsMinSeverity, default P1), to the on-call number(s)
  const smsGate = kind === 'test' || (SEV_RANK[alert.severity] || 9) <= (SEV_RANK[cfg.smsMinSeverity] || 1);
  if (cfg.smsEnabled && smsGate) {
    // Fixed uses its own SMS recipients (no env fallback — an empty Fixed list means "no SMS for Fixed")
    const smsTo = seg === 'fixed' ? ch.smsTo : (ch.smsTo || process.env.SMS_TO);
    if (sms.smsConfigured() && smsTo) {
      const link = incidentLink(cfg.baseUrl, alert);
      const txt = `[${alert.severity}] [${ch.label}] ${esc(alert.name)}` + (alert.observed_value != null ? ` — ${fmtVal(alert.observed_value, alert.unit)}` : '') + (link ? ` ${link}` : '');
      try { const rs = await sms.sendSms(txt, { to: smsTo }); out.channels.push({ name: 'sms', sent: rs.sent, ...(rs.reason ? { reason: rs.reason } : {}), ...(rs.results ? { detail: rs.results } : {}) }); }
      catch (e) { out.channels.push({ name: 'sms', sent: false, error: e.message }); }
    } else { out.channels.push({ name: 'sms', sent: false, reason: `SMS creds (env) or ${ch.label} recipients missing` }); }
  }
  if (!ch.slackUrl && !ch.teamsUrl && !waReady && !(cfg.smsEnabled && smsGate)) { out.dev = true; out.note = `no ${ch.label} channel configured`; console.log(`[CHATOPS] (dev/no-channel · ${ch.label}) ${kind}: [${alert.severity}] ${alert.name}`); }
  return out;
}

module.exports = { getConfig, setConfig, notifyIncident, slackPayload, teamsPayload, whatsappText, whatsappPayload, incidentLink, channelsFor, DEFAULTS, SEV_RANK };
