/* API-log COLLECTOR — pulls api_logger.production.log increments over SSH from the api hosts
 * and syncs them into the console's OWN Postgres DB (api_traffic_events), which the Monitoring
 * page + api_latency_p95 / api_technical_fail_rate metrics then read (apiTraffic.js PG mode).
 *
 * Chosen over the Grafana-MySQL read path (which stays available as fallback — see apiTraffic.js
 * mode()): the console owns the data end-to-end, no dependency on the ops cron/ingest chain.
 *
 * LINE FORMAT (JSON-LINES — mirrors the ops Python parser on the api host EXACTLY):
 *   ts       = response.headers.Date  ("%a, %d %b %Y %H:%M:%S GMT" → UTC; no Date → line skipped)
 *   path     = request.path
 *   txn      = request.body.{transactionId|uilTransactionId|transactionID}  (body: dict OR JSON string)
 *   code/msg = response.body.responseCode / responseMessage  (body not a dict → line skipped,
 *              exactly like the Python script's .get() raising inside its try/except)
 *   duration = str(log.duration)  ('' → NULL, junk → 0, else × API_TRAFFIC_DURATION_UNIT)
 *
 * TRANSPORT — system ssh (RHEL, no npm ssh deps), per host each cycle:
 *   1) size    = `wc -c < LOG`                       (current file size in bytes)
 *   2) size < watermark → the log ROTATED → reset watermark to 0 (fresh file)
 *   3) chunk   = `tail -c +<watermark+1> LOG | head -c <cap>`   (increment, capped per cycle)
 *   4) parse COMPLETE lines only — an unterminated tail is carried in-memory to the next cycle
 *   5) classify (errclass.classifyClass), mask MSISDN/NID digit-runs, batch-INSERT, purge >7d
 *   6) watermark → console_settings key 'api_log_watermarks' (per host, survives restarts)
 * First run per host backfills only the last API_LOG_BACKFILL_MB (the first partial line after
 * the seek fails JSON.parse and is dropped — same self-alignment the ops script relies on).
 *
 * Env: API_LOG_HOSTS=172.31.43.17,172.31.43.18   (presence of this var = collector mode ON)
 *      API_LOG_USER, API_LOG_KEY (ssh key path), API_LOG_PATH (remote log path)
 *      API_LOG_INTERVAL_MIN (default 1) · API_LOG_MAX_MB (per-cycle cap, default 20)
 *      API_LOG_BACKFILL_MB (first-run tail, default 50) · API_LOG_RETENTION_DAYS (default 7)
 * Host-side prereqs (see deploy152/env.template): read-only account on the api hosts with read
 * access to the log, ssh-copy-id from 152, firewall 152→hosts:22 (SOC ticket if blocked).
 * Never crashes the app: every ssh/parse/DB error is caught into per-host status. */
'use strict';

const { execFile } = require('child_process');
const { classifyClass } = require('./errclass');

const MB = 1024 * 1024;

