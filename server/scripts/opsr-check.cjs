/* opsr-check.cjs — post-deploy check of Operations reports (alpha.152). Read-only.
 * Run on 152 as root:  node /apps/unified/server/scripts/opsr-check.cjs
 * Takes the env of the running PM2 process (salam-unified), so it reads the same console DB (172.31.15.121 · unified_console). */
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const PATHENV = '/usr/local/bin:/usr/bin:/bin';
let pid = process.argv[2];
try { if (!pid) pid = execSync('pm2 pid salam-unified', { env: { ...process.env, PATH: PATHENV } }).toString().trim().split('\n').pop(); } catch (e) {}
if (pid && fs.existsSync(`/proc/${pid}/environ`)) for (const kv of fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')) { const i = kv.indexOf('='); if (i > 0 && !(kv.slice(0, i) in process.env)) process.env[kv.slice(0, i)] = kv.slice(i + 1); }
const PORT = process.env.PORT || 4701;
const db = require('../src/db');
const ok = (b, s) => console.log(`${b ? '✓' : '✗'} ${s}`);
(async () => {
  console.log(`Operations reports check · PM2 pid ${pid || '?'} · port ${PORT}`);
  const v = await fetch(`http://127.0.0.1:${PORT}/api/version`).then(r => r.json()).catch(e => ({ error: e.message }));
  ok(/alpha\.152|alpha\.15[3-9]/.test(JSON.stringify(v)), `version ${v.version || JSON.stringify(v)}`);
  const C = db.console;
  const t = (await C.query(`SELECT t, to_regclass(t) IS NOT NULL ok FROM unnest(array['opsr_teams','opsr_reports','opsr_files','opsr_actions','opsr_tokens','opsr_mails','opsr_jobs']) t`)).rows;
  ok(t.every(x => x.ok), 'tables: ' + t.map(x => `${x.t}${x.ok ? '' : ' MISSING'}`).join(' · '));
  if (t.every(x => x.ok)) {
    const teams = (await C.query(`SELECT key, name, active, cardinality(owners) o, cardinality(uploaders) u, jsonb_array_length(vendor_contacts) c, drop_enabled, jsonb_array_length(kpis) k FROM opsr_teams ORDER BY sort`)).rows;
    ok(teams.length >= 8, `${teams.length} teams`);
    console.table(teams);
    const n = (await C.query(`SELECT (SELECT count(*) FROM opsr_reports)::int reports, (SELECT count(*) FROM opsr_files)::int files, (SELECT count(*) FROM opsr_actions)::int actions, (SELECT count(*) FROM opsr_mails)::int mails, (SELECT count(*) FROM opsr_jobs)::int jobs`)).rows[0];
    console.log('rows:', JSON.stringify(n));
  }
  const cfg = (await C.query(`SELECT value FROM console_settings WHERE key='opsreports'`)).rows[0];
  console.log('settings:', cfg ? JSON.stringify({ editors: cfg.value.editors.length, management: cfg.value.management.length, itsmCc: cfg.value.itsmCc.length }) : 'defaults (not saved yet)');
  const r1 = await fetch(`http://127.0.0.1:${PORT}/api/opsreports/overview`); ok(r1.status === 401, `overview without a session → ${r1.status} (expect 401)`);
  const r2 = await fetch(`http://127.0.0.1:${PORT}/api/opsreports/drop/${'x'.repeat(32)}`); const j2 = await r2.json().catch(() => ({}));
  ok(r2.status === 404 && /not valid/.test(j2.error || ''), `public drop path with a bad token → ${r2.status} ${j2.error || ''} (expect 404)`);
  const r3 = await fetch(`http://127.0.0.1:${PORT}/opsreports-drop.html`); ok(r3.status === 200, `opsreports-drop.html → ${r3.status}`);
  const r4 = await fetch(`http://127.0.0.1:${PORT}/opsreports.js`); ok(r4.status === 200, `opsreports.js → ${r4.status}`);
  let pdf = false; try { execSync('command -v pdftotext', { shell: '/bin/bash' }); pdf = true; } catch (e) {}
  ok(true, `pdftotext ${pdf ? 'installed — PDF reports are read' : 'not installed — PDF reports are stored, not read (pptx / xlsx / docx / eml are read)'}`);
  ok(true, `ServiceNow ${process.env.SN_URL && process.env.SN_USER && process.env.SN_PASS ? 'configured (' + process.env.SN_URL + ')' : 'not configured — ITSM tab shows what is missing'}`);
  ok(true, `SMTP ${process.env.SMTP_HOST ? 'configured' : 'not configured'} · OPSR_MAIL=${process.env.OPSR_MAIL || '(on)'}`);
  process.exit(0);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
