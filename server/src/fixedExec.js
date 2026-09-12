/* fixedExec.js — Fixed › Executive + Operations data, in the execContract shape.
 *
 *   GET /api/fixed/exec?range=7d|30d        (gate: view 'fixed')
 *
 * The "Fixed Operations AI Agent" produced two static pages hard-coded to 2026-06-21; this is the same
 * story read live from the read models:
 *   orders & conversion   order_attempts (sda_ops public + beta) via fixed360.summary — 24 h, the previous
 *                         24 h for deltas, N days for the trends
 *   pipeline / pileup     order_attempts.step_reached for every attempt that did not COMPLETE
 *   API errors + budget   error_events, both schemas; the /day budget is the fixed_error_spike rule threshold
 *   alerts                alert_events FIRED in the window (sda_ops.public)
 *   top ongoing issues    error_events by category: open, first seen, per-day sparkline, trend
 * SADAD / SFTP / revenue have NO feed in this console — reported as "not wired", never as a green tick.
 * Read-only; nothing here writes. */
const db = require('./db');
const f360 = require('./fixed360');
const K = require('./execContract');
const { n, pct, delta, dayKey, dayAxis, trendOf, sevOf, humanStep } = K;

const ERR_DAY = `SELECT (date_trunc('day', occurred_at AT TIME ZONE 'Asia/Riyadh'))::date::text AS day,
                        count(*)::int AS n, count(*) FILTER (WHERE NOT resolved)::int AS open
                   FROM error_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY 1 ORDER BY 1`;
const ERR_CAT = `SELECT category, count(*)::int AS total, count(*) FILTER (WHERE NOT resolved)::int AS open,
                        min(occurred_at) AS first_seen, max(occurred_at) AS last_seen
                   FROM error_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY 1 ORDER BY open DESC, total DESC LIMIT 10`;
const ERR_CAT_DAY = `SELECT category, (date_trunc('day', occurred_at AT TIME ZONE 'Asia/Riyadh'))::date::text AS day, count(*)::int AS n
                       FROM error_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY 1,2`;
const ERR_24 = `SELECT count(*)::int AS n FROM error_events WHERE occurred_at >= $1`;
const STEPS = `SELECT oa.channel, oa.step_reached AS step, oa.outcome::text AS outcome, count(*)::int AS n
                 FROM order_attempts oa WHERE oa.started_at >= $1 AND oa.started_at < $2 AND oa.outcome <> 'COMPLETED'
                GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 60`;

const pools = () => [...new Set([db.ops, db.opsBeta].filter(Boolean))];
const both = async (sql, params) => (await Promise.all(pools().map(p => p.query(sql, params).then(r => r.rows, () => [])))).flat();
async function errorBudget() {
  try { const r = await db.ops.query(`SELECT threshold FROM alert_rules WHERE key='fixed_error_spike' AND enabled LIMIT 1`); const t = n((r.rows[0] || {}).threshold); return t > 0 ? t : 50; }
  catch (_) { return 50; }
}
async function alertsByDay(fromIso) {
  try { return (await db.ops.query(`SELECT (date_trunc('day', fired_at AT TIME ZONE 'Asia/Riyadh'))::date::text AS day, severity, count(*)::int AS n
                                     FROM alert_events WHERE status='FIRED' AND fired_at >= $1 GROUP BY 1,2`, [fromIso])).rows; }
  catch (_) { return []; }
}
async function firedAlerts(fromIso) {
  try { return (await db.ops.query(`SELECT rule_key, rule_name, team, severity, metric_value, threshold, metric_text, fired_at
                                     FROM alert_events WHERE status='FIRED' AND fired_at >= $1 ORDER BY fired_at DESC LIMIT 50`, [fromIso])).rows; }
  catch (_) { return []; }
}

