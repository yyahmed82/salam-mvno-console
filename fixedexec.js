/* fixedexec.js — Fixed › Executive and Fixed › Operations (12 Sep 2026)
 *
 * The two pages the "Fixed Operations AI Agent" used to generate as static HTML (hard-coded to
 * 2026-06-21, dark-only, Chart.js from a CDN 152 cannot reach) — rebuilt as Fixed hub pages that
 * read /api/fixed/exec live. Same story, same sections; the numbers now carry their window.
 *
 *   FIXED_PAGES.exec  Executive — status, summary, north-star KPIs, SLO tiles, two trends, top issues
 *   FIXED_PAGES.ops   Operations — health strip, KPI cards, four trends, pipeline, alerts
 *
 * Charts are inline SVG on theme tokens: no library, both themes, RTL-safe, prints. One fetch is
 * shared by both pages for 60 s. Nothing here writes. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const num = v => Number(v || 0).toLocaleString('en-US');
  const C = { green: 'var(--green,#0e9f5a)', amber: '#d97706', red: '#dc2626', blue: '#2563eb', muted: 'var(--muted)', line: 'var(--line)', ink: 'var(--ink)' };
  const SEV = { CRITICAL: C.red, WARNING: C.amber, HEALTHY: C.green };
  const KSA = 3 * 3600e3;
  const ts = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? esc(v) : new Date(d.getTime() + KSA).toISOString().replace('T', ' ').slice(0, 16); };
  const dmy = d => d.slice(5);   // 2026-09-12 → 09-12 on the x axis

  let cache = { at: 0, range: null, data: null, promise: null };
  async function load(fx, force) {
    const range = fx.state.range === '30d' || fx.state.range === '90d' ? '30d' : '7d';
    if (!force && cache.data && cache.range === range && Date.now() - cache.at < 60e3) return cache.data;
    if (cache.promise && cache.range === range) return cache.promise;
    cache.range = range;
    cache.promise = fx.api(`/api/fixed/exec?range=${range}`).then(d => { cache.data = d; cache.at = Date.now(); cache.promise = null; return d; }, e => { cache.promise = null; throw e; });
    return cache.promise;
  }

  /* ---------- charts (inline SVG, viewBox scaled, theme tokens) ---------- */
  const W = 600, H = 220, PL = 34, PR = 8, PT = 10, PB = 26;
  const yScale = (max) => v => PT + (H - PT - PB) * (1 - (max ? v / max : 0));
  const xScale = (nPts) => i => PL + (W - PL - PR) * (nPts > 1 ? i / (nPts - 1) : 0.5);
  const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  const grid = (max, fmt) => [0, .25, .5, .75, 1].map(f => { const y = yScale(max)(max * f); return `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" stroke="${C.line}" stroke-width="1"/><text x="${PL - 6}" y="${y + 4}" font-size="10" fill="${C.muted}" text-anchor="end">${fmt ? fmt(max * f) : Math.round(max * f)}</text>`; }).join('');
  const xLabels = (days) => { const step = days.length > 12 ? Math.ceil(days.length / 8) : 1; const xs = xScale(days.length); return days.map((d, i) => i % step === 0 || i === days.length - 1 ? `<text x="${xs(i)}" y="${H - 8}" font-size="10" fill="${C.muted}" text-anchor="middle">${dmy(d.day)}</text>` : '').join(''); };
  const wrap = (inner, title) => `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title || '')}" style="width:100%;height:auto;display:block;font-family:inherit">${inner}</svg>`;

  function lineChart(days, key, color, title) {
    const vals = days.map(d => Number(d[key] || 0)), max = niceMax(Math.max(...vals, 1));
    const ys = yScale(max), xs = xScale(days.length);
    const pts = vals.map((v, i) => `${xs(i)},${ys(v)}`).join(' ');
    const area = `${PL},${ys(0)} ${pts} ${xs(days.length - 1)},${ys(0)}`;
    return wrap(`${grid(max)}<polygon points="${area}" fill="${color}" opacity=".12"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
      ${vals.map((v, i) => `<circle cx="${xs(i)}" cy="${ys(v)}" r="3.5" fill="${color}"><title>${esc(days[i].day)}: ${num(v)}</title></circle>`).join('')}${xLabels(days)}`, title);
  }
  function barChart(days, key, title, threshold, colorOf) {
    const vals = days.map(d => Number(d[key] || 0)), max = niceMax(Math.max(...vals, threshold || 0, 1));
    const ys = yScale(max), xs = xScale(days.length), bw = Math.max(6, (W - PL - PR) / days.length * 0.6);
    const bars = vals.map((v, i) => `<rect x="${xs(i) - bw / 2}" y="${ys(v)}" width="${bw}" height="${ys(0) - ys(v)}" rx="3" fill="${colorOf ? colorOf(v) : C.blue}"><title>${esc(days[i].day)}: ${num(v)}</title></rect>`).join('');
    const thr = threshold ? `<line x1="${PL}" x2="${W - PR}" y1="${ys(threshold)}" y2="${ys(threshold)}" stroke="${C.red}" stroke-width="2" stroke-dasharray="6 5"/><text x="${W - PR - 4}" y="${ys(threshold) - 5}" font-size="10" fill="${C.red}" text-anchor="end" font-weight="700">budget ${threshold}/day</text>` : '';
    return wrap(`${grid(max)}${bars}${thr}${xLabels(days)}`, title);
  }
  function hbarChart(rows, title) {   // horizontal bars, one per pipeline step
    const rh = 22, h = Math.max(60, rows.length * rh + 12), max = Math.max(...rows.map(r => r.n), 1), lw = 250;
    const body = rows.map((r, i) => { const y = 6 + i * rh, w = (W - lw - 60) * r.n / max, col = r.n >= 1000 ? C.red : r.n >= 500 ? C.amber : C.blue;
      return `<text x="${lw - 8}" y="${y + 15}" font-size="11" fill="${C.ink}" text-anchor="end">${esc(r.step.length > 34 ? r.step.slice(0, 33) + '…' : r.step)}</text><rect x="${lw}" y="${y + 3}" width="${Math.max(2, w)}" height="${rh - 8}" rx="3" fill="${col}"><title>${esc(r.step)}: ${num(r.n)}</title></rect><text x="${lw + w + 6}" y="${y + 15}" font-size="11" fill="${C.muted}" font-weight="700">${num(r.n)}</text>`; }).join('');
    return `<svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}" style="width:100%;height:auto;display:block;font-family:inherit">${body}</svg>`;
  }
  const spark = (vals, color) => { const w = 110, h = 28, max = Math.max(...vals, 1); const pts = vals.map((v, i) => `${(i / Math.max(vals.length - 1, 1)) * w},${h - 3 - (h - 6) * v / max}`).join(' '); return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/></svg>`; };

  /* ---------- pieces ---------- */
  const statusBadge = s => `<span class="fxe-badge" style="--c:${SEV[s] || C.muted}">${s === 'CRITICAL' ? '●' : s === 'WARNING' ? '●' : '●'} ${esc(s)}</span>`;
  const trendMark = t => t === 'improving' ? `<span style="color:${C.green};font-weight:700">▼ improving</span>` : t === 'worsening' ? `<span style="color:${C.red};font-weight:700">▲ worsening</span>` : `<span style="color:${C.muted};font-weight:700">→ stable</span>`;
  const delta = (d, invert) => { if (d == null) return ''; const good = invert ? d <= 0 : d >= 0; return `<span class="fxe-delta" style="color:${d === 0 ? C.muted : good ? C.green : C.red}">${d > 0 ? '+' : ''}${d}% vs prev 24 h</span>`; };
  const kpi = (title, value, sub, tone, extra) => `<div class="fxe-kpi fxe-${tone || 'neutral'}"><div class="fxe-kt">${esc(title)}</div><div class="fxe-kv" style="${tone === 'red' ? `color:${C.red}` : tone === 'amber' ? `color:${C.amber}` : tone === 'green' ? `color:${C.green}` : tone === 'muted' ? `color:${C.muted}` : ''}">${value}</div><div class="fxe-ks">${sub || ''}</div>${extra || ''}</div>`;
  const slo = s => `<div class="fxe-slo ${s.measured ? (s.ok ? 'ok' : 'breach') : 'nowire'}"><div class="fxe-si">${s.measured ? (s.ok ? '✓' : '✕') : '○'}</div><div class="fxe-sn">${esc(s.name)}</div><div class="fxe-sa">${esc(s.actual)}</div><div class="fxe-st">${s.measured ? 'Target: ' + esc(s.target) : esc(s.note || 'not wired')}</div></div>`;
  const head = (d, fx, title, sub) => `<div class="fxe-head"><div><h2 class="fxe-h">${title}</h2><div class="fxe-meta">${sub} · window ${ts(d.window.from)} → ${ts(d.window.to)} KSA · source ${esc(d.source || '—')}${d.freshness && d.freshness.newest_attempt ? ' · newest attempt ' + ts(d.freshness.newest_attempt) : ''}</div></div><div class="fxe-tools">${fx.rangeChips('')}<button type="button" class="fxe-btn" data-act="refresh">↻ Refresh</button></div></div>`;
  const notConfigured = (host, d) => { host.innerHTML = `<div class="topo-card" style="padding:18px"><b>Fixed read models not configured</b><div style="color:var(--muted);margin-top:6px">${esc(d.reason || 'OPS_DATABASE_URL / OPS_BETA_DATABASE_URL not set')}</div></div>`; };
  const failed = (host, e) => { host.innerHTML = `<div class="topo-card" style="padding:18px;border-left:4px solid ${C.red}"><b>Could not load</b><div style="color:var(--muted);margin-top:6px">${esc(e.message)}</div></div>`; };

  function issuesTable(d) {
    if (!d.issues.length) return `<div class="fxe-empty">No open Fixed error category in this window.</div>`;
    return `<div class="tscroll"><table class="fxe-tbl"><thead><tr><th>Severity</th><th>Issue</th><th>Open / total</th><th>First seen</th><th>Trend</th><th>Where to act</th></tr></thead><tbody>${d.issues.map(i => {
      const sev = i.open >= 100 ? 'critical' : i.open >= 20 ? 'warning' : 'info';
      return `<tr><td><span class="fxe-sev ${sev}">${sev}</span></td><td><b>${esc(i.category)}</b></td><td>${num(i.open)} / ${num(i.total)}</td><td>${ts(i.first_seen).slice(0, 10)}<br><span class="fxe-dim">${i.daysOngoing} day(s) ongoing</span></td><td>${trendMark(i.trend)}<br>${spark(i.spark, sev === 'critical' ? C.red : sev === 'warning' ? C.amber : C.blue)}</td><td><a href="#fixed?tab=errors" class="fxe-link">Error control board →</a></td></tr>`; }).join('')}</tbody></table></div>`;
  }
  function alertsList(d) {
    if (!d.alerts.length) return `<div class="fxe-empty">No Fixed alert fired in this window.</div>`;
    return d.alerts.map(a => { const cls = a.severity === 'P1' ? 'critical' : a.severity === 'P2' ? 'warning' : 'info';
      return `<div class="fxe-al ${cls}"><span class="fxe-ai">${cls === 'critical' ? '🔴' : cls === 'warning' ? '🟠' : 'ℹ️'}</span><div class="fxe-at"><b>${esc(a.severity)} · ${esc(a.rule_name || a.rule_key)}</b>${a.metric_text ? ` — ${esc(a.metric_text)}` : a.metric_value != null ? ` — ${esc(a.metric_value)} vs ${esc(a.threshold)}` : ''}${a.team ? `<span class="fxe-dim"> · ${esc(a.team)}</span>` : ''}</div><span class="fxe-dim">${ts(a.fired_at)}</span></div>`; }).join('');
  }

  /* ---------- page 1 · Executive ---------- */
  function renderExec(host, d, fx) {
    const k = d.kpis;
    host.innerHTML = `
      ${head(d, fx, `📈 Executive overview — Fixed`, `north-star KPIs · SLOs · top issues`)}
      <div class="fxe-status">${statusBadge(d.status)}<span class="fxe-dim">${k.critical} critical · ${k.warnings} warning · ${num(k.alerts24)} alert(s) fired in 24 h</span></div>
      <div class="fxe-sec">📝 Executive summary</div>
      <div class="fxe-summary" style="--c:${SEV[d.status]}">${d.summary.map(s => `<div>${esc(s)}</div>`).join('')}</div>
      <div class="fxe-sec">⭐ North-star KPIs <span class="fxe-dim">last 24 h</span></div>
      <div class="fxe-grid">
        ${kpi('Service availability', '—', 'SADAD / SFTP probes not wired — not measured', 'muted')}
        ${kpi('Daily orders (attempts)', num(k.attempts), `${num(k.completed)} completed · ${num(k.withOrder)} with a BSS order`, 'green', delta(k.attemptsDelta))}
        ${kpi('Order funnel health', `${k.conversion}%`, `${num(k.stuck)} stalled / in progress${k.pileup ? ` · ${num(k.pileup.n)} at ${esc(k.pileup.step)}` : ''}`, k.conversion < Math.max(0, k.conversion7d - 5) ? 'red' : 'green', `<span class="fxe-delta" style="color:${C.muted}">${k.conversion7d}% ${d.days.length}-day avg</span>`)}
        ${kpi('API errors', num(k.errors24), `budget ${k.errorBudget}/day — ${k.errors24 > k.errorBudget ? 'exceeded' : 'within budget'}`, k.errors24 > k.errorBudget ? 'red' : 'green')}
        ${kpi('Active critical signals', num(k.critical), `${k.bySeverity.P1 || 0} P1 · ${k.bySeverity.P2 || 0} P2 · ${k.bySeverity.P3 || 0} P3 fired in ${d.days.length} d`, k.critical ? 'red' : 'green')}
        ${kpi('Daily revenue', '—', 'connect the billing feed to activate', 'muted')}
      </div>
      <div class="fxe-sec">🎯 SLO compliance</div>
      <div class="fxe-slos">${d.slos.map(slo).join('')}</div>
      <div class="fxe-sec">📊 Trends <span class="fxe-dim">${d.days.length} days, KSA</span></div>
      <div class="fxe-charts">
        <div class="topo-card fxe-chart"><div class="fxe-ct">📦 Daily order attempts</div>${lineChart(d.days, 'orders', C.green, 'Daily order attempts')}</div>
        <div class="topo-card fxe-chart"><div class="fxe-ct">⚠️ API errors vs budget</div>${barChart(d.days, 'errors', 'API errors per day', k.errorBudget, v => v >= k.errorBudget ? C.red : v >= k.errorBudget * 0.6 ? C.amber : C.green)}</div>
      </div>
      <div class="fxe-sec">🔥 Top ongoing issues</div>
      <div class="topo-card" style="padding:12px 14px">${issuesTable(d)}</div>
      <div class="fxe-foot">Generated ${ts(d.generatedAt)} KSA · ${esc(d.provisional)}</div>`;
  }

  /* ---------- page 2 · Operations ---------- */
  function renderOps(host, d, fx) {
    const k = d.kpis;
    const chan = (d.byChannel || []).map(c => `<div class="fxe-hi"><div class="fxe-hl">${esc(c.channel)}</div><div class="fxe-hv">${num(c.n)}<span class="fxe-dim"> · ${c.conversion}%</span></div></div>`).join('');
    host.innerHTML = `
      ${head(d, fx, `🔧 Fixed operations`, `health · trends · pipeline · alerts`)}
      <div class="fxe-status">${statusBadge(d.status)}
        <span class="fxe-pill critical">🔴 P1: ${k.bySeverity.P1 || 0}</span><span class="fxe-pill warning">🟠 P2: ${k.bySeverity.P2 || 0}</span><span class="fxe-pill info">ℹ️ P3: ${k.bySeverity.P3 || 0}</span></div>
      <div class="fxe-sec">📊 Key performance indicators <span class="fxe-dim">last 24 h</span></div>
      <div class="fxe-grid">
        ${kpi('Order attempts', num(k.attempts), 'FTTH · 5G · e-purchase · Salam Home', null, delta(k.attemptsDelta))}
        ${kpi('Completed', num(k.completed), `${k.conversion}% conversion`, k.conversion < Math.max(0, k.conversion7d - 5) ? 'red' : 'green')}
        ${kpi('API errors', num(k.errors24), `budget ${k.errorBudget}/day`, k.errors24 > k.errorBudget ? 'red' : null)}
        ${kpi('Order pileup', k.pileup ? num(k.pileup.n) : '0', k.pileup ? `${esc(k.pileup.step)} · ${d.days.length}-day window` : 'no step is accumulating', k.pileup && k.pileup.n >= 1000 ? 'red' : k.pileup && k.pileup.n >= 500 ? 'amber' : null)}
      </div>
      <div class="fxe-sec">🏥 System health checks</div>
      <div class="fxe-health">
        <div class="fxe-hi"><div class="fxe-hl">Read model</div><div class="fxe-hv ${d.freshness && d.freshness.stale ? 'warn' : 'up'}">${d.freshness && d.freshness.newest_attempt ? ts(d.freshness.newest_attempt) : '—'}<div class="fxe-dim">${d.freshness && d.freshness.lag_min != null ? 'watcher lag ' + d.freshness.lag_min + ' min' : 'watcher lag unknown'}</div></div></div>
        <div class="fxe-hi"><div class="fxe-hl">Nafath fail rate</div><div class="fxe-hv ${(d.slos.find(s => s.key === 'nafath') || {}).ok === false ? 'down' : 'up'}">${esc((d.slos.find(s => s.key === 'nafath') || {}).actual)}</div></div>
        <div class="fxe-hi"><div class="fxe-hl">Manafith denials</div><div class="fxe-hv ${(d.slos.find(s => s.key === 'manafith') || {}).ok === false ? 'down' : 'up'}">${esc((d.slos.find(s => s.key === 'manafith') || {}).actual)}</div></div>
        <div class="fxe-hi"><div class="fxe-hl">SADAD</div><div class="fxe-hv nowire">not wired</div></div>
        <div class="fxe-hi"><div class="fxe-hl">SFTP ODB sync</div><div class="fxe-hv nowire">not wired</div></div>
        ${chan}
      </div>
      <div class="fxe-sec">📈 Trends &amp; analytics <span class="fxe-dim">${d.days.length} days, KSA</span></div>
      <div class="fxe-charts">
        <div class="topo-card fxe-chart"><div class="fxe-ct">📦 Order attempts</div>${lineChart(d.days, 'orders', C.blue, 'Order attempts')}</div>
        <div class="topo-card fxe-chart"><div class="fxe-ct">✅ Completed orders</div>${lineChart(d.days, 'completed', C.green, 'Completed orders')}</div>
        <div class="topo-card fxe-chart"><div class="fxe-ct">⚠️ API errors</div>${barChart(d.days, 'errors', 'API errors', k.errorBudget, v => v >= k.errorBudget ? C.red : v >= k.errorBudget * 0.6 ? C.amber : C.green)}</div>
        <div class="topo-card fxe-chart"><div class="fxe-ct">🧯 Still-open errors by day</div>${barChart(d.days, 'openErrors', 'Open errors', 0, () => C.amber)}</div>
      </div>
      <div class="fxe-sec">📋 Order pipeline — where not-completed attempts stopped <span class="fxe-dim">${d.days.length}-day window</span></div>
      <div class="topo-card fxe-chart">${d.pipeline.length ? hbarChart(d.pipeline, 'Pipeline steps') : `<div class="fxe-empty">Every attempt in the window completed.</div>`}</div>
      <div class="fxe-sec">🚨 Alerts fired <span class="fxe-dim">${d.days.length} d</span></div>
      <div class="topo-card" style="padding:12px 14px">${alertsList(d)}</div>
      <div class="fxe-foot">Generated ${ts(d.generatedAt)} KSA · ${esc(d.provisional)}</div>`;
  }

  async function page(which, host, fx) {
    ensureCss();
    host.innerHTML = `<div class="fxe-loading">Loading…</div>`;
    let d; try { d = await load(fx); } catch (e) { return failed(host, e); }
    if (!d.configured) return notConfigured(host, d);
    (which === 'exec' ? renderExec : renderOps)(host, d, fx);
    fx.bindRange(host, () => page(which, host, fx));
    const rb = host.querySelector('[data-act="refresh"]'); if (rb) rb.onclick = async () => { rb.disabled = true; try { await load(fx, true); } finally { page(which, host, fx); } };
  }

  function ensureCss() {
    if ($('#fxeCss')) return;
    const st = document.createElement('style'); st.id = 'fxeCss';
    st.textContent = `
      .fxe-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin:4px 0 10px}
      .fxe-h{margin:0;font-size:18px}.fxe-meta{font-size:11.5px;color:var(--muted);margin-top:3px}
      .fxe-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .fxe-btn{cursor:pointer;font:inherit;font-size:11.5px;font-weight:700;padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:inherit}
      .fxe-btn:hover{border-color:var(--green,#0e9f5a)}
      .fxe-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 4px}
      .fxe-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font-weight:800;font-size:12px;color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 35%,transparent)}
      .fxe-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:8px;font-weight:700;font-size:12px;border:1px solid transparent}
      .fxe-pill.critical{color:#dc2626;background:color-mix(in srgb,#dc2626 12%,transparent);border-color:color-mix(in srgb,#dc2626 30%,transparent)}
      .fxe-pill.warning{color:#d97706;background:color-mix(in srgb,#d97706 12%,transparent);border-color:color-mix(in srgb,#d97706 30%,transparent)}
      .fxe-pill.info{color:#2563eb;background:color-mix(in srgb,#2563eb 12%,transparent);border-color:color-mix(in srgb,#2563eb 30%,transparent)}
      .fxe-sec{font-size:13.5px;font-weight:800;margin:18px 0 10px;display:flex;align-items:center;gap:8px}
      .fxe-dim{font-size:11px;color:var(--muted);font-weight:600}
      .fxe-summary{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:12px;padding:14px 18px;font-size:13.5px;line-height:1.55}
      .fxe-summary div+div{margin-top:5px}
      .fxe-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
      .fxe-kpi{background:var(--card);border:1px solid var(--line);border-top:4px solid var(--line);border-radius:12px;padding:14px 16px;transition:box-shadow .2s,transform .2s}
      .fxe-kpi:hover{box-shadow:var(--shadow,0 8px 24px rgba(15,23,42,.08))}
      .fxe-kpi.fxe-red{border-top-color:#dc2626}.fxe-kpi.fxe-amber{border-top-color:#d97706}.fxe-kpi.fxe-green{border-top-color:var(--green,#0e9f5a)}
      .fxe-kt{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;font-weight:800}
      .fxe-kv{font-size:30px;font-weight:800;line-height:1.15;margin:8px 0 4px;font-variant-numeric:tabular-nums}
      .fxe-ks{font-size:11.5px;color:var(--muted)}.fxe-delta{display:block;font-size:11px;font-weight:700;margin-top:6px}
      .fxe-slos{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
      .fxe-slo{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;padding:14px;text-align:center}
      .fxe-slo.ok{border-left-color:var(--green,#0e9f5a)}.fxe-slo.breach{border-left-color:#dc2626}.fxe-slo.nowire{opacity:.7;border-left-style:dashed}
      .fxe-si{font-size:20px;font-weight:800}.fxe-slo.ok .fxe-si{color:var(--green,#0e9f5a)}.fxe-slo.breach .fxe-si{color:#dc2626}.fxe-slo.nowire .fxe-si{color:var(--muted)}
      .fxe-sn{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:800;margin:4px 0}
      .fxe-sa{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}.fxe-st{font-size:10.5px;color:var(--muted);margin-top:3px}
      .fxe-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}
      .fxe-chart{padding:14px 16px}.fxe-ct{font-size:12.5px;font-weight:800;margin-bottom:8px}
      .fxe-health{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
      .fxe-hi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;text-align:center}
      .fxe-hl{font-size:10.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
      .fxe-hv{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums}.fxe-hv.up{color:var(--green,#0e9f5a)}.fxe-hv.down{color:#dc2626}.fxe-hv.warn{color:#d97706}.fxe-hv.nowire{color:var(--muted);font-weight:600;font-style:italic}
      .fxe-tbl{width:100%;border-collapse:collapse;font-size:12px}.fxe-tbl th{text-align:left;padding:8px 10px;color:var(--muted);font-size:10px;letter-spacing:.6px;text-transform:uppercase;border-bottom:1px solid var(--line)}
      .fxe-tbl td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top}.fxe-tbl tr:last-child td{border-bottom:0}
      .fxe-sev{display:inline-block;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:800;text-transform:uppercase}
      .fxe-sev.critical{color:#dc2626;background:color-mix(in srgb,#dc2626 14%,transparent)}.fxe-sev.warning{color:#d97706;background:color-mix(in srgb,#d97706 14%,transparent)}.fxe-sev.info{color:#2563eb;background:color-mix(in srgb,#2563eb 14%,transparent)}
      .fxe-link{color:var(--green,#0e9f5a);font-weight:700;text-decoration:none}.fxe-link:hover{text-decoration:underline}
      .fxe-al{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;border-left:4px solid var(--line);margin-bottom:8px;background:var(--bg)}
      .fxe-al.critical{border-left-color:#dc2626}.fxe-al.warning{border-left-color:#d97706}.fxe-al.info{border-left-color:#2563eb}
      .fxe-ai{font-size:16px}.fxe-at{flex:1;font-size:12.5px}
      .fxe-empty{padding:22px;text-align:center;color:var(--muted);font-style:italic}
      .fxe-loading{padding:30px;text-align:center;color:var(--muted)}
      .fxe-foot{margin:18px 0 6px;text-align:center;font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px}
      html[dir=rtl] .fxe-summary,html[dir=rtl] .fxe-slo,html[dir=rtl] .fxe-al{border-left:1px solid var(--line);border-right:4px solid var(--c,var(--line))}
      html[dir=rtl] .fxe-tbl th,html[dir=rtl] .fxe-tbl td{text-align:right}
      @media (max-width:640px){.fxe-kv{font-size:24px}.fxe-charts{grid-template-columns:1fr}.fxe-head{flex-direction:column}.fxe-h{font-size:16px}}
      @media print{.fxe-tools{display:none}.fxe-kpi,.fxe-slo,.fxe-chart{break-inside:avoid}}`;
    document.head.appendChild(st);
  }

  window.FIXED_PAGES = window.FIXED_PAGES || {};
  window.FIXED_PAGES.exec = { label: 'Executive', sub: 'north-star KPIs · SLOs · top issues', render: (host, fx) => page('exec', host, fx || window.FX) };
  window.FIXED_PAGES.ops  = { label: 'Operations', sub: 'health · trends · pipeline · alerts', render: (host, fx) => page('ops', host, fx || window.FX) };
})();
