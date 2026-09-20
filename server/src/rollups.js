/* Hourly rollups — pre-aggregate journey outcomes so dashboards read summaries,
 * not the multi-GB source tables. Filled incrementally by the sync watcher + a bounded
 * boot backfill. Idempotent: refreshing a window deletes + re-inserts that window. */
const db = require('./db');
const errclass = require('./errclass');   // Business vs Technical — single source of truth

const DELIVERY_OK = ['delivered', 'completed', 'DELIVERED', 'DL', 'POD'];
const DELIVERY_FAIL = ['cancelled', 'canceled', 'deleted', 'RTO', 'CANCELLED', 'PUX43', 'returned', 'reverseReturned',
  'shipmentCanceled', 'reverseShipmentCanceled', 'REFUSED', 'onhold', 'pickup_failed', 'DEX93', 'RD',
  'DEX07-3', 'DEX07-4', 'DEX07-5', 'DEX07-6', 'DEX07-7', 'DEX07-8', 'DEX93-1', 'DEX93-2', 'DEX93-3', 'DEX93-4', 'DEX07'];

// journey → source table + outcome/platform SQL expressions (mirrors errors.js / analytics semantics)
const SPECS = [
  { journey: 'onboarding',  table: 'onboarding_orders', outcome: "'total'", platform: "''" },   // onboarding_orders has no 'channel' col — was erroring & silently skipping the whole journey
  { journey: 'checkout',    table: 'checkouts',         outcome: "'total'", platform: "''" },
  { journey: 'payment',     table: 'payments',          outcome: "case when status='success' then 'ok' when status in ('fail','failed') then 'fail' else 'pending' end", platform: "coalesce(platform,'')", vendorCol: "coalesce(vendor,'')" },
  { journey: 'activation',  table: 'activation_logs',   where: "api not ilike '%semati%'", outcome: "case when state then 'ok' else 'fail' end", platform: "coalesce(platform,'')" },
  { journey: 'semati',      table: 'activation_logs',   where: "api ilike '%semati%'", outcome: "case when state then 'ok' else 'fail' end", platform: "coalesce(platform,'')" },
  { journey: 'eligibility', table: 'eligibility_logs',  outcome: "case when state then 'ok' else 'fail' end", platform: "''" },
  { journey: 'nafath',      table: 'nafath_logs',       outcome: "case when lower(status)='completed' then 'ok' when lower(status) in ('expired','rejected','failed','denied','cancelled') then 'fail' else 'pending' end", platform: "''" },
  { journey: 'change_plan', table: 'change_plan_logs',  outcome: "case when status=1 then 'ok' when status=2 then 'fail' else 'pending' end", platform: "''" },
  { journey: 'delivery',    table: 'delivery_requests', deliv: true, outcome: "case when delivery_state = any($3) then 'ok' when delivery_state = any($4) then 'fail' else 'pending' end", platform: "coalesce(vendor,'')", vendorCol: "coalesce(vendor,'')" }
];

const floorHour = d => new Date(Math.floor(new Date(d).getTime() / 3600e3) * 3600e3);
const ceilHour  = d => new Date(Math.ceil(new Date(d).getTime() / 3600e3) * 3600e3);

