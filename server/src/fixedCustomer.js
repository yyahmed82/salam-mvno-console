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
/* 20 Sep 2026 — THE QUERY BELOW CANNOT BE MADE FAST. `context::text ~ $1` is a regex over a JSON
 * column: no index can serve it, so it is a sequential scan with a per-row regex across 24 months of
 * workflow_states, under a 12 s budget. It times out under load, and when it does the page prints
 * "could not link through nexus" to whoever is watching. Two guards:
 *
 *  1. A PERSISTED cache of the ANSWER — `nexus_link_cache`, keyed by a SALTED HASH of the identity.
 *     The row holds the hash and a list of workflow ids. No identifier is stored, and the ids mean
 *     nothing without nexus itself, so this stays inside the rule that keeps customer identifiers
 *     out of unified_console. Second and subsequent lookups of the same customer never run the scan.
 *  2. An in-memory NEGATIVE window after a timeout, so one slow scan does not make every later page
 *     load stall another 12 s behind the same doomed query. */
const NEG = new Map();                                   // key → epoch ms until which we do not retry
const NEG_MS = Math.max(15, Number(process.env.NEXUS_LINK_BACKOFF_SEC || 90)) * 1000;
const LINK_DAYS = Math.max(1, Number(process.env.LOOKUP_CACHE_TTL_DAYS ?? 10));

/* 20 Sep 2026, second pass — TWO THINGS ALPHA.61 GOT WRONG, both found on 152 within the hour.
 *
 *  (a) The cache only stored a SUCCESS. A scan that always times out therefore never populated it,
 *      so the cache could never help the one case it was built for. A timeout is now a persisted
 *      answer too — an empty list with `pending` — on a short retention, so the page stops paying
 *      12 s for it while a real answer is still allowed to arrive and replace it.
 *  (b) Customer 360 awaits Promise.allSettled([mobile, fixed]), so this scan gated the WHOLE page
 *      render, not just the Fixed tab. Rather than restructure the page the night before a demo,
 *      the wait is bounded here: interactive callers get whatever the scan produced within
 *      NEXUS_LINK_WAIT_MS, and if it is still running the request returns and the scan carries on
 *      in the background to fill the cache for the next look. A WARM caller (warmup.js over
 *      loopback) sets wait=Infinity and a long statement timeout, so the offline path pays the
 *      cost once and the interactive path never does. */
const WAIT_MS = Math.max(300, Number(process.env.NEXUS_LINK_WAIT_MS || 2500));
const SCAN_MS = Math.max(2000, Number(process.env.NEXUS_LINK_SCAN_MS || 12000));
const WARM_SCAN_MS = Math.max(SCAN_MS, Number(process.env.NEXUS_LINK_WARM_SCAN_MS || 120000));
const inflight = new Map();                              // key → promise, so one scan serves everyone

async function nexusLinkIds(key, ms, opts) {
  if (!db.nexus) return { ids: [], reason: 'nexus not configured' };
  const k = String(key).trim(); const alts = Array.from(new Set([k, ...ms])).filter(Boolean);
  const hash = require('./lookupCache').keyHash(k);
  if (hash) {
    try {
      const r = await db.console.query(
        `SELECT wf_ids FROM nexus_link_cache WHERE key_hash = $1 AND seen_at > now() - ($2||' days')::interval`,
        [hash, LINK_DAYS]);
      if (r.rowCount) return { ids: r.rows[0].wf_ids || [], reason: null, cached: true };
    } catch (_) { /* table missing on first boot → fall through to the live scan */ }
  }
  const warm = !!(opts && opts.warm);
  const until = NEG.get(k);
  if (!warm && until && until > Date.now()) return { ids: [], reason: 'nexus link lookup timed out a moment ago — not retried yet', cached: false };
  /* One scan per key, however many callers ask. Without this, three tabs on the same customer
   * meant three sequential-scan regexes racing each other over the same 24 months of rows. */
  let run = inflight.get(k);
  if (!run) {
    run = scan(k, alts, hash, warm)
      .catch(e => ({ ids: [], reason: e.message }))      // nobody may be awaiting this one: never let it reject
      .finally(() => inflight.delete(k));
    inflight.set(k, run);
  }
  if (warm) return run;                                  // the warm path waits as long as it takes
  const bounded = await Promise.race([run, new Promise(r => setTimeout(() => r(null), WAIT_MS))]);
  if (bounded) return bounded;
  return { ids: [], reason: `still linking through nexus (over ${Math.round(WAIT_MS / 100) / 10} s) — the scan is finishing in the background, reload in a moment`, pending: true };
}

