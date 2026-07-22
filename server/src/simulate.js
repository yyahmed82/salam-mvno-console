/* Simulator: advance a virtual clock across the historical data window,
 * running sync + alerts at each step so real anomalies replay as live traffic. */
const db = require('./db');
const { syncOnce } = require('./sync');
const { runAlerts } = require('./alertRunner');

// find the timespan of real data so the sim clock lands on populated windows
async function dataBounds() {
  const r = await db.source.query(
    `SELECT min(created_at) AS lo, max(created_at) AS hi FROM payments`);
  return { lo: r.rows[0].lo, hi: r.rows[0].hi };
}

async function simulate({ stepHours = 3, steps = 0, fromIso, toIso, sleepMs = 0, onTick } = {}) {
  const b = await dataBounds();
  const hi = toIso ? new Date(toIso) : new Date(b.hi);
  let start;
  if (fromIso) start = new Date(fromIso);
  else if (steps > 0) start = new Date(hi.getTime() - steps * stepHours * 3600e3);
  else start = new Date(hi.getTime() - 7 * 24 * 3600e3); // default: last 7 days
  if (start < new Date(b.lo)) start = new Date(b.lo);

  let t = new Date(start);
  const results = [];
  while (t <= hi) {
    const simNow = new Date(t);
    await syncOnce(simNow);
    const a = await runAlerts(simNow);
    const line = { sim_now: simNow.toISOString(), ...a };
    results.push(line);
    if (onTick) onTick(line);
    t = new Date(t.getTime() + stepHours * 3600e3);
    if (sleepMs) await new Promise(r => setTimeout(r, sleepMs));
  }
  return { from: start.toISOString(), to: hi.toISOString(), stepHours, ticks: results.length, results };
}

module.exports = { simulate, dataBounds };
