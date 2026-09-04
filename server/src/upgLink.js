/* UPG gateway correlation — the second half of a payment.
 *
 * The app knows what it ASKED the gateway to do; UPG knows what actually happened. This module
 * joins the two so a single lookup returns the whole story: app payment → gateway invoice →
 * every charge attempt on that invoice → each charge's state transitions → webhook delivery back.
 *
 * Join key: the app's payment_reference_id / invoice id is UPG's invoices.id (verified on
 * dlyehrypuv9g, 2026-08-16). We also accept a UPG payment id (pay_…) or a phone number.
 *
 * READ-ONLY, and defensive by design: UPG is a live production gateway. Small pool, short
 * statement timeout, every query LIMITed, and every failure degrades to a null result rather
 * than propagating — a gateway hiccup must never break the console.
 *
 * Key semantics learned from the April-2026 analysis (see UPG-Gateway-Health report):
 *   • a charge with exactly 2 activities INITIATED→FAILED and bank_message 'Abandoned' was
 *     NEVER engaged with — created when the page opened, auto-expired ~31 min later.
 *   • an invoice often carries several charges; only the final outcome is revenue.
 */
const db = require('./db');

const configured = () => !!db.upg;
const q = async (sql, params = []) => {
  if (!db.upg) return null;
  try { return await db.upg.query(sql, params); }
  catch (e) { const err = new Error(String(e.message || e).slice(0, 200)); err.upg = true; throw err; }
};

/* ---- index awareness ----------------------------------------------------------------------
 * UPG is a live production gateway and its tables are large; payment_activities ships with ONLY
 * a primary key. Any query without a supporting index would seq-scan gigabytes per click. Rule:
 * introspect pg_indexes (cached 10 min) and SKIP any lookup whose index is missing — report
 * "needs index" instead of running it. The console must never be the cause of gateway load. */
let _idx = null, _idxAt = 0;
async function indexes() {
  if (_idx && Date.now() - _idxAt < 600000) return _idx;
  const f = { pay_created: false, pay_invoice: false, act_payment: false, inv_reference: false, whr_payment: false,
              wh_invoice: false, wh_payment: false };
  try {
    const r = await q(`SELECT tablename, indexdef FROM pg_indexes
                       WHERE tablename IN ('payments','payment_activities','invoices','webhook_requests','webhooks')`);
    for (const { tablename: t, indexdef: d } of (r && r.rows) || []) {
      const firstCol = (d.match(/\(([^,)]+)/) || [])[1] || '';
      if (t === 'payments' && /created_at/.test(firstCol)) f.pay_created = true;
      if (t === 'payments' && /invoice_id/.test(firstCol)) f.pay_invoice = true;
      if (t === 'payment_activities' && /payment_id/.test(firstCol)) f.act_payment = true;
      if (t === 'invoices' && /reference_id/.test(firstCol)) f.inv_reference = true;
      if (t === 'webhook_requests' && /payment_id/.test(firstCol)) f.whr_payment = true;
      if (t === 'webhooks' && /invoice_id/.test(firstCol)) f.wh_invoice = true;
      if (t === 'webhooks' && /payment_id/.test(firstCol)) f.wh_payment = true;
    }
    _idx = f; _idxAt = Date.now();
  } catch (e) { _idx = f; _idxAt = Date.now(); }
  return _idx;
}

/* ---- health ------------------------------------------------------------------------------ */
let _pingCache = null, _pingAt = 0;
async function ping() {
  if (!configured()) return { ok: false, configured: false };
  if (_pingCache && Date.now() - _pingAt < 300000) return _pingCache;   // 5-min cache — the health
  const t0 = Date.now();                                                // strip must not hammer UPG
  try {
    await q('SELECT 1');                                    // connectivity check: always cheap
    const ix = await indexes();
    let stats = {};
    if (ix.pay_created) {                                    // volume stats ONLY via index scan
      const r = await q(`SELECT count(*)::bigint n, max(created_at) newest FROM payments
                         WHERE created_at > now() - interval '24 hours'`);
      stats = { payments_24h: Number(r.rows[0].n),
        newest: r.rows[0].newest ? new Date(r.rows[0].newest).toISOString() : null };
    } else stats = { note: 'connected · stats skipped (no payments(created_at) index)' };
    _pingCache = { ok: true, configured: true, ms: Date.now() - t0, ...stats }; _pingAt = Date.now();
    return _pingCache;
  } catch (e) { return { ok: false, configured: true, ms: Date.now() - t0, error: e.message }; }
}

