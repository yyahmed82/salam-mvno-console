/* Grafana-style query engine over the replica — SAFE (whitelisted datasets only).
 * A panel spec: { dataset, metric, agg?, bucket:'hour'|'day'|'week'|'none', groupBy?, filters:{}, limit? }
 * The engine interpolates ONLY developer-defined identifiers; all user values are bound params. */
const db = require('./db');
const plans = require('./plans');
// human labels for coded filter values → dropdowns show "id - name", value stays the id
const ENUM_LABELS = {
  sim_type: { 0: 'Physical SIM', 1: 'eSIM' },
  number_order_type: { 0: 'New SIM', 1: 'MNP port-in' },
  flow_type: { 0: 'normal', 1: 'indirect', 2: 'posa', 3: 'apollo', 4: 'ownership transfer', 5: 'partner', 6: 'visitor / Hajj', 7: 'qr posa' },
  checkout_type: { 0: 'normal', 1: 'data_sim', 2: 'change_plan', 3: 'sim_replacement', 4: 'saleor', 5: 'ownership_transfer', 6: 'renewal', 7: 'advanced_postpaid' },
  card_type: { 0: 'Apple Pay', 1: 'Credit card', 2: 'mada', 3: 'Amex', 4: 'STC', 5: 'Tasheel', 30: 'Other', 60: 'N/A' }
};
async function labelValues(dim, vals) {
  if (dim === 'plan' || dim === 'plan_id') {
    const map = await plans.loadMap();
    return vals.map(v => ({ value: v, label: plans.label(map, v) }));   // "122 - Salam 55 / سلام ٥٥"
  }
  const em = ENUM_LABELS[dim];
  if (em) return vals.map(v => ({ value: v, label: `${v} - ${em[v] != null ? em[v] : '—'}` }));
  return vals.map(v => ({ value: v, label: String(v) }));               // already-readable text (status, vendor, …)
}

// a groupBy dim whose keys are plan ids/refs (plan, plan_id, from_plan, to_plan)
// time bucket expression — sub-hour buckets via epoch-floor so it works on PG12 (no date_bin)
function bucketExpr(bucket, col) {
  const secs = { minute: 60, '5min': 300, '15min': 900 }[bucket];
  if (secs) return `to_timestamp(floor(extract(epoch from ${col})/${secs})*${secs})`;
  return `date_trunc('${['hour', 'day', 'week'].includes(bucket) ? bucket : 'hour'}', ${col})`;
}
const isPlanDim = d => !!d && /(^|_)plan(_id)?$/.test(String(d));
// attach a human name + "id - name" tooltip onto grouped items keyed by a plan id/ref
async function decoratePlanKeys(items) {
  const map = await plans.loadMap();
  for (const s of items) {
    const rec = plans.lookup(map, s.key);
    s.label = rec ? ([rec.en, rec.ar].filter(Boolean).join(' / ') || String(s.key)) : String(s.key);
    s.sub = 'id ' + String(s.key);       // raw plan id / Oracle ref → disambiguates same-named plans in charts
    s.title = plans.label(map, s.key);   // "100136 - Salam 55 / سلام ٥٥"
  }
  return items;
}

// human-readable labels for BSS/activation status codes → shown as "code - meaning" in error charts.
// Editable in-app (Settings → Error codes); loaded from the console DB and cached 5 min. Unmapped codes render raw.
let _codeCache = null, _codeTs = 0;
async function loadErrorCodes() {
  if (_codeCache && Date.now() - _codeTs < 5 * 60 * 1000) return _codeCache;
  const m = {}; try { (await db.console.query(`SELECT code, label FROM error_codes`)).rows.forEach(r => { m[String(r.code)] = r.label; }); } catch (e) {}
  _codeCache = m; _codeTs = Date.now(); return m;
}
const isCodeDim = d => d === 'status_code';
async function decorateCodeKeys(items) {
  const m = await loadErrorCodes();
  for (const s of items) { const meaning = m[String(s.key)]; if (meaning) { s.label = `${s.key} - ${meaning}`; s.title = s.label; } }
  return items;
}

