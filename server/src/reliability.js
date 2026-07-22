/* Reliability hardening — rate limiting, security headers, error capture.
 * All dependency-free so it drops into the existing Express app.
 *
 *   securityHeaders  — sensible default headers (nosniff, frame, referrer, HSTS)
 *   rateLimit(opts)  — in-memory token bucket per client IP; strict variant for auth
 *   captureError     — persist an error to console_errors (+ optional ERROR_WEBHOOK)
 *   errorHandler     — Express 4-arg handler; installOn() also traps process crashes
 *   ready / version  — small ops endpoints
 */
const db = require('./db');
const C = db.console;

/* ---- security headers ---- */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (req.secure || (req.headers['x-forwarded-proto'] === 'https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

/* ---- rate limiter (fixed-window token bucket) ----
 * opts.keyFn(req)  → the bucket key. DEFAULT is per-IP, but the console sits behind a
 *                    shared corporate VPN egress, so many users share one IP. For the
 *                    general API we key by console USER instead (see api.js) so one office
 *                    can't collectively trip the limit. Auth endpoints stay per-IP (that's
 *                    the genuine brute-force surface).
 * opts.skip(req)   → return true to bypass entirely (e.g. health checks).
 * RATE_LIMIT_DISABLED=1 turns the limiter off globally (infra/WAF handles it instead). */
function clientIpOf(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown'; }
function rateLimit({ windowMs = 60_000, max = 120, key = 'default', keyFn = null, skip = null } = {}) {
  if (process.env.RATE_LIMIT_DISABLED === '1') return (_req, _res, next) => next();
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, windowMs).unref?.();
  return function (req, res, next) {
    if (skip && skip(req)) return next();
    const id = key + ':' + (keyFn ? keyFn(req) : clientIpOf(req));
    const now = Date.now();
    let e = hits.get(id);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(id, e); }
    e.count++;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - e.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(e.reset / 1000));
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many requests — slow down.' });
    }
    next();
  };
}

/* ---- error capture ---- */
async function captureError(err, ctx = {}) {
  const rec = {
    level: ctx.level || 'error',
    message: (err && err.message) ? String(err.message).slice(0, 500) : String(err).slice(0, 500),
    stack: (err && err.stack) ? String(err.stack).slice(0, 4000) : null,
    route: ctx.route || null, actor: ctx.actor || null, ip: ctx.ip || null,
    meta: ctx.meta || {}
  };
  try {
    await C.query(`INSERT INTO console_errors (level, message, stack, route, actor, ip, meta) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rec.level, rec.message, rec.stack, rec.route, rec.actor, rec.ip, JSON.stringify(rec.meta)]);
  } catch (e) { /* never let logging throw */ }
  // optional fan-out to an external sink (Slack/Teams/GlitchTip-style webhook)
  const hook = process.env.ERROR_WEBHOOK;
  if (hook && typeof fetch === 'function') {
    try { await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `⚠️ ${rec.level}: ${rec.message}${rec.route ? ' @ ' + rec.route : ''}` }) }); } catch (e) {}
  }
  return rec;
}

// Express error-handling middleware (must be registered last, 4 args).
function errorHandler(err, req, res, _next) {
  captureError(err, { route: `${req.method} ${req.path}`, actor: req.actor, ip: (req.headers['x-forwarded-for'] || req.ip) });
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : String(err.message || err) });
}

// Trap process-level crashes so one bad tick doesn't kill the server silently.
function installProcessTraps() {
  process.on('unhandledRejection', r => captureError(r instanceof Error ? r : new Error('unhandledRejection: ' + r), { level: 'error', route: 'process' }));
  process.on('uncaughtException', e => { captureError(e, { level: 'fatal', route: 'process' }); console.error('uncaughtException:', e && e.message); });
}

/* ---- ops endpoints ---- */
async function ready() {
  const out = { ok: true, checks: {} };
  for (const [name, pool] of [['source', db.source], ['console', db.console]]) {
    try { await pool.query('SELECT 1'); out.checks[name] = 'up'; }
    catch (e) { out.checks[name] = 'down'; out.ok = false; }
  }
  return out;
}
function version() {
  let v = '0.0.0';
  try { v = require('../package.json').version; } catch (e) {}
  return { version: v, commit: process.env.GIT_SHA || process.env.SOURCE_COMMIT || 'dev', node: process.version, startedAt: START };
}
const START = new Date().toISOString();

module.exports = { securityHeaders, rateLimit, captureError, errorHandler, installProcessTraps, ready, version };
