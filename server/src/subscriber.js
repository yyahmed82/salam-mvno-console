/* Subscriber 360 — a unified profile for one subscriber (by MSISDN or National ID).
 * Builds on errors.timeline() (which already resolves an order + gathers every journey
 * event with traces) and adds: all lines/SIMs, a rolled-up per-stage summary, and the
 * current plan. All PII (mobile, national id) is masked by the caller via roles.maskDeep
 * unless the actor holds unmaskPII (super_admin), same governance as the timeline drawer.
 */
const db = require('./db');
const errors = require('./errors');
const plans = require('./plans');

const FLOW = { 0: 'New (normal)', 1: 'Indirect', 2: 'POSA', 3: 'Apollo', 4: 'Ownership transfer', 5: 'Partner', 6: 'Visitor / Hajj', 7: 'QR POSA' };

async function profile({ key }) {
  const id = String(key || '').trim();
  if (!id) return { key: id, found: false, identity: null, lines: [], summary: {}, events: [] };

  const { order, events } = await errors.timeline({ identifier: id });
  const mobile = order ? order.mobile_number : id;
  const nid = order ? order.nationality_id_number : id;
  const pmap = await plans.loadMap();

  // every line/SIM this subscriber has acquired (an onboarding_order == one line attempt)
  let lines = [];
  try {
    lines = (await db.source.query(
      `SELECT id::text, mobile_number, nationality_id_number, plan_id, aasm_state, status,
              flow_type, number_order_type, sim_type, completed, activated, is_eligible,
              physical_sim_iccid, seller_id, store_id, checkout_id, created_at
         FROM onboarding_orders
        WHERE mobile_number = $1 OR nationality_id_number = $2
        ORDER BY created_at DESC LIMIT 50`, [mobile, nid])).rows.map(o => ({
          ...o,
          plan: plans.label(pmap, o.plan_id),
          line_type: o.number_order_type === 1 ? 'MNP port-in' : 'New number',
          sim: o.sim_type === 1 ? 'eSIM' : 'Physical SIM',
          flow: FLOW[o.flow_type] != null ? FLOW[o.flow_type] : o.flow_type
        }));
  } catch (e) { /* table/perm issues → empty */ }

  // per-stage roll-up from the timeline events
  const summary = {};
  for (const e of events) {
    const s = e.source;
    (summary[s] || (summary[s] = { ok: 0, fail: 0, pending: 0, total: 0 }));
    summary[s].total++;
    if (e.ok === true) summary[s].ok++;
    else if (e.ok === false) summary[s].fail++;
    else summary[s].pending++;
  }

  // current plan: the most recent SUCCESSFUL plan change, else the latest order's plan
  let currentPlan = order ? plans.label(pmap, order.plan_id) : (lines[0] ? lines[0].plan : null);
  const lastCp = [...events].reverse().find(e => e.source === 'change_plan_logs' && e.ok === true);
  if (lastCp && lastCp.request && lastCp.request.to_plan != null) currentPlan = plans.label(pmap, lastCp.request.to_plan);

  const identity = {
    mobile_number: mobile,
    nationality_id_number: nid,
    current_plan: currentPlan,
    order_plan: order ? plans.label(pmap, order.plan_id) : null,
    status: order ? order.status : null,
    state: order ? order.aasm_state : null,
    activated: order ? order.activated : (lines[0] ? lines[0].activated : null),
    flow: order ? (FLOW[order.flow_type] != null ? FLOW[order.flow_type] : order.flow_type) : null,
    lines_count: lines.length,
    first_seen: lines.length ? lines[lines.length - 1].created_at : (order ? order.created_at : null),
    last_seen: lines.length ? lines[0].created_at : (order ? order.created_at : null)
  };

  const found = !!order || lines.length > 0 || events.length > 0;
  return { key: id, found, identity, lines, summary, events };
}

module.exports = { profile };
