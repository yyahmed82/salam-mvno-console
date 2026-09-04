/* Internal console tickets / feedback.
 * Any authed console user raises a suggestion (enhancement) or a problem (issue) with optional
 * screenshot(s) + a description. On create we email the raising user "ticket raised — under
 * evaluation" via the SAME transport the console already uses for OTP/alert mail (notify.sendHtml
 * → nodemailer with the SMTP_* env). The board (manageUsers cap) drives status.
 *
 * Screenshots are stored ON DISK under UPLOAD_DIR/tickets (default /apps/console/uploads/tickets) —
 * NOT in the DB. No multer/multipart: the client base64-encodes each image and POSTs JSON. The
 * server validates mime + size + count, writes each file under a RANDOM name (client filename is
 * kept for display only, never used as a path), and every read re-checks path containment.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const notify = require('./notify');

const C = db.console;

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/apps/console/uploads';
const TICKETS_DIR = path.join(UPLOAD_DIR, 'tickets');
const MAX_FILE_BYTES = Math.max(1, Number(process.env.TICKET_MAX_FILE_MB || 5)) * 1024 * 1024;
const MAX_FILES = Math.max(0, Number(process.env.TICKET_MAX_FILES || 4));
const KINDS = new Set(['enhancement', 'issue']);
const STATUSES = new Set(['open', 'under_evaluation', 'in_progress', 'closed', 'rejected']);
const CLOSED_STATUSES = new Set(['closed', 'rejected']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
// image mime whitelist → file extension. Only these are ever accepted or written.
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function ensureDir() {
  try { fs.mkdirSync(TICKETS_DIR, { recursive: true }); }
  catch (e) { console.error('[TICKETS] could not create upload dir', TICKETS_DIR, '-', e.message); }
}
ensureDir();   // create on module load (boot); tolerate failure and retry per-write

// Sniff the first bytes so a caller can't pass e.g. an executable with mime:image/png. Belt-and-braces
// on top of the mime whitelist — the extension we write is driven by the CLAIMED mime, and this makes
// sure the bytes actually look like that image family.
function sniff(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && buf.toString('ascii', 0, 6).match(/^GIF8[79]a$/)) return 'image/gif';
  return null;
}

// strip a data-URL prefix if the client sent one (data:image/png;base64,....)
function stripDataUrl(s) {
  const m = /^data:[^;,]*;base64,/.exec(s || '');
  return m ? s.slice(m[0].length) : s;
}

function ref(id) { return 'TKT-' + String(id).padStart(6, '0'); }
function safeName(s, n) { return String(s == null ? '' : s).slice(0, n || 200); }

/* Validate + decode the client's files array into disk-ready buffers. Returns {files} or {error}. */
function prepareFiles(input) {
  const arr = Array.isArray(input) ? input : [];
  if (arr.length > MAX_FILES) return { error: `too many files (max ${MAX_FILES})` };
  const out = [];
  for (const f of arr) {
    const mime = String((f && f.mime) || '').toLowerCase();
    if (!MIME_EXT[mime]) return { error: `unsupported file type: ${mime || 'unknown'} (allowed: PNG, JPG, WEBP, GIF)` };
    let buf;
    try { buf = Buffer.from(stripDataUrl(f.dataB64 || f.data || ''), 'base64'); }
    catch (e) { return { error: 'could not decode file' }; }
    if (!buf.length) return { error: 'empty file' };
    if (buf.length > MAX_FILE_BYTES) return { error: `file too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)` };
    const kind = sniff(buf);
    if (!kind) return { error: 'file does not look like a supported image' };
    out.push({ filename: safeName(f.name || ('screenshot.' + MIME_EXT[mime])), mime, size: buf.length, buf });
  }
  return { files: out };
}

