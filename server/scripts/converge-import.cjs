#!/usr/bin/env node
/* converge-import.cjs — merge people, audit trail and history from the two prod consoles into unified_console.
 *
 *   digital console    mvno_console         (same schema lineage as unified — DIGITAL_DATABASE_URL, read-only)
 *   operations console sda_ops.public       (Prisma schema, cuid ids — the OPS pool this console already reads)
 *              ↓
 *   unified_console                         (CONSOLE_DATABASE_URL — the only thing this script writes to)
 *
 * DESIGN RULES
 *   · dry-run by default. Nothing is written without --apply.
 *   · idempotent: every imported row carries (source, legacy_id) with a unique index → re-running is a no-op.
 *   · never overwrite what the unified console already has. Existing users keep their role/business/enabled;
 *     existing dashboards, settings, SLOs and error codes win over the legacy copy.
 *   · never import credentials: password hashes, OTP codes, session jti — dead on arrival here (OTP login only).
 *   · never turn on mail: imported users land with mail_alert/mail_report = false unless --mail-allow lists them.
 *   · sources are only ever SELECTed (the OPS pool is read-only at the driver level anyway).
 *
 * USAGE (on 152, from /apps/unified/server)
 *   node scripts/converge-import.cjs                        # dry run, all sections, 12 months
 *   node scripts/converge-import.cjs --only=users           # one section
 *   node scripts/converge-import.cjs --months=3 --apply
 *   node scripts/converge-import.cjs --apply --super-admins=y.yahmed.sns@salam.sa
 * Options
 *   --apply                 write (default: dry run)
 *   --months=N              history window for audit/alerts/snapshots (default 12)
 *   --only=a,b              users,audit,alerts,snapshots,incidents,tickets,docs,dashboards,settings
 *                           (default: all of those except settings)
 *   --digital-url=URL       mvno_console connection (default $DIGITAL_DATABASE_URL, else CONSOLE_DATABASE_URL
 *                           with the database name swapped to mvno_console)
 *   --super-admins=a,b      legacy SUPER_ADMIN emails allowed to land as super_admin (everyone else → admin)
 *   --mail-allow=a,b        emails allowed to keep mail_alert/mail_report on import
 *   --refresh-business      recompute business for EXISTING users too (default: only new rows; admin edits win)
 *   --with-ticket-files     also import ticket file rows (prints the rsync the blobs need)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

process.env.PG_APP_NAME = process.env.PG_APP_NAME || 'salam_unified_converge';
const db = require(path.join(__dirname, '..', 'src', 'db'));

/* ---------------- options ---------------- */
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const list = n => String(opt(n, '')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const APPLY = flag('apply');
const MONTHS = Number(opt('months', 12)) || 12;
const ALL_SECTIONS = ['users', 'audit', 'alerts', 'snapshots', 'incidents', 'tickets', 'docs', 'dashboards', 'settings'];
const DEFAULT_SECTIONS = ALL_SECTIONS.filter(s => s !== 'settings');   // settings is opt-in: it can change permissions
const ONLY = list('only').length ? list('only') : DEFAULT_SECTIONS;
const SUPER_OK = new Set(list('super-admins'));
const MAIL_OK = new Set(list('mail-allow'));
const REFRESH_BIZ = flag('refresh-business');
const WITH_FILES = flag('with-ticket-files');

const since = new Date(Date.now() - MONTHS * 30.44 * 864e5);
const log = (...a) => console.log(...a);
const warn = (...a) => console.log('  ! ', ...a);
const num = n => Number(n || 0).toLocaleString('en-US');

/* ---------------- sources ---------------- */
function digitalUrl() {
  const explicit = opt('digital-url', process.env.DIGITAL_DATABASE_URL || '');
  if (explicit) return explicit;
  const c = process.env.CONSOLE_DATABASE_URL || '';
  if (!c) return '';
  // same host/role as unified_console, different database — the digital console lives beside it on 121
  const swapped = c.replace(/\/([^/?]+)(\?|$)/, '/mvno_console$2');
  return swapped === c ? '' : swapped;
}
const DIGITAL_URL = digitalUrl();
const digital = DIGITAL_URL ? new Pool({
  connectionString: DIGITAL_URL, max: 2, statement_timeout: 120000,
  application_name: 'salam_unified_converge_ro',
  options: '-c timezone=UTC -c default_transaction_read_only=on',
}) : null;

const C = db.console;                 // target
const OPS = db.ops;                   // sda_ops.public (read-only pool)
const opsConfigured = !!(process.env.OPS_DATABASE_URL || '').trim();

/* ---------------- helpers ---------------- */
const RESULT = {}; const NOTES = [];
function tally(section, key, n) { (RESULT[section] = RESULT[section] || {})[key] = (RESULT[section][key] || 0) + n; }

async function q(pool, sql, params) { return (await pool.query(sql, params)).rows; }
async function tableExists(pool, name) {
  try { return (await q(pool, 'SELECT to_regclass($1) AS t', [name]))[0].t !== null; } catch (e) { return false; }
}
/* every source read goes through to_jsonb(t): a column that exists in one console and not the other can then
   never blow the import up — fields are read by name with fallbacks instead. */
async function rowsJson(pool, sql, params) { return (await q(pool, sql, params)).map(r => r.j); }

async function insertBatch(table, cols, rows, conflict, chunk = 500) {
  if (!rows.length) return 0;
  let done = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = []; const tuples = [];
    for (const r of slice) {
      const ph = cols.map(c => { params.push(r[c] === undefined ? null : r[c]); return '$' + params.length; });
      tuples.push('(' + ph.join(',') + ')');
    }
    const res = await C.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')} ${conflict || ''}`, params);
    done += res.rowCount || 0;
  }
  return done;
}
const jstr = v => (v === null || v === undefined) ? null : (typeof v === 'string' ? v : JSON.stringify(v));
const asDate = v => v ? new Date(v) : null;
const lower = s => String(s || '').trim().toLowerCase();