const CFG = () => ({
  hosts: String(process.env.API_LOG_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
  user: process.env.API_LOG_USER || '',
  key: process.env.API_LOG_KEY || '',
  path: process.env.API_LOG_PATH || '/www/app/salam_api/shared/log/api_logger.production.log',
  intervalMin: Math.max(1, Number(process.env.API_LOG_INTERVAL_MIN) || 1),
  capBytes: Math.max(1, Number(process.env.API_LOG_MAX_MB) || 20) * MB,
  backfillBytes: Math.max(1, Number(process.env.API_LOG_BACKFILL_MB) || 50) * MB,
  retentionDays: Math.max(1, Number(process.env.API_LOG_RETENTION_DAYS) || 7),
  // same success set + duration unit the MySQL reader uses (apiTraffic.js CFG)
  successCodes: String(process.env.API_TRAFFIC_SUCCESS_CODES || '00,0,000,0000,200,600')
    .split(',').map(s => s.trim()).filter(Boolean),
  durMult: (process.env.API_TRAFFIC_DURATION_UNIT || 'ms').toLowerCase() === 's' ? 1000 : 1
});

function configured() { return CFG().hosts.length > 0; }

/* PII guard at INGEST (rows are stored, so mask before they ever hit disk) — same digit-run
 * patterns as assist.scrubPII / apiTraffic.maskText (not required from there: apiTraffic
 * requires THIS module for status, so importing back would make a cycle). */
function maskText(s) {
  if (s == null) return s;
  return String(s)
    .replace(/(\+?966|00966|0)?5\d{8}/g, m => m.slice(0, 2) + '*******' + m.slice(-2))  // KSA mobiles
    .replace(/\b[12]\d{9}\b/g, m => m.slice(0, 2) + '******' + m.slice(-2));            // national/iqama IDs
}

/* ---- pure parsing (exported for the ssh-free self-test) --------------------------------- */

// one JSON log line → event or null (null = skip, mirroring the Python try/except-continue)
function parseLine(line, c) {
  let log;
  try { log = JSON.parse(line); } catch (e) { return null; }
  if (!log || typeof log !== 'object') return null;
  const resp = log.response || {};
  const dateStr = resp.headers && resp.headers.Date;
  if (!dateStr) return null;                                   // no Date header → skipped (as the script does)
  const ts = new Date(dateStr);                                // "%a, %d %b %Y %H:%M:%S GMT" = RFC-1123 → UTC
  if (isNaN(ts.getTime())) return null;
  const req = log.request || {};
  const path = req.path || '';
  // txn id: request.body may be a dict OR a JSON string (both handled by the script)
  let txn = '';
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (body && typeof body === 'object' && !Array.isArray(body))
    txn = body.transactionId || body.uilTransactionId || body.transactionID || '';
  // response.body must be a dict — a string body makes the Python .get() throw → line skipped
  const rbody = resp.body;
  if (rbody == null || typeof rbody !== 'object' || Array.isArray(rbody)) return null;
  const code = String(rbody.responseCode == null ? '' : rbody.responseCode);
  const msg = String(rbody.responseMessage == null ? '' : rbody.responseMessage);
  // duration: str(log.duration) — '' → NULL, junk → 0, else × unit multiplier
  const durStr = String(log.duration == null ? '' : log.duration);
  const durationMs = durStr === '' ? null : Math.round((Number(durStr) || 0) * c.durMult);
  const cls = classifyClass({ ok: c.successCodes.includes(code), status_code: code, response: msg });
  const ev = {
    ts: ts.toISOString(), path, transaction_id: txn || null,
    response_code: code, response_message: maskText(msg).slice(0, 2000),
    duration_ms: durationMs, err_class: cls.cls
  };
  /* FAILED calls keep their REQUEST/RESPONSE BODIES (masked) — persisted to
   * api_failure_samples so the monitoring samples panel can show yesterday's 1500s after the
   * live log has rotated (26 Aug lesson: the failures existed, the grep window didn't reach
   * them). Success calls stay distilled-only: volume × body size would be storage suicide. */
  if (cls.cls !== 'success' || Number(log.http_status) >= 400) {
    const cap = o => { try { return maskText(JSON.stringify(o)).slice(0, 6000); } catch (e) { return null; } };
    ev._sample = {
      http_status: log.http_status != null ? Number(log.http_status) : null,
      platform: log.app_platform || null, app_version: String(log.app_version || '').slice(0, 40),
      trace_id: String(log.trace_id || '').slice(0, 64) || null,
      request_body: body != null ? cap(body) : null,
      response_body: cap(rbody),
    };
  }
  return ev;
}

/* Parse a raw chunk (previous remainder + new bytes) into events. COMPLETE lines only:
 * text after the last '\n' is returned as `remainder` and re-fed next cycle. */
function parseLines(text, cfg) {
  const c = cfg || CFG();
  const nl = text.lastIndexOf('\n');
  const complete = nl < 0 ? '' : text.slice(0, nl);
  const remainder = nl < 0 ? text : text.slice(nl + 1);
  const events = [];
  let skipped = 0;
  for (const line of complete.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const ev = parseLine(t, c);
    if (ev) events.push(ev); else skipped++;
  }
  return { events, remainder, skipped };
}

/* Decide where this cycle's read starts. size < watermark ⇒ the log rotated/truncated under us
 * ⇒ restart from 0. First contact (watermark null) ⇒ backfill only the last backfillBytes. */
function planRead({ watermark, size, backfillBytes }) {
  if (watermark == null) return { start: Math.max(0, size - backfillBytes), rotated: false, firstRun: true };
  if (size < watermark) return { start: 0, rotated: true, firstRun: false };
  return { start: watermark, rotated: false, firstRun: false };
}

/* ---- ssh transport ----------------------------------------------------------------------- */

const shq = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`;   // single-quote for the remote sh

function sshExec(host, remoteCmd, { maxBuffer, binary } = {}) {
  const c = CFG();
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new'];
  if (c.key) args.push('-i', c.key);
  args.push(c.user ? `${c.user}@${host}` : host, remoteCmd);
  return new Promise((resolve, reject) => {
    execFile('ssh', args, { maxBuffer: maxBuffer || 4 * MB, timeout: 60000, encoding: binary ? 'buffer' : 'utf8' },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((String(stderr || '') || err.message || 'ssh failed').trim().slice(0, 400)));
        resolve(stdout);
      });
  });
}

const remoteSize = host => sshExec(host, `wc -c < ${shq(CFG().path)}`).then(out => {
  const n = parseInt(String(out).trim(), 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`unparseable size from ${host}: ${String(out).slice(0, 80)}`);
  return n;
});

// chunk is fetched as a raw Buffer so the watermark advances by EXACT bytes (a multi-byte UTF-8
// char split at the cap boundary must not skew the offset the next `tail -c` resumes from)
const remoteChunk = (host, start, cap) =>
  sshExec(host, `tail -c +${start + 1} ${shq(CFG().path)} | head -c ${cap}`, { maxBuffer: cap + MB, binary: true });

/* ---- persistence ------------------------------------------------------------------------- */

const WM_KEY = 'api_log_watermarks';

async function loadWatermarks() {
  const db = require('./db');
  const r = await db.console.query(`SELECT value FROM console_settings WHERE key = $1`, [WM_KEY]);
  return (r.rowCount && r.rows[0].value && typeof r.rows[0].value === 'object') ? r.rows[0].value : {};
}
async function saveWatermarks(wm) {
  const db = require('./db');
  await db.console.query(
    `INSERT INTO console_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [WM_KEY, JSON.stringify(wm)]);
}

