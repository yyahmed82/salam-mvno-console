#!/usr/bin/env node
/* WEB ORDER DROP — does our own Fixed read model agree with the Singlestore "FTTH Sales by Channel"
 * report, and if web really is down, is the loss demand (fewer attempts) or technical (same attempts,
 * worse conversion)?  READ-ONLY: SELECTs only.
 *
 * Context (18 Sep 2026): reports@salammobile.sa sends "FTTH Sales by Channel" daily. The 18 Sep run shows
 * Sep web = 562 vs Aug web = 1024 and that was read as a "significant drop". Per day it is 33.06 vs 33.03,
 * i.e. flat — Sep is 17 days of 30. BUT the last five days (13-17 Sep) are genuinely 22.6 % below the same
 * five weekdays of the prior six weeks (Poisson z = -3.0), so one real question remains: attempts or conversion.
 *
 * Run ON 152 AS USER yosri (pm2/node live under yosri's nvm; sudo -i loses that PATH):
 *   cd /apps/unified/server && node /tmp/web-drop-check.cjs
 *   cd /apps/unified/server && node /tmp/web-drop-check.cjs --from 2026-07-01 --to 2026-09-19
 *
 * Reads OPS_BETA_DATABASE_URL + OPS_DATABASE_URL out of /apps/unified/.env by parsing it IN NODE.
 * Never `set -a; . .env` on this box — values contain spaces and angle brackets.
 *
 * "web" here is the console's own definition (fixedErrors.CHANNEL_EXPR), which is also the report's:
 *   channel <> 'sda' AND channel <> 'salamhome' AND referral_code IS NULL   → web
 *   ... AND referral_code IS NOT NULL                                       → qr
 * Days are bucketed in KSA time (UTC+3), same as every Fixed page.
 */
'use strict';
const fs = require('fs');

