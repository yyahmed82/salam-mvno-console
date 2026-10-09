/* adaptive.js — app shell for phones & tablets (6 Sep 2026)
 *  · nav drawer: header + close button inside the slide-in <nav>, scrim on <body>, Esc / scrim / hashchange close it
 *  · bottom tab bar (≤700px): Home · Mobile · Fixed · 360 · Menu — mirrors the nav (role + business scope) so a
 *    tab is hidden exactly when its nav entry is hidden; active state follows the current page
 *  · tables: any <table> that overflows its container gets a horizontal-scroll wrapper (.tscroll) — the page itself
 *    never scrolls sideways; runs after every render (MutationObserver, debounced) so modules need no change
 *  · iOS: no auto-zoom on input focus (maximum-scale=1 is only set on iOS; pinch-zoom still works there)
 *  The CSS half lives in index.html ("ADAPTIVE UI LAYER"). */
(function(){
  "use strict";
  const $=(s,r)=>(r||document).querySelector(s);
  const mqPhone=window.matchMedia("(max-width:700px)"), mqDrawer=window.matchMedia("(max-width:1140px)");
  const nav=()=>document.querySelector("header>nav");

  /* ---------- iOS viewport ---------- */
  try{
    const ios=/iP(hone|ad|od)/.test(navigator.platform)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
    const vp=document.querySelector('meta[name="viewport"]');
    if(ios&&vp&&!/maximum-scale/.test(vp.content)) vp.content+=", maximum-scale=1";
  }catch(e){}

  /* ---------- drawer chrome ---------- */
  function buildDrawer(){
    const n=nav(); if(!n||$("#navDrawerHd",n)) return;
    const hd=document.createElement("div"); hd.id="navDrawerHd";
    hd.innerHTML=`<span style="display:flex;flex-direction:column"><b>Operations Console</b><small>SALAM · MOBILE &amp; FIXED</small></span><button class="ndx" type="button" aria-label="Close menu">✕</button>`;
    n.insertBefore(hd,n.firstChild);
    hd.querySelector(".ndx").addEventListener("click",closeDrawer);
    const ft=document.createElement("div"); ft.id="navDrawerFt";
    ft.innerHTML=`<button class="ndbtn" type="button" data-adapt="theme"><span class="num">☾</span><span>Theme</span></button><button class="ndbtn" type="button" data-adapt="lang"><span class="num">ع</span><span>العربية</span></button><button class="ndbtn" type="button" data-adapt="help"><span class="num">?</span><span>Guide &amp; help</span></button><button class="ndbtn" type="button" data-adapt="settings"><span class="num">⚙</span><span>Settings</span></button>`;
    n.appendChild(ft);
    ft.addEventListener("click",e=>{ const b=e.target.closest("[data-adapt]"); if(!b) return; e.stopPropagation(); closeDrawer();
      const map={theme:"#themeToggle",lang:"#langToggle",help:"#tourBtn",settings:"#settingsBtn"}; const t=$(map[b.dataset.adapt]); if(t) setTimeout(()=>t.click(),180); });
    // buttons inside the drawer are real .navtab elements: ops.js already closes the nav on click; mirror that on <body>
    new MutationObserver(()=>document.body.classList.toggle("nav-open",n.classList.contains("open")&&mqDrawer.matches)).observe(n,{attributes:true,attributeFilter:["class"]});
  }
  function openDrawer(){ const n=nav(); if(n) n.classList.add("open"); }
  function closeDrawer(){ const n=nav(); if(n) n.classList.remove("open"); document.body.classList.remove("nav-open"); }
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&document.body.classList.contains("nav-open")) closeDrawer(); });
  window.addEventListener("hashchange",closeDrawer);
  document.addEventListener("click",e=>{ if(!document.body.classList.contains("nav-open")) return; const h=e.target.closest("header"); if(h&&!e.target.closest("nav")&&!e.target.closest("#navBurger")) closeDrawer(); },true);

  /* ---------- menus: a head row + plain labels, one submenu level (alpha.160, 9 Oct 2026) ----------
   * Every menu (Mobile, Fixed, Infrastructure, VP Operations, or one built in Settings › Navigation) is
   *   head      the menu itself (icon · name · tagline), taken from its own button so the two never drift apart
   *   labels    OPERATE / MONITORING / EXPLORE … are plain dividers — they do not fold (the folding OPERATE / EXPLORE
   *             sections of 16 Sep and the MONITORING second level of 18 Sep gave way to one level: menu → pages)
   *   items     staggered entrance on open, hover slide, active row with the green rail
   * A label whose pages the role cannot see (every one .hidden) vanishes, so nobody gets an empty heading.
   * navmenu.js rebuilds a menu's panel when the managed layout changes and clears panel.dataset.sect, so the
   * panel is decorated again here (navGroupsRefresh). The items stay the same .navtab buttons. */
  const escT=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  function markGroups(){
    document.querySelectorAll(".navdrop").forEach(drop=>{
      const panel=drop.querySelector(".navdrop-panel"); if(!panel||panel.dataset.sect) return;
      panel.dataset.sect="1";
      const btn=drop.querySelector(".navdrop-btn");
      if(btn&&!panel.querySelector(":scope > .navdrop-head")){
        const ic=btn.querySelector(".num"), lab=btn.querySelector("span:not(.num)");
        const name=lab?Array.from(lab.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join("").trim():"";
        const tag=lab&&lab.querySelector("small")?lab.querySelector("small").textContent.trim():"";
        const head=document.createElement("div"); head.className="navdrop-head";
        head.innerHTML=`<span class="nh-ic">${ic?ic.innerHTML:""}</span><span class="nh-t"><b>${escT(name)}</b><small>${escT(tag)}</small></span>`;
        panel.insertBefore(head, panel.firstChild);
      }
      panel.querySelectorAll(":scope > .navgroup").forEach(el=>{
        if(el.classList.contains("navlabel")) return;
        const t=(el.textContent||"").trim(); el.classList.add("navlabel"); el.dataset.gkey=t.toUpperCase();
        el.innerHTML=`<span class="ngl">${escT(t)}</span>`;
      });
    });
  }
  function syncGroups(){
    markGroups();
    document.querySelectorAll(".navdrop-panel").forEach(panel=>{
      let lab=null, n=0, i=0;
      const flush=()=>{ if(lab&&lab.hidden!==!n) lab.hidden=!n; };
      Array.from(panel.children).forEach(el=>{
        if(el.classList.contains("navgroup")){ flush(); lab=el; n=0; }
        else if(el.classList.contains("navtab")&&!el.classList.contains("hidden")&&el.style.display!=="none"){ n++; const v=String(i++); if(el.style.getPropertyValue("--i")!==v) el.style.setProperty("--i",v); }   // only on change: a style write is a mutation, and two observers watch the nav
      });
      flush();
    });
  }
  window.navGroupsRefresh=function(){ syncGroups(); syncTabs(); };
  /* re-run the staggered entrance each time a dropdown opens (navdrop.js calls this) */
  window.navSectReveal=function(drop){
    const panel=drop.querySelector(".navdrop-panel"); if(!panel) return;
    panel.classList.remove("reveal"); void panel.offsetWidth; panel.classList.add("reveal");
  };

  /* ---------- bottom tab bar ---------- */
  const ICON={
    home:'<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/></svg>',
    mobile:'<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>',
    fixed:'<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
    c360:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    menu:'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
  };
  function buildTabs(){
    if($("#appTabs")) return;
    const bar=document.createElement("div"); bar.id="appTabs"; bar.setAttribute("role","navigation"); bar.setAttribute("aria-label","Main");
    bar.innerHTML=`<button class="at at-home" data-go="#home" type="button">${ICON.home}<span>Home</span></button>
      <button class="at at-mobile" data-go="#dashboard" type="button">${ICON.mobile}<span>Mobile</span></button>
      <button class="at at-fixed" data-go="#fixed" type="button">${ICON.fixed}<span>Fixed</span></button>
      <button class="at at-360" data-go="#sub360" type="button">${ICON.c360}<span>360</span></button>
      <button class="at at-menu" data-menu="1" type="button">${ICON.menu}<span>Menu</span></button>`;
    document.body.appendChild(bar);
    bar.addEventListener("click",e=>{ const b=e.target.closest(".at"); if(!b) return;
      if(b.dataset.menu){ document.body.classList.contains("nav-open")?closeDrawer():openDrawer(); return; }
      closeDrawer(); if(location.hash===b.dataset.go){ window.dispatchEvent(new HashChangeEvent("hashchange")); } else location.hash=b.dataset.go; });
  }
  const hiddenNav=el=>!el||el.classList.contains("hidden")||el.style.display==="none";
  function syncTabs(){
    const bar=$("#appTabs"); if(!bar) return;
    const n=nav(); if(!n) return;
    const mob=$('.navdrop[data-drop="mobile"]',n), fix=$('.navdrop[data-drop="home"]',n), c360=$('.navtab[data-view="sub360"]',n), home=$('.navtab[data-view="landing"]',n);
    $(".at-mobile",bar).classList.toggle("hidden",hiddenNav(mob));
    $(".at-fixed",bar).classList.toggle("hidden",hiddenNav(fix));
    $(".at-360",bar).classList.toggle("hidden",hiddenNav(c360));
    $(".at-home",bar).classList.toggle("hidden",hiddenNav(home));
    const vis=Array.from(bar.querySelectorAll(".at:not(.hidden)")).length; bar.dataset.n=vis;
    const act=$(".navtab.active",n); let cur="";
    const h=(location.hash||"#").slice(1).split("?")[0];
    if(/^fixed/.test(h)) cur="fixed"; else if(/^(sub360|subscriber)$/.test(h)) cur="360"; else if(h===""||h==="home"||h==="landing") cur="home";
    else if(act){ if(act.dataset.biz==="fixed"||act.closest('.navdrop[data-drop="home"]')) cur="fixed"; else if(act.dataset.biz==="mobile"||act.closest('.navdrop[data-drop="mobile"]')) cur="mobile"; else if(act.dataset.view==="sub360") cur="360"; else if(act.dataset.view==="landing") cur="home"; }
    else cur="mobile";
    bar.querySelectorAll(".at").forEach(b=>b.classList.remove("on"));
    const on=$(".at-"+cur,bar); if(on) on.classList.add("on");
    $(".at-menu",bar).classList.toggle("on",document.body.classList.contains("nav-open"));
  }

  /* ---------- tables scroll instead of the page ---------- */
  function overflowAncestor(el){ let p=el.parentElement, i=0; while(p&&i<4&&p!==document.body){ const o=getComputedStyle(p).overflowX; if(o==="auto"||o==="scroll") return p; if(p.classList.contains("tscroll")) return p; p=p.parentElement; i++; } return null; }
  function wrapTables(){
    if(window.innerWidth>1024) return;
    document.querySelectorAll("main table, .modal-card table, .drawer table, #fxmModal table").forEach(t=>{
      if(t.closest(".tscroll")||t.dataset.noScroll) return;
      const par=t.parentElement; if(!par) return;
      const cs=getComputedStyle(t); if(cs.display==="block") return;       // already display:block;overflow-x:auto by CSS
      if(overflowAncestor(t)) return;
      if(t.getBoundingClientRect().width<=par.clientWidth+2&&t.scrollWidth<=par.clientWidth+2) return;
      const w=document.createElement("div"); w.className="tscroll"; par.insertBefore(w,t); w.appendChild(t);
    });
  }

  /* ---------- inline grids: stack when a column would be too narrow ----------
   * Modules lay out with inline grid-template-columns (1fr 1fr, 262px 1fr 360px, repeat(4,1fr)…). Instead of a blanket
   * "1 column on phones" (which also squashed 2-up KPI tiles), measure: if the element cannot give every column ≥ MINCOL
   * px it gets .g-stack (1 col) — or .g-two when two columns still fit. Removed again when the width grows back. */
  const MINCOL=150;
  function colCount(v){ let m=/repeat\((\d+),/.exec(v); if(m) return +m[1]; if(/auto-(fit|fill)/.test(v)) return 0; return v.trim().split(/\s+/).length; }
  function pxSum(v){ let t=0; v.replace(/(\d+(?:\.\d+)?)px/g,(_,n)=>{ t+=+n; return _; }); return t; }
  function fitGrids(){
    const phone=window.innerWidth<=700, tablet=window.innerWidth<=1024;
    document.querySelectorAll('[style*="grid-template-columns"]').forEach(el=>{
      const v=el.style.gridTemplateColumns||""; if(!v||/repeat\(12,/.test(v)||el.hasAttribute("data-nofit")||el.closest("#appTabs,#navDrawerFt")) return;
      el.classList.remove("g-stack","g-two");
      if(!tablet) return;
      const cols=colCount(v), w=el.clientWidth||el.parentElement&&el.parentElement.clientWidth||window.innerWidth;
      if(cols===0){ const m=/minmax\((\d+)px/.exec(v); if(m&&+m[1]>w-24) el.classList.add("g-stack"); return; }
      if(cols<2) return;
      const px=pxSum(v);
      const tooNarrow=(w/cols<MINCOL)||(px>w*0.62);
      if(!tooNarrow) return;
      if(cols>=3&&w/2>=MINCOL&&px===0&&!phone) el.classList.add("g-two"); else if(cols>=4&&w/2>=MINCOL&&px===0) el.classList.add("g-two"); else el.classList.add("g-stack");
    });
  }

  /* ---------- glue ---------- */
  let t0=null; const later=()=>{ clearTimeout(t0); t0=setTimeout(()=>{ syncGroups(); syncTabs(); fitGrids(); wrapTables(); },120); };
  function modeSync(){ document.body.classList.toggle("has-tabs",mqPhone.matches); if(!mqDrawer.matches) closeDrawer(); later(); }
  function boot(){
    buildDrawer(); buildTabs(); syncGroups(); modeSync();
    const n=nav(); if(n) new MutationObserver(later).observe(n,{subtree:true,attributes:true,attributeFilter:["class","style"]});
    new MutationObserver(later).observe(document.body,{subtree:true,childList:true});
    window.addEventListener("hashchange",later); window.addEventListener("resize",later);
    mqPhone.addEventListener?mqPhone.addEventListener("change",modeSync):mqPhone.addListener(modeSync);
    mqDrawer.addEventListener?mqDrawer.addEventListener("change",modeSync):mqDrawer.addListener(modeSync);
    document.addEventListener("themechange",later);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
  window.ADAPT={openDrawer,closeDrawer,sync:later,fitGrids,wrapTables};
})();
