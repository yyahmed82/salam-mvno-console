/* DEALERS BOARD — the whole dealer network, filterable and rankable, from the DMS system record.
 *
 * COST DISCIPLINE IS THE WHOLE DESIGN.
 * The obvious query joins dms_users (13.6 k) to commission_history (2.9 M) and groups — which
 * aggregates the entire ledger to return 50 rows. Instead this runs in TWO STEPS: filter and page
 * the dealers first, then aggregate ONLY for that page's ids (`WHERE channel_user_id IN (…)`).
 * The heavy table is touched with an indexed predicate over at most a few hundred keys, never
 * scanned whole. Sorting by an aggregate is handled explicitly — see sortAgg below — rather than
 * pretending it can be done in step one.
 *
 * Everything is probed before it is queried (dmsDb.pick / columnsOf): we did not write this
 * schema and it is inconsistent in places. A missing column drops a facet or a column; it never
 * breaks the board.
 *
 * Read-only.
 */
'use strict';

const D = require('./dmsDb');
const SCH = { dms: 'dms_v1', com: 'trms_commission', wal: 'trms_wallet' };

/* Columns of dms_users that are worth filtering on — low-cardinality, human-meaningful.
 * `geographical_area` is deliberately excluded: the live data holds values like
 * 1000000000000, which is a code nobody can filter by usefully. */
const FACET_COLS = ['dealer_type', 'status', 'user_type', 'partner', 'location_of_sales', 'employee_type', 'role'];

const clampInt = (v, d, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d; };

/* ---- facets: what values actually exist, so the UI offers real choices ---- */
let _facetCache = null;
async function facets() {
  if (_facetCache && Date.now() - _facetCache.at < 10 * 60000) return _facetCache.v;
  const have = await D.columnsOf(SCH.dms, 'dms_users');
  const out = {};
  for (const c of FACET_COLS) {
    if (!have.has(c)) continue;
    try {
      const rows = await D.q(
        `SELECT \`${c}\` v, count(*) n FROM \`${SCH.dms}\`.\`dms_users\`
          WHERE \`${c}\` IS NOT NULL AND \`${c}\` <> '' GROUP BY \`${c}\`
          HAVING n > 0 ORDER BY n DESC LIMIT 40`);
      if (rows.length && rows.length <= 40) out[c] = rows.map(r => ({ value: String(r.v), count: Number(r.n) }));
    } catch (e) { /* facet is optional */ }
  }
  // region lives on the commission ledger, not on the dealer row
  try {
    if ((await D.columnsOf(SCH.com, 'commission_history')).has('region')) {
      const rows = await D.q(`SELECT region v, count(DISTINCT channel_user_id) n
        FROM \`${SCH.com}\`.\`commission_history\` WHERE region IS NOT NULL AND region <> ''
        GROUP BY region ORDER BY n DESC LIMIT 40`);
      if (rows.length) out.region = rows.map(r => ({ value: String(r.v), count: Number(r.n) }));
    }
  } catch (e) { }
  _facetCache = { at: Date.now(), v: out };
  return out;
}

/* ---- autocomplete: dealer_code only, as asked ---- */
async function codes(prefix, limit = 15) {
  const p = String(prefix || '').trim();
  if (p.length < 2) return [];
  const have = await D.columnsOf(SCH.dms, 'dms_users');
  if (!have.has('dealer_code')) return [];
  const sel = await D.selectList(SCH.dms, 'dms_users', ['dealer_code', 'username', 'dealer_type', 'status', 'first_name', 'last_name']);
  /* Prefix match first (uses the index), then a contains match for the rest — an operator who
   * types the middle of a code still finds it, but the fast path stays fast. */
  const rows = await D.q(
    `SELECT ${sel}, 0 rk FROM \`${SCH.dms}\`.\`dms_users\` WHERE dealer_code LIKE ?
     UNION ALL
     SELECT ${sel}, 1 rk FROM \`${SCH.dms}\`.\`dms_users\` WHERE dealer_code LIKE ? AND dealer_code NOT LIKE ?
     ORDER BY rk, dealer_code LIMIT ?`,
    [p + '%', '%' + p + '%', p + '%', clampInt(limit, 15, 1, 50)]);
  return rows.map(r => ({ dealer_code: r.dealer_code, username: r.username,
    name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
    dealer_type: r.dealer_type, status: r.status }));
}

/* ---- the board ---- */
const SORTS = {
  earned: { agg: true, expr: 'earned', dir: 'DESC' },
  unpaid: { agg: true, expr: 'unpaid', dir: 'DESC' },
  paid: { agg: true, expr: 'paid', dir: 'DESC' },
  deals: { agg: true, expr: 'rows_n', dir: 'DESC' },
  newest: { agg: false, expr: 'created_at', dir: 'DESC' },
  name: { agg: false, expr: 'dealer_code', dir: 'ASC' }
};

