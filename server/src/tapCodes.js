/* TAP / UPG RESPONSE CODES — the official tables from developers.tap.company, embedded so the
 * console can name and classify any gateway answer without a network call (152 has no internet).
 * Source: https://developers.tap.company/reference/charge-response-codes  (imported 21 Aug 2026)
 *
 * WHY THIS MATTERS: our payments carry the message but not always the code, and the reverse is
 * also true (gateway_payload sometimes has a bare code). Having both directions lets the console
 * say "505 · Declined, Insufficient Funds · business" consistently everywhere.
 *
 * CLASS RULE (same vocabulary as errclass / the payment reports):
 *   success        000 Captured · 001 Authorized · 000 Refunded
 *   customer       100 Initiated · 301 Abandoned · 302 Canceled · 304 Expired  (never engaged)
 *   business       4xx card problems · 5xx declines · 7xx restrictions  (the customer or their
 *                  bank said no — actionable by the customer, not by us)
 *   technical      401 Failed · 408 Unspecified · 513 Card Acquirer Error · 801 Timed Out ·
 *                  2101/9999 server errors  (platform faults — ours or the gateway's)
 *   config         402 Invalid Parameter · 403 Duplicate · 506 Transaction Type Not Supported ·
 *                  11xx bad-request codes  (WE sent something wrong / a MID switch is off —
 *                  business-facing but fixable by engineering, so it is called out separately)
 */
'use strict';

const CHARGE = {
  '000': 'Captured', '100': 'Initiated', '301': 'Abandoned', '302': 'Canceled', '303': 'Deferred',
  '304': 'Expired', '401': 'Failed', '402': 'Failed, Invalid Parameter', '403': 'Failed, Duplicate',
  '404': 'Failed, Locked', '405': 'Failed, Invalid Card No', '406': 'Failed, Invalid Expiry',
  '407': 'Failed, Expired Card', '408': 'Failed, Unspecified Failure', '501': 'Declined',
  '502': 'Declined, Incorrect CSC/CVV', '503': 'Declined, 3D Security - Incorrect',
  '504': 'Declined, 3D Security - Card not Enrolled', '505': 'Declined, Insufficient Funds',
  '506': 'Declined, Transaction Type Not Supported', '507': 'Declined, Card Issuer',
  '508': 'Declined, Card Issuer - No Reply', '509': 'Declined, Card Issuer - Do not Contact',
  '510': 'Declined, Card Issuer - Referral Response', '511': 'Declined, Card Issuer - Error',
  '512': 'Declined, Not Authenticated', '513': 'Declined, Card Acquirer - Error',
  '514': 'Declined, Card Issuer - Risk Check', '515': 'Declined, Tap',
  '516': 'Declined, Authentication Failed', '601': 'Void', '701': 'Restricted',
  '702': 'Restricted, Retry Limit Exceeded', '703': 'Restricted, Bank', '704': 'Restricted, Tap',
  '801': 'Timed Out', '901': 'Unknown', '001': 'Authorized',
};
const REFUND = {
  '000': 'Refunded', '100': 'Pending', '200': 'In Progress', '301': 'Canceled', '401': 'Failed',
  '402': 'Failed, Invalid Parameter', '403': 'Failed, Duplicate', '501': 'Declined',
  '502': 'Declined, Insufficient Balance', '503': 'Declined, Refund not Supported',
  '504': 'Declined, Partial Refund not Supported', '601': 'Restricted', '602': 'Restricted, Bank',
  '701': 'Timed Out', '801': 'Unknown',
};
const HTTP = {
  '200': 'OK — everything worked as expected', '400': 'Bad Request — often a missing parameter',
  '401': 'Unauthorized — no valid API key was provided', '402': 'Request Failed — parameters valid but the request failed',
  '403': 'Forbidden — access is denied', '404': 'Not Found — the resource does not exist',
  '409': 'Conflict — the request conflicts with another request',
  '429': 'Too Many Requests — back off exponentially',
  '500': "Server Error — something went wrong on Tap's end", '502': "Server Error — Tap's end",
  '503': "Server Error — Tap's end", '504': "Server Error — Tap's end",
};
// "Bad request" errors — WE sent something the gateway rejected (or a feature is not enabled)
const BAD_REQUEST = {
  '1100': 'Header values are missing', '1101': 'Secret API key and environment are mismatched',
  '1102': 'Request values are empty', '1103': 'Required inputs are invalid',
  '1104': 'Customer id is missing', '1105': 'Customer id is invalid', '1106': 'Customer not found',
  '1107': 'Customer id does not match the existing customer', '1108': 'Save-card feature is not enabled',
  '1109': 'Non-3DS transactions are not allowed', '1110': 'Redirect URL is missing',
  '1111': 'Redirect URL is invalid', '1112': 'Authorize id is missing', '1113': 'Authorize id is invalid',
  '1114': 'Check the authorize status', '1115': 'Authorize not found',
  '1116': 'Save card not supported for this transaction', '1117': 'Amount is invalid',
  '1118': 'Currency code is invalid', '1119': 'Currency code not supported',
  '1120': 'Statement descriptor invalid or longer than 60 characters',
  '1121': 'Description longer than 1000 characters', '1122': 'Merchant order reference too long (>100)',
  '1123': 'Merchant transaction reference too long (>100)', '1124': 'Source id is missing',
  '1125': 'Source id is invalid', '1126': 'Source already used — create a new source',
  '1127': 'Metadata key too long (>250)', '1128': 'Metadata value too long (>1000)',
  '1129': 'Customer id or customer information is required', '1130': "Customer's first name is required",
  '1131': "Customer's first name too long (>150)", '1132': 'Customer last name is required',
  '1133': 'Customer last name too long (>150)', '1134': 'Customer middle name too long (>150)',
  '1135': 'Phone number is required', '1136': 'Phone country code is invalid', '1137': 'Phone number is invalid',
  '1138': 'Email address is invalid', '1139': 'Customer phone number or email address is required',
  '1140': 'Card number is invalid', '1141': 'Card expiry is invalid', '1142': 'Charge id is missing',
  '1143': 'Charge id is invalid', '1144': 'Charge id not found', '1145': 'Authenticate type is missing',
  '1146': 'Authenticate type is invalid', '1147': 'Confirmation code is missing',
  '1148': 'Confirmation code is invalid', '1149': 'Currency code does not match the existing one',
  '1150': 'Capture amount exceeds the outstanding authorized amount', '1151': 'Gateway timed out',
  '1152': 'Invalid authorize auto-schedule type', '1153': 'Invalid authorize auto-schedule time',
  '1154': 'BIN is missing', '1155': 'BIN is invalid', '1156': 'Refund reason is missing',
  '1157': 'Refund reason too long (>250)', '1158': 'Refund id is missing', '1159': 'Refund id is invalid',
  '1160': 'Refund not found', '1161': 'Requested refund amount exceeds', '1162': 'Row count must be ≤ 50',
  '1163': 'Card not supported — try another card', '1164': 'Merchant id is invalid',
  '1165': 'Transfer id is missing', '1166': 'Transfer id is invalid', '1167': 'Transfer not found',
  '1168': 'Requested transfer amount exceeds the charge amount',
  '1169': 'Destination and application cannot be used in the same charge request',
  '1170': 'Transfer currency code is invalid', '1171': 'Destination id cannot be duplicated',
  '1172': 'Destination id invalid', '2100': 'Invalid JSON request',
  '2101': 'The server is currently unavailable (overloaded or down)', '2102': 'Request not found',
  '2103': 'Application required', '2104': 'Invalid API key', '2105': 'API credentials are required',
  '2106': 'Public key given — use the secret key', '2107': 'Authorization required',
  '2108': 'A permission grant is likely required',
  '4100': 'Card validation failed — card name can only have 10 integer values',
  '4101': 'Card validation failed — card has expired', '4102': 'Card validation failed — CVC length',
  '9998': 'Required inputs are invalid — check the currency or amount', '9999': 'Internal server error',
};

