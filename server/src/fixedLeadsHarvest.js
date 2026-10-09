/* fixedLeadsHarvest.js — where the OCU leads come from (Fixed › Leads, 9 Oct 2026). Runs in the console process every
 * LEADS_HARVEST_MIN (15) minutes, single-flight; "Harvest now" in the page runs the same pass.
 *
 * SOURCES (each one can be switched off in the desk settings):
 *   1. the dealer-ops read model (sda_ops order_attempts, + the beta schema when set) — every Fixed journey, all channels.
 *      A journey is a lead when it did not finish: started more than minAgeHours ago, not COMPLETED, its nexus row expired
 *      (nexus wins over the read model, which never learns about expiry). FTTH and 5G; e-purchase (web), Salam Home app
 *      (nexus channel PULSE), SDA dealer journeys; QR-code journeys (a dealer's referral) are left to the dealer by default,
 *      as the Fixed backend's own leads mail does. Promoter journeys are taken from the nexus `leads` table instead (2).
 *      nexus is read by primary key only (`workflow_states.id = ANY(…)`, 200 at a time): the customer block of the context
 *      gives the masks and the hashes; nothing readable is stored.
 *   2. nexus `leads` — the SDA promoter leads: REJECTED by the dealer (with the dealer's reason) and NEW ones nobody picked
 *      up in staleLeadDays. COMPLETED ones count as an order of that person.
 *   3. DashPro (optional, DASHPRO_DATABASE_URL, MySQL, read-only session) — the web lead table the 5G leads mail reads.
 *      Never updated: its `remmarks` column belongs to that mail.
 *   4. batches imported by a supervisor (fixedLeads.js) — the customers who rejected the installation, campaign lists.
 * ONE OPEN LEAD PER PERSON: a new stopped journey of someone who already has an open lead is added to that lead's timeline.
 * A person who ordered after the attempt (any channel the read model sees) is not a lead.
 * WON BY ITSELF: when a journey of a person with an open lead completes, the lead is closed as Won — credited to the member
 * whose SDA account placed it (desk staffCodes, OCU_001 …), else to the member who contacted the customer within
 * attributionDays before the order, else to nobody ("ordered on their own"). */
'use strict';
const db = require('./db');
const S = require('./fixedLeadsStore');

const C = S.C;
const log = (...a) => console.log('[leads]', ...a);
let J = null; try { J = require('./fixedJourney'); } catch (_) {}
const isDone = step => J ? J.isDone(step) : /ReviewOrder$|^reviewOrder$/.test(String(step || ''));
const stepLabel = (step, wf) => J ? J.stepLabel(step, wf) : String(step || '');

function productOf(wf, planId, plan) {
  const w = String(wf || ''), p = String(planId || '') + ' ' + String(plan || '');
  if (/^salamHome/i.test(w) || /^promoters$/i.test(w)) return null;          // manage-line journeys (existing customers) · promoter capture
  if (/5g|fiveG/i.test(w) || /\b5g/i.test(p)) return '5g';
  if (/ftth|fttb|fiber/i.test(w) || /fiber|ftth/i.test(p)) return 'ftth';
  if (!w) { const c = S.planOf(planId); if (c) return /^5g/.test(c[2]) ? '5g' : 'ftth'; }   // promoter leads: the plan id says it (alpha.168)
  return null;
}
function sourceOf(channel, nexusChannel, referral) {
  const nc = String(nexusChannel || '').toUpperCase(), c = String(channel || '').toLowerCase();
  if (referral) return 'qr';
  if (nc === 'PULSE' || c === 'salamhome') return 'salamhome';
  if (nc === 'SDA' || c === 'sda') return 'sda';
  return 'epurchase';
}
/* the names in a customer block: Yakeen's (individuals; English and Arabic), else other keys and a business's registered name */
function pickNames(c) {
  if (!c || typeof c !== 'object') return null;
  const s = v => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  const en = [s(c.englishFirstName), s(c.englishLastName)].filter(Boolean).join(' ') || s(c.englishFullName) || s(c.fullName) || s(c.customerName) || s(c.name) || s(c.crName) || s(c.companyName);
  const ar = [s(c.firstName) || s(c.first_name), s(c.lastName) || s(c.last_name) || s(c.familyName)].filter(Boolean).join(' ');
  return en || ar ? { en: en || null, ar: ar && ar !== en ? ar : null } : null;
}
const nameOf = c => { const n = pickNames(c); return n ? (n.en || n.ar) : ''; };
const byScript = (nm, from) => /[A-Za-z]/.test(nm) ? { en: nm, ar: null, from } : { en: null, ar: nm, from };
/* alpha.170 — where a customer's name is, when the journey has none. The website and the Salam Home app check the identity
 * (Yakeen) only AFTER payment (ePurchaseCustomerProfileVerification), so a customer who stopped before it left no name in the
 * journey. In order, exact person only (same national id), names only — nothing else of these records is read:
 *   1. the journey: the customer block, or the verification's stored Yakeen copy (kept even when a later step failed);
 *   2. the Salam Home / e-purchase account with this national id (nexus users);
 *   3. Salam Fixed BSS: the "does this id exist" answer the journey itself logged (api_logs salamchecknid · custName);
 *   4. Salam Mobile: the person's latest MVNO order (onboarding_orders.customer_name).
 * items: [{ key, customer, yk, nid, journey }] → Map(key → { en, ar, from: journey | account | bss | mobile }) */
