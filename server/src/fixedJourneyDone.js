/* fixedJourneyDone.js — "was this customer's order processed?" for the Fixed alert metrics (alpha.169, 9 Oct 2026).
 *
 * Asked 9 Oct, on the P1 "Epurchase · traffic collapsed" and journey wf_st_onnp2jwwbflv (checkPayment "Invalid order state"
 * ×3, then confirmOtp and reviewOrder OK — the order went through): "make sure the count is per unique flow / customer
 * journey, and in case an order is processed, just note it as errors to review — do not include it in triggering alerts".
 *
 * So every Fixed failure metric now counts JOURNEYS, not log lines or error events, and a journey whose order was
 * processed is taken out of the numerator: its errors are reported in the incident text as "errors to review" and in the
 * cases export (column "Order processed"), never as a trigger.
 *
 * UNIT (app log) = state_id (the nexus workflow_state id, wf_st_… = sda_ops order_attempts.id) when the line carries one;
 *   otherwise the request id (one tRPC call — Salam Home app and the payments worker log almost no state ids), otherwise
 *   the line itself. A customer retrying a failing step ten times in one journey is ONE journey.
 * UNIT (board) = e.attempt_id (= the same workflow id), otherwise the event.
 *
 * ORDER PROCESSED — either source is enough:
 *   1. sda_ops order_attempts.outcome = 'COMPLETED' (prod and beta read models; the read model's own verdict), or
 *   2. the app log shows the journey's final step succeeding: Epurchase reviewOrder (the step after confirmOtp places the
 *      order — "Order placed"), SDA submitOrder / reviewOrder. Epurchase submitOrder is NOT final (order summary, payment
 *      and OTP come after it) and is deliberately not in the list. FIXED_DONE_STEPS=web:reviewOrder,sda:submitOrder,…
 *      replaces the list.
 * Salam Home app journeys rarely carry a state id: for them only the read model can say "completed".
 *
 * A failure in a journey still IN PROGRESS counts (we cannot know yet). When that journey completes, the next tick takes
 * it out and the rule recovers by itself.
 * EXCEPTION (deliberate): "paid but BSS not notified" / "provision — no order" (PAYMENT_NOT_NOTIFIED, PROVISION_NO_ORDER)
 * keep counting on a completed journey — a journey can reach its last screen while BSS never got the payment, which is
 * exactly what those categories mean. PAYMENT_FAILED on a completed journey (the customer paid on a retry) does not. */
'use strict';
const db = require('./db');

function parseDone(s) {
  const out = {};
  for (const part of String(s || '').split(',').map(x => x.trim()).filter(Boolean)) {
    const [ch, step] = part.split(':').map(x => (x || '').trim());
    if (!ch || !step || !/^[A-Za-z0-9_]+$/.test(ch) || !/^[A-Za-z0-9_]+$/.test(step)) continue;
    (out[ch] = out[ch] || []).push(step);
  }
  return out;
}
const DONE_STEPS = parseDone(process.env.FIXED_DONE_STEPS != null ? process.env.FIXED_DONE_STEPS : 'web:reviewOrder,sda:submitOrder,sda:reviewOrder');
/* SQL predicate on fixed_app_events (no alias): this line is a journey's final step succeeding */
const DONE_SQL = Object.keys(DONE_STEPS).length
  ? `(ok IS TRUE AND state_id IS NOT NULL AND (${Object.entries(DONE_STEPS).map(([ch, st]) => `(channel = '${ch}' AND path ~ '\\.(${st.join('|')})$')`).join(' OR ')}))`
  : 'FALSE';
/* the counting unit of an app-log line */
const UNIT_SQL = `coalesce(state_id, 'rq:' || request_id, 'ln:' || id::text)`;
/* categories that keep counting on a completed journey (see the header) */
const MONEY_ALWAYS = ['PAYMENT_NOT_NOTIFIED', 'PROVISION_NO_ORDER'];

const C = () => db.console;
const opsPools = () => { const l = []; if (db.ops) l.push(db.ops); if (db.opsBeta && db.opsBeta !== db.ops) l.push(db.opsBeta); return l; };

