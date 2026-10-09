/* opsReports.js — Operations reports: the weekly reports every team and vendor sends, collected in one place,
 * reviewed by ITSM and consolidated for Salam management (8 Oct 2026, alpha.152)
 *
 * WHAT IT REPLACES. Every week ITSM collected by hand: the TCS executive + Digital MVNO decks, the Subex MS review,
 * the Oracle CSS WSR, the Apollo / Impact report, the Technology Platforms deck, the Whale Cloud DB & FS usage, the
 * portals health check and the change tracker — each in its own format, by mail, chased one by one, then summarised
 * into one deck for management. Here each team keeps its own format: the file is uploaded as it is (or dropped by the
 * vendor through a link), read automatically (opsReportsParse.js) and turned into the same short report for everyone —
 * RAG, headline, KPIs against target, ITSM counters, actions with ETA history, risks, highlights / lowlights / next
 * week. The consolidated report is built from those and mailed to management (Monday 09:00 KSA by default).
 *
 *   GET    /api/opsreports/me                     what this person may do here
 *   GET    /api/opsreports/overview?week=         status table of one reporting week (default: the week just reported)
 *   GET    /api/opsreports/teams                  teams (+ inactive ones for editors)
 *   POST   /api/opsreports/teams                  add a team                       (editors · admins)
 *   PATCH  /api/opsreports/teams/:id              edit / deactivate               (editors · admins)
 *   GET    /api/opsreports/report?team=&week=     one team's report of a week + files + suggestions + last week
 *   PUT    /api/opsreports/report                 save draft / submit             (team owners · uploaders · editors)
 *   POST   /api/opsreports/upload                 a file in the team's own format → stored, read, suggestions back
 *   GET    /api/opsreports/files/:id              download the original file
 *   DELETE /api/opsreports/files/:id              remove a file uploaded by mistake
 *   POST   /api/opsreports/report/:id/review      approve / return with a comment  (editors · admins)
 *   GET    /api/opsreports/actions                the action tracker (all teams)
 *   PATCH  /api/opsreports/actions/:id            status · ETA · owner · update
 *   GET    /api/opsreports/consolidated?week=     the management report (json, or &format=html)
 *   POST   /api/opsreports/consolidated/send      mail it now (to me · to management)
 *   POST   /api/opsreports/followup               reminder / late / overdue-actions mail for one team (preview or send)
 *   POST   /api/opsreports/droplink               a vendor upload link for one team (no console account needed)
 *   POST   /api/opsreports/droplink/revoke        revoke every open link of a team
 *   GET    /api/opsreports/library                every report and file, by week
 *   GET    /api/opsreports/mails                  the follow-up / consolidated mail log
 *   GET    /api/opsreports/settings · PUT         schedule, recipients, editors, ServiceNow dashboard
 *   GET    /api/opsreports/itsm?days=             ServiceNow ITSM dashboard, native (snItsm.js)
 *   GET    /api/opsreports/drop/:token            PUBLIC — the vendor drop page reads its team and weeks
 *   POST   /api/opsreports/drop/:token            PUBLIC — the vendor drops a file (rate-limited, size-capped)
 *
 * WHO. Reading needs the 'opsreports' view (admin, VP Operations, CIO, report_contributor — and everybody named in the
 * settings or on a team gets it automatically: api.js adds the view to any member's session, like the VP cockpit).
 *   editors (ITSM)        every team: upload, edit, submit, review, follow-ups, teams, settings (not the editors list)
 *   team owners (Salam)   their team: upload, edit, submit, follow-ups, drop links
 *   team uploaders        their team: upload, edit, submit
 *   management            receive the consolidated report, read everything
 *   admins (adminTools)   everything, the editors list included
 * Vendors without a console account use the drop link: one team, one upload form, expiring, hashed at rest.
 *
 * WEEK. Salam's reporting week runs Sunday → Saturday; a week is keyed by its Sunday. A team can report Monday →
 * Sunday (Whale Cloud) — its report still belongs to the Salam week it mostly covers. Due Sunday 12:00 KSA by default
 * (per team override), reminder Saturday 18:00, late mails from due + 1 h then daily at 10:00 (3 at most, ITSM in cc),
 * consolidated report Monday 09:00. Every scheduled send is claimed in opsr_jobs first, so two consoles on one DB
 * never mail twice. OPSR_MAIL=0 disables every scheduled mail. */
'use strict';
const os = require('os');
const crypto = require('crypto');
const db = require('./db');
const settings = require('./settings');
const parse = require('./opsReportsParse');

const C = () => db.console;
const KSA = 3 * 3600e3;
const lc = s => String(s || '').trim().toLowerCase();
const str = (v, n) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : null; };
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const ksaNow = () => new Date(Date.now() + KSA);
const ksaToday = () => ksaNow().toISOString().slice(0, 10);
const ksaHM = () => ksaNow().toISOString().slice(11, 16);
const dow = day => new Date(day + 'T00:00:00Z').getUTCDay();
const weekOf = day => addDays(day, -dow(day));                                     // the Sunday on / before
const defaultWeek = () => addDays(weekOf(ksaToday()), -7);                         // the last complete Sun–Sat week (the one being reported)
const ksaAt = (day, hm) => new Date(Date.parse(day + 'T' + (hm || '00:00') + ':00Z') - KSA);
const fmtDay = d => { const t = new Date(d + 'T00:00:00Z'); return t.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }); };
const fmtDT = d => d ? new Date(new Date(d).getTime() + KSA).toISOString().slice(0, 16).replace('T', ' ') : '';
const numOr = (v, lo, hi) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[,%\s]/g, '')); return Number.isFinite(n) ? Math.min(hi == null ? 1e12 : hi, Math.max(lo == null ? -1e12 : lo, n)) : null; };
const cnt = v => { const n = numOr(v, 0); return n == null ? null : Math.round(n); };
const emailList = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map(lc)
  .filter(e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)))].slice(0, 60);
const hmOk = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const err = (status, msg) => Object.assign(new Error(msg), { status });

const STATUSES = ['draft', 'submitted', 'approved', 'returned'];
const RAGS = ['green', 'amber', 'red'];
const TOWERS = ['digital', 'bss', 'oss', 'itsm', 'infra', 'enterprise', 'security', 'data'];
const SEGMENTS = ['mobile', 'fixed', 'both'];
const ACT_STATUS = ['open', 'in_progress', 'waiting_salam', 'done', 'cancelled'];
const ACT_LABEL = { open: 'Open', in_progress: 'In progress', waiting_salam: 'Waiting on Salam', done: 'Done', cancelled: 'Cancelled' };
const COUNTERS = ['inc_opened', 'inc_resolved', 'inc_open', 'p1', 'p2', 'sla_breached', 'chg_done', 'chg_failed', 'chg_emergency', 'prb_open', 'rca_done', 'sr_open', 'waiting_salam'];
const COUNTER_LABEL = { inc_opened: 'Incidents opened', inc_resolved: 'Incidents resolved', inc_open: 'Incidents open', p1: 'P1', p2: 'P2', sla_breached: 'SLA breached',
  chg_done: 'Changes done', chg_failed: 'Changes failed', chg_emergency: 'Emergency changes', prb_open: 'Problems open', rca_done: 'RCAs delivered', sr_open: 'Service requests open', waiting_salam: 'Waiting on Salam' };
const FILE_EXT = ['pptx', 'ppt', 'xlsx', 'xls', 'xlsm', 'docx', 'doc', 'pdf', 'eml', 'msg', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'zip'];

/* ---------------------------------------------------------------- settings (console_settings 'opsreports') */
const SN_DASH = 'https://servicehub.salam.sa/now/platform-analytics-workspace/dashboards/params/edit/false/sys-id/73ac970d807d075038129be85f3b54e5';
const DEFAULT_CFG = {
  editors: [], management: [], itsmCc: [],
  dueDay: 0, dueTime: '12:00',
  reminder: { enabled: true, day: 6, time: '18:00' },
  late: { enabled: true, graceMin: 60, hour: 10, max: 3 },
  consolidated: { enabled: true, day: 1, time: '09:00', extra: [] },
  servicenow: { dashboardUrl: SN_DASH, days: 7 },
  dropDays: 14, maxFileMB: 25
};
function normCfg(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const o = x => (x && typeof x === 'object' ? x : {});
  const day = (v, d) => Number.isInteger(+v) && +v >= 0 && +v <= 6 ? +v : d;
  const rm = o(r.reminder), lt = o(r.late), cs = o(r.consolidated), sn = o(r.servicenow);
  const url = str(sn.dashboardUrl, 600);
  return {
    editors: emailList(r.editors), management: emailList(r.management), itsmCc: emailList(r.itsmCc),
    dueDay: day(r.dueDay, 0), dueTime: hmOk(r.dueTime) ? r.dueTime : '12:00',
    reminder: { enabled: rm.enabled !== false, day: day(rm.day, 6), time: hmOk(rm.time) ? rm.time : '18:00' },
    late: { enabled: lt.enabled !== false, graceMin: Math.min(1440, Math.max(0, cnt(lt.graceMin) == null ? 60 : cnt(lt.graceMin))),
      hour: Math.min(20, Math.max(6, cnt(lt.hour) == null ? 10 : cnt(lt.hour))), max: Math.min(5, Math.max(0, cnt(lt.max) == null ? 3 : cnt(lt.max))) },
    consolidated: { enabled: cs.enabled !== false, day: day(cs.day, 1), time: hmOk(cs.time) ? cs.time : '09:00', extra: emailList(cs.extra) },
    servicenow: { dashboardUrl: url && /^https:\/\//i.test(url) ? url : SN_DASH, days: [7, 30, 90].includes(+sn.days) ? +sn.days : 7 },
    dropDays: Math.min(60, Math.max(1, cnt(r.dropDays) || 14)), maxFileMB: Math.min(30, Math.max(1, cnt(r.maxFileMB) || 25))
  };
}
let CFG = normCfg(DEFAULT_CFG), cfgAt = 0, cfgLoading = null;
let TEAMS = [], MEMBERS = new Set();
function indexMembers() {
  const s = new Set([...CFG.editors, ...CFG.management]);
  TEAMS.filter(t => t.active).forEach(t => { t.owners.forEach(e => s.add(e)); t.uploaders.forEach(e => s.add(e)); });
  MEMBERS = s;
}
async function loadCfg(force) {
  if (!force && cfgAt && Date.now() - cfgAt < 60e3) return CFG;
  if (cfgLoading) return cfgLoading;
  cfgLoading = (async () => {
    try { CFG = normCfg(await settings.getSetting('opsreports') || DEFAULT_CFG); } catch (e) { console.error('[opsreports] settings:', e.message); }
    try { await ensure(); TEAMS = (await C().query(`SELECT * FROM opsr_teams ORDER BY sort, name`)).rows.map(teamOut); } catch (e) { console.error('[opsreports] teams:', e.message); }
    cfgAt = Date.now(); indexMembers(); return CFG;
  })().finally(() => { cfgLoading = null; });
  return cfgLoading;
}
/* called by the session middleware on EVERY request — synchronous, from the cached set */
function isMember(email) {
  if (!cfgAt || Date.now() - cfgAt > 60e3) loadCfg().catch(() => {});
  return !!email && MEMBERS.has(lc(email));
}

/* ---------------------------------------------------------------- schema + first teams */
let _ensured = null;
function ensure() {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    const q = s => C().query(s);
    await q(`CREATE TABLE IF NOT EXISTS opsr_teams (
        id bigserial PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL, vendor text, domain text, tower text, segment text NOT NULL DEFAULT 'both',
        scope text, format_note text, cadence text NOT NULL DEFAULT 'weekly', week_start smallint NOT NULL DEFAULT 0, due_day smallint, due_time text,
        owners text[] NOT NULL DEFAULT '{}', uploaders text[] NOT NULL DEFAULT '{}', vendor_contacts jsonb NOT NULL DEFAULT '[]'::jsonb, cc text[] NOT NULL DEFAULT '{}',
        drop_enabled boolean NOT NULL DEFAULT false, kpis jsonb NOT NULL DEFAULT '[]'::jsonb, active boolean NOT NULL DEFAULT true, sort int NOT NULL DEFAULT 100,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz)`);
    await q(`CREATE TABLE IF NOT EXISTS opsr_reports (
        id bigserial PRIMARY KEY, team_id bigint NOT NULL REFERENCES opsr_teams(id) ON DELETE CASCADE, week date NOT NULL,
        period_from date, period_to date, status text NOT NULL DEFAULT 'draft', data jsonb NOT NULL DEFAULT '{}'::jsonb, extract jsonb,
        via text, late boolean NOT NULL DEFAULT false, submitted_by text, submitted_at timestamptz,
        review jsonb, reviewed_by text, reviewed_at timestamptz,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz, UNIQUE (team_id, week))`);
    await q(`CREATE INDEX IF NOT EXISTS idx_opsr_reports_week ON opsr_reports (week)`);
    await q(`CREATE TABLE IF NOT EXISTS opsr_files (
        id bigserial PRIMARY KEY, report_id bigint NOT NULL REFERENCES opsr_reports(id) ON DELETE CASCADE, team_id bigint NOT NULL, week date NOT NULL,
        name text NOT NULL, mime text, size int NOT NULL, sha256 text NOT NULL, data bytea NOT NULL, note text, uploaded_by text, via text,
        created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS idx_opsr_files_report ON opsr_files (report_id)`);
    await q(`CREATE TABLE IF NOT EXISTS opsr_actions (
        id bigserial PRIMARY KEY, team_id bigint NOT NULL REFERENCES opsr_teams(id) ON DELETE CASCADE, ref text NOT NULL, title text NOT NULL,
        owner text, eta date, eta_raw text, eta_history jsonb NOT NULL DEFAULT '[]'::jsonb, status text NOT NULL DEFAULT 'open', status_raw text,
        salam_dep boolean NOT NULL DEFAULT false, update text, first_week date, last_week date, closed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz, UNIQUE (team_id, ref))`);
    await q(`CREATE TABLE IF NOT EXISTS opsr_tokens (
        id bigserial PRIMARY KEY, team_id bigint NOT NULL REFERENCES opsr_teams(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false, uses int NOT NULL DEFAULT 0, last_used_at timestamptz,
        created_by text, created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS opsr_mails (
        id bigserial PRIMARY KEY, kind text NOT NULL, team_id bigint, week date, recipients text[], cc text[], subject text,
        ok boolean NOT NULL DEFAULT false, error text, by text, created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS opsr_jobs (
        key text PRIMARY KEY, attempts int NOT NULL DEFAULT 1, ok boolean NOT NULL DEFAULT false, claimed_at timestamptz NOT NULL DEFAULT now(), by text, result jsonb)`);
    await seed();
  })().catch(e => { _ensured = null; throw e; });
  return _ensured;
}

