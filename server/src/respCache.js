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

const store = new Map();     // key → { body, at, building, url, n }
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
    let n = 0;
    for (const [k, e] of Object.entries(j.entries || {})) { if (e && e.body !== undefined) { store.set(k, { body: e.body, at: 1, url: e.url, n: e.n || 0 }); n++; } }
    console.log(`[CACHE] restored ${n} responses from ${FILE} (served stale, refreshed in the background)`);
  } catch (e) { if (e.code !== 'ENOENT') console.error('[CACHE] restore failed:', e.message); }
}
function save(reason) {
  if (!TTL || !dirty) return;
  try {
    const entries = {};
    for (const [k, e] of store) if (e.body !== undefined && e.at > 0) entries[k] = { body: e.body, url: e.url, n: e.n || 0, at: e.at };
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
function startKeepWarm() {
  if (!TTL || !WARM_TOP) return;
  const port = process.env.PORT || 4600;
  const hdr = { 'X-Console-User': process.env.CONSOLE_ADMIN_USER || 'y.yahmed.sns@salam.sa', 'X-Demo-Bypass': '1', 'X-Cache-Warm': '1' };
  const cycle = async () => {
    const now = Date.now();
    const hot = [...store.values()].filter(e => e.url && e.body !== undefined && !e.building && now - e.at > TTL * 0.8).sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, WARM_TOP);
    for (const e of hot) { try { const r = await fetch(`http://127.0.0.1:${port}${e.url}`, { headers: hdr, signal: AbortSignal.timeout(60000) }); await r.arrayBuffer(); } catch (_) {} }
  };
  setInterval(() => { cycle().catch(() => {}); }, Math.max(60000, TTL)).unref?.();
  console.log(`[CACHE] keep-warm armed — top ${WARM_TOP} hot responses refreshed every ${Math.round(Math.max(60000, TTL) / 1000)} s`);
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

/* wrap(req, compute) → resolves to the body (cached or fresh) */
async function wrap(req, compute) {
  if (!TTL) return compute();
  const key = cacheKey(req);
  const now = Date.now();
  const e = store.get(key);

  /* cold miss still computing: a concurrent caller must SHARE the in-flight promise — before this
   * guard it fell into the stale path and was handed body:undefined, which surfaced downstream as
   * "Cannot read properties of undefined (reading 'ok')" (seen on the commissioning board, 31 Aug). */
  if (e && !req.get?.('X-Cache-Warm')) e.n = (e.n || 0) + 1;
  if (e && e.at === 0 && e.building) { hits++; return e.building; }

  if (e && now - e.at < TTL) { hits++; return e.body; }

  if (e) {                                   // stale → return it now, refresh behind the scenes
    stale++;
    if (!e.building) {
      e.building = compute()
        .then(body => { store.set(key, { body, at: Date.now(), url: e.url || req.originalUrl, n: e.n || 0 }); dirty = true; })
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
    store.set(key, { body, at: Date.now(), url: req.originalUrl, n: 1 });
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
function stats() { return { entries: store.size, hits, misses, stale, ttlSec: TTL / 1000, file: FILE, warmTop: WARM_TOP }; }

module.exports = { wrap, invalidate, stats, save, startKeepWarm };
