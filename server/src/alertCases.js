/* alertCases.js — THE CASES BEHIND AN ALERT: the exact population a metric evaluated when the rule fired.
 *
 * An alert is "metric X over the last W hours ending at T breached threshold". Each entry below mirrors its metric's
 * compute() in metrics.js / fixedMetrics.js 1:1 — same table, same window bounds [T − W, T], same dimension filter —
 * and returns the WHOLE POPULATION the metric looked at (the denominator of a rate, or the rows a count metric
 * scanned) with a `counted` flag: TRUE = this row is in the numerator / was counted. So for "Nafath failure rate 0.51
 * (n=47)" the export holds all 47 Nafath requests, 24 flagged counted — the same numbers the rule saw. If a metric's
 * SQL changes, change the twin here; the export must never describe a different population than the alert.
 *
 * T = alerts.last_seen_at (the evaluation that last kept the alert open) — or fired_at with ?at=first.
 *   GET /api/alerts/:id/cases?format=json|xlsx|pdf&at=last|first   (files need cap `export`; json = preview)
 * UNMASKED by design (decision 9 Sep 2026): the people exporting are L1/L2 who already work with the identities;
 * every preview and export is audited (`alert.cases.view` / `alert.cases.export` with the actor, alert and row count).
 * Read-only, bounded (10 000 rows). */
'use strict';
const db = require('./db');
const errclass = require('./errclass');
const M = require('./metrics').SQL;
const F = require('./fixedMetrics');
const { segOf } = require('./segment');

const CAP = 10000;
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
const CPL_HEAD = [['created_at', 'Time (KSA)'], ['mobile', 'Mobile'], ['from_plan', 'From plan'], ['to_plan', 'To plan'], ['status', 'Status'], ['final_step_message', 'Last step / message'], ['payment_id', 'Payment id'], ['id', 'Row id']];
const DEL_COLS = `id::text AS id, created_at, vendor, delivery_state, submitted, receiver_mobile AS mobile, delivery_on_id AS order_id, external_reference_id`;
const DEL_HEAD = [['created_at', 'Time (KSA)'], ['vendor', 'Courier'], ['delivery_state', 'State'], ['submitted', 'Submitted'], ['mobile', 'Receiver mobile'], ['order_id', 'Order id'], ['external_reference_id', 'Courier ref'], ['id', 'Row id']];
const OA_COLS = `oa.id, oa.started_at, oa.workflow::text AS workflow, oa.channel, oa.outcome::text AS outcome, oa.step_reached, oa.last_error_category, oa.nafath_outcome, oa.dealer_validation, oa.order_number, oa.region, d.dealer_code, d.dealer_name, d.staff_code`;
const OA_HEAD = [['started_at', 'Started (KSA)'], ['workflow', 'Journey'], ['channel', 'Channel'], ['outcome', 'Outcome'], ['step_reached', 'Step reached'], ['last_error_category', 'Last error'], ['nafath_outcome', 'Nafath / Semati'], ['dealer_validation', 'Manafith'], ['order_number', 'Order'], ['dealer_code', 'Dealer'], ['dealer_name', 'Dealer name'], ['staff_code', 'Staff'], ['region', 'Region'], ['id', 'Workflow id']];
const OA_FROM = `order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id`;
const OA_WIN = `oa.started_at >= $1::timestamptz - ($2||' hours')::interval AND oa.started_at <= $1::timestamptz`;
const EE_COLS = `e.id, e.occurred_at, e.category, e.code, left(e.message, 300) AS message, e.dealer_code, e.dealer_id, e.region, e.order_number, e.attempt_id, e.resolved`;
const EE_HEAD = [['occurred_at', 'Time (KSA)'], ['category', 'Category'], ['code', 'Code'], ['message', 'Message'], ['dealer_code', 'Dealer'], ['region', 'Region'], ['order_number', 'Order'], ['attempt_id', 'Workflow id'], ['resolved', 'Resolved'], ['id', 'Event id']];
const INC_COLS = `submitted_at, incident_number, priority, status, sla_status, sla_missed, theme, assigned_group, left(coalesce(description,''), 200) AS description`;
const INC_HEAD = [['submitted_at', 'Submitted (KSA)'], ['incident_number', 'Ticket'], ['priority', 'Priority'], ['status', 'Status'], ['sla_status', 'SLA'], ['theme', 'Theme'], ['assigned_group', 'Group'], ['description', 'Description']];
const AT_COLS = `ts, host, path AS api, transaction_id, response_code, response_message, duration_ms, err_class`;
const AT_HEAD = [['ts', 'Time (KSA)'], ['api', 'API'], ['duration_ms', 'Duration (ms)'], ['response_code', 'Code'], ['response_message', 'Message'], ['err_class', 'Class'], ['host', 'Host'], ['transaction_id', 'Transaction id']];
const OWN = `EXISTS (SELECT 1 FROM payments p JOIN checkouts c ON c.id::text = p.payment_on_id WHERE p.payment_on_type = 'Checkout' AND p.id::text = change_plan_logs.payment_id AND c.checkout_type = 5)`;
const PROV = `(${M.SEM_TRANSPORT} OR ${M.SEM_UNAVAIL})`;
const FAULT = `(COALESCE(status_code,'') = '1500' OR response->>'responseCode' = '1500' OR response::text ILIKE '%"responseCode":"1500"%' OR response::text ILIKE '%unexpected XML tag%' OR response::text ILIKE '%soap/envelope}Fault%')`;
const cls = (codeExpr, textExpr) => errclass.classCaseSql(codeExpr, textExpr);
const FIVE_G = ['fiveGWhiteLabel', 'fiveGFWA'];
/* dim filters the compute() GROUPING SETS produce — applied verbatim on the population */
const dimSql = (dim, p, map) => { let s = ''; for (const [k, expr] of Object.entries(map)) if (dim && dim[k] != null && dim[k] !== '' && dim[k] !== 'unknown' && dim[k] !== '(worst)') { p.push(String(dim[k])); s += ` AND ${expr} = $${p.length}`; } return s; };

/* Each entry → { pool, from, cols, head, pop (population predicate), num (counted predicate | 'TRUE'), params, order, note, group? }
 * kind 'rate': population = denominator, counted = numerator. kind 'count': population = the counted rows (num TRUE). */
