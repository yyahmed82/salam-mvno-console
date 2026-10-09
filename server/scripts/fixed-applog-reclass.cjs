/* fixed-applog-reclass.cjs — give the failed app steps already stored the class of their own error line (alpha.162).
 *
 *   node /apps/unified/server/scripts/fixed-applog-reclass.cjs [--days 30] [--dry]
 *
 * The collector pairs every new "mutation <step> fail Nms" line with the tRPC error line of the same request id
 * (fixedAppLogCollector.pairRows / pairFailures). This applies the same pairing to the history kept in
 * unified_console.fixed_app_events (30 days), one day at a time, so the Troubleshoot lane, the alert evidence and the
 * thresholds all read the same classification. --dry counts what would change and writes nothing.
 * Safe to run twice: a paired line no longer starts with "mutation …" and is not touched again.
 * Runs on 152 as root with the env of the running PM2 process (salam-unified) → console DB 172.31.15.121 · unified_console. */
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const dry = process.argv.includes('--dry');
const di = process.argv.indexOf('--days');
const DAYS = Math.min(60, Math.max(1, Number(di > 0 ? process.argv[di + 1] : 30) || 30));
let pid = null;
try { pid = execSync('pm2 pid salam-unified', { env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' } }).toString().trim().split('\n').pop(); } catch (e) {}
if (pid && fs.existsSync(`/proc/${pid}/environ`)) for (const kv of fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')) { const i = kv.indexOf('='); if (i > 0 && !(kv.slice(0, i) in process.env)) process.env[kv.slice(0, i)] = kv.slice(i + 1); }

(async () => {
  const db = require('../src/db');
  const col = require('../src/fixedAppLogCollector');
  console.log(`Fixed app log · pairing failed steps with their error line · last ${DAYS} days · ${dry ? 'DRY RUN' : 'writing'} · PM2 pid ${pid || '?'}`);
  const end = new Date(); end.setUTCMinutes(0, 0, 0); end.setUTCHours(end.getUTCHours() + 1);
  let tot = { business: 0, technical: 0, client: 0, other: 0 }, changed = 0;
  for (let d = DAYS; d >= 1; d--) {
    const from = new Date(end.getTime() - d * 864e5).toISOString(), to = new Date(end.getTime() - (d - 1) * 864e5).toISOString();
    if (dry) {
      const r = await db.console.query(`SELECT x.reason_class, count(*)::int n FROM (${col.PAIR_INNER}) x GROUP BY 1`, [from, to]);
      const line = r.rows.map(x => `${x.reason_class} ${x.n}`).join(' · ') || '—';
      r.rows.forEach(x => { tot[x.reason_class in tot ? x.reason_class : 'other'] += x.n; changed += x.n; });
      console.log(`  ${from.slice(0, 10)}  ${line}`);
    } else {
      const n = await col.pairFailures(from, to); changed += n;
      console.log(`  ${from.slice(0, 10)}  ${n} failed steps paired`);
    }
  }
  if (dry) console.log(`\nwould pair ${changed} failed steps: business ${tot.business} · client ${tot.client} · technical ${tot.technical} (a real 5xx / timeout behind them) · other ${tot.other}`);
  else console.log(`\nDone — ${changed} failed steps now carry the status, reason and class of their own error line.`);
  process.exit(0);
})().catch(e => { console.error('✗', e.stack || e.message); process.exit(1); });
