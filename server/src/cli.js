#!/usr/bin/env node
/* CLI:  node src/cli.js <command>
 *   init [--reset]         create console schema + seed rules
 *   sync [iso]             one metrics sync (+alerts) at iso or now
 *   simulate [stepH] [steps]   replay historical data as live traffic
 *   bounds                 print source data time bounds
 *   testmail <rule-key> <email>   simulate ONE rule firing (Mobile or Fixed) and mail the digest + PDF
 *                          to that address only — the way to verify the alert mail on a server
 */
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
    } else {
      console.log('commands: init [--reset] | admin <email> | index | sync [iso] | simulate [stepH] [steps] | bounds | healthcheck [--always|--print] | synchealth [email] | testmail <rule-key> <email>');
    }
  } finally {
    await db.source.end().catch(() => {});
    await db.console.end().catch(() => {});
  }
}
main().catch(e => { console.error(e); process.exit(1); });