function loadEnv(p) {
  const out = {}; let txt = '';
  try { txt = fs.readFileSync(p, 'utf8'); } catch (e) { return out; }
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const ENV = loadEnv(process.env.ENV_FILE || '/apps/unified/.env');
const pick = k => process.env[k] || ENV[k];
let pg; try { pg = require('pg'); } catch (e) { pg = require('/apps/unified/server/node_modules/pg'); }

const args = process.argv.slice(2);
const argv = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const FROM = argv('--from', '2026-08-01');
const TO   = argv('--to',   '2026-09-19');

/* what the Singlestore report says web did, per day — so the console can be compared row by row */
const REPORT = {
'2026-08-01':23, '2026-08-02':44, '2026-08-03':36, '2026-08-04':40, '2026-08-05':20, '2026-08-06':28,
'2026-08-07':21, '2026-08-08':26, '2026-08-09':30, '2026-08-10':25, '2026-08-11':35, '2026-08-12':25,
'2026-08-13':31, '2026-08-14':16, '2026-08-15':34, '2026-08-16':25, '2026-08-17':34, '2026-08-18':25,
'2026-08-19':40, '2026-08-20':23, '2026-08-21':24, '2026-08-22':36, '2026-08-23':38, '2026-08-24':44,
'2026-08-25':42, '2026-08-26':44, '2026-08-27':40, '2026-08-28':36, '2026-08-29':52, '2026-08-30':39,
'2026-08-31':48, '2026-09-01':45, '2026-09-02':53, '2026-09-03':36, '2026-09-04':35, '2026-09-05':27,
'2026-09-06':43, '2026-09-07':36, '2026-09-08':27, '2026-09-09':32, '2026-09-10':34, '2026-09-11':19,
'2026-09-12':38, '2026-09-13':39, '2026-09-14':25, '2026-09-15':27, '2026-09-16':27, '2026-09-17':19 };

const strip = url => { try { const u = new URL(url); const schema = u.searchParams.get('schema');
  for (const k of ['schema','connection_limit','pool_timeout','pgbouncer','connect_timeout']) u.searchParams.delete(k);
  return { cs: u.toString(), schema }; } catch (_) { return { cs: url, schema: null }; } };

const KSA = `+ interval '3 hours'`;
const WEB = `(oa.channel IS DISTINCT FROM 'sda' AND oa.channel IS DISTINCT FROM 'salamhome' AND oa.referral_code IS NULL)`;
const QR  = `(oa.channel IS DISTINCT FROM 'sda' AND oa.channel IS DISTINCT FROM 'salamhome' AND oa.referral_code IS NOT NULL)`;
const WIN = `oa.started_at >= $1::date - interval '3 hours' AND oa.started_at < ($2::date + interval '1 day') - interval '3 hours'`;
const pct = (a,b) => b > 0 ? (100*a/b).toFixed(1)+'%' : '—';
const H = t => console.log('\n' + '='.repeat(108) + '\n' + t + '\n' + '='.repeat(108));

async function open(name, envKey) {
  const url = pick(envKey);
  if (!url) { console.log(`\n!! ${name}: ${envKey} not set — skipped`); return null; }
  const { cs, schema } = strip(url);
  const p = new pg.Pool({ connectionString: cs, max: 1, statement_timeout: 120000,
    application_name: 'salam_console_ro_webdrop',
    options: `-c default_transaction_read_only=on -c timezone=UTC${schema ? ` -c search_path=${schema},public` : ''}` });
  try { const r = await p.query('SELECT current_database() db, current_schema() sch'); 
        console.log(`\n>> ${name}  →  ${r.rows[0].db} / ${r.rows[0].sch}   (${envKey})`); return p; }
  catch (e) { console.log(`\n!! ${name}: cannot connect — ${e.message}`); try { await p.end(); } catch(_){} return null; }
}

async function freshness(P, label) {
  H(`0. READ-MODEL FRESHNESS — ${label}   (a stalled ingest looks exactly like a sales drop)`);
  const q = async (sql, args) => { try { return (await P.query(sql, args)).rows; } catch (e) { console.log('   ERROR:', e.message); return []; } };
  const cov = await q(`SELECT (SELECT count(*)::bigint FROM order_attempts) attempts,
      (SELECT min(started_at) FROM order_attempts) oldest, (SELECT max(started_at) FROM order_attempts) newest,
      (SELECT max(occurred_at) FROM error_events) newest_error, (SELECT max(created_at) FROM api_calls) newest_api,
      now() AS now_utc`);
  if (cov[0]) { const c = cov[0];
    const age = m => m ? ((Date.now() - new Date(m).getTime())/3600000).toFixed(1)+' h ago' : 'never';
    console.log(`   order_attempts rows=${c.attempts}  oldest=${String(c.oldest).slice(0,19)}  newest=${String(c.newest).slice(0,19)}  (${age(c.newest)})`);
    console.log(`   error_events newest=${String(c.newest_error).slice(0,19)} (${age(c.newest_error)})   api_calls newest=${String(c.newest_api).slice(0,19)} (${age(c.newest_api)})`);
    console.log(`   server now (UTC)=${String(c.now_utc).slice(0,19)}`);
  }
  const gaps = await q(`SELECT to_char(date_trunc('day', oa.started_at ${KSA}),'YYYY-MM-DD') d, count(*)::int n
     FROM order_attempts oa WHERE oa.started_at >= now() - interval '50 days' GROUP BY 1 ORDER BY 1`);
  if (gaps.length) {
    console.log(`   ingest by day, last 50 days (ALL channels — a zero or a cliff here is an ingest problem, not a sales problem):`);
    let line = '   ';
    for (const g of gaps) { line += `${g.d.slice(5)}:${String(g.n).padStart(4)}  `; if (line.length > 96) { console.log(line); line = '   '; } }
    if (line.trim()) console.log(line);
    const zero = gaps.filter(g => g.n === 0); if (zero.length) console.log(`   !! ${zero.length} day(s) with zero rows`);
  }
}

async function funnel(P, label) {
  const q = async (sql, args) => { try { return (await P.query(sql, args)).rows; } catch (e) { console.log('   ERROR:', e.message); return []; } };

  H(`1. WEB, DAY BY DAY — console read model vs the Singlestore report   (${label}, ${FROM} → ${TO}, KSA days)`);
  const d = await q(`SELECT to_char(date_trunc('day', oa.started_at ${KSA}),'YYYY-MM-DD') d,
      count(*)::int attempts,
      count(*) FILTER (WHERE oa.outcome='COMPLETED')::int completed,
      count(*) FILTER (WHERE oa.order_number IS NOT NULL)::int with_order,
      count(*) FILTER (WHERE oa.outcome IN ('CANCELLED','EXPIRED'))::int abandoned,
      count(*) FILTER (WHERE oa.outcome='STALLED')::int stalled,
      count(*) FILTER (WHERE oa.last_error_category IS NOT NULL)::int with_error
    FROM order_attempts oa WHERE ${WIN} AND ${WEB} GROUP BY 1 ORDER BY 1`, [FROM, TO]);
  console.log('   date         attempts  completed  conv    with_order  abandoned  stalled  w/error   REPORT  console-report');
  for (const r of d) {
    const rep = REPORT[r.d];
    const delta = rep == null ? '' : (r.with_order - rep >= 0 ? '+' : '') + (r.with_order - rep);
    console.log(`   ${r.d}  ${String(r.attempts).padStart(8)}  ${String(r.completed).padStart(9)}  ${pct(r.completed,r.attempts).padStart(6)}  ${String(r.with_order).padStart(10)}  ${String(r.abandoned).padStart(9)}  ${String(r.stalled).padStart(7)}  ${String(r.with_error).padStart(7)}   ${String(rep==null?'—':rep).padStart(6)}  ${delta.padStart(14)}`);
  }
  console.log('   NOTE: "with_order" is the closest match to the report\'s Web column (an order number was issued).');
  console.log('   If console attempts are FLAT while completed/with_order fall  → technical drop inside the journey.');
  console.log('   If console attempts fall in step with the report               → fewer people started: demand/marketing, not a fault.');

  H(`2. WEB BY WEEK (Sun-start, KSA) — attempts vs conversion, with QR and Salam Home as controls`);
  const w = await q(`WITH b AS (
      SELECT date_trunc('week', (oa.started_at ${KSA}) + interval '1 day') - interval '1 day' AS wk,
        CASE WHEN oa.channel = 'sda' THEN 'sda' WHEN oa.channel = 'salamhome' THEN 'salamhome'
             WHEN oa.referral_code IS NOT NULL THEN 'qr' ELSE 'web' END AS ch,
        oa.outcome::text AS outcome, oa.order_number
      FROM order_attempts oa WHERE ${WIN})
    SELECT to_char(wk,'YYYY-MM-DD') wk, ch, count(*)::int attempts,
      count(*) FILTER (WHERE outcome='COMPLETED')::int completed,
      count(*) FILTER (WHERE order_number IS NOT NULL)::int with_order
    FROM b GROUP BY 1,2 ORDER BY 1,2`, [FROM, TO]);
  console.log('   week         channel      attempts  completed   conv     with_order  order_rate');
  for (const r of w) console.log(`   ${r.wk}   ${r.ch.padEnd(11)} ${String(r.attempts).padStart(8)}  ${String(r.completed).padStart(9)}  ${pct(r.completed,r.attempts).padStart(6)}  ${String(r.with_order).padStart(10)}  ${pct(r.with_order,r.attempts).padStart(10)}`);
  console.log('   A conversion rate that holds while attempts fall = demand. A conversion rate that falls = our problem.');

  H(`3. WHERE WEB JOURNEYS STOP — step_reached of every non-completed web attempt, by week`);
  const s = await q(`SELECT to_char(date_trunc('week', (oa.started_at ${KSA}) + interval '1 day') - interval '1 day','YYYY-MM-DD') wk,
      COALESCE(NULLIF(oa.step_reached,''),'(none)') step, count(*)::int n
    FROM order_attempts oa WHERE ${WIN} AND ${WEB} AND oa.outcome <> 'COMPLETED' GROUP BY 1,2 ORDER BY 1, 3 DESC`, [FROM, TO]);
  const byWk = {}; for (const r of s) (byWk[r.wk] = byWk[r.wk] || []).push(r);
  for (const wk of Object.keys(byWk).sort()) {
    const rows = byWk[wk], tot = rows.reduce((a,r)=>a+r.n,0);
    console.log(`   week ${wk}   ${tot} non-completed`);
    for (const r of rows.slice(0,8)) console.log(`      ${String(r.n).padStart(5)}  ${pct(r.n,tot).padStart(6)}  ${r.step}`);
  }
  console.log('   A STEP THAT IS NEW OR HAS GROWN SHARPLY IN THE LAST WEEK IS THE FAULT. A flat mix = no fault.');

  H(`4. WEB ERRORS BY WEEK — category mix (a technical fault shows up here first)`);
  const e = await q(`SELECT to_char(date_trunc('week', (oa.started_at ${KSA}) + interval '1 day') - interval '1 day','YYYY-MM-DD') wk,
      oa.last_error_category cat, count(*)::int n
    FROM order_attempts oa WHERE ${WIN} AND ${WEB} AND oa.last_error_category IS NOT NULL GROUP BY 1,2 ORDER BY 1,3 DESC`, [FROM, TO]);
  const ebw = {}; for (const r of e) (ebw[r.wk] = ebw[r.wk] || []).push(r);
  for (const wk of Object.keys(ebw).sort()) {
    const rows = ebw[wk], tot = rows.reduce((a,r)=>a+r.n,0);
    console.log(`   week ${wk}   ${tot} attempts carried an error`);
    for (const r of rows.slice(0,8)) console.log(`      ${String(r.n).padStart(5)}  ${pct(r.n,tot).padStart(6)}  ${r.cat}`);
  }

  H(`5. OUTBOUND INTEGRATIONS ON THE WEB PATH — failures and latency by week`);
  const a = await q(`WITH c AS (SELECT date_trunc('week', (ac.created_at ${KSA}) + interval '1 day') - interval '1 day' AS wk,
        regexp_replace(regexp_replace(split_part(ac.endpoint,'?',1),'^https?://[^/]+',''),'/[0-9A-Za-z_-]*[0-9][0-9A-Za-z_-]*','/{id}','g') AS family,
        ac.status, ac.error_class, ac.duration_ms
      FROM api_calls ac JOIN order_attempts oa ON oa.id = ac.attempt_id
      WHERE ac.created_at >= $1::date - interval '3 hours' AND ac.created_at < ($2::date + interval '1 day') - interval '3 hours' AND ${WEB})
    SELECT to_char(wk,'YYYY-MM-DD') wk, family, count(*)::int calls,
      count(*) FILTER (WHERE status >= 400 OR error_class IS NOT NULL)::int failed,
      count(*) FILTER (WHERE status >= 500)::int s5xx,
      count(*) FILTER (WHERE error_class IS NOT NULL)::int transport,
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int p95
    FROM c GROUP BY 1,2 HAVING count(*) >= 5 ORDER BY 1, 3 DESC`, [FROM, TO]);
  if (!a.length) console.log('   (no api_calls rows for the web path in this window — check whether api_logs ingest is on for this read model)');
  const abw = {}; for (const r of a) (abw[r.wk] = abw[r.wk] || []).push(r);
  for (const wk of Object.keys(abw).sort()) {
    console.log(`   week ${wk}`);
    console.log('        calls  failed   fail%   5xx  transport    p95ms  endpoint family');
    for (const r of abw[wk].slice(0,12))
      console.log(`      ${String(r.calls).padStart(7)} ${String(r.failed).padStart(7)} ${pct(r.failed,r.calls).padStart(7)} ${String(r.s5xx).padStart(5)} ${String(r.transport).padStart(10)} ${String(r.p95).padStart(8)}  ${r.family}`);
  }
}

(async () => {
  console.log(`WEB ORDER DROP CHECK — window ${FROM} → ${TO} (KSA days)`);
  console.log(`report under review: "FTTH Sales by Channel" run 2026-09-18 09:00:11 (Singlestore)`);
  const beta = await open('sda_ops_beta (serves the web + salamhome buckets)', 'OPS_BETA_DATABASE_URL');
  const prod = await open('sda_ops public (serves sda + qr)',                  'OPS_DATABASE_URL');
  for (const [P, label] of [[beta,'sda_ops_beta'], [prod,'sda_ops public']]) {
    if (!P) continue;
    await freshness(P, label);
    await funnel(P, label);
    await P.end();
  }
  console.log('\ndone.');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