const CASES = {
  /* ---- payments ---- */
  payment_fail_rate: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { platform: 'platform', vendor: 'vendor' });
    return { pool: db.source, from: 'payments', cols: PAY_COLS, head: PAY_HEAD, pop: `status IN ('success','fail','failed') AND ${WIN}${f}`, num: `status IN ('fail','failed')`, params: p, note: 'population = success + failed payments in the window · counted = failed' }; },
  payment_volume: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { platform: 'platform' });
    return { pool: db.source, from: 'payments', cols: PAY_COLS, head: PAY_HEAD, pop: `${WIN}${f}`, num: `status='success'`, params: p, note: 'population = every payment in the window · counted = successful (a LOW-volume alert: the uncounted rows are what did not succeed)' }; },
  gateway_success_volume: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { gateway: `(${M.GW_CASE})` });
    return { pool: db.source, from: 'payments', cols: PAY_COLS, head: PAY_HEAD, pop: `${WIN}${f}`, num: `status='success'`, params: p, note: 'population = every payment on this gateway in the window · counted = successful (zero-success watchdog)' }; },
  zatca_unreported: (a, T, W) => ({ pool: db.source, from: 'payments', cols: PAY_COLS, head: PAY_HEAD, pop: `status='success' AND ${WIN} AND COALESCE(NULLIF(extra->>'zatca',''), NULL) IS NULL`, num: 'TRUE', params: [T, W], note: 'successful payments without a ZATCA report' }),
  payment_stuck_initiated: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { vendor: 'vendor' });
    return { pool: db.source, from: 'payments', cols: PAY_COLS, head: PAY_HEAD, pop: `lower(status) IN ('pending','initiated') AND payment_commit_response IS NOT NULL AND payment_commit_response::text NOT IN ('','{}','null') AND created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz - interval '30 minutes'${f}`, num: 'TRUE', params: p, note: 'gateway committed, app never finalised, older than 30 min' }; },
  payment_duplicate_suspect: (a, T, W) => ({ pool: db.source, from: 'payments', cols: PAY_COLS, head: PAY_HEAD, pop: `status='success' AND ${WIN} AND (customer_mobile_number, amount, payment_on_type, payment_on_id) IN (SELECT customer_mobile_number, amount, payment_on_type, payment_on_id FROM payments WHERE status='success' AND ${WIN} GROUP BY 1,2,3,4 HAVING count(*) > 1 AND (max(created_at) - min(created_at)) < interval '30 minutes')`, num: 'TRUE', params: [T, W], order: 'customer_mobile_number, amount, created_at', note: 'every charge in a suspected duplicate group (the metric counts groups; rows are all charges in those groups)', group: 'mobile' }),
  recharge_fail_rate: (a, T, W) => ({ pool: db.source, from: `payments p JOIN checkouts c ON c.id::text = p.payment_on_id`, cols: PAY_COLS.replace(/(^|, )(id::text AS id|created_at|customer_mobile_number AS mobile|amount|status|vendor|platform|payment_method|payment_on_type|payment_on_id|payment_reference_id AS ref)/g, '$1p.$2').replace(/payment_commit_response#/g, 'p.payment_commit_response#').replace(/payment_initialization_response#/g, 'p.payment_initialization_response#').replace(/NULLIF\(fail_reason/g, 'NULLIF(p.fail_reason'), head: PAY_HEAD, pop: `p.payment_on_type='Checkout' AND c.checkout_type = 6 AND p.status IN ('success','fail','failed') AND p.created_at >= $1::timestamptz - ($2||' hours')::interval AND p.created_at < $1::timestamptz`, num: `p.status IN ('fail','failed')`, params: [T, W], order: 'p.created_at DESC', note: 'population = recharge / renewal payments (checkout type 6) · counted = failed' }),
  samsung_pay_fail_rate: (a, T, W) => ({ pool: db.source, from: 'payments', cols: PAY_COLS, head: PAY_HEAD, pop: `(payment_method ILIKE '%samsung%' OR vendor ILIKE '%samsung%') AND status IN ('success','fail','failed') AND ${WIN}`, num: `status IN ('fail','failed')`, params: [T, W], note: 'population = Samsung Pay payments · counted = failed' }),

  /* ---- identity / provisioning ---- */
  nafath_fail_rate: (a, T, W) => ({ pool: db.source, from: 'nafath_logs', cols: NAF_COLS, head: NAF_HEAD, pop: `(lower(status) = ANY($3) OR lower(status) = ANY($4)) AND ${WIN}`, num: `lower(status) = ANY($3)`, params: [T, W, M.NAFATH_FAILED, M.NAFATH_SUCCESS], note: 'population = Nafath requests in a terminal state (completed + failed) · counted = expired / rejected / failed / cancelled / denied' }),
  semati_fail_rate: (a, T, W) => ({ pool: db.source, from: 'activation_logs', cols: ACT_COLS, head: ACT_HEAD, pop: `api ILIKE '%semati%' AND NOT ${PROV} AND ${WIN}`, num: `state = false`, params: [T, W], note: 'population = Semati calls without a provider / transport error · counted = business refusals (715 / transport rows belong to the provider-error alerts)' }),
  semati_provider_error_rate: (a, T, W, d) => { const p = [T, W]; const f = d && d.endpoint ? ` AND (${M.SEM_ENDPOINT}) = $3` : ''; if (f) p.push(String(d.endpoint));
    return { pool: db.source, from: `(${M.SEMATI_UNION}) u`, cols: SEM_COLS, head: SEM_HEAD, pop: `TRUE${f}`, num: PROV, params: p, note: 'population = all Semati calls (activation + eligibility) · counted = 715 "not available" or transport failure (5002 / reset / SSL / 408)' }; },
  semati_transport_error_rate: (a, T, W) => ({ pool: db.source, from: `(${M.SEMATI_UNION}) u`, cols: SEM_COLS, head: SEM_HEAD, pop: 'TRUE', num: M.SEM_TRANSPORT, params: [T, W], note: 'population = all Semati calls · counted = transport failures' }),
  semati_timeout_count: (a, T, W) => ({ pool: db.source, from: `(${M.SEMATI_UNION}) u`, cols: SEM_COLS, head: SEM_HEAD, pop: `COALESCE(status_code,'')='408' OR response::text ILIKE '%[408]%' OR response::text ILIKE '%timeout%'`, num: 'TRUE', params: [T, W], note: 'Semati HTTP 408 / timeout rows' }),
  semati_success_volume: (a, T, W) => ({ pool: db.source, from: `(${M.SEMATI_UNION}) u`, cols: SEM_COLS, head: SEM_HEAD, pop: 'TRUE', num: 'state = true', params: [T, W], note: 'population = all Semati calls · counted = successful (zero-success watchdog)' }),
  semati_flapping: (a, T, W) => ({ pool: db.source, from: `(SELECT ${SEM_COLS}, (state = false AND ${PROV}) AS provfail, lag(state) OVER (ORDER BY created_at) AS prev FROM (${M.SEMATI_UNION}) u) s`, cols: SEM_COLS, head: SEM_HEAD, pop: 'TRUE', num: 'provfail AND prev = true', params: [T, W], note: 'population = all Semati calls · counted = each ok → provider-error flip' }),
  citc_upstream_degraded: (a, T, W) => ({ pool: db.source, from: `(${M.SEMATI_UNION}) u`, cols: SEM_COLS, head: SEM_HEAD, pop: 'TRUE', num: PROV, params: [T, W], note: 'Semati half of the composite (population = all Semati calls · counted = provider errors); the Nafath half is on the nafath_fail_rate alert' }),

  /* ---- activation / BSS ---- */
  activation_fail_rate: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { platform: 'platform' }); return { pool: db.source, from: 'activation_logs', cols: ACT_COLS, head: ACT_HEAD, pop: `${WIN}${f}`, num: 'state = false', params: p, note: 'population = all activation calls (Semati included) · counted = failed' }; },
  activation_fail_rate_technical: (a, T, W) => ({ pool: db.source, from: 'activation_logs', cols: ACT_COLS, head: ACT_HEAD, pop: `COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}`, num: `state IS DISTINCT FROM true AND (${cls('status_code', `coalesce(response::text,'')`)}) = 'technical'`, params: [T, W], note: 'population = non-Semati activation calls · counted = TECHNICAL failures (1500 / 5xx / timeouts / SOAP faults)' }),
  activation_fail_rate_business: (a, T, W) => ({ pool: db.source, from: 'activation_logs', cols: ACT_COLS, head: ACT_HEAD, pop: `COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}`, num: `state IS DISTINCT FROM true AND (${cls('status_code', `coalesce(response::text,'')`)}) = 'business'`, params: [T, W], note: 'population = non-Semati activation calls · counted = BUSINESS refusals' }),
  bss_write_fail_rate: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { api: `regexp_replace(api, '^/', '')` }); return { pool: db.source, from: 'activation_logs', cols: ACT_COLS, head: ACT_HEAD, pop: `COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}${f}`, num: 'state IS DISTINCT FROM true', params: p, note: 'population = BSS activation calls (Semati excluded) · counted = failed' }; },
  bss_fail_burst: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { api: `regexp_replace(api, '^/', '')` }); return { pool: db.source, from: 'activation_logs', cols: ACT_COLS, head: ACT_HEAD, pop: `state IS DISTINCT FROM true AND COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}${f}`, num: 'TRUE', params: p, note: 'failed BSS activation calls (Semati excluded)' }; },
  bss_soap_fault: (a, T, W, d) => { const p = [T, W]; const f = dimSql(d, p, { api: `regexp_replace(api, '^/', '')` }); return { pool: db.source, from: 'activation_logs', cols: ACT_COLS, head: ACT_HEAD, pop: `${FAULT} AND ${WIN}${f}`, num: 'TRUE', params: p, note: 'activation calls that received a SOAP Fault / responseCode 1500 (write path)' }; },
  bss_top_error_share: (a, T, W, d) => { const p = [T, W]; const code = d && d.code ? String(d.code) : null; if (code) p.push(code);
    return { pool: db.source, from: 'activation_logs', cols: ACT_COLS, head: ACT_HEAD, pop: `state IS DISTINCT FROM true AND COALESCE(api,'') NOT ILIKE '%semati%' AND ${WIN}`, num: code ? `COALESCE(NULLIF(status_code,''), response->>'responseCode', 'unknown') = $3` : 'TRUE', params: p, note: `population = all failed BSS calls · counted = the dominant code${code ? ' ' + code : ''}` }; },
  eligibility_deny_rate: (a, T, W) => ({ pool: db.source, from: 'eligibility_logs', cols: ACT_COLS, head: ACT_HEAD, pop: `NOT ${PROV} AND ${WIN}`, num: 'state = false', params: [T, W], note: 'population = eligibility checks without a Semati provider error · counted = denied' }),

  /* ---- onboarding / plan / ownership / delivery ---- */
  onboarding_abandoned: (a, T, W) => ({ pool: db.source, from: 'onboarding_orders', cols: `id::text AS id, created_at, mobile_number AS mobile, nationality_id_number AS nid, delivery_type, external_service_name, completed, activated`, head: [['created_at', 'Created (KSA)'], ['mobile', 'Mobile'], ['nid', 'National id'], ['delivery_type', 'Delivery'], ['external_service_name', 'Channel'], ['completed', 'Completed'], ['activated', 'Activated'], ['id', 'Order id']], pop: `completed = false AND activated = false AND ${WIN}`, num: 'TRUE', params: [T, W], note: 'onboarding orders neither completed nor activated' }),
  onboarding_conversion: (a, T, W) => ({ pool: db.source, from: 'onboarding_orders', cols: `id::text AS id, created_at, mobile_number AS mobile, completed, activated, delivery_type, external_service_name`, head: [['created_at', 'Created (KSA)'], ['mobile', 'Mobile'], ['completed', 'Completed'], ['activated', 'Activated'], ['delivery_type', 'Delivery'], ['external_service_name', 'Channel'], ['id', 'Order id']], pop: WIN, num: 'completed', params: [T, W], note: 'population = orders created · counted = completed (a low-conversion alert: the uncounted rows did not convert)' }),
  change_plan_fail_rate: (a, T, W) => ({ pool: db.source, from: 'change_plan_logs', cols: CPL_COLS, head: CPL_HEAD, pop: `status IN (1,2) AND ${WIN}`, num: 'status = 2', params: [T, W], note: 'population = plan changes (done + failed) · counted = failed' }),
  change_plan_fail_rate_technical: (a, T, W) => ({ pool: db.source, from: 'change_plan_logs', cols: CPL_COLS, head: CPL_HEAD, pop: `status IN (1,2) AND ${WIN}`, num: `status = 2 AND (${cls('NULL::text', `coalesce(final_step_message,'')`)}) = 'technical'`, params: [T, W], note: 'population = plan changes · counted = TECHNICAL failures' }),
  change_plan_fail_rate_business: (a, T, W) => ({ pool: db.source, from: 'change_plan_logs', cols: CPL_COLS, head: CPL_HEAD, pop: `status IN (1,2) AND ${WIN}`, num: `status = 2 AND (${cls('NULL::text', `coalesce(final_step_message,'')`)}) = 'business'`, params: [T, W], note: 'population = plan changes · counted = BUSINESS refusals' }),
  ownership_fail_rate: (a, T, W) => ({ pool: db.source, from: 'change_plan_logs', cols: CPL_COLS, head: CPL_HEAD, pop: `status IN (1,2) AND ${OWN} AND ${WIN}`, num: 'status = 2', params: [T, W], note: 'population = ownership transfers (checkout type 5) · counted = failed' }),
  ownership_fail_rate_technical: (a, T, W) => ({ pool: db.source, from: 'change_plan_logs', cols: CPL_COLS, head: CPL_HEAD, pop: `status IN (1,2) AND ${OWN} AND ${WIN}`, num: `status = 2 AND (${cls('NULL::text', `coalesce(final_step_message,'')`)}) = 'technical'`, params: [T, W], note: 'population = ownership transfers · counted = TECHNICAL failures' }),
  ownership_fail_rate_business: (a, T, W) => ({ pool: db.source, from: 'change_plan_logs', cols: CPL_COLS, head: CPL_HEAD, pop: `status IN (1,2) AND ${OWN} AND ${WIN}`, num: `status = 2 AND (${cls('NULL::text', `coalesce(final_step_message,'')`)}) = 'business'`, params: [T, W], note: 'population = ownership transfers · counted = BUSINESS refusals' }),
  delivery_fail_rate: (a, T, W, d) => { const p = [T, W, M.DELIVERY_FAILED]; const f = dimSql(d, p, { vendor: 'vendor' }); return { pool: db.source, from: 'delivery_requests', cols: DEL_COLS, head: DEL_HEAD, pop: `${WIN}${f}`, num: 'delivery_state = ANY($3)', params: p, note: 'population = delivery requests · counted = failed / cancelled / refused' }; },
  courier_worst_fail_rate: (a, T, W) => ({ pool: db.source, from: 'delivery_requests', cols: DEL_COLS, head: DEL_HEAD, pop: WIN, num: 'delivery_state = ANY($3)', params: [T, W, M.DELIVERY_FAILED], order: 'vendor, created_at DESC', note: 'population = delivery requests, all couriers · counted = failed (the alert names the worst courier)', group: 'vendor' }),
  delivery_stuck: (a, T, W) => ({ pool: db.source, from: 'delivery_requests', cols: DEL_COLS, head: DEL_HEAD, pop: `submitted = true AND COALESCE(delivery_state,'') <> ALL($3) AND COALESCE(delivery_state,'') <> ALL($4) AND created_at < $1::timestamptz - ($2||' hours')::interval AND created_at > $1::timestamptz - interval '30 days'`, num: 'TRUE', params: [T, W, M.DELIVERY_COMPLETED, M.DELIVERY_FAILED], note: 'submitted deliveries older than the window, neither completed nor failed (bounded to 30 days)' }),

  /* ---- app error log / OTP / Digital-API traffic (console DB) ---- */
  app_ip_block_count: (a, T, W) => ({ pool: db.console, from: 'api_error_events', cols: `ts, error_code, endpoint, rate_limit, ip, left(message, 300) AS message`, head: [['ts', 'Time (KSA)'], ['error_code', 'Code'], ['endpoint', 'Endpoint'], ['rate_limit', 'Rate limit'], ['ip', 'IP'], ['message', 'Message']], pop: `rate_limit='ip_retrial' AND ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz`, num: 'TRUE', params: [T, W], order: 'ts DESC', note: 'app error-log events blocked by the IP rate limit (-704)' }),
  app_crash_count: (a, T, W) => ({ pool: db.console, from: 'api_error_events', cols: `ts, error_code, endpoint, exception_class, left(message, 300) AS message`, head: [['ts', 'Time (KSA)'], ['error_code', 'Code'], ['endpoint', 'Endpoint'], ['exception_class', 'Exception'], ['message', 'Message']], pop: `error_code=-501 AND exception_class IS NOT NULL AND ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz`, num: 'TRUE', params: [T, W], order: 'ts DESC', note: 'unhandled exceptions (-501 with an exception class)' }),
  app_auth_fail_count: (a, T, W) => ({ pool: db.console, from: 'api_error_events', cols: `ts, error_code, endpoint, left(message, 300) AS message`, head: [['ts', 'Time (KSA)'], ['error_code', 'Code'], ['endpoint', 'Endpoint'], ['message', 'Message']], pop: `error_code IN (-201,-202,-203,-204,-205,-300,-301,-612) AND ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz`, num: 'TRUE', params: [T, W], order: 'ts DESC', note: 'auth / session / token failures from the app error log' }),
  app_backend_err_count: (a, T, W) => ({ pool: db.console, from: 'api_error_events', cols: `ts, error_code, endpoint, exception_class, left(message, 300) AS message`, head: [['ts', 'Time (KSA)'], ['error_code', 'Code'], ['endpoint', 'Endpoint'], ['exception_class', 'Exception'], ['message', 'Message']], pop: `(error_code IN (-500,-702,-20003) OR (error_code=-501 AND exception_class IS NULL)) AND ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz`, num: 'TRUE', params: [T, W], order: 'ts DESC', note: 'backend / provider errors from the app error log' }),
  otp_verify_rate: (a, T, W) => ({ pool: db.source, from: 'otps', cols: `id::text AS id, created_at, otp_for AS target, delivery_method, verified`, head: [['created_at', 'Sent (KSA)'], ['target', 'Target'], ['delivery_method', 'Method'], ['verified', 'Verified'], ['id', 'Row id']], pop: `delivery_method='sms' AND ${WIN}`, num: 'verified', params: [T, W], note: 'population = SMS OTPs sent · counted = verified (a low-rate alert: the uncounted rows never verified)' }),
  /* Digital-API latency: the metric is p95(duration) / threshold per API (collector table api_traffic_events). Cases =
   * every call of that API in the window, counted = slower than the API threshold — the slow calls, timeouts and
   * their codes are what L2 needs. Threshold read from Settings (api_latency_thresholds) like the metric does. */
  api_latency_p95: async (a, T, W, d) => { const at = require('./apiTraffic'); if (at.mode() !== 'collector') return null;
    const th = await at.latencyThresholds(); const api = d && d.api && d.api !== '(worst)' ? d.api : (d && d.offender) || null;
    const lim = api && th.perApi[api] > 0 ? th.perApi[api] : th.globalMs; const p = [T, W, lim]; const f = api ? ` AND path = $4` : ''; if (api) p.push(api);
    return { pool: db.console, from: 'api_traffic_events', cols: AT_COLS, head: AT_HEAD, pop: `ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz${f}`, num: `duration_ms >= $3`, params: p, order: 'duration_ms DESC', note: `population = ${api ? 'calls of ' + api : 'all Digital-API calls'} in the window · counted = slower than the threshold ${lim} ms (sorted slowest first; timeouts / technical codes visible in Code / Class)`, group: 'api' }; },
  api_technical_fail_rate: async (a, T, W, d) => { const at = require('./apiTraffic'); if (at.mode() !== 'collector') return null;
    const p = [T, W]; const api = d && d.api ? d.api : null; const f = api ? ` AND path = $3` : ''; if (api) p.push(api);
    return { pool: db.console, from: 'api_traffic_events', cols: AT_COLS, head: AT_HEAD, pop: `ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz${f}`, num: `err_class = 'technical'`, params: p, order: 'ts DESC', note: `population = ${api ? 'calls of ' + api : 'all Digital-API calls'} · counted = TECHNICAL failures (1500 / 5xx / 408 / 715 / transport)`, group: 'api' }; },

  /* ---- FIXED (sda_ops read model) ---- */
  fixed_error_p0p1_categories: (a, T) => ({ pool: db.ops, from: 'error_events e', cols: EE_COLS, head: EE_HEAD, pop: `e.occurred_at >= $1::timestamptz - ($2||' minutes')::interval AND e.occurred_at < $1::timestamptz AND e.resolved = false`, num: 'TRUE', params: [T, F.FIXED_PARAMS.errorWindowMin], order: 'e.category, e.occurred_at DESC', note: `open error events in the last ${F.FIXED_PARAMS.errorWindowMin} min (the metric counts the categories whose effective severity reached P0/P1)`, group: 'category' }),
  fixed_timeout_dealers: (a, T) => ({ pool: db.ops, from: 'error_events e', cols: EE_COLS, head: EE_HEAD, pop: `e.occurred_at >= $1::timestamptz - ($2||' minutes')::interval AND e.occurred_at < $1::timestamptz AND e.category IN ('TIMEOUT','NAFATH_TIMEOUT')`, num: 'TRUE', params: [T, F.FIXED_PARAMS.timeoutWindowMin], order: 'e.dealer_code, e.occurred_at DESC', note: `timeout events in the last ${F.FIXED_PARAMS.timeoutWindowMin} min (the metric counts distinct dealers)`, group: 'dealer_code' }),
  fixed_nafath_fail_rate: (a, T, W) => ({ pool: db.ops, from: OA_FROM, cols: OA_COLS, head: OA_HEAD, pop: `${OA_WIN} AND oa.nafath_outcome IS NOT NULL AND oa.workflow::text = ANY($3::text[])`, num: `oa.nafath_outcome <> 'COMPLETED'`, params: [T, W, FIVE_G], order: 'oa.started_at DESC', note: 'population = 5G attempts with a Nafath step · counted = Nafath not completed' }),
  fixed_semati_fail_rate: (a, T, W) => ({ pool: db.ops, from: OA_FROM, cols: OA_COLS, head: OA_HEAD, pop: `${OA_WIN} AND oa.workflow::text = ANY($3::text[]) AND oa.nafath_outcome IN ('COMPLETED','FAILED','MOBILE_EXISTS')`, num: `oa.nafath_outcome IN ('FAILED','MOBILE_EXISTS')`, params: [T, W, FIVE_G], order: 'oa.started_at DESC', note: 'population = 5G attempts that reached Semati · counted = FAILED / MOBILE_EXISTS' }),
  fixed_manafith_deny_rate: (a, T, W) => ({ pool: db.ops, from: OA_FROM, cols: OA_COLS, head: OA_HEAD, pop: `${OA_WIN} AND oa.dealer_validation IS NOT NULL`, num: `oa.dealer_validation = 'DENIED'`, params: [T, W], order: 'oa.started_at DESC', note: 'population = attempts validated by Manafith · counted = denied' }),
  fixed_conversion_drop_pp: (a, T, W) => ({ pool: db.ops, from: OA_FROM, cols: OA_COLS, head: OA_HEAD, pop: `oa.channel = 'sda' AND ${OA_WIN}`, num: `oa.outcome::text <> 'COMPLETED'`, params: [T, W], order: 'oa.started_at DESC', note: 'population = SDA attempts in the window · counted = NOT completed (the drop is measured against the 7-day baseline)' }),
  fixed_offhours_sda_attempts: (a, T, W) => ({ pool: db.ops, from: OA_FROM, cols: OA_COLS, head: OA_HEAD, pop: `oa.channel = 'sda' AND ${OA_WIN} AND EXTRACT(HOUR FROM oa.started_at AT TIME ZONE 'Asia/Riyadh')::int >= $3 AND EXTRACT(HOUR FROM oa.started_at AT TIME ZONE 'Asia/Riyadh')::int < $4`, num: 'TRUE', params: [T, W, F.FIXED_PARAMS.offStart, F.FIXED_PARAMS.offEnd], order: 'oa.started_at DESC', note: `SDA attempts started between ${String(F.FIXED_PARAMS.offStart).padStart(2, '0')}:00 and ${String(F.FIXED_PARAMS.offEnd).padStart(2, '0')}:00 KSA`, group: 'dealer_code' }),
  fixed_dealer_stagnation_count: (a, T, W) => { const p = F.FIXED_PARAMS; return { pool: db.ops, from: `(WITH b AS (SELECT $1::timestamptz AS t, $1::timestamptz - ($2||' hours')::interval AS ws, $1::timestamptz - ($2||' hours')::interval - ($3::int||' days')::interval AS bs)
      SELECT d.dealer_code, d.dealer_name, d.region, count(*) FILTER (WHERE oa.started_at >= b.bs AND oa.started_at < b.ws)::int AS baseline, count(*) FILTER (WHERE oa.started_at >= b.ws AND oa.started_at <= b.t)::int AS win
        FROM order_attempts oa JOIN dealers d ON d.id = oa.dealer_id, b WHERE oa.channel = 'sda' AND oa.started_at >= b.bs AND oa.started_at <= b.t
       GROUP BY d.id, d.dealer_code, d.dealer_name, d.region, b.bs, b.ws, b.t
      HAVING count(*) FILTER (WHERE oa.started_at >= b.bs AND oa.started_at < b.ws) >= $4 AND count(*) FILTER (WHERE oa.started_at >= b.ws AND oa.started_at <= b.t) >= $5 AND count(*) FILTER (WHERE oa.started_at >= b.ws AND oa.started_at <= b.t AND oa.outcome::text = 'COMPLETED') = 0) s`,
    cols: `dealer_code, dealer_name, region, baseline, win`, head: [['dealer_code', 'Dealer'], ['dealer_name', 'Name'], ['region', 'Region'], ['baseline', 'Attempts (baseline)'], ['win', 'Attempts (window)']], pop: 'TRUE', num: 'TRUE', params: [T, W, p.minDays, p.minBaseline, p.minWindowAttempts], order: 'win DESC', note: 'dealers active in the window with zero completions (one row per dealer)' }; },
  fixed_incident_sla_breach_rate: (a, T, W, d) => ({ pool: db.ops, from: 'incident_log', cols: INC_COLS, head: INC_HEAD, pop: `submitted_at >= $1::timestamptz - ($2||' hours')::interval AND submitted_at <= $1::timestamptz AND ($3::text IS NULL OR theme ILIKE '%' || $3 || '%')`, num: 'sla_missed', params: [T, W, d && d.scope ? d.scope : null], order: 'submitted_at DESC', note: 'population = tickets submitted in the window · counted = SLA missed' }),
  fixed_incident_ticket_count: (a, T, W, d) => ({ pool: db.ops, from: 'incident_log', cols: INC_COLS, head: INC_HEAD, pop: `submitted_at >= $1::timestamptz - ($2||' hours')::interval AND submitted_at <= $1::timestamptz AND ($3::text IS NULL OR theme ILIKE '%' || $3 || '%')`, num: 'TRUE', params: [T, W, d && d.scope ? d.scope : null], order: 'submitted_at DESC', note: 'tickets submitted in the window' }),
};
/* ---- FIXED per-channel families (16 Sep 2026 — fixedChannelMetrics.js twins). Same window, same dim, same class SQL. ----
 * Board rows carry the same channel / class / response text / provider the board and the metric compute use (fixedErrors
 * expressions), so a "Salam Home app · technical" alert exports exactly the Salam Home technical rows of that hour. */
