/* fixedCustomer.js — the Fixed half of Customer 360.
 * GET /api/fixed/customer?key=…   key = service/account no (FTTH…), customer code, customer id, BSS order no,
 *                                  5G msisdn, ICCID, ODB plate, or a nexus attempt id.
 * Reads: sda_ops.public + sda_ops.beta (order_attempts, error_events, dealers), payments_v2 (when configured).
 * Returns: found, keyKind, customer (masked ids), services[] (one per service_no / order), attempts[] (masked),
 *          errors[], payments[], links (msisdn/cust ids usable to cross-search the MVNO side).
 * PII: identifiers cut to last digits (tail) unless req.caps.unmaskPII && unmask=1 (audited by the caller). */
const db = require('./db');
const f360 = require('./fixed360');
const inventoryMod = require('./fixedInventory');

const tail = (s, k) => s == null || s === '' ? null : '…' + String(s).slice(-k);
const digits = s => String(s || '').replace(/\D/g, '');
function forms(key) {           // msisdn spellings the read model may hold
  const d = digits(key);
  if (/^(?:966|0)?5\d{8}$/.test(d)) { const n = d.slice(-9); return ['0' + n, '966' + n, n, '+966' + n]; }
  return [];
}
function keyKind(key) {
  const k = String(key).trim(), d = digits(k);
  if (/^(?:966|0)?5\d{8}$/.test(d) && !/[a-z]/i.test(k)) return 'msisdn';
  if (/^\d{10}$/.test(d) && /^[12]/.test(d) && d === k) return 'nid';
  if (/^\d{18,22}$/.test(k)) return 'iccid';
  if (/^FTTH|^FTTB|^5G/i.test(k)) return 'service';
  if (/^[A-Z]+[-_]?\d+$/i.test(k) && /odb/i.test(k)) return 'odb';
  return 'any';
}
const ATTEMPT_COLS = `oa.id, oa.workflow::text AS workflow, oa.plan, oa.channel, oa.referral_code, oa.order_number, oa.odb, oa.iccid, oa.cpe,
  oa.msisdn, oa.service_no, oa.cust_code, oa.customer_id, oa.nafath_outcome, oa.dealer_validation, oa.outcome::text AS outcome,
  oa.step_reached, oa.last_error_category, oa.last_error_at, oa.region, oa.started_at, oa.completed_at, oa.duration_s, oa.lat, oa.lng,
  d.staff_code, d.staff_name, d.dealer_code, d.dealer_name`;

/* nexus bridge — the ONLY place a NID / contact mobile can be resolved to Fixed workflows. Reads workflow ids only
 * (the identity never leaves the server); the attempts themselves come from the masked read model. Bounded scan:
 * last 24 months, regex on the context text, 12 s timeout, falls back to "not linked" on any error. */
