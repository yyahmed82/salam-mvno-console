/* execBrief.js — the CEO / CIO brief behind the Executive Dashboard v2 (16 Sep 2026)
 *
 *   GET /api/exec/brief?month=YYYY-MM     any signed-in user; each business only if the caller holds its view
 *
 * Five questions, one block each, calendar month (KSA) with the previous month beside it:
 *   status    are we OK right now — per business: state from OPEN P1/P2 only (never from chronic SLOs) — OUTAGE only for
 *             a service P1, CASE / DEGRADED / BLIND otherwise (stateOf, alpha.152) — customers affected now
 *             (alerts.customers of the open P1/P2), since when, who has it
 *   impact    what did it cost us — the OUTAGE REGISTER: every P1 incident of the month (≥ 5 min or still open),
 *             minutes (union per business, so two overlapping P1s are not counted twice) of SERVICE incidents only —
 *             business cases and monitoring-blind P1s are listed but are not downtime (alpha.152), customer contacts,
 *             SAR at risk (money rules only), the probable cause Agent 2 recorded, RCA due / overdue / not recorded
 *   vendors   are the vendors delivering — per contract (vendorContracts.js: Sigma ↔ Fixed, TCS ↔ Mobile) and per
 *             obligation, target from the contract vs actual from the alerts table:
 *               response    = ack_at − opened_wall           restoration = resolved_at − opened_wall
 *               rca         = due date = resolved_at + clause (no rca table yet → 'not recorded')
 *               availability= 1 − P1 outage minutes ÷ month minutes (customer-facing, from incidents)
 *             candidate penalty = weight % × eligible monthly fee (fee unset → reported as not configured)
 *   actions   what are we doing — open P1/P2 with owner and age, RCAs due and overdue
 *   kpis      north-star tiles from the exec contract (mvnoExec / fixedExec), unmeasured ones dropped
 *
 * WHAT IS REAL AND WHAT IS NOT: every number here is computed from the console's own alerts / contracts / KPI
 * code paths — nothing is estimated. Where the console cannot measure an obligation (resolution tickets,
 * performance, governance) the row says 'not measured by this console'. Business-day targets (TCS P3/P4) are
 * compared as calendar days and flagged. Read-only: nothing here writes. */
'use strict';
const db = require('./db');
const SEG = require('./segment');
const vendorContracts = require('./vendorContracts');

const n = v => Number(v) || 0;
const KSA = 3 * 3600e3;
const BIZ = { mvno: { biz: 'mobile', label: 'Mobile', view: 'dashboard' }, fixed: { biz: 'fixed', label: 'Fixed', view: 'fixed' } };
const MIN_OUTAGE_MIN = 5;

/* ---------------------------------------------------------------- month window (KSA calendar month) */
function monthWindow(m) {
  const now = new Date(Date.now() + KSA);
  let y = now.getUTCFullYear(), mo = now.getUTCMonth();
  if (/^\d{4}-\d{2}$/.test(String(m || ''))) { y = +m.slice(0, 4); mo = +m.slice(5, 7) - 1; }
  const from = new Date(Date.UTC(y, mo, 1) - KSA), to = new Date(Date.UTC(y, mo + 1, 1) - KSA);
  const prevFrom = new Date(Date.UTC(y, mo - 1, 1) - KSA);
  const key = `${y}-${String(mo + 1).padStart(2, '0')}`;
  const pk = new Date(prevFrom.getTime() + KSA);
  return { key, from: from.toISOString(), to: to.toISOString(), prev: { key: `${pk.getUTCFullYear()}-${String(pk.getUTCMonth() + 1).padStart(2, '0')}`, from: prevFrom.toISOString(), to: from.toISOString() },
    elapsedMin: Math.max(1, Math.round((Math.min(Date.now(), to.getTime()) - from.getTime()) / 60000)), current: Date.now() < to.getTime() && Date.now() >= from.getTime() };
}

