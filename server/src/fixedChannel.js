/* fixedChannel.js — Fixed › E-purchase and Fixed › Salam Home: one CHANNEL dashboard, MVNO-Dashboard style.
 *
 *   GET /api/fixed/channel/:channel/all?range=7d[&from&to][&segment=ftth|5g]   channel = epurchase | salamhome
 *   GET /api/fixed/channel/:channel/:section?…                                  section = one of SECTIONS
 *
 * Every section is computed for the WHOLE channel and split by PRODUCT — FTTH, FTTB (together: FTTX) and 5G home — so
 * business and technical findings never mix products. Segment is derived per attempt (workflow first, then the plan text):
 *   5g   : fiveGWhiteLabel · fiveGFWA · salamHomeRelocationWL · salamHomeRelocationOwn · plan ~ '5G'
 *   fttb : fttb · plan ~ FTTB / business
 *   ftth : ftth · ePurchaseFTTH · salamHomeRelocationFTTH · promoters · plan ~ fiber/FTTH
 *   other: manage-line journeys whose product is not recorded (freeze / change plan / renew without a plan hint)
 *
 * Channels (nexus → read model): epurchase = the public e-purchase web flow, INCLUDING consumer-direct orders (no QR /
 * referral) — the Overview excludes those by default, this page must not; salamhome = the Salam Home (Pulse) app —
 * buy FTTH + manage-line journeys (freeze, unfreeze, relocation, change plan, renew). Rows come from sda_ops.beta when
 * configured (it carries the PULSE→salamhome mapping) else prod public; `coverage.oldest` tells how far back it goes.
 *
 * Payments: payments_v2 (authoritative, live, capped) joined to this channel's attempts by order number / reference;
 * test transactions (1.00 SAR) excluded like the beta. Errors: error_events × attempts, business vs technical from the
 * Error Control Board taxonomy. Integrations: api_calls × attempts, per endpoint family (ids and query strings
 * stripped), p50/p95 and failure rate. Findings: generated from the numbers, tagged business / technical + segment.
 * READ-ONLY. Identifiers never leave the server (aggregates only; the sample tables are masked). */
'use strict';
const db = require('./db');
const f360 = require('./fixed360');

const CHANNELS = { epurchase: { label: 'Epurchase', desc: 'public web / QR flow · consumer-direct included' },
                   salamhome: { label: 'Salam Home app', desc: 'Pulse app · buy FTTH + manage-line journeys' } };
const SECTIONS = ['kpis', 'journeys', 'flows', 'plans', 'campaigns', 'payments', 'errors', 'integrations', 'regions', 'findings'];
/* FTTX = the fixed-line family (FTTH consumer fiber + FTTB business fiber); the two are ALWAYS reported apart. */
const SEG_SQL = `CASE WHEN oa.workflow::text IN ('fiveGWhiteLabel','ePurchase5GWhiteLabel','fiveGFWA','salamHomeRelocationWL','salamHomeRelocationOwn') OR oa.plan ILIKE '%5g%' THEN '5g'
  WHEN oa.workflow::text = 'fttb' OR oa.plan ILIKE '%fttb%' OR oa.plan ILIKE '%business%' THEN 'fttb'
  WHEN oa.workflow::text IN ('ftth','ePurchaseFTTH','salamHomeRelocationFTTH','promoters') OR oa.plan ILIKE '%fiber%' OR oa.plan ILIKE '%ftth%' OR oa.plan ILIKE '%فايبر%' THEN 'ftth'
  ELSE 'other' END`;
const SEGS = ['ftth', 'fttb', '5g', 'other'];
const SEG_LABEL = { ftth: 'FTTH', fttb: 'FTTB', '5g': '5G home', other: 'product not recorded' };
const FTTX = ['ftth', 'fttb'];
const FROM = `FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id`;
const n = v => Number(v) || 0;
const pct = (a, b) => b > 0 ? Math.round((a / b) * 1000) / 10 : 0;
const tail = (s, k) => s == null || s === '' ? null : '…' + String(s).slice(-k);

/* salamHome step order measured from nexus (beta b2c.ts) + the SDA/e-purchase step lists from fixedMap */
const SALAMHOME_STEPS = ['salamHomeCheckCoverage', 'salamHomeSelectODB', 'freezeTime', 'salamHomeRenewPlan', 'salamHomeConfirmPlan',
  'salamHomeSelectAppointment', 'salamHomeSendOtp', 'salamHomeConfirmOtp', 'salamHomeReviewOrder', 'salamHomePayment',
  'salamHomeRelocationSummary', 'salamHomeFreezeSummary', 'salamHomeChangePlanSummary', 'salamHomeRenewSummary'];
let STEPS = {};
try { STEPS = require('./fixedMap').STEPS || {}; } catch (_) { /* fixedMap may not export it */ }
const stepsFor = wf => (STEPS[wf] && STEPS[wf].length) ? STEPS[wf] : (/^salamHome/.test(wf) ? SALAMHOME_STEPS : []);

function pool() { return db.opsBeta || db.ops; }
function notConfigured() { const e = new Error('Fixed data source not configured (OPS_DATABASE_URL)'); e.status = 503; return e; }

/* ---- scope: channel + window (+ optional segment) ---- */
function scope(channel, q = {}) {
  if (!CHANNELS[channel]) { const e = new Error('unknown channel — epurchase | salamhome'); e.status = 400; throw e; }
  const s = f360.parseScope({ ...q, channel, consumerDirect: '1' });   // consumer-direct INCLUDED
  const seg = SEGS.includes(q.segment) ? q.segment : null;
  if (seg) { s.params.push(seg); s.where += ` AND (${SEG_SQL}) = $${s.params.length}`; }
  s.segment = seg; s.channel = channel;
  // previous window of the same length (for deltas)
  const len = s.to.getTime() - s.from.getTime();
  s.prevFrom = new Date(s.from.getTime() - len); s.prevTo = s.from;
  return s;
}
function prevScope(s) {   // same predicates, shifted window (params 1 and 2 are from/to)
  const p = s.params.slice(); p[0] = s.prevFrom.toISOString(); p[1] = s.prevTo.toISOString();
  return { where: s.where, params: p };
}
const bySeg = (rows, key = 'segment') => { const o = {}; for (const r of rows) o[r[key]] = r; return o; };

