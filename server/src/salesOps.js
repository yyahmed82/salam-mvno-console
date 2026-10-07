/* salesOps.js — SALES OPERATIONS WALL (5 Oct 2026, asked by the Sales Operations team)
 *
 * Four sales channels, one login, one full-screen page per channel for the Sales Ops TV:
 *   Mobile › DMS (dealer app)          — the DMS ledger sim_activation_logs (MariaDB, live, PK-bounded)
 *                                        with the console's hourly rollups + masked failure events as the
 *                                        fallback when the ledger is not reachable
 *   Mobile › Self-activation (app/web) — selfcare activation_logs on the prod replica (db.source):
 *                                        /bss/account/create-individual-subscriber state=true = a customer
 *                                        activated; every other row is a step of the activation
 *   Fixed  › QR code (e-purchase)      — sda_ops order_attempts, channel epurchase + referral_code
 *   Fixed  › SDA (fixed dealer app)    — sda_ops order_attempts channel sda · error_events
 *
 * Every channel answers the SAME shape (the page is one template): activations 1 h / today / yesterday /
 * yesterday-same-time, outcomes success · business · technical in a window (15 m … 24 h), who is facing
 * errors (dealers / QR codes / platforms), the live activity feed (masked), the failure reasons and the
 * NOTICES IT Operations posted for it. The activity feed of the two dealer channels (DMS, SDA) carries the
 * dealer's STAFF ID and DEALER CODE so the Sales Ops team knows who sold (7 Oct 2026); the self-activation feed
 * carries the DEALER ID of the order behind the call instead of the platform and the number (alpha.145).
 * The channel HEALTH from the open alerts of its rule families is NOT sent by default (7 Oct 2026: the Sales
 * Ops team does not want IT alerts on the wall) — `?alerts=1` on /overview and /channel brings it back.
 *
 * Classification is the console-wide SSOT (errclass.js): success = the step succeeded, business = the API
 * answered "no", technical = the platform failed to answer. No customer identifier leaves this module:
 * MSISDNs / IDs are masked at the row and nothing is stored in the console DB except the notices.
 *
 * Permission: view 'salesops' (new) — the shared TV login holds only this view (role sales_wall).
 * Posting / clearing a notice needs the capability postNotices (IT Operations roles) and is audited.
 * Answers are cached 20 s per (channel, window): several TVs refreshing every 30 s share one query set. */
'use strict';
const db = require('./db');
const { classifyClass, classCaseSql } = require('./errclass');

const CHANNELS = {
  dms:     { key: 'dms',     biz: 'mobile', label: 'DMS · dealer app',            short: 'DMS',             who: 'Dealers',   whoOne: 'dealer',   unit: 'activations' },
  selfact: { key: 'selfact', biz: 'mobile', label: 'Self-activation · app & web', short: 'Self-activation', who: 'Platforms', whoOne: 'platform', unit: 'activations' },
  qr:      { key: 'qr',      biz: 'fixed',  label: 'QR code · e-purchase',        short: 'QR Code',         who: 'QR codes',  whoOne: 'QR code',  unit: 'completed orders' },
  sda:     { key: 'sda',     biz: 'fixed',  label: 'SDA · fixed dealer app',      short: 'SDA',             who: 'Dealers',   whoOne: 'dealer',   unit: 'completed orders' }
};
const ORDER = ['dms', 'selfact', 'qr', 'sda'];
const WINDOWS = { 15: 15, 60: 60, 360: 360, 1440: 1440 };
const LEVELS = ['outage', 'degraded', 'maintenance', 'info'];
const KSA = 3 * 3600e3;
const N = v => Number(v || 0);
const maskNum = v => v == null ? null :
  String(v).replace(/\d{5,}/g, m => m.slice(0, 2) + '*'.repeat(Math.min(6, m.length - 4)) + m.slice(-2));
const clip = (v, n) => v == null ? null : String(v).slice(0, n);
/* KSA day boundaries as UTC instants: today 00:00, yesterday 00:00, yesterday at the current time */
function days(now = new Date()) {
  const day0 = new Date(Math.floor((now.getTime() + KSA) / 864e5) * 864e5 - KSA);
  const y0 = new Date(day0.getTime() - 864e5);
  return { now, day0, y0, ySame: new Date(y0.getTime() + (now - day0)), h1: new Date(now.getTime() - 3600e3) };
}
function cls(ok, code, text) { return ok ? 'success' : classifyClass({ ok: false, status_code: code, response: text }).cls; }

