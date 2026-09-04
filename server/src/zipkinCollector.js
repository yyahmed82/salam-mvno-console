/* APIGW distributed-trace COLLECTOR — pulls Zipkin spans from the MVNO API gateways and
 * distils them into the console's own Postgres (apigw_trace_stats + apigw_slow_spans).
 *
 * WHY PULL AND DISTIL, rather than query Zipkin live:
 *   Measured on MVNO-DIGAPI-GWP01 (2026-08-17): 4,124 spans/min (~250k/hour), storage is
 *   Zipkin's IN-MEMORY backend (~500k-span ceiling) → traces older than ~1–3h are GONE.
 *   Live querying would therefore answer "what happened yesterday?" with silence, and keeping
 *   6M spans/day raw is absurd. So: always aggregate per minute (tiny, permanent), and keep
 *   FULL spans only for outliers — errors and slow calls, which is what L2 actually opens.
 *
 * WHAT THIS UNLOCKS: the gateway hop was previously invisible. A trace looks like
 *   172.31.43.17 (Digital API) --SERVER--> trms-api-gateway --CLIENT--> 172.31.42.26:9047 (DMS)
 *                                                           --> rabbitmq --> dms-audit-log-consumer
 * so a case stops being "the app got an error" and becomes "gateway forwarded in 40ms, the DMS
 * backend took 1.2s" — attributable to a tier, with per-hop timing.
 *
 * TRANSPORT: plain HTTP GET /api/v2/traces (read-only; Zipkin's write API is never touched).
 * Requires firewall 152 → gateway:9411 — BLOCKED as of 2026-08-17, SOC request pending, so the
 * collector stays dormant until ZIPKIN_HOSTS is set. Unset = feature simply absent, as with
 * every other optional source.
 *
 * Env: ZIPKIN_HOSTS=172.31.43.9,172.31.43.10   (presence = collector ON)
 *      ZIPKIN_PORT (9411) · ZIPKIN_INTERVAL_SEC (60) · ZIPKIN_LOOKBACK_SEC (120, overlap by
 *      design — dedupe is by primary key) · ZIPKIN_TRACE_LIMIT (1500 traces/poll)
 *      ZIPKIN_SLOW_MS (3000 — span kept in full above this) · ZIPKIN_SLOW_CAP (40/poll/host)
 *      ZIPKIN_RETENTION_DAYS (30 for stats, slow spans use half)
 * Never throws into the app: every fetch/parse/DB error lands in per-host status. */
'use strict';

const http = require('http');
const db = require('./db');

const CFG = () => ({
  hosts: String(process.env.ZIPKIN_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
  port: Number(process.env.ZIPKIN_PORT) || 9411,
  intervalSec: Math.max(20, Number(process.env.ZIPKIN_INTERVAL_SEC) || 60),
  lookbackSec: Math.max(60, Number(process.env.ZIPKIN_LOOKBACK_SEC) || 120),
  traceLimit: Math.max(100, Number(process.env.ZIPKIN_TRACE_LIMIT) || 1500),
  slowMs: Math.max(200, Number(process.env.ZIPKIN_SLOW_MS) || 3000),
  slowCap: Math.max(5, Number(process.env.ZIPKIN_SLOW_CAP) || 40),
  retentionDays: Math.max(2, Number(process.env.ZIPKIN_RETENTION_DAYS) || 30)
});
const enabled = () => CFG().hosts.length > 0;

/* ---- path normalisation ---------------------------------------------------------------------
 * /api/customer/9665xxxx/orders/8821 → /api/customer/:id/orders/:id, otherwise every MSISDN
 * becomes its own aggregate row and the table explodes. Also drops the query string and, as a
 * side effect, keeps customer identifiers OUT of the stats table entirely. */
const normPath = p => {
  if (!p) return '-';
  return String(p).split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/[0-9a-f]{24,}/gi, '/:hash')
    .replace(/\/\d{3,}/g, '/:id')
    .slice(0, 200) || '/';
};
const pct = (sorted, p) => {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i]);
};