async function nexusLinkIds(key, ms) {
  if (!db.nexus) return { ids: [], reason: 'nexus not configured' };
  const k = String(key).trim(); const alts = Array.from(new Set([k, ...ms])).filter(Boolean);
  const pat = '"(?:certNbr|nationalId|idNumber|nid|msisdn|mobilePhone|mobileNumber|mobile|phoneNumber|phone)"\\s*:\\s*"(?:' + alts.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')"';
  const c = await db.nexus.connect();
  try {
    await c.query('SET LOCAL statement_timeout = 12000').catch(() => {});
    await c.query('BEGIN READ ONLY'); await c.query('SET LOCAL statement_timeout = 12000');
    const r = await c.query(`SELECT id::text AS id FROM workflow_states
       WHERE updated_at > now() - interval '24 months' AND context::text ~ $1
       ORDER BY updated_at DESC LIMIT 100`, [pat]);
    await c.query('ROLLBACK');
    return { ids: r.rows.map(x => x.id), reason: null };
  } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} return { ids: [], reason: e.message }; }
  finally { c.release(); }
}
async function attemptsByIds(pool, ids, source) {
  if (!ids.length) return [];
  const r = await pool.query(`SELECT ${ATTEMPT_COLS}, '${source}' AS source
      FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id
     WHERE oa.id = ANY($1::text[]) ORDER BY oa.started_at DESC LIMIT 200`, [ids]);
  return r.rows;
}
async function findAttempts(pool, key, ms, source) {
  const P = [key, ms.length ? ms : [key]];
  const r = await pool.query(`SELECT ${ATTEMPT_COLS}, '${source}' AS source
      FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id
     WHERE oa.service_no = $1 OR oa.cust_code = $1 OR oa.customer_id = $1 OR oa.order_number = $1 OR oa.id = $1
        OR oa.iccid ILIKE '%' || $1 || '%' OR oa.odb = $1 OR oa.msisdn = ANY($2::text[])
     ORDER BY oa.started_at DESC LIMIT 200`, P);
  return r.rows;
}
async function findErrors(pool, attemptIds, orderNos) {
  if (!attemptIds.length && !orderNos.length) return [];
  const r = await pool.query(`SELECT id, attempt_id, order_number, acct_masked, category, code, message, channel, dealer_code,
        referral_code, region, step, occurred_at, resolved, signature
      FROM error_events WHERE attempt_id = ANY($1::text[]) OR (order_number IS NOT NULL AND order_number = ANY($2::text[]))
      ORDER BY occurred_at DESC LIMIT 100`, [attemptIds, orderNos]);
  return r.rows;
}
async function findPayments(keys) {
  if (!db.payments || !keys.length) return { configured: !!db.payments, rows: [] };
  try {
    const r = await db.payments.query(`SELECT p.id, p.status::text AS status, p.source::text AS source, p.method::text AS method,
          p.channel::text AS channel, (p.amount::numeric/100)::float8 AS amount_sar, p.created_at, p.transaction_id, p.bank_message,
          i.id AS invoice_id, NULLIF(i.reference_id,'undefined') AS reference_id, i."userId" AS user_id,
          i.metadata->>'customerId' AS customer_id, i.metadata->>'ftthNumber' AS ftth_number, NULLIF(i.metadata->>'orderNumber','undefined') AS order_number
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE i.metadata->>'ftthNumber' = ANY($1::text[]) OR i.metadata->>'customerId' = ANY($1::text[])
          OR i.metadata->>'orderNumber' = ANY($1::text[]) OR i.reference_id = ANY($1::text[])
       ORDER BY p.created_at DESC LIMIT 50`, [keys]);
    return { configured: true, rows: r.rows };
  } catch (e) { return { configured: true, error: e.message, rows: [] }; }
}

