/* cst-remedy.js — CST Escalations › Live from Remedy (17 Sep 2026).
 *
 * The page above this section is the engagement runbook's §10.2 snapshot: verified, dated, and frozen at
 * 8 Sep. This section is the same questions asked of ARSystem itself (dbo.ITC_CITC_MOH on 172.30.1.14) —
 * the board's own KPIs on live rows, a search by any identifier an engineer actually holds, and the findings
 * the snapshot cannot answer.
 *
 * Two facts drive the whole design, both measured on 17 Sep rather than assumed:
 *   · 824 898 rows carry only 777 112 distinct Service_RequestID — 47 786 duplicate rows (5.8 %). Every figure
 *     here counts COMPLAINTS, not rows, and each result says how many rows of the view it collapsed.
 *   · a full count costs ~4.4 s, so KPIs and findings are cached server-side (10 / 30 min) and the search is
 *     the only thing that runs on demand.
 * Customer_Name and ID_Number arrive masked; Unmask is capability-gated and audited. Nothing here is stored. */
(function () {
  "use strict";
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : esc(v);
  const T = { ok: 'var(--green,#0e9f5a)', warn: 'var(--xo-p2,#d97706)', bad: 'var(--xo-p1,#dc2626)', info: '#2563eb', muted: 'var(--muted)', line: 'var(--line)' };
  const api = (p, opt) => fetch((window.API_BASE || window.CONSOLE_BASE || '') + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt || {}))
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
  const kpi = (label, value, sub, tone) => `<div class="cs-kpi" style="--t:${tone || T.line}"><div class="cs-kl">${esc(label)}</div><div class="cs-kv">${value}</div><div class="cs-ks">${sub || ''}</div></div>`;
  const card = (title, body, right) => `<div class="topo-card cs-card"><div class="cs-ch"><b>${title}</b>${right ? `<span class="cs-dim">${right}</span>` : ''}</div>${body}</div>`;
  const dt = v => { if (!v) return '—'; const s = String(v).replace('T', ' '); return esc(s.slice(0, 19)); };
  const FIELDS = [['', 'Any identifier'], ['req', 'Complaint number (REQ / SRID)'], ['incident', 'Remedy incident / work order'],
    ['custId', 'Customer number'], ['serviceId', 'Service id'], ['orderNo', 'Order number'], ['idNumber', 'National / Iqama id']];
  const S = { days: 90, term: '', field: '', contains: false, res: null, busy: false, open: new Set(), unmask: false };

  const STYLE = `
    #csRemedy .rx-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 10px}
    #csRemedy .rx-dot{width:8px;height:8px;border-radius:50%;background:var(--green,#0e9f5a);display:inline-block}
    #csRemedy .rx-dot.off{background:var(--muted)} #csRemedy .rx-dot.bad{background:var(--xo-p1,#dc2626)}
    #csRemedy .rx-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
    #csRemedy .rx-in{font:inherit;font-size:13px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card2,#f1f5f9);color:var(--ink);min-width:0}
    #csRemedy input.rx-in{flex:1 1 280px} #csRemedy select.rx-in{flex:0 0 auto}
    #csRemedy .rx-in:focus{outline:none;border-color:var(--green,#0e9f5a);box-shadow:0 0 0 3px rgba(14,159,90,.15)}
    #csRemedy label.rx-ck{display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer;white-space:nowrap;color:var(--muted)}
    #csRemedy label.rx-ck input{accent-color:var(--green,#0e9f5a);width:15px;height:15px}
    #csRemedy .rx-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px;max-width:100%}
    #csRemedy table.rx-tbl{width:100%;border-collapse:collapse;font-size:13px;min-width:720px}
    #csRemedy .rx-tbl th{text-align:left;padding:10px 13px;color:var(--muted);font-weight:700;font-size:11px;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--line);white-space:nowrap}
    #csRemedy .rx-tbl td{padding:9px 13px;border-bottom:1px solid var(--line-soft,var(--line));vertical-align:middle;overflow:hidden}
    #csRemedy tr.rx-r{cursor:pointer;transition:background .12s} #csRemedy tr.rx-r:hover td,#csRemedy tr.rx-r.on td{background:var(--card2,#f8fafc)}
    #csRemedy tr.rx-r td:first-child{box-shadow:inset 3px 0 0 transparent} #csRemedy tr.rx-r:hover td:first-child,#csRemedy tr.rx-r.on td:first-child{box-shadow:inset 3px 0 0 var(--green,#0e9f5a)}
    #csRemedy .rx-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap}
    #csRemedy .rx-cut{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #csRemedy .rx-x td{padding:12px 13px 16px;background:var(--card,#fff)}
    #csRemedy .rx-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:9px 18px}
    #csRemedy .rx-kv div{font-size:12.5px;min-width:0} #csRemedy .rx-kv .k{color:var(--muted);display:block;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
    #csRemedy .rx-kv .v{font-weight:600;word-break:break-word} #csRemedy .rx-long{margin-top:10px}
    #csRemedy .rx-long pre{margin:4px 0 0;background:var(--card2,#f8fafc);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto}
    #csRemedy .rx-note{font-size:11.5px;color:var(--muted)} #csRemedy .rx-note b{color:var(--ink)}
    #csRemedy .rx-warn{border-left:4px solid var(--xo-p1,#dc2626);background:rgba(220,76,76,.07);border-radius:8px;padding:9px 12px;font-size:12.5px;margin-bottom:10px}
    #csRemedy .rx-bars{display:flex;flex-direction:column;gap:6px;margin-top:4px}
    #csRemedy .rx-b{display:grid;grid-template-columns:minmax(90px,1.6fr) 1fr auto;gap:10px;align-items:center;font-size:12.5px}
    #csRemedy .rx-b i{display:block;height:8px;border-radius:999px;background:var(--line)} #csRemedy .rx-b i span{display:block;height:100%;border-radius:999px}
    #csRemedy .rx-b b{font-variant-numeric:tabular-nums}
    @media (max-width:700px){#csRemedy table.rx-tbl{min-width:600px} #csRemedy .rx-x .rx-in2{position:sticky;left:0;width:calc(100vw - 96px);max-width:calc(100vw - 96px)}}
  `;
  const bars = items => { const max = Math.max(1, ...items.map(i => i.n)); return `<div class="rx-bars">${items.map(i =>
    `<div class="rx-b"><span class="rx-cut" title="${esc(i.label)}">${esc(i.label)}</span><i><span style="width:${Math.round(i.n / max * 100)}%;background:${i.color || T.info}"></span></i><b>${num(i.n)}${i.sub ? ` <span class="rx-note">${esc(i.sub)}</span>` : ''}</b></div>`).join('')}</div>`; };

  async function render(host) {
    if (!host) return;
    host.innerHTML = `<div id="csRemedy"><style>${STYLE}</style>
      <div class="cs-ch" style="margin-bottom:6px"><b>Live from Remedy</b><span class="cs-dim" id="rxBar">connecting…</span></div>
      <div id="rxKpis"></div>
      <div class="topo-card cs-card">
        <div class="cs-ch"><b>Find a complaint</b><span class="cs-dim">any identifier · queried on ARSystem, never stored · every search is audited</span></div>
        <div class="rx-row">
          <input id="rxQ" class="rx-in" placeholder="REQ / SRID · Remedy incident · customer number · service id · order no · national id" autocomplete="off" spellcheck="false" value="${esc(S.term)}">
          <select id="rxField" class="rx-in">${FIELDS.map(([v, l]) => `<option value="${v}"${S.field === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <label class="rx-ck"><input type="checkbox" id="rxContains"${S.contains ? ' checked' : ''}> contains</label>
          <button type="button" class="cs-btn" id="rxGo">🔎 Search Remedy</button>
        </div>
        <div id="rxOut"></div>
      </div>
      <div id="rxFindings"></div></div>`;
    const $ = s => host.querySelector(s);
    $('#rxGo').onclick = () => run(host);
    $('#rxQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); run(host); } };
    $('#rxField').onchange = e => { S.field = e.target.value; };
    $('#rxContains').onchange = e => { S.contains = e.target.checked; };
    if (S.res) draw(host);
    loadKpis(host);
  }

  async function loadKpis(host) {
    const $ = s => host.querySelector(s);
    try {
      const st = await api('/api/cst/remedy/source');
      if (!st.configured) { $('#rxBar').innerHTML = `<span class="rx-dot off"></span> not configured — CST_REMEDY_* in /apps/unified/.env`; return; }
      const jv = st.jvmInfo || {};
      $('#rxBar').innerHTML = `<span class="rx-dot${st.lastError ? ' bad' : ''}"></span> ${esc(st.view)} on ${esc(st.host)}:${st.port} · ${esc(st.database)}`
        + (st.executeAs ? ` · running as <b>${esc(st.executeAs)}</b>` : ` · <span style="color:var(--xo-p2,#d97706)">no privilege drop</span>`)
        + (st.tcp && st.tcp.ok ? ` · reachable in ${st.tcp.ms} ms` : '');
    } catch (e) { $('#rxBar').innerHTML = `<span class="rx-dot bad"></span> ${esc(e.message)}`; }
    $('#rxKpis').innerHTML = `<div class="cs-loading">Reading ${S.days} days from ARSystem…</div>`;
    let k;
    try { k = await api('/api/cst/remedy/kpis?days=' + S.days); }
    catch (e) { $('#rxKpis').innerHTML = `<div class="rx-warn"><b>Live KPIs unavailable</b> — ${esc(e.message)}</div>`; return; }
    const t = k.totals;
    $('#rxKpis').innerHTML = `<div class="cs-kpis">
      ${kpi('Complaints (live)', num(t.tickets), `${S.days} days · ${t.perDay} / day · ${num(t.rawRows)} rows in the view`, T.info)}
      ${kpi('Still open', num(t.open), `${t.openPct == null ? '—' : t.openPct + '%'} of the window`, t.open ? T.warn : T.ok)}
      ${kpi('5-day breaches', num(t.breaches), `${t.breachPct == null ? '—' : t.breachPct + '%'} · ${num(t.closedLate)} closed late, ${num(t.openLate)} still open past day 5`, T.bad)}
      ${kpi('Average closure', t.avgClosureDays == null ? '—' : t.avgClosureDays + ' d', `median in ${esc(t.medianClosureBucket || '—')} · ${num(t.closed)} closed`, T.info)}
      ${kpi('Duplicate rows', num(t.duplicateRows), `${t.duplicatePct == null ? '—' : t.duplicatePct + '%'} of rows are the same complaint twice`, t.duplicateRows ? T.warn : T.ok)}
    </div>
    <div class="cs-grid2">
      ${card('Closure lag', bars(k.lag.map(l => ({ label: l.label, n: l.tickets, sub: l.pct == null ? '' : l.pct + '%', color: /0–5/.test(l.label) ? T.ok : /6–15/.test(l.label) ? T.info : /16–30/.test(l.label) ? T.warn : T.bad }))), 'closed complaints only')}
      ${card('Where they land', bars(k.byTier1.slice(0, 8).map(x => ({ label: x.key, n: x.tickets, sub: x.open ? x.open + ' open' : '', color: T.info }))), 'Categorization_Tier_1')}
    </div>
    <div class="cs-grid2">
      ${card('Status', bars(k.byStatus.slice(0, 8).map(x => ({ label: x.key, n: x.tickets, color: /closed|resolved/i.test(x.key) ? T.ok : T.warn }))), 'as Remedy holds it')}
      ${card('Source', bars(k.bySource.slice(0, 8).map(x => ({ label: x.key, n: x.tickets, color: T.muted }))), 'ITC_Source')}
    </div>
    <div class="rx-note" style="margin:-4px 0 12px">Counted as complaints, not rows: ${num(t.rawRows)} rows in the window collapse to ${num(t.tickets)} distinct Service_RequestID. One scan, ${k.ms ? (k.ms / 1000).toFixed(1) + ' s' : '—'}${k.cached ? ' · cached' : ''}.</div>`;
    loadFindings(host);
  }

  async function loadFindings(host) {
    const el = host.querySelector('#rxFindings'); if (!el) return;
    let f;
    try { f = await api('/api/cst/remedy/findings?days=' + S.days); }
    catch (e) { el.innerHTML = `<div class="rx-warn">Findings unavailable — ${esc(e.message)}</div>`; return; }
    el.innerHTML = (f.items || []).map(it => {
      if (it.error) return card(esc(it.title), `<div class="rx-warn">${esc(it.error)}</div>`, 'could not run');
      const rows = it.rows || [];
      if (!rows.length) return card(esc(it.title), `<div class="rx-note">Nothing matched in the last ${f.days} days — which is the answer.</div>`, esc(it.note));
      const cols = Object.keys(rows[0]);
      return card(esc(it.title), `<div class="rx-scroll"><table class="rx-tbl"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 25).map(r => `<tr>${cols.map(c => `<td>${/date|_at$/i.test(c) ? dt(r[c]) : num(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`, esc(it.note));
    }).join('');
  }

  async function run(host) {
    const $ = s => host.querySelector(s);
    S.term = $('#rxQ').value.trim(); S.field = $('#rxField').value; S.contains = $('#rxContains').checked;
    if (S.term.length < 3) { $('#rxOut').innerHTML = `<div class="rx-warn">Type at least 3 characters.</div>`; return; }
    if (S.busy) return; S.busy = true; S.open = new Set();
    const b = $('#rxGo'); const old = b.textContent; b.disabled = true; b.textContent = '… searching ARSystem';
    $('#rxOut').innerHTML = `<div class="cs-loading">Searching ${esc(S.term)} across ${S.field ? 'one column' : 'every identifier column'}…</div>`;
    try {
      S.res = await api(`/api/cst/remedy/search?q=${encodeURIComponent(S.term)}${S.field ? '&field=' + S.field : ''}${S.contains ? '&contains=1' : ''}${S.unmask ? '&unmask=1' : ''}`);
      draw(host);
    } catch (e) { S.res = null; $('#rxOut').innerHTML = `<div class="rx-warn"><b>Search failed</b> — ${esc(e.message)}</div>`; }
    finally { S.busy = false; b.disabled = false; b.textContent = old; }
  }

  function draw(host) {
    const el = host.querySelector('#rxOut'); if (!el) return; const d = S.res || {};
    if (d.ok === false) { el.innerHTML = `<div class="rx-warn">${esc(d.error)}</div>`; return; }
    const rows = d.tickets || [];
    const head = `<div class="rx-note" style="margin:2px 0 8px"><b>${rows.length}</b> complaint${rows.length === 1 ? '' : 's'}${d.truncated ? ' (capped)' : ''} · searched ${d.field === 'any' ? d.searched.length + ' identifier columns' : esc((d.searched[0] || {}).label || d.field)} · ${d.contains ? 'contains' : 'exact'} · ${(d.ms / 1000).toFixed(1)} s
      ${d.unmasked ? ' · <span style="color:var(--xo-p2,#d97706)">PII unmasked — audited</span>' : (d.unmaskAvailable ? ` · <button type="button" class="cs-btn ghost" id="rxUnmask">🔓 Unmask (audited)</button>` : ' · names and ids masked')}</div>`;
    if (!rows.length) { el.innerHTML = head + `<div class="rx-note">No complaint in ${esc(d.view)} carries that value${d.contains ? '' : ' exactly — try <b>contains</b>'}.</div>`; return; }
    el.innerHTML = head + `<div class="rx-scroll"><table class="rx-tbl"><thead><tr>
      <th>COMPLAINT</th><th>CREATED</th><th>RESOLVED</th><th>STATUS</th><th>CATEGORY</th><th>CUSTOMER</th><th>SERVICE</th><th>ROWS</th></tr></thead><tbody>${rows.map((r, i) => `
      <tr class="rx-r${S.open.has(i) ? ' on' : ''}" data-i="${i}" tabindex="0">
        <td><b>${esc(r.SERVICE_REQUESTID)}</b><span class="rx-note" style="display:block">${esc(r.INCIDENT_NUMBER || '')}</span></td>
        <td style="white-space:nowrap">${dt(r.CREATION_DATE)}</td>
        <td style="white-space:nowrap">${r.RESOLVED_DATE ? dt(r.RESOLVED_DATE) : `<span class="rx-pill" style="background:rgba(217,119,6,.14);color:var(--xo-p2,#d97706)">open</span>`}</td>
        <td>${esc(r.STATUS || '—')}</td>
        <td style="max-width:260px"><span class="rx-cut" title="${esc([r.CATEGORIZATION_TIER_1, r.CATEGORIZATION_TIER_2, r.CATEGORIZATION_TIER_3].filter(Boolean).join(' › '))}">${esc([r.CATEGORIZATION_TIER_1, r.CATEGORIZATION_TIER_2].filter(Boolean).join(' › ') || '—')}</span></td>
        <td style="max-width:180px"><span class="rx-cut">${esc(r.ITC_CUSTOMER_NUMBER || '—')}</span><span class="rx-note rx-cut">${esc(r.CUSTOMER_NAME || '')}</span></td>
        <td style="max-width:180px"><span class="rx-cut">${esc(r.ITC_SERVICE_ID || '—')}</span></td>
        <td>${r.RAW_ROWS > 1 ? `<span class="rx-pill" style="background:rgba(217,119,6,.14);color:var(--xo-p2,#d97706)" title="this complaint appears ${r.RAW_ROWS} times in the view">${r.RAW_ROWS}×</span>` : '1'}</td>
      </tr><tr class="rx-x" data-i="${i}" hidden><td colspan="8"></td></tr>`).join('')}</tbody></table></div>`;
    const un = host.querySelector('#rxUnmask');
    if (un) un.onclick = () => { if (!confirm('Fetch the customer name and national id for these complaints from Remedy? This access is written to the audit log.')) return; S.unmask = true; run(host); };
    el.querySelectorAll('tr.rx-r').forEach(tr => {
      const toggle = () => {
        const i = Number(tr.dataset.i), x = el.querySelector(`tr.rx-x[data-i="${i}"]`);
        if (!x) return;
        if (!x.hidden) { x.hidden = true; tr.classList.remove('on'); S.open.delete(i); return; }
        x.hidden = false; tr.classList.add('on'); S.open.add(i); detail(x.firstElementChild, rows[i]);
      };
      tr.onclick = toggle; tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    });
    for (const i of S.open) { const tr = el.querySelector(`tr.rx-r[data-i="${i}"]`), x = el.querySelector(`tr.rx-x[data-i="${i}"]`); if (tr && x) { x.hidden = false; tr.classList.add('on'); detail(x.firstElementChild, rows[i]); } }
  }

  /* the whole ticket as ARSystem holds it — long text separated out so the grid stays readable */
  const LONG = ['RESOLUTION', 'ITC_ACTION_TAKEN'];
  const LABEL = { SERVICE_REQUESTID: 'Complaint (REQ / SRID)', INCIDENT_NUMBER: 'Remedy incident', CREATION_DATE: 'Created', RESOLVED_DATE: 'Resolved',
    STATUS: 'Status', STATUS_CODE: 'Status code', STATUS_REASON: 'Status reason', CATEGORIZATION_TIER_1: 'Tier 1', CATEGORIZATION_TIER_2: 'Tier 2',
    CATEGORIZATION_TIER_3: 'Tier 3', PROBLEM_CODE: 'Problem code', ITC_CUSTOMER_NUMBER: 'Customer number', CUSTOMER_NAME: 'Customer name',
    ID_TYPE: 'Id type', ID_NUMBER: 'National / Iqama id', CUSTOMER_TYPE: 'Customer type', ITC_SERVICE_ID: 'Service id', ITC_ORDER_NUMBER: 'Order number',
    ITC_PRODUCT_NAME: 'Product', SERVICE_STATUS: 'Service status', ACTIVATION_DATE: 'Activation', ITC_SOURCE: 'Source', PROVIDER_NAME: 'Provider',
    TROUBLE_TICKET_TYPES: 'Ticket type', CITC_COMPLAINT_TYPECODE: 'CST complaint code', CITC_COMPLAINT_SUBTYPECODE: 'CST complaint sub-code',
    CITC_SERVICE_MAINTYPECODE: 'CST service code', CITC_SERVICE_SUBTYPECODE: 'CST service sub-code', RAW_ROWS: 'Rows in the view' };
  function detail(cell, r) {
    const keys = Object.keys(r).filter(k => !LONG.includes(k));
    cell.innerHTML = `<div class="rx-in2"><div class="rx-kv">${keys.map(k => `<div><span class="k">${esc(LABEL[k] || k)}</span><span class="v">${/DATE$/.test(k) ? dt(r[k]) : (r[k] == null || r[k] === '' ? '—' : esc(r[k]))}</span></div>`).join('')}</div>
      ${LONG.filter(k => r[k]).map(k => `<div class="rx-long"><span class="k rx-note">${esc(LABEL[k] || k)}</span><pre>${esc(r[k])}</pre></div>`).join('')}</div>`;
  }

  window.cstRemedy = { render, state: S };
})();
