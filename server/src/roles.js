/* Role management + permissions + PII governance.
 * 5 roles (matching the previous project's model):
 *   super_admin · admin · report_manager · errors_manager · events_manager
 * Views: topology, journeys, integrations, alerts, errors, dashboards, settings, users
 * Caps:  editRules, manageSync, manageUsers, unmaskPII, export, ackErrors
 */
/* FIXED_ENABLED=1 (unified console) exposes the Fixed / Salam Home views: fixed (dashboards), maps
 * (dealers + QR maps), b2c (Salam Home app journeys). Off → the views do not exist anywhere in the
 * console (nav, matrix, router), so /digital-console keeps its exact pre-unified shape. */
const FIXED_ENABLED = /^(1|true|yes)$/i.test(String(process.env.FIXED_ENABLED || ''));
/* Fixed pages are gated one by one (5 Sep 2026): the matrix shows every Fixed page like the Mobile ones.
 * 'fixed' = the hub itself + Overview; the rest map 1:1 to the Fixed ▾ menu. Old overrides saved with
 * 'maps' / 'b2c' are translated (FIXED_LEGACY). */
const FIXED_VIEWS = FIXED_ENABLED ? ['fixed','fixed_epurchase','fixed_salamhome','fixed_maps','fixed_reports','fixed_errors','fixed_alerts','fixed_explore'] : [];
const FIXED_LEGACY = { maps: 'fixed_maps', b2c: 'fixed_salamhome' };
// which view each Fixed hub tab needs (shared with the frontend via /api/me → fixedTabViews)
const FIXED_TAB_VIEW = { overview:'fixed', epurchase:'fixed_epurchase', salamhome:'fixed_salamhome', map:'fixed_maps', qr:'fixed_maps',
  dash:'fixed_reports', report:'fixed_reports', errors:'fixed_errors', alerts:'fixed_alerts', playbook:'fixed_explore', diagrams:'fixed_explore' };
const ALL_VIEWS = ['dashboard','monitoring','dms', ...FIXED_VIEWS, 'workbench','alerts','errors','analytics','explore','settings','users'];
const CAPS = ['editRules','manageSync','manageUsers','unmaskPII','export','ackErrors','useYusr','customizeDashboard'];
// human labels for the permissions matrix UI
const VIEW_LABELS = { dashboard:'Dashboard', monitoring:'Monitoring', dms:'DMS', workbench:'L2 Workbench', alerts:'Alerts',
  errors:'Troubleshoot', analytics:'Analytics / SLA', explore:'Explore links', settings:'Settings', users:'User management',
  fixed:'Fixed · Overview', fixed_epurchase:'Fixed · E-purchase', fixed_salamhome:'Fixed · Salam Home app', fixed_maps:'Fixed · SDA map & QR codes',
  fixed_reports:'Fixed · Reports & KPI digest', fixed_errors:'Fixed · Errors', fixed_alerts:'Fixed · Alerts', fixed_explore:'Fixed · Playbook & Diagrams' };
const CAP_LABELS = { editRules:'Edit rules', manageSync:'Manage sync', manageUsers:'Manage users',
  unmaskPII:'Unmask PII', export:'Export data', ackErrors:'Ack incidents',
  useYusr:'Use Yusr AI', customizeDashboard:'Customize dashboards' };
/* 2 Sep 2026 view-model change: 'dashboard' and 'dms' became real gated views (dashboard used to be
 * hardcoded-visible, dms rode on 'monitoring'); topology/journeys/integrations collapsed into one
 * 'explore' view = the whole Explore menu (topology, API GW, docs, journeys, integrations, Sub360).
 * LEGACY_VIEW maps keys from overrides saved before the change. */
const LEGACY_VIEW = { topology:'explore', journeys:'explore', integrations:'explore' };

