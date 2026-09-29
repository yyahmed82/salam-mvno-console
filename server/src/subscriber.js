/* Subscriber 360 — a unified profile for one subscriber (by MSISDN or National ID).
 * Builds on errors.timeline() (which already resolves an order + gathers every journey
 * event with traces) and adds: all lines/SIMs, a rolled-up per-stage summary, and the
 * current plan. All PII (mobile, national id) is masked by the caller via roles.maskDeep
 * unless the actor holds unmaskPII (super_admin), same governance as the timeline drawer.
 */
const db = require('./db');
const errors = require('./errors');
const plans = require('./plans');
const lookupCache = require('./lookupCache');

const FLOW = { 0: 'New (normal)', 1: 'Indirect', 2: 'POSA', 3: 'Apollo', 4: 'Ownership transfer', 5: 'Partner', 6: 'Visitor / Hajj', 7: 'QR POSA' };

async function buildProfile({ key }) {
  const id = String(key || '').trim();
  if (!id) return { key: id, found: false, identity: null, lines: [], summary: {}, events: [] };

  let { order, events } = await errors.timeline({ identifier: id });
  /* VISITORS (25 Sep 2026): a passport or a KSA border number is a legitimate search key — the order stores the passport
   * in nationality_id_number, the border number sits in the identity answers. Resolve through visitorKey and re-run the
   * timeline under what it found (mobile / passport), so Subscriber 360 shows the visitor like any subscriber. */
  let visitor = null;
  try { const vk = require('./visitorKey'); if (vk.isVisitorKey(id)) { visitor = await vk.resolve(id);
    if (visitor && visitor.identifier && !order) { const t = await errors.timeline({ identifier: visitor.mobile || visitor.identifier }); order = t.order || order; if (t.events && t.events.length) events = t.events; } } } catch (_) {}
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
  const mobile = order ? order.mobile_number : (userRow ? userRow.mobile_number : (visitor && visitor.mobile) ? visitor.mobile : id);
  // NEVER echo a non-NID search key as the National ID — show the mapped one or nothing
  const nid = (order && order.nationality_id_number) ? order.nationality_id_number
    : (userRow && userRow.nationality_id_number) ? userRow.nationality_id_number
    : (/^[12]\d{9}$/.test(id) ? id : null);
  const pmap = await plans.loadMap();

  /* EVERY LINE/SIM THIS SUBSCRIBER HAS ACQUIRED (an onboarding_order == one line attempt).
   *
   * 20 Sep 2026 — WHY match_basis EXISTS. This WHERE matches on the CONTACT NUMBER as well as the
   * national id, and a contact number is a field somebody typed into an order, not an identity. The
   * CMS admin filters on the national id alone, which is why the two disagree: the console can show
   * an order the CMS hides (his own, created before a national id was captured) AND, in the bad
   * case, an order belonging to WHOEVER ELSE typed the same contact number. Both looked identical
   * on screen, so the count could not be trusted either way.
   *
   * Now every row says why it matched. A row matched only by contact number AND carrying a
   * DIFFERENT national id is somebody else: it is dropped from the lines, dropped from the journey
   * count, and reported only as a number so the operator knows it exists without seeing a stranger's
   * data. A row with no national id at all stays — it is almost certainly his, and hiding a real
   * order is the worse error — but it is labelled, not silently counted as confirmed. */
  let lines = [], foreignContactOrders = 0;
  try {
    const rows = (await db.source.query(
      `SELECT id::text, mobile_number, nationality_id_number, plan_id, aasm_state, status,
              flow_type, number_order_type, sim_type, completed, activated, is_eligible,
              physical_sim_iccid, seller_id, store_id, checkout_id, created_at,
              lower(coalesce(nullif(external_service_name,''),'salam')) AS channel,
              mnp_number, mnp_operator,
              CASE WHEN $2::text IS NOT NULL AND nationality_id_number = $2::text THEN 'nid'
                   WHEN nationality_id_number IS NULL OR nationality_id_number = '' THEN 'contact_no_nid'
                   ELSE 'contact_other_nid' END AS match_basis
         FROM onboarding_orders
        WHERE ${await require('./visitorKey').orderNumberWhere('$1').catch(() => 'mobile_number = ANY($1::text[])')} OR nationality_id_number = $2
        ORDER BY created_at DESC LIMIT 50`, [(v => { const d = String(v == null ? '' : v).replace(/\D/g, '');
          if (!/^(?:966|0)?5\d{8}$/.test(d)) return [String(v)];
          const l9 = d.slice(-9); return ['0' + l9, '966' + l9, l9, '+966' + l9]; })(mobile), nid])).rows.map(o => ({
          ...o,
          plan: plans.label(pmap, o.plan_id),
          line_type: o.number_order_type === 1 ? 'MNP port-in' : 'New number',
          sim: o.sim_type === 1 ? 'eSIM' : 'Physical SIM',
          flow: FLOW[o.flow_type] != null ? FLOW[o.flow_type] : o.flow_type
        }));
    /* With no national id resolved we cannot tell his orders from anyone else's, so nothing is
     * dropped — every contact match is labelled unverified instead of quietly presented as his. */
    const knownNid = !!nid;
    foreignContactOrders = knownNid ? rows.filter(o => o.match_basis === 'contact_other_nid').length : 0;
    lines = rows
      .filter(o => !(knownNid && o.match_basis === 'contact_other_nid'))
      .map(o => ({ ...o, match_basis: knownNid ? o.match_basis
        : (o.match_basis === 'nid' ? 'nid' : 'contact_unverified') }));
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

  /* nationality of a visitor (the admin panel shows it next to the passport): onboarding_orders.nationality_id → a
   * nationalities row, read defensively (column names differ per deployment; any failure → null) */
  let nationality = null;
  if (order && order.nationality_id != null) {
    try { const nr = await db.source.query(`SELECT to_jsonb(n) AS j FROM nationalities n WHERE id = $1 LIMIT 1`, [order.nationality_id]);
      const j = nr.rows[0] && nr.rows[0].j; if (j) nationality = j.name_en || j.name || j.title || j.english_name || j.name_ar || null; } catch (_) {}
  }
  /* FULL NAME (25 Sep 2026 — "always give the customer full name"): onboarding_orders.customer_name, else the
   * checkout's contact_name, else the app account. Masked by roles.maskDeep like every PII field unless unmasked. */
  let customerName = (order && order.customer_name) || null;
  if (!customerName && order && order.checkout_id) {
    try { const ck = await db.source.query(`SELECT contact_name FROM checkouts WHERE checkout_id::text = $1 AND created_at >= now() - interval '2 years' ORDER BY created_at DESC LIMIT 1`, [String(order.checkout_id)]);
      customerName = (ck.rows[0] && ck.rows[0].contact_name) || null; } catch (_) {}
  }
  if (!customerName && userRow && (userRow.name || userRow.full_name)) customerName = userRow.name || userRow.full_name;
  customerName = customerName ? String(customerName).replace(/\s+/g, ' ').trim() || null : null;
  const identity = {
    customer_name: customerName,
    mobile_number: mobile,
    nationality_id_number: nid,
    current_plan: currentPlan,
    order_plan: order ? plans.label(pmap, order.plan_id) : null,
    status: order ? order.status : null,
    state: order ? order.aasm_state : null,
    activated: order ? order.activated : (lines[0] ? lines[0].activated : null),
    flow: order ? (FLOW[order.flow_type] != null ? FLOW[order.flow_type] : order.flow_type) : null,
    lines_count: lines.length,
    /* the identifier on the order is a NID (1…) or iqama (2…) for residents and a PASSPORT for visitors — letters
     * (A35659593, CU1745123) or digits only (146018237, UK) — so anything that is not a 10-digit 1|2 id is a passport */
    id_kind: nid ? (/^1\d{9}$/.test(String(nid)) ? 'nid' : /^2\d{9}$/.test(String(nid)) ? 'iqama' : 'passport') : null,
    nationality: nationality,
    selected_number: order && order.selected_number ? { number: order.selected_number, matched_by: order.selected_number_match } : null,
    visitor: visitor ? { kind: visitor.kind, key: visitor.key, matched_by: visitor.matched_by, note: visitor.note } : (nid && !/^[12]\d{9}$/.test(String(nid)) ? { kind: 'passport', key: nid, matched_by: order ? 'passport on the order' : 'passport on the account', note: null } : null),
    first_seen: lines.length ? lines[lines.length - 1].created_at : (order ? order.created_at : null),
    last_seen: lines.length ? lines[0].created_at : (order ? order.created_at : null)
  };

  /* REFUND EXPOSURE (25 Sep 2026): what the radar already knows this customer is owed — before the complaint */
  try { const rr = require('./refundRadar'); const f9 = v => { const d = String(v || '').replace(/\D/g, ''); const l = d.slice(-9); return l.length === 9 ? ['966' + l, '0' + l, l, '+966' + l] : []; };
    identity.refund_exposure = await rr.forCustomer({ mobiles: [...f9(mobile), ...f9(id), ...(visitor && visitor.mobile ? f9(visitor.mobile) : [])], orderIds: [order && order.id, ...lines.map(l => l.id)].filter(Boolean).map(String) });
  } catch (_) { identity.refund_exposure = []; }
  /* ONBOARDING FLOW GUARD (29 Sep 2026): the chosen number's class (Regular / Silver / Gold / Platinum / Data SIM) and any
   * non-approved-flow finding on this order — the identity card shows the class badge next to the selected number */
  try { identity.number_class = order ? await require('./flowGuard').forOrder(order.id) : null; } catch (_) { identity.number_class = null; }
  const found = !!order || lines.length > 0 || events.length > 0 || !!userRow;
  /* A COUNT ONLY — never the other customer's rows, never their national id. The operator learns
   * that the contact number is shared; they learn nothing about whoever else is using it. */
  const contactCollision = foreignContactOrders
    ? { count: foreignContactOrders,
        note: `${foreignContactOrders} further onboarding order(s) share this contact number under a different national ID. They are not this customer's and are not counted — search by that customer's own national ID to see them.` }
    : null;
  return { key: id, found, identity, lines, summary, events, contactCollision, visitor: identity.visitor || null, builtAt: new Date().toISOString() };
}

/* The cached face of buildProfile. In memory only — see lookupCache.js for why this is not
 * respCache. Masking still happens on the way out of /api/subscriber, on the cached body exactly as
 * on a fresh one, so a cache hit can never leak more than a miss would. */
function profile({ key }) { return lookupCache.wrap(key, () => buildProfile({ key })); }

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
