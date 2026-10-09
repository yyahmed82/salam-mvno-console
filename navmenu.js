/* navmenu.js — the header menus as data (alpha.160, 9 Oct 2026)
 *
 * The console's top menu is managed in Settings › Navigation (navmenucfg.js): top-level pages and links, and menus
 * that open ONE level of pages, links and plain labels — never deeper. The layout is shared by everyone
 * (GET /api/ui-nav/menu); each person still sees only the pages their role and business allow.
 *
 * How it stays compatible with everything that already knows the nav:
 *   · the default layout IS the markup in index.html — read once into a catalogue (every page and menu, with its
 *     label, tip, icon and address) before navdrop.js / adaptive.js decorate it;
 *   · a saved layout MOVES those same <button class="navtab"> elements — never clones them — so the listeners that
 *     app.js, ops.js, router.js and the page modules attached at load keep working, and role scoping (ops.js) still
 *     reads the same data-view / data-fxtab / data-biz attributes;
 *   · a page left out of the menus waits in a hidden holder inside <header>, so deep links and router.clickNav()
 *     still find it;
 *   · new entries (links, custom menus, labels) are built here: a console link carries the view of the page it
 *     opens (router.js consoleRouteInfo), so role scoping and the "current page" highlight treat it like any tab.
 * The last layout is cached in localStorage, so a reload draws the managed menu at once instead of flashing the
 * default; the server copy then wins. Loaded with `defer` BEFORE navdrop.js and adaptive.js. */
