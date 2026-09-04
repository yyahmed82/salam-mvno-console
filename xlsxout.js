/* xlsxout.js — a real .xlsx writer in vanilla JS. No library, no CDN, no build step.
 *
 * WHY THIS EXISTS RATHER THAN SheetJS
 * 152 has no internet, so a CDN <script> can never load there, and there is no bundler in this
 * project to vendor a package into. But an .xlsx is only a ZIP holding a handful of XML parts, and
 * ZIP allows entries to be STORED (compression method 0). Stored entries need no DEFLATE, so the
 * whole writer is a CRC32 table plus some string building. Excel, Numbers and LibreOffice all open
 * the result without the "the file format does not match" warning you get from the old trick of
 * renaming an HTML table to .xls.
 *
 * The file is bigger than a compressed one — an export of a few thousand rows lands around a
 * megabyte. That is the trade for having no dependency, and for these exports it does not matter.
 *
 * API
 *   opsXlsx.build(sheets)  → Uint8Array          (pure; unit-testable outside the browser)
 *   opsXlsx.save(sheets, filename)               (browser: triggers the download)
 *   sheets = [{ name:'Reasons', rows:[{col:value,…}], cols:['col',…] }]
 *   `cols` is optional — the column order defaults to the union of keys in row order, which keeps
 *   the sheet's columns in the same order the screen showed them.
 */
