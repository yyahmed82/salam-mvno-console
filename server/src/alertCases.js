/* alertCases.js — THE CASES BEHIND AN ALERT: the exact rows a metric counted when the rule fired.
 *
 * An alert is "metric X over the last W hours ending at T breached threshold". The list that L1/L2 needs is the
 * NUMERATOR of that computation — every failed payment / refused activation / expired Nafath request … inside
 * [T − W, T]. Each entry below mirrors its metric's compute() in metrics.js / fixedMetrics.js 1:1 (same table, same
 * predicate, same window bounds, same dimension filter), so the row count equals the value the rule saw (for count
 * metrics) or the numerator of the rate (for rate metrics — the denominator is reported alongside). If a metric's
 * SQL changes, change the twin here — the export must never describe a different population than the alert.
 *
 * T = alerts.last_seen_at (the evaluation that last kept the alert open) — or fired_at with ?at=first.
 *   GET /api/alerts/:id/cases?format=json|xlsx|pdf&at=last|first   (cap: export for files; json = 200 rows preview)
 * PII is masked exactly as on the boards unless the exporting role holds unmaskPII. Read-only, bounded (5 000 rows). */
'use strict';
const db = require('./db');
const roles = require('./roles');
const errclass = require('./errclass');
const M = require('./metrics').SQL;          // shared SQL fragments (SEMATI_UNION, SEM_TRANSPORT, GW_CASE, state lists)
const F = require('./fixedMetrics');         // FIXED_PARAMS, TICKET_SCOPES, FIVE_G, ERR_SEV, effSev
const { segOf } = require('./segment');

