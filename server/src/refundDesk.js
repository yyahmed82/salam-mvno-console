/* refundDesk.js — AGENT 2 · REFUND DESK (26 Sep 2026). The refund cycle used to run on mail: the call centre opened an
 * INC, L2 investigated in proxycms, typed a table (incident · amount · date · reason · proof) into a "Request for Refund
 * Approval" mail, the approver replied, L2 posted the refund, nobody kept a register. Since alpha.98 the console detects
 * the cases first (refundRadar.js) and reconciles them with the proxycms register; this module is the desk clerk that
 * works the queue, inside the same PM2 service as the incident triage (salam-agent-incident):
 *
 *   review    every open candidate without a review gets one — deterministic first (the kind, the Semati code, the
 *             courier state, the change-plan message, the proxycms ledger state, the customer's timeline), then ONE
 *             on-prem model call (JSON) → verdict refund | wait | dismiss | investigate, the proxycms reason to use,
 *             the root-cause category, the cause in one sentence, the first action, confidence. Stored in
 *             refund_reviews, shown on the row and in the drawer, 👍 / 👎 feedback like the incident triage.
 *   assign    the candidate carries the responder team of its desk (the executing team — the people who post the
 *             refund in the gateway back office) — the same registry as incidents (teams.js), so the audience, the DL
 *             and the contract apply.
 *   notify    each tick that reviewed new cases mails ONE digest to the team (people + DL) — never one mail per case.
 *   batch     once a day at report_hour KSA (assist mode) or on demand (a person, advise mode) the cases with verdict
 *             refund / status approved that are not yet in a batch become the approval request: the same table the L2
 *             mail carried, generated, with the evidence and the payment ids L2 needs in proxycms, an XLSX attached,
 *             To = the approvers of the desk, Cc = the executing team (+ the desk's copy list), recorded in
 *             refund_batches and agent_reports, and — open_incident — an INTERNAL ticket "Refund batch …" (P4 by
 *             default) assigned to the executing team so the ack SLA, the reminders and (optionally) ChatOps chase it.
 *   reconcile the batch closes itself when every case is refunded (proxycms, via refundRadar.correlate) or dismissed;
 *             progress is posted on the incident, which is resolved with the batch.
 *   SLA       two clocks per desk (Settings › Teams › Refund desks): approve_within_h — from the request to the
 *             decision (refund_candidates.decided_at) — and refund_within_h — from the approval to the register showing
 *             the refund. Overdue cases feed the metrics refund_sla_approval_overdue / refund_sla_execution_overdue,
 *             each behind a P4 rule (refund_approval_overdue → the Salam side, refund_execution_overdue → the L2 team).
 * WHO HANDLES REFUNDS — the desks (26 Sep 2026, settings key refund_desks, edited in Settings › Teams › Refund desks):
 * one desk per business. Mobile · proxycms is live; Fixed · Moyasar is defined but has no detector yet (its cases
 * will arrive with the Fixed refund radar). RECIPIENTS ARE STRICT: the approval request goes to the approvers typed
 * on the desk — nobody else, no fallback to the L1 team or to the report audience (alpha.100's fallback mailed batch
 * #1 to the Fixed/Sigma people); with no approver the batch is NOT sent and the page says so. Every address is
 * checked against console_users: a person of the other business is dropped and reported. The Mobile desk inherits
 * the alpha.100/101 policy (settings key agent_refund) until it is saved once from Settings › Teams.
 * HUMAN IN THE LOOP — the guardrails (26 Sep 2026, Yosri): the desk HELPS, people ACT. It never approves, refunds or
 * dismisses a case (refund_candidates.status is written by people on the page, or reflected from the proxycms
 * register when L2 has posted the refund), never writes to proxycms, the gateway, production or the replica, never
 * creates a refund anywhere. Its verdicts are proposals; its mails say so; the refund itself is L2's act in proxycms.
 * Modes: 'advise' (DEFAULT) = review + route to the team + digest of new cases; the approval batch and its ticket are
 * PREPARED by the desk and SENT by a person from the page. 'assist' = the batch mail and its ticket also go out daily
 * on their own — still no approval, no refund, no dismissal by the agent. */
'use strict';
process.env.TZ = process.env.TZ || 'UTC';
const db = require('./db');
const llm = require('./llm');
const teams = require('./teams');
const radar = require('./refundRadar');

const CFG = {
  enabled: process.env.AGENT_REFUND_ENABLED !== '0',
  intervalMin: Math.max(2, Number(process.env.AGENT_REFUND_INTERVAL_MIN) || 15),
  maxPerTick: Math.max(1, Number(process.env.AGENT_REFUND_MAX_PER_TICK) || 12),
  maxModelPerTick: Math.max(0, Number(process.env.AGENT_REFUND_MAX_MODEL_PER_TICK) || 8),
  retryMin: 30, maxRetries: 4
};
const KSA_TZ = 'Asia/Riyadh';
const C = () => db.console;
const log = (...a) => console.log(`[AGENT-REFUND] ${new Date().toISOString()}`, ...a);
const ksa = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('en-GB', { timeZone: KSA_TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ''); };
const ksaDate = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
const ksaHour = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3).getUTCHours();
const money = v => Number(v || 0).toFixed(2);
const maskMobile = m => { const s = String(m || ''); return s.length <= 3 ? '***' : '*'.repeat(Math.max(3, s.length - 3)) + s.slice(-3); };
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---- the desks: one per business; the fields a super admin edits in Settings › Teams › Refund desks ---- */
const BUSINESSES = ['mobile', 'fixed'];
const SEG_OF = { mobile: 'mvno', fixed: 'fixed' };
const LABEL_OF = { mobile: 'Mobile', fixed: 'Fixed' };
const DEFAULT_POLICY = { enabled: true, mode: 'advise', team: 'mobile-digital-l2', approvers: [], cc: [], report_hour: 9, notify_new: true, open_incident: true, ticket_severity: 'P4', chatops: false, min_confidence: 0.5, approve_within_h: 24, refund_within_h: 48, note: '' };
const DESK_SEED = {
  mobile: { ...DEFAULT_POLICY, label: 'Mobile · proxycms', gateway: 'proxycms', team: 'mobile-digital-l2', ready: true },
  fixed: { ...DEFAULT_POLICY, enabled: false, label: 'Fixed · Moyasar', gateway: 'Moyasar', team: 'fixed-apps-l2', ready: false },   // ready = a detector feeds it (the Fixed refund radar is not built yet)
};
const SEVERITIES = ['P1', 'P2', 'P3', 'P4'];
const emailList = v => { const arr = Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/); return [...new Set(arr.map(x => String(x || '').trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))]; };
const hoursOf = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 720 ? Math.round(n) : d; };
/* what the desk never does — shown on the page, enforced by the absence of any code path for it */
const GUARDRAILS = ['never approves, refunds or dismisses a case — Approve / Refunded / Dismiss are buttons for people, recorded by name',
  'never writes to proxycms, the payment gateway, production or the replica — the refund is posted by L2 in proxycms',
  'a case closes as "Refunded · proxycms" only when the register shows the refund L2 posted; "resolved by the platform" only when the detector no longer finds it',
  'its verdicts and reasons are proposals with a confidence; the approval request is a mail a person sends (advise mode) or that goes out daily (assist mode)',
  'its ticket and digest mails inform and chase — they change nothing on the case',
  'it mails only the approvers and the executing team defined for the desk in Settings › Teams — no fallback list, nobody of the other business'];
const VERDICTS = ['refund', 'wait', 'dismiss', 'investigate'];
/* the proxycms reason list as of 26 Sep 2026 (refund_reasons on prod); the live table wins when the replica has it */
const REASONS_SEED = ['Customer exceeded the limit', 'Wrong details in Onboarding order', 'Changed his mind', 'ICCID issue', 'Failed change plan from BSS', 'MSISDN Reservation Expired', 'CMS issue',
  'SIM not Delivered (changed his mind)', 'Activated though DMS / has another order', 'Activation Technical issue (Already exist)', "Portin Semati issue MSISDN doesn't exist", 'Semati Issue', 'Change Plan type',
  'Wants a better offer', 'Rejected MNP', 'Device not compatible with eSIM', 'Ordered by Mistake', 'Coverage issue', 'Forgot password on Activation', 'POSA by Mistake',
  'IPhone Device refund (SMSA out of stock)', 'IPhone Device refund (Saleor Technical)', 'IPhone Device refund (Delay in delivery)', 'IPhone Device refund (Returned)', 'UAT'];

