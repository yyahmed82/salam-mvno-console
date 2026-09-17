/* Data-source registry (16 Sep 2026 — "map every console table / replica to the prod source the L2 team
 * monitors, with a synced / lagging / stale status"). Two jobs:
 *   1. the DATA SOURCES tab (Mobile › Alerts and Fixed › Alerts): one row per dataset — pool, table, the prod
 *      equivalent L2 uses, the sync mechanism, expected lag, newest row, rows in the last hour, status badge.
 *      Label / prod equivalent / expected lag are operator-editable (console_settings 'datasets_overrides').
 *   2. the CUSTOM METRIC BUILDER (customMetrics.js): a metric can only read a REGISTERED dataset, only its
 *      introspected columns (information_schema, PII-looking names blacklisted) plus the DERIVED expressions
 *      declared here (channel, class, provider, host…) — nothing an operator types ever reaches SQL as text.
 * Every query here is read-only, bounded to the time column and cached 60 s. */
const db = require('./db');

const PII_RE = /(phone|mobile|msisdn|email|name|national|iqama|\bnin\b|passport|token|password|secret|body|payload|address|dob|birth|otp|pin|card|iban|customer_code|id_number)/i;
const NUM_TYPES = /^(integer|bigint|smallint|numeric|real|double precision|decimal)$/;
const TIME_TYPES = /^timestamp/;

/* derived expressions are written over the alias `e` (the compiler always aliases the FROM as e) */
function fixedDerived() {
  const fe = require('./fixedErrors');
  return {
    error_events: {
      channel:  { label: 'Channel (sda · qr · web · salamhome)', sql: fe.CHANNEL_EXPR, type: 'text', values: ['sda', 'qr', 'web', 'salamhome'] },
      cls:      { label: 'Class (business · technical, catalogue overrides applied)', sql: () => fe.CLASS_SQL(), type: 'text', values: ['business', 'technical'] },
      provider: { label: 'Provider (from the request body)', sql: fe.PROVIDER_EXPR, type: 'text' },
      resp:     { label: 'Response text (first message in the response body)', sql: fe.RESP_EXPR, type: 'text' },
    },
    order_attempts: {
      channel: { label: 'Channel (sda · qr · web · salamhome)', sql: `CASE WHEN e.channel = 'sda' THEN 'sda' WHEN e.channel = 'salamhome' THEN 'salamhome' WHEN e.referral_code IS NOT NULL THEN 'qr' ELSE 'web' END`, type: 'text', values: ['sda', 'qr', 'web', 'salamhome'] },
    },
    api_calls: {
      host:   { label: 'Endpoint host', sql: `coalesce(substring(e.endpoint from '^https?://([^/:]+)'), 'unknown')`, type: 'text' },
      family: { label: 'Endpoint family (ids masked)', sql: `regexp_replace(regexp_replace(split_part(e.endpoint, '?', 1), '^https?://[^/]+', ''), '/[0-9A-Za-z_-]*[0-9][0-9A-Za-z_-]*', '/{id}', 'g')`, type: 'text' },
      technical: { label: 'Technical failure (5xx or transport error)', sql: `CASE WHEN e.status >= 500 OR e.error_class IS NOT NULL THEN 'yes' ELSE 'no' END`, type: 'text', values: ['yes', 'no'] },
    },
  };
}
function mvnoDerived() {
  const { classCaseSql } = require('./errclass');
  const cls = (code, text) => ({ label: 'Class (business · technical, errclass)', sql: classCaseSql(code, text), type: 'text', values: ['business', 'technical'] });
  return {
    activation_logs:  { cls: cls('e.status_code', `coalesce(e.response::text,'')`) },
    eligibility_logs: { cls: cls('e.status_code', `coalesce(e.response::text,'')`) },
    change_plan_logs: { cls: cls('NULL::text', `coalesce(e.final_step_message,'')`) },
  };
}

