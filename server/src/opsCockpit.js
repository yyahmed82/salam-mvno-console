/* opsCockpit.js — the VP Operations cockpit (8 Oct 2026, alpha.149)
 *
 * One page for the VP Operations (role ops_vp, view 'vp'): the executive KPIs he shares with the CIO, the last
 * updates from every tower, the week of changes from the CAB (status, result, PIR) and the daily challenges each
 * tower posts — Digital · BSS · OSS · ITSM · Infra. The KPI tiles reuse /api/exec, /api/exec/brief and
 * /api/salesops/overview from the browser; this module owns everything people WRITE.
 *
 *   GET    /api/cockpit/overview                 the page in one call (updates, CAB week, challenges, towers, me)
 *   GET    /api/cockpit/me                       what this person may do here
 *   POST   /api/cockpit/updates                  post a last update        (tower leads: own tower · editors / admins: any)
 *   PATCH  /api/cockpit/updates/:id              edit / pin / delete (soft)
 *   GET    /api/cockpit/cab/meetings             CAB meetings imported so far
 *   GET    /api/cockpit/cab?date=YYYY-MM-DD      one CAB meeting with its changes (default: the latest)
 *   GET    /api/cockpit/cab/changes/:chg         one change + its history
 *   POST   /api/cockpit/cab/parse                paste preview — the CAB table straight from the mail, nothing saved
 *   POST   /api/cockpit/cab/import               save a CAB meeting + its changes   (change managers · editors · admins)
 *   PATCH  /api/cockpit/cab/changes/:chg         implementation status, times, result, PIR, tower / business
 *                                                (the lead of the change's tower, change managers, editors, admins)
 *   GET    /api/cockpit/challenges/:id           one challenge + its notes
 *   POST   /api/cockpit/challenges               raise a challenge          (tower leads: own tower · editors / admins: any)
 *   PATCH  /api/cockpit/challenges/:id           update it (status changes write a note by themselves)
 *   POST   /api/cockpit/challenges/:id/notes     daily note — anyone who can open the page (the VP's comments too)
 *   POST   /api/cockpit/checkin                  "nothing new today" for a tower (its lead · editors · admins)
 *   GET    /api/cockpit/settings                 towers + leads, editors, change managers, morning brief
 *   PUT    /api/cockpit/settings                 admins only
 *   GET    /api/cockpit/people                   console users for the lead pickers (admins)
 *   GET    /api/cockpit/digest/preview           the morning brief as it would go out now (HTML)
 *   POST   /api/cockpit/digest/test              send it now to the caller (admins · editors)
 *
 * WHO MAY DO WHAT. Reading needs the 'vp' view (ops_vp, admin, super admin — and everybody named below gets it
 * automatically: api.js adds 'vp' to the session of any member, so a tower lead keeps his own role). Writing is
 * per person, from console_settings key 'cockpit' (Settings › VP cockpit):
 *   editors          edit any tower, post any update (IT Operations)
 *   changeManagers   import the CAB, edit any change (ITSM)
 *   towers[].leads   post and update their own tower's challenges and updates, record results / PIR of their changes
 *   admins           (adminTools) everything above + the settings
 * The VP role holds no write right except notes: a comment on a challenge is how he asks "when?". Every write is
 * audited (cockpit.*), and the view-as session stays read-only like everywhere else (api.js guard).
 *
 * MORNING BRIEF. 08:00 KSA every day (Settings: hour, weekdays only, extra recipients) to every enabled user holding
 * ops_vp. One send per day across processes: the day is claimed with a conditional upsert on console_settings
 * (cockpit_digest_state) before building, so two consoles on one DB can never both mail; a failed send is tried again
 * 15 min later (3 attempts, until 12:30). COCKPIT_DIGEST=0 disables.
 *
 * TIME. Columns are timestamptz in UTC; the CAB mail speaks KSA wall time ("10/8/2026 5:00PM", US month first) and is
 * converted with the fixed +3 h offset like the rest of the server (Node runs small-icu on 152). */
'use strict';
const os = require('os');
const db = require('./db');
const settings = require('./settings');
const SEED = require('./opsCockpitSeed');

const C = () => db.console;
const KSA = 3 * 3600e3;
const clip = (v, n) => v == null ? null : String(v).slice(0, n);
const str = (v, n) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : null; };
const lc = s => String(s || '').trim().toLowerCase();
const ksaDay = d => new Date(new Date(d == null ? Date.now() : d).getTime() + KSA).toISOString().slice(0, 10);
const ksaHM = d => new Date(new Date(d).getTime() + KSA).toISOString().slice(11, 16);
const ksaMidnight = day => new Date(Date.parse(day + 'T00:00:00Z') - KSA);           // KSA 00:00 of that day, as a UTC Date
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const isoOrNull = v => { if (v == null || v === '') return null; const d = new Date(v); return isNaN(d) ? undefined : d.toISOString(); };

/* ---------------------------------------------------------------- vocabularies */
const TOWERS = [
  { key: 'digital', label: 'Digital', color: '#2563eb', scope: 'Channels, apps, payments (UPG), APIs' },
  { key: 'bss',     label: 'BSS',     color: '#7c3aed', scope: 'Siebel, BRM, OSM, billing, ordering' },
  { key: 'oss',     label: 'OSS',     color: '#0d9488', scope: 'ZSmart OSS, FTTx / 5G provisioning, field force' },
  { key: 'itsm',    label: 'ITSM',    color: '#d97706', scope: 'Change, incident, problem — ServiceNow / Remedy' },
  { key: 'infra',   label: 'Infra',   color: '#475569', scope: 'Data centre, network, storage, compute' }
];
const TOWER_KEYS = TOWERS.map(t => t.key);
const SEGMENTS = ['mobile', 'fixed', 'both'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const CH_STATUSES = ['open', 'in_progress', 'blocked', 'monitoring', 'resolved'];
const CH_STATUS_LABEL = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', monitoring: 'Monitoring', resolved: 'Resolved' };
const UPD_KINDS = ['change', 'fix', 'incident', 'milestone', 'risk', 'update'];
const UPD_TONES = ['good', 'watch', 'bad', 'info'];
const IMPACT_TAGS = ['Customers', 'Call center', 'Operations', 'Big data reports', 'Business', 'Dealers', 'Revenue', 'Regulatory'];
const IMPL = ['scheduled', 'in_progress', 'completed', 'completed_issues', 'rolled_back', 'failed', 'postponed', 'cancelled', 'rejected'];
const IMPL_LABEL = { scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', completed_issues: 'Completed with issues',
  rolled_back: 'Rolled back', failed: 'Failed', postponed: 'Postponed', cancelled: 'Cancelled', rejected: 'Rejected at CAB' };
const IMPL_DONE = ['completed', 'completed_issues', 'rolled_back', 'failed'];          // a result exists → PIR expected
const IMPL_OFF = ['postponed', 'cancelled', 'rejected'];                                // not going in

/* ---------------------------------------------------------------- how every number is counted (alpha.152)
 * One dictionary for the page ("How we count" and the one-line definition under each tile) and for the morning brief,
 * so the VP reads one definition everywhere. Each entry must stay true to the code named in `src`. */
const DEFS = {
  state: { label: 'Mobile / Fixed state', window: 'right now',
    what: 'Read from the open P1 / P2 incidents of the technical rules, the most serious first: the platform, a partner, or the console\'s own data feeds. Business-rule incidents (refunds, decline storms, money and regulator findings) are not shown on this page; they are on the Executive Dashboard. Outage: a P1 is open (the platform or a partner is failing). Degraded: a P2 is open. Monitoring gap: only a monitoring incident is open (the console cannot read one of its data feeds), so the state is not known. OK: nothing technical open at P1 / P2. Infrastructure alerts are not counted here; they are in Infrastructure.',
    src: 'Console alerts of the technical application rules (execBrief.js, statusTech)' },
  affected: { label: 'Customers affected now', window: 'right now',
    what: 'The customers that the open technical P1 / P2 incidents carry, added up. Most rules do not estimate customers; the tile then says "customer impact not estimated", never zero.',
    src: 'alerts.customers (execBrief.js)' },
  month: { label: 'This month', window: 'calendar month, KSA, up to now',
    what: 'Service incidents are incidents of a technical rule (the platform or a partner failing) that spent 5 minutes or more at P1, or are at P1 now. Only their time at P1 counts: an incident often opens at P2 and crosses into P1, or steps back, and each move is recorded. Two at the same time count once. Availability = 1 − service-incident time ÷ time elapsed this month. Monitoring incidents (the console unable to read one of its data feeds) are listed in the drill-down but are not downtime. Business-rule incidents are not counted or shown here. The firings copied from the old consoles count from when they fired and end when they were last seen.',
    src: 'Executive Dashboard › What did it cost us (execBrief.js)' },
  sales: { label: 'Dealer & QR sales today', window: 'today since 00:00 KSA, compared with yesterday at the same time',
    what: 'Mobile counts the SIM activations dealers completed, on the DMS app and on the dealer web portal (mobile.salammobile.sa). Fixed counts the orders completed on the SDA dealer app and through QR codes (e-purchase orders opened from a dealer or campaign QR code). The customers\' own app and web journeys are not in this number; they are in the KPIs below (last 24 h). The tile refreshes every minute; the Sales Operations wall every 30 seconds.',
    src: 'Sales Operations wall, the same number per channel (salesOps.js)' },
  changes: { label: 'Changes tonight', window: 'from now until 08:00 KSA tomorrow',
    what: 'CAB changes still to run, or running, that start before 08:00 tomorrow; postponed, cancelled, rejected and finished changes are left out. "Ended with no result recorded": the change window is over and nobody has recorded the outcome yet (changes of the last 3 weeks). "PIR to record": a result is recorded but not the post-implementation review. "Done this CAB": changes of the latest CAB with a recorded outcome, out of those not postponed, cancelled or rejected.',
    src: 'The weekly CAB import and the results the implementers record' },
  challenges: { label: 'Open challenges', window: 'now',
    what: 'Challenges raised by the towers that are not resolved yet, by severity, each with its owner, its next step and a dated journey.',
    src: 'Posted by the tower leads and editors' },
  towers: { label: 'Towers reported today', window: 'today since 00:00 KSA',
    what: 'A tower has reported when a person posted for it today: a note, a challenge raised or edited, an update, or the "Nothing new today" check-in. The VP\'s comments and the seeded first content do not count.',
    src: 'Notes, updates and check-ins of the day' },
  tcs: { label: 'Mobile weekly · TCS', window: 'the week TCS reports',
    what: 'The figures as TCS presented them in its weekly executive deck and the portals health check. The console does not recompute them.',
    src: 'TCS weekly report, entered by IT Operations' },
  kpi: {
    'mobile.orders': { label: 'App & web orders', window: 'last 24 h',
      what: 'Orders opened in the Salam Mobile app and website (new lines and port-ins), including those abandoned before payment. The line under it counts the checkouts. Dealer sales are in the sales tile.', src: 'Selfcare onboarding_orders and checkouts' },
    'mobile.activations': { label: 'Activation success · app & web', window: 'last 24 h',
      what: 'App and web SIM activations that succeeded, out of those that succeeded or failed for a technical reason (our systems or a partner). Refusals by a business rule (eligibility, …) are left out on this page, whatever the SLO Counts setting. The change under it is the volume of activations, not the rate. Dealer activations are in the sales tile.', src: 'Selfcare activation_logs, technical class (errclass.js)' },
    'mobile.payments': { label: 'Payment reliability · platform', window: 'last 24 h',
      what: 'Payments settled, out of those the gateway approved. "Unconfirmed" means the gateway approved but our platform had not finalised the payment 30 min later. A card decline is the bank\'s answer and is not counted, so this is not the payment success rate (TCS reports that one in its weekly).', src: 'Selfcare payments, objective "Payment reliability"' },
    'mobile.errors': { label: 'Technical errors · app & web', window: 'last 24 h',
      what: 'Failed calls to the Salam Mobile app and web APIs caused by our systems or a partner, against the daily budget. Refusals caused by the customer or a business rule are not counted.', src: 'API error log, technical class (errclass.js)' },
    'fixed.attempts': { label: 'Orders started · SDA & QR', window: 'last 24 h, by start time',
      what: 'Fixed orders started on the SDA dealer app and through QR codes in the last 24 h, whatever happened to them since. The line under it counts those completed and those that created a BSS order. Customer-direct web orders and the Salam Home app are not in this number.', src: 'sda_ops order_attempts (fixed360.js)' },
    'fixed.errors': { label: 'Technical API errors · all journeys', window: 'last 24 h',
      what: 'Technical API errors on every Fixed journey (SDA, QR, web e-purchase and the Salam Home app), against the daily budget. Business errors are not counted on this page, whatever the SLO Counts setting. Unlike the orders started, it includes the customers\' own web and app journeys.', src: 'sda_ops error_events, technical class' }
  },
  /* the questions the VP asked first: two numbers that look alike and are not (8 Oct 2026) */
  diff: [
    { a: 'Dealer & QR sales · Fixed', b: 'Fixed · Orders started · SDA & QR', why: 'The sales tile counts orders COMPLETED since 00:00 KSA; the KPI counts orders STARTED in the last 24 hours, completed or not.' },
    { a: 'Dealer & QR sales · Mobile', b: 'Activation success · app & web', why: 'Different customers: the sales tile counts the activations dealers make (DMS app, dealer portal); the KPI is the success rate of the customers\' own activations in the app and on the website.' },
    { a: 'Payment reliability · platform', b: 'Payment success in the TCS weekly report', why: 'Payment reliability leaves card declines out (it judges our platform); the payment success rate TCS reports every week counts every payment attempt, declines included.' },
    { a: 'Mobile / Fixed state', b: 'Executive Dashboard · Active critical signals', why: 'The state reads only what is open now. The critical-signals tile adds up the P1 alerts open or fired in the last 7 days and the objectives breached now (Fixed also counts an order pile-up of 1,000 or more), so it is not a count of open incidents.' },
    { a: 'This page', b: 'Sales Operations wall', why: 'The same source and the same count; the wall refreshes every 30 seconds, the sales tile here every minute and the rest of the page every 5 minutes. The sales tile says the time of its numbers ("as of").' }
  ]
};
/* the definitions the page reads (alpha.155: technical only, so no longer tied to the SLO Counts setting) */
async function defsNow() { return DEFS; }

/* ---------------------------------------------------------------- settings (console_settings 'cockpit') */
const DEFAULT_CFG = {
  towers: TOWERS.map(t => ({ key: t.key, label: t.label, leads: [] })),
  editors: [], changeManagers: [],
  digest: { enabled: true, hour: 8, minute: 0, weekdays: false, extra: [] }
};
const emailList = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map(lc)
  .filter(e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)))].slice(0, 40);
