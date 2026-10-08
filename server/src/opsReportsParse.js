/* opsReportsParse.js — reads the weekly reports teams already send (pptx · xlsx · docx · eml · pdf · csv · txt) and
 * proposes what the normalized team report should contain. No dependency: Office files are ZIP containers, read here
 * with zlib; PDF goes through `pdftotext` when the box has it (poppler-utils), otherwise the file is kept as-is.
 *
 *   extract(buf, name, mime) → { kind, pages:[{ n, title, texts:[], tables:[{ headers:[], rows:[[]] }] }], meta, note }
 *   suggest(extract, team)   → { ids:{ SALM:[], INC:[], … }, actions:[], risks:[], kpis:[], highlights:[], lowlights:[], nextWeek:[], period }
 *
 * Nothing here is trusted: sizes are capped, XML is never evaluated, only text is kept. Built from the 8 Oct 2026 set of
 * real reports (TCS executive + Digital MVNO slides, Subex MS review, Whale Cloud DB & FS, Oracle CSS WSR and SR export,
 * Technology Platforms deck, portal health check) — see claude/OPS-REPORTS-ITSM.md. */
'use strict';
const zlib = require('zlib');
const { execFile } = require('child_process');

const MAX_ENTRY = 40 * 1024 * 1024;     // one decompressed ZIP member
const MAX_PAGES = 200, MAX_ROWS = 2000, MAX_TEXTS = 400;

/* ---------------- ZIP (central directory → stored / deflated members) ---------------- */
function unzip(buf) {
  const out = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a ZIP / Office file');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  let p = cdOff;
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (usize > MAX_ENTRY || name.endsWith('/')) continue;
    if (buf.readUInt32LE(loff) !== 0x04034b50) continue;
    const dstart = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28);
    const raw = buf.slice(dstart, dstart + csize);
    try { out.set(name, method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }) : null); } catch (_) { /* skip a bad member */ }
  }
  return out;
}

/* ---------------- XML helpers (text only) ---------------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const dec = s => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m));
const clean = s => dec(s).replace(/\s+/g, ' ').trim();
const each = (xml, tag, fn) => { const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'); let m; while ((m = re.exec(xml))) fn(m[1], m[0]); };
const texts = (xml, tag) => { const a = []; each(xml, tag, t => a.push(dec(t))); return a; };

/* a:p → paragraph text (a:t runs, a:br as space) */
function paras(xml, pTag, tTag) {
  const out = [];
  each(xml, pTag, p => { const t = texts(p.replace(/<a:br\s*\/>|<w:br\s*\/>|<w:tab\s*\/>/g, '<' + tTag + '> </' + tTag + '>'), tTag).join('').replace(/\s+/g, ' ').trim(); if (t) out.push(t); });
  return out;
}

/* ---------------- PPTX ---------------- */
function pptx(z) {
  const slides = [...z.keys()].filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
  const pages = [];
  for (const k of slides.slice(0, MAX_PAGES)) {
    const xml = z.get(k).toString('utf8');
    const tables = [];
    each(xml, 'a:tbl', tbl => {
      const rows = [];
      each(tbl, 'a:tr', tr => { const cells = []; each(tr, 'a:tc', tc => cells.push(paras(tc, 'a:p', 'a:t').join(' / '))); if (cells.some(Boolean)) rows.push(cells); });
      if (rows.length) tables.push({ headers: rows[0], rows: rows.slice(1, MAX_ROWS) });
    });
    const noTbl = xml.replace(/<a:tbl[\s\S]*?<\/a:tbl>/g, '');
    let title = '';
    const tm = noTbl.match(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:ph[^>]*type="(?:title|ctrTitle)"[\s\S]*?<\/p:sp>/);
    if (tm) title = paras(tm[0], 'a:p', 'a:t').join(' ');
    const t = paras(noTbl, 'a:p', 'a:t').slice(0, MAX_TEXTS);
    if (!title) title = t[0] || '';
    // native charts: series names + category labels + values (the daily series some vendors draw)
    const charts = [];
    const rel = z.get(k.replace('slides/', 'slides/_rels/') + '.rels');
    if (rel) for (const m of rel.toString('utf8').matchAll(/Target="\.\.\/charts\/(chart\d+\.xml)"/g)) {
      const cx = z.get('ppt/charts/' + m[1]); if (!cx) continue;
      const s = cx.toString('utf8'); const series = [];
      each(s, 'c:ser', ser => {
        const name = texts(ser.match(/<c:tx>[\s\S]*?<\/c:tx>/) ? ser.match(/<c:tx>[\s\S]*?<\/c:tx>/)[0] : '', 'c:v').join(' ');
        const cat = (ser.match(/<c:cat>[\s\S]*?<\/c:cat>/) || [''])[0], val = (ser.match(/<c:val>[\s\S]*?<\/c:val>/) || [''])[0];
        series.push({ name: clean(name), cats: texts(cat, 'c:v').map(clean), vals: texts(val, 'c:v').map(v => Number(v)) });
      });
      if (series.length) charts.push({ series });
    }
    pages.push({ n: pages.length + 1, title: clean(title), texts: t, tables, charts, pictures: (xml.match(/<p:pic>/g) || []).length });
  }
  return pages;
}