/* ---- HTTP (no deps; short timeout — a slow gateway must not stall the collector) ---------- */
function getJson(host, port, path, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path, timeout: timeoutMs,
      headers: { 'accept': 'application/json', 'user-agent': 'salam-console/apigw-collector' } },
      res => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        let buf = ''; let bytes = 0;
        res.setEncoding('utf8');
        res.on('data', c => {
          bytes += c.length;
          if (bytes > 40 * 1024 * 1024) { req.destroy(new Error('response too large')); return; }
          buf += c;
        });
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('bad JSON: ' + e.message)); } });
      });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/* ---- span → row ---------------------------------------------------------------------------- */
const TAG = (s, k) => (s.tags && s.tags[k] != null ? String(s.tags[k]) : null);
function spanInfo(s) {
  const tags = s.tags || {};
  const status = TAG(s, 'http.status_code');
  const err = tags.error != null ? String(tags.error).slice(0, 300)
    : (status && Number(status) >= 400 ? 'HTTP ' + status : null);
  return {
    traceId: s.traceId, spanId: s.id, parentId: s.parentId || null,
    service: (s.localEndpoint && s.localEndpoint.serviceName) || 'unknown',
    kind: s.kind || null, name: s.name || null,
    path: TAG(s, 'http.path') || TAG(s, 'http.route') || TAG(s, 'http.url'),
    method: (TAG(s, 'http.method') || '').toUpperCase() || null,
    status, err,
    tsMs: s.timestamp ? Math.round(s.timestamp / 1000) : null,
    durMs: s.duration ? Math.round(s.duration / 1000) : 0,
    remoteIp: (s.remoteEndpoint && s.remoteEndpoint.ipv4) || null,
    remoteService: (s.remoteEndpoint && s.remoteEndpoint.serviceName) || null,
    // the app-side join key; carried in some gateway spans as a tag
    uil: TAG(s, 'uilTransactionId') || TAG(s, 'uil.transaction.id') || TAG(s, 'transactionId'),
    tags
  };
}

/* ---- per-host state (mirrors apiLogCollector so the health strip reads the same shape) ---- */
const _state = new Map();
const st = h => {
  if (!_state.has(h)) _state.set(h, { lastError: null, lastRunAt: null, spans: 0, traces: 0, kept: 0, ms: null });
  return _state.get(h);
};

