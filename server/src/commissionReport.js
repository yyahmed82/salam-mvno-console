/* DMS COMMISSION REPORT — the "Flex packages commission" list Sales Ops currently requests by
 * mail (Re: Flex Packages Commission Scheme Update, 30-31 Aug 2026: Khalid asks, DMS app team
 * hand-runs SQL, a table with full MSISDNs/National IDs goes to a 20-person thread). This module
 * produces the SAME columns self-service — masked by default, audited, filtered, exportable.
 *
 * SOURCE OF TRUTH — CORRECTED 31 Aug 2026 (find-activation-ledger.cjs):
 *   dms_audit_logs.sim_activation_logs (~2.1M rows, 59 cols) — the REAL per-activation ledger:
 *     plan name/id/price, channel_username/code, customer id, ICCID, commission_sync, payment.
 *   (dms_v1.dms_sim_activation_report is a log of who PULLED the report — 4 columns. Trap.)
 *   dms_v1.renew_now_commission_rules (~51 rows) — the rate table. The ledger has NO amount
 *   column; DMS computes amount = plan price × plan %, so we JOIN the rules and do the same,
 *   which reproduces the mail's numbers (33 SAR = 30% × 110). Labelled as computed.
 *   Self-activation channel ledger: dms_v1.report_request_self_activation (phase 2 source).
 *
 * DISCOVERY, NOT HARD-CODING (house rule from dmsDb.js: we did not write this schema).
 * Every logical field resolves against information_schema through dmsDb.pick() with a candidate
 * list. An unresolvable field comes back null and is REPORTED in `fields` — the report degrades,
 * it never 500s, and the caller can see exactly which columns the schema did not offer.
 *
 * READ-ONLY BY CONSTRUCTION · window capped · LIMIT capped · one indexed time predicate.
 */
'use strict';
const dms = require('./dmsDb');

const SCHEMA = process.env.DMS_COMMISSION_SCHEMA || 'dms_audit_logs';
const TABLE = process.env.DMS_COMMISSION_TABLE || 'sim_activation_logs';
const RULES_SCHEMA = process.env.DMS_COMMISSION_RULES_SCHEMA || 'dms_v1';
const MAX_ROWS = Math.max(100, Number(process.env.DMS_COMMISSION_MAX_ROWS || 20000));
const MAX_DAYS = 92;

/* logical field -> candidate physical columns, in preference order (the mail's own header names
 * first, then common DMS spellings). Extend here if discovery shows a different name. */
const FIELDS = {
  rid:          ['id'],                       // ledger PK — server-side timeline reference (dmsrow)
  msisdn:       ['mobile_number', 'msisdn', 'mobile_no', 'mobile'],
  dealer:       ['channel_username', 'dealer_username', 'username', 'pos_username', 'channel_user'],
  at:           ['insert_date_time', 'insert_datetime', 'created_at', 'created_date', 'activation_date', 'created_on'],
  customer_id:  ['customer_id_number', 'customer_id', 'id_number', 'national_id'],
  commission:   ['commission', 'commission_sync', 'commission_flag', 'is_commission', 'commission_applicable'],
  iccid:        ['sim_iccid_number', 'iccid', 'sim_iccid', 'iccid_number'],
  plan:         ['price_plan_name', 'plan_name', 'price_plan', 'package_name'],
  plan_id:      ['price_plan_id', 'plan_id', 'package_id'],
  price:        ['price_plan_price', 'plan_price', 'price', 'amount'],
  commission_amount: ['commission_amount', 'comission_amount', 'commission_value', 'comm_amount'],
  activation_type:   ['activation_type', 'sale_type', 'channel_type', 'sim_type'],
  city:         ['city_name', 'city'],
  region:       ['region_name', 'region']
};

/* substring hints for the second resolution tier — used only when no exact candidate matched.
 * Deliberately specific substrings so we do not grab a wrong column by accident. */