/* ------------------------------------------------------------------------------------------------ schema & policy */
async function ensureSchema() { await radar.ensure(); }   // radar.ensure() creates the candidates tables, then calls ensureDeskSchema()
async function ensureDeskSchema() {
  await C().query(`CREATE TABLE IF NOT EXISTS refund_reviews (
      id bigserial PRIMARY KEY, candidate_id bigint UNIQUE NOT NULL, kind text, verdict text, reason text, category text, cause text, action text, customer_note text,
      priority text, confidence real, deterministic boolean NOT NULL DEFAULT false, model text, ms integer, evidence jsonb NOT NULL DEFAULT '{}',
      attempts integer NOT NULL DEFAULT 1, retried_at timestamptz, helpful boolean, feedback_by text, feedback_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz)`);
  await C().query(`CREATE INDEX IF NOT EXISTS idx_refund_reviews_at ON refund_reviews (created_at DESC)`);
  for (const col of ['team text', 'assignee text', 'batch_id bigint', 'reviewed_at timestamptz', 'decided_at timestamptz', 'decided_by text']) await C().query(`ALTER TABLE refund_candidates ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
  /* 26 Sep 2026 — the decision clock: decided_at = the first human decision (approve / refunded / dismiss). Cases decided
   * before the column existed take their last human update; a closure by the register or the platform is not a decision. */
  await C().query(`UPDATE refund_candidates SET decided_at = updated_at, decided_by = updated_by WHERE decided_at IS NULL AND status IN ('approved','refunded','dismissed') AND updated_at IS NOT NULL AND coalesce(updated_by,'') NOT IN ('', 'proxycms', 'platform')`).catch(() => {});
  await C().query(`CREATE TABLE IF NOT EXISTS refund_batches (
      id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), created_by text, period_from date, period_to date,
      cases integer NOT NULL DEFAULT 0, sar numeric NOT NULL DEFAULT 0, candidate_ids bigint[] NOT NULL DEFAULT '{}', approvers text[] NOT NULL DEFAULT '{}', cc text[] NOT NULL DEFAULT '{}',
      subject text, mailed jsonb, alert_id bigint, report_id bigint, status text NOT NULL DEFAULT 'open', closed_at timestamptz, refunded integer NOT NULL DEFAULT 0, dismissed integer NOT NULL DEFAULT 0, last_progress text)`);
  await C().query(`CREATE TABLE IF NOT EXISTS agent_runs (id bigserial PRIMARY KEY, agent text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, ok boolean, stats jsonb NOT NULL DEFAULT '{}', error text)`);
  await C().query(`CREATE TABLE IF NOT EXISTS agent_reports (id bigserial PRIMARY KEY, kind text NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL, summary jsonb NOT NULL DEFAULT '{}', narrative text, mailed_to integer, created_at timestamptz NOT NULL DEFAULT now())`).catch(() => {});
}
/* one desk, normalised: every field has a value, every list is clean, the fixed facts (label, gateway, segment) come from the seed */
function normalise(biz, raw) {
  const seed = DESK_SEED[biz]; const s = raw && typeof raw === 'object' ? raw : {};
  const p = { ...seed, ...s, business: biz, label: seed.label, gateway: seed.gateway, segment: SEG_OF[biz], ready: seed.ready };
  p.enabled = p.enabled !== false; p.mode = p.mode === 'assist' ? 'assist' : 'advise';
  p.team = String(p.team || seed.team).trim().toLowerCase();
  p.approvers = emailList(p.approvers); p.cc = emailList(p.cc).filter(e => !p.approvers.includes(e));
  p.report_hour = Math.min(23, Math.max(0, Number(p.report_hour) || 0)); p.min_confidence = Math.min(1, Math.max(0, Number(p.min_confidence) || 0.5));
  p.ticket_severity = SEVERITIES.includes(p.ticket_severity) ? p.ticket_severity : 'P4';
  p.open_incident = p.open_incident !== false; p.notify_new = p.notify_new !== false; p.chatops = !!p.chatops;
  p.approve_within_h = hoursOf(p.approve_within_h, DEFAULT_POLICY.approve_within_h); p.refund_within_h = hoursOf(p.refund_within_h, DEFAULT_POLICY.refund_within_h);
  p.note = String(p.note || '').slice(0, 300);
  return p;
}
async function getDesks() {
  let all = {}, legacy = null;
  try { const st = require('./settings'); all = (await st.getSetting('refund_desks')) || {}; legacy = await st.getSetting('agent_refund'); } catch (_) {}
  if (!all || typeof all !== 'object') all = {};
  const out = {};
  for (const biz of BUSINESSES) {
    const raw = all[biz] && typeof all[biz] === 'object' ? all[biz] : null;
    /* the Mobile desk inherits the alpha.100/101 policy (settings key agent_refund) until it is saved from Settings › Teams;
     * its old approver fallback chain is gone — only typed approvers count */
    out[biz] = normalise(biz, raw || (biz === 'mobile' && legacy && typeof legacy === 'object' ? legacy : null));
    out[biz].saved = !!raw;
  }
  return out;
}
const bizOf = b => BUSINESSES.includes(b) ? b : 'mobile';
async function getPolicy(business = 'mobile') { return (await getDesks())[bizOf(business)]; }
/* save one desk (super admin, Settings › Teams › Refund desks); the executing team must exist and cover the business */
async function setPolicy(business, patch, actor) {
  const biz = bizOf(business); const settings = require('./settings');
  const all = (await settings.getSetting('refund_desks')) || {}; const cur = (await getDesks())[biz];
  const next = {}; for (const k of Object.keys(DEFAULT_POLICY)) next[k] = patch && patch[k] !== undefined ? patch[k] : cur[k];
  const n = normalise(biz, next);
  const t = await teams.resolve(n.team); if (!t) throw new Error(`unknown team "${n.team}" — pick a team of the responder registry`);
  if (t.business !== 'both' && t.business !== biz) throw new Error(`${t.name} does not cover ${LABEL_OF[biz]} — the executing team must be a ${LABEL_OF[biz]} (or both) team`);
  if (n.mode === 'assist' && !n.approvers.length) throw new Error('assist mode sends the approval request on its own — define at least one approver first');
  const store = {}; for (const k of Object.keys(DEFAULT_POLICY)) store[k] = n[k]; store.team = t.key;
  store.updated_at = new Date().toISOString(); store.updated_by = actor || null;
  all[biz] = store;
  await settings.setSetting('refund_desks', all);
  return (await getDesks())[biz];
}
let _reasons = { at: 0, list: REASONS_SEED };
async function knownReasons() {
  if (Date.now() - _reasons.at < 10 * 60e3) return _reasons.list;
  try { const r = await db.source.query(`SELECT reason FROM refund_reasons WHERE coalesce(reason,'') <> '' ORDER BY id`); if (r.rows.length) _reasons = { at: Date.now(), list: r.rows.map(x => x.reason) }; else _reasons.at = Date.now(); }
  catch (_) { _reasons.at = Date.now(); }
  return _reasons.list;
}
const pickReason = (txt, list) => { const s = String(txt || '').trim().toLowerCase(); if (!s) return null; const exact = list.find(r => r.toLowerCase() === s); if (exact) return exact; const part = list.find(r => r.toLowerCase().includes(s) || s.includes(r.toLowerCase())); return part || null; };

/* ------------------------------------------------------------------------------------------------ evidence + deterministic verdict */
const SEMATI = { '706': 'reached the maximum number of lines', '727': 'person / ID not found at Semati', '731': 'SIM / ICCID rejected by Semati', '738': 'person ID expired at Semati', '784': 'IAM token expired', '793': 'ID mismatch at Semati' };
const codeOf = s => { const m = /\b(7\d\d)\b/.exec(String(s || '')); return m ? m[1] : null; };
const ageH = c => c.event_at ? (Date.now() - new Date(c.event_at).getTime()) / 36e5 : 0;
function preClassify(c) {
  const e = c.evidence || {}; const L = c.ledger || {}; const h = ageH(c);
  const base = { verdict: 'investigate', reason: null, category: radar.categorize(''), cause: '', action: 'check the customer timeline in Troubleshoot', confidence: 0.45, skipModel: false };
  if (L.status === 'success' || L.pay_status === 'refunded') return { ...base, verdict: 'dismiss', reason: L.reason || null, cause: 'already refunded in proxycms', action: 'nothing — the register closes it', confidence: 0.95, skipModel: true };
  if (L.status === 'pending') return { ...base, verdict: 'wait', reason: L.reason || null, cause: 'a refund is pending at the gateway in proxycms', action: 'proxycms › Refunds › Rsync Refund if it stays pending', confidence: 0.9, skipModel: true };
  if (L.status === 'fail') return { ...base, verdict: 'refund', reason: L.reason || null, cause: `the refund posted in proxycms FAILED at the gateway${L.fail_reason ? ' (' + L.fail_reason + ')' : ''}`, action: 'proxycms › Refunds › Re-Request, or a manual refund through Finance', confidence: 0.9, skipModel: true };
  switch (c.kind) {
    case 'paid_not_activated': { const code = codeOf(e.last_activation);
      if (code && SEMATI[code]) return { ...base, verdict: h > 24 ? 'refund' : 'wait', reason: code === '731' ? 'ICCID issue' : 'Semati Issue', cause: `activation answered Semati ${code} — ${SEMATI[code]}`, action: 'nothing will activate on this order — refund and let the customer re-order', confidence: 0.8 };
      if (e.port_in) return { ...base, verdict: h > 24 * 7 ? 'refund' : 'wait', reason: 'Rejected MNP', cause: 'port-in order paid, not activated after the port-in window', action: 'check the MNP status with the donor operator before refunding', confidence: 0.55 };
      return { ...base, verdict: 'investigate', reason: 'Semati Issue', cause: e.last_activation ? `last activation answer: ${String(e.last_activation).slice(0, 80)}` : 'paid, no activation attempt recorded', confidence: 0.45 }; }
    case 'portin_twice': return { ...base, verdict: 'refund', reason: 'Activated though DMS / has another order', cause: `the same ported number ${e.ported_number ? '(' + maskMobile(e.ported_number) + ') ' : ''}was ordered and paid twice; the first order ${e.first_activated ? 'is active' : 'is not active either'}`, action: 'refund the second order; keep the first', confidence: e.first_activated ? 0.8 : 0.6 };
    case 'change_plan_paid_failed': { const iam = /IAM|TOKEN/i.test(String(e.message || ''));
      return { ...base, verdict: 'refund', reason: 'Failed change plan from BSS', cause: iam ? 'change plan charged, BSS step failed on the IAM token' : `change plan charged, BSS step failed: ${String(e.message || '').slice(0, 80)}`, action: 'refund the plan change; the line keeps its previous plan', confidence: iam ? 0.85 : 0.7 }; }
    case 'sim_replacement_paid': { const code = codeOf(e.last_semati); const esim = e.sim === 'eSIM';
      if (code && SEMATI[code]) return { ...base, verdict: 'refund', reason: code === '731' ? 'ICCID issue' : 'Semati Issue', cause: `${esim ? 'eSIM' : 'SIM'} replacement paid, Semati new-sim answered ${code} — ${SEMATI[code]}`, action: 'refund the replacement fee; the customer retries once the ID is valid', confidence: 0.85 };
      if (!esim && e.delivery === 'pickup') return { ...base, verdict: h > 24 * 7 ? 'refund' : 'wait', reason: 'SIM not Delivered (changed his mind)', cause: 'physical SIM replacement paid, pickup never collected', action: 'call the customer; refund if the SIM will not be collected', confidence: 0.6 };
      if (!esim && e.courier_state) return { ...base, verdict: h > 24 * 7 ? 'refund' : 'wait', reason: 'SIM not Delivered (changed his mind)', cause: `physical SIM replacement paid, courier state ${e.courier_state}`, action: 'escalate to the courier with the reference; refund if returned', confidence: 0.6 };
      return { ...base, verdict: h > 72 ? 'refund' : 'wait', reason: esim ? 'Device not compatible with eSIM' : 'ICCID issue', cause: `${esim ? 'eSIM' : 'SIM'} replacement paid ${Math.round(h)} h ago, never completed, no Semati answer recorded`, action: 'check the replacement checkout in proxycms; refund if the customer cannot complete it', confidence: 0.5 }; }
    case 'delivery_failed_paid': { const st = String(e.state || '').toLowerCase(); const soft = /onhold|pickup_failed|dex/i.test(st);
      return { ...base, verdict: soft && h < 72 ? 'wait' : 'refund', reason: 'SIM not Delivered (changed his mind)', cause: `paid order, courier ${e.courier || ''} state ${e.state || '?'}, order not activated`, action: soft ? 'the courier may retry; refund if the shipment is returned' : 'refund; the SIM never reached the customer', confidence: soft ? 0.55 : 0.75 }; }
    case 'duplicate_charge': return { ...base, verdict: 'refund', reason: 'Ordered by Mistake', cause: `the card was captured ${e.charges || 2} times for the same ${e.paid_for || 'target'} within ${e.seconds_apart != null ? Math.round(e.seconds_apart / 60) + ' min' : '30 min'}`, action: 'refund the second charge (keep the first payment)', confidence: 0.7 };
    default: return base;
  }
}
async function evidenceFor(c) {
  const out = { ledger: c.ledger || null, siblings: [], timeline: [] };
  try { const s = await C().query(`SELECT id, kind, status, amount::float amount, event_at, inc FROM refund_candidates WHERE id <> $1 AND detected_at >= now() - interval '120 days' AND (mobile = $2 OR (order_id IS NOT NULL AND order_id = $3)) ORDER BY event_at DESC LIMIT 5`, [c.id, c.mobile || '', c.order_id || '']); out.siblings = s.rows; } catch (_) {}
  try {
    const key = c.order_id || c.payment_id || c.mobile;
    if (key) { const t = await Promise.race([require('./errors').timeline({ identifier: key }), new Promise(r => setTimeout(() => r(null), 8000))]);
      if (t && Array.isArray(t.events)) out.timeline = t.events.slice(-10).map(ev => ({ at: ev.at, source: ev.source, kind: ev.kind, ok: ev.ok, detail: String(ev.detail || '').slice(0, 140) })); }
  } catch (_) {}
  return out;
}

const SYSTEM = `You are the refund desk of the Salam Operations Console (Salam Mobile, a Saudi MVNO: onboarding orders, eSIM / SIM replacement, plan changes, port-in via Semati, deliveries by courier, payments via HyperPay / Tap / Salam Pay, refunds posted by the L2 team in proxycms).
A CANDIDATE is a customer payment the platform did not deliver on. Decide what the L2 team should do and which proxycms reason applies.
Output ONLY a JSON object: {"verdict":"refund|wait|dismiss|investigate","reason":"<one reason copied EXACTLY from REASONS>","cause":"<= 30 words, concrete, from the evidence","action":"<= 25 words, the first concrete step for L2","customer_note":"<= 30 words, what to tell the customer","priority":"P2|P3|P4","confidence":0.0-1.0}
Rules: refund only when the evidence shows the service will not be delivered (a Semati/BSS error answer, a failed change plan, a duplicate capture, a returned shipment); wait when the flow can still complete (a recent payment, a courier still moving, a pending refund); dismiss when the case is already refunded or is not a platform failure; investigate when the evidence is missing. Never invent codes or amounts.`;

async function reviewOne(c, policy, { allowModel = true, force = false } = {}) {
  const t0 = Date.now(); const ev = await evidenceFor(c); const pre = preClassify(c); const reasons = await knownReasons();
  let out = null, j = null, llmDown = false;
  if (allowModel && !pre.skipModel) {
    const user = `CANDIDATE #${c.id} · kind ${c.kind} (${(radar.KINDS[c.kind] || {}).label || c.kind}) · amount ${money(c.amount)} SAR · event ${c.event_at} (${Math.round(ageH(c))} h ago) · detected ${c.detected_at} · status ${c.status}
Evidence: ${JSON.stringify(c.evidence || {}).slice(0, 700)}
proxycms ledger: ${ev.ledger && (ev.ledger.id || ev.ledger.pay_status) ? JSON.stringify(ev.ledger).slice(0, 300) : 'no refund posted'}
Other candidates for this customer (120 d): ${ev.siblings.length ? ev.siblings.map(s => `#${s.id} ${s.kind} ${s.status} ${money(s.amount)} SAR`).join('; ') : 'none'}
Customer timeline (last events): ${ev.timeline.length ? ev.timeline.map(t => `${String(t.at || '').slice(0, 16)} ${t.source || ''} ${t.kind || ''} ${t.ok === false ? 'FAILED' : ''} ${t.detail}`).join(' | ').slice(0, 1200) : 'not available'}
Deterministic reading: verdict ${pre.verdict}, reason "${pre.reason || '-'}", ${pre.cause}
REASONS: ${reasons.join(' | ')}`;
    try {
      out = await llm.chat({ system: SYSTEM, user, purpose: 'agent-refund.review', caller: 'salam-agent-incident', json: true, maxTokens: 300, numCtx: 4096, temperature: 0.1 });
      j = out.json && typeof out.json === 'object' && VERDICTS.includes(String(out.json.verdict || '').toLowerCase()) ? out.json : null;
      if (!j) log(`review #${c.id}: unusable model answer (${out.provider} ${out.model}, ${out.ms} ms${out.jsonError ? ', ' + out.jsonError : ''})`);
    } catch (e) { llmDown = !!e.llm; log(`review #${c.id}: model ${e.llm ? 'unavailable' : 'failed'} — ${e.message.slice(0, 120)}; deterministic verdict kept`); }
  }
  const conf = j ? Math.min(1, Math.max(0, Number(j.confidence) || 0)) : pre.confidence;
  const reason = (j && pickReason(j.reason, reasons)) || pre.reason || null;
  const verdict = j && conf >= 0.5 ? String(j.verdict).toLowerCase() : pre.verdict;
  const cause = j && j.cause ? String(j.cause).slice(0, 300) : pre.cause;
  const action = j && j.action ? String(j.action).slice(0, 300) : pre.action;
  const category = radar.categorize(reason || '');
  const r = await C().query(`INSERT INTO refund_reviews (candidate_id, kind, verdict, reason, category, cause, action, customer_note, priority, confidence, deterministic, model, ms, evidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (candidate_id) DO UPDATE SET verdict = EXCLUDED.verdict, reason = EXCLUDED.reason, category = EXCLUDED.category, cause = EXCLUDED.cause, action = EXCLUDED.action, customer_note = EXCLUDED.customer_note,
        priority = EXCLUDED.priority, confidence = EXCLUDED.confidence, deterministic = EXCLUDED.deterministic, model = coalesce(EXCLUDED.model, refund_reviews.model), ms = EXCLUDED.ms, evidence = EXCLUDED.evidence,
        attempts = coalesce(refund_reviews.attempts, 1) + 1, retried_at = now(), updated_at = now() RETURNING *`,
    [c.id, c.kind, verdict, reason, category, cause, action, j && j.customer_note ? String(j.customer_note).slice(0, 300) : null, j && /^P[1-4]$/.test(String(j.priority || '')) ? j.priority : null, conf, !j, out ? `${out.provider}:${out.model}` : null, Date.now() - t0,
      JSON.stringify({ siblings: ev.siblings.length, timeline: ev.timeline.length, ledger: !!(ev.ledger && ev.ledger.id), pre })]);
  await C().query(`UPDATE refund_candidates SET reviewed_at = now(), team = coalesce(team, $2) WHERE id = $1`, [c.id, policy.team || null]);
  return { review: r.rows[0], model: !!j, verdict, llmDown };
}