/* the registry — pool: source (selfcare replica) · ops · opsBeta · console */
const REGISTRY = [
  // ---------------- Mobile (MVNO) — selfcare prod replica ----------------
  { key: 'mvno_payments', segment: 'mvno', pool: 'source', table: 'payments', timeCol: 'created_at', label: 'Payments (selfcare)', prod: 'prod selfcare DB · payments (same table) — L2: Grafana payments board + gateway consoles (UPG / HyperPay / Tap)', sync: 'DB replication (prod-sync)', lagMin: 10 },
  { key: 'mvno_activation_logs', segment: 'mvno', pool: 'source', table: 'activation_logs', timeCol: 'created_at', label: 'Activation / BSS calls (selfcare)', prod: 'prod selfcare DB · activation_logs — L2: BSS (Optiva) response codes, OSB logs', sync: 'DB replication (prod-sync)', lagMin: 10, derived: 'mvno' },
  { key: 'mvno_eligibility_logs', segment: 'mvno', pool: 'source', table: 'eligibility_logs', timeCol: 'created_at', label: 'Eligibility / Semati calls (selfcare)', prod: 'prod selfcare DB · eligibility_logs — L2: TCC / Semati provider status', sync: 'DB replication (prod-sync)', lagMin: 10, derived: 'mvno' },
  { key: 'mvno_nafath_logs', segment: 'mvno', pool: 'source', table: 'nafath_logs', timeCol: 'created_at', label: 'Nafath verifications (selfcare)', prod: 'prod selfcare DB · nafath_logs — L2: Nafath callbacks', sync: 'DB replication (prod-sync)', lagMin: 10 },
  { key: 'mvno_change_plan_logs', segment: 'mvno', pool: 'source', table: 'change_plan_logs', timeCol: 'created_at', label: 'Change plan / ownership (selfcare)', prod: 'prod selfcare DB · change_plan_logs', sync: 'DB replication (prod-sync)', lagMin: 10, derived: 'mvno' },
  { key: 'mvno_delivery_requests', segment: 'mvno', pool: 'source', table: 'delivery_requests', timeCol: 'created_at', label: 'Deliveries / courier (selfcare)', prod: 'prod selfcare DB · delivery_requests — L2: courier portals', sync: 'DB replication (prod-sync)', lagMin: 10 },
  { key: 'mvno_onboarding_orders', segment: 'mvno', pool: 'source', table: 'onboarding_orders', timeCol: 'created_at', label: 'Onboarding orders (selfcare)', prod: 'prod selfcare DB · onboarding_orders', sync: 'DB replication (prod-sync)', lagMin: 10 },
  { key: 'mvno_api_traffic', segment: 'mvno', pool: null, table: null, timeCol: null, label: 'Digital-API traffic (latency · 5xx · 408)', prod: 'Digital-API host logs — L2: Grafana MySQL api logs', sync: 'ssh tail collector (API_LOG_HOSTS) or api_logs table', lagMin: 2, info: true },
  { key: 'mvno_apigw_probe', segment: 'mvno', pool: 'console', table: 'apigw_probe_log', timeCol: 'probed_at', label: 'APIGW node probes', prod: 'API gateway nodes — L2: NOC gateway health', sync: 'console probe', lagMin: 10 },
  // ---------------- Fixed — sda_ops read models, app log, integrations ----------------
  { key: 'fixed_error_events', segment: 'fixed', pool: 'ops', table: 'error_events', timeCol: 'occurred_at', label: 'Error board events (sda_ops)', prod: 'nexus_full on prod (workflow_states + api_logs) — L2: /operations-console board, nexus DB', sync: 'ops-ingest-watch (db-watch) → sda_ops', lagMin: 15, derived: 'fixed' },
  { key: 'fixed_order_attempts', segment: 'fixed', pool: 'ops', table: 'order_attempts', timeCol: 'started_at', label: 'Order attempts / journeys (sda_ops)', prod: 'nexus_full · workflow_states — L2: /operations-console, nexus DB', sync: 'ops-ingest-watch (db-watch) → sda_ops', lagMin: 15, derived: 'fixed' },
  { key: 'fixed_api_calls', segment: 'fixed', pool: 'ops', table: 'api_calls', timeCol: 'created_at', label: 'Outbound integration calls (sda_ops)', prod: 'nexus_full · api_logs (TLS / DAWIYAT / STC / SALAM / ACES / MOBILY endpoints) — L2: provider portals', sync: 'ops-ingest-watch (api_logs) → sda_ops', lagMin: 15, derived: 'fixed' },
  { key: 'fixed_error_events_beta', segment: 'fixed', pool: 'opsBeta', table: 'error_events', timeCol: 'occurred_at', label: 'Error board events — beta (Epurchase + Salam Home app)', prod: 'nexus_full B2C scope — L2: /operations-console-beta', sync: 'opsb-ingest-watch → sda_ops_beta (crash-looping since 22 Aug 2026)', lagMin: 15, derived: 'fixed' },
  { key: 'fixed_app_events', segment: 'fixed', pool: 'console', table: 'fixed_app_events', timeCol: 'ts', label: 'App log — per-step outcomes (combined.log)', prod: '/app/log/sda/combined.log on 146 (RUH-App-P01) — L2: tail on the app node', sync: 'ssh byte-watermark tail (fixedAppLogCollector, FIXED_LOG_HOSTS)', lagMin: 3 },
  { key: 'fixed_yakeen_probe', segment: 'fixed', pool: 'console', table: 'yakeen_probe_runs', timeCol: 'run_at', label: 'Yakeen / ELM synthetic probe runs', prod: 'ELM Yakeen endpoints (login + 4 data calls via 146) — L2: ELM support portal', sync: 'scheduled probe 10:00 / 16:00 / 22:00 KSA + manual (capped)', lagMin: 8 * 60 },
  { key: 'fixed_board_hourly', segment: 'fixed', pool: 'console', table: 'fixed_board_hourly', timeCol: 'hour', label: 'Board hourly rollup (baselines)', prod: 'derived from error_events — no prod equivalent', sync: '5-min rollup loop (fixedChannelMetrics)', lagMin: 70, info: true },
];

