/* opsDeck.js — the two weekly decks of Operations reports, built from the vendors' own files in the Salam template
 * (9 Oct 2026, alpha.157). Node only, no dependency: OOXML is edited as text, ZIP read by opsReportsParse.unzip and
 * written here. Ported from tools/opsreports-deck (pptxmerge.py · build_exec.py · build_complete.py).
 *
 *   buildExec({ template, content })                 → { buf, slides }   Operational Weekly Executive Report (5 slides)
 *   buildComplete({ template, date, domains })       → { buf, slides, report }   Application Operational weekly status report
 *
 * THE TEMPLATE (server/templates/opsreports-deck-template.pptx) holds the 8 Salam slides both decks are made of:
 *   1 cover "Weekly Executive Report" · 2 executive brief · 3 executive areas table · 4 focus for next week · 5 thank you
 *   6 cover of the complete deck (date) · 7 Enterprise Platforms Operations Domains · 8 domain divider ("MVNO - Legacy")
 * HOW A VENDOR SLIDE IS COPIED — like PowerPoint's "Use destination theme" paste: the slide XML is copied verbatim
 * (only relationship targets are renamed), every part it uses is copied once (images de-duplicated by content, charts
 * with their workbooks, SmartArt, tags), its layout is copied under the Salam master 1 (keeps its arrangement, takes the
 * Salam theme and leaf logo). Speaker notes and comments are left out. A PDF report goes in page by page as pictures
 * (pdftoppm, poppler-utils). Every domain is a PowerPoint section.
 * WHICH SLIDES (`slides` of a source):  auto (default — every slide except "Thank you", "Safe Harbor", "Lorem ipsum" and
 *   empty ones) · all · "2-7, 9" · "from:Apollo Managed Services" · "until:ZSmart Hardware" — several parts with ";". */
'use strict';
const zlib = require('zlib');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { unzip } = require('./opsReportsParse');