const CAP = 5000;
const WIN = `created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`;
const ksa = iso => { try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', ''); } catch (_) { return String(iso || ''); } };
const clip = (v, n) => { const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const PAY_CODE = `COALESCE(NULLIF(payment_commit_response#>>'{gateway,response,code}',''), NULLIF(payment_initialization_response#>>'{gateway,response,code}',''), '')`;
const PAY_MSG = `COALESCE(NULLIF(payment_commit_response#>>'{gateway,response,message}',''), NULLIF(payment_initialization_response#>>'{gateway,response,message}',''), NULLIF(fail_reason,''), '')`;
const PAY_COLS = `id::text AS id, created_at, customer_mobile_number AS mobile, amount, status, vendor, platform, payment_method, payment_on_type, payment_on_id, payment_reference_id AS ref, ${PAY_CODE} AS code, ${PAY_MSG} AS message`;
const PAY_HEAD = [['created_at', 'Time (KSA)'], ['mobile', 'Mobile'], ['amount', 'Amount'], ['status', 'Status'], ['vendor', 'Gateway'], ['platform', 'Platform'], ['payment_method', 'Method'], ['payment_on_type', 'Paid for'], ['payment_on_id', 'Target id'], ['ref', 'Gateway ref'], ['code', 'Decline code'], ['message', 'Decline message'], ['id', 'Payment id']];
const ACT_COLS = `id::text AS id, created_at, api, status_code, msisdn, onboarding_order_id::text AS order_id, platform, state, left(response::text, 800) AS response`;
const ACT_HEAD = [['created_at', 'Time (KSA)'], ['api', 'API'], ['status_code', 'Code'], ['msisdn', 'MSISDN'], ['order_id', 'Order id'], ['platform', 'Platform'], ['state', 'State'], ['response', 'Response'], ['id', 'Row id']];
const SEM_COLS = `created_at, api, status_code, state, left(response::text, 800) AS response`;
const SEM_HEAD = [['created_at', 'Time (KSA)'], ['api', 'API'], ['status_code', 'Code'], ['state', 'State'], ['response', 'Response']];
const NAF_COLS = `id::text AS id, created_at, status, service, nationality_id_number AS nid, COALESCE(NULLIF(response->'response'->>'status',''), status) AS code, response->'response'->>'message' AS message`;
const NAF_HEAD = [['created_at', 'Time (KSA)'], ['status', 'Status'], ['service', 'Service'], ['nid', 'National id'], ['code', 'Code'], ['message', 'Message'], ['id', 'Row id']];
const CPL_COLS = `id::text AS id, created_at, mobile_number AS mobile, from_plan, to_plan, status, final_step_message, payment_id`;
const CPL_HEAD = [['created_at', 'Time (KSA)'], ['mobile', 'Mobile'], ['from_plan', 'From plan'], ['to_plan', 'To plan'], ['final_step_message', 'Last step / message'], ['payment_id', 'Payment id'], ['id', 'Row id']];
const DEL_COLS = `id::text AS id, created_at, vendor, delivery_state, submitted, receiver_mobile AS mobile, delivery_on_id AS order_id, external_reference_id`;
const DEL_HEAD = [['created_at', 'Time (KSA)'], ['vendor', 'Courier'], ['delivery_state', 'State'], ['mobile', 'Receiver mobile'], ['order_id', 'Order id'], ['external_reference_id', 'Courier ref'], ['id', 'Row id']];
const OWN = `EXISTS (SELECT 1 FROM payments p JOIN checkouts c ON c.id::text = p.payment_on_id WHERE p.payment_on_type = 'Checkout' AND p.id::text = change_plan_logs.payment_id AND c.checkout_type = 5)`;
const cls = (codeExpr, textExpr) => errclass.classCaseSql(codeExpr, textExpr);

/* dim filters that the compute() GROUPING SETS produce — applied verbatim */
const dimSql = (dim, p, map) => { let s = ''; for (const [k, expr] of Object.entries(map)) if (dim && dim[k] != null && dim[k] !== '' && dim[k] !== 'unknown') { p.push(String(dim[k])); s += ` AND ${expr} = $${p.length}`; } return s; };

/* each entry: (alert, T, W, dim) → { pool, sql, params, head, denom?: {sql, params}, note } */
const CASES = {
  payment_fail_rate: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { platform: 'platform', vendor: 'vendor' });
    return { pool: db.source, head: PAY_HEAD, sql: `SELECT ${PAY_COLS} FROM payments WHERE status IN ('fail','failed') AND ${WIN}${f} ORDER BY created_at DESC`, params: p,
      denom: { sql: `SELECT count(*)::int n FROM payments WHERE status IN ('success','fail','failed') AND ${WIN}${f}`, params: p }, note: 'failed payments (numerator) · denominator = success + failed in the window' }; },
  payment_volume: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { platform: 'platform' });
    return { pool: db.source, head: PAY_HEAD, sql: `SELECT ${PAY_COLS} FROM payments WHERE status='success' AND ${WIN}${f} ORDER BY created_at DESC`, params: p, note: 'the successful payments that were counted (a LOW value alert lists what did succeed)' }; },
  gateway_success_volume: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { gateway: `(${M.GW_CASE})` });
    return { pool: db.source, head: PAY_HEAD, sql: `SELECT ${PAY_COLS} FROM payments WHERE ${WIN}${f} ORDER BY created_at DESC`, params: p, note: 'every payment on this gateway in the window (all statuses) — a zero-success watchdog fires on what did NOT succeed, so the whole gateway traffic is listed' }; },
  zatca_unreported: (a, T, W) => ({ pool: db.source, head: PAY_HEAD, sql: `SELECT ${PAY_COLS} FROM payments WHERE status='success' AND ${WIN} AND COALESCE(NULLIF(extra->>'zatca',''), NULL) IS NULL ORDER BY created_at DESC`, params: [T, W], note: 'successful payments without a ZATCA report' }),
  payment_stuck_initiated: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { vendor: 'vendor' });
    return { pool: db.source, head: PAY_HEAD, sql: `SELECT ${PAY_COLS} FROM payments WHERE lower(status) IN ('pending','initiated') AND payment_commit_response IS NOT NULL AND payment_commit_response::text NOT IN ('','{}','null') AND created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz - interval '30 minutes'${f} ORDER BY created_at DESC`, params: p, note: 'gateway committed, app never finalised, older than 30 min' }; },
  payment_duplicate_suspect: (a, T, W) => ({ pool: db.source, head: PAY_HEAD, sql: `SELECT ${PAY_COLS} FROM payments WHERE status='success' AND ${WIN} AND (customer_mobile_number, amount, payment_on_type, payment_on_id) IN (SELECT customer_mobile_number, amount, payment_on_type, payment_on_id FROM payments WHERE status='success' AND ${WIN} GROUP BY 1,2,3,4 HAVING count(*) > 1 AND (max(created_at) - min(created_at)) < interval '30 minutes') ORDER BY customer_mobile_number, amount, created_at`, params: [T, W], note: 'every payment belonging to a suspected duplicate group (the metric counts GROUPS; the rows are all charges in those groups)' }),
  recharge_fail_rate: (a, T, W) => { const PC = `p.id::text AS id, p.created_at, p.customer_mobile_number AS mobile, p.amount, p.status, p.vendor, p.platform, p.payment_method, p.payment_on_type, p.payment_on_id, p.payment_reference_id AS ref, COALESCE(NULLIF(p.payment_commit_response#>>'{gateway,response,code}',''), NULLIF(p.payment_initialization_response#>>'{gateway,response,code}',''), '') AS code, COALESCE(NULLIF(p.payment_commit_response#>>'{gateway,response,message}',''), NULLIF(p.payment_initialization_response#>>'{gateway,response,message}',''), NULLIF(p.fail_reason,''), '') AS message`;
    return { pool: db.source, head: PAY_HEAD, sql: `SELECT ${PC} FROM payments p JOIN checkouts c ON c.id::text = p.payment_on_id WHERE p.payment_on_type='Checkout' AND c.checkout_type = 6 AND p.status IN ('fail','failed') AND p.created_at >= $1::timestamptz - ($2||' hours')::interval AND p.created_at < $1::timestamptz ORDER BY p.created_at DESC`, params: [T, W],
      denom: { sql: `SELECT count(*)::int n FROM payments p JOIN checkouts c ON c.id::text = p.payment_on_id WHERE p.payment_on_type='Checkout' AND c.checkout_type = 6 AND p.status IN ('success','fail','failed') AND p.created_at >= $1::timestamptz - ($2||' hours')::interval AND p.created_at < $1::timestamptz`, params: [T, W] }, note: 'failed recharge / renewal payments (checkout type 6)' }; },
  samsung_pay_fail_rate: (a, T, W) => ({ pool: db.source, head: PAY_HEAD, sql: `SELECT ${PAY_COLS} FROM payments WHERE (payment_method ILIKE '%samsung%' OR vendor ILIKE '%samsung%') AND status IN ('fail','failed') AND ${WIN} ORDER BY created_at DESC`, params: [T, W],
    denom: { sql: `SELECT count(*)::int n FROM payments WHERE (payment_method ILIKE '%samsung%' OR vendor ILIKE '%samsung%') AND status IN ('success','fail','failed') AND ${WIN}`, params: [T, W] }, note: 'failed Samsung Pay payments' }),

  nafath_fail_rate: (a, T, W) => ({ pool: db.source, head: NAF_HEAD, sql: `SELECT ${NAF_COLS} FROM nafath_logs WHERE lower(status) = ANY($3) AND ${WIN} ORDER BY created_at DESC`, params: [T, W, M.NAFATH_FAILED],
    denom: { sql: `SELECT count(*)::int n FROM nafath_logs WHERE (lower(status) = ANY($3) OR lower(status) = ANY($4)) AND ${WIN}`, params: [T, W, M.NAFATH_FAILED, M.NAFATH_SUCCESS] }, note: 'Nafath requests in a failed terminal state (expired / rejected / failed / cancelled / denied)' }),
  semati_fail_rate: (a, T, W) => { const prov = `(${M.SEM_TRANSPORT} OR ${M.SEM_UNAVAIL})`;
    return { pool: db.source, head: ACT_HEAD, sql: `SELECT ${ACT_COLS} FROM activation_logs WHERE api ILIKE '%semati%' AND state = false AND NOT ${prov} AND ${WIN} ORDER BY created_at DESC`, params: [T, W],
      denom: { sql: `SELECT count(*)::int n FROM activation_logs WHERE api ILIKE '%semati%' AND NOT ${prov} AND ${WIN}`, params: [T, W] }, note: 'Semati BUSINESS refusals (715 / transport rows excluded — those belong to the provider-error alerts)' }; },
  semati_provider_error_rate: (a, T, W, d) => { const p = [T, W]; const f = d && d.endpoint ? ` AND (${M.SEM_ENDPOINT}) = $3` : ''; if (f) p.push(String(d.endpoint));
    return { pool: db.source, head: SEM_HEAD, sql: `SELECT ${SEM_COLS} FROM (${M.SEMATI_UNION}) u WHERE (${M.SEM_TRANSPORT} OR ${M.SEM_UNAVAIL})${f} ORDER BY created_at DESC`, params: p,
      denom: { sql: `SELECT count(*)::int n FROM (${M.SEMATI_UNION}) u WHERE TRUE${f}`, params: p }, note: 'Semati calls (activation + eligibility) answered 715 "not available" or failed at transport (5002 / reset / SSL / 408)' }; },
  semati_transport_error_rate: (a, T, W) => ({ pool: db.source, head: SEM_HEAD, sql: `SELECT ${SEM_COLS} FROM (${M.SEMATI_UNION}) u WHERE ${M.SEM_TRANSPORT} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM (${M.SEMATI_UNION}) u`, params: [T, W] }, note: 'Semati transport failures (5002 / connection reset / SSL / 408)' }),
  semati_timeout_count: (a, T, W) => ({ pool: db.source, head: SEM_HEAD, sql: `SELECT ${SEM_COLS} FROM (${M.SEMATI_UNION}) u WHERE COALESCE(status_code,'')='408' OR response::text ILIKE '%[408]%' OR response::text ILIKE '%timeout%' ORDER BY created_at DESC`, params: [T, W], note: 'Semati HTTP 408 / timeout rows' }),
  semati_success_volume: (a, T, W) => ({ pool: db.source, head: SEM_HEAD, sql: `SELECT ${SEM_COLS} FROM (${M.SEMATI_UNION}) u ORDER BY created_at DESC`, params: [T, W], note: 'every Semati call in the window (all outcomes) — the zero-success watchdog fires on the absence of successes' }),
  semati_flapping: (a, T, W) => ({ pool: db.source, head: SEM_HEAD, sql: `WITH s AS (SELECT ${SEM_COLS}, (state = false AND (${M.SEM_TRANSPORT} OR ${M.SEM_UNAVAIL})) AS provfail, lag(state) OVER (ORDER BY created_at) AS prev FROM (${M.SEMATI_UNION}) u) SELECT created_at, api, status_code, state, response FROM s WHERE provfail AND prev = true ORDER BY created_at DESC`, params: [T, W], note: 'each ok → provider-error flip (the provider-error row that followed a success)' }),
  citc_upstream_degraded: (a, T, W) => ({ pool: db.source, head: SEM_HEAD, sql: `SELECT ${SEM_COLS} FROM (${M.SEMATI_UNION}) u WHERE (${M.SEM_TRANSPORT} OR ${M.SEM_UNAVAIL}) ORDER BY created_at DESC`, params: [T, W], note: 'Semati half of the composite (provider-error rows); the Nafath half is on the nafath_fail_rate alert' }),

  activation_fail_rate: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { platform: 'platform' });
    return { pool: db.source, head: ACT_HEAD, sql: `SELECT ${ACT_COLS} FROM activation_logs WHERE state = false AND ${WIN}${f} ORDER BY created_at DESC`, params: p, denom: { sql: `SELECT count(*)::int n FROM activation_logs WHERE ${WIN}${f}`, params: p }, note: 'failed activation calls (Semati included)' }; },
  activation_fail_rate_technical: (a, T, W) => { const c = cls('status_code', `coalesce(response::text,'')`);
    return { pool: db.source, head: ACT_HEAD, sql: `SELECT ${ACT_COLS} FROM activation_logs WHERE state IS DISTINCT FROM true AND (${c}) = 'technical' AND COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM activation_logs WHERE COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}`, params: [T, W] }, note: 'TECHNICAL activation failures (1500 / 5xx / timeouts / SOAP faults), Semati excluded' }; },
  activation_fail_rate_business: (a, T, W) => { const c = cls('status_code', `coalesce(response::text,'')`);
    return { pool: db.source, head: ACT_HEAD, sql: `SELECT ${ACT_COLS} FROM activation_logs WHERE state IS DISTINCT FROM true AND (${c}) = 'business' AND COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM activation_logs WHERE COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}`, params: [T, W] }, note: 'BUSINESS activation refusals (well-formed "no"), Semati excluded' }; },
  bss_write_fail_rate: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { api: `regexp_replace(api, '^/', '')` });
    return { pool: db.source, head: ACT_HEAD, sql: `SELECT ${ACT_COLS} FROM activation_logs WHERE state IS DISTINCT FROM true AND COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}${f} ORDER BY created_at DESC`, params: p, denom: { sql: `SELECT count(*)::int n FROM activation_logs WHERE COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}${f}`, params: p }, note: 'failed BSS activation calls (Semati excluded)' }; },
  bss_fail_burst: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { api: `regexp_replace(api, '^/', '')` });
    return { pool: db.source, head: ACT_HEAD, sql: `SELECT ${ACT_COLS} FROM activation_logs WHERE state IS DISTINCT FROM true AND COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}${f} ORDER BY created_at DESC`, params: p, note: 'failed BSS activation calls (Semati excluded) — count metric' }; },
  bss_soap_fault: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { api: `regexp_replace(api, '^/', '')` });
    const FAULT = `(COALESCE(status_code,'') = '1500' OR response->>'responseCode' = '1500' OR response::text ILIKE '%"responseCode":"1500"%' OR response::text ILIKE '%unexpected XML tag%' OR response::text ILIKE '%soap/envelope}Fault%')`;
    return { pool: db.source, head: ACT_HEAD, sql: `SELECT ${ACT_COLS} FROM activation_logs WHERE ${FAULT} AND ${WIN}${f} ORDER BY created_at DESC`, params: p, note: 'activation calls that received a SOAP Fault / responseCode 1500 (write path)' }; },
  bss_top_error_share: (a, T, W, d) => { const p = [T, W]; const f = d && d.code ? ` AND COALESCE(NULLIF(status_code,''), response->>'responseCode', 'unknown') = $3` : ''; if (f) p.push(String(d.code));
    return { pool: db.source, head: ACT_HEAD, sql: `SELECT ${ACT_COLS} FROM activation_logs WHERE state IS DISTINCT FROM true AND COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}${f} ORDER BY created_at DESC`, params: p, denom: { sql: `SELECT count(*)::int n FROM activation_logs WHERE state IS DISTINCT FROM true AND COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}`, params: [T, W] }, note: 'failed BSS calls carrying the dominant error code (denominator = all failed BSS calls)' }; },
  eligibility_deny_rate: (a, T, W) => { const prov = `(${M.SEM_TRANSPORT} OR ${M.SEM_UNAVAIL})`;
    return { pool: db.source, head: ACT_HEAD, sql: `SELECT ${ACT_COLS} FROM eligibility_logs WHERE state = false AND NOT ${prov} AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM eligibility_logs WHERE NOT ${prov} AND ${WIN}`, params: [T, W] }, note: 'eligibility denials (Semati provider errors excluded)' }; },

  onboarding_abandoned: (a, T, W) => ({ pool: db.source, head: [['created_at', 'Created (KSA)'], ['mobile', 'Mobile'], ['nid', 'National id'], ['delivery_type', 'Delivery'], ['external_service_name', 'Channel'], ['id', 'Order id']], sql: `SELECT id::text AS id, created_at, mobile_number AS mobile, nationality_id_number AS nid, delivery_type, external_service_name FROM onboarding_orders WHERE completed = false AND activated = false AND ${WIN} ORDER BY created_at DESC`, params: [T, W], note: 'onboarding orders neither completed nor activated' }),
  onboarding_conversion: (a, T, W) => ({ pool: db.source, head: [['created_at', 'Created (KSA)'], ['mobile', 'Mobile'], ['completed', 'Completed'], ['activated', 'Activated'], ['delivery_type', 'Delivery'], ['id', 'Order id']], sql: `SELECT id::text AS id, created_at, mobile_number AS mobile, completed, activated, delivery_type FROM onboarding_orders WHERE completed = false AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM onboarding_orders WHERE ${WIN}`, params: [T, W] }, note: 'orders NOT completed (a low-conversion alert lists what did not convert; denominator = all orders created)' }),

  change_plan_fail_rate: (a, T, W) => ({ pool: db.source, head: CPL_HEAD, sql: `SELECT ${CPL_COLS} FROM change_plan_logs WHERE status = 2 AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM change_plan_logs WHERE status IN (1,2) AND ${WIN}`, params: [T, W] }, note: 'failed plan changes (status 2)' }),
  change_plan_fail_rate_technical: (a, T, W) => { const c = cls('NULL::text', `coalesce(final_step_message,'')`); return { pool: db.source, head: CPL_HEAD, sql: `SELECT ${CPL_COLS} FROM change_plan_logs WHERE status = 2 AND (${c}) = 'technical' AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM change_plan_logs WHERE status IN (1,2) AND ${WIN}`, params: [T, W] }, note: 'TECHNICAL plan-change failures' }; },
  change_plan_fail_rate_business: (a, T, W) => { const c = cls('NULL::text', `coalesce(final_step_message,'')`); return { pool: db.source, head: CPL_HEAD, sql: `SELECT ${CPL_COLS} FROM change_plan_logs WHERE status = 2 AND (${c}) = 'business' AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM change_plan_logs WHERE status IN (1,2) AND ${WIN}`, params: [T, W] }, note: 'BUSINESS plan-change refusals' }; },
  ownership_fail_rate: (a, T, W) => ({ pool: db.source, head: CPL_HEAD, sql: `SELECT ${CPL_COLS} FROM change_plan_logs WHERE status = 2 AND ${OWN} AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM change_plan_logs WHERE status IN (1,2) AND ${OWN} AND ${WIN}`, params: [T, W] }, note: 'failed ownership transfers (checkout type 5)' }),
  ownership_fail_rate_technical: (a, T, W) => { const c = cls('NULL::text', `coalesce(final_step_message,'')`); return { pool: db.source, head: CPL_HEAD, sql: `SELECT ${CPL_COLS} FROM change_plan_logs WHERE status = 2 AND (${c}) = 'technical' AND ${OWN} AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM change_plan_logs WHERE status IN (1,2) AND ${OWN} AND ${WIN}`, params: [T, W] }, note: 'TECHNICAL ownership-transfer failures' }; },
  ownership_fail_rate_business: (a, T, W) => { const c = cls('NULL::text', `coalesce(final_step_message,'')`); return { pool: db.source, head: CPL_HEAD, sql: `SELECT ${CPL_COLS} FROM change_plan_logs WHERE status = 2 AND (${c}) = 'business' AND ${OWN} AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM change_plan_logs WHERE status IN (1,2) AND ${OWN} AND ${WIN}`, params: [T, W] }, note: 'BUSINESS ownership-transfer refusals' }; },

  delivery_fail_rate: (a, T, W, d) => { const p = [T, W, M.DELIVERY_FAILED]; const f = dimSql(d, p, { vendor: 'vendor' });
    return { pool: db.source, head: DEL_HEAD, sql: `SELECT ${DEL_COLS} FROM delivery_requests WHERE delivery_state = ANY($3) AND ${WIN}${f} ORDER BY created_at DESC`, params: p, denom: { sql: `SELECT count(*)::int n FROM delivery_requests WHERE ${WIN}${f}`, params: p }, note: 'deliveries in a failed / cancelled / refused state' }; },
  courier_worst_fail_rate: (a, T, W) => ({ pool: db.source, head: DEL_HEAD, sql: `SELECT ${DEL_COLS} FROM delivery_requests WHERE delivery_state = ANY($3) AND ${WIN} ORDER BY vendor, created_at DESC`, params: [T, W, M.DELIVERY_FAILED], note: 'failed deliveries, all couriers (the alert names the worst one)' }),
  delivery_stuck: (a, T, W) => ({ pool: db.source, head: DEL_HEAD, sql: `SELECT ${DEL_COLS} FROM delivery_requests WHERE submitted = true AND COALESCE(delivery_state,'') <> ALL($3) AND COALESCE(delivery_state,'') <> ALL($4) AND created_at < $1::timestamptz - ($2||' hours')::interval AND created_at > $1::timestamptz - interval '30 days' ORDER BY created_at DESC`, params: [T, W, M.DELIVERY_COMPLETED, M.DELIVERY_FAILED], note: 'submitted deliveries older than the window, neither completed nor failed (bounded to 30 days)' }),

  app_ip_block_count: (a, T, W) => ({ pool: db.console, head: [['ts', 'Time (KSA)'], ['error_code', 'Code'], ['endpoint', 'Endpoint'], ['rate_limit', 'Rate limit'], ['ip', 'IP'], ['message', 'Message']], sql: `SELECT ts, error_code, endpoint, rate_limit, ip, left(message, 300) AS message FROM api_error_events WHERE rate_limit='ip_retrial' AND ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz ORDER BY ts DESC`, params: [T, W], note: 'app error-log events blocked by the IP rate limit (-704)' }),
  app_crash_count: (a, T, W) => ({ pool: db.console, head: [['ts', 'Time (KSA)'], ['error_code', 'Code'], ['endpoint', 'Endpoint'], ['exception_class', 'Exception'], ['message', 'Message']], sql: `SELECT ts, error_code, endpoint, exception_class, left(message, 300) AS message FROM api_error_events WHERE error_code=-501 AND exception_class IS NOT NULL AND ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz ORDER BY ts DESC`, params: [T, W], note: 'unhandled exceptions (-501 with an exception class)' }),
  app_auth_fail_count: (a, T, W) => ({ pool: db.console, head: [['ts', 'Time (KSA)'], ['error_code', 'Code'], ['endpoint', 'Endpoint'], ['message', 'Message']], sql: `SELECT ts, error_code, endpoint, left(message, 300) AS message FROM api_error_events WHERE error_code IN (-201,-202,-203,-204,-205,-300,-301,-612) AND ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz ORDER BY ts DESC`, params: [T, W], note: 'auth / session / token failures from the app error log' }),
  app_backend_err_count: (a, T, W) => ({ pool: db.console, head: [['ts', 'Time (KSA)'], ['error_code', 'Code'], ['endpoint', 'Endpoint'], ['exception_class', 'Exception'], ['message', 'Message']], sql: `SELECT ts, error_code, endpoint, exception_class, left(message, 300) AS message FROM api_error_events WHERE (error_code IN (-500,-702,-20003) OR (error_code=-501 AND exception_class IS NULL)) AND ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz ORDER BY ts DESC`, params: [T, W], note: 'backend / provider errors from the app error log' }),
  otp_verify_rate: (a, T, W) => ({ pool: db.source, head: [['created_at', 'Sent (KSA)'], ['mobile', 'Target'], ['delivery_method', 'Method'], ['verified', 'Verified'], ['id', 'Row id']], sql: `SELECT id::text AS id, created_at, otp_for AS mobile, delivery_method, verified FROM otps WHERE delivery_method='sms' AND NOT verified AND ${WIN} ORDER BY created_at DESC`, params: [T, W], denom: { sql: `SELECT count(*)::int n FROM otps WHERE delivery_method='sms' AND ${WIN}`, params: [T, W] }, note: 'OTPs sent by SMS and never verified (denominator = all SMS OTPs sent)' }),

  /* ---- FIXED (sda_ops read model) ---- */
  fixed_error_p0p1_categories: (a, T) => ({ pool: db.ops, head: [['occurred_at', 'Time (KSA)'], ['category', 'Category'], ['code', 'Code'], ['message', 'Message'], ['dealer_code', 'Dealer'], ['region', 'Region'], ['order_number', 'Order'], ['attempt_id', 'Workflow id'], ['id', 'Event id']],
    sql: `SELECT id, occurred_at, category, code, left(message, 300) AS message, dealer_code, region, order_number, attempt_id FROM error_events WHERE occurred_at >= $1::timestamptz - ($2||' minutes')::interval AND occurred_at < $1::timestamptz AND resolved = false ORDER BY category, occurred_at DESC`, params: [T, F.FIXED_PARAMS.errorWindowMin], note: `open error events in the last ${F.FIXED_PARAMS.errorWindowMin} min, all categories (the metric counts the categories whose effective severity reached P0/P1 — see the Summary sheet per category)`, group: 'category' }),
  fixed_timeout_dealers: (a, T) => ({ pool: db.ops, head: [['occurred_at', 'Time (KSA)'], ['category', 'Category'], ['dealer_code', 'Dealer'], ['dealer_id', 'Dealer id'], ['region', 'Region'], ['message', 'Message'], ['attempt_id', 'Workflow id']],
    sql: `SELECT occurred_at, category, dealer_code, dealer_id, region, left(message, 300) AS message, attempt_id FROM error_events WHERE occurred_at >= $1::timestamptz - ($2||' minutes')::interval AND occurred_at < $1::timestamptz AND category IN ('TIMEOUT','NAFATH_TIMEOUT') ORDER BY dealer_code, occurred_at DESC`, params: [T, F.FIXED_PARAMS.timeoutWindowMin], note: `timeout events in the last ${F.FIXED_PARAMS.timeoutWindowMin} min (the metric counts distinct dealers)`, group: 'dealer_code' }),
  fixed_nafath_fail_rate: (a, T, W) => ({ pool: db.ops, head: [['started_at', 'Started (KSA)'], ['workflow', 'Journey'], ['channel', 'Channel'], ['nafath_outcome', 'Nafath'], ['outcome', 'Outcome'], ['dealer_code', 'Dealer'], ['region', 'Region'], ['id', 'Workflow id']],
    sql: `SELECT id, started_at, workflow::text AS workflow, channel, nafath_outcome, outcome::text AS outcome, dealer_code, region FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id WHERE started_at >= $1::timestamptz - ($2||' hours')::interval AND started_at <= $1::timestamptz AND nafath_outcome IS NOT NULL AND nafath_outcome <> 'COMPLETED' AND workflow::text = ANY($3::text[]) ORDER BY started_at DESC`, params: [T, W, ['fiveGWhiteLabel', 'fiveGFWA']],
    denom: { sql: `SELECT count(*)::int n FROM order_attempts WHERE started_at >= $1::timestamptz - ($2||' hours')::interval AND started_at <= $1::timestamptz AND nafath_outcome IS NOT NULL AND workflow::text = ANY($3::text[])`, params: [T, W, ['fiveGWhiteLabel', 'fiveGFWA']] }, note: '5G attempts whose Nafath step did not complete' }),
  fixed_semati_fail_rate: (a, T, W) => ({ pool: db.ops, head: [['started_at', 'Started (KSA)'], ['workflow', 'Journey'], ['channel', 'Channel'], ['nafath_outcome', 'Semati'], ['outcome', 'Outcome'], ['dealer_code', 'Dealer'], ['region', 'Region'], ['id', 'Workflow id']],
    sql: `SELECT id, started_at, workflow::text AS workflow, channel, nafath_outcome, outcome::text AS outcome, dealer_code, region FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id WHERE started_at >= $1::timestamptz - ($2||' hours')::interval AND started_at <= $1::timestamptz AND workflow::text = ANY($3::text[]) AND nafath_outcome IN ('FAILED','MOBILE_EXISTS') ORDER BY started_at DESC`, params: [T, W, ['fiveGWhiteLabel', 'fiveGFWA']],
    denom: { sql: `SELECT count(*)::int n FROM order_attempts WHERE started_at >= $1::timestamptz - ($2||' hours')::interval AND started_at <= $1::timestamptz AND workflow::text = ANY($3::text[]) AND nafath_outcome IN ('COMPLETED','FAILED','MOBILE_EXISTS')`, params: [T, W, ['fiveGWhiteLabel', 'fiveGFWA']] }, note: '5G attempts refused by Semati (FAILED / MOBILE_EXISTS)' }),
  fixed_manafith_deny_rate: (a, T, W) => ({ pool: db.ops, head: [['started_at', 'Started (KSA)'], ['workflow', 'Journey'], ['channel', 'Channel'], ['dealer_validation', 'Manafith'], ['outcome', 'Outcome'], ['dealer_code', 'Dealer'], ['region', 'Region'], ['id', 'Workflow id']],
    sql: `SELECT id, started_at, workflow::text AS workflow, channel, dealer_validation, outcome::text AS outcome, dealer_code, region FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id WHERE started_at >= $1::timestamptz - ($2||' hours')::interval AND started_at <= $1::timestamptz AND dealer_validation = 'DENIED' ORDER BY started_at DESC`, params: [T, W],
    denom: { sql: `SELECT count(*)::int n FROM order_attempts WHERE started_at >= $1::timestamptz - ($2||' hours')::interval AND started_at <= $1::timestamptz AND dealer_validation IS NOT NULL`, params: [T, W] }, note: 'attempts denied by Manafith' }),
  fixed_conversion_drop_pp: (a, T, W) => ({ pool: db.ops, head: [['started_at', 'Started (KSA)'], ['workflow', 'Journey'], ['outcome', 'Outcome'], ['step_reached', 'Step reached'], ['last_error_category', 'Last error'], ['dealer_code', 'Dealer'], ['region', 'Region'], ['id', 'Workflow id']],
    sql: `SELECT id, started_at, workflow::text AS workflow, outcome::text AS outcome, step_reached, last_error_category, dealer_code, region FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id WHERE channel = 'sda' AND started_at >= $1::timestamptz - ($2||' hours')::interval AND started_at <= $1::timestamptz AND outcome::text <> 'COMPLETED' ORDER BY started_at DESC`, params: [T, W],
    denom: { sql: `SELECT count(*)::int n FROM order_attempts WHERE channel = 'sda' AND started_at >= $1::timestamptz - ($2||' hours')::interval AND started_at <= $1::timestamptz`, params: [T, W] }, note: 'SDA attempts in the window that did NOT complete (the drop is measured against the 7-day baseline conversion)' }),
  fixed_offhours_sda_attempts: (a, T, W) => ({ pool: db.ops, head: [['started_at', 'Started (KSA)'], ['workflow', 'Journey'], ['outcome', 'Outcome'], ['dealer_code', 'Dealer'], ['staff_code', 'Staff'], ['region', 'Region'], ['id', 'Workflow id']],
    sql: `SELECT id, started_at, workflow::text AS workflow, outcome::text AS outcome, dealer_code, staff_code, region FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id WHERE channel = 'sda' AND started_at >= $1::timestamptz - ($2||' hours')::interval AND started_at <= $1::timestamptz AND EXTRACT(HOUR FROM started_at AT TIME ZONE 'Asia/Riyadh')::int >= $3 AND EXTRACT(HOUR FROM started_at AT TIME ZONE 'Asia/Riyadh')::int < $4 ORDER BY started_at DESC`, params: [T, W, F.FIXED_PARAMS.offStart, F.FIXED_PARAMS.offEnd], note: `SDA attempts started between ${String(F.FIXED_PARAMS.offStart).padStart(2, '0')}:00 and ${String(F.FIXED_PARAMS.offEnd).padStart(2, '0')}:00 KSA` }),
  fixed_dealer_stagnation_count: (a, T, W) => { const p = F.FIXED_PARAMS; return { pool: db.ops, head: [['dealer_code', 'Dealer'], ['dealer_name', 'Name'], ['region', 'Region'], ['baseline', 'Attempts (baseline)'], ['win', 'Attempts (window)'], ['completed', 'Completed (window)']],
    sql: `WITH b AS (SELECT $1::timestamptz AS t, $1::timestamptz - ($2||' hours')::interval AS ws, $1::timestamptz - ($2||' hours')::interval - ($3::int||' days')::interval AS bs)
          SELECT d.dealer_code, d.dealer_name, d.region, count(*) FILTER (WHERE oa.started_at >= b.bs AND oa.started_at < b.ws)::int AS baseline, count(*) FILTER (WHERE oa.started_at >= b.ws AND oa.started_at <= b.t)::int AS win, 0 AS completed
            FROM order_attempts oa JOIN dealers d ON d.id = oa.dealer_id, b WHERE oa.channel = 'sda' AND oa.started_at >= b.bs AND oa.started_at <= b.t
           GROUP BY d.id, d.dealer_code, d.dealer_name, d.region, b.bs, b.ws, b.t
          HAVING count(*) FILTER (WHERE oa.started_at >= b.bs AND oa.started_at < b.ws) >= $4 AND count(*) FILTER (WHERE oa.started_at >= b.ws AND oa.started_at <= b.t) >= $5 AND count(*) FILTER (WHERE oa.started_at >= b.ws AND oa.started_at <= b.t AND oa.outcome::text = 'COMPLETED') = 0 ORDER BY win DESC`, params: [T, W, p.minDays, p.minBaseline, p.minWindowAttempts], note: 'dealers active in the window with zero completions (one row per dealer)', noDates: true }; },
  fixed_incident_sla_breach_rate: (a, T, W, d) => { const p = [T, W, d && d.scope ? d.scope : null]; return { pool: db.ops, head: [['submitted_at', 'Submitted (KSA)'], ['incident_number', 'Ticket'], ['priority', 'Priority'], ['status', 'Status'], ['sla_status', 'SLA'], ['theme', 'Theme'], ['assigned_group', 'Group'], ['description', 'Description']],
    sql: `SELECT submitted_at, incident_number, priority, status, sla_status, theme, assigned_group, left(coalesce(description,''), 200) AS description FROM incident_log WHERE submitted_at >= $1::timestamptz - ($2||' hours')::interval AND submitted_at <= $1::timestamptz AND sla_missed AND ($3::text IS NULL OR theme ILIKE '%' || $3 || '%') ORDER BY submitted_at DESC`, params: p,
    denom: { sql: `SELECT count(*)::int n FROM incident_log WHERE submitted_at >= $1::timestamptz - ($2||' hours')::interval AND submitted_at <= $1::timestamptz AND ($3::text IS NULL OR theme ILIKE '%' || $3 || '%')`, params: p }, note: 'tickets that missed their SLA' }; },
  fixed_incident_ticket_count: (a, T, W, d) => { const p = [T, W, d && d.scope ? d.scope : null]; return { pool: db.ops, head: [['submitted_at', 'Submitted (KSA)'], ['incident_number', 'Ticket'], ['priority', 'Priority'], ['status', 'Status'], ['sla_status', 'SLA'], ['theme', 'Theme'], ['assigned_group', 'Group'], ['description', 'Description']],
    sql: `SELECT submitted_at, incident_number, priority, status, sla_status, theme, assigned_group, left(coalesce(description,''), 200) AS description FROM incident_log WHERE submitted_at >= $1::timestamptz - ($2||' hours')::interval AND submitted_at <= $1::timestamptz AND ($3::text IS NULL OR theme ILIKE '%' || $3 || '%') ORDER BY submitted_at DESC`, params: p, note: 'tickets submitted in the window' }; },
};

