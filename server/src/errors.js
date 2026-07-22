/* Error Control Board + per-transaction end-to-end timeline.
 * Categorizes real failures from the replica and assembles the full story for one
 * order / mobile / ICCID / payment across payments, activation, nafath, eligibility,
 * change_plan, delivery, checkouts. */
const db = require('./db');
const plans = require('./plans');

// Error categories → owner team + the query producing recent failures.
// Each returns rows: { id, category, team, when, identifier, detail, mobile, order_id }
const CATEGORIES = {
  payment: { team: 'Digital Ops', label: 'Payment / gateway' },
  payment_stuck: { team: 'Digital Ops', label: 'Payment stuck (unconfirmed)' },
  payment_dup: { team: 'Digital Ops', label: 'Payment duplicate (suspected)' },
  change_ownership: { team: 'Digital Ops', label: 'Change Ownership' },
  activation: { team: 'Digital Ops', label: 'Activation (BSS)' },
  semati: { team: 'Digital Ops', label: 'Semati / MSISDN provisioning' },
  nafath: { team: 'Digital Ops', label: 'Nafath / identity' },
  eligibility: { team: 'Sales Ops', label: 'Eligibility' },
  change_plan: { team: 'Digital Ops', label: 'Change Plan' },
  delivery: { team: 'Digital Ops', label: 'Delivery' }
};

const DELIVERY_FAILED = ['cancelled','canceled','deleted','RTO','CANCELLED','PUX43','returned','reverseReturned','shipmentCanceled','reverseShipmentCanceled','REFUSED','onhold','pickup_failed','DEX93','RD','DEX07-3','DEX07-4','DEX07-5','DEX07-6','DEX07-7','DEX07-8','DEX93-1','DEX93-2','DEX93-3','DEX93-4','DEX07'];

/* Change Ownership (mobile-number transfer) detection. An ownership transfer is an
 * OWNERSHIP_TRANSFER Checkout (checkout_type=5); it produces (a) a change_plan_log for the new
 * owner's plan, linked to the ownership checkout via its payment, and (b) a Nafath authorize step
 * (service transfer_ownership_*). We pull BOTH out of the generic Change Plan / Nafath tiles into
 * their own category so ownership failures don't hide inside plan-change or identity failures. */
const OWNERSHIP_CPL = `EXISTS (SELECT 1 FROM payments p JOIN checkouts c ON c.id::text = p.payment_on_id
   WHERE p.id::text = change_plan_logs.payment_id AND c.checkout_type = 5)`;
const NAF_OWNERSHIP = `(service ILIKE '%transfer_ownership%' OR service ILIKE '%MobileOwnership%')`;

// UPG / salam put the real gateway code+message in payment_commit_response.gateway.response;
// hyperpay / tap instead fill fail_reason. Extract a clean code + message for the Payment
// code·message breakdown and feed filter (mirrors analytics.DECLINE_EXPR bucketing).
const PAY_CODE = `COALESCE(NULLIF(payment_commit_response#>>'{gateway,response,code}',''), NULLIF(payment_initialization_response#>>'{gateway,response,code}',''), '—')`;
const PAY_MSG  = `COALESCE(NULLIF(regexp_replace(COALESCE(payment_commit_response#>>'{gateway,response,message}', payment_initialization_response#>>'{gateway,response,message}'), ' \\([^)]*\\)$',''),''), NULLIF(fail_reason,''), '')`;

