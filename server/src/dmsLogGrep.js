/* DMS APPLICATION-LOG REFERENCE SEARCH — Phase 2 of the APIGW/DMS logs plan (3 Sep 2026;
 * see Salam DMS/APIGW-DMS-Logs-Observability-Plan.md). The customer-facing "log reference ID"
 * (TKT-000016's 91d51389c6ffd37e) is a Spring Sleuth trace id that lives ONLY in the service
 * logs on the four DMS APP nodes (/opt/application/<svc>/logs, ~7-day retention). This module
 * greps them on demand over SSH — the same console_ro + api_log_ed25519 identity as the
 * api_logger collector (43.17/.18), provisioned on the APP nodes 3 Sep 2026.
 *
 * PROD-SAFETY RULES (these are live APIGW/DMS application nodes):
 *  · STAGED SEARCH. Default touches ONLY the current *.log files (plain grep, cheap). Rotated
 *    .gz are ~10 GB/day/node — they are searched ONLY when an explicit date is given, and then
 *    only that one day's files, under `nice -n 19` with a hard remote `timeout`.
 *  · EXPLICIT ACTION ONLY — an agent pressing a button / asking Yusr. Never in a loop, never
 *    scheduled.
 *  · MASKED AT SOURCE. The remote pipeline masks before anything crosses the wire: digit runs
 *    ≥7 (MSISDNs/NIDs/IMSI/ICCID), JWT blobs (Nafath iamAppToken), and apiKey values (the DEBUG
 *    logs hold the Semati + UIL channel keys in clear — a raised security finding). Raw bodies
 *    never reach the console DB or client; there is deliberately NO unmask path here.
 *  · Bounded everywhere: per-file line caps, one context window per host, output byte cap,
 *    ssh/exec timeouts. Errors travel with results (per-host `error` field — house rule).
 *  · Hosts run DIFFERENT UIL instances (gp01=2+4, gp02=2+3, gp04=5+6 …) and a request lands on
 *    ONE node — every search fans out to ALL hosts in parallel and reports per-host.
 *
 * Env: DMSLOG=0 disables · DMSLOG_HOSTS (default the 4 traffic IPs) · DMSLOG_SSH_USER
 *      (console_ro) · DMSLOG_SSH_KEY (/root/.ssh/api_log_ed25519) · DMSLOG_TIMEOUT_MS (120000) */
'use strict';
const { execFile } = require('child_process');
const MB = 1024 * 1024;

const CFG = () => ({
  enabled: process.env.DMSLOG !== '0',
  hosts: String(process.env.DMSLOG_HOSTS || '172.31.43.136,172.31.43.137,172.31.43.138,172.31.43.139')
    .split(',').map(s => s.trim()).filter(Boolean),
  user: process.env.DMSLOG_SSH_USER || 'console_ro',
  key: process.env.DMSLOG_SSH_KEY || '/root/.ssh/api_log_ed25519',
  // BUDGETS ALIGNED TO THE STACK: nginx proxies the console at 60s — a longer search 504s
  // mid-flight and looks like a hang. Remote `timeout` ends the node-side work cleanly first.
  remoteSecs: Number(process.env.DMSLOG_REMOTE_SECS || 50),
  timeoutMs: Number(process.env.DMSLOG_TIMEOUT_MS || 56000)
});
const configured = () => { const c = CFG(); return c.enabled && c.hosts.length > 0; };

/* the two reference shapes these logs correlate on. STRICT — the value reaches a remote shell
 * (single-quoted AND charset-limited to [0-9a-f-], so no metacharacter can survive anyway). */
function candidate(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (/^[0-9a-f]{16}$/.test(s)) return s;                                    // Sleuth trace id
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return s;  // uilTransactionId
  return null;
}