async function scan(k, alts, hash, warm) {
  const pat = '"(?:certNbr|nationalId|idNumber|nid|msisdn|mobilePhone|mobileNumber|mobile|phoneNumber|phone)"\\s*:\\s*"(?:' + alts.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')"';
  const c = await db.nexus.connect();
  try {
    const budget = warm ? WARM_SCAN_MS : SCAN_MS;
    await c.query('BEGIN READ ONLY'); await c.query(`SET LOCAL statement_timeout = ${Number(budget)}`);
    const r = await c.query(`SELECT id::text AS id FROM workflow_states
       WHERE updated_at > now() - interval '24 months' AND context::text ~ $1
       ORDER BY updated_at DESC LIMIT 100`, [pat]);
    await c.query('ROLLBACK');
    const ids = r.rows.map(x => x.id);
    NEG.delete(k);
    if (hash) {
      db.console.query(
        `INSERT INTO nexus_link_cache (key_hash, wf_ids, seen_at) VALUES ($1, $2::text[], now())
           ON CONFLICT (key_hash) DO UPDATE SET wf_ids = EXCLUDED.wf_ids, seen_at = now()`,
        [hash, ids]).catch(() => {});                    // best-effort: a cache miss is never an error
    }
    return { ids, reason: null, cached: false };
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    if (/statement timeout|canceling statement|timeout exceeded when trying to connect/i.test(e.message || '')) {
      NEG.set(k, Date.now() + NEG_MS);
      /* Persist the fact that we could not answer, on a SHORT retention. Without this the page pays
       * the full scan every single time for exactly the customers the scan cannot handle. */
      if (hash) {
        db.console.query(
          `INSERT INTO nexus_link_cache (key_hash, wf_ids, seen_at) VALUES ($1, '{}'::text[], now() - ($2||' days')::interval)
             ON CONFLICT (key_hash) DO NOTHING`,
          [hash, Math.max(0, LINK_DAYS - 1)]).catch(() => {});
      }
    }
    return { ids: [], reason: e.message };
  }
  finally { c.release(); }
}
/* COMPLAINT TICKETS the customer opened from the Salam Home app (nexus `tickets`, 8 Sep 2026). The app posts them to
 * the call-centre ticketing behind the SDM gateway (Remedy-style: category1/2/3, support group "Back Office", ITC) and
 * mirrors id / type / status into nexus. Nothing else in the digital backend talks to ServiceNow or Remedy (checked
 * salam-nexus master) — so this table is the only place a subscriber complaint is visible to us. Matched by the
 * ticket's own phone number, the app user's phone number, or the user's national id; newest first; read-only. */
async function findComplaints(key, ms, kind, unmask) {
  if (!db.nexus) return { configured: false, rows: [] };
  const alts = Array.from(new Set([String(key).trim(), ...ms])).filter(Boolean);
  const c = await db.nexus.connect();
  try {
    await c.query('BEGIN READ ONLY'); await c.query('SET LOCAL statement_timeout = 8000');
    const r = await c.query(`SELECT t."ticketID" AS ticket_id, t.type, t.status, t.description, t.name, t.email, t.phone_number, t.created_at, t.updated_at,
         u.phone_number AS user_phone, u.national_id
       FROM tickets t LEFT JOIN users u ON u.id = t."userId"
       WHERE t.phone_number = ANY($1) OR u.phone_number = ANY($1)${kind === 'nid' ? ' OR u.national_id = $2' : ''}
       ORDER BY t.created_at DESC LIMIT 50`, kind === 'nid' ? [alts, String(key).trim()] : [alts]);
    await c.query('ROLLBACK');
    const mEmail = e => { if (!e) return null; const [u, d] = String(e).split('@'); return (u || '').slice(0, 2) + '***' + (d ? '@' + d : ''); };
    const rows = r.rows.map(x => ({ ticket_id: x.ticket_id, type: x.type, status: x.status, created_at: x.created_at, updated_at: x.updated_at,
      description: String(x.description || '').slice(0, 300),
      name: unmask ? x.name : (x.name ? String(x.name).split(/\s+/)[0] + ' …' : null),
      email: unmask ? x.email : mEmail(x.email), phone: unmask ? (x.phone_number || x.user_phone) : tail(x.phone_number || x.user_phone, 4) }));
    return { configured: true, rows, open: rows.filter(x => !/closed|resolved|cancel/i.test(x.status || '')).length };
  } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} return { configured: true, error: e.message, rows: [] }; }
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

/* 20 Sep 2026 — CACHE THE WHOLE ANSWER, not just the nexus link. Measured on 152: caching only the
 * link left this endpoint at 15–22 s, because attempts, complaints and inventory are each slow in
 * their own right and no amount of nexus caching touches them. The mobile profile went to 50 ms the
 * moment its whole payload was cached; this is the same move.
 *
 * MASKED ANSWERS ONLY. An unmasked lookup is privileged and audited — serving one from a shared
 * cache, or seeding the cache with one, would put unmasked PII in front of someone whose request was
 * never audited for it. So unmask bypasses entirely, in both directions. Like the profile cache this
 * lives in process memory and never touches disk. */
