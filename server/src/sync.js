/* Watcher: compute every metric at a given virtual `now` and write metric_snapshots. */
const { METRICS } = require('./metrics');
const db = require('./db');

// Only compute the (metric, window) pairs some enabled rule needs — not the full cross-product.
let _pairCache = null, _pairCacheAt = 0;
async function neededPairs() {
  if (_pairCache && Date.now() - _pairCacheAt < 30000) return _pairCache;
  const r = await db.console.query(
    `SELECT DISTINCT metric_key, window_hours FROM alert_rules WHERE enabled = true`);
  const map = {};
  for (const row of r.rows) {
    if (!METRICS[row.metric_key]) continue;
    (map[row.metric_key] ||= new Set()).add(Number(row.window_hours));
  }
  _pairCache = map; _pairCacheAt = Date.now();
  return map;
}

async function syncOnce(simNow, { windows } = {}) {
  const now = simNow instanceof Date ? simNow.toISOString() : simNow;
  const pairs = windows
    ? Object.fromEntries(Object.keys(METRICS).map(k => [k, new Set(windows)]))
    : await neededPairs();
  const client = await db.console.connect();
  let written = 0;
  const run = await client.query(`INSERT INTO sync_runs (sim_now) VALUES ($1) RETURNING id`, [now]);
  const runId = run.rows[0].id;
  try {
    for (const [key, wins] of Object.entries(pairs)) {
      const m = METRICS[key]; if (!m) continue;
      for (const w of wins) {
        let rows;
        try { rows = await m.compute(db.source, now, w); }
        catch (e) { console.error(`metric ${key} w=${w} failed: ${e.message}`); continue; }
        for (const r of rows) {
          await client.query(
            `INSERT INTO metric_snapshots (metric_key, dim, window_hours, value, sample, sim_now)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [key, JSON.stringify(r.dim || {}), w, r.value, r.sample || 0, now]);
          written++;
        }
      }
    }
    await client.query(`UPDATE sync_runs SET finished_at=now(), metrics_written=$2 WHERE id=$1`, [runId, written]);
  } finally {
    client.release();
  }
  return { runId, written };
}

module.exports = { syncOnce };
