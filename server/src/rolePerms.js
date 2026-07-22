/* Editable role → permission overrides, layered over the code defaults in roles.js.
 * Stored in console_settings key 'role_perms' as { roleName: { views:[...], caps:{cap:bool} } }.
 * The merged map is cached in memory (refreshed on save + at boot) so the auth middleware
 * pays no per-request DB cost. super_admin is always full (enforced in roles.mergeOverrides).
 */
const db = require('./db');
const roles = require('./roles');

const KEY = 'role_perms';
let _overrides = {};
let _merged = roles.mergeOverrides({});

async function refresh() {
  try {
    const r = await db.console.query(`SELECT value FROM console_settings WHERE key=$1`, [KEY]);
    _overrides = (r.rowCount && r.rows[0].value && typeof r.rows[0].value === 'object') ? r.rows[0].value : {};
  } catch (e) { _overrides = {}; }
  _merged = roles.mergeOverrides(_overrides);
  return _merged;
}
function current() { return _merged; }          // merged role map (base until first refresh)
function overrides() { return _overrides; }

// sanitise incoming overrides: known roles only, never super_admin, whitelist views/caps
function sanitise(input) {
  const clean = {};
  for (const [name, o] of Object.entries(input || {})) {
    if (!roles.ROLES[name] || name === 'super_admin' || !o) continue;
    const e = {};
    if (Array.isArray(o.views)) e.views = roles.ALL_VIEWS.filter(v => o.views.includes(v));
    if (o.caps && typeof o.caps === 'object') { e.caps = {}; for (const c of roles.CAPS) if (c in o.caps) e.caps[c] = !!o.caps[c]; }
    clean[name] = e;
  }
  return clean;
}
async function save(input) {
  const clean = sanitise(input);
  await db.console.query(
    `INSERT INTO console_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [KEY, JSON.stringify(clean)]);
  await refresh();
  return clean;
}

// snapshot for the matrix UI: roles (rows) × views + caps (columns), current on/off state
function matrix() {
  const m = current();
  return {
    views: roles.ALL_VIEWS.map(v => ({ key: v, label: roles.VIEW_LABELS[v] || v })),
    caps: roles.CAPS.map(c => ({ key: c, label: roles.CAP_LABELS[c] || c })),
    roles: Object.keys(roles.ROLES).map(name => {
      const r = m[name];
      return {
        name, label: r.label, team: r.team, rank: r.rank, locked: name === 'super_admin',
        views: Object.fromEntries(roles.ALL_VIEWS.map(v => [v, r.views.includes(v)])),
        caps: Object.fromEntries(roles.CAPS.map(c => [c, !!r.caps[c]]))
      };
    }),
    overridden: Object.keys(overrides())
  };
}

refresh().catch(() => {});   // warm the cache on require
module.exports = { refresh, current, overrides, save, matrix };
