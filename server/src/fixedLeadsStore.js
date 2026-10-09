/* fixedLeadsStore.js — the shared core of Fixed › Leads (OCU, 9 Oct 2026): tables, the PII rules, the OCU offer catalogue,
 * the desk settings, the status model and the points. Used by fixedLeads.js (API, console process), fixedLeadsHarvest.js
 * (sources → leads) and fixedLeadsCoach.js (Agent 2, in the salam-agent-incident process).
 *
 * PII, the rule of the console applied to leads:
 *   - names, mobiles and national ids are NEVER stored readable. A lead keeps masks for the list (M••• A•••, 05•••••123),
 *     two salted hashes for matching (a later order by the same person, duplicates, "already a Salam customer"), and:
 *       · nexus / SDA / DashPro leads: nothing else — the number is read LIVE from the source when a member reveals it;
 *       · imported batches (no live source): the row's contact is kept AES-256-GCM encrypted (pii_enc).
 *   - the key: LEADS_PII_KEY (64 hex, set once, never changed). Without it nothing is harvested or imported (the page and
 *     Settings say so) — a lead hashed with another key would never match its person again.
 *   - Agent 2 never receives a name, a number or an id — only the facts (product, step, reason, channel, history). */
'use strict';
const crypto = require('crypto');
const db = require('./db');

const C = () => db.console;
const KSA = 3 * 3600e3;
const n = v => Number(v) || 0;

/* ------------------------------------------------------------------ time (KSA; the week starts on Sunday) */
const ksaDay = (t = Date.now()) => new Date(t + KSA).toISOString().slice(0, 10);
const ksaHour = (t = Date.now()) => new Date(t + KSA).getUTCHours();
function dayStart(t = Date.now()) { const d = new Date(t + KSA); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - KSA); }
function weekStart(t = Date.now()) { const d = new Date(t + KSA); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - d.getUTCDay() * 864e5 - KSA); }

/* ------------------------------------------------------------------ PII */
/* the section's own key, and no fallback: a lead hashed with another key would never match its person again once the key is
 * set, so nothing is harvested or imported until LEADS_PII_KEY is in .env (the page says so) */
function deriveKey() {
  const k = String(process.env.LEADS_PII_KEY || '').trim();
  if (/^[0-9a-f]{64}$/i.test(k)) return Buffer.from(k, 'hex');
  if (k.length >= 32) return crypto.createHash('sha256').update('fixed-leads|' + k).digest();
  return null;
}
const ROOT = deriveKey();
const K_HASH = ROOT ? crypto.createHmac('sha256', ROOT).update('hash').digest() : null;
const K_ENC = ROOT ? crypto.createHmac('sha256', ROOT).update('enc').digest() : null;
const piiReady = () => !!ROOT;
const keySource = () => ROOT ? 'LEADS_PII_KEY' : null;

const normMobile = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); const m = /^(?:00966|966|0)?(5\d{8})$/.exec(d); return m ? m[1] : ''; };
const normNid = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return /^[12]\d{9}$/.test(d) ? d : ''; };
const hash = (kind, v) => (K_HASH && v) ? crypto.createHmac('sha256', K_HASH).update(kind + '|' + v).digest('hex').slice(0, 40) : null;
const maskName = s => { const w = String(s == null ? '' : s).trim().split(/\s+/).filter(Boolean).slice(0, 3); return w.length ? w.map(x => x[0] + '•••').join(' ') : null; };
const maskMobile = m => m ? '0' + m[0] + '•••••' + m.slice(-3) : null;
const nidKind = nid => !nid ? null : nid[0] === '1' ? 'Saudi ID' : 'Iqama';
const maskNid = nid => nid ? nid[0] + '•••••••' + nid.slice(-2) : null;
const dial = m => m ? '0' + m : null;                                   // 05XXXXXXXX — what a member dials
function enc(obj) {
  if (!K_ENC) return null;
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', K_ENC, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function dec(s) {
  if (!K_ENC || !s || !String(s).startsWith('v1:')) return null;
  try { const b = Buffer.from(String(s).slice(3), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', K_ENC, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')); } catch (_) { return null; }
}
/* the identity facts a source gives → what a lead may keep */
function identity({ name, mobile, nid }) {
  const m = normMobile(mobile), i = normNid(nid);
  return { customer_mask: maskName(name), mobile_mask: maskMobile(m), nid_mask: maskNid(i), nid_kind: nidKind(i),
    mobile_hash: hash('m', m), ident_hash: hash('n', i), has_mobile: !!m };
}

