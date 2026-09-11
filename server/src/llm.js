/* llm.js — the ONE LLM layer for the console and the agents (10 Sep 2026). On-prem only by design.
 *
 * Two providers, PRIMARY and FALLBACK, each { kind, url, model, key, timeoutMs }:
 *   kind 'ollama'  → POST {url}/api/chat with Ollama options (num_ctx / num_predict / keep_alive) — what 152 runs today
 *   kind 'openai'  → POST {url}/v1/chat/completions (vLLM, llama.cpp server, LM Studio, a second Ollama, any
 *                    OpenAI-compatible on-prem gateway) — the switch is configuration, not code
 * A call goes to PRIMARY; on timeout / 5xx / connection error it goes to FALLBACK, and the answer carries
 * { provider, model, ms, fallback: true|false }. Every call is written to llm_calls (purpose, provider, model, ms, ok,
 * prompt/answer sizes, error) — the audit trail asked for by security, and the source of the LLM status card.
 * Health: probe() every 60 s (GET /api/tags or /v1/models); status() serves the self-check + settings card.
 *
 * Env (deploy152/env.template):
 *   LLM_PRIMARY_KIND=ollama   LLM_PRIMARY_URL=http://127.0.0.1:11434   LLM_PRIMARY_MODEL=llama3.1   LLM_PRIMARY_KEY=
 *   LLM_FALLBACK_KIND=openai  LLM_FALLBACK_URL=http://<gpu-host>:8000  LLM_FALLBACK_MODEL=...       LLM_FALLBACK_KEY=
 *   (when LLM_PRIMARY_* is absent, OLLAMA_URL / OLLAMA_MODEL are used — nothing changes for an existing .env)
 * Settings key 'llm' (UI, optional) overrides the env: { primary:{...}, fallback:{...}, order:'primary-first'|'fallback-first' }
 * json:true asks the model for a JSON object and parses it (Ollama format:'json' / OpenAI response_format). */
'use strict';
const db = require('./db');

const E = process.env;
const envProvider = (p, dflt) => {
  const kind = (E[`LLM_${p}_KIND`] || dflt.kind || '').toLowerCase();
  const url = E[`LLM_${p}_URL`] || dflt.url || '';
  if (!url) return null;
  return { kind: kind === 'openai' ? 'openai' : 'ollama', url: url.replace(/\/+$/, ''), model: E[`LLM_${p}_MODEL`] || dflt.model || 'llama3.1', key: E[`LLM_${p}_KEY`] || '', timeoutMs: Number(E[`LLM_${p}_TIMEOUT_MS`]) || 75000 };
};
function envConfig(assist) {
  // PRIMARY defaults to exactly what Yusr used until today: settings 'assist' (ollamaUrl/model/timeoutMs) over OLLAMA_URL/OLLAMA_MODEL,
  // OLLAMA_*_OVERRIDE (local kit SSH tunnel) winning — so an existing .env / DB config keeps working unchanged.
  const a = assist || {};
  const primary = envProvider('PRIMARY', { kind: 'ollama', url: E.OLLAMA_URL_OVERRIDE || a.ollamaUrl || E.OLLAMA_URL || 'http://127.0.0.1:11434', model: E.OLLAMA_MODEL_OVERRIDE || a.model || E.OLLAMA_MODEL || 'llama3.1' });
  if (primary && !E.LLM_PRIMARY_TIMEOUT_MS && a.timeoutMs) primary.timeoutMs = Number(a.timeoutMs) || primary.timeoutMs;
  const fallback = envProvider('FALLBACK', {});
  return { primary, fallback, order: 'primary-first' };
}
let _cfg = null, _cfgAt = 0;
async function getConfig() {
  if (_cfg && Date.now() - _cfgAt < 30000) return _cfg;
  let base = envConfig();
  try {
    const settings = require('./settings');
    base = envConfig((await settings.getSetting('assist')) || {});
    const s = (await settings.getSetting('llm')) || {};
    const merge = (a, b) => (b && b.url) ? { ...(a || {}), ...b, url: String(b.url).replace(/\/+$/, ''), kind: b.kind === 'openai' ? 'openai' : 'ollama', timeoutMs: Number(b.timeoutMs) || (a && a.timeoutMs) || 75000 } : a;
    _cfg = { primary: merge(base.primary, s.primary), fallback: merge(base.fallback, s.fallback), order: s.order === 'fallback-first' ? 'fallback-first' : 'primary-first' };
  } catch (_) { _cfg = base; }
  _cfgAt = Date.now(); return _cfg;
}
async function setConfig(patch) {
  const settings = require('./settings'); const cur = (await settings.getSetting('llm')) || {};
  const next = { ...cur, ...(patch || {}) }; await settings.setSetting('llm', next); _cfg = null; return getConfig();
}