const TECHNICAL = new Set(['401', '408', '513', '801', '2101', '9999', '1151', '2100']);
const CUSTOMER = new Set(['100', '301', '302', '304', '303']);
const SUCCESS = new Set(['000', '001']);
const CONFIG = new Set(['402', '403', '506', '1108', '1109', '1101', '1104', '1105', '1106',
  '1117', '1118', '1119', '1124', '1125', '1126', '1129', '1163', '2104', '2105', '2106']);

/** classOf('505') → 'business' · classOf('801') → 'technical' */
function classOf(code) {
  const c = String(code == null ? '' : code).trim();
  if (!c) return null;
  if (SUCCESS.has(c)) return 'success';
  if (TECHNICAL.has(c)) return 'technical';
  if (CUSTOMER.has(c)) return 'customer';
  if (CONFIG.has(c)) return 'config';
  if (/^(4|5|7)\d\d$/.test(c)) return 'business';      // card problems, declines, restrictions
  if (/^1[12]\d\d$/.test(c)) return 'config';           // bad-request family
  return null;
}
/** describe('505') → { code, message, cls, table } — null when the code is not one of Tap's */
function describe(code) {
  const c = String(code == null ? '' : code).trim();
  if (!c) return null;
  const message = CHARGE[c] || BAD_REQUEST[c] || REFUND[c] || null;
  if (!message) return null;
  return { code: c, message, cls: classOf(c),
    table: CHARGE[c] ? 'charge' : (BAD_REQUEST[c] ? 'bad_request' : 'refund') };
}
/** codeFor('Declined, Insufficient Funds') → '505' (exact, case/spacing tolerant) */
const _byMsg = {};
for (const [k, v] of Object.entries(CHARGE)) _byMsg[v.toLowerCase().replace(/\s+/g, ' ')] = k;
function codeFor(message) {
  const m = String(message || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return _byMsg[m] || null;
}
const tables = () => ({ charge: CHARGE, refund: REFUND, http: HTTP, bad_request: BAD_REQUEST });

module.exports = { CHARGE, REFUND, HTTP, BAD_REQUEST, classOf, describe, codeFor, tables,
  source: 'https://developers.tap.company/reference/charge-response-codes' };
