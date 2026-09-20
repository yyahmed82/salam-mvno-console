/* Error Control Board + per-transaction end-to-end timeline.
 * Categorizes real failures from the replica and assembles the full story for one
 * order / mobile / ICCID / payment across payments, activation, nafath, eligibility,
 * change_plan, delivery, checkouts. */
const db = require('./db');
const plans = require('./plans');
const errclass = require('./errclass');   // Business vs Technical — single source of truth

/* Business/Technical SQL splits per source table (errclass.classCaseSql keeps the CASE in sync with
 * classifyClass). Fixed-class categories need no SQL: payment fail/declines are ALWAYS business (the
 * gateway answered "no"), payment_stuck is ALWAYS technical (platform never finalised), duplicates and
 * delivery fail-states (cancelled/refused/RTO…) are business outcomes. */
const ACT_CLS  = errclass.classCaseSql(`COALESCE(NULLIF(status_code,''), response->>'responseCode')`,
  `coalesce(status_code,'') || ' ' || coalesce(response::text,'')`);       // activation_logs + eligibility_logs (same shape)
const NAF_CLS  = errclass.classCaseSql(`NULLIF(response->'response'->>'status','')`,
  `coalesce(status,'') || ' ' || coalesce(response::text,'')`);            // nafath_logs (EXPIRED/REJECTED etc → business)
const CPL_CLS  = errclass.classCaseSql(`NULL::text`, `coalesce(final_step_message,'')`);   // change_plan_logs

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
// Human delivery failure reason from the courier callback / init response (e.g. OTO
// attemptFailureReason "Rejected by Customer"). Falls back to the raw delivery_state when the
// carrier returned no text reason, so every failed row buckets somewhere.
const DEL_REASON = `COALESCE(
    NULLIF(TRIM(callback_response->>'attemptFailureReason'),''),
    NULLIF(TRIM(delivery_initialization_response->>'attemptFailureReason'),''),
    NULLIF(TRIM(callback_response->>'failureReason'),''),
    NULLIF(TRIM(delivery_state),''), '—')`;

/* Change Ownership (mobile-number transfer) detection. An ownership transfer is an
 * OWNERSHIP_TRANSFER Checkout (checkout_type=5); it produces (a) a change_plan_log for the new
 * owner's plan, linked to the ownership checkout via its payment, and (b) a Nafath authorize step
 * (service transfer_ownership_*). We pull BOTH out of the generic Change Plan / Nafath tiles into
 * their own category so ownership failures don't hide inside plan-change or identity failures. */
const OWNERSHIP_CPL = `EXISTS (SELECT 1 FROM payments p JOIN checkouts c ON c.id::text = p.payment_on_id
   WHERE p.payment_on_type = 'Checkout' AND p.id::text = change_plan_logs.payment_id AND c.checkout_type = 5)`;
const NAF_OWNERSHIP = `(service ILIKE '%transfer_ownership%' OR service ILIKE '%MobileOwnership%')`;

// UPG / salam put the real gateway code+message in payment_commit_response.gateway.response;
// hyperpay / tap instead fill fail_reason. Extract a clean code + message for the Payment
// code·message breakdown and feed filter (mirrors analytics.DECLINE_EXPR bucketing).
const PAY_CODE = `COALESCE(NULLIF(payment_commit_response#>>'{gateway,response,code}',''), NULLIF(payment_initialization_response#>>'{gateway,response,code}',''), '—')`;
const PAY_MSG  = `COALESCE(NULLIF(regexp_replace(COALESCE(payment_commit_response#>>'{gateway,response,message}', payment_initialization_response#>>'{gateway,response,message}'), ' \\([^)]*\\)$',''),''), NULLIF(fail_reason,''), '')`;
// Normalise the payment vendor/method into the human gateway name — for the color-coded gateway
// badge on each payment row and the gateway breakdown/filter. salam/merchalink = the UPG unified gateway.
const GW_EXPR = `CASE
    WHEN lower(coalesce(vendor,'')) LIKE '%samsung%' OR lower(coalesce(payment_method,'')) LIKE '%samsung%' THEN 'Samsung Pay'
    WHEN lower(coalesce(vendor,'')) LIKE '%merchalink%' OR lower(coalesce(vendor,'')) LIKE '%upg%' OR lower(coalesce(vendor,'')) = 'salam' THEN 'UPG'
    WHEN lower(coalesce(vendor,'')) LIKE '%hyperpay%' THEN 'HyperPay'
    WHEN lower(coalesce(vendor,'')) LIKE '%tap%' THEN 'Tap'
    WHEN lower(coalesce(vendor,'')) LIKE '%tamara%' THEN 'Tamara'
    WHEN lower(coalesce(vendor,'')) LIKE '%emkan%' THEN 'Emkan'
    WHEN lower(coalesce(payment_method,'')) LIKE '%apple%' THEN 'Apple Pay'
    WHEN lower(coalesce(payment_method,'')) LIKE '%stc%' THEN 'STC Pay'
    ELSE COALESCE(NULLIF(vendor,''),'Other') END`;

// "Payment stuck / unconfirmed" = the gateway actually returned a result (a commit/callback was
// recorded) but the app never finalised the payment to success/fail. A pending row with NO commit
// response is the backend's "initiated" state: the customer reached the payment page and never
// continued (abandonment) — NORMAL behaviour, NOT stuck. Counting those inflated the KPI massively.
// This mirrors Payment#actual_pending? / Payment.by_status_eq('pending') in selfcare-backend, which
// is exactly how Salam's own admin distinguishes a real pending payment from an abandoned one.
const STUCK_COND = `lower(status) IN ('pending','initiated')
    AND payment_commit_response IS NOT NULL
    AND payment_commit_response::text NOT IN ('', '{}', 'null')`;

