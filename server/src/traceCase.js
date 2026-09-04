/* Case analyzer — turn a trace id / request id (what the mobile app shows as "Device ID" in its
 * error dialog) into a full diagnosis: matching app-error events, the exception + code frame,
 * affected user/platform, first/last seen — plus a KNOWN-CASES knowledge base that maps common
 * exception classes / messages to a plain-language explanation, classification and action.
 * Used by GET /api/trace/:id (Troubleshoot "Case analyzer") and injected into Yusr's context
 * whenever a question contains a trace-looking token. */
const db = require('./db');

/* Known cases — grown from real investigations. matcher runs on exception_class OR message. */
const CASE_KB = [
  { match: /InvalidAdvancedPostpaidPayment/i,
    title: 'Postpaid payment amount outside configured limits',
    classification: 'business (configuration)',
    explanation: 'PaymentManager#validate_amount_limit (app/lib/payment_manager.rb:21) rejects the amount: it must satisfy min_postpaid_charge ≤ amount ≤ max_postpaid_charge, and amount+credit ≤ max_postpaid_credit (Settings, editable in ActiveAdmin). If the customer\'s due bill exceeds max_postpaid_charge they cannot pay in full — the app pre-fills the full due and the backend rejects it as a generic -501.',
    action: 'Workaround: pay in parts (≤ max_postpaid_charge each). Fix: raise max_postpaid_charge in ActiveAdmin Settings (audited, instant), and app team should surface the dedicated 422 (the specific rescue_from at exception_handler.rb:98 is being shadowed → customer sees a meaningless -501/500).' },
  { match: /IP_RETRIES|ip_retrial/i,
    title: 'IP rate-limiter block (-704)',
    classification: 'business (rate limiting — flawed gap logic)',
    explanation: 'IpRetrial concern blocks recharge voucher/validate actions per IP. Known flaw: an idle gap > ip_session_time BLOCKS instead of resetting, and ip_elapse_time=180000s keeps the block up to 50h — 98% of blocks hit customers with ≤3 attempts (shared CGNAT IPs).',
    action: 'Unblock: delete the Redis key ip_address_retries_<action>_<ip>. Fix: correct the gap logic in ip_retrial.rb:32 + restore sane settings.' },
  { match: /Subscription with ID\/MobileNumber\/SubscriptionType = null/i,
    title: 'BSS lookup with null subscription identifiers (Error 7)',
    classification: 'technical (app-side data/state bug)',
    explanation: 'The app calls BSS with null ID/MobileNumber — the subscriber context was not resolved before the BSS call (mostly V2 UsersController#dashboard).',
    action: 'App team: guard the dashboard flow when the subscription context is missing; high volume — top -501 producer.' },
  { match: /faultCode argument for createFault was passed NULL/i,
    title: 'BSS SOAP fault with NULL faultCode (Error 1500 family)',
    classification: 'technical (BSS/OSB)',
    explanation: 'The BSS returned a malformed SOAP fault (faultCode NULL) — the OSB/Siebel read-path fault family (see uil_logs / INC0016809 history).',
    action: 'Correlate with OSB read faults in Troubleshoot → Activation; raise to BSS team if surging.' },
  { match: /NAFATH API ERROR/i,
    title: 'Nafath provider error',
    classification: 'technical (provider)',
    explanation: 'Nafath/IAM returned an error during authorize — provider-side degradation shows here first.',
    action: 'Check the nafath journey signals + anomaly panel; if clustered, treat as provider incident.' },
  { match: /undefined method .current_plan.|undefined method .user./i,
    title: 'Nil-object crash in app code',
    classification: 'technical (app bug)',
    explanation: 'A Ruby NoMethodError on nil — request reached code that assumed a record exists (plan/user). Generic -501 to the customer.',
    action: 'App team ticket with the frame + request_id; group by frame to size the impact.' },
  { match: /Open Order Exist for the Requested MSISDN/i,
    title: 'Open order already exists for MSISDN',
    classification: 'business (expected guard)',
    explanation: 'A renewal/order was attempted while another order is still open for the same MSISDN.',
    action: 'Check the open order in the console (flow tree / Subscriber 360) and complete or expire it.' }
];

