/* Console settings (key/value in console_settings) + the auto-sync scheduler.
 * Sync modes (like the ops console):
 *   manual        — nothing runs automatically; user clicks Sync / Simulate.
 *   auto_real     — every N sec, sync at real wall-clock now (for a truly live replica).
 *   auto_replay   — every N sec, advance a virtual clock by stepHours and sync
 *                   (simulates live traffic over the static dump — recommended default).
 */
const db = require('./db');
const { syncOnce } = require('./sync');
const { runAlerts } = require('./alertRunner');
const { dataBounds } = require('./simulate');

const DEFAULTS = {
  // Real prod-sync (scripts/sync-from-prod.sh) is the source of truth → default to manual.
  // 'auto_replay' is the demo mode that walks a virtual cursor over the static dump; only
  // pick it deliberately for a data-less demo, never with live replica data.
  sync: { enabled: false, mode: 'manual', intervalSec: 15, stepHours: 3, cursor: null },
  // interface feature flags (admin-toggleable from Settings → Sync engine)
  features: { langSwitch: false }   // Arabic/English switch hidden by default
};

async function getSetting(key) {
  const r = await db.console.query(`SELECT value FROM console_settings WHERE key=$1`, [key]);
  return r.rowCount ? r.rows[0].value : (DEFAULTS[key] || null);
}
async function setSetting(key, value) {
  await db.console.query(
    `INSERT INTO console_settings (key,value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [key, JSON.stringify(value)]);
  return value;
}

/* ---- scheduler ---- */
let timer = null, running = false, lastTick = null;

async function tickOnce() {
  if (running) return;                 // no overlap
  running = true;
  try {
    const cfg = await getSetting('sync');
    if (!cfg.enabled || cfg.mode === 'manual') return;
    let when;
    if (cfg.mode === 'auto_real') {
      when = new Date();
    } else { // auto_replay: advance virtual cursor across the data window
      const b = await dataBounds();
      const lo = new Date(b.lo), hi = new Date(b.hi);
      let cur = cfg.cursor ? new Date(cfg.cursor) : new Date(hi.getTime() - 7 * 24 * 3600e3);
      cur = new Date(cur.getTime() + (cfg.stepHours || 3) * 3600e3);
      if (cur > hi) cur = new Date(Math.max(lo.getTime(), hi.getTime() - 7 * 24 * 3600e3)); // loop
      when = cur;
      cfg.cursor = cur.toISOString();
      await setSetting('sync', cfg);
    }
    const s = await syncOnce(when);
    const a = await runAlerts(when);
    try { await require('./anomaly').detectAndRaise(when.toISOString()); } catch (e) {}
    lastTick = { at: new Date().toISOString(), sim_now: when.toISOString(), ...s, ...a };
  } catch (e) {
    lastTick = { at: new Date().toISOString(), error: e.message };
    console.error('scheduler tick failed:', e.message);
  } finally {
    running = false;
  }
}

async function applySchedule() {
  const cfg = await getSetting('sync');
  if (timer) { clearInterval(timer); timer = null; }
  if (cfg.enabled && cfg.mode !== 'manual') {
    const ms = Math.max(3, Number(cfg.intervalSec) || 15) * 1000;
    timer = setInterval(tickOnce, ms);
    console.log(`scheduler: ${cfg.mode} every ${ms / 1000}s (step ${cfg.stepHours}h)`);
  } else {
    console.log('scheduler: manual (stopped)');
  }
}

function schedulerStatus() {
  return { running: !!timer, lastTick };
}

module.exports = { getSetting, setSetting, applySchedule, tickOnce, schedulerStatus, DEFAULTS };
