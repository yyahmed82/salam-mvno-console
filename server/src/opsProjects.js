/* opsProjects.js — Operations Projects (VP Operations ▾ › Operations Projects, #projects · 10 Oct 2026, alpha.175)
 *
 * The VP's portfolio of the IT Operations projects: one record per project (brief, dates, baseline, RAG, health per
 * dimension, budget summary, key facts) and typed items under it — milestones, the story so far, workstreams / domains,
 * bottlenecks, gaps, risks, requirements, decisions, conditions (safeguards), actions, meetings (MOMs / steerings), the
 * escalation matrix, budget lines, status updates and comments. First content: IBM Instana (SBM · IBM) and the BSS
 * migration R5/R6 (Oracle · IMPACT), from opsProjectsSeed.js.
 *
 *   GET    /api/projects                        the portfolio in one call (summaries, KPIs, needs-attention, roadmap, activity, me)
 *   GET    /api/projects/settings               editors + viewers (admins)
 *   PUT    /api/projects/settings               admins only
 *   GET    /api/projects/:ref                   one project (slug or id) with every item, grouped by kind
 *   POST   /api/projects                        create a project                   (portfolio editors · admins)
 *   PATCH  /api/projects/:ref                   edit it; { delete:true } archives it (project editors · portfolio editors · admins)
 *   POST   /api/projects/:ref/items             add an item; kind 'comment' is open to everyone who can read the page
 *   PATCH  /api/projects/:ref/items/:id         edit an item; { delete:true } removes it (soft) — a comment: its author or an editor
 *
 * WHO. Reading needs the 'projects' view. api.js gives it to every session holding 'vp' (the VP Operations menu family)
 * and to everyone named here: portfolio editors and viewers (console_settings 'ops_projects') and each project's own
 * editors. Writing is per person: admins (adminTools) and portfolio editors everything; a project's editors their
 * project; everyone with the view may comment — the VP's comments carry a VP badge. View-as stays read-only (api.js).
 * Every write is audited (projects.*). No customer data lives here; contacts are names and roles.
 *
 * DATES are calendar days (KSA). "Late" = a dated milestone not done whose date is before today (KSA); "overdue" = an open
 * action or issue whose due date is before today. */
'use strict';
const db = require('./db');
const settings = require('./settings');
const SEED = require('./opsProjectsSeed');

const C = () => db.console;
const KSA = 3 * 3600e3;
const lc = s => String(s || '').trim().toLowerCase();
const str = (v, n) => { const s = v == null ? '' : String(v).replace(/\u0000/g, '').trim(); return s ? s.slice(0, n) : null; };
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const ksaDay = d => new Date((d == null ? Date.now() : new Date(d).getTime()) + KSA).toISOString().slice(0, 10);
const dayOf = d => d == null ? null : d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const deny = msg => Object.assign(new Error(msg), { status: 403 });

