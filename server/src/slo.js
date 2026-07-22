/* SLA/SLO layer — attainment + error budgets per journey, and a vendor/integration
 * health board. All read from the hourly rollups (fast; no source scans). */
const db = require('./db');

// sensible telecom defaults (success-rate targets over a window)
const DEFAULTS = [
  { journey: 'payment',     label: 'Payment success',        target: 0.95, window_days: 7 },
  { journey: 'activation',  label: 'Activation (BSS)',       target: 0.98, window_days: 30 },
  { journey: 'semati',      label: 'Semati provisioning',    target: 0.97, window_days: 30 },
  { journey: 'nafath',      label: 'Nafath completion',      target: 0.90, window_days: 7 },
  { journey: 'eligibility', label: 'Eligibility approval',   target: 0.90, window_days: 30 },
  { journey: 'delivery',    label: 'Delivery success',       target: 0.95, window_days: 30 },
  { journey: 'change_plan', label: 'Change Plan success',    target: 0.97, window_days: 30 }
];
const INTEGRATION_JOURNEYS = ['activation', 'semati', 'nafath', 'eligibility', 'change_plan'];

async function seedDefaults() {
  for (const d of DEFAULTS) {
    await db.console.query(
      `INSERT INTO slo_targets (journey,label,target,window_days) VALUES ($1,$2,$3,$4)
         ON CONFLICT (journey) DO NOTHING`, [d.journey, d.label, d.target, d.window_days]);
  }
}

const rate = (ok, fail) => (ok + fail) > 0 ? ok / (ok + fail) : null;

// evaluate every enabled SLO at board-now
async function evaluate(now) {
  const C = db.console;
  const n = now || new Date().toISOString();
  const targets = (await C.query(`SELECT * FROM slo_targets WHERE enabled ORDER BY journey`)).rows;
  const out = [];
  for (const t of targets) {
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
    const status = attain == null ? 'nodata'
      : attain >= target ? 'met'
      : attain >= target - 0.02 ? 'at_risk' : 'breached';
    // 7-day daily attainment sparkline
    const days = (await C.query(
      `SELECT (hour AT TIME ZONE 'Asia/Riyadh')::date d,
              sum(cnt) FILTER (WHERE outcome='ok')::bigint ok, sum(cnt) FILTER (WHERE outcome='fail')::bigint fail
       FROM rollup_hourly WHERE journey=$1 AND hour >= $2 GROUP BY 1 ORDER BY 1`,
      [t.journey, new Date(new Date(n).getTime() - 7 * 86400e3).toISOString()])).rows;
    const spark = days.map(x => { const o = Number(x.ok), f = Number(x.fail); return (o + f) > 0 ? o / (o + f) : null; });
    out.push({ journey: t.journey, label: t.label, target, window_days: t.window_days,
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

module.exports = { evaluate, vendorHealth, seedDefaults, DEFAULTS };
