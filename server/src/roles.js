/* Role management + permissions + PII governance.
 * 5 roles (matching the previous project's model):
 *   super_admin · admin · report_manager · errors_manager · events_manager
 * Views: topology, journeys, integrations, alerts, errors, dashboards, settings, users
 * Caps:  editRules, manageSync, manageUsers, unmaskPII, export, ackErrors
 */
const ALL_VIEWS = ['topology','journeys','integrations','alerts','errors','analytics','settings','users'];
const CAPS = ['editRules','manageSync','manageUsers','unmaskPII','export','ackErrors'];
// human labels for the permissions matrix UI
const VIEW_LABELS = { topology:'Topology', journeys:'Journeys', integrations:'Integrations', alerts:'Alerts',
  errors:'Troubleshoot', analytics:'Analytics / SLA', settings:'Settings', users:'User management' };
const CAP_LABELS = { editRules:'Edit rules', manageSync:'Manage sync', manageUsers:'Manage users',
  unmaskPII:'Unmask PII', export:'Export data', ackErrors:'Ack incidents' };

const ROLES = {
  super_admin: {
    label: 'Super Admin', team: 'Digital Ops', rank: 1,
    views: ALL_VIEWS,
    caps: { editRules:true, manageSync:true, manageUsers:true, unmaskPII:true, export:true, ackErrors:true },
    note: 'Full control. Only role that can unmask PII (live-fetched, never stored) and manage users.'
  },
  admin: {
    label: 'Admin', team: 'Digital Ops', rank: 2,
    views: ['topology','journeys','integrations','alerts','errors','analytics','settings'],
    caps: { editRules:true, manageSync:true, manageUsers:false, unmaskPII:false, export:true, ackErrors:true },
    note: 'Manages rules, sync mode and dashboards. PII stays masked; cannot manage users.'
  },
  report_manager: {
    label: 'Report Manager', team: 'Sales Ops', rank: 3,
    views: ['topology','journeys','integrations','analytics','alerts'],
    caps: { editRules:false, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:false },
    note: 'Read-only reporting & dashboards with CSV/JSON export. No rule edits, PII masked.'
  },
  errors_manager: {
    label: 'Errors Manager', team: 'OSS Ops', rank: 3,
    views: ['topology','journeys','errors','alerts'],
    caps: { editRules:true, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true },
    note: 'Owns the Error Control Board & troubleshooting; can tune error-related alerts. PII masked.'
  },
  events_manager: {
    label: 'Events Manager', team: 'Digital Ops', rank: 3,
    views: ['topology','journeys','integrations','alerts'],
    caps: { editRules:true, manageSync:true, manageUsers:false, unmaskPII:false, export:false, ackErrors:false },
    note: 'Owns alerts/events: defines rules and controls the sync engine. PII masked.'
  },

  // ---- support escalation tiers (BSS / Digital) ----
  l1_bss: {
    label: 'L1 BSS', team: 'BSS Ops', rank: 5,
    views: ['topology','journeys','integrations','alerts','errors','analytics'],
    caps: { editRules:false, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true },
    note: 'Frontline BSS support — triage & acknowledge incidents on the Troubleshoot board. PII masked.'
  },
  l2_bss: {
    label: 'L2 BSS', team: 'BSS Ops', rank: 4,
    views: ['topology','journeys','integrations','alerts','errors','analytics'],
    caps: { editRules:true, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true },
    note: 'BSS escalation — tune alert rules and drive incident resolution. PII masked.'
  },
  l1_digital: {
    label: 'L1 Digital', team: 'Digital Ops', rank: 5,
    views: ['topology','journeys','integrations','alerts','errors','analytics'],
    caps: { editRules:false, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true },
    note: 'Frontline Digital support — triage & acknowledge incidents. PII masked.'
  },
  l2_digital: {
    label: 'L2 Digital', team: 'Digital Ops', rank: 4,
    views: ['topology','journeys','integrations','alerts','errors','analytics'],
    caps: { editRules:true, manageSync:false, manageUsers:false, unmaskPII:false, export:true, ackErrors:true },
    note: 'Digital escalation — tune rules and drive incidents. PII masked.'
  },
  l3_digital: {
    label: 'L3 Digital', team: 'Digital Ops', rank: 3,
    views: ['topology','journeys','integrations','alerts','errors','analytics','settings'],
    caps: { editRules:true, manageSync:true, manageUsers:false, unmaskPII:true, export:true, ackErrors:true },
    note: 'Deep Digital escalation — rule tuning, sync control, and audited PII unmask for end-to-end troubleshooting.'
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
function mergeOverrides(overrides) {
  const ov = overrides || {};
  const out = {};
  for (const [name, base] of Object.entries(ROLES)) {
    const r = { ...base, views: [...base.views], caps: { ...base.caps } };
    const o = ov[name];
    if (o && name !== 'super_admin') {
      if (Array.isArray(o.views)) r.views = ALL_VIEWS.filter(v => o.views.includes(v));
      if (o.caps) for (const c of CAPS) if (c in o.caps) r.caps[c] = !!o.caps[c];
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
  'email','receiver_email','customer_name','contact_name','receiver_full_name','name','identifier'
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

module.exports = { ROLES, role, can, canView, effective, mergeOverrides, maskDeep, maskValue, PII_FIELDS, ALL_VIEWS, CAPS, VIEW_LABELS, CAP_LABELS };
