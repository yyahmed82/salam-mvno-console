/* FIXED APP-LOG COLLECTOR — tails the Fixed platform's winston combined.log (the Salam Home / SDA /
 * Web e-purchase Node app) over SSH and lands the lines that matter in unified_console.fixed_app_events.
 *
 * WHY (15 Sep 2026): identity-provider outcomes never reach the sda_ops read models. Yakeen (ELM NIC check,
 * `getYakeenInfo` under tRPC path sda.actions.validateIndividualCustomer) is called inside the app process
 * and logged ONLY to combined.log — there is no api_calls row for it, so the "yakeen issue" of 14 Sep could
 * only be seen by grepping the log by hand. The same is true of getYakeenAddress and of the tRPC mutation
 * outcome lines ("mutation <path> success|fail Nms"). This collector is the single feed for:
 *   · the Fixed Operations Dashboard Yakeen success-rate line + failure-reason columns (fixedExec.js)
 *   · the Log Intelligence agent (agentLog.js ingestFixed, source 'fixed-app')
 *   · the Troubleshoot provider lane (next step)
 *
 * LINE SHAPES (verified from the Technical Issues FTTH & 5G WhatsApp thread, real prod lines):
 *   {"channel":"mobile","error":{"message":"The provided inputs does not match NIC records","statusCode":400},
 *    "level":"info","message":"getYakeenInfo Response","path":"sda.actions.validateIndividualCustomer",
 *    "rawInput":{...PII...},"request":{"dateOfBirth":"…","idNumber":"…"},"requestId":"w13zsygje1e5","source":"sda",
 *    "staffId":"stf_…","timestamp":"2026-06-21 20:34:57","type":"mutation","version":"3.4.3"}
 *   same shape, "message":"getYakeenAddress", error.statusCode 404 "عفوا .. لا توجد بيانات …"
 *   {"level":"error","message":"tRPC error: Failed to validate customer info with Yakeen","path":"sda.actions.validateIndividualCustomer",
 *    "error":{"code":"BAD_REQUEST","name":"TRPCError"},"shape":{"data":{"httpStatus":400}},…}
 *   {"message":"mutation sda.actions.saveLocation success 123ms", …}   (per-step outcome, from the ops console parser)
 *   {"message":"fetchApi: https://…/drm/prod/sendAbsherValidateCode Response","service":"…","response":{"resultCode":"0",…}}
 * A Yakeen line WITHOUT an `error` object is counted as a success — the success shape has not been seen in
 * the thread (only failures get pasted), so this is the stated assumption and the chart sub says so.
 * `timestamp` is the app's wall clock = KSA (the prod box runs Asia/Riyadh) — parsed as +03:00.
 *
 * PII: rawInput / input / request carry national id, birth date, email, mobile — NEVER stored. Only the
 * masked message/reason (digit runs masked like apiLogCollector.maskText), path, ids and codes are kept.
 *
 * TRANSPORT / WATERMARK: identical design to apiErrLogCollector (system ssh, per-host byte watermark in
 * console_settings 'fixed_applog_watermarks', rotation-safe, capped increments, first-run tail backfill,
 * never crashes the app). Enabled only when FIXED_LOG_HOSTS is set.
 *
 * Env: FIXED_LOG_HOSTS=172.31.38.146      (presence = collector ON)
 *      FIXED_LOG_USER / FIXED_LOG_KEY      (default: API_LOG_USER / API_LOG_KEY — the same console_ro identity)
 *      FIXED_LOG_PATH                      (remote combined.log path — REQUIRED to be right; see deploy notes)
 *      FIXED_LOG_INTERVAL_MIN (2) · FIXED_LOG_MAX_MB (30 per cycle) · FIXED_LOG_BACKFILL_MB (200 first run)
 *      FIXED_LOG_RETENTION_DAYS (30) */
'use strict';
const { execFile } = require('child_process');
const db = require('./db');
const { maskText } = require('./apiLogCollector');

