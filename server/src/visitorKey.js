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
  let o = (await q(`SELECT id::text, mobile_number, nationality_id_number, created_at, status, flow_type, activated_platform, plan_id
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

/* THE SELECTED NUMBER (25 Sep 2026): before activation the customer's new MSISDN is the admin panel's "Number" column,
 * while onboarding_orders.mobile_number is the CONTACT number. On this replica onboarding_orders has NO number column of
 * its own (verified 25 Sep: none of msisdn/number/selected_number/… exist), so the number lives in a related row. Its
 * home is discovered once from the catalogue and cached 1 h:
 *   - child tables that point at the order (onboarding_order_id / order_id) or at its checkout (checkout_id) and carry a
 *     number-like column (msisdn, number, mobile_number, phone_number …)
 *   - the parent rows the order points at (checkout_id → checkouts, …) when they carry a number-like column
 *   - the polymorphic `orderable` (orderable_type 'Msisdn' → table msisdns …) when it carries a number-like column
 *   - the order's `extra` json (bounded to the last 180 days — it is a text scan)
 * orderNumberWhere(param) returns one SQL fragment on onboarding_orders that ORs all of them; a discovery failure falls
 * back to the contact number alone so no console lookup ever breaks because of it. */
const NUM_COL = /(^|_)(msisdn|number|phone|mobile)($|_)/;
const NOT_NUM = /type|nationality|verified|count|order_type|_id$|^id$|iccid|serial|version|page|line_number|house|building|street|unit|plate|token|attempts/;
let homes = null;
async function numberHomes() {
  if (homes) return homes;
  const h = { own: [], children: [], parents: [], orderables: [], extra: false, note: null };
  try {
    const cols = (await db.source.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'`)).rows;
    const byTable = {}; for (const c of cols) (byTable[c.table_name] = byTable[c.table_name] || []).push(c);
    const numCols = t => (byTable[t] || []).filter(c => NUM_COL.test(c.column_name) && !NOT_NUM.test(c.column_name)
        && /char|text|int|numeric/.test(c.data_type)).map(c => c.column_name);
    const oo = byTable.onboarding_orders || [];
    h.own = numCols('onboarding_orders').filter(c => c !== 'mobile_number');            // e.g. mnp_number
    h.extra = oo.some(c => c.column_name === 'extra');
    for (const t of Object.keys(byTable)) {
      if (t === 'onboarding_orders') continue;
      const nc = numCols(t); if (!nc.length) continue;
      const link = (byTable[t] || []).find(c => ['onboarding_order_id', 'order_id'].includes(c.column_name));
      if (link) h.children.push({ table: t, link: link.column_name, via: 'id', cols: nc });
      const ck = (byTable[t] || []).find(c => c.column_name === 'checkout_id');
      if (ck && oo.some(c => c.column_name === 'checkout_id')) h.children.push({ table: t, link: 'checkout_id', via: 'checkout_id', cols: nc });
    }
    /* parents: onboarding_orders.<x>_id → table <x>s */
    for (const c of oo) {
      const m = /^(.+)_id$/.exec(c.column_name); if (!m || c.column_name === 'orderable_id') continue;
      const t = [m[1] + 's', m[1].replace(/y$/, 'ies'), m[1]].find(n => byTable[n]); if (!t) continue;
      const nc = numCols(t); if (nc.length) h.parents.push({ table: t, fk: c.column_name, cols: nc });
    }
    /* orderables: distinct orderable_type values seen in the last 180 days → Rails table name */
    if (oo.some(c => c.column_name === 'orderable_type')) {
      const types = (await db.source.query(`SELECT DISTINCT orderable_type FROM onboarding_orders WHERE created_at >= now() - interval '180 days' AND orderable_type IS NOT NULL LIMIT 20`).catch(() => ({ rows: [] }))).rows;
      for (const r of types) {
        const snake = String(r.orderable_type).split('::').pop().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
        const t = [snake + 's', snake.replace(/y$/, 'ies'), snake + 'es', snake].find(n => byTable[n]); if (!t) continue;
        const nc = numCols(t); if (nc.length) h.orderables.push({ type: r.orderable_type, table: t, cols: nc });
      }
    }
  } catch (e) { h.note = String(e.message || e); }
  homes = h;
  const t = setTimeout(() => { homes = null; }, 3600e3); if (t.unref) t.unref();
  return h;
}
/* kept for callers of the old name: the order's OWN number-like columns besides mobile_number */
async function orderNumberColumns() { return (await numberHomes()).own; }
/* SQL fragment on onboarding_orders for a msisdn-variants parameter (text[]): contact number OR the selected number
 * wherever it lives. Every sub-select is an equality on the related table, so it stays cheap; the extra-json scan is
 * bounded to 180 days. */
async function orderNumberWhere(param) {
  const h = await numberHomes();
  const eq = c => `${c}::text = ANY(${param}::text[])`;
  const any = cols => '(' + cols.map(eq).join(' OR ') + ')';
  const parts = [eq('mobile_number'), ...h.own.map(eq)];
  for (const c of h.children) parts.push(`${c.via}::text IN (SELECT ${c.link}::text FROM ${c.table} WHERE ${any(c.cols)})`);
  for (const p of h.parents) parts.push(`${p.fk}::text IN (SELECT id::text FROM ${p.table} WHERE ${any(p.cols)})`);
  for (const o of h.orderables) parts.push(`(orderable_type = '${o.type.replace(/'/g, "''")}' AND orderable_id::text IN (SELECT id::text FROM ${o.table} WHERE ${any(o.cols)}))`);
  if (h.extra) parts.push(`(created_at >= now() - interval '180 days' AND EXISTS (SELECT 1 FROM unnest(${param}::text[]) v WHERE length(v) >= 9 AND extra::text LIKE '%' || v || '%'))`);
  return '(' + parts.join(' OR ') + ')';
}
module.exports = { classify, isVisitorKey, resolve, numberHomes, orderNumberColumns, orderNumberWhere };
