/* Server-side login sessions — replaces the old "trust the X-Console-User header" model.
 * verify-otp issues a random token; the client sends it as X-Console-Token; the server maps
 * token → email. Only the SHA-256 of the token is stored. Sliding expiry (default 12h idle,
 * SESSION_TTL_HOURS to change). In-memory cache keeps the per-request cost near zero. */
const crypto = require('crypto');
const db = require('./db');

const TTL_H = Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 12);
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// tiny cache: token_hash → { email, until } (re-validated against DB every 60s)
const cache = new Map();
const CACHE_MS = 60_000;

async function create(email) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.console.query(
    `INSERT INTO console_sessions (token_hash, email, expires_at)
     VALUES ($1, $2, now() + ($3||' hours')::interval)`, [sha(token), email, TTL_H]);
  return token;
}

async function lookup(token) {
  if (!token) return null;
  const h = sha(token);
  const hit = cache.get(h);
  if (hit && hit.until > Date.now()) return hit.email;
  const r = await db.console.query(
    `UPDATE console_sessions SET last_seen = now(), expires_at = now() + ($2||' hours')::interval
     WHERE token_hash = $1 AND expires_at > now() RETURNING email`, [h, TTL_H]);
  if (!r.rowCount) { cache.delete(h); return null; }
  const email = r.rows[0].email;
  cache.set(h, { email, until: Date.now() + CACHE_MS });
  return email;
}

async function destroy(token) {
  if (!token) return;
  const h = sha(token);
  cache.delete(h);
  await db.console.query(`DELETE FROM console_sessions WHERE token_hash = $1`, [h]);
}

async function destroyAllFor(email) {
  cache.clear();
  await db.console.query(`DELETE FROM console_sessions WHERE email = $1`, [email]);
}

// housekeeping: purge expired rows (called opportunistically)
async function purge() {
  try { await db.console.query(`DELETE FROM console_sessions WHERE expires_at < now()`); } catch (_) {}
}
setInterval(purge, 6 * 3600e3).unref();

module.exports = { create, lookup, destroy, destroyAllFor, purge };
