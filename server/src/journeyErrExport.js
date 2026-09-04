/* 12-MONTH JOURNEY-ERRORS EXTRACTOR — eligibility / BSS activation / Nafath, monthly JSON.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/journeyErrExport.js                        # Sep-2025 → Aug-2026, resume-safe
 *   node src/journeyErrExport.js --month 2026-07        # one month only
 *   node src/journeyErrExport.js --force                # re-extract existing months
 *
 * Output: out/journey-errors/YYYY-MM.json  (scp to the Mac, then
 *         python3 tools/build-journey-monthly-xlsx.py <dir>  builds one workbook per month)
 *
 * WHAT THE PROBE (journeyErrProbe.js, 25 Aug 2026) DECIDED
 *   · All three replica sources hold every month Sep-2025 → Aug-2026 with failure DETAIL
 *     (activation 727/726/812/823…, eligibility 605-dominant + 715/5002, nafath statuses).
 *   · Worst month = 71k eligibility failures → day slices are small; replica load negligible.
 *   · activation_logs.onboarding_order_id returned ZERO joins for Oct-2025 → the FK is likely
 *     recent. Lane attribution per month is therefore MEASURED (fk_coverage) and lane splits
 *     are emitted only from orders (number_order_type — reliable for all months) and from
 *     activation rows only where the FK exists. No month gets a guessed lane.
 *   · APIGW (api_traffic_events) = 7-day retention, collector live 13-Aug-2026 → historically
 *     IMPOSSIBLE; the report carries that caveat instead of fake numbers.
 *
 * PROD SAFETY (replica-only, but the replica also feeds the console):
 *   one query at a time · day slices · statement_timeout 60s · 250ms pause between queries ·
 *   application_name tagged so DBAs can see and kill us · resume per month (a crash never
 *   re-reads finished months) · PII masked BEFORE writing (digit runs keep last 3).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');
const errclass = require('./errclass');

const OUT = path.join(__dirname, '..', 'out', 'journey-errors');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const FORCE = process.argv.includes('--force');
const ONE = arg('--month', null);
const PAUSE = Number(arg('--pause', 250));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mask = s => String(s == null ? '' : s).replace(/\d{7,}/g, m => '*'.repeat(m.length - 3) + m.slice(-3));

const MONTHS = [];
for (let d = new Date(Date.UTC(2025, 8, 1)); d < new Date(Date.UTC(2026, 8, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) {
  const lo = d.toISOString().slice(0, 10);
  const hi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  MONTHS.push({ key: lo.slice(0, 7), lo, hi });
}

const ELIG_CLS = errclass.classCaseSql(`NULLIF(el.status_code,'')`, `coalesce(el.response::text,'')`);
const ACT_CODE = `COALESCE(NULLIF(al.status_code,''), al.response->>'responseCode')`;
const ACT_CLS = errclass.classCaseSql(ACT_CODE, `coalesce(al.response->>'responseMessage', al.response::text, '')`);
/* doctrine (salam-issue-classification): nafath terminal statuses are ALWAYS business */
const NAF_BAD = `('expired','rejected','failed','cancelled','denied')`;

async function q(sql, p = []) {
  const c = await db.source.connect();
  try {
    await c.query(`SET statement_timeout = 60000`);
    await c.query(`SET application_name = 'console_hist_journeyerr'`);
    const r = await c.query(sql, p);
    await sleep(PAUSE);
    return r.rows;
  } finally { c.release(); }
}

