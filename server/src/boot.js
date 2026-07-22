/* One-command boot: ensure console DB exists, seed schema+rules (idempotent),
 * seed a first replay ONLY if there are no snapshots yet, then start the API. */
const { execFileSync } = require('child_process');
const path = require('path');

function run(script, args = []) {
  execFileSync('node', [path.join(__dirname, script), ...args], { stdio: 'inherit' });
}

(async () => {
  // wait for source + console DBs to accept connections
  const db = require('./db');
  for (let i = 0; i < 60; i++) {
    try { await db.source.query('SELECT 1'); break; }
    catch (e) { console.log('waiting for source DB…'); await new Promise(r => setTimeout(r, 2000)); }
  }
  const { init } = require('./init');
  const { indexSource } = require('./indexSource');
  // ensure DB, then schema + rules
  run('ensureDb.js');
  const r = await init({ reset: false });
  console.log(`console init: ${r.metrics} metrics, ${r.rules} rules`);
  // create created_at indexes on the replica so metric queries are fast (one-time)
  console.log('ensuring source indexes for fast metrics…');
  const ix = await indexSource();
  console.log(`source indexes: ${ix.made} ok, ${ix.skipped} skipped`);

  // first-run seed: replay history only if empty
  const c = db.console;
  const { rows } = await c.query(`SELECT count(*)::int AS n FROM metric_snapshots`);
  if (rows[0].n === 0) {
    console.log('no snapshots yet — replaying history (this runs once)…');
    const { simulate } = require('./simulate');
    const out = await simulate({ stepHours: 3, steps: 56 });
    console.log(`replayed ${out.ticks} ticks ${out.from} → ${out.to}`);
  } else {
    console.log(`snapshots present (${rows[0].n}) — skipping replay. Use the console's Sync/Simulate buttons.`);
  }

  // one-time hourly-rollup backfill (bounded) so dashboards read summaries, not raw scans
  try {
    const rollups = require('./rollups');
    if (await rollups.isEmpty()) {
      console.log('rollups empty — backfilling last 90 days (one-time)…');
      const rb = await rollups.backfill({ days: 90 });
      console.log(`rollups backfilled: ${rb.rows} buckets across ${rb.chunks} days through ${rb.through}`);
    } else {
      console.log('rollups present — skipping backfill.');
    }
  } catch (e) { console.log('rollup backfill skipped:', e.message); }

  // seed default SLO targets (idempotent)
  try { await require('./slo').seedDefaults(); console.log('SLO targets ensured.'); } catch (e) { console.log('SLO seed skipped:', e.message); }

  // seed default on-call escalation policies (idempotent; disabled until configured)
  try { await require('./escalation').seedDefaults(); console.log('Escalation policies ensured.'); } catch (e) { console.log('Escalation seed skipped:', e.message); }

  // seed anomaly-detection defaults (detection on; raising incidents off until enabled)
  try { await require('./anomaly').seedDefaults(); console.log('Anomaly config ensured.'); } catch (e) { console.log('Anomaly seed skipped:', e.message); }

  // warm the role-permission overrides cache
  try { await require('./rolePerms').refresh(); console.log('Role permissions loaded.'); } catch (e) { console.log('Role perms load skipped:', e.message); }

  // hand off to the API server — reuses the same shared pools from ./db
  require('./api.js');
})().catch(e => { console.error('boot failed:', e.message); process.exit(1); });