/* ------------------------------------------------------------------------------------------ sections */
async function kpis(channel, q) {
  const P = pool(); if (!P) throw notConfigured();
  const s = scope(channel, q);
  const agg = `SELECT ${SEG_SQL} AS segment, count(*)::int AS attempts,
      count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
      count(*) FILTER (WHERE oa.outcome='STALLED')::int AS stalled,
      count(*) FILTER (WHERE oa.outcome='IN_PROGRESS')::int AS in_progress,
      count(*) FILTER (WHERE oa.outcome IN ('CANCELLED','EXPIRED'))::int AS abandoned,
      count(*) FILTER (WHERE oa.order_number IS NOT NULL)::int AS with_order,
      count(DISTINCT COALESCE(oa.customer_id, oa.cust_code, oa.msisdn))::int AS customers,
      count(DISTINCT oa.referral_code) FILTER (WHERE oa.referral_code IS NOT NULL)::int AS referral_codes,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY oa.duration_s) FILTER (WHERE oa.outcome='COMPLETED' AND oa.duration_s > 0) AS median_s,
      count(*) FILTER (WHERE oa.nafath_outcome IS NOT NULL)::int AS nafath_checks,
      count(*) FILTER (WHERE oa.nafath_outcome IS NOT NULL AND oa.nafath_outcome NOT IN ('COMPLETED','SUCCESS','APPROVED'))::int AS nafath_failed,
      count(*) FILTER (WHERE oa.customer_id ~ '^1')::int AS saudi, count(*) FILTER (WHERE oa.customer_id ~ '^2')::int AS non_saudi,
      count(*) FILTER (WHERE oa.plan ILIKE '%prepaid%' OR oa.plan ILIKE '%pre-paid%')::int AS prepaid,
      count(*) FILTER (WHERE oa.plan IS NOT NULL AND oa.plan <> '' AND NOT (oa.plan ILIKE '%prepaid%' OR oa.plan ILIKE '%pre-paid%'))::int AS postpaid,
      count(*) FILTER (WHERE oa.outcome IN ('CANCELLED','EXPIRED') AND (oa.plan ILIKE '%prepaid%' OR oa.plan ILIKE '%pre-paid%'))::int AS cancelled_prepaid,
      count(*) FILTER (WHERE oa.outcome IN ('CANCELLED','EXPIRED') AND NOT (oa.plan ILIKE '%prepaid%' OR oa.plan ILIKE '%pre-paid%'))::int AS cancelled_postpaid
    ${FROM} ${s.where} GROUP BY 1`;
  // context: every channel in the same window (Grafana "Total orders by source") — unfiltered by channel/segment
  const ctxScope = f360.parseScope({ ...q, channel: undefined, consumerDirect: '1' });
  const [cur, prev, days, cov, ctx, naf] = await Promise.all([
    P.query(agg, s.params), P.query(agg, prevScope(s).params),
    P.query(`SELECT date_trunc('day', oa.started_at + interval '3 hours') AS day, ${SEG_SQL} AS segment, count(*)::int AS n,
        count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed ${FROM} ${s.where} GROUP BY 1,2 ORDER BY 1`, s.params),
    P.query(`SELECT min(started_at) AS oldest, max(started_at) AS newest, count(*)::int AS rows FROM order_attempts oa WHERE oa.channel = $1`, [channel]),
    P.query(`SELECT oa.channel, count(*)::int AS n, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed ${FROM} ${ctxScope.where} GROUP BY 1 ORDER BY 2 DESC`, ctxScope.params),
    P.query(`SELECT COALESCE(oa.nafath_outcome,'(none)') AS outcome, ${SEG_SQL} AS segment, count(*)::int AS n ${FROM} ${s.where} AND oa.nafath_outcome IS NOT NULL GROUP BY 1,2 ORDER BY 3 DESC`, s.params),
  ]);
  const shape = r => r ? { ...r, attempts: n(r.attempts), completed: n(r.completed), conversion: pct(n(r.completed), n(r.attempts)), order_rate: pct(n(r.with_order), n(r.attempts)),
    median_min: r.median_s != null ? Math.round(n(r.median_s) / 60) : null, nafath_fail_rate: pct(n(r.nafath_failed), n(r.nafath_checks)) } : null;
  const total = rows => rows.reduce((a, r) => ({ attempts: a.attempts + n(r.attempts), completed: a.completed + n(r.completed), stalled: a.stalled + n(r.stalled), in_progress: a.in_progress + n(r.in_progress),
    abandoned: a.abandoned + n(r.abandoned), with_order: a.with_order + n(r.with_order), customers: a.customers + n(r.customers), referral_codes: a.referral_codes + n(r.referral_codes),
    nafath_checks: a.nafath_checks + n(r.nafath_checks), nafath_failed: a.nafath_failed + n(r.nafath_failed), median_s: null,
    saudi: a.saudi + n(r.saudi), non_saudi: a.non_saudi + n(r.non_saudi), prepaid: a.prepaid + n(r.prepaid), postpaid: a.postpaid + n(r.postpaid), cancelled_prepaid: a.cancelled_prepaid + n(r.cancelled_prepaid), cancelled_postpaid: a.cancelled_postpaid + n(r.cancelled_postpaid) }),
    { attempts: 0, completed: 0, stalled: 0, in_progress: 0, abandoned: 0, with_order: 0, customers: 0, referral_codes: 0, nafath_checks: 0, nafath_failed: 0, saudi: 0, non_saudi: 0, prepaid: 0, postpaid: 0, cancelled_prepaid: 0, cancelled_postpaid: 0 });
  const segCur = bySeg(cur.rows.map(shape)), segPrev = bySeg(prev.rows.map(shape));
  return { channel, window: { from: s.from, to: s.to, prev_from: s.prevFrom }, source: db.opsBeta ? 'sda_ops.beta' : 'sda_ops.public',
    coverage: cov.rows[0] || {}, segments: SEGS.map(k => ({ segment: k, label: SEG_LABEL[k], now: segCur[k] || null, prev: segPrev[k] || null })),
    total: { now: shape(total(cur.rows)), prev: shape(total(prev.rows)) },
    byDay: days.rows.map(r => ({ day: r.day, segment: r.segment, n: n(r.n), completed: n(r.completed) })),
    by_channel: ctx.rows.map(r => ({ channel: r.channel, n: n(r.n), completed: n(r.completed), conversion: pct(n(r.completed), n(r.n)), current: r.channel === channel })),
    nafath: naf.rows.map(r => ({ ...r, seg_label: SEG_LABEL[r.segment] })) };
}

