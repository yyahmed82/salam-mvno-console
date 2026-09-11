#!/usr/bin/env node
/* test-budget-mails.cjs — send the REAL AI-budget mails to one address for review (11 Sep 2026).
 *
 * Runs on 152 (ruh-salam-site03, 172.31.38.152) from /apps/unified. Uses the production builder
 * (llmBudget.buildMail) and the production mailer (notify.sendHtml), so what lands in the inbox is
 * byte-for-byte what a real ceiling would send — only the numbers are made up.
 *
 * It does NOT: change any budget, write llm_budget_events, block anybody, or mail anyone but the
 * address you pass. Safe to run on production at any time.
 *
 *   node test-budget-mails.cjs y.yahmed.sns@salam.sa           every case, one mail each
 *   node test-budget-mails.cjs y.yahmed.sns@salam.sa --only=user-90,daily-recap
 *   node test-budget-mails.cjs y.yahmed.sns@salam.sa --only=daily-recap --day=2026-09-11
 *   node test-budget-mails.cjs y.yahmed.sns@salam.sa --pure    no "test send" footer — exactly the live mail
 *   node test-budget-mails.cjs y.yahmed.sns@salam.sa --dry     build only, send nothing
 *   node test-budget-mails.cjs y.yahmed.sns@salam.sa --save=/tmp/budget-mails   also write each mail as .html
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = '/apps/unified/server/src';
const llmBudget = require(path.join(ROOT, 'llmBudget'));

const argv = process.argv.slice(2);
const to = argv.find(a => a.includes('@'));
const flag = n => argv.find(a => a.startsWith('--' + n + '=')) || (argv.includes('--' + n) ? '--' + n : null);
const val = n => { const f = flag(n); return f && f.includes('=') ? f.split('=').slice(1).join('=') : null; };
const PURE = !!flag('pure'), DRY = !!flag('dry'), SAVE = val('save'), ONLY = (val('only') || '').split(',').filter(Boolean), DAY = val('day');

/* Every message a super admin can actually receive. Threshold numbers are plausible, not real;
 * the daily recap is built from the real call log. */
const CASES = [
  { name: 'user-80',  kind: 'user',   threshold: 'warn80', subject: 'a.pandey.tcs@salammobile.sa', used: 121500, cap: 150000,
    why: 'A person crosses the first warning line (80 %).' },
  { name: 'user-90',  kind: 'user',   threshold: 'warn90', subject: 'a.pandey.tcs@salammobile.sa', used: 136400, cap: 150000,
    why: 'The same person crosses 90 % — the line people actually act on.' },
  { name: 'user-100', kind: 'user',   threshold: 'over',   subject: 'a.pandey.tcs@salammobile.sa', used: 151400, cap: 150000,
    why: 'The person reaches the ceiling with enforcement ON — AI answers pause until midnight.' },
  { name: 'user-100-warn-only', kind: 'user', threshold: 'over', subject: 'a.pandey.tcs@salammobile.sa', used: 151400, cap: 150000,
    cfg: { block: false }, why: 'The same, with the budget set to warn only — nothing is blocked.' },
  { name: 'agent-100', kind: 'caller', threshold: 'over',   subject: 'salam-agent-incident', used: 604300, cap: 600000,
    why: 'An agent service exhausts its own ceiling — a machine, not a person.' },
  { name: 'global-80', kind: 'global', threshold: 'warn80', subject: 'console', used: 3260000, cap: 4000000,
    why: 'The whole console crosses 80 % of the daily ceiling.' },
  { name: 'global-90', kind: 'global', threshold: 'warn90', subject: 'console', used: 3640000, cap: 4000000,
    why: 'The whole console crosses 90 %.' },
  { name: 'global-100', kind: 'global', threshold: 'over',  subject: 'console', used: 4021000, cap: 4000000,
    why: 'The whole console reaches the daily ceiling.' },
  { name: 'daily-recap', digest: true,
    why: 'The 00:00 KSA daily recap — the AI usage & budget screen as a mail, with REAL figures from the console.' },
];

if (!to) {
  console.error('usage: node test-budget-mails.cjs <your@email> [--only=a,b] [--day=YYYY-MM-DD] [--pure] [--dry] [--save=/tmp/budget-mails]');
  console.error('cases: ' + CASES.map(c => c.name).join(', '));
  process.exit(1);
}