/* ---------------- 0 · schema ---------------- */
async function ensureSchema() {
  const file = path.join(__dirname, '..', 'db', 'converge.sql');
  const sql = fs.readFileSync(file, 'utf8');
  if (!APPLY) { log('· schema  : converge.sql would be applied (additive, idempotent)'); return; }
  await C.query(sql);
  log('· schema  : converge.sql applied');
}

/* ---------------- 1 · users ---------------- */
const OPS_ROLE_MAP = {                       // sda_ops UserRole → unified role
  SUPER_ADMIN: 'admin',                      // deliberately NOT super_admin unless --super-admins lists the email
  ADMIN: 'admin',
  DEALERS_ADMIN: 'report_manager',
  QR_ADMIN: 'report_manager',
  REPORT_ADMIN: 'report_manager',
  B2C_ADMIN: 'report_manager',
};
async function importUsers() {
  const merged = new Map();
  const take = email => {
    const k = lower(email);
    if (!merged.has(k)) merged.set(k, { email: k, tags: new Set(), roles: new Set() });
    return merged.get(k);
  };

  if (digital && await tableExists(digital, 'console_users')) {
    const rows = await rowsJson(digital, 'SELECT to_jsonb(u) AS j FROM console_users u');
    for (const u of rows) {
      if (!u.email) continue;
      const m = take(u.email);
      m.digital = true; m.digitalId = u.id != null ? u.id : null;
      m.name = m.name || u.name || null;
      m.role = m.role || u.role || null;
      m.team = m.team || u.team || null;
      m.mobile = m.mobile || u.mobile || null;
      m.dashboard = m.dashboard || u.dashboard || null;
      if (u.enabled === false) m.disabledIn = 'digital';
      for (const t of (u.tags || [])) m.tags.add(t);
      for (const r of (u.roles || [])) m.roles.add(r);
    }
    log(`· users   : digital console → ${num(rows.length)} accounts`);
  } else warn('digital console not reachable — skipping its users (set DIGITAL_DATABASE_URL)');

  if (opsConfigured && await tableExists(OPS, 'users')) {
    const rows = await rowsJson(OPS, 'SELECT to_jsonb(u) AS j FROM users u');
    for (const u of rows) {
      if (!u.email) continue;
      const m = take(u.email);
      m.ops = true; m.opsId = u.id != null ? u.id : null;
      m.name = m.name || u.name || null;
      const legacy = (u.roles || []).map(String);
      m.opsRoles = legacy;
      if (!m.role) {
        const best = legacy.includes('SUPER_ADMIN') ? 'SUPER_ADMIN' : legacy.includes('ADMIN') ? 'ADMIN' : legacy[0];
        let mapped = OPS_ROLE_MAP[best] || 'report_manager';
        if (best === 'SUPER_ADMIN' && SUPER_OK.has(lower(u.email))) mapped = 'super_admin';
        m.role = mapped;
      }
      if (u.is_active === false || u.blocked === true) m.disabledIn = m.disabledIn || 'operations';
      for (const t of (u.tags || [])) m.tags.add(t);
    }
    log(`· users   : operations console → ${num(rows.length)} accounts`);
  } else warn('OPS pool not configured — skipping its users');

  const existing = new Map((await q(C, 'SELECT lower(email) AS email, business, role FROM console_users')).map(r => [r.email, r]));
  const ins = []; const upd = [];
  for (const m of merged.values()) {
    const business = (m.digital && m.ops) ? 'both' : m.ops ? 'fixed' : 'mobile';
    const source = (m.digital && m.ops) ? 'both' : m.ops ? 'operations' : 'digital';
    const row = {
      email: m.email,
      name: m.name || null,
      role: m.role || 'report_manager',
      team: m.team || null,
      enabled: !m.disabledIn,
      roles: [...m.roles],
      mobile: m.mobile || null,
      tags: [...m.tags],
      dashboard: jstr(m.dashboard || {}),
      mail_report: MAIL_OK.has(m.email),
      mail_alert: MAIL_OK.has(m.email),
      business, source,
      legacy_ref: jstr({ digital_id: m.digitalId != null ? m.digitalId : null, ops_id: m.opsId != null ? m.opsId : null, ops_roles: m.opsRoles || [] }),
    };
    (existing.has(m.email) ? upd : ins).push(row);
  }

  // sanity: does the role a fixed-only user lands on actually hold a Fixed view in THIS console?
  try {
    const rp = require(path.join(__dirname, '..', 'src', 'rolePerms'));
    if (rp.refresh) await rp.refresh();
    const map = rp.current ? rp.current() : {};
    const fixedRoles = new Set(Object.entries(map)
      .filter(([, v]) => (v.views || []).some(x => /^fixed/.test(x)))
      .map(([k]) => k));
    const blind = [...new Set(ins.filter(r => r.business === 'fixed' && !fixedRoles.has(r.role)).map(r => r.role))];
    if (blind.length) NOTES.push(`fixed-only users are mapped to role(s) ${blind.join(', ')}, which hold no Fixed view in this console — `
      + 'grant \'fixed\' to those roles in Settings → Roles & permissions before letting them in.');
  } catch (e) { /* rolePerms optional */ }

  log(`· users   : ${num(merged.size)} distinct emails → ${num(ins.length)} new, ${num(upd.length)} already here`);
  log('            business split (new): ' + ['mobile', 'fixed', 'both'].map(b => `${b} ${ins.filter(r => r.business === b).length}`).join(' · '));
  tally('users', 'new', ins.length); tally('users', 'existing', upd.length);

  if (APPLY && ins.length) {
    const cols = ['email', 'name', 'role', 'team', 'enabled', 'roles', 'mobile', 'tags', 'dashboard',
      'mail_report', 'mail_alert', 'business', 'source', 'legacy_ref'];
    const n = await insertBatch('console_users', cols, ins, 'ON CONFLICT (email) DO NOTHING');
    await C.query('UPDATE console_users SET imported_at = now() WHERE imported_at IS NULL AND source IS NOT NULL');
    log(`            inserted ${num(n)}`);
  }
  // existing rows: fill only what is still empty; never change role / enabled / mail
  if (APPLY && upd.length) {
    let touched = 0;
    for (const r of upd) {
      const res = await C.query(
        `UPDATE console_users SET
            name       = COALESCE(name, $2),
            tags       = (SELECT COALESCE(array_agg(DISTINCT t), '{}') FROM unnest(tags || $3::text[]) t),
            source     = COALESCE(source, $4),
            legacy_ref = CASE WHEN legacy_ref = '{}'::jsonb THEN $5::jsonb ELSE legacy_ref END,
            business   = CASE WHEN $6 THEN $7 ELSE business END
          WHERE lower(email) = $1`,
        [r.email, r.name, r.tags, r.source, r.legacy_ref, REFRESH_BIZ, r.business]);
      touched += res.rowCount || 0;
    }
    log(`            updated ${num(touched)} existing (name / tags / provenance${REFRESH_BIZ ? ' + business' : ''}; role, enabled and mail untouched)`);
  }
  if (!REFRESH_BIZ && upd.length) NOTES.push(`business left as-is on ${upd.length} existing user(s) — re-run with --refresh-business to recompute it from where the account exists.`);
}

