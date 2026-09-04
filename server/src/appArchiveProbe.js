/* WHERE ELSE COULD THE 2025 PAYMENT REFERENCES BE? — replica-only, no gateway load at all.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/appArchiveProbe.js
 *
 * THE PROBLEM, STATED PRECISELY
 * UPG has exactly four indexes and every one of them is on an identifier:
 *     invoices : invoices_pkey (id)                          ← the only index on that table
 *     payments : (invoice_id, updated_at DESC) · (id) · (transaction_id)
 * There is no index on any timestamp, so UPG cannot be asked "what happened in March 2025". It can
 * only be asked "what happened to invoice <id>". Every export we have run works by reading the APP
 * REPLICA by date, collecting payment_reference_id values, and handing those ids to UPG.
 *
 * Sep 2025 → Aug 2026 works because the replica has those months. Jan and Mar–Aug 2025 fail because
 * payments has no rows there — so we have no ids to ask with. UPG still holds the data (coverage
 * starts 2024-11-11); we lost the keys, not the gateway.
 *
 * SO THE REAL QUESTION IS NOT "can UPG be indexed" BUT "where else do those reference ids live".
 * Asking the UPG DBA for an index is the fallback, not the first move. This probe checks our own
 * side first, because if the keys are recoverable here the months unblock with no change to a live
 * production gateway and no waiting on anyone.
 *
 * Three places they might be:
 *   1. payments itself, behind an archived flag — the table carries archived / archived_at, so
 *      "no rows" may really mean "no rows matching the default filter"
 *   2. a separate archive table (payments_archive, archived_payments, payments_old, …)
 *   3. onboarding_orders (data from 2022-01) and checkouts (from 2022-06) — NEITHER has the gap.
 *      If either carries a payment reference / invoice id, the keys for the missing months are
 *      already sitting in our replica.
 *
 * SAFETY: read-only, replica only, catalogue reads plus bounded per-month probes. Nothing here
 * touches UPG or the live app database.
 */
'use strict';
const db = require('./db');

const q = (sql, p = []) => db.source.query(sql, p).then(r => r.rows);
const MISSING = ['2025-01', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08'];
const pad = n => String(n).padStart(2, '0');
const nextMonth = ym => { let [y, m] = ym.split('-').map(Number); if (++m > 12) { m = 1; y++; } return `${y}-${pad(m)}-01`; };
const d10 = v => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : '—'));