/* ---------------------------------------------------------------- contract targets */
const TARGET_RX = /(<|≤)?\s*(\d+(?:\.\d+)?)\s*(min|minute|minutes|h|hr|hour|hours|d|day|days|business day|business days|bd)/i;
function targetMinutes(text) {
  const m = TARGET_RX.exec(String(text || '')); if (!m) return null;
  const v = Number(m[2]), u = m[3].toLowerCase();
  const business = /business|bd/.test(u);
  const mins = /min/.test(u) ? v : /^h/.test(u) ? v * 60 : v * 1440;
  return { minutes: mins, business, text: String(text) };
}
const pctOf = s => { const m = /(\d+(?:\.\d+)?)\s*%/.exec(String(s || '')); return m ? Number(m[1]) : null; };

function vendorFor(cfg, biz) {
  const as = (cfg.assignments || []).filter(a => a.business === biz || a.business === 'both');
  const pick = as.find(a => a.business === biz) || as[0];
  if (!pick) return null;
  const vendor = (cfg.vendors || []).find(v => v.id === pick.vendorId) || null;
  const contract = (cfg.contracts || []).find(c => c.vendorId === pick.vendorId && (c.businessScope || []).includes(biz)) || (cfg.contracts || []).find(c => c.vendorId === pick.vendorId) || null;
  return vendor && { vendor, contract, assignment: pick };
}

/* ---------------------------------------------------------------- alerts of one business in a window */
async function alertsIn(seg, from, to) {
  const W = SEG.sqlWhere('a', 'rule_key', seg) + SEG.appOnly('a');   // infra incidents never drive the executive status
  const r = await db.console.query(
    `SELECT a.id, a.rule_key, a.name, a.severity, a.team, a.status, a.customers, a.services, a.observed_value, a.peak_value,
            a.fired_at, COALESCE(a.opened_wall, a.fired_at) AS opened, a.resolved_at, a.ack_at, a.ack_by, a.assignee, a.sn_number, a.resolve_reason,
            t.probable_cause, t.impact AS triage_impact, r.alert_class AS rule_class
       FROM alerts a
       LEFT JOIN agent_triage t ON t.alert_id = a.id
       LEFT JOIN alert_rules r ON r.key = a.rule_key
      WHERE ${W} AND COALESCE(a.opened_wall, a.fired_at) < $2::timestamptz
        AND (a.resolved_at IS NULL OR a.resolved_at >= $1::timestamptz)
      ORDER BY COALESCE(a.opened_wall, a.fired_at)`, [from, to]);
  return r.rows;
}
const minutesOf = (a, now) => Math.round(((a.resolved_at ? new Date(a.resolved_at) : now) - new Date(a.opened)) / 60000);
const isMoney = a => /money|amount|_sar\b|revenue/i.test(a.rule_key || '');
function unionMinutes(rows, from, to, now) {
  const iv = rows.map(a => [Math.max(new Date(a.opened).getTime(), new Date(from).getTime()), Math.min((a.resolved_at ? new Date(a.resolved_at) : now).getTime(), new Date(to).getTime(), now.getTime())])
    .filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0]);
  let total = 0, cs = null, ce = null;
  for (const [s, e] of iv) { if (cs == null || s > ce) { if (cs != null) total += ce - cs; cs = s; ce = e; } else ce = Math.max(ce, e); }
  if (cs != null) total += ce - cs;
  return Math.round(total / 60000);
}

/* ---------------------------------------------------------------- what counts as downtime (alpha.152)
 * Every P1 of the month stays in the register, but only a SERVICE incident counts toward customer-facing time and
 * availability: a technical-class rule, i.e. the platform or a partner failing. Two kinds are listed and NOT counted:
 *   business    alert_class 'business' — card-decline / refusal storms, refunds missing, charged-but-failed cases. They
 *               hurt customers and are followed as cases, but the service was up.
 *   monitoring  the console blind to one of its own feeds (read model / collector stale) — nobody can say the service
 *               was down, only that we could not see it.
 * Before this, one P1 case left open across the month read "Fixed 0% available" on the Executive and VP pages. */