function normCfg(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const byKey = Object.fromEntries((Array.isArray(r.towers) ? r.towers : []).filter(t => t && TOWER_KEYS.includes(t.key)).map(t => [t.key, t]));
  const d = r.digest && typeof r.digest === 'object' ? r.digest : {};
  return {
    towers: TOWERS.map(t => ({ key: t.key, label: str((byKey[t.key] || {}).label, 24) || t.label, leads: emailList((byKey[t.key] || {}).leads) })),
    editors: emailList(r.editors), changeManagers: emailList(r.changeManagers),
    digest: { enabled: d.enabled !== false, hour: Math.min(12, Math.max(5, Number.isFinite(+d.hour) ? Math.round(+d.hour) : 8)),
      minute: [0, 15, 30, 45].includes(+d.minute) ? +d.minute : 0, weekdays: d.weekdays === true, extra: emailList(d.extra) }
  };
}
let CFG = normCfg(DEFAULT_CFG), cfgAt = 0, cfgLoading = null, MEMBERS = new Set();
function indexMembers(cfg) {
  const s = new Set([...cfg.editors, ...cfg.changeManagers]);
  cfg.towers.forEach(t => t.leads.forEach(e => s.add(e)));
  MEMBERS = s;
}
async function loadCfg(force) {
  if (!force && cfgAt && Date.now() - cfgAt < 60e3) return CFG;
  if (cfgLoading) return cfgLoading;
  cfgLoading = settings.getSetting('cockpit').then(v => { CFG = normCfg(v || DEFAULT_CFG); cfgAt = Date.now(); indexMembers(CFG); return CFG; })
    .catch(e => { console.error('[cockpit] settings:', e.message); cfgAt = Date.now(); return CFG; })
    .finally(() => { cfgLoading = null; });
  return cfgLoading;
}
/* called by the session middleware on EVERY request — synchronous, from the cached set; a stale cache refreshes in
 * the background so the request never waits on it */
function isMember(email) {
  if (!cfgAt || Date.now() - cfgAt > 60e3) loadCfg().catch(() => {});
  return !!email && MEMBERS.has(lc(email));
}

/* ---------------------------------------------------------------- schema */
let _ensured = null;
function ensure() {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    const q = s => C().query(s);
    await q(`CREATE TABLE IF NOT EXISTS cockpit_updates (
        id bigserial PRIMARY KEY, seed_key text UNIQUE,
        tower text NOT NULL DEFAULT 'digital', segment text NOT NULL DEFAULT 'both',
        kind text NOT NULL DEFAULT 'update', tone text NOT NULL DEFAULT 'info',
        title text NOT NULL, body text, impact text[] NOT NULL DEFAULT '{}', ref text, status text,
        pinned boolean NOT NULL DEFAULT false, happened_at timestamptz NOT NULL DEFAULT now(),
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz,
        deleted_at timestamptz, deleted_by text)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cockpit_updates_at ON cockpit_updates (happened_at DESC) WHERE deleted_at IS NULL`);
    await q(`CREATE TABLE IF NOT EXISTS cab_meetings (
        id bigserial PRIMARY KEY, meeting_date date NOT NULL UNIQUE, title text, totals jsonb NOT NULL DEFAULT '{}'::jsonb,
        notes text, source text, changes int NOT NULL DEFAULT 0, imported_by text, imported_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS cab_changes (
        id bigserial PRIMARY KEY, chg text NOT NULL UNIQUE, meeting_id bigint REFERENCES cab_meetings(id) ON DELETE SET NULL,
        area text, release text, title text, impact text, owner text, support_team text, category text, security text,
        itsm_state text, decision text, checklist_raw text, checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
        tower text, tower_auto boolean NOT NULL DEFAULT true, segment text NOT NULL DEFAULT 'both', segment_auto boolean NOT NULL DEFAULT true,
        planned_start timestamptz, planned_end timestamptz, window_note text,
        impl_status text NOT NULL DEFAULT 'scheduled', actual_start timestamptz, actual_end timestamptz,
        result text, implementer text, notified_by text, pir jsonb, pir_status text NOT NULL DEFAULT 'none',
        event_id bigint, created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cab_changes_start ON cab_changes (planned_start)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cab_changes_meeting ON cab_changes (meeting_id)`);
    /* a change presented again at a later CAB moves its "current meeting", but every meeting keeps the list it decided on */
    await q(`CREATE TABLE IF NOT EXISTS cab_presentations (
        meeting_id bigint NOT NULL REFERENCES cab_meetings(id) ON DELETE CASCADE, chg text NOT NULL, decision text, itsm_state text,
        planned_start timestamptz, planned_end timestamptz, PRIMARY KEY (meeting_id, chg))`);
    await q(`CREATE TABLE IF NOT EXISTS cab_change_log (
        id bigserial PRIMARY KEY, chg text NOT NULL, field text, before text, after text, note text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cab_change_log_chg ON cab_change_log (chg, created_at DESC)`);
    await q(`CREATE TABLE IF NOT EXISTS cockpit_challenges (
        id bigserial PRIMARY KEY, seed_key text UNIQUE,
        tower text NOT NULL, segment text NOT NULL DEFAULT 'both',
        title text NOT NULL, impact text, detail text,
        severity text NOT NULL DEFAULT 'medium', status text NOT NULL DEFAULT 'open',
        fix_owner text, followed_by text, next_step text, since date, eta date, refs text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by text, updated_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz, deleted_at timestamptz, deleted_by text)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cockpit_challenges_live ON cockpit_challenges (status, updated_at DESC) WHERE deleted_at IS NULL`);
    await q(`CREATE TABLE IF NOT EXISTS cockpit_notes (
        id bigserial PRIMARY KEY, challenge_id bigint NOT NULL REFERENCES cockpit_challenges(id) ON DELETE CASCADE,
        kind text NOT NULL DEFAULT 'note', body text NOT NULL, status_from text, status_to text, tag text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now())`);
    await q(`ALTER TABLE cockpit_notes ADD COLUMN IF NOT EXISTS tag text`);            // milestone label → the "journey so far" strip
    await q(`CREATE INDEX IF NOT EXISTS idx_cockpit_notes_ch ON cockpit_notes (challenge_id, created_at DESC)`);
    /* vendor weekly reports (TCS for Mobile first): one row per vendor and week, the figures as presented, template-shaped */
    await q(`CREATE TABLE IF NOT EXISTS cockpit_reports (
        id bigserial PRIMARY KEY, seed_key text UNIQUE, vendor text NOT NULL, segment text NOT NULL DEFAULT 'mobile', template text NOT NULL DEFAULT 'tcs_mvno_weekly',
        period_from date NOT NULL, period_to date NOT NULL, title text, data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz, deleted_at timestamptz, deleted_by text)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_cockpit_reports_vendor ON cockpit_reports (vendor, period_to DESC) WHERE deleted_at IS NULL`);
    await q(`CREATE TABLE IF NOT EXISTS cockpit_checkins (
        tower text NOT NULL, day date NOT NULL, note text, created_by text, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tower, day))`);
    await seed();
  })().catch(e => { _ensured = null; throw e; });
  return _ensured;
}

/* ---------------------------------------------------------------- CAB: checklist, dates, tower, business */
const CK = [
  ['reason', 'Reason for change', 'reason\\s+for\\s+(?:the\\s+)?change'],
  ['serviceImpact', 'Impact to the service', 'impact\\s+to\\s+the\\s+service'],
  ['bizImpact', 'Business / technical impact', 'business\\s*\\/\\s*technical\\s+impact'],
  ['plan', 'Implementation plan', 'implementation\\s+plan'],
  ['rollback', 'Rollback plan', 'roll\\s*-?\\s*back\\s+plan'],
  ['tests', 'Test results', 'test\\s+results(?:\\s*\\/\\s*validation\\s+evidence)?'],
  ['path', 'SIT → Preprod → Production', 'sit\\s*\\d?\\s*(?:->|→|à|>)\\s*pre-?prod\\s*(?:->|→|à|>)\\s*production(?:\\s*\\/\\s*low\\s+environment)?'],
  ['bizApproval', 'Business approvals', 'business\\s+approvals?'],
  ['walkthrough', 'Code walkthrough with Operations', 'code\\s+walkthrough\\s+with\\s+operations(?:\\s+team)?'],
  ['schedule', 'Right schedule', 'right\\s+schedule(?:\\s*\\/\\s*approved\\s+deployment\\s+window)?'],
  ['docs', 'Support documentation', 'support\\s+doc(?:umentation|s)?'],
  ['implementer', 'Implementer', 'implement(?:o|e)r(?:\\s+details)?'],
  ['checker', 'Checker', 'checker(?:\\s*\\/\\s*validation\\s+owner(?:\\s+details)?)?'],
  ['impact', 'Impact', 'impact']
];
const CK_RX = new RegExp('(' + CK.map(c => c[2]).join('|') + ')\\s*:', 'gi');
const CK_ONE = CK.map(c => [c[0], c[1], new RegExp('^(?:' + c[2] + ')$', 'i')]);
const INFO_KEYS = new Set(['reason', 'implementer', 'checker', 'path']);
const IMPACT_KEYS = new Set(['serviceImpact', 'bizImpact', 'impact']);
/* "Reason for change : yes Impact to the service: NA … Implementer : MS – Siebel:Monica Checker : Shriyali" → items with a
 * verdict per item: ok · warn · bad · na · missing · info · impact. Gaps are what an approver would question. */
function parseChecklist(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return { items: [], gaps: [] };
  const hits = []; let m; CK_RX.lastIndex = 0;
  while ((m = CK_RX.exec(text))) { const lab = m[1].replace(/\s+/g, ' ').trim(); const def = CK_ONE.find(c => c[2].test(lab)); if (def) hits.push({ key: def[0], label: def[1], at: m.index, end: CK_RX.lastIndex }); }
  const items = [];
  hits.forEach((h, i) => {
    const value = text.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : text.length).trim().replace(/^[:\-–\s]+/, '').trim();
    if (items.some(x => x.key === h.key)) return;                                       // first occurrence wins
    items.push({ key: h.key, label: h.label, value: value.slice(0, 200), verdict: verdict(h.key, value) });
  });
  const gaps = items.filter(x => x.verdict === 'bad' || x.verdict === 'warn' || (x.verdict === 'missing' && ['tests', 'rollback', 'bizApproval', 'schedule', 'docs'].includes(x.key)))
    .map(x => ({ key: x.key, label: x.label, value: x.value || 'not stated', verdict: x.verdict === 'missing' ? 'warn' : x.verdict }));
  return { items, gaps };
}
function verdict(key, value) {
  const v = String(value || '').trim();
  if (!v) return 'missing';
  if (INFO_KEYS.has(key)) return 'info';
  if (IMPACT_KEYS.has(key)) return /^(na|n\/a|no|none|no impact|nil|-)\.?$/i.test(v) ? 'na' : 'impact';
  if (/pending|to be tested|partial|tbd|in progress|not yet/i.test(v)) return 'warn';
  if (/^(na|n\/a|none|-|—)\.?$/i.test(v)) return key === 'rollback' ? 'warn' : 'na';
  if (/^no\b/i.test(v)) return 'bad';
  return 'ok';
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDayCol(s) {
  const t = String(s || '').trim();
  let m = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]+(\d{2,4})$/.exec(t);
  if (m && MON[m[2].slice(0, 3).toLowerCase()]) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], mo: MON[m[2].slice(0, 3).toLowerCase()], d: +m[1] };
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t); if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  return null;
}
/* KSA wall time from the CAB sheet → ISO UTC. US month first like the CAB mail; the Date column breaks a D/M tie. */
function parseWhen(s, hint) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t || /^(n\/?a|tbd|-)$/i.test(t)) return null;
  const hm = (h, mi, ap) => { h = +h || 0; mi = +mi || 0; ap = String(ap || '').toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return [h, mi]; };
  const mk = (y, mo, d, h, mi) => { if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h < 24 && mi >= 0 && mi < 60)) return null; return new Date(Date.UTC(y, mo - 1, d, h, mi) - KSA).toISOString(); };
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,]+(\d{1,2})(?:[:.](\d{2}))?\s*([AaPp]\.?[Mm]\.?)?)?$/.exec(t);
  if (m) {
    const a = +m[1], b = +m[2]; let y = +m[3]; if (y < 100) y += 2000;
    let mo = a, d = b;
    if (a > 12) { mo = b; d = a; } else if (hint && a !== b && hint.d === a && hint.mo === b) { mo = b; d = a; }
    const [h, mi] = hm(m[4], m[5], (m[6] || '').replace(/\./g, ''));
    return mk(y, mo, d, h, mi);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(t);
  if (m) return mk(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0));
  m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})(?:[ ,]+(\d{1,2})(?:[:.](\d{2}))?\s*([AaPp][Mm])?)?$/.exec(t);
  if (m && MON[m[2].slice(0, 3).toLowerCase()]) { let y = +m[3]; if (y < 100) y += 2000; const [h, mi] = hm(m[4], m[5], m[6]); return mk(y, MON[m[2].slice(0, 3).toLowerCase()], +m[1], h, mi); }
  return null;
}
/* tower from the CAB's own words — area first, then support team, then the description. Editable per change. */
const TOWER_RULES = [
  ['digital', /digital|\bupg\b|salam\s*(home\s*)?app|selfcare|e-?purchase|apigw|3\s*scale|\bportal\b|mobile\s*app|website/i],
  ['itsm', /remedy|service\s*now|servicehub|\bitsm\b|change\s*management/i],
  ['infra', /infra|storage|oceanstor|vmware|\bvm\b|\bvms\b|network|\bf5\b|firewall|load\s*balancer|\bbip\b|\boap\b|data\s*cent|\bdc\b|linux|rhel|backup|\bnfs\b/i],
  ['oss', /\boss\b|zsmart|\baces\b|\bgis\b|fttx|ftth|5g|work\s*order|\bwo\b|field|provision/i],
  ['bss', /siebel|\bbrm\b|\bosm\b|\buim\b|\basap\b|\baia\b|\bosb\b|ocomc|\bece\b|\bpdc\b|\bspc\b|\badm\b|impact|apollo|\bbss\b|billing|crm|rodod|\bmed/i]
];
function towerOf(c) {
  for (const field of [c.area, c.support_team, c.title]) {
    const s = String(field || ''); if (!s) continue;
    for (const [k, rx] of TOWER_RULES) if (rx.test(s)) return k;
  }
  return null;
}
function segmentOf(c) {
  const s = [c.area, c.title, c.impact, c.support_team].join(' ');
  const f = /5g-?fwa|homefi|ftth|fttx|\baces\b|\bupg\b|salam\s*home|\bfixed\b|dawiyat|e-?purchase/i.test(s);
  const m = /\bmvno\b|\budm\b|pcrf|roaming|\bdms\b|data\s*sims?|b2cm|b2bm|ocomc|\bsms\b|voice/i.test(s);
  return f && !m ? 'fixed' : m && !f ? 'mobile' : 'both';
}
function implFromDecision(dec) {
  const d = lc(dec);
  if (/partial/.test(d)) return 'completed_issues';
  if (/complet/.test(d)) return 'completed';
  if (/cancel/.test(d)) return 'cancelled';
  if (/reject/.test(d)) return 'rejected';
  if (/hold|moved|next\s*week|defer|postpon/.test(d)) return 'postponed';
  return 'scheduled';
}