async function insertEvents(host, events) {
  if (!events.length) return 0;
  const db = require('./db');
  const COLS = ['ts', 'host', 'path', 'transaction_id', 'response_code', 'response_message', 'duration_ms', 'err_class'];
  const per = Math.max(1, Math.floor(60000 / COLS.length));       // same param budget as prodSync.upsertBatch
  for (let i = 0; i < events.length; i += per) {
    const chunk = events.slice(i, i + per);
    const params = [];
    const values = chunk.map(ev => '(' + COLS.map(col => {
      params.push(col === 'host' ? host : ev[col]); return '$' + params.length;
    }).join(',') + ')').join(',');
    await db.console.query(
      `INSERT INTO api_traffic_events (ts, host, path, transaction_id, response_code, response_message, duration_ms, err_class)
       VALUES ${values}`, params);
  }
  /* failure samples (bodies) — capped per cycle so an error storm cannot flood the table */
  const samples = events.filter(e => e._sample).slice(0, 300);
  if (samples.length) {
    await ensureSampleTable();
    for (let i = 0; i < samples.length; i += 50) {
      const chunk = samples.slice(i, i + 50);
      const params = [];
      const values = chunk.map(ev => { const s = ev._sample;
        for (const v of [ev.ts, host, ev.path, ev.transaction_id, s.trace_id, ev.response_code,
          s.http_status, ev.response_message, ev.duration_ms, s.platform, s.app_version,
          s.request_body, s.response_body]) params.push(v);
        const n = params.length;
        return `(${Array.from({ length: 13 }, (_, j) => '$' + (n - 12 + j)).join(',')})`;
      }).join(',');
      await db.console.query(
        `INSERT INTO api_failure_samples (ts, host, path, transaction_id, trace_id, response_code,
           http_status, response_message, duration_ms, platform, app_version, request_body, response_body)
         VALUES ${values}`, params);
    }
  }
  return events.length;
}

