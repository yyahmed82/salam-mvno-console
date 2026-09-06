/* fixedInventory.js — WHAT A CUSTOMER *HAS* on the Fixed side (FTTH / FTTB / 5G home), as the fixed BSS (ZSmart,
 * "transferRest/wsc") knows it — as opposed to what they ATTEMPTED (order_attempts, the journey read model).
 *
 * WHY (case 2392697450, 5 Sep 2026): the customer holds FTTH09071297 (Salam Fiber Postpaid 300, active since
 * 2025-08-03) yet Customer 360 / Yusr said "no Fixed service": the service predates every journey the console
 * ingests. The Salam Home app, however, resolves the same identity on every visit through four ZSmart reads:
 *
 *   POST salamchecknid?certNbr=<NID>&certTypeId=1|2   → cust { custId, custCode, custName, state, createdDate }
 *   GET  salamqueryacct?custCode=<custCode>&payFlag=Y → acctList[{ acctId, acctNbr, payType }]
 *   POST qrysubslist { custId, serviceType:"10" }      → subscriberList[{ accNbr:"FTTH…", subsPlanName, prodState,
 *                                                        speed, provider, effDate, expDate, paidFlag, offerName, acctNbr }]
 *   GET  qryacctowefee/<accNbr>                        → { amount }        (what is owed on that service)
 *   POST queryOrderList { custId, startDate, endDate, orderState:"I,P" } → orderList[] (open BSS orders)
 *
 * TWO TIERS, same shape:
 *   recorded — the latest such responses nexus logged (api_logs, FK workflow_state_id) for the customer's own
 *              journeys. Zero new integration, available wherever NEXUS_DATABASE_URL is. Carries `as_of`.
 *   live     — the same reads against ZSmart, ONLY when FIXED_BSS_BASE is set (from 152; the base is the one nexus
 *              uses, e.g. http://172.20.53.30:8080/api/transferRest/wsc/prod). Read-only whitelist: the five paths
 *              above and nothing else — there is no code path to create/modify. FIXED_BSS_HEADERS = JSON of extra
 *              headers if the gateway wants an API key. Snapshots stored like liveBss (fixed_inventory_snapshots).
 *
 * PII: custName / birthday / email / phone from salamchecknid are NEVER returned — only ids (masked to last digits
 * unless unmask) plus the service inventory, which is what an operator needs. */
'use strict';
const http = require('http'), https = require('https');
const db = require('./db');

const tail = (s, k) => s == null || s === '' ? null : '…' + String(s).slice(-k);
const digits = s => String(s || '').replace(/\D/g, '');
const BASE = () => (process.env.FIXED_BSS_BASE || '').replace(/\/+$/, '');
const liveConfigured = () => !!BASE();
const recordedConfigured = () => !!db.nexus;
const configured = () => liveConfigured() || recordedConfigured();

/* --------------------------------------------------------------------------------------------- normalisation */
function normCustomer(c) {
  if (!c || typeof c !== 'object') return null;
  return { cust_id: c.custId != null ? String(c.custId) : null, cust_code: c.custCode != null ? String(c.custCode) : null,
    state: c.state || null, cust_type: c.custType || null, since: c.createdDate || null, cert_type: c.cert && c.cert.certTypeId || c.certTypeId || null };
}
function normSubs(list) {
  return (Array.isArray(list) ? list : []).map(s => ({
    account: s.accNbr || s.accountNumber || null, acct_nbr: s.acctNbr != null ? String(s.acctNbr) : null, acct_id: s.acctId != null ? String(s.acctId) : null,
    subs_id: s.subsId != null ? String(s.subsId) : null, plan: s.subsPlanName || null, plan_id: s.subsPlanId || null, offer: s.offerName || null, offer_id: s.offerId || null,
    speed_mbps: s.speed ? Number(s.speed) : null, provider: s.provider || null, serv_type: s.servType || null,
    state: s.prodState || null, state_label: PROD_STATE[s.prodState] || s.prodState || null, paid: s.paidFlag === 'Y',
    eff_date: s.effDate || null, exp_date: s.expDate || null, suspension_reason: s.suspensionReason && !/^0+$/.test(String(s.suspensionReason).replace(/\D/g, '')) ? s.suspensionReason : null }));
}
const PROD_STATE = { A: 'active', S: 'suspended', T: 'terminated', P: 'pending', I: 'in progress', F: 'frozen', D: 'deactivated' };
function normAccts(list) { return (Array.isArray(list) ? list : []).map(a => ({ acct_id: a.acctId != null ? String(a.acctId) : null, acct_nbr: a.acctNbr != null ? String(a.acctNbr) : null, pay_type: a.payType || null, payment_type: a.paymentType || null })); }
function normOrders(list) {
  return (Array.isArray(list) ? list : []).map(o => ({ order: o.orderNumber || null, event: o.eventName || null, state: o.orderState || null, state_label: ORDER_STATE[o.orderState] || o.orderState,
    created: o.createTime || null, completed: o.completeTime || null, amount_sar: o.chargeAmount != null ? Number(o.chargeAmount) / 100 : null, channel: o.acceptChannel || null, payment: o.paymentMethod || null, service: o.serviceNumber || null }));
}
const ORDER_STATE = { I: 'in progress', P: 'pending', C: 'completed', X: 'cancelled' };
const parse = v => { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (_) { return null; } };

