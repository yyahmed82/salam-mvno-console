/* Tap reconciliation — READ-ONLY, authoritative detector for the two UPG/Tap payment issues.
 * We never create/modify/refund anything in Tap; we only READ charge status to compare with the app.
 *
 *   Issue 2 (mismatch): app payment stuck 'initiated'/'pending' but Tap says CAPTURED → money taken,
 *                       app never confirmed. Detected by retrieving each candidate charge from Tap.
 *   Issue 1 (duplicate): one order id with >1 CAPTURED charge in Tap → customer debited twice.
 *                        Needs Tap's list-by-reference (flagged VERIFY — confirm against your account).
 *
 * Credentials come from ENV (secret — never store the key in DB/UI):
 *   TAP_SECRET_KEY   sk_live_...  (read-only reconciliation; use a restricted key if Tap supports it)
 *   TAP_API_URL      default https://api.tap.company/v2
 *   TAP_LIST_QUERY   optional — list-by-reference query, {ref} placeholder (default reference.order={ref})
 * The console must have internet egress to api.tap.company.
 *
 * Tap charge.status values (v2): INITIATED, IN_PROGRESS, ABANDONED, CANCELLED, FAILED, DECLINED,
 * RESTRICTED, CAPTURED, VOID, TIMEDOUT, UNKNOWN.  "Money taken" = CAPTURED (AUTHORIZED = held).
 */
const db = require('./db');

const TAP_URL = (process.env.TAP_API_URL || 'https://api.tap.company/v2').replace(/\/+$/, '');
const tapConfigured = () => !!process.env.TAP_SECRET_KEY;
const CAPTURED = new Set(['CAPTURED']);                 // money actually taken
const APP_TERMINAL_OK = new Set(['success']);

function authHeaders() { return { Accept: 'application/json', Authorization: `Bearer ${process.env.TAP_SECRET_KEY}` }; }

// Pull the Tap charge id (chg_...) out of a payment's stored gateway responses.
function chargeIdFromPayment(p) {
  const scan = o => {
    if (!o || typeof o !== 'object') return null;
    for (const k of ['id', 'charge_id', 'chargeId']) {
      const v = o[k]; if (typeof v === 'string' && /^chg_/i.test(v)) return v;
    }
    for (const k of ['charge', 'transaction', 'reference', 'data']) { const r = scan(o[k]); if (r) return r; }
    return null;
  };
  return scan(p.payment_commit_response) || scan(p.payment_initialization_response) || null;
}

