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
      const j = await r.json(); return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
    }
    const body = { model: p.model, messages, stream: false, keep_alive: '30m', options: { temperature: temperature ?? 0.2, num_predict: maxTokens || 220, num_ctx: numCtx || 4096 } };
    /* Ollama's format:'json' grammar makes llama3.1 emit end-of-text immediately on some prompts (200 OK, 0 chars,
     * ~250 ms — seen on 152, 10 Sep 2026). So: try with the grammar, and when the answer is empty retry ONCE without it —
     * the prompt already asks for a JSON object and chat() extracts the first {…} block. */
    const once = async withFormat => {
      const b = withFormat ? { ...body, format: 'json' } : body;
      const r = await fetch(`${p.url}/api/chat`, { method: 'POST', headers, body: JSON.stringify(b), signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json(); return ((j.message && j.message.content) || '').trim();
    };
    let text = await once(!!json);
    if (json && !text) { console.warn(`[LLM] ${p.model}: empty answer with format=json — retrying without the grammar`); text = await once(false); }
    return text;
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
  const order = cfg.order === 'fallback-first' ? [['fallback', cfg.fallback], ['primary', cfg.primary]] : [['primary', cfg.primary], ['fallback', cfg.fallback]];
  let lastErr = null; let i = 0;
  for (const [name, p] of order) {
    if (!p || !p.url) continue;
    const t0 = Date.now();
    try {
      const text = await callProvider(p, opts);
      const out = { text, provider: name, kind: p.kind, model: p.model, ms: Date.now() - t0, fallback: i > 0 };
      if (opts.json) { out.json = extractJson(text); if (!out.json) out.jsonError = text ? 'no JSON object in answer' : 'empty answer'; }
      db.console.query(`INSERT INTO llm_calls (purpose, caller, provider, model, ms, ok, fallback, prompt_chars, answer_chars) VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8)`,
        [opts.purpose || 'chat', opts.caller || null, `${name}:${p.kind}`, p.model, out.ms, out.fallback, promptChars, text.length]).catch(() => {});
      return out;
    } catch (e) {
      lastErr = e; const ms = Date.now() - t0;
      db.console.query(`INSERT INTO llm_calls (purpose, caller, provider, model, ms, ok, fallback, prompt_chars, error) VALUES ($1,$2,$3,$4,$5,false,$6,$7,$8)`,
        [opts.purpose || 'chat', opts.caller || null, `${name}:${p.kind}`, p.model, ms, i > 0, promptChars, String(e.message || e).slice(0, 300)]).catch(() => {});
      console.warn(`[LLM] ${name} (${p.kind} ${p.model}) failed after ${ms} ms: ${e.name === 'AbortError' ? 'timeout' : e.message} — ${order[i + 1] && order[i + 1][1] && order[i + 1][1].url ? 'trying ' + order[i + 1][0] : 'no other provider'}`);
    }
    i++;
  }
  const err = new Error(`LLM unavailable: ${lastErr ? (lastErr.name === 'AbortError' ? 'timeout' : lastErr.message) : 'no provider configured'}`); err.llm = true; throw err;
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

module.exports = { chat, getConfig, setConfig, probe, status, start, ensureSchema };