const ROLES = {
  super_admin: {
    label: 'Super Admin', team: 'Digital Ops', rank: 1,
    views: ALL_VIEWS,
    caps: { editRules:true, manageSync:true, manageUsers:true, unmaskPII:true, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Full control. Can unmask PII (live-fetched, never stored) and manage users.'
  },
  admin: {
    label: 'Admin', team: 'Digital Ops', rank: 2,
    views: ['dashboard','monitoring','dms', ...FIXED_VIEWS, 'workbench','alerts','errors','analytics','explore','settings'],
    /* unmaskPII granted to admin on 21 Aug 2026 at the owner's request — per-request ACT, never a
     * mode: caller must pass unmask=1, value fetched live, every reveal audited as pii.unmask. */
    caps: { editRules:true, manageSync:true, manageUsers:false, unmaskPII:true, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Manages rules, sync mode and dashboards. Can unmask PII on demand (audited); cannot manage users.'
  },
  report_manager: {
    label: 'Sales Ops', team: 'Sales Ops', rank: 3,
    views: ['dashboard','monitoring','dms','explore', ...(FIXED_ENABLED ? ['fixed','fixed_maps','fixed_reports'] : [])],
    caps: { editRules:false, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:false, useYusr:true, customizeDashboard:false },
    note: 'Sales Operations — Dashboard, Monitoring, DMS (dealers), Fixed dealer maps & reports and the Explore pages, with export. PII masked.'
  },
  ...(FIXED_ENABLED ? {
  fixed_ops: {
    label: 'Fixed Ops', team: 'Fixed Ops', rank: 3,
    views: ['dashboard', ...FIXED_VIEWS, 'explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Owns the Fixed side (FTTH · FTTB · 5G home): every Fixed page, Fixed alert rules, Customer 360. No Mobile operate pages. PII masked.'
  },
  b2c_admin: {
    label: 'Salam Home (B2C)', team: 'Fixed Ops', rank: 3,
    views: ['dashboard','fixed','fixed_epurchase','fixed_salamhome','fixed_reports','fixed_errors','explore'],
    caps: { editRules:false, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:false, useYusr:true, customizeDashboard:true },
    note: 'Salam Home app & e-purchase owners — the two channel dashboards, Reports, Errors and Customer 360. PII masked.'
  } } : {}),
  errors_manager: {
    label: 'Errors Manager', team: 'OSS Ops', rank: 3,
    views: ['dashboard','monitoring','errors','alerts','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Owns the Error Control Board & troubleshooting; can tune error-related alerts. PII masked.'
  },
  events_manager: {
    label: 'Events Manager', team: 'Digital Ops', rank: 3,
    views: ['dashboard','monitoring','alerts','explore'],
    caps: { editRules:true, manageSync:true, manageUsers:false, unmaskPII:false, export:false, ackErrors:false, useYusr:true, customizeDashboard:false },
    note: 'Owns alerts/events: defines rules and controls the sync engine. PII masked.'
  },

  // ---- support escalation tiers (BSS / Digital) — retuned 2 Sep 2026 to the agreed scope ----
  l1_bss: {
    label: 'L1 BSS', team: 'BSS Ops', rank: 5,
    views: ['dashboard','monitoring','errors','explore'],
    caps: { editRules:false, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Frontline BSS support — Dashboard, Monitoring, Troubleshoot. PII masked.'
  },
  l2_bss: {
    label: 'L2 BSS', team: 'BSS Ops', rank: 4,
    views: ['dashboard','monitoring','errors','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'BSS escalation — same pages as L1 BSS plus alert-rule tuning. PII masked.'
  },
  l1_digital: {
    label: 'L1 Digital', team: 'Digital Ops', rank: 5,
    views: ['dashboard','monitoring','dms','alerts','explore'],
    caps: { editRules:false, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Frontline Digital support — Dashboard, Monitoring, DMS, Alerts. No Troubleshoot. PII masked.'
  },
  l2_digital: {
    label: 'L2 Digital', team: 'Digital Ops', rank: 4,
    views: ['dashboard','monitoring','dms','errors','alerts','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Digital escalation — all five operate pages. No Workbench, no SLA, no settings. PII masked.'
  },
  l3_digital: {
    label: 'L3 Digital', team: 'Digital Ops', rank: 3,
    views: ['monitoring','errors','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, unmaskPII:true, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Deep Digital escalation — Troubleshoot + Monitoring with audited PII unmask for end-to-end cases.'
  },
  call_center: {
    label: 'Call Center', team: 'Call Center', rank: 6,
    views: ['dashboard','explore'],
    /* unmaskPII granted 2 Sep 2026 (Yosri): agents verify callers and must read real values in
     * Subscriber 360. Stays a per-request ACT — every reveal writes a pii.unmask audit row naming
     * the agent and the record; masked remains the default until the agent presses Unmask. */
    caps: { editRules:false, manageSync:false, manageUsers:false, unmaskPII:true, export:false, ackErrors:false, useYusr:true, customizeDashboard:false },
    note: 'Customer-facing agents — Dashboard and the Explore pages (incl. Subscriber 360), answer with Yusr. PII masked by default; unmask per-view, audited per agent.'
  }
};

function role(name) { return ROLES[name] || ROLES.report_manager; }
function can(name, cap) { return !!role(name).caps[cap]; }
function canView(name, view) { return role(name).views.includes(view); }

/* merge one or more roles into an effective permission set (union of views, OR of caps).
 * `map` lets callers pass an override-merged role map (see rolePerms); defaults to base ROLES. */
function effective(names, map) {
  const M = map || ROLES;
  let list = (Array.isArray(names) ? names : [names]).filter(n => M[n]);
  if (!list.length) list = ['report_manager'];
  const views = [...new Set(list.flatMap(n => M[n].views))];
  const caps = {};
  for (const n of list) for (const [c, v] of Object.entries(M[n].caps)) caps[c] = caps[c] || v;
  const primary = list.slice().sort((a, b) => M[a].rank - M[b].rank)[0]; // best (lowest rank #) wins
  return { roles: list, primary, label: M[primary].label, team: M[primary].team, note: M[primary].note, views, caps };
}

/* Apply super-admin-editable overrides on top of the code defaults, returning a NEW role map.
 * overrides = { roleName: { views:[...], caps:{cap:bool} } }. super_admin is always full (lockout-proof). */
function mergeOverrides(overrides, custom) {
  const ov = overrides || {};
  // translate a saved views array that may predate the 2 Sep 2026 view split
  const xlate = (vs) => {
    const set = new Set();
    for (const v of vs) { if (ALL_VIEWS.includes(v)) set.add(v); else if (LEGACY_VIEW[v]) set.add(LEGACY_VIEW[v]); else if (FIXED_LEGACY[v] && ALL_VIEWS.includes(FIXED_LEGACY[v])) set.add(FIXED_LEGACY[v]); }
    // legacy overrides (any old key present) predate dashboard/dms/explore as gates:
    // dashboard was visible to everyone, dms rode on monitoring — preserve that behavior
    if (vs.some(v => LEGACY_VIEW[v] !== undefined)) {
      set.add('dashboard');
      if (set.has('monitoring')) set.add('dms');
    }
    return ALL_VIEWS.filter(v => set.has(v));
  };
  const out = {};
  for (const [name, base] of Object.entries(ROLES)) {
    const r = { ...base, views: [...base.views], caps: { ...base.caps } };
    const o = ov[name];
    if (o && name !== 'super_admin') {
      if (Array.isArray(o.views)) r.views = xlate(o.views);
      if (o.caps) for (const c of CAPS) if (c in o.caps) r.caps[c] = !!o.caps[c];
    }
    out[name] = r;
  }
  /* custom roles (created from the matrix UI, stored in console_settings.custom_roles):
   * { name: { label, team, views:[...], caps:{...}, note } } — sanitised here so a bad row can
   * never grant an unknown view/cap; overrides for a custom role apply the same way. */
  for (const [name, c] of Object.entries(custom || {})) {
    if (ROLES[name] || !c || typeof c !== 'object') continue;   // can't shadow a built-in
    const r = {
      label: String(c.label || name), team: String(c.team || 'Custom'), rank: 6, custom: true,
      views: xlate(Array.isArray(c.views) ? c.views : []),
      caps: Object.fromEntries(CAPS.map(k => [k, !!(c.caps && c.caps[k])])),
      note: String(c.note || 'Custom role.')
    };
    const o = ov[name];
    if (o) {
      if (Array.isArray(o.views)) r.views = xlate(o.views);
      if (o.caps) for (const k of CAPS) if (k in o.caps) r.caps[k] = !!o.caps[k];
    }
    out[name] = r;
  }
  // super_admin can never be reduced — always sees everything and keeps every capability
  out.super_admin.views = [...ALL_VIEWS];
  for (const c of CAPS) out.super_admin.caps[c] = true;
  return out;
}

/* ---- PII masking ---- */
const PII_FIELDS = new Set([
  'mobile','mobile_number','customer_mobile_number','target_mobile_number','receiver_mobile','msisdn',
  'nationality_id_number','receiver_nationality_id','person_id','PersonId','national_id','nid','id_number',
  'email','receiver_email','customer_name','contact_name','receiver_full_name','name','identifier',
  /* DMS (Clara) field names. `contact_number` reached the Dealer 360 card in clear while the
   * national id beside it was starred out — the same class of gap as `recipient` vs
   * `identifier`: the mask works by KEY NAME, so a schema that spells a phone number differently
   * silently opts out of it. Any new source's identifier columns belong here. */
  'contact_number','email_address','id_number','alternative_number','otp_mobile_number'
]);
function maskValue(field, v) {
  if (v == null || v === '') return v;
  const s = String(v);
  if (/email/.test(field)) { const [u,d] = s.split('@'); return (u? u[0]+'***' : '***') + (d? '@'+d : ''); }
  if (/name/.test(field)) return s.split(/\s+/).map(w => w ? w[0] + '***' : '').join(' ');
  // numbers / ids: keep last 3
  return s.length <= 3 ? '***' : '*'.repeat(Math.max(3, s.length - 3)) + s.slice(-3);
}
// deep-mask an object/array unless caller explicitly allows unmasking (cap already checked)
function maskDeep(obj, allowUnmask) {
  if (allowUnmask) return obj;
  const walk = x => {
    if (x instanceof Date) return x;                     // keep timestamps intact (never treat as a plain object)
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object' && x.constructor === Object) {   // only descend into plain objects
      const o = {};
      for (const [k, v] of Object.entries(x)) o[k] = PII_FIELDS.has(k) ? maskValue(k, v) : walk(v);
      return o;
    }
    return x;                                            // strings, numbers, Dates, Buffers, etc. pass through
  };
  return walk(obj);
}

module.exports = { ROLES, LEGACY_VIEW, FIXED_LEGACY, FIXED_TAB_VIEW, role, can, canView, effective, mergeOverrides, maskDeep, maskValue, PII_FIELDS, ALL_VIEWS, CAPS, VIEW_LABELS, CAP_LABELS, FIXED_ENABLED, FIXED_VIEWS };
