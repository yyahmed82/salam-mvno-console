/* UIL SUMMARY-BLOCK SAMPLER — Phase 3 of the APIGW/DMS logs plan (3 Sep 2026).
 * Every UIL call ends with a machine-parseable block in the CURRENT unified-layer.log:
 *   <====Begin Logs====> | URL | Method | Requester | uilTransactionId | Response | TotalTimeElapsed
 * This collector tails ONLY those current files (small — ~10MB rotation) over the same
 * console_ro SSH identity, byte-watermarked like apiLogCollector, parses the blocks and stores
 * 5-minute AGGREGATES in console PG. Kilobytes of rollups instead of ~10GB/day of raw logs.
 *
 * PROD-SAFETY: one ssh per node per cycle; reads are `tail -c +OFF | head -c CAP` on current
 * files only (never the gz history); no grep, no decompression; remote side is plain reads.
 * Raw text is parsed and DISCARDED — only counts/latency/codes reach the DB (no PII stored).
 * Rotation is detected per file (size < watermark → restart at 0). Errors travel per host.
 *
 * Env: UILS_SAMPLE=0 disables · UILS_INTERVAL_SEC (300) · UILS_CAP_BYTES (4MB/file/cycle)
 *      hosts/user/key are shared with dmsLogGrep (DMSLOG_*). */
'use strict';
const { execFile } = require('child_process');
const db = require('./db');
const MB = 1024 * 1024;

const CFG = () => ({
  enabled: process.env.UILS_SAMPLE !== '0',
  intervalSec: Math.max(60, Number(process.env.UILS_INTERVAL_SEC || 300)),
  capBytes: Math.min(16 * MB, Number(process.env.UILS_CAP_BYTES || 4 * MB)),
  hosts: String(process.env.DMSLOG_HOSTS || '172.31.43.136,172.31.43.137,172.31.43.138,172.31.43.139')
    .split(',').map(s => s.trim()).filter(Boolean),
  user: process.env.DMSLOG_SSH_USER || 'console_ro',
  key: process.env.DMSLOG_SSH_KEY || '/root/.ssh/api_log_ed25519'
});
const configured = () => { const c = CFG(); return c.enabled && c.hosts.length > 0; };

function sshExec(host, cmd, maxBuffer) {
  const c = CFG();
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new',
    '-i', c.key, `${c.user}@${host}`, cmd];
  return new Promise((resolve, reject) => {
    execFile('ssh', args, { maxBuffer: maxBuffer || 24 * MB, timeout: 45000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error((String(stderr || '') || err.message || 'ssh failed').trim().slice(0, 300)));
        resolve(String(stdout || ''));
      });
  });
}

let _ensured = false;
async function ensure() {
  if (_ensured) return;
  await db.console.query(`CREATE TABLE IF NOT EXISTS apigw_uil_stats (
    id bigserial PRIMARY KEY, bucket timestamptz NOT NULL, host text NOT NULL, inst text NOT NULL,
    api text NOT NULL, calls integer NOT NULL, errors integer NOT NULL,
    codes jsonb, ms_sum bigint, ms_max integer)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_uil_stats_bucket ON apigw_uil_stats (bucket DESC)`);
  await db.console.query(`CREATE TABLE IF NOT EXISTS uil_sampler_state (
    host text NOT NULL, file text NOT NULL, byte_offset bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (host, file))`);
  _ensured = true;
}

/* one ssh per host: report size of every current UIL log, and emit the new bytes from the
 * offsets we already hold. Offsets are embedded via a generated `case` — file paths come from
 * OUR OWN state rows (originally from a fixed glob), not from user input. */
function hostScript(offsets, capBytes) {
  const esc1 = s => String(s).replace(/'/g, `'\\''`);
  const cases = Object.entries(offsets)
    .map(([f, o]) => `'${esc1(f)}') O=${Number(o) || 0};;`).join('\n      ');
  return `sh -c '
for f in /opt/application/unified-integration-layer*/logs/unified-layer.log; do
  [ -f "$f" ] || continue
  S=$(wc -c < "$f")
  O=-1
  case "$f" in
      ${cases}
      *) O=-1;;
  esac
  echo "@@F $f $S $O"
  if [ "$O" -ge 0 ] && [ "$S" -gt "$O" ]; then
    tail -c +$((O+1)) "$f" | head -c ${capBytes}
    echo ""
    echo "@@E"
  fi
