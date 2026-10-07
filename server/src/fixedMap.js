/* fixedMap.js — Fixed sub-pages "SDA map" (/api/fixed/map/*) and "QR codes" (/api/fixed/qr/*).
 *
 * Ported 1:1 from salam-dealer-ops packages/api/src/{filters.ts, workflow-steps.ts, funnel.ts,
 * routers/activity.ts, routers/dealers.ts, routers/referrals.ts, routers/dashboards.ts (qr), routers/trace.ts}
 * — Prisma → pg, so the numbers match the prod operations console.
 *
 * Scope = f360.parseScope(q) (window · channel · consumer-direct · workflow · region · dealerId) plus the
 * console's extra filter dimensions, all parameterised:
 *   regions=Central,Western   roles=ADMIN,ACTIVATOR,PROMOTER   plans=ftth,fttb,fiveGWhiteLabel,fiveGFWA,promoters
 *   outcomes=COMPLETED,STALLED,…   referral=<code>   consent=all|consented|noconsent
 *   nafath=all|not_completed|timeout|rejected   semati=all|failed|mobile_exists
 * Read-only, LIMITed, identifiers cut down to last digits (bodies in api_calls are masked at rest).
 * Unmask = req.caps.unmaskPII AND q.unmask=1 → raw workflow_states.context from nexus, audited (pii.unmask). */

/* ---- canonical step order per workflow (workflow-steps.ts) ---- */
const STEPS = {
  ftth: ['feasibilityCheck', 'selectAppointment', 'customerProfile', 'createCustomer', 'confirmOtp', 'jarirPayment', 'submitOrder', 'reviewOrder'],
  fttb: ['businessCustomerProfile', 'createCustomer', 'confirmOtp', 'feasibilityCheck', 'selectAppointment', 'submitOrder', 'reviewOrder'],
  fiveGWhiteLabel: ['geoFeasibilityCheck', 'customerProfile', 'createCustomer', 'confirmOtp', 'iccidInfo', 'nafathCheck', 'submitOrder', 'reviewOrder'],
  fiveGFWA: ['geoFeasibilityCheck', 'selectAppointment', 'customerProfile', 'createCustomer', 'confirmOtp', 'iccidInfoSalamNetwork', 'nafathCheck', 'submitOrder', 'reviewOrder'],
  promoters: ['promotersFeasibilityCheck', 'customerProfile', 'promotersConfirmOtp', 'promotersReviewOrder'],
  ePurchaseFTTH: ['ePurchaseCustomerProfile', 'ePurchaseFeasibilityCheck', 'ePurchaseSubmitOrder', 'ePurchaseOrderSummary', 'ePurchasePayment',
    'ePurchaseCustomerProfileVerification', 'ePurchaseConfirmOtp', 'ePurchaseReviewOrder'],
  /* 5G HomeFi on the web / in the Salam Home app, device delivered by Naqeel (salam-nexus 30 Sep 2026). The prod ingest
   * stores these as workflow 'fiveGWhiteLabel' + channel 'epurchase' — fixedChannel switches to this list for them. */
  ePurchase5GWhiteLabel: ['ePurchaseGeoFeasibilityCheck', 'ePurchaseCustomerProfile', 'ePurchaseNafathCheck', 'ePurchaseOrderSummary', 'ePurchasePayment',
    'ePurchaseCustomerProfileVerification', 'ePurchaseConfirmOtp', 'ePurchaseReviewOrder'],
};
const PLAN_LABEL = { ftth: 'FTTH', fttb: 'FTTB', fiveGWhiteLabel: '5G HomeFI', fiveGFWA: '5G FWA', promoters: 'Lead', ePurchaseFTTH: 'FTTH (e-Purchase/QR)', ePurchase5GWhiteLabel: '5G HomeFi (e-Purchase · Naqeel)' };
const stepsFor = wf => (wf && STEPS[wf]) || [];

