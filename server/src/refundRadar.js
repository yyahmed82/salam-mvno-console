/* refundRadar.js — REFUND EXPOSURE (25 Sep 2026 · rebuilt 26 Sep 2026). Born from the review of 2,338 refund mails:
 * every refund the L2 team asks for approval is a situation the platform ALREADY knew about hours or days earlier — a
 * successful payment whose order never activated (Semati 727/738, blocked person), the same number ported in twice, a
 * change-plan charged then failed on "IAM TOKEN IS NOT AVAILABLE", a SIM / eSIM replacement paid and never done (Semati
 * 731/738 on /semati/new-sim, physical SIM never picked up), a paid order whose delivery failed, a card captured twice.
 * Today these reach us as INC tickets from the call centre; here they are DETECTED on the replica every 15 minutes,
 * logged in `refund_candidates` (console DB), shown on Mobile › Refund exposure, pinned to the customer on Subscriber
 * 360 / Yusr, and fed to the alert rules (refund_exposure_* metrics).
 *
 * 26 Sep 2026 — WHAT CHANGED AND WHY
 *  1. The six detectors never ran in production: every one was bound with the same two parameters whether its SQL used
 *     them or not ("bind message supplies 2 parameters, but prepared statement requires 0" ×5, "could not determine data
 *     type of parameter $1" ×1). Each detector now declares its own parameters.
 *  2. SIM / eSIM replacement is detected where the app records it: a `checkouts` row of type 3 (REPLACEMENT_TYPE) that is
 *     `paid` and not `completed` (SimReplacementManager#proceed sets completed only after Semati new-sim + card package
 *     update succeed). Evidence: the last /semati/new-sim answer (activation_logs.status_code 731/738 …), sim type
 *     (extra.sim_type 1 = eSIM), delivery type (pickup) and the courier state for a physical SIM.
 *  3. The proxycms LEDGER is the truth for what was refunded: `refunds` (admin_user_id → admin_users.email, or
 *     "Auto generated"; refund_reason_id → refund_reasons.reason, else "Failed Change Plan" / "Failed <type>" exactly as
 *     Refund#handle_text_reason; status pending/success/fail; refund_type 0 reverse / 1 refund; notes carry the INC).
 *     prodSync now copies refunds / refund_reasons / admin_users (credentials skipped); every tick correlates the open
 *     candidates with the ledger — a refund posted in proxycms closes the candidate as `refunded` by `proxycms` with
 *     the reason, the admin and the INC, and the page shows, per period, what was refunded, by whom, for which reason,
 *     and whether the console had flagged it BEFORE the refund was created (the impact figure).
 *  4. Period filters (from/to, KSA days; day/week/month buckets), reason categories for RCA, XLSX + PDF exports.
 *
 * Every detector is bounded (last LOOKBACK_DAYS, one statement each, 45 s cap) and guarded: a failing detector reports
 * its error on the page instead of breaking the tick. Column facts (selfcare db/schema.rb, read 26 Sep): payments
 * (id uuid, status, amount, payment_on_type 'OnboardingOrder'|'Checkout'|'recharge'|'bill'|…, payment_on_id text,
 * customer_mobile_number, target_mobile_number, payment_reference_id, vendor, platform, payment_method), checkouts
 * (id uuid, checkout_id = code, checkout_type, checkout_for_type, paid, completed, mobile_number, delivery_type,
 * extra jsonb), onboarding_orders (id uuid, checkout_id = code, activated, number_order_type 1 = MNP, mnp_number,
 * customer_name, nationality_id_number), activation_logs (api, msisdn, state, status_code, response, onboarding_order_id),
 * change_plan_logs (status 0 pending / 1 success / 2 failed, payment_id, mobile_number, final_step_message),
 * delivery_requests (delivery_on_type, delivery_on_id, delivery_state), numbers (identifier, onboarding_order_id),
 * refunds (payment_id text, admin_user_id, refund_reason_id, status, refund_type, notes, fail_reason, created_at). */
'use strict';
const db = require('./db');

const LOOKBACK_DAYS = Number(process.env.REFUND_RADAR_LOOKBACK_DAYS || 30);
const TICK_MS = Number(process.env.REFUND_RADAR_TICK_MS || 15 * 60e3);
const DELIVERY_FAILED = ['cancelled','canceled','deleted','RTO','CANCELLED','PUX43','returned','reverseReturned','shipmentCanceled','reverseShipmentCanceled','REFUSED','onhold','pickup_failed','DEX93','RD','DEX07-3','DEX07-4','DEX07-5','DEX07-6','DEX07-7','DEX07-8','DEX93-1','DEX93-2','DEX93-3','DEX93-4','DEX07'];
/* checkouts.checkout_type of a SIM / eSIM replacement — Checkout::REPLACEMENT_TYPE = 3 in the selfcare app */
const SIM_CHECKOUT_TYPES = String(process.env.REFUND_RADAR_SIM_CHECKOUT_TYPES || '3').split(',').map(s => Number(s.trim())).filter(n => n > 0);
const KSA_TZ = 'Asia/Riyadh';

const KINDS = {
  paid_not_activated:     { label: 'Paid, never activated',                why: 'payment success · order not activated after 6 h (7 d for port-in) · no successful activation log', team: 'Digital Ops', mail_reason: 'Activation issue / Semati', reasons: ['Semati Issue', 'Activation Technical issue (Already exist)', 'MSISDN Reservation Expired', 'Activated though DMS / has another order', 'Rejected MNP', 'Portin Semati issue MSISDN doesn\'t exist'] },
  portin_twice:           { label: 'Same number ported in twice',          why: 'two paid MNP orders for the same ported number within the window', team: 'Digital Ops', mail_reason: 'Already active, portin-twice case', reasons: ['Activated though DMS / has another order', 'Ordered by Mistake'] },
  change_plan_paid_failed:{ label: 'Change plan charged, failed',          why: 'change_plan_logs status failed on a successful payment, no later success for the line', team: 'Digital Ops', mail_reason: 'Refund-Change Plan Failed (IAM TOKEN …)', reasons: ['Failed Change Plan', 'Failed change plan from BSS', 'Change Plan type'] },
  sim_replacement_paid:   { label: 'SIM / eSIM replacement paid, not done', why: 'replacement checkout paid, not completed (48 h eSIM · 5 d physical) · last Semati new-sim answer and courier state kept as evidence', team: 'Digital Ops', mail_reason: 'Esim / sim replacement not completed', reasons: ['ICCID issue', 'Semati Issue', 'SIM not Delivered (changed his mind)', 'Device not compatible with eSIM'] },
  delivery_failed_paid:   { label: 'Paid, delivery failed',                 why: 'courier state failed / cancelled on a paid, not activated order, no later delivery', team: 'Digital Ops', mail_reason: 'Delivery issue', reasons: ['SIM not Delivered (changed his mind)', 'IPhone Device refund (Delay in delivery)', 'IPhone Device refund (Returned)'] },
  duplicate_charge:       { label: 'Charged twice',                         why: 'two success payments · same customer, amount, target · within 30 min', team: 'Digital Ops', mail_reason: 'Duplicate payment', reasons: ['Ordered by Mistake', 'POSA by Mistake'] }
};

/* ---------------------------------------------------------------------------------------------- reason categories (RCA)
 * The proxycms reason list is free text chosen by the admin. For the RCA view each reason is classified into a
 * root-cause CATEGORY with an owner; `platform: true` marks the categories where the platform failed after the
 * customer paid — the ones the detectors are expected to catch first. This is a console classification of the reason
 * names, not a field of proxycms. Order matters: the first matching rule wins. */
const REASON_RULES = [
  { cat: 'test',        rx: /\buat\b|\btest/i },
  { cat: 'delivery',    rx: /not delivered|delay in delivery|returned|out of stock|delivery/i },
  { cat: 'customer',    rx: /changed his mind|wants a better|by mistake|change plan type|not compatible|wrong details|exceeded the limit|forgot password/i },
  { cat: 'change_plan', rx: /change plan/i },
  { cat: 'activation',  rx: /semati|activation|iccid|msisdn|reservation expired|already exist|another order|activated though|mnp|port-?in/i },
  { cat: 'network',     rx: /coverage/i },
  { cat: 'platform',    rx: /cms issue|technical|saleor|failed /i }
];
const CATEGORIES = {
  activation:  { label: 'Activation / Semati',   owner: 'Digital Ops · Semati / BSS', platform: true,  color: '#dc2626', fix: 'the order or replacement was paid and the activation answer was an error — the detectors paid_not_activated and sim_replacement_paid see these within the hour; the fix is the activation flow or the partner (Semati codes 727/731/738), the refund is the symptom' },
  change_plan: { label: 'Change plan (BSS)',      owner: 'Digital Ops · BSS',          platform: true,  color: '#ea580c', fix: 'the plan change was charged and the BSS step failed (IAM token, price plan) — change_plan_paid_failed flags it; most are auto-refunded by the app ("Failed Change Plan"), the recurrence is the defect to close' },
  platform:    { label: 'Platform / CMS',         owner: 'Digital Ops',                platform: true,  color: '#7c3aed', fix: 'a technical failure of the app, the CMS or the store flow after payment — check the error signatures of the same hour on Troubleshoot; every one is a product ticket' },
  delivery:    { label: 'Delivery / stock',       owner: 'Delivery partner · Store',   platform: false, color: '#d97706', fix: 'the SIM or device never reached the customer (courier state, pickup not collected, stock) — delivery_failed_paid flags the paid orders; escalate to the courier with the reference and the delivery SLA' },
  customer:    { label: 'Customer decision',      owner: 'Sales · CX',                 platform: false, color: '#2563eb', fix: 'changed his mind, wrong details, ordered by mistake — not a platform failure; the lever is the journey (clear plan choice, eSIM compatibility check before payment, order review step)' },
  network:     { label: 'Coverage',               owner: 'Network',                    platform: false, color: '#0d9488', fix: 'no coverage at the customer address — show the coverage check before the payment step' },
  test:        { label: 'Test (UAT)',             owner: '—',                          platform: false, color: '#64748b', fix: 'test transactions refunded after UAT — exclude from the business figures' },
  other:       { label: 'Other',                  owner: '—',                          platform: false, color: '#94a3b8', fix: 'reason text the classifier does not know — add it to REASON_RULES once it is understood' }
};
function categorize(reason) {
  const s = String(reason || '');
  for (const r of REASON_RULES) if (r.rx.test(s)) return r.cat;
  return 'other';
}
const INC_RX = /\bINC\d{5,}\b/i;
const incOf = s => { const m = INC_RX.exec(String(s || '')); return m ? m[0].toUpperCase() : null; };
/* admin notes are free text and sometimes carry a mobile or an id: long digit runs are starred (last 3 kept) before
 * a note is stored in the console DB, and on every read that is not the audited unmask */