/* ---------------- 2 · audit trail ---------------- */
const AUDIT_COLS = ['actor', 'role', 'action', 'target', 'detail', 'at', 'ip', 'ua', 'source', 'legacy_id'];
const AUDIT_CONFLICT = 'ON CONFLICT (source, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING';
async function importAudit() {
  if (digital && await tableExists(digital, 'audit_log')) {
    const rows = await rowsJson(digital, 'SELECT to_jsonb(a) AS j FROM audit_log a WHERE at >= $1 ORDER BY at', [since]);
    const mapped = rows.map(a => ({
      actor: a.actor || null, role: a.role || null, action: a.action || 'UNKNOWN', target: a.target || null,
      detail: jstr(a.detail || {}), at: asDate(a.at), ip: a.ip || null, ua: a.ua || null,
      source: 'digital', legacy_id: String(a.id),
    }));
    log(`· audit   : digital console → ${num(mapped.length)} entries since ${since.toISOString().slice(0, 10)}`);
    tally('audit', 'digital', mapped.length);
    if (APPLY) log(`            inserted ${num(await insertBatch('audit_log', AUDIT_COLS, mapped, AUDIT_CONFLICT, 1000))}`);
  }
  if (opsConfigured && await tableExists(OPS, 'audit_log')) {
    const rows = await rowsJson(OPS, 'SELECT to_jsonb(a) AS j FROM audit_log a WHERE created_at >= $1 ORDER BY created_at', [since]);
    const mapped = rows.map(a => ({
      actor: a.user_email || null, role: null, action: a.action || 'UNKNOWN',
      target: [a.target_type, a.target_id].filter(Boolean).join(':') || null,
      detail: jstr({ meta: a.meta || null, user_id: a.user_id || null, console: 'operations' }),
      at: asDate(a.created_at), ip: a.ip || null, ua: a.user_agent || null,
      source: 'operations', legacy_id: String(a.id),
    }));
    log(`· audit   : operations console → ${num(mapped.length)} entries since ${since.toISOString().slice(0, 10)}`);
    tally('audit', 'operations', mapped.length);
    if (APPLY) log(`            inserted ${num(await insertBatch('audit_log', AUDIT_COLS, mapped, AUDIT_CONFLICT, 1000))}`);
  }
}