/* funnel.ts → computeFunnelFromCounts: groups = [{outcome, step_reached, count}] */
function funnelFromCounts(steps, groups) {
  const reach = new Array(steps.length).fill(0), L = steps.length;
  for (const g of groups) {
    let idx;
    if (g.outcome === 'COMPLETED') idx = L;
    else { const f = g.step_reached ? steps.indexOf(g.step_reached) : -1; idx = f >= 0 ? f : Math.max(L - 3, 0); }
    const capped = Math.min(idx, L);
    for (let i = 0; i < capped; i++) reach[i] += g.count;
  }
  return steps.map((step, i) => { const count = reach[i]; const prev = i === 0 ? count : reach[i - 1]; return { step, count, drop: prev > 0 ? prev - count : 0 }; });
}
function dominantWorkflow(groups) {   // groups = [{workflow, n}]
  let best = -1, wf = null;
  for (const g of groups) if (g.workflow !== 'unknown' && Number(g.n) > best) { best = Number(g.n); wf = g.workflow; }
  return wf;
}

/* trace.ts → step / call classification */
function stepKind(step) {
  const s = String(step).toLowerCase();
  if (/feasibil/.test(s)) return 'feasibility'; if (/appointment/.test(s)) return 'appointment'; if (/verification/.test(s)) return 'verify';
  if (/createcustomer/.test(s)) return 'create'; if (/customerprofile|customer/.test(s)) return 'customer'; if (/otp/.test(s)) return 'otp';
  if (/iccid/.test(s)) return 'iccid'; if (/nafath/.test(s)) return 'nafath'; if (/submitorder/.test(s)) return 'submit'; if (/revieworder/.test(s)) return 'review';
  return null;
}
function callKind(endpoint) {
  const e = String(endpoint || '').toLowerCase();
  if (/salamcheckplateno|feasibil|checkorder5gsubsplan/.test(e)) return 'feasibility'; if (/queryappointment/.test(e)) return 'appointment';
  if (/querycustlist|salamchecknid|querycontactnumber/.test(e)) return 'customer'; if (/createcustomerinfos|createaccount|updatecustomerinfos/.test(e)) return 'create';
  if (/checkvalidatecode|sendabshervalidatecode/.test(e)) return 'otp'; if (/iccid/.test(e)) return 'iccid'; if (/checknafath|nafath/.test(e)) return 'nafath';
  if (/submitorder4drm|salamnewconnection|submitorder/.test(e) && !/queryorder|orderlist/.test(e)) return 'submit';
  return null;
}

/* ---- helpers ---- */
const FROM = `FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id`;
const n = v => Number(v) || 0;
const pct100 = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;          // console rounds conversion to whole %
const tail = (s, k) => s == null || s === '' ? null : '…' + String(s).slice(-k);
const maskAttempt = r => ({ ...r, msisdn: tail(r.msisdn, 4), iccid: tail(r.iccid, 6), cpe: tail(r.cpe, 4), service_no: tail(r.service_no, 6),
  cust_code: tail(r.cust_code, 4), customer_id: tail(r.customer_id, 4) });
const outsideKsa = (lat, lng) => lat != null && lng != null && (lat < 16 || lat > 33 || lng < 34 || lng > 56);
const list = (v, re, max = 12) => String(v || '').split(',').map(s => s.trim()).filter(s => s && re.test(s)).slice(0, max);
const OUTCOMES = ['COMPLETED', 'STALLED', 'CANCELLED', 'EXPIRED', 'IN_PROGRESS'];
const ROLES = ['ADMIN', 'ACTIVATOR', 'PROMOTER'];
const WORKFLOWS = Object.keys(STEPS).concat(['unknown']);
function notConfigured() { const e = new Error('Fixed data source not configured (OPS_DATABASE_URL)'); e.status = 503; return e; }
function bad(msg) { const e = new Error(msg); e.status = 400; return e; }
const perWeekOf = (total, minTs, maxTs) => {
  if (!total || !minTs || !maxTs) return 0;
  const weeks = Math.max((new Date(maxTs) - new Date(minTs)) / (7 * 24 * 3600e3), 1 / 7);
  return Math.round((total / weeks) * 10) / 10;
};

