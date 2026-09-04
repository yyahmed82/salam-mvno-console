/* L2 Workbench — the L2 follow-up hub. Four capabilities, all READ-MOSTLY and all confined to the
 * console DB + outbound notifications. Nothing here EVER writes to the prod-replica (SOURCE) DB —
 * SOURCE is read-only anyway and we only .query() SELECTs against it (rule-test metric compute).
 *
 *  1) user-activity  — per-console-user activity & performance, aggregated from audit_log.
 *  2) replay         — READ-ONLY "as-of" incident replay: alerts fired + metric snapshots in a
 *                      window (does NOT drive the global sim clock — see note in api.js).
 *  3) rule-test      — evaluate any alert rule against a chosen historic window (reuses metrics.js
 *                      compute + the same operator logic as POST /api/rules/test).
 *  4) docs           — upload/parse/search .md/.txt/.pdf runbooks (feeds Yusr KB when shared=true).
 *
 * Docs storage mirrors tickets.js: base64-in-JSON upload (no multer), files written under a RANDOM
 * name to UPLOAD_DIR/docs, path-containment re-checked on every read. NO new npm deps: .md/.txt are
 * stored raw; .pdf text is extracted via the `pdftotext` binary IF it is on PATH, else the file is
 * stored with text_content=NULL and flagged "extraction pending".
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const db = require('./db');
const { METRICS } = require('./metrics');

const C = db.console;

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/apps/console/uploads';
const DOCS_DIR = path.join(UPLOAD_DIR, 'docs');
const MAX_FILE_BYTES = Math.max(1, Number(process.env.DOC_MAX_FILE_MB || 12)) * 1024 * 1024;
// claimed-mime → extension whitelist. Only these are ever accepted or written.
const MIME_EXT = { 'text/markdown': 'md', 'text/x-markdown': 'md', 'text/plain': 'txt', 'application/pdf': 'pdf' };
const EXT_MIME = { md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', text: 'text/plain', pdf: 'application/pdf' };

function ensureDir() {
  try { fs.mkdirSync(DOCS_DIR, { recursive: true }); }
  catch (e) { console.error('[WORKBENCH] could not create docs dir', DOCS_DIR, '-', e.message); }
}
ensureDir();

function safeName(s, n) { return String(s == null ? '' : s).slice(0, n || 200); }
function stripDataUrl(s) { const m = /^data:[^;,]*;base64,/.exec(s || ''); return m ? s.slice(m[0].length) : s; }

/* ---- pdftotext availability (cached). NO npm dep — we shell out only if the binary exists. ---- */
let _pdftotext = null;   // null=unknown, true/false once probed
function hasPdftotext() {
  if (_pdftotext !== null) return _pdftotext;
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore', timeout: 4000 }); _pdftotext = true; }
  catch (e) { _pdftotext = false; }
  return _pdftotext;
}
function extractPdfText(absPath) {
  if (!hasPdftotext()) return null;
  try {
    const out = execFileSync('pdftotext', ['-q', '-enc', 'UTF-8', '-nopgbrk', absPath, '-'],
      { timeout: 20000, maxBuffer: 24 * 1024 * 1024 });
    const txt = String(out || '').trim();
    return txt.length ? txt.slice(0, 500000) : null;
  } catch (e) { return null; }
}

/* Resolve the claimed mime from mime OR filename extension; reject anything not whitelisted. */
function resolveMime(f) {
  let mime = String((f && f.mime) || '').toLowerCase().split(';')[0].trim();
  if (!MIME_EXT[mime]) {
    const ext = (String((f && f.name) || '').split('.').pop() || '').toLowerCase();
    if (EXT_MIME[ext]) mime = EXT_MIME[ext];
  }
  return MIME_EXT[mime] ? mime : null;
}

