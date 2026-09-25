/* visitorKey.js — VISITOR identifiers on the Mobile side (25 Sep 2026, the "Nafath issue for visitor customer" thread).
 *
 * A visitor (tourist / Hajj / Umrah / business) has no Saudi national ID or iqama. On the Salam Mobile web / app the
 * onboarding order carries the PASSPORT number in `onboarding_orders.nationality_id_number` (the same column that holds
 * a NID for residents) and the nationality; Nafath "single authentication" is asked with that passport + nationality;
 * Semati / Absher answer with the KSA BORDER NUMBER (رقم الحدود — 10 digits starting 3 or 4, issued at entry) which
 * the platform may store in the eligibility / activation / semati records. Every console search (Subscriber 360, Yusr,
 * Troubleshoot timeline) used to understand MSISDN and 10-digit 1|2 IDs only, so a passport or a border number found
 * nothing. This module classifies a pasted key and resolves a passport / border number to the customer's order and
 * MSISDN, in a bounded way (equality on indexed columns first, a short text scan on recent identity logs last).
 *   classify(key) → { kind: 'msisdn'|'nid'|'iqama'|'border'|'passport'|'uuid'|'other', key }
 *   resolve(key)  → { kind, key, identifier, mobile, nid, order, matched_by, note } | null   (never throws) */
'use strict';
const db = require('./db');

const clean = v => String(v == null ? '' : v).trim().replace(/[\s\-.]/g, '');
function classify(raw) {
  const k = clean(raw); const up = k.toUpperCase();
  if (!k) return { kind: 'other', key: k };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k)) return { kind: 'uuid', key: k };
  if (/^(?:\+?966|0)?5\d{8}$/.test(k)) return { kind: 'msisdn', key: k };
  if (/^1\d{9}$/.test(k)) return { kind: 'nid', key: k };
  if (/^2\d{9}$/.test(k)) return { kind: 'iqama', key: k };
  if (/^[34]\d{9}$/.test(k)) return { kind: 'border', key: k };
  /* passport: 6–12 letters/digits with at least one letter (N01715453, HE3486840, TR2110858) — or 6–9 digits that are
   * neither a phone nor a Saudi ID (146018237 — UK passports are numeric) */
  if (/^(?!INC|TKT|REQ|CHG|RITM|PRB)[A-Z]{1,3}\d{5,10}[A-Z]?$/.test(up)) return { kind: 'passport', key: up };   // N01715453 · HE3486840I · TR2110858 (a CMS checkout code like u1og74v1 is not this shape)
  if (/^\d{6,9}$/.test(k)) return { kind: 'passport', key: k };
  return { kind: 'other', key: k };
}
const isVisitorKey = raw => ['passport', 'border'].includes(classify(raw).kind);