/* ---------------------------------------------------------------- vocabularies */
const STATUSES = { planned: 'Planned', active: 'Active', recovery: 'Recovery', on_hold: 'On hold', closing: 'Closing', done: 'Done', cancelled: 'Cancelled' };
const RAGS = ['green', 'amber', 'red', 'grey'];
const SEGMENTS = ['mobile', 'fixed', 'both'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const HEALTH = [['schedule', 'Schedule'], ['scope', 'Scope'], ['budget', 'Budget'], ['resources', 'Resources'], ['quality', 'Quality'], ['vendor', 'Vendor']];
const KINDS = {
  milestone: ['planned', 'on_track', 'at_risk', 'done', 'missed', 'cancelled'],
  event: null,
  workstream: ['not_started', 'in_progress', 'at_risk', 'blocked', 'done', 'disputed'],
  bottleneck: ['open', 'in_progress', 'blocked', 'resolved'],
  gap: ['open', 'in_progress', 'accepted', 'resolved'],
  risk: ['open', 'mitigating', 'occurred', 'closed'],
  requirement: ['committed', 'conditional', 'excluded', 'new', 'open', 'met', 'disputed'],
  meeting: ['planned', 'held', 'cancelled'],
  action: ['open', 'in_progress', 'done', 'dropped'],
  decision: ['needed', 'taken', 'deferred'],
  condition: ['proposed', 'agreed', 'in_place', 'rejected'],
  escalation: null,
  budget_line: ['planned', 'committed', 'invoiced', 'paid', 'on_hold', 'disputed'],
  update: null,
  comment: null
};
const KIND_KEYS = Object.keys(KINDS);
const SEV_KINDS = new Set(['bottleneck', 'gap', 'risk']);
const CLOSED = { milestone: ['done', 'cancelled', 'missed'], bottleneck: ['resolved'], gap: ['resolved', 'accepted'], risk: ['closed'],
  action: ['done', 'dropped'], decision: ['taken', 'deferred'], meeting: ['held', 'cancelled'], workstream: ['done'], condition: ['in_place', 'rejected'] };
const isOpen = (kind, status) => !(CLOSED[kind] || []).includes(status);
const MEETING_TYPES = ['steering', 'weekly', 'workshop', 'review', 'escalation', 'demo', 'other'];
const RESERVED = new Set(['settings', 'new', 'people', 'portfolio', 'present']);

/* per-kind extras kept in items.data — anything else is dropped */
const DATA = {
  milestone: { baseline: 'day', gate: 'bool', phase: 's80' },
  event: { topic: 's40', tone: 'tone' },
  workstream: { evidence: 's40', remaining: 's2000' },
  bottleneck: { next: 's1500', side: 'side' },
  gap: { next: 's1500', type: 's40' },
  risk: { likelihood: 'lvl', mitigation: 's1500' },
  requirement: { area: 's80', source: 's200', reading: 's600' },
  meeting: { type: 'mtype', venue: 's120', cadence: 's80', attendees: 's2000', decisions: 'list', actions: 'acts' },
  action: { from: 's160' },
  decision: { vp: 'bool', outcome: 's1500' },
  condition: {},
  escalation: { side: 'side', level: 'lvl15', role: 's160', when: 's400', contact: 's160' },
  budget_line: {},
  update: { rag: 'rag' },
  comment: { item: 'int' }
};
function cleanVal(t, v) {
  if (t === 'bool') return v === true || v === 'true' || v === 1;
  if (t === 'day') return isDay(v) ? String(v) : null;
  if (t === 'int') { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; }
  if (t === 'lvl15') { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 1; }
  if (t === 'lvl') return ['low', 'medium', 'high'].includes(v) ? v : null;
  if (t === 'tone') return ['good', 'bad', 'warn', 'neutral'].includes(v) ? v : 'neutral';
  if (t === 'side') return ['salam', 'vendor', 'joint', 'partner', 'third'].includes(v) ? v : null;
  if (t === 'rag') return RAGS.includes(v) ? v : null;
  if (t === 'mtype') return MEETING_TYPES.includes(v) ? v : 'other';
  if (t === 'list') return (Array.isArray(v) ? v : String(v || '').split(/\n+/)).map(x => str(x, 600)).filter(Boolean).slice(0, 40);
  if (t === 'acts') return (Array.isArray(v) ? v : []).filter(a => a && typeof a === 'object').map(a => ({
    text: str(a.text, 600), owner: str(a.owner, 160), due: isDay(a.due) ? a.due : null,
    status: ['open', 'in_progress', 'done', 'late', 'dropped'].includes(a.status) ? a.status : 'open' })).filter(a => a.text).slice(0, 60);
  const m = /^s(\d+)$/.exec(t); if (m) return str(v, +m[1]);
  return null;
}
function cleanData(kind, d, cur) {
  const spec = DATA[kind] || {}, src = d && typeof d === 'object' ? d : {}, out = Object.assign({}, cur || {});
  for (const k of Object.keys(spec)) if (k in src) { const v = cleanVal(spec[k], src[k]); if (v == null || v === '') delete out[k]; else out[k] = v; }
  for (const k of Object.keys(out)) if (!(k in spec)) delete out[k];
  return out;
}

/* ---------------------------------------------------------------- settings (console_settings 'ops_projects') */
const emailList = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map(lc)
  .filter(e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)))].slice(0, 60);
const normCfg = r => ({ editors: emailList((r || {}).editors), viewers: emailList((r || {}).viewers) });
let CFG = normCfg({}), cfgAt = 0, cfgLoading = null, MEMBERS = new Set();
async function loadCfg(force) {
  if (!force && cfgAt && Date.now() - cfgAt < 60e3) return CFG;
  if (cfgLoading) return cfgLoading;
  cfgLoading = (async () => {
    try { CFG = normCfg(await settings.getSetting('ops_projects')); } catch (e) { console.error('[projects] settings:', e.message); }
    const s = new Set([...CFG.editors, ...CFG.viewers]);
    try { (await C().query(`SELECT editors FROM ops_projects WHERE deleted_at IS NULL`)).rows.forEach(r => (r.editors || []).forEach(e => s.add(lc(e)))); } catch (e) { /* table not there yet */ }
    MEMBERS = s; cfgAt = Date.now(); return CFG;
  })().finally(() => { cfgLoading = null; });
  return cfgLoading;
}
/* called by the session middleware on every request — synchronous, from the cached set */
function isMember(email) {
  if (!cfgAt || Date.now() - cfgAt > 60e3) loadCfg().catch(() => {});
  return !!email && MEMBERS.has(lc(email));
}

/* ---------------------------------------------------------------- schema + first content */
let _ensured = null;
function ensure() {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    const q = s => C().query(s);
    await q(`CREATE TABLE IF NOT EXISTS ops_projects (
        id bigserial PRIMARY KEY, seed_key text UNIQUE, slug text NOT NULL UNIQUE,
        name text NOT NULL, code text, vendor text, vendor_detail text, program text,
        segment text NOT NULL DEFAULT 'both', category text,
        sponsor text, owner text, vendor_pm text, editors text[] NOT NULL DEFAULT '{}',
        status text NOT NULL DEFAULT 'active', rag text NOT NULL DEFAULT 'grey', phase text,
        progress int, progress_basis text, progress_verified boolean NOT NULL DEFAULT false,
        start_date date, end_date date, baseline_end date, baseline_no int, go_live date,
        brief text, objective text, scope text,
        health jsonb NOT NULL DEFAULT '{}'::jsonb, budget jsonb NOT NULL DEFAULT '{}'::jsonb, facts jsonb NOT NULL DEFAULT '[]'::jsonb,
        accent text, sort int NOT NULL DEFAULT 100,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz, deleted_by text)`);
    await q(`CREATE TABLE IF NOT EXISTS ops_project_items (
        id bigserial PRIMARY KEY, project_id bigint NOT NULL REFERENCES ops_projects(id) ON DELETE CASCADE, seed_key text UNIQUE,
        kind text NOT NULL, title text NOT NULL DEFAULT '', body text, status text, severity text, owner text, org text,
        date date, due date, done_at date, pct int, amount numeric, ref text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb, sort int NOT NULL DEFAULT 100,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz, deleted_by text)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_ops_project_items_p ON ops_project_items (project_id, kind) WHERE deleted_at IS NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_ops_project_items_upd ON ops_project_items (updated_at DESC) WHERE deleted_at IS NULL`);
    await seed();
  })().catch(e => { _ensured = null; throw e; });
  return _ensured;
}

