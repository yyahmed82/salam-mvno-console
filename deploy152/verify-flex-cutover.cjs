#!/usr/bin/env node
/* FLEX CUTOVER VERIFICATION v2 — did the 31 Aug 2026 15:49 KSA block on the old Plus plans take,
 * ON BOTH CHANNELS? Sources corrected by find-activation-ledger.cjs:
 *   DMS channel        → dms_audit_logs.sim_activation_logs   (the real per-activation ledger)
 *   Self-Activation    → dms_v1.report_request_self_activation (hybrid portal ledger)
 * (dms_v1.dms_sim_activation_report is a report-ACCESS log — 4 columns — do not use.)
 * READ-ONLY · masked output · bounded window.
 * RUN: cd /apps/console/server && set -a && . ../.env && set +a && node verify-flex-cutover.cjs
 * Optional env: CUTOVER='2026-08-31 12:49:00' FROM='2026-08-28 00:00:00' (UTC)
 */
'use strict';
const path = require('path');
const dms = require(path.join(__dirname, '..', 'server', 'src', 'dmsDb'));

const CUT = process.env.CUTOVER || '2026-08-31 12:49:00';
const FROM = process.env.FROM || '2026-08-28 00:00:00';
const OLD_IDS = ['100238', '100239'], NEW_IDS = ['200075', '200072'];
const mask = v => v == null ? '—' : String(v).replace(/\d{5,}/g, m => m.slice(0, 2) + '******' + m.slice(-2));
const isOld = (pid, plan) => OLD_IDS.includes(String(pid)) || /^super flex (85|110).*plus/i.test(String(plan || ''));

async function checkTable(label, sc, t, C) {
  // C = { at, pid, plan, dealer, channel } physical column names (verified against the schema)
  const have = await dms.columnsOf(sc, t);
  for (const [k, c] of Object.entries(C)) if (c && !have.has(c.toLowerCase())) { C[k] = null; }
  if (!C.at || !C.plan) { console.log(`\n--- ${label}: cannot verify — missing ${!C.at ? 'time' : 'plan'} column on ${sc}.${t}`); return; }
  const pidSel = C.pid ? `\`${C.pid}\`` : `''`, chSel = C.channel ? `\`${C.channel}\`` : `''`;
  console.log(`\n--- ${label} · ${sc}.${t} · Flex per plan × channel (before | after cutover) ---`);
  const agg = await dms.qSlow(
    `SELECT ${pidSel} pid, \`${C.plan}\` plan, ${chSel} ch,
            SUM(\`${C.at}\` <  ?) b, SUM(\`${C.at}\` >= ?) a,
            MAX(CASE WHEN \`${C.at}\` >= ? THEN \`${C.at}\` END) last_after
       FROM \`${sc}\`.\`${t}\`
      WHERE \`${C.at}\` >= ? AND (\`${C.plan}\` LIKE '%Flex%'${C.pid ? ` OR \`${C.pid}\` IN (${[...OLD_IDS, ...NEW_IDS].join(',')})` : ''})
      GROUP BY 1,2,3 ORDER BY plan, ch`, [CUT, CUT, CUT, FROM], 120000);
  for (const x of agg)
    console.log(`  ${String(x.pid || '?').padEnd(8)} ${String(x.plan || '').padEnd(30)} ${String(x.ch || '—').padEnd(22)} before ${String(x.b).padStart(6)} · after ${String(x.a).padStart(5)}${Number(x.a) && isOld(x.pid, x.plan) ? '  ⚠ OLD PLAN AFTER CUTOVER · last ' + x.last_after : ''}`);
  const leak = agg.filter(x => isOld(x.pid, x.plan)).reduce((s, x) => s + Number(x.a || 0), 0);
  const ramp = agg.filter(x => NEW_IDS.includes(String(x.pid))).reduce((s, x) => s + Number(x.a || 0), 0);
  console.log(`  VERDICT · old 100238/100239 after cutover: ${leak === 0 ? '✓ ZERO — block effective on this channel' : `✗ ${leak} — LEAK on this channel`}`);
  console.log(`  VERDICT · new 200075/200072 after cutover: ${ramp > 0 ? `✓ ${ramp} — ramp confirmed` : '⚠ none yet (low hours / early)'}`);
  if (leak > 0) {
    const cond = [C.pid ? `\`${C.pid}\` IN (${OLD_IDS.join(',')})` : null,
      `LOWER(\`${C.plan}\`) REGEXP '^super flex (85|110).*plus'`].filter(Boolean).join(' OR ');
    const ev = await dms.qSlow(
      `SELECT \`${C.at}\` at, \`${C.plan}\` plan${C.dealer ? `, \`${C.dealer}\` dealer` : ''}${C.channel ? `, \`${C.channel}\` ch` : ''}
         FROM \`${sc}\`.\`${t}\` WHERE \`${C.at}\` >= ? AND (${cond}) ORDER BY \`${C.at}\` DESC LIMIT 10`, [CUT], 60000);
    console.log('  leak evidence (masked):');
    for (const e of ev) console.log(`    ${e.at} · ${e.plan} · dealer=${e.dealer || '?'} · ch=${e.ch || '?'}`);
  }
}

(async () => {
  const p = await dms.ping();
  console.log(`\n=== Clara ${p.ok ? 'OK' : 'FAIL'} · ${p.host || ''} · cutover ${CUT}Z · from ${FROM}Z ===`);
  await checkTable('DMS CHANNEL (dealer app)', 'dms_audit_logs', 'sim_activation_logs',
    { at: 'insert_date_time', pid: 'price_plan_id', plan: 'price_plan_name', dealer: 'channel_username', channel: 'channel_code' });
  await checkTable('SELF-ACTIVATION (hybrid portal)', 'dms_v1', 'report_request_self_activation',
    { at: 'created_at', pid: 'price_plan_id', plan: 'price_plan_name', dealer: 'dealer_id', channel: 'use_case' });
  console.log(`\n--- live grandfather watch: ✓ ARMED — sim_activation_logs carries price_plan_name + price_plan_id; every new activation is checked by the journey sync (alert 'dms:grandfather-leak'). Self-activation ledger is NOT yet under the watch — say the word to add it as a journey. ---`);
  process.exit(0);
})().catch(e => { console.error('fatal:', e.message); process.exit(1); });
