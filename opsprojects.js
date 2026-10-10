/* opsprojects.js — Operations Projects (#projects · VP Operations ▾ › Operations Projects · 10 Oct 2026, alpha.175)
 *
 * The VP's portfolio of IT Operations projects, in two levels:
 *   portfolio   hero (counts, money on hold, decisions waiting), six KPI tiles, "Needs your attention" (critical bottlenecks,
 *               the VP's decisions, missed milestones), the roadmap (one lane per project: start → target, the baseline it
 *               slipped from, milestones as diamonds, today), one big card per project, recent movement
 *   project     #projects?p=<slug> — hero (people, RAG, progress ring, the four dates, slip), then one long page with a sticky
 *               section bar: Overview (brief, key facts, health radar, decisions, latest status) · Timeline (milestones,
 *               the story so far) · Delivery (workstreams / domains, requirements) · Issues (bottlenecks, gaps, risks) ·
 *               Budget · Governance (decisions, meetings & steerings with their MOMs, action tracker, conditions) ·
 *               Escalation (the matrix as a ladder, Salam | vendor) · Activity (status updates, comments — the VP's badged)
 *   present     ▶ Present: a full-screen deck built live from the same data (portfolio, roadmap, four slides per project,
 *               the decisions requested) — arrows / space / swipe, Esc to leave
 * Data: /api/projects (opsProjects.js). Writes follow the person's rights (project.canEdit, me.canCreate, me.canComment);
 * the VP comments, owners edit. Every time is KSA; light + dark from the tokens; phone, iPad and print; reduced motion
 * respected. Names and roles only — no customer data on this page. */
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
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- time: calendar days from the server ('YYYY-MM-DD', KSA) ---------- */
  const TZ = 'Asia/Riyadh';
  const F_D = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
  const F_DM = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' });
  const F_WD = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const F_MY = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short', year: 'numeric' });
  const F_M = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short' });
  const asDate = k => new Date(k + 'T09:00:00Z');
  const dFull = k => k ? F_D.format(asDate(k)) : '—';
  const dShort = (k, today) => !k ? '—' : (today && k.slice(0, 4) === today.slice(0, 4)) ? F_DM.format(asDate(k)) : F_D.format(asDate(k));
  const dMon = k => k ? F_MY.format(asDate(k)) : '—';
  const dayNum = k => Math.round(Date.parse(k + 'T00:00:00Z') / 864e5);
  const between = (a, b) => dayNum(b) - dayNum(a);
  const todayK = () => (S.d && S.d.today) || new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const rel = n => n == null ? '' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;
  const dur = n => { n = Math.abs(n); if (n < 60) return n + ' d'; const m = Math.round(n / 30.4); return m < 24 ? m + ' months' : (Math.round(n / 36.5) / 10) + ' years'; };
  const ago = v => { if (!v) return ''; try { return window.KT ? window.KT.ago(v) : ''; } catch (e) { return ''; } };
  const money = (n, cur) => n == null ? '—' : `${esc(cur || 'SAR')} ${Math.round(n).toLocaleString('en-US')}`;
  const moneyShort = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : Math.round(n).toLocaleString('en-US');

  /* ---------- vocabulary ---------- */
  const RAG = { green: 'On track', amber: 'At risk', red: 'Off track', grey: 'Not rated' };
  const PST = { planned: 'Planned', active: 'Active', recovery: 'Recovery', on_hold: 'On hold', closing: 'Closing', done: 'Done', cancelled: 'Cancelled' };
  const SEG = { mobile: 'Mobile', fixed: 'Fixed', both: 'Mobile + Fixed' };
  const SEV = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
  const ST = {
    milestone: { planned: 'Planned', on_track: 'On track', at_risk: 'At risk', done: 'Done', missed: 'Missed', cancelled: 'Cancelled' },
    workstream: { not_started: 'Not started', in_progress: 'In progress', at_risk: 'At risk', blocked: 'Blocked', done: 'Done', disputed: 'Disputed' },
    bottleneck: { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', resolved: 'Resolved' },
    gap: { open: 'Open', in_progress: 'In progress', accepted: 'Accepted', resolved: 'Resolved' },
    risk: { open: 'Open', mitigating: 'Mitigating', occurred: 'Occurred', closed: 'Closed' },
    requirement: { committed: 'Committed', conditional: 'Conditional', excluded: 'Excluded', new: 'New scope', open: 'Open', met: 'Met', disputed: 'Disputed' },
    meeting: { planned: 'Planned', held: 'Held', cancelled: 'Cancelled' },
    action: { open: 'Open', in_progress: 'In progress', done: 'Done', dropped: 'Dropped', late: 'Late' },
    decision: { needed: 'Decision needed', taken: 'Decided', deferred: 'Deferred' },
    condition: { proposed: 'Proposed', agreed: 'Agreed', in_place: 'In place', rejected: 'Rejected' },
    budget_line: { planned: 'Planned', committed: 'Committed', invoiced: 'Invoiced', paid: 'Paid', on_hold: 'On hold', disputed: 'To confirm' }
  };
  const TONE = { done: 'good', met: 'good', committed: 'good', paid: 'good', in_place: 'good', agreed: 'good', taken: 'good', held: 'muted', resolved: 'good', accepted: 'muted', closed: 'muted', on_track: 'good',
    at_risk: 'warn', conditional: 'warn', in_progress: 'info', mitigating: 'info', invoiced: 'info', planned: 'muted', proposed: 'muted', not_started: 'muted', open: 'warn', new: 'violet',
    missed: 'bad', blocked: 'bad', disputed: 'bad', excluded: 'muted', on_hold: 'bad', needed: 'violet', occurred: 'bad', rejected: 'muted', cancelled: 'muted', dropped: 'muted', deferred: 'muted', late: 'bad', committed_b: 'info' };
  const MTYPE = { steering: 'Steering', weekly: 'Weekly', workshop: 'Workshop', review: 'Review', escalation: 'Escalation', demo: 'Demo', other: 'Meeting' };
  const GAPT = { capability: 'Capability', scope: 'Scope', process: 'Process', resource: 'Resource', architecture: 'Architecture', performance: 'Performance', outcome: 'Outcome', reporting: 'Reporting', documentation: 'Documentation' };
  const KIND = { milestone: 'milestone', event: 'history entry', workstream: 'workstream', bottleneck: 'bottleneck', gap: 'gap', risk: 'risk', requirement: 'requirement', meeting: 'meeting',
    action: 'action', decision: 'decision', condition: 'condition', escalation: 'escalation contact', budget_line: 'budget line', update: 'status update', comment: 'comment' };
  const SECS = [['overview', 'Overview'], ['timeline', 'Timeline'], ['delivery', 'Delivery'], ['issues', 'Issues'], ['budget', 'Budget'], ['governance', 'Governance'], ['escalation', 'Escalation'], ['activity', 'Activity']];

  const svg = (d, s) => `<svg viewBox="0 0 24 24" width="${s || 16}" height="${s || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    play: '<path d="M7 4v16l13-8z"/>', plus: '<path d="M12 5v14M5 12h14"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>', print: '<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>', back: '<path d="M15 18l-6-6 6-6"/>', go: '<path d="M9 18l6-6-6-6"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>', alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    gavel: '<path d="M14 13l-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>', stack: '<path d="M12 2 2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', check: '<path d="M20 6 9 17l-5-5"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>', ladder: '<path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10"/>', layers: '<path d="M12 2 2 7l10 5 10-5z"/><path d="M2 12l10 5 10-5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>', expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>', link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'
  };

  /* ---------- state ---------- */
  const S = { d: null, p: null, slug: null, open: false, built: false, loading: false, sec: null, timer: null, filt: { sev: 'all', openOnly: true }, story: 'all', showDone: false };
  const me = () => (S.p && S.p.me) || (S.d && S.d.me) || {};
  const proj = () => S.p && S.p.project;
  const items = k => (S.p && S.p.items && S.p.items[k]) || [];
  const canEdit = () => !!(proj() && proj().canEdit);

  /* ---------- small components ---------- */
  const pill = (txt, tone, extra) => `<span class="pj-pill pj-t-${tone || 'muted'}${extra ? ' ' + extra : ''}">${esc(txt)}</span>`;
  const stPill = (kind, st) => st ? pill((ST[kind] || {})[st] || st, TONE[st] || 'muted') : '';
  const ragPill = (r, big) => `<span class="pj-rag pj-rag-${esc(r || 'grey')}${big ? ' big' : ''}"><i></i>${esc(RAG[r] || RAG.grey)}</span>`;
  const sevPill = s => s ? `<span class="pj-sev pj-sev-${esc(s)}">${esc(SEV[s] || s)}</span>` : '';
  const dot = r => `<i class="pj-dot pj-d-${esc(r || 'grey')}"></i>`;
  const empty = (txt, act) => `<div class="pj-empty">${esc(txt)}${act || ''}</div>`;
  const addBtn = (kind, label) => canEdit() ? `<button class="pj-add" type="button" data-act="add" data-kind="${kind}">${svg(IC.plus, 14)}<span>${esc(label || 'Add')}</span></button>` : '';
  const editBtn = it => canEdit() ? `<button class="pj-ied" type="button" data-act="edit-item" data-id="${it.id}" title="Edit" aria-label="Edit">${svg(IC.edit, 13)}</button>` : '';
  const mono = p => { const src = (p.code || p.vendor || p.name || '?').replace(/[^A-Za-z0-9/ ]/g, ' ').trim(); const w = src.split(/[\s/]+/).filter(Boolean); return esc((w.length > 1 ? w[0][0] + w[1][0] : src.slice(0, 3)).toUpperCase()); };
  const para = t => String(t || '').split(/\n{2,}/).map(x => x.trim()).filter(Boolean).map(x => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  const lines = t => String(t || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  /* progress ring: verified = solid, vendor-reported = dashed and labelled */
  function ring(pct, opts) {
    const o = opts || {}, size = o.size || 92, sw = o.stroke || 9, r = (size - sw) / 2, c = 2 * Math.PI * r;
    const v = pct == null ? null : Math.max(0, Math.min(100, pct));
    const off = v == null ? c : c * (1 - v / 100);
    return `<div class="pj-ring${o.unverified ? ' unv' : ''}${v == null ? ' none' : ''}" style="--sz:${size}px">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle class="bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${sw}"/>
      <circle class="fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${sw}" stroke-dasharray="${c.toFixed(1)}" style="--c:${c.toFixed(1)};--off:${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>
      <div class="pj-ring-v">${v == null ? '<b>—</b>' : `<b data-count="${v}">${v}</b><small>%</small>`}${o.label ? `<em>${esc(o.label)}</em>` : ''}</div></div>`;
  }
  const bar = (pct, tone, unv) => `<span class="pj-bar${unv ? ' unv' : ''}"><i class="pj-t-${tone || 'info'}" style="--w:${Math.max(0, Math.min(100, pct || 0))}%"></i></span>`;

  /* ---------- load ---------- */
  async function loadPortfolio() {
    const d = await api('/api/projects');
    S.d = d; return d;
  }
  async function loadProject(slug) {
    const d = await api('/api/projects/' + encodeURIComponent(slug));
    S.p = d; return d;
  }
  function parseQs(qs) { const o = {}; String(qs || '').split('&').forEach(kv => { const [k, v] = kv.split('='); if (k) o[k] = decodeURIComponent(v || ''); }); return o; }
  function setUrl(q) { const h = '#projects' + (q ? '?' + q : ''); try { history.replaceState(null, '', h); } catch (e) { /* old browsers */ } }
  const go = q => { location.hash = '#projects' + (q ? '?' + q : ''); };

  /* ================================================================== PORTFOLIO */
  function renderPortfolio() {
    const host = $('#view-opsprojects'), d = S.d; if (!host || !d) return;
    const t = d.today;
    host.innerHTML = `<div class="pj-wrap">${pHero(d)}${pKpis(d)}
      <div class="pj-cols2">${pAttention(d)}${pFeed(d)}</div>
      ${pRoadmap(d.projects, t)}
      <section class="pj-sec" id="pjCards"><div class="pj-sh"><h2>${svg(IC.layers, 18)}Projects</h2><span class="pj-shs">${d.projects.length} in the portfolio · sorted as the VP reviews them</span>${d.me.canCreate ? `<button class="pj-add" type="button" data-act="new-project">${svg(IC.plus, 14)}<span>New project</span></button>` : ''}</div>
        <div class="pj-cards">${d.projects.map((p, i) => pCard(p, t, i)).join('') || empty('No project yet.')}</div></section>
      <div class="pj-foot">Figures as the projects record them — vendor-reported progress is marked as such. Source of each project: its documents and MOMs, kept current by its owners. Updated ${esc(ago(d.generatedAt))}.</div>
    </div>`;
    afterRender(host);
  }
  function pHero(d) {
    const k = d.kpis, live = k.active || 0, onHold = Object.entries(k.onHold || {}).filter(([, v]) => v > 0);
    const seg = ['red', 'amber', 'green', 'grey'].map(r => (k.rag[r] ? `<i class="pj-d-${r}" style="flex:${k.rag[r]}" title="${esc(RAG[r])}: ${k.rag[r]}"></i>` : '')).join('');
    return `<section class="pj-hero"><div class="pj-aur"></div><div class="pj-hero-l">
        <div class="pj-kick">VP Operations · Project portfolio</div>
        <h1 class="pj-h1">Operations Projects</h1>
        <div class="pj-hsub">Every IT Operations project in one place — status, milestones, money, decisions and escalations.</div>
        <div class="pj-hdate">${esc(F_WD.format(asDate(d.today)))}</div>
        <div class="pj-hchips">
          <button class="pj-hchip" type="button" data-act="scroll" data-to="pjCards"><b data-count="${live}">${live}</b> active project${live === 1 ? '' : 's'}<span class="pj-ragbar">${seg}</span></button>
          ${k.decisions.vp ? `<button class="pj-hchip vio" type="button" data-act="scroll" data-to="pjAttn">${svg(IC.gavel, 14)}<b data-count="${k.decisions.vp}">${k.decisions.vp}</b> decision${k.decisions.vp === 1 ? '' : 's'} waiting for you</button>` : ''}
          ${k.bottlenecks.critical ? `<button class="pj-hchip bad" type="button" data-act="scroll" data-to="pjAttn">${svg(IC.alert, 14)}<b>${k.bottlenecks.critical}</b> critical bottleneck${k.bottlenecks.critical === 1 ? '' : 's'}</button>` : ''}
          ${onHold.map(([c, v]) => `<span class="pj-hchip warn">${svg(IC.money, 14)}<b>${esc(c)} ${Math.round(v).toLocaleString('en-US')}</b> on hold</span>`).join('')}
        </div></div>
      <div class="pj-hero-r">
        <div class="pj-tools">
          <button class="pj-tool pri" type="button" data-act="present">${svg(IC.play, 14)}<span>Present</span></button>
          ${d.me.canCreate ? `<button class="pj-tool" type="button" data-act="new-project">${svg(IC.plus, 14)}<span>New project</span></button>` : ''}
          ${d.me.canSettings ? `<button class="pj-tool ic" type="button" data-act="settings" title="Who can see and edit" aria-label="Settings">${svg(IC.gear, 15)}</button>` : ''}
          <button class="pj-tool ic" type="button" data-act="refresh" title="Refresh" aria-label="Refresh">${svg(IC.refresh, 15)}</button>
          <button class="pj-tool ic" type="button" data-act="print" title="Print" aria-label="Print">${svg(IC.print, 15)}</button>
        </div>
        ${k.next ? `<button class="pj-next" type="button" data-act="open" data-slug="${esc(k.next.project)}" data-i="${k.next.id}"><span>Next milestone · ${esc(rel(k.next.daysTo))}</span><b>${esc(k.next.title)}</b><em>${esc(k.next.projectCode || k.next.projectName)} · ${esc(dFull(k.next.date))}</em></button>` : ''}
      </div></section>`;
  }
  function pKpis(d) {
    const k = d.kpis, oh = Object.entries(k.onHold || {}).filter(([, v]) => v > 0)[0];
    const tile = (cls, ic, label, val, sub, act) => `<button class="pj-kpi ${cls}" type="button" ${act}><span class="pj-kl">${svg(ic, 15)}${esc(label)}</span><span class="pj-kv">${val}</span><span class="pj-ks">${sub}</span></button>`;
    return `<section class="pj-kpis" data-rv>
      ${tile('t-info', IC.layers, 'Projects', `<b data-count="${k.active}">${k.active}</b>`, `${k.rag.red ? `<em class="bad">${k.rag.red} off track</em> · ` : ''}${k.rag.amber ? `<em class="warn">${k.rag.amber} at risk</em> · ` : ''}${k.rag.green || 0} on track`, 'data-act="scroll" data-to="pjCards"')}
      ${tile('t-violet', IC.gavel, 'Decisions for the VP', `<b data-count="${k.decisions.vp}">${k.decisions.vp}</b>`, `${k.decisions.needed} decision${k.decisions.needed === 1 ? '' : 's'} open in all`, 'data-act="scroll" data-to="pjAttn"')}
      ${tile(k.bottlenecks.critical ? 't-bad' : 't-warn', IC.alert, 'Bottlenecks', `<b data-count="${k.bottlenecks.open}">${k.bottlenecks.open}</b>`, `<em class="bad">${k.bottlenecks.critical} critical</em> · ${k.bottlenecks.high} high`, 'data-act="scroll" data-to="pjAttn"')}
      ${tile(k.lateMilestones ? 't-bad' : 't-good', IC.flag, 'Milestones missed', `<b data-count="${k.lateMilestones}">${k.lateMilestones}</b>`, k.next ? `next: ${esc(dShort(k.next.date, d.today))} · ${esc(rel(k.next.daysTo))}` : 'nothing scheduled', 'data-act="scroll" data-to="pjRoad"')}
      ${tile(oh ? 't-warn' : 't-good', IC.money, 'Money on hold', oh ? `<b class="pj-kmoney">${esc(oh[0])} ${moneyShort(oh[1])}</b>` : '<b>0</b>', oh ? `${esc(oh[0])} ${Math.round(oh[1]).toLocaleString('en-US')} · invoices held` : 'nothing held', 'data-act="scroll" data-to="pjCards"')}
      ${tile(k.actions.overdue ? 't-warn' : 't-good', IC.clock, 'Actions overdue', `<b data-count="${k.actions.overdue}">${k.actions.overdue}</b>`, `of ${k.actions.open} open action${k.actions.open === 1 ? '' : 's'}`, 'data-act="scroll" data-to="pjCards"')}
    </section>`;
  }
  function pAttention(d) {
    const a = d.attention || [];
    const ico = { bottleneck: IC.alert, decision: IC.gavel, milestone: IC.flag };
    const lab = { bottleneck: 'Critical bottleneck', decision: 'Your decision', milestone: 'Milestone late' };
    const row = (x, i) => `<button class="pj-at pj-at-${x.type}" type="button" data-act="open" data-slug="${esc(x.project)}" data-i="${x.id}" data-rv style="--d:${i * 45}ms;--acc:${esc(x.accent || '#64748b')}">
        <span class="pj-at-ic">${svg(ico[x.type], 15)}</span>
        <span class="pj-at-b"><span class="pj-at-k">${esc(lab[x.type])}<i class="pj-chip-p" title="${esc(x.projectName)}">${esc(x.projectCode || x.projectName)}</i></span><b>${esc(x.title)}</b>
        <em>${x.owner ? 'Owner: ' + esc(x.owner) : ''}${x.type === 'bottleneck' && x.ageDays != null ? ` · open ${esc(dur(x.ageDays))}` : ''}${x.type === 'milestone' ? ` · was due ${esc(dFull(x.date))}` : ''}${x.due ? ` · needed by ${esc(dFull(x.due))}` : ''}</em></span>
        <span class="pj-go">${svg(IC.go, 15)}</span></button>`;
    const N = 6, more = a.length - N;
    return `<section class="pj-sec pj-attn" id="pjAttn"><div class="pj-sh"><h2>${svg(IC.target, 18)}Needs your attention</h2><span class="pj-shs">critical bottlenecks · your decisions · late milestones</span></div>
      <div class="pj-atl${S.attnAll ? ' all' : ''}">${a.map(row).join('') || empty('Nothing needs you right now.')}</div>
      ${more > 0 ? `<button class="pj-more" type="button" data-act="attn-all">${S.attnAll ? 'Show fewer' : `Show ${more} more`}</button>` : ''}</section>`;
  }
  function pFeed(d) {
    const a = d.activity || [];
    const ic = { update: IC.chat, meeting: IC.users, decision: IC.gavel, comment: IC.chat, milestone: IC.flag, bottleneck: IC.alert, gap: IC.target, action: IC.check, workstream: IC.stack };
    const lab = { update: 'Status update', meeting: 'Meeting', decision: 'Decision', comment: 'Comment', milestone: 'Milestone', bottleneck: 'Bottleneck', gap: 'Gap', action: 'Action', workstream: 'Workstream' };
    return `<section class="pj-sec pj-feed"><div class="pj-sh"><h2>${svg(IC.clock, 18)}Recent movement</h2><span class="pj-shs">status updates, meetings and edits</span></div>
      <ol class="pj-fl">${a.slice(0, 9).map((x, i) => `<li data-rv style="--d:${i * 40}ms"><button type="button" data-act="open" data-slug="${esc(x.project)}" data-i="${x.id}" style="--acc:${esc(x.accent || '#64748b')}">
        <span class="pj-fi">${svg(ic[x.kind] || IC.chat, 13)}</span><span class="pj-fb"><span class="pj-fk">${esc(lab[x.kind] || x.kind)}${x.rag ? dot(x.rag) : ''}${x.vp ? '<i class="pj-vpb">VP</i>' : ''} · ${esc(x.projectCode || x.projectName)}</span><b>${esc(x.title)}</b>
        <em>${esc(dShort(x.at.slice(0, 10), d.today))}${x.byName || x.by ? ' · ' + esc(x.byName || x.by) : ''}</em></span></button></li>`).join('') || '<li class="pj-empty">Nothing yet.</li>'}</ol></section>`;
  }
  function pCard(p, t, i) {
    const st = p.stats, ms = st.milestones, bn = st.bottlenecks;
    const ringLbl = p.progress != null ? (p.progressVerified ? 'complete' : 'vendor-reported') : (p.elapsedPct != null ? 'time used' : 'not reported');
    const ringVal = p.progress != null ? p.progress : p.elapsedPct;
    const end = p.endDate ? `<b>${esc(dFull(p.endDate))}</b>${p.daysLeft != null ? `<em>${p.daysLeft >= 0 ? esc(dur(p.daysLeft)) + ' left' : esc(dur(-p.daysLeft)) + ' over'}</em>` : ''}` : '<b>TBC</b><em>not confirmed</em>';
    const health = p.health.map(h => `<span class="pj-hd" title="${esc(h.label)}: ${esc(RAG[h.rag])}${h.note ? ' — ' + esc(h.note) : ''}">${dot(h.rag)}${esc(h.label)}</span>`).join('');
    return `<article class="pj-card" data-rv style="--d:${i * 70}ms;--acc:${esc(p.accent || '#0e9f5a')}" data-act="open" data-slug="${esc(p.slug)}" tabindex="0" role="link" aria-label="Open ${esc(p.name)}">
      <div class="pj-cglow"></div>
      <div class="pj-ctop"><span class="pj-mono">${mono(p)}</span><div class="pj-cid"><h3>${esc(p.name)}</h3><span>${esc(p.vendor || '')}${p.category ? ' · ' + esc(p.category) : ''}${p.segment ? ' · ' + esc(SEG[p.segment] || p.segment) : ''}</span></div>${ragPill(p.rag)}</div>
      <div class="pj-cmid">${ring(ringVal, { size: 96, label: ringLbl, unverified: p.progress != null && !p.progressVerified })}
        <div class="pj-cdates">
          <div><span>Start</span><b>${esc(dFull(p.startDate))}</b>${p.ageDays != null ? `<em>${esc(dur(p.ageDays))} ago</em>` : ''}</div>
          <div><span>Target end</span>${end}</div>
          <div><span>${p.baselineNo ? 'Baseline ' + (p.baselineNo > 1 ? p.baselineNo - 1 : 1) : 'Baseline'}</span><b>${esc(dFull(p.baselineEnd))}</b>${p.slipDays ? `<em class="${p.slipDays > 0 ? 'bad' : 'good'}">${p.slipDays > 0 ? '+' : ''}${esc(dur(p.slipDays))} slip</em>` : (p.baselineEnd && !p.endDate ? '<em class="bad">passed</em>' : '')}</div>
        </div></div>
      <div class="pj-cphase">${pill(PST[p.status] || p.status, p.status === 'recovery' ? 'bad' : p.status === 'on_hold' ? 'warn' : 'info')}<span>${esc(p.phase || '')}</span></div>
      <div class="pj-chealth">${health}</div>
      <div class="pj-cissues">${bn.top.length ? bn.top.slice(0, 2).map(b => `<div>${sevPill(b.severity)}<span>${esc(b.title)}</span></div>`).join('') : '<div class="pj-muted">No open bottleneck.</div>'}</div>
      <div class="pj-cfoot">
        <span title="Next milestone">${svg(IC.flag, 13)}${ms.next ? `${esc(ms.next.title)} · <b>${esc(rel(ms.next.daysTo))}</b>` : ms.undated ? `${ms.undated} milestone${ms.undated === 1 ? '' : 's'} to schedule` : 'No milestone ahead'}</span>
        <span>${svg(IC.gavel, 13)}<b>${st.decisions.vp}</b> for the VP</span>
        ${st.budget.onHold ? `<span class="bad">${svg(IC.money, 13)}<b>${esc(p.budget.currency || 'SAR')} ${moneyShort(st.budget.onHold)}</b> on hold</span>` : ''}
        <span class="pj-copen">Open ${svg(IC.go, 14)}</span></div>
    </article>`;
  }

  /* ---------- the roadmap (portfolio lanes, or one project's milestones) ---------- */
  function domainOf(list, t) {
    let a = null, b = null;
    const take = k => { if (!k) return; if (!a || k < a) a = k; if (!b || k > b) b = k; };
    list.forEach(p => { take(p.startDate); take(p.endDate); take(p.baselineEnd); (p.milestones || []).forEach(m => take(m.date)); });
    take(t);
    if (!a) return null;
    const pad = Math.max(20, Math.round(between(a, b) * 0.03));
    const from = new Date(Date.parse(a + 'T00:00:00Z') - pad * 864e5), to = new Date(Date.parse(b + 'T00:00:00Z') + (pad + 40) * 864e5);
    from.setUTCDate(1); to.setUTCDate(1); to.setUTCMonth(to.getUTCMonth() + 1);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  function pRoadmap(list, t) {
    const dom = domainOf(list, t); if (!dom) return '';
    const span = between(dom.from, dom.to), x = k => (between(dom.from, k) / span * 100).toFixed(3) + '%';
    const months = []; for (let d = new Date(dom.from + 'T00:00:00Z'); d.toISOString().slice(0, 10) < dom.to; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 10));
    const nM = months.length, every = nM > 30 ? 3 : nM > 16 ? 2 : 1;
    const head = months.map((m, i) => `<span class="pj-gm${m.slice(5, 7) === '01' ? ' yr' : ''}" style="left:${x(m)}">${i % every === 0 || m.slice(5, 7) === '01' ? `${esc(F_M.format(asDate(m)))}${m.slice(5, 7) === '01' || i === 0 ? `<b>${m.slice(0, 4)}</b>` : ''}` : ''}</span>`).join('');
    const grid = months.map(m => `<i class="pj-gl${m.slice(5, 7) === '01' ? ' yr' : ''}" style="left:${x(m)}"></i>`).join('');
    const lane = (p, i) => {
      const s = p.startDate || (p.milestones || []).map(m => m.date).filter(Boolean).sort()[0] || t;
      const lastMs = (p.milestones || []).map(m => m.date).filter(Boolean).sort().pop();
      const e = p.endDate || [lastMs, t].filter(Boolean).sort().pop();
      const tbc = !p.endDate;
      const prog = p.progress != null ? p.progress : null;
      const ms = (p.milestones || []).filter(m => m.date).map(m => {
        const cls = m.status === 'done' ? 'done' : m.status === 'missed' || m.late ? 'bad' : m.status === 'at_risk' ? 'warn' : 'plan';
        return `<button class="pj-gd ${cls}${m.gate ? ' gate' : ''}" type="button" style="left:${x(m.date)}" data-act="open" data-slug="${esc(p.slug)}" data-i="${m.id}" aria-label="${esc(m.title)}"><span class="pj-tip"><b>${esc(m.title)}</b>${esc(dFull(m.date))} · ${esc((ST.milestone[m.status] || m.status) + (m.late ? ' — late' : ''))}</span></button>`;
      }).join('');
      const slip = p.baselineEnd && p.endDate && p.endDate > p.baselineEnd ? `<i class="pj-gslip" style="left:${x(p.baselineEnd)};width:calc(${x(p.endDate)} - ${x(p.baselineEnd)})"></i>` : '';
      const base = p.baselineEnd ? `<i class="pj-gbase" style="left:${x(p.baselineEnd)}"><span>${p.endDate ? 'baseline' : 'planned go-live'}</span></i>` : '';
      return `<div class="pj-gr" data-rv style="--d:${i * 90}ms;--acc:${esc(p.accent || '#0e9f5a')}">
        <button class="pj-gn" type="button" data-act="open" data-slug="${esc(p.slug)}">${dot(p.rag)}<span><b>${esc(p.code || p.name)}</b><em>${esc(p.vendor || '')}</em></span></button>
        <div class="pj-gt">${slip}<div class="pj-gb pj-gb-${esc(p.rag)}${tbc ? ' tbc' : ''}" style="left:${x(s)};width:calc(${x(e)} - ${x(s)})" title="${esc(p.name)} · ${esc(dFull(s))} → ${tbc ? 'TBC' : esc(dFull(e))}${prog != null ? ` · ${prog} % ${p.progressVerified ? 'complete' : 'vendor-reported'}` : ''}">${prog != null ? `<i class="pj-gp${p.progressVerified ? '' : ' unv'}" style="--w:${prog}%"></i>` : ''}</div>
          ${tbc ? `<div class="pj-gtbc" style="left:${x(e)}"><span>go-live TBC</span></div>` : `<span class="pj-gend" style="left:${x(e)}">${esc(dShort(e, t))}</span>`}${base}${ms}</div></div>`;
    };
    const tx = x(t);
    return `<section class="pj-sec" id="pjRoad"><div class="pj-sh"><h2>${svg(IC.stack, 18)}Roadmap</h2><span class="pj-shs">start → target · ◆ milestones (filled = done, red = missed / late) · dashed = the baseline it slipped from</span></div>
      <div class="pj-gantt" data-rv><div class="pj-gin" style="min-width:${Math.max(720, nM * 26 + 190)}px">
        <div class="pj-gh"><span class="pj-gn0"></span><div class="pj-gt">${head}</div></div>
        <div class="pj-gbody"><div class="pj-ggrid"><span class="pj-gn0"></span><div class="pj-gt">${grid}<i class="pj-gtoday" style="left:${tx}"><span>Today</span></i></div></div>${list.map(lane).join('')}</div>
      </div></div></section>`;
  }

  /* ================================================================== PROJECT */
  function renderProject() {
    const host = $('#view-opsprojects'), d = S.p; if (!host || !d) return;
    const p = d.project, t = d.today;
    host.innerHTML = `<div class="pj-wrap pj-proj" style="--acc:${esc(p.accent || '#0e9f5a')}">
      ${crumbs(d)}${projHero(p, t)}${secNav(p)}
      <div class="pj-secs">${secOverview(p, t)}${secTimeline(p, t)}${secDelivery(p, t)}${secIssues(p, t)}${secBudget(p, t)}${secGovernance(p, t)}${secEscalation(p, t)}${secActivity(p, t)}</div>
      <div class="pj-foot">${p.updatedAt ? `Last change ${esc(ago(p.updatedAt))}${p.updatedByName || p.updatedBy ? ' by ' + esc(p.updatedByName || p.updatedBy) : ''}. ` : ''}The first content was written from the project's documents and MOMs on 10 Oct 2026; its owners keep it current.</div>
    </div>`;
    afterRender(host); spy();
  }
  function crumbs(d) {
    return `<div class="pj-crumbs"><button class="pj-back" type="button" data-act="home">${svg(IC.back, 15)}<span>All projects</span></button>
      <div class="pj-switch">${(d.others || []).map(o => `<button type="button" class="${o.slug === d.project.slug ? 'on' : ''}" data-act="open" data-slug="${esc(o.slug)}" style="--acc:${esc(o.accent || '#0e9f5a')}" title="${esc(o.name)}">${dot(o.rag)}<span>${esc(o.name)}</span></button>`).join('')}</div></div>`;
  }
  function projHero(p, t) {
    const ringLbl = p.progress != null ? (p.progressVerified ? 'complete' : 'vendor-reported') : (p.elapsedPct != null ? 'of the time used' : 'not reported');
    const ringVal = p.progress != null ? p.progress : p.elapsedPct;
    const date = (lbl, k, sub, cls) => `<div class="pj-hd2${cls ? ' ' + cls : ''}"><span>${esc(lbl)}</span><b>${k ? esc(dFull(k)) : 'TBC'}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const slip = p.slipDays ? `<em class="${p.slipDays > 0 ? 'bad' : 'good'}">${p.slipDays > 0 ? '+' : ''}${esc(dur(p.slipDays))} vs baseline</em>` : '';
    const left = p.endDate && p.daysLeft != null ? (p.daysLeft >= 0 ? esc(dur(p.daysLeft)) + ' left' : esc(dur(-p.daysLeft)) + ' over') : '';
    const person = (lbl, v, ic) => v ? `<div class="pj-person">${svg(ic, 15)}<span>${esc(lbl)}</span><b>${esc(v)}</b></div>` : '';
    return `<section class="pj-phero"><div class="pj-aur"></div>
      <div class="pj-ph-l">
        <div class="pj-ph-chips">${p.code ? `<span class="pj-code">${esc(p.code)}</span>` : ''}${pill(PST[p.status] || p.status, p.status === 'recovery' ? 'bad' : p.status === 'on_hold' ? 'warn' : 'info', 'inv')}${p.segment ? pill(SEG[p.segment] || p.segment, 'muted', 'inv') : ''}${p.program ? pill(p.program, 'muted', 'inv') : ''}</div>
        <h1 class="pj-h1">${esc(p.name)}</h1>
        <div class="pj-hsub">${esc(p.vendorDetail || p.vendor || '')}</div>
        ${p.phase ? `<div class="pj-phase2">${svg(IC.target, 14)}<span>${esc(p.phase)}</span></div>` : ''}
        <div class="pj-people">${person('Sponsor', p.sponsor, IC.shield)}${person('Salam lead', p.owner, IC.users)}${person('Vendor PM', p.vendorPm, IC.users)}</div>
      </div>
      <div class="pj-ph-r">
        <div class="pj-ph-top">${ring(ringVal, { size: 128, stroke: 11, label: ringLbl, unverified: p.progress != null && !p.progressVerified })}
          <div class="pj-ph-rag">${ragPill(p.rag, true)}<div class="pj-tools">
            <button class="pj-tool pri" type="button" data-act="present-one">${svg(IC.play, 14)}<span>Present</span></button>
            ${p.canEdit ? `<button class="pj-tool" type="button" data-act="edit-project">${svg(IC.edit, 14)}<span>Edit</span></button>` : ''}
            <button class="pj-tool ic" type="button" data-act="refresh" title="Refresh" aria-label="Refresh">${svg(IC.refresh, 15)}</button>
            <button class="pj-tool ic" type="button" data-act="print" title="Print" aria-label="Print">${svg(IC.print, 15)}</button></div></div></div>
        <div class="pj-hdates">${date('Start', p.startDate, p.ageDays != null ? esc(dur(p.ageDays)) + ' ago' : '')}${date(p.endDate ? 'Baseline end' : 'Planned go-live', p.baselineEnd, p.baselineEnd && p.baselineEnd < t && !p.endDate ? '<em class="bad">passed</em>' : '', '')}${date('Target end', p.endDate, [left, slip].filter(Boolean).join(' '), p.endDate ? '' : 'tbc')}${date('Go-live', p.goLive, '', p.goLive ? '' : 'tbc')}</div>
        ${p.progressBasis ? `<div class="pj-basis">${svg(IC.alert, 13)}<span>${esc(p.progressBasis)}</span></div>` : ''}
      </div></section>`;
  }
  function secNav(p) {
    const st = p.stats, n = { overview: '', timeline: st.milestones.total, delivery: st.workstreams.n, issues: st.bottlenecks.open + st.gaps.open + st.risks.open,
      budget: st.budget.lines, governance: st.decisions.needed, escalation: st.escalation.n, activity: st.comments };
    return `<nav class="pj-secnav" aria-label="Sections"><div class="pj-snin">${SECS.map(([k, l]) => `<button type="button" data-act="sec" data-sec="${k}" class="${k === 'overview' ? 'on' : ''}">${esc(l)}${n[k] ? `<i>${n[k]}</i>` : ''}</button>`).join('')}<span class="pj-snbar"></span></div></nav>`;
  }
  const secHead = (k, title, sub, act) => `<div class="pj-sh"><h2>${esc(title)}</h2>${sub ? `<span class="pj-shs">${sub}</span>` : ''}${act || ''}</div>`;

  /* ---------- Overview ---------- */
  function radar(health) {
    const R = 84, cx = 160, cy = 112, n = health.length, val = { green: 1, amber: 0.66, red: 0.33, grey: 0.12 };
    const pt = (i, f) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f]; };
    const rings = [0.33, 0.66, 1].map(f => `<polygon class="rg" points="${health.map((_, i) => pt(i, f).join(',')).join(' ')}"/>`).join('');
    const axes = health.map((_, i) => `<line class="ax" x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}"/>`).join('');
    const poly = health.map((h, i) => pt(i, val[h.rag] || 0.12).join(',')).join(' ');
    const dots = health.map((h, i) => { const [x, y] = pt(i, val[h.rag] || 0.12); return `<circle class="pj-rd-${esc(h.rag)}" cx="${x}" cy="${y}" r="4.5"/>`; }).join('');
    const labels = health.map((h, i) => { const [x, y] = pt(i, 1.24); return `<text x="${x}" y="${y + 4}" text-anchor="${x < cx - 10 ? 'end' : x > cx + 10 ? 'start' : 'middle'}">${esc(h.label)}</text>`; }).join('');
    return `<svg class="pj-radar" viewBox="0 0 320 226" role="img" aria-label="Health by dimension">${rings}${axes}<polygon class="ar" points="${poly}"/>${dots}${labels}</svg>`;
  }
  function secOverview(p, t) {
    const facts = (p.facts || []).map((f, i) => `<div class="pj-fact pj-t-${esc(f.tone || 'none')}" data-rv style="--d:${i * 50}ms"><span>${esc(f.label)}</span><b>${esc(f.value)}</b>${f.note ? `<em>${esc(f.note)}</em>` : ''}</div>`).join('');
    const decs = items('decision').filter(x => x.status === 'needed').sort((a, b) => (b.data.vp ? 1 : 0) - (a.data.vp ? 1 : 0));
    const lu = items('update')[0];
    const scope = lines(p.scope);
    return `<section class="pj-sec" id="pj-s-overview" data-sec="overview">
      ${facts ? `<div class="pj-facts" style="--fcols:${(p.facts || []).length <= 6 ? Math.max(1, (p.facts || []).length) : (p.facts || []).length <= 8 ? 4 : 5}">${facts}</div>` : ''}
      <div class="pj-ovg">
        <div class="pj-box pj-brief" data-rv><div class="pj-bh"><h3>${svg(IC.list, 16)}The brief</h3>${canEdit() ? `<button class="pj-ied show" type="button" data-act="edit-project" title="Edit">${svg(IC.edit, 13)}</button>` : ''}</div>
          <div class="pj-prose">${para(p.brief) || '<p class="pj-muted">No brief yet.</p>'}</div>
          ${p.objective ? `<h4>Objective</h4><p class="pj-obj">${esc(p.objective)}</p>` : ''}
          ${scope.length ? `<h4>Scope</h4><ul class="pj-scope">${scope.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</div>
        <div class="pj-box pj-health" data-rv style="--d:80ms"><div class="pj-bh"><h3>${svg(IC.target, 16)}Health</h3>${ragPill(p.rag)}</div>
          ${radar(p.health)}
          <ul class="pj-hl">${p.health.map(h => `<li class="pj-hl-${esc(h.rag)}"><div>${dot(h.rag)}<b>${esc(h.label)}</b><span>${esc(RAG[h.rag])}</span></div>${h.note ? `<p>${esc(h.note)}</p>` : ''}</li>`).join('')}</ul></div>
        <div class="pj-ovside">
          <div class="pj-box pj-decs" data-rv style="--d:140ms"><div class="pj-bh"><h3>${svg(IC.gavel, 16)}Decisions needed</h3><button class="pj-lnk" type="button" data-act="sec" data-sec="governance">All</button></div>
            ${decs.length ? `<ol class="pj-dl">${decs.slice(0, 5).map(x => `<li data-item="${x.id}"><b>${esc(x.title)}</b><em>${x.data.vp ? '<i class="pj-vpb">VP</i>' : ''}${esc(x.owner || '')}${x.due ? ' · by ' + esc(dFull(x.due)) : ''}</em></li>`).join('')}</ol>` : '<p class="pj-muted">No decision open.</p>'}</div>
          <div class="pj-box pj-lu" data-rv style="--d:200ms"><div class="pj-bh"><h3>${svg(IC.chat, 16)}Latest status</h3>${canEdit() ? `<button class="pj-lnk" type="button" data-act="add" data-kind="update">+ Update</button>` : ''}</div>
            ${lu ? `<div class="pj-lu-h">${dot(lu.data.rag)}<b>${esc(lu.title)}</b></div><div class="pj-lu-d">${esc(dFull(lu.date))}${lu.updatedByName || lu.createdByName ? ' · ' + esc(lu.updatedByName || lu.createdByName) : ''}</div><div class="pj-prose sm">${para(lu.body)}</div>` : '<p class="pj-muted">No status update yet.</p>'}</div>
        </div>
      </div></section>`;
  }

  /* ---------- Timeline ---------- */
  /* the milestone strip: chronological and evenly spaced (dates written on each), so close milestones never collide;
   * "today" sits between its two neighbours, in proportion to the dates */
  function msRoad(ms, p, t) {
    const dated = ms.filter(m => m.date).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.sort - b.sort), und = ms.filter(m => !m.date);
    if (!dated.length && !und.length) return '';
    let road = '';
    if (dated.length) {
      const n = dated.length, pos = i => (i + 0.5) / n * 100;
      const k = dated.findIndex(m => m.date > t);
      let tp;
      if (k === 0) tp = Math.max(0.5, pos(0) - 50 / n);
      else if (k === -1) tp = Math.min(99.5, pos(n - 1) + 50 / n);
      else { const a = dated[k - 1].date, b = dated[k].date; tp = pos(k - 1) + (pos(k) - pos(k - 1)) * Math.min(1, Math.max(0, between(a, t) / Math.max(1, between(a, b)))); }
      const years = []; for (let i = 1; i < n; i++) if (dated[i].date.slice(0, 4) !== dated[i - 1].date.slice(0, 4)) years.push(`<i class="pj-road-yr" style="left:${((pos(i - 1) + pos(i)) / 2).toFixed(2)}%"><span>${esc(dated[i].date.slice(0, 4))}</span></i>`);
      road = `<div class="pj-road" data-rv><div class="pj-road-in" style="min-width:${Math.max(640, n * 88)}px" data-tp="${tp.toFixed(2)}"><i class="pj-road-line"></i>
        <i class="pj-road-done" style="width:${tp.toFixed(2)}%"></i>${years.join('')}<i class="pj-road-today" style="left:${tp.toFixed(2)}%"><span>Today</span></i>
        ${dated.map((m, i) => { const cls = m.status === 'done' ? 'done' : (m.status === 'missed' || m.late) ? 'bad' : m.status === 'at_risk' ? 'warn' : 'plan';
          return `<button class="pj-rm ${cls}${m.data.gate ? ' gate' : ''} ${i % 2 ? 'dn' : 'up'}" type="button" style="left:${pos(i).toFixed(2)}%" data-act="${canEdit() ? 'edit-item' : 'noop'}" data-id="${m.id}" data-item="${m.id}" title="${esc(m.title)} — ${esc(dFull(m.date))}">
            <i></i><span><b>${esc(m.title)}</b><em>${esc(dShort(m.date, t))}${m.status !== 'planned' ? ' · ' + esc((ST.milestone[m.status] || m.status) + (m.late ? ' (late)' : '')) : m.late ? ' · late' : ''}</em></span></button>`; }).join('')}
      </div></div>`;
    }
    const tbs = und.length ? `<div class="pj-tbs"><span class="pj-tbs-l">${svg(IC.clock, 14)}To schedule</span>${und.map(m => `<button type="button" class="pj-tb${m.data.gate ? ' gate' : ''}" data-act="${canEdit() ? 'edit-item' : 'noop'}" data-id="${m.id}" data-item="${m.id}">${m.data.gate ? '◆ ' : ''}${esc(m.title)}</button>`).join('')}</div>` : '';
    return road + tbs;
  }
  function secTimeline(p, t) {
    const ms = items('milestone'), ev = items('event').slice().sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);
    const topics = [...new Set(ev.map(e => e.data.topic).filter(Boolean))];
    const evs = ev.filter(e => S.story === 'all' || e.data.topic === S.story);
    const years = {}; evs.forEach(e => { const y = (e.date || '----').slice(0, 4); (years[y] = years[y] || []).push(e); });
    const msRows = ms.slice().sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : (a.date || '9999') > (b.date || '9999') ? 1 : a.sort - b.sort).map(m => `<tr data-item="${m.id}" class="${m.late || m.status === 'missed' ? 'bad' : ''}">
      <td class="pj-nw">${m.date ? esc(dFull(m.date)) : '<span class="pj-muted">TBC</span>'}</td>
      <td><b>${m.data.gate ? '<i class="pj-gate" title="Key gate">◆</i>' : ''}${esc(m.title)}</b>${m.body ? `<div class="pj-sub">${esc(m.body)}</div>` : ''}</td>
      <td>${stPill('milestone', m.late ? 'missed' : m.status).replace('Missed', m.late && m.status !== 'missed' ? 'Late' : 'Missed')}</td>
      <td class="pj-nw">${m.doneAt ? esc(dFull(m.doneAt)) : m.date && m.status !== 'done' ? `<span class="${m.late ? 'pj-bad' : 'pj-muted'}">${esc(rel(m.daysTo))}</span>` : ''}${m.slipDays ? `<div class="pj-sub ${m.slipDays > 0 ? 'pj-bad' : ''}">${m.slipDays > 0 ? '+' : ''}${esc(dur(m.slipDays))} vs baseline</div>` : ''}</td>
      <td class="pj-ac">${editBtn(m)}</td></tr>`).join('');
    return `<section class="pj-sec" id="pj-s-timeline" data-sec="timeline">${secHead('timeline', 'Timeline & milestones', `${p.stats.milestones.done} done · ${p.stats.milestones.missed + p.stats.milestones.late} missed or late · ${p.stats.milestones.undated} to schedule`, addBtn('milestone', 'Milestone'))}
      ${msRoad(ms, p, t) || empty('No milestone yet.')}
      ${ms.length ? `<div class="pj-tw"><table class="pj-tbl pj-mst"><thead><tr><th>Date</th><th>Milestone</th><th>Status</th><th>Done / when</th><th></th></tr></thead><tbody>${msRows}</tbody></table></div>` : ''}
      <div class="pj-sh pj-sh2"><h3>${svg(IC.clock, 16)}The story so far</h3><span class="pj-shs">${ev.length} dated events${ev.length ? ' · ' + esc(dMon(ev[0].date)) + ' → ' + esc(dMon(ev[ev.length - 1].date)) : ''}</span>${addBtn('event', 'Event')}</div>
      ${topics.length > 1 ? `<div class="pj-filt"><button type="button" data-act="story" data-topic="all" class="${S.story === 'all' ? 'on' : ''}">All</button>${topics.map(tp => `<button type="button" data-act="story" data-topic="${esc(tp)}" class="${S.story === tp ? 'on' : ''}">${esc(tp)}</button>`).join('')}</div>` : ''}
      ${evs.length ? `<div class="pj-story">${Object.keys(years).map(y => `<div class="pj-sy"><div class="pj-syl">${esc(y)}</div><ol>${years[y].map((e, i) => `<li class="pj-ev-${esc(e.data.tone || 'neutral')}" data-item="${e.id}" data-rv style="--d:${Math.min(i, 10) * 35}ms">
          <span class="pj-evd">${esc(dShort(e.date, e.date))}</span><span class="pj-evb"><span class="pj-evt">${e.data.topic ? `<i>${esc(e.data.topic)}</i>` : ''}${esc(e.title)}</span>${e.body ? `<span class="pj-evx">${esc(e.body)}</span>` : ''}</span>${editBtn(e)}</li>`).join('')}</ol></div>`).join('')}</div>` : (ev.length ? empty('Nothing for this topic.') : '')}
    </section>`;
  }

  /* ---------- Delivery ---------- */
  function secDelivery(p) {
    const ws = items('workstream'), rq = items('requirement');
    const evid = { accepted: ['Accepted', 'good'], 'vendor-reported': ['Vendor-reported', 'muted'], disputed: ['Disputed', 'bad'] };
    const wrow = (w, i) => { const tone = w.status === 'done' ? 'good' : ['blocked', 'disputed'].includes(w.status) ? 'bad' : w.status === 'at_risk' ? 'warn' : 'info'; const ev = evid[w.data.evidence];
      return `<div class="pj-ws" data-item="${w.id}" data-rv style="--d:${i * 40}ms"><div class="pj-wsh"><b>${esc(w.title)}</b>${w.ref ? `<span class="pj-ref">${esc(w.ref)}</span>` : ''}${stPill('workstream', w.status)}${ev && !(w.status === 'disputed' && w.data.evidence === 'disputed') ? pill(ev[0], ev[1]) : ''}${editBtn(w)}</div>
        <div class="pj-wsb">${bar(w.pct, tone, w.data.evidence && w.data.evidence !== 'accepted')}<b class="pj-wsp">${w.pct == null ? '—' : w.pct + '%'}</b></div>
        ${w.owner ? `<div class="pj-sub">${svg(IC.users, 12)} ${esc(w.owner)}</div>` : ''}${w.data.remaining ? `<div class="pj-wsr"><b>Remaining:</b> ${esc(w.data.remaining)}</div>` : ''}${w.body ? `<div class="pj-sub">${esc(w.body)}</div>` : ''}</div>`; };
    const counts = rq.reduce((o, r) => (o[r.status] = (o[r.status] || 0) + 1, o), {});
    const rqRows = rq.map(r => `<tr data-item="${r.id}"><td><b>${esc(r.title)}</b>${r.ref ? `<div class="pj-sub">${esc(r.ref)}</div>` : ''}</td><td>${esc(r.data.area || '')}</td><td>${stPill('requirement', r.status)}</td><td>${esc(r.data.reading || r.body || '')}${r.data.source ? `<div class="pj-sub">${esc(r.data.source)}</div>` : ''}</td><td class="pj-ac">${editBtn(r)}</td></tr>`).join('');
    return `<section class="pj-sec" id="pj-s-delivery" data-sec="delivery">${secHead('delivery', 'Delivery — workstreams & domains', ws.length ? `${p.stats.workstreams.done} of ${ws.length} done · ${p.stats.workstreams.atRisk} at risk, blocked or disputed` : '', addBtn('workstream', 'Workstream'))}
      ${ws.length ? `<div class="pj-wsl">${ws.map(wrow).join('')}</div>` : empty('No workstream yet.')}
      <div class="pj-sh pj-sh2"><h3>${svg(IC.check, 16)}Requirements</h3><span class="pj-shs">${Object.entries(counts).map(([k, v]) => `${v} ${esc(((ST.requirement[k]) || k).toLowerCase())}`).join(' · ')}</span>${addBtn('requirement', 'Requirement')}</div>
      ${rq.length ? `<div class="pj-rqsum">${Object.entries(counts).map(([k, v]) => `<span class="pj-rqc pj-t-${TONE[k] || 'muted'}"><b>${v}</b>${esc(ST.requirement[k] || k)}</span>`).join('')}</div>
        <div class="pj-tw"><table class="pj-tbl pj-rqt"><thead><tr><th>Requirement</th><th>Area</th><th>Status</th><th>Position / source</th><th></th></tr></thead><tbody>${rqRows}</tbody></table></div>` : empty('No requirement recorded.')}
    </section>`;
  }

  /* ---------- Issues ---------- */
  function issueCard(x, i) {
    const nxt = x.data.next || x.data.mitigation;
    return `<div class="pj-is pj-is-${esc(x.severity || 'medium')}${x.open ? '' : ' closed'}" data-item="${x.id}" data-rv style="--d:${i * 35}ms">
      <div class="pj-ish">${sevPill(x.severity)}${x.status === 'open' ? '' : stPill(x.kind, x.status)}${x.kind === 'gap' && x.data.type ? pill(GAPT[x.data.type] || x.data.type, 'muted') : ''}${x.kind === 'risk' && x.data.likelihood ? pill('Likelihood ' + x.data.likelihood, 'muted') : ''}${x.ref ? `<span class="pj-ref">${esc(x.ref)}</span>` : ''}${editBtn(x)}</div>
      <b class="pj-ist">${esc(x.title)}</b>${x.body ? `<p>${esc(x.body)}</p>` : ''}
      ${nxt ? `<div class="pj-isn"><span>${x.kind === 'risk' ? 'Mitigation' : x.kind === 'gap' ? 'To close it' : 'Next step'}</span>${esc(nxt)}</div>` : ''}
      <div class="pj-ism">${x.owner ? `<span>${svg(IC.users, 12)}${esc(x.owner)}</span>` : ''}${x.data.side ? `<span>${esc({ salam: 'Salam side', vendor: 'Vendor side', joint: 'Joint', partner: 'Partner', third: 'Third party' }[x.data.side] || x.data.side)}</span>` : ''}${x.ageDays != null && x.open ? `<span>${svg(IC.clock, 12)}open ${esc(dur(x.ageDays))}</span>` : ''}${x.due ? `<span class="${x.overdue ? 'pj-bad' : ''}">due ${esc(dFull(x.due))}${x.overdue ? ' · overdue' : ''}</span>` : ''}</div></div>`;
  }
  function secIssues(p) {
    const f = S.filt, keep = x => (!f.openOnly || x.open) && (f.sev === 'all' || (f.sev === 'ml' ? ['medium', 'low'].includes(x.severity) : x.severity === f.sev));
    const sort = (a, b) => (a.open === b.open ? 0 : a.open ? -1 : 1) || ({ critical: 0, high: 1, medium: 2, low: 3 }[a.severity] ?? 4) - ({ critical: 0, high: 1, medium: 2, low: 3 }[b.severity] ?? 4) || a.sort - b.sort;
    const col = (kind, title, ic) => { const all = items(kind), list = all.filter(keep).sort(sort);
      return `<div class="pj-icol"><div class="pj-ich">${svg(ic, 15)}<b>${esc(title)}</b><span>${all.filter(x => x.open).length} open</span>${addBtn(kind, '')}</div>${list.map(issueCard).join('') || '<div class="pj-empty sm">None for this filter.</div>'}</div>`; };
    const fb = (v, l) => `<button type="button" data-act="sev" data-sev="${v}" class="${f.sev === v ? 'on' : ''}">${esc(l)}</button>`;
    return `<section class="pj-sec" id="pj-s-issues" data-sec="issues">${secHead('issues', 'Issues — bottlenecks, gaps & risks', `${p.stats.bottlenecks.open} bottlenecks (${p.stats.bottlenecks.critical} critical) · ${p.stats.gaps.open} gaps · ${p.stats.risks.open} risks open`)}
      <div class="pj-filt">${fb('all', 'All')}${fb('critical', 'Critical')}${fb('high', 'High')}${fb('ml', 'Medium & low')}<label class="pj-chk"><input type="checkbox" data-act="openonly" ${f.openOnly ? 'checked' : ''}><span>Open only</span></label></div>
      <div class="pj-icols">${col('bottleneck', 'Bottlenecks', IC.alert)}${col('gap', 'Gaps', IC.target)}${col('risk', 'Risks', IC.shield)}</div></section>`;
  }

  /* ---------- Budget ---------- */
  function donut(parts, cur) {
    const tot = parts.reduce((t, x) => t + x.v, 0); if (!tot) return '';
    const R = 54, C = 2 * Math.PI * R; let acc = 0;
    const segs = parts.filter(x => x.v > 0).map(x => { const len = C * x.v / tot, s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke-width="18" class="pj-dn-${x.k}" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}" stroke-dashoffset="${(-acc).toFixed(1)}" transform="rotate(-90 70 70)"/>`; acc += len; return s; }).join('');
    return `<div class="pj-donut"><svg viewBox="0 0 140 140" width="150" height="150" aria-hidden="true"><circle r="${R}" cx="70" cy="70" fill="none" stroke-width="18" class="bg"/>${segs}</svg><div class="pj-dnv"><b>${esc(cur)} ${moneyShort(tot)}</b><span>recorded</span></div></div>`;
  }
  function secBudget(p, t) {
    const b = p.budget || {}, st = p.stats.budget, cur = b.currency || 'SAR', ln = items('budget_line');
    const tile = (lbl, v, tone, sub, none) => `<div class="pj-bt pj-t-${tone}"><span>${esc(lbl)}</span><b>${v == null ? `<i class="pj-muted">${esc(none || 'not provided')}</i>` : money(v, cur)}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const inv = (st.invoiced || 0) + (st.onHold || 0) + (st.paid || 0);
    const parts = [{ k: 'paid', v: st.paid, l: 'Paid' }, { k: 'invoiced', v: st.invoiced, l: 'Invoiced' }, { k: 'on_hold', v: st.onHold, l: 'On hold' }, { k: 'committed', v: st.committed, l: 'Committed' }, { k: 'planned', v: st.planned, l: 'Planned' }, { k: 'disputed', v: st.disputed, l: 'To confirm' }];
    const rows = ln.map(l => `<tr data-item="${l.id}"><td><b>${esc(l.title)}</b>${l.body ? `<div class="pj-sub">${esc(l.body)}</div>` : ''}</td><td>${stPill('budget_line', l.status)}</td><td class="pj-num">${l.amount == null ? '<span class="pj-muted">no amount</span>' : money(l.amount, cur)}</td><td class="pj-nw">${l.date ? esc(dFull(l.date)) : ''}</td><td>${esc(l.ref || '')}</td><td class="pj-ac">${editBtn(l)}</td></tr>`).join('');
    return `<section class="pj-sec" id="pj-s-budget" data-sec="budget">${secHead('budget', 'Budget & money', `${esc(cur)}${b.vat ? ' · ' + esc(b.vat) : ''}${st.unpriced ? ` · ${st.unpriced} line${st.unpriced === 1 ? '' : 's'} without an amount` : ''}`, addBtn('budget_line', 'Line'))}
      <div class="pj-bgrid"><div class="pj-btiles">${tile('Contract / budget', b.total, 'info', b.committed != null ? 'committed ' + money(b.committed, cur) : '')}${tile('Invoiced', inv || null, 'info', st.onHold ? 'of which ' + money(st.onHold, cur) + ' on hold' : '', 'none recorded')}${tile('On hold', st.onHold || null, st.onHold ? 'bad' : 'muted', st.onHold ? 'invoices held' : '', 'nothing held')}${tile('Paid', st.paid || null, 'good', '', 'none recorded')}</div>
        ${donut(parts, cur) ? `<div class="pj-bdn">${donut(parts, cur)}<ul>${parts.filter(x => x.v > 0).map(x => `<li><i class="pj-dn-${x.k}"></i>${esc(x.l)}<b>${money(x.v, cur)}</b></li>`).join('')}</ul></div>` : ''}</div>
      ${b.note ? `<div class="pj-note">${svg(IC.alert, 14)}<span>${esc(b.note)}</span></div>` : ''}
      ${ln.length ? `<div class="pj-tw"><table class="pj-tbl"><thead><tr><th>Line</th><th>Status</th><th class="pj-num">Amount</th><th>Date</th><th>Ref</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('No budget line yet.')}
    </section>`;
  }

  /* ---------- Governance ---------- */
  function meetingCard(m, i, t) {
    const acts = m.data.actions || [], decs = m.data.decisions || [];
    const d = m.date ? asDate(m.date) : null;
    return `<article class="pj-mt pj-mt-${esc(m.status)}" data-item="${m.id}" data-rv style="--d:${i * 50}ms">
      <div class="pj-mtd">${d ? `<b>${esc(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric' }).format(d))}</b><span>${esc(F_M.format(d))}</span><em>${esc(m.date.slice(0, 4))}</em>` : '<b>TBC</b><span>date</span>'}</div>
      <div class="pj-mtb"><div class="pj-mth">${pill(MTYPE[m.data.type] || 'Meeting', m.data.type === 'steering' ? 'violet' : m.data.type === 'escalation' ? 'bad' : 'info')}${stPill('meeting', m.status)}${m.data.cadence ? pill(m.data.cadence, 'muted') : ''}${editBtn(m)}</div>
        <b class="pj-mtt">${esc(m.title)}</b>${m.data.venue ? `<div class="pj-sub">${esc(m.data.venue)}</div>` : ''}
        ${m.body ? `<p>${esc(m.body)}</p>` : ''}
        ${m.data.attendees ? `<details class="pj-att"><summary>${svg(IC.users, 13)}Attendees</summary><p>${esc(m.data.attendees)}</p></details>` : ''}
        ${decs.length || acts.length ? `<details class="pj-mtd2"${i < 2 ? ' open' : ''}><summary>${svg(IC.list, 13)}MOM — ${decs.length ? `${decs.length} decision${decs.length === 1 ? '' : 's'}` : ''}${decs.length && acts.length ? ' · ' : ''}${acts.length ? `${acts.length} action${acts.length === 1 ? '' : 's'} (${acts.filter(a => !['done', 'dropped'].includes(a.status)).length} open)` : ''}</summary>` : ''}
        ${decs.length ? `<div class="pj-mtx"><span>${svg(IC.gavel, 13)}Decisions & information</span><ul>${decs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${acts.length ? `<div class="pj-mtx"><span>${svg(IC.check, 13)}Actions (${acts.filter(a => !['done', 'dropped'].includes(a.status)).length} open)</span><table class="pj-tbl pj-mta"><tbody>${acts.map(a => { const late = a.due && a.due < t && !['done', 'dropped'].includes(a.status);
          return `<tr><td>${esc(a.text)}</td><td class="pj-nw">${esc(a.owner || '')}</td><td class="pj-nw ${late ? 'pj-bad' : ''}">${a.due ? esc(dShort(a.due, t)) : ''}</td><td>${stPill('action', late ? 'late' : a.status)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
        ${decs.length || acts.length ? '</details>' : ''}
      </div></article>`;
  }
  function secGovernance(p, t) {
    const decs = items('decision').slice().sort((a, b) => (a.status === 'needed' ? 0 : 1) - (b.status === 'needed' ? 0 : 1) || (b.data.vp ? 1 : 0) - (a.data.vp ? 1 : 0) || a.sort - b.sort);
    const mts = items('meeting').slice().sort((a, b) => { const pa = a.status === 'planned' ? 0 : 1, pb = b.status === 'planned' ? 0 : 1; if (pa !== pb) return pa - pb;
      return pa === 0 ? ((a.date || '9999') < (b.date || '9999') ? -1 : 1) : ((a.date || '') < (b.date || '') ? 1 : -1); });
    const acts = items('action').slice().sort((a, b) => (a.open === b.open ? 0 : a.open ? -1 : 1) || (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1) || ((a.due || '9999') < (b.due || '9999') ? -1 : 1));
    const shownActs = acts.filter(a => S.showDone || a.open);
    const conds = items('condition');
    return `<section class="pj-sec" id="pj-s-governance" data-sec="governance">${secHead('governance', 'Governance — decisions, meetings & actions', `${p.stats.decisions.needed} decision${p.stats.decisions.needed === 1 ? '' : 's'} open · ${p.stats.meetings.held} meeting${p.stats.meetings.held === 1 ? '' : 's'} recorded · ${p.stats.actions.open} open action${p.stats.actions.open === 1 ? '' : 's'}${p.stats.actions.overdue ? ` (<b class="pj-bad">${p.stats.actions.overdue} overdue</b>)` : ''}`)}
      <div class="pj-sh pj-sh2"><h3>${svg(IC.gavel, 16)}Decisions</h3>${addBtn('decision', 'Decision')}</div>
      ${decs.length ? `<div class="pj-dgrid">${decs.map((x, i) => `<div class="pj-dc pj-dc-${esc(x.status)}" data-item="${x.id}" data-rv style="--d:${i * 40}ms"><div class="pj-dch">${x.data.vp ? '<i class="pj-vpb">For the VP</i>' : ''}${stPill('decision', x.status)}${editBtn(x)}</div><b>${esc(x.title)}</b>${x.body ? `<p>${esc(x.body)}</p>` : ''}${x.data.outcome ? `<div class="pj-isn"><span>Outcome</span>${esc(x.data.outcome)}</div>` : ''}<div class="pj-ism">${x.owner ? `<span>${svg(IC.users, 12)}${esc(x.owner)}</span>` : ''}${x.due ? `<span>by ${esc(dFull(x.due))}</span>` : ''}</div></div>`).join('')}</div>` : empty('No decision recorded.')}
      <div class="pj-sh pj-sh2"><h3>${svg(IC.users, 16)}Meetings & steerings — MOMs</h3><span class="pj-shs">planned first, then the latest held</span>${addBtn('meeting', 'Meeting')}</div>
      ${mts.length ? `<div class="pj-mts">${mts.map((m, i) => meetingCard(m, i, t)).join('')}</div>` : empty('No meeting recorded.')}
      <div class="pj-sh pj-sh2"><h3>${svg(IC.check, 16)}Action tracker</h3><label class="pj-chk"><input type="checkbox" data-act="showdone" ${S.showDone ? 'checked' : ''}><span>Show done</span></label>${addBtn('action', 'Action')}</div>
      ${shownActs.length ? `<div class="pj-tw"><table class="pj-tbl pj-act"><thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Status</th><th>From</th><th></th></tr></thead><tbody>${shownActs.map(a => `<tr data-item="${a.id}" class="${a.overdue ? 'bad' : ''}${a.open ? '' : ' done'}"><td><b>${esc(a.title)}</b>${a.ref ? `<div class="pj-sub">${esc(a.ref)}</div>` : ''}${a.body ? `<div class="pj-sub">${esc(a.body)}</div>` : ''}</td><td>${esc(a.owner || '')}</td><td class="pj-nw ${a.overdue ? 'pj-bad' : ''}">${a.due ? esc(dShort(a.due, t)) + (a.overdue ? `<div class="pj-sub pj-bad">${esc(dur(between(a.due, t)))} late</div>` : '') : '<span class="pj-muted">—</span>'}</td><td>${stPill('action', a.overdue ? 'late' : a.status)}</td><td class="pj-sub">${esc(a.data.from || '')}</td><td class="pj-ac">${editBtn(a)}</td></tr>`).join('')}</tbody></table></div>` : empty(acts.length ? 'Every action is done.' : 'No action recorded.')}
      ${conds.length || canEdit() ? `<div class="pj-sh pj-sh2"><h3>${svg(IC.shield, 16)}Conditions & safeguards</h3><span class="pj-shs">what must be true before we commit</span>${addBtn('condition', 'Condition')}</div>
      ${conds.length ? `<ol class="pj-conds">${conds.map((c, i) => `<li data-item="${c.id}" data-rv style="--d:${Math.min(i, 12) * 30}ms"><span class="pj-cn">${i + 1}</span><div><div class="pj-cdh"><b>${esc(c.title)}</b>${stPill('condition', c.status)}${editBtn(c)}</div>${c.body ? `<p>${esc(c.body)}</p>` : ''}${c.owner ? `<div class="pj-sub">${svg(IC.users, 12)} ${esc(c.owner)}</div>` : ''}</div></li>`).join('')}</ol>` : ''}` : ''}
    </section>`;
  }

  /* ---------- Escalation ---------- */
  function secEscalation() {
    const es = items('escalation');
    const side = (k, title) => { const list = es.filter(x => (x.data.side || 'salam') === k || (k === 'vendor' && ['vendor', 'partner', 'third', 'joint'].includes(x.data.side))).sort((a, b) => (a.data.level || 1) - (b.data.level || 1) || a.sort - b.sort);
      return `<div class="pj-lad pj-lad-${k}"><div class="pj-ladh">${svg(k === 'salam' ? IC.shield : IC.users, 16)}<b>${esc(title)}</b></div>
        ${list.length ? `<ol>${list.map((x, i) => `<li data-item="${x.id}" data-rv style="--d:${i * 60}ms;--lv:${x.data.level || 1}"><span class="pj-lv">L${x.data.level || 1}</span><div class="pj-lb"><b>${esc(x.title)}</b>${x.data.role ? `<span>${esc(x.data.role)}</span>` : ''}${x.data.when ? `<em>${svg(IC.up, 12)}${esc(x.data.when)}</em>` : ''}${x.data.contact ? `<span class="pj-sub">${esc(x.data.contact)}</span>` : ''}${x.body ? `<span class="pj-sub">${esc(x.body)}</span>` : ''}</div>${editBtn(x)}</li>`).join('')}</ol>` : '<div class="pj-empty sm">Nobody named yet.</div>'}</div>`; };
    return `<section class="pj-sec" id="pj-s-escalation" data-sec="escalation">${secHead('escalation', 'Escalation matrix', 'who to call, level by level — move up when the trigger is met', addBtn('escalation', 'Contact'))}
      ${es.length || canEdit() ? `<div class="pj-ladders">${side('salam', 'Salam')}${side('vendor', 'Vendor & partners')}</div>` : empty('No escalation matrix yet.')}</section>`;
  }

  /* ---------- Activity ---------- */
  function secActivity(p, t) {
    const ups = items('update'), cm = items('comment');
    return `<section class="pj-sec" id="pj-s-activity" data-sec="activity">${secHead('activity', 'Status updates & comments', `${ups.length} update${ups.length === 1 ? '' : 's'} · ${cm.length} comment${cm.length === 1 ? '' : 's'}`, addBtn('update', 'Status update'))}
      <div class="pj-actg"><div><ol class="pj-ups">${ups.map((u, i) => `<li class="pj-up-${esc(u.data.rag || 'grey')}" data-item="${u.id}" data-rv style="--d:${i * 40}ms"><span class="pj-upd">${esc(dShort(u.date, t))}</span><div class="pj-upb"><div class="pj-uph">${ragPill(u.data.rag || 'grey')}${editBtn(u)}</div><b>${esc(u.title)}</b>${para(u.body)}</div></li>`).join('') || '<li class="pj-empty">No status update yet.</li>'}</ol></div>
        <div class="pj-cms"><div class="pj-bh"><h3>${svg(IC.chat, 16)}Comments</h3></div>
          ${me().canComment ? `<div class="pj-cmf"><textarea id="pjCm" rows="3" maxlength="4000" placeholder="${me().isVp ? 'Ask the owners a question or leave a direction — your comment carries the VP badge' : 'Add a comment for the project team'}"></textarea><div><button class="pj-btn pri" type="button" data-act="comment">${svg(IC.chat, 14)}<span>Post</span></button></div></div>` : ''}
          <ol class="pj-cml">${cm.map(c => `<li class="${c.data.vp ? 'vp' : ''}" data-item="${c.id}"><div class="pj-cmh">${c.data.vp ? '<i class="pj-vpb">VP</i>' : ''}<b>${esc(c.createdByName || c.createdBy || '')}</b><span>${esc(ago(c.createdAt))}</span>${(c.createdBy && c.createdBy === me().email) || canEdit() ? `<button class="pj-lnk" type="button" data-act="del-comment" data-id="${c.id}">Delete</button>` : ''}</div><div class="pj-cmb">${esc(c.body || '')}</div></li>`).join('') || '<li class="pj-empty sm">No comment yet.</li>'}</ol></div></div>
    </section>`;
  }

  /* ================================================================== EDITING */
  /* field spec: [path, type, label, opts] — path 'data.x' lands in items.data */
  const LV = { 1: 'L1', 2: 'L2', 3: 'L3', 4: 'L4', 5: 'L5' };
  const FORMS = {
    milestone: [['title', 'text', 'Milestone', { req: 1, wide: 1 }], ['date', 'date', 'Target date'], ['status', 'select', 'Status'], ['done_at', 'date', 'Completed on'], ['data.baseline', 'date', 'Baseline date (to show the slip)'],
      ['owner', 'text', 'Owner'], ['data.gate', 'check', 'Key gate (go / no-go)'], ['body', 'area', 'Note', { wide: 1 }], ['sort', 'num', 'Order']],
    event: [['date', 'date', 'Date', { req: 1 }], ['data.topic', 'text', 'Topic'], ['title', 'text', 'What happened', { req: 1, wide: 1 }], ['data.tone', 'pick', 'Tone', { opts: { good: 'Good', neutral: 'Neutral', warn: 'Watch', bad: 'Bad' } }], ['body', 'area', 'Detail', { wide: 1 }]],
    workstream: [['title', 'text', 'Workstream / domain', { req: 1, wide: 1 }], ['pct', 'num', 'Progress %'], ['status', 'select', 'Status'], ['owner', 'text', 'Owner'], ['ref', 'text', 'Reference'],
      ['data.evidence', 'pick', 'Evidence', { opts: { accepted: 'Accepted with evidence', 'vendor-reported': 'Vendor-reported', disputed: 'Disputed' }, wide: 1 }], ['data.remaining', 'area', 'Remaining', { wide: 1 }], ['body', 'area', 'Note', { wide: 1 }], ['sort', 'num', 'Order']],
    bottleneck: [['title', 'text', 'Bottleneck', { req: 1, wide: 1 }], ['severity', 'sev', 'Severity', { wide: 1 }], ['status', 'select', 'Status'], ['owner', 'text', 'Who must act'],
      ['data.side', 'pick', 'On whose side', { opts: { salam: 'Salam', vendor: 'Vendor', joint: 'Joint', third: 'Third party' }, wide: 1 }], ['date', 'date', 'Since'], ['due', 'date', 'Needed by'], ['ref', 'text', 'Reference (JIRA, ticket)'],
      ['body', 'area', 'Impact / detail', { wide: 1 }], ['data.next', 'area', 'Next step', { wide: 1 }]],
    gap: [['title', 'text', 'Gap', { req: 1, wide: 1 }], ['severity', 'sev', 'Severity', { wide: 1 }], ['status', 'select', 'Status'], ['owner', 'text', 'Owner'],
      ['data.type', 'pick', 'Type', { opts: GAPT, wide: 1 }], ['body', 'area', 'Detail', { wide: 1 }], ['data.next', 'area', 'How to close it', { wide: 1 }]],
    risk: [['title', 'text', 'Risk', { req: 1, wide: 1 }], ['severity', 'sev', 'Impact', { wide: 1 }], ['data.likelihood', 'pick', 'Likelihood', { opts: { low: 'Low', medium: 'Medium', high: 'High' } }], ['status', 'select', 'Status'], ['owner', 'text', 'Owner'],
      ['body', 'area', 'Detail', { wide: 1 }], ['data.mitigation', 'area', 'Mitigation', { wide: 1 }]],
    requirement: [['title', 'text', 'Requirement', { req: 1, wide: 1 }], ['status', 'select', 'Status'], ['data.area', 'text', 'Area'], ['data.reading', 'area', 'Position / reading', { wide: 1 }], ['data.source', 'text', 'Source'], ['owner', 'text', 'Owner'], ['ref', 'text', 'Reference']],
    meeting: [['title', 'text', 'Meeting', { req: 1, wide: 1 }], ['data.type', 'pick', 'Type', { opts: MTYPE, wide: 1 }], ['status', 'select', 'Status'], ['date', 'date', 'Date'], ['data.cadence', 'text', 'Cadence'], ['data.venue', 'text', 'Where'],
      ['data.attendees', 'area', 'Attendees', { wide: 1 }], ['body', 'area', 'Summary / agenda', { wide: 1 }], ['data.decisions', 'lines', 'Decisions & information — one per line', { wide: 1 }],
      ['data.actions', 'acts', 'Actions — one per line: action | owner | due (YYYY-MM-DD) | status (open, in_progress, done, late, dropped)', { wide: 1 }]],
    action: [['title', 'text', 'Action', { req: 1, wide: 1 }], ['owner', 'text', 'Owner'], ['due', 'date', 'Due'], ['status', 'select', 'Status'], ['ref', 'text', 'Reference'], ['data.from', 'text', 'From (meeting, mail)'], ['body', 'area', 'Note', { wide: 1 }]],
    decision: [['title', 'text', 'Decision', { req: 1, wide: 1 }], ['status', 'select', 'Status'], ['owner', 'text', 'Who decides'], ['due', 'date', 'Needed by'], ['data.vp', 'check', 'Needs the VP'], ['body', 'area', 'Context', { wide: 1 }], ['data.outcome', 'area', 'Outcome', { wide: 1 }]],
    condition: [['title', 'text', 'Past issue / condition', { req: 1, wide: 1 }], ['body', 'area', 'Rule', { wide: 1 }], ['owner', 'text', 'Owner'], ['status', 'select', 'Status'], ['sort', 'num', 'Order']],
    escalation: [['data.side', 'pick', 'Side', { opts: { salam: 'Salam', vendor: 'Vendor / partner' } }], ['data.level', 'pick', 'Level', { opts: LV }], ['title', 'text', 'Name(s)', { req: 1, wide: 1 }], ['data.role', 'text', 'Role', { wide: 1 }],
      ['data.when', 'area', 'Escalate to this level when…', { wide: 1 }], ['data.contact', 'text', 'Contact (desk line or mailbox — no personal mobile numbers)', { wide: 1 }], ['body', 'area', 'Note', { wide: 1 }], ['sort', 'num', 'Order']],
    budget_line: [['title', 'text', 'Line', { req: 1, wide: 1 }], ['amount', 'money', 'Amount'], ['status', 'select', 'Status'], ['date', 'date', 'Date'], ['ref', 'text', 'Invoice / PO'], ['body', 'area', 'Note', { wide: 1 }]],
    update: [['date', 'date', 'Date', { req: 1 }], ['data.rag', 'rag', 'Overall status'], ['title', 'text', 'Headline', { req: 1, wide: 1 }], ['body', 'area', 'What changed', { wide: 1, rows: 6 }]]
  };
  const COL = { done_at: 'doneAt' };
  const getVal = (it, path) => { if (!it) return undefined; if (path.startsWith('data.')) return (it.data || {})[path.slice(5)]; return it[COL[path] || path]; };
  const fid = path => 'pjf_' + path.replace(/\W/g, '_');
  function fieldHtml(spec, it, kind) {
    const [path, type, label, o] = spec, opt = o || {}, id = fid(path);
    let v = getVal(it, path); if (v == null && !it) { if (type === 'select') v = Object.keys(ST[kind] || {})[0]; if (path === 'date' && ['update', 'event', 'bottleneck', 'gap', 'risk'].includes(kind)) v = todayK(); if (type === 'sev') v = 'medium'; if (path === 'data.side' && kind === 'escalation') v = 'salam'; if (path === 'data.level') v = 1; if (type === 'rag') v = kind === 'project' ? 'grey' : ((proj() || {}).rag || 'amber'); }
    const wrap = inner => `<label class="pj-f${opt.wide ? ' wide' : ''}" for="${id}"><span>${esc(label)}${opt.req ? ' *' : ''}</span>${inner}</label>`;
    const radios = (opts, cls) => `<div class="pj-f${opt.wide ? ' wide' : ''}"><span>${esc(label)}</span><div class="pj-radio ${cls || ''}" role="radiogroup">${Object.entries(opts).map(([k, l]) => `<label><input type="radio" name="${esc(path)}" value="${esc(k)}" ${String(v) === String(k) ? 'checked' : ''}><span class="pj-r-${esc(k)}">${esc(l)}</span></label>`).join('')}</div></div>`;
    switch (type) {
      case 'text': return wrap(`<input class="pj-in" id="${id}" name="${esc(path)}" value="${esc(v == null ? '' : v)}" ${opt.req ? 'required' : ''} maxlength="300" autocomplete="off">`);
      case 'area': return wrap(`<textarea class="pj-in" id="${id}" name="${esc(path)}" rows="${opt.rows || 3}">${esc(v == null ? '' : v)}</textarea>`);
      case 'date': return wrap(`<input class="pj-in" type="date" id="${id}" name="${esc(path)}" value="${esc(v || '')}" ${opt.req ? 'required' : ''}>`);
      case 'num': return wrap(`<input class="pj-in" type="number" id="${id}" name="${esc(path)}" value="${v == null ? '' : esc(v)}" min="0" max="${path === 'pct' || path === 'progress' ? 100 : 9999}" step="1">`);
      case 'money': return wrap(`<input class="pj-in" id="${id}" name="${esc(path)}" value="${v == null ? '' : esc(v)}" inputmode="decimal" placeholder="e.g. 383567">`);
      case 'select': return wrap(`<select class="pj-in" id="${id}" name="${esc(path)}">${Object.entries(ST[kind] || {}).filter(([k]) => k !== 'late').map(([k, l]) => `<option value="${esc(k)}" ${v === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
      case 'check': return `<label class="pj-f pj-fchk"><input type="checkbox" name="${esc(path)}" ${v ? 'checked' : ''}><span>${esc(label)}</span></label>`;
      case 'sev': return radios(SEV, 'sev');
      case 'rag': return radios(RAG, 'rag');
      case 'pick': return radios(opt.opts || {});
      case 'lines': return wrap(`<textarea class="pj-in" id="${id}" name="${esc(path)}" rows="4">${esc((v || []).join('\n'))}</textarea>`);
      case 'acts': return wrap(`<textarea class="pj-in pj-mono" id="${id}" name="${esc(path)}" rows="5">${esc((v || []).map(a => [a.text, a.owner || '', a.due || '', a.status || 'open'].join(' | ')).join('\n'))}</textarea>`);
      default: return '';
    }
  }
  function readForm(form, specs) {
    const out = { data: {} };
    for (const [path, type] of specs) {
      let v;
      if (type === 'check') v = !!(form.querySelector(`[name="${CSS.escape(path)}"]`) || {}).checked;
      else if (['sev', 'rag', 'pick'].includes(type)) { const c = form.querySelector(`[name="${CSS.escape(path)}"]:checked`); v = c ? c.value : null; if (path === 'data.level' && v) v = Number(v); }
      else { const el = form.querySelector(`[name="${CSS.escape(path)}"]`); v = el ? el.value.trim() : ''; }
      if (type === 'lines') v = lines(v);
      if (type === 'acts') v = lines(v).map(l => { const [text, owner, due, status] = l.split('|').map(s => (s || '').trim()); return { text, owner: owner || null, due: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : null, status: status || 'open' }; }).filter(a => a.text);
      if (type === 'num' || type === 'money') v = v === '' ? null : v;
      if (type === 'date') v = v || null;
      if (path.startsWith('data.')) out.data[path.slice(5)] = v; else out[path] = v;
    }
    return out;
  }
  function itemModal(kind, it) {
    const specs = FORMS[kind]; if (!specs) return;
    const title = (it ? 'Edit ' : 'Add ') + KIND[kind];
    modal(title, `<form class="pj-form" id="pjForm" novalidate><div class="pj-fg">${specs.map(s => fieldHtml(s, it, kind)).join('')}</div>
      <div class="pj-mact">${it ? `<button class="pj-btn ghost" type="button" data-mact="del">${svg(IC.x, 14)}<span>Delete</span></button>` : ''}<span class="pj-msg" id="pjMsg"></span>
        <button class="pj-btn" type="button" data-mact="close">Cancel</button><button class="pj-btn pri" type="submit">${svg(IC.check, 14)}<span>${it ? 'Save' : 'Add'}</span></button></div></form>`,
      { wide: ['meeting', 'bottleneck', 'gap', 'risk', 'workstream'].includes(kind) });
    const form = $('#pjForm'), msg = $('#pjMsg');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = readForm(form, specs);
      const miss = specs.filter(s => (s[3] || {}).req).find(s => { const v = s[0].startsWith('data.') ? body.data[s[0].slice(5)] : body[s[0]]; return v == null || v === ''; });
      if (miss) { msg.textContent = `${miss[2]} is required.`; msg.className = 'pj-msg bad'; return; }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; msg.textContent = 'Saving…'; msg.className = 'pj-msg';
      try {
        if (it) await send(`/api/projects/${encodeURIComponent(S.slug)}/items/${it.id}`, body, 'PATCH');
        else await send(`/api/projects/${encodeURIComponent(S.slug)}/items`, Object.assign({ kind }, body));
        closeModal(); toast(it ? 'Saved.' : 'Added.'); await reloadProject(it ? it.id : null);
      } catch (err) { msg.textContent = err.message; msg.className = 'pj-msg bad'; btn.disabled = false; }
    });
    modalActs({ del: async () => { if (!(await askConfirm(`Delete this ${KIND[kind]}?`, 'Delete'))) return; try { await send(`/api/projects/${encodeURIComponent(S.slug)}/items/${it.id}`, { delete: true }, 'PATCH'); closeModal(); toast('Deleted.'); await reloadProject(); } catch (err) { msg.textContent = err.message; msg.className = 'pj-msg bad'; } } });
    setTimeout(() => { const f = form.querySelector('input:not([type=radio]):not([type=checkbox]),textarea'); if (f && window.innerWidth > 820) f.focus(); }, 60);
  }

  /* the project itself */
  const P_FORM = [
    ['Identity', [['name', 'text', 'Project name', { req: 1, wide: 1 }], ['code', 'text', 'Code'], ['slug', 'text', 'Short name in the link (#projects?p=…)'], ['vendor', 'text', 'Vendor'], ['category', 'text', 'Category'],
      ['vendor_detail', 'text', 'Vendor detail', { wide: 1 }], ['program', 'text', 'Program'], ['segment', 'pick', 'Business', { opts: SEG }], ['accent', 'color', 'Accent colour'], ['sort', 'num', 'Order on the page']]],
    ['People', [['sponsor', 'text', 'Sponsor', { wide: 1 }], ['owner', 'text', 'Salam lead', { wide: 1 }], ['vendor_pm', 'text', 'Vendor PM', { wide: 1 }]]],
    ['Status & dates', [['status', 'pselect', 'Status'], ['rag', 'rag', 'Overall RAG', { wide: 1 }], ['phase', 'text', 'Phase', { wide: 1 }], ['progress', 'num', 'Progress %'], ['progress_verified', 'check', 'Progress accepted by Salam (not vendor-reported)'],
      ['progress_basis', 'area', 'What the progress is based on', { wide: 1 }], ['start_date', 'date', 'Start'], ['baseline_end', 'date', 'Baseline end (or planned go-live)'], ['end_date', 'date', 'Target end'], ['go_live', 'date', 'Go-live'], ['baseline_no', 'num', 'Baseline number']]],
    ['Story', [['brief', 'area', 'The brief (a blank line starts a paragraph)', { wide: 1, rows: 6 }], ['objective', 'area', 'Objective', { wide: 1 }], ['scope', 'area', 'Scope — one line per point', { wide: 1, rows: 4 }]]]
  ];
  function projectModal(p) {
    const isNew = !p, m = me();
    const pv = path => { if (!p) return undefined; const map = { vendor_detail: 'vendorDetail', vendor_pm: 'vendorPm', progress_basis: 'progressBasis', progress_verified: 'progressVerified', start_date: 'startDate', end_date: 'endDate', baseline_end: 'baselineEnd', go_live: 'goLive', baseline_no: 'baselineNo' }; return p[map[path] || path]; };
    const fake = p ? new Proxy({}, { get: (_, k) => k === 'data' ? {} : pv(k) }) : null;
    const fld = s => { const [path, type, label, o] = s, opt = o || {}, id = fid(path), v = pv(path);
      if (type === 'pselect') return `<label class="pj-f" for="${id}"><span>${esc(label)}</span><select class="pj-in" id="${id}" name="${path}">${Object.entries(PST).map(([k, l]) => `<option value="${k}" ${(v || 'active') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
      if (type === 'color') return `<label class="pj-f" for="${id}"><span>${esc(label)}</span><input class="pj-in pj-color" type="color" id="${id}" name="${path}" value="${esc(v || '#0e9f5a')}"></label>`;
      return fieldHtml(s, fake, 'project'); };
    const health = (p ? p.health : [['schedule', 'Schedule'], ['scope', 'Scope'], ['budget', 'Budget'], ['resources', 'Resources'], ['quality', 'Quality'], ['vendor', 'Vendor']].map(([key, label]) => ({ key, label, rag: 'grey', note: '' })));
    const bud = (p && p.budget) || { currency: 'SAR' };
    const facts = ((p && p.facts) || []).map(f => [f.label, f.value, f.note || '', f.tone || ''].join(' | ')).join('\n');
    modal(isNew ? 'New project' : 'Edit project', `<form class="pj-form" id="pjForm" novalidate>
      ${P_FORM.map(([sec, specs]) => `<fieldset><legend>${esc(sec)}</legend><div class="pj-fg">${specs.map(fld).join('')}</div></fieldset>`).join('')}
      <fieldset><legend>Health by dimension</legend><div class="pj-hgf">${health.map(h => `<div class="pj-hgr" data-hk="${esc(h.key)}"><div class="pj-hgl"><input class="pj-in" name="hl_${esc(h.key)}" value="${esc(h.label)}" maxlength="30" aria-label="Label"></div>
        <div class="pj-radio rag" role="radiogroup">${Object.entries(RAG).map(([k, l]) => `<label><input type="radio" name="hr_${esc(h.key)}" value="${k}" ${h.rag === k ? 'checked' : ''}><span class="pj-r-${k}">${esc(l)}</span></label>`).join('')}</div>
        <textarea class="pj-in" name="hn_${esc(h.key)}" rows="2" placeholder="Why — one or two lines">${esc(h.note || '')}</textarea></div>`).join('')}</div></fieldset>
      <fieldset><legend>Budget</legend><div class="pj-fg">
        <label class="pj-f"><span>Currency</span><input class="pj-in" name="b_currency" value="${esc(bud.currency || 'SAR')}" maxlength="8"></label>
        <label class="pj-f"><span>Contract / budget</span><input class="pj-in" name="b_total" value="${bud.total == null ? '' : esc(bud.total)}" inputmode="decimal"></label>
        <label class="pj-f"><span>Committed</span><input class="pj-in" name="b_committed" value="${bud.committed == null ? '' : esc(bud.committed)}" inputmode="decimal"></label>
        <label class="pj-f"><span>VAT note</span><input class="pj-in" name="b_vat" value="${esc(bud.vat || '')}" placeholder="excl. VAT"></label>
        <label class="pj-f wide"><span>Budget note</span><textarea class="pj-in" name="b_note" rows="2">${esc(bud.note || '')}</textarea></label></div></fieldset>
      <fieldset><legend>Key facts</legend><label class="pj-f wide"><span>One per line: label | value | note | tone (good, warn, bad)</span><textarea class="pj-in pj-mono" name="facts" rows="5">${esc(facts)}</textarea></label></fieldset>
      ${m.editor ? `<fieldset><legend>Who can edit this project</legend><label class="pj-f wide"><span>E-mails of the project editors (besides the portfolio editors)</span><textarea class="pj-in" name="editors" rows="2" placeholder="name@salam.sa, …">${esc(((p && p.editors) || []).join(', '))}</textarea></label></fieldset>` : ''}
      <div class="pj-mact">${!isNew && m.editor ? `<button class="pj-btn ghost" type="button" data-mact="del">${svg(IC.x, 14)}<span>Archive</span></button>` : ''}<span class="pj-msg" id="pjMsg"></span>
        <button class="pj-btn" type="button" data-mact="close">Cancel</button><button class="pj-btn pri" type="submit">${svg(IC.check, 14)}<span>${isNew ? 'Create' : 'Save'}</span></button></div></form>`, { wide: true });
    const form = $('#pjForm'), msg = $('#pjMsg');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const all = P_FORM.flatMap(x => x[1]);
      const b = readForm(form, all.map(s => s[1] === 'pselect' || s[1] === 'color' ? [s[0], 'text'] : s)); delete b.data;
      const hv = {}; health.forEach(h => { hv[h.key] = { rag: (form.querySelector(`[name="hr_${h.key}"]:checked`) || {}).value || 'grey', note: form.querySelector(`[name="hn_${h.key}"]`).value.trim(), label: form.querySelector(`[name="hl_${h.key}"]`).value.trim() }; });
      b.health = hv;
      const g = n => form.querySelector(`[name="${n}"]`).value.trim();
      b.budget = { currency: g('b_currency') || 'SAR', total: g('b_total') || null, committed: g('b_committed') || null, vat: g('b_vat') || null, note: g('b_note') || null };
      b.facts = lines(g('facts')).map(l => { const [label, value, note, tone] = l.split('|').map(s => (s || '').trim()); return { label, value, note, tone }; });
      if (m.editor && form.querySelector('[name="editors"]')) b.editors = g('editors');
      if (!b.name) { msg.textContent = 'The project needs a name.'; msg.className = 'pj-msg bad'; return; }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true; msg.textContent = 'Saving…'; msg.className = 'pj-msg';
      try {
        if (isNew) { const r = await send('/api/projects', b); closeModal(); toast('Project created.'); S.d = null; go('p=' + encodeURIComponent(r.slug)); }
        else { const r = await send('/api/projects/' + encodeURIComponent(S.slug), b, 'PATCH'); closeModal(); toast('Saved.'); if (r.slug && r.slug !== S.slug) { S.slug = r.slug; go('p=' + encodeURIComponent(r.slug)); } else await reloadProject(); }
      } catch (err) { msg.textContent = err.message; msg.className = 'pj-msg bad'; btn.disabled = false; }
    });
    modalActs({ del: async () => { if (!(await askConfirm('Archive this project? It leaves the portfolio; the audit log keeps the trace.', 'Archive'))) return; try { await send('/api/projects/' + encodeURIComponent(S.slug), { delete: true }, 'PATCH'); closeModal(); toast('Archived.'); S.d = null; go(''); } catch (err) { msg.textContent = err.message; msg.className = 'pj-msg bad'; } } });
  }
  async function settingsModal() {
    let d; try { d = await api('/api/projects/settings'); } catch (e) { toast(e.message); return; }
    modal('Operations Projects — who can see and edit', `<form class="pj-form" id="pjForm" novalidate>
      <p class="pj-muted sm">Everyone who can open the VP dashboard reads this page. The people below get it on top of their own role.</p>
      <label class="pj-f wide"><span>Portfolio editors — create, edit and archive any project</span><textarea class="pj-in" name="editors" rows="3" placeholder="name@salam.sa, …">${esc(d.settings.editors.join(', '))}</textarea></label>
      <label class="pj-f wide"><span>Viewers — read and comment</span><textarea class="pj-in" name="viewers" rows="3" placeholder="name@salam.sa, …">${esc(d.settings.viewers.join(', '))}</textarea></label>
      <p class="pj-muted sm">Each project can also name its own editors (Edit project › Who can edit this project).</p>
      <div class="pj-mact"><span class="pj-msg" id="pjMsg"></span><button class="pj-btn" type="button" data-mact="close">Cancel</button><button class="pj-btn pri" type="submit">${svg(IC.check, 14)}<span>Save</span></button></div></form>`);
    const form = $('#pjForm'), msg = $('#pjMsg');
    form.addEventListener('submit', async e => { e.preventDefault(); try { await send('/api/projects/settings', { editors: form.editors.value, viewers: form.viewers.value }, 'PUT'); closeModal(); toast('Saved.'); await refresh(); } catch (err) { msg.textContent = err.message; msg.className = 'pj-msg bad'; } });
    modalActs({});
  }

  /* ---------- modal, confirm, toast ---------- */
  let MACTS = {};
  function modal(title, html, o) {
    let ov = $('#pjModal');
    if (!ov) { ov = document.createElement('div'); ov.id = 'pjModal'; ov.className = 'pj-mov'; document.body.appendChild(ov);
      ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(); });
      ov.addEventListener('click', e => { const b = e.target.closest('[data-mact]'); if (!b) return; const a = b.dataset.mact; if (a === 'close') closeModal(); else if (MACTS[a]) MACTS[a](); }); }
    ov.innerHTML = `<div class="pj-md${o && o.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="pj-mh"><h3>${esc(title)}</h3><button class="pj-x" type="button" data-mact="close" aria-label="Close">${svg(IC.x, 18)}</button></div><div class="pj-mb">${html}</div></div>`;
    MACTS = {}; document.documentElement.classList.add('pj-lock');
    requestAnimationFrame(() => ov.classList.add('open'));
  }
  const modalActs = a => { MACTS = a || {}; };
  function closeModal() { const ov = $('#pjModal'); if (ov) { ov.classList.remove('open'); ov.innerHTML = ''; } document.documentElement.classList.remove('pj-lock'); }
  const modalOpen = () => !!$('#pjModal.open');
  function askConfirm(text, yes) {
    return new Promise(res => {
      const el = document.createElement('div'); el.className = 'pj-cfm';
      el.innerHTML = `<div class="pj-cfb" role="alertdialog" aria-modal="true"><p>${esc(text)}</p><div><button class="pj-btn" type="button" data-c="0">Cancel</button><button class="pj-btn danger" type="button" data-c="1">${esc(yes || 'OK')}</button></div></div>`;
      document.body.appendChild(el); requestAnimationFrame(() => el.classList.add('open'));
      const done = v => { el.remove(); res(v); };
      el.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) done(b.dataset.c === '1'); else if (e.target === el) done(false); });
      setTimeout(() => { const b = el.querySelector('[data-c="1"]'); if (b) b.focus(); }, 30);
    });
  }
  function toast(msg) { let el = $('#pjToast'); if (!el) { el = document.createElement('div'); el.id = 'pjToast'; document.body.appendChild(el); } el.textContent = msg; el.className = 'show'; clearTimeout(el._t); el._t = setTimeout(() => { el.className = ''; }, 3200); }

  async function reloadProject(focusId) {
    if (!S.slug) return;
    const y = window.scrollY;
    try { await loadProject(S.slug); } catch (e) { toast(e.message); return; }
    S.d = null;                                                     // the portfolio re-reads on its next visit
    S.quiet = true; renderProject(); window.scrollTo(0, y);
    if (focusId) flash(focusId, false);
  }
  async function refresh(quiet) {
    try {
      if (S.slug) { const y = window.scrollY; await loadProject(S.slug); S.quiet = true; renderProject(); window.scrollTo(0, y); }
      else { const y = window.scrollY; await loadPortfolio(); S.quiet = true; renderPortfolio(); window.scrollTo(0, y); }
      if (!quiet) toast('Up to date.');
    } catch (e) { if (!quiet) toast(e.message); }
  }

  /* ================================================================== PRESENT — a deck built live from the page's own data */
  const DK = { slides: [], i: 0, x0: null };
  async function present(slug) {
    toast('Preparing the presentation…');
    try {
      const port = S.d || await loadPortfolio();
      const slugs = slug ? [slug] : port.projects.map(p => p.slug);
      const det = await Promise.all(slugs.map(s => api('/api/projects/' + encodeURIComponent(s))));
      DK.slides = buildSlides(port, det, !!slug);
    } catch (e) { toast(e.message); return; }
    openDeck();
  }
  const firstPara = t => String(t || '').split(/\n{2,}/)[0] || '';
  function sFacts(p, n) { return (p.facts || []).slice(0, n || 6).map(f => `<div class="pj-fact pj-t-${esc(f.tone || 'none')}"><span>${esc(f.label)}</span><b>${esc(f.value)}</b>${f.note ? `<em>${esc(f.note)}</em>` : ''}</div>`).join(''); }
  function projectSlides(d, t) {
    const p = d.project, it = d.items, st = p.stats, name = esc(p.name);
    const head = (sub) => `<div class="pj-s-head" style="--acc:${esc(p.accent || '#0e9f5a')}"><span class="pj-mono">${mono(p)}</span><div><span class="pj-s-kick">${esc(p.code || '')}${p.vendor ? ' · ' + esc(p.vendor) : ''}</span><h2>${name}</h2>${sub ? `<span class="pj-s-sub">${esc(sub)}</span>` : ''}</div>${ragPill(p.rag, true)}</div>`;
    const sevList = (list, n) => list.filter(x => x.open).sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.severity] ?? 4) - ({ critical: 0, high: 1, medium: 2, low: 3 }[b.severity] ?? 4)).slice(0, n)
      .map(x => `<li>${sevPill(x.severity)}<div><b>${esc(x.title)}</b>${x.owner ? `<em>${esc(x.owner)}</em>` : ''}</div></li>`).join('') || '<li class="pj-muted">None open.</li>';
    const ringVal = p.progress != null ? p.progress : p.elapsedPct;
    const dates = [['Start', p.startDate], [p.endDate ? 'Baseline end' : 'Planned go-live', p.baselineEnd], ['Target end', p.endDate], ['Go-live', p.goLive]].map(([l, k]) => `<div><span>${l}</span><b>${k ? esc(dFull(k)) : 'TBC'}</b></div>`).join('');
    const decs = (it.decision || []).filter(x => x.status === 'needed').sort((a, b) => (b.data.vp ? 1 : 0) - (a.data.vp ? 1 : 0));
    const lad = side => (it.escalation || []).filter(x => side === 'salam' ? (x.data.side || 'salam') === 'salam' : (x.data.side || 'salam') !== 'salam').sort((a, b) => (a.data.level || 1) - (b.data.level || 1))
      .map(x => `<li><i>L${x.data.level || 1}</i><div><b>${esc(x.title)}</b><em>${esc(x.data.role || '')}</em></div></li>`).join('') || '<li class="pj-muted">—</li>';
    const nextM = (it.meeting || []).filter(m => m.status === 'planned');
    const upcoming = (it.milestone || []).filter(m => m.open && m.status !== 'missed' && m.date && m.date >= t).sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 3);
    const und = (it.milestone || []).filter(m => m.open && !m.date);
    const b = p.budget || {}, cur = b.currency || 'SAR';
    return [
      { title: p.name, acc: p.accent, html: `${head(p.phase)}<div class="pj-s-sum"><div class="pj-s-ring">${ring(ringVal, { size: 168, stroke: 14, label: p.progress != null ? (p.progressVerified ? 'complete' : 'vendor-reported') : p.elapsedPct != null ? 'of the time used' : 'not reported', unverified: p.progress != null && !p.progressVerified })}<div class="pj-s-dates">${dates}</div></div>
        <div class="pj-s-brief">${para(firstPara(p.brief))}${p.slipDays ? `<div class="pj-s-slip">${svg(IC.clock, 16)}<b>${p.slipDays > 0 ? '+' : ''}${esc(dur(p.slipDays))}</b> against the baseline${p.baselineNo ? ` · baseline no. ${p.baselineNo}` : ''}</div>` : ''}</div></div>
        <div class="pj-s-facts">${sFacts(p, 6)}</div>` },
      { title: p.name + ' · health & issues', acc: p.accent, html: `${head('Health & issues')}<div class="pj-s-health">${p.health.map(h => `<div class="pj-s-h pj-s-h-${esc(h.rag)}"><div>${dot(h.rag)}<b>${esc(h.label)}</b><span>${esc(RAG[h.rag])}</span></div>${h.note ? `<p>${esc(h.note)}</p>` : ''}</div>`).join('')}</div>
        <div class="pj-s-2"><div><h3>${svg(IC.alert, 18)}Top bottlenecks <small>${st.bottlenecks.open} open</small></h3><ol class="pj-s-list">${sevList(it.bottleneck || [], 4)}</ol></div><div><h3>${svg(IC.target, 18)}Top gaps <small>${st.gaps.open} open</small></h3><ol class="pj-s-list">${sevList(it.gap || [], 4)}</ol></div></div>` },
      { title: p.name + ' · milestones', acc: p.accent, html: `${head('Milestones & next steps')}${msRoad(it.milestone || [], p, t)}
        <div class="pj-s-2"><div><h3>${svg(IC.flag, 18)}Coming next</h3><ol class="pj-s-list">${upcoming.map(m => `<li><span class="pj-s-dt">${esc(dShort(m.date, t))}</span><div><b>${esc(m.title)}</b><em>${esc(rel(m.daysTo))}</em></div></li>`).join('') || '<li class="pj-muted">Nothing dated ahead.</li>'}${und.slice(0, Math.max(0, 4 - upcoming.length)).map(m => `<li><span class="pj-s-dt tbc">TBC</span><div><b>${esc(m.title)}</b></div></li>`).join('')}</ol></div>
          <div><h3>${svg(IC.users, 18)}Governance</h3><ol class="pj-s-list">${nextM.map(m => `<li><span class="pj-s-dt">${m.date ? esc(dShort(m.date, t)) : 'TBC'}</span><div><b>${esc(m.title)}</b><em>${esc(MTYPE[m.data.type] || '')}${m.data.cadence ? ' · ' + esc(m.data.cadence) : ''}</em></div></li>`).join('') || '<li class="pj-muted">No meeting planned.</li>'}
            ${st.meetings.last ? `<li><span class="pj-s-dt">${esc(dShort(st.meetings.last.date, t))}</span><div><b>${esc(st.meetings.last.title)}</b><em>last meeting held</em></div></li>` : ''}</ol></div></div>` },
      { title: p.name + ' · decisions', acc: p.accent, html: `${head('Decisions, money & escalation')}<div class="pj-s-3">
          <div><h3>${svg(IC.gavel, 18)}Decisions needed</h3><ol class="pj-s-list">${decs.slice(0, 5).map(x => `<li>${x.data.vp ? '<i class="pj-vpb">VP</i>' : '<i class="pj-vpb mute">—</i>'}<div><b>${esc(x.title)}</b><em>${esc(x.owner || '')}</em></div></li>`).join('') || '<li class="pj-muted">No decision open.</li>'}</ol></div>
          <div><h3>${svg(IC.money, 18)}Money</h3><div class="pj-s-money"><div><span>Contract / budget</span><b>${b.total != null ? money(b.total, cur) : 'not provided'}</b></div><div class="${st.budget.onHold ? 'bad' : ''}"><span>On hold</span><b>${money(st.budget.onHold || 0, cur)}</b></div><div><span>Invoiced · paid</span><b>${money((st.budget.invoiced || 0) + (st.budget.onHold || 0) + (st.budget.paid || 0), cur)} · ${money(st.budget.paid || 0, cur)}</b></div>${st.budget.unpriced ? `<div><span>Cost lines without amount</span><b>${st.budget.unpriced}</b></div>` : ''}</div>${b.note ? `<p class="pj-s-note">${esc(b.note)}</p>` : ''}</div>
          <div><h3>${svg(IC.ladder, 18)}Escalation</h3><div class="pj-s-lad"><div><span>Salam</span><ol>${lad('salam')}</ol></div><div><span>Vendor</span><ol>${lad('vendor')}</ol></div></div></div></div>` }
    ];
  }
  function buildSlides(port, det, single) {
    const t = port.today, K = port.kpis, out = [];
    const oh = Object.entries(K.onHold || {}).filter(([, v]) => v > 0);
    if (!single) {
      out.push({ title: 'Operations Projects', cls: 'cover', html: `<div class="pj-s-cover"><div class="pj-s-kick">VP Operations · Portfolio review</div><h1>Operations Projects</h1><div class="pj-s-sub">${esc(F_WD.format(asDate(t)))}</div>
        <div class="pj-s-stats"><div><b>${K.active}</b><span>active projects</span></div><div class="vio"><b>${K.decisions.vp}</b><span>decisions for the VP</span></div><div class="bad"><b>${K.bottlenecks.critical}</b><span>critical bottlenecks</span></div>${oh.map(([c, v]) => `<div class="warn"><b>${esc(c)} ${moneyShort(v)}</b><span>on hold</span></div>`).join('')}</div></div>` });
      out.push({ title: 'At a glance', html: `<h2 class="pj-s-h2">At a glance</h2><table class="pj-s-tbl"><thead><tr><th>Project</th><th>Status</th><th>Phase</th><th>Target end</th><th>Next milestone</th><th>Top bottleneck</th><th>VP</th></tr></thead><tbody>${port.projects.map(p => `<tr style="--acc:${esc(p.accent || '#0e9f5a')}"><td><b>${esc(p.name)}</b><em>${esc(p.vendor || '')}</em></td><td>${ragPill(p.rag)}</td><td>${esc(p.phase || '')}</td><td>${p.endDate ? esc(dFull(p.endDate)) : 'TBC'}${p.slipDays ? `<em class="bad">+${esc(dur(p.slipDays))}</em>` : ''}</td><td>${p.stats.milestones.next ? `${esc(p.stats.milestones.next.title)}<em>${esc(rel(p.stats.milestones.next.daysTo))}</em>` : '—'}</td><td>${p.stats.bottlenecks.top[0] ? `${sevPill(p.stats.bottlenecks.top[0].severity)} ${esc(p.stats.bottlenecks.top[0].title)}` : '—'}</td><td><b>${p.stats.decisions.vp}</b></td></tr>`).join('')}</tbody></table>` });
      out.push({ title: 'Roadmap', html: `<h2 class="pj-s-h2">Roadmap</h2>${pRoadmap(port.projects, t)}` });
    }
    det.forEach(d => out.push(...projectSlides(d, t)));
    const asks = det.flatMap(d => (d.items.decision || []).filter(x => x.status === 'needed' && x.data.vp).map(x => ({ x, p: d.project })));
    if (asks.length) out.push({ title: 'Decisions requested', cls: 'asks', html: `<h2 class="pj-s-h2">Decisions requested</h2><ol class="pj-s-asks">${asks.map(({ x, p }, i) => `<li style="--acc:${esc(p.accent || '#0e9f5a')}"><span>${i + 1}</span><div><em>${esc(p.name)}</em><b>${esc(x.title)}</b>${x.body ? `<p>${esc(x.body)}</p>` : ''}<i>${esc(x.owner || '')}</i></div></li>`).join('')}</ol>` });
    return out;
  }
  function openDeck() {
    let el = $('#pjDeck'); if (el) el.remove();
    el = document.createElement('div'); el.id = 'pjDeck'; el.className = 'pj-deck'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Operations Projects presentation');
    el.innerHTML = `<div class="pj-dk-top"><span class="pj-dk-brand">${svg(IC.layers, 16)}Operations Projects</span><span class="pj-dk-t" id="pjDkT"></span><span class="pj-dk-n" id="pjDkN"></span>
        <button type="button" data-dk="fs" title="Full screen (F)" aria-label="Full screen">${svg(IC.expand, 16)}</button><button type="button" data-dk="close" title="Close (Esc)" aria-label="Close">${svg(IC.x, 18)}</button></div>
      <div class="pj-dk-stage">${DK.slides.map((s, i) => `<section class="pj-sl ${s.cls || ''}" data-i="${i}"><div class="pj-sl-in" style="--acc:${esc(s.acc || '#34d399')}">${s.html}</div></section>`).join('')}</div>
      <div class="pj-dk-bot"><button type="button" data-dk="prev" aria-label="Previous">${svg(IC.back, 20)}</button><div class="pj-dk-prog"><i id="pjDkP"></i></div><button type="button" data-dk="next" aria-label="Next">${svg(IC.go, 20)}</button></div>`;
    document.body.appendChild(el); document.documentElement.classList.add('pj-lock');
    el.addEventListener('click', e => { const b = e.target.closest('[data-dk]'); if (b) { const a = b.dataset.dk; if (a === 'close') closeDeck(); else if (a === 'next') slide(DK.i + 1); else if (a === 'prev') slide(DK.i - 1); else if (a === 'fs') fullscreen(); return; }
      if (e.target.closest('a,button,details')) return; });
    el.addEventListener('touchstart', e => { DK.x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => { if (DK.x0 == null) return; const dx = e.changedTouches[0].clientX - DK.x0; DK.x0 = null; if (Math.abs(dx) > 50) slide(DK.i + (dx < 0 ? 1 : -1)); }, { passive: true });
    DK.i = 0; requestAnimationFrame(() => { el.classList.add('open'); slide(0); });
  }
  function slide(i) {
    const el = $('#pjDeck'); if (!el) return; const n = DK.slides.length; DK.i = Math.max(0, Math.min(n - 1, i));
    $$('.pj-sl', el).forEach((s, k) => { s.classList.toggle('on', k === DK.i); s.classList.toggle('past', k < DK.i); });
    const cur = $$('.pj-sl', el)[DK.i]; if (cur) { centerRoads(cur); $$('.pj-ring', cur).forEach(r => { r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); }); $$('[data-count]', cur).forEach(countUp); const inn = cur.querySelector('.pj-sl-in'); if (inn) inn.scrollTop = 0; }
    $('#pjDkT').textContent = DK.slides[DK.i].title || ''; $('#pjDkN').textContent = `${DK.i + 1} / ${n}`; $('#pjDkP').style.width = ((DK.i + 1) / n * 100) + '%';
  }
  function fullscreen() { const el = $('#pjDeck'); if (!el) return; try { if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); } catch (e) { /* not allowed here */ } }
  function closeDeck() { const el = $('#pjDeck'); if (!el) return; try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ } el.remove(); if (!modalOpen()) document.documentElement.classList.remove('pj-lock'); }
  const deckOpen = () => !!$('#pjDeck');

  /* ================================================================== EFFECTS */
  let IO = null;
  function countUp(el) {
    if (el._done) return; el._done = true;
    const to = Number(el.dataset.count); if (!Number.isFinite(to) || reduced() || to === 0) { el.textContent = String(el.dataset.count); return; }
    const t0 = performance.now(), dur = 900;
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e).toLocaleString('en-US'); if (k < 1) requestAnimationFrame(step); };
    el.textContent = '0'; requestAnimationFrame(step);
  }
  function afterRender(host) {
    const els = $$('[data-rv]', host);
    if (IO) IO.disconnect();
    if (S.quiet) {                                   // a refresh or a save: draw the page as it was, without replaying the entrance
      S.quiet = false; host.classList.add('pj-noanim');
      els.forEach(e => e.classList.add('pj-on')); $$('[data-count]', host).forEach(e => { e._done = true; e.textContent = Number(e.dataset.count).toLocaleString('en-US'); }); $$('.pj-ring', host).forEach(r => r.classList.add('go'));
      requestAnimationFrame(() => requestAnimationFrame(() => host.classList.remove('pj-noanim')));
    }
    else if (reduced() || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('pj-on')); $$('[data-count]', host).forEach(e => { e.textContent = e.dataset.count; }); $$('.pj-ring', host).forEach(r => r.classList.add('go')); }
    else {
      IO = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; e.target.classList.add('pj-on'); $$('[data-count]', e.target).forEach(countUp); $$('.pj-ring', e.target).forEach(r => r.classList.add('go')); IO.unobserve(e.target); }), { rootMargin: '0px 0px -5% 0px', threshold: 0.04 });
      els.forEach(e => IO.observe(e));
      $$('[data-count]', host).forEach(e => { if (!e.closest('[data-rv]')) countUp(e); });
      requestAnimationFrame(() => requestAnimationFrame(() => $$('.pj-ring', host).forEach(r => { if (!r.closest('[data-rv]')) r.classList.add('go'); })));
    }
    centerRoads(host);
    if (S.focusItem) { const id = S.focusItem; S.focusItem = null; setTimeout(() => flash(id, true), 120); }
    else if (S.focusSec) { const k = S.focusSec; S.focusSec = null; setTimeout(() => toSec(k, false), 120); }
  }
  function centerRoads(root) {
    requestAnimationFrame(() => $$('.pj-road', root).forEach(r => { const inn = r.querySelector('.pj-road-in'); if (!inn || inn.scrollWidth <= r.clientWidth + 4) return;
      const tp = Number(inn.dataset.tp || 50); r.scrollLeft = Math.max(0, inn.scrollWidth * tp / 100 - r.clientWidth * 0.62); }));
  }
  const hdrH = () => { const h = document.querySelector('header'); return h ? h.getBoundingClientRect().height : 55; };
  const navH = () => { const n = $('.pj-secnav'); return n ? n.getBoundingClientRect().height : 0; };
  function scrollToEl(el, smooth) { if (!el) return; const y = el.getBoundingClientRect().top + window.scrollY - hdrH() - navH() - 12; window.scrollTo({ top: Math.max(0, y), behavior: smooth && !reduced() ? 'smooth' : 'auto' }); }
  function toSec(k, smooth) { const el = $('#pj-s-' + k); if (el) scrollToEl(el, smooth !== false); }
  function flash(id, scroll) {
    const el = $(`#view-opsprojects [data-item="${id}"]`); if (!el) return;
    const d = el.closest('details'); if (d) d.open = true;
    el.classList.add('pj-on'); if (scroll) scrollToEl(el, true);
    el.classList.remove('pj-flash'); void el.offsetWidth; el.classList.add('pj-flash'); setTimeout(() => el.classList.remove('pj-flash'), 2600);
  }
  let spyBound = false, spyRaf = 0;
  function spyMark() {
    spyRaf = 0;
    const nav = $('.pj-secnav'); if (!nav || !S.slug) return;
    const line = hdrH() + navH() + 90; let cur = SECS[0][0];
    for (const [k] of SECS) { const el = $('#pj-s-' + k); if (el && el.getBoundingClientRect().top <= line) cur = k; }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = SECS[SECS.length - 1][0];
    if (nav.dataset.cur === cur) return; nav.dataset.cur = cur;
    $$('button[data-sec]', nav).forEach(b => b.classList.toggle('on', b.dataset.sec === cur));
    const b = $(`button[data-sec="${cur}"]`, nav), barEl = $('.pj-snbar', nav), sc = nav.querySelector('.pj-snin');
    if (b && barEl) { barEl.style.width = b.offsetWidth + 'px'; barEl.style.transform = `translateX(${b.offsetLeft}px)`; }
    if (b && sc && (b.offsetLeft < sc.scrollLeft || b.offsetLeft + b.offsetWidth > sc.scrollLeft + sc.clientWidth)) sc.scrollTo({ left: Math.max(0, b.offsetLeft - 20), behavior: reduced() ? 'auto' : 'smooth' });
  }
  function spy() {
    if (!spyBound) { spyBound = true; const on = () => { if (S.open && S.slug && !spyRaf) spyRaf = requestAnimationFrame(spyMark); }; window.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on); }
    const nav = $('.pj-secnav'); if (nav) delete nav.dataset.cur;
    requestAnimationFrame(spyMark);
  }

  /* ================================================================== EVENTS */
  function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || !b.closest('#view-opsprojects')) return;
    const a = b.dataset.act;
    if (a === 'open') { e.preventDefault(); if (!S.slug) S.portY = window.scrollY; const q = 'p=' + encodeURIComponent(b.dataset.slug) + (b.dataset.i ? '&i=' + b.dataset.i : ''); if (S.slug === b.dataset.slug && b.dataset.i) { flash(Number(b.dataset.i), true); setUrl(q); } else go(q); return; }
    if (a === 'home') { go(''); return; }
    if (a === 'attn-all') { S.attnAll = !S.attnAll; const y = window.scrollY; S.quiet = true; renderPortfolio(); window.scrollTo(0, y); return; }
    if (a === 'scroll') { const el = document.getElementById(b.dataset.to); if (el) scrollToEl(el, true); return; }
    if (a === 'sec') { toSec(b.dataset.sec, true); setUrl('p=' + encodeURIComponent(S.slug) + '&s=' + b.dataset.sec); return; }
    if (a === 'present') { present(null); return; }
    if (a === 'present-one') { present(S.slug); return; }
    if (a === 'new-project') { projectModal(null); return; }
    if (a === 'edit-project') { projectModal(proj()); return; }
    if (a === 'settings') { settingsModal(); return; }
    if (a === 'refresh') { refresh(false); return; }
    if (a === 'print') { $$('#view-opsprojects [data-rv]').forEach(x => x.classList.add('pj-on')); $$('#view-opsprojects details').forEach(d => { d.open = true; }); setTimeout(() => window.print(), 80); return; }
    if (a === 'add') { itemModal(b.dataset.kind, null); return; }
    if (a === 'edit-item') { const id = Number(b.dataset.id); const it = Object.values((S.p && S.p.items) || {}).flat().find(x => x.id === id); if (it) itemModal(it.kind, it); return; }
    if (a === 'story') { S.story = b.dataset.topic; const y = window.scrollY; S.quiet = true; renderProject(); window.scrollTo(0, y); return; }
    if (a === 'sev') { S.filt.sev = b.dataset.sev; const y = window.scrollY; S.quiet = true; renderProject(); window.scrollTo(0, y); return; }
    if (a === 'comment') { postComment(b); return; }
    if (a === 'del-comment') { delComment(Number(b.dataset.id)); return; }
  }
  function onChange(e) {
    const t = e.target; if (!t.dataset || !t.closest('#view-opsprojects')) return;
    if (t.dataset.act === 'openonly') { S.filt.openOnly = t.checked; const y = window.scrollY; S.quiet = true; renderProject(); window.scrollTo(0, y); }
    if (t.dataset.act === 'showdone') { S.showDone = t.checked; const y = window.scrollY; S.quiet = true; renderProject(); window.scrollTo(0, y); }
  }
  function onKeyHost(e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('pj-card')) { e.preventDefault(); e.target.click(); } }
  function onKey(e) {
    if (deckOpen()) {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); slide(DK.i + 1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); slide(DK.i - 1); }
      else if (e.key === 'Home') slide(0); else if (e.key === 'End') slide(DK.slides.length - 1);
      else if (e.key === 'Escape') { if (!document.fullscreenElement) closeDeck(); }
      else if (e.key === 'f' || e.key === 'F') fullscreen();
      return;
    }
    if (e.key === 'Escape') { if ($('.pj-cfm')) return; if (modalOpen()) closeModal(); }
  }
  async function postComment(btn) {
    const ta = $('#pjCm'); const body = ta && ta.value.trim(); if (!body) { if (ta) ta.focus(); return; }
    btn.disabled = true;
    try { await send(`/api/projects/${encodeURIComponent(S.slug)}/items`, { kind: 'comment', body }); toast(me().isVp ? 'Posted — the owners see your VP badge.' : 'Posted.'); await reloadProject(); toSec('activity', false); }
    catch (err) { toast(err.message); btn.disabled = false; }
  }
  async function delComment(id) {
    if (!(await askConfirm('Delete this comment?', 'Delete'))) return;
    try { await send(`/api/projects/${encodeURIComponent(S.slug)}/items/${id}`, { delete: true }, 'PATCH'); toast('Deleted.'); await reloadProject(); } catch (err) { toast(err.message); }
  }

  /* ================================================================== ROUTE */
  function skeleton(host, what) {
    host.innerHTML = `<div class="pj-wrap"><section class="${what === 'project' ? 'pj-phero' : 'pj-hero'} pj-skel"><div class="pj-aur"></div><div class="pj-hero-l"><div class="pj-kick">VP Operations · ${what === 'project' ? 'Project' : 'Project portfolio'}</div><div class="pj-h1">Operations Projects</div><div class="pj-hsub">Loading…</div></div></section>
      <div class="pj-kpis">${Array.from({ length: 6 }, () => '<div class="pj-kpi pj-sk"><span class="pj-kl">…</span><span class="pj-kv">…</span></div>').join('')}</div></div>`;
  }
  function errorView(host, e) {
    host.innerHTML = `<div class="pj-wrap"><div class="pj-err">${svg(IC.alert, 22)}<div><b>Operations Projects could not load.</b><p>${esc(e.message)}</p><button class="pj-btn" type="button" data-act="${S.slug ? 'home' : 'refresh'}">${S.slug ? 'Back to the portfolio' : 'Try again'}</button></div></div></div>`;
  }
  window.openOpsProjects = async function (qs) {
    const host = $('#view-opsprojects'); if (!host) return;
    ensureCss();
    $$('.navtab[data-view="opsprojects"]').forEach(b => b.classList.add('active'));
    if (window.navdropSync) window.navdropSync();
    if (!S.built) { S.built = true; host.addEventListener('click', onClick); host.addEventListener('change', onChange); host.addEventListener('keydown', onKeyHost); document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && S.open && !modalOpen() && !deckOpen() && !($('#pjCm') && $('#pjCm').value)) refresh(true); }); }
    S.open = true;
    qs = qs || '';
    if (qs) setUrl(qs);                                   // a cold deep link: the navtab click rewrote the hash to #projects
    if (S.busy && S.busyQs === qs) return S.busy;          // the router calls twice for a cold deep link
    if (S.shownQs === qs && Date.now() - S.shownAt < 2500) return;
    const q = parseQs(qs), slug = q.p ? q.p.toLowerCase() : null;
    S.focusItem = q.i ? Number(q.i) : null; S.focusSec = q.s || null;
    S.busyQs = qs;
    S.busy = (async () => {
      try {
        if (slug) {
          const same = S.slug === slug && S.p;
          if (!same) { S.slug = slug; S.story = 'all'; S.filt = { sev: 'all', openOnly: true }; S.showDone = false; skeleton(host, 'project'); }
          await loadProject(slug); if (same) S.quiet = true; renderProject(); if (!same && !S.focusItem && !S.focusSec) window.scrollTo(0, 0);
        } else {
          const back = !!S.slug; S.slug = null; S.p = null;
          if (!S.d) skeleton(host, 'portfolio');
          await loadPortfolio(); renderPortfolio();
          if (back && S.portY != null) window.scrollTo(0, S.portY); else if (!back) window.scrollTo(0, 0);
        }
        S.shownQs = qs; S.shownAt = Date.now();
        if (q.present === '1') present(slug);
      } catch (e) { errorView(host, e); }
      finally { S.busy = null; }
    })();
    clearInterval(S.timer); S.timer = setInterval(() => { if (S.open && !document.hidden && !modalOpen() && !deckOpen() && !($('#pjCm') && $('#pjCm').value)) refresh(true); }, 5 * 60e3);
    return S.busy;
  };
  window.addEventListener('hashchange', () => { if (!/^#projects(\?|$)/.test(location.hash || '')) { S.open = false; S.shownQs = null; clearInterval(S.timer); closeModal(); closeDeck(); } });

  /* ================================================================== LOOK */
  function ensureCss() {
    if ($('#pjCss')) return;
    const css = document.createElement('style'); css.id = 'pjCss';
    css.textContent = `
#view-opsprojects{padding:16px 18px 48px}
.pj-noanim *,.pj-noanim *::before,.pj-noanim *::after{transition:none!important}
.pj-wrap{max-width:1500px;margin:0 auto;color:var(--ink)}
html.pj-lock{overflow:hidden}
.pj-muted{color:var(--muted)}.pj-muted.sm,.pj-sub{font-size:12px;color:var(--muted);line-height:1.45}.pj-bad{color:var(--bad-fg)!important}.pj-nw{white-space:nowrap}.pj-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
/* ---------- reveal ---------- */
[data-rv]{opacity:0;transform:translateY(14px);transition:opacity .55s cubic-bezier(.2,.7,.2,1) var(--d,0ms),transform .55s cubic-bezier(.2,.7,.2,1) var(--d,0ms)}
[data-rv].pj-on{opacity:1;transform:none}
.pj-flash{animation:pjFlash 2.4s ease}
@keyframes pjFlash{0%,30%{box-shadow:0 0 0 3px color-mix(in srgb,var(--acc,var(--green)) 70%,transparent),0 0 30px color-mix(in srgb,var(--acc,var(--green)) 35%,transparent)}100%{box-shadow:0 0 0 0 transparent}}
/* ---------- heroes ---------- */
.pj-hero,.pj-phero{position:relative;overflow:hidden;isolation:isolate;display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;padding:30px 32px 28px;border-radius:24px;color:#eef4ff;
  background:linear-gradient(130deg,#070b1d 0%,#0e1a3f 42%,#0b3b33 100%);box-shadow:0 26px 50px -28px rgba(7,11,29,.75)}
.pj-phero{background:linear-gradient(130deg,#070b1d 0%,color-mix(in srgb,var(--acc) 38%,#0c1433) 55%,color-mix(in srgb,var(--acc) 62%,#06101f) 100%)}
[data-theme="dark"] .pj-hero,[data-theme="dark"] .pj-phero{border:1px solid rgba(148,163,184,.14)}
.pj-hero::after,.pj-phero::after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:32px 32px;-webkit-mask-image:linear-gradient(105deg,transparent 30%,#000 90%);mask-image:linear-gradient(105deg,transparent 30%,#000 90%)}
.pj-aur{position:absolute;inset:-40%;z-index:-2;pointer-events:none;filter:blur(40px);opacity:.85}
.pj-aur::before,.pj-aur::after{content:"";position:absolute;width:46%;height:46%;border-radius:50%}
.pj-aur::before{left:12%;top:18%;background:radial-gradient(circle,rgba(16,185,129,.55),transparent 65%);animation:pjAur1 18s ease-in-out infinite alternate}
.pj-aur::after{right:8%;bottom:14%;background:radial-gradient(circle,rgba(99,102,241,.55),transparent 65%);animation:pjAur2 22s ease-in-out infinite alternate}
.pj-phero .pj-aur::after{background:radial-gradient(circle,color-mix(in srgb,var(--acc) 75%,transparent),transparent 65%)}
@keyframes pjAur1{0%{transform:translate(0,0) scale(1)}100%{transform:translate(18%,12%) scale(1.25)}}
@keyframes pjAur2{0%{transform:translate(0,0) scale(1.1)}100%{transform:translate(-16%,-10%) scale(.9)}}
.pj-hero-l,.pj-ph-l{flex:1 1 460px;min-width:0}
.pj-kick{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#7ee2bf}
.pj-h1{margin:8px 0 4px;font-size:clamp(28px,3.4vw,44px);font-weight:800;letter-spacing:-.025em;line-height:1.05;color:#fff}
.pj-hsub{font-size:14px;color:rgba(238,244,255,.78);max-width:760px;line-height:1.5}
.pj-hdate{margin-top:6px;font-size:12.5px;color:rgba(238,244,255,.6)}
.pj-hchips{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.pj-hchip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;font:inherit;font-size:13px;font-weight:700;color:#eef4ff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);cursor:pointer;transition:background .15s,transform .15s}
.pj-hchip:hover{background:rgba(255,255,255,.16);transform:translateY(-1px)}.pj-hchip b{font-size:15px;font-variant-numeric:tabular-nums}
.pj-hchip.vio{border-color:rgba(167,139,250,.5);background:rgba(124,58,237,.22)}.pj-hchip.bad{border-color:rgba(248,113,113,.5);background:rgba(220,38,38,.2)}.pj-hchip.warn{border-color:rgba(251,191,36,.45);background:rgba(217,119,6,.18);cursor:default}
.pj-ragbar{display:inline-flex;width:64px;height:7px;border-radius:9px;overflow:hidden;gap:2px;background:rgba(255,255,255,.12)}.pj-ragbar i{display:block;height:100%}
.pj-hero-r{display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;gap:16px;flex:0 1 auto}
.pj-tools{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}
.pj-tool{display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:12.5px;font-weight:800;color:#eef4ff;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.18);border-radius:11px;padding:8px 13px;cursor:pointer;transition:background .15s,transform .15s}
.pj-tool:hover{background:rgba(255,255,255,.18)}.pj-tool.ic{padding:8px 9px}
.pj-tool.pri{background:linear-gradient(135deg,#34d399,#10b981);border-color:transparent;color:#032018;box-shadow:0 8px 22px -8px rgba(16,185,129,.7)}.pj-tool.pri:hover{transform:translateY(-1px);filter:brightness(1.05)}
.pj-next{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;max-width:380px;padding:12px 16px;border-radius:16px;font:inherit;color:#eef4ff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);cursor:pointer;transition:background .15s}
.pj-next:hover{background:rgba(255,255,255,.13)}.pj-next span{font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#7ee2bf}.pj-next b{font-size:15px;line-height:1.3}.pj-next em{font-style:normal;font-size:12px;color:rgba(238,244,255,.65)}
/* ---------- KPI tiles ---------- */
.pj-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;margin:18px 0 0}
.pj-kpi{position:relative;display:flex;flex-direction:column;gap:6px;min-width:0;text-align:left;padding:16px 16px 14px;border-radius:18px;background:var(--card);border:1px solid var(--line);color:var(--ink);font:inherit;cursor:pointer;overflow:hidden;transition:transform .18s,box-shadow .18s,border-color .18s}
.pj-kpi::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--kc,var(--line))}
.pj-kpi::after{content:"";position:absolute;right:-30px;top:-30px;width:110px;height:110px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--kc,var(--line)) 22%,transparent),transparent 70%);pointer-events:none}
.pj-kpi:hover{transform:translateY(-3px);box-shadow:var(--shadow);border-color:color-mix(in srgb,var(--kc,var(--green)) 45%,var(--line))}
.pj-kpi.t-info{--kc:var(--blue)}.pj-kpi.t-violet{--kc:var(--violet)}.pj-kpi.t-bad{--kc:var(--red)}.pj-kpi.t-warn{--kc:var(--amber)}.pj-kpi.t-good{--kc:var(--good)}
.pj-kl{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}.pj-kl svg{color:var(--kc)}
.pj-kv{font-size:32px;font-weight:800;letter-spacing:-.03em;line-height:1.05;font-variant-numeric:tabular-nums}.pj-kv .pj-kmoney{font-size:25px}
.pj-ks{font-size:12px;color:var(--ink-soft);line-height:1.4}.pj-ks em{font-style:normal;font-weight:700}.pj-ks .bad{color:var(--bad-fg)}.pj-ks .warn{color:var(--warn-fg)}
.pj-sk .pj-kl,.pj-sk .pj-kv{color:transparent;background:linear-gradient(90deg,var(--line-soft),var(--card2),var(--line-soft));background-size:200% 100%;border-radius:8px;animation:pjShim 1.2s infinite}
.pj-skel .pj-hsub{animation:pjPulse 1.2s infinite}
@keyframes pjShim{0%{background-position:100% 0}100%{background-position:-100% 0}}@keyframes pjPulse{50%{opacity:.4}}
/* ---------- sections ---------- */
.pj-sec{margin-top:26px}
.pj-sh{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:0 0 12px}
.pj-sh h2{display:flex;align-items:center;gap:9px;margin:0;font-size:19px;font-weight:800;letter-spacing:-.01em}.pj-sh h2 svg{color:var(--acc,var(--green))}
.pj-sh h3{display:flex;align-items:center;gap:8px;margin:0;font-size:15.5px;font-weight:800}.pj-sh h3 svg{color:var(--acc,var(--green))}
.pj-sh2{margin-top:26px}
.pj-shs{font-size:12.5px;color:var(--muted)}
.pj-sh>.pj-add,.pj-sh>.pj-chk{margin-left:auto}.pj-sh>.pj-chk+.pj-add{margin-left:8px}
.pj-add{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;font-weight:800;color:var(--acc,var(--green));background:color-mix(in srgb,var(--acc,var(--green)) 9%,var(--card));border:1px dashed color-mix(in srgb,var(--acc,var(--green)) 55%,var(--line));border-radius:10px;padding:6px 11px;cursor:pointer;transition:background .15s}
.pj-add:hover{background:color-mix(in srgb,var(--acc,var(--green)) 16%,var(--card))}.pj-add span:empty{display:none}
.pj-empty{padding:18px;border:1px dashed var(--line);border-radius:14px;color:var(--muted);font-size:13px;text-align:center;background:var(--card)}.pj-empty.sm{padding:12px;font-size:12px}
.pj-foot{margin-top:28px;font-size:11.5px;color:var(--muted);text-align:center;line-height:1.5}
.pj-cols2{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:18px}
.pj-cols2>.pj-sec{margin-top:26px}
/* attention */
.pj-atl{display:flex;flex-direction:column;gap:9px}.pj-atl:not(.all)>.pj-at:nth-child(n+7){display:none}
.pj-more{display:block;margin:10px auto 0;font:inherit;font-size:12.5px;font-weight:800;color:var(--ink-soft);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 16px;cursor:pointer}.pj-more:hover{border-color:var(--green);color:var(--ink)}
.pj-at{position:relative;display:flex;align-items:center;gap:13px;width:100%;text-align:left;padding:12px 14px 12px 16px;border-radius:15px;background:var(--card);border:1px solid var(--line);font:inherit;color:var(--ink);cursor:pointer;overflow:hidden;transition:transform .15s,box-shadow .15s,border-color .15s}
.pj-at::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--ac)}
.pj-at:hover{transform:translateX(3px);box-shadow:var(--shadow);border-color:color-mix(in srgb,var(--ac) 40%,var(--line))}
.pj-at-bottleneck{--ac:var(--red)}.pj-at-decision{--ac:var(--violet)}.pj-at-milestone{--ac:var(--amber)}
.pj-at-ic{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:11px;color:var(--ac);background:color-mix(in srgb,var(--ac) 13%,var(--card))}
.pj-at-b{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}.pj-at-b b{font-size:13.5px;line-height:1.35}.pj-at-b em{font-style:normal;font-size:12px;color:var(--muted)}
.pj-at-k{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ac)}
.pj-chip-p{font-style:normal;letter-spacing:0;text-transform:none;font-weight:700;font-size:11px;color:var(--ink-soft);padding:1px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--acc) 45%,var(--line));background:color-mix(in srgb,var(--acc) 8%,var(--card))}
.pj-go{flex:none;color:var(--muted);transition:transform .15s}.pj-at:hover .pj-go{transform:translateX(3px);color:var(--ink)}
/* feed */
.pj-fl{list-style:none;margin:0;padding:4px 0 0 14px;position:relative;display:flex;flex-direction:column;gap:2px}
.pj-fl::before{content:"";position:absolute;left:14px;top:10px;bottom:10px;width:2px;background:linear-gradient(var(--line),transparent)}
.pj-fl li>button{position:relative;display:flex;gap:11px;width:100%;text-align:left;padding:8px 10px 8px 22px;border-radius:12px;background:none;border:0;font:inherit;color:var(--ink);cursor:pointer}
.pj-fl li>button:hover{background:var(--card)}
.pj-fi{position:absolute;left:-12px;top:9px;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--card);border:2px solid var(--acc);color:var(--acc)}
.pj-fb{display:flex;flex-direction:column;gap:1px;min-width:0}.pj-fb b{font-size:13px;line-height:1.35}.pj-fb em{font-style:normal;font-size:11.5px;color:var(--muted)}
.pj-fk{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
/* pills */
.pj-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;padding:2px 9px;border-radius:999px;white-space:nowrap;line-height:1.5}
.pj-t-good{background:var(--tint-green);color:var(--tint-green-fg)}.pj-t-warn{background:var(--tint-amber);color:var(--tint-amber-fg)}.pj-t-bad{background:var(--tint-red);color:var(--tint-red-fg)}
.pj-t-info{background:var(--tint-blue);color:var(--tint-blue-fg)}.pj-t-muted{background:var(--line-soft);color:var(--muted)}.pj-t-violet{background:var(--tint-violet);color:var(--tint-violet-fg)}
.pj-pill.inv{background:rgba(255,255,255,.12);color:#eef4ff;border:1px solid rgba(255,255,255,.18)}
.pj-rag{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;padding:3px 10px 3px 8px;border-radius:999px;white-space:nowrap;background:var(--rb);color:var(--rf);border:1px solid color-mix(in srgb,var(--rc) 35%,transparent)}
.pj-rag i{width:8px;height:8px;border-radius:50%;background:var(--rc);box-shadow:0 0 0 3px color-mix(in srgb,var(--rc) 22%,transparent)}
.pj-rag.big{font-size:13px;padding:6px 14px 6px 11px}.pj-rag.big i{width:10px;height:10px}
.pj-rag-green{--rc:var(--good);--rb:var(--tint-green);--rf:var(--tint-green-fg)}.pj-rag-amber{--rc:var(--amber);--rb:var(--tint-amber);--rf:var(--tint-amber-fg)}.pj-rag-red{--rc:var(--red);--rb:var(--tint-red);--rf:var(--tint-red-fg)}.pj-rag-grey{--rc:var(--muted);--rb:var(--line-soft);--rf:var(--muted)}
.pj-rag-red i{animation:pjBeat 1.8s infinite}
@keyframes pjBeat{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--rc) 60%,transparent)}70%{box-shadow:0 0 0 8px transparent}100%{box-shadow:0 0 0 0 transparent}}
.pj-dot{display:inline-block;flex:none;width:9px;height:9px;border-radius:50%;background:var(--muted);vertical-align:middle}
.pj-d-green{background:var(--good)}.pj-d-amber{background:var(--amber)}.pj-d-red{background:var(--red)}.pj-d-grey{background:var(--muted)}
.pj-sev{display:inline-flex;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:7px;color:#fff;white-space:nowrap;letter-spacing:.02em}
.pj-sev-critical{background:linear-gradient(135deg,#ef4444,#b91c1c)}.pj-sev-high{background:var(--orange)}.pj-sev-medium{background:var(--amber)}.pj-sev-low{background:var(--muted)}
.pj-vpb{display:inline-flex;font-style:normal;font-size:10px;font-weight:800;letter-spacing:.06em;padding:1px 7px;border-radius:6px;color:#fff;background:linear-gradient(135deg,#8b5cf6,#6d28d9);text-transform:uppercase}.pj-vpb.mute{background:var(--line-soft);color:var(--muted)}
.pj-ref{font-size:11px;font-family:var(--mono);color:var(--muted);padding:1px 7px;border-radius:6px;border:1px solid var(--line);white-space:nowrap}
.pj-code{font-size:11px;font-weight:800;letter-spacing:.08em;padding:3px 9px;border-radius:7px;color:#071226;background:#fff}
/* ---------- cards ---------- */
.pj-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,560px),1fr));gap:18px}
.pj-card{position:relative;display:flex;flex-direction:column;gap:14px;padding:20px 20px 16px;border-radius:22px;background:var(--card);border:1px solid var(--line);cursor:pointer;overflow:hidden;transition:transform .2s,box-shadow .2s,border-color .2s;outline:none}
.pj-card::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,var(--acc),color-mix(in srgb,var(--acc) 30%,transparent))}
.pj-cglow{position:absolute;inset:-1px;pointer-events:none;opacity:0;transition:opacity .25s;background:radial-gradient(600px 220px at 85% -10%,color-mix(in srgb,var(--acc) 16%,transparent),transparent 70%)}
.pj-card:hover,.pj-card:focus-visible{transform:translateY(-4px);box-shadow:0 22px 44px -22px color-mix(in srgb,var(--acc) 55%,rgba(15,23,42,.4));border-color:color-mix(in srgb,var(--acc) 45%,var(--line))}
.pj-card:hover .pj-cglow,.pj-card:focus-visible .pj-cglow{opacity:1}
.pj-ctop{position:relative;display:flex;align-items:center;gap:13px}
.pj-mono{flex:none;display:grid;place-items:center;width:48px;height:48px;border-radius:15px;font-size:15px;font-weight:800;letter-spacing:.02em;color:#fff;background:linear-gradient(135deg,var(--acc),color-mix(in srgb,var(--acc) 55%,#0b1026));box-shadow:0 10px 22px -10px var(--acc)}
.pj-cid{flex:1;min-width:0}.pj-cid h3{margin:0;font-size:17.5px;font-weight:800;letter-spacing:-.01em;line-height:1.25}.pj-cid span{display:block;margin-top:2px;font-size:12.5px;color:var(--muted)}
.pj-cmid{position:relative;display:flex;align-items:center;gap:20px}
.pj-cdates{flex:1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.pj-cdates div{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:13px;background:var(--card2);border:1px solid var(--line-soft);min-width:0}
.pj-cdates span{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.pj-cdates b{font-size:13.5px;white-space:nowrap}.pj-cdates em{font-style:normal;font-size:11.5px;color:var(--muted)}
.pj-cdates em.bad,.pj-hd2 em.bad,.pj-s-tbl em.bad{color:var(--bad-fg);font-weight:700}.pj-cdates em.good{color:var(--good)}
.pj-cphase{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ink-soft);line-height:1.4}.pj-cphase span:last-child{min-width:0}
.pj-chealth{display:flex;flex-wrap:wrap;gap:6px 14px}.pj-hd{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--ink-soft)}
.pj-cissues{display:flex;flex-direction:column;gap:7px;padding:11px 12px;border-radius:13px;background:color-mix(in srgb,var(--red) 4%,var(--card2));border:1px solid var(--line-soft)}
.pj-cissues div{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;line-height:1.4}.pj-cissues .pj-sev{margin-top:1px}
.pj-cfoot{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding-top:12px;border-top:1px dashed var(--line);font-size:12px;color:var(--ink-soft)}
.pj-cfoot span{display:inline-flex;align-items:center;gap:6px}.pj-cfoot svg{color:var(--muted)}.pj-cfoot .bad{color:var(--bad-fg)}.pj-cfoot .bad svg{color:var(--bad-fg)}
.pj-copen{margin-left:auto;font-weight:800;color:var(--acc)!important}.pj-copen svg{color:var(--acc)!important;transition:transform .15s}.pj-card:hover .pj-copen svg{transform:translateX(3px)}
/* ring */
.pj-ring{position:relative;flex:none;width:var(--sz);height:var(--sz)}
.pj-ring svg{display:block}.pj-ring .bg{fill:none;stroke:var(--line-soft)}
.pj-ring .fg{fill:none;stroke:var(--acc,var(--green));stroke-linecap:round;stroke-dashoffset:var(--c);transition:stroke-dashoffset 1.3s cubic-bezier(.2,.7,.2,1) .15s}
.pj-ring.go .fg{stroke-dashoffset:var(--off)}
.pj-ring.unv .fg{stroke:color-mix(in srgb,var(--acc,var(--green)) 70%,var(--amber))}
.pj-ring.unv .bg{stroke-dasharray:3 4}
.pj-ring-v{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;line-height:1}
.pj-ring-v b{font-size:calc(var(--sz) * .27);font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.pj-ring-v small{font-size:calc(var(--sz) * .12);font-weight:800;color:var(--muted);margin-left:1px;display:inline}
.pj-ring-v>b+small{position:relative;top:calc(var(--sz) * -.02)}
.pj-ring-v em{display:block;margin-top:4px;font-style:normal;font-size:calc(var(--sz) * .085);font-weight:700;color:var(--muted);max-width:80%;line-height:1.15}
.pj-ring-v{flex-direction:row;flex-wrap:wrap;align-content:center}.pj-ring-v em{flex-basis:100%;margin-left:auto;margin-right:auto}
.pj-phero .pj-ring .bg,.pj-deck .pj-ring .bg{stroke:rgba(255,255,255,.14)}.pj-phero .pj-ring .fg,.pj-deck .pj-ring .fg{stroke:#fff}.pj-phero .pj-ring.unv .fg,.pj-deck .pj-ring.unv .fg{stroke:#fcd34d}
.pj-phero .pj-ring-v em,.pj-phero .pj-ring-v small,.pj-deck .pj-ring-v em,.pj-deck .pj-ring-v small{color:rgba(238,244,255,.7)}
/* bars */
.pj-bar{position:relative;display:block;flex:1;height:10px;border-radius:99px;background:var(--line-soft);overflow:hidden}
.pj-bar i{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:99px;transition:width 1.1s cubic-bezier(.2,.7,.2,1) .1s}
.pj-on .pj-bar i,.pj-bar.go i{width:var(--w)}
.pj-bar i.pj-t-good{background:linear-gradient(90deg,#22c55e,#16a34a)}.pj-bar i.pj-t-info{background:linear-gradient(90deg,#60a5fa,#2563eb)}.pj-bar i.pj-t-warn{background:linear-gradient(90deg,#fbbf24,#d97706)}.pj-bar i.pj-t-bad{background:linear-gradient(90deg,#f87171,#dc2626)}
.pj-bar.unv i::after{content:"";position:absolute;inset:0;border-radius:inherit;background:repeating-linear-gradient(135deg,rgba(255,255,255,.42) 0 5px,transparent 5px 10px)}
/* ---------- roadmap (gantt) ---------- */
.pj-gantt{overflow-x:auto;border-radius:20px;background:var(--card);border:1px solid var(--line);padding:6px 0 10px;-webkit-overflow-scrolling:touch}
.pj-gin{position:relative}
.pj-gh,.pj-gr,.pj-ggrid{display:flex}
.pj-gn0,.pj-gn{flex:none;width:190px}
.pj-gt{position:relative;flex:1;margin-right:18px}
.pj-gh{height:38px;border-bottom:1px solid var(--line-soft)}
.pj-gm{position:absolute;top:11px;font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap;transform:translateX(4px)}.pj-gm b{margin-left:4px;color:var(--ink)}.pj-gm.yr{color:var(--ink)}
.pj-gbody{position:relative;padding:6px 0}
.pj-ggrid{position:absolute;inset:0;pointer-events:none}
.pj-gl{position:absolute;top:0;bottom:0;width:1px;background:var(--line-soft)}.pj-gl.yr{background:var(--line)}
.pj-gtoday{position:absolute;top:0;bottom:0;width:2px;background:linear-gradient(var(--green),color-mix(in srgb,var(--green) 25%,transparent));z-index:3}
.pj-gtoday span{position:absolute;top:-8px;left:50%;transform:translate(-50%,-50%);font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--green);padding:2px 7px;border-radius:999px;white-space:nowrap}
.pj-gtoday::after{content:"";position:absolute;bottom:-4px;left:-4px;width:10px;height:10px;border-radius:50%;background:var(--green);animation:pjBeat 2s infinite;--rc:var(--green)}
.pj-gr{position:relative;height:64px;align-items:center}
.pj-gn{display:flex;align-items:center;gap:10px;height:100%;padding:0 12px 0 16px;background:none;border:0;font:inherit;color:var(--ink);text-align:left;cursor:pointer;position:sticky;left:0;z-index:4;background:linear-gradient(90deg,var(--card) 85%,transparent)}
.pj-gn span{display:flex;flex-direction:column;min-width:0}.pj-gn b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pj-gn em{font-style:normal;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pj-gr .pj-gt{height:100%}
.pj-gb{position:absolute;top:18px;height:28px;border-radius:9px;overflow:hidden;transform-origin:left center;transform:scaleX(0);transition:transform 1s cubic-bezier(.2,.7,.2,1) calc(var(--d,0ms) + 150ms);background:linear-gradient(90deg,color-mix(in srgb,var(--acc) 85%,#fff),var(--acc));box-shadow:0 6px 16px -8px var(--acc)}
.pj-on .pj-gb,.pj-deck .pj-gb{transform:scaleX(1)}
.pj-gend{position:absolute;top:23px;margin-left:9px;font-size:11px;font-weight:800;color:var(--ink-soft);white-space:nowrap;z-index:1}
.pj-gb.tbc{border-top-right-radius:0;border-bottom-right-radius:0;-webkit-mask-image:linear-gradient(90deg,#000 80%,rgba(0,0,0,.35));mask-image:linear-gradient(90deg,#000 80%,rgba(0,0,0,.35))}
.pj-gp{position:absolute;left:0;bottom:0;height:5px;width:var(--w);background:rgba(255,255,255,.92);border-radius:0 3px 3px 0}
.pj-gp.unv{background:repeating-linear-gradient(90deg,rgba(255,255,255,.95) 0 7px,transparent 7px 11px)}
.pj-gtbc{position:absolute;top:18px;height:28px;width:70px;border:2px dashed color-mix(in srgb,var(--acc) 60%,var(--line));border-left:0;border-radius:0 9px 9px 0}
.pj-gtbc span{position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:800;color:var(--muted);white-space:nowrap}
.pj-gbase{position:absolute;top:8px;bottom:8px;width:0;border-left:2px dashed var(--muted);z-index:2}
.pj-gbase span{position:absolute;top:-4px;left:5px;font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.pj-gslip{position:absolute;top:47px;height:4px;border-radius:4px;background:repeating-linear-gradient(90deg,var(--red) 0 6px,transparent 6px 10px);opacity:.75}
.pj-gd{position:absolute;top:24px;width:16px;height:16px;margin-left:-8px;padding:0;border:0;background:none;cursor:pointer;z-index:5}
.pj-gd::before{content:"";position:absolute;inset:2px;transform:rotate(45deg);border-radius:3px;border:2px solid #fff;background:var(--card);box-shadow:0 2px 6px rgba(15,23,42,.35)}
.pj-gd.done::before{background:var(--good)}.pj-gd.bad::before{background:var(--red)}.pj-gd.warn::before{background:var(--amber)}.pj-gd.plan::before{background:#fff;border-color:var(--acc)}
.pj-gd.gate{transform:scale(1.25)}
.pj-gd:hover::before{transform:rotate(45deg) scale(1.25)}
.pj-tip{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translate(-50%,4px);min-width:170px;max-width:260px;padding:8px 10px;border-radius:10px;background:var(--tip-bg);color:var(--tip-fg);font-size:11.5px;line-height:1.4;text-align:left;box-shadow:var(--shadow);opacity:0;pointer-events:none;transition:opacity .15s,transform .15s;z-index:20;white-space:normal}
.pj-tip b{display:block;font-size:12px;margin-bottom:2px}
.pj-gd:hover .pj-tip,.pj-gd:focus-visible .pj-tip{opacity:1;transform:translate(-50%,0)}
/* ---------- project page ---------- */
.pj-crumbs{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 12px}
.pj-back{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:800;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:11px;padding:7px 12px;cursor:pointer}.pj-back:hover{border-color:var(--green)}
.pj-switch{display:flex;gap:6px;flex-wrap:wrap;min-width:0}
.pj-switch button{display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:12.5px;font-weight:700;color:var(--ink-soft);background:var(--card2);border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pj-switch button span{min-width:0;overflow:hidden;text-overflow:ellipsis}.pj-switch button .pj-dot{flex:none}
.pj-switch button.on{color:var(--ink);border-color:color-mix(in srgb,var(--acc) 60%,var(--line));background:color-mix(in srgb,var(--acc) 10%,var(--card))}
.pj-ph-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pj-phase2{display:inline-flex;align-items:flex-start;gap:8px;margin-top:12px;padding:8px 12px;border-radius:12px;font-size:13px;font-weight:700;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16)}.pj-phase2 svg{flex:none;margin-top:2px;color:#7ee2bf}
.pj-people{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:14px}
.pj-person{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:9px;padding:9px 12px;border-radius:13px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}
.pj-person svg{grid-row:1 / 3;align-self:center;color:#7ee2bf}.pj-person span{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(238,244,255,.6)}.pj-person b{font-size:12.5px;line-height:1.35;color:#fff;font-weight:700}
.pj-ph-r{display:flex;flex-direction:column;gap:14px;flex:0 1 520px;min-width:0}
.pj-ph-top{display:flex;align-items:center;gap:18px}
.pj-ph-rag{display:flex;flex-direction:column;align-items:flex-start;gap:12px}
.pj-phero .pj-rag{background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.22)}
.pj-hdates{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.pj-hd2{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:13px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);min-width:0}
.pj-hd2 span{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(238,244,255,.6)}.pj-hd2 b{font-size:13.5px;color:#fff;white-space:nowrap}.pj-hd2 em{font-style:normal;font-size:11px;color:rgba(238,244,255,.7)}
.pj-hd2.tbc b{color:rgba(238,244,255,.55)}.pj-hd2 em.bad{color:#fca5a5}.pj-hd2 em.good{color:#86efac}
.pj-basis{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.45;color:rgba(238,244,255,.78);padding:9px 12px;border-radius:12px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.25)}.pj-basis svg{flex:none;margin-top:2px;color:#fcd34d}
/* section bar */
.pj-secnav{position:sticky;top:var(--hdr,55px);z-index:30;margin:16px -18px 0;padding:8px 18px;background:color-mix(in srgb,var(--bg) 82%,transparent);-webkit-backdrop-filter:saturate(1.4) blur(12px);backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid var(--line)}
.pj-snin{position:relative;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding-bottom:6px}.pj-snin::-webkit-scrollbar{display:none}
.pj-snin button{flex:none;display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:800;color:var(--muted);background:none;border:0;border-radius:10px;padding:8px 12px;cursor:pointer;transition:color .15s,background .15s}
.pj-snin button:hover{color:var(--ink);background:var(--card)}.pj-snin button.on{color:var(--ink)}
.pj-snin button i{font-style:normal;font-size:10.5px;font-weight:800;min-width:18px;padding:1px 6px;border-radius:999px;background:var(--line-soft);color:var(--muted);text-align:center}
.pj-snin button.on i{background:color-mix(in srgb,var(--acc) 18%,var(--card));color:var(--ink)}
.pj-snbar{position:absolute;left:0;bottom:2px;height:3px;width:0;border-radius:3px;background:var(--acc);transition:transform .3s cubic-bezier(.2,.7,.2,1),width .3s}
.pj-secs>.pj-sec{scroll-margin-top:calc(var(--hdr,55px) + 70px)}
/* boxes */
.pj-box{padding:18px 18px 16px;border-radius:20px;background:var(--card);border:1px solid var(--line);min-width:0}
.pj-bh{display:flex;align-items:center;gap:8px;margin-bottom:10px}.pj-bh h3{display:flex;align-items:center;gap:8px;margin:0;font-size:15px;font-weight:800;flex:1}.pj-bh h3 svg{color:var(--acc,var(--green))}
.pj-lnk{font:inherit;font-size:12px;font-weight:800;color:var(--acc,var(--green));background:none;border:0;cursor:pointer;padding:3px 6px;border-radius:7px}.pj-lnk:hover{background:var(--line-soft)}
.pj-facts{display:grid;grid-template-columns:repeat(var(--fcols,4),minmax(0,1fr));gap:12px;margin-bottom:16px}
.pj-fact{position:relative;display:flex;flex-direction:column;gap:3px;padding:14px 14px 12px;border-radius:16px;background:var(--card);border:1px solid var(--line);overflow:hidden}
.pj-fact::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--fc,var(--acc,var(--green)))}
.pj-fact.pj-t-bad{--fc:var(--red)}.pj-fact.pj-t-warn{--fc:var(--amber)}.pj-fact.pj-t-good{--fc:var(--good)}
.pj-fact,.pj-fact.pj-t-bad,.pj-fact.pj-t-warn,.pj-fact.pj-t-good,.pj-fact.pj-t-none{background:var(--card);color:var(--ink)}
.pj-fact span{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.pj-fact b{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.15}.pj-fact em{font-style:normal;font-size:11.5px;color:var(--muted);line-height:1.35}
.pj-fact.pj-t-bad b{color:var(--bad-fg)}.pj-fact.pj-t-warn b{color:var(--warn-fg)}
.pj-ovg{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) minmax(0,.95fr);gap:16px;align-items:start}
.pj-prose p{margin:0 0 10px;font-size:14px;line-height:1.65;color:var(--ink-soft)}.pj-prose p:first-child{font-size:15px;color:var(--ink);font-weight:500}.pj-prose.sm p{font-size:13px}
.pj-brief h4{margin:14px 0 6px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.pj-obj{margin:0;font-size:13.5px;line-height:1.55}
.pj-scope{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px}.pj-scope li{position:relative;padding-left:18px;font-size:13px;line-height:1.5;color:var(--ink-soft)}
.pj-scope li::before{content:"";position:absolute;left:3px;top:8px;width:7px;height:7px;border-radius:2px;transform:rotate(45deg);background:var(--acc,var(--green))}
.pj-radar{display:block;width:100%;max-width:360px;margin:0 auto 6px}
.pj-radar .rg{fill:none;stroke:var(--line)}.pj-radar .ax{stroke:var(--line-soft)}
.pj-radar .ar{fill:color-mix(in srgb,var(--acc,var(--green)) 22%,transparent);stroke:var(--acc,var(--green));stroke-width:2;stroke-linejoin:round}
.pj-radar text{font-size:12px;font-weight:700;fill:var(--ink-soft)}
.pj-rd-green{fill:var(--good)}.pj-rd-amber{fill:var(--amber)}.pj-rd-red{fill:var(--red)}.pj-rd-grey{fill:var(--muted)}
.pj-hl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.pj-hl li{padding:8px 10px;border-radius:11px;background:var(--card2);border:1px solid var(--line-soft)}
.pj-hl li>div{display:flex;align-items:center;gap:8px}.pj-hl b{font-size:13px;flex:1}.pj-hl span{font-size:11px;font-weight:800;color:var(--muted)}
.pj-hl-red span{color:var(--bad-fg)}.pj-hl-amber span{color:var(--warn-fg)}.pj-hl-green span{color:var(--good)}
.pj-hl p{margin:5px 0 0;font-size:12px;line-height:1.45;color:var(--ink-soft)}
.pj-ovside{display:flex;flex-direction:column;gap:16px;min-width:0}
.pj-dl{margin:0;padding:0 0 0 2px;list-style:none;counter-reset:d;display:flex;flex-direction:column;gap:10px}
.pj-dl li{counter-increment:d;position:relative;padding-left:30px}.pj-dl li::before{content:counter(d);position:absolute;left:0;top:0;display:grid;place-items:center;width:21px;height:21px;border-radius:7px;font-size:11px;font-weight:800;color:#fff;background:linear-gradient(135deg,#8b5cf6,#6d28d9)}
.pj-dl b{display:block;font-size:13px;line-height:1.4}.pj-dl em{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:3px;font-style:normal;font-size:11.5px;color:var(--muted)}
.pj-lu-h{display:flex;align-items:flex-start;gap:8px;font-size:14px}.pj-lu-h .pj-dot{margin-top:6px}.pj-lu-d{margin:3px 0 8px;font-size:11.5px;color:var(--muted)}
/* milestone road */
.pj-road{overflow-x:auto;border-radius:20px;background:var(--card);border:1px solid var(--line);-webkit-overflow-scrolling:touch}
.pj-road-in{position:relative;height:250px}
.pj-road-line{position:absolute;left:0;right:0;top:50%;height:4px;margin-top:-2px;background:var(--line-soft)}
.pj-road-yr{position:absolute;top:50%;width:0;height:0}.pj-road-yr span{position:absolute;left:0;top:10px;transform:translateX(-50%);font-size:10.5px;font-weight:800;letter-spacing:.06em;color:var(--muted);padding:1px 7px;border-radius:999px;border:1px solid var(--line);background:var(--card)}
.pj-road-yr::before{content:"";position:absolute;left:-1px;top:-9px;width:2px;height:18px;background:var(--line)}
.pj-road-done{position:absolute;left:0;top:50%;height:4px;margin-top:-2px;border-radius:0 4px 4px 0;background:linear-gradient(90deg,color-mix(in srgb,var(--acc) 30%,transparent),var(--acc))}
.pj-road-today{position:absolute;top:26px;bottom:26px;width:2px;background:var(--green);z-index:2}
.pj-road-today span{position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fff;background:var(--green);padding:2px 7px;border-radius:999px;white-space:nowrap}
.pj-rm{position:absolute;top:50%;width:0;height:0;padding:0;border:0;background:none;cursor:default;font:inherit;color:var(--ink);z-index:3}
.pj-rm[data-act="edit-item"]{cursor:pointer}
.pj-rm>i{position:absolute;left:-9px;top:-9px;width:18px;height:18px;border-radius:5px;transform:rotate(45deg);background:var(--card);border:3px solid var(--acc);box-shadow:0 2px 8px rgba(15,23,42,.18);transition:transform .15s}
.pj-rm.done>i{background:var(--good);border-color:var(--good)}.pj-rm.bad>i{background:var(--red);border-color:var(--red)}.pj-rm.warn>i{background:var(--amber);border-color:var(--amber)}
.pj-rm.gate>i{left:-12px;top:-12px;width:24px;height:24px}
.pj-rm:hover>i{transform:rotate(45deg) scale(1.2)}
.pj-rm>span{position:absolute;left:-76px;width:152px;display:flex;flex-direction:column;gap:2px;text-align:center;z-index:4}
.pj-rm>span b,.pj-rm>span em{align-self:center;max-width:100%;padding:0 4px;border-radius:5px;background:var(--card)}
.pj-deck .pj-rm>span b,.pj-deck .pj-rm>span em{background:#0b1124}
.pj-rm.up>span{bottom:18px}.pj-rm.dn>span{top:18px}
.pj-rm>span b{font-size:11.5px;line-height:1.3;font-weight:700;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.pj-rm>span em{font-style:normal;font-size:10.5px;color:var(--muted)}
.pj-rm.bad>span em{color:var(--bad-fg);font-weight:700}
.pj-rm.up>span::after,.pj-rm.dn>span::before{content:"";display:block;width:1px;height:10px;margin:2px auto;background:var(--line)}
.pj-rm.up>span::after{order:3}
.pj-tbs{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0 0;padding:12px 14px;border-radius:16px;background:var(--card);border:1px dashed var(--line)}
.pj-tbs-l{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-right:4px}
.pj-tb{font:inherit;font-size:12px;font-weight:700;color:var(--ink-soft);background:var(--card2);border:1px solid var(--line);border-radius:999px;padding:5px 11px;cursor:pointer}.pj-tb.gate{border-color:color-mix(in srgb,var(--acc) 55%,var(--line));color:var(--ink)}
/* tables */
.pj-tw{overflow-x:auto;margin-top:12px;border-radius:16px;border:1px solid var(--line);background:var(--card)}
.pj-tbl{width:100%;border-collapse:collapse;font-size:13px}
.pj-tbl th{position:sticky;top:0;text-align:left;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:10px 12px;background:var(--card2);border-bottom:1px solid var(--line);white-space:nowrap}
.pj-tbl td{padding:10px 12px;border-bottom:1px solid var(--line-soft);vertical-align:top;line-height:1.45}
.pj-tbl tr:last-child td{border-bottom:0}
.pj-tbl tbody tr{transition:background .12s}.pj-tbl tbody tr:hover{background:color-mix(in srgb,var(--acc,var(--green)) 5%,var(--card))}
.pj-tbl tr.bad td:first-child{box-shadow:inset 3px 0 0 var(--red)}.pj-tbl tr.done td{opacity:.62}
.pj-tbl .pj-ac{width:34px;text-align:right}
.pj-gate{font-style:normal;color:var(--acc);margin-right:6px}
/* story */
.pj-filt{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 12px}
.pj-filt button{font:inherit;font-size:12px;font-weight:800;color:var(--ink-soft);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer}
.pj-filt button:hover{border-color:var(--acc,var(--green))}.pj-filt button.on{color:#fff;background:var(--acc,var(--green));border-color:var(--acc,var(--green))}
.pj-chk{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:var(--ink-soft);cursor:pointer;margin-left:6px}.pj-chk input{accent-color:var(--acc,var(--green));width:16px;height:16px}
.pj-story{display:flex;flex-direction:column;gap:6px}
.pj-sy{display:grid;grid-template-columns:70px 1fr;gap:10px}
.pj-syl{position:sticky;top:calc(var(--hdr,55px) + 70px);align-self:start;font-size:22px;font-weight:800;letter-spacing:-.02em;color:color-mix(in srgb,var(--acc) 70%,var(--ink));padding-top:6px}
.pj-sy ol{list-style:none;margin:0;padding:0 0 0 22px;position:relative;display:flex;flex-direction:column;gap:2px}
.pj-sy ol::before{content:"";position:absolute;left:6px;top:14px;bottom:14px;width:2px;background:var(--line)}
.pj-sy li{position:relative;display:grid;grid-template-columns:62px 1fr auto;gap:10px;align-items:start;padding:8px 10px;border-radius:12px;transition:background .12s}
.pj-sy li:hover{background:var(--card)}
.pj-sy li::before{content:"";position:absolute;left:-21px;top:13px;width:12px;height:12px;border-radius:50%;background:var(--card);border:3px solid var(--muted)}
.pj-ev-good::before{border-color:var(--good)!important}.pj-ev-bad::before{border-color:var(--red)!important;background:var(--red)!important}.pj-ev-warn::before{border-color:var(--amber)!important}.pj-ev-neutral::before{border-color:var(--blue)!important}
.pj-evd{font-size:12px;font-weight:800;color:var(--muted);font-variant-numeric:tabular-nums;padding-top:1px}
.pj-evb{display:flex;flex-direction:column;gap:3px;min-width:0}
.pj-evt{font-size:13.5px;line-height:1.45;font-weight:600}.pj-evt i{font-style:normal;display:inline-flex;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:1px 7px;margin-right:7px;border-radius:6px;border:1px solid var(--line);vertical-align:1px}
.pj-ev-bad .pj-evt{color:var(--bad-fg)}
.pj-evx{font-size:12.5px;line-height:1.5;color:var(--ink-soft)}
/* workstreams */
.pj-wsl{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,430px),1fr));gap:12px;align-items:start}
.pj-ws{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.pj-wsh{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px}.pj-wsh>b{font-size:14px;margin-right:auto}
.pj-wsb{display:flex;align-items:center;gap:10px}.pj-wsp{font-size:15px;font-weight:800;min-width:46px;text-align:right;font-variant-numeric:tabular-nums}
.pj-wsr{font-size:12.5px;line-height:1.5;color:var(--ink-soft);padding:8px 10px;border-radius:10px;background:var(--card2)}
.pj-rqsum{display:flex;flex-wrap:wrap;gap:8px}
.pj-rqc{display:inline-flex;align-items:baseline;gap:7px;padding:8px 14px;border-radius:13px;font-size:12px;font-weight:700}.pj-rqc b{font-size:20px;font-weight:800}
/* issues */
.pj-icols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}
.pj-icol{display:flex;flex-direction:column;gap:10px;min-width:0}
.pj-ich{display:flex;align-items:center;gap:8px;padding:4px 2px 2px}.pj-ich b{font-size:14.5px}.pj-ich span{font-size:12px;color:var(--muted)}.pj-ich svg{color:var(--acc,var(--green))}.pj-ich .pj-add{margin-left:auto;padding:4px 8px}
.pj-is{position:relative;display:flex;flex-direction:column;gap:7px;padding:13px 14px 12px 17px;border-radius:15px;background:var(--card);border:1px solid var(--line);overflow:hidden}
.pj-is::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--sc,var(--muted))}
.pj-is-critical{--sc:#dc2626;background:color-mix(in srgb,var(--red) 4%,var(--card))}.pj-is-high{--sc:var(--orange)}.pj-is-medium{--sc:var(--amber)}.pj-is-low{--sc:var(--muted)}
.pj-is.closed{opacity:.6}
.pj-ish{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.pj-ist{font-size:13.5px;line-height:1.4}
.pj-is p,.pj-dc p,.pj-mtb p{margin:0;font-size:12.5px;line-height:1.5;color:var(--ink-soft)}
.pj-isn{font-size:12.5px;line-height:1.5;padding:8px 10px;border-radius:10px;background:var(--card2);border-left:3px solid var(--acc,var(--green))}
.pj-isn span{display:block;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.pj-ism{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--muted)}.pj-ism span{display:inline-flex;align-items:center;gap:5px}
/* budget */
.pj-bgrid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px;align-items:stretch}
.pj-btiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.pj-bt{display:flex;flex-direction:column;gap:4px;padding:16px;border-radius:16px;border:1px solid var(--line);background:var(--card)!important;color:var(--ink)!important;position:relative;overflow:hidden}
.pj-bt::after{content:"";position:absolute;right:-24px;bottom:-24px;width:90px;height:90px;border-radius:50%;opacity:.5;background:var(--bc,var(--line-soft))}
.pj-bt.pj-t-bad{--bc:var(--tint-red)}.pj-bt.pj-t-good{--bc:var(--tint-green)}.pj-bt.pj-t-info{--bc:var(--tint-blue)}.pj-bt.pj-t-muted{--bc:var(--line-soft)}
.pj-bt span{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);position:relative;z-index:1}.pj-bt b{font-size:21px;font-weight:800;letter-spacing:-.02em;position:relative;z-index:1;font-variant-numeric:tabular-nums}.pj-bt b i{font-size:14px;font-style:normal;font-weight:700}.pj-bt em{font-style:normal;font-size:11.5px;color:var(--muted);position:relative;z-index:1}
.pj-bt.pj-t-bad b{color:var(--bad-fg)}
.pj-bdn{display:flex;align-items:center;gap:18px;padding:14px 16px;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.pj-bdn ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:12.5px;flex:1;min-width:0}.pj-bdn li{display:flex;align-items:center;gap:8px}.pj-bdn li b{margin-left:auto;font-variant-numeric:tabular-nums;white-space:nowrap}
.pj-bdn li i{width:10px;height:10px;border-radius:3px;flex:none}
.pj-donut{position:relative;flex:none}.pj-donut .bg{stroke:var(--line-soft)}
.pj-dnv{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.pj-dnv b{font-size:15px;font-weight:800}.pj-dnv span{font-size:10.5px;color:var(--muted)}
circle.pj-dn-paid,i.pj-dn-paid{stroke:var(--good);background:var(--good)}circle.pj-dn-invoiced,i.pj-dn-invoiced{stroke:var(--blue);background:var(--blue)}circle.pj-dn-on_hold,i.pj-dn-on_hold{stroke:var(--red);background:var(--red)}
circle.pj-dn-committed,i.pj-dn-committed{stroke:var(--violet);background:var(--violet)}circle.pj-dn-planned,i.pj-dn-planned{stroke:var(--muted);background:var(--muted)}circle.pj-dn-disputed,i.pj-dn-disputed{stroke:var(--amber);background:var(--amber)}
.pj-note{display:flex;align-items:flex-start;gap:9px;margin-top:12px;padding:11px 14px;border-radius:14px;font-size:12.5px;line-height:1.5;color:var(--tint-amber-fg);background:var(--tint-amber);border:1px solid var(--amber-line)}.pj-note svg{flex:none;margin-top:2px}
/* governance */
.pj-dgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr));gap:12px}
.pj-dc{position:relative;display:flex;flex-direction:column;gap:8px;padding:14px 15px;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.pj-dc-needed{border-color:color-mix(in srgb,var(--violet) 40%,var(--line));background:linear-gradient(180deg,color-mix(in srgb,var(--violet) 6%,var(--card)),var(--card))}
.pj-dc>b{font-size:14px;line-height:1.4}.pj-dch{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pj-mts{display:flex;flex-direction:column;gap:12px}
.pj-mt{display:grid;grid-template-columns:78px 1fr;gap:16px;padding:16px;border-radius:18px;background:var(--card);border:1px solid var(--line)}
.pj-mt-planned{border-style:dashed;border-color:color-mix(in srgb,var(--acc) 50%,var(--line))}
.pj-mtd{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:10px 4px;border-radius:14px;height:max-content;background:linear-gradient(160deg,color-mix(in srgb,var(--acc) 16%,var(--card)),var(--card2));border:1px solid color-mix(in srgb,var(--acc) 25%,var(--line))}
.pj-mtd b{font-size:26px;font-weight:800;line-height:1;letter-spacing:-.02em}.pj-mtd span{font-size:12px;font-weight:800;text-transform:uppercase;color:var(--ink-soft)}.pj-mtd em{font-style:normal;font-size:11px;color:var(--muted)}
.pj-mtb{display:flex;flex-direction:column;gap:8px;min-width:0}
.pj-mth{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.pj-mtt{font-size:15px;line-height:1.35}
.pj-mtd2{display:flex;flex-direction:column;gap:8px}.pj-mtd2>summary{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:var(--acc,var(--green));cursor:pointer;list-style:none;padding:4px 0}.pj-mtd2>summary::-webkit-details-marker{display:none}.pj-mtd2[open]>summary{margin-bottom:8px}.pj-mtd2>.pj-mtx+.pj-mtx{margin-top:8px}
.pj-att summary{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:var(--muted);cursor:pointer;list-style:none}.pj-att summary::-webkit-details-marker{display:none}.pj-att p{margin-top:6px!important}
.pj-mtx{padding:10px 12px;border-radius:12px;background:var(--card2);border:1px solid var(--line-soft)}
.pj-mtx>span{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.pj-mtx ul{margin:0;padding-left:18px;font-size:12.5px;line-height:1.55;color:var(--ink-soft)}
.pj-mta td{padding:6px 8px;font-size:12px}.pj-mta tr:hover{background:none!important}
.pj-conds{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,460px),1fr));gap:10px}
.pj-conds li{display:flex;gap:12px;padding:13px 14px;border-radius:15px;background:var(--card);border:1px solid var(--line)}
.pj-cn{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:9px;font-size:12.5px;font-weight:800;color:#fff;background:linear-gradient(135deg,var(--acc),color-mix(in srgb,var(--acc) 55%,#0b1026))}
.pj-conds li>div{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}.pj-cdh{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.pj-cdh b{font-size:13.5px;margin-right:auto}
.pj-conds p{margin:0;font-size:12.5px;line-height:1.5;color:var(--ink-soft)}
/* escalation ladder */
.pj-ladders{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.pj-lad{padding:16px;border-radius:20px;background:var(--card);border:1px solid var(--line)}
.pj-lad-salam{--lc:var(--green)}.pj-lad-vendor{--lc:var(--acc)}
.pj-ladh{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:15px}.pj-ladh svg{color:var(--lc)}
.pj-lad ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;position:relative}
.pj-lad li{position:relative;display:flex;align-items:flex-start;gap:12px;padding:12px 12px 12px 14px;border-radius:15px;margin-left:calc((var(--lv) - 1) * 22px);background:linear-gradient(90deg,color-mix(in srgb,var(--lc) calc(var(--lv) * 5%),var(--card2)),var(--card2));border:1px solid color-mix(in srgb,var(--lc) calc(var(--lv) * 9%),var(--line))}
.pj-lad li+li::before{content:"";position:absolute;left:28px;top:-11px;width:2px;height:11px;background:color-mix(in srgb,var(--lc) 50%,var(--line))}
.pj-lv{flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:12px;font-size:13px;font-weight:800;color:#fff;background:linear-gradient(135deg,var(--lc),color-mix(in srgb,var(--lc) 50%,#0b1026));box-shadow:0 6px 14px -6px var(--lc)}
.pj-lb{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.pj-lb b{font-size:14px;line-height:1.35}.pj-lb>span{font-size:12px;color:var(--ink-soft)}
.pj-lb em{display:flex;align-items:flex-start;gap:5px;margin-top:4px;font-style:normal;font-size:12px;line-height:1.45;color:var(--ink-soft)}.pj-lb em svg{flex:none;margin-top:2px;color:var(--lc)}
/* activity */
.pj-actg{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:16px;align-items:start}
.pj-ups{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.pj-ups li{display:grid;grid-template-columns:70px 1fr;gap:12px}
.pj-upd{font-size:12px;font-weight:800;color:var(--muted);padding-top:12px;text-align:right}
.pj-upb{padding:12px 14px;border-radius:15px;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--uc,var(--muted))}
.pj-up-red .pj-upb{--uc:var(--red)}.pj-up-amber .pj-upb{--uc:var(--amber)}.pj-up-green .pj-upb{--uc:var(--good)}
.pj-uph{display:flex;align-items:center;gap:6px;margin-bottom:6px}.pj-upb>b{display:block;font-size:14px;margin-bottom:6px}.pj-upb .pj-prose p,.pj-upb p{margin:0 0 6px;font-size:13px;line-height:1.55;color:var(--ink-soft);font-weight:400}
.pj-cms{padding:16px;border-radius:20px;background:var(--card);border:1px solid var(--line)}
.pj-cmf{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}.pj-cmf textarea{font:inherit;font-size:13.5px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card2);color:var(--ink);resize:vertical;min-height:70px}
.pj-cmf textarea:focus{outline:none;border-color:var(--acc,var(--green));box-shadow:0 0 0 3px color-mix(in srgb,var(--acc,var(--green)) 20%,transparent)}.pj-cmf>div{display:flex;justify-content:flex-end}
.pj-cml{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.pj-cml li{padding:10px 12px;border-radius:13px;background:var(--card2);border:1px solid var(--line-soft)}
.pj-cml li.vp{border-color:color-mix(in srgb,var(--violet) 45%,var(--line));background:color-mix(in srgb,var(--violet) 7%,var(--card2))}
.pj-cmh{display:flex;align-items:center;gap:7px;font-size:12.5px;margin-bottom:4px}.pj-cmh>span{font-size:11.5px;color:var(--muted)}.pj-cmh .pj-lnk{margin-left:auto;font-size:11px;color:var(--muted)}
.pj-cmb{font-size:13px;line-height:1.55;white-space:pre-wrap}
/* edit affordances */
.pj-ied{flex:none;display:inline-grid;place-items:center;width:26px;height:26px;margin-left:auto;padding:0;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--muted);cursor:pointer;opacity:0;transition:opacity .15s,color .15s,border-color .15s}
.pj-ied:hover{color:var(--acc,var(--green));border-color:var(--acc,var(--green))}
:is(.pj-ws,.pj-is,.pj-dc,.pj-mt,.pj-conds li,.pj-lad li,.pj-sy li,.pj-upb,.pj-tbl tr,.pj-box):hover .pj-ied,.pj-ied.show,.pj-ied:focus-visible{opacity:1}
@media (hover:none){.pj-ied{opacity:1}}
/* buttons, errors */
.pj-btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-weight:800;font-size:13px;padding:9px 15px;border-radius:11px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;transition:background .15s,border-color .15s,transform .1s;white-space:nowrap}
.pj-btn:hover{border-color:var(--acc,var(--green))}.pj-btn:active{transform:translateY(1px)}.pj-btn[disabled]{opacity:.55;cursor:progress}
.pj-btn.pri{background:var(--acc,var(--green));border-color:var(--acc,var(--green));color:#fff}.pj-btn.pri:hover{filter:brightness(1.07)}
.pj-btn.danger{background:var(--red);border-color:var(--red);color:#fff}.pj-btn.ghost{color:var(--bad-fg);border-color:transparent;background:transparent}
.pj-err{display:flex;gap:14px;align-items:flex-start;padding:22px;border-radius:18px;background:var(--tint-red);color:var(--tint-red-fg);border:1px solid var(--red-line)}.pj-err p{margin:4px 0 12px}
/* ---------- modal + form ---------- */
.pj-mov{position:fixed;inset:0;z-index:1300;background:var(--scrim);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px 30px;overflow-y:auto;opacity:0;pointer-events:none;transition:opacity .2s;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.pj-mov.open{opacity:1;pointer-events:auto}
.pj-md{width:min(680px,100%);background:var(--card);border-radius:20px;border:1px solid var(--line);box-shadow:var(--shadow-lg);transform:translateY(10px) scale(.99);transition:transform .22s}.pj-mov.open .pj-md{transform:none}.pj-md.wide{width:min(980px,100%)}
.pj-mh{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line)}.pj-mh h3{margin:0;font-size:17px;font-weight:800;flex:1}
.pj-x{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;border:1px solid var(--line);background:var(--card2);color:var(--ink);cursor:pointer}.pj-x:hover{border-color:var(--red);color:var(--bad-fg)}
.pj-mb{padding:18px 20px 20px}
.pj-form fieldset{border:1px solid var(--line);border-radius:16px;padding:12px 14px 4px;margin:0 0 14px}.pj-form legend{padding:0 6px;font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.pj-fg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}
.pj-f{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;min-width:0}.pj-f.wide{grid-column:1 / -1}
.pj-f>span{font-size:11.5px;font-weight:800;color:var(--muted);letter-spacing:.02em}
.pj-in{font:inherit;font-size:13.5px;padding:9px 11px;border:1px solid var(--line);border-radius:11px;background:var(--card2);color:var(--ink);width:100%;box-sizing:border-box}
.pj-in:focus{outline:none;border-color:var(--acc,var(--green));box-shadow:0 0 0 3px color-mix(in srgb,var(--acc,var(--green)) 20%,transparent)}
textarea.pj-in{resize:vertical;line-height:1.5}select.pj-in{cursor:pointer}.pj-in.pj-mono{font-family:var(--mono);font-size:12.5px}
.pj-color{height:40px;padding:4px;cursor:pointer}
.pj-fchk{flex-direction:row;align-items:center;gap:8px;align-self:end;padding-bottom:10px;font-size:13px;font-weight:700;cursor:pointer}.pj-fchk input{width:17px;height:17px;accent-color:var(--acc,var(--green))}
.pj-radio{display:flex;flex-wrap:wrap;gap:6px}
.pj-radio label{position:relative;cursor:pointer}.pj-radio input{position:absolute;opacity:0;width:1px;height:1px}
.pj-radio span{display:inline-flex;align-items:center;font-size:12.5px;font-weight:700;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card2);color:var(--ink-soft);transition:background .12s,border-color .12s,color .12s}
.pj-radio label:hover span{border-color:var(--acc,var(--green))}
.pj-radio input:focus-visible+span{outline:2px solid var(--acc,var(--green));outline-offset:2px}
.pj-radio input:checked+span{background:var(--acc,var(--green));border-color:var(--acc,var(--green));color:#fff}
.pj-radio.sev input:checked+.pj-r-critical,.pj-radio.rag input:checked+.pj-r-red{background:var(--red);border-color:var(--red)}
.pj-radio.sev input:checked+.pj-r-high{background:var(--orange);border-color:var(--orange)}.pj-radio.sev input:checked+.pj-r-medium,.pj-radio.rag input:checked+.pj-r-amber{background:var(--amber);border-color:var(--amber)}
.pj-radio.sev input:checked+.pj-r-low,.pj-radio.rag input:checked+.pj-r-grey{background:var(--muted);border-color:var(--muted)}.pj-radio.rag input:checked+.pj-r-green{background:var(--good);border-color:var(--good)}
.pj-hgf{display:flex;flex-direction:column;gap:10px;padding-bottom:10px}
.pj-hgr{display:grid;grid-template-columns:150px auto 1fr;gap:10px;align-items:center}
.pj-mact{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}.pj-mact .pj-msg{margin-right:auto}
.pj-msg{font-size:12.5px;font-weight:700;color:var(--muted)}.pj-msg.bad{color:var(--bad-fg)}
.pj-cfm{position:fixed;inset:0;z-index:1400;display:grid;place-items:center;background:var(--scrim);opacity:0;transition:opacity .15s;padding:16px}.pj-cfm.open{opacity:1}
.pj-cfb{width:min(420px,100%);padding:20px;border-radius:18px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow-lg)}.pj-cfb p{margin:0 0 16px;font-size:14px;line-height:1.5}.pj-cfb div{display:flex;justify-content:flex-end;gap:8px}
#pjToast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);z-index:1500;padding:11px 18px;border-radius:12px;background:var(--solid);color:var(--solid-fg);font-size:13px;font-weight:700;box-shadow:var(--shadow-lg);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
#pjToast.show{opacity:1;transform:translate(-50%,0)}
/* ---------- presentation ---------- */
.pj-deck{position:fixed;inset:0;z-index:1450;display:flex;flex-direction:column;color:#eef4ff;background:radial-gradient(1200px 600px at 10% -10%,rgba(16,185,129,.18),transparent 60%),radial-gradient(1000px 600px at 110% 110%,rgba(99,102,241,.22),transparent 60%),#060a19;opacity:0;transition:opacity .25s}
.pj-deck.open{opacity:1}
.pj-dk-top{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
.pj-dk-brand{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#7ee2bf}
.pj-dk-t{flex:1;min-width:0;font-size:13px;font-weight:700;color:rgba(238,244,255,.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pj-dk-n{font-size:12px;font-weight:800;color:rgba(238,244,255,.6);font-variant-numeric:tabular-nums}
.pj-dk-top button,.pj-dk-bot button{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#eef4ff;cursor:pointer}
.pj-dk-top button:hover,.pj-dk-bot button:hover{background:rgba(255,255,255,.14)}
.pj-dk-stage{position:relative;flex:1;min-height:0}
.pj-sl{position:absolute;inset:0;display:flex;align-items:stretch;justify-content:center;opacity:0;transform:translateX(40px);pointer-events:none;transition:opacity .45s cubic-bezier(.2,.7,.2,1),transform .45s cubic-bezier(.2,.7,.2,1)}
.pj-sl.past{transform:translateX(-40px)}.pj-sl.on{opacity:1;transform:none;pointer-events:auto}
.pj-sl-in{width:min(1320px,100%);padding:28px 40px;overflow-y:auto}
.pj-dk-bot{display:flex;align-items:center;gap:14px;padding:12px 18px;border-top:1px solid rgba(255,255,255,.08)}
.pj-dk-prog{flex:1;height:4px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden}.pj-dk-prog i{display:block;height:100%;width:0;border-radius:4px;background:linear-gradient(90deg,#34d399,#818cf8);transition:width .4s}
.pj-deck .pj-s-cover{min-height:100%;display:flex;flex-direction:column;justify-content:center;gap:10px}
.pj-deck .pj-s-cover h1{margin:0;font-size:clamp(44px,6vw,86px);font-weight:800;letter-spacing:-.04em;line-height:1;background:linear-gradient(120deg,#fff,#a7f3d0 60%,#c7d2fe);-webkit-background-clip:text;background-clip:text;color:transparent}
.pj-s-kick{font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7ee2bf}.pj-s-sub{font-size:clamp(14px,1.4vw,18px);color:rgba(238,244,255,.7)}
.pj-s-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:34px;max-width:1100px}
.pj-s-stats div{padding:20px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}.pj-s-stats b{display:block;font-size:clamp(28px,3vw,42px);font-weight:800;letter-spacing:-.03em;white-space:nowrap}.pj-s-stats span{font-size:13px;color:rgba(238,244,255,.7)}
.pj-s-stats .vio b{color:#c4b5fd}.pj-s-stats .bad b{color:#fca5a5}.pj-s-stats .warn b{color:#fcd34d}
.pj-s-h2{margin:0 0 18px;font-size:clamp(24px,2.6vw,36px);font-weight:800;letter-spacing:-.02em}
.pj-s-tbl{width:100%;border-collapse:separate;border-spacing:0 8px;font-size:clamp(12.5px,1.05vw,15px)}
.pj-s-tbl th{text-align:left;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(238,244,255,.55);padding:0 12px}
.pj-s-tbl td{padding:14px 12px;background:rgba(255,255,255,.05);vertical-align:top;line-height:1.4}.pj-s-tbl td:first-child{border-radius:14px 0 0 14px;box-shadow:inset 4px 0 0 var(--acc)}.pj-s-tbl td:last-child{border-radius:0 14px 14px 0}
.pj-s-tbl td em{display:block;font-style:normal;font-size:12px;color:rgba(238,244,255,.6);margin-top:2px}
.pj-deck .pj-gantt{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1)}
.pj-deck .pj-gn{background:linear-gradient(90deg,#0b1124 85%,transparent);color:#eef4ff}.pj-deck .pj-gm,.pj-deck .pj-gn em{color:rgba(238,244,255,.6)}.pj-deck .pj-gm b,.pj-deck .pj-gm.yr{color:#fff}
.pj-deck .pj-gl{background:rgba(255,255,255,.06)}.pj-deck .pj-gh{border-color:rgba(255,255,255,.08)}
.pj-deck [data-rv]{opacity:1;transform:none}
.pj-deck .pj-sl .pj-sh{display:none}.pj-deck .pj-sl .pj-sec{margin-top:0}.pj-deck .pj-gr{height:92px}.pj-deck .pj-gb{top:30px;height:34px}.pj-deck .pj-gd{top:39px}.pj-deck .pj-gtbc{top:30px;height:34px}.pj-deck .pj-gend{top:38px;color:rgba(238,244,255,.75)}.pj-deck .pj-gslip{top:70px}.pj-deck .pj-gn b{font-size:15px}.pj-deck .pj-gm{font-size:12.5px}
.pj-s-head{display:flex;align-items:center;gap:16px;margin-bottom:22px}.pj-s-head>div{flex:1;min-width:0}.pj-s-head h2{margin:2px 0;font-size:clamp(24px,2.7vw,40px);font-weight:800;letter-spacing:-.02em;line-height:1.1}
.pj-s-head .pj-mono{width:58px;height:58px;font-size:18px;border-radius:18px}
.pj-deck .pj-rag{background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.2)}
.pj-s-sum{display:grid;grid-template-columns:auto 1fr;gap:34px;align-items:start}
.pj-s-ring{display:flex;flex-direction:column;align-items:center;gap:16px}
.pj-s-dates{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:300px}.pj-s-dates div{padding:9px 11px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
.pj-s-dates span{display:block;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(238,244,255,.55)}.pj-s-dates b{font-size:14px}
.pj-s-brief p{margin:0 0 12px;font-size:clamp(15px,1.35vw,20px);line-height:1.6;color:rgba(238,244,255,.88)}
.pj-s-slip{display:inline-flex;align-items:center;gap:8px;margin-top:6px;padding:8px 14px;border-radius:999px;font-size:14px;color:#fecaca;background:rgba(220,38,38,.18);border:1px solid rgba(248,113,113,.35)}
.pj-s-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:24px}
.pj-deck .pj-fact{background:rgba(255,255,255,.05)!important;border-color:rgba(255,255,255,.1);color:#eef4ff}.pj-deck .pj-fact span,.pj-deck .pj-fact em{color:rgba(238,244,255,.6)}.pj-deck .pj-fact.pj-t-bad b{color:#fca5a5}.pj-deck .pj-fact.pj-t-warn b{color:#fcd34d}
.pj-s-health{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.pj-s-h{padding:14px 16px;border-radius:16px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-top:3px solid var(--hc,rgba(255,255,255,.3))}
.pj-s-h-red{--hc:#f87171}.pj-s-h-amber{--hc:#fbbf24}.pj-s-h-green{--hc:#4ade80}
.pj-s-h>div{display:flex;align-items:center;gap:8px}.pj-s-h p{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.pj-s-h b{font-size:15px;flex:1}.pj-s-h span{font-size:12px;font-weight:800;color:var(--hc)}.pj-s-h p{margin:8px 0 0;font-size:13px;line-height:1.5;color:rgba(238,244,255,.75)}
.pj-s-2{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:22px}.pj-s-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}
.pj-deck h3{display:flex;align-items:center;gap:9px;margin:0 0 12px;font-size:17px;font-weight:800}.pj-deck h3 svg{color:#7ee2bf}.pj-deck h3 small{font-size:12px;font-weight:700;color:rgba(238,244,255,.55)}
.pj-s-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
.pj-s-list li{display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09)}
.pj-s-list li>div{display:flex;flex-direction:column;gap:2px;min-width:0}.pj-s-list b{font-size:14px;line-height:1.4}.pj-s-list em{font-style:normal;font-size:12px;color:rgba(238,244,255,.6)}
.pj-s-dt{flex:none;min-width:64px;font-size:12px;font-weight:800;color:#7ee2bf;padding-top:2px}.pj-s-dt.tbc{color:rgba(238,244,255,.45)}
.pj-s-money{display:flex;flex-direction:column;gap:9px}.pj-s-money div{padding:11px 13px;border-radius:13px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09)}
.pj-s-money span{display:block;font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(238,244,255,.55)}.pj-s-money b{font-size:16px}.pj-s-money .bad b{color:#fca5a5}
.pj-s-note{margin:10px 0 0;font-size:12px;line-height:1.5;color:rgba(238,244,255,.6)}
.pj-s-lad{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pj-s-lad>div>span{display:block;font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(238,244,255,.55);margin-bottom:6px}
.pj-s-lad ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.pj-s-lad li{display:flex;gap:8px;align-items:flex-start;padding:8px 9px;border-radius:11px;background:rgba(255,255,255,.05)}
.pj-s-lad li i{flex:none;font-style:normal;font-size:11px;font-weight:800;padding:2px 6px;border-radius:6px;background:rgba(126,226,191,.2);color:#7ee2bf}.pj-s-lad li div{display:flex;flex-direction:column;min-width:0}.pj-s-lad li b{font-size:12.5px}.pj-s-lad li em{font-style:normal;font-size:11px;color:rgba(238,244,255,.55)}
.pj-s-asks{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:14px}
.pj-s-asks li{display:flex;gap:14px;padding:16px 18px;border-radius:18px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);box-shadow:inset 4px 0 0 var(--acc)}
.pj-s-asks li>span{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:12px;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#6d28d9)}
.pj-s-asks li>div{display:flex;flex-direction:column;gap:4px}.pj-s-asks em{font-style:normal;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:rgba(238,244,255,.55)}.pj-s-asks b{font-size:16px;line-height:1.4}.pj-s-asks p{margin:0;font-size:13px;line-height:1.5;color:rgba(238,244,255,.75)}.pj-s-asks i{font-style:normal;font-size:12px;color:#c4b5fd}
.pj-deck .pj-road{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1)}.pj-deck .pj-road-line{background:rgba(255,255,255,.1)}.pj-deck .pj-rm{color:#eef4ff}.pj-deck .pj-rm>span em{color:rgba(238,244,255,.6)}
.pj-deck .pj-rm.plan>i{background:#0b1124}.pj-deck .pj-tbs{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12)}.pj-deck .pj-tb{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);color:#eef4ff}
.pj-deck .pj-muted{color:rgba(238,244,255,.55)}
/* ---------- responsive ---------- */
@media (max-width:1360px){.pj-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.pj-ovg{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}.pj-ovside{grid-column:1 / -1;display:grid;grid-template-columns:1fr 1fr}}
@media (max-width:1140px){.pj-facts{grid-template-columns:repeat(3,minmax(0,1fr))}.pj-cols2{grid-template-columns:1fr}.pj-icols{grid-template-columns:1fr 1fr}.pj-icol:last-child{grid-column:1 / -1}.pj-hero-r{align-items:flex-start;width:100%}.pj-tools{justify-content:flex-start}.pj-ph-r{flex:1 1 100%}
  .pj-bgrid{grid-template-columns:1fr}.pj-actg{grid-template-columns:1fr}.pj-s-3{grid-template-columns:1fr 1fr}}
@media (max-width:900px){.pj-ovg{grid-template-columns:1fr}.pj-ovside{grid-template-columns:1fr}.pj-ladders{grid-template-columns:1fr}.pj-hdates{grid-template-columns:repeat(2,minmax(0,1fr))}.pj-s-sum{grid-template-columns:1fr}.pj-s-health{grid-template-columns:1fr 1fr}.pj-s-2,.pj-s-3{grid-template-columns:1fr}}
@media (max-width:820px){
  #view-opsprojects{padding:12px 12px 40px}
  .pj-hero,.pj-phero{padding:22px 18px 20px;border-radius:20px}.pj-secnav{margin:12px -12px 0;padding:6px 12px}
  .pj-icols{grid-template-columns:1fr}.pj-cdates{grid-template-columns:1fr 1fr}.pj-cdates div:last-child{grid-column:1 / -1}
  .pj-cmid{align-items:flex-start}.pj-mt{grid-template-columns:1fr;gap:10px}.pj-mtd{flex-direction:row;gap:8px;align-items:baseline;width:max-content;padding:6px 12px}.pj-mtd b{font-size:18px}
  .pj-tbl thead{display:none}.pj-tbl,.pj-tbl tbody,.pj-tbl tr,.pj-tbl td{display:block;width:100%;box-sizing:border-box}
  .pj-tbl tr{position:relative;padding:10px 12px;border-bottom:1px solid var(--line)}.pj-tbl td{padding:3px 0;border:0}.pj-tbl .pj-ac{position:absolute;right:10px;top:10px;width:auto}.pj-tbl .pj-num{text-align:left}
  .pj-tbl tr.bad td:first-child{box-shadow:none}.pj-tbl tr.bad{box-shadow:inset 3px 0 0 var(--red)}
  .pj-mta tr{padding:6px 0}
  .pj-sy{grid-template-columns:1fr}.pj-syl{position:static;font-size:18px;padding:0}.pj-sy li{grid-template-columns:54px 1fr auto}
  .pj-ups li{grid-template-columns:1fr}.pj-upd{text-align:left;padding:0}
  .pj-hgr{grid-template-columns:1fr}.pj-fg{grid-template-columns:1fr}
  .pj-sl-in{padding:18px 18px}.pj-s-dates{width:100%}.pj-s-health{grid-template-columns:1fr}.pj-s-lad{grid-template-columns:1fr}
  .pj-s-tbl thead{display:none}.pj-s-tbl tr,.pj-s-tbl td{display:block}.pj-s-tbl td{border-radius:0!important}.pj-s-tbl td:first-child{border-radius:14px 14px 0 0!important}.pj-s-tbl td:last-child{border-radius:0 0 14px 14px!important;margin-bottom:10px}
}
@media (max-width:560px){.pj-kpis{grid-template-columns:1fr 1fr;gap:10px}.pj-kv{font-size:26px}.pj-kpi{padding:13px}.pj-ph-top{flex-wrap:wrap}.pj-hdates{grid-template-columns:1fr 1fr}.pj-card{padding:16px 15px 14px}.pj-cmid{flex-direction:column;align-items:stretch}.pj-cmid .pj-ring{align-self:center}
  .pj-people{grid-template-columns:1fr}.pj-lad li{margin-left:calc((var(--lv) - 1) * 10px)}.pj-gn0,.pj-gn{width:130px}.pj-facts{grid-template-columns:1fr 1fr!important}.pj-fact b{font-size:18px}.pj-btiles{grid-template-columns:1fr 1fr}.pj-bt b{font-size:17px}.pj-bdn{flex-direction:column;align-items:stretch}.pj-bdn .pj-donut{align-self:center}}
@media (pointer:coarse){.pj-btn,.pj-tool{min-height:40px}.pj-filt button,.pj-snin button{min-height:36px}}
@media (prefers-reduced-motion:reduce){[data-rv]{opacity:1!important;transform:none!important;transition:none!important}.pj-aur::before,.pj-aur::after,.pj-rag-red i,.pj-gtoday::after{animation:none!important}.pj-gb{transform:none!important;transition:none!important}.pj-ring .fg,.pj-bar i,.pj-sl{transition:none!important}}
@media print{
  header,nav,#viewAsBar,.pj-tools,.pj-crumbs,.pj-secnav,.pj-add,.pj-ied,.pj-filt,.pj-chk,.pj-cmf,.pj-lnk,.pj-next,#pjToast,#pjModal,#pjDeck{display:none!important}
  #view-opsprojects{padding:0}[data-rv]{opacity:1!important;transform:none!important}.pj-gb{transform:none!important}.pj-ring .fg{stroke-dashoffset:var(--off)!important}.pj-bar i{width:var(--w)!important}
  .pj-hero,.pj-phero,.pj-mono,.pj-sev,.pj-vpb,.pj-gb,.pj-lv,.pj-cn,.pj-rag,.pj-pill,.pj-fact,.pj-is,.pj-bar i{-webkit-print-color-adjust:exact;print-color-adjust:exact}.pj-hero,.pj-phero{box-shadow:none}
  .pj-card,.pj-box,.pj-is,.pj-mt,.pj-dc,.pj-ws,.pj-lad li,.pj-conds li,.pj-sy li{break-inside:avoid}.pj-sec{break-before:auto}
  .pj-gantt,.pj-road,.pj-tw{overflow:visible}
}
`;
    document.head.appendChild(css);
  }
})();
