/* Recurring prod → local-replica sync, INSIDE the console container.
 *
 * Runs only when PROD_DATABASE_URL is set (so it's a no-op on installs without prod creds).
 * Replaces the host launchd/cron job, which macOS TCC blocks from reading ~/Documents.
 * Each tick: incremental prod pull (prodSync.run) → POST /api/sync so the console reprocesses
 * (snapshots, rollups, alerts, anomaly, notifications) exactly like a manual sync.
 *
 * Env: PROD_SYNC_INTERVAL_MIN (default 30), PROD_SYNC_AUTO=0 to disable,
 *      CONSOLE_ADMIN_USER (default y.yahmed.sns@salam.sa) for the internal /api/sync call.
 */
const prodSync = require('./prodSync');
const chatops = require('./chatops');

let _busy = false, _failStreak = 0, _downAlerted = false;
const DOWN_TICKS = Math.max(1, Number(process.env.PROD_SYNC_DOWN_ALERT_TICKS) || 2);   // alert after N consecutive unreachable checks

// real-time "console is blind" heads-up (Teams/Slack) so on-call knows live alerting is paused
async function notifyLiveness(kind, extra) {
  const alert = kind === 'down'
    ? { severity: 'P1', name: 'Console sync DOWN — live alerting is BLIND', team: 'Digital Ops', metric_key: 'sync_liveness',
        description: `Prod replica unreachable (VPN down?). The console is NOT receiving fresh data, so real-time alerts are paused — watch prod directly until restored. ${extra || ''}` }
    : { severity: 'P3', name: 'Console sync RESTORED — catching up', team: 'Digital Ops', metric_key: 'sync_liveness',
        description: `Prod replica reachable again; the console is pulling the backlog since the last watermark. ${extra || ''}` };
  try { await chatops.notifyIncident(alert, { kind: 'opened', force: true }); } catch (e) {}
}

async function tick() {
  if (!process.env.PROD_DATABASE_URL) return;
  if (_busy || (prodSync.isRunning && prodSync.isRunning())) return;
  // connectivity/VPN precheck — skip cleanly (not an error) when prod isn't reachable
  const rc = await prodSync.ping();
  if (!rc.ok) {
    _failStreak++;
    console.log(`[PROD-SYNC] prod not reachable (VPN down?) — skipping tick: ${rc.reason} (streak ${_failStreak})`);
    if (!_downAlerted && _failStreak >= DOWN_TICKS) { _downAlerted = true; await notifyLiveness('down', `Unreachable for ~${_failStreak} checks.`); }
    return;
  }
  if (_downAlerted) { await notifyLiveness('restored'); }   // transition back up
  _failStreak = 0; _downAlerted = false;
  _busy = true;
  const t0 = Date.now();
  try {
    const out = await prodSync.run({});   // incremental (advances the cursor)
    const errs = (out.results || []).filter(r => r.error);
    console.log(`[PROD-SYNC] pulled ${out.rows} rows / ${out.tables} tables in ${out.seconds}s` + (errs.length ? ` · ${errs.length} table error(s): ${errs.map(e => e.table).join(',')}` : ''));
    // let the console reprocess the freshly-synced rows (rollups + alerts + anomaly + notify)
    const PORT = process.env.PORT || 4600;
    const admin = process.env.CONSOLE_ADMIN_USER || 'y.yahmed.sns@salam.sa';
    if (typeof fetch === 'function') {
      const code = await fetch(`http://127.0.0.1:${PORT}/api/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Console-User': admin }, body: '{}'
      }).then(r => r.status).catch(e => 'ERR:' + e.message);
      console.log(`[PROD-SYNC] console /api/sync → ${code}`);
    }
  } catch (e) {
    console.error('[PROD-SYNC] tick failed:', e.message);
    try { await require('./reliability').captureError(e, { route: 'prodSyncScheduler', level: 'warn' }); } catch (_) {}
  } finally {
    _busy = false;
    void t0;
  }
}

function start() {
  if (!process.env.PROD_DATABASE_URL) { console.log('[PROD-SYNC] no PROD_DATABASE_URL — auto-sync disabled'); return { armed: false }; }
  if (process.env.PROD_SYNC_AUTO === '0') { console.log('[PROD-SYNC] PROD_SYNC_AUTO=0 — auto-sync disabled'); return { armed: false }; }
  const min = Math.max(5, Number(process.env.PROD_SYNC_INTERVAL_MIN) || 30);
  setInterval(() => { tick().catch(() => {}); }, min * 60000).unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 15000);   // first run shortly after boot
  console.log(`[PROD-SYNC] scheduler armed — every ${min} min`);
  return { armed: true, min };
}

module.exports = { start, tick };