const P = path.posix;
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const T_SLIDE = RT + '/slide', T_LAYOUT = RT + '/slideLayout', T_MASTER = RT + '/slideMaster';
const SKIP_TYPES = ['/notesSlide', '/comments', '/commentAuthors', '/customXml'];
const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const LAYOUT_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml';
const SLIDE_W = 12192000, SLIDE_H = 6858000;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escA = s => esc(s).replace(/"/g, '&quot;');
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const dec = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

/* ---------------------------------------------------------------- ZIP writer (stored media, deflated XML) */
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) { CRC_T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c; } }
  let crc = -1; for (let i = 0; i < buf.length; i++) crc = CRC_T[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
const STORE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'wdp', 'jfif', 'mp4', 'm4a', 'mp3', 'zip', 'xlsx', 'docx', 'pptx']);
async function zipWrite(entries) {
  const chunks = [], central = []; let offset = 0;
  for (const [nm, data] of entries) {
    const name = Buffer.from(nm, 'utf8');
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const store = STORE_EXT.has(nm.split('.').pop().toLowerCase());
    const comp = store ? raw : await new Promise((res, rej) => zlib.deflateRaw(raw, { level: 6 }, (e, b) => e ? rej(e) : res(b)));
    const method = store ? 0 : 8, crc = crc32(raw);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0x0800, 6); lfh.writeUInt16LE(method, 8); lfh.writeUInt32LE(0, 10);
    lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(comp.length, 18); lfh.writeUInt32LE(raw.length, 22); lfh.writeUInt16LE(name.length, 26); lfh.writeUInt16LE(0, 28);
    chunks.push(lfh, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

/* ---------------------------------------------------------------- package */
const relsPath = part => P.join(P.dirname(part), '_rels', P.basename(part) + '.rels');
function parseRels(xml) {
  const out = []; const re = /<Relationship\b([^>]*?)\/?>/g; let m;
  while ((m = re.exec(xml))) { const a = m[1]; const g = k => { const x = new RegExp('\\b' + k + '="([^"]*)"').exec(a); return x ? x[1] : null; };
    out.push({ Id: g('Id'), Type: g('Type'), Target: g('Target'), Mode: g('TargetMode') }); }
  return out;
}
const writeRels = rels => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  rels.map(r => `<Relationship Id="${r.Id}" Type="${r.Type}" Target="${escA(dec(r.Target))}"${r.Mode ? ` TargetMode="${r.Mode}"` : ''}/>`).join('') + '</Relationships>';
let PKG_ID = 0;
class Pkg {
  constructor(buf, label) {
    this.id = ++PKG_ID; this.label = label || 'package';
    this.files = unzip(buf);                                   // Map name → Buffer (a damaged member is skipped)
    for (const [k, v] of this.files) if (v == null) this.files.delete(k);
    if (!this.files.has('[Content_Types].xml') || !this.files.has('ppt/presentation.xml')) throw new Error(`${this.label}: not a PowerPoint file`);
    const ct = this.text('[Content_Types].xml');
    this.defaults = new Map(); this.overrides = new Map(); let m;
    const d = /<Default Extension="([^"]+)" ContentType="([^"]+)"/g; while ((m = d.exec(ct))) this.defaults.set(m[1].toLowerCase(), m[2]);
    const o = /<Override PartName="\/([^"]+)" ContentType="([^"]+)"/g; while ((m = o.exec(ct))) this.overrides.set(m[1], m[2]);
    this.next = new Map();
  }
  text(part) { return this.files.get(part).toString('utf8'); }
  ctype(part) { return this.overrides.get(part) || this.defaults.get(part.split('.').pop().toLowerCase()); }
  rels(part) { const rp = relsPath(part); return this.files.has(rp) ? parseRels(this.text(rp)) : []; }
  resolve(part, target) { target = dec(target); return target.startsWith('/') ? target.slice(1) : P.normalize(P.join(P.dirname(part), target)); }
  relTarget(from, to) { return P.relative(P.dirname(from), to); }
  freeName(folder, stem, ext) {
    const key = `${folder}|${stem}|${ext}`;
    let i = this.next.get(key);
    if (i == null) {
      i = 1; const re = new RegExp('^' + folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)\\.' + ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
      for (const n of this.files.keys()) { const m = re.exec(n); if (m) i = Math.max(i, +m[1] + 1); }
    }
    while (this.files.has(`${folder}/${stem}${i}.${ext}`)) i++;
    this.next.set(key, i + 1);
    return `${folder}/${stem}${i}.${ext}`;
  }
  addPart(part, data, ctype) {
    this.files.set(part, data);
    const ext = part.split('.').pop().toLowerCase();
    if (ctype && this.defaults.get(ext) !== ctype) { if (this.defaults.has(ext) || ext === 'xml' || ext === 'rels') this.overrides.set(part, ctype); else this.defaults.set(ext, ctype); }
  }
  dropPart(part) { this.files.delete(part); this.files.delete(relsPath(part)); this.overrides.delete(part); }
  /* parts nobody points at any more (the slides a deck does not use, their pictures, charts, layouts) */
  gc() {
    const keep = new Set(['[Content_Types].xml', '_rels/.rels']), todo = [];
    parseRels(this.text('_rels/.rels')).forEach(r => { if (r.Mode !== 'External') todo.push(this.resolve('', r.Target)); });
    while (todo.length) {
      const p = todo.pop(); if (keep.has(p) || !this.files.has(p)) continue;
      keep.add(p); const rp = relsPath(p); if (this.files.has(rp)) { keep.add(rp); this.rels(p).forEach(r => { if (r.Mode !== 'External') todo.push(this.resolve(p, r.Target)); }); }
    }
    for (const n of [...this.files.keys()]) if (!keep.has(n)) this.dropPart(n);
  }
  async save() {
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      [...this.defaults].map(([k, v]) => `<Default Extension="${k}" ContentType="${v}"/>`).join('') +
      [...this.overrides].filter(([k]) => this.files.has(k)).map(([k, v]) => `<Override PartName="/${k}" ContentType="${v}"/>`).join('') + '</Types>';
    this.files.set('[Content_Types].xml', Buffer.from(ct, 'utf8'));
    const order = ['[Content_Types].xml', '_rels/.rels', ...[...this.files.keys()].filter(n => n !== '[Content_Types].xml' && n !== '_rels/.rels')];
    return zipWrite(order.map(n => [n, this.files.get(n)]));
  }
  slides() {
    const p = this.text('ppt/presentation.xml'), rmap = {};
    this.rels('ppt/presentation.xml').forEach(r => { rmap[r.Id] = this.resolve('ppt/presentation.xml', r.Target); });
    const out = []; const re = /<p:sldId\b[^>]*\br:id="([^"]+)"/g; let m;
    while ((m = re.exec(p))) if (rmap[m[1]] && this.files.has(rmap[m[1]])) out.push(rmap[m[1]]);
    return out;
  }
  masters() {
    return this.rels('ppt/presentation.xml').filter(r => r.Type === T_MASTER).map(r => this.resolve('ppt/presentation.xml', r.Target))
      .sort((a, b) => +(/(\d+)\.xml$/.exec(a) || [0, 0])[1] - +(/(\d+)\.xml$/.exec(b) || [0, 0])[1]);
  }
}

