/* PAYMENT ERRORS — full classified catalog for the "Drop in Renewal Revenue" thread.
 * Every non-success payment in a period, segregated BUSINESS vs TECHNICAL with the console's
 * single source of truth (errclass.js — same rules as the Troubleshoot strip), by reason /
 * vendor / payment type / platform / card rail. Read-only, aggregated queries only.
 *
 * Run ON 152:
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/paymentErrorReport.js 2026-08-01 2026-08-19        # [from to)
 *
 * REASON DERIVATION uses analytics.DECLINE_EXPR verbatim — fail_reason first, else
 * "code · message" from payment_commit_response OR payment_initialization_response
 * #>>{gateway,response,...} (UPG/salam leave fail_reason empty and put the truth there).
 *
 * CLASSIFICATION HONESTY (v2 — after the first run showed 21k "technical (blank)"):
 *   • pending + no gateway answer      → 'never_attempted' (customer never reached/finished the
 *                                        payment page — NOT an error; this is the funnel gap)
 *   • pending + gateway answered       → 'stuck_callback'  (platform-side: money may be taken,
 *                                        our record never finalized — the true technical bucket)
 *   • failed + reason text             → errclass business/technical
 *   • failed + NO reason anywhere      → 'no_message' + rail split (Apple Pay / STC Pay return
 *                                        no acquirer message even on success — proven 19 Aug) */
'use strict';
const db = require('./db');
const analytics = require('./analytics');
const { classifyClass } = require('./errclass');

const CARD = `CASE card_type WHEN 0 THEN 'Apple Pay' WHEN 1 THEN 'Credit card' WHEN 2 THEN 'mada'
  WHEN 3 THEN 'Amex' WHEN 4 THEN 'STC Pay' WHEN 5 THEN 'Tasheel' WHEN 30 THEN 'Other'
  WHEN 60 THEN 'N/A' ELSE coalesce(card_type::text,'—') END`;
// did the gateway answer at all? (same ANS predicate the console funnel uses)
const ANS = `(payment_commit_response IS NOT NULL AND payment_commit_response::text NOT IN ('{}','null'))`;

(async () => {
  const from = process.argv[2], to = process.argv[3];
  if (!from || !to) { console.error('usage: node src/paymentErrorReport.js YYYY-MM-DD YYYY-MM-DD'); process.exit(1); }

  const base = await db.source.query(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE status='success')::int success,
            count(*) FILTER (WHERE status IN ('fail','failed'))::int failed,
            count(*) FILTER (WHERE status='pending')::int pending,
            count(*) FILTER (WHERE status='pending' AND ${ANS})::int pending_answered
     FROM payments WHERE created_at >= $1 AND created_at < $2`, [from, to]);
  const B = base.rows[0];

  const r = await db.source.query(`
    SELECT (${analytics.DECLINE_EXPR}) AS reason,
           coalesce(payment_commit_response#>>'{gateway,response,code}',
                    payment_initialization_response#>>'{gateway,response,code}','') AS gw_code,
           status, coalesce(vendor,'?') vendor, coalesce(payment_on_type,'?') ptype,
           coalesce(platform,'?') platform, ${CARD} AS rail, ${ANS} AS answered,
           count(*)::int n, coalesce(sum(amount),0)::numeric amt
    FROM payments
    WHERE created_at >= $1 AND created_at < $2 AND status <> 'success'
    GROUP BY 1,2,3,4,5,6,7,8`, [from, to]);

  const A = { total: 0, cls: {}, clsAmt: {}, reasons: {}, vendor: {}, type: {}, rail: {}, platform: {} };
  const bump = (o, k, n) => { o[k] = (o[k] || 0) + n; };
  for (const x of r.rows) {
    const failed = x.status === 'fail' || x.status === 'failed';
    const hasReason = x.reason && x.reason !== '—';
    let cls;
    if (!failed) cls = x.answered ? 'stuck_callback' : 'never_attempted';
    else if (hasReason) cls = classifyClass({ ok: false, status_code: x.gw_code, response: x.reason }).cls;
    else cls = 'no_message';
    A.total += x.n;
    bump(A.cls, cls, x.n); bump(A.clsAmt, cls, Number(x.amt) || 0);
    bump(A.reasons, `${hasReason ? x.reason : `(no message · ${x.rail})`}||${cls}`, x.n);
    bump(A.vendor, `${x.vendor}||${cls}`, x.n);
    bump(A.type, `${x.ptype}||${cls}`, x.n);
    bump(A.rail, `${x.rail}||${cls}`, x.n);
    bump(A.platform, `${x.platform}||${cls}`, x.n);
  }

  const pc = n => B.total ? ` (${(100 * n / B.total).toFixed(1)}%)` : '';
  console.log(`\nPAYMENTS ${from} → ${to}`);
  console.log(`  total ${B.total}  ·  success ${B.success}${pc(B.success)}  ·  failed ${B.failed}${pc(B.failed)}  ·  pending ${B.pending}${pc(B.pending)} (gateway answered: ${B.pending_answered})`);
  console.log('\nNON-SUCCESS BY CLASS (count · SAR):');
  Object.entries(A.cls).sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
    console.log(`  ${String(n).padStart(7)}  ${k.padEnd(16)} ${Math.round(A.clsAmt[k] || 0).toLocaleString()} SAR`));
  const dump = (title, obj, lim) => {
    console.log(`\n${title}:`);
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, lim).forEach(([k, n]) => {
      const [a, cls] = k.split('||');
      console.log(`  ${String(n).padStart(7)}  ${cls.padEnd(16)} ${a.slice(0, 74)}`);
    });
  };
  dump('TOP REASONS', A.reasons, 40);
  dump('BY VENDOR', A.vendor, 20);
  dump('BY PAYMENT TYPE', A.type, 24);
  dump('BY CARD RAIL', A.rail, 20);
  dump('BY PLATFORM', A.platform, 14);
  require('fs').writeFileSync('/tmp/paymentErrorReport.json',
    JSON.stringify({ from, to, base: B, ...A }));
  console.log('\nJSON → /tmp/paymentErrorReport.json');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