done'`;
}

/* parse a chunk of UIL log text → aggregate rows keyed by api path */
const OK_CODES = new Set(['00', '0', '000', '0000', '200', '201', '600']);
function parseChunk(text) {
  const out = new Map();     // api -> {calls, errors, codes:{}, ms_sum, ms_max}
  const re = /Begin Logs=+>([\s\S]*?)End Logs/g;
  let m, blocks = 0;
  while ((m = re.exec(text))) {
    blocks++;
    const b = m[1];
    const url = (/\|\s*URL:\s*(\S+)/.exec(b) || [])[1] || '';
    const api = (url.replace(/^https?:\/\/[^/]+/, '') || '(unknown)').slice(0, 160);
    const code = (/"responseCode"\s*:\s*"?([\w-]+)"?/.exec(b) || [])[1] || null;
    const ms = Number((/TotalTimeElapsed:\s*(\d+)\s*ms/.exec(b) || [])[1] || 0);
    const e = out.get(api) || { calls: 0, errors: 0, codes: {}, ms_sum: 0, ms_max: 0 };
    e.calls++;
    if (code) { e.codes[code] = (e.codes[code] || 0) + 1; if (!OK_CODES.has(code)) e.errors++; }
    e.ms_sum += ms; if (ms > e.ms_max) e.ms_max = ms;
    out.set(api, e);
  }
  return { agg: out, blocks };
}

const _status = { enabled: false, cycles: 0, last_run: null, last_ms: null, hosts: {}, error: null };
let _timer = null, _running = false;

/* ---- PHASE 4 · SELF-CALIBRATING ALERTS over the rollups (3 Sep 2026) ------------------------
 * No hand-picked thresholds: every rule compares a RECENT window against the table's own
 * baseline and stays silent until the baseline is thick enough to be meaningful. Rules:
 *   apigw:uil-instance-silent  (P2, technical) — an instance seen in the last 24h stopped
 *     producing samples ≥ UILS_SILENT_MIN (20m) while other instances continue. Hosts whose
 *     sampler cycle ERRORED are excluded — "we cannot see" is not "it is down".
 *   apigw:provider-surge:<grp> (P2, business)  — a provider group's non-OK share in the last
 *     30m exceeds its 24h baseline by ≥ UILS_SURGE_DELTA points (min UILS_SURGE_MIN_N calls,
 *     min 200 baseline calls). One alert per group; auto-resolves.
 *   apigw:uil-latency          (P3, technical) — APIs whose recent avg is ≥3× their 24h
 *     baseline (and >1500ms, ≥10 recent calls); one alert naming the worst offenders. */
const WATCH_CFG = () => ({
  enabled: process.env.UILS_WATCH !== '0',
  silentMin: Number(process.env.UILS_SILENT_MIN || 20),
  surgeMinN: Number(process.env.UILS_SURGE_MIN_N || 20),
  surgeDelta: Number(process.env.UILS_SURGE_DELTA || 25),
  latMinN: Number(process.env.UILS_LAT_MIN_N || 10)
});

