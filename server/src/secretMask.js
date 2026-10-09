/* secretMask.js — SIM secrets never leave the console (alpha.158, 9 Oct 2026); customer-data masking for raw nexus
 * bodies shown masked (alpha.159, maskPiiText / maskBodyText at the end).
 *
 * BSS querySimCard answers carry the SIM's authentication material next to its serial (ki, opc, pin / puk, adm …).
 * The dealer-ops ingest keeps the answer as it is in sda_ops api_calls.res_body (its maskPii covers national id,
 * name and mobile only), nexus keeps it in api_logs and in workflow_states.context.sim, and the app writes it to
 * combined.log. Found 9 Oct 2026 while tracing a 5G e-purchase journey: Fixed › trace returned the ki of the SIM.
 *
 * Every body the console serves from those sources goes through maskSecrets() — the trace (api_calls + raw
 * context), the error board (detail, unmask, export), the app-log grep and the 5G lane. "Unmask" is for customer
 * data; it never shows SIM keys. Values are replaced, the keys stay, so a reader still sees which fields came back.
 *   maskSecretsText(s)  strings (JSON text, possibly truncated or escaped inside another JSON string)
 *   maskSecretsObj(o)   parsed objects / arrays (deep, bounded), string leaves through maskSecretsText
 *   maskSecrets(v)      either */
'use strict';

const MASK = '•masked•';
/* exact key names, case-insensitive: SIM authentication / OTA keys and access codes */
const KEYS = ['ki', 'k', 'eki', 'opc', 'op', 'kic', 'kid', 'kik', 'k4', 'pin', 'pin1', 'pin2', 'puk', 'puk1', 'puk2',
  'adm', 'adm1', 'adm2', 'adm3', 'adm4', 'adm5', 'adm6', 'adm7', 'adm8', 'adm9', 'transportKey', 'authKey', 'simKey'];
const KEYSET = new Set(KEYS.map(k => k.toLowerCase()));
const ALT = KEYS.map(k => k.replace(/[^a-zA-Z0-9]/g, '')).join('|');
/* "ki":"…" · "ki": 123 · \"ki\":\"…\" (a JSON document stored inside a JSON string) */
const RX_STR = new RegExp(`("(?:${ALT})"\\s*:\\s*")(?:[^"\\\\]|\\\\.)*(")`, 'gi');
const RX_NUM = new RegExp(`("(?:${ALT})"\\s*:\\s*)-?\\d+(?:\\.\\d+)?`, 'gi');
const RX_ESC = new RegExp(`(\\\\"(?:${ALT})\\\\"\\s*:\\s*\\\\")(?:[^"\\\\]|\\\\[^"])*(\\\\")`, 'gi');
/* a body cut inside the value (sda_ops keeps 4 000 characters, then "…(truncated)") — mask to the end */
const RX_TAIL = new RegExp(`("(?:${ALT})"\\s*:\\s*")(?:[^"\\\\]|\\\\.)*$`, 'i');
const RX_ESC_TAIL = new RegExp(`(\\\\"(?:${ALT})\\\\"\\s*:\\s*\\\\")(?:[^"\\\\]|\\\\[^"])*$`, 'i');

function maskSecretsText(s) {
  if (s == null) return s;
  const t = typeof s === 'string' ? s : String(s);
  if (!/(?:^|[^a-z0-9])(?:ki|k|eki|opc|op|kic|kid|kik|k4|pin\d?|puk\d?|adm\d?|transportkey|authkey|simkey)(?:[^a-z0-9]|$)/i.test(t)) return t;
  return t.replace(RX_ESC, `$1${MASK}$2`).replace(RX_STR, `$1${MASK}$2`).replace(RX_NUM, `$1"${MASK}"`).replace(RX_ESC_TAIL, `$1${MASK}`).replace(RX_TAIL, `$1${MASK}`);
}

function maskSecretsObj(v, depth = 0) {
  if (v == null || depth > 14) return v;
  if (typeof v === 'string') return maskSecretsText(v);
  if (Array.isArray(v)) return v.map(x => maskSecretsObj(x, depth + 1));
  if (typeof v === 'object') {
    if (v instanceof Date || Buffer.isBuffer(v)) return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = KEYSET.has(String(k).toLowerCase()) && x != null && typeof x !== 'object' ? MASK : maskSecretsObj(x, depth + 1);
    return out;
  }
  return v;
}

const maskSecrets = v => (v != null && typeof v === 'object') ? maskSecretsObj(v) : maskSecretsText(v);

/* ---- customer data, for bodies the console reads raw from nexus and shows MASKED (alpha.159: the journey view, the
 * 5G lane). The dealer-ops ingest rules (national id, name, mobile; the same keys in a query string) plus the names,
 * birth date and e-mail keys nexus journeys carry, and numbers written without quotes. Network ids (ICCID, CPE, ODB,
 * plate) stay — operational, as on the board. Unmask (audited) skips this and keeps maskSecrets. ---- */
const PII_ID = 'certNbr|nationalId|idNumber|custId|customerId|iqamaNumber|borderNumber|passportNumber';
const PII_NAME = 'custName|customerName|name|fullName|firstName|lastName|middleName|englishFirstName|englishSecondName|englishThirdName|englishLastName|arabicFirstName|arabicSecondName|arabicThirdName|arabicLastName|arabicName|englishName|contactName';
const PII_CONTACT = 'msisdn|mobilePhone|mobileNumber|mobile|phoneNumber|phone|contactNumber|alternativeNumber|email|emailAddress';
const PII_DOB = 'dateOfBirth|birthDate|dob|hijriDateOfBirth|gregorianDateOfBirth';
const PII_KEYS = [PII_ID, PII_NAME, PII_CONTACT, PII_DOB].join('|');
const RX_PII_STR = new RegExp(`("(?:${PII_KEYS})"\\s*:\\s*")(?:[^"\\\\]|\\\\.)*(")`, 'gi');
const RX_PII_NUM = new RegExp(`("(?:${PII_KEYS})"\\s*:\\s*)-?\\d[\\d.]*`, 'gi');
const RX_PII_QS = /((?:certNbr|nationalId|nid|idNumber|msisdn|mobile|phone)=)[^&"\s]+/gi;
function maskPiiText(s) {
  if (s == null) return s;
  return String(s).replace(RX_PII_STR, `$1${MASK}$2`).replace(RX_PII_NUM, `$1"${MASK}"`).replace(RX_PII_QS, `$1${MASK}`);
}
/* a body for the masked views: any value → JSON text, customer data + SIM secrets masked, cut at `max` characters */
function maskBodyText(v, max = 4000) {
  if (v == null) return null;
  let t; try { t = typeof v === 'string' ? v : JSON.stringify(v); } catch (_) { return null; }
  if (t == null) return null;
  t = maskSecretsText(maskPiiText(t));
  return t.length > max ? t.slice(0, max) + '…(truncated)' : t;
}

module.exports = { maskSecrets, maskSecretsText, maskSecretsObj, maskPiiText, maskBodyText, MASK, KEYS };