let _sampleTableOk = false;
async function ensureSampleTable() {
  if (_sampleTableOk) return;
  const db = require('./db');
  await db.console.query(`
    CREATE TABLE IF NOT EXISTS api_failure_samples (
      id bigserial PRIMARY KEY,
      ts timestamptz NOT NULL, host text NOT NULL, path text NOT NULL,
      transaction_id text, trace_id text, response_code text, http_status integer,
      response_message text, duration_ms integer, platform text, app_version text,
      request_body text, response_body text);
    CREATE INDEX IF NOT EXISTS idx_api_fail_samples_path_ts ON api_failure_samples (path, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_api_fail_samples_ts ON api_failure_samples (ts DESC);`);
  _sampleTableOk = true;
}

async function purgeOld() {
  const db = require('./db');
  const r = await db.console.query(
    `DELETE FROM api_traffic_events WHERE ts < now() - ($1 || ' days')::interval`, [String(CFG().retentionDays)]);
  // failure samples keep a LONGER history (default 30d) — they are small (failures only, capped
  // bodies) and they are the whole point: yesterday's 1500s must survive log rotation
  try {
    const days = Math.max(7, Number(process.env.API_SAMPLE_RETENTION_DAYS) || 30);
    await db.console.query(
      `DELETE FROM api_failure_samples WHERE ts < now() - ($1 || ' days')::interval`, [String(days)]);
  } catch (e) { /* table may not exist yet on first cycles */ }
  return r.rowCount || 0;
}

/* ---- the cycle --------------------------------------------------------------------------- */

let _busy = false, _timer = null, _bootedAt = null;
const _hostState = new Map();   // host → { remainder, lastError, lastRunAt, lastTs, events, rotations, watermark, size }
const _dbStats = { events: null, newestTs: null };   // cached each cycle so status() stays sync

const hs = host => {
  if (!_hostState.has(host)) _hostState.set(host, { remainder: Buffer.alloc(0), lastError: null, lastRunAt: null, lastTs: null, events: 0, rotations: 0, watermark: null, size: null });
  return _hostState.get(host);
};

async function collectHost(host, wm) {
  const c = CFG();
  const st = hs(host);
  const size = await remoteSize(host);
  const saved = wm[host] && Number.isFinite(Number(wm[host].offset)) ? Number(wm[host].offset) : null;
  const plan = planRead({ watermark: saved, size, backfillBytes: c.backfillBytes });
  if (plan.rotated) { st.rotations++; st.remainder = Buffer.alloc(0); }   // fresh file — the carried tail is gone
  if (plan.firstRun) st.remainder = Buffer.alloc(0);
  let inserted = 0, newOffset = plan.start;
  if (size > plan.start) {
    const chunk = await remoteChunk(host, plan.start, c.capBytes);        // raw Buffer
    newOffset = plan.start + chunk.length;                                // watermark advances past the partial tail…
    const buf = Buffer.concat([st.remainder, chunk]);
    const nl = buf.lastIndexOf(0x0a);                                     // complete lines only:
    const complete = nl < 0 ? '' : buf.slice(0, nl + 1).toString('utf8');
    st.remainder = nl < 0 ? buf : buf.slice(nl + 1);                      // …which is carried in memory instead
    const { events } = parseLines(complete, c);
    inserted = await insertEvents(host, events);
    if (events.length) st.lastTs = events[events.length - 1].ts;
    st.events += inserted;
  }
  st.watermark = newOffset; st.size = size; st.lastRunAt = new Date().toISOString(); st.lastError = null;
  wm[host] = { offset: newOffset, size, last_ts: st.lastTs, last_run_at: st.lastRunAt, rotations: st.rotations };
  return inserted;
}

async function tick() {
  if (_busy || !configured()) return;
  _busy = true;
  try {
    const c = CFG();
    const wm = await loadWatermarks().catch(() => ({}));
    for (const host of c.hosts) {
      try { await collectHost(host, wm); }
      catch (e) { const st = hs(host); st.lastError = e.message; st.lastRunAt = new Date().toISOString(); }
    }
    await saveWatermarks(wm).catch(e => console.error('[API-LOG] watermark save failed: ' + e.message));
    await purgeOld().catch(e => console.error('[API-LOG] retention purge failed: ' + e.message));
    try {
      const db = require('./db');
      const r = await db.console.query(`SELECT count(*)::bigint AS n, max(ts) AS newest FROM api_traffic_events`);
      _dbStats.events = Number(r.rows[0].n); _dbStats.newestTs = r.rows[0].newest ? new Date(r.rows[0].newest).toISOString() : null;
    } catch (e) { /* stats are cosmetic */ }
  } catch (e) {
    console.error('[API-LOG] tick failed: ' + e.message);        // never crash the app
  } finally { _busy = false; }
}

