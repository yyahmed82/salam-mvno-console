/* identity.js — WHO is behind a metric: distinct customers / services in the population a metric evaluated (11 Sep 2026).
 *
 * WHY. Every rule used to count EVENTS. One customer retrying a failing payment 13 times looked exactly like 13
 * customers failing once (alert #14423: 13 of the 19 Semati failures came from ONE msisdn) — a P2 page for a retry
 * storm. Rules can now count DISTINCT customers or services instead (alert_rules.count_by), and any rule can
 * downgrade itself when fewer than `min_customers` customers are affected (single_customer_severity, default P4).
 *
 * HOW. alertCases.js already mirrors every metric 1:1 (same table, same window, same dimension filter, `pop` =
 * the population, `num` = the counted rows). We reuse those twins and only add WHICH COLUMN is the customer and
 * which is the service for each source table — so the identity counts always describe the same rows the metric
 * and the "Affected cases" export describe. A metric whose source carries no customer (API gateway probes, app
 * error log, SMS probes, aggregates) simply has no identity: the editor greys the option out and says why.
 *
 * customers       = distinct customers among the COUNTED rows (failed payments → customers who had a failure)
 * customers_total = distinct customers in the whole population (everyone who paid in the window)
 * services / services_total = the same on the service key (payment id, order id, delivery id…)
 * rate on customers = customers / customers_total   ("share of customers hit"), same for services. */
'use strict';
const db = require('./db');

const WIN = `created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`;
/* Semati calls with their identity columns — the metrics' own SEMATI_UNION only carries api/status/response */
const SEMATI_UNION_ID = `
  SELECT api, status_code, response, state, created_at, msisdn, onboarding_order_id FROM activation_logs
   WHERE api ILIKE '%semati%' AND ${WIN}
  UNION ALL
  SELECT api, status_code, response, state, created_at, msisdn, onboarding_order_id FROM eligibility_logs
   WHERE api ILIKE '%semati%' AND ${WIN}`;

/* source table (the `from` of the alertCases twin) → customer / service expressions */
const BY_TABLE = [
  [/^payments p JOIN checkouts/, { customer: `NULLIF(p.customer_mobile_number::text,'')`, service: `p.payment_on_id::text`, what: 'payments (recharge checkouts)' }],
  [/^payments$/,                  { customer: `NULLIF(customer_mobile_number::text,'')`, service: `payment_on_id::text`, what: 'payments' }],
  [/^activation_logs$/,           { customer: `NULLIF(msisdn::text,'')`, service: `onboarding_order_id::text`, what: 'activation calls' }],
  [/^eligibility_logs$/,          { customer: `NULLIF(msisdn::text,'')`, service: `onboarding_order_id::text`, what: 'eligibility checks' }],
  [/^nafath_logs$/,               { customer: `COALESCE(NULLIF(msisdn::text,''), nationality_id_number::text)`, service: `id::text`, what: 'Nafath requests' }],
  [/^change_plan_logs$/,          { customer: `NULLIF(mobile_number::text,'')`, service: `COALESCE(NULLIF(payment_id::text,''), id::text)`, what: 'plan changes' }],
  [/^delivery_requests$/,         { customer: `NULLIF(receiver_mobile::text,'')`, service: `delivery_on_id::text`, what: 'delivery requests' }],
  [/^onboarding_orders$/,         { customer: `NULLIF(mobile_number::text,'')`, service: `id::text`, what: 'onboarding orders' }],
  [/^otps$/,                      { customer: `NULLIF(otp_for::text,'')`, service: `id::text`, what: 'OTPs' }],
];
/* metrics whose twin reads the identity-less Semati union → swap in the union that carries msisdn / order id */
const SEMATI_KEYS = new Set(['semati_provider_error_rate', 'semati_transport_error_rate', 'semati_timeout_count', 'semati_success_volume', 'citc_upstream_degraded']);
const SEMATI_ID = { customer: `NULLIF(msisdn::text,'')`, service: `onboarding_order_id::text`, what: 'Semati calls (activation + eligibility)' };