// mapped enum → CASE expression (label out) for grouping/display
const SIM_TYPE = `CASE sim_type WHEN 1 THEN 'eSIM' ELSE 'Physical' END`;
const NUM_ORDER = `CASE number_order_type WHEN 1 THEN 'MNP' ELSE 'New SIM' END`;
const FLOW_TYPE = `CASE flow_type WHEN 0 THEN 'normal' WHEN 1 THEN 'indirect' WHEN 2 THEN 'posa' WHEN 3 THEN 'apollo' WHEN 4 THEN 'ownership' WHEN 5 THEN 'partner' WHEN 6 THEN 'visitor' WHEN 7 THEN 'qr_posa' END`;
const CHECKOUT_TYPE = `CASE checkout_type WHEN 0 THEN 'normal' WHEN 1 THEN 'data_sim' WHEN 2 THEN 'change_plan' WHEN 3 THEN 'sim_replacement' WHEN 4 THEN 'saleor' WHEN 5 THEN 'ownership_transfer' WHEN 6 THEN 'renewal' WHEN 7 THEN 'advanced_postpaid' ELSE 'other' END`;

// Derived decline reason for stats + troubleshooting. Explicit fail_reason (hyperpay/tap) wins; UPG/salam
// leave it blank and put the real code+message in payment_commit_response.gateway.response — pull
// "code · message" from there, stripping a trailing card-brand suffix (e.g. " (Visa 82)") so the same
// reason buckets together. Falls back to '—' only when nothing is available anywhere.
const DECLINE_EXPR = `COALESCE(
  NULLIF(fail_reason,''),
  NULLIF(regexp_replace(concat_ws(' · ',
    COALESCE(payment_commit_response#>>'{gateway,response,code}', payment_initialization_response#>>'{gateway,response,code}'),
    COALESCE(payment_commit_response#>>'{gateway,response,message}', payment_initialization_response#>>'{gateway,response,message}')
  ), ' \\([^)]*\\)$', ''), ''),
  '—')`;

