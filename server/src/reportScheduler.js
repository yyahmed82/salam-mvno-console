/* Twice-daily Sync Health report at 08:00 and 20:00 KSA.
 * Checks every minute; a slot fires once (deduped in console_settings so restarts don't double-send).
 * A short catch-up window (first 5 min of the hour) covers timer drift / a slightly-late boot. */
const settings = require('./settings');
const syncHealth = require('./syncHealth');

const SLOTS = [8, 20];             // KSA hours
const WINDOW_MIN = 5;              // fire within the first N minutes of the slot hour

function ksaParts(d = new Date()) {
  const k = new Date(d.getTime() + 3 * 3600e3);   // KSA = UTC+3
  return { day: k.toISOString().slice(0, 10), hour: k.getUTCHours(), min: k.getUTCMinutes() };
}

async function tick() {
  try {
    const { day, hour, min } = ksaParts();
    if (!SLOTS.includes(hour) || min >= WINDOW_MIN) return;
    const slot = `${day}#${String(hour).padStart(2, '0')}`;
    const st = (await settings.getSetting('sync_health_report')) || {};
    if (st.lastSlot === slot) return;                 // already sent this slot
    const out = await syncHealth.send();
    await settings.setSetting('sync_health_report',
      { ...st, lastSlot: slot, lastSentAt: new Date().toISOString(), lastStatus: out.status, lastSent: out.sent, lastRecipients: (out.recipients || []).length });
    console.log(`[SYNC-HEALTH] ${slot} KSA → ${out.status}, sent=${out.sent} to ${(out.recipients || []).length}`);
  } catch (e) { console.error('[SYNC-HEALTH] tick failed:', e.message); }
}

function start() {
  setInterval(tick, 60 * 1000);
  tick();                          // catch a slot if we boot inside its window
  console.log(`[SYNC-HEALTH] scheduler armed for ${SLOTS.map(h => String(h).padStart(2, '0') + ':00').join(' & ')} KSA`);
  return { slots: SLOTS };
}

module.exports = { start, tick, SLOTS };