const maskDigits = s => s == null ? s : String(s).replace(/\d{9,}/g, m => '*'.repeat(m.length - 3) + m.slice(-3));

/* ---------------------------------------------------------------------------------------------- storage */
async function ensure() {
  if (!db.console) return;
  await db.console.query(`CREATE TABLE IF NOT EXISTS refund_candidates (
    id bigserial PRIMARY KEY, kind text NOT NULL, side text NOT NULL DEFAULT 'mobile', ukey text NOT NULL,
    mobile text, order_id text, payment_id text, amount numeric, customer_name text, identifier text,
    event_at timestamptz, detected_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'open',
    inc text, note text, updated_by text, updated_at timestamptz, resolved_at timestamptz,
    UNIQUE (kind, ukey))`);
  /* 26 Sep: the proxycms ledger match (refund id, status, reason, admin, created_at, INC) and when it was checked */
  await db.console.query(`ALTER TABLE refund_candidates ADD COLUMN IF NOT EXISTS ledger jsonb`);
  await db.console.query(`ALTER TABLE refund_candidates ADD COLUMN IF NOT EXISTS ledger_at timestamptz`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_refund_cand_status ON refund_candidates (status, detected_at DESC)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_refund_cand_mobile ON refund_candidates (mobile)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_refund_cand_payment ON refund_candidates (payment_id)`);
  await db.console.query(`CREATE TABLE IF NOT EXISTS refund_radar_runs (id bigserial PRIMARY KEY, at timestamptz DEFAULT now(), ms int, found int, new_rows int, auto_resolved int, errors jsonb)`);
  await db.console.query(`ALTER TABLE refund_radar_runs ADD COLUMN IF NOT EXISTS ledger_refunded int`);
  await db.console.query(`ALTER TABLE refund_radar_runs ADD COLUMN IF NOT EXISTS timing jsonb`);
}

/* ---------------------------------------------------------------------------------------------- detectors */
/* payment → order: OnboardingOrder payments carry the order id; Checkout payments go through checkouts.checkout_id (code) */
/* uuid columns are compared as uuid (index lookups); a non-uuid payment_on_id (recharge, bill …) yields NULL, never an error */
const SAFE_UUID = (col) => `CASE WHEN ${col} ~ '^[0-9a-fA-F-]{36}$' THEN ${col}::uuid END`;
const PAY_ORDER = `LEFT JOIN checkouts c ON p.payment_on_type = 'Checkout' AND c.id = ${SAFE_UUID('p.payment_on_id')}
   JOIN onboarding_orders o ON (p.payment_on_type = 'OnboardingOrder' AND o.id = ${SAFE_UUID('p.payment_on_id')}) OR (c.id IS NOT NULL AND o.checkout_id::text = c.checkout_id::text)`;
const D = (n) => `now() - interval '${Number(n)} days'`;
/* the same line written four ways in the app (966…, 0…, 9 digits, +966…) */
const MSISDN_FORMS = (col) => `(${col}, right(regexp_replace(coalesce(${col},''), '\\D', '', 'g'), 9), '966' || right(regexp_replace(coalesce(${col},''), '\\D', '', 'g'), 9), '0' || right(regexp_replace(coalesce(${col},''), '\\D', '', 'g'), 9))`;

/* Every detector: { sql, params() } — the bind list is EXACTLY what its SQL references (the 25 Sep version bound two
 * parameters to all six statements, which Postgres rejects at prepare time; no detector ever ran in production). */
const DETECTORS = {
  paid_not_activated: { params: () => [], sql: `
    SELECT 'paid_not_activated' AS kind, p.id::text AS ukey, p.customer_mobile_number AS mobile, o.id::text AS order_id, p.id::text AS payment_id, p.amount,
           o.customer_name, o.nationality_id_number AS identifier, p.created_at AS event_at,
           jsonb_build_object('gateway', p.vendor, 'ref', p.payment_reference_id, 'platform', p.platform, 'order_state', o.aasm_state, 'order_status', o.status,
             'port_in', o.number_order_type = 1, 'selected_number', (SELECT identifier FROM numbers n WHERE n.onboarding_order_id = o.id ORDER BY n.created_at DESC LIMIT 1),
             'last_activation', (SELECT coalesce(a.status_code,'') || ' ' || left(coalesce(a.response::text, ''), 200) FROM activation_logs a WHERE a.onboarding_order_id = o.id ORDER BY a.created_at DESC LIMIT 1)) AS evidence
      FROM payments p ${PAY_ORDER}
     WHERE p.status = 'success' AND p.created_at >= ${D(LOOKBACK_DAYS)}
       AND p.created_at < CASE WHEN o.number_order_type = 1 THEN now() - interval '7 days' ELSE now() - interval '6 hours' END
       AND coalesce(o.activated, false) = false AND coalesce(c.checkout_type, 0) <> 5
       AND NOT EXISTS (SELECT 1 FROM activation_logs a WHERE a.onboarding_order_id = o.id AND a.state = true)` },
  portin_twice: { params: () => [], sql: `
    SELECT 'portin_twice' AS kind, o2.id::text AS ukey, o2.mobile_number AS mobile, o2.id::text AS order_id, p.id::text AS payment_id, p.amount,
           o2.customer_name, o2.nationality_id_number AS identifier, p.created_at AS event_at,
           jsonb_build_object('ported_number', o2.mnp_number, 'first_order', o1.id::text, 'first_order_at', o1.created_at, 'first_activated', o1.activated, 'gateway', p.vendor, 'ref', p.payment_reference_id) AS evidence
      FROM onboarding_orders o1
      JOIN onboarding_orders o2 ON o2.mnp_number = o1.mnp_number AND o2.id <> o1.id AND o2.created_at > o1.created_at
      JOIN payments p ON p.status = 'success' AND ((p.payment_on_type = 'OnboardingOrder' AND p.payment_on_id = o2.id::text) OR (p.payment_on_type = 'Checkout' AND p.payment_on_id IN (SELECT c.id::text FROM checkouts c WHERE c.checkout_id::text = o2.checkout_id::text)))
     WHERE o2.created_at >= ${D(LOOKBACK_DAYS)} AND o1.created_at >= ${D(LOOKBACK_DAYS * 3)}
       AND o1.number_order_type = 1 AND o2.number_order_type = 1 AND coalesce(o1.mnp_number,'') <> ''
       AND EXISTS (SELECT 1 FROM payments p1 WHERE p1.status IN ('success','refunded') AND ((p1.payment_on_type = 'OnboardingOrder' AND p1.payment_on_id = o1.id::text) OR (p1.payment_on_type = 'Checkout' AND p1.payment_on_id IN (SELECT c.id::text FROM checkouts c WHERE c.checkout_id::text = o1.checkout_id::text))))` },
  change_plan_paid_failed: { params: () => [], sql: `
    SELECT 'change_plan_paid_failed' AS kind, l.id::text AS ukey, l.mobile_number AS mobile, NULL::text AS order_id, p.id::text AS payment_id, p.amount,
           NULL::text AS customer_name, NULL::text AS identifier, l.created_at AS event_at,
           jsonb_build_object('from_plan', l.from_plan, 'to_plan', l.to_plan, 'message', left(coalesce(l.final_step_message,''), 200), 'gateway', p.vendor, 'ref', p.payment_reference_id) AS evidence
      FROM change_plan_logs l JOIN payments p ON p.id = ${SAFE_UUID('l.payment_id')} AND p.status = 'success'
     WHERE l.status = 2 AND l.created_at >= ${D(LOOKBACK_DAYS)} AND l.created_at < now() - interval '2 hours'
       AND NOT EXISTS (SELECT 1 FROM change_plan_logs l2 WHERE l2.mobile_number = l.mobile_number AND l2.status = 1 AND l2.created_at > l.created_at AND l2.created_at < l.created_at + interval '3 days')` },
  /* the replacement checkout is the record: paid by the customer, `completed` only when SimReplacementManager succeeded */
  sim_replacement_paid: { params: () => [SIM_CHECKOUT_TYPES], sql: `
    SELECT 'sim_replacement_paid' AS kind, c.id::text AS ukey, coalesce(nullif(c.mobile_number,''), p.customer_mobile_number, p.target_mobile_number) AS mobile,
           c.checkout_id::text AS order_id, p.id::text AS payment_id, p.amount, c.contact_name AS customer_name, c.nationality_id_number AS identifier, p.created_at AS event_at,
           jsonb_build_object('sim', CASE WHEN c.extra->>'sim_type' = '1' THEN 'eSIM' ELSE 'physical SIM' END, 'delivery', c.delivery_type, 'checkout', c.checkout_id, 'checkout_state', c.aasm_state,
             'gateway', p.vendor, 'ref', p.payment_reference_id, 'platform', p.platform,
             'last_semati', (SELECT coalesce(a.status_code,'') || ' ' || left(coalesce(a.response::text, ''), 200) FROM activation_logs a
                               WHERE a.api = '/semati/new-sim' AND a.msisdn IN ${MSISDN_FORMS('c.mobile_number')} AND a.created_at > p.created_at ORDER BY a.created_at DESC LIMIT 1),
             'courier_state', (SELECT d.delivery_state FROM delivery_requests d WHERE d.delivery_on_type = 'Checkout' AND d.delivery_on_id = c.id::text ORDER BY d.created_at DESC LIMIT 1)) AS evidence
      FROM checkouts c JOIN payments p ON p.payment_on_type = 'Checkout' AND p.payment_on_id = c.id::text AND p.status = 'success'
     WHERE c.checkout_type = ANY($1::int[]) AND c.paid = true AND coalesce(c.completed, false) = false
       AND p.created_at >= ${D(LOOKBACK_DAYS)}
       AND p.created_at < CASE WHEN c.extra->>'sim_type' = '1' THEN now() - interval '48 hours' ELSE now() - interval '5 days' END` },
  delivery_failed_paid: { params: () => [DELIVERY_FAILED], sql: `
    SELECT 'delivery_failed_paid' AS kind, d.id::text AS ukey, coalesce(d.receiver_mobile, p.customer_mobile_number) AS mobile, o.id::text AS order_id, p.id::text AS payment_id, p.amount,
           o.customer_name, o.nationality_id_number AS identifier, d.created_at AS event_at,
           jsonb_build_object('courier', d.vendor, 'state', d.delivery_state, 'reference', d.external_reference_id, 'gateway', p.vendor, 'ref', p.payment_reference_id) AS evidence
      FROM delivery_requests d JOIN onboarding_orders o ON o.id = ${SAFE_UUID('d.delivery_on_id')} AND coalesce(d.delivery_on_type, 'OnboardingOrder') = 'OnboardingOrder'
      JOIN payments p ON p.status = 'success' AND ((p.payment_on_type = 'OnboardingOrder' AND p.payment_on_id = o.id::text) OR (p.payment_on_type = 'Checkout' AND p.payment_on_id IN (SELECT c.id::text FROM checkouts c WHERE c.checkout_id::text = o.checkout_id::text)))
     WHERE d.created_at >= ${D(LOOKBACK_DAYS)} AND d.delivery_state = ANY($1::text[]) AND coalesce(o.activated, false) = false
       AND NOT EXISTS (SELECT 1 FROM delivery_requests d2 WHERE d2.delivery_on_id = d.delivery_on_id AND d2.created_at > d.created_at AND NOT (d2.delivery_state = ANY($1::text[])))` },
  duplicate_charge: { params: () => [], sql: `
    SELECT 'duplicate_charge' AS kind, g.second_id AS ukey, g.customer_mobile_number AS mobile, CASE WHEN g.payment_on_type = 'OnboardingOrder' THEN g.payment_on_id END AS order_id, g.second_id AS payment_id, g.amount,
           NULL::text AS customer_name, NULL::text AS identifier, g.second_at AS event_at,
           jsonb_build_object('paid_for', g.payment_on_type, 'target', g.payment_on_id, 'charges', g.n, 'first_payment', g.first_id, 'first_at', g.first_at, 'seconds_apart', extract(epoch FROM g.second_at - g.first_at)::int, 'gateway', g.vendor) AS evidence
      FROM (SELECT customer_mobile_number, amount, payment_on_type, payment_on_id, count(*) AS n, min(created_at) AS first_at, max(created_at) AS second_at,
                   (array_agg(id::text ORDER BY created_at))[1] AS first_id, (array_agg(id::text ORDER BY created_at DESC))[1] AS second_id, max(vendor) AS vendor
              FROM payments WHERE status = 'success' AND created_at >= ${D(LOOKBACK_DAYS)}
             GROUP BY 1,2,3,4 HAVING count(*) > 1 AND max(created_at) - min(created_at) < interval '30 minutes') g` }
};

const lastTiming = {};
let lastRun = null; let running = false;

async function detect() {
  const found = []; const errors = {};
  let client; try { client = await db.source.connect(); } catch (e) { return { found, errors: { connect: e.message } }; }
  try {
    await client.query('SET statement_timeout = 45000').catch(() => {});
    for (const [kind, det] of Object.entries(DETECTORS)) {
      const t0 = Date.now();
      try { const r = await client.query(det.sql, det.params()); for (const row of r.rows) found.push(row); errors[kind] = null; lastTiming[kind] = Date.now() - t0; }
      catch (e) { errors[kind] = e.message.slice(0, 160); lastTiming[kind] = Date.now() - t0; }
    }
  } finally { try { client.release(); } catch (_) {} }
  return { found, errors };
}

/* ---------------------------------------------------------------------------------------------- the proxycms ledger */
let _ledgerAvail = { at: 0, ok: false, tables: {} };
async function ledgerAvailable() {
  if (Date.now() - _ledgerAvail.at < 60e3) return _ledgerAvail.ok;
  try {
    const r = await db.source.query(`SELECT to_regclass('public.refunds')::text r, to_regclass('public.refund_reasons')::text rr, to_regclass('public.admin_users')::text au`);
    const t = r.rows[0] || {};
    _ledgerAvail = { at: Date.now(), ok: !!t.r, tables: { refunds: !!t.r, refund_reasons: !!t.rr, admin_users: !!t.au } };
  } catch (_) { _ledgerAvail = { at: Date.now(), ok: false, tables: {} }; }
  return _ledgerAvail.ok;
}
const UUID_RX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/* the reason exactly as proxycms prints it (Refund#handle_text_reason) */
const REASON_SQL = `coalesce(rr.reason, CASE WHEN p.payment_on_type = 'Checkout' AND c.checkout_for_type = 'Plan' THEN 'Failed Change Plan' ELSE 'Failed ' || coalesce(p.payment_on_type, 'payment') END)`;
const LEDGER_JOINS = (t) => `
  LEFT JOIN payments p ON p.id = ${SAFE_UUID('r.payment_id')}
  ${t.refund_reasons ? 'LEFT JOIN refund_reasons rr ON rr.id = r.refund_reason_id' : 'LEFT JOIN (SELECT NULL::int id, NULL::text reason) rr ON false'}
  ${t.admin_users ? 'LEFT JOIN admin_users au ON au.id = r.admin_user_id' : 'LEFT JOIN (SELECT NULL::int id, NULL::text email) au ON false'}
  LEFT JOIN checkouts c ON p.payment_on_type = 'Checkout' AND c.id = ${SAFE_UUID('p.payment_on_id')}
  LEFT JOIN onboarding_orders o ON p.payment_on_type = 'OnboardingOrder' AND o.id = ${SAFE_UUID('p.payment_on_id')}`;

/* ledger state of a set of payments (uuids) → map payment_id → { pay_status, refund:{…}|null } */
async function ledgerFor(paymentIds) {
  const ids = [...new Set(paymentIds.filter(x => UUID_RX.test(String(x || ''))))];
  const out = {}; if (!ids.length) return out;
  const avail = await ledgerAvailable(); const t = _ledgerAvail.tables;
  const r = avail
    ? await db.source.query(`SELECT DISTINCT ON (p.id) p.id::text AS payment_id, p.status AS pay_status, r.id AS refund_id, r.status AS refund_status, r.refund_type, r.created_at AS refund_at,
             r.notes, r.fail_reason, r.admin_user_id, ${t.refund_reasons ? 'rr.reason' : 'NULL::text AS reason'}, ${t.admin_users ? 'au.email AS refunded_by' : 'NULL::text AS refunded_by'},
             CASE WHEN p.payment_on_type = 'Checkout' THEN (SELECT c.checkout_for_type FROM checkouts c WHERE c.id = ${SAFE_UUID('p.payment_on_id')}) END AS checkout_for_type, p.payment_on_type
        FROM payments p LEFT JOIN refunds r ON r.payment_id = p.id::text
        ${t.refund_reasons ? 'LEFT JOIN refund_reasons rr ON rr.id = r.refund_reason_id' : ''} ${t.admin_users ? 'LEFT JOIN admin_users au ON au.id = r.admin_user_id' : ''}
       WHERE p.id = ANY($1::uuid[]) ORDER BY p.id, r.created_at DESC NULLS LAST`, [ids])
    : await db.source.query(`SELECT p.id::text AS payment_id, p.status AS pay_status FROM payments p WHERE p.id = ANY($1::uuid[])`, [ids]);
  for (const x of r.rows) {
    const reason = x.refund_id ? (x.reason || (x.payment_on_type === 'Checkout' && x.checkout_for_type === 'Plan' ? 'Failed Change Plan' : 'Failed ' + (x.payment_on_type || 'payment'))) : null;
    out[x.payment_id] = { pay_status: x.pay_status, refund: x.refund_id ? { id: x.refund_id, status: x.refund_status, type: x.refund_type === 0 ? 'reverse' : 'refund', at: x.refund_at, reason, category: categorize(reason),
      by: x.refunded_by ? String(x.refunded_by).split('@')[0] : (x.admin_user_id ? 'admin #' + x.admin_user_id : 'Auto generated'), auto: !x.admin_user_id, notes: x.notes ? maskDigits(String(x.notes).slice(0, 300)) : null, inc: incOf(x.notes), fail_reason: x.fail_reason || null } : null };
  }
  return out;
}
/* correlate candidates with the ledger: a refund posted in proxycms (refund success, or the payment now 'refunded')
 * closes the candidate as `refunded` by proxycms — the register is then the same on both sides. */
async function correlate() {
  const r = await db.console.query(`SELECT id, payment_id, status, inc FROM refund_candidates WHERE payment_id IS NOT NULL AND detected_at >= ${D(LOOKBACK_DAYS + 5)}
      AND (status IN ('open','approved') OR ledger IS NULL OR ledger_at < now() - interval '6 hours') ORDER BY detected_at DESC LIMIT 2000`);
  if (!r.rows.length) return { checked: 0, refunded: 0 };
  let led; try { led = await ledgerFor(r.rows.map(x => x.payment_id)); } catch (e) { console.error('[refund-radar] ledger:', e.message); return { checked: 0, refunded: 0, error: e.message }; }
  let refunded = 0;
  for (const c of r.rows) {
    const L = led[c.payment_id]; if (!L) continue;
    const done = L.pay_status === 'refunded' || (L.refund && L.refund.status === 'success');
    const ledger = { pay_status: L.pay_status, ...(L.refund || {}), checked_at: new Date().toISOString() };
    const u = await db.console.query(`UPDATE refund_candidates SET ledger = $2::jsonb, ledger_at = now(),
        inc = coalesce(inc, $4),
        status = CASE WHEN $3::boolean AND status IN ('open','approved') THEN 'refunded' ELSE status END,
        updated_by = CASE WHEN $3::boolean AND status IN ('open','approved') THEN 'proxycms' ELSE updated_by END,
        updated_at = CASE WHEN $3::boolean AND status IN ('open','approved') THEN now() ELSE updated_at END,
        resolved_at = CASE WHEN $3::boolean AND status IN ('open','approved') THEN coalesce($5::timestamptz, now()) ELSE resolved_at END
      WHERE id = $1 RETURNING (status = 'refunded' AND updated_by = 'proxycms' AND updated_at >= now() - interval '5 seconds') AS just_refunded`,
      [c.id, JSON.stringify(ledger), done, (L.refund && L.refund.inc) || null, L.refund && L.refund.at ? new Date(L.refund.at).toISOString() : null]);
    if (u.rows[0] && u.rows[0].just_refunded) refunded++;
  }
  return { checked: r.rows.length, refunded };
}

async function tick() {
  if (running || !db.console || !db.source) return; running = true; const t0 = Date.now();
  try {
    await ensure();
    const { found, errors } = await detect();
    let newRows = 0;
    for (const f of found) {
      const r = await db.console.query(`INSERT INTO refund_candidates (kind, side, ukey, mobile, order_id, payment_id, amount, customer_name, identifier, event_at, evidence)
          VALUES ($1,'mobile',$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (kind, ukey) DO UPDATE SET last_seen_at = now(), evidence = EXCLUDED.evidence, amount = coalesce(EXCLUDED.amount, refund_candidates.amount),
            customer_name = coalesce(EXCLUDED.customer_name, refund_candidates.customer_name),
            status = CASE WHEN refund_candidates.status = 'resolved_auto' THEN 'open' ELSE refund_candidates.status END
          RETURNING (xmax = 0) AS inserted`, [f.kind, f.ukey, f.mobile, f.order_id, f.payment_id, f.amount, f.customer_name, f.identifier, f.event_at, f.evidence || {}]);
      if (r.rows[0] && r.rows[0].inserted) newRows++;
    }
    /* the ledger first: a refund posted in proxycms is the real closure, not "resolved by the platform" */
    let led = { checked: 0, refunded: 0 }; try { led = await correlate(); } catch (e) { led.error = e.message; }
    /* auto-resolution: an OPEN candidate its detector no longer returns (activation succeeded, later delivery …) — only
     * for detectors that ran without error this tick */
    const okKinds = Object.keys(DETECTORS).filter(k => !errors[k]);
    let auto = 0;
    if (okKinds.length) {
      const keys = found.map(f => f.kind + '|' + f.ukey);
      const r = await db.console.query(`UPDATE refund_candidates SET status = 'resolved_auto', resolved_at = now(), updated_at = now(), updated_by = 'platform'
          WHERE status = 'open' AND kind = ANY($1::text[]) AND NOT (kind || '|' || ukey = ANY($2::text[])) AND detected_at >= ${D(LOOKBACK_DAYS + 2)}`, [okKinds, keys]);
      auto = r.rowCount;
    }
    lastRun = { at: new Date().toISOString(), ms: Date.now() - t0, found: found.length, new_rows: newRows, auto_resolved: auto, ledger_refunded: led.refunded, ledger_checked: led.checked, ledger_error: led.error || null, errors, timing: { ...lastTiming } };
    await db.console.query(`INSERT INTO refund_radar_runs (ms, found, new_rows, auto_resolved, errors, ledger_refunded, timing) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [lastRun.ms, found.length, newRows, auto, JSON.stringify(errors), led.refunded || 0, JSON.stringify(lastTiming)]).catch(() => {});
    await db.console.query(`DELETE FROM refund_radar_runs WHERE at < now() - interval '90 days'`).catch(() => {});
  } catch (e) { lastRun = { at: new Date().toISOString(), error: e.message }; console.error('[refund-radar]', e.message); }
  finally { running = false; }
}
function start() {
  if (!db.console || !db.source) return;
  const t = setTimeout(() => { tick(); setInterval(tick, TICK_MS); }, 40e3); if (t.unref) t.unref();
}

