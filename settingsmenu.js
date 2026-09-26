/* Settings gear → submenu toggling two segments: User management + Sync engine. */
(function(){
  "use strict";
  const gear=document.getElementById("settingsBtn");
  const menu=document.getElementById("settingsMenu");
  if(!gear||!menu) return;
  const $=s=>document.querySelector(s);

  /* The gear lights while its own menu is open, and stays lit while a settings page is the current view.
   * Until 19 Sep 2026 the open path never set it: .on was added only by window.openSettings(), so pulling
   * the menu down left the gear grey with its own panel hanging underneath it. One helper owns the state
   * now, so open, close, Escape, an outside click and a nav tab all end up saying the same thing. */
  const onSettingsPage=()=>{ const v=document.getElementById("view-settings"); return !!(v&&v.classList.contains("active")); };
  function syncGear(){ gear.classList.toggle("on", menu.classList.contains("open")||onSettingsPage()); }
  function closeMenu(){ menu.classList.remove("open"); syncGear(); }
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

  /* ---- collapsible sections (16 Sep 2026): the gear menu folds like the Mobile / Fixed dropdowns ----
   * Every .hm-group label (SETTINGS · AI · IT GOVERNANCE · REGULATORY AFFAIRS) becomes a disclosure row followed by a wrapper of its
   * items; accordion (opening one folds the others); state remembered per group; a group with no visible item for
   * this role disappears with its row; the group holding the active page opens itself once per page change. */
  const SECT_ICON={
    SETTINGS:'<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    AI:'<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>',
    'IT GOVERNANCE':'<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    'REGULATORY AFFAIRS':'<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 7h18M6 7l-3 7a3 3 0 0 0 6 0L6 7zM18 7l-3 7a3 3 0 0 0 6 0l-3-7"/></svg>',
    'NOC WALL':'<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'
  };
  SECT_ICON['CONSOLE SETTINGS']=SECT_ICON.SETTINGS; SECT_ICON['AI OPS']=SECT_ICON.AI;
  SECT_ICON['TEAMS MANAGEMENT']='<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 13.6c3.2.2 6 2.2 6 5.4"/></svg>';
  const SECT_DEFAULT={ 'TEAMS MANAGEMENT':true };
  const skey=g=>`settsect:${g}`;
  const wanted=g=>{ try{ const v=localStorage.getItem(skey(g)); if(v==="1") return true; if(v==="0") return false; }catch(_){} return !!SECT_DEFAULT[g]; };
  const remember=(g,open)=>{ try{ localStorage.setItem(skey(g), open?"1":"0"); }catch(_){} };
  const LABEL={ 'AI OPS':'AI Ops', 'NOC WALL':'NOC wall', 'IT GOVERNANCE':'IT governance' };
  const titleCase=k=>LABEL[k]||(k.charAt(0)+k.slice(1).toLowerCase());
  const isItem=el=>el.classList.contains("hm-tour")||el.classList.contains("navtab");
  function markSections(){
    if(menu.dataset.sect) return; menu.dataset.sect="1";
    let sect=null, key="";
    Array.from(menu.children).forEach(el=>{
      if(el.classList.contains("hm-group")){
        key=(el.dataset.gkey||el.textContent||"").trim().toUpperCase();   // data-gkey (26 Sep 2026): the key survives the Arabic labels
        el.dataset.gkey=key; el.dataset.collapse="1"; el.classList.add("navgroup"); el.setAttribute("role","button"); el.tabIndex=0;
        el.innerHTML=`<span class="ngi">${SECT_ICON[key]||""}</span><span class="ngl">${titleCase(key)}</span><b class="ngn"></b><i class="ngc" aria-hidden="true">▾</i>`;
        sect=document.createElement("div"); sect.className="navsect"; sect.dataset.gkey=key; sect.innerHTML='<div class="navsect-in"></div>';
        el.after(sect);
        const open=wanted(key); sect.classList.toggle("open",open); el.setAttribute("aria-expanded",open?"true":"false");
      } else if(isItem(el)&&sect){ sect.querySelector(".navsect-in").appendChild(el); }
    });
  }
  const setSect=(g,open)=>{ const sect=g.nextElementSibling; if(!sect||!sect.classList.contains("navsect")) return; sect.classList.toggle("open",open); g.setAttribute("aria-expanded",open?"true":"false"); };
  function toggleSect(g){
    const sect=g.nextElementSibling; if(!sect) return; const open=!sect.classList.contains("open");
    if(open) menu.querySelectorAll(".navgroup[data-collapse]").forEach(o=>{ if(o!==g){ setSect(o,false); remember(o.dataset.gkey,false); } });
    setSect(g,open); remember(g.dataset.gkey,open);
  }
  function syncSections(){
    markSections();
    menu.querySelectorAll(".navgroup[data-collapse]").forEach(g=>{
      const sect=g.nextElementSibling; if(!sect) return;
      const items=Array.from(sect.querySelectorAll(".hm-tour,.navtab")).filter(t=>!t.classList.contains("hidden")&&t.style.display!=="none");
      items.forEach((t,i)=>t.style.setProperty("--i",i));
      const n=items.length, ngn=g.querySelector(".ngn"); if(ngn){ ngn.textContent=n||""; ngn.hidden=!n; }
      /* ops.js hides the IT GOVERNANCE / REGULATORY AFFAIRS group labels for non-super-admins with style.display; honour it and the empty case */
      const hide=!n||g.style.display==="none"; g.hidden=hide; sect.hidden=hide;
    });
    /* the group holding the current page opens itself, once per page change */
    const h=(location.hash||"").replace(/^#/,"").split("?")[0];
    const map={ "settings-users":"TEAMS MANAGEMENT","teams":"TEAMS MANAGEMENT","settings-teams":"TEAMS MANAGEMENT","settings":"CONSOLE SETTINGS","settings-sync":"CONSOLE SETTINGS","settings-notify":"CONSOLE SETTINGS","settings-demo":"CONSOLE SETTINGS","audit":"CONSOLE SETTINGS","tickets":"CONSOLE SETTINGS","agents":"AI OPS","agents-live":"AI OPS","mission":"AI OPS","settings-agents":"AI OPS","settings-assist":"AI OPS", "noc":"NOC WALL","arqami":"REGULATORY AFFAIRS","cst-escalations":"REGULATORY AFFAIRS","cst":"REGULATORY AFFAIRS","sla":"IT GOVERNANCE","slo":"IT GOVERNANCE","slo-settings":"IT GOVERNANCE","vendor-contracts":"IT GOVERNANCE","vendors":"IT GOVERNANCE","settings-assist-clone":"AI OPS" };
    const want=map[h]; if(want && menu.dataset.auto!==h){ menu.dataset.auto=h; menu.querySelectorAll(".navgroup[data-collapse]").forEach(g=>setSect(g, g.dataset.gkey===want)); }
    if(![...menu.querySelectorAll(".navsect")].some(s=>s.classList.contains("open")&&!s.hidden)){ const first=menu.querySelector(".navgroup[data-collapse]:not([hidden])"); if(first) setSect(first,true); }
  }
  menu.addEventListener("click", e=>{ const g=e.target.closest&&e.target.closest(".navgroup[data-collapse]"); if(!g) return; e.stopPropagation(); e.preventDefault(); toggleSect(g); });
  menu.addEventListener("keydown", e=>{ if(e.key!=="Enter"&&e.key!==" ") return; const g=e.target.closest&&e.target.closest(".navgroup[data-collapse]"); if(!g) return; e.preventDefault(); toggleSect(g); });

  document.addEventListener("navpop", e=>{ if(e.detail!=="settings") closeMenu(); });
  gear.addEventListener("click", e=>{ e.stopPropagation();
    if(menu.classList.contains("open")) return closeMenu();
    // one popover at a time: tell the business dropdowns and the "?" menu to close
    document.dispatchEvent(new CustomEvent("navpop",{detail:"settings"}));
    const tb=document.getElementById("tourBtn"); if(tb) tb.classList.remove("on");
    menu.classList.add("open"); syncGear(); syncSections(); menu.classList.add("reveal"); setTimeout(()=>menu.classList.remove("reveal"),700); });
  menu.querySelectorAll("[data-seg]").forEach(b=>b.addEventListener("click", ()=>{
    // Notify + Yusr use standalone replacement views (their legacy in-settings segments are retired)
    if(b.dataset.seg==="notify" && window.openNotifyClone){ window.openNotifyClone(); closeMenu(); return; }
    if(b.dataset.seg==="assist" && window.openAssistClone){ window.openAssistClone(); closeMenu(); return; }
    window.openSettings(b.dataset.seg); closeMenu(); }));
  const demoItem=menu.querySelector("[data-demo]"); if(demoItem) demoItem.addEventListener("click", ()=>{ if(window.openDemoSettings){ window.openDemoSettings(); if(location.hash!=="#settings-demo") location.hash="#settings-demo"; } closeMenu(); });
  const auditItem=menu.querySelector("[data-audit]"); if(auditItem) auditItem.addEventListener("click", ()=>{ if(window.openAudit) window.openAudit(); closeMenu(); });
  const wb=menu.querySelector("[data-workbench]"); if(wb) wb.addEventListener("click", ()=>{ if(window.openWorkbench) window.openWorkbench(); closeMenu(); });
  const tm=menu.querySelector("[data-teams]"); if(tm) tm.addEventListener("click", ()=>{ if(window.openTeams){ window.openTeams(); if(location.hash!=="#teams") location.hash="#teams"; } closeMenu(); });
  const trd=menu.querySelector("[data-teams-refunds]"); if(trd) trd.addEventListener("click", ()=>{ const h="teams?section=refunds"; if(window.setConsoleHash) window.setConsoleHash(h); else if(location.hash!=="#"+h) location.hash="#"+h; if(window.openTeams) window.openTeams(); closeMenu(); });   // refund desks (26 Sep 2026)
  const mi=menu.querySelector("[data-mission]"); if(mi) mi.addEventListener("click", ()=>{ if(window.openAgentsMission){ window.openAgentsMission(); if(location.hash!=="#agents-live") location.hash="#agents-live"; } closeMenu(); });
  const ag=menu.querySelector("[data-agents]"); if(ag) ag.addEventListener("click", ()=>{ if(window.openAgents){ window.openAgents(); if(location.hash!=="#agents") location.hash="#agents"; } closeMenu(); });
  const sla=menu.querySelector("[data-sla]"); if(sla) sla.addEventListener("click", ()=>{ if(window.openSla) window.openSla(); closeMenu(); });
  const vendorContracts=menu.querySelector("[data-vendor-contracts]"); if(vendorContracts) vendorContracts.addEventListener("click", ()=>{ if(window.openVendorContracts){ window.openVendorContracts(); if(location.hash!=="#vendor-contracts") location.hash="#vendor-contracts"; } closeMenu(); });
  const sloSettings=menu.querySelector("[data-slo-settings]"); if(sloSettings) sloSettings.addEventListener("click", ()=>{ if(window.openSloSettings){ window.openSloSettings(); if(location.hash!=="#slo-settings") location.hash="#slo-settings"; } closeMenu(); });
  const semati=menu.querySelector("[data-semati]"); if(semati) semati.addEventListener("click", ()=>{ if(window.setConsoleHash) window.setConsoleHash("semati-clearance"); else location.hash="#semati-clearance"; if(window.openSematiClearance) window.openSematiClearance(); closeMenu(); });
  menu.querySelectorAll("[data-cst]").forEach(b=>b.addEventListener("click", ()=>{ const h=b.dataset.cst==="arqami"?"arqami":"cst-escalations"; if(window.setConsoleHash) window.setConsoleHash(h); else location.hash="#"+h; if(window.openCst) window.openCst(b.dataset.cst); closeMenu(); }));
  /* NOC WALL (18 Sep 2026): the two wall entries are real .navtab buttons — router.js routes them and
   * app.js activates the view, so all this menu owes them is to get out of the way. The gear does not
   * light up for them: the wall is a page, not a settings segment. */
  menu.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click", ()=>{ closeMenu(); setTimeout(syncGear,0); }));
  document.addEventListener("click", e=>{ if(!e.target.closest(".setwrap")) closeMenu(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeMenu(); });
  // leaving settings via a nav tab clears the gear highlight (after the view switch, so syncGear reads it)
  document.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click", ()=>setTimeout(syncGear,0)));
})();