async function journeys(channel, q) {
  const P = pool(); if (!P) throw notConfigured();
  const s = scope(channel, q);
  const r = await P.query(`SELECT oa.workflow::text AS workflow, ${SEG_SQL} AS segment, count(*)::int AS n,
      count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed, count(*) FILTER (WHERE oa.outcome='STALLED')::int AS stalled,
      count(*) FILTER (WHERE oa.outcome='IN_PROGRESS')::int AS in_progress, count(*) FILTER (WHERE oa.outcome IN ('CANCELLED','EXPIRED'))::int AS abandoned,
      count(*) FILTER (WHERE oa.order_number IS NOT NULL)::int AS with_order,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY oa.duration_s) FILTER (WHERE oa.outcome='COMPLETED' AND oa.duration_s > 0) AS median_s,
      count(*) FILTER (WHERE oa.last_error_category IS NOT NULL)::int AS with_error
    ${FROM} ${s.where} GROUP BY 1,2 ORDER BY 3 DESC`, s.params);
  const prev = await P.query(`SELECT oa.workflow::text AS workflow, ${SEG_SQL} AS segment, count(*)::int AS n, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed
    ${FROM} ${s.where} GROUP BY 1,2`, prevScope(s).params);
  const pv = {}; for (const r2 of prev.rows) pv[r2.workflow + '|' + r2.segment] = r2;
  return { channel, window: { from: s.from, to: s.to }, rows: r.rows.map(x => { const p = pv[x.workflow + '|' + x.segment] || {}; return { ...x, label: f360.WORKFLOW_LABEL[x.workflow] || x.workflow, seg_label: SEG_LABEL[x.segment],
    conversion: pct(n(x.completed), n(x.n)), prev_n: n(p.n), prev_conversion: pct(n(p.completed), n(p.n)), median_min: x.median_s != null ? Math.round(n(x.median_s) / 60) : null }; }) };
}

async function flows(channel, q) {
  const P = pool(); if (!P) throw notConfigured();
  const s = scope(channel, q);
  const [r, sd] = await Promise.all([
    P.query(`SELECT oa.workflow::text AS workflow, ${SEG_SQL} AS segment, oa.outcome::text AS outcome, oa.step_reached, count(*)::int AS n
      ${FROM} ${s.where} GROUP BY 1,2,3,4`, s.params),
    P.query(`SELECT date_trunc('day', oa.started_at + interval '3 hours') AS day, COALESCE(oa.step_reached,'(none)') AS step, ${SEG_SQL} AS segment, count(*)::int AS n
      ${FROM} ${s.where} AND oa.outcome IN ('CANCELLED','EXPIRED','STALLED') GROUP BY 1,2,3 ORDER BY 1`, s.params)]);
  const byWf = {};
  for (const x of r.rows) { const k = x.workflow + '|' + x.segment; (byWf[k] = byWf[k] || { workflow: x.workflow, segment: x.segment, groups: [] }).groups.push({ outcome: x.outcome, step_reached: x.step_reached, count: n(x.n) }); }
  const out = [];
  for (const w of Object.values(byWf)) {
    const total = w.groups.reduce((a, g) => a + g.count, 0);
    // 5G e-purchase arrives from the prod ingest as fiveGWhiteLabel with e-purchase step names → use its own step list
    const wfKey = (w.workflow === 'fiveGWhiteLabel' && w.groups.some(g => /^ePurchase/.test(g.step_reached || ''))) ? 'ePurchase5GWhiteLabel' : w.workflow;
    let steps = stepsFor(wfKey);
    // unknown workflow → order the observed stop steps by frequency (never hide a step)
    if (!steps.length) steps = [...new Set(w.groups.filter(g => g.step_reached).sort((a, b) => b.count - a.count).map(g => g.step_reached))];
    const reach = new Array(steps.length).fill(0), L = steps.length;
    for (const g of w.groups) { let idx; if (g.outcome === 'COMPLETED') idx = L; else { const f = g.step_reached ? steps.indexOf(g.step_reached) : -1; idx = f >= 0 ? f : Math.max(L - 3, 0); } for (let i = 0; i < Math.min(idx, L); i++) reach[i] += g.count; }
    const funnel = steps.map((step, i) => { const c = reach[i]; const prev = i === 0 ? total : reach[i - 1]; return { step, reached: c, drop: Math.max(0, prev - c), drop_pct: pct(Math.max(0, prev - c), prev) }; });
    const stops = {}; for (const g of w.groups) if (g.outcome !== 'COMPLETED') { const k = g.step_reached || '(none)'; stops[k] = (stops[k] || 0) + g.count; }
    const stopRows = Object.entries(stops).map(([step, cnt]) => ({ step, n: cnt, pct: pct(cnt, total) })).sort((a, b) => b.n - a.n);
    const completed = w.groups.filter(g => g.outcome === 'COMPLETED').reduce((a, g) => a + g.count, 0);
    out.push({ workflow: w.workflow, label: f360.WORKFLOW_LABEL[wfKey] || w.workflow, segment: w.segment, seg_label: SEG_LABEL[w.segment], total, completed, conversion: pct(completed, total),
      steps_known: !!stepsFor(wfKey).length, funnel, stops: stopRows.slice(0, 8), biggest_drop: funnel.slice().sort((a, b) => b.drop - a.drop)[0] || null });
  }
  // stop steps per day — top 6 steps overall, rest folded into "other"
  const stepTot = {}; for (const x of sd.rows) stepTot[x.step] = (stepTot[x.step] || 0) + n(x.n);
  const topSteps = Object.entries(stepTot).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
  const stopsByDay = {}; for (const x of sd.rows) { const k = String(x.day).slice(0, 10); const o = stopsByDay[k] = stopsByDay[k] || { day: k, total: 0, steps: {} }; const st = topSteps.includes(x.step) ? x.step : 'other'; o.steps[st] = (o.steps[st] || 0) + n(x.n); o.total += n(x.n); }
  return { channel, window: { from: s.from, to: s.to }, workflows: out.sort((a, b) => b.total - a.total), stop_steps: topSteps, stopsByDay: Object.values(stopsByDay).sort((a, b) => a.day < b.day ? -1 : 1) };
}

