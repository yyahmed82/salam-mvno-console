/* cst-api.js — CST Escalations › the five CST APIs, run from the console (18 Sep 2026).
 *
 * WHY THIS SITS AT THE BOTTOM OF THE PAGE. The section above reads ARSystem — what Salam holds. This one calls
 * spec CITC006001 v6.2 at https://itc-tt-view.itc.sa — what the REGULATOR receives when it asks. Every open item
 * in runbook §13 is a disagreement between those two answers (the HTTP 500 on duplicated tier-triples, the
 * inverted five-day rule, the multi-row REQ parity bug), so the two live on one page and read the same ticket.
 *
 * It is a Swagger, not a dashboard: one card per endpoint, the exact body the Swagger declares, a Run button and
 * the raw response. Nothing is polled, scheduled or retried — a person fills a field and presses Run.
 *
 * The call goes through the console server, never the browser: the api key stays in /apps/unified/.env, the
 * endpoint is picked by key from a fixed table, and every Run is written to the audit log with a masked
 * identifier. Identifiers typed here are held in memory for the life of the page and never in localStorage —
 * they are customer data, and this is a shared workstation. */
(function () {
  "use strict";
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : esc(v);
  const api = (p, opt) => fetch((window.API_BASE || window.CONSOLE_BASE || '') + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt || {}))
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
  const bytes = n => n == null ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
  const SN = () => (window.CST_SEC && window.CST_SEC.api) || 2;    // renumbers itself if a section above is hidden
  const h3 = (n, title, desc) => `<div class="cs-h3"><span class="cs-h3n">${esc(SN() + '.' + n)}</span><span class="cs-h3t">${esc(title)}</span><i></i></div>${desc ? `<div class="cs-h3d">${esc(desc)}</div>` : ''}`;

  /* the three identifiers every endpoint draws from — typed once at the top, applied to all five */
  const SHARED = [['SpTicketNumber', 'Complaint number (REQ)', 'REQ000003020009'],
                  ['ServiceNumber', 'Service number', 'FTTH11073707'],
                  ['IdentificationNumber', 'National / Iqama id', '']];
  const S = { spec: null, shared: { SpTicketNumber: '', ServiceNumber: '', IdentificationNumber: '' }, vals: {}, res: {}, busy: {}, raw: {} };


  const fieldBox = (ep, f) => {
    const v = (S.vals[ep.key] && S.vals[ep.key][f.name] != null) ? S.vals[ep.key][f.name] : (ep.template[f.name] || '');
    const ph = (SHARED.find(s => s[0] === f.name) || [, , ''])[2] || (f.name === 'Provider' ? 'Salam' : f.name === 'FileId' ? 'blank = all files' : '');
    return `<div class="ax-f"><label for="ax-${ep.key}-${f.name}">${esc(f.name)}${f.required ? '<i>*</i>' : ''}</label>
      <input class="ax-in" id="ax-${ep.key}-${f.name}" data-ep="${ep.key}" data-f="${esc(f.name)}" value="${esc(v)}"
        placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></div>`;
  };

  function epCard(ep) {
    return `<div class="ax-ep" data-ep="${ep.key}">
      <div class="ax-eh" data-toggle="${ep.key}"><span class="ax-caret">▾</span><span class="ax-verb">POST</span><span class="ax-path">${esc(ep.path)}</span><span class="ax-title">${esc(ep.title)}</span></div>
      <div class="ax-body">
        <div class="ax-note">${esc(ep.note)}</div>
        <div class="ax-sub">Request body · parameter <code>${esc(ep.body)}</code></div>
        <div class="ax-row">${ep.fields.map(f => fieldBox(ep, f)).join('')}</div>
        <div class="ax-acts">
          <button type="button" class="cs-btn" data-run="${ep.key}">Run</button>
          <button type="button" class="cs-btn ghost" data-body="${ep.key}">Show body</button>
          <span class="ax-note" data-msg="${ep.key}"></span>
        </div>
        <div data-out="${ep.key}"></div>
        <div class="ax-sub">Response schema (200)</div>
        <div class="ax-ret">${esc(ep.returns)}</div>
      </div></div>`;
  }

  async function render(host) {
    if (!host) return;
    host.innerHTML = `<div id="csApi" class="ax">
      ${h3(1, 'One ticket, all five endpoints', 'Type the complaint number and service number once and they fill every endpoint that declares them. Run all five answers, in one pass, what the regulator receives for that ticket — read it against what Remedy holds for the same ticket in the live section above.')}
      <div class="topo-card cs-card">
        <div class="cs-ch"><b>Ticket under examination</b><span class="cs-dim" id="axBar">loading…</span></div>
        <div class="ax-note" style="margin-bottom:10px">Spec <b>CITC006001 v6.2</b>, the same five POST endpoints as the Salam Swagger. Calls run from the console server, so the api key never reaches this browser, and every Run is written to the audit log. Nothing typed here is stored.</div>
        <div class="ax-row">
          ${SHARED.map(([n, label, ph]) => `<div class="ax-f"><label for="axS-${n}">${esc(label)}</label>
            <input class="ax-in" id="axS-${n}" data-shared="${n}" value="${esc(S.shared[n])}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></div>`).join('')}
        </div>
        <div class="ax-acts">
          <button type="button" class="cs-btn" id="axAll">Run all five</button>
          <button type="button" class="cs-btn ghost" id="axProbe">Check reachability</button>
          <span class="ax-note" id="axMsg"></span>
        </div>
      </div>
      ${h3(2, 'The five endpoints, one at a time', 'Each card is the Swagger operation as published: the body the endpoint declares, the fields it accepts, and the raw answer with its status, time and size. A header collapses its card.')}
      <div id="axEps"><div class="cs-loading">Loading the endpoint contracts…</div></div></div>`;
    const $ = s => host.querySelector(s);
    host.querySelectorAll('[data-shared]').forEach(i => i.oninput = e => {
      S.shared[e.target.dataset.shared] = e.target.value;
      applyShared(host, e.target.dataset.shared);
    });
    $('#axAll').onclick = () => runAll(host);
    $('#axProbe').onclick = () => probe(host);

    try {
      S.spec = await api('/api/cst/api/spec');
    } catch (e) {
      $('#axBar').innerHTML = `<span class="ax-dot bad"></span> ${esc(e.message)}`;
      $('#axEps').innerHTML = `<div class="topo-card cs-err"><b>Could not read the endpoint contracts</b><div class="cs-dim">${esc(e.message)}</div></div>`;
      return;
    }
    status(host);
    $('#axEps').innerHTML = S.spec.endpoints.map(epCard).join('');
    wire(host);
    applyShared(host);
  }

  function status(host) {
    const s = S.spec, bar = host.querySelector('#axBar');
    if (!bar) return;
    if (!s.configured) { bar.innerHTML = `<span class="ax-dot off"></span> not configured — <code>CST_API_BASE</code> in /apps/unified/.env`; return; }
    bar.innerHTML = `<span class="ax-dot${s.keySet ? '' : ' bad'}"></span> ${esc(s.base)}`
      + (s.keySet ? ` · key set (<code>${esc(s.keyHeader)}</code>)` : ` · <span style="color:var(--xo-p1,#dc2626)">no <code>CST_API_KEY</code></span>`)
      + (s.insecure ? ` · <span style="color:var(--xo-p2,#d97706)">certificate not verified</span>` : '')
      + (s.tcp ? (s.tcp.ok ? ` · reachable in ${s.tcp.ms} ms` : ` · <span style="color:var(--xo-p1,#dc2626)">unreachable</span>`) : '');
  }

  function wire(host) {
    host.querySelectorAll('[data-toggle]').forEach(h => h.onclick = () => h.parentElement.classList.toggle('closed'));
    host.querySelectorAll('.ax-in[data-ep]').forEach(i => i.oninput = e => {
      const { ep, f } = e.target.dataset;
      (S.vals[ep] = S.vals[ep] || {})[f] = e.target.value;
    });
    host.querySelectorAll('[data-run]').forEach(b => b.onclick = e => { e.stopPropagation(); run(host, b.dataset.run); });
    host.querySelectorAll('[data-body]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const ep = S.spec.endpoints.find(x => x.key === b.dataset.body), out = host.querySelector(`[data-out="${b.dataset.body}"]`);
      if (!ep || !out) return;
      const shown = out.querySelector('pre.req');
      if (shown) { shown.parentElement.remove(); b.textContent = 'Show body'; return; }
      const pre = document.createElement('div');
      pre.innerHTML = `<div class="ax-sub">Body as it will be sent</div><pre class="ax-json req">${esc(JSON.stringify(collect(ep), null, 2))}</pre>`;
      out.prepend(pre); b.textContent = 'Hide body';
    });
  }

  /* the shared row writes into every endpoint that declares that field, and nowhere else */
  function applyShared(host, only) {
    if (!S.spec) return;
    for (const ep of S.spec.endpoints) for (const f of ep.fields) {
      if (only && f.name !== only) continue;
      if (!(f.name in S.shared)) continue;
      const v = S.shared[f.name];
      if (!v) continue;
      (S.vals[ep.key] = S.vals[ep.key] || {})[f.name] = v;
      const el = host.querySelector(`#ax-${ep.key}-${f.name}`);
      if (el) el.value = v;
    }
  }

  const collect = ep => {
    const o = {};
    for (const f of ep.fields) o[f.name] = (S.vals[ep.key] && S.vals[ep.key][f.name] != null) ? S.vals[ep.key][f.name] : (ep.template[f.name] || '');
    return o;
  };

  async function probe(host) {
    const msg = host.querySelector('#axMsg');
    if (msg) msg.textContent = 'checking the route to the gateway…';
    try {
      S.spec = await api('/api/cst/api/spec?probe=1');
      status(host);
      if (msg) msg.innerHTML = S.spec.tcp && S.spec.tcp.ok
        ? `<b>${esc(S.spec.tcp.target)}</b> answered in ${S.spec.tcp.ms} ms`
        : `<b>${esc((S.spec.tcp && S.spec.tcp.target) || 'gateway')}</b> — ${esc((S.spec.tcp && S.spec.tcp.error) || 'no answer')}`;
    } catch (e) { if (msg) msg.textContent = e.message; }
  }

  async function run(host, key) {
    const ep = S.spec && S.spec.endpoints.find(x => x.key === key);
    if (!ep || S.busy[key]) return;
    const btn = host.querySelector(`[data-run="${key}"]`), out = host.querySelector(`[data-out="${key}"]`), msg = host.querySelector(`[data-msg="${key}"]`);
    const fields = collect(ep);
    const missing = ep.fields.filter(f => f.required && !String(fields[f.name] || '').trim()).map(f => f.name);
    if (missing.length) { if (msg) msg.innerHTML = `<span style="color:var(--xo-p1,#dc2626)">${esc(missing.join(', '))} is required</span>`; return; }
    S.busy[key] = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
    if (msg) msg.textContent = '';
    const t0 = Date.now();
    let r;
    try { r = await api('/api/cst/api/call', { method: 'POST', body: JSON.stringify({ endpoint: key, fields }) }); }
    catch (e) { r = { ok: false, error: e.message, ms: Date.now() - t0 }; }
    S.busy[key] = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Run'; }
    S.res[key] = r;
    if (out) drawResult(out, r);
    return r;
  }

  async function runAll(host) {
    const btn = host.querySelector('#axAll'), msg = host.querySelector('#axMsg');
    if (!S.spec) return;
    btn.disabled = true; btn.textContent = 'Running…';
    if (msg) msg.textContent = 'calling all five…';
    host.querySelectorAll('.ax-ep.closed').forEach(el => el.classList.remove('closed'));
    /* sequential on purpose: five parallel calls into one regulator gateway is not a thing to do from a console */
    let ok = 0, failed = [];
    for (const ep of S.spec.endpoints) {
      const r = await run(host, ep.key);
      if (r && r.ok) ok++; else failed.push(ep.path);
    }
    btn.disabled = false; btn.textContent = 'Run all five';
    if (msg) msg.innerHTML = failed.length
      ? `${ok}/5 answered · <b>${esc(failed.join(', '))}</b> did not`
      : `all five answered`;
  }

  function drawResult(out, r) {
    const keep = out.querySelector('pre.ax-json.req');
    const head = keep ? keep.parentElement.outerHTML : '';
    if (r.error && r.status == null) {
      out.innerHTML = head + `<div class="ax-err"><b>${esc(r.endpoint ? 'The call did not complete' : 'Could not call')}</b> — ${esc(r.error)}</div>`;
      return;
    }
    const tone = r.ok ? 'ax-ok' : r.status >= 500 ? 'ax-noo' : 'ax-wrn';
    const body = typeof r.response === 'string' ? r.response : JSON.stringify(r.response, null, 2);
    out.innerHTML = head + `<div class="ax-meta">
        <span class="ax-pill ${tone}">HTTP ${esc(r.status)}${r.statusText ? ' ' + esc(r.statusText) : ''}</span>
        <span><b>${num(r.ms)}</b> ms</span><span><b>${esc(bytes(r.bytes))}</b></span>
        ${r.contentType ? `<span>${esc(String(r.contentType).split(';')[0])}</span>` : ''}
        ${!r.json ? `<span class="ax-pill ax-wrn">not JSON</span>` : ''}
      </div>
      ${r.note ? `<div class="ax-note" style="margin-top:6px">${esc(r.note)}</div>` : ''}
      <pre class="ax-json">${esc(body)}</pre>`;
  }

  /* called from the Remedy section: carry a ticket straight from ARSystem into the five calls */
  function prefill(vals, opt) {
    for (const [k, v] of Object.entries(vals || {})) if (k in S.shared && v) S.shared[k] = String(v);
    const host = document.querySelector('#csApiMount');
    if (!host || !host.querySelector('#csApi')) return false;
    for (const [n] of SHARED) { const el = host.querySelector(`#axS-${n}`); if (el) el.value = S.shared[n]; }
    applyShared(host);
    const target = document.querySelector('#cs-s-api') || host.querySelector('#csApi');
    if (target && (!opt || opt.scroll !== false)) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  window.cstApi = { render, prefill, state: S };
})();
