/* gateways.js — the PAYMENT GATEWAY REGISTRY: one place that says which customer payment gateways are live.
 *
 * Why (9 Sep 2026): UPG (SalamPay/Merchalink, vendor 'salam') and Tap were switched off on 3 Sep 16:27 KSA and HyperPay
 * became the only customer gateway. Nothing in the console knew: the per-gateway watchdog rules (upg_hard_down,
 * tap_hard_down) kept opening P1s, the seasonal per-gateway drop detector paged "UPG down" every hour, Troubleshoot
 * kept offering a ⇄ UPG correlation on HyperPay rows, and the HyperPay watch relied on a hard-coded cutover env.
 * Every one of those now reads THIS registry, so enabling / disabling a gateway is a settings toggle, audited, with
 * the consequences applied in one tick: rules whose dim.gateway is a disabled gateway are PAUSED (their open alerts
 * resolve), the drop detector skips the vendor, the UI hides the gateway's correlation actions and labels the
 * deep-dive, the HyperPay cutover comes from `since` of the enabled gateway.
 *
 * Model (console_settings key 'gateways'):
 *   { vendors: { salam:    { enabled: false, since: '2026-09-03T13:27:00Z', note: 'switched off — HyperPay only' },
 *                tap:      { enabled: false, since: ..., note },
 *                hyperpay: { enabled: true,  since: '2026-09-03T13:27:00Z', note: 'customer gateway' },
 *                apollo:   { enabled: false, ... } } }
 * Keys are the app's `payments.vendor` values. Rule dims use the display name (dim.gateway 'UPG' / 'HyperPay' / 'Tap')
 * — KEY_OF maps both spellings to the vendor key. Traffic (last success / volume 24 h per vendor) is read from the
 * replica so the settings card can show "still receiving traffic" when someone disables a gateway that is not off. */
'use strict';
const db = require('./db');
const settings = require('./settings');

const VENDORS = {
  salam:    { label: 'UPG',      long: 'UPG — SalamPay / Merchalink (in-house gateway)', gw: 'UPG' },
  hyperpay: { label: 'HyperPay', long: 'HyperPay',                                        gw: 'HyperPay' },
  tap:      { label: 'Tap',      long: 'Tap Payments',                                    gw: 'Tap' },
  apollo:   { label: 'Apollo',   long: 'Apollo',                                          gw: 'Apollo' },
};
const KEY_OF = { salam: 'salam', upg: 'salam', merchalink: 'salam', salampay: 'salam', hyperpay: 'hyperpay', hyper: 'hyperpay', tap: 'tap', apollo: 'apollo' };
const keyOf = v => { const s = String(v || '').trim().toLowerCase(); if (KEY_OF[s]) return KEY_OF[s]; for (const k of Object.keys(KEY_OF)) if (s.includes(k)) return KEY_OF[k]; return s || null; };
const labelOf = v => { const k = keyOf(v); return (VENDORS[k] && VENDORS[k].label) || String(v || ''); };

const DEFAULT_SINCE = process.env.HYPERPAY_CUTOVER || '2026-09-03T16:27:00+03:00';
const DEFAULTS = { vendors: {
  salam:    { enabled: false, since: new Date(DEFAULT_SINCE).toISOString(), note: 'switched off 3 Sep 2026 16:27 KSA — HyperPay is the only customer gateway' },
  tap:      { enabled: false, since: new Date(DEFAULT_SINCE).toISOString(), note: 'switched off 3 Sep 2026 16:27 KSA' },
  hyperpay: { enabled: true,  since: new Date(DEFAULT_SINCE).toISOString(), note: 'customer gateway since the 3 Sep cutover' },
  apollo:   { enabled: false, since: null, note: '' },
} };

