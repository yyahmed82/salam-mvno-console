/* execops.js — Executive and Operations pages, ONE renderer for six routes (12 Sep 2026)
 *
 *   Fixed  › Executive / Operations   FIXED_PAGES.exec / .ops        /api/fixed/exec
 *   Mobile › Executive / Operations   #mobile-exec / #mobile-ops     /api/mvno/exec
 *   Home   › Executive / Operations   #exec / #ops                   /api/exec  (both businesses, badged)
 *
 * The server hands every page the same execContract shape; this file knows nothing about either business.
 * UX rules baked in (the review of the first Fixed › Operations cut):
 *   · every tile is a link to the page where you act on it — a number you cannot click is a dead end
 *   · every KPI states its window (24 h / 7 d) — the first cut mixed windows on one row
 *   · pipeline steps are humanised and carry their share, not raw enum names
 *   · one kicker + title per section, no emoji noise; the console's own glyphs and tokens throughout
 *   · charts share one scale style, tooltips on every point, a labelled budget line
 *   · unified pages badge every tile with its business and put the same measure side by side
 *   · auto-refresh every 5 min while visible, manual refresh, "updated hh:mm" — like a real board
 *   · light + dark from tokens, RTL, phone-first grid, print keeps tiles whole */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const num = v => typeof v === 'number' ? v.toLocaleString('en-US') : esc(v);
  const TOK = { green: 'var(--green,#0e9f5a)', amber: '#d97706', red: '#dc2626', blue: '#2563eb', muted: 'var(--muted)', line: 'var(--line)', ink: 'var(--ink)' };
  const SEV = { CRITICAL: TOK.red, WARNING: TOK.amber, HEALTHY: TOK.green };
  const KSA = 3 * 3600e3;
  const ts = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? esc(v) : new Date(d.getTime() + KSA).toISOString().replace('T', ' ').slice(0, 16); };
  const hm = v => ts(v).slice(11);
  const api = p => fetch((window.API_BASE || window.CONSOLE_BASE || '') + p, { headers: { 'Content-Type': 'application/json' } }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });

  /* ---------- state ---------- */
  const state = { range: localStorage.getItem('exec_range') === '30d' ? '30d' : '7d' };
  const cache = {};                                  // url → {at, data, promise}
  async function load(url, force) {
    const c = cache[url] || (cache[url] = {});
    if (!force && c.data && Date.now() - c.at < 60e3) return c.data;
    if (c.promise) return c.promise;
    c.promise = api(url).then(d => { c.data = d; c.at = Date.now(); c.promise = null; return d; }, e => { c.promise = null; throw e; });
    return c.promise;
  }
  const SRC = { fixed: '/api/fixed/exec', mobile: '/api/mvno/exec', all: '/api/exec' };

  /* ---------- SVG charts ---------- */
  const W = 600, H = 210, PL = 36, PR = 10, PT = 12, PB = 26;
  const color = c => TOK[c] || c;
  const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  const yS = max => v => PT + (H - PT - PB) * (1 - (max ? v / max : 0));
  const xS = nPts => i => PL + (W - PL - PR) * (nPts > 1 ? i / (nPts - 1) : 0.5);
  const fmtTick = v => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(Math.round(v));
  const grid = max => [0, .5, 1].map(f => { const y = yS(max)(max * f); return `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" stroke="${TOK.line}"/><text x="${PL - 6}" y="${y + 4}" font-size="10" fill="${TOK.muted}" text-anchor="end">${fmtTick(max * f)}</text>`; }).join('');
  const xLab = days => { const step = days.length > 12 ? Math.ceil(days.length / 8) : 1; const xs = xS(days.length); return days.map((d, i) => (i % step === 0 || i === days.length - 1) ? `<text x="${xs(i)}" y="${H - 8}" font-size="10" fill="${TOK.muted}" text-anchor="middle">${d.day.slice(5)}</text>` : '').join(''); };
  const svg = (inner, label, h) => `<svg viewBox="0 0 ${W} ${h || H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}" class="xo-svg">${inner}</svg>`;
  function chart(ch, days) {
    const vals = days.map(d => Number(d[ch.field] || 0)), max = niceMax(Math.max(...vals, ch.threshold || 0, 1)), ys = yS(max), xs = xS(days.length);
    if (ch.type === 'line') {
      const col = color(ch.color), pts = vals.map((v, i) => `${xs(i)},${ys(v)}`).join(' ');
      return svg(`${grid(max)}<polygon points="${PL},${ys(0)} ${pts} ${xs(days.length - 1)},${ys(0)}" fill="${col}" opacity=".10"/><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>${vals.map((v, i) => `<circle cx="${xs(i)}" cy="${ys(v)}" r="3.5" fill="${col}"><title>${days[i].day}: ${num(v)}</title></circle>`).join('')}${xLab(days)}`, ch.title);
    }
    const bw = Math.max(6, (W - PL - PR) / days.length * 0.6), thr = ch.threshold || 0;
    const colOf = v => ch.color === 'auto' ? (thr && v >= thr ? TOK.red : thr && v >= thr * 0.6 ? TOK.amber : TOK.green) : color(ch.color);
    const bars = vals.map((v, i) => `<rect x="${xs(i) - bw / 2}" y="${ys(v)}" width="${bw}" height="${Math.max(0, ys(0) - ys(v))}" rx="3" fill="${colOf(v)}"><title>${days[i].day}: ${num(v)}</title></rect>`).join('');
    const line = thr ? `<line x1="${PL}" x2="${W - PR}" y1="${ys(thr)}" y2="${ys(thr)}" stroke="${TOK.red}" stroke-width="2" stroke-dasharray="6 5"/><text x="${W - PR - 4}" y="${ys(thr) - 5}" font-size="10" fill="${TOK.red}" text-anchor="end" font-weight="700">${esc(ch.thresholdLabel || '')}</text>` : '';
    return svg(`${grid(max)}${bars}${line}${xLab(days)}`, ch.title);
  }
  function hbars(rows, label) {
    const rh = 24, lw = 230, h = Math.max(56, rows.length * rh + 10), max = Math.max(...rows.map(r => r.n), 1);
    return svg(rows.map((r, i) => { const y = 5 + i * rh, w = (W - lw - 70) * r.n / max;
      return `<text x="${lw - 8}" y="${y + 16}" font-size="11" fill="${TOK.ink}" text-anchor="end">${esc(r.label.length > 32 ? r.label.slice(0, 31) + '…' : r.label)}</text><rect x="${lw}" y="${y + 4}" width="${Math.max(2, w)}" height="${rh - 9}" rx="3" fill="${color(r.tone || 'blue')}"><title>${esc(r.label)}: ${num(r.n)} (${r.share}%)</title></rect><text x="${lw + w + 6}" y="${y + 16}" font-size="11" fill="${TOK.muted}" font-weight="700">${num(r.n)} · ${r.share}%</text>`; }).join(''), label, h);
  }
  const spark = (vals, col) => { const w = 100, h = 26, max = Math.max(...vals, 1); const pts = vals.map((v, i) => `${(i / Math.max(vals.length - 1, 1)) * w},${h - 3 - (h - 6) * v / max}`).join(' '); return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="xo-spark"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2"/></svg>`; };

  /* ---------- pieces ---------- */
  const badge = (h, unified) => unified ? `<span class="xo-biz xo-biz-${h.biz}">${esc(h.label)}</span>` : '';
  const wrapA = (href, cls, inner, title) => href ? `<a href="${esc(href)}" class="${cls}" title="${esc(title || 'open')}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
  const sec = (kicker, title, right) => `<div class="xo-sec"><div><div class="xo-kick">${esc(kicker)}</div><h3 class="xo-title">${title}</h3></div>${right ? `<div class="xo-dim">${right}</div>` : ''}</div>`;
  const statusPill = s => `<span class="xo-status" style="--c:${SEV[s] || TOK.muted}"><i></i>${esc(s)}</span>`;
  const trend = t => t === 'improving' ? `<span class="xo-tr" style="color:${TOK.green}">▼ improving</span>` : t === 'worsening' ? `<span class="xo-tr" style="color:${TOK.red}">▲ worsening</span>` : `<span class="xo-tr" style="color:${TOK.muted}">→ stable</span>`;
  const kpiTile = (k, h, unified) => wrapA(k.href, `xo-kpi xo-t-${k.tone || 'none'}`, `
      <div class="xo-kh"><span class="xo-kt">${esc(k.title)}</span><span class="xo-win">${badge(h, unified)}${esc(k.window || '')}</span></div>
      <div class="xo-kv">${num(k.value)}</div>
      <div class="xo-ks">${esc(k.sub || '')}</div>
      ${k.delta ? `<div class="xo-kd" style="color:${k.delta.pct === 0 ? TOK.muted : k.delta.good ? TOK.green : TOK.red}">${k.delta.pct > 0 ? '+' : ''}${k.delta.pct}% vs previous 24 h</div>` : ''}`, k.href ? 'open ' + k.title : '');
  const sloTile = (s, h, unified) => wrapA(s.href, `xo-slo ${s.measured ? (s.ok ? 'ok' : 'breach') : 'nowire'}`, `
      <div class="xo-si">${s.measured ? (s.ok ? '✓' : '✕') : '○'}</div>
      <div class="xo-sn">${badge(h, unified)}${esc(s.name)}</div>
      <div class="xo-sa">${esc(s.actual)}</div>
      <div class="xo-st">${s.measured ? 'target ' + esc(s.target) : esc(s.note || 'not wired')}</div>`);
  const healthTile = (x, h, unified) => wrapA(x.href, `xo-hi xo-h-${x.state}`, `<div class="xo-hl">${badge(h, unified)}${esc(x.label)}</div><div class="xo-hv"><i></i>${esc(x.value)}</div><div class="xo-hs">${esc(x.sub || '')}</div>`);
  const chartCard = (ch, h, unified) => `<div class="topo-card xo-chart"><div class="xo-ct">${badge(h, unified)}${esc(ch.title)}<span class="xo-dim"> · ${h.days} d</span></div>${chart(ch, h.series.days)}</div>`;
  const issuesRows = (h, unified) => h.issues.map(i => `<tr><td><span class="xo-sev ${i.sev}">${i.sev}</span></td><td>${badge(h, unified)}<b>${esc(i.label)}</b></td><td class="xo-num">${num(i.open)} / ${num(i.total)}</td><td>${ts(i.first_seen).slice(0, 10)}<div class="xo-dim">${i.daysOngoing} d ongoing</div></td><td>${trend(i.trend)}${spark(i.spark, i.sev === 'critical' ? TOK.red : i.sev === 'warning' ? TOK.amber : TOK.blue)}</td><td><a href="${esc(i.href)}" class="xo-link">act →</a></td></tr>`).join('');
  const alertRows = (h, unified) => h.alerts.map(a => { const cls = a.severity === 'P1' ? 'critical' : a.severity === 'P2' ? 'warning' : 'info';
    return `<a href="${esc(a.href)}" class="xo-al ${cls}"><span class="xo-sev ${cls}">${esc(a.severity)}</span><div class="xo-at">${badge(h, unified)}<b>${esc(a.name)}</b>${a.text ? ` — ${esc(a.text)}` : ''}${a.team ? `<span class="xo-dim"> · ${esc(a.team)}</span>` : ''}</div><span class="xo-dim">${a.status === 'open' ? 'open · ' : ''}${ts(a.at)}</span></a>`; }).join('');

  /* ---------- pages ---------- */
  function head(title, sub, halves, mode) {
    const status = halves.length === 1 ? halves[0].status : halves.reduce((w, h) => ({ CRITICAL: 3, WARNING: 2, HEALTHY: 1 }[h.status] > { CRITICAL: 3, WARNING: 2, HEALTHY: 1 }[w] ? h.status : w), 'HEALTHY');
    const c = halves.reduce((a, h) => ({ critical: a.critical + h.counts.critical, warnings: a.warnings + h.counts.warnings, alerts24: a.alerts24 + h.counts.alerts24 }), { critical: 0, warnings: 0, alerts24: 0 });
    return `<div class="xo-head"><div><div class="xo-kick">${halves.map(h => h.label).join(' + ')} · ${mode === 'exec' ? 'executive overview' : 'operations'}</div><h2 class="xo-h">${title}</h2><div class="xo-meta">${sub}</div></div>
      <div class="xo-tools">${statusPill(status)}<span class="xo-dim">${c.critical} critical · ${c.warnings} warning · ${c.alerts24} alert(s) in 24 h</span>
        <span class="xo-range">${['7d', '30d'].map(r => `<button type="button" class="xo-r${state.range === r ? ' on' : ''}" data-r="${r}">${r}</button>`).join('')}</span>
        <button type="button" class="xo-btn" data-act="refresh" title="refresh now">↻ <span class="xo-upd">updated ${hm(new Date())}</span></button></div></div>`;
  }
  function renderExec(host, halves, unified) {
    const days = halves[0].days;
    host.innerHTML = `${head('Executive overview', `north-star KPIs · SLO compliance · trends · top ongoing issues · last 24 h, trends ${days} d, KSA`, halves, 'exec')}
      ${sec('summary', 'What matters today')}
      <div class="xo-sumgrid">${halves.map(h => `<div class="xo-summary" style="--c:${SEV[h.status]}">${unified ? `<div class="xo-sumh">${badge(h, true)}${statusPill(h.status)}</div>` : ''}${h.summary.map(s => `<div>${esc(s)}</div>`).join('')}</div>`).join('')}</div>
      ${sec('north-star', 'Key indicators', 'click a tile to open its page')}
      <div class="xo-grid">${halves.flatMap(h => h.kpis.filter(k => k.exec).map(k => kpiTile(k, h, unified))).join('')}</div>
      ${sec('slo', 'SLO compliance', '○ = not measured by this console')}
      <div class="xo-slos">${halves.flatMap(h => h.slos.map(s => sloTile(s, h, unified))).join('')}</div>
      ${sec('trends', 'Trends', `${days} days · KSA`)}
      <div class="xo-charts">${halves.flatMap(h => h.series.charts.filter(c => c.exec).map(c => chartCard(c, h, unified))).join('')}</div>
      ${sec('issues', 'Top ongoing issues', 'open in window · sorted by open count')}
      <div class="topo-card xo-tblwrap">${halves.some(h => h.issues.length) ? `<div class="tscroll"><table class="xo-tbl"><thead><tr><th>Severity</th><th>Issue</th><th>Open / total</th><th>First seen</th><th>Trend</th><th></th></tr></thead><tbody>${halves.flatMap(h => h.issues.map(i => ({ h, i }))).sort((a, b) => b.i.open - a.i.open).map(({ h, i }) => issuesRows({ ...h, issues: [i] }, unified)).join('')}</tbody></table></div>` : `<div class="xo-empty">No open issue in this window.</div>`}</div>
      <div class="xo-foot">${halves.map(h => `${h.label}: ${esc(h.provisional)} · source ${esc(h.source || '—')} · ${esc(h.freshness.text)}`).join('<br>')}</div>`;
  }
  function renderOps(host, halves, unified) {
    const days = halves[0].days;
    const sev = halves.reduce((a, h) => ({ P1: a.P1 + (h.counts.bySeverity.P1 || 0), P2: a.P2 + (h.counts.bySeverity.P2 || 0), P3: a.P3 + (h.counts.bySeverity.P3 || 0) }), { P1: 0, P2: 0, P3: 0 });
    host.innerHTML = `${head('Operations', `health · key indicators · trends · pipeline · alerts · last 24 h, trends ${days} d, KSA`, halves, 'ops')}
      <div class="xo-pills"><span class="xo-pill critical">P1 · ${sev.P1}</span><span class="xo-pill warning">P2 · ${sev.P2}</span><span class="xo-pill info">P3 · ${sev.P3}</span><span class="xo-dim">alerts fired in ${days} d</span></div>
      ${sec('health', 'System health', 'click a tile to open its page')}
      <div class="xo-health">${halves.flatMap(h => h.health.map(x => healthTile(x, h, unified))).join('')}</div>
      ${sec('indicators', 'Key indicators')}
      <div class="xo-grid">${halves.flatMap(h => h.kpis.filter(k => k.key !== 'availability' && k.key !== 'revenue').map(k => kpiTile(k, h, unified))).join('')}</div>
      ${sec('trends', 'Trends & analytics', `${days} days · KSA`)}
      <div class="xo-charts">${halves.flatMap(h => h.series.charts.map(c => chartCard(c, h, unified))).join('')}</div>
      ${halves.map(h => `${sec('pipeline', `${unified ? h.label + ' · ' : ''}${esc(h.pipeline.title)}`, esc(h.pipeline.sub))}<div class="topo-card xo-chart">${h.pipeline.rows.length ? hbars(h.pipeline.rows, h.pipeline.title) : `<div class="xo-empty">Nothing stopped in this window.</div>`}<div class="xo-dim" style="margin-top:6px"><a href="${esc(h.pipeline.href)}" class="xo-link">open ${esc(h.label)} detail →</a></div></div>`).join('')}
      ${sec('alerts', 'Alerts', `open first · fired in ${days} d`)}
      <div class="topo-card xo-tblwrap">${halves.some(h => h.alerts.length) ? halves.flatMap(h => h.alerts.map(a => ({ h, a }))).sort((x, y) => (y.a.status === 'open') - (x.a.status === 'open') || new Date(y.a.at) - new Date(x.a.at)).map(({ h, a }) => alertRows({ ...h, alerts: [a] }, unified)).join('') : `<div class="xo-empty">No alert fired in this window.</div>`}</div>
      <div class="xo-foot">${halves.map(h => `${h.label}: ${esc(h.provisional)} · source ${esc(h.source || '—')} · ${esc(h.freshness.text)}`).join('<br>')}</div>`;
  }

  let timer = null;
  async function page(host, biz, tab, force) {
    ensureCss();
    if (!host.dataset.loaded) host.innerHTML = `<div class="xo-loading">Loading…</div>`;
    let d; try { d = await load(`${SRC[biz]}?range=${state.range}`, force); } catch (e) { host.innerHTML = `<div class="topo-card xo-err"><b>Could not load</b><div class="xo-dim">${esc(e.message)}</div></div>`; return; }
    const halves = biz === 'all' ? [d.mobile, d.fixed].filter(h => h && h.configured) : (d.configured ? [d] : []);
    if (!halves.length) { host.innerHTML = `<div class="topo-card xo-err"><b>Nothing to show</b><div class="xo-dim">${esc((d.reason) || (d.mobile && d.mobile.reason) || (d.fixed && d.fixed.reason) || 'no business configured for your role')}</div></div>`; return; }
    (tab === 'ops' ? renderOps : renderExec)(host, halves, biz === 'all');
    host.dataset.loaded = '1';
    host.querySelectorAll('.xo-r').forEach(b => b.onclick = () => { state.range = b.dataset.r; localStorage.setItem('exec_range', state.range); page(host, biz, tab, true); });
    const rb = host.querySelector('[data-act="refresh"]'); if (rb) rb.onclick = () => page(host, biz, tab, true);
    clearTimeout(timer); timer = setTimeout(() => { if (host.isConnected && !document.hidden) page(host, biz, tab, true); }, 300e3);
  }

  /* ---------- Fixed hub pages ---------- */
  window.FIXED_PAGES = window.FIXED_PAGES || {};
  window.FIXED_PAGES.exec = { label: 'Executive', sub: 'north-star KPIs · SLOs · top issues', render: host => page(host, 'fixed', 'exec') };
  window.FIXED_PAGES.ops  = { label: 'Operations', sub: 'health · trends · pipeline · alerts', render: host => page(host, 'fixed', 'ops') };

  /* ---------- standalone view: Home › Executive/Operations and Mobile › Executive/Operations ---------- */
  window.openExecOps = function (biz, tab) {
    const host = $('#view-execops'); if (!host) return;
    biz = biz === 'mobile' ? 'mobile' : 'all'; tab = tab === 'ops' ? 'ops' : 'exec';
    const want = biz === 'all' ? tab : `mobile-${tab}`;
    document.querySelectorAll('.navtab[data-view="execops"]').forEach(b => b.classList.toggle('active', b.dataset.hash === want));
    document.querySelectorAll('.navtab:not([data-view="execops"]).active').forEach(b => b.classList.remove('active'));
    if (window.navdropSync) window.navdropSync();
    page(host, biz, tab);
  };

  function ensureCss() {
    if ($('#xoCss')) return;
    const st = document.createElement('style'); st.id = 'xoCss';
    st.textContent = `
      #view-execops{padding:14px 18px 30px;max-width:1500px;margin:0 auto}
      .xo-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin:4px 0 12px}
      .xo-kick{font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);font-weight:800}
      .xo-h{margin:2px 0 0;font-size:20px;letter-spacing:-.2px}.xo-meta{font-size:11.5px;color:var(--muted);margin-top:3px}
      .xo-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .xo-status{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:999px;font-weight:800;font-size:12px;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent);border:1px solid color-mix(in srgb,var(--c) 35%,transparent)}
      .xo-status i{width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 25%,transparent)}
      .xo-range{display:inline-flex;gap:4px}.xo-r,.xo-btn{cursor:pointer;font:inherit;font-size:11.5px;font-weight:700;padding:5px 11px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:inherit;transition:border-color .15s,background .15s}
      .xo-r.on{background:var(--green,#0e9f5a);border-color:var(--green,#0e9f5a);color:#fff}.xo-r:hover,.xo-btn:hover{border-color:var(--green,#0e9f5a)}
      .xo-sec{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;margin:22px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
      .xo-title{margin:0;font-size:14px}.xo-dim{font-size:11px;color:var(--muted);font-weight:600}
      .xo-biz{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding:2px 7px;border-radius:999px;margin-right:6px;vertical-align:middle;border:1px solid transparent}
      .xo-biz-mobile{color:#2563eb;background:color-mix(in srgb,#2563eb 12%,transparent);border-color:color-mix(in srgb,#2563eb 30%,transparent)}
      .xo-biz-fixed{color:var(--green,#0e9f5a);background:color-mix(in srgb,var(--green,#0e9f5a) 12%,transparent);border-color:color-mix(in srgb,var(--green,#0e9f5a) 30%,transparent)}
      .xo-sumgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
      .xo-summary{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:12px;padding:14px 18px;font-size:13.5px;line-height:1.55}
      .xo-summary div+div{margin-top:5px}.xo-sumh{display:flex;align-items:center;gap:8px;margin-bottom:8px}
      .xo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
      .xo-kpi{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-top:4px solid var(--line);border-radius:12px;padding:12px 14px;transition:box-shadow .2s,transform .2s,border-color .2s}
      a.xo-kpi:hover{transform:translateY(-1px);box-shadow:var(--shadow,0 10px 26px rgba(15,23,42,.10));border-color:color-mix(in srgb,var(--line) 50%,var(--green,#0e9f5a))}
      .xo-t-red{border-top-color:#dc2626}.xo-t-amber{border-top-color:#d97706}.xo-t-green{border-top-color:var(--green,#0e9f5a)}.xo-t-muted{opacity:.75;border-top-style:dashed}
      .xo-kh{display:flex;justify-content:space-between;align-items:center;gap:6px}
      .xo-kt{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;font-weight:800}
      .xo-win{font-size:10px;color:var(--muted);font-weight:700;white-space:nowrap}
      .xo-kv{font-size:28px;font-weight:800;line-height:1.15;margin:8px 0 3px;font-variant-numeric:tabular-nums}
      .xo-t-red .xo-kv{color:#dc2626}.xo-t-amber .xo-kv{color:#d97706}.xo-t-green .xo-kv{color:var(--green,#0e9f5a)}.xo-t-muted .xo-kv{color:var(--muted)}
      .xo-ks{font-size:11.5px;color:var(--muted);line-height:1.4}.xo-kd{font-size:11px;font-weight:700;margin-top:6px}
      .xo-slos{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
      .xo-slo{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;padding:12px;text-align:center;transition:box-shadow .2s,transform .2s}
      a.xo-slo:hover{transform:translateY(-1px);box-shadow:var(--shadow,0 10px 26px rgba(15,23,42,.10))}
      .xo-slo.ok{border-left-color:var(--green,#0e9f5a)}.xo-slo.breach{border-left-color:#dc2626}.xo-slo.nowire{opacity:.7;border-left-style:dashed}
      .xo-si{font-size:18px;font-weight:800}.xo-slo.ok .xo-si{color:var(--green,#0e9f5a)}.xo-slo.breach .xo-si{color:#dc2626}.xo-slo.nowire .xo-si{color:var(--muted)}
      .xo-sn{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:800;margin:4px 0}
      .xo-sa{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}.xo-st{font-size:10.5px;color:var(--muted);margin-top:3px}
      .xo-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px}
      .xo-chart{padding:12px 14px}.xo-ct{font-size:12.5px;font-weight:800;margin-bottom:6px}.xo-svg{width:100%;height:auto;display:block;font-family:inherit}
      .xo-health{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
      .xo-hi{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;transition:box-shadow .2s,transform .2s}
      a.xo-hi:hover{transform:translateY(-1px);box-shadow:var(--shadow,0 10px 26px rgba(15,23,42,.10))}
      .xo-hl{font-size:10.5px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
      .xo-hv{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:7px}.xo-hv i{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}
      .xo-h-up .xo-hv i{background:var(--green,#0e9f5a)}.xo-h-down .xo-hv i{background:#dc2626}.xo-h-warn .xo-hv i{background:#d97706}.xo-h-nowire{opacity:.7;border-style:dashed}.xo-h-nowire .xo-hv{color:var(--muted);font-weight:600;font-style:italic}
      .xo-hs{font-size:10.5px;color:var(--muted);margin-top:3px}
      .xo-tblwrap{padding:10px 12px}.xo-tbl{width:100%;border-collapse:collapse;font-size:12px}.xo-tbl th{text-align:left;padding:8px 10px;color:var(--muted);font-size:10px;letter-spacing:.6px;text-transform:uppercase;border-bottom:1px solid var(--line)}
      .xo-tbl td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}.xo-tbl tr:last-child td{border-bottom:0}.xo-num{font-variant-numeric:tabular-nums;white-space:nowrap}
      .xo-sev{display:inline-block;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:800;text-transform:uppercase;white-space:nowrap}
      .xo-sev.critical{color:#dc2626;background:color-mix(in srgb,#dc2626 14%,transparent)}.xo-sev.warning{color:#d97706;background:color-mix(in srgb,#d97706 14%,transparent)}.xo-sev.info{color:#2563eb;background:color-mix(in srgb,#2563eb 14%,transparent)}
      .xo-tr{font-size:11px;display:block;margin-bottom:2px}.xo-spark{display:block}
      .xo-link{color:var(--green,#0e9f5a);font-weight:700;text-decoration:none;white-space:nowrap}.xo-link:hover{text-decoration:underline}
      .xo-pills{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:2px 0 4px}
      .xo-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:8px;font-weight:800;font-size:12px;border:1px solid transparent}
      .xo-pill.critical{color:#dc2626;background:color-mix(in srgb,#dc2626 12%,transparent);border-color:color-mix(in srgb,#dc2626 30%,transparent)}
      .xo-pill.warning{color:#d97706;background:color-mix(in srgb,#d97706 12%,transparent);border-color:color-mix(in srgb,#d97706 30%,transparent)}
      .xo-pill.info{color:#2563eb;background:color-mix(in srgb,#2563eb 12%,transparent);border-color:color-mix(in srgb,#2563eb 30%,transparent)}
      .xo-al{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:8px;border-left:4px solid var(--line);margin-bottom:6px;background:var(--bg);text-decoration:none;color:inherit;transition:transform .15s}
      .xo-al:hover{transform:translateX(2px)}.xo-al.critical{border-left-color:#dc2626}.xo-al.warning{border-left-color:#d97706}.xo-al.info{border-left-color:#2563eb}
      .xo-at{flex:1;font-size:12.5px;min-width:0}
      .xo-empty{padding:22px;text-align:center;color:var(--muted);font-style:italic}.xo-loading{padding:30px;text-align:center;color:var(--muted)}
      .xo-err{padding:18px;border-left:4px solid #dc2626}
      .xo-foot{margin:20px 0 6px;font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px;line-height:1.6}
      html[dir=rtl] .xo-summary,html[dir=rtl] .xo-slo,html[dir=rtl] .xo-al{border-left:1px solid var(--line);border-right:4px solid var(--c,var(--line))}
      html[dir=rtl] .xo-tbl th,html[dir=rtl] .xo-tbl td{text-align:right}html[dir=rtl] .xo-biz{margin-right:0;margin-left:6px}
      @media (max-width:720px){.xo-grid{grid-template-columns:repeat(2,1fr)}.xo-kv{font-size:22px}.xo-charts,.xo-sumgrid{grid-template-columns:1fr}.xo-h{font-size:17px}.xo-slos,.xo-health{grid-template-columns:repeat(2,1fr)}#view-execops{padding:10px 12px 24px}}
      @media (max-width:420px){.xo-grid,.xo-slos,.xo-health{grid-template-columns:1fr}}
      @media print{.xo-tools,.xo-range{display:none}.xo-kpi,.xo-slo,.xo-chart,.xo-hi{break-inside:avoid}}`;
    document.head.appendChild(st);
  }
})();