/* ------------------------------------------------------------------ the OCU offer (MSD "OCU Offer – FTTH" v1.2) */
const OFFER_SOURCE = 'OCU Offer – FTTH, MSD v1.2 (effective 20 Jul 2026) · live on SDA since 31 Aug 2026';
const OFFERS_DEFAULT = [
  { code: 'STD', product: 'any', step: 1, label: 'Salam standard plans first', detail: 'Pitch the plan that fits — Salam Fiber 300 · 500 · 1000 or 5G HomeFi — at its normal price. The OCU discount is only for a customer who is not interested in the standard plans.' },
  { code: 'OCU-F500-3', product: 'ftth', step: 2, label: 'Salam Fiber 500 · 180 SAR for 3 months', speed: '500 / 200 Mbps', ott: 'YouTube Premium · Viu', price: 360, offer: 180, months: 3, contract: 12 },
  { code: 'OCU-F300-4', product: 'ftth', step: 2, label: 'Salam Fiber 300 · 145 SAR for 4 months', speed: '300 / 100 Mbps', ott: '— (Viu only on digital)', price: 290, offer: 145, months: 4, contract: 12 },
  { code: 'OCU-F300-6', product: 'ftth', step: 3, label: 'Salam Fiber 300 · 145 SAR for 6 months', speed: '300 / 100 Mbps', ott: '— (Viu only on digital)', price: 290, offer: 145, months: 6, contract: 12, detail: 'Only after the 4-month offer was declined — the discount grows gradually.' },
];
const OFFER_RULES = [
  'New acquisition only — the customer has no Salam fiber line yet.',
  'Standard Salam plans first; the OCU discount only when the customer is not interested in them.',
  'Shortest discount first, a longer one only if it is declined (Fiber 300: 4 months, then 6).',
  'Placed on SDA by the OCU accounts (OCU_001 – OCU_003); the offer name field stays empty.',
  '12-month contract. Landline benefits and every other FTTH rule (termination, relocation, suspension, freezing) unchanged.',
  'No OCU discount for 5G — pitch the standard 5G HomeFi plans.',
];
const offerOf = (desk, code) => (desk.offers || OFFERS_DEFAULT).find(o => o.code === code) || null;

