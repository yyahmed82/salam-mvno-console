/* APP SCREENS FLOW — dashboard section: each customer journey rendered as the app's real
 * screens, one phone card per screen, with the count of customers who REACHED that step in the
 * selected window. Journeys are STACKED (one lane under the other, same visual grammar as the
 * order-status flow tree above it):
 *      ① NEW SIM   · not logged
 *      ② MNP       · not logged
 *      ③ RECHARGE  · logged in   (+ voucher recharge chip)
 *
 * Counts are DB milestones (the app has no screen-view telemetry) — the lane header says so.
 * Screen artwork: assets/screens/<journey>_<key>.png (ns_/mnp_/rc_ prefixes). Replace those
 * files with the Figma exports and the panel picks them up with no code change. */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString();
  const SES = { email: localStorage.getItem('cons_email') || '', role: localStorage.getItem('cons_role') || 'report_manager' };
  async function api(path) {
    const r = await fetch((window.API_BASE || window.CONSOLE_BASE) + path, { headers: { 'Content-Type': 'application/json', 'X-Console-Role': SES.role, 'X-Console-User': SES.email } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || ('HTTP ' + r.status));
    return r.json();
  }

  function cssOnce() {
    if (document.getElementById('sfCss')) return;
    const s = document.createElement('style'); s.id = 'sfCss';
    s.textContent = `
.sf-panel{border:1px solid var(--line);border-radius:14px;background:var(--card,#fff);padding:6px 16px 14px}
.sf-lane-wrap{padding:16px 0 10px;border-bottom:1px dashed var(--line)}
.sf-lane-wrap:last-child{border-bottom:0}
.sf-lhead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:2px}
.sf-dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.sf-ltitle{font-size:13px;font-weight:800;letter-spacing:.10em;text-transform:uppercase}
.sf-lstate{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  padding:2px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.sf-lsum{margin-left:auto;font-size:11.5px;color:var(--muted)}
.sf-lsum b{color:var(--fg,#222);font-size:13px}
.sf-lane{display:flex;align-items:flex-start;gap:0;overflow-x:auto;padding:12px 2px 4px}
.sf-step{flex:0 0 auto;width:196px;display:flex;flex-direction:column;align-items:center;gap:9px}
.sf-shot{position:relative;width:186px;height:372px;border-radius:26px;overflow:hidden;
  background:#0f1a24 center top/cover no-repeat;border:6px solid #10161c;
  box-shadow:0 6px 20px rgba(0,0,0,.18)}
.sf-shot .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  text-align:center;padding:14px;font-size:12px;font-weight:700;color:#dff5e9;
  background:linear-gradient(160deg,#16324a,#0e9f5a)}
.sf-cnt{position:absolute;left:0;right:0;bottom:0;padding:34px 8px 12px;text-align:center;
  background:linear-gradient(transparent,rgba(0,0,0,.55) 42%,rgba(0,0,0,.86));color:#fff}
.sf-cnt b{display:block;font-size:26px;line-height:1.05;letter-spacing:-.5px}
.sf-cnt i{font-style:normal;font-size:10.5px;opacity:.9}
.sf-cnt .sub{font-size:10px;opacity:.85;margin-top:2px}
.sf-num{position:absolute;top:10px;left:10px;width:22px;height:22px;border-radius:50%;
  background:rgba(0,0,0,.55);color:#fff;font-size:11px;font-weight:700;display:flex;
  align-items:center;justify-content:center}
.sf-lbl{font-size:12.5px;font-weight:700;text-align:center;line-height:1.3;color:var(--fg,#222)}
.sf-plat{width:186px;display:flex;flex-direction:column;gap:3px;margin-top:-3px}
.sf-pbar{display:flex;height:7px;border-radius:4px;overflow:hidden;background:var(--line-soft)}
.sf-pbar span{display:block;height:100%}
.sf-pleg{display:flex;justify-content:center;gap:8px;font-size:9.5px;color:var(--muted);flex-wrap:wrap}
.sf-pleg i{font-style:normal;display:inline-flex;align-items:center;gap:3px}
.sf-pleg i::before{content:'';width:7px;height:7px;border-radius:2px;background:var(--c)}
.sf-pna{font-size:9.5px;color:var(--muted);text-align:center}
.sf-hint{font-size:10.5px;color:var(--muted);text-align:center;margin-top:-4px}
.sf-join{flex:0 0 auto;width:56px;align-self:center;margin-top:-46px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:4px}
.sf-join .arr{font-size:22px;line-height:1;color:#c7cfd9}
.sf-join .drop{font-size:12px;font-weight:800;padding:2px 8px;border-radius:999px;white-space:nowrap}
.sf-join .drop.bad{color:var(--bad-fg);background:var(--tint-red)}
.sf-join .drop.warn{color:var(--warn-fg);background:var(--tint-amber)}
.sf-join .drop.ok{color:var(--tint-green-fg);background:var(--tint-green)}
.sf-note{margin-top:10px;font-size:10.5px;color:var(--muted)}
.sf-vchip{display:inline-flex;gap:6px;align-items:center;margin-left:8px;padding:3px 11px;
  border:1px solid var(--line);border-radius:999px;font-size:11px;color:var(--muted)}
.sf-vchip b{color:var(--blue)}
.sf-vchip.sf-ap{border-color:var(--tint-violet-fg);background:var(--tint-violet);color:var(--tint-violet-fg)}
.sf-vchip.sf-ap b{color:#7c3aed}
.sf-direct{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--tint-green-fg);
  padding:2px 8px;border-radius:999px;background:var(--tint-green)}
.sf-flow{padding:10px 0 4px;border-top:1px solid var(--line);margin-top:8px}
.sf-flow:first-of-type{border-top:0;margin-top:0}
.sf-fhead{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.sf-fnum{width:19px;height:19px;border-radius:50%;background:var(--card2);color:var(--ink-soft);font-size:10.5px;
  font-weight:800;display:inline-flex;align-items:center;justify-content:center}
.sf-fname{font-size:12.5px;font-weight:800;color:var(--fg,#222)}
.sf-fdesc{font-size:11px;color:var(--muted);max-width:760px}
.sf-fsum{margin-left:auto;font-size:11px;color:var(--muted)}
.sf-fsum b{color:var(--fg,#222);font-size:12.5px}
.sf-fiss{margin-left:8px;padding:1px 8px;border-radius:999px;background:var(--tint-red);color:var(--bad-fg);font-weight:700}
.sf-err{width:186px;text-align:center;font-size:10px;font-weight:700;color:var(--bad-fg);background:var(--tint-red);
  border-radius:999px;padding:2px 6px;margin-top:-3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-shot.sf-dim{opacity:.62;filter:saturate(.55)}
.sf-cnt b.sf-na{font-size:12px;font-weight:700;letter-spacing:0;opacity:.9}
.sf-orerr span{border-color:var(--red-line) !important;background:var(--tint-red) !important;color:var(--bad-fg) !important}
.sf-orerr::before{border-color:var(--red-line) !important}
.sf-codes{width:186px;display:flex;flex-direction:column;gap:2px;margin-top:2px}
.sf-crow{display:flex;align-items:center;gap:4px;font-size:9.5px;color:var(--muted)}
.sf-ccode{flex:0 0 auto;min-width:20px;text-align:center;color:#fff;font-weight:800;font-size:9px;
  padding:1px 4px;border-radius:4px}
.sf-cmsg{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-cpct{flex:0 0 auto;font-weight:800;color:var(--fg,#222)}
.sf-shot.sf-click{cursor:pointer}
.sf-shot.sf-click:hover{box-shadow:0 8px 26px rgba(185,28,28,.35);transform:translateY(-2px);transition:.15s}
.sf-magnify{position:absolute;top:10px;right:10px;z-index:2;background:rgba(185,28,28,.92);color:#fff;
  font-size:9px;font-weight:800;padding:3px 7px;border-radius:999px;letter-spacing:.03em}
.sf-md{display:flex;flex-direction:column;max-height:82vh}
.sf-mdh{display:flex;align-items:baseline;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line)}
.sf-mdh b{font-size:14px}.sf-mdh .x{margin-left:auto;cursor:pointer;font-size:16px;color:var(--muted)}
.sf-mdsub{font-size:11px;color:var(--muted)}
.sf-mdb{overflow:auto;padding:10px 14px 14px}
.sf-mdt{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:10px 0 6px}
.sf-tbl{width:100%;border-collapse:collapse;font-size:11.5px}
.sf-tbl th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);
  border-bottom:1px solid var(--line);padding:5px 6px}
.sf-tbl td{padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}
.sf-tbl td.r,.sf-tbl th.r{text-align:right}
.sf-tbl td.mono{font-family:ui-monospace,Menlo,monospace;font-size:10.5px}
.sf-tbl tr.on{background:var(--tint-red)}
.sf-btn{cursor:pointer;border:1px solid var(--line);background:transparent;border-radius:7px;
  padding:2px 8px;font-size:10.5px;font-weight:700;color:var(--blue)}
.sf-mdnote{margin-top:10px;font-size:10px;color:var(--muted)}
.sf-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px 14px;margin-bottom:8px}
.sf-fact{display:flex;justify-content:space-between;gap:10px;font-size:11px;border-bottom:1px dotted var(--line);padding-bottom:3px}
.sf-fact span{color:var(--muted)}
.sf-fact b{text-align:right;word-break:break-all}
.sf-det summary{cursor:pointer;font-size:10.5px;font-weight:700;color:var(--blue);padding:4px 0}
.sf-det[open] summary{margin-bottom:6px}
.sf-clsrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0 2px}
.sf-xlsx{margin-left:auto;border:1px solid #0e9f5a;background:#0e9f5a;color:#fff;font-weight:700;
  font-size:12px;border-radius:8px;padding:6px 14px;cursor:pointer;white-space:nowrap;
  box-shadow:0 1px 2px rgba(0,0,0,.12)}
.sf-xlsx:hover{background:#0b8a4d;border-color:#0b8a4d}
.sf-xlsx:active{transform:translateY(1px)}
.sf-cls{font-size:11px;color:var(--muted);border:1px solid var(--line);border-left:4px solid var(--c);
  border-radius:8px;padding:3px 10px;background:var(--card,#fff)}
.sf-cls b{color:var(--c);text-transform:uppercase;font-size:10px;letter-spacing:.05em}
.sf-empty{font-size:11.5px;color:var(--muted);background:var(--bg,#f8fafc);border:1px dashed var(--line);
  border-radius:8px;padding:9px 11px}
.sf-ex{border:1px solid var(--line);border-radius:10px;margin-bottom:10px;overflow:hidden}
.sf-exh{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg,#f8fafc);
  border-bottom:1px solid var(--line);flex-wrap:wrap}
.sf-exh .m{font-size:10px;font-weight:800;color:#fff;background:#0e9f5a;border-radius:5px;padding:2px 7px}
.sf-exh .u{font-size:11.5px;font-weight:700}
.sf-exg{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px}
@media(max-width:900px){.sf-exg{grid-template-columns:1fr}}
.sf-exl{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:4px}
.sf-json{margin:0;max-height:280px;overflow:auto;background:var(--panel-dark);color:var(--panel-dark-fg);border-radius:8px;
  padding:9px 11px;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;line-height:1.5;white-space:pre-wrap;
  word-break:break-word}
.sf-json .jk{color:#7dd3fc}.sf-json .js{color:#86efac}.sf-json .jn{color:#fca5a5}.sf-json .jb{color:#c4b5fd}
.sf-or{flex:0 0 auto;width:74px;align-self:stretch;display:flex;align-items:center;justify-content:center;
  position:relative;margin:0 6px}
.sf-or::before{content:'';position:absolute;top:18px;bottom:96px;left:50%;border-left:2px dashed var(--line)}
.sf-or span{position:relative;z-index:1;background:var(--card,#fff);border:1px solid var(--line);
  border-radius:999px;padding:3px 9px;font-size:9.5px;font-weight:700;text-transform:uppercase;
  letter-spacing:.06em;color:var(--muted);text-align:center;line-height:1.25;max-width:70px}
/* ---- lane navigation: arrows + edge fades + clickable step dots -------------------------
 * width chain matters: on the dashboard the lane's flex ancestors let it stretch to CONTENT
 * width (outer panel clipped it instead), so scrollWidth==clientWidth and nothing looked
 * scrollable. The wrapper pins width to the panel, min-width:0 breaks the flex stretch, and
 * the lane becomes the real scroller in every context. */
.sf-scroller{position:relative;display:block;width:100%;max-width:100%;min-width:0;overflow:hidden}
.sf-scroller>.sf-lane{max-width:100%}
.sf-scroller.no-ov .sf-arr,.sf-scroller.no-ov .sf-dots{display:none}
.sf-scroller::before,.sf-scroller::after{content:'';position:absolute;top:0;bottom:0;width:42px;
  z-index:2;pointer-events:none;opacity:0;transition:opacity .15s}
.sf-scroller::before{left:0;background:linear-gradient(90deg,var(--card,#fff),transparent)}
.sf-scroller::after{right:0;background:linear-gradient(270deg,var(--card,#fff),transparent)}
.sf-scroller.can-l::before{opacity:1}.sf-scroller.can-r::after{opacity:1}
.sf-arr{position:absolute;top:180px;z-index:3;width:36px;height:36px;border-radius:50%;
  border:1px solid var(--line);background:var(--card,#fff);color:var(--fg,#222);font-size:18px;
  font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(15,23,42,.18);display:flex;
  align-items:center;justify-content:center;opacity:0;transition:opacity .15s;user-select:none}
.sf-scroller:hover .sf-arr{opacity:.95}
.sf-arr:hover{background:#0e9f5a;color:#fff;border-color:#0e9f5a}
.sf-arr[disabled]{opacity:.15 !important;pointer-events:none}
.sf-arr.l{left:6px}.sf-arr.r{right:6px}
.sf-dots{display:flex;gap:5px;align-items:center;justify-content:center;padding:7px 0 2px;flex-wrap:wrap}
.sf-dot{width:9px;height:9px;border-radius:50%;background:var(--line);border:none;cursor:pointer;
  padding:0;transition:transform .12s, background .12s}
.sf-dot:hover{transform:scale(1.5)}
.sf-dot.err{background:#fca5a5}
.sf-dot.on{background:#0e9f5a;transform:scale(1.45)}
.sf-dot.err.on{background:#dc2626}
.sf-dot-sep{width:1px;height:12px;background:var(--line);margin:0 3px}`;
    document.head.appendChild(s);
  }

  const IMG = (j, k) => `assets/screens/${j}_${k}.png`;
  // per-app split under a step: iOS / Android / Web (+ other). Percentages are of the KNOWN
  // platform population for that step — orders whose app could not be determined are reported
  // separately rather than silently folded into one of the three.
  // Four real channels only — the three apps plus Apollo (reseller placed it through the API:
  // tygo / soob). Nothing is shown as "other" or "unknown": a step is either attributable to
  // one of these, or it is left out of the split.
  const PC = { ios: '#111827', android: '#0e9f5a', web: '#2563eb', apollo: '#a855f7' };
  const PL = { ios: 'iOS', android: 'Android', web: 'Web', apollo: 'Apollo (reseller API)' };
  const PS = { ios: 'iOS', android: 'Android', web: 'Web', apollo: 'Apollo' };
  function platBar(mix) {
    if (!mix) return '';
    const known = Number(mix.known || 0);
    if (!known) return `<div class="sf-plat"></div>`;
    const parts = ['ios', 'android', 'web', 'apollo'].map(k => ({ k, n: Number(mix[k] || 0) })).filter(x => x.n > 0);
    return `<div class="sf-plat">
      <div class="sf-pbar">${parts.map(p => `<span style="width:${(100 * p.n / known).toFixed(2)}%;background:${PC[p.k]}" title="${PL[p.k]}: ${fmt(p.n)}"></span>`).join('')}</div>
      <div class="sf-pleg">${parts.map(p => `<i style="--c:${PC[p.k]}" title="${PL[p.k]}: ${fmt(p.n)}">${PS[p.k]} ${Math.round(100 * p.n / known)}%</i>`).join('')}</div>
    </div>`;
  }
  // base = the step every percentage is measured against. On the logged lanes step 1 counts
  // CUSTOMERS while steps 2-4 count PAYMENT ATTEMPTS — different units, so the baseline is the
  // first attempt step (otherwise a customer retrying twice reads as "150% of journey start").
  function stepCard(j, s, i, base, baseIdx) {
    // n === null → the screen is part of the journey but calls no API, so there is nothing to
    // count. Say so instead of printing a zero that would read as "nobody got here".
    if (s.n == null) {
      return `<div class="sf-step">
        <div class="sf-shot sf-dim" data-img="${IMG(j, s.k)}">
          <div class="ph">${esc(s.label)}</div>
          <div class="sf-num">${i + 1}</div>
          <div class="sf-cnt"><b class="sf-na">not measured</b><i>${esc(s.note || 'no API call on this screen')}</i></div>
        </div>
        <div class="sf-lbl">${esc(s.label)}</div>
      </div>`;
    }
    const unit = (baseIdx > 0 && i === 0) ? 'customers' : 'of ' + (baseIdx > 0 ? 'attempts' : 'journey start');
    const pct = (i === 0 && baseIdx > 0) ? '' : (base > 0 ? Math.round(100 * s.n / base) + '% ' : '');
    const drill = s.drill ? ` sf-click" data-drill="${esc(s.drill)}" data-arg="${esc(s.drillArg || '')}` : '';
    return `<div class="sf-step">
      <div class="sf-shot${drill}" data-img="${IMG(j, s.k)}"${s.drill ? ' title="Open every failed attempt — code, BSS message and transaction"' : ''}>
        ${s.drill ? '<div class="sf-magnify">⤢ open failures</div>' : ''}
        <div class="ph">${esc(s.label)}</div>
        <div class="sf-num">${i + 1}</div>
        <div class="sf-cnt"><b>${fmt(s.n)}</b><i>${pct}${unit}</i>
          ${s.sub ? `<div class="sub">${esc(s.sub)}</div>` : ''}</div>
      </div>
      <div class="sf-lbl">${esc(s.label)}</div>
      ${Number(s.err) ? `<div class="sf-err" title="${esc(s.errLabel || 'issues')}">⚠ ${fmt(s.err)} ${esc(s.errLabel || 'issues')}</div>` : ''}
      ${codeList(s)}
      ${platBar(s.mix)}
    </div>`;
  }
  // per-code share shown directly on an error screen (voucher: BSS response codes)
  function codeList(s) {
    if (!s.codes || !s.codes.length) return '';
    const CC = { technical: '#b91c1c', business: '#2563eb', success: '#0e7c4a',
                 reconciliation: '#d97706', customer: '#64748b', unknown: '#94a3b8' };
    return `<div class="sf-codes">` + s.codes.slice(0, 5).map(c =>
      `<div class="sf-crow" title="${esc(c.msg)}">
         <span class="sf-ccode" style="background:${CC[c.cls] || '#64748b'}">${esc(c.code)}</span>
         <span class="sf-cmsg">${esc(c.msg)}</span>
         <span class="sf-cpct">${c.pct}%</span>
       </div>`).join('') + `</div>`;
  }
  function join(prev, cur, i, baseIdx) {
    if (!prev || !prev.n) return `<div class="sf-join"><div class="arr">→</div></div>`;
    // customers → attempts is not a drop: report it as attempts per customer
    if (baseIdx > 0 && i === 1) {
      const rate = (cur.n / prev.n).toFixed(1);
      return `<div class="sf-join"><div class="arr">→</div>
        <div class="drop ok" title="payment attempts per customer">×${rate} tries</div></div>`;
    }
    const drop = Math.max(0, 100 - Math.round(100 * cur.n / prev.n));
    const cl = drop >= 40 ? 'bad' : (drop >= 10 ? 'warn' : 'ok');
    return `<div class="sf-join"><div class="arr">→</div>
      <div class="drop ${cl}">${drop ? '−' + drop + '%' : 'no drop'}</div></div>`;
  }
  // A lane can hold several journey ROWS (prepaid: recharge · voucher · change plan;
  // postpaid: invoice · advance payment). Each row states what it is, then its screens.
  function flowRow(F, i) {
    const steps = F.steps || [];
    // baseline = first step that actually carries a number (screens with no telemetry are
    // rendered but never used as the denominator)
    let bi = steps.findIndex(s => s.n != null);
    if (bi < 0) bi = 0;
    if (steps[0] && steps[0].k === 'home' && steps[1] && steps[1].n != null) bi = 1;
    const base = (steps[bi] && steps[bi].n) || 0;
    const last = steps.length ? steps[steps.length - 1].n : 0;
    const conv = base > 0 ? (100 * last / base).toFixed(1) : '0.0';
    const issues = steps.reduce((a, s) => a + Number(s.err || 0), 0);
    return `<div class="sf-flow">
      <div class="sf-fhead">
        <span class="sf-fnum">${i + 1}</span>
        <span class="sf-fname">${esc(F.name || F.key)}</span>
        <span class="sf-fdesc">${esc(F.desc || '')}</span>
        <span class="sf-fsum">${bi ? `<b>${fmt(steps[0].n)}</b> customers · ` : ''}<b>${fmt(base)}</b> ${bi ? 'attempts' : 'started'} → <b>${fmt(last)}</b> done · ${conv}%
          ${issues ? `<span class="sf-fiss">${fmt(issues)} to look at</span>` : ''}</span>
      </div>
      <div class="sf-lane">${steps.map((s, k) => (k ? join(steps[k - 1], s, k, bi) : '') + stepCard(F.j, s, k, base, bi)).join('')}${errBranch(F)}</div>
    </div>`;
  }
  // error screens of a journey: the states the customer actually sees when it goes wrong
  function errBranch(F) {
    const es = F.errSteps; if (!es || !es.length) return '';
    return `<div class="sf-or sf-orerr"><span>error states</span></div>` +
      es.map((s, k) => stepCard(F.j, s, k, 0, 0)).join('');
  }
  function laneHtml(L, extra) {
    if (L.flows && L.flows.length) {
      const tot = L.flows.reduce((a, F) => {
        const st = F.steps || [], bi = st[0] && st[0].k === 'home' ? 1 : 0;
        a.att += (st[bi] && st[bi].n) || 0; a.done += st.length ? st[st.length - 1].n : 0;
        a.iss += st.reduce((b, s) => b + Number(s.err || 0), 0); return a;
      }, { att: 0, done: 0, iss: 0 });
      return `<div class="sf-lane-wrap">
        <div class="sf-lhead">
          <span class="sf-dot" style="background:${L.color}"></span>
          <span class="sf-ltitle" style="color:${L.color}">${esc(L.name)}</span>
          <span class="sf-lstate">${esc(L.state)}</span>
          ${extra || ''}
          <span class="sf-lsum"><b>${fmt(tot.att)}</b> attempts → <b>${fmt(tot.done)}</b> completed
            ${tot.iss ? ` &nbsp;·&nbsp; <b style="color:var(--bad-fg)">${fmt(tot.iss)}</b> issues` : ''}</span>
        </div>
        ${L.flows.map(flowRow).join('')}
        ${L.note ? `<div class="sf-note">${esc(L.note)}</div>` : ''}
      </div>`;
    }
    return laneSimple(L, extra);
  }
  function laneSimple(L, extra) {
    const steps = L.steps || [], bi = L.baseIdx || 0;
    const base = (steps[bi] && steps[bi].n) || 0;
    const last = steps.length ? steps[steps.length - 1].n : 0;
    const conv = base > 0 ? (100 * last / base).toFixed(1) : '0.0';
    const sum = bi > 0
      ? `<b>${fmt((steps[0] && steps[0].n) || 0)}</b> customers &nbsp;·&nbsp; <b>${fmt(base)}</b> attempts &nbsp;→&nbsp; <b>${fmt(last)}</b> ${esc(L.endWord)} &nbsp;·&nbsp; ${conv}% of attempts`
      : `<b>${fmt(base)}</b> started &nbsp;→&nbsp; <b>${fmt(last)}</b> ${esc(L.endWord)} &nbsp;·&nbsp; ${conv}% end-to-end`;
    return `<div class="sf-lane-wrap">
      <div class="sf-lhead">
        <span class="sf-dot" style="background:${L.color}"></span>
        <span class="sf-ltitle" style="color:${L.color}">${esc(L.name)}</span>
        <span class="sf-lstate">${esc(L.state)}</span>
        ${L.direct ? `<span class="sf-direct">Salam direct only</span>` : ''}
        ${extra || ''}
        <span class="sf-lsum">${sum}</span>
      </div>
      <div class="sf-lane">${steps.map((s, i) => (i ? join(steps[i - 1], s, i, bi) : '') + stepCard(L.j, s, i, base, bi)).join('')}${branchHtml(L)}${errBranch(L)}</div>
    </div>`;
  }
  // An alternative path off the same lane (prepaid: redeem a voucher instead of paying a card).
  // Rendered after an "or" divider so it is never read as the next step of the main funnel.
  function branchHtml(L) {
    const b = L.branch; if (!b || !b.steps || !b.steps.length) return '';
    const first = b.steps[0].n || 0;
    return `<div class="sf-or"><span>${esc(b.label || 'or')}</span></div>` +
      b.steps.map((s, i) => (i ? join(b.steps[i - 1], s, 9, 0) : '') +
        stepCard(L.j, s, i, first, 0)).join('');
  }
  /* ---- lane navigation: wrap every overflowing lane with arrows + clickable step dots ------
   * Trackpad side-scrolling across a 13-card lane was the #1 UX complaint on this panel. Each
   * lane gets: ‹ › paging arrows (appear on hover, disabled at the ends), edge fades that hint
   * at more content, and one dot per screen — red for error states, tooltip = the step name,
   * click = smooth-scroll that card to centre, active dot follows the scroll. All computed from
   * the rendered DOM, so every present and future lane gets it with no per-lane wiring. */
  function laneNav(host) {
    host.querySelectorAll('.sf-lane').forEach(lane => {
      // ALWAYS wrap — the wrapper is what makes the lane scrollable on the dashboard (see CSS
      // note). Overflow is re-checked in sync(): no overflow → chrome hidden via .no-ov.
      const wrap = document.createElement('div');
      wrap.className = 'sf-scroller';
      lane.parentNode.insertBefore(wrap, lane);
      wrap.appendChild(lane);
      const mk = (cls, txt) => { const b = document.createElement('button');
        b.className = 'sf-arr ' + cls; b.textContent = txt; wrap.appendChild(b); return b; };
      const L = mk('l', '‹'), R = mk('r', '›');
      const dots = document.createElement('div'); dots.className = 'sf-dots';
      wrap.appendChild(dots);
      const steps = [...lane.querySelectorAll('.sf-step')];
      let inErr = false;
      const dotEls = steps.map((st, i) => {
        // everything after the "error states" divider gets a red dot
        let n = st.previousElementSibling;
        while (n && !(n.classList && n.classList.contains('sf-orerr'))) n = n.previousElementSibling;
        if (n) inErr = true;
        if (i && inErr && !dots.querySelector('.sf-dot-sep') && n && n.nextElementSibling === st) {
          const s = document.createElement('span'); s.className = 'sf-dot-sep'; dots.appendChild(s);
        }
        const d = document.createElement('button');
        d.className = 'sf-dot' + (inErr ? ' err' : '');
        const lbl = st.querySelector('.sf-lbl');
        d.title = lbl ? lbl.textContent : `step ${i + 1}`;
        d.addEventListener('click', () => lane.scrollTo({
          left: st.offsetLeft - lane.offsetLeft - (lane.clientWidth - st.offsetWidth) / 2,
          behavior: 'smooth' }));
        dots.appendChild(d);
        return d;
      });
      const page = dir => lane.scrollBy({ left: dir * lane.clientWidth * 0.8, behavior: 'smooth' });
      L.addEventListener('click', () => page(-1));
      R.addEventListener('click', () => page(1));
      let t = false;
      const sync = () => {
        t = false;
        const x = lane.scrollLeft, max = lane.scrollWidth - lane.clientWidth;
        wrap.classList.toggle('no-ov', max <= 20);                // fits → hide arrows + dots
        wrap.classList.toggle('can-l', x > 8); wrap.classList.toggle('can-r', x < max - 8);
        L.disabled = x <= 8; R.disabled = x >= max - 8;
        // active dot = the card nearest the viewport centre
        const c = x + lane.clientWidth / 2;
        let best = 0, bd = 1e9;
        steps.forEach((st, i) => { const m = st.offsetLeft - lane.offsetLeft + st.offsetWidth / 2;
          const d = Math.abs(m - c); if (d < bd) { bd = d; best = i; } });
        dotEls.forEach((d, i) => d.classList.toggle('on', i === best));
      };
      lane.addEventListener('scroll', () => { if (!t) { t = true; requestAnimationFrame(sync); } }, { passive: true });
      window.addEventListener('resize', () => { if (!t) { t = true; requestAnimationFrame(sync); } }, { passive: true });
      sync();
      setTimeout(sync, 500);      // re-measure once fonts/first paint settle
    });
  }

  function hydrateImages(host) {
    host.querySelectorAll('.sf-shot[data-img]').forEach(el => {
      const url = el.dataset.img, im = new Image();
      im.onload = () => { el.style.backgroundImage = `url("${url}")`; const ph = el.querySelector('.ph'); if (ph) ph.remove(); };
      im.src = url;
    });
  }

  /* ---- voucher failure drill: every rejected attempt, end to end ------------------------- */
  let _win = null;
  async function openVoucherErrors(code) {
    const modal = document.getElementById('panelModal'), card = document.getElementById('panelModalCard');
    if (!modal || !card) return;
    const qs = `from=${encodeURIComponent(_win.from)}&to=${encodeURIComponent(_win.to)}` + (code ? `&code=${encodeURIComponent(code)}` : '');
    card.style.maxWidth = '1080px';
    card.innerHTML = `<div class="sf-md"><div class="sf-mdh"><b>Voucher failures</b><span class="x" id="sfX">✕</span></div>
      <div class="sf-mdb">loading…</div></div>`;
    modal.classList.add('open');
    card.querySelector('#sfX').onclick = () => modal.classList.remove('open');
    let d; try { d = await api('/api/screens-flow/voucher-errors?' + qs); }
    catch (e) { card.querySelector('.sf-mdb').innerHTML = `<div class="albanner">${esc(e.message)}</div>`; return; }
    const CC = { technical: '#b91c1c', business: '#2563eb', success: '#0e7c4a' };
    const fails = (d.codes || []).filter(c => c.cls !== 'success');
    const ftot = fails.reduce((a, c) => a + c.n, 0) || 1;
    const ok = (d.codes || []).filter(c => c.cls === 'success').reduce((a, c) => a + c.n, 0);
    const codeTbl = `<table class="sf-tbl"><thead><tr><th>Code</th><th>Message returned by BSS</th><th>Class</th>
        <th class="r">Count</th><th class="r">% of failures</th><th class="r">Avg ms</th><th></th></tr></thead><tbody>
      ${fails.map(c => `<tr class="${d.filtered === c.code ? 'on' : ''}">
        <td><span class="sf-ccode" style="background:${CC[c.cls]}">${esc(c.code)}</span></td>
        <td>${esc(c.msg)}</td><td>${c.cls}</td><td class="r"><b>${fmt(c.n)}</b></td>
        <td class="r">${(100 * c.n / ftot).toFixed(1)}%</td><td class="r">${c.avg_ms == null ? '—' : fmt(c.avg_ms)}</td>
        <td class="r"><button class="sf-btn" data-code="${esc(c.code)}">attempts ›</button></td></tr>`).join('')}
    </tbody></table>`;
    const rowsTbl = `<table class="sf-tbl"><thead><tr><th>When (KSA)</th><th>Code</th><th>BSS message</th>
        <th class="r">ms</th><th>API host</th><th>Transaction</th><th></th></tr></thead><tbody>
      ${(d.rows || []).map(r => `<tr>
        <td>${esc(KT.dts(r.ts))}</td>
        <td><span class="sf-ccode" style="background:${CC[r.cls]}">${esc(r.code)}</span></td>
        <td>${esc(r.msg)}</td><td class="r">${r.duration_ms == null ? '—' : fmt(r.duration_ms)}</td>
        <td>${esc(r.host || '—')}</td>
        <td class="mono">${esc(r.transaction_id || '—')}</td>
        <td class="r">${r.transaction_id ? `<button class="sf-btn" data-txn="${esc(r.transaction_id)}">timeline ›</button>` : ''}</td>
      </tr>`).join('') || `<tr><td colspan="7">No failed attempts captured in this window.</td></tr>`}
    </tbody></table>`;
    card.innerHTML = `<div class="sf-md">
      <div class="sf-mdh"><b>Voucher failures</b>
        <span class="sf-mdsub">${esc(ksa(d.from))} → ${esc(ksa(d.to))} <b>KSA</b> ·
          ${fmt(d.total)} attempts · <b style="color:var(--bad-fg)">${fmt(d.failed)}</b> failed · ${fmt(ok)} ok</span>
        <span class="x" id="sfX">✕</span></div>
      <div class="sf-mdb">
        <div class="sf-mdt">Response codes — what BSS returned</div>${codeTbl}
        <div class="sf-mdt">Failed attempts ${d.filtered ? `· filtered on code <b>${esc(d.filtered)}</b>
          <button class="sf-btn" data-code="">clear</button>` : '· most recent 250'}</div>${rowsTbl}
        <div class="sf-mdnote">Source: API traffic capture on the Digital API hosts (the app writes no DB row for voucher recharges).
          "Transaction" links to the end-to-end timeline: app → API gateway → integration layer → BSS.</div>
      </div></div>`;
    card.querySelector('#sfX').onclick = () => modal.classList.remove('open');
    card.querySelectorAll('button[data-code]').forEach(b =>
      b.addEventListener('click', () => openVoucherErrors(b.dataset.code || '')));
    card.querySelectorAll('button[data-txn]').forEach(b => b.addEventListener('click', () => {
      const r = (d.rows || []).find(x => x.transaction_id === b.dataset.txn);
      openTxnDetail(b.dataset.txn, r, code);   // stays inside the SAME modal — no drawer swap
    }));
  }

  /* ---- recharge / change-plan failures: reasons, then one payment end to end ------------- */
  const BUCKET = {
    declined: { t: 'Payment declined', d: 'The gateway answered: the bank or acquirer refused the payment.' },
    left: { t: 'Left before paying', d: 'Payment created but the gateway never answered — the customer left the payment screen.' },
  };
  /* flowWindow() on the server returns .toISOString() — UTC. The payments table below renders with
   * KT (Asia/Riyadh), so the popup showed a 12:00-13:00 header above rows stamped 15:42. Same
   * window, two clocks, neither labelled. Every user-facing timestamp here goes through this. */
  const ksa = (v, secs) => (window.KT && KT.dt) ? (secs ? KT.dts(v) : KT.dt(v))
    : String(v || '').replace('T', ' ').slice(0, secs ? 19 : 16);

  // journey display names — the popup must say WHICH row it was opened from, in the row's own
  // words, not the internal flow key ("sim_swap" means nothing to an L1 reading the title)
  const FLOWN = { recharge: 'Recharge (card / wallet)', change_plan: 'Change plan',
    invoice: 'Invoice payment', advance: 'Advance payment', service: 'Postpaid service recharge',
    sim_swap: 'Request a SIM swap', renewal: 'Renew your plan',
    onboarding_new: 'New SIM onboarding', onboarding_mnp: 'MNP port-in onboarding' };
  async function openRechargeErrors(flow, bucket, reason) {
    const modal = document.getElementById('panelModal'), card = document.getElementById('panelModalCard');
    if (!modal || !card) return;
    const B = BUCKET[bucket] || BUCKET.declined;
    const jname = FLOWN[flow] || flow;
    card.style.maxWidth = '1120px';
    card.innerHTML = `<div class="sf-md"><div class="sf-mdh"><b>${esc(jname)} — ${esc(B.t)}</b><span class="x" id="sfX">✕</span></div>
      <div class="sf-mdb">loading…</div></div>`;
    modal.classList.add('open');
    card.querySelector('#sfX').onclick = () => modal.classList.remove('open');
    const qs = `from=${encodeURIComponent(_win.from)}&to=${encodeURIComponent(_win.to)}&flow=${encodeURIComponent(flow)}&bucket=${encodeURIComponent(bucket)}` +
      (reason ? `&reason=${encodeURIComponent(reason)}` : '');
    let d; try { d = await api('/api/screens-flow/recharge-errors?' + qs); }
    catch (e) { card.querySelector('.sf-mdb').innerHTML = `<div class="albanner">${esc(e.message)}</div>`; return; }
    // classes: business = customer/bank outcome · technical = platform fault ·
    // customer = never engaged · unknown = nobody recorded a reason (an app-side gap, NOT a fault)
    const CC = { technical: '#b91c1c', business: '#2563eb', success: '#0e7c4a',
                 reconciliation: '#d97706', customer: '#64748b', unknown: '#94a3b8' };
    const money = v => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' SAR';
    // headline: the business / technical split of this bucket, the same rule as the reports
    const byCls = {};
    (d.reasons || []).forEach(r => { byCls[r.cls] = byCls[r.cls] || { n: 0, sar: 0 };
      byCls[r.cls].n += r.n; byCls[r.cls].sar += Number(r.sar || 0); });
    const clsTot = Object.values(byCls).reduce((a, x) => a + x.n, 0) || 1;
    const clsStrip = Object.entries(byCls).sort((a, b) => b[1].n - a[1].n).map(([k, v]) =>
      `<span class="sf-cls" style="--c:${CC[k] || '#64748b'}"><b>${esc(k)}</b> ${fmt(v.n)} · ${(100 * v.n / clsTot).toFixed(1)}%</span>`).join('');
    const kv = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${fmt(v)}`).join(' · ');
    const reasonsTbl = (d.reasons || []).length ? `<table class="sf-tbl"><thead><tr><th>Reason returned</th><th>Class</th>
        <th class="r">Count</th><th class="r">Share</th><th class="r">Value</th><th>Apps</th><th>Vendor</th><th></th></tr></thead><tbody>
      ${d.reasons.map(r => `<tr class="${d.filtered === r.reason ? 'on' : ''}">
        <td>${esc(r.reason)}</td>
        <td><span class="sf-ccode" style="background:${CC[r.cls] || '#64748b'}">${esc(r.cls)}</span></td>
        <td class="r"><b>${fmt(r.n)}</b></td><td class="r">${r.pct}%</td><td class="r">${money(r.sar)}</td>
        <td>${kv(r.plat)}</td><td>${kv(r.vendor)}</td>
        <td class="r"><button class="sf-btn" data-reason="${esc(r.reason)}">payments ›</button></td></tr>`).join('')}
    </tbody></table>` : `<div class="sf-empty">Nothing in this bucket for the selected window.</div>`;
    const rowsTbl = `<table class="sf-tbl"><thead><tr><th>When (KSA)</th><th>Reference</th><th class="r">Amount</th>
        <th>Rail</th><th>App</th><th>Vendor</th><th>UPG</th><th>Reason</th><th></th></tr></thead><tbody>
      ${(d.rows || []).map(r => `<tr>
        <td>${esc(KT.dts(r.created_at))}</td>
        <td class="mono">${esc(r.ref || '—')}</td><td class="r">${money(r.amount)}</td>
        <td>${esc(r.rail || '—')}</td><td>${esc(r.platform)}</td><td>${esc(r.vendor || '—')}</td>
        <td>${esc(r.upg_status || '—')}</td><td>${esc(r.reason || '—')}</td>
        <td class="r"><button class="sf-btn" data-pay="${esc(r.id)}">trace ›</button></td></tr>`).join('')
        || `<tr><td colspan="9">No payments in this bucket.</td></tr>`}
    </tbody></table>`;
    card.innerHTML = `<div class="sf-md">
      <div class="sf-mdh"><b>${esc(jname)} — ${esc(B.t)}</b>
        <span class="sf-mdsub">${esc(ksa(d.from))} → ${esc(ksa(d.to))} <b>KSA</b> ·
          <b style="color:var(--bad-fg)">${fmt(d.total)}</b> payments</span>
        <span class="x" id="sfX">✕</span></div>
      <div class="sf-mdb">
        <div class="sf-empty" style="margin-bottom:8px">${esc(B.d)}
          ${d.truncated ? `<br><b>${esc(d.truncated)}</b>` : ''}
          ${d.upgNote ? `<br>⚠ ${esc(d.upgNote)}` : ''}
          ${bucket === 'declined' ? '<br>Reasons come from the UPG gateway where the app stored none — the app does not persist bank_message.' : ''}</div>
        <div class="sf-clsrow">${clsStrip}
          <button id="sfXlsx" class="sf-xlsx" title="Download everything in this popup: the reason summary and every payment row">Export to Excel</button>
        </div>
        <div class="sf-mdt">Why they did not complete — count and share per gateway response</div>${reasonsTbl}
        <div class="sf-mdt">Payments ${d.filtered ? `· filtered on “${esc(d.filtered)}” <button class="sf-btn" data-reason="">clear</button>` : '· most recent 250'}</div>${rowsTbl}
        <div class="sf-mdnote">“trace ›” opens the payment end to end: app call → API gateway spans → the request/response bodies → the UPG gateway attempts.</div>
      </div></div>`;
    card.querySelector('#sfX').onclick = () => modal.classList.remove('open');

    /* Export the WHOLE popup, not just what fits on screen: sheet 1 is the reason summary, sheet 2
     * is every payment row the API returned. Amounts and counts are cast with Number() here — the
     * writer deliberately does no type inference, because reference ids and MSISDNs are
     * numeric-looking strings that must stay text. */
    const xbtn = card.querySelector('#sfXlsx');
    if (xbtn) {
      if (!window.opsXlsx) xbtn.remove();
      else xbtn.onclick = () => {
        const meta = `${d.flow}_${d.bucket}_${String(d.from).slice(0, 10)}`;
        /* A per-reason breakdown is only worth a column when it actually varies. With one vendor
         * for the whole window, "vendors" prints "salam 8 · salam 7 · salam 6…" — the count column
         * again, wearing a prefix, and it makes a reader stop and wonder what they are looking at.
         * When a dimension has a single value across the export, state it once in Summary and drop
         * the column. */
        const distinct = (key) => {
          const set = new Set();
          (d.reasons || []).forEach(r => Object.keys(r[key] || {}).forEach(k => set.add(k)));
          return [...set];
        };
        const vendors = distinct('vendor'), apps = distinct('plat');
        const oneVendor = vendors.length === 1 ? vendors[0] : null;
        const oneApp = apps.length === 1 ? apps[0] : null;
        const reasonCols = ['reason', 'class', 'count', 'share_pct', 'value_sar']
          .concat(oneApp ? [] : ['apps'])
          .concat(oneVendor ? [] : ['vendors']);
        window.opsXlsx.save([
          { name: 'Summary', cols: ['field', 'value'], rows: [
            { field: 'Journey', value: `${jname} (${d.flow})` },
            { field: 'Bucket', value: d.bucket === 'left' ? 'Left before paying' : 'Payment declined' },
            { field: 'From (KSA)', value: ksa(d.from, true) },
            { field: 'To (KSA)', value: ksa(d.to, true) },
            { field: 'Window (UTC)', value: `${String(d.from).replace('T', ' ').slice(0, 19)} to ${String(d.to).replace('T', ' ').slice(0, 19)}` },
            { field: 'Payments in window', value: Number(d.total) || 0 },
            { field: 'Rows classified', value: Number(d.scanned) || 0 },
            { field: 'Truncated', value: d.truncated || 'no' },
            { field: 'Gateway note', value: d.upgNote || '' },
            { field: 'Filtered on reason', value: d.filtered || '' },
            { field: 'Vendor', value: oneVendor ? `${oneVendor} (all ${Number(d.total) || 0} payments)` : vendors.join(' · ') },
            { field: 'App', value: oneApp ? `${oneApp} (all payments)` : apps.join(' · ') },
            { field: 'Exported', value: ksa(new Date().toISOString(), true) + ' KSA' },
          ] },
          { name: 'Reasons', cols: reasonCols,
            rows: (d.reasons || []).map(r => ({
              reason: r.reason, class: r.cls,
              count: Number(r.n) || 0, share_pct: Number(r.pct) || 0, value_sar: Number(r.sar) || 0,
              apps: Object.entries(r.plat || {}).map(([k, v]) => `${k} ${v}`).join(' · '),
              vendors: Object.entries(r.vendor || {}).map(([k, v]) => `${k} ${v}`).join(' · '),
            })) },
          { name: 'Payments', cols: ['when_ksa', 'reference', 'amount_sar', 'rail', 'app', 'vendor', 'upg_status', 'reason', 'class', 'payment_id'],
            rows: (d.rows || []).map(r => ({
              when_ksa: (window.KT && KT.dts) ? KT.dts(r.created_at) : String(r.created_at || '').replace('T', ' ').slice(0, 19),
              reference: r.ref || '', amount_sar: Number(r.amount) || 0,
              rail: r.rail || '', app: r.plat || '', vendor: r.vendor || '',
              upg_status: r.upg || r.status || '', reason: r.reason || '', class: r.cls || '',
              payment_id: r.id || '',
            })) },
        ], `salam_${meta}`, {
          source: 'screens-flow popup', journey: d.flow, bucket: d.bucket,
          window_ksa: `${ksa(d.from, true)} to ${ksa(d.to, true)}`,
          payments_in_window: Number(d.total) || 0, filtered_reason: d.filtered || null,
        });
      };
    }

    card.querySelectorAll('button[data-reason]').forEach(b =>
      b.addEventListener('click', () => openRechargeErrors(flow, bucket, b.dataset.reason || '')));
    card.querySelectorAll('button[data-pay]').forEach(b => b.addEventListener('click', () => {
      const r = (d.rows || []).find(x => x.id === b.dataset.pay);
      openPaymentDetail(b.dataset.pay, r, { flow, bucket, reason });
    }));
  }

  /* ---- journey error drill: eligibility / nafath / activation / delivery ------------------ */
  // per-category row columns: [key, header, formatter?] — one popup, four data shapes
  const JCOLS = {
    pre_eligibility: [['created_at', 'When (KSA)', v => KT.dts(v)], ['id', 'Order id', null, 'mono'],
      ['mobile', 'Mobile'], ['plan_id', 'Plan'], ['state', 'Last step (order state)']],
    eligibility: [['created_at', 'When (KSA)', v => KT.dts(v)], ['id', 'Order id', null, 'mono'],
      ['mobile', 'Mobile'], ['nid', 'National ID'], ['plan_id', 'Plan'], ['state', 'Order state']],
    nafath: [['created_at', 'When (KSA)', v => KT.dts(v)], ['status', 'Status'], ['service', 'Service'],
      ['id', 'Log id', null, 'mono']],
    activation: [['created_at', 'When (KSA)', v => KT.dts(v)], ['api', 'API', null, 'mono'],
      ['code', 'Code'], ['cls', 'Class'], ['message', 'BSS message'], ['platform', 'App'],
      ['order_id', 'Order id', null, 'mono']],
    delivery: [['created_at', 'When (KSA)', v => KT.dts(v)], ['bucket', 'Bucket'], ['vendor', 'Courier'],
      ['state', 'Delivery state'], ['submitted', 'Submitted'], ['id', 'Request id', null, 'mono']],
  };
  async function openJourneyErrors(cat, lane) {
    const modal = document.getElementById('panelModal'), card = document.getElementById('panelModalCard');
    if (!modal || !card) return;
    card.style.maxWidth = '1120px';
    card.innerHTML = `<div class="sf-md"><div class="sf-mdh"><b>Journey errors</b><span class="x" id="sfX">✕</span></div>
      <div class="sf-mdb">loading…</div></div>`;
    modal.classList.add('open');
    card.querySelector('#sfX').onclick = () => modal.classList.remove('open');
    const qs = `from=${encodeURIComponent(_win.from)}&to=${encodeURIComponent(_win.to)}&cat=${encodeURIComponent(cat)}&lane=${encodeURIComponent(lane)}`;
    let d; try { d = await api('/api/screens-flow/journey-errors?' + qs); }
    catch (e) { card.querySelector('.sf-mdb').innerHTML = `<div class="albanner">${esc(e.message)}</div>`; return; }
    const CC = { technical: '#b91c1c', business: '#2563eb', customer: '#64748b', unknown: '#94a3b8' };
    const laneName = lane === 'mnp' ? 'MNP · port-in' : 'New SIM';
    // headline class strip — same business/technical split as everywhere else in the console
    const byCls = {};
    (d.reasons || []).forEach(r => { byCls[r.cls] = (byCls[r.cls] || 0) + r.n; });
    const clsTot = Object.values(byCls).reduce((a, n) => a + n, 0) || 1;
    const clsStrip = Object.entries(byCls).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
      `<span class="sf-cls" style="--c:${CC[k] || '#64748b'}"><b>${esc(k)}</b> ${fmt(n)} · ${(100 * n / clsTot).toFixed(1)}%</span>`).join('');
    const reasonsTbl = (d.reasons || []).length ? `<table class="sf-tbl"><thead><tr>
        <th>Reason</th><th>Class</th><th class="r">Count</th><th class="r">Share</th></tr></thead><tbody>
      ${d.reasons.map(r => `<tr><td>${esc(r.reason)}</td>
        <td><span class="sf-ccode" style="background:${CC[r.cls] || '#64748b'}">${esc(r.cls)}</span></td>
        <td class="r"><b>${fmt(r.n)}</b></td><td class="r">${r.pct}%</td></tr>`).join('')}
    </tbody></table>` : `<div class="sf-empty">No classified reasons available for this window.</div>`;
    const cols = JCOLS[cat] || JCOLS.eligibility;
    const rowsTbl = `<table class="sf-tbl"><thead><tr>${cols.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>
      ${(d.rows || []).map(r => `<tr>${cols.map(c => {
        const v = r[c[0]]; const txt = c[2] ? c[2](v) : (v == null || v === '' ? '—' : String(v));
        return `<td class="${c[3] || ''}">${esc(txt)}</td>`;
      }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}">Nothing in this bucket for the window.</td></tr>`}
    </tbody></table>`;
    card.innerHTML = `<div class="sf-md">
      <div class="sf-mdh"><b>${esc(laneName)} — ${esc(d.title || cat)}</b>
        <span class="sf-mdsub">${esc(ksa(d.from))} → ${esc(ksa(d.to))} <b>KSA</b> ·
          <b style="color:var(--bad-fg)">${fmt(d.total || 0)}</b> in window</span>
        <span class="x" id="sfX">✕</span></div>
      <div class="sf-mdb">
        <div class="sf-empty" style="margin-bottom:8px">${esc(d.desc || '')}
          ${(d.notes || []).map(n => `<br>· ${esc(n)}`).join('')}</div>
        <div class="sf-clsrow">${clsStrip}
          <button id="sfXlsx" class="sf-xlsx" title="Download everything in this popup">Export to Excel</button></div>
        <div class="sf-mdt">Why — count and share per reason</div>${reasonsTbl}
        <div class="sf-mdt">Most recent ${(d.rows || []).length} rows (masked)</div>${rowsTbl}
      </div></div>`;
    card.querySelector('#sfX').onclick = () => modal.classList.remove('open');
    const xbtn = card.querySelector('#sfXlsx');
    if (xbtn) {
      if (!window.opsXlsx) xbtn.remove();
      else xbtn.onclick = () => window.opsXlsx.save([
        { name: 'Summary', cols: ['field', 'value'], rows: [
          { field: 'Journey', value: `${laneName} — ${d.title || cat}` },
          { field: 'From (KSA)', value: ksa(d.from, true) }, { field: 'To (KSA)', value: ksa(d.to, true) },
          { field: 'Total in window', value: Number(d.total) || 0 },
          { field: 'Notes', value: (d.notes || []).join(' | ') },
          { field: 'Exported', value: ksa(new Date().toISOString(), true) + ' KSA' }] },
        { name: 'Reasons', cols: ['reason', 'class', 'count', 'share_pct'],
          rows: (d.reasons || []).map(r => ({ reason: r.reason, class: r.cls, count: r.n, share_pct: r.pct })) },
        { name: 'Rows', cols: cols.map(c => c[0]),
          rows: (d.rows || []).map(r => { const o = {}; cols.forEach(c => {
            o[c[0]] = c[2] ? c[2](r[c[0]]) : (r[c[0]] == null ? '' : String(r[c[0]])); }); return o; }) },
      ], `salam_${cat}_${lane}_${String(d.from).slice(0, 10)}`, {
        source: 'screens-flow journey-errors', cat, lane,
        window_ksa: `${ksa(d.from, true)} to ${ksa(d.to, true)}`, total: Number(d.total) || 0 });
    }
  }

  async function openPaymentDetail(id, row, back) {
    const modal = document.getElementById('panelModal'), card = document.getElementById('panelModalCard');
    const money = v => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' SAR';
    const head = body => `<div class="sf-md">
      <div class="sf-mdh"><button class="sf-btn" id="sfBack">‹ back to failures</button>
        <b>Payment</b><span class="sf-mdsub mono">${esc((row && row.ref) || id)}</span>
        ${row ? `<span class="sf-mdsub">${esc(KT.dts(row.created_at))} ·
          ${money(row.amount)} · ${esc(row.rail || '—')} · ${esc(row.reason || '')}</span>` : ''}
        <span class="x" id="sfX">✕</span></div><div class="sf-mdb">${body}</div></div>`;
    card.style.maxWidth = '1120px';
    card.innerHTML = head('<div class="sf-mdt">correlating app · gateway · UPG…</div>');
    modal.classList.add('open');
    const wire = () => {
      const b = card.querySelector('#sfBack'); if (b) b.onclick = () => openRechargeErrors(back.flow, back.bucket, back.reason || '');
      const x = card.querySelector('#sfX'); if (x) x.onclick = () => modal.classList.remove('open');
    };
    wire();
    let d; try { d = await api('/api/screens-flow/payment/' + encodeURIComponent(id)); }
    catch (e) { card.innerHTML = head(`<div class="albanner">${esc(e.message)}</div>`); wire(); return; }
    const p = d.payment || {};
    const kv = o => `<table class="sf-tbl"><tbody>${Object.entries(o).map(([k, v]) =>
      `<tr><td style="width:190px;color:var(--muted)">${esc(k)}</td><td class="${/id|ref|url/i.test(k) ? 'mono' : ''}">${esc(v == null || v === '' ? '—' : v)}</td></tr>`).join('')}</tbody></table>`;
    const appRows = d.app || [];
    const ph = d.platformAtTime;
    const healthLine = ph ? `<div class="sf-mdnote">Platform at that moment (${esc(ph.window)}): ${fmt(ph.total)} API calls captured ·
        <b style="color:${ph.technical ? 'var(--bad-fg)' : 'inherit'}">${fmt(ph.technical)}</b> technical · ${fmt(ph.business)} business.
        These are platform-wide counts, not this payment's calls.</div>` : '';
    const appTbl = (appRows.length ? `<div class="sf-mdnote" style="margin:0 0 6px">Linked by: ${esc(d.appLinkedBy || 'identifier match')}</div>
      <table class="sf-tbl"><thead><tr><th>When (KSA)</th><th>Endpoint</th><th>Code</th>
        <th>Message</th><th class="r">ms</th><th>Transaction</th></tr></thead><tbody>
      ${appRows.map(a => `<tr class="${a.err_class === 'technical' ? 'on' : ''}">
        <td>${esc(KT.dts(a.ts))}</td><td class="mono">${esc(a.path || '—')}</td>
        <td><b>${esc(a.response_code || '—')}</b></td><td>${esc(a.response_message || '—')}</td>
        <td class="r">${a.duration_ms == null ? '—' : fmt(a.duration_ms)}</td>
        <td class="mono">${esc(a.transaction_id || '—')}</td></tr>`).join('')}</tbody></table>`
      : `<div class="sf-empty">${esc(d.appError || d.appNote || 'No API-log line can be linked to this payment.')}</div>`) + healthLine;
    const g = (d.gateway && d.gateway.gateway) || {}, spans = g.spans || [];
    const gwTbl = spans.length ? `<table class="sf-tbl"><thead><tr><th>Service</th><th>Operation / path</th><th>Method</th>
        <th>Status</th><th class="r">ms</th></tr></thead><tbody>
      ${spans.map(s => `<tr class="${(s.status && +s.status >= 400) || s.error ? 'on' : ''}">
        <td>${esc(s.service || '—')}</td><td class="mono">${esc(s.path || s.name || '—')}</td>
        <td>${esc(s.method || '—')}</td><td>${esc(s.status || (s.error ? 'error' : '—'))}</td>
        <td class="r">${s.duration_ms == null ? '—' : fmt(s.duration_ms)}</td></tr>`).join('')}</tbody></table>
      <div class="sf-mdnote">Trace source: ${esc(g.source || 'stored')}</div>`
      : `<div class="sf-empty">${d.txn ? 'No gateway span matched transaction ' + esc(d.txn)
          : 'No transaction id is linked to this payment, so a gateway trace cannot be resolved. Payments are created by the hosted payment page, which does not pass through the Digital API capture — use the UPG tiers below, which are matched exactly on the payment reference.'}</div>`;
    const prs = (d.payloads && d.payloads.rows) || [];
    const payHtml = prs.length ? prs.map(x => `<div class="sf-ex">
        <div class="sf-exh"><span class="m">${esc(x.method || 'POST')}</span><span class="mono u">${esc(x.path || '')}</span>
          <span class="sf-mdsub">${x.duration ? esc(x.duration) + ' ms' : ''} ${x.response_date ? '· ' + esc(x.response_date) : ''} · ${esc(x.host || '')}</span></div>
        <div class="sf-exg">
          <div><div class="sf-exl">Request body</div><pre class="sf-json">${x.request_body != null ? jsonHi(x.request_body) : '<span class="jb">no body captured</span>'}</pre></div>
          <div><div class="sf-exl">Response body</div><pre class="sf-json">${x.response_body != null ? jsonHi(x.response_body) : '<span class="jb">no body captured</span>'}</pre></div>
        </div></div>`).join('')
      : `<div class="sf-empty">${esc((d.payloads && (d.payloads.note || d.payloads.error)) || 'No request/response body captured for this payment.')}</div>`;
    const u = d.upg;
    const upgHtml = Array.isArray(u) && u.length ? `<table class="sf-tbl"><thead><tr><th>#</th><th>When (KSA)</th>
        <th>Status</th><th>Rail</th><th>Method</th><th class="r">Amount</th><th>Code</th><th>Acquirer answer</th><th>Charge id</th></tr></thead><tbody>
      ${u.map((x, i) => `<tr class="${String(x.status).toUpperCase() === 'PAID' ? '' : 'on'}">
        <td>${i + 1}</td><td>${esc(KT.dts(x.created_at))}</td>
        <td><b>${esc(x.status || '—')}</b></td><td>${esc(x.source || '—')}</td><td>${esc(x.method || x.pay_method || '—')}</td>
        <td class="r">${x.amount == null ? '—' : (Number(x.amount) / 100).toFixed(2) + ' SAR'}</td>
        <td>${x.gw_code ? `<span class="sf-ccode" style="background:#b91c1c">${esc(x.gw_code)}</span>` : '—'}</td>
        <td>${esc(x.bank_message || x.gw_msg || '(no message)')}</td>
        <td class="mono">${esc(x.transaction_id || '—')}</td></tr>`).join('')}
      </tbody></table>
      <div class="sf-mdnote">One row per attempt at the gateway — retries appear here even when the app records a single payment. Amounts converted from halalas. When the bank message is blank the acquirer answer is read from the raw charge object.</div>`
      : `<div class="sf-empty">${esc((u && u.error) || 'No record for this reference at the UPG gateway — the payment never reached it.')}</div>`;
    // ⑥ the complete charge object(s) — key facts first, then the full JSON
    const gpay = d.upgPayload || {};
    const dig = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
    const chargeHtml = (gpay.rows || []).length ? (gpay.rows || []).map((x, i) => {
      const P = x.gateway_payload || {};
      const facts = {
        'charge id': P.id || x.transaction_id, 'status': P.status || x.status,
        'response code': dig(P, 'gateway.response.code'), 'response message': dig(P, 'gateway.response.message'),
        'payment method': dig(P, 'source.payment_method') || x.method,
        'source type': dig(P, 'source.type'), 'channel': dig(P, 'source.channel'),
        'amount': (P.amount != null ? P.amount + ' ' + (P.currency || '') : null),
        'receipt': dig(P, 'receipt.id'), 'merchant': dig(P, 'merchant.id'),
        'webhook': dig(P, 'post.status') ? `${dig(P, 'post.status')} → ${dig(P, 'post.url') || ''}` : null,
      };
      const rows = Object.entries(facts).filter(([, v]) => v != null && v !== '');
      return `<div class="sf-ex">
        <div class="sf-exh"><span class="m" style="background:${String(x.status).toUpperCase() === 'PAID' ? '#0e9f5a' : 'var(--bad-fg)'}">${esc(x.status || 'attempt')}</span>
          <span class="mono u">${esc(x.transaction_id || x.id || ('attempt ' + (i + 1)))}</span>
          <span class="sf-mdsub">${esc(KT.dts(x.created_at))} ·
            ${x.amount == null ? '' : (Number(x.amount) / 100).toFixed(2) + ' SAR'}</span></div>
        <div style="padding:10px">
          <div class="sf-facts">${rows.map(([k, v]) =>
            `<div class="sf-fact"><span>${esc(k)}</span><b class="${/code|id|url/i.test(k) ? 'mono' : ''}">${esc(v)}</b></div>`).join('')}</div>
          <details class="sf-det"><summary>full gateway_payload (exact JSON as UPG stored it)</summary>
            <pre class="sf-json">${jsonHi(P)}</pre></details>
        </div></div>`;
    }).join('')
      : `<div class="sf-empty">${esc(gpay.error || gpay.note || (gpay.supported === false ? 'This UPG deployment does not keep the raw charge object.' : 'No charge object stored for this reference.'))}</div>`;
    card.innerHTML = head(`
      <div class="sf-mdt">① Payment — what our app recorded</div>
      ${kv({ status: p.status, amount: money(p.amount), vendor: p.vendor, app: p.platform, rail: p.rail,
        method: p.method, reference: p.payment_reference_id, 'gateway payment id': p.gw_payment_id,
        'gateway snapshot status': p.gw_status, 'fail reason (app)': p.fail_reason,
        created: KT.dts(p.created_at || ''),
        updated: KT.dts(p.updated_at || '') })}
      <div class="sf-mdt">② App — Digital API calls linked to this payment</div>${appTbl}
      <div class="sf-mdt">③ API Gateway — trace${d.txn ? ` · transaction <span class="mono">${esc(d.txn)}</span>` : ''}</div>${gwTbl}
      <div class="sf-mdt">④ Request / response bodies</div>${payHtml}
      <div class="sf-mdt">⑤ UPG gateway — every attempt on this reference</div>${upgHtml}
      <div class="sf-mdt">⑥ Complete charge object — exactly what the gateway stored</div>${chargeHtml}
      <div class="sf-mdnote">Correlation keys: payment reference ⇄ UPG invoice id · API-log transaction id ⇄ gateway trace. Headers and tokens are never returned.</div>`);
    wire();
  }

  /* ---- one transaction, end to end, inside the same modal ------------------------------- */
  const jsonHi = v => {
    let s; try { s = JSON.stringify(v, null, 2); } catch (_) { s = String(v); }
    return esc(s)
      .replace(/&quot;([^&]+)&quot;(\s*:)/g, '<span class="jk">"$1"</span>$2')
      .replace(/:\s&quot;([^&]*)&quot;/g, ': <span class="js">"$1"</span>')
      .replace(/:\s(-?\d+\.?\d*)/g, ': <span class="jn">$1</span>')
      .replace(/:\s(true|false|null)/g, ': <span class="jb">$1</span>');
  };
  const ms = v => v == null ? '—' : fmt(v) + ' ms';
  async function openTxnDetail(txn, row, backCode) {
    const modal = document.getElementById('panelModal'), card = document.getElementById('panelModalCard');
    const head = (extra) => `<div class="sf-md">
      <div class="sf-mdh"><button class="sf-btn" id="sfBack">‹ back to failures</button>
        <b>Transaction</b><span class="sf-mdsub mono">${esc(txn)}</span>
        ${row ? `<span class="sf-mdsub">${esc(KT.dts(row.ts))} ·
          code <b>${esc(row.code)}</b> · ${esc(row.msg)} · ${ms(row.duration_ms)}</span>` : ''}
        <span class="x" id="sfX">✕</span></div>
      <div class="sf-mdb">${extra}</div></div>`;
    card.style.maxWidth = '1120px';
    card.innerHTML = head('<div class="sf-mdt">loading the end-to-end trace…</div>');
    modal.classList.add('open');
    const wire = () => {
      const b = card.querySelector('#sfBack'); if (b) b.onclick = () => openVoucherErrors(backCode || '');
      const x = card.querySelector('#sfX'); if (x) x.onclick = () => modal.classList.remove('open');
    };
    wire();
    const [tr, pl] = await Promise.all([
      api('/api/apigw/txn/' + encodeURIComponent(txn)).catch(e => ({ error: e.message })),
      api('/api/apigw/txn/' + encodeURIComponent(txn) + '/payloads').catch(e => ({ error: e.message })),
    ]);
    // ① app tier — what the Digital API logged
    const appRows = (tr && tr.app) || [];
    const appTbl = appRows.length ? `<table class="sf-tbl"><thead><tr><th>When (KSA)</th><th>Endpoint</th>
        <th>Code</th><th>Message</th><th class="r">ms</th><th>Host</th></tr></thead><tbody>
      ${appRows.map(a => `<tr><td>${esc(KT.dts(a.ts))}</td>
        <td class="mono">${esc(a.path || '—')}</td><td><b>${esc(a.response_code || '—')}</b></td>
        <td>${esc(a.response_message || '—')}</td><td class="r">${ms(a.duration_ms)}</td>
        <td>${esc(a.host || '—')}</td></tr>`).join('')}</tbody></table>`
      : `<div class="sf-empty">${esc((tr && tr.appError) || 'No application-tier log line for this transaction.')}</div>`;
    // ② gateway tier — Zipkin spans
    const g = (tr && tr.gateway) || {}, spans = g.spans || [];
    const gwTbl = spans.length ? `<table class="sf-tbl"><thead><tr><th>Service</th><th>Operation / path</th>
        <th>Method</th><th>Status</th><th class="r">ms</th></tr></thead><tbody>
      ${spans.map(s => `<tr class="${(s.status && +s.status >= 400) || s.error ? 'on' : ''}">
        <td>${esc(s.service || '—')}</td><td class="mono">${esc(s.path || s.name || '—')}</td>
        <td>${esc(s.method || '—')}</td><td>${esc(s.status || (s.error ? 'error' : '—'))}</td>
        <td class="r">${ms(s.duration_ms != null ? s.duration_ms : s.duration)}</td></tr>`).join('')}</tbody></table>
      <div class="sf-mdnote">Trace source: ${esc(g.source || 'stored')}</div>`
      : `<div class="sf-empty">No gateway span matched this transaction${g.source ? ' (' + esc(g.source) + ')' : ''}. The API gateway does not tag voucher transaction ids; the app-tier call above is authoritative.</div>`;
    // ③ the payloads — the actual request and response bodies
    const prs = (pl && pl.rows) || [];
    const payHtml = prs.length ? prs.map(p => `<div class="sf-ex">
        <div class="sf-exh"><span class="m">${esc(p.method || 'POST')}</span>
          <span class="mono u">${esc(p.path || '')}</span>
          <span class="sf-mdsub">${p.duration ? esc(p.duration) + ' ms' : ''} ${p.response_date ? '· ' + esc(p.response_date) : ''} · ${esc(p.host || '')}</span></div>
        <div class="sf-exg">
          <div><div class="sf-exl">Request body</div><pre class="sf-json">${p.request_body != null ? jsonHi(p.request_body) : '<span class="jb">no body captured</span>'}</pre></div>
          <div><div class="sf-exl">Response body</div><pre class="sf-json">${p.response_body != null ? jsonHi(p.response_body) : '<span class="jb">no body captured</span>'}</pre></div>
        </div></div>`).join('')
      : `<div class="sf-empty">${esc((pl && (pl.note || pl.error)) || 'No payload captured for this transaction.')}
         ${pl && pl.configured === false ? ' (API log collector not configured)' : ''}</div>`;
    // ④ integration / BSS tier
    const u = tr && tr.uil;
    const uilHtml = u && u.rows && u.rows.length
      ? `<pre class="sf-json">${jsonHi(u.rows)}</pre>`
      : `<div class="sf-empty">${esc((u && (u.note || u.error)) || 'No integration-layer (uil_logs) row for this transaction.')}</div>`;
    card.innerHTML = head(`
      <div class="sf-mdt">① App — Digital API (what the customer's app called)</div>${appTbl}
      <div class="sf-mdt">② API Gateway — trace</div>${gwTbl}
      <div class="sf-mdt">③ Request / response — the voucher call as it was sent and answered</div>${payHtml}
      <div class="sf-mdt">④ Integration layer / BSS</div>${uilHtml}
      <div class="sf-mdnote">Bodies are read from the API logger on the Digital API hosts. Headers and tokens are never returned; digits in messages are masked unless PII unmask is granted.</div>`);
    wire();
  }

  window.screensFlowRender = async function (host, R) {
    cssOnce();
    let win;
    if (R && R.from && R.to) win = { from: R.from, to: R.to };
    else { const d = new Date(); d.setUTCMinutes(0, 0, 0); d.setUTCHours(d.getUTCHours() + 1); win = { to: d.toISOString(), from: new Date(d.getTime() - ((R && R.hours) || 24) * 3600e3).toISOString() }; }
    _win = win;
    let data, qa = null;
    const qs = `from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`;
    // quick-actions is fetched alongside, never instead: if it fails the four existing lanes
    // still render, with the error shown as that lane's note rather than a blank panel.
    try {
      [data, qa] = await Promise.all([
        api(`/api/screens-flow?${qs}`),
        api(`/api/screens-flow/quick-actions?${qs}`).catch(e => ({ flows: [], note: 'Quick Actions unavailable: ' + e.message })),
      ]);
    }
    catch (e) { host.innerHTML = `<div class="sf-panel"><div class="albanner">${esc(e.message)}</div></div>`; return; }
    const pre = data.prepaid || { flows: [] }, post = data.postpaid || { flows: [] };
    // onboarding lanes come back as {steps, apollo} — Apollo (reseller API) is excluded from
    // the funnel and shown as lane context, so the numbers are Salam direct sales only.
    const ns = data.newsim && data.newsim.steps ? data.newsim : { steps: data.newsim || [], apollo: null };
    const mn = data.mnp && data.mnp.steps ? data.mnp : { steps: data.mnp || [], apollo: null };
    const apChip = a => (a && a.orders)
      ? `<span class="sf-vchip sf-ap">excluded · Apollo reseller API <b>${fmt(a.orders)}</b> orders (${a.share}% of ${fmt(a.all_orders)}) · <b>${fmt(a.activated)}</b> activated</span>` : '';
    const LANES = [
      { name: 'New SIM', state: 'not logged in', color: '#0e9f5a', j: 'ns', endWord: 'activated', steps: ns.steps, errSteps: ns.errSteps, extra: apChip(ns.apollo), direct: true },
      { name: 'MNP · port-in', state: 'not logged in', color: '#0d9488', j: 'mnp', endWord: 'activated', steps: mn.steps, errSteps: mn.errSteps, extra: apChip(mn.apollo), direct: true },
      { name: 'Prepaid', state: 'logged in', color: '#2563eb', flows: pre.flows, note: pre.note },
      { name: 'Postpaid', state: 'logged in', color: '#7c3aed', flows: post.flows, note: post.note },
      // the seven guest journeys of the web app's landing page — one row each, same window
      { name: 'Quick Actions', state: 'not logged in', color: '#d97706',
        flows: (qa && qa.flows) || [], note: qa && qa.note },
    ];
    // a lane with no flows AND no steps has nothing to draw — show its note (the fetch error)
    // as a plain line instead of an empty funnel header
    const laneOrNote = L => (L.flows && L.flows.length) || (L.steps && L.steps.length)
      ? laneHtml(L, L.extra)
      : (L.note ? `<div class="sf-lane-wrap"><div class="sf-lhead">
           <span class="sf-dot" style="background:${L.color}"></span>
           <span class="sf-ltitle" style="color:${L.color}">${esc(L.name)}</span>
           <span class="sf-note" style="margin:0">${esc(L.note)}</span></div></div>` : '');
    host.innerHTML = `<div class="sf-panel">
      ${LANES.map(laneOrNote).join('')}
      <div class="sf-note">Counts = customers whose data proves they reached the step (order, eligibility, payment and activation milestones) — the app records no screen views.
      Screen artwork lives in assets/screens/ (${'<journey>'}_${'<step>'}.png) and is replaced by the Figma exports without any code change.</div>
    </div>`;
    hydrateImages(host);
    laneNav(host);
    host.querySelectorAll('.sf-shot.sf-click').forEach(el => el.addEventListener('click', () => {
      if (el.dataset.drill === 'voucher-errors') openVoucherErrors('');
      else if (el.dataset.drill === 'recharge-errors') {
        const [flow, bucket] = String(el.dataset.arg || 'recharge:declined').split(':');
        openRechargeErrors(flow, bucket, '');
      } else if (el.dataset.drill === 'journey-errors') {
        const [cat, lane] = String(el.dataset.arg || 'eligibility:newsim').split(':');
        openJourneyErrors(cat, lane);
      }
    }));
  };
})();
