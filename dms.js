/* DMS — dedicated Dealers tab (nav: after Monitoring). DMS-ONLY since 31 Aug 2026 (DMS L2,
 * Waleed Anouer: /api/uil/* endpoints are APIGW, not DMS — that section now renders on
 * Monitoring → Gateway & API via window.renderDealerGw, still defined at the bottom of this file).
 * What stays here is the DEALER BUSINESS domain, end to end:
 *   ⓪ today's dealer KPIs · ① Dealer 360 (Clara: profile, security, wallet, commission, stock)
 *   ①b commission report self-service · ② commissioning analytics board · ③ map & roster.
 * Channels this page describes: the DMS mobile app (dealer sales) and the hybrid self-activation
 * web portal mobile.salammobile.sa — both land in the same Clara MySQL cluster.
 * Own window picker (persisted), independent of the ops range — dealer review is its own rhythm. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const SES={ email:localStorage.getItem("cons_email")||"", role:localStorage.getItem("cons_role")||"report_manager" };
  async function api(path){
    const r=await fetch((window.API_BASE || window.CONSOLE_BASE) + path,{headers:{"Content-Type":"application/json","X-Console-Role":SES.role,"X-Console-User":SES.email}});
    if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||("HTTP "+r.status));
    return r.json();
  }
  const n=x=>Number(x||0).toLocaleString("en-US");
  const ms2=v=>v==null?"—":(v>=10000?(v/1000).toFixed(1)+"s":n(v)+"ms");

  let hours=(window.pf&&Number(window.pf.get("dms_hours",24)))||24;   // gateway section only (Monitoring)

  /* DMS PAGE RANGE — Dashboard-style sticky picker (Today / Yesterday / 7d / 30d / custom dates),
   * persisted. KSA day boundaries (UTC+3): "Today" means since 00:00 Riyadh, like the dashboard. */
  let range=(()=>{ try{ const v=window.pf&&window.pf.get("dms_range",null); return v?JSON.parse(v):{mode:"today"}; }catch(e){ return {mode:"today"}; } })();
  const KSA=3*3600e3;
  const ksaDay0=d=>{ const t=new Date(d.getTime()+KSA); t.setUTCHours(0,0,0,0); return new Date(t.getTime()-KSA); };
  function win(){
    const now=new Date();
    if(range.mode==="yesterday"){ const t0=ksaDay0(now); return { from:new Date(t0.getTime()-864e5).toISOString(), to:t0.toISOString() }; }
    if(range.mode==="7d")  return { from:new Date(now.getTime()-7*864e5).toISOString(), to:now.toISOString() };
    if(range.mode==="30d") return { from:new Date(now.getTime()-30*864e5).toISOString(), to:now.toISOString() };
    if(range.mode==="custom"&&range.from&&range.to)
      return { from:new Date(range.from+"T00:00:00+03:00").toISOString(), to:new Date(range.to+"T23:59:59+03:00").toISOString() };
    return { from:ksaDay0(now).toISOString(), to:now.toISOString() };   // today (default)
  }
  const winHours=()=>{ const w=win(); return Math.max(1,Math.round((new Date(w.to)-new Date(w.from))/3600e3)); };
  /* the dealer-gateway section lives on Monitoring and keeps its own hour pills */
  function gwWin(){
    const to=new Date(); to.setUTCMinutes(0,0,0); to.setUTCHours(to.getUTCHours()+1);
    return { to:to.toISOString(), from:new Date(to.getTime()-hours*3600e3).toISOString() };
  }
  const HL=[[1,"1h"],[6,"6h"],[24,"24h"],[168,"7d"],[720,"30d"]];

  async function render(){
    const host=$("#view-dms"); if(!host) return;
    const rbtn=(m,l)=>`<button class="dms-r" data-m="${m}" style="cursor:pointer;font:inherit;font-size:12px;font-weight:${range.mode===m?"800":"600"};padding:6px 14px;border:1px solid ${range.mode===m?"var(--green,#0e9f5a)":"var(--line)"};border-radius:999px;background:${range.mode===m?"var(--green,#0e9f5a)":"var(--card,#fff)"};color:${range.mode===m?"#fff":"inherit"}">${l}</button>`;
    /* the date pickers always SHOW the effective range (KSA days), whatever the mode — "Today"
     * fills today's date rather than leaving dd/mm/yyyy blanks (asked 31 Aug). Editing them and
     * hitting Apply switches to custom mode as before. */
    const kd=iso=>new Date(new Date(iso).getTime()+KSA).toISOString().slice(0,10);
    const wNow=win();
    const dIn=id=>`<input id="${id}" type="date" value="${esc(range.mode==="custom"?(range[id==="dmsRF"?"from":"to"]||""):kd(id==="dmsRF"?wNow.from:wNow.to))}" style="font:inherit;font-size:11.5px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">`;
    host.innerHTML=`<div class="fx-hub" style="padding:0 var(--fx-pad,18px) 40px;max-width:1440px;margin:0 auto">
      <!-- STICKY RANGE BAR — same pattern as the Dashboard: the range follows you down the page,
           and EVERY section below (journeys, business, map/roster) obeys it. -->
      <div class="fx-hubbar" style="position:sticky;top:var(--hdr);z-index:26;background:var(--card);border-bottom:1px solid var(--line);box-shadow:0 4px 14px rgba(15,23,42,.05);margin:0 calc(-1*var(--fx-pad,18px)) 14px;padding:10px var(--fx-pad,18px);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0;font-size:16px">DMS · Dealer operations</h2>
          <div class="rl" style="font-size:10.5px;color:var(--muted)">dealers end to end · DMS app + hybrid portal (mobile.salammobile.sa) · UIL/gateway → Monitoring</div></div>
        <div style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="rl" style="font-size:11px;color:var(--muted);font-weight:700">Range</span>
          ${rbtn("today","Today")}${rbtn("yesterday","Yesterday")}${rbtn("7d","7d")}${rbtn("30d","30d")}
          <span class="rl" style="font-size:11px;color:var(--muted)">Dates</span>${dIn("dmsRF")} <span class="rl" style="color:var(--muted)">→</span> ${dIn("dmsRT")}
          <button id="dmsRA" class="btn" style="font-size:11.5px;padding:6px 13px">Apply</button>
          <span class="rl mono" style="font-size:9.5px;color:var(--muted)" title="Active window (KSA day boundaries)">${esc(KT.md(win().from))} → ${esc(KT.md(win().to))}</span>
        </div>
      </div>
      <!-- Order: today's KPIs answer "how are we doing", then Dealer 360 answers "who do I need
           to look at" — the lookup someone actually came here to perform. The analytical blocks
           below are what you read after you know which dealer matters. -->
      <div id="dmsHome" style="margin-bottom:16px"></div>
      <!-- ORDER (31 Aug, user): journeys FIRST — the live pulse — then the lookups, then money,
           then the app-flow map. PLATFORM/UIL lives on Monitoring per DMS L2 (Waleed). -->
      <div class="rl" style="font-weight:800;font-size:12px;margin:2px 0 8px">① JOURNEYS · END TO END
        <span style="font-weight:600;color:var(--muted)">· from DMS's own audit trail (dms_audit_logs) — every step a dealer or self-service customer takes</span></div>
      <div id="dmsJourneys" style="margin-bottom:18px"><div class="rl">Loading journeys…</div></div>
      <div class="rl" style="font-weight:800;font-size:12px;margin:4px 0 8px">② DEALER 360 · DMS SYSTEM OF RECORD
        <span style="font-weight:600;color:var(--muted)">· live from the Clara cluster — profile, security, wallet, commission, stock</span></div>
      <div id="dms360" style="margin-bottom:18px"></div>
      <div class="rl" style="font-weight:800;font-size:12px;margin:4px 0 8px">②b BULK WALLET BALANCE · SELF-SERVICE
        <span style="font-weight:600;color:var(--muted)">· the "current balance for the users below" mail (INC0027800), answered here — paste the list, export the same sheet</span></div>
      <div id="dmsBulk" style="margin-bottom:18px"></div>
      <div class="rl" style="font-weight:800;font-size:12px;margin:4px 0 8px">③ COMMISSIONING · DMS TRUTH
        <span style="font-weight:600;color:var(--muted)">· from the activation ledger + rate table — follows the range above</span></div>
      <div id="dmsBiz" style="margin-bottom:16px"><div class="rl">Loading commissioning…</div></div>
      <div class="rl" style="font-weight:800;font-size:12px;margin:4px 0 8px">③b COMMISSION REPORT · SELF-SERVICE
        <span style="font-weight:600;color:var(--muted)">· the "Flex commission list" mail loop, replaced — filter, preview, export</span></div>
      <div id="dmsComm" style="margin-bottom:18px"></div>
      <div class="rl" style="font-weight:800;font-size:12px;margin:4px 0 8px">④ DEALER MAP EXPLORER
        <span style="font-weight:600;color:var(--muted)">· the network on the map (real dealer coordinates from DMS) + ranked table · filters · CSV — modeled on the Fixed ops console</span></div>
      <div id="dmsMap3"><div class="rl">Loading dealers…</div></div>
    </div>`;
    const saveRange=()=>{ if(window.pf) window.pf.set("dms_range",JSON.stringify(range)); render(); if(window.audit) window.audit("APPLY_FILTER","dms:range="+range.mode); };
    host.querySelectorAll(".dms-r").forEach(b=>b.addEventListener("click",()=>{ range={mode:b.dataset.m}; saveRange(); }));
    const ra=$("#dmsRA"); if(ra) ra.addEventListener("click",()=>{
      const f=($("#dmsRF")||{}).value, t=($("#dmsRT")||{}).value;
      if(!f||!t){ ra.textContent="pick both dates"; setTimeout(()=>ra.textContent="Apply",1400); return; }
      range={mode:"custom",from:f,to:t}; saveRange();
    });
    renderHome(); renderBiz(); renderDealers(); renderDealer360(); renderCommission();
    if(window.renderBulkBalance) window.renderBulkBalance($("#dmsBulk"));
    if(window.renderDmsJourneys) window.renderDmsJourneys(win());
  }

  /* ---------- ①b COMMISSION REPORT — the Flex-list mail loop, self-service ----------
   * Source: dms_v1.dms_sim_activation_report via the discovery-driven module. Preview shows
   * KPIs + top plans; Excel = full data in the mail's exact column order; PDF = exec summary.
   * Fails soft: old server without the endpoint hides the panel. */
  async function renderCommission(){
    const box=$("#dmsComm"); if(!box) return;
    const today=new Date().toISOString().slice(0,10);
    const wk=new Date(Date.now()-7*864e5).toISOString().slice(0,10);
    box.innerHTML=`<div class="topo-card" style="padding:12px 14px;background:var(--card,#fff)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <b style="font-size:12px">Commission report</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">activations with plan, dealer, commission — masked by default</span>
        <label class="rl" style="font-size:10.5px;display:flex;gap:5px;align-items:center">from
          <input id="cmFrom" type="date" value="${wk}" style="font:inherit;font-size:11.5px;padding:4px 7px;border:1px solid var(--line);border-radius:7px;background:var(--card,#fff);color:inherit"></label>
        <label class="rl" style="font-size:10.5px;display:flex;gap:5px;align-items:center">to
          <input id="cmTo" type="date" value="${today}" style="font:inherit;font-size:11.5px;padding:4px 7px;border:1px solid var(--line);border-radius:7px;background:var(--card,#fff);color:inherit"></label>
        <input id="cmPlan" placeholder="plan contains… e.g. Flex" style="flex:0 1 170px;font:inherit;font-size:11.5px;padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:var(--card,#fff);color:inherit">
        <input id="cmDealer" placeholder="dealer… e.g. pos_016740" style="flex:0 1 150px;font:inherit;font-size:11.5px;padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:var(--card,#fff);color:inherit">
        <input id="cmQ" placeholder="MSISDN / ICCID / ID…" style="flex:0 1 150px;font:inherit;font-size:11.5px;padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:var(--card,#fff);color:inherit">
        <label class="rl" style="font-size:10.5px;display:flex;gap:4px;align-items:center"><input id="cmOnly" type="checkbox" checked>commission only</label>
        <button id="cmGo" class="btn" style="font-size:12px;padding:6px 14px">Preview</button>
        <button id="cmXls" class="btn" style="font-size:11.5px;padding:5px 12px">⤓ Excel</button>
        <button id="cmPdf" class="pill" style="font-size:11.5px;padding:5px 12px">⤓ PDF report</button>
        <span id="cmMsg" class="rl" style="font-size:10.5px;color:var(--muted)"></span>
      </div>
      <div id="cmOut" style="margin-top:10px"></div></div>`;
    const qs=()=>{const p=new URLSearchParams();
      const v=(id)=>($( "#"+id)||{}).value||"";
      if(v("cmFrom"))p.set("from",v("cmFrom")); if(v("cmTo"))p.set("to",v("cmTo"));
      if(v("cmPlan"))p.set("plan",v("cmPlan")); if(v("cmDealer"))p.set("dealer",v("cmDealer"));
      if(v("cmQ"))p.set("q",v("cmQ")); if(($("#cmOnly")||{}).checked)p.set("commissionOnly","1");
      return p.toString();};
    const out=$("#cmOut"), msg=$("#cmMsg");
    $("#cmGo").onclick=async()=>{
      out.innerHTML=`<div class="rl">Querying the DMS cluster…</div>`;
      let d; try{ d=await api(`/api/dms/commission/report?${qs()}`); }
      catch(e){ out.innerHTML=`<div class="rl" style="color:var(--warn-fg)">${esc(e.message)}</div>`; return; }
      const T=d.totals, pct=T.total?Math.round(100*T.with_commission/T.total):0;
      const chip=(l,v,c)=>`<div class="stat" style="min-width:120px"><b style="${c?`color:${c}`:""}">${v}</b><span>${esc(l)}</span></div>`;
      const pMax=Math.max(1,...d.byPlan.map(x=>Number(x.n)));
      out.innerHTML=`<div class="topo-stats" style="margin-bottom:8px">
          ${chip("ACTIVATIONS",T.total.toLocaleString())}
          ${chip("WITH COMMISSION",`${T.with_commission.toLocaleString()} · ${pct}%`,"#16a34a")}
          ${chip("COMMISSION SAR",Math.round(T.commission_total).toLocaleString(),"#16a34a")}
          ${chip("PLAN REVENUE SAR",Math.round(T.revenue_total).toLocaleString())}
          ${chip("DEALERS",T.dealers.toLocaleString())}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><b style="font-size:11.5px">By plan</b>${d.byPlan.slice(0,8).map(x=>`
            <div style="display:grid;grid-template-columns:1fr 60px 90px;gap:6px;font-size:11.5px;padding:2px 0;align-items:center">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.plan||"?")}</span>
              <b style="text-align:right">${Number(x.n).toLocaleString()}</b>
              <span style="height:7px;border-radius:5px;background:linear-gradient(90deg,#16a34a,rgba(22,163,74,.25));width:${Math.max(3,100*Number(x.n)/pMax)}%"></span></div>`).join("")}</div>
          <div><b style="font-size:11.5px">Top dealers by commission</b>${d.byDealer.slice(0,8).map(x=>`
            <div style="display:grid;grid-template-columns:110px 60px 1fr;gap:6px;font-size:11.5px;padding:2px 0">
              <span>${esc(x.dealer||"?")}</span><b style="text-align:right">${Number(x.n).toLocaleString()}</b>
              <span style="color:var(--muted)">${Math.round(Number(x.commission)).toLocaleString()} SAR</span></div>`).join("")}</div>
        </div>
        <div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:8px">
          ${d.count.toLocaleString()} row(s) match${d.truncated?" (export capped — totals cover the full window)":""}
          · source ${esc(d.source)} · time col: <b>${esc(d.fields.resolved.at||"?")}</b>${d.amount_basis?` · amount: ${esc(d.amount_basis)}`:""}${d.fields.unresolved.length?` · unresolved: ${esc(d.fields.unresolved.join(", "))}`:""}</div>`;
      msg.textContent="";
      if(window.audit) window.audit("VIEW_PAGE","#dms?commission-preview");
    };
    const dl=async(fmt)=>{
      msg.textContent="Preparing "+fmt.toUpperCase()+"…";
      try{
        const r=await fetch(`${window.API_BASE||""}/api/dms/commission/report?${qs()}&format=${fmt}`,
          {headers:{"X-Console-Role":SES.role,"X-Console-User":SES.email}});
        if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||("HTTP "+r.status));
        const b=await r.blob(); const url=URL.createObjectURL(b);
        const m=/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition")||"");
        const a=document.createElement("a"); a.href=url; a.download=m?m[1]:("commission."+fmt); a.click();
        setTimeout(()=>URL.revokeObjectURL(url),1500); msg.textContent="";
      }catch(e){ msg.textContent=e.message; }
    };
    $("#cmXls").onclick=()=>dl("xlsx");
    $("#cmPdf").onclick=()=>dl("pdf");
  }

  /* ---------- ① DEALER 360 ---------- */
  function d360Search(){
    return `<div class="topo-card" style="padding:10px 12px;background:var(--card,#fff)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <b style="font-size:12px">Look up a dealer</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">dealer code · username · wallet account · terminal id · national id · mobile</span>
        <span style="position:relative;flex:1 1 260px;min-width:220px">
          <input id="d360q" autocomplete="off" placeholder="e.g. rtl_371327934 or pos_019361" style="width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
          <div id="d360ac" style="display:none;position:absolute;z-index:40;left:0;right:0;top:calc(100% + 4px);max-height:280px;overflow:auto;background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.16)"></div>
        </span>
        <button id="d360go" class="btn" style="font-size:12px;padding:6px 14px">Open</button>
        <button id="d360mask" class="pill" style="display:none;font-size:11.5px;padding:5px 12px"></button>
        <span id="d360db" class="rl" style="font-size:10.5px;color:var(--muted)"></span>
      </div>
      <!-- The wallet-statement export. Ops raises a P4 ticket for exactly this today
           (INC0020115: "commission deposit report for pos_016740, 10→19 Aug"), and waits on the
           app team. Same 11 columns as the file they return by hand. -->
      <div id="d360exp" style="display:none;margin-top:9px;padding-top:9px;border-top:1px solid var(--line);display:none;gap:8px;align-items:center;flex-wrap:wrap">
        <b style="font-size:11.5px">Wallet statement</b>
        <span class="rl" style="font-size:10px;color:var(--muted)">the report Ops raises tickets for — commission, cash and transfers</span>
        <label class="rl" style="font-size:10.5px;color:var(--muted);display:flex;gap:5px;align-items:center">from
          <input id="d360from" type="date" style="font:inherit;font-size:11.5px;padding:4px 7px;border:1px solid var(--line);border-radius:7px;background:var(--card,#fff);color:inherit"></label>
        <label class="rl" style="font-size:10.5px;color:var(--muted);display:flex;gap:5px;align-items:center">to
          <input id="d360to" type="date" style="font:inherit;font-size:11.5px;padding:4px 7px;border:1px solid var(--line);border-radius:7px;background:var(--card,#fff);color:inherit"></label>
        <button id="d360prev" class="pill" style="font-size:11px;padding:4px 10px" title="Preview the totals before downloading">Preview</button>
        <button id="d360xls" class="btn" style="font-size:11.5px;padding:5px 13px">⤓ Excel</button>
        <span id="d360expmsg" class="rl" style="font-size:10.5px;color:var(--muted)"></span>
      </div>
      <div id="d360out" style="margin-top:10px"></div></div>`;
  }
  async function renderDealer360(){
    const box=$("#dms360"); if(!box) return;
    box.innerHTML=d360Search();
    // show the cluster we are actually reading, and which node answered — the VIP balances
    api("/api/dms/db-health").then(h=>{
      const el=$("#d360db"); if(!el) return;
      if(!h.configured){ el.innerHTML=`<span style="color:var(--warn-fg)">DMS DB not configured</span>`; return; }
      el.innerHTML=h.ok
        ? `<span style="color:var(--good)">●</span> ${esc(h.host||"")} · Galera ${esc((h.galera&&h.galera.wsrep_cluster_size)||"?")} · ${h.ms} ms`
        : `<span style="color:#dc2626">● ${esc(h.error||"unreachable")}</span>`;
    }).catch(()=>{});
    const inp=$("#d360q"), go=$("#d360go"), out=$("#d360out"), mbtn=$("#d360mask");

    /* PII REVEAL — capability-gated, and an ACT rather than a mode.
     * The button only exists for a role holding `unmaskPII` (super_admin and admin). Turning it
     * on adds unmask=1 to the request; the server checks the capability again — the button is a
     * convenience, never the control — fetches the values live, and writes a `pii.unmask` audit
     * row naming the user and the dealer. It resets to MASKED on every new lookup, so a reveal
     * is always a fresh, deliberate decision about one specific record. */
    const um=()=>!!(window.PII&&window.PII.on);            // GLOBAL PII mode (see dmsjourney.js)
    const canUnmask=()=>!!(window.PII&&window.PII.can());
    const paintMaskBtn=()=>{
      if(!mbtn) return;
      if(!canUnmask()){ mbtn.style.display="none"; return; }
      mbtn.style.display="";
      mbtn.textContent = um() ? "🔓 Unmasked — hide" : "🔒 Masked — reveal";
      mbtn.style.borderLeftColor = um() ? "#dc2626" : "var(--line)";
      mbtn.title = um()
        ? "Identifiers are shown in full. Every reveal is recorded in the audit log."
        : "Reveal this dealer's identifiers in full. The action is recorded in the audit log.";
    };
    const run=async()=>{
      const q=(inp.value||"").trim(); if(!q) return;
      out.innerHTML=`<div class="rl">loading…</div>`;
      let d; try{ d=await api(`/api/dms/dealer360?q=${encodeURIComponent(q)}${um()?"&unmask=1":""}`); }
      catch(e){ out.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
      if(window.audit) window.audit(um()?"DEALER_360_UNMASK":"DEALER_360", q.slice(0,40));
      out.innerHTML=(d.unmasked?`<div style="border:1px solid #dc2626;border-radius:9px;padding:6px 11px;margin-bottom:9px;background:rgba(220,38,38,.06);font-size:11px;font-weight:700;color:#dc2626">🔓 Identifiers shown in full — this reveal is recorded in the audit log.</div>`:"")
        + d360Html(d);
      paintMaskBtn();
      /* EVERYTHING THIS DEALER DID IN DMS — every audit ledger, window-bounded, journeys + list (dmsactivity.js, 17 Sep 2026) */
      if(d.found && d.dealer && window.renderDealerActivity){
        const h=document.createElement("div"); h.id="d360act"; out.appendChild(h);
        window.renderDealerActivity(h,{username:d.dealer.username,dealer_code:d.dealer.dealer_code,id:d.dealer.id,q:q},{days:7});
      }
      // the export row only makes sense once a dealer is on screen, and only if they have a wallet
      const exp=$("#d360exp");
      if(exp){
        const ok=d.found && d.dealer && d.dealer.account_number;
        exp.style.display = ok ? "flex" : "none";
        if(ok && !$("#d360from").value){
          const t=new Date(), f=new Date(t.getTime()-9*86400e3);   // the ticket's own 10-day shape
          $("#d360to").value=t.toISOString().slice(0,10);
          $("#d360from").value=f.toISOString().slice(0,10);
        }
        $("#d360expmsg").textContent="";
      }
    };
    go.addEventListener("click",()=>{ paintMaskBtn(); run(); });   // follows the GLOBAL PII mode
    if(mbtn) mbtn.addEventListener("click",()=>{ window.PII.set(!window.PII.on); paintMaskBtn(); if((inp.value||"").trim()) run(); });
    paintMaskBtn();

    /* ---- wallet statement: preview, then download ---- */
    const stQs=()=>{
      const q=encodeURIComponent((inp.value||"").trim());
      const f=$("#d360from").value, t=$("#d360to").value;
      return `q=${q}${f?`&from=${f}`:""}${t?`&to=${t}`:""}${um()?"&unmask=1":""}`;
    };
    const msg=$("#d360expmsg");
    const prev=$("#d360prev");
    if(prev) prev.addEventListener("click",async()=>{
      if(!(inp.value||"").trim()) return;
      msg.textContent="checking…";
      try{
        const s=await api(`/api/dms/dealer/statement?${stQs()}`);
        if(!s.ok){ msg.innerHTML=`<span style="color:#dc2626">${esc(s.error||"unavailable")}</span>`
            +(s.fix?`<div style="color:var(--muted);font-size:10px;white-space:normal;max-width:640px">${esc(s.fix)}</div>`:""); return; }
        const T=s.totals||{}, m=v=>Number(v||0).toLocaleString();
        msg.innerHTML=`<b>${m(s.count)}</b> rows · in <b style="color:var(--good)">${m(T.in)}</b> · out <b style="color:#dc2626">${m(T.out)}</b>`
          +` · commission <b>${m(T.commission)}</b> · closing <b>${m(T.closing)}</b>`
          +` <span style="color:var(--muted)">· ${esc((s.by_type||[]).map(x=>`${x.type} ${x.count}`).join(" · "))}`
          +`${(s.by_status||[]).length>1?" · status: "+esc(s.by_status.map(x=>`${x.status} ${x.count}`).join(", ")):""}</span>`
          +`<div style="color:var(--muted);font-size:10px;white-space:normal">source ${esc(s.source&&s.source.table||"?")} · ${esc(s.source&&s.source.query_plan||"")} · ${esc(s.source&&s.source.running_balance_basis||"")}</div>`;
      }catch(e){ msg.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; }
    });
    const xls=$("#d360xls");
    if(xls) xls.addEventListener("click",async()=>{
      if(!(inp.value||"").trim()) return;
      /* An <a download> hands the response straight to the browser, which happily SAVED THE ERROR:
         a failed request produced a 26-byte "statement.json" in Downloads and the UI still said
         "downloaded". Fetch it instead and inspect the content type — a JSON body is an error to
         show inline, only a spreadsheet becomes a file. */
      xls.disabled=true; msg.textContent="preparing…";
      try{
        const r=await fetch(`${window.API_BASE||""}/api/dms/dealer/statement?${stQs()}&format=xlsx`,{headers:{"X-Console-Role":SES.role,"X-Console-User":SES.email}});
        const ct=r.headers.get("content-type")||"";
        if(!r.ok||ct.includes("json")){
          let e={}; try{ e=await r.json(); }catch(_){}
          msg.innerHTML=`<span style="color:#dc2626">${esc(e.error||("HTTP "+r.status))}</span>`
            +(e.fix?`<div style="color:var(--muted);font-size:10px;white-space:normal;max-width:640px">${esc(e.fix)}</div>`:"");
          return;
        }
        const blob=await r.blob();
        if(blob.size<400){ msg.innerHTML=`<span style="color:#dc2626">The file came back empty (${blob.size} bytes) — not saved.</span>`; return; }
        const cd=r.headers.get("content-disposition")||"";
        const m=/filename="([^"]+)"/.exec(cd);
        const url=URL.createObjectURL(blob);
        const a=document.createElement("a"); a.href=url; a.download=m?m[1]:"statement.xlsx";
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),4000);
        msg.innerHTML=`<span style="color:var(--good)">saved ${esc(a.download)} · ${(blob.size/1024).toFixed(0)} KB</span>`;
        if(window.audit) window.audit("DEALER_STATEMENT_XLSX",(inp.value||"").trim().slice(0,40));
      }catch(e){ msg.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; }
      finally{ xls.disabled=false; }
    });

    /* Autocomplete on DEALER CODE only, as asked — the other accepted identifiers (national id,
       mobile, wallet account) are PII and must not be offered as a browsable list. Debounced so
       typing does not fire a query per keystroke, and keyboard-navigable. */
    const ac=$("#d360ac"); let acRows=[], acIdx=-1, acTimer=null;
    const acClose=()=>{ ac.style.display="none"; acRows=[]; acIdx=-1; };
    const acPaint=()=>{
      if(!acRows.length) return acClose();
      ac.innerHTML=acRows.map((r,i)=>`<div class="d360ac-row" data-i="${i}" style="padding:7px 10px;cursor:pointer;display:flex;gap:8px;align-items:baseline;${i===acIdx?"background:var(--line-soft,rgba(148,163,184,.22))":""}">
        <span class="mono" style="font-size:11.5px;font-weight:700">${esc(r.dealer_code)}</span>
        <span style="font-size:10.5px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name||r.username||"")}</span>
        <span style="font-size:9.5px;color:${r.status&&/active/i.test(r.status)?"#16a34a":"#94a3b8"}">${esc(r.status||"")}</span>
      </div>`).join("");
      ac.style.display="block";
      ac.querySelectorAll(".d360ac-row").forEach(el=>el.addEventListener("mousedown",ev=>{
        ev.preventDefault(); inp.value=acRows[Number(el.dataset.i)].dealer_code; acClose(); paintMaskBtn(); run();
      }));
    };
    inp.addEventListener("input",()=>{
      const v=inp.value.trim();
      clearTimeout(acTimer);
      if(v.length<2) return acClose();
      acTimer=setTimeout(async()=>{
        try{ const r=await api(`/api/dms/dealer-codes?q=${encodeURIComponent(v)}`); acRows=r.rows||[]; acIdx=-1; acPaint(); }
        catch(e){ acClose(); }
      },220);
    });
    inp.addEventListener("keydown",e=>{
      if(ac.style.display==="block"&&acRows.length){
        if(e.key==="ArrowDown"){ e.preventDefault(); acIdx=Math.min(acRows.length-1,acIdx+1); acPaint(); return; }
        if(e.key==="ArrowUp"){ e.preventDefault(); acIdx=Math.max(0,acIdx-1); acPaint(); return; }
        if(e.key==="Escape"){ acClose(); return; }
        if(e.key==="Enter"&&acIdx>=0){ e.preventDefault(); inp.value=acRows[acIdx].dealer_code; acClose(); paintMaskBtn(); run(); return; }
      }
      if(e.key==="Enter"){ acClose(); paintMaskBtn(); run(); }
    });
    inp.addEventListener("blur",()=>setTimeout(acClose,120));

    renderBoard();
  }

  /* ---------- ①b DEALERS BOARD ---------- */
  let _boardState={ sort:"earned", limit:50 };
  async function renderBoard(){
    const host=$("#dms360"); if(!host) return;
    let wrap=$("#d360board");
    if(!wrap){ wrap=document.createElement("div"); wrap.id="d360board"; wrap.style.marginTop="12px"; host.appendChild(wrap); }
    wrap.innerHTML=`<div class="rl" style="padding:8px 2px">Loading dealer board…</div>`;
    const qs=Object.entries(_boardState).filter(([,v])=>v!=null&&v!=="").map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join("&");
    let d; try{ d=await api(`/api/dms/dealers?${qs}`); }
    catch(e){ wrap.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    if(!d.ok){ wrap.innerHTML=`<div class="albanner">${esc(d.error||"unavailable")}</div>`; return; }
    const F=d.facets||{}, T=d.totals||{};
    const money=v=>v==null?"—":Number(v).toLocaleString();
    const sel=(id,label,key,opts)=>`<label style="display:flex;gap:5px;align-items:center;font-size:10.5px;color:var(--muted)">${esc(label)}
      <select id="${id}" data-k="${key}" style="font:inherit;font-size:11.5px;padding:4px 7px;border:1px solid var(--line);border-radius:7px;background:var(--card,#fff);color:inherit">
        <option value="">all</option>${(opts||[]).map(o=>`<option value="${esc(o.value)}"${_boardState[key]===o.value?" selected":""}>${esc(o.value)} (${o.count})</option>`).join("")}
      </select></label>`;
    const SORTL=[["earned","Top earners"],["unpaid","Most unpaid"],["deals","Most deals"],["paid","Most paid"],["newest","Newest"],["name","Code A–Z"]];
    const tone=t=>t==="bad"?"#dc2626":t==="warn"?"var(--warn-fg)":"#16a34a";
    const rows=(d.rows||[]).map(r=>`<tr class="d360row" data-code="${esc(r.dealer_code||r.username||"")}" style="cursor:pointer">
      <td class="mono" style="font-weight:700">${esc(r.dealer_code||"—")}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name||r.username||"—")}</td>
      <td style="font-size:10.5px">${esc(r.dealer_type||"—")}</td>
      <td style="font-size:10.5px;color:${r.status&&/active/i.test(r.status)?"#16a34a":"var(--warn-fg)"}">${esc(r.status||"—")}</td>
      <td style="text-align:right">${money(r.deals)}</td>
      <td style="text-align:right;font-weight:700">${money(r.earned)}</td>
      <td style="text-align:right;color:${r.paid===0&&r.earned>0?"#dc2626":"inherit"}">${money(r.paid)}</td>
      <td style="text-align:right;font-weight:700;color:${r.unpaid>0?"#dc2626":"#16a34a"}">${money(r.unpaid)}</td>
      <td style="font-size:10.5px">${r.last_login?esc(KT.d(r.last_login)):'<span style="color:var(--warn-fg)">never</span>'}</td>
      <td>${(r.badges||[]).slice(0,3).map(b=>`<span style="display:inline-block;font-size:9px;font-weight:800;border:1px solid ${tone(b.tone)};color:${tone(b.tone)};border-radius:999px;padding:1px 7px;margin:1px 2px 1px 0">${esc(b.label)}</span>`).join("")}</td></tr>`).join("");
    wrap.innerHTML=`<div class="topo-card" style="padding:10px 12px;background:var(--card,#fff)">
      <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <b style="font-size:12px">Dealer board</b>
        <input id="bq" placeholder="search code / name / shop" value="${esc(_boardState.q||"")}" style="flex:1 1 180px;min-width:150px;font:inherit;font-size:11.5px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
        ${sel("bType","type","dealer_type",F.dealer_type)}
        ${sel("bStatus","status","status",F.status)}
        ${F.region?sel("bRegion","region","region",F.region):""}
        ${F.location_of_sales?sel("bLoc","location","location_of_sales",F.location_of_sales):""}
        ${F.partner?sel("bPartner","partner","partner",F.partner):""}
        <label style="display:flex;gap:5px;align-items:center;font-size:10.5px;color:var(--muted)">rank
          <select id="bSort" style="font:inherit;font-size:11.5px;padding:4px 7px;border:1px solid var(--line);border-radius:7px;background:var(--card,#fff);color:inherit">
            ${SORTL.map(([k,l])=>`<option value="${k}"${_boardState.sort===k?" selected":""}>${l}</option>`).join("")}</select></label>
      </div>
      <div class="topo-stats" style="margin-bottom:8px">
        <div class="stat" style="min-width:120px"><b>${money(d.shown)}</b><span>DEALERS SHOWN</span></div>
        <div class="stat" style="min-width:120px"><b>${money(T.deals)}</b><span>DEALS</span></div>
        <!-- EARNED chip removed 1 Sep: with zero payouts so far it always equals UNPAID —
             two identical numbers side by side read as a bug. UNPAID is the actionable one;
             per-dealer earned/paid detail stays in the table columns below. -->
        <div class="stat" style="min-width:130px"><b style="color:${T.unpaid?"#dc2626":"#16a34a"}">${money(T.unpaid)}</b><span>UNPAID</span></div>
        <div class="stat" style="min-width:140px"><b style="color:${T.never_paid?"#dc2626":"#16a34a"}">${money(T.never_paid)}</b><span>NEVER PAID OUT</span></div>
      </div>
      ${rows?`<table class="alerts"><tr><th>CODE</th><th>NAME</th><th>TYPE</th><th>STATUS</th><th style="text-align:right">DEALS</th><th style="text-align:right">EARNED</th><th style="text-align:right">PAID</th><th style="text-align:right">UNPAID</th><th>LAST LOGIN</th><th>FLAGS</th></tr>${rows}</table>`
        :`<div class="rl" style="padding:8px 2px">No dealers match these filters.</div>`}
      ${d.note?`<div class="rl" style="font-size:10px;color:var(--muted);margin-top:6px;white-space:normal">${esc(d.note)}</div>`:""}
    </div>`;
    // wiring
    wrap.querySelectorAll("select[data-k]").forEach(s=>s.addEventListener("change",()=>{ _boardState[s.dataset.k]=s.value||undefined; renderBoard(); }));
    const bs=$("#bSort"); if(bs) bs.addEventListener("change",()=>{ _boardState.sort=bs.value; renderBoard(); });
    const bq=$("#bq"); if(bq){ let t=null; bq.addEventListener("input",()=>{ clearTimeout(t); t=setTimeout(()=>{ _boardState.q=bq.value.trim()||undefined; renderBoard(); },350); }); }
    wrap.querySelectorAll(".d360row").forEach(tr=>tr.addEventListener("click",()=>{
      const q=tr.dataset.code; const inp=$("#d360q"); if(!inp||!q) return;
      inp.value=q; $("#d360go").click();
      document.getElementById("dms360").scrollIntoView({behavior:"smooth",block:"start"});
    }));
  }
  function d360Html(d){
    if(!d.ok) return `<div class="albanner">${esc(d.error||"unavailable")}</div>`;
    if(!d.found) return `<div class="rl" style="padding:8px 2px">${esc(d.note||"No dealer matched.")}</div>`;
    const P=d.dealer, S=d.security, C=d.commission, W=d.wallet, ST=d.stock, SE=d.sessions, A=d.activity;
    const kv=(k,v,c)=>`<div style="display:flex;gap:10px;font-size:11.5px;padding:2px 0"><span style="width:120px;color:var(--muted);flex:0 0 auto">${esc(k)}</span><b style="${c?`color:${c}`:""};min-width:0;overflow-wrap:anywhere">${v==null||v===""?"—":v}</b></div>`;
    const card=(title,accent,body,foot)=>`<div style="flex:1 1 300px;min-width:280px;border:1px solid var(--line);border-left:4px solid ${accent};border-radius:12px;padding:10px 13px;background:var(--card,#fff)">
      <div style="font-size:10.5px;font-weight:800;letter-spacing:.05em;color:${accent};margin-bottom:6px">${esc(title)}</div>${body}
      ${foot?`<div class="rl" style="font-size:10px;color:var(--muted);white-space:normal;margin-top:6px">${esc(foot)}</div>`:""}</div>`;
    const onoff=b=>b==null?'<span style="color:var(--muted)">—</span>':(b?'<span style="color:var(--good)">on</span>':'<span style="color:#94a3b8">off</span>');
    const money=v=>v==null?"—":Number(v).toLocaleString();

    const warn=(S.warnings||[]).length
      ? `<div style="border:1px solid #dc2626;border-radius:10px;padding:8px 12px;margin-bottom:10px;background:rgba(220,38,38,.06)">
          ${S.warnings.map(w=>`<div style="font-size:11.5px;font-weight:700;color:#dc2626">⚠ ${esc(w)}</div>`).join("")}</div>` : "";

    const prof=card("PROFILE","#2563eb",
      kv("name",esc(P.name||P.username))+kv("dealer code",`<span class="mono">${esc(P.dealer_code||"—")}</span>`)+
      kv("username",`<span class="mono">${esc(P.username||"—")}</span>`)+kv("type",esc(P.dealer_type||"—"))+
      kv("status",esc(P.status||"—"),P.status&&/active/i.test(P.status)?"#16a34a":"#d97706")+
      kv("shop / terminal",`${esc(P.shop_code||"—")} / ${esc(P.terminal_id||"—")}`)+
      kv("contact",`<span class="mono">${esc(P.contact_number||"—")}</span>`)+
      kv("national id",`<span class="mono">${esc(P.national_id||"—")}</span>`)+
      kv("created",P.created_at?esc(KT.dt(P.created_at)):"—")+
      (P.deactivation_reason?kv("deactivated",esc(P.deactivation_reason),"#dc2626"):""));

    const sec=card("SECURITY","#7c3aed",
      kv("QR",`${onoff(S.qr_enabled)}${S.login_without_qr?' · <span style="color:var(--warn-fg)">login without QR allowed</span>':""}`)+
      kv("device reg.",`${onoff(S.device_registration)} · max ${S.max_devices??"—"}`)+
      kv("max sessions",S.max_sessions??"—")+
      kv("VPN / finger",`${onoff(S.vpn)} / ${onoff(S.fingerprint)}`)+
      kv("IAM tok / OTP",`${onoff(S.iam_token)} / ${onoff(S.iam_otp)}`)+
      kv("Absher",onoff(S.absher))+
      kv("Semati/Nafath",S.semati_nafath_bypass?'<span style="color:#dc2626">BYPASSED</span>':'<span style="color:var(--good)">enforced</span>'),
      "Semati/Nafath is the regulator-required identity check. A bypass here is a deliberate exception.");

    const ses=card("SESSIONS","#0891b2",
      SE.available
        ? kv("last login",SE.last_login?esc(KT.dt(SE.last_login)):"—")+
          kv("last logout",SE.last_logout?esc(KT.dt(SE.last_logout)):"—")+
          kv("open now",SE.open_now?'<span style="color:var(--good)">YES</span>':(SE.dangling_no_logout?'<span style="color:var(--warn-fg)">no — logout never written</span>':"no"))+
          kv("logout coverage",esc(SE.logout_coverage||"—"))
        : `<div class="rl" style="font-size:11px">${esc(SE.why||SE.error||"not available")}</div>`,
      SE.available?SE.note:null);

    const wal=card("WALLET","#0e9f5a",
      W.available
        ? kv("account",`<span class="mono">${esc((W.account&&W.account.account_number)||P.account_number||"—")}</span>`)+
          kv("status",esc((W.account&&W.account.status)||"—"))+
          kv("balance",W.balance&&W.balance.amount!=null?money(W.balance.amount):(W.balance&&W.balance.amount_raw!=null?`<span class="mono">${esc(W.balance.amount_raw)}</span>`:"—"))+
          kv("recent refills",(W.refills||[]).length)
        : `<div class="rl" style="font-size:11px">${esc(W.why||W.error||"not available")}</div>`,
      W.balance_note||null);

    const comRows=(C.by_month||[]).slice(0,6).map(m=>`<tr><td class="mono">${esc(m.month)}</td>
      <td style="text-align:right">${money(m.earned)}</td><td style="text-align:right">${money(m.paid)}</td></tr>`).join("");
    const com=card("COMMISSION","#d97706",
      C.available
        ? kv("earned",money(C.earned))+
          kv("paid out",C.paid==null?"—":money(C.paid),C.paid===0&&C.earned>0?"#dc2626":null)+
          kv("UNPAID",C.unpaid==null?"—":money(C.unpaid),C.unpaid>0?"#dc2626":"#16a34a")+
          kv("to wallet",C.to_wallet==null?"—":money(C.to_wallet))+
          kv("pending",C.pending_milestones?`${money(C.pending_milestones.rows)} milestones`:"—")+
          (comRows?`<table class="alerts" style="margin-top:6px"><tr><th>MONTH</th><th style="text-align:right">EARNED</th><th style="text-align:right">PAID</th></tr>${comRows}</table>`:"")
        : `<div class="rl" style="font-size:11px">${esc(C.why||C.error||"not available")}</div>`,
      C.available?C.note:null);

    const stk=card("SIM STOCK","#e11d48",
      ST.available
        ? kv("ranges",(ST.ranges||[]).length)+kv("total sims",money(ST.total_sims))+
          kv("sold",money(ST.sold))+kv("unsold",money(ST.unsold))
        : `<div class="rl" style="font-size:11px">${esc(ST.why||ST.error||"not available")}</div>`);

    const act=card("ACTIVITY","#64748b",
      A.available
        ? kv("activations",(A.activations||[]).length)+kv("source",`<span class="mono" style="font-size:10px">${esc(A.source||"")}</span>`)+
          (A.report_pulls?kv("report pulls",money(A.report_pulls.count)):"")
        : `<div class="rl" style="font-size:11px;white-space:normal">${esc(A.why||"not available")}</div>`,
      A.report_pulls?A.report_pulls.note:null);

    const AS=d.app_side||{};
    const app=card("APP-SIDE (sellers)",AS.found?(AS.mismatches&&AS.mismatches.length?"#d97706":"#16a34a"):"#94a3b8",
      AS.found
        ? kv("seller id",AS.seller.id)+kv("username",esc(AS.seller.username||"—"))+
          (AS.mismatches&&AS.mismatches.length
            ? AS.mismatches.map(m=>`<div style="font-size:11px;color:#d97706">⚠ ${esc(m.field)}: DMS “${esc(m.dms)}” vs app “${esc(m.app)}”</div>`).join("")
            : `<div style="font-size:11.5px;color:var(--good);font-weight:700">✓ fields agree</div>`)
        : `<div class="rl" style="font-size:11px;white-space:normal">${esc(AS.note||"no match")}</div>`);

    return warn+`<div style="display:flex;gap:10px;flex-wrap:wrap">${prof}${sec}${ses}${wal}${com}${stk}${act}${app}</div>`;
  }

  /* ⓪ HOME block — the ops-console header, dealer-flavored: today (00:00 KSA →) vs yesterday
   * SAME TIME-OF-DAY, outcome mix bar, needs-attention, top dealers today, go-to shortcuts.
   * Always TODAY — deliberately independent of the window picker (pace only means "so far"). */
  async function renderHome(){
    const box=$("#dmsHome"); if(!box) return;
    let d; try{ d=await api("/api/dms/home"); }catch(e){ box.innerHTML=""; return; }
    /* DMS-channel truth for the headline cards. The replica (onboarding_orders) covers ONLY the
     * Salam-app dealer flow — 2 dealers — which made "1 dealer yesterday" look wrong. It wasn't
     * wrong, it was a different population. Headline = DMS audit trail; app flow = sub-line. */
    let h2=null; try{ h2=await api("/api/dms/journeys/home"); }catch(e){}
    // top dealer-side gateway pain for needs-attention (last 24h, cheap console-DB read)
    let gw=null; try{
      const to=new Date(), from=new Date(to.getTime()-24*3600e3);
      gw=await api(`/api/apigw/dealers?from=${from.toISOString()}&to=${to.toISOString()}`);
    }catch(e){}
    const dmsOk=!!(h2&&h2.ok);
    const t=dmsOk?h2.today:(d.today||{}), y=dmsOk?h2.yesterday_same_time:(d.yesterday_same_time||{});
    if(dmsOk) d.pace=h2.pace;
    const at=d.today||{}, ay=d.yesterday_same_time||{};   // Salam-app flow (replica) for the sub-line
    const conv=t.attempts?Math.round(100*t.activated/t.attempts):null;
    const yconv=y.attempts?Math.round(100*y.activated/y.attempts):null;
    const hh=new Date();
    const hr=(new Date(hh.getTime()+3*3600e3)).getUTCHours();
    const greet=hr<12?"Good morning":hr<17?"Good afternoon":"Good evening";
    const who=(window.opsSession&&window.opsSession().me&&window.opsSession().me.name)||"";
    const delta=(a,b,inv)=>{ a=a==null?0:a; b=b==null?0:b; const df=a-b; if(!b&&!a) return "";
      const up=df>0, good=inv?!up:up;
      return df===0?`<span style="font-size:10.5px;color:var(--muted)">= yday same time</span>`
        :`<span style="font-size:10.5px;font-weight:700;color:${good?"#16a34a":"#dc2626"}">${up?"▲":"▼"} ${n(Math.abs(df))} vs yday same time</span>`; };
    const card=(big,label,sub,c)=>`<div style="flex:1;min-width:150px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 14px">
      <div class="rl" style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">${esc(label)}</div>
      <div style="font-size:24px;font-weight:800;color:${c||'var(--ink)'}">${big}</div>
      <div style="margin-top:2px">${sub||""}</div></div>`;
    // outcome mix bar
    const m=d.mix||{}; const tot=(m.activated||0)+(m.awaiting_activation||0)+(m.in_progress||0)+(m.archived||0);
    const seg=(v,c)=>tot&&v?`<span style="display:inline-block;height:9px;width:${Math.max(1,100*v/tot)}%;background:${c}"></span>`:"";
    const mixBar=tot?`<div style="border-radius:6px;overflow:hidden;white-space:nowrap;font-size:0;margin:10px 0 4px">${seg(m.activated,"#10b981")}${seg(m.awaiting_activation,"#d97706")}${seg(m.in_progress,"#94a3b8")}${seg(m.archived,"#64748b")}</div>
      <div class="rl" style="font-size:10.5px;color:var(--muted);margin-bottom:8px">
        <span style="color:#10b981">● activated ${n(m.activated)}</span> · <span style="color:#d97706">● awaiting activation ${n(m.awaiting_activation)}</span>
        · <span style="color:#94a3b8">● in progress ${n(m.in_progress)}</span>${m.archived?` · <span style="color:var(--muted)">● archived ${n(m.archived)}</span>`:""}</div>`:"";
    // needs attention
    const att=[];
    if(d.stagnant_dealers) att.push(`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line)">
      <span>⚠</span><span style="flex:1;font-size:12px"><b>${n(d.stagnant_dealers)} dealer${d.stagnant_dealers===1?"":"s"}</b> with ≥5 attempts and <b>0 activations</b> today — check what is blocking them.</span>
      <button class="pill dms-goto" data-go="dealers" style="padding:2px 10px;font-size:10.5px">Open roster</button></div>`);
    if(gw&&gw.configured){
      const bad=(gw.ops||[]).filter(o=>o.errors>0).sort((a,b)=>b.errors-a.errors)[0];
      if(bad) att.push(`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line)">
        <span>⚠</span><span style="flex:1;font-size:12px">Top dealer-side gateway failure (24h): <b>${esc(bad.op)}</b> — ${n(bad.errors)} errors / ${n(bad.calls)} calls${bad.calls?` (${Math.round(100*bad.errors/bad.calls)}%)`:""}.</span>
        <button class="pill dms-goto" data-go="gw" style="padding:2px 10px;font-size:10.5px">See operations</button></div>`);
      const lg=gw.kpis&&gw.kpis.logins;
      if(lg&&lg.errors&&lg.calls&&(100*lg.errors/lg.calls)>=3) att.push(`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line)">
        <span>⚠</span><span style="flex:1;font-size:12px">Dealer login failures (24h): <b>${(100*lg.errors/lg.calls).toFixed(1)}%</b> (${n(lg.errors)}/${n(lg.calls)} Keycloak userinfo).</span></div>`);
    }
    const topRows=(d.top_dealers||[]).map(x=>`<div style="display:flex;gap:8px;padding:3px 0;border-top:1px solid var(--line);font-size:11.5px">
      <span style="flex:1;font-weight:600">${esc(x.name||"—")}</span>
      <span class="mono">${n(x.placed)}</span><span class="mono" style="color:var(--good);font-weight:700;min-width:26px;text-align:right">${n(x.done)}</span></div>`).join("");
    const go=(id,l,s)=>`<button class="pill dms-goto" data-go="${id}" style="padding:7px 14px;text-align:left"><b style="font-size:12px">${esc(l)}</b><br><span class="rl" style="font-size:10px;color:var(--muted)">${esc(s)}</span></button>`;
    box.innerHTML=`
      <div style="margin-bottom:8px"><b style="font-size:15px">${greet}${who?", "+esc(who.split(" ")[0]):""}</b>
        <span class="rl" style="color:var(--muted)"> · dealer activity since 00:00 KSA${dmsOk?` · <b>DMS channel — all dealers</b> (source: DMS audit trail, success code ${esc(h2.success_code)})`:" · Salam-app flow (replica)"}</span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${card(d.pace==null?"—":d.pace+"%","Pace vs yesterday",`<span class="rl" style="font-size:10.5px;color:var(--muted)">same time-of-day compare</span>`,d.pace==null?null:d.pace>=100?"#16a34a":d.pace>=80?"#d97706":"#dc2626")}
        ${card(n(t.attempts),"Attempts today",delta(t.attempts,y.attempts))}
        ${card(n(t.activated),"Activated today",delta(t.activated,y.activated),"#16a34a")}
        ${card(conv==null?"—":conv+"%","Conversion",delta(conv,yconv))}
        ${card(n(t.dealers),"Active dealers",delta(t.dealers,y.dealers),"#2563eb")}
      </div>
      ${dmsOk?`<div class="rl" style="font-size:10.5px;color:var(--muted);margin:2px 0 6px">Salam-app flow (replica, subset): ${n(at.attempts)} attempts · ${n(at.activated)} activated · ${n(at.dealers)} dealer(s) — the outcome bar and "top dealers" below describe this app flow only.</div>`:""}
      ${mixBar}
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:stretch">
        <div style="flex:2;min-width:340px;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px 14px">
          <b style="font-size:11px;letter-spacing:.03em;color:var(--muted)">NEEDS ATTENTION</b>
          ${att.length?att.join(""):`<div class="rl" style="padding:8px 0;color:var(--good);font-weight:700">Nothing flagged — dealer channel looks healthy right now.</div>`}</div>
        <div style="flex:1;min-width:250px;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px 14px">
          <div style="display:flex;font-size:10px;color:var(--muted)"><b style="flex:1;letter-spacing:.03em">TOP DEALERS TODAY</b><span>PLACED</span><span style="min-width:34px;text-align:right">DONE</span></div>
          ${topRows||`<div class="rl" style="padding:8px 0">No dealer orders yet today.</div>`}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${go("dealers","Dealers","map · roster · KPIs")}${go("gw","Dealer gateway","APIGW · in Monitoring")}
        ${go("ts","Troubleshoot","live failures")}${go("mon","Monitoring","APIGW · API health")}${go("alerts","Alerts","rules & firings")}
      </div>`;
    box.querySelectorAll(".dms-goto").forEach(b=>b.addEventListener("click",()=>{
      const g=b.dataset.go;
      if(g==="dealers"){ const el=$("#dmsMap3"); if(el) el.scrollIntoView({behavior:"smooth"}); }
      else if(g==="gw"&&window.openMonitoring) window.openMonitoring("gateway");
      else if(g==="ts"&&window.setConsoleHash) window.setConsoleHash("troubleshoot");
      else if(g==="mon"&&window.setConsoleHash) window.setConsoleHash("monitoring");
      else if(g==="alerts"&&window.setConsoleHash) window.setConsoleHash("alerts");
    }));
  }

  /* ③ COMMISSIONING — rebuilt 31 Aug on DMS TRUTH. The old version rendered the replica's
   * dealers_dms analytics board: Salam-app flow only (5 orders · 1 dealer · "Unknown" dealer
   * group), which read as broken next to the real network. This one reads the activation ledger
   * + rate table through the commission module — same numbers as the exports, range-driven. */
  async function renderBiz(){
    const grid=$("#dmsBiz"); if(!grid) return;
    const w=win();
    grid.innerHTML=`<div class="rl">Loading commissioning…</div>`;
    let d; try{ d=await api(`/api/dms/commission/report?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`); }
    catch(e){ grid.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const T=d.totals||{}, money=v=>Math.round(Number(v||0)).toLocaleString();
    const pct=T.total?Math.round(100*T.with_commission/T.total):0;
    const chip=(v,l,c)=>`<div style="flex:1;min-width:150px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 14px">
      <div style="font-size:22px;font-weight:800;color:${c||'var(--ink)'}">${v}</div>
      <div class="rl" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">${esc(l)}</div></div>`;
    const days=d.byDay||[], dMax=Math.max(1,...days.map(x=>Number(x.n)));
    const dayBars=days.map(x=>`<div title="${esc(String(x.day).slice(0,10))} · ${money(x.n)} activation(s) · ${money(x.commission)} SAR commission" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:64px;min-width:8px">
        <div style="background:#0e9f5a;opacity:.75;border-radius:2px 2px 0 0;height:${Math.max(2,Math.round(58*Number(x.n)/dMax))}px"></div>
        <div class="rl" style="font-size:7.5px;text-align:center;color:var(--muted)">${esc(String(x.day).slice(8,10))}</div></div>`).join("");
    const pMax=Math.max(1,...(d.byPlan||[]).map(x=>Number(x.n)));
    const plans=(d.byPlan||[]).slice(0,9).map(x=>`<div style="display:grid;grid-template-columns:1fr 52px 80px;gap:7px;font-size:11.5px;padding:2.5px 0;align-items:center">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.plan||"?")}">${esc(x.plan||"?")}</span>
        <b style="text-align:right">${money(x.n)}</b>
        <span style="height:8px;border-radius:5px;background:linear-gradient(90deg,#0e9f5a,rgba(14,159,90,.25));width:${Math.max(3,100*Number(x.n)/pMax)}%"></span></div>`).join("");
    const dealers=(d.byDealer||[]).slice(0,9).map(x=>`<div style="display:grid;grid-template-columns:120px 46px 1fr;gap:7px;font-size:11.5px;padding:2.5px 0;align-items:center">
        <button class="mono biz-dlr" data-d="${esc(x.dealer||"")}" style="cursor:pointer;background:none;border:none;color:inherit;font-size:11.5px;padding:0;text-align:left;text-decoration:underline dotted" title="Open dealer popup">${esc(x.dealer||"?")}</button>
        <b style="text-align:right">${money(x.n)}</b>
        <span style="color:var(--muted)">${money(x.commission)} SAR</span></div>`).join("");
    grid.innerHTML=`
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        ${chip(money(T.total),"Activations")}
        ${chip(`${money(T.with_commission)} · ${pct}%`,"With commission","#16a34a")}
        ${chip(money(T.commission_total)+" SAR","Commission (computed)","#16a34a")}
        ${chip(money(T.revenue_total)+" SAR","Plan revenue")}
        ${chip(money(T.dealers),"Selling dealers","#2563eb")}
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:stretch">
        <div style="flex:2;min-width:340px;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px 14px">
          <b style="font-size:11px">Activations per day</b>
          <div style="display:flex;gap:3px;align-items:flex-end;margin-top:6px">${dayBars||'<span class="rl">no data in range</span>'}</div></div>
        <div style="flex:1;min-width:270px;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px 14px">
          <b style="font-size:11px">Top plans</b>${plans||'<div class="rl" style="font-size:11px">—</div>'}</div>
        <div style="flex:1;min-width:270px;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px 14px">
          <b style="font-size:11px">Top dealers by commission</b> <span class="rl" style="font-size:9px;color:var(--muted)">click → dealer popup</span>${dealers||'<div class="rl" style="font-size:11px">—</div>'}</div>
      </div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-top:7px">source ${esc(d.source)} · ${esc(d.amount_basis||"")} · full list &amp; exports in ③b below</div>`;
    grid.querySelectorAll(".biz-dlr").forEach(b=>b.addEventListener("click",()=>{
      if(window.openDealerPopup) window.openDealerPopup(b.dataset.d);
    }));
  }

  /* Dealer gateway activity — the APIGW view of dealer work. LIVES ON MONITORING → GATEWAY & API
   * since 31 Aug 2026 (DMS L2, Waleed: /api/uil/* endpoints are APIGW, not DMS). The code stays in
   * this file because it shares the dealer window picker + drill helpers; only the target moved. */
  async function renderGw(){
    const box=$("#monDealerGw"); if(!box) return;
    /* DMS journey/grandfather alerts strip — the recharge case (BSS fault 21, found by customers)
     * is exactly what should light up HERE first. Best-effort; alert pipeline is the source. */
    let dmsAlerts=[], alertsErr=null;
    try{ const al=await api("/api/alerts?status=open");
      dmsAlerts=(al.alerts||al.rows||(Array.isArray(al)?al:[])).filter(x=>String(x.rule_key||"").startsWith("dms:")); }
    catch(e){ alertsErr=e.message; }
    /* ALWAYS render the watch line — an invisible healthy-state is unverifiable (asked 31 Aug:
     * "where is this part?"). Green = armed & quiet · red = open alerts · amber = can't read. */
    const alertStrip=dmsAlerts.length?`<div style="border:1px solid #dc2626;border-radius:11px;padding:8px 13px;margin-bottom:10px;background:rgba(220,38,38,.05)">
        <b style="font-size:11.5px;color:#dc2626">⚠ DMS journey alerts (${dmsAlerts.length} open)</b>
        ${dmsAlerts.slice(0,4).map(x=>`<div style="font-size:11px;padding:2px 0"><b style="color:${x.severity==="P2"?"#dc2626":"var(--warn-fg)"}">${esc(x.severity||"P3")}</b> · ${esc(x.name||x.rule_key)} — <span class="rl" style="color:var(--muted)">${esc(String(x.message||"").slice(0,180))}</span></div>`).join("")}
        <button class="pill" onclick="window.setConsoleHash&&window.setConsoleHash('alerts')" style="margin-top:4px;font-size:10.5px;padding:2px 10px">Open Alerts →</button></div>`
      :alertsErr?`<div class="rl" style="border:1px solid #d97706;border-radius:11px;padding:6px 13px;margin-bottom:10px;background:rgba(217,119,6,.06);font-size:11px;color:var(--warn-fg)">⚠ DMS journey watch — status unavailable (${esc(alertsErr)})</div>`
      :`<div class="rl" style="border:1px solid var(--line);border-radius:11px;padding:6px 13px;margin-bottom:10px;background:rgba(14,159,90,.05);font-size:11px"><span style="color:var(--good);font-weight:700">✓ DMS journey watch</span> <span style="color:var(--muted)">— no open alerts · 17 journeys under fault-surge watch (2h window, ≥10 fails &amp; ≥15%) + grandfathered-Flex leak watch · firings appear here, on the Alerts page and in notification channels</span></div>`;
    const w=gwWin();
    let d; try{ d=await api(`/api/apigw/dealers?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`); }
    catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    if(!d.configured){ box.innerHTML=`<div class="rl">Gateway trace collector not configured (ZIPKIN_HOSTS).</div>`; return; }
    const K=d.kpis||{};
    const kpi=(label,o,title)=>{ const t=o?o.calls:0,e2=o?o.errors:0;
      const rate=t?Math.round(1000*e2/t)/10:null;
      return `<div title="${esc(title||"")}" style="flex:1;min-width:158px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px">
        <div style="display:flex;align-items:baseline;gap:7px"><span style="font-size:21px;font-weight:800">${n(t)}</span>
        ${e2?`<span style="font-size:11.5px;font-weight:700;color:#dc2626">${n(e2)} err${rate!=null?` (${rate}%)`:""}</span>`:`<span style="font-size:12px;font-weight:700;color:var(--good)">✓</span>`}</div>
        <div class="rl" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.03em">${esc(label)}</div>
        ${o&&o.p95_ms!=null?`<div class="rl" style="font-size:10px;margin-top:2px">p95 ${ms2(o.p95_ms)}</div>`:""}</div>`; };
    const kpis=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      ${kpi("Dealer logins",K.logins,"Keycloak dmsapplication userinfo — every dealer session; errors = failed/expired sessions")}
      ${kpi("App opens",K.app_opens,"getowneruser — dealer app session bootstraps")}
      ${kpi("Eligibility checks",K.eligibility,"simactivation/eligibility — the start of every dealer sale")}
      ${kpi("SIM activations",K.activations,"simactivation/activate — dealer completed a sale")}
      ${kpi("Wallet deductions",K.wallet,"deductdealerbalance — dealer balance charged (paid activation)")}
    </div>`;
    const S=d.series||[]; let chart="";
    if(S.length>1){
      const W=980,HT=110,pl=38,pb=16,pt=6;
      const maxV=Math.max(...S.map(r=>Math.max(r.logins||0,(r.activations||0)*4)),1);
      const bw=Math.max(3,Math.floor((W-pl)/S.length)-2);
      const x=i=>pl+i*((W-pl)/S.length), y=v=>HT-pb-(v/maxV)*(HT-pb-pt);
      let g="";
      S.forEach((r,i)=>{ const lbl=d.unit==="hour"?KT.dt(r.t):KT.d(r.t);
        g+=`<rect x="${x(i)}" y="${y(r.logins||0)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.logins||0))}" fill="#64748b" opacity=".45"><title>${esc(lbl)}: ${r.logins||0} logins${r.login_errors?` · ${r.login_errors} failed`:""}</title></rect>`;
        if(r.login_errors) g+=`<rect x="${x(i)}" y="${y(r.login_errors)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.login_errors))}" fill="#ef4444" opacity=".9"><title>${esc(lbl)}: ${r.login_errors} failed logins</title></rect>`;
        if(r.activations) g+=`<rect x="${x(i)+bw*0.25}" y="${y((r.activations||0)*4)}" width="${bw*0.5}" height="${Math.max(1,(HT-pb)-y((r.activations||0)*4))}" fill="#10b981" opacity=".95"><title>${esc(lbl)}: ${r.activations} activations · ${r.wallet_deductions||0} wallet deductions</title></rect>`;
        if(i%Math.ceil(S.length/14)===0) g+=`<text x="${x(i)+bw/2}" y="${HT-3}" text-anchor="middle" font-size="7.5" fill="var(--muted)">${esc(d.unit==="hour"?lbl.slice(11,16):lbl.slice(5))}</text>`;
        g+=`<rect class="gw-hr" data-t="${esc(r.t)}" x="${x(i)}" y="0" width="${bw+2}" height="${HT}" fill="transparent" style="cursor:pointer"><title>${esc(lbl)} — click to break this ${esc(d.unit)} down by operation</title></rect>`; });
      chart=`<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--card);margin-bottom:12px">
        <div class="rl" style="font-weight:700;font-size:11px;margin-bottom:4px">Dealer logins (grey · red = failed) vs SIM activations (green, ×4 scale) per ${esc(d.unit)}</div>
        <svg viewBox="0 0 ${W} ${HT}" style="width:100%;height:${HT}px">${g}</svg></div>`;
    }
    const pCol=v=>v==null?"":v>=3000?"color:#dc2626;font-weight:700":v>=1000?"color:#d97706;font-weight:700":"";
    const opRows=(d.ops||[]).map(r=>{ const rate=r.calls?Math.round(1000*r.errors/r.calls)/10:0;
      return `<tr class="gw-op" data-op="${esc(r.op)}" role="button" tabindex="0" title="Click for the endpoints, trend and real failing calls behind this row" style="cursor:pointer">
      <td class="rl" style="padding:3px 6px;font-weight:600">${esc(r.op)} <span style="opacity:.4">›</span></td>
      <td class="mono" style="text-align:right">${n(r.calls)}</td>
      <td class="mono" style="text-align:right;${r.errors?"color:#dc2626;font-weight:700":""}">${n(r.errors)}${rate>=1?` <span style="font-size:10px">(${rate}%)</span>`:""}</td>
      <td class="mono" style="text-align:right">${r.avg_ms!=null?n(r.avg_ms):"—"}</td>
      <td class="mono" style="text-align:right;${pCol(r.p95_ms)}">${r.p95_ms!=null?n(r.p95_ms):"—"}</td>
      <td class="mono" style="text-align:right">${r.max_ms!=null?n(r.max_ms):"—"}</td></tr>`; }).join("");
    const svcChips=(d.services||[]).map(s=>`<button class="mono gw-svc" data-svc="${esc(s.service)}" title="${n(s.calls)} calls · click for the per-endpoint breakdown" style="cursor:pointer;background:none;font-size:10px;border:1px solid var(--line);border-radius:6px;padding:1px 7px;color:${Number(s.errors)?"#dc2626":"var(--muted)"}">${esc(s.service)}${Number(s.errors)?` · ${n(s.errors)} err`:""}</button>`).join(" ");
    const opsTable=`<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--card);margin-bottom:12px;overflow:auto">
      <div class="rl" style="font-weight:700;font-size:11px;margin-bottom:4px">Dealer operations · what the range's dealer traffic did <span style="font-weight:600;color:var(--muted)">· one count per call (ingress-canonical) · p95 amber ≥1s red ≥3s</span></div>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px">
        <tr><th style="text-align:left;font-size:10px;color:var(--muted);padding:3px 6px">OPERATION</th><th style="text-align:right;font-size:10px;color:var(--muted)">CALLS</th><th style="text-align:right;font-size:10px;color:var(--muted)">ERRORS</th><th style="text-align:right;font-size:10px;color:var(--muted)">AVG ms</th><th style="text-align:right;font-size:10px;color:var(--muted)">P95 ms</th><th style="text-align:right;font-size:10px;color:var(--muted)">MAX ms</th></tr>
        ${opRows||`<tr><td class="rl" colspan="6">No dealer gateway traffic in this window (collector live since 17 Aug ~21:38 KSA).</td></tr>`}</table>
      <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">${svcChips}</div></div>`;
    const slowRows=(d.slow||[]).map(r=>`<tr>
      <td class="mono rl" style="padding:3px 6px;white-space:nowrap">${esc(KT.md(r.ts))}Z</td>
      <td class="rl">${esc(r.service)}</td>
      <td class="mono" style="max-width:330px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.path||"")}">${esc(r.path||"—")}</td>
      <td class="mono" style="text-align:right;font-weight:700;color:${r.duration_ms>=3000?"#dc2626":"var(--ink)"}">${n(r.duration_ms)}</td>
      <td class="mono" style="${r.status_code&&Number(r.status_code)>=400?"color:#dc2626;font-weight:700":""}">${esc(r.status_code||"—")}</td>
      <td class="rl" style="color:#dc2626">${esc((r.error||"").slice(0,50))}</td>
      <td>${r.uil_transaction_id?`<button class="pill" data-dmstxn="${esc(r.uil_transaction_id)}" style="padding:2px 8px;font-size:10px">⇄ Analyze</button>`:""}</td></tr>`).join("");
    const slowTable=`<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--card);overflow:auto">
      <div class="rl" style="font-weight:700;font-size:11px;margin-bottom:4px">Dealer-side errors &amp; slow calls <span style="font-weight:600;color:var(--muted)">· full spans · newest first — what dealers are feeling right now</span></div>
      ${slowRows?`<table style="width:100%;border-collapse:collapse;font-size:11px"><tr><th style="text-align:left;font-size:10px;color:var(--muted);padding:3px 6px">AT (KSA)</th><th style="text-align:left;font-size:10px;color:var(--muted)">SERVICE</th><th style="text-align:left;font-size:10px;color:var(--muted)">ENDPOINT</th><th style="text-align:right;font-size:10px;color:var(--muted)">ms</th><th style="text-align:left;font-size:10px;color:var(--muted)">HTTP</th><th style="text-align:left;font-size:10px;color:var(--muted)">ERROR</th><th></th></tr>${slowRows}</table>`
        :`<div class="rl" style="color:var(--good);font-weight:700">No dealer-side errors or slow calls in this window.</div>`}</div>`;
    box.innerHTML=alertStrip+`<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <b style="font-size:13px">Dealer traffic through the gateway <span class="mono" style="font-weight:600;font-size:10.5px;color:var(--muted)">/api/uil/*</span></b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">what the DMS app &amp; hybrid portal do on the APIGW — moved here from DMS (UIL = gateway, not DMS)</span>
        <span style="margin-left:auto;display:flex;gap:5px">${HL.map(([h,l])=>`<button class="pill mgw-h" data-h="${h}" style="padding:2px 9px;font-size:10.5px;${hours===h?"border-left-color:var(--green);font-weight:800;":""}">${l}</button>`).join("")}</span></div>
      <div class="rl" style="margin-bottom:8px;font-size:10.5px;color:var(--muted)">Collective dealer experience — spans carry no dealer identity; per-dealer numbers live on the DMS page. <b>Chart hours, table rows and service chips are clickable.</b></div>`
      +kpis+chart+opsTable+`<div id="gwDrill"></div>`+slowTable;
    box.querySelectorAll(".mgw-h").forEach(b=>b.addEventListener("click",()=>{ hours=Number(b.dataset.h); if(window.pf) window.pf.set("dms_hours",hours); renderGw(); }));
    box.querySelectorAll("[data-dmstxn]").forEach(b=>b.addEventListener("click",()=>{ if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(b.dataset.dmstxn); }));
    const openDrill=(o)=>gwDrill(o).catch(e=>{ const el=$("#gwDrill"); if(el) el.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; });
    box.querySelectorAll(".gw-op").forEach(tr=>{ const go=()=>openDrill({op:tr.dataset.op});
      tr.addEventListener("click",go); tr.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } }); });
    box.querySelectorAll(".gw-svc").forEach(b=>b.addEventListener("click",()=>openDrill({service:b.dataset.svc})));
    box.querySelectorAll(".gw-hr").forEach(rc=>rc.addEventListener("click",()=>openDrill({hour:rc.dataset.t,unit:d.unit})));
  }

  /* ---- the drill card: endpoints, trend, status mix and REAL spans behind one number ---- */
  async function gwDrill(sel){
    const host=$("#gwDrill"); if(!host) return;
    const w=gwWin(); let from=w.from,to=w.to,title="";
    if(sel.hour){ const t0=new Date(sel.hour); const t1=new Date(t0.getTime()+(sel.unit==="day"?864e5:36e5));
      from=t0.toISOString(); to=t1.toISOString(); title=`${sel.unit==="day"?"Day":"Hour"} ${esc(KT.dt(sel.hour))}`; }
    const q=new URLSearchParams({from,to}); if(sel.op)q.set("op",sel.op); if(sel.service)q.set("service",sel.service);
    host.innerHTML=`<div class="rl" style="padding:8px 0">Loading drill-down…</div>`;
    const d=await api(`/api/apigw/dealers/op?${q}`);
    if(sel.op) title=`Operation · ${esc(sel.op)}`; else if(sel.service) title=`Service · ${esc(sel.service)}`;
    const tot=d.hourly.reduce((a,r)=>({c:a.c+Number(r.calls),e:a.e+Number(r.errors)}),{c:0,e:0});
    const rate=tot.c?Math.round(1000*tot.e/tot.c)/10:0;
    const p95=Math.max(0,...d.hourly.map(r=>Number(r.p95_ms)||0));
    const chip=(l,v,c)=>`<div class="stat" style="min-width:110px"><b style="${c?`color:${c}`:""}">${v}</b><span>${esc(l)}</span></div>`;
    const maxH=Math.max(1,...d.hourly.map(r=>Number(r.calls)));
    const trend=d.hourly.map(r=>`<div title="${esc(KT.dt(r.t))} · ${n(r.calls)} calls · ${n(r.errors)} errors${r.p95_ms?` · p95 ${n(r.p95_ms)}ms`:""}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:46px;min-width:3px">
        ${Number(r.errors)?`<div style="background:#dc2626;height:${Math.max(2,Math.round(42*r.errors/maxH))}px"></div>`:""}
        <div style="background:#64748b;opacity:.5;height:${Math.max(2,Math.round(42*(r.calls-r.errors)/maxH))}px"></div></div>`).join("");
    const pathRows=(d.paths||[]).map(r=>{ const isOpView=!sel.op&&!sel.service;
      const label=isOpView?r.op:`${r.service} · ${r.method||""} ${r.path}`;
      const rr=r.calls?Math.round(1000*r.errors/r.calls)/10:0;
      return `<tr ${isOpView?`class="gw-op2" data-op="${esc(r.op)}" role="button" style="cursor:pointer"`:""}>
        <td class="mono rl" style="padding:2px 6px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(label)}">${esc(label)}${isOpView?' <span style="opacity:.4">›</span>':""}</td>
        <td class="mono" style="text-align:right">${n(r.calls)}</td>
        <td class="mono" style="text-align:right;${Number(r.errors)?"color:#dc2626;font-weight:700":""}">${n(r.errors)}${rr>=1?` (${rr}%)`:""}</td>
        <td class="mono" style="text-align:right">${r.avg_ms!=null?n(r.avg_ms):"—"}</td>
        <td class="mono" style="text-align:right">${r.p95_ms!=null?n(r.p95_ms):"—"}</td></tr>`; }).join("");
    const stat=(d.statusSample||[]).map(x=>`<span class="mono" style="font-size:10px;border:1px solid var(--line);border-radius:6px;padding:1px 7px;color:${/^[45]/.test(x.code)?"#dc2626":"var(--muted)"}">${esc(x.code)} × ${n(x.n)}</span>`).join(" ");
    const spanRows=(d.spans||[]).map(r=>`<tr>
      <td class="mono rl" style="padding:2px 6px;white-space:nowrap">${esc(KT.md(r.ts))}Z</td>
      <td class="rl">${esc(r.service||"")}</td>
      <td class="mono" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.path||"")}">${esc((r.method||"")+" "+(r.path||""))}</td>
      <td class="mono" style="text-align:right;${r.duration_ms>=3000?"color:#dc2626;font-weight:700":""}">${n(r.duration_ms)}</td>
      <td class="mono" style="${r.status_code&&Number(r.status_code)>=400?"color:#dc2626;font-weight:700":""}">${esc(r.status_code||"—")}</td>
      <td class="rl" style="color:#dc2626;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.error||"")}">${esc((r.error||"").slice(0,60))}</td>
      <td style="white-space:nowrap">${r.uil_transaction_id?`<button class="pill" data-dmstxn="${esc(r.uil_transaction_id)}" style="padding:1px 7px;font-size:10px">⇄ Analyze</button>`:""}
        ${r.trace_id?`<button class="pill" data-gwtrace="${esc(r.trace_id)}" style="padding:1px 7px;font-size:10px">Trace</button>`:""}</td></tr>`).join("");
    host.innerHTML=`<div class="topo-card" style="border-left:3px solid #7c3aed;padding:10px 12px;background:var(--card,#fff);margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <b style="font-size:12px">${title}</b>
        <span class="rl" style="font-size:10px;color:var(--muted)">${esc(KT.dt(d.from))} → ${esc(KT.dt(d.to))}</span>
        <button class="pill" id="gwDrillX" style="margin-left:auto;font-size:11px;padding:2px 10px">✕ close</button></div>
      <div class="topo-stats" style="margin-bottom:8px">
        ${chip("CALLS",n(tot.c))}${chip("ERRORS",n(tot.e),tot.e?"#dc2626":"#16a34a")}
        ${chip("ERROR RATE",rate+"%",rate>=5?"#dc2626":rate>=1?"#d97706":"#16a34a")}${chip("WORST P95",p95?n(p95)+"ms":"—",p95>=3000?"#dc2626":p95>=1000?"#d97706":null)}
      </div>
      <div style="display:flex;gap:2px;align-items:flex-end;margin-bottom:10px">${trend}</div>
      <b style="font-size:11px">${sel.op||sel.service?"Endpoints behind this number":"Operations in this "+(sel.unit||"hour")}</b>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 8px">
        <tr><th style="text-align:left;font-size:9.5px;color:var(--muted);padding:2px 6px">${sel.op||sel.service?"SERVICE · ENDPOINT":"OPERATION"}</th><th style="text-align:right;font-size:9.5px;color:var(--muted)">CALLS</th><th style="text-align:right;font-size:9.5px;color:var(--muted)">ERRORS</th><th style="text-align:right;font-size:9.5px;color:var(--muted)">AVG</th><th style="text-align:right;font-size:9.5px;color:var(--muted)">P95</th></tr>
        ${pathRows||`<tr><td class="rl" colspan="5">no traffic in this selection</td></tr>`}</table>
      ${stat?`<div style="margin-bottom:8px"><b style="font-size:11px">Status mix</b> <span class="rl" style="font-size:9.5px;color:var(--muted)">(retained outlier spans, not all calls)</span><br>${stat}</div>`:""}
      <b style="font-size:11px">Real failing / slow calls</b> <span class="rl" style="font-size:9.5px;color:var(--muted)">errors first, newest first · ⇄ Analyze correlates with the BSS/OSB read path</span>
      ${spanRows?`<table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-top:4px"><tr><th style="text-align:left;font-size:9.5px;color:var(--muted);padding:2px 6px">AT</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">SERVICE</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">ENDPOINT</th><th style="text-align:right;font-size:9.5px;color:var(--muted)">ms</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">HTTP</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">ERROR</th><th></th></tr>${spanRows}</table>`
        :`<div class="rl" style="color:var(--good);font-size:11px;margin-top:4px">No retained error/slow spans in this selection — every call completed inside thresholds.</div>`}
      </div>`;
    host.scrollIntoView({behavior:"smooth",block:"nearest"});
    $("#gwDrillX").onclick=()=>{ host.innerHTML=""; };
    host.querySelectorAll("[data-dmstxn]").forEach(b=>b.addEventListener("click",()=>{ if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(b.dataset.dmstxn); }));
    host.querySelectorAll("[data-gwtrace]").forEach(b=>b.addEventListener("click",()=>{ if(window.apigwTrace) window.apigwTrace(b.dataset.gwtrace); else if(window.openMonitoring){ window.openMonitoring("gateway"); } }));
    host.querySelectorAll(".gw-op2").forEach(tr=>tr.addEventListener("click",()=>gwDrill({op:tr.dataset.op})));
    if(window.audit) window.audit("VIEW_PAGE","#monitoring?gw-drill="+(sel.op||sel.service||sel.hour||""));
  }

  /* ③ Dealers map & roster — ported from the salam-dealer-ops runbook, adapted to MVNO data:
   * stores are the geo layer (all 185 geolocated); dealer ORDERS carry no geography (verified),
   * so dealer activity renders as roster + detail panel, with the few delivery-coord orders as
   * real pins. GMAPS_KEY set → Google map (same key as the ops app); unset → SVG projection. */
  /* ④ DEALER MAP EXPLORER (1 Sep 2026) — modeled on the Fixed ops console map tab: one BIG map
   * carrying the REAL dealer coordinates from dms_users, a filter bar, and a full-width ranked
   * table below. Pin colors: ● green = sold in range · ● blue = active, no sales in range ·
   * ● red = not active · ◆ purple = store (layer toggle). Dealer ORDERS still carry no GPS —
   * raised with the app team; the dealers themselves are the geo truth we do have. */
  let _mapData=null, _dQ="", _dmsRep=null, _storeSel=null, _board=null, _gmap=null, _pins=[];
  let _mf={ q:"", type:"", status:"", sellOnly:false, stores:true, sort:"act", dir:-1, app:false };
  const numOr=v=>{ const x=Number(v); return Number.isFinite(x)&&x!==0?x:null; };
  /* city-level fallback: most dealers carry NO registered GPS (data-hygiene finding, 1 Sep) —
   * place them at their city centroid with a small deterministic jitter, marked ≈ approximate,
   * so the network is still visible and clusterable like the Fixed ops console. */
  const KSA_CITY={ riyadh:[24.71,46.68],"الرياض":[24.71,46.68], jeddah:[21.49,39.19],"جدة":[21.49,39.19],
    makkah:[21.39,39.86], mecca:[21.39,39.86],"مكة":[21.39,39.86], madinah:[24.47,39.61], medina:[24.47,39.61],"المدينة":[24.47,39.61],
    dammam:[26.43,50.10],"الدمام":[26.43,50.10], khobar:[26.28,50.21], dhahran:[26.29,50.15], qatif:[26.52,50.01],
    jubail:[27.0,49.65], buqeq:[25.93,49.67], abqaiq:[25.93,49.67], hofuf:[25.36,49.58], ahsa:[25.36,49.58], hassa:[25.36,49.58],
    tabuk:[28.38,36.57], abha:[18.25,42.51], khamis:[18.3,42.73],"خميس":[18.3,42.73], hail:[27.51,41.72],
    buraydah:[26.36,43.96], unaizah:[26.09,43.99], rass:[25.87,43.5], zulfi:[26.3,44.8], majmaah:[25.9,45.35],
    taif:[21.27,40.42],"الطائف":[21.27,40.42], jazan:[16.89,42.55], gizan:[16.89,42.55], najran:[17.57,44.23],
    yanbu:[24.09,38.06], kharj:[24.15,47.3], sakaka:[29.97,40.2], arar:[30.98,41.02], baha:[20.01,41.47],
    hafar:[28.43,45.97], wajh:[26.25,36.45], najem:[24.71,46.68] };
  const cityLL=c=>{ const t=String(c||"").toLowerCase(); if(!t) return null;
    for(const k in KSA_CITY) if(t.includes(k)) return KSA_CITY[k]; return null; };
  const jit=(seed,scale)=>{ let h=0; const t=String(seed); for(let i=0;i<t.length;i++) h=(h*31+t.charCodeAt(i))>>>0; return ((h%1000)/1000-0.5)*scale; };
  const coordsOf=r=>{ if(r.lat!=null&&r.lng!=null) return {lat:r.lat,lng:r.lng,approx:false};
    const ll=cityLL(r.cityx); if(!ll) return null;
    const k=r.dealer_code||r.username||"x";
    return {lat:ll[0]+jit(k+"a",0.16),lng:ll[1]+jit(k+"b",0.16),approx:true}; };
  async function renderDealers(){
    const box=$("#dmsMap3"); if(!box) return;
    const w=win();
    const pii=!!(window.PII&&window.PII.on);
    let d; try{ d=await api(`/api/dms/map?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}${pii?"&unmask=1":""}`); }
    catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    try{ _dmsRep=await api(`/api/dms/commission/report?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`); }catch(e){ _dmsRep=null; }
    try{ _board=await api(`/api/dms/dealers?sort=earned&limit=400&pool=1500${pii?"&unmask=1":""}`); }catch(e){ _board=null; }
    _mapData=d; _gmap=null;
    const T=d.totals||{};
    const conv=T.attempts?Math.round(100*T.activated/T.attempts):null;
    const chip=(v,l,c)=>`<div style="flex:1;min-width:130px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px">
      <div style="font-size:21px;font-weight:800;color:${c||'var(--ink)'}">${v}</div>
      <div class="rl" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.03em">${esc(l)}</div></div>`;
    const partialNote=d.partial?`<div style="border:1px solid #d97706;border-radius:9px;padding:6px 12px;margin-bottom:10px;background:rgba(217,119,6,.07);font-size:11px;display:flex;gap:10px;align-items:center">
        <span style="color:var(--warn-fg);font-weight:700">⚠ Incomplete load — ${esc(Object.entries(d.partial).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(" · "))}. Zeros below may be missing data, not real zeros.</span>
        <button class="pill" id="dmsMapRetry" style="margin-left:auto;font-size:10.5px;padding:2px 10px">↻ Retry</button></div>`:"";
    const R=_dmsRep&&_dmsRep.totals?_dmsRep.totals:null;
    const canPii=!!(window.PII&&window.PII.can());
    const F=(_board&&_board.facets)||{};
    const sel=(id,label,key,opts)=>`<select id="${id}" data-k="${key}" style="font:inherit;font-size:11.5px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
        <option value="">${esc(label)}: all</option>${(opts||[]).map(o=>`<option value="${esc(o.value)}"${_mf[key]===o.value?" selected":""}>${esc(o.value)} (${o.count})</option>`).join("")}</select>`;
    box.innerHTML=`${partialNote}
      ${d.unmasked?`<div style="border:1px solid #dc2626;border-radius:9px;padding:5px 11px;margin-bottom:9px;background:rgba(220,38,38,.06);font-size:11px;font-weight:700;color:#dc2626">🔓 Identifiers shown in full on the map and roster — this reveal is recorded in the audit log.</div>`:""}
      ${pii&&!d.unmasked?`<div class="rl" style="border:1px solid #d97706;border-radius:9px;padding:5px 11px;margin-bottom:9px;background:rgba(217,119,6,.07);font-size:11px;color:var(--warn-fg)">⚠ Reveal was requested but the SERVER kept identifiers masked (can_unmask=${String(d.can_unmask)}).</div>`:""}
      ${canPii?`<div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button id="mapUm" class="pill" style="font-size:11px;padding:3px 12px;${pii?"border-left-color:#dc2626":""}">${pii?"🔓 Unmasked — hide":"🔒 Masked — reveal"}</button></div>`:""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        ${R?chip(n(R.dealers),"Active dealers · DMS network","#2563eb"):""}
        ${R?chip(n(R.total),"DMS activations","#16a34a"):""}
        ${chip(n(T.attempts),"App-flow attempts")}${chip(conv==null?"—":conv+"%","App-flow conversion")}
        ${(()=>{ const M=mergedRows(); const ex=M.filter(x=>x.lat!=null).length; const ap=M.filter(x=>x.lat==null&&cityLL(x.cityx)).length;
          return chip(`${n(ex+ap)}`,`Dealers on map (${n(ex)} GPS · ${n(ap)} ≈city)`,"#0891b2"); })()}
        ${chip(n((d.stores||[]).length),"Stores on map","#7c3aed")}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:8px 12px;margin-bottom:10px">
        <input id="mfQ" placeholder="search dealer / code / city…" value="${esc(_mf.q)}" style="flex:1 1 200px;min-width:160px;font:inherit;font-size:11.5px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
        ${sel("mfType","type","type",F.dealer_type)}
        ${sel("mfStatus","status","status",F.status)}
        <label class="rl" style="font-size:11px;display:flex;gap:5px;align-items:center"><input id="mfSell" type="checkbox"${_mf.sellOnly?" checked":""}>selling in range</label>
        <label class="rl" style="font-size:11px;display:flex;gap:5px;align-items:center"><input id="mfStores" type="checkbox"${_mf.stores?" checked":""}>◆ stores layer</label>
        <button id="mfCsv" class="pill" style="font-size:11px;padding:4px 11px">⤓ CSV</button>
        <button id="mfApp" class="pill" style="font-size:11px;padding:4px 11px">${_mf.app?"map table ↔":"app-flow orders ↔"}</button>
      </div>
      <div style="border:1px solid var(--line);border-radius:12px;background:var(--card);padding:8px 10px;margin-bottom:10px">
        <div class="rl" style="font-weight:700;font-size:11px;margin-bottom:6px">Dealer network map
          <span style="font-weight:600;color:var(--muted)">· pins = dealers at their registered coordinates · ● green sold in range · ● blue active · ● red inactive · ◆ store — click any pin</span></div>
        <div id="dmsMapCanvas" style="width:100%;height:560px;border-radius:9px;overflow:hidden;background:var(--card2,rgba(148,163,184,.06))"></div>
      </div>
      <div id="dmsStoreCard"></div>
      <div id="dmsRoster" style="border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px 12px"></div>`;
    const rt=$("#dmsMapRetry"); if(rt) rt.addEventListener("click",renderDealers);
    const mu=$("#mapUm"); if(mu) mu.addEventListener("click",()=>{ mu.disabled=true; mu.textContent="…"; window.PII.set(!window.PII.on); renderDealers(); });
    const mq=$("#mfQ"); if(mq){ let t=null; mq.addEventListener("input",()=>{ clearTimeout(t); t=setTimeout(()=>{ _mf.q=mq.value.trim().toLowerCase(); renderDealerTable(); refreshPins(); },300); }); }
    box.querySelectorAll("select[data-k]").forEach(se=>se.addEventListener("change",()=>{ _mf[se.dataset.k]=se.value; renderDealerTable(); refreshPins(); }));
    const ms=$("#mfSell"); if(ms) ms.addEventListener("change",()=>{ _mf.sellOnly=ms.checked; renderDealerTable(); refreshPins(); });
    const mst=$("#mfStores"); if(mst) mst.addEventListener("change",()=>{ _mf.stores=mst.checked; refreshPins(); });
    const mc=$("#mfCsv"); if(mc) mc.addEventListener("click",exportDealerCsv);
    const ma=$("#mfApp"); if(ma) ma.addEventListener("click",()=>{ _mf.app=!_mf.app; if(_mf.app) drawRoster(); else renderDealerTable(); });
    drawMapV2(); renderDealerTable();
  }
  function mergedRows(){
    const by=new Map(); ((_dmsRep&&_dmsRep.byDealer)||[]).forEach(x=>by.set(String(x.dealer||"").toLowerCase(),x));
    return ((_board&&_board.rows)||[]).map(r=>{
      const k1=String(r.dealer_code||"").toLowerCase(), k2=String(r.username||"").toLowerCase();
      const a=by.get(k1)||by.get(k2);
      return { ...r, act:a?Number(a.n):0, comm:a?Math.round(Number(a.commission||0)):0,
        lkey:a?String(a.dealer):(r.username||r.dealer_code||""),   // the key the LEDGER actually uses
        cityx:(a&&(a.city||a.region))||r.city||r.geographical_area||r.location_of_sales||"",
        lat:numOr(r.latitude), lng:numOr(r.longitude) };
    });
  }
  function filteredRows(){
    let L=mergedRows();
    if(_mf.q) L=L.filter(x=>[x.dealer_code,x.username,x.name,x.cityx].some(v=>v&&String(v).toLowerCase().includes(_mf.q)));
    if(_mf.type) L=L.filter(x=>String(x.dealer_type||"")===_mf.type);
    if(_mf.status) L=L.filter(x=>String(x.status||"")===_mf.status);
    if(_mf.sellOnly) L=L.filter(x=>x.act>0);
    if(_storeSel&&_storeSel.city){ const want=String(_storeSel.city).toLowerCase();
      L=L.filter(x=>{ const c=String(x.cityx||"").toLowerCase(); return c&&(c.includes(want)||want.includes(c)); }); }
    const k=_mf.sort, dir=_mf.dir;
    L.sort((a,z)=>{ const av=a[k], zv=z[k];
      if(typeof av==="number"||typeof zv==="number") return dir*((Number(av)||0)-(Number(zv)||0));
      return dir*String(av||"").localeCompare(String(zv||"")); });
    return L;
  }
  function renderDealerTable(){
    const host=$("#dmsRoster"); if(!host) return;
    if(_mf.app){ drawRoster(); return; }
    const L=filteredRows();
    const th=(k,l,align)=>`<th class="mth" data-k="${k}" style="cursor:pointer;text-align:${align||"left"};font-size:10px;color:var(--muted);padding:4px 6px;white-space:nowrap">${l}${_mf.sort===k?(_mf.dir<0?" ▼":" ▲"):""}</th>`;
    const money=v=>Number(v||0).toLocaleString();
    const rows=L.slice(0,400).map(r=>`<tr class="mtr" data-d="${esc(r.dealer_code||r.username||"")}" style="border-top:1px solid var(--line);cursor:pointer">
        <td class="mono" style="padding:4px 6px;font-weight:700;text-decoration:underline dotted">${esc(r.dealer_code||"—")}</td>
        <td style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name||r.username||"—")}</td>
        <td style="font-size:10.5px">${esc(r.dealer_type||"—")}</td>
        <td style="font-size:10.5px;color:${r.status&&/active/i.test(r.status)?"#16a34a":"#dc2626"}">${esc(r.status||"—")}</td>
        <td class="rl" style="font-size:10.5px;color:var(--muted);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.cityx||"—")}</td>
        <td class="mono" style="text-align:right;font-weight:${r.act?"700":"400"};color:${r.act?"#16a34a":"var(--muted)"}">${money(r.act)}</td>
        <td class="mono" style="text-align:right;color:var(--good)">${money(r.comm)}</td>
        <td class="mono" style="text-align:right">${money(r.earned)}</td>
        <td class="mono" style="text-align:right;color:${Number(r.unpaid)>0?"#dc2626":"inherit"}">${money(r.unpaid)}</td>
        <td class="mono rl" style="text-align:right;font-size:10px;color:var(--muted)">${r.last_login?esc(KT.d(r.last_login)):"never"}</td>
        <td style="text-align:center">${r.act>0?`<button class="pill mtl" data-d="${esc(r.dealer_code||r.username||"")}" data-lk="${esc(r.lkey||"")}" title="Walk this dealer's journey timeline(s) in the selected range — Prev / Next" style="padding:1px 9px;font-size:10px">▶ ${n(r.act)}</button>`:'<span class="rl" style="font-size:10px;color:var(--muted)">—</span>'}</td>
        <td style="text-align:center;font-size:10px">${r.lat!=null?'<span title="registered GPS">●</span>':(cityLL(r.cityx)?'<span style="color:#0891b2" title="≈ city-level position (no registered GPS)">≈</span>':'<span style="color:var(--muted)" title="no coordinates and unknown city">—</span>')}</td></tr>`).join("");
    host.innerHTML=`
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
        <b style="font-size:12px">Dealers</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">· ${n(L.length)} match${_storeSel?"":""} of ${n(mergedRows().length)} loaded · range KPIs from the activation ledger · lifetime money from commission_history · click a row for the dealer popup</span>
        ${_storeSel?`<span style="border:1px solid #7c3aed;border-radius:999px;padding:1px 10px;font-size:10.5px;background:rgba(124,58,237,.06)">◆ ${esc(_storeSel.city||"?")} <button id="mfClearStore" style="border:none;background:none;cursor:pointer;color:inherit;font-weight:700">✕</button></span>`:""}
      </div>
      <div style="overflow:auto;max-height:430px">
      <table style="width:100%;border-collapse:collapse;font-size:11.5px">
        <tr>${th("dealer_code","CODE")}${th("name","NAME")}${th("dealer_type","TYPE")}${th("status","STATUS")}${th("cityx","CITY / AREA")}${th("act","ACT (RANGE)","right")}${th("comm","COMM SAR (RANGE)","right")}${th("earned","EARNED (LIFE)","right")}${th("unpaid","UNPAID","right")}${th("last_login","LAST LOGIN","right")}<th style="font-size:10px;color:var(--muted)">TIMELINES</th><th style="font-size:10px;color:var(--muted)">GEO</th></tr>
        ${rows||`<tr><td colspan="12" class="rl" style="padding:10px 6px">No dealer matches these filters.</td></tr>`}</table></div>`;
    host.querySelectorAll(".mtr").forEach(tr=>tr.addEventListener("click",()=>{ if(window.openDealerPopup) window.openDealerPopup(tr.dataset.d); }));
    /* TIMELINES walker: fetch the dealer's range activations from the commission report
       (cached, range-scoped), then step through each one's end-to-end timeline. The client only
       holds ledger row ids — the server resolves each MSISDN internally (dmsrow=). */
    host.querySelectorAll(".mtl").forEach(b=>b.addEventListener("click",async e=>{
      e.stopPropagation();
      const code=b.dataset.lk||b.dataset.d; if(!code) return;
      b.disabled=true; const orig=b.textContent; b.textContent="…";
      try{
        const w2=win();
        const rep=await api(`/api/dms/journeys/dealer-acts?d=${encodeURIComponent(code)}&from=${encodeURIComponent(w2.from)}&to=${encodeURIComponent(w2.to)}`);
        const acts=(rep.acts||[]).slice(0,60);
        if(!acts.length){ b.textContent="none"; setTimeout(()=>{ b.textContent=orig; b.disabled=false; },1500); return; }
        const walk2=i=>{ if(!acts[i]||!window.opsOpenTimeline) return;
          window.opsOpenTimeline(`dms:${acts[i].journey||"activation"}:${acts[i].rid}`, null, null,
            { pos:`${i+1} / ${acts.length}`,
              onPrev: i>0?()=>walk2(i-1):null,
              onNext: i<acts.length-1?()=>walk2(i+1):null });
          if(window.audit) window.audit("VIEW_TRACE",`dms-walk ${i+1}/${acts.length} ${code}`); };
        walk2(0);
      }catch(err){ b.textContent="err"; setTimeout(()=>{ b.textContent=orig; },1800); }
      finally{ b.disabled=false; if(b.textContent==="…") b.textContent=orig; }
    }));
    host.querySelectorAll(".mth").forEach(h=>h.addEventListener("click",()=>{ const k=h.dataset.k;
      if(_mf.sort===k) _mf.dir*=-1; else { _mf.sort=k; _mf.dir=(k==="dealer_code"||k==="name"||k==="dealer_type"||k==="status"||k==="cityx")?1:-1; }
      renderDealerTable(); }));
    const cs=$("#mfClearStore"); if(cs) cs.addEventListener("click",()=>{ _storeSel=null; const el=$("#dmsStoreCard"); if(el) el.innerHTML=""; renderDealerTable(); refreshPins(); });
  }
  function exportDealerCsv(){
    const L=filteredRows();
    const head=["dealer_code","name","type","status","city","activations_range","commission_range_sar","earned_lifetime","paid","unpaid","last_login"];
    const lines=[head.join(",")].concat(L.map(r=>[r.dealer_code,r.name||r.username,r.dealer_type,r.status,r.cityx,r.act,r.comm,r.earned,r.paid,r.unpaid,r.last_login]
      .map(v=>`"${String(v==null?"":v).replace(/"/g,'""')}"`).join(",")));
    const blob=new Blob(["﻿"+lines.join("\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download=`dealers_map_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    if(window.audit) window.audit("EXPORT","dealers-map-csv:"+L.length);
  }
  let _clusterer=null;
  function refreshPins(){
    if(!_gmap||!window.google) return;
    if(_clusterer){ try{ _clusterer.clearMarkers(); }catch(e){} _clusterer=null; }
    _pins.forEach(m=>m.setMap(null)); _pins=[];
    const dealerMks=[];
    filteredRows().slice(0,600).forEach(r=>{
      const c2=coordsOf(r); if(!c2) return;
      const color=r.act>0?"#0e9f5a":(/active/i.test(r.status||"")?"#2563eb":"#dc2626");
      const mk=new google.maps.Marker({ position:{lat:c2.lat,lng:c2.lng},
        icon:{ path:google.maps.SymbolPath.CIRCLE, scale:6, fillColor:color, fillOpacity:c2.approx?.75:.95, strokeWeight:1.2, strokeColor:"#fff" },
        title:`${r.dealer_code||""} · ${r.name||r.username||""} · ${r.cityx||""}${c2.approx?" · ≈ city-level position (no registered GPS)":""} · ${r.act} activation(s) in range — click for the dealer popup` });
      mk.addListener("click",()=>{ if(window.openDealerPopup) window.openDealerPopup(r.dealer_code||r.username); });
      dealerMks.push(mk);
    });
    const MC=window.markerClusterer&&window.markerClusterer.MarkerClusterer;
    if(MC&&dealerMks.length){ _clusterer=new MC({ map:_gmap, markers:dealerMks }); }
    else dealerMks.forEach(mk=>{ mk.setMap(_gmap); _pins.push(mk); });
    if(_mf.stores) (_mapData&&_mapData.stores||[]).forEach(s2=>{ if(s2.lat==null) return;
      const mk=new google.maps.Marker({ map:_gmap, position:{lat:Number(s2.lat),lng:Number(s2.lng)},
        icon:{ path:google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale:4, fillColor:"#7c3aed", fillOpacity:.9, strokeWeight:1, strokeColor:"#fff" },
        title:`${s2.name||s2.store_code||"store"} · ${s2.city||""} — click for store card + city filter` });
      mk.addListener("click",()=>showStore(s2.id));
      _pins.push(mk);
    });
  }
  function drawMapV2(){
    const el=$("#dmsMapCanvas"); if(!el) return;
    const d=_mapData||{};
    if(!d.mapsKey){ drawMapSvg(el); return; }
    const init=()=>{
      _gmap=new google.maps.Map(el,{center:{lat:24.2,lng:45.0},zoom:5.6,mapTypeControl:false,streetViewControl:false,
        gestureHandling:"greedy",zoomControl:true,zoomControlOptions:{position:google.maps.ControlPosition.RIGHT_BOTTOM},fullscreenControl:false});
      const rb=document.createElement("button");
      rb.textContent="⌂ KSA"; rb.title="Reset view to Saudi Arabia";
      rb.style.cssText="margin:0 10px 24px 0;background:var(--card);border:0;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.3);padding:7px 12px;font:600 12px/1 Roboto,Arial,sans-serif;cursor:pointer;color:var(--ink)";
      rb.onclick=()=>{ _gmap.setCenter({lat:24.2,lng:45.0}); _gmap.setZoom(5.6); };
      _gmap.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(rb);
      // marker clustering — the numbered bubbles per area, like the Fixed ops console
      if(window.markerClusterer||window.__mcLoading){ refreshPins(); }
      else { window.__mcLoading=true;
        const cs=document.createElement("script");
        cs.src="https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js";
        cs.onload=()=>refreshPins(); cs.onerror=()=>refreshPins();
        document.head.appendChild(cs); }
      refreshPins();
    };
    if(window.google&&window.google.maps) return init();
    window.__dmsGmapInit=init;
    const sc=document.createElement("script");
    sc.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(d.mapsKey)}&callback=__dmsGmapInit`;
    sc.onerror=()=>{ drawMapSvg(el); };
    document.head.appendChild(sc);
  }
  function drawMapSvg(el){
    // fallback without a Maps key: same pins, static projection
    const W=1100,H=560;
    const X=lng=>((lng-34)/(56-34))*W, Y=lat=>((33-lat)/(33-16))*H;
    let g="";
    filteredRows().slice(0,600).forEach(r=>{
      const c2=coordsOf(r); if(!c2) return;
      const color=r.act>0?"#0e9f5a":(/active/i.test(r.status||"")?"#2563eb":"#dc2626");
      g+=`<circle cx="${X(c2.lng)}" cy="${Y(c2.lat)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="1" style="cursor:pointer" data-dd="${esc(r.dealer_code||r.username||"")}"><title>${esc(r.dealer_code||"")} · ${esc(r.cityx||"")}${c2.approx?" · ≈":""}</title></circle>`; });
    if(_mf.stores) ((_mapData&&_mapData.stores)||[]).forEach(s2=>{ if(s2.lat==null) return;
      g+=`<path d="M ${X(s2.lng)} ${Y(s2.lat)-5} l 4 5 l -4 5 l -4 -5 z" fill="#7c3aed" opacity=".85" data-sid="${esc(s2.id)}" style="cursor:pointer"><title>${esc(s2.name||"store")}</title></path>`; });
    el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:100%">${g}</svg>`;
    el.querySelectorAll("[data-dd]").forEach(c=>c.addEventListener("click",()=>{ if(window.openDealerPopup) window.openDealerPopup(c.dataset.dd); }));
    el.querySelectorAll("[data-sid]").forEach(c=>c.addEventListener("click",()=>showStore(c.dataset.sid)));
  }
  /* store card — sets the city filter on the table + pins */
  function showStore(id){
    const s2=((_mapData&&_mapData.stores)||[]).find(x=>String(x.id)===String(id)); if(!s2) return;
    _storeSel={ city:s2.city||"", name:s2.name||s2.store_code||"" };
    renderDealerTable(); refreshPins();
    const el=$("#dmsStoreCard"); if(!el) return;
    el.innerHTML=`<div style="border:1px solid #7c3aed;border-radius:11px;padding:9px 12px;margin-bottom:9px;background:rgba(124,58,237,.05)">
      <div style="display:flex;gap:8px;align-items:center"><b style="font-size:12px">◆ ${esc(s2.name||s2.store_code||"store")}</b>
        <span class="mono rl" style="font-size:10px;color:var(--muted)">${esc(s2.store_code||"")}</span>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">· dealers table filtered to this city</span>
        <button class="pill" id="stX" style="margin-left:auto;font-size:10px;padding:1px 8px">✕</button></div>
      <div class="rl" style="font-size:11px;margin-top:3px">${esc(s2.city||"")}${s2.region?" · "+esc(s2.region):""} · services: ${[s2.port_in&&"port-in",s2.sim_replace&&"SIM replace",s2.ownership&&"ownership"].filter(Boolean).join(" · ")||"—"}</div></div>`;
    const x=$("#stX"); if(x) x.addEventListener("click",()=>{ _storeSel=null; el.innerHTML=""; renderDealerTable(); refreshPins(); });
  }
  const drawRosterDms=renderDealerTable;   // legacy alias (older call sites)
  function drawRoster(){
    const host=$("#dmsRoster"); if(!host||!_mapData) return;
    const list=(_mapData.dealers||[]).filter(x=>!_dQ||String(x.name||"").toLowerCase().includes(_dQ)||String(x.username||"").toLowerCase().includes(_dQ));
    host.innerHTML=`<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <b style="font-size:12px">App-flow dealers</b><span class="rl" style="color:var(--muted)">· ${n((_mapData.dealers||[]).length)} with app orders in window (subset)</span>
        <button class="pill" id="rstDms" style="font-size:10px;padding:2px 9px">DMS roster ↔</button>
        <input id="dmsDQ" placeholder="search dealer…" value="${esc(_dQ)}" class="mono" style="margin-left:auto;padding:4px 8px;border:1px solid var(--line);border-radius:7px;background:var(--card2,rgba(148,163,184,.06));color:var(--ink);font-size:11px;width:140px"></div>
      <div style="overflow:auto;flex:1">
      <table style="width:100%;border-collapse:collapse;font-size:11.5px">
        <tr><th style="text-align:left;font-size:10px;color:var(--muted);padding:3px 6px">DEALER</th><th style="text-align:right;font-size:10px;color:var(--muted)">PLACED</th><th style="text-align:right;font-size:10px;color:var(--muted)">DONE</th><th style="text-align:right;font-size:10px;color:var(--muted)">CONV</th><th style="text-align:right;font-size:10px;color:var(--muted)">LAST</th></tr>
        ${list.map(x=>{ const cv=x.placed?Math.round(100*x.done/x.placed):0;
          return `<tr data-did="${x.id}" style="border-top:1px solid var(--line);cursor:pointer">
          <td style="padding:4px 6px;font-weight:600">${esc(x.name||x.username||("#"+x.id))}</td>
          <td class="mono" style="text-align:right">${n(x.placed)}</td>
          <td class="mono" style="text-align:right;color:var(--good);font-weight:700">${n(x.done)}</td>
          <td class="mono" style="text-align:right;color:${cv>=60?"#16a34a":cv>=30?"#d97706":"#dc2626"}">${cv}%</td>
          <td class="mono rl" style="text-align:right;color:var(--muted)">${esc(KT.md(x.last_at||""))}</td></tr>`; }).join("")}</table></div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-top:6px">Click a dealer for KPIs vs previous window + their orders (each drills to the Transaction timeline).</div>`;
    const q=$("#dmsDQ"); if(q){ q.addEventListener("input",()=>{ _dQ=q.value.trim().toLowerCase(); const pos=q.selectionStart; drawRoster(); const q2=$("#dmsDQ"); if(q2){ q2.focus(); q2.setSelectionRange(pos,pos); } }); }
    const bk=$("#rstDms"); if(bk) bk.addEventListener("click",drawRosterDms);
    host.querySelectorAll("[data-did]").forEach(r=>r.addEventListener("click",()=>openDealer(Number(r.dataset.did))));
  }
  async function openDealer(id){
    const host=$("#dmsRoster"); if(!host) return;
    host.innerHTML=`<div class="rl">Loading dealer…</div>`;
    const w=win();
    let d; try{ d=await api(`/api/dms/dealer/${id}?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`); }
    catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const D=d.dealer||{}, c=d.kpis.current||{}, p=d.kpis.previous||{};
    const vs=(a,b)=>{ a=a||0; b=b||0; if(a===b) return `<span class="rl" style="color:var(--muted)">=</span>`;
      const up=a>b; return `<span style="color:${up?"#16a34a":"#dc2626"};font-weight:700">${up?"▲":"▼"} ${n(Math.abs(a-b))}</span>`; };
    const cv=c.placed?Math.round(100*c.done/c.placed):0, pv=p.placed?Math.round(100*p.done/p.placed):0;
    const k=(l,v,d2)=>`<div style="flex:1;min-width:100px;background:var(--card2,rgba(148,163,184,.06));border:1px solid var(--line);border-radius:9px;padding:7px 10px">
      <div style="font-size:16px;font-weight:800">${v} <span style="font-size:10px">${d2||""}</span></div>
      <div class="rl" style="font-size:9.5px;text-transform:uppercase">${esc(l)}</div></div>`;
    host.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <button class="pill" id="dmsBack" style="padding:2px 10px">‹ All dealers</button>
        <b style="font-size:12.5px">${esc(D.name||D.username||("#"+id))}</b>
        <span class="rl" style="color:var(--muted)">· ${esc(D.username||"")}${D.mobile_number?" · "+esc(D.mobile_number):""}</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        ${k("Placed",n(c.placed),vs(c.placed,p.placed))}${k("Done",n(c.done),vs(c.done,p.done))}
        ${k("Conversion",cv+"%",vs(cv,pv))}${k("Active days",n(c.active_days),vs(c.active_days,p.active_days))}</div>
      ${(d.orders||[]).length?`<div style="margin-bottom:7px"><button class="btn" id="dmsWalk" style="font-size:11px;padding:4px 12px">▶ Walk all timelines (${(d.orders||[]).length})</button>
        <span class="rl" style="font-size:10px;color:var(--muted)"> · opens each order's timeline with Prev / Next — parse them one by one</span></div>`:""}
      <div style="overflow:auto;flex:1">
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <tr><th style="text-align:left;font-size:10px;color:var(--muted);padding:3px 6px">WHEN</th><th style="text-align:left;font-size:10px;color:var(--muted)">PLAN</th><th style="text-align:left;font-size:10px;color:var(--muted)">MOBILE</th><th style="text-align:left;font-size:10px;color:var(--muted)">STATE</th><th></th></tr>
        ${(d.orders||[]).map(o=>`<tr style="border-top:1px solid var(--line)">
          <td class="mono" style="padding:3px 6px;white-space:nowrap">${esc(KT.md(o.at))}</td>
          <td class="rl">${esc(o.plan||o.plan_id||"—")}${o.mnp_operator?` <span style="color:#3b82f6">·MNP</span>`:""}</td>
          <td class="mono">${esc(o.mobile_number||"—")}</td>
          <td><span style="font-weight:700;color:${o.activated?"#16a34a":o.completed?"#d97706":"var(--muted)"}">${o.activated?"activated":esc(o.aasm_state||o.status||"—")}</span></td>
          <td><button class="pill" data-dtl="${esc(o.id)}" style="padding:1px 8px;font-size:10px">Timeline →</button></td></tr>`).join("")}</table></div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-top:6px">vs = previous equal window (${esc(String(d.from).slice(5,10))} span). PII masked per role.</div>`;
    $("#dmsBack").addEventListener("click",drawRoster);
    /* the walker: order i's timeline with ‹Prev · i/N · Next› in the drawer header — the
       "10 orders, parse one by one" flow without bouncing back to the list each time */
    const olist=(d.orders||[]);
    const walk=i=>{ if(!olist[i]||!window.opsOpenTimeline) return;
      window.opsOpenTimeline(olist[i].id, null, ()=>openDealer(id),
        { pos:`${i+1} / ${olist.length}`,
          onPrev: i>0 ? ()=>walk(i-1) : null,
          onNext: i<olist.length-1 ? ()=>walk(i+1) : null });
      if(window.audit) window.audit("VIEW_TRACE", `walk ${i+1}/${olist.length} dealer ${id}`); };
    const wk=$("#dmsWalk"); if(wk) wk.addEventListener("click",()=>walk(0));
    host.querySelectorAll("[data-dtl]").forEach(b=>b.addEventListener("click",()=>{
      const i=olist.findIndex(o=>String(o.id)===String(b.dataset.dtl));
      if(i>=0) walk(i); else if(window.opsOpenTimeline) window.opsOpenTimeline(b.dataset.dtl,null,null);
    }));
    if(window.audit) window.audit("DMS_DEALER_UI", String(id));
  }

  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="dms") b.addEventListener("click", render); });
  window.openDms=render;
  window.renderDealerGw=renderGw;   // consumed by Monitoring → Gateway & API (#monDealerGw)
  window.renderDealerCardHtml=d360Html;   // consumed by the journeys dealer POPUP (dmsjourney.js)
})();