function kbMatch(exception_class, message) {
  const hay = `${exception_class || ''} ${message || ''}`;
  for (const k of CASE_KB) if (k.match.test(hay)) return { title: k.title, classification: k.classification, explanation: k.explanation, action: k.action };
  return null;
}

/* analyze('746bba…') — id may be a 32-hex trace_id, a UUID request_id, or a device id.
 * Tolerant of sloppy pastes: extracts the first trace-looking token from whatever text arrives
 * (users paste the whole error-dialog text from WhatsApp screenshots). */
/* ---- ip_retrial settings (LIVE, from the replica RailsSettings table) --------------------
 * The three values that govern -704: ip_request_rate_limit / ip_session_time / ip_elapse_time.
 * RailsSettings stores YAML scalars ("--- 200\n"); parse the integer defensively. Cached 5 min. */
let _rlCache = null, _rlAt = 0;
async function ipRetrialSettings() {
  if (_rlCache && Date.now() - _rlAt < 300000) return _rlCache;
  const out = { ip_request_rate_limit: 5, ip_session_time: 180, ip_elapse_time: 3600, source: 'defaults' };
  try {
    const r = await db.source.query(
      `SELECT var, value FROM settings WHERE var IN ('ip_request_rate_limit','ip_session_time','ip_elapse_time')`);
    for (const row of r.rows) {
      const n = parseInt(String(row.value).replace(/[^0-9-]/g, ''), 10);
      if (Number.isFinite(n)) out[row.var] = n;
    }
    if (r.rows.length) out.source = 'live (settings table)';
  } catch (e) { /* replica hiccup → defaults + label */ }
  _rlCache = out; _rlAt = Date.now(); return out;
}

const fmtDur = s => s >= 86400 ? (s / 86400).toFixed(1) + ' days' : s >= 3600 ? (s / 3600).toFixed(1) + 'h' : Math.round(s / 60) + ' min';

/* -704 deep analysis: which of the two block conditions fired, when the block started, and when
 * it auto-clears. Logic mirrors ip_retrial.rb exactly:
 *   allowed  = (gap since last ALLOWED request) <= ip_session_time  AND  retries < limit
 *   blocked requests do NOT refresh the cache entry, which expires ip_elapse_time after the
 *   LAST ALLOWED request → auto-unblock = last_allowed + ip_elapse_time. */
function analyzeIpBlock(rows, cfg) {
  const evs = rows.slice().reverse();                       // chronological
  const blocked = evs.filter(r => String(r.error_code) === '-704');
  if (!blocked.length) return null;
  const firstBlock = blocked[0];
  // last event BEFORE the first -704 that is not itself a -704 = last request that PASSED the gate
  const prior = evs.filter(r => String(r.error_code) !== '-704' && new Date(r.ts) < new Date(firstBlock.ts));
  const lastAllowed = prior.length ? prior[prior.length - 1] : null;
  let condition, detail;
  if (lastAllowed) {
    const gapSec = Math.round((new Date(firstBlock.ts) - new Date(lastAllowed.ts)) / 1000);
    if (gapSec > cfg.ip_session_time) {
      condition = 'idle-gap defect (ip_retrial.rb:32)';
      detail = `The customer PAUSED ${fmtDur(gapSec)} between attempts — longer than ip_session_time (${fmtDur(cfg.ip_session_time)}). ` +
        `The code treats a long pause as a violation instead of a reset, so the block fired regardless of how few attempts were made.`;
    } else {
      condition = `attempt limit (${cfg.ip_request_rate_limit} per session)`;
      detail = `More than ${cfg.ip_request_rate_limit} requests inside one ${fmtDur(cfg.ip_session_time)} session from this IP ` +
        `(NOTE: the counter is per-IP — on shared/CGNAT IPs many customers pool into one counter).`;
    }
    const unblockAt = new Date(new Date(lastAllowed.ts).getTime() + cfg.ip_elapse_time * 1000);
    return { condition, detail,
      last_allowed_at: lastAllowed.ts, last_allowed_outcome: lastAllowed.error_code,
      first_block_at: firstBlock.ts, blocked_attempts: blocked.length,
      auto_unblock_at: unblockAt.toISOString(),
      auto_unblock_human: `${unblockAt.toISOString().replace('T',' ').slice(0,16)}Z (${fmtDur(Math.max(0,(unblockAt-Date.now())/1000))} from now)`,
      settings: cfg,
      unblock_now: 'On an API host (17/18): bundle exec rails runner ' +
        `'Rails.cache.delete_matched("ip_address_retries_*<IP>*")' — or per action: Rails.cache.delete("ip_address_retries_validate_details_<IP>")` };
  }
  return { condition: 'unknown start (no pre-block event stored)', detail: 'All stored events are already blocked; the last allowed request predates the log window.',
    first_block_at: firstBlock.ts, blocked_attempts: blocked.length, settings: cfg };
}

