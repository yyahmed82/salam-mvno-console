/* OSB read-path fault watcher — polls the OSB integration log (osbLog / logs.uil_logs) and raises a
 * ChatOps incident when the 1500 / OSB-382000 SOAP-fault volume spikes. Complements the metrics engine,
 * which can only see the selfcare Postgres replica (the OSB faults live in a separate MySQL DB).
 *
 * READ-ONLY and INERT until osbLog is configured (OSB_LOG_URL / OSB_DB_HOST). Tunables:
 *   OSB_PROBE_INTERVAL_MIN (default 5) · OSB_PROBE_WINDOW_MIN (default 10) ·
 *   OSB_FAULT_ALERT_THRESHOLD (default 300 faults in the window) · OSB_PROBE_AUTO=0 to disable.
 */
const osb = require('./osbLog');
const chatops = require('./chatops');

const WINDOW = Math.max(1, Number(process.env.OSB_PROBE_WINDOW_MIN) || 10);
const THRESHOLD = Math.max(1, Number(process.env.OSB_FAULT_ALERT_THRESHOLD) || 300);
const INTERVAL = Math.max(1, Number(process.env.OSB_PROBE_INTERVAL_MIN) || 5);
let _breaching = false, _timer = null, _last = null;

async function probeOnce() {
  if (!osb.configured()) return { configured: false };
  const f = await osb.faults({ minutes: WINDOW });
  _last = { at: new Date().toISOString(), total: f.total, ok: f.ok, error: f.error };
  if (!f.ok) return f;
  const topApi = (f.byApi && f.byApi[0]) ? `${f.byApi[0].api} (${f.byApi[0].count})` : '—';
  const breach = f.total >= THRESHOLD;
  if (breach && !_breaching) {
    _breaching = true;
    try {
      await chatops.notifyIncident({
        severity: 'P1', name: 'BSS read-path OSB faults spiking (1500 / OSB-382000)', team: 'Digital Ops',
        metric_key: 'osb_read_faults', observed_value: f.total, unit: 'count',
        description: `${f.total} OSB SOAP faults in the last ${WINDOW} min (peak ${f.peakPerMin}/min). Top API: ${topApi}. BSS read APIs (list-invoices / get-account / get-sub) are timing out — app shows "details not loading", greyed balance transfer, slowness. Source: logs.uil_logs.`
      }, { kind: 'opened', force: true });
    } catch (e) { /* best-effort */ }
  } else if (!breach && _breaching) {
    _breaching = false;
    try {
      await chatops.notifyIncident({
        severity: 'P3', name: 'BSS read-path OSB faults recovered', team: 'Digital Ops',
        metric_key: 'osb_read_faults', observed_value: f.total, unit: 'count',
        description: `OSB SOAP faults back under threshold (${f.total} in ${WINDOW} min, < ${THRESHOLD}).`
      }, { kind: 'opened', force: true });
    } catch (e) { /* best-effort */ }
  }
  return { ...f, breaching: _breaching, threshold: THRESHOLD };
}

function start() {
  if (!osb.configured()) { console.log('OSB fault watcher: disabled (set OSB_LOG_URL / OSB_DB_HOST to enable).'); return; }
  if (process.env.OSB_PROBE_AUTO === '0') { console.log('OSB fault watcher: disabled via OSB_PROBE_AUTO=0.'); return; }
  if (_timer) return;
  const run = () => probeOnce().catch(() => {});
  _timer = setInterval(run, INTERVAL * 60000);
  setTimeout(run, 20000);   // first probe shortly after boot
  console.log(`OSB fault watcher: on (every ${INTERVAL}m · window ${WINDOW}m · threshold ${THRESHOLD}).`);
}

function status() { return { configured: osb.configured(), breaching: _breaching, window: WINDOW, threshold: THRESHOLD, interval: INTERVAL, last: _last }; }

module.exports = { start, probeOnce, status, configured: osb.configured };