/* ---- schema (self-seeded) ---- */
let _schema = false;
async function ensureSchema() {
  if (_schema) return; _schema = true;
  await db.console.query(`CREATE TABLE IF NOT EXISTS llm_calls (
      id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), purpose text NOT NULL, caller text, provider text NOT NULL, model text,
      ms integer, ok boolean NOT NULL, fallback boolean NOT NULL DEFAULT false, prompt_chars integer, answer_chars integer, error text)`).catch(() => { _schema = false; });
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_llm_calls_at ON llm_calls (at DESC)`).catch(() => {});
  await require('./llmBudget').ensureSchema().catch(() => {});   // actor / tokens / cost columns + budget events
}

/* ---- prompt budget (11 Sep 2026) ------------------------------------------------------------------------------
 * Ollama does NOT error when a prompt is longer than num_ctx — it silently truncates, and llama3.1 then often emits
 * end-of-text immediately: HTTP 200, 0 characters, ~250 ms. That is exactly the "model unavailable" the agents kept
 * writing on incidents. Two guards: never send more than PROMPT_CHARS (~4 chars ≈ 1 token, so 9 000 ≈ 2 300 tokens)
 * and give Ollama a context window with real headroom (8 192). Anything longer is cut in the MIDDLE, keeping the head
 * (what the incident is) and the tail (the question / output contract) — the two parts the answer depends on. */
const PROMPT_CHARS = Number(process.env.LLM_PROMPT_CHARS) || 9000;
function budget(messages, cap = PROMPT_CHARS) {
  const out = messages.map(m => ({ ...m }));
  let total = out.reduce((s, m) => s + String(m.content || '').length, 0);
  if (total <= cap) return { messages: out, trimmed: 0 };
  // trim the longest message first, repeatedly, until we fit
  let trimmed = 0;
  for (let guard = 0; guard < 20 && total > cap; guard++) {
    const i = out.reduce((bi, m, idx) => String(m.content || '').length > String(out[bi].content || '').length ? idx : bi, 0);
    const t = String(out[i].content || ''); const over = total - cap;
    const keep = Math.max(400, t.length - over - 60); const head = Math.ceil(keep * 0.65), tail = keep - head;
    out[i].content = t.slice(0, head) + `\n…[${t.length - keep} characters trimmed to fit the model context]…\n` + t.slice(t.length - tail);
    trimmed += t.length - String(out[i].content).length; total = out.reduce((s, m) => s + String(m.content || '').length, 0);
  }
  return { messages: out, trimmed };
}

/* ---- one request to one provider ---- */
async function callProvider(p, { messages, maxTokens, temperature, numCtx, json }) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), p.timeoutMs || 75000);
  const headers = { 'Content-Type': 'application/json' }; if (p.key) headers.Authorization = `Bearer ${p.key}`;
  try {
    if (p.kind === 'openai') {
      const body = { model: p.model, messages, stream: false, temperature: temperature ?? 0.2, max_tokens: maxTokens || 220 };
      if (json) body.response_format = { type: 'json_object' };
      const r = await fetch(`${p.url}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json(); const u = j.usage || {};
      return { text: ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim(), ptok: u.prompt_tokens, ctok: u.completion_tokens };
    }
    /* EMPTY-ANSWER LADDER (11 Sep 2026). Two known llama3.1 behaviours both return HTTP 200 with 0 characters:
     *   a) format:'json' grammar → immediate end-of-text on some prompts (seen on 152, 10 Sep)
     *   b) prompt longer than num_ctx → silent truncation → immediate end-of-text
     * So we escalate instead of giving up: grammar → no grammar → bigger context + more tokens + the system prompt
     * folded into the user turn. If every attempt comes back empty we THROW, so the reason is recorded in llm_calls
     * and shown on Settings › Agents — never a silent "" that the agents report as "model unavailable". */
    const base = budget(messages).messages;
    const merged = () => {
      const sys = base.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      const rest = base.filter(m => m.role !== 'system');
      if (!sys || !rest.length) return base;
      return [{ ...rest[0], content: `${sys}\n\n${rest[0].content}` }, ...rest.slice(1)];
    };
    const attempt = async (o) => {
      const b = { model: p.model, stream: false, keep_alive: '30m', messages: o.merge ? merged() : base,
        options: { temperature: temperature ?? 0.2, num_predict: o.predict || maxTokens || 220, num_ctx: o.ctx || numCtx || 8192 } };
      if (o.format) b.format = 'json';
      const r = await fetch(`${p.url}/api/chat`, { method: 'POST', headers, body: JSON.stringify(b), signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json(); return { text: ((j.message && j.message.content) || '').trim(), eval_count: j.eval_count, prompt_eval_count: j.prompt_eval_count, done_reason: j.done_reason };
    };
    /* Rung order matters on a CPU box: the cheap fixes first. Folding the system prompt into the user turn costs
     * nothing; RAISING num_ctx makes Ollama RELOAD the model (152 has ~6 GB free and llama3.1 needs 5.6 GB at 4k),
     * so the context rung is last and capped by LLM_MAX_CTX (8192) — never 16k on this host. */
    const MAXCTX = Math.max(2048, Number(E.LLM_MAX_CTX) || 8192);
    const bigCtx = Math.min(MAXCTX, Math.max(8192, numCtx || 0));
    const ladder = json
      ? [{ format: true, label: 'json grammar' },
         { format: false, label: 'no grammar' },
         { format: false, merge: true, label: 'no grammar · system merged' },
         { format: false, merge: true, ctx: bigCtx, predict: Math.max(512, maxTokens || 0), label: `no grammar · system merged · ctx ${bigCtx}` }]
      : [{ label: 'plain' }, { merge: true, label: 'system merged' }, { merge: true, ctx: bigCtx, predict: Math.max(512, maxTokens || 0), label: `system merged · ctx ${bigCtx}` }];
    let last = null, tried = [];
    for (const step of ladder) {
      last = await attempt(step); tried.push(`${step.label}${last.text ? ' ✓' : ' ∅'}`);
      if (last.text) { if (tried.length > 1) console.warn(`[LLM] ${p.model}: recovered on "${step.label}" (${tried.join(' → ')})`); return { text: last.text, ptok: last.prompt_eval_count, ctok: last.eval_count }; }
      console.warn(`[LLM] ${p.model}: empty answer on "${step.label}" (prompt ${last.prompt_eval_count ?? '?'} tok, done_reason ${last.done_reason || '?'}) — escalating`);
    }
    const chars = base.reduce((s, m) => s + String(m.content || '').length, 0);
    throw new Error(`empty answer after ${ladder.length} attempts (${tried.join(' → ')}); prompt ${chars} chars / ${last && last.prompt_eval_count != null ? last.prompt_eval_count + ' tokens' : 'unknown tokens'}, done_reason ${last && last.done_reason || '?'} — the model loads but generates nothing: check \`ollama ps\` and the model's context size`);
  } finally { clearTimeout(timer); }
}

