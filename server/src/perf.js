/* PERF — where the console's time goes (7 Oct 2026, "the console is very slow").
 *
 * Zero-dependency instrumentation of the ONE Node process that serves every page and runs ~45
 * background collectors: when it is slow, this answers *which* of the four usual suspects it is —
 *   1. the event loop is blocked (a collector parsing MBs of log, a big JSON, GC)  → `loop` + `[LAG]` log lines
 *   2. the box has no CPU for it (Ollama / llama.cpp on the same 8 vCPU)           → `cpu` (process) vs `load` (box)
 *   3. the database is slow or the pool is full (waiting for a connection)         → `db.pools.*.waiting`, `db.queries`
 *   4. one route is slow by itself                                                 → `requests.routes` (p50/p95/max), `[SLOW]` log lines
 *
 * GET /api/perf (adminTools) · ?reset=1 clears the counters · PERF_SLOW_MS (default 1500) = what is logged as [SLOW]
 * PERF_DISABLED=1 turns the whole thing off. Cost: one hrtime per request, one hrtime per pool.query,
 * a 10 ms-resolution loop-delay histogram — well under 1 % of a core. */
'use strict';
const { monitorEventLoopDelay, performance, PerformanceObserver } = require('perf_hooks');
const os = require('os');

const ON = process.env.PERF_DISABLED !== '1';
const SLOW_MS = Math.max(100, Number(process.env.PERF_SLOW_MS) || 1500);
const SLOW_Q_MS = Math.max(100, Number(process.env.PERF_SLOW_QUERY_MS) || 2000);
const KEEP_MIN = 180;                    // minutes of loop / cpu history kept
const SAMPLE = 256;                      // durations kept per route for percentiles
const since = new Date();
const ms = v => Math.round(v * 10) / 10;

/* ---- event loop ---- */
const h = ON ? monitorEventLoopDelay({ resolution: 10 }) : null; if (h) h.enable();   // values at/under ~10 ms mean "no lag" (the sampling floor)
const loopMinutes = [];                  // [{t, p50, p95, max}] one per minute
const stalls = [];                       // worst blocked moments (lag detector: a 1 s timer firing late)
let lastTick = Date.now();
function lagTick() {
  const now = Date.now(); const late = now - lastTick - 1000; lastTick = now;
  if (late > 500) {
    stalls.push({ at: new Date(now).toISOString(), blockedMs: late });
    if (stalls.length > 40) stalls.sort((a, b) => b.blockedMs - a.blockedMs).splice(30);
    console.warn(`[LAG] event loop blocked ~${late} ms (a collector / parse / GC ran that long without yielding)`);
  }
}
function minuteTick() {
  const c = cpuSample();
  loopMinutes.push({ t: new Date().toISOString().slice(0, 16), p50: h ? ms(h.percentile(50) / 1e6) : null, p95: h ? ms(h.percentile(95) / 1e6) : null, max: h ? ms(h.max / 1e6) : null,
    cpuPct: c.pct, rssMb: Math.round(process.memoryUsage().rss / 1048576), load1: ms(os.loadavg()[0]), req: minuteReq, slow: minuteSlow, waiting: minuteWaiting });
  minuteReq = 0; minuteSlow = 0; minuteWaiting = 0;
  if (loopMinutes.length > KEEP_MIN) loopMinutes.shift();
  if (h) h.reset();
}
let minuteReq = 0, minuteSlow = 0, minuteWaiting = 0;

/* ---- process CPU (share of ONE core; 100 = a full core) ---- */
let cpuPrev = process.cpuUsage(), cpuPrevAt = performance.now();
function cpuSample() {
  const u = process.cpuUsage(cpuPrev), now = performance.now(), el = (now - cpuPrevAt) * 1000;   // µs
  cpuPrev = process.cpuUsage(); cpuPrevAt = now;
  return { pct: el > 0 ? ms(100 * (u.user + u.system) / el) : null };
}

/* ---- GC ---- */
const gc = { count: 0, ms: 0, major: 0, majorMs: 0, maxMs: 0 };
if (ON) {
  try {
    const obs = new PerformanceObserver(list => { for (const e of list.getEntries()) { gc.count++; gc.ms += e.duration; if (e.duration > gc.maxMs) gc.maxMs = e.duration;
      const kind = e.detail ? e.detail.kind : e.kind; if (kind === 2 || kind === 4) { gc.major++; gc.majorMs += e.duration; } } });
    obs.observe({ entryTypes: ['gc'] });
  } catch (_) {}
}