/* Create a ticket (any authed user). req is used for the audit actor / SMTP; body = {kind,title,description,files}. */
async function create(req, body) {
  const actor = (req && req.actor && req.actor !== 'anonymous') ? req.actor : null;
  if (!actor) return { error: 'not signed in', status: 401 };
  const kind = KINDS.has(String(body.kind)) ? String(body.kind) : 'issue';
  const title = String(body.title || '').trim();
  if (!title) return { error: 'title is required', status: 400 };
  const description = String(body.description || '').trim() || null;
  const prepared = prepareFiles(body.files);
  if (prepared.error) return { error: prepared.error, status: 400 };

  // Insert the ticket, then derive the human ref from its id. This MUST be two statements: a single
  // data-modifying CTE (INSERT … then UPDATE … WHERE t.id = ins.id) fails because the UPDATE uses the
  // statement-start snapshot and can't see the row the CTE just inserted → 0 rows → undefined.id crash.
  const ins = await C.query(
    `INSERT INTO console_tickets (kind, title, description, created_by, ref)
       VALUES ($1, $2, $3, $4, 'TKT-TMP-' || floor(random() * 1e9)::bigint)
     RETURNING id, created_at`,
    [kind, safeName(title, 300), description, actor]);
  const t = ins.rows[0];
  const upd = await C.query(
    `UPDATE console_tickets SET ref = 'TKT-' || lpad(id::text, 6, '0') WHERE id = $1 RETURNING ref`,
    [t.id]);
  t.ref = upd.rows[0].ref;

  // write each screenshot to disk under a random name, then record its metadata row
  ensureDir();
  const saved = [];
  for (const f of prepared.files) {
    const disk = crypto.randomBytes(16).toString('hex') + '.' + MIME_EXT[f.mime];
    const abs = path.join(TICKETS_DIR, disk);
    try {
      fs.writeFileSync(abs, f.buf, { mode: 0o640 });
      const r = await C.query(
        `INSERT INTO console_ticket_files (ticket_id, filename, path, mime, size) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [t.id, f.filename, abs, f.mime, f.size]);
      saved.push({ id: r.rows[0].id, filename: f.filename, mime: f.mime, size: f.size });
    } catch (e) { console.error('[TICKETS] file write failed:', e.message); }
  }

  // confirmation email to the raising user — reuses the console's existing SMTP transport.
  // Degrade gracefully: the ticket is already saved; emailed=false if SMTP is unset/failing.
  let emailed = false, emailError = null;
  try {
    const r = await sendConfirmation(actor, { ref: t.ref, title, kind, at: t.created_at });
    emailed = !!r.sent; if (r.error) emailError = r.error;
  } catch (e) { emailError = e.message; }

  return { ok: true, id: t.id, ref: t.ref, kind, title, status: 'open',
           created_at: t.created_at, files: saved, fileCount: saved.length, emailed, emailError };
}

function ksa(iso) {
  try {
    return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
  } catch (e) { return String(iso); }
}
const KIND_LABEL = { enhancement: 'Suggestion / enhancement', issue: 'Issue' };

async function sendConfirmation(email, t) {
  const e = notify.esc;
  const body = `<p style="font-size:14px;color:#0f172a;margin:0 0 12px">Thanks — your console ticket has been raised and is now <b>under evaluation</b>.</p>
    <table style="border-collapse:collapse;font-size:13px;color:#334155;margin:8px 0 14px">
      <tr><td style="padding:4px 14px 4px 0;color:#64748b">Reference</td><td style="padding:4px 0;font-weight:800;color:#0f5132">${e(t.ref)}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b">Type</td><td style="padding:4px 0">${e(KIND_LABEL[t.kind] || t.kind)}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b">Title</td><td style="padding:4px 0">${e(t.title)}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b">Raised</td><td style="padding:4px 0">${e(ksa(t.at))} KSA</td></tr>
    </table>
    <p style="font-size:13px;color:#475569;margin:0 0 6px">You'll be notified as it progresses. Keep the reference above for any follow-up.</p>
    <div style="color:#94a3b8;font-size:12px;margin-top:14px">— Salam Operations Console · internal feedback</div>`;
  const html = notify.shell({ title: `Console ticket ${t.ref}`, pill: 'UNDER EVALUATION', pillColor: '#0f5132', bodyHtml: body });
  return notify.sendHtml([email], `Console ticket ${t.ref} raised — under evaluation`, html);
}

// notify the creator when an admin changes the status (best-effort, same transport)
async function sendStatusUpdate(email, t) {
  if (!email) return { sent: false };
  const e = notify.esc;
  const label = STATUS_LABEL[t.status] || t.status;
  const body = `<p style="font-size:14px;color:#0f172a;margin:0 0 12px">Your console ticket <b>${e(t.ref)}</b> is now <b>${e(label)}</b>.</p>
    <table style="border-collapse:collapse;font-size:13px;color:#334155;margin:8px 0 14px">
      <tr><td style="padding:4px 14px 4px 0;color:#64748b">Title</td><td style="padding:4px 0">${e(t.title)}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b">Status</td><td style="padding:4px 0;font-weight:700">${e(label)}</td></tr>
      ${t.resolution ? `<tr><td style="padding:4px 14px 4px 0;color:#64748b">Note</td><td style="padding:4px 0">${e(t.resolution)}</td></tr>` : ''}
    </table>
    <div style="color:#94a3b8;font-size:12px;margin-top:14px">— Salam Operations Console · internal feedback</div>`;
  const html = notify.shell({ title: `Console ticket ${t.ref} — ${label}`, pill: String(label).toUpperCase(),
    pillColor: CLOSED_STATUSES.has(t.status) ? (t.status === 'rejected' ? '#b91c1c' : '#16a34a') : '#0f5132', bodyHtml: body });
  return notify.sendHtml([email], `Console ticket ${t.ref} — ${label}`, html);
}
const STATUS_LABEL = { open: 'Open', under_evaluation: 'Under evaluation', in_progress: 'In progress', closed: 'Closed', rejected: 'Rejected' };

const TICKET_COLS = `id, ref, kind, title, description, status, priority, created_by, evaluator, resolution,
  created_at, updated_at, closed_at`;

async function listMine(actor) {
  if (!actor || actor === 'anonymous') return { tickets: [] };
  const r = await C.query(
    `SELECT ${TICKET_COLS},
       (SELECT count(*)::int FROM console_ticket_files f WHERE f.ticket_id = t.id) AS file_count
       FROM console_tickets t WHERE created_by = $1 ORDER BY created_at DESC LIMIT 200`, [actor]);
  return { tickets: r.rows };
}

async function listBoard(q) {
  const w = [], p = [];
  if (q.status && STATUSES.has(String(q.status))) { p.push(q.status); w.push(`status = $${p.length}`); }
  if (q.kind && KINDS.has(String(q.kind))) { p.push(q.kind); w.push(`kind = $${p.length}`); }
  if (q.search) { p.push('%' + String(q.search).toLowerCase() + '%'); w.push(`(lower(title) LIKE $${p.length} OR lower(ref) LIKE $${p.length} OR lower(coalesce(created_by,'')) LIKE $${p.length})`); }
  const clause = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const r = await C.query(
    `SELECT ${TICKET_COLS},
       (SELECT count(*)::int FROM console_ticket_files f WHERE f.ticket_id = t.id) AS file_count
       FROM console_tickets t ${clause} ORDER BY created_at DESC LIMIT 500`, p);
  const counts = await C.query(`SELECT status, count(*)::int n FROM console_tickets GROUP BY status`);
  const byStatus = {}; for (const row of counts.rows) byStatus[row.status] = row.n;
  return { tickets: r.rows, counts: byStatus };
}

/* Full detail incl. files + comments. Non-admins may only read their OWN ticket. */
async function getByRef(ref, actor, isAdmin) {
  const r = await C.query(`SELECT ${TICKET_COLS} FROM console_tickets WHERE ref = $1`, [ref]);
  if (!r.rowCount) return null;
  const t = r.rows[0];
  if (!isAdmin && t.created_by !== actor) return null;   // not your ticket → treat as not found
  const files = await C.query(
    `SELECT id, filename, mime, size, at FROM console_ticket_files WHERE ticket_id = $1 ORDER BY at`, [t.id]);
  const comments = await C.query(
    `SELECT id, author, body, at FROM console_ticket_comments WHERE ticket_id = $1 ORDER BY at`, [t.id]);
  return { ...t, files: files.rows, comments: comments.rows };
}

/* Admin update: status / priority / resolution / evaluator. Sets closed_at when moving to a closed
 * state, clears it otherwise. Optionally emails the creator on a status change. */
async function update(req, ref, body) {
  const cur = await C.query(`SELECT id, status, created_by FROM console_tickets WHERE ref = $1`, [ref]);
  if (!cur.rowCount) return { error: 'not found', status: 404 };
  const row = cur.rows[0];
  const set = [], p = [], changes = {};
  if (body.status != null) {
    if (!STATUSES.has(String(body.status))) return { error: 'invalid status', status: 400 };
    p.push(body.status); set.push(`status = $${p.length}`); changes.status = body.status;
  }
  if (body.priority != null) {
    if (!PRIORITIES.has(String(body.priority))) return { error: 'invalid priority', status: 400 };
    p.push(body.priority); set.push(`priority = $${p.length}`); changes.priority = body.priority;
  }
  if (body.resolution != null) { p.push(String(body.resolution).slice(0, 4000) || null); set.push(`resolution = $${p.length}`); changes.resolution = true; }
  if (body.evaluator != null) { p.push(String(body.evaluator).slice(0, 200) || null); set.push(`evaluator = $${p.length}`); }
  if (!set.length) return { error: 'nothing to update', status: 400 };
  // stamp the acting admin as evaluator when they didn't pass one explicitly
  if (body.evaluator == null && req && req.actor && req.actor !== 'anonymous') { p.push(req.actor); set.push(`evaluator = $${p.length}`); }
  set.push(`updated_at = now()`);
  if (changes.status) {
    set.push(CLOSED_STATUSES.has(changes.status)
      ? `closed_at = COALESCE(closed_at, now())`
      : `closed_at = NULL`);
  }
  p.push(row.id);
  const r = await C.query(`UPDATE console_tickets SET ${set.join(', ')} WHERE id = $${p.length} RETURNING ${TICKET_COLS}`, p);
  const updated = r.rows[0];

  let emailed = false, emailError = null;
  if (changes.status && changes.status !== row.status && updated.created_by) {
    try { const m = await sendStatusUpdate(updated.created_by, updated); emailed = !!m.sent; if (m.error) emailError = m.error; }
    catch (e) { emailError = e.message; }
  }
  return { ok: true, ticket: updated, changes, emailed, emailError };
}

async function addComment(ref, author, bodyText, isAdmin) {
  const body = String(bodyText || '').trim();
  if (!body) return { error: 'empty comment', status: 400 };
  const r = await C.query(`SELECT id, created_by FROM console_tickets WHERE ref = $1`, [ref]);
  if (!r.rowCount) return { error: 'not found', status: 404 };
  if (!isAdmin && r.rows[0].created_by !== author) return { error: 'forbidden', status: 403 };
  const ins = await C.query(
    `INSERT INTO console_ticket_comments (ticket_id, author, body) VALUES ($1,$2,$3) RETURNING id, author, body, at`,
    [r.rows[0].id, author, body.slice(0, 4000)]);
  return { ok: true, comment: ins.rows[0] };
}

/* Stream a screenshot with an auth check (own ticket or admin). Re-verifies path containment so a
 * tampered DB row could never escape the uploads dir; content-type comes from the stored mime. */
async function streamFile(req, res, ticketId, fileId, actor, isAdmin) {
  const id = Number(ticketId), fid = Number(fileId);
  if (!Number.isInteger(id) || !Number.isInteger(fid)) return res.status(400).json({ error: 'bad id' });
  const r = await C.query(
    `SELECT f.path, f.mime, f.filename, t.created_by
       FROM console_ticket_files f JOIN console_tickets t ON t.id = f.ticket_id
      WHERE f.id = $1 AND f.ticket_id = $2`, [fid, id]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  const row = r.rows[0];
  if (!isAdmin && row.created_by !== actor) return res.status(403).json({ error: 'forbidden' });
  const abs = path.resolve(row.path);
  const base = path.resolve(TICKETS_DIR);
  if (abs !== base && !abs.startsWith(base + path.sep)) return res.status(403).json({ error: 'forbidden' });
  if (!MIME_EXT[row.mime]) return res.status(415).json({ error: 'unsupported' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'file missing' });
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Disposition', 'inline; filename="' + safeName(row.filename, 120).replace(/[\r\n"]/g, '') + '"');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(abs).on('error', () => { if (!res.headersSent) res.status(500).end(); }).pipe(res);
}

module.exports = { ensureDir, create, listMine, listBoard, getByRef, update, addComment, streamFile,
  UPLOAD_DIR, TICKETS_DIR, MAX_FILE_BYTES, MAX_FILES, STATUSES, KINDS };
