/* fixedEpWatch.js — Fixed › "Payments watch": money and stock that the read models cannot see (7 Oct 2026).
 *
 * WHY: the salam-nexus master of 30 Sep (review: claude/FIXED-NEXUS-REVIEW-2026-10-07.md) ships two journeys the
 * dealer-ops ingest does not model — ePurchase5GWhiteLabel (5G HomeFi sold on the web / in the Salam Home app,
 * live since 17 Sep, device delivered by Naqeel) and salamHomeChangePlanPost2Pre — and moved e-purchase card
 * payments to MANUAL_CAPTURE (authorize → capture / void). The money and inventory states of those flows live
 * only in nexus: epurchase_payments, epurchase_5g_locks, webhook_requests and workflow_states.context. The
 * prod ingest folds 5G e-purchase into workflow 'fiveGWhiteLabel' / channel 'epurchase' (probe 7 Oct) and never
 * sees the Naqeel order, the capture, the delivery-time BSS order or the return-to-origin refund.
 *
 * WHAT (read-only, db.nexus — the RO pool, default_transaction_read_only=on):
 *   5G e-purchase  funnel per channel (web E_PURCHASE · app PULSE), daily trend, every PAID journey classified:
 *                  provisioned (real BSS orderNbr) · in delivery (< 72 h) · paid, no BSS order (≥ 72 h) ·
 *                  BSS order failed at delivery · Naqeel order failed (charged / voided) · returned, refund missing ·
 *                  refunded · paid, journey stopped before the Naqeel order
 *                  SIM check outcome at the location step (api_logs querySimCard simState, lockOrUnlockResource)
 *   stock          SIM / landline locks still LOCKED on journeys expired > 2 h (nothing in nexus releases them)
 *   card holds     epurchase_payments AUTHORIZED on journeys expired > 60 min (the 10-min expiry loop should
 *                  have captured or voided them — the row can also be stale: confirm in payments)
 *   FTTH paid      e-purchase FTTH journeys that hold a PAID / CAPTURED / AUTHORIZED invoice but expired at
 *                  verification / OTP — before the order is created — and whether the same customer reached
 *                  the order step later (to separate "paid twice / retried" from "paid, no order")
 *   webhooks       webhook_requests per source: ok · failed · unfinished; the latest failures
 *   Salam Home     post → pre funnel
 * Placeholder: every 5G e-purchase journey carries order.orderNbr '11223344' until the BSS order is created at
 * delivery (Naqeel webhook 7) — it is never treated as an order here.
 * PII: names reduced to the first name, ids / numbers to their last digits; full stock serials only with the
 * unmaskPII capability (?unmask=1, audited pii.unmask) — the inventory team needs them to release a lock.
 * Cost: one nexus client, statements in sequence, 60 s statement timeout, snapshot memoised 10 min per window;
 * the alert metrics reuse the 30-day snapshot plus a 60-s "pulse" (webhook failures, location stop rate).
 * Routes: GET /api/fixed/epwatch/overview?days=7|30|60[&unmask=1]   (view: fixed) */
'use strict';
const db = require('./db');

const W5 = 'ePurchase5GWhiteLabel', FTTH = 'ePurchaseFTTH', P2P = 'salamHomeChangePlanPost2Pre';
const PLACEHOLDER = '11223344';
const DAYS = [7, 30, 60];
const STEPS_5G = ['ePurchaseGeoFeasibilityCheck', 'ePurchaseCustomerProfile', 'ePurchaseNafathCheck', 'ePurchaseOrderSummary', 'ePurchasePayment',
  'ePurchaseCustomerProfileVerification', 'ePurchaseConfirmOtp', 'ePurchaseReviewOrder'];
const STEPS_P2P = ['salamHomeConfirmPlan', 'salamHomeConfirmOtp', 'salamHomeChangePlanSummary', 'salamHomePayment', 'salamHomeReviewOrder'];
const STEP_LABEL = { ePurchaseGeoFeasibilityCheck: 'Location · stock lock', ePurchaseCustomerProfile: 'Customer profile', ePurchaseNafathCheck: 'Nafath · Semati',
  ePurchaseOrderSummary: 'Order summary', ePurchasePayment: 'Payment', ePurchaseCustomerProfileVerification: 'Verification', ePurchaseConfirmOtp: 'OTP → Naqeel order',
  ePurchaseReviewOrder: 'Paid · order placed', salamHomeConfirmPlan: 'Confirm plan', salamHomeConfirmOtp: 'OTP', salamHomeChangePlanSummary: 'Summary',
  salamHomePayment: 'Payment', salamHomeReviewOrder: 'Done' };
const CH_LABEL = { E_PURCHASE: 'Web', PULSE: 'Salam Home app', SDA: 'SDA' };
const CLS = {
  provisioned:         { label: 'Provisioned — BSS order created',         tone: 'green', money: false },
  in_delivery:         { label: 'In delivery (< 72 h since the order)',     tone: 'blue',  money: false },
  no_bss:              { label: 'Paid, no BSS order after 72 h',            tone: 'red',   money: true },
  bss_failed:          { label: 'BSS order failed at delivery',             tone: 'red',   money: true },
  naqeel_fail_charged: { label: 'Naqeel order failed — card charged',       tone: 'red',   money: true },
  naqeel_fail_voided:  { label: 'Naqeel order failed — payment voided',     tone: 'amber', money: false },
  rto_no_refund:       { label: 'Returned to origin — refund missing',      tone: 'red',   money: true },
  refunded:            { label: 'Returned and refunded',                    tone: 'grey',  money: false },
  paid_stopped:        { label: 'Paid, journey stopped before the Naqeel order', tone: 'red', money: true },
  other:               { label: 'Other',                                    tone: 'grey',  money: false },
};

