/* apiLatencyBaseline.js — per-API latency thresholds DERIVED FROM HISTORY (Monitoring › Gateway › Latency alerting).
 *
 * Before the migration the per-API p95 thresholds were set from each API's own recent p95; after it only the global
 * threshold survived, so every API is judged against one number (9 000 ms today) and a slow "list-invoices" and a fast
 * "get-resource-reserve" get the same line. This module rebuilds that logic and makes it repeatable:
 *
 *   api_traffic_events (7-day retention) ──nightly──▶ api_traffic_daily (path × day: calls, avg, p50, p95, p99; kept 400 d)
 *                                                          │
 *   suggest({days, topN, mult, floorMs}) ◀──────────────────┘   top-N APIs by calls over the lookback; baseline p95 =
 *                                                               MEDIAN of the daily p95s (robust to one bad day);
 *                                                               threshold = ceil50(baseline × mult), never below floorMs
 *   apply(...)  → console_settings.api_latency_thresholds.perApiAuto (+ auto: {enabled, days, topN, mult, floorMs, lastRun})
 *                 manual perApi overrides always win over perApiAuto (apiTraffic.latencyThresholds merges them)
 *   nightly     → after the roll-up, re-apply when auto.enabled (a threshold follows the API's own normal, audited)
 *
 * Lookback: the roll-up accumulates from the day this ships, so "30 d" reaches its full depth a month after deploy;
 * until the roll-up holds ≥ 2 days, suggest() reads the raw 7-day event table directly. */
'use strict';
const db = require('./db');
const settings = { get: k => require('./settings').getSetting(k), set: (k, v) => require('./settings').setSetting(k, v) };

const DEFAULTS = { enabled: false, days: 7, topN: 50, mult: 2, floorMs: 1000 };
const ceil50 = ms => Math.ceil(ms / 50) * 50;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function ensureTable() {
  await db.console.query(`CREATE TABLE IF NOT EXISTS api_traffic_daily (
      day date NOT NULL, path text NOT NULL, calls integer NOT NULL, avg_ms integer, p50_ms integer, p95_ms integer, p99_ms integer,
      tech_fails integer NOT NULL DEFAULT 0, computed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (day, path))`);
}
/* roll one KSA day up from the raw events (idempotent upsert) */
async function rollupDay(dayIso) {
  await ensureTable();
  const r = await db.console.query(`
    INSERT INTO api_traffic_daily (day, path, calls, avg_ms, p50_ms, p95_ms, p99_ms, tech_fails, computed_at)
    SELECT $1::date, path, count(*)::int, round(avg(duration_ms))::int,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::int,
           round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int,
           round(percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms))::int,
           count(*) FILTER (WHERE err_class = 'technical')::int, now()
      FROM api_traffic_events
     WHERE (ts AT TIME ZONE 'Asia/Riyadh')::date = $1::date AND duration_ms IS NOT NULL
     GROUP BY path
    ON CONFLICT (day, path) DO UPDATE SET calls = EXCLUDED.calls, avg_ms = EXCLUDED.avg_ms, p50_ms = EXCLUDED.p50_ms,
      p95_ms = EXCLUDED.p95_ms, p99_ms = EXCLUDED.p99_ms, tech_fails = EXCLUDED.tech_fails, computed_at = now()`, [dayIso]);
  return r.rowCount || 0;
}
const ksaDate = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
/* nightly: yesterday (final) + today (partial, refreshed) ; first run backfills every day the raw table still holds */
async function rollupRecent() {
  await ensureTable();
  const have = (await db.console.query(`SELECT count(DISTINCT day)::int n FROM api_traffic_daily`)).rows[0].n;
  const days = have === 0 ? 8 : 2;
  let rows = 0;
  for (let i = days - 1; i >= 0; i--) { const d = ksaDate(new Date(Date.now() - i * 86400e3)); try { rows += await rollupDay(d); } catch (e) { console.error('[LAT-BASE] rollup', d, e.message); } }
  await db.console.query(`DELETE FROM api_traffic_daily WHERE day < current_date - 400`).catch(() => {});
  return rows;
}