const MONITORING_RX = /(^|_)(ingest|collector)_stale|read model stale|board blind|collector stale/i;
const kindOf = a => (MONITORING_RX.test(a.rule_key || '') || MONITORING_RX.test(a.name || '')) ? 'monitoring' : a.rule_class === 'business' ? 'business' : 'service';

/* ---------------------------------------------------------------- the state right now (alpha.152)
 * Read from the open P1 / P2 incidents with the same three kinds, so the state and the month's availability cannot
 * disagree ("Outage" while 99.9 % available). Real customer impact first, blindness last:
 *   OUTAGE    a P1 service incident is open — the platform or a partner is failing (this is what counts as downtime)
 *   CASE      a P1 business case is open — charged-but-failed, refunds missing, decline storms… the service is up
 *   DEGRADED  a P2 is open (service or business)
 *   BLIND     only monitoring incidents are open — the console cannot read a feed, so the state is not known
 *   OK        nothing open at P1 / P2
 * Before alpha.152 any open P1 read OUTAGE, a business case or a stale read model included. */
const STATE_ORDER = [['P1', 'service', 'OUTAGE'], ['P1', 'business', 'CASE'], ['P2', 'service', 'DEGRADED'], ['P2', 'business', 'DEGRADED'], ['P1', 'monitoring', 'BLIND'], ['P2', 'monitoring', 'BLIND']];
const STATE_NOTE = { OUTAGE: 'a P1 service incident is open', CASE: 'a P1 business case is open — the service is up', DEGRADED: 'a P2 incident is open',
  BLIND: 'only a monitoring incident is open — the console cannot read one of its feeds, so the state is not known', OK: 'no P1 / P2 incident open' };
function stateOf(open) {
  for (const [sev, kind, state] of STATE_ORDER) {
    const hit = open.filter(a => a.severity === sev && kindOf(a) === kind);
    if (hit.length) { const top = hit.slice().sort((a, b) => n(b.customers) - n(a.customers) || new Date(a.opened || a.fired_at) - new Date(b.opened || b.fired_at))[0];
      return { state, kind, top, note: STATE_NOTE[state] }; }
  }
  return { state: 'OK', kind: null, top: null, note: STATE_NOTE.OK };
}

/* ---------------------------------------------------------------- P1 time from the severity timeline (alpha.154)
 * An incident's severity moves while it is open: a twin rule crosses from the P2 anomaly into the P1 storm and back, a
 * customer floor lowers it, a re-fire raises it. alertRunner writes every move as a system comment
 * "Severity P2 → P1: …". Counting the whole life of every row whose severity is P1 *now* made a P2 anomaly that was
 * open for a day count as a day of P1 the moment it touched P1, and missed P1 periods of rows that stepped back to P2.
 * Fixed read "0.00 % available · 44 service incidents (8 d 3 h)" on 9 Oct. Only the P1 periods count now. */