/* first {...} block of a model answer → object (tolerates ```json fences, prose before/after, trailing commas) */
function extractJson(text) {
  const t = String(text || '').replace(/```json|```/gi, '').trim(); if (!t) return null;
  const tryParse = s => { try { return JSON.parse(s); } catch (_) { try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch (__) { return null; } } };
  const direct = tryParse(t); if (direct && typeof direct === 'object') return direct;
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) return null;
  return tryParse(t.slice(a, b + 1));
}
/* chat({ system, messages|user, purpose, caller, maxTokens, temperature, numCtx, json }) → { text, json?, provider, model, ms, fallback } */
async function chat(opts = {}) {
  const cfg = await getConfig(); await ensureSchema();
  const messages = opts.messages ? opts.messages.slice() : [];
  if (opts.system && !messages.some(m => m.role === 'system')) messages.unshift({ role: 'system', content: opts.system });
  if (opts.user) messages.push({ role: 'user', content: opts.user });
  const promptChars = messages.reduce((s, m) => s + String(m.content || '').length, 0);
  /* BUDGET (11 Sep 2026, llmBudget.js): who is asking, how much they used today, and the ceiling. A refusal is a
   * normal explained answer — the caller degrades (Yusr answers from rules, the agents write evidence-only notes). */
  const budget = require('./llmBudget');
  let gate = null;
  try { gate = await budget.check({ actor: opts.actor, caller: opts.caller }); } catch (e) { gate = null; }
  if (gate && !gate.allowed) {
    db.console.query(`INSERT INTO llm_calls (purpose, caller, actor, provider, model, ms, ok, blocked, prompt_chars, tokens, error) VALUES ($1,$2,$3,'budget','-',0,false,true,$4,0,$5)`,
      [opts.purpose || 'chat', opts.caller || null, gate.subject, promptChars, `budget: ${gate.reason}`]).catch(() => {});
    const err = new Error(gate.reason); err.llm = true; err.budget = gate; throw err;
  }
  const order = cfg.order === 'fallback-first' ? [['fallback', cfg.fallback], ['primary', cfg.primary]] : [['primary', cfg.primary], ['fallback', cfg.fallback]];
  let lastErr = null; let i = 0;
  for (const [name, p] of order) {
    if (!p || !p.url) continue;
    const t0 = Date.now();
    try {
      /* ROOT CAUSE of the agents' silent "model unavailable" (found 11 Sep 2026): chat() builds `messages` from
       * system+user, but passed the ORIGINAL opts to callProvider — so callers that use { system, user } (both agents)
       * sent NO messages field at all. Ollama answers that with HTTP 200 and an empty string in ~250 ms, exactly the
       * symptom seen on 152 since the agents went live. Callers that pass `messages` themselves (Yusr chat / warm)
       * were never affected, which is why the model looked healthy. Always send the built messages. */
      const a = await callProvider(p, { ...opts, messages });
      const text = a && typeof a === 'object' ? a.text : String(a || '');
      const out = { text, provider: name, kind: p.kind, model: p.model, ms: Date.now() - t0, fallback: i > 0 };
      if (opts.json) { out.json = extractJson(text); if (!out.json) out.jsonError = text ? 'no JSON object in answer' : 'empty answer'; }
      /* tokens: what the provider measured (Ollama prompt_eval_count/eval_count, OpenAI usage) — otherwise chars ÷ 4,
       * flagged `estimated` so an estimate is never read as a measurement. */
      const measured = a && (a.ptok != null || a.ctok != null);
      const ptok = measured && a.ptok != null ? Number(a.ptok) : Math.ceil(promptChars / 4);
      const ctok = measured && a.ctok != null ? Number(a.ctok) : Math.ceil(text.length / 4);
      out.tokens = ptok + ctok; out.estimated = !measured;
      let cost = 0; try { cost = budget.price(await budget.config(), name, out.tokens); } catch (_) {}
      out.cost = cost; out.subject = gate ? gate.subject : null;
      /* awaited on purpose: the next call's budget check and the threshold mail both read this row back */
      await db.console.query(`INSERT INTO llm_calls (purpose, caller, actor, provider, model, ms, ok, fallback, prompt_chars, answer_chars, prompt_tokens, answer_tokens, tokens, estimated, cost)
                        VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [opts.purpose || 'chat', opts.caller || null, gate ? gate.subject : null, `${name}:${p.kind}`, p.model, out.ms, out.fallback, promptChars, text.length, ptok, ctok, out.tokens, out.estimated, cost]).catch(() => {});
      budget.afterCall({ actor: opts.actor, caller: opts.caller }).catch(() => {});
      return out;
    } catch (e) {
      lastErr = e; const ms = Date.now() - t0;
      db.console.query(`INSERT INTO llm_calls (purpose, caller, actor, provider, model, ms, ok, fallback, prompt_chars, tokens, error) VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10)`,
        [opts.purpose || 'chat', opts.caller || null, gate ? gate.subject : null, `${name}:${p.kind}`, p.model, ms, i > 0, promptChars, Math.ceil(promptChars / 4), String(e.message || e).slice(0, 300)]).catch(() => {});
      console.warn(`[LLM] ${name} (${p.kind} ${p.model}) failed after ${ms} ms: ${e.name === 'AbortError' ? 'timeout' : e.message} — ${order[i + 1] && order[i + 1][1] && order[i + 1][1].url ? 'trying ' + order[i + 1][0] : 'no other provider'}`);
    }
    i++;
  }
  const err = new Error(`LLM unavailable: ${lastErr ? (lastErr.name === 'AbortError' ? 'timeout' : lastErr.message) : 'no provider configured'}`); err.llm = true; throw err;
}

/* ---- SELF-TEST (11 Sep 2026): the one click that tells you WHY the agents get no answer ------------------------
 * Sends the same provider four probes of growing size (and the JSON grammar on/off) and reports which one first
 * comes back empty. A failure at "long" only = the context window; a failure with the grammar but not without it =
 * the llama3.1 grammar bug; everything empty = the model is not generating (ollama ps / model pull). */
async function selftest(which = 'primary') {
  const cfg = await getConfig();
  const p = which === 'fallback' ? cfg.fallback : cfg.primary;
  if (!p || !p.url) return { configured: false, provider: which };
  const filler = (n) => ('The Semati provider returned 715 Service is not available for MSISDN 9665xxxxxxx on the login endpoint. ').repeat(Math.ceil(n / 100)).slice(0, n);
  const probes = [
    { name: 'tiny', json: false, chars: 40 }, { name: 'tiny · json', json: true, chars: 40 },
    { name: 'medium (1 k)', json: true, chars: 1000 }, { name: 'agent-size (6 k)', json: true, chars: 6000 },
    { name: 'oversize (20 k → trimmed)', json: true, chars: 20000 },
  ];
  const out = [];
  for (const pr of probes) {
    const t0 = Date.now();
    const messages = [{ role: 'system', content: 'You are an operations assistant. Answer with a JSON object {"ok":true,"note":"<5 words>"}.' },
      { role: 'user', content: `${pr.chars > 100 ? filler(pr.chars) + '\n' : ''}Reply with the JSON object now.` }];
    try { const a = await callProvider(p, { messages, json: pr.json, maxTokens: 60, numCtx: 8192 });
      out.push({ ...pr, ok: !!(a && a.text), ms: Date.now() - t0, answer: String((a && a.text) || '').slice(0, 120), tokens: (a && ((a.ptok || 0) + (a.ctok || 0))) || null }); }
    catch (e) { out.push({ ...pr, ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 300) }); }
  }
  const firstBad = out.find(o => !o.ok);
  const verdict = !firstBad ? 'healthy — every probe answered, including an agent-sized prompt'
    : out[0].ok === false ? 'the model answers nothing at all — check `ollama ps` / `ollama run ' + p.model + '` on the host'
    : firstBad.name.startsWith('tiny · json') ? 'the JSON grammar (format:json) breaks this model — the console already retries without it'
    : 'prompts stop being answered from "' + firstBad.name + '" — the context window is too small; raise num_ctx (OLLAMA_NUM_CTX / Modelfile) or lower LLM_PROMPT_CHARS';
  return { configured: true, provider: which, kind: p.kind, model: p.model, url: p.url, prompt_cap: PROMPT_CHARS, probes: out, verdict };
}

/* ---- health ---- */
const health = { primary: null, fallback: null, at: null };
async function probeOne(p) {
  if (!p || !p.url) return { configured: false };
  const t0 = Date.now(); const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const headers = p.key ? { Authorization: `Bearer ${p.key}` } : {};
    const r = await fetch(p.kind === 'openai' ? `${p.url}/v1/models` : `${p.url}/api/tags`, { headers, signal: ctl.signal });
    if (!r.ok) return { configured: true, ok: false, ms: Date.now() - t0, error: `HTTP ${r.status}` };
    const j = await r.json(); const models = p.kind === 'openai' ? (j.data || []).map(m => m.id) : (j.models || []).map(m => m.name);
    return { configured: true, ok: true, ms: Date.now() - t0, models, modelAvailable: models.some(m => m === p.model || m.startsWith(p.model)) };
  } catch (e) { return { configured: true, ok: false, ms: Date.now() - t0, error: e.name === 'AbortError' ? 'timeout' : e.message }; }
  finally { clearTimeout(timer); }
}
async function probe() { const cfg = await getConfig(); health.primary = await probeOne(cfg.primary); health.fallback = await probeOne(cfg.fallback); health.at = new Date().toISOString(); return health; }
async function status() {
  const cfg = await getConfig(); if (!health.at) await probe();
  let recent = null;
  try { recent = (await db.console.query(`SELECT provider, count(*)::int AS calls, count(*) FILTER (WHERE ok)::int AS ok, round(avg(ms))::int AS avg_ms, count(*) FILTER (WHERE fallback)::int AS via_fallback FROM llm_calls WHERE at >= now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC`)).rows; } catch (_) {}
  const red = p => p ? { kind: p.kind, url: p.url, model: p.model, keyed: !!p.key, timeoutMs: p.timeoutMs } : null;
  return { primary: red(cfg.primary), fallback: red(cfg.fallback), order: cfg.order, health, recent24h: recent };
}
let timer = null;
function start() { if (timer) clearInterval(timer); probe().catch(() => {}); timer = setInterval(() => probe().catch(() => {}), 60000); if (timer.unref) timer.unref(); return { armed: true }; }

module.exports = { selftest, budget, chat, getConfig, setConfig, probe, status, start, ensureSchema };