/* ---------------- 3 · alert history ---------------- */
const ALERT_COLS = ['rule_key', 'name', 'severity', 'team', 'status', 'metric_key', 'operator', 'threshold',
  'observed_value', 'sample', 'window_hours', 'dim', 'context', 'message', 'fired_at', 'last_seen_at',
  'resolved_at', 'peak_value', 'breach_count', 'segment', 'source', 'legacy_id'];
const ALERT_CONFLICT = 'ON CONFLICT (source, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING';
async function importAlerts() {
  // 3a · digital console firings — same shape as here
  if (digital && await tableExists(digital, 'alerts')) {
    const rows = await rowsJson(digital, 'SELECT to_jsonb(a) AS j FROM alerts a WHERE fired_at >= $1 ORDER BY fired_at', [since]);
    const mapped = rows.map(a => ({
      rule_key: a.rule_key, name: a.name, severity: a.severity, team: a.team || null,
      status: a.status || 'resolved', metric_key: a.metric_key, operator: a.operator, threshold: a.threshold,
      observed_value: a.observed_value, sample: a.sample, window_hours: a.window_hours,
      dim: jstr(a.dim || {}), context: jstr(a.context || {}), message: a.message || null,
      fired_at: asDate(a.fired_at), last_seen_at: asDate(a.last_seen_at || a.fired_at), resolved_at: asDate(a.resolved_at),
      peak_value: a.peak_value, breach_count: a.breach_count || 1, segment: a.segment || 'mvno',
      source: 'digital', legacy_id: String(a.id),
    }));
    log(`· alerts  : digital console → ${num(mapped.length)} firings`);
    tally('alerts', 'digital', mapped.length);
    if (APPLY) log(`            inserted ${num(await insertBatch('alerts', ALERT_COLS, mapped, ALERT_CONFLICT))}`);
  }

  // 3b · operations alert_events → alerts(segment='fixed'). FIRED rows only: OK rows are the resolution marker
  //      (used to fill resolved_at), SKIPPED rows are engine noise.
  if (opsConfigured && await tableExists(OPS, 'alert_events')) {
    const ev = await rowsJson(OPS, 'SELECT to_jsonb(e) AS j FROM alert_events e WHERE fired_at >= $1 ORDER BY fired_at', [since]);
    const defs = new Map();
    if (await tableExists(OPS, 'alert_rules')) {
      for (const r of await rowsJson(OPS, 'SELECT to_jsonb(r) AS j FROM alert_rules r')) defs.set(r.key, r);
    }
    const okAfter = new Map();
    for (const e of ev) {
      if (e.status !== 'OK') continue;
      if (!okAfter.has(e.rule_key)) okAfter.set(e.rule_key, []);
      okAfter.get(e.rule_key).push(new Date(e.fired_at));
    }
    const fired = ev.filter(e => e.status === 'FIRED');
    const mapped = fired.map(e => {
      const d = defs.get(e.rule_key) || {};
      const t = new Date(e.fired_at);
      const resolved = (okAfter.get(e.rule_key) || []).find(x => x > t) || null;
      return {
        rule_key: e.rule_key, name: e.rule_name || e.rule_key, severity: 'P' + (e.severity == null ? 2 : e.severity),
        team: e.team || d.team || null,
        status: 'resolved',                       // history: a legacy firing never re-opens in the new console
        metric_key: d.metric || ('fixed_' + e.rule_key),
        operator: d.operator || 'gte',
        threshold: e.threshold != null ? e.threshold : (d.threshold != null ? d.threshold : 0),
        observed_value: e.metric_value, sample: null,
        window_hours: d.window_hours != null ? d.window_hours : null,
        dim: jstr({ channel: d.channel || null }),
        context: jstr({
          legacy_status: e.status, metric_text: e.metric_text || null, detail: e.detail || null,
          window_from: e.window_from, window_to: e.window_to, console: 'operations',
        }),
        message: e.metric_text || e.detail || null,
        fired_at: t, last_seen_at: t, resolved_at: resolved,
        peak_value: e.metric_value, breach_count: 1, segment: 'fixed',
        source: 'operations', legacy_id: String(e.id),
      };
    });
    log(`· alerts  : operations console → ${num(ev.length)} events, ${num(mapped.length)} firings kept (OK / SKIPPED dropped)`);
    tally('alerts', 'operations', mapped.length);
    if (APPLY) log(`            inserted ${num(await insertBatch('alerts', ALERT_COLS, mapped, ALERT_CONFLICT))}`);

    // rule definitions are archived, not merged: unified runs its own fixed_* rules (alert_rules.segment='fixed')
    const rdefs = [...defs.values()].map(r => ({
      rule_key: r.key, name: r.name, description: r.description || null, team: r.team || null,
      severity: r.severity != null ? r.severity : null, metric: r.metric || null, operator: r.operator || null,
      threshold: r.threshold != null ? r.threshold : null, window_hours: r.window_hours != null ? r.window_hours : null,
      min_sample: r.min_sample != null ? r.min_sample : null, channel: r.channel || null, params: jstr(r.params || {}),
      enabled: r.enabled != null ? r.enabled : null, builtin: r.builtin != null ? r.builtin : null,
      created_at: asDate(r.created_at), updated_at: asDate(r.updated_at),
    }));
    tally('alerts', 'legacy_rules', rdefs.length);
    if (APPLY && rdefs.length) {
      await insertBatch('legacy_alert_rules',
        ['rule_key', 'name', 'description', 'team', 'severity', 'metric', 'operator', 'threshold', 'window_hours',
          'min_sample', 'channel', 'params', 'enabled', 'builtin', 'created_at', 'updated_at'],
        rdefs, 'ON CONFLICT (rule_key) DO NOTHING');
    }
    log(`            archived ${num(rdefs.length)} legacy rule definitions (legacy_alert_rules)`);
  }
}