(function(){
  "use strict";
  const nav = document.querySelector("header>nav"); if(!nav) return;
  const API = () => window.API_BASE || window.CONSOLE_BASE || "";
  const LS_KEY = "cons_ui_menu";
  const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const ICON = {
    menu:'<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    link:'<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    ext:'<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
  };

  /* ---------------------------------------------------------------- catalogue of the default markup */
  const PAGES = new Map();   // key → { key, el, label, tip, icon, view, hash, menu (default menu key or ""), menuLabel, i18n }
  const MENUS = new Map();   // key → { key, el, label, tip, icon, builtin }
  const labelSpan = el => el && el.querySelector(":scope > span:not(.num)");
  const textOf = sp => sp ? Array.from(sp.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join("").trim() : "";
  function keyOf(el){
    if(el.dataset.navkey) return el.dataset.navkey;
    if(el.dataset.fxtab) return "fx:"+el.dataset.fxtab;
    if(el.dataset.iftab) return "if:"+el.dataset.iftab;
    let k="v:"+(el.dataset.view||"x"); if(PAGES.has(k)) k+="@"+String(el.dataset.hash||PAGES.size).replace(/[^A-Za-z0-9_.:-]/g,"-");
    return k;
  }
  function hashOf(el){
    if(el.dataset.fxtab){ const k=el.dataset.fxtab, q=el.dataset.fxq||""; return k==="overview"&&!q ? "fixed" : "fixed?tab="+k+(q?"&"+q:""); }
    if(el.dataset.hash) return el.dataset.hash;
    const v=el.dataset.view||""; return (window.consoleViewHash&&window.consoleViewHash(v))||v;
  }
  function register(el, menu){
    const key=keyOf(el); el.dataset.navkey=key;
    const sp=labelSpan(el), sm=sp&&sp.querySelector("small");
    PAGES.set(key,{ key, el, label:textOf(sp)||key, tip:sm?sm.textContent.trim():"", icon:(el.querySelector(".num")||{}).innerHTML||"",
      view:el.dataset.view||"", hash:hashOf(el), menu:menu?menu.key:"", menuLabel:menu?menu.label:"", i18n:sp?sp.getAttribute("data-i18n-html"):null });
    return key;
  }
  function readDefault(){
    const items=[];
    Array.from(nav.children).forEach(ch=>{
      if(ch.matches(".navtab")) items.push({ t:"page", key:register(ch,null) });
      else if(ch.matches(".navdrop")){
        const key=ch.dataset.drop||("m"+MENUS.size), btn=ch.querySelector(".navdrop-btn"), sp=labelSpan(btn), sm=sp&&sp.querySelector("small");
        const m={ key, el:ch, label:textOf(sp)||key, tip:sm?sm.textContent.trim():"", icon:(btn&&btn.querySelector(".num")||{}).innerHTML||ICON.menu, builtin:true };
        MENUS.set(key,m);
        const kids=[];
        Array.from((ch.querySelector(".navdrop-panel")||{children:[]}).children).forEach(c=>{
          if(c.matches(".navgroup")) kids.push({ t:"head", label:c.textContent.trim() });
          else if(c.matches(".navtab")) kids.push({ t:"page", key:register(c,m) });
        });
        items.push({ t:"menu", key, label:m.label, items:kids });
      }
    });
    return items;
  }
  const DEFAULT = readDefault();
  const holder = document.createElement("div"); holder.id="navOff"; holder.hidden=true; holder.setAttribute("aria-hidden","true");
  nav.after(holder);

  /* ---------------------------------------------------------------- building */
  function setLabel(el, want, orig, i18n){
    const sp=labelSpan(el); if(!sp) return;
    const label=want||orig;
    if(textOf(sp)===label) return;
    const sm=sp.querySelector("small");
    sp.textContent=label; if(sm) sp.appendChild(sm);
    if(want && want!==orig) sp.removeAttribute("data-i18n-html"); else if(i18n) sp.setAttribute("data-i18n-html", i18n);   // a renamed entry must not be re-translated back
  }
  /* the page a console address opens — its icon, view (role scope, current-page highlight) and business */
  function linkInfo(href){
    if(/^https?:/i.test(href)) return { ext:true };
    const h=String(href||"").replace(/^#/,""), info=(window.consoleRouteInfo&&window.consoleRouteInfo(h))||null;
    let page=null;
    if(info&&info.view==="fixed"){ page=PAGES.get("fx:"+(info.fxtab||"overview")); }
    else if(info&&info.view){ PAGES.forEach(p=>{ if(!page&&p.view===info.view&&!/\?/.test(p.hash)) page=p; }); if(!page) PAGES.forEach(p=>{ if(!page&&p.view===info.view) page=p; }); }
    return { ext:false, hash:h, info, page };
  }
  function makeLink(x){
    const L=linkInfo(x.href), b=document.createElement("button");
    b.type="button"; b.className="navtab"; b.dataset.navlink=L.ext?"ext":"hash"; b.dataset.href=x.href;
    let tip=L.ext?x.href.replace(/^https?:\/\//i,"").replace(/\/$/,""):x.href, icon=L.ext?ICON.ext:ICON.link;
    if(!L.ext){
      b.dataset.hash=L.hash;
      if(L.info){ if(L.info.view) b.dataset.view=L.info.view; if(L.info.need) b.dataset.need=L.info.need; if(L.info.biz) b.dataset.biz=L.info.biz; if(L.info.fxtab) b.dataset.fxt=L.info.fxtab; }
      if(L.page){ icon=L.page.icon||icon; tip=(L.page.menuLabel?L.page.menuLabel+" › ":"")+L.page.label+" · "+x.href; }
    } else tip="opens "+tip+" in a new tab";
    b.innerHTML=`<span class="num">${icon}</span><span>${esc(x.label)}<small>${esc(tip)}</small></span>`;
    b.addEventListener("click", e=>{
      if(!e.isTrusted) return;                                   // router.clickNav / the tour fire synthetic clicks — never navigate on those
      e.preventDefault();
      if(window.ADAPT&&window.ADAPT.closeDrawer) window.ADAPT.closeDrawer();
      if(b.dataset.navlink==="ext"){ window.open(b.dataset.href,"_blank","noopener"); return; }
      document.querySelectorAll(".navtab.active").forEach(t=>t.classList.remove("active")); b.classList.add("active");
      const h=b.dataset.hash;
      if(location.hash==="#"+h) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash="#"+h;
    });
    return b;
  }
  function makeHead(label){ const d=document.createElement("div"); d.className="navgroup"; d.textContent=label; return d; }
  function menuEl(x){
    const m=MENUS.get(x.key);
    if(m&&m.builtin) return m.el;
    const d=document.createElement("div"); d.className="navdrop"; d.dataset.drop=x.key; d.dataset.navcustom="1";
    d.innerHTML=`<button class="navdrop-btn" type="button"><span class="num">${ICON.menu}</span><span>${esc(x.label)}<small></small></span><i class="chev">▾</i></button><div class="navdrop-panel"></div>`;
    return d;
  }
  function setMenuLabel(el, x){
    const m=MENUS.get(x.key), btn=el.querySelector(".navdrop-btn"), sp=labelSpan(btn); if(!sp) return;
    const sm=sp.querySelector("small");
    sp.textContent=x.label; if(sm) sp.appendChild(sm);
    if(sm){ const names=x.items.filter(c=>c.t!=="head").slice(0,3).map(c=>c.t==="page"?((c.label)||(PAGES.get(c.key)||{}).label):c.label).filter(Boolean);
      sm.textContent=m&&m.builtin&&x.label===m.label ? m.tip : names.join(" · "); }
    if(btn) delete btn.dataset.tip;                                   // navdrop.js re-reads the tip from <small>
  }

  const sig = items => JSON.stringify(items||null);
  /* a page that a later release added is not in an older saved layout: place it where the default markup has it (after
   * the same neighbour, in the same menu) instead of hiding it. `known` = the pages that existed when it was saved; a page
   * the admin removed is in `known`, so it stays out. A page whose default menu was removed stays out with it. */
  function effective(menu){
    if(!menu||!Array.isArray(menu.items)||!menu.items.length) return null;
    const items=JSON.parse(JSON.stringify(menu.items));
    if(!Array.isArray(menu.known)) return items;
    const known=new Set(menu.known), used=new Set();
    const mark=x=>{ if(x.t==="page") used.add(x.key); if(x.t==="menu") (x.items||[]).forEach(mark); }; items.forEach(mark);
    const defList=k=>{ for(const x of DEFAULT){ if(x.t==="page"&&x.key===k) return DEFAULT; if(x.t==="menu"&&x.items.some(c=>c.t==="page"&&c.key===k)) return x.items; } return null; };
    PAGES.forEach((p,k)=>{
      if(used.has(k)||known.has(k)) return;
      const into=p.menu?(items.find(x=>x.t==="menu"&&x.key===p.menu)||{}).items:items; if(!into) return;
      const dl=defList(k)||[], i=dl.findIndex(c=>c.t==="page"&&c.key===k);
      let at=into.length; for(let j=i-1;j>=0;j--){ const prev=dl[j]; if(prev.t!=="page") continue; const pos=into.findIndex(c=>c.t==="page"&&c.key===prev.key); if(pos>=0){ at=pos+1; break; } }
      into.splice(at,0,{ t:"page", key:k }); used.add(k);
    });
    return items;
  }
  let CURRENT=DEFAULT, APPLIED=sig(DEFAULT);   // the markup already is the default layout
  /* draw a layout: pages are moved, menus filled, the rest goes to the holder; then the decorators re-run */
  function apply(items){
    items = Array.isArray(items)&&items.length ? items : DEFAULT;
    const s=sig(items); if(s===APPLIED) return; APPLIED=s; CURRENT=items;
    const anchor=nav.querySelector(":scope > #navDrawerFt");
    const put=el=>anchor?nav.insertBefore(el,anchor):nav.appendChild(el);
    Array.from(nav.childNodes).forEach(n=>{ if(n.id==="navDrawerHd"||n.id==="navDrawerFt") return; if(n.nodeType===1&&n.matches(".navtab")&&n.dataset.navkey) holder.appendChild(n); else n.remove(); });
    const used=new Set();
    /* roles: an entry restricted to some roles carries data-roles (ops.js applyScope hides it for the others); inside a
     * restricted menu an entry needs both — the menu's roles and its own */
    const both=(m,c)=>!m?(c||null):!c?m:m.filter(r=>c.includes(r));
    const setRoles=(el,r)=>{ if(r) el.dataset.roles=r.length?r.join(","):"-"; else delete el.dataset.roles; };
    const placePage=(x,into,roles)=>{ const p=PAGES.get(x.key); if(!p||used.has(x.key)) return; used.add(x.key); setLabel(p.el,x.label,p.label,p.i18n); setRoles(p.el,roles); into(p.el); };
    items.forEach(x=>{
      if(x.t==="page") placePage(x,put,x.roles||null);
      else if(x.t==="link"){ const l=makeLink(x); setRoles(l,x.roles||null); put(l); }
      else if(x.t==="menu"){
        const el=menuEl(x), panel=el.querySelector(".navdrop-panel");
        Array.from(panel.children).forEach(c=>{ if(c.matches(".navtab")&&c.dataset.navkey) holder.appendChild(c); });
        panel.replaceChildren(); delete panel.dataset.sect;
        (x.items||[]).forEach(c=>{ const r=both(x.roles,c.roles);
          if(c.t==="head") panel.appendChild(makeHead(c.label));
          else if(c.t==="page") placePage(c,el2=>panel.appendChild(el2),r);
          else if(c.t==="link"){ const l=makeLink(c); setRoles(l,r); panel.appendChild(l); } });
        if(x.roles) el.dataset.roles=x.roles.join(","); else delete el.dataset.roles;
        setMenuLabel(el,x); el.classList.remove("open"); put(el);
      }
    });
    PAGES.forEach((p,k)=>{ if(!used.has(k)){ setLabel(p.el,null,p.label,p.i18n); delete p.el.dataset.roles; if(p.el.parentNode!==holder) holder.appendChild(p.el); } });
    /* decorators: dropdown wiring + current page (navdrop.js), labels + drawer + bottom tabs (adaptive.js), role scope (ops.js) */
    if(window.navdropWire) window.navdropWire();
    if(window.__consoleReady&&window.opsApplyScope) window.opsApplyScope();
    if(window.navGroupsRefresh) window.navGroupsRefresh();
    if(window.navdropSync) window.navdropSync();
    document.dispatchEvent(new CustomEvent("navmenuchange"));
  }

  /* ---------------------------------------------------------------- load / save */
  let SAVED=null;   // { v, items, updatedAt, updatedBy } as last read from the server (null = default)
  try{ const c=JSON.parse(localStorage.getItem(LS_KEY)||"null"); if(c&&Array.isArray(c.items)) apply(effective(c)); }catch(e){}
  function load(){
    return fetch(API()+"/api/ui-nav/menu",{headers:{"Content-Type":"application/json"}}).then(r=>r.ok?r.json():Promise.reject(new Error("HTTP "+r.status)))
      .then(j=>{ SAVED=j.menu||null; try{ if(SAVED) localStorage.setItem(LS_KEY,JSON.stringify(SAVED)); else localStorage.removeItem(LS_KEY); }catch(e){}
        apply(effective(SAVED)); return SAVED; });
  }
  /* the API needs a session: wait for it (ops.js fires consoleReady), retry once on a slow start */
  if(window.__consoleReady) load().catch(()=>{}); else document.addEventListener("consoleReady",()=>load().catch(()=>{}),{once:true});

  /* ---------------------------------------------------------------- API for the editor (navmenucfg.js) */
  window.NAVMENU = {
    catalogue(){ return Array.from(PAGES.values()).map(p=>({ key:p.key, label:p.label, tip:p.tip, icon:p.icon, hash:p.hash, view:p.view, menu:p.menu, menuLabel:p.menuLabel })); },
    menus(){ return Array.from(MENUS.values()).map(m=>({ key:m.key, label:m.label, tip:m.tip, icon:m.icon })); },
    defaults(){ return JSON.parse(JSON.stringify(DEFAULT)); },
    current(){ return JSON.parse(JSON.stringify(CURRENT||DEFAULT)); },
    saved(){ return SAVED?JSON.parse(JSON.stringify(SAVED)):null; },
    savedItems(){ return effective(SAVED)||JSON.parse(JSON.stringify(DEFAULT)); },   // what the saved layout draws (incl. pages added since)
    linkInfo, icon:ICON, load, apply,
    preview(items){ APPLIED=""; apply(items); },
    restore(){ APPLIED=""; apply(effective(SAVED)); },
    save(items){
      return fetch(API()+"/api/ui-nav/menu",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({ items, known:Array.from(PAGES.keys()) })})
        .then(r=>r.json().then(j=>{ if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j; }))
        .then(j=>{ SAVED=j.menu||null; try{ localStorage.setItem(LS_KEY,JSON.stringify(SAVED)); }catch(e){} APPLIED=""; apply(effective(SAVED)); return SAVED; });
    },
    reset(){
      return fetch(API()+"/api/ui-nav/menu",{method:"DELETE",headers:{"Content-Type":"application/json"}})
        .then(r=>r.json().then(j=>{ if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j; }))
        .then(()=>{ SAVED=null; try{ localStorage.removeItem(LS_KEY); }catch(e){} APPLIED=""; apply(null); return null; });
    }
  };
  document.dispatchEvent(new CustomEvent("navmenuready"));
})();
