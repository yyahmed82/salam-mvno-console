/* ServiceNow correlation — READ-ONLY. Links a console alert to the ServiceNow (ServiceHub)
 * incidents it likely caused, so an operator sees "this Semati P1 → N related tickets"
 * without leaving the console. We never create or modify anything in ServiceNow.
 *
 * Credentials come from ENV (a read-only service account; never stored in DB/UI):
 *   SN_URL   e.g. https://servicehub.salam.sa
 *   SN_USER  read-only service account
 *   SN_PASS  its password  (basic auth over HTTPS)
 *   SN_GROUP optional assignment-group display name to scope to (default below)
 * The console must be able to reach SN over VPN (same as the prod-DB sync).
 *
 * Correlation is heuristic: recent active incidents in the window are keyword-matched to the
 * alert's journey. The keyword map is intentionally editable — tune it against live tickets. */

const snConfigured = () => !!(process.env.SN_URL && process.env.SN_USER && process.env.SN_PASS);
const SN_GROUP = process.env.SN_GROUP || 'MVNO-MS-App-Digital-Chnls';
const LOOKBACK_H = Number(process.env.SN_LOOKBACK_HOURS || 6);   // how far before the alert to look
const MAX_FETCH = Number(process.env.SN_MAX_FETCH || 200);

// journey → keywords found in short_description / description. Provisioning journeys deliberately
// include the customer-facing symptoms (refund / "not activated") since those are the downstream tickets.
const JOURNEY_KEYWORDS = {
  semati:      ['semati', 'msisdn', 'provision', '704', '726', 'sim activation', 'activation', 'order not found', 'refund'],
  activation:  ['activation', 'activate', 'sim activation', 'provision', 'bss', 'order not found', 'refund'],
  payment:     ['payment', 'not reflected', 'refund', 'wallet', 'charge', 'paid', 'recharge', 'zatca', 'invoice'],
  nafath:      ['nafath', 'absher', 'identity', 'kyc'],
  eligibility: ['eligibility', 'citc', 'denied', 'not eligible'],
  delivery:    ['delivery', 'courier', 'shipment', 'tracking', 'return'],
  change_plan: ['plan change', 'migration', 'prepaid', 'postpaid', 'change plan'],
  onboarding:  ['onboarding', 'order', 'new sim', 'signup', 'sign up'],
  checkout:    ['checkout', 'cart', 'purchase']
};

// derive a journey key from a console alert (works for rule, anomaly and gateway alerts)
function deriveJourney(alert) {
  const dim = alert.dim || {};
  if (dim.journey && JOURNEY_KEYWORDS[dim.journey]) return dim.journey;
  const k = String(alert.metric_key || '');
  if (k.startsWith('semati')) return 'semati';
  if (k.startsWith('activation')) return 'activation';
  if (k.startsWith('payment') || k.startsWith('zatca')) return 'payment';
  if (k.startsWith('nafath')) return 'nafath';
  if (k.startsWith('eligibility')) return 'eligibility';
  if (k.startsWith('delivery')) return 'delivery';
  if (k.startsWith('change_plan')) return 'change_plan';
  if (k.startsWith('onboarding')) return 'onboarding';
  if (k.startsWith('checkout')) return 'checkout';
  const n = String(alert.name || '').toLowerCase();
  for (const j of Object.keys(JOURNEY_KEYWORDS)) if (n.includes(j)) return j;
  return null;
}

function authHeader() {
  return 'Basic ' + Buffer.from(`${process.env.SN_USER}:${process.env.SN_PASS}`).toString('base64');
}
function deepLink(sysId) {
  const base = (process.env.SN_URL || '').replace(/\/+$/, '');
  return sysId ? `${base}/nav_to.do?uri=incident.do?sys_id=${sysId}` : base;
}

// Low-level: GET recent active incidents (bounded), basic auth, hard timeout. Read-only.
async function fetchRecentIncidents(sinceIso) {
  if (typeof fetch !== 'function') throw new Error('global fetch unavailable (needs Node 18+)');
  const base = process.env.SN_URL.replace(/\/+$/, '');
  const fields = 'number,sys_id,short_description,priority,state,opened_at,sys_updated_on,assignment_group,category,subcategory,caller_id';
  // active incidents opened at/after the window; scoped to the group when SN_GROUP is set
  let q = `opened_at>=${sinceIso.slice(0, 19).replace('T', ' ')}^active=true^ORDERBYDESCopened_at`;
  if (SN_GROUP) q += `^assignment_group.name=${SN_GROUP}`;
  const url = `${base}/api/now/table/incident?sysparm_query=${encodeURIComponent(q)}&sysparm_display_value=true&sysparm_limit=${MAX_FETCH}&sysparm_fields=${fields}`;
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', Authorization: authHeader() }, signal: ac.signal });
    if (!r.ok) throw new Error(`ServiceNow HTTP ${r.status}`);
    const j = await r.json();
    return (j.result || []).map(x => ({
      number: x.number, sys_id: x.sys_id, short_description: x.short_description,
      priority: x.priority, state: x.state, opened_at: x.opened_at,
      category: x.category, subcategory: x.subcategory,
      caller: x.caller_id && x.caller_id.display_value ? x.caller_id.display_value : x.caller_id,
      link: deepLink(x.sys_id)
    }));
  } finally { clearTimeout(to); }
}

/* Related tickets for one console alert: recent active incidents keyword-matched to the alert's
 * journey, opened within [fired_at - LOOKBACK_H, now]. Returns { configured, journey, window, tickets }. */
async function relatedTickets(alert) {
  if (!snConfigured()) return { configured: false, tickets: [] };
  const journey = deriveJourney(alert);
  const kws = (JOURNEY_KEYWORDS[journey] || []).map(s => s.toLowerCase());
  const firedMs = alert.fired_at ? Date.parse(alert.fired_at) : Date.now();
  const sinceIso = new Date(firedMs - LOOKBACK_H * 3600e3).toISOString();
  let rows;
  try { rows = await fetchRecentIncidents(sinceIso); }
  catch (e) { return { configured: true, error: e.message, journey, tickets: [] }; }
  const scored = rows.map(r => {
    const hay = `${r.short_description || ''} ${r.category || ''} ${r.subcategory || ''}`.toLowerCase();
    const hits = kws.filter(k => hay.includes(k));
    return { ...r, _score: hits.length, _hits: hits };
  }).filter(r => r._score > 0)
    .sort((a, b) => b._score - a._score || Date.parse(b.opened_at || 0) - Date.parse(a.opened_at || 0));
  return { configured: true, journey, window: { from: sinceIso, lookbackHours: LOOKBACK_H }, count: scored.length, tickets: scored };
}

// connectivity/auth check for the settings page
async function ping() {
  if (!snConfigured()) return { configured: false };
  try { const rows = await fetchRecentIncidents(new Date(Date.now() - 3600e3).toISOString()); return { configured: true, ok: true, sample: rows.length }; }
  catch (e) { return { configured: true, ok: false, error: e.message }; }
}

module.exports = { snConfigured, relatedTickets, ping, deriveJourney, deepLink, JOURNEY_KEYWORDS, SN_GROUP };
