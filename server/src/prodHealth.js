/* prodHealth.js — prod-safety healthcheck (port of salam-dealer-ops healthcheck.ts, in-process).
 *
 * The console shares a box and Postgres servers with production. This job watches ONLY the resources where
 * the console could hurt prod, and mails the addresses in HEALTHCHECK_EMAILS:
 *   · CRIT  → on change, then a re-notify with backoff: HC_CRIT_THROTTLE_MIN (30) doubling up to HC_CRIT_MAX_MIN (360)
 *   · WARN  → on change, then HC_WARN_THROTTLE_MIN (120) doubling up to HC_WARN_MAX_MIN (720)
 *   · OK    → once, as the recovery notice                              · HEALTHCHECK_ALWAYS=1 → every run (the old cron's --always)
 *   A "change" is the overall level OR the set of probes that are not OK. Percent / count probes carry a hysteresis
 *   band (HC_HYST_PCT, default 2 points) on the way DOWN, so a box sitting at 95–97 % does not flip WARN/CRIT every run.
 *   (26 Sep 2026: a whole day of "Box memory 95 / 97 / 98 %" mails — every 30 min while CRIT, plus every flip.)
 *   Memory is measured as Linux sees it — MemTotal − MemAvailable from /proc/meminfo — so the page cache is not "used";
 *   when memory is not OK the mail names the largest processes (ps, read-only) so the reader knows WHAT is holding it.
 * STRICTLY READ-ONLY: pg_stat_activity + a few OS reads, each probe on its own max:1 pool (so the probe's
 * footprint is exactly one connection and is excluded). Never throws — a healthcheck that crashes is worse than none.
 *
 * Env: HEALTHCHECK_EMAILS=a@x,b@y (required to mail) · HEALTHCHECK_INTERVAL_MIN (default 5, 0 = off)
 *      HC_*_WARN / HC_*_CRIT thresholds as in the donor (OPS_CONN, PG_USED, SRC_CONN, LOAD, MEM, DISK, FRESH_S), HC_WARN_THROTTLE_MIN (120)
 * CLI: node src/cli.js healthcheck [--always] [--print] */
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Pool } = require('pg');

const num = (k, d) => { const v = Number((process.env[k] || '').trim()); return Number.isFinite(v) && v > 0 ? v : d; };
/* The console's own connection BUDGET on a server: every pool it can open there (db.js maxes) + the prod-sync writer
 * + this probe. pg_stat_activity is counted per ROLE, and every unified pool uses the same role on 121, so the
 * "console connections" number is the whole footprint — a threshold below the budget (the donor's 12) can only flap.
 * Defaults: warn = budget + 2 (something outside the console holds the role), crit = budget + 8. Env overrides stay. */
const E = k => !!(process.env[k] || '').trim();
const POOL_BUDGET = 4 /* console */ + (Number(process.env.SOURCE_POOL_MAX) || 8)
  + (E('OPS_DATABASE_URL') ? (Number(process.env.OPS_POOL_MAX) || 3) : 0) + (E('OPS_BETA_DATABASE_URL') ? (Number(process.env.OPS_BETA_POOL_MAX) || 2) : 0)
  + (E('NEXUS_DATABASE_URL') ? 2 : 0) + (E('PAYMENTS_DATABASE_URL') ? 2 : 0) + (E('UPG_DATABASE_URL') ? 2 : 0) + 2 /* prod-sync writer + probe */;
