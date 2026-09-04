#!/usr/bin/env node
/* OTO API docs importer — run on a machine WITH INTERNET (your Mac), NOT on 152.
 *
 *   node tools/import-oto-docs.js
 *
 * Pulls the FULL published OTO documentation (apis.tryoto.com — Postman documenter) via the
 * documenter gateway JSON API, walks every folder/request (handles the gateway's pagination and
 * lazily-loaded folders), and writes TWO artifacts into the console frontend root:
 *
 *   otoDocs.json      → drives the "OTO Courier API" reference page + the /rest/v2/* linkifier
 *   OTO_API_DOCS.md   → heading-per-endpoint markdown; Yusr's KB chunks it automatically
 *                       (assist.js KB_FILES — same mechanism as OPS_RUNBOOK.md)
 *
 * The Postman item ids in the JSON are the SAME anchors the public docs use, so every endpoint
 * links both to our internal page (#otodocs?ep=<id>) and to https://apis.tryoto.com/#<id>.
 * Re-run any time OTO updates their docs, then deploy --web-only. */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const CID = '21535185-963d8cce-aec0-46c6-a67e-fbb46ec62aec';
const PUB = 'UzBnr6go';
const BASE = `https://documenter.gw.postman.com/api/collections/${CID}/${PUB}`;
const QS = 'segregateAuth=true&versionTag=latest';
const OUT_DIR = path.join(__dirname, '..');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { accept: 'application/json', 'user-agent': 'salam-console-docs-import' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

/* Tolerant walker — documenter payloads mix collection-v1 (url/method/description on the item)
 * and v2 (item.request.{...}) shapes. Collect folders (have .item array) and requests (have url
 * or request). */
function walk(node, folderPath, out, seen) {
  if (!node || typeof node !== 'object') return;
  const name = node.name || '';
  const kids = Array.isArray(node.item) ? node.item : null;
  if (kids) {
    const fp = folderPath.concat(name ? [name] : []);
    if (node.id) out.folderIds.set(node.id, { name, path: fp, empty: kids.length === 0 });
    // folder descriptions ARE the guide pages (Plan-Based Access, Use Cases, Release Notes…)
    if (node.id && node.description && String(node.description).length > 80 && !seen.has('g:' + node.id)) {
      seen.add('g:' + node.id);
      out.pages.push({ id: node.id, folder: folderPath.join(' · '), name, desc: String(node.description) });
    }
    for (const k of kids) walk(k, fp, out, seen);
    return;
  }
  const req = node.request && typeof node.request === 'object' ? node.request : node;
  const url = typeof req.url === 'string' ? req.url : (req.url && (req.url.raw || '')) || node.url || '';
  const method = (req.method || node.method || '').toUpperCase();
  if (!url && !method) {
    if (node.id && node.description) out.pages.push({ id: node.id, folder: folderPath.join(' · '), name, desc: String(node.description) });
    return;
  }
  if (!node.id || seen.has(node.id)) return;
  seen.add(node.id);
  const responses = [];
  for (const r of (node.responses || node.response || [])) {
    if (responses.length >= 3) break;
    responses.push({ name: r.name || '', status: r.status || r.code || '',
      body: String(r.text || r.body || '').slice(0, 5000) });
  }
  out.endpoints.push({
    id: node.id, folder: folderPath.join(' · '), name,
    method, url: String(url).split('?')[0],
    desc: String(req.description || node.description || ''),
    body: String(req.rawModeData || (req.body && (req.body.raw || '')) || node.rawModeData || '').slice(0, 5000),
    responses
  });
}

const stripHtml = s => String(s)
  .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
  .replace(/<t[dh][^>]*>/gi, ' | ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\n{3,}/g, '\n\n').trim();

(async () => {
  const out = { endpoints: [], pages: [], folderIds: new Map() };
  const seen = new Set();

  console.log('fetching collection tree…');
  const first = await get(`${BASE}?${QS}`);
  if (!first) { console.error('FAILED: could not fetch the collection — check internet / URL'); process.exit(1); }
  walk(first, [], out, seen);
  console.log(`  page 1: ${out.endpoints.length} endpoints, ${out.folderIds.size} folders`);

  // paginated tree pages (the gateway serves the tree in slices)
  for (let p = 2; p <= 30; p++) {
    const j = await get(`${BASE}?${QS}&page=${p}`);
    if (!j) break;
    const before = out.endpoints.length + out.pages.length;
    walk(j, [], out, seen);
    const gained = out.endpoints.length + out.pages.length - before;
    console.log(`  page ${p}: +${gained}`);
    if (gained === 0) break;
  }

  // lazily-loaded folders: any folder that came back empty — fetch it directly
  for (const [fid, f] of out.folderIds) {
    if (!f.empty) continue;
    const j = await get(`${BASE}/folder/${fid}?${QS}`);
    if (!j) continue;
    const before = out.endpoints.length + out.pages.length;
    walk(j.folder || j.data || j, f.path.slice(0, -1), out, seen);
    const gained = out.endpoints.length + out.pages.length - before;
    if (gained) console.log(`  folder "${f.name}": +${gained}`);
  }

  if (!out.endpoints.length) { console.error('FAILED: parsed 0 endpoints — the gateway format may have changed'); process.exit(1); }

  // ---- otoDocs.json (viewer + linkifier) ----
  const index = {};
  for (const e of out.endpoints) {
    const p = e.url.replace(/^https?:\/\/[^/]+/, '');           // /rest/v2/createOrder
    for (const k of [p, p.replace(/^\/rest/, ''), p.split('/').pop(), e.name]) {
      if (k) index[String(k).toLowerCase()] = e.id;
    }
  }
  const json = {
    imported_at: new Date().toISOString(),
    source: 'https://apis.tryoto.com (Postman documenter gateway)',
    endpoints: out.endpoints, pages: out.pages, index
  };
  fs.writeFileSync(path.join(OUT_DIR, 'otoDocs.json'), JSON.stringify(json));
  console.log(`otoDocs.json: ${out.endpoints.length} endpoints · ${out.pages.length} guide pages`);

  // ---- OTO_API_DOCS.md (Yusr KB — one heading per endpoint = one KB chunk) ----
  let md = `# OTO Courier API — imported reference (${json.imported_at.slice(0, 10)})\n\n` +
    `Source: apis.tryoto.com. Field mapping to our platform: createOrder "orderId" = ` +
    `delivery_requests.internal_reference_id · "otoId" = external_reference_id · "ref1" = customer nationality id.\n`;
  for (const g of out.pages) md += `\n## OTO guide · ${g.folder} · ${g.name}\n${stripHtml(g.desc).slice(0, 2200)}\n`;
  for (const e of out.endpoints) {
    md += `\n## OTO ${e.method} ${e.url.replace(/^https?:\/\/[^/]+/, '')} — ${e.name}\n` +
      `Folder: ${e.folder}. Docs anchor: https://apis.tryoto.com/#${e.id}\n` +
      `${stripHtml(e.desc).slice(0, 1800)}\n` +
      (e.body ? `Request example:\n${e.body.slice(0, 900)}\n` : '') +
      (e.responses[0] ? `Response ${e.responses[0].status} example:\n${String(e.responses[0].body).slice(0, 700)}\n` : '');
  }
  fs.writeFileSync(path.join(OUT_DIR, 'OTO_API_DOCS.md'), md);
  console.log(`OTO_API_DOCS.md: ${Math.round(md.length / 1024)}KB — Yusr will chunk it by heading`);
  console.log('\nDONE. Now deploy:  cd deploy152 && ./deploy.sh   (full — assist.js reads the md server-side)');
})();