async function upsertAlert(key, name, sev, metric, threshold, observed, sample, dim, msg) {
  const now = new Date().toISOString();
  const cur = (await db.console.query(
    `SELECT id FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [key])).rows[0];
  if (cur) await db.console.query(
    `UPDATE alerts SET last_seen_at=$2, observed_value=$3, message=$4, breach_count=breach_count+1,
       peak_value=GREATEST(peak_value,$3) WHERE id=$1`, [cur.id, now, observed, msg]);
  else await db.console.query(
    `INSERT INTO alerts (rule_key,name,severity,team,status,metric_key,operator,threshold,observed_value,sample,
       window_hours,dim,message,fired_at,last_seen_at,peak_value,breach_count)
     VALUES ($1,$2,$3,'Digital Ops','open',$4,'>=',$5,$6,$7,1,$8,$9,$10,$10,$6,1)`,
    [key, name, sev, metric, threshold, observed, JSON.stringify(sample || {}), dim, msg, now]);
}
async function resolveAlerts(keys) {
  if (!keys.length) return;
  const now = new Date().toISOString();
  await db.console.query(
    `UPDATE alerts SET status='resolved', resolved_at=$2 WHERE status='open' AND rule_key = ANY($1)`, [keys, now]);
}

async function watch() {
  const w = WATCH_CFG();
  if (!w.enabled) return;
  const okErr = Object.entries(_status.hosts).filter(([, v]) => v && v.ok === false).map(([h]) => h);

  /* 1 · silent instances (only meaningful once the table has some history) */
  const inst = (await db.console.query(
    `SELECT host, inst, max(bucket) last_seen, sum(calls)::bigint calls
       FROM apigw_uil_stats WHERE bucket > now() - interval '24 hours' GROUP BY host, inst`)).rows;
  const fresh = inst.filter(i => (Date.now() - new Date(i.last_seen).getTime()) / 60000 < w.silentMin);
  const silent = inst.filter(i => !okErr.includes(i.host)
    && (Date.now() - new Date(i.last_seen).getTime()) / 60000 >= w.silentMin);
  if (silent.length && fresh.length) {           // others alive → real hole, not sampler-wide outage
    await upsertAlert('apigw:uil-instance-silent', 'UIL instance stopped serving (LB hole)', 'P2',
      'uil_instance_silent', 1, silent.length,
      { silent: silent.map(s => `${s.host}·${s.inst}`), fresh: fresh.length },
      'uil-instance',
      `${silent.map(s => `${s.host.split('.').pop()}·${s.inst.replace('unified-integration-layer', 'L')}`).join(', ')} `
      + `produced no UIL log entries for ≥${w.silentMin} min while ${fresh.length} instance(s) continue — a dead `
      + `instance behind the gateway LB silently fails a share of all app/dealer calls. Check the process on the node.`);
  } else await resolveAlerts(['apigw:uil-instance-silent']);

  /* 2 · provider business-code surge (recent 30m vs prior 24h) */
  const prov = (await db.console.query(
    `SELECT split_part(replace(api, '/uil/', ''), '/', 1) grp,
            sum(CASE WHEN bucket >  now() - interval '30 minutes' THEN calls  ELSE 0 END)::int r_n,
            sum(CASE WHEN bucket >  now() - interval '30 minutes' THEN errors ELSE 0 END)::int r_e,
            sum(CASE WHEN bucket <= now() - interval '30 minutes' THEN calls  ELSE 0 END)::int b_n,
            sum(CASE WHEN bucket <= now() - interval '30 minutes' THEN errors ELSE 0 END)::int b_e
       FROM apigw_uil_stats WHERE bucket > now() - interval '24 hours' GROUP BY 1`)).rows;
  const tripped = [];
  for (const p of prov) {
    const rp = p.r_n ? 100 * p.r_e / p.r_n : 0, bp = p.b_n ? 100 * p.b_e / p.b_n : 0;
    if (p.r_n >= w.surgeMinN && p.b_n >= 200 && (rp - bp) >= w.surgeDelta) {
      tripped.push(`apigw:provider-surge:${p.grp}`);
      await upsertAlert(`apigw:provider-surge:${p.grp}`, `Provider surge — ${p.grp} answering non-OK`, 'P2',
        'uil_provider_surge', w.surgeDelta, Math.round(rp - bp),
        { grp: p.grp, recent: `${p.r_e}/${p.r_n}`, baseline_pct: bp.toFixed(1) }, p.grp,
        `${p.grp}: ${p.r_e}/${p.r_n} non-OK in the last 30 min (${rp.toFixed(1)}%) vs a ${bp.toFixed(1)}% 24h baseline. `
        + `Check Monitoring → Gateway & API → DMS services code cards for the dominating code; if it is a provider `
        + `code (e.g. Semati 715/5002), page the provider path — if platform-wide, check UIL/BSS.`);
    }
  }
  const openSurge = (await db.console.query(
    `SELECT rule_key FROM alerts WHERE status='open' AND rule_key LIKE 'apigw:provider-surge:%'`)).rows
    .map(r => r.rule_key).filter(k => !tripped.includes(k));
  await resolveAlerts(openSurge);

  /* 3 · latency regressions (recent 30m avg vs prior 24h avg per API) */
  const lat = (await db.console.query(
    `SELECT api,
            sum(CASE WHEN bucket >  now() - interval '30 minutes' THEN calls  ELSE 0 END)::int r_n,
            sum(CASE WHEN bucket >  now() - interval '30 minutes' THEN ms_sum ELSE 0 END)::bigint r_ms,
            sum(CASE WHEN bucket <= now() - interval '30 minutes' THEN calls  ELSE 0 END)::int b_n,
            sum(CASE WHEN bucket <= now() - interval '30 minutes' THEN ms_sum ELSE 0 END)::bigint b_ms
       FROM apigw_uil_stats WHERE bucket > now() - interval '24 hours' GROUP BY api`)).rows;
  const slow = lat.map(x => ({ api: x.api, rn: x.r_n,
      ravg: x.r_n ? Number(x.r_ms) / x.r_n : 0, bavg: x.b_n >= 50 ? Number(x.b_ms) / x.b_n : null }))
    .filter(x => x.rn >= w.latMinN && x.bavg != null && x.ravg > 1500 && x.ravg >= 3 * x.bavg)
    .sort((a, z) => z.ravg - a.ravg).slice(0, 3);
  if (slow.length) {
    await upsertAlert('apigw:uil-latency', 'UIL/BSS latency regression', 'P3',
      'uil_latency_regression', 3, Math.round(slow[0].ravg),
      { offenders: slow.map(s => `${s.api} ${Math.round(s.ravg)}ms (base ${Math.round(s.bavg)}ms)`) }, 'latency',
      `${slow.map(s => `${s.api}: ${Math.round(s.ravg)}ms avg vs ${Math.round(s.bavg)}ms baseline`).join(' · ')} `
      + `(last 30 min). BSS read-path degradation pattern — correlate with Monitoring ② slowest calls and the OSB 1500 watch.`);
  } else await resolveAlerts(['apigw:uil-latency']);

  _status.watch = { silent: silent.map(s => `${s.host}·${s.inst}`), surges: tripped,
    slow: slow.map(s => s.api), at: new Date().toISOString() };
}

async function cycleHost(host, cfg, bucket) {
  const st = await db.console.query(
    `SELECT file, byte_offset FROM uil_sampler_state WHERE host = $1`, [host]);
  const offsets = Object.fromEntries(st.rows.map(r => [r.file, Number(r.byte_offset)]));
  const raw = await sshExec(host, hostScript(offsets, cfg.capBytes));
  // split per-file: "@@F <path> <size> <knownOffset>" then (optionally) bytes until "@@E"
  const parts = raw.split(/^@@F /m).slice(1);
  let inserted = 0, blocks = 0;
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const [file, sizeS, offS] = part.slice(0, nl).trim().split(/\s+/);
    const size = Number(sizeS), known = Number(offS);
    let chunk = '';
    if (known >= 0 && part.includes('@@E')) chunk = part.slice(nl + 1, part.lastIndexOf('@@E'));
    const inst = (/unified-integration-layer\d*/.exec(file) || ['uil'])[0];
    let newOff;
    if (known < 0) newOff = size;                                   // first contact: start at tip
    else if (size < known) newOff = 0;                              // rotated under us: restart
    else newOff = Math.min(size, known + Buffer.byteLength(chunk, 'utf8'));
    if (chunk) {
      const { agg, blocks: nb } = parseChunk(chunk);
      blocks += nb;
      for (const [api, e] of agg) {
        await db.console.query(
          `INSERT INTO apigw_uil_stats (bucket, host, inst, api, calls, errors, codes, ms_sum, ms_max)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [bucket, host, inst, api, e.calls, e.errors, JSON.stringify(e.codes), e.ms_sum, e.ms_max]);
        inserted++;
      }
    }
    await db.console.query(
      `INSERT INTO uil_sampler_state (host, file, byte_offset, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (host, file) DO UPDATE SET byte_offset = $3, updated_at = now()`,
      [host, file, newOff]);
  }
  return { files: parts.length, blocks, rows: inserted };
}

