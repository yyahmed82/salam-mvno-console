/* fixed5gLane.js — the 5G journeys on Fixed › Troubleshoot (alpha.158, 9 Oct 2026).
 *
 * WHY. The board lists error_events. The dealer-ops ingest writes one only for an api_log that FAILED — HTTP ≥ 400 or a
 * resultCode other than "0". Two 5G failure families never look like that, so the board showed none of them:
 *   · The SIM check. Every 5G journey (SDA 5G HomeFi and 5G FWA, e-purchase 5G HomeFi on the web and in the Salam Home
 *     app) asks BSS querySimCard for the serial it is about to sell. When the SIM is not sellable BSS still answers
 *     resultCode "0" "Success", with no SIM in the list or a simState other than I (idle), and the journey stops with
 *     "Sim card is not available". 9 Oct: about 50 a day on 5G e-purchase — 90 % of its journeys
 *     (claude/FIXED-NEXUS-REVIEW-2026-10-07.md: the white-label SIMs are held by locks that are never released).
 *   · The 5G HomeFi e-purchase steps the read model never sees. Naqeel (search / order), payments v2, Semati / Nafath,
 *     the delivery-time BSS order and the stock locks live in nexus only (workflow_states.context, epurchase_5g_locks).
 *
 * WHAT. Board-shaped events (the live board's row fields). fixedErrors.js merges them into summary / live / detail /
 * export, the error catalogue and the hourly trend. Alert metrics are NOT fed from here: the 5G conditions have their
 * own rules (fixed_ep5g_*), and the channel error rules keep counting what they always counted.
 *   SIM_NOT_AVAILABLE   one per querySimCard answer without a sellable SIM (resultCode 0 and HTTP < 400 — any other
 *                       answer is already an error event). Read from nexus api_logs since alpha.159: each call with its
 *                       own time and a stable id (the read model's api_calls all carry the last re-ingest time and get a
 *                       new id at every re-ingest); the read model's copy only when nexus is not configured.
 *                       E-purchase: the serial is the one Naqeel reserved, so the cause is read from nexus
 *                       epurchase_5g_locks as it stood at the time of the check —
 *                         LEAKED_LOCK   held by an expired journey, never released          technical
 *                         SOLD          the serial has an ORDER_CREATED row (sold)            technical
 *                         RESERVED      held by another journey still running                 business
 *                         STALE_SERIAL  Naqeel offered a renamed serial (…_OLD)               technical
 *                         NOT_IDLE / NO_SIM / NO_ANSWER                                       technical
 *                       SDA: the dealer scanned the SIM — NOT_IDLE / NO_SIM are business (the dealer uses another
 *                       SIM), NO_ANSWER technical. Resolved once the journey completed (the ingest's own rule).
 *   NAQEEL_ORDER_FAILED · PROVISION_NO_ORDER · REFUND_MISSING — paid 5G e-purchase journeys, from the Payments-watch
 *                       snapshot (fixedEpWatch, memoised 10 min): Naqeel order failed (card charged / voided), paid with
 *                       no BSS order after 72 h, BSS order failed at delivery, paid but stopped before the Naqeel order,
 *                       returned with no refund. Open while the condition lasts; 1-SAR launch tests are left out.
 *   SEMATI_FAILED · MOBILE_EXISTS · NAFATH_REJECTED · NAFATH_TIMEOUT — 5G e-purchase journeys that expired at the Nafath
 *                       step with a failure in context (nafath.customer.status, sematiResponse, sematiError).
 *   STOCK_LOCK_LEAK     SIM / landline locks still LOCKED on journeys expired > 2 h (snapshot). A serial that was also
 *                       sold carries SOLD_DO_NOT_RELEASE: releasing it would put a sold SIM back on sale.
 * Ids are 'g5-' + 29 hex of sha1(kind | journey | key) — key = the nexus api_log id for a SIM check — stable, so acks
 * (fixed_error_acks) work as on any row. (alpha.158 keyed SIM checks on the read model's call id, which changes at every
 * re-ingest: acks set on those rows before alpha.159 do not carry over.)
 * PII: full identifiers stay server-side (search only); rows carry masked tails; bodies go through secretMask and the
 * board's own masking (national id, name, mobile).
 * Cost: in nexus one read for the SIM checks (the 5G journeys of the window by workflow and created_at, materialised,
 * then their querySimCard calls by workflow_state_id), one spot lookup for the lock causes, one for the Nafath-step
 * stops, and the shared 30-day Payments-watch snapshot; in the read model one PK lookup for dealer / region / referral.
 * Memoised per window (60 s up to 26 h, 5 min up to 8 d, 10 min beyond), single-flight. */
'use strict';
const crypto = require('crypto');
const db = require('./db');
const { maskSecretsText, maskSecretsObj, maskBodyText } = require('./secretMask');
const { isDone } = require('./fixedJourney');

const EP5 = 'ePurchase5GWhiteLabel';
const SDA5 = ['fiveGWhiteLabel', 'fiveGFWA'];             // the prod enum labels (5G e-purchase is stored as fiveGWhiteLabel)
const NAFATH_STEP = 'ePurchaseNafathCheck';
const STEP_LABEL = { ePurchaseGeoFeasibilityCheck: 'location · stock lock', ePurchaseCustomerProfile: 'customer profile', ePurchaseNafathCheck: 'Nafath · Semati',
  ePurchaseOrderSummary: 'order summary', ePurchasePayment: 'payment', ePurchaseCustomerProfileVerification: 'verification', ePurchaseConfirmOtp: 'OTP → Naqeel order',
  ePurchaseReviewOrder: 'order placed' };