/* Batch reason lookup — the app stores NO decline text for salam-vendor payments (proven
 * 20 Aug: 20,525 August failures with empty fail_reason and empty gateway response), so the
 * ONLY source of truth for "why did it decline" is UPG itself. Give it app reference ids
 * (= UPG invoices.id / payments.invoice_id) and get back the bank_message histogram plus a
 * per-ref map. Index-gated + chunked + capped: never a scan on the live gateway. */
/* Does this UPG deployment keep the raw charge object? It carries the REAL acquirer answer
 * (gateway.response.code/message) even when bank_message is NULL — e.g. STC Pay rows that read
 * blank actually say "2008 · Customer not found". Probed once, then cached. */
let _hasPayload = null;
async function hasPayload() {
  if (_hasPayload !== null) return _hasPayload;
  try {
    const r = await q(`SELECT 1 FROM information_schema.columns
      WHERE table_name='payments' AND column_name='gateway_payload' LIMIT 1`);
    _hasPayload = !!(r && r.rows && r.rows.length);
  } catch (_) { _hasPayload = false; }
  return _hasPayload;
}
// only the two scalar paths are extracted (server-side in UPG) — never the whole document,
// so a 3000-reference lookup stays cheap on the wire.
const GW_COLS = `, gateway_payload#>>'{gateway,response,code}' AS gw_code,
                   gateway_payload#>>'{gateway,response,message}' AS gw_msg,
                   gateway_payload#>>'{source,payment_method}' AS pay_method`;

async function reasonsForRefs(refs, { chunk = 300, max = 25000 } = {}) {
  if (!configured()) return null;
  const ix = await indexes();
  if (!ix.pay_invoice) return { error: 'payments(invoice_id) index missing on UPG — lookup skipped' };
  const list = [...new Set((refs || []).map(r => String(r || '').trim()).filter(r => /^[\w-]{4,64}$/.test(r)))].slice(0, max);
  const gp = await hasPayload();
  const reasons = {}, byRef = {}; let matched = 0;
  for (let i = 0; i < list.length; i += chunk) {
    const part = list.slice(i, i + chunk);
    const r = await q(
      `SELECT invoice_id, status, source, method,
              coalesce(NULLIF(trim(bank_message), ''), '(no message)') msg,
              created_at${gp ? GW_COLS : ''}
       FROM payments WHERE invoice_id = ANY($1::text[])
       ORDER BY created_at`, [part]);
    for (const row of (r && r.rows) || []) {
      matched++;
      // bank_message first; when the acquirer left it blank the raw charge object usually
      // still carries the real answer (code + message) — use it rather than reporting "no message"
      const msg = (row.msg && row.msg !== '(no message)') ? row.msg
        : (row.gw_msg && String(row.gw_msg).trim() ? String(row.gw_msg).trim() : '(no message)');
      const key = `${msg} · ${row.source || '?'}`;
      reasons[key] = (reasons[key] || 0) + 1;
      byRef[row.invoice_id] = { status: row.status, source: row.source, method: row.method, msg,
        code: row.gw_code || null, bank_message: row.msg, pay_method: row.pay_method || null };
    }
  }
  return { requested: list.length, matched, reasons, byRef };
}

/* Full attempt rows for a set of app reference ids — same index-gated, chunked contract as
 * reasonsForRefs, but returns EVERY gateway attempt (a customer may retry many times on one
 * invoice) with the fields an investigator needs. Used by the per-transaction export.
 * NEVER returns card/PAN or token fields: only what the app already knows plus the outcome. */
/* `pause` (ms between chunks) defaults to 0, so every existing caller behaves exactly as before.
 * The 12-month export passes a real value: 1,850 back-to-back chunks against a live gateway is a
 * sustained load, and the console must never be the reason UPG slows down. */
