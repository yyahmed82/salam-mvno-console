/* alertEvidence.js — WHO AND WHAT IS BEHIND AN INCIDENT (TKT-000065, 24 Sep 2026).
 *
 * The affected items of one incident, computed live over its window [fired_at − window_hours, last_seen_at]:
 *   · Fixed order rules (fixed_nafath_*, fixed_semati_*, fixed_timeout_*, fixed_conversion_*, …) → order attempts from the
 *     dealer-ops read model (sda_ops / B2C): order number, customer (masked), workflow, step reached, last error, dealer /
 *     channel, and the LAST FAILING API CALL of each attempt (endpoint · status · error) from api_calls; the request and
 *     response bodies of that attempt are one more call away (trace) — bodies are masked at rest by the ingest.
 *   · Fixed app-log rules (fixed_applog_*, fixed_yakeen_*) → fixed_app_events: endpoint (path), status code, reason, message,
 *     request id / state id, platform.
 *   · Mobile rules → api_traffic_events of the metric family (or the exact API the rule names): endpoint, code, message,
 *     transaction id — the request/response of a transaction comes from the existing trace view.
 * Identifiers are cut to their last digits unless the caller holds unmaskPII AND asks (?unmask=1) — audited by the route.
 * Read-only, bounded (LIMIT), never throws to the caller: a missing pool becomes a note. Used by GET /api/alerts/:id/evidence
 * (incident drawer) and by alertReport.js (mail + PDF columns). */
'use strict';
const db = require('./db');
const f360 = require('./fixed360');

const tail = (s, k) => s == null || s === '' ? null : '…' + String(s).slice(-k);
const maskRow = r => ({ ...r, msisdn: tail(r.msisdn, 4), customer_id: tail(r.customer_id, 4), cust_code: tail(r.cust_code, 4), service_no: tail(r.service_no, 6), iccid: tail(r.iccid, 6) });
const isFixedKey = k => /^fixed_/.test(String(k || ''));
const isAppLog = k => /^fixed_(applog|yakeen)/.test(String(k || ''));

function windowOf(a) {
  const h = Math.max(1, Number(a.window_hours) || 1);
  const fired = new Date(a.fired_at); const last = new Date(a.last_seen_at || a.fired_at);
  const from = new Date(fired.getTime() - h * 3600e3);
  const to = a.status === 'open' ? new Date() : new Date(Math.max(last.getTime(), fired.getTime()) + 5 * 60e3);
  return { from, to, hours: h };
}

/* which attempts a Fixed order rule is about — mirrors alertReport.fixedEvidence */
function attemptPredicate(key) {
  const FIVE_G = ['fiveGWhiteLabel', 'fiveGFWA'];
  if (/nafath/.test(key)) return { sql: `AND oa.workflow::text = ANY($3::text[]) AND oa.nafath_outcome IS NOT NULL AND oa.nafath_outcome <> 'COMPLETED'`, params: [FIVE_G], title: 'attempts whose Nafath outcome is not COMPLETED' };
  if (/semati/.test(key)) return { sql: `AND oa.workflow::text = ANY($3::text[]) AND oa.nafath_outcome IN ('FAILED','MOBILE_EXISTS')`, params: [FIVE_G], title: 'attempts that failed at Semati provisioning' };
  if (/manafith/.test(key)) return { sql: `AND oa.dealer_validation IS NOT NULL AND oa.dealer_validation NOT IN ('OK','PASSED','APPROVED')`, params: [], title: 'attempts denied by Manafith dealer validation' };
  if (/timeout/.test(key)) return { sql: `AND (oa.outcome::text IN ('STALLED','EXPIRED') OR oa.last_error_category ILIKE '%timeout%')`, params: [], title: 'attempts that timed out or stalled' };
  if (/conversion|stagnation|offhours|workhours/.test(key)) return { sql: `AND oa.outcome::text <> 'COMPLETED'`, params: [], title: 'attempts not completed in the window' };
  return { sql: `AND (oa.outcome::text IN ('STALLED','CANCELLED','EXPIRED') OR oa.last_error_category IS NOT NULL)`, params: [], title: 'attempts with an error in the window' };
}

