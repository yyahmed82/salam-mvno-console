/* LIVE CUSTOMER VIEW — the console calls the SAME UIL/APIGW read endpoints the mobile app calls
 * (app/services/optiva/*.rb in selfcare-backend: base https://apigw.salammobile.sa:8081/api/uil,
 * auth = static x-api-key header), so Subscriber 360 can show CURRENT balance / plan / bundles /
 * invoices instead of only what the replica remembers. Requested by Yosri 2 Sep 2026 for Call
 * Center / L1 / L2.
 *
 * READ-ONLY BY CONSTRUCTION. The PANELS map below is the complete universe of callable paths —
 * every one is a BSS *query*. There is no code path to transfer, deduct, recharge, or update:
 * a panel name not in this map is rejected before any HTTP happens.
 *
 * CONFIG (env, /apps/console/.env):
 *   LIVE_UIL_BASE   default https://apigw.salammobile.sa:8081/api/uil  (same as the app's prod base)
 *   LIVE_UIL_KEY    the x-api-key value — copy from the app source (optiva/client.rb API_KEY).
 *                   Deliberately NOT hardcoded here: it is a credential, it lives in env only.
 *   LIVE_UIL_TIMEOUT_MS  default 8000
 *   LIVE_UIL_INSECURE    default 1 (the gateway runs a self-signed cert; the app also skips verify)
 *
 * SNAPSHOT CACHE / HISTORY. Every live answer is stored in live_snapshots (jsonb — Postgres
 * TOAST-compresses large values automatically, so "compressed history" comes free). A panel serves
 * its latest snapshot when younger than TTL (10 min) unless refresh=1, and the UI can browse the
 * history — "what did the balance say yesterday?" is answerable without another BSS call.
 * Retention: 180 days, pruned opportunistically on write.
 *
 * Every live call is audited (live.bss). Responses are masked by the caller (roles.maskDeep);
 * the BSS spellings of subscriber numbers are added to PII_FIELDS via maskExtra() here. */
'use strict';
const https = require('https');
const db = require('./db');

const BASE = () => (process.env.LIVE_UIL_BASE || 'https://apigw.salammobile.sa:8081/api/uil').replace(/\/+$/, '');
const KEY = () => process.env.LIVE_UIL_KEY || '';
const TIMEOUT = () => Number(process.env.LIVE_UIL_TIMEOUT_MS || 8000);
const INSECURE = () => process.env.LIVE_UIL_INSECURE !== '0';
const TTL_MIN = 10, RETENTION_D = 180;

const configured = () => !!KEY();

/* ---- the whole callable universe: BSS READS only (paths + request builders from the app source) */
const PANELS = {
  balance:  { label: 'Balance', path: '/bss/subscription/get-subscription-balance',
              body: c => ({ mobileNumber: c.msisdn, detailed: true }), needs: 'msisdn' },
  profile:  { label: 'Subscription profile', path: '/bss/subscription/get-subscription-profile',
              body: c => ({ mobileNumber: c.msisdn }), needs: 'msisdn' },
  bundles:  { label: 'Bundle balances', path: '/bss/subscription/get-subscription-bundle-balances',
              body: c => ({ subscriptionRef: { mobileNumber: c.msisdn } }), needs: 'msisdn' },
  plan:     { label: 'Price plan option', path: '/bss/subscription/get-subscription-price-plan-option',
              body: c => ({ mobileNumber: c.msisdn }), needs: 'msisdn' },
  account:  { label: 'BSS account', path: '/bss/account/list-account-id',
              body: c => ({ identificationIds: [{ type: String(c.nid || '').startsWith('1') ? 1 : 2, value: c.nid }], states: [0] }),
              needs: 'nid' },
  bill:     { label: 'Account balance / last invoice', path: '/bss/account/execute-account-blnc-query',
              body: c => ({ balanceTypes: ['LAST_INVOICE_AMOUNT', 'BALANCE', 'CURRENCY', 'PAYMENTS_SINCE_LAST_INVOICE',
                            'ADJUSTMENTS_SINCE_LAST_INVOICE', 'LAST_INVOICE_IDENTIFIER', 'LAST_INVOICE_DUE_DATE'],
                            accountId: c.accountId }), needs: 'accountId' },
  invoices: { label: 'Invoices', path: '/bss/invoices/list-invoices', tmoX: 2.5,   // BSS is slow on invoice history
              body: c => ({ accountId: c.accountId, ascending: false, transactionId: c.accountId }), needs: 'accountId' },
  /* addons (Yosri, 3 Sep) — every subscription under the ACCOUNT (main line + addon products).
   * Reference: ops curl to /bss/subscription/list-subscriptions {transactionId, accountId}. */
  addons:   { label: 'Addons / account subscriptions', path: '/bss/subscription/list-subscriptions',
              body: c => ({ accountId: c.accountId, transactionId: c.accountId }), needs: 'accountId' }
};