async function plans(channel, q) {
  const P = pool(); if (!P) throw notConfigured();
  const s = scope(channel, q);
  const r = await P.query(`SELECT COALESCE(NULLIF(oa.plan,''),'(not recorded)') AS plan, ${SEG_SQL} AS segment, count(*)::int AS n,
      count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed, count(*) FILTER (WHERE oa.order_number IS NOT NULL)::int AS with_order,
      count(DISTINCT oa.workflow)::int AS journeys
    ${FROM} ${s.where} GROUP BY 1,2 ORDER BY 3 DESC LIMIT 60`, s.params);
  const tot = r.rows.reduce((a, x) => a + n(x.n), 0);
  return { channel, window: { from: s.from, to: s.to }, total: tot, rows: r.rows.map(x => ({ ...x, seg_label: SEG_LABEL[x.segment], share: pct(n(x.n), tot), conversion: pct(n(x.completed), n(x.n)) })) };
}

async function campaigns(channel, q) {
  const P = pool(); if (!P) throw notConfigured();
  const s = scope(channel, q);
  const split = await P.query(`SELECT (oa.referral_code IS NOT NULL) AS referred, ${SEG_SQL} AS segment, count(*)::int AS n,
      count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed ${FROM} ${s.where} GROUP BY 1,2`, s.params);
  const top = await P.query(`SELECT oa.referral_code, ${SEG_SQL} AS segment, count(*)::int AS n, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
      count(*) FILTER (WHERE oa.order_number IS NOT NULL)::int AS with_order, max(oa.started_at) AS last_at, min(oa.started_at) AS first_at,
      count(DISTINCT COALESCE(oa.region, d.region))::int AS regions
    ${FROM} ${s.where} AND oa.referral_code IS NOT NULL GROUP BY 1,2 ORDER BY 3 DESC LIMIT 25`, s.params);
  const codes = await P.query(`SELECT count(DISTINCT oa.referral_code)::int AS codes ${FROM} ${s.where} AND oa.referral_code IS NOT NULL`, s.params);
  return { channel, window: { from: s.from, to: s.to }, active_codes: n(codes.rows[0] && codes.rows[0].codes),
    split: split.rows.map(x => ({ kind: x.referred ? 'referral / QR' : 'consumer-direct', segment: x.segment, seg_label: SEG_LABEL[x.segment], n: n(x.n), completed: n(x.completed), conversion: pct(n(x.completed), n(x.n)) })),
    top: top.rows.map(x => ({ ...x, seg_label: SEG_LABEL[x.segment], conversion: pct(n(x.completed), n(x.n)) })),
    note: channel === 'salamhome' ? 'Referral codes are rarely used inside the app — campaigns here are mostly consumer-direct.' : 'referral = QR / promoter code on the order · consumer-direct = no code (excluded from the Overview, included here)' };
}