async function fixedAttempts(a, { limit, unmask, channel }) {
  const pool = f360.poolFor(channel); if (!pool) return { kind: 'attempts', rows: [], note: 'OPS_DATABASE_URL not configured on this console' };
  const w = windowOf(a); const pred = attemptPredicate(a.rule_key);
  const P = [w.from.toISOString(), w.to.toISOString(), ...pred.params];
  if (channel) { P.push(channel); }
  const chanSql = channel ? `AND oa.channel = $${P.length}` : '';
  P.push(limit);
  const r = await pool.query(
    `SELECT oa.id, oa.started_at, oa.completed_at, oa.workflow::text AS workflow, oa.plan, oa.channel, oa.referral_code, oa.order_number, oa.odb,
            oa.msisdn, oa.customer_id, oa.cust_code, oa.service_no, oa.iccid, oa.outcome::text AS outcome, oa.step_reached, oa.nafath_outcome,
            oa.dealer_validation, oa.last_error_category, oa.last_error_at, COALESCE(oa.region, d.region) AS region,
            COALESCE(d.dealer_name, d.dealer_code, oa.channel) AS dealer, d.staff_name,
            c.endpoint AS call_endpoint, c.method AS call_method, c.status AS call_status, c.error_class AS call_error_class, c.error_msg AS call_error_msg, c.id AS call_id, c.created_at AS call_at
       FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id
       LEFT JOIN LATERAL (SELECT id, method, endpoint, status, error_class, error_msg, created_at FROM api_calls
                            WHERE attempt_id = oa.id AND (COALESCE(NULLIF(regexp_replace(status::text, '\\D', '', 'g'), '')::int, 0) >= 400 OR error_class IS NOT NULL OR error_msg IS NOT NULL)
                            ORDER BY created_at DESC LIMIT 1) c ON true
      WHERE oa.started_at >= $1 AND oa.started_at < $2 ${pred.sql} ${chanSql}
      ORDER BY COALESCE(oa.last_error_at, oa.started_at) DESC LIMIT $${P.length}`, P);
  const rows = r.rows.map(x => unmask ? x : maskRow(x));
  return { kind: 'attempts', title: pred.title, window: w, rows, source: pool === db.opsBeta ? 'sda_ops.beta' : 'sda_ops', unmasked: !!unmask,
    cols: ['Started (KSA)', 'Order · customer', 'Journey · step', 'Last failing call', 'Outcome · error', 'Dealer / channel'] };
}

async function fixedAppLog(a, { limit }) {
  const w = windowOf(a); const key = String(a.rule_key || '');
  const kindSql = /yakeen/.test(key) ? `AND kind ILIKE '%yakeen%'` : '';
  const r = await db.console.query(
    `SELECT id, ts, host, channel, source, level, path, kind, ok, status_code, reason, reason_class, message, request_id, state_id, platform, app_version, duration_ms
       FROM fixed_app_events WHERE ts >= $1 AND ts < $2 AND ok = false ${kindSql}
      ORDER BY ts DESC LIMIT $3`, [w.from.toISOString(), w.to.toISOString(), limit]).catch(e => ({ rows: [], error: e.message }));
  return { kind: 'applog', title: 'failed app-log events in the window', window: w, rows: r.rows || [], error: r.error, source: 'fixed_app_events',
    cols: ['When (KSA)', 'Endpoint', 'Status', 'Reason', 'Message', 'Request · state', 'Platform'] };
}

