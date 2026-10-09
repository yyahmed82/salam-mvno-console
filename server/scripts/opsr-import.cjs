/* opsr-import.cjs — load one reporting week that ITSM collected by hand into Operations reports (alpha.156).
 *
 *   node /apps/unified/server/scripts/opsr-import.cjs <bundle dir> [--dry]
 *
 * The bundle holds the vendors' files exactly as they were sent (pptx · xlsx · pdf) and manifest.json:
 *   { "week": "2026-09-27", "by": "itsm-import",
 *     "teams":   [ { "key", "name", "vendor", "domain", "tower", "segment", "format_note", "kpis": [...] } ]   created if missing
 *     "rename":  [ { "key", "from", "to" } ]                                                                    only when the name is still "from"
 *     "reports": [ { "team", "status", "submittedAt", "files": ["…"], "data": { rag, headline, kpis, counters, actions, risks, … } } ] }
 * Each report is stored the way an upload + submit stores it: files kept and read, data normalized, actions synced, late =
 * the vendor's real send time after the due time. Safe to run twice (same file = same row, data replaced, actions upserted).
 * Runs on 152 as root; takes the env of the running PM2 process (salam-unified) → console DB 172.31.15.121 · unified_console. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dir = process.argv[2];
const dry = process.argv.includes('--dry');
if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) { console.error('usage: node opsr-import.cjs <bundle dir with manifest.json> [--dry]'); process.exit(2); }
let pid = null;
try { pid = execSync('pm2 pid salam-unified', { env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' } }).toString().trim().split('\n').pop(); } catch (e) {}
if (pid && fs.existsSync(`/proc/${pid}/environ`)) for (const kv of fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')) { const i = kv.indexOf('='); if (i > 0 && !(kv.slice(0, i) in process.env)) process.env[kv.slice(0, i)] = kv.slice(i + 1); }

const MIME = { pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', csv: 'text/csv', eml: 'message/rfc822' };

(async () => {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const by = m.by || 'itsm-import';
  console.log(`Operations reports import · week ${m.week} · ${m.reports.length} reports · ${dry ? 'DRY RUN' : 'writing'} · PM2 pid ${pid || '?'}`);
  for (const r of m.reports) for (const f of r.files || []) if (!fs.existsSync(path.join(dir, f))) { console.error('✗ missing file in bundle:', f); process.exit(1); }
  if (dry) {
    for (const r of m.reports) console.log(`  ${r.team.padEnd(16)} ${r.status.padEnd(9)} ${(r.data && r.data.rag || '').padEnd(6)} files: ${(r.files || []).join(' · ')}`);
    process.exit(0);
  }
  const db = require('../src/db');
  const O = require('../src/opsReports');
  for (const t of m.teams || []) { const r = await O.ensureTeam(t, by); console.log(`${r.created ? '+ team created' : '· team exists '} ${t.key} — ${t.name}`); }
  for (const rn of m.rename || []) {
    const r = await db.console.query(`UPDATE opsr_teams SET name=$3, updated_by=$4, updated_at=now() WHERE key=$1 AND name=$2 RETURNING id`, [rn.key, rn.from, rn.to, by]);
    console.log(r.rowCount ? `~ renamed ${rn.key}: "${rn.from}" → "${rn.to}"` : `· ${rn.key} not renamed (name is no longer "${rn.from}")`);
  }
  for (const r of m.reports) {
    const files = (r.files || []).map(f => ({ name: path.basename(f), mime: MIME[f.split('.').pop().toLowerCase()] || 'application/octet-stream', buf: fs.readFileSync(path.join(dir, f)) }));
    const out = await O.importReport({ teamKey: r.team, week: m.week, files, data: r.data, status: r.status || 'submitted', submittedAt: r.submittedAt, by });
    console.log(`\n✓ ${out.name} (${out.team}) · ${out.status} · RAG ${out.rag || '—'}${out.late ? ' · LATE' : ''}`);
    out.files.forEach(f => console.log(`    file ${f.duplicate ? '(already there) ' : ''}${f.name} · ${f.pages} page(s) read${f.note ? ' · ' + f.note : ''}`));
    if (out.kpis && out.kpis.length) console.log('    KPIs: ' + out.kpis.join(' · '));
    if (out.actions) console.log(`    actions: ${out.actions.added} new, ${out.actions.moved} ETA moved`);
  }
  console.log(`\nDone — open Operations reports › This week (week of ${m.week}) and the Consolidated report.`);
  console.log('The weekly decks are built by the running console within a minute once every team they use is in (Operations reports › This week › Weekly decks).');
  process.exit(0);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
