/* execops.js — Executive Dashboard + the ops half of every merged page (12 Sep 2026)
 *
 *   Executive Dashboard   #exec, top-level, both businesses        /api/exec
 *   Fixed  › Operations Dashboard   ops sections under the hub Overview      /api/fixed/exec
 *   Mobile › Operations Dashboard   ops sections around the Dashboard        /api/mvno/exec
 *   Home                            ops sections around the landing page     /api/exec
 *
 * EXECOPS.render(host, {biz, sections, title, sub}) renders ONLY the sections asked for. That is how
 * the merged pages stay free of duplicate numbers: each host page already owns some of the story, so
 * it asks for the part it is missing and nothing else.
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
  const TOK = { green: 'var(--green,#0e9f5a)', amber: 'var(--xo-p2,#d97706)', red: 'var(--xo-p1,#dc2626)', blue: 'var(--xo-p3,#2563eb)', muted: 'var(--muted)', line: 'var(--line)', ink: 'var(--ink)' };
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
  /* vertical columns by CATEGORY (not by day): rows [{label, n, tone}] — used for failure reasons */
  function cbars(rows, label) {
    if (!rows || !rows.length) return `<div class="xo-empty">Nothing to show.</div>`;
    const r = rows.slice(0, 12), max = niceMax(Math.max(...r.map(x => x.n), 1)), ys = yS(max), n = r.length;
    const slot = (W - PL - PR) / n, bw = Math.min(46, slot * 0.66);
    const cols = r.map((x, i) => { const cx = PL + slot * (i + 0.5), h = Math.max(0, ys(0) - ys(x.n));
      const lab = String(x.label || ''), short = lab.length > 18 ? lab.slice(0, 17) + '…' : lab;
      return `<rect x="${cx - bw / 2}" y="${ys(x.n)}" width="${bw}" height="${h}" rx="3" fill="${color(x.tone || 'blue')}"><title>${esc(lab)}: ${num(x.n)}</title></rect>`
        + `<text x="${cx}" y="${ys(x.n) - 4}" font-size="10" fill="${TOK.ink}" text-anchor="middle" font-weight="700">${num(x.n)}</text>`
        + `<text x="${cx}" y="${H - 8}" font-size="9" fill="${TOK.muted}" text-anchor="middle"><title>${esc(lab)}</title>${esc(short)}</text>`; }).join('');
    return svg(`${grid(max)}${cols}`, label);
  }
  function chart(ch, days) {
    if (ch.type === 'cols') return cbars(ch.rows, ch.title);
    /* a percentage series has a fixed 0-100 axis, and a day with no calls (null) BREAKS the line
     * instead of being drawn as 0 %, which would read as a total outage */
    const isPct = !!ch.pct;
    const raw = days.map(d => d[ch.field]), vals = raw.map(v => v == null ? null : Number(v));
    const present = vals.filter(v => v != null);
    const max = isPct ? 100 : niceMax(Math.max(...present, ch.threshold || 0, 1)), ys = yS(max), xs = xS(days.length);
    if (ch.type === 'line') {
      const col = color(ch.color);
      const segs = []; let cur = [];
      vals.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(`${xs(i)},${ys(v)}`); }); if (cur.length) segs.push(cur);
      const gridP = isPct ? [0, .5, 1].map(f => { const y = ys(100 * f); return `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" stroke="${TOK.line}"/><text x="${PL - 6}" y="${y + 4}" font-size="10" fill="${TOK.muted}" text-anchor="end">${Math.round(100 * f)}%</text>`; }).join('') : grid(max);
      const thr = isPct && ch.threshold ? `<line x1="${PL}" x2="${W - PR}" y1="${ys(ch.threshold)}" y2="${ys(ch.threshold)}" stroke="${TOK.red}" stroke-width="2" stroke-dasharray="6 5"/><text x="${W - PR - 4}" y="${ys(ch.threshold) - 5}" font-size="10" fill="${TOK.red}" text-anchor="end" font-weight="700">${esc(ch.thresholdLabel || '')}</text>` : '';
      return svg(`${gridP}${segs.map(pts => pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>` : '').join('')}${thr}`
        + vals.map((v, i) => v == null ? '' : `<circle cx="${xs(i)}" cy="${ys(v)}" r="3.5" fill="${col}"><title>${days[i].day}: ${isPct ? v + '%' : num(v)}${isPct && days[i][ch.field.replace('Rate', 's')] != null ? ` · ${num(days[i][ch.field.replace('Rate', 's')])} calls` : ''}</title></circle>`).join('') + xLab(days), ch.title);
    }
    vals.forEach((v, i) => { if (v == null) vals[i] = 0; });
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
  const wrapA = (href, cls, inner, title) => href ? `<a href="${esc(href)}" class="${cls}" title="${esc(title || 'open')}">${inner}</a>` : `<div class="${cls}"${title ? ` title="${esc(title)}"` : ''}>${inner}</div>`;
  const sec = (kicker, title, right) => `<div class="xo-sec"><div><div class="xo-kick">${esc(kicker)}</div><h3 class="xo-title">${title}</h3></div>${right ? `<div class="xo-dim">${right}</div>` : ''}</div>`;
  const statusPill = s => `<span class="xo-status" style="--c:${SEV[s] || TOK.muted}"><i></i>${esc(s)}</span>`;
  const trend = t => t === 'improving' ? `<span class="xo-tr" style="color:${TOK.green}">▼ improving</span>` : t === 'worsening' ? `<span class="xo-tr" style="color:${TOK.red}">▲ worsening</span>` : `<span class="xo-tr" style="color:${TOK.muted}">→ stable</span>`;
  const kpiTile = (k, h, unified) => wrapA(k.href, `xo-kpi xo-t-${k.tone || 'none'}`, `
      <div class="xo-kh"><span class="xo-kt">${esc(k.title)}</span><span class="xo-win">${badge(h, unified)}${esc(k.window || '')}</span></div>
      <div class="xo-kv">${num(k.value)}</div>
      <div class="xo-ks">${esc(k.sub || '')}</div>
      ${k.delta ? `<div class="xo-kd" style="color:${k.delta.pct === 0 ? TOK.muted : k.delta.good ? TOK.green : TOK.red}">${k.delta.pct > 0 ? '+' : ''}${k.delta.pct}% vs previous 24 h</div>` : ''}`, k.href ? 'open ' + k.title : '');
  const sloState = s => !s.measured ? 'nowire' : s.status === 'at_risk' ? 'warn' : s.ok ? 'ok' : 'breach';
  const sloMark = s => !s.measured ? '○' : s.status === 'at_risk' ? '!' : s.ok ? '✓' : '✕';
  const sloTile = (s, h, unified) => wrapA(s.href, `xo-slo ${sloState(s)}`, `
      <div class="xo-si">${sloMark(s)}</div>
      <div class="xo-sn">${badge(h, unified)}${esc(s.name)}</div>
      <div class="xo-sa">${esc(s.actual)}</div>
      <div class="xo-st">${s.measured ? 'target ' + esc(s.target) : esc(s.note || 'not wired')}</div>`, s.message || (s.measured ? `target ${s.target}` : s.note || 'not wired'));
  const healthTile = (x, h, unified) => wrapA(x.href, `xo-hi xo-h-${x.state}`, `<div class="xo-hl">${badge(h, unified)}${esc(x.label)}</div><div class="xo-hv"><i></i>${esc(x.value)}</div><div class="xo-hs">${esc(x.sub || '')}</div>`);
  const chartCard = (ch, h, unified) => `<div class="topo-card xo-chart"><div class="xo-ct">${badge(h, unified)}${esc(ch.title)}<span class="xo-dim"> · ${h.days} d</span></div>${ch.sub ? `<div class="xo-csub">${esc(ch.sub)}</div>` : ''}${chart(ch, h.series.days)}</div>`;
  const issuesRows = (h, unified) => h.issues.map(i => `<tr><td><span class="xo-sev ${i.sev}">${i.sev}</span></td><td>${badge(h, unified)}<b>${esc(i.label)}</b></td><td class="xo-num">${num(i.open)} / ${num(i.total)}</td><td>${ts(i.first_seen).slice(0, 10)}<div class="xo-dim">${i.daysOngoing} d ongoing</div></td><td>${trend(i.trend)}${spark(i.spark, i.sev === 'critical' ? TOK.red : i.sev === 'warning' ? TOK.amber : TOK.blue)}</td><td><a href="${esc(i.href)}" class="xo-link">act →</a></td></tr>`).join('');
  const alertRows = (h, unified) => h.alerts.map(a => { const cls = a.severity === 'P1' ? 'critical' : a.severity === 'P2' ? 'warning' : 'info';
    return `<a href="${esc(a.href)}" class="xo-al ${cls}"><span class="xo-sev ${cls}">${esc(a.severity)}</span><div class="xo-at">${badge(h, unified)}<b>${esc(a.name)}</b>${a.text ? ` — ${esc(a.text)}` : ''}${a.team ? `<span class="xo-dim"> · ${esc(a.team)}</span>` : ''}</div><span class="xo-dim">${a.status === 'open' ? 'open · ' : ''}${ts(a.at)}</span></a>`; }).join('');


  /* ---------- radar: a CRT scope, not a chart ----------
   * The scope face is its own instrument: dark green, phosphor grid, scanlines, sweeping beam —
   * in BOTH themes, because a radar reads as a radar. .xo-scope redefines --ink/--muted/--line
   * locally so the legend beside it inherits the instrument palette instead of the page's.
   * Encoding: ring = severity, sector = KSA day, dot size = distinct rules.
   *   live contact (a rule still breaching)  = severity colour, solid, glowing, locked, pings
   *   dead star   (every rule cleared)       = faint phosphor green, hollow — its RING still says
   *                                            which severity it was, so no information is lost. */
  const SEV_COLOR = { P1: 'var(--xo-p1,#dc2626)', P2: 'var(--xo-p2,#d97706)', P3: 'var(--xo-p3,#2563eb)' };
  const RADAR_SEVS = ['P1', 'P2', 'P3'];
  const RING_R = { P1: 62, P2: 112, P3: 162 };
  const RD = { cx: 210, cy: 210, R: 186, VB: 420 };
  const SWEEP_S = 8;
  function radar(halves) {
    const parts = halves.map(h => h.radar).filter(Boolean);
    if (!parts.length) return '';
    const days = parts[0].days || [];
    if (!days.length) return `<div class="xo-empty">No alert history in this window.</div>`;
    const { cx, cy, R, VB } = RD, nd = days.length;
    const ang = i => (-90 + i * (360 / nd)) * Math.PI / 180;
    const at = (i, r, off) => [cx + r * Math.cos(ang(i) + (off || 0)), cy + r * Math.sin(ang(i) + (off || 0))];
    /* seconds into the loop at which the beam crosses sector i. The wedge's leading edge starts at
     * 3 o'clock (90 deg clockwise from 12), so a blip at theta is reached after theta-90 of turn. */
    const tAt = (i, off) => {
      const deg = i * (360 / nd) + (off || 0) * 180 / Math.PI - 90;
      return (((deg % 360) + 360) % 360) / 360 * SWEEP_S;
    };
    const G = 'var(--xo-grid,#37d39a)';

    const spokes = days.map((d, i) => { const [x, y] = at(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${G}" stroke-width=".8" opacity=".16"/>`; }).join('');
    const axes = [0, 90, 180, 270].map(a => { const r = a * Math.PI / 180;
      return `<line x1="${cx - R * Math.cos(r)}" y1="${cy - R * Math.sin(r)}" x2="${cx + R * Math.cos(r)}" y2="${cy + R * Math.sin(r)}" stroke="${G}" stroke-width="1" opacity=".3"/>`; }).join('');
    const rings = RADAR_SEVS.slice().reverse().map(sev =>
      `<circle cx="${cx}" cy="${cy}" r="${RING_R[sev]}" fill="none" stroke="${G}" stroke-width="1" opacity=".34"/>`).join('')
      + [26, 140, 186].map(r => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${G}" stroke-width=".7" opacity=".14"/>`).join('');

    /* long windows: label every other / every third day so the rim never overlaps.
     * Up to 10 sectors the labels stay horizontal (easiest to read); denser rims turn tangentially. */
    const step = nd <= 10 ? 1 : nd <= 16 ? 2 : Math.ceil(nd / 10);
    const dayLab = days.map((d, i) => {
      if (i % step) return '';
      const [x, y] = at(i, R + 15);
      const a = (ang(i) * 180 / Math.PI + 450) % 360, flip = a > 90 && a < 270;
      const rot = nd <= 10 ? '' : ` transform="rotate(${flip ? a + 180 : a} ${x} ${y})"`;
      return `<text x="${x}" y="${y}" font-size="10" fill="${G}" opacity=".72" text-anchor="middle" dominant-baseline="middle" font-weight="700"${rot}>${d.slice(5)}</text>`;
    }).join('');
    /* severity labels sit on a dark plate so the phosphor grid never runs through them */
    const ringLab = RADAR_SEVS.map(sev => { const y = cy - RING_R[sev];
      return `<g><rect x="${cx - 15}" y="${y - 8}" width="30" height="16" rx="5" fill="var(--xo-plate,#06180f)" opacity=".92"/>`
        + `<text x="${cx}" y="${y}" font-size="11" fill="${SEV_COLOR[sev]}" text-anchor="middle" dominant-baseline="central" font-weight="800">${sev}</text></g>`; }).join('');

    const cells = halves.flatMap(h => (h.radar ? h.radar.cells : []).filter(c => RING_R[c.sev]).map(c => ({ c, h })));
    const maxN = Math.max(1, ...cells.map(x => x.c.n));
    /* dot size and the two-business offset both scale with the sector width, so a 30-day window
     * stays readable instead of turning into one solid ring of overlapping dots */
    const rMax = Math.max(3.2, Math.min(11, 170 / nd));
    const rMin = Math.max(1.8, rMax * 0.34);
    const OFF = halves.length > 1 ? Math.min(0.14, (Math.PI / nd) * 0.44) : 0;
    /* Which BUSINESS a contact belongs to is carried by its SHAPE, the way a tactical display
     * separates track types — colour is already spent on severity and brightness on open/cleared.
     *   Mobile = round contact      Fixed = diamond contact
     * It survives at 3 px, in both the live and the dead-star state, and reads without a legend
     * lookup once you have seen it twice. A diamond of the same "radius" looks smaller than a
     * circle, so it is drawn 1.18x to match. */
    const DIA = 1.18;
    const glyph = (biz, x, y, r, attrs, inner) => biz === 'fixed'
      ? `<path d="M${x} ${(y - r * DIA).toFixed(1)}L${(x + r * DIA).toFixed(1)} ${y}L${x} ${(y + r * DIA).toFixed(1)}L${(x - r * DIA).toFixed(1)} ${y}Z" ${attrs}>${inner || ''}</path>`
      : `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" ${attrs}>${inner || ''}</circle>`;
    const blips = halves.flatMap((h, hi) => (h.radar ? h.radar.cells : []).map(c => {
      const di = days.indexOf(c.day); if (di < 0 || !RING_R[c.sev]) return '';
      const off = hi === 0 ? -OFF : OFF;
      const [x, y] = at(di, RING_R[c.sev], off);
      const rr = rMin + (rMax - rMin) * Math.sqrt(c.n / maxN);
      const dly = tAt(di, off).toFixed(2);
      const live = c.open > 0, b = h.biz;
      const tip = `<title>${esc(h.label)} · ${c.sev} · ${c.day} · ${c.n} rule${c.n === 1 ? '' : 's'}`
        + `${live ? ` · ${c.open} still open` : ' · all cleared'} · ${num(c.firings)} firing${c.firings === 1 ? '' : 's'}`
        + `${c.rules && c.rules.length ? '\n' + c.rules.map(r => '• ' + esc(r)).join('\n') : ''}</title>`;
      const coord = `data-cell="1" data-biz="${esc(b)}" data-sev="${esc(c.sev)}" data-day="${esc(c.day)}" data-label="${esc(h.label)}" tabindex="0" role="button" aria-label="${esc(h.label)} ${c.sev} ${c.day}: open the case file"`;
      if (!live) { const dr = Math.max(2, rr * 0.62);
        return `<g class="xo-blip xo-dead xo-b-${b}" style="--d:${dly}s" ${coord}>`
          + glyph(b, x, y, dr, `class="xo-dot" fill="none" stroke="${G}" stroke-width="1.1"`, tip)
          + glyph(b, x, y, Math.max(0.8, dr * 0.26), `class="xo-core" fill="${G}"`)
          + `<circle class="xo-hit" cx="${x}" cy="${y}" r="${Math.max(9, dr + 6).toFixed(1)}" fill="transparent"/></g>`; }
      return `<g class="xo-blip xo-live xo-b-${b}" style="--d:${dly}s" ${coord}>`
        + glyph(b, x, y, rr + 5, `class="xo-lock" fill="none" stroke="${SEV_COLOR[c.sev]}" stroke-width="1.1" stroke-dasharray="3 3"`)
        + glyph(b, x, y, rr + rr * 0.5 + 2, `class="xo-ping" fill="none" stroke="${SEV_COLOR[c.sev]}" stroke-width="1.4"`)
        + glyph(b, x, y, rr + rr * 0.6 + 3, `class="xo-halo" fill="${SEV_COLOR[c.sev]}"`)
        + glyph(b, x, y, rr, `class="xo-dot" fill="${SEV_COLOR[c.sev]}" stroke="${b === 'mobile' ? '#e6f0ff' : '#d8fde9'}" stroke-width="${Math.min(1.3, rr * 0.28).toFixed(2)}" filter="url(#xoGlow)"`, tip)
        + `<circle class="xo-hit" cx="${x}" cy="${y}" r="${Math.max(11, rr + 7).toFixed(1)}" fill="transparent"/></g>`;
    })).join('');

    const tot = halves.map(h => ({ label: h.label, biz: h.biz, t: (h.radar || {}).rules || 0, o: (h.radar || {}).open || 0 }));
    /* window totals come from the payload, never from summing the daily cells: one rule firing on
     * five days is five cells but ONE rule */
    const sevTot = {};
    halves.forEach(h => Object.entries((h.radar || {}).sev || {}).forEach(([sv, e]) => {
      const a = sevTot[sv] || (sevTot[sv] = { rules: 0, open: 0, firings: 0 });
      a.rules += e.rules || 0; a.open += e.open || 0; a.firings += e.firings || 0;
    }));
    const sum = k => RADAR_SEVS.reduce((a, sv) => a + ((sevTot[sv] || {})[k] || 0), 0);
    const openNow = sum('open'), ruleTot = sum('rules'), fireTot = sum('firings');
    const peak = cells.slice().sort((a, b) => (b.c.open - a.c.open) || (b.c.n - a.c.n) || (b.c.firings - a.c.firings))[0];

    return `<div class="xo-radarwrap">
      <div class="xo-tty">
        <div class="xo-tty-bar"><i></i><i></i><i></i><b class="xo-tty-ttl">open contacts</b>
          <button type="button" class="xo-tty-b" data-tty="back" hidden>◂ all open</button></div>
        <div class="xo-tty-out" role="log" aria-live="polite" aria-label="Open alert contacts"></div>
      </div>
      <svg viewBox="0 0 ${VB} ${VB}" class="xo-radar" role="img" aria-label="Alert radar: P1 to P3 severity rings by day, open contacts and cleared history">
        <defs>
          <radialGradient id="xoFace" cx="50%" cy="46%" r="58%">
            <stop offset="0%" stop-color="var(--xo-face1,#123a2a)"/><stop offset="55%" stop-color="var(--xo-face2,#0a2419)"/><stop offset="100%" stop-color="var(--xo-face3,#05130d)"/></radialGradient>
          <radialGradient id="xoBloom" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="${G}" stop-opacity=".16"/><stop offset="70%" stop-color="${G}" stop-opacity=".03"/><stop offset="100%" stop-color="${G}" stop-opacity="0"/></radialGradient>
          <linearGradient id="xoSweep" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="${G}" stop-opacity="0"/><stop offset="45%" stop-color="${G}" stop-opacity=".12"/>
            <stop offset="80%" stop-color="${G}" stop-opacity=".34"/><stop offset="100%" stop-color="${G}" stop-opacity=".8"/></linearGradient>
          <pattern id="xoScan" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="1.2" fill="#000" opacity=".22"/></pattern>
          <filter id="xoGlow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <clipPath id="xoFaceClip"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
        </defs>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#xoFace)"/>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#xoBloom)"/>
        <g clip-path="url(#xoFaceClip)">
          ${spokes}${axes}${rings}
          <g class="xo-sweepg"><path class="xo-sweep" d="M${cx},${cy} L${cx},${cy - R} A${R},${R} 0 0,1 ${cx + R},${cy} Z" fill="url(#xoSweep)"/>
            <line class="xo-beam" x1="${cx}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="var(--xo-beam,#8affd0)" stroke-width="2.2" filter="url(#xoGlow)"/></g>
          <rect x="${cx - R}" y="${cy - R}" width="${2 * R}" height="${2 * R}" fill="url(#xoScan)" class="xo-scan"/>
          ${blips}${ringLab}
        </g>
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${G}" stroke-width="1.6" opacity=".45"/>
        <circle cx="${cx}" cy="${cy}" r="${R + 5}" fill="none" stroke="${G}" stroke-width="1" opacity=".14"/>
        ${dayLab}
        <circle cx="${cx}" cy="${cy}" r="4" fill="${G}" filter="url(#xoGlow)"/>
        <circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${G}" stroke-width="1" opacity=".45"/>
      </svg>
      <div class="xo-radarlegend">
        <div class="xo-rl-h">Distinct rules · ${days.length} days</div>
        <div class="xo-rl-tot ${openNow ? 'hot' : 'calm'}">${num(openNow)}<span>still open now</span></div>
        <div class="xo-rlh2"><span>severity</span><span>open / fired</span></div>
        ${RADAR_SEVS.map(sev => { const e = sevTot[sev] || { rules: 0, open: 0 };
          if (!e.rules) return '';
          const w = Math.round(100 * e.open / e.rules);
          return `<div class="xo-rl"><i style="background:${SEV_COLOR[sev]}"></i><b>${sev}</b>`
            + `<span class="xo-rlb"><u style="background:${SEV_COLOR[sev]};width:${w}%"></u></span>`
            + `<span class="xo-rln">${num(e.open)}<em> / ${num(e.rules)}</em></span></div>`; }).join('')
          || `<div class="xo-rl-d">No rule fired in this window.</div>`}
        <div class="xo-rl-d"${fireTot > ruleTot ? ` title="${num(fireTot)} firing events behind them — the same rule re-fires on every evaluation cycle, which is why the radar counts rules, not firings"` : ''}><b>${num(ruleTot)}</b> rule${ruleTot === 1 ? '' : 's'} fired in ${days.length} d</div>
        ${peak ? `<div class="xo-rl-d">busiest: <b>${esc(peak.c.sev)}</b> · ${esc(peak.c.day)} · ${num(peak.c.n)} rule${peak.c.n === 1 ? '' : 's'} on ${esc(peak.h.label)}</div>` : ''}
        <div class="xo-rl-d"><span class="xo-lg"><i class="xo-lg-live"></i>open — still breaching</span><span class="xo-lg"><i class="xo-lg-dead"></i>cleared — kept as history</span></div>
        <div class="xo-rl-d">ring = severity · sector = day · dot size = distinct rules · <b>click a contact to tune the console</b></div>
        <div class="xo-rl-biz">${(tot.length > 1 ? tot : halves.map(h => ({ label: h.label, biz: h.biz, t: (h.radar || {}).rules || 0, o: (h.radar || {}).open || 0 })))
          .map(t => `<span class="xo-bz"><i class="xo-gl xo-gl-${t.biz}"></i><b>${esc(t.label)}</b><span>${num(t.o)} open / ${num(t.t)}</span></span>`).join('')}</div>
        <a href="#alerts" class="xo-link">open alerts →</a>
      </div></div>`;
  }

  /* ---------- the scope console: open contacts, typed out ----------
   * Sits beside the radar, not over it — nothing about an open alert should need a click to see.
   * It teletypes the alerts that are STILL BREACHING right now; clicking a contact on the scope
   * retunes it to that contact instead of opening a dialog. Same rule as everywhere else here:
   * fields the source does not record are printed as "not recorded", never left blank, because a
   * blank owner line reads as "nobody is on it" when the truth is "this source does not track it".
   * ETA has no field anywhere, so the console prints the ack-SLA clock and the rule's own MTTR. */
  const dur = m => { if (m == null) return '—'; const a = Math.abs(m);
    if (a < 60) return `${Math.round(a)} min`;
    if (a < 1440) return `${Math.floor(a / 60)} h ${Math.round(a % 60)} m`;
    return `${Math.floor(a / 1440)} d ${Math.floor((a % 1440) / 60)} h`; };

  /* the script is built as typed LINES: {t: text, c: class} — the typewriter walks characters */
  /* the rule name often already ends in its own "(P2)" — do not print the severity twice */
  const ruleName = r => String(r.name || r.key || '').replace(/\s*\((P[1-4])\)\s*$/i, '').trim() || r.key;
  function ruleLines(r, showBiz) {
    const L = [], pad = k => (k + '          ').slice(0, 10);
    const sev = r.severity || 'P?', open = r.status === 'open';
    L.push({ t: `[${sev}] ${ruleName(r)}`, c: 'hd ' + sev.toLowerCase() });
    /* status is never implied — a cleared alert that only said "open 4 h" read as still breaching */
    L.push({ t: `       ${showBiz ? showBiz + ' · ' : ''}${(r.firedAt || '').slice(0, 10)} · `
      + (open ? `OPEN ${dur(r.openMin)}` : `cleared after ${dur(r.openMin)}`), c: open ? 'bad' : 'dim' });
    L.push({ t: `  ${pad('OWNER')}${r.owner ? r.owner + '  (' + r.ownerFrom + ')' : '·· UNASSIGNED ··'}`, c: r.owner ? '' : 'bad' });
    L.push({ t: `  ${pad('TEAM')}${r.team || 'not recorded'}`, c: r.team ? '' : 'na' });
    if (r.ticket) L.push({ t: `  ${pad('TICKET')}${r.ticket}`, c: 'tick' });
    const a = r.ack;
    L.push(!a ? { t: `  ${pad('ACK SLA')}not configured for this business / priority`, c: 'na' }
      : !a.enabled ? { t: `  ${pad('ACK SLA')}off`, c: 'na' }
      : a.overdue ? { t: `  ${pad('ACK SLA')}OVERDUE by ${dur(a.overdueByMin)}   target ${a.targetMin} min${a.level ? `   reminder ${a.level} sent` : ''}`, c: 'bad' }
      : r.ackAt ? { t: `  ${pad('ACK SLA')}acknowledged in ${dur(a.elapsedMin)}   target ${a.targetMin} min`, c: 'good' }
      : { t: `  ${pad('ACK SLA')}due in ${dur(a.targetMin - a.elapsedMin)}   target ${a.targetMin} min`, c: '' });
    L.push(r.mttr ? { t: `  ${pad('MTTR')}${dur(r.mttr.p50Min)} median · ${dur(r.mttr.avgMin)} avg · ${r.mttr.samples} resolved` , c: '' }
      : { t: `  ${pad('MTTR')}no resolved history for this rule`, c: 'na' });
    L.push({ t: `  ${pad('ETA')}no ETA field is captured — see ACK SLA / MTTR`, c: 'na' });
    if (r.observed != null) L.push({ t: `  ${pad('VALUE')}${num(r.observed)} vs ${num(r.threshold)}${r.peak != null ? `   peak ${num(r.peak)}` : ''}${r.breachCount > 1 ? `   ${num(r.breachCount)} breaches` : ''}`, c: '' });
    if (r.message) L.push({ t: `  > ${r.message}`, c: 'msg' });
    L.push({ t: '', c: '' });
    return L;
  }

  let ttySeq = 0, ttyTimer = null;
  function ttyEl(host) { return host.querySelector('.xo-tty-out'); }
  function typeInto(out, lines, done) {
    clearTimeout(ttyTimer);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    out.innerHTML = ''; out.scrollTop = 0;
    if (reduce) { out.innerHTML = lines.map(l => `<div class="xo-ttyl ${l.c}">${esc(l.t) || '&nbsp;'}</div>`).join(''); if (done) done(); return; }
    let li = 0, ci = 0, node = null;
    const step = () => {
      if (li >= lines.length) { out.classList.remove('typing'); if (done) done(); return; }
      const l = lines[li];
      if (!node) { node = document.createElement('div'); node.className = 'xo-ttyl ' + l.c; out.appendChild(node); }
      /* whole words at a time: a per-character crawl on 40 lines takes half a minute */
      const chunk = Math.max(3, Math.round(l.t.length / 14));
      ci += chunk;
      node.textContent = l.t.slice(0, ci) || ' ';
      out.scrollTop = out.scrollHeight;
      if (ci >= l.t.length) { node.textContent = l.t || ' '; li++; ci = 0; node = null; ttyTimer = setTimeout(step, 34); }
      else ttyTimer = setTimeout(step, 12);
    };
    out.classList.add('typing'); step();
  }

  async function ttyLoad(host, halves, scope) {
    const out = ttyEl(host); if (!out) return;
    const me = ++ttySeq;
    const ttl = host.querySelector('.xo-tty-ttl');
    const all = !scope;
    if (ttl) ttl.textContent = all ? 'open contacts' : `${scope.label} · ${scope.sev} · ${scope.day}`;
    const back = host.querySelector('[data-tty="back"]'); if (back) back.hidden = all;
    typeInto(out, [{ t: '> ' + (all ? 'scanning all sectors…' : `tuning to ${scope.label} ${scope.sev} ${scope.day}…`), c: 'dim' }]);
    const ask = h => api(`/api/exec/radar/cell?biz=${encodeURIComponent(h.biz)}`
      + (all ? `&days=${state.range === '30d' ? 30 : 7}&open=1` : `&sev=${encodeURIComponent(scope.sev)}&day=${encodeURIComponent(scope.day)}`))
      .then(d => ({ h, d })).catch(e => ({ h, d: { rules: [], error: e.message } }));
    const targets = all ? halves : halves.filter(h => h.biz === scope.biz);
    const res = await Promise.all(targets.map(ask));
    if (me !== ttySeq) return;
    const multi = halves.length > 1;
    const lines = [];
    const days = state.range === '30d' ? 30 : 7;
    lines.push({ t: `> SALAM OPERATIONS · ALERT SCOPE`, c: 'dim' });
    lines.push({ t: `> ${all ? `still breaching now · last ${days} d` : `contact ${scope.sev} · ${scope.day} · open first, then cleared`}`, c: 'dim' });
    lines.push({ t: '', c: '' });
    let nOpen = 0, nCleared = 0;
    for (const { h, d } of res) {
      if (d.error) { lines.push({ t: `! ${h.label}: ${d.error}`, c: 'bad' }, { t: '', c: '' }); continue; }
      const rules = d.rules || [];
      const openRules = rules.filter(r => r.status === 'open');
      /* a cell also contains rules that already cleared. They are history, so they are listed as
       * one line each under their own divider — never with a full dossier that would read as if
       * somebody still had to act on them, and never counted as open. */
      const clearedRules = all ? [] : rules.filter(r => r.status !== 'open');
      nOpen += openRules.length; nCleared += clearedRules.length;
      if (!openRules.length && !clearedRules.length) continue;
      if (multi) lines.push({ t: `── ${h.label.toUpperCase()} ${'─'.repeat(Math.max(2, 34 - h.label.length))}`, c: 'rule' });
      openRules.forEach(r => ruleLines(r, null).forEach(x => lines.push(x)));
      if (!openRules.length && !all) lines.push({ t: '  nothing here is still open.', c: 'good' }, { t: '', c: '' });
      if (clearedRules.length) {
        lines.push({ t: `── cleared · history ${'─'.repeat(18)}`, c: 'rule' });
        clearedRules.forEach(r => lines.push({ t: `  [${r.severity}] ${ruleName(r)} — cleared after ${dur(r.openMin)}`
          + (r.owner ? `, ${r.owner}` : ''), c: 'na' }));
        lines.push({ t: '', c: '' });
      }
      (d.missing || []).filter(m => !/no ETA/.test(m)).forEach(m => lines.push({ t: `  · ${m}`, c: 'na' }, { t: '', c: '' }));
    }
    if (!nOpen && !nCleared) lines.push({ t: all ? '  nothing is breaching right now — the scope is clear.' : '  nothing fired in this contact.', c: 'good' }, { t: '', c: '' });
    lines.push({ t: `> ${nOpen} still open${all ? '' : ` · ${nCleared} cleared`} · ${hm(new Date())}`, c: 'dim' });
    typeInto(out, lines);
  }

  /* ---------- executive brief: the slide deck, in a modal, only if the file is deployed ---------- */
  const BRIEF = 'exec-brief.html';
  let briefKnown = null;
  async function briefExists() {
    if (briefKnown !== null) return briefKnown;
    try { const r = await fetch(BRIEF, { method: 'HEAD' }); briefKnown = r.ok; }
    catch (_) { briefKnown = false; }
    return briefKnown;
  }
  function openBrief() {
    if ($('#xoBrief')) return;
    const m = document.createElement('div'); m.id = 'xoBrief'; m.className = 'xo-modal';
    m.innerHTML = `<div class="xo-modal-in"><div class="xo-modal-bar"><b>Salam Observability Portal — executive brief</b>
        <span class="xo-modal-tools"><a href="${BRIEF}" target="_blank" rel="noopener" class="xo-btn">open in a tab ↗</a><button type="button" class="xo-btn" data-x="close">✕ close</button></span></div>
      <iframe src="${BRIEF}" title="Executive brief" loading="lazy"></iframe></div>`;
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener('keydown', esckey); };
    const esckey = e => { if (e.key === 'Escape') close(); };
    m.querySelector('[data-x="close"]').onclick = close;
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.addEventListener('keydown', esckey);
  }

  /* ---------- pages ---------- */
  function head(title, sub, halves, opts) {
    const status = halves.length === 1 ? halves[0].status : halves.reduce((w, h) => ({ CRITICAL: 3, WARNING: 2, HEALTHY: 1 }[h.status] > { CRITICAL: 3, WARNING: 2, HEALTHY: 1 }[w] ? h.status : w), 'HEALTHY');
    const c = halves.reduce((a, h) => ({ critical: a.critical + h.counts.critical, warnings: a.warnings + h.counts.warnings, alerts24: a.alerts24 + h.counts.alerts24 }), { critical: 0, warnings: 0, alerts24: 0 });
    return `<div class="xo-head"><div><div class="xo-kick">${esc(halves.map(h => h.label).join(' + '))}${opts.kicker ? ' · ' + esc(opts.kicker) : ''}</div>
        ${title ? `<h2 class="xo-h">${esc(title)}</h2>` : ''}${sub ? `<div class="xo-meta">${esc(sub)}</div>` : ''}</div>
      <div class="xo-tools">${statusPill(status)}<span class="xo-dim">${c.critical} critical · ${c.warnings} warning · ${c.alerts24} alert(s) in 24 h</span>
        ${opts.range === false ? '' : `<span class="xo-range">${['7d', '30d'].map(r => `<button type="button" class="xo-r${state.range === r ? ' on' : ''}" data-r="${r}">${r}</button>`).join('')}</span>`}
        ${opts.brief ? `<button type="button" class="xo-btn xo-brief" data-act="brief" hidden>▶ Executive brief</button>` : ''}
        <button type="button" class="xo-btn" data-act="refresh" title="refresh now">↻ <span class="xo-upd">updated ${hm(new Date())}</span></button></div></div>`;
  }

  /* Each section is a function of the halves. A page asks for the ones it does not already show,
   * which is what keeps the merged pages free of repeated numbers. */
  /* With two businesses one wrapped grid splits a business across rows — the last Fixed SLO ended
   * up alone at the end of the Mobile row, which reads as if it belonged to Mobile. Group per
   * business instead: each gets its own grid under a thin header, so a row never mixes the two and
   * the tiles no longer need to carry a badge each. One business: a single grid, unchanged. */
  const grouped = (H, u, cls, tiles) => u
    ? H.map(h => { const t = tiles(h); return t.length
        ? `<div class="xo-bgrp"><div class="xo-bgh">${badge(h, true)}<i></i></div><div class="${cls}">${t.join('')}</div></div>` : ''; }).join('')
    : `<div class="${cls}">${H.flatMap(h => tiles(h)).join('')}</div>`;

  const SECTION = {
    /* Executive verdict, not a paragraph. Three sentences of prose per business was a briefing note;
     * an executive needs the one thing that is wrong and the numbers that say how wrong. Everything
     * here is derived from the contract's structured fields, so it stays a statement of fact:
     *   headline  = the worst breaching SLO, stated as a gap (or the worst red KPI, or "all met")
     *   chips     = SLOs breaching / rules still open / biggest ongoing issue — each a link
     * The page header already carries critical/warning counts and Key indicators carries the KPI
     * tiles, so neither is repeated. The server's full prose is kept on hover, not on screen. */
    summary: (H, u) => sec('verdict', 'Where we stand', 'the one thing to fix, per business') +
      `<div class="xo-sumgrid">${H.map(h => {
        const measured = (h.slos || []).filter(s => s.measured);
        const breach = measured.filter(s => !s.ok);
        const worstK = (h.kpis || []).filter(k => k.exec && k.tone === 'red')[0];
        const head = breach.length
          ? { t: breach[0].name, v: breach[0].actual, x: `target ${breach[0].target}`, href: breach[0].href }
          : worstK ? { t: worstK.title, v: num(worstK.value), x: esc(worstK.sub || ''), href: worstK.href }
          : { t: 'Every measured SLO is within target', v: '', x: `${measured.length} measured`, href: null };
        const issue = (h.issues || [])[0];
        const openRules = (h.radar || {}).open || 0;
        const clip = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
        const chip = (tone, label, val, href, tip) => wrapA(href, `xo-vchip ${tone}`, `<b>${val}</b><span>${esc(label)}</span>`, tip || label);
        return `<div class="xo-summary xo-vd" style="--c:${SEV[h.status]}" title="${esc((h.summary || []).join(' \n'))}">
          <div class="xo-sumh">${u ? badge(h, true) : `<span class="xo-biz xo-biz-${h.biz}">${esc(h.label)}</span>`}${statusPill(h.status)}</div>
          <div class="xo-vdl">${head.v ? `<b>${esc(head.v)}</b>` : ''}${esc(head.t)}${head.x ? `<span> — ${head.x}</span>` : ''}</div>
          <div class="xo-vdc">
            ${chip(breach.length ? 'red' : 'green', measured.length ? `of ${measured.length} SLOs breaching` : 'SLOs measured', breach.length, (breach[0] || {}).href)}
            ${chip(openRules ? 'amber' : 'green', 'alert rules still open', num(openRules), '#alerts')}
            ${issue ? chip(issue.sev === 'critical' ? 'red' : issue.sev === 'warning' ? 'amber' : 'info', clip(issue.label, 30) + ' open', num(issue.open), issue.href, issue.label + ' — biggest ongoing issue') : ''}
          </div></div>`; }).join('')}</div>`,
    radar: (H) => sec('signal', 'Alert radar', 'severity by day · click through to alerts') + `<div class="topo-card xo-chart xo-scope">${radar(H)}</div>`,
    kpisExec: (H, u) => sec('north-star', 'Key indicators', 'click a tile to open its page') +
      grouped(H, u, 'xo-grid', h => h.kpis.filter(k => k.exec).map(k => kpiTile(k, h, false))),
    kpisAll: (H, u) => sec('indicators', 'Key indicators', 'click a tile to open its page') +
      grouped(H, u, 'xo-grid', h => h.kpis.filter(k => k.key !== 'availability' && k.key !== 'revenue').map(k => kpiTile(k, h, false))),
    slos: (H, u) => sec('slo', 'SLO compliance', '○ = not measured by this console') +
      grouped(H, u, 'xo-slos', h => h.slos.map(x => sloTile(x, h, false))),
    health: (H, u) => sec('health', 'System health', 'click a tile to open its page') +
      grouped(H, u, 'xo-health', h => h.health.map(x => healthTile(x, h, false))),
    trendsExec: (H, u) => sec('trends', 'Trends', `${H[0].days} days · KSA`) +
      `<div class="xo-charts">${H.flatMap(h => h.series.charts.filter(c => c.exec).map(c => chartCard(c, h, u))).join('')}</div>`,
    trendsAll: (H, u) => sec('trends', 'Trends & analytics', `${H[0].days} days · KSA`) +
      `<div class="xo-charts">${H.flatMap(h => h.series.charts.map(c => chartCard(c, h, u))).join('')}</div>`,
    pipeline: (H, u) => sec('pipeline', u ? 'Where volume stops' : H[0].pipeline.title, u ? 'per business · same window' : H[0].pipeline.sub) +
      `<div class="xo-charts">${H.map(h => `<div class="topo-card xo-chart">${u ? `<div class="xo-ct">${badge(h, u)}${esc(h.pipeline.title)}<span class="xo-dim"> · ${esc(h.pipeline.sub || '')}</span></div>` : ''}${h.pipeline.rows.length ? hbars(h.pipeline.rows, h.pipeline.title) : `<div class="xo-empty">Nothing stopped in this window.</div>`}<div class="xo-dim" style="margin-top:auto;padding-top:6px"><a href="${esc(h.pipeline.href)}" class="xo-link">open ${esc(h.label)} detail →</a></div></div>`).join('')}</div>`,
    issues: (H, u) => sec('issues', 'Top ongoing issues', 'open in window · sorted by open count') +
      `<div class="topo-card xo-tblwrap">${H.some(h => h.issues.length) ? `<div class="tscroll"><table class="xo-tbl"><thead><tr><th>Severity</th><th>Issue</th><th>Open / total</th><th>First seen</th><th>Trend</th><th></th></tr></thead><tbody>${H.flatMap(h => h.issues.map(i => ({ h, i }))).sort((a, b) => b.i.open - a.i.open).map(({ h, i }) => issuesRows({ ...h, issues: [i] }, u)).join('')}</tbody></table></div>` : `<div class="xo-empty">No open issue in this window.</div>`}</div>`,
    alerts: (H, u) => sec('alerts', 'Alerts', `open first · fired in ${H[0].days} d`) +
      `<div class="topo-card xo-tblwrap">${H.some(h => h.alerts.length) ? H.flatMap(h => h.alerts.map(a => ({ h, a }))).sort((x, y) => (y.a.status === 'open') - (x.a.status === 'open') || new Date(y.a.at) - new Date(x.a.at)).map(({ h, a }) => alertRows({ ...h, alerts: [a] }, u)).join('') : `<div class="xo-empty">No alert fired in this window.</div>`}</div>`,
    foot: (H) => `<div class="xo-foot">${H.map(h => `${esc(h.label)}: ${esc(h.provisional)} · source ${esc(h.source || '—')} · ${esc(h.freshness.text)}`).join('<br>')}</div>`,
  };

  const timers = new WeakMap();
  /* Order is the argument the page makes: the verdict, then the numbers behind it, then how they
   * are trending, then the radar as the bridge from trend to what is still open, then the
   * issues themselves. The radar sits directly above Top ongoing issues because the contacts
   * it leaves lit ARE that list. */
  const EXEC_SECTIONS = ['summary', 'kpisExec', 'slos', 'trendsExec', 'radar', 'issues', 'foot'];

  async function render(host, opts, force) {
    ensureCss();
    const o = Object.assign({ biz: 'all', sections: EXEC_SECTIONS, title: '', sub: '', kicker: '', brief: false, head: true }, opts);
    if (!host.dataset.xoLoaded) host.innerHTML = `<div class="xo-loading">Loading…</div>`;
    let d; try { d = await load(`${SRC[o.biz]}?range=${state.range}`, force); }
    catch (e) { host.innerHTML = `<div class="topo-card xo-err"><b>Could not load</b><div class="xo-dim">${esc(e.message)}</div></div>`; return; }
    const halves = o.biz === 'all' ? [d.mobile, d.fixed].filter(h => h && h.configured) : (d.configured ? [d] : []);
    const missing = o.biz === 'all' ? (d.missing || []) : (d.configured ? [] : [{ label: d.label || 'This business', reason: d.reason }]);
    if (!halves.length) { host.innerHTML = `<div class="topo-card xo-err"><b>Nothing to show</b><div class="xo-dim">${esc(missing.map(m => m.label + ': ' + (m.reason || 'not configured')).join(' · ') || 'no business configured for your role')}</div></div>`; return; }
    const u = halves.length > 1;
    host.innerHTML = (o.head === false ? '' : head(o.title, o.sub, halves, o)) +
      (missing.length ? `<div class="xo-missing">${missing.map(m => `<b>${esc(m.label)} half unavailable</b> — ${esc(m.reason || 'not configured')}`).join('<br>')}</div>` : '') +
      o.sections.map(k => SECTION[k] ? SECTION[k](halves, u) : '').join('');
    host.dataset.xoLoaded = '1';
    host.querySelectorAll('.xo-r').forEach(b => b.onclick = () => { state.range = b.dataset.r; localStorage.setItem('exec_range', state.range); document.querySelectorAll('[data-xo-host]').forEach(h2 => { if (h2._xo) render(h2, h2._xo, true); }); });
    /* a contact retunes the console beside the scope — never a dialog over it */
    if (host.querySelector('.xo-tty-out')) {
      const wrap = host.querySelector('.xo-radarwrap');
      const tune = scope => { host.querySelectorAll('.xo-blip.sel').forEach(x => x.classList.remove('sel')); ttyLoad(host, halves, scope); };
      host.querySelectorAll('.xo-blip[data-cell]').forEach(g => {
        const go = () => { host.querySelectorAll('.xo-blip.sel').forEach(x => x.classList.remove('sel')); g.classList.add('sel');
          ttyLoad(host, halves, { biz: g.dataset.biz, sev: g.dataset.sev, day: g.dataset.day, label: g.dataset.label });
          if (wrap) wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
        g.addEventListener('click', go);
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
      const back = host.querySelector('[data-tty="back"]'); if (back) back.onclick = () => tune(null);
      ttyLoad(host, halves, null);
    }
    const rb = host.querySelector('[data-act="refresh"]'); if (rb) rb.onclick = () => render(host, o, true);
    const bb = host.querySelector('[data-act="brief"]'); if (bb) { bb.onclick = openBrief; briefExists().then(ok => { if (ok) bb.hidden = false; }); }
    host.setAttribute('data-xo-host', '1'); host._xo = o;
    clearTimeout(timers.get(host)); timers.set(host, setTimeout(() => { if (host.isConnected && !document.hidden) render(host, o, true); }, 300e3));
  }

  /* mount ops sections into a page that already owns part of the story */
  function mountInto(anchor, where, id, opts) {
    if (!anchor) return null;
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'xo-block';
      if (where === 'prepend') anchor.insertBefore(el, anchor.firstChild);
      else if (where === 'before') anchor.parentNode.insertBefore(el, anchor);
      else anchor.appendChild(el); }
    render(el, opts);
    return el;
  }
  window.EXECOPS = { render, mountInto, openBrief, sections: SECTION };

  /* ---------- the Executive Dashboard view (top level, both businesses) ---------- */
  window.openExecOps = function () {
    const host = $('#view-execops'); if (!host) return;
    document.querySelectorAll('.navtab[data-view="execops"]').forEach(b => b.classList.add('active'));
    document.querySelectorAll('.navtab:not([data-view="execops"]).active').forEach(b => b.classList.remove('active'));
    if (window.navdropSync) window.navdropSync();
    render(host, { biz: 'all', sections: EXEC_SECTIONS, title: 'Executive Dashboard',
      sub: 'both businesses · north-star KPIs, SLO compliance, alert radar and the issues that are still open',
      kicker: 'executive', brief: true });
  };

  /* ---------- ops sections for the three merged pages ---------- */
  // Fixed › Operations Dashboard: the hub Overview already shows KPIs, funnel, dealers, regions and
  // error categories, so this adds only what it lacks - SLOs, day trends, the stop-step pipeline, alerts.
  /* Fixed › Operations Dashboard, split the same way Mobile is: the status header + SLO compliance
   * lead the page, the heavy analytics sit under the page's own content. */
  window.execopsFixedTop = host => render(host, { biz: 'fixed', kicker: 'operations', range: false, sections: ['slos'] });
  window.execopsFixedBottom = host => render(host, { biz: 'fixed', kicker: 'operations', range: false,
    sections: ['trendsAll', 'pipeline', 'alerts', 'foot'], head: false });
  window.execopsFixed = window.execopsFixedBottom;   // back-compat for any old deep link
  // Mobile › Operations Dashboard: the Dashboard owns today's KPIs and order flow.
  window.execopsMobileTop = () => mountInto($('#homeOps') || $('#view-home'), $('#homeOps') ? 'append' : 'prepend', 'xoMobTop', { biz: 'mobile', kicker: 'operations', range: false, sections: ['slos'] });
  window.execopsMobileBottom = () => mountInto($('#view-home'), 'append', 'xoMobBot', { biz: 'mobile', kicker: 'operations', range: false, sections: ['trendsAll', 'pipeline', 'alerts', 'foot'] });
  // Home: the landing page owns the status pills, growth and the attention list; add the charts and alerts.
  window.execopsHome = () => mountInto($('#view-landing'), 'append', 'xoHome', { biz: 'all', kicker: 'operations', range: false, sections: ['trendsExec', 'alerts', 'foot'] });

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
      .xo-sumgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:12px;align-items:stretch}
      .xo-sumgrid>*{min-width:0}
      .xo-summary{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:12px;padding:14px 18px;font-size:13.5px;line-height:1.55}
      .xo-vd{display:flex;flex-direction:column;gap:9px;padding:15px 17px}
      .xo-vdl{font-size:15px;font-weight:700;line-height:1.35}
      .xo-vdl b{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;margin-right:9px;letter-spacing:-.5px}
      .xo-vdl span{font-weight:600;color:var(--muted);font-size:13px}
      .xo-vdc{display:flex;flex-wrap:wrap;gap:8px;margin-top:1px}
      .xo-vchip{display:inline-flex;align-items:baseline;gap:6px;padding:5px 11px;border-radius:8px;font-size:11.5px;white-space:nowrap;max-width:100%;
        border:1px solid transparent;text-decoration:none;color:inherit;transition:transform .15s,box-shadow .15s}
      a.xo-vchip:hover{transform:translateY(-1px);box-shadow:var(--shadow,0 6px 16px rgba(15,23,42,.10))}
      .xo-vchip b{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums}
      .xo-vchip span{color:var(--muted);font-weight:600}
      .xo-vchip.red{color:#dc2626;background:color-mix(in srgb,#dc2626 11%,transparent);border-color:color-mix(in srgb,#dc2626 28%,transparent)}
      .xo-vchip.amber{color:#d97706;background:color-mix(in srgb,#d97706 11%,transparent);border-color:color-mix(in srgb,#d97706 28%,transparent)}
      .xo-vchip.info{color:#2563eb;background:color-mix(in srgb,#2563eb 11%,transparent);border-color:color-mix(in srgb,#2563eb 28%,transparent)}
      .xo-vchip.green{color:var(--green,#0e9f5a);background:color-mix(in srgb,var(--green,#0e9f5a) 11%,transparent);border-color:color-mix(in srgb,var(--green,#0e9f5a) 28%,transparent)}
      .xo-vchip.red span,.xo-vchip.amber span,.xo-vchip.info span,.xo-vchip.green span{color:inherit;opacity:.8}
      .xo-summary div+div{margin-top:5px}.xo-sumh{display:flex;align-items:center;gap:8px;margin-bottom:8px}
      .xo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;align-items:stretch}
      .xo-grid>*{min-width:0}
      .xo-kpi{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-top:4px solid var(--line);border-radius:12px;padding:12px 14px;transition:box-shadow .2s,transform .2s,border-color .2s}
      a.xo-kpi:hover{transform:translateY(-1px);box-shadow:var(--shadow,0 10px 26px rgba(15,23,42,.10));border-color:color-mix(in srgb,var(--line) 50%,var(--green,#0e9f5a))}
      .xo-t-red{border-top-color:#dc2626}.xo-t-amber{border-top-color:#d97706}.xo-t-green{border-top-color:var(--green,#0e9f5a)}.xo-t-muted{opacity:.75;border-top-style:dashed}
      .xo-kh{display:flex;justify-content:space-between;align-items:center;gap:6px}
      .xo-kt{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;font-weight:800}
      .xo-win{font-size:10px;color:var(--muted);font-weight:700;white-space:nowrap}
      .xo-kv{font-size:28px;font-weight:800;line-height:1.15;margin:8px 0 3px;font-variant-numeric:tabular-nums}
      .xo-t-red .xo-kv{color:#dc2626}.xo-t-amber .xo-kv{color:#d97706}.xo-t-green .xo-kv{color:var(--green,#0e9f5a)}.xo-t-muted .xo-kv{color:var(--muted)}
      .xo-ks{font-size:11.5px;color:var(--muted);line-height:1.4}.xo-kd{font-size:11px;font-weight:700;margin-top:6px}
      .xo-slos{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;align-items:stretch}
      .xo-slos>*{min-width:0}
      .xo-slo{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;padding:12px;text-align:center;transition:box-shadow .2s,transform .2s}
      a.xo-slo:hover{transform:translateY(-1px);box-shadow:var(--shadow,0 10px 26px rgba(15,23,42,.10))}
      .xo-slo.ok{border-left-color:var(--green,#0e9f5a)}.xo-slo.warn{border-left-color:#d97706}.xo-slo.breach{border-left-color:#dc2626}.xo-slo.nowire{opacity:.7;border-left-style:dashed}
      .xo-si{font-size:18px;font-weight:800}.xo-slo.ok .xo-si{color:var(--green,#0e9f5a)}.xo-slo.warn .xo-si{color:#d97706}.xo-slo.breach .xo-si{color:#dc2626}.xo-slo.nowire .xo-si{color:var(--muted)}
      .xo-sn{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:800;margin:4px 0}
      .xo-sa{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}.xo-st{font-size:10.5px;color:var(--muted);margin-top:3px}
      /* a contact is a control: pointer, a visible focus ring for the keyboard, and a hit target
         big enough that a 3px dead star is still clickable */
      .xo-blip[data-cell]{cursor:pointer}
      .xo-blip[data-cell]:hover .xo-dot,.xo-blip[data-cell]:focus-visible .xo-dot,.xo-blip.sel .xo-dot{stroke-width:2}
      .xo-blip[data-cell]:focus{outline:none}
      .xo-blip[data-cell]:focus-visible .xo-hit,.xo-blip.sel .xo-hit{stroke:var(--xo-beam,#8affd0);stroke-width:1.6;stroke-dasharray:2 2}
      /* ---- the scope console: open contacts, typed out beside the scope (never over it) ---- */
      .xo-tty{flex:1 1 340px;min-width:0;max-width:430px;align-self:stretch;display:flex;flex-direction:column;
        background:linear-gradient(180deg,rgba(4,16,11,.92),rgba(4,14,10,.97));
        border:1px solid rgba(55,211,154,.24);border-radius:12px;overflow:hidden;
        box-shadow:inset 0 0 50px rgba(55,211,154,.06)}
      .xo-tty-bar{display:flex;align-items:center;gap:6px;padding:8px 11px;border-bottom:1px solid rgba(55,211,154,.18);background:rgba(55,211,154,.06)}
      .xo-tty-bar i{width:8px;height:8px;border-radius:50%;background:rgba(55,211,154,.35);flex:none}
      .xo-tty-ttl{flex:1;margin-left:6px;font-size:10.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#8fd8ba;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .xo-tty-b{font:inherit;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;cursor:pointer;
        padding:3px 9px;border-radius:6px;border:1px solid rgba(55,211,154,.4);background:transparent;color:#5ce0aa}
      .xo-tty-b:hover{background:rgba(55,211,154,.14)}
      .xo-tty-out{flex:1;min-height:340px;max-height:min(70vh,560px);overflow:auto;padding:11px 13px 14px;
        font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px;line-height:1.62;
        color:#7fe3b4;text-shadow:0 0 7px rgba(55,211,154,.28);white-space:pre-wrap;word-break:break-word}
      /* hanging indent: a wrapped value stays under its own column instead of falling back to
         the left margin, where it reads as a new field */
      .xo-ttyl{min-height:1.62em;padding-left:12ch;text-indent:-12ch}
      .xo-ttyl.hd{color:#c9ffe6;font-weight:700;margin-top:4px}
      .xo-ttyl.hd.p1{color:#ff8f8f}.xo-ttyl.hd.p2{color:#ffcc6b}.xo-ttyl.hd.p3{color:#9ccbff}
      .xo-ttyl.dim{color:#4f9c79}.xo-ttyl.rule{color:#37d39a;opacity:.55;letter-spacing:1px}
      .xo-ttyl.bad{color:#ff7b7b;text-shadow:0 0 8px rgba(255,95,95,.35)}
      .xo-ttyl.good{color:#54efb2}.xo-ttyl.na{color:#4f8f72;font-style:italic}
      .xo-ttyl.tick{color:#7cc0ff}.xo-ttyl.msg{color:#a9d9c3;opacity:.9}
      .xo-tty-out.typing .xo-ttyl:last-child::after{content:'▌';margin-left:1px;animation:xoCaret 1s steps(1) infinite;color:#8affd0}
      @keyframes xoCaret{50%{opacity:0}}
      .xo-tty-out::-webkit-scrollbar{width:8px}
      .xo-tty-out::-webkit-scrollbar-thumb{background:rgba(55,211,154,.22);border-radius:8px}
      .xo-bgrp{margin-bottom:15px}.xo-bgrp:last-child{margin-bottom:0}
      .xo-bgh{display:flex;align-items:center;gap:10px;margin:0 0 9px}
      .xo-bgh i{flex:1;height:1px;background:var(--line)}
      .xo-bgh .xo-biz{margin-right:0}
      .xo-charts{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:stretch}
      .xo-charts>*{min-width:0;height:100%}
      @media (min-width:820px){.xo-charts{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media (min-width:1480px){.xo-charts:has(>*:nth-child(3):last-child),.xo-charts:has(>*:nth-child(5)){grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media (min-width:820px) and (max-width:1479px){.xo-charts:has(>*:nth-child(odd):last-child)>*:last-child{grid-column:1/-1}}
      @media (min-width:1480px){.xo-charts:has(>*:nth-child(5):last-child){grid-template-columns:repeat(6,minmax(0,1fr))}.xo-charts:has(>*:nth-child(5):last-child)>*{grid-column:span 2}.xo-charts:has(>*:nth-child(5):last-child)>*:nth-child(n+4){grid-column:span 3}.xo-charts:has(>*:nth-child(7):last-child)>*:last-child{grid-column:1/-1}}
      .xo-chart{padding:12px 14px;display:flex;flex-direction:column}
      .xo-csub{font-size:10.5px;color:var(--muted);margin:-3px 0 6px;line-height:1.4}.xo-ct{font-size:12.5px;font-weight:800;margin-bottom:6px}.xo-svg{width:100%;height:auto;display:block;font-family:inherit}
      .xo-health{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;align-items:stretch}
      .xo-health>*{min-width:0}
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
      .xo-missing{margin:10px 0;padding:10px 14px;border:1px solid color-mix(in srgb,#d97706 35%,transparent);background:color-mix(in srgb,#d97706 10%,transparent);border-left:4px solid #d97706;border-radius:10px;font-size:12.5px;line-height:1.5}
      .xo-foot{margin:20px 0 6px;font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px;line-height:1.6}
      html[dir=rtl] .xo-summary,html[dir=rtl] .xo-slo,html[dir=rtl] .xo-al{border-left:1px solid var(--line);border-right:4px solid var(--c,var(--line))}
      html[dir=rtl] .xo-tbl th,html[dir=rtl] .xo-tbl td{text-align:right}html[dir=rtl] .xo-biz{margin-right:0;margin-left:6px}
      @media (max-width:720px){.xo-grid{grid-template-columns:repeat(2,1fr)}.xo-kv{font-size:22px}.xo-charts,.xo-sumgrid{grid-template-columns:1fr}.xo-h{font-size:17px}.xo-slos,.xo-health{grid-template-columns:repeat(2,1fr)}#view-execops{padding:10px 12px 24px}}
      @media (max-width:420px){.xo-grid,.xo-slos,.xo-health{grid-template-columns:1fr}}
      .xo-block{margin-top:24px;padding-top:4px;border-top:1px solid var(--line)}
      #fxOps:not(:empty){margin:0 0 6px}
      #fxOps .xo-head{margin-top:0}
      #homeOps:not(:empty){margin:0 0 10px}
      #homeOps .xo-block{margin-top:0;padding-top:0;border-top:0}
      /* ---- the scope is an instrument, not a chart: it keeps its own dark-phosphor palette in
             BOTH themes, and redefines --ink/--muted/--line locally so the legend beside it
             inherits the instrument look instead of the page's. ---- */
      .xo-scope{--ink:#e3f6ec;--muted:#79ab95;--line:rgba(55,211,154,.20);--card:#082016;
        --xo-grid:#37d39a;--xo-plate:#06180f;--xo-face1:#123a2a;--xo-face2:#0a2419;--xo-face3:#05130d;
        --xo-p1:#ff5f5f;--xo-p2:#ffb224;--xo-p3:#57a8ff;--green:#37d39a;--xo-beam:#8affd0;
        background:radial-gradient(120% 120% at 50% 0%,#0d2a1e 0%,#082016 55%,#05140e 100%);
        border-color:rgba(55,211,154,.24);color:#e3f6ec;
        box-shadow:inset 0 0 90px rgba(55,211,154,.07),0 12px 34px rgba(0,0,0,.28);padding:18px}
      .xo-scope .xo-link{color:#5ce0aa}
      .xo-scope .xo-biz{border-color:rgba(55,211,154,.35)}
      .xo-radarwrap{display:flex;gap:22px;align-items:center;flex-wrap:wrap;justify-content:center}
      .xo-radar{width:min(520px,100%);height:auto;flex:1 1 360px;max-width:520px;overflow:visible}
      .xo-sweepg{transform-origin:210px 210px;animation:xoSweep 8s linear infinite}
      @keyframes xoSweep{from{transform:rotate(0)}to{transform:rotate(360deg)}}
      .xo-sweep{opacity:1}.xo-scan{pointer-events:none;mix-blend-mode:multiply;opacity:.5}
      .xo-live .xo-dot{animation:xoFound 8s linear infinite backwards;animation-delay:var(--d,0s);transform-box:fill-box;transform-origin:50% 50%}
      .xo-live .xo-halo{opacity:0;animation:xoHalo 8s linear infinite backwards;animation-delay:var(--d,0s)}
      .xo-live .xo-ping{opacity:0;animation:xoPing 8s linear infinite backwards;animation-delay:var(--d,0s);transform-box:fill-box;transform-origin:50% 50%}
      .xo-live .xo-lock{animation:xoLock 8s linear infinite backwards;animation-delay:var(--d,0s);transform-box:fill-box;transform-origin:50% 50%}
      /* an OPEN contact never fades below legible - the sweep adds the pop, it does not gate
       * visibility. Only cleared rules (dead stars) live in the dark. */
      @keyframes xoFound{0%{opacity:.82;transform:scale(1)}3%{opacity:1;transform:scale(1.45)}9%{opacity:1;transform:scale(1)}60%{opacity:.94}100%{opacity:.82;transform:scale(1)}}
      @keyframes xoHalo{0%{opacity:.1}3%{opacity:.5}26%{opacity:.14}100%{opacity:.1}}
      @keyframes xoPing{0%{opacity:0;transform:scale(.5)}2%{opacity:.85;transform:scale(.7)}14%{opacity:0;transform:scale(2.6)}100%{opacity:0;transform:scale(2.6)}}
      @keyframes xoLock{0%{opacity:.45;transform:scale(1)}2%{opacity:.9;transform:scale(1.3)}8%{opacity:.8;transform:scale(1)}100%{opacity:.45;transform:scale(1)}}
      /* cleared rules are dead stars: hollow, dim, no ping - the beam only glints off them */
      .xo-dead .xo-dot{opacity:.18;animation:xoDead 8s linear infinite backwards;animation-delay:var(--d,0s)}
      .xo-dead .xo-core{opacity:.26}
      .xo-dead:hover .xo-dot,.xo-dead:hover .xo-core{opacity:.9}
      @keyframes xoDead{0%{opacity:.13}3%{opacity:.48}16%{opacity:.2}100%{opacity:.13}}
      @media (prefers-reduced-motion:reduce){.xo-sweepg{animation:none}.xo-blip .xo-dot{animation:none;opacity:1}
        .xo-live .xo-lock{animation:none;opacity:.5}.xo-dead .xo-dot{opacity:.3}
        .xo-blip .xo-halo{animation:none;opacity:.16}.xo-blip .xo-ping{animation:none;opacity:0}}
      .xo-radarlegend{min-width:210px;flex:1 1 210px;max-width:320px;font-size:12px}
      .xo-rl-tot{font-size:36px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;margin-bottom:10px}
      .xo-rl-tot.hot{color:var(--xo-p1,#dc2626);text-shadow:0 0 18px rgba(255,95,95,.35)}
      .xo-rl-tot.calm{color:#37d39a;text-shadow:0 0 18px rgba(55,211,154,.3)}
      .xo-rl-tot span{display:block;font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-top:3px}
      .xo-rlh2{display:flex;justify-content:space-between;font-size:9.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;padding-bottom:4px;margin-bottom:2px;border-bottom:1px solid var(--line)}
      .xo-rl-h{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;font-weight:800;margin-bottom:8px}
      .xo-rl{display:flex;align-items:center;gap:8px;padding:3px 0;font-variant-numeric:tabular-nums}
      .xo-rl i{width:10px;height:10px;border-radius:50%;flex:none}.xo-rl b{width:26px}.xo-rl>span{color:var(--muted)}
      .xo-rlb{flex:1;height:6px;border-radius:999px;background:rgba(255,255,255,.10);overflow:hidden;min-width:34px}
      .xo-rlb u{display:block;height:100%;border-radius:999px;text-decoration:none}
      .xo-rln{width:62px;text-align:right;color:var(--ink);font-weight:700}
      .xo-rln em{font-style:normal;font-weight:600;color:var(--muted)}
      .xo-rl-d{font-size:10.5px;color:var(--muted);margin-top:8px;line-height:1.5}
      .xo-lg{display:inline-flex;align-items:center;gap:5px;margin-right:10px;white-space:nowrap}
      .xo-lg i{width:9px;height:9px;border-radius:50%;flex:none}
      .xo-lg-live{background:#37d39a;box-shadow:0 0 0 3px rgba(55,211,154,.22)}
      .xo-lg-dead{background:transparent;border:1.5px solid #37d39a;opacity:.5}
      /* business = shape, the same glyphs the scope draws */
      .xo-rl-biz{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;padding-top:9px;border-top:1px solid var(--line)}
      .xo-bz{display:inline-flex;align-items:center;gap:6px;font-size:11px}
      .xo-bz b{font-weight:800;letter-spacing:.3px}.xo-bz>span{color:var(--muted);font-variant-numeric:tabular-nums}
      .xo-gl{width:10px;height:10px;flex:none;border:1.6px solid currentColor;color:#37d39a}
      .xo-gl-mobile{border-radius:50%}
      .xo-gl-fixed{transform:rotate(45deg);border-radius:2px}
      .xo-brief{border-color:var(--green,#0e9f5a);color:var(--green,#0e9f5a);font-weight:800}
      .xo-modal{position:fixed;inset:0;z-index:3000;background:rgba(8,12,20,.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:22px;animation:xoFade .18s ease}
      @keyframes xoFade{from{opacity:0}to{opacity:1}}
      .xo-modal-in{background:var(--card);border:1px solid var(--line);border-radius:14px;width:min(1400px,100%);height:min(88vh,100%);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)}
      .xo-modal-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line);font-size:13px;flex-wrap:wrap}
      .xo-modal-tools{display:flex;gap:8px;align-items:center}.xo-modal-tools .xo-btn{text-decoration:none}
      .xo-modal-in iframe{flex:1;width:100%;border:0;background:#050a08}
      @media (max-width:1180px){.xo-tty{max-width:none;flex-basis:100%;order:3}.xo-tty-out{min-height:260px;max-height:340px}}
      @media (max-width:820px){.xo-radarwrap{flex-direction:column;gap:14px}.xo-radar{flex:none;width:min(420px,100%)}.xo-radarlegend{max-width:none;width:100%}.xo-modal{padding:8px}}
      @media print{.xo-tools,.xo-range,.xo-modal{display:none}.xo-kpi,.xo-slo,.xo-chart,.xo-hi{break-inside:avoid}}`;
    document.head.appendChild(st);
  }
})();
