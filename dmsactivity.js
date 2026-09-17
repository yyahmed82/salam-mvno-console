/* dmsactivity.js — DEALER ACTIVITY (17 Sep 2026): everything one dealer did in the DMS app, from DMS's own
 * audit ledgers (dms_audit_logs, every journey table), inside a window — shown two ways:
 *   • JOURNEYS  the same customer (masked MSISDN / ID) touched within 60 min = one flow, steps in order
 *               (Semati → Nafath → activation → SMS …); dealer-own actions (wallet, CMS) stand alone
 *   • LIST      every action as a row — time, journey, endpoint, outcome, customer, plan, message, ref
 * Any row opens the full-row popup (every column of the ledger row + cross-journey trace).
 * Data: GET /api/dms/journeys/dealer-activity (server/src/dmsJourneys.js dealerActivity). Identifiers are
 * masked unless the global PII reveal is on (capability-gated + audited server-side).
 * Mounted by dms.js (full Dealer 360) and dmsjourney.js (dealer popup, compact). */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => v == null ? '—' : Number(v).toLocaleString('en-US');
  const KT = () => window.KT || { md: v => String(v || '').replace('T', ' ').slice(0, 16), dmy: v => String(v || '').slice(0, 10), t: v => String(v || '').slice(11, 16) };
  const um = () => !!(window.PII && window.PII.on);
  const api = p => fetch((window.API_BASE || window.CONSOLE_BASE || '') + p).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
  const RED = '#dc2626', GREEN = '#16a34a', AMBER = '#d97706', BLUE = '#2563eb';

  function css() {
    if (document.getElementById('da-css')) return;
    const st = document.createElement('style'); st.id = 'da-css'; st.textContent = `
      .da{border:1px solid var(--line);border-radius:14px;background:var(--card,#fff);padding:12px 14px;margin-top:12px;min-width:0}
      .da-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
      .da-title{font-size:12.5px;font-weight:800}.da-sub{font-size:10.5px;color:var(--muted)}
      .da-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0 10px}
      .da-chip{font:inherit;font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--card,#fff);color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:transform .12s,box-shadow .12s}
      .da-chip:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(2,6,23,.10);color:var(--ink)}
      .da-chip.on{color:#fff;background:var(--green,#0e9f5a);border-color:transparent}
      .da-chip.bad.on{background:${RED}}.da-chip small{opacity:.8;font-weight:600}
      .da-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
      .da-seg button{font:inherit;font-size:11px;font-weight:800;padding:5px 12px;border:0;background:transparent;color:var(--muted);cursor:pointer}
      .da-seg button.on{background:var(--green,#0e9f5a);color:#fff}
      .da-in{font:inherit;font-size:11.5px;padding:5px 9px;border-radius:9px;border:1px solid var(--line);background:var(--card,#fff);color:var(--ink);min-width:0}
      .da-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-bottom:10px}
      .da-kpi{border:1px solid var(--line);border-top:3px solid var(--t);border-radius:10px;padding:7px 10px;background:var(--card,#fff);min-width:0}
      .da-kl{font-size:9.5px;letter-spacing:.5px;text-transform:uppercase;font-weight:800;color:var(--muted)}.da-kv{font-size:19px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1.2}.da-ks{font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .da-days{display:flex;align-items:flex-end;gap:2px;height:44px;margin:2px 0 10px}
      .da-day{flex:1 1 0;min-width:3px;position:relative;background:color-mix(in srgb,${BLUE} 55%,transparent);border-radius:2px 2px 0 0;cursor:pointer}
      .da-day i{position:absolute;left:0;right:0;bottom:0;background:${RED};border-radius:2px 2px 0 0}.da-day:hover{filter:brightness(1.2)}
      .da-flow{border:1px solid var(--line);border-radius:11px;margin-bottom:7px;background:var(--card,#fff);overflow:hidden}
      .da-flow>summary{list-style:none;display:grid;grid-template-columns:118px 1fr auto;gap:10px;align-items:center;padding:8px 11px;cursor:pointer;font-size:11.5px}
      .da-flow>summary::-webkit-details-marker{display:none}.da-flow>summary:hover{background:var(--card2,rgba(148,163,184,.08))}
      .da-flow.bad>summary{border-left:4px solid ${RED}}.da-flow.part>summary{border-left:4px solid ${AMBER}}.da-flow.ok>summary{border-left:4px solid ${GREEN}}
      .da-fj{display:inline-flex;gap:4px;flex-wrap:wrap}.da-fj span{font-size:10px;font-weight:700;padding:1px 7px;border-radius:6px;border:1px solid var(--line);color:var(--muted)}
      .da-out{font-size:10px;font-weight:800;padding:2px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.4px}
      .da-steps{padding:4px 11px 9px 20px;border-top:1px solid var(--line)}
      .da-step{display:grid;grid-template-columns:52px 20px minmax(120px,1fr) minmax(0,2fr) auto;gap:8px;align-items:baseline;padding:4px 0;font-size:11px;border-left:2px solid var(--line);padding-left:10px;position:relative;cursor:pointer}
      .da-step::before{content:'';position:absolute;left:-5px;top:9px;width:8px;height:8px;border-radius:50%;background:${GREEN}}.da-step.err::before{background:${RED}}
      .da-step:hover{background:var(--card2,rgba(148,163,184,.08))}
      .da-code{font-weight:800}.da-tbl{width:100%;border-collapse:collapse;font-size:11px}.da-tbl th{text-align:left;font-size:9.5px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);padding:5px 7px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card,#fff)}
      .da-tbl td{padding:4px 7px;border-bottom:1px solid var(--line);white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis}.da-tbl tr{cursor:pointer}.da-tbl tr:hover td{background:var(--card2,rgba(148,163,184,.08))}.da-tbl tr.err td:first-child{box-shadow:inset 3px 0 0 ${RED}}
      .da-scroll{max-height:520px;overflow:auto;border:1px solid var(--line);border-radius:10px}.da.compact .da-scroll{max-height:320px}
      .da-foot{font-size:9.5px;color:var(--muted);margin-top:7px;line-height:1.5}.da-empty{padding:14px;color:var(--muted);font-size:11.5px}
      .da-badge{font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:6px;border:1px solid var(--line);color:var(--muted)}
      @media (max-width:900px){.da-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media (max-width:640px){.da-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.da-flow>summary{grid-template-columns:1fr auto}.da-flow>summary .da-fwhen{grid-column:1/-1}.da-step{grid-template-columns:48px 18px 1fr;gap:6px}.da-step .da-smsg,.da-step .da-scode{grid-column:3}}
      @media (prefers-reduced-motion:reduce){.da-chip{transition:none}}`;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- render */
  window.renderDealerActivity = function (host, dealer, opts) {
    if (!host) return; css();
    const o = Object.assign({ compact: false, days: 7 }, opts || {});
    const D = dealer || {};
    const state = { days: o.days, from: null, to: null, view: 'flows', failed: false, journey: null, q: '', data: null, loading: false };
    const keysQs = () => [D.username && `u=${encodeURIComponent(D.username)}`, D.dealer_code && `c=${encodeURIComponent(D.dealer_code)}`, D.id != null && `id=${encodeURIComponent(D.id)}`, D.q && `q=${encodeURIComponent(D.q)}`].filter(Boolean).join('&');
    host.classList.add('da'); if (o.compact) host.classList.add('compact');
    const label = D.username || D.dealer_code || D.q || D.id;

    async function load() {
      state.loading = true; paint();
      try {
        const win = state.from && state.to ? `from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}` : `days=${state.days}`;
        state.data = await api(`/api/dms/journeys/dealer-activity?${keysQs()}&${win}${um() ? '&unmask=1' : ''}`);
        if (window.audit) window.audit(state.data.unmasked ? 'DEALER_ACTIVITY_UNMASK' : 'DEALER_ACTIVITY', String(label).slice(0, 40));
      } catch (e) { state.data = { error: e.message }; }
      state.loading = false; paint();
    }
    const filtered = () => {
      const d = state.data; if (!d || !d.hits) return { hits: [], flows: [] };
      const q = state.q.trim().toLowerCase();
      const ok = h => (!state.failed || h.err) && (!state.journey || h.journey === state.journey) && (!q || [h.api, h.msisdn, h.customer, h.message, h.ref, h.plan, h.code, h.label].some(v => v && String(v).toLowerCase().includes(q)));
      const hits = d.hits.filter(ok);
      const flows = d.flows.map(f => ({ ...f, steps: f.steps.filter(ok) })).filter(f => f.steps.length);
      return { hits, flows };
    };
    const outBadge = f => `<span class="da-out" style="color:${f.outcome === 'ok' ? GREEN : f.outcome === 'failed' ? RED : AMBER};background:color-mix(in srgb,${f.outcome === 'ok' ? GREEN : f.outcome === 'failed' ? RED : AMBER} 12%,transparent)">${f.outcome === 'ok' ? 'ok' : f.outcome === 'failed' ? 'failed' : `${f.failed}/${f.n} failed`}</span>`;
    const codeHtml = h => `<span class="da-code mono" style="color:${h.err ? RED : GREEN}">${esc(h.code || '—')}</span>`;

    function paint() {
      const d = state.data, k = KT();
      const head = `<div class="da-head"><div><div class="da-title">Everything this dealer did in DMS <span class="da-badge">${esc(label)}</span></div>
          <div class="da-sub">from DMS's own audit ledgers (dms_audit_logs) — every journey table, matched on username · code · id · ${d && d.window ? `${esc(k.md(d.window.from))} → ${esc(k.md(d.window.to))} KSA` : ''}${d && d.unmasked ? ' · <b style="color:' + RED + '">🔓 identifiers in full — audited</b>' : ' · identifiers masked'}</div></div>
          <span style="flex:1"></span>
          <div class="da-seg">${[['flows', 'Journeys'], ['list', 'List']].map(([v, t]) => `<button type="button" data-view="${v}" class="${state.view === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        <div class="da-bar">
          ${[1, 7, 30, 90].map(n => `<button type="button" class="da-chip ${!state.from && state.days === n ? 'on' : ''}" data-days="${n}">${n === 1 ? 'Today' : n + ' d'}</button>`).join('')}
          <input type="date" class="da-in" id="daFrom" value="${esc(state.from ? state.from.slice(0, 10) : '')}" title="from (KSA)"><span class="da-sub">→</span><input type="date" class="da-in" id="daTo" value="${esc(state.to ? state.to.slice(0, 10) : '')}" title="to (KSA)"><button type="button" class="da-chip" data-act="apply">Apply</button>
          <span style="flex:1"></span>
          <button type="button" class="da-chip bad ${state.failed ? 'on' : ''}" data-act="failed">✕ failed only</button>
          <input class="da-in" id="daQ" placeholder="filter: endpoint, number, message, ref…" value="${esc(state.q)}" style="flex:1 1 180px;max-width:280px">
          <button type="button" class="da-chip" data-act="csv" title="download the list as CSV">⇩ CSV</button>
          <button type="button" class="da-chip" data-act="reload">↻</button>
        </div>`;
      let body = '';
      if (state.loading) body = `<div class="da-empty">Reading every DMS ledger for this dealer…</div>`;
      else if (!d) body = '';
      else if (d.error) body = `<div class="da-empty" style="color:${RED}">${esc(d.error)}</div>`;
      else {
        const S = d.summary, F = filtered();
        const maxDay = Math.max(1, ...S.byDay.map(x => x.n));
        const kpis = `<div class="da-kpis">
          <div class="da-kpi" style="--t:${BLUE}"><div class="da-kl">Actions</div><div class="da-kv">${num(S.total)}</div><div class="da-ks">${S.first ? `${esc(k.md(S.first))} → ${esc(k.md(S.last))}` : 'nothing in this window'}</div></div>
          <div class="da-kpi" style="--t:${S.failed ? RED : GREEN}"><div class="da-kl">Failed</div><div class="da-kv" style="color:${S.failed ? RED : 'inherit'}">${num(S.failed)}</div><div class="da-ks">${S.total ? Math.round(S.failed / S.total * 1000) / 10 + '% of actions' : '—'}</div></div>
          <div class="da-kpi" style="--t:${GREEN}"><div class="da-kl">Customers</div><div class="da-kv">${num(S.customers)}</div><div class="da-ks">distinct numbers touched</div></div>
          <div class="da-kpi" style="--t:${GREEN}"><div class="da-kl">Journeys</div><div class="da-kv">${num(S.customerFlows)}</div><div class="da-ks">${num(S.flows - S.customerFlows)} dealer-own actions</div></div>
          <div class="da-kpi" style="--t:${S.failedFlows ? AMBER : GREEN}"><div class="da-kl">Journeys with a failure</div><div class="da-kv" style="color:${S.failedFlows ? AMBER : 'inherit'}">${num(S.failedFlows)}</div><div class="da-ks">at least one failed step</div></div>
          <div class="da-kpi" style="--t:${BLUE}"><div class="da-kl">Most used</div><div class="da-kv" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${S.byJourney[0] ? `${S.byJourney[0].icon} ${esc(S.byJourney[0].label)}` : '—'}</div><div class="da-ks">${S.topApis[0] ? esc(S.topApis[0].api) + ' · ' + num(S.topApis[0].n) : ''}</div></div>
        </div>`;
        const days = S.byDay.length > 1 ? `<div class="da-days" title="actions per KSA day · red = failed">${S.byDay.map(x => `<div class="da-day" style="height:${Math.max(6, x.n / maxDay * 100)}%" title="${x.day} · ${x.n} actions · ${x.fail} failed"><i style="height:${x.n ? x.fail / x.n * 100 : 0}%"></i></div>`).join('')}</div>` : '';
        const jchips = `<div class="da-bar" style="margin:0 0 8px">${S.byJourney.map(j => `<button type="button" class="da-chip ${state.journey === j.key ? 'on' : ''}" data-j="${esc(j.key)}">${j.icon} ${esc(j.label)} <small>${num(j.n)}${j.fail ? ` · <span style="color:${state.journey === j.key ? '#fff' : RED}">${num(j.fail)}✕</span>` : ''}</small></button>`).join('')}</div>`;
        let content;
        if (!F.hits.length) content = `<div class="da-empty">${S.total ? 'Nothing matches the current filter.' : 'No DMS ledger rows for this dealer in the window — widen the range or check the coverage note below.'}</div>`;
        else if (state.view === 'flows') {
          content = `<div class="da-scroll" style="border:0;padding:1px">${F.flows.slice(0, 300).map((f, i) => `<details class="da-flow ${f.outcome === 'ok' ? 'ok' : f.outcome === 'failed' ? 'bad' : 'part'}" ${i < 8 ? 'open' : ''}>
            <summary><span class="mono da-fwhen" style="font-size:10.5px;color:var(--muted)">${esc(k.md(f.from))}${f.n > 1 ? ` → ${esc(k.t(f.to))}` : ''}</span>
              <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0"><b class="mono">${f.kind === 'customer' ? esc(f.msisdn || f.customer || '') : '<span style="color:var(--muted)">dealer action</span>'}</b><span class="da-fj">${f.journeys.map(j => { const jj = S.byJourney.find(x => x.key === j) || {}; return `<span>${jj.icon || ''} ${esc(jj.label || j)}</span>`; }).join('')}</span></span>
              <span style="display:flex;gap:8px;align-items:center"><span class="da-sub">${f.n} step${f.n === 1 ? '' : 's'}</span>${outBadge(f)}</span></summary>
            <div class="da-steps">${f.steps.map(h => `<div class="da-step ${h.err ? 'err' : ''}" data-j="${esc(h.journey)}" data-id="${h.src_id}" title="open the full ledger row">
              <span class="mono" style="color:var(--muted);font-size:10.5px">${esc(k.t(h.at, true))}</span><span>${h.icon || '•'}</span>
              <span><b>${esc(h.label)}</b>${h.api ? ` <span class="mono" style="color:var(--muted);font-size:10px">${esc(h.api)}</span>` : ''}</span>
              <span class="da-smsg" style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.plan ? h.plan + (h.message ? ' · ' + h.message : '') : h.message || '')}</span>
              <span class="da-scode">${codeHtml(h)}</span></div>`).join('')}</div></details>`).join('')}${F.flows.length > 300 ? `<div class="da-sub">showing 300 of ${F.flows.length} journeys — narrow the range</div>` : ''}</div>`;
        } else {
          content = `<div class="da-scroll"><table class="da-tbl"><thead><tr><th>At (KSA)</th><th>Journey</th><th>Endpoint</th><th>Code</th><th>Customer</th><th>ID</th><th>Plan</th><th>Message</th><th>Ref</th></tr></thead><tbody>
            ${F.hits.slice(0, 2000).map(h => `<tr class="${h.err ? 'err' : ''}" data-j="${esc(h.journey)}" data-id="${h.src_id}" title="open the full ledger row"><td class="mono">${esc(k.md(h.at))}:${esc(String(k.t(h.at, true)).slice(-2))}</td><td>${h.icon || '•'} ${esc(h.label)}</td><td class="mono" title="${esc(h.api || '')}">${esc(h.api || '—')}</td><td>${codeHtml(h)}</td><td class="mono">${esc(h.msisdn || '')}</td><td class="mono">${esc(h.customer || '')}</td><td title="${esc(h.plan || '')}">${esc(h.plan || '')}</td><td title="${esc(h.message || '')}" style="color:var(--muted)">${esc(h.message || '')}</td><td class="mono" title="${esc(h.ref || '')}">${esc(h.ref || '')}</td></tr>`).join('')}
          </tbody></table></div>${F.hits.length > 2000 ? `<div class="da-sub">showing 2 000 of ${F.hits.length} rows — narrow the range or use the CSV</div>` : ''}`;
        }
        const cov = `<div class="da-foot">coverage: ${(d.scanned || []).map(s => `${esc(s.key)} (${s.n}${s.how === 'indexed' ? '' : ', ' + esc(s.how)})`).join(' · ') || '—'}${(d.truncated || []).length ? ` · <b style="color:${AMBER}">capped at ${d.limitPer} rows: ${esc(d.truncated.join(', '))} — narrow the range for the full picture</b>` : ''}${(d.skipped || []).length ? ` · not covered: ${d.skipped.map(x => `${esc(x.key)} (${esc(x.why)})`).join(' · ')}` : ''} · a step = one ledger row written by the DMS service that handled it; click any step or row for every field of that row and its cross-journey trace.</div>`;
        body = kpis + days + jchips + content + cov;
      }
      host.innerHTML = head + body;
      wire();
    }
    function wire() {
      host.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; paint(); });
      host.querySelectorAll('[data-days]').forEach(b => b.onclick = () => { state.days = Number(b.dataset.days); state.from = state.to = null; load(); });
      host.querySelectorAll('[data-j]').forEach(b => { if (b.classList.contains('da-chip')) b.onclick = () => { state.journey = state.journey === b.dataset.j ? null : b.dataset.j; paint(); }; });
      host.querySelectorAll('.da-step[data-j],.da-tbl tr[data-j]').forEach(r => r.onclick = () => { if (window.openDmsRowPopup) window.openDmsRowPopup(r.dataset.j, r.dataset.id); });
      const act = a => host.querySelector(`[data-act="${a}"]`);
      if (act('failed')) act('failed').onclick = () => { state.failed = !state.failed; paint(); };
      if (act('reload')) act('reload').onclick = () => load();
      if (act('apply')) act('apply').onclick = () => { const f = host.querySelector('#daFrom').value, t = host.querySelector('#daTo').value; if (!f || !t) return; state.from = f + 'T00:00:00+03:00'; state.to = t + 'T23:59:59+03:00'; load(); };
      const q = host.querySelector('#daQ'); if (q) { q.oninput = () => { state.q = q.value; const pos = q.selectionStart; paint(); const q2 = host.querySelector('#daQ'); if (q2) { q2.focus(); q2.setSelectionRange(pos, pos); } }; }
      if (act('csv')) act('csv').onclick = () => {
        const F = filtered(); if (!F.hits.length) return;
        const cols = ['at', 'journey', 'label', 'api', 'code', 'err', 'msisdn', 'customer', 'plan', 'plan_id', 'message', 'ref', 'src_id'];
        const csv = [cols.join(',')].concat(F.hits.map(h => cols.map(c => { const v = h[c] == null ? '' : String(c === 'at' ? new Date(h.at).toISOString() : h[c]); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','))).join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `dms-activity-${String(label).replace(/[^\w.-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        if (window.audit) window.audit('DEALER_ACTIVITY_EXPORT', String(label).slice(0, 40));
      };
    }
    load();
    return { reload: load };
  };
})();