async function payments(channel, q) {
  const P = pool(); if (!P) throw notConfigured();
  const s = scope(channel, q);
  if (!db.payments) return { channel, configured: false, note: 'payments_v2 not configured (PAYMENTS_DATABASE_URL) — DBA grant pending' };
  // 1. this channel's attempts with an order / reference key → segment map
  const keys = await P.query(`SELECT oa.order_number, oa.service_no, oa.customer_id, ${SEG_SQL} AS segment, oa.workflow::text AS workflow ${FROM} ${s.where}
      AND (oa.order_number IS NOT NULL OR oa.service_no IS NOT NULL OR oa.customer_id IS NOT NULL) LIMIT 8000`, s.params);
  const segOf = {}; const keyList = new Set();
  for (const k of keys.rows) for (const v of [k.order_number, k.service_no, k.customer_id]) if (v) { segOf[String(v)] = k.segment; keyList.add(String(v)); }
  const from = s.from.toISOString(), to = s.to.toISOString();
  const NOTEST = `AND p.amount <> 100`;   // 1.00 SAR internal test transactions, like the beta
  const linkSql = `SELECT p.status::text AS status, COALESCE(p.source::text,'(none)') AS source, COALESCE(p.method::text,'(none)') AS method,
        (p.amount::numeric/100)::float8 AS amount_sar, p.created_at, p.bank_message,
        COALESCE(NULLIF(i.metadata->>'orderNumber','undefined'), NULLIF(i.reference_id,'undefined')) AS order_key,
        i.metadata->>'ftthNumber' AS ftth_number, i.metadata->>'customerId' AS customer_key, a.name AS application
      FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN applications a ON a.id = i.application_id
     WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST}
       AND (NULLIF(i.metadata->>'orderNumber','undefined') = ANY($3::text[]) OR NULLIF(i.reference_id,'undefined') = ANY($3::text[])
            OR i.metadata->>'ftthNumber' = ANY($3::text[]) OR i.metadata->>'customerId' = ANY($3::text[]))
     ORDER BY p.created_at DESC LIMIT 5000`;
  const PAID = `upper(p.status::text) IN ('PAID','CAPTURED')`;
  const [linked, all, failReasons, paidNoOrder, byApp, byMethod, bySource, byDesc, byHour, trendDay, trendMonth, trendYear, recentFail, procTime] = await Promise.all([
    keyList.size ? db.payments.query(linkSql, [from, to, [...keyList]]) : Promise.resolve({ rows: [] }),
    db.payments.query(`SELECT p.status::text AS status, COALESCE(p.source::text,'(none)') AS source, count(*)::int AS n, (sum(p.amount)::numeric/100)::float8 AS amount_sar
        FROM payments p WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} GROUP BY 1,2 ORDER BY 3 DESC`, [from, to]),
    db.payments.query(`SELECT COALESCE(NULLIF(p.bank_message,''),'(no bank message)') AS reason, count(*)::int AS n FROM payments p
        WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} AND upper(p.status::text) NOT IN ('PAID','CAPTURED','INITIATED','PENDING') GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [from, to]),
    db.payments.query(`SELECT count(*)::int AS n, (COALESCE(sum(p.amount),0)::numeric/100)::float8 AS amount_sar FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} AND upper(p.status::text) IN ('PAID','CAPTURED')
          AND COALESCE(NULLIF(i.reference_id,'undefined'),'') = '' AND COALESCE(NULLIF(i.metadata->>'orderNumber','undefined'),'') = ''`, [from, to]),
    db.payments.query(`SELECT COALESCE(a.name,'(unknown app)') AS application, count(*)::int AS n, count(*) FILTER (WHERE upper(p.status::text) IN ('PAID','CAPTURED'))::int AS paid,
        (sum(p.amount) FILTER (WHERE upper(p.status::text) IN ('PAID','CAPTURED'))::numeric/100)::float8 AS paid_sar
        FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN applications a ON a.id = i.application_id
       WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} GROUP BY 1 ORDER BY 2 DESC`, [from, to]),
    db.payments.query(`SELECT COALESCE(p.method::text,'(none)') AS method, count(*)::int AS n, count(*) FILTER (WHERE ${PAID})::int AS paid, count(*) FILTER (WHERE NOT ${PAID} AND upper(p.status::text) NOT IN ('INITIATED','PENDING','AUTHORIZED'))::int AS failed,
        (COALESCE(sum(p.amount) FILTER (WHERE ${PAID}),0)::numeric/100)::float8 AS paid_sar FROM payments p WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} GROUP BY 1 ORDER BY 2 DESC`, [from, to]),
    db.payments.query(`SELECT COALESCE(p.source::text,'(none)') AS source, count(*)::int AS n, count(*) FILTER (WHERE ${PAID})::int AS paid,
        (COALESCE(sum(p.amount) FILTER (WHERE ${PAID}),0)::numeric/100)::float8 AS paid_sar FROM payments p WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} GROUP BY 1 ORDER BY 2 DESC`, [from, to]),
    db.payments.query(`SELECT COALESCE(NULLIF(i.description,''),'(no description)') AS description, count(*)::int AS n, count(*) FILTER (WHERE ${PAID})::int AS paid,
        (COALESCE(sum(p.amount) FILTER (WHERE ${PAID}),0)::numeric/100)::float8 AS paid_sar FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, [from, to]),
    db.payments.query(`SELECT extract(hour from p.created_at + interval '3 hours')::int AS hour, count(*)::int AS n, count(*) FILTER (WHERE ${PAID})::int AS paid
        FROM payments p WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} GROUP BY 1 ORDER BY 1`, [from, to]),
    db.payments.query(`SELECT to_char(p.created_at + interval '3 hours','YYYY-MM-DD') AS day, count(*)::int AS n, count(*) FILTER (WHERE ${PAID})::int AS paid,
        (COALESCE(sum(p.amount) FILTER (WHERE ${PAID}),0)::numeric/100)::float8 AS revenue_sar FROM payments p
       WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} GROUP BY 1 ORDER BY 1`, [from, to]),
    db.payments.query(`SELECT to_char(p.created_at + interval '3 hours','YYYY-MM') AS month, count(*)::int AS n, count(*) FILTER (WHERE ${PAID})::int AS paid,
        (COALESCE(sum(p.amount) FILTER (WHERE ${PAID}),0)::numeric/100)::float8 AS revenue_sar FROM payments p
       WHERE p.created_at >= date_trunc('month', now()) - interval '12 months' ${NOTEST} GROUP BY 1 ORDER BY 1`, []),
    db.payments.query(`SELECT to_char(p.created_at + interval '3 hours','YYYY') AS year, count(*)::int AS n, count(*) FILTER (WHERE ${PAID})::int AS paid,
        (COALESCE(sum(p.amount) FILTER (WHERE ${PAID}),0)::numeric/100)::float8 AS revenue_sar FROM payments p WHERE 1=1 ${NOTEST} GROUP BY 1 ORDER BY 1`, []),
    db.payments.query(`SELECT p.created_at, (p.amount::numeric/100)::float8 AS amount_sar, COALESCE(p.method::text,'') AS method, p.channel::text AS channel, p.status::text AS status, p.bank_message,
        i.metadata->>'customerId' AS customer_key, a.name AS application FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN applications a ON a.id = i.application_id
       WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} AND upper(p.status::text) NOT IN ('PAID','CAPTURED','INITIATED','PENDING','AUTHORIZED') ORDER BY p.created_at DESC LIMIT 12`, [from, to]),
    db.payments.query(`SELECT avg(extract(epoch from (p.updated_at - p.created_at)))::float8 AS avg_s, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch from (p.updated_at - p.created_at)))::float8 AS p50_s
        FROM payments p WHERE p.created_at >= $1 AND p.created_at < $2 ${NOTEST} AND ${PAID} AND p.updated_at > p.created_at AND p.updated_at - p.created_at < interval '2 hours'`, [from, to]),
  ].map(p => p.catch(e => ({ rows: [], error: e.message }))));
  // 2. linked payments by segment × status
  const seg = {}; const isPaid = st => /^(PAID|CAPTURED)$/i.test(st || '');
  const day = {};
  for (const p of linked.rows) {
    const sg = segOf[p.order_key] || segOf[p.ftth_number] || segOf[p.customer_key] || 'other';
    const o = seg[sg] = seg[sg] || { segment: sg, seg_label: SEG_LABEL[sg], n: 0, paid: 0, failed: 0, pending: 0, paid_sar: 0, methods: {}, apps: {} };
    o.n++; if (isPaid(p.status)) { o.paid++; o.paid_sar += n(p.amount_sar); } else if (/INITIATED|PENDING/i.test(p.status)) o.pending++; else o.failed++;
    o.methods[p.method] = (o.methods[p.method] || 0) + 1; o.apps[p.application || '?'] = (o.apps[p.application || '?'] || 0) + 1;
    const dk = new Date(new Date(p.created_at).getTime() + 3 * 3600e3).toISOString().slice(0, 10); const dd = day[dk] = day[dk] || { day: dk, n: 0, paid: 0, failed: 0 }; dd.n++; if (isPaid(p.status)) dd.paid++; else if (!/INITIATED|PENDING/i.test(p.status)) dd.failed++;
  }
  const segments = Object.values(seg).map(o => ({ ...o, paid_rate: pct(o.paid, o.paid + o.failed), paid_sar: Math.round(o.paid_sar * 100) / 100,
    methods: Object.entries(o.methods).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ method: k, n: v })), apps: Object.entries(o.apps).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ application: k, n: v })) }));
  const sample = linked.rows.slice(0, 12).map(p => ({ when: p.created_at, status: p.status, method: p.method, source: p.source, amount_sar: p.amount_sar, application: p.application,
    order: tail(p.order_key, 6), ftth: tail(p.ftth_number, 6), bank_message: p.bank_message ? String(p.bank_message).slice(0, 80) : null, segment: segOf[p.order_key] || segOf[p.ftth_number] || segOf[p.customer_key] || 'other' }));
  return { channel, configured: true, window: { from: s.from, to: s.to }, linked_keys: keyList.size, linked_payments: linked.rows.length, error: linked.error || all.error || null,
    segments, byDay: Object.values(day).sort((a, b) => a.day < b.day ? -1 : 1), sample,
    platform: { by_status: all.rows, fail_reasons: failReasons.rows, paid_no_order: paidNoOrder.rows[0] || { n: 0, amount_sar: 0 }, by_application: byApp.rows,
      by_method: byMethod.rows, by_source: bySource.rows, by_description: byDesc.rows, by_hour: byHour.rows,
      trend_day: trendDay.rows, trend_month: trendMonth.rows, trend_year: trendYear.rows,
      recent_failures: recentFail.rows.map(x => ({ ...x, customer_key: tail(x.customer_key, 4), bank_message: x.bank_message ? String(x.bank_message).slice(0, 80) : null })),
      processing: procTime.rows[0] ? { avg_s: procTime.rows[0].avg_s != null ? Math.round(procTime.rows[0].avg_s) : null, p50_s: procTime.rows[0].p50_s != null ? Math.round(procTime.rows[0].p50_s) : null } : null,
      totals: (() => { const t = { n: 0, paid: 0, failed: 0 }; for (const r of all.rows) { t.n += n(r.n); if (/^(PAID|CAPTURED)$/i.test(r.status)) t.paid += n(r.n); else if (!/INITIATED|PENDING|AUTHORIZED/i.test(r.status)) t.failed += n(r.n); } t.success_rate = pct(t.paid, t.paid + t.failed); t.fail_rate = pct(t.failed, t.paid + t.failed); return t; })() },
    note: 'linked = payments_v2 rows whose invoice carries an order / service / customer key of this channel\'s attempts in the window; platform = every Fixed payment in the window (all channels). 1.00 SAR test transactions excluded. Application "Payment Optimization" is a routing layer — do not read it as a channel.' };
}

