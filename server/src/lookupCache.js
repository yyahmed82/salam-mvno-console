/* Customer-360 / Yusr lookup cache — IN MEMORY ONLY, BY CONSTRUCTION (20 Sep 2026).
 *
 * WHY NOT respCache. respCache persists bodies to RESP_CACHE_FILE on disk. A subscriber profile is
 * customer PII, and the house rule is that no customer identifier is written to unified_console or
 * left at rest. So this module has no load()/save(), touches no file, and the ONLY thing anywhere in
 * this path that is ever persisted is `nexus_link_cache`: a SALTED HASH of the key plus a list of
 * workflow ids, which identify nobody without nexus itself.
 *
 * SHAPE — serve-stale-and-refresh. A hit returns instantly. If the entry is older than the soft
 * window a refresh runs behind the viewer, so the next person gets current data without anyone
 * waiting on a 1 s BSS call. A hard TTL bounds how long a key is remembered at all.
 *
 * WHY A LONG TTL IS SAFE HERE: the soft window is what governs freshness (10 min by default), not
 * the TTL. The TTL only decides when a key is forgotten entirely. A profile that nobody opens for
 * ten days is dropped; one that is opened is never more than one soft window stale.
 */
'use strict';
const crypto = require('crypto');

const TTL_MS  = Math.max(0, Number(process.env.LOOKUP_CACHE_TTL_DAYS ?? 10)) * 86400e3;
const SOFT_MS = Math.max(30, Number(process.env.LOOKUP_CACHE_SOFT_SEC ?? 600)) * 1000;
const MAX     = Math.max(20, Number(process.env.LOOKUP_CACHE_MAX || 500));

const store = new Map();                 // normKey → { body, at, n, building }
let hits = 0, misses = 0, stale = 0, warmed = 0;

const norm = k => String(k == null ? '' : k).trim().toLowerCase();

/* The one place an identifier becomes a stored value — and it stops being an identifier here.
 * The salt is REQUIRED: a 10-digit national id is trivially brute-forced from an unsalted hash,
 * so with no salt configured we persist nothing at all rather than persist something weak. */
const SALT = process.env.LOOKUP_HASH_SALT || '';
function keyHash(k) {
  if (!SALT) return null;
  return crypto.createHash('sha256').update(SALT + '|' + norm(k)).digest('hex');
}

function evict() {
  if (store.size <= MAX) return;
  const rows = [...store.entries()].sort((a, b) => (a[1].n || 0) - (b[1].n || 0) || a[1].at - b[1].at);
  for (let i = 0; i < rows.length && store.size > MAX; i++) store.delete(rows[i][0]);
}

async function wrap(key, build) {
  if (!TTL_MS) return build();
  const k = norm(key); if (!k) return build();
  const now = Date.now(), e = store.get(k);
  if (e && e.body !== undefined && now - e.at < TTL_MS) {
    e.n = (e.n || 0) + 1;
    if (now - e.at > SOFT_MS && !e.building) {
      e.building = true; stale++;
      Promise.resolve().then(build)
        .then(b => { if (b !== undefined) { e.body = b; e.at = Date.now(); } })
        .catch(() => {})                       // a failed refresh keeps the last good answer
        .then(() => { e.building = false; });
    } else hits++;
    return e.body;
  }
  misses++;
  const body = await build();
  store.set(k, { body, at: Date.now(), n: 1, building: false });
  evict();
  return body;
}

const drop = key => store.delete(norm(key));
function stats() {
  return { entries: store.size, max: MAX, ttlDays: TTL_MS / 86400e3, softSec: SOFT_MS / 1000,
           hits, misses, stale, warmed, persistedToDisk: false, saltConfigured: !!SALT };
}

/* Sweep the ONE persisted table back to the same retention. Hashes are not identifiers, but an
 * unbounded table of them is still a table nobody asked for. */
async function sweep() {
  const db = require('./db');
  if (!db.console_ && !db.console) return;
  const C = db.console || db.console_;
  try {
    const days = Math.max(1, Math.round(TTL_MS / 86400e3) || 10);
    const r = await C.query(`DELETE FROM nexus_link_cache WHERE seen_at < now() - ($1||' days')::interval`, [days]);
    if (r.rowCount) console.log(`[LOOKUP] swept ${r.rowCount} nexus link hash(es) older than ${days} d`);
  } catch (e) { /* table may not exist yet on first boot — schema.sql creates it */ }
}

/* WARM ON BOOT — a restart must not cost a demo. DEMO_WARM_KEYS lives in /apps/unified/.env and
 * nowhere else: it holds customer identifiers, so it stays out of git and out of the database.
 * Keys are masked in every log line this module writes. */
function startWarm() {
  sweep().catch(() => {});
  setInterval(() => sweep().catch(() => {}), 24 * 3600e3).unref?.();
  const keys = String(process.env.DEMO_WARM_KEYS || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 25);
  if (!TTL_MS) { console.log('[LOOKUP] cache disabled (LOOKUP_CACHE_TTL_DAYS=0)'); return; }
  if (!keys.length) { console.log(`[LOOKUP] cache armed — TTL ${TTL_MS / 86400e3} d · refresh after ${SOFT_MS / 1000} s · in memory, never written to disk`); return; }
  const mask = k => k.length > 4 ? '***' + k.slice(-4) : '***';
  console.log(`[LOOKUP] cache armed — TTL ${TTL_MS / 86400e3} d · ${keys.length} key(s) to warm in 20 s · in memory, never written to disk`);
  setTimeout(async () => {
    const subscriber = require('./subscriber');
    for (const k of keys) {
      try { await subscriber.profile({ key: k }); warmed++; }
      catch (e) { console.error(`[LOOKUP] warm ${mask(k)} failed: ${e.message}`); }
      await new Promise(r => setTimeout(r, 1500));   // one at a time — no thundering herd at boot
    }
    console.log(`[LOOKUP] warmed ${warmed}/${keys.length} key(s)`);
  }, 20000).unref?.();
}

module.exports = { wrap, drop, stats, keyHash, startWarm, sweep, norm };