async function analyze(id) {
  const raw = String(id || '');
  const tok = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})/i.exec(raw);
  const clean = (tok ? tok[1] : raw.trim());
  // accept trace ids, request ids, device ids AND transaction ids (the app's transactionId /
  // uilTransactionId — joins api_traffic_events ⇄ gateway spans ⇄ uil_logs via apigwTrace)
  if (!/^[\w.-]{6,64}$/.test(clean)) return { found: false, error: 'not a trace/request/transaction id' };
  const rows = (await db.console.query(
    `SELECT ts, host, level, error_code, http_status, controller, action, platform, app_version,
            user_type, message, request_id, trace_id, device_id, exception_class, frame
     FROM api_error_events
     WHERE trace_id = $1 OR request_id = $1 OR device_id = $1
     ORDER BY ts DESC LIMIT 50`, [clean])).rows;
  // gateway/app/uil correlation runs regardless — an id can be a transaction id with no error events
  let gateway = null;
  try { const g = await require('./apigwTrace').forTxn(clean); if (g && g.found) gateway = g; } catch (e) {}
  if (!rows.length && gateway) {
    // transaction-level match: no app-error events, but the call's full path is known
    const app = gateway.app || [];
    const last = app[app.length - 1] || {};
    return {
      found: true, kind: 'transaction', id: clean, occurrences: 0,
      first_seen: app.length ? app[0].ts : null, last_seen: app.length ? last.ts : null,
      error_codes: [...new Set(app.map(r => r.response_code).filter(Boolean))],
      exception_classes: [], endpoints: [...new Set(app.map(r => r.path).filter(Boolean))],
      frames: [], platform: null, app_version: null,
      sample_message: last.response_message || null,
      known_case: kbMatch('', last.response_message || ''),
      ip_block: null, entries: [], gateway
    };
  }
  if (!rows.length) return { found: false, id: clean,
    note: 'No stored events for this id. If the error is older than the log backfill or very recent, grep the api_error_logger on the API hosts directly.' };
  const first = rows[rows.length - 1], last = rows[0];
  const excs = [...new Set(rows.map(r => r.exception_class).filter(Boolean))];
  const codes = [...new Set(rows.map(r => r.error_code).filter(x => x != null))];
  const ctrls = [...new Set(rows.map(r => `${r.controller || '?'}#${r.action || '?'}`))];
  const frames = [...new Set(rows.map(r => r.frame).filter(Boolean))].slice(0, 3);
  const kb = kbMatch(excs[0] || '', last.message || '');
  let ip_block = null;
  if (codes.some(c => String(c) === '-704')) {
    try { ip_block = analyzeIpBlock(rows, await ipRetrialSettings()); } catch (e) { /* non-fatal */ }
  }
  return {
    found: true, id: clean, occurrences: rows.length,
    first_seen: first.ts, last_seen: last.ts,
    error_codes: codes, exception_classes: excs, endpoints: ctrls, frames,
    platform: last.platform || null, app_version: last.app_version || null,
    sample_message: last.message || null,
    known_case: kb,
    ip_block,
    entries: rows.slice(0, 10),
    gateway                               // app ⇄ APIGW hops ⇄ uil_logs, when the id correlates
  };
}

module.exports = { analyze, kbMatch, CASE_KB, ipRetrialSettings, analyzeIpBlock };
