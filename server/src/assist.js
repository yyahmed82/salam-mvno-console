/* Yusr (يُسر — "ease") — LLM troubleshooting chatbot for L1 / call-center agents.
 *
 * Architecture (mirrors the classic router pattern):
 *
 *   User question ──► intent router ──┬─► customer   : Subscriber 360 + timeline + lines (by MSISDN / National ID)
 *                                     ├─► alerts     : open incidents, severity counts, SLO burn
 *                                     ├─► knowledge  : runbook .md docs + error-code catalog (keyword-scored chunks)
 *                                     └─► smalltalk  : greetings / thanks
 *
 * The gathered context is packed into a system prompt and sent to a LOCAL Ollama
 * instance (/api/chat). Nothing leaves the network. If Ollama is unreachable the
 * bot degrades gracefully: it still answers from the gathered structured context
 * with a rule-based summary, flagged { degraded: true }.
 *
 * Config lives in console_settings under key 'assist':
 *   { enabled, ollamaUrl, model, timeoutMs }
 * PII governance: context is masked with roles.maskDeep according to the CALLER's
 * caps before it ever reaches the LLM — the model only sees what the agent may see.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const roles = require('./roles');
const settings = require('./settings');
const subscriber = require('./subscriber');

const C = db.console;

const DEFAULTS = {
  enabled: true,
  // host.docker.internal reaches the host's Ollama from inside the console container
  ollamaUrl: process.env.OLLAMA_URL || 'http://host.docker.internal:11434',
  model: process.env.OLLAMA_MODEL || 'llama3.1',
  timeoutMs: 45000
};

async function getConfig() {
  const c = (await settings.getSetting('assist')) || {};
  return { ...DEFAULTS, ...c };
}
async function setConfig(patch) {
  const cur = await getConfig();
  const next = { ...cur, ...(patch || {}) };
  next.timeoutMs = Math.min(120000, Math.max(5000, Number(next.timeoutMs) || 45000));
  if (!next.ollamaUrl) next.ollamaUrl = DEFAULTS.ollamaUrl;
  if (!next.model) next.model = DEFAULTS.model;
  await settings.setSetting('assist', next);
  return next;
}

/* ------------------------------ knowledge base ------------------------------ */
// Runbook docs are served from STATIC_DIR (the mounted console folder), so KB
// updates need no rebuild — just edit the .md files.
const KB_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', '..');
// ONLY troubleshooting runbooks. Dev/project docs (FEATURE_PARITY, README) are deliberately
// excluded — their "Still open" feature lists were being confused with open incidents.
const KB_FILES = ['OPS_RUNBOOK.md', 'UPG_PAYMENT_MONITORING.md'];