async function lookup(q, req) {
  const key = String(q.key || '').trim();
  if (!key) return { found: false, key, keyKind: null };
  const unmaskReq = !!(req && req.caps && req.caps.unmaskPII && q.unmask === '1');
  if (unmaskReq || q.refresh === '1') return buildLookup(q, req);
  return require('./lookupCache').wrap('fixed:' + key, () => buildLookup(q, req), { refresh: q.warm === '1' });
}

async function buildLookup(q, req) {
  const key = String(q.key || '').trim();
  if (!db.ops) { const e = new Error('Fixed data source not configured (OPS_DATABASE_URL)'); e.status = 503; throw e; }
  const unmask = !!(req && req.caps && req.caps.unmaskPII && q.unmask === '1');
  const ms = forms(key);
  const pools = [[db.ops, 'prod']].concat(db.opsBeta ? [[db.opsBeta, 'beta']] : []);
  const kind = keyKind(key);
  /* TIMINGS (20 Sep 2026). Caching the nexus scan took this endpoint from 45 s to 15 s and I had no
   * idea where the remaining 15 s went, because every phase ran end to end with nothing measuring
   * it. `timings` is now in the response, so the next person does not have to guess either. */
  const T = {}; const T0 = Date.now(); const mark = (n, t) => { T[n] = Date.now() - t; };
  /* POOL DISCIPLINE (20 Sep 2026 — correcting my own change an hour old). Starting the complaints
   * query alongside the nexus scan made this WORSE, not better: `db.nexus` is a TWO-connection
   * read-only pool and fixedInventory reads it too, so three concurrent consumers meant one waited
   * out the 15 s connection timeout and the whole lookup failed with "timeout exceeded when trying
   * to connect" — 22 s and no answer, against 15 s and an answer before I touched it.
   * The rule is: parallelise ACROSS pools, serialise WITHIN one. Attempts (ops) runs alongside the
   * nexus work; the two nexus queries take their turn. */
  const tA = Date.now();
  const attemptsP = Promise.all(pools.map(([p, s]) => findAttempts(p, key, ms, s)
      .catch(e => { console.error('[fixedCustomer]', s, e.message); return []; })))
    .then(r => { mark('attempts', tA); return r.flat(); });
  const nexusP = (async () => {
    let link = null, complaints;
    if (kind === 'nid' || kind === 'msisdn') {
      const tN = Date.now();
      link = await nexusLinkIds(key, ms, { warm: q.warm === '1' });
      mark('nexus', tN);
      const tC = Date.now();
      complaints = await findComplaints(key, ms, kind, unmask).catch(e => ({ configured: true, error: e.message, rows: [] }));
      mark('complaints', tC);
    } else complaints = { configured: !!db.nexus, rows: [], skipped: 'complaints are matched by mobile number or national id' };
    return { link, complaints };
  })();
  let found = await attemptsP;
  const { link, complaints } = await nexusP;
  // NID / contact-mobile keys are not in the read model → the workflow ids came from nexus above
  if (link) {
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
  const tI = Date.now();
  try { inventory = await inventoryMod.inventory({ nid: kind === 'nid' ? key : null, workflowIds: wfIds, refresh: q.refresh === '1' }); }
  catch (e) { inventory = { available: false, reason: e.message }; }
  mark('inventory', tI);
  const invOut = inventoryMod.mask(inventory, unmask);
  // complaint tickets from the Salam Home app (nexus) — started above, awaited here; never blocks the lookup
  T.total = Date.now() - T0;

  if (!attempts.length) {
    if ((inventory && inventory.available) || complaints.rows.length) {
      return { found: true, key, keyKind: keyKind(key), unmasked: unmask, customer: { cust_code: invOut.customer && invOut.customer.cust_code, customer_id: null, services: 0, orders: 0, attempts: 0, channels: [] },
        services: [], attempts: [], errors: [], payments: await findPayments([key]), links: {}, sources: pools.map(([, s]) => s), link, inventory: invOut, inventory_summary: inventoryMod.summary(inventory), complaints, timings: { ...T, total: Date.now() - T0 }, builtAt: new Date().toISOString() };
    }
    return { found: false, key, keyKind: keyKind(key), link, inventory: invOut, payments: await findPayments([key]), complaints, timings: { ...T, total: Date.now() - T0 }, builtAt: new Date().toISOString() };
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
    complaints,
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