async function board(opts = {}) {
  if (!D.configured()) return { ok: false, configured: false, error: 'DMS database not configured' };
  const have = await D.columnsOf(SCH.dms, 'dms_users');
  if (!have.size) return { ok: false, error: 'dms_v1.dms_users not visible to this account' };

  const limit = clampInt(opts.limit, 50, 1, 300);
  const sortKey = SORTS[opts.sort] ? opts.sort : 'earned';
  const sort = SORTS[sortKey];

  // ---- step 1: filter the dealers (cheap, indexed, no ledger involved) ----
  const where = [], params = [];
  for (const c of FACET_COLS) {
    const v = opts[c];
    if (v && have.has(c)) { where.push(`\`${c}\` = ?`); params.push(String(v)); }
  }
  if (opts.q) {
    const q = `%${String(opts.q).trim()}%`;
    const cand = ['dealer_code', 'username', 'shop_code', 'first_name', 'last_name'].filter(c => have.has(c));
    if (cand.length) { where.push('(' + cand.map(c => `\`${c}\` LIKE ?`).join(' OR ') + ')'); cand.forEach(() => params.push(q)); }
  }
  /* Region is a property of the ledger, so it cannot be filtered in step 1. Resolve it to a set
   * of dealer ids first — bounded — and treat it as an id filter. */
  let regionIds = null;
  if (opts.region) {
    try {
      const r = await D.q(`SELECT DISTINCT channel_user_id id FROM \`${SCH.com}\`.\`commission_history\`
        WHERE region = ? LIMIT 5000`, [String(opts.region)]);
      regionIds = r.map(x => x.id).filter(x => x != null);
      if (!regionIds.length) return { ok: true, rows: [], total: 0, sort: sortKey, note: 'No dealer has commission rows in that region.' };
      where.push(`id IN (${regionIds.map(() => '?').join(',')})`); params.push(...regionIds);
    } catch (e) { /* fall through unfiltered rather than fail the board */ }
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const selBase = await D.selectList(SCH.dms, 'dms_users', ['id', 'channel_id', 'dealer_code', 'username',
    'first_name', 'last_name', 'dealer_type', 'status', 'user_type', 'partner', 'location_of_sales',
    'shop_code', 'account_number', 'created_at', 'is_semati_nafat_bypass_enable', 'login_without_qr_allowed']);
  /* MAP EXPLORER geo columns — resolve by candidates (spellings vary in this schema; 'latitude'
   * alone came back empty on 1 Sep) and alias to stable names the frontend can rely on. */
  const haveCols = await D.columnsOf(SCH.dms, 'dms_users');
  const pickC = (...c) => c.find(x => haveCols.has(x)) || null;
  const latC = pickC('latitude', 'lattitude', 'lat', 'gps_latitude', 'location_latitude');
  const lngC = pickC('longitude', 'longtitude', 'lng', 'gps_longitude', 'location_longitude', 'long');
  const cityC = pickC('city', 'city_name', 'city_en', 'dealer_city');
  const areaC = pickC('geographical_area', 'geo_area', 'area', 'region', 'region_name');
  const sel = selBase
    + `, ${latC ? '`' + latC + '`' : 'NULL'} AS latitude, ${lngC ? '`' + lngC + '`' : 'NULL'} AS longitude`
    + `, ${cityC ? '`' + cityC + '`' : 'NULL'} AS city, ${areaC ? '`' + areaC + '`' : 'NULL'} AS geographical_area`;

  /* When sorting by an aggregate we cannot page in step 1 — the top earner might be row 9,000.
   * Take a bounded candidate pool, aggregate it, then rank. The pool is capped so the ledger
   * lookup stays a keyed IN-list, never a full scan. */
  const POOL = sort.agg ? clampInt(opts.pool, 1200, limit, 4000) : limit;
  const orderStep1 = sort.agg
    ? (have.has('updated_at') ? 'ORDER BY updated_at DESC' : '')
    : `ORDER BY \`${sort.expr}\` ${sort.dir}`;
  const dealers = await D.q(`SELECT ${sel} FROM \`${SCH.dms}\`.\`dms_users\` ${whereSql} ${orderStep1} LIMIT ${POOL}`, params);
  if (!dealers.length) return { ok: true, rows: [], total: 0, sort: sortKey, facets: await facets() };

  const ids = dealers.map(d => d.id).filter(x => x != null);

  // ---- step 2: aggregate the ledger for THIS page only ----
  const agg = new Map();
  try {
    const ch = await D.columnsOf(SCH.com, 'commission_history');
    if (ch.has('commission_amount') && ch.has('channel_user_id') && ids.length) {
      const paidExpr = ch.has('pay_out_date') ? 'pay_out_date IS NOT NULL'
        : ch.has('pay_out') ? `pay_out IS NOT NULL AND pay_out <> ''` : null;
      const rows = await D.q(
        `SELECT channel_user_id id, count(*) rows_n, sum(commission_amount) earned,
                ${paidExpr ? `sum(CASE WHEN ${paidExpr} THEN commission_amount ELSE 0 END)` : '0'} paid,
                max(${ch.has('commission_earned_date') ? 'commission_earned_date' : 'created_on'}) last_at
           FROM \`${SCH.com}\`.\`commission_history\`
          WHERE channel_user_id IN (${ids.map(() => '?').join(',')})
          GROUP BY channel_user_id`, ids);
      rows.forEach(r => agg.set(String(r.id), {
        rows_n: Number(r.rows_n || 0), earned: Number(r.earned || 0),
        paid: Number(r.paid || 0), unpaid: Number(r.earned || 0) - Number(r.paid || 0), last_at: r.last_at
      }));
    }
  } catch (e) { /* board still useful without money */ }

  // last login, same keyed pattern
  const logins = new Map();
  try {
    if (await D.hasTable(SCH.dms, 'dms_user_login_details') && ids.length) {
      const rows = await D.q(
        `SELECT user_id id, max(login_time) last_login, count(*) n
           FROM \`${SCH.dms}\`.\`dms_user_login_details\`
          WHERE user_id IN (${ids.map(() => '?').join(',')}) GROUP BY user_id`, ids);
      rows.forEach(r => logins.set(String(r.id), { last_login: r.last_login, logins: Number(r.n || 0) }));
    }
  } catch (e) { }

  const now = Date.now();
  let rows = dealers.map(d => {
    const a = agg.get(String(d.id)) || { rows_n: 0, earned: 0, paid: 0, unpaid: 0, last_at: null };
    const l = logins.get(String(d.id)) || { last_login: null, logins: 0 };
    const idleDays = l.last_login ? Math.round((now - new Date(l.last_login).getTime()) / 86400000) : null;
    /* Badges are derived, not stored — each is a statement the data supports on its own. */
    const badges = [];
    if (a.earned > 0 && a.paid === 0) badges.push({ k: 'never_paid', label: 'Never paid out', tone: 'bad' });
    if (a.unpaid > 0 && a.paid > 0) badges.push({ k: 'part_paid', label: 'Partly paid', tone: 'warn' });
    if (a.rows_n >= 50) badges.push({ k: 'high_volume', label: `${a.rows_n} deals`, tone: 'good' });
    if (idleDays != null && idleDays > 30) badges.push({ k: 'idle', label: `Idle ${idleDays}d`, tone: 'warn' });
    if (l.last_login == null) badges.push({ k: 'never_logged_in', label: 'Never logged in', tone: 'warn' });
    if (d.is_semati_nafat_bypass_enable) badges.push({ k: 'bypass', label: 'Semati bypass', tone: 'bad' });
    if (d.login_without_qr_allowed) badges.push({ k: 'noqr', label: 'No-QR login', tone: 'warn' });
    return {
      id: d.id, channel_id: d.channel_id, dealer_code: d.dealer_code, username: d.username,
      name: [d.first_name, d.last_name].filter(Boolean).join(' ') || null,
      dealer_type: d.dealer_type, status: d.status, partner: d.partner,
      location: d.location_of_sales, shop_code: d.shop_code, created_at: d.created_at,
      earned: a.earned, paid: a.paid, unpaid: a.unpaid, deals: a.rows_n, last_commission: a.last_at,
      last_login: l.last_login, logins: l.logins, idle_days: idleDays, badges
    };
  });

  if (sort.agg) rows.sort((x, y) => (y[sort.expr === 'rows_n' ? 'deals' : sort.expr] || 0) - (x[sort.expr === 'rows_n' ? 'deals' : sort.expr] || 0));
  const totals = rows.reduce((t, r) => ({
    earned: t.earned + r.earned, paid: t.paid + r.paid, unpaid: t.unpaid + r.unpaid,
    deals: t.deals + r.deals, never_paid: t.never_paid + (r.earned > 0 && r.paid === 0 ? 1 : 0)
  }), { earned: 0, paid: 0, unpaid: 0, deals: 0, never_paid: 0 });
  const pooled = rows.length;
  rows = rows.slice(0, limit);

  return { ok: true, rows, shown: rows.length, pooled, sort: sortKey,
    filters: Object.fromEntries(FACET_COLS.concat('region', 'q').filter(k => opts[k]).map(k => [k, opts[k]])),
    totals, facets: await facets(),
    note: sort.agg
      ? `Ranked by ${sortKey} across a ${pooled}-dealer candidate pool (most recently updated first). Widen with pool= if a long-tail dealer must be included.`
      : null };
}

module.exports = { board, codes, facets };