/* ---------------- XLSX ---------------- */
function colIdx(ref) { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
function xlsx(z) {
  const ss = [];
  const sst = z.get('xl/sharedStrings.xml');
  if (sst) each(sst.toString('utf8'), 'si', si => ss.push(texts(si, 't').join('')));
  const wb = (z.get('xl/workbook.xml') || Buffer.from('')).toString('utf8');
  const rels = (z.get('xl/_rels/workbook.xml.rels') || Buffer.from('')).toString('utf8');
  const relMap = {}; for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2].replace(/^\/?xl\//, '');
  for (const m of rels.matchAll(/<Relationship[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) relMap[m[2]] = relMap[m[2]] || m[1].replace(/^\/?xl\//, '');
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)) sheets.push({ name: dec(m[1]), path: 'xl/' + (relMap[m[2]] || '') });
  if (!sheets.length) for (const k of z.keys()) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(k)) sheets.push({ name: k.match(/(sheet\d+)/)[1], path: k });
  const pages = [];
  for (const sh of sheets.slice(0, 30)) {
    const x = z.get(sh.path); if (!x) continue;
    const xml = x.toString('utf8'); const grid = [];
    each(xml, 'row', row => {
      if (grid.length > MAX_ROWS) return;
      const cells = [];
      for (const c of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], body = c[2] || '';
        const r = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1], t = (attrs.match(/\bt="([^"]+)"/) || [])[1];
        let v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (t === 's') v = ss[Number(v)];
        else if (t === 'inlineStr') v = texts(body, 't').join('');
        else if (v != null) v = dec(v);
        cells[colIdx(r)] = v == null ? '' : String(v).trim();
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
      if (cells.some(Boolean)) grid.push(cells);
    });
    if (grid.length) pages.push({ n: pages.length + 1, title: sh.name, texts: [], tables: [{ headers: grid[0], rows: grid.slice(1) }], charts: [] });
  }
  return pages;
}

/* ---------------- DOCX ---------------- */
function docx(z) {
  const x = z.get('word/document.xml'); if (!x) return [];
  const xml = x.toString('utf8');
  const tables = [];
  each(xml, 'w:tbl', tbl => {
    const rows = []; each(tbl, 'w:tr', tr => { const cells = []; each(tr, 'w:tc', tc => cells.push(paras(tc, 'w:p', 'w:t').join(' / '))); if (cells.some(Boolean)) rows.push(cells); });
    if (rows.length) tables.push({ headers: rows[0], rows: rows.slice(1, MAX_ROWS) });
  });
  const t = paras(xml.replace(/<w:tbl[\s\S]*?<\/w:tbl>/g, ''), 'w:p', 'w:t').slice(0, MAX_TEXTS * 3);
  return [{ n: 1, title: t[0] || '', texts: t, tables, charts: [] }];
}

