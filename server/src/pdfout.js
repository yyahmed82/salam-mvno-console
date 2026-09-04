/* pdfout.js — a real PDF writer in vanilla Node. No library, no build step.
 *
 * WHY THIS EXISTS RATHER THAN pdfkit/puppeteer
 * 152 has no internet, so nothing can be npm-installed there, and the deploy ships only what the
 * repo contains (same reasoning as xlsxout.js, the sibling that writes .xlsx from scratch). A PDF
 * of text, rules and tables needs none of a library's power: pages are objects, content is an
 * uncompressed stream of text/rect operators, and the base-14 Helvetica fonts need no embedding.
 * Every mail client and phone opens the result.
 *
 * SCOPE — deliberately small: A4 portrait, Helvetica/Helvetica-Bold, filled rects, wrapped text,
 * zebra tables with repeated headers on page break, footer with page numbers. Latin-1 text only:
 * anything outside WinAnsi is transliterated (≥ → >=) or replaced — alert content is English.
 *
 * API (layout is top-down with automatic pagination):
 *   const d = pdfout.doc({ footer: 'left text' });
 *   d.band(h, color)                       — full-width filled band at the cursor
 *   d.text(str, {size,bold,color,x,indent,gap,width}) · d.title/h2/p sugar
 *   d.kv([[k,v],...])                      — two-column fact grid
 *   d.table(cols, rows)                    — cols: [{label,w,align}], rows: string[][]
 *   d.space(pt) · d.hr()
 *   d.buffer()                             — the finished PDF as a Buffer
 */
'use strict';

const A4 = { w: 595.28, h: 841.89 };
const M = 46;                                   // page margin
const CW = A4.w - 2 * M;                        // content width

/* rough-but-stable width model for the base-14 faces — good enough for wrapping ops text; a
 * line never overflows because the factor errs wide. Courier is fixed-pitch: exactly 0.6em. */
const wof = (s, size, bold, mono) => String(s).length * size * (mono ? 0.6 : bold ? 0.545 : 0.5);

const TR = { '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '·': '-', '⇄': '<->', '×': 'x',
  '—': '-', '–': '-', '…': '...', '‘': "'", '’': "'", '“': '"', '”': '"', '⚠': '!', '●': '*',
  '✓': 'ok', '✕': 'x', '№': 'No' };
