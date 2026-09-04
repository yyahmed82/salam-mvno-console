/* PROBE — where does the decline reason actually live?
 * The first catalog run proved the app stores NO reason text for 20,525 August failures
 * (vendor 'salam'); only hyperpay rows carry fail_reason. Before building the final classified
 * catalog we must know: (a) what IS inside payment_commit_response / payment_initialization_response
 * for failed salam payments, (b) whether card_type is real or defaulted, (c) whether the UPG DB
 * can supply the missing reasons by reference id (it can — proven 19 Aug on the exports).
 *
 * Run ON 152:
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/paymentErrorProbe.js 2026-08-01 2026-08-19
 * Read-only everywhere. UPG side is index-gated and capped. PII masked in samples. */
'use strict';
const db = require('./db');

const mask = s => String(s == null ? '' : s)
  .replace(/(\+?966|00966|0)?5\d{8}/g, m => m.slice(0, 3) + '*****' + m.slice(-2))
  .replace(/\b[12]\d{9}\b/g, m => m.slice(0, 2) + '******' + m.slice(-2))
  .replace(/\b\d{12,19}\b/g, m => m.slice(0, 4) + '••••' + m.slice(-2));

(async () => {
  const from = process.argv[2], to = process.argv[3];
  if (!from || !to) { console.error('usage: node src/paymentErrorProbe.js YYYY-MM-DD YYYY-MM-DD'); process.exit(1); }
  const P = [from, to];
  const FAIL = `status IN ('fail','failed')`;

  console.log(`\n=== A. what the app stores for FAILED payments (${from} → ${to}) ===`);
  const shape = await db.source.query(`
    SELECT coalesce(vendor,'?') vendor,
      count(*)::int n,
      count(*) FILTER (WHERE NULLIF(trim(fail_reason),'') IS NOT NULL)::int has_fail_reason,
      count(*) FILTER (WHERE payment_commit_response IS NOT NULL
                        AND payment_commit_response::text NOT IN ('{}','null'))::int has_commit,
      count(*) FILTER (WHERE payment_initialization_response IS NOT NULL
                        AND payment_initialization_response::text NOT IN ('{}','null'))::int has_init,
      count(*) FILTER (WHERE payment_commit_response#>>'{gateway,response,message}' IS NOT NULL)::int has_gw_msg
    FROM payments WHERE created_at >= $1 AND created_at < $2 AND ${FAIL}
    GROUP BY 1 ORDER BY n DESC`, P);
  shape.rows.forEach(r => console.log(`  ${r.vendor.padEnd(10)} n=${String(r.n).padStart(6)} fail_reason=${r.has_fail_reason} commit=${r.has_commit} init=${r.has_init} gateway.response.message=${r.has_gw_msg}`));

  console.log(`\n=== B. top-level keys inside the stored responses (failed only) ===`);
  for (const col of ['payment_commit_response', 'payment_initialization_response']) {
    const k = await db.source.query(`
      SELECT key, count(*)::int n FROM payments p,
        LATERAL jsonb_object_keys(p.${col}) AS key
      WHERE p.created_at >= $1 AND p.created_at < $2 AND ${FAIL}
        AND p.${col} IS NOT NULL AND p.${col}::text NOT IN ('{}','null')
      GROUP BY 1 ORDER BY n DESC LIMIT 12`, P);
    console.log(`  ${col}: ` + (k.rows.map(r => `${r.key}(${r.n})`).join(' ') || '— empty —'));
  }

  console.log(`\n=== C. two masked samples of a failed payment payload ===`);
  const s = await db.source.query(`
    SELECT vendor, status, payment_reference_id,
           left(payment_commit_response::text, 700) commit_txt,
           left(payment_initialization_response::text, 400) init_txt
    FROM payments WHERE created_at >= $1 AND created_at < $2 AND ${FAIL}
      AND coalesce(vendor,'') = 'salam' ORDER BY created_at DESC LIMIT 2`, P);
  s.rows.forEach((r, i) => {
    console.log(`  [${i + 1}] vendor=${r.vendor} ref=${r.payment_reference_id}`);
    console.log(`      commit: ${mask(r.commit_txt) || '(null)'}`);
    console.log(`      init  : ${mask(r.init_txt) || '(null)'}`);
  });

  console.log(`\n=== D. is card_type real? (failed payments) ===`);
  const ct = await db.source.query(`
    SELECT coalesce(card_type::text,'null') ct, count(*)::int n
    FROM payments WHERE created_at >= $1 AND created_at < $2 AND ${FAIL}
    GROUP BY 1 ORDER BY n DESC LIMIT 8`, P);
  console.log('  ' + ct.rows.map(r => `${r.ct}:${r.n}`).join('  '), '(0=Apple Pay 1=Credit 2=mada 4=STC)');

  console.log(`\n=== E. can UPG supply the missing reasons? (sample 300 refs) ===`);
  const upg = require('./upgLink');
  if (!upg.configured()) { console.log('  UPG_DATABASE_URL not set — skipped'); }
  else {
    const refs = (await db.source.query(
      `SELECT payment_reference_id r FROM payments
       WHERE created_at >= $1 AND created_at < $2 AND ${FAIL}
         AND payment_reference_id IS NOT NULL ORDER BY created_at DESC LIMIT 300`, P)).rows.map(x => x.r);
    const got = await upg.reasonsForRefs(refs);
    if (!got) console.log('  UPG not configured');
    else if (got.error) console.log('  ' + got.error);
    else {
      console.log(`  matched ${got.matched}/${got.requested} refs at UPG · reasons (message · source):`);
      Object.entries(got.reasons).sort((a, b) => b[1] - a[1]).slice(0, 18)
        .forEach(([k, n]) => console.log(`    ${String(n).padStart(5)}  ${k}`));
    }
  }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
