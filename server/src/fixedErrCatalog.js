/* fixedErrCatalog.js — the configurable ERROR CATALOGUE (15 Sep 2026).
 *
 * "I need a configurable list with all errors, even new ones as they are logged, so I can set the classification
 * (Technical / Business)." Every distinct error MESSAGE seen on the Fixed side is registered here automatically:
 *   src 'board' = error_events on the sda_ops read models (the Troubleshoot board)   signature = fixedErrors.MSG_EXPR
 *   src 'app'   = fixed_app_events (the app's combined.log)                            signature = same masking on reason
 * A signature = the message with digit runs masked (#), 160 chars. Each row keeps a sample, the category / step it was
 * seen with, first/last seen, a running total, the AUTO class (what the rules say) and an OVERRIDE (what an operator
 * decided). The effective class = override ?? auto, and it is what the board chips, rows, exports, the lane, the
 * impact check, the exec KPI and the alerts use:
 *   · board side: the SQL CASE is wrapped with the override lists (sda_ops is read-only, so the lists are inlined)
 *   · app side: the collector classifies new lines through classifyApp(); saving an override re-labels the stored
 *     rows of that signature (last 30 days) so history agrees too.
 * Sync: every 5 min the last window of both sources is folded in (first run: 14 days). Never throws into a request. */
'use strict';
const db = require('./db');

const SIG_OF = col => `left(regexp_replace(coalesce(nullif(btrim(${col}),''),'(no message)'),'[0-9]+','#','g'),160)`;
const SIG_APP = SIG_OF(`coalesce(nullif(btrim(reason),''), message)`);
const sigOfText = s => String(s == null || String(s).trim() === '' ? '(no message)' : s).trim().replace(/[0-9]+/g, '#').slice(0, 160);

let _tableOk = false;
async function ensureTable() {
  if (_tableOk) return;
  await db.console.query(`CREATE TABLE IF NOT EXISTS fixed_error_catalog (
    sig text NOT NULL, src text NOT NULL, sample text, category text, step text,
    first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(), total bigint NOT NULL DEFAULT 0,
    auto_class text, class_override text, note text, updated_by text, updated_at timestamptz,
    PRIMARY KEY (sig, src));
    CREATE INDEX IF NOT EXISTS idx_fixed_error_catalog_last ON fixed_error_catalog (last_seen DESC);`);
  _tableOk = true;
}

