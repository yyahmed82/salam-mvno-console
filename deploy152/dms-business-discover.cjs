#!/usr/bin/env node
/* DMS BUSINESS DISCOVERY — one read-only pass over the Clara cluster to build the dealer-domain
 * knowledge base (31 Aug 2026, after DMS L2 clarified: UIL = APIGW; DMS = dealers, wallets,
 * commissions, journeys). Answers four questions:
 *
 *   1. What does DMS itself LOG?            → every table in dms_audit_logs (and any schema whose
 *                                              name contains audit or log): columns, size, time
 *                                              range, masked samples.
 *   2. What DEALER-DOMAIN tables exist?     → census across ALL visible schemas for wallet /
 *                                              commission / dealer / activation / stock / journey.
 *   3. How do the two channels appear?      → distinct values of channel-ish columns on the
 *                                              activation tables — DMS mobile app vs the hybrid
 *                                              self-activation portal (mobile.salammobile.sa).
 *   4. What can 152 actually REACH?         → TCP probes only (connect + close, no credentials):
 *                                              172.16.1.115:3306 (Clara VIP in the HLD),
 *                                              MaxScale 172.31.43.75 + nodes .72/.73/.74,
 *                                              App Backends 172.31.43.136–139 (22 = SSH for logs,
 *                                              8080/443 = app ports).
 *
 * READ-ONLY BY CONSTRUCTION: information_schema + SELECT ... LIMIT. Every query individually
 * caught and time-boxed; a missing grant prints as "not visible", never a crash.
 * PII: sample values are masked before printing (digits collapsed, long strings truncated).
 *
 * RUN (on 152):
 *   cd /apps/console && set -a && . ./.env && set +a && node deploy152/dms-business-discover.cjs
 * Writes dms-business-discover.out.json next to itself and prints a readable summary.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const net = require('net');
const dms = require(path.join(__dirname, '..', 'server', 'src', 'dmsDb'));

const OUT = path.join(__dirname, 'dms-business-discover.out.json');
const R = { at: new Date().toISOString(), schemas: {}, audit_logs: {}, dealer_tables: [], channels: {}, reach: [] };

/* ---- masking: never print a full MSISDN / national id / ICCID ---- */
const mask = v => {
  if (v == null) return v;
  let s = String(v);
  if (s.length > 80) s = s.slice(0, 77) + '…';
  return s.replace(/\d{5,}/g, m => m.slice(0, 2) + '*'.repeat(Math.min(6, m.length - 4)) + m.slice(-2));
};
const maskRow = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, mask(v)]));
const log = (...a) => console.log(...a);
async function safe(label, fn, fallback = null) {
  try { return await fn(); } catch (e) { log(`   ⚠ ${label}: ${e.message.slice(0, 120)}`); return fallback; }
}

/* ---- 4. reachability — pure TCP, 2.5s, no payload ---- */
function probe(host, port, label) {
  return new Promise(res => {
    const t0 = Date.now(); const s = new net.Socket(); let done = false;
    const end = ok => { if (done) return; done = true; try { s.destroy(); } catch (_) {}
      res({ host, port, label, ok, ms: Date.now() - t0 }); };
    s.setTimeout(2500, () => end(false));
    s.once('error', () => end(false));
    s.connect(port, host, () => end(true));
  });
}