/* BSS spells the subscriber number several ways — extend the mask by KEY NAME (same mechanism
 * as roles.PII_FIELDS; see the contact_number lesson there). */
function maskExtra() {
  const roles = require('./roles');
  for (const k of ['mobileNumber', 'primaryMobileNumber', 'givenMobileNumber', 'secondaryMobileNumber',
                   'contactMobileNumber', 'subscriberName', 'accountName'])
    roles.PII_FIELDS.add(k);
}
maskExtra();

let _ensured = false;
async function ensure() {
  if (_ensured) return;
  await db.console.query(`CREATE TABLE IF NOT EXISTS live_snapshots (
    id bigserial PRIMARY KEY, cust text NOT NULL, panel text NOT NULL,
    taken_at timestamptz NOT NULL DEFAULT now(), ms integer, http integer, ok boolean,
    endpoint text, request jsonb, response jsonb)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_live_snap ON live_snapshots (cust, panel, taken_at DESC)`);
  _ensured = true;
}

/* SALAM SERVICE LINES for a search key. onboarding_orders.mobile_number is the CONTACT number
 * the customer typed (often another operator!); the actual Salam MSISDN is assigned during
 * activation (activation_logs.msisdn, indexed by onboarding_order_id) or, for port-ins, is the
 * order's mnp_number. Every BSS call must use a SERVICE number — never the contact number. */