const pools = () => ({ source: db.source, ops: db.ops, opsBeta: db.opsBeta && db.opsBeta !== db.ops ? db.opsBeta : null, console: db.console });
const byKey = k => REGISTRY.find(d => d.key === k) || null;
function derivedOf(ds) {
  if (!ds || !ds.derived) return {};
  const all = ds.derived === 'fixed' ? fixedDerived() : mvnoDerived();
  return all[ds.table] || {};
}

/* ---- operator overrides (label / prod / lagMin) ---- */
let ovCache = { at: 0, v: {} };
async function overrides() {
  if (Date.now() - ovCache.at < 30e3) return ovCache.v;
  try { ovCache = { at: Date.now(), v: (await require('./settings').getSetting('datasets_overrides')) || {} }; } catch (_) { ovCache = { at: Date.now(), v: {} }; }
  return ovCache.v;
}
async function setOverride(key, patch, actor) {
  const s = require('./settings'); const cur = (await s.getSetting('datasets_overrides')) || {};
  cur[key] = { ...(cur[key] || {}), ...patch, updated_by: actor, updated_at: new Date().toISOString() };
  await s.setSetting('datasets_overrides', cur); ovCache = { at: 0, v: {} };
  return cur[key];
}

/* ---- columns (information_schema, cached 10 min) ---- */
const colCache = new Map();
async function columns(key) {
  const ds = byKey(key); if (!ds || ds.info) return [];
  const h = colCache.get(key); if (h && Date.now() - h.at < 10 * 60e3) return h.cols;
  const pool = pools()[ds.pool]; if (!pool) return [];
  const schema = pool.schema || 'public';
  let cols = [];
  try {
    const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [schema, ds.table]);
    cols = r.rows.filter(c => !PII_RE.test(c.column_name)).map(c => ({ name: c.column_name, type: NUM_TYPES.test(c.data_type) ? 'number' : c.data_type === 'boolean' ? 'boolean' : TIME_TYPES.test(c.data_type) ? 'time' : (c.data_type === 'jsonb' || c.data_type === 'json') ? 'json' : 'text', derived: false }));
  } catch (e) { console.error(`[datasets] columns ${key}: ${e.message}`); }
  /* a derived expression wins over a raw column of the same name (error_events.channel is the app's raw value; the
   * derived `channel` is the board bucket sda · qr · web · salamhome) */
  const derived = derivedOf(ds); cols = cols.filter(c => !derived[c.name]);
  for (const [name, d] of Object.entries(derived)) cols.push({ name, type: d.type || 'text', derived: true, label: d.label, values: d.values || null });
  colCache.set(key, { at: Date.now(), cols });
  return cols;
}

