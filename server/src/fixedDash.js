/* fixedDash.js — Fixed "Dashboards" page (Dealers / QR codes) for the unified console.
 *
 * Straight port of salam-dealer-ops packages/api/src/routers/dashboards.ts (summary · qr · integrations)
 * and apps/web/src/app/api/export/route.ts, Prisma → pg, over the prod read model (db.ops = sda_ops.public).
 * Same definitions as https://salam.sa/operations-console → Dashboards, so the numbers match:
 *   attempts   = order_attempts rows in the window (started_at), consumer-direct e-purchase excluded
 *   completed  = outcome='COMPLETED'; conversion = round(completed/attempts*100) (integer %, like prod)
 *   Dealers view = channel 'sda' unless the hub picked another channel; QR view = epurchase + referral_code
 * Chip filters (all optional, CSV): outcome=COMPLETED,STALLED,… · plan=ftth,fttb,fiveGWhiteLabel,fiveGFWA,promoters
 *   (ftth also matches ePurchaseFTTH, like prod) · role=ADMIN,ACTIVATOR,PROMOTER · region=Central,… · consent=consented|noconsent
 * Routes (all gated by the 'fixed' view):
 *   GET /api/fixed/dash/dealers   GET /api/fixed/dash/qr   GET /api/fixed/dash/export?which=dealers|qr&format=csv|json (cap: export)
 */
const PLAN_LABEL = { ftth: 'FTTH', fttb: 'FTTB', fiveGWhiteLabel: '5G HomeFI', fiveGFWA: '5G FWA', promoters: 'Lead', ePurchaseFTTH: 'FTTH (e-Purchase/QR)' };
const OUTCOMES = ['COMPLETED', 'IN_PROGRESS', 'STALLED', 'CANCELLED', 'EXPIRED'];
const ROLES = ['ADMIN', 'ACTIVATOR', 'PROMOTER'];
const WORKFLOWS = ['ftth', 'fttb', 'fiveGWhiteLabel', 'fiveGFWA', 'promoters', 'ePurchaseFTTH'];
const FROM = `FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id`;
const n = v => Number(v) || 0;
const pctI = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;
const csv = (v, allowed, max = 20) => String(v || '').split(',').map(s => s.trim()).filter(s => s && (!allowed || allowed.includes(s))).slice(0, max);

function notConfigured() { const e = new Error('Fixed data source not configured (OPS_DATABASE_URL)'); e.status = 503; return e; }

/* Shared scope: hub window/channel (f360.parseScope) + the dashboard's own chip dimensions, all parameterised. */
function buildScope(f360, q, view) {
  const base = { ...q };
  if (view === 'qr') base.channel = 'epurchase';
  else if (!base.channel) base.channel = 'sda';           // prod: dealer dashboards always read the SDA channel
  delete base.region; delete base.workflow;               // chips below handle these as multi-selects
  const s = f360.parseScope(base);
  const params = s.params.slice();
  const parts = [];
  const outcomes = csv(q.outcome, OUTCOMES);
  if (outcomes.length) { params.push(outcomes); parts.push(`oa.outcome::text = ANY($${params.length})`); }
  const plans = csv(q.plan, WORKFLOWS);
  if (plans.includes('ftth') && !plans.includes('ePurchaseFTTH')) plans.push('ePurchaseFTTH');
  if (plans.length) { params.push(plans); parts.push(`oa.workflow::text = ANY($${params.length})`); }
  if (view !== 'qr') {
    const roles = csv(q.role, ROLES);
    if (roles.length) { params.push(roles); parts.push(`d.role::text = ANY($${params.length})`); }
    const regions = csv(q.region, null, 10).map(r => r.slice(0, 60));
    if (regions.length) { params.push(regions); parts.push(`COALESCE(oa.region, d.region) = ANY($${params.length})`); }
  } else {
    parts.push(`oa.referral_code IS NOT NULL`);
    if (q.consent === 'consented') parts.push(`oa.consent = true`);
    else if (q.consent === 'noconsent') parts.push(`oa.consent = false`);
  }
  return { from: s.from, to: s.to, channel: base.channel, where: s.where + (parts.length ? ' AND ' + parts.join(' AND ') : ''), params };
}

function planMixOf(rows) {
  const acc = new Map();
  for (const r of rows) { const label = PLAN_LABEL[r.workflow] || r.workflow; acc.set(label, (acc.get(label) || 0) + n(r.n)); }
  return [...acc.entries()].sort((a, b) => b[1] - a[1]).map(([plan, count]) => ({ plan, count }));
}
function outcomeMixOf(rows) {
  const by = o => n((rows.find(r => r.outcome === o) || {}).n);
  return { completed: by('COMPLETED'), in_progress: by('IN_PROGRESS'), stalled: by('STALLED'), cancelled: by('CANCELLED'), expired: by('EXPIRED') };
}

