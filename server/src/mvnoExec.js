/* mvnoExec.js — Mobile (MVNO) › Executive + Operations data, in the execContract shape.
 *
 *   GET /api/mvno/exec?range=7d|30d        (gate: view 'dashboard')
 *
 * Mounted from api.js with the internals it needs (homeKpisFromSource, boardNow, segment) so the 24 h
 * KPIs are EXACTLY the Dashboard's numbers — same query, same targets, same "vs previous" deltas:
 *   orders / checkouts / payments / activations / Nafath / deliveries   homeKpisFromSource (24 h + prev)
 *   day series                                                        rollup_hourly summed per KSA day
 *   technical failures + budget                                       api_error_events (app error log),
 *                                                                     budget = app_backend_err_count rule
 *   pipeline                                                          the onboarding funnel, 24 h
 *   top ongoing issues                                                api_error_events by endpoint + code
 *   alerts                                                            alerts table, segment mvno, open
 *   SLOs                                                              payment / activation targets, Nafath,
 *                                                                     eligibility deny + Semati provider rate
 *                                                                     from the latest metric_snapshots
 * Read-only; nothing here writes. */
const db = require('./db');
const K = require('./execContract');
const { n, pct, delta, dayKey, dayAxis, trendOf, sevOf } = K;
const C = () => db.console;

/* technical = the two app-error rules the console already ships: backend/provider failures and
 * unhandled crashes. NOT -700 (Semati business refusal) and NOT the auth family. */
const TECH = `(error_code IN (-500,-702,-20003) OR error_code = -501)`;
const ENDPOINT = `COALESCE(NULLIF(controller,'')||'#'||COALESCE(NULLIF(action,''),'?'), action_name, source, 'unknown')`;
const ROLLUP = `SELECT (date_trunc('day', hour AT TIME ZONE 'Asia/Riyadh'))::date::text AS day, journey, outcome, sum(cnt)::int AS c
                  FROM rollup_hourly WHERE hour >= $1 AND hour < $2 GROUP BY 1,2,3`;
const ERR_DAY = `SELECT (date_trunc('day', ts AT TIME ZONE 'Asia/Riyadh'))::date::text AS day, count(*)::int AS n
                   FROM api_error_events WHERE ts >= $1 AND ts < $2 AND ${TECH} GROUP BY 1`;
const ERR_CAT = `SELECT ${ENDPOINT} AS category, error_code, count(*)::int AS total,
                        min(ts) AS first_seen, max(ts) AS last_seen
                   FROM api_error_events WHERE ts >= $1 AND ts < $2 AND ${TECH}
                  GROUP BY 1,2 ORDER BY total DESC LIMIT 8`;
const ERR_CAT_DAY = `SELECT ${ENDPOINT} AS category, error_code,
                            (date_trunc('day', ts AT TIME ZONE 'Asia/Riyadh'))::date::text AS day, count(*)::int AS n
                       FROM api_error_events WHERE ts >= $1 AND ts < $2 AND ${TECH} GROUP BY 1,2,3`;
const ERR_24 = `SELECT count(*)::int AS n FROM api_error_events WHERE ts >= $1 AND ${TECH}`;
const SNAP = `SELECT DISTINCT ON (metric_key) metric_key, value, sample, sim_now FROM metric_snapshots
               WHERE metric_key = ANY($1) AND window_hours = 24 AND dim = '{}'::jsonb ORDER BY metric_key, sim_now DESC`;

const safe = (p, fb) => p.then(r => r.rows, () => fb);
async function budget() {
  try { const r = await C().query(`SELECT threshold FROM alert_rules WHERE key='app_backend_err_count' AND enabled LIMIT 1`); const t = n((r.rows[0] || {}).threshold); return t > 0 ? t : 100; }
  catch (_) { return 100; }
}
const fmtRate = r => r == null ? '—' : `${Math.round(r * 1000) / 10}%`;