async function errors(channel, q) {
  const P = pool(); if (!P) throw notConfigured();
  const s = scope(channel, q);
  let TAX = {}; try { const fe = require('./fixedErrors'); TAX = Object.fromEntries((fe.TAXONOMY || []).map(c => [c.key, c])); } catch (_) {}
  const cls = c => { const m = TAX[c]; return m && (m.businessRule || m.clientSide) ? 'business' : 'technical'; };
  const base = `FROM error_events e JOIN order_attempts oa ON oa.id = e.attempt_id LEFT JOIN dealers d ON d.id = oa.dealer_id`;
  const where = s.where.replace(/oa\.started_at/g, 'e.occurred_at');
  const [cats, steps, msgs, days, otp] = await Promise.all([
    P.query(`SELECT e.category, ${SEG_SQL} AS segment, count(*)::int AS n, count(*) FILTER (WHERE NOT e.resolved)::int AS open, max(e.occurred_at) AS last_at,
        count(DISTINCT e.attempt_id)::int AS attempts ${base} ${where} GROUP BY 1,2 ORDER BY 3 DESC`, s.params),
    P.query(`SELECT COALESCE(e.step,'(none)') AS step, ${SEG_SQL} AS segment, count(*)::int AS n ${base} ${where} GROUP BY 1,2 ORDER BY 3 DESC LIMIT 30`, s.params),
    P.query(`SELECT e.category, e.code, left(regexp_replace(e.message, '[0-9]{5,}', '#', 'g'), 120) AS message, ${SEG_SQL} AS segment, count(*)::int AS n, max(e.occurred_at) AS last_at
        ${base} ${where} GROUP BY 1,2,3,4 ORDER BY 5 DESC LIMIT 20`, s.params),
    P.query(`SELECT date_trunc('day', e.occurred_at + interval '3 hours') AS day, ${SEG_SQL} AS segment, count(*)::int AS n ${base} ${where} GROUP BY 1,2 ORDER BY 1`, s.params),
    P.query(`SELECT date_trunc('day', e.occurred_at + interval '3 hours') AS day, ${SEG_SQL} AS segment, count(*)::int AS n ${base} ${where}
        AND (e.step ILIKE '%otp%' OR e.message ILIKE '%otp%' OR e.code ILIKE '%otp%') GROUP BY 1,2 ORDER BY 1`, s.params).catch(() => ({ rows: [] })),
  ]);
  const rows = cats.rows.map(x => ({ ...x, seg_label: SEG_LABEL[x.segment], klass: cls(x.category), label: (TAX[x.category] || {}).label || x.category, team: (TAX[x.category] || {}).team || 'PLATFORM', money_at_risk: !!(TAX[x.category] || {}).moneyAtRisk }));
  const sum = k => rows.filter(r => r.klass === k).reduce((a, r) => a + n(r.n), 0);
  return { channel, window: { from: s.from, to: s.to }, categories: rows, by_step: steps.rows.map(x => ({ ...x, seg_label: SEG_LABEL[x.segment] })), top_messages: msgs.rows.map(x => ({ ...x, seg_label: SEG_LABEL[x.segment], klass: cls(x.category) })),
    byDay: days.rows, otpByDay: otp.rows.map(x => ({ ...x, seg_label: SEG_LABEL[x.segment] })), otp_failed: otp.rows.reduce((a, x) => a + n(x.n), 0),
    totals: { business: sum('business'), technical: sum('technical'), open: rows.reduce((a, r) => a + n(r.open), 0) } };
}