const P_COLS = ['slug', 'name', 'code', 'vendor', 'vendor_detail', 'program', 'segment', 'category', 'sponsor', 'owner', 'vendor_pm', 'editors',
  'status', 'rag', 'phase', 'progress', 'progress_basis', 'progress_verified', 'start_date', 'end_date', 'baseline_end', 'baseline_no', 'go_live',
  'brief', 'objective', 'scope', 'health', 'budget', 'facts', 'accent', 'sort'];
const JSON_COLS = new Set(['health', 'budget', 'facts']);
const I_COLS = ['kind', 'title', 'body', 'status', 'severity', 'owner', 'org', 'date', 'due', 'done_at', 'pct', 'amount', 'ref', 'data', 'sort'];
async function insertProject(f, by, seedKey) {
  const cols = Object.keys(f).filter(k => P_COLS.includes(k));
  const vals = cols.map(k => JSON_COLS.has(k) ? JSON.stringify(f[k]) : f[k]);
  const r = await C().query(`INSERT INTO ops_projects (${cols.join(',')}, created_by, updated_by, seed_key) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}, $${cols.length + 1}, $${cols.length + 1}, $${cols.length + 2})
      ON CONFLICT (seed_key) DO NOTHING RETURNING id`, [...vals, by, seedKey || null]);
  return r.rowCount ? Number(r.rows[0].id) : null;
}
async function insertItem(pid, f, by, seedKey) {
  const cols = Object.keys(f).filter(k => I_COLS.includes(k));
  const vals = cols.map(k => k === 'data' ? JSON.stringify(f[k] || {}) : f[k]);
  const r = await C().query(`INSERT INTO ops_project_items (project_id, ${cols.join(',')}, created_by, updated_by, seed_key) VALUES ($1, ${cols.map((_, i) => '$' + (i + 2)).join(',')}, $${cols.length + 2}, $${cols.length + 2}, $${cols.length + 3})
      ON CONFLICT (seed_key) DO NOTHING RETURNING id`, [pid, ...vals, by, seedKey || null]);
  return r.rowCount ? Number(r.rows[0].id) : null;
}
/* VERSION n adds the projects / items whose seed_key it lacks; a seeded row someone deleted stays deleted */
async function seed() {
  let st = null; try { st = await settings.getSetting('ops_projects_seed'); } catch (e) { /* first boot */ }
  if (st && Number(st.version) >= SEED.VERSION) return;
  let np = 0, ni = 0;
  for (const P of SEED.PROJECTS) {
    let pid = null;
    const ex = await C().query(`SELECT id, deleted_at FROM ops_projects WHERE seed_key=$1`, [P.key]);
    if (ex.rowCount) { if (ex.rows[0].deleted_at) continue; pid = Number(ex.rows[0].id); }
    else {
      const taken = await C().query(`SELECT 1 FROM ops_projects WHERE slug=$1`, [P.project.slug]);
      if (taken.rowCount) { console.log(`[projects] seed: slug "${P.project.slug}" already used — "${P.project.name}" not seeded`); continue; }
      pid = await insertProject(projectFields(P.project, null, true), null, P.key); if (pid) np++;
      if (!pid) pid = Number((await C().query(`SELECT id FROM ops_projects WHERE seed_key=$1`, [P.key])).rows[0].id);
    }
    for (const it of P.items) {
      try { const id = await insertItem(pid, itemFields(it.kind, it, null), null, P.key + ':' + it.key); if (id) ni++; }
      catch (e) { console.error(`[projects] seed item ${P.key}:${it.key}:`, e.message); }
    }
  }
  await settings.setSetting('ops_projects_seed', { version: SEED.VERSION, at: new Date().toISOString(), projects: np, items: ni });
  console.log(`[projects] seed v${SEED.VERSION}: ${np} project(s), ${ni} item(s) added`);
}