/* The teams that sent the 27 Sep – 3 Oct 2026 set (ITSM1 / ITSM 2). No e-mail is seeded: owners, uploaders and vendor
 * contacts are named in Teams first, so nobody is mailed before ITSM decides. KPI `match` = a regex on the labels the
 * reader finds in that team's own file, so the value is proposed automatically. */
const K = (key, name, unit, cmp, target, amber, match, agg) => ({ key, name, unit, cmp, target, amber, match, ...(agg ? { agg } : {}) });
const SEED_TEAMS = [
  { key: 'tcs_mvno', name: 'TCS · MVNO IT Operations', vendor: 'TCS', domain: 'MVNO managed services (BSS · Digital · DMS)', tower: 'digital', segment: 'mobile', sort: 10,
    format_note: 'Executive slide (Sun) + Digital MVNO slide (pptx). Contact: Debasis Sahoo.',
    kpis: [K('availability', 'Application availability (4 weeks)', '%', '>=', 99.9, 99.5, '4 weeks availability|availability'), K('activation30', 'New SIM activations within 20 s', '%', '>=', 95, 90, 'activations complete within 20'),
      K('payment', 'Payment success rate', '%', '>=', 95, 92, 'payment success'), K('p1', 'P1 incidents', '', '<=', 0, 1, 'p1 incident')] },
  { key: 'itsm_change', name: 'IT Change Management', vendor: 'TCS', domain: 'Change & release · CAB · PIR', tower: 'itsm', segment: 'both', sort: 20,
    format_note: 'Change tracker (xlsx) + CAB minutes. Contact: Imkhan Moula. CAB Wed 15:00 · Pre-CAB Tue 15:00 · cut-off Mon.',
    kpis: [K('emergency', 'Emergency changes', '%', '<=', 10, 15, 'emergency'), K('p2p', 'Promote-to-Prod error-free', '%', '>=', 90, 85, 'error.?free|promote'),
      K('failed', 'Failed / rolled-back changes', '', '<=', 0, 1, 'failed|rolled')] },
  { key: 'subex_rafm', name: 'Subex · RAFM managed services', vendor: 'Subex', domain: 'Revenue assurance & fraud (DMS · BMS · PAS · BIS)', tower: 'bss', segment: 'both', sort: 30,
    format_note: 'MS Support Review (pptx), SALM-#### Jira tickets. Contact: Rajendra Kumar Sahu.',
    kpis: [K('p1sla', 'P1 restoration SLA violations', '', '<=', 0, 1, 'p1.*violated restoration'), K('availability', 'Lowest service availability', '%', '>=', 99.5, 99, 'availability.*\\(avg\\)', 'min')] },
  { key: 'oracle_css', name: 'Oracle CSS · ERP', vendor: 'Oracle', domain: 'Oracle Fusion ERP support (WSR, MOS SRs)', tower: 'enterprise', segment: 'both', sort: 40,
    format_note: 'Weekly Status Report (pptx) + MOS SR export (4-000…).', kpis: [] },
  { key: 'oracle_impact', name: 'Oracle · Impact / Apollo', vendor: 'Oracle', domain: 'Apollo and Impact', tower: 'enterprise', segment: 'both', sort: 50,
    format_note: 'Weekly report by mail (SharePoint) + monthly dashboard. Contact: Biswajit Roy.', kpis: [] },
  { key: 'tech_platforms', name: 'Technology Platforms', vendor: 'Salam', domain: 'Databases · Remedy · GIS · patching · backup', tower: 'infra', segment: 'both', sort: 60,
    format_note: 'Technology Platforms Weekly Report (pptx). Contact: Mohammed Waheed W Ahmed.',
    kpis: [K('patched', 'DB servers patched (quarter)', '', '>=', null, null, 'patching completed')] },
  { key: 'whale_ftth', name: 'Whale Cloud · ZSmart FTTH BOSS', vendor: 'Whale Cloud', domain: 'FTTH BOSS — DB & filesystem usage, maintenance', tower: 'bss', segment: 'fixed', sort: 70,
    week_start: 1, due_day: 1, format_note: 'Database & Filesystem Usage (pptx), Monday → Sunday. Contacts: Quan Lei, YI SHI.',
    kpis: [K('fsmax', 'Highest DB / filesystem usage', '%', '<=', 80, 85, 'used_rate', 'max')] },
  { key: 'portals', name: 'Portals health check', vendor: 'Salam', domain: 'salam.sa · Salam Mobile web · Hybrid portal (GTmetrix)', tower: 'digital', segment: 'both', sort: 80,
    format_note: 'Websites Performance Report (pptx, screenshots).', kpis: [K('perf', 'GTmetrix performance', '%', '>=', 80, 70, 'performance')] }
];
async function seed() {
  const st = await C().query(`SELECT value FROM console_settings WHERE key='opsreports_seed'`);
  if (st.rowCount) return;
  for (const t of SEED_TEAMS) {
    await C().query(`INSERT INTO opsr_teams (key, name, vendor, domain, tower, segment, format_note, week_start, due_day, kpis, sort, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'seed') ON CONFLICT (key) DO NOTHING`,
      [t.key, t.name, t.vendor, t.domain, t.tower, t.segment, t.format_note, t.week_start || 0, t.due_day == null ? null : t.due_day, JSON.stringify(t.kpis || []), t.sort]);
  }
  await settings.setSetting('opsreports_seed', { v: 1, at: new Date().toISOString() });
  console.log(`[opsreports] seeded ${SEED_TEAMS.length} teams (no e-mail — name owners / uploaders in Operations reports › Teams)`);
}

/* ---------------------------------------------------------------- shapes */
function normKpiTpl(k) {
  const o = k && typeof k === 'object' ? k : {};
  const name = str(o.name, 120); if (!name) return null;
  let match = str(o.match, 200); if (match) { try { new RegExp(match, 'i'); } catch (_) { match = null; } }
  return { key: (str(o.key, 40) || name).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40), name, unit: str(o.unit, 12) || '', cmp: o.cmp === '<=' ? '<=' : '>=',
    target: numOr(o.target), amber: numOr(o.amber), match, agg: ['max', 'min'].includes(o.agg) ? o.agg : null };
}
function teamOut(r) {
  return { id: Number(r.id), key: r.key, name: r.name, vendor: r.vendor, domain: r.domain, tower: r.tower, segment: r.segment, scope: r.scope, formatNote: r.format_note,
    cadence: r.cadence, weekStart: Number(r.week_start) || 0, dueDay: r.due_day == null ? null : Number(r.due_day), dueTime: r.due_time || null,
    owners: (r.owners || []).map(lc), uploaders: (r.uploaders || []).map(lc), vendorContacts: Array.isArray(r.vendor_contacts) ? r.vendor_contacts : [], cc: (r.cc || []).map(lc),
    dropEnabled: !!r.drop_enabled, kpis: Array.isArray(r.kpis) ? r.kpis : [], active: !!r.active, sort: Number(r.sort) || 100,
    updatedBy: r.updated_by, updatedAt: r.updated_at };
}
const contactEmails = t => emailList((t.vendorContacts || []).map(c => c && c.email));
function kpiStatus(k) {
  if (k.value == null || k.target == null) return null;
  const v = k.value, t = k.target, a = k.amber;
  if (k.cmp === '<=') return v <= t ? 'met' : (a != null && v <= a ? 'near' : 'missed');
  return v >= t ? 'met' : (a != null && v >= a ? 'near' : 'missed');
}
const lines = (v, n) => (Array.isArray(v) ? v : String(v || '').split(/\r?\n/)).map(s => String(s || '').replace(/^[\s•\-–*·]+/, '').trim()).filter(Boolean).slice(0, n || 20).map(s => s.slice(0, 400));
function actStatus(raw) {
  const s = lc(raw);
  if (ACT_STATUS.includes(s)) return s;
  if (/cancel|withdrawn|not required/.test(s)) return 'cancelled';
  if (/resolved|closed|done|complete|implemented|fixed/.test(s)) return 'done';
  if (/waiting for customer|customer working|pending (at|with|on) salam|salam team|waiting on salam|awaiting salam|pending from salam/.test(s)) return 'waiting_salam';
  if (/progress|analysis|observation|ongoing|investigat|working/.test(s)) return 'in_progress';
  return 'open';
}
function normData(d, team) {
  const o = x => (x && typeof x === 'object' ? x : {});
  d = o(d);
  const tpl = Object.fromEntries(((team && team.kpis) || []).map(k => [k.key, k]));
  const kpis = (Array.isArray(d.kpis) ? d.kpis : []).slice(0, 40).map(k0 => {
    const k = o(k0), t = tpl[k.key] || {};
    const out = { key: str(k.key, 40), name: str(k.name, 120) || t.name || null, value: numOr(k.value), unit: str(k.unit, 12) || t.unit || '',
      target: numOr(k.target) != null ? numOr(k.target) : (t.target == null ? null : t.target), cmp: (k.cmp || t.cmp) === '<=' ? '<=' : '>=',
      amber: numOr(k.amber) != null ? numOr(k.amber) : (t.amber == null ? null : t.amber), note: str(k.note, 200) };
    out.status = kpiStatus(out);
    return out;
  }).filter(k => k.name && (k.value != null || k.note));
  const counters = Object.fromEntries(COUNTERS.map(c => [c, cnt(o(d.counters)[c])]));
  const actions = (Array.isArray(d.actions) ? d.actions : []).slice(0, 150).map(a0 => {
    const a = o(a0); const title = str(a.title, 300); if (!title) return null;
    return { ref: str(a.ref, 40), title, owner: str(a.owner, 120), eta: isDay(a.eta) ? a.eta : null, etaRaw: str(a.etaRaw, 120), status: actStatus(a.status), statusRaw: str(a.statusRaw || a.status, 60),
      update: str(a.update, 600), salamDep: !!a.salamDep };
  }).filter(Boolean);
  const risks = (Array.isArray(d.risks) ? d.risks : []).slice(0, 30).map(r0 => { const r = o(r0); const title = str(r.title, 300); return title ? {
    title, impact: str(r.impact, 300), owner: str(r.owner, 120), mitigation: str(r.mitigation, 400), severity: ['high', 'medium', 'low'].includes(r.severity) ? r.severity : 'medium' } : null; }).filter(Boolean);
  const out = { rag: RAGS.includes(d.rag) ? d.rag : null, headline: str(d.headline, 300), summary: str(d.summary, 4000), kpis, counters, actions, risks,
    highlights: lines(d.highlights), lowlights: lines(d.lowlights), nextWeek: lines(d.nextWeek), support: str(d.support, 2000) };
  out.ragAuto = ragAuto(out);
  return out;
}
function ragAuto(d) {
  const k = d.kpis || [], c = d.counters || {};
  if (k.some(x => x.status === 'missed') || (c.p1 || 0) > 0) return 'red';
  if (k.some(x => x.status === 'near') || (c.sla_breached || 0) > 0 || (c.chg_failed || 0) > 0 || (d.risks || []).some(r => r.severity === 'high')) return 'amber';
  return k.length || Object.values(c).some(v => v != null) ? 'green' : null;
}

