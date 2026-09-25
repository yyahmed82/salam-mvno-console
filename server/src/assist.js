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
const errors = require('./errors');

const C = db.console;

const DEFAULTS = {
  enabled: true,
  // host.docker.internal reaches the host's Ollama from inside the console container
  ollamaUrl: process.env.OLLAMA_URL || 'http://host.docker.internal:11434',
  model: process.env.OLLAMA_MODEL || 'llama3.1',
  timeoutMs: 75000,           // CPU-only inference on 152: prompt-eval + 220 tokens needs headroom
  maxTokens: 220              // measured 20 Sep: ~3.3 tok/s on 152, so this cap IS most of the wait
};

async function getConfig() {
  const c = (await settings.getSetting('assist')) || {};
  const cfg = { ...DEFAULTS, ...c };
  // local kit: the console DB is a clone of prod, whose setting points at host.docker.internal —
  // OLLAMA_URL_OVERRIDE (set by tools/local/env-from-152.sh) redirects to the SSH tunnel instead
  if (process.env.OLLAMA_URL_OVERRIDE) cfg.ollamaUrl = process.env.OLLAMA_URL_OVERRIDE;
  if (process.env.OLLAMA_MODEL_OVERRIDE) cfg.model = process.env.OLLAMA_MODEL_OVERRIDE;
  return cfg;
}
async function setConfig(patch) {
  const cur = await getConfig();
  const next = { ...cur, ...(patch || {}) };
  next.timeoutMs = Math.min(120000, Math.max(5000, Number(next.timeoutMs) || 75000));
  // answer length cap — the one setting that moves Yusr's latency linearly on CPU-only inference
  next.maxTokens = Math.min(400, Math.max(60, Number(next.maxTokens) || 220));
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
const KB_FILES = ['OPS_RUNBOOK.md', 'UPG_PAYMENT_MONITORING.md', 'INTEGRATIONS.md',
  'OTO_API_DOCS.md',      // full imported OTO courier docs (tools/import-oto-docs.js)
  'SALAM_API_DOCS.md',    // selfcare/Apollo API docs from the app repo (tools/import-salam-api-docs.js)
  'TAP_API_DOCS.md'];     // Tap/UPG payment-gateway docs (tools/import-tap-docs.js)

// split a doc's text on markdown headings into heading-scoped chunks (shared by files + uploads)
function chunkText(txt, docLabel) {
  const chunks = [];
  const parts = String(txt || '').split(/\n(?=#{1,3} )/);
  for (const p of parts) {
    const body = p.trim();
    if (body.length < 40) continue;
    const title = (body.match(/^#{1,3} (.+)/) || [])[1] || docLabel;
    chunks.push({ doc: docLabel, title, text: body.slice(0, 2400) });
  }
  return chunks;
}

let kbCache = null, kbLoadedAt = 0;
function loadKb() {
  if (kbCache && Date.now() - kbLoadedAt < 5 * 60_000) return kbCache;   // 5-min cache
  const chunks = [];
  for (const f of KB_FILES) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(KB_DIR, f), 'utf8'); } catch (e) { continue; }
    chunks.push(...chunkText(txt, f));
  }
  kbCache = chunks; kbLoadedAt = Date.now();
  return chunks;
}

// Uploaded L2-Workbench docs (console_docs). SHARED docs with extracted text become Yusr-answerable
// KB chunks, on the SAME 5-min cache cadence as the file-based runbooks. Loaded async (DB) and merged
// into searchKb; ensureDocChunks() is awaited once at the top of chat() so a request sees fresh docs.
let docChunks = [], docLoadedAt = 0;
async function ensureDocChunks() {
  if (docChunks.length && Date.now() - docLoadedAt < 5 * 60_000) return docChunks;
  try {
    const r = await C.query(
      `SELECT id, title, text_content FROM console_docs
        WHERE shared = true AND text_content IS NOT NULL AND length(text_content) > 40
        ORDER BY at DESC LIMIT 200`);
    const chunks = [];
    for (const row of r.rows) chunks.push(...chunkText(row.text_content, 'doc: ' + row.title));
    docChunks = chunks; docLoadedAt = Date.now();
  } catch (e) { /* keep the previous cache on error */ }
  return docChunks;
}

const STOP = new Set(['the','a','an','is','are','was','were','to','of','in','on','for','and','or','what','how','why','do','does','did','can','i','we','it','this','that','with','my','me','please','about']);
function terms(q) {
  return String(q || '').toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter(t => t.length > 1 && !STOP.has(t));
}
function searchKb(q, limit = 3) {
  const ts = terms(q);
  if (!ts.length) return [];
  // file-based runbooks + shared uploaded docs (docChunks refreshed by ensureDocChunks in chat())
  return loadKb().concat(docChunks)
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

/* ------------------------------ case memory ------------------------------ */
// PII scrub for anything persisted to assist_cases: MSISDNs and National/Iqama IDs are masked
// IN THE TEXT (maskDeep only handles known keys on objects, not substrings inside free text).
function scrubPII(s) {
  return String(s || '')
    .replace(/(?:\+?966|0)5\d{8}/g, m => m.slice(0, 4) + '******')
    .replace(/(?<![0-9])[12]\d{9}(?![0-9])/g, m => m[0] + '*********');
}
// Save a resolved case (👍 path). Dedupes on the scrubbed problem text; repeat saves upvote instead.
async function saveCase({ question, reply, intent, actor }) {
  const problem = scrubPII(question).slice(0, 1200);
  const resolution = scrubPII(reply).slice(0, 3000);
  if (problem.length < 10 || resolution.length < 20) return;      // nothing worth learning
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(problem.toLowerCase()).digest('hex');
  const title = problem.slice(0, 90);
  await C.query(
    `INSERT INTO assist_cases (problem_hash, title, problem, resolution, tags, source, actor)
       VALUES ($1,$2,$3,$4,$5,'thumbs_up',$6)
     ON CONFLICT (problem_hash) DO UPDATE
       SET helpful_votes = assist_cases.helpful_votes + 1, resolution = EXCLUDED.resolution, at = now()`,
    [hash, title, problem, resolution, intent || null, actor || null]);
}
// Retrieve past resolved cases like KB chunks: keyword-scored, best votes win ties.
async function searchCases(q, limit = 3) {
  const ts = terms(q);
  if (!ts.length) return [];
  try {
    const r = await C.query(
      `SELECT title, problem, resolution, tags, helpful_votes
         FROM assist_cases
        WHERE problem ~* $1 OR resolution ~* $1 OR coalesce(tags,'') ~* $1
        ORDER BY helpful_votes DESC, at DESC LIMIT $2`,
      ['(' + ts.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', limit]);
    return r.rows;
  } catch (e) { return []; }
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
  if (n) return n[0];
  /* VISITORS (25 Sep 2026): a KSA border number (10 digits, 3|4 prefix) or a passport — "passport N01715453",
   * "جواز 146018237", or a bare letter+digits token like HE3486840 / N01715453 */
  const b = orig.match(/(?<![0-9])[34]\d{9}(?![0-9])/); if (b) return b[0];
  const pp = orig.match(/(?:passport|pass\.?|جواز(?:\s*(?:سفر|السفر))?)\s*(?:no\.?|number|num|#|:|رقم)?\s*:?\s*([A-Za-z0-9]{6,12})(?![A-Za-z0-9])/i); if (pp) return pp[1].toUpperCase();
  const bare = orig.match(/(?<![A-Za-z0-9])(?!INC|TKT|REQ|CHG|RITM|SN\d|PRB)[A-Z]{1,3}\d{5,10}[A-Za-z]?(?![A-Za-z0-9])/); if (bare) return bare[0].toUpperCase();   // INC… / TKT… are tickets, not passports
  return null;
}

const ALERT_WORDS = /\b(alerts?|incidents?|outages?|down|broken|p1|p2|p3|slo|breach(es|ed)?|firing|what'?s (wrong|broken)|health)\b/i;
const SMALL_TALK = /^\s*(hi|hello|hey|salam|salaam|assalam.*|thanks?|thank you|shukran|good (morning|evening|afternoon)|bye|ok|okay)\s*[!.؟?]*\s*$/i;
// Yusr's remit: CUSTOMER journeys, troubleshooting, integrations, request/response details. A
// knowledge question must touch one of these topics; anything else is out of scope. Includes the
// integration/system names shown on the Integrations page (its own "Ask Yusr" chip sends
// "Explain the integration …" — 'integration' being absent here made the page's own button get
// refused as out-of-scope), plus common Arabic terms so call-center agents can ask in Arabic.
const CUSTOMER_TOPICS = /\b(subscriber|customer|msisdn|journey|order|onboarding|activat|esim|e-sim|sim|iccid|mnp|port|payment|upg|tap|refund|charge|bill|otp|nafath|semati|citc|eligib|kyc|error|fail|stuck|pending|timeout|retry|troubleshoot|apollo|posa|checkout|plan|line|number|delivery|webhook|callback|request|response|trace|api|integrations?|oracle|osb|oss|moss|bss|absher|tcc|hyperpay|tamara|merchalink|salampay|worker|queue|sidekiq|courier|oto|smsa|barq|imile|saleor|zatca|unifonic)\b/i
  , CUSTOMER_TOPICS_AR = /(مشترك|عميل|رقم|طلب|تفعيل|شريحة|دفع|فاتورة|مبلغ|استرجاع|خطأ|فشل|معلق|مشكلة|توصيل|نفاذ|أهلية|باقة|تكامل)/;

/* PAYMENT IDENTIFIERS — an agent pastes one of these and expects the whole story:
 *   pay_dn5b55j98i3w  UPG payment id      chg_LV03G13…  Tap charge id
 *   umoxmoh2zt4l      our payment reference (= the gateway invoice id)
 *   a payment UUID from the console
 * A bare lowercase token is only treated as a reference when the sentence is about payments —
 * otherwise "activation" or a plan name would be mistaken for one. */
const PAY_PREFIXED = /\b((?:pay|chg|tok|cus|inv)_[A-Za-z0-9]{6,40})\b/;
const PAY_UUID = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
const PAY_REF = /\b([a-z0-9]{10,16})\b/;
const PAY_WORDS = /\b(payment|pay|charge|charged|recharge|top-?up|invoice|bill|refund|declin|upg|tap|mada|visa|apple\s*pay|stc\s*pay|transaction|reference)\b/i;
function extractPaymentKey(q) {
  const s = String(q || '');
  const m1 = s.match(PAY_PREFIXED); if (m1) return { key: m1[1], kind: 'gateway_id' };
  if (!PAY_WORDS.test(s)) return null;                 // don't guess without payment context
  const m2 = s.match(PAY_UUID); if (m2) return { key: m2[1], kind: 'payment_uuid' };
  const m3 = s.match(PAY_REF);
  if (m3 && /[0-9]/.test(m3[1]) && /[a-z]/.test(m3[1])) return { key: m3[1], kind: 'reference' };
  return null;
}

/* "SMS details 966510124924", "did he get the otp", "رسالة" … — an SMS question about a specific
 * customer, which needs the OTP history rather than the generic subscriber summary. */
const SMS_WORDS = /\b(sms|otp|message|messages|text|code|رسالة|رسائل|كود)\b/i;
function isSmsAsk(q) { return SMS_WORDS.test(String(q || '')) && !!extractIdentifier(q); }

/* FIXED (FTTH / 5G home / SDA dealers / Salam Home app) — 5 Sep 2026. Keys the agent pastes: an FTTH account
 * (FTTH123456), a BSS order number, a customer code / id, an ODB plate, an ICCID; or a question about fixed issues. */
const FIXED_WORDS = /\b(fixed|ftth|fttb|fiber|fibre|5g\s*(home|fwa|wl|white)?|home\s*internet|salam\s*home|relocation|relocat|freeze|unfreeze|odb|feasibility|appointment|installation|cpe|ont|dealer|sda|promoter|manafith|e-?purchase|qr)\b/i
  , FIXED_WORDS_AR = /(ثابت|فايبر|ألياف|الياف|إنترنت منزلي|انترنت منزلي|سلام هوم|نقل الخدمة|تجميد|موزع|وكيل)/;
const FIXED_KEY = /\b(FTTH\w*\d{4,}|FTTB\w*\d{4,})\b/i;
const FIXED_ISSUE_WORDS = /\b(issue|issues|problem|problems|error|errors|fail|failing|failed|stuck|status|health|how (is|are)|what'?s (wrong|happening)|open|today|now)\b|(مشكلة|مشاكل|خطأ|أخطاء|فشل|وضع|حالة)/i;
function extractFixedKey(q) {
  const s = String(q || '');
  const m = s.match(FIXED_KEY); if (m) return { key: m[1], kind: 'service' };
  const o = s.match(/\b(ODB[-_ ]?[A-Z0-9-]{3,})\b/i); if (o) return { key: o[1], kind: 'odb' };
  if (!FIXED_WORDS.test(s) && !FIXED_WORDS_AR.test(s)) return null;
  const ic = s.match(/\b(\d{18,22})\b/); if (ic) return { key: ic[1], kind: 'iccid' };
  // a 5–12 digit number that is NOT a msisdn / national id → order number or customer code/id
  const n = s.replace(/(?:\+?966|0)?5\d{8}/g, ' ').match(/(?<![0-9])(?![12]\d{9}(?![0-9]))\d{5,12}(?![0-9])/);
  if (n) return { key: n[0], kind: 'code' };
  return null;
}
function isFixedAsk(q) { return FIXED_WORDS.test(String(q || '')) || FIXED_WORDS_AR.test(String(q || '')); }
/* Follow-ups ("where is the ftth service for THIS customer?", "why did the last step fail?") carry
 * no key — recover the last one the agent typed from the short history the widget sends. */
const FOLLOWUP_REF = /\b(this|that|the same|his|her|their)\s+(customer|subscriber|user|number|account|service|line|id)\b|\b(for|of)\s+(him|her|them)\b/i;
function lastKeyFromHistory(history) {
  const turns = (history || []).filter(h => h && h.role === 'user').reverse();
  for (const h of turns) {
    const t = String(h.content || '');
    const id = extractIdentifier(t); if (id) return { key: id, kind: 'identifier' };
    const fk = extractFixedKey(t); if (fk) return { key: fk.key, kind: fk.kind };
    if (/^\s*\d{5,12}\s*$/.test(t)) return { key: t.trim(), kind: 'code' };
  }
  return null;
}

function detectIntent(q) {
  if (SMALL_TALK.test(q)) return 'smalltalk';
  // a fixed service / order key → the Fixed customer view (FTTH…, ODB…, or a code in a fixed sentence)
  if (extractFixedKey(q) && !extractIdentifier(q)) return 'fixed_customer';
  if (isFixedAsk(q) && !extractIdentifier(q) && FIXED_ISSUE_WORDS.test(q)) return 'fixed_issues';
  // a payment identifier beats a subscriber lookup: the agent asked about THAT payment
  if (extractPaymentKey(q) && !extractIdentifier(q)) return 'payment';
  if (isSmsAsk(q)) return 'sms';
  if (extractIdentifier(q)) return 'customer';
  if (ALERT_WORDS.test(q)) return 'alerts';
  if (CUSTOMER_TOPICS.test(q) || CUSTOMER_TOPICS_AR.test(q)) return 'knowledge';
  return 'out_of_scope';
}

/* FIXED contexts — read the Operations Console read model through fixedCustomer / fixed360 (masked). */
async function fixedCustomerContext(key, allowUnmask) {
  try {
    const fc = require('./fixedCustomer');
    const r = await fc.lookup({ key, unmask: allowUnmask ? '1' : '0' }, { caps: { unmaskPII: !!allowUnmask } });
    if (!r.found) return { found: false, key, hint: r.link && r.link.reason ? 'nexus link: ' + r.link.reason : (r.inventory && r.inventory.reason) || undefined,
      inventory: r.inventory && r.inventory.available === false ? { available: false, reason: r.inventory.reason } : undefined };
    return { found: true, key, customer_name: (r.customer && r.customer.name) || (r.inventory && r.inventory.customer && r.inventory.customer.name) || null, customer: r.customer,
      /* what the customer HAS (fixed BSS) — authoritative for "does he have FTTH / is it active / what plan" */
      inventory: r.inventory && r.inventory.available ? { tier: r.inventory.tier, as_of: r.inventory.as_of, customer_state: r.inventory.customer && r.inventory.customer.state,
        accounts: (r.inventory.accounts || []).length,
        services: (r.inventory.subscriptions || []).map(x => ({ account: x.account, plan: x.plan, offer: x.offer, speed_mbps: x.speed_mbps, state: x.state_label, since: x.eff_date, until: x.exp_date, provider: x.provider, paid: x.paid, owed_sar: r.inventory.owed && r.inventory.owed[x.account] ? r.inventory.owed[x.account].amount_sar : undefined })),
        open_bss_orders: (r.inventory.open_orders || []).slice(0, 5) } : { available: false, reason: (r.inventory && r.inventory.reason) || 'no inventory source' },
      services: (r.services || []).slice(0, 8).map(x => ({ service: x.service_no, order: x.order_number, journey: x.label, plan: x.plan, channel: x.channel,
        status: x.outcome, step: x.step_reached, odb: x.odb, region: x.region, dealer: x.dealer, started: x.started_at, completed: x.completed_at })),
      recent_attempts: (r.attempts || []).slice(0, 6).map(a => ({ when: a.started_at, journey: a.workflow, status: a.outcome, step: a.step_reached, last_error: a.last_error_category, order: a.order_number, nafath: a.nafath_outcome })),
      errors: (r.errors || []).slice(0, 8).map(e => ({ when: e.occurred_at, category: e.category, code: e.code, message: String(e.message || '').slice(0, 160), step: e.step, resolved: e.resolved })),
      payments: r.payments && r.payments.configured ? (r.payments.rows || []).slice(0, 5).map(p => ({ when: p.created_at, status: p.status, amount_sar: p.amount_sar, method: p.method, order: p.order_number })) : 'payments_v2 not available',
      links: r.links };
  } catch (e) { return { found: false, key, error: e.message }; }
}
async function fixedIssuesContext(q) {
  try {
    const f360 = require('./fixed360');
    const range = /\b(week|7d|7 days)\b/i.test(q) ? '7d' : /\b(month|30d)\b/i.test(q) ? '30d' : '24h';
    const d = await f360.summary({ range });
    const feed = await f360.errorFeed({ range, limit: 12 }).catch(() => ({ rows: [] }));
    return { window: range, source: d.source, freshness: { stale: d.freshness && d.freshness.stale, watcher_lag_min: d.freshness && d.freshness.lag_min, newest_attempt: d.freshness && d.freshness.newest_attempt },
      kpis: d.kpis, by_journey: (d.byWorkflow || []).slice(0, 8).map(w => ({ journey: w.label, attempts: w.n, completed: w.completed, conversion_pct: w.conversion })),
      by_channel: d.byChannel, nafath: d.integrations && d.integrations.nafath, manafith: d.integrations && d.integrations.manafith,
      error_categories: (d.errors || []).slice(0, 8), top_dealers: (d.topDealers || []).slice(0, 5).map(t => ({ dealer: t.dealer_name || t.dealer_code, staff: t.staff_name, attempts: t.n, conversion_pct: t.conversion })),
      recent_errors: (feed.rows || []).slice(0, 8).map(e => ({ when: e.occurred_at, category: e.category, code: e.code, message: String(e.message || '').slice(0, 140), dealer: e.dealer_code, region: e.region })) };
  } catch (e) { return { error: e.message }; }
}

/* Everything the console's payment drill knows, assembled for the model: our record, every
 * gateway attempt on the reference, the raw charge object, and the OFFICIAL Tap code. */
async function paymentContext(q, allowUnmask) {
  const found = extractPaymentKey(q);
  if (!found) return null;
  const k = found.key;
  const tap = require('./tapCodes');
  const out = { key: k, kind: found.kind, found: false };
  try {
    // our record — by reference, by gateway payment id, or by console uuid
    const r = await db.source.query(
      `SELECT id::text, created_at, updated_at, status, amount, vendor, platform, payment_on_type,
              payment_reference_id, fail_reason, customer_mobile_number,
              payment_commit_response#>>'{data,source}' rail,
              payment_commit_response#>>'{data,method}' method,
              payment_commit_response#>>'{data,id}' gw_payment_id,
              payment_commit_response#>>'{data,status}' gw_status
         FROM payments
        WHERE payment_reference_id = $1
           OR payment_commit_response#>>'{data,id}' = $1
           ${/^[0-9a-f-]{36}$/i.test(k) ? 'OR id = $1::uuid' : ''}
        ORDER BY created_at DESC LIMIT 1`, [k]);
    if (r.rows.length) { out.found = true; out.payment = r.rows[0]; }
  } catch (e) { out.appError = e.message; }

  const ref = (out.payment && out.payment.payment_reference_id) || (found.kind === 'reference' ? k : null);
  const upg = require('./upgLink');
  if (ref && upg.configured()) {
    try {
      const g = await upg.rowsForRefs([ref]);
      const rows = (g && g.byRef && g.byRef.get) ? (g.byRef.get(ref) || []) : [];
      out.upg_attempts = rows.map(x => ({
        when: x.created_at, status: x.status, rail: x.source, method: x.method || x.pay_method,
        amount_sar: x.amount == null ? null : Number(x.amount) / 100,
        acquirer_message: x.bank_message || x.gw_msg || null, code: x.gw_code || null,
        charge_id: x.transaction_id
      }));
      out.found = out.found || out.upg_attempts.length > 0;
      // official meaning + class for the final answer
      const last = out.upg_attempts[out.upg_attempts.length - 1];
      if (last) {
        const code = (last.code && tap.describe(last.code)) ? last.code : tap.codeFor(last.acquirer_message || '');
        const d = code ? tap.describe(code) : null;
        if (d) out.tap_code = { code: d.code, official_message: d.message, class: d.cls };
        out.money_taken = ['PAID', 'CAPTURED', 'AUTHORIZED'].includes(String(last.status || '').toUpperCase());
        out.attempts = out.upg_attempts.length;
      }
    } catch (e) { out.upgError = e.message; }
    try {
      const pl = await upg.payloadForRef(ref, { limit: 2 });
      if (pl && pl.rows && pl.rows.length) {
        const P = pl.rows[pl.rows.length - 1].gateway_payload || {};
        const dig = (o, path) => path.split('.').reduce((a, kk) => (a == null ? a : a[kk]), o);
        out.charge_object = {
          charge_id: P.id, status: P.status,
          response_code: dig(P, 'gateway.response.code'), response_message: dig(P, 'gateway.response.message'),
          payment_method: dig(P, 'source.payment_method'), channel: dig(P, 'source.channel'),
          amount: P.amount, currency: P.currency, receipt: dig(P, 'receipt.id'),
          webhook_status: dig(P, 'post.status')
        };
      }
    } catch (_) { /* payload is a bonus */ }
  } else if (!upg.configured()) out.upgError = 'UPG not configured';
  return roles.maskDeep(out, allowUnmask);
}

/* ------------------------------ context gathering ------------------------------ */
async function serviceLines(key, allowUnmask) {
  try {
    const live = require('./liveBss');
    const lf = await live.linesFor(key);
    const lines = (lf.lines || []).slice(0, 6).map(l => ({ msisdn: allowUnmask ? l.msisdn : String(l.msisdn).replace(/^(\d{4})\d+(\d{3})$/, '$1*****$2'),
      source: l.source, since: l.at ? String(l.at).slice(0, 10) : null, plan_id: l.plan_id || null }));
    const out = { count: lines.length, lines, live_bss: live.configured() ? 'available' : 'not configured (replica sources only)' };
    if (lf.note) out.note = lf.note; if (lf.error) out.error = lf.error;
    // current plan / status of the primary line from BSS, when the gateway is reachable (10-min snapshot cache)
    if (live.configured() && lines.length) {
      try {
        const prof = await live.panel(key, 'profile', {});
        const env = (prof && prof.response) || {};
        const d = env.data && typeof env.data === 'object' ? env.data : env;
        const pr = d && (d.profile || d);
        if (prof && prof.ok && pr && typeof pr === 'object')
          out.primary_line_bss = { status: pr.status || pr.subscriptionStatus || pr.state || null, plan: pr.pricePlan || pr.pricePlanName || pr.planName || pr.plan || null,
            type: pr.subscriptionType || pr.paymentType || null, taken_at: prof.taken_at || null, cached: !!prof.cached };
        else if (prof && prof.ok === false) out.primary_line_bss = { error: 'BSS profile call failed (HTTP ' + (prof.http || '—') + ')' };
      } catch (e) { out.primary_line_bss = { error: e.message }; }
    }
    return out;
  } catch (e) { return { count: 0, lines: [], error: e.message }; }
}

async function customerContext(q, allowUnmask) {
  const key = extractIdentifier(q);
  if (!key) return null;
  const __t0 = Date.now();
  const raw = await subscriber.profile({ key });

  // Format-agnostic identifiers. Mobiles are stored inconsistently (onboarding_orders 05…, payments
  // 9665…), and extractIdentifier normalises to 05…, so match failures on the last-9 significant
  // digits (works for 05…, 9665…, +966…). NID = a 10-digit ID key or the profile's national id.
  const qDigits = String(q || '').replace(/\D/g, '');
  const keyDigits = String(key || '').replace(/\D/g, '');
  const lineMobile = raw.lines && raw.lines[0] && raw.lines[0].mobile_number ? String(raw.lines[0].mobile_number).replace(/\D/g, '') : '';
  const last9 = (lineMobile || qDigits || keyDigits).slice(-9);
  const mobileForTickets = (raw.lines && raw.lines[0] && raw.lines[0].mobile_number) || qDigits || keyDigits || null;
  const nid = (raw.identity && (raw.identity.nid || raw.identity.national_id || raw.identity.nationality_id_number || raw.identity.id)) || (/^[12]\d{9}$/.test(keyDigits) ? keyDigits : null);

  // Cross-source signals — gathered REGARDLESS of whether an onboarding profile exists, so existing
  // subscribers (upgrade / recharge, with no onboarding order) still surface their failures + tickets.
  let recent_failures = [], cst_tickets = [], cst_configured = false;
  try {
    if (last9 && last9.length >= 7) {
      // 14-day scan — catches recent CST-age cases (~2 weeks) while staying ~2s; wider windows get slow.
      const rf = await errors.feed({ now: new Date().toISOString(), windowHours: 336, q: last9, limit: 20 });
      recent_failures = roles.maskDeep((rf || []).map(r => ({ category: r.category, when: r.when, detail: r.detail, gateway: r.gw || null })), allowUnmask);
    }
  } catch (e) {}
  /* CST complaints from Remedy (18 Sep 2026). ARSystem is our own read-only database, so this joins the context
   * on every customer question: an agent asking Yusr about a customer needs to know before they speak that the
   * regulator already has a case open. The Arqami call is NOT here — it is external, audited, and counted in
   * CST's own traffic figures, so Yusr only makes it when the question is actually about services (see below). */
  let cst_complaints = null;
  try {
    const cc = require('./custCst');
    if (cc.configured()) {
      const keys = cc.keysOf({ key, identity: raw.identity || null });
      if (nid) keys.push({ value: String(nid), kind: 'idNumber' });
      const r = await cc.complaints(key, { unmask: allowUnmask, limit: 10, extraKeys: keys });
      if (r && r.ok) {
        const sum = cc.summarise(r);
        cst_complaints = { summary: sum ? sum.line : null, open: sum ? sum.open : 0, total: r.count,
          matched_on: r.matchedOn,
          complaints: (r.complaints || []).slice(0, 6).map(t => ({ req: t.req, created: t.created, open: t.open,
            age_days: t.ageDays, status: t.status, category: t.category, service: t.serviceId })) };
      } else if (r && r.error) cst_complaints = { error: r.error };
    }
  } catch (e) { cst_complaints = { error: e.message }; }
  /* Services as CST is shown them — ON ASK ONLY. This is a real call to the regulator-facing Arqami endpoint and
   * it writes a row into APPS.YY_REGISTER_NUMBER_AUDIT, the table CST's own traffic is measured from. Yusr makes
   * it when the question is about what the customer holds or about CST, and never merely because a customer was
   * named. It needs a national id: the service is keyed on identity, and a guess is a wasted regulator call. */
  let cst_services = null;
  if (nid && /\b(cst|citc|regulator|arqami|registered|services?|subscriptions?|what does .* have|lines? (does|do)|شكوى|الخدمات|هيئة)\b/i.test(String(q || ''))) {
    try {
      const cc = require('./custCst');
      if (cc.servicesAvailable()) {
        const r = await cc.services(nid);
        cst_services = r && r.ok
          ? { asked: true, status: r.status, message: r.message, count: r.serviceCount, ms: r.ms,
              services: (r.services || []).map(x => ({ kind: x.kind, number: allowUnmask ? x.number : String(x.number || '').replace(/^(\d{4})\d+(\d{3})$/, '$1*****$2'),
                package: x.packageEn || x.packageAr || null, outstanding: x.outstanding })) }
          : { asked: true, error: (r && r.error) || 'the call did not complete' };
      }
    } catch (e) { cst_services = { asked: true, error: e.message }; }
  }
  try {
    const sn = require('./servicenow');
    if (sn.snConfigured()) {
      cst_configured = true;
      const t = await sn.ticketsForSubscriber({ mobile: mobileForTickets, nid });
      cst_tickets = roles.maskDeep((t.tickets || []).slice(0, 6).map(x => ({
        number: x.number, title: x.short_description, priority: x.priority, state: x.state,
        opened_at: x.opened_at, group: x.group, link: x.link
      })), allowUnmask);
    }
  } catch (e) {}

  if (!raw.found) {
    // No onboarding profile — but if the number shows up in failures or CST tickets it IS a real
    // (existing) subscriber; return a lightweight pack so Yusr helps instead of saying "not found".
    if (recent_failures.length || cst_tickets.length || (cst_complaints && cst_complaints.total)) {
      return { key, found: true, existing_no_onboarding: true, identity: null, lines: [], stage_summary: {}, recent_events: [], recent_failures, cst_tickets, cst_configured, cst_complaints, cst_services };
    }
    return { key, found: false };
  }

  // mask FIRST (while structured), THEN build the pack — so PII inside traces can't escape maskDeep
  const p = roles.maskDeep(raw, allowUnmask);
  const pack = {
    key, found: true,
    identity: p.identity,
    /* what the REGULATOR has on this customer — read from ARSystem, never stored */
    cst_complaints,
    /* what the regulator is SHOWN for this identity — present only when the question asked for it */
    cst_services,
    /* ACTIVE SERVICE LINES — the authoritative answer to "what does this customer HAVE". Resolved by
     * the same chain Customer 360 uses (app account → activation → MNP → partner DMS → live BSS).
     * Yusr used to see only onboarding attempts and concluded "none activated" for customers whose
     * line predates the ledger or came via another channel (Yosri's own line, 5 Sep). */
    service_lines: await serviceLines(key, allowUnmask),
    onboarding_attempts_note: 'lines below are onboarding JOURNEY ATTEMPTS (one row per order, incl. abandoned checkouts) — NOT the subscription inventory; activation state comes from service_lines',
    lines: (p.lines || []).slice(0, 6).map(l => ({
      mobile: l.mobile_number, plan: l.plan, state: l.aasm_state, status: l.status,
      sim: l.sim, line_type: l.line_type, flow: l.flow, completed: l.completed,
      activated: l.activated, eligible: l.is_eligible, created_at: l.created_at
    })),
    stage_summary: p.summary,
    recent_events: (p.events || []).slice(-12).map(e => ({
      at: e.at, source: e.source, step: e.step || e.kind, ok: e.ok,
      detail: e.detail || null, endpoint: e.endpoint || null,
      request: e.request ? JSON.stringify(e.request).slice(0, 400) : null,
      response: e.response ? JSON.stringify(e.response).slice(0, 500) : null,
      ms: e.ms != null ? e.ms : null, status: e.status != null ? e.status : null
    })),
    recent_failures, cst_tickets, cst_configured
  };
  return pack;   // already masked above
}

async function osbCustomerContext(key) {
  try {
    const osb = require('./osbResolve');
    if (!(await require('./osbArchive').available())) return null;
    const r = await osb.customerSummary(key, { limit: 40 });
    if (!r) return null;
    const s = { ...(r.summary || {}) };
    const pipeline = (r.pipeline || []).slice(-8).map(x => ({
      at: x.ts, server: x.server, component: x.component, pipeline: x.pipeline, stage: x.stage,
      direction: x.direction, label: x.label, fault: x.fault, fault_kind: x.fault_kind,
      ecid: x.ecid, txn_ids: x.txn_ids
    }));
    const backend = (r.access || []).slice(-8).map(x => ({
      at: x.ts, server: x.server, component: x.component, uri: x.uri, status: x.status, ms: x.ms, ecid: x.ecid
    }));
    const direct = (r.access_by_msisdn || []).slice(-5).map(x => ({
      at: x.ts, server: x.server, component: x.component, uri: x.uri, status: x.status, ms: x.ms, ecid: x.ecid
    }));
    return roles.maskDeep({ archive_window: r.archive_window, from: r.from, to: r.to,
      summary: s, business_stories: (s.journey_stories || []).slice(0, 6), correlation: s.correlation || null,
      pipeline, backend, direct_backend_hits: direct,
      note: 'Imported OSB archive only; day-1 lag once daily SFTP feed is live. Match is by resolved service MSISDN/NID, payload identifiers, direct access-log MSISDN, then ECID to access rows. The current OSB archive does not carry UIL transaction id or APIGW trace id, so Digital/APIGW to OSB is probable by customer + time unless future logs add a shared header.' }, false);
  } catch (e) { return { error: e.message }; }
}

async function alertsContext() {
  try {
    // trigger_codes joined in so Yusr can answer "why did <rule> fire?" with the exact codes
    // that define it (L2 transparency request TKT-000002), plus the runbook first step.
    const open = (await C.query(
      `SELECT a.id, a.name, a.severity, a.team, a.metric_key, a.observed_value, a.threshold, a.operator,
              a.fired_at, a.message, a.rule_key, r.trigger_codes, r.alert_class, r.description
         FROM alerts a LEFT JOIN alert_rules r ON r.key = a.rule_key
        WHERE a.status='open' ORDER BY a.severity, a.fired_at DESC LIMIT 15`)).rows;
    const counts = (await C.query(
      `SELECT severity, count(*)::int AS n FROM alerts WHERE status='open' GROUP BY severity`)).rows;
    return { open_count: open.length, by_severity: counts, incidents: open };
  } catch (e) { return { error: e.message }; }
}

/* Rule lookup — "why did semati_flapping fire?" / "what triggers api_latency_breach?".
 * Deterministic: definition + trigger codes + recent firing history, straight from the DB. */
async function ruleContext(q) {
  try {
    // anomaly signals (anomaly:<journey>:<kind> or "onboarding.volume") live in the anomaly
    // engine config, not alert_rules — answer them from sigCfg with the seasonal-baseline story.
    const am = /\b(?:anomaly[:.])?([a-z_]+)[:.](volume|failure_rate)\b/i.exec(q || '');
    if (am) {
      const anomaly = require('./anomaly');
      const cfg = await anomaly.getConfig();
      const sig = `${am[1].toLowerCase()}.${am[2].toLowerCase()}`;
      const eff = anomaly.sigCfg(cfg, sig);
      return { anomaly_signal: { sig, eff, engine: { z: cfg.z, volFloor: cfg.volFloor, lookbackWeeks: cfg.lookbackWeeks, raiseAlerts: cfg.raiseAlerts } } };
    }
    const m = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,5})\b/gi;
    const words = String(q || '').match(m) || [];
    const cands = [...new Set(words.map(w => w.toLowerCase()))].filter(w => w.includes('_'));
    if (!cands.length) return null;
    const r = (await C.query(
      `SELECT key, name, severity, team, alert_class, metric_key, operator, threshold, window_hours,
              min_sample, enabled, trigger_codes, description, runbook
         FROM alert_rules WHERE key = ANY($1::text[]) LIMIT 1`, [cands])).rows[0];
    if (!r) return null;
    const hist = (await C.query(
      `SELECT count(*)::int AS fires, sum(breach_count)::int AS breaches, max(fired_at) AS last_fired,
              count(*) FILTER (WHERE status='open')::int AS open_now
         FROM alerts WHERE rule_key=$1 AND fired_at > now() - interval '14 days'`, [r.key])).rows[0];
    return { rule: r, last_14_days: hist };
  } catch (e) { return null; }
}

/* ------------------------------ LLM (llm.js) ------------------------------ */
/* 10 Sep 2026: Yusr no longer talks to Ollama directly — llm.js owns the providers (primary + on-prem fallback,
 * automatic failover, llm_calls audit). The prompt layout and the CPU-tuned options are unchanged:
 * 3 history turns × 500 chars, num_predict 220, num_ctx 4096, keep_alive 30m (set inside llm.js). */
const llm = require('./llm');
async function ollamaChat({ cfg, system, history, user, actor }) {
  const messages = [{ role: 'system', content: system }];
  for (const h of (history || []).slice(-3)) {
    if (h && h.role && h.content) messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 500) });
  }
  messages.push({ role: 'user', content: user });
  /* 20 Sep 2026 — measured on 152: yusr.chat averages 66 s for 861 characters of answer, which is
   * ~215 tokens against the 220 cap at roughly 3.3 tok/s. It is GENERATION-bound, not data-bound,
   * so the cap is the one lever that moves it linearly — 120 tokens is about half the wait for a
   * noticeably shorter answer. Settable from Settings › Assist so it can be tuned, and reverted,
   * without a deploy. Default unchanged at 220: nothing moves until somebody chooses it. */
  const cap = Math.min(400, Math.max(60, Number(cfg && cfg.maxTokens) || 220));
  const out = await llm.chat({ messages, purpose: 'yusr.chat', caller: 'console', actor, maxTokens: cap, numCtx: 4096, temperature: 0.2 });
  return out.text;
}

async function ping() {
  const cfg = await getConfig();
  try {
    const h = await llm.probe(); const p = h.primary || {}; const lc = await llm.getConfig(); const pr = lc.primary || {};
    if (p.ok) return { ok: true, url: pr.url || cfg.ollamaUrl, model: pr.model || cfg.model, modelAvailable: !!p.modelAvailable, models: p.models || [], fallback: h.fallback && h.fallback.configured ? { ok: !!h.fallback.ok, model: lc.fallback && lc.fallback.model } : null };
    return { ok: false, error: p.error || 'unreachable', url: pr.url || cfg.ollamaUrl, fallback: h.fallback && h.fallback.configured ? { ok: !!h.fallback.ok, model: lc.fallback && lc.fallback.model } : null };
  } catch (e) { return { ok: false, error: e.message, url: cfg.ollamaUrl }; }
}

/* ------------------------------ answer composition ------------------------------ */
const SYSTEM_BASE =
`You are Yusr (يُسر — "ease"), the customer-troubleshooting copilot for the Salam Operations Console (Mobile and Fixed).
Your users are L1 support and call-center agents. Be concise, factual and actionable.
SCOPE — you ONLY handle:
1. Customer journeys: onboarding orders, activation, eSIM/physical SIM, MNP port-in, eligibility (Semati + Nafath/CITC), payments (UPG/Tap), OTP, delivery.
2. Troubleshooting a specific subscriber: failed steps, errors, stuck orders, and the request/response details of each integration call.
2b. BSS/OSB evidence: CONTEXT.osb_customer contains imported Oracle Service Bus archive facts for a subscriber (resolved service MSISDN/NID, payload identifier matches, direct access-log MSISDN hits, business stories such as recharge/MNP/onboarding/Remedy/invoice, and ECID-joined OSB hops). Use it to explain which BSS/Oracle calls happened, faults, latency, and whether the archive window covers the case. Do not call it exact Digital/APIGW to OSB correlation unless the context explicitly provides a shared request id; normally the OSB archive lacks UIL transaction id / APIGW trace id, so say it is OSB evidence or probable by subscriber + time.
3. Live incidents from the alerts data ONLY.
4. Explaining the platform's external integrations, webhooks and workers (Oracle BSS, Nafath, Semati, payments gateways, couriers …) FROM the INTEGRATIONS runbook sections in the context.
5. Error-case analysis: when the user gives a trace id / request id (the "Device ID" shown in the app's error dialog), CONTEXT contains case_analysis with the matching backend error events.
IF case_analysis IS PRESENT IN CONTEXT, NEVER refuse — this is always in scope. Answer with: what happened (known_case.title + explanation if present, else the exception/message), how many occurrences and when (first/last), the failing endpoint and code frame, and the recommended action (known_case.action). If case_analysis.found is false, say no stored events matched and suggest checking the id or the api hosts' logs.
6. Partner and platform API DOCUMENTATION that has been imported into the knowledge base: Tap / UPG (the payment gateway — charges, refunds, tokens, webhooks, response codes, STC Pay / Apple Pay / mada / KNET rails), OTO and the other couriers, and the Salam selfcare API. Answering "what does this gateway code mean", "how does this endpoint work", "what does the webhook send" IS in scope.
7. A SPECIFIC PAYMENT: the agent pastes a payment reference (e.g. umoxmoh2zt4l), a gateway id (pay_… / chg_…) or a payment uuid. CONTEXT.payment then holds our record, every gateway attempt on that reference, the raw charge object and the official Tap code. NEVER ask the agent to supply data — it is already there. Answer with: what the customer tried (amount, rail, app), what the gateway answered (official code + message), whether MONEY WAS TAKEN (money_taken), how many attempts, and the next action. If payment.found is false, say the reference is not in our data and suggest checking it or searching Subscriber 360.
9. FIXED (FTTH / 5G home / SDA dealers / Salam Home app): CONTEXT.fixed_customer holds a Fixed customer's services, orders, recent attempts, error events and payments (read from the Operations Console data; identifiers masked); CONTEXT.fixed_issues holds the Fixed-side status for a window (KPIs, per-journey conversion, Nafath/Manafith, error categories, recent errors, data freshness). Answer Fixed questions from these only; if a Mobile customer also has fixed_customer, mention both businesses.
8. SMS / OTP HISTORY for one customer: the agent asks "SMS details 9665…", "did he receive the OTP", "رسائل". CONTEXT.sms then holds every OTP message the platform recorded for that number — when it was sent, the message type, the template text, whether the customer entered the code and how long it took. Answer from it directly. Three things must be stated correctly and never blurred:
  · ONLY OTP messages exist as records. Order, delivery and campaign SMS are sent fire-and-forget with no row written — if asked about those, say the platform keeps no record rather than implying none were sent.
  · A message type shown as "not recorded" is NOT a fault: the type lives in the app cache for 10 minutes only, so anything older simply cannot be identified. Where type_source is "inferred", say it was deduced from surrounding activity, not recorded.
  · NEVER reveal or guess a verification code. The code is deliberately absent from the context.
  A number that received 3+ OTPs in a short span usually means NON-DELIVERY (the customer kept requesting a new code because none arrived), not that they mistyped.
10. CST (the regulator, هيئة الاتصالات): CONTEXT.cst_complaints holds the complaints CST raised on this customer, read live from Remedy/ARSystem — REQ number, when it was created, whether it is still open and for how long, status and category. Lead with an OPEN complaint whenever there is one: the agent is about to speak to a customer the regulator already has a case on, and a complaint past day five is the escalation the whole CST engagement turns on. CONTEXT.cst_services, when present, is what CST is SHOWN for this identity (mobile and fixed services with package and outstanding bill) — it appears only when the question asked about services or CST, because each one is a real call to the regulator-facing endpoint. Where the two disagree — a complaint about a service CST is not shown, or a service with no complaint — say so plainly; that disagreement is the finding, not an error.
IF THE CONTEXT CONTAINS kb SECTIONS THAT ANSWER THE QUESTION, NEVER REFUSE — answer from them and cite the doc section. Refusing while quoting sources is always wrong.
Anything else (project features, console development, documentation status, general questions) → reply exactly: "That's outside my scope — I only help with customer journeys, integrations and troubleshooting. Ask me about a subscriber, a failed step, an integration, or an open incident."
Rules:
- Answer ONLY from the CONTEXT provided. If the context doesn't contain the answer, say so and suggest where to look in the console.
- "Open incidents" means the open_alerts data — NEVER lists found in runbook text. If open_alerts is present and empty, say there are no open incidents.
- Each incident carries trigger_codes (which error codes/conditions define that alert) and alert_class (business = the API answered "no" · technical = the platform failed to answer). When asked why an alert fired or what it means, QUOTE the trigger_codes verbatim and state the class. If trigger_codes is empty, say it is not documented yet rather than guessing codes.
- CUSTOMER NAME: every answer about a customer STARTS with the customer's full name when the context has it (customer.identity.customer_name for Mobile, fixed_customer.customer_name for Fixed) — e.g. "Abdullah Ilyas — Mobile, Visitor 52, order at payment step". If the name is masked ("Abdullah …") show it as given; if absent say "name not on file".
- Masked values like 05*****290 are intentional PII masking — never try to guess them.
- When a subscriber has failed steps, explain the most likely cause in plain words, quote the relevant response/error from the trace, and give the next troubleshooting step.
- ACTIVE vs ATTEMPTED: customer.service_lines lists the lines the customer actually HOLDS (app account / activation / MNP / BSS). customer.lines are onboarding ATTEMPTS (many are abandoned checkouts in state "payment"). NEVER say a customer has "no active line" or "none activated" when service_lines.count > 0 — say which line(s) are active and, separately, that N attempts exist. If service_lines is empty AND live_bss is "not configured", say the live inventory is unavailable rather than concluding the customer has nothing. For Fixed: fixed_customer.inventory.services is what the customer HAS in the fixed BSS (account e.g. FTTH09071297, plan, state active/suspended, since, owed amount) — answer "does he have FTTH / is it active / which plan / what does he owe" from it, quoting tier (live vs recorded as_of date). fixed_customer.services are journey records (orders attempted through the app/dealers) — a different thing; a customer can have an active FTTH with zero journeys, or 20 journeys and no service. When inventory.available is false, say the BSS inventory is unavailable and why — never conclude "no Fixed service" from the journeys alone.
- The customer pack includes 'recent_failures' — a scan of THIS subscriber's failed / stuck payments, activation, eligibility, delivery, etc. over recent months. If it is non-empty, ALWAYS surface it (category · date · reason, most recent first) and explain the likely cause. NEVER answer "no incidents" / "all clear" for a subscriber whose recent_failures is non-empty. A subscriber's recent_failures are SEPARATE from open metric incidents (open_alerts) — a subscriber can have real failures while there are zero open incidents; state both correctly and don't conflate them.
- The customer pack may include 'cst_tickets' — CST / ServiceNow incidents that name THIS subscriber (number, priority, state, title). If present, ALWAYS cite them prominently by number + state (e.g. "Open CST ticket INC0014074 (P2) — login issue"). These are authoritative support tickets; they, recent_failures, and open metric incidents are three different things — report each accurately.
- The context may include 'osb_customer' — imported OSB/BSS archive evidence for THIS subscriber. If summary.journey_stories exists, name the useful story first (recharge, MNP, onboarding/inventory, Remedy, invoice, balance/profile). If summary.faults > 0, mention the OSB fault kind and component. If only direct_backend_hits exist, say BSS saw direct access-log reads but no payload record was joined. If the archive window does not cover the customer journey, say so. Always state the Digital/APIGW trace limitation when asked about correlation.
- If the pack has existing_no_onboarding=true, this is an EXISTING subscriber (recharge / plan upgrade / etc.) with no onboarding order in the console's data. Say so briefly, then report recent_failures and cst_tickets. Do NOT reply "subscriber not found".
- Eligibility means Semati + Nafath (CITC) checks. Payments use UPG/Tap; payment status 'fail' means failed.
- TWO DIFFERENT CODE SPACES SHARE THE SAME NUMBERS — never mix them:
  · Tap / UPG gateway codes are POSITIVE 3-digit (000 Captured, 301 Abandoned, 401 Failed, 505 Declined Insufficient Funds, 506 Declined Transaction Type Not Supported, 801 Timed Out) and 4-digit bad-request codes (1xxx/2xxx). They come from the payment gateway; context provides them as tap_codes / TAP_API_DOCS.
  · Salam app error codes are NEGATIVE (-506 PLAN_OPTION_NO_UPDATE, -704 rate limit, -501 …) and come from our own backend.
  If the question mentions Tap, UPG, gateway, charge, refund, card, mada, STC Pay or Apple Pay → use the Tap table. If it mentions our app, a screen, a subscriber or a trace id → use the Salam catalog. If it is genuinely ambiguous (a bare number), give BOTH in two labelled lines and ask which system they mean.
- Tap's own taxonomy is useful when triaging: 401/408/513/801 are platform faults (technical); 4xx card problems, 5xx declines and 7xx restrictions are customer/bank outcomes (business); 402/403/506 and the 11xx family mean WE sent something the gateway rejected or a switch is disabled (configuration — fixable by engineering, not by the customer).
- 'past_cases' are problems THIS TEAM already solved (saved from 👍-rated answers; identifiers masked). If one matches the current question, follow and cite its resolution ("we solved a similar case: …") — it reflects proven local practice. Ignore cases that don't actually match.
- Keep answers under 150 words. Use short bullet lines when listing steps.`;

/* One line per Fixed service / journey — shared by the customer and fixed_customer fallbacks. */
function fixedLines(f) {
  if (!f || !f.found) return '';
  const inv = f.inventory && f.inventory.tier ? f.inventory : null;
  const invLines = inv ? [`Fixed services in BSS (${inv.tier}${inv.as_of ? ', as of ' + String(inv.as_of).slice(0, 10) : ''}): ${inv.services.length} — ` + (inv.services.length ? '' : 'none'),
    ...inv.services.map(x => `• ${x.account || '?'} · ${x.plan || x.offer || ''}${x.speed_mbps ? ' · ' + x.speed_mbps + ' Mbps' : ''} · ${x.state || '—'}${x.since ? ' since ' + x.since : ''}${x.provider ? ' · ' + x.provider : ''}${x.owed_sar != null ? ' · owed ' + x.owed_sar + ' SAR' : ''}`)] : [];
  if (inv) { const rest = fixedLinesJourneys(f); return invLines.concat(rest ? ['Journeys in the Fixed console:', rest] : []).join('\n'); }
  return fixedLinesJourneys(f);
}
function fixedLinesJourneys(f) {
  const svc = (f.services || []).map(x => `• ${x.service || '(no service no)'} · ${x.journey || ''}${x.plan ? ' · ' + x.plan : ''} · ${x.status || '—'}${x.step ? ' @ ' + x.step : ''}${x.channel ? ' · ' + x.channel : ''}${x.dealer ? ' · dealer ' + x.dealer : ''}${x.started ? ' · ' + String(x.started).slice(0, 10) : ''}`);
  if (!svc.length && (f.recent_attempts || []).length) svc.push(...f.recent_attempts.slice(0, 5).map(a => `• ${a.journey || ''} · ${a.status || '—'}${a.step ? ' @ ' + a.step : ''}${a.order ? ' · order ' + a.order : ''} · ${String(a.when || '').slice(0, 10)}`));
  const head = f.customer ? `${f.customer.services || 0} service(s), ${f.customer.orders || 0} order(s), ${f.customer.attempts || 0} journey attempt(s)` : '';
  const er = (f.errors || []).slice(0, 3).map(e => `  ⚠ ${e.category || ''}${e.code ? ' ' + e.code : ''}: ${e.message || ''}`);
  return [head, ...svc, ...(er.length ? ['  Recent Fixed errors:', ...er] : [])].filter(Boolean).join('\n');
}
/* VERIFIED FACTS — what the customer HAS, computed deterministically from the packs. Goes FIRST in the model
 * context and is PREPENDED to the reply for identity lookups, so the LLM can narrate but never contradict
 * (5 Sep: the model read 3 app-account lines + 13 onboarding attempts as "three lines, none activated"). */
function identityFacts(ctx) {
  const L = [];
  const c = ctx.customer, sl = c && c.service_lines;
  /* THE NAME FIRST (25 Sep 2026): deterministic, never left to the model — Mobile from the order / checkout / app
   * account, Fixed from the BSS custName. Masked form ("Mohamed …") when the asker may not unmask. */
  const nm = (c && c.found && c.identity && c.identity.customer_name) || (ctx.fixed_customer && ctx.fixed_customer.found && ctx.fixed_customer.customer_name) || null;
  if ((c && c.found) || (ctx.fixed_customer && ctx.fixed_customer.found)) L.push(nm ? `👤 **${nm}**` : '👤 Name not on file');
  if (c && c.found) {
    if (sl && (sl.lines || []).length) L.push(`📱 Mobile — ${sl.lines.length} active line(s): ` + sl.lines.map(l => `${l.msisdn} (${l.source}${l.since ? ', since ' + l.since : ''})`).join(', ')
      + (sl.primary_line_bss && sl.primary_line_bss.plan ? ` · BSS plan ${sl.primary_line_bss.plan}${sl.primary_line_bss.status ? ' · ' + sl.primary_line_bss.status : ''}` : ''));
    else L.push(`📱 Mobile — no active line resolved${sl && /not configured/.test(sl.live_bss || '') ? ' (live BSS not configured here)' : ''}`);
    const att = (c.lines || []).length; if (att) L.push(`   ${att} onboarding attempt(s) on record (${(c.lines || []).filter(l => l.completed || l.activated).length} completed) — attempts, not the inventory`);
  } else if (c && c.found === false) L.push('📱 Mobile — no customer for this key');
  const f = ctx.fixed_customer;
  if (f && f.found) {
    const inv = f.inventory && f.inventory.tier ? f.inventory : null;
    if (inv) {
      const act = inv.services.filter(x => x.state === 'active');
      L.push(`🏠 Fixed — ${act.length} active service(s) in BSS (${inv.tier}${inv.as_of ? ', as of ' + String(inv.as_of).slice(0, 10) : ''})${inv.services.length > act.length ? `, ${inv.services.length - act.length} other` : ''}:`);
      inv.services.forEach(x => L.push(`   • ${x.account || '?'} · ${x.plan || x.offer || ''}${x.speed_mbps ? ' · ' + x.speed_mbps + ' Mbps' : ''} · ${x.state || '—'}${x.since ? ' since ' + x.since : ''}${x.provider ? ' · ' + x.provider : ''}${x.owed_sar != null ? ' · owed ' + x.owed_sar + ' SAR' : ''}`));
      if ((inv.open_bss_orders || []).length) L.push(`   ${inv.open_bss_orders.length} open BSS order(s)`);
    } else L.push(`🏠 Fixed — BSS inventory unavailable${f.inventory && f.inventory.reason ? ' (' + f.inventory.reason + ')' : ''}; ${f.customer ? f.customer.attempts + ' journey attempt(s) in the Fixed console' : ''}`);
    if (inv && f.customer && f.customer.attempts) L.push(`   ${f.customer.attempts} Fixed journey attempt(s) (${f.customer.orders || 0} order(s)) — journeys, not the inventory`);
  } else if (f && f.found === false && ctx.customer && ctx.customer.found) L.push(`🏠 Fixed — no Fixed journey or BSS record linked to this identity${f.hint ? ' (' + f.hint + ')' : ''}`);
  const os = ctx.osb_customer && ctx.osb_customer.summary;
  if (os && (os.pipeline_records || os.backend_hops || os.direct_backend_hits)) {
    const stories = (os.journey_stories || []).slice(0, 3).map(s => `${s.label} ${s.records}${s.faults ? ' faults ' + s.faults : ''}`).join(', ');
    L.push(`OSB/BSS archive — ${os.pipeline_records || 0} pipeline record(s), ${os.backend_hops || 0} ECID backend hop(s), ${os.direct_backend_hits || 0} direct backend hit(s), ${os.faults || 0} fault(s)${os.first_seen ? ' · ' + String(os.first_seen).slice(0, 10) + ' → ' + String(os.last_seen || os.first_seen).slice(0, 10) : ''}`);
    if (stories) L.push(`   OSB stories: ${stories}`);
    L.push('   Correlation note: OSB-internal ECID joins are exact when present; Digital/APIGW trace id is not present in the current OSB archive.');
  }
  return L.join('\n');
}
function fallbackAnswer(intent, ctx, hint) {
  if (intent === 'smalltalk') return 'أهلاً! I\'m Yusr — I can look up a customer on Mobile (MSISDN 05xxxxxxxx or National ID) or Fixed (FTTH account, order number, customer code), check open incidents on either side ("fixed issues today"), search a log reference ID, or search the runbooks. How can I help?';
  if (intent === 'customer') {
    const fx = fixedLines(ctx.fixed_customer);
    /* the regulator line goes first when there is one: it changes how the agent opens the call */
    const cc = ctx.customer && ctx.customer.cst_complaints;
    const cstLine = cc && cc.open ? `\u26a0 CST: ${cc.summary}${cc.complaints && cc.complaints[0] ? ` Latest ${cc.complaints[0].req || ''}${cc.complaints[0].status ? ' \u00b7 ' + cc.complaints[0].status : ''}.` : ''}\n` : '';
    if (!ctx.customer || ctx.customer.found === false) {
      const os = ctx.osb_customer && ctx.osb_customer.summary;
      if (os && (os.pipeline_records || os.direct_backend_hits)) {
        const osDate = os.first_seen ? ` · ${String(os.first_seen).slice(0, 10)} → ${String(os.last_seen || os.first_seen).slice(0, 10)}` : '';
        const osStory = (os.journey_stories || []).length ? `\n• Stories: ${(os.journey_stories || []).slice(0, 3).map(s => `${s.label} ${s.records}`).join(', ')}` : '';
        return `No Mobile onboarding profile for ${ctx.customerKey || 'that number/ID'}, but the OSB/BSS archive has evidence:\n` +
          `• ${os.pipeline_records || 0} pipeline record(s), ${os.backend_hops || 0} ECID backend hop(s), ${os.direct_backend_hits || 0} direct backend hit(s), ${os.faults || 0} fault(s)${osDate}` +
          `${osStory}\n(LLM offline — open Customer 360 → Live BSS → OSB for details. Digital/APIGW trace is not exact in the current archive.)`;
      }
      if (fx) return `No Mobile subscriber for ${ctx.customerKey || 'that number/ID'}, but the same person has Fixed services:\n${fx}\n(LLM offline — open Customer 360 → Fixed services for the full picture.)`;
      return 'I could not find a customer for that number/ID on Mobile or Fixed. Double-check the MSISDN (05xxxxxxxx), National ID, FTTH account or order number and try again.';
    }
    const c = ctx.customer;
    const sl = c.service_lines || {};
    const active = (sl.lines || []).length
      ? `📱 Active line(s): ` + sl.lines.map(l => `${l.msisdn} (${l.source}${l.since ? ', since ' + l.since : ''})`).join(', ')
        + (sl.primary_line_bss && sl.primary_line_bss.plan ? ` · BSS: ${sl.primary_line_bss.plan} ${sl.primary_line_bss.status || ''}` : '')
      : `📱 No active line resolved${sl.live_bss && /not configured/.test(sl.live_bss) ? ' (live BSS not configured here — replica sources only)' : ''}`;
    const lines = (c.lines || []).length ? `Onboarding attempts (${(c.lines || []).length}, not the inventory):\n` + (c.lines || []).map(l => `• ${l.mobile || '—'} — ${l.plan || 'no plan'} — state: ${l.state || l.status || '—'} (${l.sim || ''} ${l.line_type || ''})`).join('\n') : 'No onboarding attempts on record.';
    const rf = c.recent_failures || [];
    const stepFails = (c.recent_events || []).filter(e => e.ok === false);
    let failTxt;
    if (rf.length) failTxt = `\n⚠ ${rf.length} recent failure(s) for this subscriber:\n` + rf.slice(0, 5).map(e => `• ${e.category} · ${String(e.when || '').slice(0, 10)} · ${e.detail || 'failed'}`).join('\n');
    else if (stepFails.length) failTxt = `\nRecent failed steps:\n` + stepFails.slice(-3).map(e => `• ${e.source}${e.step ? ' / ' + e.step : ''}: ${e.error || 'failed'}`).join('\n');
    else failTxt = `\nNo recent failures found for this subscriber.`;
    const tix = c.cst_tickets || [];
    const tixTxt = tix.length
      ? `\nCST tickets:\n` + tix.slice(0, 4).map(t => `• ${t.number}${t.priority ? ` (${t.priority})` : ''} — ${t.title || ''} [${t.state || ''}]`).join('\n')
      : (c.cst_configured === false ? '' : '\nNo linked CST tickets.');
    const os = ctx.osb_customer && ctx.osb_customer.summary;
    const osStories = os && (os.journey_stories || []).length ? ` Stories: ${(os.journey_stories || []).slice(0, 3).map(s => `${s.label} ${s.records}${s.faults ? ' faults ' + s.faults : ''}`).join(', ')}.` : '';
    const osbTxt = os ? `\nOSB/BSS archive: ${os.pipeline_records || 0} pipeline record(s), ${os.backend_hops || 0} ECID backend hop(s), ${os.direct_backend_hits || 0} direct backend hit(s), ${os.faults || 0} fault(s)` +
      (os.first_seen ? ` · ${String(os.first_seen).slice(0, 10)} → ${String(os.last_seen || os.first_seen).slice(0, 10)}` : '') + `.${osStories} Digital/APIGW trace is not exact in the current OSB archive.` : '';
    const note = c.existing_no_onboarding ? ' (existing subscriber — no onboarding order in the console)' : '';
    const fxTxt = fx ? `\n🏠 Fixed services for the same person:\n${fx}` : (db.opsConfigured ? '\n🏠 No Fixed services found for this person.' : '');
    const nm = c.identity && c.identity.customer_name ? `👤 ${c.identity.customer_name}\n` : '';
    return cstLine + nm + `Mobile subscriber found${note}.\n${active}\n${lines}${failTxt}${tixTxt}${osbTxt}${fxTxt}\n(LLM offline — showing raw profile. Open Customer 360 for the full timeline.)`;
  }
  /* SMS answers must survive the LLM being offline — this is a support question asked under
   * time pressure, and the facts are already assembled. */
  if (intent === 'sms') {
    const s = ctx.sms;
    if (!s || !(s.messages || []).length) return 'No OTP messages are recorded for that number or ID. Note that only OTP messages are stored — order, delivery and campaign SMS are sent without any record being written.';
    const T = s.totals || {};
    const L = [`SMS history for ${s.msisdn} — ${T.total} OTP message(s): ${T.verified} verified, ${T.expired} never entered${T.avg_verify_sec != null ? `, average ${T.avg_verify_sec}s to enter the code` : ''}.`];
    s.messages.slice(0, 6).forEach(m => L.push(
      `• ${String(m.sent).replace('T', ' ').slice(0, 16)} — ${m.type} — ${m.outcome}${m.seconds_to_enter != null ? ` (${m.seconds_to_enter}s)` : ''}`));
    if (s.messages.some(m => m.type === 'not recorded')) L.push('Message types shown as "not recorded" are older than 10 minutes — the type is kept in the app cache for that long only.');
    L.push('(Verification codes are never shown.)');
    return L.join('\n');
  }
  if (intent === 'payment') {
    const p = ctx.payment;
    if (!p || !p.found) return `I could not find a payment for "${(p && p.key) || 'that reference'}". Check the reference, or open Subscriber 360 and use the payments tab.`;
    const r = p.payment || {};
    const last = (p.upg_attempts || [])[(p.upg_attempts || []).length - 1];
    const L = [];
    L.push(`Payment ${r.payment_reference_id || p.key} — ${r.status || '?'} · ${r.amount != null ? r.amount + ' SAR' : ''} · ${r.rail || r.method || ''} · ${r.platform || ''}`.trim());
    if (last) L.push(`Gateway: ${last.status} — ${last.acquirer_message || '(no acquirer message)'}${last.code ? ' (code ' + last.code + ')' : ''}`);
    if (p.tap_code) L.push(`Official meaning: ${p.tap_code.code} · ${p.tap_code.official_message} → ${p.tap_code.class}`);
    if (p.attempts) L.push(`Attempts at the gateway: ${p.attempts}`);
    L.push(p.money_taken ? '⚠ The gateway shows the money WAS captured — reconcile with the app record.' : 'No money was taken.');
    return L.join('\n') + '\n(LLM offline — raw payment facts.)';
  }
  if (intent === 'fixed_customer') {
    const f = ctx.fixed_customer || {};
    if (!f.found) {
      const mob = ctx.customer && ctx.customer.found ? ' The Mobile side is there (see Customer 360), but no Fixed journey is linked to this identity in the last 24 months.' : '';
      return `No Fixed services found for ${ctx.fixedKey || 'that key'}${f.hint ? ' (' + f.hint + ')' : ''}.${mob}\nWhat I can search: FTTH account (FTTH…), BSS order number, customer code, National ID or mobile (linked through the Salam Home journeys). Live BSS inventory is not wired yet — Customer 360 → Fixed services shows the journeys.`;
    }
    return `${f.customer_name ? '👤 ' + f.customer_name + '\n' : ''}🏠 Fixed customer ${f.customer && (f.customer.cust_code || f.customer.customer_id) || ctx.fixedKey}: ${fixedLines(f)}\n(LLM offline — open Customer 360 → Fixed services for the full picture.)`;
  }
  if (intent === 'fixed_issues') {
    const f = ctx.fixed_issues || {};
    if (f.error) return `I could not read the Fixed data (${f.error}).`;
    const k = f.kpis || {}; const cats = (f.error_categories || []).slice(0, 4).map(c => `• ${c.category}: ${c.open} open / ${c.n}`).join('\n');
    return `Fixed · last ${f.window}: ${k.attempts} attempts, ${k.completed} completed (${k.conversion}%), ${k.activeDealers} active dealers${f.nafath && f.nafath.total ? `, Nafath fail ${f.nafath.failRate}%` : ''}${f.freshness && f.freshness.stale ? ' — ⚠ data may be stale' : ''}.\nOpen error categories:\n${cats}\n(LLM offline — open Fixed → Errors for the board.)`;
  }
  if (intent === 'alerts') {
    const a = ctx.alerts || {};
    if (!a.open_count) return 'No open incidents right now. All quiet ✅';
    const top = (a.incidents || []).slice(0, 5).map(i => `• [${i.severity}] ${i.name} (${i.team || '—'})`).join('\n');
    return `${a.open_count} open incident(s):\n${top}\n(LLM offline — open the Alerts board for details.)`;
  }
  const kb = ctx.kb || [];
  if (!kb.length) return 'I could not find anything in the runbooks for that. Try rephrasing, or check the Ops Runbook / error-codes catalog in the console.';
  // knowledge answers are the ones most hurt by a missing LLM — show the sections we WOULD have
  // summarised, the reason it failed, and a first line of the best section so the answer is not empty
  const top = kb[0];
  return `I found the answer in the docs but could not summarise it — ${hint || 'the language model is offline'}.\n\n` +
    (top ? `From ${top.doc} › ${top.title}:\n${String(top.text || '').split('\n').filter(Boolean).slice(0, 6).join('\n').slice(0, 700)}\n\n` : '') +
    'Other matching sections:\n' + kb.slice(top ? 1 : 0).map(k => `• ${k.doc} › ${k.title}`).join('\n');
}

function suggestionsFor(intent, ctx) {
  if (intent === 'customer' && ctx.customer && ctx.customer.found) {
    if (ctx.customer.cst_complaints && ctx.customer.cst_complaints.open) return ['What is the open CST complaint about?', 'What services is CST shown for this customer?', 'Why did the last attempt fail?'];
    return ctx.fixed_customer && ctx.fixed_customer.found
      ? ['Why did the last step fail?', 'Show the fixed services for this customer', 'Show payment history']
      : ['Why did the last step fail?', 'Show payment history', 'Is this subscriber eligible?'];
  }
  if (intent === 'payment') return ['What does that gateway code mean?', 'Did the customer retry?', 'Was the money taken?'];
  if (intent === 'fixed_customer') return ['Why did the last attempt stop?', 'Which dealer handled it?', 'Any payment for this service?'];
  if (intent === 'fixed_issues') return ['Which region has most Nafath failures?', 'Top FTTH errors this week', 'Is the Fixed data live?'];
  if (intent === 'alerts') return ['Which incident is most severe?', 'What is the runbook for payment stuck?', 'Show SLO status'];
  if (intent === 'smalltalk') return ['Check subscriber 05… ', 'What incidents are open?', 'How do I handle a stuck UPG payment?'];
  return ['What incidents are open?', 'How do I handle a stuck UPG payment?', 'Why would eligibility fail?'];
}

function actionsFor(intent, ctx) {
  const acts = [];
  if (intent === 'customer' && ctx.customer && ctx.customer.found && ctx.customerKey) {
    acts.push({ label: 'Open Customer 360', href: '#sub360?key=' + encodeURIComponent(ctx.customerKey) });
    if (ctx.fixed_customer && ctx.fixed_customer.found) acts.push({ label: '🏠 Fixed services', href: '#sub360?key=' + encodeURIComponent(ctx.customerKey) + '&tab=fixed' });
    if (ctx.osb_customer && ctx.osb_customer.summary) acts.push({ label: 'OSB/BSS archive', href: '#sub360?key=' + encodeURIComponent(ctx.customerKey) + '&tab=diag' });
  }
  if (intent === 'fixed_customer' && ctx.fixed_customer && ctx.fixed_customer.found && ctx.fixedKey) {
    acts.push({ label: 'Open Customer 360 → Fixed', href: '#sub360?key=' + encodeURIComponent(ctx.fixedKey) + '&tab=fixed' });
  }
  if (intent === 'payment' && ctx.payment && ctx.payment.found) acts.push({ label: 'Open payments dashboard', href: '#dashboard' });
  /* TKT-000008: "while searching on SMS, add link after results" — every SMS/OTP answer carries
   * deep links to the full views. Key = what the agent typed (customerKey) first — a MASKED
   * msisdn must never round-trip through a link (house PII law); raw ctx.sms.msisdn only as
   * fallback (it came from the agent's own query). */
  if (intent === 'sms' && ctx.sms && (ctx.sms.messages || []).length) {
    const k = ctx.customerKey || ctx.sms.msisdn;
    if (k && !String(k).includes('*'))
      acts.push({ label: '✉ Full SMS details — Customer 360', href: '#sub360?key=' + encodeURIComponent(k) });
    acts.push({ label: 'SMS gateways health', href: '#monitoring?tab=sms' });
  }
  if (intent === 'alerts') acts.push({ label: 'Open Alerts board', href: '#alerts' });
  if (intent === 'knowledge') acts.push({ label: 'Error Control Board', href: '#errors' });
  return acts;
}

/* ------------------------------ main entry ------------------------------ */
async function chat({ message, history, allowUnmask, business, actor }) {
  const cfg = await getConfig();
  const q = String(message || '').slice(0, 1000).trim();
  if (!q) return { error: 'empty message' };
  if (!cfg.enabled) return { error: 'Assist is disabled in Settings.' };

  await ensureDocChunks();   // refresh uploaded-doc KB chunks (5-min cache) before any searchKb below

  let intent = detectIntent(q);
  const ctx = {};
  // Business scope (6 Sep 2026): Yusr answers inside the caller's business. A Fixed-team user asking about a
  // National ID / mobile is routed to the Fixed customer lookup; Mobile-only intents (SMS, payments, checkout,
  // Mobile alerts) are declined with a scope note. A Mobile-team user never triggers a Fixed lookup.
  const biz = (business === 'mobile' || business === 'fixed') ? business : 'both';
  ctx.business = biz;
  if (biz === 'fixed') {
    const MOBILE_ONLY = new Set(['sms', 'payment', 'checkout', 'logref', 'alerts']);
    if (intent === 'customer') { const id = extractIdentifier(q); if (id) { intent = 'fixed_customer'; ctx.fixedKey = id; } }
    if (MOBILE_ONLY.has(intent)) return { intent: 'scope', reply: 'That question is on the **Mobile** side, which is outside your team scope (Fixed). I can look up a Fixed customer (FTTH account, order number, customer code, National ID) or explain FTTH / 5G home errors.', suggestions: ['Check FTTH09071297', 'Top FTTH errors this week', 'Is the Fixed data live?'], actions: [], sources: [], degraded: false };
  } else if (biz === 'mobile') {
    if (intent === 'fixed_customer' || intent === 'fixed_issues') return { intent: 'scope', reply: 'That question is on the **Fixed** side (FTTH / 5G home), which is outside your team scope (Mobile). Ask me about a subscriber (MSISDN / National ID), a payment, an SMS or an open incident.', suggestions: ['Check subscriber 05…', 'What incidents are open?', 'How do I handle a stuck UPG payment?'], actions: [], sources: [], degraded: false };
  }

  // Follow-up on the customer/service from a previous turn (no key in this question)
  if (!extractIdentifier(q) && !extractFixedKey(q) && !extractPaymentKey(q)) {
    const last = lastKeyFromHistory(history);
    if (last && (isFixedAsk(q) || FOLLOWUP_REF.test(q))) {
      if (isFixedAsk(q) && !FIXED_ISSUE_WORDS.test(q.replace(/\b(status|open|now|today)\b/gi, ''))) { intent = 'fixed_customer'; ctx.fixedKey = last.key; ctx.followup = true; }
      else if (isFixedAsk(q) && last.kind !== 'identifier') { intent = 'fixed_customer'; ctx.fixedKey = last.key; ctx.followup = true; }
      else if (!isFixedAsk(q) && last.kind === 'identifier') { intent = 'customer'; ctx.customerKey = last.key; ctx.followup = true; }
    } else if (!last && isFixedAsk(q) && FOLLOWUP_REF.test(q)) {
      return { intent: 'fixed_customer', reply: 'Which customer? Paste the **FTTH account** (FTTH…), the BSS **order number**, the **customer code**, or the **National ID / mobile** and I will pull the Fixed services and journeys.',
        suggestions: ['Fixed issues today', 'Check subscriber 05…'], actions: [], sources: [], degraded: false };
    }
  }

  /* CHECKOUT / GATEWAY-REF lookup (Yosri, 2 Sep): "checkout 2wk2wrk2" (the CMS admin Order ID),
   * a bare checkout uuid, or a gateway reference (chg_…/pay_…/UPG invoice id) → the FULL picture,
   * deterministically: checkout state, every payment attempt with its gateway ref, and where to
   * drill next. Masked like everything else. */
  /* DMS LOG-REFERENCE search (Phase 2, 3 Sep) — GUIDED, STATELESS flow: the suggestion chips
   * carry the full next command, so no conversation state is needed.
   *   1. "search a log reference" (chip / bare keyword, no id) → ask for the reference
   *   2. a BARE 16-hex message → ask for the DATE, chips = ready-made full commands
   *   3. "logref <id> [date|current only]" → run the search (quick mode: UIL-first,
   *      first-match-per-node early exit — chat wants the verdict, the drawer has the full view) */
  try {
    const glg = require('./dmsLogGrep');
    const ksaDay = off => new Date(Date.now() + 3 * 3600e3 - off * 864e5).toISOString().slice(0, 10);
    const qt = String(q || '').trim();
    if (glg.configured() && /\blog\s*ref/i.test(qt) && !/[0-9a-f]{16}|[0-9a-f-]{36}/i.test(qt)) {
      return { intent: 'logref', reply:
        'Paste the **log reference ID** — the 16-character code from the customer\'s error dialog / ticket '
        + '(e.g. `91d51389c6ffd37e`), or a UIL transaction UUID. I\'ll search the DMS application nodes for it.',
        suggestions: [], actions: [] };
    }
    if (glg.configured() && /^[0-9a-f]{16}$/i.test(qt)) {
      const id = qt.toLowerCase();
      return { intent: 'logref', reply:
        `Got it — \`${id}\`. **When was the request?** Current logs cover only the last few hours; `
        + `for anything older I deep-search that day's rotated logs (~1–2 min, retention ≈ 7 days). Pick one:`,
        suggestions: [`logref ${id} ${ksaDay(0)}`, `logref ${id} ${ksaDay(1)}`, `logref ${id} current only`,
                      `logref ${id} ${ksaDay(2)}`], actions: [] };
    }
    const lrm = /\blog\s*ref(?:erence)?(?:\s*id)?[\s:#=]*([0-9a-f]{16}|[0-9a-f-]{36})\b/i.exec(q || '');
    if (lrm && glg.configured()) {
      let dm = /\b(20\d\d-\d\d-\d\d)\b/.exec(q || '');
      if (!dm && /\btoday\b/i.test(q)) dm = [null, ksaDay(0)];
      if (!dm && /\byesterday\b/i.test(q)) dm = [null, ksaDay(1)];
      const r = await glg.search(lrm[1], { date: dm ? dm[1] : null, quick: true });
      if (!r.ok) return { intent: 'logref', reply: `Log-reference search: ${r.error}`, suggestions: [], actions: [] };
      let reply, sugs = ['Open Troubleshoot'];
      if (!r.total_hits) {
        reply = `**Log reference \`${r.ref}\`** — no match in the ${r.date ? `current logs + rotated files of ${r.date}` : 'current logs'} on the DMS nodes.\n` +
          (r.date ? 'Retention is ~7 days — if the request is older, the log is gone; correlate via the customer timeline instead.'
                  : 'Current logs cover only the last few hours — pick the request date for a deep search:');
        if (!r.date) sugs = [`logref ${r.ref} ${ksaDay(0)}`, `logref ${r.ref} ${ksaDay(1)}`, `logref ${r.ref} ${ksaDay(2)}`];
        else sugs = [];
      } else {
        const hop = (r.hops || []).find(h => h.kind === 'uil-call') || (r.hops || [])[0] || {};
        const files = r.hosts.flatMap(h2 => (h2.files || []).map(f => `${h2.host.split('.').pop()}·${f.service}`));
        reply = `**Log reference \`${r.ref}\`**${r.cached ? ' ⚡(cached)' : ''} — FOUND: ${r.total_hits} line(s) in ${files.join(', ')}\n` +
          (hop.url ? `Call: \`${String(hop.url).replace(/^https?:\/\/[^/]+/, '')}\` → **${hop.response_code || hop.status || '?'}${hop.response_message ? ' ' + hop.response_message : ''}** in ${hop.ms || '?'} ms\n` : '') +
          ((r.uil_transaction_ids || []).length ? `UIL transaction id: \`${r.uil_transaction_ids[0]}\` (paste in Troubleshoot search for the gateway ⇄ uil_logs tiers)\n` : '') +
          `Full hop table + raw lines: search the reference in Subscriber 360 / Troubleshoot and use the ⛏ DMS logs panel.`;
      }
      if (r.errors) reply += `\n⚠ ${r.errors.join(' · ')}`;
      return { intent: 'logref', reply, suggestions: sugs, actions: [] };
    }
  } catch (e) { /* fall through */ }

  try {
    const ckm = /\bcheckout[\s:#=]*([a-z0-9-]{6,36})\b/i.exec(q || '');
    const gwm = /\b((?:chg|pay)_[\w]{6,40})\b/i.exec(q || '');
    const d8 = s2 => String(s2 || '').replace('T', ' ').slice(0, 16);
    const mask = v => { const t = String(v || ''); return t.length > 3 ? '*'.repeat(Math.max(3, t.length - 3)) + t.slice(-3) : t; };
    const payLine = p2 => `· ${d8(p2.created_at)} · ${p2.amount} SAR · **${p2.status}** · ${p2.vendor || '—'}/${p2.payment_method || '—'}` +
      ` · gw ref \`${p2.payment_reference_id || '—'}\`${p2.fail_reason ? ` · ${String(p2.fail_reason).slice(0, 60)}` : ''}`;
    if (ckm) {
      const ck = await require('./checkoutLookup').checkoutFull(ckm[1]);
      if (ck.found) {
        const c = ck.checkout;
        let reply = `**Checkout \`${c.code}\`** — ${c.type} · state **${c.state}** · paid **${c.paid ? 'YES' : 'NO'}** · completed **${c.completed ? 'YES' : 'NO'}**\n` +
          `Created ${d8(c.created_at)}${c.completed_at ? ` · completed ${d8(c.completed_at)}` : ''} · customer ${mask(c.mobile_number) || '—'}` +
          `${c.for ? ` · for ${c.for}` : ''}${c.items_summary.length ? `\nItems: ${c.items_summary.join(' · ')}` : ''}\n\n` +
          `**Payment attempts (${ck.payments.length})**\n` +
          (ck.payments.length ? ck.payments.map(payLine).join('\n') : '· none — the customer never reached the gateway') +
          `\n\nDrill: Subscriber 360 → search the customer, or paste a gw ref here for the Tap/UPG side. CMS: ${c.admin_url}`;
        return { intent: 'checkout', reply, suggestions: ['Open Subscriber 360', c.mobile_number ? 'Full timeline for this customer' : 'Search by order id'],
                 actions: [] };
      }
      return { intent: 'checkout', reply: `No checkout matches \`${ckm[1]}\` — check the Order ID column in the CMS admin (proxy.salammobile.sa/admin/checkouts).`, suggestions: [], actions: [] };
    }
    if (gwm) {
      const g = await require('./checkoutLookup').byGatewayRef(gwm[1]);
      if (g.found) {
        let reply = `**Gateway reference \`${gwm[1]}\`** — ${g.payments.length} app payment row(s)\n` +
          g.payments.map(payLine).join('\n') +
          (g.parent ? `\n\nBelongs to checkout \`${g.parent.code}\` (${g.parent.type} · ${g.parent.state} · paid ${g.parent.paid ? 'YES' : 'NO'}) · ${g.parent.admin_url}` : '') +
          `\n\nThe gateway-side story (bank message, retries, webhooks) is one click away: Troubleshoot → Customer payments → ⇄ UPG, or the payment row in Subscriber 360.`;
        return { intent: 'checkout', reply, suggestions: ['Open Subscriber 360', 'Open Troubleshoot'], actions: [] };
      }
    }
  } catch (e) { /* fall through to normal handling */ }

  // Case analyzer: a 32-hex trace id or UUID in the question (the "Device ID" from the app's
  // error dialog, or a request_id) → inject the full diagnosis so Yusr answers the case directly.
  try {
    const tm = /\b([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(q || '')
      // transaction ids too — "txn 175544…" / "transaction id: …" joins app ⇄ APIGW ⇄ uil_logs
      || /(?:txn|transaction(?:\s*id)?)[\s:#=]*([\w.-]{6,64})/i.exec(q || '');
    if (tm) {
      const tc = await require('./traceCase').analyze(tm[1]);
      // Deterministic reply — the analysis is fully structured, so the LLM adds nothing here
      // (and the local 8B model tends to fall back to its "out of scope" canned line anyway).
      if (tc && tc.found) {
        const kb = tc.known_case;
        const d8 = s => String(s || '').replace('T', ' ').slice(0, 16);
        let reply = '';
        if (kb) reply += `**${kb.title}** · ${kb.classification}\n${kb.explanation}\n\n**Action:** ${kb.action}\n\n`;
        reply += `**Case ${tc.id.slice(0, 12)}…** — ${tc.occurrences} occurrence(s), first ${d8(tc.first_seen)} → last ${d8(tc.last_seen)} (UTC)` +
          `${tc.platform ? ` · ${tc.platform}${tc.app_version ? ' v' + tc.app_version : ''}` : ''}\n` +
          `Exception: ${(tc.exception_classes || []).join(', ') || '—'} · code(s) ${(tc.error_codes || []).join(', ')}\n` +
          `Endpoint: ${(tc.endpoints || []).join(' · ')}\n` +
          (tc.frames && tc.frames[0] ? `Code frame: ${tc.frames[0]}\n` : '') +
          (tc.sample_message ? `Message: ${tc.sample_message}` : '');
        if (tc.ip_block) {                       // -704: the full block story, settings-aware
          const b = tc.ip_block;
          reply += `\n\n**IP BLOCK DETAIL** (live settings: limit ${b.settings.ip_request_rate_limit} · session ${b.settings.ip_session_time}s · elapse ${b.settings.ip_elapse_time}s — ${b.settings.source})\n` +
            `Why blocked: **${b.condition}**\n${b.detail}\n` +
            (b.last_allowed_at ? `Last request that PASSED the gate: ${d8(b.last_allowed_at)} (outcome ${b.last_allowed_outcome})\n` : '') +
            `Block active since: ${d8(b.first_block_at)} · blocked attempts recorded: ${b.blocked_attempts}\n` +
            (b.auto_unblock_human ? `Auto-unblock: **${b.auto_unblock_human}**\n` : '') +
            (b.unblock_now ? `Unblock NOW: ${b.unblock_now}` : '');
        }
        if (tc.gateway) {                        // per-tier view of the same transaction
          const g = tc.gateway;
          if ((g.app || []).length) {
            reply += `\n\n**APP CALL (Digital API)**\n` + g.app.slice(0, 4).map(a =>
              `${String(a.ts).replace('T', ' ').slice(0, 19)} · ${a.path} → code ${a.response_code || '—'}` +
              `${a.duration_ms != null ? ` · ${a.duration_ms}ms` : ''}${a.response_message ? ` · ${String(a.response_message).slice(0, 90)}` : ''}`).join('\n');
          }
          if ((g.gateway && g.gateway.spans || []).length) {
            const sp = g.gateway.spans;
            reply += `\n\n**GATEWAY HOPS (APIGW)** — ${g.gateway.hops} hop(s), total ${g.gateway.total_ms}ms · ${g.gateway.source}\n` +
              sp.slice(0, 8).map(s =>
                `+${s.offset_ms}ms ${s.service}${s.kind ? ' [' + s.kind + ']' : ''} ${s.method || ''} ${s.path || ''} → ` +
                `${s.err ? 'ERROR ' + s.err : (s.status || 'ok')} · ${s.ms}ms`).join('\n') +
              (sp.length > 8 ? `\n… ${sp.length - 8} more hop(s) — open the Case analyzer for the full waterfall` : '');
          }
          if (g.uil && g.uil.ok && (g.uil.rows || []).length) {
            reply += `\n\n**UIL/OSB LOG** — ${g.uil.rows.length} row(s) with request/response payloads (open the Case analyzer to read them).`;
          }
        }
        return { intent: 'case', reply: reply.trim(),
          suggestions: ['Open Troubleshoot → Case analyzer for the full entry list', 'Raise a ticket with the customer screenshot attached'],
          actions: [], sources: [{ type: 'case_analysis', id: tc.id }], degraded: false };
      }
      if (tc && (tc.note || tc.error)) {
        return { intent: 'case',
          reply: `No stored backend events match ${tm[1].slice(0, 16)}… — ${tc.note || tc.error}\nDouble-check the id (it is the "Device ID" shown in the app's error dialog), or the event may predate the log history.`,
          suggestions: ['Paste the full error-dialog text — I extract the id automatically'], actions: [], sources: [], degraded: false };
      }
    }
  } catch (e) {}

  // Alert-rule lookup — "why did semati_flapping fire?" / "what triggers api_latency_breach?"
  // Deterministic: definition, TRIGGER CODES (L2 transparency), tuning and 14-day firing history.
  try {
    const looksLikeRule = /_/.test(q || '') || /\b(?:anomaly[:.])?[a-z_]+[:.](?:volume|failure_rate)\b/i.test(q || '');
    if (looksLikeRule && /\b(why|what|when|trigger|fire[sd]?|firing|define[sd]?|definition|condition|mean|كيف|لماذا)\b/i.test(q || '')) {
      const rc = await ruleContext(q);
      if (rc && rc.anomaly_signal) {
        const a = rc.anomaly_signal, e = a.eff, g = a.engine;
        const kind = a.sig.endsWith('.volume') ? 'total volume' : 'failure rate';
        const reply = `**Anomaly signal \`${a.sig}\`** — seasonal baseline, not a fixed threshold.\n\n` +
          `**Fires when:** this journey's ${kind} for the current hour deviates ≥ **${e.z}σ** from its own ` +
          `hour-of-week norm (median + MAD over ${e.lookbackWeeks} weeks, KSA). No error codes involved — ` +
          `it is a traffic/ratio signal, so a sharp DROP usually means an upstream outage and a SPIKE can mean a retry storm.\n` +
          `**Guards:** min sample ${e.minSample}` + (a.sig.endsWith('.volume') ? ` · volume floor ${e.volFloor}/hr (below that a deviation is capped to P3)` : '') +
          (e.maxSeverity ? ` · severity capped at ${e.maxSeverity}` : '') +
          ` · ${e.enabled ? 'enabled' : '**disabled**'}${e.hasOverride ? ' · custom override' : ' · inheriting engine defaults'}.\n` +
          `**Engine defaults:** ${g.z}σ · floor ${g.volFloor} · ${g.lookbackWeeks}w lookback · incidents ${g.raiseAlerts ? 'ON' : 'OFF'}.\n\n` +
          `Tune it in Alerts → Rules → Anomaly detection → Edit \`${a.sig}\`.`;
        return { intent: 'rule', reply, suggestions: ['What incidents are open?', 'Open Alerts → Rules → Anomaly detection'],
          actions: [{ label: 'Open Alerts board', href: '#alerts' }], sources: [{ type: 'anomaly_signal', sig: a.sig }], degraded: false };
      }
      if (rc && rc.rule) {
        const r = rc.rule, h = rc.last_14_days || {};
        const d8 = x => String(x instanceof Date ? x.toISOString() : x || '').replace('T', ' ').slice(0, 16);
        const OPS = { gte: '≥', gt: '>', lte: '≤', lt: '<', eq: '=' };
        const unitVal = (r.metric_key || '').includes('rate') || Number(r.threshold) <= 1
          ? `${r.threshold}` : `${r.threshold}`;
        let reply = `**${r.name}** \`${r.key}\`${r.enabled ? '' : ' · **DISABLED**'}\n` +
          `Severity ${r.severity} · ${r.alert_class || '—'} class · team ${r.team || '—'}\n\n` +
          `**Fires when:** \`${r.metric_key}\` ${OPS[r.operator] || r.operator} ${unitVal} over ${r.window_hours}h` +
          (r.min_sample ? ` (min sample ${r.min_sample})` : '') + `\n`;
        if (r.trigger_codes) reply += `**Triggered by:** ${r.trigger_codes}\n`;
        else reply += `**Triggered by:** _not documented yet — add it in Alerts → Rules → Edit → Trigger codes._\n`;
        if (r.description) reply += `\n${r.description}\n`;
        reply += `\n**Last 14 days:** ${h.fires || 0} fire(s)` +
          (h.breaches ? ` · ${h.breaches.toLocaleString()} breach evaluations` : '') +
          (h.last_fired ? ` · last ${d8(h.last_fired)} UTC` : '') +
          (h.open_now ? ` · **${h.open_now} open now**` : '') + '.';
        if (h.fires && h.breaches && h.breaches / h.fires > 40)
          reply += `\n⚠ ${Math.round(h.breaches / h.fires)} breaches per fire — this rule describes a persistent condition rather than an incident; it is a tuning candidate.`;
        if (r.runbook) reply += `\n\n**Runbook:** ${String(r.runbook).slice(0, 400)}`;
        return { intent: 'rule', reply,
          suggestions: ['What incidents are open?', 'Open Alerts → Rules to edit this rule'],
          actions: [{ label: 'Open Alerts board', href: '#alerts' }], sources: [{ type: 'alert_rule', key: r.key }], degraded: false };
      }
    }
  } catch (e) {}

  // App error-code lookup — "what is error -113?" / "خطأ -704" → deterministic answer from the
  // source-derived catalog (appErrCatalog) + live occurrence counts from api_error_events.
  try {
    const em = /(?:error|code|err|خطأ)\s*[:#]?\s*(-?\d{3,5})\b/i.exec(q || '');
    if (em) {
      const code = -Math.abs(Number(em[1]));   // catalog codes are negative; accept "704" or "-704"
      const cat = require('./appErrCatalog');
      const d = cat.describe(code) || cat.describe(Number(em[1]));
      if (d) {
        let counts = null;
        try { counts = (await db.console.query(
          `SELECT count(*) FILTER (WHERE ts > now() - interval '24 hours')::int AS d1,
                  count(*) FILTER (WHERE ts > now() - interval '7 days')::int AS d7,
                  max(ts) AS last FROM api_error_events WHERE error_code = $1`, [d.code])).rows[0]; } catch (e) {}
        const d8 = x => String(x instanceof Date ? x.toISOString() : x || '').replace('T', ' ').slice(0, 16);
        let reply = `**Error ${d.code} · ${d.constant}** — category: ${d.category_label} (${d.class})\n` +
          (d.message ? `Meaning: ${d.message}\n` : '') +
          `${d.category_desc}\n`;
        if (counts) reply += `Live occurrences: ${counts.d1.toLocaleString()} in 24h · ${counts.d7.toLocaleString()} in 7d` +
          (counts.last ? ` · last seen ${d8(counts.last)} UTC` : ' · none recorded') + `.`;
        return { intent: 'error_code', reply: reply.trim(),
          suggestions: ['Monitoring → ③ App errors for the category breakdown', `Paste a trace id for a specific customer case`],
          actions: [], sources: [{ type: 'app_err_catalog', code: d.code }], degraded: false };
      }
    }
  } catch (e) {}

  // OTP / SMS delivery health — deterministic answer from the otps funnel (same reasoning as the
  // Unifonic incident forensics: the app discards the gateway response, so sent→verified rate IS
  // the delivery evidence). Answers "are OTPs failing?", "since when?", "is it still happening?".
  try {
    if (/\b(otp|sms|unifonic|رمز التحقق)\b/i.test(q || '') && /\b(fail|delay|deliver|issue|problem|health|slow|receiv|not work|status|today|now|مشكل|تأخير)\b/i.test(q || '')) {
      const hrs = (await db.source.query(
        `SELECT date_trunc('hour', created_at) AS h, count(*)::int AS sent,
                count(*) FILTER (WHERE verified)::int AS ok
         FROM otps WHERE delivery_method='sms' AND created_at > now() - interval '72 hours'
         GROUP BY 1 ORDER BY 1`)).rows;
      if (hrs.length >= 6) {
        const rate = r => r.sent ? (100 * r.ok / r.sent) : null;
        const meaningful = hrs.filter(r => r.sent >= 15);
        const rates = meaningful.map(rate).filter(x => x != null).sort((a, b) => a - b);
        const median = rates.length ? rates[Math.floor(rates.length / 2)] : null;
        const thr = median != null ? Math.max(20, median - 15) : 40;   // degraded = 15pts under median
        const bad = meaningful.filter(r => rate(r) < thr);
        const last3 = meaningful.slice(-3);
        const lastRate = last3.length ? Math.round(last3.reduce((a, r) => a + rate(r), 0) / last3.length) : null;
        const d8 = x => String(x instanceof Date ? x.toISOString() : x).replace('T', ' ').slice(0, 16);
        const lost = bad.reduce((a, r) => a + Math.max(0, Math.round(r.sent * ((median - rate(r)) / 100))), 0);
        let reply = `**OTP delivery health (last 72h, from the otps funnel)**\n` +
          `Baseline verify-rate (median): ${median != null ? Math.round(median) + '%' : '—'} · degraded threshold <${Math.round(thr)}%\n`;
        if (bad.length) {
          reply += `Degraded hours: ${bad.length} — first ${d8(bad[0].h)}, last ${d8(bad[bad.length - 1].h)} (UTC)\n` +
            `Estimated impacted OTPs in degraded hours: ~${lost.toLocaleString()}\n`;
        } else reply += `No degraded hours detected in the window.\n`;
        reply += `Current status (last ~3h): ${lastRate != null ? lastRate + '%' : 'low volume'} — ` +
          (lastRate == null ? 'not enough traffic to judge.' : lastRate < thr ? '**still degraded now.**' : 'back at baseline.') +
          `\nNote: replica freshness depends on prod-sync — check "oldest prod-sync" in the console header.`;
        return { intent: 'sms_health', reply,
          suggestions: ['Per-operator split: run the prefix breakdown in Troubleshoot'],
          actions: [{ label: 'Open Monitoring → SMS gateways', href: '#monitoring?tab=sms' }],   // TKT-000008
          sources: [{ type: 'otp_funnel', hours: hrs.length }], degraded: false };
      }
    }
  } catch (e) {}

  // Before refusing, probe the knowledge base + error-code catalog: if the question actually matches
  // runbook/integration content the keyword regex didn't anticipate, answer it as knowledge instead
  // of refusing (the regex is a gate for obvious off-topic, not a whitelist of phrasing).
  if (intent === 'payment') {
    ctx.payment = await paymentContext(q, allowUnmask);
    // a reference nobody recognises is still worth a KB answer rather than a dead end
    if (!ctx.payment || !ctx.payment.found) { ctx.kb = searchKb(q, 2); }
  }
  /* SMS history for one customer. Trimmed to the newest 12 messages and to the fields that
   * answer the question actually being asked ("did the code go out, did they enter it") —
   * the full bodies would blow the context window for no gain. The verification code is not
   * in the payload at all, so the model cannot leak what it never receives. */
  if (intent === 'sms') {
    try {
      const s = await require('./smsTrace').search(q, { limit: 24 });
      ctx.sms = {
        msisdn: s.msisdn, totals: s.totals, notes: s.notes,
        messages: (s.rows || []).slice(0, 12).map(r => ({
          sent: r.sent_at, outcome: r.status, type: r.message_type || 'not recorded',
          type_source: r.type_source, seconds_to_enter: r.time_to_verify_sec,
          recipient: r.recipient_mobile, body: r.body_en ? String(r.body_en).slice(0, 180) : null
        }))
      };
      if (!ctx.sms.messages.length) ctx.kb = searchKb(q, 2);
    } catch (e) { ctx.smsError = e.message; }
  }
  if (intent === 'out_of_scope') {
    const kbProbe = searchKb(q, 3);
    const ecProbe = await searchErrorCodes(q, 5);
    if (kbProbe.length || ecProbe.length) { intent = 'knowledge'; ctx.kb = kbProbe; ctx.errorCodes = ecProbe; }
  }
  // still nothing relevant → never reaches the LLM
  if (intent === 'out_of_scope') {
    return { intent, reply: "That's outside my scope — I only help with customer journeys, integrations and troubleshooting. Ask me about a subscriber (MSISDN / National ID), a failed step, a payment, an integration, or an open incident.",
      suggestions: ['Check subscriber 05…', 'What incidents are open?', 'How do I handle a stuck UPG payment?'],
      actions: [], sources: [], degraded: false };
  }

  if (intent === 'fixed_customer') {
    if (!ctx.fixedKey) { const fk = extractFixedKey(q); ctx.fixedKey = fk && fk.key; }
    ctx.fixed_customer = await fixedCustomerContext(ctx.fixedKey, allowUnmask);
    // a National ID / MSISDN typed in a Fixed sentence also has a Mobile side — show both
    if (biz !== 'fixed' && ctx.followup && /^(?:0?5\d{8}|[12]\d{9})$/.test(String(ctx.fixedKey))) { ctx.customerKey = ctx.fixedKey; ctx.customer = await customerContext(ctx.fixedKey, allowUnmask); }
    ctx.kb = searchKb(q, 2);
  } else if (intent === 'fixed_issues') {
    ctx.fixed_issues = await fixedIssuesContext(q);
  }
  if (intent === 'customer') {
    if (!ctx.customerKey) ctx.customerKey = extractIdentifier(q);
    { const __tc=Date.now(); ctx.customer = await customerContext(ctx.followup ? ctx.customerKey : q, allowUnmask); ctx.__packMs = Date.now()-__tc; }
    ctx.osb_customer = await osbCustomerContext(ctx.customerKey);
    // the same person may hold Fixed services — resolved through the nexus bridge (NID / mobile) when configured
    if (db.opsConfigured && biz !== 'mobile') { ctx.fixed_customer = await fixedCustomerContext(ctx.customerKey, allowUnmask); if (!ctx.fixed_customer.found) delete ctx.fixed_customer; }
    ctx.kb = searchKb(q, 2);
    ctx.cases = await searchCases(q, 3);        // team's past resolved cases — "learning from use"
  } else if (intent === 'alerts') {
    // alerts questions are answered from live alert data ONLY — no runbook text,
    // so the model can't confuse doc sections with real incidents
    ctx.alerts = await alertsContext();
  } else if (intent === 'knowledge') {
    if (!ctx.kb) { ctx.kb = searchKb(q, 3); ctx.errorCodes = await searchErrorCodes(q, 5); }
    ctx.cases = await searchCases(q, 3);
  }

  const sources = []
    .concat(ctx.payment && ctx.payment.found ? [{ type: 'payment', ref: ctx.payment.payment ? ctx.payment.payment.payment_reference_id : ctx.payment.key }] : [])
    .concat((ctx.kb || []).map(k => ({ type: 'runbook', doc: k.doc, section: k.title })))
    .concat(ctx.customer && ctx.customer.found ? [{ type: 'subscriber', key: ctx.customerKey }] : [])
    .concat(ctx.osb_customer && ctx.osb_customer.summary ? [{ type: 'osb_archive', key: ctx.customerKey }] : [])
    .concat(ctx.alerts ? [{ type: 'alerts', open: ctx.alerts.open_count }] : [])
    .concat(ctx.fixed_customer && ctx.fixed_customer.found ? [{ type: 'fixed_customer', key: ctx.fixedKey || ctx.customerKey }] : [])
    .concat(ctx.fixed_issues && !ctx.fixed_issues.error ? [{ type: 'fixed_issues', window: ctx.fixed_issues.window }] : [])
    .concat((ctx.errorCodes || []).length ? [{ type: 'error_codes', matches: ctx.errorCodes.length }] : []);

  // small talk never needs the LLM round-trip
  if (intent === 'smalltalk') {
    return { intent, reply: fallbackAnswer(intent, ctx), suggestions: suggestionsFor(intent, ctx), actions: [], sources: [], degraded: false };
  }

  const facts = (intent === 'customer' || intent === 'fixed_customer') ? identityFacts(ctx) : '';
  // keep the customer pack small when the Fixed side is present too — the inventory must survive the size cap
  if (ctx.customer && ctx.customer.found && ctx.fixed_customer) {
    ctx.customer = { ...ctx.customer, recent_events: (ctx.customer.recent_events || []).slice(-5).map(e => ({ ...e, request: undefined, response: e.ok === false ? String(e.response || '').slice(0, 160) : undefined })),
      lines: (ctx.customer.lines || []).slice(0, 4) };
  }
  const contextBlock = JSON.stringify({
    VERIFIED_FACTS: facts || undefined,
    payment: ctx.payment || undefined,
    sms: ctx.sms || undefined,
    customer: ctx.customer || undefined,
    osb_customer: ctx.osb_customer || undefined,
    fixed_customer: ctx.fixed_customer || undefined,
    fixed_issues: ctx.fixed_issues || undefined,
    open_alerts: ctx.alerts || undefined,
    // imported partner docs (Tap/OTO) have long sections — send a trimmed slice: enough to
    // answer from, small enough to keep prompt-eval inside the timeout on CPU inference
    runbook_sections: (ctx.kb || []).slice(0, 2).map(k => ({ doc: k.doc, title: k.title, content: String(k.text || '').slice(0, 900) })),
    error_codes: ctx.errorCodes && ctx.errorCodes.length ? ctx.errorCodes : undefined,
    past_cases: (ctx.cases || []).length ? ctx.cases.map(c => ({ problem: c.problem, resolution: c.resolution, votes: c.helpful_votes })) : undefined
  }, null, 1).slice(0, facts ? 4800 : 3500);   // CPU inference: this is the only non-cacheable part of the prompt — every char here is paid on every question

  let reply = null, degraded = false, llmError = null, llmHint = null;
  const promptChars = SYSTEM_BASE.length + contextBlock.length +
    (history || []).slice(-3).reduce((a, h) => a + Math.min(500, String((h && h.content) || '').length), 0);
  const tLlm0 = Date.now();
  try {
    reply = await ollamaChat({
      cfg, actor,
      /* PROMPT-CACHE LAYOUT (measured p95 66s on CPU came from re-evaluating ~4k tokens/question):
       * system stays CONSTANT so Ollama's prefix cache keeps its ~2k tokens hot between requests;
       * the per-question context rides in the user turn instead. Same information, same model
       * behaviour — but only the new tokens get evaluated. */
      system: SYSTEM_BASE,
      history, user: 'CONTEXT (live data for this question):\n' + contextBlock + (facts ? '\n\nVERIFIED_FACTS above are already computed from authoritative sources and will be shown to the agent verbatim. Do NOT restate or contradict them; add only what they lack (failures, next step).' : '') + '\n\nQUESTION: ' + q
    });
    if (!reply) throw new Error('empty LLM reply');
  } catch (e) {
    degraded = true; llmError = e.name === 'AbortError' ? 'timeout' : e.message;
    // The rule-based answer alone leaves the user guessing. Probe the model host once (5s) and
    // say WHY it is offline plus what to do — a support agent should never have to read logs.
    try {
      const p = await ping();
      if (p.ok && p.modelAvailable === false)
        llmHint = `model "${(await getConfig()).model}" is not installed on the LLM host (available: ${(p.models || []).join(', ') || 'none'})`;
      else if (p.ok && llmError === 'timeout')
        llmHint = 'the model host answered but generation exceeded the timeout — it is probably loading the model or under load; retry in a moment';
      else if (!p.ok)
        llmHint = `cannot reach the model host at ${p.url} (${p.error})`;
    } catch (_) { /* diagnosis is best-effort */ }
    reply = fallbackAnswer(intent, ctx, llmHint);
  }

  if (facts && !degraded && reply) reply = facts + '\n\n' + reply;
  return { intent, reply, suggestions: suggestionsFor(intent, ctx), actions: actionsFor(intent, ctx), sources, degraded, llmError, llmHint, prompt_chars: promptChars,
    t_llm_ms: Date.now() - tLlm0, t_pack_ms: ctx.__packMs || null };
}

/* Warm-up: load the model into RAM at boot and re-touch it periodically, so the model is
 * resident before the first L2 question rather than after it. Cheap (1 token), best-effort. */
async function warm() {
  try {
    const cfg = await getConfig();
    if (!cfg.enabled) return;
    /* Send the REAL system prompt: the point of warming is not just keeping the model in RAM but keeping the
     * evaluated SYSTEM_BASE prefix in the slot cache (a bare 'ok' warm evicted it every 20 minutes). */
    await llm.chat({ messages: [{ role: 'system', content: SYSTEM_BASE }, { role: 'user', content: 'ok' }], purpose: 'yusr.warm', caller: 'console', maxTokens: 1, numCtx: 4096, temperature: 0.2 });
  } catch (e) { /* best effort */ }
}
function startWarm() {
  setTimeout(warm, 15000);                       // shortly after boot
  const t = setInterval(warm, 20 * 60 * 1000);   // before the 30m keep_alive lapses
  if (t.unref) t.unref();
}

module.exports = { chat, ping, getConfig, setConfig, DEFAULTS, saveCase, scrubPII, searchKb, loadKb, ensureDocChunks, warm, startWarm };
