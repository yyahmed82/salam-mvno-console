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
/* CROSS-BUSINESS PAGES (19 Sep 2026) — until now these were gated ad hoc in ops.js with style.display or a
 * realRole === 'super_admin' test, so they appeared in no matrix column and nobody could review who reached them:
 *   exec        Executive Dashboard (#exec)              — rode on 'dashboard', i.e. everyone
 *   noc         NOC walls (#noc, #noc?w=kpi)             — rode on 'dashboard', i.e. everyone
 *   governance  SLA · Vendors & contracts · SLO defs     — requireSuper on the API, hidden group in the gear menu
 *   cst         CST Arqami · CST Escalations             — requireSuper on the API, hidden group in the gear menu
 *   audit       Audit log                                — realRole super_admin AND root
 *   tickets     Tickets & feedback board                 — the manageUsers cap, which also meant four other things
 * They survive both business scopes (scopeViews) because none of them belongs to Mobile or Fixed alone.
 * The remaining gear entries (Notifications, Navigation & tabs, Demo, Yusr, Agents) stay under 'settings':
 * they are settings panels, not destinations of their own. */
const CROSS_VIEWS = ['exec','noc','governance','cst','audit','tickets'];
const ALL_VIEWS = ['dashboard','monitoring','dms','alerts','errors','analytics','workbench', ...FIXED_VIEWS,
  'exec','noc','governance','cst','audit','tickets', 'explore','settings','users'];   // grouped: mobile · fixed · cross · shared
/* ---- Business scope (6 Sep 2026) ----------------------------------------------------------------
 * Every console user belongs to a BUSINESS: 'mobile' (MVNO team), 'fixed' (Fixed team) or 'both'. It is a
 * second axis next to ROLES: the role says WHAT a person may do (views + caps), the business says on WHICH
 * side. At session time the role's views are intersected with the business (scopeViews) so every gate in
 * the system — requireView on the API, nav scoping, the router, Customer 360, Yusr, the ticket modal —
 * follows automatically. Shared views ('dashboard' = Home, 'explore' = Customer 360 & docs, 'settings',
 * 'users') survive both scopes; the API allow-list in api.js closes the Mobile-only endpoints for a
 * Fixed-only session (they are gated by shared views, not by MOBILE_VIEWS). */
const BUSINESSES = ['mobile', 'fixed', 'both'];
const BUSINESS_LABEL = { mobile: 'Mobile (MVNO)', fixed: 'Fixed', both: 'Mobile + Fixed' };
const MOBILE_VIEWS = ['monitoring', 'dms', 'workbench', 'alerts', 'errors', 'analytics'];
const normBusiness = b => (BUSINESSES.includes(String(b || '').toLowerCase()) ? String(b).toLowerCase() : 'both');
function scopeViews(views, business) {
  const b = normBusiness(business);
  if (b === 'mobile') return views.filter(v => !FIXED_VIEWS.includes(v));
  if (b === 'fixed') return views.filter(v => !MOBILE_VIEWS.includes(v));
  return views;
}
/* manageUsers used to gate five unrelated things on the API (users, the role matrix, the ticket board, the error
 * log, rule reseed, self-check), so granting "can manage users" also handed over the ticket board and a reseed
 * button. It now means ONLY users + roles — and those endpoints are pinned to super admin in api.js regardless,
 * so the tick box cannot open them. adminTools carries what was left behind. */
const CAPS = ['editRules','manageSync','manageUsers','adminTools','unmaskPII','export','ackErrors','useYusr','customizeDashboard'];
// human labels for the permissions matrix UI
const VIEW_LABELS = { dashboard:'Dashboard', monitoring:'Monitoring', dms:'DMS', workbench:'L2 Workbench', alerts:'Alerts',
  errors:'Troubleshoot', analytics:'Reports', explore:'Explore & Customer 360', settings:'Settings', users:'User management',
  fixed:'Fixed · Overview', fixed_epurchase:'Fixed · Epurchase', fixed_salamhome:'Fixed · Salam Home app', fixed_maps:'Fixed · SDA map & QR codes',
  fixed_reports:'Fixed · Reports', fixed_errors:'Fixed · Troubleshoot', fixed_alerts:'Fixed · Alerts', fixed_explore:'Fixed · Playbook & Diagrams',
  exec:'Executive Dashboard', noc:'NOC wall', governance:'IT Governance (SLA · vendors · SLO)', cst:'CST (Arqami · escalations)',
  audit:'Audit log', tickets:'Tickets & feedback' };