async function exec(q, { homeKpis, boardNow, segment }) {
  const range = K.rangeOf(q), days = range === '30d' ? 30 : 7;
  // boardNow() returns an ISO STRING (the replay cursor / newest row clamped to wall clock), or
  // undefined when dataBounds fails - never a Date. Normalise once, then work in millis.
  const now = new Date((await boardNow(q.sim)) || Date.now()), D = 864e5;
  const nowIso = now.toISOString();
  const to = nowIso, from = new Date(now.getTime() - days * D).toISOString(), from24 = new Date(now.getTime() - D).toISOString();
  const segWhere = segment.sqlWhere('a', 'rule_key', 'mvno');

  const [h, roll, errDays, errCats, errCatDays, err24, bud, alerts, radarRows, radarTot, snaps] = await Promise.all([
    homeKpis(nowIso, from24, to),
    safe(C().query(ROLLUP, [from, to]), []), safe(C().query(ERR_DAY, [from, to]), []), safe(C().query(ERR_CAT, [from, to]), []),
    safe(C().query(ERR_CAT_DAY, [from, to]), []), safe(C().query(ERR_24, [from24]), [{ n: 0 }]), budget(),
    safe(C().query(`SELECT a.severity, a.name, a.rule_key, a.team, a.status, a.message, a.observed_value, a.threshold, a.fired_at, a.last_seen_at
                      FROM alerts a WHERE ${segWhere} AND (a.status='open' OR a.fired_at >= $1) ORDER BY a.status='open' DESC, a.fired_at DESC LIMIT 50`, [from]), []),
    /* radar, per KSA day x severity: DISTINCT RULES, not firings. The same rule re-firing all week is
     * one rule, not 900 alerts. `open` = rules whose incident row is still open right now. */
    safe(C().query(`SELECT (date_trunc('day', a.fired_at AT TIME ZONE 'Asia/Riyadh'))::date::text AS day, a.severity,
                           count(DISTINCT a.rule_key)::int AS n,
                           count(DISTINCT a.rule_key) FILTER (WHERE a.status='open')::int AS open,
                           count(*)::int AS firings,
                           (array_agg(DISTINCT coalesce(a.name, a.rule_key)))[1:4] AS rules
                      FROM alerts a WHERE ${segWhere} AND a.fired_at >= $1 GROUP BY 1,2`, [from]), []),
    /* window totals are queried apart: a rule firing on five days is five daily rows but ONE rule */
    safe(C().query(`SELECT a.severity, count(DISTINCT a.rule_key)::int AS rules,
                           count(DISTINCT a.rule_key) FILTER (WHERE a.status='open')::int AS open,
                           count(*)::int AS firings
                      FROM alerts a WHERE ${segWhere} AND a.fired_at >= $1 GROUP BY 1`, [from]), []),
    safe(C().query(SNAP, [['eligibility_deny_rate', 'semati_provider_error_rate', 'otp_verify_rate', 'api_technical_fail_rate']]), []),
  ]);

  // ---- day axis from rollups
  const agg = {}; for (const r of roll) { const d = agg[r.day] || (agg[r.day] = {}); const key = `${r.journey}:${r.outcome}`; d[key] = (d[key] || 0) + n(r.c); }
  const ed = {}; for (const r of errDays) ed[r.day] = n(r.n);
  const g = (d, j, o) => (agg[d] && agg[d][`${j}:${o}`]) || 0;
  const daysArr = dayAxis(now, days).map(d => ({ day: d,
    orders: g(d, 'onboarding', 'total') || g(d, 'onboarding', 'ok') + g(d, 'onboarding', 'fail'),
    paidOk: g(d, 'payment', 'ok'), paidFail: g(d, 'payment', 'fail'),
    actOk: g(d, 'activation', 'ok') + g(d, 'semati', 'ok'), actFail: g(d, 'activation', 'fail') + g(d, 'semati', 'fail'),
    nafOk: g(d, 'nafath', 'ok'), deliveries: g(d, 'delivery', 'total') || g(d, 'delivery', 'ok'),
    journeyFail: Object.entries(agg[d] || {}).filter(([k]) => k.endsWith(':fail')).reduce((a, [, v]) => a + v, 0),
    errors: ed[d] || 0 }));

  // ---- 24 h KPIs = the Dashboard's numbers
  const p = h.prev || {}, t = h.targets || { payment: 0.95, activation: 0.98 };
  const errors24 = n((err24[0] || {}).n);
  const dOrders = delta(n(h.orders), n(p.orders)), dAct = delta(n(h.actOk), n(p.actOk)), dPay = delta(n(h.paidOk), n(p.paidOk));
  const payOk = h.payRate == null || h.payRate >= t.payment, actOk = h.actRate == null || h.actRate >= t.activation;
  const nafTotal = n(h.nafOk) + n(h.nafFailed), nafRate = nafTotal ? n(h.nafOk) / nafTotal : null;

  // ---- pipeline = onboarding funnel (24 h)
  const funnel = [['Orders', n(h.orders)], ['Checkouts', n(h.checkouts)], ['Paid', n(h.paidOk)], ['Activated (BSS)', n(h.actOk)], ['Nafath completed', n(h.nafOk)], ['Deliveries', n(h.deliveries)]];
  const top = funnel[0][1] || 1;
  const pipelineRows = funnel.map(([label, v], i) => ({ step: label, label, n: v, share: pct(v, top), tone: i === 0 ? 'green' : v < funnel[i - 1][1] * 0.5 && funnel[i - 1][1] > 20 ? 'amber' : 'blue' }));

  // ---- issues: technical categories from the app error log
  const catKey = r => `${r.category} ${r.error_code == null ? '' : r.error_code}`.trim();
  const cd = {}; for (const r of errCatDays) (cd[catKey(r)] = cd[catKey(r)] || {})[r.day] = n(r.n);
  const issues = errCats.map(c => { const key = catKey(c); const spark = daysArr.map(d => (cd[key] || {})[d.day] || 0); const last2 = spark.slice(-2).reduce((a, b) => a + b, 0);
    return { category: key, label: `${c.category}${c.error_code == null ? '' : ' · ' + c.error_code}`, open: last2, total: n(c.total), first_seen: c.first_seen, daysOngoing: Math.max(1, Math.round((now.getTime() - new Date(c.first_seen)) / D)), trend: trendOf(spark), spark, sev: sevOf(last2), href: `#troubleshoot?cls=technical` }; });

  // ---- alerts
  const sev = { P1: 0, P2: 0, P3: 0 }; for (const a of alerts) sev[a.severity] = (sev[a.severity] || 0) + 1;
  const open = alerts.filter(a => a.status === 'open');
  const alerts24 = alerts.filter(a => new Date(a.fired_at) >= new Date(from24)).length;

  // ---- SLOs
  const sn = Object.fromEntries(snaps.map(s => [s.metric_key, s]));
  const snapVal = k => sn[k] ? n(sn[k].value) : null;
  const elig = snapVal('eligibility_deny_rate'), sem = snapVal('semati_provider_error_rate'), otp = snapVal('otp_verify_rate');
  const slos = [
    { key: 'payment', name: 'Payment success', actual: fmtRate(h.payRate), target: `≥ ${Math.round(t.payment * 100)}%`, ok: payOk, measured: h.payRate != null, href: '#troubleshoot?cat=payment' },
    { key: 'activation', name: 'Activation success', actual: fmtRate(h.actRate), target: `≥ ${Math.round(t.activation * 100)}%`, ok: actOk, measured: h.actRate != null, href: '#troubleshoot?cat=activation' },
    { key: 'nafath', name: 'Nafath completion', actual: fmtRate(nafRate), target: '≥ 90%', ok: nafRate == null || nafRate >= 0.9, measured: nafRate != null, href: '#troubleshoot?cat=nafath' },
    { key: 'error_budget', name: 'Technical error budget', actual: `${errors24} / 24 h`, target: `≤ ${bud} / day`, ok: errors24 <= bud, measured: true, href: '#troubleshoot?cls=technical' },
    { key: 'semati', name: 'Semati provider errors', actual: sem == null ? '—' : `${Math.round(sem * 1000) / 10}%`, target: '≤ 5%', ok: sem == null || sem <= 0.05, measured: sem != null, href: '#alerts' },
    { key: 'eligibility', name: 'CITC eligibility denials', actual: elig == null ? '—' : `${Math.round(elig * 1000) / 10}%`, target: '≤ 50% (business, not a fault)', ok: elig == null || elig <= 0.5, measured: elig != null, href: '#alerts' },
  ];

  // ---- status + summary
  const critical = sev.P1 + (errors24 > bud ? 1 : 0) + (!payOk ? 1 : 0) + (!actOk ? 1 : 0);
  const warnings = open.filter(a => a.severity === 'P2').length + slos.filter(s => s.measured && s.ok === false && !['error_budget', 'payment', 'activation'].includes(s.key)).length;
  const status = K.statusOf(critical, warnings);
  const summary = [];
  if (critical) summary.push(`${critical} critical signal(s): ${[sev.P1 ? `${sev.P1} P1 alert(s)` : null, errors24 > bud ? `technical errors ${errors24} above the ${bud}/day budget` : null, !payOk ? `payment success ${fmtRate(h.payRate)} below target` : null, !actOk ? `activation success ${fmtRate(h.actRate)} below target` : null].filter(Boolean).join(', ')}.`);
  else summary.push(`No critical signal in the last 24 h${warnings ? `; ${warnings} warning(s) to watch` : ''}.`);
  summary.push(`${n(h.orders).toLocaleString('en-US')} orders in 24 h (${dOrders >= 0 ? '+' : ''}${dOrders}% vs the previous 24 h), ${n(h.paidOk).toLocaleString('en-US')} paid at ${fmtRate(h.payRate)}, ${n(h.actOk).toLocaleString('en-US')} activated at ${fmtRate(h.actRate)}.`);
  const worst = issues[0]; summary.push(worst ? `Busiest technical error: ${worst.label} (${worst.total} in ${days} d, ${worst.trend}).` : 'No technical error in the app error log for the window.');

  return {
    configured: true, biz: 'mobile', label: 'Mobile', generatedAt: nowIso, range, days, window: { from, to },
    source: h.source === 'raw' ? 'salam_replica + console rollups' : h.source, freshness: { text: `dashboard clock ${dayKey(now)}`, stale: false },
    provisional: 'Revenue is not measured by this console — shown as not wired',
    status, summary, counts: { critical, warnings, alerts24, bySeverity: sev },
    kpis: [
      { key: 'orders', title: 'Orders', value: n(h.orders), sub: `${n(h.checkouts).toLocaleString('en-US')} checkouts · new SIM + MNP`, tone: 'green', delta: { pct: dOrders, good: dOrders >= 0 }, href: '#dashboard', exec: true, window: '24 h' },
      { key: 'payments', title: 'Payment success', value: fmtRate(h.payRate), sub: `${n(h.paidOk).toLocaleString('en-US')} paid · ${n(h.paidFail).toLocaleString('en-US')} failed`, tone: payOk ? 'green' : 'red', delta: { pct: dPay, good: dPay >= 0 }, href: '#troubleshoot?cat=payment', exec: true, window: '24 h' },
      { key: 'activations', title: 'Activation success', value: fmtRate(h.actRate), sub: `${n(h.actOk).toLocaleString('en-US')} activated · ${n(h.actFail).toLocaleString('en-US')} failed`, tone: actOk ? 'green' : 'red', delta: { pct: dAct, good: dAct >= 0 }, href: '#troubleshoot?cat=activation', exec: true, window: '24 h' },
      { key: 'errors', title: 'Technical errors', value: errors24, sub: `budget ${bud}/day — ${errors24 > bud ? 'exceeded' : 'within budget'} · ${n(h.errorsBusiness).toLocaleString('en-US')} business refusals`, tone: errors24 > bud ? 'red' : 'green', delta: null, href: '#troubleshoot?cls=technical', exec: true, window: '24 h' },
      { key: 'critical', title: 'Active critical signals', value: critical, sub: `${open.length} open alert(s) · ${sev.P1} P1 · ${sev.P2} P2 · ${sev.P3} P3`, tone: critical ? 'red' : 'green', delta: null, href: '#alerts', exec: true, window: `${days} d` },
      { key: 'revenue', title: 'Daily revenue', value: '—', sub: 'connect the billing feed to activate', tone: 'muted', delta: null, href: null, exec: true, window: '24 h' },
      { key: 'nafath', title: 'Nafath completed', value: n(h.nafOk), sub: `${n(h.nafFailed).toLocaleString('en-US')} failed · ${n(h.nafPending).toLocaleString('en-US')} pending`, tone: null, delta: null, href: '#troubleshoot?cat=nafath', exec: false, window: '24 h' },
      { key: 'deliveries', title: 'Deliveries', value: n(h.deliveries), sub: 'courier requests created', tone: null, delta: null, href: '#troubleshoot?cat=delivery', exec: false, window: '24 h' },
    ],
    slos,
    health: [
      { label: 'Payments', value: fmtRate(h.payRate), state: h.payRate == null ? 'nowire' : payOk ? 'up' : 'down', sub: `target ${Math.round(t.payment * 100)}%`, href: '#troubleshoot?cat=payment' },
      { label: 'Activations (BSS)', value: fmtRate(h.actRate), state: h.actRate == null ? 'nowire' : actOk ? 'up' : 'down', sub: `target ${Math.round(t.activation * 100)}%`, href: '#troubleshoot?cat=activation' },
      { label: 'Nafath', value: fmtRate(nafRate), state: nafRate == null ? 'nowire' : nafRate >= 0.9 ? 'up' : 'warn', sub: `${nafTotal.toLocaleString('en-US')} checks`, href: '#troubleshoot?cat=nafath' },
      { label: 'Semati provider', value: sem == null ? '—' : `${Math.round(sem * 1000) / 10}% errors`, state: sem == null ? 'nowire' : sem <= 0.05 ? 'up' : 'down', sub: sn.semati_provider_error_rate ? `snapshot ${dayKey(sn.semati_provider_error_rate.sim_now)}` : 'no snapshot', href: '#monitoring' },
      { label: 'OTP verification', value: otp == null ? '—' : `${Math.round(otp * 1000) / 10}%`, state: otp == null ? 'nowire' : otp >= 0.7 ? 'up' : 'warn', sub: 'SMS OTPs verified', href: '#monitoring' },
      { label: 'Change plan', value: `${n(h.planOk).toLocaleString('en-US')} ok · ${n(h.planFail).toLocaleString('en-US')} fail`, state: n(h.planFail) > n(h.planOk) ? 'down' : 'up', sub: '24 h', href: '#troubleshoot?cat=change_plan' },
    ],
    series: { days: daysArr, charts: [
      { key: 'orders', title: 'Orders', type: 'line', field: 'orders', color: 'green', exec: true },
      { key: 'errors', title: 'Technical errors vs budget', type: 'bar', field: 'errors', color: 'auto', threshold: bud, thresholdLabel: `budget ${bud}/day`, exec: true },
      { key: 'paidOk', title: 'Payments OK', type: 'line', field: 'paidOk', color: 'blue', exec: false },
      { key: 'actOk', title: 'Activations OK', type: 'line', field: 'actOk', color: 'green', exec: false },
      { key: 'journeyFail', title: 'Journey failures (all steps)', type: 'bar', field: 'journeyFail', color: 'amber', exec: false },
      { key: 'deliveries', title: 'Deliveries', type: 'line', field: 'deliveries', color: 'blue', exec: false },
    ] },
    pipeline: { title: 'Onboarding funnel — 24 h', sub: 'orders → checkouts → paid → activated → Nafath → delivery', rows: pipelineRows, href: '#dashboard' },
    issues,
    radar: K.radarOf(radarRows, daysArr.map(d => d.day), radarTot),
    alerts: alerts.slice(0, 12).map(a => ({ severity: a.severity, name: a.name, text: a.message || (a.observed_value != null ? `${a.observed_value} vs ${a.threshold}` : ''), team: a.team, at: a.fired_at, href: '#alerts', status: a.status })),
  };
}

function mount(app, deps) {
  const gate = deps.requireView ? deps.requireView('dashboard') : (req, res, next) => next();
  app.get('/api/mvno/exec', gate, async (req, res) => { try { res.json(await exec(req.query, deps)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
}
module.exports = { mount, exec };