const fe = () => require('./fixedErrors');
const EE2_COLS = () => `e.id, e.occurred_at, ${fe().CHANNEL_EXPR} AS channel, ${fe().CLASS_SQL()} AS cls, e.category, e.code, left(${fe().RESP_EXPR}, 300) AS response, ${fe().PROVIDER_EXPR} AS provider, e.dealer_code, e.region, e.order_number, e.attempt_id, e.resolved`;
const EE2_HEAD = [['occurred_at', 'Time (KSA)'], ['channel', 'Channel'], ['cls', 'Class'], ['category', 'Category'], ['response', 'Response'], ['provider', 'Provider'], ['code', 'Code'], ['dealer_code', 'Dealer'], ['region', 'Region'], ['order_number', 'Order'], ['attempt_id', 'Workflow id'], ['resolved', 'Resolved'], ['id', 'Event id']];
const EE_WIN = `e.occurred_at >= $1::timestamptz - ($2||' hours')::interval AND e.occurred_at < $1::timestamptz`;
const AE_COLS = `id::text AS id, ts, coalesce(channel,'other') AS channel, path, kind, ok, reason_class AS cls, status_code, left(reason, 300) AS reason, duration_ms, request_id, state_id, platform, app_version, host`;
const AE_HEAD = [['ts', 'Time (KSA)'], ['channel', 'Channel'], ['path', 'Step'], ['kind', 'Kind'], ['ok', 'OK'], ['cls', 'Class'], ['reason', 'Reason'], ['duration_ms', 'Duration (ms)'], ['status_code', 'Code'], ['request_id', 'Request id'], ['state_id', 'Workflow id'], ['platform', 'Platform'], ['app_version', 'App version'], ['id', 'Row id']];
const AE_WIN = `ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz`;
const AC_HOST = `coalesce(substring(ac.endpoint from '^https?://([^/:]+)'), 'unknown')`;
const AC_COLS = `ac.id::text AS id, ac.created_at, ${AC_HOST} AS host, regexp_replace(regexp_replace(split_part(ac.endpoint, '?', 1), '^https?://[^/]+', ''), '/[0-9A-Za-z_-]*[0-9][0-9A-Za-z_-]*', '/{id}', 'g') AS family, ac.status, ac.error_class, ac.duration_ms, ac.attempt_id, left(ac.endpoint, 200) AS endpoint`;
const AC_HEAD = [['created_at', 'Time (KSA)'], ['host', 'Host'], ['family', 'Endpoint family'], ['status', 'HTTP'], ['error_class', 'Error class'], ['duration_ms', 'Duration (ms)'], ['attempt_id', 'Workflow id'], ['endpoint', 'Endpoint'], ['id', 'Call id']];
const AC_WIN = `ac.created_at >= $1::timestamptz - ($2||' hours')::interval AND ac.created_at < $1::timestamptz`;
const YP_COLS = `id::text AS id, run_at, trigger_kind, actor, verdict, ok_count, total, login->>'ok' AS login_ok, login->>'ms' AS login_ms, (SELECT string_agg(x->>'label' || ': ' || coalesce(x->>'message',''), ' | ') FROM jsonb_array_elements(results) x WHERE x->>'cls' = 'technical') AS failures`;
const YP_HEAD = [['run_at', 'Run (KSA)'], ['trigger_kind', 'Trigger'], ['verdict', 'Verdict'], ['ok_count', 'OK'], ['total', 'Calls'], ['login_ok', 'Login'], ['login_ms', 'Login ms'], ['failures', 'Technical failures'], ['actor', 'Actor'], ['id', 'Run id']];
const chan = d => d && d.channel && d.channel !== 'all' ? String(d.channel) : null;
const clsOf = d => d && (d.cls === 'business' || d.cls === 'technical') ? d.cls : null;
const MONEY = ['PAYMENT_NOT_NOTIFIED', 'PROVISION_NO_ORDER', 'PAYMENT_FAILED'];
/* the board pool for a channel: the same partition the board and the metric used (beta serves web + salamhome while fresh) */
async function boardPool(channel) {
  try { const srcs = await fe().boardSources(); const hit = srcs.find(x => x.slice ? (channel ? x.slice.includes(`'${channel}'`) : x.src === 'ops') : true); return (hit || srcs[0] || {}).pool || db.ops; } catch (_) { return db.ops; }
}
function boardSpec(a, T, W, d, { onlyMoney = false, counted } = {}) {
  const p = [T, W]; let f = ''; const c = chan(d); if (c) { p.push(c); f += ` AND ${fe().CHANNEL_EXPR} = $${p.length}`; }
  if (onlyMoney) { p.push(MONEY); f += ` AND e.category = ANY($${p.length}::text[])`; }
  const k = clsOf(d); let num = 'TRUE'; if (counted === 'cls' && k) { p.push(k); num = `${fe().CLASS_SQL()} = $${p.length}`; } else if (counted === 'open') num = 'NOT e.resolved';
  return { from: 'error_events e', cols: EE2_COLS(), head: EE2_HEAD, pop: `${EE_WIN}${f}`, num, params: p, order: 'e.occurred_at DESC', group: 'category' };
}
function appSpec(a, T, W, d, { pred = '', counted = 'cls', mutationOnly = true, group = 'path' } = {}) {
  const p = [T, W]; let f = mutationOnly ? ` AND kind = 'mutation'` : ''; const c = chan(d); if (c) { p.push(c); f += ` AND coalesce(channel,'other') = $${p.length}`; }
  const k = clsOf(d); let num = 'TRUE';
  if (counted === 'cls') { if (k) { p.push(k); num = `ok IS NOT TRUE AND reason_class = $${p.length}`; } else num = 'ok IS NOT TRUE'; }
  else if (counted === 'technical') num = `ok IS NOT TRUE AND reason_class = 'technical'`;
  else if (counted === 'slow') { p.push(Number(a.threshold) || 0); num = `duration_ms >= $${p.length}::numeric`; f += ' AND duration_ms IS NOT NULL'; }
  else if (counted === 'failed') num = 'ok IS NOT TRUE';
  return { pool: db.console, from: 'fixed_app_events', cols: AE_COLS, head: AE_HEAD, pop: `${AE_WIN}${f}${pred}`, num, params: p, order: counted === 'slow' ? 'duration_ms DESC NULLS LAST' : 'ts DESC', group };
}
function apiSpec(a, T, W, d, counted) {
  const p = [T, W]; let f = ''; if (d && d.host && d.host !== '(worst)' && d.host !== 'unknown') { p.push(String(d.host)); f += ` AND ${AC_HOST} = $${p.length}`; }
  let num; if (counted === 'slow') { p.push(Number(a.threshold) || 0); num = `ac.duration_ms >= $${p.length}::numeric`; f += ' AND ac.duration_ms IS NOT NULL'; } else num = `(ac.status >= 500 OR ac.error_class IS NOT NULL)`;
  return { pool: db.ops, from: 'api_calls ac', cols: AC_COLS, head: AC_HEAD, pop: `${AC_WIN}${f}`, num, params: p, order: counted === 'slow' ? 'ac.duration_ms DESC NULLS LAST' : 'ac.created_at DESC', group: 'host' };
}
Object.assign(CASES, {
  fixed_board_fail_rate: async (a, T, W, d) => ({ pool: await boardPool(chan(d)), ...boardSpec(a, T, W, d, { counted: 'cls' }), note: `population = every error-board event of ${chan(d) ? 'channel ' + chan(d) : 'every channel'} in the window (the rate divides the ${clsOf(d) || ''} ones by the order attempts of the same window) · counted = ${clsOf(d) || 'all'} class` }),
  fixed_board_fail_anomaly: async (a, T, W, d) => ({ pool: await boardPool(chan(d)), ...boardSpec(a, T, W, d, { counted: 'cls' }), note: `population = error-board events of ${chan(d) ? 'channel ' + chan(d) : 'every channel'} in the window · counted = ${clsOf(d) || 'all'} class (the z-score compares this count with the channel's own 14-day same-hour baseline)` }),
  fixed_board_money_at_risk: async (a, T, W, d) => ({ pool: await boardPool(chan(d)), ...boardSpec(a, T, W, d, { onlyMoney: true, counted: 'open' }), note: 'population = paid-but-stuck events (PAYMENT_NOT_NOTIFIED · PROVISION_NO_ORDER · PAYMENT_FAILED) in the window · counted = still open (not resolved)' }),
  fixed_applog_fail_rate: (a, T, W, d) => ({ ...appSpec(a, T, W, d), note: `population = tRPC steps (mutation lines) of ${chan(d) || 'every channel'} in the window · counted = failed ${clsOf(d) || ''}` }),
  fixed_applog_otp_fail_rate: (a, T, W, d) => ({ ...appSpec(a, T, W, d, { pred: ` AND path ~* '(otp|validatecode|verifycode|verifyotp|checkvalidate)'` }), note: `population = OTP / verification steps of ${chan(d) || 'every channel'} · counted = failed ${clsOf(d) || ''}` }),
  fixed_applog_payment_fail_rate: (a, T, W, d) => ({ ...appSpec(a, T, W, d, { pred: ` AND (path ~* '(payment|invoice|checkout|\\ypay)' OR channel = 'payments')` }), note: `population = payment / checkout steps of ${chan(d) || 'every channel'} · counted = failed ${clsOf(d) || ''}` }),
  fixed_applog_latency_p95_ms: (a, T, W, d) => ({ ...appSpec(a, T, W, d, { counted: 'slow' }), note: `population = timed steps of ${chan(d) || 'every channel'} in the window (p95 is computed on them) · counted = steps at or over the rule threshold (${a.threshold} ms), slowest first` }),
  fixed_applog_step_latency_p95_ms: (a, T, W, d) => ({ ...appSpec(a, T, W, d, { counted: 'slow' }), note: `population = every timed step in the window · counted = steps at or over ${a.threshold} ms (the metric is the p95 of the slowest step with ≥ 20 calls — see the By step table)` }),
  fixed_applog_volume_ratio: (a, T, W, d) => ({ ...appSpec(a, T, W, d, { counted: 'none', mutationOnly: false }), num: 'TRUE', note: `population = every app-log line of ${chan(d) || 'the channel'} in the window (the ratio compares this volume with the same-hour 7-day median)` }),
  fixed_applog_provider_technical_rate: (a, T, W, d) => { const p = [T, W, d && d.kind ? String(d.kind) : 'yakeen']; return { pool: db.console, from: 'fixed_app_events', cols: AE_COLS, head: AE_HEAD, pop: `${AE_WIN} AND kind = $3`, num: `ok IS NOT TRUE AND reason_class = 'technical'`, params: p, order: 'ts DESC', group: 'cls', note: `population = every ${p[2]} call in the window · counted = technical failure (timeout / 5xx / transport); business refusals are in the population but not counted` }; },
  fixed_yakeen_technical_rate: (a, T, W) => ({ pool: db.console, from: 'fixed_app_events', cols: AE_COLS, head: AE_HEAD, pop: `${AE_WIN} AND kind IN ('yakeen','yakeen_address')`, num: `ok IS NOT TRUE AND reason_class = 'technical'`, params: [T, W], order: 'ts DESC', group: 'cls', note: 'population = Yakeen / ELM calls in the window · counted = technical failure' }),
  fixed_applog_anomaly_technical: (a, T, W) => ({ ...appSpec(a, T, W, null, { counted: 'technical', mutationOnly: false }), pop: `${AE_WIN} AND ok IS NOT TRUE AND reason_class = 'technical'`, num: 'TRUE', note: 'every technical failure line in the window, grouped by step — the incident text names the signature that spiked' }),
  fixed_applog_anomaly_business: (a, T, W) => ({ ...appSpec(a, T, W, null, { counted: 'failed', mutationOnly: false }), pop: `${AE_WIN} AND ok IS NOT TRUE AND reason_class = 'business'`, num: 'TRUE', note: 'every business refusal line in the window, grouped by step — the incident text names the signature that spiked' }),
  fixed_applog_new_signature: (a, T, W) => ({ ...appSpec(a, T, W, null, { counted: 'failed', mutationOnly: false }), pop: `${AE_WIN} AND ok IS NOT TRUE`, num: 'TRUE', note: 'every failing line in the window, grouped by step — the new signature(s) are named in the incident text' }),
  fixed_applog_retry_loop: (a, T, W) => ({ ...appSpec(a, T, W, null, { counted: 'failed', mutationOnly: false }), pop: `${AE_WIN} AND ok IS NOT TRUE AND reason IS NOT NULL`, num: 'request_id IS NULL', params: [T, W], note: 'population = failing lines in the window · counted = lines with no customer request behind them (worker / scheduler), grouped by step' }),
  fixed_yakeen_probe_down: (a, T, W) => ({ pool: db.console, from: 'yakeen_probe_runs', cols: YP_COLS, head: YP_HEAD, pop: `run_at >= $1::timestamptz - ($2||' hours')::interval AND run_at <= $1::timestamptz`, num: `verdict IN ('down','degraded','unreachable')`, params: [T, W], order: 'run_at DESC', note: 'population = probe runs in the window · counted = runs that ended down / degraded / unreachable' }),
  fixed_provider_api_fail_rate: (a, T, W, d) => ({ ...apiSpec(a, T, W, d, 'fail'), note: `population = outbound integration calls${d && d.host && d.host !== '(worst)' ? ' to ' + d.host : ''} in the window · counted = 5xx or transport error` }),
  fixed_provider_api_latency_p95_ms: (a, T, W, d) => ({ ...apiSpec(a, T, W, d, 'slow'), note: `population = timed integration calls${d && d.host && d.host !== '(worst)' ? ' to ' + d.host : ''} · counted = calls at or over ${a.threshold} ms, slowest first` }),
});
/* console-managed metrics: the population is the dataset rows matching the definition's filters in the window; counted =
 * the numerator (rate) / rows at or over the rule threshold (percentile · avg) / every row (count · distinct) */