/* ------------------------------------------------------------------------------------------------ recipients (strict) */
/* the executing team's audience for a desk: enabled members of THIS business (or both) + the team DL; a member whose
 * console business is the other side is dropped and reported (excluded) */
async function audience(policy) {
  const teamKey = typeof policy === 'string' ? policy : policy.team; const biz = typeof policy === 'string' ? null : policy.business;
  try {
    const t = await teams.get(teamKey); if (!t) return { team: null, list: [], excluded: [] };
    const members = (await teams.membersOf(teamKey)).filter(m => m.enabled !== false);
    const excluded = biz ? members.filter(m => m.business && m.business !== 'both' && m.business !== biz) : [];
    const list = members.filter(m => !excluded.includes(m)).map(m => ({ email: String(m.email).toLowerCase(), name: m.name }));
    if (t.mail_dl) list.push({ email: String(t.mail_dl).toLowerCase(), name: t.name });
    return { team: t, list, excluded: excluded.map(m => String(m.email).toLowerCase()) };
  } catch (_) { return { team: null, list: [], excluded: [] }; }
}
/* console users of the OTHER business among typed addresses — never mailed by this desk, shown as a warning */
async function crossBusiness(emails, biz) {
  if (!emails || !emails.length) return [];
  try { const other = biz === 'mobile' ? 'fixed' : 'mobile';
    const r = await C().query(`SELECT lower(email) AS email FROM console_users WHERE lower(email) = ANY($1::text[]) AND business = $2`, [emails, other]);
    return r.rows.map(x => x.email); } catch (_) { return []; }
}
/* who approves: ONLY the approvers typed on the desk (no L1 fallback, no report audience) minus the other business */
async function effectiveApprovers(policy) {
  const excluded = await crossBusiness(policy.approvers, policy.business);
  return { list: policy.approvers.filter(e => !excluded.includes(e)), excluded };
}
/* who is copied: the desk's copy list (cleaned the same way) + the executing team's audience */
async function effectiveCc(policy, aud, approvers) {
  const excluded = await crossBusiness(policy.cc, policy.business);
  const list = [...new Set([...policy.cc.filter(e => !excluded.includes(e)), ...aud.list.map(x => x.email)])].filter(e => !approvers.includes(e));
  return { list, excluded };
}
function warningsFor(policy, aud, appr, ccx) {
  const w = [];
  if (!policy.enabled) w.push({ code: 'disabled', text: `the ${policy.label} desk is switched off — nothing is reviewed, mailed or opened for it` });
  if (!policy.ready) w.push({ code: 'not_ready', text: `no detector feeds the ${policy.label} desk yet — the definition is in place for when the ${policy.gateway} refund cases are wired in` });
  if (!aud.team) w.push({ code: 'team_missing', text: `team "${policy.team}" is not in the responder registry` });
  else if (!aud.list.length) w.push({ code: 'team_empty', text: `${aud.team.name} has no members and no mail DL — the digest of new cases and the copy of the approval request reach nobody until Settings › Teams fills them` });
  if (!appr.list.length) w.push({ code: 'no_approver', text: `no approver — the approval request is NOT sent (and assist mode cannot be enabled) until at least one approver is defined for the desk` });
  if (appr.excluded.length) w.push({ code: 'cross_business', text: `${appr.excluded.join(', ')} ${appr.excluded.length > 1 ? 'are' : 'is'} of the other business — never mailed by this desk, remove from the approvers` });
  if (ccx.excluded.length) w.push({ code: 'cross_business_cc', text: `${ccx.excluded.join(', ')} ${ccx.excluded.length > 1 ? 'are' : 'is'} of the other business — dropped from the copy list` });
  if (aud.excluded.length) w.push({ code: 'cross_business_team', text: `${aud.excluded.join(', ')} — member${aud.excluded.length > 1 ? 's' : ''} of ${aud.team ? aud.team.name : policy.team} registered for the other business — not mailed by this desk` });
  return w;
}

