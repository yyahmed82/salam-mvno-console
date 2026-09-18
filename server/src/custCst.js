/* custCst.js — the regulator's view of ONE customer, for Customer 360 and Yusr (18 Sep 2026).
 *
 * The CST section of the console is a super-admin surface: it reads the whole of ARSystem and can run the five
 * regulator endpoints against any ticket. A call-centre agent on Customer 360 needs something much narrower and
 * needs it constantly — "does CST have a complaint open on the customer I am talking to, and what does CST think
 * this customer's services are". This module is that narrow contract, and it is deliberately not the wide one:
 *
 *   · one customer key at a time, never a free search across the view;
 *   · complaints capped and shaped down to what an agent can act on, PII masked unless the caller holds
 *     unmaskPII (the same rule as the rest of Customer 360);
 *   · the Arqami call is an explicit action, never part of loading a profile. Every call writes a row into
 *     APPS.YY_REGISTER_NUMBER_AUDIT — the table the Arqami page measures — so a console that fired one on every
 *     profile view would be inflating CST's own picture of how much CST asks us. The service account and password
 *     come from .env and are never accepted from a browser (see arqamiApi.js).
 *
 * Nothing here is written to unified_console. Rows are read, answered and dropped; every call is audited by the
 * route with the identifier masked to its last four digits. */
'use strict';
const remedy = require('./cstRemedy');
const arqami = require('./arqamiApi');

const digits = v => String(v == null ? '' : v).replace(/\D/g, '');
/* A Saudi national / iqama id: 10 digits starting 1 or 2. Anything else is not offered to Arqami, because the
 * service takes an identity and a wrong guess is a wasted regulator-facing call. */
const isNid = v => /^[12]\d{9}$/.test(digits(v));

/* Which identifiers a customer profile can hand us, best first. Customer 360 searches by MSISDN, national id,
 * FTTH account, customer code, order number or ICCID — Remedy indexes most of those under its own names. */
function keysOf(profile = {}) {
  const id = profile.identity || {};
  const out = [];
  const push = (v, kind) => { const t = String(v == null ? '' : v).trim(); if (t.length >= 3 && !out.some(x => x.value === t)) out.push({ value: t, kind }); };
  push(profile.key, 'key');
  push(id.nationality_id_number || id.national_id || id.nid, 'idNumber');
  push(id.customer_number || id.customer_code || id.custId, 'custId');
  push(id.service_id || id.ftth_account || id.account_number, 'serviceId');
  push(id.order_number || id.order_no, 'orderNo');
  return out;
}

const configured = () => remedy.configured();

/* Complaints CST raised on this customer. One search per identifier, best first, stopping at the first that
 * answers — an agent wants the customer's complaints, not a union of everything that ever matched. */
async function complaints(key, { unmask = false, limit = 20, extraKeys = [] } = {}) {
  if (!remedy.configured()) return { ok: false, configured: false, error: 'Remedy connector not configured (CST_REMEDY_* in .env)' };
  const tried = [];
  const cands = [{ value: String(key || '').trim(), kind: 'any' }]
    .concat((extraKeys || []).map(k => (k && k.value ? k : { value: String(k || ''), kind: 'any' })))
    .filter(c => c.value && c.value.length >= 3);
  const seen = new Set();
  for (const c of cands) {
    if (seen.has(c.value)) continue;
    seen.add(c.value);
    let r;
    try { r = await remedy.search(c.value, { field: c.kind === 'any' ? null : c.kind, limit, unmask }); }
    catch (e) { tried.push({ key: c.value, kind: c.kind, error: e.message }); continue; }
    if (r && r.ok === false) { tried.push({ key: c.value, kind: c.kind, error: r.error }); continue; }
    tried.push({ key: c.value, kind: c.kind, count: r.count });
    if (r.count) {
      const rows = (r.tickets || []).map(shape);
      return {
        ok: true, configured: true, matchedOn: c.value, field: r.field, ms: r.ms, view: r.view,
        count: rows.length, truncated: r.truncated, unmasked: !!r.unmasked, tried,
        open: rows.filter(t => t.open).length, complaints: rows
      };
    }
  }
  return { ok: true, configured: true, count: 0, complaints: [], open: 0, tried, matchedOn: null };
}

