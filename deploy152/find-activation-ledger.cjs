#!/usr/bin/env node
/* FIND THE REAL ACTIVATION LEDGER — dms_v1.dms_sim_activation_report turned out to be a
 * report-ACCESS log (id/username/channel/insert_date only). The mail's commission list
 * (mobile_number, channel_username, customer_id, commission, iccid, price_plan_name/price,
 * commission_amount) comes from somewhere else. This finds where, deterministically.
 * READ-ONLY: information_schema + 2 masked sample rows per candidate.
 * RUN: cd /apps/console/server && set -a && . ../.env && set +a && node find-activation-ledger.cjs
 */
'use strict';
const path = require('path');
const dms = require(path.join(__dirname, '..', 'server', 'src', 'dmsDb'));
const mask = v => v == null ? v : String(v).slice(0, 60).replace(/\d{5,}/g, m => m.slice(0, 2) + '******' + m.slice(-2));

(async () => {
  const p = await dms.ping();
  console.log(`\n=== Clara ${p.ok ? 'OK' : 'FAIL'} · ${p.host || ''} ===\n`);

  // 1. FULL column lists of the two key tables (earlier discovery truncated them)
  for (const [sc, t] of [['dms_audit_logs', 'sim_activation_logs'], ['dms_v1', 'dms_sim_activation_report']]) {
    const cols = await dms.q(
      `SELECT column_name c, data_type dt FROM information_schema.columns
        WHERE table_schema=? AND table_name=? ORDER BY ordinal_position`, [sc, t]).catch(() => []);
    console.log(`--- ${sc}.${t} · ${cols.length} columns ---`);
    console.log('  ' + cols.map(x => `${x.c || x.C}:${x.dt || x.DT}`).join(', ') + '\n');
  }

  // 2. which tables carry the mail's signature columns?
  const SIG = ['price_plan_name', 'price_plan_id', 'plan_name', 'price_plan_price', 'plan_price',
    'commission_amount', 'comission_amount', 'commission', 'sim_iccid_number', 'iccid_number', 'channel_username'];
  const hits = await dms.qSlow(
    `SELECT c.table_schema sc, c.table_name t,
            GROUP_CONCAT(c.column_name ORDER BY c.column_name) matched,
            COUNT(*) n_matched, MAX(tb.table_rows) rws
       FROM information_schema.columns c
       JOIN information_schema.tables tb
         ON tb.table_schema=c.table_schema AND tb.table_name=c.table_name
      WHERE c.column_name IN (${SIG.map(() => '?').join(',')})
        AND c.table_schema NOT IN ('information_schema','mysql','performance_schema','sys')
      GROUP BY 1,2 ORDER BY n_matched DESC, rws DESC LIMIT 25`, SIG, 30000);
  console.log('--- tables carrying the commission-list signature columns (best match first) ---');
  for (const h of hits)
    console.log(`  ${String(h.n_matched).padStart(2)}/11 · ${h.sc}.${h.t} · ~${Number(h.rws || 0).toLocaleString()} rows · [${h.matched}]`);

  // 3. masked sample from the top 3 candidates with >1000 rows
  for (const h of hits.filter(x => Number(x.rws || 0) > 1000).slice(0, 3)) {
    const cols = await dms.columnsOf(h.sc, h.t);
    const order = cols.has('id') ? 'ORDER BY id DESC' : '';
    const rows = await dms.qSlow(`SELECT * FROM \`${h.sc}\`.\`${h.t}\` ${order} LIMIT 2`, [], 20000).catch(e => null);
    if (!rows) { console.log(`\n--- ${h.sc}.${h.t}: sample failed`); continue; }
    console.log(`\n--- sample · ${h.sc}.${h.t} (masked) ---`);
    for (const r of rows) console.log('  ' + JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, mask(v)]))).slice(0, 600));
  }
  console.log('\nDone — paste this back; commission report + flex verification + grandfather watch get repointed to the real ledger.');
  process.exit(0);
})().catch(e => { console.error('fatal:', e.message); process.exit(1); });