/* ------------------------------------------------------------------------------------------------ notifications */
const consoleUrl = () => { try { return require('./notify').CONSOLE_URL; } catch (_) { return ''; } };
const kindLabel = k => (radar.KINDS[k] || {}).label || k;
const rowHtml = cells => `<tr>${cells.map(([v, num]) => `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12.5px;color:#20302a;vertical-align:top;${num ? 'text-align:right;white-space:nowrap' : ''}">${v}</td>`).join('')}</tr>`;
const headHtml = cols => `<tr>${cols.map(c => `<th style="padding:6px 8px;text-align:left;font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #cbd5e1">${esc(c)}</th>`).join('')}</tr>`;

async function notifyNew(items, policy) {
  const notify = require('./notify'); const aud = await audience(policy); if (!aud.list.length) return { sent: false, reason: 'team has no members and no mail DL' };
  const sar = items.reduce((a, x) => a + Number(x.c.amount || 0), 0); const biz = LABEL_OF[policy.business];
  const link = `${consoleUrl()}#refunds?tab=exposure`;
  const body = `<div style="background:#eaf6ff;border:1px solid #bfdcf5;border-left:4px solid #0891b2;border-radius:8px;padding:12px 16px;margin-bottom:14px"><div style="font-weight:800;color:#0c4a6e;font-size:13px">🤖 The refund desk reviewed ${items.length} new case(s) — ${money(sar)} SAR owed to customers, assigned to ${esc((aud.team && aud.team.name) || policy.team)}.</div>
      <div style="font-size:12.5px;color:#334155;margin-top:6px">Each row is a payment the platform did not deliver on, detected on the replica before any complaint. The verdict is the desk's <b>proposal</b> — nothing has been approved, refunded or dismissed: those are your decisions on the page, and the refund itself is posted by L2 in ${esc(policy.gateway)}. <a href="${link}" style="color:#0e9f5a;font-weight:700">Open Refund exposure ›</a></div></div>
    <table style="border-collapse:collapse;width:100%">${headHtml(['Ref', 'Kind', 'Customer', 'SAR', 'Verdict', 'Proposed reason', 'Why'])}${items.map(({ c, r }) => rowHtml([[`#${c.id}`], [esc(kindLabel(c.kind))], [esc(maskMobile(c.mobile))], [money(c.amount), true], [`<b>${esc(r.verdict)}</b> ${Math.round((r.confidence || 0) * 100)}%`], [esc(r.reason || '—')], [esc(r.cause || '')]])).join('')}</table>
    <div style="color:#94a3b8;font-size:12px;margin-top:14px">— Salam Operations Console · Agent 2 · refund desk · ${esc(biz)} · sent to the ${esc((aud.team && aud.team.name) || policy.team)} members and DL only · identities masked; the console shows them to authorised users</div>`;
  const html = notify.shell({ title: `Refund desk — ${items.length} new case(s)`, badge: `OPERATIONS CONSOLE · ${biz.toUpperCase()}`, pill: `${money(sar)} SAR · REVIEW`, pillColor: '#d97706', bodyHtml: body });
  return notify.sendHtml(aud.list, `[Salam Ops · ${biz}] 🤖 Refund desk — ${items.length} new case(s) · ${money(sar)} SAR`, html, []);
}

/* ------------------------------------------------------------------------------------------------ the batch (approval request) */
async function batchCandidates(policy) {
  return (await C().query(`SELECT c.*, c.amount::float AS amount, r.verdict, r.reason, r.cause, r.action, r.confidence, r.category FROM refund_candidates c LEFT JOIN refund_reviews r ON r.candidate_id = c.id
      WHERE c.side = $1 AND c.batch_id IS NULL AND ((c.status = 'approved') OR (c.status = 'open' AND r.verdict = 'refund')) ORDER BY c.event_at ASC LIMIT 200`, [policy.business])).rows;
}
/* the approval request. Nothing is sent, recorded or opened when the desk has no approver: the cases stay batchable
 * and the answer says why — the fix is in Settings › Teams › Refund desks, not in a fallback list. */
async function buildBatch({ actor = 'agent', policy: pol, business = 'mobile' } = {}) {
  const policy = pol || await getPolicy(business); const notify = require('./notify'); const biz = LABEL_OF[policy.business];
  const rows = await batchCandidates(policy);
  if (!rows.length) return { cases: 0, sent: false, reason: 'no case with verdict refund (or approved) outside a batch' };
  const sar = rows.reduce((a, x) => a + Number(x.amount || 0), 0);
  const aud = await audience(policy);
  const appr = await effectiveApprovers(policy);
  if (!appr.list.length) { log(`batch (${policy.business}): ${rows.length} case(s) · ${money(sar)} SAR waiting — NOT sent, no approver defined for the ${policy.label} desk`); return { cases: rows.length, sar, sent: false, blocked: 'no_approver', reason: `no approver is defined for the ${policy.label} desk (Settings › Teams › Refund desks) — the request was not sent; the ${rows.length} case(s) stay ready`, excluded: appr.excluded }; }
  const approvers = appr.list; const ccx = await effectiveCc(policy, aud, approvers); const cc = ccx.list;
  const today = ksaDate(); const link = `${consoleUrl()}#refunds?tab=exposure&status=all`;
  const subject = `[Salam Ops · ${biz}] Request for refund approval — ${rows.length} case(s) · ${money(sar)} SAR · ${today}`;
  const body = `<div style="background:#eaf6ff;border:1px solid #bfdcf5;border-left:4px solid #0e9f5a;border-radius:8px;padding:12px 16px;margin-bottom:14px"><div style="font-weight:800;color:#0c4a6e;font-size:13px">${rows.length} customer(s) are owed ${money(sar)} SAR — paid, not delivered by the platform, detected by the console and reviewed by the refund desk.</div>
      <div style="font-size:12.5px;color:#334155;margin-top:6px">This is a request for <b>your</b> approval: nothing has been approved or refunded by the console. Approve on the page (one click per case, recorded with your name and time) or reply to this mail; ${esc((aud.team && aud.team.name) || policy.team)} (in copy) then posts each approved refund in ${esc(policy.gateway)} with the reason below — the console closes the case from the register. <a href="${link}" style="color:#0e9f5a;font-weight:700">Open the batch ›</a></div>
      <div style="font-size:12px;color:#475569;margin-top:8px"><b>Desk SLA:</b> a decision within <b>${policy.approve_within_h} h</b> of this request · the refund posted in ${esc(policy.gateway)} within <b>${policy.refund_within_h} h</b> of the approval. Overdue cases open a ${esc(policy.ticket_severity)} ticket on the console.</div></div>
    <table style="border-collapse:collapse;width:100%">${headHtml(['Ref · INC', 'Amount', 'Date', 'Reason', 'Proof / analysis', 'Customer', `Payment (${policy.gateway})`])}${rows.map(x => rowHtml([[`<b>#${x.id}</b>${x.inc ? '<br>' + esc(x.inc) : ''}${x.status === 'approved' ? '<br><span style="color:#0e9f5a;font-weight:700">approved</span>' : ''}`], [money(x.amount), true], [esc(ksa(x.event_at))], [esc(x.reason || '—')], [`${esc(kindLabel(x.kind))}: ${esc(x.cause || '')}${x.action ? '<br><span style="color:#64748b">' + esc(x.action) + '</span>' : ''}`], [esc(maskMobile(x.mobile))], [`<span style="font-family:ui-monospace,Menlo,monospace;font-size:11px">${esc(x.payment_id || '—')}</span>`]])).join('')}
      <tr><td colspan="7" style="padding:8px;font-weight:800;text-align:right">Total ${money(sar)} SAR</td></tr></table>
    <div style="color:#94a3b8;font-size:12px;margin-top:14px">— Salam Operations Console · Agent 2 · refund desk · ${esc(biz)} · To: the approvers of the desk · Cc: ${esc((aud.team && aud.team.name) || policy.team)}${policy.cc.length ? ' and the desk copy list' : ''} · the workbook attached carries the full evidence · identities masked; the console shows them to authorised users</div>`;
  const html = notify.shell({ title: 'Request for refund approval', badge: `OPERATIONS CONSOLE · ${biz.toUpperCase()}`, pill: `${rows.length} CASES · ${money(sar)} SAR`, pillColor: sar >= 3000 || rows.length >= 10 ? '#dc2626' : '#d97706', bodyHtml: body });
  let xlsx = null; try { const X = require('./xlsx'); xlsx = X.build([{ name: 'Refund batch ' + today, rows: [['Ref', 'INC', 'Status', 'Kind', 'Amount SAR', 'Event (KSA)', 'Detected (KSA)', 'Proposed reason', 'Category', 'Verdict', 'Confidence', 'Cause', 'First action', 'Customer (masked)', 'Order / checkout', 'Payment id', 'Evidence'],
    ...rows.map(x => [x.id, x.inc || '', x.status, kindLabel(x.kind), Number(x.amount || 0), ksa(x.event_at), ksa(x.detected_at), x.reason || '', x.category || '', x.verdict || '', x.confidence == null ? '' : Math.round(x.confidence * 100) + '%', x.cause || '', x.action || '', maskMobile(x.mobile), x.order_id || '', x.payment_id || '', Object.entries(x.evidence || {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')])],
    numericCols: [0, 4], moneyCols: [4], widths: [7, 13, 10, 30, 11, 17, 17, 34, 18, 10, 10, 60, 50, 16, 38, 38, 90] }]); } catch (e) { log('batch xlsx', e.message); }
  /* a workflow mail: To = the approvers, Cc = the executing team + the desk copy list — everyone sees who is asked and who executes */
  const mailed = await notify.sendHtml(approvers.map(e => ({ email: e })), subject, html, xlsx ? [{ filename: `refund-batch_${today}.xlsx`, content: xlsx }] : [], undefined, { cc });
  const ids = rows.map(x => Number(x.id));
  const b = (await C().query(`INSERT INTO refund_batches (created_by, period_from, period_to, cases, sar, candidate_ids, approvers, cc, subject, mailed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [actor, rows[0].event_at ? ksaDate(new Date(rows[0].event_at)) : today, today, rows.length, sar, ids, approvers, cc, subject, JSON.stringify({ ...(mailed || {}), business: policy.business, excluded: { approvers: appr.excluded, cc: ccx.excluded, members: aud.excluded } })])).rows[0];
  await C().query(`UPDATE refund_candidates SET batch_id = $1, team = coalesce(team, $3) WHERE id = ANY($2::bigint[])`, [b.id, ids, policy.team || null]);
  try { const rep = (await C().query(`INSERT INTO agent_reports (kind, period_start, period_end, summary, narrative, mailed_to) VALUES ('refund-batch', now() - interval '1 day', now(), $1, $2, $3) RETURNING id`,
    [JSON.stringify({ batch: b.id, business: policy.business, cases: rows.length, sar, approvers, cc: cc.length, by_kind: rows.reduce((a, x) => { a[x.kind] = (a[x.kind] || 0) + 1; return a; }, {}) }), `Refund batch #${b.id} (${biz}): ${rows.length} case(s), ${money(sar)} SAR, sent to ${approvers.join(', ')} (cc ${cc.length}).`, mailed && mailed.sent ? approvers.length + cc.length : 0])).rows[0];
    await C().query(`UPDATE refund_batches SET report_id = $2 WHERE id = $1`, [b.id, rep.id]); } catch (_) {}
  /* the ticket: INTERNAL (P4 by default — the desk decides), owned by the executing team, chased by the ack ladder of its
   * severity, resolved by reconcile() when every case is closed. It changes nothing on the cases. */
  let alert = null;
  if (policy.open_incident) {
    try {
      const sev = policy.ticket_severity || 'P4'; const ruleKey = policy.business === 'fixed' ? 'fixed_refund_batch' : 'refund_batch';
      const msg = `Refund batch #${b.id}: ${rows.length} customer(s) owed ${money(sar)} SAR — ${Object.entries(rows.reduce((a, x) => { a[kindLabel(x.kind)] = (a[kindLabel(x.kind)] || 0) + 1; return a; }, {})).map(([k, n]) => `${k} ×${n}`).join(', ')}. Approval request mailed to ${approvers.length} approver(s) (${approvers.map(e => e.split('@')[0]).join(', ')}), cc ${cc.length}. Desk SLA: decision within ${policy.approve_within_h} h, refund posted in ${policy.gateway} within ${policy.refund_within_h} h of the approval. Approve / refund / dismiss on ${biz} › Refund exposure; the ticket resolves when every case is closed in ${policy.gateway}.`;
      alert = (await C().query(`INSERT INTO alerts (rule_key, name, severity, team, status, metric_key, operator, threshold, observed_value, sample, window_hours, dim, message, fired_at, last_seen_at, peak_value, breach_count, segment, customers, source, created_by)
          VALUES ($8,$1,$2,$3,'open','refund_exposure_open_sar','gte',0,$4,$5,24,$6,$7,now(),now(),$4,1,$9,$5,'agent','agent')
          RETURNING *`, [`Refund batch #${b.id} — ${rows.length} case(s) · ${money(sar)} SAR awaiting approval`, sev, policy.team || null, Math.round(sar), rows.length,
        JSON.stringify({ source: 'agent', batch: b.id, internal: true, desk: policy.business, approvers: approvers.length, sla: { approve_h: policy.approve_within_h, refund_h: policy.refund_within_h } }), msg, ruleKey, policy.segment])).rows[0];
      await C().query(`UPDATE refund_batches SET alert_id = $2 WHERE id = $1`, [b.id, alert.id]);
      await C().query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'agent',$2)`, [alert.id, `🤖 Refund desk opened this internal ${sev} ticket for batch #${b.id} and assigned it to ${(aud.team && aud.team.name) || policy.team || 'no team'} — ${rows.length} case(s), ${money(sar)} SAR. Approvers: ${approvers.join(', ')}. Cases: ${ids.map(i => '#' + i).join(' ')}.`]).catch(() => {});
      if (policy.chatops) { try { await require('./chatops').notifyIncident(alert, { kind: 'opened' }); } catch (e) { log('chatops', e.message); } }
    } catch (e) { log('batch incident', e.message); }
  }
  log(`batch #${b.id} (${policy.business}): ${rows.length} case(s) · ${money(sar)} SAR · To ${approvers.length} approver(s) · Cc ${cc.length} · ${mailed && mailed.sent ? 'mailed' : 'NOT mailed'}${alert ? ' · ticket #' + alert.id + ' ' + alert.severity : ''}`);
  return { batch: b, cases: rows.length, sar, sent: !!(mailed && mailed.sent), mailed, approvers, cc, alert_id: alert ? alert.id : null, severity: alert ? alert.severity : null };
}
/* withdraw a request (26 Sep 2026): batch #1 went to alpha.100's fallback audience. The open / approved cases of the batch
 * are released (they become batchable again, so the next request reaches the right approvers), the batch is marked
 * withdrawn, its ticket resolved with a comment. Cases already refunded or dismissed keep their history. */