/* ---------------- EML (RFC 822, MIME) ---------------- */
function qp(s) { return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))); }
function mimeWord(s) { return String(s || '').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (m, cs, enc, t) => { try { const b = enc.toUpperCase() === 'B' ? Buffer.from(t, 'base64') : Buffer.from(qp(t.replace(/_/g, ' ')), 'binary'); return b.toString(/utf-?8/i.test(cs) ? 'utf8' : 'latin1'); } catch (_) { return t; } }); }
function splitHead(raw) { const i = raw.search(/\r?\n\r?\n/); return i < 0 ? [raw, ''] : [raw.slice(0, i), raw.slice(i).replace(/^\r?\n\r?\n/, '')]; }
function headers(h) { const o = {}; h.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(l => { const i = l.indexOf(':'); if (i > 0) o[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }); return o; }
function htmlToText(h) {
  return dec(String(h).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<td[^>]*>/gi, ' | ').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
function htmlTables(h) {
  const tables = [];
  for (const m of String(h).matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [];
    for (const tr of m[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) { const cells = []; for (const td of tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) cells.push(htmlToText(td[1]).replace(/\s+/g, ' ')); if (cells.some(Boolean)) rows.push(cells); }
    if (rows.length > 1) tables.push({ headers: rows[0], rows: rows.slice(1, MAX_ROWS) });
  }
  return tables;
}
function walkMime(raw, out, depth) {
  if (depth > 6) return;
  const [h, body] = splitHead(raw); const H = headers(h);
  const ct = H['content-type'] || 'text/plain', cte = (H['content-transfer-encoding'] || '').toLowerCase();
  const bnd = (ct.match(/boundary="?([^";]+)"?/i) || [])[1];
  if (/^multipart\//i.test(ct) && bnd) { body.split('--' + bnd).slice(1).forEach(part => { if (!/^--/.test(part)) walkMime(part.replace(/^\r?\n/, ''), out, depth + 1); }); return; }
  const disp = H['content-disposition'] || '';
  const fname = mimeWord((disp.match(/filename="?([^";]+)"?/i) || ct.match(/name="?([^";]+)"?/i) || [])[1] || '');
  let data = cte === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64') : cte === 'quoted-printable' ? Buffer.from(qp(body), 'binary') : Buffer.from(body, 'binary');
  if (/attachment/i.test(disp) || (fname && !/^text\//i.test(ct))) { out.attachments.push({ name: fname || 'attachment', mime: ct.split(';')[0].trim(), data }); return; }
  const cs = /charset="?utf-?8/i.test(ct) ? 'utf8' : 'latin1';
  if (/^text\/html/i.test(ct)) { const s = data.toString(cs); out.html.push(s); }
  else if (/^text\//i.test(ct)) out.text.push(data.toString(cs));
}
function eml(buf) {
  const raw = buf.toString('binary');
  const [h] = splitHead(raw); const H = headers(h);
  const parts = { text: [], html: [], attachments: [] }; walkMime(raw, parts, 0);
  const body = parts.text.length ? parts.text.join('\n') : htmlToText(parts.html.join('\n'));
  const lines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, MAX_TEXTS * 2);
  const tables = parts.html.flatMap(htmlTables);
  return { pages: [{ n: 1, title: mimeWord(H.subject || ''), texts: lines, tables, charts: [] }],
    meta: { from: mimeWord(H.from || ''), to: mimeWord(H.to || ''), cc: mimeWord(H.cc || ''), subject: mimeWord(H.subject || ''), date: H.date || '' },
    attachments: parts.attachments };
}

/* ---------------- PDF (pdftotext when present) ---------------- */
function pdf(buf) {
  return new Promise(resolve => {
    try {
      const p = execFile('pdftotext', ['-layout', '-q', '-', '-'], { timeout: 20000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve({ pages: [], note: err.code === 'ENOENT' ? 'PDF text extraction is not installed on this server (poppler-utils) — the file is kept; fill the summary by hand.' : 'PDF could not be read: ' + err.message });
        const pages = String(stdout).split('\f').slice(0, MAX_PAGES).map((t, i) => { const lines = t.split(/\r?\n/).map(s => s.replace(/\s{3,}/g, ' | ').trim()).filter(Boolean); return { n: i + 1, title: lines[0] || '', texts: lines.slice(0, MAX_TEXTS), tables: [], charts: [] }; }).filter(p => p.texts.length);
        resolve({ pages });
      });
      p.stdin.on('error', () => {}); p.stdin.end(buf);
    } catch (e) { resolve({ pages: [], note: 'PDF could not be read: ' + e.message }); }
  });
}

function csv(buf) {
  const s = buf.toString('utf8'); const sep = (s.split('\n')[0].match(/;/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < s.length && rows.length < MAX_ROWS; i++) {
    const ch = s[i];
    if (q) { if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { row.push(cur.trim()); cur = ''; } else if (ch === '\n') { row.push(cur.trim()); if (row.some(Boolean)) rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur.trim()); if (row.some(Boolean)) rows.push(row); }
  return rows.length ? [{ n: 1, title: 'CSV', texts: [], tables: [{ headers: rows[0], rows: rows.slice(1) }], charts: [] }] : [];
}

async function extract(buf, name, mime) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  const res = { kind: ext, name: String(name || ''), pages: [], meta: {}, note: null, attachments: [] };
  try {
    if (['pptx', 'xlsx', 'docx', 'pptm', 'xlsm'].includes(ext)) {
      const z = unzip(buf);
      res.pages = ext.startsWith('ppt') ? pptx(z) : ext.startsWith('xls') ? xlsx(z) : docx(z);
    } else if (ext === 'eml') {
      const e = eml(buf); res.pages = e.pages; res.meta = e.meta;
      // reports attached to the mail are read too (one level)
      for (const a of e.attachments.slice(0, 6)) {
        const ax = String(a.name).toLowerCase().split('.').pop();
        if (!['pptx', 'xlsx', 'docx', 'pdf', 'csv'].includes(ax)) { res.attachments.push({ name: a.name, mime: a.mime, size: a.data.length, read: false }); continue; }
        const sub = await extract(a.data, a.name, a.mime);
        res.attachments.push({ name: a.name, mime: a.mime, size: a.data.length, read: sub.pages.length > 0 });
        sub.pages.forEach(p => res.pages.push({ ...p, n: res.pages.length + 1, title: `${a.name} · ${p.title}` }));
      }
    } else if (ext === 'pdf' || /pdf/.test(mime || '')) { const p = await pdf(buf); res.pages = p.pages; res.note = p.note || null; }
    else if (ext === 'csv') res.pages = csv(buf);
    else if (['txt', 'md'].includes(ext)) res.pages = [{ n: 1, title: name, texts: buf.toString('utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, MAX_TEXTS * 3), tables: [], charts: [] }];
    else if (ext === 'msg') res.note = 'Outlook .msg files are kept but not read — save the mail as .eml (File › Save as) or upload its attachment.';
    else res.note = 'This file type is kept as-is (no automatic reading) — fill the summary by hand.';
  } catch (e) { res.note = 'The file could not be read automatically (' + e.message + ') — it is kept; fill the summary by hand.'; }
  return res;
}

/* ---------------- suggestions: what the team report probably contains ---------------- */
const ID_RE = { SALM: /\bSALM-\d{3,6}\b/g, INC: /\bINC\d{9,13}\b/g, CHG: /\bCHG\d{6,9}\b/g, CRQ: /\bCRQ\d{9,13}\b/g, PBI: /\bPBI\d{9,13}\b/g,
  RITM: /\bRITM\d{6,10}\b/g, WO: /\bWO\d{7,10}\b/g, SR: /\b4-\d{10}\b/g, SL: /\bSL-\d{1,5}\b/g };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
// patterns are tried in priority order, so "Summary" wins over "Issue reported" (a date column in the Subex deck)
const findCol = (hdr, res, not = -1) => { for (const re of res) { const i = hdr.findIndex((h, j) => j !== not && re.test(norm(h))); if (i >= 0) return i; } return -1; };
/* header row repair: a one-cell caption row above the real header (UAM action plan), or a merged label cell in front
   of the header that the data rows don't carry (RCA "Action Items (Preventive/Corrective)") */
function fixTable(t) {
  let { headers, rows } = t;
  if (headers.filter(Boolean).length <= 1 && rows[0] && rows[0].filter(Boolean).length >= 3) { headers = rows[0]; rows = rows.slice(1); }
  if (rows.length && headers.length > 1 && rows.every(r => r.length === headers.length - 1)) headers = headers.slice(1);
  return { headers, rows };
}
const MON3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
/* reporting window from the file name or the text: "27th Sep to 03rd Oct", "27_Sep_03_Oct", "Week Ending 04-Oct-2026",
   "20260928-20261004", "from 27th Sep 2026 to 03rd Oct 2026". Year defaults to the upload year. */
function periodOf(str, year) {
  const s = String(str || '').replace(/_/g, ' ');
  let m = s.match(/\b(20\d{2})(\d{2})(\d{2})\s*[-–]?\s*(20\d{2})(\d{2})(\d{2})\b/);
  if (m) return { from: iso(m[1], m[2], m[3]), to: iso(m[4], m[5], m[6]) };
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-]*([A-Za-z]{3})[a-z]*\.?[\s\-,]*(20\d{2})?\s*(?:to|till|until|[-–])?\s*(\d{1,2})(?:st|nd|rd|th)?[\s\-]*([A-Za-z]{3})[a-z]*\.?[\s\-,]*(20\d{2})?/i);
  if (m && MON3[m[2].toLowerCase()] && MON3[m[5].toLowerCase()]) {
    const y2 = +(m[6] || m[3] || year), m1 = MON3[m[2].toLowerCase()], m2 = MON3[m[5].toLowerCase()];
    const y1 = m[3] ? +m[3] : (m1 > m2 ? y2 - 1 : y2);
    return { from: iso(y1, m1, m[1]), to: iso(y2, m2, m[4]) };
  }
  m = s.match(/week\s*ending\s*[:\-]?\s*(\d{1,2})[\s\-]*([A-Za-z]{3})[a-z]*[\s\-,]*(20\d{2})?/i);
  if (m && MON3[m[2].toLowerCase()]) { const to = iso(m[3] || year, MON3[m[2].toLowerCase()], m[1]); return { from: addDays(to, -6), to }; }
  return null;
}
const looksLikeId = v => /^\d{7,}$/.test(String(v).replace(/[,\s]/g, '')) || /^4-\d{10}$/.test(String(v));
const parseDate = s => {
  const t = String(s || '').trim(); if (!t) return null;
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const all = [...t.matchAll(/(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.]*([A-Za-z]{3,9})\.?(?:[\s\-,\/']+(\d{4}|(?:2[4-9]|3\d)(?!\d)))?/g)].filter(x => MON[x[2].toLowerCase().slice(0, 4)] || MON[x[2].toLowerCase().slice(0, 3)]);
  if (all.length) { const x = all[all.length - 1]; const mo = MON[x[2].toLowerCase().slice(0, 4)] || MON[x[2].toLowerCase().slice(0, 3)]; const y = x[3] ? (x[3].length === 2 ? '20' + x[3] : x[3]) : String(new Date().getUTCFullYear()); return `${y}-${String(mo).padStart(2, '0')}-${String(x[1]).padStart(2, '0')}`; }
  return null;
};
const SECTION = { highlights: /highlight|achievement|key point|business value|accomplish/i, lowlights: /lowlight|challenge|concern|issue|blocker/i, nextWeek: /next week|plan for|next focus|upcoming|planned/i };

function suggest(x, team) {
  const out = { ids: {}, actions: [], risks: [], kpis: [], highlights: [], lowlights: [], nextWeek: [], tablesSeen: 0, period: null };
  const all = [];
  for (const p of x.pages || []) { all.push(p.title, ...p.texts); for (const t of p.tables) { all.push(t.headers.join(' '), ...t.rows.map(r => r.join(' '))); } }
  const blob = all.join('\n');
  for (const [k, re] of Object.entries(ID_RE)) { const s = [...new Set(blob.match(re) || [])]; if (s.length) out.ids[k] = s.slice(0, 300); }
  // period hint: the file name first (vendors put the week there), then the mail subject, then the first pages
  const yr = new Date().getUTCFullYear();
  out.period = periodOf(x.name, yr) || periodOf((x.meta || {}).subject, yr) || periodOf((x.pages || []).slice(0, 4).map(p => [p.title, ...p.texts.slice(0, 20)].join(' \n ')).join(' \n '), yr) || null;
  for (const p of x.pages || []) {
    for (const t0 of p.tables) {
      out.tablesSeen++;
      const t = fixTable(t0);
      const h = t.headers.map(norm);
      const cOwner = findCol(h, [/^owner$/, /owner/, /assignee/, /responsible/, /^action by$/]), cEta = findCol(h, [/\beta\b/, /due/, /target date/, /completion date/, /milestone date/]);
      const cTitle = findCol(h, [/^summary$/, /^action item/, /^requirements?$/, /^(action|activity|task|item|title)$/, /description/, /summary/, /action/, /activity/, /issue(?! reported)/, /item/, /title/], cOwner);
      const cRef = findCol(h, [/issue key|issue_key|^key$|ticket|sr number|^id$|req id|change id|cr no|incident id|^#$/]);
      const cStatus = findCol(h, [/^status$/, /status|state/]), cUpd = findCol(h, [/current update|latest update|update|remarks|latest|comment/]);
      if (cOwner >= 0 && (cEta >= 0 || cStatus >= 0) && cTitle >= 0) {
        for (const r of t.rows.slice(0, 120)) {
          const title = (r[cTitle] || '').trim(); if (!title) continue;
          const etaRaw = cEta >= 0 ? r[cEta] || '' : '';
          const rowTxt = r.join(' ');
          const idHit = (rowTxt.match(/\b(?:SALM-\d{3,6}|INC\d{9,13}|PBI\d{9,13}|CRQ\d{9,13}|CHG\d{6,9}|RITM\d{6,10}|4-\d{10})\b/) || [])[0] || '';
          out.actions.push({ ref: (cRef >= 0 && /[A-Z]{2,}|\d{4,}/.test(r[cRef] || '') ? (r[cRef] || '').trim().slice(0, 40) : idHit),
            title: title.slice(0, 300), owner: (r[cOwner] || '').trim().slice(0, 80), eta: parseDate(etaRaw), etaRaw: etaRaw.slice(0, 120),
            status: cStatus >= 0 ? (r[cStatus] || '').trim().slice(0, 60) : '', update: cUpd >= 0 ? (r[cUpd] || '').trim().slice(0, 400) : '', source: `p${p.n}` });
        }
      }
      const cRisk = findCol(h, [/risk|challenge|issue/]), cMit = findCol(h, [/mitigation|action plan/]), cImp = findCol(h, [/impact/]);
      if (cRisk >= 0 && cMit >= 0) for (const r of t.rows.slice(0, 40)) { const title = (r[cRisk] || '').trim(); if (title) out.risks.push({ title: title.slice(0, 300), impact: cImp >= 0 ? (r[cImp] || '').slice(0, 200) : '', owner: cOwner >= 0 ? (r[cOwner] || '').slice(0, 80) : '', mitigation: (r[cMit] || '').slice(0, 300), source: `p${p.n}` }); }
      // KPI-shaped rows: a label cell followed by numbers / percentages
      for (const r of t.rows.slice(0, 60)) {
        const lc0 = /^\d{1,3}\.?$/.test((r[0] || '').trim()) && /[a-z]{3}/i.test(r[1] || '') ? 1 : 0;   // "S# | Application | …" — skip the row number
        const label = (r[lc0] || '').trim(); if (!label || label.length > 80 || looksLikeId(label) || /^[\d\s.,:/-]+$/.test(label) && !/[a-z]{3}/i.test(label)) continue;
        r.slice(lc0 + 1).forEach((v0, i0) => { const i = i0 + lc0; const v = String(v0).replace(/\s*[↑↓▲▼].*$/, ''); if (looksLikeId(v) || /\b(date|time)\b|^(id|sr|ticket|issue key|cr no)\b/i.test(String(t.headers[i + 1] || '').trim())) return; const m = String(v).match(/^\s*([<>≤≥]?\s*-?[\d,.]+)\s*(%|s|sec|ms|h|hrs?|gb|tb|sar|min)?\s*$/i); if (m) out.kpis.push({ label: `${label}${t.headers[i + 1] ? ' · ' + t.headers[i + 1] : ''}`.slice(0, 120), value: Number(String(m[1]).replace(/[^\d.\-]/g, '')), unit: (m[2] || '').toLowerCase(), source: `p${p.n}`, context: p.title }); });
      }
    }
    // native charts (Subex availability, TCS activation): one figure per series — the week's average and its lowest point
    for (const ch of p.charts || []) for (const ser of ch.series || []) {
      const vals = (ser.vals || []).filter(Number.isFinite); if (!vals.length) continue;
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100, min = Math.min(...vals);
      const pctLike = vals.every(v => v >= 0 && v <= 100) && /availab|%|rate|success|uptime/i.test(`${p.title} ${ser.name}`);
      const unit = pctLike ? '%' : '';
      const base = `${p.title || 'Chart'}${ser.name ? ' · ' + ser.name : ''}`.slice(0, 100);
      out.kpis.push({ label: `${base} (avg)`, value: avg, unit, source: `p${p.n}` });
      if (vals.length > 1 && min !== avg) out.kpis.push({ label: `${base} (lowest)`, value: min, unit, source: `p${p.n}` });
    }
    // text bullets under section-like titles
    const sec = Object.entries(SECTION).find(([, re]) => re.test(p.title || ''));
    if (sec) out[sec[0]].push(...p.texts.filter(s => s !== p.title && s.length > 8 && s.length < 400 && !/copyright|confidential|classification|all rights reserved|^(highlights?|lowlights?|next week)$/i.test(s)).slice(0, 12));
    // "label 94.61%" lines
    for (const s of p.texts) {
      // "98.73% (4049-1 week) New SIM activations complete within 20 sec" — the figure leads the line
      const lead = s.match(/^(\d{1,3}(?:\.\d+)?)\s*%\s*(.{6,140})$/);
      if (lead && out.kpis.length < 400) { out.kpis.push({ label: lead[2].replace(/\s+/g, ' ').trim(), value: Number(lead[1]), unit: '%', source: `p${p.n}`, context: p.title }); continue; }
      const m = s.match(/^(.{3,70}?)[\s:–-]+(-?\d[\d,.]*)\s*(%|s\b|sec\b|ms\b|hrs?\b|gb\b|sar\b)/i);
      if (m && out.kpis.length < 400) out.kpis.push({ label: m[1].trim(), value: Number(m[2].replace(/,/g, '')), unit: m[3].toLowerCase(), source: `p${p.n}` });
    }
  }
  out.kpis = out.kpis.filter(k => Number.isFinite(k.value)).slice(0, 200);
  // map the team's KPI template (match = regex on the label) onto the candidates
  out.kpiMatches = {};
  for (const k of (team && team.kpis) || []) {
    if (!k.match) continue;
    let re; try { re = new RegExp(k.match, 'i'); } catch (_) { continue; }
    let hits = out.kpis.filter(c => re.test(c.label)); if (!hits.length) hits = out.kpis.filter(c => re.test(`${c.context || ''} ${c.label}`));
    if (!hits.length) continue;
    // agg: the KPI is the highest (filesystem usage) or the lowest (availability) of every figure that matches; default = the first one
    out.kpiMatches[k.key] = k.agg === 'max' ? hits.reduce((a, b) => (b.value > a.value ? b : a)) : k.agg === 'min' ? hits.reduce((a, b) => (b.value < a.value ? b : a)) : hits[0];
  }
  ['highlights', 'lowlights', 'nextWeek'].forEach(k => { out[k] = [...new Set(out[k])].slice(0, 15); });
  out.actions = out.actions.slice(0, 120); out.risks = out.risks.slice(0, 30);
  return out;
}

module.exports = { extract, suggest, unzip, parseDate, periodOf, fixTable };
