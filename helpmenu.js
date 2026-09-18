/* Help / Explore dropdown under "?" — holds the guided tour + the EXPLORE views. */
(function(){
  "use strict";
  const btn=document.getElementById("tourBtn");
  const menu=document.getElementById("helpMenu");
  if(!btn||!menu) return;
  const EXPLORE=new Set(["topology","explorer","integrations"]);   // NOC wall moved to the gear menu (18 Sep 2026)

  function open(){
    // one popover at a time: the business dropdowns and the ⚙ menu close themselves on this event
    document.dispatchEvent(new CustomEvent("navpop",{detail:"help"}));
    menu.classList.add("open"); btn.classList.add("on");
  }
  document.addEventListener("navpop", e=>{ if(e.detail!=="help" && menu.classList.contains("open")) close(); });
  function close(){ menu.classList.remove("open"); syncBtn(); }
  function toggle(e){ e.stopPropagation(); menu.classList.contains("open")?close():open(); }
  // reflect whether an EXPLORE view is the current one
  function syncBtn(){
    const a=document.querySelector(".view.active");
    const v=a?a.id.replace("view-",""):null;
    btn.classList.toggle("on", EXPLORE.has(v));
  }

  btn.addEventListener("click", toggle);
  // clicking any item (tour or an explore nav) closes the menu
  menu.addEventListener("click", ()=>setTimeout(close,0));
  // outside click / escape
  document.addEventListener("click", e=>{ if(!e.target.closest(".helpwrap")) close(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") close(); });
  // keep the "?" highlighted while on an EXPLORE page
  document.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click",()=>setTimeout(syncBtn,0)));
  const gear=document.getElementById("settingsBtn"); if(gear) gear.addEventListener("click",()=>setTimeout(syncBtn,0));
  syncBtn();
})();