/* ---- override cache (60 s) — what the SQL wrappers and the collector consult ---- */
let _ov = { board: { technical: [], business: [] }, app: { technical: [], business: [] }, at: 0 };
async function refresh(force) {
  if (!force && Date.now() - _ov.at < 60000) return _ov;
  try {
    await ensureTable();
    const r = await db.console.query(`SELECT sig, src, class_override FROM fixed_error_catalog WHERE class_override IN ('technical','business')`);
    const next = { board: { technical: [], business: [] }, app: { technical: [], business: [] }, at: Date.now() };
    for (const x of r.rows) { const b = next[x.src === 'app' ? 'app' : 'board']; b[x.class_override].push(x.sig); }
    _ov = next;
  } catch (e) { _ov.at = Date.now(); }
  return _ov;
}
const lit = s => `'` + String(s).replace(/'/g, `''`) + `'`;
/* wrap an auto CASE with the board overrides: CASE WHEN sig IN (technical…) THEN 'technical' WHEN sig IN (business…) THEN 'business' ELSE <auto> END */
function wrapBoard(sigExpr, autoCase) {
  const o = _ov.board; if (!o.technical.length && !o.business.length) return autoCase;
  const parts = [];
  if (o.technical.length) parts.push(`WHEN ${sigExpr} IN (${o.technical.map(lit).join(',')}) THEN 'technical'`);
  if (o.business.length) parts.push(`WHEN ${sigExpr} IN (${o.business.map(lit).join(',')}) THEN 'business'`);
  return `CASE ${parts.join(' ')} ELSE (${autoCase}) END`;
}
/* the collector asks for every failing line: an operator decision beats the regex */
function classifyApp(reasonOrMessage) {
  const sig = sigOfText(reasonOrMessage);
  if (_ov.app.technical.includes(sig)) return 'technical';
  if (_ov.app.business.includes(sig)) return 'business';
  return null;
}

/* ---- sync: register every signature seen, keep counts and last seen ---- */
async function sync() {
  await ensureTable();
  const now = new Date();
  let st = {}; try { const r = await db.console.query(`SELECT value FROM console_settings WHERE key='fixed_errcat_sync'`); st = (r.rowCount && r.rows[0].value) || {}; } catch (_) {}
  const since = st.at ? new Date(st.at) : new Date(now.getTime() - 14 * 864e5);
  const fe = require('./fixedErrors');
  const up = async (rows, src, autoOf) => {
    for (const r of rows) {
      const auto = autoOf(r);
      await db.console.query(`INSERT INTO fixed_error_catalog (sig, src, sample, category, step, first_seen, last_seen, total, auto_class)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (sig, src) DO UPDATE SET sample = COALESCE(fixed_error_catalog.sample, EXCLUDED.sample), category = COALESCE(EXCLUDED.category, fixed_error_catalog.category),
            step = COALESCE(EXCLUDED.step, fixed_error_catalog.step), first_seen = LEAST(fixed_error_catalog.first_seen, EXCLUDED.first_seen),
            last_seen = GREATEST(fixed_error_catalog.last_seen, EXCLUDED.last_seen), total = fixed_error_catalog.total + EXCLUDED.total, auto_class = EXCLUDED.auto_class`,
        [r.sig, src, r.sample ? String(r.sample).slice(0, 300) : null, r.category || null, r.step || null, r.first, r.last, Number(r.n) || 0, auto]);
    }
  };
  let boardN = 0, appN = 0;
  /* the board read models have a statement timeout and no index that helps a regex over res_body: walk the window in
   * slices (≤ 1 day each; the routine 5-minute run is one slice) and use max() aggregates, never ordered array_agg */
  const SLICE = 864e5;
  for (const pool of [db.ops, db.opsBeta].filter(Boolean)) {
    for (let t = since.getTime(); t < now.getTime(); t += SLICE) {
      const a = new Date(t).toISOString(), b = new Date(Math.min(t + SLICE, now.getTime())).toISOString();
      try {
        const rows = (await pool.query(`SELECT ${fe.MSG_EXPR} AS sig, max(left(${fe.RESP_EXPR},300)) AS sample, max(e.category) AS category, max(e.step) AS step,
              count(*)::int AS n, min(e.occurred_at) AS first, max(e.occurred_at) AS last, max(${fe.CLASS_EXPR}) AS auto
            FROM error_events e WHERE e.occurred_at > $1 AND e.occurred_at <= $2 GROUP BY 1 ORDER BY 5 DESC LIMIT 400`, [a, b])).rows;
        await up(rows, 'board', r => r.auto); boardN += rows.length;
      } catch (e) { console.error(`[ERRCAT] board sync ${a.slice(0, 10)}: ${e.message}`); }
    }
  }
  try {
    const rows = (await db.console.query(`SELECT ${SIG_APP} AS sig, (array_agg(coalesce(reason,message) ORDER BY ts DESC))[1] AS sample, (array_agg(kind ORDER BY ts DESC))[1] AS category,
          (array_agg(coalesce(channel,'?') || ' · ' || coalesce(path,kind) ORDER BY ts DESC))[1] AS step, count(*)::int AS n, min(ts) AS first, max(ts) AS last,
          mode() WITHIN GROUP (ORDER BY reason_class) AS auto
        FROM fixed_app_events WHERE ok IS NOT TRUE AND ts > $1 AND ts <= $2 GROUP BY 1 ORDER BY 5 DESC LIMIT 400`, [since.toISOString(), now.toISOString()])).rows;
    await up(rows, 'app', r => r.auto || null); appN += rows.length;
  } catch (e) { if (!/does not exist/.test(e.message)) console.error('[ERRCAT] app sync: ' + e.message); }
  await db.console.query(`INSERT INTO console_settings (key, value) VALUES ('fixed_errcat_sync', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ at: now.toISOString() })]).catch(() => {});
  await refresh(true);
  return { board: boardN, app: appN, since: since.toISOString() };
}

