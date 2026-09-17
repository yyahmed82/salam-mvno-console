/* cstpage.js — CST section pages (Super Admin only, 16 Sep 2026)
 *
 *   #arqami            Arqami service health — per-minute traffic / latency of the API Salam exposes to CST
 *   #cst-escalations   CST complaint escalations — classification, closure lag, open cohort, Remedy proof, engagement board
 *
 * Data: /api/cst/* (server/src/cst.js). Arqami is fed live from Oracle EBPROD (cstOracle.js: 60 s poll + history backfill
 * of APPS.YY_REGISTER_NUMBER_AUDIT) with the CSV import as fallback; escalations show the runbook snapshot / RA import above and the LIVE Remedy section (cst-remedy.js,
 * dbo.ITC_CITC_MOH on 172.30.1.14) below it. Charts are inline SVG, tokens for light / dark,
 * phone-first, RTL-safe (Arabic labels are isolated). No third-party script except SheetJS, loaded from cdnjs only
 * when an .xlsx is imported (the browser has internet; 152 does not). */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : esc(v);
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
  const ms = v => v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(2) + ' s' : Math.round(v) + ' ms';
  const KSA = 3 * 3600e3;
  const ksa = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? esc(v) : new Date(d.getTime() + KSA).toISOString().replace('T', ' ').slice(0, 16); };
  const api = (p, opt) => fetch((window.API_BASE || window.CONSOLE_BASE || '') + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt || {})).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
  const T = { ok: 'var(--green,#0e9f5a)', warn: 'var(--xo-p2,#d97706)', bad: 'var(--xo-p1,#dc2626)', info: '#2563eb', muted: 'var(--muted)', line: 'var(--line)' };
  const isSuper = () => { try { const s = (window.opsSession && window.opsSession()) || {}; return !!(s.me && (s.me.realRole === 'super_admin' || (s.me.realRoles || []).includes('super_admin'))); } catch (_) { return false; } };
  const ar = t => `<bdi dir="rtl">${esc(t)}</bdi>`;

  /* ---------- tiny SVG charts ---------- */
  const W = 720, H = 150;
  function area(pts, opts) {   // pts: [{x label, y}], opts: {color, band(i)->color, hline:{y,label}, ymax}
    if (!pts.length) return `<div class="cs-empty">no data</div>`;
    const o = Object.assign({ color: T.ok, ymax: null, hline: null, band: null, unit: '' }, opts || {});
    const ymax = o.ymax || Math.max(1, ...pts.map(p => p.y || 0)) * 1.08;
    const px = i => 36 + i / Math.max(pts.length - 1, 1) * (W - 46), py = v => H - 18 - (Math.min(v, ymax) / ymax) * (H - 28);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(p.y || 0).toFixed(1)}`).join(' ');
    const fill = `${line} L${px(pts.length - 1).toFixed(1)},${H - 18} L36,${H - 18} Z`;
    const bands = o.band ? pts.map((p, i) => { const c = o.band(p, i); return c ? `<rect x="${(px(i) - (W - 46) / pts.length / 2).toFixed(1)}" y="8" width="${((W - 46) / pts.length + .6).toFixed(2)}" height="${H - 26}" fill="${c}" opacity=".16"/>` : ''; }).join('') : '';
    const ticks = [0, .25, .5, .75, 1].map(f => `<text x="32" y="${(py(f * ymax) + 3).toFixed(1)}" class="cs-tk">${o.fmt ? o.fmt(f * ymax) : Math.round(f * ymax)}</text><line x1="36" x2="${W - 10}" y1="${py(f * ymax).toFixed(1)}" y2="${py(f * ymax).toFixed(1)}" class="cs-gl"/>`).join('');
    const xl = pts.filter((p, i) => i % Math.ceil(pts.length / 8) === 0 || i === pts.length - 1).map(p => `<text x="${px(pts.indexOf(p)).toFixed(1)}" y="${H - 5}" class="cs-tk cs-tx">${esc(p.x)}</text>`).join('');
    const hl = o.hline ? `<line x1="36" x2="${W - 10}" y1="${py(o.hline.y).toFixed(1)}" y2="${py(o.hline.y).toFixed(1)}" class="cs-hl"/><text x="${W - 12}" y="${(py(o.hline.y) - 4).toFixed(1)}" class="cs-tk" text-anchor="end" fill="${T.bad}">${esc(o.hline.label)}</text>` : '';
    const dots = pts.map((p, i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(p.y || 0).toFixed(1)}" r="6" fill="transparent"><title>${esc(p.x)} · ${esc(o.fmt ? o.fmt(p.y) : p.y)}${p.t ? ' · ' + esc(p.t) : ''}</title></circle>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="cs-svg" role="img" style="direction:ltr">${bands}${ticks}<path d="${fill}" fill="${o.color}" opacity=".12"/><path d="${line}" fill="none" stroke="${o.color}" stroke-width="1.8" stroke-linejoin="round"/>${hl}${xl}${dots}</svg>`;
  }
  function hbars(items, opts) {   // items: [{label, count, color?, sub?}]
    const o = Object.assign({ max: null, total: null }, opts || {});
    const max = o.max || Math.max(1, ...items.map(i => i.count));
    return `<div class="cs-hb">${items.map(i => `<div class="cs-hbr"><div class="cs-hbl">${i.html || ar(i.label)}${i.sub ? `<small>${i.sub}</small>` : ''}</div><div class="cs-hbt"><i style="width:${Math.max(1.5, i.count / max * 100).toFixed(1)}%;background:${i.color || T.ok}"></i></div><div class="cs-hbv">${num(i.count)}${o.total ? `<small>${pct(i.count, o.total)}%</small>` : ''}</div></div>`).join('')}</div>`;
  }
  function cols(pts, opts) {   // pts: [{x label, y, key, t tooltip, color?}] — clickable columns (data-day = key), optional line series opts.line: [{y}]
    if (!pts.length) return `<div class="cs-empty">no data</div>`;
    const o = Object.assign({ color: T.info, ymax: null, fmt: null, line: null, lineColor: T.warn, lineMax: null, hline: null, sel: null }, opts || {});
    const ymax = o.ymax || Math.max(1, ...pts.map(p => p.y || 0)) * 1.1;
    const iw = (W - 46) / pts.length, px = i => 36 + i * iw, py = v => H - 18 - (Math.min(v, ymax) / ymax) * (H - 28);
    const ticks = [0, .5, 1].map(f => `<text x="32" y="${(py(f * ymax) + 3).toFixed(1)}" class="cs-tk">${o.fmt ? o.fmt(f * ymax) : Math.round(f * ymax)}</text><line x1="36" x2="${W - 10}" y1="${py(f * ymax).toFixed(1)}" y2="${py(f * ymax).toFixed(1)}" class="cs-gl"/>`).join('');
    const bars = pts.map((p, i) => `<rect class="cs-col ${o.sel === p.key ? 'on' : ''}" data-day="${esc(p.key || '')}" x="${(px(i) + iw * .12).toFixed(1)}" y="${py(p.y || 0).toFixed(1)}" width="${(iw * .76).toFixed(1)}" height="${(H - 18 - py(p.y || 0)).toFixed(1)}" rx="2" fill="${p.color || o.color}"><title>${esc(p.x)} · ${esc(o.fmt ? o.fmt(p.y) : num(p.y))}${p.t ? ' · ' + esc(p.t) : ''}</title></rect>`).join('');
    let line = '';
    if (o.line) { const lmax = o.lineMax || Math.max(1, ...o.line.map(q => q.y || 0)) * 1.1, ly = v => H - 18 - (Math.min(v, lmax) / lmax) * (H - 28);
      line = `<path d="${o.line.map((q, i) => `${i ? 'L' : 'M'}${(px(i) + iw / 2).toFixed(1)},${ly(q.y || 0).toFixed(1)}`).join(' ')}" fill="none" stroke="${o.lineColor}" stroke-width="1.8" stroke-linejoin="round"/>` + o.line.map((q, i) => `<circle cx="${(px(i) + iw / 2).toFixed(1)}" cy="${ly(q.y || 0).toFixed(1)}" r="2.4" fill="${o.lineColor}"><title>${esc(pts[i].x)} · ${esc(q.t || q.y)}</title></circle>`).join('') + (o.hline ? `<line x1="36" x2="${W - 10}" y1="${ly(o.hline.y).toFixed(1)}" y2="${ly(o.hline.y).toFixed(1)}" class="cs-hl"/><text x="${W - 12}" y="${(ly(o.hline.y) - 4).toFixed(1)}" class="cs-tk" text-anchor="end" fill="${T.bad}">${esc(o.hline.label)}</text>` : ''); }
    const step = Math.ceil(pts.length / 10);
    const xl = pts.map((p, i) => (i % step === 0 || i === pts.length - 1) ? `<text x="${(px(i) + iw / 2).toFixed(1)}" y="${H - 5}" class="cs-tk cs-tx">${esc(p.x)}</text>` : '').join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="cs-svg" role="img" style="direction:ltr">${ticks}${bars}${line}${xl}</svg>`;
  }
  const ago = iso => { if (!iso) return 'never'; const s = Math.round((Date.now() - new Date(iso)) / 1000); return s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };
  const kpi = (label, value, sub, tone, href) => `<${href ? `a href="${esc(href)}"` : 'div'} class="cs-kpi" style="--t:${tone || T.line}"><div class="cs-kl">${esc(label)}</div><div class="cs-kv">${value}</div><div class="cs-ks">${sub || ''}</div></${href ? 'a' : 'div'}>`;
  const card = (title, body, right, cls) => `<div class="topo-card cs-card ${cls || ''}"><div class="cs-ch"><b>${title}</b>${right ? `<span class="cs-dim">${right}</span>` : ''}</div>${body}</div>`;
  const banner = (tone, html) => `<div class="cs-banner" style="--c:${tone}">${html}</div>`;
  /* Section headers, the same shape as the Executive Dashboard: a number, the question the section answers,
     one line of what it is made of, and the method on the right. SECS is the single list — the jump bar, the
     numbering and the anchors all read from it, so a section cannot end up numbered one way and linked another. */
  /* [id, question, what it is made of, method on the right, shown?] — the snapshot (§10.2, frozen 8 Sep) and
     the engagement board are hidden: the live Remedy section answers the same questions off ARSystem itself, and
     the RA import that fed the snapshot retires with them. Nothing is deleted — flip the last flag to true and
     the three panels, their banner and their import come back, renumbered automatically. */
  const SECS_ALL = {
    /* [id, question, what it is made of, method on the right, shown?] — the snapshot (§10.2, frozen 8 Sep) and the
       engagement board are hidden: the live Remedy section answers the same questions off ARSystem itself, and the
       RA import that fed the snapshot retires with them. Nothing is deleted — flip a flag to true and the panels,
       their banner and their import come back, renumbered automatically. */
    escalations: [
      ['remedy', 'What does Remedy hold right now?', 'Live from ARSystem (dbo.ITC_CITC_MOH on 172.30.1.14): the board\u2019s own KPIs on live rows, a search by any identifier an engineer holds, and the findings a dated extract cannot answer.', 'live \u00b7 read-only \u00b7 audited', true],
      ['snapshot', 'What did CST actually escalate?', 'The verified figures of the engagement runbook \u00a710.2 \u2014 dated, frozen, and the ones quoted back to the regulator.', null, false],
      ['board', 'Where does the engagement stand?', 'Workstreams A\u2013F with their current state, the open items, and the three arguments that hold in front of CST.', 'runbook \u00a74\u2013\u00a79, \u00a713', false],
      ['api', 'What does CST receive when it asks?', 'The five regulator endpoints of spec CITC006001 v6.2, run from the console exactly as the Swagger runs them \u2014 the other side of every discrepancy above.', 'CITC006001 v6.2', true]
    ],
    /* Arqami reads the same way: how the service behaved, then what it actually answered. */
    arqami: [
      ['behaviour', 'How is the number-ownership service behaving?', 'Every request CST made, one row per minute from APPS.YY_REGISTER_NUMBER_AUDIT on EBPROD \u2014 volume, latency, the minutes that touched the timeout ceiling, and the minutes with no traffic at all.', 'Oracle EBPROD \u00b7 KSA minutes', true],
      ['arqapi', 'What does CST receive when it asks?', 'The same endpoint CST calls, run from the console: one national id in, the customer\u2019s mobile and fixed services out. The audit rows above count these calls but cannot show what came back.', 'SALAM_TT_Webservice', true]
    ]
  };
  let SECS = SECS_ALL.escalations.filter(x => x[4] !== false);
  const shown = id => SECS.some(x => x[0] === id);
  /* every sub-section numbers itself from this, so hiding a section renumbers 1.1 / 2.1 and the jump bar together */
  const useSecs = which => {
    SECS = SECS_ALL[which].filter(x => x[4] !== false);
    window.CST_SEC = SECS.reduce((a, x, i) => (a[x[0]] = i + 1, a), {});
  };
  useSecs('escalations');
  const secIndex = id => SECS.findIndex(x => x[0] === id) + 1;
  const qsec = (id, right) => { const x = SECS.find(y => y[0] === id); if (!x) return '';
    const r = right === undefined ? x[3] : right;
    return `<div class="cs-q" id="cs-s-${x[0]}"><div class="cs-qn">${secIndex(id)}</div><div class="cs-qt"><h3 class="cs-qh">${esc(x[1])}</h3><div class="cs-qd">${esc(x[2])}</div></div>${r ? `<div class="cs-qr">${esc(r)}</div>` : ''}</div>`; };
  const jumpBar = () => `<nav class="cs-jump" aria-label="Sections">${SECS.map((x, i) => `<a href="#cs-s-${x[0]}" data-jump="${x[0]}"><i>${i + 1}</i>${esc(x[1].replace(/\?$/, ''))}</a>`).join('')}</nav>`;
  /* a sub-heading inside a section: a real title plus the one line that says what the reader is looking at */
  const h3 = (n, title, desc) => `<div class="cs-h3"><span class="cs-h3n">${esc(n)}</span><span class="cs-h3t">${esc(title)}</span><i></i></div>${desc ? `<div class="cs-h3d">${esc(desc)}</div>` : ''}`;

  /* ---------- state ---------- */
  const state = { page: 'arqami', day: null, range: 30, esc: null, board: null, cfg: null, src: null, daily: null };

  /* ================================================================ ARQAMI ================================================================ */
  async function arqami(host) {
    useSecs('arqami');
    host.innerHTML = `<div class="cs-loading">Loading Arqami…</div>`;
    let d, days, daily, src;
    try { [d, days, daily, src] = await Promise.all([api(`/api/cst/arqami${state.day ? '?day=' + state.day : ''}`), api('/api/cst/arqami/days'), api(`/api/cst/arqami/daily?days=${state.range}`), api('/api/cst/arqami/source').catch(() => null)]); }
    catch (e) { host.innerHTML = `<div class="topo-card cs-err"><b>Could not load</b><div class="cs-dim">${esc(e.message)}</div></div>`; return; }
    state.src = src; state.daily = daily;
    const s = d.summary, p = d.prev && d.prev.summary;
    const live = src && src.configured && !src.lastError && src.lastPoll;
    const liveBadge = src ? (live ? `<span class="cs-live on" title="Oracle EBPROD · last poll ${ago(src.lastPoll)} · ${src.lastPollMs} ms">● live · ${ago(src.lastPoll)}</span>` : src.configured ? `<span class="cs-live bad" title="${esc(src.lastError || src.driverError || 'waiting for the first poll')}">● ${src.lastError ? 'Oracle error' : 'connecting…'}</span>` : `<span class="cs-live" title="CST_ORACLE_* not set in .env">○ CSV mode</span>`) : '';
    const dayChips = (days.days || []).slice(0, 12).map(x => `<button type="button" class="cs-chip ${x.day === d.day ? 'on' : ''}" data-day="${x.day}" title="${num(x.requests)} requests · ${x.minutes} minutes${x.live ? ' · Oracle' : ' · CSV'}">${x.day === days.today ? 'today' : x.day.slice(5)}</button>`).join('');
    const head = `<div class="cs-bar"><div class="cs-chips">${liveBadge}${dayChips || '<span class="cs-dim">no day loaded yet</span>'}</div><div class="cs-acts">${src && src.configured ? `<button type="button" class="cs-btn ghost" data-act="refresh-day" data-day="${esc(d.day || days.today)}" title="re-read this day from Oracle">↻ Refresh from Oracle</button>` : ''}<button type="button" class="cs-btn ghost" data-act="import-arqami">⇪ Import CSV</button><button type="button" class="cs-btn ghost" data-act="cfg">⚙ Source</button></div></div>`;
    const dailyHtml = dailySection(daily, d.day);
    if (d.empty || !s) { host.innerHTML = head + banner(T.warn, src && src.configured ? `<b>No Arqami minutes yet.</b> The Oracle connector is configured — the first poll and the ${src.backfillDays}-day backfill run right after start-up${src.lastError ? `: <b>${esc(src.lastError)}</b>` : ''}. Use <b>Source → Backfill</b> to start the history read now.` : `<b>No Arqami data yet.</b> Set <code>CST_ORACLE_*</code> in <code>/apps/unified/.env</code> for the live connector, or import the Oracle per-minute export (<code>MINUTE_SLOT, REQUESTS, SUCCESS, FAILED, AVG_MS, MAX_MS</code>) for one day. Nothing is invented on this page.`) + dailyHtml + sourcePanel('arqami') + importPanel('arqami'); wire(host); return; }
    const delta = (a, b, goodDown, fmt) => (b == null || a == null) ? '' : a === b ? `<span class="cs-d" style="color:${T.muted}">= previous day</span>` : `<span class="cs-d" style="color:${(goodDown ? a < b : a > b) ? T.ok : T.bad}">${a > b ? '▲' : '▼'} ${fmt ? fmt(b) : num(b)} previous day</span>`;
    const covered = s.first && s.last ? `${s.first}–${s.last} KSA` : '';
    const kpis = `<div class="cs-kpis">
      ${kpi('Requests', num(s.requests), delta(s.requests, p && p.requests, false), T.ok)}
      ${kpi('Success rate', s.successPct == null ? '—' : s.successPct.toFixed(2) + '%', `${num(s.failed)} failed${p ? delta(s.successPct, p.successPct, false, v => v.toFixed(2) + '%') : ''}`, s.failed ? T.bad : T.ok)}
      ${kpi('Avg latency', ms(s.avg_ms), `p50 ${ms(s.p50_ms)} · p90 ${ms(s.p90_ms)}${delta(s.avg_ms, p && p.avg_ms, true, ms)}`, s.avg_ms > 1000 ? T.bad : s.avg_ms > 500 ? T.warn : T.ok)}
      ${kpi('Timeout-cap minutes', num(s.cappedMinutes), `minutes touching ${ms(s.timeoutCapMs)} · max ${ms(s.max_ms)}`, s.cappedMinutes > 20 ? T.warn : T.ok)}
      ${kpi('Slow minutes', num(s.slowMinutes), 'avg > 1 s in the minute', s.slowMinutes > 10 ? T.bad : s.slowMinutes ? T.warn : T.ok)}
      ${kpi('Silent minutes', num(s.gapMinutes), s.gaps.length ? s.gaps.map(g => `${g.from}→${g.to}`).join(' · ') : 'no gap in the day', s.gapMinutes > 5 ? T.bad : s.gapMinutes ? T.warn : T.ok)}
    </div>`;
    const pts = d.minutes.map(m => ({ x: m.slot, y: m.requests, t: `${m.success} ok · ${m.failed} failed` }));
    const lat = d.minutes.map(m => ({ x: m.slot, y: m.avg_ms, t: `max ${ms(m.max_ms)}` }));
    const bandColor = m => m.y > 1000 ? T.bad : m.y < 150 ? T.ok : null;
    const regimes = s.regimes.map(r => `<span class="cs-reg cs-reg-${r.band}" title="${r.band} · ${r.minutes} min · ${num(r.requests)} requests" style="flex:${r.minutes}"></span>`).join('');
    const findings = [];
    if (s.fastWindows.length >= 3) findings.push(`<b>Recurring fast windows</b> — ${s.fastWindows.length} windows where the average drops under 150 ms (${s.fastWindows.slice(0, 4).join(', ')}${s.fastWindows.length > 4 ? '…' : ''}), most opening around hh:27 every ~3 hours: a cache / backend cycle signature, not load. Worth confirming against the Redis TTL and the Oracle side.`);
    if (s.slowMinutes) findings.push(`<b>${s.slowMinutes} slow minute${s.slowMinutes === 1 ? '' : 's'}</b> with an average above 1 s (${s.slowSlots.slice(0, 6).join(', ')}${s.slowSlots.length > 6 ? '…' : ''}) — customers of CST's Arqami portal waited 1–2.5 s per lookup in those minutes.`);
    if (s.cappedMinutes) findings.push(`<b>${s.cappedMinutes} minutes hit the ${ms(s.timeoutCapMs)} ceiling</b> — the service reports them as success, so timeouts are invisible in the failure count; a latency SLO (p95 < 1 s) is the honest measure here, not the error rate.`);
    if (s.gapMinutes) findings.push(`<b>${s.gapMinutes} silent minute${s.gapMinutes === 1 ? '' : 's'}</b> (${s.gaps.map(g => `${g.from}→${g.to}`).join(', ')}) with no request recorded — either no traffic reached the API or the export lost the rows; both deserve a look at the IIS / .NET logs for that window.`);
    if (!findings.length) findings.push('Nothing abnormal in this day: no failures, no slow minutes, no silent minutes.');
    host.innerHTML = head + jumpBar() + qsec('behaviour', covered ? `${esc(d.day)} · ${esc(covered)}` : esc(d.day)) + dailyHtml + `<div class="cs-ah" style="margin-top:4px">Day in detail · ${esc(d.day)}${d.day === days.today ? ' (today, so far)' : ''}</div>` + kpis + `
      <div class="cs-grid2">
        ${card('Requests per minute', area(pts, { color: T.info }), covered)}
        ${card('Average latency per minute', area(lat, { color: T.warn, hline: { y: s.timeoutCapMs, label: 'timeout ceiling ' + ms(s.timeoutCapMs) }, ymax: 2700, band: bandColor, fmt: v => Math.round(v) + ' ms' }), 'green band = fast (< 150 ms) · red band = slow (> 1 s)')}
      </div>
      ${card('Latency regimes across the day', `<div class="cs-regs">${regimes}</div><div class="cs-legend"><span><i style="background:${T.ok}"></i>fast &lt; 150 ms</span><span><i style="background:${T.info}"></i>normal</span><span><i style="background:${T.bad}"></i>slow &gt; 1 s</span></div>`, `${s.regimes.length} windows · ${covered}`)}
      <div class="cs-grid2">
        ${card('What the day says', `<ul class="cs-find">${findings.map(f => `<li>${f}</li>`).join('')}</ul>`, 'derived from the minutes above')}
        ${card('By hour', `<div class="tscroll"><table class="cs-tbl"><thead><tr><th>Hour</th><th>Requests</th><th>Failed</th><th>Avg</th><th>Max</th><th>Minutes</th></tr></thead><tbody>${s.hours.map(h => `<tr><td>${h.hour}:00</td><td class="cs-num">${num(h.requests)}</td><td class="cs-num">${num(h.failed)}</td><td class="cs-num" style="color:${h.avg_ms > 1000 ? T.bad : h.avg_ms > 500 ? T.warn : 'inherit'}">${ms(h.avg_ms)}</td><td class="cs-num">${ms(h.max_ms)}</td><td class="cs-num">${h.minutes}${h.minutes < 60 ? `<span class="cs-dim"> / 60</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`, 'KSA')}
      </div>
      ` + qsec('arqapi') + `<div id="arqApiMount"></div>
      ${sourcePanel('arqami')}${importPanel('arqami')}`;
    wire(host);
    /* the call itself: own fetches, own errors — it never blocks the charts above it */
    if (window.arqamiApi) { try { window.arqamiApi.render($('#arqApiMount', host)); } catch (e) {} }
  }

  /* daily traffic — the history read from Oracle (or the CSV days), one column per KSA day; click a day to open it */
  function dailySection(daily, selDay) {
    if (!daily || !daily.rows || !daily.rows.length) return '';
    const R = daily.rows, t = daily.totals;
    const rangeChips = [14, 30, 90].map(r => `<button type="button" class="cs-chip ${state.range === r ? 'on' : ''}" data-range="${r}">${r} d</button>`).join('');
    const reqPts = R.map(x => ({ x: x.day.slice(5), key: x.day, y: x.requests, color: x.failed ? T.bad : !x.complete ? 'color-mix(in srgb,' + T.info + ' 55%,transparent)' : T.info, t: `${x.successPct == null ? '—' : x.successPct + '%'} ok · ${num(x.failed)} failed · peak ${num(x.peak)}/min${x.complete ? '' : ' · partial day'}` }));
    const latLine = R.map(x => ({ y: x.avg_ms, t: `avg ${ms(x.avg_ms)} · p90 ${ms(x.p90_ms)} · max ${ms(x.max_ms)}` }));
    const capPts = R.map(x => ({ x: x.day.slice(5), key: x.day, y: x.capped_minutes, color: x.capped_minutes > 20 ? T.bad : T.warn, t: `${x.slow_minutes} slow · ${x.silent_minutes} silent minutes` }));
    const kpis = `<div class="cs-kpis cs-kpis5">
      ${kpi(`Requests · ${t.days} days`, num(t.requests), `${t.perDay == null ? '—' : num(t.perDay)} per full day${t.busiest ? ` · busiest ${t.busiest.day.slice(5)} (${num(t.busiest.requests)})` : ''}`, T.info)}
      ${kpi('Failed', num(t.failed), t.failed ? `${(t.failed / Math.max(1, t.requests) * 100).toFixed(3)}% of requests` : 'the service reports every request as success — timeouts hide in latency', t.failed ? T.bad : T.ok)}
      ${kpi('Avg latency', ms(t.avg_ms), t.slowest ? `slowest day ${t.slowest.day.slice(5)} · ${ms(t.slowest.avg_ms)}` : '', t.avg_ms > 1000 ? T.bad : t.avg_ms > 500 ? T.warn : T.ok)}
      ${kpi('Timeout-cap minutes', num(t.capped_minutes), `${num(t.slow_minutes)} slow minutes (avg > 1 s) over the period`, t.capped_minutes ? T.warn : T.ok)}
      ${kpi('Silent minutes', num(t.silent_minutes), 'minutes with no request in complete days', t.silent_minutes > 30 ? T.bad : t.silent_minutes ? T.warn : T.ok)}
    </div>`;
    const tbl = `<div class="tscroll"><table class="cs-tbl cs-daily"><thead><tr><th>Day</th><th>Requests</th><th>Failed</th><th>Success</th><th>Avg</th><th>p90</th><th>Max</th><th>Peak /min</th><th>Cap min</th><th>Slow min</th><th>Silent</th><th>Src</th></tr></thead><tbody>${R.slice().reverse().map(x => `<tr class="cs-row ${x.day === selDay ? 'on' : ''}" data-day="${x.day}" title="open ${x.day}"><td class="cs-num"><b>${x.day === daily.today ? 'today' : x.day.slice(5)}</b>${x.complete ? '' : '<span class="cs-dim"> partial</span>'}</td><td class="cs-num">${num(x.requests)}</td><td class="cs-num" style="color:${x.failed ? T.bad : 'inherit'}">${num(x.failed)}</td><td class="cs-num">${x.successPct == null ? '—' : x.successPct.toFixed(2) + '%'}</td><td class="cs-num" style="color:${x.avg_ms > 1000 ? T.bad : x.avg_ms > 500 ? T.warn : 'inherit'}">${ms(x.avg_ms)}</td><td class="cs-num">${ms(x.p90_ms)}</td><td class="cs-num">${ms(x.max_ms)}</td><td class="cs-num">${num(x.peak)}</td><td class="cs-num" style="color:${x.capped_minutes > 20 ? T.bad : x.capped_minutes ? T.warn : 'inherit'}">${num(x.capped_minutes)}</td><td class="cs-num" style="color:${x.slow_minutes > 10 ? T.bad : x.slow_minutes ? T.warn : 'inherit'}">${num(x.slow_minutes)}</td><td class="cs-num" style="color:${x.silent_minutes > 5 ? T.bad : x.silent_minutes ? T.warn : 'inherit'}">${x.complete ? num(x.silent_minutes) : '—'}</td><td><span class="cs-code ${x.live ? 'it' : ''}">${x.live ? 'Oracle' : 'CSV'}</span></td></tr>`).join('')}</tbody></table></div>`;
    return `<div class="cs-ah" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span>Daily traffic · APPS.YY_REGISTER_NUMBER_AUDIT</span><span class="cs-chips">${rangeChips}</span></div>` + kpis + `
      <div class="cs-grid2">
        ${card('Requests per day <span class="cs-dim">· line = average latency</span>', cols(reqPts, { color: T.info, sel: selDay, line: latLine, lineColor: T.warn, lineMax: 1200, fmt: v => num(Math.round(v)) }), 'click a day to open it · red column = failures that day · light = partial')}
        ${card('Minutes at the 2.5 s timeout ceiling per day', cols(capPts, { color: T.warn, sel: selDay, fmt: v => Math.round(v) }), 'timeouts are reported as success — this is where they show')}
      </div>
      ${card(`Day by day · last ${daily.days} days`, tbl, 'KSA days · rolled up from the per-minute rows', 'cs-dailycard')}`;
  }

  /* ================================================================ ESCALATIONS ================================================================ */
  async function escalations(host) {
    useSecs('escalations');
    host.innerHTML = `<div class="cs-loading">Loading CST escalations…</div>`;
    let d, board;
    try { [d, board] = await Promise.all([api('/api/cst/escalations/summary'), api('/api/cst/board')]); } catch (e) { host.innerHTML = `<div class="topo-card cs-err"><b>Could not load</b><div class="cs-dim">${esc(e.message)}</div></div>`; return; }
    state.esc = d; state.board = board;
    const head = `<div class="cs-bar"><div class="cs-dim">${d.snapshot ? `<b>Runbook snapshot</b> as at ${d.asAt} · ${d.window.from} → ${d.window.to} · ${esc(d.source)}` : `Imported rows · ${ksa(d.window.from).slice(0, 10)} → ${ksa(d.window.to).slice(0, 10)} · last import ${ksa(d.importedAt)}`}</div><div class="cs-acts"><button type="button" class="cs-btn" data-act="import-esc">⇪ Import RA export (.xlsx / .csv)</button><button type="button" class="cs-btn ghost" data-act="cfg">⚙ Source</button></div></div>`;
    const bannerHtml = d.snapshot ? banner(T.warn, `<b>These are the verified figures of the engagement runbook (§10.2), not live data.</b> Import the RA export «تقرير الشكاوي المصعدة الشامل» to replace them with rows, or connect Remedy (172.30.1.14 / ARSystem) when the DB details are ready. Names, phone numbers and IDs are never stored.`) : '';
    const breach = (d.reasons.find(r => /خمسة|5/.test(r.label)) || {}).count || 0;
    const kpis = `<div class="cs-kpis">
      ${kpi('Escalated complaints', num(d.total), d.days ? `${d.days} days · ${d.perDay} / day` : '', T.info)}
      ${kpi('IT scope (BIL + PRV + MNP)', num(d.itScope), `${d.itSharePct == null ? '—' : d.itSharePct + '%'} of all · the only cohort IT answers for`, T.ok)}
      ${kpi('Still open at CST', num(d.status.open), `${pct(d.status.open, d.total)}% · the only cohort whose outcome can still change${d.openIt != null ? ` · ${num(d.openIt)} in IT scope` : ''}`, d.status.open ? T.warn : T.ok)}
      ${kpi('5-day-deadline breaches', num(breach), `${pct(breach, d.total)}% of escalations — not a bad resolution, a missed intervention date`, T.bad)}
      ${kpi('Median closure', d.lagMedianDays == null ? '—' : d.lagMedianDays + ' d', `average ${d.lagAvgDays == null ? '—' : d.lagAvgDays + ' d'} · escalation → closure`, T.info)}
      ${kpi('Statement requests', num(d.withStatements), `${pct(d.withStatements, d.total)}% of complaints had ≥ 1 «طلب إفادة»`, T.muted)}
    </div>`;
    const domItems = d.domains.map(x => ({ html: `<bdi dir="rtl">${esc(x.ar)}</bdi><span class="cs-code ${x.it ? 'it' : ''}">${x.code}${x.it ? ' · IT' : ''}</span>`, count: x.count, color: x.it ? T.ok : T.info, sub: x.open ? `${x.open} open` : '' }));
    const lagItems = Object.entries(d.lag).map(([k, v]) => ({ label: k + ' days', html: `<span>${k} days</span>`, count: v, color: k === '0-5' ? T.ok : k === '6-15' ? T.info : k === '16-30' ? T.warn : T.bad }));
    const lagTotal = Object.values(d.lag).reduce((a, b) => a + b, 0);
    const s235 = d.sample235;
    const proof = s235 ? card('Remedy traceability — the July sample (235)', `
      <div class="cs-proof"><div class="cs-pv"><b style="color:${T.ok}">${s235.tracedPct}%</b><span>have a real INC in Remedy, all flagged CTT · <b>${s235.noRecord}</b> with no record</span></div>
      <div class="cs-pv"><b>${s235.workOrders}</b><span>work orders on ${s235.woComplaints} complaints — all network side, 0 for IT</span></div>
      <div class="cs-pv"><b style="color:${T.bad}">${s235.unreachableIt}</b><span>IT-side closures as «customer unreachable» (47 %) vs <b>${s235.unreachableNet}</b> on the network side (0.5 %)</span></div>
      <div class="cs-pv"><b style="color:${T.bad}">${s235.contradictions}</b><span>cases where our own statement to CST contradicts the internal closure — the most exposed item</span></div>
      <div class="cs-pv"><b>${s235.lagAfterDay5Pct}%</b><span>escalated after day 5 — a fixed internal-intervention date is the cheapest commitment</span></div></div>
      <div class="cs-dim" style="margin-top:8px">Proven on the 235 sample only; the full list (1 631) is settled by <code>map-1631-CST-to-remedy.sql</code> (workstream F).</div>`, 'closure practice, not a system fault', 'cs-proofcard') : '';
    const daily = d.daily && d.daily.length ? card('Escalations per day', area(d.daily.map(x => ({ x: x.day.slice(5), y: x.n, t: `${x.it} in IT scope` })), { color: T.info }), 'KSA days') : '';
    const boardHtml = card('Engagement board', `
      <div class="cs-ws">${board.workstreams.map(w => `<div class="cs-wsr"><span class="cs-wsid">${esc(w.id)}</span><div class="cs-wst"><b>${esc(w.title)}</b><div class="cs-dim">${esc(w.note)}</div></div><select class="cs-sel" data-ws="${esc(w.id)}">${['pending', 'prepared', 'ongoing', 'fixed', 'closed', 'blocked'].map(st => `<option value="${st}" ${w.state === st ? 'selected' : ''}>${st}</option>`).join('')}</select></div>`).join('')}</div>
      <div class="cs-ah">Open items</div>
      <div class="cs-oi">${board.openItems.map(o => `<label class="cs-oir ${o.done ? 'done' : ''}"><input type="checkbox" data-oi="${o.id}" ${o.done ? 'checked' : ''}><span>${esc(o.text)}</span></label>`).join('')}</div>
      <div class="cs-acts" style="margin-top:10px"><button type="button" class="cs-btn" data-act="save-board">Save board</button><span class="cs-dim" id="csBoardMsg"></span></div>`, 'workstreams A–F · runbook §4–§9, §13');
    /* Hidden sections stay in the file as functions and are never called while hidden — so a data-shape
       change on the frozen path can no longer break the live page. Bringing them back is one flag in SECS_ALL. */
    const snapshotSection = () => qsec('snapshot', d.snapshot ? `as at ${esc(d.asAt)} \u00b7 ${esc(d.window.from)} \u2192 ${esc(d.window.to)}` : `imported rows \u00b7 ${esc(ksa(d.window.from).slice(0, 10))} \u2192 ${esc(ksa(d.window.to).slice(0, 10))}`)
      + bannerHtml + kpis + `
      <div class="cs-grid2">
        ${card('By domain \u2014 from \u00abنوع شكوي رئيسي\u00bb, IT scope highlighted', hbars(domItems, { total: d.total }), 'auditable by both sides: CST\'s own field, no re-interpretation')}
        ${card('Why CST escalated', hbars(d.reasons.map(r => ({ label: r.label, count: r.count, color: /خمسة|5/.test(r.label) ? T.bad : T.warn })), { total: d.total }) + `<div class="cs-ah">Closure lag (closed only)</div>` + hbars(lagItems, { total: lagTotal }), `${num(lagTotal)} closed`)}
      </div>
      <div class="cs-grid2">
        ${card('Top complaint sub-types', hbars(d.subTypes.map(r => ({ label: r.label, count: r.count, color: T.info })), { total: d.total }))}
        ${card('Regions', hbars(d.regions.map(r => ({ label: r.label, count: r.count, color: T.info })), { total: d.total }), d.regions.length >= 3 ? `${pct(d.regions.slice(0, 3).reduce((a, r) => a + r.count, 0), d.total)}% in the top three` : '')}
      </div>
      ${daily}
      ${d.outcomes && d.outcomes.length ? card('Outcome in our own statements to CST', hbars(d.outcomes.map(r => ({ label: r.label, count: r.count, color: /تسوية|أُلغيت/.test(r.label) ? T.ok : /قيد/.test(r.label) ? T.warn : T.muted })), { total: d.total }), 'classifier of runbook \u00a78, applied to the full statement text') : ''}
      ${proof}
      ${d.snapshot ? '' : `<div id="csOpenList">${card('Open cohort', `<div class="cs-loading">Loading open complaints\u2026</div>`, 'sorted by escalation date \u00b7 IDs only, never names')}</div>`}`;
    const boardSection = () => qsec('board') + boardHtml
      + `<div class="cs-grid2">${card('The three arguments that hold', `<ol class="cs-args"><li><b>53 % of escalations are a five-day-deadline breach</b>, not a bad resolution \u2014 commit to a fixed internal-intervention date, not a shorter final SLA.</li><li><b>Every open complaint is still winnable</b> \u2014 daily follow-up before they become adjudication decisions.</li><li><b>Never one SLA across categories</b> \u2014 cancellations are a desk action; network faults are governed by site-access time.</li></ol>`, 'runbook \u00a710.2')}${card('Communication rules', `<ul class="cs-find"><li>External teams (DBA, vendors): findings and the ask only \u2014 no plan, scripts or SQL.</li><li>National IDs masked to the last 4 digits; names and phones never leave the workstation.</li><li>Never send the raw evidence workbook to CST \u2014 extract what serves the response.</li><li>Arabic, RTL for mails and reports; the WhatsApp group is semi-external.</li></ul>`, 'runbook \u00a72 \u2014 hard constraints')}</div>`;

    host.innerHTML = (shown('snapshot') ? head : '') + jumpBar()
      + qsec('remedy') + `<div id="csRemedyMount"></div>`
      + (shown('snapshot') ? snapshotSection() : '')
      + (shown('board') ? boardSection() : '')
      + qsec('api') + `<div id="csApiMount"></div>`
      + (shown('snapshot') ? importPanel('escalations') : '')
      + sourcePanel('escalations');
    wire(host);
    /* live section: the same questions asked of ARSystem itself. Own fetches, own errors — it never blocks the
       runbook figures above it, which stay the dated reference even when Remedy is unreachable. */
    if (window.cstRemedy) { try { window.cstRemedy.render($('#csRemedyMount', host)); } catch (e) {} }
    /* the five CST endpoints, at the end of the page: what the regulator receives, against what we hold above */
    if (window.cstApi) { try { window.cstApi.render($('#csApiMount', host)); } catch (e) {} }
    if (!d.snapshot && shown('snapshot')) api('/api/cst/escalations/list?status=open&limit=200').then(l => {
      const el = $('#csOpenList', host); if (!el) return;
      el.innerHTML = card(`Open cohort · ${num(l.rows.length)}`, l.rows.length ? `<div class="tscroll"><table class="cs-tbl"><thead><tr><th>REQ</th><th>Domain</th><th>Sub-type</th><th>Region</th><th>Escalated</th><th>Reason</th><th>Stage</th></tr></thead><tbody>${l.rows.map(r => `<tr class="${r.it_scope ? 'it' : ''}"><td class="cs-num">${esc(r.req)}</td><td>${esc(r.domain)}${r.it_scope ? ' <span class="cs-code it">IT</span>' : ''}</td><td>${ar(r.sub_type || '')}</td><td>${ar(r.region || '')}</td><td class="cs-num">${ksa(r.escalated_at).slice(0, 10)}</td><td>${ar(r.escalation_reason || '')}</td><td>${ar(r.stage || r.status || '')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="cs-empty">Nothing open.</div>`, 'sorted by escalation date · IDs only, never names');
    }).catch(() => {});
  }

  /* ---------- import + source panels ---------- */
  function importPanel(kind) {
    return card(kind === 'arqami' ? 'Import a day — Oracle per-minute export' : 'Import the RA export — «تقرير الشكاوي المصعدة الشامل»', `
      <div class="cs-imp" id="csImp-${kind}">
        ${kind === 'arqami' ? `<label class="cs-lbl">Day (KSA)<input type="date" class="cs-in" id="csDay"></label>` : ''}
        <label class="cs-lbl">${kind === 'arqami' ? 'Data_YYYYMMDD.csv' : '.xlsx or .csv, header row = the export\'s 31 Arabic columns'}<input type="file" class="cs-in" id="csFile-${kind}" accept="${kind === 'arqami' ? '.csv,text/csv' : '.xlsx,.xls,.csv'}"></label>
        <button type="button" class="cs-btn" data-act="do-import" data-kind="${kind}">Import</button>
        <div class="cs-dim" id="csImpMsg-${kind}">${kind === 'arqami' ? 'Columns: MINUTE_SLOT, REQUESTS, SUCCESS, FAILED, AVG_MS, MAX_MS · the day is taken from the file name when it is Data_YYYYMMDD.csv' : 'Columns are matched by name (رقم الشكوى، نوع شكوي رئيسي، حالة الشكوى، المنطقة، سبب التصعيد، تاريخ التصعيد، تاريخ الإغلاق، الافادة الاساسية…). Name / phone / ID columns are dropped before anything is sent.'}</div>
      </div>`, 'upsert · re-importing the same file is safe', 'cs-impcard');
  }
  function sourcePanel(kind) {
    const c = state.cfg && state.cfg[kind];
    if (kind === 'arqami') {
      const s = state.src;
      if (!s) return card('Data source', `<div class="cs-src"><div>Connector status unavailable.</div></div>`, '', 'cs-srccard');
      const bf = s.backfill;
      const rows = s.configured ? `
        <div class="cs-srcg">
          <div><span class="cs-kl">Oracle</span><b>${esc(s.user)}@${esc(s.host)}:${s.port}/${esc(s.service)}</b><span class="cs-dim">${esc(s.table)} · ${esc(s.columns.time)} / ${esc(s.columns.success)} / ${esc(s.columns.duration)} · driver ${esc(s.mode || '—')}${s.jvmInfo ? ` · JVM ${esc(s.jvmInfo.java)} up since ${ago(s.jvmInfo.since)}${s.jvmRestarts ? ` · ${s.jvmRestarts} restarts` : ''}` : ''}</span></div>
          ${s.clientError ? `<div><span class="cs-kl">Instant Client</span><b style="color:${T.bad}">${esc(s.clientError)}</b></div>` : ''}
          <div><span class="cs-kl">Poll</span><b style="color:${s.lastError ? T.bad : s.lastPoll ? T.ok : T.warn}">${s.lastError ? 'error' : s.lastPoll ? 'live' : 'waiting'}</b><span class="cs-dim">every ${s.pollSec} s · window ${s.windowMin} min · last ${ago(s.lastPoll)}${s.lastPollMs != null ? ` in ${s.lastPollMs} ms` : ''} · ${num(s.polls)} polls</span></div>
          <div><span class="cs-kl">Backfill</span><b>${bf ? (bf.running ? `${bf.done} / ${bf.days} days…` : `${bf.days} days done`) : 'not run'}</b><span class="cs-dim">${bf ? `${num(bf.minutes)} minutes · ${num(bf.requests)} requests${bf.current ? ` · reading ${bf.current}` : ''}${bf.errors.length ? ` · ${bf.errors.length} errors: ${esc(bf.errors[0].error)}` : ''}` : `default ${s.backfillDays} days at start-up`}</span></div>
          ${s.lastError ? `<div><span class="cs-kl">Last error</span><b style="color:${T.bad}">${esc(s.lastError)}</b><span class="cs-dim">${ago(s.lastErrorAt)}</span></div>` : ''}
          ${s.probe ? `<div><span class="cs-kl">Probe</span><b>${esc(s.probe.db)} · ${esc(s.probe.oracleNow)}</b><span class="cs-dim">${esc(s.probe.version || '')} · last request ${esc(s.probe.lastRequest || '—')} · ${num(s.probe.todayRows)} rows today</span></div>` : s.probeError ? `<div><span class="cs-kl">Probe</span><b style="color:${T.bad}">${esc(s.probeError)}</b></div>` : ''}
        </div>
        <div class="cs-acts" style="margin-top:10px">
          <button type="button" class="cs-btn" data-act="backfill" data-days="30">⟲ Backfill 30 days</button>
          <button type="button" class="cs-btn ghost" data-act="backfill" data-days="90">⟲ 90 days</button>
          <button type="button" class="cs-btn ghost" data-act="poll">Poll now</button>
          <button type="button" class="cs-btn ghost" data-act="probe">Probe table</button>
          <span class="cs-dim" id="csSrcMsg"></span>
        </div>
        <div class="cs-dim" style="margin-top:8px">Read-only · the aggregation is the DBeaver per-minute query (TRUNC to the minute, COUNT, SUCCESS = 'Y', ROUND(AVG(DURATION_MS)), MAX). Backfill skips days already read from Oracle; the hourly self-heal re-reads today in full.</div>`
      : `<div><b>Not connected.</b> ${s.driver ? '' : '<span style="color:' + T.bad + '">oracledb driver missing — deploy with --full.</span> '}Add to <code>/apps/unified/.env</code> on 152 (never in settings or git):</div>
         <pre class="cs-pre">CST_ORACLE_HOST=172.31.1.42\nCST_ORACLE_PORT=1521\nCST_ORACLE_SERVICE=EBPROD\nCST_ORACLE_USER=apps\nCST_ORACLE_PASSWORD=…\nCST_ORACLE_BACKFILL_DAYS=30</pre><div class="cs-dim">then restart salam-unified · until then the CSV import below keeps the page fed.</div>`;
      return card('Data source — Oracle EBPROD', `<div class="cs-src">${rows}</div>`, s.configured ? 'live connector' : 'CSV mode', 'cs-srccard');
    }
    const body = `<div class="cs-src"><div><b>Today:</b> the RA export, imported here.</div><div><b>Next:</b> Remedy read-only connector — SQL Server <code>172.30.1.14:1433</code>, database <code>ARSystem</code>, view <code>ITC_CITC_MOH</code>, join key <code>REQ = SRID = Service_RequestID</code>; credentials in <code>.env</code> as <code>CST_REMEDY_URL</code>. Never Oracle EBPROD — CST data does not live there.</div></div>`;
    return card('Data source', body, 'configuration only — nothing dials out yet', 'cs-srccard');
  }

  /* ---------- actions ---------- */
  function wire(host) {
    host.querySelectorAll('.cs-chip[data-day],.cs-row[data-day],.cs-col[data-day]').forEach(b => b.onclick = () => { if (!b.dataset.day) return; state.day = b.dataset.day; arqami(host); });
    host.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { state.range = Number(b.dataset.range) || 30; arqami(host); });
    const srcMsg = () => host.querySelector('#csSrcMsg') || { textContent: '' };
    host.querySelectorAll('[data-act="refresh-day"]').forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = '↻ reading…'; try { const r = await api('/api/cst/arqami/refresh', { method: 'POST', body: JSON.stringify({ day: b.dataset.day }) }); b.textContent = `↻ ${r.minutes} min · ${num(r.requests)} req · ${r.ms} ms`; setTimeout(() => arqami(host), 900); } catch (e) { b.textContent = '↻ ' + e.message; b.disabled = false; } });
    host.querySelectorAll('[data-act="backfill"]').forEach(b => b.onclick = async () => { try { const r = await api('/api/cst/arqami/backfill', { method: 'POST', body: JSON.stringify({ days: Number(b.dataset.days) }) }); srcMsg().textContent = r.job.running ? `backfill started: ${r.job.days} days to read` : 'nothing to read — every day is already in'; setTimeout(() => arqami(host), 2500); } catch (e) { srcMsg().textContent = e.message; } });
    host.querySelectorAll('[data-act="poll"]').forEach(b => b.onclick = async () => { try { const r = await api('/api/cst/arqami/poll', { method: 'POST', body: '{}' }); srcMsg().textContent = r.ok ? `polled ${r.result.rows} minutes in ${r.result.ms} ms` : ('poll failed: ' + (r.status.lastError || '')); setTimeout(() => arqami(host), 800); } catch (e) { srcMsg().textContent = e.message; } });
    host.querySelectorAll('[data-act="probe"]').forEach(b => b.onclick = async () => { srcMsg().textContent = 'probing…'; try { state.src = await api('/api/cst/arqami/source?probe=1'); const el = host.querySelector('.cs-srccard'); if (el) el.outerHTML = sourcePanel('arqami'); wire(host); } catch (e) { srcMsg().textContent = e.message; } });
    host.querySelectorAll('[data-act="import-arqami"],[data-act="import-esc"]').forEach(b => b.onclick = () => { const el = host.querySelector('.cs-impcard'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    host.querySelectorAll('[data-act="cfg"]').forEach(b => b.onclick = () => { const el = host.querySelector('.cs-srccard'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    host.querySelectorAll('[data-act="do-import"]').forEach(b => b.onclick = () => doImport(host, b.dataset.kind));
    const fi = host.querySelector('#csFile-arqami'); if (fi) fi.onchange = () => { const m = /Data_(\d{4})(\d{2})(\d{2})\.csv$/i.exec(fi.files[0] ? fi.files[0].name : ''); const dd = host.querySelector('#csDay'); if (m && dd && !dd.value) dd.value = `${m[1]}-${m[2]}-${m[3]}`; };
    const sb = host.querySelector('[data-act="save-board"]'); if (sb) sb.onclick = async () => {
      const b = state.board; b.workstreams.forEach(w => { const s = host.querySelector(`[data-ws="${w.id}"]`); if (s) w.state = s.value; });
      b.openItems.forEach(o => { const c = host.querySelector(`[data-oi="${o.id}"]`); if (c) o.done = c.checked; });
      const msg = host.querySelector('#csBoardMsg'); try { await api('/api/cst/board', { method: 'PUT', body: JSON.stringify(b) }); msg.textContent = 'saved'; } catch (e) { msg.textContent = e.message; }
    };
  }
  async function doImport(host, kind) {
    const msg = host.querySelector(`#csImpMsg-${kind}`), fi = host.querySelector(`#csFile-${kind}`);
    const f = fi && fi.files && fi.files[0]; if (!f) { msg.textContent = 'choose a file first'; return; }
    try {
      msg.textContent = 'reading…';
      if (kind === 'arqami') {
        const day = host.querySelector('#csDay').value; if (!day) { msg.textContent = 'set the day'; return; }
        const csv = await f.text();
        const r = await api('/api/cst/arqami/import', { method: 'POST', body: JSON.stringify({ day, csv, name: f.name }) });
        msg.textContent = `imported ${r.rows} minutes for ${r.day} (${r.inserted} new · ${r.updated} updated)`; state.day = r.day; setTimeout(() => arqami(host), 600);
      } else {
        const rows = await readTable(f);
        if (!rows.length) { msg.textContent = 'no rows found'; return; }
        msg.textContent = `sending ${rows.length} rows…`;
        const r = await api('/api/cst/escalations/import', { method: 'POST', body: JSON.stringify({ rows, name: f.name }) });
        msg.innerHTML = `imported ${r.rows} rows (${r.inserted} new · ${r.updated} updated · ${r.skipped} without REQ). Mapped: ${Object.keys(r.mapping).join(', ')}${r.unmapped.length ? ` · unmapped: ${r.unmapped.map(esc).join(', ')}` : ''}${r.pii.length ? ` · dropped PII: ${r.pii.map(esc).join(', ')}` : ''}${r.warnings.length ? ` · ${r.warnings.map(esc).join(' · ')}` : ''}`;
        setTimeout(() => escalations(host), 1500);
      }
    } catch (e) { msg.textContent = 'import failed: ' + e.message; }
  }
  async function readTable(f) {
    if (/\.csv$/i.test(f.name)) {
      const text = (await f.text()).replace(/^﻿/, ''); const lines = text.split(/\r?\n/).filter(l => l.trim()); if (lines.length < 2) return [];
      const split = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); };
      const head = split(lines[0]); return lines.slice(1).map(l => { const c = split(l); const o = {}; head.forEach((h, i) => o[h] = c[i]); return o; });
    }
    if (!window.XLSX) await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => ko(new Error('could not load the spreadsheet reader (cdnjs)')); document.head.appendChild(s); });
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(ws, { defval: '' });
  }

  /* ---------- page frame ---------- */
  function ensureCss() {
    if ($('#cs-css')) return;
    const st = document.createElement('style'); st.id = 'cs-css'; st.textContent = `
      #view-cst .cs-wrap{max-width:1400px;margin:0 auto;padding:6px 0 30px}
      .cs-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:6px 0 14px}
      .cs-kick{font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);font-weight:800}
      .cs-h{margin:2px 0 0;font-size:22px;font-weight:800;letter-spacing:-.01em}.cs-sub{font-size:12.5px;color:var(--muted);margin-top:3px;max-width:820px}
      .cs-tabs{display:flex;gap:8px;flex-wrap:wrap}
      .cs-tab{font:inherit;font-size:13px;font-weight:800;padding:9px 16px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:transform .15s,box-shadow .15s,border-color .15s}
      .cs-tab:hover{transform:translateY(-1px);box-shadow:var(--shadow,0 6px 16px rgba(15,23,42,.10))}
      .cs-tab.on{border-color:var(--green,#0e9f5a);box-shadow:inset 0 0 0 1px var(--green,#0e9f5a);color:var(--green,#0e9f5a)}
      .cs-tab i{width:24px;height:24px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0e9f5a,#019c20);color:#fff;font-style:normal;font-size:12px}
      .cs-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:6px 0 12px}
      .cs-chips{display:flex;gap:6px;flex-wrap:wrap}.cs-chip{font:inherit;font-size:11.5px;font-weight:800;padding:5px 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--muted);cursor:pointer}
      .cs-chip.on{color:#fff;background:var(--green,#0e9f5a);border-color:transparent}.cs-chip:hover{color:var(--ink)}
      .cs-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .cs-btn{font:inherit;font-size:12px;font-weight:800;padding:8px 13px;border-radius:10px;border:1px solid transparent;background:var(--green,#0e9f5a);color:#fff;cursor:pointer;transition:transform .15s,box-shadow .15s}
      .cs-btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(14,159,90,.28)}
      .cs-btn.ghost{background:color-mix(in srgb,var(--green,#0e9f5a) 10%,transparent);color:var(--green,#0e9f5a);border-color:color-mix(in srgb,var(--green,#0e9f5a) 35%,transparent)}
      .cs-banner{border-left:5px solid var(--c);background:color-mix(in srgb,var(--c) 9%,var(--card));border-radius:12px;padding:12px 14px;font-size:13px;margin:0 0 12px;line-height:1.5}
      .cs-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:12px}
      .cs-kpi{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-top:4px solid var(--t);border-radius:12px;padding:10px 12px;min-width:0;transition:transform .15s,box-shadow .15s}
      a.cs-kpi:hover{transform:translateY(-2px);box-shadow:var(--shadow,0 8px 22px rgba(15,23,42,.12))}
      .cs-kl{font-size:10px;letter-spacing:.5px;text-transform:uppercase;font-weight:800;color:var(--muted)}.cs-kv{font-size:24px;font-weight:900;font-variant-numeric:tabular-nums;margin:4px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cs-ks{font-size:11px;color:var(--muted);line-height:1.4}
      .cs-d{display:block;font-size:11px;font-weight:700;margin-top:3px}
      .cs-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(460px,100%),1fr));gap:12px;margin-bottom:12px}
      .cs-card{padding:12px 14px;margin-bottom:12px;min-width:0}.cs-grid2>.cs-card{margin-bottom:0}
      .cs-ch{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;font-size:13px}.cs-dim{font-size:11px;color:var(--muted);font-weight:600}
      .cs-svg{width:100%;height:auto;display:block}.cs-tk{font-size:9.5px;fill:var(--muted);font-family:inherit;text-anchor:end}.cs-tx{text-anchor:middle}.cs-gl{stroke:var(--line);stroke-width:1}.cs-hl{stroke:${T.bad};stroke-width:1;stroke-dasharray:4 3}
      .cs-regs{display:flex;height:22px;border-radius:8px;overflow:hidden;gap:1px;background:var(--line)}.cs-reg{display:block;min-width:2px}.cs-reg-fast{background:${T.ok}}.cs-reg-normal{background:${T.info};opacity:.75}.cs-reg-slow{background:${T.bad}}
      .cs-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-top:8px}.cs-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
      .cs-find{margin:0;padding-left:18px;font-size:12.5px;line-height:1.5}.cs-find li{margin:4px 0}.cs-args{margin:0;padding-left:20px;font-size:12.5px;line-height:1.5}.cs-args li{margin:6px 0}
      .cs-tbl{width:100%;border-collapse:collapse;font-size:12px}.cs-tbl th{text-align:left;padding:7px 9px;color:var(--muted);font-size:10px;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--line)}.cs-tbl td{padding:7px 9px;border-bottom:1px solid var(--line)}.cs-tbl tr:last-child td{border-bottom:0}.cs-tbl tr.it td{background:color-mix(in srgb,${T.ok} 7%,transparent)}
      .cs-num{font-variant-numeric:tabular-nums;white-space:nowrap}
      .cs-hb{display:flex;flex-direction:column;gap:6px}.cs-hbr{display:grid;grid-template-columns:minmax(120px,1.3fr) 3fr 70px;gap:10px;align-items:center;font-size:12.5px}
      .cs-hbl{min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.cs-hbl small{color:var(--muted);font-weight:700}.cs-hbt{height:10px;border-radius:999px;background:var(--bg);overflow:hidden}.cs-hbt i{display:block;height:100%;border-radius:999px;transition:width .5s cubic-bezier(.2,.8,.2,1)}
      .cs-hbv{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}.cs-hbv small{display:block;font-weight:600;color:var(--muted);font-size:10.5px}
      .cs-code{font-size:9.5px;font-weight:800;letter-spacing:.4px;padding:1px 6px;border-radius:6px;border:1px solid var(--line);color:var(--muted)}.cs-code.it{color:${T.ok};border-color:color-mix(in srgb,${T.ok} 40%,transparent);background:color-mix(in srgb,${T.ok} 10%,transparent)}
      .cs-proof{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.cs-pv{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.cs-pv>b{display:block;font-size:24px;font-weight:900}.cs-pv>span{font-size:11.5px;color:var(--muted);line-height:1.4}
      .cs-ah{font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;font-weight:800;color:var(--muted);margin:12px 0 6px}
      .cs-ws{display:flex;flex-direction:column;gap:6px}.cs-wsr{display:grid;grid-template-columns:34px 1fr 120px;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg)}
      .cs-wsid{width:28px;height:28px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;background:linear-gradient(135deg,#0e9f5a,#019c20);color:#fff}.cs-wst b{font-size:12.5px}.cs-wst .cs-dim{font-weight:500;line-height:1.35}
      .cs-sel,.cs-in{font:inherit;font-size:12px;padding:7px 9px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
      .cs-oi{display:flex;flex-direction:column;gap:4px}.cs-oir{display:flex;align-items:flex-start;gap:9px;font-size:12.5px;padding:6px 8px;border-radius:8px;cursor:pointer}.cs-oir:hover{background:var(--bg)}.cs-oir.done span{text-decoration:line-through;color:var(--muted)}.cs-oir input{accent-color:var(--green,#0e9f5a);margin-top:3px}
      .cs-imp{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}.cs-lbl{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--muted);font-weight:700}
      .cs-src{font-size:12.5px;line-height:1.5;display:flex;flex-direction:column;gap:6px}.cs-src code{font-size:11.5px}
      .cs-live{font-size:11px;font-weight:800;padding:5px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted);background:var(--card);align-self:center}.cs-live.on{color:${T.ok};border-color:color-mix(in srgb,${T.ok} 40%,transparent);background:color-mix(in srgb,${T.ok} 10%,transparent)}.cs-live.bad{color:${T.bad};border-color:color-mix(in srgb,${T.bad} 40%,transparent)}
      .cs-kpis5{grid-template-columns:repeat(5,minmax(0,1fr))}
      .cs-col{cursor:pointer;transition:opacity .15s}.cs-col:hover{opacity:.75}.cs-col.on{stroke:var(--ink);stroke-width:1.5}
      .cs-row{cursor:pointer}.cs-row:hover td{background:color-mix(in srgb,${T.info} 8%,transparent)}.cs-row.on td{background:color-mix(in srgb,${T.info} 14%,transparent)}
      .cs-srcg{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.cs-srcg>div{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 11px;display:flex;flex-direction:column;gap:2px;min-width:0}.cs-srcg b{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cs-pre{font-size:11.5px;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0;white-space:pre;overflow:auto}
      .cs-q{display:flex;align-items:flex-start;gap:14px;margin:26px 0 12px;padding-bottom:10px;border-bottom:1px solid var(--line);scroll-margin-top:96px}
      .cs-qn{flex:none;width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;color:#fff;background:linear-gradient(135deg,#0e9f5a,#019c20);box-shadow:0 6px 16px rgba(14,159,90,.28)}
      .cs-qt{flex:1 1 auto;min-width:0}.cs-qh{margin:0;font-size:18px;font-weight:800;letter-spacing:-.01em;line-height:1.2}
      .cs-qd{font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.4;max-width:900px}
      .cs-qr{flex:none;font-size:11px;color:var(--muted);font-weight:700;padding-top:4px;text-align:right;white-space:nowrap}
      .cs-jump{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 8px}
      .cs-jump a{font-size:11.5px;font-weight:800;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:7px;transition:color .15s,border-color .15s,transform .15s}
      .cs-jump a:hover{color:var(--green,#0e9f5a);border-color:var(--green,#0e9f5a);transform:translateY(-1px)}
      .cs-jump a i{font-style:normal;width:18px;height:18px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;color:#fff;background:linear-gradient(135deg,#0e9f5a,#019c20)}
      .cs-h3{display:flex;align-items:center;gap:10px;margin:24px 0 3px;font-size:15px;font-weight:800;letter-spacing:-.01em;scroll-margin-top:96px}
      .cs-h3n{flex:0 0 auto;font-size:11px;font-weight:900;letter-spacing:.3px;padding:3px 10px;border-radius:999px;font-variant-numeric:tabular-nums;color:var(--green,#0e9f5a);background:color-mix(in srgb,var(--green,#0e9f5a) 12%,transparent);border:1px solid color-mix(in srgb,var(--green,#0e9f5a) 32%,transparent)}
      .cs-h3t{flex:0 1 auto;min-width:0}
      .cs-h3 i{flex:1 1 auto;min-width:16px;height:1px;background:var(--line);display:block}
      .cs-h3d{font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.45;max-width:900px;padding-left:2px}
      /* the API-console cards, shared by the CST endpoints section and the Arqami call */
      .ax .ax-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
      .ax .ax-dot{width:8px;height:8px;border-radius:50%;background:var(--green,#0e9f5a);display:inline-block;flex:0 0 auto}
      .ax .ax-dot.off{background:var(--muted)} .ax .ax-dot.bad{background:var(--xo-p1,#dc2626)}
      .ax .ax-note{font-size:11.5px;color:var(--muted);line-height:1.5} .ax .ax-note b{color:var(--ink)}
      .ax .ax-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
      .ax .ax-f{display:flex;flex-direction:column;gap:4px;flex:1 1 220px;min-width:0}
      .ax .ax-f label{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);font-weight:700}
      .ax .ax-f label i{font-style:normal;color:var(--xo-p1,#dc2626);margin-left:3px}
      .ax .ax-in{font:inherit;font-size:13px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card2,#f1f5f9);color:var(--ink);min-width:0;width:100%;box-sizing:border-box}
      .ax .ax-in:focus{outline:none;border-color:var(--green,#0e9f5a);box-shadow:0 0 0 3px rgba(14,159,90,.15)}
      .ax .ax-in::placeholder{color:var(--muted);opacity:.5;font-style:italic}
      .ax .ax-ep{border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden;background:var(--card,#fff)}
      .ax .ax-eh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 13px;background:var(--card2,#f8fafc);border-bottom:1px solid var(--line);cursor:pointer}
      .ax .ax-verb{font-size:10.5px;font-weight:900;letter-spacing:.6px;padding:3px 9px;border-radius:6px;background:var(--green,#0e9f5a);color:#fff;flex:0 0 auto}
      .ax .ax-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;font-weight:700;color:var(--ink);word-break:break-all}
      .ax .ax-title{font-size:12px;color:var(--muted);font-weight:600;margin-left:auto;text-align:right}
      .ax .ax-body{padding:12px 13px 14px}
      .ax .ax-sub{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);font-weight:700;margin:12px 0 6px}
      .ax .ax-sub:first-child{margin-top:0}
      .ax .ax-sub code{text-transform:none;letter-spacing:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--ink);background:var(--card2,#f1f5f9);border:1px solid var(--line);border-radius:5px;padding:1px 6px}
      .ax .ax-acts{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:11px}
      .ax .ax-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap}
      .ax .ax-ok{background:rgba(14,159,90,.14);color:var(--green,#0e9f5a)}
      .ax .ax-noo{background:rgba(220,38,38,.12);color:var(--xo-p1,#dc2626)}
      .ax .ax-wrn{background:rgba(217,119,6,.14);color:var(--xo-p2,#d97706)}
      .ax pre.ax-json{margin:6px 0 0;background:var(--card2,#f8fafc);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto;color:var(--ink)}
      .ax pre.ax-json.req{max-height:150px}
      .ax .ax-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:10px}
      .ax .ax-meta b{color:var(--ink);font-variant-numeric:tabular-nums}
      .ax .ax-err{border-left:4px solid var(--xo-p1,#dc2626);background:rgba(220,38,38,.07);border-radius:8px;padding:9px 12px;font-size:12.5px;margin-top:10px}
      .ax .ax-ret{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--muted);word-break:break-word;line-height:1.6}
      .ax .ax-ep.closed .ax-body{display:none}
      .ax .ax-caret{font-size:11px;color:var(--muted);flex:0 0 auto;transition:transform .15s}
      .ax .ax-ep.closed .ax-caret{transform:rotate(-90deg)}
      @media (max-width:700px){.ax .ax-title{margin-left:0;text-align:left;width:100%} .ax .ax-f{flex:1 1 100%}}
      .ax-status{font-size:11.5px;color:var(--muted);line-height:1.6;margin:0 0 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .ax-status b{color:var(--ink)}
      .ax-lock{font-size:9.5px;font-weight:800;letter-spacing:.3px;padding:1px 6px;border-radius:5px;border:1px solid var(--line);color:var(--muted);text-transform:none}
      .ax .ax-in:disabled{opacity:.72;cursor:not-allowed;background:var(--bg)}
      .ax-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:10px;max-width:100%;margin-top:4px}
      table.ax-tbl{width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px}
      .ax-tbl th{text-align:left;padding:8px 12px;color:var(--muted);font-weight:700;font-size:10px;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--line);white-space:nowrap}
      .ax-tbl td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:middle;overflow:hidden}
      .ax-tbl tr:last-child td{border-bottom:0}
      .ax-tbl td.ax-r{text-align:right;font-variant-numeric:tabular-nums}
      .ax-cut{display:block;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ax-mob{background:color-mix(in srgb,#2563eb 14%,transparent);color:#2563eb}
      .ax-fix{background:color-mix(in srgb,var(--green,#0e9f5a) 14%,transparent);color:var(--green,#0e9f5a)}
      .cs-loading,.cs-empty{padding:18px;color:var(--muted);font-size:13px}.cs-err{padding:14px;border-left:4px solid ${T.bad}}
      .cs-in-anim{animation:csIn .4s cubic-bezier(.2,.8,.2,1) both}@keyframes csIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      html[dir=rtl] .cs-tbl th{text-align:right}html[dir=rtl] .cs-hbv{text-align:left}html[dir=rtl] .cs-banner{border-left:1px solid var(--line);border-right:5px solid var(--c)}
      @media (max-width:1100px){.cs-kpis,.cs-kpis5{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media (max-width:720px){.cs-kpis,.cs-kpis5{grid-template-columns:repeat(2,minmax(0,1fr))}.cs-kv{font-size:20px}.cs-hbr{grid-template-columns:1fr 2fr 56px;gap:6px}.cs-wsr{grid-template-columns:30px 1fr;}.cs-wsr .cs-sel{grid-column:2}.cs-h{font-size:19px}.cs-q{gap:10px;margin:18px 0 10px}.cs-qh{font-size:16px}.cs-qr{display:none}.cs-jump{gap:5px}.cs-jump a{font-size:11px;padding:5px 10px}}
      @media (prefers-reduced-motion:reduce){.cs-in-anim{animation:none}.cs-btn,.cs-tab,.cs-kpi{transition:none}}
    `; document.head.appendChild(st);
  }
  const PAGES = {
    arqami: { title: 'Arqami', sub: 'Health of the number-ownership API Salam exposes to CST\'s Arqami portal (.NET 8, replacing the legacy .asmx): daily traffic from the Oracle audit table, then each day per KSA minute — latency, silent minutes, timeout ceiling.', icon: '◎', run: arqami },
    escalations: { title: 'CST Escalations', sub: 'Complaints CST escalates to Salam (REQ = SRID in Remedy): classification by CST\'s own field, IT scope, closure lag, the open cohort, the Remedy traceability proof and the engagement board.', icon: '⇄', run: escalations },
  };
  function frame(host, page) {
    const p = PAGES[page] || PAGES.arqami;
    host.innerHTML = `<div class="cs-wrap cs-in-anim">
      <div class="cs-head"><div><div class="cs-kick">CST · super admin</div><h2 class="cs-h">${esc(p.title)}</h2><div class="cs-sub">${esc(p.sub)}</div></div>
        <div class="cs-tabs">${Object.entries(PAGES).map(([k, x]) => `<button type="button" class="cs-tab ${k === page ? 'on' : ''}" data-page="${k}"><i>${x.icon}</i>${esc(x.title)}</button>`).join('')}</div></div>
      <div id="csBody"></div></div>`;
    host.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { const h = b.dataset.page === 'arqami' ? 'arqami' : 'cst-escalations'; if (window.setConsoleHash) window.setConsoleHash(h); else location.hash = '#' + h; });
    return $('#csBody', host);
  }
  window.openCst = async function (page) {
    const host = $('#view-cst'); if (!host) return;
    ensureCss();
    document.querySelectorAll('.navtab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === 'view-cst'));
    const gear = document.getElementById('settingsBtn'); if (gear) gear.classList.add('on');
    const ob = document.getElementById('opsBar'); if (ob) ob.classList.remove('show');
    state.page = page === 'escalations' ? 'escalations' : 'arqami';
    if (!isSuper()) { host.innerHTML = `<div class="cs-wrap"><div class="topo-card cs-err" style="text-align:center;padding:34px 20px"><div style="font-size:26px">Locked</div><h2 style="margin:8px 0 4px">Super Admin Only</h2><div class="cs-dim">The CST section carries regulator-facing data and is restricted to super users.</div></div></div>`; return; }
    const body = frame(host, state.page);
    if (!state.cfg) { try { state.cfg = await api('/api/cst/config'); } catch (_) { state.cfg = null; } }
    PAGES[state.page].run(body);
  };
})();