function* days(lo, hi) {
  for (let d = new Date(lo + 'T00:00:00Z'); d < new Date(hi + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const a = d.toISOString().slice(0, 10);
    const n = new Date(d); n.setUTCDate(n.getUTCDate() + 1);
    yield [a, n.toISOString().slice(0, 10)];
  }
}

async function extractMonth(M) {
  const t0 = Date.now();
  const out = { month: M.key, from: M.lo, to: M.hi, generated: new Date().toISOString() };

  /* ---- aggregates (one bounded query each) ------------------------------------------------ */
  out.orders = (await q(`
    SELECT ((number_order_type=1) IS TRUE) AS mnp,
           count(*)::int created,
           count(*) FILTER (WHERE NULLIF(trim(nationality_id_number),'') IS NOT NULL)::int id_submitted,
           count(*) FILTER (WHERE is_eligible IS TRUE)::int eligible,
           count(*) FILTER (WHERE is_eligible IS FALSE AND NULLIF(trim(nationality_id_number),'') IS NOT NULL)::int denied,
           count(*) FILTER (WHERE activated IS TRUE)::int activated
      FROM onboarding_orders WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`, [M.lo, M.hi]));

  out.eligibility_codes = (await q(`
    SELECT coalesce(NULLIF(el.status_code,''),'(none)') code, ${ELIG_CLS} AS cls,
           count(*)::int n
      FROM eligibility_logs el WHERE el.created_at >= $1 AND el.created_at < $2 AND el.state = false
     GROUP BY 1,2 ORDER BY n DESC LIMIT 40`, [M.lo, M.hi]));
  out.eligibility_total = (await q(`
    SELECT count(*)::int n, count(*) FILTER (WHERE state=false)::int bad
      FROM eligibility_logs WHERE created_at >= $1 AND created_at < $2`, [M.lo, M.hi]))[0];

  out.activation_codes = (await q(`
    SELECT al.api, coalesce(${ACT_CODE},'(none)') code, ${ACT_CLS} AS cls, count(*)::int n
      FROM activation_logs al WHERE al.created_at >= $1 AND al.created_at < $2 AND al.state = false
     GROUP BY 1,2,3 ORDER BY n DESC LIMIT 60`, [M.lo, M.hi]));
  out.activation_total = (await q(`
    SELECT count(*)::int n, count(*) FILTER (WHERE state=false)::int bad,
           count(*) FILTER (WHERE onboarding_order_id IS NOT NULL)::int with_fk
      FROM activation_logs WHERE created_at >= $1 AND created_at < $2`, [M.lo, M.hi]))[0];
  /* lane split only where the FK is real; fk_coverage tells the workbook whether to trust it */
  out.activation_lane = (await q(`
    SELECT ((oo.number_order_type=1) IS TRUE) AS mnp, ${ACT_CLS} AS cls, count(*)::int n
      FROM activation_logs al JOIN onboarding_orders oo ON oo.id = al.onboarding_order_id
     WHERE al.created_at >= $1 AND al.created_at < $2 AND al.state = false
     GROUP BY 1,2`, [M.lo, M.hi]));

  out.nafath = (await q(`
    SELECT coalesce(lower(status),'(none)') status, coalesce(service,'(none)') service, count(*)::int n
      FROM nafath_logs WHERE created_at >= $1 AND created_at < $2
     GROUP BY 1,2 ORDER BY n DESC LIMIT 60`, [M.lo, M.hi]));

  /* ---- failure DETAIL rows, day-sliced (masked) ------------------------------------------- */
  out.eligibility_rows = [];
  out.activation_rows = [];
  out.nafath_rows = [];
  for (const [a, b] of days(M.lo, M.hi)) {
    (await q(`
      SELECT el.created_at, el.api, coalesce(NULLIF(el.status_code,''),'(none)') code, ${ELIG_CLS} AS cls,
             left(coalesce(el.response::text,''), 160) AS response
        FROM eligibility_logs el WHERE el.created_at >= $1 AND el.created_at < $2 AND el.state = false
       ORDER BY el.created_at LIMIT 20000`, [a, b]))
      .forEach(r => out.eligibility_rows.push({ ...r, response: mask(r.response) }));
    (await q(`
      SELECT al.created_at, al.api, coalesce(${ACT_CODE},'(none)') code, ${ACT_CLS} AS cls,
             left(coalesce(al.response->>'responseMessage', al.response::text, ''), 160) AS message,
             coalesce(lower(al.platform),'') AS platform,
             (al.onboarding_order_id IS NOT NULL) AS has_order
        FROM activation_logs al WHERE al.created_at >= $1 AND al.created_at < $2 AND al.state = false
       ORDER BY al.created_at LIMIT 20000`, [a, b]))
      .forEach(r => out.activation_rows.push({ ...r, message: mask(r.message) }));
    (await q(`
      SELECT created_at, lower(status) AS status, coalesce(service,'') AS service
        FROM nafath_logs WHERE created_at >= $1 AND created_at < $2
         AND lower(coalesce(status,'')) IN ${NAF_BAD}
       ORDER BY created_at LIMIT 20000`, [a, b]))
      .forEach(r => out.nafath_rows.push(r));
    process.stdout.write(`\r  ${M.key} ${a}  elig ${out.eligibility_rows.length}  act ${out.activation_rows.length}  naf ${out.nafath_rows.length}   `);
  }
  console.log(`\n  ${M.key} done in ${Math.round((Date.now() - t0) / 1000)}s — ` +
    `elig ${out.eligibility_rows.length} · act ${out.activation_rows.length} · naf ${out.nafath_rows.length} failures`);
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const todo = MONTHS.filter(M => (!ONE || M.key === ONE));
  console.log(`Journey-errors extract · ${todo.length} month(s) → ${OUT}\n`);
  for (const M of todo) {
    const f = path.join(OUT, M.key + '.json');
    if (fs.existsSync(f) && !FORCE) { console.log(`  ${M.key} exists — skip (use --force to redo)`); continue; }
    const data = await extractMonth(M);
    fs.writeFileSync(f + '.tmp', JSON.stringify(data));
    fs.renameSync(f + '.tmp', f);            // atomic — a crash never leaves a half month
  }
  console.log('\nAll requested months written. Verify: row totals in each JSON should match the');
  console.log('probe\'s monthly failure counts; then scp the folder and run the workbook builder.');
  process.exit(0);
})().catch(e => { console.error('\nEXTRACT FAILED:', e.message); process.exit(1); });
