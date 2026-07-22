/* Help / Explore dropdown under "?" — holds the guided tour + the EXPLORE views. */
(function(){
  "use strict";
  const btn=document.getElementById("tourBtn");
  const menu=document.getElementById("helpMenu");
  if(!btn||!menu) return;
  const EXPLORE=new Set(["topology","explorer","integrations"]);

  function open(){
    // close the sibling settings (gear) menu so only one popover is open at a time
    const sm=document.getElementById("settingsMenu"); if(sm) sm.classList.remove("open");
    menu.classList.add("open"); btn.classList.add("on");
  }
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
