/* SLA/SLO layer — attainment + error budgets per journey, and a vendor/integration
 * health board. All read from the hourly rollups (fast; no source scans). */
const db = require('./db');
const settings = require('./settings');

const CONFIG_KEY = 'slo_config';

// Legacy journey rollups are still success-rate SLOs. The richer config below is the source of truth
// for dashboard targets and messages; these rows are mirrored into slo_targets for old consumers.
const DEFAULT_DEFS = [
  { key: 'mobile_payment_success', journey: 'payment', business: 'mobile', group: 'MVNO journey',
    label: 'Payment success', direction: 'gte', unit: 'percent', target: 0.95, warnBand: 0.02, windowDays: 7, enabled: true,
    messages: {
      met: 'Payment success is within target.',
      at_risk: 'Payment success is close to the configured target.',
      breached: 'Payment success is below target; check gateway failures and payment callbacks.'
    } },
  { key: 'mobile_activation_success', journey: 'activation', business: 'mobile', group: 'MVNO journey',
    label: 'Activation success', direction: 'gte', unit: 'percent', target: 0.98, warnBand: 0.02, windowDays: 30, enabled: true,
    messages: {
      met: 'Activation is within target.',
      at_risk: 'Activation is near the configured target; watch BSS provisioning.',
      breached: 'Activation is below target; check BSS/Semati failures and stuck orders.'
    } },
  { key: 'mobile_semati_success', journey: 'semati', business: 'mobile', group: 'MVNO integrations',
    label: 'Semati provisioning', direction: 'gte', unit: 'percent', target: 0.97, warnBand: 0.02, windowDays: 30, enabled: true,
    messages: {
      met: 'Semati provisioning is within target.',
      at_risk: 'Semati provisioning is close to target.',
      breached: 'Semati provisioning is below target; validate CITC/TCC provider health.'
    } },
  { key: 'mobile_nafath_completion', journey: 'nafath', business: 'mobile', group: 'MVNO integrations',
    label: 'Nafath completion', direction: 'gte', unit: 'percent', target: 0.90, warnBand: 0.02, windowDays: 7, enabled: true,
    messages: {
      met: 'Nafath completion is within target.',
      at_risk: 'Nafath completion is close to the configured target.',
      breached: 'Nafath completion is below target; separate customer refusals from provider errors.'
    } },
  { key: 'mobile_eligibility_approval', journey: 'eligibility', business: 'mobile', group: 'MVNO journey',
    label: 'Eligibility approval', direction: 'gte', unit: 'percent', target: 0.90, warnBand: 0.02, windowDays: 30, enabled: true,
    messages: {
      met: 'Eligibility approval is within target.',
      at_risk: 'Eligibility approval is close to target.',
      breached: 'Eligibility approval is below target; review CITC denial reasons and campaign mix.'
    } },
  { key: 'mobile_delivery_success', journey: 'delivery', business: 'mobile', group: 'MVNO journey',
    label: 'Delivery success', direction: 'gte', unit: 'percent', target: 0.95, warnBand: 0.02, windowDays: 30, enabled: true,
    messages: {
      met: 'Delivery success is within target.',
      at_risk: 'Delivery success is close to target.',
      breached: 'Delivery success is below target; check courier assignment and failed delivery states.'
    } },
  { key: 'mobile_change_plan_success', journey: 'change_plan', business: 'mobile', group: 'MVNO servicing',
    label: 'Change Plan success', direction: 'gte', unit: 'percent', target: 0.97, warnBand: 0.02, windowDays: 30, enabled: true,
    messages: {
      met: 'Change Plan success is within target.',
      at_risk: 'Change Plan success is close to target.',
      breached: 'Change Plan success is below target; inspect eligibility, payment and BSS responses.'
    } },
  { key: 'mobile_technical_error_budget', business: 'mobile', group: 'MVNO error budgets',
    label: 'Technical error budget', direction: 'lte', unit: 'count_per_day', target: 100, warnBand: 20, windowDays: 1, enabled: true,
    messages: {
      met: 'Technical errors are within the daily budget.',
      at_risk: 'Technical errors are near the daily budget.',
      breached: 'Technical errors exceeded the daily budget; page the owning L2 team.'
    } },
  { key: 'mobile_semati_provider_errors', business: 'mobile', group: 'MVNO integrations',
    label: 'Semati provider errors', direction: 'lte', unit: 'percent', target: 0.05, warnBand: 0.02, windowDays: 1, enabled: true,
    messages: {
      met: 'Semati provider errors are within target.',
      at_risk: 'Semati provider errors are close to target.',
      breached: 'Semati provider errors exceeded target; treat as an upstream CITC/TCC degradation.'
    } },
  { key: 'mobile_citc_eligibility_denials', business: 'mobile', group: 'MVNO business outcomes',
    label: 'CITC eligibility denials', direction: 'lte', unit: 'percent', target: 0.50, warnBand: 0.05, windowDays: 1, enabled: true,
    note: 'business outcome, not a platform fault',
    messages: {
      met: 'CITC denials are within the expected business range.',
      at_risk: 'CITC denials are elevated; review eligibility mix before escalating.',
      breached: 'CITC denials exceeded the configured business threshold; check policy/campaign mix.'
    } },
  { key: 'fixed_api_error_budget', business: 'fixed', group: 'Fixed error budgets',
    label: 'API error budget', direction: 'lte', unit: 'count_per_day', target: 50, warnBand: 10, windowDays: 1, enabled: true,
    messages: {
      met: 'Fixed API errors are within budget.',
      at_risk: 'Fixed API errors are close to the configured budget.',
      breached: 'Fixed API errors exceeded budget; review Fixed error categories and BSS responses.'
    } },
  { key: 'fixed_order_conversion', business: 'fixed', group: 'Fixed journey',
    label: 'Order conversion', direction: 'gte', unit: 'percent', targetMode: 'rolling_floor', marginPp: 5, warnBand: 0.02, windowDays: 1, baselineDays: 7, enabled: true,
    messages: {
      met: 'Fixed order conversion is within its rolling target.',
      at_risk: 'Fixed order conversion is close to its rolling target.',
      breached: 'Fixed order conversion is below its rolling target; inspect where attempts stop.'
    } },
  { key: 'fixed_nafath_failure_rate', business: 'fixed', group: 'Fixed integrations',
    label: 'Nafath failure rate', direction: 'lte', unit: 'percent', target: 0.25, warnBand: 0.03, windowDays: 1, enabled: true,
    messages: {
      met: 'Fixed Nafath failure rate is within target.',
      at_risk: 'Fixed Nafath failure rate is near target.',
      breached: 'Fixed Nafath failure rate exceeded target; check timeout vs rejected split.'
    } },
  { key: 'fixed_manafith_denials', business: 'fixed', group: 'Fixed integrations',
    label: 'Manafith denials', direction: 'lte', unit: 'percent', target: 0.10, warnBand: 0.03, windowDays: 1, enabled: true,
    messages: {
      met: 'Manafith denials are within target.',
      at_risk: 'Manafith denials are close to target.',
      breached: 'Manafith denials exceeded target; review dealer and address eligibility patterns.'
    } },
  { key: 'fixed_sadad_availability', business: 'fixed', group: 'Fixed probes',
    label: 'SADAD availability', direction: 'lte', unit: 'ms', target: 500, warnBand: 150, windowDays: 1, enabled: false,
    note: 'not measured until a SADAD probe feed is wired',
    messages: {
      met: 'SADAD probe is within target.',
      at_risk: 'SADAD probe is close to target.',
      breached: 'SADAD probe exceeded target; check the payment integration.'
    } },
  { key: 'fixed_sftp_odb_sync', business: 'fixed', group: 'Fixed probes',
    label: 'SFTP ODB sync', direction: 'state', unit: 'state', targetText: 'SUCCESS daily', target: null, warnBand: 0, windowDays: 1, enabled: false,
    note: 'not measured until an SFTP job feed is wired',
    messages: {
      met: 'SFTP ODB sync completed for the day.',
      at_risk: 'SFTP ODB sync is close to the allowed lag.',
      breached: 'SFTP ODB sync missed the configured daily target.'
    } }
];

