/* Guided tour — replayable from "?". Spotlights each tab AND opens it so you see the real page.
 *
 * ROLE-AWARE since 2 Sep 2026 (Yosri: a Call Center login was toured through Alerts, Settings and
 * User management — pages their role 403s on). The tour is now BUILT from the session at start:
 * every step declares the view (page) and/or cap (feature) it needs, steps the role lacks are
 * dropped, and the welcome/closing copy names only what THIS user can actually reach. The step
 * list therefore differs per role by design — a Call Center agent gets Dashboard + Explore +
 * Yusr; a Super Admin gets everything including Settings & user management. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const tab = v => document.querySelector(`.navtab[data-view="${v}"]`);
  const me = () => { try{ const s = window.opsSession && window.opsSession(); return (s && s.me) || {}; }catch(e){ return {}; } };
  const hasView = v => (me().views || []).includes(v);
  const hasCap  = c => !!((me().caps || {})[c]);

  /* Each step: { need:'view' | fn, cap:'cap', ... }. Order = tour order after filtering. */
  const DEFS = [
    { key:"welcome", title:"Welcome to the Salam Digital Console",
      body(){ const m = me();
        const pages = [ hasView("dashboard")&&"<b>Dashboard</b>", hasView("monitoring")&&"<b>Monitoring</b>",
          hasView("dms")&&"<b>DMS</b>", hasView("errors")&&"<b>Troubleshoot</b>", hasView("alerts")&&"<b>Alerts</b>" ]
          .filter(Boolean).join(" · ");
        return `A quick tour of <b>your</b> console — built for your role (<b>${m.role ? String(m.role).replace(/_/g," ") : "viewer"}</b>), `
          + `so every page shown here is one you can open. `
          + (pages ? `Your top nav: ${pages}. ` : ``)
          + `The <b>“?”</b> menu holds this tour plus the <b>Explore</b> pages. Replay anytime from “?”.`; } },
    { key:"dashboard", nav:"home", need:"dashboard", title:"Dashboard",
      body:()=>"Your home: journey health, incidents, today's KPIs and the order-status flow. The <b>range bar</b> re-scopes every card, and <b>Customize</b> lets you choose and order the sections you see." },
    { key:"topology", nav:"topology2", need:"explore", title:"Explore · Topology",
      body:()=>"The full system map — channels → core → BSS, payment rails, delivery and ZATCA. Filter by flow type; click any node to see its role and connected flows." },
    { key:"journeys", nav:"explorer", need:"explore", title:"Explore · Journeys",
      body:()=>"Every app / web / dealer / POSA / partner journey, step by step. Filter by category, billing or access; toggle <b>Success ⁄ Failure</b>; press <b>Play</b> to auto-advance; click any API call for its request/response and docs." },
    { key:"sub360", nav:"sub360", need:"explore", title:"Explore · Subscriber 360",
      body(){ return hasView("errors")
        ? "One customer, one screen: search by MSISDN or National ID for their lines, orders, payments and the full journey timeline of each — the fastest way to answer “what happened to this customer?”."
        : "Your main answering screen: search by MSISDN or National ID for the customer's lines, orders, payments and each order's journey — everything needed to answer a caller, on one page. Personal data stays masked."; } },
    { key:"integrations", nav:"integrations", need:"explore", title:"Explore · Integrations",
      body:()=>"The catalogue of 32 external systems, 15 inbound webhooks and 43 Sidekiq workers on 22 queues — who calls whom, and where it can break." },
    { key:"monitoring", nav:"monitoring", need:"monitoring", title:"Operate · Monitoring",
      body:()=>"Connectivity & API health: gateway traffic, per-endpoint latency, provider probes (Semati, Nafath, SMS), payment rails and the DMS alert strip — the “is the platform OK right now?” page." },
    { key:"dms", nav:"dms", need:"dms", title:"Operate · DMS",
      body:()=>"Dealers · activity & health: journey KPIs from the DMS ledgers, dealer 360 and timelines, commissioning on DMS truth, and the dealer map explorer." },
    { key:"analytics", nav:"analytics", need:"analytics", title:"Operate · Analytics",
      body:()=>"Grafana-style charts &amp; dashboards. Pick a dashboard, set the time range and filters, or edit any panel (dataset, metric, chart type, group-by) with a live preview — then save your own." },
    { key:"errors", nav:"errors", need:"errors", title:"Operate · Troubleshoot",
      body:()=>"Live failures grouped by owner team. Search by mobile / order / ICCID — or paste a trace / log reference — then open the full <b>end-to-end transaction timeline</b> across every system. PII is masked by default." },
    { key:"alerts", nav:"alerts", need:"alerts", title:"Operate · Alerts",
      body(){ return hasCap("editRules")
        ? "Rules &amp; notifications over the prod replica: open alerts, history, metric charts, and rule toggles. Add your own rule and <b>Test now</b> before saving — plus email digests."
        : "Open alerts, history and metric charts over the prod replica — what is firing right now, who acknowledged it, and the evidence behind each alert."; } },
    { key:"yusr", sel:"#assistFab", cap:"useYusr", title:"Yusr — يُسر",
      body:()=>"Your AI helper. Ask in plain language — a mobile number, an order, an OTP, “why did this payment fail?” — and Yusr looks it up in the console's own data. Personal data is masked before the model sees anything." },
    { key:"settings", sel:"#settingsBtn", need:"settings", title:"Settings",
      body(){ return hasCap("manageUsers")
        ? "The gear opens a menu with <b>User management</b> (create users, roles &amp; access) and <b>Sync engine</b> (manual / auto-replay / live, plus the settings change log)."
        : "The gear opens the settings menu — notification preferences and the pages your role can configure."; },
      settings(){ return hasCap("manageUsers") ? "users" : null; } },
    { key:"theme", sel:"#themeToggle", title:"Light / dark",
      body:()=>"Flip the theme anytime — it defaults to the time of day." },
    { key:"account", sel:"#userChip", title:"Your account",
      body(){ return "Role and sign-out" + (me().realRole === "super_admin" ? ", plus role preview (see the console exactly as another role does)" : "")
        + ". Least-privilege by default: pages and features follow your role, and any PII unmasking is capability-gated and audited."; } }
  ];

  let STEPS = [];
  function buildSteps(){
    STEPS = DEFS.filter(d => (!d.need || hasView(d.need)) && (!d.cap || hasCap(d.cap))
      // a nav step is only kept if its tab actually exists AND is not hidden by scoping
      && (!d.nav || (tab(d.nav) && !tab(d.nav).classList.contains("hidden")))
      && (!d.sel || $(d.sel)));
    if(!STEPS.length) STEPS = [DEFS[0]];   // failsafe: at least the welcome card
  }

  let i = 0;
  const ov=$("#tourOverlay"), spot=$("#tourSpot"), pop=$("#tourPop");

  function target(){ const s=STEPS[i]; return s.nav ? tab(s.nav) : (s.sel ? $(s.sel) : null); }
  const EXPLORE = new Set(["topology","topology2","explorer","integrations","sub360"]);
  function place(){
    const s=STEPS[i];
    const hm=$("#helpMenu");
    if(hm){ if(EXPLORE.has(s.nav)) hm.classList.add("open"); else hm.classList.remove("open"); } // reveal EXPLORE items in the "?" menu
    if(s.nav){ const t=tab(s.nav); if(t && !t.classList.contains("active")) t.click(); }  // open the page
    const seg = typeof s.settings === "function" ? s.settings() : s.settings;
    if(seg && window.openSettings) window.openSettings(seg);                              // open Settings on a segment
    if(s.open){ const o=$(s.open); if(o) o.click(); }                                     // open a header panel
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
    const body = typeof s.body === "function" ? s.body() : s.body;
    pop.innerHTML=`<h4>${s.title}</h4><p>${body}</p>
      <div class="tnav"><span class="tstep">${i+1} / ${STEPS.length}</span>
      ${i>0?'<button class="ghost" id="tPrev">Back</button>':''}
      <button id="tNext">${i===STEPS.length-1?"Done":"Next"}</button></div>`;
    $("#tNext").onclick=()=>{ if(i===STEPS.length-1) end(); else { i++; place(); } };
    const pv=$("#tPrev"); if(pv) pv.onclick=()=>{ i--; place(); };
  }
  function start(){ buildSteps(); i=0; ov.classList.add("show"); place(); localStorage.setItem('cons_tour_seen','1');
    try{ const API = (location.protocol==="file:") ? "http://localhost:4600" : (location.pathname.startsWith("/digital-console") ? "/digital-console" : "");
      fetch(API+"/api/me/tour-seen",{method:"POST",headers:{"X-Console-User":localStorage.getItem("cons_email")||""}}); }catch(e){} }
  function end(){ ov.classList.remove("show"); const hm=$("#helpMenu"); if(hm) hm.classList.remove("open"); }

  window.addEventListener("resize", ()=>{ if(ov.classList.contains("show")) place(); });
  ov.addEventListener("click", e=>{ if(e.target===ov) end(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape" && ov.classList.contains("show")) end(); });
  const btn=$("#hmTour"); if(btn) btn.addEventListener("click", start);
  window.startTour = start;
  document.addEventListener("consoleReady", ()=>{ if(!localStorage.getItem('cons_tour_seen')) setTimeout(start, 700); });
})();
