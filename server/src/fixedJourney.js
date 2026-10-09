/* fixedJourney.js — every error on Fixed › Troubleshoot opens its whole journey (alpha.159, 9 Oct 2026).
 *
 * Asked 9 Oct: "link each error to the total journey — all the called APIs, the steps until the error, and after the
 * error: did it succeed, is the journey completed or stopped?"
 *
 * WHY nexus. The read model cannot order a journey's calls: the dealer-ops sink deletes and re-creates an attempt's
 * api_calls every time the journey changes and never sets created_at, so every call of a journey carries one time —
 * the last re-ingest (seen on prod 9 Oct: four calls of a 5G journey, one timestamp to the millisecond). nexus api_logs
 * keep each call with its own time, HTTP status and duration. A journey is one spot lookup by workflow_state_id
 * (indexed): its calls (≤ 300) and its state (current step, expiry). Without nexus — or for a journey nexus no longer
 * holds — the read-model calls are shown, flagged "times are the ingest time".
 *
 * WHAT
 *   states(ids)   Map id → { state, step, label, at } for the board's JOURNEY column. One query per page of rows,
 *                 memoised 30 s per id. completed = the journey's last step (…ReviewOrder, …Summary);
 *                 stopped = expired before it (nexus expires_at); in_progress = not expired yet.
 *   journey(...)  the panel: the journey (workflow, channel, started, last activity, outcome), the step rail
 *                 (done · error here · stopped here · current · not reached), every call in order (time, + since the
 *                 start, step, HTTP, result, ms, the errors it raised, masked request / response) and the verdict
 *                 AFTER this error: was the call retried, did a retry succeed, did the journey go on, complete or stop.
 * PII: bodies masked as on the board (secretMask.maskBodyText: customer data + SIM keys). unmask = raw customer data,
 * SIM keys still masked; the route checks unmaskPII and writes pii.unmask. */
'use strict';
const db = require('./db');
const { maskBodyText, maskSecrets } = require('./secretMask');

let MAP_STEPS = {}; try { MAP_STEPS = require('./fixedMap').STEPS || {}; } catch (_) {}
let P2P_STEPS = []; try { P2P_STEPS = require('./fixedEpWatch').STEPS_P2P || []; } catch (_) {}
const EP5 = 'ePurchase5GWhiteLabel';
const WF_ALIAS = { ePurchase: 'ePurchaseFTTH', epurchase: 'ePurchaseFTTH' };
const WF_LABEL = { ftth: 'FTTH new line (SDA)', fttb: 'FTTB new line (SDA)', fiveGWhiteLabel: '5G HomeFi new line (SDA)', fiveGFWA: '5G FWA new line (SDA)',
  promoters: 'Lead (promoters)', ePurchaseFTTH: 'FTTH e-purchase', [EP5]: '5G HomeFi e-purchase (Naqeel)', salamHomeFreeze: 'Salam Home · freeze',
  salamHomeUnFreeze: 'Salam Home · unfreeze', salamHomeRelocationFTTH: 'Salam Home · relocation (fibre)', salamHomeRelocationWL: 'Salam Home · relocation (5G)',
  salamHomeRelocationOwn: 'Salam Home · relocation (own 5G)', salamHomeChangePlan: 'Salam Home · change plan', salamHomeChangePlanPre2Post: 'Salam Home · prepaid → postpaid',
  salamHomeChangePlanPost2Pre: 'Salam Home · postpaid → prepaid', salamHomeRenew: 'Salam Home · renew' };
const CH_LABEL = { SDA: 'SDA (dealer)', E_PURCHASE: 'Epurchase', PULSE: 'Salam Home app', sda: 'SDA (dealer)', epurchase: 'Epurchase', salamhome: 'Salam Home app' };