/* --------------------------------------------------------------------------------------------- recorded tier */
/* Latest logged response per endpoint family among the customer's own nexus workflows (ids from fixedCustomer's
 * nexus bridge — indexed FK, so this never scans api_logs). */
async function recorded(workflowIds, { nid } = {}) {
  if (!db.nexus || !workflowIds || !workflowIds.length) return { available: false, reason: db.nexus ? 'no linked workflows' : 'nexus not configured' };
  const c = await db.nexus.connect();
  try {
    await c.query('BEGIN READ ONLY'); await c.query('SET LOCAL statement_timeout = 15000');
    const r = await c.query(
      `SELECT DISTINCT ON (fam) fam, endpoint, created_at, payload, response FROM (
         SELECT CASE WHEN endpoint ~* 'salamchecknid' THEN 'cust' WHEN endpoint ~* 'qrysubslist' THEN 'subs'
                     WHEN endpoint ~* 'salamqueryacct\\?custCode=[0-9]+&payFlag=Y' THEN 'accts' WHEN endpoint ~* 'queryOrderList' THEN 'orders' END AS fam,
                endpoint, created_at, payload, response
           FROM api_logs WHERE workflow_state_id = ANY($1::text[]) AND status BETWEEN 200 AND 299
            AND endpoint ~* '(salamchecknid|qrysubslist|salamqueryacct|queryOrderList)'
            ${nid ? "AND (endpoint !~* 'salamchecknid' OR endpoint ~* ('certNbr=' || $2))" : ''}
       ) x WHERE fam IS NOT NULL ORDER BY fam, created_at DESC`, nid ? [workflowIds, digits(nid)] : [workflowIds]);
    const fee = await c.query(
      `SELECT DISTINCT ON (endpoint) endpoint, created_at, response FROM api_logs
        WHERE workflow_state_id = ANY($1::text[]) AND endpoint ~* 'qryacctowefee/' AND status BETWEEN 200 AND 299
        ORDER BY endpoint, created_at DESC`, [workflowIds]).catch(() => ({ rows: [] }));
    await c.query('ROLLBACK');
    const by = Object.fromEntries(r.rows.map(x => [x.fam, x]));
    const out = { available: true, tier: 'recorded', as_of: null, customer: null, accounts: [], subscriptions: [], open_orders: [], owed: {} };
    const stamp = row => { if (row && (!out.as_of || new Date(row.created_at) > new Date(out.as_of))) out.as_of = row.created_at; };
    if (by.cust) { const j = parse(by.cust.response); out.customer = normCustomer(j && j.cust); stamp(by.cust); }
    if (by.subs) { const j = parse(by.subs.response); out.subscriptions = normSubs(j && j.subscriberList); stamp(by.subs); }
    if (by.accts) { const j = parse(by.accts.response); out.accounts = normAccts(j && j.acctList); stamp(by.accts); }
    if (by.orders) { const j = parse(by.orders.response); out.open_orders = normOrders(j && j.orderList); stamp(by.orders); }
    for (const f of fee.rows) { const m = /qryacctowefee\/([A-Za-z0-9]+)/.exec(f.endpoint); const j = parse(f.response); if (m && j && j.amount != null) out.owed[m[1]] = { amount_sar: Number(j.amount), as_of: f.created_at }; }
    if (!out.customer && !out.subscriptions.length && !out.accounts.length) return { available: false, tier: 'recorded', reason: 'the customer\'s journeys logged no BSS identity/inventory call' };
    return out;
  } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} return { available: false, tier: 'recorded', reason: e.message }; }
  finally { c.release(); }
}

