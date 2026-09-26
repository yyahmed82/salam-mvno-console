/* refundRadar.js — REFUND EXPOSURE (25 Sep 2026). Born from the review of 2,338 refund mails: every refund the L2 team
 * asks Alanoud to approve is a situation the platform ALREADY knew about hours or days earlier — a successful payment
 * whose order never activated (Semati 727/738, blocked person), the same number ported in twice, a change-plan charged
 * then failed on "IAM TOKEN IS NOT AVAILABLE", a SIM / eSIM replacement paid and never done, a paid order whose delivery
 * failed, a card captured twice within minutes. Today these reach us as INC tickets from the call centre; here they are
 * DETECTED on the replica every 15 minutes, logged in `refund_candidates` (console DB), shown on Mobile › Refund exposure,
 * pinned to the customer on Subscriber 360 / Yusr, and fed to the alert rules (refund_exposure_* metrics).
 *
 * TRACE: each candidate carries its evidence (payment id, gateway ref, order, last activation answer, …) and the page
 * opens the customer's Troubleshoot timeline / Customer 360 with one click. A candidate closes itself when the platform
 * resolves it (activation succeeds, a refund is posted on the payment) — status `resolved_auto`; humans set `approved`,
 * `refunded`, `dismissed` with the INC number, which is the register the approval mails never had.
 *
 * Every detector is bounded (last LOOKBACK_DAYS, one statement each, 45 s cap) and guarded: a failing detector reports
 * its error on the page instead of breaking the tick. Column facts used (replica, verified 25 Sep): payments
 * (status, amount, payment_on_type 'OnboardingOrder'|'Checkout', payment_on_id, customer_mobile_number,
 * payment_reference_id, vendor), checkouts (id, checkout_id = code, checkout_type), onboarding_orders (checkout_id = code,
 * activated, number_order_type 1 = MNP, mnp_number, customer_name), activation_logs (onboarding_order_id, state, status_code,
 * response), change_plan_logs (status 1 ok / 2 failed, payment_id, mobile_number, final_step_message), delivery_requests
 * (delivery_on_id = order id, delivery_state), numbers (identifier, onboarding_order_id). */
'use strict';
const db = require('./db');

const LOOKBACK_DAYS = Number(process.env.REFUND_RADAR_LOOKBACK_DAYS || 30);
const TICK_MS = Number(process.env.REFUND_RADAR_TICK_MS || 15 * 60e3);
const DELIVERY_FAILED = ['cancelled','canceled','deleted','RTO','CANCELLED','PUX43','returned','reverseReturned','shipmentCanceled','reverseShipmentCanceled','REFUSED','onhold','pickup_failed','DEX93','RD','DEX07-3','DEX07-4','DEX07-5','DEX07-6','DEX07-7','DEX07-8','DEX93-1','DEX93-2','DEX93-3','DEX93-4','DEX07'];