async function linesFor(key) {
  const q = String(key || '').trim();
  const digits = q.replace(/\D/g, '');
  const forms = (() => {
    if (!/^(?:966|0)?5\d{8}$/.test(digits)) return [q];
    const l9 = digits.slice(-9);
    return ['0' + l9, '966' + l9, l9, '+966' + l9];
  })();
  const out = { lines: [], error: null };
  try {
    const oq = await db.source.query(
      `SELECT id::text AS oid, mobile_number, mnp_number, plan_id, activated, created_at
         FROM onboarding_orders
        WHERE nationality_id_number = $1::text OR mobile_number = ANY($2::text[]) OR mnp_number = ANY($2::text[])
        ORDER BY created_at DESC LIMIT 30`, [q, forms]);
    /* REGRESSION FIX (3 Sep): an early `if (!oq.rows.length) return` here predated the app-
     * accounts branch below and silently skipped it — searching a customer's SALAM MSISDN
     * directly found NO lines (orders store the CONTACT number, so no order matches the service
     * number, but the users row does). Orders are now optional; the users lookup ALWAYS runs. */
    const ids = oq.rows.map(x => x.oid);
    const norm = v => { const d = String(v).replace(/\D/g, ''); return /^05\d{8}$/.test(d) ? '966' + d.slice(1) : /^5\d{8}$/.test(d) ? '966' + d : d; };
    const seen = new Set();
    if (ids.length) {
      /* activation msisdns. onboarding_order_id is a UUID column — cast the PARAM, never the
       * column (a column cast defeats index_activation_logs_on_onboarding_order_id). Plain
       * GROUP BY + JS dedupe; a previous DISTINCT ON/GROUP BY/"at"-alias combo errored and a
       * .catch(()=>[]) swallowed it into a false "no lines" — errors now travel with the result. */
      const aq = await db.source.query(
        `SELECT msisdn, onboarding_order_id::text AS oid, max(created_at) AS last_at
           FROM activation_logs
          WHERE onboarding_order_id = ANY($1::uuid[]) AND msisdn IS NOT NULL AND msisdn <> ''
          GROUP BY msisdn, onboarding_order_id
          ORDER BY last_at DESC`, [ids]);
      const byOid = Object.fromEntries(oq.rows.map(x => [x.oid, x]));
      for (const a of aq.rows) {
        const m = norm(a.msisdn); if (!/^9665\d{8}$/.test(m) || seen.has(m)) continue; seen.add(m);
        const o = byOid[a.oid] || {};
        out.lines.push({ ref: a.oid, msisdn: m, source: 'activation', plan_id: o.plan_id || null, at: a.last_at, activated: o.activated });
      }
      for (const o of oq.rows) {   // MNP orders: the ported number IS the service number
        if (!o.mnp_number) continue;
        const m = norm(o.mnp_number); if (!/^9665\d{8}$/.test(m) || seen.has(m)) continue; seen.add(m);
        out.lines.push({ ref: o.oid, msisdn: m, source: 'mnp port-in', plan_id: o.plan_id || null, at: o.created_at, activated: o.activated });
      }
    }
    /* RESERVED NUMBERS (3 Sep): Apollo / number-selection orders get their Salam MSISDN assigned
     * at ORDER time in `numbers` (identifier + price_type "Regular"/vanity class, FK
     * onboarding_order_id) — long before any activation row exists. Case 2639320247 proved it:
     * CMS showed 966510050419 while all three other sources were legitimately empty. Shown as a
     * RESERVED line so agents see the assigned number without mistaking it for an active one. */
    try {
      /* STALENESS GUARD (4 Sep): `numbers` rows are ~30-min checkout reservations. A recycled
       * MSISDN keeps its OLD reservation row forever (966510050419 still points at a 2022 order
       * of another customer) — so only FRESH reservations count; ownership truth for anything
       * older is the activation ledgers / BSS, never this table. */
      const nq = await db.source.query(
        `SELECT identifier, group_id, onboarding_order_id::text AS oid, created_at
           FROM numbers WHERE onboarding_order_id = ANY($1::uuid[])
            AND created_at > now() - interval '30 days' LIMIT 10`,
        [ids.length ? ids : ['00000000-0000-0000-0000-000000000000']]);
      for (const r2 of nq.rows) {
        const m = norm(r2.identifier); if (!/^9665\d{8}$/.test(m) || seen.has(m)) continue; seen.add(m);
        const o = oq.rows.find(x => x.oid === r2.oid) || {};
        out.lines.push({ ref: r2.oid, msisdn: m, source: 'reserved · ' + require('./flowGuard').classOf(r2.group_id).label + (o.activated ? '' : ' — not activated yet'),
          plan_id: o.plan_id || null, at: r2.created_at, activated: !!o.activated, reserved: !o.activated });
      }
    } catch (e) { out.error = out.error || ('numbers lookup: ' + e.message); }
    /* PARTNER / DMS ACTIVATIONS (4 Sep): tygo/Apollo orders carry NO msisdn ANYWHERE in the app
     * DB (case 2639320247: activated=true, external_service_name=tygo, zero number fields —
     * the SIM is provisioned on the DMS side; even `numbers` held only a stale 2022 reservation
     * of the recycled number). Clara sim_activation_logs holds msisdn + customer_id_number.
     * BOUNDED: recent-id window (PK-indexed) — never a full scan of the Clara ledger. */
    try {
      const dms = require('./dmsDb');
      if (dms.configured && dms.configured() && /^\d{8,15}$/.test(q)) {
        // DISCOVERY-NOT-HARDCODING (the banner caught a hardcoded 'msisdn' — Clara spells its
        // columns differently): resolve names via information_schema, degrade with a note.
        const SC2 = process.env.DMS_AUDIT_SCHEMA || 'dms_audit_logs';
        const mcol = await dms.pick(SC2, 'sim_activation_logs', ['msisdn', 'mobile_number', 'purchased_number', 'default_number', 'customer_mobile']);
        const ccol = await dms.pick(SC2, 'sim_activation_logs', ['customer_id_number', 'person_id', 'id_number', 'customer_personal_id', 'customer_id']);
        const tcol = await dms.pick(SC2, 'sim_activation_logs', ['insert_date_time', 'created_at', 'created_date', 'date_time']);
        if (mcol && ccol) {
          const T = '`' + SC2 + '`.`sim_activation_logs`';
          const mx = await dms.q(`SELECT max(id) m FROM ${T}`);
          const lo = Math.max(0, Number((mx[0] || {}).m || 0) - 800000);
          const pr = await dms.qSlow(
            `SELECT \`${mcol}\` mm${tcol ? ', `' + tcol + '` tt' : ''} FROM ${T}
              WHERE id > ? AND \`${ccol}\` = ? AND \`${mcol}\` IS NOT NULL AND \`${mcol}\` <> ''
              ORDER BY id DESC LIMIT 4`, [lo, q], 15000);
          for (const r2 of pr) {
            const m = norm(r2.mm); if (!/^9665\d{8}$/.test(m) || seen.has(m)) continue; seen.add(m);
            out.lines.push({ ref: 'dms:' + m, msisdn: m, source: 'partner activation (DMS)',
              plan_id: null, at: r2.tt || null, activated: true });
          }
        } else if (!out.lines.length) {
          out.error = out.error || `partner-activation lookup: sim_activation_logs columns not resolvable (msisdn:${mcol || '—'} customer:${ccol || '—'})`;
        }
      }
    } catch (e) { out.error = out.error || ('partner-activation lookup: ' + e.message.slice(0, 120)); }
    /* APP ACCOUNTS (users table) — the strongest source: registering the app REQUIRES a Salam
     * line, so users.mobile_number is always a Salam service number. This is what catches lines
     * whose activation predates the replica's ledger window or came through another channel
     * (Yosri's own active line surfaced ONLY here). ref = 'u:<id>' — opaque, mapped back
     * server-side like any other line ref. */
    try {
      const uq = await db.source.query(
        `SELECT id::text AS uid, mobile_number, current_sign_in_at, updated_at
           FROM users
          WHERE nationality_id_number = $1::text OR mobile_number = ANY($2::text[])
          ORDER BY current_sign_in_at DESC NULLS LAST LIMIT 10`, [q, forms]);
      for (const u of uq.rows) {
        const m = norm(u.mobile_number); if (!/^9665\d{8}$/.test(m) || seen.has(m)) continue; seen.add(m);
        out.lines.push({ ref: 'u:' + u.uid, msisdn: m, source: 'app account',
          plan_id: null, at: u.current_sign_in_at || u.updated_at, activated: true });
      }
    } catch (e) { if (!out.lines.length) out.error = out.error || ('users lookup: ' + e.message); }
    /* BSS AUTHORITY (4 Sep) — LAST RESORT, and the only truthful one for partner/tygo flows:
     * case 2639320247 proved the replica holds NO NID→msisdn mapping for them (the number even
     * carries two RECYCLED lifecycles: a 2022 reservation of another NID and a May-2026 self-
     * activation — replica archaeology CANNOT answer ownership). BSS list-account-id(NID) →
     * list-subscriptions(account) answers CURRENT ownership. Two live gateway reads, only when
     * every replica source came up empty on an explicit NID lookup. */
    const digits2 = q.replace(/\D/g, '');
    if (!out.lines.length && /^[12]\d{9}$/.test(digits2) && configured()) {
      try {
        const acct = await callUil('/bss/account/list-account-id',
          { identificationIds: [{ type: digits2.startsWith('1') ? 1 : 2, value: digits2 }], states: [0] });
        let accountId = null;
        (function scan(o, d2) { if (o == null || d2 > 5 || accountId) return;
          if (typeof o === 'object') for (const [k, v] of Object.entries(o)) {
            if (!accountId && /account.?id/i.test(k) && /^\d{4,}$/.test(String(v))) { accountId = String(v); return; }
            scan(v, d2 + 1); } })(acct, 0);
        if (accountId) {
          const subs = await callUil('/bss/subscription/list-subscriptions',
            { accountId, transactionId: accountId });
          const found = [...new Set(String(JSON.stringify(subs)).match(/9665\d{8}/g) || [])];
          for (const m of found) {
            if (seen.has(m)) continue; seen.add(m);
            /* `at` is the ACTIVATION date for replica-sourced lines; BSS does not tell us one here, so it stays
             * null and `seen_at` carries the lookup time (27 Sep 2026: Yusr read the lookup time as "since 2026-09-27"). */
            out.lines.push({ ref: 'bss:' + m, msisdn: m, source: 'BSS account (live — authoritative)',
              plan_id: null, at: null, seen_at: new Date().toISOString(), activated: true });
          }
          if (!found.length) out.note = 'BSS account ' + accountId + ' found but no subscription numbers on it';
        }
      } catch (e) { out.error = out.error || ('BSS account lookup: ' + e.message.slice(0, 120)); }
    }
    /* MIRROR CASE (4 Sep): the search key IS a Salam-shaped MSISDN but no replica source knows
     * it (partner-provisioned + recycled numbers again — 966510050419). Ask BSS whether the
     * subscription exists; a real profile answer = a real line, whoever provisioned it. */
    if (!out.lines.length && /^(?:966|0)?5\d{8}$/.test(digits2) && configured()) {
      const m = '966' + digits2.slice(-9);
      try {
        const prof = await callUil('/bss/subscription/get-subscription-profile', { mobileNumber: m });
        // callUil wraps: {ok, http, data:<UIL envelope>} and the envelope wraps again: {data:{profile}}
        const env = prof && prof.ok !== false ? prof.data : null;
        const p = env && env.data && env.data.profile;
        if (p && !seen.has(m)) {
          seen.add(m);
          out.lines.push({ ref: 'bss:' + m, msisdn: m, source: 'BSS subscription (live — authoritative)',
            plan_id: null, at: null, seen_at: new Date().toISOString(), activated: true });
        } else if (!p) out.note = out.note || 'BSS does not know this number — not provisioned (or typo).';
      } catch (e) { out.error = out.error || ('BSS msisdn check: ' + e.message.slice(0, 100)); }
    }
    out.lines.sort((x, z) => new Date(z.at || z.seen_at || 0) - new Date(x.at || x.seen_at || 0));
  } catch (e) { out.error = e.message; }
  return out;
}