/* ---- steps ---- */
const STEP_LABEL = {
  feasibilityCheck: 'Feasibility (ODB)', geoFeasibilityCheck: 'Coverage check', selectAppointment: 'Appointment', customerProfile: 'Customer profile',
  businessCustomerProfile: 'Business customer profile', createCustomer: 'Create customer', confirmOtp: 'OTP', jarirPayment: 'Payment (Jarir)',
  submitOrder: 'Submit order', reviewOrder: 'Order placed', iccidInfo: 'SIM / CPE lock', iccidInfoSalamNetwork: 'SIM / CPE lock', nafathCheck: 'Nafath · Semati',
  promotersFeasibilityCheck: 'Feasibility', promotersConfirmOtp: 'OTP', promotersReviewOrder: 'Lead saved',
  ePurchaseCustomerProfile: 'Customer profile', ePurchaseFeasibilityCheck: 'Feasibility (ODB)', ePurchaseSubmitOrder: 'Submit order',
  ePurchaseOrderSummary: 'Order summary', ePurchasePayment: 'Payment', ePurchaseCustomerProfileVerification: 'Verification', ePurchaseConfirmOtp: 'OTP → order',
  ePurchaseReviewOrder: 'Order placed', ePurchaseGeoFeasibilityCheck: 'Location · stock lock', ePurchaseNafathCheck: 'Nafath · Semati',
  salamHomeConfirmPlan: 'Confirm plan', salamHomeConfirmOtp: 'OTP', salamHomeChangePlanSummary: 'Summary', salamHomePayment: 'Payment', salamHomeReviewOrder: 'Done',
};
const human = s => String(s || '').replace(/^(ePurchase|salamHome|promoters)/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\bOtp\b/i, 'OTP')
  .replace(/\bIccid\b/i, 'ICCID').replace(/^./, c => c.toUpperCase()).trim();
function stepLabel(step, wf) {
  if (!step) return '—';
  if (wf === EP5 && step === 'ePurchaseConfirmOtp') return 'OTP → Naqeel order';
  return STEP_LABEL[step] || human(step) || step;
}
const COMPLETED = new Set(['reviewOrder', 'promotersReviewOrder', 'ePurchaseReviewOrder', 'salamHomeReviewOrder', 'salamHomeRelocationSummary',
  'salamHomeFreezeSummary', 'salamHomeChangePlanSummary', 'salamHomeRenewSummary']);
const isDone = s => !!s && (COMPLETED.has(s) || /ReviewOrder$/.test(s));
function stepsFor(wf) {
  const w = WF_ALIAS[wf] || wf;
  if (MAP_STEPS[w]) return MAP_STEPS[w].slice();
  if (w === 'salamHomeChangePlanPost2Pre' && P2P_STEPS.length) return P2P_STEPS.slice();
  return [];
}
/* journey state: what the board's JOURNEY column and the panel say */
function stateOf({ step, expires, outcome }) {
  if (isDone(step) || outcome === 'COMPLETED') return 'completed';
  if (expires) return Date.parse(expires) < Date.now() ? 'stopped' : 'in_progress';     // nexus knows: it wins over the read model
  if (['CANCELLED', 'EXPIRED', 'STALLED'].includes(outcome)) return 'stopped';
  return 'unknown';
}
const iso = v => { if (v == null) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d.toISOString(); };

/* ---- the board's JOURNEY column: one nexus query per page, 30 s per id ---- */
const stMemo = new Map();
async function states(ids) {
  const out = new Map(); const need = [];
  const now = Date.now();
  for (const id of new Set((ids || []).filter(Boolean).map(String))) { const h = stMemo.get(id); if (h && now - h.at < 30e3) { if (h.v) out.set(id, h.v); } else need.push(id); }
  if (need.length && db.nexus) {
    try {
      const r = await db.nexus.query(`SELECT id, workflow_id AS wf, current_step, expires_at, updated_at FROM workflow_states WHERE id = ANY($1::text[])`, [need.slice(0, 500)]);
      const got = new Set();
      for (const x of r.rows) {
        const state = stateOf({ step: x.current_step, expires: x.expires_at });
        const v = { state, step: x.current_step, label: stepLabel(x.current_step, x.wf), wf: x.wf, at: iso(state === 'completed' ? x.updated_at : x.expires_at), last: iso(x.updated_at) };
        stMemo.set(x.id, { at: now, v }); out.set(x.id, v); got.add(x.id);
      }
      for (const id of need) if (!got.has(id)) stMemo.set(id, { at: now, v: null });        // not in nexus (purged) — the read model decides
    } catch (_) { /* the column falls back to the read model */ }
    if (stMemo.size > 6000) { for (const [k, h] of stMemo) if (now - h.at > 60e3) stMemo.delete(k); }
  }
  return out;
}

