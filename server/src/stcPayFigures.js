/* STC PAY — the two series the removal request needs, per month.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/stcPayFigures.js              # last 12 months
 *   node src/stcPayFigures.js --months 6
 *
 * OUTPUT
 *   ① a readable monthly table, and
 *   ② a one-line JSON block (marked CHART-JSON) to paste back for the chart.
 *
 * THE TWO SERIES (and nothing else — the mail is about STC Pay only):
 *   share_pct   = STC Pay payments ÷ ALL payments that month  ("how much of our traffic is it")
 *   success_pct = STC Pay success ÷ STC Pay ATTEMPTED that month
 *                 attempted = total − never-attempted (status 'pending' with no gateway answer),
 *                 the same denominator the Payment-Errors Catalogue uses, so the numbers
 *                 reconcile with what BI already has.
 *   other_success_pct = the same measure for every non-STC rail — the honest comparison line.
 *
 * Rail = payment_commit_response#>>'{data,source}', the console's standard expression.
 * Read-only, one bounded query, indexed on created_at.
 */
'use strict';
const db = require('./db');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const MONTHS = Math.max(3, Math.min(24, Number(arg('--months', 12))));
const RAIL = `lower(coalesce(p.payment_commit_response#>>'{data,source}',''))`;
const ANSWERED = `(p.payment_commit_response IS NOT NULL AND p.payment_commit_response::text NOT IN ('{}','null'))`;

(async () => {
  console.log(`STC Pay — monthly share and success rate · last ${MONTHS} months\n`);

  const rows = (await db.source.query(`
    SELECT to_char(date_trunc('month', p.created_at), 'YYYY-MM') AS mo,
           (${RAIL} LIKE '%stc%') AS is_stc,
           count(*)::int total,
           count(*) FILTER (WHERE p.status='success')::int ok,
           count(*) FILTER (WHERE p.status IN ('fail','failed'))::int failed,
           count(*) FILTER (WHERE p.status='pending' AND NOT ${ANSWERED})::int never_attempted
      FROM payments p
     WHERE p.created_at >= date_trunc('month', now()) - ($1||' months')::interval
       AND p.created_at < date_trunc('month', now()) + interval '1 month'
     GROUP BY 1,2 ORDER BY 1,2`, [String(MONTHS - 1)])).rows;

  const by = new Map();
  for (const r of rows) {
    const m = by.get(r.mo) || { mo: r.mo, stc: null, oth: null };
    const cell = { total: +r.total, ok: +r.ok, failed: +r.failed, att: +r.total - +r.never_attempted };
    if (r.is_stc) m.stc = cell;
    else m.oth = m.oth
      ? { total: m.oth.total + cell.total, ok: m.oth.ok + cell.ok, failed: m.oth.failed + cell.failed, att: m.oth.att + cell.att }
      : cell;
    by.set(r.mo, m);
  }

  const out = [];
  console.log('MONTH     STC PAYMENTS   SHARE%   STC SUCCESS%   STC FAILED   OTHER RAILS SUCCESS%');
  for (const m of [...by.values()].sort((a, b) => a.mo.localeCompare(b.mo))) {
    const s = m.stc || { total: 0, ok: 0, failed: 0, att: 0 };
    const o = m.oth || { total: 0, ok: 0, failed: 0, att: 0 };
    const allTot = s.total + o.total;
    const share = allTot ? 100 * s.total / allTot : 0;
    const sSucc = s.att ? 100 * s.ok / s.att : null;
    const oSucc = o.att ? 100 * o.ok / o.att : null;
    console.log(`${m.mo}  ${String(s.total).padStart(12)}  ${share.toFixed(2).padStart(6)}%  ` +
      `${(sSucc == null ? '—' : sSucc.toFixed(2)).padStart(12)}%  ${String(s.failed).padStart(10)}  ` +
      `${(oSucc == null ? '—' : oSucc.toFixed(2)).padStart(18)}%`);
    out.push({ mo: m.mo, stc: s.total, share: +share.toFixed(2),
      succ: sSucc == null ? null : +sSucc.toFixed(2), failed: s.failed,
      other_succ: oSucc == null ? null : +oSucc.toFixed(2), all: allTot });
  }

  const T = out.reduce((a, r) => ({ stc: a.stc + r.stc, all: a.all + r.all, failed: a.failed + r.failed }),
    { stc: 0, all: 0, failed: 0 });
  console.log(`\nPERIOD TOTAL: STC Pay ${T.stc.toLocaleString()} of ${T.all.toLocaleString()} payments ` +
    `= ${(100 * T.stc / (T.all || 1)).toFixed(2)}% · ${T.failed.toLocaleString()} failed`);

  console.log('\n--- CHART-JSON (copy this whole line) ---');
  console.log(JSON.stringify(out));
  console.log('--- end ---');
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
