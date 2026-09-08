/* Hash router — gives every page a shareable URL (#dashboard, #alerts, #audit, …)
 * and logs a VIEW_PAGE audit event on each navigation. Reuses the existing view
 * switchers so module loaders still run. */
(function(){
  "use strict";
  const ROUTES={
    "":{view:"landing"}, home:{view:"landing"}, landing:{view:"landing"}, dashboard:{home:true},
    monitoring:{view:"monitoring"},
    workbench:{workbench:true},
    // Growth was absorbed into Monitoring → Resellers. Old links keep working.
    analytics:{view:"analytics"}, growth:{view:"monitoring",monTab:"resellers"}, resellers:{view:"monitoring",monTab:"resellers"},
    dms:{view:"dms"}, fixed:{view:"fixed"}, "fixed-map":{view:"fixed"}, b2c:{view:"fixed"}, otodocs:{view:"otodocs"}, tapdocs:{view:"tapdocs"}, salamdocs:{view:"salamdocs"}, sla:{sla:true}, slo:{sla:true}, troubleshoot:{view:"errors"}, errors:{view:"errors"},
    alerts:{view:"alerts"}, "fixed-alerts":{view:"alerts",seg:"fixed"}, topology:{view:"topology"}, topology2:{view:"topology2"}, apigw:{view:"apigw"}, dmshld:{view:"apigw"},journeys:{view:"explorer"}, integrations:{view:"integrations"},
    subscriber:{view:"sub360"}, sub360:{view:"sub360"}, oncall:{oncall:true},
    settings:{settings:"users"}, "settings-users":{settings:"users"}, "settings-sync":{settings:"sync"},
    "settings-notify":{notifyClone:true}, "settings-notify-clone":{notifyClone:true},
    "settings-assist":{assistClone:true}, "settings-assist-clone":{assistClone:true},
    "settings-demo":{demoCfg:true},
    audit:{audit:true}, tickets:{tickets:true}
  };
  const VIEW_HASH={landing:"home",monitoring:"monitoring",analytics:"analytics",dms:"dms",fixed:"fixed",otodocs:"otodocs",tapdocs:"tapdocs",salamdocs:"salamdocs",errors:"troubleshoot",alerts:"alerts",topology:"topology",apigw:"apigw",explorer:"journeys",integrations:"integrations",sub360:"subscriber",home:"dashboard"};
  let _cur=null;

  /* ---- ROLE GUARD (2 Sep 2026) ---------------------------------------------------------------
   * Hiding tabs is cosmetic; a deep link still routed anywhere. Every route now declares the
   * view (page permission) it needs under the v2 model; a role without it gets a full
   * ACCESS DENIED panel — same message the API would 403 with — instead of a half-broken page.
   * The server gates the data regardless; this makes the denial clear instead of confusing. */
  const VIEW_REQ={ landing:"dashboard", monitoring:"monitoring", analytics:"analytics", dms:"dms", fixed:"fixed", errors:"errors", alerts:"alerts",
    home:"dashboard", topology:"explore", topology2:"explore", apigw:"explore", otodocs:"explore",
    tapdocs:"explore", salamdocs:"explore", explorer:"explore", integrations:"explore", sub360:"explore" };
  const PAGE_NAME={ dashboard:"Dashboard", monitoring:"Monitoring", dms:"DMS", fixed:"Fixed", errors:"Troubleshoot", alerts:"Alerts", fixed_alerts:"Fixed › Alerts",
    analytics:"Analytics / SLA", explore:"Explore", workbench:"L2 Workbench", settings:"Settings" };
  function sess(){ try{ return (window.opsSession&&window.opsSession())||{}; }catch(e){ return {}; } }
  function lacks(need){ const me=sess().me; if(!me||!Array.isArray(me.views)) return false;  // session not ready → don't block boot
    return !me.views.includes(need); }
  function neededFor(r){
    if(r.seg==="fixed") return "fixed_alerts";                 // Fixed incident view = the Fixed › Alerts permission
    if(r.view) return VIEW_REQ[r.view]||null;
    if(r.home) return "dashboard";
    if(r.workbench) return "workbench";
    if(r.settings) return "settings";
    if(r.oncall) return (lacks("errors")&&lacks("alerts")) ? "errors" : null;   // on-call = incident roles
    return null;   // audit/sla/tickets/assist have their own root/cap gates below
  }
  function showDeniedBiz(pageBiz,userBiz){
    let d=document.getElementById("accessDenied");
    if(!d){ d=document.createElement("div"); d.id="accessDenied";
      d.style.cssText="position:fixed;inset:0;top:var(--hdr);z-index:900;background:var(--bg);display:flex;align-items:center;justify-content:center";
      document.body.appendChild(d); }
    const P={mobile:"📱 Mobile",fixed:"🏠 Fixed"};
    d.innerHTML=`<div style="text-align:center;max-width:440px;padding:32px;background:var(--panel,#fff);border:1px solid var(--line,#e5e9e7);border-radius:14px">
      <div style="font-size:34px">${pageBiz==="fixed"?"🏠":"📱"}</div>
      <h3 style="margin:10px 0 6px">Not part of your business</h3>
      <p style="color:var(--muted,#64748b);font-size:13.5px;line-height:1.55">This page belongs to the <b>${P[pageBiz]}</b> side of the console. Your account is scoped to <b>${P[userBiz]||userBiz}</b>.
      If you work on both, ask an admin to set your business to <b>Mobile + Fixed</b> in User management.</p>
      <button class="pill" id="adHome" style="border-left-color:var(--green,#0e9f5a);margin-top:8px">Go to my home page</button></div>`;
    d.style.display="flex";
    const b=d.querySelector("#adHome"); if(b) b.onclick=()=>{ hideDenied(); setHash("home"); };
  }
  function showDenied(need){
    let d=document.getElementById("accessDenied");
    if(!d){ d=document.createElement("div"); d.id="accessDenied";
      d.style.cssText="position:fixed;inset:0;top:var(--hdr);z-index:900;background:var(--bg);display:flex;align-items:center;justify-content:center";
      document.body.appendChild(d); }
    const me=sess().me||{}; const role=String(me.role||"your role").replace(/_/g," ");
    d.innerHTML=`<div style="text-align:center;max-width:440px;padding:32px;background:var(--panel,#fff);border:1px solid var(--line,#e5e9e7);border-radius:14px">
      <div style="font-size:34px">🔒</div>
      <h3 style="margin:10px 0 6px">Access denied</h3>
      <p style="color:var(--muted,#64748b);font-size:13.5px;line-height:1.55">The <b>${PAGE_NAME[need]||need}</b> page is not included in the <b>${role}</b> role.
      If you need it, ask a Super Admin to grant it in Settings → Roles &amp; permissions.</p>
      <button class="pill" id="adHome" style="border-left-color:var(--green,#0e9f5a);margin-top:8px">Go to my home page</button></div>`;
    d.style.display="flex";
    const b=d.querySelector("#adHome"); if(b) b.onclick=()=>{ hideDenied();
      const first=document.querySelector(".navtab:not(.hidden)"); if(first){ first.click(); setHash(VIEW_HASH[first.dataset.view]||first.dataset.view||"dashboard"); } };
    window.audit && window.audit("ACCESS_DENIED", "#"+(_cur||"")+" needs "+need);
  }
  function hideDenied(){ const d=document.getElementById("accessDenied"); if(d) d.style.display="none"; }

  function clickNav(view){ const b=document.querySelector(`.navtab[data-view="${view}"].active`)||document.querySelector(`.navtab[data-view="${view}"]`); if(!b) return; if(!b.classList.contains("active")) b.click(); }
  // per-segment renderers that normally run on menu-button click — the router must call them too,
  // or a direct deep link (#settings-assist etc.) opens an empty segment
  const SEG_RENDER={assist:"renderAssistCfg",notify:"renderNotifyCfg",nav:"renderNavCfg"};
  function apply(){
    const h=(location.hash||"").replace(/^#/,"");
    const [base,qs]=h.split("?");
    // navigating anywhere closes floating overlays — a doc link clicked from the timeline
    // drawer must land on a CLEAN page, not render underneath the still-open drawer/modal
    const dr=document.getElementById("txnDrawer"); if(dr) dr.classList.remove("open");
    const pm=document.getElementById("panelModal"); if(pm) pm.classList.remove("open");
    // generic settings deep links: any #settings-<segment> routes to that segment (the explicit
    // table only knew users/sync/notify, so #settings-assist etc. silently fell back to home)
    let r=ROUTES[base];
    if(!r && /^settings-[a-z0-9_-]+$/.test(base)) r={settings:base.slice(9)};
    if(!r) r=ROUTES[""];
    _cur=h;
    // hidden root tier: #audit + #settings-assist deep links bounce home for excluded sessions
    // (me.root===false only when ROOT_ADMINS is configured server-side; the API 403s regardless)
    const notRoot=()=>{ const s=(window.opsSession&&window.opsSession())||{}; return s.me && s.me.root===false; };
    if((r.audit||r.assistClone||r.sla) && notRoot()){ window.opsGoHome && window.opsGoHome(); setHash("dashboard"); return; }
    // role guard — before any renderer runs (the API 403s regardless; this makes it CLEAR)
    hideDenied();
    const need=neededFor(r);
    if(need && lacks(need)){ showDenied(need); window.audit && window.audit("VIEW_PAGE","#"+(base||"dashboard")+" (denied)"); return; }
    // business guard (6 Sep 2026): a Mobile-only user never lands on a Fixed page and vice-versa, deep link or not
    const bizOf=r=>{ if(r.view==="fixed"||r.seg==="fixed") return "fixed"; if(r.home||["monitoring","dms","analytics","alerts","errors","topology","topology2","apigw","otodocs","tapdocs","salamdocs","explorer","integrations"].includes(r.view)||r.workbench||r.oncall) return "mobile"; return null; };
    const biz=(sess().me||{}).business||"both", rb=bizOf(r);
    if(rb && biz!=="both" && rb!==biz){ showDeniedBiz(rb,biz); window.audit && window.audit("VIEW_PAGE","#"+(base||"dashboard")+" (outside business)"); return; }
    if(r.home){ window.opsGoHome && window.opsGoHome(); }
    else if(r.workbench){ window.openWorkbench && window.openWorkbench(); }
    else if(r.sla){ window.openSla && window.openSla(); }
    else if(r.notifyClone){ window.openNotifyClone && window.openNotifyClone(); }
    else if(r.assistClone){ window.openAssistClone && window.openAssistClone(); }
    else if(r.demoCfg){ window.openDemoSettings && window.openDemoSettings(); }
    else if(r.oncall){ window.openOncall && window.openOncall(); }
    else if(r.settings){ window.openSettings && window.openSettings(r.settings);
      const fn=SEG_RENDER[r.settings]; if(fn && window[fn]) window[fn](); }
    else if(r.audit){ if(window.openAudit) window.openAudit(); else window.opsGoHome && window.opsGoHome(); }
    else if(r.tickets){ if(window.openTicketsBoard) window.openTicketsBoard(); else window.opsGoHome && window.opsGoHome(); }
    else if(r.view){
      /* Monitoring sub-tab deep link: #monitoring?tab=payments (and the #growth redirect).
       * Set BEFORE the nav click so the tab opens directly on the requested section instead of
       * drawing the default one first and visibly jumping. */
      if(r.view==="monitoring"){
        const m=/(?:^|&)tab=([a-z]+)/.exec(qs||"");
        const tab=r.monTab||(m?m[1]:null);
        if(tab && window.openMonitoring){ window.openMonitoring(tab); window.audit && window.audit("VIEW_PAGE","#monitoring?tab="+tab); return; }
      }
      clickNav(r.view);
      /* clickNav is a no-op when the tab is already active, so any view that only renders on a
       * navtab click stays blank on a deep link / reload / back-button. Call its opener too —
       * the openers are all idempotent. */
      const OPENER={ landing:"openLanding", alerts:"openAlerts", monitoring:"openMonitoring", dms:"openDms", fixed:"openFixed", analytics:"openAnalytics" };
      const fn=OPENER[r.view]; if(fn && typeof window[fn]==="function") { try{
        if(r.view==="fixed"){ const m=/(?:^|&)tab=([a-z]+)/.exec(qs||""); window[fn](m?m[1]:"overview"); }
        else if(r.view==="alerts"){ window[fn](r.seg||"mvno"); } else window[fn](); }catch(e){} }
      // Subscriber 360 deep link: #subscriber?key=966...
      if(r.view==="sub360" && window.openSub360){ const m=/key=([^&]+)/.exec(qs||""); const t=/(?:^|&)tab=([a-z]+)/.exec(qs||""); window.openSub360(m?decodeURIComponent(m[1]):undefined, t?t[1]:undefined); }
      // Troubleshoot deep link: #troubleshoot?from=..&to=..&cls=technical&cat=semati
      // carries the dashboard period + class + category so a shared/refreshed link matches the drill-down
      if(r.view==="errors"){
        const g=k=>{ const m=new RegExp("(?:^|&)"+k+"=([^&]+)").exec(qs||""); return m?decodeURIComponent(m[1]):undefined; };
        const from=g("from"), to=g("to"), cls=g("cls"), cat=g("cat");
        if(window.opsApplyErrTarget && (from||to||cls!==undefined||cat!==undefined)) window.opsApplyErrTarget({from,to,cls,cat});
        else if(cat!==undefined && window.opsSelectErrorCategory) window.opsSelectErrorCategory(cat);
      }
    }
    window.audit && window.audit("VIEW_PAGE", "#"+(base||"dashboard"));
  }
  window.setConsoleHash=function(h){ if(location.hash!=="#"+h) location.hash="#"+h; };
  function setHash(h){ if(_cur===h) return; _cur=h; if(location.hash!=="#"+h) location.hash="#"+h; }

  // reflect user navigation into the URL (activation is handled by the existing modules)
  document.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click",()=>{ if(b.dataset.fxtab) return;   // Home sub-tabs set their own hash (navdrop.js)
    const v=b.dataset.view; setHash(VIEW_HASH[v]||v); }));
  const logo=document.querySelector(".logo"); if(logo) logo.addEventListener("click",()=>setHash("dashboard"));
  document.querySelectorAll("#settingsMenu [data-seg]").forEach(b=>b.addEventListener("click",()=>setHash("settings-"+b.dataset.seg)));
  const auditItem=document.querySelector("#settingsMenu [data-audit]"); if(auditItem) auditItem.addEventListener("click",()=>setHash("audit"));
  const ticketsItem=document.querySelector("#settingsMenu [data-tickets]"); if(ticketsItem) ticketsItem.addEventListener("click",()=>setHash("tickets"));
  const wbItem=document.querySelector("#settingsMenu [data-workbench]"); if(wbItem) wbItem.addEventListener("click",()=>setHash("workbench"));
  const slaItem=document.querySelector("#settingsMenu [data-sla]"); if(slaItem) slaItem.addEventListener("click",()=>setHash("sla"));

  window.addEventListener("hashchange",apply);
  // Apply the initial URL once the session is ready (so a shared/deep link opens the right page).
  // Deferred to the next tick so the boot's default-view (dashboard) activation can't override a
  // direct load of #settings-*, #alerts, #troubleshoot?cat=…, etc.
  let _booted=false;
  function bootRoute(){
    if(_booted) return; _booted=true;
    if(location.hash) setTimeout(apply, 0);
    else { _cur="dashboard"; window.audit && window.audit("VIEW_PAGE","#dashboard"); }
  }
  document.addEventListener("consoleReady", bootRoute);
  // router.js loads near the end of the page; if the session became ready before this listener
  // was registered, the consoleReady event was already missed — self-heal by routing now.
  if(window.__consoleReady) bootRoute();
})();