async function rowsForRefs(refs, { chunk = 300, max = 60000, pause = 0 } = {}) {
  if (!configured()) return null;
  const ix = await indexes();
  if (!ix.pay_invoice) return { error: 'payments(invoice_id) index missing on UPG — lookup skipped' };
  const list = [...new Set((refs || []).map(r => String(r || '').trim()).filter(r => /^[\w-]{4,64}$/.test(r)))].slice(0, max);
  const gp = await hasPayload();
  const byRef = new Map();
  for (let i = 0; i < list.length; i += chunk) {
    if (pause && i) await new Promise(r => setTimeout(r, pause));
    const r = await q(
      `SELECT invoice_id, id, status, source, method, amount, transaction_id,
              coalesce(NULLIF(trim(bank_message),''),'') bank_message, created_at${gp ? GW_COLS : ''}
       FROM payments WHERE invoice_id = ANY($1::text[])
       ORDER BY created_at`, [list.slice(i, i + chunk)]);
    for (const row of (r && r.rows) || []) {
      if (!byRef.has(row.invoice_id)) byRef.set(row.invoice_id, []);
      byRef.get(row.invoice_id).push(row);
    }
  }
  return { requested: list.length, byRef };
}

/* FULL charge object for ONE reference — the complete gateway_payload as UPG stored it.
 * Detail view only (a few KB per attempt): never call this from a list or aggregate path. */
async function payloadForRef(ref, { limit = 4 } = {}) {
  if (!configured()) return null;
  const k = String(ref || '').trim();
  if (!/^[\w-]{4,64}$/.test(k)) return { error: 'invalid reference' };
  const ix = await indexes();
  if (!ix.pay_invoice) return { error: 'payments(invoice_id) index missing on UPG — lookup skipped' };
  if (!(await hasPayload())) return { supported: false, note: 'this UPG deployment has no gateway_payload column' };
  const r = await q(
    `SELECT id, status, source, method, amount, transaction_id, created_at,
            coalesce(NULLIF(trim(bank_message),''),'') bank_message,
            gateway_payload
     FROM payments WHERE invoice_id = $1 ORDER BY created_at LIMIT ${limit}`, [k]);
  return { supported: true, rows: (r && r.rows) || [] };
}

/* ---- classification (mirrors the report's definitions) ------------------------------------ */
const TECHNICAL = /timed\s*out|unspecified failure|card issuer - error|gateway/i;
function classify(p) {
  const s = String(p.status || '').toUpperCase();
  const m = String(p.bank_message || '');
  if (s === 'PAID' || s === 'CAPTURED' || s === 'AUTHORIZED') return { cls: 'success', label: 'Paid' };
  if (s === 'REFUNDED') return { cls: 'refunded', label: 'Refunded' };
  if (s === 'INITIATED') return { cls: 'open', label: 'In flight' };
  if (/abandon/i.test(m)) return { cls: 'abandoned', label: 'Abandoned — never engaged' };
  if (TECHNICAL.test(m)) return { cls: 'technical', label: 'Technical (gateway)' };
  if (!m) return { cls: 'pre_bank', label: 'No bank response' };
  return { cls: 'declined', label: 'Declined (business)' };
}
// an untouched charge = exactly INITIATED then FAILED, nothing else
const neverEngaged = acts =>
  acts.length === 2 && /INITIATED/i.test(acts[0].status) && /FAILED/i.test(acts[1].status);

/* ---- payload sanitizer --------------------------------------------------------------------
 * gateway_payload / webhook payloads can carry PII (name, email, phone) and PCI-adjacent data.
 * Whitelist keys that describe the TRANSACTION, drop everything else, and mask any value that
 * still looks like a PAN / phone / email. Depth-limited so a hostile blob can't recurse. */