/* --------------------------------------------------------------------------------------------- live tier */
const PATHS = {                     // the WHOLE callable universe — reads only
  cust:   ({ nid })      => ({ method: 'POST', path: `/salamchecknid?certNbr=${digits(nid)}&certTypeId=${digits(nid).startsWith('1') ? 1 : 2}` }),
  accts:  ({ custCode }) => ({ method: 'GET',  path: `/salamqueryacct?custCode=${encodeURIComponent(custCode)}&payFlag=Y` }),
  subs:   ({ custId })   => ({ method: 'POST', path: '/qrysubslist', body: { custId: String(custId), serviceType: '10' } }),
  owed:   ({ account })  => ({ method: 'GET',  path: `/qryacctowefee/${encodeURIComponent(account)}` }),
  orders: ({ custId })   => ({ method: 'POST', path: '/queryOrderList', body: { custId: String(custId), startDate: ymd(-365), endDate: ymd(2), orderState: 'I,P', subsEventId: '1,28' } }),
};
const ymd = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
function call(name, args) {
  const spec = PATHS[name]; if (!spec) return Promise.resolve({ ok: false, error: 'not a whitelisted read' });
  const { method, path, body } = spec(args);
  return new Promise(resolve => {
    const t0 = Date.now(); let url;
    try { url = new URL(BASE() + path); } catch (e) { return resolve({ ok: false, error: 'bad FIXED_BSS_BASE' }); }
    let extra = {}; try { extra = JSON.parse(process.env.FIXED_BSS_HEADERS || '{}'); } catch (_) {}
    const data = body ? JSON.stringify(body) : null;
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...extra, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      timeout: Number(process.env.FIXED_BSS_TIMEOUT_MS || 12000), rejectUnauthorized: false }, res => {
      let buf = ''; res.on('data', d => buf += d); res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (_) {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300 && j && (j.status == null || /success/i.test(j.status)), http: res.statusCode, data: j, raw: j ? undefined : buf.slice(0, 300), ms: Date.now() - t0 }); });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', e => resolve({ ok: false, error: e.message, ms: Date.now() - t0 }));
    if (data) req.write(data); req.end();
  });
}
async function ensure() {
  if (ensure.done || !db.console) return; ensure.done = true;
  await db.console.query(`CREATE TABLE IF NOT EXISTS fixed_inventory_snapshots (id bigserial PRIMARY KEY, cust_key text NOT NULL, taken_at timestamptz NOT NULL DEFAULT now(), ok boolean, ms int, body jsonb)`).catch(() => {});
  await db.console.query(`CREATE INDEX IF NOT EXISTS fixed_inventory_snapshots_key ON fixed_inventory_snapshots (cust_key, taken_at DESC)`).catch(() => {});
}
async function live(nid, { refresh = false } = {}) {
  if (!liveConfigured()) return { available: false, tier: 'live', reason: 'FIXED_BSS_BASE not set' };
  await ensure();
  const key = 'nid:' + digits(nid);
  if (!refresh && db.console) {
    const s = await db.console.query(`SELECT taken_at, body FROM fixed_inventory_snapshots WHERE cust_key=$1 AND ok ORDER BY taken_at DESC LIMIT 1`, [key]).catch(() => ({ rows: [] }));
    if (s.rows[0] && Date.now() - new Date(s.rows[0].taken_at) < 10 * 60e3) return { ...s.rows[0].body, cached: true };
  }
  const t0 = Date.now();
  const out = { available: true, tier: 'live', as_of: new Date().toISOString(), customer: null, accounts: [], subscriptions: [], open_orders: [], owed: {}, calls: [] };
  const rec = (n, r) => out.calls.push({ call: n, ok: r.ok, http: r.http, ms: r.ms, error: r.error || (r.data && r.data.errorMessage) || undefined });
  const cu = await call('cust', { nid }); rec('salamchecknid', cu);
  if (!cu.ok || !cu.data || cu.data.isExist === 'N' || !cu.data.cust) {
    out.available = cu.ok; out.reason = cu.ok ? 'BSS knows no fixed customer for this ID' : (cu.error || 'HTTP ' + cu.http);
    return out;
  }
  out.customer = normCustomer(cu.data.cust);
  const [ac, su, or] = await Promise.all([
    call('accts', { custCode: out.customer.cust_code }), call('subs', { custId: out.customer.cust_id }), call('orders', { custId: out.customer.cust_id })]);
  rec('salamqueryacct', ac); rec('qrysubslist', su); rec('queryOrderList', or);
  if (ac.ok) out.accounts = normAccts(ac.data.acctList);
  if (su.ok) out.subscriptions = normSubs(su.data.subscriberList);
  if (or.ok) out.open_orders = normOrders(or.data.orderList);
  const active = out.subscriptions.filter(s => s.account && s.state === 'A').slice(0, 6);
  for (const s of active) { const w = await call('owed', { account: s.account }); rec('qryacctowefee/' + s.account, w); if (w.ok && w.data.amount != null) out.owed[s.account] = { amount_sar: Number(w.data.amount), as_of: out.as_of }; }
  out.ms = Date.now() - t0;
  if (db.console) db.console.query(`INSERT INTO fixed_inventory_snapshots (cust_key, ok, ms, body) VALUES ($1,$2,$3,$4)`, [key, true, out.ms, JSON.stringify(out)]).catch(() => {});
  return out;
}