/* ---------------- 4 · metric snapshots (the anomaly baseline) ---------------- */
async function importSnapshots() {
  if (!digital || !(await tableExists(digital, 'metric_snapshots'))) { warn('no digital metric_snapshots — skipping'); return; }
  const rows = await rowsJson(digital, 'SELECT to_jsonb(s) AS j FROM metric_snapshots s WHERE sim_now >= $1 ORDER BY sim_now', [since]);
  const mapped = rows.map(s => ({
    metric_key: s.metric_key, dim: jstr(s.dim || {}), window_hours: s.window_hours, value: s.value,
    sample: s.sample || 0, sim_now: asDate(s.sim_now), computed_at: asDate(s.computed_at || s.sim_now),
    source: 'digital', legacy_id: String(s.id),
  }));
  log(`· snapshot: digital console → ${num(mapped.length)} metric snapshots (what the seasonal baselines are built from)`);
  tally('snapshots', 'digital', mapped.length);
  if (APPLY) {
    log(`            inserted ${num(await insertBatch('metric_snapshots',
      ['metric_key', 'dim', 'window_hours', 'value', 'sample', 'sim_now', 'computed_at', 'source', 'legacy_id'],
      mapped, 'ON CONFLICT (source, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING', 1000))}`);
  }
}

/* ---------------- 5 · incidents (archive) ---------------- */
async function importIncidents() {
  if (!opsConfigured || !(await tableExists(OPS, 'incident_log'))) { warn('no OPS incident_log — skipping'); return; }
  const rows = await rowsJson(OPS, 'SELECT to_jsonb(i) AS j FROM incident_log i WHERE COALESCE(submitted_at, created_at) >= $1', [since]);
  const mapped = rows.map(i => ({
    incident_number: i.incident_number, segment: i.segment || null, priority: i.priority || null, status: i.status || null,
    sla_status: i.sla_status || null, sla_missed: !!i.sla_missed, theme: i.theme || null, ticket_type: i.ticket_type || null,
    assigned_group: i.assigned_group || null, description: i.description || null,
    submitted_at: asDate(i.submitted_at), resolved_at: asDate(i.resolved_at),
    resolve_hours: i.resolve_hours != null ? i.resolve_hours : null, created_at: asDate(i.created_at),
  }));
  log(`· incident: operations console → ${num(mapped.length)} incidents archived (legacy_incident_log)`);
  tally('incidents', 'operations', mapped.length);
  if (APPLY) {
    log(`            inserted ${num(await insertBatch('legacy_incident_log',
      ['incident_number', 'segment', 'priority', 'status', 'sla_status', 'sla_missed', 'theme', 'ticket_type',
        'assigned_group', 'description', 'submitted_at', 'resolved_at', 'resolve_hours', 'created_at'],
      mapped, 'ON CONFLICT (incident_number) DO NOTHING'))}`);
  }
  NOTES.push('Fixed pages still read incidents live from the OPS pool — legacy_incident_log is the snapshot for the day sda_ops is retired.');
}

