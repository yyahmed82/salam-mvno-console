/* vpcockpit.js — the VP Operations cockpit (#vp, 8 Oct 2026, alpha.149)
 *
 * The page the VP Operations lands on. Six blocks, top to bottom, in the order he reads them at 8 in the morning:
 *   hero          greeting, the state of both businesses, tonight's changes and critical challenges in four chips,
 *                 one-click doors to the Executive Dashboard, NOC wall, Sales wall, Mobile / Fixed / Infrastructure, tickets
 *   pulse         six tiles: Mobile, Fixed, sales today, changes, challenges, towers that reported today
 *   north-star    the CIO's KPI tiles (the same /api/exec contract as the Executive Dashboard, 7 days)
 *   updates       what happened — pinned highlights, then a dated timeline (manual posts + change results from the CAB)
 *   this week     CAB changes: the week's donut, last night's results, today & tonight, the next 7 days
 *   challenges    each tower's daily challenges (Digital · BSS · OSS · ITSM · Infra): tiles, filters, table, drawer
 *   CAB board     the full list of the meeting, the paste import, the change drawer with checklist, result and PIR
 * Data: /api/cockpit/overview (opsCockpit.js) + /api/exec, /api/exec/brief and /api/salesops/overview, which render as
 * they arrive. Writes follow the person's rights (me.*) — the VP himself only comments; leads post for their tower.
 * UX rules: every number is a door; every time is KSA; light + dark from the tokens; phone, iPad and print layouts;
 * reduced motion respected; no PII anywhere on the page. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const API = () => window.API_BASE || window.CONSOLE_BASE || '';
  async function api(p, opts) {
    const r = await fetch(API() + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  const send = (p, body, method) => api(p, { method: method || 'POST', body: JSON.stringify(body || {}) });
  const num = v => v == null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : esc(v);
  const sess = () => { try { return (window.opsSession && window.opsSession()) || {}; } catch (e) { return {}; } };
  const views = () => ((sess().me || {}).views) || [];
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- time (KSA through ksatime.js; the only conversion done here is the datetime-local input) ---------- */
  const TZ = 'Asia/Riyadh';
  const KT = window.KT;
  const F_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  const F_LONG = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const F_WD = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' });
  const dkey = v => KT.d(v);
  const today = () => KT.d(new Date());
  const addDay = (k, n) => new Date(Date.parse(k + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const hm = v => v ? KT.t(v) : '—';
  const dayLabel = v => { const k = dkey(v), t = today(); if (k === t) return 'Today'; if (k === addDay(t, -1)) return 'Yesterday'; if (k === addDay(t, 1)) return 'Tomorrow'; return F_DAY.format(KT.toDate(v)); };
  const dayOnly = k => k ? F_DAY.format(new Date(Date.parse(k + 'T09:00:00Z'))) : '—';
  const offsetMs = d => { const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(d.getTime() / 1000) * 1000; };
  const toInput = iso => iso ? KT.dt(iso).replace(' ', 'T') : '';
  const fromInput = v => { if (!v) return null; const wall = Date.parse(v + ':00Z'); if (isNaN(wall)) return null; return new Date(wall - offsetMs(new Date(wall))).toISOString(); };
  const span = (a, b) => { if (!a || !b) return ''; const m = Math.round((new Date(b) - new Date(a)) / 60000); if (m <= 0) return ''; return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`; };
  const ago = v => v ? KT.ago(v) : '—';

  /* ---------- vocab + look ---------- */
  const TW = { digital: { label: 'Digital', color: '#2563eb' }, bss: { label: 'BSS', color: '#7c3aed' }, oss: { label: 'OSS', color: '#0d9488' }, itsm: { label: 'ITSM', color: '#d97706' }, infra: { label: 'Infra', color: '#475569' } };
  const TW_ORDER = ['digital', 'bss', 'oss', 'itsm', 'infra'];
  const SEG = { mobile: '📱 Mobile', fixed: '🏠 Fixed', both: 'Mobile + Fixed' };
  const SEV = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
  const CHS = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', monitoring: 'Monitoring', resolved: 'Resolved' };
  const IMPL = { scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', completed_issues: 'Completed with issues', rolled_back: 'Rolled back', failed: 'Failed', postponed: 'Postponed', cancelled: 'Cancelled', rejected: 'Rejected at CAB' };
  const IMPL_DONE = ['completed', 'completed_issues', 'rolled_back', 'failed'], IMPL_OFF = ['postponed', 'cancelled', 'rejected'];
  const KIND = { change: 'Change', fix: 'Fix', incident: 'Incident', milestone: 'Milestone', risk: 'Risk', update: 'Update' };
  const TONE = { good: 'Good news', watch: 'Watch', bad: 'Problem', info: 'Info' };
  const IMPACTS = ['Customers', 'Call center', 'Operations', 'Big data reports', 'Business', 'Dealers', 'Revenue', 'Regulatory'];
  const svg = (d, s) => `<svg viewBox="0 0 24 24" width="${s || 16}" height="${s || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    change: '<circle cx="12" cy="12" r="4"/><path d="M12 2v6M12 16v6"/>',
    fix: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    incident: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    milestone: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
    risk: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v5M12 16h.01"/>',
    update: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    pin: '<path d="M9 4h6l-1 6 4 4H6l4-4z"/><path d="M12 14v7"/>', plus: '<path d="M12 5v14M5 12h14"/>', refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    print: '<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>',
    exec: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>', noc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12 18 6"/>',
    sales: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>', mobile: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 18h.01"/>',
    fixed: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>', infra: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
    tickets: '<path d="M3 9a3 3 0 0 0 0 6v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a3 3 0 0 0 0-6V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><path d="M13 4v16" stroke-dasharray="2 3"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', comment: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/>',
    people: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>', bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>', upload: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>'
  };
  const twChip = (k, extra) => { const t = TW[k]; return t ? `<span class="vp-tw" style="--tw:${t.color}"${extra || ''}>${esc(t.label)}</span>` : `<span class="vp-tw vp-tw-none">Unassigned</span>`; };
  const segChip = s => s && s !== 'both' ? `<span class="vp-seg vp-seg-${esc(s)}">${esc(SEG[s] || s)}</span>` : `<span class="vp-seg">${esc(SEG.both)}</span>`;
  const sevPill = s => `<span class="vp-sev vp-sev-${esc(s)}">${esc(SEV[s] || s)}</span>`;
  const chStatus = s => `<span class="vp-st vp-st-${esc(s)}"><i></i>${esc(CHS[s] || s)}</span>`;
  const implPill = (c, short) => { const k = c.awaiting ? 'awaiting' : c.implStatus; const label = c.awaiting ? (short ? 'No result yet' : 'Window passed · no result yet') : (IMPL[c.implStatus] || c.implStatus);
    return `<span class="vp-impl vp-impl-${esc(k)}"><i></i>${esc(label)}</span>`; };
  const decPill = d => { const s = String(d || '').toLowerCase(); const k = /reject/.test(s) ? 'bad' : /cancel/.test(s) ? 'off' : /condition/.test(s) ? 'warn' : /complet/.test(s) ? 'good' : /hold|moved|defer/.test(s) ? 'off' : 'ok';
    return `<span class="vp-dec vp-dec-${k}">${esc(d || '—')}</span>`; };
  const person = (email, name) => { if (!email) return '—'; if (!/@/.test(email)) return `<span class="vp-who">${esc(email)}</span>`; return window.PERSON && window.PERSON.inline ? window.PERSON.inline(email) : `<span class="vp-who" title="${esc(email)}">${esc(name || email.split('@')[0])}</span>`; };
  const nameOnly = (email, name) => !email ? '—' : !/@/.test(email) ? esc(email) : esc(name || (window.PERSON && window.PERSON.name ? window.PERSON.name(email) : email.split('@')[0]));

  /* ---------- state ---------- */
  const st = { get: (k, d) => { try { const v = localStorage.getItem('vp_' + k); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem('vp_' + k, v); } catch (e) {} } };
  const S = { d: null, err: null, exec: null, execErr: null, brief: null, sales: null, loading: false, at: null, open: false, timer: null,
    feedTower: '', chTower: st.get('chTower', ''), chStatus: st.get('chStatus', 'live'), chSeg: '', cabFilter: st.get('cabFilter', 'all'), cabTower: '', cabDate: null, cab: null, built: false, pending: null };

  /* ---------- derived ---------- */
  const D = () => S.d || {};
  const me = () => D().me || {};
  const changes = () => ((D().cab || {}).changes) || [];
  const chgBy = id => changes().find(c => c.chg === id) || (S.cab && (S.cab.changes || []).find(c => c.chg === id)) || null;
  const greeting = () => { const h = Number(KT.hour(new Date())); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const firstName = () => { const m = sess().me || {}; const nm = (m.name || '').trim() || String(m.email || '').split('@')[0].split(/[._-]/)[0];
    const f = String(nm || '').split(/\s+/)[0]; return f ? f.charAt(0).toUpperCase() + f.slice(1) : ''; };
  const halves = () => { const e = S.exec || {}; return [e.mobile, e.fixed].filter(h => h && h.configured !== false); };
  const briefOf = biz => { const b = S.brief || {}; const h = biz === 'mobile' ? b.mobile : b.fixed; return h && h.status ? h : null; };
  const execOf = biz => { const e = S.exec || {}; const h = biz === 'mobile' ? e.mobile : e.fixed; return h && h.configured !== false ? h : null; };
  const BIZ_STATE = { OK: ['ok', 'OK'], DEGRADED: ['warn', 'Degraded'], OUTAGE: ['bad', 'Outage'] };
  const EXEC_STATE = { HEALTHY: ['ok', 'Healthy'], WARNING: ['warn', 'Warning'], CRITICAL: ['bad', 'Critical'] };
  function bizState(biz) {
    const b = briefOf(biz); if (b) { const [cls, label] = BIZ_STATE[b.status.state] || ['', b.status.state]; return { cls, label, b }; }
    const e = execOf(biz); if (e) { const [cls, label] = EXEC_STATE[e.status] || ['', e.status]; return { cls, label, e }; }
    return null;
  }

  /* ---------- hero ---------- */
  function hero() {
    const d = D(), s = d.stats || {}, m = me();
    const chips = [];
    ['mobile', 'fixed'].forEach(biz => { const x = bizState(biz); if (!x) return;
      const p = x.b ? (x.b.status.openP1 + x.b.status.openP2 ? ` · ${x.b.status.openP1 ? x.b.status.openP1 + ' P1' : ''}${x.b.status.openP1 && x.b.status.openP2 ? ' + ' : ''}${x.b.status.openP2 ? x.b.status.openP2 + ' P2' : ''} open` : '') : '';
      chips.push(`<a class="vp-hchip ${x.cls}" href="${biz === 'mobile' ? '#dashboard' : '#fixed'}"><i></i>${biz === 'mobile' ? 'Mobile' : 'Fixed'} · ${esc(x.label)}${esc(p)}</a>`); });
    if (S.d) {
      chips.push(`<button type="button" class="vp-hchip" data-act="goto" data-to="vpWeek">${svg(IC.clock, 14)}${num(s.tonight)} change${s.tonight === 1 ? '' : 's'} tonight</button>`);
      if (s.critical || s.high) chips.push(`<button type="button" class="vp-hchip ${s.critical ? 'bad' : 'warn'}" data-act="goto" data-to="vpChallenges">${svg(IC.flag, 14)}${s.critical ? `${s.critical} critical` : ''}${s.critical && s.high ? ' · ' : ''}${s.high ? `${s.high} high` : ''} challenge${(s.critical + s.high) === 1 ? '' : 's'}</button>`);
      else chips.push(`<button type="button" class="vp-hchip ok" data-act="goto" data-to="vpChallenges">${svg(IC.check, 14)}No critical challenge</button>`);
      if (s.awaiting) chips.push(`<button type="button" class="vp-hchip warn" data-act="cabfilter" data-f="awaiting">${svg(IC.clock, 14)}${s.awaiting} change result${s.awaiting === 1 ? '' : 's'} to report</button>`);
    }
    const v = views();
    const doors = [['exec', '#exec', 'Executive', IC.exec], ['noc', '#noc', 'NOC wall', IC.noc], ['salesops', '#salesops', 'Sales wall', IC.sales],
      ['dashboard', '#dashboard', 'Mobile', IC.mobile], ['fixed', '#fixed', 'Fixed', IC.fixed], ['noc', '#infra?tab=map&diagram=mvno', 'Infrastructure', IC.infra], ['tickets', '#tickets', 'Tickets', IC.tickets]]
      .filter(x => v.includes(x[0])).map(x => `<a class="vp-door" href="${x[1]}">${svg(x[3], 15)}<span>${esc(x[2])}</span></a>`).join('');
    const dg = d.digest || {};
    const briefChip = dg.enabled ? `<button type="button" class="vp-tool" data-act="brief" title="The morning brief e-mailed at ${String(dg.hour).padStart(2, '0')}:${String(dg.minute || 0).padStart(2, '0')} KSA">${svg(IC.mail, 14)}<span>Morning brief${dg.lastDay === today() && dg.lastSentAt ? ` · sent ${hm(dg.lastSentAt)}` : ` · ${String(dg.hour).padStart(2, '0')}:${String(dg.minute || 0).padStart(2, '0')}`}</span></button>` : '';
    return `<div class="vp-hero">
      <div class="vp-hero-mark" aria-hidden="true"></div>
      <div class="vp-hero-l">
        <div class="vp-kick">VP Operations · Mobile + Fixed</div>
        <h1 class="vp-hi">${esc(greeting())}${firstName() ? ', ' + esc(firstName()) : ''}</h1>
        <div class="vp-date">${esc(F_LONG.format(new Date()))} · <span id="vpClock">${esc(hm(new Date()))}</span> KSA</div>
        <div class="vp-hchips">${chips.join('') || '<span class="vp-hchip">Loading the picture…</span>'}</div>
      </div>
      <div class="vp-hero-r">
        <div class="vp-tools">
          <span class="vp-upd" id="vpUpd">${S.loading ? 'updating…' : S.at ? 'updated ' + esc(hm(S.at)) : ''}</span>
          <button type="button" class="vp-tool vp-icon" data-act="refresh" title="Refresh (auto every 5 min)">${svg(IC.refresh, 15)}</button>
          ${briefChip}
          <button type="button" class="vp-tool vp-icon" data-act="print" title="Print or save as PDF">${svg(IC.print, 15)}</button>
          ${m.canSettings ? `<button type="button" class="vp-tool vp-icon" data-act="settings" title="Towers, leads, editors, change managers and the morning brief">${svg(IC.gear, 15)}</button>` : ''}
        </div>
        <div class="vp-doors">${doors}</div>
      </div>
    </div>`;
  }

  /* ---------- pulse ---------- */
  const cnt = (v, txt) => (typeof v === 'number' && isFinite(v)) ? `<span class="vp-cnt" data-v="${v}">${txt != null ? txt : num(v)}</span>` : (txt != null ? txt : num(v));
  function bizTile(biz) {
    const label = biz === 'mobile' ? 'Mobile' : 'Fixed', href = biz === 'mobile' ? '#dashboard' : '#fixed';
    const x = bizState(biz);
    if (!x) return `<a class="vp-tile vp-skel" href="${href}"><div class="vp-tl">${label}</div><div class="vp-tv">…</div><div class="vp-ts">${S.brief || S.exec ? 'not available for this account' : 'reading the incidents'}</div></a>`;
    let sub = '';
    if (x.b) { const st = x.b.status, imp = x.b.impact || {};
      sub = `${st.affectedNow ? `<b>${num(st.affectedNow)}</b> customers affected now` : 'no customer affected now'}${imp.availabilityPct != null ? ` · <b>${esc(imp.availabilityPct)}%</b> available this month` : ''}`;
      if (st.what) sub += `<div class="vp-ts2">${esc(st.what)}${st.since ? ' · since ' + esc(hm(st.since)) : ''}</div>`; }
    else if (x.e) sub = esc((x.e.summary || [])[0] || '');
    return `<a class="vp-tile vp-tbiz vp-tile-${x.cls}" href="${href}" title="Open the ${label} operations dashboard">
      <div class="vp-tl">${label}<span class="vp-tdot"></span></div><div class="vp-tv">${esc(x.label)}</div><div class="vp-ts">${sub}</div><span class="vp-go">${svg(IC.arrow, 14)}</span></a>`;
  }
  function salesTile() {
    const so = S.sales; if (!views().includes('salesops')) return '';
    if (!so || !so.channels) return `<a class="vp-tile vp-skel" href="#salesops"><div class="vp-tl">Activations today</div><div class="vp-tv">…</div><div class="vp-ts">DMS · self-activation · QR · SDA</div></a>`;
    const order = so.order || Object.keys(so.channels); const rows = order.map(k => so.channels[k]).filter(Boolean);
    const tot = rows.reduce((t, c) => t + (c.activations ? Number(c.activations.today) || 0 : 0), 0);
    const ys = rows.reduce((t, c) => t + (c.activations ? Number(c.activations.ySame) || 0 : 0), 0);
    const max = Math.max(1, ...rows.map(c => c.activations ? Number(c.activations.today) || 0 : 0));
    const delta = ys ? Math.round((tot - ys) / ys * 100) : null;
    const COL = { dms: '#2563eb', selfact: '#7c3aed', qr: '#0d9488', sda: '#0e9f5a' }, AB = { dms: 'DMS', selfact: 'Self', qr: 'QR', sda: 'SDA' };
    return `<a class="vp-tile vp-tile-sales" href="#salesops" title="Open the Sales Operations wall">
      <div class="vp-tl">Activations today</div>
      <div class="vp-tv">${cnt(tot)}</div>
      <div class="vp-ts vp-tsub">${delta == null ? 'DMS · self-activation · QR · SDA' : `<b class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}%</b> vs yesterday at this time (${num(ys)})`}</div>
      <div class="vp-bars">${rows.map(c => { const v = c.activations ? Number(c.activations.today) || 0 : 0; return `<span class="vp-bar" title="${esc(c.label)}: ${v.toLocaleString('en-US')}"><i style="height:${Math.max(6, Math.round(v / max * 100))}%;background:${COL[c.key] || '#64748b'}"></i><em>${esc(AB[c.key] || c.short || c.key)}</em><b>${num(v)}</b></span>`; }).join('')}</div>
      <span class="vp-go">${svg(IC.arrow, 14)}</span></a>`;
  }
  function pulse() {
    const s = (D().stats) || {};
    const changeTile = S.d ? `<button type="button" class="vp-tile vp-tile-${s.awaiting ? 'warn' : 'none'}" data-act="goto" data-to="vpWeek" title="This week's changes">
        <div class="vp-tl">Changes tonight</div><div class="vp-tv">${cnt(s.tonight)}</div>
        <div class="vp-ts">${s.awaiting ? `<b>${s.awaiting}</b> past the window with no result · ` : ''}${s.pirDue ? `<b>${s.pirDue}</b> PIR to record · ` : ''}<b>${num(s.weekDone)}</b> of ${num(s.weekLive)} done this CAB</div>
        <div class="vp-prog"><i style="width:${s.weekLive ? Math.round(s.weekDone / s.weekLive * 100) : 0}%"></i></div><span class="vp-go">${svg(IC.arrow, 14)}</span></button>` : '';
    const chTile = S.d ? `<button type="button" class="vp-tile vp-tile-${s.critical ? 'bad' : s.high ? 'warn' : 'ok'}" data-act="goto" data-to="vpChallenges" title="Daily challenges by tower">
        <div class="vp-tl">Open challenges</div><div class="vp-tv">${cnt(s.openChallenges)}</div>
        <div class="vp-ts"><span class="vp-sevdots">${s.critical ? `<b class="c">${s.critical} critical</b>` : ''}${s.high ? `<b class="h">${s.high} high</b>` : ''}${s.blocked ? `<b class="b">${s.blocked} blocked</b>` : ''}${!s.critical && !s.high && !s.blocked ? 'nothing critical or blocked' : ''}</span></div><span class="vp-go">${svg(IC.arrow, 14)}</span></button>` : '';
    const tws = (D().towers) || [];
    const twTile = S.d ? `<button type="button" class="vp-tile vp-tile-${s.towersReported === s.towers ? 'ok' : 'none'}" data-act="goto" data-to="vpChallenges" title="Which towers reported today">
        <div class="vp-tl">Towers reported today</div><div class="vp-tv">${cnt(s.towersReported)}<small> / ${num(s.towers)}</small></div>
        <div class="vp-twdots">${tws.map(t => `<span class="${t.reportedToday ? 'on' : ''}" style="--tw:${t.color}" title="${esc(t.label)} — ${t.reportedToday ? 'reported today' : 'no report yet today'}">${esc(t.label)}</span>`).join('')}</div><span class="vp-go">${svg(IC.arrow, 14)}</span></button>` : '';
    return `<div class="vp-pulse">${bizTile('mobile')}${bizTile('fixed')}${salesTile()}${changeTile}${chTile}${twTile}</div>`;
  }

  /* ---------- north-star KPIs (the Executive Dashboard's own contract) ---------- */
  function kpis() {
    const hs = halves(); const v = views();
    if (!v.includes('dashboard') && !v.includes('fixed')) return '';
    let tiles = '';
    if (!S.exec && !S.execErr) tiles = '<div class="vp-kgrid">' + Array.from({ length: 4 }, () => '<div class="vp-kpi vp-skel"><div class="vp-kt">…</div><div class="vp-kv">…</div></div>').join('') + '</div>';
    else if (!hs.length) tiles = `<div class="vp-empty">${esc(S.execErr || 'KPIs not available for this account')}</div>`;
    else tiles = '<div class="vp-kgrid">' + hs.map(h => (h.kpis || []).filter(k => k.exec && k.value != null && k.value !== '—').slice(0, 4).map(k => `
        <a class="vp-kpi vp-t-${esc(k.tone || 'none')}" href="${esc(k.href || (h.biz === 'fixed' ? '#fixed' : '#dashboard'))}">
          <div class="vp-kh"><span class="vp-kbiz vp-kbiz-${esc(h.biz)}">${esc(h.label)}</span><span class="vp-kw">${esc(k.window || '')}</span></div>
          <div class="vp-kt">${esc(k.title)}</div><div class="vp-kv">${typeof k.value === 'number' ? cnt(k.value) : esc(k.value)}</div>
          <div class="vp-ks">${esc(k.sub || '')}</div>
          ${k.delta && k.delta.pct != null ? `<div class="vp-kd ${k.delta.pct === 0 ? '' : k.delta.good ? 'good' : 'bad'}">${k.delta.pct > 0 ? '+' : ''}${esc(k.delta.pct)}% vs previous 24 h</div>` : ''}
        </a>`).join('')).join('') + '</div>';
    return `<section class="vp-sec" id="vpKpis">${secHead('North-star', 'The KPIs the CIO reads', `<a class="vp-link" href="#exec">Executive Dashboard ${svg(IC.arrow, 13)}</a>`)}${tiles}</section>`;
  }
  const secHead = (kick, title, right, sub) => `<div class="vp-sh"><div><div class="vp-shk">${esc(kick)}</div><h2 class="vp-sht">${title}</h2>${sub ? `<div class="vp-shs">${sub}</div>` : ''}</div>${right ? `<div class="vp-shr">${right}</div>` : ''}</div>`;

  /* ---------- last updates ---------- */
  const IMPACT_IC = { Customers: '👥', 'Call center': '🎧', Operations: '⚙', 'Big data reports': '📊', Business: '💼', Dealers: '🏪', Revenue: '💰', Regulatory: '⚖' };
  function updCard(u, pinned) {
    const c = u.ref ? chgBy(u.ref) : null;
    const meta = `${twChip(u.tower)}${segChip(u.segment)}${u.ref ? (c ? `<button type="button" class="vp-ref" data-act="chg" data-chg="${esc(u.ref)}">${esc(u.ref)}</button>` : `<span class="vp-ref">${esc(u.ref)}</span>`) : ''}${u.status ? `<span class="vp-ustatus vp-tone-${esc(u.tone)}">${esc(u.status)}</span>` : ''}`;
    const by = u.auto ? '<span class="vp-auto">from the CAB board</span>' : (u.createdBy ? `<span>by ${nameOnly(u.createdBy, u.createdByName)}</span>` : '');
    const canEdit = !u.auto && (me().towersWritable || []).includes(u.tower);
    const body = u.body ? `<div class="vp-ubody${String(u.body).length > 260 && !pinned ? ' clamp' : ''}">${esc(u.body)}</div>${String(u.body).length > 260 && !pinned ? '<button type="button" class="vp-more" data-act="more">Read more</button>' : ''}` : '';
    const impact = (u.impact || []).length ? `<div class="vp-impacts"><span class="vp-impl-l">Felt by</span>${u.impact.map(x => `<span class="vp-imp">${IMPACT_IC[x] || '•'} ${esc(x)}</span>`).join('')}</div>` : '';
    if (pinned) return `<article class="vp-pin vp-tone-${esc(u.tone)}">
        <div class="vp-pin-rib">${svg(IC.pin, 12)} Highlight</div>
        <div class="vp-pin-ic vp-tone-${esc(u.tone)}">${svg(IC[u.kind] || IC.update, 20)}</div>
        <div class="vp-pin-main"><div class="vp-umeta">${meta}</div><h3 class="vp-pin-t">${esc(u.title)}</h3>${body}${impact}
          <div class="vp-ufoot"><span>${esc(dayLabel(u.at))} · ${esc(hm(u.at))} KSA</span>${by}${c ? `<button type="button" class="vp-link" data-act="chg" data-chg="${esc(c.chg)}">View the change ${svg(IC.arrow, 12)}</button>` : ''}${canEdit ? `<button type="button" class="vp-link" data-act="editupd" data-id="${u.id}">Edit</button>` : ''}</div></div></article>`;
    return `<li class="vp-tl-item vp-tone-${esc(u.tone)}"><span class="vp-tl-dot">${svg(IC[u.kind] || IC.update, 14)}</span>
      <div class="vp-tl-card"><div class="vp-umeta">${meta}<span class="vp-tl-time">${esc(hm(u.at))}</span></div>
        <div class="vp-ut">${esc(u.title)}</div>${body}${impact}
        <div class="vp-ufoot">${by}${canEdit ? `<button type="button" class="vp-link" data-act="editupd" data-id="${u.id}">Edit</button>` : ''}</div></div></li>`;
  }
  function updates() {
    const all = (D().updates || []).filter(u => !S.feedTower || u.tower === S.feedTower);
    const pins = all.filter(u => u.pinned), rest = all.filter(u => !u.pinned);
    const groups = []; rest.forEach(u => { const k = dkey(u.at); let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, label: dayLabel(u.at), items: [] }); g.items.push(u); });
    const tabs = `<div class="vp-segtabs" role="tablist">${['', ...TW_ORDER].map(k => `<button type="button" class="${S.feedTower === k ? 'on' : ''}" data-act="feedtower" data-k="${k}">${k ? esc(TW[k].label) : 'All towers'}</button>`).join('')}</div>`;
    const post = me().canPost ? `<button type="button" class="vp-btn vp-btn-p" data-act="newupd">${svg(IC.plus, 14)} Post an update</button>` : '';
    return `${secHead('What happened', 'Last updates', post, 'Highlights first, then every update by day — posted by the towers, plus the results recorded on the CAB changes.')}
      ${tabs}${pins.map(u => updCard(u, true)).join('')}
      ${groups.length ? groups.map(g => `<div class="vp-day">${esc(g.label)}</div><ul class="vp-tline">${g.items.map(u => updCard(u, false)).join('')}</ul>`).join('') : (pins.length ? '' : `<div class="vp-empty">${S.feedTower ? 'Nothing from this tower in the last 3 weeks.' : 'No update yet.'}</div>`)}`;
  }

  /* ---------- this week's changes ---------- */
  function donut(parts, total, label) {
    const R = 42, C = 2 * Math.PI * R; let off = 0;
    const segs = parts.filter(p => p.n > 0).map(p => { const len = total ? p.n / total * C : 0; const s = `<circle r="${R}" cx="55" cy="55" fill="none" stroke="${p.color}" stroke-width="13" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 55 55)"><title>${esc(p.label)}: ${p.n}</title></circle>`; off += len; return s; }).join('');
    return `<svg viewBox="0 0 110 110" class="vp-donut" role="img" aria-label="${esc(label)}"><circle r="${R}" cx="55" cy="55" fill="none" stroke="var(--line)" stroke-width="13"/>${segs}</svg>`;
  }
  const RES_IC = c => c.awaiting ? ['wait', IC.clock, 'No result yet'] : c.implStatus === 'completed' ? ['ok', IC.check, 'Completed'] : c.implStatus === 'completed_issues' ? ['warn', IC.check, 'Completed with issues'] : ['rolled_back', 'failed'].includes(c.implStatus) ? ['bad', IC.x, IMPL[c.implStatus]] : ['sched', IC.clock, IMPL[c.implStatus] || c.implStatus];
  /* one-line change row: mode 'night' (start time), 'tonight' (window, live dot), 'week' (weekday + start) */
  const chMini = (c, mode) => { const [k, ic, label] = RES_IC(c); const now = new Date();
    const live = c.plannedStart && new Date(c.plannedStart) <= now && (!c.plannedEnd || new Date(c.plannedEnd) > now) && !IMPL_DONE.includes(c.implStatus);
    const when = mode === 'week' ? F_WD.format(KT.toDate(c.plannedStart)) + ' ' + hm(c.plannedStart) : mode === 'tonight' ? hm(c.plannedStart) + (c.plannedEnd && new Date(c.plannedEnd) > new Date(c.plannedStart) ? '–' + hm(c.plannedEnd) : '') : hm(c.plannedStart);
    const gap = mode !== 'night' && c.gaps && c.gaps.length && !IMPL_DONE.includes(c.implStatus) ? `<span class="vp-mgap" title="${esc(c.gaps.map(g => g.label + ': ' + g.value).join(' · '))}">⚠</span>` : '';
    return `<button type="button" class="vp-mini vp-mini-${mode || 'night'}" data-act="chg" data-chg="${esc(c.chg)}" title="${esc(c.chg + ' · ' + label)}"><span class="vp-mres vp-mres-${live ? 'live' : k}">${live ? '<i class="vp-live"></i>' : svg(ic, 12)}</span><span class="vp-mt">${esc(c.title || c.chg)}${gap}</span>${twChip(c.tower)}<span class="vp-mtime">${esc(when)}</span></button>`; };
  function week() {
    const d = D(), cab = d.cab || {}, m = cab.meeting, all = changes();
    if (!m && !all.length) return `${secHead('Changes', 'This week', '', 'No CAB imported yet.')}${me().canImport ? `<button type="button" class="vp-btn vp-btn-p" data-act="import">${svg(IC.upload, 14)} Import this week's CAB</button>` : ''}`;
    const inMeeting = new Set(cab.meetingChgs || []); const latest = all.filter(c => inMeeting.has(c.chg)), liveOnes = latest.filter(c => !IMPL_OFF.includes(c.implStatus));
    const done = liveOnes.filter(c => ['completed', 'completed_issues'].includes(c.implStatus)).length, bad = liveOnes.filter(c => ['rolled_back', 'failed'].includes(c.implStatus)).length;
    const wait = liveOnes.filter(c => c.awaiting).length, sched = liveOnes.length - done - bad - wait;
    const parts = [{ n: done, color: 'var(--green)', label: 'Completed' }, { n: wait, color: 'var(--amber)', label: 'No result yet' }, { n: bad, color: 'var(--red)', label: 'Failed / rolled back' }, { n: sched, color: 'var(--blue)', label: 'Scheduled' }];
    const t = (m && m.totals) || {};
    const tonight = all.filter(c => (cab.tonight || []).includes(c.chg)), lastNight = all.filter(c => (cab.lastNight || []).includes(c.chg));
    const t1 = today(); const days = Array.from({ length: 7 }, (_, i) => addDay(t1, i + 1));
    const upcoming = all.filter(c => !IMPL_OFF.includes(c.implStatus) && c.plannedStart && dkey(c.plannedStart) > t1 && dkey(c.plannedStart) <= days[6] && !(cab.tonight || []).includes(c.chg));
    const cal = `<div class="vp-cal">${days.map(k => { const list = upcoming.filter(c => dkey(c.plannedStart) === k);
        return `<div class="vp-cald${list.length ? ' has' : ''}"><div class="vp-calh"><b>${esc(F_WD.format(new Date(Date.parse(k + 'T09:00:00Z'))))}</b><span>${esc(k.slice(8))}</span></div><div class="vp-caldots">${list.map(c => `<button type="button" data-act="chg" data-chg="${esc(c.chg)}" style="--tw:${(TW[c.tower] || {}).color || '#94a3b8'}" title="${esc(hm(c.plannedStart) + ' · ' + (c.title || c.chg))}"></button>`).join('')}</div><div class="vp-caln">${list.length || ''}</div></div>`; }).join('')}</div>`;
    return `${secHead('Changes', m ? `This week · CAB ${esc(dayOnly(m.date))}` : 'This week', `<button type="button" class="vp-link" data-act="goto" data-to="vpCab">Full CAB board ${svg(IC.arrow, 12)}</button>`)}
      <div class="vp-wk">
        <div class="vp-wkring">${donut(parts, liveOnes.length || 1, 'implementation progress')}<div class="vp-wkc"><b>${done + bad}</b><span>of ${liveOnes.length} done</span></div></div>
        <div class="vp-wkleg">${parts.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${p.n}</b></span>`).join('')}
          <div class="vp-wktot">${t.total != null ? `<b>${t.total}</b> submitted · ` : ''}${t.approved != null ? `<b>${t.approved}</b> approved · ` : ''}${t.conditional ? `${t.conditional} conditional · ` : ''}${t.rejected ? `${t.rejected} rejected · ` : ''}${t.cancelled ? `${t.cancelled} cancelled` : ''}${t.emergency ? ` · <b class="vp-red">${t.emergency} emergency</b>` : ''}</div></div>
      </div>
      ${lastNight.length ? (() => { const rank = c => c.awaiting ? 2 : IMPL_DONE.includes(c.implStatus) ? 0 : 1; const sorted = lastNight.slice().sort((a, b) => rank(a) - rank(b) || new Date(a.plannedStart) - new Date(b.plannedStart));
          const done = lastNight.filter(c => IMPL_DONE.includes(c.implStatus)).length, waitN = lastNight.filter(c => c.awaiting).length;
          return `<div class="vp-wkh">${svg(IC.check, 13)} Last night <span class="vp-wkhs">${done} with a result${waitN ? ` · <b>${waitN} without</b>` : ''}</span></div><div class="vp-minis">${sorted.slice(0, 5).map(c => chMini(c, 'night')).join('')}</div>${sorted.length > 5 ? `<button type="button" class="vp-more" data-act="cabfilter" data-f="awaiting">+ ${sorted.length - 5} more — see the results to report</button>` : ''}`; })() : ''}
      <div class="vp-wkh">${svg(IC.bolt, 13)} Today &amp; tonight <span class="vp-wkhs">until tomorrow 08:00</span></div>${tonight.length ? `<div class="vp-minis">${tonight.map(c => chMini(c, 'tonight')).join('')}</div>` : '<div class="vp-empty sm">No change planned before tomorrow 08:00.</div>'}
      <div class="vp-wkh">${svg(IC.cal, 13)} Next 7 days</div>${cal}
      ${upcoming.length ? `<div class="vp-minis">${upcoming.slice(0, 3).map(c => chMini(c, 'week')).join('')}</div>${upcoming.length > 3 ? `<button type="button" class="vp-more" data-act="goto" data-to="vpCab">+ ${upcoming.length - 3} more this week on the CAB board</button>` : ''}` : '<div class="vp-empty sm">Nothing planned in the next 7 days.</div>'}`;
  }

  /* ---------- vendor weekly: Mobile · TCS (template tcs_mvno_weekly) ---------- */
  const dlt = (cur, prev) => { if (cur == null || prev == null || !prev) return ''; const p = Math.round((cur - prev) / prev * 100); return `<span class="vp-dl ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span>`; };
  const gradeCls = g => /^[AB]/i.test(g || '') ? 'good' : /^C/i.test(g || '') ? 'mid' : 'bad';
  function tcsSec() {
    const rep = (D().reports || []).find(r => r.vendor === 'TCS'); const m = me();
    if (!rep || !rep.latest) return m.canReport ? `${secHead('Vendor weekly', 'Mobile · TCS managed services', `<button type="button" class="vp-btn vp-btn-p" data-act="newrep">${svg(IC.plus, 14)} Add this week's report</button>`, 'The weekly KPIs TCS presents for the Mobile digital platforms.')}<div class="vp-empty">No weekly report yet.</div>` : '';
    const r = S.tcs || rep.latest, d = r.data || {}, isLatest = r.id === rep.latest.id;
    const prevD = isLatest && rep.previous ? rep.previous.data || {} : null;
    const av = (d.availability || {}).apps || [], minAv = av.length ? Math.min(...av.map(a => a.pct == null ? 100 : a.pct)) : null;
    const pay = d.payments || {}, act = d.activation || {}, tk = d.tickets || {}, dep = d.deployments || {}, inc = d.incidents || {}, dg = d.digital || {}, dp = dg.prev || {}, dm = d.dms || {};
    const tone = (v, good, warn) => v == null ? 'none' : v >= good ? 'ok' : v >= warn ? 'warn' : 'bad';
    const k = (label, value, sub, t) => `<div class="vp-wkpi vp-tile-${t || 'none'}"><div class="vp-tl">${label}</div><div class="vp-wv">${value}</div><div class="vp-ts">${sub || ''}</div></div>`;
    const kp = [
      k('Availability', minAv == null ? '—' : `${minAv}%`, `${av.map(a => esc(a.name)).join(' · ')}${(d.availability || {}).weeks ? ` · ${d.availability.weeks} weeks` : ''}`, tone(minAv, 99.9, 99)),
      k('Major incidents', num(inc.major), esc(inc.note || ''), inc.major ? 'bad' : 'ok'),
      k('Payments · UPG', pay.success == null ? '—' : `${pay.success}%`, `${pay.delta != null ? `<b class="${pay.delta >= 0 ? 'up' : 'down'}">${pay.delta >= 0 ? '▲' : '▼'} ${Math.abs(pay.delta)} pt</b> · ` : ''}functional ${num(pay.functional)}% · technical ${num(pay.technical)}%`, tone(pay.success, 95, 90)),
      k('Activation ≤ 30 s', act.within30 == null ? '—' : `${act.within30}%`, `${num(act.within30n)} of ${num(act.total)} SIMs${act.prevWithin30 != null ? ` · last week ${act.prevWithin30}%` : ''}`, tone(act.within30, 99, 95)),
      k('Tickets', `${num(tk.open)}<small> open</small>`, `${num(tk.created)} created · ${num(tk.resolved)} resolved · ${num(tk.avgHours)} h avg · ${num(tk.withinWeek)}% in a week`, tk.open > 20 ? 'warn' : 'ok'),
      k('Deployments', `${num(dep.total)}`, dep.failed ? `<b class="down">${dep.failed} failed</b>` : `none failed${dep.emergency ? ` · ${dep.emergency} emergency` : ''}`, dep.failed ? 'bad' : 'ok')
    ].join('');
    const maxV = Math.max(1, dg.newSim || 0, dm.newSim || 0, dg.portIn || 0, dm.portIn || 0);
    const vrow = (label, v, prev, col) => `<div class="vp-vr"><span class="vp-vl">${label}</span><span class="vp-vb"><i style="width:${v == null ? 0 : Math.max(2, Math.round(v / maxV * 100))}%;background:${col}"></i></span><b>${num(v)}</b>${prev != null ? dlt(v, prev) : '<span class="vp-dl"></span>'}</div>`;
    const vols = `<div class="vp-vg"><div class="vp-vh">Digital · app &amp; web</div>${vrow('New SIM', dg.newSim, dp.newSim, '#2563eb')}${vrow('Port-in', dg.portIn, dp.portIn, '#7c3aed')}${vrow('SIM swap', dg.simSwap, dp.simSwap, '#0d9488')}</div>
      <div class="vp-vg"><div class="vp-vh">DMS · dealers</div>${vrow('New SIM', dm.newSim, prevD && prevD.dms ? prevD.dms.newSim : null, '#2563eb')}${vrow('Port-in', dm.portIn, prevD && prevD.dms ? prevD.dms.portIn : null, '#7c3aed')}${vrow('SIM swap', dm.simSwap, prevD && prevD.dms ? prevD.dms.simSwap : null, '#0d9488')}</div>`;
    const topMax = Math.max(0.01, ...(pay.top || []).map(t => t[1] || 0));
    const fails = (pay.top || []).length ? `<div class="vp-fl">${pay.top.map(t => `<div class="vp-fr"><span>${esc(t[0])}</span><span class="vp-vb"><i style="width:${Math.max(3, Math.round((t[1] || 0) / topMax * 100))}%"></i></span><b>${num(t[1])}%</b></div>`).join('')}</div>${pay.successful ? `<div class="vp-dim">${num(pay.successful)} successful payments in the week</div>` : ''}` : '<div class="vp-dim">No breakdown in this report.</div>';
    const risks = (d.risks || []).length ? `<ul class="vp-risks">${d.risks.map(x => `<li><span class="vp-rdot"></span><div><div>${esc(x.text)}</div>${x.owner ? `<div class="vp-dim">${esc(x.owner)}</div>` : ''}</div></li>`).join('')}</ul>` : '<div class="vp-dim">No open risk reported.</div>';
    const portals = (d.portals || []).length ? `<div class="vp-ports">${d.portals.map(x => `<div class="vp-port"><span class="vp-grade vp-grade-${gradeCls(x.grade)}">${esc(x.grade || '?')}</span>
        <div class="vp-portm"><div class="vp-portt"><b>${esc(x.site)}</b><span class="vp-dim">${esc(x.label || '')}</span></div>
        <div class="vp-portk"><span>Performance <b>${num(x.perf)}%</b></span><span>Structure <b>${num(x.structure)}%</b></span><span>LCP <b>${esc(x.lcp || '—')}</b></span><span>Fully loaded <b>${esc(x.loaded || '—')}</b></span>${x.size ? `<span>${esc(x.size)}</span>` : ''}</div>
        ${x.issue ? `<div class="vp-porti">${esc(x.issue)}</div>` : ''}</div></div>`).join('')}</div>` : '';
    const weeks = S.tcsWeeks && S.tcsWeeks.length > 1 ? `<label class="vp-msel">${svg(IC.cal, 13)}<select data-act="tcsweek">${S.tcsWeeks.map(w => `<option value="${w.id}"${w.id === r.id ? ' selected' : ''}>Week ${esc(dayOnly(w.from))} – ${esc(dayOnly(w.to))}</option>`).join('')}</select></label>` : '';
    const right = `${weeks}${m.canReport ? `<button type="button" class="vp-btn" data-act="editrep" data-id="${r.id}">Edit</button><button type="button" class="vp-btn vp-btn-p" data-act="newrep">${svg(IC.plus, 14)} This week's report</button>` : ''}`;
    return `${secHead('Vendor weekly', `Mobile · TCS managed services · week ${esc(dayOnly(r.from))} – ${esc(dayOnly(r.to))}`, right, `${esc(r.title || '')}${d.presented ? ` · presented ${esc(dayOnly(d.presented))}` : ''} · the figures as TCS presents them${isLatest ? '' : ' · an earlier week'}`)}
      <div class="vp-wkpis">${kp}</div>
      <div class="vp-tcs3">
        <div class="vp-tcsb"><div class="vp-drk">Activations per day${prevD || dp.newSim != null ? ' · vs last week' : ''}</div>${vols}</div>
        <div class="vp-tcsb"><div class="vp-drk">Payment failures · share of attempts</div>${fails}</div>
        <div class="vp-tcsb"><div class="vp-drk">Risks &amp; single points of failure</div>${risks}</div>
      </div>
      ${portals ? `<div class="vp-drk" style="margin-top:16px">Portal health check${d.portalsDate ? ' · GTmetrix · ' + esc(dayOnly(d.portalsDate)) : ''}</div>${portals}` : ''}`;
  }

  /* ---------- daily challenges by tower ---------- */
  function towerTile(t) {
    const m = me(); const canMine = !m.readOnly && (m.towersWritable || []).includes(t.key);
    const rep = t.checkin ? `<span class="vp-rep ok">${svg(IC.check, 12)} ${esc(t.checkin.note || 'Nothing new today')} · ${esc(hm(t.checkin.at))}</span>`
      : t.reportedToday ? `<span class="vp-rep ok">${svg(IC.check, 12)} Reported today · ${esc(hm(t.lastActivity))}</span>`
      : `<span class="vp-rep ${Number(KT.hour(new Date())) >= 10 ? 'late' : ''}">${svg(IC.clock, 12)} No report yet today</span>`;
    const leads = t.leads && t.leads.length ? t.leads.map(l => esc(l.name || l.email.split('@')[0])).join(', ') : '<span class="vp-dim">lead not named yet</span>';
    return `<div class="vp-twr${S.chTower === t.key ? ' on' : ''}" style="--tw:${t.color}">
      <button type="button" class="vp-twr-main" data-act="chtower" data-k="${t.key}" title="Show ${esc(t.label)} only">
        <div class="vp-twr-h"><span class="vp-twr-n">${esc(t.label)}</span><span class="vp-twr-c">${t.open}<small> open</small></span></div>
        <div class="vp-twr-s">${esc(t.scope || '')}</div>
        <div class="vp-twr-b">${t.critical ? `<b class="c">${t.critical} critical</b>` : ''}${t.high ? `<b class="h">${t.high} high</b>` : ''}${t.blocked ? `<b class="b">${t.blocked} blocked</b>` : ''}${t.changesTonight ? `<b class="t">${t.changesTonight} change${t.changesTonight > 1 ? 's' : ''} tonight</b>` : ''}</div>
        <div class="vp-twr-l">${svg(IC.people, 12)} ${leads}</div>
      </button>
      <div class="vp-twr-f">${rep}${canMine && !t.reportedToday ? `<button type="button" class="vp-link" data-act="checkin" data-k="${t.key}" title="Tell the VP there is nothing new today">Nothing new today</button>` : ''}${canMine && t.checkin ? `<button type="button" class="vp-link" data-act="uncheckin" data-k="${t.key}">undo</button>` : ''}</div>
    </div>`;
  }
  function chFiltered() {
    let list = (D().challenges || []).slice();
    if (S.chTower) list = list.filter(c => c.tower === S.chTower);
    if (S.chSeg) list = list.filter(c => c.segment === S.chSeg || c.segment === 'both');
    if (S.chStatus === 'live') list = list.filter(c => c.status !== 'resolved');
    else if (S.chStatus !== 'all') list = list.filter(c => c.status === S.chStatus);
    return list;
  }
  function challengesSec() {
    const d = D(), m = me(), list = chFiltered(), all = d.challenges || [];
    const cntS = k => k === 'live' ? all.filter(c => c.status !== 'resolved').length : k === 'all' ? all.length : all.filter(c => c.status === k).length;
    const filters = `<div class="vp-filt"><div class="vp-segtabs">${[['live', 'Open'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['monitoring', 'Monitoring'], ['resolved', 'Resolved · 14 d'], ['all', 'All']].map(([k, l]) => `<button type="button" class="${S.chStatus === k ? 'on' : ''}" data-act="chstatus" data-k="${k}">${esc(l)} <b>${cntS(k)}</b></button>`).join('')}</div>
      <div class="vp-segtabs sm">${[['', 'Both'], ['mobile', '📱 Mobile'], ['fixed', '🏠 Fixed']].map(([k, l]) => `<button type="button" class="${S.chSeg === k ? 'on' : ''}" data-act="chseg" data-k="${k}">${l}</button>`).join('')}</div>
      ${S.chTower ? `<button type="button" class="vp-clear" data-act="chtower" data-k="">${esc(TW[S.chTower].label)} only ✕</button>` : ''}</div>`;
    const rows = list.map(c => `<tr class="vp-chr vp-sevrow-${esc(c.severity)}" data-act="ch" data-id="${c.id}" tabindex="0">
        <td data-l="Tower">${twChip(c.tower)}<div class="vp-segline">${segChip(c.segment)}</div></td>
        <td data-l="Challenge" class="vp-chmain"><div class="vp-cht">${esc(c.title)}</div>${c.impact ? `<div class="vp-chi">${esc(c.impact)}</div>` : ''}</td>
        <td data-l="Severity">${sevPill(c.severity)}</td>
        <td data-l="Status">${chStatus(c.status)}${c.ageDays != null && c.status !== 'resolved' ? `<div class="vp-dim">${c.ageDays === 0 ? 'since today' : `day ${c.ageDays + 1}`}</div>` : ''}</td>
        <td data-l="Fix · follow-up"><div class="vp-own">${esc(c.fixOwner || '—')}</div><div class="vp-dim">followed by ${esc(c.followedBy || 'Operations')}</div></td>
        <td data-l="Solution / next step" class="vp-chnext">${c.nextStep ? `<div class="vp-next">${esc(c.nextStep)}</div>` : '<span class="vp-dim">—</span>'}</td>
        <td data-l="Since · ETA"><div>${c.since ? esc(dayOnly(c.since)) : '—'}</div><div class="vp-dim">${c.eta ? 'ETA ' + esc(dayOnly(c.eta)) : 'no ETA'}</div></td>
        <td data-l="Last update">${c.lastNote ? `<div class="vp-last">${c.lastNote.kind === 'comment' ? '<span class="vp-vpq">VP</span>' : ''}${esc(String(c.lastNote.body).slice(0, 110))}${String(c.lastNote.body).length > 110 ? '…' : ''}</div><div class="vp-dim">${esc(nameOnly(c.lastNote.by, c.lastNote.byName))} · ${esc(ago(c.lastNote.at))}</div>` : `<div class="vp-dim">${esc(ago(c.updatedAt))}</div>`}${c.notes ? `<div class="vp-ncount">${svg(IC.comment, 11)} ${c.notes}</div>` : ''}</td>
      </tr>`).join('');
    const add = m.canPost ? `<button type="button" class="vp-btn vp-btn-p" data-act="newch">${svg(IC.plus, 14)} New challenge</button>` : '';
    return `${secHead('Daily challenges', 'What each tower is fighting', add, 'Each tower lead posts and updates their own challenges every day; Operations follows every one to closure. Open a row for the full story and the notes.')}
      <div class="vp-twrs">${(d.towers || []).map(towerTile).join('')}</div>
      ${filters}
      <div class="vp-tbl-wrap"><table class="vp-tbl vp-chtbl"><thead><tr><th>Tower</th><th>Challenge</th><th>Severity</th><th>Status</th><th>Fix · follow-up</th><th>Solution / next step</th><th>Since · ETA</th><th>Last update</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="vp-empty">${S.chStatus === 'live' ? 'No open challenge here — good.' : 'Nothing matches this filter.'}</td></tr>`}</tbody></table></div>`;
  }

  /* ---------- the CAB board ---------- */
  function cabList() {
    const inMeeting = new Set(((D().cab || {}).meetingChgs) || []);
    const src = S.cab || { meeting: (D().cab || {}).meeting, changes: changes().filter(c => inMeeting.has(c.chg)) };
    let list = (src.changes || []).slice();
    if (S.cabTower) list = list.filter(c => c.tower === S.cabTower);
    const f = S.cabFilter, tn = (D().cab || {}).tonight || [];
    if (f === 'tonight') list = list.filter(c => tn.includes(c.chg));
    else if (f === 'awaiting') list = (S.cab ? list : changes()).filter(c => c.awaiting && (!S.cabTower || c.tower === S.cabTower));
    else if (f === 'done') list = list.filter(c => IMPL_DONE.includes(c.implStatus));
    else if (f === 'gaps') list = list.filter(c => c.gaps && c.gaps.length && !IMPL_OFF.includes(c.implStatus));
    else if (f === 'off') list = list.filter(c => IMPL_OFF.includes(c.implStatus));
    else if (f === 'pir') list = list.filter(c => c.pirStatus === 'due');
    const off = c => IMPL_OFF.includes(c.implStatus) ? 1 : 0;
    list.sort((a, b) => off(a) - off(b) || (new Date(a.plannedStart || 0) - new Date(b.plannedStart || 0)));
    return { meeting: src.meeting, list, all: src.changes || [] };
  }
  function cabSec() {
    const d = D(), m = me(), { meeting, list, all } = cabList();
    const meetings = (d.cab || {}).meetings || [];
    const t = (meeting && meeting.totals) || {};
    const tot = [['total', 'Submitted'], ['approved', 'Approved'], ['conditional', 'Conditional'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['completed', 'Completed'], ['emergency', 'Emergency'], ['moved', 'Moved'], ['hold', 'Hold']]
      .filter(([k]) => t[k] != null && (t[k] > 0 || ['total', 'approved', 'emergency'].includes(k))).map(([k, l]) => `<span class="vp-tot vp-tot-${k}${t[k] > 0 ? ' on' : ''}"><b>${num(t[k])}</b>${esc(l)}</span>`).join('');
    const cntF = k => { const tn = (d.cab || {}).tonight || []; return k === 'all' ? all.length : k === 'tonight' ? all.filter(c => tn.includes(c.chg)).length : k === 'awaiting' ? changes().filter(c => c.awaiting).length : k === 'done' ? all.filter(c => IMPL_DONE.includes(c.implStatus)).length : k === 'gaps' ? all.filter(c => c.gaps && c.gaps.length && !IMPL_OFF.includes(c.implStatus)).length : k === 'pir' ? all.filter(c => c.pirStatus === 'due').length : all.filter(c => IMPL_OFF.includes(c.implStatus)).length; };
    const filt = `<div class="vp-filt"><div class="vp-segtabs">${[['all', 'All'], ['tonight', 'Today & tonight'], ['awaiting', 'No result yet'], ['done', 'Done'], ['pir', 'PIR to record'], ['gaps', 'Approved with gaps'], ['off', 'Not going in']].map(([k, l]) => `<button type="button" class="${S.cabFilter === k ? 'on' : ''}" data-act="cabfilter" data-f="${k}">${esc(l)} <b>${cntF(k)}</b></button>`).join('')}</div>
      <div class="vp-segtabs sm">${['', ...TW_ORDER].map(k => `<button type="button" class="${S.cabTower === k ? 'on' : ''}" data-act="cabtower" data-k="${k}">${k ? esc(TW[k].label) : 'All towers'}</button>`).join('')}</div></div>`;
    const sel = meetings.length ? `<label class="vp-msel">${svg(IC.cal, 13)}<select data-act="cabdate">${meetings.map(x => `<option value="${esc(x.date)}"${meeting && x.date === meeting.date ? ' selected' : ''}>CAB ${esc(dayOnly(x.date))} · ${x.changes}</option>`).join('')}</select></label>` : '';
    const imp = m.canImport ? `<button type="button" class="vp-btn vp-btn-p" data-act="import">${svg(IC.upload, 14)} Import a CAB</button>` : '';
    const narrow = window.innerWidth < 820, cut = narrow && !S.cabAll && list.length > 6;
    const rows = (cut ? list.slice(0, 6) : list).map(c => `<tr data-act="chg" data-chg="${esc(c.chg)}" tabindex="0" class="${c.awaiting ? 'vp-row-wait' : ''}">
        <td data-l="Change" class="vp-mono vp-chgid">${esc(c.chg)}<div class="vp-dim">${esc(c.category || '')}</div></td>
        <td data-l="What" class="vp-chmain"><div class="vp-cht">${esc(c.title || '—')}</div><div class="vp-dim">${esc([c.area, c.supportTeam].filter(Boolean).join(' · '))}</div></td>
        <td data-l="Tower">${twChip(c.tower)}<div class="vp-segline">${segChip(c.segment)}</div></td>
        <td data-l="Window (KSA)"><div>${c.plannedStart ? `<b>${esc(dayLabel(c.plannedStart))}</b> ${esc(hm(c.plannedStart))}${c.plannedEnd ? '–' + esc(hm(c.plannedEnd)) : ''}` : '—'}</div>${c.windowNote ? `<div class="vp-warnline">⚠ ${esc(c.windowNote)}</div>` : `<div class="vp-dim">${esc(span(c.plannedStart, c.plannedEnd))}</div>`}</td>
        <td data-l="CAB decision">${decPill(c.decision)}<div class="vp-dim">${esc(c.itsmState && !/^na$/i.test(c.itsmState) ? c.itsmState : '')}</div></td>
        <td data-l="Implementation">${implPill(c)}${c.result ? `<div class="vp-dim vp-res">${esc(String(c.result).slice(0, 80))}</div>` : ''}</td>
        <td data-l="Checks">${IMPL_OFF.includes(c.implStatus) ? '<span class="vp-dim">—</span>' : c.gaps && c.gaps.length ? `<span class="vp-gap" title="${esc(c.gaps.map(g => g.label + ': ' + g.value).join(' · '))}">⚠ ${esc(c.gaps.map(g => g.label.replace(/ results| approvals| plan/i, '')).join(', '))}</span>` : '<span class="vp-okline">✓ complete</span>'}</td>
        <td data-l="PIR">${c.pirStatus === 'submitted' ? '<span class="vp-okline">✓ submitted</span>' : c.pirStatus === 'due' ? '<span class="vp-warnline">to record</span>' : '<span class="vp-dim">—</span>'}</td>
      </tr>`).join('');
    const src = meeting ? `<div class="vp-cabsrc">${esc(meeting.title || '')}${meeting.importedAt ? ` · imported ${esc(KT.md(meeting.importedAt))}${meeting.importedBy && meeting.importedBy !== 'seed' ? ' by ' + esc(nameOnly(meeting.importedBy, meeting.importedByName)) : ''}` : ''}</div>` : '';
    return `${secHead('Change Advisory Board', meeting ? `CAB of ${esc(dayOnly(meeting.date))}` : 'CAB', `${sel}${imp}`, meeting && meeting.notes ? esc(meeting.notes) : 'Imported from the weekly CAB mail. The implementer of each change records the result and the PIR here.')}
      ${src}${tot ? `<div class="vp-tots">${tot}</div>` : ''}${filt}
      <div class="vp-tbl-wrap"><table class="vp-tbl vp-cabtbl"><thead><tr><th>Change</th><th>What</th><th>Tower</th><th>Window (KSA)</th><th>CAB decision</th><th>Implementation</th><th>Checks</th><th>PIR</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="vp-empty">${meeting ? 'Nothing matches this filter.' : 'No CAB imported yet.'}</td></tr>`}</tbody></table></div>
      ${cut ? `<button type="button" class="vp-btn vp-showall" data-act="caball">Show all ${list.length} changes</button>` : ''}`;
  }

  /* ---------- drawer + modal shells ---------- */
  function drawer(html) {
    let ov = $('#vpDrawer');
    if (!ov) { ov = document.createElement('div'); ov.id = 'vpDrawer'; ov.className = 'vp-dov'; ov.innerHTML = '<aside class="vp-dr" role="dialog" aria-modal="true"></aside>'; document.body.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) closeDrawer(); }); ov.querySelector('.vp-dr').addEventListener('click', onClick); ov.querySelector('.vp-dr').addEventListener('change', onChange); }
    ov.querySelector('.vp-dr').innerHTML = html; requestAnimationFrame(() => ov.classList.add('open')); ov.querySelector('.vp-dr').scrollTop = 0;
    return ov.querySelector('.vp-dr');
  }
  function closeDrawer() { const ov = $('#vpDrawer'); if (ov) ov.classList.remove('open'); }
  function modal(title, html, wide) {
    let ov = $('#vpModal');
    if (!ov) { ov = document.createElement('div'); ov.id = 'vpModal'; ov.className = 'vp-mov'; ov.innerHTML = '<div class="vp-md" role="dialog" aria-modal="true"></div>'; document.body.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) closeModal(); }); ov.querySelector('.vp-md').addEventListener('click', onClick); ov.querySelector('.vp-md').addEventListener('change', onChange); }
    const md = ov.querySelector('.vp-md'); md.classList.toggle('wide', !!wide);
    md.innerHTML = `<div class="vp-mh"><h3>${title}</h3><button type="button" class="vp-x" data-act="closemodal" aria-label="Close">${svg(IC.x, 16)}</button></div><div class="vp-mb">${html}</div>`;
    requestAnimationFrame(() => ov.classList.add('open'));
    return md;
  }
  function closeModal() { const ov = $('#vpModal'); if (ov) ov.classList.remove('open'); }
  const drHead = (inner) => `<div class="vp-drh">${inner}<button type="button" class="vp-x" data-act="closedrawer" aria-label="Close">${svg(IC.x, 16)}</button></div>`;
  const field = (label, inner, hint) => `<label class="vp-f"><span>${label}</span>${inner}${hint ? `<em>${hint}</em>` : ''}</label>`;
  const chipsPick = (name, opts, cur) => `<div class="vp-pick" data-name="${name}">${opts.map(([k, l, cls]) => `<button type="button" class="${cls || ''}${String(cur) === String(k) ? ' on' : ''}" data-act="pick" data-v="${esc(k)}">${l}</button>`).join('')}</div>`;
  const pickVal = (root, name) => { const p = root.querySelector(`.vp-pick[data-name="${name}"] .on`); return p ? p.dataset.v : ''; };
  const val = (root, sel) => { const x = root.querySelector(sel); return x ? x.value.trim() : ''; };
  function flash(root, msg, bad) { const f = root.querySelector('.vp-msg'); if (f) { f.textContent = msg; f.className = 'vp-msg ' + (bad ? 'bad' : 'ok'); } }

  /* ---------- the change drawer ---------- */
  const VERD = { ok: ['✓', 'ok'], na: ['—', 'na'], warn: ['!', 'warn'], bad: ['✕', 'bad'], missing: ['?', 'warn'], info: ['', 'info'], impact: ['⚡', 'impact'] };
  async function openChange(chg) {
    const dr = drawer(drHead(`<span class="vp-mono">${esc(chg)}</span>`) + '<div class="vp-drb"><div class="vp-empty">Loading…</div></div>');
    let r; try { r = await api('/api/cockpit/cab/changes/' + encodeURIComponent(chg)); } catch (e) { dr.querySelector('.vp-drb').innerHTML = `<div class="vp-err">${esc(e.message)}</div>`; return; }
    renderChange(dr, r);
  }
  function renderChange(dr, r) {
    const c = r.change, ed = r.canEdit, m = me();
    const ck = (c.checklist || []).map(x => { const [ic, cls] = VERD[x.verdict] || ['', 'info']; return `<div class="vp-ck vp-ck-${cls}"><span class="vp-cki">${ic}</span><span class="vp-ckl">${esc(x.label)}</span><span class="vp-ckv">${esc(x.value || 'not stated')}</span></div>`; }).join('');
    const pir = c.pir ? `<div class="vp-pir"><div class="vp-pirh">${svg(IC.check, 14)} PIR submitted${c.pir.submittedAt ? ' · ' + esc(KT.md(c.pir.submittedAt)) : ''}</div>
        <dl>${[['RFC status', c.pir.rfcStatus], ['Impact due to the change', c.pir.impact], ['Back-out implemented', c.pir.backout], ['Change manager', c.pir.changeManager], ['Change owner', c.pir.changeOwner], ['Technician', c.pir.technician], ['Deployment issues', c.pir.deploymentIssues], ['PIR summary', c.pir.summary], ['Lessons learnt', c.pir.lessons]]
          .filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`
      : c.pirStatus === 'due' ? `<div class="vp-warnbox">PIR to record — mandatory for successful and rolled-back changes (reviewed every Sunday).</div>` : '';
    const form = ed ? `<div class="vp-drsec"><div class="vp-drk">Record the implementation</div>
        ${chipsPick('impl', [['scheduled', 'Scheduled'], ['in_progress', 'In progress'], ['completed', 'Completed', 'g'], ['completed_issues', 'With issues', 'a'], ['rolled_back', 'Rolled back', 'r'], ['failed', 'Failed', 'r'], ['postponed', 'Postponed'], ['cancelled', 'Cancelled']], c.implStatus)}
        <div class="vp-row2">${field('Started (KSA)', `<input type="datetime-local" class="vp-in" id="vcStart" value="${esc(toInput(c.actualStart))}">`)}${field('Finished (KSA)', `<input type="datetime-local" class="vp-in" id="vcEnd" value="${esc(toInput(c.actualEnd))}">`)}</div>
        ${field('Result', `<textarea class="vp-in" id="vcResult" rows="2" placeholder="e.g. Change done successfully, payments under monitoring">${esc(c.result || '')}</textarea>`)}
        <div class="vp-row2">${field('Implementer', `<input class="vp-in" id="vcImpl" value="${esc(c.implementer || '')}" placeholder="team / vendor">`)}${field('Business', chipsPick('seg', [['mobile', '📱 Mobile'], ['fixed', '🏠 Fixed'], ['both', 'Both']], c.segment))}</div>
        ${m.changeManager ? field('Tower', chipsPick('tower', TW_ORDER.map(k => [k, TW[k].label]), c.tower || '')) : ''}
        <div class="vp-acts"><button type="button" class="vp-btn vp-btn-p" data-act="savechg" data-chg="${esc(c.chg)}">Save</button>
          ${!IMPL_DONE.includes(c.implStatus) ? `<button type="button" class="vp-btn" data-act="quickdone" data-chg="${esc(c.chg)}" title="Completed inside the planned window">${svg(IC.check, 13)} Completed in the window</button>` : ''}<span class="vp-msg"></span></div></div>
      ${IMPL_DONE.includes(c.implStatus) || c.pir ? `<div class="vp-drsec"><div class="vp-drk">Post-implementation review (PIR)</div>
        <div class="vp-row2">${field('RFC status', `<select class="vp-in" id="vpRfc">${['Successful', 'Successful with issues', 'Unsuccessful', 'Rolled back'].map(x => `<option${(c.pir && c.pir.rfcStatus === x) || (!c.pir && x === (c.implStatus === 'completed' ? 'Successful' : c.implStatus === 'completed_issues' ? 'Successful with issues' : c.implStatus === 'rolled_back' ? 'Rolled back' : 'Unsuccessful')) ? ' selected' : ''}>${x}</option>`).join('')}</select>`)}${field('Back-out implemented', chipsPick('backout', [['No', 'No'], ['Yes', 'Yes']], c.pir ? c.pir.backout : (c.implStatus === 'rolled_back' ? 'Yes' : 'No')))}</div>
        ${field('Impact due to the change', `<input class="vp-in" id="vpImp" value="${esc(c.pir ? c.pir.impact || '' : 'No impact')}">`)}
        <div class="vp-row2">${field('Change owner', `<input class="vp-in" id="vpOwner" value="${esc(c.pir ? c.pir.changeOwner || '' : '')}">`)}${field('Technician', `<input class="vp-in" id="vpTech" value="${esc(c.pir ? c.pir.technician || '' : c.owner || '')}">`)}</div>
        ${field('Change manager', `<input class="vp-in" id="vpMgr" value="${esc(c.pir ? c.pir.changeManager || '' : '')}">`)}
        ${field('Deployment issues', `<input class="vp-in" id="vpIss" value="${esc(c.pir ? c.pir.deploymentIssues || '' : 'No issue')}">`)}
        ${field('PIR summary', `<textarea class="vp-in" id="vpSum" rows="2">${esc(c.pir ? c.pir.summary || '' : '')}</textarea>`)}
        ${field('Lessons learnt', `<textarea class="vp-in" id="vpLes" rows="2">${esc(c.pir ? c.pir.lessons || '' : 'N/A')}</textarea>`)}
        <div class="vp-acts"><button type="button" class="vp-btn vp-btn-p" data-act="savepir" data-chg="${esc(c.chg)}">${c.pir ? 'Update the PIR' : 'Submit the PIR'}</button><span class="vp-msg"></span></div></div>` : ''}` : '';
    const log = (r.log || []).length ? `<div class="vp-drsec"><div class="vp-drk">History</div><ul class="vp-log">${r.log.map(l => `<li><b>${esc(l.field === 'impl_status' ? 'Implementation' : l.field === 'pir' ? 'PIR' : l.field.replace(/_/g, ' '))}</b> ${l.before ? `${esc(IMPL[l.before] || l.before)} → ` : ''}${esc(IMPL[l.after] || l.after || '—')}${l.note ? ` · ${esc(l.note)}` : ''}<span>${esc(nameOnly(l.created_by, l.byName))} · ${esc(KT.md(l.created_at))}</span></li>`).join('')}</ul></div>` : '';
    dr.innerHTML = drHead(`<span class="vp-mono vp-drid">${esc(c.chg)}</span>${twChip(c.tower)}${segChip(c.segment)}`) + `<div class="vp-drb">
      <h3 class="vp-drt">${esc(c.title || c.chg)}</h3>
      <div class="vp-drsub">${esc([c.area, c.release, c.supportTeam && 'support: ' + c.supportTeam, c.owner && 'owner: ' + c.owner].filter(Boolean).join(' · '))}</div>
      <div class="vp-drgrid">
        <div><span>Window (KSA)</span><b>${c.plannedStart ? esc(dayLabel(c.plannedStart) + ' ' + hm(c.plannedStart)) : '—'}${c.plannedEnd ? ' → ' + esc((dkey(c.plannedEnd) !== dkey(c.plannedStart) ? dayLabel(c.plannedEnd) + ' ' : '') + hm(c.plannedEnd)) : ''}</b>${c.windowNote ? `<em class="vp-warnline">⚠ ${esc(c.windowNote)}</em>` : `<em>${esc(span(c.plannedStart, c.plannedEnd))}</em>`}</div>
        <div><span>CAB decision</span><b>${decPill(c.decision)}</b><em>${c.meetingDate ? 'CAB of ' + esc(dayOnly(c.meetingDate)) : ''}${c.itsmState && !/^na$/i.test(c.itsmState) ? ' · ITSM: ' + esc(c.itsmState) : ''}</em></div>
        <div><span>Implementation</span><b>${implPill(c)}</b><em>${c.actualStart ? esc(hm(c.actualStart)) + (c.actualEnd ? ' → ' + esc(hm(c.actualEnd)) + ' · ' + esc(span(c.actualStart, c.actualEnd)) : '') : ''}</em></div>
        <div><span>Category · security</span><b>${esc(c.category || '—')}</b><em>security approval: ${esc(c.security || '—')}</em></div>
      </div>
      ${c.impact && !/^(na|no impact|n\/a|no)$/i.test(c.impact) ? `<div class="vp-impbox">${svg(IC.bolt, 14)} <b>${/^(siebel|brm|asap|osm|uim|aia|osb|pdc|spc|ece|upg|dms|crm)$/i.test(c.impact.trim()) ? 'Impacted system' : 'Service impact'}:</b> ${esc(c.impact)}</div>` : ''}
      ${c.result ? `<div class="vp-resbox">${svg(IC.check, 14)} <b>Result:</b> ${esc(c.result)}${c.implementer ? ` <span class="vp-dim">· ${esc(c.implementer)}</span>` : ''}${c.notifiedBy ? `<div class="vp-dim">Notified by ${esc(c.notifiedBy)}</div>` : ''}</div>` : ''}
      ${pir}
      <div class="vp-drsec"><div class="vp-drk">Prerequisites checklist (as presented to the CAB)</div>${ck ? `<div class="vp-cks">${ck}</div>` : '<div class="vp-dim">No checklist in the CAB sheet.</div>'}</div>
      ${form}${log}</div>`;
  }

  /* ---------- the challenge drawer ---------- */
  async function openChallenge(id, editMode) {
    const dr = drawer(drHead('Challenge') + '<div class="vp-drb"><div class="vp-empty">Loading…</div></div>');
    let r; try { r = await api('/api/cockpit/challenges/' + id); } catch (e) { dr.querySelector('.vp-drb').innerHTML = `<div class="vp-err">${esc(e.message)}</div>`; return; }
    if (editMode && r.canEdit) return renderChallengeForm(dr, r.challenge);
    renderChallenge(dr, r);
  }
  function renderChallenge(dr, r) {
    const c = r.challenge, m = me();
    const notes = (r.notes || []).map(x => `<li class="vp-note vp-note-${esc(x.kind)}"><div class="vp-noteh">${x.kind === 'comment' ? '<span class="vp-vpq">VP</span>' : ''}${x.tag ? `<span class="vp-ntag">${esc(x.tag)}</span>` : x.kind === 'status' ? `<span class="vp-notes-st">${svg(IC.flag, 11)} status</span>` : ''}<b>${esc(nameOnly(x.by, x.byName))}</b><span>${esc(KT.md(x.at))}</span></div><div class="vp-noteb">${esc(x.body)}</div></li>`).join('');
    /* the journey so far: every note that carries a milestone label, oldest first — date and status at a glance */
    const miles = (r.notes || []).filter(x => x.tag).slice().reverse();
    const journey = miles.length > 1 ? `<div class="vp-drsec"><div class="vp-drk">The journey so far</div><ol class="vp-jny">${miles.map((x, i) => `<li class="${i === miles.length - 1 ? 'now' : ''}"><span class="vp-jd">${esc(KT.md(x.at).slice(0, 6))}</span><span class="vp-jt">${esc(x.tag)}</span></li>`).join('')}</ol></div>` : '';
    const ph = m.isVp ? 'Ask a question or leave a note for the team…' : r.canEdit ? 'Today’s update — what moved, what is next…' : 'Add a note…';
    dr.innerHTML = drHead(`${twChip(c.tower)}${segChip(c.segment)}${sevPill(c.severity)}${chStatus(c.status)}`) + `<div class="vp-drb">
      <h3 class="vp-drt">${esc(c.title)}</h3>
      <div class="vp-drsub">${c.since ? `since ${esc(dayOnly(c.since))}${c.ageDays != null && c.status !== 'resolved' ? ` · day ${c.ageDays + 1}` : ''}` : ''}${c.eta ? ` · ETA ${esc(dayOnly(c.eta))}` : ''} · updated ${esc(ago(c.updatedAt))}${c.updatedBy ? ' by ' + esc(nameOnly(c.updatedBy, c.updatedByName)) : ''}</div>
      ${c.impact ? `<div class="vp-impbox">${svg(IC.people, 14)} <b>Impact:</b> ${esc(c.impact)}</div>` : ''}
      <div class="vp-drgrid">
        <div><span>Fix owner</span><b>${esc(c.fixOwner || '—')}</b></div>
        <div><span>Followed by</span><b>${esc(c.followedBy || 'Operations')}</b></div>
      </div>
      ${c.detail ? `<div class="vp-drsec"><div class="vp-drk">What is going on</div><div class="vp-prose">${esc(c.detail)}</div></div>` : ''}
      ${c.nextStep ? `<div class="vp-drsec"><div class="vp-drk">Solution / next step</div><div class="vp-nextbox">${esc(c.nextStep)}</div></div>` : ''}
      ${journey}
      ${c.refs ? `<div class="vp-drsec"><div class="vp-drk">References</div><div class="vp-prose vp-dim">${esc(c.refs)}</div></div>` : ''}
      ${r.canEdit ? `<div class="vp-acts"><button type="button" class="vp-btn" data-act="editch" data-id="${c.id}">Edit the challenge</button>${c.status !== 'resolved' ? `<button type="button" class="vp-btn vp-btn-g" data-act="resolvech" data-id="${c.id}">${svg(IC.check, 13)} Mark resolved</button>` : `<button type="button" class="vp-btn" data-act="reopench" data-id="${c.id}">Reopen</button>`}</div>` : ''}
      <div class="vp-drsec"><div class="vp-drk">Notes &amp; daily updates</div>
        ${r.canNote ? `<div class="vp-noteadd"><textarea class="vp-in" id="vpNote" rows="2" placeholder="${esc(ph)}"></textarea><div class="vp-acts">${r.canEdit ? `<input class="vp-in vp-tagin" id="vpNoteTag" maxlength="40" placeholder="milestone label (optional) — e.g. Fix deployed">` : ''}<button type="button" class="vp-btn vp-btn-p" data-act="addnote" data-id="${c.id}">${m.isVp ? 'Send' : 'Add the note'}</button><span class="vp-msg"></span></div></div>` : ''}
        <ul class="vp-notes">${notes || '<li class="vp-dim">No note yet.</li>'}</ul></div></div>`;
  }
  function chForm(c) {
    const m = me(); const tws = (m.towersWritable || []);
    const tw = c ? c.tower : (S.chTower && tws.includes(S.chTower) ? S.chTower : tws[0]);
    return `${field('Tower *', chipsPick('tower', TW_ORDER.filter(k => tws.includes(k)).map(k => [k, TW[k].label]), tw || ''))}
      ${field('Business', chipsPick('seg', [['mobile', '📱 Mobile'], ['fixed', '🏠 Fixed'], ['both', 'Both']], c ? c.segment : 'both'))}
      ${field('Challenge *', `<input class="vp-in" id="vfTitle" maxlength="160" value="${esc(c ? c.title : '')}" placeholder="One line: what is blocked or broken">`)}
      ${field('Impact', `<textarea class="vp-in" id="vfImpact" rows="2" placeholder="Who feels it and how much — customers, sales, call center, revenue">${esc(c ? c.impact || '' : '')}</textarea>`)}
      <div class="vp-row2">${field('Severity', chipsPick('sev', [['critical', 'Critical', 'r'], ['high', 'High', 'o'], ['medium', 'Medium', 'a'], ['low', 'Low']], c ? c.severity : 'medium'))}${field('Status', chipsPick('status', [['open', 'Open'], ['in_progress', 'In progress'], ['blocked', 'Blocked', 'r'], ['monitoring', 'Monitoring'], ['resolved', 'Resolved', 'g']], c ? c.status : 'open'))}</div>
      ${field('What is going on', `<textarea class="vp-in" id="vfDetail" rows="3" placeholder="The technical story, error codes, systems involved">${esc(c ? c.detail || '' : '')}</textarea>`)}
      ${field('Solution / next step', `<textarea class="vp-in" id="vfNext" rows="3" placeholder="What is being done, by whom, and what is needed">${esc(c ? c.nextStep || '' : '')}</textarea>`)}
      <div class="vp-row2">${field('Fix owner', `<input class="vp-in" id="vfOwner" list="vpOwners" value="${esc(c ? c.fixOwner || '' : '')}" placeholder="team or vendor fixing it">`)}${field('Followed by', `<input class="vp-in" id="vfFollow" value="${esc(c ? c.followedBy || 'Operations' : 'Operations')}">`)}</div>
      <datalist id="vpOwners">${['BSS team', 'Digital team', 'OSS team', 'Infra team', 'ITSM', 'Systems Arabia', 'TCS', 'Whale Cloud', 'Oracle', 'Sigma'].map(x => `<option value="${x}">`).join('')}</datalist>
      <div class="vp-row3">${field('Since', `<input type="date" class="vp-in" id="vfSince" value="${esc(c ? c.since || '' : today())}">`)}${field('ETA', `<input type="date" class="vp-in" id="vfEta" value="${esc(c ? c.eta || '' : '')}">`)}${field('References', `<input class="vp-in" id="vfRefs" value="${esc(c ? c.refs || '' : '')}" placeholder="mail subject, INC / CHG">`)}</div>
      ${c ? field('Note for the timeline', `<input class="vp-in" id="vfNote" placeholder="optional — why this changed">`) : ''}`;
  }
  const chPayload = root => ({ tower: pickVal(root, 'tower'), segment: pickVal(root, 'seg') || 'both', title: val(root, '#vfTitle'), impact: val(root, '#vfImpact'), severity: pickVal(root, 'sev') || 'medium',
    status: pickVal(root, 'status') || 'open', detail: val(root, '#vfDetail'), nextStep: val(root, '#vfNext'), fixOwner: val(root, '#vfOwner'), followedBy: val(root, '#vfFollow'),
    since: val(root, '#vfSince') || null, eta: val(root, '#vfEta') || null, refs: val(root, '#vfRefs'), note: val(root, '#vfNote') || undefined });
  function renderChallengeForm(dr, c) {
    dr.innerHTML = drHead(`<b>Edit the challenge</b>`) + `<div class="vp-drb vp-form">${chForm(c)}<div class="vp-acts"><button type="button" class="vp-btn vp-btn-p" data-act="savech" data-id="${c.id}">Save</button><button type="button" class="vp-btn" data-act="ch" data-id="${c.id}">Cancel</button><button type="button" class="vp-btn vp-btn-ghost" data-act="delch" data-id="${c.id}">Delete</button><span class="vp-msg"></span></div></div>`;
  }

  /* ---------- post / edit an update ---------- */
  function updForm(u) {
    const m = me(); const tws = m.towersWritable || [];
    return `<div class="vp-form">
      ${field('Tower *', chipsPick('tower', TW_ORDER.filter(k => tws.includes(k)).map(k => [k, TW[k].label]), u ? u.tower : tws[0] || ''))}
      <div class="vp-row2">${field('Kind', chipsPick('kind', Object.entries(KIND), u ? u.kind : 'update'))}${field('Tone', chipsPick('tone', [['good', 'Good news', 'g'], ['watch', 'Watch', 'a'], ['bad', 'Problem', 'r'], ['info', 'Info']], u ? u.tone : 'good'))}</div>
      ${field('Headline *', `<input class="vp-in" id="vuTitle" maxlength="160" value="${esc(u ? u.title : '')}" placeholder="e.g. CHG0030330 live — UPG double-checks payments when TAP misses the webhook">`)}
      ${field('What happened, and why it matters', `<textarea class="vp-in" id="vuBody" rows="5" placeholder="Plain language for the VP: what changed, who it helps, what to watch">${esc(u ? u.body || '' : '')}</textarea>`)}
      ${field('Felt by', `<div class="vp-pick multi" data-name="impact">${IMPACTS.map(x => `<button type="button" class="${u && (u.impact || []).includes(x) ? 'on' : ''}" data-act="pickm" data-v="${esc(x)}">${IMPACT_IC[x] || ''} ${esc(x)}</button>`).join('')}</div>`)}
      <div class="vp-row3">${field('Business', chipsPick('seg', [['mobile', '📱 Mobile'], ['fixed', '🏠 Fixed'], ['both', 'Both']], u ? u.segment : 'both'))}${field('Reference', `<input class="vp-in" id="vuRef" value="${esc(u ? u.ref || '' : '')}" placeholder="CHG / INC number">`)}${field('Status line', `<input class="vp-in" id="vuStatus" value="${esc(u ? u.status || '' : '')}" placeholder="e.g. Completed · monitoring">`)}</div>
      <div class="vp-row2">${field('When (KSA)', `<input type="datetime-local" class="vp-in" id="vuAt" value="${esc(toInput(u ? u.at : new Date().toISOString()))}">`)}${m.editor ? field('Highlight', `<label class="vp-chk"><input type="checkbox" id="vuPin"${u && u.pinned ? ' checked' : ''}> pin it at the top of the page</label>`) : ''}</div>
      <div class="vp-acts"><button type="button" class="vp-btn vp-btn-p" data-act="saveupd" data-id="${u ? u.id : ''}">${u ? 'Save' : 'Post the update'}</button>${u ? `<button type="button" class="vp-btn vp-btn-ghost" data-act="delupd" data-id="${u.id}">Delete</button>` : ''}<span class="vp-msg"></span></div></div>`;
  }

  /* ---------- vendor weekly report form (TCS template) ---------- */
  function repForm(r, isNew) {
    const d = (r && r.data) || {}; const g = (o, k) => o && o[k] != null ? o[k] : '';
    const av = ((d.availability || {}).apps || []).concat([{}, {}, {}, {}]).slice(0, 4);
    const top = (d.payments && d.payments.top || []).concat([[], [], [], [], [], []]).slice(0, 6);
    const dep = (d.deployments && d.deployments.items || []).concat([[], [], [], []]).slice(0, 4);
    const risks = (d.risks || []).concat([{}, {}, {}, {}]).slice(0, 5);
    const ports = (d.portals || []).concat([{}, {}]).slice(0, 2);
    /* a new week starts from the last one: dates move 7 days, this week's digital volumes become "last week" */
    const from = isNew && r ? addDay(r.from, 7) : (r ? r.from : today()), to = isNew && r ? addDay(r.to, 7) : (r ? r.to : today());
    const dg = d.digital || {}, prev = isNew ? { newSim: dg.newSim, portIn: dg.portIn, simSwap: dg.simSwap } : (dg.prev || {});
    const n = (id, v, ph) => `<input class="vp-in vp-num" data-k="${id}" value="${esc(v == null ? '' : v)}" inputmode="decimal" placeholder="${esc(ph || '')}">`;
    const t = (id, v, ph) => `<input class="vp-in" data-k="${id}" value="${esc(v == null ? '' : v)}" placeholder="${esc(ph || '')}">`;
    const grp = (title, inner) => `<fieldset class="vp-fs"><legend>${title}</legend>${inner}</fieldset>`;
    return `<div class="vp-form vp-repform" data-id="${isNew ? '' : r ? r.id : ''}">
      <div class="vp-hint">${isNew ? 'Pre-filled from the previous week — change what changed. The figures stay exactly as TCS presents them.' : 'Correct the figures of this week.'}</div>
      <div class="vp-row3">${field('Week from', `<input type="date" class="vp-in" data-k="from" value="${esc(from)}">`)}${field('Week to', `<input type="date" class="vp-in" data-k="to" value="${esc(to)}">`)}${field('Presented on', `<input type="date" class="vp-in" data-k="presented" value="${esc(isNew ? addDay(to, 0) : g(d, 'presented'))}">`)}</div>
      ${grp('Availability &amp; incidents', `<div class="vp-row4">${av.map((a, i) => `<div class="vp-pair">${t('av' + i + 'n', a.name, 'application')}${n('av' + i + 'p', a.pct, '%')}</div>`).join('')}</div>
        <div class="vp-row3">${field('Weeks covered', n('avw', g(d.availability, 'weeks')))}${field('Outage', t('outage', g(d.availability, 'outage'), 'None'))}${field('Major incidents', n('major', g(d.incidents, 'major')))}</div>${field('Incident note', t('incnote', g(d.incidents, 'note')))}`)}
      ${grp('Activation speed (digital)', `<div class="vp-row5">${field('≤ 30 s %', n('w30', g(d.activation, 'within30')))}${field('SIMs ≤ 30 s', n('w30n', g(d.activation, 'within30n')))}${field('< 60 s %', n('u60', g(d.activation, 'under60')))}${field('SIMs total', n('tot', g(d.activation, 'total')))}${field('Last week ≤ 30 s %', n('pw30', isNew ? g(d.activation, 'within30') : g(d.activation, 'prevWithin30')))}</div>`)}
      ${grp('Activations per day', `<div class="vp-row3"><div><div class="vp-sub">Digital · this week</div>${field('New SIM', n('dn', isNew ? '' : dg.newSim))}${field('Port-in', n('dp', isNew ? '' : dg.portIn))}${field('SIM swap', n('ds', isNew ? '' : dg.simSwap))}</div>
        <div><div class="vp-sub">Digital · last week</div>${field('New SIM', n('pn', prev.newSim))}${field('Port-in', n('pp', prev.portIn))}${field('SIM swap', n('ps', prev.simSwap))}</div>
        <div><div class="vp-sub">DMS · this week</div>${field('New SIM', n('mn', isNew ? '' : g(d.dms, 'newSim')))}${field('Port-in', n('mp', isNew ? '' : g(d.dms, 'portIn')))}${field('SIM swap', n('ms', isNew ? '' : g(d.dms, 'simSwap')))}</div></div>`)}
      ${grp('Payments · UPG', `<div class="vp-row5">${field('Success %', n('ps_', isNew ? '' : g(d.payments, 'success')))}${field('Δ pt vs last week', n('pd', isNew ? '' : g(d.payments, 'delta')))}${field('Functional %', n('pf', isNew ? '' : g(d.payments, 'functional')))}${field('Technical %', n('pt', isNew ? '' : g(d.payments, 'technical')))}${field('Successful payments', n('pc', isNew ? '' : g(d.payments, 'successful')))}</div>
        <div class="vp-row3">${top.map((x, i) => `<div class="vp-pair">${t('f' + i + 'n', isNew ? (x[0] || '') : x[0], 'failure reason')}${n('f' + i + 'p', isNew ? '' : x[1], '%')}</div>`).join('')}</div>`)}
      ${grp('Deployments &amp; tickets', `<div class="vp-row3">${field('Deployments', n('dt', isNew ? '' : g(d.deployments, 'total')))}${field('Failed', n('df', isNew ? '' : g(d.deployments, 'failed')))}${field('Emergency', n('de', isNew ? '' : g(d.deployments, 'emergency')))}</div>
        ${dep.map((x, i) => `<div class="vp-trio">${t('c' + i + 'i', isNew ? '' : x[0], 'CHG…')}${t('c' + i + 's', isNew ? '' : x[1], 'summary')}${t('c' + i + 't', isNew ? '' : x[2], 'Success')}</div>`).join('')}
        <div class="vp-row5">${field('Tickets created', n('tc', isNew ? '' : g(d.tickets, 'created')))}${field('Resolved', n('tr', isNew ? '' : g(d.tickets, 'resolved')))}${field('Open', n('to', isNew ? '' : g(d.tickets, 'open')))}${field('Avg resolution h', n('th', isNew ? '' : g(d.tickets, 'avgHours')))}${field('% within a week', n('tw', isNew ? '' : g(d.tickets, 'withinWeek')))}</div>`)}
      ${grp('Risks &amp; single points of failure', risks.map((x, i) => `<div class="vp-pair wide">${t('r' + i + 't', x.text, 'risk / issue')}${t('r' + i + 'o', x.owner, 'owner')}</div>`).join(''))}
      ${grp('Portal health check', `${field('Checked on', `<input type="date" class="vp-in" data-k="pdate" value="${esc(g(d, 'portalsDate'))}">`)}${ports.map((x, i) => `<div class="vp-portf"><div class="vp-row4">${t('p' + i + 'site', x.site, 'site')}${t('p' + i + 'label', x.label, 'label')}${t('p' + i + 'grade', x.grade, 'grade A–F')}${n('p' + i + 'perf', x.perf, 'performance %')}</div>
          <div class="vp-row4">${n('p' + i + 'str', x.structure, 'structure %')}${t('p' + i + 'lcp', x.lcp, 'LCP')}${t('p' + i + 'ld', x.loaded, 'fully loaded')}${t('p' + i + 'size', x.size, 'size · requests')}</div>${t('p' + i + 'iss', x.issue, 'top issues')}</div>`).join('')}`)}
      <div class="vp-acts"><button type="button" class="vp-btn vp-btn-p" data-act="saverep">${isNew ? 'Publish the week' : 'Save'}</button>${!isNew && r ? `<button type="button" class="vp-btn vp-btn-ghost" data-act="delrep" data-id="${r.id}">Delete this week</button>` : ''}<span class="vp-msg"></span></div></div>`;
  }
  function repPayload(root) {
    const v = k => { const el = root.querySelector(`[data-k="${k}"]`); return el ? el.value.trim() : ''; };
    const nn = k => { const x = v(k); return x === '' ? null : Number(x.replace(/[,%\s]/g, '')); };
    return { from: v('from'), to: v('to'), vendor: 'TCS', segment: 'mobile', title: 'Salam Digital MVNO IT Operations Managed Services — weekly',
      data: { presented: v('presented') || null,
        availability: { apps: [0, 1, 2, 3].map(i => ({ name: v('av' + i + 'n'), pct: nn('av' + i + 'p') })).filter(a => a.name), weeks: nn('avw'), outage: v('outage') },
        incidents: { major: nn('major'), note: v('incnote') },
        activation: { within30: nn('w30'), within30n: nn('w30n'), under60: nn('u60'), total: nn('tot'), prevWithin30: nn('pw30') },
        digital: { newSim: nn('dn'), portIn: nn('dp'), simSwap: nn('ds'), prev: { newSim: nn('pn'), portIn: nn('pp'), simSwap: nn('ps') } },
        dms: { newSim: nn('mn'), portIn: nn('mp'), simSwap: nn('ms') },
        payments: { success: nn('ps_'), delta: nn('pd'), functional: nn('pf'), technical: nn('pt'), successful: nn('pc'), top: [0, 1, 2, 3, 4, 5].map(i => [v('f' + i + 'n'), nn('f' + i + 'p')]).filter(x => x[0]) },
        deployments: { total: nn('dt'), failed: nn('df'), emergency: nn('de'), items: [0, 1, 2, 3].map(i => [v('c' + i + 'i'), v('c' + i + 's'), v('c' + i + 't')]).filter(x => x[0] || x[1]) },
        tickets: { created: nn('tc'), resolved: nn('tr'), open: nn('to'), avgHours: nn('th'), withinWeek: nn('tw') },
        risks: [0, 1, 2, 3, 4].map(i => ({ text: v('r' + i + 't'), owner: v('r' + i + 'o') })).filter(x => x.text),
        portalsDate: v('pdate') || null,
        portals: [0, 1].map(i => ({ site: v('p' + i + 'site'), label: v('p' + i + 'label'), grade: v('p' + i + 'grade'), perf: nn('p' + i + 'perf'), structure: nn('p' + i + 'str'),
          lcp: v('p' + i + 'lcp'), loaded: v('p' + i + 'ld'), size: v('p' + i + 'size'), issue: v('p' + i + 'iss') })).filter(x => x.site) } };
  }

  /* ---------- CAB import: paste the table straight from the mail ---------- */
  function importModal() {
    const md = modal('Import a CAB', `<div class="vp-imp-steps"><span class="on">1 · Paste</span><span>2 · Check</span><span>3 · Import</span></div>
      <p class="vp-dim">Open the CAB mail from IT Change Management, select from the line <b>Total changes submitted</b> down to the end of the table, copy (⌘C / Ctrl+C) and paste below (⌘V / Ctrl+V). The table keeps its columns; the totals are read from the text.</p>
      <div class="vp-paste" id="vpPaste" contenteditable="true" role="textbox" aria-label="Paste the CAB table here" data-ph="Click here and paste the CAB table"></div>
      <div id="vpPrev"></div>`, true);
    const z = md.querySelector('#vpPaste');
    z.addEventListener('paste', e => {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData; const html = cd.getData('text/html') || ''; const text = cd.getData('text/plain') || '';
      z.innerHTML = `<div class="vp-pasted">${svg(IC.check, 14)} Pasted · ${html ? Math.round(html.length / 1024) + ' KB of table' : text.split('\n').length + ' lines of text'}</div>`;
      S.pending = { html, text }; previewImport(md);
    });
    setTimeout(() => z.focus(), 50);
  }
  async function previewImport(md) {
    const box = md.querySelector('#vpPrev'); box.innerHTML = '<div class="vp-empty">Reading the table…</div>';
    let p; try { p = await send('/api/cockpit/cab/parse', S.pending); } catch (e) { box.innerHTML = `<div class="vp-err">${esc(e.message)}</div>`; return; }
    S.pending.parsed = p;
    const steps = md.querySelectorAll('.vp-imp-steps span'); steps.forEach((s, i) => s.classList.toggle('on', i <= 1));
    if (!p.changes.length) { box.innerHTML = `<div class="vp-err">No change found — copy the whole table including the header row (Change ID*, Area, …).</div>`; return; }
    const t = p.totals || {}; const warn = p.changes.filter(c => c.warnings && c.warnings.length);
    box.innerHTML = `<div class="vp-row12">${field('CAB date', `<input type="date" class="vp-in" id="viDate" value="${esc(p.defaultMeetingDate)}">`, p.meetingDate ? 'read from the mail' : 'the CAB meets on Wednesdays')}${field('Title', `<input class="vp-in" id="viTitle" value="${esc('Salam IT Change Management || CAB - ' + dayOnly(p.defaultMeetingDate))}">`)}</div>
      <div class="vp-tots">${Object.entries({ total: 'Submitted', approved: 'Approved', conditional: 'Conditional', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed', emergency: 'Emergency' }).filter(([k]) => t[k] != null).map(([k, l]) => `<span class="vp-tot"><b>${t[k]}</b>${l}</span>`).join('')}${t.computed ? '<span class="vp-dim">counted from the table — no totals in what was pasted</span>' : ''}</div>
      <div class="vp-tbl-wrap vp-prevtbl"><table class="vp-tbl"><thead><tr><th>Change</th><th>What</th><th>Tower</th><th>Window (KSA)</th><th>Decision</th><th>Checks</th><th></th></tr></thead><tbody>
      ${p.changes.map(c => `<tr><td class="vp-mono">${esc(c.chg)}</td><td>${esc(c.title || '')}<div class="vp-dim">${esc(c.area || '')}</div></td><td>${twChip(c.tower)}</td>
        <td>${c.planned_start ? esc(KT.md(c.planned_start)) : '<span class="vp-warnline">?</span>'}${c.planned_end ? '–' + esc(hm(c.planned_end)) : ''}</td><td>${decPill(c.decision)}</td>
        <td>${c.gaps && c.gaps.length ? `<span class="vp-gap">⚠ ${esc(c.gaps.map(g => g.label).join(', '))}</span>` : '<span class="vp-okline">✓</span>'}</td>
        <td>${c.existing ? `<span class="vp-dim" title="already known — CAB fields refreshed${c.existing.kept ? ', implementation status kept' : ''}">update</span>` : '<span class="vp-okline">new</span>'}</td></tr>`).join('')}</tbody></table></div>
      ${warn.length ? `<div class="vp-warnbox">${warn.map(c => `<b>${esc(c.chg)}</b>: ${esc(c.warnings.join(' · '))}`).join('<br>')}</div>` : ''}
      <div class="vp-acts"><button type="button" class="vp-btn vp-btn-p" data-act="doimport">${svg(IC.upload, 14)} Import ${p.changes.length} change${p.changes.length > 1 ? 's' : ''}</button><span class="vp-msg"></span></div>`;
  }

  /* ---------- settings: towers, leads, editors, change managers, morning brief ---------- */
  async function settingsModal() {
    const md = modal('VP cockpit — people &amp; morning brief', '<div class="vp-empty">Loading…</div>', true);
    let r, ppl = []; try { [r, ppl] = await Promise.all([api('/api/cockpit/settings'), api('/api/cockpit/people').then(x => x.people || []).catch(() => [])]); } catch (e) { md.querySelector('.vp-mb').innerHTML = `<div class="vp-err">${esc(e.message)}</div>`; return; }
    const s = r.settings, names = r.names || {}; const dl = `<datalist id="vpPeople">${ppl.map(p => `<option value="${esc(p.email)}">${esc((p.name || '') + (p.team ? ' · ' + p.team : ''))}</option>`).join('')}</datalist>`;
    const emails = (id, list, ph) => `<div class="vp-emails" data-id="${id}">${(list || []).map(e => `<span class="vp-em" data-e="${esc(e)}">${esc(names[e] || e)}<button type="button" data-act="rmemail" aria-label="remove">×</button></span>`).join('')}<input class="vp-in vp-emin" list="vpPeople" placeholder="${esc(ph || 'add an e-mail, Enter')}" data-act="addemail"></div>`;
    const dg = s.digest || {}; const stt = r.state || {};
    md.querySelector('.vp-mb').innerHTML = `${dl}<div class="vp-form">
      <div class="vp-drk">Tower leads — post and update their own tower</div>
      <div class="vp-setgrid">${s.towers.map(t => `<div class="vp-setrow" style="--tw:${(TW[t.key] || {}).color}"><span class="vp-tw" style="--tw:${(TW[t.key] || {}).color}">${esc(t.label)}</span>${emails('lead:' + t.key, t.leads, 'lead e-mail')}</div>`).join('')}</div>
      <div class="vp-row2">${field('Cockpit editors — any tower (Digital Operations)', emails('editors', s.editors))}${field('Change managers — import the CAB, edit any change (ITSM)', emails('changeManagers', s.changeManagers))}</div>
      <div class="vp-hint">Everyone listed gets the VP cockpit page automatically, on top of their own role. Admins can always do everything. The VP Operations role only comments.</div>
      <div class="vp-drk">Morning brief</div>
      <div class="vp-row3">${field('Send', `<label class="vp-chk"><input type="checkbox" id="vsOn"${dg.enabled ? ' checked' : ''}> every day</label><label class="vp-chk"><input type="checkbox" id="vsWd"${dg.weekdays ? ' checked' : ''}> skip Friday &amp; Saturday</label>`)}
        ${field('At (KSA)', `<select class="vp-in" id="vsHour">${[6, 7, 8, 9, 10].map(h => [0, 15, 30, 45].map(mi => `<option value="${h}:${mi}"${dg.hour === h && (dg.minute || 0) === mi ? ' selected' : ''}>${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}</option>`).join('')).join('')}</select>`)}
        ${field('Goes to', `<div class="vp-dim">${(r.recipients || []).length ? esc(r.recipients.join(', ')) : 'nobody yet — give someone the VP Operations role'}</div>`)}</div>
      ${field('Also send to', emails('extra', dg.extra, 'extra e-mail'))}
      <div class="vp-hint">${stt.day ? `Last brief: ${esc(stt.day)}${stt.sentAt ? ' at ' + esc(hm(stt.sentAt)) : ''} — ${stt.ok === false ? 'not sent: ' + esc(stt.error || 'error') + (stt.retry ? ' · trying again 15 min later' : '') : 'sent to ' + esc(stt.to || '—')}` : 'No brief sent yet.'}</div>
      <div class="vp-acts"><button type="button" class="vp-btn vp-btn-p" data-act="savesettings">Save</button><button type="button" class="vp-btn" data-act="brief">${svg(IC.mail, 13)} Preview the brief</button><button type="button" class="vp-btn" data-act="testbrief">Send me a test</button><span class="vp-msg"></span></div></div>`;
  }
  /* the chips, plus whatever is still typed in the box — Save must not lose an address nobody confirmed with Enter */
  const emailsOf = (root, id) => { const box = root.querySelector(`.vp-emails[data-id="${id}"]`); if (!box) return [];
    const typed = (box.querySelector('.vp-emin') || {}).value || ''; const extra = typed.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x));
    return [...new Set([...$$('.vp-em', box).map(x => x.dataset.e), ...extra])]; };
  async function briefModal() {
    const md = modal('Morning brief — preview', '<div class="vp-empty">Building the brief…</div>', true);
    let r; try { r = await api('/api/cockpit/digest/preview'); } catch (e) { md.querySelector('.vp-mb').innerHTML = `<div class="vp-err">${esc(e.message)}</div>`; return; }
    const m = me();
    md.querySelector('.vp-mb').innerHTML = `<div class="vp-subj"><span>Subject</span>${esc(r.subject)}</div><iframe class="vp-mail" sandbox="allow-same-origin" title="Morning brief preview"></iframe>
      ${m.editor ? `<div class="vp-acts"><button type="button" class="vp-btn vp-btn-p" data-act="testbrief">${svg(IC.mail, 13)} Send me a test</button><span class="vp-msg"></span></div>` : ''}`;
    md.querySelector('iframe').srcdoc = r.html.replace(/cid:[^"']+/g, 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="44"><text x="0" y="32" font-family="Arial" font-size="28" font-weight="700" fill="#ffffff">salam</text></svg>'));
  }

  /* ---------- events (one delegated handler for the page, the drawer and the modal) ---------- */
  async function onClick(e) {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act, root = t.closest('.vp-md, .vp-dr') || $('#view-vpcockpit');
    if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && act !== 'pick')) return;
    switch (act) {
      case 'refresh': return load(true);
      case 'print': return window.print();
      case 'settings': return settingsModal();
      case 'brief': return briefModal();
      case 'goto': { const el = $('#' + t.dataset.to); if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); return; }
      case 'feedtower': S.feedTower = t.dataset.k; return paint('vpUpdates', updates);
      case 'chtower': S.chTower = S.chTower === t.dataset.k ? '' : t.dataset.k; st.set('chTower', S.chTower); return paint('vpChallenges', challengesSec);
      case 'chstatus': S.chStatus = t.dataset.k; st.set('chStatus', S.chStatus); return paint('vpChallenges', challengesSec);
      case 'chseg': S.chSeg = t.dataset.k; return paint('vpChallenges', challengesSec);
      case 'cabfilter': S.cabFilter = t.dataset.f; st.set('cabFilter', S.cabFilter); paint('vpCab', cabSec); if (!t.closest('#vpCab')) { const el = $('#vpCab'); if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); } return;
      case 'cabtower': S.cabTower = t.dataset.k; return paint('vpCab', cabSec);
      case 'caball': S.cabAll = true; return paint('vpCab', cabSec);
      case 'more': { const b = t.previousElementSibling; if (b) b.classList.remove('clamp'); t.remove(); return; }
      case 'chg': e.preventDefault(); return openChange(t.dataset.chg);
      case 'ch': return openChallenge(t.dataset.id);
      case 'closedrawer': return closeDrawer();
      case 'closemodal': return closeModal();
      case 'pick': { const p = t.closest('.vp-pick'); $$('button', p).forEach(b => b.classList.toggle('on', b === t)); return; }
      case 'pickm': t.classList.toggle('on'); return;
      case 'newupd': return modal('Post an update', updForm(null));
      case 'editupd': { const u = (D().updates || []).find(x => String(x.id) === t.dataset.id); if (u) modal('Edit the update', updForm(u)); return; }
      case 'saveupd': {
        const id = t.dataset.id; const body = { tower: pickVal(root, 'tower'), kind: pickVal(root, 'kind') || 'update', tone: pickVal(root, 'tone') || 'info', title: val(root, '#vuTitle'), body: val(root, '#vuBody'),
          impact: $$('.vp-pick[data-name="impact"] .on', root).map(b => b.dataset.v), segment: pickVal(root, 'seg') || 'both', ref: val(root, '#vuRef'), status: val(root, '#vuStatus'), at: fromInput(val(root, '#vuAt')) };
        const pin = root.querySelector('#vuPin'); if (pin) body.pinned = pin.checked;
        if (!body.tower) return flash(root, 'Choose the tower', true); if (!body.title) return flash(root, 'Write a headline', true);
        t.disabled = true; try { await send(id ? '/api/cockpit/updates/' + id : '/api/cockpit/updates', body, id ? 'PATCH' : 'POST'); closeModal(); await load(true); } catch (err) { flash(root, err.message, true); } finally { t.disabled = false; } return;
      }
      case 'delupd': if (!confirm('Delete this update? It disappears from the page (the audit log keeps it).')) return;
        try { await send('/api/cockpit/updates/' + t.dataset.id, { delete: true }, 'PATCH'); closeModal(); await load(true); } catch (err) { flash(root, err.message, true); } return;
      case 'newch': { const dr = drawer(drHead('<b>New challenge</b>') + `<div class="vp-drb vp-form">${chForm(null)}<div class="vp-acts"><button type="button" class="vp-btn vp-btn-p" data-act="savech" data-id="">Raise the challenge</button><span class="vp-msg"></span></div></div>`); setTimeout(() => { const i = dr.querySelector('#vfTitle'); if (i) i.focus(); }, 60); return; }
      case 'editch': return openChallenge(t.dataset.id, true);
      case 'savech': {
        const id = t.dataset.id, body = chPayload(root);
        if (!body.tower) return flash(root, 'Choose the tower', true); if (!body.title) return flash(root, 'Write the challenge in one line', true);
        t.disabled = true; try { const r = await send(id ? '/api/cockpit/challenges/' + id : '/api/cockpit/challenges', body, id ? 'PATCH' : 'POST'); await load(true); openChallenge((r.challenge || {}).id || id); } catch (err) { flash(root, err.message, true); } finally { t.disabled = false; } return;
      }
      case 'resolvech': case 'reopench': {
        const note = act === 'resolvech' ? prompt('How was it solved? (goes on the timeline)', '') : prompt('Why is it reopened?', ''); if (note === null) return;
        try { await send('/api/cockpit/challenges/' + t.dataset.id, { status: act === 'resolvech' ? 'resolved' : 'in_progress', note: note || undefined }, 'PATCH'); await load(true); openChallenge(t.dataset.id); } catch (err) { alert(err.message); } return;
      }
      case 'delch': if (!confirm('Delete this challenge? Use “Mark resolved” when it is fixed — deleting is for mistakes.')) return;
        try { await send('/api/cockpit/challenges/' + t.dataset.id, { delete: true }, 'PATCH'); closeDrawer(); await load(true); } catch (err) { flash(root, err.message, true); } return;
      case 'addnote': {
        const ta = root.querySelector('#vpNote'); const body = ta ? ta.value.trim() : ''; if (!body) return flash(root, 'Write something first', true);
        const tg = root.querySelector('#vpNoteTag');
        t.disabled = true; try { await send('/api/cockpit/challenges/' + t.dataset.id + '/notes', { body, tag: tg && tg.value.trim() ? tg.value.trim() : undefined }); openChallenge(t.dataset.id); load(true); } catch (err) { flash(root, err.message, true); } finally { t.disabled = false; } return;
      }
      case 'checkin': case 'uncheckin': {
        const k = t.dataset.k; let note;
        if (act === 'checkin') { note = prompt(`${TW[k].label} — anything to add? (optional)`, 'Nothing new today'); if (note === null) return; }
        try { await send('/api/cockpit/checkin', act === 'checkin' ? { tower: k, note } : { tower: k, undo: true }); await load(true); } catch (err) { alert(err.message); } return;
      }
      case 'savechg': case 'quickdone': {
        const chg = t.dataset.chg; const c = chgBy(chg) || {};
        const body = act === 'quickdone' ? { implStatus: 'completed', actualStart: c.plannedStart || null, actualEnd: c.plannedEnd && new Date(c.plannedEnd) >= new Date(c.plannedStart) ? c.plannedEnd : null, result: val(root, '#vcResult') || 'Completed within the approved window.' }
          : { implStatus: pickVal(root, 'impl'), actualStart: fromInput(val(root, '#vcStart')), actualEnd: fromInput(val(root, '#vcEnd')), result: val(root, '#vcResult'), implementer: val(root, '#vcImpl'), segment: pickVal(root, 'seg') || undefined };
        if (act === 'savechg' && me().changeManager && pickVal(root, 'tower')) body.tower = pickVal(root, 'tower');
        t.disabled = true; try { await send('/api/cockpit/cab/changes/' + encodeURIComponent(chg), body, 'PATCH'); await load(true); if (S.cab) await loadCab(S.cab.meeting && S.cab.meeting.date); openChange(chg); } catch (err) { flash(root, err.message, true); } finally { t.disabled = false; } return;
      }
      case 'savepir': {
        const chg = t.dataset.chg; const pir = { rfcStatus: val(root, '#vpRfc'), backout: pickVal(root, 'backout') || 'No', impact: val(root, '#vpImp'), changeOwner: val(root, '#vpOwner'), technician: val(root, '#vpTech'),
          changeManager: val(root, '#vpMgr'), deploymentIssues: val(root, '#vpIss'), summary: val(root, '#vpSum'), lessons: val(root, '#vpLes') };
        t.disabled = true; try { await send('/api/cockpit/cab/changes/' + encodeURIComponent(chg), { pir }, 'PATCH'); await load(true); openChange(chg); } catch (err) { flash(root, err.message, true); } finally { t.disabled = false; } return;
      }
      case 'newrep': { const rep = (D().reports || []).find(r => r.vendor === 'TCS'); modal('Mobile weekly · TCS — this week', repForm(rep && rep.latest, true), true); return; }
      case 'editrep': { const rep = (D().reports || []).find(r => r.vendor === 'TCS'); const r = S.tcs && String(S.tcs.id) === t.dataset.id ? S.tcs : rep && rep.latest; if (r) modal(`Mobile weekly · TCS — week ${esc(dayOnly(r.from))} – ${esc(dayOnly(r.to))}`, repForm(r, false), true); return; }
      case 'saverep': {
        const box = root.querySelector('.vp-repform'); const id = box && box.dataset.id; const body = repPayload(root);
        if (!body.from || !body.to) return flash(root, 'Set the week first', true);
        t.disabled = true; try { await send(id ? '/api/cockpit/reports/' + id : '/api/cockpit/reports', body, id ? 'PATCH' : 'POST'); closeModal(); S.tcs = null; await load(true); toast('Mobile weekly saved'); } catch (err) { flash(root, err.message, true); } finally { t.disabled = false; } return;
      }
      case 'delrep': if (!confirm('Delete this week\u2019s report?')) return;
        try { await send('/api/cockpit/reports/' + t.dataset.id, { delete: true }, 'PATCH'); closeModal(); S.tcs = null; await load(true); } catch (err) { flash(root, err.message, true); } return;
      case 'import': return importModal();
      case 'doimport': {
        const p = S.pending; if (!p) return; const date = val(root, '#viDate'), title = val(root, '#viTitle');
        t.disabled = true; flash(root, 'Importing…');
        try { const r = await send('/api/cockpit/cab/import', { html: p.html, text: p.text, meetingDate: date, title }); S.pending = null; closeModal(); S.cab = null; S.cabFilter = 'all'; await load(true);
          toast(`CAB of ${dayOnly(r.date)} imported — ${r.inserted} new, ${r.updated} updated`); const el = $('#vpCab'); if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); }
        catch (err) { flash(root, err.message, true); } finally { t.disabled = false; } return;
      }
      case 'rmemail': t.closest('.vp-em').remove(); return;
      case 'savesettings': {
        const g = id => emailsOf(root, id); const hh = (val(root, '#vsHour') || '8:0').split(':');
        const body = { towers: TW_ORDER.map(k => ({ key: k, leads: g('lead:' + k) })), editors: g('editors'), changeManagers: g('changeManagers'),
          digest: { enabled: root.querySelector('#vsOn').checked, weekdays: root.querySelector('#vsWd').checked, hour: +hh[0], minute: +hh[1], extra: g('extra') } };
        t.disabled = true; try { await send('/api/cockpit/settings', body, 'PUT'); flash(root, 'Saved ✓ — the people listed see the page within a minute'); load(true); } catch (err) { flash(root, err.message, true); } finally { t.disabled = false; } return;
      }
      case 'testbrief': t.disabled = true; flash(root, 'Sending…');
        try { const r = await send('/api/cockpit/digest/test', {}); flash(root, r.sent ? `Sent to ${r.to}` : r.dev ? 'SMTP is not configured on this console — preview only' : 'Not sent: ' + (r.error || 'unknown'), !r.sent); } catch (err) { flash(root, err.message, true); } finally { t.disabled = false; } return;
    }
  }
  async function onChange(e) {
    const t = e.target;
    if (t.dataset && t.dataset.act === 'cabdate') { await loadCab(t.value); paint('vpCab', cabSec); }
    if (t.dataset && t.dataset.act === 'tcsweek') { const w = (S.tcsWeeks || []).find(x => String(x.id) === t.value); const rep = (D().reports || []).find(r => r.vendor === 'TCS');
      S.tcs = w && rep && rep.latest && w.id === rep.latest.id ? null : w || null; paint('vpTcs', tcsSec); }
  }
  function onKey(e) {
    const t = e.target;
    if (t.dataset && t.dataset.act === 'addemail' && (e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === 'Tab')) {
      const v = t.value.trim().replace(/,$/, '').toLowerCase(); if (!v) return; if (e.key !== 'Tab') e.preventDefault();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) { t.classList.add('bad'); return; }
      t.classList.remove('bad'); const box = t.closest('.vp-emails');
      if (!$$('.vp-em', box).some(x => x.dataset.e === v)) { const sp = document.createElement('span'); sp.className = 'vp-em'; sp.dataset.e = v; sp.innerHTML = `${esc(v)}<button type="button" data-act="rmemail" aria-label="remove">×</button>`; box.insertBefore(sp, t); }
      t.value = '';
    }
    if (e.key === 'Escape') { if ($('#vpModal.open')) closeModal(); else if ($('#vpDrawer.open')) closeDrawer(); }
    if ((e.key === 'Enter' || e.key === ' ') && t.matches && t.matches('tr[data-act]')) { e.preventDefault(); t.click(); }
  }
  function toast(msg) { let el = $('#vpToast'); if (!el) { el = document.createElement('div'); el.id = 'vpToast'; document.body.appendChild(el); } el.textContent = msg; el.className = 'show'; clearTimeout(el._t); el._t = setTimeout(() => { el.className = ''; }, 3600); }

  /* ---------- painting ---------- */
  function paint(id, fn) { const el = $('#' + id); if (el) { el.innerHTML = fn(); countUp(el); } }
  function countUp(root) {
    if (reduced()) return;
    $$('.vp-cnt[data-v]', root).forEach(el => { if (el.dataset.done) return; el.dataset.done = '1'; const v = Number(el.dataset.v); if (!isFinite(v) || v < 5) return;
      const t0 = performance.now(), dur = 700; const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(v * e).toLocaleString('en-US'); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); });
  }
  function renderAll() {
    const host = $('#view-vpcockpit'); if (!host) return;
    if (!S.d && S.err) { host.innerHTML = `<div class="vp-wrap"><div class="vp-err"><b>The cockpit could not load</b><div>${esc(S.err)}</div></div></div>`; return; }
    const tcs = tcsSec();
    const jump = [['vpKpis', 'KPIs'], ['vpUpdates', 'Last updates'], ['vpWeek', 'This week'], ['vpChallenges', 'Challenges'], ['vpTcs', 'Mobile weekly · TCS'], ['vpCab', 'CAB board']]
      .filter(([id]) => id !== 'vpTcs' || tcs).filter(([id]) => id !== 'vpKpis' || views().includes('dashboard') || views().includes('fixed'));
    host.innerHTML = `<div class="vp-wrap">
      <div id="vpHero">${hero()}</div>
      <div id="vpPulse">${pulse()}</div>
      <nav class="vp-jump" aria-label="Sections">${jump.map(([id, l]) => `<button type="button" data-act="goto" data-to="${id}">${esc(l)}</button>`).join('')}</nav>
      <div id="vpKpisW">${kpis()}</div>
      <div class="vp-cols"><section class="vp-sec vp-feed" id="vpUpdates">${updates()}</section><section class="vp-sec vp-week" id="vpWeek">${week()}</section></div>
      <section class="vp-sec" id="vpChallenges">${challengesSec()}</section>
      ${tcs ? `<section class="vp-sec" id="vpTcs">${tcs}</section>` : ''}
      <section class="vp-sec" id="vpCab">${cabSec()}</section>
      <div class="vp-foot">VP Operations cockpit · KPIs from the Executive Dashboard (7 days) · updates and challenges posted by the tower leads · changes from the weekly CAB mail, results and PIR recorded by the implementers · every change audited · times in KSA</div></div>`;
    countUp(host);
  }
  const repaintTop = () => { paint('vpHero', hero); paint('vpPulse', pulse); const k = $('#vpKpisW'); if (k) { k.innerHTML = kpis(); countUp(k); } };

  /* ---------- data ---------- */
  async function loadCab(date) {
    if (!date || (D().cab && D().cab.meeting && date === D().cab.meeting.date)) { S.cab = null; return; }
    try { S.cab = await api('/api/cockpit/cab?date=' + encodeURIComponent(date)); } catch (e) { S.cab = null; toast(e.message); }
  }
  async function load(force) {
    if (S.loading && !force) return; S.loading = true;
    const u = $('#vpUpd'); if (u) u.textContent = 'updating…';
    const v = views();
    const side = [
      (v.includes('dashboard') || v.includes('fixed')) ? api('/api/exec?range=7d').then(d => { S.exec = d; S.execErr = null; }, e => { S.execErr = e.message; }).then(repaintTop) : null,
      (v.includes('dashboard') || v.includes('fixed')) ? api('/api/exec/brief').then(d => { S.brief = d; }, () => {}).then(repaintTop) : null,
      v.includes('salesops') ? api('/api/salesops/overview').then(d => { S.sales = d; }, () => {}).then(repaintTop) : null
    ];
    try { S.d = await api('/api/cockpit/overview'); S.err = null; S.at = new Date().toISOString(); }
    catch (e) { S.err = e.message; }
    try { const tr = (S.d && S.d.reports || []).find(r => r.vendor === 'TCS'); S.tcsWeeks = tr && tr.weeks > 1 ? (await api('/api/cockpit/reports?vendor=TCS')).reports : (tr && tr.latest ? [tr.latest] : []); } catch (e) { S.tcsWeeks = []; }
    const y = window.scrollY; renderAll(); if (force) window.scrollTo(0, y);
    await Promise.all(side.filter(Boolean)).catch(() => {});
    S.loading = false; const u2 = $('#vpUpd'); if (u2) u2.textContent = S.at ? 'updated ' + hm(S.at) : '';
  }

  /* ---------- open / close ---------- */
  function parseQs(qs) { const o = {}; String(qs || '').split('&').forEach(kv => { const [k, v] = kv.split('='); if (k) o[k] = decodeURIComponent(v || ''); }); return o; }
  window.openVpCockpit = async function (qs) {
    const host = $('#view-vpcockpit'); if (!host) return;
    ensureCss();
    document.querySelectorAll('.navtab[data-view="vpcockpit"]').forEach(b => b.classList.add('active'));
    if (window.navdropSync) window.navdropSync();
    if (!S.built) { S.built = true; host.addEventListener('click', onClick); host.addEventListener('change', onChange); document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && S.open) load(); }); }
    S.open = true;
    if (!S.d) host.innerHTML = `<div class="vp-wrap"><div id="vpHero">${hero()}</div><div class="vp-pulse">${Array.from({ length: 6 }, () => '<div class="vp-tile vp-skel"><div class="vp-tl">…</div><div class="vp-tv">…</div></div>').join('')}</div></div>`;
    clearInterval(S.timer); S.timer = setInterval(() => { if (S.open && !document.hidden) load(); }, 5 * 60e3);
    clearInterval(S.clock); S.clock = setInterval(() => { const c = $('#vpClock'); if (c) c.textContent = hm(new Date()); }, 30e3);
    await load(!S.d);
    const q = parseQs(qs);
    if (q.chg) openChange(q.chg.toUpperCase());
    else if (q.challenge) openChallenge(q.challenge);
    else if (q.settings === '1' && me().canSettings) settingsModal();
    else if (q.import === '1' && me().canImport) importModal();
    else if (q.tab && $('#vp' + q.tab.charAt(0).toUpperCase() + q.tab.slice(1))) $('#vp' + q.tab.charAt(0).toUpperCase() + q.tab.slice(1)).scrollIntoView();
  };
  window.addEventListener('hashchange', () => { if (!/^#(vp|vp-operations|cockpit)(\?|$)/.test(location.hash || '')) { S.open = false; clearInterval(S.timer); clearInterval(S.clock); closeDrawer(); closeModal(); } });
  /* the gear menu entry (TEAMS MANAGEMENT › VP cockpit) opens the people & brief settings */
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('#vpCfgMenuItem'); if (!b) return; const sm = document.getElementById('settingsMenu'); if (sm) sm.classList.remove('open'); location.hash = '#vp?settings=1'; });

  /* ---------- look ---------- */
  const LEAF = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 34 42"><path fill="#ffffff" d="M11.595 0.870759C10.2028 -0.00888658 8.46605 -0.155789 6.94417 0.476069C5.4223 1.10793 4.31596 2.41589 3.94837 4.04421C3.58077 5.67253 0.0735313 21.207 0.0735313 21.207C-0.0401211 21.7203 -0.0898438 22.2389 -0.0898438 22.7522C-0.0898438 25.8548 1.93992 28.8124 4.60897 29.9345C8.0363 31.3752 28.4902 39.9062 28.4902 39.9062C28.5133 39.9168 28.5399 39.915 28.563 39.9026C28.5843 39.8902 28.6003 39.869 28.6056 39.8442C31.2978 24.3557 24.5994 9.07607 11.5968 0.87253"/></svg>');
  function ensureCss() {
    if ($('#vpCss')) return;
    const css = document.createElement('style'); css.id = 'vpCss';
    css.textContent = `
#view-vpcockpit{padding:16px 18px 40px}
.vp-wrap{max-width:1500px;margin:0 auto}
.vp-hero{position:relative;overflow:hidden;display:flex;justify-content:space-between;align-items:flex-start;gap:22px;flex-wrap:wrap;padding:26px 28px 22px;border-radius:22px;color:#eafff4;
  background:radial-gradient(900px 320px at 0% 0%,rgba(16,185,129,.32),transparent 62%),radial-gradient(700px 260px at 100% 130%,rgba(37,99,235,.22),transparent 60%),linear-gradient(135deg,#04211a 0%,#0a3a29 50%,#0c5b3e 100%);
  box-shadow:0 22px 44px -24px rgba(4,47,32,.65)}
[data-theme="dark"] .vp-hero{background:radial-gradient(900px 320px at 0% 0%,rgba(16,185,129,.25),transparent 62%),radial-gradient(700px 260px at 100% 130%,rgba(59,130,246,.18),transparent 60%),linear-gradient(135deg,#031a14 0%,#072d21 55%,#0a4430 100%);border:1px solid rgba(52,211,153,.16)}
.vp-hero::after{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:30px 30px;-webkit-mask-image:linear-gradient(100deg,transparent 35%,#000 85%);mask-image:linear-gradient(100deg,transparent 35%,#000 85%)}
.vp-hero-mark{position:absolute;right:-26px;bottom:-56px;width:250px;height:300px;opacity:.07;background:url("${LEAF}") no-repeat center/contain;transform:rotate(-8deg);pointer-events:none}
.vp-hero-l,.vp-hero-r{position:relative;z-index:1}
.vp-hero-l{flex:1 1 420px;min-width:0}
.vp-kick{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#86efc0}
.vp-hi{margin:6px 0 2px;font-size:clamp(26px,3.1vw,38px);font-weight:800;letter-spacing:-.02em;line-height:1.1;color:#fff}
.vp-date{font-size:13.5px;color:rgba(234,255,244,.78)}
.vp-hchips{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.vp-hchip{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;font:inherit;font-weight:700;font-size:12.5px;color:#eafff4;text-decoration:none;cursor:pointer;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.17);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:background .15s,border-color .15s}
.vp-hchip:hover{background:rgba(255,255,255,.15);border-color:rgba(255,255,255,.3)}
.vp-hchip i{width:8px;height:8px;border-radius:50%;background:#cbd5e1;box-shadow:0 0 0 3px rgba(255,255,255,.12)}
.vp-hchip.ok i{background:#34d399}.vp-hchip.warn i{background:#fbbf24}.vp-hchip.bad i{background:#f87171;animation:vpPulse 1.6s infinite}
.vp-hchip.ok svg{color:#34d399}.vp-hchip.warn svg{color:#fbbf24}.vp-hchip.bad svg{color:#fca5a5}
.vp-hchip.bad{border-color:rgba(248,113,113,.45);background:rgba(220,38,38,.16)}.vp-hchip.warn{border-color:rgba(251,191,36,.38)}
@keyframes vpPulse{0%{box-shadow:0 0 0 0 rgba(248,113,113,.7)}70%{box-shadow:0 0 0 9px rgba(248,113,113,0)}100%{box-shadow:0 0 0 0 rgba(248,113,113,0)}}
.vp-hero-r{display:flex;flex-direction:column;align-items:flex-end;gap:14px;flex:0 1 auto}
.vp-tools{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}
.vp-upd{font-size:11.5px;color:rgba(234,255,244,.7);margin-right:2px}
.vp-tool{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;font-weight:700;color:#eafff4;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.17);border-radius:10px;padding:6px 10px;cursor:pointer}
.vp-tool:hover{background:rgba(255,255,255,.16)}.vp-tool.vp-icon{padding:6px 8px}
.vp-doors{display:grid;grid-template-columns:repeat(4,minmax(128px,1fr));gap:8px;max-width:620px}
.vp-door{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:12px;color:#eafff4;text-decoration:none;font-size:12.5px;font-weight:700;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.13);transition:transform .15s,background .15s}
.vp-door:hover{transform:translateY(-1px);background:rgba(255,255,255,.14)}.vp-door svg{flex:0 0 auto;color:#86efc0}.vp-door span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vp-pulse{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;margin:18px 0 0}
.vp-tile{position:relative;display:flex;flex-direction:column;gap:5px;min-width:0;text-align:left;padding:15px 16px 14px 18px;border-radius:16px;background:var(--card);border:1px solid var(--line);box-shadow:0 1px 2px rgba(15,23,42,.05);color:var(--ink);text-decoration:none;font:inherit;cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s;overflow:hidden}
.vp-tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--tc,var(--line))}
.vp-tile:hover{transform:translateY(-2px);box-shadow:var(--shadow);border-color:color-mix(in srgb,var(--tc,var(--green)) 40%,var(--line))}
.vp-tile:focus-visible,.vp-btn:focus-visible,.vp-door:focus-visible,.vp-hchip:focus-visible,.vp-mini:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.vp-tile-ok{--tc:var(--green)}.vp-tile-warn{--tc:var(--amber)}.vp-tile-bad{--tc:var(--red)}.vp-tile-sales{--tc:var(--blue)}.vp-tile-none{--tc:var(--line)}
.vp-tl{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.vp-tsub b.up{color:var(--good)}.vp-tsub b.down{color:var(--bad-fg)}
.vp-tv{font-size:29px;font-weight:800;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}.vp-tv small{font-size:15px;color:var(--muted);font-weight:700}
.vp-tbiz .vp-tv{color:var(--tc)}
.vp-tdot{width:9px;height:9px;border-radius:50%;background:var(--tc,var(--line));box-shadow:0 0 0 4px color-mix(in srgb,var(--tc,var(--line)) 18%,transparent)}
.vp-ts{font-size:12px;color:var(--ink-soft);line-height:1.45}.vp-ts b{color:var(--ink)}.vp-ts2{font-size:11.5px;color:var(--muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vp-go{position:absolute;right:12px;top:13px;color:var(--muted);opacity:0;transition:opacity .15s,transform .15s}.vp-tile:hover .vp-go{opacity:1;transform:translateX(2px)}
.vp-tile .vp-tl+.vp-tv{margin-top:1px}
.vp-skel .vp-tv,.vp-skel .vp-kv{color:transparent;background:linear-gradient(90deg,var(--line-soft),var(--card2),var(--line-soft));background-size:200% 100%;border-radius:8px;animation:vpShim 1.2s infinite;width:60%}
@keyframes vpShim{0%{background-position:100% 0}100%{background-position:-100% 0}}
.vp-bars{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:4px}
.vp-bar{display:flex;flex-direction:column;align-items:center;gap:2px;font-style:normal}
.vp-bar i{display:block;width:100%;max-width:34px;border-radius:6px 6px 2px 2px;min-height:4px;align-self:center}
.vp-bars .vp-bar{justify-content:flex-end;height:58px}
.vp-bar em{font-style:normal;font-size:9.5px;font-weight:800;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}.vp-bar b{font-size:11.5px;font-variant-numeric:tabular-nums}
.vp-prog{height:5px;border-radius:99px;background:var(--line-soft);overflow:hidden;margin-top:4px}.vp-prog i{display:block;height:100%;background:linear-gradient(90deg,var(--green),#14b8a6);border-radius:99px}
.vp-sevdots{display:flex;flex-wrap:wrap;gap:5px}.vp-sevdots b,.vp-twr-b b{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px}
b.c{background:var(--tint-red);color:var(--tint-red-fg)}b.h{background:var(--tint-amber);color:var(--tint-amber-fg)}b.b{background:var(--solid);color:var(--solid-fg)}b.t{background:var(--tint-blue);color:var(--tint-blue-fg)}
.vp-twdots{display:flex;flex-wrap:wrap;gap:4px}.vp-twdots span{font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px;color:var(--muted);background:var(--card2);border:1px dashed var(--line)}
.vp-twdots span.on{color:#fff;background:var(--tw);border:1px solid var(--tw)}
.vp-sec{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px 20px;margin-top:16px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.vp-sh{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.vp-shk{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--green)}
.vp-sht{margin:2px 0 0;font-size:18px;font-weight:800;letter-spacing:-.01em}.vp-shs{font-size:12.5px;color:var(--muted);margin-top:3px;max-width:820px;line-height:1.5}
.vp-shr{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vp-link{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12.5px;font-weight:700;color:var(--green-dark);background:none;border:0;padding:0;cursor:pointer;text-decoration:none}.vp-link:hover{text-decoration:underline}
.vp-kgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.vp-kpi{display:flex;flex-direction:column;gap:3px;padding:13px 14px;border-radius:14px;border:1px solid var(--line);background:var(--card2);color:var(--ink);text-decoration:none;transition:border-color .15s,transform .15s}
.vp-kpi:hover{border-color:var(--green);transform:translateY(-1px)}
.vp-kh{display:flex;justify-content:space-between;gap:6px}.vp-kbiz{font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px}
.vp-kbiz-mobile{color:var(--blue);background:color-mix(in srgb,var(--blue) 12%,transparent)}.vp-kbiz-fixed{color:var(--green);background:color-mix(in srgb,var(--green) 12%,transparent)}
.vp-kw{font-size:10.5px;color:var(--muted);font-weight:700}.vp-kt{font-size:12px;color:var(--muted);font-weight:700}.vp-kv{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}.vp-ks{font-size:11.5px;color:var(--ink-soft)}
.vp-kd{font-size:11px;font-weight:700;color:var(--muted)}.vp-kd.good{color:var(--good)}.vp-kd.bad{color:var(--bad-fg)}
.vp-cols{display:grid;grid-template-columns:minmax(0,1.42fr) minmax(0,1fr);gap:16px;margin-top:16px;align-items:start}.vp-cols>.vp-sec{margin-top:0}
.vp-segtabs{display:inline-flex;flex-wrap:wrap;gap:4px;padding:3px;border-radius:12px;background:var(--card2);border:1px solid var(--line)}
.vp-segtabs button{font:inherit;font-size:12px;font-weight:700;color:var(--ink-soft);background:none;border:0;border-radius:9px;padding:6px 11px;cursor:pointer;white-space:nowrap}
.vp-segtabs button b{font-weight:800;color:var(--muted);margin-left:2px}.vp-segtabs button:hover{background:var(--card)}
.vp-segtabs button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 3px rgba(15,23,42,.12)}.vp-segtabs button.on b{color:var(--green)}
.vp-segtabs.sm button{padding:5px 9px;font-size:11.5px}
.vp-filt{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0 12px}
.vp-clear{font:inherit;font-size:12px;font-weight:700;border:1px solid var(--line);background:var(--green-bg);color:var(--green-dark);border-radius:999px;padding:5px 11px;cursor:pointer}
.vp-tw{display:inline-flex;align-items:center;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:999px;color:color-mix(in srgb,var(--tw) 78%,var(--ink));background:color-mix(in srgb,var(--tw) 13%,transparent);border:1px solid color-mix(in srgb,var(--tw) 32%,transparent);white-space:nowrap}
.vp-tw-none{--tw:#94a3b8}
.vp-seg{display:inline-flex;font-size:10.5px;font-weight:700;color:var(--muted);padding:2px 7px;border-radius:999px;background:var(--card2);border:1px solid var(--line);white-space:nowrap}
.vp-seg-mobile{color:var(--tint-violet-fg);background:var(--tint-violet);border-color:transparent}.vp-seg-fixed{color:var(--tint-green-fg);background:var(--tint-green);border-color:transparent}
.vp-ref{font:inherit;font-family:var(--mono);font-size:11px;font-weight:700;color:var(--green-dark);background:var(--green-bg);border:1px solid var(--green-line);border-radius:6px;padding:1px 6px;cursor:pointer}
.vp-ustatus{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--card2);color:var(--ink-soft)}
.vp-ustatus.vp-tone-good{background:var(--ok-bg);color:var(--ok-fg)}.vp-ustatus.vp-tone-watch{background:var(--tint-amber);color:var(--tint-amber-fg)}.vp-ustatus.vp-tone-bad{background:var(--tint-red);color:var(--tint-red-fg)}
.vp-umeta{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.vp-pin{position:relative;display:flex;gap:14px;padding:20px 18px 14px;border-radius:16px;margin:14px 0;border:2px solid transparent;background:linear-gradient(var(--card),var(--card)) padding-box,linear-gradient(130deg,var(--green),#14b8a6 45%,var(--blue)) border-box;box-shadow:0 14px 30px -20px rgba(14,159,90,.7)}
.vp-pin.vp-tone-watch{background:linear-gradient(var(--card),var(--card)) padding-box,linear-gradient(130deg,var(--amber),var(--orange)) border-box}
.vp-pin.vp-tone-bad{background:linear-gradient(var(--card),var(--card)) padding-box,linear-gradient(130deg,var(--red),var(--orange)) border-box}
.vp-pin-rib{position:absolute;top:-2px;right:18px;display:flex;align-items:center;gap:4px;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fff;background:var(--green);padding:4px 10px;border-radius:0 0 9px 9px}
.vp-pin-ic{flex:0 0 44px;height:44px;border-radius:13px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--green),#14b8a6)}
.vp-pin-ic.vp-tone-watch{background:linear-gradient(135deg,var(--amber),var(--orange))}.vp-pin-ic.vp-tone-bad{background:linear-gradient(135deg,var(--red),var(--orange))}.vp-pin-ic.vp-tone-info{background:linear-gradient(135deg,var(--blue),var(--violet))}
.vp-pin-main{flex:1;min-width:0}.vp-pin-t{margin:8px 0 6px;font-size:17px;line-height:1.35;font-weight:800;letter-spacing:-.01em}
.vp-ubody{font-size:13.5px;line-height:1.6;color:var(--ink-soft);white-space:pre-wrap}.vp-ubody.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.vp-more{font:inherit;font-size:12px;font-weight:700;color:var(--green-dark);background:none;border:0;padding:2px 0;cursor:pointer}
.vp-impacts{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px}.vp-impl-l{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-right:2px}
.vp-imp{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:var(--card2);border:1px solid var(--line);color:var(--ink-soft)}
.vp-ufoot{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:10px;font-size:11.5px;color:var(--muted)}
.vp-auto{font-style:italic}
.vp-day{font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px}
.vp-tline{list-style:none;margin:0;padding:0;position:relative}
.vp-tline::before{content:"";position:absolute;left:14px;top:8px;bottom:8px;width:2px;background:var(--line);border-radius:2px}
.vp-tl-item{position:relative;padding:0 0 12px 42px}
.vp-tl-dot{position:absolute;left:0;top:2px;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--card);border:2px solid var(--tcol,var(--line));color:var(--tcol,var(--muted));z-index:1}
.vp-tl-item.vp-tone-good{--tcol:var(--green)}.vp-tl-item.vp-tone-watch{--tcol:var(--amber)}.vp-tl-item.vp-tone-bad{--tcol:var(--red)}.vp-tl-item.vp-tone-info{--tcol:var(--blue)}
.vp-tl-card{padding:11px 13px;border-radius:13px;border:1px solid var(--line);background:var(--card2)}
.vp-tl-time{margin-left:auto;font-size:11.5px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.vp-ut{font-size:14px;font-weight:700;margin:6px 0 3px;line-height:1.4}
.vp-wk{display:flex;gap:16px;align-items:center;padding:12px;border-radius:14px;background:var(--card2);border:1px solid var(--line)}
.vp-wkring{position:relative;width:110px;height:110px;flex:0 0 110px}.vp-donut{width:110px;height:110px}
.vp-wkc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.vp-wkc b{font-size:24px;font-weight:800;line-height:1}.vp-wkc span{font-size:10.5px;color:var(--muted);font-weight:700}
.vp-wkleg{display:flex;flex-direction:column;gap:5px;font-size:12.5px;min-width:0}.vp-wkleg span{display:flex;align-items:center;gap:7px}.vp-wkleg i{width:10px;height:10px;border-radius:3px}.vp-wkleg b{margin-left:auto;padding-left:10px}
.vp-wktot{font-size:11.5px;color:var(--muted);margin-top:4px;line-height:1.5}.vp-red{color:var(--red)}
.vp-wkh{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px}
.vp-clist{display:flex;flex-direction:column;gap:6px}
.vp-minis{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card)}
.vp-mini{display:grid;grid-template-columns:22px minmax(0,1fr) auto 44px;gap:8px;align-items:center;width:100%;text-align:left;font:inherit;color:var(--ink);background:none;border:0;border-top:1px solid var(--line-soft);padding:8px 10px;cursor:pointer}
.vp-mini:first-child{border-top:0}.vp-mini:hover{background:var(--card2)}
.vp-mres{width:20px;height:20px;border-radius:6px;display:grid;place-items:center}
.vp-mres-ok{background:var(--ok-bg);color:var(--ok-fg)}.vp-mres-warn{background:var(--tint-amber);color:var(--tint-amber-fg)}.vp-mres-bad{background:var(--red);color:#fff}.vp-mres-wait{background:var(--tint-amber);color:var(--orange)}.vp-mres-sched{background:var(--tint-blue);color:var(--tint-blue-fg)}
.vp-mt{font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vp-mtime{font-size:11.5px;color:var(--muted);font-weight:700;text-align:right;font-variant-numeric:tabular-nums}
.vp-mini-tonight{grid-template-columns:22px minmax(0,1fr) auto 88px}.vp-mini-week{grid-template-columns:22px minmax(0,1fr) auto 76px}
.vp-mres-live{background:var(--tint-amber)}.vp-mgap{margin-left:6px;color:var(--warn-fg);font-size:11px}
.vp-wkhs{margin-left:auto;font-size:11px;letter-spacing:0;text-transform:none;font-weight:700;color:var(--muted)}.vp-wkhs b{color:var(--orange)}
.vp-cwin{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:5px;flex-wrap:wrap}.vp-cwin em{font-style:normal;font-weight:600;color:var(--muted);font-size:12px}.vp-cwin b{font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em}
.vp-live{width:8px;height:8px;border-radius:50%;background:var(--amber);animation:vpLive 1.4s infinite}
@keyframes vpLive{0%{box-shadow:0 0 0 0 rgba(217,119,6,.7)}70%{box-shadow:0 0 0 8px rgba(217,119,6,0)}100%{box-shadow:0 0 0 0 rgba(217,119,6,0)}}
.vp-cmain{min-width:0;display:flex;flex-direction:column;gap:4px}.vp-ct{font-size:13px;font-weight:700;line-height:1.35;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.vp-cs{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.vp-mono{font-family:var(--mono);font-size:11.5px;color:var(--muted)}
.vp-gap{font-size:11px;font-weight:700;color:var(--tint-amber-fg);background:var(--tint-amber);padding:2px 7px;border-radius:999px;white-space:nowrap}
.vp-impl,.vp-st{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;padding:4px 10px;border-radius:999px;white-space:nowrap;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent)}
.vp-impl i,.vp-st i{width:7px;height:7px;border-radius:50%;background:var(--c)}
.vp-impl-scheduled{--c:var(--blue)}.vp-impl-in_progress{--c:var(--amber)}.vp-impl-completed{--c:var(--green)}.vp-impl-completed_issues{--c:var(--amber)}
.vp-impl-rolled_back,.vp-impl-failed{--c:var(--red)}.vp-impl-postponed,.vp-impl-cancelled,.vp-impl-rejected{--c:var(--muted)}.vp-impl-awaiting{--c:var(--orange)}
.vp-impl-in_progress i{animation:vpLive 1.4s infinite}
.vp-st-open{--c:var(--blue)}.vp-st-in_progress{--c:var(--teal)}.vp-st-blocked{--c:var(--red)}.vp-st-monitoring{--c:var(--violet)}.vp-st-resolved{--c:var(--green)}
.vp-sev{display:inline-flex;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:3px 9px;border-radius:7px;white-space:nowrap}
.vp-sev-critical{background:var(--red);color:#fff}.vp-sev-high{background:var(--orange);color:#fff}.vp-sev-medium{background:var(--tint-amber);color:var(--tint-amber-fg)}.vp-sev-low{background:var(--card2);color:var(--muted);border:1px solid var(--line)}
.vp-dec{display:inline-flex;font-size:11px;font-weight:800;padding:3px 9px;border-radius:7px;white-space:nowrap}
.vp-dec-ok{background:var(--ok-bg);color:var(--ok-fg)}.vp-dec-good{background:var(--green);color:#fff}.vp-dec-warn{background:var(--tint-amber);color:var(--tint-amber-fg)}.vp-dec-bad{background:var(--tint-red);color:var(--tint-red-fg)}.vp-dec-off{background:var(--card2);color:var(--muted);border:1px solid var(--line)}
.vp-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.vp-cald{border:1px solid var(--line);border-radius:12px;padding:7px 6px;min-height:76px;display:flex;flex-direction:column;align-items:center;gap:5px;background:var(--card)}
.vp-cald.has{background:var(--card2);border-color:color-mix(in srgb,var(--green) 30%,var(--line))}
.vp-calh{display:flex;flex-direction:column;align-items:center;line-height:1.1}.vp-calh b{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.vp-calh span{font-size:15px;font-weight:800}
.vp-caldots{display:flex;flex-wrap:wrap;justify-content:center;gap:4px}.vp-caldots button{width:11px;height:11px;border-radius:50%;border:0;padding:0;background:var(--tw);cursor:pointer;box-shadow:0 0 0 2px var(--card)}
.vp-caln{font-size:10.5px;color:var(--muted);font-weight:700;margin-top:auto}
.vp-twrs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:14px}
.vp-twr{display:flex;flex-direction:column;border-radius:15px;border:1px solid var(--line);border-top:4px solid var(--tw);background:color-mix(in srgb,var(--tw) 5%,var(--card));overflow:hidden;transition:box-shadow .15s,transform .15s}
.vp-twr:hover{box-shadow:var(--shadow);transform:translateY(-1px)}.vp-twr.on{box-shadow:0 0 0 2px var(--tw)}
.vp-twr-main{flex:1;display:flex;flex-direction:column;gap:6px;text-align:left;font:inherit;color:var(--ink);background:none;border:0;padding:13px 14px 10px;cursor:pointer}
.vp-twr-h{display:flex;justify-content:space-between;align-items:baseline}.vp-twr-n{font-size:15px;font-weight:800;color:color-mix(in srgb,var(--tw) 80%,var(--ink))}
.vp-twr-c{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums}.vp-twr-c small{font-size:11px;color:var(--muted);font-weight:700}
.vp-twr-s{font-size:11.5px;color:var(--muted);line-height:1.35;min-height:31px}
.vp-twr-b{display:flex;flex-wrap:wrap;gap:4px;min-height:20px}
.vp-twr-l{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--ink-soft)}
.vp-twr-f{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between;padding:8px 14px;border-top:1px solid var(--line);background:var(--card)}
.vp-rep{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:var(--muted)}.vp-rep.ok{color:var(--good)}.vp-rep.late{color:var(--warn-fg)}
.vp-dim{color:var(--muted);font-size:11.5px}
.vp-tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px}
.vp-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.vp-tbl th{position:sticky;top:0;z-index:1;text-align:left;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);background:var(--card2);padding:10px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.vp-tbl td{padding:11px 10px;border-top:1px solid var(--line-soft);vertical-align:top}
.vp-tbl tbody tr:first-child td{border-top:0}
.vp-tbl tbody tr[data-act]{cursor:pointer;transition:background .12s}.vp-tbl tbody tr[data-act]:hover{background:var(--card2)}
.vp-tbl tbody tr:focus-visible{outline:2px solid var(--green);outline-offset:-2px}
.vp-chtbl td:first-child{box-shadow:inset 4px 0 0 var(--sevc,transparent)}
.vp-sevrow-critical{--sevc:var(--red)}.vp-sevrow-high{--sevc:var(--orange)}.vp-sevrow-medium{--sevc:var(--amber)}.vp-sevrow-low{--sevc:var(--line)}
.vp-chmain{min-width:240px;max-width:380px}.vp-cht{font-weight:800;line-height:1.35}.vp-chi{font-size:12px;color:var(--ink-soft);margin-top:4px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.vp-chnext{min-width:220px;max-width:340px}.vp-next{font-size:12px;line-height:1.45;color:var(--ink-soft);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.vp-own{font-weight:700;font-size:12.5px}.vp-segline{margin-top:5px}
.vp-last{font-size:12px;line-height:1.4;color:var(--ink-soft);max-width:260px}.vp-ncount{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--muted);margin-top:3px}
.vp-vpq{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.06em;color:#fff;background:var(--violet);border-radius:5px;padding:1px 5px;margin-right:5px}
.vp-chgid{font-weight:800;color:var(--ink);white-space:nowrap}
.vp-row-wait td:first-child{box-shadow:inset 4px 0 0 var(--orange)}
.vp-warnline{color:var(--warn-fg);font-size:11.5px;font-weight:700}.vp-okline{color:var(--good);font-size:11.5px;font-weight:700}.vp-res{max-width:220px;margin-top:4px}
.vp-tots{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 12px}.vp-tot{display:inline-flex;align-items:baseline;gap:6px;font-size:12px;font-weight:700;color:var(--ink-soft);padding:6px 11px;border-radius:10px;background:var(--card2);border:1px solid var(--line)}.vp-tot b{font-size:16px;color:var(--ink)}
.vp-tot-rejected b{color:var(--red)}.vp-tot-completed b{color:var(--green)}.vp-tot-emergency.on b{color:var(--red)}
.vp-cabsrc{font-size:11.5px;color:var(--muted);margin:-6px 0 10px}
.vp-msel{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:10px;padding:2px 4px 2px 10px;background:var(--card2);color:var(--muted)}
.vp-msel select{font:inherit;font-size:12.5px;font-weight:700;border:0;background:transparent;color:var(--ink);padding:6px 4px;cursor:pointer}
.vp-btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-weight:700;font-size:13px;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;transition:background .15s,border-color .15s,transform .1s;white-space:nowrap}
.vp-btn:hover{border-color:var(--green)}.vp-btn:active{transform:translateY(1px)}.vp-btn[disabled]{opacity:.55;cursor:progress}
.vp-btn-p{background:var(--green);border-color:var(--green);color:#fff}.vp-btn-p:hover{background:var(--green-dark);border-color:var(--green-dark)}
.vp-btn-g{color:var(--good);border-color:color-mix(in srgb,var(--good) 45%,var(--line))}.vp-btn-ghost{color:var(--bad-fg);border-color:transparent;background:transparent}
.vp-empty{padding:18px 4px;color:var(--muted);font-size:13px;text-align:center}.vp-empty.sm{padding:10px 4px;text-align:left}
.vp-err{padding:14px 16px;border-radius:12px;background:var(--tint-red);color:var(--tint-red-fg);font-size:13px}
.vp-foot{margin:18px 4px 0;font-size:11.5px;color:var(--muted);text-align:center;line-height:1.6}
.vp-dov{position:fixed;inset:0;z-index:1260;background:var(--scrim);opacity:0;pointer-events:none;transition:opacity .2s}.vp-dov.open{opacity:1;pointer-events:auto}
.vp-dr{position:absolute;top:0;right:0;bottom:0;width:min(640px,100vw);background:var(--bg);box-shadow:var(--shadow-lg);transform:translateX(102%);transition:transform .26s cubic-bezier(.2,.8,.2,1);overflow-y:auto;overscroll-behavior:contain}
.vp-dov.open .vp-dr{transform:none}
.vp-drh{position:sticky;top:0;z-index:3;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:14px 18px;background:var(--card);border-bottom:1px solid var(--line)}
.vp-drid{font-size:14px;font-weight:800;color:var(--ink)}
.vp-x{margin-left:auto;display:grid;place-items:center;width:32px;height:32px;border-radius:9px;border:1px solid var(--line);background:var(--card2);color:var(--ink);cursor:pointer}.vp-x:hover{border-color:var(--red);color:var(--red)}
.vp-drb{padding:18px 20px 40px}.vp-drt{margin:0 0 6px;font-size:20px;line-height:1.3;font-weight:800;letter-spacing:-.01em}.vp-drsub{font-size:12.5px;color:var(--muted);margin-bottom:14px}
.vp-drgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}
.vp-drgrid>div{display:flex;flex-direction:column;gap:4px;padding:11px 12px;border-radius:12px;background:var(--card);border:1px solid var(--line)}
.vp-drgrid>div>span{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.vp-drgrid>div>b{font-size:13.5px}.vp-drgrid>div>em{font-style:normal;font-size:11.5px;color:var(--muted)}
.vp-drsec{margin-top:18px}.vp-drk{font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--green);margin:0 0 9px}
.vp-impbox,.vp-resbox,.vp-nextbox,.vp-warnbox{padding:11px 13px;border-radius:12px;font-size:13px;line-height:1.55;margin:10px 0}
.vp-impbox{background:var(--tint-amber);color:var(--tint-amber-fg)}.vp-impbox svg,.vp-resbox svg{vertical-align:-2px}
.vp-resbox{background:var(--ok-bg);color:var(--ok-fg)}.vp-nextbox{background:var(--card);border:1px solid var(--green-line);border-left:4px solid var(--green);color:var(--ink)}
.vp-warnbox{background:var(--tint-warn-bg);color:var(--tint-warn-fg);border:1px solid var(--tint-warn-line)}
.vp-prose{font-size:13.5px;line-height:1.6;white-space:pre-wrap}
.vp-cks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.vp-ck{display:grid;grid-template-columns:22px minmax(0,1fr);gap:2px 8px;align-items:start;padding:8px 10px;border-radius:10px;background:var(--card);border:1px solid var(--line)}
.vp-cki{grid-row:span 2;width:20px;height:20px;border-radius:6px;display:grid;place-items:center;font-size:12px;font-weight:800;background:var(--card2);color:var(--muted)}
.vp-ckl{font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.vp-ckv{font-size:12.5px;line-height:1.35;word-break:break-word}
.vp-ck-ok .vp-cki{background:var(--ok-bg);color:var(--ok-fg)}.vp-ck-warn{border-color:var(--amber-line)}.vp-ck-warn .vp-cki{background:var(--tint-amber);color:var(--tint-amber-fg)}
.vp-ck-bad{border-color:var(--red-line)}.vp-ck-bad .vp-cki{background:var(--red);color:#fff}.vp-ck-impact .vp-cki{background:var(--tint-amber);color:var(--tint-amber-fg)}
.vp-pir{padding:12px 14px;border-radius:12px;border:1px solid var(--green-line);background:var(--card);margin:10px 0}.vp-pirh{display:flex;align-items:center;gap:6px;font-weight:800;color:var(--good);margin-bottom:8px}
.vp-pir dl{display:grid;grid-template-columns:minmax(120px,auto) 1fr;gap:5px 14px;margin:0;font-size:12.5px}.vp-pir dt{color:var(--muted);font-weight:700}.vp-pir dd{margin:0}
.vp-log{list-style:none;margin:0;padding:0;font-size:12.5px}.vp-log li{padding:7px 0;border-top:1px solid var(--line-soft)}.vp-log li span{display:block;font-size:11.5px;color:var(--muted)}
.vp-notes{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.vp-note{padding:10px 12px;border-radius:12px;background:var(--card);border:1px solid var(--line)}
.vp-note-comment{border-color:color-mix(in srgb,var(--violet) 40%,var(--line));background:color-mix(in srgb,var(--violet) 6%,var(--card))}.vp-note-status{border-style:dashed}
.vp-noteh{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;margin-bottom:4px}.vp-noteh span:last-child{margin-left:auto;color:var(--muted);font-size:11.5px}
.vp-noteb{font-size:13px;line-height:1.55;white-space:pre-wrap}
.vp-notes-st{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.vp-ntag{display:inline-flex;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--green-bg);color:var(--green-dark);border:1px solid var(--green-line)}
.vp-jny{list-style:none;margin:0;padding:4px 0 2px;display:flex;flex-direction:column;gap:0;position:relative}
.vp-jny li{position:relative;display:grid;grid-template-columns:62px 1fr;gap:12px;align-items:center;padding:6px 0 6px 0}
.vp-jny li::before{content:"";position:absolute;left:73px;top:0;bottom:0;width:2px;background:var(--line)}
.vp-jny li:first-child::before{top:50%}.vp-jny li:last-child::before{bottom:50%}
.vp-jny li::after{content:"";position:absolute;left:68px;top:50%;width:12px;height:12px;margin-top:-6px;border-radius:50%;background:var(--card);border:3px solid var(--green)}
.vp-jny li.now::after{background:var(--amber);border-color:var(--amber);box-shadow:0 0 0 4px color-mix(in srgb,var(--amber) 25%,transparent)}
.vp-jd{font-size:12px;font-weight:800;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.vp-jt{margin-left:22px;font-size:13px;font-weight:700;padding:5px 11px;border-radius:9px;background:var(--card);border:1px solid var(--line);justify-self:start}
.vp-jny li.now .vp-jt{border-color:var(--amber);background:var(--tint-amber);color:var(--tint-amber-fg)}
.vp-noteadd{display:flex;flex-direction:column;gap:6px}.vp-tagin{max-width:260px;font-size:12px!important;padding:7px 9px!important}
.vp-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.vp-msg{font-size:12.5px;font-weight:700}.vp-msg.ok{color:var(--good)}.vp-msg.bad{color:var(--bad-fg)}
.vp-mov{position:fixed;inset:0;z-index:1270;background:var(--scrim);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 30px;overflow-y:auto;opacity:0;pointer-events:none;transition:opacity .2s}
.vp-mov.open{opacity:1;pointer-events:auto}
.vp-md{width:min(660px,100%);background:var(--card);border-radius:18px;border:1px solid var(--line);box-shadow:var(--shadow-lg);transform:translateY(8px);transition:transform .2s}.vp-mov.open .vp-md{transform:none}.vp-md.wide{width:min(1000px,100%)}
.vp-mh{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line)}.vp-mh h3{margin:0;font-size:17px;font-weight:800}
.vp-mb{padding:18px 20px 20px}
.vp-f{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;min-width:0}.vp-f>span{font-size:11.5px;font-weight:800;color:var(--muted);letter-spacing:.02em}.vp-f>em{font-style:normal;font-size:11px;color:var(--muted)}
.vp-in{font:inherit;font-size:13.5px;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--card2);color:var(--ink);width:100%;box-sizing:border-box}
.vp-in:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 22%,transparent)}.vp-in.bad{border-color:var(--red)}
textarea.vp-in{resize:vertical;line-height:1.5}
.vp-row2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.vp-row12{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:12px}.vp-row3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.vp-pick{display:flex;flex-wrap:wrap;gap:6px}.vp-drsec>.vp-pick{margin-bottom:12px}
.vp-pick button{font:inherit;font-size:12.5px;font-weight:700;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card2);color:var(--ink-soft);cursor:pointer}
.vp-pick button:hover{border-color:var(--green)}.vp-pick button.on{background:var(--green);border-color:var(--green);color:#fff}
.vp-pick button.r.on{background:var(--red);border-color:var(--red)}.vp-pick button.o.on{background:var(--orange);border-color:var(--orange)}.vp-pick button.a.on{background:var(--amber);border-color:var(--amber)}.vp-pick button.g.on{background:var(--good);border-color:var(--good)}
.vp-chk{display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer}
.vp-hint{font-size:12px;color:var(--muted);margin:-2px 0 14px;line-height:1.5}
.vp-setgrid{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}.vp-setrow{display:grid;grid-template-columns:76px 1fr;gap:10px;align-items:center}
.vp-emails{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px;border:1px solid var(--line);border-radius:10px;background:var(--card2);min-height:42px}
.vp-em{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;padding:3px 4px 3px 10px;border-radius:999px;background:var(--card);border:1px solid var(--line)}
.vp-em button{border:0;background:none;color:var(--muted);cursor:pointer;font-size:15px;line-height:1;padding:0 4px}.vp-em button:hover{color:var(--red)}
.vp-emin{flex:1;min-width:180px;border:0!important;background:transparent!important;box-shadow:none!important;padding:5px 6px!important}
.vp-imp-steps{display:flex;gap:6px;margin-bottom:10px}.vp-imp-steps span{font-size:11.5px;font-weight:800;padding:4px 10px;border-radius:999px;background:var(--card2);color:var(--muted);border:1px solid var(--line)}.vp-imp-steps span.on{background:var(--green-bg);color:var(--green-dark);border-color:var(--green-line)}
.vp-paste{min-height:110px;border:2px dashed var(--line);border-radius:14px;padding:16px;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:13.5px;color:var(--muted);cursor:text;outline:none;margin:10px 0 14px}
.vp-paste:focus{border-color:var(--green);background:var(--green-bg)}.vp-paste:empty::before{content:attr(data-ph)}
.vp-pasted{display:inline-flex;align-items:center;gap:7px;font-weight:800;color:var(--good)}
.vp-prevtbl{max-height:46vh;overflow:auto;margin-bottom:10px}
.vp-subj{font-size:13px;margin-bottom:10px}.vp-subj span{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-right:8px}
.vp-mail{width:100%;height:66vh;border:1px solid var(--line);border-radius:12px;background:#f2f4f3}
#vpToast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);z-index:1290;padding:11px 18px;border-radius:12px;background:var(--tip-bg);color:var(--tip-fg);font-size:13px;font-weight:700;box-shadow:var(--shadow-lg);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
#vpToast.show{opacity:1;transform:translate(-50%,0)}
.vp-jump{position:sticky;top:calc(var(--hdr,55px) + 6px);z-index:20;display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 0;padding:6px;border-radius:14px;background:color-mix(in srgb,var(--card) 88%,transparent);border:1px solid var(--line);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 6px 18px -12px rgba(15,23,42,.35)}
.vp-jump button{font:inherit;font-size:12.5px;font-weight:700;color:var(--ink-soft);background:none;border:0;border-radius:9px;padding:6px 12px;cursor:pointer}.vp-jump button:hover{background:var(--card2);color:var(--ink)}
.vp-sec{scroll-margin-top:calc(var(--hdr,55px) + 64px)}
.vp-wkpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
.vp-wkpi{position:relative;display:flex;flex-direction:column;gap:4px;padding:12px 13px 11px 15px;border-radius:13px;border:1px solid var(--line);background:var(--card2);overflow:hidden}
.vp-wkpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--tc,var(--line))}
.vp-wv{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.15}.vp-wv small{font-size:12px;color:var(--muted);font-weight:700}
.vp-wkpi .vp-ts b.up{color:var(--good)}.vp-wkpi .vp-ts b.down{color:var(--bad-fg)}
.vp-tcs3{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:12px;margin-top:14px}
.vp-tcsb{padding:13px 14px;border-radius:13px;border:1px solid var(--line);background:var(--card);min-width:0}
.vp-vg+.vp-vg{margin-top:10px}.vp-vh{font-size:11px;font-weight:800;color:var(--muted);margin-bottom:5px}
.vp-vr{display:grid;grid-template-columns:64px minmax(0,1fr) 44px 52px;gap:8px;align-items:center;font-size:12.5px;margin:4px 0}.vp-vr b{text-align:right;font-variant-numeric:tabular-nums}
.vp-vl{color:var(--ink-soft);font-weight:600}.vp-vb{height:8px;border-radius:99px;background:var(--line-soft);overflow:hidden}.vp-vb i{display:block;height:100%;border-radius:99px;background:var(--orange)}
.vp-dl{font-size:11px;font-weight:800;white-space:nowrap}.vp-dl.up{color:var(--good)}.vp-dl.down{color:var(--bad-fg)}
.vp-fl{display:flex;flex-direction:column;gap:5px;margin-bottom:6px}.vp-fr{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) 50px;gap:8px;align-items:center;font-size:12.5px}.vp-fr span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vp-fr b{text-align:right;font-variant-numeric:tabular-nums}
.vp-risks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px;font-size:12.5px;line-height:1.45}.vp-risks li{display:grid;grid-template-columns:10px 1fr;gap:8px}
.vp-rdot{width:8px;height:8px;border-radius:50%;background:var(--orange);margin-top:6px}
.vp-ports{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.vp-port{display:flex;gap:12px;padding:12px 13px;border-radius:13px;border:1px solid var(--line);background:var(--card)}
.vp-grade{flex:0 0 44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:24px;font-weight:800;color:#fff}
.vp-grade-good{background:var(--good)}.vp-grade-mid{background:var(--amber)}.vp-grade-bad{background:linear-gradient(135deg,var(--orange),var(--red))}
.vp-portm{min-width:0;flex:1}.vp-portt{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.vp-portt b{font-size:13.5px}
.vp-portk{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--ink-soft);margin:4px 0}.vp-porti{font-size:12px;color:var(--muted);line-height:1.45}
.vp-fs{border:1px solid var(--line);border-radius:12px;padding:10px 12px 4px;margin:0 0 12px}.vp-fs legend{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--green);padding:0 6px}
.vp-row4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:8px}.vp-row5{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.vp-pair{display:grid;grid-template-columns:minmax(0,1fr) 84px;gap:6px;margin-bottom:8px}.vp-pair.wide{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
.vp-trio{display:grid;grid-template-columns:130px minmax(0,1fr) 110px;gap:6px;margin-bottom:6px}.vp-sub{font-size:11px;font-weight:800;color:var(--muted);margin-bottom:4px}
.vp-portf{border-top:1px dashed var(--line);padding-top:8px;margin-top:4px}.vp-num{text-align:right}
@media (max-width:1360px){.vp-wkpis{grid-template-columns:repeat(3,minmax(0,1fr))}.vp-tcs3{grid-template-columns:1fr 1fr}.vp-tcs3>.vp-tcsb:last-child{grid-column:1 / -1}}
@media (max-width:1360px){.vp-pulse{grid-template-columns:repeat(3,minmax(0,1fr))}.vp-twrs{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:1140px){.vp-cols{grid-template-columns:1fr}.vp-kgrid{grid-template-columns:repeat(2,minmax(0,1fr))}.vp-hero-r{align-items:flex-start;width:100%}.vp-tools{justify-content:flex-start}.vp-doors{max-width:none;grid-template-columns:repeat(4,minmax(0,1fr));width:100%}}
@media (max-width:1140px) and (min-width:821px){.vp-cols{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
@media (max-width:820px){
  #view-vpcockpit{padding:10px 10px 30px}
  .vp-hero{padding:20px 18px 18px;border-radius:18px}.vp-doors{grid-template-columns:repeat(2,minmax(0,1fr))}
  .vp-pulse{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.vp-tv{font-size:24px}
  .vp-jump{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.vp-jump button{white-space:nowrap}
  .vp-twrs{grid-template-columns:repeat(2,minmax(0,1fr))}
  .vp-sec{padding:14px 14px 16px;border-radius:16px}
  .vp-row2,.vp-row3,.vp-row12,.vp-drgrid,.vp-cks,.vp-row4,.vp-row5,.vp-tcs3,.vp-ports{grid-template-columns:1fr}.vp-wkpis{grid-template-columns:repeat(2,minmax(0,1fr))}.vp-tcs3>.vp-tcsb:last-child{grid-column:auto}.vp-trio{grid-template-columns:1fr}
  .vp-tbl-wrap{border:0;overflow:visible}
  .vp-tbl thead{display:none}.vp-tbl,.vp-tbl tbody,.vp-tbl tr,.vp-tbl td{display:block;width:100%;box-sizing:border-box}
  .vp-tbl tbody tr{border:1px solid var(--line);border-radius:14px;margin-bottom:10px;padding:8px 4px;background:var(--card)}
  .vp-tbl td{border:0;padding:5px 10px;max-width:none!important;min-width:0!important}
  .vp-tbl td[data-l]::before{content:attr(data-l);display:block;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
  .vp-chtbl td:first-child{box-shadow:none}.vp-chtbl tr{border-left:4px solid var(--sevc,var(--line))!important}
  .vp-mini,.vp-mini-tonight,.vp-mini-week{grid-template-columns:22px minmax(0,1fr) auto}.vp-mini .vp-tw{display:none}
  .vp-cal{grid-template-columns:repeat(7,minmax(38px,1fr));overflow-x:auto}
  .vp-wk{flex-wrap:wrap}
}
.vp-showall{width:100%;justify-content:center;margin-top:10px}
.vp-bar em{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:480px){.vp-pin-ic{display:none}.vp-pin{padding:22px 14px 12px}.vp-pulse{grid-template-columns:1fr 1fr}.vp-twrs{grid-template-columns:1fr}.vp-hchips{gap:6px}.vp-hchip{font-size:12px;padding:6px 11px}}
@media (pointer:coarse){.vp-segtabs button,.vp-pick button{min-height:36px}.vp-btn{min-height:40px}}
@media (prefers-reduced-motion:reduce){.vp-tile,.vp-door,.vp-twr,.vp-dr,.vp-md,.vp-hchip.bad i,.vp-live,.vp-impl i{transition:none!important;animation:none!important}}
@media print{
  header,nav,#viewAsBar,.vp-tools,.vp-doors,.vp-btn,.vp-segtabs,.vp-filt,.vp-link,.vp-go,.vp-jump,#vpDrawer,#vpModal,#vpToast{display:none!important}
  #view-vpcockpit{padding:0}.vp-hero{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-shadow:none}
  .vp-sec,.vp-tile,.vp-pin,.vp-twr{break-inside:avoid;box-shadow:none}.vp-pulse{grid-template-columns:repeat(3,1fr)}.vp-cols{grid-template-columns:1fr}
  .vp-ubody.clamp{-webkit-line-clamp:unset;display:block}
}
`;
    document.head.appendChild(css);
  }
})();