// KPI tiles: open/total-ish counts per category over a window
async function summary({ now, windowHours = 24, team, channel }) {
  const n = now ? new Date(now).toISOString() : new Date().toISOString();
  const w = windowHours;
  const out = [];
  // push(cat, total, technical) → tile carries the Business/Technical split (business = total - technical)
  const push = (cat, total, technical = 0) => { const c = CATEGORIES[cat]; if (!team || c.team === team) { const t = Number(total), tec = Number(technical) || 0; out.push({ category: cat, label: c.label, team: c.team, total: t, business: Math.max(0, t - tec), technical: tec }); } };

  const pay = await db.source.query(`SELECT count(*) c FROM payments WHERE status IN ('fail','failed') AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz ${channel?`AND platform=$3`:''}`, channel?[n,w,channel]:[n,w]);
  push('payment', pay.rows[0].c);                              // declines = business by definition
  // Issue #2 — payments genuinely stuck (gateway committed but app never confirmed) >30min.
  // Excludes abandonment ("initiated" = pending with no commit response) — see STUCK_COND.
  const stuck = await db.source.query(`SELECT count(*) c FROM payments WHERE ${STUCK_COND} AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz - interval '30 minutes'`, [n,w]);
  push('payment_stuck', stuck.rows[0].c, stuck.rows[0].c);     // platform never finalised = technical
  // Issue #1 — suspected duplicate deductions (same customer+amount+target, 2+ success within 30min)
  const dup = await db.source.query(`SELECT count(*) c FROM (SELECT customer_mobile_number, amount, payment_on_type, payment_on_id FROM payments WHERE status='success' AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz GROUP BY 1,2,3,4 HAVING count(*)>1 AND (max(created_at)-min(created_at)) < interval '30 minutes') d`, [n,w]);
  push('payment_dup', dup.rows[0].c);
  // Change Ownership = ownership-linked plan-change failures + Nafath ownership-authorize failures
  const own = await db.source.query(`
    WITH u AS (
      SELECT (${CPL_CLS}) AS cls FROM change_plan_logs WHERE status=2 AND ${OWNERSHIP_CPL}
        AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
      UNION ALL
      SELECT (${NAF_CLS}) AS cls FROM nafath_logs WHERE lower(status) IN ('expired','rejected','failed','cancelled','denied') AND ${NAF_OWNERSHIP}
        AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
    ) SELECT count(*) c, count(*) FILTER (WHERE cls='technical') t FROM u`, [n,w]);
  push('change_ownership', own.rows[0].c, own.rows[0].t);
  const act = await db.source.query(`SELECT count(*) c, count(*) FILTER (WHERE (${ACT_CLS})='technical') t FROM activation_logs WHERE state=false AND api NOT ILIKE '%semati%' AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w]);
  push('activation', act.rows[0].c, act.rows[0].t);
  const sem = await db.source.query(`SELECT count(*) c, count(*) FILTER (WHERE (${ACT_CLS})='technical') t FROM activation_logs WHERE state=false AND api ILIKE '%semati%' AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w]);
  push('semati', sem.rows[0].c, sem.rows[0].t);
  const naf = await db.source.query(`SELECT count(*) c, count(*) FILTER (WHERE (${NAF_CLS})='technical') t FROM nafath_logs WHERE lower(status) IN ('expired','rejected','failed','cancelled','denied') AND NOT ${NAF_OWNERSHIP} AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w]);
  push('nafath', naf.rows[0].c, naf.rows[0].t);
  const elig = await db.source.query(`SELECT count(*) c, count(*) FILTER (WHERE (${ACT_CLS})='technical') t FROM eligibility_logs WHERE state=false AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w]);
  push('eligibility', elig.rows[0].c, elig.rows[0].t);
  const cpl = await db.source.query(`SELECT count(*) c, count(*) FILTER (WHERE (${CPL_CLS})='technical') t FROM change_plan_logs WHERE status=2 AND NOT (${OWNERSHIP_CPL}) AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w]);
  push('change_plan', cpl.rows[0].c, cpl.rows[0].t);
  const del = await db.source.query(`SELECT count(*) c FROM delivery_requests WHERE delivery_state = ANY($3) AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, [n,w,DELIVERY_FAILED]);
  push('delivery', del.rows[0].c);                             // courier outcomes (cancelled/refused/RTO…) = business
  return out.sort((a,b) => b.total - a.total);
}

// Recent error feed (rows) with optional filters + free-text identifier search.
/* `cls` filters business/technical SERVER-SIDE. It has to: the caller asks for `limit` rows, and
 * the board then narrowed them client-side, so a rare class was buried by a common one. Live case
 * 2026-08-24: 24,690 failures in 7 days, of which 23 technical (0.09%). The 120 most recent rows
 * were almost all eligibility declines, so clicking "Technical" showed 2 rows out of 23 and the
 * board looked broken. Same failure mode the semati/non-semati split already guards against
 * further down — a LIMIT must never be allowed to bury the smaller bucket. */
