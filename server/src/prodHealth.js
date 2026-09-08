/* prodHealth.js — prod-safety healthcheck (port of salam-dealer-ops healthcheck.ts, in-process).
 *
 * The console shares a box and Postgres servers with production. This job watches ONLY the resources where
 * the console could hurt prod, and mails the addresses in HEALTHCHECK_EMAILS:
 *   · CRIT  → every run (a console problem that can degrade prod)      · WARN → on change, then every HC_WARN_THROTTLE_MIN
 *   · OK    → once, as the recovery notice                              · HEALTHCHECK_ALWAYS=1 → every run (the old cron's --always)
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
const T = {
  connWarn: num('HC_OPS_CONN_WARN', 12), connCrit: num('HC_OPS_CONN_CRIT', 18),
  usedWarn: num('HC_PG_USED_WARN', 80), usedCrit: num('HC_PG_USED_CRIT', 92),
  srcWarn: num('HC_SRC_CONN_WARN', 6), srcCrit: num('HC_SRC_CONN_CRIT', 10),
  loadWarn: num('HC_LOAD_WARN', 8), loadCrit: num('HC_LOAD_CRIT', 14),
  memWarn: num('HC_MEM_WARN', 90), memCrit: num('HC_MEM_CRIT', 96),
  diskWarn: num('HC_DISK_WARN', 85), diskCrit: num('HC_DISK_CRIT', 93),
  freshWarn: num('HC_FRESH_WARN_S', 20 * 60), freshCrit: num('HC_FRESH_CRIT_S', 60 * 60),
};
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
      const w = local ? poolMax + 4 : srcOnly ? T.srcWarn : T.connWarn, c = local ? poolMax + 10 : srcOnly ? T.srcCrit : T.connCrit;
      const ml = lvl(mine, w, c);
      checks.push({ name: `${label} — console connections`, level: ml, prodImpact: ml === 'CRIT' && !local,
        detail: `${mine} connections held by the console role on ${hostOf(cs)} (warn ≥${w}, crit ≥${c}).${local ? ` Our own replica on the console server — pool max ${poolMax} (SOURCE_POOL_MAX) + prod-sync writer + probes; not a production system.` : srcOnly ? ' The watcher + unmask pools should stay small.' : ' The console_app role — the count covers every app using it on this server.'}` });
      if (shared) {
        const r = (await pool.query(`SELECT (SELECT count(*) FROM pg_stat_activity) AS used, current_setting('max_connections') AS max`)).rows[0];
        const u = Number(r.used), m = Number(r.max) || 100, pct = Math.round(u / m * 100);
        const l = lvl(pct, T.usedWarn, T.usedCrit);
        checks.push({ name: `${label} — shared server saturation`, level: l, prodImpact: l === 'CRIT',
          detail: `${u}/${m} connections used (${pct}%) on the SHARED server ${hostOf(cs)} (${shared}). warn ≥${T.usedWarn}%, crit ≥${T.usedCrit}%.` });
      }
    });
  } catch (e) { checks.push({ name: `${label} — probe`, level: 'WARN', prodImpact: false, detail: `probe failed: ${e.message}` }); }
}

function boxChecks(checks) {
  try { const load1 = os.loadavg()[0] || 0, cores = os.cpus().length || 1; const l = lvl(load1, T.loadWarn, T.loadCrit);
    checks.push({ name: 'Box — CPU load', level: l, prodImpact: false, detail: `1-min load ${load1.toFixed(2)} across ${cores} cores (warn ≥${T.loadWarn}, crit ≥${T.loadCrit}).` }); } catch (_) {}
  try { const t = os.totalmem(), f = os.freemem(); const pct = t ? Math.round((t - f) / t * 100) : 0; const l = lvl(pct, T.memWarn, T.memCrit);
    checks.push({ name: 'Box — memory', level: l, prodImpact: false, detail: `${pct}% used (warn ≥${T.memWarn}%, crit ≥${T.memCrit}%).` }); } catch (_) {}
  try { const out = execSync('df -P / | tail -1', { encoding: 'utf8', timeout: 4000 }); const pct = Number((out.trim().split(/\s+/)[4] || '0').replace('%', '')); const l = lvl(pct, T.diskWarn, T.diskCrit);
    checks.push({ name: 'Box — disk /', level: l, prodImpact: l === 'CRIT', detail: `${pct}% used (warn ≥${T.diskWarn}%, crit ≥${T.diskCrit}%). A full disk takes DOWN every app on the box.` }); } catch (_) {}
}

async function ingestChecks(checks) {
  const db = require('./db');
  if (db.ops) {
    try { const lag = (await db.ops.query(`SELECT EXTRACT(EPOCH FROM (now() - max(started_at)))::float AS lag FROM order_attempts`)).rows[0].lag;
      if (lag == null) checks.push({ name: 'Fixed ingest — freshness', level: 'OK', prodImpact: false, detail: 'no orders yet.' });
      else { const s = Math.round(lag), l = lvl(s, T.freshWarn, T.freshCrit);
        checks.push({ name: 'Fixed ingest — freshness', level: l, prodImpact: false, detail: `newest order ${Math.round(s / 60)} min old in sda_ops (warn ≥${Math.round(T.freshWarn / 60)}m, crit ≥${Math.round(T.freshCrit / 60)}m). Quiet hours can be legitimately stale.` }); }
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

  const overall = checks.reduce((a, c) => worst(a, c.level), 'OK');
  const prodRisk = checks.some(c => c.level === 'CRIT' && c.prodImpact);
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false });
  const body = `Salam Operations Console — prod-safety healthcheck\nAt: ${now} KSA\nOverall: ${overall}${prodRisk ? '  ⚠ POSSIBLE PROD IMPACT' : ''}\n\n`
    + checks.map(c => `${icon(c.level)} ${c.name}\n    ${c.detail}`).join('\n\n')
    + `\n\nHost: ${os.hostname()} · app salam-unified. Read-only probes; the console never writes to prod tables.`;
  const out = { overall, prodRisk, checks, body, at: now, mailed: false, recipients: [] };
  if (printOnly) return out;

  const stateFile = path.join(os.tmpdir(), 'unified-healthcheck-state.json');
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) {}
  const throttleMs = num('HC_WARN_THROTTLE_MIN', 120) * 60000;
  const changed = prev.level !== overall;
  const throttleOk = !prev.lastEmailAt || Date.now() - prev.lastEmailAt > throttleMs;
  let should = always || process.env.HEALTHCHECK_ALWAYS === '1';
  if (!should) should = overall === 'CRIT' || (overall === 'WARN' && (changed || throttleOk)) || (overall === 'OK' && (prev.level === 'WARN' || prev.level === 'CRIT'));
  const to = String(process.env.HEALTHCHECK_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  out.recipients = to; out.reason = should ? (always ? 'forced' : overall) : 'suppressed (no state change, within throttle window)';
  if (should && to.length) {
    try {
      const notify = require('./notify');
      const subject = `[Salam Ops] Healthcheck ${overall}${prodRisk ? ' — POSSIBLE PROD IMPACT' : ''} — ${now} KSA`;
      const r = await notify.sendHtml(to.map(e => ({ email: e })), subject, buildHtml({ checks, overall, prodRisk, now }), [], body);
      out.mailed = !!r.sent; out.mailError = r.error || null;
    } catch (e) { out.mailError = e.message; }
  } else if (should && !to.length) out.mailError = 'HEALTHCHECK_EMAILS not set';
  try { fs.writeFileSync(stateFile, JSON.stringify({ level: overall, lastEmailAt: out.mailed ? Date.now() : prev.lastEmailAt })); } catch (_) {}
  return out;
}

/* mail layout = the Sync Health mail's: status line, key/value block, one table row per probe */
function buildHtml({ checks, overall, prodRisk, now }) {
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
    : `<div style="color:${color(overall)};font-weight:700;margin-bottom:8px">${prodRisk ? '⚠ POSSIBLE PROD IMPACT — ' : ''}Attention needed:</div><ul style="color:${color(overall)};margin:0 0 18px 18px;padding:0">${bad.map(c => `<li style="margin:2px 0"><b>${esc(c.name)}</b> — ${esc(c.detail.split('.')[0])}.</li>`).join('')}</ul>`;
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
      </table>
      <div style="color:#0f5132;font-weight:800;font-size:15px;margin-bottom:8px">Probes — where the console could impact production</div>
      <table style="border-collapse:collapse;width:100%;border:1px solid #dbe6df">
        <tr><th style="${th}">Status</th><th style="${th}">Check</th><th style="${th}">Detail · thresholds</th></tr>
        ${rows}
      </table>
      <div style="color:#94a3b8;font-size:12px;margin-top:14px">Read-only probes (pg_stat_activity + OS reads), each on its own single connection which is excluded from the count. The console never writes to prod tables. Mail policy: CRIT every run · WARN on change, then every ${num('HC_WARN_THROTTLE_MIN', 120)} min · OK once as the recovery notice.</div>
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
