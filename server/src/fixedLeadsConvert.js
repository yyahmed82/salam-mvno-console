/* fixedLeadsConvert.js — "was this lead converted, where, and by whom?" (Fixed › Leads, alpha.174, 9 Oct 2026).
 *
 * Asked 9 Oct: "a sync to check if the lead is converted by SDA and by who — it could be in the leads table or the workflow
 * states in nexus; check well and let's have this option in the best way".
 *
 * WHAT IT DOES, every harvest pass (fixedLeadsHarvest.harvest):
 *   1. reads the orders COMPLETED since the last pass — by completion time, so an SDA journey started days before it was
 *      submitted is not missed (the harvest itself reads journeys by start time, 26 h back) — from the read model
 *      (sda_ops order_attempts, prod + beta: outcome COMPLETED, completed_at, order number, the dealer row: dealer code, dealer
 *      name, staff code), first pass 45 days back (desk.convLookbackDays);
 *   2. confirms each one in nexus BY PRIMARY KEY only (workflow_states.id = ANY, 200 at a time — never a scan of nexus):
 *      the customer's national id and mobile, the account behind it (users), staff_id, the channel (SDA · E_PURCHASE ·
 *      PULSE), the QR referral, the BSS order number; the SDA staff member by primary key (staff.id) — name / username /
 *      code / dealer, whichever columns the table has;
 *   3. matches them to the desk's leads by the same person (national-id hash or mobile hash — never the number), any
 *      lead source (stopped journeys, promoter leads, imported batches, DashPro), an order completed after the lead's own
 *      journey started (the lead's own journey counts when it completed after the lead was created);
 *   4. records the FIRST such order on the lead as facts.conv = { at, journey, channel, workflow, product, plan, order,
 *      dealer { code, name }, staff { id, code, name }, referral, ocu (the OCU member whose SDA account placed it),
 *      how (sda_account · contacted · own), hours_after_contact, status_before } and an event 'converted';
 *      an OPEN lead becomes Won (credited as the harvest does: the member whose OCU SDA account placed it, else the
 *      member who called within attributionDays, else "ordered on their own"); a lead already won (by the team or by
 *      the harvest) gets the evidence attached; a lead already closed lost / unreachable / expired keeps its status and
 *      shows "ordered later via …" — the desk sees who closed the customers it lost.
 * PII: hashes and masks only, as the rest of the desk; staff names are Salam staff, not customers. Read-only on every
 * source. */
'use strict';
const db = require('./db');
const S = require('./fixedLeadsStore');

const C = S.C;
const log = (...a) => console.log('[leads]', ...a);
let J = null; try { J = require('./fixedJourney'); } catch (_) {}
const isDone = step => J ? J.isDone(step) : /ReviewOrder$|^reviewOrder$|Summary$/.test(String(step || ''));
const iso = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d.toISOString(); };
const str = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const pick = (o, keys) => { if (!o) return null; for (const k of keys) { const v = str(o[k]); if (v) return v; } return null; };
const PLACEHOLDER_ORDER = '11223344';   // every 5G e-purchase journey carries it until the BSS order is created at delivery

function channelOf(a, x) {
  const nc = String((x && x.channel) || '').toUpperCase(), c = String(a.channel || '').toLowerCase();
  if ((x && x.ref) || a.referral_code) return 'qr';
  if (nc === 'SDA' || c === 'sda') return 'sda';
  if (nc === 'PULSE' || c === 'salamhome') return 'salamhome';
  return 'epurchase';
}
function productOf(wf, plan) {
  const w = String(wf || ''), p = String(plan || '');
  if (/^salamHome(?!Relocation)/i.test(w)) return null;               // manage-line journeys (freeze, renew, change plan) are not an order of a new line
  if (/5g|fiveG|Relocation(WL|Own)/i.test(w) || /\b5g/i.test(p)) return '5g';
  return 'ftth';
}
const memberOfStaff = (desk, ...codes) => {
  for (const code of codes.filter(Boolean)) {
    const c = String(code).toUpperCase();
    const hit = Object.entries(desk.staffCodes || {}).find(([, v]) => String(v || '').toUpperCase() === c);
    if (hit) return hit[0];
  }
  return null;
};

