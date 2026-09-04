/* TAP (UPG) API DOCUMENTATION — in-console reference for the payment gateway behind our
 * payments. Same shape as the OTO courier docs: a group tree on the left, the page on the
 * right, full-text search, deep links (#tapdocs?p=<page id>) and an official-site link.
 *
 * Data: tapDocs.json, produced on a Mac by tools/import-tap-docs.js (152 has no internet) and
 * shipped by deploy.sh. The response-code tables are ALSO compiled into server/src/tapCodes.js
 * so the console can classify a gateway answer even before anyone opens this page.
 */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let DOC = null, cur = null, q = '';

  // "charges" / "create-a-charge" / "docs/webhook" → the imported page id, when we have it
  function resolveSlug(slug) {
    if (!DOC) return null;
    const raw = String(slug || '').replace(/^\.\//, '').replace(/[#?].*$/, '').replace(/^\//, '');
    if (!raw) return null;
    const all = DOC.groups.reduce((a, g) => a.concat(g.pages), []);
    return (all.find(p => p.id === raw) || all.find(p => p.id === 'reference/' + raw) ||
            all.find(p => p.id === 'docs/' + raw) || all.find(p => p.id.endsWith('/' + raw)) || {}).id || null;
  }

  /* --- tiny, safe markdown renderer (no HTML from the source is ever trusted) ------------ */
  function md2html(md) {
    const src = String(md || '');
    const out = []; const lines = src.split('\n');
    let i = 0;
    // ReadMe's markdown carries HTML entities, stray <br /> tags and backslash line-breaks.
    // Decode BEFORE escaping (so "It&#39;s" reads "It's", never "It&39;s"), drop the tags, and
    // resolve Tap's relative doc links to internal pages.
    const deent = t => String(t)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')          // any other raw tag ReadMe left in the prose
      .replace(/&#x20;/g, ' ').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const inline = t => esc(deent(t))
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // relative links inside the docs → open the imported page instead of a dead URL
      .replace(/\[([^\]]+)\]\((?!https?:|#)([^)\s]+)\)/g, (m, txt, slug) => {
        const id = resolveSlug(slug);
        return id ? `<a href="#tapdocs?p=${encodeURIComponent(id)}" data-nav="${esc(id)}">${txt}</a>` : txt;
      })
      .replace(/\\(\s|$)/g, '<br>');                    // "Card ID\ Creation timestamp\" → lines
    while (i < lines.length) {
      const l = lines[i];
      // fenced code
      const f = l.match(/^```(\w*)/);
      if (f) {
        const buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(`<pre class="td-code"><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      // table
      if (/^\s*\|/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        const head = l.split('|').slice(1, -1).map(s => s.trim());
        i += 2; const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++].split('|').slice(1, -1).map(s => s.trim()));
        out.push(`<table class="td-tbl"><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>` +
          rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + `</tbody></table>`);
        continue;
      }
      const h = l.match(/^(#{1,4})\s+(.+)$/);
      if (h) {
        const t = h[2].replace(/\[\]\(#[^)]*\)/g, '').replace(/&#x20;/g, ' ').trim();
        const a = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        out.push(`<h${h[1].length} id="td-${esc(a)}" class="td-h${h[1].length}">${inline(t)}</h${h[1].length}>`); i++; continue;
      }
      if (/^\s*>/.test(l)) {                                     // callout
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<div class="td-note">${inline(buf.join(' ')).replace(/#+\s*/g, '')}</div>`); continue;
      }
      if (/^\s*[-*]\s+/.test(l)) {
        const buf = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
        out.push(`<ul class="td-ul">${buf.map(b => `<li>${inline(b)}</li>`).join('')}</ul>`); continue;
      }
      if (/^\s*\d+\.\s+/.test(l)) {
        const buf = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*\d+\.\s+/, ''));
        out.push(`<ol class="td-ul">${buf.map(b => `<li>${inline(b)}</li>`).join('')}</ol>`); continue;
      }
      if (!l.trim()) { i++; continue; }
      if (/^\s*<hr\s*\/?>\s*$/i.test(l)) { out.push('<hr class="td-hr">'); i++; continue; }
      if (/^\s*<[^>]+>\s*$/.test(l)) { i++; continue; }             // any tag-only line (br, div, img…)
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*]\s|\s*\d+\.\s|\s*\||\s*>|```|\s*<[^>]+>\s*$)/i.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
    return out.join('\n');
  }

  function cssOnce() {
    if (document.getElementById('tdCss')) return;
    const s = document.createElement('style'); s.id = 'tdCss';
    s.textContent = `
#view-tapdocs .td-wrap{display:grid;grid-template-columns:290px 1fr;gap:16px;align-items:start}
@media(max-width:1000px){#view-tapdocs .td-wrap{grid-template-columns:1fr}}
.td-side{border:1px solid var(--line);border-radius:12px;background:var(--card,#fff);padding:10px;
  max-height:calc(100vh - 190px);overflow:auto;position:sticky;top:78px}
.td-search{width:100%;font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:9px;
  background:var(--bg,#fff);color:inherit;margin-bottom:8px}
.td-grp{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);
  margin:10px 0 4px;padding-left:6px}
.td-item{display:block;width:100%;text-align:left;border:0;background:transparent;cursor:pointer;
  font:inherit;font-size:12px;padding:5px 8px;border-radius:7px;color:inherit;line-height:1.3}
.td-item:hover{background:var(--bg,#f1f5f9)}
.td-item.on{background:var(--blue);color:#fff;font-weight:700}
.td-item .k{font-size:9px;opacity:.7;text-transform:uppercase;margin-left:5px}
.td-main{border:1px solid var(--line);border-radius:12px;background:var(--card,#fff);padding:16px 20px 22px;
  max-height:calc(100vh - 190px);overflow:auto}
.td-crumb{font-size:11px;color:var(--muted);margin-bottom:2px}
.td-title{font-size:20px;font-weight:800;margin:0 0 4px}
.td-desc{font-size:12.5px;color:var(--muted);margin-bottom:8px}
.td-meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11px;color:var(--muted);
  border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:12px}
.td-meta a{color:var(--blue);font-weight:700;text-decoration:none}
.td-main a{color:var(--blue);text-decoration:none}
.td-main a:hover{text-decoration:underline}
.td-hr{border:0;border-top:1px solid var(--line);margin:14px 0}
.td-h1{font-size:17px;font-weight:800;margin:18px 0 6px}
.td-h2{font-size:15px;font-weight:800;margin:16px 0 6px}
.td-h3{font-size:13.5px;font-weight:700;margin:14px 0 5px}
.td-h4{font-size:12.5px;font-weight:700;margin:12px 0 4px}
#view-tapdocs p{font-size:12.5px;line-height:1.65;margin:6px 0}
.td-ul{font-size:12.5px;line-height:1.65;margin:6px 0 6px 18px}
.td-code{background:#0f172a;color:#e2e8f0;border-radius:9px;padding:12px 14px;overflow-x:auto;
  font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.6;margin:8px 0;max-height:420px}
#view-tapdocs code{background:var(--bg,#f1f5f9);border-radius:4px;padding:1px 5px;
  font-family:ui-monospace,Menlo,monospace;font-size:11.5px}
#view-tapdocs .td-code code{background:transparent;color:inherit;padding:0;font-size:11px;white-space:pre}
.td-tbl{width:100%;border-collapse:collapse;font-size:11.5px;margin:8px 0}
.td-tbl th{text-align:left;background:var(--bg,#f8fafc);border:1px solid var(--line);padding:6px 8px;
  font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.td-tbl td{border:1px solid var(--line);padding:5px 8px;vertical-align:top}
.td-note{border-left:3px solid var(--blue);background:var(--bg,#f8fafc);border-radius:0 8px 8px 0;
  padding:8px 12px;font-size:12px;margin:8px 0;color:var(--muted)}
.td-empty{border:1px dashed var(--line);border-radius:12px;padding:22px;text-align:center;color:var(--muted);font-size:13px}
.td-empty code{display:inline-block;margin-top:8px}
.td-cls{display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;color:#fff;
  border-radius:4px;padding:1px 6px;margin-left:6px}`;
    document.head.appendChild(s);
  }

  const pages = () => (DOC ? DOC.groups.reduce((a, g) => a.concat(g.pages), []) : []);
  function match(p) {
    if (!q) return true;
    const s = q.toLowerCase();
    return (p.title + ' ' + (p.desc || '') + ' ' + p.id).toLowerCase().includes(s) ||
      String(p.body || '').toLowerCase().includes(s);
  }
  function sideHtml() {
    const groups = DOC.groups.map(g => {
      const ps = g.pages.filter(match);
      if (!ps.length) return '';
      return `<div class="td-grp">${esc(g.name)}</div>` + ps.map(p =>
        `<button class="td-item ${cur && cur.id === p.id ? 'on' : ''}" data-p="${esc(p.id)}">${esc(p.title)}
          ${p.kind === 'reference' ? '<span class="k">api</span>' : ''}</button>`).join('');
    }).join('');
    return `<input class="td-search" id="tdQ" placeholder="Search Tap docs…" value="${esc(q)}">${groups ||
      '<div class="td-grp">no page matches</div>'}`;
  }
  function pageHtml(p) {
    if (!p) return `<div class="td-empty">Pick a page on the left.</div>`;
    return `<div class="td-crumb">${esc(p.group)}</div>
      <h1 class="td-title">${esc(p.title)}</h1>
      ${p.desc ? `<div class="td-desc">${esc(p.desc)}</div>` : ''}
      <div class="td-meta">
        <a href="${esc(p.url)}" target="_blank" rel="noopener">open on developers.tap.company ↗</a>
        <span>·</span><span>${esc(p.kind === 'reference' ? 'API reference' : 'guide')}</span>
        ${p.updated ? `<span>·</span><span>updated ${esc(String(p.updated).slice(0, 10))}</span>` : ''}
        <span>·</span><span class="mono">${esc(p.id)}</span>
      </div>
      ${md2html(p.body)}`;
  }
  function render(host) {
    host.innerHTML = `<div class="td-wrap"><div class="td-side">${sideHtml()}</div>
      <div class="td-main" id="tdMain">${pageHtml(cur)}</div></div>`;
    wireLinks(host);
    const qi = host.querySelector('#tdQ');
    if (qi) {
      qi.addEventListener('input', () => { q = qi.value; const side = host.querySelector('.td-side');
        side.innerHTML = sideHtml(); wireSide(host); const n = side.querySelector('#tdQ');
        n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    }
    wireSide(host);
  }
  function wireLinks(host) {
    host.querySelectorAll('.td-main a[data-nav]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      const p = pages().find(x => x.id === a.dataset.nav); if (!p) return;
      cur = p; const m = host.querySelector('#tdMain'); m.innerHTML = pageHtml(cur); m.scrollTop = 0;
      host.querySelectorAll('.td-item').forEach(b => b.classList.toggle('on', b.dataset.p === p.id));
      wireLinks(host);
      try { location.hash = '#tapdocs?p=' + encodeURIComponent(p.id); } catch (_) { }
    }));
  }
  function wireSide(host) {
    host.querySelectorAll('.td-item').forEach(b => b.addEventListener('click', () => {
      cur = pages().find(p => p.id === b.dataset.p) || null;
      host.querySelectorAll('.td-item').forEach(x => x.classList.toggle('on', x === b));
      const m = host.querySelector('#tdMain'); m.innerHTML = pageHtml(cur); m.scrollTop = 0;
      wireLinks(host);
      try { location.hash = '#tapdocs?p=' + encodeURIComponent(cur.id); } catch (_) { }
    }));
    const qi = host.querySelector('#tdQ');
    if (qi) qi.addEventListener('input', () => { });
  }

  window.tapDocsRender = async function (host) {
    cssOnce();
    if (!DOC) {
      host.innerHTML = `<div class="td-empty">loading Tap documentation…</div>`;
      try {
        const r = await fetch('tapDocs.json', { cache: 'no-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        DOC = await r.json();
      } catch (e) {
        host.innerHTML = `<div class="td-empty"><b>Tap documentation has not been imported yet.</b>
          <p>It is fetched from developers.tap.company, which server 152 cannot reach — so the import runs on a Mac and the file ships with the console.</p>
          <code>cd mvno-console &amp;&amp; node tools/import-tap-docs.js</code>
          <p>then <code>./deploy152/deploy.sh</code> and reload this page.</p>
          <div class="td-desc">(${esc(e.message)})</div></div>`;
        return;
      }
    }
    // deep link: #tapdocs?p=reference/create-a-charge
    const m = String(location.hash || '').match(/[?&]p=([^&]+)/);
    if (m) { const want = decodeURIComponent(m[1]); cur = pages().find(p => p.id === want) || cur; }
    if (!cur) cur = pages().find(p => /charge-response-codes/.test(p.id)) || pages()[0] || null;
    render(host);
  };

  document.querySelectorAll('.navtab').forEach(b => {
    if (b.dataset.view === 'tapdocs') b.addEventListener('click', () => {
      const host = document.getElementById('view-tapdocs'); if (host) window.tapDocsRender(host);
    });
  });
  window.openTapDocs = () => { const h = document.getElementById('view-tapdocs'); if (h) window.tapDocsRender(h); };

  /* Turn a Tap identifier or endpoint mentioned anywhere in the console into a link to the doc
   * page that explains it — chg_/tok_/cus_ prefixes, /v2/charges paths, and bare codes. */
  window.tapDoc = {
    ready: () => !!DOC,
    page: id => pages().find(p => p.id === id) || null,
    linkify: text => String(text || '')
      .replace(/\b(v2\/(charges|refunds|tokens|customers|invoices|authorize|intents))\b/g,
        '<a href="#tapdocs?p=reference/' + '$2' + '">$1</a>')
      .replace(/\bchg_[A-Za-z0-9]+/g, m => `<a href="#tapdocs?p=reference/charges">${m}</a>`),
  };
})();