const KINDS = {
  paid_not_activated:    { label: 'Paid, never activated',           why: 'payment success · order not activated after 6 h (7 d for port-in) · no successful activation log', team: 'Digital Ops', mail_reason: 'Activation issue / Semati' },
  portin_twice:          { label: 'Same number ported in twice',     why: 'two paid MNP orders for the same ported number within the window', team: 'Digital Ops', mail_reason: 'Already active, portin-twice case' },
  change_plan_paid_failed:{ label: 'Change plan charged, failed',    why: 'change_plan_logs status failed on a successful payment, no later success for the line', team: 'Digital Ops', mail_reason: 'Refund-Change Plan Failed (IAM TOKEN …)' },
  sim_replacement_paid:  { label: 'SIM / eSIM replacement paid, not done', why: 'SIM-replacement payment success > 48 h · no activation after it for the line', team: 'Digital Ops', mail_reason: 'Esim / sim replacement not completed' },
  delivery_failed_paid:  { label: 'Paid, delivery failed',            why: 'courier state failed / cancelled on a paid, not activated order, no later delivery', team: 'Digital Ops', mail_reason: 'Delivery issue' },
  duplicate_charge:      { label: 'Charged twice',                    why: 'two success payments · same customer, amount, target · within 30 min', team: 'Digital Ops', mail_reason: 'Duplicate payment' }
};

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
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_refund_cand_status ON refund_candidates (status, detected_at DESC)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_refund_cand_mobile ON refund_candidates (mobile)`);
  await db.console.query(`CREATE TABLE IF NOT EXISTS refund_radar_runs (id bigserial PRIMARY KEY, at timestamptz DEFAULT now(), ms int, found int, new_rows int, auto_resolved int, errors jsonb)`);
}

/* ---------------------------------------------------------------------------------------------- detectors */
/* payment → order: OnboardingOrder payments carry the order id; Checkout payments go through checkouts.checkout_id (code) */
const PAY_ORDER = `LEFT JOIN checkouts c ON p.payment_on_type = 'Checkout' AND c.id::text = p.payment_on_id
   JOIN onboarding_orders o ON (p.payment_on_type = 'OnboardingOrder' AND o.id::text = p.payment_on_id) OR (c.id IS NOT NULL AND o.checkout_id::text = c.checkout_id::text)`;
const NOT_REFUNDED = `NOT EXISTS (SELECT 1 FROM payments r WHERE r.payment_on_id = p.payment_on_id AND r.payment_on_type = p.payment_on_type AND (r.status ILIKE '%refund%' OR r.status ILIKE '%revers%'))`;
const D = (n) => `now() - interval '${Number(n)} days'`;

const DETECTORS = {
  paid_not_activated: `
    SELECT 'paid_not_activated' AS kind, p.id::text AS ukey, p.customer_mobile_number AS mobile, o.id::text AS order_id, p.id::text AS payment_id, p.amount,
           o.customer_name, o.nationality_id_number AS identifier, p.created_at AS event_at,
           jsonb_build_object('gateway', p.vendor, 'ref', p.payment_reference_id, 'platform', p.platform, 'order_state', o.aasm_state, 'order_status', o.status,
             'port_in', o.number_order_type = 1, 'selected_number', (SELECT identifier FROM numbers n WHERE n.onboarding_order_id = o.id ORDER BY n.created_at DESC LIMIT 1),
             'last_activation', (SELECT coalesce(a.status_code,'') || ' ' || left(coalesce(a.response::text,''), 200) FROM activation_logs a WHERE a.onboarding_order_id = o.id ORDER BY a.created_at DESC LIMIT 1)) AS evidence
      FROM payments p ${PAY_ORDER}
     WHERE p.status = 'success' AND p.created_at >= ${D(LOOKBACK_DAYS)}
       AND p.created_at < CASE WHEN o.number_order_type = 1 THEN now() - interval '7 days' ELSE now() - interval '6 hours' END
       AND coalesce(o.activated, false) = false AND coalesce(c.checkout_type, 0) <> 5
       AND NOT EXISTS (SELECT 1 FROM activation_logs a WHERE a.onboarding_order_id = o.id AND a.state = true)
       AND ${NOT_REFUNDED}`,
  portin_twice: `
    SELECT 'portin_twice' AS kind, o2.id::text AS ukey, o2.mobile_number AS mobile, o2.id::text AS order_id, p.id::text AS payment_id, p.amount,
           o2.customer_name, o2.nationality_id_number AS identifier, p.created_at AS event_at,
           jsonb_build_object('ported_number', o2.mnp_number, 'first_order', o1.id::text, 'first_order_at', o1.created_at, 'first_activated', o1.activated, 'gateway', p.vendor, 'ref', p.payment_reference_id) AS evidence
      FROM onboarding_orders o1
      JOIN onboarding_orders o2 ON o2.mnp_number = o1.mnp_number AND o2.id <> o1.id AND o2.created_at > o1.created_at
      JOIN payments p ON p.status = 'success' AND ((p.payment_on_type = 'OnboardingOrder' AND p.payment_on_id = o2.id::text) OR (p.payment_on_type = 'Checkout' AND p.payment_on_id IN (SELECT c.id::text FROM checkouts c WHERE c.checkout_id::text = o2.checkout_id::text)))
     WHERE o2.created_at >= ${D(LOOKBACK_DAYS)} AND o1.created_at >= ${D(LOOKBACK_DAYS * 3)}
       AND o1.number_order_type = 1 AND o2.number_order_type = 1 AND coalesce(o1.mnp_number,'') <> ''
       AND EXISTS (SELECT 1 FROM payments p1 WHERE p1.status = 'success' AND ((p1.payment_on_type = 'OnboardingOrder' AND p1.payment_on_id = o1.id::text) OR (p1.payment_on_type = 'Checkout' AND p1.payment_on_id IN (SELECT c.id::text FROM checkouts c WHERE c.checkout_id::text = o1.checkout_id::text))))
       AND ${NOT_REFUNDED}`,
  change_plan_paid_failed: `
    SELECT 'change_plan_paid_failed' AS kind, l.id::text AS ukey, l.mobile_number AS mobile, NULL::text AS order_id, p.id::text AS payment_id, p.amount,
           NULL::text AS customer_name, NULL::text AS identifier, l.created_at AS event_at,
           jsonb_build_object('from_plan', l.from_plan, 'to_plan', l.to_plan, 'message', left(coalesce(l.final_step_message,''), 200), 'gateway', p.vendor, 'ref', p.payment_reference_id) AS evidence
      FROM change_plan_logs l JOIN payments p ON p.id::text = l.payment_id AND p.status = 'success'
     WHERE l.status = 2 AND l.created_at >= ${D(LOOKBACK_DAYS)} AND l.created_at < now() - interval '2 hours'
       AND NOT EXISTS (SELECT 1 FROM change_plan_logs l2 WHERE l2.mobile_number = l.mobile_number AND l2.status = 1 AND l2.created_at > l.created_at AND l2.created_at < l.created_at + interval '3 days')
       AND ${NOT_REFUNDED}`,
  sim_replacement_paid: `
    SELECT 'sim_replacement_paid' AS kind, p.id::text AS ukey, p.customer_mobile_number AS mobile, NULL::text AS order_id, p.id::text AS payment_id, p.amount,
           NULL::text AS customer_name, NULL::text AS identifier, p.created_at AS event_at,
           jsonb_build_object('paid_for', p.payment_on_type, 'target', p.payment_on_id, 'gateway', p.vendor, 'ref', p.payment_reference_id, 'method', p.payment_method) AS evidence
      FROM payments p
     WHERE p.status = 'success' AND p.created_at >= ${D(LOOKBACK_DAYS)} AND p.created_at < now() - interval '48 hours'
       AND (p.payment_on_type ILIKE '%sim%' OR EXISTS (SELECT 1 FROM checkouts c WHERE c.id::text = p.payment_on_id AND p.payment_on_type = 'Checkout' AND c.checkout_type = ANY($1::int[])))
       AND NOT EXISTS (SELECT 1 FROM activation_logs a WHERE a.msisdn = p.customer_mobile_number AND a.state = true AND a.created_at > p.created_at)
       AND ${NOT_REFUNDED}`,
  delivery_failed_paid: `
    SELECT 'delivery_failed_paid' AS kind, d.id::text AS ukey, coalesce(d.receiver_mobile, p.customer_mobile_number) AS mobile, o.id::text AS order_id, p.id::text AS payment_id, p.amount,
           o.customer_name, o.nationality_id_number AS identifier, d.created_at AS event_at,
           jsonb_build_object('courier', d.vendor, 'state', d.delivery_state, 'reference', d.external_reference_id, 'gateway', p.vendor, 'ref', p.payment_reference_id) AS evidence
      FROM delivery_requests d JOIN onboarding_orders o ON o.id::text = d.delivery_on_id
      JOIN payments p ON p.status = 'success' AND ((p.payment_on_type = 'OnboardingOrder' AND p.payment_on_id = o.id::text) OR (p.payment_on_type = 'Checkout' AND p.payment_on_id IN (SELECT c.id::text FROM checkouts c WHERE c.checkout_id::text = o.checkout_id::text)))
     WHERE d.created_at >= ${D(LOOKBACK_DAYS)} AND d.delivery_state = ANY($2::text[]) AND coalesce(o.activated, false) = false
       AND NOT EXISTS (SELECT 1 FROM delivery_requests d2 WHERE d2.delivery_on_id = d.delivery_on_id AND d2.created_at > d.created_at AND NOT (d2.delivery_state = ANY($2::text[])))
       AND ${NOT_REFUNDED}`,
  duplicate_charge: `
    SELECT 'duplicate_charge' AS kind, g.second_id AS ukey, g.customer_mobile_number AS mobile, CASE WHEN g.payment_on_type = 'OnboardingOrder' THEN g.payment_on_id END AS order_id, g.second_id AS payment_id, g.amount,
           NULL::text AS customer_name, NULL::text AS identifier, g.second_at AS event_at,
           jsonb_build_object('paid_for', g.payment_on_type, 'target', g.payment_on_id, 'charges', g.n, 'first_payment', g.first_id, 'first_at', g.first_at, 'seconds_apart', extract(epoch FROM g.second_at - g.first_at)::int, 'gateway', g.vendor) AS evidence
      FROM (SELECT customer_mobile_number, amount, payment_on_type, payment_on_id, count(*) AS n, min(created_at) AS first_at, max(created_at) AS second_at,
                   (array_agg(id::text ORDER BY created_at))[1] AS first_id, (array_agg(id::text ORDER BY created_at DESC))[1] AS second_id, max(vendor) AS vendor
              FROM payments WHERE status = 'success' AND created_at >= ${D(LOOKBACK_DAYS)}
             GROUP BY 1,2,3,4 HAVING count(*) > 1 AND max(created_at) - min(created_at) < interval '30 minutes') g
     WHERE NOT EXISTS (SELECT 1 FROM payments r WHERE r.payment_on_id = g.payment_on_id AND r.payment_on_type = g.payment_on_type AND (r.status ILIKE '%refund%' OR r.status ILIKE '%revers%'))`
};
const SIM_CHECKOUT_TYPES = String(process.env.REFUND_RADAR_SIM_CHECKOUT_TYPES || '').split(',').map(s => Number(s.trim())).filter(n => n > 0);

async function detect() {
  const found = []; const errors = {};
  let client; try { client = await db.source.connect(); } catch (e) { return { found, errors: { connect: e.message } }; }
  try {
    await client.query('SET statement_timeout = 45000').catch(() => {});
    for (const [kind, sql] of Object.entries(DETECTORS)) {
      const t0 = Date.now();
      try { const r = await client.query(sql, [SIM_CHECKOUT_TYPES, DELIVERY_FAILED]); for (const row of r.rows) found.push(row); errors[kind] = null; lastTiming[kind] = Date.now() - t0; }
      catch (e) { errors[kind] = e.message.slice(0, 160); lastTiming[kind] = Date.now() - t0; }
    }
  } finally { try { client.release(); } catch (_) {} }
  return { found, errors };
}
const lastTiming = {};
let lastRun = null; let running = false;

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
    /* auto-resolution: an OPEN candidate its detector no longer returns (activation succeeded, refund posted, later
     * delivery …) — only for detectors that ran without error this tick */
    const okKinds = Object.keys(DETECTORS).filter(k => !errors[k]);
    let auto = 0;
    if (okKinds.length) {
      const keys = found.map(f => f.kind + '|' + f.ukey);
      const r = await db.console.query(`UPDATE refund_candidates SET status = 'resolved_auto', resolved_at = now()
          WHERE status = 'open' AND kind = ANY($1::text[]) AND NOT (kind || '|' || ukey = ANY($2::text[])) AND detected_at >= ${D(LOOKBACK_DAYS + 2)}`, [okKinds, keys]);
      auto = r.rowCount;
    }
    lastRun = { at: new Date().toISOString(), ms: Date.now() - t0, found: found.length, new_rows: newRows, auto_resolved: auto, errors, timing: { ...lastTiming } };
    await db.console.query(`INSERT INTO refund_radar_runs (ms, found, new_rows, auto_resolved, errors) VALUES ($1,$2,$3,$4,$5)`, [lastRun.ms, found.length, newRows, auto, JSON.stringify(errors)]).catch(() => {});
    await db.console.query(`DELETE FROM refund_radar_runs WHERE at < now() - interval '30 days'`).catch(() => {});
  } catch (e) { lastRun = { at: new Date().toISOString(), error: e.message }; console.error('[refund-radar]', e.message); }
  finally { running = false; }
}
function start() {
  if (!db.console || !db.source) return;
  const t = setTimeout(() => { tick(); setInterval(tick, TICK_MS); }, 40e3); if (t.unref) t.unref();
}

/* ---------------------------------------------------------------------------------------------- reads */
async function overview({ days = 30 } = {}) {
  await ensure();
  const [byKind, trend, ages, runs] = await Promise.all([
    db.console.query(`SELECT kind, status, count(*)::int n, coalesce(sum(amount),0)::float sar FROM refund_candidates WHERE detected_at >= now() - ($1||' days')::interval OR status = 'open' GROUP BY 1,2`, [days]),
    db.console.query(`SELECT date_trunc('day', detected_at) AS day, count(*)::int n, coalesce(sum(amount),0)::float sar FROM refund_candidates WHERE detected_at >= now() - ($1||' days')::interval GROUP BY 1 ORDER BY 1`, [days]),
    db.console.query(`SELECT count(*)::int open, coalesce(sum(amount),0)::float sar, min(event_at) oldest, count(*) FILTER (WHERE detected_at >= now() - interval '24 hours')::int new_24h,
                             count(*) FILTER (WHERE event_at < now() - interval '7 days')::int older_7d FROM refund_candidates WHERE status = 'open'`),
    db.console.query(`SELECT at, ms, found, new_rows, auto_resolved, errors FROM refund_radar_runs ORDER BY at DESC LIMIT 1`)
  ]);
  return { kinds: KINDS, by_kind: byKind.rows, trend: trend.rows, open: ages.rows[0], last_run: runs.rows[0] || lastRun, lookback_days: LOOKBACK_DAYS, tick_min: TICK_MS / 60e3 };
}
async function list({ status = 'open', kind, q, limit = 200, days = 30 } = {}) {
  await ensure();
  const w = [`(detected_at >= now() - ($1||' days')::interval OR status = 'open')`]; const p = [days];
  if (status && status !== 'all') { p.push(status); w.push(`status = $${p.length}`); }
  if (kind) { p.push(kind); w.push(`kind = $${p.length}`); }
  if (q) { p.push('%' + String(q).replace(/\D/g, '').slice(-9) + '%'); w.push(`(mobile ILIKE $${p.length} OR order_id ILIKE $${p.length} OR payment_id ILIKE $${p.length} OR identifier ILIKE $${p.length} OR inc ILIKE $${p.length})`); }
  p.push(Math.min(1000, Number(limit) || 200));
  const r = await db.console.query(`SELECT id, kind, side, mobile, order_id, payment_id, amount::float AS amount, customer_name, identifier, event_at, detected_at, last_seen_at, evidence, status, inc, note, updated_by, updated_at, resolved_at
      FROM refund_candidates WHERE ${w.join(' AND ')} ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, event_at DESC LIMIT $${p.length}`, p);
  return r.rows;
}
async function forCustomer({ mobiles = [], orderIds = [] } = {}) {
  if (!db.console) return [];
  try { await ensure();
    const r = await db.console.query(`SELECT id, kind, mobile, order_id, payment_id, amount::float AS amount, event_at, detected_at, status, inc, evidence FROM refund_candidates
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

