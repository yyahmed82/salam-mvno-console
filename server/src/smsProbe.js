/* SMS gateway (Unifonic) reachability probe.
 *
 * 152 has no internet, but the API hosts do — and they are the boxes that actually call
 * Unifonic. So every cycle we run `curl` ON each API host over the same SSH channel the log
 * collectors use, and record HTTP code + latency into sms_probe_events. That answers
 * "can the app reach the SMS gateway right now?" from the app's own vantage point.
 *
 * Enabled only when BOTH API_LOG_HOSTS (ssh channel) and SMS_PROBE_URL are set.
 *   SMS_PROBE_URL           e.g. https://el.cloud.unifonic.com  (confirm the real base URL —
 *                           it lives in the app's encrypted Rails credentials)
 *   SMS_PROBE_INTERVAL_MIN  default 5
 *   SMS_PROBE_TIMEOUT_S     default 8 (curl -m)
 *   SMS_PROBE_RETENTION_DAYS default 30
 * Any HTTP answer (even 4xx) proves REACHABILITY — DNS/TLS/route all worked; only transport
 * failures (timeout, refused, DNS) count as down. */
const { execFile } = require('child_process');
const db = require('./db');

const CFG = () => ({
  hosts: String(process.env.API_LOG_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
  user: process.env.API_LOG_USER || '',
  key: process.env.API_LOG_KEY || '',
  url: String(process.env.SMS_PROBE_URL || '').trim(),
  intervalMin: Math.max(1, Number(process.env.SMS_PROBE_INTERVAL_MIN) || 5),
  timeoutS: Math.max(2, Number(process.env.SMS_PROBE_TIMEOUT_S) || 8),
  retentionDays: Math.max(1, Number(process.env.SMS_PROBE_RETENTION_DAYS) || 30)
});
const configured = () => { const c = CFG(); return c.hosts.length > 0 && !!c.url; };

const shq = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`;
function sshCurl(host) {
  const c = CFG();
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new'];
  if (c.key) args.push('-i', c.key);
  // curl prints "<http_code> <total_seconds>"; -m caps the whole transfer
  const remote = `curl -sS -o /dev/null -m ${c.timeoutS} -w '%{http_code} %{time_total}' ${shq(c.url)} 2>&1 || true`;
  args.push(c.user ? `${c.user}@${host}` : host, remote);
  return new Promise((resolve) => {
    execFile('ssh', args, { timeout: (c.timeoutS + 10) * 1000, encoding: 'utf8' }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim();
      const m = /(\d{3})\s+([\d.]+)\s*$/.exec(out);
      if (err && !m) return resolve({ code: null, ms: null, error: (String(stderr || '') || err.message).slice(0, 200) });
      if (m && m[1] !== '000') return resolve({ code: Number(m[1]), ms: Math.round(Number(m[2]) * 1000), error: null });
      // curl writes 000 when the transfer failed (timeout/DNS/refused) — capture its message
      resolve({ code: null, ms: null, error: out.replace(/\s*000\s+[\d.]+\s*$/, '').slice(0, 200) || 'transport failure' });
    });
  });
}

let _timer = null, _bootedAt = null;
const LAST = {};   // host -> { ts, code, ms, error }
async function tick() {
  if (!configured()) return;
  const c = CFG();
  for (const host of c.hosts) {
    const r = await sshCurl(host);
    LAST[host] = { ts: new Date().toISOString(), ...r };
    try {
      await db.console.query(
        `INSERT INTO sms_probe_events (host, target, http_code, ms, error) VALUES ($1,$2,$3,$4,$5)`,
        [host, c.url, r.code, r.ms, r.error]);
    } catch (e) { /* table may not exist on first boot yet */ }
  }
  try { await db.console.query(`DELETE FROM sms_probe_events WHERE ts < now() - ($1 || ' days')::interval`, [c.retentionDays]); } catch (e) {}
}
function status() {
  const c = CFG();
  return { configured: configured(), url: c.url || null, intervalMin: c.intervalMin, bootedAt: _bootedAt,
    hosts: c.hosts.map(h => ({ host: h, ...(LAST[h] || {}) })) };
}
function start() {
  if (!configured()) { console.log('[SMS-PROBE] disabled (needs API_LOG_HOSTS + SMS_PROBE_URL)'); return { armed: false }; }
  const c = CFG();
  _bootedAt = new Date().toISOString();
  _timer = setInterval(() => { tick().catch(() => {}); }, c.intervalMin * 60000);
  _timer.unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 25000);
  console.log(`[SMS-PROBE] armed — every ${c.intervalMin} min · from: ${c.hosts.join(', ')} · target: ${c.url}`);
  return { armed: true };
}

module.exports = { start, tick, status, configured, CFG };

// CLI: node src/smsProbe.js --once
if (require.main === module) {
  (async () => {
    if (!configured()) { console.error('needs API_LOG_HOSTS + SMS_PROBE_URL'); process.exit(1); }
    await tick();
    console.log(JSON.stringify(status(), null, 2));
    await db.console.end();
  })().catch(e => { console.error('sms probe failed:', e.message); process.exit(1); });
}