let kbCache = null, kbLoadedAt = 0;
function loadKb() {
  if (kbCache && Date.now() - kbLoadedAt < 5 * 60_000) return kbCache;   // 5-min cache
  const chunks = [];
  for (const f of KB_FILES) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(KB_DIR, f), 'utf8'); } catch (e) { continue; }
    // split on headings; keep the heading with its body
    const parts = txt.split(/\n(?=#{1,3} )/);
    for (const p of parts) {
      const body = p.trim();
      if (body.length < 40) continue;
      const title = (body.match(/^#{1,3} (.+)/) || [])[1] || f;
      chunks.push({ doc: f, title, text: body.slice(0, 2400) });
    }
  }
  kbCache = chunks; kbLoadedAt = Date.now();
  return chunks;
}

const STOP = new Set(['the','a','an','is','are','was','were','to','of','in','on','for','and','or','what','how','why','do','does','did','can','i','we','it','this','that','with','my','me','please','about']);
function terms(q) {
  return String(q || '').toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter(t => t.length > 1 && !STOP.has(t));
}
function searchKb(q, limit = 3) {
  const ts = terms(q);
  if (!ts.length) return [];
  return loadKb()
    .map(c => {
      const hay = (c.title + '\n' + c.text).toLowerCase();
      let score = 0;
      for (const t of ts) { if (hay.includes(t)) score += (c.title.toLowerCase().includes(t) ? 3 : 1); }
      return { ...c, score };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function searchErrorCodes(q, limit = 5) {
  const ts = terms(q);
  if (!ts.length) return [];
  try {
    const r = await C.query(
      `SELECT code, label, area FROM error_codes
        WHERE code ILIKE ANY($1) OR label ~* $2 OR area ~* $2
        LIMIT $3`,
      [ts.map(t => '%' + t + '%'), '(' + ts.join('|') + ')', limit]);
    return r.rows;
  } catch (e) { return []; }
}

/* ------------------------------ intent routing ------------------------------ */
// A Saudi MSISDN (05xxxxxxxx / 9665xxxxxxxx) or a National/Iqama ID (10 digits, 1|2 prefix)
function extractIdentifier(q) {
  const orig = String(q || '');
  const s = orig.replace(/[\s\-()]/g, '');
  const m = s.match(/(?:\+?966|0)?5\d{8}/);
  if (m) { let v = m[0].replace(/^\+?966/, '0'); if (!v.startsWith('0')) v = '0' + v; return v; }
  // National/Iqama ID: 10 digits starting 1|2, not embedded in a longer number.
  // Match on the ORIGINAL string (digit-boundaries), so "…fail for 2398761234" works.
  const n = orig.match(/(?<![0-9])[12]\d{9}(?![0-9])/);
  return n ? n[0] : null;
}

const ALERT_WORDS = /\b(alerts?|incidents?|outages?|down|broken|p1|p2|p3|slo|breach(es|ed)?|firing|what'?s (wrong|broken)|health)\b/i;
const SMALL_TALK = /^\s*(hi|hello|hey|salam|salaam|assalam.*|thanks?|thank you|shukran|good (morning|evening|afternoon)|bye|ok|okay)\s*[!.؟?]*\s*$/i;
// Yusr's remit: CUSTOMER journeys, troubleshooting, request/response details. A knowledge
// question must touch one of these topics; anything else is out of scope.
const CUSTOMER_TOPICS = /\b(subscriber|customer|msisdn|journey|order|onboarding|activat|esim|e-sim|sim|iccid|mnp|port|payment|upg|tap|refund|charge|bill|otp|nafath|semati|citc|eligib|kyc|error|fail|stuck|pending|timeout|retry|troubleshoot|apollo|posa|checkout|plan|line|number|delivery|webhook|callback|request|response|trace|api)\b/i;

function detectIntent(q) {
  if (SMALL_TALK.test(q)) return 'smalltalk';
  if (extractIdentifier(q)) return 'customer';
  if (ALERT_WORDS.test(q)) return 'alerts';
  if (CUSTOMER_TOPICS.test(q)) return 'knowledge';
  return 'out_of_scope';
}

/* ------------------------------ context gathering ------------------------------ */
async function customerContext(q, allowUnmask) {
  const key = extractIdentifier(q);
  if (!key) return null;
  const raw = await subscriber.profile({ key });
  if (!raw.found) return { key, found: false };
  // mask FIRST (while everything is still structured), THEN build/stringify the pack —
  // otherwise PII inside request/response traces would escape maskDeep as strings
  const p = roles.maskDeep(raw, allowUnmask);
  // keep the pack small: identity, lines, per-stage summary, last 12 events
  const pack = {
    key, found: true,
    identity: p.identity,
    lines: (p.lines || []).slice(0, 6).map(l => ({
      mobile: l.mobile_number, plan: l.plan, state: l.aasm_state, status: l.status,
      sim: l.sim, line_type: l.line_type, flow: l.flow, completed: l.completed,
      activated: l.activated, eligible: l.is_eligible, created_at: l.created_at
    })),
    stage_summary: p.summary,
    recent_events: (p.events || []).slice(-12).map(e => ({
      at: e.at, source: e.source, step: e.step || e.kind, ok: e.ok,
      detail: e.detail || null, endpoint: e.endpoint || null,
      // full request/response traces, truncated so the prompt stays small
      request: e.request ? JSON.stringify(e.request).slice(0, 400) : null,
      response: e.response ? JSON.stringify(e.response).slice(0, 500) : null,
      ms: e.ms != null ? e.ms : null, status: e.status != null ? e.status : null
    }))
  };
  return pack;   // already masked above
}

async function alertsContext() {
  try {
    const open = (await C.query(
      `SELECT id, name, severity, team, metric_key, observed_value, threshold, operator,
              fired_at, message
         FROM alerts WHERE status='open' ORDER BY severity, fired_at DESC LIMIT 15`)).rows;
    const counts = (await C.query(
      `SELECT severity, count(*)::int AS n FROM alerts WHERE status='open' GROUP BY severity`)).rows;
    return { open_count: open.length, by_severity: counts, incidents: open };
  } catch (e) { return { error: e.message }; }
}

/* ------------------------------ Ollama ------------------------------ */
async function ollamaChat({ cfg, system, history, user }) {
  const url = cfg.ollamaUrl.replace(/\/+$/, '') + '/api/chat';
  const messages = [{ role: 'system', content: system }];
  for (const h of (history || []).slice(-8)) {
    if (h && h.role && h.content) messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 2000) });
  }
  messages.push({ role: 'user', content: user });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages, stream: false, options: { temperature: 0.2, num_predict: 600 } })
    });
    if (!r.ok) throw new Error('Ollama HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const j = await r.json();
    return (j.message && j.message.content || '').trim();
  } finally { clearTimeout(timer); }
}

