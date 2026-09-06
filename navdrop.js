/* navdrop.js — Mobile / Home dropdown groups in the top nav (salam.sa pattern, ops-console behaviour).
 *  · click to open (no hover); close on outside click, Esc, or after choosing an item; ← → moves between groups, ↑ ↓ inside
 *  · the group button mirrors its children: "on" when one of its pages is active, hidden when the role sees none,
 *    and shows the current page as a small chip ("Home · SDA map")
 *  · Home items carry data-fxtab → deep-link #fixed?tab=<key>. Only TRUSTED clicks route: router.js's clickNav() fires a
 *    synthetic click on the first data-view="fixed" button (Overview), which must not rewrite the hash. */
(function(){
  "use strict";
  const drops=()=>Array.from(document.querySelectorAll(".navdrop"));
  const closeAll=()=>drops().forEach(d=>{ d.classList.remove("open"); const b=d.querySelector(".navdrop-btn"); if(b) b.setAttribute("aria-expanded","false"); });
  const openOne=d=>{ closeAll(); d.classList.add("open"); const b=d.querySelector(".navdrop-btn"); if(b) b.setAttribute("aria-expanded","true"); };
  function pageName(t){ const sp=t.querySelector("span:not(.num)"); if(!sp) return t.textContent.trim(); const tn=Array.from(sp.childNodes).find(n=>n.nodeType===3&&n.textContent.trim()); return tn?tn.textContent.trim():sp.textContent.trim(); }
  function sync(){
    if(window.FIXED_PAGES) document.querySelectorAll('.navtab[data-fxtab]').forEach(b=>{ if(!window.FIXED_PAGES[b.dataset.fxtab]) b.classList.add("hidden"); });
    const m=/^#fixed(?:\?tab=([a-z]+))?/.exec(location.hash||"");
    if(m){ const cur=m[1]||"overview"; document.querySelectorAll('.navtab[data-fxtab]').forEach(b=>b.classList.toggle("active", b.dataset.fxtab===cur));
      document.querySelectorAll('.navtab:not([data-fxtab]).active').forEach(b=>b.classList.remove("active")); }   // one current page: never Mobile + Fixed together
    else document.querySelectorAll('.navtab[data-fxtab].active').forEach(b=>b.classList.remove("active"));         // left the Fixed hub → its group button goes off
    drops().forEach(d=>{
      const tabs=Array.from(d.querySelectorAll(".navtab"));
      const visible=tabs.filter(t=>!t.classList.contains("hidden")&&t.style.display!=="none");
      d.classList.toggle("hidden", visible.length===0);
      const act=tabs.find(t=>t.classList.contains("active"));
      d.classList.toggle("on", !!act);
      const chip=d.querySelector(".navdrop-cur"); if(chip){ chip.textContent=act?pageName(act):""; chip.hidden=!act; }
    });
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
  window.navTipShow=showTip; window.navTipHide=hideTip;
  window.navdropOpen=key=>{ const d=document.querySelector('.navdrop[data-drop="'+key+'"]'); if(d) openOne(d); }; window.navdropClose=closeAll;
  function wire(){
    wireTips();
    drops().forEach(d=>{
      const btn=d.querySelector(".navdrop-btn"); if(!btn) return;
      btn.setAttribute("aria-haspopup","true"); btn.setAttribute("aria-expanded","false");
      if(!btn.querySelector(".navdrop-cur")){ const c=document.createElement("em"); c.className="navdrop-cur"; c.hidden=true; btn.insertBefore(c, btn.querySelector(".chev")); }
      btn.addEventListener("click", e=>{ e.stopPropagation(); d.classList.contains("open")?closeAll():openOne(d); });
      const panel=d.querySelector(".navdrop-panel");
      panel.addEventListener("click", e=>e.stopPropagation());
      d.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click", e=>{ if(e.isTrusted) setTimeout(closeAll,0); }));
      // keyboard: ↓ opens & focuses first item, ↑/↓ move, Esc closes
      btn.addEventListener("keydown", e=>{ if(e.key==="ArrowDown"||e.key==="Enter"&&!d.classList.contains("open")){ e.preventDefault(); openOne(d); const f=panel.querySelector(".navtab:not(.hidden)"); if(f) f.focus(); } });
      panel.addEventListener("keydown", e=>{ const items=Array.from(panel.querySelectorAll(".navtab:not(.hidden)")); const i=items.indexOf(document.activeElement);
        if(e.key==="ArrowDown"){ e.preventDefault(); (items[i+1]||items[0]).focus(); } else if(e.key==="ArrowUp"){ e.preventDefault(); (items[i-1]||items[items.length-1]).focus(); } else if(e.key==="Escape"){ closeAll(); btn.focus(); } });
    });
    document.addEventListener("click", closeAll);
    document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeAll(); });
    document.querySelectorAll('.navtab[data-fxtab]').forEach(b=>b.addEventListener("click", e=>{
      if(!e.isTrusted) return;                                   // synthetic click from router.clickNav → ignore
      const k=b.dataset.fxtab, h="fixed"+(k==="overview"?"":"?tab="+k);
      document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id==="view-fixed"));
      document.querySelectorAll(".navtab").forEach(x=>x.classList.toggle("active", x===b));
      if(location.hash!=="#"+h) location.hash="#"+h; else if(window.openFixed) window.openFixed(k);
    }));
    window.addEventListener("hashchange", sync);
    document.addEventListener("click", ()=>setTimeout(sync,0), true);
    const mo=new MutationObserver(()=>sync());
    drops().forEach(d=>mo.observe(d,{attributes:true,subtree:true,attributeFilter:["class","style"]}));
    sync();
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", wire); else wire();
})();
