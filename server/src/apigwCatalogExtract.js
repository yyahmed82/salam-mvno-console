/* DIGITAL-API / APIGW ERROR CATALOG — aggregate extractor over api_traffic_events.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/apigwCatalogExtract.js            # full available window → out/apigw-catalog.json
 *
 * WHY THIS IS NOT 12 MONTHS (and must never pretend to be): api_traffic_events is the console's
 * OWN capture of the Digital-API hosts' logs — collector live since 13 Aug 2026, 7-day
 * retention. There is no other per-call record of APIGW traffic anywhere we can read. So this
 * catalog covers the FULL AVAILABLE WINDOW (~7 days, ~6.6M calls — statistically meaningful),
 * says so on page one, and the companion plan (daily rollups) makes future editions monthly.
 *
 * SAFETY: this is the CONSOLE's postgres on 152 (not the replica, not prod) — but bounded
 * anyway: aggregates only (no row dumps), statement_timeout 120s, one query at a time with
 * pauses. response_message is masked at capture time already; we still re-mask defensively.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');

const OUT = path.join(__dirname, '..', 'out');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mask = s => String(s == null ? '' : s).replace(/\d{7,}/g, m => '*'.repeat(m.length - 3) + m.slice(-3));

/* the four report journeys, mapped from path families (first match wins in the CASE) */
const JOURNEY = `CASE
  WHEN path ILIKE '%voucher%' OR path ILIKE '%recharge%' THEN 'Recharge'
  WHEN path ILIKE '%bill%' OR path ILIKE '%invoice%' THEN 'Invoice'
  WHEN path ILIKE '%semati%' OR path ILIKE '%nafath%' OR path ILIKE '%eligib%'
    OR path ILIKE '%activation%' OR path ILIKE '%onboarding%' OR path ILIKE '%reservation%'
    OR path ILIKE '%subscription%' OR path ILIKE '%mobile-number%' THEN 'Onboarding (NewSIM+MNP)'
  WHEN path ILIKE '%sign_in%' OR path ILIKE '%auth%' OR path ILIKE '%otp%' THEN 'Account/Auth'
  ELSE 'Other' END`;

async function q(sql, p = []) {
  const c = await db.console.connect();
  try {
    await c.query(`SET statement_timeout = 120000`);
    const r = await c.query(sql, p);
    await sleep(300);
    return r.rows;
  } finally { c.release(); }
}

(async () => {
  const t0 = Date.now();
  const out = { generated: new Date().toISOString() };

  out.window = (await q(`SELECT min(ts) lo, max(ts) hi, count(*)::bigint n FROM api_traffic_events`))[0];
  console.log(`window ${out.window.lo} → ${out.window.hi} · ${Number(out.window.n).toLocaleString()} calls`);

  out.daily = await q(`
    SELECT date_trunc('day', ts)::date::text AS day, coalesce(err_class,'(none)') cls, count(*)::int n
      FROM api_traffic_events GROUP BY 1,2 ORDER BY 1,2`);

  out.journey_cls = await q(`
    SELECT ${JOURNEY} AS journey, coalesce(err_class,'(none)') cls, count(*)::int n,
           round(avg(duration_ms))::int avg_ms,
           percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms)::int p95_ms
      FROM api_traffic_events GROUP BY 1,2 ORDER BY 1,2`);

  out.top_technical = (await q(`
    SELECT path, coalesce(response_code,'(none)') code,
           coalesce(NULLIF(left(response_message,90),''),'(no message)') msg,
           ${JOURNEY} AS journey, count(*)::int n, round(avg(duration_ms))::int avg_ms
      FROM api_traffic_events WHERE err_class = 'technical'
     GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 40`)).map(r => ({ ...r, msg: mask(r.msg) }));

  out.top_business = (await q(`
    SELECT path, coalesce(response_code,'(none)') code,
           coalesce(NULLIF(left(response_message,90),''),'(no message)') msg,
           ${JOURNEY} AS journey, count(*)::int n
      FROM api_traffic_events WHERE err_class = 'business'
     GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 40`)).map(r => ({ ...r, msg: mask(r.msg) }));

  out.slowest = await q(`
    SELECT path, count(*)::int n, round(avg(duration_ms))::int avg_ms,
           percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms)::int p95_ms,
           max(duration_ms)::int max_ms,
           count(*) FILTER (WHERE err_class='technical')::int tech
      FROM api_traffic_events WHERE duration_ms IS NOT NULL
     GROUP BY 1 HAVING count(*) >= 500 ORDER BY p95_ms DESC LIMIT 25`);

  out.hourly = await q(`
    SELECT extract(hour FROM ts AT TIME ZONE 'Asia/Riyadh')::int AS hour_ksa,
           count(*)::int n, count(*) FILTER (WHERE err_class='technical')::int tech
      FROM api_traffic_events GROUP BY 1 ORDER BY 1`);

  out.hosts = await q(`
    SELECT host, count(*)::int n, count(*) FILTER (WHERE err_class='technical')::int tech
      FROM api_traffic_events GROUP BY 1 ORDER BY n DESC`);

  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, 'apigw-catalog.json');
  fs.writeFileSync(f, JSON.stringify(out));
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s → ${f}`);
  console.log('scp it and run: python3 tools/build-apigw-catalog-pdf.py apigw-catalog.json');
  process.exit(0);
})().catch(e => { console.error('EXTRACT FAILED:', e.message); process.exit(1); });