/* NID FROM BSS (4 Sep) — for customers the replica doesn't know (partner/tygo), the BSS
 * subscription profile's `identifier` field IS the customer's national/iqama id. One live read,
 * cached 10 min, unlocks the whole account chain (list-account-id → bill/invoices/addons). */
const _nidCache = new Map();
async function nidFromBss(msisdn) {
  if (!configured() || !/^9665\d{8}$/.test(String(msisdn))) return null;
  const c = _nidCache.get(msisdn);
  if (c && Date.now() - c.at < 600000) return c.nid;
  let nid = null;
  try {
    const prof = await callUil('/bss/subscription/get-subscription-profile', { mobileNumber: msisdn });
    const env = prof && prof.ok !== false ? prof.data : null;
    const idf = env && env.data && env.data.profile && env.data.profile.identifier;
    if (/^[12]\d{9}$/.test(String(idf || ''))) nid = String(idf);
  } catch (e) { /* best-effort — account chain simply stays gated */ }
  _nidCache.set(msisdn, { at: Date.now(), nid });
  return nid;
}

/* resolve what the panels need from the REPLICA, server-side — the client sends only the search
 * key, never a raw msisdn (same contract as /api/transaction's dmsrow).
 * `lineRef` (an order id, opaque to the client) pins the query to ONE Salam line. */