async function main() {
  if (!dms.configured()) { log('DMS DB not configured — load /apps/console/.env first.'); process.exit(1); }
  const p = await dms.ping();
  log(`\n=== Clara connection: ${p.ok ? 'OK' : 'FAIL'} · node ${p.host || '?'} · ${p.ms}ms · target ${p.target}${p.galera ? ' · Galera size ' + p.galera.wsrep_cluster_size : ''}\n`);

  /* ---- 1+2. schema census ---- */
  const schemas = await safe('schemata', () => dms.q(
    `SELECT schema_name s FROM information_schema.schemata
      WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys') ORDER BY 1`), []);
  const DEALER_RX = /(wallet|commission|comission|dealer|channel|activat|topup|top_up|balanc|stock|sim|order|journey|milestone|payout|refill|pos_|terminal)/i;

  for (const row of schemas) {
    const sc = row.s || row.S || row.schema_name;
    const tabs = await safe(`tables of ${sc}`, () => dms.q(
      `SELECT table_name t, table_rows rws, round((data_length+index_length)/1048576) mb
         FROM information_schema.tables WHERE table_schema=? ORDER BY table_rows DESC`, [sc]), []);
    R.schemas[sc] = tabs.map(x => ({ t: x.t || x.T, rows: Number(x.rws || 0), mb: Number(x.mb || 0) }));
    log(`schema ${sc} — ${tabs.length} tables`);
    for (const t of R.schemas[sc])
      if (DEALER_RX.test(t.t)) R.dealer_tables.push({ schema: sc, ...t });
  }

  /* ---- 1. dms_audit_logs (and any audit/log schema) deep-dive ---- */
  const auditSchemas = Object.keys(R.schemas).filter(s => /audit|log/i.test(s));
  for (const sc of auditSchemas) {
    log(`\n=== DMS-side logging · schema ${sc} ===`);
    for (const t of R.schemas[sc]) {
      const info = { rows: t.rows, mb: t.mb, cols: [], time_col: null, range: null, sample: [] };
      const cols = await safe(`cols ${sc}.${t.t}`, () => dms.q(
        `SELECT column_name c, data_type dt FROM information_schema.columns
          WHERE table_schema=? AND table_name=? ORDER BY ordinal_position`, [sc, t.t]), []);
      info.cols = cols.map(x => `${x.c || x.C}:${x.dt || x.DT}`);
      const timeCol = (cols.find(x => /datetime|timestamp/i.test(String(x.dt || x.DT))) || {});
      const tc = timeCol.c || timeCol.C;
      if (tc && t.rows > 0) {
        info.time_col = tc;
        // newest first via index if one exists — bounded either way
        info.range = await safe(`range ${t.t}`, async () => {
          const r = await dms.qSlow(`SELECT min(\`${tc}\`) lo, max(\`${tc}\`) hi FROM \`${sc}\`.\`${t.t}\``, [], 25000);
          return r[0];
        });
        info.sample = await safe(`sample ${t.t}`, async () => {
          const r = await dms.qSlow(`SELECT * FROM \`${sc}\`.\`${t.t}\` ORDER BY \`${tc}\` DESC LIMIT 2`, [], 25000);
          return r.map(maskRow);
        }, []);
      }
      R.audit_logs[`${sc}.${t.t}`] = info;
      log(` ${t.t} · ~${t.rows.toLocaleString()} rows · ${t.mb} MB · time=${info.time_col || '—'}`
        + (info.range ? ` · ${info.range.lo} → ${info.range.hi}` : ''));
      log(`   cols: ${info.cols.join(', ').slice(0, 300)}`);
    }
  }

  /* ---- 3. channel fingerprint on the activation tables ---- */
  const actTables = R.dealer_tables.filter(x => /activat|order/i.test(x.t) && x.rows > 100).slice(0, 8);
  const CHAN_RX = /(channel|source|portal|origin|app_?version|platform|sale_?type|activation_?type|user_?type|created_?by|agent)/i;
  for (const at of actTables) {
    const cols = await safe(`cols ${at.t}`, () => dms.q(
      `SELECT column_name c FROM information_schema.columns WHERE table_schema=? AND table_name=?`,
      [at.schema, at.t]), []);
    const chanCols = cols.map(x => x.c || x.C).filter(c => CHAN_RX.test(c)).slice(0, 6);
    if (!chanCols.length) continue;
    log(`\n=== channel columns on ${at.schema}.${at.t} (${at.rows.toLocaleString()} rows) ===`);
    R.channels[`${at.schema}.${at.t}`] = {};
    for (const c of chanCols) {
      const vals = await safe(`distinct ${c}`, () => dms.qSlow(
        `SELECT \`${c}\` v, count(*) n FROM \`${at.schema}\`.\`${at.t}\` GROUP BY 1 ORDER BY n DESC LIMIT 12`, [], 45000), []);
      R.channels[`${at.schema}.${at.t}`][c] = vals.map(x => ({ v: mask(x.v), n: Number(x.n) }));
      log(` ${c}: ${vals.map(x => `${mask(x.v)}(${Number(x.n).toLocaleString()})`).join(' · ')}`);
    }
  }

  /* ---- 4. reachability ---- */
  log('\n=== reachability from this host (TCP connect only) ===');
  const targets = [
    ['172.16.1.115', 3306, 'Clara VIP (HLD / topology page)'],
    ['172.31.43.75', 3306, 'MaxScale VIP (current console target)'],
    ['172.31.43.72', 3306, 'Galera node 01'], ['172.31.43.73', 3306, 'Galera node 02'], ['172.31.43.74', 3306, 'Galera node 03'],
    ['172.31.43.136', 22, 'App Backend 1 · SSH (log access)'], ['172.31.43.137', 22, 'App Backend 2 · SSH'],
    ['172.31.43.138', 22, 'App Backend 3 · SSH'], ['172.31.43.139', 22, 'App Backend 4 · SSH'],
    ['172.31.43.136', 8080, 'App Backend 1 · app port'], ['172.31.43.139', 8080, 'App Backend 4 · app port']
  ];
  R.reach = await Promise.all(targets.map(t => probe(...t)));
  for (const r of R.reach) log(` ${r.ok ? '✓' : '✗'} ${r.host}:${r.port} · ${r.label} · ${r.ok ? r.ms + 'ms' : 'unreachable/filtered'}`);

  fs.writeFileSync(OUT, JSON.stringify(R, null, 2));
  log(`\nWritten: ${OUT}`);
  log('Share the printed summary (or the JSON) back — it becomes the DMS business-knowledge base.');
  process.exit(0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