/* ---------------------------------------------------------------------------------------------- routes */
function mount(app, { requireView, audit, roles }) {
  const gate = requireView('errors');
  const mask = (req, rows) => roles && roles.maskDeep ? roles.maskDeep(rows, !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1') : rows;
  app.get('/api/refunds/overview', gate, async (req, res) => { try { res.json(await overview({ days: req.query.days })); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/refunds', gate, async (req, res) => { try {
      const rows = await list({ status: req.query.status, kind: req.query.kind, q: req.query.q, limit: req.query.limit, days: req.query.days });
      if (req.query.unmask === '1' && req.caps && req.caps.unmaskPII && audit) audit(req, 'PII_UNMASK', '/api/refunds', { rows: rows.length }).catch?.(() => {});
      res.json({ rows: mask(req, rows), kinds: KINDS });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/refunds/:id/status', gate, async (req, res) => { try {
      const row = await setStatus(Number(req.params.id), req.body || {}, req.actor);
      if (audit) audit(req, 'REFUND_CANDIDATE_STATUS', String(row.id), { status: row.status, inc: row.inc, kind: row.kind }).catch?.(() => {});
      res.json(mask(req, row));
    } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/refunds/run', gate, async (req, res) => { try { await tick(); res.json(lastRun || { ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { KINDS, DETECTORS, ensure, tick, start, overview, list, forCustomer, setStatus, mount, LOOKBACK_DAYS };