const DEFAULTS = DEFAULT_DEFS
  .filter(d => d.journey)
  .map(d => ({ journey: d.journey, label: d.label, target: d.target, window_days: d.windowDays }));
const INTEGRATION_JOURNEYS = ['activation', 'semati', 'nafath', 'eligibility', 'change_plan'];
const DIRS = new Set(['gte', 'lte', 'state']);
const UNITS = new Set(['percent', 'count_per_day', 'count_per_24h', 'ms', 'state']);

const clone = v => JSON.parse(JSON.stringify(v));
const clamp = (v, lo, hi, fb) => {
  v = Number(v);
  if (!Number.isFinite(v)) return fb;
  return Math.max(lo, Math.min(hi, v));
};
const cleanText = (v, max, fb = '') => {
  v = String(v == null ? fb : v).trim();
  return v.slice(0, max);
};
const defaultConfig = () => ({ version: 1, slos: clone(DEFAULT_DEFS) });
const byKey = cfg => Object.fromEntries(((cfg && cfg.slos) || []).map(x => [x.key, x]));
const findDef = (cfg, key) => byKey(cfg)[key] || DEFAULT_DEFS.find(d => d.key === key) || null;

function normalizeDef(raw, base) {
  const d = { ...clone(base || {}), ...(raw || {}) };
  d.key = cleanText(d.key || (base && base.key), 80);
  d.business = ['mobile', 'fixed', 'both'].includes(d.business) ? d.business : (base && base.business) || 'mobile';
  d.group = cleanText((base && base.group) || d.group, 80, 'SLOs');
  d.label = cleanText(d.label || (base && base.label), 120, d.key);
  d.direction = DIRS.has(d.direction) ? d.direction : (base && base.direction) || 'gte';
  d.unit = UNITS.has(d.unit) ? d.unit : (base && base.unit) || 'percent';
  d.targetMode = d.targetMode === 'rolling_floor' ? 'rolling_floor' : 'fixed';
  d.windowDays = Math.round(clamp(d.windowDays ?? d.window_days, 1, 400, (base && base.windowDays) || 7));
  d.baselineDays = Math.round(clamp(d.baselineDays, 1, 90, (base && base.baselineDays) || 7));
  d.marginPp = clamp(d.marginPp, 0, 100, (base && base.marginPp) || 5);
  d.enabled = d.enabled !== false;
  d.note = cleanText(d.note, 180, base && base.note);
  d.targetText = cleanText(d.targetText, 80, base && base.targetText);
  if (d.unit === 'percent') {
    d.target = d.target == null ? (base ? base.target : null) : clamp(d.target, 0, 1, base ? base.target : null);
    d.warnBand = clamp(d.warnBand, 0, 1, base ? base.warnBand : 0.02);
  } else if (d.unit === 'state') {
    d.target = null;
    d.warnBand = 0;
  } else {
    d.target = d.target == null ? (base ? base.target : null) : clamp(d.target, 0, 10_000_000, base ? base.target : null);
    d.warnBand = clamp(d.warnBand, 0, 10_000_000, base ? base.warnBand : 0);
  }
  d.messages = { ...(base && base.messages || {}), ...(d.messages || {}) };
  d.messages.met = cleanText(d.messages.met, 240, 'Within target.');
  d.messages.at_risk = cleanText(d.messages.at_risk, 240, 'Close to target.');
  d.messages.breached = cleanText(d.messages.breached, 240, 'Target breached.');
  if (base && base.journey) d.journey = base.journey;
  return d;
}