/* ---------------------------------------------------------------------------------------------- periods (KSA days) */
const ksaToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
function periodOf(q = {}) {
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s + 'T00:00:00Z'));
  const today = ksaToday();
  let to = ok(q.to) ? q.to : today;
  let from = ok(q.from) ? q.from : addDays(to, -(Math.min(400, Math.max(1, Number(q.days) || 30)) - 1));
  if (from > to) { const t = from; from = to; to = t; }
  if (daysBetween(from, to) > 400) from = addDays(to, -399);
  const span = daysBetween(from, to) + 1;
  const g = ['day', 'week', 'month'].includes(q.g) ? q.g : (span > 120 ? 'month' : span > 45 ? 'week' : 'day');
  return { from, to, g, days: span, fromTs: new Date(from + 'T00:00:00+03:00').toISOString(), toTs: new Date(addDays(to, 1) + 'T00:00:00+03:00').toISOString() };
}
/* bucket key of an instant, in KSA time */
function bucketKey(iso, g) {
  const d = new Date(new Date(iso).getTime() + 3 * 3600e3); const day = d.toISOString().slice(0, 10);
  if (g === 'month') return day.slice(0, 7) + '-01';
  if (g === 'week') { const dow = (d.getUTCDay() + 6) % 7; return addDays(day, -dow); }
  return day;
}
function buckets(p) {
  const out = []; let k = bucketKey(p.fromTs, p.g); const end = bucketKey(new Date(new Date(p.toTs).getTime() - 1).toISOString(), p.g);
  let guard = 0;
  while (k <= end && guard++ < 500) { out.push(k); k = p.g === 'month' ? addDays(k, 32).slice(0, 7) + '-01' : addDays(k, p.g === 'week' ? 7 : 1); }
  return out;
}
const median = arr => { const a = arr.filter(x => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const hours = (a, b) => a && b ? (new Date(b) - new Date(a)) / 36e5 : null;

/* ---------------------------------------------------------------------------------------------- reads */
/* proxycms refunds of a period, each with the console's view of it (candidate, caught first, lead time) */
async function ledgerRows(p, { limit = 5000, reason, status, vendor, q, category } = {}) {
  if (!(await ledgerAvailable())) return { available: false, rows: [], tables: _ledgerAvail.tables };
  const t = _ledgerAvail.tables;
  const w = [`r.created_at >= $1::timestamp`, `r.created_at < $2::timestamp`]; const params = [p.fromTs, p.toTs];
  if (status) { params.push(status); w.push(`r.status = $${params.length}`); }
  if (vendor) { params.push(vendor); w.push(`p.vendor = $${params.length}`); }
  if (reason) { params.push(reason); w.push(`${REASON_SQL} = $${params.length}`); }
  if (q) { const d = String(q).replace(/\D/g, '').slice(-9); params.push('%' + (d || String(q)) + '%'); w.push(`(p.customer_mobile_number ILIKE $${params.length} OR p.target_mobile_number ILIKE $${params.length} OR r.payment_id ILIKE $${params.length} OR p.payment_on_id ILIKE $${params.length} OR r.notes ILIKE $${params.length} OR o.customer_name ILIKE $${params.length})`); }
  params.push(Math.min(60000, Number(limit) || 5000));
  const r = await db.source.query(`SELECT r.id, r.created_at, r.updated_at, r.status, r.refund_type, r.notes, r.fail_reason, r.payment_id, r.admin_user_id,
         ${t.refund_reasons ? 'rr.reason AS reason_raw' : 'NULL::text AS reason_raw'}, ${t.admin_users ? 'au.email AS admin_email' : 'NULL::text AS admin_email'},
         ${REASON_SQL} AS reason,
         p.amount, p.vendor, p.payment_on_type, p.payment_on_id, p.customer_mobile_number, p.target_mobile_number, p.platform, p.payment_method, p.status AS pay_status, p.created_at AS paid_at,
         c.checkout_type, c.checkout_for_type, c.checkout_id AS checkout_code, c.mobile_number AS checkout_mobile, c.extra->>'sim_type' AS sim_type,
         o.customer_name, o.mobile_number AS order_mobile, o.number_order_type, o.activated
    FROM refunds r ${LEDGER_JOINS(t)}
   WHERE ${w.join(' AND ')} ORDER BY r.created_at DESC LIMIT $${params.length}`, params);
  let rows = r.rows.map(x => { const reason = x.reason || (x.reason_raw || '—'); const cat = categorize(reason);
    return { id: x.id, created_at: x.created_at, updated_at: x.updated_at, status: x.status, type: x.refund_type === 0 ? 'reverse' : 'refund', auto: !x.admin_user_id,
      refunded_by: x.admin_email ? String(x.admin_email).split('@')[0] : (x.admin_user_id ? 'admin #' + x.admin_user_id : 'Auto generated'),
      reason, category: cat, category_label: (CATEGORIES[cat] || CATEGORIES.other).label, platform: !!(CATEGORIES[cat] || {}).platform,
      notes: x.notes ? String(x.notes).slice(0, 400) : null, inc: incOf(x.notes), fail_reason: x.fail_reason || null,
      amount: x.amount == null ? null : Number(x.amount), vendor: x.vendor, paid_for: x.payment_on_type, target: x.payment_on_id, payment_id: x.payment_id, pay_status: x.pay_status, paid_at: x.paid_at, platform_name: x.platform, method: x.payment_method,
      checkout_type: x.checkout_type, checkout_kind: x.checkout_type == null ? null : ({ 0: 'store', 1: 'data SIM', 2: 'change plan', 3: 'SIM replacement', 4: 'store', 5: 'ownership transfer', 6: 'renewal', 7: 'advanced postpaid' })[x.checkout_type] || ('type ' + x.checkout_type),
      checkout_code: x.checkout_code, sim: x.sim_type == null ? null : (x.sim_type === '1' ? 'eSIM' : 'physical SIM'),
      mobile: x.customer_mobile_number || x.checkout_mobile || x.order_mobile || x.target_mobile_number || null, customer_name: x.customer_name || null, port_in: x.number_order_type === 1, activated: x.activated };
  });
  if (category) rows = rows.filter(x => x.category === category);
  /* the console side: candidate on the same payment (or the same target / order) */
  const pids = rows.map(x => x.payment_id).filter(Boolean); const tids = rows.map(x => x.target).filter(Boolean);
  if (rows.length) {
    const cr = await db.console.query(`SELECT id, kind, status, detected_at, event_at, payment_id, order_id, evidence->>'target' AS target FROM refund_candidates WHERE payment_id = ANY($1::text[]) OR order_id = ANY($2::text[]) OR evidence->>'target' = ANY($2::text[])`, [pids, tids]);
    const byPay = {}, byOrder = {};
    for (const c of cr.rows) { if (c.payment_id) (byPay[c.payment_id] = byPay[c.payment_id] || []).push(c); if (c.order_id) (byOrder[c.order_id] = byOrder[c.order_id] || []).push(c); if (c.target) (byOrder[c.target] = byOrder[c.target] || []).push(c); }
    for (const x of rows) {
      const cs = (byPay[x.payment_id] || byOrder[x.target] || []).sort((a, b) => new Date(a.detected_at) - new Date(b.detected_at));
      const c = cs[0];
      x.console = c ? { id: c.id, kind: c.kind, label: (KINDS[c.kind] || {}).label || c.kind, status: c.status, detected_at: c.detected_at, caught_first: new Date(c.detected_at) < new Date(x.created_at), lead_h: hours(c.detected_at, x.created_at) } : null;
    }
  }
  return { available: true, rows, tables: t };
}

async function overview(q = {}) {
  await ensure();
  const p = periodOf(q);
  const [byKind, cand, openRow, runs, led, handled] = await Promise.all([
    db.console.query(`SELECT kind, status, count(*)::int n, coalesce(sum(amount),0)::float sar FROM refund_candidates WHERE (detected_at >= $1::timestamptz AND detected_at < $2::timestamptz) OR status = 'open' GROUP BY 1,2`, [p.fromTs, p.toTs]),
    db.console.query(`SELECT kind, status, amount::float AS amount, detected_at, event_at, updated_at, resolved_at, ledger FROM refund_candidates WHERE detected_at >= $1::timestamptz AND detected_at < $2::timestamptz`, [p.fromTs, p.toTs]),
    db.console.query(`SELECT count(*)::int open, coalesce(sum(amount),0)::float sar, min(event_at) oldest, count(*) FILTER (WHERE detected_at >= now() - interval '24 hours')::int new_24h,
                             count(*) FILTER (WHERE event_at < now() - interval '7 days')::int older_7d,
                             count(*) FILTER (WHERE ledger->>'status' = 'pending')::int refund_pending, count(*) FILTER (WHERE ledger->>'status' = 'fail')::int refund_failed,
                             count(*) FILTER (WHERE status = 'approved')::int approved_open
                        FROM refund_candidates WHERE status IN ('open','approved')`),
    db.console.query(`SELECT at, ms, found, new_rows, auto_resolved, ledger_refunded, errors, timing FROM refund_radar_runs ORDER BY at DESC LIMIT 12`),
    ledgerRows(p, { limit: 60000 }).catch(e => ({ available: false, rows: [], error: e.message })),
    db.console.query(`SELECT status, updated_by, count(*)::int n, coalesce(sum(amount),0)::float sar,
                             percentile_cont(0.5) WITHIN GROUP (ORDER BY greatest(0, extract(epoch FROM (coalesce(resolved_at, updated_at) - detected_at)) / 3600.0)) AS med_h
                        FROM refund_candidates WHERE status <> 'open' AND coalesce(resolved_at, updated_at) >= $1::timestamptz AND coalesce(resolved_at, updated_at) < $2::timestamptz GROUP BY 1,2`, [p.fromTs, p.toTs])
  ]);
  /* series per bucket: candidates detected · refunds posted in proxycms (all / success) · caught-first count */
  const B = buckets(p); const S = Object.fromEntries(B.map(k => [k, { bucket: k, detected_n: 0, detected_sar: 0, refunds_n: 0, refunds_sar: 0, success_n: 0, success_sar: 0, failed_n: 0, caught_first_n: 0, platform_n: 0, auto_n: 0 }]));
  for (const c of cand.rows) { const s = S[bucketKey(c.detected_at, p.g)]; if (s) { s.detected_n++; s.detected_sar += Number(c.amount || 0); } }
  const L = led.rows || [];
  const byReason = {}, byCat = {}, byVendor = {}, byAdmin = {}, byType = { refund: 0, reverse: 0 }, byStatus = {}, byPaidFor = {};
  const leads = [], toRefundH = []; let caughtFirst = 0, platformN = 0, missed = 0, platformSar = 0, caughtSar = 0, successSar = 0, successN = 0, failN = 0, pendingN = 0, autoN = 0, missedRows = [];
  for (const x of L) {
    const s = S[bucketKey(x.created_at, p.g)];
    const amt = Number(x.amount || 0);
    if (s) { s.refunds_n++; s.refunds_sar += amt; if (x.status === 'success') { s.success_n++; s.success_sar += amt; } if (x.status === 'fail') s.failed_n++; if (x.platform) s.platform_n++; if (x.auto) s.auto_n++; if (x.console && x.console.caught_first) s.caught_first_n++; }
    const R = byReason[x.reason] = byReason[x.reason] || { reason: x.reason, category: x.category, n: 0, sar: 0, success_n: 0, success_sar: 0, fail_n: 0, pending_n: 0, auto_n: 0, manual_n: 0, caught_first_n: 0, caught_n: 0, missed_n: 0, platform: x.platform };
    R.n++; R.sar += amt; if (x.status === 'success') { R.success_n++; R.success_sar += amt; } if (x.status === 'fail') R.fail_n++; if (x.status === 'pending') R.pending_n++; if (x.auto) R.auto_n++; else R.manual_n++;
    const C = byCat[x.category] = byCat[x.category] || { category: x.category, ...(CATEGORIES[x.category] || CATEGORIES.other), n: 0, sar: 0, success_sar: 0, caught_first_n: 0, missed_n: 0, reasons: {} };
    C.n++; C.sar += amt; if (x.status === 'success') C.success_sar += amt; C.reasons[x.reason] = (C.reasons[x.reason] || 0) + 1;
    const V = byVendor[x.vendor || '—'] = byVendor[x.vendor || '—'] || { vendor: x.vendor || '—', n: 0, sar: 0, fail_n: 0 }; V.n++; V.sar += amt; if (x.status === 'fail') V.fail_n++;
    const A = byAdmin[x.refunded_by] = byAdmin[x.refunded_by] || { by: x.refunded_by, n: 0, sar: 0, auto: x.auto }; A.n++; A.sar += amt;
    const PF = byPaidFor[x.paid_for || '—'] = byPaidFor[x.paid_for || '—'] || { paid_for: x.paid_for || '—', n: 0, sar: 0 }; PF.n++; PF.sar += amt;
    byType[x.type] = (byType[x.type] || 0) + 1; byStatus[x.status] = (byStatus[x.status] || 0) + 1;
    if (x.status === 'success') { successSar += amt; successN++; } if (x.status === 'fail') failN++; if (x.status === 'pending') pendingN++; if (x.auto) autoN++;
    if (x.console) { R.caught_n++; if (x.console.caught_first) { R.caught_first_n++; C.caught_first_n++; caughtFirst++; caughtSar += amt; leads.push(x.console.lead_h); toRefundH.push(x.console.lead_h); } }
    if (x.platform) { platformN++; platformSar += amt; if (!x.console) { missed++; R.missed_n++; C.missed_n++; if (missedRows.length < 60) missedRows.push({ id: x.id, created_at: x.created_at, reason: x.reason, amount: amt, paid_for: x.paid_for, checkout_kind: x.checkout_kind, by: x.refunded_by, inc: x.inc }); } }
  }
  const catList = Object.values(byCat).map(c => ({ ...c, reasons: Object.entries(c.reasons).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([reason, n]) => ({ reason, n })), share: L.length ? Math.round(1000 * c.n / L.length) / 10 : 0 })).sort((a, b) => b.n - a.n);
  const detectorHealth = Object.keys(DETECTORS).map(k => { const lr = runs.rows[0]; const err = lr && lr.errors ? lr.errors[k] : (lastRun && lastRun.errors ? lastRun.errors[k] : null); const tm = (lr && lr.timing && lr.timing[k]) ?? lastTiming[k]; return { kind: k, label: KINDS[k].label, ok: !err, error: err || null, ms: tm ?? null }; });
  const H = handled.rows.reduce((a, x) => { const k = x.status === 'refunded' && x.updated_by === 'proxycms' ? 'refunded_proxycms' : x.status; a[k] = a[k] || { n: 0, sar: 0, med_h: [] }; a[k].n += x.n; a[k].sar += x.sar; if (x.med_h != null) a[k].med_h.push(Number(x.med_h)); return a; }, {});
  for (const k of Object.keys(H)) H[k].med_h = median(H[k].med_h);
  return {
    period: p, kinds: KINDS, categories: CATEGORIES, by_kind: byKind.rows, open: openRow.rows[0], series: B.map(k => S[k]),
    ledger: { available: led.available, error: led.error || null, tables: led.tables || {}, n: L.length, sar: L.reduce((a, x) => a + Number(x.amount || 0), 0), success_n: successN, success_sar: successSar, fail_n: failN, pending_n: pendingN, auto_n: autoN, manual_n: L.length - autoN,
      by_reason: Object.values(byReason).sort((a, b) => b.n - a.n), by_category: catList, by_vendor: Object.values(byVendor).sort((a, b) => b.n - a.n), by_admin: Object.values(byAdmin).sort((a, b) => b.n - a.n), by_type: byType, by_status: byStatus, by_paid_for: Object.values(byPaidFor).sort((a, b) => b.n - a.n) },
    impact: { platform_n: platformN, platform_sar: platformSar, caught_first_n: caughtFirst, caught_first_sar: caughtSar, caught_first_pct: platformN ? Math.round(1000 * caughtFirst / platformN) / 10 : null, missed_n: missed, missed: missedRows, median_lead_h: median(leads), median_detect_to_refund_h: median(toRefundH) },
    handling: H, detected_in_period: cand.rows.length, detected_sar_in_period: cand.rows.reduce((a, x) => a + Number(x.amount || 0), 0),
    detectors: detectorHealth, runs: runs.rows, last_run: runs.rows[0] || lastRun, lookback_days: LOOKBACK_DAYS, tick_min: TICK_MS / 60e3, sim_checkout_types: SIM_CHECKOUT_TYPES
  };
}
async function list({ status = 'open', kind, q, limit = 200, from, to, days } = {}) {
  await ensure();
  const p = periodOf({ from, to, days });
  /* open = the current backlog whatever the period; closed statuses = what was done IN the period; all = both */
  /* $1/$2 are ALWAYS referenced (typed) — a bound parameter no branch mentions is the "could not determine data type" error */
  const w = [`$1::timestamptz <= $2::timestamptz`]; const par = [p.fromTs, p.toTs];
  if (status === 'open' || status === 'approved') w.push(`status = '${status}'`);
  else if (status && status !== 'all') { par.push(status); w.push(`status = $${par.length}`, `coalesce(resolved_at, updated_at, detected_at) >= $1::timestamptz AND coalesce(resolved_at, updated_at, detected_at) < $2::timestamptz`); }
  else w.push(`(status IN ('open','approved') OR (detected_at >= $1::timestamptz AND detected_at < $2::timestamptz) OR (coalesce(resolved_at, updated_at) >= $1::timestamptz AND coalesce(resolved_at, updated_at) < $2::timestamptz))`);
  if (kind) { par.push(kind); w.push(`kind = $${par.length}`); }
  if (q) { par.push('%' + String(q).replace(/\D/g, '').slice(-9) + '%'); par.push('%' + String(q).trim() + '%'); w.push(`(mobile ILIKE $${par.length - 1} OR order_id ILIKE $${par.length} OR payment_id ILIKE $${par.length} OR identifier ILIKE $${par.length - 1} OR inc ILIKE $${par.length} OR customer_name ILIKE $${par.length} OR ledger->>'inc' ILIKE $${par.length})`); }
  par.push(Math.min(2000, Number(limit) || 200));
  const r = await db.console.query(`SELECT id, kind, side, mobile, order_id, payment_id, amount::float AS amount, customer_name, identifier, event_at, detected_at, last_seen_at, evidence, status, inc, note, updated_by, updated_at, resolved_at, ledger, ledger_at
      FROM refund_candidates WHERE ${w.join(' AND ')} ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, coalesce(resolved_at, updated_at, event_at) DESC LIMIT $${par.length}`, par);
  return { rows: r.rows, period: p };
}
async function forCustomer({ mobiles = [], orderIds = [] } = {}) {
  if (!db.console) return [];
  try { await ensure();
    const r = await db.console.query(`SELECT id, kind, mobile, order_id, payment_id, amount::float AS amount, event_at, detected_at, status, inc, evidence, ledger FROM refund_candidates
        WHERE (mobile = ANY($1::text[]) OR order_id = ANY($2::text[])) AND detected_at >= now() - interval '120 days' ORDER BY event_at DESC LIMIT 20`, [mobiles.filter(Boolean), orderIds.filter(Boolean)]);
    return r.rows.map(x => ({ ...x, label: (KINDS[x.kind] || {}).label || x.kind }));
  } catch (_) { return []; }
}
async function setStatus(id, { status, inc, note }, actor) {
  const ok = ['open', 'approved', 'refunded', 'dismissed'];
  if (!ok.includes(status)) throw new Error('status must be one of ' + ok.join(', '));
  const r = await db.console.query(`UPDATE refund_candidates SET status = $2, inc = coalesce(nullif($3,''), inc), note = coalesce(nullif($4,''), note), updated_by = $5, updated_at = now(),
      resolved_at = CASE WHEN $2 IN ('refunded','dismissed') THEN now() ELSE NULL END WHERE id = $1 RETURNING *`, [id, status, inc || null, note || null, actor || null]);
  if (!r.rowCount) throw new Error('not found');
  return r.rows[0];
}

/* ---------------------------------------------------------------------------------------------- exports */
const ksa = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { timeZone: KSA_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ''); };
const money = v => v == null ? '' : Number(v).toFixed(2);
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const evText = e => Object.entries(e || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
const H = h => h == null ? '' : h < 48 ? Math.round(h * 10) / 10 + ' h' : Math.round(h / 24 * 10) / 10 + ' d';

async function exportData(q, opts = {}) {
  const ov = await overview(q); const p = ov.period;
  const cands = (await list({ status: 'all', from: p.from, to: p.to, limit: 2000, kind: q.kind })).rows;
  const led = await ledgerRows(p, { limit: 20000 }).catch(() => ({ available: false, rows: [] }));
  return { ov, p, cands, ledger: led.rows || [], ledger_available: led.available !== false };
}
function xlsx(d, actor, masked) {
  const X = require('./xlsx'); const { ov, p } = d; const I = ov.impact, LG = ov.ledger;
  const S = [[`Refund exposure — Mobile — ${p.from} → ${p.to} (KSA days, ${p.g} buckets) — generated ${ksa(new Date().toISOString())} KSA by ${actor}${masked ? ' — identities masked' : ' — identities unmasked (audited)'}`], [],
    ['Open candidates now', ov.open.open, 'SAR', money(ov.open.sar)], ['New candidates in the period', ov.detected_in_period, 'SAR', money(ov.detected_sar_in_period)],
    ['Refunds posted in proxycms (period)', LG.n, 'SAR', money(LG.sar)], ['  of which success', LG.success_n, 'SAR', money(LG.success_sar)], ['  pending at the gateway', LG.pending_n], ['  failed at the gateway', LG.fail_n], ['  auto-generated by the app', LG.auto_n], ['  posted by an admin', LG.manual_n],
    ['Platform-caused refunds (activation, change plan, platform categories)', I.platform_n, 'SAR', money(I.platform_sar)], ['  flagged by the console BEFORE the refund', I.caught_first_n, '%', I.caught_first_pct == null ? '' : I.caught_first_pct], ['  median lead time (detection → refund)', I.median_lead_h == null ? '' : H(I.median_lead_h)], ['  not flagged (detector gap)', I.missed_n],
    ...Object.entries(ov.handling).map(([k, v]) => [`Closed in the console as ${k.replace('_', ' ')}`, v.n, 'SAR', money(v.sar), 'median hours open', v.med_h == null ? '' : Math.round(v.med_h * 10) / 10]),
    [], ['Detector', 'Status', 'Last run ms', 'Error'], ...ov.detectors.map(x => [x.label, x.ok ? 'ok' : 'ERROR', x.ms == null ? '' : x.ms, x.error || ''])];
  const C = [['Id', 'Kind', 'Status', 'Event (KSA)', 'Detected (KSA)', 'Customer', 'Mobile', 'Identifier', 'Order / checkout', 'Payment', 'SAR', 'INC', 'Note', 'Updated by', 'Updated (KSA)', 'proxycms refund', 'Refund status', 'Refund reason', 'Refunded by', 'Refund at (KSA)', 'Evidence']];
  d.cands.forEach(r => { const L = r.ledger || {}; C.push([r.id, (KINDS[r.kind] || {}).label || r.kind, r.status, ksa(r.event_at), ksa(r.detected_at), r.customer_name || '', r.mobile || '', r.identifier || '', r.order_id || '', r.payment_id || '', money(r.amount), r.inc || L.inc || '', r.note || '', r.updated_by || '', ksa(r.updated_at), L.id || '', L.status || (L.pay_status === 'refunded' ? 'payment refunded' : ''), L.reason || '', L.by || '', ksa(L.at), evText(r.evidence)]); });
  const R = [['Refund id', 'Created (KSA)', 'SAR', 'Status', 'Type', 'Reason', 'Category', 'Owner', 'Refunded by', 'INC', 'Notes', 'Fail reason', 'Vendor', 'Paid for', 'Checkout kind', 'SIM', 'Target / order', 'Payment', 'Mobile', 'Customer', 'Console kind', 'Console detected (KSA)', 'Caught before the refund', 'Lead time']];
  d.ledger.forEach(x => { const c = x.console; R.push([x.id, ksa(x.created_at), money(x.amount), x.status, x.type, x.reason, x.category_label, (CATEGORIES[x.category] || {}).owner || '', x.refunded_by, x.inc || '', x.notes || '', x.fail_reason || '', x.vendor || '', x.paid_for || '', x.checkout_kind || '', x.sim || '', x.target || '', x.payment_id || '', x.mobile || '', x.customer_name || '', c ? c.label : '', c ? ksa(c.detected_at) : '', c ? (c.caught_first ? 'yes' : 'no') : (x.platform ? 'MISSED' : 'n/a'), c ? H(c.lead_h) : '']); });
  const RR = [['Reason', 'Category', 'Owner', 'Refunds', 'SAR', 'Success', 'Success SAR', 'Pending', 'Failed', 'Auto', 'Manual', 'Caught before the refund', 'Flagged (any time)', 'Not flagged (platform)']];
  LG.by_reason.forEach(r => RR.push([r.reason, (CATEGORIES[r.category] || CATEGORIES.other).label, (CATEGORIES[r.category] || CATEGORIES.other).owner, r.n, money(r.sar), r.success_n, money(r.success_sar), r.pending_n, r.fail_n, r.auto_n, r.manual_n, r.caught_first_n, r.caught_n, r.platform ? r.missed_n : '']));
  const PP = [['Bucket (KSA)', 'Candidates detected', 'Detected SAR', 'Refunds posted', 'Refunds SAR', 'Successful refunds', 'Success SAR', 'Failed refunds', 'Platform-caused', 'Auto-generated', 'Caught before the refund']];
  ov.series.forEach(s => PP.push([s.bucket, s.detected_n, money(s.detected_sar), s.refunds_n, money(s.refunds_sar), s.success_n, money(s.success_sar), s.failed_n, s.platform_n, s.auto_n, s.caught_first_n]));
  const CC = [['Category', 'Owner', 'Refunds', 'Share %', 'SAR', 'Success SAR', 'Caught before the refund', 'Not flagged', 'Top reasons', 'What to fix']];
  LG.by_category.forEach(c => CC.push([c.label, c.owner, c.n, c.share, money(c.sar), money(c.success_sar), c.caught_first_n, c.platform ? c.missed_n : '', c.reasons.map(r => `${r.reason} (${r.n})`).join(' · '), c.fix]));
  return X.build([
    { name: 'Summary', rows: S, widths: [64, 14, 8, 14, 18, 10] },
    { name: 'Candidates', rows: C, numericCols: [0, 10], moneyCols: [10], widths: [7, 30, 12, 17, 17, 22, 14, 13, 38, 38, 10, 13, 30, 18, 17, 10, 16, 30, 18, 17, 80] },
    { name: 'proxycms refunds', rows: R, numericCols: [0, 2], moneyCols: [2], widths: [9, 17, 10, 9, 8, 34, 20, 24, 20, 13, 40, 24, 10, 16, 16, 12, 38, 38, 14, 22, 30, 17, 12, 10] },
    { name: 'By reason', rows: RR, numericCols: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], moneyCols: [4, 6], widths: [40, 20, 26, 9, 12, 9, 12, 9, 8, 7, 8, 12, 12, 12] },
    { name: 'By category (RCA)', rows: CC, numericCols: [2, 3, 4, 5, 6, 7], moneyCols: [4, 5], widths: [22, 26, 9, 8, 12, 12, 12, 10, 60, 90] },
    { name: 'By period', rows: PP, numericCols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], moneyCols: [2, 4, 6], widths: [14, 12, 13, 12, 12, 12, 12, 12, 12, 12, 12] }
  ]);
}
function pdf(d, actor, masked) {
  const P = require('./pdfout'); const { ov, p } = d; const I = ov.impact, LG = ov.ledger;
  const doc = P.doc({ footer: `Salam Operations Console - Mobile - Refund exposure - ${p.from} to ${p.to} - generated ${ksa(new Date().toISOString())} KSA by ${actor}` });
  const CC = doc.colors;
  const top = doc.band(64, CC.dark);
  doc.at(46, top + 24, `MOBILE - REFUND EXPOSURE - ${p.from} to ${p.to} (${p.days} KSA days)`, { size: 9, bold: true, color: [0.5, 0.83, 0.65] });
  doc.at(46, top + 44, 'What the console detected, what proxycms refunded, and the gap between them', { size: 13, bold: true, color: CC.white });
  doc.space(10); doc.h2('The period in numbers');
  doc.kv([['Open candidates now', `${ov.open.open} - ${money(ov.open.sar)} SAR - ${ov.open.older_7d} older than 7 days`], ['New candidates in the period', `${ov.detected_in_period} - ${money(ov.detected_sar_in_period)} SAR`],
    ['Refunds posted in proxycms', LG.available ? `${LG.n} - ${money(LG.sar)} SAR - ${LG.success_n} success - ${LG.pending_n} pending - ${LG.fail_n} failed - ${LG.auto_n} auto-generated` : 'ledger not in the replica yet'],
    ['Platform-caused refunds', `${I.platform_n} - ${money(I.platform_sar)} SAR (activation / change plan / platform categories)`],
    ['Flagged before the refund', I.platform_n ? `${I.caught_first_n} of ${I.platform_n} (${I.caught_first_pct} %) - median lead ${H(I.median_lead_h) || '-'}` : '-'],
    ['Not flagged (detector gap)', String(I.missed_n)],
    ...Object.entries(ov.handling).map(([k, v]) => [`Closed as ${k.replace('_', ' ')}`, `${v.n} - ${money(v.sar)} SAR${v.med_h != null ? ` - median ${Math.round(v.med_h)} h open` : ''}`])], { boldVal: true });
  const bad = ov.detectors.filter(x => !x.ok);
  if (bad.length) doc.p(`Detector errors in the last run: ${bad.map(x => `${x.label}: ${x.error}`).join(' | ')}`, { color: CC.red, size: 8.5 });
  if (LG.by_category.length) {
    doc.h2('Root causes - the proxycms reasons by category');
    doc.hChart(LG.by_category.map(c => ({ label: c.label, v: c.n, right: `${c.n} - ${money(c.sar)} SAR - ${c.share} % - ${c.owner}` })), { labelW: 120, rightW: 230 });
    doc.table([{ label: 'Category', w: 15 }, { label: 'Owner', w: 14 }, { label: 'Refunds', w: 6, align: 'right' }, { label: 'SAR', w: 8, align: 'right' }, { label: 'Caught first', w: 7, align: 'right' }, { label: 'Not flagged', w: 7, align: 'right' }, { label: 'Top reasons', w: 30 }],
      LG.by_category.map(c => [c.label, c.owner, String(c.n), money(c.sar), String(c.caught_first_n), c.platform ? String(c.missed_n) : '-', c.reasons.map(r => `${r.reason} (${r.n})`).join(', ')]), { size: 7.4 });
    for (const c of LG.by_category.filter(x => x.n > 0).slice(0, 6)) doc.p(`${c.label}: ${c.fix}.`, { size: 8.4, color: CC.muted });
  }
  if (LG.by_reason.length) {
    doc.h2('By reason - as chosen in proxycms');
    doc.table([{ label: 'Reason', w: 26 }, { label: 'Category', w: 12 }, { label: 'N', w: 5, align: 'right' }, { label: 'SAR', w: 8, align: 'right' }, { label: 'Success', w: 6, align: 'right' }, { label: 'Failed', w: 6, align: 'right' }, { label: 'Auto', w: 5, align: 'right' }, { label: 'Caught first', w: 7, align: 'right' }, { label: 'Not flagged', w: 7, align: 'right' }],
      LG.by_reason.slice(0, 40).map(r => [clip(r.reason, 60), (CATEGORIES[r.category] || CATEGORIES.other).label, String(r.n), money(r.sar), String(r.success_n), String(r.fail_n), String(r.auto_n), String(r.caught_first_n), r.platform ? String(r.missed_n) : '-']), { size: 7.2 });
  }
  doc.h2(`Per ${p.g} - candidates detected vs refunds posted`);
  doc.colChart(ov.series.map(s => ({ label: p.g === 'month' ? s.bucket.slice(0, 7) : s.bucket.slice(5), v: s.refunds_sar })), { maxLabels: 16 });
  doc.p('Bars: SAR refunded in proxycms per bucket. Table: candidates detected by the console against refunds posted.', { size: 8, color: CC.muted });
  doc.table([{ label: 'Bucket', w: 11 }, { label: 'Detected', w: 8, align: 'right' }, { label: 'Detected SAR', w: 10, align: 'right' }, { label: 'Refunds', w: 8, align: 'right' }, { label: 'Refunds SAR', w: 10, align: 'right' }, { label: 'Success SAR', w: 10, align: 'right' }, { label: 'Failed', w: 7, align: 'right' }, { label: 'Platform', w: 8, align: 'right' }, { label: 'Caught first', w: 9, align: 'right' }],
    ov.series.map(s => [s.bucket, String(s.detected_n), money(s.detected_sar), String(s.refunds_n), money(s.refunds_sar), money(s.success_sar), String(s.failed_n), String(s.platform_n), String(s.caught_first_n)]), { size: 7.4 });
  const open = d.cands.filter(r => r.status === 'open' || r.status === 'approved').slice(0, 40);
  doc.h2(`Open candidates - ${d.cands.filter(r => r.status === 'open' || r.status === 'approved').length} (first ${open.length} shown; the xlsx holds all)`);
  if (open.length) doc.table([{ label: 'Event', w: 10 }, { label: 'Kind', w: 15 }, { label: 'Customer', w: 16 }, { label: 'SAR', w: 7, align: 'right' }, { label: 'Status', w: 8 }, { label: 'Evidence', w: 34 }],
    open.map(r => [ksa(r.event_at), (KINDS[r.kind] || {}).label || r.kind, `${r.customer_name ? r.customer_name + ' ' : ''}${r.mobile || ''}`, money(r.amount), r.status + (r.ledger && r.ledger.status ? ` (refund ${r.ledger.status})` : ''), clip(evText(r.evidence), 150)]), { size: 6.9, rowColor: () => CC.red });
  else doc.p('Nothing open.', { color: CC.muted });
  const lg = d.ledger.slice(0, 120);
  if (lg.length) {
    doc.h2(`proxycms refunds in the period - ${d.ledger.length} (first ${lg.length} shown)`);
    doc.table([{ label: 'Created', w: 10 }, { label: 'SAR', w: 6, align: 'right' }, { label: 'Status', w: 6 }, { label: 'Reason', w: 22 }, { label: 'By', w: 12 }, { label: 'INC', w: 9 }, { label: 'Paid for', w: 11 }, { label: 'Mobile', w: 10 }, { label: 'Console', w: 14 }],
      lg.map(x => [ksa(x.created_at), money(x.amount), x.status, clip(x.reason, 44), x.refunded_by, x.inc || '-', `${x.paid_for || ''}${x.checkout_kind ? ' - ' + x.checkout_kind : ''}`, x.mobile || '', x.console ? `${x.console.caught_first ? 'caught first' : 'flagged'} ${H(x.console.lead_h)}` : (x.platform ? 'MISSED' : '-')]), { size: 6.8, rowColor: ri => lg[ri].platform && !lg[ri].console ? CC.amber : null });
  }
  doc.p(masked ? 'Identities are masked in this export.' : 'Identities are unmasked in this export; the export is audited.', { color: CC.muted, size: 8 });
  return doc.buffer();
}