let idxOk = null;
function ensureIndex() {
  if (!C()) return Promise.resolve(false);
  if (!idxOk) idxOk = C().query(`CREATE INDEX IF NOT EXISTS idx_fixed_app_events_state ON fixed_app_events (state_id) WHERE state_id IS NOT NULL`)
    .then(() => true).catch(e => { console.error(`[fixedJourneyDone] index: ${e.message}`); return false; });
  return idxOk;
}

/* BASE: every journey known to be processed since `days` ago — cached 10 min. Used as an exclusion list by the history
 * queries (baselines over 14 days), and as the first answer for the live ones. */
let base = { at: 0, set: new Set(), since: 0, p: null };
async function baseSet(days = 16) {
  const fresh = Date.now() - base.at < 10 * 60e3 && base.since <= Date.now() - days * 864e5 + 60e3;
  if (fresh) return base.set;
  if (base.p) return base.p;
  base.p = (async () => {
    const since = new Date(Date.now() - days * 864e5).toISOString(); const set = new Set();
    for (const pool of opsPools()) {
      try { const r = await pool.query(`SELECT id FROM order_attempts WHERE outcome::text = 'COMPLETED' AND started_at >= $1::timestamptz`, [since]); for (const x of r.rows) if (x.id) set.add(String(x.id)); }
      catch (e) { console.error(`[fixedJourneyDone] read model: ${e.message}`); }
    }
    if (C()) {
      try { const r = await C().query(`SELECT DISTINCT state_id FROM fixed_app_events WHERE ts >= $1::timestamptz AND ${DONE_SQL}`, [since]); for (const x of r.rows) set.add(String(x.state_id)); }
      catch (e) { console.error(`[fixedJourneyDone] app log: ${e.message}`); }
    }
    base = { at: Date.now(), set, since: Date.now() - days * 864e5, p: null };
    return set;
  })().catch(e => { base.p = null; throw e; });
  return base.p;
}

/* LIVE: of these ids, which are processed RIGHT NOW. The base answers most; the rest are looked up by id (indexed on both
 * sides) — a journey that completed a minute ago is out on this tick. Positive answers are kept 6 h, negatives 60 s. */
const known = new Map();                       // id → { done, at }
async function doneOf(ids) {
  const want = [...new Set((ids || []).filter(Boolean).map(String))];
  const out = new Set(); if (!want.length) return out;
  let b; try { b = await baseSet(); } catch (_) { b = new Set(); }
  const ask = [];
  for (const id of want) {
    if (b.has(id)) { out.add(id); continue; }
    const k = known.get(id);
    if (k && k.done && Date.now() - k.at < 6 * 3600e3) { out.add(id); continue; }
    if (k && !k.done && Date.now() - k.at < 60e3) continue;
    ask.push(id);
  }
  for (let i = 0; i < ask.length; i += 5000) {
    const chunk = ask.slice(i, i + 5000); const hit = new Set();
    for (const pool of opsPools()) {
      try { const r = await pool.query(`SELECT id FROM order_attempts WHERE id = ANY($1::text[]) AND outcome::text = 'COMPLETED'`, [chunk]); for (const x of r.rows) hit.add(String(x.id)); }
      catch (e) { console.error(`[fixedJourneyDone] read model by id: ${e.message}`); }
    }
    if (C()) {
      await ensureIndex();
      try { const r = await C().query(`SELECT DISTINCT state_id FROM fixed_app_events WHERE state_id = ANY($1::text[]) AND ts >= now() - interval '16 days' AND ${DONE_SQL}`, [chunk]); for (const x of r.rows) hit.add(String(x.state_id)); }
      catch (e) { console.error(`[fixedJourneyDone] app log by id: ${e.message}`); }
    }
    for (const id of chunk) { const d = hit.has(id); known.set(id, { done: d, at: Date.now() }); if (d) out.add(id); }
  }
  if (known.size > 50000) for (const [k, v] of known) { if (Date.now() - v.at > 6 * 3600e3) known.delete(k); }
  return out;
}

module.exports = { DONE_STEPS, DONE_SQL, UNIT_SQL, MONEY_ALWAYS, baseSet, doneOf, ensureIndex, parseDone };
