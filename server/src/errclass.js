/* Error classification — SINGLE SOURCE OF TRUTH for Business vs Technical, console-wide.
 *
 * Principle (agreed with L2, session 2 / 2026-08-11):
 *   BUSINESS  = the API answered normally with a negative OUTCOME. The platform worked.
 *               (not eligible, OTP expired, card declined, number already exists, SIM used …)
 *   TECHNICAL = the API failed to answer. Timeouts, BSS faults/outages, transport errors,
 *               5xx/1500/OSB faults, SOAP faults, "service not available".
 *
 * COLOR STANDARD (matches the Grafana dealer dashboards so both worlds read the same):
 *   success   → green  (--ok      / #10b981)
 *   business  → blue   (--err-biz / #3b82f6)
 *   technical → red    (--err-tec / #ef4444)
 * Use classifyClass() + COLORS everywhere a response is shown: Troubleshoot feed & tiles,
 * dashboard KPIs, timeline drawers, Sub360, analytics, Yusr packs.
 */
'use strict';

const COLORS = {
  success:   { key: 'success',   label: 'Success',         color: '#10b981', bg: '#e7f8ef' },
  business:  { key: 'business',  label: 'Business error',  color: '#3b82f6', bg: '#e9f1fe' },
  technical: { key: 'technical', label: 'Technical error', color: '#ef4444', bg: '#fdeceb' }
};

/* TECHNICAL signatures — transport / platform / outage. Checked FIRST: if any matches,
 * the response never carried a real answer. Sources: BSS 1500 & OSB-382000 (INC0016809),
 * Semati 715/5002/408 (#28713), gateway/webhook timeouts, CRM exceptions, generic 5xx. */
const TECH_CODE = new Set(['1500', '5002', '408', '500', '502', '503', '504', '715']);
const TECH_TEXT = /\b(timeout|timed[\s-]?out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|connection (reset|refused|closed)|SSLException|SSLHandshake|I\/O error|read timed out|broken pipe|service (is )?not available|temporarily unavailable|unavailable|OSB-382000|CRMException|SOAPFault|soap:Fault|internal server error|gateway timeout|bad gateway|no response|empty response|null response|unreachable|circuit.?breaker|too many requests|exhausted)\b/i;

/* BUSINESS signatures — a well-formed "no". Semati/CITC app codes, OTP, payment declines,
 * eligibility, inventory. (Payment declines: ANY gateway decline code/message = business —
 * the gateway processed the request and said no.) */
const BIZ_CODE = new Set(['727', '726', '706', '738', '708', '823', '824', '736', '804', '776']);

/* TKT-000017 (d.sahoo, 2 Sep 2026): L2 needs to (re)classify codes WITHOUT a deploy — alerts were
 * firing on codes that are valid business outcomes. Overrides live in console_settings key
 * 'errclass_overrides' = { tech_add:[], biz_add:[], tech_remove:[], biz_remove:[] } and are
 * layered over the built-in sets at classify time. add wins over the other side's built-in;
 * remove demotes a built-in to the heuristic path. Editable in Alerts → Rules (editRules cap).
 * SCOPE: applies to NEW classifications from save time (api_traffic_events.err_class is stamped
 * at ingest — history keeps its class). DMS journey codes have their own SUCCESS set. */