/* ---------------------------------------------------------------- merger */
class Merger {
  constructor(baseBuf) {
    this.T = new Pkg(baseBuf, 'template');
    this.memo = new Map(); this.layoutMemo = new Map(); this.mediaHash = new Map();
    for (const [n, d] of this.T.files) if (n.startsWith('ppt/media/') && !this.mediaHash.has(sha1(d))) this.mediaHash.set(sha1(d), n);
    this.pres = 'ppt/presentation.xml';
    this.order = [];                                           // [slide part, section]
    this.masters = this.T.masters();
    this._layouts = null;
  }
  layoutIndex() {
    if (!this._layouts) {
      this._layouts = [];
      this.masters.forEach((m, i) => this.T.rels(m).filter(r => r.Type === T_LAYOUT).forEach(r => {
        const lp = this.T.resolve(m, r.Target); if (!this.T.files.has(lp)) return;
        const nm = /<p:cSld name="([^"]*)"/.exec(this.T.text(lp));
        this._layouts.push({ mi: i + 1, name: nm ? dec(nm[1]) : '', part: lp });
      }));
    }
    return this._layouts;
  }
  findLayout(name, master) { const x = this.layoutIndex().find(l => l.name === name && (master == null || l.mi === master)); return x ? x.part : null; }
  copyPart(S, sp) {
    const key = S.id + '|' + sp;
    if (this.memo.has(key)) return this.memo.get(key);
    if (!S.files.has(sp)) return null;
    const data = S.files.get(sp), folder = P.dirname(sp), base = P.basename(sp);
    const dot = base.lastIndexOf('.'), ext = dot > 0 ? base.slice(dot + 1) : '', stem = (dot > 0 ? base.slice(0, dot) : base).replace(/\d+$/, '') || 'part';
    if (folder === 'ppt/media') { const h = sha1(data); if (this.mediaHash.has(h)) { this.memo.set(key, this.mediaHash.get(h)); return this.mediaHash.get(h); } }
    const nw = this.T.freeName(folder, stem, ext);
    this.memo.set(key, nw);
    if (folder === 'ppt/media') this.mediaHash.set(sha1(data), nw);
    this.T.addPart(nw, data, S.ctype(sp));
    this._copyRels(S, sp, nw);
    return nw;
  }
  _copyRels(S, sp, nw, layoutTarget) {
    const rels = S.rels(sp); if (!rels.length) return;
    const out = [];
    for (const r of rels) {
      const t = r.Type || '';
      if (r.Mode === 'External') { out.push(r); continue; }
      if (SKIP_TYPES.some(s => t.endsWith(s))) continue;
      if (t === T_LAYOUT && layoutTarget) { out.push({ ...r, Target: this.T.relTarget(nw, layoutTarget) }); continue; }
      if (t === T_MASTER) { out.push({ ...r, Target: this.T.relTarget(nw, this.masters[0]) }); continue; }
      if (t === T_SLIDE) { out.push({ Id: r.Id, Type: RT + '/hyperlink', Target: '#', Mode: 'External' }); continue; }   // a link to another vendor slide — kept harmless
      const tgt = this.copyPart(S, S.resolve(sp, r.Target));
      if (tgt) out.push({ ...r, Target: this.T.relTarget(nw, tgt) });
    }
    this.T.files.set(relsPath(nw), Buffer.from(writeRels(out), 'utf8'));
  }
  mapLayout(S, slp, reuseByName) {
    const key = S.id + '|' + slp;
    if (this.layoutMemo.has(key)) return this.layoutMemo.get(key);
    const x = S.text(slp), nmm = /<p:cSld name="([^"]*)"/.exec(x), nm = nmm ? dec(nmm[1]) : '';
    if (reuseByName) {
      const mr = S.rels(slp).find(r => r.Type === T_MASTER), sm = S.masters();
      const mi = mr ? sm.indexOf(S.resolve(slp, mr.Target)) + 1 : 0;
      const lp = this.findLayout(nm, mi || null) || this.findLayout(nm);
      if (lp) { this.layoutMemo.set(key, lp); return lp; }
    }
    const nw = this.T.freeName('ppt/slideLayouts', 'slideLayout', 'xml');
    this.T.addPart(nw, S.files.get(slp), LAYOUT_CT);
    this.layoutMemo.set(key, nw);
    this._copyRels(S, slp, nw);
    const m = this.masters[0], mrels = this.T.rels(m);
    const rid = 'rId' + (Math.max(0, ...mrels.map(r => /^rId(\d+)$/.exec(r.Id)).filter(Boolean).map(a => +a[1])) + 1);
    mrels.push({ Id: rid, Type: T_LAYOUT, Target: this.T.relTarget(m, nw) });
    this.T.files.set(relsPath(m), Buffer.from(writeRels(mrels), 'utf8'));
    this.T.files.set(m, Buffer.from(this.T.text(m).replace('</p:sldLayoutIdLst>', `<p:sldLayoutId id="${this._nextLayoutId()}" r:id="${rid}"/></p:sldLayoutIdLst>`), 'utf8'));
    this._layouts = null;
    return nw;
  }
  _nextLayoutId() {
    let mx = 2147483648;
    this.masters.forEach(m => { const re = /<p:sldLayoutId id="(\d+)"/g; let x; const t = this.T.text(m); while ((x = re.exec(t))) mx = Math.max(mx, +x[1]); });
    const re = /<p:sldMasterId id="(\d+)"/g; let x; const t = this.T.text(this.pres); while ((x = re.exec(t))) mx = Math.max(mx, +x[1]);
    return mx + 1;
  }
  /* copy slide `sp` of package S; edit(xml) → xml may change its text */
  addSlide(S, sp, section, opts) {
    opts = opts || {};
    const lr = S.rels(sp).find(r => r.Type === T_LAYOUT);
    const lp = lr ? this.mapLayout(S, S.resolve(sp, lr.Target), !!opts.reuseLayout) : null;
    const nw = this.T.freeName('ppt/slides', 'slide', 'xml');
    let x = S.text(sp); if (opts.edit) x = opts.edit(x);
    this.T.addPart(nw, Buffer.from(x, 'utf8'), SLIDE_CT);
    this.memo.set(S.id + '|' + sp, nw);
    this._copyRels(S, sp, nw, lp);
    this.order.push([nw, section]);
    return nw;
  }
  /* one of the template's own slides, edited in place (used once) */
  useBaseSlide(sp, section, edit) {
    if (edit) this.T.files.set(sp, Buffer.from(edit(this.T.text(sp)), 'utf8'));
    this.order.push([sp, section]);
    return sp;
  }
  /* a slide written from scratch; images = { rId: [buffer, ext] } referenced by r:embed */
  addRawSlide(xml, layoutPart, images, section) {
    const nw = this.T.freeName('ppt/slides', 'slide', 'xml');
    this.T.addPart(nw, Buffer.from(xml, 'utf8'), SLIDE_CT);
    const rels = [{ Id: 'rIdL', Type: T_LAYOUT, Target: this.T.relTarget(nw, layoutPart) }];
    for (const [rid, [data, ext]] of Object.entries(images || {})) {
      const h = sha1(data); let mp = this.mediaHash.get(h);
      if (!mp) { mp = this.T.freeName('ppt/media', 'image', ext); this.T.addPart(mp, data, ext === 'png' ? 'image/png' : 'image/jpeg'); this.mediaHash.set(h, mp); }
      rels.push({ Id: rid, Type: RT + '/image', Target: this.T.relTarget(nw, mp) });
    }
    this.T.files.set(relsPath(nw), Buffer.from(writeRels(rels), 'utf8'));
    this.order.push([nw, section]);
    return nw;
  }
  async finish() {
    const T = this.T, keep = new Set(this.order.map(o => o[0]));
    let px = T.text(this.pres);
    const prels = T.rels(this.pres).filter(r => !(r.Type === T_SLIDE && !keep.has(T.resolve(this.pres, r.Target))));
    for (const n of [...T.files.keys()]) if ((/^ppt\/slides\/slide\d+\.xml$/.test(n) && !keep.has(n)) || /^ppt\/notesSlides\//.test(n)) T.dropPart(n);
    // a kept template slide may still point at its notes slide
    for (const [sp] of this.order) { const rp = relsPath(sp); if (T.files.has(rp)) { const r = T.rels(sp); const f = r.filter(x => !SKIP_TYPES.some(s => (x.Type || '').endsWith(s))); if (f.length !== r.length) T.files.set(rp, Buffer.from(writeRels(f), 'utf8')); } }
    let nxt = Math.max(0, ...prels.map(r => /^rId(\d+)$/.exec(r.Id)).filter(Boolean).map(a => +a[1])) + 1;
    const ids = [], sec = new Map();
    this.order.forEach(([p, s], i) => {
      const rid = 'rId' + (nxt++), sid = 256 + i;
      prels.push({ Id: rid, Type: T_SLIDE, Target: T.relTarget(this.pres, p) });
      ids.push(`<p:sldId id="${sid}" r:id="${rid}"/>`);
      const k = s || 'Deck'; if (!sec.has(k)) sec.set(k, []); sec.get(k).push(sid);
    });
    const lst = '<p:sldIdLst>' + ids.join('') + '</p:sldIdLst>';
    px = /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/.test(px) ? px.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, lst) : px.replace('</p:sldMasterIdLst>', '</p:sldMasterIdLst>' + lst);
    const secXml = '<p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">' +
      [...sec].map(([name, sl]) => `<p14:section name="${escA(name)}" id="{${crypto.randomUUID().toUpperCase()}}"><p14:sldIdLst>${sl.map(s => `<p14:sldId id="${s}"/>`).join('')}</p14:sldIdLst></p14:section>`).join('') +
      '</p14:sectionLst></p:ext>';
    px = px.replace(/<p:ext uri="\{521415D9-36F7-43E2-AB2F-B90AF26B5E84\}">[\s\S]*?<\/p:ext>/, '');
    px = px.includes('<p:extLst>') ? px.replace('<p:extLst>', '<p:extLst>' + secXml) : px.replace('</p:presentation>', '<p:extLst>' + secXml + '</p:extLst></p:presentation>');
    T.files.set(this.pres, Buffer.from(px, 'utf8'));
    T.files.set(relsPath(this.pres), Buffer.from(writeRels(prels), 'utf8'));
    T.gc();
    return T.save();
  }
}

