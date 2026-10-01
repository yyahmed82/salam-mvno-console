/* fixed-map.js — Fixed › "SDA map" sub-page (registers window.FIXED_PAGES.map).
 * Port of the prod operations console map page (salam-dealer-ops: Sidebar · GoogleMap · Roster · DealerPanel ·
 * TraceModal): left filter sidebar → centre Google map of KSA (clustered pins coloured by outcome; per-dealer drill-in
 * with numbered markers + polyline) → right "All dealers" roster / dealer panel → per-attempt trace modal.
 * Data: /api/fixed/map/* (server/src/fixedMap.js). Google Maps key from /api/fixed/config; no key → SVG KSA fallback.
 * Vanilla JS, no build; every string goes through esc(). */
(function(){
  "use strict";
  const KEY="fixed_map_state", VKEY="fixed_map_views";
  const REGIONS=["Central","Western","Eastern","Southern","Northern"];
  const ROLES=[["ADMIN","Admin"],["ACTIVATOR","Activator"],["PROMOTER","Promoter"]];
  const PLANS=[["ftth","FTTH"],["fttb","FTTB"],["fiveGWhiteLabel","5G HomeFI"],["fiveGFWA","5G FWA"],["promoters","Lead"]];
  const OUTCOMES=[["COMPLETED","Completed"],["IN_PROGRESS","In progress"],["STALLED","Stalled (error)"],["CANCELLED","Cancelled"],["EXPIRED","Expired"]];
  const NAFATH=[["not_completed","Nafath: not completed"],["timeout","Nafath: timeout"],["rejected","Nafath: rejected"]];
  const SEMATI=[["failed","Semati: failed"],["mobile_exists","Semati: mobile exists"]];
  const PLAN_LABEL={ftth:"FTTH",fttb:"FTTB",fiveGWhiteLabel:"5G HomeFI",fiveGFWA:"5G FWA",promoters:"Lead",ePurchaseFTTH:"FTTH (e-Purchase/QR)"};
  const COLOR={COMPLETED:"#3fb950",STALLED:"#d29922",CANCELLED:"#f85149",EXPIRED:"#6e7681",IN_PROGRESS:"#4d8af0",lead:"#a371f7"};
  const ROLE_COLOR={ADMIN:"#3fb950",ACTIVATOR:"#4d8af0",PROMOTER:"#a371f7"};
  const outcomeColor=(o,wf)=>wf==="promoters"?COLOR.lead:(COLOR[String(o||"").toUpperCase()]||"#3fb6f5");
  const KSA_CENTER={lat:23.8,lng:45.0}, KSA_ZOOM=6;
  const DARK_STYLE=[{elementType:"geometry",stylers:[{color:"#16202e"}]},{elementType:"labels.text.fill",stylers:[{color:"#8b97a7"}]},
    {elementType:"labels.text.stroke",stylers:[{color:"#0d1117"}]},{featureType:"water",elementType:"geometry",stylers:[{color:"#0d1722"}]},
    {featureType:"road",elementType:"geometry",stylers:[{color:"#222d3e"}]},{featureType:"poi",stylers:[{visibility:"off"}]},
    {featureType:"administrative.country",elementType:"geometry.stroke",stylers:[{color:"#3fb6f5"}]}];
  const KSA_OUTLINE=[[34.6,28.1],[36.5,29.2],[39.2,32.1],[40.4,31.9],[42.1,31.1],[44.7,29.2],[46.5,29.1],[47.5,29.0],[48.4,28.5],[49.0,27.0],[50.2,26.2],[50.8,24.8],[51.6,24.2],[52.0,22.9],[55.1,22.6],[55.7,22.0],[55.0,20.0],[52.0,19.0],[49.1,18.6],[48.2,18.2],[47.4,17.1],[46.7,17.2],[45.4,17.3],[44.2,17.4],[43.4,16.7],[42.8,16.4],[42.3,17.1],[41.2,18.6],[40.0,20.2],[39.1,21.5],[38.5,23.0],[37.4,24.3],[36.9,25.6],[35.6,27.0]];

  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const fmt=n=>Number(n||0).toLocaleString("en-US");
  const isDark=()=>document.documentElement.getAttribute("data-theme")==="dark";
  const caps=()=>{ try{ const s=window.opsSession&&window.opsSession(); return (s&&s.me&&s.me.caps)||{}; }catch(e){ return {}; } };

  /* ---- page state (persisted) ---- */
  const DEF={regions:[],roles:[],plans:[],outcomes:[],nafath:"all",semati:"all",dealerId:null,dealerName:"",mode:"cluster",sortKey:"done",sortDir:-1};
  let S=Object.assign({},DEF); try{ Object.assign(S,JSON.parse(localStorage.getItem(KEY)||"{}")); }catch(e){}
  const save=()=>{ try{ localStorage.setItem(KEY,JSON.stringify(S)); }catch(e){} };
  const views=()=>{ try{ return JSON.parse(localStorage.getItem(VKEY)||"[]"); }catch(e){ return []; } };
  const filterQs=()=>{ const p=[];
    if(S.regions.length) p.push("regions="+encodeURIComponent(S.regions.join(",")));
    if(S.roles.length) p.push("roles="+encodeURIComponent(S.roles.join(",")));
    if(S.plans.length) p.push("plans="+encodeURIComponent(S.plans.join(",")));
    if(S.outcomes.length) p.push("outcomes="+encodeURIComponent(S.outcomes.join(",")));
    if(S.nafath!=="all") p.push("nafath="+S.nafath); if(S.semati!=="all") p.push("semati="+S.semati);
    if(S.dealerId) p.push("dealerId="+encodeURIComponent(S.dealerId));
    return p.length?"&"+p.join("&"):""; };
  const activeCount=()=>S.regions.length+S.roles.length+S.plans.length+S.outcomes.length+(S.nafath!=="all"?1:0)+(S.semati!=="all"?1:0)+(S.dealerId?1:0);

  let host=null, fx=null, D={attempts:[],roster:[],funnel:null,dealer:null,config:null,error:null};
  let gmap=null, markers=[], cluster=null, poly=null, mapEl=null, seq=0;

  /* ---- Google Maps + clusterer, loaded lazily and once for the whole console ---- */
  const loadScript=src=>new Promise((res,rej)=>{ const s=document.createElement("script"); s.src=src; s.async=true; s.onload=()=>res(); s.onerror=()=>rej(new Error("failed to load "+src)); document.head.appendChild(s); });
  function loadMaps(key){
    if(window.google&&window.google.maps&&window.google.maps.Map) return Promise.resolve();
    if(window.__fxMapsAuthFailed) return Promise.reject(new Error("key rejected for this referrer (RefererNotAllowed) — add "+location.origin+"/* to the key's website restrictions"));
    if(window.__fxMapsP) return window.__fxMapsP;
    // Google calls gm_authFailure when the key is invalid / referrer-restricted: remember it and fall back to the SVG map
    window.gm_authFailure=()=>{ window.__fxMapsAuthFailed=true; window.__fxMapsP=null; document.dispatchEvent(new CustomEvent("fxmaps:authfail")); };
    window.__fxMapsP=new Promise((res,rej)=>{ window.__fxMapsInit=()=>res();
      loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=marker,visualization&callback=__fxMapsInit`).catch(e=>{ window.__fxMapsP=null; rej(e); }); });
    return window.__fxMapsP;
  }
  const clusterSvg=c=>"data:image/svg+xml;charset=UTF-8,"+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="${c}" fill-opacity=".28"/><circle cx="22" cy="22" r="14" fill="${c}"/></svg>`);
  function clusterFactory(){
    if(window.markerClusterer&&window.markerClusterer.MarkerClusterer)                     // @googlemaps/markerclusterer (UMD → window.markerClusterer)
      return (map,ms)=>{ const c=new window.markerClusterer.MarkerClusterer({map,markers:ms}); return {clear:()=>{ try{ c.clearMarkers(); }catch(e){} }}; };
    if(typeof window.MarkerClusterer==="function")                                            // markerclustererplus 2.1.x (cdnjs) → window.MarkerClusterer
      return (map,ms)=>{ const c=new window.MarkerClusterer(map,ms,{gridSize:60,maxZoom:14,averageCenter:true,
        styles:[{url:clusterSvg("#0e9f5a"),height:44,width:44,textColor:"#fff",textSize:11},{url:clusterSvg("#2563eb"),height:44,width:44,textColor:"#fff",textSize:11},{url:clusterSvg("#7c3aed"),height:44,width:44,textColor:"#fff",textSize:11}]});
        return {clear:()=>{ try{ c.clearMarkers(); }catch(e){} }}; };
    return null;
  }
  function loadClusterer(){
    if(window.__fxMcP) return window.__fxMcP;
    const urls=["https://cdnjs.cloudflare.com/ajax/libs/markerclustererplus/2.1.4/markerclusterer.min.js","https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js"];
    window.__fxMcP=(async()=>{ for(const u of urls){ if(clusterFactory()) break; try{ await loadScript(u); }catch(e){} } return clusterFactory(); })();
    return window.__fxMcP;
  }

  /* ---- data ---- */
  async function load(){
    const my=++seq; D.error=null;
    const q=fx.qs()+filterQs();
    try{
      const [att,ros,fun,cfg]=await Promise.all([ fx.api("/api/fixed/map/attempts?"+q), fx.api("/api/fixed/map/roster?"+q), fx.api("/api/fixed/map/funnel?"+q).catch(()=>null),
        D.config?Promise.resolve(D.config):fx.api("/api/fixed/config").catch(()=>({mapsKey:null})) ]);
      if(my!==seq) return;
      D.attempts=att.rows||[]; D.capped=!!att.capped; D.window=att.window; D.roster=ros.rows||[]; D.funnel=fun; D.config=cfg;
    }catch(e){ if(my!==seq) return; D.error=e.message; D.attempts=[]; D.roster=[]; D.funnel=null; }
    drawKpis(); drawRight(); drawMap();
    if(S.dealerId) openDealer(S.dealerId,S.dealerName,true);
  }

  /* ---- layout ---- */
  async function render(h,ctx){
    host=h; fx=ctx;
    /* Deep-link filters — alert mails / chat posts land here pre-filtered, like the retired console's
     * "Inspect in console →": #fixed?tab=map&plans=fiveGWhiteLabel,fiveGFWA&nafath=not_completed&range=24h
     * (also semati, outcomes, regions, roles, dealerId). Applied once per distinct query so a later manual
     * change on the page is never overwritten by a re-render. */
    try{ const qs=(location.hash.split("?")[1]||"");
      if(qs && qs!==window.__fxmLastQs && /(?:^|&)(plans|nafath|semati|outcomes|regions|roles|range|dealerId)=/.test(qs)){
        window.__fxmLastQs=qs; const P=new URLSearchParams(qs);
        const list=k=>P.has(k)?P.get(k).split(",").map(s=>s.trim()).filter(Boolean):[];
        Object.assign(S,{regions:list("regions"),roles:list("roles"),plans:list("plans"),outcomes:list("outcomes"),
          nafath:P.get("nafath")||"all",semati:P.get("semati")||"all",dealerId:P.get("dealerId")||null,dealerName:""});
        if(P.get("range")&&fx.state){ fx.state.range=P.get("range"); if(fx.state.range==="custom"){ fx.state.from=P.get("from")||""; fx.state.to=P.get("to")||""; if(!(fx.state.from&&fx.state.to)) fx.state.range="24h"; } else { fx.state.from=""; fx.state.to=""; } try{ localStorage.setItem("fixed_range",fx.state.range); localStorage.setItem("fixed_from",fx.state.from||""); localStorage.setItem("fixed_to",fx.state.to||""); }catch(e){} }
        save(); } }catch(e){}
    host.innerHTML=`<div id="fxm" style="display:grid;grid-template-columns:262px minmax(0,1fr) 360px;gap:12px;height:calc(100vh - 205px);min-height:600px">
      <aside id="fxmSide" class="topo-card" style="padding:12px;overflow:auto;display:flex;flex-direction:column;gap:12px"></aside>
      <div id="fxmMapWrap" class="topo-card" style="padding:0;position:relative;overflow:hidden;min-height:400px">
        <div id="fxmMap" style="position:absolute;inset:0"></div>
        <div id="fxmLegend" style="position:absolute;left:10px;bottom:10px;background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;padding:7px 10px;font-size:10.5px;display:flex;gap:10px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(2,6,23,.15)"></div>
        <div id="fxmMapNote" class="rl" style="position:absolute;right:10px;top:10px;background:var(--card,#fff);border:1px solid var(--line);border-radius:8px;padding:4px 9px;font-size:10.5px;color:var(--muted)"></div>
      </div>
      <aside id="fxmRight" class="topo-card" style="padding:12px;overflow:auto;display:flex;flex-direction:column"></aside>
    </div>`;
    mapEl=host.querySelector("#fxmMap"); gmap=null; markers=[]; cluster=null; poly=null;
    drawSide();
    host.querySelector("#fxmRight").innerHTML=window.FXUI?window.FXUI.skeleton(8):"loading…";
    await load();
  }

  /* ---- left sidebar ---- */
  function drawSide(){
    const side=host.querySelector("#fxmSide"); if(!side) return;
    const chip=(cls,attr,on,label)=>`<button class="fxchip ${cls}${on?" on":""}" ${attr}>${esc(label)}</button>`;
    side.innerHTML=`<div id="fxmKpis" style="display:grid;grid-template-columns:1fr 1fr;gap:6px"></div>
      <div class="grp"><h4>Dealer</h4><div style="position:relative">
        <input id="fxmQ" placeholder="search staff · code · dealer · city" value="${esc(S.dealerName)}" autocomplete="off" style="width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
        <div id="fxmQList" style="position:absolute;left:0;right:0;top:100%;z-index:30;background:var(--card,#fff);border:1px solid var(--line);border-radius:8px;box-shadow:0 6px 18px rgba(2,6,23,.18);display:none;max-height:260px;overflow:auto"></div></div>
        ${S.dealerId?`<div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11.5px"><b style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(S.dealerName||S.dealerId)}</b><button class="fxchip" id="fxmClearDealer">✕ clear</button></div>`:""}</div>
      <div class="grp"><h4>Range</h4>${fx.rangeChips?fx.rangeChips(""):""}</div>
      <div class="grp"><h4>Map view</h4><div class="chips">${chip("blue",'data-mode="cluster"',S.mode==="cluster","Clusters")}${chip("blue",'data-mode="dealers"',S.mode==="dealers","All dealers")}</div></div>
      <div class="grp"><h4>Region / Group</h4><div class="chips">${REGIONS.map(r=>chip("",`data-f="regions" data-v="${esc(r)}"`,S.regions.includes(r),r)).join("")}</div></div>
      <div class="grp"><h4>Role</h4><div class="chips">${ROLES.map(([v,l])=>chip("",`data-f="roles" data-v="${v}"`,S.roles.includes(v),l)).join("")}</div></div>
      <div class="grp"><h4>Plan type</h4><div class="chips">${PLANS.map(([v,l])=>chip("",`data-f="plans" data-v="${v}"`,S.plans.includes(v),l)).join("")}</div></div>
      <div class="grp"><h4>Outcome</h4><div class="chips">${OUTCOMES.map(([v,l])=>chip("",`data-f="outcomes" data-v="${v}"`,S.outcomes.includes(v),l)).join("")}
        ${NAFATH.map(([v,l])=>chip("",`data-one="nafath" data-v="${v}"`,S.nafath===v,l)).join("")}${SEMATI.map(([v,l])=>chip("",`data-one="semati" data-v="${v}"`,S.semati===v,l)).join("")}</div></div>
      <div class="grp"><h4>Saved views</h4><div class="chips" id="fxmViews">${views().map((v,i)=>`<span class="fxchip" data-view="${i}" title="${esc(v.desc||"")}" style="display:inline-flex;gap:6px;align-items:center">${esc(v.name)}<i data-rmview="${i}" style="font-style:normal;color:var(--muted);cursor:pointer">✕</i></span>`).join("")}
        <button class="fxchip ghost" id="fxmSaveView">＋ save current view</button></div></div>
      <div class="grp" id="fxmFunnel"></div>
      <div style="display:flex;gap:6px;margin-top:auto;flex-wrap:wrap"><button class="fxbtn" id="fxmReset" style="padding:6px 11px;font-size:11px">⟲ Reset filters${activeCount()?` (${activeCount()})`:""}</button><button class="fxbtn" id="fxmReload" style="padding:6px 11px;font-size:11px" title="Reload from the read model">↻ Refresh</button></div>`;
    side.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{ const k=b.dataset.f, v=b.dataset.v; const i=S[k].indexOf(v); if(i>=0) S[k].splice(i,1); else S[k].push(v); save(); drawSide(); load(); });
    side.querySelectorAll("[data-one]").forEach(b=>b.onclick=()=>{ const k=b.dataset.one, v=b.dataset.v; S[k]=S[k]===v?"all":v; save(); drawSide(); load(); });
    side.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{ S.mode=b.dataset.mode; save(); drawSide(); drawKpis(); drawMap(); });
    side.querySelectorAll("[data-view]").forEach(b=>b.onclick=e=>{ if(e.target.dataset.rmview!=null) return; const v=views()[Number(b.dataset.view)]; if(!v) return;
      Object.assign(S,DEF,{sortKey:S.sortKey,sortDir:S.sortDir},v.state||{}); save(); drawSide(); load(); });
    side.querySelectorAll("[data-rmview]").forEach(b=>b.onclick=e=>{ e.stopPropagation(); const L=views(); L.splice(Number(b.dataset.rmview),1); localStorage.setItem(VKEY,JSON.stringify(L)); drawSide(); });
    side.querySelector("#fxmSaveView").onclick=()=>{ const name=prompt("Name this view"); if(!name) return; const L=views().filter(v=>v.name!==name);
      const st={regions:S.regions.slice(),roles:S.roles.slice(),plans:S.plans.slice(),outcomes:S.outcomes.slice(),nafath:S.nafath,semati:S.semati,dealerId:S.dealerId,dealerName:S.dealerName,mode:S.mode};
      L.push({name:name.slice(0,40),state:st,desc:describe(st)}); localStorage.setItem(VKEY,JSON.stringify(L.slice(-12))); drawSide(); };
    side.querySelector("#fxmReset").onclick=()=>{ Object.assign(S,DEF,{sortKey:S.sortKey,sortDir:S.sortDir,mode:S.mode,regions:[],roles:[],plans:[],outcomes:[]}); save(); drawSide(); load(); };
    side.querySelector("#fxmReload").onclick=()=>{ D.config=null; load(); };
    const cd=side.querySelector("#fxmClearDealer"); if(cd) cd.onclick=()=>{ S.dealerId=null; S.dealerName=""; D.dealer=null; save(); drawSide(); load(); };
    // dealer typeahead — /api/fixed/dealers?q=
    const inp=side.querySelector("#fxmQ"), list=side.querySelector("#fxmQList"); let t=null;
    inp.oninput=()=>{ clearTimeout(t); const v=inp.value.trim(); if(v.length<2){ list.style.display="none"; return; }
      t=setTimeout(async()=>{ try{ const r=await fx.api("/api/fixed/dealers?q="+encodeURIComponent(v)); const rows=(r.rows||[]).slice(0,10);
        list.innerHTML=rows.map(d=>`<div data-id="${esc(d.id)}" data-name="${esc(d.staff_name||d.dealer_name||d.staff_code)}" style="padding:6px 9px;cursor:pointer;border-bottom:1px solid var(--line);font-size:11.5px"><b>${esc(d.staff_name||"—")}</b> <span class="mono" style="color:var(--muted)">${esc(d.staff_code||"")}</span><div class="rl" style="font-size:10px;color:var(--muted)">${esc(d.dealer_name||d.dealer_code||"")} · ${esc(d.role||"")} · ${esc(d.city||"")}${d.region?" · "+esc(d.region):""} · ${fmt(d.attempts_30d)} / 30d</div></div>`).join("")||`<div style="padding:8px;font-size:11.5px;color:var(--muted)">no dealer matches</div>`;
        list.style.display="block";
        list.querySelectorAll("[data-id]").forEach(x=>x.onclick=()=>{ S.dealerId=x.dataset.id; S.dealerName=x.dataset.name; save(); list.style.display="none"; drawSide(); load(); });
      }catch(e){ list.innerHTML=`<div style="padding:8px;font-size:11.5px;color:#dc2626">${esc(e.message)}</div>`; list.style.display="block"; } },250); };
    inp.onblur=()=>setTimeout(()=>{ list.style.display="none"; },200);
    if(fx.bindRange) fx.bindRange(side,()=>{ drawSide(); load(); });
    drawKpis(); drawFunnel();
  }
  function describe(st){ const p=[]; if(st.regions.length) p.push(st.regions.join("/")); if(st.roles.length) p.push(st.roles.join("/")); if(st.plans.length) p.push(st.plans.map(x=>PLAN_LABEL[x]||x).join("/"));
    if(st.outcomes.length) p.push(st.outcomes.join("/")); if(st.nafath!=="all") p.push("nafath:"+st.nafath); if(st.semati!=="all") p.push("semati:"+st.semati); if(st.dealerName) p.push(st.dealerName); return p.join(" · ")||"(default view)"; }

  function drawKpis(){
    const el=host&&host.querySelector("#fxmKpis"); if(!el) return;
    const t=D.funnel&&D.funnel.totals;   // funnel totals cover ALL rows in scope (pins are capped at 2000)
    const A=t?t.attempts:D.attempts.length, C=t?t.completed:D.attempts.filter(a=>a.outcome==="COMPLETED").length;
    el.innerHTML=`<div class="kpi"><b>${fmt(A)}</b><span>ATTEMPTS</span></div><div class="kpi"><b style="color:${COLOR.COMPLETED}">${fmt(C)}</b><span>COMPLETED</span></div>
      <div class="kpi"><b>${A?Math.round(100*C/A):0}%</b><span>CONVERSION</span></div><div class="kpi"><b>${fmt(D.roster.length)}</b><span>ACTIVE DEALERS</span></div>
      ${D.error?`<div style="grid-column:1/-1;color:#dc2626;font-size:11px">${esc(D.error)}</div>`:""}`;
  }
  function drawFunnel(){
    const el=host&&host.querySelector("#fxmFunnel"); if(!el) return; const f=D.funnel;
    if(!f||!f.steps||!f.steps.length){ el.innerHTML=""; return; }
    const max=Math.max(1,...f.steps.map(s=>s.count));
    el.innerHTML=`<h4>Funnel · ${esc(f.label||f.workflow)}</h4>${f.steps.map(s=>`<div style="display:grid;grid-template-columns:1fr 46px;gap:6px;align-items:center;font-size:10.5px;margin:1px 0"><div><div class="rl" style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.step)}${s.drop?` <span style="color:#f85149">−${fmt(s.drop)}</span>`:""}</div>${fx.bar(s.count,max,"#4d8af0")}</div><b class="mono" style="text-align:right">${fmt(s.count)}</b></div>`).join("")}`;
  }

  /* ---- map ---- */
  function legend(extra){
    const el=host.querySelector("#fxmLegend"); if(!el) return;
    const dot=(c,l)=>`<span><i class="fxm-legend-dot" style="background:${c}"></i>${esc(l)}</span>`;
    el.innerHTML=S.mode==="dealers"&&!S.dealerId?ROLES.map(([v,l])=>dot(ROLE_COLOR[v],l)).join("")+`<span style="color:var(--muted)">size = attempts</span>`
      :[dot(COLOR.COMPLETED,"Completed"),dot(COLOR.IN_PROGRESS,"In progress"),dot(COLOR.STALLED,"Stalled"),dot(COLOR.CANCELLED,"Cancelled"),dot(COLOR.EXPIRED,"Expired"),dot(COLOR.lead,"Lead")].join("")+(extra||"");
  }
  function pinSet(){
    if(S.dealerId){ let rows=D.attempts.filter(a=>a.dealer_id===S.dealerId); if(!rows.length&&D.dealer&&D.dealer.recent) rows=D.dealer.recent.filter(a=>a.lat!=null&&a.lng!=null).map(a=>({...a,dealer_id:S.dealerId}));
      return {kind:"orders",rows:rows.slice().sort((a,b)=>new Date(a.started_at)-new Date(b.started_at))}; }
    if(S.mode==="dealers") return {kind:"dealers",rows:D.roster.filter(r=>r.lat!=null&&r.lng!=null)};
    return {kind:"attempts",rows:D.attempts};
  }
  function drawMap(){
    if(!mapEl) return;
    const note=host.querySelector("#fxmMapNote");
    const ps=pinSet();
    if(note) note.textContent=(ps.kind==="orders"?`${ps.rows.length} orders · ${S.dealerName||S.dealerId} · click a number for the trace`:ps.kind==="dealers"?`${ps.rows.length} dealers · last position`:`${fmt(ps.rows.length)} pins${D.capped?" (newest 2000)":""} · ${fx.state.range}`)+(D.attempts.some(a=>a.outsideKsa)?" · ⚠ some pins outside KSA":"");
    legend();
    const key=D.config&&D.config.mapsKey;
    if(!key){ drawSvg(ps); return; }
    loadMaps(key).then(async()=>{
      document.addEventListener("fxmaps:authfail", ()=>{ if(note) note.textContent="Google rejected the key for "+location.origin+" — static view (add it to the key's website restrictions)"; drawSvg(ps); }, {once:true});
      if(!gmap||!mapEl.isConnected){ mapEl.innerHTML="";
        gmap=new google.maps.Map(mapEl,{center:KSA_CENTER,zoom:KSA_ZOOM,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,gestureHandling:"greedy",
          zoomControlOptions:{position:google.maps.ControlPosition.RIGHT_BOTTOM},styles:isDark()?DARK_STYLE:undefined});
        const rb=document.createElement("button"); rb.textContent="⌂ KSA"; rb.title="Reset view to Saudi Arabia"; rb.className="fx-ksa-btn";
        rb.onclick=()=>{ gmap.setCenter(KSA_CENTER); gmap.setZoom(KSA_ZOOM); };
        gmap.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(rb);
      }
      if(cluster){ cluster.clear(); cluster=null; } markers.forEach(m=>m.setMap(null)); markers=[]; if(poly){ poly.setMap(null); poly=null; }
      const icon=(c,scale)=>({path:google.maps.SymbolPath.CIRCLE,scale:scale||6,fillColor:c,fillOpacity:.92,strokeWeight:1.2,strokeColor:isDark()?"#0d1117":"#fff"});
      if(ps.kind==="orders"){
        const path=[];
        ps.rows.forEach((a,i)=>{ const pos={lat:Number(a.lat),lng:Number(a.lng)}; path.push(pos);
          const m=new google.maps.Marker({map:gmap,position:pos,icon:icon(outcomeColor(a.outcome,a.workflow),11),label:{text:String(i+1),color:"#05121c",fontSize:"10px",fontWeight:"700"},
            title:`#${i+1} · ${PLAN_LABEL[a.workflow]||a.workflow||""} · ${a.outcome||""} · ${fx.ts(a.started_at)} — click for the trace`});
          m.addListener("click",()=>openTrace(a.id)); markers.push(m); });
        if(path.length>1) poly=new google.maps.Polyline({map:gmap,path,strokeColor:"#3fb6f5",strokeOpacity:.7,strokeWeight:2});
        if(path.length){ const b=new google.maps.LatLngBounds(); path.forEach(p=>b.extend(p)); gmap.fitBounds(b,60); if(path.length===1) gmap.setZoom(12); }
        return;
      }
      const ms=[];
      if(ps.kind==="dealers"){
        const max=Math.max(1,...ps.rows.map(r=>Number(r.placed||0)));
        ps.rows.forEach(r=>{ const m=new google.maps.Marker({position:{lat:r.lat,lng:r.lng},icon:icon(ROLE_COLOR[r.role]||"#3fb6f5",5+Math.round(9*Math.sqrt(Number(r.placed||0)/max))),
            title:`${r.staff_name||r.staff_code||""} · ${r.role||""} · ${r.city||""} · ${r.placed} placed / ${r.done} done`});
          m.addListener("click",()=>selectDealer(r.id,r.staff_name||r.dealer_name||r.staff_code)); ms.push(m); });
      } else {
        ps.rows.forEach(a=>{ const m=new google.maps.Marker({position:{lat:a.lat,lng:a.lng},icon:icon(outcomeColor(a.outcome,a.workflow),a.outsideKsa?8:6),
            title:`${a.staff_name||a.dealer_name||(a.referral_code?"QR "+a.referral_code:"—")} · ${PLAN_LABEL[a.workflow]||a.workflow||""} · ${a.outcome||""} · ${fx.ts(a.started_at)}${a.outsideKsa?" · ⚠ outside KSA bbox":""}`});
          m.addListener("click",()=>{ if(a.dealer_id) selectDealer(a.dealer_id,a.staff_name||a.dealer_name||a.dealer_code); else openTrace(a.id); }); ms.push(m); });
      }
      const mk=await loadClusterer().catch(()=>null);
      if(!mapEl.isConnected) return;
      if(mk&&ms.length&&S.mode==="cluster") cluster=mk(gmap,ms); else { ms.forEach(m=>m.setMap(gmap)); markers=ms; }
    }).catch(e=>{ if(note) note.textContent="Google Maps failed ("+e.message+") — static view"; drawSvg(ps); });
  }
  function drawSvg(ps){
    // Google unavailable → OpenStreetMap via Leaflet (no key). Static SVG only if even that cannot load.
    if(window.fxLeaflet){
      const max=Math.max(1,...(ps.kind==="dealers"?ps.rows.map(r=>Number(r.placed||0)):[1]));
      const pins=ps.rows.filter(a=>a.lat!=null&&a.lng!=null).map((a,i)=>({ lat:a.lat, lng:a.lng,
        color: ps.kind==="dealers"?(ROLE_COLOR[a.role]||"#3fb6f5"):outcomeColor(a.outcome,a.workflow),
        r: ps.kind==="dealers"?4+Math.round(8*Math.sqrt(Number(a.placed||0)/max)):5,
        label: ps.kind==="orders"?String(i+1):null,
        title: ps.kind==="dealers"?`${a.staff_name||a.staff_code||""} · ${a.role||""} · ${a.placed} placed / ${a.done} done`:`${a.staff_name||a.dealer_name||a.referral_code||""} · ${PLAN_LABEL[a.workflow]||a.workflow||""} · ${a.outcome||""}`,
        onClick: ()=>{ if(ps.kind==="orders") openTrace(a.id); else if(ps.kind==="dealers") selectDealer(a.id,a.staff_name||a.dealer_name||a.staff_code); else if(a.dealer_id) selectDealer(a.dealer_id,a.staff_name||a.dealer_name||a.dealer_code); else openTrace(a.id); } }));
      gmap=null;
      window.fxLeaflet.render(mapEl,pins,{dark:isDark(),cluster:S.mode!=="dealers"&&ps.kind!=="orders",polyline:ps.kind==="orders"?pins.map(p=>[p.lat,p.lng]):null,fit:ps.kind==="orders"})
        .then(ok=>{ if(!ok) drawSvgStatic(ps); else { const note=host.querySelector("#fxmMapNote"); if(note) note.textContent=note.textContent.replace(/ — static view.*$/,"")+" · OpenStreetMap (Google key not usable here)"; } });
      return;
    }
    drawSvgStatic(ps);
  }
  function drawSvgStatic(ps){
    // last resort: same pins on a static KSA projection (same as the DMS map fallback)
    const W=1000,H=620, X=lng=>((lng-34)/(56-34))*W, Y=lat=>((33-lat)/(33-16))*H;
    const dark=isDark();
    let g=`<rect width="${W}" height="${H}" fill="${dark?"#0d1722":"#eef4fb"}"/><path d="M ${KSA_OUTLINE.map(([lg,lt])=>X(lg)+" "+Y(lt)).join(" L ")} Z" fill="${dark?"#16202e":"#f8fafc"}" stroke="${dark?"#3fb6f5":"#94a3b8"}" stroke-width="1.2"/>`;
    [["Riyadh",46.7,24.7],["Jeddah",39.2,21.5],["Dammam",50.1,26.4],["Makkah",39.8,21.4],["Madinah",39.6,24.5],["Abha",42.5,18.2],["Tabuk",36.6,28.4],["Hail",41.7,27.5]].forEach(([c,lg,lt])=>{ g+=`<text x="${X(lg)+5}" y="${Y(lt)-4}" font-size="10" fill="${dark?"#8b97a7":"#64748b"}">${esc(c)}</text>`; });
    if(ps.kind==="orders"&&ps.rows.length>1) g+=`<polyline points="${ps.rows.map(a=>X(a.lng)+","+Y(a.lat)).join(" ")}" fill="none" stroke="#3fb6f5" stroke-width="1.5" opacity=".7"/>`;
    const max=Math.max(1,...(ps.kind==="dealers"?ps.rows.map(r=>Number(r.placed||0)):[1]));
    ps.rows.forEach((a,i)=>{ if(a.lat==null||a.lng==null) return;
      const c=ps.kind==="dealers"?(ROLE_COLOR[a.role]||"#3fb6f5"):outcomeColor(a.outcome,a.workflow);
      const r=ps.kind==="dealers"?3+Math.round(7*Math.sqrt(Number(a.placed||0)/max)):ps.kind==="orders"?8:4;
      const ttl=ps.kind==="dealers"?`${a.staff_name||a.staff_code||""} · ${a.role||""} · ${a.placed} placed / ${a.done} done`:`${a.staff_name||a.dealer_name||a.referral_code||""} · ${PLAN_LABEL[a.workflow]||a.workflow||""} · ${a.outcome||""}`;
      g+=`<g data-i="${i}" style="cursor:pointer"><circle cx="${X(a.lng)}" cy="${Y(a.lat)}" r="${r}" fill="${c}" stroke="${dark?"#0d1117":"#fff"}" stroke-width="1"><title>${esc(ttl)}</title></circle>${ps.kind==="orders"?`<text x="${X(a.lng)}" y="${Y(a.lat)+3}" text-anchor="middle" font-size="9" font-weight="700" fill="#05121c">${i+1}</text>`:""}</g>`; });
    mapEl.innerHTML=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:100%;display:block">${g}</svg>`; gmap=null;
    mapEl.querySelectorAll("[data-i]").forEach(el=>el.addEventListener("click",()=>{ const a=ps.rows[Number(el.dataset.i)]; if(!a) return;
      if(ps.kind==="orders") openTrace(a.id); else if(ps.kind==="dealers") selectDealer(a.id,a.staff_name||a.dealer_name||a.staff_code); else if(a.dealer_id) selectDealer(a.dealer_id,a.staff_name||a.dealer_name||a.dealer_code); else openTrace(a.id); }));
    const note=host.querySelector("#fxmMapNote"); if(note&&!(D.config&&D.config.mapsKey)) note.textContent+=" · static projection (set GMAPS_KEY for Google Maps)";
  }

  /* ---- right: roster / dealer panel ---- */
  function drawRight(){ if(S.dealerId&&D.dealer&&D.dealer.dealer.id===S.dealerId) drawDealer(); else drawRoster(); }
  function rosterRows(){
    const rows=D.roster.map(r=>({...r,name:r.staff_name||r.dealer_name||r.staff_code||"(unknown)",city:r.city||"",conv:r.placed?Math.round(100*r.done/r.placed):0}));
    const k=S.sortKey, dir=S.sortDir;
    rows.sort((a,b)=>{ const va=a[k], vb=b[k]; const c=typeof va==="number"&&typeof vb==="number"?va-vb:String(va==null?"":va).localeCompare(String(vb==null?"":vb)); return c*dir; });
    return rows;
  }
  function drawRoster(){
    const el=host.querySelector("#fxmRight"); if(!el) return;
    const rows=rosterRows(); const arrow=k=>S.sortKey===k?(S.sortDir===1?" ▲":" ▼"):"";
    const th=(k,l,right)=>`<th class="${k?"sortable":""}" data-k="${k||""}" style="text-align:${right?"right":"left"};padding:4px 6px;color:var(--muted);font-weight:700;font-size:10px;letter-spacing:.6px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card,#fff)">${esc(l)}${k?arrow(k):""}</th>`;
    el.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><b style="font-size:12.5px">All dealers</b><span class="rl" style="font-size:10.5px;color:var(--muted)">${D.window?fx.ts(D.window.from).slice(0,10)+" → "+fx.ts(D.window.to).slice(0,10)+" · ":""}${rows.length} active</span>
        ${rows.length?`<button class="fxbtn" id="fxmCsv" style="margin-left:auto;padding:5px 10px;font-size:11px" title="Download this list">⬇ ${window.opsXlsx?"XLSX":"CSV"}</button>`:""}</div>
      <div style="overflow:auto;flex:1"><table class="mono" style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr>${th("name","DEALER")}${th("role","ROLE")}${th("city","CITY")}${th("placed","PLACED",1)}${th("done","DONE",1)}${th("conv","CONV%",1)}${th("last_seen","LAST",1)}</tr></thead>
      <tbody>${rows.map(r=>`<tr class="rowc" data-id="${esc(r.id)}" data-name="${esc(r.name)}" style="border-top:1px solid var(--line)">
        <td style="padding:4px 6px;font-weight:600">${esc(r.name)}<div class="rl" style="font-size:9.5px;color:var(--muted)">${esc(r.staff_code||"")}${r.dealer_name&&r.dealer_name!==r.name?" · "+esc(r.dealer_name):""}</div></td>
        <td style="padding:4px 6px;color:${ROLE_COLOR[r.role]||"inherit"}">${esc(r.role||"")}</td><td style="padding:4px 6px">${esc(r.city)}</td>
        <td style="padding:4px 6px;text-align:right">${fmt(r.placed)}</td><td style="padding:4px 6px;text-align:right;color:${COLOR.COMPLETED};font-weight:700">${fmt(r.done)}</td>
        <td style="padding:4px 6px;text-align:right;color:${r.conv>=60?COLOR.COMPLETED:r.conv>=30?COLOR.STALLED:COLOR.CANCELLED}">${r.conv}%</td>
        <td class="rl" style="padding:4px 6px;text-align:right;color:var(--muted)">${esc(fx.ts(r.last_seen).slice(5,16))}</td></tr>`).join("")||`<tr><td colspan="7" style="padding:12px;color:var(--muted)">no dealer activity in this window</td></tr>`}</tbody></table></div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-top:6px">Click a row (or a map pin) for the dealer panel, weekly bars and the per-order trace. Click a header to sort.</div>`;
    el.querySelectorAll("th.sortable").forEach(h=>h.onclick=()=>{ const k=h.dataset.k; if(S.sortKey===k) S.sortDir=S.sortDir===1?-1:1; else { S.sortKey=k; S.sortDir=k==="name"||k==="city"||k==="role"?1:-1; } save(); drawRoster(); });
    el.querySelectorAll("tr.rowc").forEach(tr=>tr.onclick=()=>selectDealer(tr.dataset.id,tr.dataset.name));
    const csv=el.querySelector("#fxmCsv"); if(csv) csv.onclick=()=>exportRoster(rows);
  }
  function exportRoster(rows){
    const out=rows.map(r=>({dealer:r.name,staff_code:r.staff_code||"",dealer_code:r.dealer_code||"",dealer_name:r.dealer_name||"",role:r.role||"",city:r.city,region:r.region||"",placed:r.placed,done:r.done,conv_pct:r.conv,last_seen:r.last_seen?fx.ts(r.last_seen):""}));
    const name=`fixed-dealers_${fx.state.range}${fx.state.channel?"_"+fx.state.channel:""}_${new Date().toISOString().slice(0,10)}`;
    if(window.opsXlsx&&window.opsXlsx.save){ window.opsXlsx.save([{name:"Dealers",rows:out}],name,{page:"fixed.map",filters:describe(S)}); return; }
    const head=Object.keys(out[0]||{dealer:1}); const q=v=>`"${String(v==null?"":v).replace(/"/g,'""')}"`;
    const blob=new Blob(["﻿"+[head.join(",")].concat(out.map(r=>head.map(h=>q(r[h])).join(","))).join("\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name+".csv"; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },0);
    if(window.audit) window.audit("EXPORT","fixed-map-roster-csv:"+out.length);
  }
  function selectDealer(id,name){ if(!id) return; S.dealerId=id; S.dealerName=name||""; save(); drawSide(); openDealer(id,name); }
  async function openDealer(id,name,quiet){
    const el=host.querySelector("#fxmRight"); if(!el) return;
    if(!quiet||!D.dealer||D.dealer.dealer.id!==id) el.innerHTML=`<div class="rl" style="font-size:11px;color:var(--muted);padding:4px 2px">loading ${esc(name||id)}…</div>`+(window.FXUI?window.FXUI.skeleton(8):"");
    try{ D.dealer=await fx.api(`/api/fixed/map/dealer?id=${encodeURIComponent(id)}&`+fx.qs()+filterQs().replace(/&dealerId=[^&]*/,"")); }
    catch(e){ el.innerHTML=`<div style="color:#dc2626;font-size:12px;padding:10px">${esc(e.message)}</div><button class="fxbtn back" id="fxmBack">← all dealers</button>`; el.querySelector("#fxmBack").onclick=clearDealer; return; }
    if(S.dealerId!==id) return;
    drawDealer(); drawMap();
  }
  function clearDealer(){ S.dealerId=null; S.dealerName=""; D.dealer=null; save(); drawSide(); drawRoster(); drawMap(); }
  function vs(now,prev){ if(prev==null) return ""; const d=now-prev; const c=d>0?COLOR.COMPLETED:d<0?COLOR.CANCELLED:"var(--muted)"; return `<span class="vs" style="color:${c}" title="vs previous window (${fmt(prev)})">${d>0?"▲":d<0?"▼":"="} ${fmt(Math.abs(d))}</span>`; }
  function drawDealer(){
    const el=host.querySelector("#fxmRight"), d=D.dealer; if(!el||!d) return;
    const k=d.kpis, p=d.prevKpis||{}, dl=d.dealer||{};
    const wkMax=Math.max(1,...d.weekly.map(w=>w.n)); const om=d.outcomeMix; const omTot=Math.max(1,om.completed+om.stalled+om.cancelled+om.expired+(om.in_progress||0));
    const tile=(l,v,sub,c)=>`<div class="kpi"><b style="${c?"color:"+c:""}">${v}</b><span>${esc(l)}</span>${sub?`<div>${sub}</div>`:""}</div>`;
    el.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><button class="fxbtn back" id="fxmBack" title="Back to all dealers">←</button><div style="flex:1;min-width:0"><b style="font-size:13px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(dl.staff_name||S.dealerName||dl.id)}</b>
        <div class="rl" style="font-size:10.5px;color:var(--muted)">${esc(dl.staff_code||"")} · ${esc(dl.role||"")} · ${esc(dl.dealer_name||dl.dealer_code||"")} · ${esc(dl.city||"")}${dl.region?" · "+esc(dl.region):""}${dl.is_active===false?" · <span style='color:#dc2626'>inactive</span>":""}</div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        ${tile("ATTEMPTS",fmt(k.attempts),vs(k.attempts,p.attempts))}${tile("COMPLETED",fmt(k.completed),vs(k.completed,p.completed),COLOR.COMPLETED)}
        ${tile("CONVERSION",k.conversion+"%",vs(k.conversion,p.conversion),k.conversion>=60?COLOR.COMPLETED:k.conversion>=30?COLOR.STALLED:COLOR.CANCELLED)}${tile("AVG DURATION",k.avgDurationS?Math.round(k.avgDurationS/60)+" min":"—",vs(k.avgDurationS,p.avgDurationS))}
        ${tile("AREAS",fmt(k.areas),"<span class='rl' style='font-size:10px;color:var(--muted)'>distinct cities</span>")}${tile("PER WEEK",k.perWeek,vs(k.perWeek,p.perWeek))}</div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin:-4px 0 8px">deltas vs previous ${fx.state.range} (${fx.ts(d.previous.from).slice(0,10)} → ${fx.ts(d.previous.to).slice(0,10)})</div>
      <h4 style="margin:0 0 4px;font-size:10.5px;letter-spacing:.6px;color:var(--muted)">WEEKLY · attempts (green = completed)</h4>
      <div style="display:flex;align-items:flex-end;gap:3px;height:54px;margin-bottom:10px">${d.weekly.map(w=>`<div title="week of ${esc(w.week)} · ${fmt(w.n)} attempts · ${fmt(w.completed)} completed" style="flex:1;min-width:6px;height:${Math.max(3,Math.round(52*w.n/wkMax))}px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,${COLOR.COMPLETED} ${Math.round(100*w.completed/Math.max(1,w.n))}%,var(--line) 0)"></div>`).join("")||`<span style="font-size:11px;color:var(--muted)">no attempts</span>`}</div>
      <h4 style="margin:0 0 4px;font-size:10.5px;letter-spacing:.6px;color:var(--muted)">OUTCOME MIX</h4>
      <div style="display:flex;height:9px;border-radius:5px;overflow:hidden;margin-bottom:4px">${[["completed",COLOR.COMPLETED],["in_progress",COLOR.IN_PROGRESS],["stalled",COLOR.STALLED],["cancelled",COLOR.CANCELLED],["expired",COLOR.EXPIRED]].map(([o,c])=>`<div title="${o} ${fmt(om[o]||0)}" style="width:${100*(om[o]||0)/omTot}%;background:${c}"></div>`).join("")}</div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-bottom:10px">${fmt(om.completed)} completed · ${fmt(om.in_progress||0)} in progress · ${fmt(om.stalled)} stalled · ${fmt(om.cancelled)} cancelled · ${fmt(om.expired)} expired</div>
      ${d.byWorkflow.length?`<h4 style="margin:0 0 4px;font-size:10.5px;letter-spacing:.6px;color:var(--muted)">PLANS</h4><div class="chips" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">${d.byWorkflow.map(w=>`<span class="pill" style="font-size:10.5px;padding:3px 9px">${esc(w.label)} <b>${fmt(w.n)}</b></span>`).join("")}</div>`:""}
      ${d.funnel&&d.funnel.steps.length?`<h4 style="margin:0 0 4px;font-size:10.5px;letter-spacing:.6px;color:var(--muted)">FUNNEL · ${esc(d.funnel.label)}</h4><div style="margin-bottom:10px">${d.funnel.steps.map(s=>`<div style="display:grid;grid-template-columns:1fr 40px;gap:6px;align-items:center;font-size:10.5px"><div><span class="rl" style="color:var(--muted)">${esc(s.step)}</span>${fx.bar(s.count,Math.max(1,d.funnel.steps[0].count),"#4d8af0")}</div><b class="mono" style="text-align:right">${fmt(s.count)}</b></div>`).join("")}</div>`:""}
      <h4 style="margin:0 0 4px;font-size:10.5px;letter-spacing:.6px;color:var(--muted)">AREAS</h4>
      ${fx.tbl(["REGION","ATTEMPTS","DONE"],d.areas.map(a=>[esc(a.region),fmt(a.n),fmt(a.completed)]))}
      <h4 style="margin:12px 0 6px">Recent attempts · newest ${d.recent.length}</h4>
      ${window.FXUI.orderList(d.recent.map((a,i)=>({id:a.id,idx:i+1,time:fx.ts(a.started_at).slice(5,16),outcome:a.outcome,color:outcomeColor(a.outcome,a.workflow),
        tags:[{t:PLAN_LABEL[a.workflow]||a.workflow||""}].concat(a.last_error_category?[{t:a.last_error_category,err:true}]:[]),line2:a.step_reached||"",ref:a.order_number||a.odb||a.service_no||""})),"no attempts in this window")}`;
    el.querySelector("#fxmBack").onclick=clearDealer;
    el.querySelectorAll("[data-att]").forEach(tr=>tr.onclick=()=>openTrace(tr.dataset.att));
  }

  /* ---- trace modal (TraceModal.tsx) ---- */
  function modalEl(){ let ov=document.getElementById("fxmModal"); if(!ov){ ov=document.createElement("div"); ov.id="fxmModal"; ov.className="modal-overlay"; ov.style.zIndex="300"; document.body.appendChild(ov); } return ov; }
  async function openTrace(id,unmask){
    if(!fx) fx=window.FX; const ov=modalEl(); if(!ov||!id||!fx) return; const UI=window.FXUI;
    ov.classList.add("open"); if(UI) UI.armModal(ov);
    ov.innerHTML=`<div class="fxt"><div class="fxt-head"><span class="fxt-title">Order trace</span><span class="fxt-id mono">${esc(id)}</span><span style="margin-left:auto"><button class="fxbtn icon" id="fxmClose" title="Close (Esc)">✕</button></span></div><div class="fxt-body">${UI?UI.skeleton(7):"loading…"}</div></div>`;
    ov.onclick=e=>{ if(e.target===ov) (UI?UI.closeModal(ov):ov.classList.remove("open")); };
    const close=()=>UI?UI.closeModal(ov):ov.classList.remove("open");
    ov.querySelector("#fxmClose").onclick=close;
    let t; try{ t=await fx.api(`/api/fixed/map/trace?id=${encodeURIComponent(id)}${unmask?"&unmask=1":""}`); }
    catch(e){ ov.querySelector(".fxt-body").innerHTML=`<div class="fxt-empty" style="color:#dc2626">${esc(e.message)}</div>`; return; }
    const a=t.attempt; const canUnmask=!!caps().unmaskPII; const oc=outcomeColor(a.outcome,a.workflow);
    const st={ok:COLOR.COMPLETED,fail:COLOR.CANCELLED,skip:"#94a3b8"};
    const fact=(l,v)=>v==null||v===""?"":`<div class="fxt-fact"><span>${esc(l)}</span><div class="mono">${esc(v)}</div></div>`;
    const j=v=>{ if(v==null) return ""; if(typeof v==="string"){ try{ return JSON.stringify(JSON.parse(v),null,2); }catch(e){ return v; } } return JSON.stringify(v,null,2); };
    const lastOk=(()=>{ let k=-1; t.steps.forEach((s,i)=>{ if(s.status==="ok") k=i; }); return k; })();
    const live=String(a.outcome||"").toUpperCase()==="IN_PROGRESS";
    ov.firstElementChild.style.setProperty("--oc",oc);
    ov.firstElementChild.innerHTML=`<div class="fxt-head">
        <span class="fxt-title">Order trace</span><span class="fxt-id mono">${esc(a.id)}</span>
        ${UI?UI.outcomePill(a.outcome,oc):esc(a.outcome)}
        <span class="fxtag" style="font-size:10.5px">${esc(a.label||a.workflow)}</span>${a.outsideKsa?`<span class="fxtag err">⚠ pin outside KSA</span>`:""}
        ${t.unmasked?`<span class="fxtag err">🔓 UNMASKED · audited</span>`:""}
        <span style="margin-left:auto;display:flex;gap:8px;align-items:center"><a class="fxbtn" id="fxmGrep" href="#${window.fixedTraceHash?window.fixedTraceHash(a.id):"fixed?tab=errors&openOnly=0&grep="+encodeURIComponent(a.id)}" title="Fixed › Troubleshoot — grep the raw app log for this workflow id: every step, success and failure, with request / response" style="text-decoration:none">🔎 Grep app log ›</a>${canUnmask&&!t.unmasked?`<button class="fxbtn warn" id="fxmUnmask" title="Fetch the live workflow context from nexus — every use is written to the audit log">🔓 Unmask <small style="font-weight:600;opacity:.8">audited</small></button>`:""}<button class="fxbtn icon" id="fxmClose" title="Close (Esc)">✕</button></span></div>
      <div class="fxt-body">
      ${t.unmaskNote?`<div class="fxt-note">${esc(t.unmaskNote)}</div>`:""}
      <div class="fxt-facts">
        ${fact("Started (KSA)",fx.ts(a.started_at,true))}${fact("Completed",a.completed_at?fx.ts(a.completed_at,true):null)}${fact("Duration",a.duration_s?Math.round(a.duration_s/60)+" min":null)}
        ${fact("Channel",a.channel)}${fact("Dealer",a.staff_name?`${a.staff_name} · ${a.staff_code||""}`:null)}${fact("Outlet",a.dealer_name||a.dealer_code)}${fact("City / region",[a.city,a.region].filter(Boolean).join(" · "))}
        ${fact("QR / referral",a.referral_code)}${fact("Plan",a.plan)}${fact("Order #",a.order_number)}${fact("ODB",a.odb)}${fact("ICCID",a.iccid)}${fact("CPE",a.cpe)}${fact("MSISDN",a.msisdn)}
        ${fact("Service #",a.service_no)}${fact("Customer",a.cust_code||a.customer_id)}${fact("Nafath",a.nafath_outcome)}${fact("Manafith",a.dealer_validation)}${fact("Last error",a.last_error_category)}${fact("Step reached",a.step_reached)}</div>
      <div class="fxt-cols">
        <div><h4>Journey steps</h4><div class="fxt-steps">
          ${t.steps.map((s,i)=>`<div class="fxt-step ${s.status}${live&&i===lastOk?" cur":""}" style="--sc:${st[s.status]||"#94a3b8"}"><span class="fxt-dot">${s.status==="ok"?"✓":s.status==="fail"?"✕":i+1}</span><b>${esc(s.step)}</b>${s.detail?`<div class="d mono">${esc(s.detail)}</div>`:""}</div>`).join("")||`<div class="fxt-empty">no canonical steps for this workflow</div>`}</div>
          ${Object.keys(t.stepDetail||{}).length?`<details class="sd" style="margin-top:10px"><summary>step_detail (${Object.keys(t.stepDetail).length})</summary><pre class="mono">${esc(j(t.stepDetail))}</pre></details>`:""}</div>
        <div><h4>API calls · ${t.apiCalls.length} <span style="font-weight:500;letter-spacing:0;text-transform:none;color:var(--muted)">· bodies masked at rest · click a call for request / response</span></h4>
          <div class="fxt-calls" style="max-height:56vh;overflow:auto">${t.apiCalls.map((c,i)=>{ const ok=c.status!=null&&c.status<400&&!c.error_class; const sc=ok?COLOR.COMPLETED:COLOR.CANCELLED; return `<details class="fxt-call">
            <summary><span class="i">${i+1}</span><span class="tm">${esc(fx.ts(c.created_at,true).slice(11))}</span><span class="me">${esc(c.method||"")}</span><span class="ep" title="${esc(c.endpoint)}">${esc(c.endpoint)}</span>
              <span class="fxt-st" style="--oc:${sc}">${esc(c.status==null?"—":c.status)}</span><span class="ms">${c.duration_ms!=null?fmt(c.duration_ms)+" ms":""}</span></summary>
            ${c.error_class||c.error_msg?`<div class="err">${esc(c.error_class||"")} ${esc(c.error_msg||"")}</div>`:""}${c.info?`<div class="info">${esc(c.info)}</div>`:""}
            <div class="fxt-io"><div><span>Request</span><pre class="mono">${esc(j(c.req_body)||"—")}</pre></div><div><span>Response</span><pre class="mono">${esc(j(c.res_body)||"—")}</pre></div></div></details>`; }).join("")||`<div class="fxt-empty">no api_calls captured for this attempt</div>`}</div>
          ${t.unmasked?`<h4 style="margin-top:12px;color:#dc2626">Raw workflow context · live from nexus · not stored</h4><pre class="mono fxt-raw">${esc(j(t.rawContext))}</pre>`:""}</div></div></div>`;
    ov.querySelector("#fxmClose").onclick=close;
    const gr=ov.querySelector("#fxmGrep"); if(gr) gr.addEventListener("click",()=>close());
    const um=ov.querySelector("#fxmUnmask"); if(um) um.onclick=()=>{ if(confirm("Fetch the raw (unmasked) workflow context for this attempt? This access is written to the audit log with your name.")) openTrace(id,true); };
  }

  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.map={ label:"SDA map", sub:"dealers · pins · trace", render };
  window.fixedMapOpenTrace=openTrace;   // other Fixed pages can deep-link an attempt trace
})();
