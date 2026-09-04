#!/usr/bin/env node
/* TAP (UPG) DEVELOPER DOCS IMPORTER
 *
 *   cd mvno-console && node tools/import-tap-docs.js
 *
 * RUN THIS ON THE MAC — server 152 has no internet. It writes two files into the console root,
 * which deploy.sh ships to the web folder:
 *   tapDocs.json      → the viewer (#tapdocs)
 *   TAP_API_DOCS.md   → Yusr's knowledge base (assist.js picks it up from STATIC_DIR)
 *
 * Tap's docs are ReadMe-hosted and publish an agent-friendly index: llms.txt lists every page,
 * and appending ".md" to any page URL returns clean markdown. That is what we parse — no HTML
 * scraping, no API key, nothing that breaks when they restyle the site.
 *
 * Polite by design: small concurrency, a short delay between batches, one retry per page.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const INDEX = 'https://developers.tap.company/llms.txt';
const OUT_DIR = path.join(__dirname, '..');
const CONC = 4;          // parallel fetches
const GAP_MS = 250;      // pause between batches
const UA = 'SalamDigitalConsole-DocImporter/1.0 (+internal ops tooling)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/markdown,text/plain,*/*' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (i === tries - 1) return null;
      await sleep(600);
    }
  }
}

/* llms.txt →  [{ group, title, url, desc }]  (group = the "## Guides" / "## API Reference" head) */
function parseIndex(txt) {
  const out = []; let group = 'General';
  for (const line of String(txt || '').split('\n')) {
    const g = line.match(/^##\s+(.+?)\s*$/); if (g) { group = g[1].trim(); continue; }
    const m = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)\s*(?::\s*(.*))?$/);
    if (m) out.push({ group, title: m[1].trim(), url: m[2].trim(), desc: (m[3] || '').trim() });
  }
  return out;
}

/* A page's markdown → { front, body, sections:[{level,title,anchor,text}] }
 * ReadMe puts YAML front-matter on top and an "Fetch the complete documentation index…" nudge
 * line for agents; both are stripped so the stored text is just the documentation. */
function parsePage(md) {
  let body = String(md || '');
  const front = {};
  const fm = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    fm[1].split('\n').forEach(l => { const kv = l.match(/^(\w[\w-]*):\s*(.*)$/); if (kv) front[kv[1]] = kv[2].trim(); });
    body = body.slice(fm[0].length);
  }
  body = body.replace(/^\s*Fetch the complete documentation index[^\n]*\n/m, '')
             .replace(/^\s*Append \.md to any documentation page[^\n]*\n/m, '')
             .trim();
  const sections = [];
  const lines = body.split('\n');
  let cur = null;
  for (const l of lines) {
    const h = l.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (h) {
      if (cur) sections.push(cur);
      const title = h[2].replace(/\[\]\(#[^)]*\)/g, '').replace(/&#x20;/g, ' ').trim();
      cur = { level: h[1].length, title, anchor: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), text: '' };
    } else if (cur) cur.text += l + '\n';
    else { cur = { level: 1, title: '(intro)', anchor: 'intro', text: l + '\n' }; }
  }
  if (cur) sections.push(cur);
  sections.forEach(s => s.text = s.text.trim());
  return { front, body, sections };
}

/* markdown tables → arrays, so the viewer can render code tables as real tables and Yusr can
 * answer "what is code 505" without parsing pipes at query time. */
function parseTables(md) {
  const tables = []; const lines = String(md || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) continue;
    const head = lines[i].split('|').slice(1, -1).map(s => s.trim());
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++)
      rows.push(lines[j].split('|').slice(1, -1).map(s => s.trim()));
    if (rows.length) tables.push({ head, rows });
    i = j - 1;
  }
  return tables;
}

(async () => {
  process.stdout.write('▸ fetching the documentation index… ');
  const idxTxt = await get(INDEX);
  if (!idxTxt) { console.error('\n✗ could not read llms.txt — check the network and retry'); process.exit(1); }
  const entries = parseIndex(idxTxt);
  console.log(`${entries.length} pages listed`);
  if (!entries.length) { console.error('✗ index parsed to zero pages — the format may have changed'); process.exit(1); }

  const pages = []; let done = 0, failed = 0;
  for (let i = 0; i < entries.length; i += CONC) {
    const batch = entries.slice(i, i + CONC);
    await Promise.all(batch.map(async e => {
      const md = await get(e.url);
      done++;
      process.stdout.write(`\r▸ pages ${done}/${entries.length}  (${failed} failed)   `);
      if (!md) { failed++; return; }
      const p = parsePage(md);
      const id = e.url.replace(/^https?:\/\/developers\.tap\.company\//, '').replace(/\.md$/, '');
      pages.push({
        id, title: e.title, group: e.group, url: e.url.replace(/\.md$/, ''),
        desc: e.desc || (p.front['excerpt'] || ''), updated: p.front['updatedAt'] || null,
        kind: id.startsWith('reference/') ? 'reference' : 'guide',
        body: p.body, sections: p.sections.map(s => ({ level: s.level, title: s.title, anchor: s.anchor })),
        tables: parseTables(p.body),
      });
    }));
    if (i + CONC < entries.length) await sleep(GAP_MS);
  }
  console.log(`\n▸ fetched ${pages.length} pages (${failed} failed)`);

  // group for the viewer tree, keeping the doc site's own order
  const order = []; const byGroup = {};
  for (const p of pages) { if (!byGroup[p.group]) { byGroup[p.group] = []; order.push(p.group); } byGroup[p.group].push(p); }
  const doc = {
    source: 'https://developers.tap.company', index: INDEX,
    imported_at: new Date().toISOString(), pages: pages.length,
    groups: order.map(g => ({ name: g, pages: byGroup[g] })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'tapDocs.json'), JSON.stringify(doc));
  console.log(`✓ tapDocs.json  (${(fs.statSync(path.join(OUT_DIR, 'tapDocs.json')).size / 1024).toFixed(0)} KB)`);

  // Yusr knowledge base — one markdown file, chunked by assist.js on headings
  let kb = `# Tap Payments (UPG) — API documentation\n\n` +
    `Imported ${doc.imported_at} from ${doc.source} (${pages.length} pages).\n` +
    `Tap is the gateway behind Salam's UPG payments: charges, refunds, tokens, invoices and webhooks.\n\n`;
  for (const g of doc.groups) {
    kb += `\n## ${g.name}\n`;
    for (const p of g.pages) {
      kb += `\n### ${p.title}\n`;
      if (p.desc) kb += `${p.desc}\n`;
      kb += `Source: ${p.url}\n\n${p.body}\n`;
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'TAP_API_DOCS.md'), kb);
  console.log(`✓ TAP_API_DOCS.md  (${(Buffer.byteLength(kb) / 1024).toFixed(0)} KB)`);

  const codes = pages.find(p => /charge-response-codes/.test(p.id));
  if (codes) console.log(`✓ response-code tables captured: ${codes.tables.length} tables, ` +
    `${codes.tables.reduce((a, t) => a + t.rows.length, 0)} codes`);
  console.log('\nNext: ./deploy152/deploy.sh   (ships tapDocs.json + TAP_API_DOCS.md to the console)');
})();