const stepLabel = s => STEP_LABEL[s] || s || '—';
const n = v => Number(v) || 0;
const iso = v => { if (v == null) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d.toISOString(); };
const tail = (s, k = 4) => s == null || s === '' ? null : '…' + String(s).slice(-k);
const maskDigits = s => s == null ? null : String(s).replace(/\d{5,}/g, m => '…' + m.slice(-3));
const gid = (...p) => 'g5-' + crypto.createHash('sha1').update(p.join('|')).digest('hex').slice(0, 29);
const isLaneId = id => /^g5-[0-9a-f]{29}$/.test(String(id || ''));
/* the board's masking (dealer-ops maskPii) for bodies we build ourselves, then the SIM secrets */
const maskPii = s => String(s)
  .replace(/("(?:certNbr|nationalId|idNumber|custId|customerId)"\s*:\s*")[^"]*(")/gi, '$1•masked•$2')
  .replace(/("(?:custName|customerName|name|englishFirstName|englishLastName|firstName|lastName|arabicName)"\s*:\s*")[^"]*(")/gi, '$1•masked•$2')
  .replace(/("(?:msisdn|mobilePhone|mobileNumber|mobile|phoneNumber|phone)"\s*:\s*")[^"]*(")/gi, '$1•masked•$2');
const compact = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));
const safeBody = v => { if (v == null) return null; let s; try { s = typeof v === 'string' ? v : JSON.stringify(compact(v)); } catch (_) { return null; } return maskSecretsText(maskPii(s)).slice(0, 4000); };

/* ---------------- labels (the cause sentence is the row's "error text"; digits stay out so it groups) ---------------- */
const SIM_TEXT = {
  ep: { LEAKED_LOCK: 'SIM reserved by Naqeel is held by an expired journey — its lock was never released',
        SOLD: 'SIM reserved by Naqeel was already sold — Naqeel still offers it',
        RESERVED: 'SIM reserved by Naqeel is held by another journey in progress',
        STALE_SERIAL: 'Naqeel offered a renamed serial (_OLD) — BSS does not know it',
        NOT_IDLE: 'SIM reserved by Naqeel is not idle in BSS',
        NO_SIM: 'BSS returned no SIM for the serial Naqeel reserved',
        NO_ANSWER: 'SIM check returned no answer' },
  sda: { NOT_IDLE: 'SIM scanned by the dealer is not idle in BSS',
         NO_SIM: 'SIM scanned by the dealer is not in BSS stock (no SIM returned)',
         NO_ANSWER: 'SIM check returned no answer' },
};
const SIM_BUSINESS = { ep: new Set(['RESERVED']), sda: new Set(['NOT_IDLE', 'NO_SIM']) };

/* ---------------- memo (single-flight) ---------------- */
const memo = new Map();
function cached(key, ttl, fn) {
  const h = memo.get(key); if (h && Date.now() - h.at < ttl) return h.p;
  const p = Promise.resolve().then(fn).catch(e => { memo.delete(key); throw e; });
  /* expired windows go at once (a 30-day window holds a few thousand events with their bodies); at most 24 kept */
  const now = Date.now(); for (const [k, v] of memo) if (now - v.at > 15 * 60e3) memo.delete(k);
  memo.set(key, { at: now, p }); while (memo.size > 24) memo.delete(memo.keys().next().value);
  return p;
}
const ttlFor = span => span <= 26 * 3600e3 ? 60e3 : span <= 8 * 864e5 ? 5 * 60e3 : 10 * 60e3;

/* ---------------- part 1 · SIM checks (board read model) ---------------- */
/* the 5G attempts first (index workflow, started_at), then their calls by attempt id — never a scan of api_calls */
const SIM_SQL = `WITH a AS MATERIALIZED (
    SELECT oa.id, oa.workflow::text AS workflow, oa.plan, oa.channel AS oa_channel, oa.referral_code, oa.dealer_id, oa.region, oa.outcome::text AS outcome,
           oa.completed_at, oa.order_number, oa.iccid, oa.msisdn, oa.cpe, oa.customer_id, oa.cust_code, oa.service_no, oa.odb
      FROM order_attempts oa
     WHERE oa.workflow IN ('fiveGWhiteLabel', 'fiveGFWA')
       AND oa.started_at >= $1::timestamptz - interval '1 day' AND oa.started_at < $2)
SELECT c.id AS call_id, c.attempt_id, c.endpoint, c.method, c.status, c.duration_ms, c.created_at,
       left(c.req_body, 2000) AS req_body, left(c.res_body, 4000) AS res_body,
       a.workflow, a.plan, a.oa_channel, a.referral_code, a.dealer_id, COALESCE(a.region, d.region) AS region,
       d.dealer_code, a.outcome, a.completed_at, a.order_number, a.iccid, a.msisdn, a.cpe, a.customer_id, a.cust_code, a.service_no, a.odb
  FROM a
  JOIN api_calls c ON c.attempt_id = a.id
  LEFT JOIN dealers d ON d.id = a.dealer_id
 WHERE c.created_at >= $1 AND c.created_at < $2
   AND c.endpoint LIKE '%querySimCard%'
   AND coalesce(c.status, 200) < 400
   AND coalesce(substring(c.res_body from '"resultCode"\\s*:\\s*"([^"]*)"'), '0') = '0'
   AND coalesce(c.res_body, '') !~ '"simState"\\s*:\\s*"I"'
 ORDER BY c.created_at DESC LIMIT 5000`;
const serialOf = req => { const s = String(req || ''); const m = /"iccidBegin"\s*:\s*"([^"]+)"/.exec(s) || /"iccid"\s*:\s*"([^"]+)"/.exec(s); return m ? m[1].trim() : null; };
const simStateOf = res => { const m = /"simState"\s*:\s*"([^"]*)"/.exec(String(res || '')); return m ? m[1] : null; };

async function simRows(sources, from, to, warnings) {
  const out = [];
  for (const s of sources) {
    try { const r = await s.pool.query(SIM_SQL, [from, to]); for (const x of r.rows) out.push({ ...x, src: s.src, buckets: s.buckets || null }); }
    catch (e) { warnings.push(`SIM checks (${s.src}): ${/statement timeout/i.test(e.message) ? 'query too slow on the read model — narrow the period' : e.message}`); }
  }
  return out;
}

/* ---- the SIM checks from nexus (alpha.159) — each call with its own time and a stable id ----
 * The read model's api_calls cannot serve here: the dealer-ops sink deletes and re-creates an attempt's calls whenever the
 * journey changes and never sets created_at, so every call of a journey carries the last re-ingest time (two "SIM not
 * available" rows of one journey at the same second, 9 Oct) and a new id each time (an ack would not stick). nexus
 * api_logs hold the real time; the 5G journeys are found first (workflow, created_at), then their querySimCard calls. */
const SIM_WF = ['fiveGWhiteLabel', 'fiveGFWA', EP5];
const SIM_SQL_NEXUS = `WITH w AS MATERIALIZED (
    SELECT id, workflow_id AS wf, channel::text AS ch, current_step, updated_at, expires_at,
           coalesce(context->>'referralCode', context->'urlParams'->>'ref') AS ref
      FROM workflow_states
     WHERE workflow_id = ANY($3::text[]) AND created_at >= $1::timestamptz - interval '1 day' AND created_at < $2)
SELECT a.id AS log_id, a.workflow_state_id AS attempt_id, a.endpoint, a.method, a.status::text AS status, a.duration, a.created_at,
       a.payload, a.response, w.wf, w.ch, w.current_step, w.updated_at AS w_updated, w.expires_at, w.ref
  FROM w JOIN api_logs a ON a.workflow_state_id = w.id
 WHERE a.created_at >= $1 AND a.created_at < $2
   AND a.endpoint LIKE '%querySimCard%'
   AND (a.status IS NULL OR a.status::text !~ '^[0-9]+$' OR a.status::text::int < 400)
   AND coalesce(a.response->>'resultCode', '0') = '0'
   AND NOT coalesce((SELECT bool_or(s->>'simState' = 'I') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.response->'simCardDtoList') = 'array'
        THEN a.response->'simCardDtoList' ELSE '[]'::jsonb END) s), false)
 ORDER BY a.created_at DESC LIMIT 5000`;
async function simRowsNexus(from, to, warnings) {
  try { return (await db.nexus.query(SIM_SQL_NEXUS, [from, to, SIM_WF])).rows; }
  catch (e) { warnings.push(`SIM checks: ${/statement timeout/i.test(e.message) ? 'query too slow in nexus — narrow the period' : e.message}`); return null; }
}
const objOf = v => { if (v && typeof v === 'object') return v; if (typeof v !== 'string') return null; try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : null; } catch (_) { return null; } };
/* dealer, region, referral, order number and the search identifiers from the board read model (PK lookup per source) */
async function attribution(ids, sources) {
  const by = new Map(); const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return by;
  for (const s of sources) {
    try { const r = await s.pool.query(`SELECT oa.id, oa.dealer_id, d.dealer_code, COALESCE(oa.region, d.region) AS region, oa.referral_code, oa.order_number,
          oa.iccid, oa.msisdn, oa.cpe, oa.customer_id, oa.cust_code, oa.service_no, oa.odb, oa.plan
        FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id WHERE oa.id = ANY($1::text[])`, [list]);
      for (const x of r.rows) if (!by.has(x.id)) by.set(x.id, x); }
    catch (_) { /* attribution only */ }
  }
  return by;
}
function simEventsNexus(rows, locks, attrib) {
  const out = [];
  for (const r of rows) {
    const isEp = r.wf === EP5 || (r.ch && r.ch !== 'SDA');
    const body = objOf(r.payload) || {};
    const serial = String(body.iccidBegin || body.iccid || '').trim() || null;
    const resp = objOf(r.response);
    const state = resp && Array.isArray(resp.simCardDtoList) && resp.simCardDtoList.length && resp.simCardDtoList[0] ? resp.simCardDtoList[0].simState || null : null;
    const empty = r.response == null || (typeof r.response === 'string' && !r.response.trim());
    const code = simCause(isEp, serial, state, empty ? '' : 'answered', r.created_at, r.attempt_id, locks);
    const side = isEp ? 'ep' : 'sda';
    const a = attrib.get(r.attempt_id) || {};
    const ref = isEp && r.ch !== 'PULSE' ? (r.ref || a.referral_code || null) : null;
    const chan = chanOf(r.ch === 'SDA' ? 'sda' : null, ref, r.ch);
    const done = isDone(r.current_step);
    const http = r.status != null && /^\d+$/.test(String(r.status)) ? Number(r.status) : null;
    out.push({
      id: gid('sim', r.attempt_id, r.log_id), call_id: String(r.log_id), kind: 'sim', category: 'SIM_NOT_AVAILABLE', code, cls_auto: SIM_BUSINESS[side].has(code) ? 'business' : 'technical',
      message: '5G SIM not available', resp_text: SIM_TEXT[side][code] + (code === 'NOT_IDLE' && state ? ` (state ${state})` : ''), provider: null,
      step: (() => { try { return new URL(r.endpoint).pathname; } catch (_) { return String(r.endpoint || 'querySimCard').split('?')[0]; } })(), method: r.method || null,
      http, ms: r.duration == null ? null : Math.round(Number(r.duration)), occurred_at: iso(r.created_at), resolved: done, resolved_at: done ? iso(r.w_updated) : null,
      attempt_id: r.attempt_id, order_number: a.order_number && a.order_number !== '11223344' ? a.order_number : null, acct_masked: null, cust_masked: null, client_side: false,
      channel: r.ch === 'SDA' ? 'sda' : r.ch === 'PULSE' ? 'salamhome' : 'epurchase', chan, type: r.wf === 'fiveGFWA' ? '5gfwa' : '5gwl', workflow: r.wf, plan: a.plan || null,
      dealer_id: a.dealer_id || null, dealer_code: a.dealer_code || null, referral_code: chan === 'qr' ? ref : null, region: a.region || null,
      serial_tail: tail(serial, 6), src_model: 'nexus',
      req: maskBodyText({ method: r.method || null, url: r.endpoint || null, body: objOf(r.payload) || r.payload || null }), res: maskBodyText(r.response),
      ids: { iccid: serial || a.iccid || null, msisdn: a.msisdn || null, cpe: a.cpe || null, customerId: a.customer_id || null, custCode: a.cust_code || null, serviceNo: a.service_no || null, odb: a.odb || null },
    });
  }
  return out;
}

/* nexus spot lookups: the journeys' real channel (the prod ingest files Salam Home app journeys under e-purchase),
 * the referral code, and every lock row of the serials Naqeel reserved */
async function nexusFacts(ids, serials, warnings) {
  const out = { wf: new Map(), locks: new Map() };
  if (!db.nexus || (!ids.length && !serials.length)) return out;
  try {
    if (ids.length) {
      const r = await db.nexus.query(`SELECT id, workflow_id AS wf, channel::text AS ch, coalesce(context->>'referralCode', context->'urlParams'->>'ref') AS ref
        FROM workflow_states WHERE id = ANY($1::text[])`, [ids]);
      for (const x of r.rows) out.wf.set(x.id, x);
    }
    if (serials.length) {
      const r = await db.nexus.query(`SELECT l.goodssn AS sn, l.status::text AS status, l.created_at, l.workflow_state_id AS wf, w.expires_at
        FROM epurchase_5g_locks l JOIN workflow_states w ON w.id = l.workflow_state_id
        WHERE l.goods_type::text = 'iccid' AND l.goodssn = ANY($1::text[])`, [serials]);
      for (const x of r.rows) { const k = x.sn; (out.locks.get(k) || out.locks.set(k, []).get(k)).push(x); }
    }
  } catch (e) { warnings.push(`nexus lookups: ${e.message}`); }
  return out;
}

function simCause(isEp, serial, state, res, at, wfId, locks) {
  if (!res || !String(res).trim()) return 'NO_ANSWER';
  if (!isEp) return state && state !== 'I' ? 'NOT_IDLE' : 'NO_SIM';
  if (serial && /_OLD$/i.test(serial)) return 'STALE_SERIAL';
  const t = new Date(at).getTime();
  const others = (locks.get(serial) || []).filter(l => l.wf !== wfId && new Date(l.created_at).getTime() <= t);
  if (others.some(l => l.status === 'ORDER_CREATED')) return 'SOLD';
  if (others.some(l => l.status === 'LOCKED' && l.expires_at && new Date(l.expires_at).getTime() < t)) return 'LEAKED_LOCK';
  if (others.some(l => l.status === 'LOCKED')) return 'RESERVED';
  if (state && state !== 'I') return 'NOT_IDLE';
  return 'NO_SIM';
}

const chanOf = (oaChannel, ref, nexusCh) => {
  if (nexusCh === 'SDA' || oaChannel === 'sda') return 'sda';
  if (nexusCh === 'PULSE' || oaChannel === 'salamhome') return 'salamhome';
  return ref ? 'qr' : 'web';
};

function simEvents(rows, facts) {
  const out = [];
  for (const r of rows) {
    const nx = facts.wf.get(r.attempt_id) || null;
    const isEp = (nx && nx.wf === EP5) || (r.oa_channel && r.oa_channel !== 'sda');
    const serial = serialOf(r.req_body);
    const state = simStateOf(r.res_body);
    const code = simCause(isEp, serial, state, r.res_body, r.created_at, r.attempt_id, facts.locks);
    const side = isEp ? 'ep' : 'sda';
    const chan = chanOf(r.oa_channel, r.referral_code || (nx && nx.ref), nx && nx.ch);
    if (r.buckets && !r.buckets.includes(chan)) continue;               // the board partition: this source does not serve that bucket
    const text = SIM_TEXT[side][code] + (code === 'NOT_IDLE' && state ? ` (state ${state})` : '');
    const done = r.outcome === 'COMPLETED';
    out.push({
      id: gid('sim', r.attempt_id, r.call_id), call_id: String(r.call_id), kind: 'sim', category: 'SIM_NOT_AVAILABLE', code, cls_auto: SIM_BUSINESS[side].has(code) ? 'business' : 'technical',
      message: '5G SIM not available', resp_text: text, provider: null, step: r.endpoint || 'querySimCard', method: r.method || null,
      http: r.status == null ? null : n(r.status), ms: r.duration_ms == null ? null : n(r.duration_ms),
      occurred_at: iso(r.created_at), resolved: done, resolved_at: done ? iso(r.completed_at) : null,
      attempt_id: r.attempt_id, order_number: r.order_number || null, acct_masked: null, cust_masked: null, client_side: false,
      channel: r.oa_channel || null, chan, type: r.workflow === 'fiveGFWA' ? '5gfwa' : '5gwl', workflow: isEp ? EP5 : r.workflow, plan: r.plan || null,
      dealer_id: r.dealer_id || null, dealer_code: r.dealer_code || null, referral_code: chan === 'qr' ? (r.referral_code || (nx && nx.ref) || null) : null, region: r.region || null,
      serial_tail: tail(serial, 6), src_model: r.src,
      req: safeBody(r.req_body), res: safeBody(r.res_body),
      ids: { iccid: serial || r.iccid || null, msisdn: r.msisdn || null, cpe: r.cpe || null, customerId: r.customer_id || null, custCode: r.cust_code || null, serviceNo: r.service_no || null, odb: r.odb || null },
    });
  }
  return out;
}

/* ---------------- part 2 · 5G e-purchase conditions (nexus) ---------------- */
const PAID_MAP = {
  naqeel_fail_charged: { cat: 'NAQEEL_ORDER_FAILED', code: 'CHARGED', provider: 'NAQEEL', step: 'ePurchaseConfirmOtp', text: p => `Naqeel order failed — invoice ${p.inv || '?'}, the payment was not voided` },
  naqeel_fail_voided:  { cat: 'NAQEEL_ORDER_FAILED', code: 'VOIDED', provider: 'NAQEEL', step: 'ePurchaseConfirmOtp', text: () => 'Naqeel order failed — the payment was voided' },
  no_bss:              { cat: 'PROVISION_NO_ORDER', code: 'NO_BSS_72H', provider: null, step: 'Naqeel event 7 · createOrderNew5g', text: () => 'Paid; no BSS order three days after the Naqeel order (it is created only at delivery, with no retry)', delayH: 72 },
  bss_failed:          { cat: 'PROVISION_NO_ORDER', code: 'BSS_FAILED', provider: null, step: 'Naqeel event 7 · createOrderNew5g', text: p => `BSS order failed at delivery${p.order_err ? ': ' + String(p.order_err).slice(0, 140) : ''}` },
  paid_stopped:        { cat: 'PROVISION_NO_ORDER', code: 'PAID_STOPPED', provider: null, step: null, text: p => `Invoice ${p.inv || '?'} but the journey stopped at ${stepLabel(p.step)} — before the Naqeel order` },
  rto_no_refund:       { cat: 'REFUND_MISSING', code: 'RTO', provider: 'NAQEEL', step: 'Naqeel event 9 / 113', text: () => 'Naqeel returned the shipment; no refund on the journey' },
};
function paidEvents(snap) {
  const out = [];
  for (const p of ((snap && snap.fiveG && snap.fiveG.paid) || [])) {
    const m = PAID_MAP[p.cls]; if (!m || p.test) continue;
    const at = new Date(new Date(p.updated_at).getTime() + (m.delayH || 0) * 3600e3).toISOString();
    out.push({
      id: gid('paid', p.id, p.cls), kind: 'paid', category: m.cat, code: m.code, cls_auto: 'technical', message: null, resp_text: m.text(p), provider: m.provider,
      step: m.step || p.step || null, method: null, http: null, ms: null, occurred_at: at, resolved: false, resolved_at: null,
      attempt_id: p.id, order_number: p.order_nbr || null, acct_masked: null, cust_masked: null, client_side: false,
      channel: p.ch === 'PULSE' ? 'salamhome' : 'epurchase', chan: p.ch === 'PULSE' ? 'salamhome' : 'web', type: '5gwl', workflow: EP5, plan: p.plan || null,
      dealer_id: null, dealer_code: null, referral_code: null, region: null,
      req: null, res: safeBody({ invoice: p.inv, amount_sar: p.amount_sar, journey_step: p.step, naqeel_order: p.naqeel, naqeel_event: p.naqeel_event, bss_order: p.order_nbr, bss_order_error: p.order_err, iccid: p.iccid, landline: p.landline }),
      ids: {},
    });
  }
  return out;
}

function lockEvents(snap, soldSet) {
  const out = [];
  for (const l of ((snap && snap.locks && snap.locks.leaked) || [])) {
    const goods = String(l.goods || '').toLowerCase();
    const sold = goods === 'iccid' && soldSet.has(l.sn_raw);
    const what = goods === 'iccid' ? 'SIM' : goods === 'msisdn' ? 'Landline number' : (l.goods || 'Resource');
    out.push({
      id: gid('lock', l.wf, l.goods, l.sn_raw || l.sn, l.created_at), kind: 'lock', category: 'STOCK_LOCK_LEAK', code: sold ? 'SOLD_DO_NOT_RELEASE' : (goods || 'other').toUpperCase(),
      cls_auto: 'technical', message: null,
      resp_text: sold ? 'Stale LOCKED row on a SIM that was sold — do not release it in BSS; clear the row only'
        : `${what} still LOCKED — the journey expired at ${stepLabel(l.step)} without releasing it`,
      provider: null, step: l.step || null, method: null, http: null, ms: null, occurred_at: l.expired_at, resolved: false, resolved_at: null,
      attempt_id: l.wf, order_number: null, acct_masked: null, cust_masked: null, client_side: false,
      channel: l.ch === 'PULSE' ? 'salamhome' : 'epurchase', chan: l.ch === 'PULSE' ? 'salamhome' : 'web', type: '5gwl', workflow: EP5, plan: null,
      dealer_id: null, dealer_code: null, referral_code: null, region: null, serial_tail: l.sn,
      req: null, res: safeBody({ resource: l.goods, serial: l.sn, lock_status: 'LOCKED', locked_at: l.created_at, journey_step: l.step, journey_expired_at: l.expired_at, sold_elsewhere: sold || undefined }),
      ids: { iccid: goods === 'iccid' ? l.sn_raw : null, msisdn: goods === 'msisdn' ? l.sn_raw : null },
    });
  }
  return out;
}

/* JS twin of the board's classOf for the identity events (fixedErrors TECH_CATS / TECH_MSG_RE) */
const TECH_TEXT = /(timeout|timed[ -]?out|ETIMEDOUT|ECONN|EHOSTUNREACH|connection (reset|refused|closed)|SSL|I\/O error|service (is )?not available|temporarily unavailable|unavailable|internal server error|gateway time-?out|bad gateway|no response|empty response|null response|unreachable|unkn?own error|system error|exception|undefined|\b715\b)/i;
async function nafathEvents(from, to, warnings) {
  if (!db.nexus) return [];
  try {
    const r = await db.nexus.query(`SELECT id, channel::text AS ch, updated_at, expires_at, plan_id,
          context->'nafath'->'customer'->>'status' AS nafath, context->'sematiResponse'->>'code' AS scode,
          left(context->'sematiResponse'->>'message', 300) AS smsg, left(coalesce(context->>'sematiError', ''), 300) AS serr,
          coalesce(context->>'referralCode', context->'urlParams'->>'ref') AS ref
        FROM workflow_states
       WHERE workflow_id = $1 AND current_step = $2 AND expires_at < now()
         AND created_at >= $3::timestamptz - interval '2 days' AND updated_at >= $3 AND updated_at < $4
       ORDER BY updated_at DESC LIMIT 2000`, [EP5, NAFATH_STEP, from, to]);
    const out = [];
    for (const x of r.rows) {
      const nf = String(x.nafath || '').toUpperCase(), sc = x.scode == null ? null : String(x.scode), sm = x.smsg || '', se = x.serr || '';
      let cat = null, code = null, cls = 'business', text = null;
      if (/MOBILE_ALREADY_EXISTS/i.test(sm) || /MOBILE_ALREADY_EXISTS/i.test(se) || sc === '726') { cat = 'MOBILE_EXISTS'; code = '726'; text = 'Semati: the customer already holds a mobile number (MOBILE_ALREADY_EXISTS)'; }
      else if (nf === 'REJECTED') { cat = 'NAFATH_REJECTED'; text = 'Nafath: the customer rejected the request'; }
      else if (sc === '600') continue;
      else if (se) { cat = 'SEMATI_FAILED'; code = sc || null; text = 'Semati: ' + maskDigits(se.replace(/^\s*semati\b[\s:-]*/i, '')).slice(0, 200); cls = (TECH_TEXT.test(se) || (sc && /^5\d\d$/.test(sc))) ? 'technical' : 'business'; }
      else if (nf === 'PENDING') { cat = 'NAFATH_TIMEOUT'; cls = 'technical'; text = 'Nafath: no answer before the journey expired'; }
      else continue;
      out.push({
        id: gid('id', x.id, cat), kind: 'identity', category: cat, code, cls_auto: cls, message: null, resp_text: text, provider: null,
        step: NAFATH_STEP, method: null, http: null, ms: null, occurred_at: iso(x.updated_at), resolved: false, resolved_at: null,
        attempt_id: x.id, order_number: null, acct_masked: null, cust_masked: null, client_side: false,
        channel: x.ch === 'PULSE' ? 'salamhome' : 'epurchase', chan: chanOf(null, x.ref, x.ch), type: '5gwl', workflow: EP5, plan: x.plan_id || null,
        dealer_id: null, dealer_code: null, referral_code: x.ch !== 'PULSE' && x.ref ? x.ref : null, region: null,
        req: null, res: safeBody({ nafath_status: x.nafath || null, semati_code: sc, semati_message: sm ? maskDigits(sm) : null, semati_error: se ? maskDigits(se) : null, journey_expired_at: iso(x.expires_at) }),
        ids: {},
      });
    }
    return out;
  } catch (e) { warnings.push(`Nafath / Semati stops: ${e.message}`); return []; }
}

async function soldSerials(snap, warnings) {
  const raw = [...new Set(((snap && snap.locks && snap.locks.leaked) || []).filter(l => String(l.goods).toLowerCase() === 'iccid' && l.sn_raw).map(l => l.sn_raw))];
  if (!raw.length || !db.nexus) return new Set();
  try { const r = await db.nexus.query(`SELECT DISTINCT goodssn FROM epurchase_5g_locks WHERE status::text = 'ORDER_CREATED' AND goodssn = ANY($1::text[])`, [raw]); return new Set(r.rows.map(x => x.goodssn)); }
  catch (e) { warnings.push(`sold serials: ${e.message}`); return new Set(); }
}

/* referral / region / dealer of the e-purchase journeys from the board read model (one PK lookup per source) */
async function enrich(evs, sources) {
  const ids = [...new Set(evs.filter(e => e.kind !== 'sim').map(e => e.attempt_id).filter(Boolean))];
  if (!ids.length) return;
  const by = new Map();
  for (const s of sources) {
    try { const r = await s.pool.query(`SELECT oa.id, oa.referral_code, oa.region, oa.order_number, oa.channel FROM order_attempts oa WHERE oa.id = ANY($1::text[])`, [ids]); for (const x of r.rows) if (!by.has(x.id)) by.set(x.id, x); }
    catch (_) { /* attribution only */ }
  }
  for (const e of evs) { const x = by.get(e.attempt_id); if (!x) continue;
    if (!e.region && x.region) e.region = x.region;
    if (!e.order_number && x.order_number && x.order_number !== '11223344') e.order_number = x.order_number;
    if (e.chan === 'web' && x.referral_code) { e.chan = 'qr'; e.referral_code = x.referral_code; } }
}

/* ---------------- the lane ---------------- */
async function compute(from, to, sources, custom) {
  const t0 = Date.now(), warnings = [];
  const F = from.toISOString(), T = to.toISOString();
  /* SIM checks: nexus when configured (real call times, stable ids); the read model's copy otherwise */
  let sim = [], simSource = null;
  if (db.nexus) {
    const rows = await simRowsNexus(F, T, warnings);
    if (rows) {
      const serials = [...new Set(rows.filter(r => r.wf === EP5 || r.ch !== 'SDA').map(r => { const b = objOf(r.payload) || {}; return String(b.iccidBegin || b.iccid || '').trim(); }).filter(Boolean))];
      const facts = await nexusFacts([], serials, warnings);
      const attrib = await attribution(rows.map(r => r.attempt_id), sources);
      sim = simEventsNexus(rows, facts.locks, attrib); simSource = 'nexus';
    }
  } else if (sources.length) {
    const rows = await simRows(sources, F, T, warnings);
    const epIds = [...new Set(rows.filter(r => r.oa_channel !== 'sda').map(r => r.attempt_id))];
    const serials = [...new Set(rows.filter(r => r.oa_channel !== 'sda').map(r => serialOf(r.req_body)).filter(Boolean))];
    const facts = await nexusFacts(epIds, serials, warnings);
    sim = simEvents(rows, facts); simSource = 'read model';
  }
  /* the paid / lock conditions come from the Payments-watch snapshot: the 30-day one (shared with the alert loop) for
   * recent windows; a board window reaching further back reads the 60-day one; the trend / catalogue slices older than
   * 31 days skip it (5G e-purchase is live since 17 Sep 2026 and those are current-state conditions anyway) */
  let snap = null;
  const back = Date.now() - from.getTime();
  if (db.nexus && (back <= 31 * 864e5 || !custom) && to.getTime() > Date.now() - 61 * 864e5) {
    try { snap = await require('./fixedEpWatch').snapshot(back <= 31 * 864e5 ? 30 : 60); } catch (e) { warnings.push(`Payments-watch snapshot: ${e.message}`); }
  }
  const sold = await soldSerials(snap, warnings);
  const inWin = e => { const t = Date.parse(e.occurred_at); return t >= from.getTime() && t < to.getTime(); };
  const ctx = [...paidEvents(snap), ...lockEvents(snap, sold)].filter(inWin);
  const ident = await nafathEvents(F, T, warnings);
  const extra = [...ctx, ...ident];
  await enrich(extra, sources);
  /* the partition: a context event belongs to the bucket its journey sits in; drop what no active source serves */
  const served = new Set(sources.flatMap(s => s.buckets || ['sda', 'qr', 'web', 'salamhome']));
  const events = [...sim, ...extra].filter(e => !sources.length || served.has(e.chan)).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const parts = { sim: sim.length, paid: ctx.filter(e => e.kind === 'paid').length, lock: ctx.filter(e => e.kind === 'lock').length, identity: ident.length };
  if (simSource === 'read model') warnings.push('SIM-check times are when the read model stored the journey (nexus not configured)');
  return { from: F, to: T, events, meta: { took_ms: Date.now() - t0, parts, warnings, nexus: !!db.nexus, simSource, latest: events[0] ? events[0].occurred_at : null } };
}

const enabled = () => !!(db.ops || db.opsBeta || db.nexus);
/* events in [from, to). Named rolling windows share one computation per TTL; custom windows are keyed by the minute. */
async function events({ from, to, window, custom, sources }) {
  if (!enabled()) return { events: [], meta: { disabled: true, warnings: [], parts: {} } };
  const span = to.getTime() - from.getTime(), ttl = ttlFor(span);
  const srcKey = sources.map(s => s.src + ':' + (s.buckets || ['*']).join(',')).join(';');
  const key = custom ? `c:${from.toISOString().slice(0, 16)}|${to.toISOString().slice(0, 16)}|${srcKey}` : `w:${window}|${srcKey}`;
  const res = await cached(key, ttl, () => compute(from, custom ? to : new Date(Math.max(to.getTime(), Date.now()) + 60e3), sources, !!custom));
  const f = from.getTime(), t = to.getTime();
  return { events: res.events.filter(e => { const x = Date.parse(e.occurred_at); return x >= f && x < t; }), meta: res.meta };
}

/* one event by id: the cached windows first, then the last 30 days (memoised 10 min) */
async function find(id, sources) {
  if (!isLaneId(id)) return null;
  for (const h of memo.values()) { try { const r = await h.p; const e = r.events.find(x => x.id === id); if (e) return e; } catch (_) {} }
  const now = Date.now();
  const r = await events({ from: new Date(now - 30 * 864e5), to: new Date(now + 60e3), window: '30d', sources });
  return r.events.find(x => x.id === id) || null;
}

/* every cached lane event of one journey (the journey panel marks them on its calls) */
async function forAttempt(attemptId) {
  const out = new Map();
  for (const h of memo.values()) { try { const r = await h.p; for (const e of r.events) if (e.attempt_id === attemptId && !out.has(e.id)) out.set(e.id, e); } catch (_) {} }
  return [...out.values()];
}

/* "similar cases" for a lane event, over the lane's 30 days */
async function similar(ev, sources) {
  const now = Date.now();
  const r = await events({ from: new Date(now - 30 * 864e5), to: new Date(now + 60e3), window: '30d', sources });
  const sig = `${ev.category}:${ev.code || ''}`;
  const same = r.events.filter(x => `${x.category}:${x.code || ''}` === sig && x.id !== ev.id);
  const d7 = now - 7 * 864e5, day0 = new Date(); day0.setUTCHours(0, 0, 0, 0);
  const byDay = {}; for (const x of same) { const k = x.occurred_at.slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; }
  const big = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  const mins = same.filter(x => x.resolved && x.resolved_at).map(x => (Date.parse(x.resolved_at) - Date.parse(x.occurred_at)) / 60000).filter(v => v >= 0).sort((a, b) => a - b);
  return { all: same.length, d30: same.length, d7: same.filter(x => Date.parse(x.occurred_at) >= d7).length,
    lastSeen: same[0] ? same[0].occurred_at : null,
    affectedToday: new Set(same.filter(x => Date.parse(x.occurred_at) >= day0.getTime()).map(x => x.attempt_id)).size,
    medianResolveMins: mins.length ? Math.round(mins[Math.floor(mins.length / 2)]) : null,
    biggestDay: big ? { day: big[0], count: big[1] } : null, horizonDays: 30 };
}

/* unmask (audited by the caller): the raw nexus facts behind a context / lock event — customer data unmasked,
 * SIM secrets still masked. SIM checks use the board's own unmask path (api_logs + context). */
async function raw(ev) {
  if (!db.nexus || !ev || !ev.attempt_id) return null;
  if (ev.kind === 'lock') {
    const r = await db.nexus.query(`SELECT goods_type::text AS goods, goodssn AS serial, status::text AS status, created_at FROM epurchase_5g_locks WHERE workflow_state_id = $1 ORDER BY created_at`, [ev.attempt_id]);
    return { request: null, response: maskSecretsObj({ locks: r.rows }) };
  }
  const r = await db.nexus.query(`SELECT context->'naqeel' AS naqeel, context->'invoice' AS invoice, context->'order' AS "order", context->'nafath' AS nafath,
      context->'sematiResponse' AS "sematiResponse", context->'sematiError' AS "sematiError", context->'extraFields' AS "extraFields"
    FROM workflow_states WHERE id = $1`, [ev.attempt_id]);
  const c = r.rows[0]; if (!c) return null;
  const part = ev.kind === 'identity' ? { nafath: c.nafath, sematiResponse: c.sematiResponse, sematiError: c.sematiError }
    : { naqeel: c.naqeel, invoice: c.invoice, order: c.order, extraFields: c.extraFields };
  return { request: null, response: maskSecretsObj(part) };
}

/* the row as the board's live list carries it (no server-side identifiers, no bodies) */
const ROW_KEYS = ['id', 'attempt_id', 'order_number', 'acct_masked', 'cust_masked', 'category', 'code', 'message', 'client_side', 'channel', 'dealer_id', 'dealer_code',
  'referral_code', 'region', 'step', 'occurred_at', 'resolved', 'resolved_at', 'chan', 'type', 'workflow', 'plan', 'resp_text', 'kind', 'serial_tail'];
const toRow = e => { const o = {}; for (const k of ROW_KEYS) o[k] = e[k] === undefined ? null : e[k]; o.signature = `${e.category}${e.code ? ':' + e.code : ''}`; o.src = 'lane'; return o; };

module.exports = { enabled, events, find, forAttempt, similar, raw, toRow, isLaneId, compute, simCause, serialOf, SIM_TEXT, EP5 };