const DATASETS = {
  payments: {
    label: 'Payments', table: 'payments', timeCol: 'created_at',
    metrics: {
      count: { label: 'Transactions', expr: 'count(*)' },
      success: { label: 'Successful', expr: `count(*) FILTER (WHERE status='success')` },
      failed: { label: 'Failed', expr: `count(*) FILTER (WHERE status IN ('fail','failed'))` },
      pending: { label: 'Pending', expr: `count(*) FILTER (WHERE status='pending')` },
      success_rate: { label: 'Success rate', rate: true, num: `count(*) FILTER (WHERE status='success')`, den: `count(*) FILTER (WHERE status IN ('success','fail','failed'))` },
      fail_rate: { label: 'Failure rate', rate: true, bad: true, num: `count(*) FILTER (WHERE status IN ('fail','failed'))`, den: `count(*) FILTER (WHERE status IN ('success','fail','failed'))` },
      amount: { label: 'Amount (SAR)', expr: 'coalesce(sum(amount),0)' }
    },
    dims: { status: 'status', vendor: `coalesce(vendor,'—')`, platform: `coalesce(platform,'—')`, type: `coalesce(payment_on_type,'—')`, card_type: `CASE card_type WHEN 0 THEN 'Apple Pay' WHEN 1 THEN 'Credit card' WHEN 2 THEN 'mada' WHEN 3 THEN 'Amex' WHEN 4 THEN 'STC' WHEN 5 THEN 'Tasheel' WHEN 30 THEN 'Other' WHEN 60 THEN 'N/A' ELSE coalesce(card_type::text,'—') END`, fail_reason: `coalesce(nullif(fail_reason,''),'—')`, decline: DECLINE_EXPR },
    filters: { status: { col: 'status' }, vendor: { col: 'vendor' }, platform: { col: 'platform' }, payment_on_type: { col: 'payment_on_type' }, card_type: { col: 'card_type' } },
    tableCols: ['id::text AS id', 'status', 'vendor', 'platform', 'amount', 'payment_on_type', 'fail_reason', 'created_at']
  },
  onboarding: {
    label: 'Onboarding orders', table: 'onboarding_orders', timeCol: 'created_at',
    metrics: {
      count: { label: 'Orders', expr: 'count(*)' },
      eligible: { label: 'Eligibility pass', expr: 'count(*) FILTER (WHERE is_eligible)' },
      completed: { label: 'Completed', expr: 'count(*) FILTER (WHERE completed)' },
      activated: { label: 'Activated', expr: 'count(*) FILTER (WHERE activated)' },
      conversion: { label: 'Conversion', rate: true, num: 'count(*) FILTER (WHERE completed)', den: 'count(*)' },
      eligibility_rate: { label: 'Eligibility pass rate', rate: true, num: 'count(*) FILTER (WHERE is_eligible)', den: 'count(*) FILTER (WHERE is_eligible IS NOT NULL)' },
      activation_rate: { label: 'Activation rate', rate: true, num: 'count(*) FILTER (WHERE activated)', den: 'count(*) FILTER (WHERE completed)' }
    },
    planCol: { col: 'plan_id', keyCol: 'id' },   // for the global Prepaid/Postpaid filter
    dims: { channel: NUM_ORDER, sim: SIM_TYPE, flow: FLOW_TYPE, status: `coalesce(status,'—')` },
    filters: {
      number_order_type: { col: 'number_order_type' }, sim_type: { col: 'sim_type' },
      flow_type: { col: 'flow_type' }, plan: { col: 'plan_id' }, seller: { col: 'seller_id' },
      is_eligible: { col: 'is_eligible' }, completed: { col: 'completed' }, activated: { col: 'activated' }, status: { col: 'status' }
    },
    tableCols: ['id::text AS id', 'mobile_number', `${SIM_TYPE} AS sim`, `${NUM_ORDER} AS channel`, 'status', 'completed', 'activated', 'created_at']
  },
  activation: {
    label: 'Activation (BSS) logs', table: 'activation_logs', timeCol: 'created_at',
    metrics: {
      count: { label: 'Calls', expr: 'count(*)' },
      ok: { label: 'Successful', expr: 'count(*) FILTER (WHERE state)' },
      failed: { label: 'Failed', expr: 'count(*) FILTER (WHERE NOT state)' },
      success_rate: { label: 'Success rate', rate: true, num: 'count(*) FILTER (WHERE state)', den: 'count(*)' },
      newline_success_rate: { label: 'New-line success rate', rate: true, num: `count(*) FILTER (WHERE state AND api NOT ILIKE '%semati%')`, den: `count(*) FILTER (WHERE api NOT ILIKE '%semati%')` },
      semati_success_rate: { label: 'Semati success rate', rate: true, num: `count(*) FILTER (WHERE state AND api ILIKE '%semati%')`, den: `count(*) FILTER (WHERE api ILIKE '%semati%')` }
    },
    dims: { platform: `coalesce(platform,'—')`, semati: `CASE WHEN api ILIKE '%semati%' THEN 'semati' ELSE 'other' END`, status_code: `coalesce(nullif(status_code,''),'—')`, api: `coalesce(api,'—')` },
    filters: { platform: { col: 'platform' }, status_code: { col: 'status_code' }, state: { col: 'state' } },
    tableCols: ['id::text AS id', 'api', 'state', 'status_code', 'msisdn', 'created_at']
  },
  checkouts: {
    label: 'Checkouts (replacement / renewal / plan-change / shop)', table: 'checkouts', timeCol: 'created_at',
    metrics: {
      count: { label: 'Checkouts', expr: 'count(*)' },
      paid: { label: 'Paid', expr: 'count(*) FILTER (WHERE paid)' },
      completed: { label: 'Completed', expr: 'count(*) FILTER (WHERE completed)' },
      completion_rate: { label: 'Completion rate', rate: true, num: 'count(*) FILTER (WHERE completed)', den: 'count(*)' }
    },
    dims: { type: CHECKOUT_TYPE, state: `coalesce(aasm_state,'—')` },
    filters: { checkout_type: { col: 'checkout_type' }, paid: { col: 'paid' }, completed: { col: 'completed' } },
    tableCols: ['id::text AS id', `${CHECKOUT_TYPE} AS type`, 'aasm_state', 'paid', 'completed', 'created_at']
  },
  nafath: {
    label: 'Nafath identity', table: 'nafath_logs', timeCol: 'created_at',
    metrics: {
      count: { label: 'Requests', expr: 'count(*)' },
      completed: { label: 'Completed', expr: `count(*) FILTER (WHERE lower(status)='completed')` },
      fail_rate: { label: 'Failure rate', rate: true, bad: true, num: `count(*) FILTER (WHERE lower(status) IN ('expired','rejected','failed','cancelled','denied'))`, den: `count(*) FILTER (WHERE lower(status) IN ('completed','expired','rejected','failed','cancelled','denied'))` }
    },
    dims: { status: `coalesce(status,'—')`, service: `coalesce(service,'—')` },
    filters: { status: { col: 'status' }, service: { col: 'service' } },
    tableCols: ['id::text AS id', 'status', 'service', 'created_at']
  },
  delivery: {
    label: 'Delivery', table: 'delivery_requests', timeCol: 'created_at',
    metrics: {
      count: { label: 'Shipments', expr: 'count(*)' },
      delivered: { label: 'Delivered', expr: `count(*) FILTER (WHERE delivered_at IS NOT NULL)` },
      fail_rate: { label: 'Fail/return rate', rate: true, bad: true, num: `count(*) FILTER (WHERE delivery_state IN ('cancelled','canceled','deleted','RTO','CANCELLED','PUX43','returned','reverseReturned','shipmentCanceled','reverseShipmentCanceled','REFUSED','onhold','pickup_failed','DEX93','RD','DEX07-3','DEX07-4','DEX07-5','DEX07-6','DEX07-7','DEX07-8','DEX93-1','DEX93-2','DEX93-3','DEX93-4','DEX07'))`, den: 'count(*)' }
    },
    dims: { vendor: `coalesce(vendor,'—')`, state: `coalesce(delivery_state,'—')` },
    filters: { vendor: { col: 'vendor' }, delivery_state: { col: 'delivery_state' } },
    tableCols: ['id::text AS id', 'vendor', 'delivery_state', 'created_at']
  },
  change_plan: {
    label: 'Plan change', table: 'change_plan_logs', timeCol: 'created_at',
    metrics: {
      count: { label: 'Requests', expr: 'count(*)' },
      success: { label: 'Success', expr: 'count(*) FILTER (WHERE status=1)' },
      fail_rate: { label: 'Failure rate', rate: true, bad: true, num: 'count(*) FILTER (WHERE status=2)', den: 'count(*) FILTER (WHERE status IN (1,2))' }
    },
    planCol: { col: 'to_plan', keyCol: 'optiva_reference' },   // to_plan is an optiva_reference → resolve type via plans
    dims: { from_plan: `coalesce(from_plan,'—')`, to_plan: `coalesce(to_plan,'—')` },
    filters: { status: { col: 'status' } },
    tableCols: ['id::text AS id', 'mobile_number', 'from_plan', 'to_plan', 'status', 'created_at']
  },

  /* Dealer (DMS) commissioning. Until now seller_deductions was reachable ONLY through the
   * dealer_activity alert metric — a number that could page you but never be charted. This makes
   * it a first-class dataset: the Analytics builder, the preset boards and the Dashboard
   * Customize list all pick it up automatically.
   * orders = count(DISTINCT onboarding_order_id), never count(*): one order can carry several
   * deduction rows (commission retries/adjustments), and row-counting inflates exactly when
   * commissioning misbehaves — same lesson as plan_channels. Amounts are halalas → /100 for SAR. */
  dealers: {
    label: 'Dealers (DMS)', table: 'seller_deductions', timeCol: 'created_at',
    metrics: {
      orders: { label: 'Commissioned orders', expr: 'count(DISTINCT onboarding_order_id)' },
      dealers: { label: 'Active dealers', expr: 'count(DISTINCT seller_id)' },
      commission: { label: 'Commission (SAR)', expr: 'coalesce(sum(amount),0)' },   // amount is a FLOAT already in SAR (schema.rb:852) — NOT halalas
      deductions: { label: 'Deduction rows', expr: 'count(*)' }
    },
    dims: {
      dealer: `(SELECT coalesce(nullif(trim(concat(s.first_name,' ',s.last_name)),''), s.username, seller_deductions.seller_id::text)
                  FROM sellers s WHERE s.id = seller_deductions.seller_id)`,
      dealer_group: `(SELECT coalesce(nullif(s."group",''),'—') FROM sellers s WHERE s.id = seller_deductions.seller_id)`
    },
    filters: { seller: { col: 'seller_id' } },
    tableCols: ['id::text AS id', 'seller_id::text AS seller_id', 'onboarding_order_id::text AS order_id',
                'amount AS amount_sar', 'created_at']
  }
};