async function lookup(q, req) {
  const key = String(q.key || '').trim();
  if (!key) return { found: false, key, keyKind: null };
  if (!db.ops) { const e = new Error('Fixed data source not configured (OPS_DATABASE_URL)'); e.status = 503; throw e; }
  const unmask = !!(req && req.caps && req.caps.unmaskPII && q.unmask === '1');
  const ms = forms(key);
  const pools = [[db.ops, 'prod']].concat(db.opsBeta ? [[db.opsBeta, 'beta']] : []);
  let found = (await Promise.all(pools.map(([p, s]) => findAttempts(p, key, ms, s).catch(e => { console.error('[fixedCustomer]', s, e.message); return []; })))).flat();
  // NID / contact-mobile keys are not in the read model → bridge through nexus to the workflow ids
  let link = null;
  const kind = keyKind(key);
  if (kind === 'nid' || kind === 'msisdn') {
    link = await nexusLinkIds(key, ms);
    if (link.ids.length) {
      const more = (await Promise.all(pools.map(([p, s]) => attemptsByIds(p, link.ids, s).catch(() => [])))).flat();
      found = found.concat(more);
    }
  }
  // de-duplicate (same attempt id in prod + beta) — prefer prod row
  const seen = new Map(); for (const a of found) if (!seen.has(a.id) || a.source === 'prod') seen.set(a.id, a);
  const attempts = Array.from(seen.values()).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

  /* INVENTORY — what the customer HAS in the fixed BSS (ZSmart), not what they attempted. Live when FIXED_BSS_BASE is
   * set, else the latest responses nexus logged in the customer's own journeys (see fixedInventory.js). */
  const wfIds = Array.from(new Set([...(link && link.ids ? link.ids : []), ...attempts.map(a => a.id)]));
  let inventory = null;
  try { inventory = await inventoryMod.inventory({ nid: kind === 'nid' ? key : null, workflowIds: wfIds, refresh: q.refresh === '1' }); }
  catch (e) { inventory = { available: false, reason: e.message }; }
  const invOut = inventoryMod.mask(inventory, unmask);

  if (!attempts.length) {
    if (inventory && inventory.available) {
      return { found: true, key, keyKind: keyKind(key), unmasked: unmask, customer: { cust_code: invOut.customer && invOut.customer.cust_code, customer_id: null, services: 0, orders: 0, attempts: 0, channels: [] },
        services: [], attempts: [], errors: [], payments: await findPayments([key]), links: {}, sources: pools.map(([, s]) => s), link, inventory: invOut, inventory_summary: inventoryMod.summary(inventory) };
    }
    return { found: false, key, keyKind: keyKind(key), link, inventory: invOut, payments: await findPayments([key]) };
  }

  // every identifier this customer is known by → cross-search keys for payments and for the MVNO side
  const ids = { service: new Set(), cust: new Set(), customer: new Set(), order: new Set(), msisdn: new Set() };
  for (const a of attempts) { if (a.service_no) ids.service.add(a.service_no); if (a.cust_code) ids.cust.add(a.cust_code);
    if (a.customer_id) ids.customer.add(a.customer_id); if (a.order_number) ids.order.add(a.order_number);
    if (a.msisdn) String(a.msisdn).split(/\s+/).forEach(m => m && ids.msisdn.add(m)); }
  const payKeys = [...ids.service, ...ids.customer, ...ids.order, key];
  const [errors, payments] = await Promise.all([
    findErrors(db.ops, attempts.map(a => a.id), [...ids.order]).catch(() => []),
    findPayments(Array.from(new Set(payKeys))),
  ]);
  // services = latest attempt per service number (or per order when no service no yet)
  const svc = new Map();
  for (const a of attempts) { const k = a.service_no || (a.order_number ? 'order:' + a.order_number : null); if (!k) continue;
    if (!svc.has(k)) svc.set(k, { key: k, service_no: a.service_no, order_number: a.order_number, workflow: a.workflow, label: f360.WORKFLOW_LABEL[a.workflow] || a.workflow,
      plan: a.plan, channel: a.channel, outcome: a.outcome, step_reached: a.step_reached, odb: a.odb, region: a.region, started_at: a.started_at, completed_at: a.completed_at,
      dealer: a.dealer_name || a.dealer_code || null, staff: a.staff_name || null, referral_code: a.referral_code, attempts: 0 }); svc.get(k).attempts++; }
  const mask = v => unmask ? v : v;   // identifiers below are masked per field
  const M = a => unmask ? a : { ...a, msisdn: tail(a.msisdn, 4), iccid: tail(a.iccid, 6), cpe: tail(a.cpe, 4), service_no: tail(a.service_no, 6), cust_code: tail(a.cust_code, 4), customer_id: tail(a.customer_id, 4) };
  const first = attempts[0];
  return {
    found: true, key, keyKind: keyKind(key), unmasked: unmask,
    customer: { cust_code: unmask ? first.cust_code : tail(first.cust_code, 4), customer_id: unmask ? first.customer_id : tail(first.customer_id, 4),
      services: ids.service.size, orders: ids.order.size, attempts: attempts.length, channels: [...new Set(attempts.map(a => a.channel))],
      first_seen: attempts[attempts.length - 1].started_at, last_seen: first.started_at },
    services: Array.from(svc.values()).map(s => unmask ? s : { ...s, service_no: tail(s.service_no, 6), key: s.service_no ? tail(s.service_no, 6) : s.key }),
    attempts: attempts.slice(0, 60).map(M),
    errors,
    payments,
    links: { msisdn: [...ids.msisdn].map(m => unmask ? m : tail(m, 4)), msisdn_full: unmask ? [...ids.msisdn] : undefined,
             cust_code: unmask ? [...ids.cust] : undefined, customer_id: unmask ? [...ids.customer] : undefined },
    sources: pools.map(([, s]) => s), link,
    inventory: invOut, inventory_summary: inventoryMod.summary(inventory),
  };
}

function mount(app, { wrap, audit }) {
  // Customer 360 is a SHARED page: anyone with the fixed view OR the explore view (where Subscriber 360 lives) may look up
  const gate360 = (req, res, next) => (req.views && (req.views.includes('fixed') || req.views.includes('explore'))) ? next()
    : res.status(403).json({ error: `role ${req.roleName} lacks fixed/explore access` });
  app.get('/api/fixed/customer', gate360, wrap(async (q, req) => {
    const r = await lookup(q, req);
    if (audit) audit(req, r.unmasked ? 'fixed.customer.unmasked' : 'fixed.customer', String(q.key || '').slice(0, 40), { found: r.found });
    return r;
  }));
}
module.exports = { mount, lookup, keyKind };