/* ---------------------------------------------------------------- health: open alerts per channel */
const SELFACT_RX = /^(activation_|bss_|semati_|nafath_|citc_|conversion_drop|abandoned_orders|offhours_orders|datasim_|onboarding_flow_|otp_|app_|eligibility_deny|api_technical_fail|api_latency)/;
const SDA_EXTRA = new Set(['fixed_conversion_drop', 'fixed_workhours_drop', 'fixed_offhours_activity', 'fixed_dealer_stagnation', 'fixed_dealer_timeout_wave', 'fixed_dealer_timeout_storm']);
function channelOfAlert(a) {
  const k = String(a.rule_key || '');
  if (/^dms:/.test(k) || k === 'dealer_activity_drop') return 'dms';
  if (/^fixed_/.test(k)) {
    const dimCh = a.dim && typeof a.dim === 'object' ? a.dim.channel : null;
    if (/_qr$/.test(k) || dimCh === 'qr' || a.rch === 'qr') return 'qr';
    if (/_sda$/.test(k) || dimCh === 'sda' || a.rch === 'sda' || SDA_EXTRA.has(k)) return 'sda';
    return null;
  }
  if (a.segment === 'fixed') return null;
  return SELFACT_RX.test(k) ? 'selfact' : null;
}
const SEV_RANK = { P1: 4, P2: 3, P3: 2, P4: 1 };
const statusOfSev = sev => sev === 'P1' ? 'outage' : sev === 'P2' ? 'degraded' : sev ? 'minor' : 'ok';
async function openAlerts() {
  const r = await db.console.query(
    `SELECT a.id, a.severity, a.name, a.rule_key, a.fired_at, a.segment, a.dim, a.ack_by, r.channel AS rch
       FROM alerts a LEFT JOIN alert_rules r ON r.key = a.rule_key
      WHERE a.status = 'open' AND a.rule_key NOT LIKE '%infra\\_%'
        AND (a.snoozed_until IS NULL OR a.snoozed_until < now())
      ORDER BY a.severity, a.fired_at`);
  const by = { dms: [], selfact: [], qr: [], sda: [] };
  for (const a of r.rows) { const ch = channelOfAlert(a); if (ch) by[ch].push(a); }
  const out = {};
  for (const ch of ORDER) {
    const list = by[ch].sort((x, y) => (SEV_RANK[y.severity] || 0) - (SEV_RANK[x.severity] || 0) || new Date(x.fired_at) - new Date(y.fired_at));
    const worst = list[0] ? list[0].severity : null;
    out[ch] = { status: statusOfSev(worst), sev: worst, count: list.length,
      open: list.slice(0, 5).map(a => ({ id: a.id, sev: a.severity, name: clip(a.name, 120), since: a.fired_at, acked: !!a.ack_by })) };
  }
  return out;
}

/* ---------------------------------------------------------------- notices (IT Operations → the wall) */
let _ensured = false;
async function ensure() {
  if (_ensured) return;
  await db.console.query(`CREATE TABLE IF NOT EXISTS salesops_notices (
      id bigserial PRIMARY KEY, channel text NOT NULL DEFAULT 'all', level text NOT NULL DEFAULT 'info',
      title text NOT NULL, body text, starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz,
      created_by text, created_at timestamptz NOT NULL DEFAULT now(), cleared_at timestamptz, cleared_by text)`);
  await db.console.query(`CREATE INDEX IF NOT EXISTS idx_salesops_notices_live ON salesops_notices (cleared_at, ends_at)`);
  _ensured = true;
}
async function notices(channel) {
  await ensure();
  const r = await db.console.query(
    `SELECT id, channel, level, title, body, starts_at, ends_at, created_by, created_at
       FROM salesops_notices WHERE cleared_at IS NULL AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
        ${channel ? `AND channel IN ('all', $1)` : ''} ORDER BY CASE level WHEN 'outage' THEN 0 WHEN 'degraded' THEN 1 WHEN 'maintenance' THEN 2 ELSE 3 END, created_at DESC`,
    channel ? [channel] : []);
  return r.rows;
}

/* ---------------------------------------------------------------- Mobile › DMS (dealer app) */
let DMSJ = null; try { DMSJ = require('./dmsJourneys'); } catch (e) { DMSJ = null; }
/* DMS DEALER CODE of a dealer staff user — dms_v1.dms_users.dealer_code (the code DMS shows for the user's
 * wallet: <type prefix>_<account number>). The activation ledger carries only the user (channel_user_id =
 * dms_users.id, channel_username = dms_users.username), so the code is looked up by PK / username for the
 * handful of users on screen, cached 30 min. Read-only; a failed lookup leaves the column empty. */