/* ---------------- helpers ---------------- */
const memo = new Map();
function cached(key, ttl, fn) {
  const h = memo.get(key); if (h && Date.now() - h.at < ttl) return h.p;
  const p = Promise.resolve().then(fn).catch(e => { memo.delete(key); throw e; });
  memo.set(key, { at: Date.now(), p }); if (memo.size > 50) memo.delete(memo.keys().next().value);
  return p;
}
function notConfigured() { const e = new Error('nexus not configured (NEXUS_DATABASE_URL)'); e.status = 503; return e; }
async function withClient(fn) {
  const c = await db.nexus.connect();
  try { await c.query('SET statement_timeout = 60000'); return await fn(c); } finally { c.release(); }
}
const n = v => Number(v) || 0;
const pct = (a, b) => b > 0 ? Math.round((a / b) * 1000) / 10 : 0;
const tail = (s, k = 4) => s == null || s === '' ? null : '…' + String(s).slice(-k);
const maskDigits = s => s == null ? null : String(s).replace(/\d{5,}/g, m => '…' + m.slice(-3)).slice(0, 220);
const sar = v => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.round(x) / 100 : null; };   // payments amounts are in halalas
const iso = v => v ? new Date(v).toISOString() : null;
const objOf = v => { if (v && typeof v === 'object') return v; try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : null; } catch (_) { return null; } };
/* the Naqeel order response: keep only short scalar fields that identify the shipment */
function naqeelRef(o) {
  o = objOf(o); if (!o) return null;
  const out = {};
  for (const [k, v] of Object.entries(o)) if (/waybill|awb|orderno|order_?number|refno|tracking|result|issuccess|message|error/i.test(k) && v != null && typeof v !== 'object') out[k] = maskDigits(v);
  return Object.keys(out).length ? out : null;
}

function classify5g(r) {
  const nq = objOf(r.nq_order);
  const nqFail = !!(nq && (nq.errorMessage || nq.IsSuccess === false));
  const real = r.order_nbr && r.order_nbr !== PLACEHOLDER;
  const charged = ['CAPTURED', 'PAID'].includes(r.inv) && r.real_inv !== false;   // PAID_BY_ZERO journeys have no invoice id
  const ageH = (Date.now() - new Date(r.updated_at).getTime()) / 3600e3;
  if (r.refunded) return 'refunded';
  if (r.nq_hook) return 'rto_no_refund';
  if (real) return 'provisioned';
  if (r.current_step !== 'ePurchaseReviewOrder') return (charged || r.inv === 'AUTHORIZED') ? 'paid_stopped' : 'other';
  if (nqFail) return charged ? 'naqeel_fail_charged' : 'naqeel_fail_voided';
  if (r.order_obj && !r.order_nbr && r.order_err) return 'bss_failed';
  return ageH >= 72 ? 'no_bss' : 'in_delivery';
}