function status() {
  const c = CFG();
  return {
    configured: configured(), intervalMin: c.intervalMin, logPath: c.path,
    user: c.user || null, capMb: Math.round(c.capBytes / MB), backfillMb: Math.round(c.backfillBytes / MB),
    retentionDays: c.retentionDays, bootedAt: _bootedAt,
    events: _dbStats.events, newestTs: _dbStats.newestTs,
    hosts: c.hosts.map(h => {
      const st = _hostState.get(h) || {};
      return { host: h, watermark: st.watermark ?? null, size: st.size ?? null,
        lagBytes: (st.size != null && st.watermark != null) ? Math.max(0, st.size - st.watermark) : null,
        lastTs: st.lastTs || null, lastRunAt: st.lastRunAt || null, lastError: st.lastError || null,
        eventsIngested: st.events || 0, rotations: st.rotations || 0 };
    })
  };
}

// async freshness probe for the health strip: event count + newest ts straight from the DB
async function ping() {
  if (!configured()) return { ok: false, configured: false };
  const t0 = Date.now();
  try {
    const db = require('./db');
    const r = await db.console.query(`SELECT count(*)::bigint AS n, max(ts) AS newest FROM api_traffic_events`);
    _dbStats.events = Number(r.rows[0].n);
    _dbStats.newestTs = r.rows[0].newest ? new Date(r.rows[0].newest).toISOString() : null;
    return { ok: true, configured: true, ms: Date.now() - t0, events: _dbStats.events, newestTs: _dbStats.newestTs };
  } catch (e) { return { ok: false, configured: true, ms: Date.now() - t0, error: e.message }; }
}

function start() {
  if (!configured()) { console.log('[API-LOG] no API_LOG_HOSTS — collector disabled (MySQL fallback if API_TRAFFIC_URL set)'); return { armed: false }; }
  const c = CFG();
  _bootedAt = new Date().toISOString();
  _timer = setInterval(() => { tick().catch(() => {}); }, c.intervalMin * 60000);
  _timer.unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 10000);   // first pull shortly after boot
  console.log(`[API-LOG] collector armed — every ${c.intervalMin} min · hosts: ${c.hosts.join(', ')} · ${c.path}`);
  return { armed: true, min: c.intervalMin, hosts: c.hosts };
}

/* ---- on-demand full request/response fetch --------------------------------------------------
 * The collector stores only the distilled event (path, code, message, duration). The FULL JSON
 * bodies live in the api_logger file on the API hosts — fetched here on demand, per transaction:
 * newest ~300MB of the log, exact-string grep, first hosts that answers wins. Seconds, not scans
 * of the whole file; strict txn validation (it lands inside a shell command, quoted via shq). */
async function fetchTxnPayloads(txn) {
  const c = CFG();
  if (!c.hosts.length) return { configured: false };
  const t = String(txn || '').trim();
  if (!/^[\w.-]{6,64}$/.test(t)) return { configured: true, ok: false, error: 'invalid transaction id' };
  const errors = [];
  for (const host of c.hosts) {
    try {
      const out = await sshExec(host,
        `tail -c 300000000 ${shq(c.path)} | grep -F ${shq(t)} | tail -c 2000000 | tail -4`,
        { maxBuffer: 4 * MB });
      const rows = [];
      for (const line of String(out || '').split('\n')) {
        const s = line.trim(); if (!s) continue;
        try {
          const log = JSON.parse(s);
          const req = log.request || {}, resp = log.response || {};
          // bodies are sometimes JSON-encoded strings — decode so the UI renders a tree, not a blob
          for (const o of [req, resp]) if (typeof o.body === 'string') { try { o.body = JSON.parse(o.body); } catch (e) {} }
          rows.push({
            host, path: req.path || null, method: req.method || null,
            duration: log.duration != null ? String(log.duration) : null,
            request_headers: null,                              // headers can carry auth tokens — never returned
            request_body: req.body != null ? req.body : null,
            response_body: resp.body != null ? resp.body : null,
            response_date: (resp.headers && resp.headers.Date) || null
          });
        } catch (e) { /* partial/non-JSON line → skip */ }
      }
      if (rows.length) return { configured: true, ok: true, txn: t, rows: rows.slice(-3) };
    } catch (e) { errors.push(`${host}: ${String(e.message || e).slice(0, 120)}`); }
  }
  return { configured: true, ok: true, txn: t, rows: [],
    note: 'not found in the newest ~300MB of the api_logger on any host' + (errors.length ? ` · ${errors.join(' · ')}` : '') };
}