/* reporting window and due time of one team for one Salam week */
function teamPeriod(t, week) { const from = addDays(week, t.weekStart || 0); return { from, to: addDays(from, 6) }; }
function dueAt(t, week) {
  const p = teamPeriod(t, week), dd = t.dueDay == null ? CFG.dueDay : t.dueDay, tm = t.dueTime || CFG.dueTime;
  let d = addDays(p.to, 1); for (let i = 0; i < 7 && dow(d) !== dd; i++) d = addDays(d, 1);
  return ksaAt(d, tm);
}
/* the Salam week a team's own period belongs to (the one it mostly covers) */
const weekForPeriod = (from, to) => weekOf(addDays(to || addDays(from, 6), -3));

/* ---------------------------------------------------------------- permissions */
function who(req) {
  const email = lc(req.viewAs ? req.viewAs.email : req.sessionEmail);
  const admin = !!(req.caps && req.caps.adminTools);
  const editor = admin || CFG.editors.includes(email);
  const ownerOf = TEAMS.filter(t => t.owners.includes(email)).map(t => t.id);
  const uploaderOf = TEAMS.filter(t => t.uploaders.includes(email)).map(t => t.id);
  return { email, admin, editor, ownerOf, uploaderOf, management: CFG.management.includes(email), readOnly: !!req.viewAs };
}
const canTeam = (w, t) => !w.readOnly && !!t && (w.editor || w.ownerOf.includes(t.id) || w.uploaderOf.includes(t.id));
const canOwn = (w, t) => !w.readOnly && !!t && (w.editor || w.ownerOf.includes(t.id));
function meOut(w) {
  return { email: w.email, admin: w.admin, editor: w.editor, management: w.management, readOnly: w.readOnly, ownerOf: w.ownerOf, uploaderOf: w.uploaderOf,
    canTeams: !w.readOnly && w.editor, canSettings: !w.readOnly && w.editor, canEditors: !w.readOnly && w.admin, canReview: !w.readOnly && w.editor,
    canSend: !w.readOnly && w.editor, teamsWritable: w.readOnly ? [] : (w.editor ? TEAMS.map(t => t.id) : [...new Set([...w.ownerOf, ...w.uploaderOf])]) };
}
const teamBy = v => TEAMS.find(t => String(t.id) === String(v) || t.key === v) || null;

let PEOPLE = { at: 0, map: {} };
async function people() {
  if (Date.now() - PEOPLE.at < 60e3) return PEOPLE.map;
  try { PEOPLE = { at: Date.now(), map: await require('./people').directory(C()) }; } catch (e) { PEOPLE.at = Date.now(); }
  return PEOPLE.map;
}
const nameOf = (dir, e) => { if (!e) return null; const p = dir[lc(e)]; return p && p.name ? p.name : e; };

/* ---------------------------------------------------------------- reports */
const REP_COLS = `r.id, r.team_id, to_char(r.week,'YYYY-MM-DD') AS week, to_char(r.period_from,'YYYY-MM-DD') AS period_from, to_char(r.period_to,'YYYY-MM-DD') AS period_to,
  r.status, r.data, r.via, r.late, r.submitted_by, r.submitted_at, r.review, r.reviewed_by, r.reviewed_at, r.created_by, r.created_at, r.updated_by, r.updated_at`;
function reportOut(r, dir, files) {
  if (!r) return null;
  return { id: Number(r.id), teamId: Number(r.team_id), week: r.week, from: r.period_from, to: r.period_to, status: r.status, data: r.data || {}, via: r.via, late: !!r.late,
    submittedBy: r.submitted_by, submittedByName: nameOf(dir, r.submitted_by), submittedAt: r.submitted_at, review: r.review || null, reviewedBy: r.reviewed_by,
    reviewedByName: nameOf(dir, r.reviewed_by), reviewedAt: r.reviewed_at, createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedByName: nameOf(dir, r.updated_by), updatedAt: r.updated_at,
    files: files || undefined, extract: r.extract || undefined };
}
async function getReport(teamId, week, withExtract) {
  const r = await C().query(`SELECT ${REP_COLS}${withExtract ? ', r.extract' : ''} FROM opsr_reports r WHERE r.team_id=$1 AND r.week=$2`, [teamId, week]);
  return r.rows[0] || null;
}
async function ensureReport(t, week, by, via) {
  const p = teamPeriod(t, week);
  const r = await C().query(`INSERT INTO opsr_reports (team_id, week, period_from, period_to, status, via, created_by) VALUES ($1,$2,$3,$4,'draft',$5,$6)
      ON CONFLICT (team_id, week) DO UPDATE SET updated_at = opsr_reports.updated_at RETURNING id`, [t.id, week, p.from, p.to, via || 'upload', by]);
  return Number(r.rows[0].id);
}
async function filesOf(reportIds) {
  if (!reportIds.length) return [];
  return (await C().query(`SELECT id, report_id, name, mime, size, note, uploaded_by, via, created_at FROM opsr_files WHERE report_id = ANY($1::bigint[]) ORDER BY created_at`, [reportIds])).rows
    .map(f => ({ id: Number(f.id), reportId: Number(f.report_id), name: f.name, mime: f.mime, size: f.size, note: f.note, uploadedBy: f.uploaded_by, via: f.via, at: f.created_at }));
}
function displayStatus(t, rep, now) {
  if (!rep) return now > dueAt(t, defaultWeek()) ? 'missing' : 'pending';
  if (rep.status !== 'draft') return rep.status;
  return rep.via === 'drop' ? 'received' : 'draft';
}