/* ---------------------------------------------------------------- CAB: paste parser (HTML from the mail, or TSV) */
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·', rarr: '→', agrave: 'à' };
const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m0, e) => {
  if (e[0] === '#') { const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ' '; }
  return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m0;
});
const cellText = h => decode(String(h).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
function htmlRows(html) {
  const src = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|head|xml)\b[\s\S]*?<\/\1>/gi, '');
  const rows = []; const trRx = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi; let m;
  while ((m = trRx.exec(src))) {
    const cells = []; const tdRx = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi; let c;
    while ((c = tdRx.exec(m[1]))) {
      const span = Math.min(20, Math.max(1, parseInt((/colspan\s*=\s*["']?(\d+)/i.exec(c[2]) || [])[1] || '1', 10)));
      cells.push(cellText(c[3])); for (let i = 1; i < span; i++) cells.push('');
    }
    if (cells.some(x => x)) rows.push(cells);
  }
  return rows;
}
function tsvRows(text) {
  const rows = [];
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    if (!line.trim()) continue;
    const cells = line.split('\t').map(x => x.trim());
    if (cells.length >= 4) rows.push(cells);
    else if (rows.length) { const last = rows[rows.length - 1]; last[last.length - 1] = (last[last.length - 1] + ' ' + line.trim()).trim(); }
  }
  return rows;
}
const COLS = [
  ['chg', /change\s*id|^chg\b|^crq\b|^rfc\b|change\s*(number|no\.?)$|^number$/i],
  ['area', /^area|^application|^system/i],
  ['release', /change\s*\/\s*release|^release|^type$/i],
  ['description', /description|summary|^title|short/i],
  ['impact', /^impact/i],
  ['owner', /owner|assignee/i],
  ['date', /^date$|^date\b/i],
  ['start', /^start|planned\s*start/i],
  ['end', /^end|planned\s*end|finish/i],
  ['decision', /implement|decision|cab\s*status|approval\s*status|cab\s*result/i],
  ['itsm_state', /^status|^state/i],
  ['category', /category|^class/i],
  ['security', /security/i],
  ['support_team', /support|assignment\s*group|^group/i],
  ['checklist', /prereq|checklist/i]
];
const STD_ORDER = ['chg', 'area', 'release', 'description', 'impact', 'owner', 'date', 'start', 'end', 'itsm_state', 'category', 'security', 'support_team', 'decision', 'checklist'];
const ID_RX = /^(CHG|CRQ|RFC|CR)\s*-?\s*\d{4,}/i;
function mapHeader(cells) {
  const idx = {};
  cells.forEach((h, i) => { const t = String(h || '').replace(/\*/g, '').trim(); if (!t) return;
    const hit = COLS.find(([k, rx]) => idx[k] == null && rx.test(t)); if (hit) idx[hit[0]] = i; });
  return idx;
}
function rowToChange(cells, idx) {
  const g = k => idx[k] != null ? String(cells[idx[k]] == null ? '' : cells[idx[k]]).trim() : '';
  const hint = parseDayCol(g('date'));
  const c = {
    chg: g('chg').replace(/\s+/g, '').toUpperCase(),
    area: str(g('area').replace(/^"+|"+$/g, ''), 120), release: str(g('release'), 60),
    title: str(g('description').replace(/^"+|"+$/g, '').replace(/\s+/g, ' '), 400),
    impact: str(g('impact'), 200), owner: str(g('owner'), 120), support_team: str(g('support_team'), 120),
    category: str(g('category'), 40), security: str(g('security'), 60), itsm_state: str(g('itsm_state'), 60),
    decision: str(g('decision'), 60) || 'Approved', checklist_raw: str(g('checklist'), 4000)
  };
  c.planned_start = parseWhen(g('start'), hint);
  c.planned_end = parseWhen(g('end'), hint);
  if (!c.planned_start && hint) c.planned_start = new Date(Date.UTC(hint.y, hint.mo - 1, hint.d) - KSA).toISOString();
  c.window_note = c.planned_start && c.planned_end && c.planned_end < c.planned_start ? 'End time before start time, as submitted to the CAB' : null;
  const ck = parseChecklist(c.checklist_raw); c.checklist = ck.items; c.gaps = ck.gaps;
  c.tower = towerOf(c); c.segment = segmentOf(c); c.impl_status = implFromDecision(c.decision);
  c.warnings = [];
  if (g('start') && !c.planned_start) c.warnings.push(`start "${g('start')}" not understood`);
  if (g('end') && !c.planned_end) c.warnings.push(`end "${g('end')}" not understood`);
  if (c.window_note) c.warnings.push(c.window_note);
  if (!c.tower) c.warnings.push('tower not recognised — set it on the change');
  return c;
}
function parseTotals(text) {
  const t = {}; const keyOf = l => { l = l.toLowerCase();
    if (/total/.test(l)) return 'total'; if (/without\s+prereq|represented/.test(l)) return 'noPrereq'; if (/^normal/.test(l)) return 'normal';
    if (/^standard/.test(l)) return 'standard'; if (/^emergency/.test(l)) return 'emergency'; if (/conditional/.test(l)) return 'conditional';
    if (/approved/.test(l)) return 'approved'; if (/moved|next\s*week/.test(l)) return 'moved'; if (/^hold/.test(l)) return 'hold';
    if (/reject/.test(l)) return 'rejected'; if (/cancel/.test(l)) return 'cancelled'; if (/partial/.test(l)) return 'partial'; if (/^complet/.test(l)) return 'completed';
    return null; };
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    const m = /^\s*[•·\-•]?\s*([A-Za-z][A-Za-z \/()]*?)\s*[–—\-:]\s*(\d{1,4})\s*$/.exec(line);
    if (!m) continue; const k = keyOf(m[1].trim()); if (k && t[k] == null) t[k] = +m[2];
  }
  return t;
}
function detectMeetingDate(text) {
  const s = String(text || '');
  let m = /CAB\s*[-–—|:]*\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i.exec(s);
  if (m && MON[m[2].slice(0, 3).toLowerCase()]) return `${m[3]}-${String(MON[m[2].slice(0, 3).toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /Date:\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i.exec(s);
  if (m && MON[m[2].slice(0, 3).toLowerCase()]) return `${m[3]}-${String(MON[m[2].slice(0, 3).toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
/* the CAB meets on Wednesdays — the default meeting date is the last Wednesday on or before today (KSA) */
function lastWednesday() { const d = new Date(Date.now() + KSA); const back = (d.getUTCDay() - 3 + 7) % 7; return new Date(d.getTime() - back * 864e5).toISOString().slice(0, 10); }
function parseCab({ html, text }) {
  let rows = html ? htmlRows(html) : [];
  let source = 'html';
  if (!rows.some(r => ID_RX.test(String(r[0] || '').trim()) || r.some(c => ID_RX.test(String(c || '').trim())))) { rows = tsvRows(text); source = 'text'; }
  let hi = rows.findIndex(r => r.length >= 4 && r.some(c => /change\s*id|^chg$|^crq$/i.test(String(c || '').replace(/\*/g, '').trim())));
  let idx = hi >= 0 ? mapHeader(rows[hi]) : Object.fromEntries(STD_ORDER.map((k, i) => [k, i]));
  if (idx.chg == null) idx = Object.fromEntries(STD_ORDER.map((k, i) => [k, i]));
  const body = rows.slice(hi >= 0 ? hi + 1 : 0);
  const changes = []; let pendingCk = '';
  for (const r of body) {
    const id = String(r[idx.chg] || '').trim();
    if (!ID_RX.test(id)) {                                               // a checklist that spilled over a page / row break
      const ck = idx.checklist != null ? String(r[idx.checklist] || '').trim() : '';
      if (ck && !r.some((x, i) => i !== idx.checklist && String(x || '').trim())) pendingCk += ' ' + ck;
      continue;
    }
    if (pendingCk && idx.checklist != null) { r[idx.checklist] = (pendingCk + ' ' + (r[idx.checklist] || '')).trim(); pendingCk = ''; }
    const c = rowToChange(r, idx);
    if (!changes.some(x => x.chg === c.chg)) changes.push(c);
  }
  const plain = String(text || '') || cellText(html || '');
  const totals = parseTotals(plain);
  if (totals.total == null && changes.length) {
    const cnt = rx => changes.filter(c => rx.test(lc(c.decision))).length;
    Object.assign(totals, { total: changes.length, normal: changes.filter(c => /normal/i.test(c.category || '')).length,
      emergency: changes.filter(c => /emergency/i.test(c.category || '')).length, standard: changes.filter(c => /standard/i.test(c.category || '')).length,
      approved: cnt(/^approved/), conditional: cnt(/conditional/), rejected: cnt(/reject/), cancelled: cnt(/cancel/), completed: cnt(/^complet/), hold: cnt(/hold/), moved: cnt(/moved|next week/), computed: true });
  }
  return { source, header: hi >= 0, columns: Object.keys(idx), meetingDate: detectMeetingDate(plain), changes, totals };
}

/* ---------------------------------------------------------------- seed (once) */
/* seed v2 (alpha.150): console copy names the team "IT Operations", never "Digital Operations". A console seeded with
 * v1 gets the seeded rows rewritten in place: the update, the four challenges with their seeded notes (authors that are
 * labels, not e-mails — what people wrote themselves is left alone) and the TCS report. The CAB rows keep ITSM's text. */
const REWORD = [['Operations — Digital Ops L2', 'IT Operations — L2'], ['Operations — Digital Ops', 'IT Operations'],
  ['Head of Digital Operations', 'IT Operations'], ['Digital Ops L2', 'IT Operations L2'], ['Digital Operations', 'IT Operations']];
const reword = s => typeof s === 'string' ? REWORD.reduce((t, [a, b]) => t.split(a).join(b), s) : s;
const rewordWho = s => s === 'Operations' ? 'IT Operations' : reword(s);
async function rewordSeed() {
  let n = 0;
  const put = async (table, id, cols, row, fn) => {
    const next = cols.map(c => fn(c)(row[c]));
    if (!cols.some((c, i) => next[i] !== row[c])) return;
    await C().query(`UPDATE ${table} SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`, [id, ...next]); n++;
  };
  const keys = list => (list || []).map(x => x.seed_key);
  for (const r of (await C().query(`SELECT id, body, created_by FROM cockpit_updates WHERE seed_key = ANY($1)`, [keys(SEED.UPDATES)])).rows)
    await put('cockpit_updates', r.id, ['body', 'created_by'], r, () => reword);
  for (const r of (await C().query(`SELECT id, impact, detail, fix_owner, followed_by, next_step, created_by, updated_by FROM cockpit_challenges WHERE seed_key = ANY($1)`, [keys(SEED.CHALLENGES)])).rows) {
    await put('cockpit_challenges', r.id, ['impact', 'detail', 'fix_owner', 'followed_by', 'next_step', 'created_by', 'updated_by'], r, c => /_by$/.test(c) ? rewordWho : reword);
    for (const x of (await C().query(`SELECT id, body, created_by FROM cockpit_notes WHERE challenge_id=$1 AND position('@' in coalesce(created_by, '')) = 0`, [r.id])).rows)
      await put('cockpit_notes', x.id, ['body', 'created_by'], x, c => c === 'created_by' ? rewordWho : reword);
  }
  for (const r of (await C().query(`SELECT id, created_by FROM cockpit_reports WHERE seed_key = ANY($1)`, [keys(SEED.REPORTS)])).rows)
    await put('cockpit_reports', r.id, ['created_by'], r, () => reword);
  return n;
}
/* one seeded challenge with its dated notes; a seed key already present (kept, edited or deleted) is never written again */
async function insertSeedChallenge(ch) {
  const ins = await C().query(`INSERT INTO cockpit_challenges (seed_key, tower, segment, title, impact, detail, severity, status, fix_owner, followed_by, next_step, since, refs, created_by, updated_by, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15) ON CONFLICT (seed_key) DO NOTHING RETURNING id`,
    [ch.seed_key, ch.tower, ch.segment, ch.title, ch.impact, ch.detail, ch.severity, ch.status, ch.fix_owner, ch.followed_by, ch.next_step, ch.since, ch.refs, ch.created_by,
      (ch.notes && ch.notes.length) ? ch.notes[ch.notes.length - 1].at : new Date().toISOString()]);
  if (!ins.rowCount) return false;
  for (const n of ch.notes || []) await C().query(`INSERT INTO cockpit_notes (challenge_id, kind, body, status_to, tag, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ins.rows[0].id, n.kind || 'note', n.body, n.status_to || null, n.tag || null, n.by, n.at]);
  return true;
}
async function seed() {
  const st = await settings.getSetting('cockpit_seed').catch(() => null);
  const have = st ? Number(st.version) || 0 : 0;
  if (have >= SEED.SEED_VERSION) return;
  if (have >= 1) {                                                   // seeded before → only the later steps, never a second load
    const done = [], out = { ...st, version: SEED.SEED_VERSION };
    if (have < 2) { const n = await rewordSeed(); Object.assign(out, { reworded: n, rewordedAt: new Date().toISOString() }); done.push(`first content now says "IT Operations" (${n} row${n === 1 ? '' : 's'} reworded)`); }
    for (const [v, keys] of Object.entries(SEED.ADDED || {})) {
      if (have >= Number(v)) continue;
      for (const k of keys) {
        const ch = SEED.CHALLENGES.find(c => c.seed_key === k); if (!ch) continue;
        if (await insertSeedChallenge(ch)) { (out.added = out.added || []).push(k); done.push(`challenge added: "${ch.title.slice(0, 70)}${ch.title.length > 70 ? '…' : ''}"`); }
      }
    }
    await settings.setSetting('cockpit_seed', out);
    console.log(`[cockpit] seed v${SEED.SEED_VERSION}: ${done.join(' · ') || 'nothing to change'}`);
    return;
  }
  const S = SEED.CAB_2026_10_07;
  const idx = Object.fromEntries(STD_ORDER.map((k, i) => [k, i]));
  const changes = []; let pendingCk = '';
  for (const r of S.rows) {
    if (!r[0]) { pendingCk += ' ' + r[14]; continue; }
    const rr = r.slice(); if (pendingCk) { rr[14] = (pendingCk + ' ' + rr[14]).trim(); pendingCk = ''; }
    changes.push(rowToChange(rr, idx));
  }
  await saveCab({ date: S.date, title: S.title, totals: S.totals, notes: S.notes, source: 'seed: CAB mail 7 Oct 2026', changes, by: 'seed' });
  for (const [chg, x] of Object.entries(SEED.IMPLEMENTED)) {
    const r = await C().query(`SELECT * FROM cab_changes WHERE chg=$1`, [chg]); if (!r.rowCount || r.rows[0].updated_by) continue;
    const pir = x.pir || null;
    await C().query(`UPDATE cab_changes SET impl_status=$2, actual_start=$3, actual_end=$4, result=$5, implementer=$6, notified_by=$7, pir=$8,
        pir_status=$9, segment=COALESCE($10, segment), segment_auto = CASE WHEN $10::text IS NULL THEN segment_auto ELSE false END, updated_by='seed', updated_at=now() WHERE chg=$1`,
      [chg, x.impl_status, x.actual_start || null, x.actual_end || null, x.result || null, x.implementer || null, x.notified_by || null,
        pir ? JSON.stringify(pir) : null, pir ? 'submitted' : (IMPL_DONE.includes(x.impl_status) ? 'due' : 'none'), x.segment || null]);
    await C().query(`INSERT INTO cab_change_log (chg, field, before, after, note, created_by) VALUES ($1,'impl_status','scheduled',$2,$3,'seed')`, [chg, x.impl_status, x.result || null]);
    if (x.actual_start) await marker(chg, 'seed').catch(() => {});
  }
  for (const u of SEED.UPDATES) {
    await C().query(`INSERT INTO cockpit_updates (seed_key, tower, segment, kind, tone, title, body, impact, ref, status, pinned, happened_at, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (seed_key) DO NOTHING`,
      [u.seed_key, u.tower, u.segment, u.kind, u.tone, u.title, u.body, u.impact, u.ref, u.status, !!u.pinned, u.happened_at, u.created_by]);
  }
  for (const ch of SEED.CHALLENGES) await insertSeedChallenge(ch);
  for (const r of SEED.REPORTS || []) await C().query(`INSERT INTO cockpit_reports (seed_key, vendor, segment, template, period_from, period_to, title, data, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (seed_key) DO NOTHING`,
    [r.seed_key, r.vendor, r.segment, r.template, r.period_from, r.period_to, r.title, JSON.stringify(normReport(r.data)), r.created_by]);
  await settings.setSetting('cockpit_seed', { version: SEED.SEED_VERSION, at: new Date().toISOString() });
  console.log(`[cockpit] seeded: CAB 7 Oct 2026 (25 changes), CHG0030330 implemented + PIR, UPG update, ${SEED.CHALLENGES.length} challenges`);
}

/* ---------------------------------------------------------------- CAB writes */
async function saveCab({ date, title, totals, notes, source, changes, by }) {
  const m = await C().query(`INSERT INTO cab_meetings (meeting_date, title, totals, notes, source, changes, imported_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (meeting_date) DO UPDATE SET title=COALESCE(EXCLUDED.title, cab_meetings.title), totals=EXCLUDED.totals, notes=COALESCE(EXCLUDED.notes, cab_meetings.notes),
        source=EXCLUDED.source, changes=EXCLUDED.changes, imported_by=EXCLUDED.imported_by, imported_at=now() RETURNING id`,
    [date, str(title, 200), JSON.stringify(totals || {}), str(notes, 1500), str(source, 80), changes.length, by]);
  const mid = m.rows[0].id; let inserted = 0, updated = 0;
  for (const c of changes) {
    const r = await C().query(`INSERT INTO cab_changes (chg, meeting_id, area, release, title, impact, owner, support_team, category, security, itsm_state, decision,
          checklist_raw, checklist, tower, segment, planned_start, planned_end, window_note, impl_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (chg) DO UPDATE SET meeting_id=EXCLUDED.meeting_id, area=EXCLUDED.area, release=EXCLUDED.release, title=EXCLUDED.title, impact=EXCLUDED.impact,
          owner=EXCLUDED.owner, support_team=EXCLUDED.support_team, category=EXCLUDED.category, security=EXCLUDED.security, itsm_state=EXCLUDED.itsm_state,
          decision=EXCLUDED.decision, checklist_raw=EXCLUDED.checklist_raw, checklist=EXCLUDED.checklist, planned_start=EXCLUDED.planned_start,
          planned_end=EXCLUDED.planned_end, window_note=EXCLUDED.window_note,
          tower = CASE WHEN cab_changes.tower_auto THEN EXCLUDED.tower ELSE cab_changes.tower END,
          segment = CASE WHEN cab_changes.segment_auto THEN EXCLUDED.segment ELSE cab_changes.segment END,
          impl_status = CASE WHEN cab_changes.updated_by IS NULL THEN EXCLUDED.impl_status ELSE cab_changes.impl_status END
        RETURNING (xmax = 0) AS inserted`,
      [c.chg, mid, c.area, c.release, c.title, c.impact, c.owner, c.support_team, c.category, c.security, c.itsm_state, c.decision,
        c.checklist_raw, JSON.stringify(c.checklist || []), c.tower, c.segment || 'both', c.planned_start, c.planned_end, c.window_note, c.impl_status]);
    if (r.rows[0] && r.rows[0].inserted) inserted++; else updated++;
    await C().query(`INSERT INTO cab_presentations (meeting_id, chg, decision, itsm_state, planned_start, planned_end) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (meeting_id, chg) DO UPDATE SET decision=EXCLUDED.decision, itsm_state=EXCLUDED.itsm_state, planned_start=EXCLUDED.planned_start, planned_end=EXCLUDED.planned_end`,
      [mid, c.chg, c.decision, c.itsm_state, c.planned_start, c.planned_end]);
  }
  /* a re-import of the same meeting replaces its list: a change removed from the sheet is no longer "presented" that day */
  await C().query(`DELETE FROM cab_presentations WHERE meeting_id=$1 AND NOT (chg = ANY($2))`, [mid, changes.map(c => c.chg)]);
  return { meetingId: Number(mid), inserted, updated };
}
/* a change with a result becomes a marker on every chart (ops_events), once — re-saving moves the same marker */
async function marker(chg, by) {
  const r = await C().query(`SELECT chg, title, tower, segment, impl_status, actual_start, actual_end, planned_start, planned_end, event_id FROM cab_changes WHERE chg=$1`, [chg]);
  const c = r.rows[0]; if (!c || !IMPL_DONE.includes(c.impl_status)) return null;
  const at = c.actual_start || c.planned_start; if (!at) return null;
  const tw = (TOWERS.find(t => t.key === c.tower) || {}).label || '';
  const area = [c.segment === 'fixed' ? 'Fixed' : c.segment === 'mobile' ? 'Mobile' : 'Mobile + Fixed', tw].filter(Boolean).join(' · ').slice(0, 40);
  const title = `${c.chg} · ${String(c.title || '').slice(0, 110)}${c.impl_status === 'completed' ? '' : ' (' + IMPL_LABEL[c.impl_status].toLowerCase() + ')'}`.slice(0, 160);
  const note = 'CAB change — ' + IMPL_LABEL[c.impl_status];
  const ends = c.actual_end || c.planned_end || null;
  if (c.event_id) {
    const u = await C().query(`UPDATE ops_events SET kind='deploy', title=$2, area=$3, note=$4, at=$5, ends_at=$6 WHERE id=$1`, [c.event_id, title, area, note, at, ends]);
    if (u.rowCount) return c.event_id;
  }
  const ins = await C().query(`INSERT INTO ops_events (kind, title, area, note, at, ends_at, created_by) VALUES ('deploy',$1,$2,$3,$4,$5,$6) RETURNING id`, [title, area, note, at, ends, by || 'cockpit']);
  await C().query(`UPDATE cab_changes SET event_id=$2 WHERE chg=$1`, [chg, ins.rows[0].id]);
  return ins.rows[0].id;
}

/* ---------------------------------------------------------------- vendor weekly reports (template tcs_mvno_weekly) */
const numOr = (v, lo, hi) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[,%\s]/g, '')); return Number.isFinite(n) ? Math.min(hi == null ? 1e9 : hi, Math.max(lo == null ? -1e9 : lo, n)) : null; };
const pct = v => numOr(v, 0, 100);
const cnt = v => { const n = numOr(v, 0); return n == null ? null : Math.round(n); };
function normReport(d) {
  d = d && typeof d === 'object' ? d : {};
  const o = (x) => (x && typeof x === 'object' ? x : {});
  const av = o(d.availability), inc = o(d.incidents), act = o(d.activation), dg = o(d.digital), dp = o(dg.prev), dm = o(d.dms), pay = o(d.payments), dep = o(d.deployments), tk = o(d.tickets);
  return {
    presented: isDay(d.presented) ? d.presented : null,
    availability: { apps: (Array.isArray(av.apps) ? av.apps : []).slice(0, 8).map(a => ({ name: str(o(a).name, 40) || 'App', pct: pct(o(a).pct) })).filter(a => a.name),
      weeks: cnt(av.weeks), outage: str(av.outage, 200) },
    incidents: { major: cnt(inc.major), note: str(inc.note, 300) },
    activation: { within30: pct(act.within30), within30n: cnt(act.within30n), under60: pct(act.under60), total: cnt(act.total), prevWithin30: pct(act.prevWithin30) },
    digital: { newSim: cnt(dg.newSim), portIn: cnt(dg.portIn), simSwap: cnt(dg.simSwap), prev: { newSim: cnt(dp.newSim), portIn: cnt(dp.portIn), simSwap: cnt(dp.simSwap) } },
    dms: { newSim: cnt(dm.newSim), portIn: cnt(dm.portIn), simSwap: cnt(dm.simSwap), note: str(dm.note, 120) },
    payments: { success: pct(pay.success), delta: numOr(pay.delta, -100, 100), functional: pct(pay.functional), technical: pct(pay.technical), successful: cnt(pay.successful),
      top: (Array.isArray(pay.top) ? pay.top : []).slice(0, 8).map(t => [str((t || [])[0], 60), pct((t || [])[1])]).filter(t => t[0]) },
    deployments: { total: cnt(dep.total), failed: cnt(dep.failed), emergency: cnt(dep.emergency),
      items: (Array.isArray(dep.items) ? dep.items : []).slice(0, 12).map(t => [str((t || [])[0], 30), str((t || [])[1], 120), str((t || [])[2], 30)]).filter(t => t[0] || t[1]) },
    tickets: { created: cnt(tk.created), resolved: cnt(tk.resolved), open: cnt(tk.open), avgHours: numOr(tk.avgHours, 0, 10000), withinWeek: pct(tk.withinWeek) },
    risks: (Array.isArray(d.risks) ? d.risks : []).slice(0, 10).map(r => ({ text: str(o(r).text, 300), owner: str(o(r).owner, 120) })).filter(r => r.text),
    portalsDate: isDay(d.portalsDate) ? d.portalsDate : null,
    portals: (Array.isArray(d.portals) ? d.portals : []).slice(0, 6).map(x => ({ site: str(o(x).site, 80), label: str(o(x).label, 60), grade: str(o(x).grade, 2), perf: pct(o(x).perf),
      structure: pct(o(x).structure), lcp: str(o(x).lcp, 20), loaded: str(o(x).loaded, 20), size: str(o(x).size, 60), issue: str(o(x).issue, 300) })).filter(x => x.site)
  };
}
const reportOut = (r, dir) => r ? ({ id: Number(r.id), vendor: r.vendor, segment: r.segment, template: r.template, from: ksaDayOfDate(r.period_from), to: ksaDayOfDate(r.period_to),
  title: r.title, data: r.data || {}, createdBy: r.created_by, createdByName: nameOf(dir, r.created_by), createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at }) : null;

/* ---------------------------------------------------------------- permissions */
function who(req) {
  const email = lc(req.sessionEmail);
  const cfg = CFG;
  const admin = !!(req.caps && req.caps.adminTools);
  const editor = admin || cfg.editors.includes(email);
  const changeMgr = editor || cfg.changeManagers.includes(email);
  const leadOf = cfg.towers.filter(t => t.leads.includes(email)).map(t => t.key);
  const read = (req.views || []).includes('vp');
  return { email, admin, editor, changeMgr, leadOf, read, isVp: (req.roleNames || []).includes('ops_vp'), readOnly: !!req.viewAs };
}
const canTower = (w, tower) => w.editor || w.leadOf.includes(tower);
const canChange = (w, c) => w.changeMgr || (c && c.tower && w.leadOf.includes(c.tower));
function meOut(w) {
  return { email: w.email, admin: w.admin, editor: w.editor, changeManager: w.changeMgr, leadOf: w.leadOf, isVp: w.isVp, readOnly: w.readOnly,
    canPost: !w.readOnly && (w.editor || w.leadOf.length > 0), canImport: !w.readOnly && w.changeMgr, canSettings: !w.readOnly && w.admin,
    towersWritable: w.readOnly ? [] : (w.editor ? TOWER_KEYS : w.leadOf), canNote: !w.readOnly && w.read,
    canReport: !w.readOnly && (w.editor || w.leadOf.includes('digital')) };
}

/* ---------------------------------------------------------------- readers */
let PEOPLE = { at: 0, map: {} };
async function people() {
  if (Date.now() - PEOPLE.at < 60e3) return PEOPLE.map;
  try { PEOPLE = { at: Date.now(), map: await require('./people').directory(C()) }; } catch (e) { PEOPLE.at = Date.now(); }
  return PEOPLE.map;
}
const nameOf = (dir, e) => { const p = dir[lc(e)]; return p && p.name ? p.name : null; };
function changeOut(c, now) {
  const end = c.planned_end && c.planned_end >= c.planned_start ? c.planned_end : (c.planned_start ? new Date(new Date(c.planned_start).getTime() + 6 * 3600e3) : null);
  const awaiting = ['scheduled', 'in_progress'].includes(c.impl_status) && end && new Date(end) < now;
  const ck = Array.isArray(c.checklist) ? c.checklist : [];
  const gaps = parseChecklist(c.checklist_raw).gaps;
  return { chg: c.chg, meetingId: c.meeting_id == null ? null : Number(c.meeting_id), meetingDate: c.meeting_date ? ksaDayOfDate(c.meeting_date) : null, area: c.area, release: c.release, title: c.title, impact: c.impact,
    owner: c.owner, supportTeam: c.support_team, category: c.category, security: c.security, itsmState: c.itsm_state, decision: c.decision,
    checklist: ck, gaps, tower: c.tower, towerAuto: c.tower_auto, segment: c.segment, segmentAuto: c.segment_auto,
    plannedStart: c.planned_start, plannedEnd: c.planned_end, windowNote: c.window_note,
    implStatus: c.impl_status, implLabel: IMPL_LABEL[c.impl_status] || c.impl_status, actualStart: c.actual_start, actualEnd: c.actual_end,
    result: c.result, implementer: c.implementer, notifiedBy: c.notified_by, pir: c.pir || null,
    pirStatus: c.pir ? 'submitted' : IMPL_DONE.includes(c.impl_status) ? 'due' : 'none',
    awaiting: !!awaiting, updatedBy: c.updated_by, updatedAt: c.updated_at };
}
const ksaDayOfDate = d => d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10);
const challengeOut = (c, dir) => ({ id: Number(c.id), tower: c.tower, segment: c.segment, title: c.title, impact: c.impact, detail: c.detail, severity: c.severity,
  status: c.status, statusLabel: CH_STATUS_LABEL[c.status] || c.status, fixOwner: c.fix_owner, followedBy: c.followed_by, nextStep: c.next_step,
  since: c.since ? ksaDayOfDate(c.since) : null, eta: c.eta ? ksaDayOfDate(c.eta) : null, refs: c.refs,
  createdBy: c.created_by, createdByName: nameOf(dir, c.created_by), createdAt: c.created_at,
  updatedBy: c.updated_by, updatedByName: nameOf(dir, c.updated_by), updatedAt: c.updated_at, resolvedAt: c.resolved_at,
  notes: c.notes_n != null ? Number(c.notes_n) : undefined,
  lastNote: c.last_body ? { body: c.last_body, by: c.last_by, byName: nameOf(dir, c.last_by), at: c.last_at, kind: c.last_kind, tag: c.last_tag || null } : null,
  ageDays: c.since ? Math.max(0, Math.floor((Date.now() - Date.parse(ksaDayOfDate(c.since) + 'T00:00:00Z') + KSA) / 864e5)) : null });
const updateOut = (u, dir) => ({ id: Number(u.id), auto: false, tower: u.tower, segment: u.segment, kind: u.kind, tone: u.tone, title: u.title, body: u.body,
  impact: u.impact || [], ref: u.ref, status: u.status, pinned: u.pinned, at: u.happened_at,
  createdBy: u.created_by, createdByName: nameOf(dir, u.created_by), updatedBy: u.updated_by, updatedAt: u.updated_at });

async function overview(req) {
  await ensure(); await loadCfg();
  const w = who(req), now = new Date(), today = ksaDay(now), dir = await people();
  const [upd, chg, chs, chk, meetings, dg, pres, reps, rep] = await Promise.all([
    C().query(`SELECT * FROM cockpit_updates WHERE deleted_at IS NULL AND (pinned OR happened_at >= now() - interval '21 days') ORDER BY pinned DESC, happened_at DESC LIMIT 60`),
    C().query(`SELECT c.*, m.meeting_date FROM cab_changes c LEFT JOIN cab_meetings m ON m.id = c.meeting_id
                WHERE c.chg IN (SELECT chg FROM cab_presentations WHERE meeting_id = (SELECT id FROM cab_meetings ORDER BY meeting_date DESC LIMIT 1))
                   OR (c.planned_start >= now() - interval '8 days' AND c.planned_start < now() + interval '15 days')
                   OR (c.impl_status IN ('scheduled','in_progress') AND c.planned_start >= now() - interval '21 days' AND c.planned_start < now())
                ORDER BY c.planned_start NULLS LAST, c.chg LIMIT 400`),
    C().query(`SELECT c.*, n.body AS last_body, n.created_by AS last_by, n.created_at AS last_at, n.kind AS last_kind, n.tag AS last_tag,
                      (SELECT count(*) FROM cockpit_notes x WHERE x.challenge_id = c.id) AS notes_n
                 FROM cockpit_challenges c
                 LEFT JOIN LATERAL (SELECT body, created_by, created_at, kind, tag FROM cockpit_notes WHERE challenge_id = c.id ORDER BY created_at DESC LIMIT 1) n ON true
                WHERE c.deleted_at IS NULL AND (c.status <> 'resolved' OR c.resolved_at >= now() - interval '14 days')
                ORDER BY CASE c.status WHEN 'resolved' THEN 1 ELSE 0 END, CASE c.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, c.updated_at DESC LIMIT 200`),
    C().query(`SELECT tower, day, note, created_by, created_at FROM cockpit_checkins WHERE day = $1`, [today]),
    C().query(`SELECT id, meeting_date, title, totals, notes, source, changes, imported_by, imported_at FROM cab_meetings ORDER BY meeting_date DESC LIMIT 12`),
    settings.getSetting('cockpit_digest_state').catch(() => null),
    C().query(`SELECT chg FROM cab_presentations WHERE meeting_id = (SELECT id FROM cab_meetings ORDER BY meeting_date DESC LIMIT 1)`),
    C().query(`SELECT * FROM cockpit_reports WHERE deleted_at IS NULL ORDER BY vendor, period_to DESC LIMIT 40`),
    /* "reported today" = a PERSON wrote for the tower since 00:00 KSA — a note (not the VP's comment), a challenge raised or
     * edited, an update posted or edited. The seeded first content (authors like "IT Operations", no e-mail) and the
     * machine are not a report: on 8 Oct the seed's 08:00 notes showed Digital and BSS as "reported". */
    C().query(`SELECT tower, max(at) AS at, (array_agg(who ORDER BY at DESC))[1] AS who FROM (
          SELECT c.tower, n.created_at AS at, n.created_by AS who FROM cockpit_notes n JOIN cockpit_challenges c ON c.id = n.challenge_id
           WHERE n.created_at >= $1 AND n.kind <> 'comment' AND n.created_by LIKE '%@%' AND c.deleted_at IS NULL
          UNION ALL SELECT tower, created_at, created_by FROM cockpit_challenges WHERE created_at >= $1 AND created_by LIKE '%@%' AND deleted_at IS NULL
          UNION ALL SELECT tower, updated_at, updated_by FROM cockpit_challenges WHERE updated_at >= $1 AND updated_by LIKE '%@%' AND deleted_at IS NULL
          UNION ALL SELECT tower, coalesce(updated_at, created_at), coalesce(updated_by, created_by) FROM cockpit_updates
           WHERE coalesce(updated_at, created_at) >= $1 AND coalesce(updated_by, created_by) LIKE '%@%' AND deleted_at IS NULL) x GROUP BY tower`, [ksaMidnight(today).toISOString()])
  ]);
  const changes = chg.rows.map(c => changeOut(c, now));
  const challenges = chs.rows.map(c => challengeOut(c, dir));
  const manual = upd.rows.map(u => updateOut(u, dir));
  /* the feed also tells what happened to the changes — a result recorded in the last 7 days, unless an update already
   * talks about that change (the UPG post covers CHG0030330, so its "completed" line is not repeated) */
  const told = new Set(manual.map(u => String(u.ref || '').toUpperCase()).filter(Boolean));
  const auto = changes.filter(c => IMPL_DONE.includes(c.implStatus) && !told.has(c.chg) && (c.actualEnd || c.actualStart || c.plannedEnd || c.plannedStart) &&
      new Date(c.actualEnd || c.actualStart || c.plannedEnd || c.plannedStart) >= new Date(now.getTime() - 7 * 864e5))
    .map(c => ({ id: 'chg:' + c.chg, auto: true, tower: c.tower, segment: c.segment, kind: 'change', tone: c.implStatus === 'completed' ? 'good' : c.implStatus === 'completed_issues' ? 'watch' : 'bad',
      title: `${c.implLabel}: ${c.title}`, body: c.result || null, impact: [], ref: c.chg, status: c.implLabel, pinned: false,
      at: c.actualEnd || c.actualStart || c.plannedEnd || c.plannedStart, createdBy: c.updatedBy && c.updatedBy !== 'seed' ? c.updatedBy : 'CAB', createdByName: c.updatedBy ? nameOf(dir, c.updatedBy) : null }));
  const updates = [...manual.filter(u => u.pinned), ...[...manual.filter(u => !u.pinned), ...auto].sort((a, b) => new Date(b.at) - new Date(a.at))];
  const latest = meetings.rows[0] || null;
  const presented = new Set(pres.rows.map(r => r.chg));
  const latestChanges = latest ? changes.filter(c => presented.has(c.chg)) : [];
  /* "today & tonight" = still to happen (or running) before tomorrow 08:00 KSA; "last night" = started since yesterday noon
   * and already over — that is where the results of the night are read */
  const tonightEnd = new Date(ksaMidnight(addDays(today, 1)).getTime() + 8 * 3600e3), lastNightFrom = new Date(ksaMidnight(today).getTime() - 12 * 3600e3);
  const live = c => !IMPL_OFF.includes(c.implStatus);
  const endOf = c => c.plannedEnd && new Date(c.plannedEnd) >= new Date(c.plannedStart) ? new Date(c.plannedEnd) : new Date(new Date(c.plannedStart).getTime() + 6 * 3600e3);
  const tonight = changes.filter(c => live(c) && c.plannedStart && !IMPL_DONE.includes(c.implStatus) && new Date(c.plannedStart) < tonightEnd && endOf(c) > now);
  const lastNight = changes.filter(c => live(c) && c.plannedStart && new Date(c.plannedStart) >= lastNightFrom && endOf(c) <= now);
  const awaiting = changes.filter(c => c.awaiting);
  const pirDue = changes.filter(c => c.pirStatus === 'due');
  const doneWeek = latestChanges.filter(c => IMPL_DONE.includes(c.implStatus));
  const okWeek = doneWeek.filter(c => c.implStatus === 'completed' || c.implStatus === 'completed_issues');
  const open = challenges.filter(c => c.status !== 'resolved');
  const towers = CFG.towers.map(t => {
    const base = TOWERS.find(x => x.key === t.key);
    const mine = open.filter(c => c.tower === t.key);
    const ci = chk.rows.find(x => x.tower === t.key) || null;
    const acts = [...challenges.filter(c => c.tower === t.key).flatMap(c => [c.updatedAt, c.lastNote && c.lastNote.at]), ...manual.filter(u => u.tower === t.key).map(u => u.at)]
      .filter(Boolean).map(x => new Date(x)).sort((a, b) => b - a);
    const last = acts[0] || null;
    const rp = rep.rows.find(x => x.tower === t.key) || null;
    return { key: t.key, label: t.label, color: base.color, scope: base.scope,
      leads: t.leads.map(e => ({ email: e, name: nameOf(dir, e) })),
      open: mine.length, critical: mine.filter(c => c.severity === 'critical').length, high: mine.filter(c => c.severity === 'high').length,
      blocked: mine.filter(c => c.status === 'blocked').length,
      checkin: ci ? { at: ci.created_at, by: ci.created_by, byName: nameOf(dir, ci.created_by), note: ci.note } : null,
      lastActivity: last, reportedToday: !!ci || !!rp,
      report: ci ? { at: ci.created_at, by: ci.created_by, byName: nameOf(dir, ci.created_by), checkin: true } : rp ? { at: rp.at, by: rp.who, byName: nameOf(dir, rp.who), checkin: false } : null,
      changesTonight: tonight.filter(c => c.tower === t.key).length };
  });
  return {
    at: now.toISOString(), today, me: meOut(w),
    vocab: { towers: TOWERS, segments: SEGMENTS, severities: SEVERITIES, statuses: CH_STATUSES.map(k => ({ key: k, label: CH_STATUS_LABEL[k] })),
      kinds: UPD_KINDS, tones: UPD_TONES, impactTags: IMPACT_TAGS, impl: IMPL.map(k => ({ key: k, label: IMPL_LABEL[k] })) },
    towers, updates, challenges,
    /* the latest weekly report of each vendor, with the one before it for the week-on-week arrows */
    reports: [...new Set(reps.rows.map(r => r.vendor))].map(v => { const list = reps.rows.filter(r => r.vendor === v); return { vendor: v, latest: reportOut(list[0], dir), previous: reportOut(list[1], dir), weeks: list.length }; }),
    cab: { meeting: latest ? { id: Number(latest.id), date: ksaDayOfDate(latest.meeting_date), title: latest.title, totals: latest.totals || {}, notes: latest.notes,
        source: latest.source, changes: latest.changes, importedBy: latest.imported_by, importedByName: nameOf(dir, latest.imported_by), importedAt: latest.imported_at } : null,
      meetings: meetings.rows.map(m => ({ id: Number(m.id), date: ksaDayOfDate(m.meeting_date), changes: m.changes })),
      changes, meetingChgs: [...presented], tonight: tonight.map(c => c.chg), lastNight: lastNight.map(c => c.chg), defaultMeetingDate: lastWednesday() },
    stats: { openChallenges: open.length, critical: open.filter(c => c.severity === 'critical').length, high: open.filter(c => c.severity === 'high').length,
      blocked: open.filter(c => c.status === 'blocked').length, towersReported: towers.filter(t => t.reportedToday).length, towers: towers.length,
      tonight: tonight.length, awaiting: awaiting.length, pirDue: pirDue.length, weekTotal: latestChanges.length,
      weekDone: doneWeek.length, weekOk: okWeek.length, weekGaps: latestChanges.filter(c => live(c) && c.gaps.length).length,
      weekLive: latestChanges.filter(live).length },
    digest: { enabled: CFG.digest.enabled, hour: CFG.digest.hour, minute: CFG.digest.minute, weekdays: CFG.digest.weekdays,
      lastDay: dg && dg.day || null, lastSentAt: dg && dg.sentAt || null, lastOk: dg ? dg.ok !== false : null, lastTo: dg && dg.to || null,
      lastError: dg && dg.ok === false ? (dg.error || 'not sent') : null, retry: !!(dg && dg.retry) },
    defs: await defsNow()
  };
}

/* ---------------------------------------------------------------- the morning brief */
const TOWER_HEX = Object.fromEntries(TOWERS.map(t => [t.key, t.color]));
async function digestRecipients() {
  await loadCfg();
  const r = await C().query(`SELECT lower(email) AS email, name FROM console_users WHERE enabled AND (role='ops_vp' OR 'ops_vp' = ANY(coalesce(roles,'{}'))) ORDER BY email`).catch(() => ({ rows: [] }));
  const list = r.rows.slice(); CFG.digest.extra.forEach(e => { if (!list.some(x => x.email === e)) list.push({ email: e, name: null }); });
  return list;
}
/* shorten at a sentence / clause / word boundary, never mid-word */
function cutText(t, n) {
  const s0 = String(t || ''); if (s0.length <= n) return s0;
  const head = s0.slice(0, n); const at = Math.max(head.lastIndexOf('. '), head.lastIndexOf('; '), head.lastIndexOf(' — '));
  return (at > n * 0.55 ? head.slice(0, at + 1) : head.slice(0, head.lastIndexOf(' ')).replace(/[,;:\s]+$/, '')) + ' …';
}
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]); }
async function buildDigest(deps, opts) {
  const notify = require('./notify');
  const esc = notify.esc;
  await ensure(); await loadCfg();
  const fakeReq = { sessionEmail: '', caps: {}, views: ['vp'], roleNames: [] };
  const o = await overview(fakeReq);
  const now = new Date(), today = o.today;
  /* KPIs: the same exec contracts the Executive Dashboard reads (7 d), best effort with a timeout each */
  let mobile = null, fixed = null;
  if (deps && deps.execDeps) {
    const mx = require('./mvnoExec'), fx = require('./fixedExec');
    [mobile, fixed] = await Promise.all([
      withTimeout(mx.exec({ range: '7d' }, deps.execDeps), 25000).catch(e => ({ configured: false, reason: e.message })),
      withTimeout(fx.exec({ range: '7d' }), 25000).catch(e => ({ configured: false, reason: e.message }))
    ]);
  }
  /* the business state the page shows — the Executive brief's own rule (execBrief.stateOf, alpha.152): OUTAGE = a P1 service
   * incident open, CASE = a P1 business case open, DEGRADED = a P2 open, BLIND = only monitoring open, OK otherwise;
   * the 24 h signal summary of the exec contract stays as the line under it */
  const SEGM = require('./segment'), EB = require('./execBrief');
  const openOf = async seg => { try { const r = await C().query(`SELECT a.severity, a.name, a.rule_key, a.customers, a.fired_at, a.dim, COALESCE(a.opened_wall, a.fired_at) AS opened, a.assignee, a.ack_by,
          r.alert_class AS rule_class FROM alerts a LEFT JOIN alert_rules r ON r.key = a.rule_key
        WHERE a.status='open' AND a.severity IN ('P1','P2') AND ${SEGM.sqlWhere('a', 'rule_key', seg)}${SEGM.appOnly('a')} ORDER BY a.severity, COALESCE(a.opened_wall, a.fired_at)`);
      const rows = r.rows.filter(x => EB.kindOf(x) !== 'business');              // technical only, like the page (alpha.155)
      const st = EB.stateOf(rows);
      return { state: st.state, note: st.note, p1: rows.filter(x => x.severity === 'P1').length, p2: rows.filter(x => x.severity === 'P2').length,
        what: st.top ? (st.top.name || st.top.rule_key) : null, customers: rows.reduce((t, x) => t + (Number(x.customers) || 0), 0), estimated: rows.some(x => x.customers != null) }; }
    catch (e) { return null; } };
  const [openM, openF] = await Promise.all([openOf('mvno'), openOf('fixed')]);
  let sales = null;
  try { const so = require('./salesOps'); if (so.channel) sales = await withTimeout(Promise.all(so.ORDER.map(k => so.channel(k, 60))), 20000); } catch (e) { sales = null; }
  const statusCell = (label, h, op) => {
    if (!op && (!h || h.configured === false)) return `<td style="padding:10px 12px;border:1px solid #e3e7e5;border-radius:10px;vertical-align:top"><div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.06em">${esc(label).toUpperCase()}</div><div style="font-size:14px;color:#64748b;margin-top:4px">not available</div></td>`;
    const open = op ? `${op.p1 ? op.p1 + ' P1' : ''}${op.p1 && op.p2 ? ' + ' : ''}${op.p2 ? op.p2 + ' P2' : ''} open` : '';
    const [col, txt] = !op ? ['#64748b', '—'] : op.state === 'OUTAGE' ? ['#dc2626', `Outage · ${open}`] : op.state === 'CASE' ? ['#dc2626', `P1 case open · service up`]
      : op.state === 'DEGRADED' ? ['#d97706', `Degraded · ${open}`] : op.state === 'BLIND' ? ['#d97706', 'Monitoring gap · state not known'] : ['#0e9f5a', 'OK'];
    const line = op && (op.p1 || op.p2) ? `${esc(op.what || '')} · ${op.estimated ? `${op.customers.toLocaleString('en-US')} customers affected` : 'customer impact not estimated'}` : `No technical P1 / P2 open${((h || {}).summary || [])[0] ? ' · ' + esc(h.summary[0]) : ''}`;
    return `<td style="padding:10px 12px;border:1px solid #e3e7e5;vertical-align:top"><div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.06em">${esc(label).toUpperCase()}</div>
      <div style="font-size:17px;font-weight:800;color:${col};margin-top:3px">● ${esc(txt)}</div><div style="font-size:12px;color:#475569;margin-top:2px">${line}</div></td>`;
  };
  const tile = (label, value, sub, col) => `<td style="padding:10px 12px;border:1px solid #e3e7e5;vertical-align:top"><div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.06em">${esc(label).toUpperCase()}</div>
      <div style="font-size:22px;font-weight:800;color:${col || '#14352a'};margin-top:2px">${esc(value)}</div><div style="font-size:12px;color:#475569">${sub || ''}</div></td>`;
  /* dealer & QR channels, yesterday (DEFS.sales): Mobile = SIM activations (DMS app, dealer portal), Fixed = orders completed (QR code, SDA app) */
  const CHN = { dms: 'DMS app', selfact: 'dealer portal', qr: 'QR code', sda: 'SDA app' };
  const yOf = c => c && c.activations ? Number(c.activations.yesterday) || 0 : 0;
  const part = keys => { const xs = (sales || []).filter(c => c && keys.includes(c.key)); return { n: xs.reduce((t, c) => t + yOf(c), 0), txt: xs.map(c => `${CHN[c.key] || c.short || c.key} ${yOf(c).toLocaleString('en-US')}`).join(' · ') }; };
  const salesMob = part(['dms', 'selfact']), salesFix = part(['qr', 'sda']);
  const salesTot = sales ? salesMob.n + salesFix.n : null;
  const salesSub = sales ? `Mobile activations ${salesMob.n.toLocaleString('en-US')} (${esc(salesMob.txt)}) · Fixed orders completed ${salesFix.n.toLocaleString('en-US')} (${esc(salesFix.txt)})` : 'not available';
  const s = o.stats;
  const glance = `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate"><tr>${statusCell('Mobile', mobile, openM)}${statusCell('Fixed', fixed, openF)}</tr>
    <tr>${tile('Dealer & QR sales yesterday', salesTot == null ? '—' : salesTot.toLocaleString('en-US'), salesSub)}${tile('Changes tonight', String(s.tonight), `until 08:00 · ${s.awaiting} ended with no result recorded · ${s.pirDue} PIR to record`, s.awaiting ? '#b45309' : null)}</tr>
    <tr>${tile('Open challenges', String(s.openChallenges), `${s.critical} critical · ${s.high} high · ${s.blocked} blocked`, s.critical ? '#dc2626' : null)}${tile('Towers reported today', `${s.towersReported} / ${s.towers}`, o.towers.filter(t => t.reportedToday).map(t => esc(t.label + (t.report && t.report.byName ? ' (' + t.report.byName + ')' : ''))).join(' · ') || 'none yet today')}</tr></table>`;
  const VPK = { Mobile: ['orders', 'activations', 'payments', 'errors'], Fixed: ['attempts', 'errors'] };
  const kpiList = (h, biz) => (h && h.configured !== false ? VPK[biz].map(key => (h.kpis || []).find(k => k.key === key)).filter(k => k && k.value != null && k.value !== '—')
    .map(k => { const d = DEFS.kpi[`${biz.toLowerCase()}.${k.key}`] || {}; return { ...k, ...(k.tech || {}), title: d.label || k.title, window: d.window || k.window }; }) : []);
  const kpiCol = (label, h) => { const ks = kpiList(h, label); if (!ks.length) return ''; return `<td style="vertical-align:top;padding:0 6px;width:50%"><div style="font-size:11px;font-weight:800;color:#0b3d2b;letter-spacing:.06em;margin:4px 0 6px">${esc(label).toUpperCase()}</div>${ks.map(k => `<div style="border-left:3px solid #0e9f5a;padding:4px 10px;margin-bottom:6px"><div style="font-size:12px;color:#64748b">${esc(k.title)}${k.window ? ' · ' + esc(k.window) : ''}</div><div style="font-size:16px;font-weight:800;color:#14352a">${esc(typeof k.value === 'number' ? k.value.toLocaleString('en-US') : k.value)}</div>${k.sub ? `<div style="font-size:11.5px;color:#64748b">${esc(k.sub)}</div>` : ''}</div>`).join('')}</td>`; };
  const kpis = kpiCol('Mobile', mobile) + kpiCol('Fixed', fixed);
  const h2 = t => `<div style="font-size:12px;font-weight:800;color:#0b3d2b;letter-spacing:.08em;margin:22px 0 8px;border-bottom:2px solid #e8f7f0;padding-bottom:5px">${esc(t).toUpperCase()}</div>`;
  const chip = tw => { const t = TOWERS.find(x => x.key === tw); return t ? `<span style="display:inline-block;font-size:10px;font-weight:800;letter-spacing:.04em;padding:1px 7px;border-radius:999px;color:#fff;background:${TOWER_HEX[tw]}">${esc(t.label.toUpperCase())}</span>` : ''; };
  const since = new Date(now.getTime() - 24 * 3600e3);
  const recent = o.updates.filter(u => u.pinned || new Date(u.at) >= since).slice(0, 8);
  const TONE = { good: '#0e9f5a', watch: '#d97706', bad: '#dc2626', info: '#2563eb' };
  const updHtml = recent.length ? recent.map(u => `<div style="padding:8px 0;border-bottom:1px solid #eef2f6"><div>${chip(u.tower)} <b style="color:${TONE[u.tone] || '#14352a'}">●</b> <b>${esc(u.title)}</b>${u.ref ? ` <span style="color:#64748b;font-size:12px">${esc(u.ref)}</span>` : ''}</div>${u.body ? `<div style="font-size:12.5px;color:#334155;margin-top:3px">${esc(cutText(u.body, 600))}</div>` : ''}<div style="font-size:11px;color:#94a3b8;margin-top:2px">${esc(ksaDay(u.at))} ${esc(ksaHM(u.at))} KSA${u.status ? ' · ' + esc(u.status) : ''}</div></div>`).join('')
    : '<div style="color:#64748b">Nothing new in the last 24 hours.</div>';
  const tonight = o.cab.changes.filter(c => o.cab.tonight.includes(c.chg)).slice(0, 14);
  const lastNight = o.cab.changes.filter(c => o.cab.lastNight.includes(c.chg));
  const chgRow = c => `<tr><td style="padding:5px 6px;font-family:Menlo,monospace;font-size:11.5px;white-space:nowrap;color:#0b3d2b">${esc(c.chg)}</td><td style="padding:5px 6px">${chip(c.tower)}</td><td style="padding:5px 6px;font-size:12.5px">${esc(c.title)}</td><td style="padding:5px 6px;font-size:12px;white-space:nowrap;color:#475569">${c.plannedStart ? esc(ksaHM(c.plannedStart)) : '—'}–${c.plannedEnd ? esc(ksaHM(c.plannedEnd)) : '—'}</td></tr>`;
  const tonightHtml = tonight.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tonight.map(chgRow).join('')}</table>` : '<div style="color:#64748b">No change planned today or tonight.</div>';
  const RES = c => c.awaiting ? ['#b45309', 'no result yet'] : c.implStatus === 'completed' ? ['#0e9f5a', 'completed'] : ['completed_issues'].includes(c.implStatus) ? ['#d97706', 'completed with issues'] : ['rolled_back', 'failed'].includes(c.implStatus) ? ['#dc2626', c.implLabel.toLowerCase()] : ['#64748b', c.implLabel.toLowerCase()];
  const lastNightHtml = lastNight.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lastNight.slice(0, 14).map(c => { const [col, txt] = RES(c);
      return `<tr><td style="padding:5px 6px;font-family:Menlo,monospace;font-size:11.5px;white-space:nowrap;color:#0b3d2b">${esc(c.chg)}</td><td style="padding:5px 6px">${chip(c.tower)}</td><td style="padding:5px 6px;font-size:12.5px">${esc(c.title)}</td><td style="padding:5px 6px;font-size:12px;font-weight:800;white-space:nowrap;color:${col}">${esc(txt)}</td></tr>`; }).join('')}</table>` : '';
  const aw = o.cab.changes.filter(c => c.awaiting && !o.cab.lastNight.includes(c.chg)).slice(0, 10);
  const awHtml = aw.length ? `<div style="margin-top:10px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12.5px;color:#92400e"><b>${aw.length} earlier change${aw.length > 1 ? 's' : ''} past the window with no result recorded:</b> ${aw.map(c => esc(c.chg)).join(', ')}</div>` : '';
  const open = o.challenges.filter(c => c.status !== 'resolved');
  const SEVC = { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#64748b' };
  /* most severe first, whatever the tower — the tower is the chip on each line */
  const SEVR = { critical: 0, high: 1, medium: 2, low: 3 };
  const chHtml = open.length ? open.slice().sort((a, b) => (SEVR[a.severity] - SEVR[b.severity]) || TOWER_KEYS.indexOf(a.tower) - TOWER_KEYS.indexOf(b.tower)).map(c =>
      `<div style="padding:7px 0 9px 11px;border-left:3px solid ${SEVC[c.severity] || '#64748b'};margin:6px 0"><div>${chip(c.tower)} <span style="font-size:10.5px;font-weight:800;color:${SEVC[c.severity]}">${esc(c.severity.toUpperCase())}</span> · <span style="font-size:12px;color:#475569">${esc(c.statusLabel)}${c.ageDays != null ? ` · day ${c.ageDays + 1}` : ''}</span></div>
        <div style="font-weight:700;margin-top:3px">${esc(c.title)}</div>${c.fixOwner ? `<div style="font-size:12px;color:#475569">Fix: ${esc(c.fixOwner)}</div>` : ''}
        ${c.nextStep ? `<div style="font-size:12.5px;color:#334155;margin-top:3px">Next: ${esc(cutText(c.nextStep, 320))}</div>` : ''}</div>`).join('')
    : '<div style="color:#64748b">No open challenge.</div>';
  /* the vendor's week in four lines (TCS for Mobile) — off the brief and the page since 9 Oct 2026: the TCS figures reach
   * the VP through the executive weekly report (Operations reports). BRIEF_VENDOR_WEEKLY brings the block back. */
  const BRIEF_VENDOR_WEEKLY = false;
  const tcs = BRIEF_VENDOR_WEEKLY ? (o.reports || []).find(r => r.vendor === 'TCS' && r.latest) : null;
  let tcsHtml = '';
  if (tcs) { const d = tcs.latest.data || {}, av = (d.availability || {}).apps || [], pay = d.payments || {}, dg = d.digital || {}, dm = d.dms || {}, tk = d.tickets || {}, dep = d.deployments || {};
    const fmtD = k => { const x = new Date(Date.parse(k + 'T12:00:00Z')); return `${x.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()]}`; };
    const minAv = av.length ? Math.min(...av.map(a => a.pct == null ? 100 : a.pct)) : null;
    const row = (k, v) => `<tr><td style="padding:4px 8px 4px 0;font-size:12px;color:#64748b;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;font-size:13px">${v}</td></tr>`;
    tcsHtml = h2(`Mobile weekly · TCS · ${fmtD(tcs.latest.from)} – ${fmtD(tcs.latest.to)}`) + `<table role="presentation" cellpadding="0" cellspacing="0">
      ${minAv != null ? row('Availability', `<b>${minAv}%</b> — ${av.map(a => esc(a.name)).join(', ')}${d.incidents && d.incidents.major ? ` · <b style="color:#dc2626">${d.incidents.major} major incident(s)</b>` : ' · no major incident'}`) : ''}
      ${pay.success != null ? row('Payments (UPG)', `<b>${pay.success}%</b> success${pay.delta != null ? ` (${pay.delta >= 0 ? '+' : ''}${pay.delta} pt)` : ''} · functional ${pay.functional}% · technical ${pay.technical}%`) : ''}
      ${dg.newSim != null ? row('Activations / day', `Digital <b>${dg.newSim}</b> new SIM · <b>${dg.portIn}</b> port-in${dm.newSim != null ? ` &nbsp;|&nbsp; DMS <b>${dm.newSim}</b> new SIM · <b>${dm.portIn}</b> port-in` : ''}`) : ''}
      ${tk.created != null ? row('Tickets', `${tk.created} created · ${tk.resolved} resolved · <b>${tk.open}</b> open · ${tk.avgHours} h average`) : ''}
      ${dep.total != null ? row('Deployments', `${dep.total} · ${dep.failed ? `<b style="color:#dc2626">${dep.failed} failed</b>` : 'none failed'}`) : ''}
      ${(d.risks || []).length ? row('Open risks', (d.risks || []).map(r => esc(r.text)).join('<br>')) : ''}</table>`; }
  const url = require('./notify').CONSOLE_URL.replace(/#.*$/, '').replace(/\/?$/, '/') + '#vp';
  const dd = new Date(Date.parse(today + 'T12:00:00Z'));                              // spelled out by hand: 152 runs Node with small-icu
  const dayLabel = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dd.getUTCDay()]} ${dd.getUTCDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][dd.getUTCMonth()]}`;
  const greet = opts && opts.name ? `Good morning ${esc(String(opts.name).split(/\s+/)[0])},` : 'Good morning,';
  const body = `<div style="font-size:15px">${greet}</div><div style="color:#475569;margin:4px 0 14px">Here is operations at ${esc(ksaHM(now))} KSA on ${esc(dayLabel)}.</div>
    ${glance}${kpis ? h2('Key indicators · last 24 h') + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${kpis}</tr></table>` : ''}${tcsHtml}
    ${h2('Last updates')}${updHtml}${lastNightHtml ? h2('Last night’s changes') + lastNightHtml : ''}${h2('Changes today & tonight')}${tonightHtml}${awHtml}${h2('Open challenges')}${chHtml}
    <div style="text-align:center;margin:26px 0 6px"><a href="${esc(url)}" style="display:inline-block;background:#0e9f5a;color:#ffffff;font-weight:800;text-decoration:none;padding:12px 26px;border-radius:10px">Open the cockpit</a></div>
    <div style="font-size:11px;color:#94a3b8;text-align:center">Sent every day at ${String(CFG.digest.hour).padStart(2, '0')}:${String(CFG.digest.minute).padStart(2, '0')} KSA to the VP Operations · Settings › VP cockpit</div>`;
  const ops = [openM, openF].filter(Boolean);
  const has = s => ops.some(x => x.state === s);
  const pill = has('OUTAGE') ? ['OUTAGE', '#dc2626'] : has('CASE') ? ['P1 CASE OPEN', '#dc2626'] : has('DEGRADED') ? ['DEGRADED', '#d97706'] : has('BLIND') ? ['MONITORING GAP', '#d97706'] : ops.length ? ['ALL OK', '#0e9f5a'] : null;
  const html = notify.shell({ title: 'Operations brief — ' + dayLabel, badge: 'VP OPERATIONS', pill: pill && pill[0], pillColor: pill && pill[1], bodyHtml: body });
  const subject = `[Salam Ops] VP brief — ${dayLabel} · ${s.openChallenges} open challenge${s.openChallenges === 1 ? '' : 's'} · ${s.tonight} change${s.tonight === 1 ? '' : 's'} tonight`;
  const text = `Operations brief — ${dayLabel}\nOpen challenges: ${s.openChallenges} (${s.critical} critical) · changes tonight: ${s.tonight} · awaiting result: ${s.awaiting}\n${url}`;
  return { subject, html, text, stats: s };
}
async function sendDigest(deps, { to, by } = {}) {
  const notify = require('./notify');
  const list = to ? emailList(to).map(e => ({ email: e })) : await digestRecipients();
  if (!list.length) return { sent: false, error: 'no recipient — nobody holds the VP Operations role and no extra address is set', to: '' };
  const first = list.length === 1 && list[0].name ? list[0].name : null;
  const m = await buildDigest(deps, { name: first });
  const r = await notify.sendHtml(list, m.subject, m.html, [], m.text);
  return { sent: !!r.sent, dev: !!r.dev, error: r.error || null, to: list.map(x => x.email).join(', '), subject: m.subject, by: by || 'schedule' };
}
let digestTimer = null, digestBusy = false;
async function digestTick(deps) {
  if (digestBusy) return; digestBusy = true;
  try {
    if (process.env.COCKPIT_DIGEST === '0') return;
    const notify = require('./notify'); if (!notify.smtpConfigured()) return;
    await ensure(); await loadCfg(); const d = CFG.digest; if (!d.enabled) return;
    const k = new Date(Date.now() + KSA), day = k.toISOString().slice(0, 10), mins = k.getUTCHours() * 60 + k.getUTCMinutes();
    if (mins < d.hour * 60 + d.minute || mins > 12 * 60 + 30) return;                 // a late start still sends the brief, until 12:30
    if (d.weekdays && [5, 6].includes(k.getUTCDay())) return;                         // Friday + Saturday
    /* claim the day (one send across processes). A send that FAILED (SMTP down, a timeout) is claimed again 15 min later,
     * 3 attempts at most, until 12:30. "No recipient" is not retried: the day someone first gets the role, the brief
     * starts the next morning instead of landing at a random hour. */
    const claim = await C().query(`INSERT INTO console_settings (key, value) VALUES ('cockpit_digest_state', $1::jsonb)
        ON CONFLICT (key) DO UPDATE SET updated_at = now(), value = CASE WHEN COALESCE(console_settings.value->>'day', '') <> $2 THEN EXCLUDED.value
          ELSE EXCLUDED.value || jsonb_build_object('attempts', COALESCE((console_settings.value->>'attempts')::int, 1) + 1) END
        WHERE COALESCE(console_settings.value->>'day', '') <> $2
           OR (console_settings.value->>'retry' = 'true' AND COALESCE((console_settings.value->>'attempts')::int, 1) < 3
               AND console_settings.updated_at < now() - interval '15 minutes')
        RETURNING value->>'attempts' AS attempts`,
      [JSON.stringify({ day, attempts: 1, claimedAt: new Date().toISOString(), by: `${os.hostname()}:${process.pid}` }), day]);
    if (!claim.rowCount) return;                                                       // another process (or an earlier tick) owns today
    const attempts = Number(claim.rows[0].attempts) || 1;
    const out = await sendDigest(deps).catch(e => ({ sent: false, error: e.message }));
    const retry = !out.sent && !/^no recipient/.test(out.error || '') && attempts < 3;
    await settings.setSetting('cockpit_digest_state', { day, attempts, retry, sentAt: new Date().toISOString(), ok: !!out.sent, to: out.to || '', error: out.error || null, by: `${os.hostname()}:${process.pid}` });
    console.log(`[cockpit] morning brief ${out.sent ? 'sent' : 'NOT sent'}${attempts > 1 ? ` (attempt ${attempts})` : ''}${retry ? ' — retry in 15 min' : ''} → ${out.to || '—'}${out.error ? ' · ' + out.error : ''}`);
  } catch (e) { console.error('[cockpit] digest tick:', e.message); }
  finally { digestBusy = false; }
}

/* ---------------------------------------------------------------- routes */
function mount(app, { requireView, audit, execDeps }) {
  const deps = { execDeps };
  app.use('/api/cockpit', requireView('vp'));
  app.use('/api/cockpit', (req, res, next) => { Promise.all([ensure(), loadCfg()]).then(() => next(), e => res.status(500).json({ error: 'cockpit tables: ' + e.message })); });
  const ok = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  const deny = (res, msg) => res.status(403).json({ error: msg });
  const bad = (res, msg) => res.status(400).json({ error: msg });

  app.get('/api/cockpit/me', ok(async (req, res) => res.json(meOut(who(req)))));
  app.get('/api/cockpit/overview', ok(async (req, res) => res.json(await overview(req))));

  /* ---- last updates ---- */
  const updFields = (b, cur) => {
    const o = {};
    if ('tower' in b || !cur) { o.tower = TOWER_KEYS.includes(b.tower) ? b.tower : null; if (!o.tower) throw Object.assign(new Error('tower required'), { status: 400 }); }
    if ('segment' in b || !cur) o.segment = SEGMENTS.includes(b.segment) ? b.segment : 'both';
    if ('kind' in b || !cur) o.kind = UPD_KINDS.includes(b.kind) ? b.kind : 'update';
    if ('tone' in b || !cur) o.tone = UPD_TONES.includes(b.tone) ? b.tone : 'info';
    if ('title' in b || !cur) { o.title = str(b.title, 160); if (!o.title) throw Object.assign(new Error('title required'), { status: 400 }); }
    if ('body' in b) o.body = str(b.body, 2000);
    if ('ref' in b) o.ref = str(b.ref, 40) && str(b.ref, 40).toUpperCase();
    if ('status' in b) o.status = str(b.status, 60);
    if ('impact' in b) o.impact = (Array.isArray(b.impact) ? b.impact : []).map(x => str(x, 30)).filter(Boolean).slice(0, 8);
    if ('pinned' in b) o.pinned = !!b.pinned;
    if ('at' in b) { const v = isoOrNull(b.at); if (v === undefined) throw Object.assign(new Error('bad date'), { status: 400 }); if (v) o.happened_at = v; }
    return o;
  };
  app.post('/api/cockpit/updates', ok(async (req, res) => {
    const w = who(req), b = req.body || {}; const f = updFields(b, null);
    if (!canTower(w, f.tower)) return deny(res, `only the ${f.tower.toUpperCase()} lead, the cockpit editors or an admin can post for this tower`);
    if (f.pinned && !w.editor) f.pinned = false;
    const cols = Object.keys(f); const vals = cols.map(k => f[k]);
    const r = await C().query(`INSERT INTO cockpit_updates (${cols.join(',')}, created_by) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}, $${cols.length + 1}) RETURNING *`, [...vals, w.email]);
    audit(req, 'cockpit.update.create', String(r.rows[0].id), { tower: f.tower, title: f.title, pinned: !!f.pinned });
    res.json({ ok: true, update: updateOut(r.rows[0], await people()) });
  }));
  app.patch('/api/cockpit/updates/:id', ok(async (req, res) => {
    const w = who(req), b = req.body || {};
    const cur = (await C().query(`SELECT * FROM cockpit_updates WHERE id=$1 AND deleted_at IS NULL`, [Number(req.params.id)])).rows[0];
    if (!cur) return res.status(404).json({ error: 'update not found' });
    if (!canTower(w, cur.tower)) return deny(res, 'you cannot edit this tower\'s updates');
    if (b.delete === true) {
      await C().query(`UPDATE cockpit_updates SET deleted_at=now(), deleted_by=$2 WHERE id=$1`, [cur.id, w.email]);
      audit(req, 'cockpit.update.delete', String(cur.id), { title: cur.title }); return res.json({ ok: true });
    }
    const f = updFields(b, cur);
    if (f.tower && !canTower(w, f.tower)) return deny(res, 'you cannot move it to that tower');
    if ('pinned' in f && !w.editor) delete f.pinned;
    const cols = Object.keys(f); if (!cols.length) return bad(res, 'nothing to change');
    const r = await C().query(`UPDATE cockpit_updates SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_by=$${cols.length + 2}, updated_at=now() WHERE id=$1 RETURNING *`, [cur.id, ...cols.map(k => f[k]), w.email]);
    audit(req, 'cockpit.update.edit', String(cur.id), { fields: cols });
    res.json({ ok: true, update: updateOut(r.rows[0], await people()) });
  }));

  /* ---- CAB ---- */
  app.get('/api/cockpit/cab/meetings', ok(async (req, res) => {
    const r = await C().query(`SELECT id, meeting_date, title, totals, changes, imported_by, imported_at FROM cab_meetings ORDER BY meeting_date DESC LIMIT 60`);
    res.json({ meetings: r.rows.map(m => ({ id: Number(m.id), date: ksaDayOfDate(m.meeting_date), title: m.title, totals: m.totals, changes: m.changes, importedBy: m.imported_by, importedAt: m.imported_at })) });
  }));
  app.get('/api/cockpit/cab', ok(async (req, res) => {
    const date = isDay(req.query.date) ? req.query.date : null;
    const m = (await C().query(date ? `SELECT * FROM cab_meetings WHERE meeting_date=$1` : `SELECT * FROM cab_meetings ORDER BY meeting_date DESC LIMIT 1`, date ? [date] : [])).rows[0];
    if (!m) return res.json({ meeting: null, changes: [] });
    const r = await C().query(`SELECT c.*, mm.meeting_date, p.decision AS p_decision, p.itsm_state AS p_state FROM cab_presentations p JOIN cab_changes c ON c.chg = p.chg
        LEFT JOIN cab_meetings mm ON mm.id = c.meeting_id WHERE p.meeting_id=$1 ORDER BY c.planned_start NULLS LAST, c.chg`, [m.id]);
    r.rows.forEach(x => { if (x.p_decision) x.decision = x.p_decision; if (x.p_state) x.itsm_state = x.p_state; });
    const dir = await people(); const now = new Date();
    res.json({ meeting: { id: Number(m.id), date: ksaDayOfDate(m.meeting_date), title: m.title, totals: m.totals || {}, notes: m.notes, source: m.source, changes: m.changes, importedBy: m.imported_by, importedByName: nameOf(dir, m.imported_by), importedAt: m.imported_at },
      changes: r.rows.map(c => changeOut(c, now)) });
  }));
  app.get('/api/cockpit/cab/changes/:chg', ok(async (req, res) => {
    const chg = String(req.params.chg || '').toUpperCase();
    const r = await C().query(`SELECT c.*, m.meeting_date FROM cab_changes c LEFT JOIN cab_meetings m ON m.id=c.meeting_id WHERE c.chg=$1`, [chg]);
    if (!r.rowCount) return res.status(404).json({ error: 'change not found' });
    const log = await C().query(`SELECT field, before, after, note, created_by, created_at FROM cab_change_log WHERE chg=$1 ORDER BY created_at DESC LIMIT 50`, [chg]);
    const dir = await people(); const w = who(req); const c = changeOut(r.rows[0], new Date());
    res.json({ change: c, canEdit: !w.readOnly && !!canChange(w, r.rows[0]), log: log.rows.map(l => ({ ...l, byName: nameOf(dir, l.created_by) })) });
  }));
  app.post('/api/cockpit/cab/parse', ok(async (req, res) => {
    const w = who(req); if (!w.changeMgr) return deny(res, 'only change managers, the cockpit editors or an admin can import the CAB');
    const b = req.body || {}; if (!b.html && !b.text) return bad(res, 'paste the CAB table first');
    const p = parseCab({ html: clip(b.html, 3e6), text: clip(b.text, 1e6) });
    if (p.changes.length) {
      const ex = await C().query(`SELECT chg, impl_status, updated_by FROM cab_changes WHERE chg = ANY($1)`, [p.changes.map(c => c.chg)]);
      const known = new Map(ex.rows.map(r => [r.chg, r]));
      p.changes.forEach(c => { const k = known.get(c.chg); c.existing = k ? { implStatus: k.impl_status, kept: !!k.updated_by } : null; });
    }
    res.json({ ...p, defaultMeetingDate: p.meetingDate || lastWednesday() });
  }));
  app.post('/api/cockpit/cab/import', ok(async (req, res) => {
    const w = who(req); if (!w.changeMgr) return deny(res, 'only change managers, the cockpit editors or an admin can import the CAB');
    const b = req.body || {}; const p = parseCab({ html: clip(b.html, 3e6), text: clip(b.text, 1e6) });
    if (!p.changes.length) return bad(res, 'no change found in what was pasted — copy the whole table, header row included');
    const date = isDay(b.meetingDate) ? b.meetingDate : (p.meetingDate || lastWednesday());
    const totals = Object.keys(p.totals).length ? p.totals : {};
    if (b.totals && typeof b.totals === 'object') for (const [k, v] of Object.entries(b.totals)) if (Number.isFinite(+v)) totals[k] = +v;
    const out = await saveCab({ date, title: str(b.title, 200) || `CAB - ${date}`, totals, notes: str(b.notes, 1500), source: 'paste: ' + p.source, changes: p.changes, by: w.email });
    audit(req, 'cockpit.cab.import', date, { changes: p.changes.length, inserted: out.inserted, updated: out.updated, source: p.source });
    res.json({ ok: true, date, ...out, changes: p.changes.length });
  }));
  app.patch('/api/cockpit/cab/changes/:chg', ok(async (req, res) => {
    const w = who(req), b = req.body || {}, chg = String(req.params.chg || '').toUpperCase();
    const cur = (await C().query(`SELECT * FROM cab_changes WHERE chg=$1`, [chg])).rows[0];
    if (!cur) return res.status(404).json({ error: 'change not found' });
    if (!canChange(w, cur)) return deny(res, 'only the lead of this change\'s tower, change managers, the cockpit editors or an admin can update it');
    const set = {}, log = [];
    const put = (col, v, label) => { const before = cur[col] == null ? null : (cur[col] instanceof Date ? cur[col].toISOString() : typeof cur[col] === 'object' ? JSON.stringify(cur[col]) : String(cur[col]));
      const after = v == null ? null : (typeof v === 'object' ? JSON.stringify(v) : String(v)); if (before === after) return; set[col] = v; log.push([label || col, before, after]); };
    if ('implStatus' in b) { if (!IMPL.includes(b.implStatus)) return bad(res, 'unknown implementation status'); put('impl_status', b.implStatus, 'impl_status'); }
    for (const [k, col] of [['actualStart', 'actual_start'], ['actualEnd', 'actual_end']]) if (k in b) { const v = isoOrNull(b[k]); if (v === undefined) return bad(res, 'bad ' + k); put(col, v); }
    if ('result' in b) put('result', str(b.result, 1000));
    if ('implementer' in b) put('implementer', str(b.implementer, 120));
    if ('tower' in b) { if (b.tower !== null && !TOWER_KEYS.includes(b.tower)) return bad(res, 'unknown tower'); if (!w.changeMgr) return deny(res, 'only change managers can move a change to another tower'); put('tower', b.tower); set.tower_auto = false; }
    if ('segment' in b) { if (!SEGMENTS.includes(b.segment)) return bad(res, 'unknown business'); put('segment', b.segment); set.segment_auto = false; }
    if ('pir' in b) {
      if (b.pir === null) put('pir', null);
      else { const p = b.pir || {}; const pir = { rfcStatus: str(p.rfcStatus, 40), impact: str(p.impact, 200), backout: /^y/i.test(p.backout || '') ? 'Yes' : 'No', changeManager: str(p.changeManager, 80),
          changeOwner: str(p.changeOwner, 80), technician: str(p.technician, 80), deploymentIssues: str(p.deploymentIssues, 500), summary: str(p.summary, 1000), lessons: str(p.lessons, 1000),
          submittedBy: w.email, submittedAt: new Date().toISOString() };
        if (!pir.rfcStatus) return bad(res, 'PIR: RFC status required'); put('pir', pir, 'pir'); }
    }
    const cols = Object.keys(set); if (!cols.length) return res.json({ ok: true, unchanged: true });
    const next = { ...cur, ...set };
    set.pir_status = next.pir ? 'submitted' : IMPL_DONE.includes(next.impl_status) ? 'due' : 'none';
    const keys = Object.keys(set);
    await C().query(`UPDATE cab_changes SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_by=$${keys.length + 2}, updated_at=now() WHERE chg=$1`,
      [chg, ...keys.map(k => (k === 'pir' && set[k]) ? JSON.stringify(set[k]) : set[k]), w.email]);
    for (const [field, before, after] of log) await C().query(`INSERT INTO cab_change_log (chg, field, before, after, note, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [chg, field, field === 'pir' ? (before ? 'recorded' : null) : clip(before, 300), field === 'pir' ? (after ? 'submitted' : 'removed') : clip(after, 300), str(b.note, 300), w.email]);
    let eventId = null; try { eventId = await marker(chg, w.email); } catch (e) { console.error('[cockpit] marker', e.message); }
    audit(req, 'cockpit.change.update', chg, { fields: log.map(l => l[0]), impl: next.impl_status, eventId });
    const r = await C().query(`SELECT c.*, m.meeting_date FROM cab_changes c LEFT JOIN cab_meetings m ON m.id=c.meeting_id WHERE c.chg=$1`, [chg]);
    res.json({ ok: true, change: changeOut(r.rows[0], new Date()) });
  }));

  /* ---- challenges ---- */
  const chFields = (b, cur) => {
    const o = {};
    const need = (k, v, msg) => { if (!v) throw Object.assign(new Error(msg), { status: 400 }); o[k] = v; };
    if ('tower' in b || !cur) need('tower', TOWER_KEYS.includes(b.tower) ? b.tower : null, 'tower required');
    if ('segment' in b || !cur) o.segment = SEGMENTS.includes(b.segment) ? b.segment : 'both';
    if ('title' in b || !cur) need('title', str(b.title, 160), 'challenge title required');
    if ('severity' in b || !cur) o.severity = SEVERITIES.includes(b.severity) ? b.severity : 'medium';
    if ('status' in b || !cur) o.status = CH_STATUSES.includes(b.status) ? b.status : 'open';
    for (const [k, col, n] of [['impact', 'impact', 1200], ['detail', 'detail', 3000], ['fixOwner', 'fix_owner', 120], ['followedBy', 'followed_by', 120], ['nextStep', 'next_step', 1500], ['refs', 'refs', 300]])
      if (k in b) o[col] = str(b[k], n);
    for (const [k, col] of [['since', 'since'], ['eta', 'eta']]) if (k in b) { if (b[k] && !isDay(b[k])) throw Object.assign(new Error('bad ' + k + ' date'), { status: 400 }); o[col] = b[k] || null; }
    return o;
  };
  app.get('/api/cockpit/challenges/:id', ok(async (req, res) => {
    const id = Number(req.params.id); const dir = await people();
    const c = (await C().query(`SELECT * FROM cockpit_challenges WHERE id=$1 AND deleted_at IS NULL`, [id])).rows[0];
    if (!c) return res.status(404).json({ error: 'challenge not found' });
    const n = await C().query(`SELECT id, kind, body, status_from, status_to, tag, created_by, created_at FROM cockpit_notes WHERE challenge_id=$1 ORDER BY created_at DESC LIMIT 200`, [id]);
    const w = who(req);
    res.json({ challenge: challengeOut(c, dir), canEdit: !w.readOnly && canTower(w, c.tower), canNote: !w.readOnly,
      notes: n.rows.map(x => ({ id: Number(x.id), kind: x.kind, body: x.body, from: x.status_from, to: x.status_to, tag: x.tag || null, by: x.created_by, byName: nameOf(dir, x.created_by), at: x.created_at })) });
  }));
  app.post('/api/cockpit/challenges', ok(async (req, res) => {
    const w = who(req); const f = chFields(req.body || {}, null);
    if (!canTower(w, f.tower)) return deny(res, `only the ${f.tower.toUpperCase()} lead, the cockpit editors or an admin can raise a challenge for this tower`);
    if (f.status === 'resolved') f.resolved_at = new Date().toISOString();
    if (!('followed_by' in f) || !f.followed_by) f.followed_by = 'Operations';
    const cols = Object.keys(f);
    const r = await C().query(`INSERT INTO cockpit_challenges (${cols.join(',')}, created_by, updated_by) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}, $${cols.length + 1}, $${cols.length + 1}) RETURNING *`, [...cols.map(k => f[k]), w.email]);
    await C().query(`INSERT INTO cockpit_notes (challenge_id, kind, body, status_to, created_by) VALUES ($1,'status',$2,$3,$4)`, [r.rows[0].id, 'Raised · ' + (CH_STATUS_LABEL[f.status] || f.status), f.status, w.email]);
    audit(req, 'cockpit.challenge.create', String(r.rows[0].id), { tower: f.tower, title: f.title, severity: f.severity, status: f.status });
    res.json({ ok: true, challenge: challengeOut(r.rows[0], await people()) });
  }));
  app.patch('/api/cockpit/challenges/:id', ok(async (req, res) => {
    const w = who(req), b = req.body || {};
    const cur = (await C().query(`SELECT * FROM cockpit_challenges WHERE id=$1 AND deleted_at IS NULL`, [Number(req.params.id)])).rows[0];
    if (!cur) return res.status(404).json({ error: 'challenge not found' });
    if (!canTower(w, cur.tower)) return deny(res, 'only this tower\'s lead, the cockpit editors or an admin can update it');
    if (b.delete === true) {
      await C().query(`UPDATE cockpit_challenges SET deleted_at=now(), deleted_by=$2 WHERE id=$1`, [cur.id, w.email]);
      audit(req, 'cockpit.challenge.delete', String(cur.id), { title: cur.title }); return res.json({ ok: true });
    }
    const f = chFields(b, cur);
    if (f.tower && !canTower(w, f.tower)) return deny(res, 'you cannot move it to that tower');
    const changed = Object.keys(f).filter(k => { const a = cur[k] instanceof Date ? ksaDayOfDate(cur[k]) : cur[k]; return String(a == null ? '' : a) !== String(f[k] == null ? '' : f[k]); });
    if (!changed.length && !str(b.note, 10)) return res.json({ ok: true, unchanged: true });
    const set = Object.fromEntries(changed.map(k => [k, f[k]]));
    if ('status' in set) set.resolved_at = set.status === 'resolved' ? new Date().toISOString() : null;
    const keys = Object.keys(set);
    if (keys.length) await C().query(`UPDATE cockpit_challenges SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_by=$${keys.length + 2}, updated_at=now() WHERE id=$1`, [cur.id, ...keys.map(k => set[k]), w.email]);
    else await C().query(`UPDATE cockpit_challenges SET updated_by=$2, updated_at=now() WHERE id=$1`, [cur.id, w.email]);
    const note = str(b.note, 2000);
    if ('status' in set) await C().query(`INSERT INTO cockpit_notes (challenge_id, kind, body, status_from, status_to, created_by) VALUES ($1,'status',$2,$3,$4,$5)`,
      [cur.id, note || `${CH_STATUS_LABEL[cur.status] || cur.status} → ${CH_STATUS_LABEL[set.status] || set.status}`, cur.status, set.status, w.email]);
    else if (note) await C().query(`INSERT INTO cockpit_notes (challenge_id, kind, body, created_by) VALUES ($1,'note',$2,$3)`, [cur.id, note, w.email]);
    audit(req, 'cockpit.challenge.edit', String(cur.id), { fields: keys, status: set.status || undefined });
    const r = await C().query(`SELECT * FROM cockpit_challenges WHERE id=$1`, [cur.id]);
    res.json({ ok: true, challenge: challengeOut(r.rows[0], await people()) });
  }));
  app.post('/api/cockpit/challenges/:id/notes', ok(async (req, res) => {
    const w = who(req); if (w.readOnly) return deny(res, 'read-only session');
    const body = str((req.body || {}).body, 2000); if (!body) return bad(res, 'write something first');
    const cur = (await C().query(`SELECT id, tower, title FROM cockpit_challenges WHERE id=$1 AND deleted_at IS NULL`, [Number(req.params.id)])).rows[0];
    if (!cur) return res.status(404).json({ error: 'challenge not found' });
    const kind = canTower(w, cur.tower) ? 'note' : 'comment';                           // the VP's questions read apart from the team's progress notes
    const tag = kind === 'note' ? str((req.body || {}).tag, 40) : null;                // a milestone label — the people who own the tower only
    const r = await C().query(`INSERT INTO cockpit_notes (challenge_id, kind, body, tag, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`, [cur.id, kind, body, tag, w.email]);
    if (kind === 'note') await C().query(`UPDATE cockpit_challenges SET updated_by=$2, updated_at=now() WHERE id=$1`, [cur.id, w.email]);
    audit(req, 'cockpit.challenge.note', String(cur.id), { kind, chars: body.length, tag: tag || undefined });
    res.json({ ok: true, id: Number(r.rows[0].id), kind });
  }));
  app.post('/api/cockpit/checkin', ok(async (req, res) => {
    const w = who(req), b = req.body || {}; const tower = TOWER_KEYS.includes(b.tower) ? b.tower : null;
    if (!tower) return bad(res, 'tower required');
    if (!canTower(w, tower)) return deny(res, 'only this tower\'s lead, the cockpit editors or an admin can check in for it');
    const day = ksaDay(); const note = str(b.note, 300) || 'Nothing new today';
    if (b.undo === true) { await C().query(`DELETE FROM cockpit_checkins WHERE tower=$1 AND day=$2`, [tower, day]); audit(req, 'cockpit.checkin.undo', tower, { day }); return res.json({ ok: true }); }
    await C().query(`INSERT INTO cockpit_checkins (tower, day, note, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (tower, day) DO UPDATE SET note=EXCLUDED.note, created_by=EXCLUDED.created_by, created_at=now()`, [tower, day, note, w.email]);
    audit(req, 'cockpit.checkin', tower, { day, note });
    res.json({ ok: true });
  }));

  /* ---- vendor weekly reports ---- */
  const canReport = w => !w.readOnly && (w.editor || w.leadOf.includes('digital'));
  app.get('/api/cockpit/reports', ok(async (req, res) => {
    const v = str(req.query.vendor, 40); const dir = await people();
    const r = await C().query(`SELECT * FROM cockpit_reports WHERE deleted_at IS NULL ${v ? 'AND vendor=$1' : ''} ORDER BY period_to DESC LIMIT 26`, v ? [v] : []);
    res.json({ reports: r.rows.map(x => reportOut(x, dir)) });
  }));
  app.post('/api/cockpit/reports', ok(async (req, res) => {
    const w = who(req); if (!canReport(w)) return deny(res, 'the cockpit editors, the Digital lead or an admin add the vendor reports');
    const b = req.body || {}; if (!isDay(b.from) || !isDay(b.to)) return bad(res, 'week from / to required (YYYY-MM-DD)');
    const vendor = str(b.vendor, 40) || 'TCS';
    const r = await C().query(`INSERT INTO cockpit_reports (vendor, segment, template, period_from, period_to, title, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [vendor, SEGMENTS.includes(b.segment) ? b.segment : 'mobile', 'tcs_mvno_weekly', b.from, b.to, str(b.title, 160) || 'Weekly report', JSON.stringify(normReport(b.data)), w.email]);
    audit(req, 'cockpit.report.create', String(r.rows[0].id), { vendor, from: b.from, to: b.to });
    res.json({ ok: true, report: reportOut(r.rows[0], await people()) });
  }));
  app.patch('/api/cockpit/reports/:id', ok(async (req, res) => {
    const w = who(req); if (!canReport(w)) return deny(res, 'the cockpit editors, the Digital lead or an admin edit the vendor reports');
    const b = req.body || {}; const id = Number(req.params.id);
    const cur = (await C().query(`SELECT * FROM cockpit_reports WHERE id=$1 AND deleted_at IS NULL`, [id])).rows[0]; if (!cur) return res.status(404).json({ error: 'report not found' });
    if (b.delete === true) { await C().query(`UPDATE cockpit_reports SET deleted_at=now(), deleted_by=$2 WHERE id=$1`, [id, w.email]); audit(req, 'cockpit.report.delete', String(id), { vendor: cur.vendor }); return res.json({ ok: true }); }
    if ((b.from && !isDay(b.from)) || (b.to && !isDay(b.to))) return bad(res, 'bad week dates');
    const r = await C().query(`UPDATE cockpit_reports SET period_from=COALESCE($2, period_from), period_to=COALESCE($3, period_to), title=COALESCE($4, title), data=COALESCE($5, data), updated_by=$6, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, b.from || null, b.to || null, str(b.title, 160), b.data ? JSON.stringify(normReport(b.data)) : null, w.email]);
    audit(req, 'cockpit.report.edit', String(id), { vendor: cur.vendor });
    res.json({ ok: true, report: reportOut(r.rows[0], await people()) });
  }));

  /* ---- settings ---- */
  app.get('/api/cockpit/settings', ok(async (req, res) => {
    const w = who(req); await loadCfg(true); const dir = await people();
    res.json({ settings: CFG, canEdit: !w.readOnly && w.admin, towers: TOWERS,
      names: Object.fromEntries([...MEMBERS, ...CFG.digest.extra].map(e => [e, nameOf(dir, e)])),
      recipients: (await digestRecipients()).map(r => r.email), state: await settings.getSetting('cockpit_digest_state').catch(() => null) });
  }));
  app.put('/api/cockpit/settings', ok(async (req, res) => {
    const w = who(req); if (!w.admin) return deny(res, 'admins only');
    const before = CFG; const next = normCfg(req.body || {});
    await settings.setSetting('cockpit', next); await loadCfg(true);
    try { require('./people').invalidate(); } catch (e) {}
    audit(req, 'cockpit.settings', null, { leads: Object.fromEntries(next.towers.map(t => [t.key, t.leads])), editors: next.editors, changeManagers: next.changeManagers,
      digest: next.digest, was: { editors: before.editors.length, changeManagers: before.changeManagers.length } });
    res.json({ ok: true, settings: CFG });
  }));
  app.get('/api/cockpit/people', ok(async (req, res) => {
    const w = who(req); if (!w.admin) return deny(res, 'admins only');
    const dir = await people();
    res.json({ people: Object.values(dir).filter(p => p.enabled !== false).map(p => ({ email: p.email, name: p.name, team: p.team, role: p.role_label })) });
  }));

  /* ---- morning brief ---- */
  app.get('/api/cockpit/digest/preview', ok(async (req, res) => {
    const w = who(req); if (!(w.editor || w.isVp)) return deny(res, 'editors, admins and the VP only');
    const m = await buildDigest(deps, { name: null });
    audit(req, 'cockpit.digest.preview', null, {});
    res.json({ subject: m.subject, html: m.html, stats: m.stats });
  }));
  app.post('/api/cockpit/digest/test', ok(async (req, res) => {
    const w = who(req); if (!w.editor) return deny(res, 'editors and admins only');
    const out = await sendDigest(deps, { to: [w.email], by: w.email });
    audit(req, 'cockpit.digest.test', w.email, { sent: out.sent, error: out.error || undefined });
    res.json(out);
  }));
  module.exports._deps = deps;
  console.log('[cockpit] VP Operations cockpit mounted — /api/cockpit/{overview,updates,cab,challenges,checkin,settings,digest}');
}
function start() {
  ensure().then(() => loadCfg(true)).catch(e => console.error('[cockpit] init:', e.message));
  if (digestTimer) clearInterval(digestTimer);
  digestTimer = setInterval(() => digestTick(module.exports._deps || {}), 60e3);
  if (digestTimer.unref) digestTimer.unref();
}

module.exports = { mount, start, isMember, loadCfg, parseCab, parseChecklist, parseWhen, towerOf, segmentOf, buildDigest, digestTick, TOWERS };