/* which nav family each page belongs to — the matrix UI groups by this instead of guessing from the key */
const VIEW_GROUP = Object.fromEntries(ALL_VIEWS.map(v => [v,
  FIXED_VIEWS.includes(v) ? 'fixed' : CROSS_VIEWS.includes(v) ? 'cross' : ['explore','settings','users'].includes(v) ? 'shared' : 'mobile']));
const CAP_LABELS = { editRules:'Edit rules', manageSync:'Manage sync', manageUsers:'Manage users & roles',
  adminTools:'Admin tools', unmaskPII:'Unmask PII', export:'Export data', ackErrors:'Ack incidents',
  useYusr:'Use Yusr AI', customizeDashboard:'Customize dashboards' };
const CAP_NOTES = { editRules:'Create and tune alert rules.', manageSync:'Control the sync engine.',
  manageUsers:'Create users and edit the role matrix. Super Admin only — the endpoints are pinned in code, so this box cannot open them for anyone else.',
  adminTools:'The ticket board, the error log, rule reseed and the health self-check.',
  unmaskPII:'Reveal a masked value on demand. Never a mode: every reveal is audited as pii.unmask.',
  export:'Download XLSX / PDF exports.', ackErrors:'Acknowledge and resolve incidents.',
  useYusr:'Ask Yusr, the AI assistant.', customizeDashboard:'Add and rearrange dashboard cards.' };
/* 2 Sep 2026 view-model change: 'dashboard' and 'dms' became real gated views (dashboard used to be
 * hardcoded-visible, dms rode on 'monitoring'); topology/journeys/integrations collapsed into one
 * 'explore' view = the whole Explore menu (topology, API GW, docs, journeys, integrations, Sub360).
 * LEGACY_VIEW maps keys from overrides saved before the change. */
const LEGACY_VIEW = { topology:'explore', journeys:'explore', integrations:'explore' };

