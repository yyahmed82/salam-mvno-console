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
const { METRICS } = require('./metrics');

const app = express();
app.set('trust proxy', true);   // read client IP from X-Forwarded-For when behind a proxy
app.use(reliability.securityHeaders);
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
app.use(async (req, _res, next) => {
  const email = (req.get('X-Console-User') || '').toLowerCase();
  req.actor = email || 'anonymous';
  let names = ['report_manager'];
  if (email) {
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
function requireCap(cap) {
  return (req, res, next) => (req.caps && req.caps[cap]) ? next()
    : res.status(403).json({ error: `role ${req.roleName} lacks ${cap}` });
}
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
    const r = await otp.requestOtp(email);
    if (r.error) return res.status(429).json({ error: r.error });
    res.json({ sent: !!r.sent, dev: !!r.dev, devCode: r.devCode, ttlMin: otp.CODE_TTL_MIN });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const email = (req.body && req.body.email || '').toLowerCase().trim();
    const code = (req.body && req.body.code || '').trim();
    if (!ALLOWED_DOMAIN.test(email)) return res.status(400).json({ error: 'Invalid email.' });
    if (!(await otp.verifyOtp(email, code))) { await audit(req, 'LOGIN_FAIL', email, {}, email); return res.status(401).json({ error: 'Invalid or expired code.' }); }
    let role = 'report_manager';
    const u = await C.query(`SELECT role FROM console_users WHERE email=$1 AND enabled=true`, [email]);
    if (u.rowCount) role = u.rows[0].role;
    await C.query(`UPDATE console_users SET last_login=now() WHERE email=$1`, [email]);
    await audit(req, 'LOGIN', email, {}, email);
    res.json({ email, role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- roles & session ---- */
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
  const primary = roles.effective(rolesArr).primary;
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
  if (Array.isArray(rolesArr)) { const list = rolesArr.length ? rolesArr : ['report_manager']; fields.roles = list; fields.role = roles.effective(list).primary; }
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
    const { window = 24, category, team, q, limit = 100, sim, code } = req.query;
    const now = await boardNow(sim);
    const rows = await errors.feed({ now, windowHours: Number(window), category, team, q, limit: Number(limit), code });
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
app.get('/api/transaction', async (req, res) => {
  try {
    // prefer server-side row resolution (client never holds raw PII); else use id
    const rr = req.query.row ? await errors.resolveRow(req.query.row) : { identifier: req.query.id, at: null };
    const tl = await errors.timeline({ identifier: rr.identifier, anchorAt: rr.at });
    // super_admin (unmaskPII cap) always sees real PII — audited per record view
    const allowUnmask = !!(req.caps && req.caps.unmaskPII);
    if (allowUnmask) await audit(req, 'pii.unmask', req.query.id, {});
    res.json(roles.maskDeep(tl, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Subscriber 360 — unified profile by MSISDN or National ID (PII masked unless super_admin)
app.get('/api/subscriber', async (req, res) => {
  try {
    const key = req.query.row ? (await errors.resolveRow(req.query.row)).identifier : req.query.key;
    if (!key) return res.status(400).json({ error: 'missing key (MSISDN or National ID)' });
    const allowUnmask = !!(req.caps && req.caps.unmaskPII);
    const p = await subscriber.profile({ key });
    await audit(req, allowUnmask ? 'subscriber.view.unmasked' : 'subscriber.view', key, { found: p.found });
    res.json(roles.maskDeep(p, allowUnmask));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/health', async (req, res) => {
  try {
    const b = await dataBounds();
    const r = await C.query(`SELECT count(*)::int AS rules FROM alert_rules`);
    res.json({ ok: true, source_bounds: b, rules: r.rows[0].rules });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/rules', async (req, res) => {
  const rules = (await C.query(`SELECT r.*, mc.unit, mc.higher_is_bad FROM alert_rules r
     LEFT JOIN metric_catalog mc ON mc.key=r.metric_key ORDER BY severity, name`)).rows;
  const catalog = (await C.query(`SELECT * FROM metric_catalog ORDER BY key`)).rows;
  res.json({ rules, catalog });
});

app.get('/api/alerts', async (req, res) => {
  const status = req.query.status || 'open';
  const where = status === 'all' ? '' : `WHERE status=$1`;
  const rows = (await C.query(
    `SELECT * FROM alerts ${where} ORDER BY (status='open') DESC,
       CASE severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
       last_seen_at DESC LIMIT 500`,
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
    const rule = (await C.query(`SELECT runbook FROM alert_rules WHERE key=$1`, [a.rule_key])).rows[0] || {};
    res.json({ alert: a, comments, runbook: rule.runbook || null });
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

/* ---- Yusr (يُسر) — LLM troubleshooting chatbot (local Ollama) ---- */
app.post('/api/assist/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    const allowUnmask = !!(req.caps && req.caps.unmaskPII);
    const out = await assist.chat({ message, history, allowUnmask });
    if (out.error) return res.status(400).json(out);
    await audit(req, 'assist.chat', null, { intent: out.intent, degraded: out.degraded });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// public on/off flag (no config details) — lets the widget hide the bubble when disabled
app.get('/api/assist/enabled', async (req, res) => {
  try { res.json({ enabled: !!(await assist.getConfig()).enabled }); }
  catch (e) { res.json({ enabled: true }); }   // fail open: widget shows, chat call reports the real error
});
app.get('/api/assist/config', requireCap('manageSync'), async (req, res) => {
  try { res.json(await assist.getConfig()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/assist/config', requireCap('manageSync'), async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    ['enabled', 'ollamaUrl', 'model', 'timeoutMs'].forEach(k => { if (k in b) patch[k] = b[k]; });
    const next = await assist.setConfig(patch);
    await audit(req, 'assist.config', null, { enabled: next.enabled, model: next.model });
    res.json(next);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/assist/ping', requireCap('manageSync'), async (req, res) => {
  try { res.json(await assist.ping()); } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- ChatOps (Slack/Teams) + on-call escalation config ---- */
function chatopsPublic(c) {
  // never leak the WhatsApp bearer token to the client; expose a "configured" flag instead
  const { waToken, ...rest } = c;
  return { ...rest, slackConfigured: !!c.slackUrl, teamsConfigured: !!c.teamsUrl,
    whatsappConfigured: !!(c.waPhoneId && waToken && c.waGroupId), waTokenSet: !!waToken,
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
    ['enabled', 'slackUrl', 'teamsUrl', 'minSeverity', 'baseUrl', 'waPhoneId', 'waToken', 'waGroupId', 'waApiVersion', 'smsEnabled', 'smsTo', 'smsMinSeverity'].forEach(k => { if (k in b) patch[k] = b[k]; });
    const next = await chatops.setConfig(patch);
    await audit(req, 'chatops.config', null, { enabled: next.enabled, minSeverity: next.minSeverity, slack: !!next.slackUrl, teams: !!next.teamsUrl, whatsapp: !!(next.waPhoneId && next.waToken && next.waGroupId) });
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
app.put('/api/ui-nav', requireCap('manageUsers'), async (req, res) => {
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
    ['enabled', 'z', 'minSample', 'lookbackWeeks', 'raiseAlerts', 'gatewayAlerts'].forEach(k => { if (k in b) patch[k] = b[k]; });
    const next = await anomaly.setConfig(patch);
    await audit(req, 'anomaly.config', null, next);
    res.json(next);
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
app.get('/api/version', (req, res) => res.json(reliability.version()));
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
    'window_hours', 'min_sample', 'team', 'severity', 'channel', 'active_from', 'active_to', 'runbook'];
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

// build + send (or preview) the alert email digest — recipients = users with mail_alert on
app.post('/api/alerts/notify', requireCap('manageSync'), async (req, res) => {
  try {
    const simNow = await boardNow(req.body && req.body.sim);
    const { evals } = await evaluate(simNow);
    const out = await notify.sendAlertDigest(simNow, evals);
    await audit(req, 'alert.notify', null, { sent: out.sent, firing: out.firing, recipients: out.recipients });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// plan catalog — id / optiva_reference → EN/AR name (for "ID - Name" labels across the UI)
app.get('/api/plans', async (req, res) => {
  try { res.json({ plans: await plans.list() }); }
  catch (e) { res.json({ plans: [] }); }
});

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
  const [orders, paidOk, paidFail, actOk, actFail, nafOk, nafTotal, nafFailed, deliv, planOk, planFail, checkouts] = await Promise.all([
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
    c(`SELECT count(*) c FROM checkouts WHERE ${win}`)
  ]);
  const nafPending = (nafTotal != null && nafOk != null && nafFailed != null) ? Math.max(0, nafTotal - nafOk - nafFailed) : null;
  let errorsToday = null;
  try {
    const wHours = Math.max(0.02, (new Date(to) - new Date(from)) / 3600e3);   // errors.summary works off (now - wHours, now]
    const sum = await errors.summary({ now: to, windowHours: wHours });
    errorsToday = sum.reduce((a, t) => a + (t.total || 0), 0);
  } catch (e) {}
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
  return { now: n, from, to, source: 'raw', ksaDay: new Date(n).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }),
    orders, checkouts, paidOk, paidFail, payRate: rate(paidOk, paidFail),
    actOk, actFail, actRate: rate(actOk, actFail), nafOk, nafPending, nafFailed, deliveries: deliv, planOk, planFail, errorsToday, targets, prev, spark };
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
    res.json(await homeKpisFromSource(now, from, to));
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
    const r = (await db.source.query(
      `SELECT count(*)::int orders,
              count(*) FILTER (WHERE is_eligible)::int eligible,
              count(*) FILTER (WHERE completed)::int completed,
              count(*) FILTER (WHERE activated)::int activated
       FROM onboarding_orders WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz${chSql}`, params)).rows[0];
    res.json({ steps: [
      { key: 'orders', label: 'Orders', n: r.orders },
      { key: 'eligible', label: 'Eligibility pass', n: r.eligible },
      { key: 'completed', label: 'Completed (paid)', n: r.completed },
      { key: 'activated', label: 'Activated', n: r.activated }
    ] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
/* Onboarding order-status flow tree — two lanes (New SIM / MNP), each cascading
 * Eligibility → Payment status → SIM type → Delivery status. Same window logic as the funnel. */
const FLOW_DEL_DONE = ['complete', 'completed', 'DELIVERED', 'DL', 'DEX09', 'POD', 'Delivered', 'delivered'];
const FLOW_PRED = {
  orders: 'TRUE', total: 'TRUE',
  elig_pass: 'eligible', elig_fail: 'NOT eligible',
  total_payment: `eligible AND pay<>'none'`,
  pay_success: `eligible AND pay='success'`, pay_pending: `eligible AND pay='pending'`, pay_fail: `eligible AND pay='fail'`,
  esim: `pay='success' AND esim`, physical: `pay='success' AND NOT esim`,
  esim_activated: `pay='success' AND esim AND activated`, esim_not_activated: `pay='success' AND esim AND NOT activated`,
  assigned: `pay='success' AND NOT esim AND assigned`, not_assigned: `pay='success' AND NOT esim AND NOT assigned`,
  delivered: `pay='success' AND NOT esim AND assigned AND delivered`, not_delivered: `pay='success' AND NOT esim AND assigned AND NOT delivered`,
  phys_activated: `pay='success' AND NOT esim AND assigned AND delivered AND activated`, phys_not_activated: `pay='success' AND NOT esim AND assigned AND delivered AND NOT activated`
};
const FLOW_CTE = extra => `WITH o AS (
  SELECT ((oo.number_order_type=1) IS TRUE) AS is_mnp, oo.is_eligible AS eligible, (oo.sim_type=1) AS esim, oo.activated AS activated, ${extra || ''}
    (SELECT CASE WHEN bool_or(p.status='success') THEN 'success'
                 WHEN bool_or(p.status='pending') THEN 'pending'
                 WHEN bool_or(p.status IN ('fail','failed')) THEN 'fail' ELSE 'none' END
       FROM payments p WHERE p.payment_on_type='OnboardingOrder' AND p.payment_on_id = oo.id::text) AS pay,
    EXISTS(SELECT 1 FROM delivery_requests d WHERE d.delivery_on_id = oo.id::text) AS assigned,
    EXISTS(SELECT 1 FROM delivery_requests d WHERE d.delivery_on_id = oo.id::text AND d.delivery_state = ANY($3)) AS delivered
  FROM onboarding_orders oo
  WHERE oo.created_at >= $1::timestamptz AND oo.created_at < $2::timestamptz )`;
function flowWindow(req, now) {
  const nISO = now && now.toISOString ? now.toISOString() : (now || new Date().toISOString());
  let from = req.query.from, to = req.query.to; const okDate = s => s && !isNaN(new Date(s).getTime());
  if (okDate(from) && okDate(to)) return [new Date(from).toISOString(), new Date(to).toISOString()];
  const k = new Date(new Date(nISO).getTime() + 3 * 3600e3);
  return [new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 3 * 3600e3).toISOString(), nISO];
}
app.get('/api/onboarding-flow', async (req, res) => {
  try {
    const [from, to] = flowWindow(req, await boardNow(req.query.sim));
    const filters = Object.entries(FLOW_PRED).map(([k, p]) => `count(*) FILTER (WHERE ${p})::int AS ${k}`).join(', ');
    const rows = (await db.source.query(`${FLOW_CTE('')} SELECT is_mnp, ${filters} FROM o GROUP BY is_mnp`, [from, to, FLOW_DEL_DONE])).rows;
    const lane = mnp => { const r = rows.find(x => x.is_mnp === mnp) || {}; const o = {}; Object.keys(FLOW_PRED).forEach(k => o[k] = Number(r[k] || 0)); return o; };
    res.json({ from, to, lanes: [{ key: 'newsim', label: 'New SIM', nodes: lane(false) }, { key: 'mnp', label: 'MNP', nodes: lane(true) }] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/onboarding-flow/orders', async (req, res) => {
  try {
    const { lane, node } = req.query;
    const pred = FLOW_PRED[node]; if (!pred) return res.status(400).json({ error: 'unknown node' });
    const [from, to] = flowWindow(req, await boardNow(req.query.sim));
    const lanePred = lane === 'mnp' ? 'is_mnp' : 'NOT is_mnp';
    const r = await db.source.query(
      `${FLOW_CTE('oo.id::text AS id, oo.mobile_number AS mobile, oo.created_at AS at, oo.aasm_state AS state, oo.plan_id,')}
       SELECT id, mobile, at, state, plan_id, pay FROM o WHERE ${lanePred} AND ${pred} ORDER BY at DESC LIMIT 200`,
      [from, to, FLOW_DEL_DONE]);
    const rows = r.rows.map(x => ({ id: x.id, mobile: x.mobile, at: x.at, state: x.state, plan_id: x.plan_id, pay: x.pay }));
    const allowUnmask = !!(req.caps && req.caps.unmaskPII);
    res.json({ rows: roles.maskDeep(rows, allowUnmask), unmasked: allowUnmask, total: rows.length });
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
app.get('/api/slo', async (req, res) => {
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
      const nowMs = new Date(nISO).getTime();
      sources = (await db.source.query(q)).rows.map(x => ({
        name: x.n,
        ksa: x.m ? new Date(x.m).toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }) : null,
        lagMin: x.m ? Math.max(0, Math.round((nowMs - new Date(x.m).getTime()) / 60000)) : null }));
    } catch (e) {}
    const oldest = sources.filter(s => s.lagMin != null).sort((a, b) => b.lagMin - a.lagMin)[0] || null;
    // name the most-impacting open incident, preferring a provider ROOT cause over a symptom
    let topOpen = null;
    try { topOpen = (await C.query(
      `SELECT name FROM alerts WHERE status='open'
        ORDER BY (rule_key = ANY($1)) DESC,
                 CASE severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, fired_at ASC LIMIT 1`,
      [correlation.ROOTS])).rows[0]; } catch (e) {}
    // overall status
    let status = 'ok', headline = 'All systems healthy';
    if (inc.p1 > 0) { status = 'incident'; headline = topOpen ? `${inc.p1} P1 · ${topOpen.name} — page on-call` : `${inc.p1} P1 incident${inc.p1 > 1 ? 's' : ''} open — page on-call`; }
    else if (inc.p2 > 0 || breached.length || atRisk.length || worstVendor || (oldest && oldest.lagMin > 60)) { status = 'degraded';
      headline = inc.p2 > 0 ? `${inc.p2} P2 alert${inc.p2 > 1 ? 's' : ''} open`
        : breached.length ? `${breached[0].label} below SLA — ${Math.round(breached[0].attainment * 100)}% vs ${Math.round(breached[0].target * 100)}% target`
        : atRisk.length ? `${atRisk[0].label} approaching SLA — ${Math.round(atRisk[0].attainment * 100)}%`
        : worstVendor ? `${worstVendor.name} degraded — ${Math.round(worstVendor.rate * 100)}%`
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
    if (cfg.waPhoneId && cfg.waToken && cfg.waGroupId) chans.push('WhatsApp');
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

    // reseller channels via plan_channels (many-to-many: an order counts once per channel its plan belongs to)
    let channels = [];
    try { channels = (await S.query(
      `SELECT c.name channel, count(*) orders, count(*) FILTER (WHERE o.activated) activated,
              coalesce(sum(p.price) FILTER (WHERE o.activated),0) revenue
       FROM onboarding_orders o JOIN plan_channels pc ON pc.plan_id=o.plan_id JOIN channels c ON c.id=pc.channel_id
       LEFT JOIN plans p ON p.id=o.plan_id WHERE ${W} AND lower(c.name) = ANY($3::text[]) GROUP BY c.name ORDER BY activated DESC`, [...P, RESELLER_CHANNELS])).rows
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
app.get('/api/slo/targets', async (req, res) => {
  try { res.json({ targets: (await C.query(`SELECT * FROM slo_targets ORDER BY journey`)).rows }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/slo/targets/:journey', requireCap('editRules'), async (req, res) => {
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
app.get('/api/audit/actions', requireSuper, async (req, res) => {
  try { const r = await C.query(`SELECT action, count(*)::int c FROM audit_log GROUP BY action ORDER BY c DESC`); res.json({ actions: r.rows }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// year→month→day drill-down counts (KSA day) + total
app.get('/api/audit/tree', requireSuper, async (req, res) => {
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
app.get('/api/audit/events', requireSuper, async (req, res) => {
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
      (key,name,description,metric_key,operator,threshold,window_hours,min_sample,team,severity,channel,dim,active_from,active_to,runbook,enabled,builtin)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,false)`,
      [key, b.name, b.description || null, b.metric_key, b.operator, b.threshold, b.window_hours || 1,
       b.min_sample || 0, b.team || null, b.severity || 'P3', b.channel || 'any',
       JSON.stringify(b.dim || {}), b.active_from ?? null, b.active_to ?? null, b.runbook || null]);
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

// error-handling middleware — registered last so it catches everything above
app.use(reliability.errorHandler);
reliability.installProcessTraps();

const PORT = process.env.PORT || 4600;
app.listen(PORT, async () => {
  console.log(`MVNO console API on :${PORT}`);
  try { await settings.applySchedule(); } catch (e) { console.error('scheduler init:', e.message); }
  try { require('./reportScheduler').start(); } catch (e) { console.error('sync-health scheduler:', e.message); }
  try { escalation.start(); } catch (e) { console.error('escalation scheduler:', e.message); }
  try { require('./prodSyncScheduler').start(); } catch (e) { console.error('prod-sync scheduler:', e.message); }
  try { require('./sematiProbe').start(); } catch (e) { console.error('semati canary:', e.message); }
});
