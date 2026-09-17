/* Custom metrics — declarative metric definitions managed from the console (16 Sep 2026).
 *
 * WHY DECLARATIVE: an operator never types SQL. A definition is { dataset, measure, filters, dimension } over a
 * dataset from datasets.js (registered table + introspected, PII-blacklisted columns + declared derived expressions).
 * compile() turns it into ONE parameterised statement: every column is whitelisted by name, every value is a bind
 * parameter, the scan is bounded to the rule window on the dataset's time column, a SET LOCAL statement_timeout
 * (10 s) caps the cost and rows are capped per dimension. The result has exactly the shape of a code metric
 * ({ dim, value, sample } rows), so sync.js, alertRunner.js, the charts, the wizard and the digest need no change.
 *
 * SAFETY RAILS
 *   lifecycle   draft → shadow → live → retired (+ suspended). Only shadow/live are registered in METRICS.
 *   shadow      computed and snapshotted like live, but alertRunner never opens an incident on it: the evaluation
 *               is marked shadowFired and counted on the definition (would_fire) so the operator sees what it
 *               WOULD have paged before letting it page. Auto-promotes to live at shadow_until.
 *   quarantine  3 consecutive compute failures or a compute over MAX_MS → status suspended, visible on the tab,
 *               the rule reports "no data in window" (never a fabricated 0).
 *   versions    every save writes metric_definition_versions; rollback restores a version as a new version.
 *   namespace   keys are custom_<slug> (Mobile) / fixed_custom_<slug> (Fixed) — the segment logic of the console
 *               (fixed_ prefix) and the seed validation both keep working; built-in code metrics are untouched.
 *   permissions reads = any console user of the segment; writes = capability editRules (super admin / alert admin).
 */
const db = require('./db');
const datasets = require('./datasets');

const MAX_MS = 10000, ROW_CAP = 60, FAILS_TO_SUSPEND = 3;
const MEASURES = ['count', 'rate', 'p50', 'p95', 'avg', 'distinct'];
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', in: 'IN', like: 'ILIKE', null: 'IS NULL', notnull: 'IS NOT NULL' };
const C = () => db.console;
const n = v => Number(v) || 0;

let ready = null;
function ensure() {
  if (!C()) return Promise.resolve(false);
  if (!ready) ready = C().query(`CREATE TABLE IF NOT EXISTS metric_definitions (
      key text PRIMARY KEY, segment text NOT NULL, label text NOT NULL, description text, unit text NOT NULL, higher_is_bad boolean NOT NULL DEFAULT true,
      spec jsonb NOT NULL, status text NOT NULL DEFAULT 'draft', shadow_until timestamptz, version int NOT NULL DEFAULT 1, owner text,
      created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_by text, updated_at timestamptz NOT NULL DEFAULT now(),
      fail_count int NOT NULL DEFAULT 0, last_error text, last_ms int, last_rows int, last_run timestamptz, would_fire int NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS metric_definition_versions (id bigserial PRIMARY KEY, key text NOT NULL, version int NOT NULL, label text, unit text, higher_is_bad boolean, spec jsonb NOT NULL, status text, actor text, note text, at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS idx_mdv_key ON metric_definition_versions (key, version DESC);
    CREATE TABLE IF NOT EXISTS metric_changes (id bigserial PRIMARY KEY, key text NOT NULL, segment text, version int, action text NOT NULL, actor text, at timestamptz NOT NULL DEFAULT now(), changes jsonb NOT NULL DEFAULT '{}', note text, source text NOT NULL DEFAULT 'console');
    CREATE INDEX IF NOT EXISTS idx_metric_changes_key ON metric_changes (key, at DESC);
    CREATE INDEX IF NOT EXISTS idx_metric_changes_at ON metric_changes (at DESC);`).then(() => true).catch(e => { ready = null; throw e; });
  return ready;
}