/* ---- freshness (cached 60 s per dataset) ---- */
const freshCache = new Map();
async function freshness(key) {
  const ds = byKey(key); if (!ds) return null;
  const h = freshCache.get(key); if (h && Date.now() - h.at < 60e3) return h.v;
  let v;
  if (ds.info || !ds.pool) v = { available: false, reason: ds.info ? 'no table — see the sync mechanism' : 'not configured' };
  else {
    const pool = pools()[ds.pool];
    if (!pool) v = { available: false, reason: `pool ${ds.pool} not configured` };
    else {
      try {
        const t = ds.timeCol;
        const r = (await pool.query(`SELECT max(${t}) AS newest, count(*) FILTER (WHERE ${t} >= now() - interval '1 hour')::int AS n1h, count(*) FILTER (WHERE ${t} >= now() - interval '24 hours')::int AS n24h FROM ${ds.table} WHERE ${t} >= now() - interval '2 days'`)).rows[0];
        const newest = r && r.newest ? new Date(r.newest) : null;
        v = { available: true, newest: newest ? newest.toISOString() : null, lagMin: newest ? Math.round((Date.now() - newest.getTime()) / 60e3) : null, n1h: r ? r.n1h : 0, n24h: r ? r.n24h : 0 };
      } catch (e) { v = { available: false, reason: e.message }; }
    }
  }
  freshCache.set(key, { at: Date.now(), v });
  return v;
}
function statusOf(ds, f, lagMin) {
  if (!f || !f.available) return 'unavailable';
  if (f.lagMin == null) return 'empty';
  if (f.lagMin <= lagMin) return 'synced';
  if (f.lagMin <= 3 * lagMin) return 'lagging';
  return 'stale';
}
async function list(segment) {
  const ov = await overrides();
  const out = [];
  for (const ds of REGISTRY.filter(d => !segment || segment === 'all' || d.segment === segment)) {
    const o = ov[ds.key] || {}; const lagMin = Number(o.lagMin) > 0 ? Number(o.lagMin) : ds.lagMin;
    const f = await freshness(ds.key);
    out.push({ key: ds.key, segment: ds.segment, pool: ds.pool, table: ds.table, timeCol: ds.timeCol, info: !!ds.info, label: o.label || ds.label, prod: o.prod || ds.prod, sync: ds.sync, lagMin, overridden: !!(o.label || o.prod || o.lagMin),
      freshness: f, status: statusOf(ds, f, lagMin), columns: ds.info ? [] : await columns(ds.key) });
  }
  return out;
}
/* one-line "data as of" stamp for an incident, by dataset key */
async function asOf(key) {
  const ds = byKey(key); if (!ds) return '';
  const f = await freshness(key); if (!f || !f.available || !f.newest) return '';
  return `data as of ${f.newest.slice(11, 16)}Z (${ds.label.split(' (')[0]}, lag ${f.lagMin} min)`;
}
/* distinct values of a text column over the last 7 days (filter pickers) */
async function values(key, column) {
  const ds = byKey(key); if (!ds || ds.info) return [];
  const cols = await columns(key); const c = cols.find(x => x.name === column); if (!c) throw new Error('unknown column');
  if (c.derived && c.values) return c.values.map(v => ({ v, n: null }));
  const pool = pools()[ds.pool]; if (!pool) return [];
  const expr = c.derived ? exprOf(ds, c.name) : `e.${c.name}::text`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query('SET LOCAL statement_timeout = 8000');
    const r = await client.query(`SELECT ${expr} AS v, count(*)::int AS n FROM ${ds.table} e WHERE e.${ds.timeCol} >= now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 40`);
    await client.query('COMMIT'); return r.rows.map(x => ({ v: x.v, n: x.n }));
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}
function exprOf(ds, name) {
  const d = derivedOf(ds)[name]; if (!d) return null;
  return typeof d.sql === 'function' ? d.sql() : d.sql;
}

function mount(app, { requireCap, audit }) {
  app.get('/api/datasets', async (req, res) => { try { res.json({ datasets: await list(req.query.segment || 'all') }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/datasets/:key/values', async (req, res) => { try { res.json({ values: await values(req.params.key, String(req.query.column || '')) }); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.patch('/api/datasets/:key', requireCap('editRules'), async (req, res) => {
    try {
      if (!byKey(req.params.key)) return res.status(404).json({ error: 'unknown dataset' });
      const b = req.body || {}; const patch = {};
      if (b.label != null) patch.label = String(b.label).slice(0, 120);
      if (b.prod != null) patch.prod = String(b.prod).slice(0, 400);
      if (b.lagMin != null) patch.lagMin = Math.max(1, Number(b.lagMin) || 0);
      const v = await setOverride(req.params.key, patch, req.actor);
      await audit(req, 'dataset.update', req.params.key, patch);
      res.json({ ok: true, override: v });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
module.exports = { REGISTRY, byKey, columns, freshness, list, asOf, values, exprOf, derivedOf, pools, mount };
