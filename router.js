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
    dms:{view:"dms"}, fixed:{view:"fixed"}, "fixed-map":{view:"fixed"}, b2c:{view:"fixed"}, otodocs:{view:"otodocs"}, tapdocs:{view:"tapdocs"}, salamdocs:{view:"salamdocs"}, dmsdocs:{view:"dmsdocs"}, "dms-api":{view:"dmsdocs"}, "alert-journey":{view:"alertjourney"}, alertjourney:{view:"alertjourney"}, sla:{sla:true}, slo:{sla:true}, "slo-settings":{sloSettings:true}, "sla-targets":{sloSettings:true}, "vendor-contracts":{vendorContracts:true}, vendors:{vendorContracts:true}, "semati-clearance":{semati:true}, semati:{semati:true}, troubleshoot:{view:"errors"}, errors:{view:"errors"},
    refunds:{view:"refunds"}, "refund-exposure":{view:"refunds"},
    flowguard:{view:"flowguard"}, "flow-guard":{view:"flowguard"}, infra:{view:"infra"}, infrastructure:{view:"infra"},
    alerts:{view:"alerts"}, "fixed-alerts":{view:"alerts",seg:"fixed"}, "infra-alerts":{view:"alerts",seg:"mvno",scope:"infra"}, "fixed-infra-alerts":{view:"alerts",seg:"fixed",scope:"infra"}, topology:{view:"topology"}, topology2:{view:"topology2"}, apigw:{view:"apigw"}, dmshld:{view:"apigw"}, mvnohld:{view:"topology2",t2:"hld"}, "bss-atlas":{view:"topology2",t2:"hld"}, journeys:{view:"explorer"}, integrations:{view:"integrations"},
    subscriber:{view:"sub360"}, sub360:{view:"sub360"}, oncall:{oncall:true}, "fixed-oncall":{oncall:true,seg:"fixed"},
    settings:{settings:"users"}, "settings-users":{settings:"users"}, "settings-sync":{settings:"sync"},
    "settings-notify":{notifyClone:true}, "settings-notify-clone":{notifyClone:true},
    "settings-assist":{assistClone:true}, "settings-assist-clone":{assistClone:true},
    "settings-demo":{demoCfg:true},
    agents:{agents:true}, "settings-agents":{agents:true}, "agents-live":{mission:true}, mission:{mission:true}, robots:{mission:true}, teams:{teams:true}, "settings-teams":{teams:true},
    /* Executive / Operations (12 Sep 2026): Home = both businesses, Mobile = MVNO only; Fixed lives in the hub (#fixed?tab=exec|ops) */
    exec:{view:"execops"}, "executive":{view:"execops"},
    noc:{view:"nocwall"},                       // NOC walls (16 Sep 2026): #noc = alert radar, #noc?w=kpi = key indicators
    /* merged 12 Sep 2026 — old entry points keep working, they just land on the page that absorbed them */
    ops:{view:"landing"}, "mobile-exec":{view:"execops"}, "mobile-ops":{home:true},
    audit:{audit:true}, tickets:{tickets:true},
    /* CST section (16 Sep 2026, super admin): #arqami · #cst-escalations (cstpage.js) */
    arqami:{cst:"arqami"}, "cst-escalations":{cst:"escalations"}, cst:{cst:"escalations"}
  };
  const VIEW_HASH={landing:"home",execops:"exec",nocwall:"noc",monitoring:"monitoring",analytics:"analytics",dms:"dms",fixed:"fixed",otodocs:"otodocs",tapdocs:"tapdocs",salamdocs:"salamdocs",dmsdocs:"dmsdocs",alertjourney:"alert-journey",errors:"troubleshoot",refunds:"refunds",flowguard:"flowguard",infra:"infra",alerts:"alerts",topology:"topology",apigw:"apigw",explorer:"journeys",integrations:"integrations",sub360:"subscriber",home:"dashboard"};
  let _cur=null;

  /* ---- ROLE GUARD (2 Sep 2026) ---------------------------------------------------------------
   * Hiding tabs is cosmetic; a deep link still routed anywhere. Every route now declares the
   * view (page permission) it needs under the v2 model; a role without it gets a full
   * ACCESS DENIED panel — same message the API would 403 with — instead of a half-broken page.
   * The server gates the data regardless; this makes the denial clear instead of confusing. */
  const VIEW_REQ={ landing:"dashboard", execops:"exec", nocwall:"noc", monitoring:"monitoring", analytics:"analytics", dms:"dms", fixed:"fixed", errors:"errors", alerts:"alerts", flowguard:"errors", infra:"noc",
    home:"dashboard", topology:"explore", topology2:"explore", apigw:"explore", mvnohld:"explore", otodocs:"explore",
    tapdocs:"explore", salamdocs:"explore", dmsdocs:"explore", alertjourney:"explore", explorer:"explore", integrations:"explore", sub360:"explore" };
  const PAGE_NAME={ dashboard:"Dashboard", monitoring:"Monitoring", dms:"DMS", fixed:"Fixed", errors:"Troubleshoot", alerts:"Alerts", fixed_alerts:"Fixed › Alerts",
    analytics:"Reports", explore:"Explore & Customer 360", workbench:"L2 Workbench", settings:"Settings",
    exec:"Executive Dashboard", noc:"NOC wall", governance:"IT Governance", cst:"CST", audit:"Audit log", tickets:"Tickets & feedback", users:"User management" };
  /* WHERE A ROLE STARTS (19 Sep 2026) — #'' and #home resolve to the landing page, which needs 'dashboard'.
   * Every role had that view, so it never mattered; the CIO role does not, and a narrow custom role need not
   * either, so signing in used to end on ACCESS DENIED. This is the first page the session can actually open,
   * in the order a person would want it, and it also feeds the "Go to my home page" button on the denial panel. */
  const HOME_ORDER=[["dashboard","home"],["exec","exec"],["fixed","fixed"],["monitoring","monitoring"],["alerts","alerts"],
    ["errors","troubleshoot"],["dms","dms"],["analytics","analytics"],["fixed_epurchase","fixed?tab=epurchase"],
    ["fixed_salamhome","fixed?tab=salamhome"],["fixed_alerts","fixed-alerts"],["fixed_errors","fixed?tab=errors"],
    ["fixed_reports","fixed?tab=dash"],["fixed_maps","fixed?tab=map"],["noc","noc"],["explore","subscriber"],
    ["tickets","tickets"],["governance","sla"],["cst","arqami"],["workbench","workbench"],["users","settings-users"],["settings","settings"]];
  function homeHash(){ const me=sess().me; if(!me||!Array.isArray(me.views)) return "dashboard";
    const hit=HOME_ORDER.find(([v])=>me.views.includes(v)); return hit?hit[1]:"dashboard"; }
  window.consoleHomeHash=homeHash;
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
    const b=d.querySelector("#adHome"); if(b) b.onclick=()=>{ hideDenied(); setHash(homeHash()); };
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
    /* the first visible nav tab is not always reachable (a role can hold a page that has no tab, e.g. the
     * CIO's Executive Dashboard sits outside the two business dropdowns) — ask the permission list instead */
    const bt=d.querySelector("#adHome"); if(bt) bt.onclick=()=>{ hideDenied(); setHash(homeHash()); };
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
    if((r.audit||r.assistClone||r.sla||r.sloSettings||r.agents) && notRoot()){ window.opsGoHome && window.opsGoHome(); setHash(homeHash()); return; }
    // role guard — before any renderer runs (the API 403s regardless; this makes it CLEAR)
    hideDenied();
    const need=neededFor(r);
    if(need && lacks(need)){
      /* arriving at the default route (no hash, #home, #dashboard) with no right to it means the role simply
       * starts somewhere else — send them there instead of greeting them with ACCESS DENIED at sign-in */
      const landed=!base||base==="home"||base==="dashboard"||base==="landing";
      const alt=homeHash();
      if(landed && alt && alt!==base){ setHash(alt); return; }
      showDenied(need); window.audit && window.audit("VIEW_PAGE","#"+(base||"dashboard")+" (denied)"); return;
    }
    // business guard (6 Sep 2026): a Mobile-only user never lands on a Fixed page and vice-versa, deep link or not
    const bizOf=r=>{ if(r.view==="fixed"||r.seg==="fixed") return "fixed"; if(r.view==="execops") return null; if(r.home||["monitoring","dms","analytics","alerts","errors","topology","topology2","apigw","mvnohld","otodocs","tapdocs","salamdocs","dmsdocs","alertjourney","explorer","integrations"].includes(r.view)||r.workbench||r.oncall) return "mobile"; return null; };
    const biz=(sess().me||{}).business||"both", rb=bizOf(r);
    if(rb && biz!=="both" && rb!==biz){ showDeniedBiz(rb,biz); window.audit && window.audit("VIEW_PAGE","#"+(base||"dashboard")+" (outside business)"); return; }
    if(r.home){ window.opsGoHome && window.opsGoHome(); }
    else if(r.workbench){ window.openWorkbench && window.openWorkbench(); }
    else if(r.sla){ window.openSla && window.openSla(); }
    else if(r.sloSettings){ window.openSloSettings && window.openSloSettings(); }
    else if(r.vendorContracts){ window.openVendorContracts && window.openVendorContracts(); }
    else if(r.semati){ window.openSematiClearance && window.openSematiClearance(); }
    else if(r.cst){ window.openCst && window.openCst(r.cst); }
    else if(r.notifyClone){ window.openNotifyClone && window.openNotifyClone(); }
    else if(r.assistClone){ window.openAssistClone && window.openAssistClone(); }
    else if(r.agents){ window.openAgents && window.openAgents(); }
    else if(r.mission){ window.openAgentsMission && window.openAgentsMission(); }
    else if(r.teams){ window.openTeams && window.openTeams(); }
    else if(r.demoCfg){ window.openDemoSettings && window.openDemoSettings(); }
    else if(r.oncall){ window.openOncall && window.openOncall(r.seg==="fixed"?"fixed":"mvno"); if(r.seg==="fixed"){ const fb=document.querySelector('.navtab[data-fxtab="alerts"]'); if(fb) fb.classList.add("active"); } }
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
      /* Fixed incident view (#fixed-alerts): the SAME #view-alerts section, but activated by hand — clickNav('alerts')
       * would click the Mobile Alerts tab, whose click listener rewrites the hash to #alerts (the bug seen 8 Sep). */
      if(r.scope==="infra"){   // Infrastructure › Alerts (Mobile infra / Fixed infra): same #view-alerts, activated by hand like #fixed-alerts
        document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
        document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active", x.id==="view-"+r.view));
        const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.remove("on");
        if(window.navdropSync) window.navdropSync();
        if(typeof window.openAlerts==="function") { try{ window.openAlerts(r.seg, "infra"); }catch(e){} }
        window.audit && window.audit("VIEW_PAGE", "#"+base); return;
	      }
      if(r.seg==="fixed"){
        document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
        document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active", x.id==="view-"+r.view));
        const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.remove("on");
        const fb=document.querySelector('.navtab[data-fxtab="alerts"]'); if(fb) fb.classList.add("active");
        if(typeof window.openAlerts==="function") { try{ window.openAlerts("fixed"); }catch(e){} }
        window.audit && window.audit("VIEW_PAGE", "#fixed-alerts"); return;
	      }
	      if(r.view==="infra"&&window.navdropSync) window.navdropSync();   // the Infrastructure ▾ child matching the hash goes active first, so clickNav no-ops instead of clicking the first child
	      clickNav(r.view);
	      // A Fixed deep link can make navdrop mark a Fixed child active before clickNav runs; in that
	      // case clickNav intentionally no-ops, so make the destination view visible here as well.
	      document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active", x.id==="view-"+r.view));
	      const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.remove("on");
	      /* clickNav is a no-op when the tab is already active, so any view that only renders on a
	       * navtab click stays blank on a deep link / reload / back-button. Call its opener too —
       * the openers are all idempotent. */
      const OPENER={ refunds:"openRefunds", flowguard:"openFlowGuard", infra:"openInfra", landing:"openLanding", execops:"openExecOps", nocwall:"openNocWall", alerts:"openAlerts", monitoring:"openMonitoring", dms:"openDms", fixed:"openFixed", analytics:"openAnalytics", topology2:"openTopology2", alertjourney:"openAlertJourney" };
      const fn=OPENER[r.view]; if(fn && typeof window[fn]==="function") { try{
        if(r.view==="fixed"){ const m=/(?:^|&)tab=([a-z]+)/.exec(qs||""); let t=m?m[1]:"overview";
          if(t==="exec"||t==="ops") t="overview";   // merged into the Operations Dashboard
          window[fn](t); }
        else if(r.view==="alerts"){ window[fn](r.seg||"mvno"); }
        else if(r.view==="refunds"){ window[fn](qs?"refunds?"+qs:""); }   // #refunds?tab=ledger&from=..&to=.. — the navtab click above has already reset the hash to a bare #refunds
        else if(r.view==="flowguard"){ window[fn](qs?"flowguard?"+qs:""); }
        else if(r.view==="infra"){ window[fn](qs?"infra?"+qs:""); }   // #infra?tab=map&diagram=fixed · #infra?host=12   // #flowguard?tab=plans&status=activated&q=… (same pattern)
        else if(r.view==="topology2"){ const m=/(?:^|&)t=([a-z]+)/.exec(qs||""); window[fn](r.t2||(m?m[1]:"map")); }   // #mvnohld / #topology2?t=hld
        else window[fn](); }catch(e){} }
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
  document.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click",()=>{ if(b.dataset.fxtab||b.dataset.iftab) return;   // Home sub-tabs set their own hash (navdrop.js)
    const v=b.dataset.view; setHash(b.dataset.hash||VIEW_HASH[v]||v); }));   // data-hash: one view, several entries (Executive / Operations)
  const logo=document.querySelector(".logo"); if(logo) logo.addEventListener("click",()=>setHash("dashboard"));
  document.querySelectorAll("#settingsMenu [data-seg]").forEach(b=>b.addEventListener("click",()=>setHash("settings-"+b.dataset.seg)));
  const auditItem=document.querySelector("#settingsMenu [data-audit]"); if(auditItem) auditItem.addEventListener("click",()=>setHash("audit"));
  const ticketsItem=document.querySelector("#settingsMenu [data-tickets]"); if(ticketsItem) ticketsItem.addEventListener("click",()=>setHash("tickets"));
  const wbItem=document.querySelector("#settingsMenu [data-workbench]"); if(wbItem) wbItem.addEventListener("click",()=>setHash("workbench"));
  const slaItem=document.querySelector("#settingsMenu [data-sla]"); if(slaItem) slaItem.addEventListener("click",()=>setHash("sla"));
  const vendorContractsItem=document.querySelector("#settingsMenu [data-vendor-contracts]"); if(vendorContractsItem) vendorContractsItem.addEventListener("click",()=>setHash("vendor-contracts"));
  const sloSettingsItem=document.querySelector("#settingsMenu [data-slo-settings]"); if(sloSettingsItem) sloSettingsItem.addEventListener("click",()=>setHash("slo-settings"));

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
