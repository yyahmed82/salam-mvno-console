#!/usr/bin/env node
/* Salam Console — prod-sync WATCHDOG (belt & braces around the in-app scheduler).
 *
 * Run from cron every 5 min. It does NOT sync blindly: it measures real freshness first and only
 * acts when the replica is actually behind, so prod sees no extra load on a healthy system.
 *
 *   1. single-instance lock  → overlapping runs can never stack up on prod
 *   2. measure lag           → 2 cheap max(created_at) reads (indexed, ms)
 *   3. act only if behind    → POST /api/prod-sync/run, then verify it actually advanced
 *   4. retry with backoff    → N attempts, exponential, capped total runtime
 *   5. self-heal watermarks  → if a table's watermark is stuck far behind while newer rows exist
 *                              upstream, re-pull that window explicitly (fixes a wedged cursor)
 *   6. record status         → console DB + log line, so the UI/alerts can see the watchdog itself
 *
 * PROD SAFETY: read-only against prod (two max() queries), every connection has a hard
 * statement_timeout, the sync it triggers uses the app's existing batch/sleep throttles, and the
 * whole run is bounded by MAX_RUNTIME_SEC. If anything hangs, it exits rather than piling on.
 *
 * Env (inherits /apps/console/.env):
 *   LAG_WARN_MIN=10        replica lag that triggers a sync
 *   LAG_CRIT_MIN=45        lag that is reported as critical (exit 2 → cron mail / alert)
 *   MAX_ATTEMPTS=3         sync attempts per run
 *   MAX_RUNTIME_SEC=600    hard cap for the whole watchdog run
 *   WATCHDOG_TABLES=payments,onboarding_orders    tables used to judge freshness
 */
process.env.TZ = 'UTC';                      // MUST match the app (see ecosystem.prod.config.js)

const fs = require('fs');
const http = require('http');
const { Client } = require('pg');

const LOCK = '/tmp/salam-sync-watchdog.lock';
const LOG = process.env.WATCHDOG_LOG || '/apps/console/logs/sync-watchdog.log';
const PORT = process.env.PORT || 4600;
const ADMIN = process.env.CONSOLE_ADMIN_USER || 'y.yahmed.sns@salam.sa';
const LAG_WARN = Number(process.env.LAG_WARN_MIN || 10);
const LAG_CRIT = Number(process.env.LAG_CRIT_MIN || 45);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 3);
const MAX_RUNTIME = Number(process.env.MAX_RUNTIME_SEC || 600) * 1000;
const TABLES = (process.env.WATCHDOG_TABLES || 'payments,onboarding_orders').split(',').map(s => s.trim());
const STMT_TIMEOUT = 15000;

const started = Date.now();
const outOfTime = () => Date.now() - started > MAX_RUNTIME;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(line) {
  const s = `${new Date().toISOString()} ${line}`;
  console.log(s);
  try { fs.appendFileSync(LOG, s + '\n'); } catch (e) {}
}

/* ---- single instance: a stale lock (crashed run) is reclaimed after 30 min ---- */
function acquireLock() {
  try {
    const fd = fs.openSync(LOCK, 'wx');
    fs.writeSync(fd, String(process.pid)); fs.closeSync(fd);
    return true;
  } catch (e) {
    try {
      const age = Date.now() - fs.statSync(LOCK).mtimeMs;
      if (age > 30 * 60000) { log(`WARN reclaiming stale lock (${Math.round(age / 60000)}m old)`); fs.unlinkSync(LOCK); return acquireLock(); }
    } catch (_) {}
    return false;
  }
}
const releaseLock = () => { try { fs.unlinkSync(LOCK); } catch (e) {} };

async function connect(url) {
  const c = new Client({ connectionString: url, statement_timeout: STMT_TIMEOUT, options: '-c timezone=UTC',
    application_name: 'salam-sync-watchdog' });
  await c.connect();
  return c;
}
const maxCreated = async (c, tbl) => {
  const r = await c.query(`SELECT max(created_at) AS m FROM ${tbl}`);
  return r.rows[0].m ? new Date(r.rows[0].m) : null;
};

/* ---- freshness: how far the REPLICA trails PROD (per table) ---- */
async function measure() {
  const prod = await connect(process.env.PROD_DATABASE_URL);
  const repl = await connect(process.env.SOURCE_DATABASE_URL);
  const rows = [];
  try {
    for (const t of TABLES) {
      const [p, r] = [await maxCreated(prod, t), await maxCreated(repl, t)];
      rows.push({ table: t, prod: p, replica: r,
        lagMin: (p && r) ? Math.round((p - r) / 60000) : null,
        prodAgeMin: p ? Math.round((Date.now() - p) / 60000) : null });
    }
  } finally { await prod.end().catch(() => {}); await repl.end().catch(() => {}); }
  return rows;
}