/* store one uploaded file, read it, keep the suggestions on the report */
async function storeFile({ t, week, name, mime, buf, by, via, note }) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (!FILE_EXT.includes(ext)) throw err(400, `.${ext} files are not accepted — upload the report as pptx, xlsx, docx, pdf, eml, csv or txt`);
  if (buf.length > CFG.maxFileMB * 1024 * 1024) throw err(413, `file over ${CFG.maxFileMB} MB`);
  if (!buf.length) throw err(400, 'empty file');
  const reportId = await ensureReport(t, week, by, via);
  const sha = hash(buf);
  const dup = await C().query(`SELECT id FROM opsr_files WHERE report_id=$1 AND sha256=$2`, [reportId, sha]);
  let fileId;
  if (dup.rowCount) fileId = Number(dup.rows[0].id);
  else fileId = Number((await C().query(`INSERT INTO opsr_files (report_id, team_id, week, name, mime, size, sha256, data, note, uploaded_by, via) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [reportId, t.id, week, String(name).slice(0, 200), str(mime, 100), buf.length, sha, buf, str(note, 500), by, via])).rows[0].id);
  let x = null, sug = null;
  try {
    x = await parse.extract(buf, name, mime);
    sug = parse.suggest(x, t);
  } catch (e) { x = { note: 'could not be read: ' + e.message, pages: [] }; }
  const summary = { fileId, name, at: new Date().toISOString(), kind: x.kind, pages: (x.pages || []).length, note: x.note || null, meta: x.meta || {},
    outline: (x.pages || []).slice(0, 80).map(p => ({ n: p.n, title: String(p.title || '').slice(0, 120), tables: (p.tables || []).length, charts: (p.charts || []).length })),
    attachments: x.attachments || [], suggestion: sug };
  await C().query(`UPDATE opsr_reports SET extract = jsonb_set(COALESCE(extract,'{}'::jsonb), '{files}', COALESCE(extract->'files','[]'::jsonb) || $2::jsonb), updated_at=now(), updated_by=COALESCE($3, updated_by) WHERE id=$1`,
    [reportId, JSON.stringify([summary]), by]);
  return { reportId, fileId, duplicate: !!dup.rowCount, read: summary };
}

/* the action tracker follows the team's latest submitted list: new refs are added, ETA moves are kept as history */
const actRef = a => a.ref || ('T-' + hash(lc(a.title).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80)).slice(0, 8));
async function syncActions(t, week, actions, by) {
  let added = 0, moved = 0;
  for (const a of actions) {
    const ref = actRef(a);
    const cur = (await C().query(`SELECT id, to_char(eta,'YYYY-MM-DD') AS eta, eta_history, status FROM opsr_actions WHERE team_id=$1 AND ref=$2`, [t.id, ref])).rows[0];
    const salam = a.status === 'waiting_salam' || a.salamDep || /\bsalam\b/i.test(a.owner || '');
    const closed = ['done', 'cancelled'].includes(a.status);
    if (!cur) {
      await C().query(`INSERT INTO opsr_actions (team_id, ref, title, owner, eta, eta_raw, status, status_raw, salam_dep, update, first_week, last_week, closed_at, updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13)`,
        [t.id, ref, a.title, a.owner, a.eta, a.etaRaw, a.status, a.statusRaw, salam, a.update, week, closed ? new Date() : null, by]);
      added++;
    } else {
      const hist = Array.isArray(cur.eta_history) ? cur.eta_history : [];
      if (a.eta && cur.eta && a.eta !== cur.eta) { hist.push({ from: cur.eta, to: a.eta, week, at: new Date().toISOString() }); moved++; }
      await C().query(`UPDATE opsr_actions SET title=$3, owner=COALESCE($4, owner), eta=COALESCE($5, eta), eta_raw=COALESCE($6, eta_raw), eta_history=$7::jsonb, status=$8, status_raw=$9,
          salam_dep=$10, update=COALESCE($11, update), last_week=GREATEST(last_week, $12::date), closed_at=CASE WHEN $13 THEN COALESCE(closed_at, now()) ELSE NULL END, updated_at=now(), updated_by=$14
          WHERE team_id=$1 AND ref=$2`,
        [t.id, ref, a.title, a.owner, a.eta, a.etaRaw, JSON.stringify(hist.slice(-20)), a.status, a.statusRaw, salam, a.update, week, closed, by]);
    }
  }
  return { added, moved };
}
const ACT_COLS = `a.id, a.team_id, a.ref, a.title, a.owner, to_char(a.eta,'YYYY-MM-DD') AS eta, a.eta_raw, a.eta_history, a.status, a.status_raw, a.salam_dep, a.update,
  to_char(a.first_week,'YYYY-MM-DD') AS first_week, to_char(a.last_week,'YYYY-MM-DD') AS last_week, a.closed_at, a.created_at, a.updated_by, a.updated_at`;
function actionOut(a, today) {
  const hist = Array.isArray(a.eta_history) ? a.eta_history : [];
  const open = !['done', 'cancelled'].includes(a.status);
  return { id: Number(a.id), teamId: Number(a.team_id), ref: a.ref, title: a.title, owner: a.owner, eta: a.eta, etaRaw: a.eta_raw, etaMoves: hist.length, etaHistory: hist,
    status: a.status, statusLabel: ACT_LABEL[a.status] || a.status, statusRaw: a.status_raw, salamDep: !!a.salam_dep, update: a.update, firstWeek: a.first_week, lastWeek: a.last_week,
    ageDays: a.first_week ? Math.max(0, Math.round((Date.parse(today) - Date.parse(a.first_week)) / 864e5)) : null,
    overdue: open && !!a.eta && a.eta < today, open, closedAt: a.closed_at, updatedBy: a.updated_by, updatedAt: a.updated_at };
}
async function listActions({ teamId, all } = {}) {
  const today = ksaToday();
  const r = await C().query(`SELECT ${ACT_COLS} FROM opsr_actions a JOIN opsr_teams t ON t.id=a.team_id WHERE t.active
      ${teamId ? 'AND a.team_id=$1' : ''} ${all ? '' : `AND a.status NOT IN ('done','cancelled')`} ORDER BY (a.eta IS NULL), a.eta, a.id LIMIT 1500`, teamId ? [teamId] : []);
  return r.rows.map(a => actionOut(a, today));
}

/* ---------------------------------------------------------------- overview (the status table) */
async function overview(week) {
  const now = new Date(), dir = await people();
  const teams = TEAMS.filter(t => t.active);
  const reps = (await C().query(`SELECT ${REP_COLS} FROM opsr_reports r WHERE r.week = ANY($1::date[])`, [[week, addDays(week, -7)]])).rows;
  const files = await filesOf(reps.filter(r => r.week === week).map(r => Number(r.id)));
  const acts = await listActions();
  const rows = teams.map(t => {
    const rep = reps.find(r => r.week === week && Number(r.team_id) === t.id) || null;
    const prev = reps.find(r => r.week === addDays(week, -7) && Number(r.team_id) === t.id) || null;
    const due = dueAt(t, week), status = rep ? displayStatus(t, rep, now) : (now > due ? 'missing' : 'pending');
    const d = (rep && rep.data) || {};
    const ta = acts.filter(a => a.teamId === t.id);
    return { team: { id: t.id, key: t.key, name: t.name, vendor: t.vendor, domain: t.domain, tower: t.tower, segment: t.segment, owners: t.owners, uploaders: t.uploaders,
        ownerNames: t.owners.map(e => nameOf(dir, e)), dropEnabled: t.dropEnabled, kpiCount: t.kpis.length, contacts: (t.vendorContacts || []).length },
      period: teamPeriod(t, week), due: due.toISOString(), status, late: rep ? (rep.late || (['draft'].includes(rep.status) && now > due)) : false,
      report: rep ? { id: Number(rep.id), status: rep.status, via: rep.via, submittedAt: rep.submitted_at, submittedByName: nameOf(dir, rep.submitted_by), updatedAt: rep.updated_at,
        reviewed: rep.review ? rep.review.decision : null, rag: d.rag || d.ragAuto || null, headline: d.headline || null,
        kpis: (d.kpis || []).map(k => ({ name: k.name, value: k.value, unit: k.unit, target: k.target, cmp: k.cmp, status: k.status })), counters: d.counters || {},
        files: files.filter(f => f.reportId === Number(rep.id)).length, risks: (d.risks || []).length } : null,
      prevRag: prev && prev.data ? (prev.data.rag || prev.data.ragAuto || null) : null,
      actions: { open: ta.length, overdue: ta.filter(a => a.overdue).length, salam: ta.filter(a => a.status === 'waiting_salam' || a.salamDep).length, slipped: ta.filter(a => a.etaMoves >= 2).length } };
  });
  const by = s => rows.filter(r => r.status === s).length;
  const totals = { teams: rows.length, submitted: rows.filter(r => ['submitted', 'approved', 'returned'].includes(r.status)).length, approved: by('approved'), returned: by('returned'),
    received: by('received') + by('draft'), missing: by('missing'), pending: by('pending'), late: rows.filter(r => r.late && r.status !== 'pending').length,
    red: rows.filter(r => r.report && r.report.rag === 'red').length, amber: rows.filter(r => r.report && r.report.rag === 'amber').length, green: rows.filter(r => r.report && r.report.rag === 'green').length,
    actionsOpen: acts.length, actionsOverdue: acts.filter(a => a.overdue).length, actionsSalam: acts.filter(a => a.status === 'waiting_salam' || a.salamDep).length };
  return { week, from: week, to: addDays(week, 6), defaultWeek: defaultWeek(), rows, totals,
    schedule: { dueDay: CFG.dueDay, dueTime: CFG.dueTime, reminder: CFG.reminder, late: CFG.late, consolidated: CFG.consolidated },
    servicenow: { dashboardUrl: CFG.servicenow.dashboardUrl, configured: require('./snItsm').configured() } };
}

/* ---------------------------------------------------------------- the consolidated report */
async function cabWeek(week) {
  try {
    const ok = await C().query(`SELECT to_regclass('cab_changes') IS NOT NULL AS ok`); if (!ok.rows[0].ok) return null;
    const r = await C().query(`SELECT impl_status, count(*)::int n, count(*) FILTER (WHERE lower(coalesce(category,'')) LIKE '%emergency%')::int emergency
        FROM cab_changes WHERE planned_start >= $1 AND planned_start < $2 GROUP BY 1`, [ksaAt(week, '00:00'), ksaAt(addDays(week, 7), '00:00')]);
    const o = { total: 0, completed: 0, issues: 0, failed: 0, off: 0, scheduled: 0, emergency: 0 };
    for (const x of r.rows) { o.total += x.n; o.emergency += x.emergency;
      if (x.impl_status === 'completed') o.completed += x.n; else if (x.impl_status === 'completed_issues') o.issues += x.n;
      else if (['rolled_back', 'failed'].includes(x.impl_status)) o.failed += x.n; else if (['postponed', 'cancelled', 'rejected'].includes(x.impl_status)) o.off += x.n; else o.scheduled += x.n; }
    return o;
  } catch (e) { return null; }
}
async function buildConsolidated(week) {
  const ov = await overview(week), dir = await people();
  const reps = (await C().query(`SELECT ${REP_COLS} FROM opsr_reports r WHERE r.week = ANY($1::date[]) AND r.status IN ('submitted','approved','returned')`, [[week, addDays(week, -7)]])).rows;
  const cur = reps.filter(r => r.week === week), prev = reps.filter(r => r.week === addDays(week, -7));
  const teamName = id => (TEAMS.find(t => t.id === Number(id)) || {}).name || '—';
  const acts = await listActions();
  let sn = null; try { const s = require('./snItsm'); if (s.configured()) sn = await s.dashboard({ days: 7, to: addDays(week, 7) }); } catch (e) { sn = { error: e.message }; }
  const cab = await cabWeek(week);
  // counters summed over the submitted reports
  const sum = Object.fromEntries(COUNTERS.map(c => [c, null]));
  cur.forEach(r => COUNTERS.forEach(c => { const v = ((r.data || {}).counters || {})[c]; if (v != null) sum[c] = (sum[c] || 0) + v; }));
  const offTarget = [];
  cur.forEach(r => ((r.data || {}).kpis || []).forEach(k => { if (k.status === 'missed' || k.status === 'near') {
    const p = prev.find(x => Number(x.team_id) === Number(r.team_id)); const pk = p ? ((p.data || {}).kpis || []).find(z => z.key === k.key || z.name === k.name) : null;
    offTarget.push({ team: teamName(r.team_id), name: k.name, value: k.value, unit: k.unit, target: k.target, cmp: k.cmp, status: k.status, prev: pk ? pk.value : null }); } }));
  const risks = []; cur.forEach(r => ((r.data || {}).risks || []).forEach(x => risks.push({ team: teamName(r.team_id), ...x })));
  risks.sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity));
  const support = cur.filter(r => (r.data || {}).support).map(r => ({ team: teamName(r.team_id), text: r.data.support }));
  const notes = cur.map(r => ({ team: teamName(r.team_id), rag: r.data.rag || r.data.ragAuto, headline: r.data.headline, highlights: (r.data.highlights || []).slice(0, 4),
    lowlights: (r.data.lowlights || []).slice(0, 4), nextWeek: (r.data.nextWeek || []).slice(0, 4) }));
  const overdue = acts.filter(a => a.overdue).map(a => ({ ...a, team: teamName(a.teamId) }));
  const salam = acts.filter(a => a.status === 'waiting_salam' || a.salamDep).map(a => ({ ...a, team: teamName(a.teamId) }));
  const slipped = acts.filter(a => a.etaMoves >= 2).map(a => ({ ...a, team: teamName(a.teamId) }));
  const data = { week, from: week, to: addDays(week, 6), totals: ov.totals, rows: ov.rows, counters: sum, offTarget, risks, support, notes,
    actions: { open: acts.length, overdue, salam, slipped }, servicenow: sn, cab, generatedAt: new Date().toISOString() };
  return { data, ...renderConsolidated(data) };
}
const RAG_HEX = { green: '#0e9f5a', amber: '#d97706', red: '#dc2626' };
const ST_LABEL = { approved: 'Approved', submitted: 'Submitted', returned: 'Returned', received: 'Received (to review)', draft: 'Draft', missing: 'Missing', pending: 'Not due yet' };
const ST_HEX = { approved: '#0e9f5a', submitted: '#2563eb', returned: '#d97706', received: '#7c3aed', draft: '#64748b', missing: '#dc2626', pending: '#94a3b8' };
function renderConsolidated(d) {
  const notify = require('./notify');
  const url = notify.CONSOLE_URL.replace(/#.*$/, '').replace(/\/?$/, '/') + '#opsreports?week=' + d.week;
  const T = d.totals, range = `${fmtDay(d.from)} – ${fmtDay(d.to)} ${d.to.slice(0, 4)}`;
  const th = s => `<th align="left" style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;padding:6px 8px;border-bottom:1px solid #e3e7e5">${s}</th>`;
  const td = (s, x) => `<td style="padding:7px 8px;border-bottom:1px solid #eef1f0;font-size:13px;vertical-align:top;${x || ''}">${s}</td>`;
  const pill = (txt, hex) => `<span style="display:inline-block;font-size:11px;font-weight:700;color:#fff;background:${hex};border-radius:999px;padding:2px 9px">${esc(txt)}</span>`;
  const dot = rag => rag ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${RAG_HEX[rag]}"></span> ${esc(rag.toUpperCase())}` : '—';
  const h2 = s => `<h3 style="margin:22px 0 8px;font-size:15px;color:#0b3d2b">${s}</h3>`;
  const tile = (label, v, hex) => `<td align="center" style="padding:10px 6px;border:1px solid #e3e7e5;border-radius:10px;background:#f8faf9"><div style="font-size:22px;font-weight:800;color:${hex || '#20302a'}">${v}</div><div style="font-size:11px;color:#64748b">${label}</div></td>`;
  const kv = k => k.value == null ? '—' : `${k.value}${k.unit === '%' ? '%' : k.unit ? ' ' + esc(k.unit) : ''}`;
  let h = `<p style="margin:0 0 6px">Weekly operations report — <b>${range}</b>. ${T.submitted} of ${T.teams} teams reported${T.late ? ` (${T.late} late)` : ''}${T.missing ? `, <b style="color:#dc2626">${T.missing} missing</b>` : ''}.</p>`;
  h += `<table role="presentation" width="100%" cellspacing="6" cellpadding="0"><tr>${tile('Reported', `${T.submitted}/${T.teams}`)}${tile('Red', T.red, '#dc2626')}${tile('Amber', T.amber, '#d97706')}${tile('Green', T.green, '#0e9f5a')}${tile('Open actions', T.actionsOpen)}${tile('Overdue', T.actionsOverdue, T.actionsOverdue ? '#dc2626' : null)}</tr></table>`;
  h += h2('Teams');
  h += `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>${th('Team')}${th('Status')}${th('RAG')}${th('Headline')}${th('Actions')}</tr>`;
  d.rows.forEach(r => { const rp = r.report || {}; h += `<tr>${td(`<b>${esc(r.team.name)}</b><div style="font-size:11px;color:#64748b">${esc(r.team.vendor || '')}</div>`)}${td(pill(ST_LABEL[r.status] || r.status, ST_HEX[r.status] || '#64748b') + (r.late && r.status !== 'missing' && r.status !== 'pending' ? ' <span style="font-size:11px;color:#d97706">late</span>' : ''))}${td(dot(rp.rag))}${td(esc(rp.headline || ''))}${td(`${r.actions.open}${r.actions.overdue ? ` · <b style="color:#dc2626">${r.actions.overdue} overdue</b>` : ''}`)}</tr>`; });
  h += `</table>`;
  // ITSM numbers
  const sn = d.servicenow, c = d.counters, cab = d.cab;
  h += h2('ITSM — the week in numbers');
  const cells = [];
  if (sn && !sn.error && sn.incident) {
    const i = sn.incident, sla = sn.sla || {};
    cells.push(['Incidents opened', i.total], ['Open now', i.open], ['P1 · P2', `${(i.byPriority || []).filter(x => /^1/.test(x.label)).reduce((a, x) => a + x.n, 0)} · ${(i.byPriority || []).filter(x => /^2/.test(x.label)).reduce((a, x) => a + x.n, 0)}`],
      ['Resolution SLA met', sla.resolution && sla.resolution.pct != null ? sla.resolution.pct + '%' : '—'], ['Backlog > 1 month', (i.aging || []).filter(x => /month/.test(x.label)).reduce((a, x) => a + x.n, 0)]);
  }
  if (cab && cab.total) cells.push(['Changes (CAB)', cab.total], ['Completed', cab.completed + cab.issues], ['Failed / rolled back', cab.failed], ['Emergency', cab.total ? Math.round(cab.emergency * 100 / cab.total) + '%' : '—']);
  COUNTERS.forEach(k => { if (c[k] != null) cells.push([COUNTER_LABEL[k] + ' (teams)', c[k]]); });
  if (cells.length) { h += `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">`; for (let i = 0; i < cells.length; i += 3) h += `<tr>${cells.slice(i, i + 3).map(([l, v]) => td(`<div style="font-size:11px;color:#64748b">${esc(l)}</div><div style="font-size:17px;font-weight:800">${esc(v)}</div>`)).join('')}</tr>`; h += `</table>`; }
  else h += `<p style="color:#64748b;font-size:13px">No ITSM figure yet for this week${sn && sn.error ? ' (ServiceNow: ' + esc(sn.error) + ')' : ''}.</p>`;
  if (d.offTarget.length) {
    h += h2('KPIs off target');
    h += `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>${th('Team')}${th('KPI')}${th('Value')}${th('Target')}${th('Last week')}</tr>`;
    d.offTarget.forEach(k => { h += `<tr>${td(esc(k.team))}${td(esc(k.name))}${td(`<b style="color:${k.status === 'missed' ? '#dc2626' : '#d97706'}">${kv(k)}</b>`)}${td(`${k.cmp === '<=' ? '≤' : '≥'} ${k.target}${k.unit === '%' ? '%' : ''}`)}${td(k.prev == null ? '—' : k.prev + (k.unit === '%' ? '%' : ''))}</tr>`; });
    h += `</table>`;
  }
  const actTable = (list, title) => {
    if (!list.length) return '';
    let s = h2(title) + `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>${th('Team')}${th('Action')}${th('Owner')}${th('ETA')}${th('Age')}</tr>`;
    list.slice(0, 15).forEach(a => { s += `<tr>${td(esc(a.team))}${td(`${a.ref && !/^T-/.test(a.ref) ? `<span style="font-family:monospace;font-size:11px;color:#0b7a4b">${esc(a.ref)}</span> ` : ''}${esc(a.title)}`)}${td(esc(a.owner || '—'))}${td(`${a.eta ? fmtDay(a.eta) : '—'}${a.etaMoves ? ` <span style="font-size:11px;color:#d97706">moved ${a.etaMoves}×</span>` : ''}`)}${td(a.ageDays == null ? '—' : a.ageDays + ' d')}</tr>`; });
    return s + `</table>${list.length > 15 ? `<p style="font-size:12px;color:#64748b">+ ${list.length - 15} more in the console</p>` : ''}`;
  };
  h += actTable(d.actions.overdue, `Overdue actions (${d.actions.overdue.length})`);
  h += actTable(d.actions.salam, `Waiting on Salam (${d.actions.salam.length})`);
  h += actTable(d.actions.slipped.filter(a => !a.overdue), `ETA moved twice or more (${d.actions.slipped.filter(a => !a.overdue).length})`);
  if (d.risks.length) { h += h2('Risks'); h += `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>${th('Team')}${th('Risk')}${th('Mitigation')}${th('Owner')}</tr>`;
    d.risks.slice(0, 15).forEach(r => { h += `<tr>${td(esc(r.team))}${td(`${r.severity === 'high' ? pill('HIGH', '#dc2626') + ' ' : ''}${esc(r.title)}${r.impact ? `<div style="font-size:12px;color:#64748b">${esc(r.impact)}</div>` : ''}`)}${td(esc(r.mitigation || '—'))}${td(esc(r.owner || '—'))}</tr>`; }); h += `</table>`; }
  if (d.support.length) { h += h2('Support needed from Salam management'); h += '<ul style="margin:0;padding-left:18px">' + d.support.map(s => `<li style="margin:4px 0"><b>${esc(s.team)}</b> — ${esc(s.text)}</li>`).join('') + '</ul>'; }
  const withNotes = d.notes.filter(n => n.highlights.length || n.lowlights.length || n.nextWeek.length);
  if (withNotes.length) {
    h += h2('Highlights · lowlights · next week');
    withNotes.forEach(n => {
      const ul = (label, arr, hex) => arr.length ? `<div style="font-size:11px;font-weight:700;color:${hex};text-transform:uppercase;letter-spacing:.05em;margin-top:6px">${label}</div><ul style="margin:2px 0 0;padding-left:18px">${arr.map(x => `<li style="margin:2px 0;font-size:13px">${esc(x)}</li>`).join('')}</ul>` : '';
      h += `<div style="border:1px solid #e3e7e5;border-left:4px solid ${RAG_HEX[n.rag] || '#cbd5e1'};border-radius:10px;padding:10px 12px;margin:8px 0"><b>${esc(n.team)}</b>${n.headline ? ` — ${esc(n.headline)}` : ''}${ul('Highlights', n.highlights, '#0e9f5a')}${ul('Lowlights', n.lowlights, '#dc2626')}${ul('Next week', n.nextWeek, '#2563eb')}</div>`;
    });
  }
  const missing = d.rows.filter(r => r.status === 'missing').map(r => r.team.name);
  if (missing.length) h += `<p style="margin-top:16px;font-size:13px;color:#dc2626"><b>Not received:</b> ${esc(missing.join(', '))}</p>`;
  h += `<p style="margin-top:18px"><a href="${esc(url)}" style="display:inline-block;background:#0b3d2b;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:9px">Open the full report in the console</a></p>`;
  const subject = `Salam IT Operations — weekly report ${range}${missing.length ? ` · ${missing.length} missing` : ''}`;
  const html = notify.shell({ title: `Weekly operations report · ${range}`, pill: T.red ? `${T.red} red` : T.amber ? `${T.amber} amber` : 'all green', pillColor: T.red ? '#dc2626' : T.amber ? '#d97706' : '#0e9f5a', badge: 'OPERATIONS REPORTS', bodyHtml: h });
  const text = [`Weekly operations report ${range}`, `${T.submitted}/${T.teams} teams reported · red ${T.red} · amber ${T.amber} · green ${T.green} · open actions ${T.actionsOpen} (${T.actionsOverdue} overdue)`,
    ...d.rows.map(r => `- ${r.team.name}: ${ST_LABEL[r.status] || r.status}${r.report && r.report.rag ? ' · ' + r.report.rag.toUpperCase() : ''}${r.report && r.report.headline ? ' — ' + r.report.headline : ''}`), '', url].join('\n');
  return { subject, html, text };
}

/* ---------------------------------------------------------------- mails */
async function logMail(kind, teamId, week, out, by) {
  try { await C().query(`INSERT INTO opsr_mails (kind, team_id, week, recipients, cc, subject, ok, error, by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [kind, teamId || null, week || null, out.recipients || [], out.cc || [], str(out.subject, 300), !!out.sent, str(out.error || out.reason || (out.dev ? 'SMTP not configured' : null), 400), by || 'schedule']); } catch (e) {}
}
async function mintDrop(t, by) {
  const tok = crypto.randomBytes(24).toString('base64url');
  const exp = new Date(Date.now() + CFG.dropDays * 864e5);
  await C().query(`INSERT INTO opsr_tokens (team_id, token_hash, expires_at, created_by) VALUES ($1,$2,$3,$4)`, [t.id, hash(tok), exp, by]);
  const base = require('./notify').CONSOLE_URL.replace(/#.*$/, '').replace(/\/?$/, '/');
  return { url: `${base}opsreports-drop.html?t=${tok}`, expires: exp.toISOString() };
}
function teamMailTo(t, kind) {
  const to = emailList([...t.uploaders, ...contactEmails(t), ...(kind === 'late' || kind === 'returned' ? t.owners : [])]);
  const cc = kind === 'late' ? emailList([...CFG.itsmCc, ...t.cc]).filter(e => !to.includes(e)) : [];
  return { to: to.length ? to : (kind === 'reminder' ? [] : t.owners), cc };
}
async function buildFollowup(t, week, kind, by, comment) {
  const notify = require('./notify');
  const base = notify.CONSOLE_URL.replace(/#.*$/, '').replace(/\/?$/, '/');
  const p = teamPeriod(t, week), due = dueAt(t, week);
  const range = `${fmtDay(p.from)} – ${fmtDay(p.to)}`;
  const acts = (await listActions({ teamId: t.id })).filter(a => kind === 'actions' ? (a.overdue || a.status === 'waiting_salam') : a.overdue);
  const drop = t.dropEnabled && kind !== 'actions' ? await mintDrop(t, by || 'schedule') : null;
  const link = `${base}#opsreports?team=${encodeURIComponent(t.key)}&week=${week}`;
  const dueTxt = `${fmtDT(due)} KSA`;
  let intro, title, pill, pillColor, subject;
  if (kind === 'reminder') { title = `Weekly report due ${fmtDT(due).slice(5, 10).replace('-', '/')}`; pill = 'reminder'; pillColor = '#2563eb';
    intro = `This is a reminder that the <b>${esc(t.name)}</b> weekly report for <b>${range}</b> is due by <b>${dueTxt}</b>. Send it in your usual format — the console reads it.`;
    subject = `Reminder — ${t.name} weekly report (${range}) due ${fmtDT(due)} KSA`; }
  else if (kind === 'late') { title = 'Weekly report not received'; pill = 'late'; pillColor = '#dc2626';
    intro = `We have not received the <b>${esc(t.name)}</b> weekly report for <b>${range}</b>. It was due <b>${dueTxt}</b>. Please upload it today so it is part of the consolidated report to Salam management.`;
    subject = `LATE — ${t.name} weekly report (${range})`; }
  else if (kind === 'returned') { title = 'Weekly report returned'; pill = 'returned'; pillColor = '#d97706';
    intro = `ITSM returned the <b>${esc(t.name)}</b> report for <b>${range}</b>${comment ? `:<br><i>“${esc(comment)}”</i>` : '.'} Please update it and submit again.`;
    subject = `Returned — ${t.name} weekly report (${range})`; }
  else { title = 'Open actions to update'; pill = 'actions'; pillColor = '#7c3aed';
    intro = `These <b>${esc(t.name)}</b> actions are past their ETA or waiting on Salam. Please give an update and a realistic ETA in this week's report.`;
    subject = `Actions to update — ${t.name}`; }
  let body = `<p>${intro}</p>`;
  if (drop) body += `<p><a href="${esc(drop.url)}" style="display:inline-block;background:#0b3d2b;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:9px">Upload the report</a><br><span style="font-size:12px;color:#64748b">Secure upload link for ${esc(t.name)} — valid until ${fmtDT(drop.expires).slice(0, 10)}, no account needed.</span></p>`;
  body += `<p style="font-size:13px">Console users: <a href="${esc(link)}" style="color:#0b7a4b">open the report in Operations reports</a>.</p>`;
  if (acts.length) body += `<p style="margin:16px 0 6px;font-weight:700">Open actions past ETA (${acts.length})</p><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">` +
    acts.slice(0, 20).map(a => `<tr><td style="padding:5px 6px;border-bottom:1px solid #eef1f0;font-size:12.5px">${a.ref && !/^T-/.test(a.ref) ? `<b>${esc(a.ref)}</b> ` : ''}${esc(a.title)}</td><td style="padding:5px 6px;border-bottom:1px solid #eef1f0;font-size:12.5px;white-space:nowrap">${esc(a.owner || '—')}</td><td style="padding:5px 6px;border-bottom:1px solid #eef1f0;font-size:12.5px;white-space:nowrap;color:#dc2626">${a.eta ? fmtDay(a.eta) : '—'}</td></tr>`).join('') + `</table>`;
  const html = notify.shell({ title, pill, pillColor, badge: 'OPERATIONS REPORTS', bodyHtml: body });
  const text = `${subject}\n\n${intro.replace(/<[^>]+>/g, '')}\n${drop ? '\nUpload: ' + drop.url : ''}\nConsole: ${link}`;
  return { subject, html, text, ...teamMailTo(t, kind), drop: !!drop, actions: acts.length };
}
async function sendFollowup(t, week, kind, by, comment) {
  const m = await buildFollowup(t, week, kind, by, comment);
  if (!m.to.length) { const out = { sent: false, error: 'no recipient — name uploaders or vendor contacts for this team', recipients: [], subject: m.subject }; await logMail(kind, t.id, week, out, by); return out; }
  const out = await require('./notify').sendHtml(m.to, m.subject, m.html, [], m.text, m.cc.length ? { cc: m.cc } : undefined);
  await logMail(kind, t.id, week, out, by);
  return { sent: !!out.sent, dev: !!out.dev, error: out.error || null, to: m.to, cc: m.cc, subject: m.subject };
}
async function consolidatedRecipients() { return emailList([...CFG.management, ...CFG.consolidated.extra]); }
async function sendConsolidated(week, { to, by } = {}) {
  const list = to ? emailList(to) : await consolidatedRecipients();
  if (!list.length) { const out = { sent: false, error: 'no recipient — add management recipients in Operations reports › Settings', recipients: [] }; await logMail('consolidated', null, week, out, by); return out; }
  const m = await buildConsolidated(week);
  const out = await require('./notify').sendHtml(list, m.subject, m.html, [], m.text);
  await logMail('consolidated', null, week, out, by);
  return { sent: !!out.sent, dev: !!out.dev, error: out.error || null, to: list, subject: m.subject };
}
/* one send across processes: a failed claim may be retried 15 min later, 3 attempts */
async function claim(key) {
  const r = await C().query(`INSERT INTO opsr_jobs (key, by) VALUES ($1,$2)
      ON CONFLICT (key) DO UPDATE SET attempts = opsr_jobs.attempts + 1, claimed_at = now(), by = EXCLUDED.by
      WHERE opsr_jobs.ok = false AND opsr_jobs.attempts < 3 AND opsr_jobs.claimed_at < now() - interval '15 minutes' RETURNING attempts`, [key, `${os.hostname()}:${process.pid}`]);
  return r.rowCount ? Number(r.rows[0].attempts) : 0;
}
async function done(key, out) {
  const final = !!out.sent || /^no recipient/.test(out.error || '') || out.dev;
  await C().query(`UPDATE opsr_jobs SET ok=$2, result=$3::jsonb WHERE key=$1`, [key, final, JSON.stringify({ sent: !!out.sent, error: out.error || null, to: out.to || [] })]);
}
let tickBusy = false, timer = null;
async function tick() {
  if (tickBusy) return; tickBusy = true;
  try {
    if (process.env.OPSR_MAIL === '0') return;
    const notify = require('./notify'); if (!notify.smtpConfigured()) return;
    await ensure(); await loadCfg();
    const today = ksaToday(), hm = ksaHM(), now = new Date(), d = dow(today);
    const teams = TEAMS.filter(t => t.active && t.cadence === 'weekly');
    const submittedFor = async week => new Set((await C().query(`SELECT team_id FROM opsr_reports WHERE week=$1 AND status IN ('submitted','approved')`, [week])).rows.map(r => Number(r.team_id)));
    // 1. reminder (Saturday 18:00): the week that ends today
    if (CFG.reminder.enabled && d === CFG.reminder.day && hm >= CFG.reminder.time) {
      const week = weekOf(today), sub = await submittedFor(week);
      for (const t of teams) {
        if (sub.has(t.id) || now > dueAt(t, week) || !teamMailTo(t, 'reminder').to.length) continue;   // nobody named yet: nothing to send, nothing logged
        const key = `rem:${week}:${t.id}`; if (!(await claim(key))) continue;
        const out = await sendFollowup(t, week, 'reminder', 'schedule').catch(e => ({ sent: false, error: e.message }));
        await done(key, out);
      }
    }
    // 2. late (due + grace, then daily at the late hour, ITSM in cc)
    if (CFG.late.enabled && CFG.late.max > 0) {
      for (const week of [weekOf(addDays(today, -4)), weekOf(addDays(today, -11))]) {
        const sub = await submittedFor(week);
        for (const t of teams) {
          if (sub.has(t.id) || !teamMailTo(t, 'late').to.length) continue;
          const due = dueAt(t, week); if (now < new Date(due.getTime() + CFG.late.graceMin * 60e3) || now > new Date(due.getTime() + 8 * 864e5)) continue;
          const sent = Number((await C().query(`SELECT count(*)::int n FROM opsr_jobs WHERE key LIKE $1`, [`late:${week}:${t.id}:%`])).rows[0].n);
          const n = sent + 1; if (n > CFG.late.max) continue;
          if (n > 1) { const dueDay = new Date(due.getTime() + KSA).toISOString().slice(0, 10); if (today < addDays(dueDay, n - 1) || Number(hm.slice(0, 2)) < CFG.late.hour) continue; }
          const key = `late:${week}:${t.id}:${n}`; if (!(await claim(key))) continue;
          const out = await sendFollowup(t, week, 'late', 'schedule').catch(e => ({ sent: false, error: e.message }));
          await done(key, out);
        }
      }
    }
    // 3. consolidated (Monday 09:00): the week just reported
    if (CFG.consolidated.enabled && d === CFG.consolidated.day && hm >= CFG.consolidated.time && hm <= '20:00') {
      const week = weekOf(addDays(today, -4)), key = `cons:${week}`;
      if (await claim(key)) { const out = await sendConsolidated(week, { by: 'schedule' }).catch(e => ({ sent: false, error: e.message })); await done(key, out);
        console.log(`[opsreports] consolidated ${week} ${out.sent ? 'sent' : 'NOT sent'} → ${(out.to || []).length} · ${out.error || ''}`); }
    }
  } catch (e) { console.error('[opsreports] tick:', e.message); }
  finally { tickBusy = false; }
}

/* ---------------------------------------------------------------- public drop (vendors) */
const DROP_HITS = new Map();
function dropLimited(key, max) {
  const now = Date.now(), a = (DROP_HITS.get(key) || []).filter(t => now - t < 3600e3);
  if (a.length >= max) return true; a.push(now); DROP_HITS.set(key, a);
  if (DROP_HITS.size > 5000) DROP_HITS.clear();
  return false;
}
async function dropToken(tok) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(String(tok || ''))) return null;
  const r = await C().query(`SELECT k.id, k.team_id, k.expires_at FROM opsr_tokens k JOIN opsr_teams t ON t.id=k.team_id
      WHERE k.token_hash=$1 AND NOT k.revoked AND k.expires_at > now() AND t.active AND t.drop_enabled`, [hash(tok)]);
  if (!r.rowCount) return null;
  const t = TEAMS.find(x => x.id === Number(r.rows[0].team_id)); if (!t) return null;
  return { id: Number(r.rows[0].id), team: t, expires: r.rows[0].expires_at };
}
/* the week being reported first (what a vendor drops on Sunday morning), then the one in progress, then the one before */
const dropWeeks = t => { const w0 = defaultWeek(); return [w0, addDays(w0, 7), addDays(w0, -7)].map(w => ({ week: w, ...teamPeriod(t, w), due: dueAt(t, w).toISOString() })); };

/* ---------------------------------------------------------------- routes */
function mount(app, { requireView, audit }) {
  const ok = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  const deny = (res, msg) => res.status(403).json({ error: msg });
  const ready = () => Promise.all([ensure(), loadCfg()]);

  /* PUBLIC — mounted before the view gate. The session gate in api.js lets exactly these two paths through. */
  app.get('/api/opsreports/drop/:token', ok(async (req, res) => {
    await ready();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
    if (dropLimited('ipget:' + ip, 120)) return res.status(429).json({ error: 'too many requests — try again in an hour' });
    const k = await dropToken(req.params.token); if (!k) return res.status(404).json({ error: 'This upload link is not valid any more — ask Salam ITSM for a new one.' });
    const weeks = dropWeeks(k.team);
    const reps = (await C().query(`SELECT to_char(week,'YYYY-MM-DD') AS week, status FROM opsr_reports WHERE team_id=$1 AND week = ANY($2::date[])`, [k.team.id, weeks.map(w => w.week)])).rows;
    res.json({ team: { name: k.team.name, vendor: k.team.vendor, formatNote: k.team.formatNote }, expires: k.expires, maxMB: CFG.maxFileMB, accept: FILE_EXT,
      weeks: weeks.map(w => ({ ...w, status: (reps.find(r => r.week === w.week) || {}).status || null })) });
  }));
  app.post('/api/opsreports/drop/:token', ok(async (req, res) => {
    await ready();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
    if (dropLimited('ip:' + ip, 40)) return res.status(429).json({ error: 'too many uploads — try again in an hour' });
    const k = await dropToken(req.params.token); if (!k) return res.status(404).json({ error: 'This upload link is not valid any more — ask Salam ITSM for a new one.' });
    if (dropLimited('tok:' + k.id, 30)) return res.status(429).json({ error: 'too many uploads on this link — try again in an hour' });
    const b = req.body || {};
    const week = dropWeeks(k.team).map(w => w.week).includes(b.week) ? b.week : dropWeeks(k.team)[0].week;
    const rep = await getReport(k.team.id, week);
    if (rep && ['submitted', 'approved'].includes(rep.status)) return res.status(409).json({ error: 'The report of this week is already submitted — contact Salam ITSM to add a file.' });
    const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]*,/, ''), 'base64');
    const sender = emailList(b.email)[0] || null;
    const out = await storeFile({ t: k.team, week, name: str(b.name, 200) || 'report', mime: b.mime, buf, by: sender ? 'drop:' + sender : 'drop', via: 'drop', note: str(b.note, 500) });
    await C().query(`UPDATE opsr_tokens SET uses = uses + 1, last_used_at = now() WHERE id=$1`, [k.id]);
    await C().query(`UPDATE opsr_reports SET via='drop' WHERE id=$1 AND status='draft'`, [out.reportId]);
    audit(req, 'opsreports.drop', k.team.key, { week, file: b.name, size: buf.length, duplicate: out.duplicate }, sender ? 'drop:' + sender : 'drop:' + k.team.key);
    // tell the Salam owners there is something to review
    try {
      const to = k.team.owners.length ? k.team.owners : CFG.editors;
      if (to.length && !out.duplicate) {
        const notify = require('./notify');
        const link = notify.CONSOLE_URL.replace(/#.*$/, '').replace(/\/?$/, '/') + `#opsreports?team=${encodeURIComponent(k.team.key)}&week=${week}`;
        const m = { subject: `Received — ${k.team.name} weekly report (${fmtDay(week)})`,
          html: notify.shell({ title: 'Vendor report received', pill: 'to review', pillColor: '#7c3aed', badge: 'OPERATIONS REPORTS',
            bodyHtml: `<p><b>${esc(k.team.name)}</b> dropped <b>${esc(b.name)}</b> for the week of ${fmtDay(week)}${sender ? ` (${esc(sender)})` : ''}.</p><p>Review what the console read from it and submit the report.</p><p><a href="${esc(link)}" style="display:inline-block;background:#0b3d2b;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:9px">Review the report</a></p>` }) };
        const r = await notify.sendHtml(to, m.subject, m.html, [], `${m.subject}\n${link}`); await logMail('received', k.team.id, week, r, 'drop');
      }
    } catch (e) {}
    res.json({ ok: true, week, duplicate: out.duplicate, read: { kind: out.read.kind, pages: out.read.pages, note: out.read.note } });
  }));

  app.use('/api/opsreports', (req, res, next) => /^\/drop\//.test(req.path) ? next() : requireView('opsreports')(req, res, next));
  app.use('/api/opsreports', (req, res, next) => { if (/^\/drop\//.test(req.path)) return next(); ready().then(() => next(), e => res.status(500).json({ error: 'operations reports tables: ' + e.message })); });

  app.get('/api/opsreports/me', ok(async (req, res) => res.json(meOut(who(req)))));
  app.get('/api/opsreports/overview', ok(async (req, res) => {
    const week = isDay(req.query.week) ? weekOf(req.query.week) : defaultWeek();
    res.json({ ...(await overview(week)), me: meOut(who(req)) });
  }));

  /* ---- teams ---- */
  app.get('/api/opsreports/teams', ok(async (req, res) => {
    const w = who(req), dir = await people();
    const list = TEAMS.filter(t => t.active || w.editor).map(t => ({ ...t, ownerNames: t.owners.map(e => nameOf(dir, e)), uploaderNames: t.uploaders.map(e => nameOf(dir, e)),
      notUsers: [...t.owners, ...t.uploaders].filter(e => !dir[e]) }));
    const toks = (await C().query(`SELECT team_id, count(*)::int n, max(expires_at) exp FROM opsr_tokens WHERE NOT revoked AND expires_at > now() GROUP BY 1`)).rows;
    res.json({ teams: list.map(t => ({ ...t, dropLinks: (toks.find(x => Number(x.team_id) === t.id) || {}).n || 0 })), towers: TOWERS, segments: SEGMENTS });
  }));
  const teamFields = (b, cur) => {
    const o = {};
    if ('name' in b || !cur) { o.name = str(b.name, 120); if (!o.name) throw err(400, 'team name required'); }
    if ('vendor' in b) o.vendor = str(b.vendor, 80);
    if ('domain' in b) o.domain = str(b.domain, 200);
    if ('tower' in b) o.tower = TOWERS.includes(b.tower) ? b.tower : null;
    if ('segment' in b) o.segment = SEGMENTS.includes(b.segment) ? b.segment : 'both';
    if ('scope' in b) o.scope = str(b.scope, 600);
    if ('formatNote' in b) o.format_note = str(b.formatNote, 600);
    if ('cadence' in b) o.cadence = ['weekly', 'monthly'].includes(b.cadence) ? b.cadence : 'weekly';
    if ('weekStart' in b) o.week_start = [0, 1].includes(+b.weekStart) ? +b.weekStart : 0;
    if ('dueDay' in b) o.due_day = b.dueDay === '' || b.dueDay == null ? null : (Number.isInteger(+b.dueDay) && +b.dueDay >= 0 && +b.dueDay <= 6 ? +b.dueDay : null);
    if ('dueTime' in b) o.due_time = hmOk(b.dueTime) ? b.dueTime : null;
    if ('owners' in b) o.owners = emailList(b.owners);
    if ('uploaders' in b) o.uploaders = emailList(b.uploaders);
    if ('cc' in b) o.cc = emailList(b.cc);
    if ('vendorContacts' in b) o.vendor_contacts = JSON.stringify((Array.isArray(b.vendorContacts) ? b.vendorContacts : []).slice(0, 20).map(c => ({ name: str((c || {}).name, 80), email: emailList((c || {}).email)[0] || null, role: str((c || {}).role, 60) })).filter(c => c.name || c.email));
    if ('dropEnabled' in b) o.drop_enabled = !!b.dropEnabled;
    if ('kpis' in b) o.kpis = JSON.stringify((Array.isArray(b.kpis) ? b.kpis : []).slice(0, 20).map(normKpiTpl).filter(Boolean));
    if ('active' in b) o.active = b.active !== false;
    if ('sort' in b) o.sort = cnt(b.sort) == null ? 100 : cnt(b.sort);
    return o;
  };
  app.post('/api/opsreports/teams', ok(async (req, res) => {
    const w = who(req); if (!w.editor || w.readOnly) return deny(res, 'ITSM editors and admins only');
    const o = teamFields(req.body || {}, null);
    const key = (str(req.body.key, 40) || o.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'team';
    const cols = Object.keys(o), vals = Object.values(o);
    const r = await C().query(`INSERT INTO opsr_teams (key, ${cols.join(',')}, created_by) VALUES ($1, ${cols.map((_, i) => '$' + (i + 2) + (['vendor_contacts', 'kpis'].includes(cols[i]) ? '::jsonb' : '')).join(',')}, $${cols.length + 2}) RETURNING id`,
      [key, ...vals, w.email]).catch(e => { if (/duplicate key/.test(e.message)) throw err(409, `a team with the key "${key}" exists`); throw e; });
    await loadCfg(true);
    audit(req, 'opsreports.team.create', key, { name: o.name });
    res.json({ ok: true, id: Number(r.rows[0].id) });
  }));
  app.patch('/api/opsreports/teams/:id', ok(async (req, res) => {
    const w = who(req); if (!w.editor || w.readOnly) return deny(res, 'ITSM editors and admins only');
    const t = teamBy(req.params.id); if (!t) return res.status(404).json({ error: 'no such team' });
    const o = teamFields(req.body || {}, t); const cols = Object.keys(o); if (!cols.length) return res.json({ ok: true });
    await C().query(`UPDATE opsr_teams SET ${cols.map((c, i) => `${c}=$${i + 2}${['vendor_contacts', 'kpis'].includes(c) ? '::jsonb' : ''}`).join(', ')}, updated_by=$${cols.length + 2}, updated_at=now() WHERE id=$1`, [t.id, ...Object.values(o), w.email]);
    await loadCfg(true);
    audit(req, 'opsreports.team.update', t.key, { fields: cols });
    res.json({ ok: true });
  }));

  /* ---- one report ---- */
  app.get('/api/opsreports/report', ok(async (req, res) => {
    const w = who(req), t = teamBy(req.query.team); if (!t) return res.status(404).json({ error: 'no such team' });
    const week = isDay(req.query.week) ? weekOf(req.query.week) : defaultWeek(), dir = await people();
    const r = await getReport(t.id, week, true), prev = await getReport(t.id, addDays(week, -7));
    const files = r ? await filesOf([Number(r.id)]) : [];
    const ex = r && r.extract ? r.extract : {};
    res.json({ team: t, week, period: teamPeriod(t, week), due: dueAt(t, week).toISOString(), status: r ? displayStatus(t, r, new Date()) : (new Date() > dueAt(t, week) ? 'missing' : 'pending'),
      report: reportOut(r, dir, files), extract: { files: (ex.files || []).slice(-10) }, prev: prev ? { week: prev.week, status: prev.status, data: prev.data } : null,
      actions: await listActions({ teamId: t.id }), counters: COUNTERS.map(k => ({ key: k, label: COUNTER_LABEL[k] })),
      can: { edit: canTeam(w, t), own: canOwn(w, t), review: !w.readOnly && w.editor } });
  }));
  app.put('/api/opsreports/report', ok(async (req, res) => {
    const w = who(req), b = req.body || {}, t = teamBy(b.team); if (!t) return res.status(404).json({ error: 'no such team' });
    if (!canTeam(w, t)) return deny(res, 'only this team\'s owners and uploaders, and ITSM, can edit its report');
    const week = isDay(b.week) ? weekOf(b.week) : defaultWeek();
    const cur = await getReport(t.id, week);
    if (cur && cur.status === 'approved' && !w.editor) return deny(res, 'this report is approved — ask ITSM to reopen it');
    const data = normData(b.data, t);
    await ensureReport(t, week, w.email, 'form');
    const submit = !!b.submit, now = new Date(), late = submit && now > dueAt(t, week);
    const status = submit ? 'submitted' : (cur && cur.status !== 'draft' && cur.status !== 'returned' ? cur.status : (cur ? cur.status : 'draft'));
    await C().query(`UPDATE opsr_reports SET data=$3::jsonb, status=$4, updated_by=$5, updated_at=now()
        ${submit ? `, submitted_by=$5, submitted_at=now(), late = late OR $6, review = CASE WHEN status='returned' THEN review ELSE NULL END` : ''} WHERE team_id=$1 AND week=$2`,
      submit ? [t.id, week, JSON.stringify(data), status, w.email, late] : [t.id, week, JSON.stringify(data), status, w.email]);
    let sync = null; if (submit) sync = await syncActions(t, week, data.actions, w.email);
    audit(req, submit ? 'opsreports.report.submit' : 'opsreports.report.save', t.key, { week, rag: data.rag || data.ragAuto, kpis: data.kpis.length, actions: data.actions.length, late });
    res.json({ ok: true, status, late, actions: sync, ragAuto: data.ragAuto });
  }));
  app.post('/api/opsreports/upload', ok(async (req, res) => {
    const w = who(req), b = req.body || {}, t = teamBy(b.team); if (!t) return res.status(404).json({ error: 'no such team' });
    if (!canTeam(w, t)) return deny(res, 'only this team\'s owners and uploaders, and ITSM, can upload its report');
    const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]*,/, ''), 'base64');
    let week = isDay(b.week) ? weekOf(b.week) : null;
    // no week chosen: the file name / text tells (the period hint), else the week just reported
    if (!week) { try { const x = await parse.extract(buf, b.name, b.mime); const s = parse.suggest(x, t); week = s.period ? weekForPeriod(s.period.from, s.period.to) : defaultWeek(); } catch (e) { week = defaultWeek(); } }
    const cur = await getReport(t.id, week);
    if (cur && cur.status === 'approved' && !w.editor) return deny(res, 'this report is approved — ask ITSM to reopen it');
    const out = await storeFile({ t, week, name: str(b.name, 200) || 'report', mime: b.mime, buf, by: w.email, via: 'upload', note: str(b.note, 500) });
    audit(req, 'opsreports.upload', t.key, { week, file: b.name, size: buf.length, duplicate: out.duplicate });
    res.json({ ok: true, week, ...out });
  }));
  app.get('/api/opsreports/files/:id', ok(async (req, res) => {
    const r = await C().query(`SELECT f.name, f.mime, f.data, f.team_id, to_char(f.week,'YYYY-MM-DD') week FROM opsr_files f WHERE f.id=$1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'no such file' });
    const f = r.rows[0];
    audit(req, 'opsreports.file.download', String(req.params.id), { name: f.name, team: f.team_id, week: f.week });
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(f.name).replace(/[^\w.\- ()]+/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(f.data);
  }));
  app.delete('/api/opsreports/files/:id', ok(async (req, res) => {
    const w = who(req);
    const r = await C().query(`SELECT f.id, f.name, f.team_id, f.report_id, r.status FROM opsr_files f JOIN opsr_reports r ON r.id=f.report_id WHERE f.id=$1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'no such file' });
    const f = r.rows[0], t = teamBy(f.team_id);
    if (!canTeam(w, t)) return deny(res, 'not your team');
    if (f.status === 'approved' && !w.editor) return deny(res, 'approved report — ask ITSM');
    await C().query(`DELETE FROM opsr_files WHERE id=$1`, [f.id]);
    await C().query(`UPDATE opsr_reports SET extract = jsonb_set(COALESCE(extract,'{}'::jsonb), '{files}', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(extract->'files') x WHERE (x->>'fileId')::bigint <> $2), '[]'::jsonb)) WHERE id=$1`, [f.report_id, f.id]);
    audit(req, 'opsreports.file.delete', String(f.id), { name: f.name, team: t && t.key });
    res.json({ ok: true });
  }));
  app.post('/api/opsreports/report/:id/review', ok(async (req, res) => {
    const w = who(req); if (!w.editor || w.readOnly) return deny(res, 'ITSM editors and admins only');
    const b = req.body || {}, decision = b.decision === 'return' ? 'returned' : b.decision === 'reopen' ? 'draft' : 'approved';
    const r = (await C().query(`SELECT id, team_id, to_char(week,'YYYY-MM-DD') week, status FROM opsr_reports WHERE id=$1`, [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: 'no such report' });
    const comment = str(b.comment, 1000);
    if (decision === 'returned' && !comment) return res.status(400).json({ error: 'say what to fix' });
    await C().query(`UPDATE opsr_reports SET status=$2, review=$3::jsonb, reviewed_by=$4, reviewed_at=now() WHERE id=$1`, [r.id, decision, JSON.stringify({ decision, comment, by: w.email, at: new Date().toISOString() }), w.email]);
    const t = teamBy(r.team_id);
    let mail = null; if (decision === 'returned' && t) mail = await sendFollowup(t, r.week, 'returned', w.email, comment).catch(e => ({ sent: false, error: e.message }));
    audit(req, 'opsreports.report.review', t ? t.key : String(r.team_id), { week: r.week, decision, comment });
    res.json({ ok: true, status: decision, mail });
  }));

  /* ---- actions ---- */
  app.get('/api/opsreports/actions', ok(async (req, res) => {
    const t = req.query.team ? teamBy(req.query.team) : null;
    res.json({ actions: (await listActions({ teamId: t ? t.id : null, all: req.query.all === '1' })).map(a => ({ ...a, team: (TEAMS.find(x => x.id === a.teamId) || {}).name })), statuses: ACT_LABEL });
  }));
  app.patch('/api/opsreports/actions/:id', ok(async (req, res) => {
    const w = who(req), b = req.body || {};
    const a = (await C().query(`SELECT id, team_id, to_char(eta,'YYYY-MM-DD') eta, eta_history FROM opsr_actions WHERE id=$1`, [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: 'no such action' });
    const t = teamBy(a.team_id); if (!canTeam(w, t)) return deny(res, 'not your team');
    const set = [], vals = [a.id];
    const add = (c, v) => { vals.push(v); set.push(`${c}=$${vals.length}`); };
    if ('status' in b) { const s = actStatus(b.status); add('status', s); set.push(`closed_at = ${['done', 'cancelled'].includes(s) ? 'COALESCE(closed_at, now())' : 'NULL'}`); if (s === 'waiting_salam') set.push('salam_dep = true'); }
    if ('eta' in b) { const e = isDay(b.eta) ? b.eta : null; if (e !== a.eta) { const h = Array.isArray(a.eta_history) ? a.eta_history : []; if (a.eta && e) h.push({ from: a.eta, to: e, at: new Date().toISOString(), by: w.email }); add('eta', e); add('eta_history', JSON.stringify(h.slice(-20))); set[set.length - 1] += '::jsonb'; } }
    if ('owner' in b) add('owner', str(b.owner, 120));
    if ('update' in b) add('update', str(b.update, 600));
    if ('salamDep' in b) add('salam_dep', !!b.salamDep);
    if (!set.length) return res.json({ ok: true });
    vals.push(w.email);
    await C().query(`UPDATE opsr_actions SET ${set.join(', ')}, updated_by=$${vals.length}, updated_at=now() WHERE id=$1`, vals);
    audit(req, 'opsreports.action.update', String(a.id), { team: t.key, fields: Object.keys(b) });
    res.json({ ok: true });
  }));

  /* ---- consolidated ---- */
  app.get('/api/opsreports/consolidated', ok(async (req, res) => {
    const week = isDay(req.query.week) ? weekOf(req.query.week) : defaultWeek();
    const m = await buildConsolidated(week);
    if (req.query.format === 'html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(m.html.replace(/cid:[^"]+/g, '')); }
    res.json({ week, subject: m.subject, html: m.html, data: m.data, recipients: await consolidatedRecipients() });
  }));
  app.post('/api/opsreports/consolidated/send', ok(async (req, res) => {
    const w = who(req); if (!w.editor || w.readOnly) return deny(res, 'ITSM editors and admins only');
    const b = req.body || {}, week = isDay(b.week) ? weekOf(b.week) : defaultWeek();
    const out = await sendConsolidated(week, { to: b.to === 'me' ? [w.email] : null, by: w.email });
    audit(req, 'opsreports.consolidated.send', week, { to: b.to === 'me' ? 'me' : 'management', sent: out.sent, n: (out.to || []).length, error: out.error || undefined });
    res.json(out);
  }));

  /* ---- follow-ups ---- */
  app.post('/api/opsreports/followup', ok(async (req, res) => {
    const w = who(req), b = req.body || {}, t = teamBy(b.team); if (!t) return res.status(404).json({ error: 'no such team' });
    if (!canOwn(w, t)) return deny(res, 'team owners and ITSM only');
    const kind = ['reminder', 'late', 'actions'].includes(b.kind) ? b.kind : 'late';
    const week = isDay(b.week) ? weekOf(b.week) : defaultWeek();
    if (b.preview) { const m = await buildFollowup(t, week, kind, w.email); return res.json({ subject: m.subject, html: m.html, to: m.to, cc: m.cc, drop: m.drop }); }
    const out = await sendFollowup(t, week, kind, w.email);
    audit(req, 'opsreports.followup', t.key, { week, kind, sent: out.sent, to: out.to, cc: out.cc, error: out.error || undefined });
    res.json(out);
  }));
  app.post('/api/opsreports/droplink', ok(async (req, res) => {
    const w = who(req), t = teamBy((req.body || {}).team); if (!t) return res.status(404).json({ error: 'no such team' });
    if (!canOwn(w, t)) return deny(res, 'team owners and ITSM only');
    if (!t.dropEnabled) return res.status(400).json({ error: 'vendor upload links are off for this team — switch them on in Teams' });
    const d = await mintDrop(t, w.email);
    audit(req, 'opsreports.droplink', t.key, { expires: d.expires });
    res.json(d);
  }));
  app.post('/api/opsreports/droplink/revoke', ok(async (req, res) => {
    const w = who(req), t = teamBy((req.body || {}).team); if (!t) return res.status(404).json({ error: 'no such team' });
    if (!canOwn(w, t)) return deny(res, 'team owners and ITSM only');
    const r = await C().query(`UPDATE opsr_tokens SET revoked=true WHERE team_id=$1 AND NOT revoked`, [t.id]);
    audit(req, 'opsreports.droplink.revoke', t.key, { n: r.rowCount });
    res.json({ ok: true, revoked: r.rowCount });
  }));

  /* ---- library + mail log ---- */
  app.get('/api/opsreports/library', ok(async (req, res) => {
    const weeks = Math.min(52, Math.max(1, cnt(req.query.weeks) || 12)), from = addDays(defaultWeek(), -7 * (weeks - 1)), dir = await people();
    const reps = (await C().query(`SELECT ${REP_COLS} FROM opsr_reports r WHERE r.week >= $1 ORDER BY r.week DESC, r.team_id`, [from])).rows;
    const files = await filesOf(reps.map(r => Number(r.id)));
    res.json({ from, reports: reps.map(r => ({ id: Number(r.id), teamId: Number(r.team_id), team: (TEAMS.find(t => t.id === Number(r.team_id)) || {}).name, week: r.week, status: r.status, late: r.late,
      rag: (r.data || {}).rag || (r.data || {}).ragAuto || null, headline: (r.data || {}).headline || null, submittedByName: nameOf(dir, r.submitted_by), submittedAt: r.submitted_at,
      files: files.filter(f => f.reportId === Number(r.id)) })) });
  }));
  app.get('/api/opsreports/mails', ok(async (req, res) => {
    const r = await C().query(`SELECT m.id, m.kind, m.team_id, to_char(m.week,'YYYY-MM-DD') week, m.recipients, m.cc, m.subject, m.ok, m.error, m.by, m.created_at FROM opsr_mails m ORDER BY m.id DESC LIMIT 200`);
    res.json({ mails: r.rows.map(m => ({ ...m, id: Number(m.id), team: (TEAMS.find(t => t.id === Number(m.team_id)) || {}).name || null })) });
  }));

  /* ---- settings ---- */
  app.get('/api/opsreports/settings', ok(async (req, res) => {
    const w = who(req);
    const st = (await C().query(`SELECT key, ok, attempts, claimed_at, result FROM opsr_jobs ORDER BY claimed_at DESC LIMIT 20`)).rows;
    res.json({ settings: CFG, me: meOut(w), smtp: require('./notify').smtpConfigured(), mailOff: process.env.OPSR_MAIL === '0', jobs: st, servicenowConfigured: require('./snItsm').configured() });
  }));
  app.put('/api/opsreports/settings', ok(async (req, res) => {
    const w = who(req); if (!w.editor || w.readOnly) return deny(res, 'ITSM editors and admins only');
    const before = CFG, b = req.body || {};
    const next = normCfg({ ...before, ...b, editors: w.admin && 'editors' in b ? b.editors : before.editors });
    await settings.setSetting('opsreports', next);
    await loadCfg(true);
    try { require('./people').invalidate(); } catch (e) {}
    audit(req, 'opsreports.settings', null, { editors: next.editors.length, management: next.management.length, itsmCc: next.itsmCc.length, reminder: next.reminder, late: next.late, consolidated: next.consolidated });
    res.json({ ok: true, settings: CFG });
  }));

  /* ---- ServiceNow, native ---- */
  app.get('/api/opsreports/itsm', ok(async (req, res) => {
    const sn = require('./snItsm');
    const days = [7, 30, 90].includes(+req.query.days) ? +req.query.days : CFG.servicenow.days;
    if (!sn.configured()) return res.json({ configured: false, dashboardUrl: CFG.servicenow.dashboardUrl, need: ['SN_URL', 'SN_USER', 'SN_PASS'] });
    res.json({ configured: true, dashboardUrl: CFG.servicenow.dashboardUrl, ...(await sn.dashboard({ days, force: req.query.refresh === '1' })) });
  }));

  console.log('[opsreports] Operations reports mounted — /api/opsreports/{overview,report,upload,actions,consolidated,followup,teams,settings,itsm,drop}');
}
/* ---------------------------------------------------------------- import (server/scripts/opsr-import.cjs)
 * Loads a week that was collected by hand — the files as the vendors sent them plus the normalized report ITSM wrote
 * from them — exactly as if the team had uploaded and submitted it: files stored and read, report data normalized,
 * actions synced into the tracker. `submittedAt` is when the vendor really sent it (the mail date), so "late" is true. */
async function ensureTeam(def, by) {
  await ensure();
  const r = await C().query(`INSERT INTO opsr_teams (key, name, vendor, domain, tower, segment, format_note, week_start, due_day, kpis, sort, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) ON CONFLICT (key) DO NOTHING RETURNING id`,
    [def.key, def.name, def.vendor || null, def.domain || null, def.tower || null, def.segment || 'both', def.format_note || null, def.week_start || 0,
      def.due_day == null ? null : def.due_day, JSON.stringify((def.kpis || []).map(normKpiTpl).filter(Boolean)), def.sort || 100, by || 'import']);
  await loadCfg(true);
  return { created: r.rowCount > 0, team: teamBy(def.key) };
}
async function importReport({ teamKey, week, files = [], data, status = 'submitted', submittedAt, by = 'import', via = 'import' }) {
  await ensure(); await loadCfg(true);
  const t = teamBy(teamKey); if (!t) throw new Error('no such team: ' + teamKey);
  week = weekOf(week);
  const out = { team: t.key, name: t.name, week, files: [] };
  for (const f of files) {
    const r = await storeFile({ t, week, name: f.name, mime: f.mime, buf: f.buf, by, via });
    out.files.push({ name: f.name, id: r.fileId, duplicate: r.duplicate, pages: r.read.pages, note: r.read.note });
  }
  const reportId = await ensureReport(t, week, by, via);
  if (data) {
    const d = normData(data, t);
    const at = submittedAt ? new Date(submittedAt) : new Date();
    const late = status !== 'draft' && !!submittedAt && at > dueAt(t, week);   // send time unknown → not marked late
    await C().query(`UPDATE opsr_reports SET data=$2::jsonb, status=$3, via=$4, updated_by=$5, updated_at=now(),
        submitted_by=CASE WHEN $3='draft' THEN submitted_by ELSE $5 END, submitted_at=CASE WHEN $3='draft' THEN submitted_at ELSE $6::timestamptz END, late=$7 WHERE id=$1`,
      [reportId, JSON.stringify(d), status, via, by, at.toISOString(), late]);
    if (status !== 'draft') out.actions = await syncActions(t, week, d.actions, by);
    Object.assign(out, { reportId, status, rag: d.rag || d.ragAuto, late, kpis: d.kpis.map(k => `${k.name}=${k.value}${k.unit === '%' ? '%' : ''}${k.status ? ' (' + k.status + ')' : ''}`) });
  }
  return out;
}

function start() {
  ensure().then(() => loadCfg(true)).catch(e => console.error('[opsreports] init:', e.message));
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick(), 60e3);
  if (timer.unref) timer.unref();
}

module.exports = { mount, start, isMember, loadCfg, normData, kpiStatus, dueAt, teamPeriod, weekOf, weekForPeriod, defaultWeek, buildConsolidated, tick, actStatus, ensureTeam, importReport, SEED_TEAMS };