const MB = 1024 * 1024;
const CFG = () => ({
  hosts: String(process.env.FIXED_LOG_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
  user: process.env.FIXED_LOG_USER || process.env.API_LOG_USER || '',
  key: process.env.FIXED_LOG_KEY || process.env.API_LOG_KEY || '',
  path: process.env.FIXED_LOG_PATH || '/app/logs/combined.log',
  intervalMin: Math.max(1, Number(process.env.FIXED_LOG_INTERVAL_MIN) || 2),
  capBytes: Math.max(1, Number(process.env.FIXED_LOG_MAX_MB) || 30) * MB,
  backfillBytes: Math.max(1, Number(process.env.FIXED_LOG_BACKFILL_MB) || 200) * MB,
  retentionDays: Math.max(1, Number(process.env.FIXED_LOG_RETENTION_DAYS) || 30)
});
const configured = () => CFG().hosts.length > 0;

/* ---- classification ------------------------------------------------------------------------
 * kind      what the line is about              ok = success?
 * yakeen    getYakeenInfo (ELM NIC record check) no `error` object
 * yakeen_address getYakeenAddress                no `error` object
 * absher    DRM sendAbsherValidateCode/checkValidateCode   response.resultCode '0'
 * nafath / semati / manafith   DRM + tRPC provider calls   resultCode '0' / no error
 * drm       any other fetchApi …/drm/prod/… Response       resultCode '0'   (failures only are kept)
 * mutation  "mutation <path> success|fail Nms"             success
 * error     any level:error line                            false
 * reason_class: business (provider refused: 400/404/mismatch/not-found/not-eligible) · technical (5xx,
 * timeout, gateway, ECONN, TLS) · client (validation/zod) · null when ok */
const PROVIDER_RE = [
  [/getYakeenInfo/i, 'yakeen'], [/getYakeenAddress/i, 'yakeen_address'],
  [/sendAbsherValidateCode|checkValidateCode|absher/i, 'absher'],
  [/nafath/i, 'nafath'], [/semati|IssueNewMobileIndividual/i, 'semati'], [/dealerValidation|manafith/i, 'manafith'],
];
const MUT_RE = /^mutation\s+(\S+)\s+(success|succeeded|fail|failed|error)\b(?:.*?(\d+)\s*ms)?/i;
const TECH_RE = /timed? ?out|timeout|gateway|\b5\d\d\b|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|TLS|certificate|unavailable|internal (server )?error|system error|<h1>|exception/i;
const CLIENT_RE = /is not a valid|ZodError|invalid_type|Required|too_small|too_big|validation/i;
/* dflt = what an unclassifiable failure defaults to: a provider/DRM result-code refusal is business (the
 * provider answered and said no); a bare mutation failure or level:error line is technical (something broke) */
function reasonClass(ok, status, reason, dflt) {
  if (ok) return null;
  const s = Number(status), r = String(reason || '');
  if (CLIENT_RE.test(r)) return 'client';
  if ((s >= 500) || TECH_RE.test(r)) return 'technical';
  if (s === 400 || s === 404 || s === 403 || s === 422 || /not match|not found|no data|لا توجد|not eligible|mismatch|already exists|not registered|no mobile/i.test(r)) return 'business';
  return dflt || (s ? 'business' : 'technical');
}
const channelOf = (o) => {
  const p = String(o.path || '');
  if (/^sda\./i.test(p)) return 'sda';
  if (/^ePurchase\./i.test(p)) return String(o.source || '').toLowerCase() === 'salamhome' || String(o.channel || '').toLowerCase() === 'salamhome' ? 'salamhome' : 'web';
  const src = String(o.source || '').toLowerCase();
  if (src === 'sda') return 'sda';
  if (src === 'salamhome') return 'salamhome';
  if (src === 'epurchase' || src === 'pulse') return 'web';
  return null;
};
const tsOf = (o) => {
  const t = String(o.timestamp || '').trim();
  if (!t) return null;
  const d = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(t) ? new Date(t.replace(' ', 'T') + '+03:00') : new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString();
};
const short = (s, n) => s == null ? null : maskText(String(s)).replace(/\s+/g, ' ').trim().slice(0, n);

function parseLine(line) {
  const i = line.indexOf('{'); if (i < 0) return null;
  let o; try { o = JSON.parse(line.slice(i)); } catch (e) { return null; }
  if (!o || typeof o !== 'object') return null;
  const ts = tsOf(o); if (!ts) return null;
  const msg = String(o.message || ''), level = String(o.level || '').toLowerCase();
  const err = o.error && typeof o.error === 'object' ? o.error : null;
  const resp = o.response && typeof o.response === 'object' ? o.response : null;
  let kind = null, ok = null, status = null, reason = null, duration = null, path = o.path || null, dflt = 'technical';
  for (const [re, k] of PROVIDER_RE) if (re.test(msg) || re.test(String(o.service || '')) || re.test(path || '')) { kind = k; break; }
  const m = MUT_RE.exec(msg);
  if (m) {
    kind = kind || 'mutation'; path = path || m[1]; ok = /^succ/i.test(m[2]); duration = m[3] ? Number(m[3]) : null;
    if (!ok) reason = short(msg, 300);
  } else if (level === 'error') {
    kind = kind || 'error'; ok = false;
    status = (o.shape && o.shape.data && o.shape.data.httpStatus) || (err && (err.statusCode || err.httpStatus)) || null;
    reason = short((err && err.message) || msg.replace(/^tRPC error:\s*/i, ''), 300);
  } else if (/fetchApi:.*Response/i.test(msg) || /Response$/i.test(msg)) {
    if (!kind) { kind = /\/drm\//i.test(msg) ? 'drm' : null; if (!kind) return null; }
    if (err) { ok = false; status = err.statusCode || err.status || null; reason = short(err.message || err.code || 'error', 300); }
    else if (resp && resp.resultCode != null) { ok = String(resp.resultCode) === '0'; if (!ok) { status = null; dflt = 'business'; reason = short(resp.resultDesc || resp.message || `resultCode ${resp.resultCode}`, 300); } }
    else if (resp && resp.statusCode != null) { ok = Number(resp.statusCode) < 400; status = Number(resp.statusCode); if (!ok) reason = short(resp.message || `HTTP ${resp.statusCode}`, 300); }
    else ok = true;
    if (kind === 'drm' && ok) return null;                   // plain DRM successes are volume, not signal
  } else if (kind) {                                          // provider line with a different message shape (e.g. "getYakeenAddress")
    if (err) { ok = false; status = err.statusCode || err.status || null; reason = short(err.message || err.code || 'error', 300); }
    else ok = true;
  } else return null;
  return {
    ts, channel: channelOf(o), source: o.source ? String(o.source).slice(0, 40) : null, level: level || null,
    path: path ? String(path).slice(0, 160) : null, kind, ok, status_code: status != null && Number.isFinite(Number(status)) ? Number(status) : null,
    reason, reason_class: reasonClass(ok, status, reason, dflt), message: short(msg, 200),
    request_id: o.requestId ? String(o.requestId).slice(0, 64) : null,
    state_id: (o.rawInput && o.rawInput.stateId) || (o.input && o.input.stateId) || null,
    platform: o.platform ? String(o.platform).slice(0, 20) : null, app_version: o.version ? String(o.version).slice(0, 20) : null,
    duration_ms: duration
  };
}
function parseLines(text) {
  const out = []; let seen = 0;
  for (const line of String(text).split('\n')) { if (!line.trim()) continue; seen++; const r = parseLine(line); if (r) out.push(r); }
  return { rows: out, lines: seen };
}
function planRead({ watermark, size, backfillBytes }) {
  if (watermark == null) return { start: Math.max(0, size - backfillBytes), rotated: false, firstRun: true };
  if (size < watermark) return { start: 0, rotated: true, firstRun: false };
  return { start: watermark, rotated: false, firstRun: false };
}

/* ---- ssh transport (same options as apiLogCollector) -------------------------------------- */
const shq = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`;
function sshExec(host, remoteCmd, { maxBuffer, binary } = {}) {
  const c = CFG();
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new'];
  if (c.key) args.push('-i', c.key);
  args.push(c.user ? `${c.user}@${host}` : host, remoteCmd);
  return new Promise((resolve, reject) => {
    execFile('ssh', args, { maxBuffer: maxBuffer || 4 * MB, timeout: 90000, encoding: binary ? 'buffer' : 'utf8' },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((String(stderr || '') || err.message || 'ssh failed').trim().slice(0, 400)));
        resolve(stdout);
      });
  });
}
const remoteSize = host => sshExec(host, `wc -c < ${shq(CFG().path)}`).then(out => {
  const n = Number(String(out).trim()); if (!Number.isFinite(n)) throw new Error('bad size: ' + String(out).slice(0, 60)); return n;
});
const remoteChunk = (host, start, cap) =>
  sshExec(host, `tail -c +${start + 1} ${shq(CFG().path)} | head -c ${cap}`, { maxBuffer: cap + MB, binary: true });

/* ---- schema + watermarks ------------------------------------------------------------------- */
let _tableOk = false;
async function ensureTable() {
  if (_tableOk) return;
  await db.console.query(`
    CREATE TABLE IF NOT EXISTS fixed_app_events (
      id bigserial PRIMARY KEY,
      ts timestamptz NOT NULL, host text NOT NULL,
      channel text, source text, level text, path text, kind text NOT NULL,
      ok boolean, status_code integer, reason text, reason_class text, message text,
      request_id text, state_id text, platform text, app_version text, duration_ms integer);
    CREATE INDEX IF NOT EXISTS idx_fixed_app_events_ts ON fixed_app_events (ts DESC);
    CREATE INDEX IF NOT EXISTS idx_fixed_app_events_kind_ts ON fixed_app_events (kind, ts DESC);`);
  _tableOk = true;
}
const WM_KEY = 'fixed_applog_watermarks';
async function loadWm() {
  try { const r = await db.console.query(`SELECT value FROM console_settings WHERE key=$1`, [WM_KEY]);
    return r.rowCount ? (r.rows[0].value || {}) : {}; } catch (e) { return {}; }
}
async function saveWm(wm) {
  await db.console.query(
    `INSERT INTO console_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [WM_KEY, JSON.stringify(wm)]);
}