const DLR = new Map(); const DLR_TTL = 30 * 60e3;
const dlrKey = (uid, user) => uid != null && uid !== '' ? 'i' + uid : (user ? 'u' + String(user).toLowerCase() : null);
async function dmsDealerCodes(keys) {
  const dms = require('./dmsDb'); const now = Date.now();
  const stale = k => { const c = DLR.get(dlrKey(k.uid, k.user)); return !c || now - c.t > DLR_TTL; };
  const need = keys.filter(k => dlrKey(k.uid, k.user) && stale(k));
  const ids = [...new Set(need.map(k => k.uid).filter(v => v != null && v !== '' && /^\d+$/.test(String(v))).map(String))].slice(0, 200);
  const users = [...new Set(need.filter(k => !(k.uid != null && /^\d+$/.test(String(k.uid))) && k.user).map(k => String(k.user)))].slice(0, 200);
  if (ids.length || users.length) {
    const have = await dms.columnsOf('dms_v1', 'dms_users');
    if (!have.has('dealer_code')) throw new Error('dms_v1.dms_users.dealer_code not visible');
    const sel = ['id', 'username', 'dealer_code'].map(c => have.has(c) ? `\`${c}\`` : `NULL AS \`${c}\``).join(', ');
    const rows = [];
    if (ids.length && have.has('id')) rows.push(...await dms.q(`SELECT ${sel} FROM \`dms_v1\`.\`dms_users\` WHERE \`id\` IN (?)`, [ids]));
    if (users.length && have.has('username')) rows.push(...await dms.q(`SELECT ${sel} FROM \`dms_v1\`.\`dms_users\` WHERE \`username\` IN (?)`, [users]));
    const t = Date.now();
    for (const r of rows) { const v = { code: r.dealer_code == null ? null : String(r.dealer_code), t };
      if (r.id != null) DLR.set('i' + r.id, v); if (r.username) DLR.set('u' + String(r.username).toLowerCase(), v); }
    for (const k of need) { const key = dlrKey(k.uid, k.user); if (!DLR.has(key) || DLR.get(key).t < t) DLR.set(key, { code: null, t }); }   // not found: remember the miss too
    if (DLR.size > 5000) DLR.clear();
  }
  return (uid, user) => { const a = DLR.get(dlrKey(uid, user)); if (a && a.code) return a.code; const u = user ? DLR.get(dlrKey(null, user)) : null; return u ? u.code : null; };
}
async function dmsLive(win, D) {
  if (!DMSJ || !DMSJ.resolve) throw new Error('DMS ledger module unavailable');
  const dms = require('./dmsDb');
  const r = await DMSJ.resolve('activation');
  if (!r.ok) throw new Error('activation ledger: ' + (r.why || 'unresolved'));
  const C = r.cols; if (!C.code || !C.dealer) throw new Error('activation ledger: code/dealer column missing');
  const shift = r.tzShiftMs || 0;
  const f = d => new Date(d.getTime() + shift).toISOString().slice(0, 19).replace('T', ' ');
  const T = `\`${DMSJ.SCHEMA || 'dms_audit_logs'}\`.\`${DMSJ.JOURNEYS.activation.table}\``;
  const mx = await dms.q(`SELECT max(id) m FROM ${T}`);
  const lo = Math.max(0, N((mx[0] || {}).m) - 80000);            // ≈ months of activations — a cheap PK range (same bound as /api/dms/journeys/home)
  /* who sold and where: the staff user id (→ dealer code), the shop (channel) name, region / city — when the ledger has them */
  const have = await dms.columnsOf(DMSJ.SCHEMA || 'dms_audit_logs', DMSJ.JOURNEYS.activation.table);
  const opt = c => have.has(c) ? c : null;
  const X = { uid: C.dealer === 'channel_user_id' ? null : opt('channel_user_id'), shop: opt('channel_name'), region: opt('region_name'), city: opt('city_name') };
  const sel = [`id`, `\`${C.at}\` AS ts`, `\`${C.code}\` AS code`, `\`${C.dealer}\` AS dealer`]
    .concat(C.message ? [`\`${C.message}\` AS message`] : []).concat(C.api ? [`\`${C.api}\` AS api`] : [])
    .concat(Object.entries(X).filter(([, c]) => c).map(([k, c]) => `\`${c}\` AS x_${k}`)).join(', ');
  const rows = await dms.qSlow(`SELECT ${sel} FROM ${T} WHERE id > ? AND \`${C.at}\` >= ? ORDER BY id DESC`, [lo, f(D.y0)], 30000);
  const str = v => v == null || v === '' ? null : String(v);
  const items = rows.map(x => { const at = new Date(new Date(x.ts).getTime() - shift); const ok = !DMSJ.isFail(x.code, x.message);
    return { at, ok, code: x.code == null ? null : String(x.code), message: x.message == null ? null : String(x.message), dealer: x.dealer == null ? null : String(x.dealer), api: x.api == null ? null : String(x.api),
      uid: C.dealer === 'channel_user_id' ? str(x.dealer) : str(x.x_uid), shop: str(x.x_shop), region: str(x.x_region), city: str(x.x_city) }; });
  return { items, source: `${r.table} (live, last ${rows.length} rows since yesterday 00:00 KSA)`, latest: items[0] ? items[0].at : null };
}
async function dmsRollup(D) {
  /* fallback: the console's own hourly rollups + masked failure events (5-min sync of the same ledger) */
  const c = db.console;
  const [stats, ev, st] = await Promise.all([
    c.query(`SELECT bucket, calls, errors FROM dms_journey_stats WHERE journey = 'activation' AND bucket >= $1 ORDER BY bucket`, [D.y0]),
    c.query(`SELECT at, dealer, code, message, api FROM dms_journey_events WHERE journey = 'activation' AND at >= $1 ORDER BY at DESC LIMIT 2000`, [D.y0]),
    c.query(`SELECT updated_at, note FROM dms_journey_state WHERE journey = 'activation'`)
  ]);
  const okIn = (a, b) => stats.rows.filter(x => x.bucket >= a && x.bucket < b).reduce((s, x) => s + N(x.calls) - N(x.errors), 0);
  const attemptsIn = (a, b) => stats.rows.filter(x => x.bucket >= a && x.bucket < b).reduce((s, x) => s + N(x.calls), 0);
  const H = ms => new Date(Math.floor(ms / 3600e3) * 3600e3);
  const fails = ev.rows.map(x => ({ at: x.at, ok: false, code: x.code, message: x.message, dealer: x.dealer, api: x.api }));
  return { rollup: true, okIn, attemptsIn, H, fails, updated: st.rows[0] ? st.rows[0].updated_at : null, note: st.rows[0] ? st.rows[0].note : null };
}
/* the DMS activity rows: STAFF ID = the DMS username of the dealer staff who sold (channel_username),
 * DEALER CODE = that user's dms_users.dealer_code, location = region · city of the ledger row */
