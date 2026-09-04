/* CHECKOUT FULL PICTURE — resolve a CMS checkout by its admin short code (checkouts.checkout_id,
 * e.g. "2wk2wrk2" — the Order ID column in proxy.salammobile.sa/admin/checkouts) or by uuid, and
 * assemble everything an agent needs: the checkout row, every payment attempt on it with the
 * gateway reference (the ⇄ Tap/UPG join key), and the customer identifier for the timeline.
 *
 * BOUNDEDNESS NOTE: checkout_id has NO index (verified in the app schema, 2.7M rows) — a lookup
 * by short code is a capped seq scan. That is acceptable ONLY because this runs on an explicit
 * agent action (a Yusr question / a search), never in a loop or a hot path; statement_timeout on
 * the source pool caps the worst case. If usage grows, ask the DBA for an index on checkout_id. */
'use strict';
const db = require('./db');

const TYPE = { 0: 'Purchase', 1: 'Recharge', 2: 'Bill payment', 3: 'SIM swap', 4: 'Activate SIM',
               5: 'Ownership transfer', 6: 'Renewal', 7: 'eSIM replacement', 8: 'Change plan' };

async function checkoutFull(idOrCode) {
  const q = String(idOrCode || '').trim();
  if (!/^[\w-]{4,40}$/.test(q)) return { found: false, error: 'not a checkout id/code' };
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
  const r = await db.source.query(
    `SELECT id::text AS uuid, checkout_id, checkoutable_type, checkoutable_id, checkout_type,
            aasm_state, paid, completed, completed_at, mobile_number, delivery_type, items,
            created_at, updated_at
       FROM checkouts
      WHERE ${isUuid ? 'id = $1::uuid' : 'checkout_id = $1'} LIMIT 1`, [q]);
  if (!r.rows.length) return { found: false, error: `no checkout matches '${q}'` };
  const c = r.rows[0];
  const pq = await db.source.query(
    `SELECT id::text AS pid, created_at, amount, status, vendor, payment_method,
            payment_reference_id, fail_reason
       FROM payments
      WHERE payment_on_type = 'Checkout' AND payment_on_id = $1
      ORDER BY created_at`, [c.uuid]).catch(e => ({ rows: [], _err: e.message }));
  const items = Array.isArray(c.items) ? c.items
    : (c.items && typeof c.items === 'object') ? [c.items] : [];
  return {
    found: true,
    checkout: {
      code: c.checkout_id, uuid: c.uuid,
      type: TYPE[c.checkout_type] ?? ('type ' + c.checkout_type), type_id: c.checkout_type,
      state: c.aasm_state, paid: c.paid, completed: c.completed, completed_at: c.completed_at,
      mobile_number: c.mobile_number || null,
      for: c.checkoutable_type ? `${c.checkoutable_type} ${c.checkoutable_id || ''}`.trim() : null,
      delivery_type: c.delivery_type, items_count: items.length,
      items_summary: items.slice(0, 4).map(x => (x && (x.name || x.title || x.plan_name || x.sku)) || '').filter(Boolean),
      created_at: c.created_at, updated_at: c.updated_at,
      admin_url: `https://proxy.salammobile.sa/admin/checkouts/${c.uuid}`
    },
    payments: pq.rows,
    payments_error: pq._err || null,
    identifier: c.mobile_number || null     // for the cross-system timeline
  };
}

/* gateway reference → the app payment + its parent (checkout/order) in one shot */
async function byGatewayRef(ref) {
  const q = String(ref || '').trim();
  if (!/^[\w.-]{6,40}$/.test(q)) return { found: false };
  const r = await db.source.query(
    `SELECT id::text AS pid, created_at, amount, status, vendor, payment_method,
            payment_on_type, payment_on_id, payment_reference_id, fail_reason,
            customer_mobile_number, target_mobile_number
       FROM payments
      WHERE payment_reference_id = $1 AND created_at > now() - interval '400 days'
      ORDER BY created_at DESC LIMIT 3`, [q]);
  if (!r.rows.length) return { found: false };
  const p = r.rows[0];
  let parent = null;
  if (p.payment_on_type === 'Checkout' && p.payment_on_id) {
    const c = await checkoutFull(p.payment_on_id).catch(() => null);
    if (c && c.found) parent = c.checkout;
  }
  return { found: true, payments: r.rows, parent,
           identifier: p.customer_mobile_number || p.target_mobile_number || null };
}

module.exports = { checkoutFull, byGatewayRef, TYPE };