async function withdrawBatch(id, actor, note) {
  const b = (await C().query(`SELECT * FROM refund_batches WHERE id = $1`, [Number(id)])).rows[0];
  if (!b) throw new Error('no such batch'); if (b.status !== 'open') throw new Error(`batch #${b.id} is ${b.status} — only an open request can be withdrawn`);
  const rel = await C().query(`UPDATE refund_candidates SET batch_id = NULL WHERE batch_id = $1 AND status IN ('open','approved') RETURNING id`, [b.id]);
  const why = String(note || '').trim().slice(0, 300) || 'withdrawn';
  await C().query(`UPDATE refund_batches SET status = 'withdrawn', closed_at = now(), last_progress = $2 WHERE id = $1`, [b.id, `withdrawn by ${String(actor || 'console').split('@')[0]} — ${why} · ${rel.rowCount} case(s) released for the next request`]);
  if (b.alert_id) {
    await C().query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`, [b.alert_id, `Request #${b.id} withdrawn by ${String(actor || 'console').split('@')[0]} — ${why}. ${rel.rowCount} case(s) released; they go out again with the next request, to the approvers defined on the desk.`]).catch(() => {});
    await C().query(`UPDATE alerts SET status = 'resolved', resolved_at = now(), resolve_reason = coalesce(resolve_reason, 'withdrawn'), resolved_by = coalesce(resolved_by, $2) WHERE id = $1 AND status = 'open'`, [b.alert_id, actor || 'console']).catch(() => {});
  }
  log(`batch #${b.id} withdrawn by ${actor || 'console'} — ${rel.rowCount} case(s) released${b.alert_id ? ' · ticket #' + b.alert_id + ' resolved' : ''}`);
  return { ok: true, batch: b.id, released: rel.rowCount, alert_id: b.alert_id || null };
}
async function reconcile() {
  const open = (await C().query(`SELECT * FROM refund_batches WHERE status = 'open' ORDER BY id`)).rows; let closed = 0;
  for (const b of open) {
    const s = (await C().query(`SELECT count(*) FILTER (WHERE status = 'refunded')::int refunded, count(*) FILTER (WHERE status = 'dismissed')::int dismissed, count(*) FILTER (WHERE status = 'resolved_auto')::int auto, count(*) FILTER (WHERE status IN ('open','approved'))::int pending, count(*)::int n FROM refund_candidates WHERE id = ANY($1::bigint[])`, [b.candidate_ids])).rows[0];
    const progress = `${s.refunded} refunded · ${s.dismissed} dismissed · ${s.auto} resolved by the platform · ${s.pending} pending of ${s.n}`;
    const done = s.pending === 0;
    const moved = (s.refunded + s.dismissed + s.auto) > 0;
    if ((progress !== b.last_progress && moved) || done) {
      await C().query(`UPDATE refund_batches SET refunded = $2, dismissed = $3, last_progress = $4, status = CASE WHEN $5 THEN 'closed' ELSE status END, closed_at = CASE WHEN $5 THEN now() ELSE closed_at END WHERE id = $1`, [b.id, s.refunded, s.dismissed, progress, done]);
      if (b.alert_id) {
        await C().query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'agent',$2)`, [b.alert_id, `🤖 Refund desk — batch #${b.id}: ${progress}${done ? ' — every case is closed, resolving the ticket.' : ''}`]).catch(() => {});
        if (done) { await C().query(`UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE id = $1 AND status = 'open'`, [b.alert_id]).catch(() => {}); closed++; }
      }
    }
  }
  return { open: open.length, closed };
}

