/* opsreports.js — Operations reports (#opsreports, 8 Oct 2026, alpha.152)
 *
 * The weekly reports of every team and vendor in one section, the way ITSM used to assemble them by hand:
 *   This week     status table of the reporting week (Sun–Sat): who sent, who is late, RAG, KPIs, actions, follow-ups,
 *                 and the consolidated report for Salam management (preview · send)
 *   Actions       the action tracker built from every submitted report — owner, ETA, ETA moves, waiting on Salam
 *   ITSM          the ServiceHub "Unified ITSM Dashboards" drawn natively from the ServiceNow API (+ Open in ServiceHub)
 *   Library       every report and original file, by week
 *   Teams         who reports, in which format, KPIs with targets, owners / uploaders / vendor contacts, drop links
 *   Settings      due time, reminder, late mails, consolidated mail, recipients, ITSM editors, weekly decks, mail log
 * Weekly decks (alpha.157): the Operational Weekly Executive Report and the Application Operational weekly status
 *                 report in the Salam template, built by the server as soon as every team is in — card on This week,
 *                 every week's decks in Library, the executive text editable by ITSM, the sections in Settings.
 * Each team uploads its report in its own format (pptx · xlsx · docx · pdf · eml …): the server reads it and proposes
 * the KPIs, actions, highlights it found; the person accepts, completes and submits. Server: opsReports.js.
 * Deep links: #opsreports?week=2026-09-27 · &team=tcs_mvno (opens that report) · &tab=actions|itsm|library|teams|settings */
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
  const KT = window.KT;
  const TZ = 'Asia/Riyadh';
  const F_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const F_DAYW = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  const dshort = d => d ? F_DAY.format(new Date(d + 'T00:00:00Z')) : '—';
  const addDay = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const range = (a, b) => `${dshort(a)} – ${dshort(b)}`;
  const dt = v => v ? (KT ? KT.dt(v) : new Date(v).toLocaleString()) : '—';
  const when = v => v ? `${F_DAYW.format(new Date(v))} ${KT ? KT.t(v) : ''}` : '—';
  const ago = v => v ? (KT ? KT.ago(v) : '') : '';
  const today = () => KT ? KT.d(new Date()) : new Date().toISOString().slice(0, 10);
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const lines = s => String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const emails = s => String(s || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => /@/.test(x));

  const ST = { approved: ['Approved', 'ok'], submitted: ['Submitted', 'blue'], returned: ['Returned', 'amber'], received: ['Received — to review', 'violet'], draft: ['Draft', 'grey'],
    missing: ['Missing', 'red'], pending: ['Not due yet', 'muted'] };
  const RAG = { green: 'Green', amber: 'Amber', red: 'Red' };
  const ACT = { open: 'Open', in_progress: 'In progress', waiting_salam: 'Waiting on Salam', done: 'Done', cancelled: 'Cancelled' };
  const TOWER = { digital: 'Digital', bss: 'BSS', oss: 'OSS', itsm: 'ITSM', infra: 'Infra', enterprise: 'Enterprise', security: 'Security', data: 'Data' };
  const svg = (d, s) => `<svg viewBox="0 0 24 24" width="${s || 15}" height="${s || 15}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = { up: '<path d="M12 19V5M5 12l7-7 7 7"/>', file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>', refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
    report: '<path d="M4 4h16v16H4z"/><path d="M8 15v-3M12 15V9M16 15v-5"/>', ext: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    dl: '<path d="M12 3v12M6 11l6 6 6-6"/><path d="M4 21h16"/>', trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M20 6 9 17l-5-5"/>' };

  const S = { built: false, open: false, tab: 'week', week: null, ov: null, me: {}, teams: null, actions: null, itsm: null, itsmDays: 7, itsmTab: 'incident', lib: null, cfg: null, mails: null,
    actFilter: { team: '', status: 'open', overdue: false, salam: false, q: '' }, rep: null, decks: {} };
  const me = () => (S.ov && S.ov.me) || S.me || {};

  /* ---------------------------------------------------------------- shell */
  function hero() {
    const o = S.ov || {}, t = o.totals || {}, sc = o.schedule || {};
    const isCur = o.week === o.defaultWeek;
    return `<div class="or-hero">
      <div class="or-hero-l">
        <div class="or-kick">Operations reports · ITSM</div>
        <h1 class="or-h1">Weekly reports <span>${o.week ? range(o.from, o.to) : '…'}</span></h1>
        <div class="or-sub">${o.week ? `${t.submitted || 0} of ${t.teams || 0} teams reported · due ${DAYS[sc.dueDay || 0]} ${esc(sc.dueTime || '12:00')} KSA · consolidated report ${DAYS[(sc.consolidated || {}).day || 1]} ${esc((sc.consolidated || {}).time || '09:00')} to Salam management` : 'loading…'}</div>
        <div class="or-weeknav">
          <button class="or-hbtn" data-act="week" data-d="-7" title="Previous week">${svg(IC.left)}</button>
          <input type="date" class="or-hdate" id="orWeekPick" value="${esc(o.week || '')}" aria-label="Week">
          <button class="or-hbtn" data-act="week" data-d="7" title="Next week">${svg(IC.right)}</button>
          ${isCur ? '<span class="or-hnote">week being reported</span>' : `<button class="or-hbtn or-htext" data-act="week" data-d="0">Back to the reporting week</button>`}
        </div>
      </div>
      <div class="or-hero-r">
        <button class="or-btn or-btn-hero" data-act="upload">${svg(IC.up)} Upload a report</button>
        <button class="or-btn or-btn-ghost" data-act="consolidated">${svg(IC.report)} Consolidated report</button>
        <button class="or-hbtn" data-act="refresh" title="Refresh">${svg(IC.refresh)}</button>
      </div>
    </div>`;
  }
  function tabs() {
    const m = me();
    const list = [['week', 'This week'], ['actions', 'Actions'], ['itsm', 'ITSM · ServiceNow'], ['library', 'Library']];
    if (m.canTeams) list.push(['teams', 'Teams']);
    if (m.canSettings) list.push(['settings', 'Settings']);
    const badge = k => k === 'actions' && S.ov && S.ov.totals.actionsOverdue ? `<b class="or-tb bad">${S.ov.totals.actionsOverdue}</b>` : k === 'week' && S.ov && S.ov.totals.missing ? `<b class="or-tb bad">${S.ov.totals.missing}</b>` : '';
    return `<div class="or-tabs" role="tablist">${list.map(([k, l]) => `<button role="tab" class="${S.tab === k ? 'on' : ''}" data-act="tab" data-k="${k}">${l}${badge(k)}</button>`).join('')}</div>`;
  }
  function render() {
    const host = $('#view-opsreports'); if (!host) return;
    let body = '';
    try {
      body = S.tab === 'actions' ? actionsTab() : S.tab === 'itsm' ? itsmTab() : S.tab === 'library' ? libraryTab() : S.tab === 'teams' ? teamsTab() : S.tab === 'settings' ? settingsTab() : weekTab();
    } catch (e) { body = `<div class="or-empty">Could not draw this tab: ${esc(e.message)}</div>`; }
    host.innerHTML = `<div class="or-wrap">${hero()}${tabs()}<div class="or-body">${body}</div></div>`;
  }

  /* ---------------------------------------------------------------- This week */
  const pill = s => { const x = ST[s] || [s, 'grey']; return `<span class="or-pill or-${x[1]}">${esc(x[0])}</span>`; };
  const rag = r => r ? `<span class="or-rag or-rag-${r}"><i></i>${RAG[r]}</span>` : '<span class="or-muted">—</span>';
  function tile(label, v, sub, tone, act) {
    return `<button class="or-tile ${tone ? 'or-t-' + tone : ''}" ${act || ''}><span class="or-tl">${label}</span><span class="or-tv">${v}</span>${sub ? `<span class="or-ts">${sub}</span>` : ''}</button>`;
  }
  function weekTab() {
    const o = S.ov; if (!o) return '<div class="or-empty">Loading…</div>';
    const t = o.totals, m = me();
    let h = `<div class="or-tiles">
      ${tile('Reported', `${t.submitted}<small>/${t.teams}</small>`, `${t.approved} approved · ${t.received} to review`, t.submitted === t.teams && t.teams ? 'ok' : null)}
      ${tile('Missing', t.missing, t.pending ? `${t.pending} not due yet` : 'after the due time', t.missing ? 'bad' : 'ok')}
      ${tile('Late', t.late, 'sent after the due time', t.late ? 'warn' : null)}
      ${tile('RAG', `<span class="or-rgb"><b class="r">${t.red}</b><b class="a">${t.amber}</b><b class="g">${t.green}</b></span>`, 'red · amber · green', t.red ? 'bad' : t.amber ? 'warn' : 'ok')}
      ${tile('Open actions', t.actionsOpen, `${t.actionsSalam} waiting on Salam`, null, 'data-act="tab" data-k="actions"')}
      ${tile('Overdue actions', t.actionsOverdue, 'ETA passed', t.actionsOverdue ? 'bad' : 'ok', 'data-act="tab" data-k="actions" data-overdue="1"')}
    </div>`;
    h += decksCard();
    if (!o.rows.length) return h + `<div class="or-empty">No team yet. ${m.canTeams ? '<button class="or-link" data-act="tab" data-k="teams">Add the teams that report</button>' : 'ITSM adds the teams that report.'}</div>`;
    h += `<div class="or-card"><div class="or-ch"><div><div class="or-ck">Status table</div><div class="or-ct">Who reported for ${range(o.from, o.to)}</div></div>
      <div class="or-legend">${Object.keys(ST).map(k => pill(k)).join('')}</div></div>
      <div class="or-tblw"><table class="or-tbl or-cards"><thead><tr><th>Team</th><th>Status</th><th>RAG</th><th>Headline · KPIs</th><th>Actions</th><th>Due</th><th></th></tr></thead><tbody>`;
    o.rows.forEach(r => {
      const rp = r.report, writable = (m.teamsWritable || []).includes(r.team.id), own = m.editor || (m.ownerOf || []).includes(r.team.id);
      const kpis = rp ? rp.kpis.slice(0, 4).map(k => `<span class="or-kchip or-k-${k.status || 'none'}" title="${esc(k.name)} — target ${k.cmp === '<=' ? '≤' : '≥'} ${esc(k.target)}">${esc(k.name.length > 22 ? k.name.slice(0, 21) + '…' : k.name)} <b>${k.value == null ? '—' : esc(k.value) + (k.unit === '%' ? '%' : '')}</b></span>`).join('') : '';
      h += `<tr class="or-row" data-act="open" data-team="${esc(r.team.key)}">
        <td><div class="or-tn">${esc(r.team.name)}</div><div class="or-ts2">${esc(r.team.vendor || '')}${r.team.tower ? ` · ${esc(TOWER[r.team.tower] || r.team.tower)}` : ''}${r.team.ownerNames.length ? ` · ${esc(r.team.ownerNames.join(', '))}` : ''}</div></td>
        <td>${pill(r.status)}${r.late && !['pending', 'missing'].includes(r.status) ? ' <span class="or-late">late</span>' : ''}${rp && rp.files ? `<div class="or-ts2">${rp.files} file${rp.files > 1 ? 's' : ''}${rp.submittedAt ? ` · ${esc(when(rp.submittedAt))}` : ''}</div>` : ''}</td>
        <td>${rag(rp && rp.rag)}${r.prevRag && rp && rp.rag && r.prevRag !== rp.rag ? `<div class="or-ts2">was ${esc(RAG[r.prevRag])}</div>` : ''}</td>
        <td class="or-hl">${rp && rp.headline ? `<div class="or-hlt">${esc(rp.headline)}</div>` : ''}<div class="or-kchips">${kpis}</div></td>
        <td class="or-nowrap">${r.actions.open ? `${r.actions.open} open` : '—'}${r.actions.overdue ? `<div class="or-bad">${r.actions.overdue} overdue</div>` : ''}${r.actions.salam ? `<div class="or-ts2">${r.actions.salam} on Salam</div>` : ''}</td>
        <td class="or-nowrap">${esc(when(r.due))}</td>
        <td class="or-nowrap or-racts">${writable ? `<button class="or-mini" data-act="upload" data-team="${esc(r.team.key)}" title="Upload">${svg(IC.up, 14)}</button>` : ''}${own && ['missing', 'pending', 'draft', 'received', 'returned'].includes(r.status) ? `<button class="or-mini" data-act="followup" data-team="${esc(r.team.key)}" data-kind="${r.status === 'pending' ? 'reminder' : 'late'}" title="${r.status === 'pending' ? 'Send a reminder' : 'Send a follow-up'}">${svg(IC.mail, 14)}</button>` : ''}${own && r.team.dropEnabled ? `<button class="or-mini" data-act="droplink" data-team="${esc(r.team.key)}" title="Vendor upload link">${svg(IC.link, 14)}</button>` : ''}</td></tr>`;
    });
    h += `</tbody></table></div></div>`;
    return h;
  }

  /* ---------------------------------------------------------------- Weekly decks (This week) */
  const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB';
  const PPT_IC = '<span class="or-dk-ic" aria-hidden="true">P</span>';
  function deckTile(kind, meta, title, sub, d) {
    return `<div class="or-dk ${meta ? '' : 'or-dk-empty'}">${PPT_IC}
      <div class="or-dk-b"><div class="or-dk-t">${esc(title)}</div>
        <div class="or-ts2">${meta ? `${meta.slides} slides · ${fmtSize(meta.size)} · ${esc(when(meta.createdAt))}${kind === 'exec' && d.edited ? ' · <b>text edited by ITSM</b>' : ''}` : `${esc(sub)} — not built yet`}</div></div>
      ${meta ? `<button class="or-btn" data-act="deckdl" data-id="${meta.id}" data-name="${esc(meta.name)}">${svg(IC.dl, 14)} Download</button>` : ''}</div>`;
  }
  function decksCard() {
    const o = S.ov, d = S.decks[o.week];
    if (d === undefined) { loadDecks(o.week); return '<div class="or-card or-decks"><div class="or-empty">Loading the weekly decks…</div></div>'; }
    if (!d) return '';
    const built = d.exec || d.complete, done = d.teams.filter(t => t.done).length, wait = d.teams.filter(t => !t.done);
    const by = m => m.trigger === 'auto' ? 'automatically, once every report was in' : m.trigger === 'edited' ? `with the text edited by ${esc(m.createdByName || m.createdBy || 'ITSM')}` : `by ${esc(m.createdByName || m.createdBy || 'ITSM')}`;
    let state, tone = '';
    if (d.building) { state = 'Building the two decks — about a minute…'; tone = 'blue'; }
    else if (built && d.stale) { state = d.ready && d.auto ? 'A report changed since the last build — the decks are rebuilt automatically within a minute.' : 'A report changed since the last build — rebuild to include it.'; tone = 'amber'; }
    else if (d.complete && d.complete.partial) { state = `Built ${by(d.complete)} before every report was in — missing: ${esc(d.complete.missing.join(', ') || '—')}.${d.auto ? ' Rebuilt automatically when the last one arrives.' : ''}`; tone = 'amber'; }
    else if (built) { const m = d.complete || d.exec; state = `Ready — built ${esc(when(m.createdAt))} ${by(m)}.`; tone = 'ok'; }
    else if (d.ready) { state = d.auto ? 'Every report is in — the decks are being built (within a minute).' : 'Every report is in — build the decks.'; tone = 'blue'; }
    else state = `${d.auto ? 'Built automatically' : 'Ready to build'} once every team below has ${d.when === 'approved' ? 'been approved by ITSM' : 'submitted'} — ${done} of ${d.teams.length} in${wait.length ? `, waiting for ${esc(wait.map(t => t.name).join(', '))}` : ''}.`;
    const chip = t => `<span class="or-tchip ${t.done ? 'ok' : t.status === 'missing' ? 'bad' : 'wait'}" title="${esc(t.name)} — ${esc(t.done ? 'in' : (ST[t.status] || [t.status])[0])}${t.files ? ` · ${t.files} file(s)` : ''}">${t.done ? svg(IC.check, 12) : ''}${esc(t.name)}${t.done ? '' : ` <i>${esc((ST[t.status] || [t.status])[0])}</i>`}</span>`;
    let h = `<div class="or-card or-decks">
      <div class="or-ch"><div><div class="or-ck">Weekly decks · Salam template</div><div class="or-ct">Executive report and complete status report</div>
        <div class="or-cs or-dk-state ${tone ? 'or-dk-' + tone : ''}">${state}</div></div>
        ${d.canBuild ? `<div class="or-factions"><button class="or-btn or-btn-sec" data-act="deckedit" ${d.content ? '' : 'disabled'}>Edit executive text</button><button class="or-btn" data-act="deckbuild" ${d.building ? 'disabled' : ''}>${svg(IC.refresh, 14)} ${built ? 'Rebuild now' : 'Build now'}</button></div>` : ''}</div>
      ${d.templateOk === false ? '<div class="or-warnbox">The deck template is missing on this server (server/templates/opsreports-deck-template.pptx) — deploy again.</div>' : ''}
      ${d.unknown && d.unknown.length ? `<div class="or-warnbox">Settings › Weekly decks name teams that do not exist: ${esc(d.unknown.join(', '))}.</div>` : ''}
      <div class="or-dk-grid">
        ${deckTile('exec', d.exec, 'Operational Weekly Executive Report', 'Brief · 6 executive areas · focus for next week', d)}
        ${deckTile('complete', d.complete, 'Application Operational weekly status report', 'Every domain with the vendors’ own slides', d)}
      </div>
      <div class="or-tchips"><span class="or-ts2">Teams in the decks</span>${d.teams.map(chip).join('')}</div>`;
    const rep = d.complete && d.complete.report;
    if (rep && rep.length) h += `<details class="or-dk-det"><summary>What went into the complete deck</summary><div class="or-tblw"><table class="or-tbl"><thead><tr><th>Section</th><th>Slides</th><th>From</th></tr></thead><tbody>${rep.map(l => `<tr><td class="or-tn">${esc(l.domain)}</td><td>${l.slides}</td><td>${l.sources.map(x => `<div>${esc(x.file || x.label)}${x.of ? ` <span class="or-ts2">${x.slides} of ${x.of}</span>` : ''}${x.note ? `<div class="or-ts2 ${x.error || !x.slides ? 'or-warn' : ''}">${esc(x.note)}</div>` : ''}</div>`).join('') || '—'}</td></tr>`).join('')}</tbody></table></div></details>`;
    return h + '</div>';
  }
  let deckTimer = null;
  async function loadDecks(week) {
    let d = null;
    try { d = await api('/api/opsreports/decks?week=' + encodeURIComponent(week)); } catch (e) { d = null; }
    S.decks[week] = d;
    if (S.open && S.tab === 'week' && S.ov && S.ov.week === week && !$('#orModal.open')) render();
    clearTimeout(deckTimer);
    if (d && S.open && (d.building || (d.ready && d.auto && (!(d.exec || d.complete) || d.stale)))) deckTimer = setTimeout(() => { if (S.open && S.ov && S.ov.week === week) loadDecks(week); }, 6000);
  }
  function deckEditForm(c) {
    const rows = (c.rows || []).map((r, i) => `<tr data-r="${i}">${[0, 1, 2].map(k => `<td data-l="${['Executive area', 'Weekly outcome', 'Leadership attention'][k]}"><textarea class="or-in" rows="${k ? 3 : 2}" data-c="${k}">${esc(r[k] || '')}</textarea></td>`).join('')}</tr>`).join('');
    return `<div class="or-form" id="orDeckForm">
      <div class="or-fg2"><label>Cover line<input class="or-in" name="cover_sub" value="${esc(c.cover_sub || '')}"></label><label>Brief title<input class="or-in" name="brief_title" value="${esc(c.brief_title || '')}"></label></div>
      <label>Executive brief<textarea class="or-in" name="brief" rows="4">${esc(c.brief || '')}</textarea></label>
      <label>Headline lines — one per line<textarea class="or-in" name="headlines" rows="4">${esc((c.headlines || []).join('\n'))}</textarea></label>
      <div class="or-sub2">Executive areas <span class="or-ts2">two or three lines per cell, or the table runs off the slide</span></div>
      <div class="or-tblw"><table class="or-mtbl or-dk-rows"><thead><tr><th>Executive area</th><th>Weekly outcome</th><th>Leadership attention</th></tr></thead><tbody>${rows}</tbody></table></div>
      <label>Focus for next week — one per line (six at most)<textarea class="or-in" name="focus" rows="6">${esc((c.focus || []).join('\n'))}</textarea></label>
      <div class="or-ts2">${c.edited ? `Edited${c.editedBy ? ' by ' + esc(c.editedBy) : ''}${c.editedAt ? ' · ' + esc(when(c.editedAt)) : ''} — kept when the decks are rebuilt.` : 'Written from the submitted reports. Once you save, your text is kept when the decks are rebuilt.'}</div>
      <div class="or-msg"></div>
      <div class="or-factions"><button class="or-btn" data-act="decksave">${svg(IC.check, 14)} Save and rebuild the executive deck</button>${c.edited ? '<button class="or-btn or-btn-sec" data-act="deckreset">Back to the automatic text</button>' : ''}</div></div>`;
  }
  function deckEditModal() {
    const d = S.decks[S.ov.week]; if (!d || !d.content) return;
    modal(`Executive text · ${range(S.ov.from, S.ov.to)}<span class="or-mts">Operational Weekly Executive Report — slides 2 to 4</span>`, deckEditForm(d.content), true);
  }
  function readDeckForm() {
    const root = $('#orDeckForm'), v = n => root.querySelector(`[name="${n}"]`).value;
    return { cover_sub: v('cover_sub'), brief_title: v('brief_title'), brief: v('brief'), headlines: lines(v('headlines')), focus: lines(v('focus')),
      rows: $$('tr[data-r]', root).map(tr => [0, 1, 2].map(k => tr.querySelector(`[data-c="${k}"]`).value.trim())) };
  }

  /* ---------------------------------------------------------------- Actions */
  function actionsTab() {
    if (!S.actions) { loadActions(); return '<div class="or-empty">Loading the action tracker…</div>'; }
    const f = S.actFilter;
    const teams = [...new Set(S.actions.map(a => a.team))].sort();
    let list = S.actions.filter(a => (!f.team || a.team === f.team) && (f.status === 'all' || (f.status === 'open' ? a.open : a.status === f.status)) && (!f.overdue || a.overdue)
      && (!f.salam || a.status === 'waiting_salam' || a.salamDep) && (!f.q || (a.title + ' ' + (a.ref || '') + ' ' + (a.owner || '')).toLowerCase().includes(f.q.toLowerCase())));
    const can = id => (me().teamsWritable || []).includes(id);
    let h = `<div class="or-card"><div class="or-ch"><div><div class="or-ck">Action tracker</div><div class="or-ct">${list.length} action${list.length === 1 ? '' : 's'}</div>
      <div class="or-cs">Built from every submitted report: new items are added, an ETA that moves is kept as history, items waiting on Salam are flagged.</div></div></div>
      <div class="or-filt">
        <select data-f="team"><option value="">All teams</option>${teams.map(t => `<option ${f.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <select data-f="status"><option value="open" ${f.status === 'open' ? 'selected' : ''}>Open (all open states)</option>${Object.entries(ACT).map(([k, l]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}<option value="all" ${f.status === 'all' ? 'selected' : ''}>Everything</option></select>
        <label class="or-chk"><input type="checkbox" data-f="overdue" ${f.overdue ? 'checked' : ''}> Overdue only</label>
        <label class="or-chk"><input type="checkbox" data-f="salam" ${f.salam ? 'checked' : ''}> Waiting on Salam</label>
        <input type="search" data-f="q" placeholder="Search title, ref, owner" value="${esc(f.q)}">
      </div>
      <div class="or-tblw"><table class="or-tbl"><thead><tr><th>Team</th><th>Action</th><th>Owner</th><th>ETA</th><th>Status</th><th>Age</th><th>Latest update</th></tr></thead><tbody>`;
    if (!list.length) h += `<tr><td colspan="7" class="or-empty">Nothing here.</td></tr>`;
    list.slice(0, 500).forEach(a => {
      const w = can(a.teamId);
      h += `<tr data-aid="${a.id}"><td class="or-nowrap">${esc(a.team)}</td>
        <td>${a.ref && !/^T-/.test(a.ref) ? `<span class="or-ref">${esc(a.ref)}</span> ` : ''}${esc(a.title)}${a.salamDep ? ' <span class="or-pill or-amber">Salam</span>' : ''}</td>
        <td>${w ? `<input class="or-in" data-af="owner" value="${esc(a.owner || '')}">` : esc(a.owner || '—')}</td>
        <td class="or-nowrap ${a.overdue ? 'or-bad' : ''}">${w ? `<input type="date" class="or-in" data-af="eta" value="${esc(a.eta || '')}">` : esc(a.eta ? dshort(a.eta) : (a.etaRaw || '—'))}${a.etaMoves ? `<div class="or-ts2" title="${esc(a.etaHistory.map(x => `${x.from} → ${x.to}`).join('\n'))}">moved ${a.etaMoves}×</div>` : ''}</td>
        <td>${w ? `<select class="or-in" data-af="status">${Object.entries(ACT).map(([k, l]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : esc(ACT[a.status] || a.status)}</td>
        <td class="or-nowrap">${a.ageDays == null ? '—' : a.ageDays + ' d'}</td>
        <td>${w ? `<input class="or-in or-wide" data-af="update" value="${esc(a.update || '')}" placeholder="Latest update">` : esc(a.update || '')}</td></tr>`;
    });
    h += `</tbody></table></div>${list.length > 500 ? '<div class="or-ts2">first 500 shown — narrow the filters</div>' : ''}</div>`;
    return h;
  }

  /* ---------------------------------------------------------------- ITSM (ServiceNow, native) */
  function bars(list, opts) {
    opts = opts || {};
    if (!list) return '<div class="or-muted">not available</div>';
    if (!list.length) return '<div class="or-muted">no record</div>';
    const top = list.slice(0, opts.top || 10), max = Math.max(1, ...top.map(x => x.n));
    return `<div class="or-bars">${top.map(x => `<div class="or-bar"><span class="or-bl" title="${esc(x.label)}">${esc(x.label)}</span><span class="or-bt"><i style="width:${Math.max(2, x.n * 100 / max)}%;${opts.color ? 'background:' + opts.color : ''}"></i></span><b>${num(x.n)}</b></div>`).join('')}${list.length > top.length ? `<div class="or-ts2">+ ${list.length - top.length} more</div>` : ''}</div>`;
  }
  function spark(trend) {
    if (!trend || !trend.length) return '<div class="or-muted">no record</div>';
    const W = 640, H = 120, max = Math.max(1, ...trend.map(x => x.n)), step = trend.length > 1 ? W / (trend.length - 1) : W;
    const pts = trend.map((x, i) => `${(i * step).toFixed(1)},${(H - 8 - x.n * (H - 20) / max).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="or-spark" preserveAspectRatio="none" role="img" aria-label="Incidents per day"><polyline points="0,${H} ${pts} ${W},${H}" class="or-sa"/><polyline points="${pts}" class="or-sl"/></svg>
      <div class="or-sx"><span>${esc(dshort(trend[0].day))}</span><span>peak ${num(max)} / day</span><span>${esc(dshort(trend[trend.length - 1].day))}</span></div>`;
  }
  const panel = (title, inner, wide) => `<div class="or-panel ${wide ? 'or-wide2' : ''}"><div class="or-pt">${title}</div>${inner}</div>`;
  function itsmTab() {
    const d = S.itsm;
    const url = (d && d.dashboardUrl) || (S.ov && S.ov.servicenow && S.ov.servicenow.dashboardUrl) || '';
    const head = `<div class="or-card or-snhead"><div><div class="or-ck">ServiceHub · Unified ITSM Dashboards</div><div class="or-ct">Incident · Problem · Change · Request · Work order</div>
      <div class="or-cs">Drawn in the console from the ServiceNow API. ServiceHub itself cannot be embedded (it refuses to be framed and asks for its own sign-in) — use the button for the drill-down.</div></div>
      <div class="or-shr"><div class="or-seg">${[7, 30, 90].map(n => `<button class="${S.itsmDays === n ? 'on' : ''}" data-act="itsmdays" data-n="${n}">${n} d</button>`).join('')}</div>
      <button class="or-btn or-btn-sec" data-act="itsmrefresh">${svg(IC.refresh, 14)} Refresh</button>${url ? `<a class="or-btn" href="${esc(url)}" target="_blank" rel="noopener">${svg(IC.ext, 14)} Open in ServiceHub</a>` : ''}</div></div>`;
    if (!d) { loadItsm(); return head + '<div class="or-empty">Reading ServiceNow…</div>'; }
    if (d.error) return head + `<div class="or-empty or-bad">${esc(d.error)}</div>`;
    if (!d.configured) return head + `<div class="or-card"><div class="or-ct">ServiceNow is not connected yet</div>
      <p class="or-cs">The panels appear as soon as the read-only integration account is set on the console server (152, <code>/apps/unified/.env</code>): <code>SN_URL=https://servicehub.salam.sa</code>, <code>SN_USER</code>, <code>SN_PASS</code>.
      The account needs read access to <b>incident, task_sla, problem, change_request, sc_req_item, wm_order</b> and the Aggregate (stats) API. Until then, the consolidated report uses the CAB week and the counters each team reports.</p></div>`;
    const i = d.incident || {};
    const sub = [['incident', 'Incident'], ['problem', 'Problem'], ['change', 'Change'], ['request', 'Request'], ['workorder', 'Work order']];
    let h = head + `<div class="or-tabs or-tabs-sm">${sub.map(([k, l]) => `<button class="${S.itsmTab === k ? 'on' : ''}" data-act="itsmtab" data-k="${k}">${l}</button>`).join('')}</div>`;
    h += `<div class="or-ts2" style="margin:2px 0 10px">${esc(dt(d.from))} → ${esc(dt(d.to))}${d.cached ? ' · cached' : ''}${d.errors && d.errors.length ? ` · <span class="or-bad" title="${esc(d.errors.join('\n'))}">${d.errors.length} panel(s) could not be read</span>` : ''}</div>`;
    if (S.itsmTab === 'incident') {
      const sla = d.sla || {}, slaBar = (k, label) => { const x = sla[k] || {}; const t = (x.met || 0) + (x.breached || 0); return `<div class="or-sla"><div class="or-slal">${label} <b>${x.pct == null ? '—' : x.pct + '% met'}</b></div><div class="or-slab"><i class="m" style="width:${t ? x.met * 100 / t : 0}%"></i><i class="b" style="width:${t ? x.breached * 100 / t : 0}%"></i></div><div class="or-ts2">${num(x.met)} met · ${num(x.breached)} breached</div></div>`; };
      h += `<div class="or-tiles or-tiles-4">${tile('Incidents opened', num(i.total), `${S.itsmDays} days`)}${tile('Open now', num(i.open), 'active backlog', i.open > 500 ? 'warn' : null)}
        ${tile('Average time to resolve', i.avgResolveHours == null ? '—' : i.avgResolveHours >= 48 ? `${Math.floor(i.avgResolveHours / 24)} d ${Math.round(i.avgResolveHours % 24)} h` : `${i.avgResolveHours} h`, 'calendar time, resolved in the window')}
        ${tile('Resolution SLA', sla.resolution && sla.resolution.pct != null ? sla.resolution.pct + '%' : '—', 'met', sla.resolution && sla.resolution.pct != null && sla.resolution.pct < 90 ? 'warn' : 'ok')}</div>
        <div class="or-grid">
        ${panel('Volume & trend (per day)', spark(i.trend), true)}
        ${panel('Incidents per category', bars(i.byCategory))}
        ${panel('Incidents by priority', bars(i.byPriority, { color: 'var(--amber)' }))}
        ${panel('Incidents by close code', bars(i.byCloseCode))}
        ${panel('Assignment group performance', bars(i.byGroup, { top: 12 }))}
        ${panel('Incident creation channels', bars(i.byChannel, { color: 'var(--blue)' }))}
        ${panel('Reopened incidents by category', bars(i.reopened, { color: 'var(--red)' }))}
        ${panel('Ageing & backlog (open)', bars(i.aging, { top: 8, color: 'var(--purple)' }))}
        ${panel('SLA met vs breached', slaBar('resolution', 'Resolution') + slaBar('response', 'Response'))}
        ${panel('Open incidents per state & group', bars(i.byStateGroup, { top: 12 }), true)}
        </div>`;
    } else if (S.itsmTab === 'problem') h += `<div class="or-grid">${panel(`Open problems by state · ${num(d.problem.opened)} opened in the window`, bars(d.problem.byState), true)}</div>`;
    else if (S.itsmTab === 'change') h += `<div class="or-tiles or-tiles-4">${tile('Changes in the window', num(d.change.total), 'by planned start')}${tile('Emergency share', d.change.emergencyPct == null ? '—' : d.change.emergencyPct + '%', 'target < 10%', d.change.emergencyPct > 10 ? 'bad' : 'ok')}</div><div class="or-grid">${panel('Changes by state', bars(d.change.byState))}${panel('Changes by type', bars(d.change.byType))}</div>`;
    else if (S.itsmTab === 'request') h += `<div class="or-tiles or-tiles-4">${tile('Requests open', num(d.request.open), 'requested items, active')}</div><div class="or-grid">${panel('Requested items opened in the window, by state', bars(d.request.byState), true)}</div>`;
    else h += `<div class="or-grid">${panel('Work orders opened in the window, by state', bars(d.workorder.byState), true)}</div>`;
    return h;
  }

  /* ---------------------------------------------------------------- Library */
  function libraryTab() {
    if (!S.lib) { loadLib(); return '<div class="or-empty">Loading the library…</div>'; }
    const byWeek = {}; S.lib.reports.forEach(r => { (byWeek[r.week] = byWeek[r.week] || []).push(r); }); (S.lib.decks || []).forEach(x => { byWeek[x.week] = byWeek[x.week] || []; });
    const weeks = Object.keys(byWeek).sort().reverse();
    if (!weeks.length) return '<div class="or-empty">No report stored yet.</div>';
    return weeks.map(w => `<div class="or-card"><div class="or-ch"><div><div class="or-ck">Week</div><div class="or-ct">${range(w, addDay(w, 6))}</div></div><div class="or-factions">${(S.lib.decks || []).filter(x => x.week === w).map(x => `<button class="or-file or-file-deck" data-act="deckdl" data-id="${x.id}" data-name="${esc(x.name)}" title="${esc(x.name)} · ${x.slides} slides · ${fmtSize(x.size)}">${PPT_IC} ${x.kind === 'exec' ? 'Executive report' : 'Complete status report'}</button>`).join('')}<button class="or-link" data-act="gotoweek" data-w="${w}">Status table of this week →</button></div></div>
      <div class="or-tblw"><table class="or-tbl"><thead><tr><th>Team</th><th>Status</th><th>RAG</th><th>Headline</th><th>Files</th></tr></thead><tbody>
      ${byWeek[w].map(r => `<tr><td><button class="or-link" data-act="openrep" data-team="${r.teamId}" data-w="${w}">${esc(r.team)}</button></td><td>${pill(r.status)}${r.late ? ' <span class="or-late">late</span>' : ''}<div class="or-ts2">${esc(r.submittedByName || '')}${r.submittedAt ? ' · ' + esc(when(r.submittedAt)) : ''}</div></td><td>${rag(r.rag)}</td><td>${esc(r.headline || '')}</td>
        <td>${r.files.map(f => `<button class="or-file" data-act="dl" data-id="${f.id}" data-name="${esc(f.name)}" title="${esc(f.name)} · ${Math.round(f.size / 1024)} KB">${svg(IC.file, 13)} ${esc(f.name.length > 34 ? f.name.slice(0, 33) + '…' : f.name)}</button>`).join('') || '—'}</td></tr>`).join('')}
      </tbody></table></div></div>`).join('');
  }

  /* ---------------------------------------------------------------- Teams */
  function teamsTab() {
    if (!S.teams) { loadTeams(); return '<div class="or-empty">Loading teams…</div>'; }
    let h = `<div class="or-card"><div class="or-ch"><div><div class="or-ck">Teams that report</div><div class="or-ct">${S.teams.filter(t => t.active).length} active</div>
      <div class="or-cs">Each team reports in its own format. Name the Salam owner (SPOC), the people who upload, the vendor contacts (follow-up mails, upload link) and the KPIs with their targets.</div></div>
      <button class="or-btn" data-act="teamedit" data-id="">${svg(IC.plus, 14)} New team</button></div>
      <div class="or-tblw"><table class="or-tbl"><thead><tr><th>Team</th><th>Tower</th><th>Week · due</th><th>Owners</th><th>Uploaders · vendor contacts</th><th>KPIs</th><th>Links</th><th></th></tr></thead><tbody>`;
    S.teams.forEach(t => {
      h += `<tr class="${t.active ? '' : 'or-off'}"><td><div class="or-tn">${esc(t.name)}</div><div class="or-ts2">${esc(t.vendor || '')}${t.domain ? ' · ' + esc(t.domain) : ''}</div></td>
        <td>${esc(TOWER[t.tower] || t.tower || '—')}<div class="or-ts2">${esc(t.segment)}</div></td>
        <td class="or-nowrap">${t.weekStart ? 'Mon–Sun' : 'Sun–Sat'}<div class="or-ts2">${t.dueDay == null && !t.dueTime ? 'default due' : `${DAYS[t.dueDay == null ? 0 : t.dueDay].slice(0, 3)} ${esc(t.dueTime || '')}`}</div></td>
        <td>${t.ownerNames.length ? esc(t.ownerNames.join(', ')) : '<span class="or-bad">none</span>'}</td>
        <td>${t.uploaderNames.length ? esc(t.uploaderNames.join(', ')) : '—'}${t.vendorContacts.length ? `<div class="or-ts2">${esc(t.vendorContacts.map(c => c.name || c.email).join(', '))}</div>` : ''}${t.notUsers.length ? `<div class="or-ts2 or-warn" title="${esc(t.notUsers.join('\n'))}">${t.notUsers.length} not a console user — add them (role Report contributor) or use the upload link</div>` : ''}</td>
        <td>${t.kpis.length}</td><td>${t.dropEnabled ? `${t.dropLinks} open` : 'off'}</td>
        <td><button class="or-btn or-btn-sec" data-act="teamedit" data-id="${t.id}">Edit</button></td></tr>`;
    });
    return h + `</tbody></table></div></div>`;
  }
  function teamForm(t) {
    t = t || { active: true, segment: 'both', weekStart: 0, kpis: [], vendorContacts: [], owners: [], uploaders: [], cc: [] };
    const kRow = k => `<tr class="or-krow"><td><input type="hidden" data-k="key" value="${esc(k.key || '')}"><input class="or-in" data-k="name" value="${esc(k.name || '')}" placeholder="Availability"></td><td><select class="or-in" data-k="cmp"><option value=">=" ${k.cmp !== '<=' ? 'selected' : ''}>≥</option><option value="<=" ${k.cmp === '<=' ? 'selected' : ''}>≤</option></select></td>
      <td><input class="or-in or-n" data-k="target" value="${esc(k.target == null ? '' : k.target)}"></td><td><input class="or-in or-n" data-k="amber" value="${esc(k.amber == null ? '' : k.amber)}" placeholder="amber"></td><td><input class="or-in or-n" data-k="unit" value="${esc(k.unit || '')}" placeholder="%"></td>
      <td><input class="or-in" data-k="match" value="${esc(k.match || '')}" placeholder="word in the vendor file"></td>
      <td><select class="or-in" data-k="agg"><option value="">first found</option><option value="max" ${k.agg === 'max' ? 'selected' : ''}>highest</option><option value="min" ${k.agg === 'min' ? 'selected' : ''}>lowest</option></select></td><td><button class="or-mini" data-act="rmrow">${svg(IC.x, 13)}</button></td></tr>`;
    const cRow = c => `<tr class="or-crow"><td><input class="or-in" data-c="name" value="${esc(c.name || '')}" placeholder="Name"></td><td><input class="or-in" data-c="email" value="${esc(c.email || '')}" placeholder="email"></td><td><input class="or-in" data-c="role" value="${esc(c.role || '')}" placeholder="Role"></td><td><button class="or-mini" data-act="rmrow">${svg(IC.x, 13)}</button></td></tr>`;
    return `<div class="or-form" data-team="${t.id || ''}">
      <div class="or-fg2"><label>Team name<input class="or-in" name="name" value="${esc(t.name || '')}" required></label><label>Vendor<input class="or-in" name="vendor" value="${esc(t.vendor || '')}"></label></div>
      <label>Domain / scope<input class="or-in" name="domain" value="${esc(t.domain || '')}"></label>
      <div class="or-fg3"><label>Tower<select class="or-in" name="tower"><option value="">—</option>${Object.entries(TOWER).map(([k, l]) => `<option value="${k}" ${t.tower === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Business<select class="or-in" name="segment">${['both', 'mobile', 'fixed'].map(s => `<option ${t.segment === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Order<input class="or-in or-n" name="sort" value="${esc(t.sort || 100)}"></label></div>
      <div class="or-fg3"><label>Reporting week<select class="or-in" name="weekStart"><option value="0" ${!t.weekStart ? 'selected' : ''}>Sunday → Saturday</option><option value="1" ${t.weekStart === 1 ? 'selected' : ''}>Monday → Sunday</option></select></label>
        <label>Due day<select class="or-in" name="dueDay"><option value="">Default</option>${DAYS.map((d, i) => `<option value="${i}" ${t.dueDay === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label>Due time (KSA)<input class="or-in" name="dueTime" placeholder="default" value="${esc(t.dueTime || '')}"></label></div>
      <label>Format they send<textarea class="or-in" name="formatNote" rows="2">${esc(t.formatNote || '')}</textarea></label>
      <label>Salam owners (SPOC) — e-mails<input class="or-in" name="owners" value="${esc((t.owners || []).join(', '))}"></label>
      <label>Uploaders (console users) — e-mails<input class="or-in" name="uploaders" value="${esc((t.uploaders || []).join(', '))}"></label>
      <label>Always in cc of the follow-ups<input class="or-in" name="cc" value="${esc((t.cc || []).join(', '))}"></label>
      <div class="or-sub2">Vendor contacts <span class="or-ts2">reminders and late mails, with the upload link when it is on</span></div>
      <table class="or-mtbl"><tbody id="orCRows">${(t.vendorContacts || []).map(cRow).join('')}</tbody></table><button class="or-link" data-act="addcontact">+ contact</button>
      <label class="or-chk"><input type="checkbox" name="dropEnabled" ${t.dropEnabled ? 'checked' : ''}> Vendor upload link (no console account needed — expiring, one team)</label>
      <div class="or-sub2">KPIs and targets <span class="or-ts2">“word in the vendor file” lets the console find the value by itself</span></div>
      <table class="or-mtbl"><thead><tr><th>KPI</th><th></th><th>Target</th><th>Amber</th><th>Unit</th><th>Found by</th><th>If several</th><th></th></tr></thead><tbody id="orKRows">${(t.kpis || []).map(kRow).join('')}</tbody></table><button class="or-link" data-act="addkpi">+ KPI</button>
      <label class="or-chk"><input type="checkbox" name="active" ${t.active !== false ? 'checked' : ''}> Active (reports every week)</label>
      <div class="or-msg"></div>
      <div class="or-factions"><button class="or-btn" data-act="teamsave">Save team</button></div></div>`;
  }

  /* ---------------------------------------------------------------- Settings */
  function settingsTab() {
    if (!S.cfg) { loadCfg(); return '<div class="or-empty">Loading settings…</div>'; }
    const c = S.cfg.settings, m = S.cfg.me || me();
    const dsel = (name, v) => `<select class="or-in" name="${name}">${DAYS.map((d, i) => `<option value="${i}" ${v === i ? 'selected' : ''}>${d}</option>`).join('')}</select>`;
    let h = `<div class="or-card or-form" id="orCfg">
      <div class="or-ch"><div><div class="or-ck">Settings</div><div class="or-ct">Rhythm, recipients and who runs the process</div>
      <div class="or-cs">${S.cfg.smtp ? 'Mail is configured.' : '<b class="or-bad">SMTP is not configured on this server — nothing is mailed.</b>'}${S.cfg.mailOff ? ' <b class="or-bad">OPSR_MAIL=0: scheduled mails are off.</b>' : ''} ServiceNow: ${S.cfg.servicenowConfigured ? 'connected' : 'not connected'}.</div></div></div>
      <label>ITSM editors (run the process: every team, review, follow-ups, consolidated) — e-mails ${m.canEditors ? '' : '<span class="or-ts2">(admins change this list)</span>'}<input class="or-in" name="editors" value="${esc(c.editors.join(', '))}" ${m.canEditors ? '' : 'disabled'}></label>
      <label>Salam management — receives the consolidated report<input class="or-in" name="management" value="${esc(c.management.join(', '))}"></label>
      <label>ITSM team — in cc of every late follow-up<input class="or-in" name="itsmCc" value="${esc(c.itsmCc.join(', '))}"></label>
      <div class="or-fg3"><label>Report due day${dsel('dueDay', c.dueDay)}</label><label>Due time (KSA)<input class="or-in" name="dueTime" value="${esc(c.dueTime)}"></label><label>Max file (MB)<input class="or-in or-n" name="maxFileMB" value="${c.maxFileMB}"></label></div>
      <div class="or-sub2">Reminder <label class="or-chk"><input type="checkbox" name="rem_enabled" ${c.reminder.enabled ? 'checked' : ''}> on</label></div>
      <div class="or-fg3"><label>Day${dsel('rem_day', c.reminder.day)}</label><label>Time<input class="or-in" name="rem_time" value="${esc(c.reminder.time)}"></label><label>Upload links valid (days)<input class="or-in or-n" name="dropDays" value="${c.dropDays}"></label></div>
      <div class="or-sub2">Late follow-ups <label class="or-chk"><input type="checkbox" name="late_enabled" ${c.late.enabled ? 'checked' : ''}> on</label></div>
      <div class="or-fg3"><label>First, minutes after due<input class="or-in or-n" name="late_grace" value="${c.late.graceMin}"></label><label>Then daily at (hour)<input class="or-in or-n" name="late_hour" value="${c.late.hour}"></label><label>At most<input class="or-in or-n" name="late_max" value="${c.late.max}"></label></div>
      <div class="or-sub2">Consolidated report <label class="or-chk"><input type="checkbox" name="cons_enabled" ${c.consolidated.enabled ? 'checked' : ''}> on</label></div>
      <div class="or-fg3"><label>Day${dsel('cons_day', c.consolidated.day)}</label><label>Time<input class="or-in" name="cons_time" value="${esc(c.consolidated.time)}"></label><label>Also to<input class="or-in" name="cons_extra" value="${esc(c.consolidated.extra.join(', '))}"></label></div>
      <div class="or-sub2">ServiceNow</div>
      <div class="or-fg2"><label>ServiceHub dashboard link<input class="or-in" name="sn_url" value="${esc(c.servicenow.dashboardUrl)}"></label><label>Default window<select class="or-in" name="sn_days">${[7, 30, 90].map(n => `<option value="${n}" ${c.servicenow.days === n ? 'selected' : ''}>${n} days</option>`).join('')}</select></label></div>
      <div class="or-msg"></div>
      <div class="or-factions"><button class="or-btn" data-act="cfgsave">Save settings</button><button class="or-btn or-btn-sec" data-act="constest">Send the consolidated report to me</button></div></div>`;
    h += decksCfgCard(c.deck);
    const mails = S.mails;
    h += `<div class="or-card"><div class="or-ch"><div><div class="or-ck">Mail log</div><div class="or-ct">Follow-ups and consolidated reports</div></div></div>`;
    if (!mails) { loadMails(); h += '<div class="or-empty">Loading…</div>'; }
    else h += `<div class="or-tblw"><table class="or-tbl"><thead><tr><th>When</th><th>Kind</th><th>Team · week</th><th>To</th><th>Result</th></tr></thead><tbody>${mails.map(x => `<tr><td class="or-nowrap">${esc(dt(x.created_at))}</td><td>${esc(x.kind)}</td><td>${esc(x.team || '—')}${x.week ? `<div class="or-ts2">${esc(dshort(x.week))}</div>` : ''}</td><td>${esc((x.recipients || []).join(', '))}${(x.cc || []).length ? `<div class="or-ts2">cc ${esc(x.cc.join(', '))}</div>` : ''}</td><td>${x.ok ? '<span class="or-pill or-ok">sent</span>' : `<span class="or-pill or-red">not sent</span><div class="or-ts2">${esc(x.error || '')}</div>`}<div class="or-ts2">${esc(x.by || '')}</div></td></tr>`).join('') || '<tr><td colspan="5" class="or-empty">No mail yet.</td></tr>'}</tbody></table></div>`;
    return h + '</div>';
  }

  function decksCfgCard(dk) {
    if (!dk) return '';
    if (!S.teams) { loadTeams(); return '<div class="or-card"><div class="or-empty">Loading the weekly decks settings…</div></div>'; }
    const teams = S.teams;
    const tsel = v => `<select class="or-in" data-d="team"><option value="">—</option>${teams.map(t => `<option value="${esc(t.key)}" ${t.key === v ? 'selected' : ''}>${esc(t.name)}${t.active ? '' : ' (inactive)'}</option>`).join('')}${v && !teams.some(t => t.key === v) ? `<option value="${esc(v)}" selected>${esc(v)} (unknown)</option>` : ''}</select>`;
    const dRow = d => { const s0 = (d.sources || [])[0] || {}; const extra = (d.sources || []).slice(1);
      return `<tr class="or-drow" data-extra="${esc(JSON.stringify(extra))}"><td><textarea class="or-in" data-d="name" rows="2" placeholder="Section title">${esc(d.name || '')}</textarea></td><td>${tsel(s0.team)}${extra.length ? `<div class="or-ts2">+ ${extra.length} more source(s) kept</div>` : ''}</td>
        <td><input class="or-in" data-d="file" value="${esc(s0.file || '')}" placeholder="any deck"></td><td><input class="or-in" data-d="slides" value="${esc(s0.slides && s0.slides !== 'auto' ? s0.slides : '')}" placeholder="auto"></td>
        <td><input class="or-in" data-d="note" value="${esc(d.note || '')}" placeholder="—"></td>
        <td class="or-nowrap"><button class="or-mini" data-act="drowup" title="Move up">${svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 13)}</button><button class="or-mini" data-act="drowdown" title="Move down">${svg('<path d="M12 5v14M5 12l7 7 7-7"/>', 13)}</button><button class="or-mini" data-act="rmrow" title="Remove">${svg(IC.x, 13)}</button></td></tr>`; };
    const aRow = a => `<div class="or-arow"><input class="or-in" data-a="name" value="${esc(a.name || '')}" placeholder="Executive area"><div class="or-achips">${teams.filter(t => t.active || (a.teams || []).includes(t.key)).map(t => `<label class="or-achip"><input type="checkbox" data-at="${esc(t.key)}" ${(a.teams || []).includes(t.key) ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('')}</div><button class="or-mini" data-act="rmarow" title="Remove">${svg(IC.x, 13)}</button></div>`;
    S._dRow = dRow; S._aRow = aRow;
    return `<div class="or-card or-form" id="orDeckCfg">
      <div class="or-ch"><div><div class="or-ck">Weekly decks</div><div class="or-ct">The executive report and the complete status report</div>
        <div class="or-cs">Built in the Salam template from the teams' own files. Which slides: <b>auto</b> (all but “Thank you”, “Safe Harbor”, empty ones) · <b>all</b> · <b>2-7, 9</b> · <b>from:</b>words on the first slide · <b>until:</b>words on the slide after the last — several with “;”. A PDF goes in page by page; mails saved as PDF (“Fw …”) are left out.</div></div></div>
      <div class="or-fg3"><label class="or-chk"><input type="checkbox" name="dk_auto" ${dk.auto ? 'checked' : ''}> Build automatically when every team is in</label>
        <label>A team is in when its report is<select class="or-in" name="dk_when"><option value="submitted" ${dk.when !== 'approved' ? 'selected' : ''}>submitted</option><option value="approved" ${dk.when === 'approved' ? 'selected' : ''}>approved by ITSM</option></select></label>
        <label>PDF pages at most<input class="or-in or-n" name="dk_pdf" value="${dk.maxPdfPages}"></label></div>
      <div class="or-sub2">Sections of the complete deck <span class="or-ts2">in order — a new line in the title is a line break on the divider</span></div>
      <div class="or-tblw"><table class="or-mtbl or-dk-cfg"><thead><tr><th>Section</th><th>Team</th><th>File name contains</th><th>Slides</th><th>Note on the divider</th><th></th></tr></thead><tbody id="orDRows">${dk.domains.map(dRow).join('')}</tbody></table></div>
      <button class="or-link" data-act="drowadd">+ section</button>
      <div class="or-sub2">Executive areas <span class="or-ts2">the 6 rows of the executive table and the teams each one sums up</span></div>
      <div id="orARows">${dk.areas.map(aRow).join('')}</div>
      <button class="or-link" data-act="arowadd" ${dk.areas.length >= 6 ? 'hidden' : ''}>+ area</button>
      <div class="or-msg"></div>
      <div class="or-factions"><button class="or-btn" data-act="deckcfgsave">Save weekly decks</button></div></div>`;
  }
  async function saveDeckCfg() {
    const root = $('#orDeckCfg');
    const domains = $$('#orDRows tr', root).map(tr => { const g = k => (tr.querySelector(`[data-d="${k}"]`) || {}).value || '';
      let extra = []; try { extra = JSON.parse(tr.dataset.extra || '[]'); } catch (_) {}
      const src = g('team') ? [{ team: g('team'), file: g('file').trim() || null, slides: g('slides').trim() || 'auto' }] : [];
      return { name: g('name').trim(), note: g('note').trim() || null, sources: [...src, ...extra] }; }).filter(d => d.name);
    const areas = $$('#orARows .or-arow', root).map(r => ({ name: r.querySelector('[data-a="name"]').value.trim(), teams: $$('input[data-at]', r).filter(x => x.checked).map(x => x.dataset.at) })).filter(a => a.name);
    const deck = { auto: root.querySelector('[name="dk_auto"]').checked, when: root.querySelector('[name="dk_when"]').value, maxPdfPages: +root.querySelector('[name="dk_pdf"]').value || 30, domains, areas };
    try { await send('/api/opsreports/settings', { deck }, 'PUT'); S.cfg = null; S.decks = {}; toast('Weekly decks saved — rebuilt automatically when every team is in'); render(); } catch (err) { flash(root, err.message, true); }
  }

  /* ---------------------------------------------------------------- report editor (modal) */
  function modal(title, html, wide) {
    let ov = $('#orModal');
    if (!ov) { ov = document.createElement('div'); ov.id = 'orModal'; ov.className = 'or-ov'; document.body.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) closeModal(); }); ov.addEventListener('click', onClick); ov.addEventListener('change', onChange); ov.addEventListener('input', onInput); }
    ov.innerHTML = `<div class="or-modal ${wide ? 'or-mwide' : ''}" role="dialog" aria-modal="true"><div class="or-mh"><div class="or-mt">${title}</div><button class="or-mini" data-act="close" aria-label="Close">${svg(IC.x)}</button></div><div class="or-mb">${html}</div></div>`;
    ov.classList.add('open'); document.body.classList.add('or-noscroll');
    return ov.querySelector('.or-modal');
  }
  function closeModal() { const ov = $('#orModal'); if (ov) { ov.classList.remove('open'); ov.innerHTML = ''; } document.body.classList.remove('or-noscroll'); S.rep = null; }
  const flash = (root, msg, bad) => { const f = root && root.querySelector('.or-msg'); if (f) { f.textContent = msg; f.className = 'or-msg ' + (bad ? 'bad' : 'ok'); } };
  function toast(msg, bad) { let el = $('#orToast'); if (!el) { el = document.createElement('div'); el.id = 'orToast'; document.body.appendChild(el); } el.textContent = msg; el.className = 'show' + (bad ? ' bad' : ''); clearTimeout(el._t); el._t = setTimeout(() => { el.className = ''; }, 4000); }

  async function openReport(teamKey, week) {
    const w = week || (S.ov && S.ov.week) || '';
    modal('Loading…', '<div class="or-empty">Loading the report…</div>', true);
    try {
      const r = await api(`/api/opsreports/report?team=${encodeURIComponent(teamKey)}&week=${encodeURIComponent(w)}`);
      S.rep = r; drawReport();
    } catch (e) { modal('Report', `<div class="or-empty or-bad">${esc(e.message)}</div>`); }
  }
  function repData() {
    const r = S.rep, d = (r.report && r.report.data) || {};
    const tpl = r.team.kpis || [];
    const kpis = tpl.map(k => { const v = (d.kpis || []).find(x => x.key === k.key || x.name === k.name); return { key: k.key, name: k.name, unit: k.unit, target: k.target, cmp: k.cmp, amber: k.amber, value: v ? v.value : null, note: v ? v.note : null, tpl: true }; });
    (d.kpis || []).forEach(x => { if (!kpis.find(k => k.key === x.key || k.name === x.name)) kpis.push(Object.assign({}, x)); });
    return { rag: d.rag || null, ragAuto: d.ragAuto || null, headline: d.headline || '', summary: d.summary || '', kpis, counters: d.counters || {}, actions: (d.actions || []).slice(), risks: (d.risks || []).slice(),
      highlights: (d.highlights || []).join('\n'), lowlights: (d.lowlights || []).join('\n'), nextWeek: (d.nextWeek || []).join('\n'), support: d.support || '' };
  }
  const kStat = k => { const v = parseFloat(k.value), t = parseFloat(k.target), a = parseFloat(k.amber); if (!isFinite(v) || !isFinite(t)) return 'none'; if (k.cmp === '<=') return v <= t ? 'met' : (isFinite(a) && v <= a ? 'near' : 'missed'); return v >= t ? 'met' : (isFinite(a) && v >= a ? 'near' : 'missed'); };
  const K_LABEL = { met: 'on target', near: 'near', missed: 'off target', none: '—' };
  function drawReport() {
    const r = S.rep, t = r.team, can = r.can || {}, rep = r.report, d = S.rep.form || (S.rep.form = repData());
    const ro = !can.edit || (rep && rep.status === 'approved' && !can.review);
    const dis = ro ? 'disabled' : '';
    const files = (rep && rep.files) || [], ex = (r.extract && r.extract.files) || [];
    const last = ex.length ? ex[ex.length - 1] : null, sug = last && last.suggestion;
    const kRow = (k, i) => `<tr data-i="${i}"><td>${k.tpl ? `<b>${esc(k.name)}</b>` : `<input class="or-in" data-kf="name" value="${esc(k.name || '')}" ${dis}>`}</td>
      <td><input class="or-in or-n" data-kf="value" value="${esc(k.value == null ? '' : k.value)}" ${dis}> ${esc(k.unit || '')}</td><td class="or-nowrap">${k.target == null ? '—' : `${k.cmp === '<=' ? '≤' : '≥'} ${esc(k.target)}${k.unit === '%' ? '%' : ''}`}</td>
      <td><span class="or-kst or-k-${kStat(k)}">${K_LABEL[kStat(k)]}</span></td><td><input class="or-in" data-kf="note" value="${esc(k.note || '')}" placeholder="comment" ${dis}></td></tr>`;
    const aRow = (a, i) => `<tr data-i="${i}"><td><input class="or-in or-ref-in" data-af2="ref" value="${esc(a.ref || '')}" ${dis}></td><td><input class="or-in or-wide" data-af2="title" value="${esc(a.title || '')}" ${dis}></td>
      <td><input class="or-in" data-af2="owner" value="${esc(a.owner || '')}" ${dis}></td><td><input type="date" class="or-in" data-af2="eta" value="${esc(a.eta || '')}" ${dis}>${a.etaRaw && !a.eta ? `<div class="or-ts2">${esc(a.etaRaw)}</div>` : ''}</td>
      <td><select class="or-in" data-af2="status" ${dis}>${Object.entries(ACT).map(([k, l]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input class="or-in or-wide" data-af2="update" value="${esc(a.update || '')}" ${dis}></td><td>${ro ? '' : `<button class="or-mini" data-act="rmact" data-i="${i}">${svg(IC.x, 13)}</button>`}</td></tr>`;
    const rRow = (x, i) => `<tr data-i="${i}"><td><input class="or-in or-wide" data-rf="title" value="${esc(x.title || '')}" ${dis}></td><td><input class="or-in" data-rf="impact" value="${esc(x.impact || '')}" ${dis}></td><td><input class="or-in or-wide" data-rf="mitigation" value="${esc(x.mitigation || '')}" ${dis}></td>
      <td><input class="or-in" data-rf="owner" value="${esc(x.owner || '')}" ${dis}></td><td><select class="or-in" data-rf="severity" ${dis}>${['high', 'medium', 'low'].map(s => `<option ${x.severity === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td>${ro ? '' : `<button class="or-mini" data-act="rmrisk" data-i="${i}">${svg(IC.x, 13)}</button>`}</td></tr>`;
    const left = `<div class="or-files">
      <div class="or-sub2">Files <span class="or-ts2">in the team's own format</span></div>
      ${can.edit ? `<label class="or-drop" id="orDrop"><input type="file" id="orFile" hidden><span>${svg(IC.up, 18)}</span><b>Drop the report here</b><span class="or-ts2">pptx · xlsx · docx · pdf · eml · csv — read automatically</span></label>` : ''}
      <div id="orFileList">${files.map(f => `<div class="or-fitem"><button class="or-file" data-act="dl" data-id="${f.id}" data-name="${esc(f.name)}">${svg(IC.file, 13)} ${esc(f.name)}</button><span class="or-ts2">${Math.round(f.size / 1024)} KB · ${esc(f.via === 'drop' ? 'vendor link' : (f.uploadedBy || ''))} · ${esc(ago(f.at))}</span>${can.edit && !ro ? `<button class="or-mini" data-act="rmfile" data-id="${f.id}" title="Remove">${svg(IC.trash, 13)}</button>` : ''}</div>`).join('') || '<div class="or-muted">No file yet.</div>'}</div>
      ${last ? `<div class="or-read"><div class="or-sub2">What the console read <span class="or-ts2">${esc(last.name)} · ${last.pages} page${last.pages === 1 ? '' : 's'}</span></div>
        ${last.note ? `<div class="or-warnbox">${esc(last.note)}</div>` : ''}
        ${sug ? `<div class="or-sugs">
          ${sug.period ? `<div class="or-sug"><span>Period found</span><b>${esc(range(sug.period.from, sug.period.to))}</b></div>` : ''}
          ${Object.keys(sug.ids || {}).length ? `<div class="or-sug"><span>Ticket refs</span><b>${Object.entries(sug.ids).map(([k, v]) => `${v.length} ${k}`).join(' · ')}</b></div>` : ''}
          ${Object.keys(sug.kpiMatches || {}).length ? `<div class="or-sug"><span>KPIs matched</span><b>${Object.keys(sug.kpiMatches).length}</b>${ro ? '' : '<button class="or-link" data-act="usekpis">use</button>'}</div>` : ''}
          ${(sug.actions || []).length ? `<div class="or-sug"><span>Action items</span><b>${sug.actions.length}</b>${ro ? '' : '<button class="or-link" data-act="useactions">add to the report</button>'}</div>` : ''}
          ${(sug.risks || []).length ? `<div class="or-sug"><span>Risks</span><b>${sug.risks.length}</b>${ro ? '' : '<button class="or-link" data-act="userisks">add</button>'}</div>` : ''}
          ${['highlights', 'lowlights', 'nextWeek'].filter(k => (sug[k] || []).length).map(k => `<div class="or-sug"><span>${k === 'nextWeek' ? 'Next week' : k[0].toUpperCase() + k.slice(1)}</span><b>${sug[k].length}</b>${ro ? '' : `<button class="or-link" data-act="usetext" data-k="${k}">use</button>`}</div>`).join('')}
          ${(sug.kpis || []).length ? `<details class="or-cands"><summary>${sug.kpis.length} figures found — click one to add it as a KPI</summary>${sug.kpis.slice(0, 60).map((k, i) => `<button class="or-cand" data-act="usecand" data-i="${i}" ${ro ? 'disabled' : ''}>${esc(k.label)} <b>${esc(k.value)}${esc(k.unit === '%' ? '%' : k.unit ? ' ' + k.unit : '')}</b></button>`).join('')}</details>` : ''}
        </div>` : ''}
        <details class="or-cands"><summary>Outline (${(last.outline || []).length})</summary>${(last.outline || []).map(p => `<div class="or-ts2">p${p.n} · ${esc(p.title || '—')}${p.tables ? ` · ${p.tables} table${p.tables > 1 ? 's' : ''}` : ''}${p.charts ? ` · ${p.charts} chart${p.charts > 1 ? 's' : ''}` : ''}</div>`).join('')}</details></div>` : ''}
      ${r.prev && r.prev.data ? `<div class="or-read"><div class="or-sub2">Last week <span class="or-ts2">${esc(ST[r.prev.status] ? ST[r.prev.status][0] : r.prev.status)}</span></div>${r.prev.data.headline ? `<div class="or-ts2">${esc(r.prev.data.headline)}</div>` : ''}${ro ? '' : '<button class="or-link" data-act="carry">Start from last week (next week → this week, open actions)</button>'}</div>` : ''}
      ${r.actions && r.actions.length && !ro ? `<div class="or-read"><div class="or-sub2">Open in the tracker <span class="or-ts2">${r.actions.length}</span></div><button class="or-link" data-act="useopen">Add the open tracker actions to update them</button></div>` : ''}
    </div>`;
    const counters = (r.counters || []).map(c => `<label class="or-cnt">${esc(c.label)}<input class="or-in or-n" data-cf="${c.key}" value="${esc(d.counters[c.key] == null ? '' : d.counters[c.key])}" ${dis}></label>`).join('');
    const right = `<div class="or-rform">
      <div class="or-rhead"><span class="or-sub2" style="margin:0">RAG</span>${['green', 'amber', 'red'].map(g => `<button class="or-ragbtn or-rag-${g} ${d.rag === g ? 'on' : ''}" data-act="rag" data-g="${g}" ${dis}><i></i>${RAG[g]}</button>`).join('')}<span class="or-ts2">suggested: ${d.ragAuto ? RAG[d.ragAuto] : '—'}</span></div>
      <label>Headline <span class="or-ts2">one line for management</span><input class="or-in" data-ff="headline" value="${esc(d.headline)}" maxlength="300" ${dis}></label>
      <label>Summary<textarea class="or-in" data-ff="summary" rows="3" ${dis}>${esc(d.summary)}</textarea></label>
      <div class="or-sub2">KPIs ${ro ? '' : '<button class="or-link" data-act="addk">+ KPI</button>'}</div>
      <div class="or-tblw"><table class="or-mtbl"><thead><tr><th>KPI</th><th>Value</th><th>Target</th><th></th><th>Comment</th></tr></thead><tbody>${d.kpis.map(kRow).join('') || '<tr><td colspan="5" class="or-muted">No KPI template for this team — add one, or set the template in Teams.</td></tr>'}</tbody></table></div>
      <div class="or-sub2">ITSM counters <span class="or-ts2">leave empty what the team does not track</span></div><div class="or-cnts">${counters}</div>
      <div class="or-sub2">Actions ${ro ? '' : '<button class="or-link" data-act="adda">+ action</button>'}</div>
      <div class="or-tblw"><table class="or-mtbl"><thead><tr><th>Ref</th><th>Action</th><th>Owner</th><th>ETA</th><th>Status</th><th>Update</th><th></th></tr></thead><tbody>${d.actions.map(aRow).join('') || '<tr><td colspan="7" class="or-muted">No action.</td></tr>'}</tbody></table></div>
      <div class="or-sub2">Risks ${ro ? '' : '<button class="or-link" data-act="addr">+ risk</button>'}</div>
      <div class="or-tblw"><table class="or-mtbl"><thead><tr><th>Risk / issue</th><th>Impact</th><th>Mitigation</th><th>Owner</th><th>Severity</th><th></th></tr></thead><tbody>${d.risks.map(rRow).join('') || '<tr><td colspan="6" class="or-muted">No risk.</td></tr>'}</tbody></table></div>
      <div class="or-fg3"><label>Highlights <span class="or-ts2">one per line</span><textarea class="or-in" data-ff="highlights" rows="5" ${dis}>${esc(d.highlights)}</textarea></label>
        <label>Lowlights<textarea class="or-in" data-ff="lowlights" rows="5" ${dis}>${esc(d.lowlights)}</textarea></label>
        <label>Next week<textarea class="or-in" data-ff="nextWeek" rows="5" ${dis}>${esc(d.nextWeek)}</textarea></label></div>
      <label>Support needed from Salam management<textarea class="or-in" data-ff="support" rows="2" ${dis}>${esc(d.support)}</textarea></label>
      ${rep && rep.review ? `<div class="or-warnbox"><b>${rep.review.decision === 'returned' ? 'Returned' : rep.review.decision === 'approved' ? 'Approved' : 'Reopened'}</b> by ${esc(rep.reviewedByName || rep.review.by)} · ${esc(when(rep.reviewedAt))}${rep.review.comment ? ` — “${esc(rep.review.comment)}”` : ''}</div>` : ''}
      <div class="or-msg"></div>
      <div class="or-factions">
        ${!ro ? `<button class="or-btn or-btn-sec" data-act="save">Save draft</button><button class="or-btn" data-act="submit">${svg(IC.check, 14)} Submit</button>` : ''}
        ${can.review && rep && ['submitted', 'returned', 'approved'].includes(rep.status) ? `<span class="or-sep"></span>${rep.status !== 'approved' ? `<button class="or-btn or-btn-ok" data-act="review" data-d="approve">Approve</button>` : ''}<button class="or-btn or-btn-warn" data-act="review" data-d="return">Return…</button>${rep.status === 'approved' ? '<button class="or-btn or-btn-sec" data-act="review" data-d="reopen">Reopen</button>' : ''}` : ''}
        ${can.own ? `<span class="or-sep"></span><button class="or-btn or-btn-sec" data-act="followup" data-team="${esc(t.key)}" data-kind="${r.status === 'pending' ? 'reminder' : 'late'}">${svg(IC.mail, 14)} Follow-up</button><button class="or-btn or-btn-sec" data-act="followup" data-team="${esc(t.key)}" data-kind="actions">Chase actions</button>${t.dropEnabled ? `<button class="or-btn or-btn-sec" data-act="droplink" data-team="${esc(t.key)}">${svg(IC.link, 14)} Upload link</button>` : ''}` : ''}
      </div></div>`;
    const title = `${esc(t.name)} <span class="or-mts">${esc(range(r.period.from, r.period.to))} · ${pill(r.status)} · due ${esc(when(r.due))}${rep && rep.submittedAt ? ` · submitted ${esc(when(rep.submittedAt))} by ${esc(rep.submittedByName || '')}${rep.late ? ' <span class="or-late">late</span>' : ''}` : ''}</span>`;
    const scroll = $('#orModal .or-mb') ? $('#orModal .or-mb').scrollTop : 0;
    modal(title, `<div class="or-rep">${left}${right}</div>`, true);
    const mb = $('#orModal .or-mb'); if (mb) mb.scrollTop = scroll;
    const drop = $('#orDrop'), inp = $('#orFile');
    if (drop && inp) {
      inp.addEventListener('change', () => { if (inp.files[0]) uploadFile(inp.files[0], t.key, r.week); });
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) uploadFile(f, t.key, r.week); });
    }
  }
  /* the form lives in S.rep.form; inputs write into it as they change, so a redraw never loses typing */
  function readForm() { return S.rep && S.rep.form; }
  function payload() {
    const d = readForm();
    return { rag: d.rag, headline: d.headline, summary: d.summary,
      kpis: d.kpis.map(k => ({ key: k.key, name: k.name, value: k.value, unit: k.unit, target: k.target, cmp: k.cmp, amber: k.amber, note: k.note })),
      counters: d.counters, actions: d.actions, risks: d.risks, highlights: lines(d.highlights), lowlights: lines(d.lowlights), nextWeek: lines(d.nextWeek), support: d.support };
  }
  function b64(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, '')); fr.onerror = () => rej(new Error('could not read the file')); fr.readAsDataURL(file); }); }
  async function uploadFile(file, teamKey, week) {
    const max = ((S.cfg && S.cfg.settings && S.cfg.settings.maxFileMB) || 25) * 1024 * 1024;
    if (file.size > max) return toast(`${file.name} is over ${Math.round(max / 1048576)} MB`, true);
    toast(`Uploading ${file.name}…`);
    try {
      const out = await send('/api/opsreports/upload', { team: teamKey, week: week || null, name: file.name, mime: file.type, data: await b64(file) });
      toast(out.duplicate ? 'This file was already there — read again.' : `Uploaded — ${out.read.pages} page(s) read${out.read.note ? ' · ' + out.read.note : ''}`);
      const keep = S.rep && S.rep.team.key === teamKey && S.rep.week === out.week ? S.rep.form : null;
      await openReport(teamKey, out.week);
      if (keep && S.rep) { S.rep.form = keep; drawReport(); }
      loadOverview();
    } catch (e) { toast(e.message, true); }
  }
  function uploadModal(teamKey) {
    const m = me(), rows = (S.ov && S.ov.rows) || [];
    const writable = rows.filter(r => (m.teamsWritable || []).includes(r.team.id));
    if (!writable.length) return toast('You are not an owner or uploader of any team — ask ITSM.', true);
    const weeks = [S.ov.week, addDay(S.ov.week, -7), addDay(S.ov.week, 7)];
    const root = modal('Upload a weekly report', `<div class="or-form">
      <label>Team<select class="or-in" id="orUpTeam">${writable.map(r => `<option value="${esc(r.team.key)}" ${r.team.key === teamKey ? 'selected' : ''}>${esc(r.team.name)}</option>`).join('')}</select></label>
      <label>Week<select class="or-in" id="orUpWeek"><option value="">Detect from the file (period in the name or the slides)</option>${weeks.map(w => `<option value="${w}" ${w === S.ov.week ? 'selected' : ''}>${range(w, addDay(w, 6))}</option>`).join('')}</select></label>
      <label class="or-drop" id="orUpDrop"><input type="file" id="orUpFile" hidden><span>${svg(IC.up, 20)}</span><b>Choose or drop the file</b><span class="or-ts2">as the team sends it — pptx · xlsx · docx · pdf · eml · csv</span></label>
      <div class="or-msg"></div></div>`);
    const go = f => uploadFile(f, $('#orUpTeam', root).value, $('#orUpWeek', root).value || null);
    $('#orUpFile', root).addEventListener('change', e => { if (e.target.files[0]) go(e.target.files[0]); });
    const dz = $('#orUpDrop', root);
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) go(f); });
  }
  async function download(id, name, url) {
    try { const r = await fetch(API() + (url || '/api/opsreports/files/' + id)); if (!r.ok) throw new Error('HTTP ' + r.status);
      const b = await r.blob(), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = name || 'report'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
    } catch (e) { toast('Download failed: ' + e.message, true); }
  }
  async function consolidatedModal() {
    const root = modal(`Consolidated report · ${S.ov ? range(S.ov.from, S.ov.to) : ''}`, '<div class="or-empty">Building…</div>', true);
    try {
      const c = await api('/api/opsreports/consolidated?week=' + encodeURIComponent(S.ov.week));
      const html = c.html.replace(/src="cid:[^"]*"/g, 'src="" style="display:none"');
      const m = me();
      root.querySelector('.or-mb').innerHTML = `<div class="or-cons-bar"><div><b>${esc(c.subject)}</b><div class="or-ts2">To: ${c.recipients.length ? esc(c.recipients.join(', ')) : '<span class="or-bad">no management recipient set (Settings)</span>'}</div></div>
        <div class="or-factions">${m.canSend ? `<button class="or-btn or-btn-sec" data-act="conssend" data-to="me">Send to me</button><button class="or-btn" data-act="conssend" data-to="management" ${c.recipients.length ? '' : 'disabled'}>${svg(IC.mail, 14)} Send to management</button>` : ''}<button class="or-btn or-btn-sec" data-act="consprint">Print / PDF</button></div></div>
        <div class="or-msg"></div><iframe class="or-cons" id="orConsFrame" title="Consolidated report"></iframe>`;
      const fr = $('#orConsFrame'); fr.srcdoc = html;
    } catch (e) { root.querySelector('.or-mb').innerHTML = `<div class="or-empty or-bad">${esc(e.message)}</div>`; }
  }
  async function followupModal(teamKey, kind) {
    const week = (S.rep && S.rep.week) || S.ov.week;
    const root = modal('Follow-up mail', '<div class="or-empty">Preparing…</div>', true);
    try {
      const p = await send('/api/opsreports/followup', { team: teamKey, week, kind, preview: true });
      root.querySelector('.or-mb').innerHTML = `<div class="or-cons-bar"><div><b>${esc(p.subject)}</b><div class="or-ts2">To: ${p.to.length ? esc(p.to.join(', ')) : '<span class="or-bad">nobody — name uploaders or vendor contacts in Teams</span>'}${p.cc.length ? ` · cc ${esc(p.cc.join(', '))}` : ''}${p.drop ? ' · includes a fresh upload link' : ''}</div></div>
        <div class="or-factions"><select class="or-in" id="orFuKind">${[['reminder', 'Reminder'], ['late', 'Late'], ['actions', 'Chase actions']].map(([k, l]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="or-btn" data-act="fusend" data-team="${esc(teamKey)}" ${p.to.length ? '' : 'disabled'}>${svg(IC.mail, 14)} Send</button></div></div>
        <div class="or-msg"></div><iframe class="or-cons" id="orFuFrame" title="Mail preview"></iframe>`;
      $('#orFuFrame').srcdoc = p.html.replace(/src="cid:[^"]*"/g, 'src="" style="display:none"');
      $('#orFuKind').addEventListener('change', e => followupModal(teamKey, e.target.value));
    } catch (e) { root.querySelector('.or-mb').innerHTML = `<div class="or-empty or-bad">${esc(e.message)}</div>`; }
  }

  /* ---------------------------------------------------------------- events */
  async function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (b.tagName === 'TR' && e.target.closest('button,a,input,select,label')) return;   // a button inside a clickable row
    try {
      if (a === 'close') return closeModal();
      if (a === 'tab') { S.tab = b.dataset.k; if (b.dataset.overdue) Object.assign(S.actFilter, { overdue: true, status: 'open' }); render(); history.replaceState(null, '', '#opsreports?tab=' + S.tab + (S.ov ? '&week=' + S.ov.week : '')); return; }
      if (a === 'week') { const d = +b.dataset.d; await loadOverview(d === 0 ? S.ov.defaultWeek : addDay(S.ov.week, d)); return; }
      if (a === 'gotoweek') { S.tab = 'week'; await loadOverview(b.dataset.w); return; }
      if (a === 'refresh') { S.actions = S.lib = S.teams = S.mails = null; S.decks = {}; await loadOverview(S.ov && S.ov.week); return; }
      if (a === 'open') return openReport(b.dataset.team, S.ov.week);
      if (a === 'openrep') return openReport(b.dataset.team, b.dataset.w);
      if (a === 'upload') return uploadModal(b.dataset.team);
      if (a === 'consolidated') return consolidatedModal();
      if (a === 'followup') return followupModal(b.dataset.team, b.dataset.kind);
      if (a === 'dl') return download(b.dataset.id, b.dataset.name);
      if (a === 'deckdl') { toast('Downloading ' + b.dataset.name + '…'); return download(b.dataset.id, b.dataset.name, '/api/opsreports/decks/' + b.dataset.id + '/download'); }
      if (a === 'deckedit') return deckEditModal();
      if (a === 'deckbuild') {
        const d = S.decks[S.ov.week] || {}, wait = (d.teams || []).filter(t => !t.done);
        if (wait.length && !confirm(`Not every report is in (${wait.map(t => t.name).join(', ')}).\nBuild the decks anyway? Their dividers will say which reports are missing.`)) return;
        b.disabled = true; if (S.decks[S.ov.week]) { S.decks[S.ov.week].building = true; render(); }
        const week = S.ov.week;
        try { const out = await send('/api/opsreports/decks/generate', { week }); toast(`Decks built — executive ${out.exec.slides} slides · complete ${out.complete.slides} slides`); }
        finally { await loadDecks(week); }
        return;
      }
      if (a === 'decksave' || a === 'deckreset') {
        if (a === 'deckreset' && !confirm('Replace your text with the one written from the reports?')) return;
        b.disabled = true; const week = S.ov.week;
        try { await send('/api/opsreports/decks/content', a === 'deckreset' ? { week, reset: true } : { week, content: readDeckForm() }, 'PUT'); closeModal(); toast(a === 'deckreset' ? 'Back to the automatic text — executive deck rebuilt' : 'Saved — executive deck rebuilt'); await loadDecks(week); }
        finally { b.disabled = false; }
        return;
      }
      if (a === 'drowadd') { $('#orDRows').insertAdjacentHTML('beforeend', S._dRow({ name: '', sources: [] })); return; }
      if (a === 'drowup' || a === 'drowdown') { const tr = b.closest('tr'), sib = a === 'drowup' ? tr.previousElementSibling : tr.nextElementSibling; if (sib) { if (a === 'drowup') sib.before(tr); else sib.after(tr); } return; }
      if (a === 'arowadd') { const box = $('#orARows'); if (box.children.length < 6) box.insertAdjacentHTML('beforeend', S._aRow({ name: '', teams: [] })); if (box.children.length >= 6) b.hidden = true; return; }
      if (a === 'rmarow') { b.closest('.or-arow').remove(); const ad = $('[data-act="arowadd"]'); if (ad) ad.hidden = false; return; }
      if (a === 'deckcfgsave') return saveDeckCfg();
      if (a === 'droplink') { const d = await send('/api/opsreports/droplink', { team: b.dataset.team }); try { await navigator.clipboard.writeText(d.url); toast('Upload link copied — valid until ' + dt(d.expires)); } catch (_) { window.prompt('Vendor upload link (valid until ' + dt(d.expires) + ')', d.url); } return; }
      if (a === 'itsmdays') { S.itsmDays = +b.dataset.n; S.itsm = null; render(); return; }
      if (a === 'itsmrefresh') { S.itsm = null; render(); loadItsm(true); return; }
      if (a === 'itsmtab') { S.itsmTab = b.dataset.k; render(); return; }
      if (a === 'teamedit') { const t = b.dataset.id ? S.teams.find(x => String(x.id) === b.dataset.id) : null; modal(t ? 'Edit team' : 'New team', teamForm(t), true); return; }
      if (a === 'addkpi') { $('#orKRows').insertAdjacentHTML('beforeend', teamForm({ kpis: [{}] }).match(/<tr class="or-krow">[\s\S]*?<\/tr>/)[0]); return; }
      if (a === 'addcontact') { $('#orCRows').insertAdjacentHTML('beforeend', teamForm({ vendorContacts: [{}] }).match(/<tr class="or-crow">[\s\S]*?<\/tr>/)[0]); return; }
      if (a === 'rmrow') { b.closest('tr').remove(); return; }
      if (a === 'teamsave') return saveTeam(b.closest('.or-form'));
      if (a === 'cfgsave') return saveCfg();
      if (a === 'constest') { const out = await send('/api/opsreports/consolidated/send', { week: S.ov.week, to: 'me' }); toast(out.sent ? 'Sent to you' : 'Not sent: ' + (out.error || (out.dev ? 'SMTP not configured' : '?')), !out.sent); S.mails = null; return; }
      if (a === 'conssend') { b.disabled = true; const out = await send('/api/opsreports/consolidated/send', { week: S.ov.week, to: b.dataset.to }); flash($('#orModal'), out.sent ? `Sent to ${out.to.length} recipient(s).` : 'Not sent: ' + (out.error || (out.dev ? 'SMTP not configured' : '?')), !out.sent); b.disabled = false; S.mails = null; return; }
      if (a === 'consprint') { const f = $('#orConsFrame'); if (f && f.contentWindow) f.contentWindow.print(); return; }
      if (a === 'fusend') { b.disabled = true; const out = await send('/api/opsreports/followup', { team: b.dataset.team, week: (S.rep && S.rep.week) || S.ov.week, kind: $('#orFuKind').value }); flash($('#orModal'), out.sent ? `Sent to ${out.to.join(', ')}${out.cc && out.cc.length ? ' · cc ' + out.cc.join(', ') : ''}` : 'Not sent: ' + (out.error || (out.dev ? 'SMTP not configured' : '?')), !out.sent); b.disabled = false; S.mails = null; return; }
      // report form
      const d = readForm(); if (!d) return;
      const sug = (() => { const ex = (S.rep.extract && S.rep.extract.files) || []; return ex.length ? ex[ex.length - 1].suggestion : null; })();
      if (a === 'rag') { d.rag = d.rag === b.dataset.g ? null : b.dataset.g; return drawReport(); }
      if (a === 'addk') { d.kpis.push({ name: '', value: null, cmp: '>=' }); return drawReport(); }
      if (a === 'adda') { d.actions.push({ title: '', status: 'open' }); return drawReport(); }
      if (a === 'addr') { d.risks.push({ title: '', severity: 'medium' }); return drawReport(); }
      if (a === 'rmact') { d.actions.splice(+b.dataset.i, 1); return drawReport(); }
      if (a === 'rmrisk') { d.risks.splice(+b.dataset.i, 1); return drawReport(); }
      if (a === 'usekpis' && sug) { Object.entries(sug.kpiMatches || {}).forEach(([k, hit]) => { const row = d.kpis.find(x => x.key === k); if (row && (row.value == null || row.value === '')) row.value = hit.value; }); return drawReport(); }
      if (a === 'usecand' && sug) { const c = sug.kpis[+b.dataset.i]; if (c) d.kpis.push({ name: c.label, value: c.value, unit: c.unit === '%' ? '%' : c.unit, cmp: '>=' }); return drawReport(); }
      if (a === 'useactions' && sug) { const have = new Set(d.actions.map(x => (x.ref || x.title || '').toLowerCase())); sug.actions.forEach(x => { if (!have.has((x.ref || x.title || '').toLowerCase())) d.actions.push({ ref: x.ref, title: x.title, owner: x.owner, eta: x.eta, etaRaw: x.etaRaw, status: statusOf(x.status), update: x.update }); }); return drawReport(); }
      if (a === 'userisks' && sug) { sug.risks.forEach(x => d.risks.push({ title: x.title, impact: x.impact, owner: x.owner, mitigation: x.mitigation, severity: 'medium' })); return drawReport(); }
      if (a === 'usetext' && sug) { const k = b.dataset.k; d[k] = [...lines(d[k]), ...(sug[k] || []).filter(x => !lines(d[k]).includes(x))].join('\n'); return drawReport(); }
      if (a === 'useopen') { const have = new Set(d.actions.map(x => (x.ref || x.title || '').toLowerCase())); (S.rep.actions || []).forEach(x => { if (!have.has((x.ref || x.title || '').toLowerCase())) d.actions.push({ ref: x.ref, title: x.title, owner: x.owner, eta: x.eta, status: x.status, update: x.update }); }); return drawReport(); }
      if (a === 'carry') { const p = S.rep.prev.data || {}; if (!d.summary && p.nextWeek && p.nextWeek.length) d.summary = 'Planned last week: ' + p.nextWeek.join('; ');
        const have = new Set(d.actions.map(x => (x.ref || x.title || '').toLowerCase())); (p.actions || []).filter(x => !['done', 'cancelled'].includes(x.status)).forEach(x => { if (!have.has((x.ref || x.title || '').toLowerCase())) d.actions.push(Object.assign({}, x)); });
        (p.risks || []).forEach(x => { if (!d.risks.find(y => y.title === x.title)) d.risks.push(Object.assign({}, x)); }); return drawReport(); }
      if (a === 'rmfile') { if (!confirm('Remove this file from the report?')) return; await api('/api/opsreports/files/' + b.dataset.id, { method: 'DELETE' }); const keep = S.rep.form; await openReport(S.rep.team.key, S.rep.week); if (S.rep) { S.rep.form = keep; drawReport(); } return; }
      if (a === 'save' || a === 'submit') {
        const root = $('#orModal');
        if (a === 'submit' && !d.rag && !d.ragAuto) { flash(root, 'Choose a RAG status before submitting.', true); return; }
        if (a === 'submit' && !d.headline) { flash(root, 'Write a one-line headline before submitting.', true); return; }
        b.disabled = true;
        const out = await send('/api/opsreports/report', { team: S.rep.team.key, week: S.rep.week, data: payload(), submit: a === 'submit' }, 'PUT');
        b.disabled = false;
        toast(a === 'submit' ? `Submitted${out.late ? ' (late)' : ''}${out.actions ? ` · ${out.actions.added} new action(s), ${out.actions.moved} ETA move(s)` : ''}` : 'Draft saved');
        await openReport(S.rep.team.key, S.rep.week); loadOverview(S.ov.week); S.actions = null; return;
      }
      if (a === 'review') {
        let comment = null;
        if (b.dataset.d === 'return') { comment = window.prompt('What should the team fix? (they receive it by mail)'); if (!comment) return; }
        const out = await send(`/api/opsreports/report/${S.rep.report.id}/review`, { decision: b.dataset.d, comment });
        toast(out.status === 'approved' ? 'Approved' : out.status === 'returned' ? `Returned${out.mail && out.mail.sent ? ' — mail sent' : ''}` : 'Reopened');
        await openReport(S.rep.team.key, S.rep.week); loadOverview(S.ov.week); return;
      }
    } catch (err) { toast(err.message, true); flash($('#orModal'), err.message, true); }
  }
  const statusOf = s => { s = String(s || '').toLowerCase(); if (/cancel/.test(s)) return 'cancelled'; if (/resolved|closed|done|complete/.test(s)) return 'done'; if (/waiting for customer|customer working|salam/.test(s)) return 'waiting_salam'; if (/progress|analysis|observation/.test(s)) return 'in_progress'; return 'open'; };
  function onInput(e) {
    const el = e.target, d = readForm();
    if (d) {
      const tr = el.closest('tr[data-i]'); const i = tr ? +tr.dataset.i : -1;
      if (el.dataset.ff) d[el.dataset.ff] = el.value;
      else if (el.dataset.kf && d.kpis[i]) { d.kpis[i][el.dataset.kf] = el.dataset.kf === 'value' ? (el.value === '' ? null : el.value) : el.value; if (el.dataset.kf === 'value') { const st = tr.querySelector('.or-kst'); if (st) { const k = kStat(d.kpis[i]); st.className = 'or-kst or-k-' + k; st.textContent = K_LABEL[k]; } } }
      else if (el.dataset.af2 && d.actions[i]) d.actions[i][el.dataset.af2] = el.value || null;
      else if (el.dataset.rf && d.risks[i]) d.risks[i][el.dataset.rf] = el.value;
      else if (el.dataset.cf) d.counters[el.dataset.cf] = el.value === '' ? null : el.value;
    }
    if (el.dataset.f === 'q') { S.actFilter.q = el.value; clearTimeout(S._q); S._q = setTimeout(() => { const p = el.selectionStart; render(); const n = $('[data-f="q"]'); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (_) {} } }, 250); }
  }
  async function onChange(e) {
    const el = e.target;
    if (el.id === 'orWeekPick' && el.value) return loadOverview(el.value);
    if (el.dataset.f && el.dataset.f !== 'q') { S.actFilter[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; return render(); }
    if (el.dataset.af) {
      const tr = el.closest('tr[data-aid]'); if (!tr) return;
      try { await send('/api/opsreports/actions/' + tr.dataset.aid, { [el.dataset.af]: el.value }, 'PATCH'); toast('Saved'); const a = S.actions.find(x => String(x.id) === tr.dataset.aid); if (a) a[el.dataset.af] = el.value; }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (el.dataset.af2 || el.dataset.rf) onInput(e);
  }
  async function saveTeam(root) {
    const v = n => { const el = root.querySelector(`[name="${n}"]`); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
    const kpis = $$('#orKRows tr', root).map(tr => { const g = k => (tr.querySelector(`[data-k="${k}"]`) || {}).value; return { key: g('key') || undefined, name: g('name'), cmp: g('cmp'), target: g('target'), amber: g('amber'), unit: g('unit'), match: g('match'), agg: g('agg') }; }).filter(k => k.name);
    const contacts = $$('#orCRows tr', root).map(tr => { const g = k => (tr.querySelector(`[data-c="${k}"]`) || {}).value; return { name: g('name'), email: g('email'), role: g('role') }; }).filter(c => c.name || c.email);
    const body = { name: v('name'), vendor: v('vendor'), domain: v('domain'), tower: v('tower'), segment: v('segment'), sort: v('sort'), weekStart: v('weekStart'), dueDay: v('dueDay'), dueTime: v('dueTime'),
      formatNote: v('formatNote'), owners: emails(v('owners')), uploaders: emails(v('uploaders')), cc: emails(v('cc')), vendorContacts: contacts, dropEnabled: v('dropEnabled'), kpis, active: v('active') };
    try {
      const id = root.dataset.team;
      if (id) await send('/api/opsreports/teams/' + id, body, 'PATCH'); else await send('/api/opsreports/teams', body);
      closeModal(); toast('Team saved'); S.teams = null; await loadOverview(S.ov.week);
    } catch (err) { flash(root, err.message, true); }
  }
  async function saveCfg() {
    const root = $('#orCfg'), v = n => { const el = root.querySelector(`[name="${n}"]`); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
    const body = { management: emails(v('management')), itsmCc: emails(v('itsmCc')), dueDay: +v('dueDay'), dueTime: v('dueTime'), maxFileMB: +v('maxFileMB'), dropDays: +v('dropDays'),
      reminder: { enabled: v('rem_enabled'), day: +v('rem_day'), time: v('rem_time') }, late: { enabled: v('late_enabled'), graceMin: +v('late_grace'), hour: +v('late_hour'), max: +v('late_max') },
      consolidated: { enabled: v('cons_enabled'), day: +v('cons_day'), time: v('cons_time'), extra: emails(v('cons_extra')) }, servicenow: { dashboardUrl: v('sn_url'), days: +v('sn_days') } };
    if (!root.querySelector('[name="editors"]').disabled) body.editors = emails(v('editors'));
    try { await send('/api/opsreports/settings', body, 'PUT'); S.cfg = null; toast('Settings saved'); await loadOverview(S.ov.week); } catch (err) { flash(root, err.message, true); }
  }

  /* ---------------------------------------------------------------- loaders */
  async function loadOverview(week) {
    try { S.ov = await api('/api/opsreports/overview' + (week ? '?week=' + encodeURIComponent(week) : '')); S.me = S.ov.me; delete S.decks[S.ov.week]; }
    catch (e) { const host = $('#view-opsreports'); if (host) host.innerHTML = `<div class="or-wrap"><div class="or-empty or-bad">${esc(e.message)}</div></div>`; return; }
    if (S.tab !== 'week') { /* keep the tab */ }
    render();
  }
  async function loadActions() { try { S.actions = (await api('/api/opsreports/actions?all=1')).actions; } catch (e) { S.actions = []; toast(e.message, true); } if (S.tab === 'actions') render(); }
  async function loadItsm(force) { try { S.itsm = await api(`/api/opsreports/itsm?days=${S.itsmDays}${force ? '&refresh=1' : ''}`); } catch (e) { S.itsm = { error: e.message }; } if (S.tab === 'itsm') render(); }
  async function loadLib() { try { S.lib = await api('/api/opsreports/library?weeks=12'); } catch (e) { S.lib = { reports: [] }; toast(e.message, true); } if (S.tab === 'library') render(); }
  async function loadTeams() { try { S.teams = (await api('/api/opsreports/teams')).teams; } catch (e) { S.teams = []; toast(e.message, true); } if (S.tab === 'teams' || S.tab === 'settings') render(); }
  async function loadCfg() { try { S.cfg = await api('/api/opsreports/settings'); } catch (e) { S.cfg = null; toast(e.message, true); return; } if (S.tab === 'settings') render(); }
  async function loadMails() { try { S.mails = (await api('/api/opsreports/mails')).mails; } catch (e) { S.mails = []; } if (S.tab === 'settings') render(); }

  /* ---------------------------------------------------------------- open / close */
  function parseQs(qs) { const o = {}; String(qs || '').split('&').forEach(kv => { const [k, v] = kv.split('='); if (k) o[k] = decodeURIComponent(v || ''); }); return o; }
  window.openOpsReports = async function (qs) {
    const host = $('#view-opsreports'); if (!host) return;
    ensureCss();
    document.querySelectorAll('.navtab[data-view="opsreports"]').forEach(b => b.classList.add('active'));
    if (window.navdropSync) window.navdropSync();
    if (!S.built) { S.built = true; host.addEventListener('click', onClick); host.addEventListener('change', onChange); host.addEventListener('input', onInput);
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#orModal.open')) closeModal(); }); }
    S.open = true;
    const q = parseQs(qs);
    if (q.tab && ['week', 'actions', 'itsm', 'library', 'teams', 'settings'].includes(q.tab)) S.tab = q.tab;
    if (!S.ov) host.innerHTML = `<div class="or-wrap">${hero()}<div class="or-empty">Loading…</div></div>`;
    await loadOverview(q.week || (S.ov && S.ov.week) || null);
    if (q.team) openReport(q.team, q.week || S.ov.week);
  };
  window.addEventListener('hashchange', () => { if (!/^#(opsreports|ops-reports|itsm-reports)(\?|$)/.test(location.hash || '')) { S.open = false; closeModal(); } });

  /* ---------------------------------------------------------------- look */
  function ensureCss() {
    if ($('#orCss')) return;
    const css = document.createElement('style'); css.id = 'orCss';
    css.textContent = `
#view-opsreports{padding:16px 18px 40px}
.or-wrap{max-width:1500px;margin:0 auto}
.or-hero{position:relative;display:flex;justify-content:space-between;align-items:flex-end;gap:18px;flex-wrap:wrap;padding:24px 26px;border-radius:20px;color:#eafff4;
  background:radial-gradient(800px 300px at 0% 0%,rgba(16,185,129,.30),transparent 62%),radial-gradient(600px 240px at 100% 140%,rgba(124,58,237,.22),transparent 60%),linear-gradient(135deg,#04211a 0%,#0a3a29 55%,#0c5b3e 100%);box-shadow:0 22px 44px -26px rgba(4,47,32,.65)}
[data-theme="dark"] .or-hero{border:1px solid rgba(52,211,153,.16)}
.or-kick{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#86efc0}
.or-h1{margin:6px 0 4px;font-size:clamp(22px,2.6vw,32px);font-weight:800;letter-spacing:-.02em;color:#fff}.or-h1 span{color:#bbf7d0;font-weight:700}
.or-sub{font-size:13px;color:rgba(234,255,244,.8);max-width:760px}
.or-weeknav{display:flex;align-items:center;gap:6px;margin-top:14px;flex-wrap:wrap}
.or-hbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-size:12px;font-weight:700;color:#eafff4;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:7px 9px;cursor:pointer}
.or-hbtn:hover{background:rgba(255,255,255,.16)}.or-htext{padding:7px 12px}
.or-hdate{font:inherit;font-size:12.5px;color:#eafff4;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:6px 9px;color-scheme:dark}
.or-hnote{font-size:11.5px;color:rgba(234,255,244,.7)}
.or-hero-r{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.or-btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;font-weight:700;color:#fff;background:var(--green);border:1px solid var(--green);border-radius:10px;padding:8px 13px;cursor:pointer;text-decoration:none;white-space:nowrap}
.or-btn:hover{filter:brightness(1.07)}.or-btn:disabled{opacity:.5;cursor:not-allowed}
.or-btn-sec{color:var(--ink);background:var(--card);border-color:var(--line)}.or-btn-sec:hover{border-color:var(--green)}
.or-btn-hero{background:#fff;color:#0a3a29;border-color:#fff}.or-btn-ghost{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.22)}
.or-btn-ok{background:var(--green)}.or-btn-warn{background:var(--amber);border-color:var(--amber)}
.or-btn:focus-visible,.or-hbtn:focus-visible,.or-tile:focus-visible,.or-mini:focus-visible,.or-tabs button:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.or-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:16px 0 4px;padding:4px;border-radius:13px;background:var(--card2);border:1px solid var(--line);width:max-content;max-width:100%}
.or-tabs button{font:inherit;font-size:13px;font-weight:700;color:var(--ink-soft);background:none;border:0;border-radius:9px;padding:7px 13px;cursor:pointer;white-space:nowrap}
.or-tabs button:hover{background:var(--card)}.or-tabs button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 3px rgba(15,23,42,.14)}
.or-tabs-sm{margin:8px 0}.or-tabs-sm button{font-size:12px;padding:6px 11px}
.or-tb{display:inline-block;margin-left:6px;font-size:10.5px;padding:1px 6px;border-radius:999px;background:var(--tint-red);color:var(--tint-red-fg)}
.or-body{margin-top:10px}
.or-tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:6px 0 14px}.or-tiles-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.or-tile{position:relative;display:flex;flex-direction:column;gap:3px;text-align:left;padding:13px 14px 12px 17px;border-radius:15px;background:var(--card);border:1px solid var(--line);color:var(--ink);font:inherit;cursor:default;overflow:hidden}
.or-tile[data-act]{cursor:pointer}.or-tile[data-act]:hover{border-color:var(--green)}
.or-tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--tc,var(--line))}
.or-t-ok{--tc:var(--green)}.or-t-warn{--tc:var(--amber)}.or-t-bad{--tc:var(--red)}
.or-tl{font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.or-tv{font-size:26px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.15}.or-tv small{font-size:14px;color:var(--muted)}
.or-ts{font-size:11.5px;color:var(--ink-soft)}
.or-rgb{display:inline-flex;gap:5px}.or-rgb b{font-size:16px;min-width:30px;text-align:center;border-radius:8px;padding:2px 6px;color:#fff}.or-rgb .r{background:var(--red)}.or-rgb .a{background:var(--amber)}.or-rgb .g{background:var(--green)}
.or-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:14px}
.or-ch{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.or-ck{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--green)}
.or-ct{font-size:17px;font-weight:800;margin-top:2px}.or-cs{font-size:12.5px;color:var(--muted);margin-top:3px;max-width:900px;line-height:1.5}
.or-legend{display:flex;flex-wrap:wrap;gap:5px}
.or-tblw{overflow-x:auto;-webkit-overflow-scrolling:touch}
.or-tbl{width:100%;border-collapse:collapse;font-size:13px}
.or-tbl th{text-align:left;font-size:10.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);padding:8px;border-bottom:1px solid var(--line);white-space:nowrap}
.or-tbl td{padding:9px 8px;border-bottom:1px solid var(--line-soft);vertical-align:top}
.or-row{cursor:pointer}.or-row:hover td{background:var(--card2)}
.or-off td{opacity:.55}
.or-tn{font-weight:700}.or-ts2{font-size:11.5px;color:var(--muted);margin-top:2px}
.or-nowrap{white-space:nowrap}.or-hl{min-width:240px;max-width:520px}.or-hlt{font-size:12.5px;margin-bottom:4px}
.or-pill{display:inline-block;font-size:11px;font-weight:800;padding:2px 9px;border-radius:999px;white-space:nowrap}
.or-ok{background:var(--ok-bg);color:var(--ok-fg)}.or-blue{background:var(--tint-blue);color:var(--tint-blue-fg)}.or-amber{background:var(--tint-amber);color:var(--tint-amber-fg)}
.or-violet{background:var(--tint-violet);color:var(--tint-violet-fg)}.or-grey{background:var(--card2);color:var(--ink-soft);border:1px solid var(--line)}.or-red{background:var(--tint-red);color:var(--tint-red-fg)}.or-muted{color:var(--muted)}
span.or-muted.or-pill,.or-pill.or-muted{background:var(--card2);border:1px dashed var(--line)}
.or-late{font-size:10.5px;font-weight:800;color:var(--amber);text-transform:uppercase}
.or-rag{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800}.or-rag i{width:11px;height:11px;border-radius:50%;background:var(--rc)}
.or-rag-green{--rc:var(--green)}.or-rag-amber{--rc:var(--amber)}.or-rag-red{--rc:var(--red)}
.or-kchips{display:flex;flex-wrap:wrap;gap:4px}.or-kchip{font-size:11px;padding:2px 7px;border-radius:7px;background:var(--card2);border:1px solid var(--line);color:var(--ink-soft)}
.or-kchip.or-k-met{border-color:var(--ok-line);background:var(--ok-bg);color:var(--ok-fg)}.or-kchip.or-k-near{background:var(--tint-amber);color:var(--tint-amber-fg);border-color:transparent}.or-kchip.or-k-missed{background:var(--tint-red);color:var(--tint-red-fg);border-color:transparent}
.or-kst{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;white-space:nowrap;background:var(--card2);color:var(--muted)}
.or-kst.or-k-met{background:var(--ok-bg);color:var(--ok-fg)}.or-kst.or-k-near{background:var(--tint-amber);color:var(--tint-amber-fg)}.or-kst.or-k-missed{background:var(--tint-red);color:var(--tint-red-fg)}
.or-bad{color:var(--red);font-weight:700}.or-warn{color:var(--amber)}
.or-racts{text-align:right}.or-mini{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;margin-left:3px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--ink-soft);cursor:pointer}
.or-mini:hover{border-color:var(--green);color:var(--green)}
.or-link{font:inherit;font-size:12.5px;font-weight:700;color:var(--green-dark);background:none;border:0;padding:0 2px;cursor:pointer}.or-link:hover{text-decoration:underline}
.or-empty{padding:26px;text-align:center;color:var(--muted);font-size:13.5px}
.or-filt{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.or-filt select,.or-filt input[type=search],.or-in{font:inherit;font-size:13px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:9px;padding:7px 9px;min-width:0}
.or-in:focus,.or-filt select:focus,.or-filt input:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 18%,transparent)}
.or-in:disabled{opacity:.75;background:var(--card2)}
.or-n{width:90px}.or-wide{min-width:220px;width:100%}.or-ref-in{width:110px;font-family:var(--mono);font-size:12px}
.or-chk{display:inline-flex !important;flex-direction:row !important;align-items:center;gap:6px;font-size:12.5px;font-weight:600}
.or-ref{font-family:var(--mono);font-size:11px;font-weight:700;color:var(--green-dark);background:var(--green-bg);border-radius:6px;padding:1px 6px}
.or-snhead{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}
.or-shr{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.or-seg{display:inline-flex;padding:3px;border-radius:10px;background:var(--card2);border:1px solid var(--line)}.or-seg button{font:inherit;font-size:12px;font-weight:700;background:none;border:0;border-radius:8px;padding:5px 10px;color:var(--ink-soft);cursor:pointer}.or-seg button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 3px rgba(15,23,42,.12)}
.or-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.or-panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:13px 14px;min-width:0}.or-wide2{grid-column:span 2}
.or-pt{font-size:12.5px;font-weight:800;margin-bottom:8px}
.or-bars{display:flex;flex-direction:column;gap:5px}
.or-bar{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto;gap:8px;align-items:center;font-size:12px}
.or-bl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-soft)}.or-bt{height:9px;border-radius:99px;background:var(--line-soft);overflow:hidden}
.or-bt i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--green),#14b8a6)}.or-bar b{font-variant-numeric:tabular-nums;min-width:34px;text-align:right}
.or-spark{width:100%;height:130px;display:block}.or-sa{fill:color-mix(in srgb,var(--green) 16%,transparent);stroke:none}.or-sl{fill:none;stroke:var(--green);stroke-width:2.2;vector-effect:non-scaling-stroke}
.or-sx{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
.or-sla{margin:6px 0 12px}.or-slal{font-size:12px;margin-bottom:4px}.or-slab{display:flex;height:12px;border-radius:99px;overflow:hidden;background:var(--line-soft)}.or-slab .m{background:var(--green)}.or-slab .b{background:var(--red)}
.or-file{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;font-weight:600;color:var(--ink);background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:4px 8px;margin:2px 4px 2px 0;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.or-file:hover{border-color:var(--green)}
.or-ov{position:fixed;inset:0;z-index:9000;display:none;align-items:flex-start;justify-content:center;padding:4vh 14px;background:rgba(2,12,8,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);overflow:auto}
.or-ov.open{display:flex}body.or-noscroll{overflow:hidden}
.or-modal{width:min(720px,100%);background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow-lg);display:flex;flex-direction:column;max-height:92vh}
.or-mwide{width:min(1380px,100%)}
.or-mh{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:15px 18px;border-bottom:1px solid var(--line)}
.or-mt{font-size:16px;font-weight:800;line-height:1.4}.or-mts{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-top:2px}
.or-mb{padding:16px 18px;overflow:auto}
.or-rep{display:grid;grid-template-columns:minmax(260px,330px) minmax(0,1fr);gap:18px;align-items:start}
.or-rep>*{min-width:0}.or-files>*{min-width:0;max-width:100%}.or-fitem .or-file{max-width:calc(100% - 40px)}
.or-files{position:sticky;top:0;display:flex;flex-direction:column;gap:10px}
.or-drop{display:flex !important;flex-direction:column;align-items:center;gap:4px;padding:18px 12px;border:2px dashed var(--line);border-radius:14px;background:var(--card2);cursor:pointer;text-align:center;color:var(--ink-soft)}
.or-drop.over,.or-drop:hover{border-color:var(--green);background:var(--green-bg)}.or-drop b{color:var(--ink)}
.or-fitem{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:6px 0;border-bottom:1px solid var(--line-soft)}
.or-read{border:1px solid var(--line);border-radius:12px;padding:10px 11px;background:var(--card2)}
.or-sugs{display:flex;flex-direction:column;gap:4px}.or-sug{display:flex;align-items:center;gap:8px;font-size:12.5px}.or-sug span{color:var(--muted);min-width:94px}.or-sug b{flex:1}
.or-cands{margin-top:6px;font-size:12px}.or-cands summary{cursor:pointer;color:var(--green-dark);font-weight:700}
.or-cand{display:block;width:100%;text-align:left;font:inherit;font-size:11.5px;color:var(--ink-soft);background:none;border:0;border-bottom:1px solid var(--line-soft);padding:4px 2px;cursor:pointer}.or-cand:hover{color:var(--green-dark)}
.or-warnbox{font-size:12.5px;padding:8px 10px;border-radius:10px;background:var(--tint-warn-bg);border:1px solid var(--tint-warn-line);color:var(--tint-warn-fg);margin:6px 0}
.or-rform,.or-form{display:flex;flex-direction:column;gap:10px}
.or-rform label,.or-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--ink-soft)}
.or-rhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.or-ragbtn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;font-weight:800;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink-soft);cursor:pointer}
.or-ragbtn i{width:11px;height:11px;border-radius:50%;background:var(--rc)}.or-ragbtn.on{background:var(--rc);border-color:var(--rc);color:#fff}.or-ragbtn.on i{background:#fff}
.or-sub2{font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--green);margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.or-sub2 .or-ts2{text-transform:none;letter-spacing:0;font-weight:600}
.or-mtbl{width:100%;border-collapse:collapse;font-size:12.5px}.or-mtbl th{text-align:left;font-size:10.5px;color:var(--muted);font-weight:800;padding:4px;text-transform:uppercase;letter-spacing:.05em}.or-mtbl td{padding:3px 4px;vertical-align:top}
.or-mtbl .or-in{padding:6px 7px;font-size:12.5px;width:100%}.or-mtbl .or-n{width:80px}
.or-cnts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.or-cnt{font-size:11.5px !important}.or-cnt .or-in{width:100%}
.or-fg2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.or-fg3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.or-factions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.or-sep{width:1px;height:24px;background:var(--line);margin:0 4px}
.or-msg{font-size:12.5px;min-height:0}.or-msg.ok{color:var(--green-dark)}.or-msg.bad{color:var(--red);font-weight:700}
.or-cons-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.or-cons{width:100%;height:68vh;border:1px solid var(--line);border-radius:12px;background:#f2f4f3}
#orToast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);opacity:0;z-index:9500;background:#0b3d2b;color:#eafff4;font-size:13px;font-weight:700;padding:10px 16px;border-radius:12px;box-shadow:var(--shadow-lg);transition:opacity .2s,transform .2s;pointer-events:none;max-width:92vw}
#orToast.show{opacity:1;transform:translateX(-50%) translateY(0)}#orToast.bad{background:#7f1d1d}
.or-decks .or-ch{margin-bottom:12px}
.or-dk-state{display:flex;align-items:flex-start;gap:7px}.or-dk-state::before{content:"";flex:none;width:8px;height:8px;margin-top:6px;border-radius:50%;background:var(--muted)}
.or-dk-ok::before{background:var(--green)}.or-dk-amber::before{background:var(--amber)}.or-dk-blue::before{background:var(--blue);animation:orPulse 1.2s ease-in-out infinite}
@keyframes orPulse{50%{opacity:.25}}
.or-dk-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.or-dk{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--card2);min-width:0}
.or-dk-empty{border-style:dashed;opacity:.85}
.or-dk-ic{flex:none;display:inline-flex;align-items:center;justify-content:center;width:38px;height:44px;border-radius:8px;background:linear-gradient(160deg,#e8673f,#c2410c);color:#fff;font-weight:900;font-size:17px;box-shadow:inset 0 -3px 0 rgba(0,0,0,.15)}
.or-dk-empty .or-dk-ic{background:var(--line);color:var(--muted);box-shadow:none}
.or-dk-b{flex:1;min-width:0}.or-dk-t{font-weight:800;font-size:13.5px;line-height:1.3}
.or-tchips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:12px}.or-tchips>.or-ts2{margin:0 4px 0 0;font-weight:700}
.or-tchip{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink-soft);white-space:nowrap}
.or-tchip i{font-style:normal;font-weight:600;color:var(--muted)}.or-tchip.ok{background:var(--ok-bg);color:var(--ok-fg);border-color:var(--ok-line)}.or-tchip.bad{background:var(--tint-red);color:var(--tint-red-fg);border-color:transparent}.or-tchip.bad i{color:inherit}
.or-tchip.wait{background:var(--tint-amber);color:var(--tint-amber-fg);border-color:transparent}.or-tchip.wait i{color:inherit}
.or-dk-det{margin-top:12px;border-top:1px solid var(--line-soft);padding-top:10px}.or-dk-det summary{cursor:pointer;font-size:12.5px;font-weight:700;color:var(--green-dark)}.or-dk-det .or-tbl{margin-top:8px}
.or-file-deck .or-dk-ic{width:16px;height:19px;font-size:10px;border-radius:3px;box-shadow:none}
.or-dk-rows textarea,.or-dk-cfg textarea{resize:vertical;min-height:40px;font-size:12.5px;line-height:1.4}.or-dk-rows td{min-width:200px}.or-dk-rows td:first-child{min-width:160px}
.or-dk-cfg td:first-child{min-width:190px}.or-dk-cfg select{min-width:170px}.or-dk-cfg td:nth-child(3),.or-dk-cfg td:nth-child(4){min-width:150px}.or-dk-cfg td:nth-child(5){min-width:180px}
.or-arow{display:grid;grid-template-columns:minmax(200px,300px) minmax(0,1fr) auto;gap:10px;align-items:start;padding:8px 0;border-bottom:1px solid var(--line-soft)}
.or-achips{display:flex;flex-wrap:wrap;gap:5px}
.or-achip{display:inline-flex !important;flex-direction:row !important;align-items:center;gap:0 !important;cursor:pointer}
.or-achip input{position:absolute;opacity:0;width:1px;height:1px}.or-achip span{font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink-soft)}
.or-achip input:checked+span{background:var(--green-bg);border-color:var(--green);color:var(--green-dark)}.or-achip input:focus-visible+span{outline:2px solid var(--green);outline-offset:1px}
@media (max-width:1100px){.or-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}.or-tiles-4{grid-template-columns:repeat(2,minmax(0,1fr))}.or-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.or-rep{grid-template-columns:1fr}.or-files{position:static}}
@media (max-width:640px){#view-opsreports{padding:10px 10px 30px}.or-hero{padding:18px 16px}.or-tiles,.or-tiles-4{grid-template-columns:repeat(2,minmax(0,1fr))}.or-grid{grid-template-columns:1fr}.or-wide2{grid-column:auto}
  .or-fg2,.or-fg3{grid-template-columns:1fr}.or-dk-grid{grid-template-columns:1fr}.or-dk{flex-wrap:wrap}.or-dk .or-btn{width:100%;justify-content:center}.or-arow{grid-template-columns:1fr auto}.or-achips{grid-column:1/-1}
  .or-dk-rows thead{display:none}.or-dk-rows,.or-dk-rows tbody,.or-dk-rows tr,.or-dk-rows td{display:block;width:100%;min-width:0 !important}.or-dk-rows tr{padding:8px 0;border-bottom:1px solid var(--line)}
  .or-dk-rows td::before{content:attr(data-l);display:block;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:4px 0 2px}.or-tabs{width:100%;overflow-x:auto;flex-wrap:nowrap}.or-ov{padding:0}.or-modal{border-radius:0;max-height:100vh;min-height:100vh}.or-hl{min-width:180px}}
@media (max-width:640px){.or-cards thead{display:none}.or-cards,.or-cards tbody,.or-cards tr,.or-cards td{display:block;width:100%}
  .or-cards tr{border:1px solid var(--line);border-radius:13px;padding:10px 12px;margin-bottom:10px;background:var(--card)}.or-cards td{border:0;padding:3px 0;min-width:0;max-width:none}
  .or-cards td.or-racts{text-align:left;padding-top:8px}.or-cards td.or-racts .or-mini{margin:0 6px 0 0}}
[data-theme="dark"] .or-in,[data-theme="dark"] .or-filt select,[data-theme="dark"] .or-filt input{color-scheme:dark}
.or-form>.or-link,.or-rform .or-sub2 .or-link,.or-read .or-link{align-self:flex-start;text-align:left}
.or-form label .or-in,.or-rform label .or-in{font-weight:500}
@media (prefers-reduced-motion:reduce){#orToast{transition:none}}
@media print{.or-hero-r,.or-tabs,.or-racts,.or-weeknav{display:none !important}.or-hero{background:#0b3d2b !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;
    document.head.appendChild(css);
  }
})();
