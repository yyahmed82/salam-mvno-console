#!/usr/bin/env node
/* CLI:  node src/cli.js <command>
 *   init [--reset]         create console schema + seed rules
 *   sync [iso]             one metrics sync (+alerts) at iso or now
 *   simulate [stepH] [steps]   replay historical data as live traffic
 *   bounds                 print source data time bounds
 *   rollups --days N       rebuild rollup_hourly for the last N days (default 7, max 400) so the
 *                          journey failures in that window carry err_class and a class-filtered SLO
 *                          can measure them. Idempotent: the window is deleted and re-inserted.
 *   testmail <rule-key> <email>   simulate ONE rule firing (Mobile or Fixed) and mail the digest + PDF
 *                          to that address only — the way to verify the alert mail on a server
 *   vendor-sla-mail-test --to <email> [--contract <id>] [--matrix] [--all-items]
 *                          send TEST-ONLY vendor contract SLA escalation mail samples to that address only
 */
/* ENVIRONMENT (20 Sep 2026) — cli.js is run BY HAND from a shell, where PM2's environment does not
 * exist. db.js reads its URLs at module load, so every command fell back to the docker-compose
 * default and died with `getaddrinfo ENOTFOUND db` — the rollups rebuild skipped all nine journeys
 * and then threw. Load the app's own .env first, the way sql.cjs does: PARSED IN NODE, never
 * `set -a; . .env`, which makes the shell evaluate values carrying spaces and angle brackets (that
 * pattern has broken a cron on this box). An already-exported variable still wins, so a one-off
 * override on the command line keeps working. Must run BEFORE require('./db'). */