async function exec(q = {}) {
  if (!db.ops && !db.opsBeta) return { configured: false, biz: 'fixed', label: 'Fixed', reason: 'OPS_DATABASE_URL / OPS_BETA_DATABASE_URL not set' };
  const range = K.rangeOf(q), days = range === '30d' ? 30 : 7;
  const now = new Date(), D = 864e5;
  const to = now.toISOString(), from = new Date(now - days * D).toISOString();
  const from24 = new Date(now - D).toISOString(), from48 = new Date(now - 2 * D).toISOString();

  const [today, prev, series, errDaysRaw, errCats, errCatDays, steps, budget, alerts, err24rows] = await Promise.all([
    f360.summary({ range: '24h' }), f360.summary({ from: from48, to: from24 }), f360.summary({ range }),
    both(ERR_DAY, [from, to]), both(ERR_CAT, [from, to]), both(ERR_CAT_DAY, [from, to]), both(STEPS, [from, to]),
    errorBudget(), firedAlerts(from), both(ERR_24, [from24]),
  ]);
  const radarRows = await alertsByDay(from);

  // ---- day axis
  const byDay = {}; for (const r of series.byDay || []) byDay[dayKey(r.day)] = { n: n(r.n), completed: n(r.completed) };
  const errDays = {}; for (const r of errDaysRaw) { const k = errDays[r.day] || (errDays[r.day] = { n: 0, open: 0 }); k.n += n(r.n); k.open += n(r.open); }
  const daysArr = dayAxis(now, days).map(k => ({ day: k, orders: (byDay[k] || {}).n || 0, completed: (byDay[k] || {}).completed || 0, errors: (errDays[k] || {}).n || 0, openErrors: (errDays[k] || {}).open || 0 }));

  // ---- 24 h KPIs
  const k = today.kpis || {}, kp = prev.kpis || {};
  const outcomes = Object.fromEntries((today.outcomes || []).map(o => [o.outcome, n(o.n)]));
  const errors24 = err24rows.reduce((a, r) => a + n(r.n), 0);
  const conv7 = pct(n((series.kpis || {}).completed), n((series.kpis || {}).attempts));
  const convFloor = Math.max(0, conv7 - 5);

  // ---- pipeline
  const stepMap = {}; for (const s of steps) { const key = s.step || '(no step)'; const x = stepMap[key] || (stepMap[key] = { step: key, n: 0 }); x.n += n(s.n); }
  const notDone = Object.values(stepMap).reduce((a, s) => a + s.n, 0);
  const pipelineRows = Object.values(stepMap).sort((a, b) => b.n - a.n).slice(0, 18).map(s => ({ step: s.step, label: humanStep(s.step), n: s.n, share: pct(s.n, notDone), tone: s.n >= 1000 ? 'red' : s.n >= 500 ? 'amber' : 'blue' }));
  const pileup = pipelineRows.find(p => /CustomerProfile$/i.test(p.step)) || pipelineRows[0] || null;

  // ---- issues
  const catDays = {}; for (const r of errCatDays) { (catDays[r.category] = catDays[r.category] || {})[r.day] = (catDays[r.category][r.day] || 0) + n(r.n); }
  const merged = {}; for (const c of errCats) { const x = merged[c.category] || (merged[c.category] = { category: c.category, total: 0, open: 0, first_seen: c.first_seen, last_seen: c.last_seen }); x.total += n(c.total); x.open += n(c.open); if (c.first_seen < x.first_seen) x.first_seen = c.first_seen; }
  const issues = Object.values(merged).sort((a, b) => b.open - a.open || b.total - a.total).slice(0, 8).map(c => {
    const spark = daysArr.map(d => (catDays[c.category] || {})[d.day] || 0);
    return { category: c.category, label: c.category, open: c.open, total: c.total, first_seen: c.first_seen, daysOngoing: Math.max(1, Math.round((now - new Date(c.first_seen)) / D)), trend: trendOf(spark), spark, sev: sevOf(c.open), href: '#fixed?tab=errors' };
  });

  // ---- alerts
  const sev = { P1: 0, P2: 0, P3: 0 }; for (const a of alerts) sev[a.severity] = (sev[a.severity] || 0) + 1;
  const alerts24 = alerts.filter(a => new Date(a.fired_at) >= new Date(from24)).length;

  // ---- SLOs (measured ones from data; unmeasured ones honestly marked)
  const naf = (today.integrations || {}).nafath || {}, man = (today.integrations || {}).manafith || {};
  const slos = [
    { key: 'error_budget', name: 'API error budget', actual: `${errors24} / 24 h`, target: `≤ ${budget} / day`, ok: errors24 <= budget, measured: true, href: '#fixed?tab=errors' },
    { key: 'conversion', name: 'Order conversion', actual: `${n(k.conversion)}%`, target: `≥ ${convFloor}% (${days}-day avg − 5 pp)`, ok: n(k.conversion) >= convFloor, measured: n(k.attempts) > 0, href: '#fixed?tab=dash' },
    { key: 'nafath', name: 'Nafath failure rate', actual: naf.total ? `${naf.failRate}%` : '—', target: '≤ 25%', ok: !naf.total || naf.failRate <= 25, measured: !!naf.total, href: '#fixed?tab=dash' },
    { key: 'manafith', name: 'Manafith denials', actual: man.total ? `${man.deniedRate}%` : '—', target: '≤ 10%', ok: !man.total || man.deniedRate <= 10, measured: !!man.total, href: '#fixed?tab=dash' },
    { key: 'sadad', name: 'SADAD availability', actual: '—', target: 'UP · ≤ 500 ms', ok: null, measured: false, note: 'no SADAD probe is wired into this console' },
    { key: 'sftp', name: 'SFTP ODB sync', actual: '—', target: 'SUCCESS daily', ok: null, measured: false, note: 'no SFTP job feed is wired into this console' },
  ];

  // ---- status + summary
  const critical = sev.P1 + (errors24 > budget ? 1 : 0) + (pileup && pileup.n >= 1000 ? 1 : 0);
  const warnings = sev.P2 + slos.filter(s => s.measured && s.ok === false && s.key !== 'error_budget').length;
  const status = K.statusOf(critical, warnings);
  const summary = [];
  if (critical) summary.push(`${critical} critical signal(s): ${[sev.P1 ? `${sev.P1} P1 alert(s) fired` : null, errors24 > budget ? `API errors ${errors24} above the ${budget}/day budget` : null, pileup && pileup.n >= 1000 ? `${pileup.n} attempts sitting at ${pileup.label}` : null].filter(Boolean).join(', ')}.`);
  else summary.push(`No critical signal in the last 24 h${warnings ? `; ${warnings} warning(s) to watch` : ''}.`);
  const dA = delta(n(k.attempts), n(kp.attempts));
  summary.push(`${n(k.attempts).toLocaleString('en-US')} order attempts in 24 h (${dA >= 0 ? '+' : ''}${dA}% vs the previous 24 h), ${n(k.completed).toLocaleString('en-US')} completed — ${n(k.conversion)}% conversion against a ${conv7}% ${days}-day average.`);
  const worst = issues[0]; summary.push(worst ? `Largest open error category: ${worst.category} (${worst.open} open, ${worst.trend}, ${worst.daysOngoing} d ongoing).` : 'No open Fixed error category in the window.');

  const fr = today.freshness || {};
  return {
    configured: true, biz: 'fixed', label: 'Fixed', generatedAt: now.toISOString(), range, days, window: { from, to },
    source: today.source, freshness: { text: fr.newest_attempt ? `newest attempt ${dayKey(fr.newest_attempt)} · watcher lag ${fr.lag_min == null ? '?' : fr.lag_min + ' min'}` : 'read model freshness unknown', stale: !!fr.stale },
    provisional: 'SADAD, SFTP and revenue are not measured by this console — shown as not wired',
    status, summary, counts: { critical, warnings, alerts24, bySeverity: sev },
    kpis: [
      { key: 'availability', title: 'Service availability', value: '—', sub: 'SADAD / SFTP probes not wired — not measured', tone: 'muted', delta: null, href: null, exec: true, window: '24 h' },
      { key: 'attempts', title: 'Order attempts', value: n(k.attempts), sub: `${n(k.completed).toLocaleString('en-US')} completed · ${n(k.withOrder).toLocaleString('en-US')} with a BSS order`, tone: 'green', delta: { pct: dA, good: dA >= 0 }, href: '#fixed?tab=dash', exec: true, window: '24 h' },
      { key: 'conversion', title: 'Order funnel health', value: `${n(k.conversion)}%`, sub: `${(n(outcomes.STALLED) + n(outcomes.IN_PROGRESS)).toLocaleString('en-US')} stalled / in progress · ${conv7}% ${days}-day avg`, tone: n(k.conversion) < convFloor ? 'red' : 'green', delta: null, href: '#fixed?tab=dash', exec: true, window: '24 h' },
      { key: 'errors', title: 'API errors', value: errors24, sub: `budget ${budget}/day — ${errors24 > budget ? 'exceeded' : 'within budget'}`, tone: errors24 > budget ? 'red' : 'green', delta: null, href: '#fixed?tab=errors', exec: true, window: '24 h' },
      { key: 'critical', title: 'Active critical signals', value: critical, sub: `${sev.P1} P1 · ${sev.P2} P2 · ${sev.P3} P3 fired in ${days} d`, tone: critical ? 'red' : 'green', delta: null, href: '#fixed?tab=alerts', exec: true, window: `${days} d` },
      { key: 'revenue', title: 'Daily revenue', value: '—', sub: 'connect the billing feed to activate', tone: 'muted', delta: null, href: null, exec: true, window: '24 h' },
      { key: 'pileup', title: 'Order pileup', value: pileup ? pileup.n : 0, sub: pileup ? `${pileup.label} · ${pileup.share}% of not-completed` : 'no step is accumulating', tone: pileup && pileup.n >= 1000 ? 'red' : pileup && pileup.n >= 500 ? 'amber' : null, delta: null, href: '#fixed?tab=epurchase', exec: false, window: `${days} d` },
      { key: 'dealers', title: 'Active dealers', value: n(k.activeDealers), sub: 'SDA staff who attempted an order', tone: null, delta: null, href: '#fixed?tab=map', exec: false, window: '24 h' },
    ],
    slos,
    health: [
      { label: 'Read model', value: fr.newest_attempt ? dayKey(fr.newest_attempt) : '—', state: fr.stale ? 'warn' : 'up', sub: fr.lag_min == null ? 'watcher lag unknown' : `watcher lag ${fr.lag_min} min`, href: '#fixed?tab=overview' },
      { label: 'Nafath', value: naf.total ? `${naf.failRate}% fail` : '—', state: !naf.total ? 'nowire' : naf.failRate <= 25 ? 'up' : 'down', sub: `${n(naf.total).toLocaleString('en-US')} 5G checks`, href: '#fixed?tab=dash' },
      { label: 'Manafith', value: man.total ? `${man.deniedRate}% denied` : '—', state: !man.total ? 'nowire' : man.deniedRate <= 10 ? 'up' : 'down', sub: `${n(man.denied).toLocaleString('en-US')} of ${n(man.total).toLocaleString('en-US')}`, href: '#fixed?tab=dash' },
      ...(series.byChannel || []).map(c => ({ label: `Channel · ${c.channel}`, value: `${n(c.n).toLocaleString('en-US')} · ${c.conversion}%`, state: 'up', sub: `attempts · conversion, ${days} d`, href: `#fixed?tab=${c.channel === 'sda' ? 'map' : c.channel === 'epurchase' ? 'epurchase' : 'salamhome'}` })),
      { label: 'SADAD', value: 'not wired', state: 'nowire', sub: 'no probe in this console' },
      { label: 'SFTP ODB sync', value: 'not wired', state: 'nowire', sub: 'no job feed in this console' },
    ],
    series: { days: daysArr, charts: [
      { key: 'orders', title: 'Order attempts', type: 'line', field: 'orders', color: 'green', exec: true },
      { key: 'errors', title: 'API errors vs budget', type: 'bar', field: 'errors', color: 'auto', threshold: budget, thresholdLabel: `budget ${budget}/day`, exec: true },
      { key: 'completed', title: 'Completed orders', type: 'line', field: 'completed', color: 'blue', exec: false },
      { key: 'openErrors', title: 'Still-open errors by day', type: 'bar', field: 'openErrors', color: 'amber', exec: false },
    ] },
    pipeline: { title: 'Order pipeline — where not-completed attempts stopped', sub: `${notDone.toLocaleString('en-US')} attempts in ${days} d did not complete`, rows: pipelineRows, href: '#fixed?tab=epurchase' },
    issues,
    radar: K.radarOf(radarRows, daysArr.map(d => d.day)),
    alerts: alerts.slice(0, 12).map(a => ({ severity: a.severity, name: a.rule_name || a.rule_key, text: a.metric_text || (a.metric_value != null ? `${a.metric_value} vs ${a.threshold}` : ''), team: a.team, at: a.fired_at, href: '#fixed-alerts', status: 'fired' })),
  };
}

function mount(app, { requireView } = {}) {
  const gate = requireView ? requireView('fixed') : (req, res, next) => next();
  app.get('/api/fixed/exec', gate, async (req, res) => { try { res.json(await exec(req.query)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
}
module.exports = { mount, exec };
