/* ChatOps — push incidents to Slack and/or Microsoft Teams via Incoming Webhooks.
 *
 * Config lives in console_settings under key 'chatops':
 *   { enabled, slackUrl, teamsUrl, minSeverity, baseUrl }
 *   - slackUrl / teamsUrl : Incoming-Webhook URLs (either, both, or neither)
 *   - minSeverity         : 'P1' | 'P2' | 'P3'  (only notify at/above this)
 *   - baseUrl             : console URL used to build deep links to an incident
 *
 * No external deps: uses Node 18+ global fetch. Dev (no webhook URL): logs + returns
 * a preview so the Test button can show what *would* be posted.
 */
const settings = require('./settings');

const SEV_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };
const SEV_COLOR = { P1: '#dc2626', P2: '#d97706', P3: '#2563eb', P4: '#64748b' };
const SEV_EMOJI = { P1: '🔴', P2: '🟠', P3: '🔵', P4: '⚪' };

const sms = require('./sms');
const DEFAULTS = { enabled: false, slackUrl: '', teamsUrl: '', minSeverity: 'P2', baseUrl: '',
  // WhatsApp via Meta Cloud API Groups messaging (Official Business Account)
  waPhoneId: '', waToken: '', waGroupId: '', waApiVersion: 'v21.0',
  // SMS via Unifonic — creds in ENV; here only the toggle, recipients, and severity gate (P1 by default)
  smsEnabled: false, smsTo: '', smsMinSeverity: 'P1' };

