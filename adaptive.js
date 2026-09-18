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

  /* ---------- sectioned business menus: OPERATE / EXPLORE as collapsible levels ----------
   * (16 Sep 2026) Each business dropdown is a small two-level menu, on the desktop AND in the phone drawer:
   *   head      the business (icon · name · tagline) — the panel says what it is
   *   section   OPERATE (the daily pages, open by default) · EXPLORE (docs, topology, journeys — folded behind its
   *             label with a count), each a disclosure row that remembers its state per business
   *   items     staggered entrance on open, hover slide, active row with the green rail
   * The section holding the current page opens itself. A section a role cannot see (every item .hidden) vanishes
   * with its header, so nobody gets an empty disclosure. Markup is built once from the plain OPERATE/EXPLORE
   * labels in index.html, so role scoping (ops.js), routing (router.js, navdrop.js) and the tour are untouched:
   * the items are still the same .navtab buttons, only wrapped. */
  const SECT_DEFAULT={OPERATE:true,"OPERATE/MON":true};
  /* both levels answer to the same disclosure code: a top-level .navgroup (OPERATE / EXPLORE) and a
   * second-level .navsubg (MONITORING). SIBS keeps the accordion inside one level — folding OPERATE
   * must not fold the MONITORING row that lives inside it, and vice versa. */
  const GSEL=".navgroup[data-collapse],.navsubg[data-collapse]";
  const SIBS=g=>Array.from(g.parentElement.querySelectorAll(":scope > .navgroup[data-collapse], :scope > .navsubg[data-collapse]"));
  const sectKey=(drop,g)=>`navsect:${drop}:${g}`;
  const sectWanted=(drop,g)=>{ try{ const v=localStorage.getItem(sectKey(drop,g)); if(v==="1") return true; if(v==="0") return false; }catch(_){} return !!SECT_DEFAULT[g]; };
  const sectRemember=(drop,g,open)=>{ try{ localStorage.setItem(sectKey(drop,g), open?"1":"0"); }catch(_){} };
  const SECT_ICON={
    OPERATE:'<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6 4 4 6-6"/></svg>',
    EXPLORE:'<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-2 6-4 2 2-6z"/></svg>'
  };
  const SUB_ICON={
    mon:'<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h3.2l2-5 3.4 10 2.4-7 1.4 2H21"/></svg>'
  };
  const titleCase=k=>k.charAt(0)+k.slice(1).toLowerCase();
  function markGroups(){
    document.querySelectorAll(".navdrop").forEach(drop=>{
      const panel=drop.querySelector(".navdrop-panel"); if(!panel||panel.dataset.sect) return;
      panel.dataset.sect="1";
      const dkey=drop.dataset.drop||"";
      /* head: the business itself, taken from its own button so the two never drift apart */
      const btn=drop.querySelector(".navdrop-btn");
      if(btn){
        const ic=btn.querySelector(".num"), lab=btn.querySelector("span:not(.num)");
        const name=lab?Array.from(lab.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join("").trim():"";
        const tag=lab&&lab.querySelector("small")?lab.querySelector("small").textContent.trim():"";
        const head=document.createElement("div"); head.className="navdrop-head";
        head.innerHTML=`<span class="nh-ic">${ic?ic.innerHTML:""}</span><span class="nh-t"><b>${name}</b><small>${tag}</small></span>`;
        panel.insertBefore(head, panel.firstChild);
      }
      /* sections: every OPERATE / EXPLORE label becomes a disclosure row followed by a wrapper of its items */
      let sect=null, key="", i=0, subs={};
      Array.from(panel.children).forEach(el=>{
        if(el.classList.contains("navgroup")){
          key=(el.textContent||"").trim().toUpperCase(); i=0; subs={};
          el.dataset.gkey=key; el.dataset.collapse="1"; el.setAttribute("role","button"); el.tabIndex=0;
          el.innerHTML=`<span class="ngi">${SECT_ICON[key]||""}</span><span class="ngl">${titleCase(key)}</span><b class="ngn"></b><i class="ngc" aria-hidden="true">▾</i>`;
          sect=document.createElement("div"); sect.className="navsect"; sect.dataset.gkey=key;
          sect.innerHTML='<div class="navsect-in"></div>';
          el.after(sect);
          const open=sectWanted(dkey,key); sect.classList.toggle("open",open); el.setAttribute("aria-expanded",open?"true":"false");
        } else if(el.classList.contains("navsubg")&&sect){
          /* second level: the label row plus a wrapper that collects the .navtab[data-sub=<k>] rows below it */
          const sk=(el.dataset.sub||"").toLowerCase(), lab=(el.textContent||"").trim();
          const gk=`${key}/${sk.toUpperCase()}`;
          el.dataset.gkey=gk; el.dataset.collapse="1"; el.setAttribute("role","button"); el.tabIndex=0;
          el.innerHTML=`<span class="ngi">${SUB_ICON[sk]||""}</span><span class="ngl">${lab}</span><b class="ngn"></b><i class="ngc" aria-hidden="true">▾</i>`;
          const wrap=document.createElement("div"); wrap.className="navsect navsub"; wrap.dataset.gkey=gk;
          wrap.innerHTML='<div class="navsect-in"></div>';
          const host=sect.querySelector(".navsect-in"); host.appendChild(el); host.appendChild(wrap);
          const open=sectWanted(dkey,gk); wrap.classList.toggle("open",open); el.setAttribute("aria-expanded",open?"true":"false");
          subs[sk]=wrap;
        } else if(el.classList.contains("navtab")&&sect){
          el.dataset.navgroup=key; el.style.setProperty("--i", i++);
          const sk=(el.dataset.sub||"").toLowerCase(), into=(sk&&subs[sk])?subs[sk]:sect;
          into.querySelector(".navsect-in").appendChild(el);
        }
      });
    });
  }
  const setSect=(g,open)=>{ const sect=g.nextElementSibling; if(!sect||!sect.classList.contains("navsect")) return;
    sect.classList.toggle("open",open); g.setAttribute("aria-expanded",open?"true":"false"); };
  /* accordion: opening a level folds its siblings, so the panel is never taller than its biggest level */
  function sectToggle(g){
    const sect=g.nextElementSibling; if(!sect||!sect.classList.contains("navsect")) return;
    const open=!sect.classList.contains("open"), drop=g.closest(".navdrop"), dkey=drop?drop.dataset.drop:"";
    if(open) SIBS(g).forEach(o=>{ if(o!==g){ setSect(o,false); sectRemember(dkey,o.dataset.gkey,false); } });
    setSect(g,open); sectRemember(dkey, g.dataset.gkey, open);
  }
  // capture phase: navdrop.js stops click propagation inside .navdrop-panel, so a bubble listener never sees this
  document.addEventListener("click",e=>{
    const g=e.target.closest&&e.target.closest(".navdrop-panel .navgroup[data-collapse],.navdrop-panel .navsubg[data-collapse]"); if(!g) return;
    e.stopPropagation(); e.preventDefault(); sectToggle(g);
  },true);
  document.addEventListener("keydown",e=>{
    if(e.key!=="Enter"&&e.key!==" ") return;
    const g=e.target.closest&&e.target.closest(".navdrop-panel .navgroup[data-collapse],.navdrop-panel .navsubg[data-collapse]"); if(!g) return;
    e.preventDefault(); sectToggle(g);
  },true);
  function syncGroups(){
    markGroups();
    document.querySelectorAll(".navdrop-panel").forEach(panel=>{
      panel.querySelectorAll(GSEL).forEach(g=>{
        const sect=g.nextElementSibling; if(!sect) return;
        const items=Array.from(sect.querySelectorAll(".navtab")).filter(t=>!t.classList.contains("hidden")&&t.style.display!=="none");
        items.forEach((t,i)=>t.style.setProperty("--i",i));
        const n=items.length, ngn=g.querySelector(".ngn"); if(ngn){ ngn.textContent=n||""; ngn.hidden=!n; }
        g.hidden=!n; sect.hidden=!n;                                   // role sees no page here → no empty disclosure
        /* the section holding the current page opens itself — once per page change, so a user who folds it
         * by hand is not fought by the next sync tick */
        const act=items.find(t=>t.classList.contains("active"));
        const id=act?`${act.dataset.view||""}:${act.dataset.fxtab||""}`:"";
        if(act&&sect.dataset.auto!==id){ sect.dataset.auto=id; if(!sect.classList.contains("open")){
          SIBS(g).forEach(o=>{ if(o!==g) setSect(o,false); });
          setSect(g,true); } }
      });
    });
  }
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