(function (root) {
  'use strict';

  /* ---- XML escaping. Excel rejects a file outright on a stray control character, and payment
   * data has come through with them before (a stray NUL inside a gateway message). */
  const esc = s => String(s == null ? '' : s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  /* Excel sheet-name rules, enforced here so a caller cannot produce a corrupt workbook:
   * max 31 chars, and none of : \ / ? * [ ] */
  const sheetName = (n, i) => (String(n || ('Sheet' + (i + 1))).replace(/[:\\\/?*\[\]]/g, '-').slice(0, 31)) || ('Sheet' + (i + 1));

  const colRef = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };

  /* ---- THE EXPORT THEME -------------------------------------------------------------------
   * One look for every export in the console, so a sheet mailed to BI or a vendor is recognisably
   * ours. Style indexes below are positions in <cellXfs> and are referenced by the `s` attribute
   * on each cell — change the table, not the call sites.
   *   0 default · 1 header · 2/3 text (plain/banded) · 4/5 money · 6/7 integer · 8 key column */
  const XF = { DEF: 0, HEAD: 1, TXT: 2, TXT_B: 3, MONEY: 4, MONEY_B: 5, INT: 6, INT_B: 7, KEY: 8 };
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>
<fonts count="3">
 <font><sz val="11"/><color rgb="FF11241D"/><name val="Calibri"/></font>
 <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
 <font><b/><sz val="11"/><color rgb="FF0B3B2E"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
 <fill><patternFill patternType="none"/></fill>
 <fill><patternFill patternType="gray125"/></fill>
 <fill><patternFill patternType="solid"><fgColor rgb="FF0B3B2E"/><bgColor indexed="64"/></patternFill></fill>
 <fill><patternFill patternType="solid"><fgColor rgb="FFF4F8F6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
 <border><left/><right/><top/><bottom/><diagonal/></border>
 <border><left style="thin"><color rgb="FFDDE7E1"/></left><right style="thin"><color rgb="FFDDE7E1"/></right><top style="thin"><color rgb="FFDDE7E1"/></top><bottom style="thin"><color rgb="FFDDE7E1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
 <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
 <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="left"/></xf>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
 <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
 <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>
 <xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>
 <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>
 <xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>
 <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  /* numbers go in as numbers so Excel can sum them; everything else as an inline string, which
   * avoids needing a sharedStrings part at all */
  function cellXml(v, r, c, st) {
    const ref = colRef(c) + (r + 1);
    const sAttr = st ? ` s="${st}"` : '';
    if (v == null || v === '') return `<c r="${ref}"${sAttr}/>`;
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
    // NO type inference. Payment data is full of numeric-looking strings that are IDENTIFIERS —
    // MSISDNs, reference ids, order numbers. Guessing turned 966512345678 into 9.66512E+11 in
    // testing. A value is a number only when the caller passed an actual number.
    return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
  }

  /* Per-column type, decided from the DATA rather than the header name: a column is numeric only
   * when every value present in it is a real number. That keeps identifier columns (reference,
   * MSISDN) as left-aligned text even when they look numeric, and gives amounts a thousands
   * separator and right alignment without anyone having to declare the schema. */
  function colTypes(rows, cols) {
    return cols.map(c => {
      let seen = 0, nums = 0, ints = 0;
      for (const r of rows) {
        const v = r && r[c];
        if (v == null || v === '') continue;
        seen++;
        if (typeof v === 'number' && isFinite(v)) { nums++; if (Number.isInteger(v)) ints++; }
      }
      if (seen && nums === seen) return ints === nums ? 'int' : 'money';
      return 'text';
    });
  }

  /* Width from the widest cell, capped: a gateway message can be 300 characters and would
   * otherwise produce a column nobody can scroll past. */
  function colWidths(rows, cols) {
    return cols.map(c => {
      let w = String(c).length;
      for (const r of rows) {
        const v = r && r[c];
        if (v == null) continue;
        const l = String(v).length;
        if (l > w) w = l;
      }
      return Math.min(Math.max(w + 3, 9), 52);
    });
  }

  function sheetXml(rows, cols) {
    const types = colTypes(rows, cols), widths = colWidths(rows, cols);
    const last = colRef(Math.max(cols.length - 1, 0));
    const out = [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`,
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`,
      `<sheetFormatPr defaultRowHeight="15"/>`,
      `<cols>` + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + `</cols>`,
      `<sheetData>`];
    out.push(`<row r="1" ht="22" customHeight="1">` + cols.map((c, i) => cellXml(c, 0, i, XF.HEAD)).join('') + `</row>`);
    rows.forEach((r, ri) => {
      const band = ri % 2 === 1;                       // zebra striping, so a wide row stays readable
      const cells = cols.map((c, ci) => {
        const t = types[ci];
        const st = t === 'money' ? (band ? XF.MONEY_B : XF.MONEY)
          : t === 'int' ? (band ? XF.INT_B : XF.INT)
          : (ci === 0 && cols.length === 2 ? XF.KEY : (band ? XF.TXT_B : XF.TXT));
        return cellXml(r[c], ri + 1, ci, st);
      });
      out.push(`<row r="${ri + 2}">` + cells.join('') + `</row>`);
    });
    out.push(`</sheetData><autoFilter ref="A1:${last}${rows.length + 1}"/></worksheet>`);
    return out.join('');
  }

  /* ---- ZIP (stored) ------------------------------------------------------------------------ */
  const CRC = (() => { const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const utf8 = s => new TextEncoder().encode(s);

  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = utf8(f.name), data = utf8(f.data), crc = crc32(data);
      const lh = new Uint8Array(30 + name.length); const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true);                       // method 0 = stored
      dv.setUint16(10, 0, true); dv.setUint16(12, 0x2821, true);   // fixed date, so builds are reproducible
      dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh, data);

      const ch = new Uint8Array(46 + name.length); const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x2821, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);
      offset += lh.length + data.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22); const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    const all = parts.concat(central, [end]);
    const total = all.reduce((a, p) => a + p.length, 0);
    const buf = new Uint8Array(total); let p = 0;
    for (const a of all) { buf.set(a, p); p += a.length; }
    return buf;
  }

  function build(sheets) {
    const S = (sheets || []).map((s, i) => {
      const rows = s.rows || [];
      const cols = s.cols && s.cols.length ? s.cols : [...new Set(rows.flatMap(r => Object.keys(r || {})))];
      return { name: sheetName(s.name, i), rows, cols };
    });
    if (!S.length) S.push({ name: 'Sheet1', rows: [], cols: [] });

    const files = [
      { name: '[Content_Types].xml', data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
        + `<Default Extension="xml" ContentType="application/xml"/>`
        + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
        + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
        + S.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + `</Types>` },
      { name: '_rels/.rels', data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
        + S.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + `</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + S.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + `</Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
    ];
    S.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.cols) }));
    return zip(files);
  }

  /* EVERY export is audited, from here rather than from the call sites — a caller that forgets is
   * exactly the export nobody can account for later. window.audit() adds actor, role, IP and UA
   * server-side, so this only has to say WHAT left and FROM WHERE. */
  function save(sheets, filename, meta) {
    const bytes = build(sheets);
    const name = /\.xlsx$/i.test(filename || '') ? filename : (filename || 'export') + '.xlsx';
    try {
      const S = (sheets || []).map(x => ({ sheet: x.name, rows: (x.rows || []).length }));
      if (typeof window !== 'undefined' && window.audit) window.audit('EXPORT_XLSX', name, Object.assign({
        file: name,
        page: (location.hash || '#dashboard').replace(/^#/, ''),
        sheets: S,
        total_rows: S.reduce((a, x) => a + x.rows, 0),
        bytes: bytes.length,
      }, meta || {}));
    } catch (e) { /* a failed audit must never block the user's download */ }
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  root.opsXlsx = { build, save, _sheetXml: sheetXml, _sheetName: sheetName };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.opsXlsx;