async function resolveCustomer(key, lineRef) {
  const q = String(key || '').trim();
  const digits = q.replace(/\D/g, '');
  /* msisdnForms — same tolerance as errors.js (prod stores 9665…, 05…, bare 5…, +966…) */
  const forms = (() => {
    if (!/^(?:966|0)?5\d{8}$/.test(digits)) return [q];
    const l9 = digits.slice(-9);
    return ['0' + l9, '966' + l9, l9, '+966' + l9];
  })();
  const isNid = /^[12]\d{9}$/.test(digits);
  /* ONE query, BOTH conditions — a previous version built the SQL conditionally but always
   * passed two bind params; Postgres rejected the bind and a .catch swallowed it, surfacing as
   * a false "no MSISDN resolvable". Mirrors errors.js's proven resolution instead. */
  let row = {}, err = null;
  try {
    const r = await db.source.query(
      `SELECT mobile_number, nationality_id_number FROM onboarding_orders
        WHERE nationality_id_number = $1::text OR mobile_number = ANY($2::text[])
        ORDER BY (mobile_number IS NOT NULL AND mobile_number <> '') DESC, created_at DESC
        LIMIT 1`, [q, forms]);
    row = r.rows[0] || {};
  } catch (e) { err = e.message; }
  /* orders store the CONTACT number — a service-msisdn search matches no order. The app account
   * (users) carries both the service number AND the customer's real NID: use it so the BSS
   * account-by-NID chain (bill / invoices) works when the agent searched by the Salam number. */
  if (!row.nationality_id_number) {
    try {
      const u = await db.source.query(
        `SELECT mobile_number, nationality_id_number FROM users
          WHERE mobile_number = ANY($1::text[]) OR nationality_id_number = $2::text
          ORDER BY current_sign_in_at DESC NULLS LAST LIMIT 1`, [forms, q]);
      if (u.rows[0]) row = { mobile_number: row.mobile_number || u.rows[0].mobile_number,
                             nationality_id_number: u.rows[0].nationality_id_number };
    } catch (e) { err = err || ('users nid mapping: ' + e.message); }
  }
  // SERVICE NUMBER FIRST: activated Salam lines (or the ported number), never the contact number
  let ms = null, source = null;
  try {
    const lf = await linesFor(key);
    if (lf.error) err = err || lf.error;
    const pick = lineRef ? lf.lines.find(l => l.ref === String(lineRef)) : lf.lines[0];
    if (pick) { ms = pick.msisdn; source = pick.source; }
  } catch (e) { err = err || e.message; }
  if (!ms) {
    // no activated line — the typed key itself may BE a service msisdn, else the contact number
    // is used only as a last resort and is FLAGGED so the UI can warn the agent
    if (/^(?:966|0)?5\d{8}$/.test(digits)) { ms = '966' + digits.slice(-9); source = 'as typed'; }
    else if (row.mobile_number) { let c = String(row.mobile_number).replace(/\D/g, '');
      ms = /^05\d{8}$/.test(c) ? '966' + c.slice(1) : c; source = 'contact number — NO activated Salam line found'; }
  }
  let nid = row.nationality_id_number || (isNid ? digits : null);
  // BSS-known line but replica-unknown customer → learn the NID from the profile itself
  if (!nid && ms && /BSS/.test(source || '')) nid = await nidFromBss(ms);
  return { msisdn: ms, nid, accountId: null,
           line_source: source, contact_only: source && source.startsWith('contact') ? true : false,
           resolve_error: err };
}