async function tapGet(path, ms = 8000) {
  if (typeof fetch !== 'function') throw new Error('global fetch unavailable (needs Node 18+)');
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(`${TAP_URL}${path}`, { headers: authHeaders(), signal: ac.signal });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Tap HTTP ${r.status}: ${JSON.stringify(body).slice(0, 160)}`);
    return body;
  } finally { clearTimeout(to); }
}

// List-by-reference path. The exact query param is account-specific — override without a code change
// via TAP_LIST_QUERY, using {ref} as the placeholder (e.g. TAP_LIST_QUERY="reference.transaction={ref}").
function listPath(ref) {
  const tmpl = process.env.TAP_LIST_QUERY || 'reference.order={ref}';
  return `/charges/?${tmpl.replace('{ref}', encodeURIComponent(ref))}`;
}

// bounded-concurrency map so we respect Tap rate limits
async function mapLimit(items, n, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]); } catch (e) { out[idx] = { error: e.message }; } }
  });
  await Promise.all(workers);
  return out;
}

/* Issue 2 — authoritative mismatch check.
 * Candidate app payments = stuck 'pending'/'initiated' (>30 min) in the last `hours`, that carry a Tap
 * charge id. Retrieve each from Tap; if Tap = CAPTURED while the app is not 'success' → confirmed mismatch. */
async function reconcileMismatch({ hours = 24, limit = 100 } = {}) {
  if (!tapConfigured()) return { configured: false, findings: [] };
  const rows = (await db.source.query(
    `SELECT id::text, payment_reference_id AS ref, status, amount, vendor, customer_mobile_number AS mobile,
            payment_on_type, payment_on_id, payment_initialization_response, payment_commit_response, created_at
     FROM payments
     WHERE lower(status) IN ('pending','initiated')
       AND created_at >= now() - ($1||' hours')::interval AND created_at < now() - interval '30 minutes'
     ORDER BY created_at DESC LIMIT $2`, [hours, limit])).rows;
  const candidates = rows.map(p => ({ p, chargeId: chargeIdFromPayment(p) })).filter(x => x.chargeId);
  const checked = await mapLimit(candidates, 3, async ({ p, chargeId }) => {
    const c = await tapGet(`/charges/${encodeURIComponent(chargeId)}`);
    const tapStatus = String(c.status || '').toUpperCase();
    const mismatch = CAPTURED.has(tapStatus) && !APP_TERMINAL_OK.has(String(p.status).toLowerCase());
    return mismatch ? { ref: p.ref, chargeId, appStatus: p.status, tapStatus, amount: p.amount, mobile: p.mobile,
      payment_on: `${p.payment_on_type}:${p.payment_on_id || ''}`, created_at: p.created_at } : null;
  });
  const findings = checked.filter(x => x && !x.error);
  return { configured: true, scanned: candidates.length, noChargeId: rows.length - candidates.length, count: findings.length, findings };
}

/* Issue 1 — duplicate capture. Tap is the source of truth (the app has only one row). This needs Tap's
 * list-by-reference; the exact endpoint/shape varies by account — VERIFY against your Tap dashboard/API.
 * We list charges for each recent order reference and flag any with >1 CAPTURED. */
async function reconcileDuplicate({ hours = 24, limit = 100 } = {}) {
  if (!tapConfigured()) return { configured: false, findings: [] };
  const refs = (await db.source.query(
    `SELECT DISTINCT payment_reference_id AS ref, max(customer_mobile_number) AS mobile, max(amount) AS amount
     FROM payments
     WHERE status = 'success' AND payment_reference_id IS NOT NULL
       AND created_at >= now() - ($1||' hours')::interval AND created_at < now()
     GROUP BY payment_reference_id LIMIT $2`, [hours, limit])).rows;
  const checked = await mapLimit(refs, 3, async (row) => {
    // list charges for the order reference (path configurable via TAP_LIST_QUERY — verify per account)
    const res = await tapGet(listPath(row.ref)).catch(() => null);
    const charges = res && (res.charges || res.data || (Array.isArray(res) ? res : [])) || [];
    const captured = charges.filter(c => CAPTURED.has(String(c.status || '').toUpperCase()));
    return captured.length > 1 ? { ref: row.ref, mobile: row.mobile, amount: row.amount, capturedCount: captured.length,
      chargeIds: captured.map(c => c.id) } : null;
  });
  const findings = checked.filter(x => x && !x.error);
  return { configured: true, scanned: refs.length, count: findings.length, findings, note: 'duplicate list-by-reference endpoint is account-specific — verify against Tap docs/dashboard' };
}

// Retrieve one charge, normalized (never throws — returns {id,error} on failure).
async function retrieveChargeSafe(id) {
  try {
    const c = await tapGet(`/charges/${encodeURIComponent(id)}`);
    return { id: c.id || id, status: String(c.status || '').toUpperCase(), amount: c.amount, currency: c.currency,
      reference: c.reference, created: (c.transaction && c.transaction.created) || c.created || null, raw: c };
  } catch (e) { return { id, error: e.message }; }
}

/* All Tap charges for one duplicate group — used by the timeline drawer to show the app rows and the
 * Tap captures side by side. Combines (a) the charge ids the app stored, and (b) a list-by-order-reference
 * to surface EXTRA captures the app never recorded (the gateway-double-capture case). List endpoint is
 * account-specific — VERIFY against your Tap dashboard/API; failures are ignored so the known-id path still works. */
async function chargesForGroup({ chargeIds = [], references = [] } = {}) {
  if (!tapConfigured()) return { configured: false, charges: [] };
  const byId = new Map();
  await mapLimit([...new Set(chargeIds.filter(Boolean))], 3, async (cid) => { const c = await retrieveChargeSafe(cid); if (c && c.id && !c.error) byId.set(c.id, c); });
  for (const ref of [...new Set(references.filter(Boolean))]) {
    try {
      const res = await tapGet(listPath(ref));
      const list = (res && (res.charges || res.data || (Array.isArray(res) ? res : []))) || [];
      list.forEach(c => { if (c.id && !byId.has(c.id)) byId.set(c.id, { id: c.id, status: String(c.status || '').toUpperCase(), amount: c.amount, currency: c.currency, reference: c.reference, created: (c.transaction && c.transaction.created) || c.created || null, raw: c }); });
    } catch (e) { /* list-by-reference is account-specific — ignore, keep the known-id charges */ }
  }
  return { configured: true, charges: [...byId.values()] };
}

async function ping() {
  if (!tapConfigured()) return { configured: false };
  try { await tapGet('/charges/chg_ping_probe', 5000); return { configured: true, ok: true }; }
  catch (e) { const notFound = /HTTP 404/.test(e.message); return { configured: true, ok: notFound, note: notFound ? 'auth OK (probe id not found, as expected)' : e.message }; }
}

module.exports = { tapConfigured, reconcileMismatch, reconcileDuplicate, chargesForGroup, ping, chargeIdFromPayment };