/* Create a doc: validate + decode base64, write to disk, parse text, insert metadata row. */
async function createDoc(req, body) {
  const actor = (req && req.actor && req.actor !== 'anonymous') ? req.actor : null;
  if (!actor) return { error: 'not signed in', status: 401 };
  const f = body || {};
  const mime = resolveMime(f);
  if (!mime) return { error: 'unsupported file type (allowed: .md, .txt, .pdf)', status: 400 };
  let buf;
  try { buf = Buffer.from(stripDataUrl(f.dataB64 || f.data || ''), 'base64'); }
  catch (e) { return { error: 'could not decode file', status: 400 }; }
  if (!buf.length) return { error: 'empty file', status: 400 };
  if (buf.length > MAX_FILE_BYTES) return { error: `file too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)`, status: 400 };
  // sniff: a PDF must actually start with %PDF; text files must not contain NUL bytes in the head.
  if (mime === 'application/pdf') {
    if (!(buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46))
      return { error: 'file does not look like a PDF', status: 400 };
  } else {
    if (buf.slice(0, 8192).includes(0x00)) return { error: 'file does not look like text (.md/.txt)', status: 400 };
  }

  const filename = safeName(f.name || ('document.' + MIME_EXT[mime]), 200);
  const title = safeName((f.title || filename).toString().trim(), 300) || filename;
  const shared = f.shared === false ? false : true;
  ensureDir();
  const disk = crypto.randomBytes(16).toString('hex') + '.' + MIME_EXT[mime];
  const abs = path.join(DOCS_DIR, disk);
  try { fs.writeFileSync(abs, buf, { mode: 0o640 }); }
  catch (e) { return { error: 'file write failed: ' + e.message, status: 500 }; }

  let text = null, note = null;
  if (mime === 'text/markdown' || mime === 'text/plain') {
    text = buf.toString('utf8').slice(0, 500000);
  } else {                                   // pdf
    text = extractPdfText(abs);
    if (text == null) note = hasPdftotext() ? 'no extractable text (scanned PDF?)' : 'stored — text extraction pending (pdftotext not installed)';
  }

  const r = await C.query(
    `INSERT INTO console_docs (title, filename, path, mime, size, text_content, uploaded_by, shared)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, title, filename, mime, size, shared, at,
       (text_content IS NOT NULL) AS has_text`,
    [title, filename, abs, mime, buf.length, text, actor, shared]);
  return { ok: true, doc: r.rows[0], note, extracted: text != null };
}