/* ---- requests ---- */
const routes = new Map();                // template → { n, ms, max, err, slow, s: ring }
const slowList = [];                     // last 60 slow requests
let inflight = 0, maxInflight = 0, total = 0;
const ID_RX = [[/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ':uuid'], [/^\d+$/, ':n'], [/^[0-9a-f]{16,}$/i, ':hex'], [/@/, ':email'], [/\d{5,}/, ':id']];
function templ(req) {
  const p = (req.baseUrl || '') + (req.path || req.url.split('?')[0]);
  const segs = p.split('/').map(s => { for (const [rx, t] of ID_RX) if (rx.test(s)) return t; return s; });
  let key = req.method + ' ' + segs.join('/');
  if (key.length > 120) key = key.slice(0, 120);
  return key;
}
function rec(key, dur, status, actor, url) {
  let r = routes.get(key);
  if (!r) { if (routes.size >= 500) key = 'OTHER'; r = routes.get(key); if (!r) { r = { n: 0, ms: 0, max: 0, err: 0, slow: 0, s: [], si: 0 }; routes.set(key, r); } }
  r.n++; r.ms += dur; if (dur > r.max) r.max = dur; if (status >= 500) r.err++;
  if (r.s.length < SAMPLE) r.s.push(dur); else { r.s[r.si] = dur; r.si = (r.si + 1) % SAMPLE; }
  if (dur >= SLOW_MS) { r.slow++; minuteSlow++;
    slowList.push({ at: new Date().toISOString(), ms: Math.round(dur), status, route: key, url: String(url || '').slice(0, 160), actor: String(actor || '').split('@')[0], inflight });
    if (slowList.length > 60) slowList.shift();
    console.warn(`[SLOW] ${Math.round(dur)} ms ${status} ${key} ${String(url || '').slice(0, 120)} actor=${String(actor || '').split('@')[0] || '-'} inflight=${inflight}`);
  }
}
function middleware(req, res, next) {
  if (!ON || req.path === '/stream') return next();          // the SSE stream stays open for hours — not a request time
  const t0 = performance.now(); inflight++; total++; minuteReq++; if (inflight > maxInflight) maxInflight = inflight;
  let done = false;
  const fin = () => { if (done) return; done = true; inflight--; rec(templ(req), performance.now() - t0, res.statusCode, req.actor || req.get('X-Console-User'), req.originalUrl); };
  res.on('finish', fin); res.on('close', fin);
  next();
}

/* ---- database: pool pressure + query time (pg pools: pool.query only — pool.connect()/client.query are not timed) ---- */
const pools = {};                        // name → { pool, q: { n, ms, max, err, slow: [] }, maxWaiting, waitSamples, samples }
function watchPool(name, pool) {
  if (!ON || !pool || typeof pool.query !== 'function' || pools[name]) return;
  const P = { pool, q: { n: 0, ms: 0, max: 0, err: 0, slow: [] }, maxWaiting: 0, waitSamples: 0, samples: 0 };
  pools[name] = P;
  const timed = (orig, label) => function (...args) {
    if (typeof args[args.length - 1] === 'function') return orig(...args);          // callback style: pass through
    const t0 = performance.now();
    const sql = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].text) || '';
    const fin = (err) => { const d = performance.now() - t0; P.q.n++; P.q.ms += d; if (d > P.q.max) P.q.max = d; if (err) P.q.err++;
      if (d >= SLOW_Q_MS) { P.q.slow.push({ at: new Date().toISOString(), ms: Math.round(d), err: err ? String(err.message).slice(0, 80) : null, via: label, sql: String(sql).replace(/\s+/g, ' ').trim().slice(0, 160) }); if (P.q.slow.length > 40) P.q.slow.shift(); } };
    let p; try { p = orig(...args); } catch (e) { fin(e); throw e; }
    if (!p || typeof p.then !== 'function') return p;
    return p.then(r => { fin(); return r; }, e => { fin(e); throw e; });
  };
  pool.query = timed(pool.query.bind(pool), 'query');
  /* checked-out clients too (7 Oct 2026): prod-sync, the refund detectors, the visitor probe and the index builder all
   * run on pool.connect() clients, which the first version never saw — their statements now land in the same slow
   * list, marked via:'client'. Only the client's own query() is wrapped; release() and events are untouched. */
  if (typeof pool.connect === 'function') {
    const origConnect = pool.connect.bind(pool);
    pool.connect = function (...args) {
      if (typeof args[args.length - 1] === 'function') return origConnect(...args);  // callback style: pass through
      return origConnect(...args).then(client => {
        if (client && typeof client.query === 'function' && !client.__perfWrapped) {
          client.query = timed(client.query.bind(client), 'client'); client.__perfWrapped = true;
        }
        return client;
      });
    };
  }
}
function samplePools() {
  for (const P of Object.values(pools)) { const w = Number(P.pool.waitingCount || 0); P.samples++; if (w > 0) P.waitSamples++; if (w > P.maxWaiting) P.maxWaiting = w; if (w > minuteWaiting) minuteWaiting = w; }
}