const SEV_MOVE_RX = /^Severity (P\d) → (P\d)/;
async function severityMoves(rows) {
  const ids = [...new Set(rows.map(a => a.id).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const r = await db.console.query(
    `SELECT alert_id, created_at, body FROM incident_comments
      WHERE alert_id = ANY($1::bigint[]) AND author = 'system' AND body LIKE 'Severity P_ → P_%' ORDER BY alert_id, created_at`, [ids])
    .catch(e => { console.error('[execBrief] severity moves:', e.message); return { rows: [] }; });
  const m = new Map();
  for (const x of r.rows) { const mm = SEV_MOVE_RX.exec(x.body || ''); if (!mm) continue; const k = String(x.alert_id);
    if (!m.has(k)) m.set(k, []); m.get(k).push({ at: new Date(x.created_at).getTime(), from: mm[1], to: mm[2] }); }
  return m;
}
/* the periods an incident spent at P1 — [start, end] in ms; with no recorded move, its severity covers its whole life */
function p1Spans(a, moves, now) {
  const start = new Date(a.opened).getTime(), end = (a.resolved_at ? new Date(a.resolved_at) : now).getTime();
  if (!(end > start)) return [];
  const mv = ((moves && moves.get(String(a.id))) || []).filter(x => x.at > start && x.at < end);
  let sev = mv.length ? mv[0].from : a.severity, t = start; const out = [];
  for (const x of mv) { if (sev === 'P1' && x.at > t) out.push([t, x.at]); sev = x.to; t = x.at; }
  if (sev === 'P1' && end > t) out.push([t, end]);
  return out;
}
/* minutes covered by a set of spans inside [from, to] — overlaps counted once */
function unionSpanMinutes(spans, from, to) {
  const iv = spans.map(([s, e]) => [Math.max(s, from), Math.min(e, to)]).filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0]);
  let total = 0, cs = null, ce = null;
  for (const [s, e] of iv) { if (cs == null || s > ce) { if (cs != null) total += ce - cs; cs = s; ce = e; } else ce = Math.max(ce, e); }
  if (cs != null) total += ce - cs;
  return Math.round(total / 60000);
}

/* ---------------------------------------------------------------- the register + impact totals */
function register(rows, win, now, vend, moves) {
  const rcaOb = vend && vend.obligations.find(o => o.category === 'rca');
  const rcaT = rcaOb ? targetMinutes((rcaOb.target || {}).P1 || Object.values(rcaOb.target || {})[0]) : null;
  const F = new Date(win.from).getTime(), T = Math.min(new Date(win.to).getTime(), now.getTime());
  const spanMin = sp => Math.round(sp.reduce((t, [p, q]) => t + (q - p), 0) / 60000);
  /* an incident is in the register when it spent ≥ 5 min at P1, or is open at P1 right now */
  const outages = rows.map(a => ({ a, spans: p1Spans(a, moves, now) }))
    .filter(({ a, spans }) => spans.length && ((a.status === 'open' && a.severity === 'P1') || spanMin(spans) >= MIN_OUTAGE_MIN));
  const list = outages.map(({ a, spans }) => {
    /* minutes = its P1 time CLIPPED to the month (an incident open since July counts only its September minutes here);
       lifetimeMin = its whole P1 time, lifeMin = its whole life at any severity, for the record */
    const openAtP1 = a.status === 'open' && a.severity === 'P1';
    const mins = unionSpanMinutes(spans, F, T), lifetimeMin = spanMin(spans), lifeMin = minutesOf(a, now);
    let rca = { status: 'n/a', text: 'no RCA clause in this contract' };
    if (rcaT) {                                                          // every row here spent time at P1
      if (!a.resolved_at) rca = { status: 'pending', text: `due ${rcaT.text} after restoration` };
      else { const due = new Date(new Date(a.resolved_at).getTime() + rcaT.minutes * 60000); rca = { status: due < now ? 'overdue' : 'due', due: due.toISOString(), text: 'not recorded' }; }
    }
    const kind = kindOf(a);
    return { id: a.id, rule_key: a.rule_key, name: a.name || a.rule_key, severity: 'P1', severityNow: a.severity, status: openAtP1 ? 'open' : 'resolved', incidentStatus: a.status,
      started: new Date(spans[0][0]).toISOString(), ended: openAtP1 ? null : new Date(spans[spans.length - 1][1]).toISOString(), opened: a.opened, minutes: mins, lifetimeMin, lifeMin,
      p1Periods: spans.length, kind, downtime: kind === 'service',
      customers: a.customers == null ? null : n(a.customers), money: isMoney(a) ? n(a.peak_value || a.observed_value) : null,
      owner: a.assignee || a.ack_by || null, ticket: a.sn_number || null, team: a.team || null, cause: a.probable_cause || null, rca };
  });
  const service = outages.filter(({ a }) => kindOf(a) === 'service');
  return { list, incidents: list.length, minutes: unionSpanMinutes(service.flatMap(x => x.spans), F, T), allMinutes: unionSpanMinutes(outages.flatMap(x => x.spans), F, T),
    service: service.length, business: list.filter(x => x.kind === 'business').length, monitoring: list.filter(x => x.kind === 'monitoring').length,
    customers: list.reduce((s, x) => s + n(x.customers), 0), money: Math.round(list.reduce((s, x) => s + n(x.money), 0)), open: list.filter(x => x.status === 'open').length };
}

