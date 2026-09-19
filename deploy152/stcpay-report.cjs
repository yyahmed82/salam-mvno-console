/* stcpay-report.cjs — STC Pay failures during the HyperPay-only window (UPG + Tap off 3 Sep 2026 16:27 KSA → UPG back on).
 * READ-ONLY on the selfcare replica (SOURCE_DATABASE_URL) + the gateway registry (CONSOLE_DATABASE_URL, console_settings 'gateways').
 * Writes /apps/unified/out/stcpay-report.json (cases + daily/hourly aggregates); tools/build-stcpay-xlsx.py turns it into the workbook.
 * Run on 152:  cd /apps/unified/server && set -a; . /apps/unified/.env; set +a && node ../deploy152/stcpay-report.cjs [--from ISO] [--to ISO]
 * Window: --from defaults to the registry cutover (hyperpay.since, else 2026-09-03T13:27:00Z); --to defaults to the moment UPG
 * (vendor 'salam') came back (registry salam.since when enabled, else the first 15-min bucket after the cutover with ≥ 10 UPG
 * customer payments, else now). Every query is bounded to that window. Mobiles are masked (05••••••34). */
'use strict';
const { Pool } = require('pg');
const fs = require('fs'); const path = require('path');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const RAIL = `lower(coalesce(nullif(p.payment_commit_response#>>'{payload,paymentBrand}',''), nullif(p.payment_commit_response#>>'{payload,brand}',''),
  nullif(p.payment_commit_response#>>'{payload,result,paymentBrand}',''), nullif(p.payment_commit_response#>>'{data,paymentBrand}',''),
  nullif(p.payment_commit_response#>>'{data,payload,paymentBrand}',''), nullif(p.payment_commit_response#>>'{type}',''), nullif(p.payment_commit_response#>>'{data,source}',''),
  CASE WHEN p.payment_commit_response IS NULL OR p.payment_commit_response::text IN ('{}','null','') THEN '(initiated - no gateway answer)' ELSE nullif(p.payment_method::text,'') END, '?'))`;
const IS_STC = `(${RAIL} LIKE '%stc%' OR lower(coalesce(p.card_type::text,'')) LIKE '%stc%' OR lower(coalesce(p.payment_method::text,'')) LIKE '%stc%')`;
const REASON = `coalesce(nullif(p.fail_reason::text,''), nullif(p.payment_commit_response#>>'{payload,result,description}',''), nullif(p.payment_commit_response#>>'{result,description}',''), nullif(p.payment_commit_response#>>'{gateway,response,message}',''), '')`;
const RCODE = `coalesce(nullif(p.payment_commit_response#>>'{payload,result,code}',''), nullif(p.payment_commit_response#>>'{result,code}',''), nullif(p.payment_commit_response#>>'{gateway,response,code}',''), '')`;
const KSA_DAY = `to_char(p.created_at + interval '3 hours', 'YYYY-MM-DD')`;
const KSA_HOUR = `to_char(date_trunc('hour', p.created_at + interval '3 hours'), 'YYYY-MM-DD HH24:00')`;
const MASK = `CASE WHEN p.customer_mobile_number::text IS NULL THEN NULL ELSE left(p.customer_mobile_number::text, 2) || repeat('•', greatest(length(p.customer_mobile_number::text) - 4, 0)) || right(p.customer_mobile_number::text, 2) END`;