function catalog() {
  const out = {};
  for (const [k, d] of Object.entries(DATASETS)) {
    out[k] = { label: d.label,
      metrics: Object.fromEntries(Object.entries(d.metrics).map(([m, v]) => [m, { label: v.label, rate: !!v.rate }])),
      dims: Object.keys(d.dims), filters: Object.keys(d.filters) };
  }
  return out;
}

// plans.plan_type is a numeric code. Salam convention: 1 = prepaid, 2 = postpaid. Flip here if a spot-check shows otherwise.
const PLAN_TYPE_CODE = { prepaid: 1, postpaid: 2 };
function whereClause(ds, filters, params) {
  const parts = [];
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === '' || v == null) continue;
    if (k === 'plan_type') {                                   // global Prepaid/Postpaid filter → resolve via the plans catalog
      if (ds.planCol) {
        const code = PLAN_TYPE_CODE[/post/i.test(v) ? 'postpaid' : /pre/i.test(v) ? 'prepaid' : ''];
        if (code != null) { params.push(code); parts.push(`${ds.planCol.col}::text IN (SELECT ${ds.planCol.keyCol}::text FROM plans WHERE plan_type = $${params.length})`); }
      }
      continue;   // datasets with no plan column simply ignore this filter
    }
    const f = ds.filters[k]; if (!f) continue;
    params.push(v); parts.push(`${f.col} = $${params.length}`);
  }
  return parts;
}