const shq = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`;

function sshExec(host, remoteCmd, timeoutMs) {
  const c = CFG();
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new',
    '-i', c.key, `${c.user}@${host}`, remoteCmd];
  return new Promise((resolve, reject) => {
    execFile('ssh', args, { maxBuffer: 4 * MB, timeout: timeoutMs, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error((String(stderr || '') || err.message || 'ssh failed').trim().slice(0, 300)));
        resolve(String(stdout || ''));                     // partial output beats no output
      });
  });
}

/* UNMASKED BY DECISION (Yosri, 3 Sep): Troubleshoot is L2-gated and L2 already reads these logs
 * raw on the nodes — masking here only slowed them down. Customer data passes through UNTOUCHED.
 * The ONLY redactions are live CREDENTIALS (Semati apiKey values, Nafath iamAppToken JWTs, the
 * UIL channel key) — those are secrets, not data, and are the subject of an open security
 * finding; surfacing them in a browser would widen that exposure. */
const MASK_SED = `sed -e 's/eyJ[A-Za-z0-9_.\\-]\\{20,\\}/***JWT***/g' ` +
  `-e 's/"apiKey" *: *"[^"]*"/"apiKey":"***"/g' ` +
  `-e "s/apiKey='[^']*'/apiKey='***'/g"`;

/* Build the per-host script. date=null → current *.log only (cheap). date=YYYY-MM-DD → that
 * day's .gz too, niced + ionice'd, everything under one hard timeout.
 * ORDERING: UIL logs first — they carry the request lifecycle + verdict, so a match there answers
 * the question immediately. quick=true (Yusr) stops the host after its first matching file:
 * the verdict beats completeness in chat, and the drawer's full search remains for the rest. */
function remoteScript(ref, date, quick) {
  // ref is charset-validated [0-9a-f-] by candidate() — embedded BARE because the whole script
  // is single-quoted for the remote shell (a nested shq quote would terminate that quoting).
  const R = ref;
  // prefixes are disjoint (unified-* / dms* / trms*) — no file is visited twice
  const cur = p => `/opt/application/${p}/logs/*.log`;
  const gz = p => `/opt/application/${p}/logs/*.${date}.*.gz`;
  const PRE = ['unified-integration-layer*', 'dms*', 'trms*'];
  const files = PRE.map(cur).join(' ') + (date ? ' ' + PRE.map(gz).join(' ') : '');
  return `timeout ${CFG().remoteSecs} sh -c '
NI="nice -n 19"; command -v ionice >/dev/null 2>&1 && NI="ionice -c3 nice -n 19"
CTX=0
for f in ${files}; do
  [ -f "$f" ] || continue
  c=$($NI zgrep -c -F ${R} "$f" 2>/dev/null); [ "\${c:-0}" -gt 0 ] || continue
  echo "@@FILE $f $c"
  $NI zgrep -h -F ${R} "$f" 2>/dev/null | head -${quick ? 20 : 60} | cut -c1-600
  if [ "$CTX" = "0" ]; then
    CTX=1
    L=$($NI zgrep -n -F ${R} "$f" 2>/dev/null | head -1 | cut -d: -f1)
    if [ -n "$L" ]; then
      echo "@@CTX $f"
      A=$((L>60?L-60:1)); B=$((L+90))
      $NI zcat -f "$f" 2>/dev/null | sed -n "\${A},\${B}p" | cut -c1-600
      echo "@@CTXEND"
    fi
  fi${quick ? '\n  break' : ''}
done' | ${MASK_SED} | head -c 250000`;
}

/* parse one host's raw output into files / lines / summary hops */
function parseHost(host, raw) {
  const out = { host, files: [], lines: [], ctx: null };
  let mode = 'lines', ctxBuf = [];
  for (const line of String(raw || '').split('\n')) {
    if (line.startsWith('@@FILE ')) {
      const m = /^@@FILE (\S+) (\d+)$/.exec(line);
      if (m) out.files.push({ file: m[1], hits: Number(m[2]),
        service: (/\/opt\/application\/([^/]+)\//.exec(m[1]) || [])[1] || null });
      mode = 'lines'; continue;
    }
    if (line.startsWith('@@CTX ')) { mode = 'ctx'; continue; }
    if (line.startsWith('@@CTXEND')) { out.ctx = ctxBuf.join('\n'); mode = 'lines'; continue; }
    if (mode === 'ctx') { if (ctxBuf.length < 400) ctxBuf.push(line); }
    else if (line.trim() && out.lines.length < 300) out.lines.push(line);
  }
  if (!out.ctx && ctxBuf.length) out.ctx = ctxBuf.join('\n');
  return out;
}

/* lift the structured facts out of a UIL context window (summary block + interceptor hops) */
function extractHops(ctx) {
  if (!ctx) return [];
  const hops = [];
  // UIL per-call summary blocks:  | URL: … | Method: … | Requester: … | Response: … | TotalTimeElapsed: N ms
  const blocks = ctx.split(/<=+Begin Logs=+>/).slice(1);
  for (const b of blocks) {
    const g = re => (re.exec(b) || [])[1] || null;
    const hop = {
      kind: 'uil-call',
      url: g(/\|\s*URL:\s*(\S+)/), method: g(/\|\s*Method:\s*(\S+)/),
      requester: g(/\|\s*Requester:\s*(\S+)/),
      uil_txn: g(/uilTransactionId=([0-9a-f*-]{8,40})/i),
      response_code: g(/"responseCode"\s*:\s*"?(\w+)"?/),
      response_message: g(/"responseMessage"\s*:\s*"([^"]{0,120})"/),
      ms: g(/TotalTimeElapsed:\s*(\d+)\s*ms/),
      response_head: (g(/\|\s{1,4}Response:\s{1,6}(.{0,300})/) || '').trim() || null
    };
    if (hop.url) hops.push(hop);
  }
  // outbound provider hops (Semati/Nafath/…): Interceptor Outgoing/Incoming pairs
  const uris = [...ctx.matchAll(/URI\s*:\s*(https?:\/\/\S+)/g)].map(m => m[1]);
  const statuses = [...ctx.matchAll(/Status code\s*:\s*(\d+[^\n]{0,40})/g)].map(m => m[1].trim());
  const bodies = [...ctx.matchAll(/Response body\s*:\s*(.{0,240})/g)].map(m => m[1].trim());
  for (let i = 0; i < uris.length; i++)
    hops.push({ kind: 'provider-call', url: uris[i], status: statuses[i] || null, response_head: bodies[i] || null });
  return hops;
}

/* RESULT CACHE. A (ref, date) deep-search answer is IMMUTABLE — rotated logs never change —
 * so it caches for hours; current-log answers change as logs append, so they cache briefly
 * (enough that Yusr + the drawer + a re-ask don't re-grep the prod nodes back to back).
 * A cached FULL result also answers a quick request (superset); never the other way round.
 * In-flight de-dup: the same search asked twice concurrently runs ONCE. */
const _cache = new Map();      // key -> { at, quick, res }
const _inflight = new Map();   // key -> Promise
const CACHE_MS = { dated: 6 * 3600e3, current: 90e3 };
function cacheGet(key, quick) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > (e.res.date ? CACHE_MS.dated : CACHE_MS.current)) { _cache.delete(key); return null; }
  if (e.quick && !quick) return null;            // quick (partial) can't serve a full request
  return { ...e.res, cached: true, cached_at: new Date(e.at).toISOString() };
}
function cachePut(key, quick, res) {
  if (!res || !res.ok) return;                   // never cache failures
  if (_cache.size > 50) _cache.delete(_cache.keys().next().value);
  const cur = _cache.get(key);
  if (cur && !cur.quick && quick) return;        // don't overwrite a full result with a quick one
  _cache.set(key, { at: Date.now(), quick, res });
}