/* ---------------------------------------------------------------- slide picking */
const slideText = xml => { const a = []; const re = /<a:t>([^<]*)<\/a:t>/g; let m; while ((m = re.exec(xml))) a.push(dec(m[1])); return a.join(' ').replace(/\s+/g, ' ').trim(); };
const norm = s => String(s || '').toLowerCase().replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim();
function slideJunk(xml) {
  const t = norm(slideText(xml));
  if (/lorem ipsum/.test(t) || /^safe harbor statement/.test(t)) return true;
  if (t.length < 60 && /^(thank\s*you|thanks|questions\??|q\s*&\s*a)\b/.test(t.replace(/^\d+\s*/, ''))) return true;
  if (!t && !/<p:pic\b|<p:graphicFrame\b|<a:blip\b/.test(xml)) return true;                       // nothing on it
  return false;
}
/* spec → 0-based indexes of `texts` (one string of XML per slide) + what happened */
function pickSlides(spec, xmls) {
  const n = xmls.length, parts = String(spec || 'auto').split(';').map(s => s.trim()).filter(Boolean);
  const froms = [], untils = [], ranges = []; let all = false;
  for (const p of parts) {
    let m;
    if ((m = /^from:(.+)$/i.exec(p))) froms.push(norm(m[1]));
    else if ((m = /^until:(.+)$/i.exec(p))) untils.push(norm(m[1]));
    else if (/^all$/i.test(p)) all = true;
    else if (/^auto$/i.test(p)) { /* default */ }
    else p.split(/[,\s]+/).forEach(r => { const x = /^(\d+)(?:-(\d+))?$/.exec(r); if (x) ranges.push([+x[1], +(x[2] || x[1])]); });
  }
  const texts = xmls.map(x => norm(slideText(x)));
  let start = 0, end = n, note = null;
  if (froms.length) { const i = texts.findIndex(t => froms.some(f => t.includes(f))); if (i < 0) return { idx: [], note: `no slide with “${froms.join('” / “')}”` }; start = i; }
  if (untils.length) { const j = texts.findIndex((t, k) => k > start && untils.some(u => t.includes(u))); if (j > 0) end = j; }
  let idx = [];
  if (ranges.length) { for (const [a, b] of ranges) for (let i = a; i <= Math.min(b, n); i++) if (i >= 1 && !idx.includes(i - 1)) idx.push(i - 1); }
  else { for (let i = start; i < end; i++) idx.push(i); if (!all) { const before = idx.length; idx = idx.filter(i => !slideJunk(xmls[i])); if (before !== idx.length) note = `${before - idx.length} left out (thank you / empty / placeholder)`; } }
  return { idx, note };
}