// KPI tiles: open/total-ish counts per category over a window
async function summary({ now, windowHours = 24, team, channel }) {
  const n = now ? new Date(now).toISOString() : new Date().toISOString();
  const w = windowHours;
  const out = [];
  const push = (cat, total) => { const c = CATEGORIES[cat]; if (!team || c.team === team) out.push({ category: cat, label: c.label, team: c.team, total: Number(total) }); };

  const pay = await db.source.query(`SELECT count(*) c FROM payments WHERE status IN ('fail','failed') AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz ${channel?`AND platform=$3`:''}`, channel?[n,w,channel]:[n,w]);
  push('payment', pay.rows[0].c);
  // Issue #2 — payments stuck non-terminal >30min (Tap captured but app never confirmed)
  const stuck = await db.source.query(`SELECT count(*) c FROM payments WHERE lower(status) IN ('pending','initiated') AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz - interval '30 minutes'`, [n,w]);
  push('payment_stuck', stuck.rows[0].c);
  // Issue #1 — suspected duplicate deductions (same customer+amount+target, 2+ success within 30min)
  const dup = await db.source.query(`SELECT count(*) c FROM (SELECT customer_mobile_number, amount, payment_on_type, payment_on_id FROM payments WHERE status='success' AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz GROUP BY 1,2,3,4 HAVING count(*)>1 AND (max(created_at)-min(created_at)) < interval '30 minutes') d`, [n,w]);
  push('payment_dup', dup.rows[0].c);
  // Change Ownership = ownership-linked plan-change failures + Nafath ownership-authorize failures
  const own = await db.source.query(`
    SELECT (SELECT count(*) FROM change_plan_logs WHERE status=2 AND ${OWNERSHIP_CPL}
              AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz)
         + (SELECT count(*) FROM nafath_logs WHERE lower(status) IN ('expired','rejected','failed','cancelled','denied') AND ${NAF_OWNERSHIP}
              AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz) AS c`, [n,w]);
  push('change_ownership', own.rows[0].c);
  const act = await db.source.query(`SELECT count(*) c FROM activation_logs WHERE state=false AND api NOT ILIKE '%semati%' AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w]);
  push('activation', act.rows[0].c);
  const sem = await db.source.query(`SELECT count(*) c FROM activation_logs WHERE state=false AND api ILIKE '%semati%' AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w]);
  push('semati', sem.rows[0].c);
  const naf = await db.source.query(`SELECT count(*) c FROM nafath_logs WHERE lower(status) IN ('expired','rejected','failed','cancelled','denied') AND NOT ${NAF_OWNERSHIP} AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w]);
  push('nafath', naf.rows[0].c);
  const elig = await db.source.query(`SELECT count(*) c FROM eligibility_logs WHERE state=false AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w]);
  push('eligibility', elig.rows[0].c);
  const cpl = await db.source.query(`SELECT count(*) c FROM change_plan_logs WHERE status=2 AND NOT (${OWNERSHIP_CPL}) AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w]);
  push('change_plan', cpl.rows[0].c);
  const del = await db.source.query(`SELECT count(*) c FROM delivery_requests WHERE delivery_state = ANY($3) AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w,DELIVERY_FAILED]);
  push('delivery', del.rows[0].c);
  return out.sort((a,b) => b.total - a.total);
}