const post = (path, body) => new Promise(resolve => {
  const data = JSON.stringify(body || {});
  const req = http.request({ host: '127.0.0.1', port: PORT, path, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
      'X-Console-User': ADMIN } },
    res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ code: res.statusCode, body: b })); });
  req.on('error', e => resolve({ code: 0, body: e.message }));
  req.setTimeout(120000, () => { req.destroy(); resolve({ code: -1, body: 'timeout' }); });
  req.write(data); req.end();
});

/* ---- record the watchdog's own state so the console can alert on IT failing ---- */
async function record(status, detail) {
  try {
    const c = await connect(process.env.CONSOLE_DATABASE_URL);
    await c.query(`INSERT INTO console_settings (key, value) VALUES ('sync_watchdog', $1)
                   ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify({ at: new Date().toISOString(), status, ...detail })]);
    await c.end();
  } catch (e) { log(`WARN could not record status: ${e.message}`); }
}

(async () => {
  if (!process.env.PROD_DATABASE_URL || !process.env.SOURCE_DATABASE_URL) {
    log('FATAL missing PROD_DATABASE_URL / SOURCE_DATABASE_URL'); process.exit(3);
  }
  if (!acquireLock()) { log('SKIP another watchdog run is in progress'); process.exit(0); }

  let exitCode = 0;
  try {
    let m = await measure();
    const worst = () => m.reduce((a, x) => (x.lagMin != null && (a == null || x.lagMin > a) ? x.lagMin : a), null);
    log('lag ' + m.map(x => `${x.table}=${x.lagMin == null ? '?' : x.lagMin + 'm'}`).join(' '));

    if (worst() != null && worst() < LAG_WARN) {
      log(`OK replica within ${LAG_WARN}m (worst ${worst()}m) — no sync needed`);
      await record('ok', { worstLagMin: worst(), tables: m.map(x => ({ t: x.table, lagMin: x.lagMin })) });
      return;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !outOfTime(); attempt++) {
      const before = worst();
      log(`SYNC attempt ${attempt}/${MAX_ATTEMPTS} (worst lag ${before}m)`);
      const r = await post('/api/prod-sync/run', {});
      if (r.code !== 200) log(`WARN sync trigger returned ${r.code}: ${r.body.slice(0, 160)}`);

      // give it time to work, then re-measure (the endpoint returns immediately)
      for (let waited = 0; waited < 120 && !outOfTime(); waited += 10) {
        await sleep(10000);
        m = await measure();
        if (worst() != null && worst() < LAG_WARN) break;
      }
      log(`after attempt ${attempt}: worst lag ${worst()}m (was ${before}m)`);
      if (worst() != null && worst() < LAG_WARN) break;

      // self-heal: a watermark wedged far behind won't recover by re-running the same delta —
      // force an explicit window pull for the stale span, which ignores the saved cursor.
      if (attempt < MAX_ATTEMPTS && worst() != null && worst() > 60) {
        const stale = m.filter(x => x.lagMin != null && x.lagMin >= LAG_WARN);
        const from = new Date(Math.min(...stale.map(x => (x.replica ? x.replica.getTime() : Date.now() - 6 * 3600e3))) - 5 * 60000).toISOString();
        const to = new Date().toISOString();
        log(`SELF-HEAL windowed re-pull ${from} → ${to} for ${stale.map(s => s.table).join(',')}`);
        await post('/api/prod-sync/run', { from, to, tables: stale.map(s => s.table) });
        await sleep(20000);
        m = await measure();
      }
      if (attempt < MAX_ATTEMPTS) await sleep(Math.min(60000, 5000 * 2 ** attempt));   // backoff
    }

    const w = worst();
    if (w != null && w < LAG_WARN) { log(`RECOVERED worst lag ${w}m`); await record('recovered', { worstLagMin: w }); }
    else if (w != null && w >= LAG_CRIT) {
      log(`CRITICAL replica still ${w}m behind after ${MAX_ATTEMPTS} attempts`);
      await record('critical', { worstLagMin: w, tables: m.map(x => ({ t: x.table, lagMin: x.lagMin, prodAgeMin: x.prodAgeMin })) });
      exitCode = 2;
    } else {
      log(`DEGRADED replica ${w}m behind (below critical ${LAG_CRIT}m)`);
      await record('degraded', { worstLagMin: w });
      exitCode = 1;
    }
    // context that saves a debugging round-trip: is PROD itself stale?
    const prodStale = m.filter(x => x.prodAgeMin != null && x.prodAgeMin > 30);
    if (prodStale.length) log(`NOTE prod source itself is behind: ` + prodStale.map(x => `${x.table}=${x.prodAgeMin}m`).join(' '));
  } catch (e) {
    log(`ERROR ${e.message}`);
    await record('error', { error: e.message });
    exitCode = 3;
  } finally {
    releaseLock();
    process.exit(exitCode);
  }
})();
