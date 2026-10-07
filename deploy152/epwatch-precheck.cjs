#!/usr/bin/env node
/* epwatch-precheck.cjs — BEFORE deploying alpha.144 (Fixed › Payments watch): what the new nexus reads cost on the
 * production database, and which of the 9 new alert rules will fire on the first tick after the restart.
 * Read-only: one connection of the console's nexus RO pool, the same statements the page and the alert metrics run.
 * Prints counts only (no customer data).
 *
 * On 152, with the new module copied next to a symlink of the live db.js:
 *   mkdir -p /tmp/epw/src && cp /tmp/fixedEpWatch.js /tmp/epw/src/ && ln -sf /apps/unified/server/src/db.js /tmp/epw/src/db.js
 *   cd /apps/unified/server && node /tmp/epw/epwatch-precheck.cjs
 * Env overrides (sandbox): ENV_FILE, APP_SRC (dir of the live db.js), EPW_SRC (dir of fixedEpWatch.js). */
'use strict';
process.env.TZ = 'UTC';
const fs = require('fs'), path = require('path');
const ENV_FILE = process.env.ENV_FILE || '/apps/unified/.env';
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line); if (!m) continue;
  let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (process.env[m[1]] === undefined) process.env[m[1]] = v;
}
const APP_SRC = process.env.APP_SRC || '/apps/unified/server/src';
const EPW_SRC = process.env.EPW_SRC || '/tmp/epw/src';
const db = require(path.join(APP_SRC, 'db.js'));
if (!db.nexus) { console.log('nexus pool not configured on this box (NEXUS_DATABASE_URL) — the page will say "not configured", nothing to measure'); process.exit(0); }

/* time every statement the module sends on its nexus client */
const times = [];
const origConnect = db.nexus.connect.bind(db.nexus);
db.nexus.connect = async (...a) => {
  const c = await origConnect(...a);
  if (!c.__timed) { const oq = c.query.bind(c); c.query = async (q, p) => { const t = Date.now(); try { return await oq(q, p); } finally { times.push([Date.now() - t, String((q && q.text) || q).replace(/\s+/g, ' ').trim().slice(0, 96)]); } }; c.__timed = true; }
  return c;
};
const epw = require(path.join(EPW_SRC, 'fixedEpWatch.js'));
/* the seeded rules (seedRules.js EPW) — severity, threshold, min sample */
const RULES = {
  fixed_ep5g_paid_no_bss_order: ['P2', 1], fixed_ep5g_naqeel_fail_charged: ['P1', 1], fixed_ep5g_rto_refund_missing: ['P1', 1],
  fixed_ep5g_paid_stopped: ['P2', 1], fixed_ep5g_lock_leak: ['P3', 5], fixed_ep_auth_stuck: ['P2', 1],
  fixed_ep_ftth_paid_no_order: ['P2 · seeded OFF', 1], fixed_ep_webhook_fail: ['P2', 3], fixed_ep5g_location_stop_rate: ['P3', 0.8, 10]
};
const print = () => { for (const [ms, q] of times) console.log(`${String(ms).padStart(7)} ms  ${q}`); times.length = 0; };

(async () => {
  const t0 = Date.now();
  const s = await epw.snapshot(30);
  console.log(`=== 30-day snapshot (the page and the alert metrics, refreshed at most every 10 min): ${Date.now() - t0} ms in total, ${s.warnings.length} warning(s)`);
  print();
  for (const w of s.warnings) console.log('  WARNING ' + String(w).slice(0, 200));
  console.log('\n=== what Payments watch will show (counts only)');
  console.log(`5G e-purchase journeys, 30 d: ${s.fiveG.total} · paid journeys by class: ${JSON.stringify(s.fiveG.byCls)}`);
  console.log(`stock locks never released: ${s.locks.leakedTotal} · card holds (AUTHORIZED, journey expired > 60 min): ${s.holds.rows.length}`);
  console.log(`FTTH charged before the order, no later order: ${s.ftth.summary.no_later_charged} (≈ ${s.ftth.summary.sar_no_later} SAR) of ${s.ftth.summary.total} · retried later: ${s.ftth.summary.retried}`);
  console.log(`payment webhooks failed in 24 h per source: ${s.webhooks.sources.map(x => `${x.source} ${x.failed_24h}`).join(' · ') || 'none'}`);

  console.log('\n=== the 9 new rules on the FIRST alert tick after the restart (≈ 1–3 min after the deploy)');
  const t1 = Date.now();
  for (const [k, m] of Object.entries(epw.METRICS)) {
    const rows = await m.compute(); const r = rows[0] || {}; const [sev, thr, minS] = RULES[k] || ['?', Infinity];
    const off = /OFF/.test(sev); const fires = !off && r.value != null && r.value >= thr && (!minS || (r.sample || 0) >= minS);
    console.log(`${off ? 'off   ' : fires ? 'FIRES ' : 'quiet '} ${sev.padEnd(16)} ${k.padEnd(32)} value ${r.value == null ? '—' : r.value} · sample ${r.sample == null ? '—' : r.sample}`);
  }
  console.log(`(the alert metrics reused the snapshot; the 60-s pulse took ${Date.now() - t1} ms:)`); print();

  console.log('\n=== the nexus tables behind it');
  const c = await db.nexus.connect();
  try {
    const t = (await c.query(`SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size, n_live_tup::bigint AS live_rows, seq_scan, idx_scan
        FROM pg_stat_user_tables WHERE relname IN ('workflow_states','api_logs','epurchase_payments','epurchase_5g_locks','webhook_requests') ORDER BY pg_total_relation_size(relid) DESC`)).rows;
    for (const r of t) console.log(`${r.relname.padEnd(20)} ${String(r.size).padStart(9)} · ${String(r.live_rows).padStart(10)} rows · seq scans ${r.seq_scan} · index scans ${r.idx_scan}`);
    const ix = (await c.query(`SELECT tablename, indexname, regexp_replace(indexdef, '^.* USING ', '') AS def FROM pg_indexes
        WHERE tablename IN ('workflow_states','api_logs','epurchase_payments','epurchase_5g_locks','webhook_requests') ORDER BY 1, 2`)).rows;
    for (const r of ix) console.log(`  ${r.tablename.padEnd(20)} ${r.indexname.padEnd(44)} ${r.def}`);
  } finally { c.release(); }
  times.length = 0;
  await db.nexus.end().catch(() => {});
  process.exit(0);
})().catch(e => { console.error('precheck failed: ' + e.message); process.exit(1); });
