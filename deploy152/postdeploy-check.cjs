#!/usr/bin/env node
/* POST-DEPLOY VERIFICATION — run ON 152 immediately after every deploy.
 *
 * MUST RUN AS ROOT — /apps/console is root-owned, so as the login user `cd` fails, ../.env can't be
 * sourced, and this file isn't even readable ("Cannot find module"):
 *
 *     sudo su -
 *     cd /apps/console/server && set -a; . ../.env; set +a
 *     node /apps/console/server/postdeploy-check.cjs --require bss_soap_fault_1500,bss_degraded
 *
 * Answers one question: "is the code I just shipped actually the code that is running, and is it
 * working?" Deliberately falsifiable — every check prints PASS/FAIL with the observed value, so a
 * green run means something. READ-ONLY apart from nothing; safe during an incident.
 *
 * Exit codes:  0 = all pass   1 = a check failed   2 = could not run (env/connection)
 *
 * Options:  --expect-rules 42   --expect-metrics 32   (defaults read from the shipped source)
 */
process.env.TZ = 'UTC';                       // must match the app (see ecosystem.prod.config.js)
const { Client } = require('pg');
const http = require('http');
const path = require('path');

const PORT = process.env.PORT || 4600;
const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };

let pass = 0, fail = 0;
const C = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` };
function check(ok, label, detail) {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? C.g('PASS') : C.r('FAIL')}  ${label}${detail ? C.d('  — ' + detail) : ''}`);
}
function note(label, detail) { console.log(`  ${C.y('NOTE')}  ${label}${detail ? C.d('  — ' + detail) : ''}`); }
function head(t) { console.log('\n' + C.b(t) + '\n' + '─'.repeat(t.length)); }

const get = (p, timeout = 20000) => new Promise(resolve => {
  const t0 = Date.now();
  const req = http.get({ host: '127.0.0.1', port: PORT, path: p,
    headers: { 'X-Console-User': process.env.CONSOLE_ADMIN_USER || 'y.yahmed.sns@salam.sa' } },
    res => { let b = ''; res.on('data', c => b += c);
             res.on('end', () => resolve({ code: res.statusCode, ms: Date.now() - t0, body: b })); });
  req.on('error', e => resolve({ code: 0, ms: Date.now() - t0, body: e.message }));
  req.setTimeout(timeout, () => { req.destroy(); resolve({ code: -1, ms: timeout, body: 'timeout' }); });
});
const json = r => { try { return JSON.parse(r.body); } catch (e) { return null; } };