/* ---------------- 6 · tickets ---------------- */
async function importTickets() {
  if (!digital || !(await tableExists(digital, 'console_tickets'))) { warn('no digital console_tickets — skipping'); return; }
  const rows = await rowsJson(digital, 'SELECT to_jsonb(t) AS j FROM console_tickets t ORDER BY id');
  const mapped = rows.map(t => ({
    // legacy refs are prefixed: unified mints its own TKT-xxxx and ref is UNIQUE
    ref: /^D-/.test(t.ref || '') ? t.ref : 'D-' + (t.ref || ('TKT-' + t.id)),
    kind: t.kind || 'issue', title: t.title || '(untitled)', description: t.description || null,
    status: t.status || 'open', priority: t.priority || 'normal', created_by: t.created_by || null,
    evaluator: t.evaluator || null, resolution: t.resolution || null,
    created_at: asDate(t.created_at), updated_at: asDate(t.updated_at), closed_at: asDate(t.closed_at),
    segment: t.segment || 'mobile', source: 'digital', legacy_id: String(t.id),
  }));
  log(`· tickets : digital console → ${num(mapped.length)} tickets (refs prefixed D- so they cannot collide)`);
  tally('tickets', 'digital', mapped.length);
  if (!APPLY) {
    NOTES.push('ticket attachments live on disk under /apps/console/uploads/tickets — the runbook has the rsync line.');
    return;
  }
  await insertBatch('console_tickets',
    ['ref', 'kind', 'title', 'description', 'status', 'priority', 'created_by', 'evaluator', 'resolution',
      'created_at', 'updated_at', 'closed_at', 'segment', 'source', 'legacy_id'],
    mapped, 'ON CONFLICT (source, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING');
  const idmap = new Map((await q(C, "SELECT id, legacy_id FROM console_tickets WHERE source = 'digital' AND legacy_id IS NOT NULL"))
    .map(r => [String(r.legacy_id), r.id]));
  log(`            inserted / known ${num(idmap.size)}`);

  if (await tableExists(digital, 'console_ticket_comments')) {
    // comments have no natural key — dedupe on (ticket, author, exact timestamp). Compare in epoch ms on BOTH
    // sides: a Postgres timestamp rendered as text never equals a JS toISOString(), which silently duplicated
    // every comment on the second run.
    const key = (tid, author, at) => `${tid}|${author || ''}|${at ? at.getTime() : 0}`;
    const existing = new Set((await q(C,
      'SELECT ticket_id, author, (extract(epoch from at) * 1000)::bigint AS ms FROM console_ticket_comments'))
      .map(r => `${r.ticket_id}|${r.author || ''}|${Number(r.ms)}`));
    const cs = (await rowsJson(digital, 'SELECT to_jsonb(c) AS j FROM console_ticket_comments c'))
      .map(c => ({ ticket_id: idmap.get(String(c.ticket_id)), author: c.author || null, body: c.body || '', at: asDate(c.at) }))
      .filter(c => c.ticket_id && !existing.has(key(c.ticket_id, c.author, c.at)));
    const n = await insertBatch('console_ticket_comments', ['ticket_id', 'author', 'body', 'at'], cs, '');
    log(`            comments ${num(n)}`);
    tally('tickets', 'comments', n);
  }
  if (WITH_FILES && await tableExists(digital, 'console_ticket_files')) {
    const dest = process.env.UPLOAD_DIR || '/apps/unified/uploads';
    const existing = new Set((await q(C, 'SELECT path FROM console_ticket_files')).map(r => r.path));
    const fsRows = (await rowsJson(digital, 'SELECT to_jsonb(f) AS j FROM console_ticket_files f'))
      .map(f => ({
        ticket_id: idmap.get(String(f.ticket_id)), filename: f.filename,
        mime: f.mime || 'application/octet-stream', size: f.size || 0, at: asDate(f.at),
        path: String(f.path || '').replace('/apps/console/uploads', dest),
      }))
      .filter(f => f.ticket_id && !existing.has(f.path));
    const n = await insertBatch('console_ticket_files', ['ticket_id', 'filename', 'path', 'mime', 'size', 'at'], fsRows, '');
    log(`            file rows ${num(n)} — copy the blobs first, or the links 404:`);
    log(`              rsync -a /apps/console/uploads/tickets/ ${dest}/tickets/`);
    tally('tickets', 'files', n);
  }
}

