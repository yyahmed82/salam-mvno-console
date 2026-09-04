/* Express API + static console. Endpoints:
 *  GET /api/health          — source/console connectivity + data bounds
 *  GET /api/rules           — alert rules (+ catalog)
 *  GET /api/alerts?status=  — alerts (open by default)
 *  GET /api/alerts/summary  — counts by severity/team/status
 *  GET /api/metrics/latest  — latest snapshot per metric
 *  GET /api/metrics/series?key=&window=  — time series for a metric
 *  POST /api/sync           — run one sync+alerts at {sim_now|now}
 *  POST /api/simulate       — run a replay {stepHours,steps}
 */
const express = require('express');
const path = require('path');
const db = require('./db');
const { syncOnce } = require('./sync');
const { runAlerts, evaluate } = require('./alertRunner');
const notify = require('./notify');
const plans = require('./plans');
const syncHealth = require('./syncHealth');
const prodSync = require('./prodSync');
const rollups = require('./rollups');
const slo = require('./slo');
const chatops = require('./chatops');
const assist = require('./assist');
const servicenow = require('./servicenow');
const tapRecon = require('./tapRecon');
const escalation = require('./escalation');
const correlation = require('./correlation');
const anomaly = require('./anomaly');
const reliability = require('./reliability');
const subscriber = require('./subscriber');
const rolePerms = require('./rolePerms');
const { simulate, dataBounds } = require('./simulate');
const roles = require('./roles');
const settings = require('./settings');
const errors = require('./errors');
const otp = require('./otp');
const dashboard = require('./dashboard');
const analytics = require('./analytics');
const tickets = require('./tickets');
const workbench = require('./workbench');
const { METRICS } = require('./metrics');

const app = express();
app.set('trust proxy', true);   // read client IP from X-Forwarded-For when behind a proxy
app.use(reliability.securityHeaders);
// Ticket creation carries base64 screenshots (up to 4 × 5MB) — allow a larger JSON body on that ONE
// route only. Mounted BEFORE the global 1mb parser so it consumes the body first; once parsed the
// global express.json below sees req._body and skips it, so every other endpoint keeps the 1mb cap.
const TICKET_BODY_LIMIT = process.env.TICKET_BODY_LIMIT || '28mb';
app.use('/api/tickets', (req, res, next) => req.method === 'POST'
  ? express.json({ limit: TICKET_BODY_LIMIT })(req, res, next) : next());
// Workbench doc uploads carry a base64 .md/.txt/.pdf — same per-route large-body trick as tickets.
const DOC_BODY_LIMIT = process.env.DOC_BODY_LIMIT || '20mb';
app.use('/api/workbench/docs', (req, res, next) => req.method === 'POST'
  ? express.json({ limit: DOC_BODY_LIMIT })(req, res, next) : next());
app.use(express.json({ limit: '1mb' }));
// General API limiter: keyed by CONSOLE USER (not IP) because the console sits behind a
// shared corporate VPN — a per-IP limit would let one office collectively throttle itself.
// The ceiling is a runaway-loop guard, not a UI throttle; a normal page load is well under it.
// Health/version probes are exempt. Set RATE_LIMIT_DISABLED=1 to defer entirely to infra/WAF.
const userKey = req => (req.get('X-Console-User') || '').toLowerCase() || ((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'anon');
app.use('/api/', reliability.rateLimit({
  windowMs: 60_000, max: Number(process.env.RATE_LIMIT_RPM) || 1200, key: 'api', keyFn: userKey,
  skip: req => req.path === '/health' || req.path === '/ready' || req.path === '/version'
}));
// Auth/OTP stay STRICT and per-IP — this is the real brute-force surface.
const authLimiter = reliability.rateLimit({ windowMs: 60_000, max: Number(process.env.AUTH_RATE_LIMIT_RPM) || 10, key: 'auth' });
app.use(['/api/auth/request-otp', '/api/auth/verify-otp'], authLimiter);
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', '..');
app.use(express.static(STATIC_DIR)); // serve the console (index.html etc.)

const C = db.console;

// resolve the acting role: real role comes from the user's email in console_users;
// a genuine super_admin may preview another role via the X-Console-Role header.
const ALLOWED_DOMAIN = /@(salam\.sa|salammobile\.sa)$/i;
const sessions = require('./sessions');
const respCache = require('./respCache');
// requests from the box itself (schedulers: prod-sync tick, escalation) may identify via the
// legacy X-Console-User header. Uses the RAW socket address (not X-Forwarded-For) — unspoofable.
const isLoopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
app.use(async (req, _res, next) => {
  // identity comes from the session token, never from a client-supplied header.
  // EXCEPTION — GET /api/stream only: EventSource cannot send headers at all, so the live SSE
  // stream may present the SAME session token via ?token=. Scoped to this one path so tokens
  // don't start appearing in URLs (and thus logs) anywhere else.
  let email = '';
  try {
    let tok = req.get('X-Console-Token');
    if (!tok && req.path === '/api/stream' && req.method === 'GET') tok = req.query.token;
    email = (await sessions.lookup(tok)) || '';
  } catch (e) {}
  if (!email && isLoopback(req)) email = (req.get('X-Console-User') || '').toLowerCase();
  req.sessionEmail = email;
  req.actor = email || 'anonymous';
  // hidden root tier — env-only membership, independent of roles (see ROOT_SET below)
  req.isRoot = !!email && ROOT_SET.has(String(email).toLowerCase());
  let names = [];                                  // no session → NO access (not viewer-by-default)
  if (email) {
    names = ['report_manager'];                    // registered fallback role
    try {
      const r = await C.query(`SELECT roles, role FROM console_users WHERE email=$1 AND enabled=true`, [email]);
      if (r.rowCount) { const row = r.rows[0]; names = (row.roles && row.roles.length) ? row.roles : [row.role]; }
    } catch (e) {}
  }
  const rmap = rolePerms.current();   // code defaults merged with super-admin's saved overrides
  const realEff = roles.effective(names, rmap);
  req.realRoles = realEff.roles;
  req.realRole = realEff.primary;
  // a super admin may preview a single other role via the header; nobody else can escalate
  const hdr = req.get('X-Console-Role');
  const eff = (names.includes('super_admin') && hdr) ? roles.effective([hdr], rmap) : realEff;
  req.roleNames = eff.roles;
  req.roleName = eff.primary;
  req.caps = eff.caps;
  req.views = eff.views;
  next();
});
// Global gate: every /api/* call requires a valid session, except auth + liveness probes.
const OPEN_PATHS = new Set(['/api/auth/request-otp', '/api/auth/verify-otp', '/api/auth/logout',
  '/api/health', '/api/ready', '/api/version', '/health', '/ready', '/version',
  '/api/cache-stats']);   // ops/diagnostics only — exposes counters, no data
app.use('/api/', (req, res, next) => {
  if (req.sessionEmail) return next();
  const full = '/api' + (req.path === '/' ? '' : req.path);
  if (OPEN_PATHS.has(full) || OPEN_PATHS.has(req.path)) return next();
  return res.status(401).json({ error: 'Not signed in.' });
});
app.get('/api/cache-stats', (req, res) => res.json(respCache.stats()));

function requireCap(cap) {
  return (req, res, next) => (req.caps && req.caps[cap]) ? next()
    : res.status(403).json({ error: `role ${req.roleName} lacks ${cap}` });
}
// gate by VIEW membership (e.g. the L2 Workbench is scoped to roles that have the 'workbench' view —
// L2/L3/admin/super, never L1/report_manager). Mirrors the frontend nav scoping in ops.js.
function requireView(view) {
  return (req, res, next) => (req.views && req.views.includes(view)) ? next()
    : res.status(403).json({ error: `role ${req.roleName} lacks ${view} access` });
}
// pass if the caller holds ANY of the listed caps (OR semantics)
function requireAnyCap(...caps) {
  return (req, res, next) => (req.caps && caps.some(c => req.caps[c])) ? next()
    : res.status(403).json({ error: `role ${req.roleName} lacks ${caps.join(' or ')}` });
}
/* ---- hidden "root" tier (platform owner) --------------------------------------------------
 * Membership comes ONLY from the ROOT_ADMINS env var (comma-separated emails, case-insensitive)
 * — it is NOT a role: it never appears in the roles table, the permissions matrix, or any user
 * dropdown, only /api/me carries a `root` boolean so the UI can hide the gated pages.
 * ROOT_ONLY is the single registry of features gated to this tier — future root-only features
 * append their key here and wrap their endpoints in requireRoot('<key>').
 * FAILSAFE / graceful rollout: while ROOT_ADMINS is unset/empty, requireRoot is a no-op and every
 * gated endpoint keeps today's behavior (super_admin / manageSync). Enforcement flips on only
 * when the env var exists — so a bad deploy can never lock the console owner out. */
const ROOT_ONLY = ['audit', 'assist_config', 'sla'];   // ← future root-only features append here
const ROOT_SET = new Set((process.env.ROOT_ADMINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
function requireRoot(feature) {
  return (req, res, next) => {
    if (!ROOT_SET.size) return next();                    // tier not configured → today's behavior
    if (req.isRoot) return next();
    // audited (incl. super admins probing) — fire-and-forget, the 403 never waits on the insert
    audit(req, 'RESTRICTED_ATTEMPT', req.originalUrl || req.path,
      { feature: ROOT_ONLY.includes(feature) ? feature : feature || null });
    return res.status(403).json({ error: 'restricted' });
  };
}
/* ---- PAGE-LEVEL API GATES (Yosri, 2 Sep 2026) -------------------------------------------------
 * Hiding a nav tab is cosmetic — a deep link (#monitoring?tab=resellers) still rendered the page
 * because its data APIs answered any signed-in session. These app.use gates are the CONTROL:
 * each namespace that belongs to exactly ONE page requires that page's view. Namespaces shared
 * across pages (alerts strip on the dashboard, /api/growth on home, /api/sms + /api/login/state
 * in Subscriber 360, /api/transaction everywhere) deliberately stay session-gated only.
 * Registered BEFORE every route in these namespaces — Express runs middleware in order. */
app.use('/api/monitoring', requireView('monitoring'));
app.use('/api/apigw',      requireView('monitoring'));   // gateway traces/windows — Monitoring drills
app.use('/api/probe',      requireView('monitoring'));   // provider probes panel
app.use('/api/osb',        requireView('monitoring'));   // OSB / uil_logs panels
app.use('/api/analytics',  requireView('analytics'));
app.use('/api/errors',     requireView('errors'));       // Troubleshoot board (Sub360 uses /api/subscriber + /api/transaction, not this)
app.use('/api/rules',      requireView('alerts'));       // rule list/editor — the Alerts page

function clientIp(req) { try { return (req.headers && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.ip || null; } catch (e) { return null; } }
function clientUa(req) { try { return (req.get && req.get('user-agent')) || null; } catch (e) { return null; } }
async function audit(req, action, target, detail, actorOverride) {
  try { await C.query(`INSERT INTO audit_log (actor,role,action,target,detail,ip,ua) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actorOverride || req.actor, req.roleName || null, action, target || null, JSON.stringify(detail || {}), clientIp(req), clientUa(req)]); } catch (e) {}
}
// push incidents that opened at this sim tick to Slack/Teams (best-effort).
// Root-cause suppression: if a child rule's provider ROOT is currently open, we do NOT page
// the child (it's the same incident) — ChatOps sends one page for the root, not ~10.
async function postNewIncidents(simNow) {
  const rows = (await C.query(
    `SELECT a.id, a.rule_key, a.name, a.severity, a.team, a.metric_key, a.operator, a.threshold,
            a.observed_value, a.sample, a.window_hours, a.message, COALESCE(mc.unit,'count') AS unit
       FROM alerts a LEFT JOIN metric_catalog mc ON mc.key = a.metric_key
      WHERE a.status='open' AND a.fired_at=$1`, [simNow])).rows;
  const cfg = await chatops.getConfig();
  const openRoots = await correlation.openRootKeys(C);
  const results = [];
  let suppressed = 0;
  for (const a of rows) {
    const parent = correlation.suppressorOf(a.rule_key, openRoots);
    if (parent) { suppressed++; results.push({ suppressed: true, rule: a.rule_key, under: parent }); continue; }  // same incident as the open root — don't double-page
    try { results.push(await chatops.notifyIncident(a, { kind: 'opened', cfg })); } catch (e) { results.push({ error: e.message }); }
  }
  return { count: rows.length, suppressed, channels: results.flatMap(r => r.channels || []) };
}

// build a WHERE clause + params for the audit query from filters
function auditWhere(q) {
  const w = [], p = [];
  if (q.user) { p.push('%' + String(q.user).toLowerCase() + '%'); w.push(`lower(actor) LIKE $${p.length}`); }
  if (q.action && q.action !== 'all') { p.push(q.action); w.push(`action = $${p.length}`); }
  if (q.from) { p.push(q.from); w.push(`at >= $${p.length}::timestamptz`); }
  if (q.to) { p.push(q.to); w.push(`at < ($${p.length}::timestamptz + interval '1 day')`); }
  if (q.nav === '0') w.push(`action NOT IN ('VIEW_PAGE','APPLY_FILTER')`);
  return { clause: w.length ? ('WHERE ' + w.join(' AND ')) : '', params: p };
}

/* ---- auth: email OTP sign-in ---- */
app.post('/api/auth/request-otp', async (req, res) => {
  try {
    const email = (req.body && req.body.email || '').toLowerCase().trim();
    if (!ALLOWED_DOMAIN.test(email)) return res.status(400).json({ error: 'Use a @salam.sa or @salammobile.sa email.' });
    // registered users only — no console account, no code
    const u0 = await C.query(`SELECT 1 FROM console_users WHERE email=$1 AND enabled=true`, [email]);
    if (!u0.rowCount) { await audit(req, 'LOGIN_DENIED_UNREGISTERED', email, {}, email); return res.status(403).json({ error: 'No console account for this email — ask an administrator to add you.' }); }
    const r = await otp.requestOtp(email);
    if (r.error) return res.status(429).json({ error: r.error });   // rate limit only
    // mailError=true → code generated but email delivery failed (relay policy); UI still proceeds
    res.json({ sent: !!r.sent, mailError: !!r.mailError, dev: !!r.dev, devCode: r.devCode, ttlMin: otp.CODE_TTL_MIN });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const email = (req.body && req.body.email || '').toLowerCase().trim();
    const code = (req.body && req.body.code || '').trim();
    if (!ALLOWED_DOMAIN.test(email)) return res.status(400).json({ error: 'Invalid email.' });
    if (!(await otp.verifyOtp(email, code))) { await audit(req, 'LOGIN_FAIL', email, {}, email); return res.status(401).json({ error: 'Invalid or expired code.' }); }
    // registered users only (checked again here — request-otp gate alone isn't enough)
    const u = await C.query(`SELECT role FROM console_users WHERE email=$1 AND enabled=true`, [email]);
    if (!u.rowCount) { await audit(req, 'LOGIN_DENIED_UNREGISTERED', email, {}, email); return res.status(403).json({ error: 'No console account for this email — ask an administrator to add you.' }); }
    const role = u.rows[0].role;
    await C.query(`UPDATE console_users SET last_login=now() WHERE email=$1`, [email]);
    const token = await sessions.create(email);
    await audit(req, 'LOGIN', email, {}, email);
    res.json({ email, role, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', async (req, res) => {
  try { await sessions.destroy(req.get('X-Console-Token')); } catch (e) {}
  res.json({ ok: true });
});

/* ---- roles & session ---- */
/* TKT-000017 — editable Business/Technical code classification (layered over errclass built-ins).
 * GET: current merged view. PUT: save overrides (editRules cap, audited). Applies to NEW
 * classifications immediately; api_traffic_events history keeps its ingest-time class. */
const ERRCLASS_KEY = 'errclass_overrides';
(async () => {   // warm at boot
  try { const r = await C.query(`SELECT value FROM console_settings WHERE key=$1`, [ERRCLASS_KEY]);
    if (r.rowCount && r.rows[0].value) require('./errclass').setOverrides(r.rows[0].value); } catch (e) {}
})();
app.get('/api/errclass', requireCap('editRules'), (req, res) => {
  const ec = require('./errclass');
  res.json({ builtin_tech: [...ec.TECH_CODE], builtin_biz: [...ec.BIZ_CODE], overrides: ec.getOverrides(),
    note: 'Overrides apply to new classifications from save time; API-traffic history keeps its ingest-time class. DMS journey codes have their own success set.' });
});
app.put('/api/errclass', requireCap('editRules'), async (req, res) => {
  try {
    const ec = require('./errclass');
    ec.setOverrides((req.body && req.body.overrides) || {});
    await C.query(`INSERT INTO console_settings (key, value) VALUES ($1,$2)
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [ERRCLASS_KEY, JSON.stringify(ec.getOverrides())]);
    await audit(req, 'errclass.save', null, ec.getOverrides());
    res.json({ ok: true, overrides: ec.getOverrides() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/roles', (req, res) => res.json({ roles: rolePerms.current() }));   // reflects saved overrides
// editable permissions matrix (roles × pages/features)
app.get('/api/roles/matrix', requireCap('manageUsers'), (req, res) => res.json(rolePerms.matrix()));
app.put('/api/roles/matrix', requireSuper, async (req, res) => {
  try {
    const saved = await rolePerms.save((req.body && req.body.overrides) || {});
    await audit(req, 'roles.matrix.save', null, { changed: Object.keys(saved) });
    res.json(rolePerms.matrix());
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/me', async (req, res) => {
  let profile = {};
  try {
    if (req.actor && req.actor !== 'anonymous') {
      const u = await C.query(`SELECT name, mobile, dashboard FROM console_users WHERE email=$1`, [req.actor]);
      if (u.rowCount) profile = { name: u.rows[0].name, mobile: u.rows[0].mobile, dashboard: u.rows[0].dashboard || {} };
    }
  } catch (e) {}
  let features = {}; try { features = (await settings.getSetting('features')) || {}; } catch (e) {}
  res.json({ email: req.actor === 'anonymous' ? null : req.actor,
    name: profile.name || null, mobile: profile.mobile || null, dashboard: profile.dashboard || {},
    role: req.roleName, roles: req.roleNames, realRole: req.realRole, realRoles: req.realRoles,
    label: roles.role(req.roleName).label, team: roles.role(req.roleName).team, note: roles.role(req.roleName).note,
    // `root` = "this session passes requireRoot" — a FLAG, not a role (never rendered in role UIs).
    // While ROOT_ADMINS is unset it reports true so the client falls back to today's role-based
    // visibility (matches the server-side failsafe in requireRoot).
    root: ROOT_SET.size ? !!req.isRoot : true,
    views: req.views, caps: req.caps, features });
});
// interface feature flags — read (any signed-in user) + update (admins)
app.get('/api/settings/features', async (req, res) => { res.json((await settings.getSetting('features')) || {}); });
app.put('/api/settings/features', requireCap('manageUsers'), async (req, res) => {
  const cur = (await settings.getSetting('features')) || {};
  const next = { ...cur };
  if (req.body && typeof req.body.langSwitch === 'boolean') next.langSwitch = req.body.langSwitch;
  await settings.setSetting('features', next);
  await audit(req, 'settings.features', null, next);
  res.json(next);
});
/* mark the guided tour as seen for the acting user */
app.post('/api/me/tour-seen', async (req, res) => {
  try { if (req.actor && req.actor !== 'anonymous') await C.query(`UPDATE console_users SET tour_seen=true WHERE email=$1`, [req.actor]); } catch (e) {}
  res.json({ ok: true });
});
/* the acting user edits their own profile (name + mobile) */
app.patch('/api/me', async (req, res) => {
  try {
    if (!req.actor || req.actor === 'anonymous') return res.status(401).json({ error: 'not signed in' });
    const { name, mobile } = req.body || {};
    await C.query(`UPDATE console_users SET name=COALESCE($1,name), mobile=COALESCE($2,mobile) WHERE email=$3`,
      [name ?? null, mobile ?? null, req.actor]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* the acting user saves their home-dashboard preferences (selected sections + order) */
app.put('/api/me/dashboard', async (req, res) => {
  try {
    if (!req.actor || req.actor === 'anonymous') return res.status(401).json({ error: 'not signed in' });
    await C.query(`UPDATE console_users SET dashboard=$1 WHERE email=$2`, [JSON.stringify(req.body || {}), req.actor]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- users (super admin) ---- */
/* ---- custom roles (create/delete a role, super_admin only) ----
 * A new role is born from a clone (default: call_center's minimal scope) and then tuned in the
 * matrix; it can only be deleted when no user holds it. Built-ins can never be deleted. */
app.post('/api/roles', requireSuper, async (req, res) => {
  try {
    const slug = await rolePerms.addRole(req.body || {});
    await audit(req, 'roles.create', slug, { clone_from: (req.body || {}).clone_from || null });
    res.json(rolePerms.matrix());
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/roles/:name', requireSuper, async (req, res) => {
  try {
    await rolePerms.removeRole(req.params.name);
    await audit(req, 'roles.delete', req.params.name, {});
    res.json(rolePerms.matrix());
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/users', requireCap('manageUsers'), async (req, res) => {
  const r = await C.query(`SELECT * FROM console_users ORDER BY role, email`);
  res.json({ users: r.rows });
});
// safety invariant: never let the LAST enabled Super Admin be demoted/disabled (self-lockout guard)
const IS_SUPER = (role, arr) => role === 'super_admin' || (Array.isArray(arr) && arr.includes('super_admin'));
async function wouldOrphanSuper({ email, willBeSuper, willBeEnabled }) {
  const cur = (await C.query(`SELECT role, roles, enabled FROM console_users WHERE email=$1`, [email])).rows[0];
  if (!cur) return false;
  if (!(cur.enabled && IS_SUPER(cur.role, cur.roles))) return false;   // target isn't an enabled super → nothing to protect
  if (willBeSuper && willBeEnabled) return false;                       // stays an enabled super → fine
  const others = (await C.query(
    `SELECT count(*)::int n FROM console_users WHERE enabled=true AND email<>$1 AND (role='super_admin' OR 'super_admin'=ANY(roles))`, [email])).rows[0].n;
  return others < 1;                                                    // removing the last one
}
const LAST_SUPER_MSG = 'This is the last Super Admin — grant super_admin to another user before changing this one.';
app.post('/api/users', requireCap('manageUsers'), async (req, res) => {
  const b = req.body || {};
  const email = (b.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email required' });
  if (!ALLOWED_DOMAIN.test(email)) return res.status(400).json({ error: 'Use a @salam.sa or @salammobile.sa email.' });
  const tags = Array.isArray(b.tags) ? b.tags : [];
  const rolesArr = (Array.isArray(b.roles) && b.roles.length) ? b.roles : (b.role ? [b.role] : ['report_manager']);
  const primary = roles.effective(rolesArr, rolePerms.current()).primary;
  if (await wouldOrphanSuper({ email, willBeSuper: IS_SUPER(primary, rolesArr), willBeEnabled: true }))
    return res.status(400).json({ error: LAST_SUPER_MSG });
  await C.query(
    `INSERT INTO console_users (email,name,mobile,role,roles,tags,mail_report,mail_alert) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, mobile=EXCLUDED.mobile, role=EXCLUDED.role, roles=EXCLUDED.roles, tags=EXCLUDED.tags,
         mail_report=EXCLUDED.mail_report, mail_alert=EXCLUDED.mail_alert`,
    [email, b.name || null, b.mobile || null, primary, rolesArr, tags, !!b.mail_report, !!b.mail_alert]);
  await audit(req, 'user.upsert', email, { roles: rolesArr });
  res.json({ ok: true });
});
app.patch('/api/users/:id', requireCap('manageUsers'), async (req, res) => {
  const { role, roles: rolesArr, enabled, team, name, mobile, tags, mail_report, mail_alert, tour_seen } = req.body || {};
  const sets = [], vals = [];
  const fields = { enabled, team, name, mobile, tags, mail_report, mail_alert, tour_seen };
  if (Array.isArray(rolesArr)) { const list = rolesArr.length ? rolesArr : ['report_manager']; fields.roles = list; fields.role = roles.effective(list, rolePerms.current()).primary; }
  else if (role) { fields.role = role; fields.roles = [role]; }
  // block demoting/disabling the last Super Admin
  const trow = (await C.query(`SELECT email, role, roles, enabled FROM console_users WHERE id=$1`, [req.params.id])).rows[0];
  if (trow) {
    const willBeSuper = ('roles' in fields) ? IS_SUPER(fields.role, fields.roles) : (role ? IS_SUPER(role, [role]) : IS_SUPER(trow.role, trow.roles));
    const willBeEnabled = (enabled === undefined || enabled === null) ? trow.enabled : !!enabled;
    if (await wouldOrphanSuper({ email: trow.email, willBeSuper, willBeEnabled }))
      return res.status(400).json({ error: LAST_SUPER_MSG });
  }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  await C.query(`UPDATE console_users SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
  await audit(req, 'user.update', req.params.id, req.body);
  res.json({ ok: true });
});

/* ---- settings / sync scheduler ---- */
app.get('/api/settings/sync', async (req, res) => {
  res.json({ sync: await settings.getSetting('sync'), scheduler: settings.schedulerStatus() });
});
app.put('/api/settings/sync', requireCap('manageSync'), async (req, res) => {
  const cur = await settings.getSetting('sync');
  const next = Object.assign({}, cur, req.body || {});
  await settings.setSetting('sync', next);
  await settings.applySchedule();
  await audit(req, 'sync.config', null, next);
  res.json({ sync: next, scheduler: settings.schedulerStatus() });
});

/* board "now": explicit sim → live cursor → clamp to data end (static dump) */
async function boardNow(sim) {
  if (sim) return sim;
  // Only follow the auto-replay virtual clock when the console is actually replaying the
  // static dump. With real prod-sync data, "now" = the newest real row (clamped to wall-clock),
  // so the dashboard reflects today instead of a simulated cursor wandering through history.
  const s = (await settings.getSetting('sync')) || {};
  if (s.enabled && s.mode === 'auto_replay' && s.cursor) return s.cursor;
  try { const b = await dataBounds(); const hi = new Date(b.hi), rn = new Date(); return (rn > hi ? hi : rn).toISOString(); }
  catch (e) { return undefined; }
}

/* ---- error control board ---- */
app.get('/api/errors/summary', async (req, res) => {
  try {
    const { window = 24, team, channel, sim } = req.query;
    const now = await boardNow(sim);
    res.json({ summary: await errors.summary({ now, windowHours: Number(window), team, channel }), now });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/errors/feed', async (req, res) => {
  try {
    const { window = 24, category, team, q, limit = 100, sim, code, gw, cls } = req.query;
    const now = await boardNow(sim);
    const rows = await errors.feed({ now, windowHours: Number(window), category, team, q, limit: Number(limit), code, gw, cls });
    // super_admin (unmaskPII cap) sees real PII on the board; everyone else stays masked
    const allowUnmask = !!(req.caps && req.caps.unmaskPII);
    res.json({ feed: roles.maskDeep(rows, allowUnmask), now, unmasked: allowUnmask });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Per-category failure breakdown by provider code · message (Semati responseCode·responseMessage,
// Nafath status·message) — powers the Troubleshoot code filter.
app.get('/api/errors/code-breakdown', async (req, res) => {
  try {
    const { window = 24, sim, category } = req.query;
    const now = await boardNow(sim);
    res.json(await errors.codeBreakdown({ category, now, windowHours: Number(window) }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// BSS / Semati activation layer: api × status_code with ok/fail counts (write-path health).
// Also returns the OSB read-path note (1500 / OSB-382000 live in logs.uil_logs, not this replica).
app.get('/api/errors/bss-breakdown', async (req, res) => {
  try {
    const { window = 24, sim } = req.query;
    const now = await boardNow(sim);
    res.json(await errors.bssBreakdown({ now, windowHours: Number(window) }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// OSB read-path SOAP faults (1500 / OSB-382000) — LIVE from the OSB integration log (logs.uil_logs,
// MySQL), a separate source from the replica. Inert/graceful until OSB_LOG_URL / OSB_DB_HOST is set.
// LIVE ping, not just "is a URL present". Config with an unreachable host or a placeholder password
// is WORSE than no config: osbProbe starts, fails silently every 5 min, and the console looks wired
// up when it is blind. `ok` is the field that means "we can actually read the OSB log right now".
/* ORACLE STACK FLOW (dashboard POC) — aggregate counts only, no PII; lives under /api/home so
 * dashboard-only roles can render the section (the /api/osb tree is monitoring-gated). */
app.get('/api/home/oracle-stack', async (req, res) => {
  try {
    const osb = require('./osbArchive');
    if (!(await osb.available())) return res.json({ ok: false, note: 'no OSB archive imported' });
    res.json(await respCache.wrap(req, () => osb.stack({ from: req.query.from, to: req.query.to })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* HYPERPAY WATCH (3 Sep 2026) — UPG/Tap disabled, HyperPay is now the customer gateway (STC Pay
 * change). Dashboard section: hourly attempts/success with an STC Pay split + the app-side
 * -10001 "try a different payment method" error track. Aggregates only, follows the dashboard
 * range. Rail = the console's standard expression (works for every gateway incl. HyperPay). */
app.get('/api/home/hyperpay', async (req, res) => {
  try {
    // CUTOVER CLAMP: HyperPay went live for customer payments 3 Sep 2026 16:27 KSA — nothing
    // before that belongs in this view (earlier hyper rows = dealer top-ups / test noise, and
    // the -10001 track would otherwise count UPG/Tap-era errors). Env-overridable.
    const CUTOVER = process.env.HYPERPAY_CUTOVER || '2026-09-03T16:27:00+03:00';
    const to = req.query.to || new Date().toISOString();
    let from = req.query.from || new Date(Date.now() - 24 * 3600e3).toISOString();
    if (new Date(from) < new Date(CUTOVER)) from = new Date(CUTOVER).toISOString();
    /* BRAND: HyperPay does not stamp {data,source} the way UPG did (first live window showed
     * everything falling back to payment_method='credit-card') — try the known HyperPay commit
     * shapes, and ALSO return a key census of real responses so the exact field can be bound. */
    const RAIL = `lower(coalesce(nullif(p.payment_commit_response#>>'{payload,paymentBrand}',''),
                                 nullif(p.payment_commit_response#>>'{payload,brand}',''),
                                 nullif(p.payment_commit_response#>>'{payload,result,paymentBrand}',''),
                                 nullif(p.payment_commit_response#>>'{data,paymentBrand}',''),
                                 nullif(p.payment_commit_response#>>'{data,payload,paymentBrand}',''),
                                 nullif(p.payment_commit_response#>>'{type}',''),
                                 nullif(p.payment_commit_response#>>'{data,source}',''),
                                 CASE WHEN p.payment_commit_response IS NULL
                                        OR p.payment_commit_response::text IN ('{}','null','')
                                      THEN '(initiated — no gateway answer)'
                                      ELSE nullif(p.payment_method,'') END, '?'))`;
    // 5-MINUTE buckets for operational windows (≤12h), hourly beyond — the cutover watch needs
    // minutes, not hours
    const stepSec = (new Date(to) - new Date(from)) <= 12 * 3600e3 ? 300 : 3600;
    const BUCKET = c => `to_timestamp(floor(extract(epoch FROM ${c}) / ${stepSec}) * ${stepSec})`;
    const out = await respCache.wrap(req, async () => {
      const series = (await db.source.query(`
        SELECT ${BUCKET('p.created_at')} b, count(*)::int n,
               count(*) FILTER (WHERE p.status = 'success')::int ok,
               count(*) FILTER (WHERE p.status IN ('fail','failed'))::int fl,
               count(*) FILTER (WHERE ${RAIL} LIKE '%stc%')::int stc_n,
               count(*) FILTER (WHERE ${RAIL} LIKE '%stc%' AND p.status = 'success')::int stc_ok
          FROM payments p
         WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND p.vendor ILIKE '%hyper%'
         GROUP BY 1 ORDER BY 1`, [from, to])).rows;
      const brandFails = (await db.source.query(`
        SELECT ${BUCKET('p.created_at')} b, ${RAIL} AS brand, count(*)::int n
          FROM payments p
         WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz
           AND p.vendor ILIKE '%hyper%' AND p.status IN ('fail','failed')
         GROUP BY 1, 2 ORDER BY 1`, [from, to])).rows;
      const rails = (await db.source.query(`
        SELECT ${RAIL} AS rail, count(*)::int n,
               count(*) FILTER (WHERE p.status = 'success')::int ok,
               count(*) FILTER (WHERE p.status IN ('fail','failed'))::int failed
          FROM payments p
         WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND p.vendor ILIKE '%hyper%'
         GROUP BY 1 ORDER BY n DESC LIMIT 12`, [from, to])).rows;
      const PLAT = `lower(coalesce(nullif(p.platform,''),'(none)'))`;
      // failures per app platform (ios / android / web)
      const platFails = (await db.source.query(`
        SELECT ${BUCKET('p.created_at')} b, ${PLAT} AS plat, count(*)::int n
          FROM payments p
         WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz
           AND p.vendor ILIKE '%hyper%' AND p.status IN ('fail','failed')
         GROUP BY 1, 2 ORDER BY 1`, [from, to])).rows;
      // STC PAY per platform — failures over time + the attempts/success table
      const stcPlatSeries = (await db.source.query(`
        SELECT ${BUCKET('p.created_at')} b, ${PLAT} AS plat, count(*)::int fl
          FROM payments p
         WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz
           AND p.vendor ILIKE '%hyper%' AND ${RAIL} LIKE '%stc%' AND p.status IN ('fail','failed')
         GROUP BY 1, 2 ORDER BY 1`, [from, to])).rows;
      const stcPlatTable = (await db.source.query(`
        SELECT ${PLAT} AS plat, count(*)::int n,
               count(*) FILTER (WHERE p.status = 'success')::int ok,
               count(*) FILTER (WHERE p.status IN ('fail','failed'))::int failed
          FROM payments p
         WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz
           AND p.vendor ILIKE '%hyper%' AND ${RAIL} LIKE '%stc%'
         GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [from, to])).rows;
      // census of the real commit-response keys (top level + data.*) — for exact brand binding
      let respKeys = [];
      try {
        respKeys = (await db.source.query(`
          WITH s AS (SELECT p.payment_commit_response::jsonb j FROM payments p
                      WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz
                        AND p.vendor ILIKE '%hyper%' AND p.payment_commit_response IS NOT NULL
                      ORDER BY p.created_at DESC LIMIT 200)
          SELECT k, count(*)::int n FROM (
            SELECT jsonb_object_keys(j) AS k FROM s
            UNION ALL
            SELECT 'data.' || jsonb_object_keys(j->'data') FROM s WHERE jsonb_typeof(j->'data') = 'object'
            UNION ALL
            SELECT 'payload.' || jsonb_object_keys(j->'payload') FROM s WHERE jsonb_typeof(j->'payload') = 'object'
          ) x GROUP BY 1 ORDER BY 2 DESC LIMIT 24`, [from, to])).rows;
      } catch (e) { respKeys = [{ k: 'census failed: ' + e.message.slice(0, 80), n: 0 }]; }
      // distinct values of the top-level `type` key (may BE the method: stcpay/card/applepay…)
      let typeValues = [];
      try {
        typeValues = (await db.source.query(`
          SELECT coalesce(p.payment_commit_response#>>'{type}', '(none)') AS t, count(*)::int n
            FROM payments p
           WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND p.vendor ILIKE '%hyper%'
           GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [from, to])).rows;
      } catch (e) { typeValues = []; }
      // two digit-masked FAILED samples so the exact brand field can be bound from real payloads
      let respSample = [];
      try {
        respSample = (await db.source.query(`
          SELECT regexp_replace(left(p.payment_commit_response::text, 600), '[0-9]{6,}', '***', 'g') AS s
            FROM payments p
           WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz
             AND p.vendor ILIKE '%hyper%' AND p.status IN ('fail','failed')
             AND p.payment_commit_response IS NOT NULL
           ORDER BY p.created_at DESC LIMIT 2`, [from, to])).rows.map(r => r.s);
      } catch (e) { respSample = []; }
      const failReasons = (await db.source.query(`
        SELECT (${RAIL} LIKE '%stc%') AS is_stc,
               left(coalesce(nullif(p.fail_reason, ''), '(no reason recorded)'), 90) AS reason, count(*)::int n
          FROM payments p
         WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz
           AND p.vendor ILIKE '%hyper%' AND p.status IN ('fail','failed')
         GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 16`, [from, to])).rows;
      // the app-side generic decline the customer sees (PaymentController#commit, -10001)
      const errHourly = (await C.query(`
        SELECT ${BUCKET('ts')} h, count(*)::int n
          FROM api_error_events
         WHERE ts >= $1::timestamptz AND ts < $2::timestamptz
           AND (error_code = '-10001' OR message ILIKE '%different payment method%')
         GROUP BY 1 ORDER BY 1`, [from, to])).rows;
      // honesty: what vendor values actually exist in the window (catches a spelling mismatch)
      const vendors = (await db.source.query(`
        SELECT coalesce(nullif(p.vendor, ''), '(none)') AS v, count(*)::int n
          FROM payments p WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz
         GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [from, to])).rows;
      return { ok: true, from, to, cutover: CUTOVER, step_sec: stepSec, series, brand_fails: brandFails,
               rails, fail_reasons: failReasons, err_series: errHourly, vendors,
               resp_keys: respKeys, type_values: typeValues, resp_sample: respSample,
               plat_fails: platFails, stc_plat_series: stcPlatSeries, stc_plat_table: stcPlatTable };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* OSB LOG ARCHIVE (3 Sep 2026) — SFTP-delivered WebLogic archives parsed into console PG by
 * osbArchive.js (CLI import on 152). Queries are console-DB only, instant. Unmasked by decision
 * (Troubleshoot/Monitoring are L2-gated; L2 reads these logs raw at the source). */
app.get('/api/osb/archive/status', async (req, res) => {
  try { res.json(await require('./osbArchive').status()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/osb/archive/topology', async (req, res) => {
  try { res.json(await respCache.wrap(req, () => require('./osbArchive').topology({ from: req.query.from, to: req.query.to }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/osb/archive/faults', async (req, res) => {
  try { res.json(await respCache.wrap(req, () => require('./osbArchive').faults({ from: req.query.from, to: req.query.to, limit: Number(req.query.limit) || 60 }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/osb/archive/msisdn/:m', async (req, res) => {
  try {
    await audit(req, 'osb.archive.msisdn', String(req.params.m).slice(0, 20), {});
    const to = req.query.to || new Date().toISOString();
    const from = req.query.from || new Date(Date.now() - 7 * 864e5).toISOString();
    res.json(await require('./osbArchive').eventsFor(req.params.m, from, to));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/osb/status', async (req, res) => {
  try {
    const osb = require('./osbLog');
    const base = Object.assign({}, osb.status(), { probe: require('./osbProbe').status() });
    if (!base.configured) return res.json(Object.assign(base, { ok: false, reason: 'not configured' }));
    const p = await osb.ping();
    res.json(Object.assign(base, { ok: !!p.ok, error: p.error || null,
      reason: p.ok ? 'connected' : 'configured but unreachable' }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// API Gateway connectivity — LIVE TCP reachability of the DMS gateway nodes from the console
// container, so the API GW topology page shows real per-node status. READ-ONLY (TCP connect only).
app.get('/api/apigw/connectivity', async (req, res) => {
  try { res.json(await require('./apigwProbe').status()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// API Gateway TRACES — the distilled Zipkin data (apigw_trace_stats per-minute aggregates +
// apigw_slow_spans outliers) that zipkinCollector.js writes. Read-only over the CONSOLE db —
// this endpoint never touches the gateways themselves. Powers Monitoring section ⑤.
/* Shared from/to parser for the APIGW endpoints: explicit ISO dates win over the rolling
 * `window` hours — this is what lets the page-wide date filter reach back into the 30 days of
 * stored aggregates instead of always hanging off now(). Same guard pattern as app-errors. */
function apigwWin(req) {
  const hours = Math.min(720, Math.max(1, Number(req.query.window) || 24));
  const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
  let from = ISO.test(String(req.query.from || '')) ? String(req.query.from).replace(' ', 'T') : null;
  let to = ISO.test(String(req.query.to || '')) ? String(req.query.to).replace(' ', 'T') : null;
  let spanH = hours;
  if (from && to) {
    spanH = (new Date(to) - new Date(from)) / 3600e3;
    if (!(spanH > 0)) { from = to = null; spanH = hours; }
    else if (spanH > 31 * 24) { from = new Date(new Date(to) - 31 * 24 * 3600e3).toISOString(); spanH = 31 * 24; }
  } else { from = to = null; }
  const win = col => from ? `${col} >= '${from}' AND ${col} < '${to}'`
                          : `${col} > now() - interval '${hours} hours'`;
  return { hours: Math.ceil(spanH), from, to, win, unit: spanH <= 6 ? 'minute' : 'hour' };
}
/* how a kept span maps to a FAILURE FAMILY — the vocabulary of the error-focus panel.
 * 1500 = the BSS/OSB SOAP-fault family (INC0016809 signature included by message text). */
const APIGW_FAM = `CASE
  WHEN status_code = '1500' OR error ILIKE '%1500%' OR error ILIKE '%createFault%'
    OR error ILIKE '%unexpected XML tag%' OR error ILIKE '%soap%fault%' THEN '1500'
  WHEN status_code IN ('408','504') OR error ~* '(timeout|timed out|deadline|ETIMEDOUT|read time)' THEN 'timeout'
  WHEN status_code ~ '^5' THEN '5xx'
  WHEN status_code ~ '^4' THEN '4xx'
  ELSE 'other' END`;
const safeParse = s => { if (s == null) return null; try { return JSON.parse(s); } catch (e) { return s; } };
/* REQUEST/RESPONSE SAMPLES for one Digital-API endpoint — on-demand SSH grep of the api_logger
 * file on 17/18 (the same lines ops used to copy by hand into mails). Masked by default, unmask
 * needs the capability + ?unmask=1 and is audited. Request headers are pre-stripped of anything
 * auth-looking at the collector layer. */
app.get('/api/monitoring/api-samples', async (req, res) => {
  try {
    const col = require('./apiLogCollector');
    if (!col.configured()) return res.json({ configured: false });
    const failOnly = req.query.fail !== '0';
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
    let out;
    if (failOnly) {
      /* FAILURES come from the STORED samples first (api_failure_samples — collected every
       * minute with masked bodies, 30-day retention, honours the page window). The live grep
       * remains the fallback for the first minutes after deploy, before the table fills. */
      const W = apigwWin(req);
      const p = String(req.query.path || '').trim();
      if (!/^\/[\w\/.-]{3,120}$/.test(p)) return res.status(400).json({ error: 'invalid path' });
      try {
        const rows = (await C.query(
          `SELECT ts, host, path, transaction_id AS txn, trace_id, response_code, http_status,
                  response_message, duration_ms, platform AS app_platform, app_version,
                  request_body, response_body
             FROM api_failure_samples WHERE ${W.win('ts')} AND path = $1
            ORDER BY ts DESC LIMIT ${limit}`, [p])).rows
          .map(r => ({ ...r, verb: 'POST', failed: true,
            request_body: safeParse(r.request_body), response_body: safeParse(r.response_body),
            ts: r.ts ? new Date(r.ts).toUTCString() : null }));
        out = { configured: true, ok: true, path: p, failOnly: true, source: 'stored', rows };
      } catch (e) { out = null; }
      if (!out || !out.rows.length) {
        const live = await Promise.race([
          col.fetchPathSamples(p, { limit, failOnly: true }),
          new Promise(r => setTimeout(() => r({ configured: true, ok: false, error: 'log search timed out (25s)' }), 25000)),
        ]);
        if (live && live.ok && live.rows && live.rows.length) out = { ...live, source: 'live' };
        else if (!out) out = live;
        if (out) out.source = out.source || 'stored';
      }
    } else {
      out = await Promise.race([
        col.fetchPathSamples(req.query.path, { limit, failOnly: false }),
        new Promise(r => setTimeout(() => r({ configured: true, ok: false, error: 'log search timed out (25s)' }), 25000)),
      ]);
      if (out) out.source = 'live';
    }
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    audit(req, allowUnmask ? 'pii.unmask' : 'API_SAMPLES', String(req.query.path || '').slice(0, 80),
      { rows: (out.rows || []).length, failOnly: out.failOnly, unmask: allowUnmask });
    res.json({ ...roles.maskDeep(out, allowUnmask), unmasked: allowUnmask,
      can_unmask: !!(req.caps && req.caps.unmaskPII) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/monitoring/apigw', async (req, res) => {
  try {
    const zc = require('./zipkinCollector');
    const cstat = zc.status();
    if (!cstat.configured) return res.json({ configured: false });
    const W = apigwWin(req);
    const hours = W.hours, unit = W.unit;
    const [tops, series, slows, meta] = await Promise.all([
      // endpoint league table — ms_sum/calls = true weighted average across minutes
      C.query(`SELECT service, path, method, sum(calls)::int calls, sum(errors)::int errors,
                 CASE WHEN sum(calls) > 0 THEN round(sum(ms_sum)::numeric / sum(calls)) END avg_ms,
                 max(ms_p95) p95_ms, max(ms_max) max_ms
               FROM apigw_trace_stats
               WHERE ${W.win('bucket')} AND path <> '-'
               GROUP BY 1, 2, 3 ORDER BY sum(calls) DESC LIMIT 40`),
      C.query(`SELECT date_trunc('${unit}', bucket) t, sum(calls)::int calls, sum(errors)::int errors
               FROM apigw_trace_stats WHERE ${W.win('bucket')}
               GROUP BY 1 ORDER BY 1`),
      C.query(`SELECT ts, host, service, path, method, status_code, duration_ms, error,
                 trace_id, uil_transaction_id
               FROM apigw_slow_spans WHERE ${W.win('ts')}
               ORDER BY ts DESC LIMIT 40`),
      C.query(`SELECT max(bucket) newest, count(*)::bigint rows FROM apigw_trace_stats`)
    ]);
    res.json({ configured: true, hours, unit, from: W.from, to: W.to, collector: cstat,
      newest: meta.rows[0].newest, statRows: Number(meta.rows[0].rows),
      endpoints: tops.rows, series: series.rows, slow: slows.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* ONE TRACE, from the stored spans — the click-through for ANY row that carries a trace id.
 * Everything comes from apigw_slow_spans (we keep the FULL span set of error/slow traces), plus
 * the Digital-API side of the same call when a uil_transaction_id ties them together. */
app.get('/api/monitoring/apigw/trace', async (req, res) => {
  try {
    const trace = String(req.query.trace || '').trim();
    if (!/^[0-9a-f]{8,32}$/i.test(trace)) return res.status(400).json({ error: 'trace id required' });
    const spans = (await C.query(
      `SELECT ts, host, service, kind, name, path, method, status_code, duration_ms,
              remote_service, error, span_id, parent_id, uil_transaction_id, tags
         FROM apigw_slow_spans WHERE trace_id = $1 ORDER BY ts, duration_ms DESC LIMIT 100`, [trace])).rows;
    const uil = [...new Set(spans.map(s => s.uil_transaction_id).filter(Boolean))];
    let app = [];
    if (uil.length) {
      app = (await C.query(
        `SELECT ts, host, path, response_code, response_message, duration_ms, transaction_id
           FROM api_traffic_events WHERE transaction_id = ANY($1) ORDER BY ts LIMIT 20`, [uil])).rows;
    }
    audit(req, 'APIGW_TRACE', trace.slice(0, 32), { spans: spans.length });
    res.json({ trace, spans, uil_ids: uil, app });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* IMPACTED CUSTOMERS for the 1500/OSB fault family — the table the BSS mails keep pasting as
 * raw MSISDN lists. Source = uil_logs (OSB integration layer), where the fault rows carry the
 * identifiers. MASKED by default; unmasking needs the capability + explicit ?unmask=1 and is
 * audited per view — the house PII pattern. */
app.get('/api/monitoring/apigw/impacted', async (req, res) => {
  try {
    const osb = require('./osbLog');
    if (!osb.configured()) return res.json({ configured: false });
    const W = apigwWin(req);
    const minutes = Math.ceil(((W.from && W.to) ? (new Date(W.to) - new Date(W.from)) : W.hours * 3600e3) / 60000);
    /* NOTE: uil_logs is filtered NOW()-relative (its time column is indexed that way) — a
     * historic from/to deeper than the span-from-now is approximated by the same span ending
     * now, and the response says so instead of silently pretending. */
    const out = await require('./osbLog').impacted({ minutes });
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    audit(req, allowUnmask ? 'pii.unmask' : 'APIGW_IMPACTED', null,
      { minutes, count: (out.impacted || []).length, unmask: allowUnmask });
    if (!allowUnmask && out.impacted) {
      out.impacted = out.impacted.map(r => ({ ...r,
        id: String(r.id).slice(0, 4) + '*'.repeat(Math.max(0, String(r.id).length - 7)) + String(r.id).slice(-3) }));
    }
    out.unmasked = allowUnmask;
    out.can_unmask = !!(req.caps && req.caps.unmaskPII);
    out.note = (W.from && W.to) ? `uil_logs is scanned relative to now — showing the last ${Math.round(minutes / 60)}h, not the historic range` : null;
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* ERROR FOCUS — the "we feel lost chasing the 1500" panel. One failure-family filter over the
 * kept spans: per-family counts, the family's trend, its top endpoints and its recent cases,
 * all in the SAME window as the rest of the page. Families: 1500 (BSS/OSB SOAP-fault
 * signature), timeout, 5xx, 4xx, other. */
app.get('/api/monitoring/apigw/errfocus', async (req, res) => {
  try {
    const W = apigwWin(req);
    const fam = String(req.query.fam || '').trim();       // '' = all families
    const FAMP = fam ? `AND ${APIGW_FAM} = '${fam.replace(/[^0-9a-zx]/gi, '')}'` : '';
    const [families, series, tops, cases] = await Promise.all([
      C.query(`SELECT ${APIGW_FAM} fam, count(*)::int n
                 FROM apigw_slow_spans WHERE ${W.win('ts')} AND (error IS NOT NULL OR status_code ~ '^[45]')
                GROUP BY 1 ORDER BY n DESC`),
      C.query(`SELECT date_trunc('${W.unit}', ts) t, count(*)::int n
                 FROM apigw_slow_spans WHERE ${W.win('ts')} AND (error IS NOT NULL OR status_code ~ '^[45]') ${FAMP}
                GROUP BY 1 ORDER BY 1`),
      C.query(`SELECT service, path, count(*)::int n,
                      round(avg(duration_ms))::int avg_ms, max(ts) last_seen
                 FROM apigw_slow_spans WHERE ${W.win('ts')} AND (error IS NOT NULL OR status_code ~ '^[45]') ${FAMP}
                GROUP BY 1,2 ORDER BY n DESC LIMIT 12`),
      C.query(`SELECT ts, host, service, path, method, status_code, duration_ms,
                      left(coalesce(error,''), 160) AS error, trace_id, uil_transaction_id,
                      ${APIGW_FAM} AS fam
                 FROM apigw_slow_spans WHERE ${W.win('ts')} AND (error IS NOT NULL OR status_code ~ '^[45]') ${FAMP}
                ORDER BY ts DESC LIMIT 400`),
    ]);
    res.json({ from: W.from, to: W.to, hours: W.hours, unit: W.unit, fam: fam || null,
      families: families.rows, series: series.rows, top: tops.rows, cases: cases.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* ONE endpoint's story — backs the click-through from the latency league table.
 * Everything comes from the console's own stored aggregates (apigw_trace_stats) plus the outlier
 * spans we kept (apigw_slow_spans), so it stays fast and works long after the gateway has rolled
 * its own 1–3h retention window. */
app.get('/api/monitoring/apigw/endpoint', async (req, res) => {
  try {
    const service = String(req.query.service || '').trim();
    const path = String(req.query.path || '').trim();
    const method = String(req.query.method || '').trim();
    if (!path) return res.status(400).json({ error: 'path required' });
    const W = apigwWin(req);
    const hours = W.hours, unit = W.unit;
    const where = `${W.win('bucket')} AND path = $1
                   AND ($2 = '' OR service = $2) AND ($3 = '' OR method = $3)`;
    const p = [path, service, method];
    const [tot, series, spans] = await Promise.all([
      C.query(`SELECT sum(calls)::bigint calls, sum(errors)::bigint errors,
                      CASE WHEN sum(calls)>0 THEN round(sum(ms_sum)::numeric/sum(calls)) END avg_ms,
                      max(ms_p95) p95_ms, max(ms_max) max_ms, min(bucket) first_seen, max(bucket) last_seen
                 FROM apigw_trace_stats WHERE ${where}`, p),
      C.query(`SELECT date_trunc('${unit}', bucket) t, sum(calls)::int calls, sum(errors)::int errors,
                      max(ms_p95) p95_ms
                 FROM apigw_trace_stats WHERE ${where} GROUP BY 1 ORDER BY 1`, p),
      /* the kept outliers for THIS endpoint — the only place a status code, an error string and a
       * trace id survive, which is what turns "p95 is 25s" into something actionable */
      C.query(`SELECT ts, host, status_code, duration_ms, error, trace_id, uil_transaction_id
                 FROM apigw_slow_spans
                WHERE ${W.win('ts')} AND path = $1
                  AND ($2 = '' OR service = $2) AND ($3 = '' OR method = $3)
                ORDER BY duration_ms DESC NULLS LAST LIMIT 25`, p)
    ]);
    const t = tot.rows[0] || {};
    res.json({ service, path, method, hours, unit,
      totals: { calls: Number(t.calls || 0), errors: Number(t.errors || 0), avg_ms: t.avg_ms,
        p95_ms: t.p95_ms, max_ms: t.max_ms, first_seen: t.first_seen, last_seen: t.last_seen,
        error_rate: Number(t.calls) ? +(Number(t.errors) * 100 / Number(t.calls)).toFixed(2) : 0 },
      series: series.rows, spans: spans.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DEALER 360 — the DMS system of record for one dealer, plus the app's own view of them and any
 * disagreement between the two. Read-only against the Clara Galera cluster. */
app.use('/api/dms', requireView('dms'));   // whole DMS page API — mirrors the nav gate (must precede every /api/dms route)
app.get('/api/dms/dealer360', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q required (dealer code, username, account no, terminal id, national id or mobile)' });
    /* Unmasking is an ACT, not a mode — the house pattern used by the delivery trace and the
     * gateway payload view. It needs BOTH the capability and an explicit unmask=1 on the
     * request, and each reveal is audited as `pii.unmask` with the record named, so "who looked
     * at this dealer's identifiers, and when" is answerable afterwards. */
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    const out = await require('./dealer360').dealer360(q);
    audit(req, allowUnmask ? 'pii.unmask' : 'DEALER_360', q.slice(0, 40),
      { found: !!out.found, unmask: allowUnmask, subject: 'dealer' });
    res.json({ ...roles.maskDeep(out, allowUnmask), unmasked: allowUnmask, can_unmask: !!(req.caps && req.caps.unmaskPII) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* Dealer-code autocomplete. Codes are not PII, so this returns them in clear — the name beside
 * each is masked by maskDeep like everywhere else. */
app.get('/api/dms/dealer-codes', async (req, res) => {
  try {
    const out = await require('./dealerBoard').codes(String(req.query.q || ''), req.query.limit);
    res.json(roles.maskDeep({ rows: out }, false));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* The dealer network as a board: filter, rank, and the derived badges. */
app.get('/api/dms/dealers', async (req, res) => {
  try {
    const o = {};
    ['dealer_type', 'status', 'user_type', 'partner', 'location_of_sales', 'employee_type', 'role',
      'region', 'q', 'sort', 'limit', 'pool'].forEach(k => { if (req.query[k]) o[k] = req.query[k]; });
    // was hardcoded maskDeep(..., false) — the ONE endpoint that ignored the reveal toggle (found 1 Sep)
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    if (allowUnmask) await audit(req, 'pii.unmask', 'dealer-board', {});
    res.json({ ...roles.maskDeep(await require('./dealerBoard').board(o), allowUnmask),
      unmasked: allowUnmask, can_unmask: !!(req.caps && req.caps.unmaskPII) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DEALER WALLET STATEMENT — the report Ops currently raises a ticket for (INC0020115 pattern:
 * "commission deposit report for pos_016740, 10→19 Aug"). Same 11 columns as the file the app
 * team returns by hand. `format=xlsx` streams a real Excel file; anything else returns JSON so
 * the panel can preview totals before downloading.
 * Identifiers follow the same rule as everywhere else: masked unless the caller holds unmaskPII
 * AND asks — and a statement download is audited either way, because it leaves the console. */
app.get('/api/dms/dealer/statement', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q required (dealer code / username / account no)' });
    const dealer = await require('./dealer360').find(q);
    if (!dealer) return res.status(404).json({ error: `No dealer matched "${q}".` });

    const from = req.query.from ? String(req.query.from) : null;   // 'YYYY-MM-DD' or full datetime
    const to = req.query.to ? String(req.query.to) : null;
    const st = await require('./walletStatement').statement(dealer, {
      from: from ? from + (from.length === 10 ? ' 00:00:00' : '') : null,
      to: to ? to + (to.length === 10 ? ' 23:59:59' : '') : null
    });
    if (!st.ok) return res.status(422).json(st);

    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    audit(req, 'DEALER_STATEMENT', q.slice(0, 40),
      { rows: st.count, from, to, format: req.query.format || 'json', unmask: allowUnmask });

    if (String(req.query.format) !== 'xlsx') {
      return res.json(roles.maskDeep({ ...st, dealer: { username: dealer.username, dealer_code: dealer.dealer_code,
        name: [dealer.first_name, dealer.last_name].filter(Boolean).join(' ') || null } }, allowUnmask));
    }

    /* Column order is the sample's, exactly — the recipients already read this layout, and a
     * report that arrives with the columns shuffled costs more trust than it saves effort. */
    const HEAD = ['username', 'updated_on', 'amount', 'account_from', 'account_to', 'comments',
      'status', 'transaction_type', 'source_system', 'net_amount', 'running_balance'];
    const body = st.rows.map(r => HEAD.map(h => {
      const v = r[h];
      return (v instanceof Date) ? v.toISOString().replace('T', ' ').slice(0, 19) : v;
    }));
    const T = st.totals;
    const summary = [
      ['Dealer wallet statement'], [],
      ['dealer', dealer.dealer_code || dealer.username], ['username', dealer.username],
      ['wallet account', st.account_number],
      ['period', `${st.window.from || 'all'} → ${st.window.to || 'all'}`],
      ['rows', st.count], [],
      ['money in', T.in], ['money out', T.out], ['net movement', T.net],
      ['commission in period', T.commission], ['closing balance', T.closing], [],
      ['by transaction type', 'count', 'net'],
      ...st.by_type.map(t => [t.type, t.count, t.net]), [],
      ['source table', `${st.source.schema}.${st.source.table}`],
      /* State the provenance of running_balance inside the file. A recipient who forwards this
       * to finance must be able to see whether the balance came from the system or from us. */
      ['running_balance', st.source.running_balance_basis],
      ['generated', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'],
      ['generated by', req.sessionEmail || 'console']
    ];
    const buf = require('./xlsx').build([
      { name: 'Statement', rows: [HEAD, ...body], numericCols: [2, 9, 10],
        widths: [14, 20, 11, 16, 16, 34, 10, 20, 18, 12, 15] },
      { name: 'Summary', rows: summary, numericCols: [1, 2], widths: [26, 22, 14] }
    ]);
    const fname = `${(dealer.username || dealer.dealer_code || 'dealer').replace(/[^\w.-]/g, '_')}`
      + `${from ? '_' + from.slice(0, 10) : ''}${to ? '_' + to.slice(0, 10) : ''}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DMS COMMISSION REPORT — replaces the "please share the list of users who got this commission"
 * mail loop (Flex packages thread, 30-31 Aug 2026). Filter by window / plan / dealer / identifier;
 * JSON for the panel, format=xlsx for the full workbook, format=pdf for the executive summary.
 * Identifiers masked unless the caller holds unmaskPII AND asks; every export audited, because it
 * leaves the console. Read-only on the DMS cluster via the discovery-driven module. */
app.get('/api/dms/commission/report', async (req, res) => {
  try {
    const opts = { from: req.query.from, to: req.query.to, plan: req.query.plan,
      dealer: req.query.dealer, q: req.query.q,
      commissionOnly: req.query.commissionOnly === '1', limit: req.query.limit };
    const fmt = String(req.query.format || 'json');
    // json (the commissioning board + preview) is respCache'd — it re-renders on every range
    // change and the query walks a 2.1M-row window. Exports stay fresh (and are audited anyway).
    const st = fmt === 'json'
      ? await respCache.wrap(req, () => require('./commissionReport').report(opts))
      : await require('./commissionReport').report(opts);
    if (!st.ok) return res.status(422).json(st);
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    audit(req, 'COMMISSION_REPORT', (opts.plan || 'all-plans').slice(0, 40),
      { rows: st.count, from: st.window.from, to: st.window.to, format: fmt,
        dealer: opts.dealer || null, unmask: allowUnmask });

    const maskId = v => v == null ? null : String(v).replace(/^(\d{2})\d+(\d{3})$/, '$1*****$2');
    const rows = st.rows.map(r => ({ ...r,
      msisdn: allowUnmask ? r.msisdn : maskId(r.msisdn),
      customer_id: allowUnmask ? r.customer_id : maskId(r.customer_id),
      iccid: allowUnmask ? r.iccid : maskId(r.iccid) }));

    if (fmt === 'json') {
      const preview = rows.slice(0, 200);
      return res.json({ ...st, rows: preview, previewOf: st.count });
    }

    const fmtDt = v => (v instanceof Date) ? v.toISOString().replace('T', ' ').slice(0, 19) : (v == null ? '' : String(v));
    const T = st.totals;
    const fname = `commission_${(opts.plan || 'all').replace(/[^\w.-]/g, '_')}_${st.window.from.slice(0, 10)}_${st.window.to.slice(0, 10)}`;

    if (fmt === 'xlsx') {
      /* Column order = the mail's own layout, exactly — recipients already read this shape. */
      const HEAD = ['mobile_number', 'channel_username', 'insert_date_time', 'customer_id_number',
        'commission', 'sim_iccid_number', 'price_plan_name', 'price_plan_price', 'commission_amount'];
      const KEYS = ['msisdn', 'dealer', 'at', 'customer_id', 'commission', 'iccid', 'plan', 'price', 'commission_amount'];
      const body = rows.map(r => KEYS.map(k => k === 'at' ? fmtDt(r.at) : (r[k] == null ? '' : r[k])));
      const buf = require('./xlsx').build([
        { name: 'Data', rows: [HEAD, ...body], numericCols: [7, 8], moneyCols: [7, 8], widths: [15, 15, 20, 16, 10, 22, 26, 14, 14] },
        { name: 'By plan', rows: [['plan', 'activations', 'commission', 'revenue'],
            ...st.byPlan.map(x => [x.plan, Number(x.n), Number(x.commission), Number(x.revenue)])],
          numericCols: [1, 2, 3], moneyCols: [2, 3], widths: [30, 12, 14, 14] },
        { name: 'By dealer', rows: [['dealer', 'activations', 'commission'],
            ...st.byDealer.map(x => [x.dealer, Number(x.n), Number(x.commission)])],
          numericCols: [1, 2], moneyCols: [2], widths: [20, 12, 14] },
        { name: 'Daily', rows: [['day', 'activations', 'commission'],
            ...st.byDay.map(x => [fmtDt(x.day).slice(0, 10), Number(x.n), Number(x.commission)])],
          numericCols: [1, 2], moneyCols: [2], widths: [14, 12, 14] },
        { name: 'Summary', rows: [
            ['Commission report'], [],
            ['period', `${st.window.from} -> ${st.window.to}`],
            ['source', st.source], ['rows in Data sheet', st.count],
            ...(st.truncated ? [['NOTE', `row export capped - totals below cover the FULL window`]] : []),
            [], ['total activations', T.total], ['with commission', T.with_commission],
            ['commission total (SAR)', T.commission_total], ['plan revenue total (SAR)', T.revenue_total],
            ['distinct dealers', T.dealers], [],
            ['identifiers', allowUnmask ? 'UNMASKED (audited)' : 'masked'],
            ['generated', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'],
            ['generated by', req.sessionEmail || 'console']],
          numericCols: [1], widths: [26, 30], filter: false }
      ]);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
      return res.send(buf);
    }

    if (fmt === 'pdf') {
      const d = require('./pdfout').doc({ footer: `Salam Operations Console - commission report - ${st.window.from.slice(0,10)} to ${st.window.to.slice(0,10)}` });
      const CC = d.colors;
      /* brand header: leaf mark + wordmark (base-14 fonts only on 152 — the wordmark IS the logo) */
      const hb = d.band(66, CC.dark);
      d.mark(46, hb + 15, 7, 36, CC.green);
      d.mark(55, hb + 15, 3, 36, [0.04, 0.55, 0.28]);
      d.at(66, hb + 38, 'salam', { size: 24, bold: true, color: CC.white });
      d.at(67, hb + 51, 'DIGITAL CONSOLE', { size: 7, color: [0.62, 0.8, 0.7] });
      d.at(330, hb + 30, 'DMS COMMISSION REPORT', { size: 12, bold: true, color: CC.white });
      d.at(330, hb + 44, `${st.window.from.slice(0, 10)}  ->  ${st.window.to.slice(0, 10)}`, { size: 9, color: [0.62, 0.8, 0.7] });
      d.space(12);
      d.p(`This report covers dealer activations on the DMS channel${opts.plan ? ` filtered to plans matching "${opts.plan}"` : ''}${opts.dealer ? `, dealer "${opts.dealer}"` : ''}${opts.commissionOnly ? ', commissioned activations only' : ''}. ` +
        `Source: ${st.source} (the DMS activation ledger). Commission amounts are ${st.amount_basis && st.amount_basis.startsWith('computed') ? 'computed as plan price x plan % from renew_now_commission_rules - the same formula DMS applies' : 'taken from the ledger'}. ` +
        `Identifiers are ${allowUnmask ? 'UNMASKED in this extract (capability-verified and audited)' : 'masked'}. Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC by ${req.sessionEmail || 'console'}.`,
        { size: 8.8, color: CC.muted });
      d.h2('Key figures');
      d.kv([
        ['Total activations', String(T.total)],
        ['With commission', `${T.with_commission}  (${T.total ? Math.round(100 * T.with_commission / T.total) : 0}%)`],
        ['Commission total', `${T.commission_total.toLocaleString()} SAR`],
        ['Plan revenue total', `${T.revenue_total.toLocaleString()} SAR`],
        ['Distinct dealers', String(T.dealers)],
        ['Identifiers', allowUnmask ? 'UNMASKED (audited)' : 'masked']
      ]);
      d.h2('Daily activations');
      d.colChart(st.byDay.map(x => ({ label: fmtDt(x.day).slice(5, 10), v: Number(x.n) })));
      d.h2('Top plans - activations');
      d.hChart(st.byPlan.slice(0, 10).map(x => ({ label: String(x.plan || '?'), v: Number(x.n),
        right: `${Number(x.n).toLocaleString()} - ${Math.round(Number(x.commission)).toLocaleString()} SAR` })));
      d.h2('Top dealers - commission');
      d.hChart(st.byDealer.slice(0, 10).map(x => ({ label: String(x.dealer || '?'), v: Number(x.commission),
        right: `${Math.round(Number(x.commission)).toLocaleString()} SAR - ${Number(x.n).toLocaleString()} act.` })), { color: [0.043, 0.42, 0.30] });
      d.h2('By plan - detail');
      d.table([{ label: 'Plan', w: 200 }, { label: 'Activations', w: 70, align: 'right' },
               { label: 'Commission SAR', w: 90, align: 'right' }, { label: 'Revenue SAR', w: 90, align: 'right' }],
        st.byPlan.map(x => [String(x.plan || '?'), Number(x.n).toLocaleString(), Math.round(Number(x.commission)).toLocaleString(), Math.round(Number(x.revenue)).toLocaleString()]));
      d.h2('Daily detail');
      d.table([{ label: 'Day', w: 90 }, { label: 'Activations', w: 70, align: 'right' },
               { label: 'Commission SAR', w: 90, align: 'right' }],
        st.byDay.map(x => [fmtDt(x.day).slice(0, 10), Number(x.n).toLocaleString(), Math.round(Number(x.commission)).toLocaleString()]));
      d.space(4); d.hr();
      d.p(`Full row-level data (${st.count} rows) is in the Excel export. Identifiers in this PDF and the console are masked by default; unmasked extracts require the unmask capability and are audited.`);
      const buf = d.buffer();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
      return res.send(buf);
    }
    return res.status(400).json({ error: 'format must be json | xlsx | pdf' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dms/db-health', async (req, res) => {
  try { res.json(await require('./dmsDb').ping()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/osb/faults', async (req, res) => {
  try { res.json(await require('./osbLog').faults({ minutes: Number(req.query.minutes) || 60 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Gateway activity inside a TIME WINDOW — for journeys whose events carry no transaction id
// (e.g. an order that never reached activation): what the gateway saw while this order moved.
// Console-DB only (stored aggregates + outlier spans), indexed by time — always fast.
app.get('/api/apigw/window', async (req, res) => {
  try {
    const from = new Date(req.query.from), to = new Date(req.query.to || Date.now());
    if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'from/to required (ISO)' });
    const spanMs = to - from;
    if (spanMs <= 0 || spanMs > 6 * 3600 * 1000) return res.status(400).json({ error: 'window must be 0–6h' });
    const zc = require('./zipkinCollector').status();
    if (!zc.configured) return res.json({ configured: false });
    const [eps, slows] = await Promise.all([
      C.query(`SELECT service, path, method, sum(calls)::int calls, sum(errors)::int errors,
                 max(ms_p95) p95_ms, max(ms_max) max_ms
               FROM apigw_trace_stats WHERE bucket >= $1 AND bucket <= $2 AND path <> '-'
               GROUP BY 1, 2, 3 ORDER BY sum(errors) DESC, sum(calls) DESC LIMIT 25`, [from, to]),
      C.query(`SELECT ts, service, path, method, status_code, duration_ms, error, uil_transaction_id
               FROM apigw_slow_spans WHERE ts >= $1 AND ts <= $2 ORDER BY ts LIMIT 40`, [from, to])
    ]);
    res.json({ configured: true, from: from.toISOString(), to: to.toISOString(),
      endpoints: eps.rows, slow: slows.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// FULL request/response JSON for one transaction — on-demand SSH grep of the api_logger file on
// the API hosts (the collector's stored events keep only the distilled fields). PII: masked by
// default via maskDeep; raw needs unmaskPII capability + explicit ?unmask=1 (audited), matching
// /api/transaction. Request headers are never returned (auth tokens).
app.get('/api/apigw/txn/:id/payloads', async (req, res) => {
  try {
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    const d = await require('./apiLogCollector').fetchTxnPayloads(req.params.id);
    audit(req, allowUnmask ? 'pii.unmask' : 'APIGW_TXN_PAYLOADS', String(req.params.id).slice(0, 64),
      { rows: (d.rows || []).length, unmask: allowUnmask });
    res.json(roles.maskDeep(d, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* DEALER (DMS) gateway activity — the dealer app's whole workflow crosses the APIGW, so the
 * stored trace aggregates give a live picture of what dealers DO and what they SUFFER.
 * Built from the observed 24h path census (2026-08-17): Keycloak dmsapplication = logins;
 * getowneruser = app session bootstraps; /api/cus/simactivation/* = the selling flow;
 * deductdealerbalance = paid dealer activations; /AppCrm/* = Siebel screens (the slow ones).
 * COUNTING RULE: one canonical (service,path) per operation — gateway ingress '/api/…' rows for
 * gateway-routed ops, specific service+path for internal hops — so a call is never counted at
 * two tiers. No dealer identity exists in spans (no seller_id tag): this is the COLLECTIVE
 * dealer experience; per-dealer attribution stays with onboarding_orders.seller_id. */
/* Dealer-operation map: service+path -> human label. ONE definition, used by the overview
 * (/api/apigw/dealers) and the drill (/api/apigw/dealers/op) — if they ever diverged, a row
 * clicked in the table would drill into a different population than it displayed. */
const DEALER_OP = `CASE
      WHEN service='trms-api-gateway' AND path='/auth/realms/dmsapplication/protocol/openid-connect/userinfo' THEN 'Dealer login / session (Keycloak)'
      WHEN service='dms-onboarding-services' AND path='/onboarding/dms/user/getowneruser' THEN 'App session bootstrap'
      WHEN service='dms-onboarding-services' AND path='/onboarding/v1/user/dashboard' THEN 'Dealer dashboard'
      WHEN service='dms-onboarding-services' AND path='/onboarding/user/checkNafathStatus' THEN 'Nafath status check'
      WHEN service='trms-api-gateway' AND path='/api/cus/simactivation/eligibility' THEN 'Activation · eligibility'
      WHEN service='trms-api-gateway' AND path='/api/cus/simactivation/activate' THEN 'Activation · activate SIM'
      WHEN service='trms-api-gateway' AND path='/api/uil/bss/account/create-individual-subscriber' THEN 'Activation · create subscriber (BSS)'
      WHEN service='trms-api-gateway' AND path='/api/uil/bss/eligible-plans-for-dealer' THEN 'Plans for dealer'
      WHEN service='trms-api-gateway' AND path LIKE '/api/uil/self-activation-portal/wallet/%' THEN 'Dealer wallet'
      WHEN service='trms-api-gateway' AND path LIKE '/api/cus/simswap/%' THEN 'SIM swap'
      WHEN service='trms-api-gateway' AND path LIKE '/api/cus/mnp/%' THEN 'MNP / port-in'
      WHEN service='trms-api-gateway' AND path='/api/uil/bss/crm/list-resources' THEN 'CRM resources (Siebel)'
      WHEN service='trms-api-gateway' AND path LIKE '/api/uil/bss/invoices/%' THEN 'Invoices'
      WHEN service='trms-api-gateway' AND path LIKE '/api/uil/bss/mobile-number/%' THEN 'Number selection'
      WHEN service='trms-api-gateway' AND path LIKE '/api/uil/bss/generic-entity/%' THEN 'Number reservation'
      WHEN service='trms-api-gateway' AND path LIKE '/api/uil/bss/subscription/%' THEN 'Subscription ops (BSS)'
      WHEN service='trms-api-gateway' AND path LIKE '/api/uil/bss/account/%' THEN 'Account profile (BSS)'
      WHEN service='unified-integration-layer' AND path='/AppCrm/home' THEN 'CRM home screen (Siebel)'
      WHEN service='unified-integration-layer' AND path='/AppCrmInvoice/home' THEN 'CRM invoices (Siebel)'
      WHEN service='dms-customer-services' AND path='/tpi/bss/account/list-account-id' THEN 'Account-id lookup (TPI)'
      WHEN service='dms-customer-services' AND path='/cus/visitorplan/getsocialdata' THEN 'Visitor plans · social data'
      WHEN service='dms-customer-services' AND path='/cus/customer/verifyfingerprintauth' THEN 'Fingerprint auth'
      WHEN service='dms-tpi-service' AND path='/TCC-Web/api/eligibility/v2' THEN 'TCC eligibility (provider)'
      WHEN service='dms-customer-services' AND path LIKE '/was/payment/%' THEN 'Dealer payments (WAS)'
      WHEN service='dms-notification-service' AND path='/notification/notification/sendsms' THEN 'SMS sends'
      ELSE NULL END`;

/* DRILL-DOWN behind the dealer-gateway numbers. Three entry shapes, one endpoint:
 *   ?op=<label>        — a row in the operations table: which paths/methods, when, which spans
 *   ?service=<name>    — a service chip: same breakdown across that service
 *   (neither)          — an hour clicked on the chart: per-operation breakdown of that hour
 * Aggregates come from apigw_trace_stats (every call); the span list comes from apigw_slow_spans,
 * which by design keeps ONLY errors and outliers — stated in the response so nobody mistakes the
 * sample for the population. */
app.get('/api/apigw/dealers/op', async (req, res) => {
  try {
    const from = new Date(req.query.from), to = new Date(req.query.to || Date.now());
    if (isNaN(from) || isNaN(to) || to <= from) return res.status(400).json({ error: 'from/to required (ISO)' });
    const op = req.query.op ? String(req.query.op).slice(0, 80) : null;
    const service = req.query.service ? String(req.query.service).slice(0, 60) : null;
    const P = [from.toISOString(), to.toISOString()];
    const unit = (to - from) / 3600e3 <= 3 ? 'minute' : (to - from) / 3600e3 <= 48 ? 'hour' : 'day';
    let cond = '', p3 = [...P];
    if (op) { cond = `AND (${DEALER_OP}) = $3`; p3.push(op); }
    else if (service) { cond = 'AND service = $3'; p3.push(service); }
    const groupSel = op ? `service, path, method` : service ? `service, path, method`
      : `coalesce((${DEALER_OP}), '(unmapped) ' || service) AS op`;
    const [paths, hourly, spans] = await Promise.all([
      C.query(`SELECT ${groupSel}, sum(calls)::int calls, sum(errors)::int errors,
                 CASE WHEN sum(calls)>0 THEN round(sum(ms_sum)::numeric/sum(calls)) END avg_ms,
                 max(ms_p95) p95_ms, max(ms_max) max_ms
               FROM apigw_trace_stats WHERE bucket >= $1 AND bucket <= $2 ${cond}
               GROUP BY ${op || service ? '1,2,3' : '1'} ORDER BY errors DESC, calls DESC LIMIT 40`, p3),
      C.query(`SELECT date_trunc('${unit}', bucket) t, sum(calls)::int calls, sum(errors)::int errors,
                 max(ms_p95) p95_ms
               FROM apigw_trace_stats WHERE bucket >= $1 AND bucket <= $2 ${cond}
               GROUP BY 1 ORDER BY 1`, p3),
      C.query(`SELECT ts, service, path, method, status_code, duration_ms, error, trace_id, uil_transaction_id
               FROM apigw_slow_spans WHERE ts >= $1 AND ts <= $2 ${cond.replace('bucket', 'ts')}
               ORDER BY (status_code ~ '^[45]') DESC, ts DESC LIMIT 40`, p3)
    ]);
    // status mix from the retained spans — labelled as sample, not population
    const statuses = {};
    for (const r of spans.rows) { const k = r.status_code || (r.error ? 'ERR' : '?'); statuses[k] = (statuses[k] || 0) + 1; }
    res.json({ op, service, unit, from: P[0], to: P[1],
      paths: paths.rows, hourly: hourly.rows,
      statusSample: Object.entries(statuses).map(([code, n2]) => ({ code, n: n2 })).sort((a, b) => b.n - a.n),
      spans: spans.rows,
      note: 'spans/status mix cover retained outliers (errors + slow calls) only; calls/errors columns cover every call' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/apigw/dealers', async (req, res) => {
  try {
    const from = new Date(req.query.from), to = new Date(req.query.to || Date.now());
    if (isNaN(from) || isNaN(to) || to <= from) return res.status(400).json({ error: 'from/to required (ISO)' });
    const zc = require('./zipkinCollector').status();
    if (!zc.configured) return res.json({ configured: false });
    const P = [from.toISOString(), to.toISOString()];
    const unit = (to - from) / 3600e3 <= 48 ? 'hour' : 'day';
    const OP = DEALER_OP;
    const [ops, series, services, slow] = await Promise.all([
      C.query(`SELECT ${OP} op, sum(calls)::int calls, sum(errors)::int errors,
                 CASE WHEN sum(calls) > 0 THEN round(sum(ms_sum)::numeric / sum(calls)) END avg_ms,
                 max(ms_p95) p95_ms, max(ms_max) max_ms
               FROM apigw_trace_stats WHERE bucket >= $1 AND bucket <= $2 AND (${OP}) IS NOT NULL
               GROUP BY 1 ORDER BY 2 DESC`, P),
      C.query(`SELECT date_trunc('${unit}', bucket) t,
                 sum(calls) FILTER (WHERE path='/auth/realms/dmsapplication/protocol/openid-connect/userinfo')::int logins,
                 sum(errors) FILTER (WHERE path='/auth/realms/dmsapplication/protocol/openid-connect/userinfo')::int login_errors,
                 sum(calls) FILTER (WHERE service='trms-api-gateway' AND path='/api/cus/simactivation/activate')::int activations,
                 sum(calls) FILTER (WHERE service='trms-api-gateway' AND path LIKE '/api/uil/self-activation-portal/wallet/deduct%')::int wallet_deductions
               FROM apigw_trace_stats WHERE bucket >= $1 AND bucket <= $2 GROUP BY 1 ORDER BY 1`, P),
      C.query(`SELECT service, sum(calls)::bigint calls, sum(errors)::bigint errors
               FROM apigw_trace_stats WHERE bucket >= $1 AND bucket <= $2
                 AND (service LIKE 'dms-%' OR service LIKE 'trms-%')
               GROUP BY 1 ORDER BY 2 DESC`, P),
      C.query(`SELECT ts, service, path, method, status_code, duration_ms, error, uil_transaction_id
               FROM apigw_slow_spans WHERE ts >= $1 AND ts <= $2
                 AND (path LIKE '/api/cus/%' OR path LIKE '/AppCrm%' OR path LIKE '/auth/realms/dmsapplication%'
                      OR path LIKE '/tpi/%' OR path LIKE '/onboarding/%' OR path LIKE '/was/%'
                      OR service IN ('dms-customer-services','dms-onboarding-services','trms-wallet-service','trms-commission-service'))
               ORDER BY ts DESC LIMIT 30`, P)
    ]);
    const k = {};
    for (const r of ops.rows) k[r.op] = r;
    res.json({ configured: true, from: P[0], to: P[1], unit,
      kpis: {
        logins: k['Dealer login / session (Keycloak)'] || null,
        app_opens: k['App session bootstrap'] || null,
        eligibility: k['Activation · eligibility'] || null,
        activations: k['Activation · activate SIM'] || null,
        wallet: k['Dealer wallet'] || null
      },
      ops: ops.rows, series: series.rows, services: services.rows, slow: slow.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// One transaction id → all three tiers (app log ⇄ gateway hops ⇄ uil_logs payloads).
// Audited: the payloads can reference a customer's request. Read-only on every source.
app.get('/api/apigw/txn/:id', async (req, res) => {
  try {
    const d = await require('./apigwTrace').forTxn(req.params.id);
    audit(req, 'APIGW_TXN_TRACE', String(req.params.id).slice(0, 64),
      { found: !!d.found, hops: (d.gateway && d.gateway.hops) || 0 });
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* UIL LIVE-LOG ROLLUPS (Phase 3, 3 Sep 2026) — 5-min aggregates sampled from the UIL summary
 * blocks on the DMS app nodes (uilSampler.js). Console-DB only — instant. */
app.get('/api/monitoring/uil', async (req, res) => {
  try { res.json(await respCache.wrap(req, () => require('./uilSampler').board(Number(req.query.hours) || 24))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* DMS APP-LOG REFERENCE SEARCH (Phase 2, 3 Sep 2026) — the customer-facing "log reference ID"
 * (a Sleuth trace id, TKT-000016) greps the service logs on the four DMS APP nodes over SSH.
 * Explicit action only; staged (current logs by default, one day's gz with ?date=); output is
 * MASKED AT SOURCE on the nodes — no unmask path exists here by design. Audited. */
app.get('/api/apigw/logref/:ref', async (req, res) => {
  try {
    const g = require('./dmsLogGrep');
    const ref = g.candidate(req.params.ref);
    if (!ref) return res.status(400).json({ error: 'not a 16-hex trace id or a UUID transaction id' });
    await audit(req, 'dmslog.grep', ref, { date: req.query.date || null });
    res.json(await g.search(ref, { date: req.query.date || null }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===================== DELIVERY PARTNERS (courier wire trace + monitoring) ===================
 * The delivery_requests row is a distilled summary — the REAL exchange with the courier
 * (createOrder body, response, callbacks context) lives in sidekiq.log on the API hosts
 * (every courier client uses HTTParty debug_output). These endpoints surface the truth. */
app.get('/api/delivery/trace', async (req, res) => {
  try {
    const ref = String(req.query.ref || '').trim().slice(0, 64);
    if (!/^[\w.-]{4,64}$/.test(ref)) return res.status(400).json({ error: 'ref required (internal/external reference or delivery id)' });
    const row = (await db.source.query(
      `SELECT id, vendor, delivery_state, internal_reference_id, external_reference_id,
              delivery_on_id, receiver_mobile, created_at, delivered_at
       FROM delivery_requests
       WHERE internal_reference_id = $1 OR external_reference_id = $1
          OR (id::text = $1 AND $1 ~ '^[0-9]+$')
       ORDER BY created_at DESC LIMIT 1`, [ref])).rows[0] || null;
    const refs = row ? [row.internal_reference_id, row.external_reference_id].filter(Boolean) : [ref];
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    audit(req, allowUnmask ? 'pii.unmask' : 'DELIVERY_TRACE', ref, { found: !!row, vendor: row && row.vendor });
    const t = await Promise.race([
      require('./deliveryTrace').trace(refs),
      new Promise(r => setTimeout(() => r({ configured: true, ok: false, error: 'sidekiq.log search timed out (25s)' }), 25000))
    ]);
    res.json(roles.maskDeep({ ref, db: row, log: t }, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Delivery-partner health for Monitoring ⑥ — per-vendor state funnel (buckets = the app's own
// DeliveryRequest model mapping), daily outcome series, and stuck shipments with drill refs.
app.get('/api/monitoring/delivery', async (req, res) => {
  try {
    const h = Math.min(24 * 90, Math.max(1, Number(req.query.window) || 168));
    const S = require('./deliveryTrace').STATES;
    const P = [String(h), S.COMPLETED, S.CANCELLED, S.REFUSED, S.UNDELIVERED, S.NEW];
    const BUCKET = `CASE
      WHEN delivery_state = ANY($2::text[]) THEN 'completed'
      WHEN delivery_state = ANY($3::text[]) THEN 'cancelled'
      WHEN delivery_state = ANY($4::text[]) THEN 'refused'
      WHEN delivery_state = ANY($5::text[]) THEN 'undelivered'
      WHEN delivery_state = ANY($6::text[]) THEN 'new'
      ELSE 'in_progress' END`;
    const qT = (sql, params, ms = 6000) => Promise.race([
      db.source.query(sql, params).catch(() => ({ rows: [] })),
      new Promise(r => setTimeout(() => r({ rows: [] }), ms))]);
    const [vendors, series, stuck, avgT] = await Promise.all([
      qT(`SELECT coalesce(vendor,'?') vendor, ${BUCKET} bucket, count(*)::int n
          FROM delivery_requests WHERE created_at > now() - ($1||' hours')::interval
          GROUP BY 1, 2 ORDER BY 1`, P),
      qT(`SELECT date_trunc('day', created_at) t, ${BUCKET} bucket, count(*)::int n
          FROM delivery_requests WHERE created_at > now() - ($1||' hours')::interval
          GROUP BY 1, 2 ORDER BY 1`, P),
      qT(`SELECT id, vendor, delivery_state, internal_reference_id, external_reference_id,
            receiver_mobile, created_at,
            round(extract(epoch FROM now() - created_at) / 3600)::int age_h
          FROM delivery_requests
          WHERE created_at > now() - ($1||' hours')::interval
            AND created_at < now() - interval '24 hours'
            AND NOT (delivery_state = ANY($2::text[]))
            AND NOT (delivery_state = ANY($3::text[]))
          ORDER BY created_at ASC LIMIT 25`, [String(h), S.COMPLETED, S.CANCELLED]),
      qT(`SELECT coalesce(vendor,'?') vendor,
            round(avg(extract(epoch FROM delivered_at - created_at)) / 3600, 1) avg_hours,
            count(*)::int delivered
          FROM delivery_requests
          WHERE delivered_at IS NOT NULL AND created_at > now() - ($1||' hours')::interval
          GROUP BY 1`, [String(h)])
    ]);
    res.json(roles.maskDeep({
      hours: h, vendors: vendors.rows, series: series.rows, stuck: stuck.rows,
      delivery_time: avgT.rows,
      note: 'buckets mirror DeliveryRequest model state mapping; wire trace per shipment via /api/delivery/trace'
    }, false));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===================== DMS · DEALERS (map + roster + per-dealer detail) =====================
 * Ported from the salam-dealer-ops console per its reuse runbook, adapted to MVNO data reality
 * (verified 17 Aug 2026): stores = 185 rows ALL geolocated → the map layer; dealer ORDERS carry
 * NO geography (delivery coords 2%, store_id/city/area never set, extra = lang+person_id only)
 * → dealer activity is presented WITHOUT geo pretense, plus the few real delivery-coord pins.
 * Upgrade path: the moment the DMS app captures GPS at order create (FTTH app already does),
 * geo_orders fills up and the map becomes the old console's per-order view with no code change. */
// DMS home block — the ops-console "Good evening" header, dealer-flavored: today (from 00:00
// KSA) vs YESTERDAY SAME TIME-OF-DAY, outcome mix, stagnating dealers, top dealers today.
app.get('/api/dms/home', async (req, res) => {
  try {
    const now = new Date();
    const k = new Date(now.getTime() + 3 * 3600e3); k.setUTCHours(0, 0, 0, 0);
    const midnight = new Date(k.getTime() - 3 * 3600e3);            // 00:00 KSA as a UTC instant
    const yFrom = new Date(midnight.getTime() - 864e5), yTo = new Date(now.getTime() - 864e5);
    const cnt = async (a, b) => (await db.source.query(
      `SELECT count(*)::int attempts, count(*) FILTER (WHERE activated)::int activated,
         count(DISTINCT seller_id)::int dealers
       FROM onboarding_orders WHERE seller_id IS NOT NULL AND created_at >= $1 AND created_at < $2`,
      [a.toISOString(), b.toISOString()])).rows[0];
    const [t, y, mix, stag, top] = await Promise.all([
      cnt(midnight, now), cnt(yFrom, yTo),
      db.source.query(`SELECT count(*) FILTER (WHERE activated)::int activated,
          count(*) FILTER (WHERE completed AND NOT activated)::int awaiting_activation,
          count(*) FILTER (WHERE NOT completed AND NOT archived)::int in_progress,
          count(*) FILTER (WHERE archived)::int archived
        FROM onboarding_orders WHERE seller_id IS NOT NULL AND created_at >= $1`, [midnight.toISOString()]),
      db.source.query(`SELECT count(*)::int n FROM (
          SELECT seller_id FROM onboarding_orders
          WHERE seller_id IS NOT NULL AND created_at >= $1
          GROUP BY 1 HAVING count(*) >= 5 AND count(*) FILTER (WHERE activated) = 0) x`, [midnight.toISOString()]),
      db.source.query(`SELECT trim(s.first_name || ' ' || s.last_name) name,
          count(*)::int placed, count(*) FILTER (WHERE o.activated)::int done
        FROM onboarding_orders o JOIN sellers s ON s.id = o.seller_id
        WHERE o.created_at >= $1 GROUP BY 1 ORDER BY done DESC, placed DESC LIMIT 6`, [midnight.toISOString()])
    ]);
    res.json(roles.maskDeep({
      now: now.toISOString(), since: midnight.toISOString(),
      today: t, yesterday_same_time: y,
      pace: y.attempts ? Math.round(100 * t.attempts / y.attempts) : null,
      mix: mix.rows[0], stagnant_dealers: stag.rows[0].n, top_dealers: top.rows
    }, false));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/dms/map', async (req, res) => {
  try {
    const from = new Date(req.query.from), to = new Date(req.query.to || Date.now());
    if (isNaN(from) || isNaN(to) || to <= from) return res.status(400).json({ error: 'from/to required (ISO)' });
    const P = [from.toISOString(), to.toISOString()];
    /* Sub-queries are raced against a timeout — but a timeout must LOOK like a timeout, not like
     * zero stores/dealers (31 Aug: "0 stores on map" next to "3 active dealers" was exactly this,
     * silently). Losers now carry a flag, the response says which layers are partial, and the UI
     * offers a retry instead of presenting silence as data. Timeout raised 6s → 15s. */
    const qT = (sql, params, ms = 15000) => Promise.race([
      db.source.query(sql, params).then(r => ({ rows: r.rows })).catch(e => ({ rows: [], failed: e.message.slice(0, 120) })),
      new Promise(r => setTimeout(() => r({ rows: [], timedOut: true }), ms))]);
    const [stores, dealers, geoOrders, totals] = await Promise.all([
      /* is_eligible was dropped from the replica's stores table at some point — selecting it made
       * this query fail SILENTLY for who-knows-how-long (surfaced 31 Aug by the partial flag:
       * "0 stores" was never real). Column removed; the map layer returns. */
      qT(`SELECT id, store_code, store_name_en name, city_en city, region_en region,
            latitude lat, longitude lng, ownership, sim_replace, port_in
          FROM stores WHERE latitude IS NOT NULL AND longitude IS NOT NULL LIMIT 400`, []),
      qT(`SELECT s.id, trim(s.first_name || ' ' || s.last_name) name, s.username, s.seller_type,
            count(o.id)::int placed, count(*) FILTER (WHERE o.activated)::int done,
            count(*) FILTER (WHERE o.completed AND NOT o.activated)::int pending_activation,
            max(o.created_at) last_at
          FROM sellers s JOIN onboarding_orders o
            ON o.seller_id = s.id AND o.created_at >= $1 AND o.created_at <= $2
          GROUP BY s.id, name, s.username, s.seller_type
          ORDER BY placed DESC LIMIT 300`, P),
      qT(`SELECT o.id, o.delivery_lat lat, o.delivery_lng lng, o.activated, o.aasm_state,
            o.created_at at, trim(s.first_name || ' ' || s.last_name) dealer
          FROM onboarding_orders o LEFT JOIN sellers s ON s.id = o.seller_id
          WHERE o.seller_id IS NOT NULL AND o.delivery_lat IS NOT NULL
            AND o.created_at >= $1 AND o.created_at <= $2 LIMIT 500`, P),
      qT(`SELECT count(*)::int attempts, count(*) FILTER (WHERE activated)::int activated,
            count(DISTINCT seller_id)::int active_dealers
          FROM onboarding_orders WHERE seller_id IS NOT NULL
            AND created_at >= $1 AND created_at <= $2`, P)
    ]);
    const why = x => x.timedOut ? 'timed out' : (x.failed || null);
    const partial = { stores: why(stores), dealers: why(dealers), geo_orders: why(geoOrders), totals: why(totals) };
    // masked by default; reveal needs the capability + explicit ?unmask=1 and is audited (house rule)
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    if (allowUnmask) await audit(req, 'pii.unmask', 'dms-map', { from: P[0], to: P[1] });
    res.json(roles.maskDeep({
      unmasked: allowUnmask, can_unmask: !!(req.caps && req.caps.unmaskPII),
      from: P[0], to: P[1],
      mapsKey: process.env.GMAPS_KEY || null,   // set GMAPS_KEY in .env (same key as the ops app) → Google map; unset → SVG fallback
      stores: stores.rows, dealers: dealers.rows, geo_orders: geoOrders.rows,
      partial: Object.values(partial).some(Boolean) ? partial : null,
      totals: totals.rows[0] || { attempts: 0, activated: 0, active_dealers: 0 }
    }, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Per-dealer detail: KPIs for the window + the SAME-LENGTH previous window (deltas, as the ops
// console does) + the order list, each row carrying its uuid for the Transaction-timeline drill.
app.get('/api/dms/dealer/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad dealer id' });
    const from = new Date(req.query.from), to = new Date(req.query.to || Date.now());
    if (isNaN(from) || isNaN(to) || to <= from) return res.status(400).json({ error: 'from/to required (ISO)' });
    const spanMs = to - from;
    const pFrom = new Date(from.getTime() - spanMs), pTo = from;
    const kpi = async (a, b) => (await db.source.query(
      `SELECT count(*)::int placed, count(*) FILTER (WHERE activated)::int done,
         count(DISTINCT plan_id)::int plans, count(DISTINCT date_trunc('day', created_at))::int active_days
       FROM onboarding_orders WHERE seller_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [id, a.toISOString(), b.toISOString()])).rows[0];
    const [who, cur, prev, orders] = await Promise.all([
      db.source.query(`SELECT id, trim(first_name || ' ' || last_name) name, username, email,
        mobile_number, seller_type, "group" FROM sellers WHERE id = $1`, [id]),
      kpi(from, to), kpi(pFrom, pTo),
      db.source.query(
        `SELECT id, created_at at, plan_id, aasm_state, status, completed, activated, sim_type,
           flow_type, mobile_number, mnp_operator
         FROM onboarding_orders WHERE seller_id = $1 AND created_at >= $2 AND created_at <= $3
         ORDER BY created_at DESC LIMIT 60`, [id, from.toISOString(), to.toISOString()])
    ]);
    if (!who.rows.length) return res.status(404).json({ error: 'dealer not found' });
    const pmap = await plans.loadMap().catch(() => ({}));
    audit(req, 'DMS_DEALER_VIEW', String(id), { orders: orders.rows.length });
    res.json(roles.maskDeep({
      dealer: who.rows[0], from: from.toISOString(), to: to.toISOString(),
      kpis: { current: cur, previous: prev },
      orders: orders.rows.map(r => ({ ...r, plan: plans.label(pmap, r.plan_id) }))
    }, false));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===================== SERVICING (existing customers: recharges · bills · change plans · vouchers) =====
 * Dashboard section for LOGGED/EXISTING customers' transactions in the selected range.
 * Sources: payments (excluding OnboardingOrder; Checkout payments joined to checkouts for the
 * real checkout_type), change_plan_logs (the journey, paid or not), and api_traffic_events for
 * voucher recharges (the app writes NO DB row for vouchers — RechargeController#voucher calls
 * BSS directly — so the console's own API-log capture is the only voucher record; 7-day window). */
app.get('/api/servicing', async (req, res) => {
  try {
    const from = new Date(req.query.from), to = new Date(req.query.to || Date.now());
    if (isNaN(from) || isNaN(to) || to <= from) return res.status(400).json({ error: 'from/to required (ISO)' });
    const spanH = (to - from) / 3600e3;
    const unit = spanH <= 48 ? 'hour' : 'day';
    const P = [from.toISOString(), to.toISOString()];
    const qT = (pool, sql, params, ms = 6000) => Promise.race([
      pool.query(sql, params).catch(() => ({ rows: [] })),
      new Promise(r => setTimeout(() => r({ rows: [] }), ms))]);

    // optional customer filter — MSISDN (any stored form), customer id (users.id) or national id.
    // Resolution happens SERVER-SIDE (the payload is PII-masked, so the client cannot filter).
    let mAny = null, keyInfo = null;
    const key = String(req.query.key || '').trim().slice(0, 40);
    const toForms = m => { const l9 = String(m || '').replace(/\D/g, '').slice(-9);
      return l9.length === 9 ? ['0' + l9, '966' + l9, l9, '+966' + l9] : null; };
    if (key) {
      const digits = key.replace(/\D/g, '');
      if (/5\d{8}$/.test(digits) && digits.length >= 9 && digits.length <= 14) {
        mAny = toForms(digits); keyInfo = { key, via: 'msisdn' };
      } else if (/^[12]\d{9}$/.test(digits)) {
        const u = await qT(db.source, `SELECT mobile_number FROM users WHERE nationality_id_number = $1 LIMIT 1`, [digits]);
        if (u.rows.length) { mAny = toForms(u.rows[0].mobile_number); keyInfo = { key, via: 'national id → customer' }; }
      } else if (/^\d{1,10}$/.test(digits) && digits.length) {
        const u = await qT(db.source, `SELECT mobile_number FROM users WHERE id = $1::bigint LIMIT 1`, [digits]);
        if (u.rows.length) { mAny = toForms(u.rows[0].mobile_number); keyInfo = { key, via: 'customer id' }; }
      }
      if (!mAny) {
        audit(req, 'SERVICING_FILTER', key, { found: false });
        return res.json(roles.maskDeep({ from: P[0], to: P[1], unit, lanes: [], series: [], rows: [],
          filtered: { key, found: false,
            note: 'No customer matched — use an MSISDN (05… / 9665…), a customer id, or a national id. If customer-id lookups never match, the users table may not be in the prod-sync set.' } }, false));
      }
      audit(req, 'SERVICING_FILTER', key, { via: keyInfo.via });
    }
    const KEYP = mAny ? ` AND (p.customer_mobile_number = ANY($3::text[]) OR p.target_mobile_number = ANY($3::text[]))` : '';
    const KEYC = mAny ? ` AND mobile_number = ANY($3::text[])` : '';
    const PP = mAny ? [...P, mAny] : P;

    // payment lanes — CASE keeps the raw payment_on_type when unknown, so nothing is mislabeled
    const LANE = `CASE
      WHEN p.payment_on_type ILIKE '%recharge%' THEN 'recharge'
      WHEN p.payment_on_type ILIKE '%bill%' THEN 'bill'
      WHEN p.payment_on_type ILIKE '%renewal%' THEN 'renewal'
      WHEN p.payment_on_type='Checkout' AND c.checkout_type=2 THEN 'change_plan'
      WHEN p.payment_on_type='Checkout' AND c.checkout_type=3 THEN 'sim_replacement'
      WHEN p.payment_on_type='Checkout' AND c.checkout_type=5 THEN 'ownership'
      WHEN p.payment_on_type='Checkout' AND c.checkout_type=6 THEN 'renewal'
      WHEN p.payment_on_type='Checkout' AND c.checkout_type=7 THEN 'advanced_postpaid'
      ELSE lower(p.payment_on_type) END`;
    const JOIN = `FROM payments p LEFT JOIN checkouts c
      ON p.payment_on_type='Checkout' AND p.payment_on_id ~ '^[0-9a-f-]{36}$' AND c.id = p.payment_on_id::uuid`;
    const WHERE = `WHERE p.created_at >= $1 AND p.created_at <= $2 AND p.payment_on_type <> 'OnboardingOrder'`;
    const OK = `count(*) FILTER (WHERE p.status='success')::int`;
    const KO = `count(*) FILTER (WHERE p.status IN ('fail','failed'))::int`;
    const PD = `count(*) FILTER (WHERE p.status NOT IN ('success','fail','failed'))::int`;

    // vouchers cannot be customer-filtered: api_traffic_events stores NO mobile (masked at
    // ingest) — when a customer filter is active the voucher lane is skipped with a note.
    const EMPTY = Promise.resolve({ rows: [] });
    const EMPTY1 = Promise.resolve({ rows: [{ total: 0, ok: 0, business: 0, technical: 0, rate_limited: 0 }] });
    const [payLanes, paySeries, payRows, cpTot, cpSeries, cpRows, vTot, vSeries, vRows] = await Promise.all([
      qT(db.source, `SELECT ${LANE} lane, count(*)::int total, ${OK} ok, ${KO} fail, ${PD} pending
                     ${JOIN} ${WHERE}${KEYP} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, PP),
      qT(db.source, `SELECT date_trunc('${unit}', p.created_at) t, ${LANE} lane, count(*)::int total, ${OK} ok, ${KO} fail
                     ${JOIN} ${WHERE}${KEYP} GROUP BY 1, 2 ORDER BY 1`, PP),
      qT(db.source, `SELECT p.id, p.created_at at, ${LANE} lane, p.customer_mobile_number mobile,
                       p.amount, p.vendor, p.status, p.fail_reason
                     ${JOIN} ${WHERE}${KEYP} ORDER BY p.created_at DESC LIMIT 50`, PP),
      qT(db.source, `SELECT count(*)::int total, count(*) FILTER (WHERE status=1)::int ok,
                       count(*) FILTER (WHERE status=2)::int fail, count(*) FILTER (WHERE status=0)::int pending
                     FROM change_plan_logs WHERE created_at >= $1 AND created_at <= $2${KEYC}`, PP),
      qT(db.source, `SELECT date_trunc('${unit}', created_at) t, count(*)::int total,
                       count(*) FILTER (WHERE status=1)::int ok, count(*) FILTER (WHERE status=2)::int fail
                     FROM change_plan_logs WHERE created_at >= $1 AND created_at <= $2${KEYC} GROUP BY 1 ORDER BY 1`, PP),
      qT(db.source, `SELECT id, created_at at, mobile_number mobile, from_plan, to_plan, status, final_step_message
                     FROM change_plan_logs WHERE created_at >= $1 AND created_at <= $2${KEYC} ORDER BY created_at DESC LIMIT 40`, PP),
      mAny ? EMPTY1 : qT(C, `SELECT count(*)::int total, count(*) FILTER (WHERE err_class='success')::int ok,
               count(*) FILTER (WHERE err_class='business')::int business,
               count(*) FILTER (WHERE err_class='technical')::int technical,
               count(*) FILTER (WHERE response_code='-704')::int rate_limited
             FROM api_traffic_events WHERE path ILIKE '%voucher%' AND ts >= $1 AND ts <= $2`, P),
      mAny ? EMPTY : qT(C, `SELECT date_trunc('${unit}', ts) t, count(*)::int total,
               count(*) FILTER (WHERE err_class='success')::int ok,
               count(*) FILTER (WHERE err_class<>'success')::int fail
             FROM api_traffic_events WHERE path ILIKE '%voucher%' AND ts >= $1 AND ts <= $2 GROUP BY 1 ORDER BY 1`, P),
      mAny ? EMPTY : qT(C, `SELECT ts at, host, path, transaction_id, response_code, response_message, duration_ms, err_class
             FROM api_traffic_events WHERE path ILIKE '%voucher%' AND ts >= $1 AND ts <= $2
             ORDER BY ts DESC LIMIT 40`, P)
    ]);

    const pmap = await plans.loadMap().catch(() => ({}));
    const out = {
      from: P[0], to: P[1], unit,
      filtered: keyInfo ? { ...keyInfo, found: true,
        voucher_note: 'voucher lane hidden — voucher logs carry no customer identifier (PII-masked at capture)' } : null,
      lanes: [
        ...payLanes.rows,
        { lane: 'change_plan_journey', ...cpTot.rows[0] },
        { lane: 'voucher', total: vTot.rows[0].total, ok: vTot.rows[0].ok,
          fail: (vTot.rows[0].business || 0) + (vTot.rows[0].technical || 0), pending: 0,
          business: vTot.rows[0].business, technical: vTot.rows[0].technical, rate_limited: vTot.rows[0].rate_limited,
          source_note: 'API log capture · last 7 days only' }
      ].filter(l => l && l.total),
      series: [
        ...paySeries.rows.map(r => ({ ...r, t: r.t })),
        ...cpSeries.rows.map(r => ({ ...r, lane: 'change_plan_journey' })),
        ...vSeries.rows.map(r => ({ ...r, lane: 'voucher' }))
      ],
      rows: [
        ...payRows.rows.map(r => ({ kind: 'pay', row: 'pay:' + r.id, at: r.at, lane: r.lane, mobile: r.mobile,
          detail: `${r.amount != null ? r.amount + ' SAR · ' : ''}${r.vendor || ''}${r.fail_reason ? ' · ' + String(r.fail_reason).slice(0, 60) : ''}`,
          status: r.status })),
        ...cpRows.rows.map(r => ({ kind: 'cpl', row: 'cpl:' + r.id, at: r.at, lane: 'change_plan_journey', mobile: r.mobile,
          detail: `${plans.label(pmap, r.from_plan)} → ${plans.label(pmap, r.to_plan)}${r.final_step_message ? ' · ' + String(r.final_step_message).slice(0, 50) : ''}`,
          status: r.status === 1 ? 'success' : r.status === 2 ? 'failed' : 'pending' })),
        ...vRows.rows.map(r => ({ kind: 'voucher', txn: r.transaction_id, at: r.at, lane: 'voucher', mobile: null,
          detail: `${r.path}${r.response_message ? ' · ' + String(r.response_message).slice(0, 60) : ''}${r.duration_ms != null ? ' · ' + r.duration_ms + 'ms' : ''}`,
          status: r.err_class === 'success' ? 'success' : (String(r.response_code) === '-704' ? 'rate-limited' : r.err_class) }))
      ].sort((a, b) => new Date(b.at) - new Date(a.at))
    };
    res.json(roles.maskDeep(out, false));   // always masked — drill through Timeline for detail
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===================== MONITORING (connectivity strip + Digital-API traffic) ===================== */
// One call powering the Monitoring page's CONNECTIVITY & HEALTH strip. Every check runs in
// parallel with its own timeout and NEVER throws — a dead dependency yields a red card, not a 500.
// status: 'ok' (green) · 'warn' (amber) · 'fail' (red) · 'off' (grey = not configured).
app.get('/api/monitoring/health', async (req, res) => {
  const timed = (ms, fn) => Promise.race([
    (async () => fn())(),
    new Promise(r => setTimeout(() => r({ __timeout: true }), ms))
  ]).catch(e => ({ __error: e.message }));
  const ping = async (pool) => { const t0 = Date.now(); await pool.query('SELECT 1'); return Date.now() - t0; };

  const [selfC, replica, syncAge, consoleDb, ollama, osb, apigw, sn, traffic] = await Promise.all([
    // 1) Console API self — if this handler runs, the API is up; report uptime + version
    (async () => { let v = null; try { v = require('fs').readFileSync(require('path').join(STATIC_DIR, 'VERSION'), 'utf8').trim(); } catch (e) {}
      return { up: Math.round(process.uptime()), version: v }; })(),
    /* 2) Replica DB (source of every KPI/alert).
     * `timed` is OUR stopwatch, not a database error: pool.query() must first ACQUIRE a client,
     * so when all connections are busy the ping simply queues and the race expires — and the
     * strip used to report that as "Unreachable: timeout", i.e. DOWN, for a replica that was
     * merely working hard. Capture the pool counters alongside so the two can be told apart. */
    timed(6000, async () => ({ ms: await ping(db.source),
      pool: { total: db.source.totalCount, idle: db.source.idleCount, waiting: db.source.waitingCount } })),
    // 3) Prod-sync age (last finished sync run in the console DB)
    timed(4000, async () => {
      const r = (await C.query(`SELECT finished_at, metrics_written FROM sync_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`)).rows[0];
      return r ? { ageMin: Math.max(0, Math.round((Date.now() - new Date(r.finished_at).getTime()) / 60000)), written: r.metrics_written } : { ageMin: null };
    }),
    // 4) Console DB
    timed(4000, async () => ({ ms: await ping(C) })),
    // 5) Ollama / Yusr LLM
    timed(6000, async () => { const cfg = await assist.getConfig(); const p = await assist.ping(); return { enabled: !!cfg.enabled, ...p }; }),
    // 6) OSB MySQL (uil_logs read-path feed)
    timed(5000, async () => { const o = require('./osbLog'); const st = o.status();
      if (!st.configured) return { configured: false };
      const t0 = Date.now(); const p = await o.ping(); return { ...st, ...p, ms: Date.now() - t0 }; }),
    // 7) APIGW nodes (existing TCP probe's cached snapshot)
    timed(5000, async () => require('./apigwProbe').status()),
    // 8) ServiceNow (presence only — a live query here would slow the strip; ping is on Settings)
    (async () => ({ configured: servicenow.snConfigured() }))(),
    // 9) Digital-API traffic source (collector → api_traffic_events PG · fallback grafana MySQL)
    timed(5000, async () => { const at = require('./apiTraffic'); const st = at.status();
      if (!st.configured) return { configured: false };
      const p = await at.ping(); return { ...st, ...p }; })
  ]);

  const checks = [];
  const push = (key, label, status, detail, ms) => checks.push({ key, label, status, detail, ms: ms == null ? null : ms });
  const bad = x => x && (x.__timeout || x.__error);
  const badTxt = x => x.__timeout ? 'timeout' : x.__error;

  push('console_api', 'Console API', 'ok', `up ${Math.floor(selfC.up / 3600)}h ${Math.floor(selfC.up % 3600 / 60)}m` + (selfC.version ? ` · v${selfC.version}` : ''), 0);
  if (bad(replica)) {
    /* Distinguish "no connection to the database" from "every connection is in use". A saturated
     * pool is a capacity signal (DEGRADED — add an index, widen the pool), not an outage; calling
     * it DOWN sends people to check the network for a problem that is in our own query plan. */
    const busy = replica.__timeout && db.source.waitingCount > 0;
    push('replica', 'Replica DB', busy ? 'warn' : 'fail',
      busy ? `Reachable but SATURATED — all ${db.source.totalCount} pooled connections busy, ${db.source.waitingCount} queued. A slow query is starving the pool, not the network.`
           : 'Unreachable: ' + badTxt(replica));
  }
  else {
    const age = (!bad(syncAge) && syncAge.ageMin != null) ? syncAge.ageMin : null;
    const st = age == null ? 'warn' : age > 30 ? 'warn' : 'ok';
    push('replica', 'Replica DB', st, age == null ? 'Reachable · no sync runs yet' : `Reachable · prod-sync ${age}m ago`, replica.ms);
  }
  if (bad(consoleDb)) push('console_db', 'Console DB', 'fail', 'Unreachable: ' + badTxt(consoleDb));
  else push('console_db', 'Console DB', 'ok', 'Reachable', consoleDb.ms);
  if (bad(ollama)) push('ollama', 'Yusr LLM (Ollama)', 'fail', badTxt(ollama));
  else if (!ollama.enabled) push('ollama', 'Yusr LLM (Ollama)', 'off', 'Yusr disabled (Settings → Yusr)');
  else push('ollama', 'Yusr LLM (Ollama)', ollama.ok ? 'ok' : 'fail',
    ollama.ok ? (ollama.model + (ollama.modelAvailable ? ' ready' : ' NOT pulled')) : (ollama.error || 'unreachable'));
  if (bad(osb)) push('osb', 'OSB MySQL (uil_logs)', 'fail', badTxt(osb));
  else if (!osb.configured) push('osb', 'OSB MySQL (uil_logs)', 'off', 'OSB_LOG_URL not set (read-path feed disabled)');
  else push('osb', 'OSB MySQL (uil_logs)', osb.ok ? 'ok' : 'fail', osb.ok ? (osb.target || 'connected') : (osb.error || 'unreachable'), osb.ms);
  if (bad(apigw) || !apigw.summary) push('apigw', 'API GW nodes', 'warn', bad(apigw) ? badTxt(apigw) : 'no probe data yet');
  else {
    const s = apigw.summary;
    push('apigw', 'API GW nodes', s.ok === 0 ? 'fail' : (s.ok < s.total ? 'warn' : 'ok'),
      `${s.ok}/${s.total} targets reachable · ${s.reachable_nodes}/${s.total_nodes} nodes`,
      Math.min(...apigw.targets.filter(t => t.state === 'ok').map(t => t.ms), Infinity) === Infinity ? null : Math.min(...apigw.targets.filter(t => t.state === 'ok').map(t => t.ms)));
  }
  push('servicenow', 'ServiceNow', sn.configured ? 'ok' : 'off', sn.configured ? 'Configured (read-only correlation)' : 'SN_URL / SN_USER / SN_PASS not set');
  if (bad(traffic)) push('api_traffic', 'API traffic', 'fail', badTxt(traffic));
  else if (!traffic.configured) push('api_traffic', 'API traffic', 'off', 'API_LOG_HOSTS (SSH collector) / API_TRAFFIC_URL (MySQL fallback) not set');
  else if (traffic.mode === 'collector') {
    // collector mode: per-host freshness — a host that errored last cycle degrades the card
    const hostsArr = traffic.hosts || [];
    const bads = hostsArr.filter(h => h.lastError);
    const newest = traffic.newestTs ? Math.round((Date.now() - new Date(traffic.newestTs).getTime()) / 60000) : null;
    const stale = newest == null || newest > Math.max(15, (traffic.intervalMin || 1) * 5);
    const st = !traffic.ok || bads.length === hostsArr.length ? 'fail' : (bads.length || stale) ? 'warn' : 'ok';
    const perHost = hostsArr.map(h => `${h.host.split('.').pop()}:${h.lastError ? 'ERR' : (h.lagBytes != null ? (h.lagBytes > 1048576 ? Math.round(h.lagBytes / 1048576) + 'MB behind' : 'live') : '—')}`).join(' · ');
    push('api_traffic', 'API traffic', st,
      `SSH collector · ${perHost || 'no hosts'} · ${traffic.events != null ? traffic.events.toLocaleString() + ' events' : 'no data'}${newest != null ? ` · newest ${newest}m ago` : ''}`
      + (bads.length ? ` · ${bads[0].host}: ${bads[0].lastError}` : ''), traffic.ms);
  } else push('api_traffic', 'API traffic', traffic.ok ? 'ok' : 'fail', 'MySQL fallback · ' + (traffic.ok ? (traffic.target || 'connected') : (traffic.error || 'unreachable')), traffic.ms);

  // Payments funnel (24h final outcomes — same ANS predicate as the deep-dive, so the
  // health card and the Troubleshoot panel can never disagree). Status logic:
  //   fail  = stuck>20 (callback gap piling up = platform-side incident)
  //   warn  = success rate < 40% of answered volume, or stuck>5
  try {
    const ANS = `(payment_commit_response IS NOT NULL AND payment_commit_response::text NOT IN ('{}','null'))`;
    const f = (await db.source.query(
      `SELECT count(*)::int total,
              count(*) FILTER (WHERE status='success')::int ok,
              count(*) FILTER (WHERE status='pending' AND ${ANS})::int stuck,
              count(*) FILTER (WHERE status IN ('fail','failed') AND ${ANS})::int declined
       FROM payments WHERE created_at > now() - interval '24 hours'`)).rows[0];
    const rate = f.total ? Math.round(100 * f.ok / f.total) : null;
    const st = f.stuck > 20 ? 'fail' : (f.stuck > 5 || (rate != null && rate < 40)) ? 'warn' : 'ok';
    push('payments_funnel', 'Payments (24h)', st,
      `${f.ok.toLocaleString()}/${f.total.toLocaleString()} success (${rate == null ? '—' : rate + '%'}) · ${f.declined.toLocaleString()} declined · ${f.stuck} stuck`);
  } catch (e) { push('payments_funnel', 'Payments (24h)', 'fail', e.message); }

  // UPG payment gateway DB (read-only correlation source)
  try {
    const u = await timed(5000, () => require('./upgLink').ping());
    if (!u || u.__timeout) push('upg_db', 'UPG gateway DB', 'fail', 'timeout');
    else if (u.__error) push('upg_db', 'UPG gateway DB', 'fail', u.__error);
    else if (!u.configured) push('upg_db', 'UPG gateway DB', 'off', 'UPG_DATABASE_URL not set — payment correlation disabled');
    else if (!u.ok) push('upg_db', 'UPG gateway DB', 'fail', u.error || 'unreachable', u.ms);
    else push('upg_db', 'UPG gateway DB', 'ok',
      `${(u.payments_24h || 0).toLocaleString()} payments/24h` + (u.newest ? ` · newest ${String(u.newest).replace('T', ' ').slice(11, 16)}Z` : ''), u.ms);
  } catch (e) { push('upg_db', 'UPG gateway DB', 'fail', e.message); }

  // APIGW trace collector (Zipkin distillation → apigw_trace_stats)
  try {
    const zs = require('./zipkinCollector').status();
    if (!zs.configured) push('apigw_traces', 'APIGW traces', 'off', 'ZIPKIN_HOSTS not set — gateway trace capture disabled');
    else {
      const r = (await C.query(`SELECT max(bucket) newest, coalesce(sum(calls),0)::bigint calls
                                FROM apigw_trace_stats WHERE bucket > now() - interval '1 hour'`)).rows[0];
      const ageMin = r.newest ? Math.max(0, Math.round((Date.now() - new Date(r.newest).getTime()) / 60000)) : null;
      const errs = zs.hosts.filter(h => h.lastError);
      const st = (errs.length && errs.length === zs.hosts.length) ? 'fail'
        : (errs.length || ageMin == null || ageMin > 10) ? 'warn' : 'ok';
      push('apigw_traces', 'APIGW traces', st,
        `${zs.hosts.map(h => h.host.split('.').pop() + (h.lastError ? ':ERR' : ':live')).join(' · ')}`
        + ` · ${Number(r.calls).toLocaleString()} spans/1h`
        + (ageMin != null ? ` · newest ${ageMin}m ago` : ' · no data yet')
        + (errs.length ? ` · ${errs[0].host}: ${errs[0].lastError}` : ''));
    }
  } catch (e) { push('apigw_traces', 'APIGW traces', 'fail', e.message); }

  const summary = checks.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
  res.json({ now: new Date().toISOString(), checks, summary });
});

// Digital-API traffic — everything the API HEALTH block renders, in one cached call.
// Collector mode (API_LOG_HOSTS): console-DB api_traffic_events, with an optional per-host
// filter. Fallback: read-only over grafana.transaction_logs (MySQL). Graceful when unconfigured.
app.get('/api/monitoring/traffic', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(168, Number(req.query.hours) || 24));
    const api = (req.query.api || '').slice(0, 300) || null;
    const host = (req.query.host || '').slice(0, 100) || null;
    res.json(await respCache.wrap(req, () => require('./apiTraffic').overview({ hours, api, host })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Latency alerting thresholds — global p95 ms + per-API overrides. The api_latency_p95 metric
// emits p95 ÷ these values, so edits here flow straight into alert firing (rules stay 'gte 1').
/* UPG / payments deep-dive — the INVOICE-LEVEL truth view (per the April-2026 analysis: gateway
 * exports count charge ATTEMPTS; the console reports FINAL outcomes). Funnel per gateway:
 *   success · declined (fail WITH a gateway answer → real decline codes)
 *   abandoned (pending, NO gateway answer → customer never completed; auto-expired at gateway)
 *   stuck (pending WITH an answer → callback/commit gap) · refunded
 * Plus retry-success % (failed/abandoned customers who paid within 24h) and a 14-day trend. */
app.get('/api/payments/deep-dive', async (req, res) => {
  try {
    const hours = Math.min(720, Math.max(1, Number(req.query.window || 24)));
    const vendor = String(req.query.vendor || '').trim();
    // `sim` = window END anchor (ISO) — the same contract every Troubleshoot panel uses, so the
    // deep-dive follows the global RANGE bar (incl. Yesterday / custom ranges) instead of "now".
    const sim = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(String(req.query.sim || '')) ? req.query.sim : null;
    const p = []; let vw = '';
    if (vendor) { p.push(vendor); vw = ` AND vendor=$${p.length}`; }
    const ANS = `(payment_commit_response IS NOT NULL AND payment_commit_response::text NOT IN ('{}','null'))`;
    const END = sim ? `'${sim}'::timestamptz` : 'now()';
    const win = `created_at > ${END} - interval '${hours} hours' AND created_at <= ${END}`;
    const funnel = (await db.source.query(
      `SELECT coalesce(vendor,'—') AS vendor, count(*)::int AS total,
              count(*) FILTER (WHERE status='success')::int AS success,
              count(*) FILTER (WHERE status IN ('fail','failed') AND ${ANS})::int AS declined,
              count(*) FILTER (WHERE status IN ('fail','failed') AND NOT ${ANS})::int AS failed_noanswer,
              count(*) FILTER (WHERE status='pending' AND NOT ${ANS})::int AS abandoned,
              count(*) FILTER (WHERE status='pending' AND ${ANS})::int AS stuck,
              count(*) FILTER (WHERE status='refunded')::int AS refunded
       FROM payments WHERE ${win}${vw} GROUP BY 1 ORDER BY total DESC`, p)).rows;
    const declines = (await db.source.query(
      `SELECT (${analytics.DECLINE_EXPR}) AS reason, count(*)::int AS n
       FROM payments WHERE ${win}${vw} AND status IN ('fail','failed')
       GROUP BY 1 ORDER BY n DESC NULLS LAST LIMIT 10`, p)).rows;
    // retry-success: capped sample so wide windows stay cheap
    const retry = (await db.source.query(
      `WITH f AS (
         SELECT customer_mobile_number m, created_at t FROM payments
         WHERE ${win}${vw} AND (status IN ('fail','failed') OR (status='pending' AND NOT ${ANS}))
           AND customer_mobile_number IS NOT NULL
         ORDER BY created_at DESC LIMIT 4000)
       SELECT count(*)::int AS sampled,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM payments s WHERE s.customer_mobile_number=f.m
                  AND s.status='success' AND s.created_at BETWEEN f.t AND f.t + interval '24 hours'))::int AS recovered
       FROM f`, p)).rows[0];
    const trend = (await db.source.query(
      `SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS total,
              count(*) FILTER (WHERE status='success')::int AS success,
              count(*) FILTER (WHERE status IN ('fail','failed') AND ${ANS})::int AS declined,
              count(*) FILTER (WHERE status='pending' AND NOT ${ANS})::int AS abandoned
       FROM payments WHERE created_at > ${END} - interval '14 days' AND created_at <= ${END}${vw}
       GROUP BY 1 ORDER BY 1`, p)).rows;
    res.json({ hours, sim, vendor: vendor || null, funnel, declines, retry, trend });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Deep-dive drill — the actual cases behind one funnel number. outcome × vendor × period
 * (or one trend day). Every row carries the journey link (payment_on_*) and the UPG join key
 * (payment_reference_id) so the UI can jump case → timeline → gateway. */
app.get('/api/payments/deep-dive/drill', async (req, res) => {
  try {
    const hours = Math.min(720, Math.max(1, Number(req.query.window || 24)));
    const sim = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(String(req.query.sim || '')) ? req.query.sim : null;
    const vendor = String(req.query.vendor || '').trim();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || '')) ? req.query.day : null;
    const ANS = `(payment_commit_response IS NOT NULL AND payment_commit_response::text NOT IN ('{}','null'))`;
    const OUT = {
      success:        `status='success'`,
      declined:       `status IN ('fail','failed') AND ${ANS}`,
      failed_noanswer:`status IN ('fail','failed') AND NOT ${ANS}`,
      abandoned:      `status='pending' AND NOT ${ANS}`,
      stuck:          `status='pending' AND ${ANS}`,
      refunded:       `status='refunded'`
    };
    const cond = OUT[String(req.query.outcome || '')];
    if (!cond) return res.status(400).json({ error: 'outcome must be one of ' + Object.keys(OUT).join('|') });
    const END = sim ? `'${sim}'::timestamptz` : 'now()';
    const p = []; let vw = '';
    if (vendor) { p.push(vendor); vw = ` AND vendor=$${p.length}`; }
    const win = day
      ? `created_at >= '${day}'::date AND created_at < '${day}'::date + interval '1 day'`
      : `created_at > ${END} - interval '${hours} hours' AND created_at <= ${END}`;
    const rows = (await db.source.query(
      `SELECT id::text, created_at, vendor, amount, status, platform, payment_method,
              payment_on_type, payment_on_id, payment_reference_id AS ref,
              customer_mobile_number AS mobile, (${analytics.DECLINE_EXPR}) AS reason
       FROM payments WHERE ${win}${vw} AND (${cond})
       ORDER BY created_at DESC LIMIT 200`, p)).rows;
    const total = (await db.source.query(
      `SELECT count(*)::int n FROM payments WHERE ${win}${vw} AND (${cond})`, p)).rows[0].n;
    res.json({ outcome: req.query.outcome, vendor: vendor || null, day, hours, total, rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* SMS / notifications health — three sources:
 * (a) OTP funnel from the replica (otps: sent vs verified; the app records no SMS gateway
 *     response, so delivery health is inferred from customers completing OTP);
 * (b) which SMS vendor is live (sms_vendors) + when it last changed;
 * (c) Unifonic reachability probe results (sms_probe_events ← curl from the API hosts). */
/* SMS per customer — every OTP message the platform recorded for a number or national ID, with
 * the template text where the message type is still knowable. See smsTrace.js for what the
 * platform does and does not keep (short version: no SMS body is ever stored). */
app.get('/api/sms/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q required (msisdn or national id)' });
    const out = await require('./smsTrace').search(q, { limit: Number(req.query.limit) || 60 });
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    if (allowUnmask) await audit(req, 'pii.unmask', 'sms-search ' + q.slice(0, 24), {});
    audit(req, 'SMS_SEARCH', q.slice(0, 24));
    res.json(roles.maskDeep(out, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* The recipients behind a KPI tile — "8,904 sent" → who. */
app.get('/api/sms/recipients', async (req, res) => {
  try {
    res.json(roles.maskDeep(await require('./smsTrace')
      .recipients(String(req.query.bucket || 'sent'), { hours: req.query.hours, limit: req.query.limit }), false));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/monitoring/sms-health', async (req, res) => {
  try {
    const hours = Math.min(720, Math.max(1, Number(req.query.window || 24)));
    const win = `created_at > now() - interval '${hours} hours'`;
    const otp = (await db.source.query(
      `SELECT count(*)::int AS sent,
              count(*) FILTER (WHERE verified)::int AS verified,
              count(DISTINCT otp_for)::int AS unique_targets,
              round(avg(EXTRACT(EPOCH FROM (updated_at - created_at))) FILTER (WHERE verified))::int AS avg_verify_secs
       FROM otps WHERE ${win} AND delivery_method='sms'`)).rows[0];
    const storms = (await db.source.query(
      `SELECT count(*)::int AS storm_targets FROM (
         SELECT otp_for FROM otps WHERE ${win} AND delivery_method='sms'
         GROUP BY otp_for HAVING count(*) >= 3) x`)).rows[0];
    const hourly = (await db.source.query(
      `SELECT date_trunc('hour', created_at) AS h, count(*)::int AS sent,
              count(*) FILTER (WHERE verified)::int AS verified
       FROM otps WHERE ${win} AND delivery_method='sms' GROUP BY 1 ORDER BY 1`)).rows;
    const daily = (await db.source.query(
      `SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS sent,
              count(*) FILTER (WHERE verified)::int AS verified
       FROM otps WHERE created_at > now() - interval '14 days' AND delivery_method='sms'
       GROUP BY 1 ORDER BY 1`)).rows;
    let vendors = [];
    try { vendors = (await db.source.query(
      `SELECT klass_name, enabled, position, updated_at FROM sms_vendors ORDER BY enabled DESC, position NULLS LAST`)).rows; } catch (e) {}
    let probe = { rows: [], summary: null };
    try {
      probe.rows = (await db.console.query(
        `SELECT host, http_code, ms, error, ts FROM sms_probe_events
         WHERE ts > now() - interval '24 hours' ORDER BY ts DESC LIMIT 6`)).rows;
      probe.summary = (await db.console.query(
        `SELECT count(*)::int AS checks,
                count(*) FILTER (WHERE http_code IS NOT NULL)::int AS reachable,
                round(avg(ms) FILTER (WHERE ms IS NOT NULL))::int AS avg_ms
         FROM sms_probe_events WHERE ts > now() - interval '24 hours'`)).rows[0];
    } catch (e) {}
    const probeStatus = require('./smsProbe').status();
    res.json({ hours, otp: { ...otp, ...storms }, hourly, daily, vendors, probe, probeStatus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* App-error drill — recent occurrences of one error code, for the panel's click-through
 * (each row carries trace_id → Case analyzer → full request context). */
/* WHO WAS BLOCKED — search the IP rate-limiter by CUSTOMER (msisdn / national id) or by IP.
 *
 * The app error log (api_error_events) records ip_address but NO customer identifier, and the
 * limiter itself is keyed per IP + action in Redis. So a customer search has to go the long way
 * round: resolve the customer in the app database, collect the IPs we can prove they used, then
 * ask the error log and Redis about each of those IPs. Everything is reported with its source,
 * and when an IP cannot be resolved we say so rather than implying the customer is clean. */
/* LOGIN FUNNEL — password → OTP verify → balance, platform-wide, from the API log.
 * This is the only place the OTP drop-off is measurable: the app writes sign-in tracking at the
 * password step and writes NOTHING when the OTP is verified, so the gap between the two paths is
 * the abandonment. See server/src/loginTrace.js for the full flow, read from the app source. */
app.get('/api/login/funnel', requireView('monitoring'), async (req, res) => {
  try { res.json(await require('./loginTrace').funnel({ hours: req.query.hours })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* Per-customer: when did this subscriber last authenticate, on what device and IP, and what can
 * honestly be concluded about their session. Returns a reasoned verdict, never a bare boolean. */
app.get('/api/login/state', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q required (msisdn or national id)' });
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    if (allowUnmask) await audit(req, 'pii.unmask', 'login-state ' + q.slice(0, 24), {});
    res.json(roles.maskDeep(await require('./loginTrace').state(q), allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Pull THIS customer's user row straight from the source, bypassing the 30-minute scheduler.
 * Exists because the first question after any login test is "why don't I see it yet?" — and the
 * honest answer was always "wait for the sync". Now you don't have to. */
app.post('/api/login/refresh', async (req, res) => {
  try {
    const q = String((req.body && req.body.q) || req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q required (msisdn or national id)' });
    const digits = q.replace(/\D/g, ''), l9 = digits.slice(-9);
    const prodSync = require('./prodSync');
    let out;
    if (/^5\d{8}$/.test(l9)) out = await prodSync.refreshWhere('users', 'mobile_number',
      ['0' + l9, '966' + l9, '+966' + l9, l9, '00966' + l9]);
    else if (/^[12]\d{9}$/.test(digits)) out = await prodSync.refreshWhere('users', 'nationality_id_number', [digits]);
    else return res.status(400).json({ error: 'not a mobile number or national id' });
    audit(req, 'LOGIN_REFRESH', q.slice(0, 24));
    res.json({ ok: true, ...out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitoring/ip-search', async (req, res) => {
  try {
    const raw = String(req.query.q || '').trim();
    if (!raw) return res.status(400).json({ error: 'q required (msisdn, national id or IP)' });
    const hours = Math.min(720, Math.max(1, Number(req.query.hours) || 168));
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(raw) || /^[0-9a-f:]+$/i.test(raw) && raw.includes(':');
    const out = { query: raw, hours, kind: isIp ? 'ip' : 'customer', ips: [], customer: null, notes: [] };

    let ips = [];
    if (isIp) ips = [{ ip: raw, source: 'searched directly' }];
    else {
      // resolve the customer → the IPs the app recorded for them
      const digits = raw.replace(/\D/g, '');
      // accept 05…, 5…, 9665…, +9665…, 009665… — match on the last 9 significant digits, the
      // same rule the subscriber lookup uses (mobiles are stored inconsistently across tables)
      const mAny = [];
      const l9 = digits.slice(-9);
      if (/^5\d{8}$/.test(l9)) mAny.push('0' + l9, '966' + l9, '+966' + l9, l9, '00966' + l9);
      // Devise's trackable columns are not guaranteed on every deployment — ask the catalogue
      // rather than assuming, so a missing column degrades to "no IP on file" instead of a 500.
      const have = new Set((await db.source.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = ANY($1::text[])`,
        [['current_sign_in_ip', 'last_sign_in_ip', 'current_sign_in_at', 'last_sign_in_at',
          'sign_in_count', 'platform', 'nationality_id_number', 'mobile_number']])).rows.map(r => r.column_name));
      const col = c => have.has(c) ? c : `NULL::text AS ${c}`;
      const colT = c => have.has(c) ? c : `NULL::timestamptz AS ${c}`;
      const colN = c => have.has(c) ? c : `NULL::int AS ${c}`;
      const SEL = `SELECT id::text, ${col('mobile_number')}, ${col('current_sign_in_ip')}, ${col('last_sign_in_ip')},
                          ${colT('current_sign_in_at')}, ${colT('last_sign_in_at')}, ${colN('sign_in_count')}, ${col('platform')}
                     FROM users`;
      /* A national ID commonly holds SEVERAL lines (family accounts) — taking the first row would
       * report an arbitrary one and hide the account that actually matters. Collect them all. */
      let rows = [];
      if (mAny.length && have.has('mobile_number')) {
        rows = (await db.source.query(
          `${SEL} WHERE mobile_number = ANY($1::text[]) ORDER BY sign_in_count DESC NULLS LAST LIMIT 10`, [mAny])).rows;
      }
      if (!rows.length && /^[12]\d{9}$/.test(digits) && have.has('nationality_id_number')) {
        rows = (await db.source.query(
          `${SEL} WHERE nationality_id_number = $1 ORDER BY sign_in_count DESC NULLS LAST LIMIT 10`, [digits])).rows;
      }
      let u = rows[0] || null;
      if (!u && /^[12]\d{9}$/.test(digits)) {
        // no NID on users → resolve the ID to a mobile through the identity checks, then retry.
        // Guarded: nafath_logs has no `msisdn` column on this replica (proven by the journey-errors
        // popup 500 on 25 Aug) — a missing column must degrade to "no fallback", not break lookup.
        const nf = (await db.source.query(
          `SELECT msisdn FROM nafath_logs WHERE nationality_id_number = $1 AND msisdn IS NOT NULL
            ORDER BY created_at DESC LIMIT 1`, [digits]).catch(() => ({ rows: [] }))).rows[0];
        if (nf && nf.msisdn && have.has('mobile_number')) {
          const l9 = String(nf.msisdn).replace(/\D/g, '').slice(-9);
          rows = (await db.source.query(`${SEL} WHERE mobile_number = ANY($1::text[]) ORDER BY sign_in_count DESC NULLS LAST LIMIT 10`,
            [['0' + l9, '966' + l9, '+966' + l9, l9]])).rows;
          u = rows[0] || null;
          if (u) out.notes.push('Resolved the national ID to a mobile number through the Nafath identity log.');
        }
      }
      if (!u) { out.notes.push('No app account found for that number / ID.'); return res.json(roles.maskDeep(out, false)); }
      // Say WHICH column the date came from and how stale it is — current_sign_in_at is empty on
      // this replica, so a silent fallback to last_sign_in_at looks like a fresh login but is not.
      const loginAt = u.current_sign_in_at || u.last_sign_in_at || null;
      const loginSrc = u.current_sign_in_at ? 'current_sign_in_at'
        : (u.last_sign_in_at ? 'last_sign_in_at (fallback — current_sign_in_at is empty)' : null);
      out.customer = { mobile: u.mobile_number, platform: u.platform, sign_in_count: u.sign_in_count,
        last_login_at: loginAt, last_login_source: loginSrc,
        last_login_age_days: loginAt ? Math.round((Date.now() - new Date(loginAt).getTime()) / 86400000) : null };
      // one row per line under this identity, most-used first
      out.lines = rows.map(r => ({
        mobile: r.mobile_number, sign_in_count: r.sign_in_count, platform: r.platform,
        last_sign_in: r.current_sign_in_at || r.last_sign_in_at,
        ips: [r.current_sign_in_ip, r.last_sign_in_ip].filter(Boolean)
      }));
      if (out.lines.length > 1) out.notes.push(
        `${out.lines.length} lines are registered under this identity — the IPs below are collected from all of them.`);
      const seen = new Set();
      for (const r of rows)
        for (const [ip, src] of [[r.current_sign_in_ip, 'last sign-in IP'], [r.last_sign_in_ip, 'previous sign-in IP']])
          if (ip && !seen.has(ip)) { seen.add(ip); ips.push({ ip, source: `${src} · ${r.mobile_number}` }); }
      // An RFC1918 / loopback address is the proxy or load balancer, not the customer. Blocked IPs
      // in the error log are public, so such an address can never match one — saying "never
      // blocked" for it would be false comfort.
      const isPrivate = ip => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(ip || ''));
      ips.forEach(x => { if (isPrivate(x.ip)) { x.private = true;
        x.note = 'internal / proxy address (RFC1918) — the app recorded the load balancer, not the customer’s public IP, so it cannot be matched against blocked IPs'; } });
      if (ips.length && ips.every(x => x.private)) out.notes.push(
        'Every IP on file for this customer is an internal address, so the limiter cannot be checked for them. ' +
        'Ask the customer for the IP shown in the app error dialog, or search by IP.');
      if (loginAt && out.customer.last_login_age_days > 30) out.notes.push(
        `The stored sign-in timestamp is ${out.customer.last_login_age_days} days old (${loginSrc}). Check the sync status below before ` +
        'reading anything into that: the app writes this column on every accepted password, so an old value usually means the replica ' +
        'is not receiving the users table — not that the customer stopped logging in.');
      if (!ips.length) out.notes.push(
        'The app has no sign-in IP on file for this customer (Devise trackable is not populated on the replica), ' +
        'so their IPs cannot be resolved. Search by IP directly, or ask the customer for the IP shown in the app error dialog.');
    }

    /* IS THIS CUSTOMER LOGGED IN RIGHT NOW?
     * No — not as a question the platform can answer. Verified against the app source rather
     * than assumed (this block previously carried two wrong statements, both corrected here):
     *   • api_guard is configured `token_validity = 1.year` (config/initializers/api_guard.rb),
     *     NOT 7 days. There is no session table and nothing is written on logout, so a token,
     *     once issued, is simply valid for a year. "Logged in now" is not stored anywhere.
     *   • Sign-in tracking is NOT broken. Trackable#update_tracked_fields! runs on every
     *     accepted password (AuthenticationController#create). If the timestamps look frozen it
     *     is because `users` was missing from the replica sync — a console-side gap, not an
     *     app-side one.
     * What IS provable is the last authentication (users) plus activity that could only happen
     * with a live token (payments). We report that, with its age — never a bare yes/no. */
    if (out.customer && out.lines && out.lines.length) {
      try {
        const nums = [];
        for (const l of out.lines) {
          const d9 = String(l.mobile || '').replace(/\D/g, '').slice(-9);
          if (d9) nums.push('0' + d9, '966' + d9, '+966' + d9, d9);
        }
        const ev = [];
        const otp = (await db.source.query(
          `SELECT created_at, updated_at, otp_for, otp_type, verified FROM otps
            WHERE otp_for = ANY($1::text[]) ORDER BY created_at DESC LIMIT 1`, [nums])).rows[0];
        /* NOTE: this is NOT the login OTP. User#has_one_time_password makes the login code a
         * TOTP derived from otp_secret_key — never persisted. Rows here come from registration,
         * change-plan and other stored-OTP flows, so their absence proves nothing about a login. */
        if (otp) ev.push({ kind: 'otp', at: otp.verified ? (otp.updated_at || otp.created_at) : otp.created_at,
          detail: `OTP ${otp.otp_type || ''} ${otp.verified ? 'verified' : 'sent, not verified'} (stored-OTP flow, not the login OTP)`.trim(), number: otp.otp_for });
        const pay = (await db.source.query(
          `SELECT created_at, status, payment_on_type, customer_mobile_number FROM payments
            WHERE customer_mobile_number = ANY($1::text[]) ORDER BY created_at DESC LIMIT 1`, [nums])).rows[0];
        if (pay) ev.push({ kind: 'payment', at: pay.created_at,
          detail: `${pay.payment_on_type || 'payment'} · ${pay.status}`, number: pay.customer_mobile_number });
        ev.sort((a, b) => new Date(b.at) - new Date(a.at));
        const newest = ev[0] || null;
        const ageMin = newest ? Math.round((Date.now() - new Date(newest.at).getTime()) / 60000) : null;
        out.session = {
          evidence: ev,
          last_activity_at: newest ? newest.at : null,
          age_minutes: ageMin,
          verdict: !newest ? 'unknown — no authenticated activity found for this customer'
            : ageMin <= 60 ? 'active now — authenticated activity in the last hour'
            : ageMin <= 30 * 24 * 60 ? 'token almost certainly still valid — access tokens live one year and there is activity inside the last 30 days'
            : 'no recent activity — but the token may still be valid: api_guard issues tokens with a ONE-YEAR validity and nothing is written on logout',
          basis: 'inferred from OTP and payment activity. The app keeps no server-side session (token_validity = 1.year), so no source of truth for "logged in now" exists anywhere.'
        };
      } catch (e) { out.sessionError = e.message; }
    }

    // Is sign-in tracking still being written? Frozen timestamps look like "this customer has not
    // logged in for months" when the truth is the platform stopped recording. Cached 10 minutes.
    /* HOW FRESH IS THIS? The console reads a replica. Tables in the incremental sync are minutes
     * old; anything NOT in that list is frozen at the last full copy. `users` is not synced, so
     * every users-derived value here (sign-in time, sign-in count, sign-in IP) is a snapshot —
     * NOT evidence that the customer stopped logging in. Say which, so nobody concludes
     * "trackable is broken" from what is really replica staleness. */
    try {
      if (!app.__freshCache || Date.now() - app.__freshCache.at > 600000) {
        const synced = (require('./prodSync').DEFAULT_TABLES || []).includes('users');
        const u = (await db.source.query(`SELECT max(current_sign_in_at) newest FROM users`)).rows[0];
        let otpNewest = null;
        try { otpNewest = (await db.source.query(`SELECT max(created_at) newest FROM otps`)).rows[0].newest; } catch (_) { }
        app.__freshCache = { at: Date.now(), synced, users: u.newest, otps: otpNewest };
      }
      const F = app.__freshCache;
      const days = F.users ? Math.round((Date.now() - new Date(F.users).getTime()) / 86400000) : null;
      out.tracking = { users_table_synced: F.synced, users_snapshot_newest: F.users, users_snapshot_age_days: days,
        otps_newest: F.otps, otps_age_minutes: F.otps ? Math.round((Date.now() - new Date(F.otps).getTime()) / 60000) : null };
      if (!F.synced) out.notes.push(
        `The users table is NOT part of the incremental replica sync — this snapshot ends ${String(F.users).slice(0, 10)}` +
        `${days ? ` (${days} days ago)` : ''}. Sign-in time, sign-in count and sign-in IP are therefore historical and will ` +
        'not change when the customer logs in. Live activity below comes from tables that ARE synced (otps, payments).');
      if (F.otps && out.tracking.otps_age_minutes > 30) out.notes.push(
        `The OTP feed itself is ${out.tracking.otps_age_minutes} minutes behind — a login in the last few minutes may not be visible yet.`);
    } catch (_) { }

    // for every candidate IP: what the error log saw, and whether the limiter holds it NOW
    const iprl = require('./ipUnblock');
    for (const entry of ips) {
      const ip = entry.ip;
      const agg = (await db.console.query(
        `SELECT count(*)::int errors,
                count(*) FILTER (WHERE error_code = -704)::int blocks,
                max(ts) FILTER (WHERE error_code = -704) last_block,
                min(ts) FILTER (WHERE error_code = -704) first_block,
                max(retry_count) FILTER (WHERE error_code = -704) max_retries,
                min(retry_count) FILTER (WHERE error_code = -704) min_retries
           FROM api_error_events
          WHERE ip_address = $1 AND ts >= now() - ($2 || ' hours')::interval`, [ip, hours])).rows[0];
      const byAction = (await db.console.query(
        `SELECT coalesce(action_name, action, '—') act, count(*)::int n, max(ts) last_seen
           FROM api_error_events
          WHERE ip_address = $1 AND error_code = -704 AND ts >= now() - ($2 || ' hours')::interval
          GROUP BY 1 ORDER BY n DESC LIMIT 8`, [ip, hours])).rows;
      const recent = (await db.console.query(
        `SELECT ts, error_code, coalesce(action_name, action, '—') act, retry_count, platform, message
           FROM api_error_events
          WHERE ip_address = $1 AND ts >= now() - ($2 || ' hours')::interval
          ORDER BY ts DESC LIMIT 20`, [ip, hours])).rows;
      let live = null;
      try { live = await iprl.status(ip); } catch (e) { live = { error: e.message }; }
      out.ips.push({ ...entry,
        errors: Number(agg.errors || 0), blocks: Number(agg.blocks || 0),
        first_block: agg.first_block, last_block: agg.last_block,
        retries: agg.min_retries == null ? null : `${agg.min_retries}–${agg.max_retries}`,
        blocked_now: live && Array.isArray(live.keys) ? live.keys.length > 0 : (live && live.blocked) || false,
        live, by_action: byAction, recent });
    }
    out.ips.sort((a, b) => b.blocks - a.blocks);
    res.json(roles.maskDeep(out, !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitoring/app-errors/drill', async (req, res) => {
  try {
    const code = Number(req.query.code);
    if (!Number.isFinite(code)) return res.status(400).json({ error: 'code required' });
    const hours = Math.min(720, Math.max(1, Number(req.query.hours || 24)));
    const cat = require('./appErrCatalog');
    const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
    const from = ISO.test(String(req.query.from || '')) ? String(req.query.from).replace(' ', 'T') : null;
    const to = ISO.test(String(req.query.to || '')) ? String(req.query.to).replace(' ', 'T') : null;
    const wpred = (from && to) ? `ts >= '${from}' AND ts < '${to}'` : `ts > now() - interval '${hours} hours'`;
    const entries = (await db.console.query(
      `SELECT ts, host, controller, action, platform, app_version, ip_address, trace_id, request_id,
              exception_class, frame, message
       FROM api_error_events WHERE error_code=$1 AND ${wpred}
       ORDER BY ts DESC LIMIT 30`, [code])).rows;
    const hourly = (await db.console.query(
      `SELECT date_trunc('hour', ts) AS h, count(*)::int AS n
       FROM api_error_events WHERE error_code=$1 AND ts > now() - interval '48 hours'
       GROUP BY 1 ORDER BY 1`, [code])).rows;
    res.json({ code, hours, describe: cat.describe(code), entries, hourly });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* IP rate-limiter unblock — releases an IP from the app's IpRetrial Redis counters.
 * super_admin only, fully audited. GET = status (safe, any monitoring viewer), POST = delete. */
app.get('/api/monitoring/ip-block', async (req, res) => {
  try { res.json(await require('./ipUnblock').status(String(req.query.ip || '').trim())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/monitoring/ip-unblock', async (req, res) => {
  try {
    if (!IS_SUPER(req.realRole, req.realRoles)) return res.status(403).json({ error: 'super_admin only' });
    const ip = String((req.body || {}).ip || '').trim();
    const out = await require('./ipUnblock').unblock(ip);
    if (!out.error && out.configured) await audit(req, 'IP_UNBLOCK', ip, `deleted ${out.deleted} limiter key(s): ${(out.keys || []).join(', ')}`);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* UPG gateway correlation — end-to-end payment view.
 * key = invoice id / payment_reference_id (app side), a UPG pay_… id, or an invoice reference. */
app.get('/api/upg/trace', async (req, res) => {
  try { res.json(await require('./upgLink').trace(req.query.key)); }
  catch (e) { res.status(500).json({ error: e.message, upg: !!e.upg }); }
});
app.get('/api/upg/health', async (req, res) => {
  try { res.json(await require('./upgLink').ping()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* Case analyzer — trace id / request id ("Device ID" in the app's error dialog) → diagnosis.
 * Backs the Troubleshoot "Case analyzer" box and Yusr's automatic trace detection. */
app.get('/api/trace/:id', async (req, res) => {
  try { res.json(await require('./traceCase').analyze(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* App error-log KPIs (api_error_events ← api_error_logger.production.log on 17/18).
 * General error-code mix + the IpRetrial rate-limiter (-704) drill-down: blocks, unique IPs,
 * low-retry blocks (the gap-block flaw signature: blocked with only 1-3 prior attempts),
 * per-action split and top blocked IPs. */
app.get('/api/monitoring/app-errors', async (req, res) => {
  try {
    const hours = Math.min(720, Math.max(1, Number(req.query.hours || 24)));
    const C = db.console;
    // optional custom range (strict ISO-ish → safe to inline; ts is indexed so this stays an
    // index scan). Span capped at 92 days; charts drop to daily buckets past 4 days.
    const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
    let from = ISO.test(String(req.query.from || '')) ? String(req.query.from).replace(' ', 'T') : null;
    let to = ISO.test(String(req.query.to || '')) ? String(req.query.to).replace(' ', 'T') : null;
    let spanH = null;
    if (from && to) {
      spanH = (new Date(to) - new Date(from)) / 3600e3;
      if (!(spanH > 0)) { from = to = null; }
      else if (spanH > 92 * 24) { from = new Date(new Date(to) - 92 * 24 * 3600e3).toISOString(); spanH = 92 * 24; }
    } else { from = to = null; }
    const win = from ? `ts >= '${from}' AND ts < '${to}'` : `ts > now() - interval '${hours} hours'`;
    const chartWin = from ? win : `ts > now() - interval '48 hours'`;
    const gran = (from && spanH > 96) ? 'day' : 'hour';
    const cat = require('./appErrCatalog');
    const catFilter = String(req.query.cat || '').trim();   // optional category drill-down
    const totals = (await C.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE level='error')::int AS errors,
              count(*) FILTER (WHERE level='warn')::int AS warns,
              min(ts) AS oldest, max(ts) AS newest
       FROM api_error_events WHERE ${win}`)).rows[0];
    // per-code with exception split → categorize in JS via the source-derived catalog
    const codeRaw = (await C.query(
      `SELECT error_code, (exception_class IS NOT NULL) AS has_exc, count(*)::int AS n, max(message) AS sample
       FROM api_error_events WHERE ${win} GROUP BY 1,2 ORDER BY n DESC LIMIT 200`)).rows;
    const catAgg = {};
    for (const r of codeRaw) {
      const k = cat.classify(r.error_code, r.has_exc ? 'x' : null);
      catAgg[k] = (catAgg[k] || 0) + r.n;
    }
    const byCategory = Object.entries(catAgg)
      .map(([k, n]) => ({ key: k, n, ...(cat.CATEGORIES[k] || cat.CATEGORIES.other) }))
      .sort((a, b) => b.n - a.n);
    let byCode = [];
    { const seen = {};
      for (const r of codeRaw) {
        const k = cat.classify(r.error_code, r.has_exc ? 'x' : null);
        if (catFilter && k !== catFilter) continue;
        const key = String(r.error_code);
        if (!seen[key]) { const d = cat.describe(r.error_code);
          seen[key] = { error_code: r.error_code, n: 0, sample: r.sample,
            constant: d ? d.constant : null, category: k, cat_label: (cat.CATEGORIES[k] || {}).label || k,
            cat_color: (cat.CATEGORIES[k] || {}).color || '#94a3b8', meaning: d ? d.message : null }; }
        seen[key].n += r.n; if (!seen[key].sample) seen[key].sample = r.sample;
      }
      byCode = Object.values(seen).sort((a, b) => b.n - a.n).slice(0, 15);
    }
    const rl = (await C.query(
      `SELECT count(*)::int AS blocks,
              count(DISTINCT ip_address)::int AS unique_ips,
              count(*) FILTER (WHERE retry_count IS NOT NULL AND retry_count <= 3)::int AS low_retry_blocks
       FROM api_error_events WHERE ${win} AND rate_limit='ip_retrial'`)).rows[0];
    const rlByAction = (await C.query(
      `SELECT coalesce(action_name, action, '—') AS action, count(*)::int AS n
       FROM api_error_events WHERE ${win} AND rate_limit='ip_retrial' GROUP BY 1 ORDER BY n DESC LIMIT 8`)).rows;
    const rlTopIps = (await C.query(
      `SELECT ip_address, count(*)::int AS blocks, min(retry_count)::int AS min_retry,
              max(retry_count)::int AS max_retry, max(ts) AS last_at
       FROM api_error_events WHERE ${win} AND rate_limit='ip_retrial' AND ip_address IS NOT NULL
       GROUP BY 1 ORDER BY blocks DESC LIMIT 10`)).rows;
    const rlHourly = (await C.query(
      `SELECT date_trunc('${gran}', ts) AS h, count(*)::int AS blocks,
              count(DISTINCT ip_address)::int AS ips
       FROM api_error_events WHERE ${chartWin} AND rate_limit='ip_retrial'
       GROUP BY 1 ORDER BY 1`)).rows;
    // live limiter settings from the replica (what the flawed gap-logic currently runs with)
    let rlSettings = [];
    try { rlSettings = (await db.source.query(
      `SELECT var, value FROM settings WHERE var IN ('ip_elapse_time','ip_request_rate_limit','ip_session_time')`)).rows; } catch (e) {}
    const series = (await C.query(
      `SELECT date_trunc('hour', ts) AS h,
              count(*)::int AS total,
              count(*) FILTER (WHERE rate_limit='ip_retrial')::int AS rl_blocks
       FROM api_error_events WHERE ${win} GROUP BY 1 ORDER BY 1`)).rows;
    // historical daily series (independent of the hours window) — default since Aug 2026,
    // i.e. as far back as the backfilled log actually reaches
    const histFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.histFrom || '')) ? req.query.histFrom : '2026-08-01';
    const daily = (await C.query(
      `SELECT date_trunc('day', ts)::date AS day,
              count(*)::int AS total,
              count(*) FILTER (WHERE rate_limit='ip_retrial')::int AS rl_blocks,
              count(DISTINCT ip_address) FILTER (WHERE rate_limit='ip_retrial')::int AS rl_ips
       FROM api_error_events WHERE ts >= $1::date GROUP BY 1 ORDER BY 1`, [histFrom])).rows;
    const histTotals = (await C.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE rate_limit='ip_retrial')::int AS rl_blocks,
              count(DISTINCT ip_address) FILTER (WHERE rate_limit='ip_retrial')::int AS rl_ips,
              min(ts) AS oldest
       FROM api_error_events WHERE ts >= $1::date`, [histFrom])).rows[0];
    // stacked-by-category series — 48h hourly by default; the custom range (hour/day buckets) when set
    const hcRaw = (await C.query(
      `SELECT date_trunc('${gran}', ts) AS h, error_code, (exception_class IS NOT NULL) AS has_exc, count(*)::int AS n
       FROM api_error_events WHERE ${chartWin} GROUP BY 1,2,3`)).rows;
    const hourlyByCat = {};
    for (const r of hcRaw) {
      const k = cat.classify(r.error_code, r.has_exc ? 'x' : null);
      const hh = String(r.h instanceof Date ? r.h.toISOString() : r.h);
      (hourlyByCat[hh] = hourlyByCat[hh] || {})[k] = ((hourlyByCat[hh] || {})[k] || 0) + r.n;
    }
    const col = require('./apiErrLogCollector').status();
    res.json({ hours, range: from ? { from, to, gran } : null,
      totals, byCode, byCategory, hourlyByCat, categories: cat.CATEGORIES, catFilter: catFilter || null,
      rateLimit: { ...rl, byAction: rlByAction, topIps: rlTopIps, hourly: rlHourly, settings: rlSettings,
        explain: 'IpRetrial (recharge voucher/validate only): per-IP counter in Redis. Known flaw — an idle gap > ip_session_time BLOCKS (instead of resetting) until the key expires after ip_elapse_time. Low-retry blocks = one-attempt victims, typically shared CGNAT IPs.' },
      series, history: { from: histFrom, daily, totals: histTotals }, collector: col });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/monitoring/latency-thresholds', async (req, res) => {
  try { res.json(await require('./apiTraffic').latencyThresholds()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/monitoring/latency-thresholds', requireCap('manageSync'), async (req, res) => {
  try {
    const b = req.body || {};
    const globalMs = Number(b.globalMs);
    if (!(globalMs > 0) || globalMs > 600000) return res.status(400).json({ error: 'globalMs must be a positive number of milliseconds (≤ 600000).' });
    const perApi = {};
    for (const [k, v] of Object.entries(b.perApi || {})) {
      const key = String(k).slice(0, 300); const ms = Number(v);
      if (key && ms > 0 && ms <= 600000) perApi[key] = ms;
    }
    const value = { globalMs, perApi };
    await settings.setSetting('api_latency_thresholds', value);
    await audit(req, 'monitoring.latency_thresholds', null, { globalMs, overrides: Object.keys(perApi).length });
    res.json(value);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* Customer payments 360 — EVERY transaction for one MSISDN, end to end. App-side rows here;
 * each row carries payment_reference_id, which the UI's ⇄ UPG button resolves into the gateway
 * side (charges, state log, webhooks) via /api/upg/trace. Time-bounded (no msisdn index on
 * payments — replica seq scan is fine windowed, unbounded is not). PII-masked per role; every
 * lookup is audited because it is a deliberate customer-data access. */
app.get('/api/customer/payments', async (req, res) => {
  try {
    const q = String(req.query.q || req.query.msisdn || '').replace(/[^0-9+]/g, '');
    if (q.length < 8) return res.status(400).json({ error: 'enter a full MSISDN, customer ID or service number' });
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    // What was pasted? Saudi national ID / iqama = 10 digits starting 1 or 2 → match via the
    // customer's orders. Anything phone-shaped matches customer OR service (target) number by
    // last-9-digits, so it works with or without country code either way.
    const isNid = /^[12]\d{9}$/.test(q);
    /* Match on the KNOWN stored formats rather than LIKE '%…' — a leading wildcard can never use
     * an index (measured: 5.4s seq scan on 1.8M rows even WITH idx_pay_cust_mobile). Equality
     * against the four ways a Saudi MSISDN is stored is index-friendly and returns in ms. */
    const l9 = q.slice(-9);
    const variants = ['0' + l9, '966' + l9, l9, '+966' + l9];
    const conds = [`(customer_mobile_number = ANY($2::text[]) OR target_mobile_number = ANY($2::text[]))`];
    if (isNid) conds.push(
      `payment_on_id::text IN (SELECT id::text FROM onboarding_orders WHERE nationality_id_number = $3)`);
    const params = isNid ? [days, variants, q] : [days, variants];
    const r = await db.source.query(
      `SELECT id::text, created_at, amount, vendor, platform, status, card_type,
              payment_on_type, payment_on_id::text AS on_id, payment_reference_id AS ref,
              customer_mobile_number AS mobile, fail_reason,
              CASE WHEN status IN ('fail','failed') THEN (${analytics.DECLINE_EXPR}) END AS decline
       FROM payments
       WHERE created_at > now() - ($1||' days')::interval
         AND (${conds.join(' OR ')})
       ORDER BY created_at DESC LIMIT 100`, params);
    const sum = r.rows.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});
    await audit(req, 'CUSTOMER_PAYMENTS_LOOKUP', q.slice(0, 5) + '****' + q.slice(-2),
      `${isNid ? 'national-id' : 'msisdn/service'} · ${r.rows.length} row(s) · ${days}d window`);
    const allowUnmask = !!(req.caps && req.caps.unmaskPII);
    res.json({ msisdn: allowUnmask ? q : q.slice(0, 5) + '****' + q.slice(-2), matched_by: isNid ? 'customer ID' : 'mobile / service number',
      days, total: r.rows.length, summary: sum,
      rows: roles.maskDeep(r.rows, allowUnmask), unmasked: allowUnmask,
      upg_available: db.upgConfigured });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Declined-payment drill-down: the actual failed payment rows behind a decline-reason slice,
// within the chart's window, with the gateway response so L1 can see what the vendor returned.
app.get('/api/payments/declined', async (req, res) => {
  try {
    const { reason, from, to, vendor } = req.query;
    const params = []; const wh = [`status IN ('fail','failed')`];
    if (from) { params.push(from); wh.push(`created_at >= $${params.length}::timestamptz`); }
    if (to)   { params.push(to);   wh.push(`created_at < $${params.length}::timestamptz`); }
    if (reason != null && reason !== '__other') {
      const dv = (reason === 'Unknown / not returned') ? '—' : reason;   // match the derived decline label
      params.push(dv); wh.push(`(${analytics.DECLINE_EXPR}) = $${params.length}`);
    }
    if (vendor) { params.push(vendor); wh.push(`vendor = $${params.length}`); }
    params.push(Math.min(Number(req.query.limit) || 200, 500));
    const r = await db.source.query(
      `SELECT id::text AS id, created_at AS when, customer_mobile_number AS mobile, target_mobile_number AS target,
              amount, vendor, platform, payment_on_type AS on_type, payment_on_id::text AS on_id, card_type,
              fail_reason AS reason, payment_reference_id AS ref,
              payment_commit_response AS commit_resp, payment_initialization_response AS init_resp
       FROM payments WHERE ${wh.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    const CARD = { 0: 'Apple Pay', 1: 'Credit card', 2: 'mada', 3: 'Amex', 4: 'STC', 5: 'Tasheel', 30: 'Other', 60: 'N/A' };
    const ne = o => (o && typeof o === 'object' && Object.keys(o).length) ? o : null;
    const rows = r.rows.map(x => ({
      id: x.id, when: x.when, mobile: x.mobile || x.target, amount: x.amount, vendor: x.vendor, platform: x.platform,
      on_type: x.on_type, on_id: x.on_id, card: CARD[x.card_type] != null ? CARD[x.card_type] : (x.card_type != null ? String(x.card_type) : '—'),
      reason: x.reason || '—', ref: x.ref, response: ne(x.commit_resp) || ne(x.init_resp) || null
    }));
    const allowUnmask = !!(req.caps && req.caps.unmaskPII);
    res.json({ rows: roles.maskDeep(rows, allowUnmask), unmasked: allowUnmask, total: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Topology 2 — real, masked evidence for a node's API-doc tab: a live sample payload from the
// replica, plus timing (api_traffic_events) and vendor stats. Server owns the node→source map so
// only whitelisted, read-only lookups run. Everything is PII-masked unless super_admin + ?unmask=1.
const TOPO2_VENDOR = { hyperpay_client: 'hyperpay', ext_hyperpay: 'hyperpay', tap_client: 'tap', ext_tap: 'tap',
  tamara_client: 'tamara', ext_tamara: 'tamara', salam_client: 'salam', ext_salam: 'salam', apollo_client: 'apollo' };
const TOPO2_PATH = { checkout_ctrl: '%checkout%', payment_ctrl: '%payment%', apps_payment_ctrl: '%payment%',
  zatca_ctrl: '%zatca%', apollo_checkout: '%apollo%' };
app.get('/api/topo2/sample', async (req, res) => {
  try {
    const node = String(req.query.node || '');
    const out = { node, timing: null, stats: null, samples: [] };
    const vendor = TOPO2_VENDOR[node];
    const pathPat = TOPO2_PATH[node];
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';

    // timing — from the API traffic log (if the pipeline has landed rows for this path)
    if (pathPat) {
      try {
        const t = (await db.console.query(
          `SELECT round(avg(duration_ms))::int avg_ms,
                  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int p95_ms,
                  max(duration_ms)::int max_ms, count(*)::bigint n
             FROM api_traffic_events
            WHERE path ILIKE $1 AND duration_ms IS NOT NULL AND ts > now() - interval '7 days'`, [pathPat])).rows[0];
        if (t && Number(t.n) > 0) out.timing = { avg_ms: t.avg_ms, p95_ms: t.p95_ms, max_ms: t.max_ms, n: Number(t.n), window_days: 7 };
      } catch (e) { /* table may be empty / not yet collected */ }
    }

    // vendor stats + real masked sample payloads — from the payments replica
    if (vendor) {
      try {
        const st = (await db.source.query(
          `SELECT count(*)::bigint total,
                  count(*) FILTER (WHERE status='success')::bigint ok,
                  count(*) FILTER (WHERE status IN ('fail','failed'))::bigint fail
             FROM payments WHERE vendor=$1 AND created_at > now() - interval '7 days'`, [vendor])).rows[0];
        if (st && Number(st.total) > 0) {
          const total = Number(st.total), ok = Number(st.ok), fail = Number(st.fail);
          out.stats = { window_days: 7, total, success: ok, fail, success_rate: total ? +(ok / total * 100).toFixed(1) : null };
          const dc = (await db.source.query(
            `SELECT payment_commit_response#>>'{gateway,response,code}' code,
                    payment_commit_response#>>'{gateway,response,message}' msg, count(*)::bigint n
               FROM payments WHERE vendor=$1 AND status IN ('fail','failed') AND created_at > now() - interval '7 days'
              GROUP BY 1,2 ORDER BY n DESC NULLS LAST LIMIT 1`, [vendor])).rows[0];
          if (dc && dc.code) out.stats.top_decline = { code: dc.code, message: dc.msg, n: Number(dc.n) };
        }
        const samp = (await db.source.query(
          `(SELECT 'success' AS outcome, created_at, card_type, amount, payment_commit_response cr, payment_initialization_response ir
              FROM payments WHERE vendor=$1 AND status='success' AND payment_commit_response IS NOT NULL ORDER BY created_at DESC LIMIT 1)
           UNION ALL
           (SELECT 'fail' AS outcome, created_at, card_type, amount, payment_commit_response cr, payment_initialization_response ir
              FROM payments WHERE vendor=$1 AND status IN ('fail','failed') AND payment_commit_response IS NOT NULL ORDER BY created_at DESC LIMIT 1)`, [vendor])).rows;
        const ne = o => (o && typeof o === 'object' && Object.keys(o).length) ? o : null;
        out.samples = samp.map(s => ({ outcome: s.outcome, when: s.created_at, amount: s.amount, response: ne(s.cr) || ne(s.ir) || null }));
      } catch (e) { out.sample_error = e.message; }
    }
    out.samples = roles.maskDeep(out.samples, allowUnmask);
    out.unmasked = allowUnmask;
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* TKT-000016 — "not getting any logs for a particular transaction".
 * The timeline resolver only understood order-UUID / mobile / NID / ICCID. Anything else the app
 * or the gateway prints in an error dialog — a log/trace reference (91d51389c6ffd37e), a payment
 * UUID, a Tap chg_/pay_ id, a UPG invoice id — found NOTHING even when the transaction exists.
 * resolveSearchReference() turns those shapes into an identifier the timeline understands, or
 * into the case-analyzer's answer, or into an HONEST miss that names what was recognized.
 * Bounded by construction: payments lookups ride the pk / a 120-day created_at range, the trace
 * path hits api_error_events' three indexed columns via traceCase. */
async function resolveSearchReference(raw) {
  const id = String(raw || '').trim();
  if (!id || /^\d{8,15}$/.test(id)) return null;                       // mobiles / NIDs: normal path
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const isGwRef = /^(chg|pay)_[\w]{6,40}$/i.test(id) || /^[a-z0-9]{12}$/.test(id);   // Tap ids · UPG invoice shape
  const isTrace = !isUuid && /^[0-9a-f]{12,64}$/i.test(id) && /[a-f]/i.test(id);      // hex w/ letters, no dashes
  const isCkCode = !isUuid && !isGwRef && !isTrace && /^[a-z0-9]{6,11}$/.test(id) && /\d/.test(id);
  if (!isUuid && !isGwRef && !isTrace && !isCkCode) return null;
  // 0) CMS checkout? (short code like '2wk2wrk2', or the uuid) → the customer's timeline
  if (isCkCode || isUuid) {
    try {
      const ck = await require('./checkoutLookup').checkoutFull(id);
      if (ck.found) {
        const ident = ck.identifier
          || (ck.payments.find(x => x.customer_mobile_number) || {}).customer_mobile_number || null;
        if (ident) return { kind: 'payment', identifier: ident,
          at: ck.checkout.created_at, note: `resolved from checkout ${ck.checkout.code} (${ck.checkout.type} · ${ck.checkout.state})` };
      }
    } catch (e) { /* fall through */ }
    if (isCkCode) return { kind: 'miss',
      note: `"${id}" looks like a CMS checkout code, but no checkout (or no customer identifier on it) matches. ` +
            `Check the code in the admin panel, or search by MOBILE / ORDER ID.` };
  }
  // 1) payment row? (uuid = payments.id; gateway ref = payment_reference_id, 120-day window)
  try {
    const pq = isUuid
      ? await db.source.query(
          `SELECT customer_mobile_number m, target_mobile_number t, payment_on_id o, created_at
             FROM payments WHERE id = $1::uuid LIMIT 1`, [id])
      : isGwRef
      ? await db.source.query(
          `SELECT customer_mobile_number m, target_mobile_number t, payment_on_id o, created_at
             FROM payments WHERE payment_reference_id = $1
              AND created_at > now() - interval '120 days'
            ORDER BY created_at DESC LIMIT 1`, [id])
      : { rows: [] };
    if (pq.rows.length) {
      const r = pq.rows[0];
      const ident = r.m || r.t || r.o;
      if (ident) return { kind: 'payment', identifier: ident, at: r.created_at,
        note: `resolved from payment reference ${id}` };
    }
  } catch (e) { /* fall through */ }
  // 2) trace / request / device / transaction id → case analyzer (indexed on all three)
  if (isTrace || isUuid) {
    try {
      const cs = await require('./traceCase').analyze(id);
      if (cs && cs.found) return { kind: 'case', case: cs };
    } catch (e) { /* fall through */ }
  }
  // 3) recognized as a reference but nothing stored — say so, honestly. If the shape matches a
  // DMS app-log reference (16-hex Sleuth trace id / uilTransactionId uuid), hand the client the
  // key so it can offer the on-node log search (Phase 2, 3 Sep 2026).
  const logref = require('./dmsLogGrep').configured() ? require('./dmsLogGrep').candidate(id) : null;
  return { kind: 'miss', logref,
    note: `"${id}" looks like a ${isUuid ? 'payment/order UUID' : isTrace ? 'trace / log reference' : 'gateway reference'}, `
        + `but no stored record matches. Trace captures are retained ~7 days (collection began 13 Aug 2026)`
        + (logref ? ` — but this shape matches a DMS application-log reference, searchable directly on the DMS nodes below.`
                  : `; older references need a grep on the API hosts. Searching by MOBILE or ORDER ID always works.`) };
}

/* TKT-000008 follow-up (2 Sep): the timeline's "SMS details" sent tl.identifier — which is
 * MASKED for masked clients, so the SMS search rejected '*******935'. Same law as dmsrow: raw
 * PII never round-trips through the client. This sibling endpoint accepts the SAME params the
 * timeline was opened with (id / row / dmsrow), resolves the subscriber server-side, and runs
 * the OTP/SMS search internally. Masked by default; unmask audited. */
app.get('/api/transaction/sms', async (req, res) => {
  try {
    let ident = null;
    if (req.query.dmsrow) {
      const [jk, jid] = String(req.query.dmsrow).split(':');
      const det = await require('./dmsJourneys').rowDetail(jk, jid, true);
      const f = Object.fromEntries(((det && det.fields) || []).map(x => [x.k, x.v]));
      ident = det && det.found ? (det.msisdn_value || f.mobile_number || f.msisdn || det.customer_value || null) : null;
    } else if (req.query.row) {
      const rr = await errors.resolveRow(req.query.row); ident = rr && rr.identifier;
    } else ident = req.query.id;
    if (!ident) return res.json({ rows: [], notes: ['no subscriber identifier resolvable for this timeline'] });
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    if (allowUnmask) await audit(req, 'pii.unmask', 'txn-sms', {});
    const out = await require('./smsTrace').search(String(ident), { limit: Number(req.query.limit) || 25 });
    res.json(roles.maskDeep(out, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/transaction', async (req, res) => {
  try {
    // prefer server-side row resolution (client never holds raw PII); else use id.
    // dmsrow=<journey>:<ledger id> — a DMS-ledger reference: the MSISDN is extracted HERE from
    // the source row (internal unmasked read), so masked clients can open dealer timelines
    // without ever holding a raw number (1 Sep — dealer "all timelines" walker).
    let rr;
    if (req.query.dmsrow) {
      const [jk, jid] = String(req.query.dmsrow).split(':');
      const det = await require('./dmsJourneys').rowDetail(jk, jid, true);
      const f = Object.fromEntries(((det && det.fields) || []).map(x => [x.k, x.v]));
      // resolved msisdn first (each ledger names it differently), then common spellings,
      // then the customer national id — the timeline resolves by NID too
      const ms = det && det.found
        ? (det.msisdn_value || f.mobile_number || f.msisdn || f.customer_mobile || f.purchased_number || f.default_number || det.customer_value || null) : null;
      rr = { identifier: ms ? String(ms).replace(/\D/g, '') : null, at: f.insert_date_time || null };
      if (!rr.identifier) return res.status(404).json({ error: 'ledger row has no msisdn to trace' });
    } else rr = req.query.row ? await errors.resolveRow(req.query.row) : { identifier: req.query.id, at: null };
    // TKT-000016: reference-shaped searches (trace id, payment uuid, gateway ref) resolve here
    let refNote = null;
    if (!req.query.row && !req.query.dmsrow && rr.identifier) {
      const rf = await resolveSearchReference(rr.identifier);
      if (rf && rf.kind === 'payment') { refNote = rf.note; rr = { identifier: rf.identifier, at: rf.at }; }
      else if (rf && rf.kind === 'case') {
        const cs = rf.case;
        const evs = (cs.entries || []).map(e => ({ at: e.ts, source: 'case analyzer', kind: e.exception_class || 'app error',
          ok: false, detail: `${e.controller || ''}#${e.action || ''} · ${e.error_code || e.http_status || ''} · ${String(e.message || '').slice(0, 120)}`,
          endpoint: e.controller ? `${e.controller}#${e.action}` : null, request: null,
          response: { platform: e.platform, app_version: e.app_version, frame: e.frame, request_id: e.request_id },
          ms: null, status: e.error_code || e.http_status || null, rr: { res: 'APP ERROR EVENT' } }));
        for (const g of ((cs.gateway && cs.gateway.app) || [])) evs.push({ at: g.ts, source: 'api gateway',
          kind: g.path || 'gateway call', ok: !(g.response_code && String(g.response_code) !== '00'),
          detail: `${g.path || ''} · code ${g.response_code || '—'} · ${String(g.response_message || '').slice(0, 100)}`,
          endpoint: g.path || null, request: null, response: g, ms: g.duration_ms || null,
          status: g.response_code || null, rr: { res: 'GATEWAY SPAN' } });
        evs.sort((a, z) => new Date(a.at) - new Date(z.at));
        const allowU = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
        return res.json(roles.maskDeep({ identifier: rr.identifier, order: null, events: evs,
          logref: require('./dmsLogGrep').configured() ? require('./dmsLogGrep').candidate(rr.identifier) : null,
          reference: { kind: cs.kind || 'trace', occurrences: cs.occurrences,
            known_case: cs.known_case ? { title: cs.known_case.title, classification: cs.known_case.classification,
              explanation: cs.known_case.explanation, action: cs.known_case.action } : null },
          note: 'Resolved via the case analyzer — this reference has no customer identifier attached; open Troubleshoot → Case analyzer for the full diagnosis.' }, allowU));
      }
      else if (rf && rf.kind === 'miss')
        return res.json({ identifier: rr.identifier, order: null, events: [], note: rf.note,
                          logref: rf.logref || null });
    }
    const tl = await errors.timeline({ identifier: rr.identifier, anchorAt: rr.at, rowId: req.query.row });
    if (refNote) tl.note = refNote;
    // Mask by DEFAULT, even for super_admin: unmasking requires BOTH the capability AND an
    // explicit ?unmask=1 from the toggle. Role alone was making the Mask/Unmask button inert —
    // the data came back unmasked regardless of the button, so masking could never be shown.
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    if (allowUnmask) await audit(req, 'pii.unmask', req.query.id, {});
    /* DEALER-SIDE STEPS (31 Aug): the correlator predates the DMS ledger work, so a dealer sale
     * showed only the app/replica half. Merge the customer's DMS journey rows (eligibility,
     * activation, wallet, SMS…) from dms_audit_logs into the same timeline, window-filtered. */
    try {
      const digits = String(rr.identifier || '').replace(/\D/g, '');
      if (digits.length >= 8 && Array.isArray(tl.events)) {
        const t = await require('./dmsJourneys').trace(digits, allowUnmask);
        const ats = tl.events.map(e => new Date(e.at).getTime()).filter(Number.isFinite);
        // no replica events is NORMAL for DMS-channel customers — anchor the window on the
        // ledger row's own timestamp (dmsrow walks), else fall back to a wide 30-day net
        const anchor = rr.at ? new Date(rr.at).getTime() : null;
        const lo = ats.length ? Math.min(...ats) - 3600e3
          : Number.isFinite(anchor) ? anchor - 48 * 3600e3 : Date.now() - 30 * 864e5;
        const hi = ats.length ? Math.max(...ats) + 48 * 3600e3
          : Number.isFinite(anchor) ? anchor + 48 * 3600e3 : Date.now() + 3600e3;
        let added = 0;
        for (const h2 of (t.hits || [])) {
          const ts2 = new Date(h2.at).getTime();
          if (!(ts2 >= lo && ts2 <= hi)) continue;
          tl.events.push({ at: h2.at, source: 'dms · ' + h2.journey, kind: h2.label,
            ok: h2.err ? false : true,
            detail: `${h2.label}${h2.dealer ? ' · dealer ' + h2.dealer : ''} · ${h2.code || '—'}${h2.message ? ' · ' + String(h2.message).slice(0, 90) : ''}`,
            endpoint: h2.api || null, request: null,
            response: { journey: h2.journey, api: h2.api, code: h2.code, message: h2.message,
              dealer: h2.dealer, plan: h2.plan, ref: h2.ref, row_id: h2.src_id,
              every_column: 'DMS page -> journey -> All calls -> row #' + h2.src_id },
            ms: null, status: h2.code || null, rr: { req: null, res: 'DMS LEDGER ROW' } });
          added++;
        }
        if (added) tl.events.sort((a, z) => new Date(a.at) - new Date(z.at));
        tl.dms_merged = added;
        /* OSB TIER (3 Sep 2026): if the SFTP-delivered OSB archive covers this window, merge the
         * BSS-bus story too — pipeline payloads (Siebel/Redknee/ZATCA/SADAD hops, OSB-382000 /
         * 1500 faults with detail) keyed by the customer's msisdn, plus the access rows joined
         * via ECID (uri + latency of every backend hop). Completes app → gateway → UIL → OSB → BSS. */
        try {
          const osb = require('./osbArchive');
          if (await osb.available()) {
            const oe = await osb.eventsFor(digits, new Date(lo).toISOString(), new Date(hi).toISOString());
            const accByEcid = {};
            for (const a2 of (oe.access || [])) (accByEcid[a2.ecid] = accByEcid[a2.ecid] || []).push(a2);
            let oAdded = 0;
            for (const p2 of (oe.pipeline || [])) {
              const hops = p2.ecid ? (accByEcid[p2.ecid] || []) : [];
              tl.events.push({ at: p2.ts, source: 'OSB · BSS bus', kind: `${p2.pipeline}${p2.stage ? ' · ' + p2.stage : ''}`,
                ok: !p2.fault,
                detail: `${p2.label || p2.pipeline}${p2.direction ? ' (' + p2.direction + ')' : ''}`
                  + (p2.fault ? ` · ✖ ${p2.fault_kind}` : '')
                  + (hops.length ? ` · ${hops.map(h3 => `${h3.uri.split('/').filter(Boolean).slice(-1)[0]} ${h3.ms}ms`).join(' · ').slice(0, 120)}` : ''),
                endpoint: hops[0] ? hops[0].uri : null, request: null,
                response: { server: p2.server, ecid: p2.ecid, fault_kind: p2.fault_kind,
                  backend_hops: hops.map(h3 => ({ uri: h3.uri, ms: h3.ms, status: h3.status })),
                  payload: p2.payload },
                ms: hops[0] ? hops[0].ms : null, status: p2.fault ? (p2.fault_kind || 'FAULT') : 'OK',
                rr: { req: null, res: 'OSB PIPELINE RECORD' } });
              oAdded++;
            }
            for (const a2 of (oe.access_by_msisdn || [])) {   // Siebel bridges carry ?msisdn=
              tl.events.push({ at: a2.ts, source: 'OSB · BSS bus', kind: 'backend call',
                ok: String(a2.status)[0] === '2',
                detail: `${a2.method} ${a2.uri} · ${a2.ms}ms · HTTP ${a2.status}`,
                endpoint: a2.uri, request: null, response: { ecid: a2.ecid }, ms: a2.ms,
                status: a2.status, rr: { req: null, res: 'OSB ACCESS ROW' } });
              oAdded++;
            }
            if (oAdded) tl.events.sort((a, z) => new Date(a.at) - new Date(z.at));
            tl.osb_merged = oAdded;
          }
        } catch (e) { tl.osb_error = String(e.message || '').slice(0, 120); }
      }
    } catch (e) { tl.dms_error = String(e.message || '').slice(0, 120); }
    res.json(roles.maskDeep(tl, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Subscriber 360 — unified profile by MSISDN or National ID (PII masked unless super_admin)
/* ---- LIVE CUSTOMER VIEW (Sub360 · 2 Sep 2026) -------------------------------------------------
 * Live BSS reads via the UIL gateway (liveBss.js — read-only whitelist, env-keyed, snapshot cache)
 * plus two replica-truth panels ('payments', 'app') so the client has ONE contract. The client
 * sends only the search key; every identifier is resolved server-side. Masked by default. */
app.get('/api/subscriber/live/health', async (req, res) => {
  try { res.json(await require('./liveBss').health()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/subscriber/live/lines', async (req, res) => {
  try {
    const key = String(req.query.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key required' });
    const pmap = await plans.loadMap();
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    if (allowUnmask) await audit(req, 'pii.unmask', 'live-lines ' + key, {});
    const lf = await require('./liveBss').linesFor(key);
    const lines = lf.lines.map(l => ({
      ref: l.ref, msisdn: allowUnmask ? l.msisdn : roles.maskValue('msisdn', l.msisdn),
      source: l.source, plan: plans.label(pmap, l.plan_id), at: l.at, activated: l.activated }));
    res.json({ lines, error: lf.error || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/subscriber/live/invoice-pdf', async (req, res) => {
  try {
    const key = String(req.query.key || '').trim(), date = String(req.query.date || '').trim();
    if (!key || !date) return res.status(400).json({ error: 'key and date required' });
    await audit(req, 'live.bss', key, { panel: 'invoice-pdf', date });
    const r = await require('./liveBss').invoicePdf(key, String(req.query.line || '') || null, date,
      String(req.query.acct || '').replace(/[^\w.-]/g, '').slice(0, 40) || null);
    if (!r.ok) return res.status(502).json({ error: r.error || 'PDF fetch failed' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${date.replace(/[^0-9-]/g, '').slice(0, 10)}.pdf"`);
    res.send(r.buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/subscriber/live/snapshot', async (req, res) => {
  try {
    const live = require('./liveBss');
    const snap = await live.snapshotById(String(req.query.key || '').trim(), Number(req.query.id));
    if (!snap) return res.status(404).json({ error: 'snapshot not found' });
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    if (allowUnmask) await audit(req, 'pii.unmask', 'live-snapshot ' + req.query.id, {});
    res.json(roles.maskDeep(snap, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/subscriber/live', async (req, res) => {
  try {
    const key = String(req.query.key || '').trim();
    const name = String(req.query.panel || '').trim();
    if (!key || !name) return res.status(400).json({ error: 'key and panel required' });
    const refresh = req.query.refresh === '1';
    const line = String(req.query.line || '').trim() || null;
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    let out;
    if (name === 'payments') {
      // replica truth: the app's own payment rows. The typed key may be a NID — resolve the
      // customer's msisdn first (server-side), and ALSO match via their order ids so a payment
      // stamped with a different number form still appears.
      const live = require('./liveBss');
      const c = await live.resolveCustomer(key, line);
      const forms = new Set([key.replace(/\D/g, '')]);
      if (c.msisdn) { forms.add(c.msisdn); if (/^966/.test(c.msisdn)) forms.add('0' + c.msisdn.slice(3)); }
      // payments may be stamped under ANY of the customer's lines (service or contact)
      try { for (const l of (await live.linesFor(key)).lines) { forms.add(l.msisdn); if (/^966/.test(l.msisdn)) forms.add('0' + l.msisdn.slice(3)); } } catch (e) {}
      let oids = [];
      if (c.nid) {
        const oq = await db.source.query(
          `SELECT id::text FROM onboarding_orders WHERE nationality_id_number=$1
            ORDER BY created_at DESC LIMIT 30`, [c.nid]).catch(() => ({ rows: [] }));
        oids = oq.rows.map(x => x.id);
      }
      const r = await db.source.query(
        `SELECT id::text AS pid, created_at, amount, status, vendor, payment_method, payment_on_type, payment_on_id,
                fail_reason, payment_reference_id
           FROM payments WHERE customer_mobile_number = ANY($1::text[]) OR target_mobile_number = ANY($1::text[])
              ${oids.length ? 'OR payment_on_id = ANY($2::text[])' : ''}
          ORDER BY created_at DESC LIMIT 20`, oids.length ? [[...forms], oids] : [[...forms]]);
      out = { panel: 'payments', label: 'Payments & recharges (app record)', ok: true, cached: false,
        taken_at: new Date().toISOString(), endpoint: 'replica · payments table',
        rows: r.rows,
        note: 'Card/wallet recharges and bill payments appear here. VOUCHER recharges write no ' +
              'database row (the app calls BSS directly) — a voucher shows only in the live BSS ' +
              'balance, or in the 7-day API capture.' };
    } else if (name === 'app') {
      out = { panel: 'app', label: 'App account & last login', ok: true, cached: false,
        taken_at: new Date().toISOString(), endpoint: 'replica · users (login tracer)',
        state: await require('./loginTrace').state(key) };
    } else if (name === 'vas') {
      /* VAS/addons activity — the CMS "Service Logs" rows for this customer, from the replica.
       * Service-line resolution mirrors the payments panel: all the customer's msisdn forms. */
      const live = require('./liveBss');
      const c = await live.resolveCustomer(key, line);
      const forms = new Set([key.replace(/\D/g, '')]);
      if (c.msisdn) { forms.add(c.msisdn); if (/^966/.test(c.msisdn)) forms.add('0' + c.msisdn.slice(3)); }
      try { for (const l of (await live.linesFor(key)).lines) { forms.add(l.msisdn); if (/^966/.test(l.msisdn)) forms.add('0' + l.msisdn.slice(3)); } } catch (e) {}
      const v = await require('./subscriber').vasActivity([...forms]);
      out = { panel: 'vas', label: 'VAS / addons activity (app record)', ok: true, cached: false,
        taken_at: new Date().toISOString(), endpoint: 'replica · service-log tables (as in CMS → Service Logs)',
        ...v,
        note: 'Every VAS/addon toggle the app attempted for this customer — service, ACTIVATE/DEACTIVATE, ' +
              'Added/Removed state, request→response flags, platform. Same records as CMS Service Logs.' };
    } else if (name === 'osb') {
      /* OSB · ORACLE BUS for this customer — everything the BSS bus logged for the msisdn in
       * the imported archive window: pipeline payload records (Siebel/ZATCA/…, faults with
       * detail) + the ECID-joined backend hops (uri + latency). Same data the timeline merges;
       * surfaced HERE so agents see it without opening a drawer. */
      const osb = require('./osbArchive');
      if (!(await osb.available())) {
        out = { panel: 'osb', label: 'OSB · Oracle bus (archive)', ok: true, empty: true,
          note: 'No OSB archive imported yet.' };
      } else {
        const live = require('./liveBss');
        const c = await live.resolveCustomer(key, line);
        const ms = c.msisdn || key.replace(/\D/g, '');
        const st = await osb.status();
        const ev = await osb.eventsFor(ms, st.pipeline.lo || st.access.lo, new Date().toISOString());
        out = { panel: 'osb', label: 'OSB · Oracle bus (archive)', ok: true, cached: false,
          taken_at: new Date().toISOString(),
          endpoint: 'imported OSB log archive (SFTP) · msisdn + ECID correlation',
          archive_window: { lo: st.access.lo, hi: st.access.hi }, msisdn_used: ms, ...ev,
          note: 'Every BSS-bus record for this customer in the archive window — pipeline payloads ' +
                '(Siebel/ZATCA/…) with faults, plus the backend hops joined by ECID. Day-1-lag live once the SFTP feed is daily.' };
      }
    } else {
      out = await require('./liveBss').panel(key, name, { refresh, line });
      if (refresh) await audit(req, 'live.bss', key, { panel: name });
    }
    if (allowUnmask) await audit(req, 'pii.unmask', 'live ' + name + ' ' + key, {});
    res.json(roles.maskDeep(out, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/subscriber', async (req, res) => {
  try {
    const key = req.query.row ? (await errors.resolveRow(req.query.row)).identifier : req.query.key;
    if (!key) return res.status(400).json({ error: 'missing key (MSISDN or National ID)' });
    // masked by default; unmask needs the capability AND the explicit toggle (?unmask=1)
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    const p = await subscriber.profile({ key });
    await audit(req, allowUnmask ? 'subscriber.view.unmasked' : 'subscriber.view', key, { found: p.found });
    res.json(roles.maskDeep(p, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', async (req, res) => {
  try {
    const b = await dataBounds();
    const r = await C.query(`SELECT count(*)::int AS rules FROM alert_rules`);
    const fixed = await require('./fixed').status();   // unified: Fixed-side pools (never fatal for MVNO health)
    res.json({ ok: true, source_bounds: b, rules: r.rows[0].rules, fixed });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Fixed / Salam Home routes — all under /api/fixed/* (see fixed.js)
require('./fixed').mount(app, { requireView, audit, requireCap });

app.get('/api/rules', async (req, res) => {
  const rules = (await C.query(`SELECT r.*, mc.unit, mc.higher_is_bad FROM alert_rules r
     LEFT JOIN metric_catalog mc ON mc.key=r.metric_key ORDER BY severity, name`)).rows;
  const catalog = (await C.query(`SELECT * FROM metric_catalog ORDER BY key`)).rows;
  res.json({ rules, catalog });
});

app.get('/api/alerts', async (req, res) => {
  const status = req.query.status || 'open';
  const where = status === 'all' ? '' : `WHERE a.status=$1`;
  // alerts rows don't carry the class — join it live from alert_rules (errclass.js split)
  const rows = (await C.query(
    `SELECT a.*, r.alert_class FROM alerts a LEFT JOIN alert_rules r ON r.key = a.rule_key
     ${where} ORDER BY (a.status='open') DESC,
       CASE a.severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
       a.last_seen_at DESC LIMIT 500`,
    status === 'all' ? [] : [status])).rows;
  // annotate root-cause correlation so the UI can group children under their provider root
  const openRoots = await correlation.openRootKeys(C);
  const nameByKey = {}; rows.forEach(r => { if (!nameByKey[r.rule_key]) nameByKey[r.rule_key] = r.name; });
  for (const a of rows) {
    let role = null, parent = null;
    if (correlation.isRoot(a.rule_key) && a.status === 'open') role = 'root';
    else { const s = correlation.suppressorOf(a.rule_key, openRoots); if (s) { role = 'child'; parent = s; }
      else { const rel = correlation.relatedTo(a.rule_key, openRoots); if (rel) { role = 'related'; parent = rel; } } }
    a.correlation = role ? { role, parent, parentName: parent ? (nameByKey[parent] || parent) : null,
      impacts: role === 'root' ? correlation.impactOf(a.rule_key) : null } : null;
  }
  res.json({ alerts: rows });
});

app.get('/api/alerts/summary', async (req, res) => {
  const bySev = (await C.query(
    `SELECT severity, count(*) FILTER (WHERE status='open')::int AS open,
            count(*)::int AS total FROM alerts GROUP BY severity`)).rows;
  const byTeam = (await C.query(
    `SELECT team, count(*) FILTER (WHERE status='open')::int AS open FROM alerts GROUP BY team`)).rows;
  const latest = (await C.query(`SELECT max(sim_now) AS sim_now FROM sync_runs`)).rows[0];
  res.json({ bySeverity: bySev, byTeam, latest_sim_now: latest && latest.sim_now });
});

/* ---- incident lifecycle (ack / assign / snooze / resolve / comment) ---- */
app.get('/api/incidents/stats', async (req, res) => {
  try {
    const bySeverity = (await C.query(
      `SELECT severity, count(*)::int c, count(*) FILTER (WHERE ack_at IS NOT NULL)::int acked,
              count(*) FILTER (WHERE snoozed_until > now())::int snoozed
       FROM alerts WHERE status='open' GROUP BY severity`)).rows;
    const t = (await C.query(
      `SELECT avg(EXTRACT(EPOCH FROM (ack_at-fired_at))) FILTER (WHERE ack_at IS NOT NULL AND fired_at > now()-interval '30 days') mtta,
              avg(EXTRACT(EPOCH FROM (resolved_at-fired_at))) FILTER (WHERE resolved_at IS NOT NULL AND fired_at > now()-interval '30 days') mttr,
              count(*) FILTER (WHERE status='open')::int open_total,
              count(*) FILTER (WHERE status='open' AND ack_at IS NULL)::int unacked,
              count(*) FILTER (WHERE resolved_at > now()-interval '24 hours')::int resolved_24h
       FROM alerts`)).rows[0];
    res.json({ bySeverity, mtta_sec: t.mtta ? Math.round(t.mtta) : null, mttr_sec: t.mttr ? Math.round(t.mttr) : null,
      open_total: t.open_total, unacked: t.unacked, resolved_24h: t.resolved_24h });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/alerts/:id', async (req, res) => {
  try {
    const a = (await C.query(`SELECT * FROM alerts WHERE id=$1`, [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: 'not found' });
    const comments = (await C.query(`SELECT author, body, created_at FROM incident_comments WHERE alert_id=$1 ORDER BY created_at`, [req.params.id])).rows;
    const rule = (await C.query(`SELECT runbook, trigger_codes FROM alert_rules WHERE key=$1`, [a.rule_key])).rows[0] || {};
    res.json({ alert: a, comments, runbook: rule.runbook || null, trigger_codes: rule.trigger_codes || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// READ-ONLY ServiceNow correlation: incidents this console alert likely caused
app.get('/api/alerts/:id/tickets', async (req, res) => {
  try {
    const a = (await C.query(`SELECT * FROM alerts WHERE id=$1`, [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: 'not found' });
    res.json(await servicenow.relatedTickets(a));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/servicenow/ping', requireCap('manageSync'), async (req, res) => {
  try { res.json(await servicenow.ping()); } catch (e) { res.status(500).json({ error: e.message }); }
});

/* One-click notify on-call for an open alert (Guided Response). Reuses ChatOps; force-sends past the
 * minSeverity gate because the operator asked for it explicitly. Audited. */
app.post('/api/alerts/:id/notify', requireCap('ackErrors'), async (req, res) => {
  try {
    const a = (await C.query(`SELECT a.*, COALESCE(mc.unit,'count') AS unit FROM alerts a LEFT JOIN metric_catalog mc ON mc.key=a.metric_key WHERE a.id=$1`, [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: 'alert not found' });
    const out = await chatops.notifyIncident(a, { kind: 'opened', force: true, mention: true });
    await audit(req, 'alert.notify', req.params.id, { channels: out.channels });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Re-seed built-in metric catalog + alert rules on demand (idempotent upsert) so newly-added rules
 * activate without a full reboot. Super-admin only. Returns the resulting rule count. */
app.post('/api/rules/reseed', requireCap('manageUsers'), async (req, res) => {
  try {
    await require('./init').init({ reset: false });
    const n = (await C.query(`SELECT count(*)::int c FROM alert_rules`)).rows[0].c;
    await audit(req, 'rules.reseed', null, { rules: n });
    res.json({ ok: true, rules: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Journey-health: one status per customer journey, worst-of open alerts (by metric) + recent error
 * volume (by category). Drives the dashboard journey-health strip. */
const JOURNEY_HEALTH = {
  onboarding:   { label: 'Onboarding',   metrics: ['onboarding_conversion','onboarding_abandoned','offhours_orders'], cats: [] },
  eligibility:  { label: 'Eligibility·Gov', metrics: ['eligibility_deny_rate','semati_fail_rate','semati_provider_error_rate','citc_upstream_degraded'], cats: ['eligibility','semati'] },
  identity:     { label: 'Identity (Nafath)', metrics: ['nafath_fail_rate'], cats: ['nafath'] },
  payments:     { label: 'Payments',     metrics: ['payment_fail_rate','payment_stuck_initiated','payment_duplicate_suspect','payment_volume','zatca_unreported','recharge_fail_rate','samsung_pay_fail_rate'], cats: ['payment','payment_stuck','payment_dup'] },
  activation:   { label: 'Activation',   metrics: ['activation_fail_rate'], cats: ['activation'] },
  delivery:     { label: 'Delivery',     metrics: ['delivery_fail_rate','delivery_stuck'], cats: ['delivery'] },
  change_plan:  { label: 'Change Plan',  metrics: ['change_plan_fail_rate'], cats: ['change_plan'] },
  ownership:    { label: 'Ownership',    metrics: ['ownership_fail_rate'], cats: ['change_ownership'] },
};
app.get('/api/journey-health', async (req, res) => {
  try {
    const rank = { P1: 1, P2: 2, P3: 3 };
    const open = (await C.query(`SELECT metric_key, severity FROM alerts WHERE status='open'`)).rows;
    const sevByMetric = {}; open.forEach(a => { const c = sevByMetric[a.metric_key]; if (!c || rank[a.severity] < rank[c]) sevByMetric[a.metric_key] = a.severity; });
    let catCount = {}; try { const now = await boardNow(req.query.sim); (await errors.summary({ now, windowHours: 6 })).forEach(t => catCount[t.category] = t.total); } catch (e) {}
    const journeys = Object.entries(JOURNEY_HEALTH).map(([key, j]) => {
      let worst = null; j.metrics.forEach(m => { const s = sevByMetric[m]; if (s && (!worst || rank[s] < rank[worst])) worst = s; });
      const errs = j.cats.reduce((a, c) => a + (catCount[c] || 0), 0);
      const status = worst === 'P1' ? 'red' : worst === 'P2' ? 'amber' : (worst === 'P3' ? 'watch' : 'ok');
      return { key, label: j.label, status, severity: worst, errors: errs, cats: j.cats };
    });
    res.json({ journeys });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// READ-ONLY Tap reconciliation — authoritative check for the two UPG/Tap payment issues
app.get('/api/tap/ping', requireCap('manageSync'), async (req, res) => {
  try { res.json(await tapRecon.ping()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/tap/reconcile', requireCap('manageSync'), async (req, res) => {
  try {
    const opts = { hours: Number(req.query.hours || 24), limit: Math.min(500, Number(req.query.limit || 100)) };
    const type = req.query.type || 'mismatch';
    res.json(type === 'duplicate' ? await tapRecon.reconcileDuplicate(opts) : await tapRecon.reconcileMismatch(opts));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/alerts/:id/ack', requireCap('ackErrors'), async (req, res) => {
  try { await C.query(`UPDATE alerts SET ack_by=$1, ack_at=COALESCE(ack_at, now()) WHERE id=$2`, [req.actor, req.params.id]); await audit(req, 'incident.ack', req.params.id, {}); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/alerts/:id/assign', requireCap('ackErrors'), async (req, res) => {
  try { await C.query(`UPDATE alerts SET assignee=$1 WHERE id=$2`, [(req.body || {}).assignee || null, req.params.id]); await audit(req, 'incident.assign', req.params.id, req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/alerts/:id/snooze', requireCap('ackErrors'), async (req, res) => {
  try {
    const h = Number((req.body || {}).hours || 1);
    const until = (req.body || {}).until || new Date(Date.now() + h * 3600e3).toISOString();
    await C.query(`UPDATE alerts SET snoozed_until=$1 WHERE id=$2`, [until, req.params.id]);
    await audit(req, 'incident.snooze', req.params.id, { until });
    res.json({ ok: true, until });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/alerts/:id/unsnooze', requireCap('ackErrors'), async (req, res) => {
  try { await C.query(`UPDATE alerts SET snoozed_until=NULL WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/alerts/:id/resolve', requireCap('ackErrors'), async (req, res) => {
  try { await C.query(`UPDATE alerts SET status='resolved', resolved_at=COALESCE(resolved_at, now()), note=COALESCE($1, note) WHERE id=$2`, [(req.body || {}).note || null, req.params.id]); await audit(req, 'incident.resolve', req.params.id, {}); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/alerts/:id/comment', requireCap('ackErrors'), async (req, res) => {
  try {
    const body = ((req.body || {}).body || '').trim();
    if (!body) return res.status(400).json({ error: 'empty comment' });
    await C.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,$2,$3)`, [req.params.id, req.actor, body]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- Internal tickets / feedback ------------------------------------------------------------
 * CREATE is open to every authed console user (suggestion/enhancement or an issue, with optional
 * base64 screenshots). The BOARD + status updates are gated to manageUsers (super_admins / admins).
 * Screenshots live on disk under UPLOAD_DIR/tickets; see tickets.js. */
app.post('/api/tickets', async (req, res) => {          // any authed user
  try {
    const out = await tickets.create(req, req.body || {});
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    await audit(req, 'TICKET_CREATE', out.ref, { kind: out.kind, files: out.fileCount, emailed: out.emailed });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/tickets/mine', async (req, res) => {      // caller's own tickets — must precede /:ref
  try { res.json(await tickets.listMine(req.actor)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/tickets', requireCap('manageUsers'), async (req, res) => {   // admin board
  try { res.json(await tickets.listBoard(req.query || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/tickets/:id/file/:fileId', async (req, res) => {   // stream a screenshot (own ticket or admin)
  try {
    const isAdmin = !!(req.caps && req.caps.manageUsers);
    await tickets.streamFile(req, res, req.params.id, req.params.fileId, req.actor, isAdmin);
  } catch (e) { if (!res.headersSent) res.status(500).json({ error: e.message }); }
});
app.get('/api/tickets/:ref', async (req, res) => {      // detail — own ticket, or any for admins
  try {
    const isAdmin = !!(req.caps && req.caps.manageUsers);
    const t = await tickets.getByRef(req.params.ref, req.actor, isAdmin);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json(t);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/tickets/:ref', requireCap('manageUsers'), async (req, res) => {   // admin: status/priority/resolution
  try {
    const out = await tickets.update(req, req.params.ref, req.body || {});
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    await audit(req, 'TICKET_UPDATE', req.params.ref, out.changes || {});
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/tickets/:ref/comments', async (req, res) => {   // own ticket or admin
  try {
    const isAdmin = !!(req.caps && req.caps.manageUsers);
    const out = await tickets.addComment(req.params.ref, req.actor, (req.body || {}).body, isAdmin);
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- L2 Workbench -------------------------------------------------------------------------------
 * L2 follow-up hub, gated to roles that carry the 'workbench' view (L2/L3/admin/super — NEVER
 * L1/report_manager, enforced by requireView below). Four tabs:
 *   1) user-activity — audit_log analytics (actor emails shown only to manageUsers/admins)
 *   2) replay        — READ-ONLY "as-of" incident replay (does NOT drive the global sim clock; it
 *                      only reads alerts + metric_snapshots already recorded for the window, so a
 *                      training replay can never corrupt the live board). To actually RE-RUN a
 *                      window through the engine, an admin uses Settings → Sync → Simulate replay.
 *   3) rule-test     — evaluate any rule over a historic window (reuses metrics.js compute, no writes)
 *                      + fire a TEST alert (tagged context.test=true) + channel test + synthetic probes
 *   4) docs          — upload/parse/search .md/.txt/.pdf; shared docs feed Yusr's KB (assist.loadKb)
 * NOTHING here writes to the prod-replica (SOURCE) DB — tests only touch the console DB + outbound
 * notifications. All test actions are audited as WORKBENCH_TEST. */
const wbView = requireView('workbench');

// TAB 1 — per-user activity & performance (audit_log). manageUsers OR a workbench-view role.
app.get('/api/workbench/actors', wbView, async (req, res) => {
  try { res.json({ actors: await workbench.distinctActors() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/workbench/user-activity', wbView, async (req, res) => {
  try {
    const out = await workbench.userActivity(req.query.actor || 'all', req.query.days);
    // actor emails are PII — reveal them only to admins (manageUsers). Others see a stable hash label.
    if (!(req.caps && req.caps.manageUsers)) {
      const mask = e => e ? (String(e).split('@')[0].slice(0, 2) + '***@' + (String(e).split('@')[1] || '')) : e;
      out.recent = (out.recent || []).map(r => ({ ...r, actor: mask(r.actor), ip: undefined }));
      out.masked = true;
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// TAB 2 — read-only incident replay ("as-of" view over a window)
app.get('/api/workbench/replay', wbView, async (req, res) => {
  try {
    const out = await workbench.replay(req.query.from, req.query.to);
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/workbench/past-alerts', wbView, async (req, res) => {
  try { res.json(await workbench.pastAlerts(req.query.limit)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// TAB 3 — test / what-if runner (needs editRules OR manageSync). Every action audited.
const wbTestCap = requireAnyCap('editRules', 'manageSync');
app.get('/api/workbench/rule-test', wbView, wbTestCap, async (req, res) => {
  try {
    const out = await workbench.ruleTest({ key: req.query.key, from: req.query.from, to: req.query.to });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    await audit(req, 'WORKBENCH_TEST', 'rule-test:' + (req.query.key || ''), { from: req.query.from || null, to: req.query.to || null, would_fire: out.would_fire });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/workbench/test-alert', wbView, wbTestCap, async (req, res) => {
  try {
    const out = await workbench.fireTestAlert(req.actor, (a) => chatops.notifyIncident(a, { kind: 'test' }));
    await audit(req, 'WORKBENCH_TEST', 'test-alert:' + (out.alert && out.alert.id), { channels: (out.notify && out.notify.channels) || [] });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/workbench/notify-test', wbView, wbTestCap, async (req, res) => {
  try {
    const sample = { id: 0, name: 'L2 Workbench — channel test', severity: (req.body || {}).severity || 'P3', team: 'Digital Ops',
      metric_key: 'payment_success_rate', operator: 'lt', threshold: 0.95, observed_value: 0.9, sample: 100, window_hours: 1,
      unit: 'rate', message: 'Channel test from the L2 Workbench.', context: { test: true } };
    const out = await chatops.notifyIncident(sample, { kind: 'test' });
    await audit(req, 'WORKBENCH_TEST', 'notify-test', { channels: out.channels });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/workbench/synthetic', wbView, wbTestCap, async (req, res) => {
  try {
    const out = await workbench.synthetic();
    await audit(req, 'WORKBENCH_TEST', 'synthetic', {});
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// TAB 4 — docs hub (all workbench roles read/search; upload/edit/delete needs manageSync)
app.get('/api/workbench/docs', wbView, async (req, res) => {
  try {
    const isAdmin = !!(req.caps && req.caps.manageUsers);
    res.json(await workbench.listDocs(req.query || {}, req.actor, isAdmin));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/workbench/docs', wbView, requireCap('manageSync'), async (req, res) => {
  try {
    const out = await workbench.createDoc(req, req.body || {});
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    await audit(req, 'WORKBENCH_DOC_UPLOAD', out.doc && out.doc.id, { title: out.doc && out.doc.title, mime: out.doc && out.doc.mime, extracted: out.extracted, shared: out.doc && out.doc.shared });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/workbench/docs/:id/raw', wbView, async (req, res) => {
  try {
    const isAdmin = !!(req.caps && req.caps.manageUsers);
    await workbench.streamDoc(req, res, req.params.id, req.actor, isAdmin);
  } catch (e) { if (!res.headersSent) res.status(500).json({ error: e.message }); }
});
app.patch('/api/workbench/docs/:id', wbView, requireCap('manageSync'), async (req, res) => {
  try {
    const isAdmin = !!(req.caps && req.caps.manageUsers);
    const out = await workbench.updateDoc(req.params.id, req.body || {}, req.actor, isAdmin);
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    await audit(req, 'WORKBENCH_DOC_UPDATE', req.params.id, req.body || {});
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/workbench/docs/:id', wbView, requireCap('manageSync'), async (req, res) => {
  try {
    const isAdmin = !!(req.caps && req.caps.manageUsers);
    const out = await workbench.deleteDoc(req.params.id, req.actor, isAdmin);
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    await audit(req, 'WORKBENCH_DOC_DELETE', req.params.id, {});
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- Yusr (يُسر) — LLM troubleshooting chatbot (local Ollama) ---- */
app.post('/api/assist/chat', requireCap('useYusr'), async (req, res) => {
  try {
    const { message, history } = req.body || {};
    const allowUnmask = !!(req.caps && req.caps.unmaskPII);
    const t0 = Date.now();
    const out = await assist.chat({ message, history, allowUnmask });
    const ms = Date.now() - t0;
    if (out.error) return res.status(400).json(out);
    // ms + llmError feed the Settings→Yusr KPI panel (aggregated from audit_log; question text is
    // deliberately NOT logged — PII stays out of the audit trail)
    await audit(req, 'assist.chat', null, { intent: out.intent, degraded: out.degraded, ms, pack_ms: out.t_pack_ms || null, llm_ms: out.t_llm_ms || null, llmError: out.llmError || null, src_n: Array.isArray(out.sources) ? out.sources.length : null, prompt_chars: out.prompt_chars || null });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 👍/👎 on a Yusr reply. Stores verdict + dimensions only in assist_feedback (no text). A 👍 ALSO
// saves the PII-scrubbed question→reply pair into assist_cases — Yusr's case memory, retrieved for
// future similar questions. This is the "learns from use" loop.
app.post('/api/assist/feedback', async (req, res) => {
  try {
    const b = req.body || {};
    const helpful = b.helpful === true || b.helpful === 'true' ? true : b.helpful === false || b.helpful === 'false' ? false : null;
    if (helpful === null) return res.status(400).json({ error: 'helpful must be true/false' });
    const actor = req.actor || null;
    const intent = String(b.intent || '').slice(0, 40) || null;
    const degraded = b.degraded === true;
    await db.console.query(
      `INSERT INTO assist_feedback (actor, intent, degraded, helpful) VALUES ($1,$2,$3,$4)`,
      [actor, intent, degraded, helpful]);
    let learned = false;
    if (helpful && b.question && b.reply) {
      try { await assist.saveCase({ question: String(b.question), reply: String(b.reply), intent, actor }); learned = true; }
      catch (_) { }
    }
    await audit(req, 'assist.feedback', null, { helpful, intent, learned });
    res.json({ ok: true, learned });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Usage / performance KPIs for the Settings → Yusr panel, aggregated from audit_log (no question
// text is stored there — only intent, degraded flag, latency, actor).
app.get('/api/assist/stats', requireCap('manageSync'), requireRoot('assist_config'), async (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const DEG = `(detail->>'degraded')::boolean`;
    // Cross-filter: one optional dimension filter (day / intent / agent / mode) applies to EVERY
    // aggregate EXCEPT the chart of that same dimension (so the user can still see & unselect it).
    const F = { day: `to_char(at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD') = $2`,
                intent: `coalesce(detail->>'intent','?') = $2`,
                agent: `actor = $2`,
                mode: `${DEG} = ($2 = 'true')` };
    let fType = null, fVal = null;
    for (const k of Object.keys(F)) if (req.query[k] != null && String(req.query[k]) !== '') { fType = k; fVal = String(req.query[k]).slice(0, 120); break; }
    const mk = skipType => {
      const parts = [`action='assist.chat'`, `at >= now() - ($1||' days')::interval`];
      if (fType && fType !== skipType) parts.push(F[fType]);
      return `FROM audit_log WHERE ` + parts.join(' AND ');
    };
    const P = skipType => (fType && fType !== skipType) ? [days, fVal] : [days];
    const base = mk(null), baseP = P(null);
    const [tot, intents, perf, daily, agents, hours, latHist, recent] = await Promise.all([
      db.console.query(`SELECT count(*)::int AS chats, count(DISTINCT actor)::int AS users,
                               count(*) FILTER (WHERE ${DEG})::int AS degraded,
                               count(*) FILTER (WHERE at >= now() - interval '24 hours')::int AS last24h ${base}`, baseP),
      db.console.query(`SELECT coalesce(detail->>'intent','?') AS intent, count(*)::int AS n,
                               count(*) FILTER (WHERE ${DEG})::int AS degraded
                        ${mk('intent')} GROUP BY 1 ORDER BY n DESC`, P('intent')),
      // latency split by answer mode — LLM replies are the ones whose latency is worth watching;
      // data-only replies are near-instant and would drag the blended average into looking great
      db.console.query(`SELECT ${DEG} AS degraded, round(avg((detail->>'ms')::numeric))::int AS avg_ms,
                               round(percentile_cont(0.95) WITHIN GROUP (ORDER BY (detail->>'ms')::numeric))::int AS p95_ms,
                               count(*)::int AS n
                        ${base} AND detail ? 'ms' GROUP BY 1`, baseP),
      db.console.query(`SELECT to_char(at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD') AS day, count(*)::int AS n,
                               count(*) FILTER (WHERE ${DEG})::int AS degraded
                        ${mk('day')} GROUP BY 1 ORDER BY 1`, P('day')),
      db.console.query(`SELECT actor, count(*)::int AS n, count(*) FILTER (WHERE ${DEG})::int AS degraded,
                               max(at) AS last_at
                        ${mk('agent')} GROUP BY actor ORDER BY n DESC LIMIT 8`, P('agent')),
      db.console.query(`SELECT to_char(at AT TIME ZONE 'Asia/Riyadh','HH24')::int AS hour, count(*)::int AS n
                        ${base} GROUP BY 1 ORDER BY 1`, baseP),
      db.console.query(`SELECT width_bucket((detail->>'ms')::numeric, ARRAY[1000,3000,10000,30000]) AS bucket,
                               count(*)::int AS n
                        ${base} AND detail ? 'ms' GROUP BY 1 ORDER BY 1`, baseP),
      db.console.query(`SELECT at, actor, detail->>'intent' AS intent, ${DEG} AS degraded,
                               (detail->>'ms')::int AS ms, detail->>'llmError' AS llm_error
                        ${base} ORDER BY at DESC LIMIT 50`, baseP)
    ]);
    // feedback KPIs — assist_feedback has the same dimensions (actor/intent/degraded/at), so the
    // cross-filter applies here too (day/agent/mode/intent map onto its own columns)
    let fb = { total: 0, helpful: 0 };
    try {
      const FB = { day: `to_char(at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD') = $2`,
                   intent: `coalesce(intent,'?') = $2`, agent: `actor = $2`, mode: `degraded = ($2 = 'true')` };
      const conds = [`at >= now() - ($1||' days')::interval`];
      const fbP = [days];
      if (fType) { conds.push(FB[fType]); fbP.push(fVal); }
      const r = await db.console.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE helpful)::int AS helpful
           FROM assist_feedback WHERE ` + conds.join(' AND '), fbP);
      fb = r.rows[0] || fb;
    } catch (_) { }
    let casesTotal = 0;
    try { casesTotal = Number((await db.console.query(`SELECT count(*)::int AS n FROM assist_cases`)).rows[0].n); } catch (_) { }
    const t = tot.rows[0] || {};
    const perfBy = m => perf.rows.find(r => r.degraded === m) || {};
    const BUCKET_LABELS = ['<1s', '1–3s', '3–10s', '10–30s', '>30s'];
    res.json({
      days, filter: fType ? { type: fType, value: fVal } : null,
      chats: t.chats || 0, users: t.users || 0, last24h: t.last24h || 0,
      degraded: t.degraded || 0, degradedRate: t.chats ? (t.degraded / t.chats) : 0,
      latency: { llm: { avg: perfBy(false).avg_ms ?? null, p95: perfBy(false).p95_ms ?? null, n: perfBy(false).n || 0 },
                 dataOnly: { avg: perfBy(true).avg_ms ?? null, p95: perfBy(true).p95_ms ?? null, n: perfBy(true).n || 0 } },
      latencyHist: BUCKET_LABELS.map((label, i) => ({ label, n: (latHist.rows.find(r => Number(r.bucket) === i) || {}).n || 0 })),
      intents: intents.rows, daily: daily.rows, agents: agents.rows,
      hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, n: (hours.rows.find(r => Number(r.hour) === h) || {}).n || 0 })),
      recent: recent.rows,
      feedback: { total: fb.total || 0, helpful: fb.helpful || 0, rate: fb.total ? fb.helpful / fb.total : null },
      learnedCases: casesTotal
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// public on/off flag (no config details) — lets the widget hide the bubble when disabled
/* AI HEALTH — the sanitised, everyone-visible cut of /api/assist/stats, for the Monitoring tab.
 * Aggregates ONLY: volumes, latency percentiles, degraded/error mix, retrieval depth, feedback
 * ratio, learned cases, live model status. Deliberately NO per-agent split and NO message text —
 * that detail stays on the root-only stats endpoint. Read-only on the console DB; cached 60s so
 * an open Monitoring tab costs the database one round of queries per minute, not per viewer. */
app.get('/api/assist/health', async (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    res.json(await respCache.wrap(req, async () => {
      const DEG = `(detail->>'degraded')::boolean`;
      const base = `FROM audit_log WHERE action='assist.chat' AND at >= now() - ($1||' days')::interval`;
      const q = (sql, p = [days]) => db.console.query(sql, p).catch(() => ({ rows: [] }));
      const [tot, lat, hist, daily, errs, srcs] = await Promise.all([
        q(`SELECT count(*)::int AS chats, count(DISTINCT actor)::int AS users,
                  count(*) FILTER (WHERE ${DEG})::int AS degraded,
                  count(*) FILTER (WHERE at >= now() - interval '24 hours')::int AS last24h ${base}`),
        q(`SELECT ${DEG} AS degraded,
                  round(avg((detail->>'ms')::numeric))::int AS avg_ms,
                  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY (detail->>'ms')::numeric))::int AS p95_ms,
                  round(avg((detail->>'llm_ms')::numeric))::int AS avg_llm_ms,
                  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY (detail->>'llm_ms')::numeric))::int AS p95_llm_ms,
                  round(avg((detail->>'pack_ms')::numeric))::int AS avg_pack_ms,
                  count(*)::int AS n
             ${base} AND detail ? 'ms' GROUP BY 1`),
        q(`SELECT width_bucket((detail->>'ms')::numeric, ARRAY[1000,3000,10000,30000]) AS bucket, count(*)::int AS n
             ${base} AND detail ? 'ms' GROUP BY 1 ORDER BY 1`),
        q(`SELECT to_char(at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD') AS day, count(*)::int AS n,
                  count(*) FILTER (WHERE ${DEG})::int AS degraded ${base} GROUP BY 1 ORDER BY 1`),
        q(`SELECT coalesce(detail->>'llmError','?') AS err, count(*)::int AS n
             ${base} AND ${DEG} GROUP BY 1 ORDER BY n DESC LIMIT 6`),
        // retrieval depth (src_n recorded from 30 Aug 2026): empty retrieval = hallucination precursor
        q(`SELECT count(*)::int AS with_src,
                  count(*) FILTER (WHERE (detail->>'src_n')::int = 0)::int AS empty_src,
                  round(avg((detail->>'src_n')::numeric),1) AS avg_src ${base} AND detail ? 'src_n'`)
      ]);
      let fb = { total: 0, helpful: 0 };
      try { fb = (await db.console.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE helpful)::int AS helpful
           FROM assist_feedback WHERE at >= now() - ($1||' days')::interval`, [days])).rows[0] || fb; } catch (_) {}
      let cases = 0;
      try { cases = Number((await db.console.query(`SELECT count(*)::int n FROM assist_cases`)).rows[0].n); } catch (_) {}
      let model = { ok: false };
      try { const cfg = await assist.getConfig(); const pg = await assist.ping();
        model = { ok: !!pg.ok, enabled: !!cfg.enabled, name: cfg.model || null, modelAvailable: pg.modelAvailable !== false }; } catch (_) {}
      const t = tot.rows[0] || {}; const by = m => lat.rows.find(r => r.degraded === m) || {};
      const L = ['<1s','1-3s','3-10s','10-30s','>30s'];
      return { days,
        chats: t.chats || 0, users: t.users || 0, last24h: t.last24h || 0,
        degraded: t.degraded || 0, degradedRate: t.chats ? +(t.degraded / t.chats).toFixed(3) : 0,
        latency: { llm: { avg: by(false).avg_ms ?? null, p95: by(false).p95_ms ?? null,
                          avg_llm: by(false).avg_llm_ms ?? null, p95_llm: by(false).p95_llm_ms ?? null,
                          avg_pack: by(false).avg_pack_ms ?? null, n: by(false).n || 0 },
                   fallback: { avg: by(true).avg_ms ?? null, n: by(true).n || 0 } },
        latencyHist: L.map((label, i) => ({ label, n: (hist.rows.find(r => Number(r.bucket) === i) || {}).n || 0 })),
        daily: daily.rows, llmErrors: errs.rows,
        retrieval: (srcs.rows[0] && Number(srcs.rows[0].with_src)) ? {
          measured: Number(srcs.rows[0].with_src), empty: Number(srcs.rows[0].empty_src),
          emptyRate: +(srcs.rows[0].empty_src / srcs.rows[0].with_src).toFixed(3),
          avgSources: srcs.rows[0].avg_src != null ? Number(srcs.rows[0].avg_src) : null } : null,
        feedback: { total: fb.total || 0, helpful: fb.helpful || 0,
                    rate: fb.total ? +(fb.helpful / fb.total).toFixed(3) : null },
        learnedCases: cases, model };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/assist/enabled', async (req, res) => {
  try { res.json({ enabled: !!(await assist.getConfig()).enabled }); }
  catch (e) { res.json({ enabled: true }); }   // fail open: widget shows, chat call reports the real error
});
app.get('/api/assist/config', requireCap('manageSync'), requireRoot('assist_config'), async (req, res) => {
  try { res.json(await assist.getConfig()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/assist/config', requireCap('manageSync'), requireRoot('assist_config'), async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    ['enabled', 'ollamaUrl', 'model', 'timeoutMs'].forEach(k => { if (k in b) patch[k] = b[k]; });
    const next = await assist.setConfig(patch);
    await audit(req, 'assist.config', null, { enabled: next.enabled, model: next.model });
    res.json(next);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/assist/ping', requireCap('manageSync'), requireRoot('assist_config'), async (req, res) => {
  try { res.json(await assist.ping()); } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- ChatOps (Slack/Teams) + on-call escalation config ---- */
function chatopsPublic(c) {
  // never leak the WhatsApp bearer token to the client; expose a "configured" flag instead
  const { waToken, ...rest } = c;
  return { ...rest, slackConfigured: !!c.slackUrl, teamsConfigured: !!c.teamsUrl,
    whatsappConfigured: !!(c.waPhoneId && waToken && c.waTo), waTokenSet: !!waToken,
    smsConfigured: require('./sms').smsConfigured() };   // SMS provider creds live in server env
}
app.get('/api/chatops', requireCap('manageSync'), async (req, res) => {
  try { res.json(chatopsPublic(await chatops.getConfig())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/chatops', requireCap('manageSync'), async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    // waBaseUrl = the 115:8089 nginx relay (152 has no internet) — it was missing from this
    // whitelist, so the settings form saved it and the server silently dropped it.
    ['enabled', 'slackUrl', 'teamsUrl', 'minSeverity', 'baseUrl', 'waPhoneId', 'waToken', 'waTo', 'waTemplate', 'waTemplateLang', 'waGroupId', 'waApiVersion', 'waBaseUrl', 'smsEnabled', 'smsTo', 'smsMinSeverity'].forEach(k => { if (k in b) patch[k] = b[k]; });
    const next = await chatops.setConfig(patch);
    await audit(req, 'chatops.config', null, { enabled: next.enabled, minSeverity: next.minSeverity, slack: !!next.slackUrl, teams: !!next.teamsUrl, whatsapp: !!(next.waPhoneId && next.waToken && next.waTo) });
    res.json(chatopsPublic(next));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/chatops/test', requireCap('manageSync'), async (req, res) => {
  try {
    const sample = { id: 0, name: 'Test alert — ChatOps wiring', severity: (req.body || {}).severity || 'P2', team: 'Digital Ops',
      metric_key: 'payment_success_rate', operator: 'lt', threshold: 0.95, observed_value: 0.912, sample: 340, window_hours: 1,
      unit: 'rate', message: 'This is a test notification from the Salam console.' };
    const out = await chatops.notifyIncident(sample, { kind: 'test' });
    await audit(req, 'chatops.test', null, { channels: out.channels });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/escalation', requireCap('manageSync'), async (req, res) => {
  try { res.json(await escalation.getConfig()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/escalation', requireCap('manageSync'), async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if ('enabled' in b) patch.enabled = !!b.enabled;
    if ('policies' in b) patch.policies = b.policies;
    const next = await escalation.setConfig(patch);
    await audit(req, 'escalation.config', null, { enabled: next.enabled });
    res.json(next);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// who is currently on-call for a tier role (for the settings preview)
app.get('/api/escalation/oncall', requireCap('manageSync'), async (req, res) => {
  try { res.json({ tier: req.query.tier, people: await escalation.onCall(req.query.tier) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- shared navigation config (tab order + visibility) ----
 * Everyone reads it (so both boards render the shared layout); only super-admins
 * (manageUsers) can change it. Shape:
 *   { analytics: { catOrder:[names], catHidden:[names], dashHidden:[keys] },
 *     errors:    { order:[categoryKeys], hidden:[categoryKeys] } }               */
app.get('/api/ui-nav', async (req, res) => {
  try { res.json((await settings.getSetting('ui_nav')) || {}); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/ui-nav', requireCap('customizeDashboard'), async (req, res) => {
  try {
    const b = req.body || {};
    const clean = a => Array.isArray(a) ? a.filter(x => typeof x === 'string') : [];
    const cleanMap = o => { const out = {}; if (o && typeof o === 'object') for (const k of Object.keys(o)) out[k] = clean(o[k]); return out; };
    const a = b.analytics || {};
    const next = {
      analytics: {
        catOrder:  clean(a.catOrder),
        catHidden: clean(a.catHidden),
        dashHidden: clean(a.dashHidden),
        dashOrder: cleanMap(a.dashOrder)
      },
      errors: {
        order:  clean(b.errors && b.errors.order),
        hidden: clean(b.errors && b.errors.hidden)
      }
    };
    await settings.setSetting('ui_nav', next);
    await audit(req, 'uinav.config', null, {
      anaHidden: next.analytics.catHidden.length + next.analytics.dashHidden.length,
      errHidden: next.errors.hidden.length
    });
    res.json(next);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* ---- Semati synthetic canary (read-only active probe) ---- */
app.get('/api/probe/semati', requireCap('manageSync'), (req, res) => {
  try { res.json(require('./sematiProbe').status()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/probe/semati/run', requireCap('manageSync'), async (req, res) => {
  try { res.json(await require('./sematiProbe').probeOnce()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// full list of Troubleshoot error categories (incl. those with zero current failures) — for the editor
app.get('/api/errors/categories', async (req, res) => {
  try {
    res.json({ categories: Object.entries(errors.CATEGORIES).map(([category, v]) => ({ category, label: v.label, team: v.team })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- anomaly detection ---- */
app.get('/api/anomalies', async (req, res) => {
  try {
    let now = req.query.now;
    if (!now) { try { const b = await dataBounds(); now = b.hi; } catch (e) { now = new Date().toISOString(); } }
    const out = await anomaly.scan(now);
    let gws = []; try { gws = (await anomaly.scanGateways(now)).map(g => ({ ...g, kind: 'gateway_drop', direction: 'down', text: anomaly.describeGateway(g) })); } catch (e) {}
    const anomalies = [...gws, ...out.anomalies.map(a => ({ ...a, text: anomaly.describe(a) }))];
    res.json({ ...out, anomalies });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/anomaly/config', requireCap('manageSync'), async (req, res) => {
  try { res.json(await anomaly.getConfig()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/anomaly/config', requireCap('manageSync'), async (req, res) => {
  try {
    const b = req.body || {}; const patch = {};
    ['enabled', 'z', 'minSample', 'lookbackWeeks', 'volFloor', 'raiseAlerts', 'gatewayAlerts'].forEach(k => { if (k in b) patch[k] = b[k]; });
    const next = await anomaly.setConfig(patch);
    await audit(req, 'anomaly.config', null, next);
    res.json(next);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- anomaly signals as first-class, individually-configurable "rules" ----
 * Each seasonal signal (<journey>.volume / .failure_rate) and gateway family (gw.*) can be
 * enabled/disabled and re-tuned (sensitivity z, lookback window, min sample, volume floor,
 * severity cap) on its own — the anomaly-engine equivalent of editing a row in alert_rules. */
app.get('/api/anomaly/rules', requireCap('editRules'), async (req, res) => {
  try {
    const cfg = await anomaly.getConfig();
    res.json({ global: cfg, signals: anomaly.listSignals(cfg) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/anomaly/rules/:sig', requireCap('editRules'), async (req, res) => {
  try {
    const b = req.body || {}; const patch = {};
    if (b.reset) patch.reset = true;
    else ['enabled', 'z', 'minSample', 'lookbackWeeks', 'volFloor', 'maxSeverity'].forEach(k => { if (k in b) patch[k] = b[k]; });
    const next = await anomaly.setSignal(req.params.sig, patch);
    await audit(req, 'anomaly.signal', req.params.sig, { sig: req.params.sig, patch });
    res.json({ ok: true, signal: req.params.sig, override: (next.signals || {})[req.params.sig] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- live updates (SSE): push a 'refreshed' event to every open console after each sync ---- */
const sseClients = new Set();
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (res.flushHeaders) res.flushHeaders();
  res.write('retry: 10000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(`event: ping\ndata: ${Date.now()}\n\n`); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});
function sseBroadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload || {})}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch (e) { sseClients.delete(res); } }
}

/* ---- reliability ops ---- */
app.get('/api/ready', async (req, res) => { const r = await reliability.ready(); res.status(r.ok ? 200 : 503).json(r); });
app.get('/api/version', (req, res) => res.json({ ...reliability.version(),
  console: 'unified', publicUrl: process.env.CONSOLE_PUBLIC_URL || null,
  fixedEnabled: roles.FIXED_ENABLED, fixedViews: roles.FIXED_VIEWS,
  pools: { upg: db.upgConfigured, ops: db.opsConfigured, opsBeta: db.opsBetaConfigured, nexus: db.nexusConfigured, payments: db.paymentsConfigured } }));
app.get('/api/errors/log', requireCap('manageUsers'), async (req, res) => {
  try {
    const rows = (await C.query(`SELECT id, at, level, message, route, actor, ip FROM console_errors ORDER BY at DESC LIMIT 200`)).rows;
    res.json({ errors: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/metrics/latest', async (req, res) => {
  const rows = (await C.query(`
    SELECT DISTINCT ON (metric_key, window_hours, dim)
      metric_key, window_hours, dim, value, sample, sim_now
    FROM metric_snapshots
    WHERE sim_now = (SELECT max(sim_now) FROM metric_snapshots)
    ORDER BY metric_key, window_hours, dim`)).rows;
  res.json({ snapshots: rows });
});

app.get('/api/metrics/series', async (req, res) => {
  const { key, window = 3 } = req.query;
  const rows = (await C.query(
    `SELECT sim_now, value, sample FROM metric_snapshots
     WHERE metric_key=$1 AND window_hours=$2 AND dim='{}'::jsonb
     ORDER BY sim_now`, [key, window])).rows;
  res.json({ key, window: Number(window), points: rows });
});

app.post('/api/sync', requireCap('manageSync'), async (req, res) => {
  try {
    let simNow = req.body && req.body.sim_now ? new Date(req.body.sim_now) : new Date();
    // on the static dump, clamp real-now past the data end to the last data point
    if (!req.body || !req.body.sim_now) {
      try { const b = await dataBounds(); if (simNow > new Date(b.hi)) simNow = new Date(b.hi); } catch (e) {}
    }
    const s = await syncOnce(simNow);
    const a = await runAlerts(simNow);
    respCache.invalidate();   // new data landed → next dashboard read recomputes
    // keep hourly rollups current around the advanced window (best-effort, bounded)
    try { await rollups.refresh(new Date(simNow.getTime() - 12 * 3600e3).toISOString(), new Date(simNow.getTime() + 3600e3).toISOString()); } catch (e) {}
    // anomaly pass (may open incidents that then post + escalate like any other)
    let anomalies = null;
    try { anomalies = await anomaly.detectAndRaise((a.simNow || simNow).toISOString ? (a.simNow || simNow).toISOString() : (a.simNow || simNow)); } catch (e) { anomalies = { error: e.message }; }
    let mailed = null, posted = null;
    // auto-email the digest + push newly-opened incidents to Slack/Teams (best-effort; never blocks the response)
    if (a.opened > 0 || (anomalies && anomalies.opened > 0)) {
      try { mailed = await notify.sendAlertDigest(a.simNow || simNow, a.evals); } catch (e) { mailed = { sent: false, error: e.message }; }
      try { posted = await postNewIncidents(a.simNow || simNow); } catch (e) { posted = { error: e.message }; }
    }
    try { sseBroadcast('refreshed', { ts: Date.now(), sim_now: simNow.toISOString(), rows: (s && s.rows) || 0, opened: a.opened }); } catch (e) {}
    res.json({ sim_now: simNow.toISOString(), opened: a.opened, resolved: a.resolved, updated: a.updated, ...s, mailed, posted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/simulate', requireCap('manageSync'), async (req, res) => {
  try {
    const { stepHours = 3, steps = 56, fromIso, toIso } = req.body || {};
    const out = await simulate({ stepHours, steps, fromIso, toIso });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/rules/:id', requireCap('editRules'), async (req, res) => {
  const b = req.body || {};
  const allowed = ['enabled', 'name', 'description', 'metric_key', 'operator', 'threshold',
    'window_hours', 'min_sample', 'team', 'severity', 'channel', 'active_from', 'active_to', 'runbook', 'trigger_codes'];
  if (b.metric_key != null && !METRICS[b.metric_key]) return res.status(400).json({ error: 'unknown metric_key' });
  const sets = [], vals = [];
  for (const k of allowed) if (b[k] !== undefined) { vals.push(b[k]); sets.push(`${k}=$${vals.length}`); }
  if (b.dim !== undefined) { vals.push(JSON.stringify(b.dim || {})); sets.push(`dim=$${vals.length}`); }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  await C.query(`UPDATE alert_rules SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length}`, vals);
  await audit(req, 'rule.update', req.params.id, b);
  res.json({ ok: true });
});

// firing history + config-change log for one rule
app.get('/api/rules/:id/history', async (req, res) => {
  try {
    const rule = (await C.query(`SELECT * FROM alert_rules WHERE id=$1`, [req.params.id])).rows[0];
    if (!rule) return res.status(404).json({ error: 'rule not found' });
    const fires = (await C.query(
      `SELECT status, observed_value, sample, threshold, operator, window_hours, message,
              fired_at, last_seen_at, resolved_at, peak_value, breach_count
       FROM alerts WHERE rule_key=$1 ORDER BY fired_at DESC LIMIT 100`, [rule.key])).rows;
    const changes = (await C.query(
      `SELECT actor, role, action, detail, at AS created_at FROM audit_log
       WHERE action LIKE 'rule.%' AND (target=$1 OR target=$2) ORDER BY at DESC LIMIT 50`,
      [rule.key, String(rule.id)])).rows;
    res.json({ rule: { id: rule.id, key: rule.key, name: rule.name }, fires, changes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// build + send (or preview) the alert email digest — recipients = users with mail_alert on.
// TEST MODE (safe to run any time):
//   body.fire = <rule key or metric_key>  → that eval is marked as firing so the intro, the
//     deep link and the attached PDF report can all be inspected without a real incident
//   body.to   = "you@salam.sa"            → mail ONLY that address, subject prefixed [TEST]
// Simulation without `to` is refused: a fabricated alert must never reach the distribution list.
app.post('/api/alerts/notify', requireCap('manageSync'), async (req, res) => {
  try {
    const simNow = await boardNow(req.body && req.body.sim);
    const { evals } = await evaluate(simNow);
    const fire = req.body && req.body.fire;
    if (fire) {
      if (!req.body.to) return res.status(400).json({ error: 'simulation requires "to" — a test alert must not mail the whole list' });
      const ev = evals.find(e => e.key === fire) || evals.find(e => e.metric_key === fire);
      if (!ev) return res.status(400).json({ error: `no enabled rule matches "${fire}"` });
      ev.fired = true; ev.simulated = true;
      if (ev.value == null) { ev.value = ev.threshold; ev.sample = ev.min_sample || 1; ev.counts = 'SIMULATED for mail test'; }
    }
    const out = await notify.sendAlertDigest(simNow, evals, { to: req.body && req.body.to });
    await audit(req, 'alert.notify', null, { sent: out.sent, firing: out.firing, recipients: out.recipients,
      test_to: (req.body && req.body.to) || null, simulated_rule: fire || null });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// plan catalog — id / optiva_reference → EN/AR name (for "ID - Name" labels across the UI)
// (the /api/plans route lives further down — it returns id + "id - Name" label from the jsonb title;
//  an older label-less duplicate used to shadow it here, which is why the dropdown showed bare ids.)

// Home dashboard — global KPIs over an explicit [from,to) window. Always computed from RAW
// source tables so the strip matches the analytics panels exactly (no rollup lag/drift).
// Default window (no from/to) = today since 00:00 KSA.
async function homeKpisFromSource(now, winFrom, winTo) {
  const S = db.source;
  const n = now || new Date().toISOString();
  let from = winFrom, to = winTo || n;
  if (!from) {                                   // default: today since KSA midnight
    const ksaNow = new Date(new Date(n).getTime() + 3 * 3600e3);
    from = new Date(Date.UTC(ksaNow.getUTCFullYear(), ksaNow.getUTCMonth(), ksaNow.getUTCDate()) - 3 * 3600e3).toISOString();
    to = n;
  }
  const win = `created_at >= $1::timestamptz AND created_at < $2::timestamptz`;
  const c = (sql) => S.query(sql, [from, to]).then(r => Number(r.rows[0].c)).catch(() => null);
  const [orders, paidOk, paidFail, actOk, actFail, nafOk, nafTotal, nafFailed, deliv, planOk, planFail, checkouts, eligOk, delivDone] = await Promise.all([
    c(`SELECT count(*) c FROM onboarding_orders WHERE ${win}`),
    c(`SELECT count(*) c FROM payments WHERE status='success' AND ${win}`),
    c(`SELECT count(*) c FROM payments WHERE status IN ('fail','failed') AND ${win}`),
    c(`SELECT count(*) c FROM activation_logs WHERE state=true AND ${win}`),
    c(`SELECT count(*) c FROM activation_logs WHERE state=false AND ${win}`),
    c(`SELECT count(*) c FROM nafath_logs WHERE lower(status)='completed' AND ${win}`),
    c(`SELECT count(*) c FROM nafath_logs WHERE ${win}`),
    c(`SELECT count(*) c FROM nafath_logs WHERE lower(status) IN ('expired','rejected','failed','denied','cancelled') AND ${win}`),
    c(`SELECT count(*) c FROM delivery_requests WHERE ${win}`),
    c(`SELECT count(*) c FROM change_plan_logs WHERE status=1 AND ${win}`),
    c(`SELECT count(*) c FROM change_plan_logs WHERE status=2 AND ${win}`),
    c(`SELECT count(*) c FROM checkouts WHERE ${win}`),
    // successes for the "API call outcomes" gauge — same sources errors.summary() draws its
    // failures from (activation+semati, eligibility, nafath, payments, delivery, change_plan)
    c(`SELECT count(*) c FROM eligibility_logs WHERE state=true AND ${win}`),
    c(`SELECT count(*) c FROM delivery_requests WHERE delivery_state = ANY('{${FLOW_DEL_DONE.join(',')}}') AND ${win}`)
  ]);
  const nafPending = (nafTotal != null && nafOk != null && nafFailed != null) ? Math.max(0, nafTotal - nafOk - nafFailed) : null;
  let errorsToday = null, errorsBusiness = null, errorsTechnical = null;
  try {
    const wHours = Math.max(0.02, (new Date(to) - new Date(from)) / 3600e3);   // errors.summary works off (now - wHours, now]
    const sum = await errors.summary({ now: to, windowHours: wHours });
    errorsToday = sum.reduce((a, t) => a + (t.total || 0), 0);
    // Business vs Technical split (errclass via errors.summary — same sources as the total, so
    // errorsBusiness + errorsTechnical always reconciles with errorsToday)
    errorsBusiness = sum.reduce((a, t) => a + (t.business || 0), 0);
    errorsTechnical = sum.reduce((a, t) => a + (t.technical || 0), 0);
  } catch (e) {}
  // "API call outcomes" gauges (Grafana-style): success = the successful calls over the SAME
  // window and sources errors.summary() covers; business/technical = the errclass split above.
  let apiOutcomes = null;
  if (errorsBusiness != null && errorsTechnical != null) {
    const success = [actOk, eligOk, nafOk, paidOk, delivDone, planOk].reduce((a, v) => a + (v || 0), 0);
    apiOutcomes = { success, business: errorsBusiness, technical: errorsTechnical };
  }
  // previous equal-length window (immediately before) → "vs previous" deltas
  let prev = null;
  try {
    const span = new Date(to) - new Date(from); const pf = new Date(new Date(from).getTime() - span).toISOString();
    const pc = (sql) => S.query(sql, [pf, from]).then(r => Number(r.rows[0].c)).catch(() => null);
    const [po, pco, ppo, pao, pno, pd, ppl] = await Promise.all([
      pc(`SELECT count(*) c FROM onboarding_orders WHERE ${win}`),
      pc(`SELECT count(*) c FROM checkouts WHERE ${win}`),
      pc(`SELECT count(*) c FROM payments WHERE status='success' AND ${win}`),
      pc(`SELECT count(*) c FROM activation_logs WHERE state=true AND ${win}`),
      pc(`SELECT count(*) c FROM nafath_logs WHERE lower(status)='completed' AND ${win}`),
      pc(`SELECT count(*) c FROM delivery_requests WHERE ${win}`),
      pc(`SELECT count(*) c FROM change_plan_logs WHERE status=1 AND ${win}`)
    ]);
    prev = { orders: po, checkouts: pco, paidOk: ppo, actOk: pao, nafOk: pno, deliveries: pd, planOk: ppl };
  } catch (e) {}
  // sparklines from hourly rollups (cheap; trend shape only)
  let spark = null;
  try {
    const sr = (await C.query(`SELECT journey, outcome, hour, sum(cnt)::int c FROM rollup_hourly WHERE hour>=$1 AND hour<$2 GROUP BY 1,2,3 ORDER BY hour`, [from, to])).rows;
    if (sr.length) {
      const hs = [...new Set(sr.map(r => +new Date(r.hour)))].sort((a, b) => a - b); const ix = new Map(hs.map((h, i) => [h, i]));
      const mk = pred => { const a = new Array(hs.length).fill(0); sr.forEach(r => { if (pred(r)) a[ix.get(+new Date(r.hour))] += r.c; }); return a; };
      spark = { orders: mk(r => r.journey === 'onboarding'), checkouts: mk(r => r.journey === 'checkout'),
        paidOk: mk(r => r.journey === 'payment' && r.outcome === 'ok'), actOk: mk(r => (r.journey === 'activation' || r.journey === 'semati') && r.outcome === 'ok'),
        nafOk: mk(r => r.journey === 'nafath' && r.outcome === 'ok'), deliveries: mk(r => r.journey === 'delivery'),
        planOk: mk(r => r.journey === 'change_plan' && r.outcome === 'ok'), errors: mk(r => r.outcome === 'fail') };
    }
  } catch (e) {}
  const rate = (ok, fail) => (ok != null && fail != null && (ok + fail) > 0) ? ok / (ok + fail) : null;
  const targets = { payment: 0.95, activation: 0.98 };   // SLA thresholds for KPI coloring (fall back to defaults)
  try { (await C.query(`SELECT journey, target FROM slo_targets WHERE journey IN ('payment','activation')`)).rows.forEach(r => { targets[r.journey] = Number(r.target); }); } catch (e) {}
  // ksaDay must be a plain ISO date (YYYY-MM-DD) — computed arithmetically, NOT via
  // toLocaleDateString('en-CA'): Node on 152 has limited ICU and silently falls back to US
  // format ("8/5/2026"), which never equals the browser's ISO string → the "no data yet for
  // today (replica behind)" warning showed permanently even when the data was current.
  return { now: n, from, to, source: 'raw',
    ksaDay: new Date(new Date(n).getTime() + 3 * 3600e3).toISOString().slice(0, 10),
    orders, checkouts, paidOk, paidFail, payRate: rate(paidOk, paidFail),
    actOk, actFail, actRate: rate(actOk, actFail), nafOk, nafPending, nafFailed, deliveries: deliv, planOk, planFail, errorsToday, errorsBusiness, errorsTechnical, apiOutcomes, targets, prev, spark };
}
app.get('/api/home', async (req, res) => {
  try {
    const now = await boardNow(req.query.sim);
    let from = null, to = null;
    const okDate = s => s && !isNaN(new Date(s).getTime());
    if (okDate(req.query.from) && okDate(req.query.to) && new Date(req.query.from) < new Date(req.query.to)) {
      from = new Date(req.query.from).toISOString(); to = new Date(req.query.to).toISOString();
      if ((new Date(to) - new Date(from)) > 400 * 24 * 3600e3) from = new Date(new Date(to).getTime() - 400 * 24 * 3600e3).toISOString();
    } else if (req.query.hours) {
      const h = Math.min(400 * 24, Math.max(1, Number(req.query.hours) || 24));
      to = now; from = new Date(new Date(now).getTime() - h * 3600e3).toISOString();
    }
    // ~24 count(*) over multi-million-row tables (5–8s on 30d). Cached + stale-while-revalidate:
    // only the first caller after a sync pays; everyone else is instant. See respCache.js.
    res.json(await respCache.wrap(req, () => homeKpisFromSource(now, from, to)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Onboarding funnel with step-to-step drop-off: orders → eligibility → completed → activated
app.get('/api/funnel', async (req, res) => {
  try {
    const now = await boardNow(req.query.sim);
    const nISO = now && now.toISOString ? now.toISOString() : (now || new Date().toISOString());
    let from = req.query.from, to = req.query.to;
    const okDate = s => s && !isNaN(new Date(s).getTime());
    if (okDate(from) && okDate(to)) { from = new Date(from).toISOString(); to = new Date(to).toISOString(); }
    else { const k = new Date(new Date(nISO).getTime() + 3 * 3600e3); from = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 3 * 3600e3).toISOString(); to = nISO; }
    const params = [from, to]; let chSql = '';
    if (req.query.channel === '0' || req.query.channel === '1') { params.push(Number(req.query.channel)); chSql = ` AND number_order_type=$${params.length}`; }
    if (req.query.plan_type) { const code = /post/i.test(req.query.plan_type) ? 2 : /pre/i.test(req.query.plan_type) ? 1 : null;  // 1=prepaid, 2=postpaid
      if (code != null) { params.push(code); chSql += ` AND plan_id::text IN (SELECT id::text FROM plans WHERE plan_type = $${params.length})`; } }
    res.json(await respCache.wrap(req, async () => {
      const r = (await db.source.query(
        `SELECT count(*)::int orders,
                count(*) FILTER (WHERE is_eligible)::int eligible,
                count(*) FILTER (WHERE completed)::int completed,
                count(*) FILTER (WHERE activated)::int activated
         FROM onboarding_orders WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz${chSql}`, params)).rows[0];
      return { steps: [
        { key: 'orders', label: 'Orders', n: r.orders },
        { key: 'eligible', label: 'Eligibility pass', n: r.eligible },
        { key: 'completed', label: 'Completed (paid)', n: r.completed },
        { key: 'activated', label: 'Activated', n: r.activated }
      ] };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* Onboarding order-status flow tree — two lanes (New SIM / MNP), each cascading
 * Eligibility → Payment status → SIM type → Delivery status. Same window logic as the funnel. */
const FLOW_DEL_DONE = ['complete', 'completed', 'DELIVERED', 'DL', 'DEX09', 'POD', 'Delivered', 'delivered'];
const FLOW_PRED = {
  orders: 'TRUE', total: 'TRUE',
  /* PRE-ELIGIBILITY vs ELIGIBILITY FAIL — the split L2 kept tripping over.
   * is_eligible DEFAULTS TO FALSE at order creation (proven live: the App-screens funnel showed
   * "no drop" between Plans and ID check because is_eligible IS NOT NULL matched everything).
   * So "NOT eligible" swept every browser who picked a plan and left into "Eligibility Fail".
   * The real verdict only exists once the customer SUBMITTED the ID form (National ID +
   * nationality — step 3 of both app flows). id_submitted = nationality_id_number present:
   *   pre_elig  = never submitted the ID form (browsing / plan / number selection drop-off)
   *   elig_fail = submitted AND the check answered NO — a true refusal */
  // AND NOT eligible makes the three children provably disjoint: without it an order that is
  // eligible but has no ID captured would count in BOTH pre_elig and elig_pass. Live data has
  // never contained that shape (the tree balances), but the predicate now forbids it outright.
  pre_elig: 'NOT id_submitted AND NOT eligible',
  elig_pass: 'eligible', elig_fail: 'id_submitted AND NOT eligible',
  total_payment: `eligible AND pay<>'none'`,
  // Eligible but NO payment record → dropped out before paying (abandoned at the payment step, or not
  // paid yet). Without this box these orders vanished between Eligibility Pass and Total Payment, which
  // looked like the tree was losing orders. Now elig_pass fully partitions: total_payment + no_payment.
  no_payment: `eligible AND pay='none'`,
  pay_success: `eligible AND pay='success'`, pay_pending: `eligible AND pay='pending'`, pay_fail: `eligible AND pay='fail'`,
  // Every post-payment node carries `eligible` so it stays a strict subset of pay_success
  // (= eligible AND pay='success'). Without it a paid-but-ineligible order would show in eSIM/Physical
  // but not in the Success Payment box above → the row wouldn't reconcile. (Proven by verify-flow.cjs.)
  esim: `eligible AND pay='success' AND esim`, physical: `eligible AND pay='success' AND NOT esim`,
  esim_activated: `eligible AND pay='success' AND esim AND activated`, esim_not_activated: `eligible AND pay='success' AND esim AND NOT activated`,
  assigned: `eligible AND pay='success' AND NOT esim AND assigned`,
  // Off the physical branch, a paid order with NO delivery_requests row is one of three things:
  //  • SHOP PICKUP — reseller order, apollo_require_delivery=false → delivery deliberately skipped,
  //    customer collects in the tygo shop. Legitimate, no courier owed. (shop_deliv = flag false.)
  //  • COURIER NOT CREATED — reseller order that DID require courier (flag true/absent) but no
  //    delivery request exists. Backend (commit_worker) uses the SAME oto/tam carriers for resellers,
  //    so this is a real dispatch backlog, NOT self-fulfilment. Verified on live data 2026-08-10.
  //  • NOT ASSIGNED — every other paid physical order with no courier row (our own backlog).
  shop_pickup: `eligible AND pay='success' AND NOT esim AND NOT assigned AND partner AND shop_deliv`,
  courier_not_created: `eligible AND pay='success' AND NOT esim AND NOT assigned AND partner AND NOT shop_deliv`,
  not_assigned: `eligible AND pay='success' AND NOT esim AND NOT assigned AND NOT partner`,
  delivered: `eligible AND pay='success' AND NOT esim AND assigned AND delivered`, not_delivered: `eligible AND pay='success' AND NOT esim AND assigned AND NOT delivered`,
  phys_activated: `eligible AND pay='success' AND NOT esim AND assigned AND delivered AND activated`, phys_not_activated: `eligible AND pay='success' AND NOT esim AND assigned AND delivered AND NOT activated`
};
/* Classify ONE order into the deepest flow node it currently sits in ("where it stopped/ended").
 * Compiles the SAME FLOW_PRED strings to JS (single source of truth — can't drift from the tree) and
 * returns the deepest matching node. Tree order shallow→deep; we scan deepest-first and take the first
 * hit. An eligible order with no payment lands on elig_pass ("passed eligibility, awaiting payment"). */
const _flowToJS = e => e
  .replace(/\bpay\s*<>\s*'([a-z]+)'/gi, "pay!=='$1'").replace(/\bpay\s*=\s*'([a-z]+)'/gi, "pay==='$1'")
  .replace(/\bNOT\b/gi, '!').replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||').replace(/\bTRUE\b/gi, 'true');
const _FLOW_VARS = ['eligible', 'esim', 'activated', 'assigned', 'delivered', 'partner', 'shop_deliv', 'pay', 'id_submitted'];
const _FLOW_FN = {};
for (const [k, e] of Object.entries(FLOW_PRED)) { try { _FLOW_FN[k] = new Function(..._FLOW_VARS, `return (${_flowToJS(e)});`); } catch (_) { } }
const _FLOW_DEPTH = ['total', 'pre_elig', 'elig_fail', 'elig_pass', 'no_payment', 'total_payment', 'pay_fail', 'pay_pending', 'pay_success',
  'esim', 'physical', 'esim_not_activated', 'esim_activated', 'not_assigned', 'courier_not_created', 'shop_pickup',
  'assigned', 'not_delivered', 'delivered', 'phys_not_activated', 'phys_activated'];
function classifyFlow(o) {
  const args = [o.eligible, o.esim, o.activated, o.assigned, o.delivered, o.partner, o.shop_deliv, o.pay, o.id_submitted];
  for (let i = _FLOW_DEPTH.length - 1; i >= 0; i--) { const k = _FLOW_DEPTH[i]; if (_FLOW_FN[k] && _FLOW_FN[k](...args)) return k; }
  return 'total';
}
const FLOW_CTE = extra => `WITH o AS (
  SELECT ((oo.number_order_type=1) IS TRUE) AS is_mnp, oo.is_eligible AS eligible, (oo.sim_type=1) AS esim, oo.activated AS activated,
    (NULLIF(trim(oo.nationality_id_number),'') IS NOT NULL) AS id_submitted, ${extra || ''}
    (SELECT CASE WHEN bool_or(p.status='success') THEN 'success'
                 WHEN bool_or(p.status='pending') THEN 'pending'
                 WHEN bool_or(p.status IN ('fail','failed')) THEN 'fail' ELSE 'none' END
       FROM payments p WHERE p.payment_on_type='OnboardingOrder' AND p.payment_on_id = oo.id::text) AS pay,
    -- Attribution comes from the order's OWN stamped origin (external_service_name), never from
    -- plan_channels — that table says which channels MAY sell a plan and fans one order out across
    -- all of them. See the reseller-channel note further down.
    (lower(coalesce(oo.external_service_name,'')) = ANY($4::text[])) AS partner,
    -- Shop pickup: apollo/reseller orders where apollo_require_delivery is EXPLICITLY false. Backend
    -- (commit_worker.rb) SKIPS delivery creation only when the flag == false → no delivery_requests
    -- row, customer collects at the reseller (tygo) shop. Default/absent = true = couriered via
    -- oto/tam (same partners+flow as everyone), so those go through Assigned→Delivered, NOT here.
    (lower(coalesce(oo.extra->>'apollo_require_delivery','')) IN ('false','f','0')) AS shop_deliv,
    EXISTS(SELECT 1 FROM delivery_requests d WHERE d.delivery_on_id = oo.id::text) AS assigned,
    EXISTS(SELECT 1 FROM delivery_requests d WHERE d.delivery_on_id = oo.id::text AND d.delivery_state = ANY($3)) AS delivered
  FROM onboarding_orders oo
  WHERE oo.created_at >= $1::timestamptz AND oo.created_at < $2::timestamptz
    AND ($5::text IS NULL OR oo.plan_id::text = $5::text)            -- $5 = optional plan_id filter
    AND ($6::text IS NULL OR oo.nationality_id_number = $6           -- $6 = optional identifier (nid), $7 = msisdn forms
         OR oo.mobile_number = ANY($7::text[]))
    AND ($8::text IS NULL OR lower(coalesce(oo.external_service_name,'')) = $8) )`;   // $8 = channel (TKT-000012; 'salam' → '')
// pull the optional plan filter off the request (numeric plans.id as text, or null for "all")
/* TKT-000012 — onboarding source segregation. The order's stamped origin is
 * external_service_name ('' = Salam app/web, 'tygo', 'soob', future resellers appear on their
 * own). 'salam' from the client maps to the empty string; null = all channels. */
const flowChannel = req => { const c = (req.query && req.query.channel || '').trim().toLowerCase();
  return c === '' || c === 'all' ? null : (c === 'salam' ? '' : c); };
const flowPlan = req => { const p = req.query && req.query.plan; const s = (p == null ? '' : String(p)).trim(); return s === '' ? null : s; };
// pull the optional MSISDN / national-id filter → { key, forms } (forms = all MSISDN spellings). This
// filters the WHOLE tree to one customer's order(s) so you can watch it flow end-to-end box by box.
const flowKey = req => {
  const k = (req.query && req.query.key != null ? String(req.query.key) : '').trim();
  if (!k) return { key: null, forms: null };
  const d = k.replace(/\D/g, '');
  const forms = /^(?:966|0)?5\d{8}$/.test(d) ? (l9 => ['0' + l9, '966' + l9, l9, '+966' + l9])(d.slice(-9)) : [k];
  return { key: k, forms };
};
function flowWindow(req, now) {
  const nISO = now && now.toISOString ? now.toISOString() : (now || new Date().toISOString());
  let from = req.query.from, to = req.query.to; const okDate = s => s && !isNaN(new Date(s).getTime());
  if (okDate(from) && okDate(to)) return [new Date(from).toISOString(), new Date(to).toISOString()];
  const k = new Date(new Date(nISO).getTime() + 3 * 3600e3);
  return [new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 3 * 3600e3).toISOString(), nISO];
}
// Plan catalog for the flow-tree filter dropdown: "id - EN / AR", read straight from the jsonb title
// (title->>'en'/'ar') so it never depends on client-side name resolution. Enabled plans only (indexed,
// fast) — that's the sellable set; avoids a wall of dead plans and a heavy DISTINCT scan on 8M orders.
/* Plan list FOR THE ORDER-FLOW FILTER (TKT-000007): unlike /api/plans (labels everywhere,
 * enabled-only), this returns EVERY plan that is enabled OR has orders in the window, with the
 * enabled flag (green/grey dot), the price, and the per-plan order count for the same window
 * the tree shows — so "(12)" beside a plan always reconciles with what selecting it displays. */
app.get('/api/plans/flow', async (req, res) => {
  try {
    const from = new Date(req.query.from), to = new Date(req.query.to || Date.now());
    if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'from/to required (ISO)' });
    const rows = (await db.source.query(
      `SELECT p.id, p.title->>'en' AS en, p.title->>'ar' AS ar, p.price, p.enabled,
              coalesce(o.n, 0)::int AS n
         FROM plans p
         LEFT JOIN (SELECT plan_id, count(*)::int AS n FROM onboarding_orders
                     WHERE created_at >= $1 AND created_at < $2 GROUP BY 1) o ON o.plan_id = p.id
        WHERE p.enabled = true OR coalesce(o.n, 0) > 0
        ORDER BY coalesce(o.n, 0) DESC, p.id`, [from.toISOString(), to.toISOString()])).rows;
    res.json({ plans: rows.map(p => ({
      id: p.id, en: p.en || '', ar: p.ar || '', price: p.price,
      enabled: p.enabled === true, n: Number(p.n) || 0,
      label: [p.en, p.ar].filter(Boolean).join(' / ') || String(p.id),
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/plans', async (req, res) => {
  try {
    const rows = (await db.source.query(
      `SELECT p.id, p.title->>'en' AS en, p.title->>'ar' AS ar, p.price
         FROM plans p WHERE p.enabled = true ORDER BY p.id`)).rows;
    res.json({ plans: rows.map(p => {
      const nm = [p.en, p.ar].filter(Boolean).join(' / ');
      return { id: p.id, label: nm ? `${p.id} - ${nm}` : String(p.id), en: p.en || '', ar: p.ar || '', price: p.price };
    }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* SCREENS FLOW — per-SCREEN journey funnel for the dashboard "App screens flow" section.
 * Counts = customers whose data proves they REACHED the step backing each app screen (DB
 * milestones — the app has no screen-view telemetry). Journeys:
 *   not logged  → onboarding: New SIM lane + MNP lane (onboarding_orders + payments join)
 *   logged      → recharge lane (payments type 'recharge') + voucher mini-lane (API capture)
 * Same window convention as /api/onboarding-flow (from/to ISO, defaults to today-KSA). Cached. */
/* VOUCHER ERROR DRILL — everything behind the "Oops" screen: the per-code breakdown with the
 * message BSS returned, and the individual attempts (time, code, message, latency, gateway
 * transaction id) so a case can be followed end to end. Codes are the set confirmed by the
 * platform team on 20 Aug; note that success is "00" while FailedInBRM is "0". */
const VOUCHER_CODES = {
  '00': { msg: 'Success', cls: 'success' },
  '21': { msg: 'Voucher number does not exist / already reserved', cls: 'business' },
  '22': { msg: 'Voucher number marked used', cls: 'business' },
  '20': { msg: 'Invalid voucher number format', cls: 'business' },
  '9': { msg: 'Voucher recharge is blocked', cls: 'business' },
  '31': { msg: 'VOUCHER_RECHARGE service error 31', cls: 'technical' },
  '0': { msg: 'FailedInBRM — technical error', cls: 'technical' },
};
const vCls = (code, msg) => {
  if (/failedinbrm/i.test(msg || '')) return 'technical';
  if (String(code) === '00') return 'success';
  return (VOUCHER_CODES[String(code)] || {}).cls || 'business';
};
app.get('/api/screens-flow/voucher-errors', async (req, res) => {
  try {
    const [from, to] = flowWindow(req, new Date());
    const code = (req.query.code || '').trim();
    const P = [from, to];
    const codes = (await db.console.query(
      `SELECT coalesce(response_code,'—') code,
              coalesce(NULLIF(trim(response_message),''),'(no message)') msg,
              count(*)::int n, round(avg(duration_ms))::int avg_ms,
              max(ts) last_seen
       FROM api_traffic_events
       WHERE path ILIKE '%voucher%' AND ts >= $1 AND ts < $2
       GROUP BY 1, 2 ORDER BY n DESC`, P)).rows
      .map(r => ({ ...r, cls: vCls(r.code, r.msg) }));
    const total = codes.reduce((a, r) => a + r.n, 0);
    const failed = codes.filter(r => r.cls !== 'success').reduce((a, r) => a + r.n, 0);
    const rowsQ = code ? `${P.length + 1}` : null;
    if (code) P.push(code);
    const rows = (await db.console.query(
      `SELECT ts, host, path, transaction_id, coalesce(response_code,'—') code,
              coalesce(NULLIF(trim(response_message),''),'(no message)') msg,
              duration_ms, err_class
       FROM api_traffic_events
       WHERE path ILIKE '%voucher%' AND ts >= $1 AND ts < $2
         AND coalesce(response_code,'') <> '00'
         AND coalesce(response_message,'') NOT ILIKE '%success%'
         ${code ? `AND coalesce(response_code,'—') = $${rowsQ}` : ''}
       ORDER BY ts DESC LIMIT 250`, P)).rows
      .map(r => ({ ...r, cls: vCls(r.code, r.msg) }));
    res.json({ from, to, total, failed, codes, rows, filtered: code || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* Tap / UPG response-code reference — the official tables, always available (no internet on
 * 152). ?code=505 describes one code; without it the whole set is returned for the docs page. */
app.get('/api/tap-codes', (req, res) => {
  const tap = require('./tapCodes');
  const c = (req.query.code || '').trim();
  if (c) { const d = tap.describe(c); return d ? res.json(d) : res.status(404).json({ error: 'unknown code', code: c }); }
  const m = (req.query.message || '').trim();
  if (m) { const code = tap.codeFor(m); return code ? res.json(tap.describe(code)) : res.status(404).json({ error: 'unknown message' }); }
  res.json({ source: tap.source, tables: tap.tables() });
});

/* SINGLE SOURCE OF TRUTH for classifying a failed payment. Used by the screens-flow cards, by
 * the failure drill and by the payment reports, so the three can never tell different stories.
 *   reconciliation — the gateway captured it while our app says failed
 *   technical      — platform fault (generic "Failed", "Timed Out", …) per errclass
 *   business       — any answer the customer or their bank gave, INCLUDING a blank message
 *                    (Apple Pay / STC Pay return none by design; blank is not a fault)
 *   unknown        — no gateway record at all: the payment never reached UPG
 * The app stores no bank_message for salam/TAP payments, so `u` (the UPG row) is the reason. */
function classifyPayFailure(appReason, rail, u) {
  const st = String((u && u.status) || '').toUpperCase();
  const raw = (u && u.msg && u.msg !== '(no message)') ? u.msg : '';
  const msg = (appReason || raw || '').trim();
  if (u && ['PAID', 'CAPTURED', 'AUTHORIZED'].includes(st))
    return { reason: msg || 'Captured', cls: 'reconciliation' };
  if (!msg) {
    if (!u) return { reason: 'No gateway record (never reached UPG)', cls: 'unknown' };
    // no text, but the raw charge object often still carries a code — name it officially
    const d0 = u.code ? require('./tapCodes').describe(u.code) : null;
    if (d0) return { reason: d0.message, cls: d0.cls === 'technical' ? 'technical'
      : (d0.cls === 'success' ? 'reconciliation' : 'business'),
      code: d0.code, tapCls: d0.cls, tapMessage: d0.message, fromCode: true };
    return { reason: '(no acquirer message)', cls: 'business' };
  }
  // Resolve the OFFICIAL Tap code for this answer (from the payload, else by message) so the
  // console names it exactly as the gateway's own documentation does.
  const tap = require('./tapCodes');
  const code = (u && u.code && tap.describe(u.code)) ? String(u.code).trim() : tap.codeFor(msg);
  const dsc = code ? tap.describe(code) : null;
  if (dsc) {
    // Tap's taxonomy is finer than ours: 'config' (e.g. 506 Transaction Type Not Supported) is
    // not a platform fault, so it rolls up into BUSINESS for the headline — but it is carried
    // through as tapCls because it IS fixable by engineering, unlike a customer decline.
    const cls = dsc.cls === 'technical' ? 'technical'
      : (dsc.cls === 'success' ? 'reconciliation' : 'business');
    return { reason: msg, cls, code, tapCls: dsc.cls, tapMessage: dsc.message };
  }
  // "Abandoned" is the gateway's word for "the customer never engaged with the page" — a
  // customer outcome, not a platform fault. errclass has no rule for it, so state it here
  // (this is how the delivered payment catalog classifies it too).
  if (/abandon/i.test(msg)) return { reason: msg, cls: 'business', tapCls: 'customer' };
  const c = require('./errclass').classifyClass({ ok: false, response: msg }).cls;
  return { reason: msg, cls: c === 'technical' ? 'technical' : 'business' };
}
const CLS_TAG = { business: 'B', technical: 'T', reconciliation: 'R', customer: 'C', unknown: '?' };

/* RECHARGE FAILURE DRILL — the two error states of the card/wallet journey:
 *   bucket=declined  → the gateway answered "no" (bank/acquirer decline)
 *   bucket=left      → pending with NO gateway answer: the customer left the payment screen
 * Reasons use the console's DECLINE_EXPR (fail_reason, else the gateway code·message), so the
 * wording matches Troubleshoot and the payment reports exactly. */
app.get('/api/screens-flow/recharge-errors', async (req, res) => {
  try {
    const [from, to] = flowWindow(req, new Date());
    const bucket = req.query.bucket === 'left' ? 'left' : 'declined';
    /* FLOW → the payments that belong to it. This was a two-way ternary: anything that was not
     * 'change_plan' silently became 'recharge'. But the client has always sent flow=invoice /
     * advance / service (screensflow.js passes the step's drillArg straight through), so all three
     * postpaid journeys drilled into RECHARGE failures. That is why Invoice payment and Advance
     * payment showed the same reason list, and why the modal title read "recharge" when opened
     * from the postpaid section. The funnel counts above the drill were always per-flow and
     * correct — only this endpoint disagreed with them.
     * Types are the same ones FLOW_SQL uses in /api/screens-flow, so the drill and the funnel
     * cannot drift apart again. */
    const FLOWS = {
      recharge:    { who: `p.payment_on_type='recharge'` },
      invoice:     { who: `p.payment_on_type='bill'` },
      advance:     { who: `p.payment_on_type='advanced_postpaid_payment'` },
      service:     { who: `p.payment_on_type='postpaid_service_recharge'` },
      change_plan: { who: `p.payment_on_type='Checkout' AND c.checkout_type=2`, join: true },
      /* Quick-Actions (guest) journeys that pay through a checkout — same LANE types the
       * servicing board uses (3 = sim_replacement, 6 = renewal), so the drill can never
       * disagree with the row counts above it. */
      sim_swap:    { who: `p.payment_on_type='Checkout' AND c.checkout_type=3`, join: true },
      renewal:     { who: `p.payment_on_type='Checkout' AND c.checkout_type=6`, join: true },
      /* onboarding journeys (App-screens-flow error states) — lane split on the order type */
      onboarding_new: { who: `p.payment_on_type='OnboardingOrder' AND ((oo.number_order_type=1) IS NOT TRUE)`, ojoin: true },
      onboarding_mnp: { who: `p.payment_on_type='OnboardingOrder' AND ((oo.number_order_type=1) IS TRUE)`, ojoin: true },
    };
    const flow = FLOWS[req.query.flow] ? req.query.flow : 'recharge';
    const F = FLOWS[flow];
    const reason = (req.query.reason || '').trim();
    const ANS = `(p.payment_commit_response IS NOT NULL AND p.payment_commit_response::text NOT IN ('{}','null'))`;
    const SEL = F.ojoin
      ? `FROM payments p LEFT JOIN onboarding_orders oo ON p.payment_on_type='OnboardingOrder'
           AND p.payment_on_id ~ '^[0-9a-f-]{36}$' AND oo.id = p.payment_on_id::uuid`
      : F.join
      ? `FROM payments p LEFT JOIN checkouts c ON p.payment_on_type='Checkout'
           AND p.payment_on_id ~ '^[0-9a-f-]{36}$' AND c.id = p.payment_on_id::uuid`
      : `FROM payments p`;
    const WHO = F.who;
    const COND = bucket === 'left'
      ? `p.status='pending' AND NOT ${ANS}`
      : `p.status IN ('fail','failed')`;
    const W = `WHERE p.created_at >= $1 AND p.created_at < $2 AND ${WHO} AND ${COND}`;
    const P = [from, to];
    const total = Number((await db.source.query(`SELECT count(*)::int n ${SEL} ${W}`, P)).rows[0].n);
    // Pull the payments themselves (newest first, capped) and classify each ONE BY ONE.
    // The app stores no bank_message for salam/TAP payments, so DECLINE_EXPR is '—' on almost
    // every row: the reason has to come from the UPG gateway, exactly like the payment report.
    const CAP = 4000;
    const raw = (await db.source.query(
      `SELECT p.id::text id, p.created_at, p.payment_reference_id ref, p.amount, p.status,
              coalesce(p.vendor,'—') vendor,
              CASE WHEN lower(coalesce(p.platform,'')) IN ('ios','android','web') THEN lower(p.platform) ELSE 'apollo' END AS plat,
              coalesce(p.payment_commit_response#>>'{data,source}','—') rail,
              NULLIF((${analytics.DECLINE_EXPR}), '—') AS app_reason
       ${SEL} ${W} ORDER BY p.created_at DESC LIMIT ${CAP}`, P)).rows;
    // enrich the declined bucket with the gateway's own answer (index-backed, chunked)
    let upgBy = null, upgNote = null;
    if (bucket === 'declined') {
      const upg = require('./upgLink');
      if (!upg.configured()) upgNote = 'UPG not configured — reasons limited to what the app stored.';
      else {
        try {
          const g = await upg.reasonsForRefs(raw.map(r => r.ref).filter(Boolean));
          if (g && g.error) upgNote = g.error; else if (g) upgBy = g.byRef;
        } catch (e) { upgNote = 'UPG lookup failed: ' + e.message; }
      }
    }
    const classify = (r) => bucket === 'left'
      ? { reason: 'Customer left the payment screen', cls: 'customer' }   // no gateway answer to classify
      : classifyPayFailure(r.app_reason, r.rail, upgBy && upgBy[r.ref]);
    const agg = {};
    const rows = [];
    for (const r of raw) {
      const c = classify(r);
      const u = upgBy && upgBy[r.ref];
      const k = c.reason;
      agg[k] = agg[k] || { reason: k, cls: c.cls, n: 0, sar: 0, plat: {}, vendor: {} };
      agg[k].n++; agg[k].sar += Number(r.amount || 0);
      agg[k].plat[r.plat] = (agg[k].plat[r.plat] || 0) + 1;
      agg[k].vendor[r.vendor] = (agg[k].vendor[r.vendor] || 0) + 1;
      if (!reason || reason === k) {
        if (rows.length < 250) rows.push({
          id: r.id, created_at: r.created_at, ref: r.ref, amount: r.amount, status: r.status,
          vendor: r.vendor, platform: r.plat, rail: (u && u.source) || r.rail,
          reason: c.reason, cls: c.cls,
          upg_status: (u && u.status) || null
        });
      }
    }
    const list = Object.values(agg).sort((a, b) => b.n - a.n);
    const scanned = raw.length;
    list.forEach(r => { r.pct = scanned ? Math.round(1000 * r.n / scanned) / 10 : 0; });
    res.json({ from, to, bucket, flow, total, scanned,
      truncated: total > scanned ? `showing the newest ${scanned} of ${total}` : null,
      upgNote, reasons: list,
      rows: roles.maskDeep(rows, !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1'),
      filtered: reason || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ONE PAYMENT, END TO END — app row → API-gateway trace (+ the real request/response bodies)
 * → UPG gateway attempts. Payments carry no gateway transaction id, so the API-log line is
 * found by time+path around the payment and its transaction id drives the gateway lookup. */
app.get('/api/screens-flow/payment/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^[0-9a-f-]{10,40}$/i.test(id)) return res.status(400).json({ error: 'payment id required' });
    const unmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    const p = (await db.source.query(
      `SELECT id::text, created_at, updated_at, status, amount, vendor, platform, payment_on_type,
              payment_on_id, payment_reference_id, fail_reason, customer_mobile_number, target_mobile_number,
              payment_commit_response#>>'{data,source}' rail,
              payment_commit_response#>>'{data,method}' method,
              payment_commit_response#>>'{data,id}' gw_payment_id,
              payment_commit_response#>>'{data,status}' gw_status,
              payment_initialization_response#>>'{url}' pay_page_url
       FROM payments WHERE id = $1::uuid`, [id])).rows[0];
    if (!p) return res.status(404).json({ error: 'payment not found' });
    const out = { payment: p, app: [], gateway: null, payloads: null, upg: null };
    /* APP TIER — ONLY rows that can be PROVEN to belong to this payment.
     *
     * The API capture stores no customer and no payment identifier (the MSISDN is masked at
     * ingest), so the only honest links are the identifiers themselves: the transaction id, the
     * payment reference, or the gateway payment id appearing in the captured line.
     *
     * An earlier version matched on time + path instead. That was wrong: for an abandoned
     * payment the window spans created_at → updated_at (often 30+ minutes) and paths like
     * /bss/invoices/list-invoices are ordinary browsing traffic, so it returned dozens of OTHER
     * customers' calls and then picked one of their transaction ids to trace. Never again:
     * a correlation the data cannot support must be reported as absent, not invented. */
    const keys = [p.payment_reference_id, p.gw_payment_id].filter(Boolean);
    try {
      if (keys.length) {
        out.app = (await db.console.query(
          `SELECT ts, host, path, transaction_id, response_code, response_message, duration_ms, err_class
           FROM api_traffic_events
           WHERE ts >= $1::timestamptz - interval '10 minutes'
             AND ts <= coalesce($2::timestamptz, $1::timestamptz) + interval '10 minutes'
             AND (transaction_id = ANY($3::text[])
                  OR response_message ILIKE ANY($4::text[])
                  OR path ILIKE ANY($4::text[]))
           ORDER BY ts LIMIT 30`,
          [p.created_at, p.updated_at, keys, keys.map(k => '%' + k + '%')])).rows;
      }
      out.appLinkedBy = out.app.length ? 'payment reference / gateway payment id found in the captured call' : null;
      if (!out.app.length) out.appNote =
        'No captured API call carries this payment’s reference. The Digital API capture stores no ' +
        'customer or payment identifier (MSISDN is masked at ingest), so app-tier lines cannot be ' +
        'attributed to one payment — matching by time alone would show unrelated customers. ' +
        'The exact record for this payment is the UPG gateway data below.';
      // Platform health AT THAT MOMENT — an aggregate, never presented as this payment's calls
      const h = (await db.console.query(
        `SELECT count(*)::int total,
                count(*) FILTER (WHERE err_class='technical')::int technical,
                count(*) FILTER (WHERE err_class='business')::int business
         FROM api_traffic_events
         WHERE ts >= $1::timestamptz - interval '2 minutes' AND ts <= $1::timestamptz + interval '2 minutes'`,
        [p.created_at])).rows[0];
      out.platformAtTime = { window: '±2 min around the payment', ...h };
    } catch (e) { out.appError = e.message; }
    // gateway trace ONLY from a transaction id that is genuinely this payment's
    const txn = (out.app.find(a => a.transaction_id) || {}).transaction_id || null;
    out.txn = txn;
    if (txn) {
      try { out.gateway = await require('./apigwTrace').forTxn(txn); } catch (e) { out.gateway = { error: e.message }; }
      try { out.payloads = roles.maskDeep(await require('./apiLogCollector').fetchTxnPayloads(txn), unmask); }
      catch (e) { out.payloads = { error: e.message }; }
    }
    // UPG side — every gateway attempt on this payment reference (bank message, rail, charge id)
    const upg = require('./upgLink');
    if (p.payment_reference_id && upg.configured()) {
      try {
        const g = await upg.rowsForRefs([p.payment_reference_id]);
        if (!g) out.upg = { error: 'UPG not configured' };
        else if (g.error) out.upg = { error: g.error };
        else out.upg = (g.byRef.get && g.byRef.get(p.payment_reference_id)) || [];
      } catch (e) { out.upg = { error: e.message }; }
    } else if (!upg.configured()) out.upg = { error: 'UPG_DATABASE_URL not configured' };
    // the COMPLETE charge object(s) as UPG stored them — detail view only, capped at 4 attempts
    if (p.payment_reference_id && upg.configured()) {
      try { out.upgPayload = await upg.payloadForRef(p.payment_reference_id); }
      catch (e) { out.upgPayload = { error: e.message }; }
    }
    audit(req, unmask ? 'pii.unmask' : 'SCREENS_PAYMENT_TRACE', id, { txn: txn || null });
    res.json(roles.maskDeep(out, unmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/screens-flow', async (req, res) => {
  try {
    const [from, to] = flowWindow(req, new Date());
    res.json(await respCache.wrap(req, async () => {
      // one pass over the window's orders with the payment outcome AND the order's platform
      // attached. onboarding_orders carries no platform column, so the order's app is taken
      // from its payment row, else from its activation (BSS) call — both window-guarded so
      // each side uses its created_at index. Orders that never reached either stay 'unknown'.
      const ord = (await db.source.query(`
        WITH o AS (SELECT id, ((number_order_type=1) IS TRUE) AS is_mnp, is_eligible, completed, activated,
                          flow_type, lower(coalesce(external_service_name,'')) AS src,
                          (NULLIF(trim(nationality_id_number),'') IS NOT NULL) AS id_submitted
                   FROM onboarding_orders WHERE created_at >= $1 AND created_at < $2),
             pay AS (SELECT payment_on_id, bool_or(status='success') AS ok,
                            (array_agg(platform ORDER BY created_at) FILTER (WHERE platform IS NOT NULL))[1] AS platform
                     FROM payments WHERE created_at >= $1 AND created_at < $2
                       AND payment_on_type='OnboardingOrder' GROUP BY 1),
             -- activation_logs.onboarding_order_id is a UUID (payments.payment_on_id is text) —
             -- join uuid-to-uuid so the partial index on it is usable.
             act AS (SELECT onboarding_order_id AS oid,
                            (array_agg(platform ORDER BY created_at) FILTER (WHERE platform IS NOT NULL))[1] AS platform
                     FROM activation_logs WHERE created_at >= $1 AND created_at < $2
                       AND onboarding_order_id IS NOT NULL GROUP BY 1)
        SELECT o.is_mnp,
               -- CHANNEL, not raw platform: the customer arrived through one of the apps
               -- (ios/android/web) or the order was placed by a reseller through the API
               -- (tygo/soob = Apollo). Reseller orders carry no app platform, so they are
               -- recognised by their own stamped origin / flow_type instead.
               CASE WHEN lower(coalesce(p.platform, a.platform, '')) IN ('ios','android','web')
                      THEN lower(coalesce(p.platform, a.platform))
                    WHEN o.src = ANY($3::text[]) OR o.flow_type IN (1,2,3,5,7)
                      OR NULLIF(lower(coalesce(p.platform, a.platform, '')), '') IS NOT NULL
                      THEN 'apollo'
                    ELSE 'unresolved' END AS plat,
               count(*)::int created,
               /* id_checked = the customer SUBMITTED National ID + nationality. is_eligible
                * defaults to FALSE at creation, so "IS NOT NULL" matched every browser and the
                * funnel showed no drop before eligibility — the pre-eligibility abandonment was
                * being booked as "not eligible". */
               count(*) FILTER (WHERE o.id_submitted)::int id_checked,
               count(*) FILTER (WHERE NOT o.id_submitted)::int pre_drop,
               count(*) FILTER (WHERE o.is_eligible IS TRUE)::int eligible,
               count(*) FILTER (WHERE o.id_submitted AND o.is_eligible IS FALSE)::int denied,
               count(*) FILTER (WHERE o.completed IS TRUE)::int checkout,
               count(*) FILTER (WHERE p.payment_on_id IS NOT NULL)::int pay_opened,
               count(*) FILTER (WHERE p.ok IS TRUE)::int paid,
               count(*) FILTER (WHERE o.activated IS TRUE)::int activated
        FROM o LEFT JOIN pay p ON p.payment_on_id = o.id::text
               LEFT JOIN act a ON a.oid = o.id
        GROUP BY 1, 2`, [from, to, RESELLER_CHANNELS])).rows;
      // mix(rows, col) → {ios, android, web, apollo, known} for one step. Four real channels
      // only: the three apps plus "Apollo" = reseller placed the order through the API
      // (tygo / soob). Anything still unresolved is left OUT of the split entirely rather
      // than shown as a meaningless "other"/"unknown" slice.
      const mix = (rows, col) => {
        const m = { ios: 0, android: 0, web: 0, apollo: 0 };
        for (const r of rows) {
          const v = Number(r[col] || 0); if (!v) continue;
          const p = String(r.plat || '');
          if (p === 'ios' || p === 'android' || p === 'web') m[p] += v;
          else if (p && p !== 'unresolved') m.apollo += v;
        }
        m.known = m.ios + m.android + m.web + m.apollo;
        return m;
      };
      // The onboarding lanes describe the SALAM DIRECT journey (customer in the iOS / Android /
      // web app). Orders a reseller pushed through the API (Apollo — tygo / soob) never touch
      // those screens, so they are EXCLUDED from every step and reported separately as lane
      // context instead: counting them would understate the app funnel's real conversion.
      const lane = mnp => {
        const all = ord.filter(x => x.is_mnp === mnp);
        const direct = all.filter(r => r.plat !== 'apollo');
        const apolloRows = all.filter(r => r.plat === 'apollo');
        const sum = (rs, col) => rs.reduce((a, r) => a + Number(r[col] || 0), 0);
        const S = (k, label, col) => ({ k, label, n: sum(direct, col), mix: mix(direct, col) });
        const allCreated = sum(all, 'created'), apCreated = sum(apolloRows, 'created');
        return {
          steps: [
            S('plans', 'Plans & offers', 'created'),
            S('id', mnp ? 'Port-in & ID submitted' : 'ID submitted (NID + nationality)', 'id_checked'),
            S('elig', 'Eligibility result', 'eligible'),
            S('checkout', 'Checkout summary', 'checkout'),
            S('pay', 'Payment page', 'pay_opened'),
            S('paid', 'Payment success', 'paid'),
            S('active', 'Activation complete', 'activated'),
          ],
          apollo: {
            orders: apCreated,
            activated: sum(apolloRows, 'activated'),
            share: allCreated ? Math.round(1000 * apCreated / allCreated) / 10 : 0,
            all_orders: allCreated
          }
        };
      };
      /* ---- JOURNEY ERROR STATES for the onboarding lanes ------------------------------------
       * The payment flows always had an "error states" branch; the onboarding lanes did not —
       * yet most of their loss is NOT payment: eligibility denials, Nafath identity failures,
       * BSS activation faults and delivery problems. One card per failure family, each tagged
       * business/technical (errclass — the same split as Troubleshoot and the alert rules) and
       * split by channel where the source table carries a platform. Nafath and delivery carry
       * no platform/lane linkage, so those cards are journey-wide — stated, not guessed. */
      const ACT_CODE = `COALESCE(NULLIF(al.status_code,''), al.response->>'responseCode')`;
      const ACT_TEXT = `coalesce(al.response->>'responseMessage', al.response::text, '')`;
      const ACT_CLS2 = require('./errclass').classCaseSql(ACT_CODE, ACT_TEXT);
      /* state lists verbatim from metrics.js (DeliveryRequest vocabulary) */
      const DEL_FAILED = ['cancelled','canceled','deleted','RTO','CANCELLED','PUX43','returned','reverseReturned','shipmentCanceled','reverseShipmentCanceled',
        'REFUSED','onhold','pickup_failed','DEX93','RD','DEX07-3','DEX07-4','DEX07-5','DEX07-6','DEX07-7','DEX07-8','DEX93-1','DEX93-2','DEX93-3','DEX93-4','DEX07'];
      const DEL_DONE = ['complete','completed','DELIVERED','DL','DEX09','POD','Delivered','delivered'];
      const ANS0 = `(p.payment_commit_response IS NOT NULL AND p.payment_commit_response::text NOT IN ('{}','null'))`;
      const [oPay, oAct, oActCodes, naf, delRows] = await Promise.all([
        // onboarding payments by lane × channel — failed vs abandoned
        db.source.query(`
          SELECT ((o.number_order_type=1) IS TRUE) AS mnp,
                 CASE WHEN lower(coalesce(p.platform,'')) IN ('ios','android','web') THEN lower(p.platform) ELSE 'apollo' END AS plat,
                 count(*) FILTER (WHERE p.status IN ('fail','failed'))::int failed,
                 count(*) FILTER (WHERE p.status='pending' AND NOT ${ANS0})::int abandoned
          FROM payments p JOIN onboarding_orders o ON o.id::text = p.payment_on_id
          WHERE p.created_at >= $1 AND p.created_at < $2 AND p.payment_on_type='OnboardingOrder'
          GROUP BY 1,2`, [from, to]).then(r => r.rows),
        // activation failures by lane × platform, split business/technical
        db.source.query(`
          SELECT ((oo.number_order_type=1) IS TRUE) AS mnp,
                 CASE WHEN lower(coalesce(al.platform,'')) IN ('ios','android','web') THEN lower(al.platform) ELSE 'apollo' END AS plat,
                 count(*) FILTER (WHERE ${ACT_CLS2}='technical')::int tech,
                 count(*) FILTER (WHERE ${ACT_CLS2}='business')::int biz
          FROM activation_logs al JOIN onboarding_orders oo ON oo.id = al.onboarding_order_id
          WHERE al.created_at >= $1 AND al.created_at < $2 AND al.state=false AND al.onboarding_order_id IS NOT NULL
          GROUP BY 1,2`, [from, to]).then(r => r.rows).catch(() => []),
        // top activation failure codes per lane (for the on-card chips)
        db.source.query(`
          SELECT ((oo.number_order_type=1) IS TRUE) AS mnp, coalesce(${ACT_CODE},'—') code,
                 ${ACT_CLS2} AS cls, count(*)::int n
          FROM activation_logs al JOIN onboarding_orders oo ON oo.id = al.onboarding_order_id
          WHERE al.created_at >= $1 AND al.created_at < $2 AND al.state=false AND al.onboarding_order_id IS NOT NULL
          GROUP BY 1,2,3 ORDER BY n DESC LIMIT 12`, [from, to]).then(r => r.rows).catch(() => []),
        // Nafath identity — journey-wide (no lane/platform on nafath_logs)
        db.source.query(`
          SELECT coalesce(lower(status),'—') s, count(*)::int n
          FROM nafath_logs WHERE created_at >= $1 AND created_at < $2
          GROUP BY 1 ORDER BY n DESC`, [from, to]).then(r => r.rows).catch(() => []),
        // delivery — failed/returned in window + stuck (submitted, no outcome, >48h, last 14d)
        db.source.query(`
          SELECT count(*) FILTER (WHERE created_at >= $1 AND created_at < $2 AND delivery_state = ANY($3))::int failed,
                 count(*) FILTER (WHERE submitted = true AND coalesce(delivery_state,'') <> ALL($3)
                   AND coalesce(delivery_state,'') <> ALL($4)
                   AND created_at < now() - interval '48 hours' AND created_at > now() - interval '14 days')::int stuck
          FROM delivery_requests WHERE created_at > now() - interval '14 days' OR (created_at >= $1 AND created_at < $2)`,
          [from, to, DEL_FAILED, DEL_DONE]).then(r => r.rows[0]).catch(() => ({ failed: 0, stuck: 0 })),
      ]);
      /* CLASSIFICATION RULE (agreed 25 Aug 2026, verified on the live export): a TERMINAL status
       * in nafath_logs means Salam's side worked — request created, CITC processed it, verdict
       * returned. failed = customer failed the verification in the Nafath app (wrong number
       * chosen — retries seconds apart in the data prove it); rejected/denied = refusal;
       * expired/cancelled = customer never acted. ALL of that is BUSINESS, not Salam IT.
       * Salam-IT technical Nafath issues live in the API capture (failed calls TO Nafath),
       * never as status rows here. */
      const nafFailed = naf.filter(x => ['expired','rejected','failed','cancelled','denied'].includes(x.s))
        .reduce((a, x) => a + Number(x.n), 0);
      const nafCodes = naf.filter(x => x.s !== 'completed').slice(0, 5).map(x => ({
        code: 'B', msg: x.s, n: Number(x.n),
        pct: Math.round(1000 * x.n / (naf.reduce((a, y) => a + Number(y.n), 0) || 1)) / 10,
        cls: 'business' }));
      const errStepsFor = (mnp) => {
        const deniedN = ord.filter(x => x.is_mnp === mnp && x.plat !== 'apollo')
          .reduce((a, r) => a + Number(r.denied || 0), 0);
        const laneKey = mnp ? 'mnp' : 'newsim';
        const pRows = oPay.filter(r => r.mnp === mnp), aRows = oAct.filter(r => r.mnp === mnp);
        const sum = (rs, c) => rs.reduce((a, r) => a + Number(r[c] || 0), 0);
        const failed = sum(pRows, 'failed'), abandoned = sum(pRows, 'abandoned');
        const actTech = sum(aRows, 'tech'), actBiz = sum(aRows, 'biz');
        const actCodes = oActCodes.filter(r => r.mnp === mnp).slice(0, 5).map(r => ({
          code: r.code, msg: r.code, n: Number(r.n), cls: r.cls,
          pct: Math.round(1000 * r.n / ((actTech + actBiz) || 1)) / 10 }));
        const steps = [];
        const preN = ord.filter(x => x.is_mnp === mnp && x.plat !== 'apollo')
          .reduce((a, r) => a + Number(r.pre_drop || 0), 0);
        if (preN) steps.push({ k: 'err_pre_elig', label: 'Dropped before eligibility', n: preN,
          err: 0, errLabel: '', sub: 'browsing / plan / number selection — never submitted the ID form. NOT an eligibility refusal.',
          mix: mix(ord.filter(x => x.is_mnp === mnp), 'pre_drop'),
          drill: 'journey-errors', drillArg: `pre_eligibility:${laneKey}` });
        if (deniedN) steps.push({ k: 'err_elig', label: 'Not eligible — rejected', n: deniedN,
          err: deniedN, errLabel: 'business (policy/CITC) refusals',
          mix: mix(ord.filter(x => x.is_mnp === mnp), 'denied'),
          drill: 'journey-errors', drillArg: `eligibility:${laneKey}` });
        if (nafFailed) steps.push({ k: 'err_nafath', label: 'Nafath identity failed', n: nafFailed,
          err: nafFailed, errLabel: 'journey-wide (both lanes)', codes: nafCodes,
          drill: 'journey-errors', drillArg: `nafath:${laneKey}` });
        if (abandoned) steps.push({ k: 'err_pay_left', label: 'Left before paying', n: abandoned,
          err: abandoned, errLabel: 'no gateway answer', mix: mix(pRows, 'abandoned'),
          drill: 'recharge-errors', drillArg: `onboarding_${mnp ? 'mnp' : 'new'}:left` });
        if (failed) steps.push({ k: 'err_pay_declined', label: 'Payment declined', n: failed,
          err: failed, errLabel: 'declined by bank / gateway', mix: mix(pRows, 'failed'),
          drill: 'recharge-errors', drillArg: `onboarding_${mnp ? 'mnp' : 'new'}:declined` });
        if (Number(delRows.failed) + Number(delRows.stuck)) steps.push({ k: 'err_delivery',
          label: 'Delivery failed / stuck', n: Number(delRows.failed) + Number(delRows.stuck),
          err: Number(delRows.failed), errLabel: `failed/returned (${delRows.stuck} stuck >48h)`,
          drill: 'journey-errors', drillArg: `delivery:${laneKey}` });
        /* Activation is the journey's FINAL stage, so its error card always closes the branch —
         * even at 0. A visible zero here is information ("BSS activated everything it was asked
         * to"), and its absence would read as "not monitored". */
        steps.push({ k: 'err_activation', label: 'Activation failed (BSS)',
          n: actTech + actBiz, err: actTech,
          errLabel: actTech + actBiz ? `technical (${actBiz} business)` : '',
          sub: actTech + actBiz ? undefined : 'no failed activations in this window',
          codes: actCodes, mix: (() => { const m = mix(aRows, 'tech'); const b = mix(aRows, 'biz');
            ['ios', 'android', 'web', 'apollo'].forEach(k => m[k] += b[k]); m.known += b.known; return m; })(),
          drill: 'journey-errors', drillArg: `activation:${laneKey}` });
        return steps;
      };

      // logged lane: sign-ins + the recharge funnel. "engaged gateway" = left pending-without-
      // answer (the never-attempted block stays on the recharge screen, proven 20 Aug).
      const ANSWERED = `(payment_commit_response IS NOT NULL AND payment_commit_response::text NOT IN ('{}','null'))`;
      // After login the journey depends on the PRODUCT, so the logged part is two lanes:
      //   prepaid  → top-up balance ('recharge')            + voucher recharge (API capture)
      //   postpaid → settle the bill ('bill'), pay ahead ('advanced_postpaid_payment'),
      //              or a paid service on a postpaid line ('postpaid_service_recharge')
      // FLOW = one product journey inside a lane. change_plan lives in checkouts (checkout_type=2),
      // exactly as the servicing board resolves it, so the two sections cannot disagree.
      const FLOW_SQL = `CASE
        WHEN p.payment_on_type = 'recharge' THEN 'recharge'
        WHEN p.payment_on_type = 'Checkout' AND c.checkout_type = 2 THEN 'change_plan'
        WHEN p.payment_on_type = 'bill' THEN 'invoice'
        WHEN p.payment_on_type = 'advanced_postpaid_payment' THEN 'advance'
        WHEN p.payment_on_type = 'postpaid_service_recharge' THEN 'service' END`;
      const PLAT_SQL = `CASE WHEN lower(coalesce(p.platform,'')) IN ('ios','android','web') THEN lower(p.platform) ELSE 'apollo' END`;
      const JOIN_SQL = `FROM payments p LEFT JOIN checkouts c
        ON p.payment_on_type='Checkout' AND p.payment_on_id ~ '^[0-9a-f-]{36}$' AND c.id = p.payment_on_id::uuid`;
      const SCOPE = `WHERE p.created_at >= $1 AND p.created_at < $2
        AND (p.payment_on_type IN ('recharge','bill','advanced_postpaid_payment','postpaid_service_recharge')
             OR (p.payment_on_type='Checkout' AND c.checkout_type = 2))`;
      const ANS_P = ANSWERED.replace(/payment_commit_response/g, 'p.payment_commit_response');
      const rcRows = (await db.source.query(`
        SELECT ${FLOW_SQL} AS flow, ${PLAT_SQL} AS plat,
               count(*)::int started,
               count(*) FILTER (WHERE p.status <> 'pending' OR ${ANS_P})::int engaged,
               count(*) FILTER (WHERE p.status = 'success')::int success,
               count(*) FILTER (WHERE p.status IN ('fail','failed'))::int failed,
               -- never reached the gateway at all: the customer left the payment screen
               count(*) FILTER (WHERE p.status = 'pending' AND NOT ${ANS_P})::int abandoned
        ${JOIN_SQL} ${SCOPE} GROUP BY 1, 2`, [from, to])).rows;
      // distinct logged customers per flow (a customer counted once inside each flow)
      const rcCust = (await db.source.query(`
        SELECT flow, plat, count(*)::int logged FROM (
          SELECT DISTINCT ON (flow, m) flow, m, plat FROM (
            SELECT ${FLOW_SQL} AS flow, p.customer_mobile_number AS m, ${PLAT_SQL} AS plat, p.created_at
            ${JOIN_SQL} ${SCOPE} AND p.customer_mobile_number IS NOT NULL) x
          WHERE flow IS NOT NULL
          ORDER BY flow, m, created_at DESC) t
        GROUP BY 1, 2`, [from, to])).rows;
      // NOTE on the logged base: users.current_sign_in_at is NOT populated on the replica (a
      // 7-day window returns 0 against 505k registered), so sign-in timestamps cannot be used.
      // What IS provable: a customer who paid in the window was logged in — hence rcCust above.
      const registered = (await db.source.query(`SELECT count(*)::int n FROM users`)).rows[0].n;
      // voucher path — the API capture is the only per-attempt record (no DB row is written).
      // Errors are split business vs technical with the codes confirmed by the platform team:
      // technical = service error 31 + FailedInBRM (code "0", distinct from success "00").
      let voucher = { attempts: 0, success: 0, business: 0, technical: 0 };
      try {
        const v = (await db.console.query(
          `SELECT count(*)::int a,
                  count(*) FILTER (WHERE response_code='00')::int s,
                  count(*) FILTER (WHERE response_code <> '00'
                    AND (response_message ILIKE '%FailedInBRM%' OR response_code='31'))::int tech,
                  count(*) FILTER (WHERE response_code <> '00'
                    AND NOT (response_message ILIKE '%FailedInBRM%' OR response_code='31'))::int biz
           FROM api_traffic_events WHERE path ILIKE '%voucher%' AND ts >= $1 AND ts < $2`, [from, to])).rows[0];
        voucher = { attempts: Number(v.a || 0), success: Number(v.s || 0),
                    business: Number(v.biz || 0), technical: Number(v.tech || 0) };
        // per-code split shown on the error screen itself (share of all rejections)
        const vc = (await db.console.query(
          `SELECT coalesce(response_code,'—') code,
                  coalesce(NULLIF(trim(response_message),''),'(no message)') msg, count(*)::int n
           FROM api_traffic_events
           WHERE path ILIKE '%voucher%' AND ts >= $1 AND ts < $2
             AND coalesce(response_code,'') <> '00'
             AND coalesce(response_message,'') NOT ILIKE '%success%'
           GROUP BY 1, 2 ORDER BY n DESC LIMIT 8`, [from, to])).rows;
        const vtot = vc.reduce((a, r) => a + Number(r.n || 0), 0) || 1;
        voucher.codes = vc.map(r => ({ code: r.code, msg: r.msg, n: Number(r.n),
          pct: Math.round(1000 * r.n / vtot) / 10, cls: vCls(r.code, r.msg) }));
      } catch (_) { /* capture table optional */ }
      // A payment FLOW = one journey row: home → its own screen → gateway → done, with the
      // issues that happened AT each step so a reader sees where to act, not just where the
      // funnel narrows.
      // Reason breakdown for the "Payment declined" card of EVERY payment flow — one shared,
      // capped UPG lookup for the whole window (the app stores no bank_message, so the gateway
      // is the only source). Percentages on the card are of the failures actually resolved.
      const declBy = {};
      try {
        const fails = (await db.source.query(`
          SELECT ${FLOW_SQL} AS flow, p.payment_reference_id ref,
                 coalesce(p.payment_commit_response#>>'{data,source}','—') rail,
                 NULLIF((${analytics.DECLINE_EXPR}), '—') AS app_reason
          ${JOIN_SQL} ${SCOPE} AND p.status IN ('fail','failed') AND p.payment_reference_id IS NOT NULL
          ORDER BY p.created_at DESC LIMIT 3000`, [from, to])).rows;
        const upg = require('./upgLink');
        let by = null;
        if (upg.configured() && fails.length) {
          const g = await upg.reasonsForRefs(fails.map(f => f.ref));
          if (g && !g.error) by = g.byRef;
        }
        for (const f of fails) {
          if (!f.flow) continue;
          const c = classifyPayFailure(f.app_reason, f.rail, by && by[f.ref]);
          const d = declBy[f.flow] = declBy[f.flow] || { n: 0, byReason: {} };
          d.n++;
          const k = `${c.reason}||${c.cls}`;
          d.byReason[k] = (d.byReason[k] || 0) + 1;
        }
        for (const d of Object.values(declBy)) {
          d.codes = Object.entries(d.byReason).sort((a, b) => b[1] - a[1]).slice(0, 6)
            .map(([k, n]) => { const [msg, cls] = k.split('||');
              return { code: CLS_TAG[cls] || '?', msg, cls, n, pct: Math.round(1000 * n / d.n) / 10 }; });
        }
      } catch (_) { /* the card breakdown is a nicety — never break the section for it */ }

      const payFlow = (flow, j, desc, S2, S3, S4) => {
        const rows = rcRows.filter(r => r.flow === flow);
        const cust = rcCust.filter(r => r.flow === flow);
        const tot = c => rows.reduce((a, r) => a + Number(r[c] || 0), 0);
        const started = tot('started'), abandoned = tot('abandoned'), failed = tot('failed');
        // the two states a customer actually lands in when a card/wallet payment does not
        // complete — both drill into the failing payments (app ⇄ gateway ⇄ UPG)
        const errSteps = (failed || abandoned) ? [
          { k: 'left', label: 'Left before paying', n: abandoned,
            err: abandoned, errLabel: 'no gateway answer',
            drill: 'recharge-errors', drillArg: `${flow}:left` },
          { k: 'declined', label: 'Payment declined', n: failed,
            err: failed, errLabel: 'declined by bank / gateway',
            drill: 'recharge-errors', drillArg: `${flow}:declined`,
            codes: (declBy[flow] && declBy[flow].codes) || [] },
        ] : null;
        return {
          key: flow, j, name: S2.name, desc, errSteps,
          steps: [
            { k: 'home', label: 'Home (logged in)', n: cust.reduce((a, r) => a + Number(r.logged || 0), 0),
              mix: mix(cust, 'logged'), sub: `distinct customers · ${registered.toLocaleString()} registered` },
            { k: S2.k, label: S2.t, n: started, mix: mix(rows, 'started'),
              err: abandoned, errLabel: 'left before paying' },
            { k: S3.k, label: S3.t, n: tot('engaged'), mix: mix(rows, 'engaged'),
              err: failed, errLabel: 'declined / failed' },
            { k: S4.k, label: S4.t, n: tot('success'), mix: mix(rows, 'success') },
          ]
        };
      };
      // Voucher journey mirrors the design flow: Recharge (pick method) → Use Voucher (enter
      // code) → Recharge (submit) → redeemed, with the two error screens as a branch.
      // n === null means the screen exists in the app but calls no API, so it CANNOT be counted
      // (the client validates the format locally) — shown as "not measured" rather than faked.
      const voucherFlow = {
        key: 'voucher', j: 'rc', name: 'Voucher recharge',
        desc: 'Customer redeems a printed or digital voucher — credited by BSS, no payment gateway involved.',
        steps: [
          { k: 'method', label: 'Recharge · choose method', n: null, note: 'screen not instrumented' },
          { k: 'voucher', label: 'Use voucher · enter code', n: null, note: 'screen not instrumented' },
          { k: 'voucher_filled', label: 'Submit voucher', n: voucher.attempts,
            err: voucher.business + voucher.technical, errLabel: 'rejected by BSS' },
          { k: 'voucher_ok', label: 'Voucher redeemed', n: voucher.success },
        ],
        errSteps: [
          { k: 'voucher_invalid', label: 'Invalid voucher number', n: null,
            note: 'client-side check · never reaches the API' },
          { k: 'voucher_err', label: 'Oops · recharge failed', n: voucher.business + voucher.technical,
            err: voucher.technical, errLabel: `technical (${voucher.business} business)`,
            codes: voucher.codes || [], drill: 'voucher-errors' },
        ]
      };
      const prepaid = {
        flows: [
          payFlow('recharge', 'rc', 'Top-up of a prepaid balance paid by card or wallet through the payment gateway.',
            { k: 'amount', t: 'Recharge screen', name: 'Recharge (card / wallet)' },
            { k: 'gateway', t: 'Payment page (UPG)' }, { k: 'done', t: 'Recharge success' }),
          ...(voucher.attempts ? [voucherFlow] : []),
          payFlow('change_plan', 'cp', 'Existing customer moves to another plan; the price difference is paid before the plan is switched.',
            { k: 'plans', t: 'Choose new plan', name: 'Change plan' },
            { k: 'pay', t: 'Payment page (UPG)' }, { k: 'done', t: 'Plan changed' }),
        ]
      };
      const postpaid = {
        flows: [
          payFlow('invoice', 'pp', 'Settlement of the monthly bill: the customer opens the invoice and pays the amount due.',
            { k: 'bill', t: 'My invoice', name: 'Invoice payment' },
            { k: 'pay', t: 'Payment page (UPG)' }, { k: 'done', t: 'Invoice paid' }),
          payFlow('advance', 'ap', 'Customer pays ahead of the bill — credit is placed on the account before the invoice is issued.',
            { k: 'amount', t: 'Advance amount', name: 'Advance payment' },
            { k: 'pay', t: 'Payment page (UPG)' }, { k: 'done', t: 'Payment applied' }),
        ]
      };
      const svc = rcRows.filter(r => r.flow === 'service').reduce((a, r) => a + Number(r.started || 0), 0);
      if (svc) postpaid.note = `${svc.toLocaleString()} postpaid service recharges also processed in this window.`;
      return { from, to,
        newsim: { ...lane(false), errSteps: errStepsFor(false) },
        mnp: { ...lane(true), errSteps: errStepsFor(true) },
        prepaid, postpaid };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* JOURNEY ERROR DRILL — the non-payment failure families of the onboarding lanes, one popup per
 * error card: eligibility (business refusals), nafath (identity), activation (BSS), delivery.
 * Same contract as the payment drills: reasons with business/technical class, platform mix where
 * the source has one, recent rows (masked), and everything the client needs for the xlsx export.
 * Read-only, window-bounded, LIMITed. */
app.get('/api/screens-flow/journey-errors', async (req, res) => {
  try {
    const [from, to] = flowWindow(req, new Date());
    const cat = String(req.query.cat || '');
    const lane = req.query.lane === 'mnp' ? 'mnp' : 'newsim';
    const lanePred = lane === 'mnp' ? `(number_order_type=1) IS TRUE` : `(number_order_type=1) IS NOT TRUE`;
    const P = [from, to];
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    const out = { from, to, cat, lane, reasons: [], rows: [], notes: [] };

    const ID_SUBMITTED = `NULLIF(trim(nationality_id_number),'') IS NOT NULL`;
    if (cat === 'pre_eligibility') {
      out.title = 'Dropped before eligibility';
      out.desc = 'Orders where the customer never SUBMITTED the ID form (National ID + nationality) — they browsed plans, picked a number or switched tabs and left. This is journey abandonment, NOT an eligibility refusal: no check ever ran. (is_eligible defaults to false at creation, which is why these used to be miscounted as "not eligible".)';
      out.total = Number((await db.source.query(
        `SELECT count(*)::int n FROM onboarding_orders WHERE created_at >= $1 AND created_at < $2
          AND NOT (${ID_SUBMITTED}) AND ${lanePred}`, P)).rows[0].n);
      /* "reasons" here = how far they got — the order's own state names the last recorded step */
      out.reasons = (await db.source.query(
        `SELECT coalesce(aasm_state,'(no state)') AS reason, 'customer'::text AS cls, count(*)::int n
           FROM onboarding_orders WHERE created_at >= $1 AND created_at < $2
            AND NOT (${ID_SUBMITTED}) AND ${lanePred}
          GROUP BY 1 ORDER BY n DESC LIMIT 12`, P)).rows
        .map(r => ({ reason: 'last step: ' + r.reason, cls: r.cls, n: Number(r.n) }));
      out.rows = (await db.source.query(
        `SELECT id::text AS id, mobile_number AS mobile, plan_id, aasm_state AS state, created_at
           FROM onboarding_orders WHERE created_at >= $1 AND created_at < $2
            AND NOT (${ID_SUBMITTED}) AND ${lanePred}
          ORDER BY created_at DESC LIMIT 250`, P)).rows;
      out.notes.push('These customers saw plans/number screens only — nothing was refused. Watch this bucket for UX/price drop-off, not for eligibility problems.');
    } else if (cat === 'eligibility') {
      out.title = 'Not eligible — rejected';
      out.desc = 'Orders where the customer SUBMITTED National ID + nationality and the eligibility check answered NO — business refusals (policy / lines allowed / CITC data), not platform faults.';
      out.total = Number((await db.source.query(
        `SELECT count(*)::int n FROM onboarding_orders WHERE created_at >= $1 AND created_at < $2
          AND is_eligible IS FALSE AND ${ID_SUBMITTED} AND ${lanePred}`, P)).rows[0].n);
      /* the refusal REASONS live in the Semati eligibility responses — 7-day API capture */
      out.reasons = (await db.console.query(
        `SELECT coalesce(response_code,'—') reason, coalesce(err_class,'business') cls, count(*)::int n,
                coalesce(NULLIF(left(min(response_message),80),''),'(no message)') msg
           FROM api_traffic_events WHERE ts >= now()-interval '7 days' AND path ILIKE '%eligib%'
            AND coalesce(err_class,'') <> 'success'
          GROUP BY 1,2 ORDER BY n DESC LIMIT 10`).catch(() => ({ rows: [] }))).rows
        .map(r => ({ reason: `${r.reason} · ${r.msg}`, cls: r.cls, n: Number(r.n) }));
      if (out.reasons.length) out.notes.push('Refusal reasons come from the Semati eligibility responses in the API capture (last 7 days — the replica stores only the yes/no).');
      out.rows = (await db.source.query(
        `SELECT id::text AS id, mobile_number AS mobile, nationality_id_number AS nid,
                plan_id, aasm_state AS state, created_at
           FROM onboarding_orders WHERE created_at >= $1 AND created_at < $2
            AND is_eligible IS FALSE AND ${ID_SUBMITTED} AND ${lanePred}
          ORDER BY created_at DESC LIMIT 250`, P)).rows;
    } else if (cat === 'nafath') {
      out.title = 'Nafath identity failed';
      out.desc = 'Identity verifications that ended expired / rejected / failed / cancelled — ALL business outcomes, not Salam IT. A terminal status here means our platform delivered the request and CITC returned a verdict: "failed" = the customer failed the check in the Nafath app (typically chose the wrong number — the data shows retries seconds apart), "rejected/denied" = refusal, "expired/cancelled" = the customer never approved.';
      out.notes.push('nafath_logs carries no lane or platform — these numbers are journey-wide.');
      out.notes.push('Salam-IT technical Nafath issues (timeouts / 5xx on our calls TO Nafath) appear in Troubleshoot as API failures, never as status rows here — if you suspect an outage, check there.');
      const mixR = (await db.source.query(
        `SELECT coalesce(lower(status),'—') s, coalesce(service,'—') service, count(*)::int n
           FROM nafath_logs WHERE created_at >= $1 AND created_at < $2 GROUP BY 1,2 ORDER BY n DESC`, P)).rows;
      const bad = mixR.filter(x => ['expired','rejected','failed','cancelled','denied'].includes(x.s));
      out.total = bad.reduce((a, x) => a + Number(x.n), 0);
      // all business — see the classification rule above the errSteps builder
      out.reasons = bad.map(r => ({ reason: `${r.s} · ${r.service}`, n: Number(r.n), cls: 'business' }));
      /* columns verified against real usage (analytics.js nafath source): id, status, service,
       * created_at — an earlier guess at msisdn 500'd the popup in production */
      out.rows = (await db.source.query(
        `SELECT id::text AS id, status, coalesce(service,'—') service, created_at
           FROM nafath_logs WHERE created_at >= $1 AND created_at < $2
            AND lower(coalesce(status,'')) = ANY($3)
          ORDER BY created_at DESC LIMIT 250`,
        [...P, ['expired','rejected','failed','cancelled','denied']])).rows;
    } else if (cat === 'activation') {
      out.title = 'Activation failed (BSS)';
      out.desc = 'BSS/Semati activation calls that returned state=false for orders of this lane — technical codes (1500/5002/timeouts) are platform faults; business codes are policy refusals.';
      const ACODE = `COALESCE(NULLIF(al.status_code,''), al.response->>'responseCode')`;
      const ACLS = require('./errclass').classCaseSql(ACODE, `coalesce(al.response->>'responseMessage', al.response::text, '')`);
      const JOIN = `FROM activation_logs al JOIN onboarding_orders oo ON oo.id = al.onboarding_order_id
        WHERE al.created_at >= $1 AND al.created_at < $2 AND al.state=false
          AND al.onboarding_order_id IS NOT NULL AND ${lanePred.replace(/number_order_type/g, 'oo.number_order_type')}`;
      out.reasons = (await db.source.query(
        `SELECT al.api || ' · ' || coalesce(${ACODE},'—') AS reason, ${ACLS} AS cls,
                coalesce(NULLIF(left(max(coalesce(al.response->>'responseMessage','')),80),''),'') msg,
                count(*)::int n
         ${JOIN} GROUP BY 1,2 ORDER BY n DESC LIMIT 12`, P)).rows
        .map(r => ({ reason: r.msg ? `${r.reason} · ${r.msg}` : r.reason, cls: r.cls, n: Number(r.n) }));
      out.total = out.reasons.reduce((a, r) => a + r.n, 0);
      out.rows = (await db.source.query(
        `SELECT al.id::text AS id, al.api, coalesce(${ACODE},'—') AS code, ${ACLS} AS cls,
                coalesce(NULLIF(left(al.response->>'responseMessage',100),''),'—') AS message,
                coalesce(lower(al.platform),'—') AS platform, al.onboarding_order_id::text AS order_id,
                al.created_at
         ${JOIN} ORDER BY al.created_at DESC LIMIT 250`, P)).rows;
      out.notes.push('Full request/response of any failure: Troubleshoot → Activation (BSS) → open the order → trace.');
    } else if (cat === 'delivery') {
      out.title = 'Delivery failed / stuck';
      out.desc = 'Shipments cancelled/refused/returned in the window, plus submitted shipments with no outcome for over 48 hours (stuck) — courier side, so classed business unless the vendor pattern says otherwise.';
      out.notes.push('delivery_requests carries no lane or platform — these numbers are journey-wide.');
      const DEL_FAILED = ['cancelled','canceled','deleted','RTO','CANCELLED','PUX43','returned','reverseReturned','shipmentCanceled','reverseShipmentCanceled',
        'REFUSED','onhold','pickup_failed','DEX93','RD','DEX07-3','DEX07-4','DEX07-5','DEX07-6','DEX07-7','DEX07-8','DEX93-1','DEX93-2','DEX93-3','DEX93-4','DEX07'];
      const DEL_DONE = ['complete','completed','DELIVERED','DL','DEX09','POD','Delivered','delivered'];
      out.reasons = (await db.source.query(
        `SELECT coalesce(delivery_state,'(none)') || ' · ' || coalesce(vendor,'—') AS reason,
                'business'::text AS cls, count(*)::int n
           FROM delivery_requests WHERE created_at >= $1 AND created_at < $2 AND delivery_state = ANY($3)
          GROUP BY 1 ORDER BY n DESC LIMIT 12`, [...P, DEL_FAILED])).rows
        .map(r => ({ reason: r.reason, cls: r.cls, n: Number(r.n) }));
      out.rows = (await db.source.query(
        `SELECT id::text AS id, coalesce(vendor,'—') vendor, coalesce(delivery_state,'(none)') AS state,
                submitted, created_at,
                CASE WHEN delivery_state = ANY($3) THEN 'failed'
                     WHEN submitted = true AND coalesce(delivery_state,'') <> ALL($3)
                          AND coalesce(delivery_state,'') <> ALL($4)
                          AND created_at < now() - interval '48 hours' THEN 'stuck' ELSE 'in progress' END AS bucket
           FROM delivery_requests
          WHERE (created_at >= $1 AND created_at < $2 AND delivery_state = ANY($3))
             OR (submitted = true AND coalesce(delivery_state,'') <> ALL($3) AND coalesce(delivery_state,'') <> ALL($4)
                 AND created_at < now() - interval '48 hours' AND created_at > now() - interval '14 days')
          ORDER BY created_at DESC LIMIT 250`, [...P, DEL_FAILED, DEL_DONE])).rows;
      out.total = out.rows.length ? Number((out.rows.filter(r => r.bucket !== 'in progress').length)) : 0;
    } else return res.status(400).json({ error: 'unknown cat' });

    out.rows = roles.maskDeep(out.rows, allowUnmask);
    const tot = out.reasons.reduce((a, r) => a + r.n, 0) || 1;
    out.reasons.forEach(r => { r.pct = Math.round(1000 * r.n / tot) / 10; });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* QUICK ACTIONS — the seven guest journeys on the web app's landing page (my.salammobile.sa),
 * one row each, over the same window as the rest of the section. Sources were established by
 * probe (quickActionsProbe / probe2), and every mapping states its evidence:
 *   SIM swap        checkouts.checkout_type=3   (LANE map — verified)
 *   Renew plan      checkouts.checkout_type=6   (LANE map — verified)
 *   Activate SIM    checkouts.checkout_type=4   (INFERRED: unmapped type, sizeable volume with
 *                   ZERO payments in every probe window = the only free checkout flow, which is
 *                   what SIM activation is. The row carries this caveat visibly.)
 *   Register        users.created_at            (otps mixes journeys → not attributed)
 *   Recharge / Pay invoice   payments 'recharge' / 'bill'
 *   Track purchase  delivery_requests.delivery_state (a pure READ journey — the lookup screen
 *                   writes no row; what can be counted is the orders being tracked)
 * IDENTITY: the app records no session state, so "not logged in" cannot be proven per payment.
 * What IS provable is account membership of the paying number (users → guests → neither); the
 * split is returned as context, never as a filter — filtering would silently drop payments.
 * aasm_state is a snapshot vocabulary we do not control, so "completed" is matched loosely and
 * the raw state mix is returned for the sub-line rather than guessed at. */
app.get('/api/screens-flow/quick-actions', async (req, res) => {
  try {
    const [from, to] = flowWindow(req, new Date());
    res.json(await respCache.wrap(req, async () => {
      const P = [from, to];
      const ANS = `(p.payment_commit_response IS NOT NULL AND p.payment_commit_response::text NOT IN ('{}','null'))`;
      /* ── checkout-backed journeys (3 · 4 · 6) — TWO populations, stated separately ─────────
       * · checkout numbers (started, completed, paid-not-done) count CHECKOUTS created in the
       *   window — one row per checkout, payments folded in with a grouped subquery so a
       *   checkout with three attempts is never counted three times.
       * · payment numbers come from the next query, scoped to PAYMENTS created in the window —
       *   the EXACT scope of the recharge-errors drill. The first version joined payments to
       *   window-created checkouts, so a payment today against yesterday's checkout was in the
       *   drill but missing from the row: the popup and the card disagreed. */
      const DONE = `(c.aasm_state ILIKE '%complet%' OR c.aasm_state ILIKE '%success%'
                     OR c.aasm_state ILIKE '%done%' OR c.aasm_state ILIKE '%activ%')`;
      const co = (await db.source.query(`
        SELECT c.checkout_type AS t, count(*)::int started,
               count(*) FILTER (WHERE ${DONE})::int done,
               count(*) FILTER (WHERE pp.ok AND NOT ${DONE})::int paid_not_done
        FROM checkouts c
        LEFT JOIN (SELECT payment_on_id, bool_or(status='success') AS ok
                   FROM payments WHERE created_at >= $1 AND created_at < $2
                     AND payment_on_type='Checkout' GROUP BY 1) pp ON pp.payment_on_id = c.id::text
        WHERE c.created_at >= $1 AND c.created_at < $2 AND c.checkout_type IN (3,4,6)
        GROUP BY 1`, P)).rows;
      /* payments on type-3 / type-6 checkouts, by payment window — same join predicate and same
       * fail/abandon conditions as /api/screens-flow/recharge-errors, so row = popup, always */
      const cp = (await db.source.query(`
        SELECT c.checkout_type AS t, count(*)::int attempts,
               count(*) FILTER (WHERE p.status <> 'pending' OR ${ANS})::int engaged,
               count(*) FILTER (WHERE p.status='success')::int paid,
               count(*) FILTER (WHERE p.status IN ('fail','failed'))::int failed,
               count(*) FILTER (WHERE p.status='pending' AND NOT ${ANS})::int abandoned
        FROM payments p JOIN checkouts c
          ON p.payment_on_id ~ '^[0-9a-f-]{36}$' AND c.id = p.payment_on_id::uuid
        WHERE p.created_at >= $1 AND p.created_at < $2 AND p.payment_on_type='Checkout'
          AND c.checkout_type IN (3,6)
        GROUP BY 1`, P)).rows;
      const CP = t => cp.find(r => Number(r.t) === t) || {};
      const st = (await db.source.query(`
        SELECT checkout_type AS t, coalesce(aasm_state,'(none)') s, count(*)::int n
        FROM checkouts WHERE created_at >= $1 AND created_at < $2 AND checkout_type IN (3,4,6)
        GROUP BY 1,2 ORDER BY 1, n DESC`, P)).rows;
      const C = t => co.find(r => Number(r.t) === t) || {};
      const stateSub = t => st.filter(r => Number(r.t) === t).slice(0, 4)
        .map(r => `${r.s} ${r.n}`).join(' · ') || null;
      /* ── guest payment journeys (recharge · bill) with the membership split ─────────────── */
      const pay = (await db.source.query(`
        SELECT CASE WHEN p.payment_on_type='recharge' THEN 'recharge' ELSE 'invoice' END AS flow,
               CASE WHEN p.customer_mobile_number IS NULL OR p.customer_mobile_number='' THEN 'no_mobile'
                    WHEN EXISTS (SELECT 1 FROM users u  WHERE u.mobile_number = p.customer_mobile_number) THEN 'account'
                    WHEN EXISTS (SELECT 1 FROM guests g WHERE g.mobile_number = p.customer_mobile_number) THEN 'guest'
                    ELSE 'no_record' END AS who,
               count(*)::int started,
               count(*) FILTER (WHERE p.status <> 'pending' OR ${ANS})::int engaged,
               count(*) FILTER (WHERE p.status='success')::int success,
               count(*) FILTER (WHERE p.status IN ('fail','failed'))::int failed,
               count(*) FILTER (WHERE p.status='pending' AND NOT ${ANS})::int abandoned
        FROM payments p
        WHERE p.created_at >= $1 AND p.created_at < $2 AND p.payment_on_type IN ('recharge','bill')
        GROUP BY 1,2`, P)).rows;
      const psum = (flow, col) => pay.filter(r => r.flow === flow)
        .reduce((a, r) => a + Number(r[col] || 0), 0);
      const whoSub = flow => {
        const m = {}; pay.filter(r => r.flow === flow).forEach(r => m[r.who] = (m[r.who] || 0) + Number(r.started || 0));
        const parts = [];
        if (m.account) parts.push(`${m.account.toLocaleString()} have an account`);
        if (m.guest) parts.push(`${m.guest.toLocaleString()} guest-only`);
        const none = (m.no_record || 0) + (m.no_mobile || 0);
        if (none) parts.push(`${none.toLocaleString()} no record`);
        return parts.join(' · ') || null;
      };
      /* ── register ───────────────────────────────────────────────────────────────────────── */
      const reg = (await db.source.query(
        `SELECT count(*)::int n FROM users WHERE created_at >= $1 AND created_at < $2`, P)).rows[0];
      /* ── track purchase (delivery progress of the orders being tracked) ─────────────────── */
      const del = (await db.source.query(`
        SELECT coalesce(delivery_state,'(none)') s, count(*)::int n
        FROM delivery_requests WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1 ORDER BY n DESC`, P)).rows;
      const dTot = del.reduce((a, r) => a + Number(r.n), 0);
      const dPick = re => del.filter(r => re.test(r.s)).reduce((a, r) => a + Number(r.n), 0);
      const dDelivered = dPick(/deliver/i) - dPick(/out.?for.?deliver/i);
      const dOut = dPick(/out.?for.?deliver/i);

      /* helpers to shape each journey exactly like the section's other rows */
      const payJourney = (key, flow, name, desc, screen) => {
        const started = psum(flow, 'started'), failed = psum(flow, 'failed'), abandoned = psum(flow, 'abandoned');
        return { key, j: key, name, desc,
          steps: [
            { k: 'start', label: screen, n: started, sub: whoSub(flow),
              err: abandoned, errLabel: 'left before paying' },
            { k: 'pay', label: 'Payment page (UPG)', n: psum(flow, 'engaged'),
              err: failed, errLabel: 'declined / failed' },
            { k: 'done', label: 'Payment success', n: psum(flow, 'success') },
          ],
          errSteps: (failed || abandoned) ? [
            { k: 'left', label: 'Left before paying', n: abandoned, err: abandoned,
              errLabel: 'no gateway answer', drill: 'recharge-errors', drillArg: `${flow}:left` },
            { k: 'declined', label: 'Payment declined', n: failed, err: failed,
              errLabel: 'declined by bank / gateway', drill: 'recharge-errors', drillArg: `${flow}:declined` },
          ] : null };
      };
      const coJourney = (key, t, flowKey, name, desc, screen, doneLabel) => {
        const r = C(t), p = CP(t);
        const started = Number(r.started || 0), failed = Number(p.failed || 0),
              abandoned = Number(p.abandoned || 0), paidNotDone = Number(r.paid_not_done || 0);
        return { key, j: key, name, desc,
          steps: [
            { k: 'start', label: screen, n: started, sub: stateSub(t) },
            { k: 'pay', label: 'Payment page (UPG)', n: Number(p.attempts || 0),
              sub: 'payments in window — includes retries & earlier checkouts',
              err: abandoned, errLabel: 'left before paying' },
            { k: 'paid', label: 'Paid', n: Number(p.paid || 0),
              err: failed, errLabel: 'declined / failed' },
            { k: 'done', label: doneLabel, n: Number(r.done || 0),
              err: paidNotDone, errLabel: 'paid but not completed' },
          ],
          errSteps: (failed || abandoned) ? [
            { k: 'left', label: 'Left before paying', n: abandoned, err: abandoned,
              errLabel: 'no gateway answer', drill: 'recharge-errors', drillArg: `${flowKey}:left` },
            { k: 'declined', label: 'Payment declined', n: failed, err: failed,
              errLabel: 'declined by bank / gateway', drill: 'recharge-errors', drillArg: `${flowKey}:declined` },
          ] : null };
      };
      const act = C(4);
      const flows = [
        coJourney('sim_swap', 3, 'sim_swap', 'Request a SIM swap',
          'Replacement SIM ordered without signing in — identity is verified in the flow, the fee is paid by card.',
          'SIM swap request', 'Swap completed'),
        coJourney('renewal', 6, 'renewal', 'Renew your plan',
          'Plan renewal paid by card or wallet without signing in.',
          'Renew plan', 'Plan renewed'),
        { key: 'activate_sim', j: 'activate_sim', name: 'Activate SIM card',
          desc: 'Activation of a purchased SIM. Mapping: checkouts type 4 — the only unmapped free checkout flow (zero payments in every probe window). Confirm the label with the delivery team before quoting it externally.',
          steps: [
            { k: 'start', label: 'Activate SIM', n: Number(act.started || 0), sub: stateSub(4) },
            { k: 'done', label: 'Activation completed', n: Number(act.done || 0) },
          ] },
        { key: 'register', j: 'register', name: 'Register to app',
          desc: 'New account creation. The OTP table mixes several journeys, so the OTP step is not attributed to registration.',
          steps: [
            { k: 'start', label: 'Enter details & OTP', n: null,
              note: 'otps mixes journeys — not attributable' },
            { k: 'done', label: 'Account created', n: Number(reg.n || 0) },
          ] },
        payJourney('recharge_guest', 'recharge', 'Recharge number',
          'Top-up of any prepaid number by card or wallet — no sign-in required.', 'Recharge number'),
        payJourney('invoice_guest', 'invoice', 'Pay your invoice',
          'Bill settlement by mobile number + national ID — no sign-in required.', 'Pay your invoice'),
        { key: 'track', j: 'track', name: 'Track purchase',
          desc: 'Order tracking by ID number — a pure read: the lookup writes no row, so what is counted is the delivery progress of orders in the window.',
          steps: [
            { k: 'start', label: 'Delivery requests', n: dTot,
              sub: del.slice(0, 4).map(r => `${r.s} ${r.n}`).join(' · ') || null },
            { k: 'out', label: 'Out for delivery', n: dOut },
            { k: 'done', label: 'Delivered', n: Math.max(0, dDelivered) },
          ] },
      ];
      return { from, to, flows,
        note: 'The app records no session state — payment rows show ALL payments of the journey, with the account-membership split of the paying number as context. Voucher recharge is covered in the Prepaid lane above.' };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/onboarding-flow', async (req, res) => {
  try {
    const [from, to] = flowWindow(req, await boardNow(req.query.sim));
    const plan = flowPlan(req); const { key, forms } = flowKey(req); const chan = flowChannel(req);
    // heaviest read in the console (~8s on 30d — correlated CTE over 8.2M orders) → cached
    res.json(await respCache.wrap(req, async () => {
      const filters = Object.entries(FLOW_PRED).map(([k, p]) => `count(*) FILTER (WHERE ${p})::int AS ${k}`).join(', ');
      const rows = (await db.source.query(`${FLOW_CTE('')} SELECT is_mnp, ${filters} FROM o GROUP BY is_mnp`, [from, to, FLOW_DEL_DONE, RESELLER_CHANNELS, plan, key, forms, chan])).rows;
      // TKT-000012: per-channel order counts for the window (chips over the tree). Grouped on the
      // stamped origin — same attribution rule as everywhere else, never plan_channels.
      let channels = [];
      try {
        channels = (await db.source.query(
          `SELECT lower(coalesce(external_service_name,'')) AS channel, count(*)::int AS n
             FROM onboarding_orders
            WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
            GROUP BY 1 ORDER BY n DESC LIMIT 12`, [from, to])).rows
          .map(x => ({ channel: x.channel === '' ? 'salam' : x.channel, n: Number(x.n) }));
      } catch (e) { channels = []; }
      const lane = mnp => { const r = rows.find(x => x.is_mnp === mnp) || {}; const o = {}; Object.keys(FLOW_PRED).forEach(k => o[k] = Number(r[k] || 0)); return o; };
      // Per-reseller split of the Courier-not-created backlog so the node tooltip can show
      // "tygo 104 · soob 2" — which reseller's courier dispatch is backed up, without a click.
      let partners = {};
      try {
        const pr = (await db.source.query(
          `${FLOW_CTE(`lower(coalesce(oo.external_service_name,'')) AS channel,`)}
           SELECT is_mnp, channel, count(*)::int AS n FROM o
            WHERE ${FLOW_PRED.courier_not_created} GROUP BY is_mnp, channel`,
          [from, to, FLOW_DEL_DONE, RESELLER_CHANNELS, plan, key, forms, chan])).rows;
        for (const x of pr) {
          const k = x.is_mnp ? 'mnp' : 'newsim';
          (partners[k] || (partners[k] = {}))[x.channel] = Number(x.n);
        }
      } catch (e) { partners = {}; }
      return { from, to, channel: chan === '' ? 'salam' : (chan || null), channels, lanes: [
        { key: 'newsim', label: 'New SIM', nodes: lane(false), partners: partners.newsim || {} },
        { key: 'mnp', label: 'MNP', nodes: lane(true), partners: partners.mnp || {} }] };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/onboarding-flow/orders', async (req, res) => {
  try {
    const { lane, node } = req.query;
    const pred = FLOW_PRED[node]; if (!pred) return res.status(400).json({ error: 'unknown node' });
    const [from, to] = flowWindow(req, await boardNow(req.query.sim));
    const plan = flowPlan(req); const { key, forms } = flowKey(req); const chan = flowChannel(req);
    const lanePred = lane === 'mnp' ? 'is_mnp' : 'NOT is_mnp';
    const r = await db.source.query(
      `${FLOW_CTE(`oo.id::text AS id, oo.mobile_number AS mobile, oo.created_at AS at, oo.aasm_state AS state, oo.plan_id,
                   lower(coalesce(oo.external_service_name,'')) AS channel,`)}
       SELECT id, mobile, at, state, plan_id, pay, channel FROM o WHERE ${lanePred} AND ${pred} ORDER BY at DESC LIMIT 200`,
      [from, to, FLOW_DEL_DONE, RESELLER_CHANNELS, plan, key, forms, chan]);
    // `channel` lets the drawer segregate tygo vs soob rather than lumping them as "Partner"
    const pmap = await plans.loadMap();
    const rows = r.rows.map(x => ({ id: x.id, mobile: x.mobile, at: x.at, state: x.state, plan_id: x.plan_id, plan: plans.label(pmap, x.plan_id), pay: x.pay, channel: x.channel || null }));
    // masked by default even for supers — the global PII switch (Settings → User management) or a
    // per-page toggle adds ?unmask=1; capability alone no longer auto-unmasks
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    res.json({ rows: roles.maskDeep(rows, allowUnmask), unmasked: allowUnmask, total: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* Locate an order in the flow by MSISDN or national ID — "where did this customer stop/end?"
 * Resolves every order for the identifier (all MSISDN forms OR national id), classifies each into its
 * deepest flow node via classifyFlow(), and returns lane + node so the UI can highlight the box.
 * Ignores the time window & plan filter on purpose — you want to find the order wherever it is. */
app.get('/api/onboarding-flow/locate', async (req, res) => {
  try {
    const key = String(req.query.key || '').trim();
    if (!key) return res.json({ key, matches: [] });
    const forms = (v => { const d = String(v).replace(/\D/g, '');
      if (!/^(?:966|0)?5\d{8}$/.test(d)) return [String(v)];
      const l9 = d.slice(-9); return ['0' + l9, '966' + l9, l9, '+966' + l9]; })(key);
    const r = await db.source.query(
      `SELECT oo.id::text AS id, ((oo.number_order_type=1) IS TRUE) AS is_mnp, oo.mobile_number AS mobile,
              oo.nationality_id_number AS nid, oo.plan_id, oo.created_at AS at, oo.aasm_state AS state,
              (NULLIF(trim(oo.nationality_id_number),'') IS NOT NULL) AS id_submitted,
              oo.is_eligible AS eligible, (oo.sim_type=1) AS esim, oo.activated AS activated,
              (SELECT CASE WHEN bool_or(p.status='success') THEN 'success'
                           WHEN bool_or(p.status='pending') THEN 'pending'
                           WHEN bool_or(p.status IN ('fail','failed')) THEN 'fail' ELSE 'none' END
                 FROM payments p WHERE p.payment_on_type='OnboardingOrder' AND p.payment_on_id = oo.id::text) AS pay,
              (lower(coalesce(oo.external_service_name,'')) = ANY($2::text[])) AS partner,
              (lower(coalesce(oo.extra->>'apollo_require_delivery','')) IN ('false','f','0')) AS shop_deliv,
              EXISTS(SELECT 1 FROM delivery_requests d WHERE d.delivery_on_id = oo.id::text) AS assigned,
              EXISTS(SELECT 1 FROM delivery_requests d WHERE d.delivery_on_id = oo.id::text AND d.delivery_state = ANY($3)) AS delivered
         FROM onboarding_orders oo
        WHERE oo.mobile_number = ANY($1::text[]) OR oo.nationality_id_number = $4
        ORDER BY oo.created_at DESC LIMIT 25`,
      [forms, RESELLER_CHANNELS, FLOW_DEL_DONE, key]);
    const pmap = await plans.loadMap();
    const matches = r.rows.map(o => ({
      id: o.id, lane: o.is_mnp ? 'mnp' : 'newsim', node: classifyFlow(o),
      mobile: o.mobile, nationality_id_number: o.nid, plan_id: o.plan_id, plan: plans.label(pmap, o.plan_id),
      state: o.state, at: o.at, pay: o.pay
    }));
    const allowUnmask = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    res.json({ key, matches: roles.maskDeep(matches, allowUnmask), unmasked: allowUnmask, total: matches.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* Port-ins by donor operator — MNP orders (number_order_type=1) grouped by onboarding_orders.mnp_operator,
 * with eligibility / completion / activation counts so you can see WHERE subscribers are porting from and
 * which donor has the worst porting success. Same window logic as the onboarding funnel. */
app.get('/api/growth/mnp-donors', async (req, res) => {
  try {
    const [from, to] = flowWindow(req, await boardNow(req.query.sim));
    const rows = (await db.source.query(
      `SELECT COALESCE(NULLIF(TRIM(mnp_operator), ''), '—') AS operator,
              count(*)::int AS total,
              count(*) FILTER (WHERE is_eligible)::int AS eligible,
              count(*) FILTER (WHERE completed)::int AS completed,
              count(*) FILTER (WHERE activated)::int AS activated
         FROM onboarding_orders
        WHERE number_order_type = 1
          AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
        GROUP BY 1 ORDER BY total DESC`, [from, to])).rows;
    const totalPortins = rows.reduce((s, r) => s + r.total, 0);
    const overallActivated = rows.reduce((s, r) => s + r.activated, 0);
    const donors = rows.map(r => ({
      operator: r.operator, total: r.total, eligible: r.eligible, completed: r.completed, activated: r.activated,
      share: totalPortins ? r.total / totalPortins : 0,
      activationRate: r.total ? r.activated / r.total : 0,
      completionRate: r.total ? r.completed / r.total : 0
    }));
    res.json({ from, to, totalPortins, overallActivationRate: totalPortins ? overallActivated / totalPortins : 0,
      topDonor: donors[0] ? donors[0].operator : null, donors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Incomplete / stuck onboarding orders (created but not completed+activated), oldest-stuck first, with age
app.get('/api/incomplete-orders', async (req, res) => {
  try {
    const now = await boardNow(req.query.sim);
    const nISO = now && now.toISOString ? now.toISOString() : (now || new Date().toISOString());
    const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours) || 48));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 40));
    const from = new Date(new Date(nISO).getTime() - hours * 3600e3).toISOString();
    const r = await db.source.query(
      `SELECT id::text, mobile_number,
              CASE number_order_type WHEN 1 THEN 'MNP' ELSE 'New SIM' END AS channel,
              CASE sim_type WHEN 1 THEN 'eSIM' ELSE 'Physical' END AS sim,
              coalesce(status,'—') AS status, is_eligible, created_at,
              EXTRACT(EPOCH FROM ($1::timestamptz - created_at))::bigint AS age_sec
       FROM onboarding_orders
       WHERE created_at >= $2::timestamptz AND created_at < $1::timestamptz
         AND coalesce(completed,false)=false AND coalesce(activated,false)=false
       ORDER BY created_at ASC LIMIT $3`, [nISO, from, limit]);
    res.json({ now: nISO, hours, orders: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// fast time series from rollups: /api/kpi/series?journey=payment&outcome=ok,fail&grain=hour|day&window=168
app.get('/api/kpi/series', async (req, res) => {
  try {
    const now = await boardNow(req.query.sim);
    const win = Math.max(1, Number(req.query.window || 168));
    const grain = req.query.grain === 'day' ? 'day' : 'hour';
    const journey = req.query.journey;
    const from = new Date(new Date(now).getTime() - win * 3600e3).toISOString();
    const params = [from, now];
    let jClause = '';
    if (journey) { params.push(journey); jClause = `AND journey = $${params.length}`; }
    const r = await C.query(
      `SELECT date_trunc('${grain}', hour) AS t, outcome, sum(cnt)::bigint c
       FROM rollup_hourly WHERE hour >= $1 AND hour < $2 ${jClause}
       GROUP BY 1,2 ORDER BY 1`, params);
    res.json({ now, from, grain, journey: journey || null, points: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SLA/SLO board — attainment + error budgets per journey
app.get('/api/slo', requireRoot('sla'), async (req, res) => {
  try { res.json(await slo.evaluate(await boardNow(req.query.sim))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// vendor / integration health board
app.get('/api/vendors', async (req, res) => {
  try { res.json(await slo.vendorHealth(await boardNow(req.query.sim), Number(req.query.window || 24))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// NOC summary — one call powering the home status banner (health + incidents + worst signal + data freshness)
app.get('/api/noc', async (req, res) => {
  try {
    const now = await boardNow(req.query.sim);
    const nISO = now && now.toISOString ? now.toISOString() : (now || new Date().toISOString());
    // open incidents by severity
    const inc = { open: 0, p1: 0, p2: 0 };
    try { (await C.query(`SELECT severity, count(*)::int c FROM alerts WHERE status='open' GROUP BY severity`)).rows
      .forEach(x => { inc.open += x.c; if (x.severity === 'P1') inc.p1 += x.c; else if (x.severity === 'P2') inc.p2 += x.c; }); } catch (e) {}
    // SLO breached / at-risk
    let breached = [], atRisk = [];
    try { const s = await slo.evaluate(nISO);
      const pick = st => s.slos.filter(x => x.status === st).map(x => ({ journey: x.journey, label: x.label, attainment: x.attainment, target: x.target }));
      breached = pick('breached'); atRisk = pick('at_risk');
    } catch (e) {}
    // worst vendor/integration (last 24h, enough sample)
    let worstVendor = null;
    try { const v = await slo.vendorHealth(nISO, 24);
      const all = [...(v.paymentVendors || []), ...(v.couriers || []), ...(v.integrations || [])].filter(x => x.rate != null && x.total >= 20).sort((a, b) => a.rate - b.rate);
      if (all.length && all[0].rate < 0.9) worstVendor = { name: all[0].vendor || all[0].journey, rate: all[0].rate };
    } catch (e) {}
    // per-source data freshness
    const SRC = [['payments', 'payments'], ['orders', 'onboarding_orders'], ['activation', 'activation_logs'], ['nafath', 'nafath_logs'], ['delivery', 'delivery_requests'], ['plan change', 'change_plan_logs'], ['eligibility', 'eligibility_logs'], ['checkouts', 'checkouts']];
    let sources = [];
    try {
      const q = SRC.map(([lbl, tbl]) => `SELECT '${lbl}' n, max(created_at) m FROM ${tbl}`).join(' UNION ALL ');
      // MUST measure against real wall-clock, not boardNow: boardNow is clamped to the newest
      // data row, so lag against it is always ~0 and staleness could never be detected.
      const nowMs = Date.now();
      sources = (await db.source.query(q)).rows.map(x => ({
        name: x.n,
        ksa: x.m ? new Date(x.m).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }) : null,
        lagMin: x.m ? Math.max(0, Math.round((nowMs - new Date(x.m).getTime()) / 60000)) : null }));
    } catch (e) {}
    /* "Is the data stale?" must be answered by the SYNC, not by row age. Low-volume tables
     * (delivery ≈ 4 rows/hour) naturally have 40+ min gaps overnight — that is quiet traffic,
     * not a broken pipeline, and flagging it cried wolf on every early-morning dashboard.
     * Authoritative signal = how long since prod-sync last completed successfully. */
    let syncLagMin = null;
    try {
      // NOT filtered to last_status='ok': while a sync is in flight every row is 'running',
      // which made this return NULL and the banner print "our sync ran nullm ago".
      const r = await C.query(`SELECT max(last_run_at) AS t FROM prod_sync_state`);
      if (r.rows[0] && r.rows[0].t) syncLagMin = Math.max(0, Math.round((Date.now() - new Date(r.rows[0].t).getTime()) / 60000));
    } catch (e) {}
    /* Second failure mode: our sync is healthy but the UPSTREAM prod reporting replica is stale,
     * so we faithfully copy old data. Row-age can't be trusted on low-volume tables (delivery
     * ≈4/hour) — but payments/orders run continuously, so if THOSE are far behind, the pipeline
     * really is stale regardless of what the sync clock says. */
    const HIGH_VOLUME = new Set(['payments', 'orders']);
    const oldestRow = sources.filter(s => s.lagMin != null).sort((a, b) => b.lagMin - a.lagMin)[0] || null;
    const hv = sources.filter(s => HIGH_VOLUME.has(s.name) && s.lagMin != null)
      .sort((a, b) => b.lagMin - a.lagMin)[0] || null;
    const HV_STALE_MIN = Number(process.env.UPSTREAM_STALE_MIN || 60);

    let oldest;
    if (hv && hv.lagMin >= HV_STALE_MIN && (syncLagMin == null || syncLagMin < 30)) {
      // sync is running fine, yet a continuously-written table is far behind → upstream is stale
      oldest = { name: hv.name, lagMin: hv.lagMin, ksa: hv.ksa, upstream: true, syncLagMin };
    } else if (syncLagMin != null) {
      oldest = { name: 'prod-sync', lagMin: syncLagMin, ksa: null, bySync: true,
        quietest: oldestRow ? { name: oldestRow.name, lagMin: oldestRow.lagMin } : null };
    } else {
      oldest = oldestRow;   // static/replay dataset — no sync clock to trust
    }
    // name the most-impacting open incident, preferring a provider ROOT cause over a symptom
    let topOpen = null;
    try { topOpen = (await C.query(
      `SELECT name FROM alerts WHERE status='open'
        ORDER BY (rule_key = ANY($1)) DESC,
                 CASE severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, fired_at ASC LIMIT 1`,
      [correlation.ROOTS])).rows[0]; } catch (e) {}
    // overall status
    let status = 'ok', headline = 'All systems healthy';
    /* Stale data outranks everything: if the pipeline is frozen, every OTHER number on this
     * console is wrong-but-plausible — the most dangerous state there is. Treat it as an incident,
     * not a footnote, so nobody makes decisions on hours-old figures thinking they are live. */
    if (oldest && oldest.upstream) {
      status = 'incident';
      headline = `DATA ${Math.round(oldest.lagMin / 60)}h BEHIND — upstream prod source is lagging; newest ${oldest.name} row is ${oldest.lagMin}m old. Figures are NOT live.`;
    }
    else if (inc.p1 > 0) { status = 'incident'; headline = topOpen ? `${inc.p1} P1 · ${topOpen.name} — page on-call` : `${inc.p1} P1 incident${inc.p1 > 1 ? 's' : ''} open — page on-call`; }
    else if (inc.p2 > 0 || breached.length || atRisk.length || worstVendor || (oldest && oldest.lagMin > 60)) { status = 'degraded';
      headline = inc.p2 > 0 ? `${inc.p2} P2 alert${inc.p2 > 1 ? 's' : ''} open`
        : breached.length ? `${breached[0].label} below SLA — ${Math.round(breached[0].attainment * 100)}% vs ${Math.round(breached[0].target * 100)}% target`
        : atRisk.length ? `${atRisk[0].label} approaching SLA — ${Math.round(atRisk[0].attainment * 100)}%`
        : worstVendor ? `${worstVendor.name} degraded — ${Math.round(worstVendor.rate * 100)}%`
        : oldest.bySync ? `Data lag — last successful prod-sync ${oldest.lagMin}m ago`
        : `Data lag — ${oldest.name} is ${oldest.lagMin}m behind`;
    }
    res.json({ now: nISO, status, headline, incidents: inc, slo: { breached, atRisk }, worstVendor, freshness: { sources, oldest } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Operator health self-check — one call that tells you whether the tooling itself is healthy:
// replica freshness, prod-sync, console DB, alert engine, and each notification channel + integration key.
// Reports presence/health only (booleans + lag), never secret values. Admin-only.
app.get('/api/health/selfcheck', requireCap('manageUsers'), async (req, res) => {
  const nowMs = Date.now();
  const checks = [];
  const push = (key, label, status, detail) => checks.push({ key, label, status, detail });

  // 1) Prod replica freshness (source of every KPI/alert)
  try {
    const SRC = [['payments', 'payments'], ['orders', 'onboarding_orders'], ['activation', 'activation_logs'], ['nafath', 'nafath_logs'], ['delivery', 'delivery_requests']];
    const q = SRC.map(([lbl, tbl]) => `SELECT '${lbl}' n, max(created_at) m FROM ${tbl}`).join(' UNION ALL ');
    const rows = (await db.source.query(q)).rows.map(x => ({ name: x.n, lagMin: x.m ? Math.max(0, Math.round((nowMs - new Date(x.m).getTime()) / 60000)) : null }));
    const oldest = rows.filter(s => s.lagMin != null).sort((a, b) => b.lagMin - a.lagMin)[0];
    if (!oldest) push('replica', 'Prod replica', 'fail', 'No data returned from the replica');
    else push('replica', 'Prod replica', oldest.lagMin > 120 ? 'fail' : oldest.lagMin > 60 ? 'warn' : 'ok', `Oldest source: ${oldest.name} ${oldest.lagMin}m behind`);
  } catch (e) { push('replica', 'Prod replica', 'fail', 'Replica unreachable: ' + e.message); }

  // 2) Prod-sync job (last run)
  try {
    const r = (await C.query(`SELECT sim_now, finished_at, metrics_written FROM sync_runs ORDER BY id DESC LIMIT 1`)).rows[0];
    if (!r) push('prodsync', 'Sync job', 'warn', 'No sync runs recorded yet');
    else if (!r.finished_at) push('prodsync', 'Sync job', 'warn', 'Last run still in progress or did not finish');
    else { const ageMin = Math.round((nowMs - new Date(r.finished_at).getTime()) / 60000); push('prodsync', 'Sync job', ageMin > 30 ? 'warn' : 'ok', `Last run ${ageMin}m ago · ${r.metrics_written || 0} metrics written`); }
  } catch (e) { push('prodsync', 'Sync job', 'warn', 'sync_runs unavailable: ' + e.message); }

  // 3) Console DB
  try { await C.query('SELECT 1'); push('console_db', 'Console DB', 'ok', 'Reachable'); }
  catch (e) { push('console_db', 'Console DB', 'fail', 'Unreachable: ' + e.message); }

  // 4) Alert engine (rules + recent evaluation)
  try {
    const rc = (await C.query(`SELECT count(*)::int c FROM alert_rules WHERE enabled`)).rows[0].c;
    let lastEval = null;
    try { lastEval = (await C.query(`SELECT max(created_at) m FROM metric_snapshots`)).rows[0].m; } catch (e) {}
    const ageMin = lastEval ? Math.round((nowMs - new Date(lastEval).getTime()) / 60000) : null;
    const st = rc === 0 ? 'fail' : (ageMin == null || ageMin > 30) ? 'warn' : 'ok';
    push('alert_engine', 'Alert engine', st, `${rc} rules enabled` + (ageMin != null ? ` · last evaluation ${ageMin}m ago` : ' · no snapshots yet'));
  } catch (e) { push('alert_engine', 'Alert engine', 'warn', 'Could not read rules: ' + e.message); }

  // 5) ChatOps notification channels
  try {
    const cfg = await chatops.getConfig();
    const chans = [];
    if (cfg.teamsUrl) chans.push('Teams');
    if (cfg.slackUrl) chans.push('Slack');
    if (cfg.waPhoneId && cfg.waToken && cfg.waTo) chans.push('WhatsApp');
    const smsReady = !!(process.env.SMS_URL && process.env.SMS_APPSID) && !!(cfg.smsTo || process.env.SMS_TO) && cfg.smsEnabled;
    if (smsReady) chans.push('SMS');
    const st = !cfg.enabled ? 'warn' : chans.length === 0 ? 'warn' : 'ok';
    push('chatops', 'ChatOps notify', st, (cfg.enabled ? 'Enabled' : 'Disabled') + ' · ' + (chans.length ? chans.join(' · ') : 'no channels configured'));
  } catch (e) { push('chatops', 'ChatOps notify', 'warn', 'Config unreadable: ' + e.message); }

  // 6) SMS creds (Unifonic) — high-severity paging path
  {
    const creds = !!(process.env.SMS_URL && process.env.SMS_APPSID);
    push('sms', 'SMS paging (Unifonic)', creds ? 'ok' : 'off', creds ? 'Credentials present' : 'SMS_URL / SMS_APPSID not set (optional)');
  }

  // 7) ServiceNow ticket correlation (read-only)
  {
    const ok = !!(process.env.SN_URL && process.env.SN_USER && process.env.SN_PASS);
    push('servicenow', 'ServiceNow link', ok ? 'ok' : 'off', ok ? 'Configured (read-only correlation)' : 'SN_URL / SN_USER / SN_PASS not set (optional)');
  }

  // 8) Tap reconciliation key
  {
    const ok = !!process.env.TAP_SECRET_KEY;
    push('tap_recon', 'Tap reconciliation', ok ? 'ok' : 'off', ok ? 'TAP_SECRET_KEY present' : 'TAP_SECRET_KEY not set (Tap recon disabled)');
  }

  // 9) Semati synthetic canary — live probe status (off-peak lead time; see INC0012977)
  {
    try {
      const st = require('./sematiProbe').status();
      if (!st.configured) push('semati_canary', 'Semati canary', 'off', 'Not configured — set SEMATI_PROBE_LOGIN_URL to probe (recommended for off-peak lead time)');
      else if (st.paged) push('semati_canary', 'Semati canary', 'fail', `PROBE PAGED — ${st.streak} consecutive fails${st.last && st.last.note ? ' · ' + st.last.note : ''}`);
      else { const last = st.last; push('semati_canary', 'Semati canary', last && !last.ok ? 'warn' : 'ok',
        last ? `probing every ${st.intervalSec}s · last: ${last.layer} (${last.note})` : `configured · every ${st.intervalSec}s · awaiting first probe`); }
    } catch (e) { push('semati_canary', 'Semati canary', 'off', 'status unavailable'); }
  }

  const summary = checks.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
  res.json({ now: new Date().toISOString(), checks, summary });
});
// Semati canary (synthetic probe) live status — powers the Settings health self-check + a small indicator
app.get('/api/semati-probe/status', async (req, res) => {
  try { res.json(require('./sematiProbe').status()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Growth analytics: resellers (flow_type + channel) + campaigns (UTM) + correlation ----
const FLOW_LABELS = { 0: 'Normal (direct)', 1: 'Indirect (dealer)', 2: 'POSA (retail)', 3: 'Apollo (referral)', 4: 'Ownership transfer', 5: 'Partner', 6: 'Visitor Hajj', 7: 'QR POSA' };
const RESELLER_FLOWS = new Set([1, 2, 3, 5, 7]);   // reseller/indirect sales paths (exclude normal + ownership_transfer)
const RESELLER_CHANNELS = ['tygo', 'soob'];        // the actual reseller channels (extend as new resellers onboard)

// Turn a raw agency UTM campaign code into a readable business label.
// e.g. "an-salam_itc_ar-mvs_cn-b2c_repositioning-campaign_mk-sa_ca-tactical_qu-q4_yr-25" → "B2C · Repositioning · Tactical · Q4'25 (AR)"
//      "mobile-demandgen-prospecting-ar" → "Demand Gen · Prospecting · Mobile (AR)"
function humanizeCampaign(raw) {
  if (!raw || raw === '(none)') return 'Untagged';
  let s; try { s = decodeURIComponent(String(raw).replace(/\+/g, ' ')); } catch (_) { s = String(raw).replace(/\+/g, ' '); }
  const low = s.toLowerCase().replace(/[_~]+/g, '-');   // '_' and '~' are regex word-chars → normalise so \b boundaries work
  const parts = [];
  if (/\bb2c\b/.test(low)) parts.push('B2C'); else if (/\bb2b\b/.test(low)) parts.push('B2B');
  if (/reposition/.test(low)) parts.push('Repositioning');
  else if (/branded/.test(low)) parts.push('Branded');
  else if (/generic/.test(low)) parts.push('Generic');
  else if (/demand.?gen/.test(low)) parts.push('Demand Gen');
  if (/prospect/.test(low)) parts.push('Prospecting');
  else if (/remarket|retarget/.test(low)) parts.push('Remarketing');
  if (/tactical/.test(low)) parts.push('Tactical');
  if (/\bmobile\b|mobhom/.test(low)) parts.push('Mobile');
  const q = low.match(/\bq([1-4])\b/); const ym = low.match(/yr[-_ ]?(2[0-9])/);
  let period = q ? 'Q' + q[1] : ''; if (ym) period += (period ? "'" : "'") + ym[1];
  const lang = /(^|[-_ ~])en([-_ ~]|$)/.test(low) ? 'EN' : /(^|[-_ ~])ar([-_ ~]|$)/.test(low) ? 'AR' : '';
  let label = [...new Set(parts)].join(' · ');
  if (period) label += (label ? ' · ' : '') + period;
  if (lang) label += (label ? ' ' : '') + '(' + lang + ')';
  if (!label) label = s.replace(/[~_+]+/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
  return label || 'Untagged';
}
app.get('/api/growth/summary', async (req, res) => {
  try {
    const S = db.source;
    const now = await boardNow(req.query.sim);
    const nISO = now && now.toISOString ? now.toISOString() : now;
    const to = req.query.to ? new Date(req.query.to).toISOString() : nISO;
    const from = req.query.from ? new Date(req.query.from).toISOString() : new Date(new Date(to).getTime() - 30 * 24 * 3600e3).toISOString();
    const W = `o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz`;
    const P = [from, to];

    // reseller funnel by flow_type (+ revenue via plan price on activation)
    const ft = (await S.query(
      `SELECT o.flow_type, count(*) created, count(*) FILTER (WHERE o.completed) completed,
              count(*) FILTER (WHERE o.activated) activated, coalesce(sum(p.price) FILTER (WHERE o.activated),0) revenue
       FROM onboarding_orders o LEFT JOIN plans p ON p.id=o.plan_id WHERE ${W} GROUP BY o.flow_type`, P)).rows;
    const flowTypes = ft.map(r => ({ key: Number(r.flow_type), label: FLOW_LABELS[r.flow_type] || ('flow ' + r.flow_type),
      created: +r.created, completed: +r.completed, activated: +r.activated,
      convRate: +r.created ? +r.activated / +r.created : null, revenue: +r.revenue })).sort((a, b) => b.activated - a.activated);

    // reseller channels by the order's ACTUAL origin app: external_service_name (= App.name.downcase,
    // stamped at creation, e.g. apollo_order_manager: onboarding_orders.new(external_service_name:...)).
    // Each order has exactly ONE external_service_name, so no fan-out / double-count.
    // NOTE: do NOT use plan_channels — that is "which channels MAY sell this plan" (config, many-per-plan);
    // joining it counts one order under every enabled channel, which massively inflated e.g. soob.
    let channels = [];
    try { channels = (await S.query(
      `SELECT lower(o.external_service_name) channel, count(*) orders,
              count(*) FILTER (WHERE o.activated) activated,
              coalesce(sum(p.price) FILTER (WHERE o.activated),0) revenue
       FROM onboarding_orders o LEFT JOIN plans p ON p.id=o.plan_id
       WHERE ${W} AND lower(o.external_service_name) = ANY($3::text[])
       GROUP BY lower(o.external_service_name) ORDER BY activated DESC`, [...P, RESELLER_CHANNELS])).rows
      .map(r => ({ channel: r.channel, orders: +r.orders, activated: +r.activated, revenue: +r.revenue })); } catch (e) { channels = []; }

    const totalCreated = flowTypes.reduce((a, f) => a + f.created, 0);
    const totalActivated = flowTypes.reduce((a, f) => a + f.activated, 0);
    const resFlows = flowTypes.filter(f => RESELLER_FLOWS.has(f.key));
    const topReseller = resFlows.slice().sort((a, b) => b.activated - a.activated)[0];

    // campaigns: source × medium
    const sm = (await S.query(
      `SELECT coalesce(nullif(o.utm_source,''),'(organic)') source, coalesce(nullif(o.utm_medium,''),'—') medium,
              count(*) orders, count(*) FILTER (WHERE o.activated) activated
       FROM onboarding_orders o WHERE ${W} GROUP BY 1,2 ORDER BY orders DESC LIMIT 30`, P)).rows
      .map(r => ({ source: r.source, medium: r.medium, orders: +r.orders, activated: +r.activated, convRate: +r.orders ? +r.activated / +r.orders : null }));

    // campaign leaderboard (named campaigns only)
    const camp = (await S.query(
      `SELECT coalesce(nullif(o.utm_campaign,''),'(none)') campaign, coalesce(nullif(o.utm_source,''),'(organic)') source,
              count(*) orders, count(*) FILTER (WHERE o.activated) activated, coalesce(sum(p.price) FILTER (WHERE o.activated),0) revenue
       FROM onboarding_orders o LEFT JOIN plans p ON p.id=o.plan_id
       WHERE ${W} AND coalesce(o.utm_campaign,'')<>'' GROUP BY 1,2 ORDER BY orders DESC LIMIT 20`, P)).rows
      .map(r => ({ campaign: r.campaign, label: humanizeCampaign(r.campaign), source: r.source, orders: +r.orders, activated: +r.activated, convRate: +r.orders ? +r.activated / +r.orders : null, revenue: +r.revenue }));

    // paid vs organic
    const pv = (await S.query(`SELECT (coalesce(o.utm_source,'')<>'') paid, count(*) orders, count(*) FILTER (WHERE o.activated) activated FROM onboarding_orders o WHERE ${W} GROUP BY 1`, P)).rows;
    const paid = pv.find(r => r.paid === true) || { orders: 0, activated: 0 };
    const organic = pv.find(r => r.paid === false) || { orders: 0, activated: 0 };

    // correlation matrix: flow_type × source (activations)
    const mx = (await S.query(`SELECT o.flow_type, coalesce(nullif(o.utm_source,''),'(organic)') source, count(*) FILTER (WHERE o.activated) activated FROM onboarding_orders o WHERE ${W} GROUP BY 1,2`, P)).rows;
    const srcTotals = {}; mx.forEach(r => { srcTotals[r.source] = (srcTotals[r.source] || 0) + +r.activated; });
    const cols = Object.entries(srcTotals).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
    const cells = flowTypes.map(f => cols.map(src => { const m = mx.find(r => Number(r.flow_type) === f.key && r.source === src); return m ? +m.activated : 0; }));

    res.json({
      now: nISO, from, to,
      resellers: { flowTypes, channels,
        scorecard: { totalCreated, totalActivated, resellerOrders: resFlows.reduce((a, f) => a + f.created, 0),
          resellerActivated: resFlows.reduce((a, f) => a + f.activated, 0),
          resellerSharePct: totalActivated ? Math.round(resFlows.reduce((a, f) => a + f.activated, 0) * 100 / totalActivated) : 0,
          topReseller: topReseller ? topReseller.label : null } },
      campaigns: { sources: sm, campaigns: camp,
        paidVsOrganic: { paidOrders: +paid.orders, paidActivated: +paid.activated, organicOrders: +organic.orders, organicActivated: +organic.activated },
        scorecard: { campaignOrders: +paid.orders, campaignActivated: +paid.activated,
          bestSource: (sm.filter(s => s.source !== '(organic)').sort((a, b) => (b.convRate || 0) - (a.convRate || 0))[0] || {}).source || null,
          topCampaign: camp[0] ? camp[0].label : null } },
      matrix: { rows: flowTypes.map(f => f.label), cols, cells }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Apollo referrals — referrer leaderboard + trend + list. Apollo = flow_type 3; referral code in extra->>'referral_code'.
app.get('/api/growth/referrals', async (req, res) => {
  try {
    const S = db.source;
    const now = await boardNow(req.query.sim);
    const nISO = now && now.toISOString ? now.toISOString() : now;
    const to = req.query.to ? new Date(req.query.to).toISOString() : nISO;
    const from = req.query.from ? new Date(req.query.from).toISOString() : new Date(new Date(to).getTime() - 30 * 24 * 3600e3).toISOString();
    const W = `o.flow_type = 3 AND o.created_at >= $1::timestamptz AND o.created_at < $2::timestamptz`;
    const P = [from, to];

    const referrers = (await S.query(
      `SELECT coalesce(nullif(o.extra->>'referral_code',''),'(unattributed)') referrer,
              count(*) orders, count(*) FILTER (WHERE o.completed) completed, count(*) FILTER (WHERE o.activated) activated,
              coalesce(sum(p.price) FILTER (WHERE o.activated),0) revenue
       FROM onboarding_orders o LEFT JOIN plans p ON p.id=o.plan_id
       WHERE ${W} GROUP BY 1 ORDER BY activated DESC, orders DESC LIMIT 50`, P)).rows
      .map(r => ({ referrer: r.referrer, orders: +r.orders, completed: +r.completed, activated: +r.activated, convRate: +r.orders ? +r.activated / +r.orders : null, revenue: +r.revenue }));

    const trend = (await S.query(
      `SELECT to_char(o.created_at AT TIME ZONE 'Asia/Riyadh','MM-DD') d,
              count(*) orders, count(*) FILTER (WHERE o.activated) activated
       FROM onboarding_orders o WHERE ${W} GROUP BY 1 ORDER BY 1`, P)).rows
      .map(r => ({ d: r.d, orders: +r.orders, activated: +r.activated }));

    const list = (await S.query(
      `SELECT o.id::text, o.created_at AS at, coalesce(nullif(o.extra->>'referral_code',''),'—') referrer,
              o.aasm_state AS status, o.completed, o.activated, coalesce(p.title->>'en', p.title->>'ar','—') AS plan
       FROM onboarding_orders o LEFT JOIN plans p ON p.id=o.plan_id
       WHERE ${W} ORDER BY o.created_at DESC LIMIT 100`, P)).rows;

    const totalOrders = referrers.reduce((a, r) => a + r.orders, 0);
    const totalActivated = referrers.reduce((a, r) => a + r.activated, 0);
    const totalRevenue = referrers.reduce((a, r) => a + r.revenue, 0);
    const top = referrers.find(r => r.referrer !== '(unattributed)') || referrers[0];
    res.json({
      now: nISO, from, to,
      scorecard: { referrers: referrers.filter(r => r.referrer !== '(unattributed)').length, totalOrders, totalActivated,
        convRate: totalOrders ? totalActivated / totalOrders : null, revenue: totalRevenue, topReferrer: top ? top.referrer : null },
      referrers, trend, list
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Editable error-code labels (shown as "code - meaning" on error charts)
app.get('/api/error-codes', async (req, res) => {
  try { res.json({ codes: (await C.query(`SELECT code, label, area FROM error_codes ORDER BY code`)).rows }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/error-codes', requireCap('manageSync'), async (req, res) => {
  try {
    const b = req.body || {}; if (!b.code || !b.label) return res.status(400).json({ error: 'code and label required' });
    await C.query(`INSERT INTO error_codes (code,label,area) VALUES ($1,$2,$3)
      ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, area=EXCLUDED.area, updated_at=now()`,
      [String(b.code).slice(0, 40), String(b.label).slice(0, 160), b.area ? String(b.area).slice(0, 40) : null]);
    await audit(req, 'errorcode.set', String(b.code), { label: b.label });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/error-codes/:code', requireCap('manageSync'), async (req, res) => {
  try { await C.query(`DELETE FROM error_codes WHERE code=$1`, [req.params.code]); await audit(req, 'errorcode.delete', req.params.code, null); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// bulk import: paste "code, meaning[, area]" (or code=meaning / code<TAB>meaning) per line
app.post('/api/error-codes/bulk', requireCap('manageSync'), async (req, res) => {
  try {
    const rows = [];
    String((req.body || {}).text || '').split(/\r?\n/).forEach(line => {
      const l = line.trim(); if (!l || l.startsWith('#')) return;
      const m = l.split(/\s*[,=\t]\s*/);
      if (m.length < 2) return;
      const code = m[0].trim(), label = m[1].trim(), area = m[2] ? m[2].trim() : null;
      if (code && label) rows.push({ code: code.slice(0, 40), label: label.slice(0, 160), area: area ? area.slice(0, 40) : null });
    });
    let n = 0;
    for (const r of rows) { await C.query(`INSERT INTO error_codes (code,label,area) VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, area=EXCLUDED.area, updated_at=now()`, [r.code, r.label, r.area]); n++; }
    await audit(req, 'errorcode.bulk', null, { count: n });
    res.json({ imported: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Ops event timeline — markers on all time-series charts (deploys / campaigns / maintenance)
app.get('/api/events', async (req, res) => {
  try {
    const from = req.query.from && !isNaN(new Date(req.query.from)) ? new Date(req.query.from).toISOString() : new Date(Date.now() - 35 * 86400e3).toISOString();
    const to = req.query.to && !isNaN(new Date(req.query.to)) ? new Date(req.query.to).toISOString() : new Date(Date.now() + 3600e3).toISOString();
    const r = await C.query(`SELECT id, kind, title, area, note, at, ends_at, created_by FROM ops_events WHERE at >= $1 AND at <= $2 ORDER BY at DESC LIMIT 200`, [from, to]);
    res.json({ events: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/events', requireCap('manageSync'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title || !b.at || isNaN(new Date(b.at))) return res.status(400).json({ error: 'title and valid at required' });
    const kind = ['deploy', 'campaign', 'maintenance', 'incident', 'note'].includes(b.kind) ? b.kind : 'note';
    const r = await C.query(
      `INSERT INTO ops_events (kind,title,area,note,at,ends_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [kind, String(b.title).slice(0, 160), b.area ? String(b.area).slice(0, 40) : null, b.note ? String(b.note).slice(0, 400) : null,
       new Date(b.at).toISOString(), b.ends_at && !isNaN(new Date(b.ends_at)) ? new Date(b.ends_at).toISOString() : null, req.actor]);
    await audit(req, 'event.create', String(r.rows[0].id), { kind, title: b.title });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/events/:id', requireCap('manageSync'), async (req, res) => {
  try { await C.query(`DELETE FROM ops_events WHERE id=$1`, [req.params.id]); await audit(req, 'event.delete', req.params.id, null); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// SLO targets CRUD (editRules)
app.get('/api/slo/targets', requireRoot('sla'), async (req, res) => {
  try { res.json({ targets: (await C.query(`SELECT * FROM slo_targets ORDER BY journey`)).rows }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/slo/targets/:journey', requireCap('editRules'), requireRoot('sla'), async (req, res) => {
  try {
    const b = req.body || {};
    await C.query(`UPDATE slo_targets SET target=COALESCE($1,target), window_days=COALESCE($2,window_days), enabled=COALESCE($3,enabled), updated_at=now() WHERE journey=$4`,
      [b.target ?? null, b.window_days ?? null, b.enabled ?? null, req.params.journey]);
    await audit(req, 'slo.update', req.params.journey, b);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// rebuild rollups on demand (super admin) — bounded backfill
app.post('/api/rollups/rebuild', requireSuper, async (req, res) => {
  try { const out = await rollups.backfill({ days: Math.min(365, Number((req.body || {}).days || 90)) }); await audit(req, 'rollups.rebuild', null, out); res.json(out); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- audit trail ---- */
// client self-reports navigation / filter / trace-view activity (any signed-in user)
const ALLOWED_TRACK = new Set(['VIEW_PAGE', 'APPLY_FILTER', 'VIEW_TRACE', 'VIEW_ERROR', 'VIEW_TRACE_UNMASKED', 'VIEW_ERROR_UNMASKED', 'SEARCH', 'EXPORT']);
app.post('/api/audit/track', async (req, res) => {
  try {
    if (!req.actor || req.actor === 'anonymous') return res.json({ ok: false });
    const b = req.body || {};
    const action = ALLOWED_TRACK.has(b.action) ? b.action : 'VIEW_PAGE';
    await audit(req, action, String(b.target || '').slice(0, 160), b.detail || {});
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false }); }
});
// distinct action list for the filter dropdown (super admin)
app.get('/api/audit/actions', requireSuper, requireRoot('audit'), async (req, res) => {
  try { const r = await C.query(`SELECT action, count(*)::int c FROM audit_log GROUP BY action ORDER BY c DESC`); res.json({ actions: r.rows }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// year→month→day drill-down counts (KSA day) + total
app.get('/api/audit/tree', requireSuper, requireRoot('audit'), async (req, res) => {
  try {
    const { clause, params } = auditWhere(req.query);
    const total = Number((await C.query(`SELECT count(*) c FROM audit_log ${clause}`, params)).rows[0].c);
    const days = (await C.query(
      `SELECT to_char((at AT TIME ZONE 'Asia/Riyadh')::date,'YYYY-MM-DD') d, count(*)::int c
       FROM audit_log ${clause} GROUP BY 1 ORDER BY 1 DESC LIMIT 500`, params)).rows;
    res.json({ total, days });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// events for a filter (optionally a specific KSA day)
app.get('/api/audit/events', requireSuper, requireRoot('audit'), async (req, res) => {
  try {
    let { clause, params } = auditWhere(req.query);
    if (req.query.day) { params.push(req.query.day); clause = (clause ? clause + ' AND ' : 'WHERE ') + `(at AT TIME ZONE 'Asia/Riyadh')::date = $${params.length}::date`; }
    params.push(Math.min(2000, Number(req.query.limit || 300)));
    const rows = (await C.query(
      `SELECT actor, role, action, target, detail, ip, ua, at FROM audit_log ${clause} ORDER BY at DESC LIMIT $${params.length}`, params)).rows;
    res.json({ rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// sync health — computed status (for an in-app view) + manual send/preview of the twice-daily report
app.get('/api/sync-health', async (req, res) => {
  try { res.json(await syncHealth.compute(req.query.sim)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/sync-health/send', requireCap('manageSync'), async (req, res) => {
  try {
    const out = await syncHealth.send(req.body && req.body.sim);
    await audit(req, 'synchealth.send', null, { status: out.status, sent: out.sent, recipients: out.recipients });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// prod → local replica incremental sync (Super Admin only; runs where the console can reach prod on VPN)
function requireSuper(req, res, next) { return req.realRole === 'super_admin' ? next() : res.status(403).json({ error: 'super admin only' }); }
app.get('/api/prod-sync/status', requireSuper, async (req, res) => {
  try {
    const st = (await C.query(`SELECT * FROM prod_sync_state ORDER BY table_name`)).rows;
    res.json({ running: prodSync.isRunning(), configured: !!process.env.PROD_DATABASE_URL, tables: prodSync.DEFAULT_TABLES, state: st });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/prod-sync/run', requireSuper, async (req, res) => {
  const b = req.body || {};
  if (prodSync.isRunning()) return res.status(409).json({ error: 'a sync is already running' });
  if (!process.env.PROD_DATABASE_URL) return res.status(400).json({ error: 'PROD_DATABASE_URL not configured on the console service' });
  if (b.dryRun) {
    try { const out = await prodSync.run({ tables: b.tables, dryRun: true, date: b.date, from: b.from, to: b.to }); await audit(req, 'prodsync.dryrun', null, { rows: out.rows, window: out.window }); return res.json(out); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }
  audit(req, 'prodsync.run', null, { tables: b.tables || 'default', window: b.date || b.from || null });
  prodSync.run({ tables: b.tables, dryRun: false, date: b.date, from: b.from, to: b.to })
    .then(out => console.log(`[PROD-SYNC] done: ${out.rows} rows in ${out.seconds}s`))
    .catch(e => console.error('[PROD-SYNC]', e.message));
  res.json({ started: true });
});

/* ---- dashboards ---- */
app.get('/api/dashboard/dealers', async (req, res) => {
  try { const now = await boardNow(req.query.sim); res.json({ now, ...(await dashboard.dealersDashboard(now, Number(req.query.window || 168))) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/dashboard/qr', async (req, res) => {
  try { const now = await boardNow(req.query.sim); res.json({ now, ...(await dashboard.qrDashboard(now, Number(req.query.window || 168))) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- add custom rule + test-now ---- */
app.post('/api/rules', requireCap('editRules'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.metric_key || !b.operator || b.threshold == null) return res.status(400).json({ error: 'name, metric_key, operator, threshold required' });
    if (!METRICS[b.metric_key]) return res.status(400).json({ error: 'unknown metric_key' });
    const key = (b.key || b.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) + '_' + Date.now().toString(36).slice(-4);
    await C.query(`INSERT INTO alert_rules
      (key,name,description,metric_key,operator,threshold,window_hours,min_sample,team,severity,channel,dim,active_from,active_to,runbook,trigger_codes,enabled,builtin)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,false)`,
      [key, b.name, b.description || null, b.metric_key, b.operator, b.threshold, b.window_hours || 1,
       b.min_sample || 0, b.team || null, b.severity || 'P3', b.channel || 'any',
       JSON.stringify(b.dim || {}), b.active_from ?? null, b.active_to ?? null, b.runbook || null, b.trigger_codes || null]);
    await audit(req, 'rule.create', key, b);
    res.json({ ok: true, key });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/rules/test', requireCap('editRules'), async (req, res) => {
  try {
    const b = req.body || {};
    const m = METRICS[b.metric_key]; if (!m) return res.status(400).json({ error: 'unknown metric_key' });
    const now = await boardNow(b.sim);
    const rows = await m.compute(db.source, now, Number(b.window_hours || 1));
    const snap = rows.find(r => Object.keys(b.dim || {}).every(k => String((r.dim || {})[k]) === String(b.dim[k]))) || rows.find(r => !Object.keys(r.dim || {}).length) || rows[0];
    const OPS = { gt: (a, x) => a > x, gte: (a, x) => a >= x, lt: (a, x) => a < x, lte: (a, x) => a <= x, eq: (a, x) => a === x };
    const val = snap ? snap.value : null, sample = snap ? snap.sample : 0;
    const enoughSample = sample >= (b.min_sample || 0);
    const breach = val != null && enoughSample && OPS[b.operator](Number(val), Number(b.threshold));
    res.json({ now, value: val, sample, unit: m.unit, would_fire: !!breach, enoughSample });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- settings config-change feed (PaperTrail versions on Setting) ---- */
app.get('/api/config-changes', async (req, res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit || 50));
    const r = await db.source.query(`
      SELECT v.id, v.item_id, v.event, v.whodunnit, v.created_at, s.var,
             left(coalesce(v.object_changes::text,''), 400) AS changes
      FROM versions v LEFT JOIN settings s ON s.id = v.item_id
      WHERE v.item_type = 'Setting'
      ORDER BY v.created_at DESC LIMIT $1`, [limit]);
    res.json({ changes: r.rows });
  } catch (e) { res.json({ changes: [], note: 'versions table unavailable: ' + e.message }); }
});

/* the console's current clock (data-end on the static dump, real-now on a live replica) */
app.get('/api/now', async (req, res) => {
  try { res.json({ now: await boardNow(req.query.sim) }); }
  catch (e) { res.json({ now: new Date().toISOString() }); }
});

/* ---- analytics (Grafana-style) ---- */
app.get('/api/analytics/catalog', (req, res) => res.json({ datasets: analytics.catalog() }));
app.get('/api/analytics/values', async (req, res) => {
  try { res.json({ values: await analytics.distinctValues(req.query.dataset, req.query.dim, 60) }); }
  catch (e) { res.json({ values: [] }); }
});
app.post('/api/analytics/query', async (req, res) => {
  try {
    const spec = req.body || {};
    // Charts end at the CURRENT hour (real clock), not the newest data row — so "last 6h/12h"
    // always slides with wall-clock. If recent hours have no synced data yet, they show as a gap
    // (which surfaces sync lag) rather than the axis stopping early. Replay-demo still uses the cursor.
    if (!spec.to) {
      const s = (await settings.getSetting('sync')) || {};
      if (spec.sim) spec.to = spec.sim;
      else if (s.enabled && s.mode === 'auto_replay' && s.cursor) spec.to = s.cursor;
      else { const d = new Date(); d.setUTCMinutes(0, 0, 0); d.setUTCHours(d.getUTCHours() + 1); spec.to = d.toISOString(); } // next hour boundary
    }
    if (!spec.from) spec.from = new Date(new Date(spec.to).getTime() - (Number(spec.rangeHours) || 24) * 3600e3).toISOString();
    res.json(await analytics.runQuery(spec));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/analytics/dashboards', async (req, res) => {
  const r = await C.query(`SELECT key,name,spec,builtin FROM analytics_dashboards ORDER BY builtin DESC, name`);
  // overlay the current user's PERSONAL edits (if any) so every user sees their own version
  let mine = {};
  try {
    if (req.actor && req.actor !== 'anonymous') {
      const u = await C.query(`SELECT key, spec FROM user_dashboards WHERE email=$1`, [req.actor]);
      u.rows.forEach(x => { mine[x.key] = x.spec; });
    }
  } catch (e) {}
  const dashboards = r.rows.map(d => mine[d.key] ? { ...d, spec: mine[d.key], mine: true } : { ...d, mine: false });
  res.json({ dashboards });
});
// shared board save — admins only (creates/updates a team board)
app.put('/api/analytics/dashboards/:key', requireCap('editRules'), async (req, res) => {
  try {
    const { key } = req.params; const { name, spec } = req.body || {};
    await C.query(`INSERT INTO analytics_dashboards (key,name,spec,builtin,owner) VALUES ($1,$2,$3,false,$4)
      ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, spec=EXCLUDED.spec, updated_at=now()`,
      [key, name || key, JSON.stringify(spec || {}), req.actor]);
    await audit(req, 'dashboard.save', key, {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// PERSONAL board edits — any signed-in user; saved to their own copy, never touches the shared board
app.put('/api/analytics/dashboards/:key/mine', async (req, res) => {
  try {
    if (!req.actor || req.actor === 'anonymous') return res.status(401).json({ error: 'sign in to save your view' });
    const { key } = req.params; const { spec } = req.body || {};
    await C.query(`INSERT INTO user_dashboards (email,key,spec) VALUES ($1,$2,$3)
      ON CONFLICT (email,key) DO UPDATE SET spec=EXCLUDED.spec, updated_at=now()`,
      [req.actor, key, JSON.stringify(spec || {})]);
    await audit(req, 'dashboard.save.personal', key, {});
    res.json({ ok: true, mine: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// reset personal edits → back to the shared board
app.delete('/api/analytics/dashboards/:key/mine', async (req, res) => {
  try {
    if (!req.actor || req.actor === 'anonymous') return res.status(401).json({ error: 'not signed in' });
    await C.query(`DELETE FROM user_dashboards WHERE email=$1 AND key=$2`, [req.actor, req.params.key]);
    await audit(req, 'dashboard.reset.personal', req.params.key, {});
    res.json({ ok: true, mine: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== DMS JOURNEYS — the dealer journey end to end, from DMS's own audit trail =====
 * Source: Clara dms_audit_logs (31 tables, one per journey step), synced hourly-aggregated into
 * console Postgres by dmsJourneys.js (id-watermark, PII masked at ingest). Board + drill read
 * ONLY the console DB (instant); trace queries Clara live but bounded/indexed-only. */
app.get('/api/dms/journeys', async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 24 * 3600e3);
    res.json(await respCache.wrap(req, () => require('./dmsJourneys').board(from.toISOString(), to.toISOString())));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/dms/journeys/status', (req, res) => {
  try { res.json(require('./dmsJourneys').status()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/dms/journeys/home', async (req, res) => {    // before /:key — routing order matters
  try { res.json(await respCache.wrap(req, () => require('./dmsJourneys').home())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/dms/journeys/:key/row', async (req, res) => {    // ONE row, every column (popup)
  try {
    const um = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    const out = await require('./dmsJourneys').rowDetail(req.params.key, req.query.id, um);
    await audit(req, um ? 'pii.unmask' : 'dms.journey.row', `${req.params.key}#${req.query.id}`, { unmask: um });
    res.json({ ...out, can_unmask: !!(req.caps && req.caps.unmaskPII) });
  } catch (e) { res.status(e.message === 'unknown journey' ? 404 : 500).json({ error: e.message }); }
});
app.get('/api/dms/journeys/:key/rows', async (req, res) => {   // ALL calls, latest first
  try {
    // masked by default; unmask needs the capability + explicit ?unmask=1 and is audited (house rule)
    const um = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    const ids = req.query.ids ? String(req.query.ids).split(',') : null;
    const out = await require('./dmsJourneys').browse(req.params.key, req.query.before, req.query.limit, { unmask: um, ids, code: req.query.code });
    await audit(req, um ? 'pii.unmask' : 'dms.journey.browse', req.params.key,
      { before: req.query.before || null, ids: ids ? ids.length : null, n: out.rows.length, unmask: um });
    res.json({ ...out, can_unmask: !!(req.caps && req.caps.unmaskPII) });
  } catch (e) { res.status(e.message === 'unknown journey' ? 404 : 500).json({ error: e.message }); }
});
app.get('/api/dms/journeys/dealer-acts', async (req, res) => {       // before /:key — routing order matters
  try {
    const out = await require('./dmsJourneys').dealerActs(req.query.d, req.query.from, req.query.to);
    await audit(req, 'dms.dealer.acts', String(req.query.d || '').slice(0, 40), { n: out.acts.length });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/dms/journeys/dealer-timeline', async (req, res) => {   // before /:key — routing order matters
  try {
    const um = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    const out = await require('./dmsJourneys').dealerTimeline(req.query.d, um);
    await audit(req, um ? 'pii.unmask' : 'dms.dealer.timeline', String(req.query.d || '').slice(0, 40), { hits: out.hits.length, unmask: um });
    res.json({ ...out, can_unmask: !!(req.caps && req.caps.unmaskPII) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/dms/journeys/trace', async (req, res) => {   // before /:key — routing order matters
  try {
    const um = !!(req.caps && req.caps.unmaskPII) && req.query.unmask === '1';
    const out = await require('./dmsJourneys').trace(req.query.q, um);
    await audit(req, um ? 'pii.unmask' : 'dms.journey.trace',
      String(req.query.q || '').replace(/\d(?=\d{4})/g, '*').slice(0, 30), { hits: out.hits.length, unmask: um });
    res.json({ ...out, can_unmask: !!(req.caps && req.caps.unmaskPII) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/dms/journeys/:key', async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 24 * 3600e3);
    res.json(await respCache.wrap(req, () => require('./dmsJourneys').drill(req.params.key, from.toISOString(), to.toISOString())));
  } catch (e) { res.status(e.message === 'unknown journey' ? 404 : 500).json({ error: e.message }); }
});

// error-handling middleware — registered last so it catches everything above
app.use(reliability.errorHandler);
reliability.installProcessTraps();

const PORT = process.env.PORT || 4600;
app.listen(PORT, async () => {
  console.log(`MVNO console API on :${PORT}`);
  // hidden root tier — count only; emails masked so the log never carries the full list
  const maskMail = e => { const [u, d] = e.split('@'); return (u ? u[0] + '***' : '***') + (d ? '@' + d : ''); };
  console.log(ROOT_SET.size
    ? `[ROOT] ${ROOT_SET.size} root admin(s) configured (${[...ROOT_SET].map(maskMail).join(', ')})`
    : `[ROOT] no root admins configured — ${ROOT_ONLY.join('/')} stay on role-based access`);
  try { await settings.applySchedule(); } catch (e) { console.error('scheduler init:', e.message); }
  try { require('./reportScheduler').start(); } catch (e) { console.error('sync-health scheduler:', e.message); }
  try { escalation.start(); } catch (e) { console.error('escalation scheduler:', e.message); }
  try { require('./prodSyncScheduler').start(); } catch (e) { console.error('prod-sync scheduler:', e.message); }
  try { require('./sematiProbe').start(); } catch (e) { console.error('semati canary:', e.message); }
  try { require('./osbProbe').start(); } catch (e) { console.error('OSB fault watcher:', e.message); }
  try { require('./apigwProbe').start(); } catch (e) { console.error('APIGW connectivity probe:', e.message); }
  try { require('./apiLogCollector').start(); } catch (e) { console.error('API-log collector:', e.message); }
  try { require('./apiErrLogCollector').start(); } catch (e) { console.error('App-error-log collector:', e.message); }
  try { require('./smsProbe').start(); } catch (e) { console.error('SMS probe:', e.message); }
  try { require('./zipkinCollector').start(); } catch (e) { console.error('APIGW trace collector:', e.message); }
  try { require('./dmsJourneys').start(); } catch (e) { console.error('DMS journey collector:', e.message); }
  try { require('./uilSampler').start(); } catch (e) { console.error('UIL sampler:', e.message); }
  try { require('./assist').startWarm(); } catch (e) { /* LLM warm-up is best-effort */ }
});