async function dmsActivity(rows) {
  let codeOf = () => null;
  try { codeOf = await dmsDealerCodes(rows.map(x => ({ uid: x.uid, user: x.dealer }))); } catch (e) { /* lookup unavailable — the column stays empty */ }
  return rows.map(x => ({ at: x.at, who: clip(x.dealer, 40), staff: clip(x.dealer, 40), dcode: clip(codeOf(x.uid, x.dealer), 40), dname: clip(x.shop, 60),
    where: clip([x.region, x.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ') || null, 40),
    tx: clip(x.api || 'sim activation', 60), code: clip(x.code, 24), msg: maskNum(clip(x.message, 140)), cls: cls(x.ok, x.code, x.message) }));
}
async function dmsChannel(win) {
  const D = days(); const w0 = new Date(D.now.getTime() - win * 60e3);
  const base = { key: 'dms', ...CHANNELS.dms };
  try {
    const L = await dmsLive(win, D);
    const it = L.items;
    const inW = it.filter(x => x.at >= w0);
    const cnt = (a, b) => it.filter(x => x.ok && x.at >= a && (!b || x.at < b)).length;
    const outcomes = tally(inW.map(x => cls(x.ok, x.code, x.message)));
    return { ...base, activations: { h1: cnt(D.h1), today: cnt(D.day0), yesterday: cnt(D.y0, D.day0), ySame: cnt(D.y0, D.ySame),
        attemptsToday: it.filter(x => x.at >= D.day0).length },
      outcomes, errorFacing: facing(inW, x => x.dealer, x => cls(x.ok, x.code, x.message)),
      failures: reasons(inW.filter(x => !x.ok), x => (x.message || x.code || 'unknown'), x => cls(false, x.code, x.message)),
      activity: await dmsActivity(it.slice(0, 14)),
      source: { label: L.source, latest: L.latest, live: true } };
  } catch (e) {
    const R = await dmsRollup(D);
    const inW = R.fails.filter(x => x.at >= w0);
    const h1b = R.H(D.h1.getTime());
    const attW = R.attemptsIn(R.H(w0.getTime()), D.now), failW = inW.length;
    return { ...base, degraded: true,
      activations: { h1: R.okIn(h1b, D.now), today: R.okIn(D.day0, D.now), yesterday: R.okIn(D.y0, D.day0), ySame: R.okIn(D.y0, D.ySame), attemptsToday: R.attemptsIn(D.day0, D.now), hourly: true },
      outcomes: { ...tally(inW.map(x => cls(false, x.code, x.message))), success: Math.max(0, attW - failW), total: Math.max(attW, failW) },
      errorFacing: facing(inW, x => x.dealer, x => cls(false, x.code, x.message)),
      failures: reasons(inW, x => (x.message || x.code || 'unknown'), x => cls(false, x.code, x.message)),
      activity: await dmsActivity(R.fails.slice(0, 14)),
      source: { label: 'console rollups of the DMS ledger (hourly) + failure events — live ledger not reachable: ' + clip(e.message, 160), latest: R.updated, live: false, note: R.note } };
  }
}

/* ---------------------------------------------------------------- Mobile › Self-activation (customer app / web) */
const ACT_API = '/bss/account/create-individual-subscriber';

/* WHO SOLD a self-activation (alpha.145, Sales Ops ask: no platform, no number, the DEALER ID instead).
 * activation_logs knows neither the dealer nor the order: the selfcare backend logs every Optiva / Semati call through
 * ExternalRequests::ActivationLog.create without the order (onboarding_order_id stays NULL) and the BSS request carries
 * the constant dealerCode 1. The dealer lives on the ORDER: onboarding_orders.seller_id → sellers, set when a dealer
 * sells from the seller app (flow indirect) or the customer orders from a dealer's QR (flow partner); sellers.username is
 * the dealerUsername of that dealer's wallet in Optiva's self-activation portal. A log row reaches its order through the
 * number it carries: the new number (numbers.identifier, indexed on the replica) or the ported one
 * (onboarding_orders.mnp_number, indexed), and the order is the latest one placed in the 7 days before the call.
 * No such order (a SIM replacement on an old line, or a row the replica has not synced yet) = no dealer shown, never a guess.
 * The number is only used for the lookup here; it never leaves this function. */
const DEALER_DAYS = 7;
const FLOW = { 1: 'seller app (indirect)', 2: 'retail POSA', 5: 'dealer QR (partner)', 7: 'retail QR POSA' };
const last9 = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : null; };
const dealerId = v => { const s = String(v).trim(); return /^\+?\d{9,}$/.test(s) ? maskNum(s) : clip(s, 64); };   // a username that is a phone / ID number stays masked
async function selfactDealers(rows) {
  const keys = [...new Set(rows.map(r => last9(r.msisdn)).filter(Boolean))];
  if (!keys.length) return new Map();
  const forms = keys.flatMap(k => ['966' + k, '0' + k, k]);
  const oldest = new Date(Math.min(...rows.map(r => new Date(r.at).getTime())) - DEALER_DAYS * 864e5);
  const r = await db.source.query(`
    SELECT x.num, o.created_at, o.flow_type::text AS flow, nullif(o.external_service_name, '') AS ext, o.store_id::text AS store,
           s.id::text AS sid, s.username, nullif(trim(concat_ws(' ', s.first_name, s.last_name)), '') AS sname
      FROM (SELECT n.identifier::text AS num, n.onboarding_order_id AS oid FROM numbers n
             WHERE n.identifier::text = ANY($1::text[]) AND n.onboarding_order_id IS NOT NULL
            UNION ALL
            SELECT m.mnp_number::text, m.id FROM onboarding_orders m WHERE m.mnp_number = ANY($1::text[])) x
      JOIN onboarding_orders o ON o.id = x.oid
      LEFT JOIN sellers s ON s.id = o.seller_id
     WHERE o.created_at >= $2
     ORDER BY o.created_at DESC`, [forms, oldest]);
  const by = new Map();
  for (const x of r.rows) { const k = last9(x.num); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  return by;
}
/* the order behind one log row: the latest order with that number placed in the 7 days before the call (10 min of slack
 * for the replica's clocks) → dealer (seller username) · reseller (external_service_name) · retail store · direct */
function dealerOf(row, by) {
  const k = last9(row.msisdn); const cands = k && by.get(k); if (!cands) return { dkind: 'none' };
  const t = new Date(row.at).getTime();
  const o = cands.find(x => { const c = new Date(x.created_at).getTime(); return c <= t + 10 * 60e3 && c >= t - DEALER_DAYS * 864e5; });
  if (!o) return { dkind: 'none' };
  const via = FLOW[o.flow] || null;
  if (o.username || o.sid) return { dealer: dealerId(o.username || 'seller ' + o.sid), dname: clip(o.sname, 60), dkind: 'dealer', dvia: via || 'dealer order' };
  if (o.ext) return { dealer: clip(o.ext, 40), dkind: 'reseller', dvia: 'reseller channel' };
  if (o.flow === '2' || o.flow === '7') return { dealer: o.store ? 'store ' + clip(o.store, 20) : null, dkind: 'retail', dvia: via };
  return { dkind: 'direct' };
}
async function selfactChannel(win) {
  const D = days(); const w0 = new Date(D.now.getTime() - win * 60e3);
  const S = db.source;
  const CLS = classCaseSql('status_code', `coalesce(response::text,'')`);
  const [act, byPl, outc, facingR, fails, feed, latest] = await Promise.all([
    S.query(`SELECT count(*) FILTER (WHERE state = true AND created_at >= $1)::int h1, count(*) FILTER (WHERE state = true AND created_at >= $2)::int today,
                    count(*) FILTER (WHERE state = true AND created_at >= $3 AND created_at < $2)::int yesterday,
                    count(*) FILTER (WHERE state = true AND created_at >= $3 AND created_at < $4)::int ysame,
                    count(*) FILTER (WHERE created_at >= $2 AND state IS DISTINCT FROM true)::int fail_today
               FROM activation_logs WHERE api = $5 AND created_at >= $3`, [D.h1, D.day0, D.y0, D.ySame, ACT_API]),
    S.query(`SELECT coalesce(nullif(platform,''),'unknown') k, count(*)::int n FROM activation_logs WHERE api = $1 AND state = true AND created_at >= $2 GROUP BY 1 ORDER BY 2 DESC`, [ACT_API, D.day0]),
    S.query(`SELECT count(*)::int total, count(*) FILTER (WHERE state = true)::int success,
                    count(*) FILTER (WHERE state IS DISTINCT FROM true AND (${CLS}) = 'business')::int business,
                    count(*) FILTER (WHERE state IS DISTINCT FROM true AND (${CLS}) = 'technical')::int technical
               FROM activation_logs WHERE created_at >= $1`, [w0]),
    S.query(`SELECT coalesce(nullif(platform,''),'unknown') who, count(*) FILTER (WHERE state = true)::int ok,
                    count(*) FILTER (WHERE state IS DISTINCT FROM true AND (${CLS}) = 'business')::int biz,
                    count(*) FILTER (WHERE state IS DISTINCT FROM true AND (${CLS}) = 'technical')::int tech, count(*)::int total
               FROM activation_logs WHERE created_at >= $1 GROUP BY 1 ORDER BY (count(*) FILTER (WHERE state IS DISTINCT FROM true)) DESC LIMIT 12`, [w0]),
    S.query(`SELECT left(coalesce(nullif(response->>'responseMessage',''), nullif(response->>'message',''), nullif(status_code,''), 'no response'), 90) reason,
                    (${CLS}) c, count(*)::int n
               FROM activation_logs WHERE created_at >= $1 AND state IS DISTINCT FROM true GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`, [w0]),
    S.query(`SELECT created_at at, platform, api, status_code, state, msisdn, left(coalesce(response->>'responseMessage', response->>'message', ''), 140) msg, (${CLS}) c
               FROM activation_logs ORDER BY created_at DESC LIMIT 14`),
    S.query(`SELECT max(created_at) t FROM activation_logs`)
  ]);
  const a = act.rows[0] || {};
  const apiShort = s => String(s || '').replace(/^\/(bss|semati)\//, '$1 · ').replace(/^.*\//, '');
  let dealers = new Map(), dealerErr = null;
  try { dealers = await selfactDealers(feed.rows); } catch (e) { dealerErr = clip(e.message, 160); }   // lookup down → the column says so, the page still answers
  return { key: 'selfact', ...CHANNELS.selfact,
    activations: { h1: N(a.h1), today: N(a.today), yesterday: N(a.yesterday), ySame: N(a.ysame), attemptsToday: N(a.today) + N(a.fail_today), byPlatform: byPl.rows },
    outcomes: { success: N(outc.rows[0].success), business: N(outc.rows[0].business), technical: N(outc.rows[0].technical), total: N(outc.rows[0].total) },
    errorFacing: facingR.rows.map(x => ({ who: x.who, ok: N(x.ok), biz: N(x.biz), tech: N(x.tech), total: N(x.total) })),
    failures: fails.rows.map(x => ({ reason: maskNum(x.reason), n: N(x.n), cls: x.c })),
    activity: feed.rows.map(x => ({ at: x.at, who: clip(x.platform || '—', 20), ...(dealerErr ? { dkind: 'unavailable' } : dealerOf(x, dealers)),
      tx: apiShort(x.api), code: clip(x.status_code, 24), msg: maskNum(clip(x.msg, 140)), cls: x.state === true ? 'success' : x.c })),
    dealerLookup: dealerErr ? { ok: false, error: dealerErr } : { ok: true, days: DEALER_DAYS },
    source: { label: 'selfcare activation_logs (prod replica) · activation = create-individual-subscriber succeeded', latest: latest.rows[0] ? latest.rows[0].t : null, live: true } };
}

/* ---------------------------------------------------------------- Fixed › QR code & SDA (sda_ops) */
const OUTCOME_CLS = { COMPLETED: 'success', IN_PROGRESS: 'pending', STALLED: 'business', CANCELLED: 'business', EXPIRED: 'business' };
function errCat(cat, code, msg) {   // error_events / last_error_category → class
  const t = `${cat || ''} ${code || ''} ${msg || ''}`;
  if (/timeout|timed|1500|bss_fault|fault|5\d\d|unavailable|exception|gateway/i.test(t)) return 'technical';
  return 'business';
}
async function fixedChannel(ch, win) {
  const pool = db.ops; if (!pool) throw Object.assign(new Error('Fixed data source not configured (OPS_DATABASE_URL)'), { status: 503 });
  const D = days(); const w0 = new Date(D.now.getTime() - win * 60e3);
  const isQr = ch === 'qr';
  const scope = isQr ? `oa.channel = 'epurchase' AND oa.referral_code IS NOT NULL` : `oa.channel = 'sda'`;
  const whoCol = isQr ? `oa.referral_code` : `coalesce(d.dealer_code, oa.dealer_id::text)`;
  const FROM = `FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id`;
  const evCh = isQr ? 'qr' : 'sda';
  const [act, outc, facingR, fails, feed, errs, latest] = await Promise.all([
    pool.query(`SELECT count(*) FILTER (WHERE oa.outcome = 'COMPLETED' AND oa.completed_at >= $1)::int h1,
                       count(*) FILTER (WHERE oa.outcome = 'COMPLETED' AND oa.completed_at >= $2)::int today,
                       count(*) FILTER (WHERE oa.outcome = 'COMPLETED' AND oa.completed_at >= $3 AND oa.completed_at < $2)::int yesterday,
                       count(*) FILTER (WHERE oa.outcome = 'COMPLETED' AND oa.completed_at >= $3 AND oa.completed_at < $4)::int ysame,
                       count(*) FILTER (WHERE oa.started_at >= $2)::int attempts_today
                  ${FROM} WHERE ${scope} AND oa.started_at >= $3 - interval '2 days'`, [D.h1, D.day0, D.y0, D.ySame]),
    pool.query(`SELECT oa.outcome::text o, count(*)::int n ${FROM} WHERE ${scope} AND oa.started_at >= $1 GROUP BY 1`, [w0]),
    pool.query(`SELECT ${whoCol} who, max(coalesce(d.dealer_name, d.staff_name)) nm, max(coalesce(oa.region, d.region)) region,
                       count(*) FILTER (WHERE oa.outcome = 'COMPLETED')::int ok,
                       count(*) FILTER (WHERE oa.outcome IN ('STALLED','CANCELLED','EXPIRED'))::int biz,
                       count(*) FILTER (WHERE oa.outcome = 'IN_PROGRESS')::int pend, count(*)::int total,
                       max(oa.last_error_category) cat
                  ${FROM} WHERE ${scope} AND oa.started_at >= $1 GROUP BY 1
                 ORDER BY (count(*) FILTER (WHERE oa.outcome IN ('STALLED','CANCELLED','EXPIRED'))) DESC, total DESC LIMIT 12`, [w0]),
    pool.query(`SELECT category, max(code) code, max(message) msg, count(*)::int n FROM error_events
                 WHERE occurred_at >= $1 AND channel = $2 GROUP BY 1 ORDER BY 4 DESC LIMIT 10`, [w0, evCh]),
    pool.query(`SELECT oa.started_at at, ${whoCol} who, coalesce(oa.region, d.region) region, oa.workflow::text wf, oa.outcome::text o, oa.step_reached step,
                       oa.last_error_category cat, oa.order_number ord, coalesce(d.staff_code, oa.dealer_id::text) staff, d.dealer_code dcode, d.dealer_name dname
                  ${FROM} WHERE ${scope} ORDER BY oa.started_at DESC LIMIT 14`),
    pool.query(`SELECT count(*)::int n, count(*) FILTER (WHERE client_side)::int client FROM error_events WHERE occurred_at >= $1 AND channel = $2`, [w0, evCh]),
    pool.query(`SELECT max(oa.started_at) t ${FROM} WHERE ${scope}`)
  ]);
  const a = act.rows[0] || {};
  const by = o => N((outc.rows.find(x => x.o === o) || {}).n);
  const biz = by('STALLED') + by('CANCELLED') + by('EXPIRED'), pending = by('IN_PROGRESS');
  const tech = errs.rows[0] ? N(errs.rows[0].n) - N(errs.rows[0].client) : 0;   // platform-side error events in the window
  const wfLabel = s => String(s || '').replace(/^ePurchase/, 'e-purchase').replace(/^sda/, 'SDA').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^(e-purchase|SDA) ?/, '$1 · ');
  return { key: ch, ...CHANNELS[ch],
    activations: { h1: N(a.h1), today: N(a.today), yesterday: N(a.yesterday), ySame: N(a.ysame), attemptsToday: N(a.attempts_today) },
    outcomes: { success: by('COMPLETED'), business: biz, technical: tech, pending, total: by('COMPLETED') + biz + pending,
      note: 'orders started in the window: completed · stalled / cancelled / expired · technical = platform-side error events' },
    errorFacing: facingR.rows.map(x => ({ who: clip(x.who, 30), label: clip(x.nm, 40), where: clip(x.region, 24), ok: N(x.ok), biz: N(x.biz), tech: 0, pend: N(x.pend), total: N(x.total), cat: x.cat })),
    failures: fails.rows.map(x => ({ reason: clip(String(x.category || 'unknown').replace(/_/g, ' '), 60) + (x.msg ? ' — ' + maskNum(clip(x.msg, 70)) : ''), n: N(x.n), cls: errCat(x.category, x.code, x.msg) })),
    activity: feed.rows.map(x => ({ at: x.at, who: clip(x.who, 30), staff: isQr ? null : clip(x.staff, 64), dcode: isQr ? null : clip(x.dcode, 30), dname: isQr ? null : clip(x.dname, 60), where: clip(x.region, 24), tx: wfLabel(x.wf) + (x.step ? ' · ' + x.step : ''), code: x.o,
      msg: x.cat ? String(x.cat).replace(/_/g, ' ') : (x.o === 'COMPLETED' ? 'Completed' : x.o === 'IN_PROGRESS' ? 'In progress' : ''), cls: OUTCOME_CLS[x.o] || 'business', ord: x.ord ? '…' + String(x.ord).slice(-5) : null })),
    source: { label: isQr ? 'sda_ops order_attempts · e-purchase orders opened from a dealer QR code' : 'sda_ops order_attempts · SDA dealer orders · error_events', latest: latest.rows[0] ? latest.rows[0].t : null, live: true } };
}

/* ---------------------------------------------------------------- shared aggregation helpers */
function tally(classes) { const t = { success: 0, business: 0, technical: 0, total: classes.length }; classes.forEach(c => { if (t[c] != null) t[c]++; }); return t; }
function facing(items, whoOf, clsOf) {
  const m = new Map();
  items.forEach(x => { const who = whoOf(x) || '—'; const e = m.get(who) || { who: clip(who, 40), ok: 0, biz: 0, tech: 0, total: 0 }; const c = clsOf(x);
    if (c === 'success') e.ok++; else if (c === 'technical') e.tech++; else e.biz++; e.total++; m.set(who, e); });
  return [...m.values()].sort((a, b) => (b.biz + b.tech) - (a.biz + a.tech) || b.total - a.total).slice(0, 12);
}
function reasons(items, keyOf, clsOf) {
  const m = new Map();
  items.forEach(x => { const k = maskNum(clip(keyOf(x), 90)); const e = m.get(k) || { reason: k, n: 0, cls: clsOf(x) }; e.n++; m.set(k, e); });
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 10);
}

/* ---------------------------------------------------------------- cache + routes */
const CACHE = new Map(); const TTL_MS = 20e3;
function cached(key, fn) {
  const c = CACHE.get(key); const now = Date.now();
  if (c && c.at && now - c.at < TTL_MS) return Promise.resolve(c.data);
  if (c && c.p) return c.p;
  const p = fn().then(d => { CACHE.set(key, { at: Date.now(), data: d }); return d; }).catch(e => { CACHE.delete(key); throw e; });
  CACHE.set(key, { p, data: c && c.data }); return p;
}
async function channel(ch, win) {
  if (!CHANNELS[ch]) throw Object.assign(new Error('unknown channel'), { status: 400 });
  const w = WINDOWS[win] || 60;
  return cached(`${ch}:${w}`, async () => {
    const fn = ch === 'dms' ? () => dmsChannel(w) : ch === 'selfact' ? () => selfactChannel(w) : () => fixedChannel(ch, w);
    let d;
    try { d = await fn(); }
    catch (e) { d = { key: ch, ...CHANNELS[ch], error: clip(e.message, 200), activations: null, outcomes: null, errorFacing: [], failures: [], activity: [], source: { label: 'not available', live: false } }; }
    d.at = new Date().toISOString(); d.window = w;
    return d;
  });
}

function mount(app, { requireView, requireCap, audit }) {
  app.use('/api/salesops', requireView('salesops'));
  /* the strip: the four channels at a glance (health + the day's numbers) — one call, 20 s cache */
  /* alerts are opt-in (?alerts=1): the Sales Ops wall shows IT Operations' notices, not the alert engine */
  const wantAlerts = req => req.query.alerts === '1';
  app.get('/api/salesops/overview', async (req, res) => {
    try {
      const [health, nts, ...chs] = await Promise.all([wantAlerts(req) ? openAlerts() : null, notices(null), ...ORDER.map(k => channel(k, 60))]);
      res.json({ at: new Date().toISOString(), order: ORDER, notices: nts, alerts: !!health,
        channels: Object.fromEntries(chs.map(c => [c.key, { key: c.key, label: c.label, short: c.short, biz: c.biz, unit: c.unit, error: c.error || null, degraded: !!c.degraded,
          health: health ? health[c.key] : null, activations: c.activations, outcomes: c.outcomes, latest: c.source && c.source.latest || null }])) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/salesops/channel/:ch', async (req, res) => {
    try {
      const ch = String(req.params.ch || '').toLowerCase(); if (!CHANNELS[ch]) return res.status(404).json({ error: 'unknown channel' });
      const win = WINDOWS[Number(req.query.window)] || 60;
      const [d, health, nts] = await Promise.all([channel(ch, win), wantAlerts(req) ? openAlerts() : null, notices(ch)]);
      res.json({ ...d, health: health ? health[ch] : null, alerts: !!health, notices: nts, windows: Object.keys(WINDOWS).map(Number) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/salesops/notices', async (req, res) => {
    try {
      await ensure();
      const all = req.query.all === '1';
      const r = await db.console.query(all
        ? `SELECT id, channel, level, title, body, starts_at, ends_at, created_by, created_at, cleared_at, cleared_by FROM salesops_notices ORDER BY created_at DESC LIMIT 100`
        : `SELECT id, channel, level, title, body, starts_at, ends_at, created_by, created_at FROM salesops_notices WHERE cleared_at IS NULL AND (ends_at IS NULL OR ends_at > now()) ORDER BY created_at DESC LIMIT 50`);
      res.json({ rows: r.rows, canPost: !!(req.caps && req.caps.postNotices) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/salesops/notices', requireCap('postNotices'), async (req, res) => {
    try {
      await ensure();
      const b = req.body || {};
      const ch = ['all', ...ORDER].includes(b.channel) ? b.channel : 'all';
      const level = LEVELS.includes(b.level) ? b.level : 'info';
      const title = clip(String(b.title || '').trim(), 140); if (!title) return res.status(400).json({ error: 'title required' });
      const body = clip(String(b.body || '').trim(), 600) || null;
      const mins = Math.min(72 * 60, Math.max(0, Number(b.minutes) || 0));
      const r = await db.console.query(
        `INSERT INTO salesops_notices (channel, level, title, body, ends_at, created_by) VALUES ($1,$2,$3,$4, CASE WHEN $5::int > 0 THEN now() + ($5||' minutes')::interval END, $6) RETURNING *`,
        [ch, level, title, body, mins, req.sessionEmail || null]);
      audit(req, 'SALESOPS_NOTICE', `${ch}:${level}`, { id: r.rows[0].id, title, minutes: mins || null });
      res.json({ ok: true, notice: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/salesops/notices/:id/clear', requireCap('postNotices'), async (req, res) => {
    try {
      await ensure();
      const r = await db.console.query(`UPDATE salesops_notices SET cleared_at = now(), cleared_by = $2 WHERE id = $1 AND cleared_at IS NULL RETURNING id, channel, level, title`, [Number(req.params.id), req.sessionEmail || null]);
      if (!r.rowCount) return res.status(404).json({ error: 'notice not found or already cleared' });
      audit(req, 'SALESOPS_NOTICE_CLEAR', `${r.rows[0].channel}:${r.rows[0].level}`, { id: r.rows[0].id, title: r.rows[0].title });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  console.log('[salesops] Sales Operations wall mounted — /api/salesops/{overview,channel/:ch,notices}');
}

module.exports = { mount, CHANNELS, ORDER, channelOfAlert };
