/* execbrief.js — Executive Dashboard v2: the CEO / CIO brief (16 Sep 2026)
 *
 * Adds five sections to EXECOPS (execops.js owns the page frame, the radar and the KPI tiles; this file owns
 * the executive blocks) and re-points #exec at them:
 *   brief_status   are we OK right now — per business, from OPEN P1/P2 only
 *   brief_impact   what did it cost us — outage register, month to date vs last month
 *   brief_vendors  are the vendors delivering — contract obligations (Sigma · TCS) target vs actual + candidate penalty
 *   brief_actions  what are we doing — open P1/P2 with owner and age, RCAs due / overdue
 *   brief_kpis     north-star tiles (measured ones only)
 * Data: GET /api/exec/brief?month=YYYY-MM (execBrief.js). The sections render a placeholder synchronously (EXECOPS
 * sections are sync) and a MutationObserver fills them when the brief arrives — so execops' own 5-minute refresh,
 * the ↻ button and the month switch all work without touching execops.js.
 * UX rules: calendar months (that is how vendor SLAs are reviewed), no number without a window, every tile a link,
 * plain-language names, no raw rule keys, tokens for light + dark, phone-first grid, RTL-safe. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const num = v => v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : esc(v);
  const KSA = 3 * 3600e3;
  const ksa = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? esc(v) : new Date(d.getTime() + KSA).toISOString().replace('T', ' ').slice(0, 16); };
  const dur = m => m == null ? '—' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
  const sar = v => v == null ? '—' : 'SAR ' + Math.round(v).toLocaleString('en-US');
  const api = p => fetch((window.API_BASE || window.CONSOLE_BASE || '') + p, { headers: { 'Content-Type': 'application/json' } }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
  const TONE = { OK: 'var(--green,#0e9f5a)', DEGRADED: 'var(--xo-p2,#d97706)', OUTAGE: 'var(--xo-p1,#dc2626)' };

  /* ---------- month state ---------- */
  const monthKey = off => { const d = new Date(Date.now() + KSA); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + off, 1)); return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`; };
  const monthLabel = k => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const state = { month: localStorage.getItem('exec_month') === 'prev' ? 'prev' : 'cur' };
  const curKey = () => state.month === 'prev' ? monthKey(-1) : monthKey(0);
  let cache = { key: null, at: 0, data: null, promise: null };
  async function brief(force) {
    const k = curKey();
    if (!force && cache.key === k && cache.data && Date.now() - cache.at < 60e3) return cache.data;
    if (cache.promise && cache.key === k) return cache.promise;
    cache.key = k;
    cache.promise = api(`/api/exec/brief?month=${k}`).then(d => { cache.data = d; cache.at = Date.now(); cache.promise = null; return d; }, e => { cache.promise = null; throw e; });
    return cache.promise;
  }

  /* ---------- pieces (same classes as execops.js so the page reads as one) ---------- */
  const sec = (kicker, title, right) => `<div class="xo-sec"><div><div class="xo-kick">${esc(kicker)}</div><h3 class="xo-title">${title}</h3></div>${right ? `<div class="xo-dim">${right}</div>` : ''}</div>`;
  const badge = h => `<span class="xo-biz xo-biz-${h.biz}">${esc(h.label)}</span>`;
  const pill = (state, text) => `<span class="xo-status" style="--c:${TONE[state] || 'var(--muted)'}"><i></i>${esc(text || state)}</span>`;
  const delta = (cur, prev, goodDown, fmt) => {
    if (prev == null || cur == null) return '';
    if (prev === cur) return `<span class="xb-d" style="color:var(--muted)">= last month</span>`;
    const up = cur > prev, good = goodDown ? !up : up;
    return `<span class="xb-d" style="color:${good ? TONE.OK : TONE.OUTAGE}">${up ? '▲' : '▼'} ${fmt ? fmt(prev) : num(prev)} last month</span>`;
  };
  const cnt = (v, text) => (typeof v === 'number' && isFinite(v)) ? `<span class="xb-cnt" data-v="${v}">${text != null ? text : num(v)}</span>` : (text != null ? text : num(v));
  const tile = (label, value, sub, href, tone) => `<a href="${esc(href || '#alerts')}" class="xo-kpi xb-tile" style="--t:${tone || 'var(--line)'}"><div class="xo-kh"><span class="xo-kt">${esc(label)}</span></div><div class="xo-kv">${value}</div><div class="xo-ks">${sub || ''}</div></a>`;
  const rcaPill = r => { const c = r.status === 'overdue' ? 'red' : r.status === 'due' ? 'amber' : r.status === 'pending' ? 'info' : 'muted'; return `<span class="xb-rca ${c}" title="${esc(r.text || '')}">${r.status === 'n/a' ? 'no clause' : esc(r.status)}${r.due ? ` · ${ksa(r.due).slice(5, 16)}` : ''}</span>`; };
  const halvesOf = d => [d.mobile, d.fixed].filter(h => h && h.status);
  const missingOf = d => [d.mobile, d.fixed].filter(h => h && h.configured === false);
  /* exec-level destinations per business: every number leads to the page where the detail lives
   * (SLO / SLA opens the SLA page on that business's tab — #slo?tab=mobile|fixed, 21 Sep 2026) */
  const L = h => h.biz === 'fixed'
    ? { dash: '#fixed?tab=overview', alerts: '#fixed-alerts', errors: '#fixed?tab=errors', money: '#fixed?tab=errors', oncall: '#fixed-oncall', slo: '#slo?tab=fixed', c360: '#sub360', contracts: '#vendor-contracts', dashLabel: 'Fixed overview', errLabel: 'Fixed errors' }
    : { dash: '#dashboard', alerts: '#alerts', errors: '#troubleshoot', money: '#troubleshoot?cat=payment', oncall: '#oncall', slo: '#slo?tab=mobile', c360: '#sub360', contracts: '#vendor-contracts', dashLabel: 'Mobile dashboard', errLabel: 'Troubleshoot' };
  const lnk = (href, text, title) => `<a href="${esc(href)}" class="xb-lnk" title="${esc(title || text)}">${text}</a>`;
  const grp = (h, inner, head, links) => `<div class="xb-panel"><div class="xb-ph">${badge(h)}${head ? `<span class="xb-phh">${head}</span>` : ''}${links ? `<span class="xb-pl">${links}</span>` : ''}</div>${inner}</div>`;
  const cols = inner => `<div class="xb-cols">${inner}</div>`;
  /* an executive reads problems, not firings: the same rule firing 22 times in a month is ONE problem with 22 occurrences */
  const groupBy = (items, key) => { const m = new Map(); items.forEach(x => { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return [...m.entries()].map(([k, v]) => ({ key: k, items: v })); };
  const TOP = 5;
  const none = (d, what) => halvesOf(d).length ? '' : `<div class="topo-card xo-err"><b>${esc(what)} unavailable</b><div class="xo-dim">${missingOf(d).map(m => `${esc(m.label)}: ${esc(m.reason || 'not configured')}`).join(' · ') || 'no business configured for your role'}</div></div>`;

  /* ---------- the five blocks ---------- */
  const BLOCK = {
    status: d => none(d, 'Status') + `<div class="xb-status">${halvesOf(d).map(h => { const s = h.status; return `
      <a href="${s.openP1 + s.openP2 ? L(h).alerts : L(h).dash}" class="topo-card xb-st xb-s-${s.state.toLowerCase()}" title="${s.openP1 + s.openP2 ? 'open the incidents' : 'open the ' + L(h).dashLabel}">
        <div class="xb-sth">${badge(h)}${pill(s.state, s.state === 'OK' ? 'OK' : s.state === 'DEGRADED' ? 'DEGRADED · P2 open' : 'OUTAGE · P1 open')}</div>
        <div class="xb-stv"><b>${cnt(s.affectedNow)}</b><span>customers affected now</span></div>
        <div class="xb-sts">${s.state === 'OK' ? 'no P1 / P2 incident open' : `${esc(s.what || '')}${s.since ? ` · since ${ksa(s.since).slice(11)} KSA` : ''}${s.owner ? ` · ${esc(s.owner)}` : ' · <b>nobody has taken it</b>'}`}${s.vendor ? `<span class="xo-dim"> · ${esc(s.vendor)}</span>` : ''}</div>
        <div class="xb-stl">${s.openP1 + s.openP2 ? 'Open the incidents →' : 'Open the ' + L(h).dashLabel + ' →'}</div>
      </a>`; }).join('')}</div>`,

    impact: d => none(d, 'Outage register') + cols(halvesOf(d).map(h => { const i = h.impact, p = i.prev || {};
      const headline = i.incidents ? `<b style="color:${TONE.OUTAGE}">${num(i.incidents)}</b> incident${i.incidents === 1 ? '' : 's'} · ${dur(i.minutes)} customer-facing · ${num(i.customers)} customer contacts` : `<b style="color:${TONE.OK}">no customer-facing incident</b> this month`;
      return grp(h, `
      <div class="xb-tiles">
        ${tile('Incidents', cnt(i.incidents), delta(i.incidents, p.incidents, true), L(h).alerts, i.incidents ? TONE.OUTAGE : TONE.OK)}
        ${tile('Customer-facing time', dur(i.minutes), delta(i.minutes, p.minutes, true, dur), L(h).alerts, i.minutes ? TONE.DEGRADED : TONE.OK)}
        ${tile('Customer contacts', cnt(i.customers), delta(i.customers, p.customers, true), L(h).c360)}
        ${tile('Money at risk', sar(i.money), delta(i.money, p.money, true, sar), L(h).money)}
        ${tile('Availability', `${i.availabilityPct == null ? '—' : i.availabilityPct.toFixed(2) + '%'}`, (delta(i.availabilityPct, p.availabilityPct, false, v => v.toFixed(2) + '%') || '') + '<span class="xb-d" style="color:var(--muted)">from P1 minutes</span>', L(h).slo, i.availabilityPct >= 99.9 ? TONE.OK : TONE.DEGRADED)}
      </div>
      <div class="xb-list">${i.list.length ? (() => { const g = groupBy(i.list, x => x.name).map(x => ({ name: x.key, n: x.items.length, minutes: x.items.reduce((s2, y) => s2 + (y.minutes || 0), 0), customers: x.items.reduce((s2, y) => s2 + (y.customers || 0), 0), open: x.items.some(y => y.status === 'open'), last: x.items.map(y => y.started).sort().slice(-1)[0], cause: (x.items.find(y => y.cause) || {}).cause, rca: x.items.some(y => y.rca.status === 'overdue') ? 'overdue' : x.items.some(y => y.rca.status === 'due') ? 'due' : x.items.some(y => y.rca.status === 'pending') ? 'pending' : x.items[0].rca.status, overdue: x.items.filter(y => y.rca.status === 'overdue').length })).sort((a, b) => b.open - a.open || b.minutes - a.minutes);
        return g.slice(0, TOP).map(x => `
        <a href="${L(h).alerts}" class="xb-inc ${x.open ? 'open' : ''}" title="open in ${h.label} alerts">
          <div class="xb-inc-l"><span class="xb-n">${x.n}×</span><b>${esc(x.name)}</b><span class="xb-when">last ${ksa(x.last).slice(5)}</span>${x.cause ? `<span class="xb-cause">${esc(x.cause)}</span>` : ''}</div>
          <div class="xb-inc-r"><span class="xb-m ${x.open ? 'hot' : ''}">${x.open ? 'open · ' : ''}${dur(x.minutes)}</span><span class="xb-m">${num(x.customers)} cust.</span>${rcaPill({ status: x.rca, text: x.overdue ? `${x.overdue} RCA overdue` : '' })}${x.overdue > 1 ? `<span class="xb-m">${x.overdue} overdue</span>` : ''}</div>
        </a>`).join('') + (g.length > TOP ? `<div class="xo-dim xb-more">${g.length - TOP} more problem${g.length - TOP === 1 ? '' : 's'} · ${i.list.length} incidents in total — see Alerts</div>` : `<div class="xo-dim xb-more">${g.length} problem${g.length === 1 ? '' : 's'} · ${i.list.length} incident${i.list.length === 1 ? '' : 's'}</div>`); })() : `<div class="xo-empty">No P1 incident of 5 minutes or more this month.</div>`}</div>`, headline, lnk(L(h).alerts, 'Alerts') + lnk(L(h).errors, L(h).errLabel) + lnk(L(h).dash, L(h).dashLabel)); }).join('')),

    vendors: d => none(d, 'Vendor delivery') + cols(halvesOf(d).map(h => { const v = h.vendor; if (!v) return grp(h, `<div class="xo-empty">No vendor assigned — Settings › Vendors &amp; contracts</div>`);
      const mark = r => r.ok === true ? `<span class="xb-ok">✓ met</span>` : r.ok === false ? `<span class="xb-bad">✕ ${r.breaches || ''} breached</span>` : `<span class="xo-dim">○ none</span>`;
      const row = (o, r) => {
        const kind = o.category === 'incident_response' ? 'Response' : o.category === 'restoration' ? 'Restoration' : o.category === 'rca' ? 'RCA' : 'Availability';
        let actual = '';
        if (o.category === 'incident_response' || o.category === 'restoration') actual = r.samples ? `median <b>${dur(r.median)}</b> · p90 ${dur(r.p90)} · ${r.met} / ${r.samples} on time` : 'no incident at this priority';
        else if (o.category === 'rca') actual = r.samples ? `${r.samples} due · <b>${r.overdue} overdue</b> · ${r.recorded} recorded` : 'no P1 / P2 restored';
        else actual = r.actualPct == null ? '—' : `<b>${r.actualPct.toFixed(2)}%</b> from P1 minutes`;
        return `<a href="${o.category === 'availability' ? L(h).slo : L(h).alerts}" class="xb-ob" title="${o.category === 'availability' ? 'open SLO / SLA' : 'open the ' + h.label + ' incidents'}"><div class="xb-ob-k">${esc(kind)}<span>${esc(r.sev)}</span></div><div class="xb-ob-t">${esc(r.target)}${r.business ? '<i title="business days compared as calendar days"> *</i>' : ''}</div><div class="xb-ob-a">${actual}</div><div class="xb-ob-m">${mark(r)}</div></a>`;
      };
      const unmeasured = v.obligations.filter(o => !o.measured);
      const head = v.breaches ? `<span class="xb-bad">${v.breaches} obligation${v.breaches === 1 ? '' : 's'} breached</span>` : `<span class="xb-ok">all measured obligations met</span>`;
      return grp(h, `
        <div class="xb-vh"><div class="xb-vn"><b><a href="${L(h).contracts}" class="xb-vlink" title="Vendors &amp; contracts">${esc(v.name)}</a></b><span class="xo-dim">${esc(v.contract ? v.contract.title : 'no contract on file')}${v.contract && v.contract.status ? ` · ${esc(v.contract.status)}` : ''}</span></div>
          <div class="xb-vp"><span class="xo-dim">candidate penalty</span><b>${v.exposureSar == null ? 'fee not configured' : sar(v.exposureSar)}</b>${v.contract && v.contract.capPct != null ? `<span class="xo-dim">cap ${v.contract.capPct}%</span>` : ''}</div></div>
        <div class="xb-obs"><div class="xb-ob xb-ob-h"><div>Obligation</div><div>Contract</div><div>Measured this month</div><div></div></div>
          ${v.obligations.filter(o => o.measured).flatMap(o => o.rows.filter(r => r.samples || o.category === 'availability').map(r => row(o, r))).join('') || `<div class="xo-empty">No incident this month to measure against.</div>`}
        </div>
        <div class="xb-foot">${unmeasured.length ? `Not measured by this console: ${unmeasured.map(o => esc(o.title)).join(' · ')}. ` : ''}${v.obligations.some(o => o.category === 'rca' && o.measured) ? 'RCA records are not tracked yet (Step B). ' : ''}Availability = 1 − P1 minutes ÷ month minutes. * business-day targets compared as calendar days.</div>`, head, lnk(L(h).contracts, 'Contract &amp; penalty model') + lnk(L(h).slo, 'SLO / SLA') + lnk(L(h).alerts, 'Incidents')); }).join('')),

    actions: d => none(d, 'Follow-up') + cols(halvesOf(d).map(h => { const a = h.actions;
      const head = a.open.length ? `<b style="color:${a.open.some(x => x.severity === 'P1') ? TONE.OUTAGE : TONE.DEGRADED}">${a.open.length}</b> open at P1 / P2${a.rca.overdue ? ` · <b style="color:${TONE.OUTAGE}">${groupBy(a.rca.items.filter(x => x.status === 'overdue'), x => x.name).length}</b> RCA overdue` : ''}` : `<b style="color:${TONE.OK}">nothing open</b> at P1 / P2${a.rca.overdue ? ` · <b style="color:${TONE.OUTAGE}">${groupBy(a.rca.items.filter(x => x.status === 'overdue'), x => x.name).length}</b> RCA overdue` : ''}`;
      return grp(h, `
        <div class="xb-ah">Open incidents</div>
        <div class="xb-list">${a.open.length ? a.open.map(x => `<a href="${L(h).alerts}" class="xb-inc ${x.severity === 'P1' ? 'open' : ''}" title="open in ${h.label} alerts">
          <div class="xb-inc-l"><span class="xo-sev ${x.severity === 'P1' ? 'critical' : 'warning'}">${x.severity}</span><b>${esc(x.name)}</b>${x.cause ? `<span class="xb-cause">${esc(x.cause)}</span>` : ''}</div>
          <div class="xb-inc-r"><span class="xb-m hot">${dur(x.ageMin)}</span><span class="xb-m">${x.customers != null ? num(x.customers) + ' cust.' : ''}</span><span class="xb-m">${x.owner ? esc(x.owner) : (x.acked ? 'acknowledged' : `<b style="color:${TONE.OUTAGE}">unassigned</b>`)}</span>${x.ticket ? `<span class="xb-m">${esc(x.ticket)}</span>` : ''}</div></a>`).join('') : `<div class="xo-empty">Nothing open at P1 / P2.</div>`}</div>
        <div class="xb-ah">RCAs owed <span class="xo-dim">${a.rca.due + a.rca.overdue + a.rca.pending ? `${groupBy(a.rca.items, x => x.name).length} problem${groupBy(a.rca.items, x => x.name).length === 1 ? '' : 's'} · ${a.rca.overdue + a.rca.due} incidents · ${a.rca.pending} still open · ${a.rca.recorded} RCA recorded` : 'none due this month'}</span></div>
        <div class="xb-list">${a.rca.items.length ? (() => { const g = groupBy(a.rca.items, x => x.name).map(x => ({ name: x.key, n: x.items.length, overdue: x.items.filter(y => y.status === 'overdue').length, due: x.items.map(y => y.due).sort()[0], last: x.items.map(y => y.ended).sort().slice(-1)[0], vendor: x.items[0].vendor })).sort((a2, b2) => b2.overdue - a2.overdue || b2.n - a2.n);
          return g.slice(0, TOP).map(x => `<a href="${L(h).alerts}" class="xb-inc" title="open in ${h.label} alerts"><div class="xb-inc-l"><span class="xb-rca ${x.overdue ? 'red' : 'amber'}">${x.overdue ? 'overdue' : 'due'}</span><b>${esc(x.name)}</b><span class="xb-when">${x.n} incident${x.n === 1 ? '' : 's'} · one RCA owed</span></div><div class="xb-inc-r"><span class="xb-m">first due ${ksa(x.due).slice(5)}</span><span class="xb-m">last restored ${ksa(x.last).slice(5)}</span>${x.vendor ? `<span class="xb-m">${esc(x.vendor)}</span>` : ''}</div></a>`).join('') + (g.length > TOP ? `<div class="xo-dim xb-more">${g.length - TOP} more problem${g.length - TOP === 1 ? '' : 's'} with an RCA owed</div>` : ''); })() : `<div class="xo-empty">No RCA due.</div>`}</div>`, head); }).join('')),

    kpis: d => none(d, 'Key indicators') + halvesOf(d).map(h => h.kpis.length ? grp(h, `<div class="xo-grid">${h.kpis.map(k => `<a href="${esc(k.href || '#')}" class="xo-kpi xo-t-${k.tone || 'none'}"><div class="xo-kh"><span class="xo-kt">${esc(k.title)}</span><span class="xo-win">${esc(k.window || '')}</span></div><div class="xo-kv">${num(k.value)}</div><div class="xo-ks">${esc(k.sub || '')}</div>${k.delta ? `<div class="xo-kd" style="color:${k.delta.pct === 0 ? 'var(--muted)' : k.delta.good ? TONE.OK : TONE.OUTAGE}">${k.delta.pct > 0 ? '+' : ''}${k.delta.pct}% vs previous 24 h</div>` : ''}</a>`).join('')}</div>`, null, lnk(L(h).dash, L(h).dashLabel) + lnk(L(h).slo, 'SLO / SLA')) : '').join(''),
  };
  /* [question, what it answers in plain words, window / method on the right] — the NUMBER in front of
   * each question is its position in V2, computed by qnum(), so reordering the page renumbers it. It used
   * to be a constant first element here, which meant moving a section left the old numbers behind. */
  const TITLES = {
    status: ['Are we OK right now?', 'Live status per business from open P1 / P2 incidents only — never from chronic SLOs — and how many customers are affected at this minute.', 'live · open P1 / P2'],
    kpis: ['Are the north-star KPIs moving?', 'The business indicators that matter, measured ones only, versus the previous day — each opens its operational page.', '24 h · measured only'],
    impact: ['What did it cost us?', 'Customer-facing incidents this month, the time customers were impacted, contacts touched and money at risk — against last month.', () => `${monthLabel(curKey())} · P1 ≥ 5 min · vs last month`],
    vendors: ['Are the vendors delivering?', 'Each contract obligation (TCS for Mobile, Sigma for Fixed) with its contractual target against what the console measured, and the candidate penalty.', () => `${monthLabel(curKey())} · contract target vs measured`],
    actions: ['What are we doing about it?', 'Who holds each open incident and for how long, and which RCAs the vendors owe us by the contract clause.', 'owner · age · RCA due dates'],
  };
  const qnum = k => { const i = V2.indexOf('brief_' + k); return i < 0 ? '' : String(i + 1); };
  const qsec = k => { const t = TITLES[k]; const right = typeof t[2] === 'function' ? t[2]() : t[2];
    return `<div class="xb-q" data-q="${k}"><div class="xb-qn">${qnum(k)}</div><div class="xb-qt"><h3 class="xb-qh">${esc(t[0])}</h3><div class="xb-qd">${esc(t[1])}</div></div><div class="xb-qr">${esc(right)}</div></div>`; };
  const placeholder = k => qsec(k) + `<div class="xb-block" data-brief="${k}"><div class="xo-loading">Loading…</div></div>`;

  /* ---------- fill the placeholders when the brief arrives ---------- */
  async function fill(host, force) {
    const slots = host.querySelectorAll('[data-brief]'); if (!slots.length) return;
    let d; try { d = await brief(force); } catch (e) { slots.forEach(s => s.innerHTML = `<div class="topo-card xo-err"><b>Could not load the brief</b><div class="xo-dim">${esc(e.message)}</div></div>`); return; }
    const miss = missingOf(d);
    slots.forEach(s => { try { s.innerHTML = (BLOCK[s.dataset.brief] || (() => ''))(d) + (s.dataset.brief === 'status' && miss.length && halvesOf(d).length ? `<div class="xo-missing">${miss.map(m => `<b>${esc(m.label)} half unavailable</b> — ${esc(m.reason || '')}`).join('<br>')}</div>` : ''); s.dataset.filled = '1'; } catch (e) { s.innerHTML = `<div class="topo-card xo-err">${esc(e.message)}</div>`; } });
    effects(host);
    const tools = host.querySelector('.xo-tools');
    if (tools && !tools.querySelector('.xb-month')) {
      const m = document.createElement('span'); m.className = 'xo-range xb-month';
      m.innerHTML = ['cur', 'prev'].map(k => `<button type="button" class="xo-r${state.month === k ? ' on' : ''}" data-m="${k}">${k === 'cur' ? 'this month' : 'last month'}</button>`).join('');
      m.querySelectorAll('button').forEach(b => b.onclick = () => { state.month = b.dataset.m; localStorage.setItem('exec_month', state.month); m.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); host.querySelectorAll('[data-brief]').forEach(s => { s.innerHTML = '<div class="xo-loading">Loading…</div>'; delete s.dataset.filled; }); host.querySelectorAll('.xb-q').forEach(sc => { const t = TITLES[sc.dataset.q]; if (t && typeof t[2] === 'function') { const dd = sc.querySelector('.xb-qr'); if (dd) dd.textContent = t[2](); } }); fill(host, true); });
      tools.insertBefore(m, tools.querySelector('[data-act="refresh"]'));
    }
  }

  /* ---------- effects: panels fade in one after the other, big numbers count up (skipped under reduced motion) ---------- */
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function effects(host) {
    host.querySelectorAll('.xb-block').forEach(b => b.querySelectorAll('.xb-panel, .xb-st').forEach((el, i) => { el.style.setProperty('--i', i); el.classList.add('xb-in'); }));
    if (reduced()) return;
    host.querySelectorAll('.xb-cnt[data-v]').forEach(el => {
      const v = Number(el.dataset.v); if (!isFinite(v) || v === 0 || el.dataset.done) return; el.dataset.done = '1';
      const t0 = performance.now(), ms = 700, ease = x => 1 - Math.pow(1 - x, 3);
      const step = t => { const k = Math.min(1, (t - t0) / ms); el.textContent = Math.round(v * ease(k)).toLocaleString('en-US'); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  /* ---------- register with execops ---------- */
  function ensureCss() {
    if ($('#xb-css')) return;
    const st = document.createElement('style'); st.id = 'xb-css'; st.textContent = `
      .xo-v2 .xo-tools > .xo-status, .xo-v2 .xo-tools > .xo-dim{display:none}   /* v2 status is the "now" block, never the chronic-SLO pill */
      .xb-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr));gap:14px}
      .xb-st{display:block;text-decoration:none;color:inherit;padding:16px 18px;border-left:6px solid var(--c,var(--line));transition:transform .15s,box-shadow .15s}
      .xb-st:hover{transform:translateY(-1px);box-shadow:var(--shadow,0 8px 22px rgba(15,23,42,.12))}
      .xb-st.xb-s-ok{--c:${TONE.OK}} .xb-st.xb-s-degraded{--c:${TONE.DEGRADED}} .xb-st.xb-s-outage{--c:${TONE.OUTAGE}}
      .xb-sth{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
      .xb-stv{display:flex;align-items:baseline;gap:10px;margin:12px 0 4px}.xb-stv b{font-size:40px;line-height:1;font-weight:900;font-variant-numeric:tabular-nums;color:var(--c)}.xb-stv span{color:var(--muted);font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
      .xb-sts{font-size:13px;margin-top:6px}
      .xb-q{display:flex;align-items:flex-start;gap:14px;margin:26px 0 12px;padding-bottom:10px;border-bottom:1px solid var(--line)}
      .xb-qn{flex:none;width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;color:#fff;background:linear-gradient(135deg,#0e9f5a,#019c20);box-shadow:0 6px 16px rgba(14,159,90,.28)}
      .xb-qt{flex:1 1 auto;min-width:0}.xb-qh{margin:0;font-size:18px;font-weight:800;letter-spacing:-.01em;line-height:1.2}
      .xb-qd{font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.4;max-width:900px}
      .xb-qr{flex:none;font-size:11px;color:var(--muted);font-weight:700;padding-top:4px;text-align:right;white-space:nowrap}
      .xb-pl{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
      .xb-lnk{font-size:11px;font-weight:700;color:var(--green,#0e9f5a);text-decoration:none;padding:3px 9px;border-radius:999px;border:1px solid color-mix(in srgb,var(--green,#0e9f5a) 35%,transparent);background:color-mix(in srgb,var(--green,#0e9f5a) 8%,transparent);transition:background .15s,transform .15s}
      .xb-lnk:hover{background:color-mix(in srgb,var(--green,#0e9f5a) 18%,transparent);transform:translateY(-1px)}
      .xb-vlink{color:inherit;text-decoration:none;border-bottom:1px dashed color-mix(in srgb,var(--ink) 35%,transparent)}.xb-vlink:hover{color:var(--green,#0e9f5a)}
      .xb-stl{margin-top:10px;font-size:11.5px;font-weight:800;color:var(--green,#0e9f5a);opacity:0;transform:translateX(-4px);transition:opacity .2s,transform .2s}.xb-st:hover .xb-stl{opacity:1;transform:none}
      .xb-in{animation:xbIn .42s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0) * 70ms)}
      @keyframes xbIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      .xb-cnt{font-variant-numeric:tabular-nums}
      a.xb-ob{text-decoration:none;color:inherit;transition:border-color .15s,transform .15s}a.xb-ob:hover{border-color:color-mix(in srgb,var(--ink) 30%,transparent);transform:translateX(2px)}
      a.xb-inc{transition:border-color .15s,transform .15s,box-shadow .15s}a.xb-inc:hover{transform:translateY(-1px);box-shadow:var(--shadow,0 6px 16px rgba(15,23,42,.10))}
      .xb-tile{transition:transform .15s,box-shadow .15s}.xb-tile:hover{transform:translateY(-2px);box-shadow:var(--shadow,0 8px 22px rgba(15,23,42,.12))}
      @media (prefers-reduced-motion:reduce){.xb-in{animation:none}.xb-tile,.xb-inc,.xb-ob,.xb-lnk{transition:none}}
      .xb-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(520px,100%),1fr));gap:14px;align-items:start}
      .xb-panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px 10px;min-width:0}
      .xb-ph{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:2px 2px 10px;margin-bottom:10px;border-bottom:1px solid var(--line);font-size:13px}
      .xb-phh{font-weight:600}.xb-phh b{font-weight:900}
      .xb-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:12px}
      .xb-tile{border-top-color:var(--t)!important;padding:9px 10px!important;min-width:0}.xb-tile .xo-kv{font-size:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xb-tile .xo-kt{font-size:10px;letter-spacing:.4px}.xb-tile .xo-ks{font-size:10.5px}
      @media (max-width:1100px){.xb-tiles{grid-template-columns:repeat(5,minmax(0,1fr))}.xb-tile .xo-kv{font-size:18px}}
      .xb-d{display:block;font-size:11px;font-weight:700;margin-top:4px}
      .xb-list{display:flex;flex-direction:column;gap:6px}
      .xb-inc{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:inherit;background:var(--bg);flex-wrap:wrap}
      a.xb-inc:hover{border-color:color-mix(in srgb,var(--ink) 25%,transparent)}
      .xb-inc.open{border-color:color-mix(in srgb,${TONE.OUTAGE} 45%,transparent);background:color-mix(in srgb,${TONE.OUTAGE} 6%,var(--bg))}
      .xb-inc-l{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 260px;flex-wrap:wrap}.xb-inc-l b{font-size:13px}
      .xb-inc-r{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px}
      .xb-when{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
      .xb-n{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:22px;padding:0 7px;border-radius:7px;font-size:12px;font-weight:900;font-variant-numeric:tabular-nums;background:var(--card);border:1px solid var(--line);color:var(--ink)}
      .xb-m{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--muted);font-weight:600}.xb-m.hot{color:${TONE.OUTAGE};font-weight:800}
      .xb-cause{flex-basis:100%;font-size:11.5px;color:var(--muted);line-height:1.35}
      .xb-more{padding:4px 2px}
      .xb-rca{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.3px;padding:2px 8px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
      .xb-rca.red{color:#dc2626;background:color-mix(in srgb,#dc2626 11%,transparent);border-color:color-mix(in srgb,#dc2626 28%,transparent)}
      .xb-rca.amber{color:#d97706;background:color-mix(in srgb,#d97706 11%,transparent);border-color:color-mix(in srgb,#d97706 28%,transparent)}
      .xb-rca.info{color:#2563eb;background:color-mix(in srgb,#2563eb 11%,transparent);border-color:color-mix(in srgb,#2563eb 28%,transparent)}
      .xb-rca.muted{color:var(--muted);background:var(--bg);border-color:var(--line)}
      .xb-vh{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
      .xb-vn{display:flex;flex-direction:column;gap:2px}.xb-vn b{font-size:16px}.xb-vn .xo-dim{font-weight:500}
      .xb-vp{display:flex;flex-direction:column;align-items:flex-end;gap:1px;font-size:11px}.xb-vp b{font-size:15px}
      .xb-obs{display:flex;flex-direction:column;gap:4px}
      .xb-ob{display:grid;grid-template-columns:150px 120px 1fr 110px;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--bg);font-size:12.5px}
      .xb-ob-h{background:transparent;border:0;padding:2px 10px;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);font-weight:800}
      .xb-ob-k{font-weight:800}.xb-ob-k span{display:inline-block;margin-left:6px;font-size:10.5px;font-weight:800;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:0 5px}
      .xb-ob-t{font-variant-numeric:tabular-nums;font-weight:600}.xb-ob-t i{color:var(--muted);font-style:normal}
      .xb-ob-a{color:var(--muted)}.xb-ob-a b{color:var(--ink)}
      .xb-ob-m{text-align:right}
      .xb-ok{color:${TONE.OK};font-weight:800;white-space:nowrap}.xb-bad{color:${TONE.OUTAGE};font-weight:800;white-space:nowrap}
      .xb-foot{font-size:11px;color:var(--muted);margin-top:10px;line-height:1.45}
      .xb-ah{font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;font-weight:800;color:var(--muted);padding:6px 2px}
      .xb-block .xb-panel+.xb-panel{margin-top:14px}
      html[dir=rtl] .xb-st{border-left:1px solid var(--line);border-right:6px solid var(--c,var(--line))}
      html[dir=rtl] .xb-ob-m{text-align:left} html[dir=rtl] .xb-vp{align-items:flex-start}
      @media (max-width:820px){.xb-ob{grid-template-columns:1fr 1fr;grid-template-areas:"k t" "a m"}.xb-ob>:nth-child(1){grid-area:k}.xb-ob>:nth-child(2){grid-area:t;text-align:right}.xb-ob>:nth-child(3){grid-area:a}.xb-ob>:nth-child(4){grid-area:m}.xb-ob-h{display:none}}
      @media (max-width:720px){.xb-stv b{font-size:32px}.xb-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}.xb-q{gap:10px}.xb-qh{font-size:16px}.xb-qr{display:none}.xb-pl{margin-left:0;width:100%}.xb-tile .xo-kv{font-size:20px}.xb-panel{padding:10px 10px 8px}.xb-inc-r{width:100%;justify-content:space-between}}
    `; document.head.appendChild(st);
  }
  function install() {
    if (!window.EXECOPS || !window.EXECOPS.sections) return false;
    const S = window.EXECOPS.sections;
    Object.keys(BLOCK).forEach(k => { S['brief_' + k] = () => placeholder(k); });
    return true;
  }
  /* The alert radar left this page on 19 Sep 2026. It was the last section before the footer, and it
   * said a second, slower time what 'What did it cost us' and the follow-up list already say. It lives
   * on the NOC wall (#noc), which asks EXECOPS for sections:['radar'] itself and is untouched; the
   * '\u25c9 NOC wall' button in this page's header is the way there. SECTION.radar is unchanged. */
  const V2 = ['brief_status', 'brief_kpis', 'brief_impact', 'brief_vendors', 'brief_actions', 'foot'];
  function openV2() {
    const host = $('#view-execops'); if (!host || !install()) return;
    ensureCss(); host.classList.add('xo-v2');
    document.querySelectorAll('.navtab[data-view="execops"]').forEach(b => b.classList.add('active'));
    document.querySelectorAll('.navtab:not([data-view="execops"]).active').forEach(b => b.classList.remove('active'));
    if (window.navdropSync) window.navdropSync();
    if (!host._xbObs) {   // execops re-renders on ↻ and every 5 min: whenever fresh placeholders appear, fill them
      host._xbObs = new MutationObserver(() => { if (host.querySelector('[data-brief]:not([data-filled])')) fill(host, false); });
      host._xbObs.observe(host, { childList: true, subtree: false });
    }
    window.EXECOPS.render(host, { biz: 'all', sections: V2, title: 'Executive Dashboard', range: false,
      sub: 'CEO / CIO brief · are we OK now · what it cost · vendors vs contract · follow-up · north-star',
      kicker: 'executive', brief: true });
    fill(host, false);
  }
  if (install()) window.openExecOps = openV2;
  else document.addEventListener('DOMContentLoaded', () => { if (install()) window.openExecOps = openV2; });
})();