function mount(app, deps) {
  const { gate, wrap, audit, db, f360 } = deps;
  const ops = (q) => { const p = f360.poolFor(q && q.channel); if (!p) throw notConfigured(); return p; };   // Salam Home app → beta schema

  /* scope = parseScope + the map/QR filter dimensions (filters.ts attemptWhereSql) */
  function scope(q, opt = {}) {
    const qq = { ...q };
    if (opt.qr) delete qq.channel;   // QR pages are the epurchase+referral scope by definition; the hub's channel chip must not empty them
    const s = f360.parseScope(qq);
    const P = s.params.slice(); const parts = [];
    const regions = list(q.regions, /^[\w .\-]{1,40}$/);
    if (regions.length) { P.push(regions); parts.push(`COALESCE(oa.region, d.region) = ANY($${P.length}::text[])`); }
    const roles = list(String(q.roles || '').toUpperCase(), /^[A-Z_]{1,20}$/).filter(r => ROLES.includes(r));
    if (roles.length) { P.push(roles); parts.push(`d.role::text = ANY($${P.length}::text[])`); }
    const plans = list(q.plans, /^[A-Za-z0-9]{1,30}$/).filter(w => WORKFLOWS.includes(w));
    if (plans.length) { if (plans.includes('ftth') && !plans.includes('ePurchaseFTTH')) plans.push('ePurchaseFTTH');   // FTTH chip also matches QR rows
      P.push(plans); parts.push(`oa.workflow::text = ANY($${P.length}::text[])`); }
    const outcomes = list(String(q.outcomes || '').toUpperCase(), /^[A-Z_]{1,20}$/).filter(o => OUTCOMES.includes(o));
    if (outcomes.length) { P.push(outcomes); parts.push(`oa.outcome::text = ANY($${P.length}::text[])`); }
    const referral = q.referral || q.referralCode;
    if (referral) { P.push(String(referral).slice(0, 60)); parts.push(`oa.referral_code = $${P.length}`); }
    if (q.consent === 'consented') parts.push(`oa.consent = true`); else if (q.consent === 'noconsent') parts.push(`oa.consent = false`);
    if (q.nafath === 'not_completed') parts.push(`oa.nafath_outcome IS NOT NULL AND oa.nafath_outcome <> 'COMPLETED'`);
    else if (q.nafath === 'timeout') parts.push(`oa.nafath_outcome = 'TIMEOUT'`);
    else if (q.nafath === 'rejected') parts.push(`oa.nafath_outcome = 'REJECTED'`);
    if (q.semati === 'failed') parts.push(`oa.nafath_outcome IN ('FAILED','MOBILE_EXISTS')`);
    else if (q.semati === 'mobile_exists') parts.push(`oa.nafath_outcome = 'MOBILE_EXISTS'`);
    if (opt.qr) parts.push(`oa.channel = 'epurchase'`, `oa.referral_code IS NOT NULL`);
    return { ...s, params: P, where: s.where + (parts.length ? ' AND ' + parts.join(' AND ') : ''),
      filters: { regions, roles, plans, outcomes, referral: referral || null, consent: q.consent || 'all', nafath: q.nafath || 'all', semati: q.semati || 'all' } };
  }

  /* ---- pins (activity.attempts): newest 2000 with coordinates ---- */
  async function attempts(q, opt) {
    const s = scope(q, opt);
    const lim = Math.min(2000, Math.max(50, Number(q.limit) || 2000));
    const P = s.params.concat([lim]);
    const r = await ops(q).query(`SELECT oa.id, oa.lat, oa.lng, oa.outcome::text AS outcome, oa.workflow::text AS workflow, oa.plan, oa.channel,
          oa.dealer_id, d.dealer_code, d.dealer_name, d.staff_name, d.staff_code, d.role::text AS role, d.city, oa.referral_code, oa.consent,
          COALESCE(oa.region, d.region) AS region, oa.started_at, oa.duration_s, oa.step_reached, oa.last_error_category, oa.nafath_outcome,
          oa.dealer_validation, oa.order_number
        ${FROM} ${s.where} AND oa.lat IS NOT NULL AND oa.lng IS NOT NULL ORDER BY oa.started_at DESC LIMIT $${P.length}`, P);
    return { window: { from: s.from, to: s.to }, scope: s.filters, capped: r.rows.length >= lim,
      rows: r.rows.map(a => ({ ...a, lat: Number(a.lat), lng: Number(a.lng), outsideKsa: outsideKsa(Number(a.lat), Number(a.lng)) })) };
  }

  /* ---- roster: dealers active in the window (Roster.tsx placed/done, computed in SQL over ALL rows, not the 2000 cap) ---- */
  async function roster(q) {
    const s = scope(q);
    const r = await ops(q).query(`SELECT d.id, d.staff_code, d.staff_name, d.dealer_code, d.dealer_name, d.role::text AS role, d.city, d.region,
          count(*)::int AS placed, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS done, max(oa.started_at) AS last_seen,
          (array_agg(oa.lat ORDER BY oa.started_at DESC) FILTER (WHERE oa.lat IS NOT NULL AND oa.lng IS NOT NULL))[1] AS lat,
          (array_agg(oa.lng ORDER BY oa.started_at DESC) FILTER (WHERE oa.lat IS NOT NULL AND oa.lng IS NOT NULL))[1] AS lng
        ${FROM} ${s.where} AND oa.dealer_id IS NOT NULL GROUP BY d.id ORDER BY placed DESC, done DESC LIMIT 1000`, s.params);
    return { window: { from: s.from, to: s.to }, rows: r.rows.map(x => ({ ...x, conv: pct100(x.done, x.placed),
      lat: x.lat == null ? null : Number(x.lat), lng: x.lng == null ? null : Number(x.lng) })) };
  }

  /* ---- per-dealer summary (activity.dealerSummary, current + previous window for the deltas) ---- */
  async function dealerKpis(s) {
    const Q = (sql, extra = []) => ops({ channel: s.channel }).query(sql, s.params.concat(extra));
    const [k, wf, outc] = await Promise.all([
      Q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed, avg(oa.duration_s) AS avg_duration,
                count(DISTINCT d.city)::int AS areas, min(oa.started_at) AS min_started, max(oa.started_at) AS max_started ${FROM} ${s.where}`),
      Q(`SELECT oa.workflow::text AS workflow, count(*)::int AS n ${FROM} ${s.where} GROUP BY 1 ORDER BY 2 DESC`),
      Q(`SELECT oa.outcome::text AS outcome, count(*)::int AS n ${FROM} ${s.where} GROUP BY 1`),
    ]);
    const r = k.rows[0] || {}; const total = n(r.total), completed = n(r.completed);
    const by = o => n((outc.rows.find(x => x.outcome === o) || {}).n);
    return { kpis: { attempts: total, completed, conversion: pct100(completed, total), avgDurationS: r.avg_duration != null ? Math.round(Number(r.avg_duration)) : 0,
        areas: n(r.areas), perWeek: perWeekOf(total, r.min_started, r.max_started) },
      byWorkflow: wf.rows, outcomeMix: { completed, stalled: by('STALLED'), cancelled: by('CANCELLED'), expired: by('EXPIRED'), in_progress: by('IN_PROGRESS') } };
  }
  async function dealer(q) {
    const id = String(q.id || '').slice(0, 60); if (!id) throw bad('id required');
    const s = scope({ ...q, dealerId: id });
    const prevFrom = new Date(s.from.getTime() - (s.to.getTime() - s.from.getTime()));
    const sPrev = scope({ ...q, dealerId: id, from: prevFrom.toISOString(), to: s.from.toISOString() });
    const Q = (sql, extra = []) => ops(q).query(sql, s.params.concat(extra));
    const [cur, prev, drow, weekly, daily, areas, recent] = await Promise.all([
      dealerKpis(s), dealerKpis(sPrev),
      ops(q).query(`SELECT id, staff_code, staff_name, dealer_code, dealer_name, role::text AS role, city, region, is_active FROM dealers WHERE id = $1`, [id]),
      Q(`SELECT to_char(date_trunc('week', oa.started_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD') AS week, count(*)::int AS n,
                count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed ${FROM} ${s.where} GROUP BY 1 ORDER BY 1`),
      Q(`SELECT to_char(date_trunc('day', oa.started_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD') AS date, count(*)::int AS count ${FROM} ${s.where} GROUP BY 1 ORDER BY 1`),
      Q(`SELECT COALESCE(oa.region, d.region, '—') AS region, count(*)::int AS n, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
                avg(oa.lat)::float AS lat, avg(oa.lng)::float AS lng ${FROM} ${s.where} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
      Q(`SELECT oa.id, oa.workflow::text AS workflow, oa.plan, oa.channel, oa.order_number, oa.odb, oa.iccid, oa.cpe, oa.msisdn, oa.service_no, oa.cust_code,
                oa.customer_id, oa.outcome::text AS outcome, oa.step_reached, oa.last_error_category, oa.nafath_outcome, oa.dealer_validation, oa.lat, oa.lng,
                COALESCE(oa.region, d.region) AS region, oa.started_at, oa.completed_at, oa.duration_s
         ${FROM} ${s.where} ORDER BY oa.started_at DESC LIMIT 50`),
    ]);
    // funnel of the dominant workflow (grouped counts, like the console)
    const dom = dominantWorkflow(cur.byWorkflow);
    let funnel = [];
    if (dom) { const g = await Q(`SELECT oa.step_reached, oa.outcome::text AS outcome, count(*)::int AS count ${FROM} ${s.where} AND oa.workflow::text = $${s.params.length + 1} GROUP BY 1,2`, [dom]);
      funnel = funnelFromCounts(stepsFor(dom), g.rows); }
    return { window: { from: s.from, to: s.to }, previous: { from: prevFrom, to: s.from }, dealer: drow.rows[0] || { id },
      kpis: cur.kpis, prevKpis: prev.kpis, outcomeMix: cur.outcomeMix,
      byWorkflow: cur.byWorkflow.map(w => ({ ...w, label: PLAN_LABEL[w.workflow] || w.workflow })),
      funnel: { workflow: dom, label: dom ? (PLAN_LABEL[dom] || dom) : null, steps: funnel },
      weekly: weekly.rows, daily: daily.rows, areas: areas.rows, recent: recent.rows.map(maskAttempt) };
  }

  /* ---- step funnel for the scope (activity.funnel) ---- */
  async function funnel(q, opt) {
    const s = scope(q, opt);
    const g = await ops(q).query(`SELECT oa.workflow::text AS workflow, oa.step_reached, oa.outcome::text AS outcome, count(*)::int AS count
        ${FROM} ${s.where} GROUP BY 1,2,3`, s.params);
    const byWf = {}; for (const r of g.rows) byWf[r.workflow] = (byWf[r.workflow] || 0) + r.count;
    let wf = q.workflow && STEPS[String(q.workflow)] ? String(q.workflow) : null;
    if (!wf) wf = dominantWorkflow(Object.entries(byWf).map(([workflow, c]) => ({ workflow, n: c })));
    const steps = stepsFor(wf);
    const totals = { attempts: g.rows.reduce((a, r) => a + r.count, 0), completed: g.rows.filter(r => r.outcome === 'COMPLETED').reduce((a, r) => a + r.count, 0) };
    return { window: { from: s.from, to: s.to }, workflow: wf, label: wf ? (PLAN_LABEL[wf] || wf) : null, totals, steps: funnelFromCounts(steps, g.rows.filter(r => r.workflow === wf)),
      byWorkflow: Object.entries(byWf).map(([workflow, c]) => ({ workflow, label: PLAN_LABEL[workflow] || workflow, n: c })).sort((a, b) => b.n - a.n) };
  }

  /* ---- attempt trace (trace.order): attempt + api_calls (masked at rest) + step status; optional audited unmask ---- */
  async function trace(q, req) {
    const id = String(q.id || '').slice(0, 80); if (!id) throw bad('id required');
    const TSQL = `SELECT oa.id, oa.plan, oa.plan_id, oa.workflow::text AS workflow, oa.outcome::text AS outcome, oa.step_reached, oa.started_at,
          oa.completed_at, oa.duration_s, oa.channel, oa.referral_code, oa.consent, oa.order_number, oa.odb, oa.iccid, oa.cpe, oa.msisdn, oa.service_no,
          oa.cust_code, oa.customer_id, oa.step_detail, oa.nafath_outcome, oa.dealer_validation, oa.last_error_category, oa.last_error_at, oa.lat, oa.lng,
          COALESCE(oa.region, d.region) AS region, oa.dealer_id, d.staff_name, d.staff_code, d.city, d.dealer_code, d.dealer_name, d.role::text AS role
        ${FROM} WHERE oa.id = $1`;
    let a = await ops(q).query(TSQL, [id]);
    if (!a.rows.length && db.opsBeta && ops(q) !== db.opsBeta) { q = { ...q, channel: 'salamhome' }; a = await ops(q).query(TSQL, [id]); }
    if (!a.rows.length) { const e = new Error('Attempt not found'); e.status = 404; throw e; }
    const att = a.rows[0];
    const calls = await ops(q).query(`SELECT id, method, endpoint, status, duration_ms, error_class, error_msg, info, req_body, res_body, created_at
        FROM api_calls WHERE attempt_id = $1 ORDER BY created_at ASC LIMIT 500`, [id]);
    let stepDetail = {};
    if (att.step_detail) { try { const p = typeof att.step_detail === 'string' ? JSON.parse(att.step_detail) : att.step_detail; if (p && typeof p === 'object') stepDetail = p; } catch (e) { /* malformed */ } }
    const allSteps = stepsFor(att.workflow);
    const reachedIdx = att.step_reached ? allSteps.indexOf(att.step_reached) : -1;
    const isFailure = att.outcome === 'STALLED' || att.outcome === 'CANCELLED';
    const detailByKind = new Map();
    for (const c of calls.rows) { if (c.info == null) continue; const k = callKind(c.endpoint); if (k) detailByKind.set(k, c.info); }
    const steps = allSteps.map((step, i) => {
      let status;
      if (att.outcome === 'COMPLETED') status = 'ok'; else if (reachedIdx < 0) status = 'skip'; else if (i < reachedIdx) status = 'ok';
      else if (i === reachedIdx) status = isFailure ? 'fail' : 'ok'; else status = 'skip';
      const kind = stepKind(step);
      let detail = kind ? (detailByKind.get(kind) || null) : null;
      if (detail == null) detail = stepDetail[step] != null ? String(stepDetail[step]) : null;
      if (detail == null && kind === 'review') detail = att.order_number ? 'order ' + att.order_number : null;
      return { step, status, detail };
    });
    // unmask: only with the cap AND an explicit request; raw context comes live from nexus, nothing persisted
    let unmasked = false, rawContext = null, unmaskNote = null;
    const wants = q.unmask === '1' || q.unmask === 'true';
    if (wants && req && req.caps && req.caps.unmaskPII) {
      if (!db.nexus) unmaskNote = 'NEXUS_DATABASE_URL not configured — masked view only';
      else {
        try { const r = await db.nexus.query(`SELECT context FROM workflow_states WHERE id = $1 LIMIT 1`, [id]);
          if (r.rows.length) { rawContext = r.rows[0].context; unmasked = true; } else unmaskNote = 'no live workflow_states row (purged / archived) — masked view only'; }
        catch (e) { unmaskNote = 'nexus lookup failed: ' + e.message; }
        if (audit) audit(req, 'pii.unmask', id, { page: 'fixed.map.trace', channel: att.channel, ok: unmasked });
      }
    } else if (wants) unmaskNote = 'unmask requires the unmaskPII capability';
    if (audit) audit(req, unmasked ? 'fixed.trace.unmasked' : 'fixed.trace', id, { channel: att.channel });
    const { step_detail, ...rest } = att;
    return { attempt: { ...maskAttempt(rest), outsideKsa: outsideKsa(Number(att.lat), Number(att.lng)), label: PLAN_LABEL[att.workflow] || att.workflow },
      steps, stepDetail, apiCalls: calls.rows, unmasked, rawContext, unmaskNote };
  }

  /* ---- QR (dashboards.qr + activity.aggregate qr + referrals.summary) ---- */
  async function qrSummary(q) {
    const s = scope(q, { qr: true });
    const Q = sql => ops(q).query(sql, s.params);
    const [k, outc, ts, lb, plan, region] = await Promise.all([
      Q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed, count(*) FILTER (WHERE oa.consent = true)::int AS consented,
                count(DISTINCT oa.referral_code)::int AS qr_codes ${FROM} ${s.where}`),
      Q(`SELECT oa.outcome::text AS outcome, count(*)::int AS n ${FROM} ${s.where} GROUP BY 1`),
      Q(`SELECT to_char(date_trunc('day', oa.started_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD') AS date, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
                count(*) FILTER (WHERE oa.outcome <> 'COMPLETED')::int AS other ${FROM} ${s.where} GROUP BY 1 ORDER BY 1`),
      Q(`SELECT oa.referral_code, count(*)::int AS orders, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed, count(*) FILTER (WHERE oa.consent = true)::int AS consented,
                avg(oa.lat)::float AS lat, avg(oa.lng)::float AS lng, mode() WITHIN GROUP (ORDER BY COALESCE(oa.region, d.region)) AS region, max(oa.started_at) AS last_seen
         ${FROM} ${s.where} GROUP BY oa.referral_code ORDER BY orders DESC LIMIT 300`),
      Q(`SELECT oa.workflow::text AS workflow, count(*)::int AS n ${FROM} ${s.where} GROUP BY 1 ORDER BY 2 DESC`),
      Q(`SELECT COALESCE(oa.region, d.region) AS region, count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed ${FROM} ${s.where} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    ]);
    const r = k.rows[0] || {}; const total = n(r.total), completed = n(r.completed);
    const by = o => n((outc.rows.find(x => x.outcome === o) || {}).n);
    const planAcc = new Map(); for (const g of plan.rows) { const l = PLAN_LABEL[g.workflow] || g.workflow; planAcc.set(l, (planAcc.get(l) || 0) + g.n); }
    return { window: { from: s.from, to: s.to }, scope: s.filters,
      kpis: { qrCodes: n(r.qr_codes), attempts: total, completed, conversion: pct100(completed, total), consentRate: total > 0 ? n(r.consented) / total : 0 },
      outcomeMix: { completed, stalled: by('STALLED'), cancelled: by('CANCELLED'), expired: by('EXPIRED'), in_progress: by('IN_PROGRESS') },
      timeseries: ts.rows,
      leaderboard: lb.rows.map(x => ({ referralCode: x.referral_code, orders: x.orders, completed: x.completed, conv: pct100(x.completed, x.orders),
        consentRate: x.orders > 0 ? x.consented / x.orders : 0, lat: x.lat, lng: x.lng, region: x.region || null, lastSeen: x.last_seen })),
      planMix: [...planAcc.entries()].sort((a, b) => b[1] - a[1]).map(([p, count]) => ({ plan: p, count })),
      regionPerf: region.rows.map(x => ({ region: x.region || 'Unknown', total: x.total, completed: x.completed, conv: pct100(x.completed, x.total) })) };
  }
  async function qrCode(q) {
    const ref = String(q.ref || q.referral || '').slice(0, 60); if (!ref) throw bad('ref required');
    const s = scope({ ...q, referral: ref }, { qr: true });
    const Q = sql => ops(q).query(sql, s.params);
    const [k, outc, daily, g, areas, recent] = await Promise.all([
      Q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed, count(*) FILTER (WHERE oa.consent = true)::int AS consented,
                count(DISTINCT (round(oa.lat::numeric,1), round(oa.lng::numeric,1))) FILTER (WHERE oa.lat IS NOT NULL AND oa.lng IS NOT NULL)::int AS areas,
                min(oa.started_at) AS min_started, max(oa.started_at) AS max_started ${FROM} ${s.where}`),
      Q(`SELECT oa.outcome::text AS outcome, count(*)::int AS n ${FROM} ${s.where} GROUP BY 1`),
      Q(`SELECT to_char(oa.started_at, 'YYYY-MM-DD') AS date, count(*)::int AS count ${FROM} ${s.where} GROUP BY 1 ORDER BY 1`),
      Q(`SELECT oa.step_reached, oa.outcome::text AS outcome, count(*)::int AS count ${FROM} ${s.where} GROUP BY 1,2`),
      Q(`SELECT COALESCE(oa.region, d.region, '—') AS region, count(*)::int AS n, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed ${FROM} ${s.where} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
      Q(`SELECT oa.id, oa.workflow::text AS workflow, oa.plan, oa.order_number, oa.odb, oa.msisdn, oa.service_no, oa.cust_code, oa.customer_id, oa.consent,
                oa.outcome::text AS outcome, oa.step_reached, oa.last_error_category, oa.lat, oa.lng, COALESCE(oa.region, d.region) AS region, oa.started_at, oa.duration_s
         ${FROM} ${s.where} ORDER BY oa.started_at DESC LIMIT 50`),
    ]);
    const r = k.rows[0] || {}; const total = n(r.total), completed = n(r.completed);
    const by = o => n((outc.rows.find(x => x.outcome === o) || {}).n);
    return { window: { from: s.from, to: s.to }, referralCode: ref,
      kpis: { attempts: total, completed, conversion: pct100(completed, total), consentRate: total > 0 ? n(r.consented) / total : 0, consented: n(r.consented),
        areas: n(r.areas), perWeek: perWeekOf(total, r.min_started, r.max_started) },
      funnel: { workflow: 'ePurchaseFTTH', label: PLAN_LABEL.ePurchaseFTTH, steps: funnelFromCounts(stepsFor('ePurchaseFTTH'), g.rows) },
      daily: daily.rows, outcomeMix: { completed, stalled: by('STALLED'), cancelled: by('CANCELLED'), expired: by('EXPIRED'), in_progress: by('IN_PROGRESS') },
      areas: areas.rows, recent: recent.rows.map(maskAttempt) };
  }

  /* ---- routes ---- */
  app.get('/api/fixed/map/attempts', gate, wrap(q => attempts(q)));
  app.get('/api/fixed/map/roster',   gate, wrap(q => roster(q)));
  app.get('/api/fixed/map/dealer',   gate, wrap(q => dealer(q)));
  app.get('/api/fixed/map/funnel',   gate, wrap(q => funnel(q)));
  app.get('/api/fixed/map/trace',    gate, wrap((q, req) => trace(q, req)));
  app.get('/api/fixed/map/steps',    gate, wrap(() => ({ steps: STEPS, labels: PLAN_LABEL })));
  app.get('/api/fixed/qr/summary',   gate, wrap(q => qrSummary(q)));
  app.get('/api/fixed/qr/attempts',  gate, wrap(q => attempts(q, { qr: true })));
  app.get('/api/fixed/qr/funnel',    gate, wrap(q => funnel({ ...q, workflow: q.workflow || 'ePurchaseFTTH' }, { qr: true })));
  app.get('/api/fixed/qr/code',      gate, wrap(q => qrCode(q)));
}

module.exports = { mount, STEPS, PLAN_LABEL, stepsFor, funnelFromCounts };