/* the suggestion table — what the per-API lines would be */
async function suggest(opts = {}) {
  const cfg = await getConfig();
  const days = Math.min(400, Math.max(1, Number(opts.days) || cfg.days)), topN = Math.min(200, Math.max(1, Number(opts.topN) || cfg.topN));
  const mult = Math.min(10, Math.max(1, Number(opts.mult) || cfg.mult)), floorMs = Math.max(0, Number(opts.floorMs) || cfg.floorMs);
  await ensureTable();
  const depth = (await db.console.query(`SELECT count(DISTINCT day)::int n, min(day)::text mn, max(day)::text mx FROM api_traffic_daily WHERE day >= current_date - $1::int`, [days])).rows[0];
  let rows, source;
  if (depth.n >= 2) {
    source = `daily roll-up · ${depth.n} day(s) (${depth.mn} → ${depth.mx})`;
    rows = (await db.console.query(`
      SELECT path, sum(calls)::int AS calls, round(sum(calls * coalesce(avg_ms,0))::numeric / nullif(sum(calls),0))::int AS avg_ms,
             array_agg(p95_ms ORDER BY day) AS p95s, max(p95_ms)::int AS p95_max, sum(tech_fails)::int AS tech_fails, count(*)::int AS days
        FROM api_traffic_daily WHERE day >= current_date - $1::int AND p95_ms IS NOT NULL
       GROUP BY path ORDER BY calls DESC LIMIT $2`, [days, topN])).rows.map(r => ({ ...r, p95_base: median(r.p95s.map(Number)) }));
  } else {
    source = 'raw events (roll-up not yet populated — depth grows nightly)';
    rows = (await db.console.query(`
      SELECT path, count(*)::int AS calls, round(avg(duration_ms))::int AS avg_ms,
             round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_base,
             max(duration_ms)::int AS p95_max, count(*) FILTER (WHERE err_class='technical')::int AS tech_fails, 1 AS days
        FROM api_traffic_events WHERE ts >= now() - ($1||' days')::interval AND duration_ms IS NOT NULL
       GROUP BY path ORDER BY calls DESC LIMIT $2`, [String(days), topN])).rows;
  }
  const thr = await require('./apiTraffic').latencyThresholds();
  const out = rows.map(r => {
    const base = Number(r.p95_base || 0);
    const suggested = Math.max(floorMs, ceil50(base * mult));
    const manual = thr.manual && thr.manual[r.path] != null ? Number(thr.manual[r.path]) : null;
    const auto = thr.perApiAuto && thr.perApiAuto[r.path] != null ? Number(thr.perApiAuto[r.path]) : null;
    return { api: r.path, calls: r.calls, avg_ms: r.avg_ms, p95_base: Math.round(base), p95_max: r.p95_max, tech_fails: r.tech_fails, days: r.days,
      suggested, current: manual != null ? manual : (auto != null ? auto : thr.globalMs), current_source: manual != null ? 'manual' : auto != null ? 'auto' : 'global',
      ratio_now: thr.globalMs ? Math.round(100 * base / (manual != null ? manual : auto != null ? auto : thr.globalMs)) : null };
  });
  return { params: { days, topN, mult, floorMs }, source, globalMs: thr.globalMs, rows: out, config: cfg };
}

async function getConfig() { const v = (await settings.get('api_latency_thresholds')) || {}; return { ...DEFAULTS, ...(v.auto || {}) }; }
/* write perApiAuto from the suggestion; manual overrides untouched */
async function apply(opts = {}, actor) {
  const s = await suggest(opts);
  const v = (await settings.get('api_latency_thresholds')) || {};
  const perApiAuto = {}; for (const r of s.rows) perApiAuto[r.api] = r.suggested;
  const auto = { ...DEFAULTS, ...(v.auto || {}), ...s.params, enabled: opts.enabled != null ? !!opts.enabled : !!(v.auto && v.auto.enabled), lastRun: new Date().toISOString(), lastBy: actor || 'scheduler', count: s.rows.length, source: s.source };
  const next = { globalMs: Number(v.globalMs) > 0 ? Number(v.globalMs) : 1500, perApi: v.perApi || {}, perApiAuto, auto };
  await settings.set('api_latency_thresholds', next);
  return { applied: s.rows.length, auto, rows: s.rows, source: s.source };
}
async function setEnabled(enabled, patch = {}) {
  const v = (await settings.get('api_latency_thresholds')) || {};
  const auto = { ...DEFAULTS, ...(v.auto || {}), ...patch, enabled: !!enabled };
  await settings.set('api_latency_thresholds', { globalMs: Number(v.globalMs) > 0 ? Number(v.globalMs) : 1500, perApi: v.perApi || {}, perApiAuto: v.perApiAuto || {}, auto });
  return auto;
}

let timer = null, lastRollup = null;
function start() {
  const tick = async () => {
    try { const n = await rollupRecent(); lastRollup = new Date(); console.log(`[LAT-BASE] daily roll-up ${n} row(s)`); } catch (e) { console.error('[LAT-BASE] rollup', e.message); return; }
    try { const cfg = await getConfig(); if (cfg.enabled) { const r = await apply({}, 'scheduler'); console.log(`[LAT-BASE] auto thresholds re-applied for ${r.applied} API(s)`); } } catch (e) { console.error('[LAT-BASE] apply', e.message); }
  };
  if (timer) clearInterval(timer);
  setTimeout(tick, 90000);                                   // first pass shortly after boot (backfills the roll-up)
  timer = setInterval(tick, 6 * 3600e3);                     // then every 6 h (yesterday final + today partial)
  console.log('[LAT-BASE] roll-up + auto-threshold scheduler armed (6 h)');
}
const status = () => ({ lastRollup });
module.exports = { rollupDay, rollupRecent, suggest, apply, setEnabled, getConfig, start, status, DEFAULTS };
