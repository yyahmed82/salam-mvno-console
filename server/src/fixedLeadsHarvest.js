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
  return null;
}
function sourceOf(channel, nexusChannel, referral) {
  const nc = String(nexusChannel || '').toUpperCase(), c = String(channel || '').toLowerCase();
  if (referral) return 'qr';
  if (nc === 'PULSE' || c === 'salamhome') return 'salamhome';
  if (nc === 'SDA' || c === 'sda') return 'sda';
  return 'epurchase';
}
const nameOf = c => [c.englishFirstName || c.firstName, c.englishLastName || c.lastName].filter(Boolean).join(' ');
const iso = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d.toISOString(); };

/* ------------------------------------------------------------------ harvest state */
async function getState() { try { const r = await C().query(`SELECT value FROM console_settings WHERE key='leads_harvest'`); return (r.rowCount && r.rows[0].value) || {}; } catch (_) { return {}; } }
async function setState(v) { try { await C().query(`INSERT INTO console_settings (key, value) VALUES ('leads_harvest', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(v)]); } catch (_) {} }

/* ------------------------------------------------------------------ nexus by primary key */
async function nexusRows(ids) {
  const out = new Map(); if (!db.nexus || !ids.length) return out;
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const r = await db.nexus.query(`SELECT id, workflow_id, channel::text AS channel, current_step, plan_id, created_at, expires_at, updated_at,
        context->'customer' AS customer, context->'customerLocation' AS loc, context->>'referralCode' AS ref,
        coalesce(context->>'provider', context->'customer'->'address'->>'provider') AS provider, context->'invoice'->>'status' AS invoice,
        context->'nafath'->'customer'->>'status' AS nafath, context->>'leadId' AS lead_id, context->'order'->>'orderNbr' AS order_nbr
      FROM workflow_states WHERE id = ANY($1::text[])`, [part]);
    for (const x of r.rows) out.set(x.id, x);
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
  const cols = ['source', 'source_ref', 'product', 'workflow', 'plan_id', 'plan_label', 'channel', 'dealer', 'region', 'city', 'step', 'step_label', 'reason', 'reason_class',
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
  let from = st.cursor ? Math.min(Date.parse(st.cursor), now - 26 * 3600e3) : now - look; from = Math.max(from, now - look);
  const to = now - minAge, LIMIT = Math.max(200, Number(process.env.LEADS_HARVEST_ROWS) || 3000);
  const leadAge = Math.max(1, S.n(desk.leadMaxAgeDays) || 14) * 864e5;   // older journeys: the person's history only, no new lead
  const byId = new Map(); let hit = false, lastAt = null;
  for (const [name, pool] of pools) {
    try {
      const r = await pool.query(`SELECT a.id, a.workflow::text AS workflow, a.plan, a.plan_id, a.channel::text AS channel, a.referral_code, a.outcome::text AS outcome, a.step_reached,
          a.last_error_category, a.started_at, a.completed_at, a.region, a.customer_id, a.nafath_outcome, a.dealer_validation, a.order_number, d.staff_code, d.dealer_code
        FROM order_attempts a LEFT JOIN dealers d ON d.id = a.dealer_id
        WHERE a.started_at >= $1 AND a.started_at < $2 ORDER BY a.started_at LIMIT $3`, [new Date(from), new Date(to), LIMIT]);
      if (r.rows.length >= LIMIT) hit = true;
      for (const x of r.rows) { if (!byId.has(x.id)) byId.set(x.id, x); const t = Date.parse(x.started_at); if (!lastAt || t > lastAt) lastAt = t; }
    } catch (e) { stats.errors.push(`${name}: ${e.message.slice(0, 140)}`); }
  }
  st.cursor = new Date(hit && lastAt ? lastAt : to).toISOString();
  const rows = [...byId.values()]; stats.scanned += rows.length; if (!rows.length) return;
  /* journeys already handled are skipped — except one that has completed since */
  const known = new Map();
  for (let i = 0; i < rows.length; i += 1000) {
    const r = await C().query(`SELECT ref, completed FROM fixed_lead_journeys WHERE ref = ANY($1::text[])`, [rows.slice(i, i + 1000).map(x => x.id)]);
    for (const k of r.rows) known.set(k.ref, k.completed);
  }
  const todo = rows.filter(x => { const k = known.get(x.id); if (k === undefined) return true; if (k) return false; return x.outcome === 'COMPLETED'; });
  if (!todo.length) return;
  const nx = await nexusRows(todo.map(x => x.id)).catch(e => { stats.errors.push('nexus: ' + e.message.slice(0, 140)); return new Map(); });
  const fresh = [];
  for (const a of todo) {
    const x = nx.get(a.id) || null;
    const wf = (x && x.workflow_id) || a.workflow, planId = (x && x.plan_id) || a.plan_id;
    const product = productOf(wf, planId, a.plan);
    const cust = (x && x.customer && typeof x.customer === 'object') ? x.customer : {};
    const nid = S.normNid(cust.id || a.customer_id), mob = S.normMobile(cust.mobilePhone);
    const idn = S.identity({ name: nameOf(cust), mobile: mob, nid });
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
    const L = { source, source_ref: a.id, product, workflow: wf, plan_id: planId, plan_label: S.planLabel(planId, a.plan, product), channel: source,
      dealer: source === 'sda' ? (a.dealer_code || a.staff_code || null) : referral || null, region: a.region || null, city: (cust.address && cust.address.city) || null,
      step: jr.step, step_label: stepLabel(jr.step, wf), reason: why.text, reason_class: why.cls, ...idn,
      facts: { attempts: 1, invoice: (x && x.invoice) || null, nafath: (x && x.nafath) || a.nafath_outcome || null, provider: (x && x.provider) || null, error: a.last_error_category || null,
        journey: a.id, workflow: wf, expired_at: iso(x && x.expires_at), staff: a.staff_code || null },
      occurred_at: a.started_at, stopped_at: (x && x.expires_at) || null };
    delete L.has_mobile; L.has_mobile = true;
    const id = await insertLead(L);
    jr.lead_id = id; await recordJourney(jr);
    if (id) { stats.created++; fresh.push({ id, nid, mob, idn, ref: a.id }); }
  }
  await enrich(fresh, stats);
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
  const now = Date.now(), look = Math.max(1, S.n(desk.lookbackDays) || 30) * 864e5;
  let from = st.promoCursor ? Math.min(Date.parse(st.promoCursor), now - 26 * 3600e3) : now - look; from = Math.max(from, now - look);
  let rows;
  try {
    rows = (await db.nexus.query(`SELECT l.id, l.customer_id, l.dealer_code, l.status::text AS status, l.reason, l.lead_workflow_id, l.created_at, l.updated_at,
        w.plan_id, w.workflow_id, w.context->'customer' AS customer
      FROM leads l LEFT JOIN workflow_states w ON w.id = l.lead_workflow_id WHERE l.updated_at >= $1 ORDER BY l.updated_at LIMIT 3000`, [new Date(from)])).rows;
  } catch (e) { if (/does not exist|permission denied/i.test(e.message)) { stats.notes.push('nexus leads table not readable: ' + e.message.slice(0, 80)); return; } throw e; }
  st.promoCursor = new Date(now).toISOString();
  const stale = Math.max(1, S.n(desk.staleLeadDays) || 3) * 864e5;
  const fresh = [];
  for (const l of rows) {
    stats.promoter_scanned = (stats.promoter_scanned || 0) + 1;
    const cust = (l.customer && typeof l.customer === 'object') ? l.customer : {};
    const nid = S.normNid(cust.id || l.customer_id), mob = S.normMobile(cust.mobilePhone);
    const idn = S.identity({ name: nameOf(cust), mobile: mob, nid });
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
    if (!kind || !desk.products[product] || !idn.has_mobile) continue;
    if (now - Date.parse(l.created_at) > Math.max(1, S.n(desk.leadMaxAgeDays) || 14) * 864e5) { stats.skip.too_old = (stats.skip.too_old || 0) + 1; continue; }
    const exists = await C().query(`SELECT 1 FROM fixed_leads WHERE source = 'sda_promoter' AND source_ref = $1`, [ref]);
    if (exists.rowCount) continue;
    const why = S.classify({ kind });
    const open = await openLeadOf(idn.ident_hash, idn.mobile_hash);
    if (open) { await S.event(open, 'system', 'attempt', { source: 'sda_promoter', product, reason: why.text + (l.reason ? ' — ' + String(l.reason).slice(0, 160) : ''), at: iso(l.created_at) }); stats.merged++; continue; }
    const id = await insertLead({ source: 'sda_promoter', source_ref: ref, product, workflow: 'promoters', plan_id: l.plan_id, plan_label: S.planLabel(l.plan_id, null, product), channel: 'sda',
      dealer: l.dealer_code || null, step: null, step_label: l.status === 'REJECTED' ? 'Rejected by the dealer' : 'Never picked up', reason: why.text + (l.reason ? ' — ' + String(l.reason).slice(0, 160) : ''),
      reason_class: why.cls, ...idn, facts: { promoterLead: l.id, leadStatus: l.status, dealerReason: l.reason ? String(l.reason).slice(0, 300) : null, journey: l.lead_workflow_id || null },
      occurred_at: l.created_at, stopped_at: l.updated_at });
    if (id) { stats.created++; stats.promoter = (stats.promoter || 0) + 1; fresh.push({ id, nid, mob, idn, ref }); }
  }
  await enrich(fresh, stats);
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
    await expire(desk, stats).catch(e => stats.errors.push('expire: ' + e.message.slice(0, 140)));
    /* journeys older than 400 days are no longer needed for history */
    if (Math.random() < 0.05) await C().query(`DELETE FROM fixed_lead_journeys WHERE seen_at < now() - interval '400 days'`).catch(() => {});
    stats.ms = Date.now() - t0; st.lastRun = new Date().toISOString(); st.lastStats = stats; await setState(st);
    if (run) await C().query(`UPDATE agent_runs SET finished_at = now(), ok = $2, stats = $3, error = $4 WHERE id = $1`, [run, !stats.errors.length, JSON.stringify(stats), stats.errors[0] || null]).catch(() => {});
    if (stats.created || stats.won_auto || stats.errors.length) log(`harvest${actor ? ' (' + actor + ')' : ''}: ${stats.scanned} journeys · ${stats.created} new lead(s) · ${stats.merged} merged · ${stats.won_auto} won by an order${stats.errors.length ? ' · errors: ' + stats.errors.join(' | ') : ''}`);
    return stats;
  } catch (e) {
    stats.errors.push(e.message); log('harvest failed:', e.message);
    if (run) await C().query(`UPDATE agent_runs SET finished_at = now(), ok = false, error = $2, stats = $3 WHERE id = $1`, [run, e.message, JSON.stringify(stats)]).catch(() => {});
    return stats;
  } finally { busy = false; lastRun = { at: new Date().toISOString(), stats }; }
}
function status() { return { busy, lastRun, readModel: !!db.ops, beta: !!db.opsBeta, nexus: !!db.nexus, mvno: !!db.source, dashpro: dashConfigured() }; }

module.exports = { harvest, status, nexusRows, dashRow, dashConfigured, productOf, sourceOf, insertLead, recordJourney, openLeadOf, resolveWins, mobileRelation, fixedHistory, getState };
