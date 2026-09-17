/* nocwall.js — NOC walls: one Executive section alone, full screen, for the NOC TV (16 Sep 2026)
 *
 *   #noc          Alert radar wall        (? menu › NOC WALL › Alert radar)
 *   #noc?w=kpi    North-star KPI wall     (? menu › NOC WALL › Key indicators)
 *   permission: dashboard — the same page permission as the Executive Dashboard
 *
 * A wall is the SAME section the Executive Dashboard shows (EXECOPS.render with one section — 'radar' or
 * 'kpisExec'), wrapped for a TV: no header, no chrome, a strip with the KSA clock and the live open counts, a
 * refresh every 60 s, F for fullscreen, Esc / the exit button back to the dashboard. Nothing here duplicates the
 * dashboard code — execops.js draws the section, this file only frames it and scales it for the wall. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const KSA = 3 * 3600e3, REFRESH_MS = 60e3;
  const api = p => fetch((window.API_BASE || window.CONSOLE_BASE || '') + p, { headers: { 'Content-Type': 'application/json' } }).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)));
  let tick = null, clock = null, seq = 0, cur = null;
  const WALLS = {
    radar: { key: 'radar', sections: ['radar'], title: 'NOC · ALERT RADAR', sub: 'Mobile + Fixed · last 12 h · KSA',
             foot: 'ring = severity · sector = clock hour · ● still breaching' },
    kpi:   { key: 'kpi', sections: ['kpisExec'], title: 'NOC · KEY INDICATORS', sub: 'Mobile + Fixed · north-star · 24 h',
             foot: 'colour = tone of the indicator · delta vs the previous 24 h' },
  };
  const wallOf = () => { const m = /^#noc(?:\?(.*))?$/.exec(location.hash || ''); const q = m && m[1] ? /(?:^|&)w=([a-z]+)/.exec(m[1]) : null; return WALLS[q ? q[1] : 'radar'] || WALLS.radar; };

  const pad = n => String(n).padStart(2, '0');
  function ksaNow() { const d = new Date(Date.now() + KSA);
    return { hms: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
      date: d.toUTCString().slice(0, 16) }; }

  function build(host, w) {
    host.dataset.wall = w.key;
    host.innerHTML = `
      <div class="noc-top">
        <div class="noc-brand"><span class="noc-mark">salam</span><span class="noc-ttl">${esc(w.title)}<small>${esc(w.sub)}</small></span></div>
        <div class="noc-clock"><b id="nocHms">--:--:--</b><small id="nocDate"></small></div>
        <div class="noc-kpis" id="nocKpis"></div>
      </div>
      <div class="noc-body" id="nocRadar"><div class="xo-loading">Loading…</div></div>
      <div class="noc-foot">
        <span id="nocUpd">updated —</span><span>refreshes every 60 s · ${esc(w.foot)}</span>
        <span class="noc-btns"><button type="button" class="noc-btn" data-noc="other">${w.key === 'radar' ? '◎ Key indicators' : '◉ Alert radar'}</button><button type="button" class="noc-btn" data-noc="fs">⛶ Fullscreen</button><button type="button" class="noc-btn" data-noc="exit">✕ Exit wall</button></span>
      </div>`;
    host.querySelector('[data-noc="fs"]').onclick = toggleFs;
    host.querySelector('[data-noc="other"]').onclick = () => { const h = w.key === 'radar' ? 'noc?w=kpi' : 'noc'; if (window.setConsoleHash) window.setConsoleHash(h); else location.hash = '#' + h; };
    host.querySelector('[data-noc="exit"]').onclick = leave;
  }
  function toggleFs() {
    if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); return; }
    const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
  }
  function leave() {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (window.setConsoleHash) window.setConsoleHash('exec'); else location.hash = '#exec';
  }

  /* the strip: open counts by severity and by business, from the same payload the radar reads */
  function kpis(d) {
    const halves = [d.mobile, d.fixed].filter(h => h && h.configured);
    const sev = { P1: 0, P2: 0, P3: 0 }; let open = 0;
    halves.forEach(h => { const r = h.radar || {}; open += r.open || 0; Object.entries(r.sev || {}).forEach(([k, e]) => { if (sev[k] != null) sev[k] += e.open || 0; }); });
    const biz = halves.map(h => `<span class="noc-bz"><i class="noc-gl noc-gl-${esc(h.biz)}"></i>${esc(h.label)}<b>${(h.radar || {}).open || 0}</b></span>`).join('');
    const el = $('#nocKpis'); if (!el) return;
    el.innerHTML = `<span class="noc-open ${open ? 'hot' : 'calm'}"><b>${open}</b><small>open now</small></span>`
      + ['P1', 'P2', 'P3'].map(s => `<span class="noc-sev noc-${s.toLowerCase()} ${sev[s] ? 'hot' : ''}"><b>${sev[s]}</b><small>${s}</small></span>`).join('')
      + `<span class="noc-bizs">${biz}</span>`;
  }

  /* Re-draw ONLY when the numbers changed. The wall is an animated instrument (sweep, pings, typewriter);
   * rebuilding its SVG on every tick restarted every animation and read as "the effect does not work".
   * live.js's opsdatarefresh (as often as every 8 s) is deliberately ignored here — the 60 s tick is the cadence. */
  let sig = '';
  const signature = (d, w) => JSON.stringify([d.mobile, d.fixed].map(h => !h ? null : w.key === 'kpi' ? h.kpis : h.radar));
  async function refresh(force) {
    const host = $('#nocRadar'); if (!host || !window.EXECOPS) return;
    const me = ++seq, w = cur || WALLS.radar;
    let d = null;
    try { d = await api('/api/exec?range=7d'); } catch (_) { /* strip keeps its last numbers */ }
    if (me !== seq) return;
    const sg = d ? signature(d, w) : '';
    if (force || !sg || sg !== sig || !host.dataset.xoLoaded) {
      sig = sg;
      EXECOPS.render(host, { biz: 'all', sections: w.sections, head: false, range: false, kicker: 'noc', noAutoRefresh: true }, true);
    }
    if (d) kpis(d);
    const u = $('#nocUpd'); if (u) u.textContent = 'updated ' + ksaNow().hms;
  }

  window.openNocWall = function () {
    const host = $('#view-nocwall'); if (!host) return;
    document.body.classList.add('noc-wall');
    document.querySelectorAll('.navtab').forEach(x => x.classList.toggle('active', x.dataset.view === 'nocwall'));
    const w = wallOf();
    if (host.dataset.wall !== w.key) { cur = w; build(host, w); sig = ''; } else cur = w;
    refresh(true);
    clearInterval(tick); tick = setInterval(() => { if (!document.hidden) refresh(false); }, REFRESH_MS);
    clearInterval(clock); clock = setInterval(() => { const n = ksaNow(); const h = $('#nocHms'), d = $('#nocDate'); if (h) h.textContent = n.hms; if (d) d.textContent = n.date; }, 1000);
  };
  function off() { document.body.classList.remove('noc-wall'); clearInterval(tick); clearInterval(clock); tick = clock = null; }
  /* leaving #noc drops the wall chrome; switching walls (#noc ↔ #noc?w=kpi) is re-opened by router.js's opener call */
  window.addEventListener('hashchange', () => { if (!/^#noc(\?|$)/.test(location.hash || '')) off(); });
  document.addEventListener('keydown', e => {
    if (!document.body.classList.contains('noc-wall')) return;
    if (e.key === 'f' || e.key === 'F') { if (!e.target.closest('input,textarea')) { e.preventDefault(); toggleFs(); } }
    else if (e.key === 'Escape' && !document.fullscreenElement) leave();
  });
})();