/* metrics whose value is not a row count (probes, ratios of aggregates, gateway-side data) — say so instead of guessing */
const NO_ROWS = { apigw_nodes_unreachable: 'console probe (apigw_probe_log) — see #apigw for the node map', api_latency_p95: 'API-traffic aggregate (p95) — see Monitoring › Gateway', api_technical_fail_rate: 'API-traffic aggregate — see Monitoring › Gateway / Troubleshoot', dealer_activity: 'aggregate of dealer activity', offhours_orders: 'aggregate', sms_probe_fail_count: 'SMS probe events — see Monitoring › SMS', courier_backlog: 'derived from paid reseller orders without a delivery request', onboarding_created: 'count of orders created', fixed_workhours_activity_ratio: 'same-hour baseline ratio (SDA activity) — see Fixed › Dashboard', fixed_sms_balance: 'Unifonic balance reading' };

async function casesFor(alert, opts = {}) {
  const key = alert.metric_key; const fn = CASES[key];
  const at = opts.at === 'first' ? (alert.fired_at || alert.last_seen_at) : (alert.last_seen_at || alert.fired_at || new Date().toISOString());
  const T = new Date(at).toISOString(), W = Number(alert.window_hours) || 1, dim = alert.dim || {};
  const base = { alert, at: T, window_hours: W, dim, metric: key, segment: segOf(alert) };
  if (!fn) return { ...base, supported: false, reason: NO_ROWS[key] || 'this metric is computed from aggregates, not from individual rows', head: [], rows: [], total: 0 };
  const spec = fn(alert, T, W, dim);
  if (!spec.pool) return { ...base, supported: false, reason: 'data source not configured', head: spec.head, rows: [], total: 0 };
  const cap = opts.cap || CAP;
  const r = await spec.pool.query(`SELECT * FROM (${spec.sql}) x LIMIT ${cap + 1}`, spec.params);
  const rows = r.rows.slice(0, cap);
  let denom = null; if (spec.denom) { try { denom = (await spec.pool.query(spec.denom.sql, spec.denom.params)).rows[0].n; } catch (e) { denom = null; } }
  const masked = roles.maskDeep(rows, !!opts.unmask);
  return { ...base, supported: true, head: spec.head, rows: masked, total: rows.length, capped: r.rows.length > cap, denominator: denom, note: spec.note, group: spec.group || null };
}