(async () => {
  const cfg = await llmBudget.config();
  const chosen = ONLY.length ? CASES.filter(c => ONLY.includes(c.name)) : CASES;
  if (!chosen.length) { console.error('no case matched --only. Names: ' + CASES.map(c => c.name).join(', ')); process.exit(1); }

  console.log('AI budget mail test');
  console.log('  to           : ' + to);
  console.log('  live config  : per user ' + cfg.dailyUser.toLocaleString() + '/day · per agent ' + cfg.dailyCaller.toLocaleString()
    + '/day · console ' + cfg.dailyGlobal.toLocaleString() + '/day · warn at ' + cfg.warnSteps.map(x => Math.round(x * 100) + ' %').join(' and ') + ' · '
    + (cfg.block ? 'refuse over 100 %' : 'warn only'));
  console.log('  real mails go: super admins only' + (cfg.notifyUser === true ? ', plus the person who hit their own ceiling' : ' — the person is NOT copied'));
  console.log('  mode         : ' + (DRY ? 'DRY RUN — nothing is sent' : 'sending') + (PURE ? ' · no test footer (exactly the live mail)' : ' · with a test footer'));
  console.log('  cases        : ' + chosen.map(c => c.name).join(', '));
  console.log('');

  const note = PURE ? null
    : 'Test send — triggered by hand on ' + new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })
      + ' KSA from the console server. No budget was reached and nobody was blocked; the figures above are examples.';

  if (SAVE) fs.mkdirSync(SAVE, { recursive: true });
  const results = [];
  for (const c of chosen) {
    /* the daily recap is built from real data and has its own builder */
    if (c.digest) {
      const digest = require('/apps/unified/server/src/budgetDigest');
      const day = DAY || digest.ksaYesterday();
      let built; try { built = await digest.build({ day }); }
      catch (e) { console.log('· ' + c.name.padEnd(22) + 'BUILD FAILED  ' + e.message + '\n'); results.push({ case: c.name, subject: '', sent: 'FAILED', error: e.message }); continue; }
      if (SAVE) fs.writeFileSync(path.join(SAVE, c.name + '.html'), built.html);
      let sent = false, error = null;
      if (!DRY) { const r = await digest.send({ to, day }); sent = r.sent; error = r.error; }
      const real = (await digest.digestRecipients()).map(x => x.email).join(', ') || '(no super admin found)';
      results.push({ case: c.name, subject: built.subject, pct: '—', 'would really go to': real, sent: DRY ? 'dry' : (sent ? 'yes' : 'FAILED'), error: error || '' });
      console.log('· ' + c.name.padEnd(22) + (DRY ? 'built' : (sent ? 'sent ' : 'FAIL ')) + '  ' + built.subject);
      console.log('  ' + c.why);
      console.log('  real figures for ' + built.stats.day + ': ' + built.stats.tokens.toLocaleString() + ' tokens · ' + built.stats.calls + ' calls · '
        + built.stats.people + ' people · ' + built.stats.refused + ' refused · ' + built.stats.unattributed + ' unattributed');
      console.log('  in production this goes to: ' + real);
      if (error) console.log('  ERROR: ' + error);
      console.log('');
      continue;
    }
    const useCfg = { ...cfg, ...(c.cfg || {}) };
    const built = llmBudget.buildMail({ subject: c.subject, kind: c.kind, threshold: c.threshold, used: c.used, cap: c.cap, cfg: useCfg, note });
    const real = await llmBudget.recipients({ subject: c.subject, kind: c.kind, threshold: c.threshold, cfg: useCfg });
    if (SAVE) fs.writeFileSync(path.join(SAVE, c.name + '.html'), built.html);
    let sent = false, error = null;
    if (!DRY) {
      const r = await llmBudget.previewMails({ to, note, cases: [{ ...c }] }).catch(e => [{ sent: false, error: e.message }]);
      sent = !!(r[0] && r[0].sent); error = (r[0] && r[0].error) || null;
    }
    results.push({ case: c.name, subject: built.subject, pct: built.pct + ' %',
      'would really go to': real.map(x => x.email).join(', ') || '(nobody — notifications off)',
      sent: DRY ? 'dry' : (sent ? 'yes' : 'FAILED'), error: error || '' });
    console.log('· ' + c.name.padEnd(22) + (DRY ? 'built' : (sent ? 'sent ' : 'FAIL ')) + '  ' + built.subject);
    console.log('  ' + c.why);
    console.log('  in production this goes to: ' + (real.map(x => x.email).join(', ') || '(nobody — notifications are off)'));
    if (error) console.log('  ERROR: ' + error);
    console.log('');
  }
  console.table(results);
  if (SAVE) console.log('HTML saved under ' + SAVE + ' — open them in a browser to review without a mailbox.');
  console.log('\nNothing was written to llm_budget_events and no budget was changed.');
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