const NO_IDENTITY_WHY = {
  apigw_nodes_unreachable: 'TCP probe of the gateway nodes — no customer behind a probe',
  app_ip_block_count: 'app error log (api_error_events) carries no customer identity', app_crash_count: 'app error log carries no customer identity',
  app_auth_fail_count: 'app error log carries no customer identity', app_backend_err_count: 'app error log carries no customer identity',
  sms_probe_fail_count: 'SMS gateway probe — synthetic traffic', api_latency_p95: 'gateway traffic events carry no customer identity',
  api_technical_fail_rate: 'gateway traffic events carry no customer identity', semati_flapping: 'a transition count (ok → error flips), not a set of rows',
  dealer_activity: 'aggregate of dealer activity', offhours_orders: 'aggregate', courier_backlog: 'derived from orders without a delivery row',
  onboarding_created: 'volume metric', payment_volume: 'volume metric', gateway_success_volume: 'per-gateway volume watchdog', bss_top_error_share: 'share of one error code, not a set of customers',
};

let _cases = null;
function cases() { if (!_cases) _cases = require('./alertCases').CASES; return _cases; }

/* the identity spec of a metric: { from, pop, num, params, pool, cols:{customer,service}, what } — or null (+ why) */
function specFor(key, T, W, dim) {
  const fn = cases()[key];
  if (!fn || fn.constructor.name === 'AsyncFunction') return null;
  let s; try { s = fn({}, T, W, dim || {}); } catch (_) { return null; }
  if (!s || !s.pool || !s.from) return null;
  if (SEMATI_KEYS.has(key)) return { ...s, from: `(${SEMATI_UNION_ID}) u`, cols: SEMATI_ID };
  const hit = BY_TABLE.find(([re]) => re.test(String(s.from).trim()));
  if (!hit) return null;
  return { ...s, cols: hit[1] };
}
function supports(key) { return !!specFor(key, new Date().toISOString(), 1, {}); }
function why(key) { return supports(key) ? null : (NO_IDENTITY_WHY[key] || 'this metric is computed from aggregates — no per-customer rows'); }
function whatOf(key) { const s = specFor(key, new Date().toISOString(), 1, {}); return s ? s.cols.what : null; }
/* catalog helper: { metric_key: { identity: true|false, why, what } } for every key */
function catalog(keys) { const o = {}; for (const k of keys) o[k] = { identity: supports(k), why: why(k), what: whatOf(k) }; return o; }

/* distinct counts for ONE (metric, T, W, dim) — the same rows the metric / Affected-cases export describe */
async function counts(key, T, W, dim) {
  const s = specFor(key, T, W, dim);
  if (!s) return null;
  const num = s.num === 'TRUE' ? 'TRUE' : `(${s.num})`;
  const r = await s.pool.query(
    `SELECT count(DISTINCT ${s.cols.customer}) FILTER (WHERE ${num})::int AS customers,
            count(DISTINCT ${s.cols.customer})::int                      AS customers_total,
            count(DISTINCT ${s.cols.service})  FILTER (WHERE ${num})::int AS services,
            count(DISTINCT ${s.cols.service})::int                       AS services_total
     FROM ${s.from} WHERE ${s.pop}`, s.params);
  return r.rows[0] || null;
}

/* dim filter subset match — identical to alertRunner.dimMatch */
const dimMatch = (snapDim, ruleDim) => Object.keys(ruleDim || {}).every(k => String((snapDim || {})[k]) === String(ruleDim[k]));

/* which snapshot rows of `key` need identity counts: those matching the dim of an enabled rule that counts
 * by customers/services or carries a min_customers floor. Cached 30 s (called every sync tick). */
let _need = null, _needAt = 0;
async function needMap() {
  if (_need && Date.now() - _needAt < 30000) return _need;
  const r = await db.console.query(
    `SELECT metric_key, window_hours, dim FROM alert_rules
     WHERE enabled = true AND (COALESCE(count_by,'events') <> 'events' OR COALESCE(min_customers,0) > 0)`).catch(() => ({ rows: [] }));
  const m = {};
  for (const row of r.rows) (m[`${row.metric_key}|${Number(row.window_hours)}`] ||= []).push(row.dim || {});
  _need = m; _needAt = Date.now(); return m;
}
function invalidate() { _need = null; }
/* enrich compute() rows in place with customers/services (only the rows some rule needs) */
async function enrich(key, W, T, rows) {
  const need = (await needMap())[`${key}|${Number(W)}`];
  if (!need || !need.length) return 0;
  let done = 0;
  for (const row of rows) {
    if (!need.some(d => dimMatch(row.dim || {}, d))) continue;
    try { const c = await counts(key, T, W, row.dim || {}); if (c) { Object.assign(row, c); done++; } }
    catch (e) { console.error(`[identity] ${key} w=${W} dim=${JSON.stringify(row.dim || {})}: ${e.message}`); }
  }
  return done;
}

module.exports = { supports, why, whatOf, catalog, counts, enrich, invalidate, specFor };
