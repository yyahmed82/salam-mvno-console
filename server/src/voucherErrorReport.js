/* VOUCHER RECHARGE ERRORS — digital channel, business vs technical.
 *
 *   node src/voucherErrorReport.js 2026-08-01 2026-08-21
 *
 * Source: api_traffic_events (the console's own capture of the Digital API log on the API
 * hosts) filtered to the voucher recharge path. The app writes NO DB row for voucher recharges
 * (Api::V1::RechargeController#voucher calls BSS/Optiva directly and returns), so this capture
 * is the only per-transaction record we hold. Retention = API_LOG_RETENTION_DAYS (7 by default),
 * so ask for a longer window only if retention was raised.
 *
 * Classification uses the response codes confirmed by the platform team (20 Aug 2026):
 *   0  Success                                     → success
 *   0  FailedInBRM                                 → TECHNICAL  ← same code as success (defect)
 *   21 Voucher number does not exist in the system → business (customer typed a wrong number)
 *   21 Voucher already reserved                    → business  ← same code, different meaning
 *   22 Voucher Number marked used                  → business
 *   20 Invalid voucher number format               → business
 *   9  Voucher Recharge is blocked                 → business (policy)
 *   31 VOUCHER_RECHARGE service error 31           → TECHNICAL
 *   -704 (app rate limiter)                        → blocked_by_rate_limit (our own defect)
 */
'use strict';
const db = require('./db');

const cls = (code, msg) => {
  const m = String(msg || '').toLowerCase();
  const c = String(code == null ? '' : code).trim();
  if (c === '-704' || /maximum allowed requests/i.test(m)) return 'blocked_by_rate_limit';
  if (/failedinbrm/.test(m)) return 'TECHNICAL';          // MUST precede the success test:
  // live capture (20 Aug) shows success = "00" and FailedInBRM = "0" — different strings, but
  // identical once cast to a number, which is how most reports read them.
  if (c === '00' || /^success$/i.test(m)) return 'success';
  if (/service error/.test(m) || c === '31') return 'TECHNICAL';
  if (/does not exist|already reserved|marked used|invalid .*format|blocked/.test(m)) return 'BUSINESS';
  return 'BUSINESS';                                       // default: the API answered a business "no"
};

(async () => {
  const from = process.argv[2], to = process.argv[3];
  if (!from || !to) { console.error('usage: node src/voucherErrorReport.js YYYY-MM-DD YYYY-MM-DD'); process.exit(1); }
  const C = db.console;
  const r = await C.query(
    `SELECT coalesce(response_code,'(none)') code,
            coalesce(NULLIF(trim(response_message),''),'(no message)') msg,
            coalesce(err_class,'?') err_class,
            count(*)::int n,
            round(avg(duration_ms))::int avg_ms, max(duration_ms) max_ms,
            min(ts) first_seen, max(ts) last_seen
     FROM api_traffic_events
     WHERE path ILIKE '%voucher%' AND ts >= $1 AND ts < $2
     GROUP BY 1, 2, 3 ORDER BY n DESC`, [from, to]);

  if (!r.rows.length) {
    console.log('No voucher traffic captured in this window (check API_LOG_HOSTS collector + retention).');
    process.exit(0);
  }
  const agg = {}; let total = 0;
  const rows = r.rows.map(x => { const c = cls(x.code, x.msg); total += x.n; agg[c] = (agg[c] || 0) + x.n; return { ...x, cls: c }; });
  console.log(`\nVOUCHER RECHARGE ${from} → ${to} · ${total} attempts captured`);
  console.log('BY CLASS:');
  Object.entries(agg).sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(7)}  ${k.padEnd(22)} ${(100 * n / total).toFixed(1)}%`));
  const fails = total - (agg.success || 0);
  if (fails) {
    console.log(`\nFAILURES ONLY (${fails}): business ${(agg.BUSINESS || 0)} (${(100 * (agg.BUSINESS || 0) / fails).toFixed(1)}%) · technical ${(agg.TECHNICAL || 0)} (${(100 * (agg.TECHNICAL || 0) / fails).toFixed(1)}%)` +
      (agg.blocked_by_rate_limit ? ` · blocked by IP rate limiter ${agg.blocked_by_rate_limit}` : ''));
  }
  console.log('\nBY CODE · MESSAGE:');
  rows.forEach(x => console.log(
    `  ${String(x.n).padStart(7)}  code ${String(x.code).padEnd(6)} ${x.cls.padEnd(22)} ${String(x.msg).slice(0, 46).padEnd(48)} avg ${x.avg_ms}ms max ${x.max_ms}ms`));
  // the ambiguity check that matters for BI counting
  const zeroish = rows.filter(x => /^0+$/.test(String(x.code)));
  if (new Set(zeroish.map(x => String(x.code))).size > 1 || zeroish.length > 1) {
    console.log('\n⚠ ZERO-CODE COLLISION — these differ as text but are identical as numbers:');
    zeroish.forEach(x => console.log(`    code "${x.code}" · ${x.msg} → ${x.cls} (${x.n})`));
    console.log('    Any report casting response_code to a number counts FailedInBRM as success.');
  }
  const dup = {};
  rows.forEach(x => { (dup[String(x.code)] = dup[String(x.code)] || new Set()).add(String(x.msg)); });
  Object.entries(dup).filter(([c, s]) => s.size > 1 && c !== '0')
    .forEach(([c, s]) => console.log(`\n⚠ code ${c} maps to ${s.size} different messages: ${[...s].join(' | ')}`));
  require('fs').writeFileSync('/tmp/voucherErrorReport.json', JSON.stringify({ from, to, total, agg, rows }));
  console.log('\nJSON → /tmp/voucherErrorReport.json');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