/* ---------------------------------------------------------------- PDF pages → pictures */
const pngSize = b => [b.readUInt32BE(16), b.readUInt32BE(20)];
async function pdfPages(buf, spec, maxPages) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opsr-pdf-'));
  try {
    const f = path.join(dir, 'in.pdf'); await fs.promises.writeFile(f, buf);
    const ranges = []; String(spec || '').split(/[,;\s]+/).forEach(r => { const x = /^(\d+)(?:-(\d+))?$/.exec(r); if (x) ranges.push([+x[1], +(x[2] || x[1])]); });
    const first = ranges.length ? Math.min(...ranges.map(r => r[0])) : 1, last = ranges.length ? Math.max(...ranges.map(r => r[1])) : first + (maxPages || 40) - 1;
    await new Promise((res, rej) => execFile('pdftoppm', ['-png', '-r', '110', '-f', String(first), '-l', String(last), f, path.join(dir, 'p')], { timeout: 120000 },
      e => e ? rej(e.code === 'ENOENT' ? Object.assign(new Error('pdftoppm is not installed on this server (poppler-utils)'), { missingTool: true }) : e) : res()));
    const files = (await fs.promises.readdir(dir)).filter(x => /^p-?\d+\.png$/.test(x)).sort((a, b) => +/(\d+)\.png$/.exec(a)[1] - +/(\d+)\.png$/.exec(b)[1]);
    const out = [];
    for (const x of files) { const pg = +/(\d+)\.png$/.exec(x)[1]; if (!ranges.length || ranges.some(([a, b]) => pg >= a && pg <= b)) out.push(await fs.promises.readFile(path.join(dir, x))); }
    return out;
  } finally { fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
const SLIDE_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const SLIDE_TAIL = '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
function pictureSlide(png, name) {
  const [w, h] = pngSize(png), margin = 180000, scale = Math.min((SLIDE_W - 2 * margin) / w, (SLIDE_H - 2 * margin - 300000) / h);
  const cx = Math.round(w * scale), cy = Math.round(h * scale), x = Math.round((SLIDE_W - cx) / 2), y = Math.round((SLIDE_H - 300000 - cy) / 2);
  return SLIDE_HEAD + `<p:pic><p:nvPicPr><p:cNvPr id="2" name="${escA(name)}" descr="${escA(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` + SLIDE_TAIL;
}

/* ---------------------------------------------------------------- the two decks */
const TPL = { cover: 0, brief: 1, table: 2, focus: 3, thanks: 4, ccover: 5, domains: 6, divider: 7 };
function templateSlides(M) {
  const s = M.T.slides();
  if (s.length < 8) throw new Error('the deck template has ' + s.length + ' slides — 8 are expected (server/templates/opsreports-deck-template.pptx)');
  return s;
}

/* content: { cover_sub, brief_title, brief, headlines[], rows[[area, outcome, attention]], focus[] } */
async function buildExec({ template, content }) {
  const c = content || {};
  const M = new Merger(template), s = templateSlides(M);
  M.useBaseSlide(s[TPL.cover], 'Executive report', x => x.replace('<a:t>Weekly Executive Report</a:t>', `<a:t>${esc(c.cover_sub || 'Weekly Executive Report')}</a:t>`));
  M.useBaseSlide(s[TPL.brief], 'Executive report', x => {
    x = x.replace(/<a:t>Executive Weekly Brief \|[^<]*<\/a:t>/, `<a:t>${esc(c.brief_title || '')}</a:t>`);
    x = x.replace(/<a:t>Operations remained under control\.[^<]*<\/a:t>/, `<a:t>${esc(c.brief || '')}</a:t>`);
    let extra = '<a:p><a:endParaRPr lang="en-US" sz="1000" dirty="0"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:endParaRPr></a:p>';
    (c.headlines || []).forEach(h => { extra += `<a:p><a:pPr><a:spcBef><a:spcPts val="300"/></a:spcBef></a:pPr><a:r><a:rPr lang="en-US" sz="1400" dirty="0"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:rPr><a:t>${esc(h)}</a:t></a:r></a:p>`; });
    const i = x.indexOf(`<a:t>${esc(c.brief || '')}</a:t>`); if (i < 0) return x;
    const j = x.indexOf('</a:p>', i) + 6;
    return x.slice(0, j) + extra + x.slice(j);
  });
  M.useBaseSlide(s[TPL.table], 'Executive report', x => {
    const trs = x.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) || [], rows = c.rows || [];
    trs.slice(1).forEach((tr, k) => {
      if (k >= rows.length) { x = x.replace(tr, ''); return; }
      let ci = 0; const cells = rows[k];
      x = x.replace(tr, tr.replace(/(<a:tc>[\s\S]*?<a:t>)[^<]*(<\/a:t>)/g, (m, a, b) => a + esc(cells[ci++] || '') + b));
    });
    return x;
  });
  M.useBaseSlide(s[TPL.focus], 'Executive report', x => {
    const paras = x.match(/<a:p><a:r><a:rPr lang="en-US" sz="1400"><a:solidFill><a:schemeClr val="bg1"\/><\/a:solidFill><\/a:rPr><a:t>• [^<]*<\/a:t><\/a:r><\/a:p>/g) || [];
    if (!paras.length) return x;
    const nw = (c.focus || []).map(f => paras[0].replace(/<a:t>• [^<]*<\/a:t>/, `<a:t>• ${esc(f)}</a:t>`)).join('');
    const a = x.indexOf(paras[0]), b = x.indexOf(paras[paras.length - 1]) + paras[paras.length - 1].length;
    return x.slice(0, a) + nw + x.slice(b);
  });
  M.useBaseSlide(s[TPL.thanks], 'Executive report');
  return { buf: await M.finish(), slides: M.order.length };
}