const T = {
  connWarn: num('HC_OPS_CONN_WARN', POOL_BUDGET + 2), connCrit: num('HC_OPS_CONN_CRIT', POOL_BUDGET + 8),
  usedWarn: num('HC_PG_USED_WARN', 80), usedCrit: num('HC_PG_USED_CRIT', 92),
  srcWarn: num('HC_SRC_CONN_WARN', 6), srcCrit: num('HC_SRC_CONN_CRIT', 10),
  loadWarn: num('HC_LOAD_WARN', 8), loadCrit: num('HC_LOAD_CRIT', 14),
  memWarn: num('HC_MEM_WARN', 90), memCrit: num('HC_MEM_CRIT', 96),
  diskWarn: num('HC_DISK_WARN', 85), diskCrit: num('HC_DISK_CRIT', 93),
  freshWarn: num('HC_FRESH_WARN_S', 20 * 60), freshCrit: num('HC_FRESH_CRIT_S', 60 * 60),
  hystPct: num('HC_HYST_PCT', 2),           // points below a threshold a % probe must fall before its level drops
};
const gb = b => (Number(b) / 1073741824).toFixed(1) + ' GB';
const RANK = { OK: 0, WARN: 1, CRIT: 2 };
const worst = (a, b) => RANK[a] >= RANK[b] ? a : b;
const lvl = (v, w, c) => v >= c ? 'CRIT' : v >= w ? 'WARN' : 'OK';
const icon = l => l === 'CRIT' ? '🔴' : l === 'WARN' ? '🟠' : '✅';
const hostOf = cs => { try { return new URL(cs).host; } catch (_) { return '?'; } };

async function probe(cs, fn) {
  const pool = new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 8000, statement_timeout: 8000 });
  try { return await fn(pool); } finally { await pool.end().catch(() => {}); }
}