const ROLES = {
  super_admin: {
    label: 'Super Admin', team: 'Digital Ops', rank: 1,
    views: ALL_VIEWS,
    caps: { editRules:true, manageSync:true, manageUsers:true, adminTools:true, unmaskPII:true, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Full control. Can unmask PII (live-fetched, never stored) and manage users.'
  },
  admin: {
    label: 'Admin', team: 'Digital Ops', rank: 2,
    views: ['dashboard','monitoring','dms', ...FIXED_VIEWS, 'workbench','alerts','errors','analytics','exec','noc','explore','tickets','settings'],
    /* unmaskPII granted to admin on 21 Aug 2026 at the owner's request — per-request ACT, never a
     * mode: caller must pass unmask=1, value fetched live, every reveal audited as pii.unmask. */
    caps: { editRules:true, manageSync:true, manageUsers:false, adminTools:true, unmaskPII:true, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Manages rules, sync mode, dashboards and the admin tools (tickets · error log · reseed). Can unmask PII on demand (audited). Cannot manage users or roles — that is Super Admin only.'
  },
  report_manager: {
    label: 'Sales Ops', team: 'Sales Ops', rank: 3,
    views: ['dashboard','monitoring','dms','exec','explore', ...(FIXED_ENABLED ? ['fixed','fixed_maps','fixed_reports'] : [])],
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:false, useYusr:true, customizeDashboard:false },
    note: 'Sales Operations — Dashboard, Monitoring, DMS (dealers), Fixed dealer maps & reports and the Explore pages, with export. PII masked.'
  },
  ...(FIXED_ENABLED ? {
  fixed_ops: {
    label: 'Fixed Ops', team: 'Fixed Ops', rank: 3,
    views: ['dashboard', ...FIXED_VIEWS, 'exec','noc','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Owns the Fixed side (FTTH · FTTB · 5G home): every Fixed page, Fixed alert rules, Customer 360. No Mobile operate pages. PII masked.'
  },
  b2c_admin: {
    label: 'Salam Home (B2C)', team: 'Fixed Ops', rank: 3,
    views: ['dashboard','fixed','fixed_epurchase','fixed_salamhome','fixed_reports','fixed_errors','explore'],
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:false, useYusr:true, customizeDashboard:true },
    note: 'Salam Home app & e-purchase owners — the two channel dashboards, Reports, Errors and Customer 360. PII masked.'
  } } : {}),
  errors_manager: {
    label: 'Errors Manager', team: 'OSS Ops', rank: 3,
    views: ['dashboard','monitoring','errors','alerts','noc','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Owns the Error Control Board & troubleshooting; can tune error-related alerts. PII masked.'
  },
  events_manager: {
    label: 'Events Manager', team: 'Digital Ops', rank: 3,
    views: ['dashboard','monitoring','alerts','noc','explore'],
    caps: { editRules:true, manageSync:true, manageUsers:false, adminTools:false, unmaskPII:false, export:false, ackErrors:false, useYusr:true, customizeDashboard:false },
    note: 'Owns alerts/events: defines rules and controls the sync engine. PII masked.'
  },

  // ---- support escalation tiers (BSS / Digital) — retuned 2 Sep 2026 to the agreed scope ----
  l1_bss: {
    label: 'L1 BSS', team: 'BSS Ops', rank: 5,
    views: ['dashboard','monitoring','errors','noc','explore'],
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Frontline BSS support — Dashboard, Monitoring, Troubleshoot. PII masked.'
  },
  l2_bss: {
    label: 'L2 BSS', team: 'BSS Ops', rank: 4,
    views: ['dashboard','monitoring','errors','noc','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'BSS escalation — same pages as L1 BSS plus alert-rule tuning. PII masked.'
  },
  l1_digital: {
    label: 'L1 Digital', team: 'Digital Ops', rank: 5,
    views: ['dashboard','monitoring','dms','alerts','noc','explore'],
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Frontline Digital support — Dashboard, Monitoring, DMS, Alerts. No Troubleshoot. PII masked.'
  },
  l2_digital: {
    label: 'L2 Digital', team: 'Digital Ops', rank: 4,
    views: ['dashboard','monitoring','dms','errors','alerts','noc','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Digital escalation — all five operate pages. No Workbench, no SLA, no settings. PII masked.'
  },
  l3_digital: {
    label: 'L3 Digital', team: 'Digital Ops', rank: 3,
    views: ['monitoring','errors','noc','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:true, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Deep Digital escalation — Troubleshoot + Monitoring with audited PII unmask for end-to-end cases.'
  },

  /* ---- OSS · Infra · Data · Enterprise escalation tiers (19 Sep 2026) ----------------------------
   * Four more families on the same L1/L2/L3 ladder as BSS and Digital, so every team that operates
   * something at Salam has a role instead of borrowing one. The ladder is identical everywhere:
   *   L1  read the pages the team owns, acknowledge, export, ask Yusr
   *   L2  + the escalation page for that team + tune its alert rules
   *   L3  + the deep page (Workbench) + arrange its own dashboard; PII unmask ONLY where the job
   *       genuinely needs the real identifier (OSS L3, same reasoning as L3 Digital)
   * Nobody here gets manageUsers, adminTools or manageSync — those stay with Super Admin / Admin.
   * Every one of these is a DEFAULT, not a contract: Settings › Users › Roles edits them live. */

  l1_oss: {
    label: 'L1 OSS', team: 'OSS Ops', rank: 5,
    views: ['dashboard','monitoring','errors','noc','explore', ...(FIXED_ENABLED ? ['fixed_errors'] : [])],
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Frontline OSS — Monitoring and the error boards on both businesses. Acknowledge and export. PII masked.'
  },
  l2_oss: {
    label: 'L2 OSS', team: 'OSS Ops', rank: 4,
    views: ['dashboard','monitoring','errors','alerts','noc','explore', ...(FIXED_ENABLED ? ['fixed_errors','fixed_alerts'] : [])],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'OSS escalation — adds Alerts on both businesses and the tuning of OSS alert rules. PII masked.'
  },
  l3_oss: {
    label: 'L3 OSS', team: 'OSS Ops', rank: 3,
    views: ['dashboard','monitoring','errors','alerts','workbench','noc','explore', ...(FIXED_ENABLED ? ['fixed_errors','fixed_alerts'] : [])],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:true, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Deep OSS escalation — adds the L2 Workbench and audited PII unmask for end-to-end cases, like L3 Digital.'
  },

  l1_infra: {
    label: 'L1 Infra', team: 'Infra Ops', rank: 5,
    views: ['dashboard','monitoring','alerts','noc','explore'],
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Frontline Infrastructure — Monitoring, Alerts and the NOC walls. Acknowledge and export. PII masked.'
  },
  l2_infra: {
    label: 'L2 Infra', team: 'Infra Ops', rank: 4,
    views: ['dashboard','monitoring','alerts','errors','noc','explore', ...(FIXED_ENABLED ? ['fixed_alerts'] : [])],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Infrastructure escalation — adds Troubleshoot and Fixed alerts, and tunes infrastructure alert rules. PII masked.'
  },
  l3_infra: {
    label: 'L3 Infra', team: 'Infra Ops', rank: 3,
    views: ['dashboard','monitoring','alerts','errors','workbench','noc','explore', ...(FIXED_ENABLED ? ['fixed_alerts'] : [])],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Deep Infrastructure escalation — adds the L2 Workbench and its own dashboard layout. No PII: the layer below the customer record.'
  },

  l1_data: {
    label: 'L1 Data', team: 'Data Ops', rank: 5,
    views: ['dashboard','analytics','explore', ...(FIXED_ENABLED ? ['fixed_reports'] : [])],
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:false, useYusr:true, customizeDashboard:false },
    note: 'Frontline Data — Reports on both businesses and the Explore pages, with export. PII masked.'
  },
  l2_data: {
    label: 'L2 Data', team: 'Data Ops', rank: 4,
    views: ['dashboard','monitoring','analytics','explore', ...(FIXED_ENABLED ? ['fixed_reports'] : [])],
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Data escalation — adds Monitoring so a number can be traced to the journey behind it, and dashboard layout. PII masked.'
  },
  l3_data: {
    label: 'L3 Data', team: 'Data Ops', rank: 3,
    views: ['dashboard','monitoring','dms','errors','alerts','analytics','explore', ...(FIXED_ENABLED ? ['fixed_reports','fixed_errors'] : [])],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Deep Data escalation — the operate pages a data quality case needs (DMS, Troubleshoot, Alerts) and rule tuning. PII masked.'
  },

  /* Enterprise = Salam internal systems (RA hub, HR hub, Contracting, Jira, MSD portals). Those systems
   * are NOT yet a monitored business in this console — there are two business scopes, Mobile and Fixed.
   * These roles exist so the Enterprise team can be onboarded, reviewed in the matrix and given the
   * cross-business pages now; the Enterprise pages attach to them when the third scope is added, with
   * no change to anybody's role. Until then they see the shared and cross-business pages only. */
  l1_enterprise: {
    label: 'L1 Enterprise', team: 'Enterprise IT', rank: 5,
    views: ['dashboard','alerts','errors','noc','explore'],
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Frontline Enterprise IT (RA hub · HR hub · Contracting · Jira · MSD) — Alerts, Troubleshoot and the NOC walls. Enterprise systems are not a monitored business yet. PII masked.'
  },
  l2_enterprise: {
    label: 'L2 Enterprise', team: 'Enterprise IT', rank: 4,
    views: ['dashboard','monitoring','alerts','errors','noc','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:false },
    note: 'Enterprise IT escalation — adds Monitoring and the tuning of its own alert rules. PII masked.'
  },
  l3_enterprise: {
    label: 'L3 Enterprise', team: 'Enterprise IT', rank: 3,
    views: ['dashboard','monitoring','alerts','errors','workbench','noc','explore'],
    caps: { editRules:true, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:true, useYusr:true, customizeDashboard:true },
    note: 'Deep Enterprise IT escalation — adds the L2 Workbench and its own dashboard layout. PII masked.'
  },

  /* CIO / Executive (19 Sep 2026) — the narrowest role in the console. Two pages and the assistant: the
   * Executive Dashboard, the NOC walls, and Yusr. Deliberately NO Customer 360 (that view carries PII), no
   * operate pages, no edit caps. This is the role the 'exec' and 'noc' views were created for — before them
   * the only way to hand someone the executive dashboard was to hand them Home and everything keyed to it. */
  cio: {
    label: 'CIO / Executive', team: 'Executive', rank: 2,
    views: ['exec', 'noc'],
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:false, export:true, ackErrors:false, useYusr:true, customizeDashboard:false },
    note: 'Executive view — the Executive Dashboard, the NOC walls and Yusr AI, with export. No operate pages, no Customer 360, no PII.'
  },
  call_center: {
    label: 'Call Center', team: 'Call Center', rank: 6,
    views: ['dashboard','explore'],
    /* unmaskPII granted 2 Sep 2026 (Yosri): agents verify callers and must read real values in
     * Subscriber 360. Stays a per-request ACT — every reveal writes a pii.unmask audit row naming
     * the agent and the record; masked remains the default until the agent presses Unmask. */
    caps: { editRules:false, manageSync:false, manageUsers:false, adminTools:false, unmaskPII:true, export:false, ackErrors:false, useYusr:true, customizeDashboard:false },
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

module.exports = { ROLES, LEGACY_VIEW, CROSS_VIEWS, VIEW_GROUP, CAP_NOTES, FIXED_LEGACY, FIXED_TAB_VIEW, role, can, canView, effective, mergeOverrides, maskDeep, maskValue, PII_FIELDS, ALL_VIEWS, CAPS, VIEW_LABELS, CAP_LABELS, FIXED_ENABLED, FIXED_VIEWS, BUSINESSES, BUSINESS_LABEL, MOBILE_VIEWS, normBusiness, scopeViews };
