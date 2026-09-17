/* arqami-api.js — Arqami › the call as CST makes it (18 Sep 2026).
 *
 * The section above this one measures the number-ownership service from the inside: one row per request in
 * APPS.YY_REGISTER_NUMBER_AUDIT on EBPROD, rolled up per minute. A row there holds a duration and a success flag,
 * not a payload — so it can say the service answered in 319 ms and cannot say WHAT it answered. This section asks
 * the service the same question CST asks and shows both halves: the request as it goes on the wire, and the
 * services that come back.
 *
 * The credentials are not on this page and cannot be sent from it. User_Name and Password are filled by the console
 * server from /apps/unified/.env; whatever a browser puts in those fields is discarded, and the request echoed back
 * carries the password masked. The national id typed here is held in memory for the life of the page and never in
 * localStorage — it is customer data on a shared workstation. Every Run is audited with a masked id; the answer is
 * rendered and dropped, so no msisdn, account number or bill amount reaches unified_console.
 *
 * Styling comes from the page stylesheet (.ax-* in cstpage.js), shared with the CST endpoints section. */
(function () {
  "use strict";
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US') : esc(v);
  const api = (p, opt) => fetch((window.API_BASE || window.CONSOLE_BASE || '') + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt || {}))
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
  const bytes = n => n == null ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
  const SN = () => (window.CST_SEC && window.CST_SEC.arqapi) || 2;
  const h3 = (n, title, desc) => `<div class="cs-h3"><span class="cs-h3n">${esc(SN() + '.' + n)}</span><span class="cs-h3t">${esc(title)}</span><i></i></div>${desc ? `<div class="cs-h3d">${esc(desc)}</div>` : ''}`;

  const S = { spec: null, id: '', res: {}, busy: {}, raw: {} };

  const fieldBox = (op, f) => f.secret
    ? `<div class="ax-f"><label>${esc(f.name)} <span class="ax-lock">from .env</span></label>
       <input class="ax-in" value="${esc(f.name === 'Password' ? '••••••••' : (S.spec && S.spec.user) || '')}" disabled
              title="${esc(f.env || '')} in /apps/unified/.env — the browser never holds this value"></div>`
    : `<div class="ax-f"><label for="aq-${op.key}-${f.name}">${esc(f.name)}${f.required ? '<i>*</i>' : ''}</label>
       <input class="ax-in" id="aq-${op.key}-${f.name}" data-op="${op.key}" data-f="${esc(f.name)}" value="${esc(S.id)}"
              placeholder="national / iqama id" autocomplete="off" spellcheck="false" inputmode="numeric"></div>`;

  const opCard = op => `<div class="ax-ep" data-op="${op.key}">
      <div class="ax-eh" data-toggle="${op.key}"><span class="ax-caret">▾</span><span class="ax-verb">POST</span><span class="ax-path">${esc(op.path)}</span><span class="ax-title">${esc(op.title)}</span></div>
      <div class="ax-body">
        <div class="ax-note">${esc(op.note)}</div>
        <div class="ax-sub">Request · <code>${esc((S.spec && S.spec.binding) || 'HTTP POST')}</code></div>
        <div class="ax-row">${op.fields.map(f => fieldBox(op, f)).join('')}</div>
        <div class="ax-acts">
          <button type="button" class="cs-btn" data-run="${op.key}">Run</button>
          <button type="button" class="cs-btn ghost" data-probe="1">Check reachability</button>
          <span class="ax-note" data-msg="${op.key}"></span>
        </div>
        <div data-out="${op.key}"></div>
        <div class="ax-sub">Response schema (200)</div>
        <div class="ax-ret">${esc(op.returns)}</div>
      </div></div>`;

  async function render(host) {
    if (!host) return;
    host.innerHTML = `<div id="arqApi" class="ax">
      ${h3(1, 'Ask the service what CST asks it', 'One national id, the same endpoint and the same service account CST uses. The answer is what the regulator sees for that identity — and one more row in the audit table the charts above are built from.')}
      <div class="ax-status" id="aqBar">loading…</div>
      <div id="aqOps"><div class="cs-loading">Loading the operation contract…</div></div></div>`;
    try { S.spec = await api('/api/cst/arqami/api/spec'); }
    catch (e) {
      host.querySelector('#aqBar').innerHTML = `<span class="ax-dot bad"></span> ${esc(e.message)}`;
      host.querySelector('#aqOps').innerHTML = `<div class="topo-card cs-err"><b>Could not read the operation contract</b><div class="cs-dim">${esc(e.message)}</div></div>`;
      return;
    }
    status(host);
    host.querySelector('#aqOps').innerHTML = S.spec.operations.map(opCard).join('');
    wire(host);
  }

  function status(host) {
    const s = S.spec, bar = host.querySelector('#aqBar');
    if (!bar) return;
    if (!s.configured) { bar.innerHTML = `<span class="ax-dot off"></span> not configured — <code>ARQAMI_API_BASE</code> in /apps/unified/.env`; return; }
    bar.innerHTML = `<span class="ax-dot${s.credsSet ? '' : ' bad'}"></span> <b>${esc(s.base)}${esc(s.service)}</b> · ${esc(s.binding)}`
      + (s.credsSet ? ` · as <b>${esc(s.user)}</b> (password from .env)` : ` · <span style="color:var(--xo-p1,#dc2626)">no <code>ARQAMI_API_USER</code> / <code>ARQAMI_API_PASSWORD</code></span>`)
      + (s.insecure ? ` · <span style="color:var(--xo-p2,#d97706)">certificate not verified</span>` : '')
      + (s.tcp ? (s.tcp.ok ? ` · reachable in ${s.tcp.ms} ms` : ` · <span style="color:var(--xo-p1,#dc2626)">unreachable</span>`) : '');
  }

  function wire(host) {
    host.querySelectorAll('[data-toggle]').forEach(h => h.onclick = () => h.parentElement.classList.toggle('closed'));
    host.querySelectorAll('.ax-in[data-op]').forEach(i => {
      i.oninput = e => { S.id = e.target.value; };
      i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); run(host, e.target.dataset.op); } };
    });
    host.querySelectorAll('[data-run]').forEach(b => b.onclick = e => { e.stopPropagation(); run(host, b.dataset.run); });
    host.querySelectorAll('[data-probe]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const msg = host.querySelector('[data-msg]');
      if (msg) msg.textContent = 'checking the route to the service…';
      try {
        S.spec = await api('/api/cst/arqami/api/spec?probe=1');
        status(host);
        if (msg) msg.innerHTML = S.spec.tcp && S.spec.tcp.ok
          ? `<b>${esc(S.spec.tcp.target)}</b> answered in ${S.spec.tcp.ms} ms`
          : `<b>${esc((S.spec.tcp && S.spec.tcp.target) || 'service')}</b> — ${esc((S.spec.tcp && S.spec.tcp.error) || 'no answer')}`;
      } catch (err) { if (msg) msg.textContent = err.message; }
    });
  }

  async function run(host, key) {
    const op = S.spec && S.spec.operations.find(o => o.key === key);
    if (!op || S.busy[key]) return;
    const btn = host.querySelector(`[data-run="${key}"]`), out = host.querySelector(`[data-out="${key}"]`), msg = host.querySelector(`[data-msg="${key}"]`);
    const id = String(S.id || '').trim();
    if (!id) { if (msg) msg.innerHTML = `<span style="color:var(--xo-p1,#dc2626)">User_ID_Number is required</span>`; return; }
    S.busy[key] = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
    if (msg) msg.textContent = '';
    const t0 = Date.now();
    let r;
    try { r = await api('/api/cst/arqami/api/call', { method: 'POST', body: JSON.stringify({ operation: key, fields: { User_ID_Number: id } }) }); }
    catch (e) { r = { ok: false, error: e.message, ms: Date.now() - t0 }; }
    S.busy[key] = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Run'; }
    S.res[key] = r;
    if (out) draw(out, r);
  }

  /* the answer, read twice: first as services a person can compare against a complaint, then as the raw payload */
  function services(p) {
    const list = p && p.RegisteredNumbersList;
    if (!list || typeof list !== 'object') return null;
    const rows = [];
    for (const [kind, arr] of Object.entries(list)) {
      if (!Array.isArray(arr)) continue;
      for (const x of arr) rows.push({
        kind,
        number: x.MobileNumber || x.FixedNumber || x.Number || x.ServiceNumber || '—',
        account: x.AccountNumber || '—',
        pkg: x.PackageNameEn || x.PackageNameAr || '—',
        pkgAr: x.PackageNameAr || '',
        pkgId: x.PackageID || '',
        bills: x.OutstandingBills
      });
    }
    return rows;
  }

  function draw(out, r) {
    if (r.error && r.status == null) {
      out.innerHTML = `<div class="ax-err"><b>The call did not complete</b> — ${esc(r.error)}</div>`
        + (r.requestBody ? `<div class="ax-sub">Request as it would go on the wire</div><pre class="ax-json req">${esc(r.requestBody)}</pre>` : '');
      return;
    }
    const tone = r.ok ? 'ax-ok' : r.status >= 500 ? 'ax-noo' : 'ax-wrn';
    const payload = r.response;
    const rows = r.json ? services(payload) : null;
    const st = r.json && payload && typeof payload === 'object' ? payload : null;
    const mobiles = rows ? rows.filter(x => /mobile/i.test(x.kind)).length : 0;
    const fixed = rows ? rows.filter(x => /fixed/i.test(x.kind)).length : 0;

    out.innerHTML = `<div class="ax-meta">
        <span class="ax-pill ${tone}">HTTP ${esc(r.status)}${r.statusText ? ' ' + esc(r.statusText) : ''}</span>
        ${st && 'Status' in st ? `<span class="ax-pill ${st.Status ? 'ax-ok' : 'ax-noo'}">Status ${st.Status ? 'true' : 'false'}</span>` : ''}
        ${st && st.Message ? `<span>${esc(st.Message)}</span>` : ''}
        <span><b>${num(r.ms)}</b> ms</span><span><b>${esc(bytes(r.bytes))}</b></span>
        ${r.unwrapped ? `<span class="ax-pill ax-wrn">unwrapped from XML</span>` : ''}
        ${!r.json ? `<span class="ax-pill ax-wrn">not JSON</span>` : ''}
      </div>
      ${r.note ? `<div class="ax-note" style="margin-top:6px">${esc(r.note)}</div>` : ''}
      ${rows ? (rows.length ? `<div class="ax-sub">Services CST is shown · ${rows.length} (${mobiles} mobile, ${fixed} fixed)</div>
        <div class="ax-scroll"><table class="ax-tbl"><thead><tr><th>Type</th><th>Number</th><th>Account</th><th>Package</th><th>Package id</th><th>Outstanding</th></tr></thead><tbody>
        ${rows.map(x => `<tr>
          <td><span class="ax-pill ${/mobile/i.test(x.kind) ? 'ax-mob' : 'ax-fix'}">${esc(x.kind)}</span></td>
          <td><b>${esc(x.number)}</b></td><td>${esc(x.account)}</td>
          <td><span class="ax-cut" title="${esc([x.pkg, x.pkgAr].filter(Boolean).join(' · '))}">${esc(x.pkg)}</span></td>
          <td>${esc(x.pkgId || '—')}</td>
          <td class="ax-r">${x.bills == null || x.bills === '' ? '—' : `<b>${esc(x.bills)}</b>`}</td></tr>`).join('')}
        </tbody></table></div>`
        : `<div class="ax-note" style="margin-top:8px">The service answered, and this identity holds no registered service — which is itself the answer CST receives.</div>`) : ''}
      <div class="ax-sub">Request sent</div><pre class="ax-json req">${esc(r.requestBody || '')}</pre>
      <div class="ax-sub">Raw response</div><pre class="ax-json">${esc(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2))}</pre>`;
  }

  window.arqamiApi = { render, state: S };
})();