/* ---- dashboards.summary + dashboards.integrations (one payload) ---- */
async function dealers(db, f360, q) {
  if (!db.ops) throw notConfigured();
  const s = buildScope(f360, q, 'dealers');
  const Q = (sql, extra) => db.ops.query(sql, extra ? s.params.concat(extra) : s.params);
  const W = s.where;
  const SDA = `AND oa.channel = 'sda'`, FIVEG = `AND oa.workflow::text IN ('fiveGWhiteLabel','fiveGFWA')`;
  const [kpi, outcomes, ts, lb, plans, regions, nafTotal, nafBreak, dv, nafRegion, dvRegion, nafDealer, dvDealer] = await Promise.all([
    Q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
              count(DISTINCT oa.dealer_id)::int AS active_dealers ${FROM} ${W}`),
    Q(`SELECT oa.outcome::text AS outcome, count(*)::int AS n ${FROM} ${W} GROUP BY 1`),
    Q(`SELECT to_char(date_trunc('day', oa.started_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD') AS date,
              count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
              count(*) FILTER (WHERE oa.outcome<>'COMPLETED')::int AS other
         ${FROM} ${W} GROUP BY 1 ORDER BY 1 LIMIT 400`),
    Q(`SELECT oa.dealer_id, d.staff_name AS name, d.role::text AS role, d.city, count(*)::int AS total,
              count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed
         ${FROM} ${W} AND oa.dealer_id IS NOT NULL GROUP BY oa.dealer_id, d.staff_name, d.role, d.city ORDER BY completed DESC LIMIT 10`),
    Q(`SELECT oa.workflow::text AS workflow, count(*)::int AS n ${FROM} ${W} GROUP BY 1`),
    Q(`SELECT d.region, count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed
         ${FROM} ${W} AND d.region IS NOT NULL AND btrim(d.region) <> '' AND lower(d.region) NOT IN ('unknown','(unknown)')
         GROUP BY d.region ORDER BY total DESC LIMIT 20`),
    Q(`SELECT count(*)::int AS total ${FROM} ${W} ${SDA} ${FIVEG}`),
    Q(`SELECT oa.nafath_outcome, count(*)::int AS n ${FROM} ${W} ${SDA} ${FIVEG} AND oa.nafath_outcome IS NOT NULL GROUP BY 1`),
    Q(`SELECT oa.dealer_validation, count(*)::int AS n ${FROM} ${W} ${SDA} AND oa.dealer_validation IS NOT NULL GROUP BY 1`),
    Q(`SELECT d.region, count(*)::int AS total, count(*) FILTER (WHERE oa.nafath_outcome <> 'COMPLETED')::int AS failed
         ${FROM} ${W} ${SDA} ${FIVEG} AND oa.nafath_outcome IS NOT NULL GROUP BY d.region LIMIT 40`),
    Q(`SELECT d.region, count(*)::int AS total, count(*) FILTER (WHERE oa.dealer_validation = 'DENIED')::int AS denied
         ${FROM} ${W} ${SDA} AND oa.dealer_validation IS NOT NULL GROUP BY d.region LIMIT 40`),
    Q(`SELECT d.staff_name, count(*)::int AS failures ${FROM} ${W} ${SDA} ${FIVEG}
         AND oa.nafath_outcome IS NOT NULL AND oa.nafath_outcome <> 'COMPLETED' GROUP BY d.staff_name ORDER BY 2 DESC LIMIT 200`),
    Q(`SELECT d.staff_name, count(*)::int AS failures ${FROM} ${W} ${SDA}
         AND oa.dealer_validation = 'DENIED' GROUP BY d.staff_name ORDER BY 2 DESC LIMIT 200`),
  ]);
  const k = kpi.rows[0] || {};
  const total = n(k.total), completed = n(k.completed);
  const outcomeMix = outcomeMixOf(outcomes.rows);

  // integrations — same maths as dashboards.integrations
  const breakdown = { COMPLETED: 0, REJECTED: 0, TIMEOUT: 0, MOBILE_EXISTS: 0, FAILED: 0 };
  let withOutcome = 0;
  for (const r of nafBreak.rows) { breakdown[r.nafath_outcome] = (breakdown[r.nafath_outcome] || 0) + n(r.n); withOutcome += n(r.n); }
  let manTotal = 0, allowed = 0, denied = 0;
  for (const r of dv.rows) { manTotal += n(r.n); if (r.dealer_validation === 'ALLOWED') allowed += n(r.n); else if (r.dealer_validation === 'DENIED') denied += n(r.n); }
  const regionMap = new Map();
  const bump = r => { const key = r || 'Unknown'; if (!regionMap.has(key)) regionMap.set(key, { nafathTotal: 0, nafathFailed: 0, dvTotal: 0, denied: 0 }); return regionMap.get(key); };
  for (const r of nafRegion.rows) { const c = bump(r.region); c.nafathTotal += n(r.total); c.nafathFailed += n(r.failed); }
  for (const r of dvRegion.rows) { const c = bump(r.region); c.dvTotal += n(r.total); c.denied += n(r.denied); }
  const dealerMap = new Map();
  const bumpD = (name, by) => { const key = name || '(unknown)'; const c = dealerMap.get(key) || { name, failures: 0 }; c.failures += by; dealerMap.set(key, c); };
  for (const r of nafDealer.rows) bumpD(r.staff_name, n(r.failures));
  for (const r of dvDealer.rows) bumpD(r.staff_name, n(r.failures));

  return {
    window: { from: s.from, to: s.to }, channel: s.channel,
    kpis: { attempts: total, completed, conversion: pctI(completed, total), activeDealers: n(k.active_dealers),
            stalled: outcomeMix.stalled, cancelled: outcomeMix.cancelled },
    ordersOverTime: ts.rows.map(r => ({ date: r.date, completed: n(r.completed), other: n(r.other) })),
    outcomeMix,
    topDealers: lb.rows.map(r => ({ dealerId: r.dealer_id, name: r.name, role: r.role || 'UNKNOWN', city: r.city, total: n(r.total), completed: n(r.completed), conv: pctI(n(r.completed), n(r.total)) })),
    planMix: planMixOf(plans.rows),
    regionPerformance: regions.rows.map(r => ({ region: r.region || 'Unknown', total: n(r.total), completed: n(r.completed), conv: pctI(n(r.completed), n(r.total)) })),
    integrations: {
      nafath: { total: n((nafTotal.rows[0] || {}).total), withOutcome, breakdown, failRate: pctI(withOutcome - breakdown.COMPLETED, withOutcome), mobileExistsCount: breakdown.MOBILE_EXISTS },
      manafith: { total: manTotal, allowed, denied, deniedRate: pctI(denied, manTotal) },
      semati: { failed: breakdown.FAILED + breakdown.MOBILE_EXISTS, mobileExists: breakdown.MOBILE_EXISTS, failRate: pctI(breakdown.FAILED + breakdown.MOBILE_EXISTS, withOutcome) },
      byRegion: [...regionMap.entries()].map(([region, v]) => ({ region, nafathTotal: v.nafathTotal, nafathFailureRate: pctI(v.nafathFailed, v.nafathTotal), dvTotal: v.dvTotal, deniedRate: pctI(v.denied, v.dvTotal) }))
        .sort((a, b) => (b.nafathTotal + b.dvTotal) - (a.nafathTotal + a.dvTotal)),
      topDealersByFailure: [...dealerMap.values()].filter(d => d.failures > 0).sort((a, b) => b.failures - a.failures).slice(0, 8),
    },
  };
}

/* ---- dashboards.qr ---- */
async function qr(db, f360, q) {
  if (!db.ops) throw notConfigured();
  const s = buildScope(f360, q, 'qr');
  const Q = sql => db.ops.query(sql, s.params);
  const W = s.where;
  const [kpi, outcomes, ts, lb, plans, regions] = await Promise.all([
    Q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
              count(*) FILTER (WHERE oa.consent = true)::int AS consented, count(DISTINCT oa.referral_code)::int AS qr_codes ${FROM} ${W}`),
    Q(`SELECT oa.outcome::text AS outcome, count(*)::int AS n ${FROM} ${W} GROUP BY 1`),
    Q(`SELECT to_char(date_trunc('day', oa.started_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD') AS date,
              count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
              count(*) FILTER (WHERE oa.outcome<>'COMPLETED')::int AS other ${FROM} ${W} GROUP BY 1 ORDER BY 1 LIMIT 400`),
    Q(`SELECT oa.referral_code, count(*)::int AS orders, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
              count(*) FILTER (WHERE oa.consent = true)::int AS consented ${FROM} ${W} GROUP BY oa.referral_code ORDER BY orders DESC LIMIT 12`),
    Q(`SELECT oa.workflow::text AS workflow, count(*)::int AS n ${FROM} ${W} GROUP BY 1`),
    Q(`SELECT d.region, count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed
         ${FROM} ${W} GROUP BY d.region ORDER BY total DESC LIMIT 20`),
  ]);
  const k = kpi.rows[0] || {};
  const total = n(k.total), completed = n(k.completed);
  return {
    window: { from: s.from, to: s.to },
    kpis: { qrCodes: n(k.qr_codes), attempts: total, completed, conversion: pctI(completed, total), consentRate: total > 0 ? n(k.consented) / total : 0 },
    leaderboard: lb.rows.map(r => ({ referralCode: r.referral_code, orders: n(r.orders), completed: n(r.completed), conv: pctI(n(r.completed), n(r.orders)), consentRate: n(r.orders) > 0 ? n(r.consented) / n(r.orders) : 0 })),
    ordersOverTime: ts.rows.map(r => ({ date: r.date, completed: n(r.completed), other: n(r.other) })),
    outcomeMix: outcomeMixOf(outcomes.rows),
    planMix: planMixOf(plans.rows),
    byRegion: regions.rows.map(r => ({ region: r.region || 'Unknown', total: n(r.total), completed: n(r.completed), conv: pctI(n(r.completed), n(r.total)) })),
  };
}

/* ---- export (apps/web/src/app/api/export/route.ts): flat rows, same filters, 10k cap ---- */
const EXPORT_KEYS = ['id', 'workflow', 'plan', 'channel', 'outcome', 'stepReached', 'orderNumber', 'referralCode', 'nafathOutcome', 'dealerValidation',
  'startedAt', 'completedAt', 'durationS', 'lat', 'lng', 'dealerName', 'dealerCode', 'city', 'region', 'role'];
async function exportRows(db, f360, q) {
  if (!db.ops) throw notConfigured();
  const which = q.which === 'qr' ? 'qr' : 'dealers';
  const s = buildScope(f360, q, which);
  const lim = Math.min(10000, Math.max(1, Number(q.limit) || 10000));
  const r = await db.ops.query(`SELECT oa.id, oa.workflow::text AS workflow, oa.plan, oa.channel, oa.outcome::text AS outcome, oa.step_reached, oa.order_number,
        oa.referral_code, oa.nafath_outcome, oa.dealer_validation, oa.started_at, oa.completed_at, oa.duration_s, oa.lat, oa.lng,
        d.staff_name, d.dealer_code, d.city, d.region, d.role::text AS role
      ${FROM} ${s.where} ORDER BY oa.started_at DESC LIMIT $${s.params.length + 1}`, s.params.concat([lim]));
  const S = v => v == null ? '' : String(v);
  const iso = d => d ? new Date(d).toISOString() : '';
  return { which, rows: r.rows.map(a => ({ id: S(a.id), workflow: S(a.workflow), plan: S(a.plan), channel: S(a.channel), outcome: S(a.outcome), stepReached: S(a.step_reached),
    orderNumber: S(a.order_number), referralCode: S(a.referral_code), nafathOutcome: S(a.nafath_outcome), dealerValidation: S(a.dealer_validation),
    startedAt: iso(a.started_at), completedAt: iso(a.completed_at), durationS: a.duration_s == null ? '' : n(a.duration_s), lat: a.lat == null ? '' : Number(a.lat), lng: a.lng == null ? '' : Number(a.lng),
    dealerName: S(a.staff_name), dealerCode: S(a.dealer_code), city: S(a.city), region: S(a.region), role: S(a.role) })) };
}
const csvCell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
function toCsv(rows) {
  const lines = [EXPORT_KEYS.map(csvCell).join(',')];
  for (const r of rows) lines.push(EXPORT_KEYS.map(k => csvCell(r[k])).join(','));
  return '﻿' + lines.join('\r\n');   // BOM + CRLF so Excel reads Arabic correctly (same as prod)
}

function mount(app, deps) {
  const { gate, wrap, audit, db, f360 } = deps;
  app.get('/api/fixed/dash/dealers', gate, wrap(q => dealers(db, f360, q)));
  app.get('/api/fixed/dash/qr',      gate, wrap(q => qr(db, f360, q)));
  app.get('/api/fixed/dash/export',  gate, async (req, res) => {
    if (!(req.caps && req.caps.export)) return res.status(403).json({ error: `role ${req.roleName} lacks export` });
    try {
      const q = req.query || {};
      const format = q.format === 'json' ? 'json' : 'csv';
      const out = await exportRows(db, f360, q);
      if (audit) audit(req, 'fixed.export', out.which, { format, rows: out.rows.length, range: q.range || null, channel: q.channel || null });
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Disposition', `attachment; filename="fixed-${out.which}-export_${stamp}.${format}"`);
      if (format === 'json') { res.setHeader('Content-Type', 'application/json'); return res.send(JSON.stringify(out.rows, null, 2)); }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.send(toCsv(out.rows));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { mount, dealers, qr, exportRows, buildScope, PLAN_LABEL };