/* The grid an agent reads, not the whole ARSystem row. `open` is the only derived field and it is derived from
 * one thing only — whether ARSystem has a resolved date — so it cannot drift from the source. */
function shape(t) {
  const open = !t.RESOLVED_DATE;
  return {
    req: t.SERVICE_REQUESTID || null, incident: t.INCIDENT_NUMBER || null,
    created: t.CREATION_DATE || null, resolved: t.RESOLVED_DATE || null, open,
    ageDays: t.CREATION_DATE ? Math.max(0, Math.round((Date.now() - Date.parse(String(t.CREATION_DATE).replace(' ', 'T'))) / 864e5)) : null,
    status: t.STATUS || null, statusReason: t.STATUS_REASON || null,
    category: [t.CATEGORIZATION_TIER_1, t.CATEGORIZATION_TIER_2, t.CATEGORIZATION_TIER_3].filter(Boolean).join(' › ') || null,
    problem: t.PROBLEM_CODE || null,
    customerNumber: t.ITC_CUSTOMER_NUMBER || null, customerName: t.CUSTOMER_NAME || null,
    serviceId: t.ITC_SERVICE_ID || null, product: t.ITC_PRODUCT_NAME || null,
    source: t.ITC_SOURCE || null, ticketType: t.TROUBLE_TICKET_TYPES || null,
    resolution: t.RESOLUTION || null, actionTaken: t.ITC_ACTION_TAKEN || null,
    rowsInView: t.RAW_ROWS || 1
  };
}

/* What CST is shown for this identity. EXPLICIT ACTION ONLY — see the header. */
const servicesAvailable = () => arqami.configured() && arqami.credsSet();
async function services(nid) {
  if (!arqami.configured()) return { ok: false, error: 'Arqami API not configured (ARQAMI_API_BASE in .env)' };
  if (!arqami.credsSet()) return { ok: false, error: 'ARQAMI_API_USER / ARQAMI_API_PASSWORD are not set in /apps/unified/.env' };
  const id = String(nid || '').trim();
  if (!isNid(id)) return { ok: false, error: 'a national / iqama id is required (10 digits starting 1 or 2)' };
  const r = await arqami.call('registeredNumbers', { User_ID_Number: id });
  if (!r.ok) return r;
  const list = (r.response && r.response.RegisteredNumbersList) || {};
  const rows = [];
  for (const [kind, arr] of Object.entries(list)) {
    if (!Array.isArray(arr)) continue;
    for (const x of arr) rows.push({
      kind, number: x.MobileNumber || x.FixedNumber || x.Number || null, account: x.AccountNumber || null,
      packageId: x.PackageID || null, packageEn: x.PackageNameEn || null, packageAr: x.PackageNameAr || null,
      outstanding: x.OutstandingBills == null ? null : String(x.OutstandingBills)
    });
  }
  return { ...r, services: rows, serviceCount: rows.length,
    status: r.response && typeof r.response === 'object' ? r.response.Status : null,
    message: r.response && typeof r.response === 'object' ? r.response.Message : null };
}

/* One line for Yusr and for the tab badge: is CST currently on this customer's back? */
function summarise(c) {
  if (!c || !c.ok) return null;
  if (!c.count) return { open: 0, total: 0, line: 'No CST complaint on this customer in ARSystem.' };
  const open = c.complaints.filter(t => t.open);
  const oldest = open.reduce((a, t) => (a == null || (t.ageDays != null && t.ageDays > a)) ? t.ageDays : a, null);
  return {
    open: open.length, total: c.count, oldestOpenDays: oldest,
    latest: c.complaints[0] ? { req: c.complaints[0].req, created: c.complaints[0].created, status: c.complaints[0].status, open: c.complaints[0].open } : null,
    line: open.length
      ? `${open.length} open CST complaint${open.length === 1 ? '' : 's'} of ${c.count}${oldest != null ? `, the oldest open ${oldest} day${oldest === 1 ? '' : 's'}` : ''}.`
      : `${c.count} CST complaint${c.count === 1 ? '' : 's'}, all closed.`
  };
}

module.exports = { configured, servicesAvailable, keysOf, complaints, services, summarise, isNid, digits };