/* console role footprint + shared-server saturation on ONE Postgres server */
async function dbChecks(checks, label, cs, { shared, srcOnly, local } = {}) {
  if (!cs) return;
  try {
    await probe(cs, async pool => {
      const mine = Number((await pool.query(`SELECT count(*) AS n FROM pg_stat_activity WHERE usename = current_user AND pid <> pg_backend_pid()`)).rows[0].n);
      /* LOCAL replica (the selfcare copy prod-sync maintains on the console's own server): the connections are our
       * pool (SOURCE_POOL_MAX, default 8) + the prod-sync writer + this probe — sized to the pool, never a prod risk.
       * Thresholds for a REMOTE source (a real prod replica) stay at the donor's 6 / 10. */
      const poolMax = Number(process.env.SOURCE_POOL_MAX) || 8;
      // local replica = same server + same role as the console DB → the count IS the console's whole footprint: judge it against the budget
      const w = local ? T.connWarn : srcOnly ? T.srcWarn : T.connWarn, c = local ? T.connCrit : srcOnly ? T.srcCrit : T.connCrit;
      const ml = lvl(mine, w, c);
      checks.push({ name: `${label} — console connections`, level: ml, prodImpact: ml === 'CRIT' && !local, value: mine, warn: w, crit: c, hyst: 1, short: `${label} ${mine} conn`,
        detail: `${mine} connections held by the console role on ${hostOf(cs)} (warn ≥${w}, crit ≥${c}; the console's own pool budget here is ${POOL_BUDGET}).${local ? ` Our own replica on the console server — source pool max ${poolMax} (SOURCE_POOL_MAX) + prod-sync writer + probes; not a production system.` : srcOnly ? ' The watcher + unmask pools should stay small.' : ' The console_app role — the count covers every app using it on this server.'}` });
      if (shared) {
        const r = (await pool.query(`SELECT (SELECT count(*) FROM pg_stat_activity) AS used, current_setting('max_connections') AS max`)).rows[0];
        const u = Number(r.used), m = Number(r.max) || 100, pct = Math.round(u / m * 100);
        const l = lvl(pct, T.usedWarn, T.usedCrit);
        /* WHO is holding the slots (10 Sep 2026): console_app has pg_read_all_stats on 121, so the probe can name the
         * consumers — otherwise a CRIT only says "94/100" and everyone assumes it is the console. Top 8 by
         * (user · app · client), with idle share and the oldest idle age, so the recipient can act on it. */
        let who = '';
        try {
          const top = (await pool.query(`SELECT usename, coalesce(nullif(application_name,''),'-') AS app, coalesce(client_addr::text,'local') AS addr,
                count(*)::int AS n, count(*) FILTER (WHERE state='idle')::int AS idle, count(*) FILTER (WHERE state='idle in transaction')::int AS idle_tx,
                to_char(max(now()-state_change) FILTER (WHERE state='idle'), 'HH24:MI') AS oldest_idle
              FROM pg_stat_activity WHERE backend_type='client backend' AND pid <> pg_backend_pid() GROUP BY 1,2,3 ORDER BY n DESC LIMIT 8`)).rows;
          const pgadmin = (await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name LIKE 'pgAdmin%'`)).rows[0].n;
          if (top.length) who = ` Top holders: ` + top.map(t => `${t.usename}@${t.addr} ${t.app.replace(/^pgAdmin 4 - .*/, 'pgAdmin')} ×${t.n}${t.idle ? ` (${t.idle} idle${t.oldest_idle ? ', oldest ' + t.oldest_idle : ''})` : ''}${t.idle_tx ? ` ⚠${t.idle_tx} idle-in-tx` : ''}`).join(' · ') + `. pgAdmin sessions in total: ${pgadmin}. Console role: ${mine}.`;
        } catch (_) { who = ' (session breakdown unavailable — grant pg_read_all_stats to the console role to see who holds the slots)'; }
        checks.push({ name: `${label} — shared server saturation`, level: l, prodImpact: l === 'CRIT', value: pct, warn: T.usedWarn, crit: T.usedCrit, hyst: T.hystPct, short: `${label} ${u}/${m}`,
          detail: `${u}/${m} connections used (${pct}%) on the SHARED server ${hostOf(cs)} (${shared}). warn ≥${T.usedWarn}%, crit ≥${T.usedCrit}%.${who}` });
      }
    });
  } catch (e) {
    /* 20 Sep 2026 — the alert got QUIETER as the incident got worse. 20:04 said CRIT, 94/100 used on
     * 172.31.15.121; 20:09 said "WARN · probe failed" while the server was actually FULL. The
     * saturation check needs a connection to measure saturation, so at 100 % it cannot run, and every
     * connect failure fell into this one generic WARN with prodImpact:false.
     *
     * A probe refused for lack of a slot is not a degraded probe. It IS the saturation reading, at its
     * maximum: every app on that server is being turned away. SQLSTATE 53300 (too_many_connections)
     * covers both wordings PostgreSQL uses — "sorry, too many clients already" and "remaining
     * connection slots are reserved for non-replication superuser connections" (the latter is what a
     * non-superuser sees once only the reserved slots remain). The message test is a belt-and-braces
     * fallback for drivers or poolers that drop the code. */
    const full = !!(e && (e.code === '53300' ||
      /too many clients|remaining connection slots are reserved/i.test(String(e.message || ''))));
    checks.push({ name: `${label} — probe`, level: full ? 'CRIT' : 'WARN', prodImpact: full,
      detail: full
        ? `OUT OF CONNECTIONS on ${hostOf(cs)} — the probe could not get a slot. Treat this as the saturation check at 100 %, not a flaky probe: every application on this server is being refused right now. Free slots as superuser (the reserved slots exist for exactly this), then find the holder. Driver said: ${e.message}`
        : `probe failed: ${e.message}` });
  }
}

/* Memory as Linux sees it. MemAvailable = what a new allocation can get without swapping (free + reclaimable page
 * cache); MemFree alone counts the cache as used and reads 95–98 % on any box that has been up for a while. Node's
 * os.freemem() depends on the libuv build for which of the two it returns, so /proc/meminfo is read directly. */
function memInfo() {
  try {
    const m = {};
    for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) { const r = /^(\w+):\s+(\d+)/.exec(line); if (r) m[r[1]] = Number(r[2]) * 1024; }
    if (m.MemTotal && m.MemAvailable != null)
      return { total: m.MemTotal, avail: m.MemAvailable, free: m.MemFree || 0, cached: (m.Cached || 0) + (m.SReclaimable || 0),
        swapTotal: m.SwapTotal || 0, swapUsed: Math.max(0, (m.SwapTotal || 0) - (m.SwapFree || 0)), src: 'MemAvailable' };
  } catch (_) {}
  const t = os.totalmem(), f = os.freemem();
  return { total: t, avail: f, free: f, cached: 0, swapTotal: 0, swapUsed: 0, src: 'os.freemem' };
}
/* The largest resident processes (read-only `ps`), labelled by the app directory and script so "node" becomes
 * "node unified/agentLog.js" — the reader should know WHAT holds the memory, not just how much is left. */
function topRss(n = 5) {
  try {
    const out = execSync('ps -eo rss=,pid=,comm=,args= --sort=-rss', { encoding: 'utf8', timeout: 4000 });
    return out.split('\n').map(l => l.trim()).filter(Boolean).slice(0, n).map(l => {
      const [rss, pid, comm, ...rest] = l.split(/\s+/); const args = rest.join(' ');
      const app = (/\/apps\/([^/\s]+)/.exec(args) || [])[1];
      const script = (/\/([\w.-]+\.(?:js|cjs|mjs|py))(?:\s|$)/.exec(args) || [])[1];
      const label = /^(node|PM2|python3?)$/i.test(comm) ? `${comm} ${app ? app + (script ? '/' + script : '') : (script || '')}`.trim() : comm;
      return { rss: Number(rss) * 1024, pid: Number(pid), label };
    });
  } catch (_) { return []; }
}

function boxChecks(checks) {
  try { const load1 = os.loadavg()[0] || 0, cores = os.cpus().length || 1; const l = lvl(load1, T.loadWarn, T.loadCrit);
    checks.push({ name: 'Box — CPU load', level: l, prodImpact: false, value: load1, warn: T.loadWarn, crit: T.loadCrit, hyst: 1, short: `CPU load ${load1.toFixed(1)}`,
      detail: `1-min load ${load1.toFixed(2)} across ${cores} cores (warn ≥${T.loadWarn}, crit ≥${T.loadCrit}).` }); } catch (_) {}
  try {
    const mi = memInfo(); const pct = mi.total ? Math.round((mi.total - mi.avail) / mi.total * 100) : 0; const l = lvl(pct, T.memWarn, T.memCrit);
    const top = l !== 'OK' ? topRss(5) : [];
    checks.push({ name: 'Box — memory', level: l, prodImpact: false, value: pct, warn: T.memWarn, crit: T.memCrit, hyst: T.hystPct, short: `Box memory ${pct}%`,
      brief: `${pct}% used, ${gb(mi.avail)} of ${gb(mi.total)} available${top.length ? ` — largest: ${top.slice(0, 3).map(p => `${p.label} ${gb(p.rss)}`).join(', ')}` : ''}`,
      detail: `${pct}% used — ${gb(mi.avail)} available of ${gb(mi.total)} (warn ≥${T.memWarn}%, crit ≥${T.memCrit}%; ${mi.src === 'MemAvailable' ? 'MemTotal − MemAvailable, the page cache is not counted' : 'os.freemem fallback'})`
        + `${mi.swapTotal ? ` · swap ${gb(mi.swapUsed)} of ${gb(mi.swapTotal)} in use` : ' · no swap'}.`
        + (top.length ? ` Largest processes: ${top.map(p => `${p.label} ${gb(p.rss)}`).join(' · ')}.` : '')
        + (l === 'CRIT' ? ' Below 4 % available the kernel starts swapping or killing (OOM) — the biggest process goes first, whichever app it belongs to.' : '') });
  } catch (_) {}
  try { const out = execSync('df -P / | tail -1', { encoding: 'utf8', timeout: 4000 }); const pct = Number((out.trim().split(/\s+/)[4] || '0').replace('%', '')); const l = lvl(pct, T.diskWarn, T.diskCrit);
    checks.push({ name: 'Box — disk /', level: l, prodImpact: l === 'CRIT', value: pct, warn: T.diskWarn, crit: T.diskCrit, hyst: T.hystPct, short: `disk / ${pct}%`,
      detail: `${pct}% used (warn ≥${T.diskWarn}%, crit ≥${T.diskCrit}%). A full disk takes DOWN every app on the box.` }); } catch (_) {}
}

async function ingestChecks(checks) {
  const db = require('./db');
  if (db.ops) {
    try { const lag = (await db.ops.query(`SELECT EXTRACT(EPOCH FROM (now() - max(started_at)))::float AS lag FROM order_attempts`)).rows[0].lag;
      if (lag == null) checks.push({ name: 'Fixed ingest — freshness', level: 'OK', prodImpact: false, detail: 'no orders yet.' });
      else { const s = Math.round(lag), l = lvl(s, T.freshWarn, T.freshCrit);
        checks.push({ name: 'Fixed ingest — freshness', level: l, prodImpact: false, value: s, warn: T.freshWarn, crit: T.freshCrit, hyst: 120, short: `Fixed ingest ${Math.round(s / 60)} min`, detail: `newest order ${Math.round(s / 60)} min old in sda_ops (warn ≥${Math.round(T.freshWarn / 60)}m, crit ≥${Math.round(T.freshCrit / 60)}m). Quiet hours can be legitimately stale.` }); }
    } catch (e) { checks.push({ name: 'Fixed ingest — freshness', level: 'WARN', prodImpact: false, detail: `probe failed: ${e.message}` }); }
  }
  try { const r = (await db.console.query(`SELECT EXTRACT(EPOCH FROM (now() - max(started_at)))::float AS lag FROM sync_runs`)).rows[0];
    if (r && r.lag != null) { const m = Math.round(r.lag / 60);
      checks.push({ name: 'Mobile sync — last tick', level: 'OK', prodImpact: false, detail: `${m} min since the last metrics sync (informational — the prod-sync / sync scheduler cadence, not a prod risk).` }); }
  } catch (_) {}
}

async function run({ always = false, printOnly = false } = {}) {
  const checks = [];
  await dbChecks(checks, 'Console DB', process.env.CONSOLE_DATABASE_URL, { shared: 'unified_console · mvno_console · sda_ops live here' });
  if (process.env.OPS_DATABASE_URL && hostOf(process.env.OPS_DATABASE_URL) !== hostOf(process.env.CONSOLE_DATABASE_URL || ''))
    await dbChecks(checks, 'Ops DB', process.env.OPS_DATABASE_URL, { shared: 'SDA / EPurchase / PaymentsV2 live here too' });
  const consoleHost = hostOf(process.env.CONSOLE_DATABASE_URL || '');
  const srcLocal = hostOf(process.env.SOURCE_DATABASE_URL || '') === consoleHost;
  await dbChecks(checks, srcLocal ? 'Local replica (selfcare copy)' : 'Source DB (selfcare replica)', process.env.SOURCE_DATABASE_URL, { srcOnly: true, local: srcLocal });
  if (process.env.NEXUS_DATABASE_URL) { const nxLocal = hostOf(process.env.NEXUS_DATABASE_URL) === consoleHost;
    await dbChecks(checks, nxLocal ? 'Local Nexus copy' : 'Nexus DB', process.env.NEXUS_DATABASE_URL, { srcOnly: true, local: nxLocal }); }
  boxChecks(checks);
  await ingestChecks(checks);

  /* Hysteresis on the way DOWN (26 Sep 2026): a % / count probe keeps its previous level while the value is still
   * within `hyst` of the threshold it crossed, so 95 → 97 → 95 → 98 % is ONE episode, not four edges and four mails.
   * Rising is always immediate. Only the levels the last run STORED count as previous (not the raw ones). */
  const stateFile = path.join(os.tmpdir(), 'unified-healthcheck-state.json');
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) {}
  const prevProbes = (prev && prev.probes) || {};
  if (!printOnly) for (const c of checks) {
    const pl = prevProbes[c.name];
    if (c.value == null || !pl || RANK[c.level] >= RANK[pl]) continue;
    const h = c.hyst || 0, raw = c.level;
    if (pl === 'CRIT' && c.value >= c.crit - h) c.level = 'CRIT';
    else if (c.value >= c.warn - h) c.level = 'WARN';
    if (c.level !== raw) { c.damped = true; c.detail += ` Still ${c.level}: within ${h} of the threshold it crossed — clears below ${c.level === 'CRIT' ? c.crit - h : c.warn - h}.`; }
  }

  const overall = checks.reduce((a, c) => worst(a, c.level), 'OK');
  const prodRisk = checks.some(c => c.level === 'CRIT' && c.prodImpact);
  const bad = checks.filter(c => c.level !== 'OK').sort((a, b) => RANK[b.level] - RANK[a.level]);
  const signature = bad.map(c => `${c.name}=${c.level}`).join('|');
  const nowMs = Date.now();
  const since = (!printOnly && prev.level === overall && prev.since) ? prev.since : nowMs;   // start of the current episode
  const fmtDur = ms => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`; };
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false });
  const headline = bad.length ? bad.map(c => c.short || c.name).slice(0, 2).join(' · ') : 'all probes OK';
  const body = `Salam Operations Console — prod-safety healthcheck\nAt: ${now} KSA\nOverall: ${overall}${prodRisk ? '  ⚠ POSSIBLE PROD IMPACT' : ''}${overall !== 'OK' ? ` — ${headline} — ${overall} for ${fmtDur(nowMs - since)}` : ''}\n\n`
    + checks.map(c => `${icon(c.level)} ${c.name}\n    ${c.detail}`).join('\n\n')
    + `\n\nHost: ${os.hostname()} · app salam-unified. Read-only probes; the console never writes to prod tables.`;
  const out = { overall, prodRisk, checks, body, at: now, since, headline, mailed: false, recipients: [] };
  if (printOnly) return out;

  /* Mail policy: an EDGE (overall level changed, or the set of probes that are not OK changed) always mails; a
   * persisting WARN / CRIT re-notifies with backoff — the throttle doubles at every reminder up to a cap — and
   * the subject carries how long it has been going on. OK mails once, as the recovery notice. */
  const changed = prev.level !== overall || (overall !== 'OK' && (prev.signature || '') !== signature);
  const n = changed ? 0 : Number(prev.reminders || 0);                         // reminders already sent in this episode
  const base = overall === 'CRIT' ? num('HC_CRIT_THROTTLE_MIN', 30) : num('HC_WARN_THROTTLE_MIN', 120);
  const cap = overall === 'CRIT' ? num('HC_CRIT_MAX_MIN', 360) : num('HC_WARN_MAX_MIN', 720);
  const waitMin = Math.min(cap, base * Math.pow(2, n));
  const dueAgain = !prev.lastEmailAt || nowMs - prev.lastEmailAt >= waitMin * 60000;
  let should = always || process.env.HEALTHCHECK_ALWAYS === '1';
  if (!should) should = changed ? (overall !== 'OK' || prev.level === 'WARN' || prev.level === 'CRIT') : (overall !== 'OK' && dueAgain);
  const to = String(process.env.HEALTHCHECK_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  out.recipients = to; out.reason = should ? (always ? 'forced' : changed ? `${overall} (change)` : `${overall} reminder ${n + 1}`) : `suppressed (${overall} for ${fmtDur(nowMs - since)}, next reminder in ${fmtDur(waitMin * 60000 - (nowMs - (prev.lastEmailAt || nowMs)))})`;
  const policy = { base, cap, n, waitMin, since, changed };
  if (should && to.length) {
    try {
      const notify = require('./notify');
      const subject = overall === 'OK'
        ? `[Salam Ops] Healthcheck OK — recovered — ${now} KSA`
        : `[Salam Ops] Healthcheck ${overall}${prodRisk ? ' — POSSIBLE PROD IMPACT' : ''} — ${headline}${changed ? '' : ` · ${fmtDur(nowMs - since)}`} — ${now} KSA`;
      const r = await notify.sendHtml(to.map(e => ({ email: e })), subject, buildHtml({ checks, overall, prodRisk, now, policy, headline, fmtDur }), [], body);
      out.mailed = !!r.sent; out.mailError = r.error || null;
    } catch (e) { out.mailError = e.message; }
  } else if (should && !to.length) out.mailError = 'HEALTHCHECK_EMAILS not set';
  const probes = {}; for (const c of checks) probes[c.name] = c.level;
  try { fs.writeFileSync(stateFile, JSON.stringify({ level: overall, signature, since, probes,
    lastEmailAt: out.mailed ? nowMs : (changed ? null : prev.lastEmailAt), reminders: out.mailed ? (changed ? 0 : n + 1) : n })); } catch (_) {}
  return out;
}

/* mail layout = the Sync Health mail's: status line, key/value block, one table row per probe */
function buildHtml({ checks, overall, prodRisk, now, policy, headline, fmtDur }) {
  const notify = require('./notify');
  const esc = notify.esc;
  const color = l => l === 'CRIT' ? '#dc2626' : l === 'WARN' ? '#d97706' : '#16a34a';
  const bg = l => l === 'CRIT' ? '#fdecec' : l === 'WARN' ? '#fdf6ec' : '';
  const th = 'padding:9px 12px;text-align:left;font-size:12px;color:#334155;background:#eef4f0;border-bottom:1px solid #dbe6df';
  const td = 'padding:10px 12px;font-size:13px;border-bottom:1px solid #eef2f6;vertical-align:top';
  const metric = (label, val) => `<tr><td style="padding:6px 0;color:#475569;font-size:13px">${label}</td><td style="padding:6px 0 6px 24px;font-weight:800;font-size:14px;color:#0f172a">${val}</td></tr>`;
  const bad = checks.filter(c => c.level !== 'OK');
  const summary = overall === 'OK'
    ? '<div style="color:#16a34a;font-weight:600;margin-bottom:18px">All probes OK — the console is not putting production at risk.</div>'
    : `<div style="color:${color(overall)};font-weight:700;margin-bottom:8px">${prodRisk ? '⚠ POSSIBLE PROD IMPACT — ' : ''}Attention needed:</div><ul style="color:${color(overall)};margin:0 0 18px 18px;padding:0">${bad.map(c => `<li style="margin:2px 0"><b>${esc(c.name)}</b> — ${esc(c.brief || c.detail.split(/\.\s/)[0])}.</li>`).join('')}</ul>`;
  const rows = checks.map(c => `<tr style="background:${bg(c.level)}">
      <td style="${td};white-space:nowrap;color:${color(c.level)};font-weight:800">${icon(c.level)} ${c.level}</td>
      <td style="${td};font-weight:700;color:#0f172a;white-space:nowrap">${esc(c.name)}</td>
      <td style="${td};color:#475569">${esc(c.detail)}${c.prodImpact && c.level === 'CRIT' ? ' <span style="color:#dc2626;font-weight:800">· can degrade prod</span>' : ''}</td></tr>`).join('');
  const bodyHtml = `${summary}
      <table style="border-collapse:collapse;margin-bottom:22px">
        ${metric('Overall', `<span style="color:${color(overall)}">${overall}${prodRisk ? ' · possible prod impact' : ''}</span>`)}
        ${metric('Checked at', esc(now) + ' KSA')}
        ${metric('Host · app', esc(os.hostname()) + ' · salam-unified')}
        ${metric('Probes', `${checks.length} · ${checks.filter(c => c.level === 'OK').length} ok · ${checks.filter(c => c.level === 'WARN').length} warn · ${checks.filter(c => c.level === 'CRIT').length} crit`)}
        ${overall !== 'OK' && policy ? metric(`${overall} since`, `${esc(new Date(policy.since).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false }))} KSA · ${esc(fmtDur(Date.now() - policy.since))}${policy.changed ? '' : ` · reminder ${policy.n + 1}`}`) : ''}
        ${overall !== 'OK' && policy ? metric('Next mail', `${policy.changed ? 'if the picture changes, or' : 'if the picture changes, or'} in ${esc(fmtDur(Math.min(policy.cap, policy.base * Math.pow(2, policy.changed ? 0 : policy.n + 1)) * 60000))} if it persists · the recovery notice when it clears`) : ''}
      </table>
      <div style="color:#0f5132;font-weight:800;font-size:15px;margin-bottom:8px">Probes — where the console could impact production</div>
      <table style="border-collapse:collapse;width:100%;border:1px solid #dbe6df">
        <tr><th style="${th}">Status</th><th style="${th}">Check</th><th style="${th}">Detail · thresholds</th></tr>
        ${rows}
      </table>
      <div style="color:#94a3b8;font-size:12px;margin-top:14px">Read-only probes (pg_stat_activity + OS reads), each on its own single connection which is excluded from the count. The console never writes to prod tables. Mail policy: a change of the picture always mails; a persisting CRIT is re-notified after ${num('HC_CRIT_THROTTLE_MIN', 30)} min, then the wait doubles up to ${Math.round(num('HC_CRIT_MAX_MIN', 360) / 60)} h (WARN: ${num('HC_WARN_THROTTLE_MIN', 120)} min up to ${Math.round(num('HC_WARN_MAX_MIN', 720) / 60)} h); a probe keeps its level until the value is ${num('HC_HYST_PCT', 2)} points below the threshold it crossed; OK once as the recovery notice. Memory = MemTotal − MemAvailable (the page cache is not counted).</div>
      <div style="color:#94a3b8;font-size:12px;margin-top:8px">— Salam Operations Console · prod-safety healthcheck</div>`;
  return notify.shell({ title: 'Prod-safety healthcheck — Operations Console', pill: overall + (prodRisk ? ' · PROD IMPACT' : ''), pillColor: color(overall), bodyHtml });
}

let timer = null;
function start() {
  const min = Number(process.env.HEALTHCHECK_INTERVAL_MIN ?? 5);
  if (!(min > 0)) { console.log('[HEALTHCHECK] disabled (HEALTHCHECK_INTERVAL_MIN=0)'); return { armed: false }; }
  const to = String(process.env.HEALTHCHECK_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  console.log(`[HEALTHCHECK] prod-safety probes every ${min} min → ${to.length ? to.length + ' recipient(s)' : 'NO recipients (set HEALTHCHECK_EMAILS)'}${process.env.HEALTHCHECK_ALWAYS === '1' ? ' · mail every run' : ' · mail on CRIT / change / recovery'}`);
  const tick = () => run().then(o => { if (o.overall !== 'OK' || o.mailed) console.log(`[HEALTHCHECK] ${o.overall}${o.prodRisk ? ' PROD-IMPACT' : ''} · ${o.mailed ? 'mailed ' + o.recipients.length : o.reason}${o.mailError ? ' · ' + o.mailError : ''}`); }).catch(e => console.error('[HEALTHCHECK]', e.message));
  timer = setInterval(tick, min * 60000); timer.unref?.();
  setTimeout(tick, 45000);
  return { armed: true, min };
}
module.exports = { run, start };