/* ---------------- 7 · docs / playbooks (archive) ---------------- */
async function importDocs() {
  if (!opsConfigured || !(await tableExists(OPS, 'ops_docs'))) { warn('no OPS ops_docs — skipping'); return; }
  const rows = await rowsJson(OPS, 'SELECT to_jsonb(d) AS j FROM ops_docs d');
  const mapped = rows.map(d => ({
    slug: d.slug, kind: d.kind || 'PLAYBOOK', title: d.title || d.slug, body: d.body || '',
    related_rule_key: d.related_rule_key || null, builtin: !!d.builtin, updated_by: d.updated_by || null,
    created_at: asDate(d.created_at), updated_at: asDate(d.updated_at),
  }));
  log(`· docs    : operations console → ${num(mapped.length)} SLA / OLA / playbook docs archived (legacy_ops_docs)`);
  tally('docs', 'operations', mapped.length);
  if (APPLY) {
    log(`            inserted ${num(await insertBatch('legacy_ops_docs',
      ['slug', 'kind', 'title', 'body', 'related_rule_key', 'builtin', 'updated_by', 'created_at', 'updated_at'],
      mapped, 'ON CONFLICT (slug) DO NOTHING'))}`);
  }
  NOTES.push('Fixed › Playbook still reads ops_docs live from OPS and merges fixed_playbook_overrides on top — the archive is the retirement copy.');
}

/* ---------------- 8 · dashboards, SLOs, error codes ---------------- */
async function importDashboards() {
  if (!digital) { warn('digital console not reachable — skipping dashboards'); return; }
  const jobs = [
    ['analytics_dashboards', 'SELECT to_jsonb(d) AS j FROM analytics_dashboards d',
      ['key', 'name', 'spec', 'builtin', 'owner', 'created_at', 'updated_at', 'source'],
      d => ({
        key: d.key, name: d.name, spec: jstr(d.spec || {}), builtin: !!d.builtin, owner: d.owner || null,
        created_at: asDate(d.created_at), updated_at: asDate(d.updated_at), source: 'digital',
      }), 'ON CONFLICT (key) DO NOTHING'],
    ['user_dashboards', 'SELECT to_jsonb(d) AS j FROM user_dashboards d',
      ['email', 'key', 'spec', 'updated_at'],
      d => ({ email: d.email, key: d.key, spec: jstr(d.spec || {}), updated_at: asDate(d.updated_at) }),
      'ON CONFLICT (email, key) DO NOTHING'],
    ['slo_targets', 'SELECT to_jsonb(s) AS j FROM slo_targets s',
      ['journey', 'label', 'target', 'window_days', 'enabled', 'updated_at'],
      s => ({
        journey: s.journey, label: s.label, target: s.target, window_days: s.window_days || 30,
        enabled: s.enabled !== false, updated_at: asDate(s.updated_at),
      }), 'ON CONFLICT (journey) DO NOTHING'],
    ['error_codes', 'SELECT to_jsonb(e) AS j FROM error_codes e',
      ['code', 'label', 'area', 'updated_at'],
      e => ({ code: e.code, label: e.label, area: e.area || null, updated_at: asDate(e.updated_at) }),
      'ON CONFLICT (code) DO NOTHING'],
  ];
  for (const [table, sql, cols, map, conflict] of jobs) {
    if (!(await tableExists(digital, table))) { warn(`digital ${table} missing — skipped`); continue; }
    const rows = (await rowsJson(digital, sql)).map(map);
    log(`· boards  : ${table.padEnd(20)} → ${num(rows.length)} rows`);
    tally('dashboards', table, rows.length);
    if (APPLY) log(`            inserted ${num(await insertBatch(table, cols, rows, conflict))}`);
  }
}