(function loadAppEnv() {
  const fs = require('fs'), path = require('path');
  const file = [process.env.ENV_FILE, path.join(__dirname, '..', '..', '.env'),
    '/apps/unified/.env', '/apps/console/.env', path.join(process.cwd(), '.env')]
    .filter(Boolean).find(p => { try { fs.accessSync(p); return true; } catch (_) { return false; } });
  if (!file) return;
  let txt = ''; try { txt = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
  let n = 0;
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) { process.env[m[1]] = v; n++; }
  }
  console.error(`[cli] environment: ${n} key(s) from ${file}`);
})();
const db = require('./db');
const { init } = require('./init');
const { syncOnce } = require('./sync');
const { runAlerts } = require('./alertRunner');
const { simulate, dataBounds } = require('./simulate');
const { indexSource } = require('./indexSource');

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === 'init') {
      const r = await init({ reset: args.includes('--reset') });
      console.log(`init: ${r.metrics} metrics, ${r.rules} rules seeded`);
    } else if (cmd === 'admin') {
      const email = (args[0] || '').toLowerCase();
      if (!email) { console.log('usage: node src/cli.js admin <email@salam.sa>'); }
      else {
        await db.console.query(
          `INSERT INTO console_users (email,name,role,team) VALUES ($1,$2,'super_admin','Digital Ops')
           ON CONFLICT (email) DO UPDATE SET role='super_admin', enabled=true`,
          [email, email.split('@')[0]]);
        console.log(`super admin ready: ${email}`);
      }
    } else if (cmd === 'index') {
      const ix = await indexSource();
      console.log(`source indexes: ${ix.made} ok, ${ix.skipped} skipped`);
    } else if (cmd === 'rollups') {
      /* CLASS BACKFILL (20 Sep 2026) — rollup_hourly gained err_class, but only rows refreshed
       * since carry it; older failures read as UNCLASSIFIED and a class-filtered SLO refuses to
       * answer rather than under-count. This re-reads the source tables for the window and rewrites
       * it with the class. Cost is a full scan of each journey's source over the range, so pick the
       * window deliberately — 7 days is cheap, 400 is not. */
      const i = args.indexOf('--days');
      const days = Math.min(400, Math.max(1, Number(i >= 0 ? args[i + 1] : 7) || 7));
      const to = new Date(), from = new Date(to.getTime() - days * 86400e3);
      console.log(`rebuilding rollup_hourly ${from.toISOString()} → ${to.toISOString()} (${days} day(s))…`);
      const t0 = Date.now();
      const r = await require('./rollups').refresh(from.toISOString(), to.toISOString());
      const left = (await db.console.query(
        `SELECT coalesce(sum(cnt),0)::bigint n FROM rollup_hourly WHERE outcome='fail' AND err_class='' AND hour >= $1`,
        [from.toISOString()])).rows[0].n;
      const wrote = (r && r.rows) || 0;
      console.log(`rollups: ${wrote} row(s) written in ${Math.round((Date.now() - t0) / 1000)}s · ${Number(left).toLocaleString('en-US')} failure(s) still unclassified in the window`);
      if (!wrote) { console.error('✗ NOTHING was written — every journey was skipped. The [ROLLUP] lines above say why; a connection error there means this process could not reach the source database.'); process.exitCode = 1; }
      if (Number(left) > 0) console.log('  (journeys whose source table carries no class signal keep \'\' — that is expected, not a gap)');
    } else if (cmd === 'bounds') {
      console.log(await dataBounds());
    } else if (cmd === 'sync') {
      const when = args[0] ? new Date(args[0]) : new Date();
      const s = await syncOnce(when);
      const a = await runAlerts(when);
      console.log(`sync @ ${when.toISOString()}: ${s.written} snapshots, +${a.opened} opened, ${a.resolved} resolved, ${a.updated} updated`);
    } else if (cmd === 'simulate') {
      const stepHours = Number(args[0] || 3);
      const steps = Number(args[1] || 56);
      let opened = 0, resolved = 0;
      const out = await simulate({ stepHours, steps, onTick: t => {
        opened += t.opened; resolved += t.resolved;
        if (t.opened || t.resolved) console.log(`  ${t.sim_now}  +${t.opened} / -${t.resolved}`);
      }});
      console.log(`simulate ${out.from} → ${out.to} (${out.ticks} ticks @ ${stepHours}h): ${opened} alerts opened, ${resolved} resolved`);
    } else if (cmd === 'synchealth') {
      // node src/cli.js synchealth [email]  — the Sync Health report now; to ONE address if given, else the mail_report list
      const o = await require('./syncHealth').send(undefined, args[0] ? { to: args[0] } : {});
      console.log(`${o.subject}\n${o.sent ? 'sent → ' + (o.recipients || []).join(', ') : 'not sent — ' + (o.error || o.reason || o.dev && 'no SMTP')}`);
    } else if (cmd === 'healthcheck') {
      // node src/cli.js healthcheck [--always] [--print]  — the prod-safety probes, printed; mailed per policy / forced
      const o = await require('./prodHealth').run({ always: args.includes('--always'), printOnly: args.includes('--print') });
      console.log('\n' + o.body + '\n');
      console.log(o.mailed ? `[healthcheck] mailed → ${o.recipients.join(', ')}` : `[healthcheck] not mailed — ${o.mailError || o.reason || 'print only'}`);
    } else if (cmd === 'testmail') {
      const [fire, to] = args;
      if (!fire || !to) throw new Error('usage: testmail <rule-key|metric-key> <email>');
      const { evaluate } = require('./alertRunner');
      const notify = require('./notify');
      // evaluate at the last sync point so every other row shows its real value
      const last = (await db.console.query(`SELECT sim_now FROM sync_runs ORDER BY id DESC LIMIT 1`).catch(() => ({ rows: [] }))).rows[0];
      const when = last && last.sim_now ? new Date(last.sim_now) : new Date();
      const { evals } = await evaluate(when);
      const ev = evals.find(e => e.key === fire) || evals.find(e => e.metric_key === fire);
      if (!ev) throw new Error(`no enabled rule matches "${fire}" — keys: ${evals.map(e => e.key).join(', ')}`);
      ev.fired = true; ev.simulated = true;
      const out = await notify.sendAlertDigest(when, evals, { to, segment: require('./segment').segOf(ev) });   // only the side the rule belongs to
      console.log(JSON.stringify({ sent: out.sent, dev: out.dev, error: out.error, reason: out.reason, subject: out.subject,
        recipients: out.recipients, attachments: out.attachments, reportNotes: out.reportNotes, segment: ev.segment }, null, 1));
    } else if (cmd === 'vendor-sla-mail-test' || cmd === 'vendor-contract-mail-test') {
      await require('./vendorContractMail').cli(args);
    } else {
      console.log('commands: init [--reset] | admin <email> | index | sync [iso] | simulate [stepH] [steps] | bounds | healthcheck [--always|--print] | synchealth [email] | testmail <rule-key> <email> | vendor-sla-mail-test --to <email> [--contract <id>] [--matrix] [--all-items] [--dry-run]');
    }
  } finally {
    await db.source.end().catch(() => {});
    await db.console.end().catch(() => {});
  }
}
main().catch(e => { console.error(e); process.exit(1); });