async function runQuery(spec) {
  const ds = DATASETS[spec.dataset]; if (!ds) throw new Error('unknown dataset');
  const params = [];
  params.push(spec.from || new Date(Date.now() - 24 * 3600e3).toISOString()); const pFrom = params.length;
  params.push(spec.to || new Date().toISOString()); const pTo = params.length;
  const where = [`${ds.timeCol} >= $${pFrom}::timestamptz`, `${ds.timeCol} < $${pTo}::timestamptz`, ...whereClause(ds, spec.filters, params)];

  // TABLE viz
  if (spec.bucket === 'none' || spec.viz === 'table') {
    const cols = ds.tableCols.join(', ');
    const sql = `SELECT ${cols} FROM ${ds.table} WHERE ${where.join(' AND ')} ORDER BY ${ds.timeCol} DESC LIMIT ${Math.min(500, spec.limit || 100)}`;
    const r = await db.source.query(sql, params);
    // relabel plan-id columns to "id - name" so tables read like the rest of the UI
    const planCols = ['from_plan', 'to_plan', 'plan_id', 'plan'].filter(c => r.rows[0] && (c in r.rows[0]));
    if (planCols.length) { const map = await plans.loadMap(); r.rows.forEach(row => planCols.forEach(c => { if (row[c] != null && row[c] !== '—') row[c] = plans.label(map, row[c]); })); }
    return { kind: 'table', rows: r.rows };
  }

  // metric expression
  const m = ds.metrics[spec.metric] || ds.metrics.count;
  const valExpr = m.rate ? `(${m.num})::float / NULLIF(${m.den},0)` : m.expr;

  // STAT (single number, no time)
  if (spec.bucket === 'stat' || spec.viz === 'stat') {
    const sampleSel = m.rate ? `, (${m.den}) AS sample` : '';   // denominator = sample size for rate stats
    const sql = `SELECT ${valExpr} AS v${sampleSel} FROM ${ds.table} WHERE ${where.join(' AND ')}`;
    const r = await db.source.query(sql, params);
    return { kind: 'stat', value: r.rows[0] ? Number(r.rows[0].v) : null, rate: !!m.rate, bad: !!m.bad,
      sample: (m.rate && r.rows[0] && r.rows[0].sample != null) ? Number(r.rows[0].sample) : null };
  }

  // PIE / DONUT (grouped shares, no time)
  if (spec.viz === 'pie' || spec.viz === 'donut') {
    const gexpr = spec.groupBy && ds.dims[spec.groupBy] ? ds.dims[spec.groupBy] : null;
    if (!gexpr) throw new Error('pie/donut needs a group-by dimension');
    const sql = `SELECT ${gexpr} AS g, ${valExpr} AS v FROM ${ds.table} WHERE ${where.join(' AND ')}
                 GROUP BY 1 ORDER BY v DESC NULLS LAST LIMIT 20`;
    const r = await db.source.query(sql, params);
    const slices = r.rows.map(x => ({ key: x.g == null ? '—' : String(x.g), value: x.v == null ? 0 : Number(x.v) }));
    if (isPlanDim(spec.groupBy)) await decoratePlanKeys(slices); else if (isCodeDim(spec.groupBy)) await decorateCodeKeys(slices);
    return { kind: 'pie', slices };
  }

  // TIME SERIES (line/bar), optional groupBy, optional compare-to-previous-period
  const bucket = ['minute', '5min', '15min', 'hour', 'day', 'week'].includes(spec.bucket) ? spec.bucket : 'hour';
  const gexpr = spec.groupBy && ds.dims[spec.groupBy] ? ds.dims[spec.groupBy] : null;

  async function tsRows(fromISO, toISO) {
    const fp = [fromISO, toISO];   // $1=from, $2=to, filter values appended by whereClause
    const fw = [`${ds.timeCol} >= $1::timestamptz`, `${ds.timeCol} < $2::timestamptz`, ...whereClause(ds, spec.filters, fp)];
    const sel = [`${bucketExpr(bucket, ds.timeCol)} AS t`]; const grp = ['1'];
    if (gexpr) { sel.push(`${gexpr} AS g`); grp.push('2'); }
    sel.push(`${valExpr} AS v`);
    const sql = `SELECT ${sel.join(', ')} FROM ${ds.table} WHERE ${fw.join(' AND ')} GROUP BY ${grp.join(', ')} ORDER BY t`;
    return (await db.source.query(sql, fp)).rows;
  }
  const shape = rows => { const mp = {}; for (const row of rows) { const key = gexpr ? (row.g == null ? '—' : String(row.g)) : (m.label || 'value'); (mp[key] ||= []).push({ t: row.t, v: row.v == null ? null : Number(row.v) }); } return Object.entries(mp).map(([key, points]) => ({ key, points })); };

  const series = shape(await tsRows(spec.from, spec.to));
  if (isPlanDim(spec.groupBy)) await decoratePlanKeys(series); else if (isCodeDim(spec.groupBy)) decorateCodeKeys(series);
  const out = { kind: 'series', rate: !!m.rate, series };
  if (spec.compare === 'prev') {
    const period = new Date(spec.to).getTime() - new Date(spec.from).getTime();
    const pf = new Date(new Date(spec.from).getTime() - period).toISOString();
    const pt = new Date(new Date(spec.to).getTime() - period).toISOString();
    const prevRows = (await tsRows(pf, pt)).map(r => ({ ...r, t: new Date(new Date(r.t).getTime() + period).toISOString() })); // shift onto current axis
    out.prev = shape(prevRows);
  }
  return out;
}

async function distinctValues(dataset, dim, limit = 50) {
  const ds = DATASETS[dataset]; if (!ds) return [];
  const f = ds.filters[dim] || (ds.dims[dim] ? { col: null, expr: ds.dims[dim] } : null); if (!f) return [];
  const expr = f.expr || f.col; if (!expr) return [];
  const r = await db.source.query(
    `SELECT DISTINCT ${expr} AS v FROM ${ds.table} WHERE ${ds.timeCol} > now() - interval '60 days' AND ${expr} IS NOT NULL ORDER BY 1 LIMIT ${limit}`);
  return labelValues(dim, r.rows.map(x => x.v));   // → [{ value, label }]
}

module.exports = { DATASETS, catalog, runQuery, distinctValues, DECLINE_EXPR };