let nxUsers = true, nxLogs = true;
async function namesFor(items) {
  const out = new Map(); let need = [];
  for (const it of items) { const n = pickNames(it.customer) || pickNames(it.yk); if (n) out.set(it.key, { ...n, from: 'journey' }); else need.push(it); }
  const nidsOf = list => [...new Set(list.map(i => i.nid).filter(Boolean))];
  if (need.length && db.nexus && nxUsers && nidsOf(need).length) {
    try {
      const r = await db.nexus.query(`SELECT national_id, first_name, last_name, english_first_name, english_last_name FROM users WHERE national_id = ANY($1::text[])`, [nidsOf(need)]);
      const m = new Map(r.rows.map(u => [u.national_id, pickNames({ englishFirstName: u.english_first_name, englishLastName: u.english_last_name, firstName: u.first_name, lastName: u.last_name })]));
      need = need.filter(it => { const n = it.nid && m.get(it.nid); if (n) { out.set(it.key, { ...n, from: 'account' }); return false; } return true; });
    } catch (e) { if (/permission denied|does not exist/i.test(e.message)) { nxUsers = false; log('names: nexus users not readable — ' + e.message.slice(0, 80)); } else throw e; }
  }
  if (need.length && db.nexus && nxLogs) {
    const js = [...new Set(need.map(i => i.journey).filter(Boolean))];
    for (let i = 0; i < js.length && need.length; i += 200) {
      try {
        const r = await db.nexus.query(`SELECT DISTINCT ON (workflow_state_id) workflow_state_id AS j, response FROM api_logs WHERE workflow_state_id = ANY($1::text[])
            AND endpoint ~* 'salamchecknid' AND status BETWEEN 200 AND 299 ORDER BY workflow_state_id, created_at DESC`, [js.slice(i, i + 200)]);
        const m = new Map();
        for (const x of r.rows) { let j = x.response; if (typeof j === 'string') { try { j = JSON.parse(j); } catch (_) { j = null; } }
          const nm = j && j.isExist === 'Y' && j.cust && typeof j.cust.custName === 'string' ? j.cust.custName.replace(/\s+/g, ' ').trim() : ''; if (nm) m.set(x.j, nm); }
        need = need.filter(it => { const nm = it.journey && m.get(it.journey); if (nm) { out.set(it.key, byScript(nm, 'bss')); return false; } return true; });
      } catch (e) { if (/permission denied|does not exist/i.test(e.message)) { nxLogs = false; log('names: nexus api_logs not readable — ' + e.message.slice(0, 80)); break; } else throw e; }
    }
  }
  if (need.length && db.source && nidsOf(need).length) {
    try {
      const r = await db.source.query(`SELECT DISTINCT ON (nationality_id_number) nationality_id_number AS nid, customer_name FROM onboarding_orders
          WHERE nationality_id_number = ANY($1::text[]) AND coalesce(customer_name, '') <> '' ORDER BY nationality_id_number, created_at DESC`, [nidsOf(need)]);
      const m = new Map(r.rows.map(x => [String(x.nid), String(x.customer_name).replace(/\s+/g, ' ').trim()]));
      need = need.filter(it => { const nm = it.nid && m.get(it.nid); if (nm) { out.set(it.key, byScript(nm, 'mobile')); return false; } return true; });
    } catch (e) { log('names: Salam Mobile orders not readable — ' + e.message.slice(0, 80)); }
  }
  return out;
}
/* the leads of a pass (or the backfill) that still have no name: look them up once, keep the mask and where it came from */
async function nameFill(list, stats) {
  if (!list.length) return 0;
  const got = await namesFor(list.map(x => ({ key: x.id, customer: x.customer, yk: x.yk, nid: x.nid, journey: x.journey })));
  const rows = list.map(x => { const g = got.get(x.id); return { id: x.id, mask: g ? S.maskName(g.en || g.ar) : null, nm: g ? g.from : 'none', lang: x.lang || null, bss: x.bss || (g && g.from === 'bss') ? true : null }; });
  for (let i = 0; i < rows.length; i += 1000) {
    await C().query(`UPDATE fixed_leads l SET customer_mask = coalesce(l.customer_mask, x.mask), facts = l.facts || jsonb_strip_nulls(jsonb_build_object('nm', x.nm, 'lang', x.lang, 'bss', x.bss))
      FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, mask text, nm text, lang text, bss boolean) WHERE l.id = x.id`, [JSON.stringify(rows.slice(i, i + 1000))]);
  }
  const named = rows.filter(r => r.mask).length; stats.names = (stats.names || 0) + named; return named;
}
const iso = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d.toISOString(); };