// Refresh rollups for [from, to) (aligned to hour boundaries). Idempotent per journey+window.
async function refresh(fromISO, toISO) {
  const S = db.source, C = db.console;
  const from = floorHour(fromISO).toISOString();
  const to = ceilHour(toISO).toISOString();
  let rows = 0;
  for (const s of SPECS) {
    let agg;
    const p = s.deliv ? [from, to, DELIVERY_OK, DELIVERY_FAIL] : [from, to];
    const where = `created_at >= $1::timestamptz AND created_at < $2::timestamptz` + (s.where ? ` AND ${s.where}` : '');
    /* ERROR CLASS (20 Sep 2026) — classify each FAILURE as business or technical so an SLO can be
     * told to count only one kind. The expression per source table comes from errclass.sourceCls(),
     * the same one the Troubleshoot board uses, and is resolved HERE (per refresh) rather than at
     * module load so an operator's errclass_overrides take effect without a restart. ok / pending /
     * total rows keep '' — the class of a success is not a thing, and leaving them blank is what
     * keeps every existing reader summing over the old keys correct. */
    const clsSql = errclass.sourceCls(s.table);
    const clsExpr = clsSql ? `CASE WHEN (${s.outcome}) = 'fail' THEN (${clsSql}) ELSE '' END` : `''`;
    const sql = `SELECT date_trunc('hour', created_at) AS h, ${s.outcome} AS oc, ${s.platform} AS pf, ${clsExpr} AS cl, count(*)::bigint AS c
                 FROM "${s.table}" WHERE ${where} GROUP BY 1,2,3,4`;
    try { agg = (await S.query(sql, p)).rows; }
    catch (e) {
      // Don't silently swallow: a bad column expr / missing table would otherwise show as a
      // perpetual 0 for this journey (exactly how "orders today" hid). Log it loudly.
      console.error(`[ROLLUP] journey "${s.journey}" skipped: ${e.message}`);
      try { await C.query(`INSERT INTO console_errors (level, message, route, meta) VALUES ('error',$1,'rollups.refresh',$2)`,
        [`rollup "${s.journey}" query failed: ${e.message}`.slice(0, 500), JSON.stringify({ journey: s.journey, table: s.table })]); } catch (_) {}
      continue;
    }
    await C.query(`DELETE FROM rollup_hourly WHERE journey=$1 AND hour >= $2 AND hour < $3`, [s.journey, from, to]);
    for (const r of agg) {
      await C.query(
        `INSERT INTO rollup_hourly (hour, journey, outcome, platform, err_class, cnt) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (hour, journey, outcome, platform, err_class) DO UPDATE SET cnt=EXCLUDED.cnt`,
        [r.h, s.journey, r.oc, r.pf || '', r.cl || '', Number(r.c)]);
      rows++;
    }
    // per-vendor rollup for journeys that have a vendor/partner column (payment gateways, couriers)
    if (s.vendorCol) {
      try {
        const vsql = `SELECT date_trunc('hour', created_at) AS h, ${s.vendorCol} AS vn, ${s.outcome} AS oc, count(*)::bigint AS c
                      FROM "${s.table}" WHERE ${where} GROUP BY 1,2,3`;
        const vagg = (await S.query(vsql, p)).rows;
        await C.query(`DELETE FROM rollup_vendor_hourly WHERE journey=$1 AND hour >= $2 AND hour < $3`, [s.journey, from, to]);
        for (const r of vagg) {
          await C.query(
            `INSERT INTO rollup_vendor_hourly (hour, journey, vendor, outcome, cnt) VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (hour, journey, vendor, outcome) DO UPDATE SET cnt=EXCLUDED.cnt`,
            [r.h, s.journey, r.vn || '', r.oc, Number(r.c)]);
        }
      } catch (e) {}
    }
  }
  return { rows, from, to };
}

async function sourceLatest() {
  try { const m = (await db.source.query(`SELECT max(created_at) m FROM onboarding_orders`)).rows[0].m; if (m) return new Date(m); } catch (e) {}
  try { const m = (await db.source.query(`SELECT max(created_at) m FROM payments`)).rows[0].m; if (m) return new Date(m); } catch (e) {}
  return new Date();
}

// Bounded backfill (default last 90 days of data), chunked by day to keep each aggregate small.
async function backfill({ days = 90 } = {}) {
  const anchor = await sourceLatest();
  const end = ceilHour(new Date(anchor.getTime() + 3600e3));
  let cur = new Date(end.getTime() - days * 24 * 3600e3);
  let total = 0, chunks = 0;
  while (cur < end) {
    const next = new Date(Math.min(cur.getTime() + 24 * 3600e3, end.getTime()));
    const r = await refresh(cur.toISOString(), next.toISOString());
    total += r.rows; chunks++;
    cur = next;
  }
  return { rows: total, chunks, days, through: end.toISOString() };
}

async function isEmpty() {
  try { return Number((await db.console.query(`SELECT count(*) c FROM rollup_hourly`)).rows[0].c) === 0; }
  catch (e) { return true; }
}

module.exports = { refresh, backfill, isEmpty, SPECS };