async function integrations(channel, q) {
  const P = pool(); if (!P) throw notConfigured();
  const s = scope(channel, q);
  const fam = `regexp_replace(regexp_replace(split_part(ac.endpoint, '?', 1), '^https?://[^/]+', ''), '/[0-9A-Za-z_-]*[0-9][0-9A-Za-z_-]*', '/{id}', 'g')`;
  const sql = `SELECT ${fam} AS family, ${SEG_SQL} AS segment, count(*)::int AS calls,
      count(*) FILTER (WHERE ac.status >= 400 OR ac.error_class IS NOT NULL)::int AS failed,
      count(*) FILTER (WHERE ac.status >= 500)::int AS s5xx, count(*) FILTER (WHERE ac.error_class ILIKE '%timeout%')::int AS timeouts,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ac.duration_ms) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY ac.duration_ms) AS p95, max(ac.duration_ms) AS max_ms,
      max(ac.created_at) AS last_at
    FROM api_calls ac JOIN order_attempts oa ON oa.id = ac.attempt_id LEFT JOIN dealers d ON d.id = oa.dealer_id ${s.where.replace(/oa\.started_at/g, 'ac.created_at')}
    GROUP BY 1,2 HAVING count(*) >= 3 ORDER BY 3 DESC LIMIT 80`;
  const daySql = `SELECT ${fam} AS family, date_trunc('day', ac.created_at + interval '3 hours') AS day, count(*)::int AS calls, count(*) FILTER (WHERE ac.status >= 400 OR ac.error_class IS NOT NULL)::int AS failed
    FROM api_calls ac JOIN order_attempts oa ON oa.id = ac.attempt_id LEFT JOIN dealers d ON d.id = oa.dealer_id ${s.where.replace(/oa\.started_at/g, 'ac.created_at')} GROUP BY 1,2 ORDER BY 2`;
  let src = P, r = await P.query(sql, s.params), source = db.opsBeta ? 'sda_ops.beta' : 'sda_ops.public', note = null;
  if (!r.rows.length && db.opsBeta && db.ops) {   // beta stopped ingesting api_logs (DB_WATCH_API_LOGS=0) — fall back to prod
    try { r = await db.ops.query(sql, s.params); src = db.ops; source = 'sda_ops.public'; note = 'beta has no API calls for this window (api_logs ingest off) — prod read model used; prod maps the Salam Home app into channel epurchase'; } catch (_) {}
  }
  const fd = r.rows.length ? await src.query(daySql, s.params).catch(() => ({ rows: [] })) : { rows: [] };
  const failFam = {}; for (const x of fd.rows) if (n(x.failed)) { const o = failFam[x.family] = failFam[x.family] || { family: x.family, failed: 0, days: [] }; o.failed += n(x.failed); o.days.push({ day: String(x.day).slice(0, 10), failed: n(x.failed), calls: n(x.calls) }); }
  const failures_by_day = Object.values(failFam).sort((a, b) => b.failed - a.failed).slice(0, 8);
  const rows = r.rows.map(x => ({ ...x, seg_label: SEG_LABEL[x.segment], fail_rate: pct(n(x.failed), n(x.calls)), p50: Math.round(n(x.p50)), p95: Math.round(n(x.p95)), max_ms: n(x.max_ms),
    system: /nafath|semati/i.test(x.family) ? 'Identity (Nafath/Semati)' : /yakeen|elm|absher/i.test(x.family) ? 'Identity (Yakeen/ELM)' : /transferRest|bss|salam(check|qry|new|update)|qry/i.test(x.family) ? 'Fixed BSS (ZSmart)' : /payment|invoice|moyasar|tap|sadad/i.test(x.family) ? 'Payments' : /wathq/i.test(x.family) ? 'Wathq' : /geo|kml|coverage/i.test(x.family) ? 'Geo / coverage' : 'Other' }));
  const bySys = {}; for (const x of rows) { const o = bySys[x.system] = bySys[x.system] || { system: x.system, calls: 0, failed: 0, p95: 0 }; o.calls += x.calls; o.failed += x.failed; o.p95 = Math.max(o.p95, x.p95); }
  return { channel, window: { from: s.from, to: s.to }, source, note, rows, failures_by_day, systems: Object.values(bySys).map(o => ({ ...o, fail_rate: pct(o.failed, o.calls) })).sort((a, b) => b.calls - a.calls) };
}

async function regions(channel, q) {
  const P = pool(); if (!P) throw notConfigured();
  const s = scope(channel, q);
  const r = await P.query(`SELECT COALESCE(oa.region, d.region, '(unknown)') AS region, ${SEG_SQL} AS segment, count(*)::int AS n,
      count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed, count(*) FILTER (WHERE oa.last_error_category='FEASIBILITY_FAILED')::int AS no_coverage,
      count(*) FILTER (WHERE oa.last_error_category='APPOINTMENT_FAILED')::int AS no_appointment
    ${FROM} ${s.where} GROUP BY 1,2 ORDER BY 3 DESC LIMIT 40`, s.params);
  return { channel, window: { from: s.from, to: s.to }, rows: r.rows.map(x => ({ ...x, seg_label: SEG_LABEL[x.segment], conversion: pct(n(x.completed), n(x.n)) })) };
}