/* List + optional keyword search. Non-admin callers see their OWN docs + all shared docs. */
async function listDocs(q, actor, isAdmin) {
  const w = [], p = [];
  if (!isAdmin) { p.push(actor); w.push(`(shared = true OR uploaded_by = $${p.length})`); }
  if (q && q.search) {
    p.push('%' + String(q.search).toLowerCase() + '%');
    w.push(`(lower(title) LIKE $${p.length} OR lower(filename) LIKE $${p.length} OR lower(coalesce(text_content,'')) LIKE $${p.length})`);
  }
  if (q && q.mine === '1') { p.push(actor); w.push(`uploaded_by = $${p.length}`); }
  const clause = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const r = await C.query(
    `SELECT id, title, filename, mime, size, uploaded_by, shared, at,
            (text_content IS NOT NULL) AS has_text,
            length(coalesce(text_content,'')) AS text_len
       FROM console_docs ${clause} ORDER BY at DESC LIMIT 300`, p);
  const counts = await C.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE shared)::int AS shared,
            count(*) FILTER (WHERE text_content IS NOT NULL)::int AS with_text
       FROM console_docs`);
  return { docs: r.rows, counts: counts.rows[0], pdftext: hasPdftotext() };
}

/* Update a doc's shared flag / title (uploader or admin). */
async function updateDoc(id, patch, actor, isAdmin) {
  const cur = await C.query(`SELECT uploaded_by FROM console_docs WHERE id = $1`, [Number(id)]);
  if (!cur.rowCount) return { error: 'not found', status: 404 };
  if (!isAdmin && cur.rows[0].uploaded_by !== actor) return { error: 'forbidden', status: 403 };
  const set = [], p = [];
  if (patch.shared != null) { p.push(!!patch.shared); set.push(`shared = $${p.length}`); }
  if (patch.title != null) { p.push(safeName(String(patch.title).trim(), 300) || null); set.push(`title = $${p.length}`); }
  if (!set.length) return { error: 'nothing to update', status: 400 };
  p.push(Number(id));
  const r = await C.query(`UPDATE console_docs SET ${set.join(', ')} WHERE id = $${p.length}
     RETURNING id, title, filename, mime, size, shared, at, (text_content IS NOT NULL) AS has_text`, p);
  return { ok: true, doc: r.rows[0] };
}

/* Delete a doc (uploader or admin) — removes the row and the on-disk file. */
async function deleteDoc(id, actor, isAdmin) {
  const cur = await C.query(`SELECT path, uploaded_by FROM console_docs WHERE id = $1`, [Number(id)]);
  if (!cur.rowCount) return { error: 'not found', status: 404 };
  if (!isAdmin && cur.rows[0].uploaded_by !== actor) return { error: 'forbidden', status: 403 };
  await C.query(`DELETE FROM console_docs WHERE id = $1`, [Number(id)]);
  try {
    const abs = path.resolve(cur.rows[0].path), base = path.resolve(DOCS_DIR);
    if (abs === base || abs.startsWith(base + path.sep)) fs.unlinkSync(abs);
  } catch (e) {}
  return { ok: true };
}

/* Stream a doc's raw file with an auth check (own doc, any shared doc, or admin). Re-verifies path
 * containment so a tampered DB row could never escape the docs dir. */
async function streamDoc(req, res, id, actor, isAdmin) {
  const did = Number(id);
  if (!Number.isInteger(did)) return res.status(400).json({ error: 'bad id' });
  const r = await C.query(`SELECT path, mime, filename, uploaded_by, shared FROM console_docs WHERE id = $1`, [did]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  const row = r.rows[0];
  if (!isAdmin && !row.shared && row.uploaded_by !== actor) return res.status(403).json({ error: 'forbidden' });
  const abs = path.resolve(row.path), base = path.resolve(DOCS_DIR);
  if (abs !== base && !abs.startsWith(base + path.sep)) return res.status(403).json({ error: 'forbidden' });
  if (!MIME_EXT[row.mime]) return res.status(415).json({ error: 'unsupported' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'file missing' });
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Disposition', 'inline; filename="' + safeName(row.filename, 120).replace(/[\r\n"]/g, '') + '"');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(abs).on('error', () => { if (!res.headersSent) res.status(500).end(); }).pipe(res);
}

/* ------------------------------ TAB 1 — user activity ------------------------------ */
async function distinctActors() {
  const r = await C.query(
    `SELECT actor, count(*)::int AS events, max(at) AS last_seen
       FROM audit_log WHERE actor IS NOT NULL AND actor <> 'anonymous'
       GROUP BY actor ORDER BY max(at) DESC LIMIT 500`);
  return r.rows;
}

// Buckets of related audit actions so the KPI cards read in plain language.
const UNMASK_ACTIONS = ['pii.unmask', 'VIEW_TRACE_UNMASKED', 'VIEW_ERROR_UNMASKED'];
const TIMELINE_ACTIONS = ['VIEW_TRACE', 'VIEW_ERROR', 'VIEW_TRACE_UNMASKED', 'VIEW_ERROR_UNMASKED'];
const SEARCH_ACTIONS = ['SEARCH', 'APPLY_FILTER'];

async function userActivity(actor, days) {
  const d = Math.max(1, Math.min(180, Number(days) || 30));
  // param $1 = days interval, optional $2 = actor filter
  const params = [d];
  let actorClause = '';
  if (actor && actor !== 'all') { params.push(actor); actorClause = ` AND actor = $${params.length}`; }
  const since = `at >= now() - make_interval(days => $1::int)`;
  const W = `WHERE ${since}${actorClause}`;

  const byAction = (await C.query(
    `SELECT action, count(*)::int AS n FROM audit_log ${W} GROUP BY action ORDER BY n DESC`, params)).rows;
  const pages = (await C.query(
    `SELECT coalesce(target,'—') AS page, count(*)::int AS n FROM audit_log
       ${W} AND action = 'VIEW_PAGE' GROUP BY target ORDER BY n DESC LIMIT 25`, params)).rows;
  const hours = (await C.query(
    `SELECT extract(hour FROM at AT TIME ZONE 'Asia/Riyadh')::int AS hr, count(*)::int AS n
       FROM audit_log ${W} GROUP BY hr ORDER BY hr`, params)).rows;
  const totals = (await C.query(
    `SELECT count(*)::int AS events,
            count(DISTINCT (at AT TIME ZONE 'Asia/Riyadh')::date)::int AS active_days,
            count(DISTINCT actor)::int AS actors,
            min(at) AS first_seen, max(at) AS last_seen,
            count(*) FILTER (WHERE action = 'VIEW_PAGE')::int AS page_views,
            count(*) FILTER (WHERE action = ANY($${params.length + 1}))::int AS timeline_opens,
            count(*) FILTER (WHERE action = ANY($${params.length + 2}))::int AS searches,
            count(*) FILTER (WHERE action = ANY($${params.length + 3}))::int AS unmasks,
            count(*) FILTER (WHERE action = 'RESTRICTED_ATTEMPT')::int AS restricted,
            count(*) FILTER (WHERE action = 'EXPORT')::int AS exports
       FROM audit_log ${W}`,
    params.concat([TIMELINE_ACTIONS, SEARCH_ACTIONS, UNMASK_ACTIONS]))).rows[0];
  // response-time signal: assist.chat carries detail->>'ms'
  const perf = (await C.query(
    `SELECT count(*)::int AS chats,
            round(avg((detail->>'ms')::numeric))::int AS avg_ms,
            max((detail->>'ms')::numeric)::int AS max_ms,
            count(*) FILTER (WHERE (detail->>'degraded')::boolean)::int AS degraded
       FROM audit_log ${W} AND action = 'assist.chat' AND detail ? 'ms'`, params)).rows[0];
  const recent = (await C.query(
    `SELECT actor, role, action, target, detail, at, ip FROM audit_log ${W}
       ORDER BY at DESC LIMIT 120`, params)).rows;

  return { actor: actor || 'all', days: d, byAction, pages, hours, totals, perf, recent };
}

/* ------------------------------ TAB 2 — read-only incident replay ------------------------------
 * NO sim-clock mutation: we only SELECT what already fired and the snapshots already computed for
 * the chosen window. The live board is never touched. */
async function replay(fromIso, toIso) {
  const from = new Date(fromIso), to = new Date(toIso);
  if (isNaN(from) || isNaN(to) || from >= to) return { error: 'invalid window', status: 400 };
  const p = [from.toISOString(), to.toISOString()];
  // incidents whose lifetime OVERLAPS the window (fired before end, and not resolved before start)
  const alerts = (await C.query(
    `SELECT id, rule_key, name, severity, team, status, metric_key, operator, threshold,
            observed_value, peak_value, sample, window_hours, message,
            fired_at, last_seen_at, resolved_at, breach_count
       FROM alerts
      WHERE fired_at < $2 AND (resolved_at IS NULL OR resolved_at >= $1)
      ORDER BY fired_at`, p)).rows;
  const bySeverity = (await C.query(
    `SELECT severity, count(*)::int AS n FROM alerts
      WHERE fired_at < $2 AND (resolved_at IS NULL OR resolved_at >= $1)
      GROUP BY severity ORDER BY severity`, p)).rows;
  // which metrics have snapshots in the window (→ chartable via /api/metrics/series)
  const metrics = (await C.query(
    `SELECT metric_key, window_hours, count(*)::int AS points,
            min(sim_now) AS first_at, max(sim_now) AS last_at
       FROM metric_snapshots WHERE sim_now >= $1 AND sim_now < $2 AND dim = '{}'::jsonb
       GROUP BY metric_key, window_hours ORDER BY metric_key`, p)).rows;
  return { from: p[0], to: p[1], alerts, bySeverity, metrics };
}

/* Past alerts to pick from (drives the window selector in the UI). */
async function pastAlerts(limit) {
  const r = await C.query(
    `SELECT id, rule_key, name, severity, team, status, fired_at, resolved_at, observed_value, message
       FROM alerts ORDER BY fired_at DESC LIMIT $1`, [Math.max(1, Math.min(300, Number(limit) || 100))]);
  return { alerts: r.rows };
}

/* ------------------------------ TAB 3 — rule test / what-if ------------------------------
 * Evaluate a rule against an arbitrary historic window [from,to]. Reuses metrics.js compute against
 * the SOURCE (read-only) DB with window_hours = span, sim_now = to — same math as POST /api/rules/test
 * but window-driven. NO writes anywhere. */
const OPS = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b, eq: (a, b) => a === b };
const OP_LABEL = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };

async function ruleTest({ key, from, to }) {
  const rule = (await C.query(`SELECT * FROM alert_rules WHERE key = $1`, [key])).rows[0];
  if (!rule) return { error: 'unknown rule key', status: 400 };
  const m = METRICS[rule.metric_key];
  if (!m) return { error: 'metric not computable: ' + rule.metric_key, status: 400 };
  const toD = to ? new Date(to) : new Date();
  let windowHours = Number(rule.window_hours) || 1;
  if (from) {
    const span = (toD.getTime() - new Date(from).getTime()) / 3600e3;
    if (span > 0) windowHours = Math.round(span * 100) / 100;
  }
  const rows = await m.compute(db.source, toD.toISOString(), windowHours);
  const rd = rule.dim || {};
  const snap = rows.find(r => Object.keys(rd).every(k => String((r.dim || {})[k]) === String(rd[k])))
    || rows.find(r => !Object.keys(r.dim || {}).length) || rows[0];
  const value = snap ? snap.value : null;
  const sample = snap ? Number(snap.sample || 0) : 0;
  const enoughSample = value != null && sample >= (rule.min_sample || 0);
  const wouldFire = !!(value != null && enoughSample && OPS[rule.operator](Number(value), Number(rule.threshold)));
  return {
    key: rule.key, name: rule.name, severity: rule.severity, metric_key: rule.metric_key,
    unit: m.unit, operator: rule.operator, op_label: OP_LABEL[rule.operator], threshold: Number(rule.threshold),
    min_sample: rule.min_sample, window_hours: windowHours, to: toD.toISOString(), from: from || null,
    value, sample, enoughSample, would_fire: wouldFire
  };
}

/* Fire a TEST alert row (clearly marked, auto-resolved) so notification routing can be verified
 * end-to-end. Writes ONLY to the console alerts table; tags context.test=true. Returns the row +
 * the chatops fan-out result (the caller passes a notifier). NEVER touches SOURCE. */
async function fireTestAlert(actor, notifier) {
  const now = new Date().toISOString();
  const ins = await C.query(
    `INSERT INTO alerts (rule_key, name, severity, team, status, metric_key, operator, threshold,
        observed_value, sample, window_hours, dim, context, message, fired_at, last_seen_at, resolved_at,
        peak_value, breach_count)
     VALUES ('workbench_test','L2 Workbench — TEST alert (routing check)','P3','Digital Ops','resolved',
        'payment_success_rate','lt',0.95,0.9,100,1,'{}'::jsonb,$1::jsonb,
        'TEST alert raised from the L2 Workbench to verify notification routing. Auto-resolved.',
        $2,$2,$2,0.9,1)
     RETURNING id, rule_key, name, severity, status, fired_at`,
    [JSON.stringify({ test: true, raised_by: actor || null }), now]);
  const row = ins.rows[0];
  let notify = null;
  if (typeof notifier === 'function') {
    try {
      notify = await notifier({
        id: row.id, name: row.name, severity: row.severity, team: 'Digital Ops',
        metric_key: 'payment_success_rate', operator: 'lt', threshold: 0.95, observed_value: 0.9,
        sample: 100, window_hours: 1, unit: 'rate',
        message: 'TEST alert from the L2 Workbench — routing check. Auto-resolved.', context: { test: true }
      });
    } catch (e) { notify = { error: e.message }; }
  }
  return { ok: true, alert: row, notify };
}

/* ------------------------------ TAB 3 — synthetic checks ------------------------------
 * Reuses the existing read-only probes: apigwProbe (TCP reachability), assist.ping (Ollama), and the
 * prod_sync_state table. No writes. */
async function synthetic() {
  const out = { at: new Date().toISOString() };
  await Promise.all([
    (async () => { try { out.apigw = await require('./apigwProbe').status(); } catch (e) { out.apigw = { error: e.message }; } })(),
    (async () => { try { out.assist = await require('./assist').ping(); } catch (e) { out.assist = { error: e.message }; } })(),
    (async () => {
      try {
        const st = (await C.query(`SELECT table_name, last_status, last_run_at, rows_synced, watermark FROM prod_sync_state ORDER BY table_name`)).rows;
        out.prodSync = { configured: !!process.env.PROD_DATABASE_URL, running: require('./prodSync').isRunning(), state: st };
      } catch (e) { out.prodSync = { error: e.message }; }
    })()
  ]);
  return out;
}

module.exports = {
  ensureDir, DOCS_DIR, UPLOAD_DIR, hasPdftotext,
  createDoc, listDocs, updateDoc, deleteDoc, streamDoc,
  distinctActors, userActivity,
  replay, pastAlerts,
  ruleTest, fireTestAlert, synthetic
};
