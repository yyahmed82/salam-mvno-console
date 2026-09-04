/* Global OPERATE control bar: shared time-range picker + LIVE status.
 * Drives Analytics & Errors via window.OPS_RANGE + the 'opsrangechange' event. */
(function(){
  "use strict";
  const API = (location.protocol==="file:") ? "http://localhost:4600" : (location.pathname.startsWith("/digital-console") ? "/digital-console" : "");
  const OPERATE=new Set(["analytics","alerts","errors"]);
  const PRESETS=[["Last 1h",1],["Last 6h",6],["Last 24h",24],["Last 48h",48],["Last 3d",72],["Last 7d",168],["Last 30d",720]];
  window.OPS_RANGE = window.OPS_RANGE || { key:"Last 7d", hours:168, from:null, to:null };
  let boardNow=null, lastSync=null;

  // build bar + insert after header
  const bar=document.createElement("div"); bar.id="opsBar";
  bar.innerHTML=`<span class="obtitle">RANGE</span>
    <div class="rangebtn" id="rangeBtn"><span id="rangeLabel">—</span><span class="cev">▾</span>
      <div class="rangemenu" id="rangeMenu"></div></div>
    <div class="livepill" id="livePill" title="Sync engine status"><span class="dot"></span><span id="liveText">—</span></div>`;
  document.querySelector("header").after(bar);

  const $=s=>document.querySelector(s);
  const iso=d=>new Date(d).toISOString();
  const fmt=d=>KT.md(d).slice(0,6);
  const fmtT=d=>new Date(d).toLocaleString("en-US",{timeZone:"Asia/Riyadh",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});

  function resolvedTo(){ return window.OPS_RANGE.to || boardNow || new Date().toISOString(); }
  function resolvedFrom(){ return window.OPS_RANGE.from || iso(new Date(resolvedTo()).getTime()-window.OPS_RANGE.hours*3600e3); }
  function label(){
    const from=resolvedFrom(), to=resolvedTo();
    const short = window.OPS_RANGE.hours<=24 && !window.OPS_RANGE.from;
    return short ? `${fmtT(from)} → ${fmtT(to)}` : `${fmt(from)} → ${fmt(to)}`;
  }
  function renderLabel(){ $("#rangeLabel").textContent=label(); }

  function buildMenu(){
    const m=$("#rangeMenu");
    m.innerHTML = PRESETS.map(([lbl,h])=>`<button data-h="${h}" class="${window.OPS_RANGE.hours===h&&!window.OPS_RANGE.from?'on':''}">${lbl}</button>`).join("")
      + `<div class="custom"><span style="font-size:10px;letter-spacing:.6px;color:var(--muted);font-weight:800">CUSTOM</span>
         <input type="date" id="rcFrom"><input type="date" id="rcTo">
         <button class="apply" id="rcApply">Apply custom</button></div>`;
    m.querySelectorAll("button[data-h]").forEach(b=>b.addEventListener("click",()=>{
      const h=Number(b.dataset.h); window.OPS_RANGE={key:b.textContent,hours:h,from:null,to:null};
      closeMenu(); renderLabel(); emit();
    }));
    $("#rcApply").addEventListener("click",()=>{
      const f=$("#rcFrom").value, t=$("#rcTo").value; if(!f||!t) return;
      const from=new Date(f+"T00:00:00Z").toISOString(), to=new Date(t+"T23:59:59Z").toISOString();
      window.OPS_RANGE={key:"Custom",hours:Math.round((new Date(to)-new Date(from))/3600e3),from,to};
      closeMenu(); renderLabel(); emit();
    });
  }
  function openMenu(){ buildMenu(); $("#rangeMenu").classList.add("open"); }
  function closeMenu(){ $("#rangeMenu").classList.remove("open"); }
  $("#rangeBtn").addEventListener("click",e=>{ e.stopPropagation(); const m=$("#rangeMenu"); m.classList.contains("open")?closeMenu():openMenu(); });
  document.addEventListener("click",e=>{ if(!e.target.closest("#rangeBtn")) closeMenu(); });

  function emit(){ document.dispatchEvent(new CustomEvent("opsrangechange",{detail:window.OPS_RANGE})); }
  // keep the RANGE chip in sync when OPS_RANGE is changed PROGRAMMATICALLY (e.g. a dashboard KPI
  // drill-down into Troubleshoot sets the period via applyErrTarget). Without this the chip kept
  // showing its stale default while the board below already used the new window.
  document.addEventListener("opsrangechange", ()=>{ try{ renderLabel(); if($("#rangeMenu")&&$("#rangeMenu").classList.contains("open")) buildMenu(); }catch(e){} });

  // ---- LIVE pill ----
  async function pollSync(){
    try{
      const r=await fetch(API+"/api/settings/sync",{headers:hdrs()}).then(r=>r.json());
      lastSync=r.sync||{}; const running=!!(r.scheduler&&r.scheduler.running) && lastSync.mode!=="manual";
      const pill=$("#livePill"), txt=$("#liveText");
      pill.classList.toggle("live",running);
      txt.textContent = running ? (lastSync.mode==="auto_real"?"LIVE":"REPLAY") : "PAUSED";
      pill.title = running ? `Sync engine running (${lastSync.mode})` : "Sync engine stopped — click to start (needs manageSync)";
    }catch(e){ $("#liveText").textContent="—"; }
  }
  function hdrs(){ return { "X-Console-Role": localStorage.getItem("cons_role")||"super_admin", "X-Console-User": localStorage.getItem("cons_email")||"" }; }
  $("#livePill").addEventListener("click",async()=>{
    if(!(window.opsCan&&window.opsCan("manageSync"))) return;
    const running=$("#livePill").classList.contains("live");
    try{ await fetch(API+"/api/settings/sync",{method:"PUT",headers:Object.assign({"Content-Type":"application/json"},hdrs()),
      body:JSON.stringify({enabled:!running, mode: (lastSync&&lastSync.mode&&lastSync.mode!=="manual")?lastSync.mode:"auto_replay"})}); }catch(e){}
    pollSync();
  });

  // ---- show/hide on OPERATE views ----
  function currentView(){ const a=document.querySelector(".view.active"); return a?a.id.replace("view-",""):null; }
  function sync(){ bar.classList.toggle("show", OPERATE.has(currentView())); }
  document.querySelectorAll(".navtab").forEach(b=>b.addEventListener("click",()=>setTimeout(sync,0)));
  const gear=document.getElementById("settingsBtn"); if(gear) gear.addEventListener("click",()=>setTimeout(sync,0));

  // ---- init ----
  async function fetchNow(){ try{ boardNow=(await fetch(API+"/api/now",{headers:hdrs()}).then(r=>r.json())).now; }catch(e){ boardNow=new Date().toISOString(); } window.__opsBoardNow=boardNow; renderLabel(); }
  fetchNow(); pollSync(); renderLabel(); sync();
  setInterval(pollSync, 8000);
  setInterval(fetchNow, 60000);
})();
