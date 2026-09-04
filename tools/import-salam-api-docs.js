#!/usr/bin/env node
/* Salam selfcare API docs importer — parses the SLATE documentation that ships INSIDE the
 * selfcare-backend repo (vendor/api-docs/index.html — the exact page served with basic auth at
 * https://staging-proxy.salammobile.sa/api-docs/). No network needed; re-run after backend
 * updates, then deploy --web-only.
 *
 *   node tools/import-salam-api-docs.js [path-to-index.html]
 *
 * Emits into the console frontend root:
 *   salamApiDocs.json  → the "Salam API docs" page (tree, search, deep links #salamdocs?s=<anchor>)
 *   SALAM_API_DOCS.md  → Yusr KB (assist.js KB_FILES) — one heading per doc section  */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', '..', 'selfcare-backend', 'vendor', 'api-docs', 'index.html');
const OUT = path.join(__dirname, '..');

const html = fs.readFileSync(SRC, 'utf8');

// Slate content lives in <div class="content"> …sections…; headings carry the public anchors.
const content = (html.match(/<div class="content">([\s\S]*?)<\/div>\s*<div class="dark-box">\s*<\/div>|<div class="content">([\s\S]*)$/) || [,''])[1]
  || (html.split('<div class="content">')[1] || '');
if (!content || content.length < 5000) { console.error('FAILED: could not locate Slate content block in ' + SRC); process.exit(1); }

const strip = s => String(s)
  .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|pre)>/gi, '\n')
  .replace(/<t[dh][^>]*>/gi, ' | ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n').trim();

// split on h1/h2 with ids — these ids are the site's #anchors (#checkout, …)
const parts = content.split(/(?=<h[12][^>]*\bid=)/i);
const sections = [];
for (const p of parts) {
  const m = /^<h([12])[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/h\1>/i.exec(p);
  if (!m) continue;
  const title = strip(m[3]).replace(/\s+/g, ' ').trim();
  if (!title) continue;
  sections.push({ id: m[2], level: Number(m[1]), title, html: p.trim(), text: strip(p).slice(0, 12000) });
}
if (!sections.length) { console.error('FAILED: no h1/h2 sections with ids found — Slate layout changed?'); process.exit(1); }

const index = {};
for (const s of sections) { index[s.id.toLowerCase()] = s.id; index[s.title.toLowerCase()] = s.id; }

fs.writeFileSync(path.join(OUT, 'salamApiDocs.json'), JSON.stringify({
  imported_at: new Date().toISOString(),
  source: 'selfcare-backend/vendor/api-docs/index.html (served at staging-proxy.salammobile.sa/api-docs)',
  external_base: 'https://staging-proxy.salammobile.sa/api-docs/#',
  sections: sections.map(s => ({ id: s.id, level: s.level, title: s.title, html: s.html })), index
}));

let md = `# Salam Selfcare API — imported documentation (${new Date().toISOString().slice(0, 10)})\n\n` +
  `Source: the app's own Slate docs (staging-proxy.salammobile.sa/api-docs). These describe the\n` +
  `Digital API the mobile app and web call — order wizard, checkout, payments, recharges, etc.\n`;
for (const s of sections) md += `\n${s.level === 1 ? '##' : '###'} Salam API · ${s.title}\n${s.text.slice(0, 2200)}\n`;
fs.writeFileSync(path.join(OUT, 'SALAM_API_DOCS.md'), md);

console.log(`salamApiDocs.json: ${sections.length} sections (${sections.filter(s => s.level === 1).length} chapters)`);
console.log(`SALAM_API_DOCS.md: ${Math.round(md.length / 1024)}KB for Yusr KB`);
console.log('sections:', sections.filter(s => s.level === 1).map(s => s.title).join(' · ').slice(0, 300));