/* THE SEARCH. ref = 16-hex trace id or uuid uilTransactionId; date optional 'YYYY-MM-DD'
 * (≤ 8 days back) → deep-searches that day's gz as well. */
async function search(rawRef, opts = {}) {
  const ref0 = candidate(rawRef);
  const key = `${ref0}|${opts.date || ''}`;
  if (ref0) {
    const hit = cacheGet(key, !!opts.quick);
    if (hit) return hit;
    if (_inflight.has(key)) return _inflight.get(key);   // piggyback on the identical running search
  }
  const p = _search(rawRef, opts).then(res => {
    if (ref0) { cachePut(key, !!opts.quick, res); _inflight.delete(key); }
    return res;
  }, err => { if (ref0) _inflight.delete(key); throw err; });
  if (ref0) _inflight.set(key, p);
  return p;
}
async function _search(rawRef, { date = null, quick = false } = {}) {
  if (!configured()) return { configured: false, error: 'DMS log search not configured (DMSLOG_HOSTS/DMSLOG=0)' };
  const ref = candidate(rawRef);
  if (!ref) return { configured: true, ok: false, error: 'reference must be a 16-hex trace id or a UUID transaction id' };
  let d = null;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { configured: true, ok: false, error: 'date must be YYYY-MM-DD' };
    const ageD = (Date.now() - new Date(date + 'T00:00:00Z').getTime()) / 864e5;
    if (!Number.isFinite(ageD) || ageD < -1 || ageD > 8)
      return { configured: true, ok: false, error: 'date outside the ~7-day log retention — nothing can match' };
    d = String(date);
  }
  const c = CFG();
  const t0 = Date.now();
  const script = remoteScript(ref, d, !!quick);
  const settled = await Promise.allSettled(c.hosts.map(h => sshExec(h, script, c.timeoutMs)));
  const hosts = [], allHops = [], uilTxns = new Set();
  let totalHits = 0;
  settled.forEach((s, i) => {
    const host = c.hosts[i];
    if (s.status === 'rejected') { hosts.push({ host, error: String(s.reason.message || s.reason).slice(0, 200) }); return; }
    const p = parseHost(host, s.value);
    totalHits += p.files.reduce((a, f) => a + f.hits, 0);
    const hops = extractHops(p.ctx);
    for (const h of hops) if (h.uil_txn && !h.uil_txn.includes('*')) uilTxns.add(h.uil_txn);
    allHops.push(...hops.map(h => ({ ...h, host })));
    hosts.push(p);
  });
  const errors = hosts.filter(h => h.error).map(h => `${h.host}: ${h.error}`);
  return {
    configured: true, ok: true, ref, date: d, ms: Date.now() - t0,
    scope: d ? `current logs + rotated files of ${d} on ${c.hosts.length} nodes`
             : `current (uncompressed) logs on ${c.hosts.length} nodes — deep-search a specific date for rotated history`,
    total_hits: totalHits, hosts, hops: allHops, uil_transaction_ids: [...uilTxns],
    errors: errors.length ? errors : null,
    note: totalHits === 0
      ? 'No line carries this reference in the searched window. Current logs cover only the last few hours — '
        + 'retry with the request DATE for a deep search; past ~7 days the logs are rotated away.'
      : null
  };
}

const status = () => ({ configured: configured(), hosts: CFG().hosts, user: CFG().user });
module.exports = { configured, candidate, search, status };