function mergeConfig(raw) {
  const saved = byKey(raw || {});
  const slos = DEFAULT_DEFS.map(base => normalizeDef(saved[base.key], base));
  return { version: 1, updated_at: (raw && raw.updated_at) || null, slos };
}

async function getConfig() {
  const raw = await settings.getSetting(CONFIG_KEY);
  return mergeConfig(raw || null);
}

async function applyLegacyTargets(cfg) {
  const C = db.console;
  for (const d of (cfg.slos || []).filter(x => x.journey && x.unit === 'percent' && x.direction === 'gte')) {
    await C.query(
      `INSERT INTO slo_targets (journey,label,target,window_days,enabled,updated_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (journey) DO UPDATE
         SET label=EXCLUDED.label, target=EXCLUDED.target, window_days=EXCLUDED.window_days,
             enabled=EXCLUDED.enabled, updated_at=now()`,
      [d.journey, d.label, d.target, d.windowDays, d.enabled !== false]);
  }
}

async function saveConfig(input) {
  const cfg = mergeConfig(input || {});
  cfg.updated_at = new Date().toISOString();
  await settings.setSetting(CONFIG_KEY, cfg);
  await applyLegacyTargets(cfg);
  return cfg;
}

async function resetConfig() {
  return saveConfig(defaultConfig());
}