let _cache = null, _cacheAt = 0;
async function getConfig() {
  if (_cache && Date.now() - _cacheAt < 30000) return _cache;
  const c = (await settings.getSetting('gateways')) || {};
  const vendors = {};
  for (const k of Object.keys(VENDORS)) vendors[k] = { ...DEFAULTS.vendors[k], ...((c.vendors || {})[k] || {}) };
  _cache = { vendors }; _cacheAt = Date.now();
  return _cache;
}
/* patch = { vendors: { salam: { enabled, note } } } — `since` is stamped automatically on every enabled flip */
async function setConfig(patch, actor) {
  const cur = await getConfig(); const next = { vendors: {} }; const changes = [];
  for (const k of Object.keys(VENDORS)) {
    const was = cur.vendors[k], p = (patch && patch.vendors && patch.vendors[k]) || {};
    const v = { ...was };
    if ('note' in p) v.note = String(p.note == null ? '' : p.note).slice(0, 200);
    if ('enabled' in p && !!p.enabled !== !!was.enabled) { v.enabled = !!p.enabled; v.since = new Date().toISOString(); v.by = actor || null; changes.push({ vendor: k, enabled: v.enabled }); }
    if ('since' in p && p.since && !isNaN(new Date(p.since))) v.since = new Date(p.since).toISOString();
    next.vendors[k] = v;
  }
  await settings.setSetting('gateways', next); _cache = null;
  // a gateway that was just switched OFF: its open watchdog / drop alerts are noise from now on — resolve them with a note
  for (const ch of changes.filter(x => !x.enabled)) { try { await resolveOpenAlerts(ch.vendor, actor); } catch (e) { console.error('[gateways] resolve', e.message); } }
  return { config: next, changes };
}
async function resolveOpenAlerts(vendorKey, actor) {
  const gw = VENDORS[vendorKey].gw;
  const rows = (await db.console.query(
    `SELECT id, rule_key, name FROM alerts WHERE status='open' AND (rule_key = $1 OR dim->>'gateway' = $2 OR dim->>'vendor' = $3)`,
    [`gateway:payment:${vendorKey}`, gw, vendorKey])).rows;
  for (const r of rows) {
    await db.console.query(`UPDATE alerts SET status='resolved', resolved_at=now() WHERE id=$1`, [r.id]);
    await db.console.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`, [r.id, `Auto-resolved: ${gw} gateway marked DISABLED in Settings → Payment gateways${actor ? ` by ${actor}` : ''} — this alert only makes sense while the gateway carries traffic`]);
  }
  return rows.length;
}

const isEnabled = async v => { const k = keyOf(v); if (!k || !VENDORS[k]) return true; return !!(await getConfig()).vendors[k].enabled; };
/* a rule is gateway-scoped when its dim carries gateway/vendor; paused = that gateway is disabled */
async function pausedReason(rule) {
  const d = (rule && rule.dim) || {}; const v = d.gateway || d.vendor; if (!v) return null;
  const k = keyOf(v); if (!k || !VENDORS[k]) return null;
  const cfg = (await getConfig()).vendors[k];
  return cfg.enabled ? null : `paused — ${VENDORS[k].label} gateway disabled${cfg.since ? ' since ' + ksa(cfg.since) : ''} (Settings → Payment gateways)`;
}
async function disabledVendorKeys() { const c = await getConfig(); return Object.keys(c.vendors).filter(k => !c.vendors[k].enabled); }
async function cutover() {   // when did the current single customer gateway take over — for the HyperPay watch clamp
  const c = await getConfig(); const on = Object.entries(c.vendors).filter(([, v]) => v.enabled && v.since).map(([, v]) => v.since).sort();
  return on[0] || DEFAULT_SINCE;
}
function ksa(iso) { try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '') + ' KSA'; } catch (e) { return String(iso); } }

/* traffic per vendor from the replica (cached 60 s): last success, last payment, volume 24 h */
let _tr = null, _trAt = 0;
async function traffic() {
  if (_tr && Date.now() - _trAt < 60000) return _tr;
  try {
    const r = await db.source.query(`SELECT coalesce(vendor,'—') AS vendor, count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS n24,
        count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND status='success')::int AS ok24,
        max(created_at) FILTER (WHERE status='success') AS last_success, max(created_at) AS last_any
      FROM payments WHERE created_at > now() - interval '30 days' GROUP BY 1`);
    const out = {}; for (const x of r.rows) { const k = keyOf(x.vendor) || x.vendor; out[k] = { raw: x.vendor, n24: x.n24, ok24: x.ok24, last_success: x.last_success, last_any: x.last_any }; }
    _tr = out; _trAt = Date.now();
  } catch (e) { _tr = { error: e.message }; _trAt = Date.now(); }
  return _tr;
}
/* the settings card + self-check: config + traffic + the rules each gateway pauses */
async function status() {
  const cfg = await getConfig(); const tr = await traffic();
  const rules = (await db.console.query(`SELECT key, name, severity, enabled, dim FROM alert_rules WHERE dim ? 'gateway' OR dim ? 'vendor'`).catch(() => ({ rows: [] }))).rows;
  const open = (await db.console.query(`SELECT rule_key, dim FROM alerts WHERE status='open' AND (rule_key LIKE 'gateway:payment:%' OR dim ? 'gateway')`).catch(() => ({ rows: [] }))).rows;
  const list = Object.keys(VENDORS).map(k => {
    const v = cfg.vendors[k], t = (tr && tr[k]) || null;
    const myRules = rules.filter(r => keyOf((r.dim || {}).gateway || (r.dim || {}).vendor) === k);
    const myOpen = open.filter(a => a.rule_key === `gateway:payment:${k}` || keyOf((a.dim || {}).gateway) === k).length;
    const stillTraffic = !v.enabled && t && t.n24 > 0;
    return { key: k, label: VENDORS[k].label, long: VENDORS[k].long, enabled: !!v.enabled, since: v.since, by: v.by || null, note: v.note || '',
      traffic: t ? { n24: t.n24, ok24: t.ok24, last_success: t.last_success, last_any: t.last_any } : null,
      rules: myRules.map(r => ({ key: r.key, name: r.name, severity: r.severity, enabled: r.enabled })), open_alerts: myOpen,
      warning: stillTraffic ? `${t.n24} payment(s) in the last 24 h although marked disabled — is it really off?` : (v.enabled && t && t.n24 === 0 ? 'no payments in 24 h although marked enabled' : null) };
  });
  return { gateways: list, traffic_error: tr && tr.error || null, cutover: await cutover() };
}

module.exports = { VENDORS, keyOf, labelOf, getConfig, setConfig, isEnabled, pausedReason, disabledVendorKeys, cutover, traffic, status, resolveOpenAlerts };