async function pollHost(host) {
  const c = CFG(); const s = st(host); const t0 = Date.now();
  try {
    const endTs = Date.now();
    const traces = await getJson(host, c.port,
      `/api/v2/traces?endTs=${endTs}&lookback=${c.lookbackSec * 1000}&limit=${c.traceLimit}`);
    if (!Array.isArray(traces)) throw new Error('unexpected payload');

    // 1) fold every span into per-minute aggregates
    const agg = new Map();      // key → { calls, errors, durs[], sum }
    const slow = [];
    let nSpans = 0;
    for (const trace of traces) {
      if (!Array.isArray(trace)) continue;
      for (const raw of trace) {
        const sp = spanInfo(raw);
        if (!sp.tsMs) continue;
        nSpans++;
        const bucket = new Date(Math.floor(sp.tsMs / 60000) * 60000).toISOString();
        const path = normPath(sp.path);
        const key = [bucket, sp.service, path, sp.method || '-'].join('');
        let a = agg.get(key);
        if (!a) { a = { bucket, service: sp.service, path, method: sp.method || '-', calls: 0, errors: 0, durs: [], sum: 0 }; agg.set(key, a); }
        a.calls++; a.sum += sp.durMs; a.durs.push(sp.durMs);
        if (sp.err) a.errors++;
        // 2) keep the full span only when it is an error or genuinely slow
        if (sp.err || sp.durMs >= c.slowMs) slow.push(sp);
      }
    }

    // 3) persist aggregates (UPSERT — overlapping polls re-state the same minute safely)
    const rows = [...agg.values()].map(a => {
      const d = a.durs.sort((x, y) => x - y);
      return [a.bucket, host, a.service, a.path, a.method, a.calls, a.errors,
        pct(d, 50), pct(d, 95), pct(d, 99), d[d.length - 1] || 0, a.sum];
    });
    if (rows.length) {
      const COLS = 12; const per = Math.max(1, Math.floor(60000 / COLS));
      for (let i = 0; i < rows.length; i += per) {
        const chunk = rows.slice(i, i + per);
        const vals = []; const params = [];
        chunk.forEach((r, j) => {
          vals.push('(' + r.map((_, k) => '$' + (j * COLS + k + 1)).join(',') + ')');
          params.push(...r);
        });
        await db.console.query(
          `INSERT INTO apigw_trace_stats
             (bucket,host,service,path,method,calls,errors,ms_p50,ms_p95,ms_p99,ms_max,ms_sum)
           VALUES ${vals.join(',')}
           ON CONFLICT (bucket,host,service,path,method) DO UPDATE SET
             calls=EXCLUDED.calls, errors=EXCLUDED.errors, ms_p50=EXCLUDED.ms_p50,
             ms_p95=EXCLUDED.ms_p95, ms_p99=EXCLUDED.ms_p99, ms_max=EXCLUDED.ms_max,
             ms_sum=EXCLUDED.ms_sum`, params);
      }
    }

    // 4) persist outlier spans — slowest first, hard-capped so a bad minute can't flood the DB
    slow.sort((a, b) => b.durMs - a.durMs);
    const keep = slow.slice(0, c.slowCap);
    for (const sp of keep) {
      await db.console.query(
        `INSERT INTO apigw_slow_spans
           (ts,host,trace_id,span_id,parent_id,service,kind,name,path,method,status_code,
            duration_ms,remote_ip,remote_service,error,uil_transaction_id,tags)
         VALUES (to_timestamp($1/1000.0),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [sp.tsMs, host, sp.traceId, sp.spanId, sp.parentId, sp.service, sp.kind, sp.name,
         normPath(sp.path), sp.method, sp.status, sp.durMs, sp.remoteIp, sp.remoteService,
         sp.err, sp.uil, JSON.stringify(sp.tags).slice(0, 4000)]).catch(() => {});
    }

    Object.assign(s, { lastError: null, lastRunAt: new Date().toISOString(),
      traces: traces.length, spans: nSpans, kept: keep.length, ms: Date.now() - t0 });
  } catch (e) {
    s.lastError = String(e.message || e).slice(0, 200);
    s.lastRunAt = new Date().toISOString(); s.ms = Date.now() - t0;
  }
}

async function purge() {
  const c = CFG();
  try {
    await db.console.query(`DELETE FROM apigw_trace_stats WHERE bucket < now() - ($1||' days')::interval`, [c.retentionDays]);
    await db.console.query(`DELETE FROM apigw_slow_spans  WHERE ts     < now() - ($1||' days')::interval`, [Math.max(1, Math.floor(c.retentionDays / 2))]);
  } catch (e) { /* non-fatal */ }
}

/* ---- live per-transaction search --------------------------------------------------------------
 * Zipkin's annotationQuery finds traces whose spans carry a given tag=value. The gateway stamps
 * the app's transaction id as a tag (observed keys vary by service), so this turns a
 * transaction_id from api_traffic_events into the FULL gateway trace — every hop with timing —
 * as long as the trace is still inside Zipkin's in-memory retention (~1–3h). Older calls fall
 * back to apigw_slow_spans, which keeps errors + slow calls forever. */
const TAG_KEYS = ['uilTransactionId', 'transactionId', 'uil.transaction.id'];
async function findByTag(value, { lookbackSec = 4 * 3600, limit = 5 } = {}) {
  const c = CFG();
  if (!enabled()) return [];
  const v = String(value || '').trim();
  if (!v || v.length > 64) return [];
  const out = [];
  for (const host of c.hosts) {
    for (const key of TAG_KEYS) {
      try {
        const traces = await getJson(host, c.port,
          `/api/v2/traces?annotationQuery=${encodeURIComponent(`${key}=${v}`)}` +
          `&endTs=${Date.now()}&lookback=${lookbackSec * 1000}&limit=${limit}`, 8000);
        if (Array.isArray(traces)) {
          for (const trace of traces) if (Array.isArray(trace))
            for (const raw of trace) out.push(spanInfo(raw));
        }
        if (out.length) return out;              // first matching key wins — keys are aliases
      } catch (e) { /* host/key miss → try next */ }
    }
  }
  return out;
}

/* Fallback when no service tags the transaction id (verified 17 Aug: the id travels in RESPONSE
 * BODIES, which Zipkin does not index): find the NEAREST trace for the same endpoint around the
 * app call's start time. Approximate by construction — the caller must label it as such — but at
 * gateway volumes the nearest same-path trace within a couple of minutes is almost always the
 * right call, and the full hop waterfall it yields is exactly what an investigation needs. */
async function findByPathNear(paths, tsMs, { windowMs = 180000, limit = 60 } = {}) {
  const c = CFG();
  if (!enabled() || !tsMs) return { spans: [], matchedPath: null };
  for (const host of c.hosts) {
    for (const p of paths) {
      if (!p || p === '/') continue;
      try {
        const traces = await getJson(host, c.port,
          `/api/v2/traces?annotationQuery=${encodeURIComponent('http.path=' + p)}` +
          `&endTs=${tsMs + windowMs}&lookback=${2 * windowMs}&limit=${limit}`, 8000);
        if (!Array.isArray(traces) || !traces.length) continue;
        let best = null, bestD = Infinity;
        for (const t of traces) {
          if (!Array.isArray(t)) continue;
          const info = t.map(spanInfo);
          for (const s of info) {
            if (s.path !== p || !s.tsMs) continue;
            const d = Math.abs(s.tsMs - tsMs);
            if (d < bestD) { bestD = d; best = info; }
          }
        }
        if (best) return { spans: best, matchedPath: p, distanceMs: bestD };
      } catch (e) { /* host/path miss → next candidate */ }
    }
  }
  return { spans: [], matchedPath: null };
}

let _timer = null, _purgeTimer = null;
async function tick() {
  const c = CFG();
  for (const h of c.hosts) await pollHost(h);       // sequential: never two gateways at once
}
function start() {
  if (!enabled()) { console.log('[APIGW] trace collector idle — ZIPKIN_HOSTS not set'); return; }
  const c = CFG();
  console.log(`[APIGW] trace collector armed — every ${c.intervalSec}s · hosts: ${c.hosts.join(', ')}:${c.port} · slow>${c.slowMs}ms`);
  tick();
  _timer = setInterval(() => tick().catch(() => {}), c.intervalSec * 1000);
  _purgeTimer = setInterval(() => purge().catch(() => {}), 6 * 3600 * 1000);
  if (_timer.unref) _timer.unref();
  if (_purgeTimer.unref) _purgeTimer.unref();
}
function stop() { if (_timer) clearInterval(_timer); if (_purgeTimer) clearInterval(_purgeTimer); _timer = _purgeTimer = null; }
const status = () => ({
  configured: enabled(), ...CFG(),
  hosts: CFG().hosts.map(h => ({ host: h, ...st(h) }))
});

module.exports = { start, stop, status, tick, enabled, normPath, spanInfo, findByTag, findByPathNear };

// CLI: node zipkinCollector.js --once   (one pass, for testing from 152)
if (require.main === module && process.argv.includes('--once')) {
  if (!enabled()) { console.error('ZIPKIN_HOSTS not set'); process.exit(1); }
  tick().then(() => { console.log(JSON.stringify(status(), null, 2)); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
}