/* ---------------- validation + compilation ---------------- */
function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48); }
function keyFor(segment, label, key) { const base = key ? slug(key.replace(/^(fixed_)?custom_/, '')) : slug(label); if (!base) throw new Error('label needed for the key'); return (segment === 'fixed' ? 'fixed_custom_' : 'custom_') + base; }
function unitFor(measure) { return measure === 'rate' ? 'rate' : (measure === 'p50' || measure === 'p95' || measure === 'avg') ? 'ms' : 'count'; }

async function validate(segment, spec) {
  if (!spec || typeof spec !== 'object') throw new Error('spec missing');
  const ds = datasets.byKey(spec.dataset); if (!ds || ds.info) throw new Error('unknown dataset');
  if (ds.segment !== segment) throw new Error(`dataset ${ds.key} belongs to ${ds.segment}`);
  const cols = await datasets.columns(ds.key); const col = name => cols.find(c => c.name === name);
  const m = spec.measure || {}; if (!MEASURES.includes(m.type)) throw new Error('measure must be ' + MEASURES.join(' | '));
  if (['p50', 'p95', 'avg'].includes(m.type)) { const c = col(m.column); if (!c || c.type !== 'number') throw new Error('percentile / avg needs a numeric column'); }
  if (m.type === 'distinct') { if (!col(m.column)) throw new Error('distinct needs a column'); }
  const checkFilters = (arr, what) => { for (const f of arr || []) { const c = col(f.col); if (!c) throw new Error(`${what}: unknown column ${f.col}`); if (!OPS[f.op]) throw new Error(`${what}: bad operator ${f.op}`); if (!['null', 'notnull'].includes(f.op) && (f.value === undefined || f.value === null || f.value === '')) throw new Error(`${what}: value needed for ${f.col}`); } };
  checkFilters(spec.filters, 'filter');
  if (m.type === 'rate') { if (!(m.numerator || []).length) throw new Error('rate needs at least one numerator condition'); checkFilters(m.numerator, 'numerator'); }
  if (spec.dimension) { const c = col(spec.dimension); if (!c) throw new Error('unknown dimension column'); if (c.type === 'json' || c.type === 'time') throw new Error('dimension must be text / number / boolean'); }
  return { ds, cols };
}
function condSql(ds, cols, f, P) {
  const c = cols.find(x => x.name === f.col);
  const raw = c.derived ? `(${datasets.exprOf(ds, c.name)})` : `e.${c.name}`;
  const isNum = c.type === 'number', isBool = c.type === 'boolean';
  const lhs = c.derived ? raw : (isNum ? raw : isBool ? raw : `${raw}::text`);
  const cast = isNum ? '::numeric' : isBool ? '::boolean' : '::text';
  if (f.op === 'null' || f.op === 'notnull') return `${raw} ${OPS[f.op]}`;
  if (f.op === 'in') { const vals = String(f.value).split(',').map(s => s.trim()).filter(Boolean); P.push(isNum ? vals.map(Number) : vals); return `${lhs} = ANY($${P.length}${isNum ? '::numeric[]' : '::text[]'})`; }
  if (f.op === 'like') { P.push('%' + String(f.value) + '%'); return `${raw}::text ILIKE $${P.length}`; }
  P.push(isNum ? Number(f.value) : isBool ? /^(true|1|yes)$/i.test(String(f.value)) : String(f.value));
  return `${lhs} ${OPS[f.op]} $${P.length}${cast}`;
}
/* → { sql, params(nowIso, windowHours), pool, dimCol } */
async function compile(segment, spec) {
  const { ds, cols } = await validate(segment, spec);
  const P = []; const base = [`e.${ds.timeCol} >= $1::timestamptz - ($2||' hours')::interval`, `e.${ds.timeCol} < $1::timestamptz`]; P.push(null, null);
  for (const f of spec.filters || []) base.push(condSql(ds, cols, f, P));
  const m = spec.measure;
  let value, sample;
  if (m.type === 'count') { value = 'count(*)::float'; sample = 'count(*)::int'; }
  else if (m.type === 'rate') { const num = (m.numerator || []).map(f => condSql(ds, cols, f, P)).join(' AND '); value = `CASE WHEN count(*) > 0 THEN count(*) FILTER (WHERE ${num})::float / count(*) END`; sample = 'count(*)::int'; }
  else if (m.type === 'distinct') { const c = cols.find(x => x.name === m.column); value = `count(DISTINCT ${c.derived ? `(${datasets.exprOf(ds, c.name)})` : 'e.' + c.name})::float`; sample = 'count(*)::int'; }
  else { const col = `e.${m.column}`; value = m.type === 'avg' ? `avg(${col})::float` : `percentile_cont(${m.type === 'p50' ? 0.5 : 0.95}) WITHIN GROUP (ORDER BY ${col})::float`; sample = `count(${col})::int`; }
  let dimExpr = null;
  if (spec.dimension) { const c = cols.find(x => x.name === spec.dimension); dimExpr = c.derived ? `(${datasets.exprOf(ds, c.name)})` : `e.${c.name}::text`; }
  const groupBy = dimExpr ? (spec.includeAll ? `GROUP BY GROUPING SETS ((${dimExpr}), ())` : `GROUP BY ${dimExpr}`) : '';
  const sql = `SELECT ${dimExpr ? `${dimExpr} AS d, grouping(${dimExpr}) AS g` : `NULL::text AS d, 0 AS g`}, ${value} AS value, ${sample} AS sample
    FROM ${ds.table} e WHERE ${base.join(' AND ')} ${groupBy} ORDER BY 4 DESC LIMIT ${ROW_CAP}`;
  return { sql, params: (now, w) => { const p = P.slice(); p[0] = now; p[1] = String(w); return p; }, pool: datasets.pools()[ds.pool], ds, dimCol: spec.dimension || null };
}
async function runCompiled(cp, now, w) {
  if (!cp.pool) throw new Error(`pool for ${cp.ds.key} not configured`);
  const client = await cp.pool.connect(); const t0 = Date.now();
  try {
    await client.query('BEGIN'); await client.query(`SET LOCAL statement_timeout = ${MAX_MS}`);
    const r = await client.query(cp.sql, cp.params(now, w)); await client.query('COMMIT');
    const rows = r.rows.map(x => ({ dim: cp.dimCol ? { [cp.dimCol]: Number(x.g) === 1 ? 'all' : (x.d == null ? '-' : String(x.d)) } : {}, value: x.value == null ? null : Number(x.value), sample: n(x.sample) }));
    return { rows, ms: Date.now() - t0 };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}

/* the cases behind an alert on a custom metric (alertCases.js): population = dataset rows matching the filters in the
 * window; counted = numerator (rate) | value at/over the rule threshold (p50 · p95 · avg) | every row (count · distinct) */
async function caseSpec(key, T, W, dim, threshold) {
  const def = await get(key); if (!def) throw new Error('metric definition not found');
  const { ds, cols } = await validate(def.segment, def.spec);
  const P = [T, W]; const parts = [`e.${ds.timeCol} >= $1::timestamptz - ($2||' hours')::interval`, `e.${ds.timeCol} < $1::timestamptz`];
  for (const f of def.spec.filters || []) parts.push(condSql(ds, cols, f, P));
  if (def.spec.dimension && dim && dim[def.spec.dimension] != null && dim[def.spec.dimension] !== 'all') { const c = cols.find(x => x.name === def.spec.dimension); P.push(String(dim[def.spec.dimension])); parts.push(`${c.derived ? `(${datasets.exprOf(ds, c.name)})` : `e.${c.name}::text`} = $${P.length}`); }
  const m = def.spec.measure; let num = 'TRUE';
  if (m.type === 'rate') num = (m.numerator || []).map(f => condSql(ds, cols, f, P)).join(' AND ') || 'TRUE';
  else if (['p50', 'p95', 'avg'].includes(m.type) && threshold != null && !Number.isNaN(threshold)) { P.push(threshold); num = `e.${m.column} >= $${P.length}::numeric`; parts.push(`e.${m.column} IS NOT NULL`); }
  const show = cols.filter(c => c.type !== 'json').slice(0, 14);
  const selCols = [`e.${ds.timeCol} AS ts`].concat(show.filter(c => c.name !== ds.timeCol).map(c => c.derived ? `(${datasets.exprOf(ds, c.name)}) AS "${c.name}"` : `e.${c.name} AS "${c.name}"`)).join(', ');
  const head = [['ts', 'Time (KSA)']].concat(show.filter(c => c.name !== ds.timeCol).map(c => [c.name, c.name.replace(/_/g, ' ')]));
  return { pool: datasets.pools()[ds.pool], from: `${ds.table} e`, cols: selCols, head, pop: parts.join(' AND '), num, params: P, order: ['p50', 'p95', 'avg'].includes(m.type) ? `e.${m.column} DESC NULLS LAST` : `e.${ds.timeCol} DESC`, group: def.spec.dimension || null,
    note: `population = ${ds.label} rows matching the metric filters in the window · counted = ${m.type === 'rate' ? 'the numerator conditions' : ['p50', 'p95', 'avg'].includes(m.type) ? `${m.column} at or over the rule threshold` : 'every row'} (console-managed metric ${key} v${def.version})` };
}

/* ---------------- registry integration ---------------- */
const compiled = new Map();          // key → { cp, def }
function metricsMap() { return require('./metrics').METRICS; }
async function register(def) {
  const cp = await compile(def.segment, def.spec);
  compiled.set(def.key, { cp, def });
  metricsMap()[def.key] = { label: def.label, unit: def.unit, higherIsBad: !!def.higher_is_bad, sourceTables: `${cp.ds.pool}.${cp.ds.table}`, segment: def.segment, custom: true,
    compute: async (_src, now, w) => computeFor(def.key, new Date(now).toISOString(), w) };
  try { await C().query(`INSERT INTO metric_catalog (key, label, unit, higher_is_bad, source_tables) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, unit=EXCLUDED.unit, higher_is_bad=EXCLUDED.higher_is_bad, source_tables=EXCLUDED.source_tables`, [def.key, def.label, def.unit, !!def.higher_is_bad, `${cp.ds.pool}.${cp.ds.table}`]); } catch (_) {}
}
function unregister(key) { compiled.delete(key); delete metricsMap()[key]; }
async function computeFor(key, now, w) {
  const h = compiled.get(key); if (!h) return [];
  try {
    const { rows, ms } = await runCompiled(h.cp, now, w);
    await C().query(`UPDATE metric_definitions SET fail_count = 0, last_error = NULL, last_ms = $2, last_rows = $3, last_run = now() WHERE key = $1`, [key, ms, rows.length]).catch(() => {});
    if (ms > MAX_MS) { await suspend(key, `compute took ${ms} ms (limit ${MAX_MS})`); }
    return rows;
  } catch (e) {
    const r = (await C().query(`UPDATE metric_definitions SET fail_count = fail_count + 1, last_error = $2, last_run = now() WHERE key = $1 RETURNING fail_count`, [key, e.message]).catch(() => ({ rows: [{ fail_count: 0 }] }))).rows[0];
    console.error(`[customMetrics] ${key}: ${e.message}`);
    if (r && r.fail_count >= FAILS_TO_SUSPEND) await suspend(key, `${r.fail_count} consecutive failures · ${e.message}`);
    return [];
  }
}
async function suspend(key, why) {
  const before = await get(key).catch(() => null);
  await C().query(`UPDATE metric_definitions SET status = 'suspended', last_error = $2, updated_at = now() WHERE key = $1 AND status IN ('live','shadow')`, [key, why]).catch(() => {});
  unregister(key); console.error(`[customMetrics] ${key} SUSPENDED — ${why}`);
  const after = await get(key).catch(() => null); if (before && after && before.status !== after.status) await logChange(after, 'suspend', 'system', diffDefs(before, after), why, 'system');
}
const shadowCache = { at: 0, keys: new Set() };
async function refreshShadow() {
  if (Date.now() - shadowCache.at < 30e3) return;
  try {
    const promoted = (await C().query(`UPDATE metric_definitions SET status = 'live', updated_at = now() WHERE status = 'shadow' AND shadow_until IS NOT NULL AND shadow_until <= now() RETURNING *`)).rows;
    for (const d of promoted) await logChange(d, 'auto_promote', 'system', { status: { from: 'shadow', to: 'live' } }, `shadow period ended · would have fired ×${d.would_fire}`, 'system');
    const r = await C().query(`SELECT key FROM metric_definitions WHERE status = 'shadow'`);
    shadowCache.keys = new Set(r.rows.map(x => x.key));
  } catch (_) {}
  shadowCache.at = Date.now();
}
async function isShadow(key) { if (!/custom_/.test(key)) return false; await refreshShadow(); return shadowCache.keys.has(key); }
async function noteWouldFire(key) { await C().query(`UPDATE metric_definitions SET would_fire = would_fire + 1 WHERE key = $1`, [key]).catch(() => {}); }

async function load() {
  if (!(await ensure())) return 0;
  const r = await C().query(`SELECT * FROM metric_definitions WHERE status IN ('live','shadow')`);
  let ok = 0;
  for (const def of r.rows) { try { await register(def); ok++; } catch (e) { console.error(`[customMetrics] load ${def.key}: ${e.message}`); } }
  console.log(`[customMetrics] ${ok} custom metric(s) registered`);
  return ok;
}

/* ---------------- CHANGE TRACKING (16 Sep 2026: "detailed log / tracking of any metric change") ----------------
 * Every mutation writes ONE row in metric_changes with a FIELD-LEVEL diff { field: { from, to } } — label, unit,
 * direction, description, owner, status, shadow_until and every part of the spec (dataset, measure.type,
 * measure.column, measure.numerator[i], filters[i], dimension, includeAll). Actions: create · update · status ·
 * rollback · suspend · auto_promote. The same diff goes to the console audit log (audit()) so Alerts › Activity log
 * shows it next to rule changes, and the Metrics tab / drawer read it back from /api/metric-defs/:key/changes. */
function flat(def) {
  const o = {}; if (!def) return o;
  o.label = def.label; o.unit = def.unit; o.direction = def.higher_is_bad === false ? 'lower is bad' : 'higher is bad'; o.description = def.description || ''; o.owner = def.owner || '';
  o.status = def.status; o.shadow_until = def.shadow_until ? new Date(def.shadow_until).toISOString() : null;
  const sp = def.spec || {}; o.dataset = sp.dataset || null; const m = sp.measure || {};
  o['measure.type'] = m.type || null; o['measure.column'] = m.column || null;
  const cond = f => `${f.col} ${f.op}${f.value !== undefined && f.value !== '' && f.value !== null ? ' ' + f.value : ''}`;
  (m.numerator || []).forEach((f, i) => { o[`measure.numerator[${i}]`] = cond(f); });
  (sp.filters || []).forEach((f, i) => { o[`filters[${i}]`] = cond(f); });
  o.dimension = sp.dimension || null; o.includeAll = sp.dimension ? !!sp.includeAll : null;
  return o;
}
function diffDefs(before, after) {
  const a = flat(before), b = flat(after), out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const x = a[k] ?? null, y = b[k] ?? null; if (JSON.stringify(x) !== JSON.stringify(y)) out[k] = { from: x, to: y }; }
  return out;
}
async function logChange(def, action, actor, changes, note, source = 'console') {
  try { await C().query(`INSERT INTO metric_changes (key, segment, version, action, actor, changes, note, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [def.key, def.segment, def.version, action, actor || null, JSON.stringify(changes || {}), note || null, source]); } catch (e) { console.error(`[customMetrics] change log ${def.key}: ${e.message}`); }
}
async function changes(key, segment, days = 30, limit = 300) {
  await ensure();
  const r = await C().query(`SELECT id, key, segment, version, action, actor, at, changes, note, source FROM metric_changes
      WHERE ($1::text IS NULL OR key = $1) AND ($2 = 'all' OR segment = $2) AND at >= now() - ($3::int || ' days')::interval ORDER BY at DESC, id DESC LIMIT $4`, [key || null, segment || 'all', days, limit]);
  return r.rows;
}

/* ---------------- CRUD + lifecycle ---------------- */
async function get(key) { const r = await C().query(`SELECT * FROM metric_definitions WHERE key = $1`, [key]); return r.rows[0] || null; }
async function list(segment) {
  await ensure();
  const r = await C().query(`SELECT d.*, (SELECT count(*)::int FROM alert_rules ar WHERE ar.metric_key = d.key) AS rules,
      (SELECT count(*)::int FROM alert_rules ar WHERE ar.metric_key = d.key AND ar.enabled) AS rules_on
    FROM metric_definitions d WHERE ($1 = 'all' OR d.segment = $1) ORDER BY (d.status = 'live') DESC, d.updated_at DESC`, [segment || 'all']);
  return r.rows;
}
async function saveVersion(def, actor, note) {
  await C().query(`INSERT INTO metric_definition_versions (key, version, label, unit, higher_is_bad, spec, status, actor, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [def.key, def.version, def.label, def.unit, def.higher_is_bad, JSON.stringify(def.spec), def.status, actor, note || null]);
}
async function create(segment, b, actor) {
  await ensure();
  const key = keyFor(segment, b.label, b.key);
  if (await get(key)) throw new Error(`key ${key} already exists`);
  await validate(segment, b.spec);
  const unit = b.unit || unitFor(b.spec.measure.type);
  const def = { key, segment, label: String(b.label || key).slice(0, 140), description: b.description || null, unit, higher_is_bad: b.higher_is_bad !== false, spec: b.spec, status: 'draft', version: 1, owner: b.owner || actor };
  await C().query(`INSERT INTO metric_definitions (key, segment, label, description, unit, higher_is_bad, spec, status, version, owner, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',1,$8,$9,$9)`,
    [def.key, def.segment, def.label, def.description, def.unit, def.higher_is_bad, JSON.stringify(def.spec), def.owner, actor]);
  await saveVersion(def, actor, 'created');
  const row = await get(key); await logChange(row, 'create', actor, diffDefs(null, row), b.note || 'created'); return row;
}
async function update(key, b, actor) {
  const cur = await get(key); if (!cur) throw new Error('not found');
  const spec = b.spec || cur.spec; await validate(cur.segment, spec);
  const label = b.label != null ? String(b.label).slice(0, 140) : cur.label;
  const unit = b.unit || (b.spec ? unitFor(spec.measure.type) : cur.unit);
  const hib = b.higher_is_bad != null ? !!b.higher_is_bad : cur.higher_is_bad;
  const changed = JSON.stringify(spec) !== JSON.stringify(cur.spec) || label !== cur.label || unit !== cur.unit || hib !== cur.higher_is_bad;
  const version = changed ? cur.version + 1 : cur.version;
  await C().query(`UPDATE metric_definitions SET label=$2, description=$3, unit=$4, higher_is_bad=$5, spec=$6, version=$7, owner=$8, updated_by=$9, updated_at=now(), fail_count=0, last_error=NULL WHERE key=$1`,
    [key, label, b.description != null ? b.description : cur.description, unit, hib, JSON.stringify(spec), version, b.owner || cur.owner, actor]);
  const def = await get(key);
  const d = diffDefs(cur, def);
  if (changed) { await saveVersion(def, actor, b.note || 'updated'); if (['live', 'shadow'].includes(def.status)) await register(def); }
  if (Object.keys(d).length) await logChange(def, b._action || 'update', actor, d, b.note || null);
  return def;
}
async function setStatus(key, status, actor, opts = {}) {
  const cur = await get(key); if (!cur) throw new Error('not found');
  if (!['draft', 'shadow', 'live', 'retired'].includes(status)) throw new Error('bad status');
  const shadowUntil = status === 'shadow' ? new Date(Date.now() + Math.max(1, Number(opts.shadowHours) || 24) * 3600e3).toISOString() : null;
  await C().query(`UPDATE metric_definitions SET status=$2, shadow_until=$3, updated_by=$4, updated_at=now(), fail_count=0, last_error=NULL, would_fire=0 WHERE key=$1`, [key, status, shadowUntil, actor]);
  const def = await get(key);
  if (status === 'live' || status === 'shadow') await register(def); else unregister(key);
  shadowCache.at = 0;
  await saveVersion(def, actor, `status → ${status}`);
  await logChange(def, 'status', actor, diffDefs(cur, def), opts.note || `${cur.status} → ${status}${shadowUntil ? ` (shadow until ${shadowUntil.slice(0, 16)}Z)` : ''}`);
  return def;
}
async function rollback(key, version, actor) {
  const v = (await C().query(`SELECT * FROM metric_definition_versions WHERE key=$1 AND version=$2 ORDER BY id DESC LIMIT 1`, [key, version])).rows[0];
  if (!v) throw new Error('version not found');
  return update(key, { spec: v.spec, label: v.label, unit: v.unit, higher_is_bad: v.higher_is_bad, note: `rollback to v${version}`, _action: 'rollback' }, actor);
}
async function versions(key) { return (await C().query(`SELECT version, label, unit, higher_is_bad, spec, status, actor, note, at FROM metric_definition_versions WHERE key=$1 ORDER BY version DESC, id DESC LIMIT 50`, [key])).rows; }
/* run once now (test) or a coarse 7-day series (preview) — both on the real source, bounded */
async function test(segment, spec, windowHours) { const cp = await compile(segment, spec); const now = new Date().toISOString(); const r = await runCompiled(cp, now, windowHours || 1); return { now, ...r, sql: cp.sql }; }
async function preview(segment, spec, windowHours, days = 7, stepHours = 6) {
  const cp = await compile(segment, spec); const points = []; const end = Date.now(); let ms = 0;
  for (let t = end - days * 864e5; t <= end; t += stepHours * 3600e3) {
    const now = new Date(t).toISOString();
    try { const r = await runCompiled(cp, now, windowHours || 1); ms += r.ms; points.push({ t: now, rows: r.rows }); if (ms > 60000) break; }
    catch (e) { points.push({ t: now, error: e.message }); break; }
  }
  return { points, ms };
}

/* the FULL registry for the Metrics tab: every code metric of the segment (+ the custom ones), with the rules using it,
 * the latest snapshot (value · rows · when) and the file that defines it — so the tab is the single list, not only customs */
async function catalog(segment) {
  await ensure();
  const M = metricsMap();
  const isFixed = k => k.startsWith('fixed_');
  const keys = Object.keys(M).filter(k => segment === 'all' || (segment === 'fixed') === isFixed(k));
  const rules = (await C().query(`SELECT metric_key, count(*)::int AS n, count(*) FILTER (WHERE enabled)::int AS on_ FROM alert_rules GROUP BY 1`)).rows;
  const byRule = Object.fromEntries(rules.map(r => [r.metric_key, r]));
  const snaps = (await C().query(`WITH last AS (SELECT metric_key, max(sim_now) AS t FROM metric_snapshots WHERE sim_now >= now() - interval '2 days' GROUP BY 1)
      SELECT s.metric_key, s.value, s.sample, s.sim_now, s.dim, count(*) OVER (PARTITION BY s.metric_key)::int AS rows
      FROM metric_snapshots s JOIN last l ON l.metric_key = s.metric_key AND l.t = s.sim_now`)).rows;
  const bySnap = {};
  for (const r of snaps) { const cur = bySnap[r.metric_key]; const isAll = r.dim && (r.dim.channel === 'all' || Object.keys(r.dim).filter(k => k !== 'note').length === 0); if (!cur || isAll) bySnap[r.metric_key] = { value: r.value, sample: r.sample, sim_now: r.sim_now, rows: r.rows, dim: r.dim }; }
  const defs = Object.fromEntries((await list(segment)).map(d => [d.key, d]));
  const fileOf = k => M[k].custom ? 'console' : (M[k].sourceTables || '').includes('fixed_app_events') || (M[k].sourceTables || '').includes('fixed_board_hourly') || /^fixed_(board|applog|provider_api)_/.test(k) ? 'fixedChannelMetrics.js' : isFixed(k) ? 'fixedMetrics.js' : 'metrics.js';
  return keys.map(k => { const m = M[k]; const r = byRule[k] || { n: 0, on_: 0 }; const sn = bySnap[k] || null; const d = defs[k];
    return { key: k, label: m.label, unit: m.unit, higher_is_bad: !!m.higherIsBad, source: m.sourceTables || '', custom: !!m.custom, file: fileOf(k), rules: r.n, rules_on: r.on_, status: d ? d.status : 'code',
      last: sn ? { value: sn.value == null ? null : Number(sn.value), sample: Number(sn.sample), at: sn.sim_now, rows: sn.rows, dim: sn.dim } : null }; }).sort((a, b) => a.key.localeCompare(b.key));
}

function mount(app, { requireCap, audit }) {
  app.get('/api/metric-defs/catalog', async (req, res) => { try { res.json({ metrics: await catalog(req.query.segment || 'all') }); } catch (e) { res.status(500).json({ error: e.message }); } });
  const seg = req => (req.params.segment || req.query.segment || req.body?.segment || 'mvno') === 'fixed' ? 'fixed' : 'mvno';
  const fail = (res, e) => res.status(400).json({ error: e.message });
  app.get('/api/metric-defs', async (req, res) => { try { res.json({ defs: await list(req.query.segment || 'all'), measures: MEASURES, ops: Object.keys(OPS) }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/metric-defs/changes', async (req, res) => { try { res.json({ changes: await changes(null, req.query.segment || 'all', Number(req.query.days) || 30) }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/metric-defs/:key/changes', async (req, res) => { try { res.json({ changes: await changes(req.params.key, 'all', Number(req.query.days) || 365) }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/metric-defs/:key', async (req, res) => { try { const d = await get(req.params.key); if (!d) return res.status(404).json({ error: 'not found' }); res.json({ def: d, versions: await versions(req.params.key) }); } catch (e) { res.status(500).json({ error: e.message }); } });
  const lastChange = async key => (await changes(key, 'all', 3650, 1))[0] || null;
  app.post('/api/metric-defs', requireCap('editRules'), async (req, res) => { try { const d = await create(seg(req), req.body || {}, req.actor); const c = await lastChange(d.key); await audit(req, 'metric.create', d.key, { label: d.label, version: d.version, changes: c && c.changes }); res.json({ def: d }); } catch (e) { fail(res, e); } });
  app.put('/api/metric-defs/:key', requireCap('editRules'), async (req, res) => { try { const before = await get(req.params.key); const d = await update(req.params.key, req.body || {}, req.actor); const diff = diffDefs(before, d); if (Object.keys(diff).length) await audit(req, 'metric.update', d.key, { label: d.label, version: d.version, changes: diff }); res.json({ def: d }); } catch (e) { fail(res, e); } });
  app.post('/api/metric-defs/:key/status', requireCap('editRules'), async (req, res) => { try { const before = await get(req.params.key); const d = await setStatus(req.params.key, req.body?.status, req.actor, req.body || {}); await audit(req, 'metric.status', d.key, { label: d.label, from: before && before.status, to: d.status, shadow_until: d.shadow_until }); res.json({ def: d }); } catch (e) { fail(res, e); } });
  app.post('/api/metric-defs/:key/rollback', requireCap('editRules'), async (req, res) => { try { const before = await get(req.params.key); const d = await rollback(req.params.key, Number(req.body?.version), req.actor); await audit(req, 'metric.rollback', d.key, { label: d.label, to_version: req.body?.version, new_version: d.version, changes: diffDefs(before, d) }); res.json({ def: d }); } catch (e) { fail(res, e); } });
  app.post('/api/metric-defs/test', requireCap('editRules'), async (req, res) => { try { res.json(await test(seg(req), req.body?.spec, Number(req.body?.windowHours) || 1)); } catch (e) { fail(res, e); } });
  app.post('/api/metric-defs/preview', requireCap('editRules'), async (req, res) => { try { res.json(await preview(seg(req), req.body?.spec, Number(req.body?.windowHours) || 1)); } catch (e) { fail(res, e); } });
}
module.exports = { mount, load, isShadow, noteWouldFire, compile, changes, diffDefs, caseSpec, MEASURES };