(async () => {
  /* ---- 1. is payments a table or a filtered view, and what archive columns exist? --------- */
  console.log('=== 1 · payments — object type and archive columns ===');
  const kind = await q(`SELECT table_type FROM information_schema.tables
                         WHERE table_schema='public' AND table_name='payments'`);
  console.log('  object type:', kind.length ? kind[0].table_type : '(not found)');
  const cols = await q(`SELECT column_name, data_type FROM information_schema.columns
                         WHERE table_name='payments'
                           AND (column_name ILIKE '%archiv%' OR column_name ILIKE '%delet%'
                                OR column_name ILIKE '%purge%')
                         ORDER BY column_name`);
  console.log('  archive-ish columns:', cols.length ? cols.map(c => `${c.column_name} (${c.data_type})`).join(', ') : 'NONE');

  /* If an archived flag exists, the earlier "0 rows" result may simply have been the live subset.
   * Count WITHOUT any status/archive filter for one missing month and see. */
  if (cols.some(c => /archiv/i.test(c.column_name))) {
    console.log('\n  counting May 2025 with NO archive filter (the earlier probes may have been reading a subset):');
    try {
      const r = (await q(`SELECT count(*)::bigint n FROM payments
                           WHERE created_at >= '2025-05-01' AND created_at < '2025-06-01'`))[0];
      console.log(`    payments rows in May 2025: ${Number(r.n).toLocaleString()}`);
    } catch (e) { console.log('    failed:', e.message.slice(0, 90)); }
  }

  /* ---- 2. any archive / shadow table? ------------------------------------------------------ */
  console.log('\n=== 2 · candidate archive tables ===');
  const tabs = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public'
        AND (table_name ILIKE '%payment%' OR table_name ILIKE '%archive%' OR table_name ILIKE '%_old%'
             OR table_name ILIKE '%history%')
      ORDER BY table_name`);
  console.log('  ' + (tabs.map(t => t.table_name).join(', ') || '(none)'));

  /* ---- 3. WHO ELSE HOLDS A PAYMENT REFERENCE? --------------------------------------------
   * This is the one that could unblock everything. Find every column in the schema whose name
   * looks like a payment reference or invoice id — then check which of those tables actually
   * covers the missing months. */
  console.log('\n=== 3 · every column that looks like a payment reference / invoice id ===');
  const refCols = await q(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema='public'
        AND (column_name ILIKE '%payment_reference%' OR column_name ILIKE '%invoice%'
             OR column_name = 'reference_id' OR column_name ILIKE '%payment_id%')
      ORDER BY table_name, column_name`);
  refCols.forEach(r => console.log(`  ${r.table_name.padEnd(30)} ${r.column_name.padEnd(26)} ${r.data_type}`));
  if (!refCols.length) console.log('  (none)');

  /* ---- 4. do those tables cover the missing months, and is the reference populated? -------- */
  console.log('\n=== 4 · coverage of the missing months, per candidate table ===');
  const candidates = [...new Set(refCols.map(r => r.table_name))]
    .filter(t => t !== 'payments');
  for (const t of candidates) {
    // does the table even have created_at? without it we cannot window by month
    const hasCreated = (await q(`SELECT 1 FROM information_schema.columns
                                  WHERE table_name=$1 AND column_name='created_at'`, [t])).length;
    if (!hasCreated) { console.log(`  ${t.padEnd(30)} no created_at — skipped`); continue; }
    const myCols = refCols.filter(r => r.table_name === t).map(r => r.column_name);
    try {
      const span = (await q(`SELECT min(created_at) lo, max(created_at) hi, count(*)::bigint n FROM ${t}`))[0];
      const parts = [];
      for (const ym of MISSING) {
        const r = (await q(`SELECT count(*)::bigint n FROM ${t}
                             WHERE created_at >= $1 AND created_at < $2`, [`${ym}-01`, nextMonth(ym)]))[0];
        parts.push(`${ym.slice(2)}:${Number(r.n).toLocaleString()}`);
      }
      console.log(`  ${t}`);
      console.log(`     span ${d10(span.lo)} → ${d10(span.hi)}  total ${Number(span.n).toLocaleString()}`);
      console.log(`     missing months → ${parts.join('  ')}`);
      // how many of those rows actually carry a non-null reference in one missing month?
      for (const c of myCols) {
        const r = (await q(
          `SELECT count(*)::bigint n, count(${c})::bigint filled FROM ${t}
            WHERE created_at >= '2025-05-01' AND created_at < '2025-06-01'`))[0];
        const tot = Number(r.n), filled = Number(r.filled);
        if (tot) console.log(`     May-25 ${c}: ${filled.toLocaleString()} of ${tot.toLocaleString()} populated`
                           + `${filled ? '   ← USABLE AS KEYS' : ''}`);
      }
      const sample = await q(
        `SELECT ${myCols.join(', ')} FROM ${t}
          WHERE created_at >= '2025-05-01' AND created_at < '2025-06-01' LIMIT 3`);
      if (sample.length) console.log('     sample: ' + JSON.stringify(sample));
    } catch (e) { console.log(`  ${t.padEnd(30)} probe failed: ${e.message.slice(0, 80)}`); }
  }

  /* ---- 5. the answer ----------------------------------------------------------------------- */
  console.log('\n=== WHAT THIS DECIDES ===');
  console.log('  If any table above covers Mar–Aug 2025 with a populated reference/invoice column,');
  console.log('  those references ARE the keys and the missing months can be exported against UPG');
  console.log('  with no new index and no gateway change — the same invoice_id lookup we already use.');
  console.log('  If nothing covers them, the keys are genuinely gone from our side, and the only');
  console.log('  remaining route is an index on UPG so it can be read by date:');
  console.log('     CREATE INDEX CONCURRENTLY idx_invoices_created_at ON invoices (created_at);');
  process.exit(0);
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