/* ---------------- 9 · settings (opt-in) ---------------- */
const SECRETISH = /(secret|token|password|passwd|webhook|smtp|api_?key|credential|bearer)/i;
async function importSettings() {
  if (digital && await tableExists(digital, 'console_settings')) {
    const rows = await rowsJson(digital, 'SELECT to_jsonb(s) AS j FROM console_settings s');
    const safe = rows.filter(r => !SECRETISH.test(r.key) && !SECRETISH.test(JSON.stringify(r.value || {})));
    const skipped = rows.length - safe.length;
    const mapped = safe.map(r => ({ key: r.key, value: jstr(r.value || {}), updated_at: asDate(r.updated_at) }));
    log(`· settings: digital console → ${num(mapped.length)} keys (${num(skipped)} skipped: they carry credentials)`);
    tally('settings', 'digital', mapped.length);
    if (APPLY) {
      log(`            inserted ${num(await insertBatch('console_settings', ['key', 'value', 'updated_at'], mapped,
        'ON CONFLICT (key) DO NOTHING'))}   (existing keys keep their unified value)`);
    }
  }
  if (opsConfigured && await tableExists(OPS, 'app_settings')) {
    const rows = await rowsJson(OPS, 'SELECT to_jsonb(a) AS j FROM app_settings a');
    if (rows.length) {
      log("· settings: operations app_settings → archived as key 'legacy_ops_app_settings' (not applied to behaviour)");
      tally('settings', 'operations', rows.length);
      if (APPLY) {
        await C.query(`INSERT INTO console_settings (key, value) VALUES ('legacy_ops_app_settings', $1)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [jstr(rows)]);
      }
    }
  }
}

/* ---------------- run ---------------- */
const STEPS = {
  users: importUsers, audit: importAudit, alerts: importAlerts, snapshots: importSnapshots,
  incidents: importIncidents, tickets: importTickets, docs: importDocs,
  dashboards: importDashboards, settings: importSettings,
};

(async () => {
  const t0 = Date.now();
  let runId = null;
  log('');
  log(`Salam Operations Console · data convergence  [${APPLY ? 'APPLY' : 'DRY RUN'}]`);
  log('  target   unified_console');
  log(`  digital  ${DIGITAL_URL ? DIGITAL_URL.replace(/:[^:@/]*@/, ':***@') : '(not configured)'}`);
  log(`  ops      ${opsConfigured ? 'OPS_DATABASE_URL (read-only)' : '(not configured)'}`);
  log(`  window   ${MONTHS} months (since ${since.toISOString().slice(0, 10)})   sections: ${ONLY.join(', ')}`);
  log('');
  try {
    await ensureSchema();
    if (APPLY) {
      const r = await C.query('INSERT INTO converge_runs (mode, options) VALUES ($1,$2) RETURNING id',
        ['apply', jstr({
          months: MONTHS, only: ONLY, superAdmins: [...SUPER_OK], mailAllow: [...MAIL_OK],
          refreshBusiness: REFRESH_BIZ, withTicketFiles: WITH_FILES,
        })]);
      runId = r.rows[0].id;
    }
    for (const s of ONLY) {
      if (!STEPS[s]) { warn(`unknown section "${s}" — known: ${ALL_SECTIONS.join(', ')}`); continue; }
      await STEPS[s]();
    }
    if (runId) await C.query('UPDATE converge_runs SET finished_at = now(), ok = true, result = $2 WHERE id = $1', [runId, jstr(RESULT)]);
    log('');
    log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (NOTES.length) { log(''); log('Notes:'); NOTES.forEach(n => log('  · ' + n)); }
    if (!APPLY) { log(''); log('Nothing was written. Re-run with --apply when the numbers look right.'); }
  } catch (e) {
    if (runId) {
      await C.query('UPDATE converge_runs SET finished_at = now(), ok = false, error = $2 WHERE id = $1',
        [runId, String(e.message || e)]).catch(() => {});
    }
    console.error('\nFAILED:', e.message);
    process.exitCode = 1;
  } finally {
    if (digital) await digital.end().catch(() => {});
    await new Promise(r => setTimeout(r, 100));
    process.exit(process.exitCode || 0);
  }
})();