/* ---- nexus, by primary key only ---- */
let nxStaff = true, nxUsers = true;
async function nexusById(ids) {
  const out = new Map(); if (!db.nexus || !ids.length) return out;
  for (let i = 0; i < ids.length; i += 200) {
    const r = await db.nexus.query(`SELECT id, workflow_id, channel::text AS channel, current_step, staff_id, user_id, plan_id, updated_at,
        context->'customer'->>'id' AS nid, context->'customer'->>'mobilePhone' AS mob, context->>'referralCode' AS ref, context->'order'->>'orderNbr' AS order_nbr
      FROM workflow_states WHERE id = ANY($1::text[])`, [ids.slice(i, i + 200)]);
    for (const x of r.rows) out.set(String(x.id), x);
  }
  /* the account behind the journey, for a journey with no customer block of its own */
  const need = [...out.values()].filter(x => x.user_id && (!x.nid || !x.mob));
  if (need.length && nxUsers) {
    const uids = [...new Set(need.map(x => String(x.user_id)))];
    try {
      for (let i = 0; i < uids.length; i += 500) {
        const r = await db.nexus.query(`SELECT id, phone_number, national_id FROM users WHERE id = ANY($1::text[])`, [uids.slice(i, i + 500)]);
        const m = new Map(r.rows.map(u => [String(u.id), u]));
        for (const x of need) { const u = m.get(String(x.user_id)); if (u) { x.acct_mob = u.phone_number; x.acct_nid = u.national_id; } }
      }
    } catch (e) { if (/permission denied|does not exist/i.test(e.message)) { nxUsers = false; log('conversions: nexus users not readable — ' + e.message.slice(0, 80)); } else throw e; }
  }
  return out;
}
/* staff by primary key; the columns are read by name from whatever the table has (only these few are kept) */
async function staffById(ids) {
  const out = new Map(); if (!db.nexus || !nxStaff || !ids.length) return out;
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const r = await db.nexus.query(`SELECT * FROM staff WHERE id::text = ANY($1::text[])`, [ids.slice(i, i + 200)]);
      for (const s of r.rows) {
        const first = pick(s, ['english_first_name', 'first_name_en', 'first_name', 'firstName']), last = pick(s, ['english_last_name', 'last_name_en', 'last_name', 'lastName']);
        out.set(String(s.id), {
          code: pick(s, ['staff_code', 'code', 'employee_code', 'employee_id', 'username', 'user_name', 'login', 'email']),
          name: pick(s, ['full_name', 'fullName', 'english_name', 'name', 'display_name']) || [first, last].filter(Boolean).join(' ') || null,
          dealer: pick(s, ['dealer_code', 'dealerCode', 'channel_code', 'outlet_code', 'shop_code', 'agent_code']),
          dealerName: pick(s, ['dealer_name', 'dealerName', 'channel_name', 'outlet_name', 'shop_name', 'company_name']),
        });
      }
    }
  } catch (e) { if (/permission denied|does not exist/i.test(e.message)) { nxStaff = false; log('conversions: nexus staff not readable — ' + e.message.slice(0, 80)); } else throw e; }
  return out;
}