/* ------------------------------------------------------------------ desk settings (console_settings 'leads_desk') */
const TERMS_DEFAULT = { version: '2026-10-09b', title: 'Restricted section — customer leads', points: [
  "These leads are Salam's commercial fuel: customers who chose us and did not finish. Every name and number here is confidential.",
  'Use them only to contact the customer about Salam offers, from your Salam workstation.',
  'Do not copy, export, photograph, print or forward a lead, a number or a list — inside or outside Salam.',
  'Names and numbers stay masked until you reveal one lead or unmask a page you are allowed to — only for a few minutes, only for the leads you work. Every view, reveal, unmask and action is recorded with your name, the time and your device.',
  'Unusual access — many reveals or unmasks, leads outside your queue — is flagged to the console owners.',
] };
const DESK_DEFAULT = {
  supervisors: [],                       // OCU team leads: assign, import, challenges (super admins always can)
  staffCodes: {},                        // member e-mail → SDA account (OCU_001 …): an SDA order by that account credits the member
  sources: { epurchase: true, salamhome: true, sda: true, sda_promoter: true, dashpro: true, qr: false },
  products: { ftth: true, '5g': true },
  /* a journey with no number of its own takes the logged-in account's (nexus users.phone_number via workflow_states.user_id) —
   * per product (alpha.173): on for 5G (most web / app 5G journeys stop at the location step before the customer types a
   * number), off for FTTH until the desk wants the extra volume (≈ 9,000 FTTH journeys in 14 days have no number of their own) */
  accountContact: { '5g': true, ftth: false },
  minAgeHours: 3, lookbackDays: 30, staleLeadDays: 3,
  promoterNew: false,                     // promoter leads still NEW after staleLeadDays — off: tens of thousands of captures nobody updates (alpha.167)
  leadMaxAgeDays: 14,                     // a journey older than this feeds the person's history (30 days back) but is not a new lead
  expireDays: 21,                         // a lead nobody called is closed after this many days on the desk (lost · expired, can be reopened)
  slaFirstContactMin: 120, maxOpenPerMember: 60,
  revealPerHour: 40, revealPerDay: 150,
  /* unmask a page (alpha.168): who — 'members' (supervisors on any list, members on their own leads) · 'supervisors' · 'off';
   * for how many minutes; how many leads a person may unmask a day (super admins: audited, not capped) */
  unmaskWho: 'members', unmaskMinutes: 10, unmaskPerDay: 600,
  digest: { on: true, hours: [10, 14, 17, 20] },
  targets: { dailyWins: 2, weeklyWins: 10 },
  points: { contact: 1, fast: 2, interested: 3, offer: 2, won: 10, won_std: 15 },
  attributionDays: 14,
  convLookbackDays: 45,                   // conversions (alpha.174): how far back the first pass reads completed orders to match the desk's leads
  offers: null, terms: null,
};
let deskCache = { at: 0, v: null };
async function getDesk(force) {
  if (!force && deskCache.v && Date.now() - deskCache.at < 30e3) return deskCache.v;
  let s = {}; try { const r = await C().query(`SELECT value FROM console_settings WHERE key='leads_desk'`); if (r.rowCount && r.rows[0].value) s = r.rows[0].value; } catch (_) {}
  const v = { ...DESK_DEFAULT, ...s, sources: { ...DESK_DEFAULT.sources, ...(s.sources || {}) }, products: { ...DESK_DEFAULT.products, ...(s.products || {}) }, accountContact: { ...DESK_DEFAULT.accountContact, ...(s.accountContact || {}) },
    digest: { ...DESK_DEFAULT.digest, ...(s.digest || {}) }, targets: { ...DESK_DEFAULT.targets, ...(s.targets || {}) }, points: { ...DESK_DEFAULT.points, ...(s.points || {}) } };
  v.supervisors = (Array.isArray(v.supervisors) ? v.supervisors : []).map(e => String(e).toLowerCase().trim()).filter(Boolean);
  v.offers = Array.isArray(s.offers) && s.offers.length ? s.offers : OFFERS_DEFAULT;
  v.terms = s.terms && Array.isArray(s.terms.points) && s.terms.points.length ? { ...TERMS_DEFAULT, ...s.terms } : TERMS_DEFAULT;
  deskCache = { at: Date.now(), v }; return v;
}
async function setDesk(patch) {
  const cur = (await (async () => { try { const r = await C().query(`SELECT value FROM console_settings WHERE key='leads_desk'`); return r.rowCount ? r.rows[0].value || {} : {}; } catch (_) { return {}; } })());
  const next = { ...cur, ...patch };
  await C().query(`INSERT INTO console_settings (key, value) VALUES ('leads_desk', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(next)]);
  deskCache = { at: 0, v: null }; return getDesk(true);
}

/* ------------------------------------------------------------------ statuses, outcomes, points */
const OPEN = ['new', 'assigned', 'contacted', 'callback', 'interested', 'offer'];
const CLOSED = ['won', 'lost', 'unreachable', 'dnc', 'duplicate'];
const STATUS_LABEL = { new: 'New', assigned: 'Assigned', contacted: 'Contacted', callback: 'Call back', interested: 'Interested', offer: 'Offer made',
  won: 'Won', lost: 'Lost', unreachable: 'Unreachable', dnc: 'Do not call', duplicate: 'Duplicate' };
const RESULTS = {
  no_answer:      { label: 'No answer', contact: false },
  busy:           { label: 'Busy / rejected the call', contact: false },
  callback:       { label: 'Asked to call back', contact: true, status: 'callback' },
  interested:     { label: 'Interested', contact: true, status: 'interested' },
  offer_made:     { label: 'Offer made', contact: true, status: 'offer' },
  won:            { label: 'Order placed', contact: true, status: 'won' },
  not_interested: { label: 'Not interested', contact: true, status: 'lost' },
  ordered_elsewhere: { label: 'Already ordered elsewhere', contact: true, status: 'lost' },
  wrong_number:   { label: 'Wrong number', contact: false, status: 'unreachable' },
  dnc:            { label: 'Do not call me', contact: true, status: 'dnc' },
};
const LOST_REASONS = ['Price', 'Already with another provider', 'No longer needs it', 'Installation timing', 'Coverage / technical', 'Bad experience during the journey', 'Moving / address change', 'Other'];

/* ------------------------------------------------------------------ why a journey stopped (human words + a class Agent 2 learns on) */
const STEP_WORDS = {
  ePurchaseCustomerProfile: 'left at the first step (customer profile)', customerProfile: 'left at the customer profile', businessCustomerProfile: 'left at the business profile',
  ePurchaseFeasibilityCheck: 'stopped at the coverage check (ODB)', feasibilityCheck: 'stopped at the coverage check (ODB)', promotersFeasibilityCheck: 'stopped at the coverage check',
  ePurchaseGeoFeasibilityCheck: 'stopped at the location / device stock step', geoFeasibilityCheck: 'stopped at the location check',
  selectAppointment: 'no installation appointment was taken', createCustomer: 'stopped while creating the customer',
  ePurchaseNafathCheck: 'did not finish Nafath / Semati', nafathCheck: 'did not finish Nafath / Semati',
  ePurchaseOrderSummary: 'left at the order summary (after seeing the price)', ePurchasePayment: 'stopped at payment', jarirPayment: 'stopped at payment',
  ePurchaseCustomerProfileVerification: 'stopped at the identity verification', ePurchaseConfirmOtp: 'did not confirm the OTP', confirmOtp: 'did not confirm the OTP', promotersConfirmOtp: 'did not confirm the OTP',
  ePurchaseSubmitOrder: 'stopped while submitting the order', submitOrder: 'stopped while submitting the order',
  iccidInfo: 'stopped at the SIM / device step', iccidInfoSalamNetwork: 'stopped at the SIM / device step',
};
function classify({ step, err, invoice, nafath, dealerValidation, kind }) {
  const e = String(err || '').toUpperCase(), s = String(step || ''), inv = String(invoice || '').toUpperCase(), nf = String(nafath || '').toUpperCase();
  if (kind === 'lead_rejected') return { cls: 'lead_rejected', text: 'promoter lead rejected by the dealer' };
  if (kind === 'lead_stale') return { cls: 'lead_stale', text: 'promoter lead never picked up by a dealer' };
  if (kind === 'import') return { cls: 'campaign', text: 'imported list' };
  if (/FEASIB|NO_COVERAGE|NO_PORT/.test(e)) return { cls: 'coverage', text: 'no coverage / no free port reported at the address' };
  if (/SIM_NOT_AVAILABLE|STOCK|LOCK/.test(e)) return { cls: 'stock', text: 'no device / SIM available at that moment' };
  if (/APPOINT/.test(e) || s === 'selectAppointment') return { cls: 'appointment', text: 'no installation slot suited the customer' };
  if (/PAYMENT|CARD|INVOICE/.test(e) || ['AUTHORIZED', 'VOIDED', 'FAILED', 'DECLINED', 'CANCELLED', 'EXPIRED'].includes(inv) || /Payment$/.test(s)) return { cls: 'payment', text: inv ? `stopped at payment (card ${inv.toLowerCase()})` : 'stopped at payment' };
  if (/NAFATH|SEMATI|YAKEEN|ABSHER/.test(e) || /REJECT|TIMEOUT|FAIL|EXPIRED/.test(nf) || /Nafath/i.test(s)) return { cls: 'identity', text: 'did not finish the identity step (Nafath / Semati)' };
  if (/DENIED/.test(String(dealerValidation || '').toUpperCase())) return { cls: 'identity', text: 'Manafith validation denied' };
  if (/OrderSummary$/.test(s)) return { cls: 'price', text: STEP_WORDS[s] };
  if (/ConfirmOtp$|^confirmOtp$/.test(s)) return { cls: 'otp', text: STEP_WORDS[s] || 'did not confirm the OTP' };
  if (/FeasibilityCheck$/.test(s)) return { cls: 'coverage', text: STEP_WORDS[s] || 'stopped at the coverage check' };
  if (/CustomerProfile$|^customerProfile$/.test(s)) return { cls: 'early', text: STEP_WORDS[s] || 'left at the first steps' };
  return { cls: 'abandoned', text: STEP_WORDS[s] || (s ? 'stopped at ' + s.replace(/^(ePurchase|promoters)/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : 'did not finish') };
}
const REASON_LABEL = { coverage: 'Coverage', stock: 'Device / SIM stock', appointment: 'Appointment', payment: 'Payment', identity: 'Identity (Nafath)', price: 'Price seen', otp: 'OTP', early: 'Left early',
  abandoned: 'Abandoned', lead_rejected: 'Lead rejected', lead_stale: 'Lead not picked up', campaign: 'Imported list', rejected_install: 'Rejected installation' };
const SOURCE_LABEL = { epurchase: 'Website (e-purchase)', salamhome: 'Salam Home app', sda: 'SDA dealer journey', sda_promoter: 'SDA promoter lead', qr: 'QR code (dealer)', dashpro: 'DashPro web lead', import: 'Imported batch' };

/* the table's short channel names (the long ones above stay for the drawer and the filters' titles) */
const SOURCE_SHORT = { epurchase: 'Website', salamhome: 'Salam Home app', sda: 'SDA dealer', sda_promoter: 'SDA promoter', qr: 'QR code', dashpro: 'DashPro', import: 'Imported' };
/* Type of line (alpha.168): from the journey's workflow first — the same mapping as Fixed › Errors (FIXED-ERRORS-CHANNELS.md) —,
 * then the plan catalogue, then the plan's name, then the product */
const SVC_LABEL = { ftth: 'FTTH', fttb: 'FTTB', '5g_homefi': '5G HomeFi', '5g_fwa': '5G FWA', '5g': '5G' };
const PTYPE_LABEL = { postpaid: 'Postpaid', prepaid: 'Prepaid' };
/* Fixed plan catalogue, from the nexus source (packages/api clients/plans.ts and e-purchase-plans.ts, apps e-purchase · SDA · Salam Home;
 * snapshot of June 2026): id → [name, 'post' | 'pre', type]. nexus keeps only the id on a journey, so this names it; the plan type of a
 * journey comes from nexus itself (workflow_states.plan_type) and this table types the rest (imports, journeys nexus no longer holds).
 * Left out on purpose: 5302 · 5206 · 5003 (UAT ids in the SDA app, another plan in the BSS list), 5112 (two names), voice add-ons.
 * An id missing here shows as "Plan <id>" until it is added. */
const PLANS = {
  10801: ['Salam Fiber Postpaid Open 300', 'post', 'ftth'], 10810: ['Salam Fiber Postpaid Open 300 Bundle', 'post', 'ftth'],
  13603: ['Social Responsibility Postpaid 300 Open', 'post', 'ftth'], 13604: ['Social Responsibility Postpaid 300 Open Bundle', 'post', 'ftth'],
  17002: ['Salam Fiber 300 Brown', 'post', 'ftth'], 18401: ['Salam Fiber Postpaid 300 A', 'post', 'ftth'], 18403: ['Salam Fiber Postpaid 300 A Bundle', 'post', 'ftth'],
  16202: ['Salam Fiber Postpaid Open 100', 'post', 'ftth'], 12402: ['FTTHR Fiber 300Mbps PostPaid Open', 'post', 'ftth'],
  11201: ['500 Mbps Streaming Postpaid Open', 'post', 'ftth'], 11301: ['500 Mbps Streaming Postpaid Open Bundle', 'post', 'ftth'],
  11303: ['500 Mbps Gaming Postpaid Open', 'post', 'ftth'], 11402: ['500 Mbps Gaming Postpaid Open Bundle', 'post', 'ftth'],
  12601: ['FTTHR Fiber 500Mbps PostPaid Open', 'post', 'ftth'], 10204: ['Salam Fiber Postpaid Open 1000', 'post', 'ftth'],
  10205: ['Salam Fiber Postpaid 1000 Bundle Open', 'post', 'ftth'], 12602: ['FTTHR Fiber 1000Mbps PostPaid Open', 'post', 'ftth'],
  12607: ['FTTHR Fiber 1000Mbps PostPaid Bundle Open', 'post', 'ftth'], 18203: ['GOSI 300Mbps', 'post', 'ftth'], 18406: ['GOSI 500Mbps', 'post', 'ftth'],
  11001: ['Salam Fiber Prepaid Open 300', 'pre', 'ftth'], 11101: ['500 Mbps Streaming Prepaid Open', 'pre', 'ftth'], 10203: ['Salam Fiber Prepaid Open 1000', 'pre', 'ftth'],
  3104: ['Salam Fiber Prepaid Open 500', 'pre', 'ftth'],
  9107: ['Express Fiber Open 100 FTTB', 'post', 'fttb'], 9108: ['Express Fiber Open 240 FTTB', 'post', 'fttb'], 13701: ['Express Fiber Open 300 FTTB', 'post', 'fttb'],
  9109: ['Express Fiber Open 500 FTTB', 'post', 'fttb'], 9113: ['Express Fiber 100 Bundle Open', 'post', 'fttb'], 9114: ['Express Fiber 240 Bundle Open', 'post', 'fttb'],
  9115: ['Express Fiber 500 Bundle Open', 'post', 'fttb'],
  12801: ['5G HomeFi 140 Mbps', 'post', '5g_homefi'], 16702: ['5G HomeFi 140', 'post', '5g_homefi'], 15703: ['5G HomeFi 200 Mbps', 'post', '5g_homefi'],
  16402: ['5G HomeFi 200 Mbps 12M', 'pre', '5g_homefi'], 16104: ['5G HomeFi 12 months', 'pre', '5g_homefi'], 10502: ['Salam 5G HomeFi MAX', 'post', '5g_homefi'],
  5901: ['Limited 5G FWA 250Mbps', 'post', '5g_fwa'], 7701: ['Salam 5G FWA', 'post', '5g_fwa'], 5802: ['Unlimited 5G FWA', 'post', '5g_fwa'], 5703: ['Unlimited 5G FWA', 'post', '5g_fwa'],
  7501: ['5G Platinum', 'post', '5g'],
  /* plans of existing Salam Home customers (BSS) — they reach a lead through a relocation, a renewal or an imported list */
  605: ['Unlimited Fiber 30', 'pre', 'ftth'], 606: ['New Unlimited Fiber 300', 'pre', 'ftth'], 607: ['Unlimited Fiber 300', 'pre', 'ftth'], 1502: ['Unlimited Fiber 60 Advanced', 'pre', 'ftth'],
  1801: ['Unlimited Fiber 60 Employee', 'pre', 'ftth'], 1802: ['Unlimited Fiber 300 Employee', 'pre', 'ftth'], 1902: ['New Salam Fiber Prepaid 500', 'pre', 'ftth'],
  2701: ['Unlimited Fiber 240 Bundle', 'pre', 'ftth'], 3001: ['Unlimited Fiber 500 Plus Mbps', 'pre', 'ftth'], 3101: ['Salam Fiber Prepaid Open 100', 'pre', 'ftth'],
  3103: ['Salam Fiber Prepaid Open 240', 'pre', 'ftth'], 3301: ['Salam Fiber Prepaid 300', 'pre', 'ftth'], 3402: ['Salam Fiber Prepaid 500', 'pre', 'ftth'],
  3701: ['Fiber 300 Retention', 'pre', 'ftth'], 3902: ['Fiber 500 Retention', 'pre', 'ftth'], 4903: ['Salam Fiber Prepaid 1000', 'pre', 'ftth'], 11901: ['500 Mbps Streaming Prepaid', 'pre', 'ftth'],
  4103: ['Salam Fiber Postpaid 300', 'post', 'ftth'], 4104: ['Salam Fiber 500 Postpaid', 'post', 'ftth'], 4105: ['Salam Fiber Postpaid 500', 'post', 'ftth'],
  4109: ['Salam Fiber Postpaid Open 100', 'post', 'ftth'], 4110: ['Salam Fiber Postpaid Open 240', 'post', 'ftth'], 4111: ['Salam Fiber Postpaid Open 500', 'post', 'ftth'],
  4407: ['Salam Fiber Postpaid 300 Employee', 'post', 'ftth'], 4408: ['New Salam Fiber Postpaid 300 Employee', 'post', 'ftth'], 4409: ['Salam Fiber Postpaid 500', 'post', 'ftth'],
  4410: ['Salam Fiber Postpaid Open 100 Employee', 'post', 'ftth'], 4802: ['Unlimited Fiber 300 PostPaid', 'post', 'ftth'], 4904: ['Salam Fiber Postpaid 1000', 'post', 'ftth'],
  5102: ['Salam Fiber Postpaid 300', 'post', 'ftth'], 5104: ['New Salam Fiber 500 Postpaid', 'post', 'ftth'], 5106: ['Salam Fiber Postpaid Open 100', 'post', 'ftth'],
  5110: ['Salam Fiber Postpaid Open 240', 'post', 'ftth'], 5111: ['New Salam Fiber Postpaid 500', 'post', 'ftth'], 6101: ['New Gaming Postpaid 500', 'post', 'ftth'],
  6903: ['ARPU 500 Postpaid', 'post', 'ftth'], 9601: ['100 Mbps FTTH for ADSL customers', 'post', 'ftth'], 9602: ['100 Mbps FTTH for ADSL customers Open', 'post', 'ftth'],
  10201: ['Gaming Postpaid Open 300', 'post', 'ftth'], 11501: ['Salam Fiber Postpaid Open 300 Employee', 'post', 'ftth'], 11601: ['Gaming Postpaid 500', 'post', 'ftth'],
  11801: ['500 Mbps Streaming Postpaid', 'post', 'ftth'], 12301: ['Salam Tamkeen 100Mbps', 'post', 'ftth'], 12302: ['Salam Tamkeen 500Mbps', 'post', 'ftth'],
  12303: ['Salam Tamkeen 240Mbps', 'post', 'ftth'], 13301: ['100 Mbps Over TLS', 'post', 'ftth'],
};
const planOf = id => { const k = String(id == null ? '' : id).trim(); return /^\d{1,6}$/.test(k) ? PLANS[k] || null : null; };
function svcType(workflow, planId, planText, product) {
  const w = String(workflow || '');
  if (w === 'fiveGFWA') return '5g_fwa';
  if (['fiveGWhiteLabel', 'ePurchase5GWhiteLabel', 'salamHomeRelocationWL', 'salamHomeRelocationOwn'].includes(w)) return '5g_homefi';
  if (w === 'fttb') return 'fttb';
  if (['ftth', 'ePurchaseFTTH', 'salamHomeRelocationFTTH'].includes(w)) return 'ftth';
  const c = planOf(planId); if (c) return c[2];
  const p = String(planText || '');
  if (/fwa/i.test(p)) return '5g_fwa'; if (/home ?fi/i.test(p)) return '5g_homefi'; if (/fttb|express fiber/i.test(p)) return 'fttb';
  return product === '5g' || /\b5g\b/i.test(p) ? '5g' : 'ftth';
}
/* → { v: 'prepaid' | 'postpaid' | null, src: 'nexus' | 'catalogue' | 'name' | null } */
function planTypeOf(nexusType, planId, planText) {
  const t = String(nexusType || '').toUpperCase();
  if (t === 'PRE_PAID') return { v: 'prepaid', src: 'nexus' }; if (t === 'POST_PAID') return { v: 'postpaid', src: 'nexus' };
  const c = planOf(planId); if (c) return { v: c[1] === 'pre' ? 'prepaid' : 'postpaid', src: 'catalogue' };
  const p = String(planText || '');
  if (/pre-?paid|مسبق/i.test(p)) return { v: 'prepaid', src: 'name' }; if (/post-?paid|مفوتر/i.test(p)) return { v: 'postpaid', src: 'name' };
  return { v: null, src: null };
}
function planLabel(planId, planText, product) {
  const c = planOf(planId); if (c) return c[0];
  const p = String(planText || planId || '').trim(); if (!p) return product === '5g' ? '5G HomeFi' : 'Salam Fiber';
  if (/^\d{1,6}$/.test(p)) return 'Plan ' + p;
  const f = /fiber[-_ ]?(\d{3,4})/i.exec(p); if (f) return `Salam Fiber ${f[1]}`;
  if (/5g/i.test(p)) { if (/fwa/i.test(p)) return '5G FWA'; const m = /(\d{3})/.exec(p); return /max/i.test(p) ? '5G HomeFi Max' : m ? `5G HomeFi ${m[1]}` : '5G HomeFi'; }
  return p.length > 40 ? p.slice(0, 40) + '…' : p;
}

/* ------------------------------------------------------------------ schema */
let ensured = null;
function ensure() {
  if (ensured) return ensured;
  ensured = (async () => {
    const q = s => C().query(s);
    await q(`CREATE TABLE IF NOT EXISTS fixed_leads (
      id bigserial PRIMARY KEY, source text NOT NULL, source_ref text NOT NULL, product text NOT NULL DEFAULT 'ftth', workflow text, plan_id text, plan_label text,
      channel text, dealer text, region text, city text, step text, step_label text, reason text, reason_class text,
      customer_mask text, mobile_mask text, nid_mask text, nid_kind text, ident_hash text, mobile_hash text, pii_enc text, has_mobile boolean NOT NULL DEFAULT true,
      relation jsonb NOT NULL DEFAULT '{}'::jsonb, facts jsonb NOT NULL DEFAULT '{}'::jsonb,
      occurred_at timestamptz NOT NULL, stopped_at timestamptz,
      status text NOT NULL DEFAULT 'new', assignee text, assigned_at timestamptz, assigned_by text, batch_id bigint,
      priority int NOT NULL DEFAULT 0, score int, temp text, next_action_at timestamptz, attempts int NOT NULL DEFAULT 0,
      first_contact_at timestamptz, last_contact_at timestamptz, offer_code text, offer_months int, remark text,
      won_at timestamptz, won_ref text, won_auto boolean NOT NULL DEFAULT false, won_by text, lost_reason text, closed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (source, source_ref))`);
    await q(`ALTER TABLE fixed_leads ADD COLUMN IF NOT EXISTS svc_type text`);    // alpha.168: FTTH · FTTB · 5G HomeFi · 5G FWA
    await q(`ALTER TABLE fixed_leads ADD COLUMN IF NOT EXISTS plan_type text`);   // alpha.168: postpaid · prepaid
    await q(`CREATE INDEX IF NOT EXISTS fixed_leads_status_idx ON fixed_leads (status, assignee)`);
    await q(`CREATE INDEX IF NOT EXISTS fixed_leads_next_idx ON fixed_leads (assignee, next_action_at)`);
    await q(`CREATE INDEX IF NOT EXISTS fixed_leads_occ_idx ON fixed_leads (occurred_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS fixed_leads_ident_idx ON fixed_leads (ident_hash) WHERE ident_hash IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS fixed_leads_mobile_idx ON fixed_leads (mobile_hash) WHERE mobile_hash IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS fixed_leads_batch_idx ON fixed_leads (batch_id) WHERE batch_id IS NOT NULL`);
    await q(`CREATE TABLE IF NOT EXISTS fixed_lead_events (id bigserial PRIMARY KEY, lead_id bigint NOT NULL, at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL,
      kind text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb, points int NOT NULL DEFAULT 0)`);
    await q(`CREATE INDEX IF NOT EXISTS fixed_lead_events_lead_idx ON fixed_lead_events (lead_id, at)`);
    await q(`CREATE INDEX IF NOT EXISTS fixed_lead_events_actor_idx ON fixed_lead_events (actor, at)`);
    await q(`CREATE INDEX IF NOT EXISTS fixed_lead_events_kind_idx ON fixed_lead_events (kind, at)`);
    await q(`CREATE TABLE IF NOT EXISTS fixed_lead_batches (id bigserial PRIMARY KEY, name text NOT NULL, kind text NOT NULL DEFAULT 'import', source text,
      created_by text, created_at timestamptz NOT NULL DEFAULT now(), rows int NOT NULL DEFAULT 0, accepted int NOT NULL DEFAULT 0, duplicates int NOT NULL DEFAULT 0,
      rejected int NOT NULL DEFAULT 0, note text, detail jsonb NOT NULL DEFAULT '{}'::jsonb)`);
    await q(`CREATE TABLE IF NOT EXISTS fixed_lead_accept (id bigserial PRIMARY KEY, email text NOT NULL, day date NOT NULL, version text NOT NULL,
      accepted_at timestamptz NOT NULL DEFAULT now(), ip text, ua text, UNIQUE (email, day, version))`);
    await q(`CREATE TABLE IF NOT EXISTS fixed_lead_advice (lead_id bigint PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), model text, deterministic boolean NOT NULL DEFAULT true,
      ms int, score int, temp text, offer_code text, offer_months int, opener_en text, opener_ar text, points jsonb NOT NULL DEFAULT '[]'::jsonb,
      objections jsonb NOT NULL DEFAULT '[]'::jsonb, path jsonb NOT NULL DEFAULT '[]'::jsonb, best_time text, next_action text, why text, sig text, helpful boolean, feedback_by text, feedback_at timestamptz, attempts int NOT NULL DEFAULT 0)`);
    await q(`CREATE TABLE IF NOT EXISTS fixed_lead_challenges (id bigserial PRIMARY KEY, title text NOT NULL, metric text NOT NULL, target int NOT NULL, scope text NOT NULL DEFAULT 'team',
      period text NOT NULL DEFAULT 'week', reward text, active boolean NOT NULL DEFAULT true, starts_at timestamptz, ends_at timestamptz, created_by text, created_at timestamptz NOT NULL DEFAULT now())`);
    /* every Fixed journey the harvester looked at, by its nexus id, with the person's two hashes only (no PII): the customer's
     * history on a lead ("2 journeys, 1 order in 2025"), the "bought anyway" check and the automatic Won all read it */
    await q(`CREATE TABLE IF NOT EXISTS fixed_lead_journeys (ref text PRIMARY KEY, source text, product text, ident_hash text, mobile_hash text, started_at timestamptz,
      completed boolean NOT NULL DEFAULT false, completed_at timestamptz, order_ref text, staff_code text, step text, lead_id bigint, seen_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS fixed_lead_journeys_ident_idx ON fixed_lead_journeys (ident_hash) WHERE ident_hash IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS fixed_lead_journeys_mobile_idx ON fixed_lead_journeys (mobile_hash) WHERE mobile_hash IS NOT NULL`);
    await q(`CREATE TABLE IF NOT EXISTS agent_runs (id bigserial PRIMARY KEY, agent text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, ok boolean, stats jsonb NOT NULL DEFAULT '{}', error text)`);
    if (!process.env.LEADS_NO_NORMALIZE) await normalize().catch(e => console.log('[leads] normalize', e.message));   // the check script stays read-only
  })().catch(e => { ensured = null; throw e; });
  return ensured;
}
/* leads written before alpha.168: the type of line, the plan's name in place of its id, the plan type from the catalogue (the harvest then
 * confirms it from the lead's own journey in nexus — fixedLeadsHarvest.backfill). Idempotent; touches only what changes. */
async function normalize() {
  const r = await C().query(`SELECT id, source, product, workflow, plan_id, plan_label, plan_type, svc_type FROM fixed_leads
      WHERE svc_type IS NULL OR (plan_type IS NULL AND coalesce(facts->>'pt', '') = '') OR plan_label ~ '^(Plan )?[0-9]+$' ORDER BY id DESC LIMIT 50000`);
  const out = [];
  for (const L of r.rows) {
    const x = { id: L.id };
    const svc = L.svc_type || svcType(L.workflow, L.plan_id, L.plan_label, L.product); if (svc !== L.svc_type) x.svc = svc;
    /* promoter leads were all filed as fiber before alpha.168 — their plan id tells 5G apart */
    if (L.source === 'sda_promoter' && /^5g/.test(svc) && L.product !== '5g') x.product = '5g';
    if (/^(Plan )?\d+$/.test(String(L.plan_label || ''))) { const nm = planLabel(L.plan_id || String(L.plan_label).replace(/^Plan /, ''), null, L.product); if (nm !== L.plan_label) x.label = nm; }
    if (!L.plan_type) { const t = planTypeOf(null, L.plan_id, x.label || L.plan_label); if (t.v) { x.pt = t.v; x.src = t.src; } else x.src = 'none'; }
    if (x.svc || x.label || x.pt || x.src || x.product) out.push(x);
  }
  for (let i = 0; i < out.length; i += 1000) {
    await C().query(`UPDATE fixed_leads l SET svc_type = coalesce(x.svc, l.svc_type), plan_label = coalesce(x.label, l.plan_label), plan_type = coalesce(x.pt, l.plan_type), product = coalesce(x.product, l.product),
        facts = CASE WHEN x.src IS NULL OR coalesce(l.facts->>'pt', '') <> '' THEN l.facts ELSE jsonb_set(l.facts, '{pt}', to_jsonb(x.src)) END
      FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, svc text, label text, pt text, src text, product text) WHERE l.id = x.id`, [JSON.stringify(out.slice(i, i + 1000))]);
  }
  if (out.length) console.log(`[leads] normalize: ${out.length} lead(s) given a type / plan name / plan type`);
  return out.length;
}

async function event(leadId, actor, kind, detail, points) {
  try { await C().query(`INSERT INTO fixed_lead_events (lead_id, actor, kind, detail, points) VALUES ($1,$2,$3,$4,$5)`, [leadId, actor || 'system', kind, JSON.stringify(detail || {}), n(points)]); } catch (_) {}
}
/* the OCU members: every enabled console user holding the ocu role, plus the supervisors named on the desk */
async function members() {
  const desk = await getDesk();
  let rows = []; try { rows = (await C().query(`SELECT lower(email) AS email, coalesce(name, '') AS name, enabled FROM console_users WHERE enabled AND (role = 'ocu' OR 'ocu' = ANY(roles)) ORDER BY name, email`)).rows; } catch (_) {}
  const out = rows.map(r => ({ email: r.email, name: r.name || r.email.split('@')[0], supervisor: desk.supervisors.includes(r.email) }));
  for (const s of desk.supervisors) if (!out.find(m => m.email === s)) {
    let name = s.split('@')[0]; try { const r = await C().query(`SELECT name FROM console_users WHERE lower(email) = $1`, [s]); if (r.rowCount && r.rows[0].name) name = r.rows[0].name; } catch (_) {}
    out.push({ email: s, name, supervisor: true, notOcu: true });
  }
  return out;
}
const firstName = (name, email) => String(name || String(email || '').split('@')[0]).split(/\s+/)[0];

module.exports = {
  C, KSA, n, ksaDay, ksaHour, dayStart, weekStart,
  piiReady, keySource, normMobile, normNid, hash, maskName, maskMobile, maskNid, nidKind, dial, enc, dec, identity,
  OFFER_SOURCE, OFFERS_DEFAULT, OFFER_RULES, offerOf, TERMS_DEFAULT, DESK_DEFAULT, getDesk, setDesk,
  OPEN, CLOSED, STATUS_LABEL, RESULTS, LOST_REASONS, classify, REASON_LABEL, SOURCE_LABEL, SOURCE_SHORT, SVC_LABEL, PTYPE_LABEL, PLANS, planOf, planLabel, svcType, planTypeOf, normalize,
  ensure, event, members, firstName,
};
