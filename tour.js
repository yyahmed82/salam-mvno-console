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
  /* Step shape: { key, title, icon, need:'view', cap:'cap', nav:'data-view' | sel:'css', open:'dropdown key', hash:'#…', body() }.
   * Copy rule (Yosri, 5 Sep 2026): one line per idea, an icon in front, no paragraphs. */
  const hv = v => hasView(v);
  const fixedHeld = () => (me().views || []).some(v => /^fixed/.test(v));
  const li = items => `<ul class="tlist">${items.filter(Boolean).map(x => `<li>${x}</li>`).join("")}</ul>`;
  const DEFS = [
    { key:"welcome", icon:"👋", title:"Welcome to the Salam Operations Console",
      body(){ const m = me(); return `One console, both businesses — built for your role <b>${m.label || String(m.role||"viewer").replace(/_/g," ")}</b>.`
        + li([ "🏠 <b>Home</b> — the executive picture", hv("dashboard")&&"📱 <b>Mobile</b> — the MVNO pages", fixedHeld()&&"🏘 <b>Fixed</b> — FTTH · FTTB · 5G home pages",
               hv("explore")&&"👤 <b>Customer 360</b> — one customer, both sides", hasCap("useYusr")&&"🤖 <b>Yusr</b> — ask anything, bottom right" ])
        + `Only pages you can open are shown. Replay from <b>?</b> anytime.`; } },
    { key:"home", icon:"🏠", nav:"landing", title:"Home",
      body:()=>li([ "🟢🟠🔴 <b>Global status</b> — Mobile journeys · Payments · Activation · Fixed journeys · Identity · Incidents",
        "💡 <b>Insights</b> — anomalies and week-on-week trends, both businesses", "📈 <b>Growth</b> — 7 days vs the 7 before", "⚠ <b>Needs attention</b> — open incidents · error categories" ]) },
    { key:"mobile", icon:"📱", sel:'.navdrop[data-drop="mobile"] .navdrop-btn', open:"mobile", need:"dashboard", title:"Mobile ▾",
      body:()=>`The MVNO side. <b>Operate</b> → then <b>Explore</b>.`+li([ hv("dashboard")&&"📊 <b>Dashboard</b> — KPIs, journeys, flows, customizable", hv("monitoring")&&"📡 <b>Monitoring</b> — gateways, providers, rails",
        hv("dms")&&"🏪 <b>DMS</b> — dealers · activity · commissions", hv("errors")&&"🛠 <b>Troubleshoot</b> — failures → end-to-end timeline", hv("alerts")&&"🔔 <b>Alerts</b> — rules · open incidents · digests",
        hv("explore")&&"🧭 <b>Explore</b> — topology · API gateway · docs · journeys · integrations" ]) },
    { key:"dashboard", icon:"📊", nav:"home", open:"mobile", need:"dashboard", title:"Mobile · Dashboard",
      body:()=>li([ "⏱ <b>Range bar</b> — re-scopes every card", "⚙ <b>Customize</b> — pick & order sections", "🔀 <b>Order flow</b> — where customers stop" ]) },
    { key:"errors", icon:"🛠", nav:"errors", open:"mobile", need:"errors", title:"Mobile · Troubleshoot",
      body:()=>li([ "🔍 search mobile · order · ICCID · log reference", "🧵 <b>Timeline</b> — every system, one thread", "🔒 PII masked — unmask is audited" ]) },
    { key:"alerts", icon:"🔔", nav:"alerts", open:"mobile", need:"alerts", title:"Mobile · Alerts",
      body:()=>li([ "🚨 open incidents · history · charts", hasCap("editRules")&&"✏️ add a rule → <b>Test now</b> → save", "📧 email digests" ]) },
    { key:"fixed", icon:"🏘", sel:'.navdrop[data-drop="home"] .navdrop-btn', open:"home", need:"fixed", title:"Fixed ▾",
      body:()=>`FTTH · FTTB · 5G home — dealers, e-purchase, Salam Home app.`+li([ hv("fixed")&&"🧭 <b>Overview</b> — KPIs · funnel · dealers", hv("fixed_epurchase")&&"🛒 <b>E-purchase</b> — the web / QR channel",
        hv("fixed_salamhome")&&"📲 <b>Salam Home</b> — the app channel", hv("fixed_maps")&&"🗺 <b>SDA map · QR codes</b> — dealers on the map", hv("fixed_reports")&&"📑 <b>Reports · KPI digest</b>",
        hv("fixed_errors")&&"🛠 <b>Errors</b> — error control board", hv("fixed_alerts")&&"🔔 <b>Alerts</b>", hv("fixed_explore")&&"📘 <b>Playbook · Diagrams</b>" ]) },
    { key:"fixed_overview", icon:"🧭", hash:"#fixed?tab=overview", sel:'.navtab[data-fxtab="overview"]', open:"home", need:"fixed", title:"Fixed · Overview",
      body:()=>li([ "🟢 <b>Live</b> banner — data freshness first", "📊 attempts · completed · BSS orders · Nafath", "🏪 channels · journeys · regions · top dealers" ]) },
    { key:"fixed_channels", icon:"🛒", hash:"#fixed?tab=epurchase", sel:'.navtab[data-fxtab="epurchase"]', open:"home", need:"fixed_epurchase", title:"Fixed · E-purchase & Salam Home",
      body:()=>li([ "🔀 <b>FTTH | FTTB | 5G</b> — always apart", "💼 <b>Business</b> vs 🛠 <b>technical</b> findings, auto-written", "💳 payments · flows · plans · campaigns · integrations", "⚙ <b>Customize</b> — your sections, your order" ]) },
    { key:"fixed_maps", icon:"🗺", hash:"#fixed?tab=map", sel:'.navtab[data-fxtab="map"]', open:"home", need:"fixed_maps", title:"Fixed · SDA map & QR codes",
      body:()=>li([ "📍 dealers pinned where they sell", "🟢🔵🔴 sold · active · inactive", "▶ click a pin → the attempt trace", "🔳 QR codes — referral orders, consent" ]) },
    { key:"fixed_errors", icon:"🛠", hash:"#fixed?tab=errors", sel:'.navtab[data-fxtab="errors"]', open:"home", need:"fixed_errors", title:"Fixed · Errors & Alerts",
      body:()=>li([ "🏷 25 categories · owner team · money at risk", "✅ acknowledge · 🔎 similar events · raw trace", hv("fixed_alerts")&&"🔔 Fixed alert rules & history" ]) },
    { key:"sub360", icon:"👤", nav:"sub360", need:"explore", title:"Customer 360",
      body:()=>li([ "🔍 MSISDN · National ID · FTTH account · order · customer code", "📱 lines · orders · payments · journey timeline", "🏠 <b>Fixed services</b> — what the customer has, then the journeys", "🔒 masked by default" ]) },
    { key:"yusr", icon:"🤖", sel:"#assistFab", cap:"useYusr", title:"Yusr — يُسر",
      body:()=>li([ "💬 paste a number, an ID, an FTTH account…", "📱🏠 answers on Mobile <b>and</b> Fixed", "🧠 facts first — then the explanation", "🔒 nothing personal reaches the model" ]) },
    { key:"settings", icon:"⚙", sel:"#settingsBtn", need:"settings", title:"Settings",
      body(){ return li([ hasCap("manageUsers")&&"👥 <b>User management</b> — roles · pages · features (Mobile & Fixed)", hasCap("manageSync")&&"🔄 <b>Sync engine</b>", "🔔 notifications · preferences" ]); },
      settings(){ return hasCap("manageUsers") ? "users" : null; } },
    { key:"help", icon:"❔", sel:"#tourBtn", title:"Help",
      body:()=>li([ "▶ replay this tour", "◔ on-call view", "✎ <b>Raise a ticket</b> — tag it 📱 Mobile or 🏠 Fixed" ]) },
    { key:"account", icon:"🔑", sel:"#userChip", title:"Your account",
      body(){ return li([ "🎭 role" + (me().realRole === "super_admin" ? " · preview as another role" : ""), "🌙 light / dark — follows the time of day", "🚪 sign out" ]); } }
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
    const hm=$("#helpMenu"); if(hm) hm.classList.remove("open");
    if(window.navdropClose) window.navdropClose();
    // 1. open the page the step talks about — the same path a trusted click takes
    if(s.hash){
      const m=/tab=([a-z]+)/.exec(s.hash); const t=m?m[1]:"overview";
      document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id==="view-fixed"));
      if(location.hash!==s.hash) location.hash=s.hash;
      if(window.openFixed) try{ window.openFixed(t); }catch(e){}
    }
    if(s.nav){ const t=tab(s.nav); if(t && !t.classList.contains("active")) t.click(); }
    const seg = typeof s.settings === "function" ? s.settings() : s.settings;
    if(seg && window.openSettings) window.openSettings(seg);
    // 2. reveal the dropdown item AFTER the click that brought us here has finished bubbling
    //    (navdrop closes every menu on any document click — opening synchronously got undone)
    setTimeout(()=>{ if(s.open && window.navdropOpen && !s.open.startsWith("#")) window.navdropOpen(s.open); position(); }, 40);
    position();
  }
  function position(){
    const s=STEPS[i];
    const el = target();
    const r = el ? el.getBoundingClientRect() : null;
    if(r && r.width>0 && r.height>0){
      const pad=6;
      spot.style.display="block";
      spot.style.left=(r.left-pad)+"px"; spot.style.top=(r.top-pad)+"px";
      spot.style.width=(r.width+pad*2)+"px"; spot.style.height=(r.height+pad*2)+"px";
      const W=Math.min(360, window.innerWidth-24);
      let top=r.bottom+12, left=Math.min(Math.max(12,r.left), window.innerWidth-W-12);
      pop.style.width=W+"px";
      pop.style.left=left+"px"; pop.style.top=top+"px"; pop.style.transform="none";
      // never let the card run off the bottom: flip above the target, else pin to the viewport
      requestAnimationFrame(()=>{ const h=pop.offsetHeight; if(top+h>window.innerHeight-12){ const above=r.top-h-12; pop.style.top=(above>12?above:Math.max(12, window.innerHeight-h-12))+"px"; } });
    } else {
      spot.style.display="none";
      pop.style.width="360px"; pop.style.left="50%"; pop.style.top="42%"; pop.style.transform="translate(-50%,-50%)";
    }
    const body = typeof s.body === "function" ? s.body() : s.body;
    pop.innerHTML=`<h4>${s.icon?`<span class="ticon">${s.icon}</span>`:""}${s.title}</h4><div class="tbody">${body}</div>
      <div class="tnav"><span class="tstep">${i+1} / ${STEPS.length}</span>
      ${i>0?'<button class="ghost" id="tPrev" title="← Back">Back</button>':''}
      <button id="tNext" title="→ / Enter">${i===STEPS.length-1?"Done":"Next"}</button>
      <span class="tkeys">← → · Enter · Esc</span></div>`;
    $("#tNext").onclick=e=>{ e.stopPropagation(); next(); };
    const pv=$("#tPrev"); if(pv) pv.onclick=e=>{ e.stopPropagation(); prev(); };
  }
  function next(){ if(i===STEPS.length-1) end(); else { i++; place(); } }
  function prev(){ if(i>0){ i--; place(); } }
  function start(){ buildSteps(); i=0; ov.classList.add("show"); place(); localStorage.setItem('cons_tour_seen','1');
    try{ const API = window.API_BASE;
      fetch(API+"/api/me/tour-seen",{method:"POST",headers:{"X-Console-User":localStorage.getItem("cons_email")||""}}); }catch(e){} }
  function end(){ ov.classList.remove("show"); const hm=$("#helpMenu"); if(hm) hm.classList.remove("open"); if(window.navdropClose) window.navdropClose(); }

  window.addEventListener("resize", ()=>{ if(ov.classList.contains("show")) position(); });
  ov.addEventListener("click", e=>{ if(e.target===ov) end(); });
  pop.addEventListener("click", e=>e.stopPropagation());   // a click inside the card must not close the spotlighted menu
  document.addEventListener("keydown", e=>{
    if(!ov.classList.contains("show")) return;
    if(e.key==="Escape"){ end(); return; }
    if(e.key==="ArrowRight" || e.key==="Enter" || e.key===" " || e.key==="PageDown"){ e.preventDefault(); e.stopPropagation(); next(); }
    else if(e.key==="ArrowLeft" || e.key==="Backspace" || e.key==="PageUp"){ e.preventDefault(); e.stopPropagation(); prev(); }
    else if(e.key==="Home"){ e.preventDefault(); i=0; place(); }
    else if(e.key==="End"){ e.preventDefault(); i=STEPS.length-1; place(); }
  }, true);
  const btn=$("#hmTour"); if(btn) btn.addEventListener("click", start);
  window.startTour = start;
  document.addEventListener("consoleReady", ()=>{ if(!localStorage.getItem('cons_tour_seen')) setTimeout(start, 700); });
})();