async function cycle() {
  if (_running || !configured()) return;
  _running = true;
  const t0 = Date.now(); const cfg = CFG();
  const bucket = new Date(Math.floor(Date.now() / 300e3) * 300e3).toISOString();
  try {
    await ensure();
    const settled = await Promise.allSettled(cfg.hosts.map(h => cycleHost(h, cfg, bucket)));
    settled.forEach((s, i) => {
      _status.hosts[cfg.hosts[i]] = s.status === 'fulfilled'
        ? { ok: true, ...s.value, at: new Date().toISOString() }
        : { ok: false, error: String(s.reason.message || s.reason).slice(0, 200), at: new Date().toISOString() };
    });
    // retention: 14 days of 5-min rollups is plenty and stays tiny
    await db.console.query(`DELETE FROM apigw_uil_stats WHERE bucket < now() - interval '14 days'`);
    try { await watch(); } catch (e) { _status.watch_error = e.message.slice(0, 160); }
    // OSB fault surge (day-lag data; freshness-gated inside — silent on a stale archive)
    try { _status.osb_watch = await require('./osbArchive').faultWatch(); }
    catch (e) { _status.osb_watch_error = e.message.slice(0, 160); }
    _status.error = null;
  } catch (e) { _status.error = e.message.slice(0, 200); }
  _status.cycles++; _status.last_run = new Date().toISOString(); _status.last_ms = Date.now() - t0;
  _running = false;
}