async function updateJourneyTarget(journey, patch = {}) {
  const cfg = await getConfig();
  const d = cfg.slos.find(x => x.journey === journey);
  if (!d) throw new Error('unknown SLO journey');
  if ('target' in patch) d.target = patch.target;
  if ('window_days' in patch || 'windowDays' in patch) d.windowDays = patch.windowDays ?? patch.window_days;
  if ('enabled' in patch) d.enabled = patch.enabled;
  return saveConfig(cfg);
}

function targetNumber(def, ctx = {}, fallback = null) {
  if (!def) return fallback;
  if (def.targetMode === 'rolling_floor') {
    const base = Number(ctx.baseline);
    if (Number.isFinite(base)) return Math.max(0, base - Number(def.marginPp || 0) / 100);
    return fallback;
  }
  const v = Number(def.target);
  return Number.isFinite(v) ? v : fallback;
}

function fmtPercent(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const p = Number(v) * 100;
  return (Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1)) + '%';
}
function fmtValue(def, v) {
  if (!def) return v == null ? '—' : String(v);
  if (def.unit === 'percent') return fmtPercent(v);
  if (def.unit === 'ms') return `${Math.round(Number(v) || 0)} ms`;
  if (def.unit === 'count_per_day') return `${Math.round(Number(v) || 0)} / day`;
  if (def.unit === 'count_per_24h') return `${Math.round(Number(v) || 0)} / 24 h`;
  return def.targetText || (v == null ? '—' : String(v));
}
function targetText(def, ctx = {}, fallback = null) {
  if (!def) return fallback || '—';
  if (def.targetText && def.unit === 'state') return def.targetText;
  const t = targetNumber(def, ctx, fallback);
  if (def.targetMode === 'rolling_floor') {
    const base = Number(ctx.baseline);
    const suffix = Number.isFinite(base) ? ` (${def.baselineDays || 7}-day avg - ${Number(def.marginPp || 0)} pp)` : '';
    return `${def.direction === 'lte' ? '≤' : '≥'} ${fmtValue(def, t)}${suffix}`;
  }
  const op = def.direction === 'lte' ? '≤' : def.direction === 'gte' ? '≥' : '';
  return `${op} ${fmtValue(def, t)}`.trim();
}

function assess(def, actual, ctx = {}, fallbackTarget = null) {
  const target = targetNumber(def, ctx, fallbackTarget);
  if (actual == null || !Number.isFinite(Number(actual)) || target == null || !Number.isFinite(Number(target))) {
    return { target, targetText: targetText(def, ctx, fallbackTarget), status: 'nodata', ok: null, message: def && def.note || 'Not measured by this console.' };
  }
  actual = Number(actual);
  const warn = Math.max(0, Number(def && def.warnBand) || 0);
  let status;
  if (def && def.direction === 'lte') status = actual <= target ? 'met' : actual <= target + warn ? 'at_risk' : 'breached';
  else status = actual >= target ? 'met' : actual >= target - warn ? 'at_risk' : 'breached';
  const tpl = def && def.messages && (def.messages[status] || def.messages.breached);
  const msg = String(tpl || '').replace(/\{actual\}/g, fmtValue(def, actual)).replace(/\{target\}/g, fmtValue(def, target));
  return { target, targetText: targetText(def, ctx, fallbackTarget), status, ok: status === 'met', message: msg };
}

async function seedDefaults() {
  let cfg = null;
  try { cfg = await getConfig(); } catch (_) { cfg = defaultConfig(); }
  for (const d of (cfg.slos || []).filter(x => x.journey && x.unit === 'percent' && x.direction === 'gte')) {
    await db.console.query(
      `INSERT INTO slo_targets (journey,label,target,window_days) VALUES ($1,$2,$3,$4)
         ON CONFLICT (journey) DO NOTHING`, [d.journey, d.label, d.target, d.windowDays]);
  }
}

const rate = (ok, fail) => (ok + fail) > 0 ? ok / (ok + fail) : null;

