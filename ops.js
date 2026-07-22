/* Ops layer: sessions/roles, PII governance, Error Control Board, transaction
 * timelines, and Settings (sync engine + user management). Talks to the console API. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const el = (t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  // robust timestamp formatter → KSA (UTC+3) — tolerates ISO strings, Dates, epoch, or junk
  const fmtTs = (v, secs) => { if(v==null||v==="") return "—"; const d=new Date(v); if(isNaN(d.getTime())) return esc(String(v));
    const s=new Date(d.getTime()+3*3600e3).toISOString().replace("T"," "); return (secs? s.slice(0,19): s.slice(0,16))+" KSA"; };
  const API = (location.protocol==="file:") ? "http://localhost:4600" : "";
  // branded loader — Salam-green hourglass (draining sand) + spinner ring
  const salamLoader = (msg) => `<div class="salam-loader">
    <div class="sl-stage">
      <svg class="sl-ring" viewBox="0 0 104 104"><circle cx="52" cy="52" r="46"/></svg>
      <svg class="sl-hg" viewBox="0 0 60 84" aria-hidden="true">
        <defs><linearGradient id="slSand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#93d64f"/><stop offset="1" stop-color="#1f9e57"/></linearGradient></defs>
        <g class="sl-hgflip">
          <path class="sl-frame" d="M13 6H47M13 78H47M15 6C15 30 45 30 45 42 45 54 15 54 15 78M45 6C45 30 15 30 15 42 15 54 45 54 45 78"/>
          <path class="sl-sand-top" d="M18 10H42L30 39Z"/>
          <path class="sl-sand-bot" d="M30 45 43 74H17Z"/>
          <line class="sl-stream" x1="30" y1="40" x2="30" y2="52"/>
        </g>
      </svg>
    </div>
    <div class="sl-cap">${msg||"Loading…"}</div></div>`;
  window.salamLoader = salamLoader;
  // tiny JSON syntax highlighter for req/res blocks (matches the .codeblk token colors)
  function jsonHi(v){ let s; try{ s=JSON.stringify(v,null,2); }catch(e){ s=String(v); }
    return esc(s)
      .replace(/(&quot;|")(\\.|[^"\\])*?\1(\s*:)?/g, m=> /:\s*$/.test(m) ? `<span class="k">${m}</span>` : `<span class="s">${m}</span>`)
      .replace(/\b(true|false|null)\b/g, '<span class="b">$1</span>')
      .replace(/(^|[\s:\[,])(-?\d+(?:\.\d+)?)/g, '$1<span class="n">$2</span>'); }

  // ---- session ----
  const SES = { email: localStorage.getItem('cons_email')||"", role: localStorage.getItem('cons_role')||"super_admin", me:null };
  // inject role headers into every API call (also covers alertsview.js)
  const _fetch = window.fetch.bind(window);
  window.fetch = async (url, opts={})=>{
    if(typeof url==="string" && (url.includes("/api/"))){
      opts.headers = Object.assign({}, opts.headers, { "X-Console-Role": SES.role, "X-Console-User": SES.email||"" });
    }
    let r = await _fetch(url, opts);
    // self-heal: if a rate limit is ever hit, wait out Retry-After (capped) and retry once
    if(r.status===429 && typeof url==="string" && url.includes("/api/")){
      const wait = Math.min(2000, (Number(r.headers.get("Retry-After"))||1)*1000);
      await new Promise(res=>setTimeout(res, wait));
      r = await _fetch(url, opts);
    }
    return r;
  };
  async function api(path, opts){ const r=await _fetch(API+path, Object.assign({headers:{"Content-Type":"application/json","X-Console-Role":SES.role,"X-Console-User":SES.email||""}}, opts)); if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||("HTTP "+r.status)); return r.json(); }

  const ROLE_LABELS = {super_admin:"Super Admin",admin:"Admin",report_manager:"Report Manager",errors_manager:"Errors Manager",events_manager:"Events Manager",
    l1_bss:"L1 BSS",l2_bss:"L2 BSS",l1_digital:"L1 Digital",l2_digital:"L2 Digital",l3_digital:"L3 Digital"};

  // ---- export helper (CSV / JSON), shared globally ----
  function toCSV(rows){ const cols=[...new Set(rows.flatMap(r=>Object.keys(r)))];
    const q=v=>{ v=v==null?"":typeof v==="object"?JSON.stringify(v):String(v); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
    return [cols.join(","),...rows.map(r=>cols.map(c=>q(r[c])).join(","))].join("\n"); }
  function download(content,name,type){ const b=new Blob([content],{type}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(u),1000); }
  window.opsExport = function(rows,name,anchor){
    if(!rows||!rows.length){ return; }
    document.querySelectorAll(".export-menu").forEach(m=>m.remove());
    const menu=el("div","export-menu",`<button data-f="csv">⤓ Download CSV</button><button data-f="json">⤓ Download JSON</button>`);
    document.body.appendChild(menu);
    const r=anchor?anchor.getBoundingClientRect():{bottom:56,left:56};
    menu.style.top=(r.bottom+6)+"px"; menu.style.left=Math.min(r.left,window.innerWidth-190)+"px";
    menu.querySelector('[data-f=csv]').onclick=()=>{ download(toCSV(rows),name+".csv","text/csv"); menu.remove(); };
    menu.querySelector('[data-f=json]').onclick=()=>{ download(JSON.stringify(rows,null,2),name+".json","application/json"); menu.remove(); };
    setTimeout(()=>document.addEventListener("click",function h(e){ if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener("click",h); } }),50);
  };
  window.opsCan = c => can(c);
  window.opsSession = () => SES;   // { email, role, me:{name,mobile,dashboard,...} }
  const NAV_VIEW = { topology:"topology", explorer:"journeys", integrations:"integrations", alerts:"alerts", errors:"errors", analytics:"analytics", slo:"analytics", sub360:"errors", settings:"settings" };

  async function loadMe(){
    try { SES.me = await api("/api/me"); SES.role = SES.me.role; }
    catch(e){ SES.me = { role:SES.role, views:["topology","journeys","integrations","alerts","errors","dashboards","settings"], caps:{} }; }
    applyScope(); renderChip(); applyFeatureFlags();
    document.dispatchEvent(new CustomEvent("consoleReady"));
  }
  // interface feature flags from the server (e.g. hide the AR/EN language switch)
  function applyFeatureFlags(){
    const f = (SES.me && SES.me.features) || {};
    const langBtn = document.getElementById("langToggle");
    if(langBtn){
      const on = f.langSwitch === true;
      langBtn.style.display = on ? "" : "none";
      if(!on && window.i18n && window.i18n.lang !== "en") window.i18n.setLang("en", true);   // force English when the switch is off
    }
  }
  window.opsApplyFeatureFlags = applyFeatureFlags;
  function can(c){ return SES.me && SES.me.caps && SES.me.caps[c]; }
  function applyScope(){
    const views = (SES.me&&SES.me.views)||[];
    document.querySelectorAll(".navtab").forEach(b=>{
      if(b.dataset.view==="home"){ b.classList.remove("hidden"); return; }  // Dashboard is visible to everyone
      const v = NAV_VIEW[b.dataset.view];
      b.classList.toggle("hidden", !views.includes(v));
    });
    // if current active tab is hidden, jump to first visible
    const active = document.querySelector(".navtab.active");
    if(active && active.classList.contains("hidden")){
      const first = document.querySelector(".navtab:not(.hidden)"); if(first) first.click();
    }
    // hide users panel unless manageUsers
    const up = $("#usersPanel"); if(up) up.style.display = can("manageUsers")?"":"none";
    // settings gear visibility by role
    const gear = document.getElementById("settingsBtn"); if(gear) gear.style.display = views.includes("settings")?"":"none";
    // audit log — super admin only
    const am = document.getElementById("auditMenuItem"); if(am) am.style.display = (SES.me && SES.me.realRole==="super_admin")?"":"none";
  }
  function displayName(){ return (SES.me&&SES.me.name) || (SES.email? SES.email.split("@")[0] : "Sign in"); }
  function renderChip(){
    const c = $("#userChip"); if(!c) return;
    const who = displayName();
    const init = (who&&who[0]? who[0] : "?").toUpperCase();
    c.innerHTML = `<span class="av">${esc(init)}</span><span>${esc(who)}</span>`;
  }

  // ---- role sign-in / switch modal ----
  function openRoleModal(){
    const card = $("#roleModalCard");
    const isSuper = SES.me && SES.me.realRole === 'super_admin';
    const nm = displayName();
    card.innerHTML = `<div class="modal-head"><span class="path">Account</span><span class="x" id="rmX">×</span></div>
      <div class="modal-body">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="av" style="width:38px;height:38px;border-radius:50%;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">${esc((nm||'?')[0].toUpperCase())}</span>
          <div><div style="font-weight:700">${esc(nm)}</div><div class="rl" style="color:var(--muted);font-size:11px">${esc(ROLE_LABELS[SES.role]||SES.role)}${isSuper&&SES.role!=='super_admin'?' · previewing':''} · ${esc(SES.email||'')}</div></div>
        </div>
        <h5 style="margin-top:16px">MY PROFILE</h5>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><label style="font-size:9.5px;letter-spacing:1px;color:var(--muted);font-weight:800">NAME</label><input id="pfName" class="jsearch" style="width:100%" value="${esc((SES.me&&SES.me.name)||'')}" placeholder="Full name"></div>
          <div><label style="font-size:9.5px;letter-spacing:1px;color:var(--muted);font-weight:800">MOBILE</label><input id="pfMobile" class="jsearch" style="width:100%" value="${esc((SES.me&&SES.me.mobile)||'')}" placeholder="05x xxx xxxx"></div>
        </div>
        <div style="text-align:right;margin-top:8px"><button class="pill" id="pfSave" style="border-left-color:var(--green)">Save profile</button> <span id="pfMsg" class="rl"></span></div>
        ${isSuper?`<h5 style="margin-top:16px">PREVIEW AS ROLE <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(Super Admin only)</span></h5>
        <select id="rmRole" class="jsearch" style="width:100%">
          ${Object.keys(ROLE_LABELS).map(r=>`<option value="${r}" ${r===SES.role?'selected':''}>${ROLE_LABELS[r]}</option>`).join("")}
        </select>`:''}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
          <button class="pill" id="rmSignout" style="border-left-color:var(--red)">Sign out</button>
          ${isSuper?`<button class="pill" id="rmApply" style="border-left-color:var(--green)">Apply preview</button>`:''}
        </div>
      </div>`;
    $("#roleModal").classList.add("open");
    $("#rmX").onclick = ()=>$("#roleModal").classList.remove("open");
    $("#pfSave").onclick = async ()=>{
      const name=$("#pfName").value.trim(), mobile=$("#pfMobile").value.trim();
      try{ await api("/api/me",{method:"PATCH",body:JSON.stringify({name,mobile})});
        if(SES.me){ SES.me.name=name; SES.me.mobile=mobile; }
        renderChip(); $("#pfMsg").textContent="✓ saved";
      }catch(e){ $("#pfMsg").textContent=e.message; }
    };
    if(isSuper){
      $("#rmApply").onclick = async ()=>{
        SES.role = $("#rmRole").value; localStorage.setItem('cons_role',SES.role);
        $("#roleModal").classList.remove("open");
        await loadMe();
        const active=document.querySelector(".navtab:not(.hidden)"); if(active) active.click();
      };
    }
    $("#rmSignout").onclick = ()=>{ $("#roleModal").classList.remove("open"); _origSignout(); };
  }
  $("#roleModal").addEventListener("click",e=>{ if(e.target.id==="roleModal") $("#roleModal").classList.remove("open"); });

  // ================= ERROR CONTROL BOARD =================
  const errState = { window:24, team:"", category:"", q:"", lastFeed:[], sim:null, pinned:false, rangeKey:"range", codeFilter:"" };
  const CAT_COLOR = {payment:"#ea580c",activation:"#0d9488",semati:"#7c3aed",nafath:"#7c3aed",eligibility:"#2563eb",change_plan:"#0891b2",change_ownership:"#4f46e5",delivery:"#d97706"};
  // map each Troubleshoot error tile to the rule whose runbook best fits it (for the L1 triage panel)
  const CAT_RUNBOOK_RULE = {payment:"payment_fail_storm",payment_stuck:"payment_stuck_storm",payment_dup:"payment_duplicate",activation:"activation_fail_storm",semati:"semati_provider_down",nafath:"nafath_fail_storm",eligibility:"eligibility_deny_spike",change_plan:"change_plan_fail_spike",delivery:"delivery_fail_spike"};
  const CAT_RUNBOOK_FALLBACK = {change_ownership:"1) Troubleshoot → Change Ownership: open a failing case and read its detail (checkout_type 5). 2) Split cause: Nafath transfer-of-ownership step vs BSS ownership update. 3) If Nafath, check the identity path; if BSS, check the ownership API. 4) Escalate to Digital Ops L2 if systemic."};
  let _rbCache=null;
  function loadRuleRunbooks(){   // fetch once: rule.key -> runbook text
    if(_rbCache) return _rbCache;
    _rbCache=api("/api/rules").then(d=>{ const arr=(d&&d.rules)||[]; const m={}; arr.forEach(r=>{ if(r.runbook) m[r.key]=r.runbook; }); return m; })
      .catch(()=>{ _rbCache=null; return {}; });
    return _rbCache;
  }
  function rbSteps(text){   // split "1) .. 2) .." into <li> steps; fall back to one line
    const parts=String(text||"").split(/\s+(?=\d\)\s)/).map(s=>s.replace(/^\d\)\s*/,"").trim()).filter(Boolean);
    return (parts.length?parts:[String(text||"").trim()]).map(s=>`<li>${esc(s)}</li>`).join("");
  }
  function renderRunbookPanel(cat){
    const feed=$("#errFeed"); if(!feed||!feed.parentNode) return;
    let rb=document.getElementById("errRunbook");
    if(!rb){ rb=document.createElement("div"); rb.id="errRunbook"; feed.parentNode.insertBefore(rb, feed); }
    if(!cat){ rb.style.display="none"; rb.innerHTML=""; return; }
    const col=CAT_COLOR[cat]||"#64748b";
    rb.style.cssText=`display:block;margin:10px 0;padding:10px 14px;border-radius:10px;border-left:4px solid ${col};background:var(--card2,rgba(148,163,184,.08))`;
    rb.innerHTML=`<div style="font-weight:800;font-size:12px;letter-spacing:.02em;color:${col};margin-bottom:4px">▸ GUIDED RESPONSE</div><ol id="rbOl" style="margin:0 0 0 18px;padding:0;font-size:12.5px;line-height:1.5"><li>Loading runbook…</li></ol>${catReferenceHtml(cat,col)}`;
    const ruleKey=CAT_RUNBOOK_RULE[cat];
    loadRuleRunbooks().then(map=>{
      const text=(ruleKey&&map[ruleKey]) || CAT_RUNBOOK_FALLBACK[cat] || "Identify the dominant error code / vendor in the feed below, check the owning integration, and escalate to the owning team if it persists.";
      const ol=document.getElementById("rbOl"); if(ol) ol.innerHTML=rbSteps(text);
    });
  }
  // Per-category L1 / customer-care reference appended under the runbook steps (collapsible).
  function catReferenceHtml(cat,col){
    const row=(code,desc)=>`<tr><td style="padding:2px 10px 2px 0;white-space:nowrap;font-family:var(--mono);font-size:11.5px;color:${col};font-weight:700;vertical-align:top">${esc(code)}</td><td style="padding:2px 0;font-size:12px">${desc}</td></tr>`;
    if(cat==='payment') return paymentReferenceHtml(col,row);
    if(cat!=='nafath') return "";
    return `<details style="margin-top:10px;border-top:1px dashed var(--line,#e2e8f0);padding-top:8px">`+
      `<summary style="cursor:pointer;font-weight:800;font-size:11.5px;letter-spacing:.02em;color:${col}">NAFATH SERVICE TYPES & CUSTOMER-CARE REFERENCE</summary>`+
      `<div style="font-size:12px;line-height:1.55;margin-top:8px">`+
        `<div style="margin-bottom:6px">Each row's <b>service</b> field = what the customer was trying to do (identity is verified via Nafath or Absher — see <code>auth_type</code>):</div>`+
        `<table style="border-collapse:collapse;margin-bottom:8px"><tbody>`+
          row('new_mobile','Issue a new mobile number (new individual line)')+
          row('new_sim','Issue a new SIM / eSIM')+
          row('change_plan','Change plan type (prepaid ↔ postpaid)')+
          row('transfer_ownership_local','Transfer number ownership <b>within Salam</b> (both parties on Salam)')+
          row('transfer_ownership_global','Transfer number ownership <b>between networks</b> (from another operator)')+
        `</tbody></table>`+
        `<div style="margin-bottom:6px"><b>⚠ Ownership transfers</b> (<code>transfer_ownership_local/global</code>) are Nafath-authorized but are pulled into the <b>Change Ownership</b> tile — not this one. If a customer's ownership transfer failed, look under Change Ownership.</div>`+
        `<div style="margin-bottom:6px"><b>What the status means &amp; what to tell the customer:</b></div>`+
        `<table style="border-collapse:collapse;margin-bottom:8px"><tbody>`+
          row('expired','Customer did not approve in time — ask them to retry and approve in the <b>Nafath app</b> within the time window.')+
          row('rejected / denied','Approval was declined — check they are approving the right request under the correct national ID / Absher account.')+
          row('400-N069','A Nafath provider error — if the volume is rising it is provider-side, not the customer; escalate.')+
          row('400-N999','No / invalid response from Nafath — provider or transport issue; escalate, do not ask the customer to keep retrying.')+
        `</tbody></table>`+
        `<div><b>Provider note:</b> the Nafath authorize endpoint runs on the TCC / CITC platform (same as Semati), so a CITC outage can hit both — check the <b>CITC upstream</b> composite alert before blaming our side.</div>`+
      `</div></details>`;
  }
  // Payments L1 / RCA / UPG-correlation reference (Payment tile).
  function paymentReferenceHtml(col,row){
    const sub=t=>`<div style="font-weight:800;font-size:11px;letter-spacing:.02em;color:${col};margin:10px 0 4px">${t}</div>`;
    return `<details style="margin-top:10px;border-top:1px dashed var(--line,#e2e8f0);padding-top:8px">`+
      `<summary style="cursor:pointer;font-weight:800;font-size:11.5px;letter-spacing:.02em;color:${col}">PAYMENTS RCA · GATEWAYS · UPG CORRELATION · CUSTOMER-CARE REFERENCE</summary>`+
      `<div style="font-size:12px;line-height:1.55;margin-top:8px">`+
        `<div>The chips above group declines by <b>gateway code · message</b>. A single code surging across customers = a systemic gateway/UPG issue, not the customer. Codes come from <code>payment_commit_response.gateway.response</code> (UPG/salam) or <code>fail_reason</code> (hyperpay/tap).</div>`+

        sub('GATEWAYS / VENDORS (the <code>vendor</code> field)')+
        `<table style="border-collapse:collapse"><tbody>`+
          row('salam / merchalink','SalamPay via Merchalink = the <b>UPG</b> unified gateway. Real code·message in <code>payment_commit_response.gateway.response</code>. Webhook = Merchalink callback.')+
          row('hyperpay','HyperPay card gateway — reason is in <code>fail_reason</code>.')+
          row('tap','Tap Payments (3-D Secure card flow) — reason in <code>fail_reason</code>; Tap callback confirms capture.')+
          row('tamara / emkan','BNPL / instalment providers — declines often eligibility/limit, not card errors.')+
        `</tbody></table>`+

        sub('METHODS (<code>payment_method</code> / <code>card_type</code>)')+
        `<table style="border-collapse:collapse"><tbody>`+
          row('credit-card / mada','Card rails (mada = local debit). card_type: 1 credit · 2 mada · 0 Apple Pay · 3 Amex · 4 STC.')+
          row('samsung-pay','<b>NEW</b> (launched recently) — detected broadly (<code>payment_method</code>/<code>vendor</code> ~ samsung). Has its own P1/P2 alerts; confirm the exact tag from live data.')+
          row('apple-pay / stc-pay','Wallet rails — token/3DS issues show as gateway declines.')+
        `</tbody></table>`+

        sub('STATUSES & THE STUCK CASE')+
        `<table style="border-collapse:collapse"><tbody>`+
          row('pending / initiated','Not yet confirmed. Older than 30 min = <b>STUCK</b> → the UPG/Tap confirmation webhook never landed: the customer may be <b>charged while the app shows unpaid</b>. Do NOT ask them to pay again — reconcile by <code>payment_reference_id</code> (Payment Stuck tile).')+
          row('success','Captured.')+
          row('fail / failed','Declined — reason in the code·message chips above.')+
        `</tbody></table>`+

        sub('REPEATED CASES → WHAT TO TELL THE CUSTOMER')+
        `<table style="border-collapse:collapse"><tbody>`+
          row('Insufficient funds','Bank declined for balance — ask them to use another card/method.')+
          row('Incorrect CVV / expired / invalid card','Data error — retry with the correct card details.')+
          row('3DS / OTP / authentication failed','They did not complete the bank OTP — retry and complete the OTP prompt.')+
          row('Do not honor / restricted','Issuer declined — advise they contact their bank or try another card.')+
          row('Stuck (charged, app unpaid)','Reassure: do not pay again — it auto-reconciles or is refunded; escalate by ref if not resolved.')+
          row('Duplicate charge','Captured twice — refund the extra (Payment Duplicate tile).')+
          row('Samsung Pay failing','New method — have them try card/mada while we investigate; check the Samsung Pay alert.')+
        `</tbody></table>`+

        sub('UPG CORRELATION & PROACTIVE')+
        `<div style="margin-bottom:4px"><b>Join key:</b> <code>payment_reference_id</code> (MVNO) = the UPG transaction ref. The UPG gateway response (code, message) is already stored on the MVNO side in <code>payment_commit_response.gateway.response</code> — that is what the chips read, so most correlation needs no second DB.</div>`+
        `<div style="margin-bottom:4px">For settlement truth (captured vs not, refunds, webhook delivery), look the <code>payment_reference_id</code> up in the <b>UPG prod DB</b>; the Merchalink callback (<code>callbacks_controller#merchalink</code>) is the UPG webhook.</div>`+
        `<div><b>Proactive:</b> blended payment storms have their own P1/P2; Samsung Pay has dedicated P1/P2; and a single decline code surging in the chips is your earliest systemic-gateway signal — filter to it and correlate the ref against UPG.</div>`+
      `</div></details>`;
  }
  // categories that support a provider code·message breakdown filter, with the tile-appropriate heading
  const CODE_BREAKDOWN = {
    semati: { title: 'SEMATI FAILURES · responseCode · responseMessage' },
    nafath: { title: 'NAFATH FAILURES · status · message' },
    payment: { title: 'PAYMENT DECLINES · gateway code · message' }
  };
  // reflect the selected category into the URL so each Troubleshoot category is shareable
  // (#troubleshoot?cat=semati). replaceState → no reload / no hashchange loop.
  function reflectCatUrl(cat){
    try{ const h='#troubleshoot'+(cat?`?cat=${encodeURIComponent(cat)}`:''); if(location.hash!==h && history.replaceState) history.replaceState(null,'',h); }catch(e){}
  }
  // Semati/Nafath failures grouped by provider code · message — clickable to filter the feed.
  async function renderCodeBreakdown(){
    const feed=$("#errFeed"); if(!feed||!feed.parentNode) return;
    let host=document.getElementById("codeBreak");
    const cfg=CODE_BREAKDOWN[errState.category];
    if(!cfg){ if(host){ host.style.display="none"; host.innerHTML=""; } return; }
    const cat=errState.category;
    if(!host){ host=document.createElement("div"); host.id="codeBreak"; feed.parentNode.insertBefore(host, feed); }
    host.style.display="block";
    let d; try{ d=await api(`/api/errors/code-breakdown?category=${encodeURIComponent(cat)}&window=${errState.window}${errState.sim?`&sim=${encodeURIComponent(errState.sim)}`:''}`); }
    catch(e){ host.style.display="none"; host.innerHTML=""; return; }
    if(errState.category!==cat){ return; }   // a faster tile switch won this race — leave that render's output
    // guard against an older backend that doesn't know this category yet (would echo a fallback set):
    // only render when the response's category matches what we asked for.
    if(d && d.category && d.category!==cat){ host.style.display="none"; host.innerHTML=""; return; }
    const codes=(d&&d.codes)||[], total=(d&&d.total)||0;
    if(!codes.length){ host.style.display="none"; host.innerHTML=""; return; }
    const col=CAT_COLOR[cat]||"#64748b";
    const chip=(codeVal,msg,count,active)=>{
      const pct=total?Math.round(count*100/total):0;
      const base=`display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;border:1px solid ${col}44;font-size:12px;cursor:pointer`;
      const style=active?`${base};background:${col};color:#fff`:`${base};background:${col}12;color:var(--ink)`;
      return `<button class="codechip" data-code="${esc(String(codeVal))}" title="${esc(msg||'')}" style="${style}"><b>${esc(String(codeVal))}</b><span style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(msg||'—')}</span><span style="opacity:.8;font-weight:700">${count} · ${pct}%</span></button>`;
    };
    const allBase=`padding:5px 10px;border-radius:999px;border:1px solid var(--line);font-size:12px;cursor:pointer;font-weight:700`;
    host.innerHTML=`<div style="margin:10px 0;padding:10px 12px;border-radius:10px;border-left:4px solid ${col};background:var(--card2,rgba(148,163,184,.08))">`+
      `<div style="font-weight:800;font-size:12px;letter-spacing:.02em;color:${col};margin-bottom:7px">${cfg.title} <span class="rl" style="font-weight:600">(${total} in ${errState.window}h — click to filter)</span></div>`+
      `<div style="display:flex;flex-wrap:wrap;gap:6px">`+
      `<button class="codechip" data-code="" style="${allBase};${!errState.codeFilter?`background:var(--ink);color:var(--bg)`:`background:transparent;color:var(--muted)`}">All codes</button>`+
      codes.map(c=>chip(c.code,c.message,c.count,errState.codeFilter===String(c.code))).join("")+
      `</div></div>`;
    host.querySelectorAll(".codechip").forEach(b=>b.addEventListener("click",()=>{ errState.codeFilter=b.dataset.code||""; if(window.audit) window.audit("APPLY_FILTER",`troubleshoot:${cat}_code:`+(b.dataset.code||"all")); loadErrors(); }));
  }
  function syncErrRange(){ if(errState.pinned) return; const R=window.OPS_RANGE; if(R){ errState.window=R.hours; errState.sim=R.to||null; errState.rangeKey="range"; } }
  // dashboard-style quick window picker on the error board (local override of the global RANGE)
  function renderErrRange(){
    const host=document.getElementById("errRange"); if(!host) return;
    const ksaMid=()=>{ const s=new Date(Date.now()+3*3600e3); s.setUTCHours(0,0,0,0); return s.getTime()-3*3600e3; };
    const presets=[["range","Range"],["today","Today"],["yday","Yesterday"],["168","7d"],["720","30d"],["1","Last 1h"],["3","3h"],["6","6h"],["12","12h"],["24","24h"]];
    host.innerHTML=`<span class="rl" style="margin-right:4px">Window</span>`+presets.map(p=>`<button class="teamchip ${errState.rangeKey===p[0]?"active":""}" data-rk="${p[0]}">${p[1]}</button>`).join("");
    host.querySelectorAll("[data-rk]").forEach(b=>b.addEventListener("click",()=>{
      const k=b.dataset.rk; errState.rangeKey=k;
      if(k==="range"){ errState.pinned=false; }
      else { errState.pinned=true;
        if(k==="today"){ errState.window=Math.max(1,Math.ceil((Date.now()-ksaMid())/3600e3)); errState.sim=null; }
        else if(k==="yday"){ errState.window=24; errState.sim=new Date(ksaMid()).toISOString(); }
        else { errState.window=Number(k); errState.sim=null; } }
      loadErrors();
    }));
  }
  async function loadErrors(){
    syncErrRange();
    renderErrRange();
    const simQ = errState.sim?`&sim=${encodeURIComponent(errState.sim)}`:'';
    let sum;
    try { sum = await api(`/api/errors/summary?window=${errState.window}${simQ}${errState.team?`&team=${encodeURIComponent(errState.team)}`:''}`); }
    catch(e){ $("#errKpis").innerHTML=""; $("#errFeed").innerHTML=`<div class="albanner">Error board needs the console API. ${esc(e.message)}</div>`; return; }
    $("#errNow").textContent = sum.now ? ("as of "+new Date(new Date(sum.now).getTime()+3*3600e3).toISOString().replace('T',' ').slice(0,16)+" KSA") : "real-time";
    let tiles = sum.summary||[];
    { // shared nav config: hide + reorder the error category tiles
      const en=(window.uiNav?window.uiNav().errors:{order:[],hidden:[]});
      const hidden=new Set(en.hidden||[]);
      if(hidden.size) tiles=tiles.filter(t=>!hidden.has(t.category));
      if(en.order&&en.order.length){ const idx=c=>{ const i=en.order.indexOf(c); return i<0?999:i; };
        tiles=tiles.slice().sort((a,b)=>idx(a.category)-idx(b.category)); }
    }
    const total = tiles.reduce((a,t)=>a+t.total,0);
    $("#errKpis").innerHTML = `<div class="kpi ${errState.category===''?'active':''}" data-cat=""><b>${total}</b><span>ALL FAILURES · ${errState.window}h</span></div>`+
      tiles.map(t=>`<div class="kpi ${errState.category===t.category?'active':''}" data-cat="${t.category}" style="border-left:4px solid ${CAT_COLOR[t.category]||'#94a3b8'}"><span class="tm">${esc(t.team)}</span><b>${t.total}</b><span>${esc(t.label).toUpperCase()}</span></div>`).join("");
    $("#errKpis").querySelectorAll(".kpi").forEach(k=>k.addEventListener("click",()=>{ errState.category=k.dataset.cat; errState.codeFilter=""; reflectCatUrl(errState.category); loadErrors(); }));
    renderRunbookPanel(errState.category);   // L1 triage steps for the selected category
    renderCodeBreakdown();                   // Semati/Nafath code·message breakdown + filter
    // team filter chips
    const teams=[...new Set((tiles.length?tiles:[]).map(t=>t.team))];
    const allTeams=["BSS Ops","Digital Ops","Sales Ops","OSS Ops"];
    $("#errTeamFilter").innerHTML = `<button class="teamchip ${errState.team===''?'active':''}" data-team="">All teams</button>`+
      allTeams.map(t=>`<button class="teamchip ${errState.team===t?'active':''}" data-team="${t}">${esc(t)}</button>`).join("");
    $("#errTeamFilter").querySelectorAll(".teamchip").forEach(c=>c.addEventListener("click",()=>{ errState.team=c.dataset.team; loadErrors(); }));
    // feed
    let feed;
    try { feed = await api(`/api/errors/feed?window=${errState.window}${simQ}${errState.category?`&category=${errState.category}`:''}${errState.team?`&team=${encodeURIComponent(errState.team)}`:''}${errState.q?`&q=${encodeURIComponent(errState.q)}`:''}${errState.codeFilter?`&code=${encodeURIComponent(errState.codeFilter)}`:''}&limit=120`); }
    catch(e){ $("#errFeed").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const rows = feed.feed||[];
    errState.lastFeed = rows;
    if(!rows.length){ $("#errFeed").innerHTML=`<div class="okbox" style="margin-top:8px">No failures match — try a wider window or clear filters.</div>`; return; }
    let h=`<table class="alerts"><tr><th>WHEN</th><th>CATEGORY</th><th>TEAM</th><th>IDENTIFIER</th><th>MOBILE</th><th>DETAIL</th><th></th></tr>`;
    rows.forEach(r=>{
      // order UUID is non-PII; identifier field is masked by the server for other ids
      const idShow = (r.order_id && /^[0-9a-f-]{8,}$/i.test(r.order_id)) ? r.order_id.slice(0,8)+'…' : (r.identifier||'—');
      h+=`<tr>
      <td class="mono" style="color:var(--muted);white-space:nowrap">${fmtTs(r.when)}</td>
      <td><span class="catpill" style="background:${(CAT_COLOR[r.category]||'#64748b')}22;color:${CAT_COLOR[r.category]||'#334155'}">${esc(r.category)}</span></td>
      <td>${esc(r.team)}</td>
      <td class="mono" style="font-size:10.5px">${esc(idShow)}</td>
      <td class="mono">${esc(r.mobile||'—')}</td>
      <td style="font-size:12px">${esc(r.detail||'')}</td>
      <td><button class="pill" data-row="${esc(r.id||'')}" data-oid="${esc(r.order_id||'')}" style="padding:4px 10px">Timeline →</button></td>
    </tr>`; });
    h+=`</table>`;
    $("#errFeed").innerHTML=h;
    $("#errFeed").querySelectorAll("[data-row]").forEach(b=>b.addEventListener("click",()=>openTimeline(b.dataset.oid||null, false, b.dataset.row)));
  }

  // ================= TRANSACTION TIMELINE DRAWER =================
  async function openTimeline(id, unmask=false, row=null, onBack=null){
    if(window.audit) window.audit(unmask?"VIEW_TRACE_UNMASKED":"VIEW_TRACE", String(row||id||"").slice(0,60));
    const ov=$("#txnDrawer"); ov.classList.add("open");
    const key = row ? `row=${encodeURIComponent(row)}` : `id=${encodeURIComponent(id||'')}`;
    const backBtn = onBack?`<button id="dwBack" style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.45);border-radius:8px;color:#fff;font-size:12px;font-weight:700;padding:4px 12px;cursor:pointer;margin-right:12px">‹ Back to list</button>`:'';
    const wireBack=()=>{ if(onBack){ const bb=document.getElementById("dwBack"); if(bb) bb.onclick=()=>onBack(); } };
    $("#txnDrawerBody").innerHTML=`<div class="drawer-hd">${backBtn}<b>Transaction timeline</b><span class="x" id="dwX">×</span></div><div class="tl">${salamLoader("Assembling the end-to-end timeline…<br><b>scanning payments · activation · Nafath · delivery · change plans</b>")}</div>`;
    $("#dwX").onclick=()=>ov.classList.remove("open"); wireBack();
    let tl;
    try { tl=await api(`/api/transaction?${key}${unmask?'&unmask=1':''}`); }
    catch(e){ $("#txnDrawerBody").querySelector(".tl").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const o=tl.order;
    const events = Array.isArray(tl.events) ? tl.events : [];
    const fails = events.filter(e=>e.ok===false).length, oks = events.filter(e=>e.ok===true).length, pend = events.filter(e=>e.ok==null).length;
    // super_admin always sees live PII (server-side, audited) — show it as info, not a toggle
    const unmaskBtn = can("unmaskPII")
      ? `<span class="rl" style="align-self:center">🔓 PII visible · Super Admin (live, audited)</span>`
      : `<span class="rl" style="align-self:center">🔒 PII masked</span>`;
    let h=`<div class="drawer-hd">${backBtn}<b>Transaction timeline</b><span class="x" id="dwX2">×</span></div>
      <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
        <div class="mono" style="font-size:12px">id: ${esc(tl.identifier)||'—'}</div>
        ${o?`<div style="font-size:12.5px;margin-top:6px"><b>Order</b> ${esc(o.id)} · state <span class="catpill">${esc(o.aasm_state)}</span> · plan ${esc(o.plan_id)} · completed ${esc(o.completed)} · activated ${esc(o.activated)}<br>
          <span style="color:var(--muted)">mobile ${esc(o.mobile_number)} · nid ${esc(o.nationality_id_number)}${o.customer_name?' · '+esc(o.customer_name):''}</span></div>`
          :`<div style="color:var(--muted);font-size:12.5px;margin-top:6px">No onboarding order resolved for this identifier — showing related events.</div>`}
        <div style="margin-top:8px;font-size:11.5px;color:var(--muted)">${events.length} event${events.length===1?'':'s'}${events.length?` · <span style="color:#16a34a">${oks} ok</span> · <span style="color:#dc2626">${fails} failed</span>${pend?` · <span style="color:#d97706">${pend} in-progress</span>`:''}`:''}</div>
        <div style="margin-top:10px;display:flex;align-items:center;flex-wrap:wrap;gap:4px">${unmaskBtn}</div>
      </div>
      <div class="tl">`;
    if(!events.length) h+=`<div class="okbox">No events found for this identifier in the current data window.</div>`;
    events.forEach((e,ix)=>{
      const dot = e.ok===true?'okdot':e.ok===false?'faildot':'neutdot';
      const hasRR = e.request!=null || e.response!=null;
      h+=`<div class="tlitem"><span class="dot ${dot}"></span>
        <div class="src">${esc(e.source)} · ${esc(e.kind)}${e.ms!=null?` <span class="tl-ms">${esc(e.ms)} ms</span>`:''}</div>
        <div class="dt">${esc(e.detail)}</div>
        ${e.endpoint?`<div class="tl-ep mono">${esc(e.endpoint)}${(e.status!=null&&e.status!=='')?` · <b>${esc(e.status)}</b>`:''}</div>`:''}
        ${hasRR?`<button class="tl-rrbtn" data-rr="${ix}">req / res ▾</button>
          <div class="tl-rr" id="tlrr_${ix}" hidden>
            ${e.request!=null?`<div class="tl-rrlabel">REQUEST</div><div class="codeblk">${jsonHi(e.request)}</div>`:''}
            ${e.response!=null?`<div class="tl-rrlabel">RESPONSE</div><div class="codeblk">${jsonHi(e.response)}</div>`:''}
          </div>`:''}
        <div class="ts">${fmtTs(e.at, true)}</div></div>`;
    });
    h+=`</div>`;
    $("#txnDrawerBody").innerHTML=h;
    $("#dwX2").onclick=()=>ov.classList.remove("open"); wireBack();
    $("#txnDrawerBody").querySelectorAll(".tl-rrbtn").forEach(b=>b.addEventListener("click",()=>{
      const box=$("#tlrr_"+b.dataset.rr); if(!box) return;
      const open=box.hasAttribute("hidden"); if(open) box.removeAttribute("hidden"); else box.setAttribute("hidden","");
      b.innerHTML = (open?"req / res ▴":"req / res ▾");
    }));
    const ub=$("#dwUnmask"); if(ub) ub.onclick=()=>openTimeline(id, !unmask, row, onBack);   // preserve row + back so unmask re-resolves the same txn
  }
  $("#txnDrawer").addEventListener("click",e=>{ if(e.target.id==="txnDrawer") e.currentTarget.classList.remove("open"); });
  window.opsOpenTimeline = (id, row, onBack)=>openTimeline(id||null, false, row||null, onBack||null);   // let other views open the txn timeline (with optional ‹Back)

  // ================= SETTINGS: SYNC ENGINE =================
  async function loadSyncSettings(){
    let data;
    try { data=await api("/api/settings/sync"); }
    catch(e){ $("#syncSettings").innerHTML=`<div class="albanner">Needs the console API. ${esc(e.message)}</div>`; return; }
    const s=data.sync||{}; const editable=can("manageSync");
    const isSuper = SES.me && SES.me.realRole==="super_admin";
    const modeBtn=(v,label,desc)=>`<button data-mode="${v}" class="${s.mode===v?'on':''}" title="${desc}">${label}</button>`;
    $("#syncSettings").innerHTML=`
      <div class="setrow">
        <label>STATE</label>
        <label class="switch"><input type="checkbox" id="syncEnabled" ${s.enabled?'checked':''} ${editable?'':'disabled'}><span class="slider"></span></label>
        <span style="font-weight:700;color:${s.enabled?'#16a34a':'#94a3b8'}">${s.enabled?'AUTO — running':'MANUAL — stopped'}</span>
        <span class="rl" style="margin-left:auto">${data.scheduler&&data.scheduler.running?'scheduler active':'scheduler idle'}</span>
      </div>
      <div class="setrow"><label>MODE</label>
        <div class="segsel" id="syncMode">
          ${modeBtn('manual','Manual','Only run on button click')}
          ${modeBtn('auto_replay','Auto · Replay','Advance a virtual clock across the data — simulate live traffic')}
          ${modeBtn('auto_real','Auto · Live','Sync at real wall-clock (for a truly live replica)')}
        </div>
      </div>
      <div class="setrow">
        <label>INTERVAL</label><input type="number" id="syncInterval" value="${s.intervalSec||15}" min="3" ${editable?'':'disabled'}><span class="rl">sec</span>
        <label>STEP</label><input type="number" id="syncStep" value="${s.stepHours||3}" min="1" ${editable?'':'disabled'}><span class="rl">h (replay)</span>
        <button class="pill" id="syncSave" style="border-left-color:var(--green);margin-left:auto" ${editable?'':'disabled'}>Save</button>
      </div>
      <div style="font-size:11.5px;color:#64748b;margin-top:4px">
        <b>Manual</b>: nothing runs automatically — use Sync/Simulate in Live Alerts. &nbsp;
        <b>Auto · Replay</b> (recommended for the static dump): every interval, advance ${s.stepHours||3}h of virtual time and evaluate — a live-traffic stream. &nbsp;
        <b>Auto · Live</b>: for a genuinely live replica.</div>
      ${editable?'':'<div class="albanner" style="margin-top:10px">Your role can view sync settings but not change them (needs manageSync: Super Admin / Admin / Events Manager).</div>'}
      <div class="setrow" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <label>SYNC-HEALTH REPORT</label>
        <span class="rl">Auto-emailed at <b>08:00</b> &amp; <b>20:00</b> KSA to users with <b>Mail report</b> on.</span>
        ${editable?'<button class="pill" id="shSend" style="border-left-color:#2563eb;margin-left:auto">✉ Send sync-health now</button>':''}
      </div>
      <div id="shResult" class="rl" style="margin-top:2px"></div>
      ${can("manageUsers")?`<div class="setrow" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <label>HEALTH SELF-CHECK</label>
        <span class="rl">Is the tooling itself healthy? Replica freshness, sync job, alert engine &amp; notification channels/keys.</span>
        <button class="pill" id="scRun" style="border-left-color:#2563eb;margin-left:auto">↻ Run self-check</button>
      </div>
      <div id="scResult" style="margin-top:6px"></div>`:''}
      <div class="setrow" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <label>INTERFACE</label>
        <label class="switch"><input type="checkbox" id="featLangSwitch" ${(SES.me&&SES.me.features&&SES.me.features.langSwitch)?'checked':''} ${can("manageUsers")?'':'disabled'}><span class="slider"></span></label>
        <span class="rl">Show the Arabic / English language switch in the header</span>
      </div>
      <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <div class="setrow"><label>EVENT TIMELINE</label><span class="rl">Deploys, campaigns &amp; maintenance — shown as markers on every trend chart.</span></div>
        ${editable?`<div class="setrow" style="flex-wrap:wrap;gap:6px">
          <select id="evKind" style="max-width:130px"><option value="deploy">Deploy</option><option value="campaign">Campaign</option><option value="maintenance">Maintenance</option><option value="incident">Incident</option><option value="note">Note</option></select>
          <input id="evTitle" placeholder="Title" style="flex:1;min-width:150px">
          <input id="evArea" placeholder="Area (opt)" style="max-width:120px">
          <input id="evAt" type="datetime-local" style="max-width:190px">
          <button class="pill" id="evAdd" style="border-left-color:var(--green)">Add</button>
        </div>`:''}
        <div id="evList" style="margin-top:8px"></div>
      </div>
      <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <div class="setrow"><label>ERROR CODES</label><span class="rl">Human labels for BSS/activation status codes — shown as "code - meaning" on error charts.</span></div>
        ${editable?`<div class="setrow" style="flex-wrap:wrap;gap:6px">
          <input id="ecCode" placeholder="Code (e.g. 823)" style="max-width:150px">
          <input id="ecLabel" placeholder="Meaning" style="flex:1;min-width:160px">
          <input id="ecArea" placeholder="Area (opt)" style="max-width:120px">
          <button class="pill" id="ecAdd" style="border-left-color:var(--green)">Save</button>
        </div>
        <details style="margin-top:6px"><summary class="rl" style="cursor:pointer">Bulk paste a list…</summary>
          <textarea id="ecBulk" rows="4" placeholder="One per line:  code, meaning, area(optional)&#10;823, MSISDN already provisioned, semati&#10;727, Nafath session expired, nafath" style="width:100%;margin-top:6px;font-family:var(--mono);font-size:11.5px"></textarea>
          <button class="pill" id="ecBulkAdd" style="border-left-color:var(--blue)">Import list</button>
        </details>`:''}
        <div id="ecList" style="margin-top:8px"></div>
      </div>
      ${isSuper?`<div id="prodSyncBox" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px"></div>`:''}`;
    loadErrCodes();
    const ecAdd=$("#ecAdd");
    if(ecAdd) ecAdd.addEventListener("click", async ()=>{
      const code=$("#ecCode").value.trim(), label=$("#ecLabel").value.trim(); if(!code||!label){ (code?$("#ecLabel"):$("#ecCode")).focus(); return; }
      try{ await api("/api/error-codes",{method:"PUT",body:JSON.stringify({code,label,area:$("#ecArea").value.trim()||null})});
        $("#ecCode").value=""; $("#ecLabel").value=""; $("#ecArea").value=""; loadErrCodes();
      }catch(e){ alert("Save failed: "+e.message); }
    });
    const ecBulk=$("#ecBulkAdd");
    if(ecBulk) ecBulk.addEventListener("click", async ()=>{
      const text=$("#ecBulk").value.trim(); if(!text) return;
      try{ const r=await api("/api/error-codes/bulk",{method:"POST",body:JSON.stringify({text})}); $("#ecBulk").value=""; loadErrCodes(); alert("Imported "+r.imported+" codes."); }
      catch(e){ alert("Import failed: "+e.message); }
    });
    loadEvents();
    const evAdd=$("#evAdd");
    if(evAdd) evAdd.addEventListener("click", async ()=>{
      const title=$("#evTitle").value.trim(); if(!title){ $("#evTitle").focus(); return; }
      const atv=$("#evAt").value; const at=atv? new Date(atv).toISOString() : new Date().toISOString();
      try{ await api("/api/events",{method:"POST",body:JSON.stringify({kind:$("#evKind").value,title,area:$("#evArea").value.trim()||null,at})});
        $("#evTitle").value=""; $("#evArea").value=""; if(window.anaReloadEvents) window.anaReloadEvents(); loadEvents();
      }catch(e){ alert("Add failed: "+e.message); }
    });
    const langFeat=$("#featLangSwitch");
    if(langFeat && can("manageUsers")) langFeat.addEventListener("change", async ()=>{
      try{ const r=await api("/api/settings/features",{method:"PUT",body:JSON.stringify({langSwitch:langFeat.checked})});
        if(SES.me) SES.me.features=r; applyFeatureFlags();
      }catch(e){ alert("Save failed: "+e.message); langFeat.checked=!langFeat.checked; }
    });
    if(isSuper) loadProdSync();
    // sync-health manual send (any time)
    const shBtn=$("#shSend");
    if(shBtn) shBtn.onclick=async()=>{
      shBtn.disabled=true; const old=shBtn.textContent; shBtn.textContent="… sending";
      try{
        const r=await api("/api/sync-health/send",{method:"POST",body:JSON.stringify({})});
        if(r.sent) $("#shResult").innerHTML=`✅ Sent (${esc(r.status)}) to ${r.recipients.length}: ${esc(r.recipients.join(", "))}`;
        else if(r.dev){ $("#shResult").innerHTML=`Dev mode (no SMTP) — opened a preview in a new tab. Status: <b>${esc(r.status)}</b>.`; const w=window.open("","_blank"); if(w){ w.document.write(r.previewHtml); w.document.close(); } }
        else if(r.reason) $("#shResult").innerHTML=`Not sent — ${esc(r.reason)}`;
        else $("#shResult").innerHTML=`Not sent${r.error?': '+esc(r.error):''}.`;
      }catch(e){ $("#shResult").textContent="Failed: "+e.message; }
      shBtn.textContent=old; shBtn.disabled=false;
    };
    // health self-check (admin) — auto-runs on open, re-runnable
    const scBtn=$("#scRun");
    if(scBtn){
      async function runSelfCheck(){
        const host=$("#scResult"); if(!host) return;
        host.innerHTML=`<span class="rl">Running…</span>`; scBtn.disabled=true;
        try{
          const r=await api("/api/health/selfcheck");
          const dot=st=>({ok:'#16a34a',warn:'#d97706',fail:'#dc2626',off:'#94a3b8'}[st]||'#94a3b8');
          const sum=r.summary||{};
          host.innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;font-size:12px">`+
            (sum.fail?`<span style="color:#dc2626;font-weight:800">${sum.fail} FAIL</span>`:'')+
            (sum.warn?`<span style="color:#d97706;font-weight:800">${sum.warn} WARN</span>`:'')+
            `<span style="color:#16a34a;font-weight:800">${sum.ok||0} OK</span>`+
            (sum.off?`<span style="color:#94a3b8;font-weight:700">${sum.off} off</span>`:'')+
            `<span class="rl" style="margin-left:auto">as of ${new Date(r.now).toLocaleTimeString('en-GB',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'})} KSA</span></div>`+
            `<div style="display:grid;grid-template-columns:auto 1fr;gap:5px 12px;align-items:baseline">`+
            (r.checks||[]).map(c=>`<span style="display:inline-flex;align-items:center;gap:7px;font-weight:600;white-space:nowrap"><span style="width:9px;height:9px;border-radius:50%;background:${dot(c.status)};flex:none"></span>${esc(c.label)}</span>`+
              `<span class="rl" style="color:${c.status==='fail'?'#dc2626':c.status==='warn'?'#b45309':'var(--muted)'}">${esc(c.detail||'')}</span>`).join("")+
            `</div>`;
        }catch(e){ host.innerHTML=`<div class="albanner">Self-check failed: ${esc(e.message)}</div>`; }
        scBtn.disabled=false;
      }
      scBtn.onclick=runSelfCheck;
      runSelfCheck();
    }
    if(editable){
      let mode=s.mode;
      $("#syncMode").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ mode=b.dataset.mode; $("#syncMode").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); }));
      $("#syncSave").onclick=async()=>{
        const body={ enabled:$("#syncEnabled").checked, mode, intervalSec:Number($("#syncInterval").value), stepHours:Number($("#syncStep").value) };
        try{ await api("/api/settings/sync",{method:"PUT",body:JSON.stringify(body)}); loadSyncSettings(); }
        catch(e){ alert("Save failed: "+e.message); }
      };
      $("#syncEnabled").addEventListener("change",()=>$("#syncSave").click());
    }
  }
  // event-timeline admin (list + delete) shown inside the sync settings page
  async function loadEvents(){
    const box=$("#evList"); if(!box) return;
    let d; try{ d=await api("/api/events"); }catch(e){ box.innerHTML=""; return; }
    const evs=(d.events||[]).slice(0,12);
    const KC={deploy:'#7c3aed',campaign:'#0891b2',maintenance:'#64748b',incident:'#dc2626',note:'#334155'};
    if(!evs.length){ box.innerHTML=`<div class="rl">No events yet.</div>`; return; }
    box.innerHTML=evs.map(e=>{ const t=new Date(e.at).toLocaleString('en-GB',{timeZone:'Asia/Riyadh',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0"><span style="width:9px;height:9px;border-radius:2px;background:${KC[e.kind]||'#334155'};flex:0 0 9px"></span><b style="text-transform:capitalize">${esc(e.kind)}</b><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.title)}</span>${e.area?`<span class="rl">· ${esc(e.area)}</span>`:''}<span class="rl" style="margin-left:auto;white-space:nowrap">${esc(t)} KSA</span>${can("manageSync")?`<button data-ev="${e.id}" title="Delete" style="cursor:pointer;border:none;background:none;color:var(--muted);font-size:15px">×</button>`:''}</div>`;
    }).join("");
    box.querySelectorAll("[data-ev]").forEach(b=>b.addEventListener("click", async ()=>{
      try{ await api("/api/events/"+b.dataset.ev,{method:"DELETE"}); if(window.anaReloadEvents) window.anaReloadEvents(); loadEvents(); }catch(e){ alert(e.message); }
    }));
  }
  // error-code label admin (list + delete)
  async function loadErrCodes(){
    const box=$("#ecList"); if(!box) return;
    let d; try{ d=await api("/api/error-codes"); }catch(e){ box.innerHTML=""; return; }
    const codes=(d.codes||[]);
    if(!codes.length){ box.innerHTML=`<div class="rl">No labels yet — add the common codes so charts read "code - meaning".</div>`; return; }
    box.innerHTML=codes.map(c=>`<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0"><b style="font-family:var(--mono)">${esc(c.code)}</b><span>${esc(c.label)}</span>${c.area?`<span class="rl">· ${esc(c.area)}</span>`:''}${can("manageSync")?`<button data-ec="${esc(c.code)}" title="Delete" style="margin-left:auto;cursor:pointer;border:none;background:none;color:var(--muted);font-size:15px">×</button>`:''}</div>`).join("");
    box.querySelectorAll("[data-ec]").forEach(b=>b.addEventListener("click", async ()=>{
      try{ await api("/api/error-codes/"+encodeURIComponent(b.dataset.ec),{method:"DELETE"}); loadErrCodes(); }catch(e){ alert(e.message); }
    }));
  }

  // ================= SETTINGS: PROD → LOCAL DATA SYNC (super admin) =================
  let _prodPoll=null;
  async function loadProdSync(){
    const box=$("#prodSyncBox"); if(!box) return;
    let d; try{ d=await api("/api/prod-sync/status"); }
    catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    renderProdSync(d);
  }
  function renderProdSync(d){
    const box=$("#prodSyncBox"); if(!box) return;
    const running=d.running;
    const rows=(d.state||[]).map(r=>`<tr>
      <td class="mono">${esc(r.table_name)}</td>
      <td style="text-align:right">${r.rows_synced==null?'—':Number(r.rows_synced).toLocaleString()}</td>
      <td class="mono" style="color:var(--muted)">${r.watermark?fmtTs(r.watermark):'—'}</td>
      <td>${r.last_status?`<span class="catpill">${esc(r.last_status)}</span>`:'—'}</td>
      <td class="mono" style="color:var(--muted)">${r.last_run_at?fmtTs(r.last_run_at):'—'}</td>
      ${r.last_error?`<td style="color:#dc2626;font-size:11px">${esc(r.last_error)}</td>`:'<td></td>'}
    </tr>`).join("");
    box.innerHTML=`
      <div class="setrow"><label>PROD DATA SYNC</label>
        <span class="rl">Incremental, read-only pull from the prod reporting replica into the local replica. ${d.configured?`<b style="color:#16a34a">connected</b>`:`<b style="color:#d97706">PROD_DATABASE_URL not set on the console</b>`}${running?` · <b style="color:#2563eb">running…</b>`:''}</span>
        <span style="margin-left:auto;display:flex;gap:8px;align-items:center">
          <label class="rl" style="display:flex;gap:5px;align-items:center">test one day (KSA)<input type="date" id="psDate" style="padding:4px 6px"></label>
          <button class="pill" id="psDry" ${running||!d.configured?'disabled':''}>Dry-run</button>
          <button class="pill" id="psRun" style="border-left-color:var(--green)" ${running||!d.configured?'disabled':''}>Run sync</button>
        </span>
      </div>
      <div id="psResult" class="rl" style="margin:4px 0 8px"></div>
      ${rows?`<div style="overflow-x:auto"><table class="alerts"><tr><th>TABLE</th><th style="text-align:right">ROWS</th><th>WATERMARK</th><th>STATUS</th><th>LAST RUN</th><th>ERROR</th></tr>${rows}</table></div>`
        :`<div class="okbox">No sync has run yet. ${d.configured?'Click <b>Dry-run</b> to preview row counts.':'Configure PROD_DATABASE_URL (see <code>.env.prod-sync</code>) or use the shell script.'}</div>`}
      <div style="font-size:11px;color:var(--muted);margin-top:8px">Runs where the console can reach prod on VPN. Watermark = last created/updated pulled per table; re-runs only fetch the delta. Same engine as <code>scripts/sync-from-prod.sh</code>.</div>`;
    const dry=$("#psDry"), run=$("#psRun");
    if(dry) dry.onclick=()=>runProdSync(true);
    if(run) run.onclick=()=>{ if(confirm("Start an incremental prod → local sync now?")) runProdSync(false); };
    // poll while running
    clearInterval(_prodPoll); _prodPoll=null;
    if(running){ _prodPoll=setInterval(loadProdSync, 3000); }
  }
  async function runProdSync(dryRun){
    const res=$("#psResult"); if(res) res.innerHTML=dryRun?"Counting…":"Starting…";
    const date=($("#psDate")&&$("#psDate").value)||null;
    try{
      const r=await api("/api/prod-sync/run",{method:"POST",body:JSON.stringify({dryRun,date})});
      if(dryRun){
        const lines=(r.results||[]).map(x=>`${esc(x.table)}: ${x.error?('<span style="color:#dc2626">'+esc(x.error)+'</span>'):x.skipped?('skipped ('+esc(x.skipped)+')'):(Number(x.rows).toLocaleString()+' would sync')}`).join(" · ");
        if(res) res.innerHTML=`<b>${Number(r.rows).toLocaleString()}</b> rows would sync across ${r.tables} tables — ${lines}`;
        loadProdSync();
      } else {
        if(res) res.innerHTML="Sync started in the background…";
        loadProdSync();
      }
    }catch(e){ if(res) res.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; }
  }

  // ================= SETTINGS: USERS + ROLES REFERENCE =================
  async function loadUsersAndRoles(){
    // roles reference (always visible)
    try {
      const rr=await api("/api/roles");
      const roles=rr.roles||{};
      $("#rolesRef").innerHTML=`<table class="alerts"><tr><th>ROLE</th><th>TEAM</th><th>SEES</th><th>CAN</th><th>NOTE</th></tr>`+
        Object.entries(roles).map(([k,r])=>{
          const caps=Object.entries(r.caps).filter(([,v])=>v).map(([c])=>c).join(', ')||'—';
          return `<tr><td><b>${esc(r.label)}</b></td><td>${esc(r.team)}</td><td class="mono" style="font-size:10.5px">${esc(r.views.join(' '))}</td><td class="mono" style="font-size:10.5px">${esc(caps)}</td><td style="font-size:11.5px;color:#64748b">${esc(r.note)}</td></tr>`;
        }).join("")+`</table>`;
    } catch(e){ $("#rolesRef").innerHTML=`<div class="sub">${esc(e.message)}</div>`; }
    // editable permissions matrix (renders its own read-only view for non-super users)
    if(window.renderRolesMatrix) window.renderRolesMatrix();
    // users (super admin)
    if(!can("manageUsers")){ $("#usersBody").innerHTML=`<div class="okbox">User management is available to Super Admins only.</div>`; return; }
    renderUserMgmt();
  }

  // role list (single-select, radio-style checkboxes to mirror the ops console)
  const UM_ROLES = [["super_admin","Super admin"],["admin","Admin"],["report_manager","Report manager"],["errors_manager","Errors manager"],["events_manager","Events manager"],
    ["l1_bss","L1 BSS"],["l2_bss","L2 BSS"],["l1_digital","L1 Digital"],["l2_digital","L2 Digital"],["l3_digital","L3 Digital"]];
  const UM_TAGS = ["BSS","OSS","DIGITAL","SALES OPS","PLATFORM","IDENTITY"];
  const fmtLogin = d => { if(!d) return "—"; const x=new Date(d); return x.toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"numeric",month:"short"})+", "+x.toLocaleTimeString("en-GB",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit"}); };

  async function renderUserMgmt(){
    let users=[];
    try { users=(await api("/api/users")).users||[]; }
    catch(e){ $("#usersBody").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }

    const roleChecks = (name, sel) => UM_ROLES.map(([v,l])=>
      `<label class="um-check"><input type="checkbox" name="${name}" value="${v}" ${v===sel?'checked':''}><span>${l}</span></label>`).join("");
    const tagChips = sel => UM_TAGS.map(t=>`<button type="button" class="tagchip ${sel.includes(t)?'on':''}" data-tag="${t}">${t}</button>`).join("");

    // ---- New user card ----
    const card = `<div class="um-card">
      <h4>New user</h4>
      <div class="um-lbl">EMAIL</div><input class="um-input" id="nuEmail" placeholder="person@salam.sa">
      <div class="um-lbl">NAME</div><input class="um-input" id="nuName" placeholder="Full name">
      <div class="um-lbl">MOBILE</div><input class="um-input" id="nuMobile" placeholder="05x xxx xxxx">
      <div class="um-lbl">ROLES</div><div class="um-checks" id="nuRoles">${roleChecks("nuRole","admin")}</div>
      <div class="um-lbl">NOTIFICATIONS</div>
      <div class="um-checks">
        <label class="um-check"><input type="checkbox" id="nuMailReport"><span>Mail report</span></label>
        <label class="um-check"><input type="checkbox" id="nuMailAlert"><span>Mail alert</span></label>
      </div>
      <div class="um-lbl">TEAM TAGS</div><div class="um-tags" id="nuTags">${tagChips([])}</div>
      <div class="um-note">Only @salam.sa and @salammobile.sa email addresses are accepted. No password is set — the user gets a welcome email and signs in with an emailed code.</div>
      <button class="um-btn" id="nuAdd">Create user</button>
    </div>`;

    // ---- Users table ----
    const rows = users.map(u=>{
      const urs=(u.roles&&u.roles.length)?u.roles:(u.role?[u.role]:[]);
      const utags=(u.tags||[]);
      return `<tr data-uid="${u.id}">
        <td class="u-email">${esc(u.email)}</td>
        <td><input class="u-inline" data-ufield="name" value="${esc(u.name||'')}" placeholder="—"></td>
        <td><input class="u-inline" data-ufield="mobile" value="${esc(u.mobile||'')}" placeholder="—"></td>
        <td><div class="um-rolecell">${UM_ROLES.map(([v,l])=>`<label><input type="checkbox" data-role="${v}" ${urs.includes(v)?'checked':''}><span>${l}</span></label>`).join("")}</div></td>
        <td><div class="u-tagedit">${UM_TAGS.map(t=>`<button type="button" class="tagchip mini ${utags.includes(t)?'on':''}" data-tag="${t}">${t}</button>`).join("")}</div></td>
        <td><span class="status-pill ${u.enabled?'active':'blocked'}">${u.enabled?'Active':'Blocked'}</span></td>
        <td style="text-align:center"><input type="checkbox" class="um-cellchk" data-field="mail_report" ${u.mail_report?'checked':''}></td>
        <td style="text-align:center"><input type="checkbox" class="um-cellchk" data-field="mail_alert" ${u.mail_alert?'checked':''}></td>
        <td style="text-align:center"><input type="checkbox" class="um-cellchk" data-field="tour_seen" ${u.tour_seen?'checked':''}></td>
        <td style="white-space:nowrap;color:var(--muted)">${fmtLogin(u.last_login)}</td>
        <td><button class="blocklink ${u.enabled?'':'unblock'}" data-block>${u.enabled?'Block':'Unblock'}</button></td>
      </tr>`;
    }).join("");
    const table = `<div style="overflow-x:auto;margin-top:26px"><table class="umtable">
      <tr><th>EMAIL</th><th>NAME</th><th>MOBILE</th><th>ROLES</th><th>TAGS</th><th>STATUS</th><th>MAIL REPORT</th><th>MAIL ALERT</th><th>QUICK TOUR</th><th>LAST LOGIN</th><th>ACTIONS</th></tr>
      ${rows||`<tr><td colspan="11" style="color:var(--muted);padding:18px">No users yet.</td></tr>`}
    </table></div>`;

    $("#usersBody").innerHTML = card + table;
    wireUserMgmt();
  }

  function wireUserMgmt(){
    const body=$("#usersBody");
    // --- new user card: single-select roles ---
    const roleBox=$("#nuRoles");
    // roles are multi-select (a user can hold several roles) — no single-select enforcement
    // tag chips toggle
    $("#nuTags").querySelectorAll(".tagchip").forEach(c=>c.addEventListener("click",()=>c.classList.toggle("on")));
    // create
    $("#nuAdd").onclick=async()=>{
      const email=$("#nuEmail").value.trim();
      const rolesSel=[...roleBox.querySelectorAll('input[name="nuRole"]:checked')].map(e=>e.value);
      if(!email){ $("#nuEmail").focus(); return; }
      if(!/@(salam\.sa|salammobile\.sa)$/i.test(email)){ alert("Use a @salam.sa or @salammobile.sa email."); return; }
      if(!rolesSel.length){ alert("Select at least one role."); return; }
      const payload={ email, name:$("#nuName").value.trim()||null, mobile:$("#nuMobile").value.trim()||null, roles: rolesSel,
        tags:[...$("#nuTags").querySelectorAll(".tagchip.on")].map(c=>c.dataset.tag),
        mail_report:$("#nuMailReport").checked, mail_alert:$("#nuMailAlert").checked };
      const btn=$("#nuAdd"); btn.disabled=true;
      try{ await api("/api/users",{method:"POST",body:JSON.stringify(payload)}); renderUserMgmt(); }
      catch(e){ alert(e.message); btn.disabled=false; }
    };
    // --- table rows ---
    body.querySelectorAll("tr[data-uid]").forEach(tr=>{
      const id=tr.dataset.uid;
      const patch=async b=>{ try{ await api("/api/users/"+id,{method:"PATCH",body:JSON.stringify(b)}); }catch(e){ alert(e.message); renderUserMgmt(); } };
      // multi-select role checkboxes
      const roleCbs=[...tr.querySelectorAll(".um-rolecell input[data-role]")];
      roleCbs.forEach(cb=>cb.addEventListener("change",()=>{
        let sel=roleCbs.filter(x=>x.checked).map(x=>x.dataset.role);
        if(!sel.length){ cb.checked=true; sel=[cb.dataset.role]; }   // keep at least one role
        patch({roles:sel});
      }));
      // editable team tags
      tr.querySelectorAll(".u-tagedit .tagchip").forEach(c=>c.addEventListener("click",()=>{
        c.classList.toggle("on");
        patch({tags:[...tr.querySelectorAll(".u-tagedit .tagchip.on")].map(x=>x.dataset.tag)});
      }));
      // inline name / mobile editing (save on blur / Enter)
      tr.querySelectorAll(".u-inline[data-ufield]").forEach(inp=>{
        const save=()=>patch({[inp.dataset.ufield]: inp.value.trim()});
        inp.addEventListener("change", save);
        inp.addEventListener("keydown", e=>{ if(e.key==="Enter") inp.blur(); });
      });
      // notification / tour checkboxes
      tr.querySelectorAll(".um-cellchk[data-field]").forEach(cb=>cb.addEventListener("change",()=>patch({[cb.dataset.field]:cb.checked})));
      // block / unblock
      const blk=tr.querySelector("[data-block]");
      if(blk) blk.addEventListener("click",async()=>{ const enable=blk.classList.contains("unblock"); await patch({enabled:enable}); renderUserMgmt(); });
    });
  }

  async function loadConfigChanges(){
    const box=$("#configChanges"); if(!box) return;
    box.innerHTML=`<div class="sub">Loading…</div>`;
    try{
      const d=await api("/api/config-changes?limit=60"); const c=d.changes||[];
      if(!c.length){ box.innerHTML=`<div class="okbox">No <code>Setting</code> changes recorded yet${d.note?` (${esc(d.note)})`:''}. Changes appear here once admins edit settings in the backend.</div>`; return; }
      box.innerHTML=`<table class="alerts"><tr><th>WHEN</th><th>SETTING</th><th>EVENT</th><th>CHANGED BY</th><th>DIFF</th></tr>`+
        c.map(x=>`<tr>
          <td class="mono" style="color:var(--muted);white-space:nowrap">${fmtTs(x.created_at)}</td>
          <td class="mono">${esc(x.var||('#'+x.item_id))}</td>
          <td>${esc(x.event)}</td>
          <td>${esc(x.whodunnit||'—')}</td>
          <td class="mono" style="font-size:10.5px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.changes||'')}</td>
        </tr>`).join("")+`</table>`;
    }catch(e){ box.innerHTML=`<div class="sub">${esc(e.message)}</div>`; }
  }

  // mobile drawer
  const burger=$("#navBurger"), navEl=document.querySelector("nav");
  if(burger) burger.addEventListener("click", ()=> navEl.classList.toggle("open"));

  // settings now opens from the header gear (see app.js) — expose its loaders
  window.opsLoadSettings = ()=>{ loadSyncSettings(); loadUsersAndRoles(); loadConfigChanges(); if(navEl) navEl.classList.remove("open"); };

  // ---- wire nav + lazy loads ----
  document.querySelectorAll(".navtab").forEach(b=>{
    b.addEventListener("click", ()=>{ if(navEl) navEl.classList.remove("open"); });
    if(b.dataset.view==="errors") b.addEventListener("click", loadErrors);
  });

  // deep-link entry point: preselect a Troubleshoot error category (e.g. from the
  // dashboard journey-health pills). Sets the filter; the nav switch triggers the load,
  // and if Troubleshoot is already open we reload in place.
  window.opsSelectErrorCategory = function(cat){
    errState.category = cat || "";
    errState.team = "";
    errState.codeFilter = "";
    reflectCatUrl(errState.category);
    if($("#view-errors") && $("#view-errors").classList.contains("active")) loadErrors();
  };
  $("#errSearch").addEventListener("input", ()=>{ errState.q=$("#errSearch").value.trim(); clearTimeout(window._eqt); window._eqt=setTimeout(()=>{ loadErrors(); if(errState.q&&window.audit) window.audit("APPLY_FILTER","troubleshoot:search"); },350); });
  document.addEventListener("opsrangechange", ()=>{ if($("#view-errors").classList.contains("active")) loadErrors(); });
  document.addEventListener("opsdatarefresh", ()=>{ if($("#view-errors").classList.contains("active")) loadErrors(); });
  document.addEventListener("uinavchange", ()=>{ if($("#view-errors").classList.contains("active")) loadErrors(); });
  const errExp=$("#errExport"); if(errExp) errExp.addEventListener("click", ()=> window.opsExport(errState.lastFeed, `errors_${errState.window}h`, errExp));
  $("#userChip").addEventListener("click", openRoleModal);

  // ================= LOGIN GATE =================
  const ALLOWED = /@(salam\.sa|salammobile\.sa)$/i;
  const validDomain = e => ALLOWED.test(String(e||"").trim());
  function showGate(){ $("#loginGate").classList.add("show"); document.body.classList.add("locked"); showEmailStep(); const i=$("#lgEmail"); if(i){ i.value=""; $("#lgBtn").disabled=true; i.focus(); } }
  function hideGate(){ $("#loginGate").classList.remove("show"); document.body.classList.remove("locked"); }
  function showEmailStep(){ $("#lgStepEmail").style.display=""; $("#lgStepCode").style.display="none"; $("#lgErr").textContent=""; }
  function showCodeStep(email){ $("#lgStepEmail").style.display="none"; $("#lgStepCode").style.display=""; $("#lgCodeTo").textContent="→ "+email; $("#lgErr2").textContent=""; const c=$("#lgCode"); c.value=""; c.focus(); }
  async function sendCode(){
    const err=$("#lgErr"), btn=$("#lgBtn");
    const v=$("#lgEmail").value.trim().toLowerCase();
    if(!validDomain(v)){ err.textContent="Use a @salam.sa or @salammobile.sa email."; return; }
    btn.disabled=true; btn.textContent="Sending…";
    try{
      const r=await api("/api/auth/request-otp",{method:"POST",body:JSON.stringify({email:v})});
      SES.pendingEmail=v;
      showCodeStep(v);
      const hint=$("#lgDevHint");
      if(r.dev && r.devCode){ hint.style.display="block"; hint.innerHTML=`Dev mode (no SMTP): your code is <b>${esc(r.devCode)}</b> — also printed in the server logs.`; }
      else { hint.style.display="none"; }
    }catch(e){ err.textContent=e.message; }
    btn.disabled=false; btn.textContent="Send code";
  }
  async function verifyCode(){
    const err=$("#lgErr2"), btn=$("#lgVerify");
    const code=$("#lgCode").value.trim();
    if(code.length<4){ return; }
    btn.disabled=true; btn.textContent="Verifying…";
    try{
      const r=await api("/api/auth/verify-otp",{method:"POST",body:JSON.stringify({email:SES.pendingEmail, code})});
      SES.email=r.email; SES.role=r.role; localStorage.setItem('cons_email',r.email); localStorage.setItem('cons_role',r.role);
      hideGate(); showEmailStep(); await loadMe();
      const active=document.querySelector(".navtab:not(.hidden)"); if(active) active.click();
    }catch(e){ err.textContent=e.message; }
    btn.disabled=false; btn.textContent="Verify & sign in";
  }
  function wireGate(){
    const email=$("#lgEmail"), btn=$("#lgBtn");
    const check=()=>{ const ok=validDomain(email.value); btn.disabled=!ok; $("#lgErr").textContent=(email.value&&!ok)?"Use a @salam.sa or @salammobile.sa email.":""; };
    email.addEventListener("input", check);
    email.addEventListener("keydown", e=>{ if(e.key==="Enter" && !btn.disabled) sendCode(); });
    btn.addEventListener("click", sendCode);
    const code=$("#lgCode"), vbtn=$("#lgVerify");
    code.addEventListener("input", ()=>{ code.value=code.value.replace(/\D/g,''); vbtn.disabled=code.value.length<4; });
    code.addEventListener("keydown", e=>{ if(e.key==="Enter" && !vbtn.disabled) verifyCode(); });
    vbtn.addEventListener("click", verifyCode);
    $("#lgBack").addEventListener("click", e=>{ e.preventDefault(); showEmailStep(); });
    $("#lgResend").addEventListener("click", e=>{ e.preventDefault(); sendCode(); });
  }
  function bootAuth(){
    wireGate();
    const email=localStorage.getItem('cons_email')||"";
    if(email && validDomain(email)){ SES.email=email; hideGate(); loadMe(); }
    else { SES.email=""; showGate(); }
  }

  // sign out returns to the gate
  const _origSignout = ()=>{ SES.email=""; SES.role="report_manager"; localStorage.removeItem('cons_email'); localStorage.setItem('cons_role','report_manager'); showGate(); };

  // re-render theme-sensitive ops views on theme change
  document.addEventListener("themechange", ()=>{
    const active=document.querySelector(".view.active");
    if(active && active.id==="view-errors") loadErrors();
  });

  // ---- boot ----
  bootAuth();
})();