/* ---- calls ---- */
const urlPath = u => { const s = String(u || ''); try { return new URL(s).pathname; } catch (_) { return s.split('?')[0].replace(/^https?:\/\/[^/]+/i, '') || s; } };
const objOf = v => { if (v && typeof v === 'object') return v; if (typeof v !== 'string') return null; try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : null; } catch (_) { return null; } };
const strOf = v => (v == null || typeof v === 'object') ? null : String(v);
/* a customer number, MSISDN or serial inside a URL path (masked views only; the unmask keeps it) */
const longDigits = v => v == null ? v : String(v).replace(/\d{6,}/g, m => '…' + m.slice(-3));
/* what kind of step a call belongs to (fixedMap.callKind, widened for the 5G and payment calls) */
function callKind(path) {
  const e = String(path || '').toLowerCase();
  if (/querysimcard|lockorunlockresource|queryaccnbr|salamquerydevicefornew|querycpe|iccid/.test(e)) return 'iccid';
  if (/salamcheckplateno|feasibil|checkorder5gsubsplan|coverage|nearestodb|geo/.test(e)) return 'feasibility';
  if (/queryappointment|appointment/.test(e)) return 'appointment';
  if (/createcustomerinfos|createaccount|updatecustomerinfos/.test(e)) return 'create';
  if (/querycustlist|salamchecknid|querycontactnumber|yakeen|checknid|customerinfo/.test(e)) return 'customer';
  if (/checkvalidatecode|sendabshervalidatecode|otp/.test(e)) return 'otp';
  if (/nafath|semati|issuenewmobile|create-?new-?mobile/.test(e)) return 'nafath';
  if (/queryfee|ordersummary/.test(e)) return 'summary';
  if (/payment|invoice|hyperpay|moyasar|sadad/.test(e)) return 'payment';
  if (/submitorder4drm|salamnewconnection|submitorder|createorder/.test(e) && !/queryorder|orderlist/.test(e)) return 'submit';
  return null;
}
function stepKind(step) {
  const s = String(step || '').toLowerCase();
  if (/iccid/.test(s)) return 'iccid'; if (/feasibil/.test(s)) return 'feasibility'; if (/appointment/.test(s)) return 'appointment';
  if (/verification/.test(s)) return 'verify'; if (/createcustomer/.test(s)) return 'create'; if (/customerprofile|customer/.test(s)) return 'customer';
  if (/otp/.test(s)) return 'otp'; if (/nafath/.test(s)) return 'nafath'; if (/ordersummary|summary$/.test(s)) return 'summary'; if (/payment/.test(s)) return 'payment';
  if (/submitorder/.test(s)) return 'submit'; if (/revieworder/.test(s)) return 'review'; return null;
}
/* the step index a call belongs to: by kind; SIM / stock calls sit in the location step of 5G e-purchase (no iccid step) */
function stepIndexOf(kind, steps) {
  if (!kind) return -1;
  let i = steps.findIndex(s => stepKind(s) === kind);
  if (i < 0 && kind === 'iccid') i = steps.findIndex(s => stepKind(s) === 'feasibility');
  if (i < 0 && kind === 'summary') i = steps.findIndex(s => stepKind(s) === 'payment');
  return i;
}
const TECH_TEXT = /(timeout|timed[ -]?out|ETIMEDOUT|ECONN|EHOSTUNREACH|socket hang up|connection (reset|refused|closed)|service unavailable|bad gateway|gateway time-?out|internal server error)/i;
/* one call, shaped for the panel. outcome: ok · no (the API answered with a NO) · fail (5xx, no answer) */
function shapeCall(r, unmask, fromModel) {
  const path = urlPath(r.endpoint);
  const name = path.split('/').filter(Boolean).pop() || path || '—';
  const resp = objOf(r.response);
  const http = r.status == null || r.status === '' || isNaN(Number(r.status)) ? null : Number(r.status);
  const code = resp ? strOf(resp.resultCode != null ? resp.resultCode : (resp.errorCode != null ? resp.errorCode : resp.code)) : null;
  let desc = resp ? strOf(resp.resultDesc || resp.errorMessage || resp.message || resp.resultMsg || resp.error || resp.status) : null;
  const noSim = /querysimcard/i.test(path) && (http == null || http < 400) && (code == null || code === '0')
    && !(Array.isArray(resp && resp.simCardDtoList) && resp.simCardDtoList.some(s => s && s.simState === 'I'));
  const empty = r.response == null || (typeof r.response === 'string' && !r.response.trim());
  let outcome = 'ok';
  if (http != null && http >= 500) outcome = 'fail';
  else if (empty && !fromModel) outcome = 'fail';
  else if (http != null && http >= 400) outcome = 'no';
  else if (code != null && !['0', '00', 'success', 'ok'].includes(String(code).toLowerCase()) && !/^2\d\d$/.test(String(code))) outcome = 'no';
  else if (noSim) { outcome = 'no'; desc = resp && Array.isArray(resp.simCardDtoList) && resp.simCardDtoList.length ? `SIM state ${resp.simCardDtoList[0].simState || '?'}, not idle` : 'no SIM returned'; }
  if (empty && !fromModel) desc = 'no answer';
  /* no HTTP status and an error text (a timeout the app logged as the "response") = the call did not get an answer */
  if (outcome === 'ok' && http == null && desc && TECH_TEXT.test(desc)) outcome = 'fail';
  const body = { method: r.method || null, url: (unmask ? r.endpoint : longDigits(r.endpoint)) || null, body: r.payload != null ? (objOf(r.payload) || r.payload) : null };
  return { id: String(r.id), at: iso(r.created_at), method: r.method || null, path, name, http, ms: r.duration == null ? null : Math.round(Number(r.duration)),
    code, desc: desc ? String(desc).replace(/\d{6,}/g, m => '…' + m.slice(-3)).slice(0, 140) : null, outcome, kind: callKind(path),
    req: fromModel ? maskBodyText(r.req_body, 3000) : (unmask ? JSON.stringify(maskSecrets(body)) : maskBodyText(body, 3000)),
    res: fromModel ? maskBodyText(r.res_body, 3000) : (unmask ? (r.response == null ? null : JSON.stringify(maskSecrets(objOf(r.response) || r.response))) : maskBodyText(r.response, 3000)),
    errors: [] };
}

