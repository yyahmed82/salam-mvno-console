/* Guided tour — replayable from "?". Spotlights each tab AND opens it so you see the real page. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const tab = v => document.querySelector(`.navtab[data-view="${v}"]`);
  const STEPS = [
    { title:"Welcome to the Salam Digital Console", body:"A 60-second tour. The top nav is <b>Operate</b> (monitor & troubleshoot). The <b>“?”</b> menu holds this tour plus <b>Explore</b> (Topology, Journeys, Integrations), and the <b>gear</b> opens Settings. Replay anytime from “?”." },
    { nav:"topology", title:"Explore · Topology", body:"The full system map — channels → core → BSS, payment rails, delivery and ZATCA. Filter by flow type; click any node to see its role and connected flows." },
    { nav:"explorer", title:"Explore · Journeys", body:"Every app / web / dealer / POSA / partner journey, step by step. Filter by category, billing or access; toggle <b>Success ⁄ Failure</b>; press <b>Play</b> to auto-advance; click any API call for its request/response and docs." },
    { nav:"integrations", title:"Explore · Integrations", body:"The catalogue of 32 external systems, 15 inbound webhooks and 43 Sidekiq workers on 22 queues — who calls whom, and where it can break." },
    { nav:"analytics", title:"Operate · Analytics", body:"Grafana-style charts &amp; dashboards. Pick a dashboard, set the time range and filters, or edit any panel (dataset, metric, chart type, group-by) with a live preview — then save your own." },
    { nav:"errors", title:"Operate · Troubleshoot", body:"Live failures grouped by owner team. Search by mobile / order / ICCID, then open the full <b>end-to-end transaction timeline</b> across every system. PII is masked by default." },
    { nav:"alerts", title:"Operate · Alerts", body:"Rules &amp; notifications over the prod replica: open alerts, history, metric charts, and rule toggles. Add your own rule and <b>Test now</b> before saving — plus email digests." },
    { sel:'#settingsBtn', settings:'users', title:"Settings", body:"The gear opens a menu with <b>User management</b> (create users, roles &amp; access) and <b>Sync engine</b> (manual / auto-replay / live, plus the settings change log)." },
    { sel:'#themeToggle', title:"Light / dark", body:"Flip the theme anytime — it defaults to the time of day." },
    { sel:'#userChip', title:"Your account", body:"Role, sign-out, and — for Super Admins — role preview. Least-privilege by default; only Super Admins can unmask PII." }
  ];
  let i = 0;
  const ov=$("#tourOverlay"), spot=$("#tourSpot"), pop=$("#tourPop");

  function target(){ const s=STEPS[i]; return s.nav ? tab(s.nav) : (s.sel ? $(s.sel) : null); }
  const EXPLORE = new Set(["topology","explorer","integrations"]);
  function place(){
    const s=STEPS[i];
    const hm=$("#helpMenu");
    if(hm){ if(EXPLORE.has(s.nav)) hm.classList.add("open"); else hm.classList.remove("open"); } // reveal EXPLORE items in the "?" menu
    if(s.nav){ const t=tab(s.nav); if(t && !t.classList.contains("active")) t.click(); }  // open the page
    if(s.settings && window.openSettings) window.openSettings(s.settings);                 // open Settings on a segment
    if(s.open){ const o=$(s.open); if(o) o.click(); }                                       // open a header panel
    const el = target();
    if(el){
      const r=el.getBoundingClientRect(), pad=6;
      spot.style.display="block";
      spot.style.left=(r.left-pad)+"px"; spot.style.top=(r.top-pad)+"px";
      spot.style.width=(r.width+pad*2)+"px"; spot.style.height=(r.height+pad*2)+"px";
      let top=r.bottom+12, left=Math.min(Math.max(12,r.left), window.innerWidth-332);
      if(top+190>window.innerHeight) top=Math.max(12, r.top-200);
      pop.style.left=left+"px"; pop.style.top=top+"px"; pop.style.transform="none";
    } else {
      spot.style.display="none";
      pop.style.left="50%"; pop.style.top="42%"; pop.style.transform="translate(-50%,-50%)";
    }
    pop.innerHTML=`<h4>${s.title}</h4><p>${s.body}</p>
      <div class="tnav"><span class="tstep">${i+1} / ${STEPS.length}</span>
      ${i>0?'<button class="ghost" id="tPrev">Back</button>':''}
      <button id="tNext">${i===STEPS.length-1?"Done":"Next"}</button></div>`;
    $("#tNext").onclick=()=>{ if(i===STEPS.length-1) end(); else { i++; place(); } };
    const pv=$("#tPrev"); if(pv) pv.onclick=()=>{ i--; place(); };
  }
  function start(){ i=0; ov.classList.add("show"); place(); localStorage.setItem('cons_tour_seen','1');
    try{ const API=(location.protocol==="file:")?"http://localhost:4600":"";
      fetch(API+"/api/me/tour-seen",{method:"POST",headers:{"X-Console-User":localStorage.getItem("cons_email")||""}}); }catch(e){} }
  function end(){ ov.classList.remove("show"); const hm=$("#helpMenu"); if(hm) hm.classList.remove("open"); }

  window.addEventListener("resize", ()=>{ if(ov.classList.contains("show")) place(); });
  ov.addEventListener("click", e=>{ if(e.target===ov) end(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape" && ov.classList.contains("show")) end(); });
  const btn=$("#hmTour"); if(btn) btn.addEventListener("click", start);
  window.startTour = start;
  document.addEventListener("consoleReady", ()=>{ if(!localStorage.getItem('cons_tour_seen')) setTimeout(start, 700); });
})();