/* ---------------- the snapshot ---------------- */
async function snapshot(days) {
  if (!db.nexus) throw notConfigured();
  const d = DAYS.includes(Number(days)) ? Number(days) : 30;
  return cached('snap:' + d, 10 * 60e3, () => withClient(async c => {
    const t0 = Date.now(), warnings = [];
    const Q = async (name, sql, p = []) => { try { return (await c.query(sql, p)).rows; } catch (e) { warnings.push(`${name}: ${e.message}`); return []; } };
    const iv = `${d} days`;

    const funnelRows = await Q('funnel', `SELECT workflow_id AS wf, channel::text AS ch, current_step AS step, count(*)::int AS n,
        count(*) FILTER (WHERE expires_at < now())::int AS expired
      FROM workflow_states WHERE workflow_id = ANY($1::text[]) AND created_at > now() - $2::interval GROUP BY 1,2,3`, [[W5, P2P], iv]);
    const daily = await Q('daily', `SELECT to_char(date_trunc('day', created_at + interval '3 hours'), 'YYYY-MM-DD') AS day, count(*)::int AS started,
        count(*) FILTER (WHERE current_step <> 'ePurchaseGeoFeasibilityCheck')::int AS past_location,
        count(*) FILTER (WHERE current_step = 'ePurchaseReviewOrder')::int AS ordered
      FROM workflow_states WHERE workflow_id = $1 AND created_at > now() - $2::interval GROUP BY 1 ORDER BY 1`, [W5, iv]);
    const paidRows = await Q('paid5g', `SELECT id, channel::text AS ch, plan_id, created_at, updated_at, current_step,
        context->'invoice'->>'status' AS inv, context->'order'->>'orderNbr' AS order_nbr,
        jsonb_typeof(context->'order') = 'object' AS order_obj, (context->'invoice' ? 'id') AS real_inv,
        coalesce(context->'order'->>'errorMessage', context->'order'->>'resultDesc', context->'order'->>'message') AS order_err,
        context->'naqeel'->'order' AS nq_order, context->'naqeel'->'webhook' AS nq_hook,
        (context->'invoice'->'refund') IS NOT NULL AS refunded,
        coalesce(context->'queryFee'->>'totalCharge', context->>'totalCharge') AS charge,
        coalesce(context->'customer'->>'englishFirstName', context->'customer'->>'firstName') AS first_name,
        context->'customer'->>'mobilePhone' AS mobile, context->'extraFields'->>'iccid' AS iccid,
        context->'extraFields'->'landline'->>'number' AS landline
      FROM workflow_states WHERE workflow_id = $1 AND created_at > now() - $2::interval
        AND (current_step = 'ePurchaseReviewOrder' OR context->'invoice'->>'status' IN ('AUTHORIZED','CAPTURED','PAID'))
      ORDER BY created_at DESC LIMIT 500`, [W5, iv]);
    const simRows = await Q('simcheck', `SELECT CASE WHEN a.endpoint LIKE '%querySimCard%' THEN 'querySimCard' ELSE 'lockOrUnlockResource' END AS call,
        CASE WHEN a.endpoint LIKE '%querySimCard%' THEN
               CASE WHEN jsonb_typeof(a.response->'simCardDtoList') IS DISTINCT FROM 'array' THEN 'no SIM list · ' || coalesce(a.response->>'resultCode', a.response->>'code', jsonb_typeof(a.response), 'empty')
                      || coalesce(' · ' || regexp_replace(left(coalesce(a.response->>'resultDesc', a.response->>'resultMsg', a.response->>'message'), 80), '[0-9]{5,}', '…', 'g'), '')
                    WHEN jsonb_array_length(a.response->'simCardDtoList') = 0 THEN 'SIM not found in BSS'
                    ELSE 'simState ' || coalesce(a.response->'simCardDtoList'->0->>'simState', '?') END
             ELSE (CASE WHEN a.payload->>'operationType' = 'L' THEN 'lock' ELSE 'release' END) || ' · resultCode ' || coalesce(a.response->>'resultCode', '?') END AS outcome,
        count(*)::int AS n
      FROM api_logs a WHERE a.workflow_state_id IN (SELECT id FROM workflow_states WHERE workflow_id = $1 AND created_at > now() - interval '7 days')
        AND (a.endpoint LIKE '%querySimCard%' OR a.endpoint LIKE '%lockOrUnlockResource%') GROUP BY 1,2 ORDER BY 1,3 DESC`, [W5]);
    const lockCounts = await Q('lockcounts', `SELECT l.goods_type::text AS goods, l.status::text AS status, count(*)::int AS n,
        count(*) FILTER (WHERE l.status::text = 'LOCKED' AND w.expires_at < now() - interval '2 hours')::int AS leaked
      FROM epurchase_5g_locks l JOIN workflow_states w ON w.id = l.workflow_state_id GROUP BY 1,2 ORDER BY 1,2`);
    const lockRows = await Q('locks', `SELECT l.goods_type::text AS goods, l.goodssn AS sn, l.created_at, w.id AS wf, w.channel::text AS ch,
        w.current_step, w.expires_at
      FROM epurchase_5g_locks l JOIN workflow_states w ON w.id = l.workflow_state_id
      WHERE l.status::text = 'LOCKED' AND w.expires_at < now() - interval '2 hours' ORDER BY l.created_at DESC LIMIT 300`);
    const authRows = await Q('auth', `SELECT w.workflow_id AS wf_type, w.id AS wf, w.channel::text AS ch, w.current_step, p.invoice_id, p.updated_at, w.expires_at,
        coalesce(w.context->'order'->>'orderNbr', '') NOT IN ('', $1) AS has_order
      FROM epurchase_payments p JOIN workflow_states w ON w.id = p.workflow_state_id
      WHERE p.invoice_status::text = 'AUTHORIZED' AND w.expires_at < now() - interval '60 minutes'
      ORDER BY w.expires_at DESC LIMIT 300`, [PLACEHOLDER]);
    const payMix = await Q('paymix', `SELECT w.workflow_id AS wf, p.invoice_status::text AS status, count(*)::int AS n
      FROM epurchase_payments p JOIN workflow_states w ON w.id = p.workflow_state_id WHERE p.updated_at > now() - $1::interval GROUP BY 1,2 ORDER BY 1,3 DESC`, [iv]);
    const ftthRows = await Q('ftthpaid', `WITH paid AS (
          SELECT id, channel::text AS ch, created_at, expires_at, current_step, context->'invoice'->>'status' AS inv,
                 coalesce(context->'invoice'->>'amount', context->'queryFee'->>'totalCharge', context->>'totalCharge') AS amount, context->'customer'->>'id' AS cid,
                 (context->'invoice' ? 'id') AS real_inv, context->'queryFee'->>'totalCharge' AS quoted
          FROM workflow_states WHERE workflow_id = $1 AND created_at > now() - $2::interval AND expires_at < now()
            AND current_step IN ('ePurchaseCustomerProfileVerification', 'ePurchaseConfirmOtp')
            AND context->'invoice'->>'status' IN ('PAID', 'CAPTURED', 'AUTHORIZED')),
        done AS (SELECT context->'customer'->>'id' AS cid, max(created_at) AS last_done FROM workflow_states
          WHERE workflow_id = $1 AND created_at > now() - $2::interval AND current_step = 'ePurchaseReviewOrder' GROUP BY 1)
      SELECT p.id, p.ch, p.created_at, p.expires_at, p.current_step, p.inv, p.amount, p.cid, p.real_inv, p.quoted,
             (d.last_done IS NOT NULL AND d.last_done >= p.created_at) AS later
      FROM paid p LEFT JOIN done d ON d.cid = p.cid ORDER BY p.expires_at DESC`, [FTTH, iv]);
    const hooks = await Q('webhooks', `SELECT source, count(*) FILTER (WHERE is_success)::int AS ok, count(*) FILTER (WHERE is_success = false)::int AS failed,
        count(*) FILTER (WHERE is_success IS NULL AND created_at < now() - interval '10 minutes')::int AS unfinished,
        count(*) FILTER (WHERE is_success = false AND created_at > now() - interval '24 hours')::int AS failed_24h,
        max(created_at) AS newest, max(created_at) FILTER (WHERE is_success = false) AS last_fail
      FROM webhook_requests WHERE created_at > now() - $1::interval GROUP BY 1 ORDER BY 1`, [iv]);
    const hookFails = await Q('webhookfails', `SELECT source, created_at, retries, left(coalesce(reason->>'message', reason::text, ''), 300) AS reason
      FROM webhook_requests WHERE is_success = false AND created_at > now() - $1::interval ORDER BY created_at DESC LIMIT 25`, [iv]);

    /* ---- shape ---- */
    const funnelOf = (wf, steps) => {
      const rows = funnelRows.filter(r => r.wf === wf);
      const byCh = {};
      for (const r of rows) { const b = byCh[r.ch] = byCh[r.ch] || { ch: r.ch, label: CH_LABEL[r.ch] || r.ch, total: 0, stops: {} }; b.total += n(r.n); b.stops[r.step] = (b.stops[r.step] || 0) + n(r.n); }
      const total = rows.reduce((a, r) => a + n(r.n), 0);
      const stopAt = {}; for (const r of rows) stopAt[r.step] = (stopAt[r.step] || 0) + n(r.n);
      // reached step i = journeys whose current step is i or later (the last step = order placed / done)
      const funnel = steps.map((s, i) => { const reached = steps.slice(i).reduce((a, x) => a + (stopAt[x] || 0), 0); return { step: s, label: STEP_LABEL[s] || s, reached, stopped_here: i === steps.length - 1 ? 0 : (stopAt[s] || 0) }; });
      funnel.forEach((f, i) => { const prev = i === 0 ? total : funnel[i - 1].reached; f.drop = Math.max(0, prev - f.reached); f.drop_pct = pct(f.drop, prev); });
      const unknown = Object.entries(stopAt).filter(([s]) => !steps.includes(s)).map(([step, cnt]) => ({ step, n: cnt }));
      return { total, channels: Object.values(byCh).sort((a, b) => b.total - a.total), funnel, unknownSteps: unknown };
    };
    const paid = paidRows.map(r => {
      const cls = classify5g(r);
      return { id: r.id, ch: r.ch, chLabel: CH_LABEL[r.ch] || r.ch, plan: r.plan_id, created_at: iso(r.created_at), updated_at: iso(r.updated_at), step: r.current_step,
        inv: r.inv, cls, clsLabel: CLS[cls].label, tone: CLS[cls].tone, money: CLS[cls].money,
        amount_sar: sar(r.charge), test: sar(r.charge) != null && sar(r.charge) <= 1, order_nbr: r.order_nbr && r.order_nbr !== PLACEHOLDER ? r.order_nbr : null, placeholder: r.order_nbr === PLACEHOLDER,
        order_err: maskDigits(r.order_err), naqeel: naqeelRef(r.nq_order), naqeel_event: naqeelRef(r.nq_hook),
        customer: r.first_name ? String(r.first_name).split(/\s+/)[0] : null, mobile: tail(r.mobile), iccid: tail(r.iccid, 6), landline: tail(r.landline) };
    });
    const byCls = {}; for (const p of paid) byCls[p.cls] = (byCls[p.cls] || 0) + 1;
    const ftth = (() => {
      /* 7 Oct probe: 967 of 967 sampled journeys carried invoice {status, payments} only — the backend's PAID_BY_ZERO shape
       * (quoted fee 0 → no payments-v2 invoice, status forced to PAID). No money was taken on those: they are counted apart
       * as zero-fee abandonments and never as "charged". A real invoice has an id. */
      const zeroOf = r => !r.real_inv || r.quoted === '0';
      const sum = { total: ftthRows.length, zero_fee: 0, zero_fee_no_later: 0, charged: 0, held: 0, retried: 0, no_later_order: 0, no_later_charged: 0, sar_no_later: 0 };
      const weekly = {};
      for (const r of ftthRows) {
        const zero = zeroOf(r), charged = !zero && (r.inv === 'PAID' || r.inv === 'CAPTURED');
        if (zero) { sum.zero_fee++; if (!r.later) sum.zero_fee_no_later++; } else if (charged) sum.charged++; else sum.held++;
        if (r.later) sum.retried++; else { sum.no_later_order++; if (charged) { sum.no_later_charged++; sum.sar_no_later += sar(r.amount) || 0; } }
        const wk = new Date(new Date(r.expires_at).getTime() + 3 * 3600e3); wk.setUTCDate(wk.getUTCDate() - ((wk.getUTCDay() + 1) % 7));
        const k = wk.toISOString().slice(0, 10);
        const w = weekly[k] = weekly[k] || { week: k, total: 0, no_later_charged: 0, retried: 0 };
        w.total++; if (zero) w.zero = (w.zero || 0) + 1; if (r.later) w.retried++; else if (charged) w.no_later_charged++;
      }
      sum.sar_no_later = Math.round(sum.sar_no_later);
      const list = ftthRows.filter(r => !r.later && !zeroOf(r) && (r.inv === 'PAID' || r.inv === 'CAPTURED')).slice(0, 200).map(r => ({ id: r.id, ch: r.ch, chLabel: CH_LABEL[r.ch] || r.ch,
        created_at: iso(r.created_at), expired_at: iso(r.expires_at), step: r.current_step, stepLabel: STEP_LABEL[r.current_step] || r.current_step, inv: r.inv,
        amount_sar: sar(r.amount), customer: tail(r.cid) }));
      return { summary: sum, weekly: Object.values(weekly).sort((a, b) => a.week < b.week ? -1 : 1), list };
    })();

    return {
      generated_at: new Date().toISOString(), took_ms: Date.now() - t0, days: d, warnings,
      fiveG: { ...funnelOf(W5, STEPS_5G), daily, paid, byCls, classes: CLS, simCheck: simRows, simWindowDays: 7 },
      post2pre: funnelOf(P2P, STEPS_P2P),
      locks: { counts: lockCounts, leaked: lockRows.map(r => ({ goods: r.goods, sn_raw: r.sn, sn: r.goods === 'iccid' ? tail(r.sn, 6) : tail(r.sn), created_at: iso(r.created_at),
        wf: r.wf, ch: r.ch, chLabel: CH_LABEL[r.ch] || r.ch, step: r.current_step, stepLabel: STEP_LABEL[r.current_step] || r.current_step, expired_at: iso(r.expires_at) })),
        leakedTotal: lockCounts.reduce((a, r) => a + n(r.leaked), 0) },
      holds: { rows: authRows.map(r => ({ type: r.wf_type, wf: r.wf, ch: r.ch, chLabel: CH_LABEL[r.ch] || r.ch, step: r.current_step, invoice: tail(r.invoice_id, 8),
        updated_at: iso(r.updated_at), expired_at: iso(r.expires_at), has_order: !!r.has_order })), mix: payMix },
      ftth,
      webhooks: { sources: hooks, failures: hookFails.map(r => ({ ...r, created_at: iso(r.created_at), reason: maskDigits(r.reason) })) },
    };
  }));
}

