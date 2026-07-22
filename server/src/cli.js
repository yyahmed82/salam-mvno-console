#!/usr/bin/env node
/* CLI:  node src/cli.js <command>
 *   init [--reset]         create console schema + seed rules
 *   sync [iso]             one metrics sync (+alerts) at iso or now
 *   simulate [stepH] [steps]   replay historical data as live traffic
 *   bounds                 print source data time bounds
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
    } else {
      console.log('commands: init [--reset] | admin <email> | index | sync [iso] | simulate [stepH] [steps] | bounds');
    }
  } finally {
    await db.source.end().catch(() => {});
    await db.console.end().catch(() => {});
  }
}
main().catch(e => { console.error(e); process.exit(1); });
