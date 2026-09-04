/* On-call view (#oncall) — a phone-optimized incident snapshot: big status, key KPIs,
 * open incidents, live anomalies, and data freshness. Single column, large tap targets. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = (location.protocol==="file:") ? "http://localhost:4600" : (location.pathname.startsWith("/digital-console") ? "/digital-console" : "");
  const api=p=>window.fetch(API+p,{headers:{"Content-Type":"application/json"}}).then(r=>{ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); });
  const num=v=>v==null?"—":Number(v).toLocaleString();
  const pct=v=>v==null?"—":(v*100).toFixed(1)+"%";
  const colorRate=(r,t)=> r==null?"inherit": r>=t?"#16a34a": r>=t-0.02?"#d97706":"#dc2626";
  const sevC=s=>s==='P1'?"#dc2626":s==='P2'?"#d97706":"#2563eb";

  function activate(){
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    document.querySelectorAll(".navtab").forEach(t=>t.classList.remove("active"));
    const hm=$("#helpMenu"); if(hm) hm.classList.remove("open");
    const v=$("#view-oncall"); if(v) v.classList.add("active");
    render();
  }
  window.openOncall=activate;

  async function render(){
    const host=$("#view-oncall"); if(!host) return;
    if(!host.innerHTML) host.innerHTML=`<div class="oncall"><div class="sub">Loading on-call snapshot…</div></div>`;
    let noc,anoms,home,alerts;
    try{ [noc,anoms,home,alerts]=await Promise.all([
      api("/api/noc"), api("/api/anomalies").catch(()=>({anomalies:[]})), api("/api/home?hours=24"), api("/api/alerts?status=open").catch(()=>({alerts:[]}))
    ]); }
    catch(e){ host.innerHTML=`<div class="oncall"><div class="albanner">${esc(e.message||'load failed')}</div></div>`; return; }
    const st=(noc&&noc.status)||"ok"; const word=st==='ok'?'All good':st==='degraded'?'Degraded':'Incident';
    const t=(home&&home.targets)||{};
    const payC=colorRate(home&&home.payRate, t.payment||0.95), actC=colorRate(home&&home.actRate, t.activation||0.98);
    const incs=((alerts&&alerts.alerts)||[]).slice(0,8);
    const an=((anoms&&anoms.anomalies)||[]).slice().sort((a,b)=>Math.abs(b.score||0)-Math.abs(a.score||0)).slice(0,6);
    const fr=(noc&&noc.freshness)||{}, oldest=fr.oldest;
    let h=`<div class="oncall">
      <div class="oc-status ${st}"><div class="oc-word">${word}</div><div class="oc-head">${esc((noc&&noc.headline)||'')}</div></div>
      <div class="oc-kpis">
        <div class="oc-kpi"><b style="color:${payC}">${pct(home&&home.payRate)}</b><span>PAYMENT SUCCESS</span></div>
        <div class="oc-kpi"><b style="color:${actC}">${pct(home&&home.actRate)}</b><span>ACTIVATION SUCCESS</span></div>
        <div class="oc-kpi"><b style="color:${(home&&home.errorsToday)?'#dc2626':'inherit'}">${num(home&&home.errorsToday)}</b><span>ERRORS TODAY</span></div>
        <div class="oc-kpi"><b>${num(home&&home.orders)}</b><span>ORDERS</span></div>
      </div>
      <div class="oc-sec">OPEN INCIDENTS (${incs.length})</div>`;
    h+= incs.length ? incs.map(a=>`<div class="oc-item" data-go="alerts" style="border-left-color:${sevC(a.severity)}"><div class="oc-t">${esc(a.severity||'')} · ${esc(a.name||a.metric_key||'incident')}</div><div class="oc-d">${esc(a.team||'')}</div></div>`).join("")
      : `<div class="oc-item" style="border-left-color:#16a34a;cursor:default"><div class="oc-t">No open incidents ✅</div></div>`;
    if(an.length) h+=`<div class="oc-sec">ANOMALIES</div>`+an.map(a=>`<div class="oc-item" data-go="sla" style="border-left-color:${sevC(a.severity)}"><div class="oc-t">${esc(a.severity||'')} ${a.direction==='up'?'▲':'▼'} ${Math.abs(a.score||0).toFixed(1)}σ</div><div class="oc-d">${esc(a.text||'')}</div></div>`).join("");
    if(oldest) h+=`<div class="oc-sec">DATA FRESHNESS</div><div class="oc-item" style="cursor:default"><div class="oc-d">oldest source <b>${esc(oldest.name)}</b> · ${oldest.lagMin}m behind</div></div>`;
    h+=`</div>`;
    host.innerHTML=h;
    host.querySelectorAll("[data-go]").forEach(el=>el.addEventListener("click",()=>{ if(window.setConsoleHash) window.setConsoleHash(el.dataset.go); }));
  }

  const btn=$("#hmOncall"); if(btn) btn.addEventListener("click",()=>{ if(window.setConsoleHash) window.setConsoleHash("oncall"); else activate(); });
  document.addEventListener("opsdatarefresh",()=>{ const v=$("#view-oncall"); if(v&&v.classList.contains("active")) render(); });
})();