const HINTS = {
  msisdn: ['msisdn', 'mobile'], dealer: ['channel_user', 'dealer', 'username', 'pos_user'],
  at: ['insert_date', 'insert_time', 'created', 'activation_date', 'trans_date', 'date_time'],
  customer_id: ['customer_id', 'id_number', 'national'], commission: ['commission_flag', 'is_commission'],
  iccid: ['iccid'], plan: ['plan_name', 'price_plan', 'package'], plan_id: ['plan_id', 'package_id'],
  price: ['plan_price', 'price'], commission_amount: ['comission', 'commission_amount', 'comm_amount'],
  activation_type: ['activation_type', 'sale_type', 'sim_type']
};
/* one typed column listing per process — name + data_type, straight from information_schema */
let _typed = null;
async function typedCols() {
  if (_typed) return _typed;
  const rows = await dms.q(
    `SELECT column_name AS c, data_type AS t FROM information_schema.columns
      WHERE table_schema=? AND table_name=? ORDER BY ordinal_position`, [SCHEMA, TABLE]);
  _typed = rows.map(r => ({ c: String(r.c || r.C || r.column_name), t: String(r.t || r.T || r.data_type || '').toLowerCase() }));
  return _typed;
}
async function resolveFields() {
  if (!dms.configured()) return { ok: false, error: 'DMS DB not configured (DMS_DB_URL / OSB_LOG_URL)' };
  if (!(await dms.hasTable(SCHEMA, TABLE)))
    return { ok: false, error: `table ${SCHEMA}.${TABLE} not visible to this credential` };
  const cols = await typedCols();
  const lc = cols.map(x => ({ ...x, l: x.c.toLowerCase() }));
  const map = {}, missing = [], taken = new Set();
  const claim = (k, name) => { map[k] = name; taken.add(name.toLowerCase()); };
  for (const [k, cands] of Object.entries(FIELDS)) {
    // tier 1 — exact candidate name
    const exact = lc.find(x => cands.some(c => c.toLowerCase() === x.l) && !taken.has(x.l));
    if (exact) { claim(k, exact.c); continue; }
    // tier 2 — substring hint (specific enough to be safe)
    const hint = (HINTS[k] || []).map(h => h.toLowerCase());
    const fuzzy = lc.find(x => hint.some(h => x.l.includes(h)) && !taken.has(x.l));
    if (fuzzy) { claim(k, fuzzy.c); continue; }
    // tier 3 — the timestamp may carry ANY name, but its TYPE gives it away
    if (k === 'at') {
      const dt = lc.find(x => /datetime|timestamp|^date$/.test(x.t) && !taken.has(x.l));
      if (dt) { claim(k, dt.c); continue; }
    }
    missing.push(k);
  }
  for (const req of ['at', 'plan', 'dealer'])
    if (!map[req]) return { ok: false,
      error: `required field "${req}" not found on ${SCHEMA}.${TABLE} — available columns: ${cols.map(x => x.c).join(', ') || '(none visible)'}` };
  return { ok: true, map, missing };
}

function windowOf(fromS, toS) {
  const to = toS ? new Date(toS + (toS.length === 10 ? 'T23:59:59' : '')) : new Date();
  const from = fromS ? new Date(fromS + (fromS.length === 10 ? 'T00:00:00' : ''))
    : new Date(to.getTime() - 7 * 864e5);
  const days = (to - from) / 864e5;
  if (!(days > 0)) throw new Error('empty window');
  if (days > MAX_DAYS) throw new Error(`window capped at ${MAX_DAYS} days`);
  const f = d => d.toISOString().slice(0, 19).replace('T', ' ');
  return { from: f(from), to: f(to) };
}

/* main entry: rows + aggregates, one bounded query + one GROUP BY pass done in SQL.
 * opts: { from, to, plan, dealer, q (msisdn/iccid/customer id), commissionOnly, limit } */