async function customSpec(a, T, W, d) {
  try { const cm = require('./customMetrics'); const spec = await cm.caseSpec(a.metric_key, T, W, d, Number(a.threshold)); return spec; } catch (e) { return { pool: null, head: [], error: e.message }; }
}

const NO_ROWS = { fixed_board_ingest_lag_min: 'freshness of the read model — see Alerts › Data sources', fixed_applog_collector_lag_min: 'freshness of the app-log collector — see Alerts › Data sources', apigw_nodes_unreachable: 'console TCP probe (apigw_probe_log) — see #apigw for the node map', dealer_activity: 'aggregate of dealer activity', offhours_orders: 'aggregate', sms_probe_fail_count: 'SMS probe events — see Monitoring › SMS', courier_backlog: 'derived from paid reseller orders without a delivery request', onboarding_created: 'count of orders created', fixed_workhours_activity_ratio: 'same-hour baseline ratio (SDA activity) — see Fixed › Dashboard', fixed_sms_balance: 'Unifonic balance reading' };

async function casesFor(alert, opts = {}) {
  const key = alert.metric_key; const fn = CASES[key] || (/custom_/.test(key) ? customSpec : null);
  const at = opts.at === 'first' ? (alert.fired_at || alert.last_seen_at) : (alert.last_seen_at || alert.fired_at || new Date().toISOString());
  const T = new Date(at).toISOString(), W = Number(alert.window_hours) || 1, dim = alert.dim || {};
  const base = { alert, at: T, window_hours: W, dim, metric: key, segment: segOf(alert) };
  if (!fn) return { ...base, supported: false, reason: NO_ROWS[key] || 'this metric is computed from aggregates, not from individual rows', head: [], rows: [], total: 0, counted: 0 };
  const spec = await fn(alert, T, W, dim);
  if (!spec) return { ...base, supported: false, reason: 'the API-traffic source is the Grafana MySQL feed (no row store) — switch the collector on to get row-level cases', head: [], rows: [], total: 0, counted: 0 };
  if (!spec.pool) return { ...base, supported: false, reason: spec.error || 'data source not configured', head: spec.head || [], rows: [], total: 0, counted: 0 };
  const cap = opts.cap || CAP;
  const tsCol = (spec.head[0] || ['created_at'])[0];
  const order = spec.order || `${tsCol} DESC`;
  const isCount = spec.num === 'TRUE';   // a constant is not allowed in ORDER BY — count metrics order by time only
  const sql = `SELECT ${spec.cols}, (${spec.num}) AS counted FROM ${spec.from} WHERE ${spec.pop} ORDER BY ${isCount ? '' : `(${spec.num}) DESC, `}${order} LIMIT ${cap + 1}`;
  const cnt = await spec.pool.query(`SELECT count(*)::int AS pop, count(*) FILTER (WHERE ${spec.num})::int AS num FROM ${spec.from} WHERE ${spec.pop}`, spec.params);
  const r = await spec.pool.query(sql, spec.params);
  const rows = r.rows.slice(0, cap);
  return { ...base, supported: true, head: spec.head, rows, total: rows.length, capped: r.rows.length > cap, population: cnt.rows[0].pop, counted: cnt.rows[0].num, note: spec.note, group: spec.group || null, kind: spec.num === 'TRUE' ? 'count' : 'rate' };
}