/* ---- the sync ---- */
async function sync(desk, st, stats) {
  const pools = [['ops', db.ops], ['opsBeta', db.opsBeta]].filter(x => x[1] && !(x[0] === 'opsBeta' && x[1] === db.ops));
  if (!pools.length) return;
  const now = Date.now(), look = Math.max(7, S.n(desk.convLookbackDays) || 45) * 864e5, LIMIT = 4000;
  let from = st.convCursor ? (st.convBehind ? Date.parse(st.convCursor) : Math.min(Date.parse(st.convCursor), now - 26 * 3600e3)) : now - look;
  from = Math.max(from, now - look);
  const byId = new Map(); let hitAt = null;
  for (const [name, pool] of pools) {
    try {
      const r = await pool.query(`SELECT a.id, a.workflow::text AS workflow, a.channel::text AS channel, a.referral_code, a.plan, a.plan_id, a.customer_id, a.order_number,
          a.started_at, a.completed_at, coalesce(a.completed_at, a.started_at) AS done_at, d.staff_code, d.dealer_code, d.dealer_name
        FROM order_attempts a LEFT JOIN dealers d ON d.id = a.dealer_id
        WHERE a.outcome::text = 'COMPLETED' AND coalesce(a.completed_at, a.started_at) >= $1 ORDER BY coalesce(a.completed_at, a.started_at) LIMIT $2`, [new Date(from), LIMIT]);
      let last = null;
      for (const x of r.rows) { if (!byId.has(x.id)) byId.set(x.id, x); const t = Date.parse(x.done_at); if (!last || t > last) last = t; }
      if (r.rows.length >= LIMIT && last) hitAt = hitAt == null ? last : Math.min(hitAt, last);
    } catch (e) { stats.errors.push(`conversions ${name}: ${e.message.slice(0, 140)}`); }
  }
  st.convBehind = hitAt != null; st.convCursor = new Date(st.convBehind ? hitAt : now).toISOString();
  const rows = [...byId.values()]; stats.conv_orders = rows.length; if (!rows.length) return;

  let nx = new Map(); try { nx = await nexusById(rows.map(a => String(a.id))); } catch (e) { stats.errors.push('conversions nexus: ' + e.message.slice(0, 140)); }
  const staffIds = [...new Set([...nx.values()].map(x => x.staff_id).filter(Boolean).map(String))];
  let staff = new Map(); try { staff = await staffById(staffIds); } catch (e) { stats.errors.push('conversions staff: ' + e.message.slice(0, 140)); }

  /* one completion per order: who, where, what, for which person */
  const comps = [];
  for (const a of rows) {
    const x = nx.get(String(a.id)) || null;
    const wf = (x && x.workflow_id) || a.workflow, product = productOf(wf, a.plan);
    if (!product) continue;
    const nid = S.normNid((x && x.nid) || a.customer_id || (x && x.acct_nid)), mob = S.normMobile((x && x.mob) || (x && x.acct_mob));
    const idn = S.identity({ name: '', mobile: mob, nid });
    if (!idn.ident_hash && !idn.mobile_hash) continue;
    const sf = x && x.staff_id ? staff.get(String(x.staff_id)) || null : null;
    const channel = channelOf(a, x);
    const order = [a.order_number, x && x.order_nbr].map(str).find(v => v && v !== PLACEHOLDER_ORDER) || null;
    comps.push({ journey: String(a.id), at: iso(a.done_at), channel, workflow: wf, product, plan: S.planLabel((x && x.plan_id) || a.plan_id, a.plan, product), order,
      dealer: (a.dealer_code || (sf && sf.dealer)) ? { code: a.dealer_code || sf.dealer, name: str(a.dealer_name) || (sf && sf.dealerName) || null } : null,
      /* the SDA account code of the read model (OCU_001, S_0101 …) first — the code the desk's staffCodes use; nexus staff gives the name */
      staff: (x && x.staff_id) || a.staff_code ? { id: x && x.staff_id ? String(x.staff_id) : null, code: a.staff_code || (sf && sf.code) || null, name: (sf && sf.name) || null, user: (sf && sf.code) || null } : null,
      referral: (x && x.ref) || a.referral_code || null, staff_code: a.staff_code || (sf && sf.code) || null,
      nexus: !!x, done_in_nexus: x ? isDone(x.current_step) : null, ident_hash: idn.ident_hash, mobile_hash: idn.mobile_hash });
  }
  stats.conv_matched_orders = comps.length; if (!comps.length) return;

  /* the desk's leads of the same people, not yet carrying a conversion */
  const hs = [...new Set(comps.flatMap(c => [c.ident_hash, c.mobile_hash]).filter(Boolean))];
  const leads = [];
  for (let i = 0; i < hs.length; i += 2000) {
    const r = await C().query(`SELECT id, status, assignee, last_contact_at, occurred_at, created_at, source, source_ref, ident_hash, mobile_hash, won_by, won_auto
        FROM fixed_leads WHERE (ident_hash = ANY($1::text[]) OR mobile_hash = ANY($1::text[])) AND NOT (facts ? 'conv')`, [hs.slice(i, i + 2000)]);
    leads.push(...r.rows);
  }
  const seen = new Set();
  for (const L of leads) {
    if (seen.has(L.id)) continue; seen.add(L.id);
    /* any order of the same person after the lead's journey started — the lead's own journey too, when it completed after the
     * lead was created (the customer came back and finished it) */
    const occ = Date.parse(L.occurred_at), made = Date.parse(L.created_at);
    const c = comps.filter(k => (k.journey !== String(L.source_ref) ? Date.parse(k.at) >= occ : Date.parse(k.at) >= made)
        && ((L.ident_hash && k.ident_hash === L.ident_hash) || (L.mobile_hash && k.mobile_hash === L.mobile_hash)))
      .sort((p, q) => Date.parse(p.at) - Date.parse(q.at))[0];
    if (!c) continue;
    const at = Date.parse(c.at), lc = L.last_contact_at ? Date.parse(L.last_contact_at) : 0;
    const ocu = c.channel === 'sda' ? memberOfStaff(desk, c.staff_code, c.staff && c.staff.code) : null;
    const contacted = !!(L.assignee && lc && at >= lc - 3600e3 && at - lc <= S.n(desk.attributionDays) * 864e5);
    const how = ocu ? 'sda_account' : contacted ? 'contacted' : 'own';
    const conv = { at: c.at, journey: c.journey, channel: c.channel, workflow: c.workflow, product: c.product, plan: c.plan, order: c.order, dealer: c.dealer, staff: c.staff,
      referral: c.referral, ocu, how, hours_after_contact: lc && at >= lc ? Math.round((at - lc) / 36e5) : null, status_before: L.status,
      checked: c.nexus ? (c.done_in_nexus ? 'read model + nexus' : 'read model (nexus step not final)') : 'read model', seen_at: new Date().toISOString() };
    const open = S.OPEN.includes(L.status);
    if (open) {
      const by = ocu || (contacted ? L.assignee : null);
      const u = await C().query(`UPDATE fixed_leads SET status = 'won', won_at = $2, won_ref = $3, won_auto = true, won_by = $4, closed_at = now(), next_action_at = NULL,
          facts = facts || jsonb_build_object('conv', $5::jsonb), updated_at = now() WHERE id = $1 AND status = ANY($6) RETURNING id`, [L.id, c.at, c.order || c.journey, by, JSON.stringify(conv), S.OPEN]);
      if (!u.rowCount) continue;
      stats.won_auto = (stats.won_auto || 0) + 1; if (by) stats.credited = (stats.credited || 0) + 1;
      await S.event(L.id, by || 'system', 'won', { auto: true, how, ref: c.order || c.journey, product: c.product, source: c.channel, staff: (c.staff && c.staff.code) || null,
        dealer: c.dealer && c.dealer.code, conv: true }, by ? S.n(desk.points.won) : 0);
    } else {
      await C().query(`UPDATE fixed_leads SET facts = facts || jsonb_build_object('conv', $2::jsonb), updated_at = now() WHERE id = $1`, [L.id, JSON.stringify(conv)]);
      await S.event(L.id, 'system', 'converted', { channel: c.channel, dealer: c.dealer && c.dealer.code, dealer_name: c.dealer && c.dealer.name, staff: c.staff && (c.staff.name || c.staff.code),
        order: c.order, status: L.status, after_close: L.status !== 'won' });
    }
    stats.conversions = (stats.conversions || 0) + 1;
    if (L.status !== 'won' && !open) stats.conv_after_close = (stats.conv_after_close || 0) + 1;
  }
}