/* the public overview: serials stay masked unless the caller holds unmaskPII and asked for it */
async function overview(q = {}, req) {
  const s = await snapshot(q.days);
  const unmask = q.unmask === '1' && req && req.caps && req.caps.unmaskPII;
  const locks = { ...s.locks, leaked: s.locks.leaked.map(r => { const { sn_raw, ...rest } = r; return unmask ? { ...rest, sn: sn_raw } : rest; }) };
  return { ...s, locks, unmasked: !!unmask, unmaskAvailable: !!(req && req.caps && req.caps.unmaskPII) };
}

/* 60-s pulse for the alert metrics: webhook failures in the last 60 min, location-step stop rate over 24 h */
function pulse() {
  return cached('pulse', 60e3, () => withClient(async c => {
    const hooks = (await c.query(`SELECT source, count(*) FILTER (WHERE is_success = false)::int AS failed,
        count(*) FILTER (WHERE is_success IS NULL AND created_at < now() - interval '10 minutes')::int AS unfinished, count(*)::int AS total
      FROM webhook_requests WHERE created_at > now() - interval '60 minutes' GROUP BY 1`)).rows;
    const loc = (await c.query(`SELECT count(*) FILTER (WHERE expires_at < now())::int AS ended,
        count(*) FILTER (WHERE expires_at < now() AND current_step = 'ePurchaseGeoFeasibilityCheck')::int AS stuck
      FROM workflow_states WHERE workflow_id = $1 AND created_at > now() - interval '24 hours'`, [W5])).rows[0] || {};
    return { hooks, loc };
  }));
}