/* ---------------------------------------------------------------------------------------------- routes */
function mount(app, { requireView, audit, roles }) {
  const gate = requireView('errors');
  const mayUnmask = req => !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
  const mask = (req, rows) => { const un = mayUnmask(req); let out = roles && roles.maskDeep ? roles.maskDeep(rows, un) : rows;
    if (!un) { const fix = r => { if (r && typeof r === 'object') { if (typeof r.notes === 'string') r.notes = maskDigits(r.notes); if (r.ledger && typeof r.ledger.notes === 'string') r.ledger.notes = maskDigits(r.ledger.notes); } return r; };
      out = Array.isArray(out) ? out.map(fix) : fix(out); }
    return out; };
  app.get('/api/refunds/overview', gate, async (req, res) => { try { const o = await overview(req.query); o.impact.missed = mask(req, o.impact.missed); res.json(o); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/refunds', gate, async (req, res) => { try {
      const out = await list({ status: req.query.status, kind: req.query.kind, q: req.query.q, limit: req.query.limit, from: req.query.from, to: req.query.to, days: req.query.days });
      if (mayUnmask(req) && audit) audit(req, 'PII_UNMASK', '/api/refunds', { rows: out.rows.length }).catch?.(() => {});
      res.json({ rows: mask(req, out.rows), period: out.period, kinds: KINDS });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/refunds/ledger', gate, async (req, res) => { try {
      const p = periodOf(req.query);
      const out = await ledgerRows(p, { limit: req.query.limit || 1000, reason: req.query.reason, status: req.query.status, vendor: req.query.vendor, q: req.query.q, category: req.query.category });
      if (mayUnmask(req) && audit) audit(req, 'PII_UNMASK', '/api/refunds/ledger', { rows: out.rows.length }).catch?.(() => {});
      res.json({ available: out.available, tables: out.tables, period: p, rows: mask(req, out.rows), categories: CATEGORIES });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/refunds/export', gate, async (req, res) => { try {
      if (!(req.caps && req.caps.export)) return res.status(403).json({ error: `role ${req.roleName} lacks export` });
      const format = req.query.format === 'pdf' ? 'pdf' : 'xlsx';
      const d = await exportData(req.query);
      const unmask = mayUnmask(req);
      if (!unmask) { d.cands = mask(req, d.cands); d.ledger = mask(req, d.ledger); d.ov.impact.missed = mask(req, d.ov.impact.missed); }
      if (audit) audit(req, unmask ? 'PII_UNMASK' : 'refund.export', '/api/refunds/export', { format, from: d.p.from, to: d.p.to, candidates: d.cands.length, refunds: d.ledger.length }).catch?.(() => {});
      const stamp = `${d.p.from}_${d.p.to}`;
      res.setHeader('Content-Disposition', `attachment; filename="refund-exposure_${stamp}.${format}"`);
      if (format === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.send(pdf(d, req.actor || 'console', !unmask)); }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(xlsx(d, req.actor || 'console', !unmask));
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/refunds/:id/status', gate, async (req, res) => { try {
      const row = await setStatus(Number(req.params.id), req.body || {}, req.actor);
      if (audit) audit(req, 'REFUND_CANDIDATE_STATUS', String(row.id), { status: row.status, inc: row.inc, kind: row.kind }).catch?.(() => {});
      res.json(mask(req, row));
    } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/refunds/run', gate, async (req, res) => { try { await tick(); res.json(lastRun || { ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { KINDS, CATEGORIES, DETECTORS, categorize, ensure, tick, start, overview, list, ledgerRows, forCustomer, setStatus, periodOf, exportData, xlsx, pdf, mount, LOOKBACK_DAYS };