const isTs = k => /_at$|^ts$/.test(k);
function xlsx(d, meta) {
  const X = require('./xlsx');
  const head = ['Counted', ...d.head.map(h => h[1])];
  const body = d.rows.map(r => [r.counted ? 'YES' : '', ...d.head.map(([k]) => { const v = r[k]; return v == null ? '' : (isTs(k) ? ksa(v) : (typeof v === 'object' ? JSON.stringify(v) : v)); })]);
  const S = [[`Alert cases — ${d.alert.name}`], []];
  meta.forEach(([k, v]) => S.push([k, v]));
  if (d.group) { const g = {}; d.rows.forEach(r => { const k = r[d.group] || '—'; g[k] = g[k] || { p: 0, n: 0 }; g[k].p++; if (r.counted) g[k].n++; }); S.push([], [`By ${d.group}`, 'Counted', 'Population']); Object.entries(g).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => S.push([k, v.n, v.p])); }
  return X.build([{ name: 'Cases', rows: [head, ...body], widths: [9, ...d.head.map(([, h]) => /message|response|title|description/i.test(h) ? 60 : /time|started|submitted|sent|created/i.test(h) ? 19 : 18)] }, { name: 'Alert', rows: S, widths: [26, 90, 12] }]);
}
function pdf(d, meta) {
  const P = require('./pdfout');
  const doc = P.doc({ footer: `Salam Operations Console - alert cases - ${d.alert.name} - generated ${ksa(new Date().toISOString())} KSA` });
  const CC = doc.colors;
  const top = doc.band(64, CC.dark);
  doc.at(46, top + 24, `${d.segment === 'fixed' ? 'FIXED' : 'MOBILE'} - ALERT CASES - ${String(d.alert.severity || '')}`, { size: 9, bold: true, color: [0.5, 0.83, 0.65] });
  doc.at(46, top + 44, clip(d.alert.name, 70), { size: 15, bold: true, color: CC.white });
  doc.space(10); doc.h2('Alert'); doc.kv(meta, { boldVal: true });
  if (d.group) { const g = {}; d.rows.forEach(r => { const k = r[d.group] || '—'; g[k] = g[k] || { p: 0, n: 0 }; g[k].p++; if (r.counted) g[k].n++; }); doc.h2(`By ${d.group}`); doc.table([{ label: d.group, w: 30 }, { label: 'Counted', w: 10, align: 'right' }, { label: 'Population', w: 10, align: 'right' }], Object.entries(g).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [String(k), String(v.n), String(v.p)])); }
  doc.h2(`Cases - ${d.total} row(s) shown${d.capped ? ' (PDF capped - the xlsx export holds the full list)' : ''} - counted rows first, marked ●`);
  const H = d.head.slice(0, 7);
  const cols = [{ label: '●', w: 3 }, ...H.map(([, l]) => ({ label: l, w: /message|response|title|description/i.test(l) ? 26 : /time|started|submitted|sent|created/i.test(l) ? 13 : 11 }))];
  doc.table(cols, d.rows.map(r => [r.counted ? '●' : '', ...H.map(([k]) => { const v = r[k]; if (v == null) return '—'; if (isTs(k)) return ksa(v); return clip(typeof v === 'object' ? JSON.stringify(v) : v, 90); })]), { size: 6.8, rowColor: ri => d.rows[ri].counted ? CC.red : null });
  doc.p('Population = exactly what the metric evaluated at the time above; counted = the rows in its numerator. Identities are not masked in this export; the export is audited.', { color: CC.muted, size: 8 });
  return doc.buffer();
}