function latin(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (c === 10 || c === 13) { out += ' '; continue; }
    if (c < 32) continue;
    if (c <= 255) { out += ch; continue; }
    out += TR[ch] != null ? TR[ch] : '?';
  }
  return out;
}
const escStr = s => latin(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrap(s, size, width, bold, mono) {
  const words = latin(s).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (let w of words) {
    while (wof(w, size, bold, mono) > width && w.length > 4) {  // pathological token (a URL)
      let cut = Math.max(4, Math.floor(width / (size * (mono ? 0.6 : bold ? 0.545 : 0.5))));
      lines.push((cur ? cur + ' ' : '') + w.slice(0, cut)); cur = ''; w = w.slice(cut);
    }
    const t = cur ? cur + ' ' + w : w;
    if (wof(t, size, bold, mono) <= width) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

const C = {                                      // console palette
  dark: [0.043, 0.231, 0.18], green: [0.055, 0.624, 0.353], ink: [0.067, 0.141, 0.114],
  muted: [0.373, 0.435, 0.412], line: [0.855, 0.898, 0.878], zebra: [0.957, 0.973, 0.965],
  red: [0.863, 0.149, 0.149], amber: [0.851, 0.463, 0.024], white: [1, 1, 1],
};
const rgb = c => c.map(v => (+v).toFixed(3)).join(' ');

function doc(opts = {}) {
  const pages = [];                              // each: array of content-stream fragments
  let ops = null, y = 0;                         // y measured from the TOP of the page
  const footer = opts.footer || '';

  function newPage() { ops = []; pages.push(ops); y = M; }
  newPage();

  const rect = (x, yTop, w, h, color) =>
    ops.push(`${rgb(color)} rg ${x.toFixed(2)} ${(A4.h - yTop - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  const line = (x1, yTop, x2, color, width = 0.7) =>
    ops.push(`${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${(A4.h - yTop).toFixed(2)} m ${x2.toFixed(2)} ${(A4.h - yTop).toFixed(2)} l S`);
  const raw = (x, yTop, size, str, { bold = false, mono = false, color = C.ink } = {}) =>
    ops.push(`BT /${mono ? 'F3' : bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${(A4.h - yTop).toFixed(2)} Td (${escStr(str)}) Tj ET`);

  function need(h) { if (y + h > A4.h - M - 18) newPage(); }

  const api = {
    /* full-width coloured band drawn at the cursor; returns its top y so text can overlay */
    band(h, color) { need(h); rect(M - 8, y, CW + 16, h, color); const top = y; y += h; return top; },
    at(x, yTop, str, o = {}) { raw(x, yTop, o.size || 10, str, o); },
    text(str, o = {}) {
      const size = o.size || 10, lh = size + (o.lead || 3.2);
      const x = M + (o.indent || 0), width = (o.width || CW) - (o.indent || 0);
      for (const ln of wrap(str, size, width, o.bold, o.mono)) {
        need(lh); raw(x, y + size, size, ln, o); y += lh;
      }
      y += o.gap != null ? o.gap : 2;
    },
    /* pre-formatted block (request/response bodies): Courier, shaded panel, hard line cap */
    code(str, o = {}) {
      const size = o.size || 7.2, lh = size + 2.6, maxLines = o.maxLines || 26;
      let lines = String(str == null ? '' : str).split('\n')
        .flatMap(l => wrap(l, size, CW - 20, false, true));
      const cut = lines.length > maxLines;
      if (cut) lines = lines.slice(0, maxLines);
      const h = lines.length * lh + 10;
      need(Math.min(h, 300) + 4);
      rect(M, y, CW, h, [0.945, 0.961, 0.953]);
      lines.forEach((ln, i) => raw(M + 10, y + 8 + size + i * lh, size, ln, { mono: true, color: C.ink }));
      y += h + 2;
      if (cut) api.p(`... truncated (${o.note || 'full body in the console trace'})`, { color: C.muted, size: 7.5 });
      y += 2;
    },
    title(str, o = {}) { api.text(str, { size: 16, bold: true, gap: 4, ...o }); },
    h2(str, o = {}) {
      need(30); y += 8;
      rect(M - 8, y + 1, 3.5, 13, C.green);
      api.text(str, { size: 11.5, bold: true, color: C.dark, gap: 3, ...o });
    },
    p(str, o = {}) { api.text(str, { size: 9.5, color: o.color || C.ink, ...o }); },
    space(pt = 8) { y += pt; },
    hr() { need(8); line(M, y + 3, M + CW, C.line); y += 8; },
    kv(pairs, o = {}) {
      const size = 9.5, lh = size + 4.5, kw = o.kw || 150;
      for (const [k, v] of pairs) {
        const lines = wrap(String(v == null || v === '' ? '—' : v), size, CW - kw - 6, false);
        need(lines.length * lh + 2);
        raw(M, y + size, size, latin(k), { color: C.muted });
        lines.forEach((ln, i) => raw(M + kw, y + size + i * lh, size, ln, { bold: !!o.boldVal }));
        y += lines.length * lh + 1.5;
      }
      y += 3;
    },
    table(cols, rows, o = {}) {
      const size = o.size || 8.6, lh = size + 3, padX = 5, padY = 4;
      const tot = cols.reduce((a, c) => a + c.w, 0);
      const sc = CW / tot;                       // widths are relative; scale to content width
      const xs = []; let acc = M;
      for (const c of cols) { xs.push(acc); acc += c.w * sc; }
      const header = () => {
        need(lh + 2 * padY + 2);
        rect(M, y, CW, lh + 2 * padY - 2, C.dark);
        cols.forEach((c, i) => raw(
          c.align === 'right' ? xs[i] + c.w * sc - padX - wof(c.label, size, true) : xs[i] + padX,
          y + padY + size, size, c.label, { bold: true, color: C.white }));
        y += lh + 2 * padY - 2;
      };
      header();
      rows.forEach((r, ri) => {
        const cells = r.map((v, i) => wrap(String(v == null || v === '' ? '—' : v), size, cols[i].w * sc - 2 * padX, false));
        const h = Math.max(...cells.map(c => c.length)) * lh + 2 * padY - 2;
        if (y + h > A4.h - M - 18) { newPage(); header(); }
        if (ri % 2) rect(M, y, CW, h, C.zebra);
        if (o.rowColor) { const rc = o.rowColor(ri); if (rc) rect(M, y, 3, h, rc); }
        cells.forEach((lines, i) => lines.forEach((ln, li) => raw(
          cols[i].align === 'right' ? xs[i] + cols[i].w * sc - padX - wof(ln, size, false) : xs[i] + padX,
          y + padY + size + li * lh - 2, size, ln, { color: C.ink })));
        y += h;
        line(M, y, M + CW, C.line, 0.4);
      });
      y += 6;
    },
    /* small exposed rect — brand marks and custom accents */
    mark(x, yTop, w, h, color) { rect(x, yTop, w, h, color); },
    /* CHARTS (31 Aug) — real drawn bars replacing the old '#....' pseudo-bars. */
    colChart(points, o = {}) {
      const H = o.height || 88, max = Math.max(1, ...points.map(p => Number(p.v) || 0));
      const n2 = Math.max(1, points.length), gap = 2, bw = Math.max(2, (CW - gap * n2) / n2);
      need(H + 28);
      const top = y;
      points.forEach((p2, i) => {
        const v = Number(p2.v) || 0, h = Math.max(1.5, H * v / max);
        rect(M + i * (bw + gap), top + H - h, bw, h, o.color || C.green);
      });
      line(M, top + H, M + CW, C.line, 0.6);
      const every = Math.max(1, Math.ceil(n2 / (o.maxLabels || 14)));
      points.forEach((p2, i) => { if (i % every) return;
        raw(M + i * (bw + gap), top + H + 9, 6.5, String(p2.label).slice(0, 6), { color: C.muted }); });
      raw(M + CW - wof('peak ' + max.toLocaleString(), 7, false) - 2, top + 8, 7, 'peak ' + max.toLocaleString(), { color: C.muted });
      y = top + H + 18;
    },
    hChart(rows, o = {}) {
      const size = 8.6, bh = o.barH || 12, gap = 4, lw = o.labelW || 175, rw = o.rightW || 95;
      const max = Math.max(1, ...rows.map(r => Number(r.v) || 0));
      for (const r of rows) {
        need(bh + gap + 2);
        const v = Number(r.v) || 0, bw2 = Math.max(1.5, (CW - lw - rw - 10) * v / max);
        raw(M, y + size + 1, size, String(r.label).slice(0, 40), { color: C.ink });
        rect(M + lw, y + 1.5, bw2, bh - 2, o.color || C.green);
        raw(M + lw + bw2 + 5, y + size + 1, size, String(r.right != null ? r.right : v.toLocaleString()), { color: C.muted });
        y += bh + gap;
      }
      y += 5;
    },
    buffer() {
      pages.forEach((p, i) => {
        p.push(`BT /F1 8 Tf ${rgb(C.muted)} rg ${M} ${(M - 24).toFixed(2)} Td (${escStr(footer)}) Tj ET`);
        p.push(`BT /F1 8 Tf ${rgb(C.muted)} rg ${(A4.w - M - 40).toFixed(2)} ${(M - 24).toFixed(2)} Td (page ${i + 1} / ${pages.length}) Tj ET`);
      });
      /* objects: 1 catalog · 2 pages · 3 F1 · 4 F2 · 5 F3 · then per page: page obj + stream */
      const objs = [];
      const kids = pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ');
      objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
      objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
      objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
      objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
      objs[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`;
      pages.forEach((p, i) => {
        const stream = p.join('\n');
        objs[6 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7 + i * 2} 0 R >>`;
        objs[7 + i * 2] = { stream };
      });
      let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
      const xref = [0];
      for (let n = 1; n < objs.length; n++) {
        xref[n] = out.length;
        const o = objs[n];
        out += typeof o === 'string'
          ? `${n} 0 obj\n${o}\nendobj\n`
          : `${n} 0 obj\n<< /Length ${Buffer.byteLength(o.stream, 'latin1')} >>\nstream\n${o.stream}\nendstream\nendobj\n`;
      }
      const start = out.length;
      out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
      for (let n = 1; n < objs.length; n++) out += String(xref[n]).padStart(10, '0') + ' 00000 n \n';
      out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
      return Buffer.from(out, 'latin1');
    },
    colors: C,
  };
  return api;
}

module.exports = { doc };
