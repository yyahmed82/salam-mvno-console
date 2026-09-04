/* Dealers & QR/partner dashboards — dependency-free SVG charts. Uses window.opsApi. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = (location.protocol==="file:") ? "http://localhost:4600" : (location.pathname.startsWith("/digital-console") ? "/digital-console" : "");
  const st={scope:"dealers",window:168,data:null};
  const pct=v=> v==null?"—":(v*100).toFixed(1)+"%";
  function api(p){ return (window.opsFetch||fetch)(API+p).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}); }

  const healthColor=v=> v==null?"#94a3b8": v>=0.9?"#16a34a": v>=0.7?"#d97706":"#dc2626";
  function healthCard(name,h){
    const v=h&&h.health;
    return `<div class="hcard"><div style="display:flex;justify-content:space-between"><span class="hname">${esc(name)}</span><b style="color:${healthColor(v)}">${pct(v)}</b></div>
      <div class="hbar"><i style="width:${v==null?0:Math.round(v*100)}%;background:${healthColor(v)}"></i></div>
      <div style="font-size:10.5px;color:var(--muted);margin-top:5px">${h?h.ok:0} ok / ${h?h.total:0}</div></div>`;
  }
  function barChart(rows, label, valueKey, subKey){
    if(!rows||!rows.length) return `<div class="sub">No data in window.</div>`;
    const max=Math.max(...rows.map(r=>r[valueKey]||0),1);
    return `<div class="bars">`+rows.map(r=>{
      const w=Math.round((r[valueKey]||0)/max*100);
      const sub=subKey&&r[subKey]!=null?` · ${pct(r[subKey])}`:'';
      return `<div class="barrow"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r[label]||'—')}</span>
        <span class="bt" style="width:${w}%"></span><span class="bn">${r[valueKey]}${sub}</span></div>`;
    }).join("")+`</div>`;
  }
  function lineChart(points){
    if(!points||!points.length) return `<div class="sub">No data.</div>`;
    const W=680,H=120,pad=6;
    const cre=points.map(p=>p.created), don=points.map(p=>p.completed);
    const max=Math.max(...cre,...don,1);
    const x=i=>pad+(i/(Math.max(1,points.length-1)))*(W-2*pad);
    const y=v=>H-pad-(v/max)*(H-2*pad);
    const path=arr=>arr.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:130px" preserveAspectRatio="none">
      <path d="${path(cre)}" fill="none" stroke="#2563eb" stroke-width="1.8"/>
      <path d="${path(don)}" fill="none" stroke="#16a34a" stroke-width="1.8"/>
    </svg>
    <div style="font-size:10.5px;color:var(--muted);margin-top:2px"><span style="color:#2563eb">■</span> created &nbsp; <span style="color:#16a34a">■</span> completed &nbsp;·&nbsp; ${points.length} days</div>`;
  }
  const kpi=(b,label,cls)=>`<div class="dkpi"><b>${b}</b><span>${esc(label)}</span></div>`;

  async function load(){
    const body=$("#dashBody"); body.innerHTML=`<div class="sub">Loading…</div>`;
    let d;
    try{ d=await api(`/api/dashboard/${st.scope}?window=${st.window}`); st.data=d; }
    catch(e){ body.innerHTML=`<div class="albanner">Dashboards need the console API. ${esc(e.message)}</div>`; return; }
    $("#dashNow").textContent = d.now? ("as of "+KT.dt(d.now)+" KSA") : "real-time";
    if(st.scope==="dealers"){
      const k=d.kpis||{};
      body.innerHTML =
        `<div class="dgrid">
          ${kpi(k.attempts||0,'ATTEMPTS')}${kpi(k.completed||0,'COMPLETED')}${kpi(k.activated||0,'ACTIVATED')}
          ${kpi(pct(k.conversion),'CONVERSION')}${kpi(k.active_dealers||0,'ACTIVE DEALERS')}${kpi(k.stalled||0,'STALLED')}
        </div>
        <div class="dpanel"><h4>ORDERS OVER TIME</h4>${lineChart(d.ordersOverTime)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="dpanel"><h4>TOP DEALERS (by completed)</h4>${barChart(d.topDealers,'name','completed','conversion')}</div>
          <div class="dpanel"><h4>PLAN MIX</h4>${barChart(d.planMix,'plan','count')}</div>
        </div>
        <div class="dpanel"><h4>INTEGRATION HEALTH</h4><div class="health">
          ${healthCard('Nafath',d.integrationHealth.nafath)}
          ${healthCard('Semati',d.integrationHealth.semati)}
          ${healthCard('Eligibility',d.integrationHealth.eligibility)}
          ${healthCard('Activation (BSS)',d.integrationHealth.activation)}
        </div></div>`;
    } else {
      const k=d.kpis||{}, p=d.partner||{};
      body.innerHTML =
        `<div class="dgrid">
          ${kpi(k.attempts||0,'QR/POSA ATTEMPTS')}${kpi(k.completed||0,'COMPLETED')}${kpi(k.activated||0,'ACTIVATED')}
          ${kpi(pct(k.conversion),'CONVERSION')}${kpi(k.qr_posa||0,'QR-POSA')}${kpi(k.posa||0,'POSA')}
        </div>
        <div class="dgrid" style="margin-top:12px">
          ${kpi(p.attempts||0,'PARTNER ATTEMPTS')}${kpi(p.completed||0,'PARTNER COMPLETED')}${kpi(pct(p.conversion),'PARTNER CONVERSION')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="dpanel"><h4>SOURCE LEADERBOARD (utm_source)</h4>${barChart(d.leaderboard,'source','completed','conversion')}</div>
          <div class="dpanel"><h4>QR/POSA PLAN MIX</h4>${barChart(d.planMix,'plan','count')}</div>
        </div>
        <div class="sub" style="margin-top:8px">Note: per-QR consent map is intentionally excluded; this uses the non-geo source leaderboard.</div>`;
    }
  }

  function exportData(){
    if(!st.data){ return; }
    const rows = st.scope==='dealers' ? (st.data.topDealers||[]) : (st.data.leaderboard||[]);
    if(window.opsExport) window.opsExport(rows, `dashboard_${st.scope}_${st.window}h`, $("#dashExport"));
  }

  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="dashboards") b.addEventListener("click",load); });
  document.addEventListener("themechange",()=>{ if($("#view-dashboards").classList.contains("active")) load(); });
  document.addEventListener("opsdatarefresh",()=>{ if($("#view-dashboards").classList.contains("active")) load(); });
  $("#dashScope").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ st.scope=b.dataset.scope; $("#dashScope").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); load(); }));
  $("#dashWindow").addEventListener("change",()=>{ st.window=Number($("#dashWindow").value); load(); });
  $("#dashExport").addEventListener("click",exportData);
})();