/* ---- on-demand request/response SAMPLES for ONE ENDPOINT ------------------------------------
 * The ② API HEALTH ask (26 Aug): "for /bss/account/execute-account-blnc-query show me the actual
 * request/response like the log lines". Same mechanics as fetchTxnPayloads, but grep by the
 * `"path": "<endpoint>"` literal instead of a transaction id: newest ~200MB of the log on each
 * host, exact-string match, parse, optionally keep failures only, newest first, small cap.
 * Auth-looking request headers are dropped before returning; PII masking happens at the API
 * layer (house maskDeep + audited unmask). */
const SAMPLE_OK = new Set(['0000', '0', '00', '000', '200', '600', '201']);
async function fetchPathSamples(path, { limit = 5, failOnly = true } = {}) {
  const c = CFG();
  if (!c.hosts.length) return { configured: false };
  const p = String(path || '').trim();
  if (!/^\/[\w\/.-]{3,120}$/.test(p)) return { configured: true, ok: false, error: 'invalid path' };
  const needle = `"path": "${p}"`;
  const rows = [];
  const errors = [];
  for (const host of c.hosts) {
    try {
      const out = await sshExec(host,
        `tail -c 200000000 ${shq(c.path)} | grep -F ${shq(needle)} | tail -c 3000000 | tail -80`,
        { maxBuffer: 4 * MB });
      for (const line of String(out || '').split('\n')) {
        const s = line.trim(); if (!s) continue;
        try {
          const log = JSON.parse(s);
          const req = log.request || {}, resp = log.response || {};
          const code = String((resp.body && (resp.body.responseCode ?? resp.body.code)) ?? '');
          const failed = Number(log.http_status) >= 400 || (code && !SAMPLE_OK.has(code));
          if (failOnly && !failed) continue;
          const headers = { ...(req.headers || {}) };
          for (const k of Object.keys(headers)) if (/auth|token|cookie|secret/i.test(k)) delete headers[k];
          rows.push({
            host, ts: (resp.headers && (resp.headers.Date || resp.headers.date)) || null,
            verb: req.verb || req.method || 'POST', path: p, url: req.url || null,
            http_status: log.http_status ?? null, duration_ms: log.duration ?? null,
            response_code: code || null,
            response_message: (resp.body && resp.body.responseMessage) || null,
            app_platform: log.app_platform || null, app_version: log.app_version || null,
            device_id: log.device_id || null, trace_id: log.trace_id || null,
            txn: (req.body && req.body.transactionId) || null,     // = the UIL id → Case analyzer
            request_headers: headers, request_body: req.body != null ? req.body : null,
            response_body: resp.body != null ? resp.body : null, failed,
          });
        } catch (e) { /* partial line at a chunk boundary — skip */ }
      }
    } catch (e) { errors.push(`${host}: ${String(e.message || e).slice(0, 120)}`); }
  }
  rows.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0));
  return { configured: true, ok: true, path: p, failOnly: !!failOnly,
    scanned_hosts: c.hosts, errors: errors.length ? errors : undefined,
    rows: rows.slice(0, Math.min(20, Math.max(1, Number(limit) || 5))) };
}

module.exports = { start, tick, status, ping, configured, parseLines, parseLine, planRead, maskText, CFG, fetchTxnPayloads, fetchPathSamples };

// ---- CLI: node src/apiLogCollector.js --once   (manual pull + status, for on-box testing) ----
if (require.main === module) {
  (async () => {
    if (!configured()) { console.error('API_LOG_HOSTS not set'); process.exit(1); }
    await tick();
    console.log(JSON.stringify(status(), null, 2));
    await require('./db').console.end();
  })().catch(e => { console.error('collector run failed:', e.message); process.exit(1); });
}