/* ---------------------------------------------------------------- input → columns */
const pct = v => { if (v === '' || v == null) return null; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null; };
const money = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[,\s]/g, '').replace(/^SAR/i, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const dayIn = (v, label) => { if (v === '' || v == null) return null; if (!isDay(v)) throw bad(`${label}: a date (YYYY-MM-DD)`); return String(v); };
const slugify = s => lc(s).normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
function cleanHealth(h) {
  const src = h && typeof h === 'object' ? h : {}, out = {};
  for (const [k] of HEALTH) { const x = src[k]; if (!x || typeof x !== 'object') continue;
    const o = { rag: RAGS.includes(x.rag) ? x.rag : 'grey' }; const note = str(x.note, 1200); if (note) o.note = note; const label = str(x.label, 30); if (label) o.label = label; out[k] = o; }
  return out;
}
function cleanBudget(b) {
  const src = b && typeof b === 'object' ? b : {};
  const cur = str(src.currency, 8); const out = { currency: cur ? cur.toUpperCase() : 'SAR' };
  for (const k of ['total', 'committed', 'spent']) { const v = money(src[k]); if (v != null) out[k] = v; }
  const vat = str(src.vat, 30); if (vat) out.vat = vat; const note = str(src.note, 1200); if (note) out.note = note;
  return out;
}
const cleanFacts = f => (Array.isArray(f) ? f : []).filter(x => x && typeof x === 'object').map(x => ({ label: str(x.label, 40), value: str(x.value, 40), note: str(x.note, 200), tone: ['good', 'warn', 'bad'].includes(x.tone) ? x.tone : null }))
  .filter(x => x.label && x.value).map(x => { if (!x.note) delete x.note; if (!x.tone) delete x.tone; return x; }).slice(0, 12);
function projectFields(b, cur, isSeed) {
  const o = {}, has = k => k in b || !cur;
  if (has('name')) { o.name = str(b.name, 160); if (!o.name) throw bad('name required'); }
  if ('slug' in b || !cur) { const s = slugify(b.slug || b.code || b.name); if (!s) throw bad('slug required'); if (RESERVED.has(s)) throw bad(`"${s}" is reserved`); o.slug = s; }
  for (const [k, n] of [['code', 40], ['vendor', 120], ['vendor_detail', 400], ['program', 160], ['category', 80], ['sponsor', 200], ['owner', 300], ['vendor_pm', 300],
    ['phase', 200], ['progress_basis', 600], ['brief', 6000], ['objective', 2000], ['scope', 4000]]) if (k in b) o[k] = str(b[k], n);
  if (has('segment')) o.segment = SEGMENTS.includes(b.segment) ? b.segment : 'both';
  if (has('status')) o.status = STATUSES[b.status] ? b.status : 'active';
  if (has('rag')) o.rag = RAGS.includes(b.rag) ? b.rag : 'grey';
  if ('progress' in b) o.progress = pct(b.progress);
  if ('progress_verified' in b) o.progress_verified = b.progress_verified === true;
  for (const k of ['start_date', 'end_date', 'baseline_end', 'go_live']) if (k in b) o[k] = dayIn(b[k], k.replace('_', ' '));
  if ('baseline_no' in b) { const n = parseInt(b.baseline_no, 10); o.baseline_no = Number.isFinite(n) && n > 0 && n < 20 ? n : null; }
  if ('health' in b) o.health = cleanHealth(b.health);
  if ('budget' in b) o.budget = cleanBudget(b.budget);
  if ('facts' in b) o.facts = cleanFacts(b.facts);
  if ('accent' in b) o.accent = /^#[0-9a-f]{6}$/i.test(String(b.accent || '')) ? String(b.accent).toLowerCase() : null;
  if ('sort' in b) { const n = parseInt(b.sort, 10); o.sort = Number.isFinite(n) ? Math.min(9999, Math.max(0, n)) : 100; }
  if ('editors' in b) o.editors = emailList(b.editors);
  if (o.start_date && o.end_date && o.end_date < o.start_date && !isSeed) throw bad('the end date is before the start date');
  return o;
}
function itemFields(kind, b, cur) {
  if (!KIND_KEYS.includes(kind)) throw bad('unknown kind');
  const o = {}, has = k => k in b || !cur;
  if (!cur) o.kind = kind;
  if (has('title')) { o.title = str(b.title, 300) || ''; if (!o.title && kind !== 'comment') throw bad('title required'); }
  if ('body' in b) o.body = str(b.body, 6000);
  if (kind === 'comment' && !cur && !o.body) throw bad('write something first');
  const sts = KINDS[kind];
  if (sts && has('status')) o.status = sts.includes(b.status) ? b.status : (cur ? cur.status : sts[0]);
  if (SEV_KINDS.has(kind) && has('severity')) o.severity = SEVERITIES.includes(b.severity) ? b.severity : 'medium';
  if ('owner' in b) o.owner = str(b.owner, 300);
  if ('org' in b) o.org = str(b.org, 160);
  if ('date' in b) o.date = dayIn(b.date, 'date');
  if ('due' in b) o.due = dayIn(b.due, 'due date');
  if ('done_at' in b) o.done_at = dayIn(b.done_at, 'completion date');
  if ('pct' in b) o.pct = pct(b.pct);
  if ('amount' in b) o.amount = money(b.amount);
  if ('ref' in b) o.ref = str(b.ref, 160);
  if ('sort' in b) { const n = parseInt(b.sort, 10); o.sort = Number.isFinite(n) ? Math.min(9999, Math.max(0, n)) : 100; }
  if ('data' in b || !cur) o.data = cleanData(kind, b.data, cur ? cur.data : null);
  return o;
}

/* ---------------------------------------------------------------- people + permissions */
let PEOPLE = { at: 0, map: {} };
async function people() {
  if (Date.now() - PEOPLE.at < 60e3) return PEOPLE.map;
  try { PEOPLE = { at: Date.now(), map: await require('./people').directory(C()) }; } catch (e) { PEOPLE.at = Date.now(); }
  return PEOPLE.map;
}
const nameOf = (dir, e) => { if (!e) return null; const p = dir[lc(e)]; return p && p.name ? p.name : null; };
function who(req) {
  const email = lc(req.sessionEmail);
  const admin = !!(req.caps && req.caps.adminTools);
  return { email, admin, editor: admin || CFG.editors.includes(email), read: (req.views || []).includes('projects'),
    isVp: (req.roleNames || []).includes('ops_vp'), readOnly: !!req.viewAs };
}
const canEdit = (w, p) => !w.readOnly && (w.editor || ((p && p.editors) || []).map(lc).includes(w.email));
const meOut = w => ({ email: w.email, admin: w.admin, editor: w.editor, isVp: w.isVp, readOnly: w.readOnly,
  canCreate: !w.readOnly && w.editor, canSettings: !w.readOnly && w.admin, canComment: !w.readOnly && w.read });

/* ---------------------------------------------------------------- readers */
function itemOut(r, dir, today) {
  const o = { id: Number(r.id), kind: r.kind, title: r.title, body: r.body, status: r.status, severity: r.severity, owner: r.owner, org: r.org,
    date: dayOf(r.date), due: dayOf(r.due), doneAt: dayOf(r.done_at), pct: r.pct, amount: r.amount == null ? null : Number(r.amount), ref: r.ref,
    data: r.data || {}, sort: r.sort, seeded: !!r.seed_key,
    createdBy: r.created_by, createdByName: nameOf(dir, r.created_by), createdAt: r.created_at,
    updatedBy: r.updated_by, updatedByName: nameOf(dir, r.updated_by), updatedAt: r.updated_at };
  const open = isOpen(r.kind, r.status);
  if (r.kind === 'milestone') { o.late = open && r.status !== 'missed' && !!o.date && o.date < today; o.daysTo = o.date ? daysBetween(today, o.date) : null;
    if (o.data.baseline && o.date) o.slipDays = daysBetween(o.data.baseline, o.date); }
  if (r.kind === 'action' || SEV_KINDS.has(r.kind)) o.overdue = open && !!o.due && o.due < today;
  if (SEV_KINDS.has(r.kind)) o.ageDays = o.date ? Math.max(0, daysBetween(o.date, today)) : null;
  if (r.kind === 'meeting' && Array.isArray(o.data.actions)) o.openActions = o.data.actions.filter(a => !['done', 'dropped'].includes(a.status)).length;
  o.open = open;
  return o;
}
function healthOut(h) {
  const src = h || {};
  return HEALTH.map(([k, label]) => { const x = src[k] || {}; return { key: k, label: x.label || label, rag: RAGS.includes(x.rag) ? x.rag : 'grey', note: x.note || null }; });
}
function stats(items, today) {
  const by = k => items.filter(i => i.kind === k);
  const ms = by('milestone'), open = (k, x) => isOpen(k, x.status);
  const upcoming = ms.filter(m => open('milestone', m) && m.status !== 'missed' && m.date && m.date >= today).sort((a, b) => a.date < b.date ? -1 : 1);
  const lines = by('budget_line'), sum = st => lines.filter(l => l.status === st).reduce((t, l) => t + (l.amount || 0), 0);
  const bns = by('bottleneck').filter(x => open('bottleneck', x)), gps = by('gap').filter(x => open('gap', x));
  const wss = by('workstream');
  const reqs = by('requirement').reduce((o, r) => (o[r.status] = (o[r.status] || 0) + 1, o), {});
  const mts = by('meeting');
  const held = mts.filter(m => m.status === 'held' && m.date).sort((a, b) => a.date < b.date ? 1 : -1);
  const planned = mts.filter(m => m.status === 'planned').sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : 1);
  const acts = by('action').filter(a => open('action', a));
  const decs = by('decision').filter(d => d.status === 'needed');
  return {
    milestones: { total: ms.length, done: ms.filter(m => m.status === 'done').length, late: ms.filter(m => m.late).length, missed: ms.filter(m => m.status === 'missed').length,
      undated: ms.filter(m => !m.date && open('milestone', m)).length,
      next: upcoming[0] ? { id: upcoming[0].id, title: upcoming[0].title, date: upcoming[0].date, daysTo: upcoming[0].daysTo, gate: !!upcoming[0].data.gate } : null,
      next30: upcoming.filter(m => m.daysTo <= 30).length },
    bottlenecks: { open: bns.length, critical: bns.filter(x => x.severity === 'critical').length, high: bns.filter(x => x.severity === 'high').length,
      top: bns.slice().sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || a.sort - b.sort).slice(0, 3).map(x => ({ id: x.id, title: x.title, severity: x.severity, owner: x.owner })) },
    gaps: { open: gps.length, high: gps.filter(x => ['critical', 'high'].includes(x.severity)).length },
    risks: { open: by('risk').filter(x => open('risk', x)).length },
    decisions: { needed: decs.length, vp: decs.filter(d => d.data.vp).length },
    actions: { open: acts.length, overdue: acts.filter(a => a.overdue).length },
    meetings: { held: held.length, planned: planned.length, last: held[0] ? { id: held[0].id, title: held[0].title, date: held[0].date } : null,
      next: planned[0] ? { id: planned[0].id, title: planned[0].title, date: planned[0].date } : null },
    workstreams: { n: wss.length, avg: wss.length ? Math.round(wss.reduce((t, w) => t + (w.pct || 0), 0) / wss.length) : null, done: wss.filter(w => w.status === 'done').length,
      atRisk: wss.filter(w => ['at_risk', 'blocked', 'disputed'].includes(w.status)).length },
    requirements: reqs,
    conditions: { n: by('condition').length, agreed: by('condition').filter(c => ['agreed', 'in_place'].includes(c.status)).length },
    escalation: { n: by('escalation').length },
    budget: { onHold: sum('on_hold'), invoiced: sum('invoiced'), paid: sum('paid'), planned: sum('planned'), committed: sum('committed'), disputed: sum('disputed'),
      lines: lines.length, unpriced: lines.filter(l => l.amount == null).length },
    comments: by('comment').length
  };
}
function projectOut(p, items, dir, today, w) {
  const start = dayOf(p.start_date), end = dayOf(p.end_date), base = dayOf(p.baseline_end), go = dayOf(p.go_live);
  const ups = items.filter(i => i.kind === 'update').sort((a, b) => (a.date || '') < (b.date || '') ? 1 : -1);
  const st = stats(items, today);
  return { id: Number(p.id), slug: p.slug, name: p.name, code: p.code, vendor: p.vendor, vendorDetail: p.vendor_detail, program: p.program,
    segment: p.segment, category: p.category, sponsor: p.sponsor, owner: p.owner, vendorPm: p.vendor_pm,
    status: p.status, statusLabel: STATUSES[p.status] || p.status, rag: p.rag, phase: p.phase,
    progress: p.progress, progressBasis: p.progress_basis, progressVerified: !!p.progress_verified,
    startDate: start, endDate: end, baselineEnd: base, baselineNo: p.baseline_no, goLive: go,
    slipDays: end && base ? daysBetween(base, end) : null, daysLeft: end ? daysBetween(today, end) : null,
    elapsedPct: start && end && end > start ? Math.max(0, Math.min(100, Math.round(daysBetween(start, today) / daysBetween(start, end) * 100))) : null,
    ageDays: start ? daysBetween(start, today) : null,
    brief: p.brief, objective: p.objective, scope: p.scope, health: healthOut(p.health), budget: Object.assign({ currency: 'SAR' }, p.budget || {}),
    facts: Array.isArray(p.facts) ? p.facts : [], accent: p.accent, sort: p.sort,
    editors: canEdit(w, p) ? (p.editors || []) : undefined,
    canEdit: canEdit(w, p),
    updatedAt: p.updated_at, updatedBy: p.updated_by, updatedByName: nameOf(dir, p.updated_by),
    lastUpdate: ups[0] ? { id: ups[0].id, title: ups[0].title, body: ups[0].body, date: ups[0].date, rag: ups[0].data.rag || null } : null,
    stats: st };
}
async function loadAll() {
  const [ps, its] = await Promise.all([
    C().query(`SELECT * FROM ops_projects WHERE deleted_at IS NULL ORDER BY sort, name`),
    C().query(`SELECT * FROM ops_project_items WHERE deleted_at IS NULL ORDER BY sort, date NULLS LAST, id`)]);
  return { ps: ps.rows, its: its.rows };
}
async function findProject(ref) {
  const r = /^\d+$/.test(String(ref)) ? await C().query(`SELECT * FROM ops_projects WHERE id=$1 AND deleted_at IS NULL`, [ref])
    : await C().query(`SELECT * FROM ops_projects WHERE slug=$1 AND deleted_at IS NULL`, [lc(ref)]);
  return r.rows[0] || null;
}
async function portfolio(req) {
  const w = who(req), today = ksaDay(), dir = await people();
  const { ps, its } = await loadAll();
  const byP = new Map(); its.forEach(r => { const a = byP.get(String(r.project_id)) || []; a.push(itemOut(r, dir, today)); byP.set(String(r.project_id), a); });
  const projects = ps.map(p => {
    const items = byP.get(String(p.id)) || [];
    const out = projectOut(p, items, dir, today, w);
    out.milestones = items.filter(i => i.kind === 'milestone').map(m => ({ id: m.id, title: m.title, date: m.date, status: m.status, late: m.late, gate: !!m.data.gate, doneAt: m.doneAt }));
    delete out.objective; delete out.scope;
    return out;
  });
  /* needs your attention: the VP's decisions, critical bottlenecks, late milestones, overdue actions of IT Operations' own people */
  const attention = [];
  for (const p of ps) {
    const items = byP.get(String(p.id)) || [], tag = { project: p.slug, projectName: p.name, projectCode: p.code || p.name, accent: p.accent };
    items.filter(i => i.kind === 'decision' && i.status === 'needed' && i.data.vp).forEach(i => attention.push(Object.assign({ type: 'decision', rank: 1, id: i.id, title: i.title, owner: i.owner, due: i.due, body: i.body }, tag)));
    items.filter(i => i.kind === 'bottleneck' && i.open && i.severity === 'critical').forEach(i => attention.push(Object.assign({ type: 'bottleneck', rank: 0, id: i.id, title: i.title, owner: i.owner, since: i.date, ageDays: i.ageDays, due: i.due }, tag)));
    items.filter(i => i.kind === 'milestone' && i.late).forEach(i => attention.push(Object.assign({ type: 'milestone', rank: 2, id: i.id, title: i.title, date: i.date, daysLate: -i.daysTo }, tag)));
  }
  attention.sort((a, b) => a.rank - b.rank || String(a.project).localeCompare(String(b.project)));
  /* recent movement: status updates and meetings by their day; anything a person changed by when they changed it */
  const act = [];
  for (const r of its) {
    if (!['update', 'meeting', 'decision', 'comment', 'milestone', 'bottleneck', 'gap', 'action', 'workstream'].includes(r.kind)) continue;
    const p = ps.find(x => String(x.id) === String(r.project_id)); if (!p) continue;
    const human = r.updated_by || r.created_by;
    let at = null;
    if (r.kind === 'update' || (r.kind === 'meeting' && r.status === 'held')) at = r.date ? new Date(dayOf(r.date) + 'T09:00:00Z').toISOString() : null;
    if (human) at = new Date(r.updated_at).toISOString();
    if (!at) continue;
    act.push({ at, kind: r.kind, id: Number(r.id), title: r.title || (r.body || '').slice(0, 120), status: r.status, rag: (r.data || {}).rag || null,
      by: human || null, byName: nameOf(dir, human), vp: !!(r.data || {}).vp, project: p.slug, projectName: p.name, projectCode: p.code || p.name, accent: p.accent, seeded: !human });
  }
  act.sort((a, b) => a.at < b.at ? 1 : -1);
  const live = projects.filter(p => !['done', 'cancelled'].includes(p.status));
  const onHold = {}; projects.forEach(p => { const c = p.budget.currency || 'SAR'; onHold[c] = (onHold[c] || 0) + (p.stats.budget.onHold || 0); });
  const nexts = live.map(p => p.stats.milestones.next ? Object.assign({ project: p.slug, projectName: p.name, projectCode: p.code || p.name }, p.stats.milestones.next) : null).filter(Boolean).sort((a, b) => a.date < b.date ? -1 : 1);
  const kpis = {
    projects: projects.length, active: live.length,
    rag: RAGS.reduce((o, r) => (o[r] = live.filter(p => p.rag === r).length, o), {}),
    lateMilestones: live.reduce((t, p) => t + p.stats.milestones.late + p.stats.milestones.missed, 0),
    bottlenecks: { open: live.reduce((t, p) => t + p.stats.bottlenecks.open, 0), critical: live.reduce((t, p) => t + p.stats.bottlenecks.critical, 0), high: live.reduce((t, p) => t + p.stats.bottlenecks.high, 0) },
    gaps: live.reduce((t, p) => t + p.stats.gaps.open, 0),
    decisions: { needed: live.reduce((t, p) => t + p.stats.decisions.needed, 0), vp: live.reduce((t, p) => t + p.stats.decisions.vp, 0) },
    actions: { open: live.reduce((t, p) => t + p.stats.actions.open, 0), overdue: live.reduce((t, p) => t + p.stats.actions.overdue, 0) },
    onHold, next: nexts[0] || null
  };
  return { me: meOut(w), today, generatedAt: new Date().toISOString(), projects, kpis, attention: attention.slice(0, 12), activity: act.slice(0, 16) };
}
async function detail(req, ref) {
  const w = who(req), today = ksaDay(), dir = await people();
  const p = await findProject(ref); if (!p) return null;
  const r = await C().query(`SELECT * FROM ops_project_items WHERE project_id=$1 AND deleted_at IS NULL ORDER BY sort, date NULLS LAST, id`, [p.id]);
  const items = r.rows.map(x => itemOut(x, dir, today));
  const grouped = {}; KIND_KEYS.forEach(k => { grouped[k] = []; }); items.forEach(i => { (grouped[i.kind] = grouped[i.kind] || []).push(i); });
  grouped.comment.sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
  grouped.update.sort((a, b) => (a.date || '') < (b.date || '') ? 1 : -1);
  const out = projectOut(p, items, dir, today, w);
  return { me: meOut(w), today, generatedAt: new Date().toISOString(), project: out, items: grouped,
    others: (await C().query(`SELECT slug, name, rag, accent FROM ops_projects WHERE deleted_at IS NULL ORDER BY sort, name`)).rows };
}