async function getConfig() {
  const c = (await settings.getSetting('chatops')) || {};
  return { ...DEFAULTS, ...c };
}
async function setConfig(patch) {
  const cur = await getConfig();
  const next = { ...cur, ...(patch || {}) };
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

// Build a deep link to the incident (falls back to the alerts board).
function incidentLink(baseUrl, alert) {
  const b = (baseUrl || '').replace(/\/+$/, '');
  if (!b) return null;
  return alert && alert.id ? `${b}/#alerts?incident=${alert.id}` : `${b}/#alerts`;
}

/* ---- payload builders (kept pure + exported so tests can assert them) ---- */
function slackPayload(alert, { baseUrl, kind = 'opened', mention } = {}) {
  const sev = alert.severity || 'P3';
  const link = incidentLink(baseUrl, alert);
  const title = `${SEV_EMOJI[sev] || ''} ${sev} · ${esc(alert.name)}`;
  const detail = `*${esc(alert.metric_key)}* ${OP[alert.operator] || alert.operator} ${fmtVal(alert.threshold, alert.unit)}` +
    ` — observed *${fmtVal(alert.observed_value, alert.unit)}* (n=${alert.sample ?? '—'}, ${alert.window_hours ?? '—'}h)`;
  const ctx = [];
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
  return { text: `[${sev}] ${esc(alert.name)} ${kindWord}`, blocks,
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
    { title: 'Metric', value: `${esc(alert.metric_key)} ${OP[alert.operator] || alert.operator} ${fmtVal(alert.threshold, alert.unit)}` },
    { title: 'Observed', value: `${fmtVal(alert.observed_value, alert.unit)} (n=${alert.sample ?? '—'}, ${alert.window_hours ?? '—'}h)` }
  ];
  if (alert.team) facts.push({ title: 'Team', value: esc(alert.team) });
  if (kind === 'escalated' && alert.escTierLabel) facts.push({ title: 'Escalated to', value: esc(alert.escTierLabel) });
  if (mention) facts.push({ title: 'On-call', value: esc(mention) });
  const body = [
    { type: 'TextBlock', size: 'Large', weight: 'Bolder', color: SEV_AC[sev] || 'Default',
      text: `${SEV_EMOJI[sev] || ''} ${sev} · ${esc(alert.name)}`, wrap: true },
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
  lines.push(`${SEV_EMOJI[sev] || ''} *${head} · ${sev}* — ${esc(alert.name)}`);
  lines.push(`${esc(alert.metric_key)} ${OP[alert.operator] || alert.operator} ${fmtVal(alert.threshold, alert.unit)}` +
    `  →  observed *${fmtVal(alert.observed_value, alert.unit)}* (n=${alert.sample ?? '—'}, ${alert.window_hours ?? '—'}h)`);
  if (alert.team) lines.push(`Team: ${esc(alert.team)}`);
  if (kind === 'escalated' && alert.escTierLabel) lines.push(`Escalated to: ${esc(alert.escTierLabel)}`);
  if (mention) lines.push(`On-call: ${esc(mention)}`);
  const link = incidentLink(baseUrl, alert);
  if (link) lines.push(link);
  return lines.join('\n');
}
function whatsappPayload(alert, opts, groupId) {
  return { messaging_product: 'whatsapp', recipient_type: 'group', to: groupId,
    type: 'text', text: { preview_url: false, body: whatsappText(alert, opts) } };
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
  const out = { skipped: false, channels: [], slackPreview: null, teamsPreview: null };

  if (!cfg.enabled && kind !== 'test') { out.skipped = 'chatops disabled'; return out; }
  // policy-driven escalations (force) and tests bypass the minSeverity gate
  if (kind !== 'test' && !opts.force) {
    const need = SEV_RANK[cfg.minSeverity] || 2;
    if ((SEV_RANK[alert.severity] || 9) > need) { out.skipped = `below minSeverity (${cfg.minSeverity})`; return out; }
  }
  const popts = { baseUrl: cfg.baseUrl, kind, mention: opts.mention };
  const slack = slackPayload(alert, popts);
  const teams = teamsPayload(alert, popts);
  out.slackPreview = slack; out.teamsPreview = teams;

  for (const [name, url, body] of [['slack', cfg.slackUrl, slack], ['teams', cfg.teamsUrl, teams]]) {
    if (!url) continue;
    try { await postJson(url, body); out.channels.push({ name, sent: true }); }
    catch (e) { out.channels.push({ name, sent: false, error: e.message }); }
  }
  // WhatsApp group via Meta Cloud API (needs phone-number ID + token + group ID)
  const waReady = cfg.waPhoneId && cfg.waToken && cfg.waGroupId;
  if (cfg.waPhoneId && cfg.waGroupId) out.whatsappPreview = whatsappText(alert, popts);
  if (waReady) {
    const url = `https://graph.facebook.com/${cfg.waApiVersion || 'v21.0'}/${cfg.waPhoneId}/messages`;
    try { await postJson(url, whatsappPayload(alert, popts, cfg.waGroupId), { Authorization: `Bearer ${cfg.waToken}` }); out.channels.push({ name: 'whatsapp', sent: true }); }
    catch (e) { out.channels.push({ name: 'whatsapp', sent: false, error: e.message }); }
  }
  // SMS via Unifonic — high-severity only (smsMinSeverity, default P1), to the on-call number(s)
  const smsGate = kind === 'test' || (SEV_RANK[alert.severity] || 9) <= (SEV_RANK[cfg.smsMinSeverity] || 1);
  if (cfg.smsEnabled && smsGate) {
    if (sms.smsConfigured() && (cfg.smsTo || process.env.SMS_TO)) {
      const link = incidentLink(cfg.baseUrl, alert);
      const txt = `[${alert.severity}] ${esc(alert.name)}` + (alert.observed_value != null ? ` — ${fmtVal(alert.observed_value, alert.unit)}` : '') + (link ? ` ${link}` : '');
      try { const rs = await sms.sendSms(txt, { to: cfg.smsTo }); out.channels.push({ name: 'sms', sent: rs.sent, ...(rs.reason ? { reason: rs.reason } : {}), ...(rs.results ? { detail: rs.results } : {}) }); }
      catch (e) { out.channels.push({ name: 'sms', sent: false, error: e.message }); }
    } else { out.channels.push({ name: 'sms', sent: false, reason: 'SMS creds (env) or recipients missing' }); }
  }
  if (!cfg.slackUrl && !cfg.teamsUrl && !waReady && !(cfg.smsEnabled && smsGate)) { out.dev = true; console.log(`[CHATOPS] (dev/no-channel) ${kind}: [${alert.severity}] ${alert.name}`); }
  return out;
}

module.exports = { getConfig, setConfig, notifyIncident, slackPayload, teamsPayload, whatsappText, whatsappPayload, incidentLink, DEFAULTS, SEV_RANK };
