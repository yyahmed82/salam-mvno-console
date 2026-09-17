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
 *   alerts                unified_console.alerts, segment 'fixed' (the console's own fixed_* rules — same rows as Fixed › Alerts)
 *   top ongoing issues    error_events by category: open, first seen, per-day sparkline, trend
 * SADAD / SFTP / revenue have NO feed in this console — reported as "not wired", never as a green tick.
 * Read-only; nothing here writes. */
const db = require('./db');
const f360 = require('./fixed360');
const K = require('./execContract');
const slo = require('./slo');
const segment = require('./segment');
const execRadar = require('./execRadar');
const { n, pct, delta, dayKey, dayAxis, trendOf, sevOf, humanStep } = K;

const ERR_DAY = `SELECT (date_trunc('day', occurred_at AT TIME ZONE 'Asia/Riyadh'))::date::text AS day,
                        count(*)::int AS n, count(*) FILTER (WHERE NOT resolved)::int AS open
                   FROM error_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY 1 ORDER BY 1`;
const ERR_CAT = `SELECT category, count(*)::int AS total, count(*) FILTER (WHERE NOT resolved)::int AS open,
                        min(occurred_at) AS first_seen, max(occurred_at) AS last_seen
                   FROM error_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY 1 ORDER BY open DESC, total DESC LIMIT 10`;
const ERR_CAT_DAY = `SELECT category, (date_trunc('day', occurred_at AT TIME ZONE 'Asia/Riyadh'))::date::text AS day, count(*)::int AS n
                       FROM error_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY 1,2`;
/* business / technical split — the same CLASS_EXPR as the Troubleshoot board (fixedErrors.js), so the KPI and the board agree */
const CLASS_SQL = () => require('./fixedErrors').CLASS_SQL();
const ERR_24 = () => `SELECT count(*)::int AS n, count(*) FILTER (WHERE ${CLASS_SQL()} = 'technical')::int AS tech FROM error_events e WHERE e.occurred_at >= $1`;
const STEPS = `SELECT oa.channel, oa.step_reached AS step, oa.outcome::text AS outcome, count(*)::int AS n
                 FROM order_attempts oa WHERE oa.started_at >= $1 AND oa.started_at < $2 AND oa.outcome <> 'COMPLETED'
                GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 60`;

/* ---- identity verification ① Absher OTP (from sda_ops api_calls) -------------------------------
 * The DRM pair  sendAbsherValidateCode (send the OTP to the Absher-registered mobile)  and
 * checkValidateCode (the customer typing the OTP = user correctness, NOT a provider fault). Every call is
 * HTTP 200; a failure is error_class='DRM' with the reason in error_msg. Read from sda_ops.public ONLY: the
 * beta read model runs with api_logs ingest off (its api_calls stop on 2026-09-04).
 * CORRECTION 15 Sep 2026: this pair is NOT Yakeen. Yakeen is the ELM NIC-record check (getYakeenInfo under
 * sda.actions.validateIndividualCustomer) — it never reaches api_calls, it lives only in the app's
 * combined.log, which fixedAppLogCollector.js now tails into unified_console.fixed_app_events → ② below. */
const IDENT_SRC = () => db.ops || db.opsBeta;
const IDENT_FAIL = `(ac.status >= 400 OR ac.error_class IS NOT NULL)`;
const IDENT_OP = `CASE WHEN ac.endpoint ~* 'sendAbsherValidateCode' THEN 'send' WHEN ac.endpoint ~* 'checkValidateCode' THEN 'verify' END`;
const IDENT_DAY = `SELECT (date_trunc('day', ac.created_at AT TIME ZONE 'Asia/Riyadh'))::date::text AS day, ${IDENT_OP} AS op,
                          count(*)::int AS calls, count(*) FILTER (WHERE ${IDENT_FAIL})::int AS failed
                     FROM api_calls ac WHERE ac.created_at >= $1 AND ac.created_at < $2
                      AND ac.endpoint ~* '(sendAbsherValidateCode|checkValidateCode)' GROUP BY 1,2`;
const IDENT_CAT = `SELECT ${IDENT_OP} AS op,
                          left(regexp_replace(coalesce(nullif(ac.error_msg,''), ac.error_class, 'HTTP '||ac.status::text), '[0-9]+', '#', 'g'), 90) AS reason,
                          count(*)::int AS n, max(ac.created_at) AS last_at
                     FROM api_calls ac WHERE ac.created_at >= $1 AND ac.created_at < $2 AND ${IDENT_FAIL}
                      AND ac.endpoint ~* '(sendAbsherValidateCode|checkValidateCode)' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 14`;
const IDENT_LAST = `SELECT max(ac.created_at) AS last_at FROM api_calls ac WHERE ac.endpoint ~* 'sendAbsherValidateCode'`;
const identity = async (from, to) => {
  const P = IDENT_SRC(); if (!P) return { days: [], cats: [], lastAt: null, source: null };
  const q = (sql, params) => P.query(sql, params).then(r => r.rows, e => { console.error('[fixedExec] identity query failed:', e.message); return []; });
  const [days, cats, last] = await Promise.all([q(IDENT_DAY, [from, to]), q(IDENT_CAT, [from, to]), q(IDENT_LAST, [])]);
  return { days, cats, lastAt: (last[0] || {}).last_at || null, source: P === db.ops ? 'sda_ops.public' : 'sda_ops.beta' };
};


/* ---- identity verification ② Yakeen / ELM (from unified_console.fixed_app_events) ------------------
 * kind='yakeen' = one getYakeenInfo response line; ok = no `error` object on the line (the success shape has
 * not been seen in the incident thread, only failures — stated on the chart). reason_class tells a provider
 * refusal (business: "inputs does not match NIC records", statusCode 400) from an ELM outage (technical:
 * 504 Gateway Time-out, as on 7 Jul 2026). A day with no calls carries null, never 0. */
const YAK_DAY = `SELECT (date_trunc('day', ts AT TIME ZONE 'Asia/Riyadh'))::date::text AS day,
                        count(*)::int AS calls, count(*) FILTER (WHERE ok IS NOT TRUE)::int AS failed,
                        count(*) FILTER (WHERE ok IS NOT TRUE AND reason_class='technical')::int AS technical
                   FROM fixed_app_events WHERE kind='yakeen' AND ts >= $1 AND ts < $2 GROUP BY 1`;
const YAK_CAT = `SELECT coalesce(reason_class,'unknown') AS cls, coalesce(status_code::text,'') AS status,
                        left(regexp_replace(coalesce(nullif(reason,''), message, 'no reason'), '[0-9]+', '#', 'g'), 90) AS reason,
                        count(*)::int AS n, max(ts) AS last_at
                   FROM fixed_app_events WHERE kind IN ('yakeen','yakeen_address') AND ok IS NOT TRUE AND ts >= $1 AND ts < $2
                  GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 14`;
const YAK_LAST = `SELECT max(ts) AS last_at, count(*)::bigint AS n FROM fixed_app_events WHERE kind='yakeen'`;
const yakeen = async (from, to) => {
  const q = (sql, params) => db.console.query(sql, params).then(r => r.rows, e => { if (!/does not exist/.test(e.message)) console.error('[fixedExec] yakeen query failed:', e.message); return []; });
  const [days, cats, last] = await Promise.all([q(YAK_DAY, [from, to]), q(YAK_CAT, [from, to]), q(YAK_LAST, [])]);
  let col = null; try { col = require('./fixedAppLogCollector').status(); } catch (_) {}
  return { days, cats, lastAt: (last[0] || {}).last_at || null, total: Number((last[0] || {}).n || 0), configured: !!(col && col.configured), logPath: col ? col.logPath : null };
};

const pools = () => [...new Set([db.ops, db.opsBeta].filter(Boolean))];
const both = async (sql, params) => (await Promise.all(pools().map(p => p.query(sql, params).then(r => r.rows, () => [])))).flat();
async function errorBudget() {
  try {
    const cfg = await slo.getConfig();
    const t = slo.targetNumber(slo.findDef(cfg, 'fixed_api_error_budget'), {}, null);
    if (n(t) > 0) return n(t);
  } catch (_) {}
  try { const r = await db.ops.query(`SELECT threshold FROM alert_rules WHERE key='fixed_error_spike' AND enabled LIMIT 1`); const t = n((r.rows[0] || {}).threshold); return t > 0 ? t : 50; }
  catch (_) { return 50; }
}
/* Alerts: the unified console's OWN engine — `alerts` in unified_console, segment 'fixed' (fixed_* rules
 * evaluated by alertRunner over metric_snapshots). This is exactly what Fixed › Alerts lists, so the radar,
 * the "Active critical signals" tile and the alert feed agree with that page. The old prod engine's
 * evaluation log (sda_ops.alert_events) is NOT read here any more: it records one row per evaluation with
 * no incident identity, so its rules never matched the console's incidents (radar read "Fixed 0 / 0" while
 * Fixed › Alerts showed 12 open — 16 Sep 2026). The radar face (12-hour clock) comes from execRadar.radarRows('fixed'),
 * the same query Mobile uses. */
const SEG_WHERE = () => segment.sqlWhere('a', 'rule_key', 'fixed');
const cq = (sql, params) => db.console.query(sql, params).then(r => r.rows, e => { console.error('[fixedExec] alerts query failed:', e.message); return []; });
async function firedAlerts(fromIso) {
  return cq(`SELECT a.rule_key, a.name AS rule_name, a.team, a.severity, a.status, a.observed_value AS metric_value,
                    a.threshold, a.message AS metric_text, a.fired_at
               FROM alerts a WHERE ${SEG_WHERE()} AND (a.status='open' OR a.fired_at >= $1)
              ORDER BY a.status='open' DESC, a.fired_at DESC LIMIT 50`, [fromIso]);
}

/* MEMO (16 Sep 2026): the executive query set (~13 scans of error_events / order_attempts on sda_ops, both schemas)
 * took 6–7 s and was recomputed for every visitor of Home, the Executive Dashboard and the brief. One entry per
 * range: fresh ≤ 60 s is served as is; older is served immediately while ONE background refresh runs
 * (stale-while-revalidate, ≤ 10 min); a failed refresh keeps the last good copy. sda_ops sees one query set
 * per minute at most instead of one per page view. `?fresh=1` bypasses the memo (Settings › refresh). */
const MEMO = {}, FRESH_MS = 60e3, STALE_MS = 600e3;
async function exec(q = {}) {
  const range = K.rangeOf(q), key = range;
  const m = MEMO[key] || (MEMO[key] = {});
  const age = m.data ? Date.now() - m.at : Infinity;
  if (!q.fresh && m.data && age < FRESH_MS) return m.data;
  const run = () => { if (!m.promise) m.promise = execRaw(q).then(d => { m.data = d; m.at = Date.now(); m.promise = null; return d; }, e => { m.promise = null; throw e; }); return m.promise; };
  if (!q.fresh && m.data && age < STALE_MS) { run().catch(e => console.error('[fixedExec] background refresh failed:', e.message)); return m.data; }
  const t0 = Date.now(); const d = await run(); if (Date.now() - t0 > 3000) console.log(`[fixedExec] exec ${range} took ${Date.now() - t0} ms`); return d;
}
async function execRaw(q = {}) {
  if (!db.ops && !db.opsBeta) return { configured: false, biz: 'fixed', label: 'Fixed', reason: 'OPS_DATABASE_URL / OPS_BETA_DATABASE_URL not set' };
  const range = K.rangeOf(q), days = range === '30d' ? 30 : 7;
  const now = new Date(), D = 864e5;
  const to = now.toISOString(), from = new Date(now - days * D).toISOString();
  const from24 = new Date(now - D).toISOString(), from48 = new Date(now - 2 * D).toISOString();

  const [today, prev, series, errDaysRaw, errCats, errCatDays, steps, budget, alerts, err24rows] = await Promise.all([
    f360.summary({ range: '24h' }), f360.summary({ from: from48, to: from24 }), f360.summary({ range }),
    both(ERR_DAY, [from, to]), both(ERR_CAT, [from, to]), both(ERR_CAT_DAY, [from, to]), both(STEPS, [from, to]),
    errorBudget(), firedAlerts(from), both(ERR_24(), [from24]),
  ]);
  const [radar, ident, yak] = await Promise.all([execRadar.radarRows('fixed'), identity(from, to), yakeen(from, to)]);

  // ---- day axis
  const byDay = {}; for (const r of series.byDay || []) byDay[dayKey(r.day)] = { n: n(r.n), completed: n(r.completed) };
  const errDays = {}; for (const r of errDaysRaw) { const k = errDays[r.day] || (errDays[r.day] = { n: 0, open: 0 }); k.n += n(r.n); k.open += n(r.open); }
  /* identity per day: a day with no calls carries null, never 0 — 0 would plot as a 0 % success rate */
  const yakDay = {}; for (const r of yak.days) yakDay[r.day] = { calls: n(r.calls), failed: n(r.failed), technical: n(r.technical) };
  const idDay = {}; for (const r of ident.days) { const k = idDay[r.day] || (idDay[r.day] = {}); k[r.op] = { calls: n(r.calls), failed: n(r.failed) }; }
  const rateOf = x => x && x.calls ? Math.round(1000 * (x.calls - x.failed) / x.calls) / 10 : null;
  const daysArr = dayAxis(now, days).map(k => ({ day: k, orders: (byDay[k] || {}).n || 0, completed: (byDay[k] || {}).completed || 0, errors: (errDays[k] || {}).n || 0, openErrors: (errDays[k] || {}).open || 0,
    identSends: ((idDay[k] || {}).send || {}).calls || 0, identSendFail: ((idDay[k] || {}).send || {}).failed || 0, identSendRate: rateOf((idDay[k] || {}).send),
    identVerifies: ((idDay[k] || {}).verify || {}).calls || 0, identVerifyFail: ((idDay[k] || {}).verify || {}).failed || 0, identVerifyRate: rateOf((idDay[k] || {}).verify),
    yakeenCalls: (yakDay[k] || {}).calls || 0, yakeenFail: (yakDay[k] || {}).failed || 0, yakeenTechnical: (yakDay[k] || {}).technical || 0, yakeenRate: rateOf(yakDay[k]) }));
  const yakTot = yak.days.reduce((a, r) => ({ calls: a.calls + n(r.calls), failed: a.failed + n(r.failed), technical: a.technical + n(r.technical) }), { calls: 0, failed: 0, technical: 0 });
  const yakNote = !yak.configured ? 'collector not armed — set FIXED_LOG_HOSTS on 152 (combined.log ssh tail)'
    : !yak.total ? `collector armed, no getYakeenInfo line seen yet · ${yak.logPath}`
    : `unified_console.fixed_app_events · combined.log · newest ${String(yak.lastAt).slice(0, 10)}`;
  const identTot = op => ident.days.filter(r => r.op === op).reduce((a, r) => ({ calls: a.calls + n(r.calls), failed: a.failed + n(r.failed) }), { calls: 0, failed: 0 });
  const idSend = identTot('send'), idVerify = identTot('verify');
  const identNote = ident.source ? `${ident.source} · api_calls${ident.lastAt ? ` · newest ${String(ident.lastAt).slice(0, 10)}` : ''}${db.opsBeta && ident.source === 'sda_ops.public' ? ' · beta excluded (api_logs ingest off)' : ''}` : 'no sda_ops read model';

  // ---- 24 h KPIs
  const k = today.kpis || {}, kp = prev.kpis || {};
  const outcomes = Object.fromEntries((today.outcomes || []).map(o => [o.outcome, n(o.n)]));
  const errors24 = err24rows.reduce((a, r) => a + n(r.n), 0);
  const errTech24 = err24rows.reduce((a, r) => a + n(r.tech), 0), errBiz24 = errors24 - errTech24;
  const conv7 = pct(n((series.kpis || {}).completed), n((series.kpis || {}).attempts));
  const convFloor = Math.max(0, conv7 - 5);
  const sloCfg = await slo.getConfig().catch(() => null);
  const def = key => slo.findDef(sloCfg, key);

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
  const errS = slo.assess(def('fixed_api_error_budget'), errors24, {}, budget);
  const convS = slo.assess(def('fixed_order_conversion'), n(k.conversion) / 100, { baseline: conv7 / 100 }, convFloor / 100);
  const nafS = slo.assess(def('fixed_nafath_failure_rate'), naf.total ? naf.failRate / 100 : null, {}, 0.25);
  const manS = slo.assess(def('fixed_manafith_denials'), man.total ? man.deniedRate / 100 : null, {}, 0.10);
  const sadadDef = def('fixed_sadad_availability'), sftpDef = def('fixed_sftp_odb_sync');
  const slos = [
    { key: 'error_budget', name: 'API error budget', actual: `${errors24} / 24 h`, target: errS.targetText, ok: errS.ok, status: errS.status, message: errS.message, measured: true, href: '#fixed?tab=errors' },
    { key: 'conversion', name: 'Order conversion', actual: `${n(k.conversion)}%`, target: convS.targetText, ok: convS.ok, status: convS.status, message: convS.message, measured: n(k.attempts) > 0, href: '#fixed?tab=dash' },
    { key: 'nafath', name: 'Nafath failure rate', actual: naf.total ? `${naf.failRate}%` : '—', target: nafS.targetText, ok: nafS.ok, status: nafS.status, message: nafS.message, measured: !!naf.total, href: '#fixed?tab=dash' },
    { key: 'manafith', name: 'Manafith denials', actual: man.total ? `${man.deniedRate}%` : '—', target: manS.targetText, ok: manS.ok, status: manS.status, message: manS.message, measured: !!man.total, href: '#fixed?tab=dash' },
    { key: 'sadad', name: 'SADAD availability', actual: '—', target: slo.targetText(sadadDef, {}, 'UP · ≤ 500 ms'), ok: null, status: 'nodata', measured: false, note: sadadDef && sadadDef.note || 'no SADAD probe is wired into this console' },
    { key: 'sftp', name: 'SFTP ODB sync', actual: '—', target: slo.targetText(sftpDef, {}, 'SUCCESS daily'), ok: null, status: 'nodata', measured: false, note: sftpDef && sftpDef.note || 'no SFTP job feed is wired into this console' },
  ];

  // ---- status + summary
  const critical = sev.P1 + (errS.status === 'breached' ? 1 : 0) + (pileup && pileup.n >= 1000 ? 1 : 0);
  const warnings = sev.P2 + slos.filter(s => s.measured && (s.status === 'at_risk' || (s.status === 'breached' && s.key !== 'error_budget'))).length;
  const status = K.statusOf(critical, warnings);
  const summary = [];
  if (critical) summary.push(`${critical} critical signal(s): ${[sev.P1 ? `${sev.P1} P1 alert(s) fired` : null, errS.status === 'breached' ? `API errors ${errors24} above ${errS.targetText}` : null, pileup && pileup.n >= 1000 ? `${pileup.n} attempts sitting at ${pileup.label}` : null].filter(Boolean).join(', ')}.`);
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
      { key: 'conversion', title: 'Order funnel health', value: `${n(k.conversion)}%`, sub: `${(n(outcomes.STALLED) + n(outcomes.IN_PROGRESS)).toLocaleString('en-US')} stalled / in progress · target ${convS.targetText}`, tone: convS.status === 'breached' ? 'red' : convS.status === 'at_risk' ? 'amber' : 'green', delta: null, href: '#fixed?tab=dash', exec: true, window: '24 h' },
      { key: 'errors', title: 'API errors', value: errors24, sub: `${errTech24.toLocaleString('en-US')} technical · ${errBiz24.toLocaleString('en-US')} business · budget ${errS.targetText} — ${errS.status === 'breached' ? 'exceeded' : errS.status === 'at_risk' ? 'near limit' : 'within budget'}`, tone: errS.status === 'breached' ? 'red' : errS.status === 'at_risk' ? 'amber' : 'green', delta: null, href: '#fixed?tab=errors', exec: true, window: '24 h' },
      { key: 'critical', title: 'Active critical signals', value: critical, sub: `${sev.P1} P1 · ${sev.P2} P2 · ${sev.P3} P3 fired in ${days} d`, tone: critical ? 'red' : 'green', delta: null, href: '#fixed?tab=alerts', exec: true, window: `${days} d` },
      { key: 'revenue', title: 'Daily revenue', value: '—', sub: 'connect the billing feed to activate', tone: 'muted', delta: null, href: null, exec: true, window: '24 h' },
      { key: 'pileup', title: 'Order pileup', value: pileup ? pileup.n : 0, sub: pileup ? `${pileup.label} · ${pileup.share}% of not-completed` : 'no step is accumulating', tone: pileup && pileup.n >= 1000 ? 'red' : pileup && pileup.n >= 500 ? 'amber' : null, delta: null, href: '#fixed?tab=epurchase', exec: false, window: `${days} d` },
      { key: 'dealers', title: 'Active dealers', value: n(k.activeDealers), sub: 'SDA staff who attempted an order', tone: null, delta: null, href: '#fixed?tab=map', exec: false, window: '24 h' },
    ],
    slos,
    health: [
      { label: 'Read model', value: fr.newest_attempt ? dayKey(fr.newest_attempt) : '—', state: fr.stale ? 'warn' : 'up', sub: fr.lag_min == null ? 'watcher lag unknown' : `watcher lag ${fr.lag_min} min`, href: '#fixed?tab=overview' },
      { label: 'Nafath', value: naf.total ? `${naf.failRate}% fail` : '—', state: !naf.total ? 'nowire' : nafS.status === 'met' ? 'up' : nafS.status === 'at_risk' ? 'warn' : 'down', sub: `${n(naf.total).toLocaleString('en-US')} 5G checks · target ${nafS.targetText}`, href: '#fixed?tab=dash' },
      { label: 'Manafith', value: man.total ? `${man.deniedRate}% denied` : '—', state: !man.total ? 'nowire' : manS.status === 'met' ? 'up' : manS.status === 'at_risk' ? 'warn' : 'down', sub: `${n(man.denied).toLocaleString('en-US')} of ${n(man.total).toLocaleString('en-US')} · target ${manS.targetText}`, href: '#fixed?tab=dash' },
      ...(series.byChannel || []).map(c => ({ label: `Channel · ${c.channel}`, value: `${n(c.n).toLocaleString('en-US')} · ${c.conversion}%`, state: 'up', sub: `attempts · conversion, ${days} d`, href: `#fixed?tab=${c.channel === 'sda' ? 'map' : c.channel === 'epurchase' ? 'epurchase' : 'salamhome'}` })),
      { label: 'SADAD', value: 'not wired', state: 'nowire', sub: 'no probe in this console' },
      { label: 'SFTP ODB sync', value: 'not wired', state: 'nowire', sub: 'no job feed in this console' },
    ],
    series: { days: daysArr, charts: [
      { key: 'orders', title: 'Order attempts', type: 'line', field: 'orders', color: 'green', exec: true },
      { key: 'errors', title: 'API errors vs budget', type: 'bar', field: 'errors', color: 'auto', threshold: budget, thresholdLabel: `budget ${budget}/day`, exec: true },
      { key: 'completed', title: 'Completed orders', type: 'line', field: 'completed', color: 'blue', exec: false },
      { key: 'openErrors', title: 'Still-open errors by day', type: 'bar', field: 'openErrors', color: 'amber', exec: false },
      /* identity verification ② Yakeen / ELM — the real Yakeen, from the app log (see YAK_* above) */
      { key: 'yakeenRate', title: 'Yakeen success rate · ELM NIC record check (getYakeenInfo)', type: 'line', field: 'yakeenRate', color: 'green', pct: true, exec: false,
        sub: `${yakTot.calls.toLocaleString('en-US')} checks · ${yakTot.failed.toLocaleString('en-US')} failed (${yakTot.technical.toLocaleString('en-US')} technical) · ${rateOf(yakTot) == null ? '—' : rateOf(yakTot) + '%'} in ${days} d · success = response line without an error object · ${yakNote}` },
      { key: 'yakeenCats', title: 'Yakeen failures by reason', type: 'cols', exec: false,
        rows: yak.cats.map(c => ({ label: `${c.cls}${c.status ? ' ' + c.status : ''} · ${c.reason}`, n: n(c.n), tone: c.cls === 'technical' ? 'red' : c.cls === 'business' ? 'amber' : 'muted', last_at: c.last_at })),
        sub: yak.cats.length ? `technical = ELM/gateway fault (504, timeout) · business = NIC record refused the inputs · digits masked · ${yakNote}` : `no Yakeen failure in this window · ${yakNote}` },
      /* identity verification ① Absher OTP — see the IDENT_* comment above (NOT Yakeen) */
      { key: 'identSendRate', title: 'Absher OTP send success rate · DRM sendAbsherValidateCode', type: 'line', field: 'identSendRate', color: 'green', pct: true, exec: false,
        sub: `${idSend.calls.toLocaleString('en-US')} sends · ${idSend.failed.toLocaleString('en-US')} failed · ${rateOf(idSend) == null ? '—' : rateOf(idSend) + '%'} in ${days} d · ${identNote}` },
      { key: 'identVerifyRate', title: 'Absher OTP verify success rate · customer enters the code', type: 'line', field: 'identVerifyRate', color: 'blue', pct: true, exec: false,
        sub: `${idVerify.calls.toLocaleString('en-US')} verifies · ${idVerify.failed.toLocaleString('en-US')} failed · a wrong code is the customer, not the provider` },
      { key: 'identCats', title: 'Absher OTP failures by reason', type: 'cols', exec: false,
        rows: ident.cats.map(c => ({ label: `${c.op === 'send' ? 'send' : 'verify'} · ${c.reason}`, n: n(c.n), tone: c.op === 'send' ? 'red' : 'amber', last_at: c.last_at })),
        sub: ident.cats.length ? `DRM reason text from api_calls.error_msg, digits masked · ${identNote}` : 'no Absher OTP failures in this window' },
    ] },
    pipeline: { title: 'Order pipeline — where not-completed attempts stopped', sub: `${notDone.toLocaleString('en-US')} attempts in ${days} d did not complete`, rows: pipelineRows, href: '#fixed?tab=epurchase' },
    issues,
    radar: K.radarOf(radar),
    alerts: alerts.slice(0, 12).map(a => ({ severity: a.severity, name: a.rule_name || a.rule_key, text: a.metric_text || (a.metric_value != null ? `${a.metric_value} vs ${a.threshold}` : ''), team: a.team, at: a.fired_at, href: '#fixed-alerts', status: a.status || 'fired' })),
  };
}

function mount(app, { requireView } = {}) {
  const gate = requireView ? requireView('fixed') : (req, res, next) => next();
  app.get('/api/fixed/exec', gate, async (req, res) => { try { res.json(await exec(req.query)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
}
module.exports = { mount, exec };