/* ---------------------------------------------------------------- vendor delivery per obligation */
function measure(rows, ob, now, availabilityPct) {
  const out = { id: ob.id, title: ob.title, category: ob.category, weight: ob.weight || null, attainmentTarget: ob.attainmentTarget || null, rows: [], measured: true, note: null };
  const sevs = ['P1', 'P2', 'P3', 'P4'];
  if (ob.category === 'incident_response' || ob.category === 'restoration') {
    const isResp = ob.category === 'incident_response';
    for (const sev of sevs) {
      const t = targetMinutes((ob.target || {})[sev]); if (!t) continue;
      const set = rows.filter(a => a.severity === sev && (a.status === 'open' || minutesOf(a, now) >= MIN_OUTAGE_MIN));   // blips that self-clear in < 5 min are not incidents
      const vals = [], breaches = [];
      for (const a of set) {
        /* response: acknowledgement, or — when nobody acknowledged and it cleared by itself — the clearing time
         * (the vendor never touched it; short self-clears are fine, long unacknowledged ones are breaches) */
        const end = isResp ? (a.ack_at || a.resolved_at) : a.resolved_at;
        const mins = end ? Math.round((new Date(end) - new Date(a.opened)) / 60000) : Math.round((now - new Date(a.opened)) / 60000);
        if (end) { vals.push(mins); if (mins > t.minutes) breaches.push(a.id); }
        else if (mins > t.minutes) { breaches.push(a.id); vals.push(mins); }   // still waiting and already past target
        /* still open and within target: not a sample yet */
      }
      const sorted = vals.slice().sort((x, y) => x - y);
      const q = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
      const samples = vals.length, met = samples - breaches.length;
      out.rows.push({ sev, target: t.text, targetMin: t.minutes, business: t.business, samples, median: q(0.5), p90: q(0.9), met, breaches: breaches.length,
        metPct: samples ? Math.round(met / samples * 1000) / 10 : null, ok: samples ? breaches.length === 0 : null, alertIds: breaches.slice(0, 50) });
    }
  } else if (ob.category === 'rca') {
    const t = targetMinutes((ob.target || {}).P1 || Object.values(ob.target || {})[0]);
    const set = rows.filter(a => ['P1', 'P2'].includes(a.severity) && a.resolved_at && minutesOf(a, now) >= MIN_OUTAGE_MIN);
    const overdue = t ? set.filter(a => new Date(a.resolved_at).getTime() + t.minutes * 60000 < now.getTime()).length : 0;
    out.rows.push({ sev: 'P1/P2', target: t ? t.text : '—', samples: set.length, recorded: 0, due: set.length - overdue, overdue, ok: set.length ? overdue === 0 : null });
    out.note = 'RCA records are not tracked by the console yet — every due RCA shows as not recorded';
  } else if (ob.category === 'availability') {
    const tgt = pctOf((ob.target || {}).availability) || pctOf(ob.attainmentTarget) || pctOf(Object.values(ob.target || {})[0]);
    out.rows.push({ sev: 'month', target: tgt != null ? `${tgt}%` : '—', targetPct: tgt, actualPct: availabilityPct, ok: tgt != null && availabilityPct != null ? availabilityPct >= tgt : null });
    out.note = 'customer-facing availability from SERVICE P1 incident minutes (union) ÷ elapsed month minutes — business cases and monitoring gaps are not downtime; not a synthetic probe';
  } else { out.measured = false; out.note = 'not measured by this console (needs ticket / performance / governance evidence)'; }
  return out;
}
function penalty(cfg, contract, ob, breached) {
  const rule = (cfg.penaltyRules || []).find(r => r.obligationId === ob.id && r.enabled !== false);
  const fee = contract && contract.eligibleMonthlyFeeSar != null ? Number(contract.eligibleMonthlyFeeSar) : null;
  const w = rule && rule.weightPercent != null ? Number(rule.weightPercent) : pctOf(ob.weight);
  if (w == null) return { candidateSar: null, note: 'no weight in the penalty model' };
  if (fee == null) return { candidateSar: null, weightPct: w, note: 'eligible monthly fee not configured (Vendors & contracts › Penalty model)' };
  return { candidateSar: breached ? Math.round(fee * w / 100) : 0, weightPct: w, note: 'candidate — subject to evidence, exclusions and contract-owner validation' };
}