function start() {
  _status.enabled = configured();
  if (!_status.enabled) { console.log('[uil-sampler] disabled (UILS_SAMPLE=0 or no hosts)'); return; }
  setTimeout(() => cycle().catch(() => {}), 45000);            // let boot + first journeys cycle pass
  _timer = setInterval(() => cycle().catch(() => {}), CFG().intervalSec * 1000);
  if (_timer.unref) _timer.unref();
  console.log(`[uil-sampler] armed · every ${CFG().intervalSec}s · hosts ${CFG().hosts.join(',')}`);
}

/* board query — console DB only, instant */
async function board(hours = 24) {
  await ensure();
  const h = Math.max(1, Math.min(14 * 24, Number(hours) || 24));
  const apis = (await db.console.query(
    `SELECT api, sum(calls)::bigint calls, sum(errors)::bigint errors,
            (sum(ms_sum) / GREATEST(1, sum(calls)))::int avg_ms, max(ms_max) max_ms
       FROM apigw_uil_stats WHERE bucket > now() - ($1 || ' hours')::interval
      GROUP BY api ORDER BY calls DESC LIMIT 60`, [String(h)])).rows;
  const insts = (await db.console.query(
    `SELECT host, inst, sum(calls)::bigint calls, max(bucket) last_seen
       FROM apigw_uil_stats WHERE bucket > now() - ($1 || ' hours')::interval
      GROUP BY host, inst ORDER BY host, inst`, [String(h)])).rows;
  const codes = (await db.console.query(
    `SELECT split_part(replace(api, '/uil/', ''), '/', 1) grp, k code, sum(v::int)::bigint n
       FROM apigw_uil_stats, jsonb_each_text(coalesce(codes, '{}'::jsonb)) AS c(k, v)
      WHERE bucket > now() - ($1 || ' hours')::interval
      GROUP BY 1, 2 ORDER BY n DESC LIMIT 80`, [String(h)])).rows;
  return { ok: true, hours: h, apis, instances: insts, codes, sampler: status() };
}

const status = () => ({ configured: configured(), ..._status });
module.exports = { start, cycle, status, board, configured, parseChunk };