/* ---- the panel ---- */
async function journey({ attemptId, event, opsPool, errorsFor, unmask = false }) {
  const notes = [];
  let ws = null, oa = null, raw = [], source = null;
  if (db.nexus) {
    try { ws = (await db.nexus.query(`SELECT id, workflow_id AS wf, channel::text AS ch, current_step, created_at, updated_at, expires_at FROM workflow_states WHERE id = $1`, [attemptId])).rows[0] || null; }
    catch (e) { notes.push('nexus: ' + e.message); }
  }
  if (opsPool) {
    try { oa = (await opsPool.query(`SELECT oa.id, oa.workflow::text AS workflow, oa.channel, oa.referral_code, oa.outcome::text AS outcome, oa.step_reached,
        oa.started_at, oa.completed_at, oa.order_number, oa.plan, COALESCE(oa.region, d.region) AS region, d.dealer_code
      FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id WHERE oa.id = $1`, [attemptId])).rows[0] || null; } catch (_) { /* attribution only */ }
  }
  if (ws) {
    try { raw = (await db.nexus.query(`SELECT id, method, endpoint, status::text AS status, duration, created_at, payload, response FROM api_logs
        WHERE workflow_state_id = $1 ORDER BY created_at ASC, id ASC LIMIT 301`, [attemptId])).rows; source = 'nexus'; }
    catch (e) { notes.push('nexus calls: ' + e.message); }
  }
  if (!source && opsPool) {
    try { raw = (await opsPool.query(`SELECT id, method, endpoint, status::text AS status, duration_ms AS duration, created_at, req_body, res_body, res_body AS response
        FROM api_calls WHERE attempt_id = $1 ORDER BY created_at ASC, id ASC LIMIT 301`, [attemptId])).rows; source = 'read model'; }
    catch (e) { notes.push('read-model calls: ' + e.message); }
    notes.push(ws ? 'nexus calls unavailable — the calls are the read model\'s copy; their times are when it stored the journey, not when each call ran'
      : 'this journey is no longer in nexus — the calls are the read model\'s copy; their times are when it stored the journey, not when each call ran');
  }
  const capped = raw.length > 300; if (capped) raw = raw.slice(0, 300);
  const fromModel = source === 'read model';
  const calls = raw.map(r => shapeCall(r, unmask, fromModel));

  /* the journey's identity and state */
  let wf = ws ? ws.wf : (oa ? oa.workflow : null);
  if (!ws && oa && oa.workflow === 'fiveGWhiteLabel' && oa.channel && oa.channel !== 'sda') wf = EP5;     // the prod ingest stores 5G e-purchase as fiveGWhiteLabel
  const steps = stepsFor(wf);
  const cur = ws ? ws.current_step : (oa ? oa.step_reached : null);
  const state = stateOf({ step: cur, expires: ws && ws.expires_at, outcome: oa && oa.outcome });
  const startedAt = iso(ws ? ws.created_at : (oa && oa.started_at)) || (calls[0] && calls[0].at);
  const lastAt = iso(ws ? ws.updated_at : (oa && (oa.completed_at || oa.started_at))) || (calls.length ? calls[calls.length - 1].at : null);
  if (cur && steps.length && !steps.includes(cur)) steps.push(cur);
  if (!steps.length && cur) steps.push(cur);
  const curIdx = cur ? steps.indexOf(cur) : -1;

  /* every error of this journey, matched to its call */
  const t0 = Date.parse(startedAt || event.occurred_at) - 3600e3, t1 = Math.max(Date.parse(lastAt || event.occurred_at), Date.parse(event.occurred_at)) + 3600e3;
  let errs = [];
  try { errs = errorsFor ? await errorsFor(new Date(t0).toISOString(), new Date(t1).toISOString()) : []; } catch (_) {}
  if (!errs.some(e => e.id === event.id)) errs.push({ ...event });
  const byPathTime = (path, at) => { const t = Date.parse(at); let best = -1, bd = 5000;
    calls.forEach((c, i) => { if (c.path !== path && !(path && (c.path.endsWith(path) || path.endsWith(c.path)))) return; const d = Math.abs(Date.parse(c.at) - t); if (d <= bd) { bd = d; best = i; } });
    return best; };
  let thisIdx = -1;
  for (const e of errs) {
    let i = -1;
    if (e.call_id) i = calls.findIndex(c => c.id === String(e.call_id));
    if (i < 0 && e.step && !fromModel) i = byPathTime(urlPath(e.step), e.occurred_at);
    if (i < 0 && e.step && fromModel) i = calls.findIndex(c => c.path === urlPath(e.step));
    e.callIndex = i;
    if (i >= 0) {
      calls[i].errors.push({ id: e.id, label: e.label || e.category, category: e.category, code: e.code || null, cls: e.cls || null, this: e.id === event.id });
      if (calls[i].outcome === 'ok') calls[i].outcome = e.cls === 'business' ? 'no' : 'fail';
    }
    if (e.id === event.id) thisIdx = i;
  }

  /* each call's step: by kind, carried forward (a journey that goes back shows the step again) */
  let si = 0;
  for (const c of calls) { const k = stepIndexOf(c.kind, steps); if (k >= 0) si = k; c.step = steps.length ? si : -1; c.stepLabel = steps.length ? stepLabel(steps[si], wf) : null; }

  /* the step the error belongs to */
  let errStep = -1;
  if (thisIdx >= 0) errStep = calls[thisIdx].step;
  else if (event.step && steps.includes(event.step)) errStep = steps.indexOf(event.step);
  else if (event.kind === 'identity') errStep = steps.findIndex(s => stepKind(s) === 'nafath');
  else if (event.kind === 'lock' || event.kind === 'paid') errStep = curIdx;

  const rail = steps.map((s, i) => {
    let st = 'todo';
    if (state === 'completed') st = 'done';
    else if (curIdx >= 0 && i < curIdx) st = 'done';
    else if (i === curIdx) st = state === 'stopped' ? 'stopped' : state === 'in_progress' ? 'current' : 'reached';
    const mine = calls.filter(c => c.step === i);
    return { step: s, label: stepLabel(s, wf), state: st, calls: mine.length, failed: mine.filter(c => c.outcome !== 'ok').length, error: i === errStep };
  });

  /* AFTER this error */
  const errAt = Date.parse(event.occurred_at);
  const after = thisIdx >= 0 ? calls.slice(thisIdx + 1) : (fromModel ? [] : calls.filter(c => Date.parse(c.at) > errAt));
  const errPath = thisIdx >= 0 ? calls[thisIdx].path : (event.step ? urlPath(event.step) : null);
  const same = errPath ? after.filter(c => c.path === errPath) : [];
  const sameOk = same.find(c => c.outcome === 'ok') || null;
  const lastStepAfter = after.length ? Math.max(...after.map(c => c.step)) : -1;
  const verdict = {
    state, step: cur, stepLabel: stepLabel(cur, wf), expiresAt: iso(ws && ws.expires_at), lastAt,
    retries: same.length, retryOk: !!sameOk, retryOkAt: sameOk ? sameOk.at : null, retryName: thisIdx >= 0 ? calls[thisIdx].name : (errPath ? errPath.split('/').pop() : null),
    callsAfter: after.length, okAfter: after.filter(c => c.outcome === 'ok').length, failedAfter: after.filter(c => c.outcome !== 'ok').length,
    wentOn: errStep >= 0 && (Math.max(curIdx, lastStepAfter) > errStep || state === 'completed'),
    reachedLabel: curIdx >= 0 ? stepLabel(steps[curIdx], wf) : null,
    orderPlaced: state === 'completed', timesReliable: !fromModel,
  };
  verdict.kind = state === 'completed' ? 'completed' : state === 'stopped' ? (verdict.retryOk || verdict.wentOn ? 'stopped_later' : 'stopped') : state === 'in_progress' ? 'in_progress' : 'unknown';
  if (!unmask) { for (const c of calls) { c.path = longDigits(c.path); c.name = longDigits(c.name); } verdict.retryName = longDigits(verdict.retryName); }

  return {
    attempt: { id: attemptId, workflow: wf, workflowLabel: WF_LABEL[wf] || wf || '—', channel: ws ? ws.ch : (oa && oa.channel), channelLabel: CH_LABEL[ws ? ws.ch : (oa && oa.channel)] || (ws ? ws.ch : (oa && oa.channel)) || '—',
      startedAt, lastAt, expiresAt: iso(ws && ws.expires_at), currentStep: cur, currentLabel: stepLabel(cur, wf), state,
      dealer: oa && oa.dealer_code || null, region: oa && oa.region || null, referral: oa && oa.referral_code || null,
      orderNumber: oa && oa.order_number && oa.order_number !== '11223344' ? '…' + String(oa.order_number).slice(-6) : null },
    steps: rail, calls, errors: errs.map(e => ({ id: e.id, label: e.label || e.category, code: e.code || null, cls: e.cls || null, at: iso(e.occurred_at), callIndex: e.callIndex, this: e.id === event.id })),
    thisCall: thisIdx, verdict, source, capped, unmasked: !!unmask, notes,
  };
}

module.exports = { states, journey, stepLabel, stepsFor, stateOf, isDone, callKind, WF_LABEL };
