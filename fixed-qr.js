/* fixed-qr.js — Fixed › "QR codes" sub-page (registers window.FIXED_PAGES.qr).
 * Port of the prod operations console QR view (salam-dealer-ops: QrSidebar · GoogleMap qr-mode · QrPanel · QrDashboards):
 * left sidebar (KPIs · QR code search · consent filter · region / plan / outcome chips) → centre map where every pin is a
 * QR / referral code at the centroid of its orders, coloured by consent rate → right "QR leaderboard" table; click a row
 * or a pin → QR panel (funnel · consent · outcomes · recent attempts, each opening the trace modal from fixed-map.js).
 * Data: /api/fixed/qr/* (server/src/fixedMap.js). Scope is always channel=epurchase AND referral_code IS NOT NULL.
 * Vanilla JS, no build; every string goes through esc(). */
(function(){
  "use strict";
  const KEY="fixed_qr_state";
  const REGIONS=["Central","Western","Eastern","Southern","Northern"];
  const PLANS=[["ftth","FTTH"],["fttb","FTTB"],["fiveGWhiteLabel","5G HomeFI"],["fiveGFWA","5G FWA"],["promoters","Lead"]];
  const OUTCOMES=[["COMPLETED","Completed"],["IN_PROGRESS","In progress"],["STALLED","Stalled (error)"],["CANCELLED","Cancelled"],["EXPIRED","Expired"]];
  const CONSENT=[["all","All"],["consented","Consented"],["noconsent","No consent"]];
  const PLAN_LABEL={ftth:"FTTH",fttb:"FTTB",fiveGWhiteLabel:"5G HomeFI",fiveGFWA:"5G FWA",promoters:"Lead",ePurchaseFTTH:"FTTH (e-Purchase/QR)"};
  const COLOR={COMPLETED:"#3fb950",STALLED:"#d29922",CANCELLED:"#f85149",EXPIRED:"#6e7681",IN_PROGRESS:"#4d8af0"};
  const consentColor=r=>{ r=Math.max(0,Math.min(1,Number(r)||0)); return r>=.75?"#3fb950":r>=.5?"#56b886":r>=.3?"#d29922":"#f85149"; };
  const KSA_CENTER={lat:23.8,lng:45.0}, KSA_ZOOM=6;
  const KSA_OUTLINE=[[34.6,28.1],[36.5,29.2],[39.2,32.1],[40.4,31.9],[42.1,31.1],[44.7,29.2],[46.5,29.1],[47.5,29.0],[48.4,28.5],[49.0,27.0],[50.2,26.2],[50.8,24.8],[51.6,24.2],[52.0,22.9],[55.1,22.6],[55.7,22.0],[55.0,20.0],[52.0,19.0],[49.1,18.6],[48.2,18.2],[47.4,17.1],[46.7,17.2],[45.4,17.3],[44.2,17.4],[43.4,16.7],[42.8,16.4],[42.3,17.1],[41.2,18.6],[40.0,20.2],[39.1,21.5],[38.5,23.0],[37.4,24.3],[36.9,25.6],[35.6,27.0]];
  const DARK_STYLE=[{elementType:"geometry",stylers:[{color:"#16202e"}]},{elementType:"labels.text.fill",stylers:[{color:"#8b97a7"}]},{elementType:"labels.text.stroke",stylers:[{color:"#0d1117"}]},
    {featureType:"water",elementType:"geometry",stylers:[{color:"#0d1722"}]},{featureType:"road",elementType:"geometry",stylers:[{color:"#222d3e"}]},{featureType:"poi",stylers:[{visibility:"off"}]}];

  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const fmt=n=>Number(n||0).toLocaleString("en-US");
  const pc=r=>Math.round(100*(Number(r)||0))+"%";
  const isDark=()=>document.documentElement.getAttribute("data-theme")==="dark";

  const DEF={regions:[],plans:[],outcomes:[],consent:"all",ref:null,mode:"codes",sortKey:"orders",sortDir:-1};
  let S=Object.assign({},DEF); try{ Object.assign(S,JSON.parse(localStorage.getItem(KEY)||"{}")); }catch(e){}
  const save=()=>{ try{ localStorage.setItem(KEY,JSON.stringify(S)); }catch(e){} };
  const filterQs=()=>{ const p=[]; if(S.regions.length) p.push("regions="+encodeURIComponent(S.regions.join(","))); if(S.plans.length) p.push("plans="+encodeURIComponent(S.plans.join(",")));
    if(S.outcomes.length) p.push("outcomes="+encodeURIComponent(S.outcomes.join(","))); if(S.consent!=="all") p.push("consent="+S.consent); return p.length?"&"+p.join("&"):""; };
  // the hub's range applies; the hub's channel chip is ignored here (QR = epurchase + referral by definition)
  const qs=()=>"range="+encodeURIComponent(fx.state.range)+filterQs();

  let host=null, fx=null, D={sum:null,pins:[],code:null,config:null,error:null}, gmap=null, markers=[], cluster=null, mapEl=null, seq=0;

  /* ---- Google Maps loader (shared promise with fixed-map.js) ---- */
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
    if(window.markerClusterer&&window.markerClusterer.MarkerClusterer) return (map,ms)=>{ const c=new window.markerClusterer.MarkerClusterer({map,markers:ms}); return {clear:()=>{ try{ c.clearMarkers(); }catch(e){} }}; };
    if(typeof window.MarkerClusterer==="function") return (map,ms)=>{ const c=new window.MarkerClusterer(map,ms,{gridSize:60,maxZoom:14,averageCenter:true,
        styles:[{url:clusterSvg("#7c3aed"),height:44,width:44,textColor:"#fff",textSize:11},{url:clusterSvg("#2563eb"),height:44,width:44,textColor:"#fff",textSize:11},{url:clusterSvg("#0e9f5a"),height:44,width:44,textColor:"#fff",textSize:11}]});
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
    try{
      const [sum,att,cfg]=await Promise.all([ fx.api("/api/fixed/qr/summary?"+qs()), S.mode==="orders"?fx.api("/api/fixed/qr/attempts?"+qs()):Promise.resolve({rows:[]}),
        D.config?Promise.resolve(D.config):fx.api("/api/fixed/config").catch(()=>({mapsKey:null})) ]);
      if(my!==seq) return;
      D.sum=sum; D.pins=att.rows||[]; D.capped=!!att.capped; D.config=cfg;
    }catch(e){ if(my!==seq) return; D.error=e.message; D.sum=null; D.pins=[]; }
    drawKpis(); drawRight(); drawMap();
    if(S.ref) openCode(S.ref,true);
  }

  /* ---- layout ---- */
  async function render(h,ctx){
    host=h; fx=ctx;
    host.innerHTML=`<div id="fxq" style="display:grid;grid-template-columns:262px minmax(0,1fr) 360px;gap:12px;height:calc(100vh - 205px);min-height:600px">
      <aside id="fxqSide" class="topo-card" style="padding:12px;overflow:auto;display:flex;flex-direction:column;gap:12px"></aside>
      <div id="fxqMapWrap" class="topo-card" style="padding:0;position:relative;overflow:hidden;min-height:400px">
        <div id="fxqMap" style="position:absolute;inset:0"></div>
        <div id="fxqLegend" style="position:absolute;left:10px;bottom:10px;background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;padding:7px 10px;font-size:10.5px;display:flex;gap:10px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(2,6,23,.15)"></div>
        <div id="fxqMapNote" class="rl" style="position:absolute;right:10px;top:10px;background:var(--card,#fff);border:1px solid var(--line);border-radius:8px;padding:4px 9px;font-size:10.5px;color:var(--muted)"></div>
      </div>
      <aside id="fxqRight" class="topo-card" style="padding:12px;overflow:auto;display:flex;flex-direction:column"></aside>
    </div>
    <style>
      #fxq .fxchip{cursor:pointer;font:inherit;font-size:11px;font-weight:600;padding:4px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:inherit}
      #fxq .fxchip.on{background:#7c3aed;border-color:#7c3aed;color:#fff} #fxq .fxchip.blue.on{background:#2563eb;border-color:#2563eb}
      #fxq h4{margin:0 0 6px;font-size:10.5px;letter-spacing:.6px;color:var(--muted);text-transform:uppercase}
      #fxq .grp{display:flex;flex-direction:column;gap:2px} #fxq .chips{display:flex;gap:5px;flex-wrap:wrap}
      #fxq .kpi{border:1px solid var(--line);border-radius:10px;padding:7px 9px} #fxq .kpi b{font-size:17px;display:block} #fxq .kpi span{font-size:10px;color:var(--muted);letter-spacing:.5px}
      #fxq th.sortable{cursor:pointer;user-select:none} #fxq tr.rowc{cursor:pointer} #fxq tr.rowc:hover td{background:rgba(148,163,184,.10)}
      .fxq-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:-1px}
      @media (max-width:1100px){ #fxq{grid-template-columns:1fr !important;height:auto !important} #fxqMapWrap{height:460px} }
    </style>`;
    mapEl=host.querySelector("#fxqMap"); gmap=null; markers=[]; cluster=null;
    drawSide();
    host.querySelector("#fxqRight").innerHTML=`<div style="color:var(--muted);font-size:12px;padding:10px">loading…</div>`;
    await load();
  }

  /* ---- sidebar ---- */
  function drawSide(){
    const side=host.querySelector("#fxqSide"); if(!side) return;
    const chip=(cls,attr,on,label)=>`<button class="fxchip ${cls}${on?" on":""}" ${attr}>${esc(label)}</button>`;
    side.innerHTML=`<div id="fxqKpis" style="display:grid;grid-template-columns:1fr 1fr;gap:6px"></div>
      <div class="grp"><h4>QR code</h4><div style="position:relative">
        <input id="fxqQ" placeholder="search referral code" value="${esc(S.ref||"")}" autocomplete="off" style="width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
        <div id="fxqQList" style="position:absolute;left:0;right:0;top:100%;z-index:30;background:var(--card,#fff);border:1px solid var(--line);border-radius:8px;box-shadow:0 6px 18px rgba(2,6,23,.18);display:none;max-height:260px;overflow:auto"></div></div>
        ${S.ref?`<div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11.5px"><b class="mono" style="flex:1">${esc(S.ref)}</b><button class="fxchip" id="fxqClearRef">✕ clear</button></div>`:""}</div>
      <div class="grp"><h4>Map view</h4><div class="chips">${chip("blue",'data-mode="codes"',S.mode==="codes","QR codes")}${chip("blue",'data-mode="orders"',S.mode==="orders","Orders")}</div></div>
      <div class="grp"><h4>Consent</h4><div class="chips">${CONSENT.map(([v,l])=>chip("",`data-one="consent" data-v="${v}"`,S.consent===v,l)).join("")}</div></div>
      <div class="grp"><h4>Region / Group</h4><div class="chips">${REGIONS.map(r=>chip("",`data-f="regions" data-v="${esc(r)}"`,S.regions.includes(r),r)).join("")}</div></div>
      <div class="grp"><h4>Plan type</h4><div class="chips">${PLANS.map(([v,l])=>chip("",`data-f="plans" data-v="${v}"`,S.plans.includes(v),l)).join("")}</div>
        <div class="rl" style="font-size:10px;color:var(--muted)">QR orders ride the e-purchase FTTH journey — the FTTH chip matches them</div></div>
      <div class="grp"><h4>Outcome</h4><div class="chips">${OUTCOMES.map(([v,l])=>chip("",`data-f="outcomes" data-v="${v}"`,S.outcomes.includes(v),l)).join("")}</div></div>
      <div class="grp" id="fxqMix"></div>
      <div style="display:flex;gap:6px;margin-top:auto;flex-wrap:wrap"><button class="fxchip" id="fxqReset">Reset filters</button><button class="fxchip" id="fxqReload">↻ refresh</button></div>`;
    side.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{ const k=b.dataset.f, v=b.dataset.v; const i=S[k].indexOf(v); if(i>=0) S[k].splice(i,1); else S[k].push(v); save(); drawSide(); load(); });
    side.querySelectorAll("[data-one]").forEach(b=>b.onclick=()=>{ S[b.dataset.one]=b.dataset.v; save(); drawSide(); load(); });
    side.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{ S.mode=b.dataset.mode; save(); drawSide(); load(); });
    side.querySelector("#fxqReset").onclick=()=>{ Object.assign(S,DEF,{regions:[],plans:[],outcomes:[],mode:S.mode}); save(); drawSide(); load(); };
    side.querySelector("#fxqReload").onclick=()=>{ D.config=null; load(); };
    const cr=side.querySelector("#fxqClearRef"); if(cr) cr.onclick=clearCode;
    // referral typeahead — client-side over the leaderboard (referrals.search equivalent: orders · done · consent)
    const inp=side.querySelector("#fxqQ"), list=side.querySelector("#fxqQList");
    inp.oninput=()=>{ const v=inp.value.trim().toLowerCase(); if(!v||!D.sum){ list.style.display="none"; return; }
      const rows=D.sum.leaderboard.filter(x=>String(x.referralCode).toLowerCase().includes(v)).slice(0,10);
      list.innerHTML=rows.map(x=>`<div data-ref="${esc(x.referralCode)}" style="padding:6px 9px;cursor:pointer;border-bottom:1px solid var(--line);font-size:11.5px"><b class="mono">${esc(x.referralCode)}</b><div class="rl" style="font-size:10px;color:var(--muted)">${fmt(x.orders)} orders · ${fmt(x.completed)} done · consent <span style="color:${consentColor(x.consentRate)}">${pc(x.consentRate)}</span>${x.region?" · "+esc(x.region):""}</div></div>`).join("")||`<div style="padding:8px;font-size:11.5px;color:var(--muted)">no QR code matches in this window</div>`;
      list.style.display="block";
      list.querySelectorAll("[data-ref]").forEach(x=>x.onclick=()=>{ list.style.display="none"; selectCode(x.dataset.ref); }); };
    inp.onkeydown=e=>{ if(e.key==="Enter"&&inp.value.trim()){ list.style.display="none"; selectCode(inp.value.trim()); } };
    inp.onblur=()=>setTimeout(()=>{ list.style.display="none"; },200);
    drawKpis();
  }
  function drawKpis(){
    const el=host&&host.querySelector("#fxqKpis"); if(!el) return; const k=(D.sum&&D.sum.kpis)||{qrCodes:0,attempts:0,completed:0,conversion:0,consentRate:0};
    el.innerHTML=`<div class="kpi"><b>${fmt(k.qrCodes)}</b><span>QR CODES</span></div><div class="kpi"><b>${fmt(k.attempts)}</b><span>ATTEMPTS</span></div>
      <div class="kpi"><b style="color:${COLOR.COMPLETED}">${fmt(k.completed)}</b><span>COMPLETED</span></div><div class="kpi"><b>${k.conversion}%</b><span>CONVERSION</span></div>
      <div class="kpi" style="grid-column:1/-1;border-left:3px solid ${consentColor(k.consentRate)}"><b style="color:${consentColor(k.consentRate)}">${pc(k.consentRate)}</b><span>MARKETING CONSENT RATE</span></div>
      ${D.error?`<div style="grid-column:1/-1;color:#dc2626;font-size:11px">${esc(D.error)}</div>`:""}`;
    const mx=host.querySelector("#fxqMix"); if(!mx||!D.sum) return;
    const om=D.sum.outcomeMix, tot=Math.max(1,om.completed+om.stalled+om.cancelled+om.expired+(om.in_progress||0));
    mx.innerHTML=`<h4>Outcome mix</h4><div style="display:flex;height:9px;border-radius:5px;overflow:hidden;margin-bottom:4px">${[["completed",COLOR.COMPLETED],["in_progress",COLOR.IN_PROGRESS],["stalled",COLOR.STALLED],["cancelled",COLOR.CANCELLED],["expired",COLOR.EXPIRED]].map(([o,c])=>`<div title="${o} ${fmt(om[o]||0)}" style="width:${100*(om[o]||0)/tot}%;background:${c}"></div>`).join("")}</div>
      <div class="rl" style="font-size:10px;color:var(--muted)">${fmt(om.completed)} completed · ${fmt(om.in_progress||0)} in progress · ${fmt(om.stalled)} stalled · ${fmt(om.cancelled)} cancelled · ${fmt(om.expired)} expired</div>
      ${D.sum.planMix.length?`<h4 style="margin-top:10px">By plan</h4>${D.sum.planMix.map(p=>`<div style="display:flex;justify-content:space-between;font-size:11.5px;margin:2px 0"><span>${esc(p.plan)}</span><b>${fmt(p.count)}</b></div>`).join("")}`:""}
      ${D.sum.regionPerf.length?`<h4 style="margin-top:10px">Regions</h4>${D.sum.regionPerf.slice(0,6).map(r=>`<div style="display:flex;justify-content:space-between;font-size:11.5px;margin:2px 0"><span>${esc(r.region)}</span><span><b>${fmt(r.total)}</b> <span style="color:var(--muted)">· ${r.conv}%</span></span></div>`).join("")}`:""}`;
  }

  /* ---- map: pins = QR codes (centroid of their orders), colour = consent rate; "Orders" mode = individual attempts ---- */
  function legend(){
    const el=host.querySelector("#fxqLegend"); if(!el) return; const dot=(c,l)=>`<span><i class="fxq-dot" style="background:${c}"></i>${esc(l)}</span>`;
    el.innerHTML=S.mode==="orders"?[dot(COLOR.COMPLETED,"Completed"),dot(COLOR.IN_PROGRESS,"In progress"),dot(COLOR.STALLED,"Stalled"),dot(COLOR.CANCELLED,"Cancelled"),dot(COLOR.EXPIRED,"Expired")].join("")
      :`<span style="color:var(--muted)">consent rate</span>`+[dot("#3fb950","≥75%"),dot("#56b886","≥50%"),dot("#d29922","≥30%"),dot("#f85149","<30%")].join("")+`<span style="color:var(--muted)">· size = orders</span>`;
  }
  function pinSet(){
    if(S.mode==="orders"){ const rows=S.ref?D.pins.filter(a=>a.referral_code===S.ref):D.pins; return {kind:"orders",rows}; }
    const rows=((D.sum&&D.sum.leaderboard)||[]).filter(x=>x.lat!=null&&x.lng!=null&&(!S.ref||x.referralCode===S.ref)); return {kind:"codes",rows};
  }
  function drawMap(){
    if(!mapEl) return; const ps=pinSet(); legend();
    const note=host.querySelector("#fxqMapNote"); if(note) note.textContent=ps.kind==="codes"?`${fmt(ps.rows.length)} QR codes with positioned orders · ${fx.state.range}`:`${fmt(ps.rows.length)} QR orders${D.capped?" (newest 2000)":""} · ${fx.state.range}`;
    const key=D.config&&D.config.mapsKey; if(!key){ drawSvg(ps); return; }
    loadMaps(key).then(async()=>{
      document.addEventListener("fxmaps:authfail", ()=>{ if(note) note.textContent="Google rejected the key for "+location.origin+" — static view (add it to the key's website restrictions)"; drawSvg(ps); }, {once:true});
      if(!gmap||!mapEl.isConnected){ mapEl.innerHTML=""; gmap=new google.maps.Map(mapEl,{center:KSA_CENTER,zoom:KSA_ZOOM,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,gestureHandling:"greedy",
          zoomControlOptions:{position:google.maps.ControlPosition.RIGHT_BOTTOM},styles:isDark()?DARK_STYLE:undefined});
        const rb=document.createElement("button"); rb.textContent="⌂ KSA"; rb.style.cssText="margin:0 10px 24px 0;background:#fff;border:0;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.3);padding:7px 12px;font:600 12px/1 Roboto,Arial,sans-serif;cursor:pointer;color:#333";
        rb.onclick=()=>{ gmap.setCenter(KSA_CENTER); gmap.setZoom(KSA_ZOOM); }; gmap.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(rb); }
      if(cluster){ cluster.clear(); cluster=null; } markers.forEach(m=>m.setMap(null)); markers=[];
      const icon=(c,scale)=>({path:google.maps.SymbolPath.CIRCLE,scale,fillColor:c,fillOpacity:.92,strokeWeight:1.2,strokeColor:isDark()?"#0d1117":"#fff"});
      const ms=[];
      if(ps.kind==="codes"){ const max=Math.max(1,...ps.rows.map(x=>x.orders));
        ps.rows.forEach(x=>{ const m=new google.maps.Marker({position:{lat:x.lat,lng:x.lng},icon:icon(consentColor(x.consentRate),6+Math.round(10*Math.sqrt(x.orders/max))),
            title:`QR ${x.referralCode} · ${x.orders} orders · ${x.completed} done (${x.conv}%) · consent ${pc(x.consentRate)}${x.region?" · "+x.region:""}`});
          m.addListener("click",()=>selectCode(x.referralCode)); ms.push(m); });
      } else ps.rows.forEach(a=>{ const m=new google.maps.Marker({position:{lat:a.lat,lng:a.lng},icon:icon(COLOR[a.outcome]||"#3fb6f5",a.outsideKsa?8:6),
            title:`QR ${a.referral_code} · ${a.outcome} · ${fx.ts(a.started_at)}${a.consent?" · consented":""}`}); m.addListener("click",()=>openTrace(a.id)); ms.push(m); });
      if(S.ref&&ms.length){ const b=new google.maps.LatLngBounds(); ms.forEach(m=>b.extend(m.getPosition())); gmap.fitBounds(b,60); if(ms.length===1) gmap.setZoom(11); }
      const mk=await loadClusterer().catch(()=>null); if(!mapEl.isConnected) return;
      if(mk&&ms.length>40) cluster=mk(gmap,ms); else { ms.forEach(m=>m.setMap(gmap)); markers=ms; }
    }).catch(e=>{ if(note) note.textContent="Google Maps failed ("+e.message+") — static view"; drawSvg(ps); });
  }
  function drawSvg(ps){
    if(window.fxLeaflet){
      const max=Math.max(1,...(ps.kind==="codes"?ps.rows.map(x=>x.orders):[1]));
      const pins=ps.rows.filter(x=>x.lat!=null&&x.lng!=null).map(x=>({ lat:x.lat, lng:x.lng,
        color: ps.kind==="codes"?consentColor(x.consentRate):(COLOR[x.outcome]||"#3fb6f5"),
        r: ps.kind==="codes"?5+Math.round(10*Math.sqrt(x.orders/max)):5,
        title: ps.kind==="codes"?`QR ${x.referralCode} · ${x.orders} orders · consent ${pc(x.consentRate)}`:`QR ${x.referral_code} · ${x.outcome}`,
        onClick: ()=>{ if(ps.kind==="codes") selectCode(x.referralCode); else openTrace(x.id); } }));
      gmap=null;
      window.fxLeaflet.render(mapEl,pins,{dark:isDark(),cluster:ps.kind!=="codes"})
        .then(ok=>{ if(!ok) drawSvgStatic(ps); else { const note=host.querySelector("#fxqMapNote"); if(note) note.textContent=note.textContent.replace(/ — static view.*$/,"")+" · OpenStreetMap (Google key not usable here)"; } });
      return;
    }
    drawSvgStatic(ps);
  }
  function drawSvgStatic(ps){
    const W=1000,H=620, X=lng=>((lng-34)/(56-34))*W, Y=lat=>((33-lat)/(33-16))*H, dark=isDark();
    let g=`<rect width="${W}" height="${H}" fill="${dark?"#0d1722":"#eef4fb"}"/><path d="M ${KSA_OUTLINE.map(([lg,lt])=>X(lg)+" "+Y(lt)).join(" L ")} Z" fill="${dark?"#16202e":"#f8fafc"}" stroke="${dark?"#3fb6f5":"#94a3b8"}" stroke-width="1.2"/>`;
    [["Riyadh",46.7,24.7],["Jeddah",39.2,21.5],["Dammam",50.1,26.4],["Madinah",39.6,24.5],["Abha",42.5,18.2],["Tabuk",36.6,28.4]].forEach(([c,lg,lt])=>{ g+=`<text x="${X(lg)+5}" y="${Y(lt)-4}" font-size="10" fill="${dark?"#8b97a7":"#64748b"}">${esc(c)}</text>`; });
    const max=Math.max(1,...(ps.kind==="codes"?ps.rows.map(x=>x.orders):[1]));
    ps.rows.forEach((x,i)=>{ if(x.lat==null||x.lng==null) return;
      const c=ps.kind==="codes"?consentColor(x.consentRate):(COLOR[x.outcome]||"#3fb6f5"), r=ps.kind==="codes"?3+Math.round(8*Math.sqrt(x.orders/max)):4;
      const t=ps.kind==="codes"?`QR ${x.referralCode} · ${x.orders} orders · consent ${pc(x.consentRate)}`:`QR ${x.referral_code} · ${x.outcome}`;
      g+=`<circle data-i="${i}" cx="${X(x.lng)}" cy="${Y(x.lat)}" r="${r}" fill="${c}" stroke="${dark?"#0d1117":"#fff"}" stroke-width="1" style="cursor:pointer"><title>${esc(t)}</title></circle>`; });
    mapEl.innerHTML=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:100%;display:block">${g}</svg>`; gmap=null;
    mapEl.querySelectorAll("[data-i]").forEach(el=>el.addEventListener("click",()=>{ const x=ps.rows[Number(el.dataset.i)]; if(!x) return; if(ps.kind==="codes") selectCode(x.referralCode); else openTrace(x.id); }));
    const note=host.querySelector("#fxqMapNote"); if(note&&!(D.config&&D.config.mapsKey)) note.textContent+=" · static projection (set GMAPS_KEY for Google Maps)";
  }

  /* ---- right: leaderboard / QR panel ---- */
  function drawRight(){ if(S.ref&&D.code&&D.code.referralCode===S.ref) drawCode(); else drawBoard(); }
  function drawBoard(){
    const el=host.querySelector("#fxqRight"); if(!el) return;
    const rows=((D.sum&&D.sum.leaderboard)||[]).slice(); const k=S.sortKey, dir=S.sortDir;
    rows.sort((a,b)=>{ const va=a[k], vb=b[k]; const c=typeof va==="number"&&typeof vb==="number"?va-vb:String(va==null?"":va).localeCompare(String(vb==null?"":vb)); return c*dir; });
    const arrow=x=>S.sortKey===x?(S.sortDir===1?" ▲":" ▼"):"";
    const th=(x,l,right)=>`<th class="sortable" data-k="${x}" style="text-align:${right?"right":"left"};padding:4px 6px;color:var(--muted);font-weight:700;font-size:10px;letter-spacing:.6px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card,#fff)">${esc(l)}${arrow(x)}</th>`;
    const maxc=Math.max(1,...rows.map(x=>x.completed));
    el.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><b style="font-size:12.5px">QR leaderboard</b><span class="rl" style="font-size:10.5px;color:var(--muted)">${rows.length} codes · ${esc(fx.state.range)}</span>
        ${rows.length?`<button class="fxchip" id="fxqCsv" style="margin-left:auto">⬇ ${window.opsXlsx?"XLSX":"CSV"}</button>`:""}</div>
      <div style="overflow:auto;flex:1"><table class="mono" style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr>${th("referralCode","CODE")}${th("orders","ORDERS",1)}${th("completed","DONE",1)}${th("conv","CONV%",1)}${th("consentRate","CONSENT",1)}</tr></thead>
      <tbody>${rows.map(x=>`<tr class="rowc" data-ref="${esc(x.referralCode)}" style="border-top:1px solid var(--line)">
        <td style="padding:4px 6px;font-weight:600">${esc(x.referralCode)}<div class="rl" style="font-size:9.5px;color:var(--muted)">${esc(x.region||"")}${x.lastSeen?" · "+esc(fx.ts(x.lastSeen).slice(5,16)):""}</div></td>
        <td style="padding:4px 6px;text-align:right">${fmt(x.orders)}</td><td style="padding:4px 6px;text-align:right;color:${COLOR.COMPLETED};font-weight:700">${fmt(x.completed)}<div style="height:3px;background:${COLOR.COMPLETED};width:${Math.round(100*x.completed/maxc)}%;margin-left:auto;border-radius:2px"></div></td>
        <td style="padding:4px 6px;text-align:right;color:${x.conv>=60?COLOR.COMPLETED:x.conv>=30?COLOR.STALLED:COLOR.CANCELLED}">${x.conv}%</td><td style="padding:4px 6px;text-align:right;color:${consentColor(x.consentRate)};font-weight:700">${pc(x.consentRate)}</td></tr>`).join("")||`<tr><td colspan="5" style="padding:12px;color:var(--muted)">no QR orders in this window</td></tr>`}</tbody></table></div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-top:6px">Click a code (or a pin) for its funnel, consent and outcomes. Click a header to sort.</div>`;
    el.querySelectorAll("th.sortable").forEach(h=>h.onclick=()=>{ const x=h.dataset.k; if(S.sortKey===x) S.sortDir=-S.sortDir; else { S.sortKey=x; S.sortDir=x==="referralCode"?1:-1; } save(); drawBoard(); });
    el.querySelectorAll("tr.rowc").forEach(tr=>tr.onclick=()=>selectCode(tr.dataset.ref));
    const csv=el.querySelector("#fxqCsv"); if(csv) csv.onclick=()=>{
      const out=rows.map(x=>({code:x.referralCode,region:x.region||"",orders:x.orders,done:x.completed,conv_pct:x.conv,consent_pct:Math.round(100*x.consentRate),last_seen:x.lastSeen?fx.ts(x.lastSeen):""}));
      const name=`fixed-qr-leaderboard_${fx.state.range}_${new Date().toISOString().slice(0,10)}`;
      if(window.opsXlsx&&window.opsXlsx.save){ window.opsXlsx.save([{name:"QR codes",rows:out}],name,{page:"fixed.qr"}); return; }
      const head=Object.keys(out[0]); const q=v=>`"${String(v==null?"":v).replace(/"/g,'""')}"`;
      const blob=new Blob(["﻿"+[head.join(",")].concat(out.map(r=>head.map(h=>q(r[h])).join(","))).join("\n")],{type:"text/csv;charset=utf-8"});
      const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name+".csv"; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },0);
      if(window.audit) window.audit("EXPORT","fixed-qr-leaderboard-csv:"+out.length); };
  }
  function selectCode(ref){ if(!ref) return; S.ref=String(ref).slice(0,60); save(); drawSide(); openCode(S.ref); }
  function clearCode(){ S.ref=null; D.code=null; save(); drawSide(); drawBoard(); drawMap(); }
  async function openCode(ref,quiet){
    const el=host.querySelector("#fxqRight"); if(!el) return;
    if(!quiet||!D.code||D.code.referralCode!==ref) el.innerHTML=`<div style="color:var(--muted);font-size:12px;padding:10px">loading QR ${esc(ref)}…</div>`;
    try{ D.code=await fx.api(`/api/fixed/qr/code?ref=${encodeURIComponent(ref)}&`+qs()); }
    catch(e){ el.innerHTML=`<div style="color:#dc2626;font-size:12px;padding:10px">${esc(e.message)}</div><button class="fxchip" id="fxqBack">← leaderboard</button>`; el.querySelector("#fxqBack").onclick=clearCode; return; }
    if(S.ref!==ref) return; drawCode(); drawMap();
  }
  function drawCode(){
    const el=host.querySelector("#fxqRight"), c=D.code; if(!el||!c) return; const k=c.kpis, om=c.outcomeMix, tot=Math.max(1,om.completed+om.stalled+om.cancelled+om.expired+(om.in_progress||0));
    const dMax=Math.max(1,...c.daily.map(x=>x.count)), fMax=Math.max(1,(c.funnel.steps[0]||{}).count||0);
    const tile=(l,v,col)=>`<div class="kpi"><b style="${col?"color:"+col:""}">${v}</b><span>${esc(l)}</span></div>`;
    el.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><button class="fxchip" id="fxqBack">←</button><div style="flex:1;min-width:0"><b class="mono" style="font-size:13px">QR ${esc(c.referralCode)}</b><div class="rl" style="font-size:10.5px;color:var(--muted)">${esc(c.funnel.label)} · ${fx.ts(c.window.from).slice(0,10)} → ${fx.ts(c.window.to).slice(0,10)}</div></div></div>
      <div class="kpi" style="border-left:3px solid ${consentColor(k.consentRate)};margin-bottom:6px"><b style="color:${consentColor(k.consentRate)};font-size:22px">${pc(k.consentRate)}</b><span>MARKETING CONSENT · ${fmt(k.consented)} of ${fmt(k.attempts)}</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">${tile("ATTEMPTS",fmt(k.attempts))}${tile("COMPLETED",fmt(k.completed),COLOR.COMPLETED)}${tile("CONVERSION",k.conversion+"%",k.conversion>=60?COLOR.COMPLETED:k.conversion>=30?COLOR.STALLED:COLOR.CANCELLED)}${tile("PER WEEK",k.perWeek)}${tile("AREAS",fmt(k.areas))}</div>
      <h4>Funnel · ${esc(c.funnel.label)}</h4><div style="margin-bottom:10px">${c.funnel.steps.map(s=>`<div style="display:grid;grid-template-columns:1fr 40px;gap:6px;align-items:center;font-size:10.5px"><div><span class="rl" style="color:var(--muted)">${esc(s.step)}${s.drop?` <span style="color:${COLOR.CANCELLED}">−${fmt(s.drop)}</span>`:""}</span>${fx.bar(s.count,fMax,"#7c3aed")}</div><b class="mono" style="text-align:right">${fmt(s.count)}</b></div>`).join("")}</div>
      <h4>Outcomes</h4><div style="display:flex;height:9px;border-radius:5px;overflow:hidden;margin-bottom:4px">${[["completed",COLOR.COMPLETED],["in_progress",COLOR.IN_PROGRESS],["stalled",COLOR.STALLED],["cancelled",COLOR.CANCELLED],["expired",COLOR.EXPIRED]].map(([o,cl])=>`<div title="${o} ${fmt(om[o]||0)}" style="width:${100*(om[o]||0)/tot}%;background:${cl}"></div>`).join("")}</div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-bottom:10px">${fmt(om.completed)} completed · ${fmt(om.in_progress||0)} in progress · ${fmt(om.stalled)} stalled · ${fmt(om.cancelled)} cancelled · ${fmt(om.expired)} expired</div>
      <h4>Daily orders</h4><div style="display:flex;align-items:flex-end;gap:2px;height:44px;margin-bottom:10px">${c.daily.map(x=>`<div title="${esc(x.date)} · ${fmt(x.count)}" style="flex:1;min-width:3px;height:${Math.max(2,Math.round(42*x.count/dMax))}px;background:#7c3aed;border-radius:2px 2px 0 0"></div>`).join("")||`<span style="font-size:11px;color:var(--muted)">none</span>`}</div>
      <h4>Areas</h4>${fx.tbl(["REGION","ORDERS","DONE"],c.areas.map(a=>[esc(a.region),fmt(a.n),fmt(a.completed)]))}
      <h4 style="margin-top:10px">Recent orders · newest ${c.recent.length} · click for the trace</h4>
      <div style="overflow:auto"><table class="mono" style="width:100%;border-collapse:collapse;font-size:11px"><tbody>${c.recent.map((a,i)=>`<tr class="rowc" data-att="${esc(a.id)}" style="border-top:1px solid var(--line)"><td style="padding:4px 5px;color:var(--muted)">${i+1}</td><td style="padding:4px 5px">${esc(fx.ts(a.started_at).slice(5,16))}</td>
        <td style="padding:4px 5px;color:${COLOR[a.outcome]||"inherit"};font-weight:700">${esc(a.outcome)}</td><td style="padding:4px 5px;color:${a.consent?COLOR.COMPLETED:"var(--muted)"}">${a.consent===true?"consent ✓":a.consent===false?"no consent":"—"}</td>
        <td style="padding:4px 5px;color:var(--muted)">${esc(a.step_reached||"")}${a.last_error_category?` <span class="pill" style="font-size:9px;padding:1px 6px">${esc(a.last_error_category)}</span>`:""}</td><td style="padding:4px 5px">${esc(a.order_number||a.odb||"")}</td></tr>`).join("")||`<tr><td style="padding:8px;color:var(--muted)">none in window</td></tr>`}</tbody></table></div>`;
    el.querySelector("#fxqBack").onclick=clearCode;
    el.querySelectorAll("[data-att]").forEach(tr=>tr.onclick=()=>openTrace(tr.dataset.att));
  }
  function openTrace(id){ if(window.fixedMapOpenTrace) return window.fixedMapOpenTrace(id); alert("Trace modal lives in the SDA map page (fixed-map.js) — load it to open attempt "+id); }

  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.qr={ label:"QR codes", sub:"referral orders · consent", render };
})();
