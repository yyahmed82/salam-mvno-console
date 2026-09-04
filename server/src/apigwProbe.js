/* API Gateway connectivity probe — TCP-connects to the DMS API-gateway nodes from inside the console
 * container and reports per-node reachability, so the API GW topology page shows LIVE status instead
 * of a hardcoded "Online" strip. READ-ONLY: it only opens and immediately closes a TCP socket (no data
 * sent), exactly like the manual `node -e net.connect` check.
 *
 * Confirmed reachable from the console segment (2026-08-02):
 *   172.31.43.9:8443, 172.31.43.10:8443  → GW cluster GWP01/02 (listen on 8443, not 443)
 *   172.31.43.61:3000                     → DMS internal entry
 * Firewalled from the console segment: 172.31.45.1 (DMZ VIP) and the 172.31.42.x GW pair.
 *
 * Tunables (env):
 *   APIGW_TARGETS         override the target list — "host:port:label:node" items, comma-separated
 *   APIGW_PROBE_INTERVAL_SEC  default 30   ·  APIGW_PROBE_TIMEOUT_MS default 3000
 *   APIGW_PROBE_AUTO=0     disable the background timer (endpoint still works on demand)
 */
const net = require('net');

const TIMEOUT = Math.max(500, Number(process.env.APIGW_PROBE_TIMEOUT_MS) || 3000);
const INTERVAL = Math.max(5, Number(process.env.APIGW_PROBE_INTERVAL_SEC) || 30);

// node = which SVG node in apigw.html this target belongs to (lb / apigw / apigw-dms).
const DEFAULT_TARGETS = [
  { node: 'lb',        label: 'LB VIP (apigw.salammobile.sa)', host: '172.31.45.1',  port: 443  },
  { node: 'apigw',     label: 'GWP01',                         host: '172.31.43.9',  port: 8443 },
  { node: 'apigw',     label: 'GWP02',                         host: '172.31.43.10', port: 8443 },
  { node: 'apigw',     label: 'GWP03',                         host: '172.31.42.23', port: 8443 },
  { node: 'apigw',     label: 'GWP04',                         host: '172.31.42.24', port: 8443 },
  { node: 'apigw-dms', label: 'DMS Entry',                     host: '172.31.43.61', port: 3000 },
];

function parseTargets() {
  const raw = (process.env.APIGW_TARGETS || '').trim();
  if (!raw) return DEFAULT_TARGETS;
  const out = [];
  for (const item of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const [host, port, label, node] = item.split(':');
    if (host && port) out.push({ host, port: Number(port), label: label || `${host}:${port}`, node: node || 'apigw' });
  }
  return out.length ? out : DEFAULT_TARGETS;
}
const TARGETS = parseTargets();

let _last = null, _timer = null;

// One TCP connect attempt. Never sends data; resolves to a state we can colour on the map.
function probeOne(t) {
  return new Promise(resolve => {
    const started = Date.now();
    const s = net.connect({ host: t.host, port: t.port });
    let done = false;
    const finish = (state, code) => {
      if (done) return; done = true;
      try { s.destroy(); } catch (_) {}
      resolve({ host: t.host, port: t.port, label: t.label, node: t.node, state, code: code || null, ms: Date.now() - started });
    };
    s.setTimeout(TIMEOUT);
    s.on('connect', () => finish('ok'));
    s.on('timeout', () => finish('timeout', 'ETIMEDOUT'));         // firewalled / no route back
    s.on('error', e => {
      // ECONNREFUSED = host alive but nothing on that port (routing is fine); everything else = blocked.
      finish(e && e.code === 'ECONNREFUSED' ? 'refused' : 'unreachable', e && e.code);
    });
  });
}

// Roll per-target results up to per-node status for the three SVG nodes.
function rollup(targets) {
  const nodes = {};
  for (const r of targets) {
    const n = (nodes[r.node] ||= { node: r.node, up: 0, total: 0, best_ms: null });
    n.total++;
    if (r.state === 'ok') { n.up++; n.best_ms = n.best_ms == null ? r.ms : Math.min(n.best_ms, r.ms); }
  }
  for (const n of Object.values(nodes)) {
    n.state = n.up === 0 ? 'down' : (n.up < n.total ? 'degraded' : 'ok');
  }
  return nodes;
}

async function probeOnce() {
  const targets = await Promise.all(TARGETS.map(probeOne));
  const nodes = rollup(targets);
  const okCount = targets.filter(t => t.state === 'ok').length;
  _last = {
    at: new Date().toISOString(),
    targets, nodes,
    summary: { total: targets.length, ok: okCount, reachable_nodes: Object.values(nodes).filter(n => n.state !== 'down').length, total_nodes: Object.keys(nodes).length },
  };
  persist(targets).catch(() => {});     // best-effort; a logging failure must never break the probe
  return _last;
}

/* Persist each probe so reachability can be a METRIC (charts, history, replay) instead of a value
 * that only exists in this process's memory. Writes are fire-and-forget and pruned to 7 days. */
let _pruneAt = 0;
async function persist(targets) {
  const db = require('./db');
  if (!db.console) return;
  const vals = [], params = [];
  targets.forEach((t, i) => {
    const b = i * 6;
    vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
    params.push(t.node, t.label, t.host, t.port, t.state, t.ms == null ? null : Math.round(t.ms));
  });
  if (!vals.length) return;
  await db.console.query(
    `INSERT INTO apigw_probe_log (node,label,host,port,state,ms) VALUES ${vals.join(',')}`, params);
  if (Date.now() - _pruneAt > 3600e3) {          // prune hourly, not every 30s
    _pruneAt = Date.now();
    await db.console.query(`DELETE FROM apigw_probe_log WHERE probed_at < now() - interval '7 days'`);
  }
}

function start() {
  if (process.env.APIGW_PROBE_AUTO === '0') { console.log('APIGW connectivity probe: timer disabled (APIGW_PROBE_AUTO=0); endpoint still on-demand.'); return; }
  if (_timer) return;
  const run = () => probeOnce().catch(() => {});
  _timer = setInterval(run, INTERVAL * 1000);
  setTimeout(run, 3000);   // first probe shortly after boot
  console.log(`APIGW connectivity probe: on (every ${INTERVAL}s · ${TARGETS.length} targets · timeout ${TIMEOUT}ms).`);
}

// status() returns the cached snapshot; if none yet (before first tick), probe once on demand.
async function status() { return _last || probeOnce(); }

module.exports = { start, probeOnce, status, TARGETS };