/* ---------------- alert metrics (merged into FIXED_METRICS by fixedMetrics.js) ---------------- */
const safe = (name, fn) => async () => { try { if (!db.nexus) return []; return await fn(); } catch (e) { console.error(`[fixedEpWatch] ${name}: ${e.message}`); return []; } };
/* stale-while-revalidate for the alert loop: the first tick waits, later ticks get the last snapshot at once while a
 * refresh runs in the background — the 30-day read (the FTTH join scans a month of workflow_states) never holds a tick */
let last = null, refreshing = null;
async function alertSnap() {
  const kick = () => { if (!refreshing) refreshing = snapshot(30).then(s => { last = { at: Date.now(), s }; return s; }).finally(() => { refreshing = null; }); return refreshing; };
  if (!last) return kick();
  if (Date.now() - last.at > 10 * 60e3) kick().catch(e => console.error('[fixedEpWatch] refresh:', e.message));
  return last.s;
}
/* 1-SAR journeys are internal test orders (launch tests of 17 Sep / 30 Sep) — shown on the page, never alerted */
const countCls = async (cls) => { const s = await alertSnap(); return s.fiveG.paid.filter(p => p.cls === cls && !p.test); };
const one = (rows, what) => [{ dim: { note: rows.length ? `${rows.length} ${what} · newest ${rows[0].id}` : `0 ${what}` }, value: rows.length, sample: rows.length }];
const METRICS = {
  fixed_ep5g_paid_no_bss_order: {
    label: 'Fixed · 5G e-purchase paid, no BSS order after 72 h (30 d)', unit: 'count', higherIsBad: true, segment: 'fixed', sourceTables: 'nexus.workflow_states',
    compute: safe('no_bss', async () => one([...(await countCls('no_bss')), ...(await countCls('bss_failed'))], 'paid 5G journeys without a BSS order')) },
  fixed_ep5g_naqeel_fail_charged: {
    label: 'Fixed · 5G e-purchase Naqeel order failed but the card was charged (30 d)', unit: 'count', higherIsBad: true, segment: 'fixed', sourceTables: 'nexus.workflow_states',
    compute: safe('naqeel_charged', async () => one(await countCls('naqeel_fail_charged'), 'charged journeys without a shipment')) },
  fixed_ep5g_rto_refund_missing: {
    label: 'Fixed · 5G e-purchase returned to origin, refund missing (30 d)', unit: 'count', higherIsBad: true, segment: 'fixed', sourceTables: 'nexus.workflow_states',
    compute: safe('rto', async () => one(await countCls('rto_no_refund'), 'returned shipments without a refund')) },
  fixed_ep5g_paid_stopped: {
    label: 'Fixed · 5G e-purchase paid, journey stopped before the Naqeel order (30 d)', unit: 'count', higherIsBad: true, segment: 'fixed', sourceTables: 'nexus.workflow_states',
    compute: safe('paid_stopped', async () => one((await countCls('paid_stopped')).filter(p => (Date.now() - new Date(p.updated_at)) > 3600e3), 'paid journeys stopped before the order')) },
  fixed_ep5g_lock_leak: {
    label: 'Fixed · 5G SIM / landline locks never released (journey expired > 2 h)', unit: 'count', higherIsBad: true, segment: 'fixed', sourceTables: 'nexus.epurchase_5g_locks',
    compute: safe('locks', async () => { const s = await alertSnap(); const t = s.locks.leakedTotal;
      return [{ dim: { note: s.locks.counts.filter(r => r.leaked).map(r => `${r.leaked} ${r.goods}`).join(' · ') || 'none' }, value: t, sample: t }]; }) },
  fixed_ep_auth_stuck: {
    label: 'Fixed · e-purchase card authorisations neither captured nor voided (journey expired > 60 min)', unit: 'count', higherIsBad: true, segment: 'fixed', sourceTables: 'nexus.epurchase_payments',
    compute: safe('auth', async () => { const s = await alertSnap(); const rows = s.holds.rows;
      return [{ dim: { note: rows.length ? `${rows.length} AUTHORIZED · ${rows.filter(r => r.has_order).length} with an order · newest ${rows[0].wf}` : 'none' }, value: rows.length, sample: rows.length }]; }) },
  fixed_ep_ftth_paid_no_order: {
    label: 'Fixed · e-purchase FTTH charged, journey expired before the order, no later order by the same customer (30 d)', unit: 'count', higherIsBad: true, segment: 'fixed', sourceTables: 'nexus.workflow_states',
    compute: safe('ftth_paid', async () => { const s = await alertSnap(); const v = s.ftth.summary.no_later_charged;
      return [{ dim: { note: `${v} journeys · ≈ ${s.ftth.summary.sar_no_later} SAR · ${s.ftth.summary.retried} others retried and reached the order` }, value: v, sample: s.ftth.summary.total }]; }) },
  fixed_ep_webhook_fail: {
    label: 'Fixed · payment webhooks failed or unfinished, 60 min (worst source)', unit: 'count', higherIsBad: true, segment: 'fixed', sourceTables: 'nexus.webhook_requests',
    compute: safe('webhooks', async () => { const p = await pulse(); const w = p.hooks.map(h => ({ ...h, bad: n(h.failed) + n(h.unfinished) })).sort((a, b) => b.bad - a.bad)[0];
      if (!w) return [{ dim: { source: '(worst)', note: 'no webhook in the last 60 min' }, value: 0, sample: 0 }];
      return [{ dim: { source: '(worst)', note: `${w.source}: ${w.failed} failed · ${w.unfinished} unfinished of ${w.total}` }, value: w.bad, sample: n(w.total) }]; }) },
  fixed_ep5g_location_stop_rate: {
    label: 'Fixed · 5G e-purchase journeys that ended at the location / stock step, 24 h', unit: 'rate', higherIsBad: true, segment: 'fixed', sourceTables: 'nexus.workflow_states',
    compute: safe('location', async () => { const p = await pulse(); const e = n(p.loc.ended), st = n(p.loc.stuck);
      return [{ dim: { note: `${st} of ${e} ended journeys stopped at location · stock lock` }, value: e ? Math.round((st / e) * 1000) / 1000 : 0, sample: e }]; }) },
};