// evaluate every enabled SLO at board-now
async function evaluate(now) {
  const C = db.console;
  const n = now || new Date().toISOString();
  const cfg = await getConfig().catch(() => defaultConfig());
  const byJourney = {};
  (cfg.slos || []).forEach(x => { if (x.journey) byJourney[x.journey] = x; });
  const targets = (await C.query(`SELECT * FROM slo_targets WHERE enabled ORDER BY journey`)).rows;
  const out = [];
  for (const t of targets) {
    const def = byJourney[t.journey] || null;
    const from = new Date(new Date(n).getTime() - t.window_days * 86400e3).toISOString();
    const r = (await C.query(
      `SELECT outcome, sum(cnt)::bigint c FROM rollup_hourly WHERE journey=$1 AND hour >= $2 AND hour < $3 GROUP BY 1`,
      [t.journey, from, n])).rows;
    const m = {}; r.forEach(x => m[x.outcome] = Number(x.c));
    const ok = m.ok || 0, fail = m.fail || 0, tot = ok + fail;
    const target = Number(t.target);
    const attain = rate(ok, fail);
    const allowed = tot * (1 - target);         // error budget (allowed failures) over the window
    const remaining = allowed - fail;
    const budgetPct = allowed > 0 ? remaining / allowed : (fail === 0 ? 1 : -1);
    const verdict = assess(def || { direction: 'gte', unit: 'percent', target, warnBand: 0.02 }, attain, {}, target);
    const status = attain == null ? 'nodata' : verdict.status;
    // 7-day daily attainment sparkline
    const days = (await C.query(
      `SELECT (hour AT TIME ZONE 'Asia/Riyadh')::date d,
              sum(cnt) FILTER (WHERE outcome='ok')::bigint ok, sum(cnt) FILTER (WHERE outcome='fail')::bigint fail
       FROM rollup_hourly WHERE journey=$1 AND hour >= $2 GROUP BY 1 ORDER BY 1`,
      [t.journey, new Date(new Date(n).getTime() - 7 * 86400e3).toISOString()])).rows;
    const spark = days.map(x => { const o = Number(x.ok), f = Number(x.fail); return (o + f) > 0 ? o / (o + f) : null; });
    out.push({ journey: t.journey, key: def && def.key, label: t.label, target, targetText: verdict.targetText,
      window_days: t.window_days, business: def && def.business, message: verdict.message,
      attainment: attain, total: tot, ok, fail, allowed: Math.round(allowed),
      budgetRemaining: Math.round(remaining), budgetPct, status, spark });
  }
  return { now: n, slos: out };
}

// vendor/integration health over a window (default 24h)
async function vendorHealth(now, windowHours = 24) {
  const C = db.console;
  const n = now || new Date().toISOString();
  const from = new Date(new Date(n).getTime() - windowHours * 3600e3).toISOString();
  const vr = (await C.query(
    `SELECT journey, vendor, outcome, sum(cnt)::bigint c FROM rollup_vendor_hourly
     WHERE hour >= $1 AND hour < $2 GROUP BY 1,2,3`, [from, n])).rows;
  const byKey = {};
  vr.forEach(x => { const k = x.journey + '|' + (x.vendor || '—'); (byKey[k] ??= { journey: x.journey, vendor: x.vendor || '—', ok: 0, fail: 0, pending: 0 }); byKey[k][x.outcome] = Number(x.c); });
  const rows = Object.values(byKey).map(v => { const tot = v.ok + v.fail; return { ...v, total: tot + v.pending, rate: rate(v.ok, v.fail) }; })
    .filter(v => v.total > 0).sort((a, b) => b.total - a.total);
  const paymentVendors = rows.filter(v => v.journey === 'payment');
  const couriers = rows.filter(v => v.journey === 'delivery');
  // integrations from journey rollups
  const ir = (await C.query(
    `SELECT journey, outcome, sum(cnt)::bigint c FROM rollup_hourly
     WHERE journey = ANY($1) AND hour >= $2 AND hour < $3 GROUP BY 1,2`, [INTEGRATION_JOURNEYS, from, n])).rows;
  const im = {}; ir.forEach(x => { (im[x.journey] ??= { journey: x.journey, ok: 0, fail: 0 }); im[x.journey][x.outcome] = Number(x.c); });
  const integrations = Object.values(im).map(v => ({ ...v, total: v.ok + v.fail, rate: rate(v.ok, v.fail) }))
    .filter(v => v.total > 0).sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1));
  return { now: n, windowHours, paymentVendors, couriers, integrations };
}

module.exports = {
  evaluate, vendorHealth, seedDefaults, DEFAULTS,
  CONFIG_KEY, defaultConfig, getConfig, saveConfig, resetConfig, updateJourneyTarget,
  findDef, targetNumber, targetText, assess, fmtValue, fmtPercent
};