function mount(app, { audit }) {
  app.get('/api/alerts/:id/cases', async (req, res) => {
    try {
      const a = req.alertRow; const q = req.query || {}; const format = q.format === 'xlsx' ? 'xlsx' : q.format === 'pdf' ? 'pdf' : 'json';
      if (format !== 'json' && !(req.caps && req.caps.export)) return res.status(403).json({ error: `role ${req.roleName} lacks export` });
      const d = await casesFor(a, { at: q.at, cap: format === 'json' ? 300 : format === 'pdf' ? 400 : CAP });
      const from = new Date(new Date(d.at).getTime() - d.window_hours * 3600e3).toISOString();
      const meta = [['Alert', `${a.severity} · ${a.name}`], ['Rule', a.rule_key], ['Metric', `${a.metric_key} ${a.operator} ${a.threshold}`], ['Observed', `${a.observed_value} (sample ${a.sample})`],
        ['Evaluated at', `${ksa(d.at)} KSA (${q.at === 'first' ? 'first firing' : 'last evaluation'})`], ['Window', `${d.window_hours}h — ${ksa(from)} → ${ksa(d.at)} KSA`],
        ['Dimension', Object.keys(d.dim).length ? Object.entries(d.dim).map(([k, v]) => `${k}=${v}`).join(', ') : '—'],
        ['Population', d.supported ? `${d.population} row(s)${d.capped ? ` (file capped at ${d.total})` : ''}` : `not row-based — ${d.reason}`],
        ['Counted', d.supported ? `${d.counted} row(s)${d.kind === 'rate' && d.population ? ` = ${(100 * d.counted / d.population).toFixed(1)}%` : ''}` : '—'],
        ['What the rows are', d.note || '—'], ['Identities', 'unmasked (audited export)'], ['Generated', `${ksa(new Date().toISOString())} KSA by ${req.actor || 'console'}`]];
      if (audit) audit(req, format === 'json' ? 'alert.cases.view' : 'alert.cases.export', String(a.id), { format, metric: a.metric_key, population: d.population, counted: d.counted, at: d.at });
      if (format === 'json') return res.json({ ...d, meta });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="alert-${a.id}-cases_${a.rule_key}_${stamp}.${format}"`);
      if (format === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.send(pdf(d, meta)); }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.send(xlsx(d, meta));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
module.exports = { mount, casesFor, CASES, NO_ROWS };
