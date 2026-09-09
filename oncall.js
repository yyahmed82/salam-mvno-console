/* On-call view — a phone-optimized incident snapshot: big status, key KPIs, open incidents, live anomalies and data
 * freshness. Single column, large tap targets. One renderer, TWO businesses (9 Sep 2026):
 *   #oncall        → Mobile (MVNO): /api/noc status, payment / activation success, errors today, orders, Mobile alerts, anomalies
 *   #fixed-oncall  → Fixed: status from the open Fixed alerts, attempts 24 h / conversion / Nafath fail / open errors, Fixed alerts
 * The same snapshot is also embedded as the "On-call" tab of each Alerts page (window.renderOncallInto(host, seg)),
 * so a team lead can share #oncall or #fixed-oncall with the on-call phone and the same content sits under Alerts. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = window.API_BASE;
  const api=p=>window.fetch(API+p,{headers:{"Content-Type":"application/json"}}).then(r=>{ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); });
  const num=v=>v==null?"—":Number(v).toLocaleString();
  const pct=v=>v==null?"—":(v*100).toFixed(1)+"%";
  const colorRate=(r,t)=> r==null?"inherit": r>=t?"#16a34a": r>=t-0.02?"#d97706":"#dc2626";
  const sevC=s=>s==='P1'?"#dc2626":s==='P2'?"#d97706":"#2563eb";
  let SEG="mvno";

  function activate(seg){
    SEG = seg==="fixed" ? "fixed" : "mvno";
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    document.querySelectorAll(".navtab").forEach(t=>t.classList.remove("active"));
    const hm=$("#helpMenu"); if(hm) hm.classList.remove("open");
    const v=$("#view-oncall"); if(v) v.classList.add("active");
    render($("#view-oncall"), SEG, true);
  }
  window.openOncall=activate;

  /* incident rows + freshness are shared; the status card and the KPI row differ per business */
  function incidentsHtml(incs, go){
    return incs.length ? incs.map(a=>`<div class="oc-item" data-go="${go}?id=${a.id}" style="border-left-color:${sevC(a.severity)}"><div class="oc-t">${esc(a.severity||'')} · ${esc(a.name||a.metric_key||'incident')}${a.sn_number?` <span class="mono" style="font-size:11px;color:var(--muted)">🎫 ${esc(a.sn_number)}</span>`:''}</div><div class="oc-d">${esc(a.team||'')}${a.ack_by?` · ack ${esc(String(a.ack_by).split('@')[0])}`:' · <b style="color:#dc2626">unacknowledged</b>'}</div></div>`).join("")
      : `<div class="oc-item" style="border-left-color:var(--good);cursor:default"><div class="oc-t">No open incidents ✅</div></div>`;
  }
  function statusFromAlerts(incs){
    const p1=incs.filter(a=>a.severity==='P1').length, p2=incs.filter(a=>a.severity==='P2').length;
    if(p1) return { st:'incident', headline:`${p1} P1 · ${incs.find(a=>a.severity==='P1').name} — page on-call` };
    if(p2) return { st:'degraded', headline:`${p2} P2 open · ${incs.find(a=>a.severity==='P2').name}` };
    return { st:'ok', headline: incs.length ? `${incs.length} low-severity incident(s) open` : 'No open incidents' };
  }

  async function renderMobile(host, standalone){
    let noc,anoms,home,alerts;
    try{ [noc,anoms,home,alerts]=await Promise.all([
      api("/api/noc"), api("/api/anomalies").catch(()=>({anomalies:[]})), api("/api/home?hours=24"), api("/api/alerts?status=open&segment=mvno").catch(()=>({alerts:[]}))
    ]); }
    catch(e){ host.innerHTML=`<div class="oncall"><div class="albanner">${esc(e.message||'load failed')}</div></div>`; return; }
    const st=(noc&&noc.status)||"ok"; const word=st==='ok'?'All good':st==='degraded'?'Degraded':'Incident';
    const t=(home&&home.targets)||{};
    const payC=colorRate(home&&home.payRate, t.payment||0.95), actC=colorRate(home&&home.actRate, t.activation||0.98);
    const incs=((alerts&&alerts.alerts)||[]).slice(0,8);
    const an=((anoms&&anoms.anomalies)||[]).slice().sort((a,b)=>Math.abs(b.score||0)-Math.abs(a.score||0)).slice(0,6);
    const fr=(noc&&noc.freshness)||{}, oldest=fr.oldest;
    let h=`<div class="oncall">${badge('MOBILE · MVNO','var(--green,#0e9f5a)',standalone)}
      <div class="oc-status ${st}"><div class="oc-word">${word}</div><div class="oc-head">${esc((noc&&noc.headline)||'')}</div></div>
      <div class="oc-kpis">
        <div class="oc-kpi"><b style="color:${payC}">${pct(home&&home.payRate)}</b><span>PAYMENT SUCCESS</span></div>
        <div class="oc-kpi"><b style="color:${actC}">${pct(home&&home.actRate)}</b><span>ACTIVATION SUCCESS</span></div>
        <div class="oc-kpi"><b style="color:${(home&&home.errorsToday)?'#dc2626':'inherit'}">${num(home&&home.errorsToday)}</b><span>ERRORS TODAY</span></div>
        <div class="oc-kpi"><b>${num(home&&home.orders)}</b><span>ORDERS</span></div>
      </div>
      <div class="oc-sec">OPEN INCIDENTS (${incs.length})</div>`+incidentsHtml(incs,"alerts");
    if(an.length) h+=`<div class="oc-sec">ANOMALIES</div>`+an.map(a=>`<div class="oc-item" data-go="sla" style="border-left-color:${sevC(a.severity)}"><div class="oc-t">${esc(a.severity||'')} ${a.direction==='up'?'▲':'▼'} ${Math.abs(a.score||0).toFixed(1)}σ</div><div class="oc-d">${esc(a.text||'')}</div></div>`).join("");
    if(oldest) h+=`<div class="oc-sec">DATA FRESHNESS</div><div class="oc-item" style="cursor:default"><div class="oc-d">oldest source <b>${esc(oldest.name)}</b> · ${oldest.lagMin}m behind</div></div>`;
    h+=`</div>`;
    host.innerHTML=h; wire(host);
  }

  async function renderFixed(host, standalone){
    let sum,alerts;
    try{ [sum,alerts]=await Promise.all([ api("/api/fixed/summary?range=24h").catch(e=>({error:e.message})), api("/api/alerts?status=open&segment=fixed").catch(()=>({alerts:[]})) ]); }
    catch(e){ host.innerHTML=`<div class="oncall"><div class="albanner">${esc(e.message||'load failed')}</div></div>`; return; }
    const incs=((alerts&&alerts.alerts)||[]).slice(0,8);
    const s=statusFromAlerts(incs); const word=s.st==='ok'?'All good':s.st==='degraded'?'Degraded':'Incident';
    const k=(sum&&sum.kpis)||{}, naf=((sum&&sum.integrations)||{}).nafath||{}, fr=(sum&&sum.freshness)||{};
    const openErr=((sum&&sum.errors)||[]).reduce((a,e)=>a+Number(e.open||0),0);
    const conv=k.attempts?Number(k.conversion||0)/100:null;
    let h=`<div class="oncall">${badge('FIXED · FTTH · 5G · APP','var(--purple,#7c3aed)',standalone)}
      <div class="oc-status ${s.st}"><div class="oc-word">${word}</div><div class="oc-head">${esc(s.headline)}</div></div>
      <div class="oc-kpis">
        <div class="oc-kpi"><b>${num(k.attempts)}</b><span>ATTEMPTS · 24 H</span></div>
        <div class="oc-kpi"><b style="color:${colorRate(conv,0.5)}">${conv==null?'—':(k.conversion+'%')}</b><span>CONVERSION</span></div>
        <div class="oc-kpi"><b style="color:${naf.total?(naf.failRate>25?'#dc2626':naf.failRate>10?'#d97706':'#16a34a'):'inherit'}">${naf.total?naf.failRate+'%':'—'}</b><span>NAFATH FAIL · ${num(naf.total)} CHECKS</span></div>
        <div class="oc-kpi"><b style="color:${openErr?'#dc2626':'inherit'}">${num(openErr)}</b><span>OPEN ERRORS · ALL CHANNELS</span></div>
      </div>
      ${sum&&sum.error?`<div class="albanner">Fixed KPIs unavailable: ${esc(sum.error)}</div>`:''}
      <div class="oc-sec">OPEN INCIDENTS (${incs.length})</div>`+incidentsHtml(incs,"fixed-alerts");
    const topErr=((sum&&sum.errors)||[]).slice(0,3);
    if(topErr.length) h+=`<div class="oc-sec">TOP ERROR CATEGORIES · 24 H</div>`+topErr.map(e=>`<div class="oc-item" data-go="fixed?tab=errors" style="border-left-color:${e.open>1000?'#dc2626':e.open>100?'#d97706':'#2563eb'}"><div class="oc-t">${num(e.open)} open · ${esc(e.category)}</div><div class="oc-d">${num(e.n)} events${e.last_at?' · last '+new Date(new Date(e.last_at).getTime()+3*3600e3).toISOString().slice(11,16)+' KSA':''}</div></div>`).join("");
    h+=`<div class="oc-sec">DATA FRESHNESS</div><div class="oc-item" style="cursor:default"><div class="oc-d">${fr.stale?'<b style="color:#d97706">source may be stale</b> · ':''}watcher ${fr.lag_min==null?'—':fr.lag_min+'m ago'}${fr.newest_attempt?' · newest attempt '+new Date(new Date(fr.newest_attempt).getTime()+3*3600e3).toISOString().slice(11,16)+' KSA':''}</div></div></div>`;
    host.innerHTML=h; wire(host);
  }

  const badge=(txt,color,standalone)=>standalone?`<div class="rl" style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:800;letter-spacing:.08em;font-size:11px;color:${color}">${txt}</span><span style="color:var(--muted);font-size:11px">on-call snapshot · ${new Date(Date.now()+3*3600e3).toISOString().slice(11,16)} KSA</span></div>`:'';
  function wire(host){ host.querySelectorAll("[data-go]").forEach(el=>el.addEventListener("click",()=>{ if(window.setConsoleHash) window.setConsoleHash(el.dataset.go); })); }

  async function render(host, seg, standalone){
    if(!host) return;
    if(!host.innerHTML) host.innerHTML=`<div class="oncall"><div class="sub">Loading on-call snapshot…</div></div>`;
    return seg==="fixed" ? renderFixed(host, standalone) : renderMobile(host, standalone);
  }
  window.renderOncallInto=(host,seg)=>render(host, seg, false);

  const btn=$("#hmOncall"); if(btn) btn.addEventListener("click",()=>{
    // a Fixed-only user gets the Fixed snapshot; everyone else the Mobile one (Fixed › Alerts › On-call is one tap away)
    const biz=((window.opsSession&&window.opsSession().me)||{}).business||"both";
    const h=biz==="fixed"?"fixed-oncall":"oncall";
    if(window.setConsoleHash) window.setConsoleHash(h); else activate(biz==="fixed"?"fixed":"mvno"); });
  document.addEventListener("opsdatarefresh",()=>{ const v=$("#view-oncall"); if(v&&v.classList.contains("active")) render(v, SEG, true); });
})();