// Recent error feed (rows) with optional filters + free-text identifier search.
async function feed({ now, windowHours = 24, category, team, q, limit = 100, code }) {
  const n = now ? new Date(now).toISOString() : new Date().toISOString();
  const w = windowHours;
  const like = q ? `%${q}%` : null;
  const rows = [];
  const pmap = await plans.loadMap();

  const wantCat = c => (!category || category === c) && (!team || CATEGORIES[c].team === team);

  if (wantCat('payment')) {
    const p = [n, w]; let cond = '';
    if (like) { p.push(like); cond += ` AND (customer_mobile_number ILIKE $${p.length} OR payment_on_id ILIKE $${p.length} OR id::text ILIKE $${p.length})`; }
    if (code && category === 'payment') { p.push(String(code)); cond += ` AND ${PAY_CODE} = $${p.length}`; }
    p.push(limit); const limIdx = p.length;
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, fail_reason, vendor, platform, payment_method, payment_on_type, payment_on_id,
              customer_mobile_number AS mobile, ${PAY_CODE} AS dcode, ${PAY_MSG} AS dmsg
       FROM payments WHERE status IN ('fail','failed')
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${cond}
       ORDER BY created_at DESC LIMIT $${limIdx}`, p);
    r.rows.forEach(x => rows.push({ category:'payment', team:CATEGORIES.payment.team, id:'pay:'+x.id, when:x.when,
      identifier: x.payment_on_id || x.id, mobile:x.mobile, order_id:x.payment_on_type==='OnboardingOrder'?x.payment_on_id:null,
      detail: `${x.payment_on_type} · ${x.vendor||''}${x.payment_method&&x.payment_method!=='credit-card'?' · '+x.payment_method:''} · ${x.dcode&&x.dcode!=='—'?x.dcode+' · ':''}${x.dmsg||x.fail_reason||'failed'}` }));
  }
  if (wantCat('payment_stuck')) {
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, payment_reference_id AS ref, vendor, amount, payment_on_type, payment_on_id,
              customer_mobile_number AS mobile, round(extract(epoch from ($1::timestamptz - created_at))/60)::int AS age_min
       FROM payments WHERE lower(status) IN ('pending','initiated')
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz - interval '30 minutes'
         ${like?`AND (customer_mobile_number ILIKE $3 OR payment_reference_id ILIKE $3 OR payment_on_id ILIKE $3 OR id::text ILIKE $3)`:''}
       ORDER BY created_at DESC LIMIT $${like?4:3}`, like?[n,w,like,limit]:[n,w,limit]);
    r.rows.forEach(x => rows.push({ category:'payment_stuck', team:'Digital Ops', id:'stuck:'+x.id, when:x.when,
      identifier: x.ref || x.payment_on_id || x.id, mobile:x.mobile, order_id:x.payment_on_type==='OnboardingOrder'?x.payment_on_id:null,
      detail: `${x.vendor||''} · ${x.amount} SAR · stuck ${x.age_min}m · ref ${x.ref||'—'}` }));
  }
  if (wantCat('payment_dup')) {
    const r = await db.source.query(
      `SELECT customer_mobile_number AS mobile, amount, payment_on_type, payment_on_id, count(*) c,
              min(created_at) AS when, max(vendor) AS vendor, string_agg(payment_reference_id, ', ') AS refs
       FROM payments WHERE status='success'
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${like?`AND (customer_mobile_number ILIKE $3 OR payment_on_id ILIKE $3 OR payment_reference_id ILIKE $3)`:''}
       GROUP BY 1,2,3,4 HAVING count(*)>1 AND (max(created_at)-min(created_at)) < interval '30 minutes'
       ORDER BY min(created_at) DESC LIMIT $${like?4:3}`, like?[n,w,like,limit]:[n,w,limit]);
    r.rows.forEach(x => rows.push({ category:'payment_dup', team:'Digital Ops', id:'dup:'+(x.payment_on_id||x.mobile)+':'+x.amount+':'+(x.when?new Date(x.when).getTime():''), when:x.when,
      identifier: x.mobile || x.payment_on_id, mobile:x.mobile, order_id:x.payment_on_type==='OnboardingOrder'?x.payment_on_id:null,
      detail: `${x.c}× ${x.amount} SAR · ${x.vendor||''} · refs ${x.refs}` }));
  }
  if (wantCat('activation') || wantCat('semati')) {
    // split semati vs non-semati IN SQL so a LIMIT can't bury the smaller bucket (e.g. 6 activation under ~2k semati)
    const semFilter = category === 'activation' ? `AND api NOT ILIKE '%semati%'`
                    : category === 'semati' ? `AND api ILIKE '%semati%'` : '';
    // dynamic params so the optional search (q) and Semati code filter can coexist
    const p = [n, w]; let cond = '';
    if (like) { p.push(like); cond += ` AND (msisdn ILIKE $${p.length} OR onboarding_order_id::text ILIKE $${p.length})`; }
    if (code && category === 'semati') { p.push(String(code)); cond += ` AND COALESCE(NULLIF(status_code,''), response->>'responseCode') = $${p.length}`; }
    p.push(limit); const limIdx = p.length;
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, api, status_code, msisdn, onboarding_order_id::text AS order_id, platform,
              (api ILIKE '%semati%') AS is_semati
       FROM activation_logs WHERE state=false ${semFilter}
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${cond}
       ORDER BY created_at DESC LIMIT $${limIdx}`, p);
    r.rows.forEach(x => { const cat = x.is_semati?'semati':'activation'; if(!wantCat(cat)) return;
      rows.push({ category:cat, team:CATEGORIES[cat].team, id:'act:'+x.id, when:x.when, identifier:x.msisdn||x.order_id,
        mobile:x.msisdn, order_id:x.order_id, detail:`${x.api} · ${x.status_code||''}` }); });
  }
  if (wantCat('nafath')) {
    const p = [n, w]; let cond = '';
    if (like) { p.push(like); cond += ` AND nationality_id_number ILIKE $${p.length}`; }
    if (code && category === 'nafath') { p.push(String(code)); cond += ` AND COALESCE(NULLIF(response->'response'->>'status',''), status) = $${p.length}`; }
    p.push(limit); const limIdx = p.length;
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, status, service, nationality_id_number AS nid,
              COALESCE(NULLIF(response->'response'->>'status',''), status) AS code,
              response->'response'->>'message' AS msg
       FROM nafath_logs WHERE lower(status) IN ('expired','rejected','failed','cancelled','denied') AND NOT ${NAF_OWNERSHIP}
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${cond}
       ORDER BY created_at DESC LIMIT $${limIdx}`, p);
    r.rows.forEach(x => rows.push({ category:'nafath', team:CATEGORIES.nafath.team, id:'naf:'+x.id, when:x.when,
      identifier:x.nid, nationality_id_number:x.nid, detail:`${x.service||'nafath'} · ${x.code||x.status}${x.msg?' · '+x.msg:''}` }));
  }
  if (wantCat('eligibility')) {
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, api, status_code, msisdn, onboarding_order_id::text AS order_id, process
       FROM eligibility_logs WHERE state=false
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${like?`AND (msisdn ILIKE $3 OR onboarding_order_id::text ILIKE $3)`:''}
       ORDER BY created_at DESC LIMIT $${like?4:3}`, like?[n,w,like,limit]:[n,w,limit]);
    r.rows.forEach(x => rows.push({ category:'eligibility', team:CATEGORIES.eligibility.team, id:'elig:'+x.id, when:x.when,
      identifier:x.msisdn||x.order_id, mobile:x.msisdn, order_id:x.order_id, detail:`${x.process||x.api} · ${x.status_code||'denied'}` }));
  }
  if (wantCat('change_plan')) {
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, mobile_number AS mobile, from_plan, to_plan, final_step_message
       FROM change_plan_logs WHERE status=2 AND NOT (${OWNERSHIP_CPL})
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${like?`AND mobile_number ILIKE $3`:''}
       ORDER BY created_at DESC LIMIT $${like?4:3}`, like?[n,w,like,limit]:[n,w,limit]);
    r.rows.forEach(x => rows.push({ category:'change_plan', team:CATEGORIES.change_plan.team, id:'cpl:'+x.id, when:x.when,
      identifier:x.mobile, mobile:x.mobile, detail:`${plans.label(pmap,x.from_plan)} → ${plans.label(pmap,x.to_plan)} · ${(x.final_step_message||'').slice(0,60)}` }));
  }
  if (wantCat('change_ownership')) {
    // (a) plan-change failures that belong to an ownership transfer (payment → ownership checkout type 5)
    const ra = await db.source.query(
      `SELECT id::text, created_at AS when, mobile_number AS mobile, from_plan, to_plan, final_step_message
       FROM change_plan_logs WHERE status=2 AND ${OWNERSHIP_CPL}
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${like?`AND mobile_number ILIKE $3`:''}
       ORDER BY created_at DESC LIMIT $${like?4:3}`, like?[n,w,like,limit]:[n,w,limit]);
    ra.rows.forEach(x => rows.push({ category:'change_ownership', team:CATEGORIES.change_ownership.team, id:'cpl:'+x.id, when:x.when,
      identifier:x.mobile, mobile:x.mobile, detail:`Ownership transfer · ${plans.label(pmap,x.from_plan)} → ${plans.label(pmap,x.to_plan)} · ${(x.final_step_message||'').slice(0,45)}` }));
    // (b) the Nafath ownership-authorize step failing
    const rb = await db.source.query(
      `SELECT id::text, created_at AS when, status, service, nationality_id_number AS nid
       FROM nafath_logs WHERE lower(status) IN ('expired','rejected','failed','cancelled','denied') AND ${NAF_OWNERSHIP}
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${like?`AND nationality_id_number ILIKE $3`:''}
       ORDER BY created_at DESC LIMIT $${like?4:3}`, like?[n,w,like,limit]:[n,w,limit]);
    rb.rows.forEach(x => rows.push({ category:'change_ownership', team:CATEGORIES.change_ownership.team, id:'naf:'+x.id, when:x.when,
      identifier:x.nid, nationality_id_number:x.nid, detail:`Ownership authorize · ${x.service||'nafath'} · ${x.status}` }));
  }
  if (wantCat('delivery')) {
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, vendor, delivery_state, receiver_mobile AS mobile, delivery_on_id AS order_id, external_reference_id
       FROM delivery_requests WHERE delivery_state = ANY($3)
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${like?`AND (receiver_mobile ILIKE $4 OR delivery_on_id ILIKE $4 OR external_reference_id ILIKE $4)`:''}
       ORDER BY created_at DESC LIMIT $${like?5:4}`, like?[n,w,DELIVERY_FAILED,like,limit]:[n,w,DELIVERY_FAILED,limit]);
    r.rows.forEach(x => rows.push({ category:'delivery', team:CATEGORIES.delivery.team, id:'del:'+x.id, when:x.when,
      identifier:x.external_reference_id||x.order_id, mobile:x.mobile, order_id:x.order_id, detail:`${x.vendor} · ${x.delivery_state}` }));
  }
  rows.sort((a,b) => new Date(b.when) - new Date(a.when));
  return rows.slice(0, limit);
}

// Resolve a feed row id (e.g. 'naf:123', 'pay:uuid') → a business identifier for the
// timeline, server-side, so the client never has to hold raw PII.
async function resolveRow(rowId) {
  const raw = String(rowId || '');
  const [kind, id] = raw.split(':');
  const one = async (sql, p) => (await db.source.query(sql, p)).rows[0];
  const R = (identifier, at) => ({ identifier: identifier || null, at: at || null });  // identifier + row time (anchor)
  try {
    if (kind === 'pay' || kind === 'stuck') { const r = await one(`SELECT payment_on_id, customer_mobile_number, created_at FROM payments WHERE id::text=$1`, [id]); return r ? R(r.payment_on_id || r.customer_mobile_number, r.created_at) : R(null); }
    if (kind === 'dup') return R(raw);   // dup:<key>:<amount> — handled specially by timeline()
    if (kind === 'act') { const r = await one(`SELECT onboarding_order_id::text oid, msisdn, created_at FROM activation_logs WHERE id=$1::bigint`, [id]); return r ? R(r.oid || r.msisdn, r.created_at) : R(null); }
    if (kind === 'elig') { const r = await one(`SELECT onboarding_order_id::text oid, msisdn, created_at FROM eligibility_logs WHERE id=$1::bigint`, [id]); return r ? R(r.oid || r.msisdn, r.created_at) : R(null); }
    if (kind === 'naf') { const r = await one(`SELECT nationality_id_number nid, created_at FROM nafath_logs WHERE id=$1::bigint`, [id]); return r ? R(r.nid, r.created_at) : R(null); }
    if (kind === 'cpl') { const r = await one(`SELECT mobile_number m, created_at FROM change_plan_logs WHERE id=$1::bigint`, [id]); return r ? R(r.m, r.created_at) : R(null); }
    if (kind === 'del') { const r = await one(`SELECT delivery_on_id o, receiver_mobile m, created_at FROM delivery_requests WHERE id=$1::bigint`, [id]); return r ? R(r.o || r.m, r.created_at) : R(null); }
  } catch (e) { return R(null); }
  return R(raw);
}

// Full end-to-end timeline for one identifier (order id / mobile / iccid / nid).
async function timeline({ identifier, anchorAt }) {
  const id = String(identifier || '').trim();
  if (!id) return { identifier: id, order: null, events: [] };
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
  const pmap = await plans.loadMap();
  const events = [];
  // each event carries a trace: endpoint · request · response · exec time (ms) · status
  const add = (ts, source, kind, ok, detail, tr) => events.push({ at: ts, source, kind, ok, detail,
    endpoint: (tr && tr.endpoint) || null,
    request: tr && tr.request !== undefined ? tr.request : null,
    response: tr && tr.response !== undefined ? tr.response : null,
    ms: tr && tr.ms != null ? tr.ms : null,
    status: tr && tr.status != null ? tr.status : null });
  const elapsed = (r, endField) => {
    const a = r && r.created_at, b = (endField && r && r[endField]) || (r && r.updated_at);
    return (a && b) ? Math.max(0, Math.round(new Date(b) - new Date(a))) : null;
  };
  const nonEmpty = o => (o && typeof o === 'object' && Object.keys(o).length) ? o : null;

  // ---- duplicate group drill-down: dup:<key>:<amount> → every charge attempt with full req/resp ----
  if (id.startsWith('dup:')) {
    const parts = id.split(':'); const key = parts[1]; const amt = parts[2]; const ts = Number(parts[3]) || null;
    // Scope to the actual duplicate cluster (the group is defined as 2+ charges within 30 min of each
    // other; `ts` = the group's first charge). Without this we'd list every same-amount payment ever.
    const dq = await db.source.query(
      `SELECT * FROM payments
       WHERE status = 'success' AND amount = $2::float
         AND (customer_mobile_number = $1 OR target_mobile_number = $1 OR payment_on_id = $1)
         ${ts ? `AND created_at >= to_timestamp($3/1000.0) - interval '5 minutes'
                 AND created_at <= to_timestamp($3/1000.0) + interval '35 minutes'` : ''}
       ORDER BY created_at LIMIT 12`, ts ? [key, amt, ts] : [key, amt]);
    let prev = null;
    dq.rows.forEach(p => {
      const gapSec = prev ? Math.round((new Date(p.created_at) - new Date(prev)) / 1000) : null;
      prev = p.created_at;
      add(p.created_at, 'payments', 'payment', true,
        `charge ${p.amount} SAR · ${p.vendor || ''} · ${p.status} · ref ${p.payment_reference_id || '—'}${gapSec != null ? ` · +${gapSec}s after previous` : ''}`,
        { endpoint: `payment gateway · ${p.vendor || ''}`,
          request: { amount: p.amount, vendor: p.vendor, payment_method: p.payment_method, payment_on_type: p.payment_on_type, payment_on_id: p.payment_on_id, reference: p.payment_reference_id, customer_mobile: p.customer_mobile_number, target_mobile: p.target_mobile_number },
          response: nonEmpty({ status: p.status, fail_reason: p.fail_reason, initialization: nonEmpty(p.payment_initialization_response), commit: nonEmpty(p.payment_commit_response), bss: nonEmpty(p.bss_response) }),
          ms: elapsed(p), status: p.status });
    });
    // authoritative side: pull the Tap charges for this group (app-known ids + extra captures) — inert until TAP_SECRET_KEY is set
    let tapChecked = false;
    try {
      const tap = require('./tapRecon');
      if (tap.tapConfigured()) {
        tapChecked = true;
        const chargeIds = dq.rows.map(p => tap.chargeIdFromPayment(p)).filter(Boolean);
        const references = dq.rows.map(p => p.payment_reference_id).filter(Boolean);
        const { charges } = await tap.chargesForGroup({ chargeIds, references });
        const appRefs = new Set(references);
        charges.forEach(c => {
          const at = c.created ? new Date(Number(c.created)).toISOString() : (dq.rows[0] && dq.rows[0].created_at);
          const captured = String(c.status).toUpperCase() === 'CAPTURED';
          const orphan = captured && !appRefs.has(c.reference && (c.reference.order || c.reference.transaction));  // Tap capture with no app row = the extra deduction
          add(at, 'tap', 'tap_charge', orphan ? false : null,
            `Tap ${c.status} · ${c.amount || ''} ${c.currency || ''} · ${c.id}${orphan ? ' · ⚠ no matching app row' : ''}`,
            { endpoint: 'Tap · GET /v2/charges', request: { charge_id: c.id, reference: c.reference }, response: c.raw || { status: c.status, amount: c.amount }, status: c.status });
        });
      }
    } catch (e) { /* Tap optional */ }
    events.sort((a, b) => new Date(a.at) - new Date(b.at));
    return { identifier: id, order: null, duplicate: { key, amount: Number(amt), appCharges: dq.rowCount, tapChecked }, events };
  }

  // resolve an onboarding order (by id, mobile, or nid)
  let order = null;
  const oq = await db.source.query(
    `SELECT * FROM onboarding_orders
     WHERE ${isUuid?'id = $1::uuid OR ':''} mobile_number = $1::text OR nationality_id_number = $1::text
     ORDER BY created_at DESC LIMIT 1`, [id]);
  if (oq.rowCount) order = oq.rows[0];

  // Is the clicked row a LATER servicing event (change-plan / ownership / recharge) that happened well
  // after this line was onboarded? If so, the month-old onboarding order is NOT this transaction — anchor
  // on the clicked row's own time and scope by mobile/nid, so the drawer shows THIS failure and the calls
  // around it, not the unrelated onboarding journey. (Fixes: a change-plan failure whose timeline showed
  // only the old onboarding order + payment success and "0 failed".)
  const late = !!(order && anchorAt && (new Date(anchorAt) - new Date(order.created_at) > 3 * 24 * 3600e3));
  const scopeByOrder = !!order && !late;

  if (order && !late) {
    add(order.created_at, 'onboarding_orders', 'order_created', true,
      `state=${order.aasm_state} completed=${order.completed} activated=${order.activated} · plan ${plans.label(pmap, order.plan_id)}`,
      { endpoint: 'onboarding_orders#create', request: null,
        response: { aasm_state: order.aasm_state, completed: order.completed, activated: order.activated,
          plan_id: order.plan_id, flow_type: order.flow_type, channel: order.channel }, ms: elapsed(order), status: order.aasm_state });
  }
  const orderId = scopeByOrder ? order.id : (isUuid ? id : null);
  const mobile = order ? order.mobile_number : id;
  const nid = order ? order.nationality_id_number : id;

  // Per-query timeout wrapper: the query promise always resolves (errors/timeouts → {rows:[]}),
  // so one slow table yields a PARTIAL timeline instead of hanging the drawer. No unhandled rejections.
  const qT = (sql, params, ms = 4500) => {
    const p = db.source.query(sql, params).catch(() => ({ rows: [] }));
    const t = new Promise(res => setTimeout(() => res({ rows: [] }), ms));
    return Promise.race([p, t]);
  };

  // Journey scope: when an order is resolved, tie events to THAT order (order-id links) and bracket the
  // non-order-linked lookups (nafath / change_plan) to a window around it — so the customer's LATER,
  // unrelated recharges/verifications on the same mobile/nid don't leak into this transaction's timeline.
  // anchor = the order (broad onboarding lifecycle window) OR, when no order resolves, the CLICKED row's
  // own time (tight single-transaction window) — so a change_plan / recharge case shows only its own events.
  const anchor = late ? anchorAt : (order ? order.created_at : (anchorAt || null));
  const fwdH = scopeByOrder ? 72 : 4;   // onboarding can span days; a standalone txn is minutes/hours
  const wLo = anchor ? new Date(new Date(anchor).getTime() - 2 * 3600e3).toISOString() : null;
  const wHi = anchor ? new Date(new Date(anchor).getTime() + fwdH * 3600e3).toISOString() : null;

  // All lookups below are independent once the order/mobile/nid are resolved → run them in PARALLEL.
  const tasks = [];

  // payments
  tasks.push((async () => {
    const pay = scopeByOrder
      ? await qT(`SELECT * FROM payments WHERE payment_on_id = $1 ORDER BY created_at LIMIT 50`, [orderId])
      : await qT(`SELECT * FROM payments WHERE (payment_on_id = $1 OR customer_mobile_number = $2 OR target_mobile_number = $2)
          ${anchor ? `AND created_at >= $3::timestamptz AND created_at <= $4::timestamptz` : ''} ORDER BY created_at LIMIT 50`, anchor ? [orderId || id, mobile, wLo, wHi] : [orderId || id, mobile]);
    const payOk = s => s === 'success' ? true : (['fail', 'failed', 'declined', 'error'].includes(s) ? false : null);
    pay.rows.forEach(p => add(p.created_at, 'payments', 'payment', payOk(p.status),
      `${p.payment_on_type} ${p.amount} ${p.vendor || ''} · ${p.status}${p.fail_reason ? ' · ' + p.fail_reason : ''}`,
      { endpoint: `payment gateway · ${p.vendor || ''}`,
        request: { amount: p.amount, vendor: p.vendor, payment_on_type: p.payment_on_type, payment_on_id: p.payment_on_id, reference: p.payment_reference_id, mobile: p.customer_mobile_number },
        response: nonEmpty({ status: p.status, fail_reason: p.fail_reason, initialization: nonEmpty(p.payment_initialization_response), commit: nonEmpty(p.payment_commit_response), bss: nonEmpty(p.bss_response) }),
        ms: elapsed(p), status: p.status }));
  })());

  // activation + eligibility: by order when resolved, else by MSISDN within the journey window
  // (so a BSS activation with no onboarding order still shows its own events + the full local journey)
  tasks.push((async () => {
    const act = scopeByOrder
      ? await qT(`SELECT * FROM activation_logs WHERE onboarding_order_id = $1::uuid ORDER BY created_at LIMIT 50`, [orderId])
      : await qT(`SELECT * FROM activation_logs WHERE msisdn = $1 ${anchor ? `AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz` : ''} ORDER BY created_at DESC LIMIT 50`, anchor ? [mobile, wLo, wHi] : [mobile]);
    act.rows.forEach(a => add(a.created_at, 'activation_logs', a.api && a.api.match(/semati/i) ? 'semati' : 'activation', a.state === true,
      `${a.api} · ${a.status_code || ''} · ${a.state ? 'ok' : 'FAILED'}`,
      { endpoint: a.api, request: nonEmpty(a.request) || nonEmpty(a.request_data), response: nonEmpty(a.response), ms: elapsed(a), status: a.status_code }));
  })());
  tasks.push((async () => {
    const el = scopeByOrder
      ? await qT(`SELECT * FROM eligibility_logs WHERE onboarding_order_id = $1::uuid ORDER BY created_at LIMIT 20`, [orderId])
      : await qT(`SELECT * FROM eligibility_logs WHERE msisdn = $1 ${anchor ? `AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz` : ''} ORDER BY created_at DESC LIMIT 20`, anchor ? [mobile, wLo, wHi] : [mobile]);
    el.rows.forEach(e => add(e.created_at, 'eligibility_logs', 'eligibility', e.state === true, `${e.process || e.api} · ${e.status_code || ''}`,
      { endpoint: e.api, request: nonEmpty(e.request) || nonEmpty(e.request_data), response: nonEmpty(e.response), ms: elapsed(e), status: e.status_code }));
  })());
  // nafath by national id
  if (nid) {
    tasks.push((async () => {
      const nf = anchor
        ? await qT(`SELECT * FROM nafath_logs WHERE nationality_id_number = $1 AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz ORDER BY created_at LIMIT 20`, [nid, wLo, wHi])
        : await qT(`SELECT * FROM nafath_logs WHERE nationality_id_number = $1 ORDER BY created_at LIMIT 20`, [nid]);
      const nafOk = s => { s = String(s || '').toUpperCase(); if (/COMPLETED/.test(s)) return true; if (/EXPIRED|REJECT|FAIL|DENIED|CANCELL?ED/.test(s)) return false; return null; };
      nf.rows.forEach(x => add(x.created_at, 'nafath_logs', 'nafath', nafOk(x.status), `${x.service || ''} · ${x.status}`,
        { endpoint: `nafath authorize · ${x.service || ''}`,
          request: { nationality_id_number: x.nationality_id_number, action: 'SpRequest', service: x.service, trans_id: x.trans_id, auth_type: x.auth_type },
          response: nonEmpty({ status: x.status, response: nonEmpty(x.response), callback: nonEmpty(x.callback) }),
          ms: elapsed(x), status: x.status }));
    })());
  }
  // delivery
  tasks.push((async () => {
    const del = scopeByOrder
      ? await qT(`SELECT * FROM delivery_requests WHERE delivery_on_id = $1 ORDER BY created_at LIMIT 20`, [orderId])
      : await qT(`SELECT * FROM delivery_requests WHERE (delivery_on_id = $1 OR receiver_mobile = $2)
          ${anchor ? `AND created_at >= $3::timestamptz AND created_at <= $4::timestamptz` : ''} ORDER BY created_at LIMIT 20`, anchor ? [orderId || id, mobile, wLo, wHi] : [orderId || id, mobile]);
    const delOk = st => { if (DELIVERY_FAILED.includes(st)) return false; return /delivered|completed|DELIVERED|DL|POD/.test(st || '') ? true : null; };
    del.rows.forEach(d => add(d.created_at, 'delivery_requests', 'delivery', delOk(d.delivery_state),
      `${d.vendor} · ${d.delivery_state}`,
      { endpoint: `delivery · ${d.vendor || ''}`,
        request: { internal_reference_id: d.internal_reference_id, external_reference_id: d.external_reference_id, delivery_on_id: d.delivery_on_id, receiver_mobile: d.receiver_mobile },
        response: nonEmpty({ delivery_state: d.delivery_state, initialization: nonEmpty(d.delivery_initialization_response), callback: nonEmpty(d.callback_response), delivered_at: d.delivered_at }),
        ms: elapsed(d, 'delivered_at'), status: d.delivery_state }));
  })());
  // change plan
  if (mobile) {
    tasks.push((async () => {
      const cp = anchor
        ? await qT(`SELECT * FROM change_plan_logs WHERE mobile_number = $1 AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz ORDER BY created_at LIMIT 20`, [mobile, wLo, wHi])
        : await qT(`SELECT * FROM change_plan_logs WHERE mobile_number = $1 ORDER BY created_at LIMIT 20`, [mobile]);
      cp.rows.forEach(c => add(c.created_at, 'change_plan_logs', 'change_plan', c.status === 1 ? true : (c.status === 2 ? false : null),
        `${plans.label(pmap, c.from_plan)} → ${plans.label(pmap, c.to_plan)} · status=${c.status}`,
        { endpoint: 'change_plan', request: { from_plan: c.from_plan, to_plan: c.to_plan, mobile_number: c.mobile_number },
          response: nonEmpty({ status: c.status, final_step_message: c.final_step_message }), ms: elapsed(c), status: c.status }));
    })());
  }

  await Promise.all(tasks);

  events.sort((a,b) => new Date(a.at) - new Date(b.at));
  return { identifier: id, order, events };
}

// Failure breakdown by provider code · message, for the Troubleshoot per-category filter.
//  - semati: activation_logs (api ILIKE semati, state=false) → responseCode · responseMessage (e.g. 738 · "Person Id is expired")
//  - nafath: nafath_logs (terminal-fail, non-ownership) → nested response.status · response.message (e.g. 400-N069 · "NAFATH: NEW ERROR")
// Each reconciles with its Troubleshoot tile.
async function codeBreakdown({ category, now, windowHours = 24 }) {
  const n = now ? new Date(now).toISOString() : new Date().toISOString();
  const w = windowHours;
  let sql;
  if (category === 'nafath') {
    sql = `
      SELECT COALESCE(NULLIF(response->'response'->>'status',''), status, '—') AS code,
             COALESCE(NULLIF(response->'response'->>'message',''), '') AS message,
             count(*)::int AS count
      FROM nafath_logs
      WHERE lower(status) IN ('expired','rejected','failed','cancelled','denied') AND NOT ${NAF_OWNERSHIP}
        AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
      GROUP BY 1,2 ORDER BY count DESC LIMIT 50`;
  } else if (category === 'payment') {
    sql = `
      SELECT ${PAY_CODE} AS code, ${PAY_MSG} AS message, count(*)::int AS count
      FROM payments
      WHERE status IN ('fail','failed')
        AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
      GROUP BY 1,2 ORDER BY count DESC LIMIT 50`;
  } else {  // semati (default)
    sql = `
      SELECT COALESCE(NULLIF(status_code,''), response->>'responseCode', '—') AS code,
             COALESCE(NULLIF(response->>'responseMessage',''), NULLIF(response->'data'->>'responseMessage',''), '') AS message,
             count(*)::int AS count
      FROM activation_logs
      WHERE state=false AND api ILIKE '%semati%'
        AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
      GROUP BY 1,2 ORDER BY count DESC LIMIT 50`;
  }
  const r = await db.source.query(sql, [n, w]);
  const total = r.rows.reduce((a, x) => a + Number(x.count), 0);
  const known = ['semati', 'nafath', 'payment'];
  return { category: known.includes(category) ? category : 'semati', total, codes: r.rows };
}

module.exports = { CATEGORIES, summary, feed, timeline, resolveRow, codeBreakdown };
