/* Server-side response cache for expensive read endpoints.
 *
 * Why: /api/home runs ~24 count(*) queries over multi-million-row tables; on a 30d window that is
 * tens of seconds and saturates the pg pool. But the underlying data only changes when prod-sync
 * ticks (every 5 min), so recomputing per page-load — per user, per tab — is pure waste.
 *
 * Behaviour:
 *   - key = method + url (per-URL, so each range/filter caches separately)
 *   - fresh hit  → served instantly from memory
 *   - stale hit  → served instantly AND refreshed in the background (stale-while-revalidate),
 *                  so a user never waits for a recompute; only the very first call is slow
 *   - single-flight: concurrent misses share ONE computation instead of stampeding the DB
 * TTL via RESP_CACHE_TTL_SEC (default 120). Disable with RESP_CACHE_TTL_SEC=0.
 */
const TTL = Math.max(0, Number(process.env.RESP_CACHE_TTL_SEC ?? 120)) * 1000;
const MAX_ENTRIES = Number(process.env.RESP_CACHE_MAX || 300);

const store = new Map();     // key → { body, at, building, url, n, last (ms of the last real viewer request) }
let hits = 0, misses = 0, stale = 0;

/* ---- PERSISTENCE (alpha.17) — a deploy or restart must not mean "Loading…" for the first viewer ----
 * The store is snapshotted to disk every minute (when dirty) and on shutdown, and reloaded at boot with
 * every entry marked STALE: the first request after a restart is answered instantly from the snapshot
 * while the real recompute runs behind it. Bodies are JSON, so the file is plain JSON too. */
const fs = require('fs'), path = require('path');
const FILE = process.env.RESP_CACHE_FILE || path.join(__dirname, '..', '..', 'cache', 'respcache.json');
const PERSIST_MAX_MB = Number(process.env.RESP_CACHE_FILE_MAX_MB || 64);
let dirty = false;
function load() {
  if (!TTL) return;
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    /* A snapshot is only useful across a quick restart (deploy). Older than RESP_CACHE_RESTORE_MAX_MIN (30) its
     * answers describe another world — after the 8 Sep replica outage a restored snapshot served zero-filled
     * dashboards as "stale hits" until every URL had been recomputed. Start cold instead; keep-warm refills it. */
    const ageMin = j.savedAt ? (Date.now() - new Date(j.savedAt).getTime()) / 60000 : Infinity;
    const maxMin = Number(process.env.RESP_CACHE_RESTORE_MAX_MIN) || 30;
    if (ageMin > maxMin) { console.log(`[CACHE] snapshot is ${Math.round(ageMin)} min old (> ${maxMin}) — not restored, starting cold`); return; }
    let n = 0;
    for (const [k, e] of Object.entries(j.entries || {})) { if (e && e.body !== undefined) { store.set(k, { body: e.body, at: 1, url: e.url, n: e.n || 0, last: e.last || null }); n++; } }
    console.log(`[CACHE] restored ${n} responses from ${FILE} (${Math.round(ageMin)} min old — served stale, refreshed in the background)`);
  } catch (e) { if (e.code !== 'ENOENT') console.error('[CACHE] restore failed:', e.message); }
}
function save(reason) {
  if (!TTL || !dirty) return;
  try {
    const entries = {};
    for (const [k, e] of store) if (e.body !== undefined && e.at > 0 && e.persist !== false) entries[k] = { body: e.body, url: e.url, n: e.n || 0, at: e.at, last: e.last || null };
    const json = JSON.stringify({ savedAt: new Date().toISOString(), entries });
    if (json.length > PERSIST_MAX_MB * 1024 * 1024) { console.error(`[CACHE] snapshot skipped — ${Math.round(json.length / 1048576)} MB > RESP_CACHE_FILE_MAX_MB`); return; }
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + '.tmp', json); fs.renameSync(FILE + '.tmp', FILE);
    dirty = false;
    if (reason) console.log(`[CACHE] snapshot ${Object.keys(entries).length} responses (${reason})`);
  } catch (e) { console.error('[CACHE] snapshot failed:', e.message); }
}
load();
setInterval(() => save(), 60000).unref?.();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { save(sig); });

/* ---- KEEP-WARM — hot responses are refreshed on a timer, so a viewer almost never triggers a recompute.
 * Every TTL the most-requested URLs that have gone stale are re-fetched over loopback (the fetch itself
 * lands in wrap() as a stale hit → background recompute). Bounded to RESP_CACHE_WARM_TOP URLs per cycle. */
const WARM_TOP = Math.max(0, Number(process.env.RESP_CACHE_WARM_TOP ?? 40));
/* ACTIVE WINDOW (7 Oct 2026, the slowness review). The warm set was "the 40 most-requested URLs ever" — request
 * counts never decayed, so every TTL the console recomputed NOC, Exec, Home, the traffic overview and thirty
 * other heavy pages for viewers who had left hours ago, around the clock, on a database shared with production.
 * A URL is now kept warm only while somebody has asked for it in the last RESP_CACHE_WARM_ACTIVE_MIN minutes
 * (120). A page nobody is watching simply goes stale; the first viewer back still gets the stale copy at once
 * and the refresh runs behind it (wrap() below) — same experience, no idle load. 0 = warm everything, as before. */