/* ---- SSH transport (interim) -------------------------------------------------------------
 * 152 cannot reach the APIGW on :8081 (verified 2 Sep: all six nodes answer 000 — firewalled),
 * but the API hosts 43.17/.18 talk to it constantly (the app runs there) and 152 already holds
 * SSH as console_ro for the log collector. LIVE_UIL_VIA=ssh routes each live read through that
 * hop: ssh → `curl -K -` with the ENTIRE request (url, key header, body) delivered as a curl
 * config on stdin — nothing sensitive ever appears in the remote ps/argv. Reuses the collector's
 * env (API_LOG_HOSTS/USER/KEY). Remove once the SOC opens 8081 and LIVE_UIL_VIA is unset. */
const { execFile } = require('child_process');
function callViaSsh(path, body, msOverride) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // LIVE_UIL_SSH_* lets an instance do live reads over the hop WITHOUT enabling the log collectors (API_LOG_HOSTS
    // is also the collectors' on-switch); falls back to the collector variables when the dedicated ones are unset.
    const host = (process.env.LIVE_UIL_SSH_HOST || process.env.API_LOG_HOSTS || '').split(',')[0].trim();
    const user = process.env.LIVE_UIL_SSH_USER || process.env.API_LOG_USER || 'console_ro';
    const keyf = process.env.LIVE_UIL_SSH_KEY || process.env.API_LOG_KEY || '';
    if (!host || !keyf) return resolve({ ok: false, error: 'LIVE_UIL_VIA=ssh needs LIVE_UIL_SSH_HOST/USER/KEY (or API_LOG_HOSTS/USER/KEY)', ms: 0 });
    const q = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    const cfg = [
      'url = ' + q(BASE() + path),
      'request = "POST"',
      'header = ' + q('x-api-key: ' + KEY()),
      'header = "Content-Type: application/json; charset=utf-8"',
      'data = ' + q(JSON.stringify(body || {})),
      'insecure', 'silent',
      'max-time = ' + Math.ceil((msOverride || TIMEOUT()) / 1000),
      'write-out = ' + q('\\n__HTTP__%{http_code}')
    ].join('\n') + '\n';
    const child = execFile('ssh',
      ['-i', keyf, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
       user + '@' + host, 'curl -K -'],
      { timeout: (msOverride || TIMEOUT()) + 7000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const ms = Date.now() - t0;
        const m = /__HTTP__(\d{3})\s*$/.exec(stdout || '');
        if (!m) return resolve({ ok: false, error: (err && err.message) || (String(stderr || '').slice(0, 160)) || 'no answer via ssh hop', ms });
        const http = Number(m[1]);
        const bodyTxt = String(stdout).slice(0, m.index);
        let data; try { data = JSON.parse(bodyTxt); } catch (e) { data = { raw: bodyTxt.slice(0, 4000) }; }
        if (http === 0) return resolve({ ok: false, error: 'gateway unreachable from ' + host + ' too', ms });
        resolve({ ok: http >= 200 && http < 300, http, data, ms, via: 'ssh:' + host });
      });
    child.stdin.on('error', () => {});
    child.stdin.write(cfg); child.stdin.end();
  });
}
/* binary answers (invoice PDF) cannot ride the text parser — the ssh hop pipes through base64,
 * the direct path collects a Buffer. Success = a real %PDF magic after decode. */