/* ---- findings: read the numbers, write the sentences (business vs technical, per segment) ---- */
function findings(parts) {
  const F = [];
  const add = (kind, sev, segment, text, href) => F.push({ kind, sev, segment, seg_label: SEG_LABEL[segment] || 'all', text, href });
  const k = parts.kpis;
  if (k && !k.error) {
    for (const sg of k.segments) { const c = sg.now, p = sg.prev; if (!c || !c.attempts) continue;
      if (p && p.attempts >= 20) { const d = (c.attempts - p.attempts) / p.attempts; if (Math.abs(d) >= 0.2) add('business', Math.abs(d) >= 0.4 ? 'P2' : 'P3', sg.segment, `${sg.label}: volume ${d > 0 ? 'up' : 'down'} ${Math.round(Math.abs(d) * 100)}% vs the previous window (${c.attempts} vs ${p.attempts} attempts)`, 'kpis'); }
      if (p && p.attempts >= 20 && Math.abs(c.conversion - p.conversion) >= 5) add('business', c.conversion < p.conversion ? 'P2' : 'info', sg.segment, `${sg.label}: conversion ${c.conversion}% vs ${p.conversion}% before (${c.conversion < p.conversion ? 'down' : 'up'} ${Math.abs(Math.round((c.conversion - p.conversion) * 10) / 10)} pts)`, 'kpis');
      if (c.attempts >= 30 && c.conversion < 15) add('business', 'P2', sg.segment, `${sg.label}: only ${c.conversion}% of ${c.attempts} attempts complete`, 'flows');
      if (c.nafath_checks >= 20 && c.nafath_fail_rate >= 20) add('technical', c.nafath_fail_rate >= 35 ? 'P2' : 'P3', sg.segment, `${sg.label}: Nafath fails on ${c.nafath_fail_rate}% of ${c.nafath_checks} identity checks`, 'integrations');
      if (c.attempts >= 30 && c.order_rate < c.conversion - 10) add('technical', 'P3', sg.segment, `${sg.label}: ${c.conversion}% completed but only ${c.order_rate}% carry a BSS order number — order creation lagging the journey`, 'journeys');
    }
    const fx = k.segments.filter(x => FTTX.includes(x.segment) && x.now).reduce((a, x) => ({ attempts: a.attempts + x.now.attempts, completed: a.completed + x.now.completed }), { attempts: 0, completed: 0 });
    const b = k.segments.find(x => x.segment === '5g' && x.now);
    if (fx.attempts >= 30 && b && b.now.attempts >= 30) { const fc = pct(fx.completed, fx.attempts); if (Math.abs(fc - b.now.conversion) >= 10)
      add('business', 'P3', fc > b.now.conversion ? '5g' : 'ftth', `Conversion gap between products: FTTX ${fc}% (FTTH + FTTB) vs 5G ${b.now.conversion}%`, 'journeys'); }
    const h = k.segments.find(x => x.segment === 'ftth' && x.now), bb = k.segments.find(x => x.segment === 'fttb' && x.now);
    if (h && bb && h.now.attempts >= 30 && bb.now.attempts >= 10 && Math.abs(h.now.conversion - bb.now.conversion) >= 15)
      add('business', 'P3', h.now.conversion > bb.now.conversion ? 'fttb' : 'ftth', `Inside FTTX: FTTH converts ${h.now.conversion}% vs FTTB ${bb.now.conversion}%`, 'journeys');
  }
  const fl = parts.flows;
  if (fl && !fl.error) for (const w of fl.workflows.slice(0, 6)) { const bd = w.biggest_drop; if (w.total >= 30 && bd && bd.drop_pct >= 35) add('business', bd.drop_pct >= 60 ? 'P2' : 'P3', w.segment, `${w.label} (${w.seg_label}): ${bd.drop_pct}% of customers leave at "${bd.step}" (${bd.drop} of ${w.total})`, 'flows'); }
  const pay = parts.payments;
  if (pay && pay.configured && !pay.error) {
    for (const sg of pay.segments) if (sg.paid + sg.failed >= 10 && sg.paid_rate < 70) add('business', sg.paid_rate < 50 ? 'P1' : 'P2', sg.segment, `${sg.seg_label}: payment success only ${sg.paid_rate}% (${sg.paid} paid / ${sg.failed} failed)`, 'payments');
    const pno = pay.platform && pay.platform.paid_no_order; if (pno && pno.n > 0) add('technical', 'P1', 'other', `${pno.n} payment(s) PAID with no order reference — ${Math.round(pno.amount_sar).toLocaleString('en-US')} SAR taken with nothing to show for it (all Fixed channels, window)`, 'payments');
    const fr = pay.platform && pay.platform.fail_reasons && pay.platform.fail_reasons[0]; if (fr && fr.n >= 10) add('technical', 'P3', 'other', `Top decline reason on the platform: "${fr.reason}" × ${fr.n}`, 'payments');
  }
  const er = parts.errors;
  if (er && !er.error) { for (const c of er.categories.slice(0, 8)) { if (c.n >= 15 && c.klass === 'technical') add('technical', c.money_at_risk ? 'P1' : c.n >= 100 ? 'P2' : 'P3', c.segment, `${c.seg_label}: ${c.n} × ${c.label}${c.open ? ` (${c.open} open)` : ''} — team ${c.team}`, 'errors');
      if (c.n >= 50 && c.klass === 'business') add('business', 'P3', c.segment, `${c.seg_label}: ${c.n} × ${c.label} — a business rule stopped the customer, not a fault`, 'errors'); } }
  const ig = parts.integrations;
  if (ig && !ig.error) for (const x of ig.rows.slice(0, 40)) { if (x.calls >= 20 && x.fail_rate >= 10) add('technical', x.fail_rate >= 30 ? 'P2' : 'P3', x.segment, `${x.system} · ${x.family}: ${x.fail_rate}% of ${x.calls} calls fail (${x.seg_label})`, 'integrations');
    if (x.calls >= 20 && x.p95 >= 8000) add('technical', x.p95 >= 20000 ? 'P2' : 'P3', x.segment, `${x.system} · ${x.family}: p95 ${Math.round(x.p95 / 1000)} s (${x.seg_label})`, 'integrations'); }
  const rank = { P1: 0, P2: 1, P3: 2, info: 3 };
  return { business: F.filter(f => f.kind === 'business').sort((a, b) => rank[a.sev] - rank[b.sev]), technical: F.filter(f => f.kind === 'technical').sort((a, b) => rank[a.sev] - rank[b.sev]) };
}

const FN = { kpis, journeys, flows, plans, campaigns, payments, errors, integrations, regions };
async function all(channel, q) {
  const names = Object.keys(FN);
  const res = await Promise.all(names.map(nm => FN[nm](channel, q).catch(e => ({ error: e.message }))));
  const parts = {}; names.forEach((nm, i) => parts[nm] = res[i]);
  parts.findings = findings(parts);
  return { channel, label: CHANNELS[channel].label, desc: CHANNELS[channel].desc, segments: SEGS.map(k => ({ key: k, label: SEG_LABEL[k] })), sections: parts };
}

function mount(app, { gate, wrap, requireView }) {
  // each channel page is its own matrix column: fixed_epurchase / fixed_salamhome
  const chGate = (req, res, next) => { const v = 'fixed_' + String(req.params.channel || ''); return requireView ? requireView(v)(req, res, next) : gate(req, res, next); };
  app.get('/api/fixed/channel/:channel/all', chGate, wrap((q, req) => all(req.params.channel, q)));
  app.get('/api/fixed/channel/:channel/:section', chGate, wrap((q, req) => {
    const s = req.params.section; if (!FN[s]) { const e = new Error('unknown section'); e.status = 404; throw e; }
    return FN[s](req.params.channel, q);
  }));
}
module.exports = { mount, all, findings, SECTIONS, CHANNELS, SEGS, SEG_LABEL, SEG_SQL, FTTX };