function xlsx(d, meta) {
  const X = require('./xlsx');
  const head = d.head.map(h => h[1]);
  const body = d.rows.map(r => d.head.map(([k]) => { const v = r[k]; return v instanceof Date ? ksa(v) : (k === 'created_at' || k === 'occurred_at' || k === 'started_at' || k === 'submitted_at' || k === 'ts') && v ? ksa(v) : (v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v)); }));
  const S = [[`Alert cases — ${d.alert.name}`], []];
  meta.forEach(([k, v]) => S.push([k, v]));
  if (d.group) { const g = {}; d.rows.forEach(r => { const k = r[d.group] || '—'; g[k] = (g[k] || 0) + 1; }); S.push([], [`By ${d.group}`, 'Rows']); Object.entries(g).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => S.push([k, n])); }
  return X.build([{ name: 'Cases', rows: [head, ...body], widths: head.map(h => /message|response|title/i.test(h) ? 60 : /time|started|submitted|sent|created/i.test(h) ? 19 : 18) }, { name: 'Alert', rows: S, widths: [26, 90] }]);
}
function pdf(d, meta) {
  const P = require('./pdfout');
  const doc = P.doc({ footer: `Salam Operations Console - alert cases - ${d.alert.name} - generated ${ksa(new Date().toISOString())} KSA` });
  const CC = doc.colors;
  const top = doc.band(64, CC.dark);
  doc.at(46, top + 24, `${d.segment === 'fixed' ? 'FIXED' : 'MOBILE'} - ALERT CASES - ${String(d.alert.severity || '')}`, { size: 9, bold: true, color: [0.5, 0.83, 0.65] });
  doc.at(46, top + 44, clip(d.alert.name, 70), { size: 15, bold: true, color: CC.white });
  doc.space(10); doc.h2('Alert'); doc.kv(meta, { boldVal: true });
  if (d.group) { const g = {}; d.rows.forEach(r => { const k = r[d.group] || '—'; g[k] = (g[k] || 0) + 1; }); doc.h2(`By ${d.group}`); doc.table([{ label: d.group, w: 30 }, { label: 'Rows', w: 10, align: 'right' }], Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, n]) => [String(k), String(n)])); }
  doc.h2(`Cases - ${d.total} row(s)${d.capped ? ' (PDF capped - the xlsx export holds the full list)' : ''}`);
  const cols = d.head.slice(0, 8).map(([k, l]) => ({ label: l, w: /message|response|title/i.test(l) ? 26 : /time|started|submitted|sent|created/i.test(l) ? 13 : 11 }));
  doc.table(cols, d.rows.map(r => d.head.slice(0, 8).map(([k]) => { const v = r[k]; if (v == null) return '—'; if (v instanceof Date || (/_at$|^ts$/.test(k) && !isNaN(Date.parse(v)))) return ksa(v); return clip(typeof v === 'object' ? JSON.stringify(v) : v, 90); })), { size: 6.8 });
  doc.p('Rows are exactly the population the metric counted at the evaluation time above (numerator of a rate, or the counted rows). PII masked as on the board unless exported by a PII-cleared role.', { color: CC.muted, size: 8 });
  return doc.buffer();
}