function callUilPdf(path, body, msOverride) {
  const ms = msOverride || TIMEOUT();
  if ((process.env.LIVE_UIL_VIA || '') === 'ssh') return new Promise((resolve) => {
    const host = (process.env.API_LOG_HOSTS || '').split(',')[0].trim();
    const user = process.env.API_LOG_USER || 'console_ro';
    const keyf = process.env.API_LOG_KEY || '';
    if (!host || !keyf) return resolve({ ok: false, error: 'ssh transport not configured' });
    const q = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    const cfg = ['url = ' + q(BASE() + path), 'request = "POST"',
      'header = ' + q('x-api-key: ' + KEY()), 'header = "Content-Type: application/json; charset=utf-8"',
      'data = ' + q(JSON.stringify(body || {})), 'insecure', 'silent',
      'max-time = ' + Math.ceil(ms / 1000)].join('\n') + '\n';
    const child = execFile('ssh',
      ['-i', keyf, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
       user + '@' + host, 'curl -K - | base64'],
      { timeout: ms + 8000, maxBuffer: 30 * 1024 * 1024 }, (err, stdout) => {
        try {
          const buf = Buffer.from(String(stdout || '').replace(/\s+/g, ''), 'base64');
          if (buf.slice(0, 4).toString() === '%PDF') return resolve({ ok: true, buf });
          resolve({ ok: false, error: 'not a PDF (' + buf.slice(0, 120).toString().replace(/[^ -~]/g, '.') + ')' });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    child.stdin.on('error', () => {}); child.stdin.write(cfg); child.stdin.end();
  });
  return new Promise((resolve) => {
    let u; try { u = new URL(BASE() + path); } catch (e) { return resolve({ ok: false, error: 'bad base' }); }
    const payload = JSON.stringify(body || {});
    const req = https.request({ host: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST',
      headers: { 'x-api-key': KEY(), 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) },
      rejectUnauthorized: !INSECURE(), timeout: ms }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => { const buf = Buffer.concat(chunks);
        if (buf.slice(0, 4).toString() === '%PDF') resolve({ ok: true, buf });
        else resolve({ ok: false, error: 'not a PDF (http ' + res.statusCode + ')' }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.write(payload); req.end();
  });
}
/* the app's own PDF endpoint (bills_controller#generate_pdf): BSS expects billingDate as
 * '%b %d, %Y' ("Aug 28, 2026") — sending the raw invoiceDate gets a 5003 — and the accountId
 * of THE INVOICE (the app uses bill["accountID"]). PDF generation is slow: the app allows 90s. */
function fmtBillDate(v) {
  const t = /^\d{10,}$/.test(String(v)) ? Number(v) : Date.parse(String(v).replace(' ', 'T'));
  if (!Number.isFinite(t)) return String(v);
  const d = new Date(t);
  const mon = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${mon} ${String(d.getUTCDate()).padStart(2, '0')}, ${d.getUTCFullYear()}`;
}
async function invoicePdf(custKey, line, billingDate, acct) {
  let accountId = String(acct || '').trim() || null;   // prefer the invoice row's own accountID
  if (!accountId) {
    const b = await panel(String(custKey).trim(), 'bill', { refresh: false, line });
    accountId = b && b.request && b.request.accountId;
    if (!accountId) return { ok: false, error: 'account id unresolved: ' + (b && b.error || 'unknown') };
  }
  return callUilPdf('/bss/invoices/get-invoice-pdf',
    { accountIdentifier: accountId, billingDate: fmtBillDate(billingDate) },
    Math.max(90000, TIMEOUT() * 2.5));
}
function callUil(path, body, msOverride) {
  if ((process.env.LIVE_UIL_VIA || '') === 'ssh') return callViaSsh(path, body, msOverride);
  return callUilDirect(path, body, msOverride);
}
function callUilDirect(path, body, msOverride) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let u; try { u = new URL(BASE() + path); } catch (e) { return resolve({ ok: false, error: 'bad LIVE_UIL_BASE', ms: 0 }); }
    const payload = JSON.stringify(body || {});
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST',
      headers: { 'x-api-key': KEY(), 'Content-Type': 'application/json; charset=utf-8',
                 'User-Agent': 'SalamConsole-Live/1.0', 'Content-Length': Buffer.byteLength(payload) },
      rejectUnauthorized: !INSECURE(), timeout: (msOverride || TIMEOUT())
    }, res => {
      let buf = '';
      res.on('data', d => { if (buf.length < 400000) buf += d; });
      res.on('end', () => {
        let data; try { data = JSON.parse(buf); } catch (e) { data = { raw: buf.slice(0, 4000) }; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, http: res.statusCode, data, ms: Date.now() - t0 });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: `timeout after ${TIMEOUT()}ms`, ms: Date.now() - t0 }); });
    req.on('error', e => resolve({ ok: false, error: e.message, ms: Date.now() - t0 }));
    req.write(payload); req.end();
  });
}

async function latestSnap(cust, panel) {
  const r = await db.console.query(
    `SELECT id, taken_at, ms, http, ok, endpoint, request, response FROM live_snapshots
      WHERE cust=$1 AND panel=$2 ORDER BY taken_at DESC LIMIT 1`, [cust, panel]);
  return r.rows[0] || null;
}
async function history(cust, panel, limit = 15) {
  const r = await db.console.query(
    `SELECT id, taken_at, ms, http, ok FROM live_snapshots
      WHERE cust=$1 AND panel=$2 ORDER BY taken_at DESC LIMIT $3`, [cust, panel, limit]);
  return r.rows;
}
async function snapshotById(cust, id) {
  const r = await db.console.query(
    `SELECT id, panel, taken_at, ms, http, ok, endpoint, request, response FROM live_snapshots
      WHERE cust=$1 AND id=$2`, [cust, id]);
  return r.rows[0] || null;
}

/* fetch one panel: cached-if-fresh unless refresh; chains account → accountId for bill/invoices */
async function panel(custKey, name, { refresh = false, line = null } = {}) {
  await ensure();
  const P = PANELS[name];
  if (!P) return { error: `unknown panel '${name}'` };
  const cust = String(custKey).trim() + (line ? '#' + String(line).slice(0, 12) : '');

  if (!refresh) {
    const snap = await latestSnap(cust, name);
    if (snap && (Date.now() - new Date(snap.taken_at).getTime()) < TTL_MIN * 60e3)
      return { panel: name, label: P.label, cached: true, taken_at: snap.taken_at, ms: snap.ms, http: snap.http,
               ok: snap.ok, endpoint: snap.endpoint, request: snap.request, response: snap.response,
               history: await history(cust, name) };
  }
  if (!configured())
    return { panel: name, label: P.label, not_configured: true,
             note: 'Live BSS is not configured. Set LIVE_UIL_KEY in /apps/console/.env — the same '
                 + 'x-api-key the app uses (selfcare-backend app/services/optiva/client.rb), then restart. '
                 + 'Optional: LIVE_UIL_BASE (default = the app’s production gateway).',
             history: await history(cust, name) };

  const c = await resolveCustomer(String(custKey).trim(), line);
  // bill/invoices need the BSS accountId — chain through the account panel (cached like any other)
  if (P.needs === 'accountId') {
    const acct = await panel(String(custKey).trim(), 'account', { refresh: false, line });
    /* the UIL envelope nests the payload in .data (the app reads response.data) — unwrap, then
     * deep-scan for the first account-id-shaped scalar rather than guessing one field name */
    const env = (acct && acct.response) || {};
    const rd = (env.data && typeof env.data === 'object') ? env.data : env;
    let accountId = null;
    const scan = (o, depth) => {
      if (accountId || !o || typeof o !== 'object' || depth > 3) return;
      if (Array.isArray(o)) { for (const x of o) scan(x, depth + 1); return; }
      for (const [k, v] of Object.entries(o)) {
        if (accountId) break;
        if (/account.?id/i.test(k) && (typeof v === 'string' || typeof v === 'number') && String(v).trim()) { accountId = String(v); break; }
        if (v && typeof v === 'object') scan(v, depth + 1);
      }
    };
    scan(rd, 0); if (!accountId) scan(env, 0);
    // a stale FAILED snapshot must not poison the chain — retry live once, then rescan
    if (!accountId && acct && acct.cached) {
      const fresh = await panel(String(custKey).trim(), 'account', { refresh: true, line });
      const fenv = (fresh && fresh.response) || {};
      const frd = (fenv.data && typeof fenv.data === 'object') ? fenv.data : fenv;
      scan(frd, 0); if (!accountId) scan(fenv, 0);
    }
    c.accountId = accountId;
    if (!c.accountId) {
      const why = acct && acct.ok === false
        ? `BSS account lookup failed (HTTP ${acct.http || '—'}: ${String(env.responseMessage || env.error || '').slice(0, 80) || 'see snapshots'})`
        : `BSS account answer has no account-id field (payload keys: ${Object.keys(rd).slice(0, 8).join(', ') || 'empty'})`;
      return { panel: name, label: P.label, error: why, history: await history(cust, name) };
    }
  }
  if (P.needs === 'msisdn' && !c.msisdn) return { panel: name, label: P.label,
    error: c.resolve_error ? ('customer resolution failed: ' + c.resolve_error) : 'no MSISDN resolvable for this search key',
    history: await history(cust, name) };
  if (P.needs === 'nid' && !c.nid) return { panel: name, label: P.label, error: 'no National ID on file for this customer (needed to resolve the BSS account)', history: await history(cust, name) };

  const body = P.body(c);
  const r = await callUil(P.path, body, P.tmoX ? Math.round(TIMEOUT() * P.tmoX) : undefined);
  const endpoint = 'POST ' + BASE() + P.path;
  const resp = r.ok ? r.data : { error: r.error || null, http: r.http || null, data: r.data || null };
  try {
    await db.console.query(
      `INSERT INTO live_snapshots (cust, panel, ms, http, ok, endpoint, request, response)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cust, name, r.ms, r.http || 0, !!r.ok, endpoint, JSON.stringify(body), JSON.stringify(resp)]);
    if (Math.random() < 0.05) db.console.query(
      `DELETE FROM live_snapshots WHERE taken_at < now() - interval '${RETENTION_D} days'`).catch(() => {});
  } catch (e) { /* cache is best-effort */ }
  return { panel: name, label: P.label, cached: false, taken_at: new Date().toISOString(), ms: r.ms,
           http: r.http || 0, ok: !!r.ok, endpoint, request: body, response: resp,
           line_source: c.line_source || null, contact_only: !!c.contact_only,
           history: await history(cust, name) };
}

async function health() {
  if (!configured()) return { configured: false, note: 'LIVE_UIL_KEY not set' };
  const r = await callUil('/bss/subscription/get-subscription-profile', { mobileNumber: '0' });
  // any HTTP answer (even 4xx) proves the gateway is reachable & the key was evaluated
  return { configured: true, base: BASE(), reachable: !!(r.http || r.ok), http: r.http || null, ms: r.ms, error: r.error || null };
}

module.exports = { configured, panel, snapshotById, health, PANELS, resolveCustomer, linesFor, invoicePdf, nidFromBss };
