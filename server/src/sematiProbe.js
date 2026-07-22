/* Synthetic canary for Semati (TCC) — the "notified on time" path for incident #28713.
 *
 * Passive metrics depend on real customer traffic and on the replica catching up; at 3am with
 * no traffic a ratio looks fine while the provider is actually down. This module ACTIVELY calls
 * the Semati login (and optionally eligibility) endpoint on a short interval, measures latency,
 * and classifies the same failure signatures the incident showed (715 "Service is not available",
 * 5002 / Connection reset / SSLException, HTTP 408). On a streak of consecutive failures it pages
 * immediately via ChatOps (Teams/SMS), and clears when the provider recovers.
 *
 * READ-ONLY and INERT until configured. It only issues the health request you point it at; it never
 * writes to any provider and never logs secrets. Enable by setting env:
 *   SEMATI_PROBE_LOGIN_URL   e.g. https://semati.tcc-ict.com/TCC-Web/api/login   (required to enable)
 *   SEMATI_PROBE_ELIG_URL    optional second endpoint to probe
 *   SEMATI_PROBE_METHOD      default POST
 *   SEMATI_PROBE_BODY        optional JSON string sent as the request body
 *   SEMATI_PROBE_HEADERS     optional JSON string of extra headers (e.g. auth)
 *   SEMATI_PROBE_INTERVAL_SEC   default 60
 *   SEMATI_PROBE_TIMEOUT_MS     default 8000
 *   SEMATI_PROBE_FAIL_THRESHOLD default 3   (consecutive fails before paging)
 *   SEMATI_PROBE_LATENCY_MS     default 4000 (slow-but-up threshold, recorded as 'degraded')
 */
'use strict';

const env = process.env;
const CFG = {
  loginUrl: env.SEMATI_PROBE_LOGIN_URL || '',
  eligUrl:  env.SEMATI_PROBE_ELIG_URL || '',
  method:   (env.SEMATI_PROBE_METHOD || 'POST').toUpperCase(),
  body:     env.SEMATI_PROBE_BODY || '',
  headers:  safeJson(env.SEMATI_PROBE_HEADERS) || {},
  intervalSec: Number(env.SEMATI_PROBE_INTERVAL_SEC || 60),
  timeoutMs:   Number(env.SEMATI_PROBE_TIMEOUT_MS || 8000),
  failThreshold: Number(env.SEMATI_PROBE_FAIL_THRESHOLD || 3),
  latencyMs:   Number(env.SEMATI_PROBE_LATENCY_MS || 4000)
};

const state = { streak: 0, paged: false, last: null, history: [], timer: null };
const HISTORY_MAX = 120;

function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } }
function configured() { return !!CFG.loginUrl; }

// classify a completed HTTP response body/status into ok | unavailable(715) | transport(5002/reset/408) | degraded
function classify(status, text, ms) {
  const t = String(text || '');
  if (/Connection reset|SSLException|I\/O error|"responseCode":"5002"|\[408\]/i.test(t) || status === 408)
    return { ok: false, layer: 'transport', note: '5002 / connection reset / 408' };
  if (/"responseCode":"715"|Service (is )?not available/i.test(t) || status === 503)
    return { ok: false, layer: 'app', note: '715 service not available' };
  if (status < 200 || status >= 400) return { ok: false, layer: 'http', note: 'HTTP ' + status };
  if (ms > CFG.latencyMs) return { ok: true, layer: 'degraded', note: 'slow ' + ms + 'ms' };
  return { ok: true, layer: 'ok', note: 'ok ' + ms + 'ms' };
}

async function hit(url) {
  const started = Date.now();
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), CFG.timeoutMs);
  try {
    const opts = { method: CFG.method, signal: ac.signal, headers: Object.assign({ 'Content-Type': 'application/json' }, CFG.headers) };
    if (CFG.method !== 'GET' && CFG.body) opts.body = CFG.body;
    const r = await fetch(url, opts);
    const text = await r.text().catch(() => '');
    const ms = Date.now() - started;
    return Object.assign({ url, status: r.status, ms }, classify(r.status, text, ms));
  } catch (e) {
    const ms = Date.now() - started;
    // network-level failure: connection reset / TLS / DNS / timeout(abort)
    const aborted = e.name === 'AbortError';
    return { url, status: 0, ms, ok: false, layer: 'transport',
      note: aborted ? 'timeout ' + ms + 'ms' : (e.message || 'connection error') };
  } finally { clearTimeout(to); }
}

async function probeOnce() {
  if (!configured()) return { configured: false };
  const checks = [await hit(CFG.loginUrl)];
  if (CFG.eligUrl) checks.push(await hit(CFG.eligUrl));
  const ok = checks.every(c => c.ok);
  const worst = checks.find(c => !c.ok) || checks.find(c => c.layer === 'degraded') || checks[0];
  const result = { at: new Date().toISOString(), ok, layer: worst.layer, note: worst.note,
    latencyMs: Math.max(...checks.map(c => c.ms)), checks };
  record(result);
  return result;
}

function record(result) {
  state.last = result;
  state.history.unshift(result);
  if (state.history.length > HISTORY_MAX) state.history.pop();
  if (result.ok) {
    if (state.paged) page('resolved', result);   // recovered
    state.streak = 0; state.paged = false;
  } else {
    state.streak++;
    if (state.streak >= CFG.failThreshold && !state.paged) { state.paged = true; page('opened', result); }
  }
}

async function page(kind, result) {
  let chatops; try { chatops = require('./chatops'); } catch (_) { return; }
  const down = kind === 'opened';
  const alert = {
    id: 0, name: down ? 'Semati canary: provider unreachable (synthetic probe)' : 'Semati canary: provider recovered',
    severity: 'P1', team: 'Digital Ops', metric_key: 'semati_probe',
    operator: 'gte', threshold: CFG.failThreshold, observed_value: state.streak, sample: state.streak,
    window_hours: null, unit: 'count',
    message: down
      ? `Active probe failed ${state.streak}x in a row — ${result.layer}: ${result.note}. Semati (${CFG.loginUrl}) is unreachable. Confirm with TCC Customer Success (customersuccess@tcc-ict.com).`
      : `Active probe recovered — ${result.note}. Semati responding again.`
  };
  try { await chatops.notifyIncident(alert, { kind, force: true }); } catch (e) { /* best-effort */ }
}

function start() {
  if (!configured()) { console.log('Semati canary: disabled (set SEMATI_PROBE_LOGIN_URL to enable).'); return; }
  if (state.timer) return;
  console.log(`Semati canary: probing ${CFG.loginUrl}${CFG.eligUrl ? ' + ' + CFG.eligUrl : ''} every ${CFG.intervalSec}s.`);
  const tick = () => probeOnce().catch(e => console.log('Semati canary error:', e.message));
  tick();
  state.timer = setInterval(tick, Math.max(15, CFG.intervalSec) * 1000);
  state.timer.unref?.();
}

function status() {
  return {
    configured: configured(),
    loginUrl: CFG.loginUrl || null, eligUrl: CFG.eligUrl || null,
    intervalSec: CFG.intervalSec, failThreshold: CFG.failThreshold,
    streak: state.streak, paged: state.paged, last: state.last, history: state.history.slice(0, 40)
  };
}

module.exports = { start, probeOnce, status, configured };