(async () => {
  const src = new Pool({ connectionString: process.env.SOURCE_DATABASE_URL, max: 1, statement_timeout: 120000 });
  const con = process.env.CONSOLE_DATABASE_URL ? new Pool({ connectionString: process.env.CONSOLE_DATABASE_URL, max: 1 }) : null;
  let reg = null; try { reg = con && (await con.query(`SELECT value FROM console_settings WHERE key = 'gateways'`)).rows[0]; reg = reg && (typeof reg.value === 'string' ? JSON.parse(reg.value) : reg.value); } catch (e) { console.error('registry:', e.message); }
  const v = (reg && reg.vendors) || {};
  const from = arg('--from') || (v.hyperpay && v.hyperpay.since) || '2026-09-03T13:27:00Z';
  let to = arg('--to') || null, toHow = to ? 'argument' : null;
  if (!to && v.salam && v.salam.enabled && v.salam.since && new Date(v.salam.since) > new Date(from)) { to = v.salam.since; toHow = `gateway registry: UPG re-enabled by ${v.salam.by || '?'}`; }
  if (!to) {
    const r = await src.query(`SELECT to_timestamp(floor(extract(epoch FROM created_at) / 900) * 900) AS b, count(*)::int AS n FROM payments p
      WHERE p.created_at > $1::timestamptz AND p.vendor = 'salam' GROUP BY 1 HAVING count(*) >= 10 ORDER BY 1 LIMIT 1`, [from]);
    if (r.rows[0]) { to = new Date(r.rows[0].b).toISOString(); toHow = `data: first 15-min slot after the cutover with ≥ 10 UPG payments (${r.rows[0].n})`; }
  }
  if (!to) { to = new Date().toISOString(); toHow = 'now — UPG traffic has not resumed in the replica'; }
  console.log(`window ${from} → ${to} (${toHow})`);
  const P = [from, to];
  let step = ''; const q = async (sql, params = P) => { try { return (await src.query(sql, params)).rows; } catch (e) { e.message = `[${step}] ` + e.message; throw e; } };

  step = 'daily'; const daily = await q(`SELECT ${KSA_DAY} AS day, p.vendor, count(*)::int AS attempts,
      count(*) FILTER (WHERE p.status = 'success')::int AS ok, count(*) FILTER (WHERE p.status IN ('fail','failed'))::int AS fail, count(*) FILTER (WHERE p.status = 'pending')::int AS pending,
      count(*) FILTER (WHERE ${IS_STC})::int AS stc_attempts, count(*) FILTER (WHERE ${IS_STC} AND p.status = 'success')::int AS stc_ok, count(*) FILTER (WHERE ${IS_STC} AND p.status IN ('fail','failed'))::int AS stc_fail,
      count(DISTINCT p.customer_mobile_number::text) FILTER (WHERE ${IS_STC} AND p.status IN ('fail','failed'))::int AS stc_fail_customers,
      coalesce(sum(p.amount) FILTER (WHERE ${IS_STC} AND p.status IN ('fail','failed')), 0)::numeric AS stc_fail_amount
    FROM payments p WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz GROUP BY 1, 2 ORDER BY 1, 2`);
  step = 'hourly'; const hourly = await q(`SELECT ${KSA_HOUR} AS hour, count(*) FILTER (WHERE ${IS_STC})::int AS stc_attempts, count(*) FILTER (WHERE ${IS_STC} AND p.status = 'success')::int AS stc_ok,
      count(*) FILTER (WHERE ${IS_STC} AND p.status IN ('fail','failed'))::int AS stc_fail, count(*)::int AS attempts, count(*) FILTER (WHERE p.status IN ('fail','failed'))::int AS fail
    FROM payments p WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND p.vendor ILIKE '%hyper%' GROUP BY 1 ORDER BY 1`);
  step = 'rails'; const rails = await q(`SELECT ${RAIL} AS rail, count(*)::int AS attempts, count(*) FILTER (WHERE p.status = 'success')::int AS ok, count(*) FILTER (WHERE p.status IN ('fail','failed'))::int AS fail, count(*) FILTER (WHERE p.status = 'pending')::int AS pending
    FROM payments p WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND p.vendor ILIKE '%hyper%' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  step = 'reasons'; const reasons = await q(`SELECT ${RCODE} AS code, ${REASON} AS reason, count(*)::int AS n, count(DISTINCT p.customer_mobile_number::text)::int AS customers
    FROM payments p WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND ${IS_STC} AND p.status IN ('fail','failed') GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30`);
  step = 'byPlatform'; const byPlatform = await q(`SELECT lower(coalesce(nullif(p.platform::text,''),'(none)')) AS platform, count(*)::int AS attempts, count(*) FILTER (WHERE p.status = 'success')::int AS ok, count(*) FILTER (WHERE p.status IN ('fail','failed'))::int AS fail
    FROM payments p WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND ${IS_STC} GROUP BY 1 ORDER BY 2 DESC`);
  step = 'byPurpose'; const byPurpose = await q(`SELECT coalesce(nullif(p.payment_on_type::text,''),'(none)') AS purpose, count(*)::int AS attempts, count(*) FILTER (WHERE p.status = 'success')::int AS ok, count(*) FILTER (WHERE p.status IN ('fail','failed'))::int AS fail, coalesce(sum(p.amount) FILTER (WHERE p.status IN ('fail','failed')),0)::numeric AS fail_amount
    FROM payments p WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND ${IS_STC} GROUP BY 1 ORDER BY 2 DESC`);
  step = 'retries'; const retries = await q(`SELECT tries, count(*)::int AS customers FROM (SELECT p.customer_mobile_number::text, count(*)::int AS tries FROM payments p
      WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND ${IS_STC} AND p.status IN ('fail','failed') AND p.customer_mobile_number::text IS NOT NULL GROUP BY 1) t GROUP BY 1 ORDER BY 1`);
  step = 'recovered'; const recovered = await q(`SELECT count(DISTINCT f.customer_mobile_number::text)::int AS failed_customers,
      count(DISTINCT f.customer_mobile_number::text) FILTER (WHERE EXISTS (SELECT 1 FROM payments s WHERE s.customer_mobile_number::text = f.customer_mobile_number::text AND s.status = 'success' AND s.created_at > f.created_at AND s.created_at < $2::timestamptz + interval '3 days'))::int AS later_paid,
      count(DISTINCT f.customer_mobile_number::text) FILTER (WHERE EXISTS (SELECT 1 FROM payments s WHERE s.customer_mobile_number::text = f.customer_mobile_number::text AND s.status = 'success' AND s.created_at > f.created_at AND s.created_at < $2::timestamptz + interval '3 days' AND NOT (${IS_STC.replace(/p\./g, 's.')})))::int AS later_paid_other_rail
    FROM payments f WHERE f.created_at >= $1::timestamptz AND f.created_at < $2::timestamptz AND ${IS_STC.replace(/p\./g, 'f.')} AND f.status IN ('fail','failed') AND f.customer_mobile_number::text IS NOT NULL`);
  step = 'cases'; const cases = await q(`SELECT p.id::text AS id, to_char(p.created_at + interval '3 hours', 'YYYY-MM-DD HH24:MI:SS') AS ksa_time, p.status, p.amount, lower(coalesce(nullif(p.platform::text,''),'(none)')) AS platform,
      p.vendor, ${RAIL} AS rail, p.payment_method::text, p.card_type::text, p.payment_on_type::text AS purpose, p.payment_on_id::text AS target_id, p.payment_reference_id::text AS gateway_ref, ${RCODE} AS code, left(${REASON}, 200) AS reason, ${MASK} AS mobile_masked
    FROM payments p WHERE p.created_at >= $1::timestamptz AND p.created_at < $2::timestamptz AND ${IS_STC} ORDER BY p.created_at LIMIT 200000`);
  step = 'ctx'; const ctx = await q(`SELECT ${KSA_DAY} AS day, p.vendor, count(*)::int AS attempts, count(*) FILTER (WHERE p.status = 'success')::int AS ok, count(*) FILTER (WHERE p.status IN ('fail','failed'))::int AS fail
    FROM payments p WHERE p.created_at >= $1::timestamptz - interval '7 days' AND p.created_at < $1::timestamptz GROUP BY 1, 2 ORDER BY 1, 2`, [from]);
  const out = { generated_at: new Date().toISOString(), window: { from, to, to_how: toHow }, registry: v, daily, hourly, rails, reasons, byPlatform, byPurpose, retries, recovered: recovered[0], cases, baseline_before: ctx };
  const dir = '/apps/unified/out'; fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, 'stcpay-report.json');
  fs.writeFileSync(file, JSON.stringify(out)); 
  const stc = daily.reduce((a, d) => ({ att: a.att + d.stc_attempts, ok: a.ok + d.stc_ok, fail: a.fail + d.stc_fail }), { att: 0, ok: 0, fail: 0 });
  console.log(`STC Pay in window: ${stc.att} attempts · ${stc.ok} success · ${stc.fail} failed · ${cases.length} case rows · ${recovered[0].failed_customers} failed customers, ${recovered[0].later_paid} paid later (${recovered[0].later_paid_other_rail} on another rail)`);
  console.log('wrote', file);
  await src.end(); if (con) await con.end();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