function mount(app, { audit }) {
  app.get('/api/alerts/:id/cases', async (req, res) => {
    try {
      const a = req.alertRow; const q = req.query || {}; const format = q.format === 'xlsx' ? 'xlsx' : q.format === 'pdf' ? 'pdf' : 'json';
      if (format !== 'json' && !(req.caps && req.caps.export)) return res.status(403).json({ error: `role ${req.roleName} lacks export` });
      const unmask = !!(req.caps && req.caps.unmaskPII) && q.unmask === '1';
      const d = await casesFor(a, { at: q.at, unmask, cap: format === 'json' ? 200 : format === 'pdf' ? 400 : CAP });
      const from = new Date(new Date(d.at).getTime() - d.window_hours * 3600e3).toISOString();
      const meta = [['Alert', `${a.severity} · ${a.name}`], ['Rule', a.rule_key], ['Metric', `${a.metric_key} ${a.operator} ${a.threshold}`], ['Observed', `${a.observed_value} (sample ${a.sample})`],
        ['Evaluated at', `${ksa(d.at)} KSA (${q.at === 'first' ? 'first firing' : 'last evaluation'})`], ['Window', `${d.window_hours}h — ${ksa(from)} → ${ksa(d.at)} KSA`],
        ['Dimension', Object.keys(d.dim).length ? Object.entries(d.dim).map(([k, v]) => `${k}=${v}`).join(', ') : '—'],
        ['Rows', d.supported ? `${d.total}${d.capped ? ' (capped)' : ''}${d.denominator != null ? ` of ${d.denominator} in the denominator` : ''}` : `not row-based — ${d.reason}`],
        ['What the rows are', d.note || '—'], ['PII', unmask ? 'unmasked' : 'masked'], ['Generated', `${ksa(new Date().toISOString())} KSA by ${req.actor || 'console'}`]];
      if (format === 'json') return res.json({ ...d, meta });
      if (audit) audit(req, 'alert.cases.export', String(a.id), { format, metric: a.metric_key, rows: d.total, at: d.at });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="alert-${a.id}-cases_${a.rule_key}_${stamp}.${format}"`);
      if (format === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.send(pdf(d, meta)); }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.send(xlsx(d, meta));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
module.exports = { mount, casesFor, CASES, NO_ROWS };