/* ------------------------------------------------------------------------------------------------ the loop */
let busy = false; let lastRun = null;
/* one desk's work for a tick: review its queue, digest the new cases to its team, (assist) send its daily batch */
async function tickDesk(policy, stats, { limit, force = false } = {}) {
  const rows = (await C().query(`SELECT c.*, c.amount::float AS amount FROM refund_candidates c LEFT JOIN refund_reviews r ON r.candidate_id = c.id
      WHERE c.side = $4 AND c.status IN ('open','approved') AND (r.id IS NULL OR (r.model IS NULL AND r.deterministic = true AND coalesce(r.attempts,1) < $2 AND coalesce(r.retried_at, r.created_at) < now() - ($3||' minutes')::interval))
      ORDER BY (r.id IS NULL) DESC, c.detected_at DESC LIMIT $1`, [limit || CFG.maxPerTick, CFG.maxRetries, String(CFG.retryMin), policy.business])).rows;
  const fresh = []; let modelBudget = stats.model_down ? 0 : CFG.maxModelPerTick;
  for (const c of rows) {
    stats.checked++;
    try { const r = await reviewOne(c, policy, { allowModel: modelBudget > 0 }); if (r.model) { modelBudget--; stats.modelled++; } if (r.llmDown) { modelBudget = 0; stats.model_down = true; } stats.reviewed++; stats[r.verdict] = (stats[r.verdict] || 0) + 1; if (!c.reviewed_at) fresh.push({ c, r: r.review }); }
    catch (e) { stats.errors++; log('review failed', c.id, e.message); }
  }
  if (fresh.length && policy.notify_new) { try { const m = await notifyNew(fresh, policy); stats.notified += m && m.sent ? fresh.length : 0; if (m && !m.sent) stats.notify_note = m.reason || m.error || 'not sent'; } catch (e) { log('notify', e.message); } }
  if (policy.mode === 'assist' && !force) {
    const today = ksaDate(); const already = (await C().query(`SELECT 1 FROM refund_batches WHERE created_by = 'agent' AND coalesce(mailed->>'business', 'mobile') = $2 AND (created_at AT TIME ZONE 'Asia/Riyadh')::date = $1::date LIMIT 1`, [today, policy.business])).rowCount;
    if (!already && ksaHour() >= policy.report_hour) { try { const b = await buildBatch({ actor: 'agent', policy }); if (b.blocked) stats.batch_blocked = b.reason; else stats.batch = b.cases ? { id: b.batch && b.batch.id, business: policy.business, cases: b.cases, sar: b.sar, sent: b.sent, alert_id: b.alert_id } : null; } catch (e) { log('batch', e.message); stats.errors++; } }
  }
}
async function tick({ limit, force = false } = {}) {
  if (busy) return { skipped: true }; busy = true;
  const run = (await C().query(`INSERT INTO agent_runs (agent) VALUES ('refund') RETURNING id`)).rows[0].id;
  const stats = { checked: 0, reviewed: 0, modelled: 0, refund: 0, wait: 0, dismiss: 0, investigate: 0, notified: 0, batch: null, batches_closed: 0, errors: 0, desks: {} };
  try {
    const desks = await getDesks(); let worked = 0;
    for (const biz of BUSINESSES) {
      const policy = desks[biz];
      if (!policy.ready) { stats.desks[biz] = 'no detector yet'; continue; }
      if (!policy.enabled && !force) { stats.desks[biz] = 'disabled'; continue; }
      stats.desks[biz] = policy.mode; worked++;
      await tickDesk(policy, stats, { limit, force });
    }
    if (!worked) stats.disabled = true;
    try { const rc = await reconcile(); stats.batches_closed = rc.closed; } catch (e) { log('reconcile', e.message); }
    await C().query(`UPDATE agent_runs SET finished_at=now(), ok=true, stats=$2 WHERE id=$1`, [run, JSON.stringify(stats)]);
    if (stats.checked || stats.batch) log(`tick: ${stats.checked} candidate(s) → ${stats.reviewed} reviewed (${stats.modelled} with the model · refund ${stats.refund} · wait ${stats.wait} · dismiss ${stats.dismiss} · investigate ${stats.investigate}) · notified ${stats.notified}${stats.batch ? ` · batch #${stats.batch.id} ${stats.batch.cases} case(s)` : ''}${stats.batch_blocked ? ' · batch not sent: ' + stats.batch_blocked : ''}`);
  } catch (e) { log('tick failed:', e.message); await C().query(`UPDATE agent_runs SET finished_at=now(), ok=false, error=$2, stats=$3 WHERE id=$1`, [run, e.message, JSON.stringify(stats)]).catch(() => {}); }
  finally { busy = false; lastRun = { at: new Date().toISOString(), stats }; }
  return stats;
}
function start() {
  if (!CFG.enabled) { log('disabled (AGENT_REFUND_ENABLED=0) — idle'); return; }
  log(`armed: every ${CFG.intervalMin} min · up to ${CFG.maxPerTick} candidates per tick (${CFG.maxModelPerTick} with the model)`);
  setTimeout(() => tick().catch(e => log(e.message)), 45000); setInterval(() => tick().catch(e => log(e.message)), CFG.intervalMin * 60000);
}

/* ------------------------------------------------------------------------------------------------ the desk SLAs */
/* the two clocks of a desk, measured on its cases:
 *   approval  — request (the batch mail) → decision (decided_at; a closure by the register counts as decided)
 *   execution — approval (decided_at of an approved case) → the register shows the refund (resolved_at)
 * Waiting / overdue now, and the last 30 days' attainment. Used by the page, Settings › Teams and the two metrics. */
async function slaStatus(policy) {
  const biz = policy.business; const aH = String(policy.approve_within_h), rH = String(policy.refund_within_h);
  const [a, x] = await Promise.all([
    C().query(`WITH b AS (SELECT c.status, coalesce(c.decided_at, c.resolved_at) AS decided_at, bt.created_at AS batch_at
                            FROM refund_candidates c JOIN refund_batches bt ON bt.id = c.batch_id WHERE c.side = $1)
               SELECT count(*) FILTER (WHERE status = 'open')::int AS waiting,
                      count(*) FILTER (WHERE status = 'open' AND batch_at < now() - ($2||' hours')::interval)::int AS overdue,
                      (max(extract(epoch FROM (now() - batch_at))) FILTER (WHERE status = 'open') / 3600)::float AS oldest_h,
                      count(*) FILTER (WHERE decided_at IS NOT NULL AND decided_at >= now() - interval '30 days')::int AS done_30d,
                      count(*) FILTER (WHERE decided_at IS NOT NULL AND decided_at >= now() - interval '30 days' AND decided_at <= batch_at + ($2||' hours')::interval)::int AS in_sla_30d,
                      (percentile_cont(0.5) WITHIN GROUP (ORDER BY greatest(0, extract(epoch FROM (decided_at - batch_at)))) FILTER (WHERE decided_at IS NOT NULL AND decided_at >= now() - interval '30 days') / 3600)::float AS median_h
                 FROM b`, [biz, aH]),
    C().query(`WITH e AS (SELECT c.status, coalesce(c.decided_at, c.updated_at) AS approved_at, c.resolved_at FROM refund_candidates c WHERE c.side = $1 AND (c.status = 'approved' OR (c.status = 'refunded' AND c.decided_at IS NOT NULL AND c.decided_by IS NOT NULL)))
               SELECT count(*) FILTER (WHERE status = 'approved')::int AS waiting,
                      count(*) FILTER (WHERE status = 'approved' AND approved_at < now() - ($2||' hours')::interval)::int AS overdue,
                      (max(extract(epoch FROM (now() - approved_at))) FILTER (WHERE status = 'approved') / 3600)::float AS oldest_h,
                      count(*) FILTER (WHERE status = 'refunded' AND resolved_at >= now() - interval '30 days')::int AS done_30d,
                      count(*) FILTER (WHERE status = 'refunded' AND resolved_at >= now() - interval '30 days' AND resolved_at <= approved_at + ($2||' hours')::interval)::int AS in_sla_30d,
                      (percentile_cont(0.5) WITHIN GROUP (ORDER BY greatest(0, extract(epoch FROM (resolved_at - approved_at)))) FILTER (WHERE status = 'refunded' AND resolved_at >= now() - interval '30 days') / 3600)::float AS median_h
                 FROM e`, [biz, rH])
  ]);
  const pct = r => r.done_30d ? Math.round(100 * r.in_sla_30d / r.done_30d) : null;
  return { approval: { ...a.rows[0], within_h: policy.approve_within_h, pct_30d: pct(a.rows[0]) }, execution: { ...x.rows[0], within_h: policy.refund_within_h, pct_30d: pct(x.rows[0]) } };
}

/* ------------------------------------------------------------------------------------------------ reads + routes */
/* every desk with what Settings › Teams and the Refund desk tab show: the executing team, the effective recipients, the
 * warnings, the SLA picture, the open cases; plus the registry teams to pick from and the two SLA rules */
async function desksView() {
  await ensureSchema();
  const [desks, reg] = await Promise.all([getDesks(), teams.list({ all: true }).catch(() => [])]);
  const out = [];
  for (const biz of BUSINESSES) {
    const p = desks[biz]; const aud = await audience(p); const appr = await effectiveApprovers(p); const ccx = await effectiveCc(p, aud, appr.list);
    let sla = null, open = null;
    if (p.ready) {
      try { sla = await slaStatus(p); } catch (e) { sla = { error: e.message }; }
      try { open = (await C().query(`SELECT count(*) FILTER (WHERE status IN ('open','approved'))::int AS open, count(*) FILTER (WHERE status = 'approved')::int AS approved, coalesce(sum(amount) FILTER (WHERE status IN ('open','approved')),0)::float AS sar, count(*) FILTER (WHERE status IN ('open','approved') AND batch_id IS NOT NULL)::int AS in_batches FROM refund_candidates WHERE side = $1`, [biz])).rows[0]; } catch (_) {}
    }
    const t = aud.team;
    out.push({ ...p, team_info: t ? { key: t.key, name: t.name, business: t.business, level: t.level, vendor_id: t.vendor_id, mail_dl: t.mail_dl, members: aud.list.length - (t.mail_dl ? 1 : 0) } : null,
      approvers_effective: appr.list, cc_effective: ccx.list, excluded: { approvers: appr.excluded, cc: ccx.excluded, members: aud.excluded }, warnings: warningsFor(p, aud, appr, ccx), sla, open });
  }
  let rules = []; try { rules = (await C().query(`SELECT key, name, severity, team, enabled FROM alert_rules WHERE key IN ('refund_approval_overdue','refund_execution_overdue','refund_exposure_backlog','refund_gateway_failed') ORDER BY key`)).rows; } catch (_) {}
  return { desks: out, teams: reg.filter(t => t.active !== false).map(t => ({ key: t.key, name: t.name, business: t.business, level: t.level, domain: t.domain, members: t.members, mail_dl: t.mail_dl })), rules, guardrails: GUARDRAILS, severities: SEVERITIES, defaults: DEFAULT_POLICY };
}
async function status() {
  await ensureSchema();
  const [view, q, verdicts, batches, runs] = await Promise.all([
    desksView(),
    C().query(`SELECT count(*) FILTER (WHERE r.id IS NULL)::int to_review, count(*)::int open, count(*) FILTER (WHERE c.batch_id IS NULL AND (c.status = 'approved' OR r.verdict = 'refund'))::int batchable, coalesce(sum(c.amount) FILTER (WHERE c.batch_id IS NULL AND (c.status = 'approved' OR r.verdict = 'refund')),0)::float batchable_sar
                 FROM refund_candidates c LEFT JOIN refund_reviews r ON r.candidate_id = c.id WHERE c.side = 'mobile' AND c.status IN ('open','approved')`),
    C().query(`SELECT r.verdict, count(*)::int n, coalesce(sum(c.amount),0)::float sar, count(*) FILTER (WHERE r.model IS NOT NULL)::int modelled, count(*) FILTER (WHERE r.helpful = true)::int helpful, count(*) FILTER (WHERE r.helpful = false)::int unhelpful
                 FROM refund_reviews r JOIN refund_candidates c ON c.id = r.candidate_id WHERE r.created_at >= now() - interval '30 days' GROUP BY 1`),
    C().query(`SELECT b.*, b.sar::float AS sar, a.status AS alert_status, a.severity AS alert_severity, a.ack_by, a.ack_at FROM refund_batches b LEFT JOIN alerts a ON a.id = b.alert_id ORDER BY b.id DESC LIMIT 20`),
    C().query(`SELECT started_at, finished_at, ok, stats, error FROM agent_runs WHERE agent = 'refund' ORDER BY id DESC LIMIT 10`)
  ]);
  const mobile = view.desks.find(d => d.business === 'mobile');
  return { desks: view.desks, rules: view.rules, policy: mobile, guardrails: GUARDRAILS, cfg: { interval_min: CFG.intervalMin, max_per_tick: CFG.maxPerTick, max_model_per_tick: CFG.maxModelPerTick, enabled: CFG.enabled },
    queue: q.rows[0], verdicts: verdicts.rows, batches: batches.rows, runs: runs.rows, last_run: runs.rows[0] || lastRun,
    team: mobile.team_info || { key: mobile.team, name: mobile.team, missing: true }, teams: view.teams, approvers_effective: mobile.approvers_effective, warnings: mobile.warnings, sla: mobile.sla, reasons: await knownReasons() };
}
function mount(app, { requireView, requireCap, audit }) {
  const gate = requireView('errors');
  app.get('/api/refunds/desk', gate, async (req, res) => { try { res.json(await status()); } catch (e) { res.status(500).json({ error: e.message }); } });
  /* the desk definition is edited in Settings › Teams › Refund desks (teamsApi.js, super admin); this route stays for the
   * operational knobs of the Mobile desk (alpha.100/101 callers) and writes the same record */
  app.put('/api/refunds/desk/policy', requireCap('manageSync'), async (req, res) => { try {
      const p = await setPolicy('mobile', req.body || {}, req.actor); if (audit) audit(req, 'refund.desk', 'mobile', { team: p.team, approvers: p.approvers, mode: p.mode, ticket_severity: p.ticket_severity }).catch?.(() => {}); res.json({ ok: true, policy: p });
    } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/refunds/desk/run', requireCap('ackErrors'), async (req, res) => { try { await ensureSchema(); const out = await tick({ limit: Math.min(40, Number((req.body || {}).limit) || 20), force: true }); if (audit) audit(req, 'agent.run', 'refund', out).catch?.(() => {}); res.json(out); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/refunds/desk/batch', requireCap('ackErrors'), async (req, res) => { try { await ensureSchema(); const out = await buildBatch({ actor: req.actor || 'console', business: (req.body || {}).business || 'mobile' }); if (audit) audit(req, 'refund.batch', out.batch ? String(out.batch.id) : null, { cases: out.cases, sar: out.sar, sent: out.sent, blocked: out.blocked || null, approvers: out.approvers || [] }).catch?.(() => {}); res.json(out); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/refunds/desk/batch/:id/withdraw', requireCap('ackErrors'), async (req, res) => { try {
      const out = await withdrawBatch(req.params.id, req.actor || 'console', (req.body || {}).note); if (audit) audit(req, 'refund.batch.withdraw', String(out.batch), out).catch?.(() => {}); res.json(out);
    } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/refunds/desk/review/:id', requireCap('ackErrors'), async (req, res) => { try {
      await ensureSchema(); const c = (await C().query(`SELECT *, amount::float AS amount FROM refund_candidates WHERE id = $1`, [Number(req.params.id)])).rows[0]; if (!c) return res.status(404).json({ error: 'not found' });
      const out = await reviewOne(c, await getPolicy(c.side || 'mobile'), { allowModel: true, force: true }); if (audit) audit(req, 'agent.refund.review', String(c.id), { verdict: out.verdict, model: out.model }).catch?.(() => {}); res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/refunds/desk/review/:id/feedback', gate, async (req, res) => { try {
      const helpful = !!(req.body || {}).helpful; const r = await C().query(`UPDATE refund_reviews SET helpful = $2, feedback_by = $3, feedback_at = now() WHERE candidate_id = $1 RETURNING candidate_id, helpful`, [Number(req.params.id), helpful, req.actor || null]);
      if (!r.rowCount) return res.status(404).json({ error: 'no review for this candidate' }); res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { CFG, BUSINESSES, DEFAULT_POLICY, DESK_SEED, GUARDRAILS, ensureSchema, ensureDeskSchema, getDesks, getPolicy, setPolicy, desksView, slaStatus, effectiveApprovers, audience, preClassify, reviewOne, buildBatch, withdrawBatch, reconcile, tick, start, status, mount, knownReasons };
