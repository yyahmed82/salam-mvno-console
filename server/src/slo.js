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
  /* ── Fixed app-experience objectives (18 Sep 2026) ────────────────────────────────────────────
   * These carry the absolute, customer-facing numbers that the Fixed alert thresholds used to stand
   * in for. On 18 Sep the app-log alert thresholds were re-anchored on each signal's own
   * distribution, because a threshold below the median is not a detector; the numbers below are what
   * we actually owe a customer, tracked as 30-day attainment instead of as a permanent alarm.
   * TARGETS ARE PROPOSED, NOT AGREED. Measured over the 14 days to 18 Sep the app-log technical rate
   * had a MEDIAN of 30 % and step p95 a median of 7.1 s, so these will read near-zero attainment
   * until the open question on app-log technical classification is settled — the board lane reports
   * 1.2 % over the same hours, a 25x disagreement. Showing that gap is the point. */
  { key: 'fixed_app_technical_rate', business: 'fixed', group: 'Fixed app experience',
    label: 'App steps — technical failures', direction: 'gte', unit: 'percent', target: 0.97, warnBand: 0.02, windowDays: 30, enabled: true,
    metric: { key: 'fixed_applog_fail_rate', dim: { channel: 'all' }, windowHours: 1, direction: 'lte', threshold: 0.02, label: 'with under 2 % of app steps failing technically' },
    note: 'Proposed target, not yet agreed. Attainment is the share of hours inside the 2 % ceiling.',
    messages: {
      met: 'App steps stay inside the 2 % technical-failure ceiling.',
      at_risk: 'App step technical failures are eating the error budget for the month.',
      breached: 'App steps exceed the technical-failure ceiling for more hours than the objective allows — check the app-log classification before reading this as a platform fault.'
    } },
  { key: 'fixed_app_step_latency', business: 'fixed', group: 'Fixed app experience',
    label: 'App step latency p95', direction: 'gte', unit: 'percent', target: 0.95, warnBand: 0.02, windowDays: 30, enabled: true,
    metric: { key: 'fixed_applog_latency_p95_ms', dim: { channel: 'all' }, windowHours: 1, direction: 'lte', threshold: 3000, label: 'with step p95 under 3 s' },
    note: 'Proposed target, not yet agreed. 3 s p95 is the point past which customers start abandoning a step.',
    messages: {
      met: 'App step latency stays under 3 s at p95.',
      at_risk: 'App step latency is spending its error budget for the month.',
      breached: 'App steps are over 3 s at p95 for more hours than the objective allows; customers are waiting.'
    } },
  { key: 'fixed_app_payment_reliability', business: 'fixed', group: 'Fixed app experience',
    label: 'Payment steps — technical failures', direction: 'gte', unit: 'percent', target: 0.99, warnBand: 0.01, windowDays: 30, enabled: true,
    metric: { key: 'fixed_applog_payment_fail_rate', dim: { channel: 'all' }, windowHours: 1, direction: 'lte', threshold: 0.02, label: 'with under 2 % of payment steps failing technically' },
    note: 'Proposed target, not yet agreed. The money path earns a tighter objective than the rest of the app.',
    messages: {
      met: 'The payment path stays inside its technical-failure ceiling.',
      at_risk: 'Payment technical failures are eating the month\u2019s error budget.',
      breached: 'The payment path breaches its ceiling for more hours than the objective allows — money is at stake, treat as a standing incident.'
    } },
  { key: 'fixed_board_technical_rate', business: 'fixed', group: 'Fixed app experience',
    label: 'Journey errors — technical', direction: 'gte', unit: 'percent', target: 0.97, warnBand: 0.02, windowDays: 30, enabled: true,
    metric: { key: 'fixed_board_fail_rate', dim: { channel: 'all' }, windowHours: 1, direction: 'lte', threshold: 0.02, label: 'with under 2 % of journey attempts ending in a technical error' },
    note: 'The same objective as the app-step one, measured on the error board instead of the app log. The two lanes disagreeing is itself the signal.',
    messages: {
      met: 'Journey attempts stay inside the 2 % technical-error ceiling.',
      at_risk: 'Journey technical errors are eating the error budget for the month.',
      breached: 'Journey attempts exceed the technical-error ceiling for more hours than the objective allows.'
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
/* ── BUSINESS vs TECHNICAL ON AN SLO (20 Sep 2026) ───────────────────────────────────────────────
 * Settings › SLO definitions › Counts. One global default (cfg.countBusinessErrors) that every
 * objective inherits, and a per-objective override where the signal can honour it.
 *
 * WHETHER a signal can be split is a fact about the signal, not a preference, so it lives HERE in
 * code and is never writable through the editor — only the choice is. Three shapes:
 *   capable          the signal carries a class; the operator picks.
 *   locked: '<cls>'  the objective exists to measure that one class. Forcing the other leaves it
 *                    measuring nothing, so the control shows the value and the reason, disabled.
 *   (neither)        no class signal — latency, conversion, unwired probes. Disabled with the reason.
 * `allowed` narrows the choice: the Fixed app/board metrics are recorded as one snapshot row PER
 * class, so there is no combined series — asking for 'all' would match both rows and double-count
 * the ticks. Those offer technical/business only, which is also why they were hard-coded to
 * technical before this existed. */
const CLASS_META = {
  /* NOT capable, and the reason is definitional rather than missing plumbing: errclass.sourceCls()
   * classifies `payments` and `delivery_requests` with a CONSTANT 'business' — a decline is the
   * gateway answering "no", a cancelled/refused/RTO delivery is a business outcome. A gateway
   * timeout never lands on these journeys at all; it becomes payment_stuck, outside this rollup.
   * So a technical-only setting here would compute ok/(ok+0) and read 100 % met forever: a
   * permanently green objective measuring nothing. Confirmed against 30 days on 20 Sep — payment
   * 70,699 business / 0 technical, delivery 111 / 0. A test asserts this stays true. */
  mobile_payment_success:        { note: 'a decline is the gateway answering "no" — this console has no technical signal on the payment journey (a timeout becomes payment_stuck)' },
  mobile_activation_success:     { capable: true },
  mobile_semati_success:         { capable: true },
  mobile_nafath_completion:      { capable: true },
  mobile_eligibility_approval:   { capable: true },
  mobile_delivery_success:       { note: 'cancelled / refused / RTO are business outcomes — this console has no technical signal on the delivery journey' },
  mobile_change_plan_success:    { capable: true },
  mobile_technical_error_budget: { locked: 'technical', note: 'this objective is the technical error budget — counting business outcomes in it would make it a different objective' },
  mobile_semati_provider_errors: { locked: 'technical', note: 'a provider error is an upstream CITC/TCC degradation; a Semati business decline is counted by the journey objective' },
  mobile_citc_eligibility_denials: { locked: 'business', note: 'a denial is a business outcome, not a platform fault — that is what this objective measures' },
  fixed_app_technical_rate:      { capable: true, allowed: ['technical', 'business'], fallback: 'technical' },
  fixed_app_payment_reliability: { capable: true, allowed: ['technical', 'business'], fallback: 'technical' },
  fixed_board_technical_rate:    { capable: true, allowed: ['technical', 'business'], fallback: 'technical' },
  fixed_api_error_budget:        { capable: true },
  fixed_nafath_failure_rate:     { capable: true },
  fixed_manafith_denials:        { locked: 'business', note: 'a denial is a business outcome — this objective exists to count them' },
  fixed_app_step_latency:        { note: 'latency has no error class — a slow step is slow whoever caused it' },
  fixed_order_conversion:        { note: 'conversion counts where attempts stop, not why they failed' },
  fixed_sadad_availability:      { note: 'no SADAD probe is wired into this console' },
  fixed_sftp_odb_sync:           { note: 'no SFTP job feed is wired into this console' }
};
const CLASSES = new Set(['all', 'technical', 'business']);
function classMeta(key) {
  const m = CLASS_META[key] || {};
  const allowed = Array.isArray(m.allowed) ? m.allowed.filter(x => CLASSES.has(x)) : ['all', 'technical', 'business'];
  return { capable: !!m.capable, locked: CLASSES.has(m.locked) ? m.locked : null,
           allowed, fallback: m.fallback || null, note: m.note || null };
}
/* what this objective actually counts right now: its own override, else the global default. */
function effectiveClass(def, cfg) {
  const m = classMeta(def && def.key);
  if (m.locked) return m.locked;
  if (!m.capable) return 'all';
  const own = def && def.errorClass;
  if (CLASSES.has(own) && m.allowed.includes(own)) return own;
  const inherited = (cfg && cfg.countBusinessErrors === false) ? 'technical' : 'all';
  return m.allowed.includes(inherited) ? inherited : (m.fallback || m.allowed[0]);
}
const classLabel = c => c === 'technical' ? 'Technical errors only' : c === 'business' ? 'Business outcomes only' : 'All errors';

const defaultConfig = () => ({ version: 1, countBusinessErrors: true, slos: clone(DEFAULT_DEFS) });
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
  /* `metric` is plumbing, not configuration: it names the signal and the ceiling the objective is
   * measured against. Pin it from the code definition so a round-trip through the editor can never
   * corrupt or drop it — the editor owns the target, the window, the band and the wording. */
  if (base && base.metric) d.metric = clone(base.metric); else delete d.metric;
  /* the operator's Counts choice. Capability is code (classMeta), so it is recomputed on every read
   * and a stored value outside what the signal allows is dropped rather than honoured. */
  const cm = classMeta(d.key);
  d.errorClass = (CLASSES.has(d.errorClass) && !cm.locked && cm.capable && cm.allowed.includes(d.errorClass)) ? d.errorClass : null;
  d.classCapable = cm.capable; d.classLocked = cm.locked; d.classAllowed = cm.allowed; d.classNote = cm.note;
  return d;
}

function mergeConfig(raw) {
  const saved = byKey(raw || {});
  const slos = DEFAULT_DEFS.map(base => normalizeDef(saved[base.key], base));
  const cfg = { version: 1, updated_at: (raw && raw.updated_at) || null,
                countBusinessErrors: !(raw && raw.countBusinessErrors === false), slos };
  // resolved for the UI: what each objective counts today, and whether that came from the default
  for (const d of cfg.slos) { d.countsClass = effectiveClass(d, cfg); d.countsLabel = classLabel(d.countsClass); d.countsInherited = !d.errorClass && !d.classLocked; }
  return cfg;
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

/* ── METRIC-BACKED SLOs (18 Sep 2026) ───────────────────────────────────────────────────────────
 * A journey SLO measures outcomes in rollup_hourly. Most Fixed objectives are not journeys — they
 * are thresholds on a live signal ("app steps fail technically under 2 %", "step p95 under 3 s") —
 * and until now a definition without a `journey` was configuration the console never evaluated:
 * editable on #slo-settings, never measured, never a card. Half the Fixed definitions were decorative.
 *
 * These are measured the standard way for a threshold objective: attainment is the share of
 * measurement intervals in the window that COMPLIED, and the error budget is the number of
 * non-compliant intervals the objective still allows. The signal is metric_snapshots, which the alert
 * lane already writes every tick, so this needs one query per definition and no new plumbing. */
async function metricSlos(now, cfg) {
  const C = db.console;
  const out = [];
  for (const d of (cfg.slos || [])) {
    if (!d.metric || !d.metric.key || d.enabled === false) continue;
    const win = Number(d.windowDays) || 30;
    const from = new Date(new Date(now).getTime() - win * 86400e3).toISOString();
    const cmp = d.metric.direction === 'gte' ? '>=' : '<=';        // our own config, never user input
    /* Counts (20 Sep 2026): the class is no longer baked into the definition — it is whatever the
     * objective is set to count. These metrics are recorded one snapshot row PER class, so 'all'
     * would match both rows and double-count the ticks; classMeta().allowed stops effectiveClass
     * ever returning it for them, and the editor never offers it. */
    const cls = effectiveClass(d, cfg);
    const baseDim = { ...(d.metric.dim || {}) }; delete baseDim.cls;
    const dim = JSON.stringify(cls === 'all' ? baseDim : { ...baseDim, cls });
    let row;
    try {
      row = (await C.query(
        `SELECT count(*)::int AS ticks, count(*) FILTER (WHERE value ${cmp} $4) ::int AS ok
           FROM metric_snapshots
          WHERE metric_key = $1 AND window_hours = $2 AND dim @> $3::jsonb
            AND value IS NOT NULL AND sim_now >= $5 AND sim_now < $6`,
        [d.metric.key, Number(d.metric.windowHours) || 1, dim, Number(d.metric.threshold), from, now])).rows[0];
    } catch (e) { continue; }
    const tot = Number(row.ticks) || 0, ok = Number(row.ok) || 0, fail = tot - ok;
    const attain = tot ? ok / tot : null;
    const target = Number(d.target);
    const allowed = tot * (1 - target);
    const remaining = allowed - fail;
    const verdict = assess(d, attain, {}, target);
    const days = (await C.query(
      `SELECT (sim_now AT TIME ZONE 'Asia/Riyadh')::date d,
              count(*) FILTER (WHERE value ${cmp} $4)::int ok, count(*)::int n
         FROM metric_snapshots
        WHERE metric_key = $1 AND window_hours = $2 AND dim @> $3::jsonb
          AND value IS NOT NULL AND sim_now >= $5 GROUP BY 1 ORDER BY 1`,
      [d.metric.key, Number(d.metric.windowHours) || 1, dim, Number(d.metric.threshold),
       new Date(new Date(now).getTime() - 7 * 86400e3).toISOString()])).rows;
    out.push({
      journey: null, key: d.key, label: d.label, target, business: d.business, group: d.group,
      countsClass: cls, countsLabel: classLabel(cls),
      targetText: `${fmtValue(d, target)} of hours ${d.metric.label || `${cmp} ${d.metric.threshold}`}`,
      window_days: win, message: tot ? verdict.message : (d.note || 'No measurements in the window yet.'),
      attainment: attain, total: tot, ok, fail, allowed: Math.round(allowed),
      budgetRemaining: Math.round(remaining), budgetPct: allowed > 0 ? remaining / allowed : (fail === 0 ? 1 : -1),
      status: attain == null ? 'nodata' : verdict.status,
      spark: days.map(x => (Number(x.n) > 0 ? Number(x.ok) / Number(x.n) : null))
    });
  }
  return out;
}

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
    /* Counts (20 Sep 2026): rollup_hourly now carries err_class on its fail rows, so a journey
     * objective can measure platform health (technical only) instead of every negative outcome.
     * Rows written before that change carry '' — UNCLASSIFIED, which is not the same as business.
     * A class-filtered objective whose window still contains them would quietly report a flattering
     * number, so it refuses to answer instead and says how to fix it. */
    const cls = effectiveClass(def, cfg);
    const r = (await C.query(
      `SELECT outcome, err_class, sum(cnt)::bigint c FROM rollup_hourly WHERE journey=$1 AND hour >= $2 AND hour < $3 GROUP BY 1,2`,
      [t.journey, from, n])).rows;
    const m = {}; let failAll = 0, failCls = 0, failRaw = 0;
    for (const x of r) {
      const c = Number(x.c);
      m[x.outcome] = (m[x.outcome] || 0) + c;
      if (x.outcome !== 'fail') continue;
      failAll += c;
      if (!x.err_class) failRaw += c; else if (x.err_class === cls) failCls += c;
    }
    const unclassified = cls === 'all' ? 0 : failRaw;
    const ok = m.ok || 0, fail = cls === 'all' ? failAll : failCls, tot = ok + fail;
    const target = Number(t.target);
    const attain = rate(ok, fail);
    const allowed = tot * (1 - target);         // error budget (allowed failures) over the window
    const remaining = allowed - fail;
    const budgetPct = allowed > 0 ? remaining / allowed : (fail === 0 ? 1 : -1);
    const verdict = assess(def || { direction: 'gte', unit: 'percent', target, warnBand: 0.02 }, attain, {}, target);
    let status = attain == null ? 'nodata' : verdict.status;
    let message = verdict.message;
    if (unclassified > 0) {
      const lo = (await C.query(
        `SELECT min(hour) h FROM rollup_hourly WHERE journey=$1 AND outcome='fail' AND err_class <> ''`, [t.journey])).rows[0];
      status = 'nodata';
      message = `Counting ${classLabel(cls).toLowerCase()}, but ${unclassified.toLocaleString('en-US')} failure(s) in this ${t.window_days}-day window were recorded before the console classified them — reporting a number now would under-count. `
        + (lo && lo.h ? `Classified from ${new Date(lo.h).toISOString().slice(0, 10)}. ` : '')
        + `Rebuild the window (node src/cli.js rollups --days ${t.window_days}) or set this objective back to All errors.`;
    }
    /* the sparkline follows the same Counts setting, or the line and the headline would disagree */
    const days = (await C.query(
      `SELECT (hour AT TIME ZONE 'Asia/Riyadh')::date d,
              sum(cnt) FILTER (WHERE outcome='ok')::bigint ok,
              sum(cnt) FILTER (WHERE outcome='fail' AND ($3 = 'all' OR err_class = $3))::bigint fail
       FROM rollup_hourly WHERE journey=$1 AND hour >= $2 GROUP BY 1 ORDER BY 1`,
      [t.journey, new Date(new Date(n).getTime() - 7 * 86400e3).toISOString(), cls])).rows;
    const spark = days.map(x => { const o = Number(x.ok), f = Number(x.fail); return (o + f) > 0 ? o / (o + f) : null; });
    out.push({ journey: t.journey, key: def && def.key, label: t.label, target, targetText: verdict.targetText,
      window_days: t.window_days, business: def && def.business, message,
      countsClass: cls, countsLabel: classLabel(cls), unclassified,
      attainment: unclassified > 0 ? null : attain, total: tot, ok, fail, allowed: Math.round(allowed),
      budgetRemaining: Math.round(remaining), budgetPct, status, spark });
  }
  let metricOut = [];
  try { metricOut = await metricSlos(n, cfg); } catch (e) { metricOut = []; }
  return { now: n, slos: out.concat(metricOut) };
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
  findDef, targetNumber, targetText, assess, fmtValue, fmtPercent,
  classMeta, effectiveClass, classLabel, CLASS_META
};