/* ------------------------------------------------------------------ harvest state */
async function getState() { try { const r = await C().query(`SELECT value FROM console_settings WHERE key='leads_harvest'`); return (r.rowCount && r.rows[0].value) || {}; } catch (_) { return {}; } }
async function setState(v) { try { await C().query(`INSERT INTO console_settings (key, value) VALUES ('leads_harvest', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(v)]); } catch (_) {} }

/* ------------------------------------------------------------------ nexus by primary key */
/* workflow_states.plan_type (PRE_PAID · POST_PAID) and period (the contract months) — in the nexus schema since the start; should a nexus
 * lack them, the reads fall back to the catalogue once and say so, they never stop the harvest (alpha.168) */
let nxPlanCols = true;
const ptCols = (a = '') => nxPlanCols ? `${a}plan_type::text AS plan_type, ${a}period::text AS period` : `NULL::text AS plan_type, NULL::text AS period`;
async function nxQuery(sqlOf, params) {
  try { return await db.nexus.query(sqlOf(), params); }
  catch (e) {
    if (nxPlanCols && /plan_type|period/.test(e.message) && /does not exist/i.test(e.message)) { nxPlanCols = false; log('nexus workflow_states has no plan_type / period — plan type from the catalogue'); return db.nexus.query(sqlOf(), params); }
    throw e;
  }
}
async function nexusRows(ids) {
  const out = new Map(); if (!db.nexus || !ids.length) return out;
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const r = await nxQuery(() => `SELECT id, workflow_id, channel::text AS channel, current_step, plan_id, ${ptCols()}, created_at, expires_at, updated_at,
        context->'customer' AS customer, context->'customerLocation' AS loc, context->>'referralCode' AS ref,
        coalesce(context->>'provider', context->'customer'->'address'->>'provider') AS provider, context->'invoice'->>'status' AS invoice,
        context->'nafath'->'customer'->>'status' AS nafath, context->>'leadId' AS lead_id, context->'order'->>'orderNbr' AS order_nbr,
        context->'storedYakeenCustomer' AS yk, context->>'customerCode' AS cust_code, user_id
      FROM workflow_states WHERE id = ANY($1::text[])`, [part]);
    for (const x of r.rows) out.set(x.id, x);
  }
  /* THE ACCOUNT BEHIND THE JOURNEY (alpha.173). Web and Salam Home app journeys are opened by a logged-in account
   * (workflow_states.user_id → nexus users): 5G HomeFi on the web stops at its FIRST step — location / stock lock, the BSS
   * number-pool issue — before the customer types a number, so 446 of 484 such journeys in 14 days had no contact (9 Oct)
   * while every one carried a user_id. The account's own phone and national id are read for journeys whose customer block
   * has no mobile; whether they may make a lead is per product (desk.accountContact). Never stored: hashes and masks only. */
  const need = [...out.values()].filter(x => x.user_id && !(x.customer && typeof x.customer === 'object' && x.customer.mobilePhone));
  if (need.length && nxUsers) {
    const uids = [...new Set(need.map(x => String(x.user_id)))];
    try {
      for (let i = 0; i < uids.length; i += 500) {
        const r = await db.nexus.query(`SELECT id, phone_number, national_id, first_name, last_name, english_first_name, english_last_name FROM users WHERE id = ANY($1::text[])`, [uids.slice(i, i + 500)]);
        const m = new Map(r.rows.map(u => [String(u.id), u]));
        for (const x of need) { const u = m.get(String(x.user_id)); if (u) x.account = u; }
      }
    } catch (e) { if (/permission denied|does not exist/i.test(e.message)) { nxUsers = false; log('accounts: nexus users not readable — ' + e.message.slice(0, 80)); } else throw e; }
  }
  return out;
}
/* MVNO side: does this person already hold Salam Mobile lines? the replica's onboarding orders by national id or contact
 * number (indexed — indexSource.js). Counts only; nothing of the answer that identifies anyone is kept. */
async function mobileRelation(nid, mobile) {
  if (!db.source || (!nid && !mobile)) return null;
  const forms = mobile ? ['0' + mobile, '966' + mobile, mobile, '+966' + mobile] : [];
  try {
    const r = await db.source.query(`SELECT count(*)::int AS orders, count(*) FILTER (WHERE activated)::int AS active, max(created_at) AS last_at
      FROM onboarding_orders WHERE ($1::text <> '' AND nationality_id_number = $1::text) OR mobile_number = ANY($2::text[])`, [nid || '', forms]);
    const x = r.rows[0] || {}; return { orders: S.n(x.orders), active: S.n(x.active), lastAt: iso(x.last_at) };
  } catch (_) { return null; }
}
async function fixedHistory(identHash, mobileHash, exceptRef, exceptLead) {
  const hs = [identHash, mobileHash].filter(Boolean); if (!hs.length) return null;
  try {
    const [j, l] = await Promise.all([
      C().query(`SELECT count(*)::int AS journeys, count(*) FILTER (WHERE completed)::int AS orders, max(completed_at) AS last_order, max(started_at) AS last_journey,
          array_remove(array_agg(DISTINCT product), NULL) AS products FROM fixed_lead_journeys WHERE (ident_hash = ANY($1) OR mobile_hash = ANY($1)) AND ref <> $2`, [hs, exceptRef || '']),
      C().query(`SELECT count(*)::int AS leads, count(*) FILTER (WHERE status = 'won')::int AS won, count(*) FILTER (WHERE status IN ('lost','dnc','unreachable'))::int AS lost,
          max(updated_at) AS last FROM fixed_leads WHERE (ident_hash = ANY($1) OR mobile_hash = ANY($1)) AND id <> $2`, [hs, Number(exceptLead) || 0]),
    ]);
    const a = j.rows[0] || {}, b = l.rows[0] || {};
    return { journeys: S.n(a.journeys), orders: S.n(a.orders), lastOrderAt: iso(a.last_order), lastJourneyAt: iso(a.last_journey), products: a.products || [],
      priorLeads: S.n(b.leads), priorWon: S.n(b.won), priorLost: S.n(b.lost) };
  } catch (_) { return null; }
}

/* ------------------------------------------------------------------ write a lead (or merge into the person's open one) */
async function openLeadOf(identHash, mobileHash) {
  const hs = [identHash, mobileHash].filter(Boolean); if (!hs.length) return null;
  const r = await C().query(`SELECT id FROM fixed_leads WHERE status = ANY($1) AND (ident_hash = ANY($2) OR mobile_hash = ANY($2)) ORDER BY occurred_at DESC LIMIT 1`, [S.OPEN, hs]);
  return r.rowCount ? r.rows[0].id : null;
}
async function insertLead(L) {
  /* the type of line and the plan type are worked out here when the caller did not (imports, DashPro) — alpha.168 */
  if (!L.svc_type) L.svc_type = S.svcType(L.workflow, L.plan_id, L.plan_label, L.product);
  if (L.plan_type === undefined) { const t = S.planTypeOf(null, L.plan_id, L.plan_label); L.plan_type = t.v; L.facts = { ...(L.facts || {}), pt: t.src || 'none' }; }
  const cols = ['source', 'source_ref', 'product', 'workflow', 'plan_id', 'plan_label', 'svc_type', 'plan_type', 'channel', 'dealer', 'region', 'city', 'step', 'step_label', 'reason', 'reason_class',
    'customer_mask', 'mobile_mask', 'nid_mask', 'nid_kind', 'ident_hash', 'mobile_hash', 'pii_enc', 'has_mobile', 'relation', 'facts', 'occurred_at', 'stopped_at', 'batch_id', 'status', 'assignee', 'assigned_at', 'assigned_by'];
  const vals = cols.map(c => (c === 'relation' || c === 'facts') ? JSON.stringify(L[c] || {}) : (L[c] === undefined ? null : L[c]));
  if (vals[cols.indexOf('status')] == null) vals[cols.indexOf('status')] = 'new';
  if (vals[cols.indexOf('has_mobile')] == null) vals[cols.indexOf('has_mobile')] = true;
  const r = await C().query(`INSERT INTO fixed_leads (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT (source, source_ref) DO NOTHING RETURNING id`, vals);
  return r.rowCount ? r.rows[0].id : null;
}
async function recordJourney(j) {
  try {
    const r = await C().query(`INSERT INTO fixed_lead_journeys (ref, source, product, ident_hash, mobile_hash, started_at, completed, completed_at, order_ref, staff_code, step, lead_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (ref) DO UPDATE SET completed = fixed_lead_journeys.completed OR EXCLUDED.completed, completed_at = coalesce(fixed_lead_journeys.completed_at, EXCLUDED.completed_at),
        order_ref = coalesce(EXCLUDED.order_ref, fixed_lead_journeys.order_ref), ident_hash = coalesce(fixed_lead_journeys.ident_hash, EXCLUDED.ident_hash),
        mobile_hash = coalesce(fixed_lead_journeys.mobile_hash, EXCLUDED.mobile_hash), lead_id = coalesce(fixed_lead_journeys.lead_id, EXCLUDED.lead_id)
      RETURNING (xmax = 0) AS inserted`, [j.ref, j.source || null, j.product || null, j.ident_hash || null, j.mobile_hash || null, j.started_at || null, !!j.completed, j.completed_at || null,
        j.order_ref || null, j.staff_code || null, j.step || null, j.lead_id || null]);
    return r.rows[0] || {};
  } catch (_) { return {}; }
}
const memberOfStaff = (desk, code) => { if (!code) return null; const c = String(code).toUpperCase(); const hit = Object.entries(desk.staffCodes || {}).find(([, v]) => String(v || '').toUpperCase() === c); return hit ? hit[0] : null; };

/* an order by a person with open leads closes them as Won (see the header for who is credited) */
async function resolveWins(comp, desk, stats) {
  const hs = [comp.ident_hash, comp.mobile_hash].filter(Boolean); if (!hs.length) return;
  const r = await C().query(`SELECT id, assignee, last_contact_at, occurred_at FROM fixed_leads WHERE status = ANY($1) AND (ident_hash = ANY($2) OR mobile_hash = ANY($2)) AND occurred_at <= $3 AND source_ref <> $4`,
    [S.OPEN, hs, comp.at, comp.ref]);
  for (const L of r.rows) {
    let by = null, how = 'self';
    const m = memberOfStaff(desk, comp.staff_code);
    const at = Date.parse(comp.at), lc = L.last_contact_at ? Date.parse(L.last_contact_at) : 0;
    if (m) { by = m; how = 'sda_account'; }
    else if (L.assignee && lc && at >= lc - 3600e3 && at - lc <= S.n(desk.attributionDays) * 864e5) { by = L.assignee; how = 'contacted'; }
    const u = await C().query(`UPDATE fixed_leads SET status='won', won_at=$2, won_ref=$3, won_auto=true, won_by=$4, closed_at=now(), next_action_at=NULL, updated_at=now() WHERE id=$1 AND status = ANY($5) RETURNING id`,
      [L.id, comp.at, comp.order || comp.ref, by, S.OPEN]);
    if (!u.rowCount) continue;
    stats.won_auto = (stats.won_auto || 0) + 1; if (by) stats.credited = (stats.credited || 0) + 1;
    await S.event(L.id, by || 'system', 'won', { auto: true, how, ref: comp.order || comp.ref, product: comp.product, source: comp.source, staff: comp.staff_code || null }, by ? S.n(desk.points.won) : 0);
  }
}

/* ------------------------------------------------------------------ 1. the read model + nexus */
async function fromReadModel(desk, st, stats) {
  const pools = [['ops', db.ops], ['opsBeta', db.opsBeta]].filter(x => x[1]);
  if (!pools.length) { stats.notes.push('no read model configured (OPS_DATABASE_URL)'); return; }
  const now = Date.now(), minAge = Math.max(1, S.n(desk.minAgeHours) || 3) * 3600e3, look = Math.max(1, S.n(desk.lookbackDays) || 30) * 864e5;
  /* where a pass starts: after the last one, re-reading the last 26 h (journeys still running then, orders placed since) — except while
   * catching up (the previous pass hit the row limit): then exactly where it stopped. Without that, a window holding more journeys
   * than the limit is re-read from its first row on every pass and the newest journeys are never reached (alpha.167) */
  let from = st.cursor ? (st.behind ? Date.parse(st.cursor) : Math.min(Date.parse(st.cursor), now - 26 * 3600e3)) : now - look; from = Math.max(from, now - look);
  const to = now - minAge, LIMIT = Math.max(200, Number(process.env.LEADS_HARVEST_ROWS) || 5000);
  const leadAge = Math.max(1, S.n(desk.leadMaxAgeDays) || 14) * 864e5;   // older journeys: the person's history only, no new lead
  const byId = new Map(); let hitAt = null;
  const ATT = `SELECT a.id, a.workflow::text AS workflow, a.plan, a.plan_id, a.channel::text AS channel, a.referral_code, a.outcome::text AS outcome, a.step_reached,
          a.last_error_category, a.started_at, a.completed_at, a.region, a.customer_id, a.nafath_outcome, a.dealer_validation, a.order_number, d.staff_code, d.dealer_code
        FROM order_attempts a LEFT JOIN dealers d ON d.id = a.dealer_id`;
  for (const [name, pool] of pools) {
    try {
      const r = await pool.query(`${ATT}
        WHERE a.started_at >= $1 AND a.started_at < $2 ORDER BY a.started_at LIMIT $3`, [new Date(from), new Date(to), LIMIT]);
      let last = null;
      for (const x of r.rows) { if (!byId.has(x.id)) byId.set(x.id, x); const t = Date.parse(x.started_at); if (!last || t > last) last = t; }
      if (r.rows.length >= LIMIT && last) hitAt = hitAt == null ? last : Math.min(hitAt, last);   // cut short: the next pass resumes at its last row
    } catch (e) { stats.errors.push(`${name}: ${e.message.slice(0, 140)}`); }
  }
  st.behind = hitAt != null; st.cursor = new Date(st.behind ? hitAt : to).toISOString();
  if (st.behind) stats.behind = true;
  /* RE-CHECK (alpha.173): journeys recorded earlier with no contact, for a product whose logged-in account may give one
   * (desk.accountContact), are read again — 1,500 a pass, each at most every 6 h, inside the lead window — so the accounts
   * behind the 5G journeys that stopped at the location step become leads too. seen_at marks the last re-check. */
  const recheck = new Set();
  const accProds = Object.keys(desk.accountContact || {}).filter(k => desk.accountContact[k] && desk.products[k]);
  if (accProds.length && db.nexus) {
    try {
      const rr = (await C().query(`SELECT ref FROM fixed_lead_journeys WHERE lead_id IS NULL AND mobile_hash IS NULL AND NOT completed AND product = ANY($1::text[])
          AND started_at >= $2 AND started_at < $3 AND seen_at < now() - interval '6 hours' ORDER BY started_at DESC LIMIT 1500`, [accProds, new Date(now - leadAge), new Date(to)])).rows.map(r => r.ref).filter(id => !byId.has(id));
      if (rr.length) {
        for (const [name, pool] of pools) {
          try { const r = await pool.query(`${ATT} WHERE a.id = ANY($1::text[])`, [rr]); for (const x of r.rows) if (!byId.has(x.id)) { byId.set(x.id, x); recheck.add(x.id); } }
          catch (e) { stats.errors.push(`${name} recheck: ${e.message.slice(0, 140)}`); }
        }
        await C().query(`UPDATE fixed_lead_journeys SET seen_at = now() WHERE ref = ANY($1::text[])`, [rr]);
        stats.rechecked = recheck.size;
      }
    } catch (e) { stats.errors.push('recheck: ' + e.message.slice(0, 140)); }
  }
  const rows = [...byId.values()]; stats.scanned += rows.length; if (!rows.length) return;
  /* journeys already handled are skipped — except one that has completed since */
  const known = new Map();
  for (let i = 0; i < rows.length; i += 1000) {
    const r = await C().query(`SELECT ref, completed FROM fixed_lead_journeys WHERE ref = ANY($1::text[])`, [rows.slice(i, i + 1000).map(x => x.id)]);
    for (const k of r.rows) known.set(k.ref, k.completed);
  }
  const todo = rows.filter(x => { if (recheck.has(x.id)) return true; const k = known.get(x.id); if (k === undefined) return true; if (k) return false; return x.outcome === 'COMPLETED'; });
  if (!todo.length) return;
  const nx = await nexusRows(todo.map(x => x.id)).catch(e => { stats.errors.push('nexus: ' + e.message.slice(0, 140)); return new Map(); });
  const fresh = [], noName = [];
  for (const a of todo) {
    const x = nx.get(a.id) || null;
    const wf = (x && x.workflow_id) || a.workflow, planId = (x && x.plan_id) || a.plan_id;
    const product = productOf(wf, planId, a.plan);
    const cust = (x && x.customer && typeof x.customer === 'object') ? x.customer : {};
    /* the logged-in account when the journey itself has no number (alpha.173) — only for the products the desk allows */
    const acct = x && x.account && product && (desk.accountContact || {})[product] ? x.account : null;
    const accMob = acct && !S.normMobile(cust.mobilePhone) ? S.normMobile(acct.phone_number) : null;
    const nid = S.normNid(cust.id || a.customer_id || (acct && acct.national_id)), mob = S.normMobile(cust.mobilePhone) || accMob;
    const accName = acct ? nameOf({ englishFirstName: acct.english_first_name, englishLastName: acct.english_last_name, firstName: acct.first_name, lastName: acct.last_name }) : '';
    const idn = S.identity({ name: nameOf(cust) || nameOf(x && x.yk) || accName, mobile: mob, nid });
    const referral = (x && x.ref) || a.referral_code;
    const source = sourceOf(a.channel, x && x.channel, referral);
    const completed = a.outcome === 'COMPLETED' || (x && isDone(x.current_step));
    if (!completed && x && x.expires_at && Date.parse(x.expires_at) > now) { stats.skip.running = (stats.skip.running || 0) + 1; continue; }   // still being bought — next pass
    const jr = { ref: a.id, source, product, ident_hash: idn.ident_hash, mobile_hash: idn.mobile_hash, started_at: a.started_at, step: (x && x.current_step) || a.step_reached,
      staff_code: a.staff_code || null, completed, completed_at: completed ? (a.completed_at || (x && x.updated_at) || a.started_at) : null, order_ref: a.order_number || (x && x.order_nbr !== '11223344' ? x.order_nbr : null) || null };
    if (completed) {
      await recordJourney(jr); stats.completions++;
      await resolveWins({ ref: a.id, at: iso(jr.completed_at), ident_hash: idn.ident_hash, mobile_hash: idn.mobile_hash, order: jr.order_ref, staff_code: a.staff_code, product, source }, desk, stats);
      continue;
    }
    const skip = why => { stats.skip[why] = (stats.skip[why] || 0) + 1; return recordJourney(jr); };
    if (!product) { await skip('not_acquisition'); continue; }
    if (!desk.products[product]) { await skip('product_off'); continue; }
    if (source === 'qr' && !desk.sources.qr) { await skip('qr_dealer'); continue; }
    if (source !== 'qr' && desk.sources[source] === false) { await skip('source_off'); continue; }
    if (!idn.has_mobile) { await skip('no_contact'); continue; }
    /* bought anyway: an order by the same person after this attempt */
    const hs = [idn.ident_hash, idn.mobile_hash].filter(Boolean);
    if (hs.length) {
      const b = await C().query(`SELECT 1 FROM fixed_lead_journeys WHERE completed AND (ident_hash = ANY($1) OR mobile_hash = ANY($1)) AND coalesce(completed_at, started_at) >= $2 LIMIT 1`, [hs, a.started_at]);
      if (b.rowCount) { await skip('ordered_later'); continue; }
    }
    const why = S.classify({ step: jr.step, err: a.last_error_category, invoice: x && x.invoice, nafath: (x && x.nafath) || a.nafath_outcome, dealerValidation: a.dealer_validation });
    const open = await openLeadOf(idn.ident_hash, idn.mobile_hash);
    if (open) {
      jr.lead_id = open; await recordJourney(jr); stats.merged++;
      await S.event(open, 'system', 'attempt', { source, product, plan: S.planLabel(planId, a.plan, product), step: stepLabel(jr.step, wf), reason: why.text, at: iso(a.started_at) });
      await C().query(`UPDATE fixed_leads SET facts = jsonb_set(facts, '{attempts}', to_jsonb(coalesce((facts->>'attempts')::int, 1) + 1)), updated_at = now() WHERE id = $1`, [open]).catch(() => {});
      continue;
    }
    if (now - Date.parse(a.started_at) > leadAge) { await skip('too_old'); continue; }
    const label = S.planLabel(planId, a.plan, product), pt = S.planTypeOf(x && x.plan_type, planId, label);
    const L = { source, source_ref: a.id, product, workflow: wf, plan_id: planId, plan_label: label, svc_type: S.svcType(wf, planId, label, product), plan_type: pt.v, channel: source,
      dealer: source === 'sda' ? (a.dealer_code || a.staff_code || null) : referral || null, region: a.region || null, city: (cust.address && cust.address.city) || null,
      step: jr.step, step_label: stepLabel(jr.step, wf), reason: why.text, reason_class: why.cls, ...idn,
      facts: { attempts: 1, ...(accMob ? { contact: 'account' } : {}), invoice: (x && x.invoice) || null, nafath: (x && x.nafath) || a.nafath_outcome || null, provider: (x && x.provider) || null, error: a.last_error_category || null,
        journey: a.id, workflow: wf, expired_at: iso(x && x.expires_at), staff: a.staff_code || null, pt: x ? 'nexus' : (pt.src || 'none'), period: (x && x.period) ? String(x.period).slice(0, 4) : null,
        lang: ['ar', 'en'].includes(cust.language) ? cust.language : null, bss: x && x.cust_code ? true : null, nm: idn.customer_mask ? (nameOf(cust) || nameOf(x && x.yk) ? 'journey' : 'account') : null },
      occurred_at: a.started_at, stopped_at: (x && x.expires_at) || null };
    delete L.has_mobile; L.has_mobile = true;
    const id = await insertLead(L);
    jr.lead_id = id; await recordJourney(jr);
    if (id) { stats.created++; fresh.push({ id, nid, mob, idn, ref: a.id }); if (!idn.customer_mask) noName.push({ id, journey: a.id, customer: cust, yk: x && x.yk, nid }); }
  }
  await enrich(fresh, stats);
  await nameFill(noName, stats).catch(e => stats.errors.push('names: ' + e.message.slice(0, 140)));
}
/* customer relationship on the new leads: MVNO lines (counts) + what the console saw of this person on the Fixed side */
async function enrich(fresh, stats) {
  for (const f of fresh.slice(0, 400)) {
    const [mob, fx] = await Promise.all([mobileRelation(f.nid, f.mob), fixedHistory(f.idn.ident_hash, f.idn.mobile_hash, f.ref, f.id)]);
    const rel = { mobile: mob, fixed: fx, checkedAt: new Date().toISOString() };
    rel.salam = mob && mob.active ? 'mobile' : fx && fx.orders ? 'fixed' : (mob || fx) ? 'none' : 'unknown';
    await C().query(`UPDATE fixed_leads SET relation = $2 WHERE id = $1`, [f.id, JSON.stringify(rel)]).catch(() => {});
    await S.event(f.id, 'system', 'created', { source: 'harvest' });
    stats.enriched = (stats.enriched || 0) + 1;
  }
}

/* ------------------------------------------------------------------ 2. nexus promoter leads */
async function fromPromoterLeads(desk, st, stats) {
  if (!db.nexus) return;
  const now = Date.now(), look = Math.max(1, S.n(desk.lookbackDays) || 30) * 864e5, leadAge = Math.max(1, S.n(desk.leadMaxAgeDays) || 14) * 864e5;
  const stale = Math.max(1, S.n(desk.staleLeadDays) || 3) * 864e5, LIMIT = 3000;
  /* nexus `leads` (prod, 9 Oct 2026): id, customer_id, staff_id, dealer_code, status (NEW · INPROGRESS · REJECTED · COMPLETED), "leadWorkflowId",
   * created_at, updated_at, rejected_by, reason — about 53 000 rows, nearly all NEW (a promoter's capture nobody updates) */
  const SEL = () => `SELECT l.id, l.customer_id, l.dealer_code, l.status::text AS status, l.reason, l."leadWorkflowId" AS lead_workflow_id, l.created_at, l.updated_at,
        w.plan_id, ${ptCols('w.')}, w.workflow_id, w.context->'customer' AS customer, w.context->'storedYakeenCustomer' AS yk, w.context->>'customerCode' AS cust_code
      FROM leads l LEFT JOIN workflow_states w ON w.id = l."leadWorkflowId"`;
  const notReadable = e => { if (/does not exist|permission denied/i.test(e.message)) { stats.notes.push('nexus leads table not readable: ' + e.message.slice(0, 80)); return true; } return false; };
  /* 1. what changed since the last pass: rejected by the dealer (a lead) or completed (an order). A pass cut short continues at its last row. */
  let from = st.promoCursor ? (st.promoBehind ? Date.parse(st.promoCursor) : Math.min(Date.parse(st.promoCursor), now - 26 * 3600e3)) : now - look; from = Math.max(from, now - look);
  let rows;
  try { rows = (await nxQuery(() => `${SEL()} WHERE l.updated_at >= $1 AND l.status::text IN ('REJECTED','COMPLETED') ORDER BY l.updated_at LIMIT ${LIMIT}`, [new Date(from)])).rows; }
  catch (e) { if (notReadable(e)) return; throw e; }
  const lastUpd = rows.length ? Date.parse(rows[rows.length - 1].updated_at) : null;
  st.promoBehind = rows.length >= LIMIT && !!lastUpd; st.promoCursor = new Date(st.promoBehind ? lastUpd : now).toISOString();
  /* 2. optional (Settings, off by default): promoter leads still NEW after staleLeadDays — nobody picked them up. Their own cursor on
   * created_at: a NEW row is never updated, so the change reader above would never see it turn stale. */
  if (desk.promoterNew) {
    const until = now - stale; let f2 = Math.max(st.staleCursor ? Date.parse(st.staleCursor) : 0, now - leadAge);
    if (f2 < until) {
      let r2 = [];
      try { r2 = (await nxQuery(() => `${SEL()} WHERE l.status::text = 'NEW' AND l.created_at >= $1 AND l.created_at < $2 ORDER BY l.created_at LIMIT 1000`, [new Date(f2), new Date(until)])).rows; }
      catch (e) { if (!notReadable(e)) stats.errors.push('promoter NEW: ' + e.message.slice(0, 140)); }
      st.staleCursor = new Date(r2.length >= 1000 ? Date.parse(r2[r2.length - 1].created_at) : until).toISOString();
      rows = rows.concat(r2);
    }
  }
  const fresh = [], noName = [];
  for (const l of rows) {
    stats.promoter_scanned = (stats.promoter_scanned || 0) + 1;
    const cust = (l.customer && typeof l.customer === 'object') ? l.customer : {};
    const nid = S.normNid(cust.id || l.customer_id), mob = S.normMobile(cust.mobilePhone);
    const idn = S.identity({ name: nameOf(cust) || nameOf(l.yk), mobile: mob, nid });
    const product = productOf(l.workflow_id === 'promoters' ? '' : l.workflow_id, l.plan_id) || 'ftth';
    const ref = 'L' + l.id;
    if (l.status === 'COMPLETED') {
      const k = await recordJourney({ ref, source: 'sda_promoter', product, ident_hash: idn.ident_hash, mobile_hash: idn.mobile_hash, started_at: l.created_at, completed: true, completed_at: l.updated_at });
      if (k.inserted !== false) await resolveWins({ ref, at: iso(l.updated_at), ident_hash: idn.ident_hash, mobile_hash: idn.mobile_hash, order: null, staff_code: null, product, source: 'sda_promoter' }, desk, stats);
      continue;
    }
    let kind = null;
    if (l.status === 'REJECTED') kind = 'lead_rejected';
    else if (l.status === 'NEW' && now - Date.parse(l.created_at) > stale) kind = 'lead_stale';
    if (!kind) continue;
    const skip = why => { stats.skip[why] = (stats.skip[why] || 0) + 1; };
    if (!desk.products[product]) { skip('product_off'); continue; }
    if (!idn.has_mobile) { skip('no_contact'); continue; }
    /* a rejected lead counts from the rejection, a stale one from its capture */
    if (now - Date.parse(kind === 'lead_rejected' ? l.updated_at : l.created_at) > leadAge) { skip('too_old'); continue; }
    const exists = await C().query(`SELECT 1 FROM fixed_leads WHERE source = 'sda_promoter' AND source_ref = $1`, [ref]);
    if (exists.rowCount) continue;
    const hs = [idn.ident_hash, idn.mobile_hash].filter(Boolean);
    if (hs.length) {
      const b = await C().query(`SELECT 1 FROM fixed_lead_journeys WHERE completed AND (ident_hash = ANY($1) OR mobile_hash = ANY($1)) AND coalesce(completed_at, started_at) >= $2 LIMIT 1`, [hs, l.created_at]).catch(() => ({ rowCount: 0 }));
      if (b.rowCount) { skip('ordered_later'); continue; }
    }
    const why = S.classify({ kind });
    const open = await openLeadOf(idn.ident_hash, idn.mobile_hash);
    if (open) { await S.event(open, 'system', 'attempt', { source: 'sda_promoter', product, reason: why.text + (l.reason ? ' — ' + String(l.reason).slice(0, 160) : ''), at: iso(l.created_at) }); stats.merged++; continue; }
    const label = S.planLabel(l.plan_id, null, product), pt = S.planTypeOf(l.plan_type, l.plan_id, label);
    const id = await insertLead({ source: 'sda_promoter', source_ref: ref, product, workflow: 'promoters', plan_id: l.plan_id, plan_label: label, svc_type: S.svcType(l.workflow_id, l.plan_id, label, product), plan_type: pt.v, channel: 'sda',
      dealer: l.dealer_code || null, step: null, step_label: l.status === 'REJECTED' ? 'Rejected by the dealer' : 'Never picked up', reason: why.text + (l.reason ? ' — ' + String(l.reason).slice(0, 160) : ''),
      reason_class: why.cls, ...idn, facts: { promoterLead: l.id, leadStatus: l.status, dealerReason: l.reason ? String(l.reason).slice(0, 300) : null, journey: l.lead_workflow_id || null,
        pt: l.plan_type ? 'nexus' : (pt.src || 'none'), period: l.period ? String(l.period).slice(0, 4) : null,
        lang: ['ar', 'en'].includes(cust.language) ? cust.language : null, bss: l.cust_code ? true : null, nm: idn.customer_mask ? 'journey' : null },
      occurred_at: l.created_at, stopped_at: l.updated_at });
    if (id) { stats.created++; stats.promoter = (stats.promoter || 0) + 1; fresh.push({ id, nid, mob, idn, ref }); if (!idn.customer_mask) noName.push({ id, journey: l.lead_workflow_id, customer: cust, yk: l.yk, nid }); }
  }
  await enrich(fresh, stats);
  await nameFill(noName, stats).catch(e => stats.errors.push('names: ' + e.message.slice(0, 140)));
}

/* ------------------------------------------------------------------ 3. DashPro (optional, read-only) */
let dash = null;
function dashPool() {
  if (dash !== null) return dash;
  const url = String(process.env.DASHPRO_DATABASE_URL || '').trim(); if (!url) { dash = false; return dash; }
  try {
    const mysql = require('mysql2/promise');
    dash = mysql.createPool({ uri: url, connectionLimit: 2, connectTimeout: 10000, dateStrings: false });
    dash.pool.on('connection', c => { try { c.query('SET SESSION TRANSACTION READ ONLY'); } catch (_) {} });
  } catch (e) { log('dashpro pool', e.message); dash = false; }
  return dash;
}
const dashConfigured = () => !!String(process.env.DASHPRO_DATABASE_URL || '').trim();
async function dashRow(id) { const p = dashPool(); if (!p) return null; const [r] = await p.query('SELECT id, fname, lname, mobile_number, email FROM dashpro_leads_data WHERE id = ? LIMIT 1', [id]); return r[0] || null; }
async function fromDashpro(desk, st, stats) {
  const p = dashPool(); if (!p) return;
  const now = Date.now(), look = Math.max(1, S.n(desk.lookbackDays) || 30) * 864e5;
  const from = st.dashCursor ? Math.max(Math.min(Date.parse(st.dashCursor), now - 26 * 3600e3), now - look) : now - look;
  let rows;
  try { [rows] = await p.query(`SELECT id, date_at, fname, lname, mobile_number, package, subs_type, comefrom, city_name, region_name, provider, source, utm_campaign
      FROM dashpro_leads_data WHERE date_at >= ? ORDER BY date_at LIMIT 3000`, [new Date(from)]); }
  catch (e) { stats.errors.push('dashpro: ' + e.message.slice(0, 140)); return; }
  st.dashCursor = new Date(now).toISOString();
  const fresh = [];
  for (const d of rows) {
    const ref = 'D' + d.id;
    const product = /5g/i.test(d.subs_type || d.source || d.package) ? '5g' : 'ftth';
    if (!desk.products[product]) continue;
    const exists = await C().query(`SELECT 1 FROM fixed_leads WHERE source = 'dashpro' AND source_ref = $1`, [ref]); if (exists.rowCount) continue;
    const mob = S.normMobile(d.mobile_number); const idn = S.identity({ name: [d.fname, d.lname].filter(Boolean).join(' '), mobile: mob, nid: '' });
    if (!idn.has_mobile) continue;
    const b = await C().query(`SELECT 1 FROM fixed_lead_journeys WHERE completed AND mobile_hash = $1 AND coalesce(completed_at, started_at) >= $2 LIMIT 1`, [idn.mobile_hash, d.date_at]).catch(() => ({ rowCount: 0 }));
    if (b.rowCount) { stats.skip.ordered_later = (stats.skip.ordered_later || 0) + 1; continue; }
    const open = await openLeadOf(null, idn.mobile_hash);
    if (open) { await S.event(open, 'system', 'attempt', { source: 'dashpro', product, plan: d.package || null, at: iso(d.date_at) }); stats.merged++; continue; }
    const id = await insertLead({ source: 'dashpro', source_ref: ref, product, workflow: null, plan_id: null, plan_label: S.planLabel(null, d.package, product), channel: String(d.comefrom || 'web').toLowerCase(),
      dealer: d.utm_campaign || null, region: d.region_name || null, city: d.city_name || null, step: null, step_label: 'Web lead form', reason: 'left a web lead (DashPro)', reason_class: 'abandoned',
      ...idn, facts: { dashpro: d.id, provider: d.provider || null, comefrom: d.comefrom || null }, occurred_at: d.date_at, stopped_at: null });
    if (id) { stats.created++; stats.dashpro = (stats.dashpro || 0) + 1; fresh.push({ id, nid: '', mob, idn, ref }); }
  }
  await enrich(fresh, stats);
}

/* ------------------------------------------------------------------ expiry: a lead nobody called is closed after expireDays on the desk,
 * so the pool holds customers still worth a call (lost · "Expired — never called"; a supervisor can reopen it) */
async function expire(desk, stats) {
  const days = Math.max(3, S.n(desk.expireDays) || 21);
  const r = await C().query(`UPDATE fixed_leads SET status = 'lost', lost_reason = 'Expired — never called', closed_at = now(), next_action_at = NULL, updated_at = now()
      WHERE status IN ('new','assigned') AND first_contact_at IS NULL AND next_action_at IS NULL AND created_at < now() - ($1 || ' days')::interval RETURNING id`, [String(days)]);
  for (const x of r.rows) await S.event(x.id, 'system', 'expired', { days });
  if (r.rowCount) stats.expired = r.rowCount;
}

/* ------------------------------------------------------------------ backfill (alpha.168): the plan type of each lead from its own journey in
 * nexus (workflow_states.plan_type — PRE_PAID / POST_PAID — and the contract period), once per lead; the name mask too where the first read
 * found none. By primary key, 200 at a time, at most 2,000 leads a pass (open ones first). Leads from before alpha.168 carry the catalogue's
 * plan type until then (fixedLeadsStore.normalize). */
async function backfill(stats) {
  if (!db.nexus) return;
  const r = await C().query(`SELECT id, source, source_ref, facts->>'journey' AS journey, plan_id, plan_label, customer_mask IS NULL AS no_name
      FROM fixed_leads WHERE source IN ('epurchase','salamhome','sda','qr','sda_promoter') AND coalesce(facts->>'pt','') NOT IN ('nexus','miss')
      ORDER BY (status = ANY($1)) DESC, id DESC LIMIT 2000`, [S.OPEN]);
  if (!r.rowCount) return;
  const refOf = L => L.source === 'sda_promoter' ? L.journey : L.source_ref;
  const ids = [...new Set(r.rows.map(refOf).filter(Boolean))], nx = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const q = await nxQuery(() => `SELECT id, ${ptCols()}, context->'customer' AS customer FROM workflow_states WHERE id = ANY($1::text[])`, [ids.slice(i, i + 200)]);
    for (const x of q.rows) nx.set(x.id, x);
  }
  const out = [];
  for (const L of r.rows) {
    const x = nx.get(refOf(L));
    if (!x) { out.push({ id: L.id, src: 'miss', gone: true }); continue; }
    const t = S.planTypeOf(x.plan_type, L.plan_id, L.plan_label);
    const o = { id: L.id, src: t.src === 'nexus' ? 'nexus' : 'miss', pt: t.src === 'nexus' ? t.v : null, period: x.period ? String(x.period).slice(0, 4) : null };   // miss: nexus cannot tell, the catalogue's answer stays
    if (L.no_name) { const nm = nameOf(x.customer); if (nm) o.mask = S.maskName(nm); }
    out.push(o);
  }
  for (let i = 0; i < out.length; i += 1000) {
    await C().query(`UPDATE fixed_leads l SET plan_type = coalesce(x.pt, l.plan_type), customer_mask = coalesce(l.customer_mask, x.mask),
        facts = l.facts || jsonb_strip_nulls(jsonb_build_object('pt', x.src, 'period', x.period))
      FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, src text, pt text, period text, mask text) WHERE l.id = x.id`, [JSON.stringify(out.slice(i, i + 1000))]);
  }
  stats.backfill = { leads: out.length, typed_by_nexus: out.filter(o => o.src === 'nexus').length, not_in_nexus: out.filter(o => o.gone).length, names: out.filter(o => o.mask).length };
}

/* alpha.170: every lead already on the desk, once (facts.nm): the language the customer chose and whether Salam Fixed BSS knows them
 * — and for those without a name, the look-up above. 1,000 a pass, open and nameless first. */
async function backfillNames(stats) {
  if (!db.nexus) return;
  const r = await C().query(`SELECT id, source, source_ref, facts->>'journey' AS journey, customer_mask IS NOT NULL AS named FROM fixed_leads
      WHERE source IN ('epurchase','salamhome','sda','qr','sda_promoter') AND coalesce(facts->>'nm','') = ''
      ORDER BY (status = ANY($1)) DESC, (customer_mask IS NULL) DESC, id DESC LIMIT 1000`, [S.OPEN]);
  if (!r.rowCount) return;
  const refOf = L => L.source === 'sda_promoter' ? L.journey : L.source_ref;
  const ids = [...new Set(r.rows.map(refOf).filter(Boolean))], nx = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const q = await db.nexus.query(`SELECT id, context->'customer' AS customer, context->'storedYakeenCustomer' AS yk, context->>'customerCode' AS cust_code FROM workflow_states WHERE id = ANY($1::text[])`, [ids.slice(i, i + 200)]);
    for (const x of q.rows) nx.set(x.id, x);
  }
  const named = [], nameless = [];
  for (const L of r.rows) {
    const x = nx.get(refOf(L)) || {}; const c = x.customer && typeof x.customer === 'object' ? x.customer : {};
    const e = { id: L.id, journey: refOf(L) || null, customer: c, yk: x.yk, nid: S.normNid(c.id), lang: ['ar', 'en'].includes(c.language) ? c.language : null, bss: !!x.cust_code };
    (L.named ? named : nameless).push(e);
  }
  const got = await nameFill(nameless, stats);
  if (named.length) await C().query(`UPDATE fixed_leads l SET facts = l.facts || jsonb_strip_nulls(jsonb_build_object('nm', 'journey', 'lang', x.lang, 'bss', x.bss))
      FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, lang text, bss boolean) WHERE l.id = x.id`, [JSON.stringify(named.map(e => ({ id: e.id, lang: e.lang, bss: e.bss || null })))]);
  stats.backfill_names = { leads: r.rowCount, nameless: nameless.length, named_now: got };
}

/* ------------------------------------------------------------------ the pass */
let busy = false, lastRun = null;
async function harvest({ actor } = {}) {
  if (busy) return { skipped: true, running: true }; busy = true;
  const t0 = Date.now();
  const stats = { scanned: 0, created: 0, merged: 0, completions: 0, won_auto: 0, credited: 0, skip: {}, notes: [], errors: [] };
  let run = null;
  try {
    await S.ensure();
    run = await C().query(`INSERT INTO agent_runs (agent) VALUES ('leads.harvest') RETURNING id`).then(r => r.rows[0].id).catch(() => null);
    const desk = await S.getDesk(); const st = await getState();
    if (!S.piiReady()) {   // no key, no lead: see fixedLeadsStore.deriveKey
      stats.notes.push('paused — LEADS_PII_KEY is not set on the server'); stats.paused = true; stats.ms = Date.now() - t0; st.lastRun = new Date().toISOString(); st.lastStats = stats; await setState(st);
      if (run) await C().query(`UPDATE agent_runs SET finished_at = now(), ok = true, stats = $2 WHERE id = $1`, [run, JSON.stringify(stats)]).catch(() => {});
      return stats;
    }
    await fromReadModel(desk, st, stats);
    if (desk.sources.sda_promoter) await fromPromoterLeads(desk, st, stats).catch(e => stats.errors.push('promoter leads: ' + e.message.slice(0, 140)));
    if (desk.sources.dashpro && dashConfigured()) await fromDashpro(desk, st, stats).catch(e => stats.errors.push('dashpro: ' + e.message.slice(0, 140)));
    /* conversions (alpha.174): orders completed since the last pass, by completion time, matched to the desk's leads — where,
     * which dealer / staff, credited or not (fixedLeadsConvert.js) */
    await require('./fixedLeadsConvert').sync(desk, st, stats).catch(e => stats.errors.push('conversions: ' + e.message.slice(0, 140)));
    await backfill(stats).catch(e => stats.errors.push('backfill: ' + e.message.slice(0, 140)));
    await backfillNames(stats).catch(e => stats.errors.push('names: ' + e.message.slice(0, 140)));
    await expire(desk, stats).catch(e => stats.errors.push('expire: ' + e.message.slice(0, 140)));
    /* journeys older than 400 days are no longer needed for history */
    if (Math.random() < 0.05) await C().query(`DELETE FROM fixed_lead_journeys WHERE seen_at < now() - interval '400 days'`).catch(() => {});
    stats.ms = Date.now() - t0; st.lastRun = new Date().toISOString(); st.lastStats = stats; await setState(st);
    if (run) await C().query(`UPDATE agent_runs SET finished_at = now(), ok = $2, stats = $3, error = $4 WHERE id = $1`, [run, !stats.errors.length, JSON.stringify(stats), stats.errors[0] || null]).catch(() => {});
    if (stats.created || stats.won_auto || stats.conversions || stats.errors.length) log(`harvest${actor ? ' (' + actor + ')' : ''}: ${stats.scanned} journeys · ${stats.created} new lead(s) · ${stats.merged} merged · ${stats.won_auto} won by an order · ${S.n(stats.conversions)} conversion(s) recorded of ${S.n(stats.conv_orders)} orders${stats.conv_after_close ? ' (' + stats.conv_after_close + ' after the lead was closed)' : ''}${stats.errors.length ? ' · errors: ' + stats.errors.join(' | ') : ''}`);
    return stats;
  } catch (e) {
    stats.errors.push(e.message); log('harvest failed:', e.message);
    if (run) await C().query(`UPDATE agent_runs SET finished_at = now(), ok = false, error = $2, stats = $3 WHERE id = $1`, [run, e.message, JSON.stringify(stats)]).catch(() => {});
    return stats;
  } finally { busy = false; lastRun = { at: new Date().toISOString(), stats }; }
}
function status() { return { busy, lastRun, readModel: !!db.ops, beta: !!db.opsBeta, nexus: !!db.nexus, nexusPlanType: nxPlanCols, nexusUsers: nxUsers, nexusLogs: nxLogs, mvno: !!db.source, dashpro: dashConfigured() }; }

module.exports = { harvest, status, nexusRows, dashRow, dashConfigured, productOf, sourceOf, insertLead, recordJourney, openLeadOf, resolveWins, mobileRelation, fixedHistory, getState, pickNames, namesFor };