async function ping() {
  const cfg = await getConfig();
  const url = cfg.ollamaUrl.replace(/\/+$/, '') + '/api/tags';
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status, url: cfg.ollamaUrl };
    const j = await r.json();
    const models = (j.models || []).map(m => m.name);
    return { ok: true, url: cfg.ollamaUrl, model: cfg.model, modelAvailable: models.some(m => m.startsWith(cfg.model)), models };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message, url: cfg.ollamaUrl };
  }
}

/* ------------------------------ answer composition ------------------------------ */
const SYSTEM_BASE =
`You are Yusr (يُسر — "ease"), the customer-troubleshooting copilot for Salam Mobile's MVNO digital console.
Your users are L1 support and call-center agents. Be concise, factual and actionable.
SCOPE — you ONLY handle:
1. Customer journeys: onboarding orders, activation, eSIM/physical SIM, MNP port-in, eligibility (Semati + Nafath/CITC), payments (UPG/Tap), OTP, delivery.
2. Troubleshooting a specific subscriber: failed steps, errors, stuck orders, and the request/response details of each integration call.
3. Live incidents from the alerts data ONLY.
Anything else (project features, console development, documentation status, general questions) → reply exactly: "That's outside my scope — I only help with customer journeys and troubleshooting. Ask me about a subscriber, a failed step, or an open incident."
Rules:
- Answer ONLY from the CONTEXT provided. If the context doesn't contain the answer, say so and suggest where to look in the console.
- "Open incidents" means the open_alerts data — NEVER lists found in runbook text. If open_alerts is present and empty, say there are no open incidents.
- Masked values like 05*****290 are intentional PII masking — never try to guess them.
- When a subscriber has failed steps, explain the most likely cause in plain words, quote the relevant response/error from the trace, and give the next troubleshooting step.
- Eligibility means Semati + Nafath (CITC) checks. Payments use UPG/Tap; payment status 'fail' means failed.
- Keep answers under 150 words. Use short bullet lines when listing steps.`;

function fallbackAnswer(intent, ctx) {
  if (intent === 'smalltalk') return 'أهلاً! I\'m Yusr — I can look up a subscriber (send an MSISDN like 05xxxxxxxx or a National ID), check open incidents, or search the runbooks. How can I help?';
  if (intent === 'customer') {
    if (!ctx.customer || ctx.customer.found === false) return 'I could not find a subscriber for that number/ID. Double-check the MSISDN (05xxxxxxxx) or National ID and try again.';
    const c = ctx.customer;
    const lines = (c.lines || []).map(l => `• ${l.mobile || '—'} — ${l.plan || 'no plan'} — state: ${l.state || l.status || '—'} (${l.sim || ''} ${l.line_type || ''})`).join('\n');
    const fails = (c.recent_events || []).filter(e => e.ok === false);
    const failTxt = fails.length ? `\nRecent failures:\n` + fails.slice(-3).map(e => `• ${e.source}${e.step ? ' / ' + e.step : ''}: ${e.error || 'failed'}`).join('\n') : '\nNo recent failed steps.';
    return `Subscriber found.\n${lines}${failTxt}\n(LLM offline — showing raw profile. Open Subscriber 360 for the full timeline.)`;
  }
  if (intent === 'alerts') {
    const a = ctx.alerts || {};
    if (!a.open_count) return 'No open incidents right now. All quiet ✅';
    const top = (a.incidents || []).slice(0, 5).map(i => `• [${i.severity}] ${i.name} (${i.team || '—'})`).join('\n');
    return `${a.open_count} open incident(s):\n${top}\n(LLM offline — open the Alerts board for details.)`;
  }
  const kb = ctx.kb || [];
  if (!kb.length) return 'I could not find anything in the runbooks for that. Try rephrasing, or check the Ops Runbook / error-codes catalog in the console.';
  return 'LLM offline — closest runbook sections:\n' + kb.map(k => `• ${k.doc} › ${k.title}`).join('\n');
}

