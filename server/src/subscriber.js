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

  let { order, events } = await errors.timeline({ identifier: id });
  /* REGRESSION FIX (3 Sep): searching a SALAM SERVICE MSISDN found no order (orders store the
   * CONTACT number) and the identity card then echoed the msisdn as "National ID". Map through
   * the app account instead: users.mobile_number IS the service number → take the customer's
   * real NID from the users row → re-resolve orders/events under that NID. */
  let userRow = null;
  try {
    const d = id.replace(/\D/g, '');
    const forms = /^(?:966|0)?5\d{8}$/.test(d)
      ? ['0' + d.slice(-9), '966' + d.slice(-9), d.slice(-9), '+966' + d.slice(-9)] : [id];
    userRow = (await db.source.query(
      `SELECT mobile_number, nationality_id_number FROM users
        WHERE mobile_number = ANY($1::text[]) OR nationality_id_number = $2::text
        ORDER BY current_sign_in_at DESC NULLS LAST LIMIT 1`, [forms, id])).rows[0] || null;
    if (!order && userRow && userRow.nationality_id_number) {
      const t2 = await errors.timeline({ identifier: String(userRow.nationality_id_number) });
      if (t2.order) { order = t2.order; events = t2.events; }
    }
    /* BSS-only customers (partner/tygo, 4 Sep): no order, no app account — but BSS knows the
     * NID (profile.identifier). Learn it, then re-resolve the orders/timeline under it so the
     * identity card fills (plan, flow, order state) instead of dashes. */
    if (!order && !userRow && /^(?:966|0)?5\d{8}$/.test(id.replace(/\D/g, ''))) {
      try {
        const live = require('./liveBss');
        const bssNid = await live.nidFromBss('966' + id.replace(/\D/g, '').slice(-9));
        if (bssNid) {
          userRow = { mobile_number: '966' + id.replace(/\D/g, '').slice(-9), nationality_id_number: bssNid };
          const t3 = await errors.timeline({ identifier: bssNid });
          if (t3.order) { order = t3.order; events = t3.events; }
        }
      } catch (e) { /* best-effort */ }
    }
  } catch (e) { /* users mapping is best-effort — identity falls back below */ }
  const mobile = order ? order.mobile_number : (userRow ? userRow.mobile_number : id);
  // NEVER echo a non-NID search key as the National ID — show the mapped one or nothing
  const nid = (order && order.nationality_id_number) ? order.nationality_id_number
    : (userRow && userRow.nationality_id_number) ? userRow.nationality_id_number
    : (/^[12]\d{9}$/.test(id) ? id : null);
  const pmap = await plans.loadMap();

  // every line/SIM this subscriber has acquired (an onboarding_order == one line attempt)
  let lines = [];
  try {
    lines = (await db.source.query(
      `SELECT id::text, mobile_number, nationality_id_number, plan_id, aasm_state, status,
              flow_type, number_order_type, sim_type, completed, activated, is_eligible,
              physical_sim_iccid, seller_id, store_id, checkout_id, created_at,
              lower(coalesce(nullif(external_service_name,''),'salam')) AS channel,
              mnp_number, mnp_operator
         FROM onboarding_orders
        WHERE mobile_number = ANY($1::text[]) OR nationality_id_number = $2
        ORDER BY created_at DESC LIMIT 50`, [(v => { const d = String(v == null ? '' : v).replace(/\D/g, '');
          if (!/^(?:966|0)?5\d{8}$/.test(d)) return [String(v)];
          const l9 = d.slice(-9); return ['0' + l9, '966' + l9, l9, '+966' + l9]; })(mobile), nid])).rows.map(o => ({
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

  const found = !!order || lines.length > 0 || events.length > 0 || !!userRow;
  return { key: id, found, identity, lines, summary, events };
}

/* VAS / ADDONS ACTIVITY (3 Sep 2026) — the CMS admin's "Service Logs" page reads per-service
 * toggle tables in the app DB (visible in its tabs): boosters, social_datas, voice_minutes,
 * roamings, idds, toogles [sic], flex_minutes, flex_datas, voice_datas. Same rows exist in OUR
 * replica — richer than the BSS list-subscriptions answer: state Added/Removed, ACTIVATE/
 * DEACTIVATE, request-sent/response-received flags, platform, timestamps.
 * DISCOVERY-NOT-HARDCODING: columns resolved from information_schema at first use; service
 * names joined from `services` when the FK + name column exist. INDEX-GATED per house rule —
 * a table whose mobile column has no index is SKIPPED with a note (toogles is 2.6M rows;
 * a seq scan per lookup would hammer the replica). */
/* CORRECTED (4 Sep): the CMS tabs are FILTERS over ONE polymorphic table — service_logs
 * (proved by prod probe: no boosters/toogles tables exist; service_logs = 3.76M rows).
 * The type column (loggable/serviceable type) carries the tab name. */
const VAS_TABLES = ['service_logs'];
let _vasMeta = null;
async function vasMeta() {
  if (_vasMeta) return _vasMeta;
  const cols = (await db.source.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [VAS_TABLES.concat(['services', 'service_groups'])])).rows;
  const idx = (await db.source.query(
    `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1)`,
    [VAS_TABLES])).rows;
  const by = t => cols.filter(c => c.table_name === t).map(c => c.column_name);
  const svcCols = by('services');
  const grpCols = by('service_groups');
  const meta = {
    services: { exists: svcCols.length > 0,
      name: ['name_en', 'name', 'title', 'service_name'].find(c => svcCols.includes(c)) || null,
      type: ['service_type', 'stype', 'kind'].find(c => svcCols.includes(c)) || null,
      // CMS's "Group" (Roaming Toggles / Sudan / Pakistan…) hangs off the service, not the log row
      groupFk: ['service_group_id', 'group_id'].find(c => svcCols.includes(c)) || null },
    groups: { exists: grpCols.length > 0,
      name: ['name_en', 'name', 'title'].find(c => grpCols.includes(c)) || null },
    tables: {}
  };
  for (const t of VAS_TABLES) {
    const cs = by(t); if (!cs.length) continue;
    const mcol = ['mobile_number', 'msisdn', 'mobile', 'customer_mobile_number'].find(c => cs.includes(c));
    const indexed = !!mcol && idx.some(i => i.tablename === t && i.indexdef.includes(`(${mcol}`));
    meta.tables[t] = { cols: cs, mcol, indexed };
  }
  _vasMeta = meta; return meta;
}
async function vasActivity(forms, limitPer = 12) {
  const meta = await vasMeta();
  const out = { rows: [], skipped: [], errors: [] };
  /* ACCURACY FIX (4 Sep, case 966510845332 - all 9 CMS rows in `toogles`): the index gate
   * SKIPPED unindexed tables and hid real data. db.source is the LOCAL replica - a bounded seq
   * scan on an explicit lookup is acceptable there. Unindexed tables now SCAN (in parallel,
   * LIMIT'd, statement-timeout-capped) and are only FLAGGED for the DBA index list. */
  if (!Object.keys(meta.tables).length) {
    out.skipped.push('service-log tables are not in the replica yet — they were added to prod-sync; data appears after the first pull');
    _vasMeta = null;   // re-discover next call once the sync creates them
    return out;
  }
  const jobs = Object.entries(meta.tables).map(async ([t, m]) => {
    if (!m.mcol) { out.skipped.push(`${t}: no mobile column`); return; }
    if (!m.indexed) out.skipped.push(`${t}: ${m.mcol} unindexed - scanned (slower); ask the DBA for the index`);
    try {
      const svcId = ['service_id', 'serviceable_id', 'loggable_id'].find(c => m.cols.includes(c)) || null;
      let join = svcId && meta.services.exists && meta.services.name
        ? `LEFT JOIN services s ON s.id = t.${svcId}` : '';
      let extra = join ? `, s.${meta.services.name} AS _svc_name${meta.services.type ? `, s.${meta.services.type} AS _svc_type` : ''}` : '';
      if (join && meta.services.groupFk && meta.groups.exists && meta.groups.name) {
        join += ` LEFT JOIN service_groups g ON g.id = s.${meta.services.groupFk}`;
        extra += `, g.${meta.groups.name} AS _svc_group`;
      }
      const r = await db.source.query(
        `SELECT t.*${extra} FROM ${t} t ${join}
          WHERE t.${m.mcol} = ANY($1::text[]) ORDER BY t.created_at DESC LIMIT ${Math.min(30, limitPer)}`, [forms]);
      for (const row of r.rows) {
        const pick = (...k) => { for (const x of k) if (row[x] != null && row[x] !== '') return row[x]; return null; };
        // localized JSONB unwrap ({en,ar} name objects) — CMS shows the EN label
        const uw = v => (v && typeof v === 'object') ? (v.en || v.ar || v.name || v.title || JSON.stringify(v).slice(0, 50)) : v;
        const opv = pick('operation_type', 'op_type', 'operation', 'action', 'request_type');
        out.rows.push({
          table: t, at: row.created_at, updated_at: row.updated_at,
          service: uw(pick('_svc_name', 'service_name', 'name', 'title')) || t.replace(/_/g, ' '),
          service_type: uw(pick('loggable_type', 'serviceable_type', '_svc_type', 'service_type', 'type')) || '',
          group: uw(pick('_svc_group', 'group_name', 'service_group', 'country', 'region')),
          op: opv == null ? null : String(opv) === '1' ? 'ACTIVATE' : String(opv) === '0' ? 'DEACTIVATE' : uw(opv),
          state: uw(pick('state', 'status', 'service_state')),
          req_sent: pick('service_req_sent', 'req_sent', 'request_sent', 'sent'),
          res_received: pick('service_res_received', 'res_received', 'response_received', 'received'),
          platform: uw(pick('platform', 'os')),
          plan: uw(pick('plan_name', 'price_plan_name', 'plan'))
        });
      }
    } catch (e) { out.errors.push(`${t}: ${e.message.slice(0, 100)}`); }
  });
  await Promise.all(jobs);
  out.rows.sort((a, z) => new Date(z.at) - new Date(a.at));
  out.rows = out.rows.slice(0, 40);
  return out;
}

module.exports = { profile, vasActivity };