async function report(opts = {}) {
  const r = await resolveFields();
  if (!r.ok) return r;
  const { map, missing } = r;
  const W = windowOf(opts.from, opts.to);
  const col = k => map[k] ? `t.\`${map[k]}\`` : 'NULL';

  /* the ledger has NO amount column — reproduce DMS's own formula (plan price × plan %) by
   * joining the rate table. Rules unresolvable → amounts stay NULL and are reported, never faked. */
  let JOIN = '', amtExpr = col('commission_amount'), amountComputed = false;
  if (!map.commission_amount) {
    try {
      const rT = 'renew_now_commission_rules';
      if (await dms.hasTable(RULES_SCHEMA, rT)) {
        const rPid = await dms.pick(RULES_SCHEMA, rT, ['price_plan_id', 'plan_id']);
        const rName = await dms.pick(RULES_SCHEMA, rT, ['price_plan_name', 'plan_name']);
        const rPct = await dms.pick(RULES_SCHEMA, rT, ['commision_percentage', 'commission_percentage', 'activation_commision_percentage']);
        const on = (rPid && map.plan_id) ? `r.\`${rPid}\` = t.\`${map.plan_id}\``
          : (rName && map.plan) ? `LOWER(r.\`${rName}\`) = LOWER(t.\`${map.plan}\`)` : null;
        if (on && rPct && map.price) {
          JOIN = ` LEFT JOIN \`${RULES_SCHEMA}\`.\`${rT}\` r ON ${on}`;
          amtExpr = `ROUND(CAST(NULLIF(t.\`${map.price}\`,'') AS DECIMAL(12,2)) * CAST(NULLIF(r.\`${rPct}\`,'') AS DECIMAL(8,2)) / 100, 2)`;
          amountComputed = true;
        }
      }
    } catch (_) { /* amounts stay NULL, visible in fields.unresolved */ }
  }
  const selCol = k => (k === 'commission_amount') ? amtExpr : col(k);
  const sel = Object.keys(FIELDS).map(k => `${selCol(k)} AS ${k}`).join(', ');

  const conds = [`t.\`${map.at}\` >= ? AND t.\`${map.at}\` < ?`];
  const params = [W.from, W.to];
  if (opts.plan)   { conds.push(`${col('plan')} LIKE ?`); params.push('%' + String(opts.plan).slice(0, 60) + '%'); }
  if (opts.dealer) { conds.push(`${col('dealer')} LIKE ?`); params.push('%' + String(opts.dealer).slice(0, 40) + '%'); }
  if (opts.q) {     // one free identifier: msisdn / iccid / customer id — exact-ish, digits only
    const dq = String(opts.q).replace(/\D/g, '').slice(0, 20);
    if (dq) { conds.push(`(${col('msisdn')} LIKE ? OR ${col('iccid')} LIKE ? OR ${col('customer_id')} LIKE ?)`);
      params.push('%' + dq + '%', '%' + dq + '%', '%' + dq + '%'); }
  }
  if (opts.commissionOnly && map.commission)
    conds.push(`upper(coalesce(${col('commission')},'')) IN ('Y','YES','1','TRUE')`);
  const where = 'WHERE ' + conds.join(' AND ');
  const limit = Math.min(MAX_ROWS, Math.max(1, Number(opts.limit) || MAX_ROWS));

  const FROM_T = `FROM \`${SCHEMA}\`.\`${TABLE}\` t${JOIN}`;
  const rows = await dms.qSlow(
    `SELECT ${sel} ${FROM_T} ${where} ORDER BY t.\`${map.at}\` LIMIT ${limit}`, params);

  // aggregates in SQL so the panel stays honest even when rows hit the LIMIT
  const [agg] = await dms.qSlow(
    `SELECT count(*) AS total,
            sum(CASE WHEN upper(coalesce(${col('commission')},'')) IN ('Y','YES','1','TRUE') THEN 1 ELSE 0 END) AS with_commission,
            sum(coalesce(${amtExpr},0)) AS commission_total,
            sum(coalesce(${col('price')},0)) AS revenue_total,
            count(DISTINCT ${col('dealer')}) AS dealers
       ${FROM_T} ${where}`, params);
  const byPlan = await dms.qSlow(
    `SELECT ${col('plan')} AS plan, count(*) AS n,
            sum(coalesce(${amtExpr},0)) AS commission,
            sum(coalesce(${col('price')},0)) AS revenue
       ${FROM_T} ${where} GROUP BY 1 ORDER BY n DESC LIMIT 20`, params);
  const byDealer = await dms.qSlow(
    `SELECT ${col('dealer')} AS dealer, count(*) AS n,
            sum(coalesce(${amtExpr},0)) AS commission,
            max(${col('city')}) AS city, max(${col('region')}) AS region
       ${FROM_T} ${where} GROUP BY 1 ORDER BY commission DESC LIMIT 400`, params);
  const byDay = await dms.qSlow(
    `SELECT DATE(t.\`${map.at}\`) AS day, count(*) AS n,
            sum(coalesce(${amtExpr},0)) AS commission
       ${FROM_T} ${where} GROUP BY 1 ORDER BY 1`, params);

  // rate table — best-effort context, never blocks the report
  let rates = [];
  try {
    if (await dms.hasTable(RULES_SCHEMA, 'renew_now_commission_rules'))
      rates = await dms.qSlow(`SELECT * FROM \`${RULES_SCHEMA}\`.\`renew_now_commission_rules\` LIMIT 60`, []);
  } catch (_) { rates = []; }

  return { ok: true, window: W, source: `${SCHEMA}.${TABLE}`,
    amount_basis: amountComputed
      ? 'computed: plan price × plan % from renew_now_commission_rules (the DMS formula — ledger has no amount column)'
      : (map.commission_amount ? 'ledger column' : 'unavailable (no amount column, rules not resolvable)'),
    fields: { resolved: map, unresolved: missing },
    truncated: rows.length >= limit, count: rows.length,
    totals: { total: Number(agg.total || 0), with_commission: Number(agg.with_commission || 0),
      commission_total: Number(agg.commission_total || 0), revenue_total: Number(agg.revenue_total || 0),
      dealers: Number(agg.dealers || 0) },
    byPlan, byDealer, byDay, rates, rows };
}

module.exports = { report, resolveFields, SCHEMA, TABLE };
