/* STATIC FAST (7 Oct 2026, "the console is very slow") — gzip + sane caching for the console's own files, no dependency.
 *
 * The console is plain files: index.html (240 KB) + 95 scripts (3.6 MB). Express' static handler sends them
 * uncompressed with max-age=0, and the reverse proxy does not compress upstream answers — so a cold load moved
 * 3.6 MB and a warm one made 95 conditional round trips through the VPN. This middleware, mounted BEFORE
 * express.static, answers text assets (js/css/html/json/svg/txt/md/map) itself:
 *   - gzip from an in-memory cache keyed by path + mtime + size (zlib level 6, ~4:1 on this code), rebuilt when
 *     the file changes on disk (a deploy), capped at STATIC_GZ_MAX_MB (64) of compressed bytes;
 *   - a strong ETag; If-None-Match → 304 in one round trip;
 *   - Cache-Control: index.html → no-cache (always re-validated, so a deploy is seen at the next load);
 *     a `?v=` versioned file (how index.html references every script) → max-age 1 day; anything else → 10 min.
 * Everything else (images, fonts, unknown types, Range requests, clients without gzip) falls through to
 * express.static untouched. STATIC_FAST_DISABLED=1 switches it off. */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');

const TYPES = { '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.map': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };
const MAX_BYTES = Math.max(8, Number(process.env.STATIC_GZ_MAX_MB) || 64) * 1048576;
const MIN_GZ = 1024;                                  // below this gzip is not worth the header
const cache = new Map();                              // abs path → { mtimeMs, size, etag, gz }
let cached = 0, hits = 0, served = 0;

function entry(abs, st) {
  const c = cache.get(abs);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c;
  const raw = fs.readFileSync(abs);
  const gz = raw.length >= MIN_GZ ? zlib.gzipSync(raw, { level: 6 }) : null;
  const etag = '"' + crypto.createHash('sha1').update(raw).digest('base64').slice(0, 27) + '"';
  if (c) cached -= c.gz ? c.gz.length : 0;
  const e = { mtimeMs: st.mtimeMs, size: st.size, etag, gz };
  cached += gz ? gz.length : 0;
  if (cached > MAX_BYTES) { cache.clear(); cached = gz ? gz.length : 0; }   // simple: start over rather than track LRU
  cache.set(abs, e);
  return e;
}

function middleware(root) {
  const ROOT = path.resolve(root);
  if (process.env.STATIC_FAST_DISABLED === '1') return (_req, _res, next) => next();
  return function staticFast(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.headers.range) return next();
    let p = req.path;
    try { p = decodeURIComponent(p); } catch (_) { return next(); }
    if (p.endsWith('/')) p += 'index.html';
    const ext = path.extname(p).toLowerCase(); const type = TYPES[ext]; if (!type) return next();
    const abs = path.resolve(ROOT, '.' + p);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return next();          // never outside the web root
    let st; try { st = fs.statSync(abs); } catch (_) { return next(); }
    if (!st.isFile()) return next();
    let e; try { e = entry(abs, st); } catch (_) { return next(); }
    const isIndex = /(^|[\\/])index\.html$/.test(abs);
    const cc = isIndex ? 'no-cache' : (req.query && req.query.v ? 'public, max-age=86400' : 'public, max-age=600');
    res.setHeader('Cache-Control', cc); res.setHeader('ETag', e.etag); res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Last-Modified', new Date(st.mtimeMs).toUTCString()); res.setHeader('Content-Type', type);
    if (req.headers['if-none-match'] === e.etag) { res.statusCode = 304; return res.end(); }
    const acceptGz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (e.gz && acceptGz) { hits++; res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Content-Length', e.gz.length); return req.method === 'HEAD' ? res.end() : res.end(e.gz); }
    served++;
    res.setHeader('Content-Length', st.size);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(abs).on('error', () => { try { res.destroy(); } catch (_) {} }).pipe(res);
  };
}
function stats() { return { files: cache.size, gzBytes: cached, gzipHits: hits, plainServed: served }; }

module.exports = { middleware, stats };