function suggestionsFor(intent, ctx) {
  if (intent === 'customer' && ctx.customer && ctx.customer.found) {
    return ['Why did the last step fail?', 'Show payment history', 'Is this subscriber eligible?'];
  }
  if (intent === 'alerts') return ['Which incident is most severe?', 'What is the runbook for payment stuck?', 'Show SLO status'];
  if (intent === 'smalltalk') return ['Check subscriber 05… ', 'What incidents are open?', 'How do I handle a stuck UPG payment?'];
  return ['What incidents are open?', 'How do I handle a stuck UPG payment?', 'Why would eligibility fail?'];
}

function actionsFor(intent, ctx) {
  const acts = [];
  if (intent === 'customer' && ctx.customer && ctx.customer.found && ctx.customerKey) {
    acts.push({ label: 'Open Subscriber 360', href: '#sub360?key=' + encodeURIComponent(ctx.customerKey) });
  }
  if (intent === 'alerts') acts.push({ label: 'Open Alerts board', href: '#alerts' });
  if (intent === 'knowledge') acts.push({ label: 'Error Control Board', href: '#errors' });
  return acts;
}

/* ------------------------------ main entry ------------------------------ */
async function chat({ message, history, allowUnmask }) {
  const cfg = await getConfig();
  const q = String(message || '').slice(0, 1000).trim();
  if (!q) return { error: 'empty message' };
  if (!cfg.enabled) return { error: 'Assist is disabled in Settings.' };

  const intent = detectIntent(q);
  const ctx = {};

  // out-of-scope questions never reach the LLM
  if (intent === 'out_of_scope') {
    return { intent, reply: "That's outside my scope — I only help with customer journeys and troubleshooting. Ask me about a subscriber (MSISDN / National ID), a failed step, a payment, or an open incident.",
      suggestions: ['Check subscriber 05…', 'What incidents are open?', 'How do I handle a stuck UPG payment?'],
      actions: [], sources: [], degraded: false };
  }

  if (intent === 'customer') {
    ctx.customerKey = extractIdentifier(q);
    ctx.customer = await customerContext(q, allowUnmask);
    ctx.kb = searchKb(q, 2);
  } else if (intent === 'alerts') {
    // alerts questions are answered from live alert data ONLY — no runbook text,
    // so the model can't confuse doc sections with real incidents
    ctx.alerts = await alertsContext();
  } else if (intent === 'knowledge') {
    ctx.kb = searchKb(q, 3);
    ctx.errorCodes = await searchErrorCodes(q, 5);
  }

  const sources = []
    .concat((ctx.kb || []).map(k => ({ type: 'runbook', doc: k.doc, section: k.title })))
    .concat(ctx.customer && ctx.customer.found ? [{ type: 'subscriber', key: ctx.customerKey }] : [])
    .concat(ctx.alerts ? [{ type: 'alerts', open: ctx.alerts.open_count }] : [])
    .concat((ctx.errorCodes || []).length ? [{ type: 'error_codes', matches: ctx.errorCodes.length }] : []);

  // small talk never needs the LLM round-trip
  if (intent === 'smalltalk') {
    return { intent, reply: fallbackAnswer(intent, ctx), suggestions: suggestionsFor(intent, ctx), actions: [], sources: [], degraded: false };
  }

  const contextBlock = JSON.stringify({
    customer: ctx.customer || undefined,
    open_alerts: ctx.alerts || undefined,
    runbook_sections: (ctx.kb || []).map(k => ({ doc: k.doc, title: k.title, content: k.text })),
    error_codes: ctx.errorCodes && ctx.errorCodes.length ? ctx.errorCodes : undefined
  }, null, 1).slice(0, 12000);

  let reply = null, degraded = false, llmError = null;
  try {
    reply = await ollamaChat({
      cfg,
      system: SYSTEM_BASE + '\n\nCONTEXT:\n' + contextBlock,
      history, user: q
    });
    if (!reply) throw new Error('empty LLM reply');
  } catch (e) {
    degraded = true; llmError = e.name === 'AbortError' ? 'timeout' : e.message;
    reply = fallbackAnswer(intent, ctx);
  }

  return { intent, reply, suggestions: suggestionsFor(intent, ctx), actions: actionsFor(intent, ctx), sources, degraded, llmError };
}

module.exports = { chat, ping, getConfig, setConfig, DEFAULTS };