async function feed({ now, windowHours = 24, category, team, q, limit = 100, code, gw, cls }) {
  // when a class is requested, widen the per-category fetch so the rare class survives the LIMIT,
  // then narrow to `limit` after filtering. Bounded, so this cannot become an unbounded scan.
  const wantCls = (cls === 'business' || cls === 'technical') ? cls : null;
  const fetchLimit = wantCls ? Math.min(limit * 25, 3000) : limit;
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
    if (gw && category === 'payment') { p.push(String(gw)); cond += ` AND (${GW_EXPR}) = $${p.length}`; }
    p.push(fetchLimit); const limIdx = p.length;
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, fail_reason, vendor, platform, payment_method, payment_on_type, payment_on_id,
              payment_reference_id AS ref,
              customer_mobile_number AS mobile, ${PAY_CODE} AS dcode, ${PAY_MSG} AS dmsg, (${GW_EXPR}) AS gw
       FROM payments WHERE status IN ('fail','failed')
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${cond}
       ORDER BY created_at DESC LIMIT $${limIdx}`, p);
    r.rows.forEach(x => rows.push({ category:'payment', team:CATEGORIES.payment.team, id:'pay:'+x.id, when:x.when,
      identifier: x.payment_on_id || x.id, mobile:x.mobile, order_id:x.payment_on_type==='OnboardingOrder'?x.payment_on_id:null, gw:x.gw,
      ref: x.ref || null,   // join key → UPG gateway DB (invoices.id) for the ⇄ UPG drill
      err_class:'business', err_reason:'gateway decline — '+(x.dmsg||x.fail_reason||'said no'),   // declines = business by definition
      detail: `${x.payment_on_type} · ${x.dcode&&x.dcode!=='—'?x.dcode+' · ':''}${x.dmsg||x.fail_reason||'failed'}` }));
  }
  if (wantCat('payment_stuck')) {
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, payment_reference_id AS ref, vendor, amount, payment_on_type, payment_on_id,
              customer_mobile_number AS mobile, round(extract(epoch from ($1::timestamptz - created_at))/60)::int AS age_min
       FROM payments WHERE ${STUCK_COND}
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz - interval '30 minutes'
         ${like?`AND (customer_mobile_number ILIKE $3 OR payment_reference_id ILIKE $3 OR payment_on_id ILIKE $3 OR id::text ILIKE $3)`:''}
       ORDER BY created_at DESC LIMIT $${like?4:3}`, like?[n,w,like,fetchLimit]:[n,w,fetchLimit]);
    r.rows.forEach(x => rows.push({ category:'payment_stuck', team:'Digital Ops', id:'stuck:'+x.id, when:x.when,
      identifier: x.ref || x.payment_on_id || x.id, mobile:x.mobile, order_id:x.payment_on_type==='OnboardingOrder'?x.payment_on_id:null,
      ref: x.ref || null,
      err_class:'technical', err_reason:'platform never finalised the payment (stuck '+x.age_min+'m)',
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
       ORDER BY min(created_at) DESC LIMIT $${like?4:3}`, like?[n,w,like,fetchLimit]:[n,w,fetchLimit]);
    r.rows.forEach(x => rows.push({ category:'payment_dup', team:'Digital Ops', id:'dup:'+(x.payment_on_id||x.mobile)+':'+x.amount+':'+(x.when?new Date(x.when).getTime():''), when:x.when,
      identifier: x.mobile || x.payment_on_id, mobile:x.mobile, order_id:x.payment_on_type==='OnboardingOrder'?x.payment_on_id:null,
      err_class:'business', err_reason:'duplicate charge ('+x.c+'× same customer+amount within 30m)',
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
    p.push(fetchLimit); const limIdx = p.length;
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, api, status_code, msisdn, onboarding_order_id::text AS order_id, platform,
              (api ILIKE '%semati%') AS is_semati, left(response::text, 600) AS rtxt
       FROM activation_logs WHERE state=false ${semFilter}
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${cond}
       ORDER BY created_at DESC LIMIT $${limIdx}`, p);
    r.rows.forEach(x => { const cat = x.is_semati?'semati':'activation'; if(!wantCat(cat)) return;
      const k = errclass.classifyClass({ ok:false, status_code:x.status_code, response:x.rtxt });
      rows.push({ category:cat, team:CATEGORIES[cat].team, id:'act:'+x.id, when:x.when, identifier:x.msisdn||x.order_id,
        mobile:x.msisdn, order_id:x.order_id, err_class:k.cls, err_reason:k.reason, detail:`${x.api} · ${x.status_code||''}` }); });
  }
  if (wantCat('nafath')) {
    const p = [n, w]; let cond = '';
    if (like) { p.push(like); cond += ` AND nationality_id_number ILIKE $${p.length}`; }
    if (code && category === 'nafath') { p.push(String(code)); cond += ` AND COALESCE(NULLIF(response->'response'->>'status',''), status) = $${p.length}`; }
    p.push(fetchLimit); const limIdx = p.length;
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, status, service, nationality_id_number AS nid,
              COALESCE(NULLIF(response->'response'->>'status',''), status) AS code,
              NULLIF(response->'response'->>'status','') AS jstatus,
              response->'response'->>'message' AS msg,
              coalesce(response::text,'') AS raw
       FROM nafath_logs WHERE lower(status) IN ('expired','rejected','failed','cancelled','denied') AND NOT ${NAF_OWNERSHIP}
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${cond}
       ORDER BY created_at DESC LIMIT $${limIdx}`, p);
    /* Feed the JS classifier EXACTLY what NAF_CLS feeds the SQL one, or the tile and the row
     * disagree about the same record. Two differences caused live case 2026-08-24 (nafath tile
     * "T 0" beside two rows badged Technical):
     *   · code — SQL uses only response.response.status; the feed fell back to the `status` column,
     *     so a plain "failed" was tested as if it were a provider code.
     *   · text — SQL scans the WHOLE response body; the feed passed only response.response.message,
     *     so a row with a real body but no message looked like "no answer at all" and the
     *     heuristic called it technical, while SQL saw the body and called it business.
     * x.code stays as-is for DISPLAY; classification uses the aligned inputs. */
    r.rows.forEach(x => { const k = errclass.classifyClass({ ok:false, status_code:x.jstatus, response:x.raw, detail:x.status });
      rows.push({ category:'nafath', team:CATEGORIES.nafath.team, id:'naf:'+x.id, when:x.when, err_class:k.cls, err_reason:k.reason,
        identifier:x.nid, nationality_id_number:x.nid, detail:`${x.service||'nafath'} · ${x.code||x.status}${x.msg?' · '+x.msg:''}` }); });
  }
  if (wantCat('eligibility')) {
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, api, status_code, msisdn, onboarding_order_id::text AS order_id, process, left(response::text, 600) AS rtxt
       FROM eligibility_logs WHERE state=false
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${like?`AND (msisdn ILIKE $3 OR onboarding_order_id::text ILIKE $3)`:''}
       ORDER BY created_at DESC LIMIT $${like?4:3}`, like?[n,w,like,fetchLimit]:[n,w,fetchLimit]);
    r.rows.forEach(x => { const k = errclass.classifyClass({ ok:false, status_code:x.status_code, response:x.rtxt });
      rows.push({ category:'eligibility', team:CATEGORIES.eligibility.team, id:'elig:'+x.id, when:x.when, err_class:k.cls, err_reason:k.reason,
        identifier:x.msisdn||x.order_id, mobile:x.msisdn, order_id:x.order_id, detail:`${x.process||x.api} · ${x.status_code||'denied'}` }); });
  }
  if (wantCat('change_plan')) {
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, mobile_number AS mobile, from_plan, to_plan, final_step_message
       FROM change_plan_logs WHERE status=2 AND NOT (${OWNERSHIP_CPL})
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${like?`AND mobile_number ILIKE $3`:''}
       ORDER BY created_at DESC LIMIT $${like?4:3}`, like?[n,w,like,fetchLimit]:[n,w,fetchLimit]);
    r.rows.forEach(x => { const k = errclass.classifyClass({ ok:false, response:x.final_step_message });
      rows.push({ category:'change_plan', team:CATEGORIES.change_plan.team, id:'cpl:'+x.id, when:x.when, err_class:k.cls, err_reason:k.reason,
        identifier:x.mobile, mobile:x.mobile, detail:`${plans.label(pmap,x.from_plan)} → ${plans.label(pmap,x.to_plan)} · ${(x.final_step_message||'').slice(0,60)}` }); });
  }
  if (wantCat('change_ownership')) {
    // (a) plan-change failures that belong to an ownership transfer (payment → ownership checkout type 5)
    const ra = await db.source.query(
      `SELECT id::text, created_at AS when, mobile_number AS mobile, from_plan, to_plan, final_step_message
       FROM change_plan_logs WHERE status=2 AND ${OWNERSHIP_CPL}
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${like?`AND mobile_number ILIKE $3`:''}
       ORDER BY created_at DESC LIMIT $${like?4:3}`, like?[n,w,like,fetchLimit]:[n,w,fetchLimit]);
    ra.rows.forEach(x => { const k = errclass.classifyClass({ ok:false, response:x.final_step_message });
      rows.push({ category:'change_ownership', team:CATEGORIES.change_ownership.team, id:'cpl:'+x.id, when:x.when, err_class:k.cls, err_reason:k.reason,
        identifier:x.mobile, mobile:x.mobile, detail:`Ownership transfer · ${plans.label(pmap,x.from_plan)} → ${plans.label(pmap,x.to_plan)} · ${(x.final_step_message||'').slice(0,45)}` }); });
    // (b) the Nafath ownership-authorize step failing
    const rb = await db.source.query(
      `SELECT id::text, created_at AS when, status, service, nationality_id_number AS nid
       FROM nafath_logs WHERE lower(status) IN ('expired','rejected','failed','cancelled','denied') AND ${NAF_OWNERSHIP}
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${like?`AND nationality_id_number ILIKE $3`:''}
       ORDER BY created_at DESC LIMIT $${like?4:3}`, like?[n,w,like,fetchLimit]:[n,w,fetchLimit]);
    rb.rows.forEach(x => { const k = errclass.classifyClass({ ok:false, response:x.status, detail:x.service });
      rows.push({ category:'change_ownership', team:CATEGORIES.change_ownership.team, id:'naf:'+x.id, when:x.when, err_class:k.cls, err_reason:k.reason,
        identifier:x.nid, nationality_id_number:x.nid, detail:`Ownership authorize · ${x.service||'nafath'} · ${x.status}` }); });
  }
  if (wantCat('delivery')) {
    const p = [n, w, DELIVERY_FAILED]; let cond = '';
    if (like) { p.push(like); cond += ` AND (receiver_mobile ILIKE $${p.length} OR delivery_on_id ILIKE $${p.length} OR external_reference_id ILIKE $${p.length})`; }
    if (code && category === 'delivery') { p.push(String(code)); cond += ` AND (${DEL_REASON}) = $${p.length}`; }
    p.push(fetchLimit); const limIdx = p.length;
    const r = await db.source.query(
      `SELECT id::text, created_at AS when, vendor, delivery_state, receiver_mobile AS mobile, delivery_on_id AS order_id, external_reference_id, (${DEL_REASON}) AS reason
       FROM delivery_requests WHERE delivery_state = ANY($3)
         AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
         ${cond}
       ORDER BY created_at DESC LIMIT $${limIdx}`, p);
    r.rows.forEach(x => rows.push({ category:'delivery', team:CATEGORIES.delivery.team, id:'del:'+x.id, when:x.when,
      identifier:x.external_reference_id||x.order_id, mobile:x.mobile, order_id:x.order_id, gw:x.vendor,
      err_class:'business', err_reason:'courier outcome — '+((x.reason && x.reason!=='—') ? x.reason : x.delivery_state),   // cancelled/refused/RTO = business
      detail:`${x.delivery_state}${x.reason && x.reason!==x.delivery_state && x.reason!=='—' ? ' · '+x.reason : ''}` }));
  }
  rows.sort((a,b) => new Date(b.when) - new Date(a.when));
  const out = wantCls ? rows.filter(r => r.err_class === wantCls) : rows;
  return out.slice(0, limit);
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

// Fetch the exact clicked feed row (kind:id) and add it to the timeline with its own endpoint /
// request / response / status. Used as a fallback so any transaction is inspectable even when it
// has no onboarding order / MSISDN to build a full journey from.
async function addDirectRow(rowId, add, nonEmpty, elapsed) {
  const [kind, id] = String(rowId || '').split(':');
  if (!kind || !id) return false;
  const q1 = async (sql, p) => (await db.source.query(sql, p)).rows[0];
  try {
    if (kind === 'elig') { const e = await q1(`SELECT * FROM eligibility_logs WHERE id=$1::bigint`, [id]);
      if (e) add(e.created_at, 'eligibility_logs', 'eligibility', e.state === true, `${e.process || e.api} · ${e.status_code || ''}`,
        { endpoint: e.api, request: nonEmpty(e.request) || nonEmpty(e.request_data), response: nonEmpty(e.response), ms: elapsed(e), status: e.status_code }); return !!e; }
    if (kind === 'act') { const a = await q1(`SELECT * FROM activation_logs WHERE id=$1::bigint`, [id]);
      if (a) add(a.created_at, 'activation_logs', a.api && /semati/i.test(a.api) ? 'semati' : 'activation', a.state === true, `${a.api} · ${a.status_code || ''} · ${a.state ? 'ok' : 'FAILED'}`,
        { endpoint: a.api, request: nonEmpty(a.request) || nonEmpty(a.request_data), response: nonEmpty(a.response), ms: elapsed(a), status: a.status_code }); return !!a; }
    if (kind === 'naf') { const x = await q1(`SELECT * FROM nafath_logs WHERE id=$1::bigint`, [id]);
      if (x) { const s = String(x.status || '').toUpperCase(); const ok = /COMPLETED/.test(s) ? true : (/EXPIRED|REJECT|FAIL|DENIED|CANCEL/.test(s) ? false : null);
        add(x.created_at, 'nafath_logs', 'nafath', ok, `${x.service || ''} · ${x.status}`,
          { endpoint: `nafath authorize · ${x.service || ''}`, request: { nationality_id_number: x.nationality_id_number, action: 'SpRequest', service: x.service, trans_id: x.trans_id, auth_type: x.auth_type },
            response: nonEmpty({ status: x.status, response: nonEmpty(x.response), callback: nonEmpty(x.callback) }), ms: elapsed(x), status: x.status }); } return !!x; }
    if (kind === 'cpl') { const c = await q1(`SELECT * FROM change_plan_logs WHERE id=$1::bigint`, [id]);
      if (c) add(c.created_at, 'change_plan_logs', 'change_plan', c.status === 1 ? true : (c.status === 2 ? false : null), `plan change · ${c.from_plan || ''} → ${c.to_plan || ''} · status=${c.status}`,
        { endpoint: 'change_plan', request: { mobile_number: c.mobile_number, from_plan: c.from_plan, to_plan: c.to_plan, payment_id: c.payment_id }, response: nonEmpty({ status: c.status, final_step_message: c.final_step_message }), ms: elapsed(c), status: c.status }); return !!c; }
    if (kind === 'pay' || kind === 'stuck') { const p = await q1(`SELECT * FROM payments WHERE id::text=$1`, [id]);
      if (p) add(p.created_at, 'payments', 'payment', p.status === 'success' ? true : (['fail', 'failed'].includes(p.status) ? false : null), `${p.payment_on_type} ${p.amount} ${p.vendor || ''} · ${p.status}${p.fail_reason ? ' · ' + p.fail_reason : ''}`,
        { endpoint: `payment gateway · ${p.vendor || ''}`, request: { amount: p.amount, vendor: p.vendor, payment_method: p.payment_method, payment_on_type: p.payment_on_type, payment_on_id: p.payment_on_id, reference: p.payment_reference_id, mobile: p.customer_mobile_number },
          response: nonEmpty({ status: p.status, fail_reason: p.fail_reason, initialization: nonEmpty(p.payment_initialization_response), commit: nonEmpty(p.payment_commit_response), bss: nonEmpty(p.bss_response) }), ms: elapsed(p), status: p.status }); return !!p; }
    if (kind === 'del') { const d = await q1(`SELECT * FROM delivery_requests WHERE id=$1::bigint`, [id]);
      if (d) add(d.created_at, 'delivery_requests', 'delivery', DELIVERY_FAILED.includes(d.delivery_state) ? false : null, `${d.vendor} · ${d.delivery_state}`,
        { endpoint: d.vendor === 'oto' ? 'POST api.tryoto.com /rest/v2/createOrder — exact body: ⇄ Courier wire' : `courier ${d.vendor || '?'} API — exact body: ⇄ Courier wire`,
          rr: { req: 'SENT TO COURIER — summary from our DB (exact JSON body: ⇄ Courier wire)',
                res: 'COURIER PROGRESS — initialization ACK + LATEST callback (the DB keeps only the latest)' },
          request: nonEmpty({ sent_at: d.created_at, orderId_we_sent: d.internal_reference_id,
            our_order_id: d.delivery_on_id, receiver_mobile: d.receiver_mobile, vendor: d.vendor }),
          response: nonEmpty({ courier_shipment_id: d.external_reference_id,
            initialization_ack: nonEmpty(d.delivery_initialization_response),
            latest_callback: nonEmpty(d.callback_response),
            current_state: d.delivery_state, delivered_at: d.delivered_at }),
          ms: elapsed(d, 'delivered_at'), status: d.delivery_state }); return !!d; }
  } catch (e) { /* best-effort */ }
  return false;
}

// Full end-to-end timeline for one identifier (order id / mobile / iccid / nid).
async function timeline({ identifier, anchorAt, rowId }) {
  const id = String(identifier || '').trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
  const pmap = await plans.loadMap();
  const events = [];
  // each event carries a trace: endpoint · request · response · exec time (ms) · status
  const add = (ts, source, kind, ok, detail, tr) => events.push({ at: ts, source, kind, ok, detail,
    endpoint: (tr && tr.endpoint) || null,
    request: tr && tr.request !== undefined ? tr.request : null,
    response: tr && tr.response !== undefined ? tr.response : null,
    ms: tr && tr.ms != null ? tr.ms : null,
    status: tr && tr.status != null ? tr.status : null,
    rr: (tr && tr.rr) || null });   // optional custom REQUEST/RESPONSE labels (e.g. "DB RECORD")
  const elapsed = (r, endField) => {
    const a = r && r.created_at, b = (endField && r && r[endField]) || (r && r.updated_at);
    return (a && b) ? Math.max(0, Math.round(new Date(b) - new Date(a))) : null;
  };
  const nonEmpty = o => (o && typeof o === 'object' && Object.keys(o).length) ? o : null;

  // No resolvable order / mobile / nid, but we know the exact clicked row → show that transaction's own
  // request/response/API call so a standalone failure (e.g. eligibility with no order/msisdn) is never empty.
  if (!id) {
    if (rowId) await addDirectRow(rowId, add, nonEmpty, elapsed);
    events.sort((a, b) => new Date(a.at) - new Date(b.at));
    return { identifier: null, order: null, events };
  }

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

  // MSISDN format tolerance (the Yusr "could not find a subscriber" bug): prod stores the SAME
  // number as 9665XXXXXXXX in activation/eligibility msisdn, 05XXXXXXXX in orders/payments, and
  // occasionally bare 5XXXXXXXX. Exact '=' on one normalised form missed real subscribers whose
  // rows plainly exist. Expand to every stored variant of the last-9 significant digits — a small
  // IN-list keeps index use (a regexp match over 8M rows would not).
  const msisdnForms = v => {
    const d = String(v == null ? '' : v).replace(/\D/g, '');
    if (!/^(?:966|0)?5\d{8}$/.test(d)) return [String(v)];
    const l9 = d.slice(-9);
    return ['0' + l9, '966' + l9, l9, '+966' + l9];
  };

  // resolve an onboarding order (by id, mobile in any stored format, or nid)
  let order = null;
  const oq = await db.source.query(
    `SELECT * FROM onboarding_orders
     WHERE ${isUuid?'id = $1::uuid OR ':''} mobile_number = ANY($2::text[]) OR nationality_id_number = $1::text
     ORDER BY created_at DESC LIMIT 1`, [id, msisdnForms(id)]);
  if (oq.rowCount) order = oq.rows[0];

  // Still nothing, but the identifier is a mobile? The number may only appear in ACTIVATION
  // (e.g. the MSISDN was assigned during activation and the order carries a contact number).
  // Walk activation_logs → onboarding_order_id → order, so the journey still resolves.
  if (!order && msisdnForms(id).length > 1) {
    try {
      const aq = await db.source.query(
        `SELECT onboarding_order_id::text AS oid FROM activation_logs
          WHERE msisdn = ANY($1::text[]) AND onboarding_order_id IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`, [msisdnForms(id)]);
      if (aq.rowCount && aq.rows[0].oid) {
        const o2 = await db.source.query(`SELECT * FROM onboarding_orders WHERE id::text = $1 LIMIT 1`, [aq.rows[0].oid]);
        if (o2.rowCount) order = o2.rows[0];
      }
    } catch (e) { /* fallback only */ }
  }

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
      { endpoint: 'POST /api/onboarding/orders',
        rr: { res: 'ORDER ROW — full state snapshot from our DB (order creation stores no API payloads)' },
        request: null,
        response: nonEmpty({ aasm_state: order.aasm_state, completed: order.completed, activated: order.activated,
          plan_id: order.plan_id, flow_type: order.flow_type, channel: order.channel, sim_type: order.sim_type,
          status: order.status, mnp_operator: order.mnp_operator,
          external_service_name: order.external_service_name, delivery_type: order.delivery_type,
          seller_id: order.seller_id, store_id: order.store_id,
          utm: nonEmpty({ source: order.utm_source, medium: order.utm_medium, campaign: order.utm_campaign }),
          extra: order.extra }), ms: elapsed(order), status: order.aasm_state });
  }
  const orderId = scopeByOrder ? order.id : (isUuid ? id : null);
  const mobile = order ? order.mobile_number : id;
  const nid = order ? order.nationality_id_number : id;
  // every stored variant of the mobile — activation may hold 9665… while the order holds 05…
  const mAny = msisdnForms(mobile);

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
      : await qT(`SELECT * FROM payments WHERE (payment_on_id = $1 OR customer_mobile_number = ANY($2::text[]) OR target_mobile_number = ANY($2::text[]))
          ${anchor ? `AND created_at >= $3::timestamptz AND created_at <= $4::timestamptz` : ''} ORDER BY created_at LIMIT 50`, anchor ? [orderId || id, mAny, wLo, wHi] : [orderId || id, mAny]);
    const payOk = s => s === 'success' ? true : (['fail', 'failed', 'declined', 'error'].includes(s) ? false : null);
    pay.rows.forEach(p => add(p.created_at, 'payments', 'payment', payOk(p.status),
      `${p.payment_on_type} ${p.amount} ${p.vendor || ''} · ${p.status}${p.fail_reason ? ' · ' + p.fail_reason : ''}`,
      { endpoint: `payment gateway · ${p.vendor || ''} — gateway-side detail: ⇄ UPG`,
        rr: { req: 'PAYMENT ROW — full key fields from our DB (the gateway wire lives at the vendor — ⇄ UPG)',
              res: 'FULL stored gateway responses — initialization · commit · bss, complete as the app saved them' },
        request: nonEmpty({ amount: p.amount, vendor: p.vendor, payment_method: p.payment_method,
          card_type: p.card_type, platform: p.platform, payment_on_type: p.payment_on_type,
          payment_on_id: p.payment_on_id, reference: p.payment_reference_id,
          mobile: p.customer_mobile_number, target_mobile: p.target_mobile_number,
          external_service_name: p.external_service_name, extra: nonEmpty(p.extra) }),
        response: nonEmpty({ status: p.status, fail_reason: p.fail_reason, initialization: nonEmpty(p.payment_initialization_response), commit: nonEmpty(p.payment_commit_response), bss: nonEmpty(p.bss_response) }),
        ms: elapsed(p), status: p.status }));
  })());

  // activation + eligibility: by order when resolved, else by MSISDN within the journey window
  // (so a BSS activation with no onboarding order still shows its own events + the full local journey)
  // BSS activation rows FREQUENTLY carry onboarding_order_id = NULL (the write path keys them by
  // msisdn only) — querying by order id alone made an "activated true" order show NO activation
  // events. So: order-id query AND msisdn-in-window query, deduped by row id.
  tasks.push((async () => {
    const byOrder = scopeByOrder
      ? await qT(`SELECT * FROM activation_logs WHERE onboarding_order_id = $1::uuid ORDER BY created_at LIMIT 50`, [orderId])
      : { rows: [] };
    const byMsisdn = (mAny && mAny.length)
      ? await qT(`SELECT * FROM activation_logs WHERE msisdn = ANY($1::text[]) ${anchor ? `AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz` : ''} ORDER BY created_at DESC LIMIT 50`, anchor ? [mAny, wLo, wHi] : [mAny])
      : { rows: [] };
    const seen = new Set();
    const ACT_RR = { req: 'FULL stored request — exactly as the app logged it (request + request_data when both exist)',
                     res: 'FULL stored response — exactly as the app logged it' };
    const fullReq = a => (nonEmpty(a.request) && nonEmpty(a.request_data))
      ? { request: a.request, request_data: a.request_data }
      : (nonEmpty(a.request) || nonEmpty(a.request_data));
    [...byOrder.rows, ...byMsisdn.rows].forEach(a => {
      if (seen.has(String(a.id))) return; seen.add(String(a.id));
      add(a.created_at, 'activation_logs', a.api && a.api.match(/semati/i) ? 'semati' : 'activation', a.state === true,
        `${a.api} · ${a.status_code || ''} · ${a.state ? 'ok' : 'FAILED'}`,
        { endpoint: a.api, rr: ACT_RR, request: fullReq(a), response: nonEmpty(a.response), ms: elapsed(a), status: a.status_code });
    });
  })());
  tasks.push((async () => {
    const byOrder = scopeByOrder
      ? await qT(`SELECT * FROM eligibility_logs WHERE onboarding_order_id = $1::uuid ORDER BY created_at LIMIT 20`, [orderId])
      : { rows: [] };
    const byMsisdn = (mAny && mAny.length)
      ? await qT(`SELECT * FROM eligibility_logs WHERE msisdn = ANY($1::text[]) ${anchor ? `AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz` : ''} ORDER BY created_at DESC LIMIT 20`, anchor ? [mAny, wLo, wHi] : [mAny])
      : { rows: [] };
    const seen = new Set();
    [...byOrder.rows, ...byMsisdn.rows].forEach(e => {
      if (seen.has(String(e.id))) return; seen.add(String(e.id));
      add(e.created_at, 'eligibility_logs', 'eligibility', e.state === true, `${e.process || e.api} · ${e.status_code || ''}`,
        { endpoint: e.api,
          rr: { req: 'FULL stored request — exactly as the app logged it', res: 'FULL stored response — exactly as the app logged it' },
          request: (nonEmpty(e.request) && nonEmpty(e.request_data)) ? { request: e.request, request_data: e.request_data } : (nonEmpty(e.request) || nonEmpty(e.request_data)),
          response: nonEmpty(e.response), ms: elapsed(e), status: e.status_code });
    });
  })());
  // nafath by national id
  if (nid) {
    tasks.push((async () => {
      const nf = anchor
        ? await qT(`SELECT * FROM nafath_logs WHERE nationality_id_number = $1 AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz ORDER BY created_at LIMIT 20`, [nid, wLo, wHi])
        : await qT(`SELECT * FROM nafath_logs WHERE nationality_id_number = $1 ORDER BY created_at LIMIT 20`, [nid]);
      const nafOk = s => { s = String(s || '').toUpperCase(); if (/COMPLETED/.test(s)) return true; if (/EXPIRED|REJECT|FAIL|DENIED|CANCELL?ED/.test(s)) return false; return null; };
      nf.rows.forEach(x => add(x.created_at, 'nafath_logs', 'nafath', nafOk(x.status), `${x.service || ''} · ${x.status}`,
        { endpoint: `Nafath / IAM authorize (external) · ${x.service || ''}`,
          rr: { req: 'NAFATH ROW — identifiers & context from our DB (token_data withheld by design)',
                res: 'FULL stored provider response + callback — complete as the app saved them' },
          request: nonEmpty({ nationality_id_number: x.nationality_id_number, service: x.service, trans_id: x.trans_id,
            auth_type: x.auth_type, platform: x.platform, app_version: x.app_version, channel_id: x.channel_id }),
          response: nonEmpty({ status: x.status, response: nonEmpty(x.response), callback: nonEmpty(x.callback) }),
          ms: elapsed(x), status: x.status }));
    })());
  }
  // delivery
  tasks.push((async () => {
    const del = scopeByOrder
      ? await qT(`SELECT * FROM delivery_requests WHERE delivery_on_id = $1 ORDER BY created_at LIMIT 20`, [orderId])
      : await qT(`SELECT * FROM delivery_requests WHERE (delivery_on_id = $1 OR receiver_mobile = ANY($2::text[]))
          ${anchor ? `AND created_at >= $3::timestamptz AND created_at <= $4::timestamptz` : ''} ORDER BY created_at LIMIT 20`, anchor ? [orderId || id, mAny, wLo, wHi] : [orderId || id, mAny]);
    const delOk = st => { if (DELIVERY_FAILED.includes(st)) return false; return /delivered|completed|DELIVERED|DL|POD/.test(st || '') ? true : null; };
    // TRANSPARENT delivery event — every field says what it is and where it lives. The DB keeps
    // a SUMMARY of the courier journey (delivery_requests row); the exact wire JSON is in
    // sidekiq.log (⇄ Courier wire button). No arbitrary field subsets, no fake req/res.
    del.rows.forEach(d => add(d.created_at, 'delivery_requests', 'delivery', delOk(d.delivery_state),
      `${d.vendor} · ${d.delivery_state}`,
      { endpoint: d.vendor === 'oto' ? 'POST api.tryoto.com /rest/v2/createOrder — exact body: ⇄ Courier wire'
                                     : `courier ${d.vendor || '?'} API — exact body: ⇄ Courier wire`,
        rr: { req: 'SENT TO COURIER — summary from our DB (exact JSON body: ⇄ Courier wire)',
              res: 'COURIER PROGRESS — initialization ACK + LATEST callback (the DB keeps only the latest)' },
        request: nonEmpty({
          sent_at: d.created_at,
          orderId_we_sent: d.internal_reference_id,          // = createOrder body "orderId"
          our_order_id: d.delivery_on_id,
          receiver_mobile: d.receiver_mobile,
          vendor: d.vendor }),
        response: nonEmpty({
          courier_shipment_id: d.external_reference_id,      // = "otoId" from the courier's ACK
          initialization_ack: nonEmpty(d.delivery_initialization_response),
          latest_callback: nonEmpty(d.callback_response),
          current_state: d.delivery_state,
          delivered_at: d.delivered_at }),
        ms: elapsed(d, 'delivered_at'), status: d.delivery_state }));
  })());
  // change plan
  if (mobile) {
    tasks.push((async () => {
      const cp = anchor
        ? await qT(`SELECT * FROM change_plan_logs WHERE mobile_number = ANY($1::text[]) AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz ORDER BY created_at LIMIT 20`, [mAny, wLo, wHi])
        : await qT(`SELECT * FROM change_plan_logs WHERE mobile_number = ANY($1::text[]) ORDER BY created_at LIMIT 20`, [mAny]);
      cp.rows.forEach(c => add(c.created_at, 'change_plan_logs', 'change_plan', c.status === 1 ? true : (c.status === 2 ? false : null),
        `${plans.label(pmap, c.from_plan)} → ${plans.label(pmap, c.to_plan)} · status=${c.status}`,
        { endpoint: 'change_plan (BSS plan migration — API detail: ⇄ APIGW / activation_logs)',
          rr: { req: 'PLAN-CHANGE ROW — full (this table stores no API payloads; status 0=pending 1=success 2=failed)',
                res: 'outcome' },
          request: nonEmpty({ from_plan: c.from_plan, to_plan: c.to_plan, mobile_number: c.mobile_number, payment_id: c.payment_id }),
          response: nonEmpty({ status: c.status, final_step_message: c.final_step_message }), ms: elapsed(c), status: c.status }));
    })());
  }

  // OTP steps — the verification gates the customer passed (or abandoned) during this journey
  if (mAny && mAny.length) {
    tasks.push((async () => {
      const ot = anchor
        ? await qT(`SELECT * FROM otps WHERE otp_for = ANY($1::text[]) AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz ORDER BY created_at LIMIT 20`, [mAny, wLo, wHi])
        : await qT(`SELECT * FROM otps WHERE otp_for = ANY($1::text[]) ORDER BY created_at DESC LIMIT 10`, [mAny]);
      ot.rows.forEach(o => add(o.created_at, 'otps', 'otp',
        o.verified === true ? true : null,                        // unverified = abandoned, not failed
        `OTP ${o.delivery_method || 'sms'} (${o.otp_type || 'mobile_number'}) · ${o.verified ? 'VERIFIED' : 'not verified'}`,
        { endpoint: `otp · ${o.delivery_method || 'sms'}`,
          rr: { req: 'OTP ROW — full (the code itself is never shown; the table stores nothing else)',
                res: 'verification outcome' },
          request: nonEmpty({ otp_for: o.otp_for, otp_type: o.otp_type, delivery_method: o.delivery_method,
            confirmation_reference: o.confirmation_reference }),
          response: { verified: o.verified, verified_at: o.verified ? o.updated_at : null },
          ms: o.verified ? elapsed(o) : null, status: o.verified ? 'verified' : 'sent' }));
    })());
  }

  // Customer account state — is this customer registered / logged in? App JWTs live 7 days
  // (JsonWebToken.encode exp = 7.days), so "logged in" = current_sign_in_at within the last 7d.
  let customer = null;
  tasks.push((async () => {
    if (!mAny || !mAny.length) return;
    const u = await qT(`SELECT mobile_number, verified, verified_email, sign_in_count,
        current_sign_in_at, last_sign_in_at, current_sign_in_ip, platform, app_version, os_version, created_at
      FROM users WHERE mobile_number = ANY($1::text[]) LIMIT 1`, [mAny]);
    if (!u.rows.length) { customer = { registered: false }; return; }
    const r = u.rows[0];
    const lastLogin = r.current_sign_in_at || r.last_sign_in_at;
    const ageMs = lastLogin ? Date.now() - new Date(lastLogin).getTime() : null;
    customer = {
      registered: true, verified: r.verified, verified_email: r.verified_email,
      sign_in_count: r.sign_in_count,
      last_login_at: lastLogin, prev_login_at: r.last_sign_in_at,
      // JWT valid 7 days → within 7d the app can still be using a live session token
      logged_in: ageMs != null && ageMs < 7 * 24 * 3600e3,
      last_login_ip: r.current_sign_in_ip || null,
      platform: r.platform, app_version: r.app_version, os_version: r.os_version,
      registered_at: r.created_at
    };
    // show the login as a journey step when it happened inside this journey's window
    if (lastLogin && (!anchor || (new Date(lastLogin) >= new Date(wLo) && new Date(lastLogin) <= new Date(wHi))))
      add(lastLogin, 'users', 'login', true,
        `App login · ${r.platform || '?'} v${r.app_version || '?'} · sign-in #${r.sign_in_count}`,
        { endpoint: 'sessions#create (app sign-in)',
          rr: { res: 'USER ROW — sign-in metadata from our DB (Devise trackable fields)' },
          request: null,
          response: { platform: r.platform, app_version: r.app_version, os_version: r.os_version, sign_in_count: r.sign_in_count }, status: 'authenticated' });
  })());

  await Promise.all(tasks);
  // guarantee the exact clicked transaction is shown even if the journey lookups missed it (no order/msisdn link)
  if (rowId && !events.length) await addDirectRow(rowId, add, nonEmpty, elapsed);

  events.sort((a,b) => new Date(a.at) - new Date(b.at));
  return { identifier: id, order, events, customer };
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
  } else if (category === 'activation') {
    // BSS / Semati write-path failures, keyed by status_code with the API as the message so the
    // Troubleshoot chip filter reads "<code> · <api>" (e.g. 727 · semati/transfer-operator).
    sql = `
      SELECT COALESCE(NULLIF(status_code,''), response->>'responseCode', '—') AS code,
             regexp_replace(api, '^/', '') AS message,
             count(*)::int AS count
      FROM activation_logs
      WHERE state=false
        AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
      GROUP BY 1,2 ORDER BY count DESC LIMIT 50`;
  } else if (category === 'delivery') {
    // Delivery failures keyed by the courier reason (attemptFailureReason), with the raw state as the message.
    sql = `
      SELECT (${DEL_REASON}) AS code, COALESCE(NULLIF(delivery_state,''),'') AS message, count(*)::int AS count
      FROM delivery_requests
      WHERE delivery_state = ANY($3)
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
  const r = await db.source.query(sql, category === 'delivery' ? [n, w, DELIVERY_FAILED] : [n, w]);
  const total = r.rows.reduce((a, x) => a + Number(x.count), 0);
  const known = ['semati', 'nafath', 'payment', 'activation', 'delivery'];
  // Payment tile: also break failures down by GATEWAY (UPG / HyperPay / Tap / Tamara / Emkan / Samsung Pay / …).
  let gateways = null;
  if (category === 'payment') {
    const g = await db.source.query(
      `SELECT (${GW_EXPR}) AS gw, count(*)::int AS count FROM payments
       WHERE status IN ('fail','failed') AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
       GROUP BY 1 ORDER BY count DESC LIMIT 20`, [n, w]);
    gateways = g.rows;
  }
  return { category: known.includes(category) ? category : 'semati', total, codes: r.rows, gateways };
}

/* BSS / Semati activation layer, broken down by API × status_code with ok/fail counts (from
 * activation_logs). Shows the WRITE-path health — BSS account/subscriber create, Semati number
 * provisioning, transfer-operator, etc. — so you can see, per endpoint, what BSS/Semati is returning
 * (00/600 = ok, 7xx/8xx = Semati errors, etc.).
 * NOTE: the BSS READ-path SOAP faults (response 1500 / "OSB-382000" on list-invoices / get-account /
 * get-sub / list-account) are logged in the integration layer (logs.uil_logs on the OSB side), which
 * is NOT replicated into this console — so they cannot appear here. See osbReadPathNote(). */
async function bssBreakdown({ now, windowHours = 24 }) {
  const n = now ? new Date(now).toISOString() : new Date().toISOString();
  const w = windowHours;
  const r = await db.source.query(`
    SELECT regexp_replace(api, '^/', '') AS api,
           COALESCE(NULLIF(status_code,''), response->>'responseCode', '—') AS code,
           count(*) FILTER (WHERE state = true)::int AS ok,
           count(*) FILTER (WHERE state IS DISTINCT FROM true)::int AS fail,
           count(*)::int AS count
    FROM activation_logs
    WHERE created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
    GROUP BY 1, 2 ORDER BY count DESC LIMIT 300`, [n, w]);
  const rows = r.rows.map(x => ({ api: x.api, code: x.code, ok: Number(x.ok), fail: Number(x.fail), count: Number(x.count) }));
  const total = rows.reduce((a, x) => a + x.count, 0);
  const fails = rows.reduce((a, x) => a + x.fail, 0);
  const byApi = {};
  rows.forEach(x => { const a = (byApi[x.api] || (byApi[x.api] = { api: x.api, ok: 0, fail: 0, codes: {} }));
    a.ok += x.ok; a.fail += x.fail; if (x.fail > 0) a.codes[x.code] = (a.codes[x.code] || 0) + x.fail; });
  const apis = Object.values(byApi).map(a => ({
    api: a.api, ok: a.ok, fail: a.fail, total: a.ok + a.fail,
    failRate: (a.ok + a.fail) ? a.fail / (a.ok + a.fail) : 0,
    topFailCode: Object.entries(a.codes).sort((x, y) => y[1] - x[1])[0] ? Object.entries(a.codes).sort((x, y) => y[1] - x[1])[0][0] : null,
    codes: Object.entries(a.codes).sort((x, y) => y[1] - x[1]).map(([code, c]) => ({ code, count: c }))
  })).sort((x, y) => y.total - x.total);
  return { total, fails, failRate: total ? fails / total : 0, apis, rows, osb: osbReadPathNote() };
}

// Static reference for the BSS READ-path OSB faults that this replica can't see (they live in the
// OSB integration log, logs.uil_logs). Surfaced in the console so ops isn't misled by "no 1500 here".
function osbReadPathNote() {
  return {
    code: '1500', fault: 'OSB-382000 (Client received SOAP Fault — read/timeout)',
    apis: ['bss/invoices/list-invoices', 'bss/account/list-account', 'bss/account/get-account', 'bss/subscription/get-sub'],
    source: 'logs.uil_logs (OSB integration layer — not replicated into this console)',
    impact: 'Powers plan-catalogue load, account details & balance reads → app shows "not found / details missing", greyed balance transfer, slowness.',
    since: 'IMPACT R7.2 Siebel CNE go-live (24 Jul 2026) — intermittent bursts of ~100–200/min, trending down.'
  };
}

module.exports = { CATEGORIES, summary, feed, timeline, resolveRow, codeBreakdown, bssBreakdown, osbReadPathNote, STUCK_COND };