/* ---- list + classify ---- */
async function list(q = {}) {
  await ensureTable(); await refresh();
  const P = []; const w = [];
  if (q.src === 'board' || q.src === 'app') { P.push(q.src); w.push(`src = $${P.length}`); }
  if (q.cls === 'technical' || q.cls === 'business') { P.push(q.cls); w.push(`COALESCE(class_override, auto_class) = $${P.length}`); }
  if (q.only === 'overridden') w.push(`class_override IS NOT NULL`);
  if (q.only === 'new') w.push(`first_seen >= now() - interval '7 days'`);
  if (q.only === 'unreviewed') w.push(`class_override IS NULL`);
  if (q.q) { P.push('%' + String(q.q).slice(0, 120) + '%'); w.push(`(sig ILIKE $${P.length} OR sample ILIKE $${P.length} OR coalesce(category,'') ILIKE $${P.length} OR coalesce(step,'') ILIKE $${P.length})`); }
  const rows = (await db.console.query(`SELECT sig, src, sample, category, step, first_seen, last_seen, total, auto_class, class_override, note, updated_by, updated_at,
        COALESCE(class_override, auto_class) AS effective, (first_seen >= now() - interval '7 days') AS is_new
      FROM fixed_error_catalog ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY last_seen DESC LIMIT 600`, P)).rows;
  const tot = (await db.console.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE class_override IS NOT NULL)::int AS overridden, count(*) FILTER (WHERE first_seen >= now() - interval '7 days')::int AS new7,
        count(*) FILTER (WHERE COALESCE(class_override, auto_class)='technical')::int AS technical, count(*) FILTER (WHERE COALESCE(class_override, auto_class)='business')::int AS business FROM fixed_error_catalog`)).rows[0];
  return { rows, totals: tot, syncedAt: _ov.at ? new Date(_ov.at).toISOString() : null };
}
async function classify({ sig, src, cls, note, actor }) {
  await ensureTable();
  const s = String(sig || '').slice(0, 160); const sc = src === 'app' ? 'app' : 'board';
  const c = cls === 'technical' || cls === 'business' ? cls : null;
  if (!s) throw Object.assign(new Error('signature required'), { status: 400 });
  const r = await db.console.query(`UPDATE fixed_error_catalog SET class_override = $3, note = $4, updated_by = $5, updated_at = now() WHERE sig = $1 AND src = $2 RETURNING sig, src, auto_class, class_override`, [s, sc, c, note ? String(note).slice(0, 300) : null, actor || null]);
  if (!r.rowCount) throw Object.assign(new Error('signature not in the catalogue yet — it registers on the next sync (5 min)'), { status: 404 });
  await refresh(true);
  let relabelled = 0;
  if (sc === 'app') {   // history agrees with the decision; clearing an override falls back to the auto class stored on the row
    const target = c || r.rows[0].auto_class;
    if (target) { const u = await db.console.query(`UPDATE fixed_app_events SET reason_class = $2 WHERE ok IS NOT TRUE AND ts >= now() - interval '30 days' AND ${SIG_APP} = $1 AND reason_class IS DISTINCT FROM $2`, [s, target]); relabelled = u.rowCount; }
  }
  return { ...r.rows[0], relabelled };
}

let _timer = null;
function start() {
  _timer = setInterval(() => { sync().catch(e => console.error('[ERRCAT] sync failed: ' + e.message)); }, 5 * 60000); _timer.unref?.();
  setTimeout(() => { sync().then(r => console.log(`[ERRCAT] catalogue synced — board ${r.board} · app ${r.app} signatures since ${r.since.slice(0, 16)}`)).catch(e => console.error('[ERRCAT] first sync failed: ' + e.message)); }, 45000);
  refresh(true).catch(() => {});
  return { armed: true };
}
function mount(app, { requireView, audit } = {}) {
  const gate = requireView ? requireView('fixed') : (req, res, next) => next();
  app.get('/api/fixed/errors/catalog', gate, async (req, res) => { try { res.json(await list(req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/fixed/errors/catalog/sync', gate, async (req, res) => { try { res.json(await sync()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/fixed/errors/catalog/classify', gate, async (req, res) => {
    try {
      const actor = (req.user && req.user.email) || req.get('X-Console-User') || null;
      const out = await classify({ ...(req.body || {}), actor });
      if (audit) { try { audit(req, 'fixed.errors.classify', String(req.body && req.body.sig || '').slice(0, 80), { src: req.body && req.body.src, cls: req.body && req.body.cls }); } catch (_) {} }
      res.json(out);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}
module.exports = { mount, start, sync, list, classify, refresh, wrapBoard, classifyApp, sigOfText, SIG_APP };