const COLS = ['ts', 'host', 'channel', 'source', 'level', 'path', 'kind', 'ok', 'status_code', 'reason', 'reason_class', 'message',
  'request_id', 'state_id', 'platform', 'app_version', 'duration_ms'];
const BATCH = 1000;
async function insertRows(host, rows) {
  if (!rows.length) return 0;
  await ensureTable();
  for (let off = 0; off < rows.length; off += BATCH) {
    const slice = rows.slice(off, off + BATCH);
    const vals = [], ph = [];
    slice.forEach((r, i) => {
      const base = i * COLS.length;
      ph.push('(' + COLS.map((_, j) => `$${base + j + 1}`).join(',') + ')');
      vals.push(r.ts, host, r.channel, r.source, r.level, r.path, r.kind, r.ok, r.status_code, r.reason, r.reason_class, r.message,
        r.request_id, r.state_id, r.platform, r.app_version, r.duration_ms);
    });
    await db.console.query(`INSERT INTO fixed_app_events (${COLS.join(',')}) VALUES ${ph.join(',')}`, vals);
  }
  return rows.length;
}

/* ---- collection cycle --------------------------------------------------------------------- */
const HOST_STATUS = {};
let _timer = null, _bootedAt = null, _busy = false;
async function collectHost(host, wm) {
  const c = CFG();
  const st = HOST_STATUS[host] = HOST_STATUS[host] || { eventsIngested: 0, linesSeen: 0, rotations: 0 };
  try {
    const size = await remoteSize(host);
    const plan = planRead({ watermark: wm[host], size, backfillBytes: c.backfillBytes });
    if (plan.rotated) st.rotations++;
    const cap = Math.min(c.capBytes, Math.max(0, size - plan.start));
    let inserted = 0, newWm = plan.start;
    if (cap > 0) {
      const buf = await remoteChunk(host, plan.start, cap);
      let text = buf.toString('utf8');
      if (plan.start > 0) { const nl = text.indexOf('\n'); text = nl >= 0 ? text.slice(nl + 1) : ''; }
      const lastNl = buf.lastIndexOf(0x0a);
      newWm = lastNl >= 0 ? plan.start + lastNl + 1 : plan.start;
      const { rows, lines } = parseLines(text);
      inserted = await insertRows(host, rows);
      st.linesSeen += lines;
      if (rows.length) st.lastTs = rows[rows.length - 1].ts;
    } else { newWm = size; }
    wm[host] = newWm;
    st.watermark = newWm; st.size = size; st.lagBytes = Math.max(0, size - newWm);
    st.eventsIngested += inserted; st.lastRunAt = new Date().toISOString(); st.lastError = null;
  } catch (e) { st.lastError = String(e.message || e).slice(0, 300); st.lastRunAt = new Date().toISOString(); }
}
async function tick() {
  if (!configured() || _busy) return;
  _busy = true;
  try {
    await ensureTable().catch(e => console.error('[FIXED-LOG] table: ' + e.message));
    const wm = await loadWm();
    for (const host of CFG().hosts) await collectHost(host, wm);
    await saveWm(wm).catch(e => console.error('[FIXED-LOG] watermark save failed: ' + e.message));
    try { await db.console.query(`DELETE FROM fixed_app_events WHERE ts < now() - ($1 || ' days')::interval`, [String(CFG().retentionDays)]); } catch (e) {}
  } catch (e) { console.error('[FIXED-LOG] tick failed: ' + e.message); }
  finally { _busy = false; }
}
function status() {
  const c = CFG();
  return { configured: configured(), logPath: c.path, user: c.user || null, intervalMin: c.intervalMin, retentionDays: c.retentionDays, bootedAt: _bootedAt,
    hosts: c.hosts.map(h => ({ host: h, ...(HOST_STATUS[h] || {}) })) };
}
async function ping() {
  if (!configured()) return { ok: false, configured: false };
  const t0 = Date.now();
  try {
    const r = await db.console.query(`SELECT count(*)::bigint AS n, max(ts) AS newest, count(*) FILTER (WHERE kind='yakeen')::bigint AS yakeen FROM fixed_app_events`);
    return { ok: true, configured: true, ms: Date.now() - t0, events: Number(r.rows[0].n), yakeen: Number(r.rows[0].yakeen), newestTs: r.rows[0].newest ? new Date(r.rows[0].newest).toISOString() : null };
  } catch (e) { return { ok: false, configured: true, ms: Date.now() - t0, error: e.message }; }
}
function start() {
  if (!configured()) { console.log('[FIXED-LOG] no FIXED_LOG_HOSTS — Fixed app-log collector disabled (Yakeen charts stay empty)'); return { armed: false }; }
  const c = CFG();
  _bootedAt = new Date().toISOString();
  _timer = setInterval(() => { tick().catch(() => {}); }, c.intervalMin * 60000);
  _timer.unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 30000);
  console.log(`[FIXED-LOG] Fixed app-log collector armed — every ${c.intervalMin} min · hosts: ${c.hosts.join(', ')} · ${c.path}`);
  return { armed: true };
}

module.exports = { start, tick, status, ping, configured, parseLine, parseLines, planRead, reasonClass, CFG };

// CLI: node src/fixedAppLogCollector.js --once   |   --parse <file> (offline parser check, no ssh, no DB)
if (require.main === module) {
  (async () => {
    const pi = process.argv.indexOf('--parse');
    if (pi > 0) {
      const text = require('fs').readFileSync(process.argv[pi + 1], 'utf8');
      const { rows, lines } = parseLines(text);
      const byKind = {}; for (const r of rows) { const k = byKind[r.kind] || (byKind[r.kind] = { n: 0, ok: 0, fail: 0 }); k.n++; if (r.ok) k.ok++; else k.fail++; }
      console.log(JSON.stringify({ lines, kept: rows.length, byKind, sample: rows.slice(0, 5) }, null, 2));
      return;
    }
    if (!configured()) { console.error('FIXED_LOG_HOSTS not set'); process.exit(1); }
    await tick();
    console.log(JSON.stringify(status(), null, 2));
    console.log(JSON.stringify(await ping()));
    await db.console.end();
  })().catch(e => { console.error('fixed app-log collector run failed:', e.message); process.exit(1); });
}