/* ---------------------------------------------------------------- routes */
function mount(app, { requireView, audit }) {
  app.use('/api/projects', requireView('projects'));
  app.use('/api/projects', (req, res, next) => { Promise.all([ensure(), loadCfg()]).then(() => next(), e => res.status(500).json({ error: 'projects tables: ' + e.message })); });
  const ok = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  const need = (cond, msg) => { if (!cond) throw deny(msg); };
  const nameTaken = async (slug, id) => (await C().query(`SELECT 1 FROM ops_projects WHERE slug=$1 AND ($2::bigint IS NULL OR id<>$2)`, [slug, id || null])).rowCount > 0;

  app.get('/api/projects', ok(async (req, res) => res.json(await portfolio(req))));

  app.get('/api/projects/settings', ok(async (req, res) => {
    const w = who(req); need(w.admin, 'admins only');
    const dir = await people();
    res.json({ settings: CFG, people: Object.values(dir).filter(p => p.enabled).map(p => ({ email: p.email, name: p.name, role: p.role_label })).slice(0, 2000) });
  }));
  app.put('/api/projects/settings', ok(async (req, res) => {
    const w = who(req); need(w.admin && !w.readOnly, 'admins only');
    const next = normCfg(req.body || {});
    await settings.setSetting('ops_projects', next); await loadCfg(true);
    audit(req, 'projects.settings', null, { editors: next.editors, viewers: next.viewers });
    res.json({ ok: true, settings: CFG });
  }));

  app.get('/api/projects/:ref', ok(async (req, res) => {
    const d = await detail(req, req.params.ref); if (!d) return res.status(404).json({ error: 'project not found' });
    res.json(d);
  }));

  app.post('/api/projects', ok(async (req, res) => {
    const w = who(req); need(!w.readOnly && w.editor, 'only portfolio editors can add a project');
    const f = projectFields(req.body || {}, null);
    if (await nameTaken(f.slug)) throw bad(`the short name "${f.slug}" is already used`);
    const id = await insertProject(f, w.email, null);
    await loadCfg(true);
    audit(req, 'projects.create', String(id), { slug: f.slug, name: f.name });
    res.json({ ok: true, id, slug: f.slug });
  }));

  app.patch('/api/projects/:ref', ok(async (req, res) => {
    const w = who(req), cur = await findProject(req.params.ref); if (!cur) return res.status(404).json({ error: 'project not found' });
    need(canEdit(w, cur), 'you cannot edit this project');
    const b = req.body || {};
    if (b.delete === true) {
      need(w.editor, 'only portfolio editors can archive a project');
      await C().query(`UPDATE ops_projects SET deleted_at=now(), deleted_by=$2, slug = left(slug, 40) || '~' || id WHERE id=$1`, [cur.id, w.email]);   // frees the short name
      await loadCfg(true);
      audit(req, 'projects.delete', String(cur.id), { slug: cur.slug, name: cur.name });
      return res.json({ ok: true });
    }
    if ('editors' in b && !w.editor) delete b.editors;                                     // a project editor cannot widen the list
    const f = projectFields(b, cur);
    if (f.slug && f.slug !== cur.slug && await nameTaken(f.slug, cur.id)) throw bad(`the short name "${f.slug}" is already used`);
    const start = 'start_date' in f ? f.start_date : dayOf(cur.start_date), end = 'end_date' in f ? f.end_date : dayOf(cur.end_date);
    if (start && end && end < start) throw bad('the end date is before the start date');
    const cols = Object.keys(f); if (!cols.length) return res.json({ ok: true });
    const vals = cols.map(k => JSON_COLS.has(k) ? JSON.stringify(f[k]) : f[k]);
    await C().query(`UPDATE ops_projects SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_by=$${cols.length + 2}, updated_at=now() WHERE id=$1`, [cur.id, ...vals, w.email]);
    if ('editors' in f) await loadCfg(true);
    audit(req, 'projects.edit', String(cur.id), { slug: f.slug || cur.slug, fields: cols, rag: f.rag && f.rag !== cur.rag ? `${cur.rag} → ${f.rag}` : undefined, status: f.status && f.status !== cur.status ? `${cur.status} → ${f.status}` : undefined });
    res.json({ ok: true, slug: f.slug || cur.slug });
  }));

  app.post('/api/projects/:ref/items', ok(async (req, res) => {
    const w = who(req), p = await findProject(req.params.ref); if (!p) return res.status(404).json({ error: 'project not found' });
    const b = req.body || {}, kind = String(b.kind || '');
    if (kind === 'comment') need(!w.readOnly && w.read, 'read-only session');
    else need(canEdit(w, p), 'you cannot edit this project');
    const f = itemFields(kind, b, null);
    if (kind === 'comment') { f.data = Object.assign({}, f.data, { vp: w.isVp }); if (!f.title) f.title = ''; }
    const id = await insertItem(p.id, f, w.email, null);
    await C().query(`UPDATE ops_projects SET updated_at=now(), updated_by=$2 WHERE id=$1`, [p.id, w.email]);
    audit(req, kind === 'comment' ? 'projects.comment' : 'projects.item.create', String(id), { project: p.slug, kind, title: f.title || undefined, chars: kind === 'comment' ? (f.body || '').length : undefined });
    res.json({ ok: true, id });
  }));

  app.patch('/api/projects/:ref/items/:id', ok(async (req, res) => {
    const w = who(req), p = await findProject(req.params.ref); if (!p) return res.status(404).json({ error: 'project not found' });
    const r = await C().query(`SELECT * FROM ops_project_items WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL`, [req.params.id, p.id]);
    const cur = r.rows[0]; if (!cur) return res.status(404).json({ error: 'item not found' });
    const b = req.body || {};
    const mine = cur.kind === 'comment' && lc(cur.created_by) === w.email && !w.readOnly;
    need(canEdit(w, p) || mine, 'you cannot edit this item');
    if (b.delete === true) {
      await C().query(`UPDATE ops_project_items SET deleted_at=now(), deleted_by=$2 WHERE id=$1`, [cur.id, w.email]);
      audit(req, 'projects.item.delete', String(cur.id), { project: p.slug, kind: cur.kind, title: cur.title || undefined });
      return res.json({ ok: true });
    }
    const f = itemFields(cur.kind, b, cur);
    if (cur.kind === 'comment') { const keep = { body: f.body }; Object.keys(f).forEach(k => { if (!(k in keep)) delete f[k]; }); Object.assign(f, keep); if (!f.body) throw bad('write something first'); }
    if (cur.kind === 'milestone' && f.status === 'done' && !('done_at' in f) && !cur.done_at) f.done_at = ksaDay();
    const cols = Object.keys(f).filter(k => I_COLS.includes(k) && k !== 'kind'); if (!cols.length) return res.json({ ok: true });
    const vals = cols.map(k => k === 'data' ? JSON.stringify(f[k] || {}) : f[k]);
    await C().query(`UPDATE ops_project_items SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_by=$${cols.length + 2}, updated_at=now() WHERE id=$1`, [cur.id, ...vals, w.email]);
    await C().query(`UPDATE ops_projects SET updated_at=now(), updated_by=$2 WHERE id=$1`, [p.id, w.email]);
    audit(req, 'projects.item.edit', String(cur.id), { project: p.slug, kind: cur.kind, fields: cols, status: f.status && f.status !== cur.status ? `${cur.status} → ${f.status}` : undefined });
    res.json({ ok: true });
  }));

  console.log('[projects] Operations Projects mounted — /api/projects');
}
function start() { ensure().then(() => loadCfg(true)).catch(e => console.error('[projects] init:', e.message)); }

module.exports = { mount, start, isMember, loadCfg, ensure, KINDS, STATUSES, _test: { projectFields, itemFields, cleanData, stats } };