/* ---------------- the cases behind each alert (alertCases.js, 8 Oct 2026) ----------------
 * The exporter had no row source for these nine metrics, so "5G e-purchase · paid, no BSS order" (observed 2) exported a
 * header and nothing else. The rows come from the SAME snapshot the metric counted (alertSnap, refreshed every 10 min),
 * filtered the same way — so the file lists exactly the journeys behind the number. Webhooks and the location-step rate
 * are read live from nexus over the alert's own window. Identifiers stay cut to their last digits unless the caller holds
 * unmaskPII (then they are re-read from nexus and the route audits pii.unmask). */
const CASE_METRICS = new Set(Object.keys(METRICS));
const tsOf = v => v ? new Date(v) : null;
const ksaTxt = v => v ? new Date(new Date(v).getTime() + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' KSA' : '—';
const refText = o => o && typeof o === 'object' ? Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(' · ') : (o == null ? null : String(o));
const PAID_HEAD = [['created_at', 'Started (KSA)'], ['id', 'Journey id'], ['naqeel', 'Naqeel order'], ['amount_sar', 'Amount (SAR)'], ['customer', 'Customer'],
  ['mobile', 'Mobile'], ['status', 'Status'], ['channel', 'Channel'], ['invoice', 'Invoice'], ['updated_at', 'Last update (KSA)'], ['step', 'Step'], ['order_nbr', 'BSS order'],
  ['order_err', 'Order error'], ['naqeel_event', 'Naqeel event'], ['iccid', 'ICCID'], ['landline', 'Landline'], ['plan', 'Plan']];   // the PDF prints the first 7: what L1 acts on
async function raw5g(ids) {
  if (!ids.length || !db.nexus) return {};
  return withClient(async c => {
    const r = await c.query(`SELECT id, concat_ws(' ', coalesce(context->'customer'->>'englishFirstName', context->'customer'->>'firstName'), coalesce(context->'customer'->>'englishLastName', context->'customer'->>'lastName')) AS name,
        context->'customer'->>'mobilePhone' AS mobile, context->'extraFields'->>'iccid' AS iccid, context->'extraFields'->'landline'->>'number' AS landline,
        context->'naqeel'->'order' AS nq_order, context->'naqeel'->'webhook' AS nq_hook, context->'customer'->>'id' AS cid, context->'invoice'->>'id' AS invoice_id
      FROM workflow_states WHERE id = ANY($1::text[])`, [ids]);
    const out = {}; for (const x of r.rows) out[x.id] = x; return out;
  });
}
/* the short scalar fields of a Naqeel object, NOT masked (unmask path only) */
const naqeelRaw = o => { o = objOf(o); if (!o) return null; const out = []; for (const [k, v] of Object.entries(o)) if (/waybill|awb|orderno|order_?number|refno|tracking|result|issuccess|message|error/i.test(k) && v != null && typeof v !== 'object') out.push(`${k}: ${String(v).slice(0, 120)}`); return out.join(' · ') || null; };
async function caseRows(key, T, opts = {}) {
  if (!CASE_METRICS.has(key)) return null;
  if (!db.nexus) return { supported: false, reason: 'nexus not configured (NEXUS_DATABASE_URL) — the Payments watch cannot be read' };
  const unmask = !!opts.unmask, cap = opts.cap || 10000;
  const ids = unmask ? 'unmasked — re-read from nexus for a caller holding Unmask PII (audited pii.unmask)' : 'cut to their last digits — the Unmask PII capability shows them in full';
  /* live windows: webhooks (60 min) and the location-step rate (24 h) end at the alert's evaluation time */
  if (key === 'fixed_ep_webhook_fail') {
    const rows = await withClient(c => c.query(`SELECT id::text AS id, source, created_at, retries, CASE WHEN is_success = false THEN 'failed' ELSE 'unfinished (> 10 min)' END AS state,
        left(coalesce(reason->>'message', reason::text, ''), 300) AS reason
      FROM webhook_requests WHERE created_at > $1::timestamptz - interval '60 minutes' AND created_at <= $1::timestamptz
        AND (is_success = false OR (is_success IS NULL AND created_at < $1::timestamptz - interval '10 minutes')) ORDER BY created_at DESC LIMIT ${cap}`, [T])).then(r => r.rows);
    return { supported: true, kind: 'count', population: rows.length, counted: rows.length, identities: ids,
      head: [['created_at', 'Received (KSA)'], ['source', 'Source'], ['state', 'State'], ['retries', 'Retries'], ['reason', 'Reason'], ['id', 'Row id']],
      rows: rows.map(r => ({ ...r, reason: unmask ? r.reason : maskDigits(r.reason), counted: true })),
      note: 'every payment webhook (all sources) that failed, or is still unfinished after 10 min, in the 60 min ending at the evaluation — the alert value is the worst source' };
  }
  if (key === 'fixed_ep5g_location_stop_rate') {
    const rows = await withClient(c => c.query(`SELECT id, channel::text AS ch, created_at, expires_at, current_step, current_step = 'ePurchaseGeoFeasibilityCheck' AS counted
      FROM workflow_states WHERE workflow_id = $1 AND created_at > $2::timestamptz - interval '24 hours' AND created_at <= $2::timestamptz AND expires_at < $2::timestamptz
      ORDER BY (current_step = 'ePurchaseGeoFeasibilityCheck') DESC, created_at DESC LIMIT ${cap}`, [W5, T])).then(r => r.rows);
    return { supported: true, kind: 'rate', population: rows.length, counted: rows.filter(r => r.counted).length, identities: ids,
      head: [['created_at', 'Started (KSA)'], ['expires_at', 'Ended (KSA)'], ['id', 'Journey id'], ['channel', 'Channel'], ['step', 'Last step']],
      rows: rows.map(r => ({ created_at: r.created_at, expires_at: r.expires_at, id: r.id, channel: CH_LABEL[r.ch] || r.ch, step: STEP_LABEL[r.current_step] || r.current_step, counted: !!r.counted })),
      note: 'population = 5G e-purchase journeys started in the 24 h before the evaluation that have ended · counted = those that ended at the location / stock-lock step' };
  }
  /* snapshot-based: the same rows the metric counted */
  const s = await alertSnap();
  const at = ksaTxt(s.generated_at);
  const base = { supported: true, kind: 'count', identities: ids, snapshotAt: s.generated_at };
  const CLS_OF = { fixed_ep5g_paid_no_bss_order: ['no_bss', 'bss_failed'], fixed_ep5g_naqeel_fail_charged: ['naqeel_fail_charged'], fixed_ep5g_rto_refund_missing: ['rto_no_refund'], fixed_ep5g_paid_stopped: ['paid_stopped'] };
  if (CLS_OF[key]) {
    let list = s.fiveG.paid.filter(p => CLS_OF[key].includes(p.cls) && !p.test);
    if (key === 'fixed_ep5g_paid_stopped') list = list.filter(p => (Date.now() - new Date(p.updated_at)) > 3600e3);
    const raw = unmask ? await raw5g(list.map(p => p.id)) : {};
    const rows = list.slice(0, cap).map(p => { const x = raw[p.id] || {};
      return { created_at: tsOf(p.created_at), updated_at: tsOf(p.updated_at), id: p.id, channel: p.chLabel, status: p.clsLabel, step: STEP_LABEL[p.step] || p.step, invoice: p.inv,
        amount_sar: p.amount_sar, order_nbr: p.order_nbr || (p.placeholder ? 'placeholder 11223344 (no real order)' : null), order_err: p.order_err,
        naqeel: unmask ? naqeelRaw(x.nq_order) : refText(p.naqeel), naqeel_event: unmask ? naqeelRaw(x.nq_hook) : refText(p.naqeel_event),
        customer: unmask ? (x.name || p.customer) : p.customer, mobile: unmask ? (x.mobile || p.mobile) : p.mobile, iccid: unmask ? (x.iccid || p.iccid) : p.iccid,
        landline: unmask ? (x.landline || p.landline) : p.landline, plan: p.plan, counted: true }; });
    return { ...base, head: PAID_HEAD, rows, population: list.length, counted: list.length, capped: list.length > rows.length,
      note: `every paid 5G e-purchase journey the Payments watch classifies as "${CLS_OF[key].map(k => CLS[k].label).join('" or "')}" (1-SAR test orders left out, as in the alert) · snapshot of ${at}, refreshed every 10 min — the one the evaluation read` };
  }
  if (key === 'fixed_ep5g_lock_leak') {
    const list = s.locks.leaked;
    return { ...base, population: list.length, counted: list.length,
      head: [['created_at', 'Locked at (KSA)'], ['expired_at', 'Journey expired (KSA)'], ['goods', 'Goods'], ['sn', 'Serial'], ['wf', 'Journey id'], ['channel', 'Channel'], ['step', 'Step']],
      rows: list.slice(0, cap).map(r => ({ created_at: tsOf(r.created_at), expired_at: tsOf(r.expired_at), goods: r.goods, sn: unmask ? r.sn_raw : r.sn, wf: r.wf, channel: r.chLabel, step: r.stepLabel, counted: true })),
      note: `every SIM / landline lock still LOCKED on a 5G journey that expired more than 2 h ago (nothing in nexus releases them) · snapshot of ${at} · the alert value is the total of every goods type (the snapshot lists up to 300)` };
  }
  if (key === 'fixed_ep_auth_stuck') {
    const list = s.holds.rows;
    let inv = {};
    if (unmask && list.length) inv = await withClient(c => c.query(`SELECT workflow_state_id AS wf, invoice_id FROM epurchase_payments WHERE workflow_state_id = ANY($1::text[]) AND invoice_status::text = 'AUTHORIZED'`, [list.map(r => r.wf)]))
      .then(r => Object.fromEntries(r.rows.map(x => [x.wf, x.invoice_id])), () => ({}));
    return { ...base, population: list.length, counted: list.length,
      head: [['expired_at', 'Journey expired (KSA)'], ['updated_at', 'Payment updated (KSA)'], ['type', 'Journey type'], ['wf', 'Journey id'], ['channel', 'Channel'], ['step', 'Step'], ['invoice', 'Invoice'], ['has_order', 'Has an order']],
      rows: list.slice(0, cap).map(r => ({ expired_at: tsOf(r.expired_at), updated_at: tsOf(r.updated_at), type: r.type, wf: r.wf, channel: r.chLabel, step: STEP_LABEL[r.step] || r.step,
        invoice: unmask ? (inv[r.wf] || r.invoice) : r.invoice, has_order: r.has_order ? 'yes' : 'no', counted: true })),
      note: `every e-purchase card authorisation still AUTHORIZED on a journey that expired more than 60 min ago (neither captured nor voided) · snapshot of ${at}` };
  }
  if (key === 'fixed_ep_ftth_paid_no_order') {
    const list = s.ftth.list;
    const raw = unmask ? await raw5g(list.map(r => r.id)) : {};
    return { ...base, population: s.ftth.summary.no_later_charged, counted: s.ftth.summary.no_later_charged, capped: s.ftth.summary.no_later_charged > list.length,
      head: [['created_at', 'Started (KSA)'], ['expired_at', 'Expired (KSA)'], ['id', 'Journey id'], ['channel', 'Channel'], ['step', 'Stopped at'], ['invoice', 'Invoice'], ['amount_sar', 'Amount (SAR)'], ['customer', 'Customer id']],
      rows: list.slice(0, cap).map(r => ({ created_at: tsOf(r.created_at), expired_at: tsOf(r.expired_at), id: r.id, channel: r.chLabel, step: r.stepLabel, invoice: r.inv, amount_sar: r.amount_sar,
        customer: unmask ? ((raw[r.id] || {}).cid || r.customer) : r.customer, counted: true })),
      note: `every e-purchase FTTH journey charged (a real invoice, PAID or CAPTURED) that expired at verification / OTP before the order, with no later order by the same customer · zero-fee (PAID_BY_ZERO) journeys left out, as in the alert · snapshot of ${at} (lists up to 200)` };
  }
  return { supported: false, reason: 'no case list for this Payments-watch metric yet' };
}

function mount(app, { gate, wrap, audit }) {
  app.get('/api/fixed/epwatch/overview', gate, wrap(async (q, req) => {
    const r = await overview(q, req);
    if (r.unmasked && audit) await audit(req, 'pii.unmask', 'fixed.epwatch.locks', { rows: r.locks.leaked.length, page: 'fixed.epwatch' });
    return r;
  }));
}

module.exports = { mount, overview, snapshot, METRICS, caseRows, CASE_METRICS, classify5g, STEPS_5G, STEPS_P2P, PLACEHOLDER };
