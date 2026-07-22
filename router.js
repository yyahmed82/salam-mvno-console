/* Hash router — gives every page a shareable URL (#dashboard, #alerts, #audit, …)
 * and logs a VIEW_PAGE audit event on each navigation. Reuses the existing view
 * switchers so module loaders still run. */
(function(){
  "use strict";
  const ROUTES={
    "":{home:true}, dashboard:{home:true}, home:{home:true},
    analytics:{view:"analytics"}, growth:{view:"growth"}, sla:{view:"slo"}, slo:{view:"slo"}, troubleshoot:{view:"errors"}, errors:{view:"errors"},
    alerts:{view:"alerts"}, topology:{view:"topology"}, journeys:{view:"explorer"}, integrations:{view:"integrations"},
    subscriber:{view:"sub360"}, sub360:{view:"sub360"}, oncall:{oncall:true},
    settings:{settings:"users"}, "settings-users":{settings:"users"}, "settings-sync":{settings:"sync"}, "settings-notify":{settings:"notify"},
    audit:{audit:true}
  };
  const VIEW_HASH={analytics:"analytics",growth:"growth",slo:"sla",errors:"troubleshoot",alerts:"alerts",topology:"topology",explorer:"journeys",integrations:"integrations",sub360:"subscriber",home:"dashboard"};
  let _cur=null;

  function clickNav(view){ const b=document.querySelector(`.navtab[data-view="${view}"]`); if(!b) return; if(!b.classList.contains("active")) b.click(); }
  function apply(){
    const h=(location.hash||"").replace(/^#/,"");
    const [base,qs]=h.split("?");
    const r=ROUTES[base]||ROUTES[""];
    _cur=h;
    if(r.home){ window.opsGoHome && window.opsGoHome(); }
    else if(r.oncall){ window.openOncall && window.openOncall(); }
    else if(r.settings){ window.openSettings && window.openSettings(r.settings); if(r.settings==="notify" && window.renderNotifyCfg) window.renderNotifyCfg(); }
    else if(r.audit){ if(window.openAudit) window.openAudit(); else window.opsGoHome && window.opsGoHome(); }
    else if(r.view){ clickNav(r.view);
      // Subscriber 360 deep link: #subscriber?key=966...
      if(r.view==="sub360" && window.openSub360){ const m=/key=([^&]+)/.exec(qs||""); window.openSub360(m?decodeURIComponent(m[1]):undefined); }
      // Troubleshoot per-category deep link: #troubleshoot?cat=semati
      if(r.view==="errors" && window.opsSelectErrorCategory){ const m=/cat=([^&]+)/.exec(qs||""); if(m) window.opsSelectErrorCategory(decodeURIComponent(m[1])); }
    }
    window.audit && window.audit("VIEW_PAGE", "#"+(base||"dashboard"));
  }
  window.setConsoleHash=function(h){ if(location.hash!=="#"+h) location.hash="#"+h; };
  function setHash(h){ if(_cur===h) return; _cur=h; if(location.hash!=="#"+h) location.hash="#"+h; }

  // reflect user navigation into the URL (activation is handled by the existing modules)
  document.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click",()=>{ const v=b.dataset.view; setHash(VIEW_HASH[v]||v); }));
  const logo=document.querySelector(".logo"); if(logo) logo.addEventListener("click",()=>setHash("dashboard"));
  document.querySelectorAll("#settingsMenu [data-seg]").forEach(b=>b.addEventListener("click",()=>setHash("settings-"+b.dataset.seg)));
  const auditItem=document.querySelector("#settingsMenu [data-audit]"); if(auditItem) auditItem.addEventListener("click",()=>setHash("audit"));

  window.addEventListener("hashchange",apply);
  // apply the initial URL once the session is ready (so a shared link opens the right page)
  document.addEventListener("consoleReady",()=>{ if(location.hash) apply(); else { _cur="dashboard"; window.audit && window.audit("VIEW_PAGE","#dashboard"); } });
})();
