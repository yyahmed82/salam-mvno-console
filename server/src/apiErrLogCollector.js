/* App error-log collector — second file over the SAME SSH channel as apiLogCollector.
 *
 * Pulls log/api_error_logger.production.log from every API_LOG_HOSTS host each cycle and
 * lands structured rows in api_error_events. That log is written by ApiErrorLogger
 * (selfcare-backend app/lib/api_error_logger.rb): one JSON object per line, wrapped in the
 * default ActiveSupport::Logger prefix ("W, [ts #pid]  WARN -- : {json}") — the parser
 * strips everything before the first '{'.
 *
 * Why: every salam_render_error lands here with error_code + context — including the
 * IpRetrial rate-limiter blocks (error_code -704, context.rate_limit='ip_retrial',
 * context.retry_count, context.action_name) that the Monitoring KPI panel surfaces.
 *
 * Reuses the api-log collector's transport/watermark design: per-host watermark in
 * console_settings ('api_errlog_watermarks'), rotation-safe, capped increments, first-run
 * backfill, never crashes the app. Enabled whenever API_LOG_HOSTS is set (same key/user);
 * override the remote path with API_ERRLOG_PATH. */
const { execFile } = require('child_process');
const db = require('./db');
const { maskText } = require('./apiLogCollector');

const MB = 1024 * 1024;
const CFG = () => ({
  hosts: String(process.env.API_LOG_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
  user: process.env.API_LOG_USER || '',
  key: process.env.API_LOG_KEY || '',
  path: process.env.API_ERRLOG_PATH || '/www/app/salam_api/shared/log/api_error_logger.production.log',
  intervalMin: Math.max(1, Number(process.env.API_ERRLOG_INTERVAL_MIN) || 2),
  capBytes: Math.max(1, Number(process.env.API_ERRLOG_MAX_MB) || 10) * MB,
  backfillBytes: Math.max(1, Number(process.env.API_ERRLOG_BACKFILL_MB) || 20) * MB,
  retentionDays: Math.max(1, Number(process.env.API_ERRLOG_RETENTION_DAYS) || 14)
});
const configured = () => CFG().hosts.length > 0;

/* ---- parsing (exported for tests) --------------------------------------------------------- */
function parseLine(line) {
  const i = line.indexOf('{');
  if (i < 0) return null;
  let o; try { o = JSON.parse(line.slice(i)); } catch (e) { return null; }
  if (!o || o.event !== 'api_error' || !o.timestamp) return null;
  const ctx = o.context || {};
  const int = v => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };
  return {
    ts: o.timestamp,
    level: o.level || null,
    error_code: int(o.error_code),
    http_status: int(o.http_status),
    source: o.source || null,
    controller: o.controller || null,
    action: o.action || null,
    platform: o.platform || null,
    app_version: o.app_version || null,
    ip_address: o.ip_address || ctx.ip_address || null,
    user_type: o.user_type || null,
    rate_limit: ctx.rate_limit || null,
    retry_count: int(ctx.retry_count),
    action_name: ctx.action_name || null,
    message: o.message ? maskText(String(o.message)).slice(0, 300) : null,
    request_id: o.request_id || null,
    trace_id: o.trace_id || null,               // = the "Device ID" shown in the app's error dialog
    device_id: o.device_id || null,
    exception_class: ctx.exception_class || null,
    frame: Array.isArray(ctx.backtrace) && ctx.backtrace[0]
      ? String(ctx.backtrace[0]).replace(/^.*\/(app\/|lib\/)/, '$1').slice(0, 200) : null
  };
}
function parseLines(text) {
  const out = [];
  for (const line of String(text).split('\n')) { const r = parseLine(line); if (r) out.push(r); }
  return out;
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
    execFile('ssh', args, { maxBuffer: maxBuffer || 4 * MB, timeout: 60000, encoding: binary ? 'buffer' : 'utf8' },
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

/* ---- watermarks --------------------------------------------------------------------------- */
const WM_KEY = 'api_errlog_watermarks';
async function loadWm() {
  try { const r = await db.console.query(`SELECT value FROM console_settings WHERE key=$1`, [WM_KEY]);
    return r.rowCount ? (r.rows[0].value || {}) : {}; } catch (e) { return {}; }
}
async function saveWm(wm) {
  await db.console.query(
    `INSERT INTO console_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [WM_KEY, JSON.stringify(wm)]);
}

/* ---- insert ------------------------------------------------------------------------------- */
const COLS = ['ts', 'host', 'level', 'error_code', 'http_status', 'source', 'controller', 'action',
  'platform', 'app_version', 'ip_address', 'user_type', 'rate_limit', 'retry_count', 'action_name', 'message', 'request_id',
  'trace_id', 'device_id', 'exception_class', 'frame'];
const BATCH = 1000;   // 1000 rows × 17 cols = 17k params — safely under Postgres's 65,535 limit
async function insertRows(host, rows) {
  if (!rows.length) return 0;
  for (let off = 0; off < rows.length; off += BATCH) {
    const slice = rows.slice(off, off + BATCH);
    const vals = [], ph = [];
    slice.forEach((r, i) => {
      const base = i * COLS.length;
      ph.push('(' + COLS.map((_, j) => `$${base + j + 1}`).join(',') + ')');
      vals.push(r.ts, host, r.level, r.error_code, r.http_status, r.source, r.controller, r.action,
        r.platform, r.app_version, r.ip_address, r.user_type, r.rate_limit, r.retry_count, r.action_name, r.message, r.request_id,
        r.trace_id, r.device_id, r.exception_class, r.frame);
    });
    await db.console.query(`INSERT INTO api_error_events (${COLS.join(',')}) VALUES ${ph.join(',')}`, vals);
  }
  return rows.length;
}

/* ---- collection cycle --------------------------------------------------------------------- */
const HOST_STATUS = {};
let _timer = null, _bootedAt = null;
async function collectHost(host, wm) {
  const c = CFG();
  const st = HOST_STATUS[host] = HOST_STATUS[host] || { eventsIngested: 0, rotations: 0 };
  try {
    const size = await remoteSize(host);
    const plan = planRead({ watermark: wm[host], size, backfillBytes: c.backfillBytes });
    if (plan.rotated) st.rotations++;
    const cap = Math.min(c.capBytes, Math.max(0, size - plan.start));
    let inserted = 0, newWm = plan.start;
    if (cap > 0) {
      const buf = await remoteChunk(host, plan.start, cap);
      let text = buf.toString('utf8');
      // drop the first partial line unless we're at the true file start
      if (plan.start > 0) { const nl = text.indexOf('\n'); text = nl >= 0 ? text.slice(nl + 1) : ''; }
      // advance only past COMPLETE lines
      const lastNl = buf.lastIndexOf(0x0a);
      newWm = lastNl >= 0 ? plan.start + lastNl + 1 : plan.start;
      inserted = await insertRows(host, parseLines(text));
    } else { newWm = size; }
    wm[host] = newWm;
    st.watermark = newWm; st.size = size; st.lagBytes = Math.max(0, size - newWm);
    st.eventsIngested += inserted; st.lastRunAt = new Date().toISOString(); st.lastError = null;
  } catch (e) { st.lastError = String(e.message || e).slice(0, 300); st.lastRunAt = new Date().toISOString(); }
}
async function tick() {
  if (!configured()) return;
  const wm = await loadWm();
  for (const host of CFG().hosts) await collectHost(host, wm);
  await saveWm(wm);
  try { await db.console.query(`DELETE FROM api_error_events WHERE ts < now() - ($1 || ' days')::interval`, [CFG().retentionDays]); } catch (e) {}
}
function status() {
  const c = CFG();
  return { configured: configured(), logPath: c.path, intervalMin: c.intervalMin, bootedAt: _bootedAt,
    hosts: c.hosts.map(h => ({ host: h, ...(HOST_STATUS[h] || {}) })) };
}
function start() {
  if (!configured()) { console.log('[ERRLOG] no API_LOG_HOSTS — app-error collector disabled'); return { armed: false }; }
  const c = CFG();
  _bootedAt = new Date().toISOString();
  _timer = setInterval(() => { tick().catch(() => {}); }, c.intervalMin * 60000);
  _timer.unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 20000);
  console.log(`[ERRLOG] app-error collector armed — every ${c.intervalMin} min · hosts: ${c.hosts.join(', ')} · ${c.path}`);
  return { armed: true };
}

module.exports = { start, tick, status, configured, parseLine, parseLines, planRead, CFG };

// CLI: node src/apiErrLogCollector.js --once
if (require.main === module) {
  (async () => {
    if (!configured()) { console.error('API_LOG_HOSTS not set'); process.exit(1); }
    await tick();
    console.log(JSON.stringify(status(), null, 2));
    await db.console.end();
  })().catch(e => { console.error('errlog collector run failed:', e.message); process.exit(1); });
}