/* which identity tables carry a border-number column on THIS replica — asked once, cached */
let borderCols = null;
async function borderColumns() {
  if (borderCols) return borderCols;
  try {
    const r = await db.source.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (column_name ILIKE '%border%' OR column_name ILIKE '%passport%')
        AND table_name IN ('onboarding_orders','eligibility_logs','activation_logs','nafath_logs','semati_logs','users','checkouts','sim_activation_logs','person_verification_log')`);
    borderCols = r.rows;
  } catch (_) { borderCols = []; }
  const t = setTimeout(() => { borderCols = null; }, 3600e3); if (t.unref) t.unref();
  return borderCols;
}

async function resolve(raw) {
  const c = classify(raw); if (!['passport', 'border'].includes(c.kind)) return null;
  const q = (sql, p) => db.source.query(sql, p).then(r => r.rows, () => []);
  const key = c.key; const notes = [];
  /* 1) the order itself — passports live in nationality_id_number (case-insensitive: the web stores what was typed) */
  let o = (await q(`SELECT id::text, mobile_number, nationality_id_number, created_at, status, flow_type, platform, plan_id
                      FROM onboarding_orders WHERE upper(nationality_id_number) = $1 ORDER BY created_at DESC LIMIT 1`, [key]))[0];
  if (o) return { ...c, identifier: o.nationality_id_number || o.mobile_number, mobile: o.mobile_number, nid: o.nationality_id_number, order: o, matched_by: c.kind === 'border' ? 'border number on the order' : 'passport on the order', note: null };
  /* 2) a dedicated border / passport column on the identity tables */
  for (const col of await borderColumns()) {
    const idCol = col.table_name === 'users' ? 'mobile_number' : col.table_name === 'onboarding_orders' ? 'mobile_number' : 'msisdn';
    const rows = await q(`SELECT ${idCol} AS m, created_at FROM ${col.table_name} WHERE ${col.column_name}::text = $1 ORDER BY created_at DESC LIMIT 1`, [key]).catch(() => []);
    if (rows[0] && rows[0].m) return { ...c, identifier: rows[0].m, mobile: rows[0].m, nid: null, order: null, matched_by: `${col.table_name}.${col.column_name}`, note: null };
  }
  /* 3) last resort, bounded: the identity logs' response text of the last 180 days (Semati / Absher answers carry the
   * border number; Nafath answers echo the passport) — LIMIT 1, newest first */
  const TRIES = [['nafath_logs', 'nationality_id_number AS m, nationality_id_number AS nid', 'response::text ILIKE $1'],
                 ['eligibility_logs', 'msisdn AS m, NULL::text AS nid', '(response::text ILIKE $1 OR request::text ILIKE $1)'],
                 ['activation_logs', 'msisdn AS m, NULL::text AS nid', '(response::text ILIKE $1 OR request::text ILIKE $1)']];
  for (const [t, sel, cond] of TRIES) {
    const rows = await q(`SELECT ${sel}, created_at FROM ${t} WHERE created_at >= now() - interval '180 days' AND ${cond} ORDER BY created_at DESC LIMIT 1`, ['%' + key + '%']);
    if (rows[0] && rows[0].m) { notes.push(`found in ${t} (response text, last 180 days)`); return { ...c, identifier: rows[0].nid || rows[0].m, mobile: rows[0].m, nid: rows[0].nid, order: null, matched_by: `${t} · response text`, note: notes.join(' · ') }; }
  }
  return { ...c, identifier: null, mobile: null, nid: null, order: null, matched_by: null, note: `no order, identity log or border-number column matches ${c.kind} ${key}` };
}

/* THE SELECTED NUMBER (25 Sep 2026): before activation the customer's new MSISDN exists only on the order — the admin
 * panel's "Number" column — while `mobile_number` is the CONTACT number. Which column holds it differs by deployment,
 * so it is discovered once from the catalogue among the usual names; every console lookup ORs it in. */
let numCols = null;
async function orderNumberColumns() {
  if (numCols) return numCols;
  const CANDIDATES = ['msisdn', 'number', 'selected_number', 'selected_msisdn', 'phone_number', 'new_msisdn', 'chosen_number', 'sim_msisdn', 'mobile_no', 'assigned_number', 'reserved_number'];
  try {
    const r = await db.source.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_orders' AND column_name = ANY($1::text[])`, [CANDIDATES]);
    numCols = r.rows.map(x => x.column_name);
  } catch (_) { numCols = []; }
  const t = setTimeout(() => { numCols = null; }, 3600e3); if (t.unref) t.unref();
  return numCols;
}
/* SQL fragment: "(mobile_number = ANY($n) OR <numcol> = ANY($n) …)" for a msisdn-variants parameter */
async function orderNumberWhere(param) {
  const cols = await orderNumberColumns();
  return '(' + ['mobile_number', ...cols].map(c => `${c}::text = ANY(${param}::text[])`).join(' OR ') + ')';
}
module.exports = { classify, isVisitorKey, resolve, orderNumberColumns, orderNumberWhere };