const SAFE_KEY = /^(id|status|state|code|message|description|response(_?(code|message|summary))?|acquirer[a-z_]*|auth(orization)?_?(code|id)?|reference|transaction[a-z_]*|charge_id|invoice_id|currency|amount|amount_.*|type|method|source_type|brand|scheme|threed[s_]?.*|3ds.*|eci|avs.*|cvv_?result|risk.*|gateway.*|bank_?(message|code)?|created|captured|failure_.*|error.*|expir(es|y)_at|card|post|source|object|payment|result|outcome|url|event|first_six|last_four|issuer|country|funding|live_?mode|fee|refunded|captured_at|payout)$/i;
const MASK_VAL = v => (/^https?:\/\//i.test(String(v)) ? String(v).split('?')[0] : String(v))
  .replace(/\b\d{12,19}\b/g, m => m.slice(0, 4) + '••••' + m.slice(-2))       // PAN-like
  .replace(/\b(?:\+?966|05)\d{8}\b/g, m => m.slice(0, 4) + '•••••' + m.slice(-2)) // KSA msisdn
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '•@•');                                // email
function sanitize(o, depth = 0) {
  if (o == null || depth > 4) return undefined;
  if (Array.isArray(o)) { const a = o.slice(0, 8).map(x => sanitize(x, depth + 1)).filter(x => x !== undefined); return a.length ? a : undefined; }
  if (typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (!SAFE_KEY.test(k)) continue;
      const sv = sanitize(v, depth + 1);
      if (sv !== undefined) out[k] = sv;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return typeof o === 'string' ? MASK_VAL(o).slice(0, 160) : o;
}

/* webhook_requests / webhooks schemas differ between UPG versions — SELECT * with a tight LIMIT,
 * then keep only known-safe fields in JS. Never let a webhook query kill the trace. */
const WH_FIELDS = ['id','webhook_type','webhook_status','event','event_type','type','status','state','http_status','response_code','response_status','attempts','attempt','retries','url','endpoint','invoice_id','payment_id','notified_at','created_at','updated_at','delivered_at'];
const pickWh = r => { const o = {}; for (const f of WH_FIELDS) if (r[f] !== undefined && r[f] !== null) o[f] = f === 'url' || f === 'endpoint' ? String(r[f]).split('?')[0] : r[f]; return o; };
async function fetchWebhooks(invId, payIds, ix) {
  // Primary: the webhooks table itself — it carries invoice_id AND payment_id as columns
  // (verified in pgAdmin, 17 Aug 2026), so the join is exact. Index-gated as always.
  const cols = 'id, webhook_type, webhook_status, retries, invoice_id, payment_id, notified_at, created_at, updated_at';
  try {
    if (ix.wh_invoice) {
      const r = await q(`SELECT ${cols} FROM webhooks WHERE invoice_id = $1 ORDER BY created_at LIMIT 20`, [invId]);
      if (r && r.rowCount) return r.rows.map(pickWh);
    }
    if (ix.wh_payment && payIds.length) {
      const r = await q(`SELECT ${cols} FROM webhooks WHERE payment_id = ANY($1::text[]) ORDER BY created_at LIMIT 20`, [payIds]);
      if (r && r.rowCount) return r.rows.map(pickWh);
    }
  } catch (e) { /* column drift — fall through */ }
  // Secondary: per-delivery request log, if its index exists
  if (payIds.length && ix.whr_payment) {
    try {
      const r = await q(`SELECT * FROM webhook_requests WHERE payment_id = ANY($1::text[]) ORDER BY created_at LIMIT 20`, [payIds]);
      if (r && r.rowCount) return r.rows.map(pickWh);
    } catch (e) { /* non-fatal */ }
  }
  return [];
}

/* ---- main lookup -------------------------------------------------------------------------- */
/* key: invoice id (app payment_reference_id), UPG payment id (pay_…), or a phone number */
async function trace(key) {
  if (!configured()) return { configured: false };
  const k = String(key || '').trim();
  if (!k) return { configured: true, found: false, error: 'no key' };
  const ix = await indexes();

  // 1) resolve the invoice — direct id, or via a payment id
  let inv = null;
  const byInv = await q(
    `SELECT id, status, amount, description, reference_id, channel, created_at, updated_at, expires_at
       FROM invoices WHERE id = $1 LIMIT 1`, [k]);
  if (byInv && byInv.rowCount) inv = byInv.rows[0];
  if (!inv && /^pay_/i.test(k)) {
    const r = await q(
      `SELECT i.id, i.status, i.amount, i.description, i.reference_id, i.channel, i.created_at, i.updated_at, i.expires_at
         FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = $1 LIMIT 1`, [k]);
    if (r && r.rowCount) inv = r.rows[0];
  }
  if (!inv && ix.inv_reference) {   // index-gated: without invoices(reference_id) this would seq-scan
    const r = await q(
      `SELECT id, status, amount, description, reference_id, channel, created_at, updated_at, expires_at
         FROM invoices WHERE reference_id = $1 ORDER BY created_at DESC LIMIT 1`, [k]);
    if (r && r.rowCount) inv = r.rows[0];
  }
  if (!inv) return { configured: true, found: false, key: k,
    note: 'No UPG invoice matches this reference. It may predate the gateway, or belong to another payment provider.' };

  // 2) every charge attempt on that invoice (index-gated)
  const pr = !ix.pay_invoice ? null : await q(
    `SELECT id, status, bank_message, amount, method, source, channel, transaction_id,
            gateway_payload, created_at, updated_at
       FROM payments WHERE invoice_id = $1 ORDER BY created_at LIMIT 25`, [inv.id]);
  const pays = (pr && pr.rows) || [];

  // 3) state transitions for those charges (one round-trip)
  const ids = pays.map(p => p.id);
  let acts = [];
  if (ids.length && ix.act_payment) {   // index-gated: activities is huge and ships with only a PK
    const ar = await q(
      `SELECT payment_id, status, created_at FROM payment_activities
        WHERE payment_id = ANY($1::text[]) ORDER BY payment_id, created_at LIMIT 300`, [ids]);
    acts = (ar && ar.rows) || [];
  }
  const byPay = {};
  for (const a of acts) (byPay[a.payment_id] = byPay[a.payment_id] || []).push(a);

  // 4) webhook delivery back to the app (schema-tolerant; index-gated)
  const hooks = await fetchWebhooks(inv.id, ids, ix);

  const charges = pays.map(p => {
    const a = byPay[p.id] || [];
    const c = classify(p);
    const first = a[0], last = a[a.length - 1];
    return {
      id: p.id, status: p.status, bank_message: p.bank_message || null,
      amount: p.amount, method: p.method, source: p.source, channel: p.channel,
      transaction_id: p.transaction_id, created_at: p.created_at, finalized_at: p.updated_at,
      gateway: sanitize(p.gateway_payload) || null,
      class: c.cls, label: c.label,
      activities: a.map(x => ({ status: x.status, at: x.created_at })),
      never_engaged: neverEngaged(a),
      secs_to_final: (first && last) ? Math.round((new Date(last.at || last.created_at) - new Date(first.created_at)) / 1000) : null
    };
  });

  const missing = [];
  if (!ix.pay_invoice) missing.push('payments(invoice_id) — charge list');
  if (!ix.act_payment) missing.push('payment_activities(payment_id, created_at) — state timeline');
  if (!ix.wh_invoice && !ix.wh_payment && !ix.whr_payment)
    missing.push('webhooks(invoice_id) — webhook deliveries');
  const paid = charges.find(c => c.class === 'success') || null;
  return {
    configured: true, found: true, key: k, missing_indexes: missing,
    invoice: { id: inv.id, status: inv.status, amount: inv.amount, description: inv.description,
      reference_id: inv.reference_id, channel: inv.channel, created_at: inv.created_at, expires_at: inv.expires_at },
    charges, webhooks: hooks,
    summary: {
      attempts: charges.length,
      outcome: paid ? 'PAID' : (inv.status || 'not paid'),
      paid_charge: paid ? paid.id : null,
      abandoned: charges.filter(c => c.class === 'abandoned').length,
      untouched: charges.filter(c => c.never_engaged).length,
      technical: charges.filter(c => c.class === 'technical').length,
      // the headline for L2: attempts ≠ outcome
      verdict: paid
        ? (charges.length > 1
            ? `Invoice PAID — ${charges.length} charge attempts, ${charges.filter(c => c.class !== 'success').length} discarded sibling(s). Gateway reports would count those as failures.`
            : 'Invoice PAID on the first attempt.')
        : (charges.length === 0
            ? 'No charge object exists for this invoice — the customer never opened the payment page (or the flow uses a different provider path).'
            : charges.every(c => c.never_engaged)
            ? 'Not paid — every charge was created and expired untouched (customer never engaged with the payment page).'
            : 'Not paid — see the per-charge outcome below.')
    }
  };
}

module.exports = { configured, ping, trace, classify, neverEngaged, indexes, sanitize, reasonsForRefs, rowsForRefs, payloadForRef, hasPayload };