const WARM_ACTIVE_MS = Math.max(0, Number(process.env.RESP_CACHE_WARM_ACTIVE_MIN ?? 120)) * 60000;
let warmLast = { at: null, refreshed: 0, candidates: 0 };
function startKeepWarm() {
  if (!TTL || !WARM_TOP) return;
  const port = process.env.PORT || 4600;
  const hdr = { 'X-Console-User': process.env.CONSOLE_ADMIN_USER || 'y.yahmed.sns@salam.sa', 'X-Demo-Bypass': '1', 'X-Cache-Warm': '1' };
  const cycle = async () => {
    const now = Date.now();
    const active = e => !WARM_ACTIVE_MS || (e.last && now - e.last < WARM_ACTIVE_MS);
    const hot = [...store.values()].filter(e => e.url && e.body !== undefined && !e.building && now - e.at > TTL * 0.8 && active(e)).sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, WARM_TOP);
    warmLast = { at: new Date(now).toISOString(), refreshed: hot.length, candidates: [...store.values()].filter(e => e.url && now - e.at > TTL * 0.8).length };
    for (const e of hot) { try { const r = await fetch(`http://127.0.0.1:${port}${e.url}`, { headers: hdr, signal: AbortSignal.timeout(60000) }); await r.arrayBuffer(); } catch (_) {} }
  };
  setInterval(() => { cycle().catch(() => {}); }, Math.max(60000, TTL)).unref?.();
  console.log(`[CACHE] keep-warm armed — top ${WARM_TOP} hot responses refreshed every ${Math.round(Math.max(60000, TTL) / 1000)} s`
    + (WARM_ACTIVE_MS ? ` · only URLs viewed in the last ${WARM_ACTIVE_MS / 60000} min` : ''));
}


/* Cache key: the raw URL is useless here — the UI computes from/to from "now", so every page load
 * produces a unique URL (…&to=2026-08-04T20:33:14.342Z) and the cache would NEVER hit.
 * So we bucket any date-like query value to the TTL window: two loads seconds apart collapse to
 * the same key, while a genuinely different range (7d vs 30d) still keys separately. */
const BUCKET = Math.max(30_000, TTL || 120_000);
function cacheKey(req) {
  const [path, qs] = (req.originalUrl || req.url).split('?');
  if (!qs) return path;
  const parts = qs.split('&').map(kv => {
    const i = kv.indexOf('=');
    if (i < 0) return kv;
    const k = kv.slice(0, i), raw = decodeURIComponent(kv.slice(i + 1));
    const t = Date.parse(raw);
    if (!isNaN(t) && /^\d{4}-\d{2}-\d{2}/.test(raw)) return k + '=' + Math.round(t / BUCKET);  // bucketed
    return k + '=' + raw;
  });
  return path + '?' + parts.sort().join('&');    // sort → param order can't split the cache
}

function evictIfNeeded() {
  if (store.size <= MAX_ENTRIES) return;
  // drop the oldest quarter
  const byAge = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < Math.ceil(MAX_ENTRIES / 4); i++) store.delete(byAge[i][0]);
}

/* wrap(req, compute, { persist, warm }) → resolves to the body (cached or fresh). persist:false keeps the entry in
 * memory only — never in the on-disk snapshot — and warm:false keeps it out of the keep-warm loop (no audited
 * route gets re-fetched on a timer under the admin's name); both for answers that carry identifiers (the DMS pages). */
async function wrap(req, compute, opts) {
  const persist = !(opts && opts.persist === false);
  const warmable = !(opts && opts.warm === false);
  if (!TTL) return compute();
  const key = cacheKey(req);
  const now = Date.now();
  const e = store.get(key);

  /* cold miss still computing: a concurrent caller must SHARE the in-flight promise — before this
   * guard it fell into the stale path and was handed body:undefined, which surfaced downstream as
   * "Cannot read properties of undefined (reading 'ok')" (seen on the commissioning board, 31 Aug). */
  const viewer = !req.get?.('X-Cache-Warm');               // a real request, not the keep-warm loop
  if (e && viewer) { e.n = (e.n || 0) + 1; e.last = now; }
  if (e && e.at === 0 && e.building) { hits++; return e.building; }

  if (e && now - e.at < TTL) { hits++; return e.body; }

  if (e) {                                   // stale → return it now, refresh behind the scenes
    stale++;
    if (!e.building) {
      e.building = compute()
        .then(body => { store.set(key, { body, at: Date.now(), url: warmable ? (e.url || req.originalUrl) : null, n: e.n || 0, last: e.last || null, persist }); dirty = true; })
        .catch(() => {})                     // keep serving the old value on failure
        .finally(() => { if (store.get(key)) store.get(key).building = null; });
    }
    return e.body;
  }

  misses++;                                  // cold: single-flight so parallel callers share one run
  const pending = compute();
  store.set(key, { body: undefined, at: 0, building: pending });
  try {
    const body = await pending;
    store.set(key, { body, at: Date.now(), url: warmable ? req.originalUrl : null, n: 1, last: viewer ? now : null, persist });
    dirty = true;
    evictIfNeeded();
    return body;
  } catch (err) {
    store.delete(key);
    throw err;
  }
}

/* after a sync writes new data: mark everything STALE (served instantly + refreshed behind), never clear —
 * clearing meant every viewer paid the full recompute right after each sync tick */
function invalidate() { for (const e of store.values()) if (e.at > 1) e.at = 1; }
function stats() {
  const now = Date.now();
  return { entries: store.size, hits, misses, stale, ttlSec: TTL / 1000, file: FILE, warmTop: WARM_TOP, warmActiveMin: WARM_ACTIVE_MS / 60000,
    active: [...store.values()].filter(e => e.last && now - e.last < (WARM_ACTIVE_MS || Infinity)).length, lastWarm: warmLast };
}

module.exports = { wrap, invalidate, stats, save, startKeepWarm };
