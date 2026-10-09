/* Editable role → permission overrides, layered over the code defaults in roles.js.
 * Stored in console_settings key 'role_perms' as { roleName: { views:[...], caps:{cap:bool} } }.
 * The merged map is cached in memory (refreshed on save + at boot) so the auth middleware
 * pays no per-request DB cost. super_admin is always full (enforced in roles.mergeOverrides).
 */
const db = require('./db');
const roles = require('./roles');

const KEY = 'role_perms';
const CKEY = 'custom_roles';           // { name: { label, team, views, caps, note } }
let _overrides = {};
let _custom = {};
let _merged = roles.mergeOverrides({}, {});

async function refresh() {
  try {
    const r = await db.console.query(`SELECT key, value FROM console_settings WHERE key = ANY($1)`, [[KEY, CKEY]]);
    _overrides = {}; _custom = {};
    for (const row of r.rows) {
      const v = (row.value && typeof row.value === 'object') ? row.value : {};
      if (row.key === KEY) _overrides = v; else _custom = v;
    }
  } catch (e) { _overrides = {}; _custom = {}; }
  _merged = roles.mergeOverrides(_overrides, _custom);
  return _merged;
}
function current() { return _merged; }          // merged role map (base until first refresh)
function overrides() { return _overrides; }
function customRoles() { return _custom; }

// sanitise incoming overrides: known roles only, never super_admin, whitelist views/caps
function sanitise(input) {
  const clean = {};
  for (const [name, o] of Object.entries(input || {})) {
    if ((!roles.ROLES[name] && !_custom[name]) || name === 'super_admin' || !o) continue;
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

/* ---- custom roles (super_admin only; callers enforce) ----
 * addRole: name must be a fresh slug; starts as a clone of `clone_from` (default call_center-ish
 * minimal scope) so a new role is never accidentally born with full access. */
async function saveCustom() {
  await db.console.query(
    `INSERT INTO console_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [CKEY, JSON.stringify(_custom)]);
  await refresh();
}
async function addRole({ name, label, team, clone_from, note }) {
  const slug = String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!slug || slug.length > 40) throw new Error('role name must be 1–40 chars (letters/digits/_)');
  if (roles.ROLES[slug] || _custom[slug]) throw new Error(`role '${slug}' already exists`);
  const src = current()[clone_from];
  _custom[slug] = {
    label: String(label || slug).slice(0, 60),
    team: String(team || 'Custom').slice(0, 40),
    views: src ? [...src.views] : ['dashboard', 'explore'],
    caps: src ? { ...src.caps, manageUsers: false } : { useYusr: true },
    note: String(note || (src ? `Custom role, cloned from ${src.label}.` : 'Custom role.')).slice(0, 200)
  };
  await saveCustom();
  return slug;
}
async function removeRole(name) {
  if (!_custom[name]) throw new Error(`'${name}' is not a custom role`);
  // refuse if any user still holds it
  const r = await db.console.query(
    `SELECT count(*)::int n FROM console_users WHERE role=$1 OR $1 = ANY(roles)`, [name]);
  if (r.rows[0].n > 0) throw new Error(`${r.rows[0].n} user(s) still have role '${name}' — reassign them first`);
  delete _custom[name];
  if (_overrides[name]) { delete _overrides[name]; await save(_overrides); }
  await saveCustom();
}

// snapshot for the matrix UI: roles (rows) × views + caps (columns), current on/off state
/* How many people actually hold each role, and when they were last seen. Without this a permission change is
 * made blind: "remove Troubleshoot from L2 Digital" reads very differently when it is four people than when it
 * is nobody. A user can carry a primary role plus extra roles, so both columns count. */
async function roleUsage() {
  const out = {};
  try {
    /* DISTINCT on (id, role): a user whose primary role also appears in roles[] must count once, not twice */
    const r = await db.console.query(
      `SELECT role, count(*)::int AS users,
              count(*) FILTER (WHERE last_login IS NULL)::int AS never_signed_in,
              max(last_login) AS last_seen
         FROM (SELECT DISTINCT u.id, x.role, u.last_login
                 FROM console_users u,
                      LATERAL unnest(array_remove(array_cat(ARRAY[u.role], COALESCE(u.roles, '{}')), NULL)) AS x(role)
                WHERE u.enabled = true) z
        GROUP BY role`);
    for (const row of r.rows) out[row.role] = { users: row.users, never: row.never_signed_in, last_seen: row.last_seen };
  } catch (e) { /* column set differs or table missing → the UI just shows no counts */ }
  return out;
}

async function matrix() {
  const m = current();
  const usage = await roleUsage();
  return {
    views: roles.ALL_VIEWS.map(v => ({ key: v, label: roles.VIEW_LABELS[v] || v, group: roles.VIEW_GROUP[v] || 'shared' })),
    caps: roles.CAPS.map(c => ({ key: c, label: roles.CAP_LABELS[c] || c, note: (roles.CAP_NOTES || {})[c] || '' })),
    roles: Object.keys(m).map(name => {
      const r = m[name], u = usage[name] || {};
      return {
        name, label: r.label, team: r.team, rank: r.rank, locked: name === 'super_admin', custom: !!r.custom,
        note: r.note || '', users: u.users || 0, never_signed_in: u.never || 0, last_seen: u.last_seen || null,
        views: Object.fromEntries(roles.ALL_VIEWS.map(v => [v, r.views.includes(v)])),
        caps: Object.fromEntries(roles.CAPS.map(c => [c, !!r.caps[c]]))
      };
    }),
    overridden: Object.keys(overrides()),
    pinned: roles.PINNED_VIEWS || {}   // restricted pages (alpha.166): view → the only roles that may hold it
  };
}

refresh().catch(() => {});   // warm the cache on require
module.exports = { refresh, current, overrides, customRoles, save, matrix, addRole, removeRole };
