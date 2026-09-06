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
    else if(act){ if(act.closest('.navdrop[data-drop="home"]')) cur="fixed"; else if(act.closest('.navdrop[data-drop="mobile"]')) cur="mobile"; else if(act.dataset.view==="sub360") cur="360"; else if(act.dataset.view==="landing") cur="home"; }
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
  let t0=null; const later=()=>{ clearTimeout(t0); t0=setTimeout(()=>{ syncTabs(); fitGrids(); wrapTables(); },120); };
  function modeSync(){ document.body.classList.toggle("has-tabs",mqPhone.matches); if(!mqDrawer.matches) closeDrawer(); later(); }
  function boot(){
    buildDrawer(); buildTabs(); modeSync();
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