/* date: { day: "3", suffix: "rd ", rest: "Oct 2026" }
 * domains: [{ name (\n = line break), note, sources: [{ label, name, buf, slides }] }] — a source without buf is reported missing */
async function buildComplete({ template, date, domains, maxPdfPages }) {
  const M = new Merger(template), s = templateSlides(M);
  const TP = new Pkg(template, 'template');                    // the cover, domains and divider slides are copied from here (the divider many times)
  const report = [];
  M.addSlide(TP, s[TPL.ccover], 'Cover', { reuseLayout: true, edit: x => x.replace('<a:t>25</a:t>', `<a:t>${esc(date.day)}</a:t>`).replace('<a:t>th </a:t>', `<a:t>${esc(date.suffix)}</a:t>`).replace('<a:t>Sept 2026</a:t>', `<a:t>${esc(date.rest)}</a:t>`) });
  M.addSlide(TP, s[TPL.domains], 'Cover', { reuseLayout: true });
  const titleLayout = M.findLayout('Title Slide', 1) || M.layoutIndex()[0].part;
  for (const dom of domains) {
    const section = String(dom.name).replace(/\s*\n\s*/g, ' – ');
    const notes = (Array.isArray(dom.note) ? dom.note : [dom.note]).filter(Boolean);
    M.addSlide(TP, s[TPL.divider], section, { reuseLayout: true, edit: x => {
      x = x.replace('<a:t>MVNO - Legacy</a:t>', '<a:t>' + String(dom.name).split('\n').map(esc).join('</a:t></a:r><a:br><a:rPr lang="en-US" dirty="0"/></a:br><a:r><a:t>') + '</a:t>');
      if (notes.length) x = x.replace('<a:endParaRPr lang="en-AE" sz="4400" dirty="0"/></a:p>', '<a:endParaRPr lang="en-AE" sz="4400" dirty="0"/></a:p>' +
        notes.map(n => `<a:p><a:r><a:rPr lang="en-US" sz="1600" b="0" dirty="0"/><a:t>${esc(n)}</a:t></a:r></a:p>`).join(''));
      return x;
    } });
    const line = { domain: section, slides: 0, sources: [] };
    for (const src of dom.sources || []) {
      const r = { label: src.label || src.name || '—', file: src.name || null, slides: 0, note: null };
      line.sources.push(r);
      if (!src.buf) { r.note = src.missing || 'no file'; continue; }
      try {
        if (/\.pdf$/i.test(src.name)) {
          const pngs = await pdfPages(src.buf, /^\s*(auto|all)?\s*$/i.test(src.slides || '') ? '' : src.slides, maxPdfPages || 40);
          pngs.forEach((png, i) => M.addRawSlide(pictureSlide(png, `${src.name} p${i + 1}`), titleLayout, { rIdImg: [png, 'png'] }, section));
          r.slides = pngs.length;
        } else {
          const S = new Pkg(src.buf, src.name), sl = S.slides();
          const pk = pickSlides(src.slides, sl.map(p => S.text(p)));
          pk.idx.forEach(i => M.addSlide(S, sl[i], section));
          r.slides = pk.idx.length; r.of = sl.length; r.note = pk.note;
        }
      } catch (e) { r.note = 'not added: ' + e.message; r.error = true; }
      line.slides += r.slides;
    }
    report.push(line);
  }
  M.addSlide(TP, s[TPL.thanks], 'Close', { reuseLayout: true });
  return { buf: await M.finish(), slides: M.order.length, report };
}

/* the cover date of the complete deck: the last day of the week, "3" "rd " "Oct 2026" (the template writes "Sept") */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
function coverDate(day) {
  const d = new Date(day + 'T00:00:00Z'), n = d.getUTCDate();
  const suf = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return { day: String(n), suffix: suf + ' ', rest: `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}

module.exports = { buildExec, buildComplete, coverDate, pickSlides, slideText, Pkg, Merger, zipWrite };