/* ---------------------------------------------------------------- one business */
async function business(seg, win, now, cfg, deps, q) {
  const B = BIZ[seg];
  const [rows, prevRows] = await Promise.all([alertsIn(seg, win.from, win.to), alertsIn(seg, win.prev.from, win.prev.to)]);
  const moves = await severityMoves([...rows, ...prevRows]);                 // the P1 periods of every incident (alpha.154)
  const v = vendorFor(cfg, B.biz);
  const vend = v && { ...v, obligations: (cfg.obligations || []).filter(o => o.vendorId === v.vendor.id && ((o.appliesTo || {}).business || []).includes(B.biz)) };
  const reg = register(rows, win, now, vend, moves), prev = register(prevRows, win.prev, new Date(Math.min(now.getTime(), new Date(win.prev.to).getTime())), vend, moves);
  const availabilityPct = Math.round((1 - reg.minutes / win.elapsedMin) * 100000) / 1000;
  const prevElapsed = Math.max(1, Math.round((new Date(win.prev.to) - new Date(win.prev.from)) / 60000));
  const prevAvail = Math.round((1 - prev.minutes / prevElapsed) * 100000) / 1000;

  const open = rows.filter(a => a.status === 'open' && ['P1', 'P2'].includes(a.severity));
  const openP1 = open.filter(a => a.severity === 'P1'), openP2 = open.filter(a => a.severity === 'P2');
  const since = open.length ? open.map(a => a.opened).sort()[0] : null;
  const st = stateOf(open);
  const kinds = { service: 0, business: 0, monitoring: 0 }; open.forEach(a => { kinds[kindOf(a)]++; });
  const status = { biz: B.biz, label: B.label, state: st.state, stateKind: st.kind, stateNote: st.note, openKinds: kinds,
    affectedNow: open.reduce((s, a) => s + n(a.customers), 0), estimated: open.some(a => a.customers != null), openP1: openP1.length, openP2: openP2.length, since,
    what: st.top ? (st.top.name || st.top.rule_key) : null,
    owner: st.top ? (st.top.assignee || st.top.ack_by || null) : null, vendor: vend ? vend.vendor.name : null };

  const obligations = vend ? vend.obligations.map(ob => { const m = measure(rows, ob, now, availabilityPct); const breached = m.measured && m.rows.some(r => r.ok === false); return { ...m, breached, penalty: penalty(cfg, vend.contract, ob, breached) }; }) : [];
  const capPct = vend && vend.contract && vend.contract.monthlyPenaltyCapPercent != null ? Number(vend.contract.monthlyPenaltyCapPercent) : null;
  const fee = vend && vend.contract && vend.contract.eligibleMonthlyFeeSar != null ? Number(vend.contract.eligibleMonthlyFeeSar) : null;
  const raw = obligations.reduce((s, o) => s + n(o.penalty.candidateSar), 0);
  const vendor = vend ? { id: vend.vendor.id, name: vend.vendor.name, contract: vend.contract ? { id: vend.contract.id, title: vend.contract.title, status: vend.contract.status, capPct, feeConfigured: fee != null } : null,
    obligations, exposureSar: fee == null ? null : (capPct != null ? Math.min(raw, Math.round(fee * capPct / 100)) : raw), breaches: obligations.filter(o => o.breached).length, measured: obligations.filter(o => o.measured).length } : null;

  const actions = { open: open.sort((a, b) => (a.severity > b.severity ? 1 : a.severity < b.severity ? -1 : new Date(a.opened) - new Date(b.opened))).slice(0, 5)
      .map(a => ({ id: a.id, name: a.name || a.rule_key, severity: a.severity, kind: kindOf(a), ageMin: Math.round((now - new Date(a.opened)) / 60000), owner: a.assignee || a.ack_by || null, acked: !!a.ack_at, ticket: a.sn_number || null, customers: a.customers == null ? null : n(a.customers), cause: a.probable_cause || null })),
    rca: { due: reg.list.filter(x => x.rca.status === 'due').length, overdue: reg.list.filter(x => x.rca.status === 'overdue').length, pending: reg.list.filter(x => x.rca.status === 'pending').length, recorded: 0,
      items: reg.list.filter(x => ['due', 'overdue'].includes(x.rca.status)).map(x => ({ id: x.id, name: x.name, ended: x.ended, due: x.rca.due, status: x.rca.status, vendor: vend ? vend.vendor.name : null })) } };

  let kpis = [];
  try {
    const h = seg === 'fixed' ? await deps.fixedExec.exec({ range: '7d' }) : await deps.mvnoExec.exec({ range: '7d' }, deps.execDeps);
    kpis = (h.kpis || []).filter(k => k.exec && k.value !== '—' && k.value != null).map(k => ({ key: k.key, title: k.title, value: k.value, sub: k.sub, tone: k.tone, delta: k.delta, href: k.href, window: k.window }));
  } catch (e) { console.error('[execBrief] kpis', seg, e.message); }

  return { biz: B.biz, label: B.label, status, impact: { ...reg, availabilityPct, prev: { incidents: prev.incidents, service: prev.service, minutes: prev.minutes, customers: prev.customers, money: prev.money, availabilityPct: prevAvail } }, vendor, actions, kpis };
}