/* --------------------------------------------------------------------------------------------- facade */
/* inventory(nid, workflowIds): live when configured, else recorded; always says which tier and as-of. */
async function inventory({ nid, workflowIds, refresh }) {
  let inv = null;
  if (nid && liveConfigured()) inv = await live(nid, { refresh });
  if (!inv || !inv.available) {
    const rec = await recorded(workflowIds, { nid });
    if (rec.available) { if (inv && inv.reason) rec.live_reason = inv.reason; inv = rec; }
    else if (!inv) inv = rec;
    else inv.recorded_reason = rec.reason;
  }
  return inv;
}
/* Masking: ids to last digits; account numbers (FTTH…) are service identifiers the operator needs — kept as the
 * app shows them ("FTTH : 09071297") unless the caller is stricter. */
function mask(inv, unmask) {
  if (!inv || unmask) return inv;
  const m = { ...inv };
  if (m.customer) m.customer = { ...m.customer, cust_id: tail(m.customer.cust_id, 4), cust_code: tail(m.customer.cust_code, 4) };
  m.accounts = (m.accounts || []).map(a => ({ ...a, acct_id: tail(a.acct_id, 4), acct_nbr: tail(a.acct_nbr, 4) }));
  m.subscriptions = (m.subscriptions || []).map(s => ({ ...s, acct_id: tail(s.acct_id, 4), acct_nbr: tail(s.acct_nbr, 4), subs_id: tail(s.subs_id, 4) }));
  m.open_orders = (m.open_orders || []).map(o => ({ ...o, order: tail(o.order, 6) }));
  return m;
}
/* One-line summary for chat / cards */
function summary(inv) {
  if (!inv || !inv.available) return null;
  const subs = inv.subscriptions || [];
  const active = subs.filter(s => s.state === 'A');
  return { tier: inv.tier, as_of: inv.as_of, customer_state: inv.customer && inv.customer.state, accounts: (inv.accounts || []).length,
    services: subs.length, active: active.length,
    lines: subs.map(s => `${s.account || '?'} · ${s.plan || s.offer || ''}${s.speed_mbps ? ' · ' + s.speed_mbps + ' Mbps' : ''} · ${s.state_label || s.state}${s.eff_date ? ' since ' + s.eff_date : ''}${s.provider ? ' · ' + s.provider : ''}${inv.owed && inv.owed[s.account] ? ' · owed ' + inv.owed[s.account].amount_sar + ' SAR' : ''}`),
    open_orders: (inv.open_orders || []).length };
}

module.exports = { configured, liveConfigured, recordedConfigured, inventory, recorded, live, mask, summary, PATHS };
