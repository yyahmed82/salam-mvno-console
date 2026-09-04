/* UPG WEB vs MOBILE-APP SPLIT — daily August (or any month) extract (3 Sep 2026).
 * Question (Yosri): "from UPG, daily line chart + table of all payments with Web vs Mobile-app
 * percentage". Two truths, both extracted:
 *   1. APP REPLICA payments.platform — the definitive channel stamp (web / ios / android),
 *      restricted to UPG-rail payments (payment_reference_id = UPG invoice shape). PRIMARY.
 *   2. UPG payments.channel — the gateway's own channel field, daily census. CROSS-CHECK
 *      (values are whatever UPG stores; index-gated on payments(created_at) per house rule).
 * Raw values are NOT collapsed here — the workbook builder groups them and shows unknowns
 * honestly. Bounded: month window, aggregates only, no PII.
 *
 * Run on 152:  cd /apps/console/server && set -a; . ../.env; set +a
 *              node src/upgChannelSplit.js --month 2026-08
 * Output: /tmp/upg-channel-<month>.json  → scp back → tools/build-upg-channel-xlsx.py */
'use strict';
const db = require('./db');

async function extract(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('use --month YYYY-MM');
  const from = `${month}-01T00:00:00+03:00`;
  const to = new Date(new Date(from).getTime());
  to.setUTCMonth(to.getUTCMonth() + 1);
  const toIso = to.toISOString();

  /* 1 · app replica: daily × platform × status for UPG-rail payments (12-char invoice ref) */
  const app = (await db.source.query(`
    SELECT (created_at AT TIME ZONE 'UTC' + interval '3 hours')::date AS day,
           lower(coalesce(nullif(platform,''),'(not stamped)')) AS platform,
           count(*)::int AS n,
           count(*) FILTER (WHERE status = 'success')::int AS ok,
           sum(amount) FILTER (WHERE status = 'success')::numeric AS ok_amount
      FROM payments
     WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
       AND payment_reference_id ~ '^[a-z0-9]{10,14}$'
     GROUP BY 1, 2 ORDER BY 1, 2`, [from, toIso])).rows;

  /* 2 · UPG gateway: daily × channel census (index-gated: payments(created_at)) */
  let upg = null, upgNote = null;
  try {
    const link = require('./upgLink');
    if (link.configured && link.configured()) {
      const ix = (await db.upg.query(`SELECT indexdef FROM pg_indexes WHERE tablename='payments'`)).rows;
      const hasCreated = ix.some(r => /\(created_at/.test(r.indexdef));
      if (!hasCreated) upgNote = 'UPG payments.created_at not indexed — gateway census skipped (protection rule)';
      else upg = (await db.upg.query(`
        SELECT (created_at AT TIME ZONE 'UTC' + interval '3 hours')::date AS day,
               lower(coalesce(nullif(channel,''),'(no channel)')) AS channel,
               count(*)::int AS n,
               count(*) FILTER (WHERE status = 'CAPTURED' OR status = 'PAID' OR status ILIKE '%captur%')::int AS captured
          FROM payments
         WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
         GROUP BY 1, 2 ORDER BY 1, 2`, [from, toIso])).rows;
    } else upgNote = 'UPG pool not configured';
  } catch (e) { upgNote = 'UPG census failed: ' + e.message.slice(0, 120); }

  return { month, from, to: toIso, generated_at: new Date().toISOString(),
           app_daily: app, upg_daily: upg, upg_note: upgNote };
}

if (require.main === module) {
  (async () => {
    const mi = process.argv.indexOf('--month');
    const month = mi > -1 ? process.argv[mi + 1] : null;
    if (!month) { console.error('usage: node src/upgChannelSplit.js --month 2026-08'); process.exit(1); }
    const out = await extract(month);
    const fs = require('fs');
    const f = `/tmp/upg-channel-${month}.json`;
    fs.writeFileSync(f, JSON.stringify(out));
    fs.chmodSync(f, 0o644);
    console.log(`wrote ${f} · app rows ${out.app_daily.length} · upg rows ${(out.upg_daily || []).length}`
      + (out.upg_note ? ` · note: ${out.upg_note}` : ''));
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { extract };