/* ---- the report: who converted the desk's leads (board, supervisors and members alike — dealer and staff are not customer data) */
async function report(days = 30) {
  const d = Math.max(1, Math.min(180, S.n(days) || 30));
  const q = (sql, p) => C().query(sql, p).then(r => r.rows);
  const W = `facts ? 'conv' AND (facts->'conv'->>'at')::timestamptz >= now() - ($1 || ' days')::interval`;
  const [tot, byCh, byDealer, byStaff] = await Promise.all([
    q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE facts->'conv'->>'how' = 'sda_account')::int AS ocu, count(*) FILTER (WHERE facts->'conv'->>'how' = 'contacted')::int AS contacted,
         count(*) FILTER (WHERE facts->'conv'->>'how' = 'own')::int AS own, count(*) FILTER (WHERE facts->'conv'->>'status_before' NOT IN ('${S.OPEN.join("','")}','won'))::int AS after_close,
         count(*) FILTER (WHERE facts->'conv'->>'channel' = 'sda')::int AS sda FROM fixed_leads WHERE ${W}`, [String(d)]),
    q(`SELECT facts->'conv'->>'channel' AS channel, count(*)::int AS n FROM fixed_leads WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`, [String(d)]),
    q(`SELECT facts->'conv'->'dealer'->>'code' AS code, max(facts->'conv'->'dealer'->>'name') AS name, count(*)::int AS n,
         count(*) FILTER (WHERE facts->'conv'->>'how' IN ('contacted','sda_account'))::int AS after_call, count(*) FILTER (WHERE facts->'conv'->>'status_before' NOT IN ('${S.OPEN.join("','")}','won'))::int AS after_close
       FROM fixed_leads WHERE ${W} AND facts->'conv'->'dealer'->>'code' IS NOT NULL GROUP BY 1 ORDER BY 3 DESC LIMIT 15`, [String(d)]),
    q(`SELECT coalesce(facts->'conv'->'staff'->>'code', facts->'conv'->'staff'->>'id') AS code, max(facts->'conv'->'staff'->>'name') AS name, max(facts->'conv'->'dealer'->>'code') AS dealer,
         max(facts->'conv'->>'ocu') AS ocu, count(*)::int AS n FROM fixed_leads WHERE ${W} AND facts->'conv'->'staff' IS NOT NULL AND facts->'conv'->'staff' <> 'null'::jsonb GROUP BY 1 ORDER BY 5 DESC LIMIT 15`, [String(d)]),
  ]);
  return { days: d, total: tot[0] || {}, byChannel: byCh, byDealer, byStaff };
}
function status() { return { nexusStaff: nxStaff, nexusUsers: nxUsers }; }

module.exports = { sync, report, status, channelOf, productOf };
