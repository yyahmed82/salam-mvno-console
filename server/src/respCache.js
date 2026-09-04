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

const store = new Map();     // key → { body, at, building }
let hits = 0, misses = 0, stale = 0;

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
  if (e && e.at === 0 && e.building) { hits++; return e.building; }

  if (e && now - e.at < TTL) { hits++; return e.body; }

  if (e) {                                   // stale → return it now, refresh behind the scenes
    stale++;
    if (!e.building) {
      e.building = compute()
        .then(body => { store.set(key, { body, at: Date.now() }); })
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
    store.set(key, { body, at: Date.now() });
    evictIfNeeded();
    return body;
  } catch (err) {
    store.delete(key);
    throw err;
  }
}

function invalidate() { store.clear(); }     // called after a sync writes new data
function stats() { return { entries: store.size, hits, misses, stale, ttlSec: TTL / 1000 }; }

module.exports = { wrap, invalidate, stats };
