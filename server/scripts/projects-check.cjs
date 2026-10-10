#!/usr/bin/env node
/* projects-check.cjs — after alpha.175 (Operations Projects, #projects): reports the tables, the first content and the
 * menu entry. READ-ONLY (SELECTs on unified_console). Prints counts only — no e-mail, no contact detail.
 *   cd /apps/unified/server && set -a; . /apps/unified/.env; set +a; node scripts/projects-check.cjs */
'use strict';
const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));
const q = (s, p) => db.console.query(s, p);
(async () => {
  console.log('version', require(path.join(__dirname, '..', 'package.json')).version);
  const t = await q("SELECT to_regclass('ops_projects') AS p, to_regclass('ops_project_items') AS i");
  console.log('tables:', t.rows[0].p ? 'ops_projects ok' : 'ops_projects MISSING', '·', t.rows[0].i ? 'ops_project_items ok' : 'ops_project_items MISSING');
  if (!t.rows[0].p || !t.rows[0].i) { console.log('→ the app creates them on its first /api/projects call or at start; check the log for "[projects]"'); process.exit(0); }
  const seed = await q("SELECT value FROM console_settings WHERE key = 'ops_projects_seed'");
  console.log('first content:', seed.rows[0] ? JSON.stringify(seed.rows[0].value) : 'not seeded yet');
  const ps = await q(`SELECT p.id, p.slug, p.name, p.rag, p.status, p.start_date, p.end_date, p.baseline_end, cardinality(p.editors) AS editors,
      (SELECT json_object_agg(kind, n) FROM (SELECT kind, count(*) AS n FROM ops_project_items i WHERE i.project_id = p.id AND i.deleted_at IS NULL GROUP BY kind) k) AS items
      FROM ops_projects p WHERE p.deleted_at IS NULL ORDER BY p.sort, p.name`);
  for (const p of ps.rows) {
    const d = v => v ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : 'TBC';
    console.log(`project ${p.slug}: "${p.name}" · ${p.rag} · ${p.status} · ${d(p.start_date)} → ${d(p.end_date)} (baseline ${d(p.baseline_end)}) · project editors ${p.editors}`);
    console.log('   items', JSON.stringify(p.items || {}));
  }
  const arch = await q('SELECT count(*)::int AS n FROM ops_projects WHERE deleted_at IS NOT NULL');
  console.log('archived projects:', arch.rows[0].n);
  const cfg = await q("SELECT value FROM console_settings WHERE key = 'ops_projects'");
  const c = (cfg.rows[0] && cfg.rows[0].value) || {};
  console.log('page settings: portfolio editors', (c.editors || []).length, '· viewers', (c.viewers || []).length, '(everyone holding the VP dashboard view reads the page)');
  const vp = await q("SELECT count(*)::int AS n FROM console_users WHERE enabled AND ('ops_vp' = ANY(roles) OR role = 'ops_vp')");
  console.log('enabled users with the VP Operations role:', vp.rows[0].n);
  const m = await q("SELECT value FROM console_settings WHERE key = 'ui_menu'");
  const v = m.rows[0] && m.rows[0].value;
  if (!v || !Array.isArray(v.items)) console.log('header menus: default — Operations Projects sits in VP Operations ▾ between VP dashboard and Weekly Report');
  else {
    const has = JSON.stringify(v.items).includes('"v:opsprojects"'), known = Array.isArray(v.known) && v.known.includes('v:opsprojects');
    console.log('header menus: saved layout ·', has ? 'Operations Projects placed by the admin' : known ? 'Operations Projects REMOVED by an admin (Settings › Navigation › Not in the menus)' : 'Operations Projects added after VP dashboard automatically (new page)');
  }
  const a = await q("SELECT action, count(*)::int AS n FROM audit_log WHERE action LIKE 'projects.%' GROUP BY 1 ORDER BY 1");
  console.log('audit:', a.rows.length ? a.rows.map(r => `${r.action} ${r.n}`).join(' · ') : 'no write yet');
  process.exit(0);
})().catch(e => { console.log('FAILED', e.message); process.exit(1); });