/* ---- timers (unref: never keep the process alive) ---- */
if (ON) {
  setInterval(lagTick, 1000).unref?.();
  setInterval(minuteTick, 60000).unref?.();
  setInterval(samplePools, 5000).unref?.();
}

/* ---- report ---- */
function pct(arr, p) { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return ms(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]); }
function report(q) {
  if (q && q.reset === '1') reset();
  const rs = [...routes.entries()].map(([k, r]) => ({ route: k, n: r.n, totalMs: Math.round(r.ms), avgMs: ms(r.ms / r.n), p50: pct(r.s, 0.5), p95: pct(r.s, 0.95), maxMs: Math.round(r.max), slow: r.slow, err5xx: r.err }))
    .sort((a, b) => b.totalMs - a.totalMs);
  const m = process.memoryUsage();
  const last = loopMinutes[loopMinutes.length - 1] || null;
  const avg = (k, n) => { const a = loopMinutes.slice(-n).map(x => x[k]).filter(v => v != null); return a.length ? ms(a.reduce((s, v) => s + v, 0) / a.length) : null; };
  return {
    since: since.toISOString(), uptimeMin: Math.round(process.uptime() / 60), pid: process.pid, node: process.version, slowMs: SLOW_MS, slowQueryMs: SLOW_Q_MS,
    box: { cpus: os.cpus().length, load: os.loadavg().map(v => ms(v)), memFreeMb: Math.round(os.freemem() / 1048576), memTotalMb: Math.round(os.totalmem() / 1048576) },
    process: { cpuPctLastMin: last ? last.cpuPct : null, cpuPct5m: avg('cpuPct', 5), cpuPct60m: avg('cpuPct', 60), rssMb: Math.round(m.rss / 1048576), heapUsedMb: Math.round(m.heapUsed / 1048576), heapTotalMb: Math.round(m.heapTotal / 1048576), external: Math.round(m.external / 1048576) },
    loop: { nowMs: h ? { p50: ms(h.percentile(50) / 1e6), p95: ms(h.percentile(95) / 1e6), max: ms(h.max / 1e6) } : null, p95Avg5m: avg('p95', 5), p95Avg60m: avg('p95', 60), maxAvg60m: avg('max', 60),
      stalls: [...stalls].sort((a, b) => b.blockedMs - a.blockedMs).slice(0, 20), minutes: loopMinutes.slice(-60) },
    gc: { count: gc.count, totalMs: Math.round(gc.ms), major: gc.major, majorMs: Math.round(gc.majorMs), maxMs: Math.round(gc.maxMs) },
    requests: { total, inflight, maxInflight, slowCount: rs.reduce((s, r) => s + r.slow, 0), slow: [...slowList].reverse(), routes: rs.slice(0, 80) },
    db: Object.fromEntries(Object.entries(pools).map(([k, P]) => [k, { total: P.pool.totalCount, idle: P.pool.idleCount, waiting: P.pool.waitingCount, max: P.pool.options && P.pool.options.max,
      maxWaiting: P.maxWaiting, waitPct: P.samples ? ms(100 * P.waitSamples / P.samples) : 0,
      queries: { n: P.q.n, totalMs: Math.round(P.q.ms), avgMs: P.q.n ? ms(P.q.ms / P.q.n) : 0, maxMs: Math.round(P.q.max), errors: P.q.err, slow: [...P.q.slow].reverse().slice(0, 25) } }]))
  };
}
function reset() {
  routes.clear(); slowList.length = 0; stalls.length = 0; total = 0; maxInflight = inflight;
  for (const P of Object.values(pools)) { P.q = { n: 0, ms: 0, max: 0, err: 0, slow: [] }; P.maxWaiting = 0; P.waitSamples = 0; P.samples = 0; }
  gc.count = 0; gc.ms = 0; gc.major = 0; gc.majorMs = 0; gc.maxMs = 0;
}

module.exports = { middleware, watchPool, report, reset, ON };