const EVIDENCE = [
  [/^semati/, `path ILIKE '%semati%'`], [/^nafath/, `path ILIKE '%nafath%'`], [/^otp|^sms/, `(path ILIKE '%otp%' OR path ILIKE '%sms%')`],
  [/^payment|^gateway|^recharge|samsung|^web_checkout/, `(path ILIKE '%payment%' OR path ILIKE '%recharge%' OR path ILIKE '%checkout%' OR path ILIKE '%tap%' OR path ILIKE '%upg%')`],
  [/^activation|^bss/, `(path ILIKE '%activation%' OR path ILIKE '%bss%' OR path ILIKE '%subscription%')`],
  [/^app_auth|^login|^auth/, `(path ILIKE '%sign_in%' OR path ILIKE '%auth%' OR path ILIKE '%login%')`], [/^eligibility/, `path ILIKE '%eligib%'`],
];
async function mobileApi(a, rule, { limit }) {
  const w = windowOf(a); const dim = (rule && rule.dim) || {};
  const apiDim = dim.api && !/^\(/.test(String(dim.api)) ? String(dim.api) : null;
  const fam = (EVIDENCE.find(([re]) => re.test(a.metric_key || '')) || [])[1];
  const where = apiDim ? `path = $3` : (fam || 'TRUE');
  const P = [w.from.toISOString(), w.to.toISOString()]; if (apiDim) P.push(apiDim); P.push(limit);
  const r = await db.console.query(
    `SELECT ts, host, path, transaction_id, coalesce(response_code,'—') AS code, coalesce(NULLIF(left(response_message,120),''),'(no message)') AS msg, err_class, duration_ms
       FROM api_traffic_events WHERE ts >= $1 AND ts < $2 AND ${where} AND coalesce(err_class,'') <> 'success'
      ORDER BY ts DESC LIMIT $${P.length}`, P).catch(e => ({ rows: [], error: e.message }));
  return { kind: 'api', title: apiDim ? `failed calls on ${apiDim}` : fam ? 'failed calls of this metric family' : 'failed API calls in the window', window: w, rows: r.rows || [], error: r.error, source: 'api_traffic_events',
    cols: ['When (KSA)', 'Endpoint', 'Code', 'Message', 'Transaction', 'Host'] };
}

/* the entry point: evidence for one incident row */
async function forAlert(a, { limit = 25, unmask = false } = {}) {
  const lim = Math.min(100, Math.max(5, Number(limit) || 25));
  const rule = (await db.console.query(`SELECT dim, description FROM alert_rules WHERE key=$1`, [a.rule_key]).catch(() => ({ rows: [] }))).rows[0] || null;
  if (String(a.rule_key || '').includes('manual_ticket')) return { kind: 'none', rows: [], note: 'Manual ticket — the evidence is what the reporter wrote in the message and the discussion.' };
  if (a.rule_key === 'refund_batch') return { kind: 'none', rows: [], note: 'Refund batch opened by the refund desk (Agent 2) — the cases, their evidence and the proxycms state are on Mobile › Refund exposure; the incident resolves when every case is closed.' };
  try {
    if (isAppLog(a.rule_key)) return await fixedAppLog(a, { limit: lim });
    if (isFixedKey(a.rule_key) || a.segment === 'fixed') {
      const dim = (rule && rule.dim) || {}; const channel = ['sda', 'epurchase', 'salamhome'].includes(dim.channel) ? dim.channel : null;
      return await fixedAttempts(a, { limit: lim, unmask, channel });
    }
    return await mobileApi(a, rule, { limit: lim });
  } catch (e) { return { kind: 'error', rows: [], error: e.message }; }
}

/* one attempt's calls — request / response bodies (masked at rest) for the "what did the app send" question */
async function attemptCalls(attemptId, { channel } = {}) {
  const id = String(attemptId || '').slice(0, 80); if (!id) throw Object.assign(new Error('attempt required'), { status: 400 });
  const pools = [f360.poolFor(channel)]; if (db.opsBeta && pools[0] !== db.opsBeta) pools.push(db.opsBeta);
  for (const pool of pools) {
    if (!pool) continue;
    const r = await pool.query(`SELECT id, method, endpoint, status, duration_ms, error_class, error_msg, left(coalesce(req_body::text,''), 4000) AS req_body, left(coalesce(res_body::text,''), 4000) AS res_body, created_at
        FROM api_calls WHERE attempt_id = $1 ORDER BY created_at ASC LIMIT 60`, [id]);
    if (r.rows.length) return { attempt: id, calls: r.rows, note: 'bodies are masked at ingest (PII cut to last digits); full context needs the audited unmask on the trace view' };
  }
  return { attempt: id, calls: [], note: 'no api_calls rows for this attempt (purged or not captured)' };
}

module.exports = { forAlert, attemptCalls, windowOf, attemptPredicate, maskRow };