function mount(app, deps) {
  app.get('/api/exec/brief', async (req, res) => {
    try {
      const views = req.views || [], bz = req.business || 'both';
      const wantM = views.includes('dashboard') && bz !== 'fixed', wantF = views.includes('fixed') && bz !== 'mobile';
      const win = monthWindow(req.query.month), now = new Date();
      const cfg = await vendorContracts.getConfig().catch(e => { console.error('[execBrief] contracts', e.message); return vendorContracts.normalizeConfig({}); });
      const one = seg => business(seg, win, now, cfg, deps).catch(e => { console.error(`[execBrief] ${seg} failed:`, e.message); return { configured: false, biz: BIZ[seg].biz, label: BIZ[seg].label, reason: e.message }; });
      const [mobile, fixed] = await Promise.all([wantM ? one('mvno') : null, wantF ? one('fixed') : null]);
      res.json({ generatedAt: now.toISOString(), month: { key: win.key, from: win.from, to: win.to, current: win.current, prevKey: win.prev.key, elapsedMin: win.elapsedMin },
        rules: { outage: `P1 incident open ≥ ${MIN_OUTAGE_MIN} min or still open`, kinds: 'service = technical rule (counts as downtime) · business = business rule (listed, not downtime) · monitoring = a console feed unread (listed, not downtime)',
          minutes: 'union of the periods SERVICE incidents spent at P1 (from the severity moves), per business, clipped to the month', customers: 'sum of distinct customers per incident (contacts, not de-duplicated across incidents)', money: 'SAR from money-at-risk rules only',
          availability: '1 − service P1 minutes ÷ elapsed month minutes', state: 'OUTAGE = P1 service open · CASE = P1 business case open · DEGRADED = P2 open · BLIND = only monitoring open · OK' },
        mobile, fixed });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
module.exports = { mount, monthWindow, targetMinutes, unionMinutes, register, measure, kindOf, stateOf, p1Spans, severityMoves };