(async () => {
  // What the SHIPPED source says should be there — compared against what the DB/app actually has.
  let srcRules = null, srcMetrics = null, ruleKeys = [];
  try {
    const { RULES } = require(path.join(__dirname, 'src', 'seedRules.js'));
    const M = require(path.join(__dirname, 'src', 'metrics.js'));
    const reg = M.METRICS || M.registry || M;
    srcRules = RULES.length; srcMetrics = Object.keys(reg).length;
    ruleKeys = RULES.map(r => r.key);
  } catch (e) { note('could not read shipped source', e.message + ' (expectations must be passed as flags)'); }

  const wantRules = Number(arg('--expect-rules') || srcRules || 0);
  const wantMetrics = Number(arg('--expect-metrics') || srcMetrics || 0);

  // ── 1. the process is actually running the new code ──────────────────────────────
  head('1 · process & build');
  const health = await get('/api/health');
  check(health.code === 200, 'app responds on :' + PORT, `HTTP ${health.code} in ${health.ms}ms`);
  if (health.code !== 200) { console.log('\n' + C.r('app is not up — stop here and check: pm2 logs console --lines 60')); process.exit(2); }

  const me = await get('/api/me');
  check(me.code === 200, 'auth path alive (/api/me)', `HTTP ${me.code}`);

  // ── 2. rules & metrics seeded from the shipped source ────────────────────────────
  head('2 · rules & metrics seeded');
  let c;
  try {
    c = new Client({ connectionString: process.env.CONSOLE_DATABASE_URL,
                     options: '-c timezone=UTC', statement_timeout: 20000,
                     application_name: 'postdeploy-check' });
    await c.connect();
  } catch (e) { console.log(C.r('  cannot reach the console DB: ' + e.message)); process.exit(2); }

  // TOTAL is the seeding check. ENABLED is a separate, operator-controlled thing — a rule switched
  // off deliberately in the UI is not a failed deploy, so it must not read as one.
  const rc = Number((await c.query('SELECT count(*) n FROM alert_rules')).rows[0].n);
  check(wantRules === 0 || rc >= wantRules, 'alert_rules seeded', `${rc} in DB${wantRules ? ` (source has ${wantRules})` : ''}`);

  const mc = Number((await c.query('SELECT count(*) n FROM metric_catalog')).rows[0].n);
  check(wantMetrics === 0 || mc >= wantMetrics, 'metric_catalog seeded', `${mc} metrics${wantMetrics ? ` (source has ${wantMetrics})` : ''}`);

  if (ruleKeys.length) {
    const have = new Set((await c.query('SELECT key FROM alert_rules')).rows.map(r => r.key));
    const missing = ruleKeys.filter(k => !have.has(k));
    check(missing.length === 0, 'every rule in the source exists in the DB',
          missing.length ? 'MISSING: ' + missing.join(', ') : `all ${ruleKeys.length} present`);
  }

  // Which rules are switched off, and by implication which will never fire. Informational unless
  // --require names one of them: a rule you just shipped had better be ON.
  const off = (await c.query('SELECT key, severity FROM alert_rules WHERE NOT enabled ORDER BY key')).rows;
  if (off.length) note(`${off.length} rule(s) DISABLED (will never fire)`, off.map(o => o.key).join(', '));
  else console.log(`  ${C.g('PASS')}  all rules enabled`);

  // --require bss_soap_fault_1500,bss_degraded  → assert the rules THIS deploy shipped are live
  const req = (arg('--require') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (req.length) {
    const rows = (await c.query(
      'SELECT key, enabled, severity, threshold, window_hours, min_sample FROM alert_rules WHERE key = ANY($1)',
      [req])).rows;
    for (const k of req) {
      const r = rows.find(x => x.key === k);
      check(!!r && r.enabled, `required rule live: ${k}`,
            !r ? 'NOT IN DB — seeding did not run' :
            !r.enabled ? 'present but DISABLED' :
            `${r.severity} ${r.threshold} / ${r.window_hours}h / min_sample ${r.min_sample}`);
    }
  }

  const orphan = (await c.query(
    `SELECT r.key, r.metric_key FROM alert_rules r
      LEFT JOIN metric_catalog m ON m.key = r.metric_key
      WHERE m.key IS NULL AND r.enabled`)).rows;
  check(orphan.length === 0, 'no rule points at a missing metric',
        orphan.length ? orphan.map(o => `${o.key}→${o.metric_key}`).join(', ') : 'all resolve');

  // ── 3. every metric actually COMPUTES (a rule on a broken metric is silent, not loud) ──
  head('3 · metrics computing (silent failure is the dangerous kind)');
  // NB: the column is computed_at (when we calculated it), NOT created_at — there is also sim_now,
  // which is the VIRTUAL clock the snapshot was computed for. Freshness means computed_at.
  const snapAge = (await c.query(
    `SELECT metric_key, max(computed_at) AS last FROM metric_snapshots
      GROUP BY metric_key ORDER BY 2 DESC NULLS LAST`)).rows;
  if (!snapAge.length) {
    note('no metric snapshots yet', 'the alert runner may not have ticked — re-run this in a few minutes');
  } else {
    const newest = new Date(snapAge[0].last);
    const ageMin = Math.round((Date.now() - newest) / 60000);
    check(ageMin <= 30, 'metric snapshots are fresh', `newest ${ageMin} min old`);
    // sync.js computes ONLY the (metric, window) pairs some ENABLED rule needs. A metric whose
    // rules are all disabled therefore stops producing snapshots BY DESIGN — flagging that as a
    // fault is a false alarm. Only metrics an enabled rule depends on are allowed to go stale.
    const live = new Set((await c.query(
      'SELECT DISTINCT metric_key FROM alert_rules WHERE enabled')).rows.map(r => r.metric_key));
    const stale = snapAge.filter(s => live.has(s.metric_key) &&
                                      (!s.last || (Date.now() - new Date(s.last)) > 6 * 3600e3));
    const dormant = snapAge.filter(s => !live.has(s.metric_key));
    check(stale.length === 0, 'no ACTIVE metric has stopped producing snapshots',
          stale.length ? 'STALE: ' + stale.map(s => s.metric_key).join(', ')
                       : `${snapAge.length - dormant.length} active metrics reporting`);
    if (dormant.length) note(`${dormant.length} metric(s) dormant (no enabled rule needs them)`,
                             dormant.map(s => s.metric_key).join(', '));
  }

  // Any rule that has NEVER been evaluated is a rule that will never fire. Newly-shipped metrics
  // legitimately have no snapshot until the runner's next tick, so don't cry wolf on a fresh deploy.
  if (ruleKeys.length && snapAge.length >= 3) {
    const never = (await c.query(
      `SELECT r.key FROM alert_rules r
        WHERE r.enabled AND NOT EXISTS (
          SELECT 1 FROM metric_snapshots s WHERE s.metric_key = r.metric_key)`)).rows.map(r => r.key);
    if (never.length) {
      const newestMin = Math.round((Date.now() - new Date(snapAge[0].last)) / 60000);
      const fresh = newestMin <= 5;       // runner is mid-cycle — the gap may just be timing
      (fresh ? note : (l, d) => check(false, l, d))(
        'enabled rules with no metric data', never.join(', ') +
        (fresh ? ' (runner ticked <5 min ago — re-run this check in one cycle)' : ' — these can never fire'));
    } else check(true, 'every enabled rule has a metric producing data', 'all rules evaluable');
  } else if (ruleKeys.length) {
    note('skipping rule-coverage check', 'too few snapshots yet — re-run after the runner has cycled');
  }

  // ── 4. the pages a person will actually open ─────────────────────────────────────
  head('4 · endpoint timings (a page that times out is a page nobody trusts)');
  const SLOW = Number(arg('--slow') || 2500);
  for (const [label, p] of [
    ['dashboard  7d', '/api/home?range=7d'],
    ['alerts open  ', '/api/alerts?status=open'],
    ['alert rules  ', '/api/rules'],
    ['troubleshoot ', '/api/errors/summary?window=24'],
    ['BSS breakdown', '/api/errors/bss-breakdown?window=24'],
  ]) {
    const r = await get(p, 30000);
    check(r.code === 200 && r.ms < SLOW, label, `HTTP ${r.code} in ${r.ms}ms (limit ${SLOW}ms)`);
  }

  // ── 5. data freshness — stale data makes every check above meaningless ───────────
  head('5 · data freshness');
  try {
    const s = new Client({ connectionString: process.env.SOURCE_DATABASE_URL,
                           options: '-c timezone=UTC', statement_timeout: 15000,
                           application_name: 'postdeploy-check' });
    await s.connect();
    for (const t of ['payments', 'onboarding_orders', 'activation_logs']) {
      const r = await s.query(`SELECT max(created_at) m FROM ${t}`);
      const m = r.rows[0].m ? new Date(r.rows[0].m) : null;
      const lag = m ? Math.round((Date.now() - m) / 60000) : null;
      check(lag != null && lag < 30, `${t} fresh`, lag == null ? 'no rows' : `newest row ${lag} min old`);
    }
    await s.end();
  } catch (e) { check(false, 'replica reachable', e.message); }

  // ── 5b. refund exposure — the six detectors must RUN (26 Sep 2026: all six failed for a day on a bind-parameter
  //        mismatch and the page showed 0 candidates while refund mails kept arriving) ───────────────────────────
  head('5b · refund exposure (Mobile › Refund exposure)');
  try {
    const ov = await get('/api/refunds/overview?days=7', 30000);
    const o = json(ov);
    check(ov.code === 200 && !!o && Array.isArray(o.detectors), 'overview answers', `HTTP ${ov.code} in ${ov.ms}ms`);
    if (o && Array.isArray(o.detectors)) {
      const lr = o.last_run || {};
      if (!lr.at) note('no detector run recorded yet', 'the first tick runs 40 s after boot, then every ' + (o.tick_min || 15) + ' min — re-run this check in a minute');
      else {
        const ageMin = Math.round((Date.now() - new Date(lr.at)) / 60000);
        check(ageMin <= 3 * (o.tick_min || 15), 'detectors ran recently', `last run ${ageMin} min ago · ${lr.found} found · ${lr.ms} ms`);
        for (const d of o.detectors) check(d.ok, `detector ${d.kind}`, d.ok ? `${d.ms == null ? '' : d.ms + ' ms'}` : 'ERROR: ' + d.error);
      }
      const L = o.ledger || {};
      (L.available ? check : (l, d) => note(l, d))(true, 'proxycms refund register in the replica',
        L.available ? `refunds table present · ${L.n} refund(s) in the last 7 days · ${L.fail_n || 0} failed at the gateway` : 'refunds / refund_reasons / admin_users arrive with the next prod-sync tick (PROD_SYNC_INTERVAL_MIN)');
      if (o.open) note('open candidates now', `${o.open.open} · ${Number(o.open.sar || 0).toFixed(2)} SAR · ${o.open.new_24h} new in 24 h`);
    }
  } catch (e) { check(false, 'refund exposure reachable', e.message); }

  // ── 5c. refund desks — WHO handles refunds (26 Sep 2026: alpha.100's approver fallback mailed batch #1 to the
  //        Fixed/Sigma people; since alpha.102 the request goes ONLY to the approvers typed on the desk) ────────
  head('5c · refund desks (Settings › Teams › Refund desks)');
  try {
    const dv = await get('/api/refunds/desk', 30000);
    const d = json(dv);
    check(dv.code === 200 && !!d && Array.isArray(d.desks), 'desk status answers', `HTTP ${dv.code} in ${dv.ms}ms`);
    if (d && Array.isArray(d.desks)) {
      for (const k of d.desks) {
        const appr = k.approvers_effective || [], warn = (k.warnings || []).map(w => w.code);
        const line = `team ${k.team_info ? k.team_info.name : k.team + ' (MISSING)'} · approvers ${appr.length ? appr.join(', ') : 'NONE'} · cc ${(k.cc_effective || []).length} · ticket ${k.ticket_severity} · SLA ${k.approve_within_h} h / ${k.refund_within_h} h · mode ${k.mode}${k.saved ? '' : ' · defaults (never saved)'}`;
        if (!k.ready) note(`${k.label}: planned`, line);
        else (appr.length ? check : (l, t) => note(l, t))(true, `${k.label}: approvers defined`, line);
        for (const w of (k.warnings || [])) if (w.code !== 'not_ready' && w.code !== 'disabled') note(`${k.label}: ${w.code}`, w.text);
        if (k.ready && k.sla && k.sla.approval) note(`${k.label}: SLA clocks`, `decision ${k.sla.approval.waiting} waiting · ${k.sla.approval.overdue} overdue · execution ${k.sla.execution.waiting} waiting · ${k.sla.execution.overdue} overdue`);
        if (warn.includes('cross_business') || warn.includes('cross_business_cc') || warn.includes('cross_business_team')) check(false, `${k.label}: no address of the other business`, 'see the warnings above — remove them on the desk');
      }
      const rules = d.rules || [];
      for (const key of ['refund_approval_overdue', 'refund_execution_overdue']) { const r = rules.find(x => x.key === key); check(!!r, `rule ${key} seeded`, r ? `${r.severity} → ${r.team}${r.enabled ? '' : ' (disabled)'}` : 'missing — init.js seeds it at boot'); }
    }
  } catch (e) { check(false, 'refund desk reachable', e.message); }

  // ── 6. integrations that are meant to be off stay off (and say so) ───────────────
  head('6 · optional integrations');
  // "configured" is not "working". A URL pointing at an unreachable host — or still holding the
  // env.template placeholder — makes osbProbe start and fail silently every 5 min while the console
  // looks wired up. That state must read as a FAILURE, not a pass.
  const osb = json(await get('/api/osb/status'));

  // STALE PROCESS ENV: `pm2 restart` REUSES the saved environment — it does NOT re-read .env.
  // Only `pm2 delete` + `pm2 start ecosystem.prod.config.js` reloads it (which is why deploy.sh
  // does delete+start). Symptom: this shell has the new value, the running app does not. Catching
  // it here turns a baffling "I changed it and nothing happened" into one line.
  const shellHasOsb = !!(process.env.OSB_LOG_URL || process.env.OSB_DB_HOST);
  if (osb && shellHasOsb && !osb.configured) {
    check(false, 'running process has the CURRENT .env',
      'this shell has OSB_LOG_URL but the app does not — pm2 restart reuses the old environment. '
      + 'Fix: cd /apps/console && pm2 delete salam-console && pm2 start ecosystem.prod.config.js && pm2 save');
  } else if (osb && !shellHasOsb && osb.configured) {
    note('app has config this shell does not', 'you may have sourced a different .env than the app booted with');
  } else if (osb) {
    check(true, 'running process has the CURRENT .env', 'app env matches this shell');
  }

  if (!osb) note('OSB status endpoint unavailable', 'older build? redeploy to get the live ping');
  else if (!osb.configured)
    note('OSB read-path feed NOT configured', 'read-path 1500 / OSB-382000 invisible until OSB_LOG_URL is set — expected while the SOC ticket is open');
  else
    check(osb.ok === true, 'OSB read-path feed (logs.uil_logs) reachable',
          osb.ok ? `connected to ${osb.target}`
                 : `CONFIGURED BUT UNREACHABLE (${osb.target}) — ${osb.error || 'no error text'}. `
                   + 'Either fix connectivity/credentials or unset OSB_LOG_URL; half-configured is worse than off.');

  // ── 7. what the console can and cannot see ───────────────────────────────────────
  // Answers "are we getting all the logs?" honestly. A blind spot you know about is a gap;
  // a blind spot you don't is a false sense of coverage — which is what INC0016809 exposed.
  head('7 · data source coverage (what we can see — and what we cannot)');
  const TABLES = ['plans','sellers','settings','versions','channels','plan_channels',
    'onboarding_orders','checkouts','payments','activation_logs','eligibility_logs',
    'nafath_logs','change_plan_logs','delivery_requests','seller_deductions'];
  try {
    const s = new Client({ connectionString: process.env.SOURCE_DATABASE_URL,
                           options: '-c timezone=UTC', statement_timeout: 20000,
                           application_name: 'postdeploy-check' });
    await s.connect();
    const present = (await s.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1)`, [TABLES])).rows.map(r => r.table_name);
    const absent = TABLES.filter(t => !present.includes(t));
    check(absent.length === 0, `replica: all ${TABLES.length} synced tables present`,
          absent.length ? 'MISSING: ' + absent.join(', ') : present.length + ' tables');
    await s.end();
  } catch (e) { check(false, 'replica table inventory', e.message); }

  // Report what the RUNNING APP has, not what this shell has — they differ when .env was edited
  // without a delete+start, and reporting the shell's view would paper over exactly that bug.
  const feeds = [
    ['OSB read-path log (logs.uil_logs)', !!(osb && osb.configured),
     'BSS READ 1500 / OSB-382000 — "plan details won\'t load", greyed balance transfer'],
    ['ServiceNow ticket correlation', !!(process.env.SN_URL && process.env.SN_USER && process.env.SN_PASS),
     'links console alerts to the matching INC ticket'],
    ['Tap gateway reconciliation', !!process.env.TAP_SECRET_KEY,
     'CONFIRMS duplicate charges — without it duplicates stay "suspected"'],
    ['Yusr assistant (Ollama)', !!process.env.OLLAMA_URL, 'on-prem LLM for the in-console assistant'],
  ];
  for (const [name, on, what] of feeds)
    console.log(`  ${on ? C.g(' ON ') : C.y('OFF ')}  ${name}${on ? '' : C.d('  — blind to: ' + what)}`);

  // The APIGW probe needs NO credentials and runs on built-in targets — APIGW_TARGETS only
  // overrides the list, so testing the env var reports "off" for something that is actually on.
  // Ask the running app instead of inferring.
  const gw = json(await get('/api/apigw/connectivity', 30000));
  if (!gw || !Array.isArray(gw.targets || gw.results)) {
    console.log(`  ${C.y('OFF ')}  API Gateway TCP probe` + C.d('  — endpoint returned nothing'));
  } else {
    const rows = gw.targets || gw.results;
    const ok = rows.filter(r => r.state === 'ok').length;
    const onTimer = process.env.APIGW_PROBE_AUTO !== '0';
    console.log(`  ${ok ? C.g(' ON ') : C.y('WARN')}  API Gateway TCP probe` +
      C.d(`  — ${ok}/${rows.length} nodes reachable, background timer ${onTimer ? 'on' : 'OFF (APIGW_PROBE_AUTO=0)'}`));
    for (const r of rows)
      console.log(`        ${r.state === 'ok' ? C.g('ok     ') : C.y(String(r.state).padEnd(7))} ` +
                  C.d(`${r.label} ${r.host}:${r.port}${r.ms != null ? '  ' + r.ms + 'ms' : ''}`));
  }

  console.log('\n  ' + C.d('NOT INGESTED AT ALL (no code path — these live only on their own systems):'));
  for (const x of ['BSS / Oracle BRM application logs', 'OSB / WebLogic server logs',
                   'nginx + PM2 + app stdout on this host', 'Semati / TCC provider-side logs',
                   'firewall & SOC logs', 'UPG / HyperPay gateway-side logs',
                   'Grafana metrics (grafana.salammobile.sa)'])
    console.log('    ' + C.d('· ' + x));
  console.log('  ' + C.d('The console sees the digital channel\'s OWN database, plus the optional feeds above.'));

  await c.end();

  // ── verdict ──────────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(56));
  console.log(fail === 0
    ? C.g(`  ✓ ${pass} checks passed — deploy verified`)
    : C.r(`  ✗ ${fail} FAILED, ${pass} passed — do not walk away`));
  console.log('═'.repeat(56) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(C.r('check aborted: ' + e.message)); process.exit(2); });
