/* salesops.js — SALES OPERATIONS WALL (5 Oct 2026, for the Sales Operations team)
 *
 *   #salesops                    the wall inside the console (channel tabs on top)
 *   #salesops?ch=qr              one channel: dms · selfact · qr · sda
 *   #salesops?kiosk=1&rotate=30  TV mode: no console chrome, full screen, rotates the four pages every 30 s
 *   #salesops?alerts=1           also show the alert engine's banners (off by default since 7 Oct 2026 — the
 *                                Sales Ops team sees IT Operations' notices only, not the alerts)
 *   permission: salesops — the shared TV sign-in (role "Sales Ops wall (TV)") holds only this view
 *
 * One template for the four channels (the Grafana "Dealer Performance" board the team uses today, done for every
 * channel from the console's own sources): activations 1 h / today / yesterday · today vs yesterday same time ·
 * success / business / technical outcomes in a window · who faces errors · the live activity feed (masked) · the
 * failure reasons. DMS and SDA rows carry the dealer STAFF ID and DEALER CODE (7 Oct 2026). Above it, the BANNER:
 * the notices IT Operations posted (one channel or all) and NO DATA when a source cannot be read; the alert-driven
 * outage / degraded / quiet banners only with ?alerts=1.
 * Keys in TV mode: ← → change page · 1-4 jump · Space pause / resume the rotation · F fullscreen · W window · Esc exit.
 * Data: /api/salesops/overview (the strip, every 30 s) and /api/salesops/channel/:ch (the page). */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const base = () => (window.API_BASE || window.CONSOLE_BASE || '');
  const api = (p, opt) => fetch(base() + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt || {}))
    .then(r => r.ok ? r.json() : r.json().catch(() => ({})).then(e => Promise.reject(new Error(e.error || ('HTTP ' + r.status)))));
  const KT = window.KT;
  const fmtN = n => Number(n || 0).toLocaleString('en-US');
  const pct = (a, b) => b > 0 ? Math.round(1000 * a / b) / 10 : null;
  const ORDER = ['dms', 'selfact', 'qr', 'sda'];
  const META = {
    dms:     { short: 'DMS',             long: 'Mobile · DMS dealer app',          icon: '▣', biz: 'Mobile' },
    selfact: { short: 'Self-activation', long: 'Mobile · Self-activation app & web', icon: '◉', biz: 'Mobile' },
    qr:      { short: 'QR Code',         long: 'Fixed · QR code (e-purchase)',      icon: '▦', biz: 'Fixed' },
    sda:     { short: 'SDA',             long: 'Fixed · SDA dealer app',            icon: '◈', biz: 'Fixed' }
  };
  const LEVEL = { outage: { l: 'OUTAGE', c: 'red' }, degraded: { l: 'DEGRADED', c: 'amber' }, minor: { l: 'MINOR ISSUES', c: 'blue' }, maintenance: { l: 'MAINTENANCE', c: 'blue' }, info: { l: 'NOTICE', c: 'green' }, ok: { l: 'OPERATIONAL', c: 'green' }, nodata: { l: 'NO DATA', c: 'amber' } };
  const REFRESH_MS = 30e3, QUIET_MIN = 30;
  const S = { ch: 'dms', win: 60, alerts: false, kiosk: false, rotate: 30, paused: false, over: null, data: {}, tick: null, clock: null, rot: null, rotAt: 0, canPost: false, open: false, seq: 0 };
  const st = { get(k, d) { try { const v = localStorage.getItem('so_' + k); return v == null ? d : v; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem('so_' + k, String(v)); } catch (_) {} } };

  /* ---- frame ---- */
  function brandMark() {
    const src = document.querySelector('header .brand-mark'); if (!src) return '';
    let g; try { g = src.cloneNode(true); } catch (_) { return ''; }
    g.setAttribute('class', 'so-leaf'); g.removeAttribute('style');
    const uid = 'soLeaf' + Math.random().toString(36).slice(2, 8);
    g.querySelectorAll('[id]').forEach(node => { const was = node.id; if (!was) return; node.id = uid;
      g.querySelectorAll('*').forEach(el => ['fill', 'stroke', 'filter', 'mask', 'clip-path'].forEach(a => { const v = el.getAttribute(a); if (v && v.indexOf('#' + was) !== -1) el.setAttribute(a, v.split('#' + was).join('#' + uid)); })); });
    return g.outerHTML;
  }
  function build(host) {
    host.innerHTML = `
      <div class="so-top">
        <div class="so-brand">${brandMark()}<span class="so-mark">salam</span><span class="so-ttl">SALES OPERATIONS<small id="soSub">four channels · live · KSA</small></span></div>
        <div class="so-tabs" id="soTabs"></div>
        <div class="so-right">
          <div class="so-clock"><b id="soHms">--:--:--</b><small id="soDate"></small></div>
          <div class="so-ctl">
            <select id="soWin" class="so-sel" title="Window for outcomes, error-facing and failure reasons (W cycles)"><option value="15">15 min</option><option value="60">1 hour</option><option value="360">6 hours</option><option value="1440">24 hours</option></select>
            <button type="button" class="so-btn" id="soRot" title="Auto-rotate the four pages (Space)">▶ Rotate</button>
            <button type="button" class="so-btn" id="soNotice" hidden title="Post or clear a notice on the wall (IT Operations)">✎ Notice</button>
            <button type="button" class="so-btn" id="soFs" title="Fullscreen (F)">⛶</button>
            <button type="button" class="so-btn" id="soKiosk" title="TV mode: hide the console, keep only the wall">▭ TV</button>
            <button type="button" class="so-btn so-exit" id="soExit" hidden title="Leave TV mode (Esc)">✕</button>
          </div>
        </div>
      </div>
      <div class="so-rotbar"><i id="soRotBar"></i></div>
      <div class="so-banners" id="soBanners"></div>
      <div class="so-page" id="soPage"><div class="so-loading">Loading…</div></div>
      <div class="so-foot"><span id="soSrc"></span><span id="soUpd"></span><span class="so-keys">← → page · 1-4 jump · Space pause · W window · F fullscreen · Esc exit</span></div>`;
    $('#soWin').value = String(S.win);
    $('#soWin').onchange = () => { S.win = Number($('#soWin').value) || 60; st.set('win', S.win); syncHash(); load(true); };
    $('#soRot').onclick = () => toggleRotate();
    $('#soFs').onclick = toggleFs;
    $('#soKiosk').onclick = () => setKiosk(!S.kiosk);
    $('#soExit').onclick = () => setKiosk(false);
    $('#soNotice').onclick = openNoticeModal;
  }
  function tabs() {
    const o = S.over; const host = $('#soTabs'); if (!host) return;
    host.innerHTML = ORDER.map(k => {
      const c = o && o.channels && o.channels[k]; const m = META[k];
      const h = S.alerts && c && c.health ? c.health.status : 'ok';
      const lvl = c && c.error ? 'nodata' : (S.alerts && quiet(c) ? 'nodata' : h);
      const L = LEVEL[lvl] || LEVEL.ok;
      const act = c && c.activations ? c.activations : null;
      const notice = o && o.notices && o.notices.find(n => (n.channel === k || n.channel === 'all') && (n.level === 'outage' || n.level === 'degraded'));
      const dotc = notice ? (notice.level === 'outage' ? 'red' : 'amber') : L.c;
      return `<button type="button" class="so-tab${S.ch === k ? ' on' : ''} dot-${dotc}" data-ch="${k}" title="${esc(m.long)} — ${esc((notice ? notice.level : lvl).toUpperCase())}">
        <span class="so-tab-ic">${m.icon}</span><span class="so-tab-tx"><b>${esc(m.short)}</b><small>${esc(m.biz)}</small></span>
        <span class="so-tab-n" title="${esc(c && c.unit || 'today')} today"><b>${act ? fmtN(act.today) : '—'}</b><small>today</small></span>
        <span class="so-dot" aria-label="${esc(L.l)}"></span></button>`; }).join('');
    host.querySelectorAll('.so-tab').forEach(b => b.onclick = () => go(b.dataset.ch, true));
  }
  const quiet = c => { if (!c || !c.latest) return false; return (Date.now() - new Date(c.latest).getTime()) > QUIET_MIN * 60e3; };

  /* ---- banners: notices (all / this channel) + automatic health + quiet source ---- */
  function banners(d) {
    const host = $('#soBanners'); if (!host) return;
    const out = [];
    const nts = (d && d.notices) || (S.over && S.over.notices && S.over.notices.filter(n => n.channel === 'all' || n.channel === S.ch)) || [];
    nts.forEach(n => { const L = LEVEL[n.level] || LEVEL.info;
      out.push(`<div class="so-ban ${L.c}"><span class="so-ban-l">${esc(L.l)}${n.channel === 'all' ? ' · ALL CHANNELS' : ''}</span><b>${esc(n.title)}</b>${n.body ? `<span class="so-ban-b">${esc(n.body)}</span>` : ''}<small>posted ${esc(KT ? KT.t(n.created_at) : '')}${n.ends_at ? ` · until ${esc(KT ? KT.t(n.ends_at) : '')}` : ''}${n.created_by ? ` · ${esc(String(n.created_by).split('@')[0])}` : ''}${S.canPost ? ` <button type="button" class="so-ban-x" data-clear="${n.id}" title="Clear this notice">clear</button>` : ''}</small></div>`); });
    const h = S.alerts && d && d.health;
    if (h && (h.status === 'outage' || h.status === 'degraded') && h.open && h.open[0]) {
      const a = h.open[0]; const L = LEVEL[h.status];
      out.push(`<div class="so-ban ${L.c} auto"><span class="so-ban-l">${esc(L.l)} · ${esc(a.sev)}</span><b>${esc(a.name)}</b><small>open since ${esc(KT ? KT.dts(a.since) : '')}${h.count > 1 ? ` · ${h.count} open alerts on this channel` : ''}${a.acked ? ' · acknowledged by IT Operations' : ' · not yet acknowledged'}</small></div>`);
    } else if (h && h.status === 'minor' && h.open && h.open[0]) {
      out.push(`<div class="so-ban blue soft"><span class="so-ban-l">MINOR · ${esc(h.open[0].sev)}</span><b>${esc(h.open[0].name)}</b><small>since ${esc(KT ? KT.t(h.open[0].since) : '')}${h.count > 1 ? ` · +${h.count - 1} more` : ''}</small></div>`);
    }
    if (d && d.error) out.push(`<div class="so-ban amber soft"><span class="so-ban-l">NO DATA</span><b>${esc(META[S.ch].short)} source not available</b><small>${esc(d.error)}</small></div>`);
    else if (S.alerts && d && d.source && d.source.latest && quiet({ latest: d.source.latest })) out.push(`<div class="so-ban amber soft"><span class="so-ban-l">QUIET</span><b>No new ${esc(META[S.ch].short)} activity since ${esc(KT ? KT.dts(d.source.latest) : '')}</b><small>the source stopped writing — a feed or platform problem until proven otherwise</small></div>`);
    host.innerHTML = out.join('');
    host.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => clearNotice(b.dataset.clear));
  }

  /* ---- gauges (SVG arcs, Grafana-like) ---- */
  function gauge(v, max, label, color, opts) {
    const o = opts || {}; const r = 44, c = Math.PI * r;            // half circle
    const f = max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
    const txt = o.text != null ? o.text : fmtN(v);
    return `<div class="so-g ${o.cls || ''}" title="${esc(o.title || label)}"><svg viewBox="0 0 100 60" aria-hidden="true"><path d="M6 54 A44 44 0 0 1 94 54" class="so-g-bg"/><path d="M6 54 A44 44 0 0 1 94 54" class="so-g-fg" style="stroke:${color};stroke-dasharray:${c};stroke-dashoffset:${c * (1 - f)}"/></svg><b style="color:${color}">${esc(txt)}</b><small>${esc(label)}</small></div>`;
  }
  const C = { ok: '#10b981', biz: '#3b82f6', tech: '#ef4444', amber: '#f59e0b', ink: 'var(--ink)' };

  function page(d) {
    const host = $('#soPage'); if (!host) return;
    const m = META[S.ch];
    if (!d) { host.innerHTML = '<div class="so-loading">Loading…</div>'; return; }
    const a = d.activations || {}, o = d.outcomes || {};
    const maxA = Math.max(1, a.today || 0, a.yesterday || 0);
    const vs = (a.ySame > 0) ? Math.round(100 * (a.today || 0) / a.ySame) : null;
    const okPct = pct(o.success || 0, o.total || 0);
    const tone = vs == null ? 'flat' : vs >= 95 ? 'up' : vs >= 80 ? 'flat' : 'down';   // ≥95% of yesterday's pace = on track · 80–94 = watch · <80 = behind
    const winLbl = { 15: 'last 15 min', 60: 'last hour', 360: 'last 6 h', 1440: 'last 24 h' }[S.win] || 'window';
    const unit = d.unit || 'activations';
    const dealerCols = S.ch === 'dms' || S.ch === 'sda';   // who sold: dealer staff ID + dealer code
    let h = `<div class="so-row1">
      <div class="so-card so-act"><div class="so-ch">${esc(unit.toUpperCase())}${d.degraded ? ' <span class="so-chip amber" title="live ledger not reachable — hourly rollups">hourly rollups</span>' : ''}</div>
        <div class="so-gs">${gauge(a.h1 || 0, Math.max(1, Math.ceil(maxA / 8)), '1-hour', C.ok)}${gauge(a.today || 0, maxA, 'Today till now', C.ok)}${gauge(a.yesterday || 0, maxA, 'Yesterday', C.ok, { cls: 'dim' })}</div>
        ${a.byPlatform && a.byPlatform.length ? `<div class="so-pl">${a.byPlatform.map(p => `<span><b>${fmtN(p.n)}</b> ${esc(p.k)}</span>`).join('')}</div>` : (a.attemptsToday != null ? `<div class="so-pl"><span><b>${fmtN(a.attemptsToday)}</b> attempts today</span>${a.today != null && a.attemptsToday ? `<span><b>${pct(a.today, a.attemptsToday)}%</b> converted</span>` : ''}</div>` : '')}
      </div>
      <div class="so-card so-vs ${tone}"><div class="so-ch">TODAY vs YESTERDAY <small>same time</small></div>
        <div class="so-big">${vs == null ? '—' : vs + '<i>%</i>'}</div>
        <div class="so-vs-sub">${fmtN(a.today || 0)} today · ${fmtN(a.ySame || 0)} by this time yesterday${a.yesterday ? ` · ${fmtN(a.yesterday)} whole day` : ''}</div></div>
      <div class="so-card so-out"><div class="so-ch">${S.ch === 'qr' || S.ch === 'sda' ? 'ORDER OUTCOMES' : 'API CALL OUTCOMES'} <small>${esc(winLbl)}</small>${o.note ? `<span class="so-info" title="${esc(o.note)}">i</span>` : ''}</div>
        <div class="so-gs">${gauge(o.success || 0, o.total || 0, 'Success', C.ok, { title: 'the step succeeded' })}${gauge(o.business || 0, o.total || 0, 'Business error', C.biz, { title: 'the API answered no (not eligible, declined, exists…)' })}${gauge(o.technical || 0, o.total || 0, 'Technical error', C.tech, { title: 'the platform failed to answer (timeout, fault, outage)' })}</div>
        <div class="so-pl"><span class="${okPct == null ? '' : okPct >= 95 ? 'good' : okPct >= 85 ? 'warn' : 'bad'}"><b>${okPct == null ? '—' : okPct + '%'}</b> success rate</span><span><b>${fmtN(o.total || 0)}</b> calls</span>${o.pending ? `<span><b>${fmtN(o.pending)}</b> in progress</span>` : ''}</div></div>
    </div>
    <div class="so-row2">
      <div class="so-card so-feed"><div class="so-ch">${esc(m.short.toUpperCase())} ACTIVITY PANEL <small>${d.degraded ? 'latest failures (live ledger not reachable)' : 'latest ' + (d.activity ? d.activity.length : 0)} · identifiers masked</small></div>
        <table class="so-tbl${dealerCols ? ' so-dlr' : ''}"><thead><tr>${dealerCols ? '<th class="so-c-st">staff ID</th><th class="so-c-dc">dealer code</th>' : `<th>${esc(d.whoOne || 'who')}</th>`}<th class="so-c-loc">${S.ch === 'selfact' ? 'number' : 'location'}</th><th>time</th><th class="so-c-tx">transaction</th><th>result</th></tr></thead><tbody>
        ${(d.activity || []).map(r => `<tr class="c-${r.cls || 'business'}">${dealerCols
          ? `<td class="mono so-c-st" title="dealer staff ID${r.staff ? ': ' + esc(r.staff) : ''}">${esc(r.staff || r.who || '—')}${r.dcode ? `<small class="so-dc-sub">${esc(r.dcode)}</small>` : ''}</td><td class="mono so-c-dc" title="${esc(r.dname ? 'dealer: ' + r.dname : 'dealer code')}">${esc(r.dcode || '—')}</td>`
          : `<td class="mono">${esc(r.who || '—')}</td>`}<td class="so-c-loc">${esc(r.where || '—')}</td><td class="mono so-c-t">${esc(KT ? KT.t(r.at) : '')}</td><td class="mono so-tx so-c-tx" title="${esc(r.tx)}">${esc(r.tx)}${r.ord ? ` <small>${esc(r.ord)}</small>` : ''}</td><td class="so-res"><i class="so-res-dot"></i>${esc(r.cls === 'success' ? (r.msg && /^(success|completed|ok)$/i.test(r.msg) ? r.msg : 'Success') : (r.msg || r.code || r.cls || ''))}${r.code && r.cls !== 'success' && r.msg && r.msg !== r.code ? ` <small>${esc(r.code)}</small>` : ''}<small class="so-tx-sub">${esc(r.tx)}</small></td></tr>`).join('') || `<tr><td colspan="${dealerCols ? 6 : 5}" class="so-empty">no activity in the source yet</td></tr>`}
        </tbody></table></div>
      <div class="so-col">
        <div class="so-card"><div class="so-ch">ERROR FACING ${esc((d.who || 'dealers').toUpperCase())} <small>${esc(winLbl)}</small></div>${bars(d.errorFacing || [], 'who')}</div>
        <div class="so-card"><div class="so-ch">FAILURE REASONS <small>${esc(winLbl)}</small></div>${reasons(d.failures || [])}</div>
      </div>
    </div>`;
    host.innerHTML = h;
    $('#soSrc').textContent = (d.source && d.source.label) ? 'source: ' + d.source.label + (d.source.latest ? ' · last event ' + (KT ? KT.dts(d.source.latest) : '') : '') : '';
    $('#soUpd').textContent = 'updated ' + (KT ? KT.t(d.at || new Date()) : '') + ' · refreshes every 30 s';
  }
  function bars(rows, key) {
    rows = rows.filter(r => (r.biz || 0) + (r.tech || 0) > 0);   // only who actually faced an error
    if (!rows.length) return '<div class="so-empty">no errors in the window — nobody is stuck</div>';
    const max = Math.max(1, ...rows.map(r => (r.ok || 0) + (r.biz || 0) + (r.tech || 0)));
    return `<div class="so-bars">${rows.map(r => { const t = (r.ok || 0) + (r.biz || 0) + (r.tech || 0); const w = x => (100 * x / max).toFixed(1) + '%';
      return `<div class="so-bar" title="${esc(r.label || r.who)}${r.where ? ' · ' + esc(r.where) : ''}: ${fmtN(r.ok || 0)} ok · ${fmtN(r.biz || 0)} business · ${fmtN(r.tech || 0)} technical${r.cat ? ' · last: ' + esc(String(r.cat).replace(/_/g, ' ')) : ''}"><span class="so-bar-l mono">${esc(r[key] || '—')}</span><span class="so-bar-t"><i class="ok" style="width:${w(r.ok || 0)}"></i><i class="biz" style="width:${w(r.biz || 0)}"></i><i class="tech" style="width:${w(r.tech || 0)}"></i></span><span class="so-bar-n">${fmtN(r.biz + r.tech)}<small>/${fmtN(t)}</small></span></div>`; }).join('')}
      <div class="so-legend"><span><i style="background:${C.ok}"></i>success</span><span><i style="background:${C.biz}"></i>business error</span><span><i style="background:${C.tech}"></i>technical error</span></div></div>`;
  }
  function reasons(rows) {
    if (!rows.length) return '<div class="so-empty">no failures in the window</div>';
    const max = Math.max(1, ...rows.map(r => r.n || 0));
    return `<div class="so-bars">${rows.map(r => `<div class="so-bar rs" title="${esc(r.reason)} · ${esc(r.cls || '')}"><span class="so-bar-l">${esc(r.reason)}</span><span class="so-bar-t"><i class="${r.cls === 'technical' ? 'tech' : 'biz'}" style="width:${(100 * (r.n || 0) / max).toFixed(1)}%"></i></span><span class="so-bar-n">${fmtN(r.n)}</span></div>`).join('')}</div>`;
  }

  /* ---- data ---- */
  async function loadOverview() {
    try { S.over = await api('/api/salesops/overview' + (S.alerts ? '?alerts=1' : '')); } catch (e) { S.over = S.over || null; }
    tabs();
  }
  async function load(force) {
    const ch = S.ch, seq = ++S.seq;
    if (force) page(null);
    try {
      const d = await api(`/api/salesops/channel/${ch}?window=${S.win}${S.alerts ? '&alerts=1' : ''}`);
      if (seq !== S.seq || ch !== S.ch) return;
      S.data[ch] = d; banners(d); page(d);
    } catch (e) { if (seq !== S.seq) return; banners({ error: e.message, health: null, notices: [] }); page({ error: e.message, activity: [], errorFacing: [], failures: [], source: {} }); }
  }
  async function refreshAll() { if (document.hidden || !S.open) return; await Promise.all([loadOverview(), load(false)]); }

  /* ---- navigation / rotation / kiosk ---- */
  function syncHash() {
    const q = []; if (S.ch !== 'dms') q.push('ch=' + S.ch); if (S.win !== 60) q.push('window=' + S.win); if (S.kiosk) q.push('kiosk=1'); if (S.kiosk && S.rotate !== 30) q.push('rotate=' + S.rotate); if (S.alerts) q.push('alerts=1');
    const h = 'salesops' + (q.length ? '?' + q.join('&') : '');
    if (location.hash !== '#' + h) { try { history.replaceState({ ...(history.state || {}) }, '', '#' + h); } catch (_) { location.hash = '#' + h; } }
  }
  function go(ch, manual) {
    if (!ORDER.includes(ch)) return;
    S.ch = ch; st.set('ch', ch); tabs(); syncHash();
    if (manual) S.rotAt = Date.now();
    const cached = S.data[ch]; if (cached) { banners(cached); page(cached); } else page(null);
    load(!cached);
  }
  function step(dir) { go(ORDER[(ORDER.indexOf(S.ch) + dir + ORDER.length) % ORDER.length], true); }
  function toggleRotate(on) {
    S.paused = on === undefined ? !S.paused : !on; st.set('paused', S.paused ? 1 : 0);
    const b = $('#soRot'); if (b) { b.textContent = S.paused ? '▶ Rotate' : '❚❚ Rotating'; b.classList.toggle('on', !S.paused); }
    S.rotAt = Date.now();
  }
  function rotTick() {
    const bar = $('#soRotBar'); const ms = S.rotate * 1000;
    if (S.paused || !ms || document.hidden) { if (bar) bar.style.width = '0%'; return; }
    const el = Date.now() - S.rotAt;
    if (bar) bar.style.width = Math.min(100, 100 * el / ms).toFixed(1) + '%';
    if (el >= ms) { S.rotAt = Date.now(); step(1); }
  }
  function setKiosk(on) {
    S.kiosk = !!on; document.body.classList.toggle('noc-wall', S.kiosk); document.body.classList.toggle('so-kiosk', S.kiosk);
    const ex = $('#soExit'); if (ex) ex.hidden = !S.kiosk; const kb = $('#soKiosk'); if (kb) kb.hidden = S.kiosk;
    if (S.kiosk) { toggleRotate(true); } else if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    syncHash();
  }
  function toggleFs() {
    if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); return; }
    const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
  }
  const pad = n => String(n).padStart(2, '0');
  function clockTick() { const d = new Date(Date.now() + 3 * 3600e3); const a = $('#soHms'), b = $('#soDate'); if (a) a.textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; if (b) b.textContent = d.toUTCString().slice(0, 16) + ' · KSA'; }
  function keys(e) {
    if (!S.open) return; const t = e.target && e.target.tagName; if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || document.querySelector('#soNoticeModal.open')) return;
    if (e.key === 'ArrowRight') { step(1); } else if (e.key === 'ArrowLeft') { step(-1); }
    else if (e.key === ' ') { e.preventDefault(); toggleRotate(); }
    else if (/^[1-4]$/.test(e.key)) go(ORDER[Number(e.key) - 1], true);
    else if (e.key === 'f' || e.key === 'F') toggleFs();
    else if (e.key === 'w' || e.key === 'W') { const W = [15, 60, 360, 1440]; S.win = W[(W.indexOf(S.win) + 1) % W.length]; $('#soWin').value = String(S.win); st.set('win', S.win); syncHash(); load(true); }
    else if (e.key === 'Escape') { if (S.kiosk) setKiosk(false); }
  }

  /* ---- notices (IT Operations) ---- */
  function ensureModal() {
    if ($('#soNoticeModal')) return;
    const m = document.createElement('div'); m.id = 'soNoticeModal'; m.className = 'modal-overlay';
    m.innerHTML = `<div class="modal-card so-nm"><div class="so-nm-h"><b>Wall notice</b><span>shown on the Sales Operations wall · every post is audited</span><button type="button" class="so-btn" id="soNmClose">✕</button></div>
      <form id="soNmForm" class="so-nm-f">
        <label>Channel <select name="channel"><option value="all">All channels (global issue)</option><option value="dms">DMS · dealer app</option><option value="selfact">Self-activation · app & web</option><option value="qr">QR code</option><option value="sda">SDA</option></select></label>
        <label>Level <select name="level"><option value="outage">Outage — channel down</option><option value="degraded" selected>Degraded — slow / partial</option><option value="maintenance">Maintenance window</option><option value="info">Information</option></select></label>
        <label class="wide">Title <input name="title" maxlength="140" required placeholder="e.g. DMS activations failing since 14:20 — BSS fault, vendor engaged"></label>
        <label class="wide">Message (optional) <textarea name="body" maxlength="600" rows="2" placeholder="what the sales teams should do meanwhile, next update time…"></textarea></label>
        <label>Duration <select name="minutes"><option value="30">30 min</option><option value="60">1 hour</option><option value="120" selected>2 hours</option><option value="240">4 hours</option><option value="480">8 hours</option><option value="1440">24 hours</option><option value="0">Until cleared</option></select></label>
        <div class="so-nm-a"><button type="submit" class="btn">Post to the wall</button><span id="soNmMsg"></span></div>
      </form>
      <div class="so-nm-list"><div class="so-ch">ACTIVE NOTICES</div><div id="soNmList"></div></div></div>`;
    document.body.appendChild(m);
    $('#soNmClose').onclick = () => m.classList.remove('open');
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
    $('#soNmForm').onsubmit = async e => {
      e.preventDefault(); const f = e.target; const msg = $('#soNmMsg'); msg.textContent = 'posting…';
      try { await api('/api/salesops/notices', { method: 'POST', body: JSON.stringify({ channel: f.channel.value, level: f.level.value, title: f.title.value, body: f.body.value, minutes: Number(f.minutes.value) }) });
        msg.textContent = 'posted'; f.title.value = ''; f.body.value = ''; await listNotices(); await refreshAll(); setTimeout(() => { msg.textContent = ''; }, 1500); }
      catch (err) { msg.textContent = err.message; }
    };
  }
  async function listNotices() {
    const host = $('#soNmList'); if (!host) return;
    try { const r = await api('/api/salesops/notices'); host.innerHTML = r.rows.length ? r.rows.map(n => `<div class="so-nm-row ${esc(n.level)}"><span class="so-chip ${(LEVEL[n.level] || LEVEL.info).c}">${esc((LEVEL[n.level] || LEVEL.info).l)}</span><span class="so-chip">${esc(n.channel === 'all' ? 'all channels' : (META[n.channel] || {}).short || n.channel)}</span><b>${esc(n.title)}</b><small>${esc(KT ? KT.dts(n.created_at) : '')}${n.ends_at ? ' → ' + esc(KT ? KT.dts(n.ends_at) : '') : ' · until cleared'} · ${esc(String(n.created_by || '').split('@')[0])}</small><button type="button" class="so-btn" data-clear="${n.id}">Clear</button></div>`).join('') : '<div class="so-empty">no active notice</div>';
      host.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => clearNotice(b.dataset.clear)); } catch (e) { host.innerHTML = `<div class="so-empty">${esc(e.message)}</div>`; }
  }
  async function clearNotice(id) { try { await api(`/api/salesops/notices/${id}/clear`, { method: 'POST', body: '{}' }); } catch (e) { alert(e.message); } await listNotices(); await refreshAll(); }
  function openNoticeModal() { ensureModal(); $('#soNoticeModal').classList.add('open'); listNotices(); }

  /* ---- open / close ---- */
  function parse(qs) {
    const P = new URLSearchParams(String(qs || '').replace(/^[^?]*\?/, ''));
    const ch = P.get('ch'); if (ch && ORDER.includes(ch)) S.ch = ch; else if (!qs) S.ch = st.get('ch', 'dms');
    const w = Number(P.get('window')); if ([15, 60, 360, 1440].includes(w)) S.win = w; else S.win = Number(st.get('win', 60)) || 60;
    if (P.get('kiosk') === '1' || P.get('tv') === '1') S.kiosk = true;
    const al = P.get('alerts') === '1'; if (al !== S.alerts) { S.alerts = al; S.data = {}; }
    const r = P.get('rotate'); if (r != null && r !== '') S.rotate = Math.max(0, Math.min(600, Number(r) || 0));
  }
  window.openSalesOps = function (qs) {
    const host = $('#view-salesops'); if (!host) return;
    parse(qs);
    if (!host.dataset.built) { build(host); host.dataset.built = '1'; document.addEventListener('keydown', keys); }
    $('#soWin').value = String(S.win);
    S.open = true; S.rotAt = Date.now();
    S.paused = S.kiosk ? false : st.get('paused', '1') === '1';
    toggleRotate(!S.paused);
    if (S.kiosk) setKiosk(true); else syncHash();
    api('/api/salesops/notices').then(r => { S.canPost = !!r.canPost; const b = $('#soNotice'); if (b) b.hidden = !S.canPost; }).catch(() => {});
    clockTick(); clearInterval(S.clock); S.clock = setInterval(clockTick, 1000);
    clearInterval(S.rot); S.rot = setInterval(rotTick, 250);
    clearInterval(S.tick); S.tick = setInterval(refreshAll, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.open) { S.rotAt = Date.now(); refreshAll(); } });
    loadOverview(); go(S.ch, false);
  };
  function off() {
    if (!S.open) return; S.open = false;
    clearInterval(S.clock); clearInterval(S.rot); clearInterval(S.tick);
    if (S.kiosk) { document.body.classList.remove('noc-wall', 'so-kiosk'); S.kiosk = false; }
  }
  window.addEventListener('hashchange', () => { if (!/^#salesops(\?|$)/.test(location.hash || '')) off(); });
})();
