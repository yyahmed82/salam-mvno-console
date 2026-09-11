/* Settings gear → submenu toggling two segments: User management + Sync engine. */
(function(){
  "use strict";
  const gear=document.getElementById("settingsBtn");
  const menu=document.getElementById("settingsMenu");
  if(!gear||!menu) return;
  const $=s=>document.querySelector(s);

  function closeMenu(){ menu.classList.remove("open"); }
  function showSeg(seg){
    document.querySelectorAll("#view-settings .setseg").forEach(s=>s.classList.toggle("active", s.dataset.seg===seg));
    menu.querySelectorAll("[data-seg]").forEach(b=>b.classList.toggle("active", b.dataset.seg===seg));
  }
  // open the settings view on a given segment (also used by the guided tour)
  window.openSettings=function(seg){
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    gear.classList.add("on");
    const t=document.getElementById("tourBtn"); if(t) t.classList.remove("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    const v=$("#view-settings"); if(v) v.classList.add("active");
    showSeg(seg||"users");
    if(window.opsLoadSettings) window.opsLoadSettings();
  };

  gear.addEventListener("click", e=>{ e.stopPropagation();
    // close the sibling "?" menu so only one popover is open at a time
    const hm=document.getElementById("helpMenu"); if(hm) hm.classList.remove("open");
    const tb=document.getElementById("tourBtn"); if(tb) tb.classList.remove("on");
    menu.classList.contains("open")?closeMenu():menu.classList.add("open"); });
  menu.querySelectorAll("[data-seg]").forEach(b=>b.addEventListener("click", ()=>{
    // Notify + Yusr use standalone replacement views (their legacy in-settings segments are retired)
    if(b.dataset.seg==="notify" && window.openNotifyClone){ window.openNotifyClone(); closeMenu(); return; }
    if(b.dataset.seg==="assist" && window.openAssistClone){ window.openAssistClone(); closeMenu(); return; }
    window.openSettings(b.dataset.seg); closeMenu(); }));
  const demoItem=menu.querySelector("[data-demo]"); if(demoItem) demoItem.addEventListener("click", ()=>{ if(window.openDemoSettings){ window.openDemoSettings(); if(location.hash!=="#settings-demo") location.hash="#settings-demo"; } closeMenu(); });
  const auditItem=menu.querySelector("[data-audit]"); if(auditItem) auditItem.addEventListener("click", ()=>{ if(window.openAudit) window.openAudit(); closeMenu(); });
  const wb=menu.querySelector("[data-workbench]"); if(wb) wb.addEventListener("click", ()=>{ if(window.openWorkbench) window.openWorkbench(); closeMenu(); });
  const ag=menu.querySelector("[data-agents]"); if(ag) ag.addEventListener("click", ()=>{ if(window.openAgents){ window.openAgents(); if(location.hash!=="#agents") location.hash="#agents"; } closeMenu(); });
  const sla=menu.querySelector("[data-sla]"); if(sla) sla.addEventListener("click", ()=>{ if(window.openSla) window.openSla(); closeMenu(); });
  document.addEventListener("click", e=>{ if(!e.target.closest(".setwrap")) closeMenu(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeMenu(); });
  // leaving settings via a nav tab clears the gear highlight
  document.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click", ()=>gear.classList.remove("on")));
})();
