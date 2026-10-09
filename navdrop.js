/* navdrop.js — Mobile / Home dropdown groups in the top nav (salam.sa pattern, ops-console behaviour).
 *  · click to open (no hover); close on outside click, Esc, or after choosing an item; ← → moves between groups, ↑ ↓ inside
 *  · the group button mirrors its children: "on" when one of its pages is active, hidden when the role sees none,
 *    and shows the current page on a second line under its name ("Fixed" / "SDA map" — alpha.164; a pill beside it before)
 *  · Home items carry data-fxtab → deep-link #fixed?tab=<key>. Only TRUSTED clicks route: router.js's clickNav() fires a
 *    synthetic click on the first data-view="fixed" button (Overview), which must not rewrite the hash. */
(function(){
  "use strict";
  const drops=()=>Array.from(document.querySelectorAll(".navdrop"));
  const closeAll=()=>drops().forEach(d=>{ d.classList.remove("open"); const b=d.querySelector(".navdrop-btn"); if(b) b.setAttribute("aria-expanded","false"); });
  /* ONE popover at a time (16 Sep 2026): the two business dropdowns, the ⚙ settings menu and the ? menu all
   * announce themselves on `navpop`; every other popover closes itself on hearing it. Before this, ⚙ and Fixed
   * could sit open on top of each other (the gear button stops click propagation, so the outside-click close
   * never reached the dropdown). */
  const announce=who=>document.dispatchEvent(new CustomEvent("navpop",{detail:who}));
  document.addEventListener("navpop", e=>{ if(e.detail!=="navdrop") closeAll(); });
  const openOne=d=>{ announce("navdrop"); closeAll(); d.classList.add("open"); const b=d.querySelector(".navdrop-btn"); if(b) b.setAttribute("aria-expanded","true");
    if(window.navSectReveal) window.navSectReveal(d); };
  function pageName(t){ const sp=t.querySelector("span:not(.num)"); if(!sp) return t.textContent.trim(); const tn=Array.from(sp.childNodes).find(n=>n.nodeType===3&&n.textContent.trim()); return tn?tn.textContent.trim():sp.textContent.trim(); }
  function sync(){
    if(window.FIXED_PAGES) document.querySelectorAll('.navtab[data-fxtab]').forEach(b=>{ if(!window.FIXED_PAGES[b.dataset.fxtab]) b.classList.add("hidden"); });
    const m=/^#fixed-infra/.test(location.hash||"")?null:/^#fixed(?:-([a-z]+))?(?:\?tab=([a-z]+))?/.exec(location.hash||"");   // #fixed-infra-alerts belongs to Infrastructure ▾, not to the Fixed hub   // #fixed · #fixed?tab=x · #fixed-alerts (incident view)
    let owned=!!m;   // the Fixed hub and Infrastructure pick their current entry themselves (below); the generic rule stays out of their way
    if(m){ const cur=m[2]||m[1]||"overview"; document.querySelectorAll('.navtab[data-fxtab]').forEach(b=>b.classList.toggle("active", b.dataset.fxtab===cur));
      document.querySelectorAll('.navtab:not([data-fxtab]).active').forEach(b=>b.classList.remove("active")); }   // one current page: never Mobile + Fixed together
    else document.querySelectorAll('.navtab[data-fxtab].active').forEach(b=>b.classList.remove("active"));         // left the Fixed hub → its group button goes off
    /* Infrastructure ▾ (1 Oct 2026): children carry data-iftab = "tab" or "tab:diagram|seg"; the one matching the
     * current #infra hash is the active page (default tab map · diagram mvno · seg all; the host page counts as Hosts) */
    { const h=(location.hash||"").replace(/^#/,""); const ia=/^(fixed-)?infra-alerts(\?|$)/.exec(h); const infra=!!ia||/^infra(\?|$)/.test(h); const q=new URLSearchParams(h.split("?")[1]||"");
      let tab=ia?"alerts":(q.get("tab")||"map"); if(tab==="host") tab="hosts"; const sub=ia?(ia[1]?"fixed":"mvno"):tab==="map"?(q.get("diagram")||"mvno"):tab==="hosts"?(q.get("seg")||"all"):"";
      let best=null, score=-1; document.querySelectorAll('.navtab[data-iftab]').forEach(b=>{ const [t,x]=b.dataset.iftab.split(":"); const ok=infra&&t===tab&&(!x||x===sub); const n=x?2:1; if(ok&&n>score){ score=n; best=b; } });
      document.querySelectorAll('.navtab[data-iftab]').forEach(b=>b.classList.toggle("active", b===best));
      if(best){ owned=true; document.querySelectorAll('.navtab:not([data-iftab]).active').forEach(b=>b.classList.remove("active")); } }   // one current page: never Home + Infrastructure together
    /* one current page (alpha.160): several entries can open the same page — Operations reports and VP ▾ Weekly Report
     * (#opsreports?tab=week), or a link added in Settings › Navigation. Page modules mark every entry of their view
     * active; the entry whose own address matches the URL wins, else the plain one (no query), else the first. */
    { const nv=document.querySelector("header>nav"), cur=(location.hash||"").replace(/^#/,"");
      const vis=t=>!t.classList.contains("hidden")&&t.style.display!=="none";
      const act=nv?Array.from(nv.querySelectorAll(".navtab.active")):[];
      if(!owned&&act.length&&cur){
        const v=act[0].dataset.view;
        const exact=v?Array.from(nv.querySelectorAll('.navtab[data-view="'+v+'"]')).find(t=>vis(t)&&t.dataset.hash===cur):null;
        const keep=exact||(act.length>1?(act.find(t=>!/\?/.test(t.dataset.hash||""))||act[0]):null);
        /* classList.add() rewrites the attribute even when the class is there — the MutationObserver below would call
         * sync() again, forever: touch only what changes */
        if(keep){ act.forEach(t=>{ if(t!==keep) t.classList.remove("active"); }); if(!keep.classList.contains("active")) keep.classList.add("active"); }
      } }
    drops().forEach(d=>{
      const tabs=Array.from(d.querySelectorAll(".navtab"));
      const visible=tabs.filter(t=>!t.classList.contains("hidden")&&t.style.display!=="none");
      d.classList.toggle("hidden", visible.length===0);
      const act=tabs.find(t=>t.classList.contains("active"));
      d.classList.toggle("on", !!act);
      const chip=curLine(d); if(chip){ const t=act?pageName(act):""; if(chip.textContent!==t) chip.textContent=t; if(chip.hidden!==!act) chip.hidden=!act; }
    });
    scheduleFit();
  }
  /* tooltips: every nav item's <small> becomes a floating tip (one shared element, follows the hovered item) */
  let tip=null, tipT=null;
  function ensureTip(){ if(tip) return tip; tip=document.createElement("div"); tip.id="navTip"; document.body.appendChild(tip); return tip; }
  function showTip(el){ const t=el.dataset.tip; if(!t) return; const d=ensureTip(); d.textContent=t; d.classList.remove("below");
    const r=el.getBoundingClientRect(); d.style.left=Math.max(8,Math.min(window.innerWidth-300,r.left))+"px";
    let top=r.bottom+9; if(top+60>window.innerHeight){ top=r.top-9-40; d.classList.add("below"); } d.style.top=top+"px";
    clearTimeout(tipT); tipT=setTimeout(()=>d.classList.add("on"),260); }
  function hideTip(){ clearTimeout(tipT); if(tip) tip.classList.remove("on"); }
  function wireTips(){
    document.querySelectorAll("nav .navtab, nav .navdrop-btn").forEach(el=>{
      const sm=el.querySelector("small"); if(sm && !el.dataset.tip) el.dataset.tip=sm.textContent.trim();
      if(el.dataset.tipWired) return; el.dataset.tipWired="1";
      el.addEventListener("mouseenter", ()=>showTip(el)); el.addEventListener("mouseleave", hideTip);
      el.addEventListener("focus", ()=>showTip(el)); el.addEventListener("blur", hideTip); el.addEventListener("click", hideTip);
    });
  }
  window.navTipShow=showTip; window.navTipHide=hideTip; window.navdropSync=sync;
  window.navdropOpen=key=>{ const d=document.querySelector('.navdrop[data-drop="'+key+'"]'); if(d) openOne(d); }; window.navdropClose=closeAll;
  /* wiring is per dropdown and idempotent (alpha.160): navmenu.js builds menus after load from the managed layout,
   * so a menu can appear (or come back) at any time — navdropWire() wires whatever is new and re-syncs */
  let mo=null;
  /* the current-page line lives INSIDE the name's <span>, after its <small> tip, so CSS can stack it under the name
   * (alpha.164). Renaming a menu (navmenu.js setMenuLabel) rewrites that span's text and drops the line, so it is
   * looked up — and put back — on every sync. Inserting nodes is not a class/style change: no observer loop. */
  function curLine(d){
    const btn=d.querySelector(".navdrop-btn"); if(!btn) return null;
    const sp=btn.querySelector(":scope > span:not(.num)");
    let c=btn.querySelector(".navdrop-cur");
    if(!c){ c=document.createElement("em"); c.className="navdrop-cur"; c.hidden=true; }
    if(sp&&c.parentNode!==sp) sp.appendChild(c); else if(!sp&&!c.parentNode) btn.insertBefore(c, btn.querySelector(".chev"));
    return c;
  }
  function wireDrop(d){
    if(d.dataset.wired) return;
    const btn=d.querySelector(".navdrop-btn"), panel=d.querySelector(".navdrop-panel"); if(!btn||!panel) return;
    d.dataset.wired="1";
    btn.setAttribute("aria-haspopup","true"); btn.setAttribute("aria-expanded","false");
    curLine(d);
    btn.addEventListener("click", e=>{ e.stopPropagation(); d.classList.contains("open")?closeAll():openOne(d); });
    /* one delegated listener: a trusted click on any entry (a page, a link added later) closes the menu after the entry's own handlers ran */
    panel.addEventListener("click", e=>{ e.stopPropagation(); if(e.isTrusted&&e.target.closest&&e.target.closest(".navtab")) setTimeout(closeAll,0); });
    // keyboard: ↓ opens & focuses first item, ↑/↓ move, Esc closes
    btn.addEventListener("keydown", e=>{ if(e.key==="ArrowDown"||e.key==="Enter"&&!d.classList.contains("open")){ e.preventDefault(); openOne(d); const f=panel.querySelector(".navtab:not(.hidden)"); if(f) f.focus(); } });
    panel.addEventListener("keydown", e=>{ const items=Array.from(panel.querySelectorAll(".navtab:not(.hidden)")); const i=items.indexOf(document.activeElement);
      if(e.key==="ArrowDown"){ e.preventDefault(); (items[i+1]||items[0]).focus(); } else if(e.key==="ArrowUp"){ e.preventDefault(); (items[i-1]||items[items.length-1]).focus(); } else if(e.key==="Escape"){ closeAll(); btn.focus(); } });
    if(mo) mo.observe(d,{attributes:true,subtree:true,attributeFilter:["class","style"]});
  }
  function wireTabs(){
    document.querySelectorAll('.navtab[data-fxtab]').forEach(b=>{ if(b.dataset.fxwired) return; b.dataset.fxwired="1"; b.addEventListener("click", e=>{
      if(!e.isTrusted) return;                                   // synthetic click from router.clickNav → ignore
      const k=b.dataset.fxtab;
      /* Fixed › Alerts = the full incident view (same UI as Mobile: guide, details, ack, snooze, resolve, discussion,
       * metric charts, rules) scoped to the Fixed segment — routed by router.js as #fixed-alerts */
      if(k==="alerts"){ e.preventDefault(); e.stopImmediatePropagation();
        document.querySelectorAll(".navtab").forEach(x=>x.classList.toggle("active", x===b));
        if(location.hash!=="#fixed-alerts") location.hash="#fixed-alerts"; else if(window.openAlerts) window.openAlerts("fixed"); return; }
      /* data-fxq carries extra query for a deep sub-page, so Fixed › Journeys and Fixed › BSS Topology
       * Atlas open their page directly instead of the Diagrams gallery (11 Sep 2026) */
      const q=b.dataset.fxq||"";
      const h="fixed"+(k==="overview"&&!q?"":"?tab="+k+(q?"&"+q:""));
      document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id==="view-fixed"));
      document.querySelectorAll(".navtab").forEach(x=>x.classList.toggle("active", x===b));
      if(location.hash!=="#"+h) location.hash="#"+h; else if(window.openFixed) window.openFixed(k);
    }); });
    document.querySelectorAll('.navtab[data-iftab]').forEach(b=>{ if(b.dataset.ifwired) return; b.dataset.ifwired="1"; b.addEventListener("click", e=>{
      if(!e.isTrusted) return;                                   // synthetic click from router.clickNav → ignore
      const h=b.dataset.hash; document.querySelectorAll(".navtab").forEach(x=>x.classList.toggle("active", x===b));
      const vid=/infra-alerts/.test(h)?"view-alerts":"view-infra"; document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id===vid));
      if(location.hash!=="#"+h) location.hash="#"+h; else if(vid==="view-alerts"&&window.openAlerts) window.openAlerts(/^fixed-/.test(h)?"fixed":"mvno","infra"); else if(window.openInfra) window.openInfra(h);
    }); });
  }
  window.navdropWire=function(){ drops().forEach(wireDrop); wireTips(); wireTabs(); sync(); };
  /* header fit (alpha.160): the menus are managed in Settings › Navigation, so fixed breakpoints cannot know how wide the
   * nav is. While the header row overflows, step down one level at a time (classes on <header>, CSS in index.html):
   *   fit1 icons off · fit2 wordmark + BETA off · fit3 the current-page line under a menu's name off · fit4 tighter labels
   * Drawer mode (≤1140 px) needs none of it. Measured in the next frame after a sync, a resize or a menu change. */
  var fitQ=false;   // var: sync() can run before this line in theory (navdropSync is exported above)
  function fitHeader(){
    fitQ=false;
    const h=document.querySelector("header"); if(!h) return;
    const cls=["fit1","fit2","fit3","fit4"], had=cls.filter(c=>h.classList.contains(c)).length;
    if(window.innerWidth<=1140){ if(had) h.classList.remove(...cls); return; }
    const over=()=>h.scrollWidth>h.clientWidth+1||document.documentElement.scrollWidth>window.innerWidth+1;
    h.classList.remove(...cls);
    let n=0; while(n<cls.length&&over()){ h.classList.add(cls[n]); n++; }
  }
  function scheduleFit(){ if(fitQ) return; fitQ=true; requestAnimationFrame(fitHeader); }
  window.navFitHeader=scheduleFit;
  window.addEventListener("resize", scheduleFit);
  document.addEventListener("navmenuchange", scheduleFit);
  /* late content (alpha.164): the account chip gets its name after /api/me, the live button its state — none of that
   * syncs the nav, so the header could stay 3 px too wide (seen at 1680 px). Re-fit whenever a part of the header changes
   * size. No loop: a fit that lands on the same classes leaves the same sizes, and the observer only reports changes. */
  function watchHeader(){
    const h=document.querySelector("header"); if(!h||!window.ResizeObserver||h.dataset.fitwatch) return;
    h.dataset.fitwatch="1"; const ro=new ResizeObserver(()=>scheduleFit());
    Array.from(h.children).forEach(c=>ro.observe(c));
  }
  function wire(){
    mo=new MutationObserver(()=>sync());
    drops().forEach(wireDrop); wireTips(); wireTabs();
    document.addEventListener("click", closeAll);
    document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeAll(); });
    window.addEventListener("hashchange", sync);
    document.addEventListener("click", ()=>setTimeout(sync,0), true);
    watchHeader();
    sync();
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", wire); else wire();
})();