let _OV = { tech_add: [], biz_add: [], tech_remove: [], biz_remove: [] };
function setOverrides(o) {
  const arr = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).slice(0, 200) : [];
  _OV = { tech_add: arr(o && o.tech_add), biz_add: arr(o && o.biz_add),
          tech_remove: arr(o && o.tech_remove), biz_remove: arr(o && o.biz_remove) };
}
function getOverrides() { return _OV; }
function techHas(code) { return (_OV.tech_add.includes(code) || TECH_CODE.has(code)) && !_OV.tech_remove.includes(code) && !_OV.biz_add.includes(code); }
function bizHas(code)  { return (_OV.biz_add.includes(code)  || BIZ_CODE.has(code))  && !_OV.biz_remove.includes(code)  && !_OV.tech_add.includes(code); }
const BIZ_TEXT = /\b(not eligible|ineligible|expired|invalid|already (exists?|used|registered|active)|not found|doesn'?t exist|does not exist|MOBILE_DOESNT_EXIST|declined|insufficient|rejected|denied|exceeds?|exceeded|limit reached|max(imum)? allowed|wrong (otp|pin|code)|incorrect|mismatch|duplicate|not allowed|not permitted|blacklist|no price plan|price plan (found|available)|reservation (expired|not found)|under age|age restriction|quota)\b/i;

function _txt(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

/* classifyClass({ ok, status_code, response, detail })
 *  ok          — true/false/null: the recorded outcome of the step (null = pending/unknown)
 *  status_code — provider/HTTP/app code as string or number (optional)
 *  response    — raw response body (string or object, optional)
 *  detail      — free-text error/detail line (optional)
 * → { cls: 'success'|'business'|'technical', reason: <matched signal>, ...COLORS[cls] }        */
function classifyClass({ ok, status_code, response, detail } = {}) {
  if (ok === true) return { ...COLORS.success, cls: 'success', reason: 'ok' };
  const code = String(status_code == null ? '' : status_code).trim();
  const text = (_txt(response) + ' ' + _txt(detail)).slice(0, 4000);

  // 0) Nafath application codes like "500-C001" (request rejected / person not resolvable — e.g.
  //    a PASSPORT number sent to Nafath, which only knows National/Iqama IDs) are a well-formed
  //    "no" = BUSINESS. Checked before the technical codes so the "500" prefix can't collide with
  //    HTTP 500. (Live case 2026-08-11: HE3486840i/TR2110858 visitor passports → 500-C001.)
  if (/^\d{3}-C\d+/i.test(code) || /\b\d{3}-C\d{3}\b/.test(text))
    return { ...COLORS.business, cls: 'business', reason: 'provider app code (n-Cnnn)' };

  // 0.5) explicit BUSINESS override beats everything except success — the whole point of TKT-17
  if (code && _OV.biz_add.includes(code)) return { ...COLORS.business, cls: 'business', reason: 'code ' + code + ' (configured business)' };
  // 1) technical wins: if the failure looks like transport/platform, the "answer" is noise
  if (code && techHas(code)) return { ...COLORS.technical, cls: 'technical', reason: 'code ' + code };
  const tm = text.match(TECH_TEXT);
  if (tm) return { ...COLORS.technical, cls: 'technical', reason: tm[0] };

  // 2) explicit business signals
  if (code && bizHas(code)) return { ...COLORS.business, cls: 'business', reason: 'code ' + code };
  const bm = text.match(BIZ_TEXT);
  if (bm) return { ...COLORS.business, cls: 'business', reason: bm[0] };

  // 3) heuristic fallback:
  //    - a failed step WITH a readable response/message answered us → business (API worked, said no)
  //    - a failed step with NO usable response → technical (it never really answered)
  if (ok === false) {
    const hasAnswer = text.replace(/[\s{}\[\]"null]+/gi, '').length >= 8;
    return hasAnswer
      ? { ...COLORS.business, cls: 'business', reason: 'answered-negative (heuristic)' }
      : { ...COLORS.technical, cls: 'technical', reason: 'no-usable-response (heuristic)' };
  }
  // pending / unknown outcome: neutral-ish — treat as business so it never false-pages as outage
  return { ...COLORS.business, cls: 'business', reason: 'unknown-outcome' };
}

/* SQL fragment builder for set-based splits (Troubleshoot tiles, KPIs, analytics).
 * colExpr = SQL expression yielding the searchable text (e.g. "coalesce(status_code,'')||' '||response::text").
 * Returns a CASE yielding 'technical' | 'business' — keep IN SYNC with the regexes above. */
function classCaseSql(codeCol, textExpr) {
  const tech = "(timeout|timed[ -]?out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|connection (reset|refused|closed)|SSLException|I/O error|service (is )?not available|OSB-382000|CRMException|SOAPFault|soap:Fault|internal server error|gateway timeout|bad gateway|unreachable)";
  const safe = a => a.filter(c => /^[\w.-]{1,12}$/.test(c));
  const techList = [...new Set([...TECH_CODE, ..._OV.tech_add])].filter(c => !_OV.tech_remove.includes(c) && !_OV.biz_add.includes(c));
  const bizAdd = safe(_OV.biz_add);
  return `CASE
    WHEN coalesce(${codeCol},'') ~ '^[0-9]{3}-C' OR ${textExpr} ~ '[0-9]{3}-C[0-9]{3}' THEN 'business'
    ${bizAdd.length ? `WHEN coalesce(${codeCol},'') IN (${bizAdd.map(c => `'${c}'`).join(',')}) THEN 'business'` : ''}
    WHEN coalesce(${codeCol},'') IN (${safe(techList).map(c => `'${c}'`).join(',') || `''`}) THEN 'technical'
    WHEN ${textExpr} ~* '${tech}' THEN 'technical'
    ELSE 'business' END`;
}

module.exports = { classifyClass, classCaseSql, COLORS, TECH_CODE, BIZ_CODE, setOverrides, getOverrides };
