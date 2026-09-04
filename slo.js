/* SLA page — SLO attainment + error budgets per journey, and vendor/integration health. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  const tv=(n,fb)=>{const v=getComputedStyle(document.documentElement).getPropertyValue(n).trim();return v||fb;};
  let vendWin=24;
  const pct=v=> v==null?"—":(v*100).toFixed(1)+"%";
  const statusColor=s=> s==='met'?"#16a34a":s==='at_risk'?"#d97706":s==='breached'?"#dc2626":"#94a3b8";
  const VLABEL={activation:"Activation (BSS)",semati:"Semati provisioning",nafath:"Nafath (Absher)",eligibility:"Eligibility (CITC)",change_plan:"Plan change"};

  function sparkSvg(vals,target){
    if(!vals||!vals.filter(v=>v!=null).length) return `<div class="rl" style="padding:8px 0">no data</div>`;
    const W=200,H=36,n=vals.length;
    const x=i=>(i/(Math.max(1,n-1)))*W, y=v=>H-2-(v*(H-4));
    let d="",started=false; vals.forEach((v,i)=>{ if(v==null)return; d+=(started?"L":"M")+x(i).toFixed(1)+","+y(v).toFixed(1)+" "; started=true; });
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:36px">
      <line x1="0" y1="${y(target).toFixed(1)}" x2="${W}" y2="${y(target).toFixed(1)}" stroke="${tv('--muted','#94a3b8')}" stroke-dasharray="3 3" stroke-width="1"/>
      <path d="${d}" fill="none" stroke="#2563eb" stroke-width="1.6"/></svg>`;
  }

  async function render(){
    const host=$("#view-slo"); if(!host) return;
    host.innerHTML=`<div class="panel">
      <h2>Service levels &amp; vendor health</h2>
      <div class="sub">SLO attainment and error budgets per journey, plus live partner/integration health — read from rollups, so it's instant.</div>
      <div id="sloCards" class="slo-grid" style="margin-top:14px"></div>
      <h2 style="margin-top:24px">Vendor &amp; integration health</h2>
      <div style="display:flex;gap:8px;align-items:center;margin:6px 0 12px">
        <span class="rl">Window</span>
        <div class="segsel" id="vendWin"><button data-h="24" class="${vendWin===24?'on':''}">24h</button><button data-h="168" class="${vendWin===168?'on':''}">7d</button><button data-h="720" class="${vendWin===720?'on':''}">30d</button></div>
      </div>
      <div id="vendBoard"></div>
      <h2 style="margin-top:24px">Anomaly detection</h2>
      <div class="sub">Live signals vs each journey's seasonal baseline (hour-of-week median, robust z-score) — catches spikes &amp; drops a fixed threshold would miss.</div>
      <div id="anomBoard" style="margin-top:10px"></div>
    </div>`;
    $("#vendWin").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ vendWin=Number(b.dataset.h); $("#vendWin").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); loadVendors(); }));
    loadSlos(); loadVendors(); loadAnomalies();
  }

  async function loadAnomalies(){
    const box=$("#anomBoard"); if(!box) return; box.innerHTML=`<div class="sub">Scanning baseline…</div>`;
    let d; try{ d=await api("/api/anomalies"); }catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const list=d.anomalies||[];
    if(!list.length){ box.innerHTML=`<div class="okbox">No anomalies — every journey is within its seasonal band.</div>`; return; }
    const sevC=s=>s==='P1'?"#dc2626":s==='P2'?"#d97706":"#2563eb";
    box.innerHTML=list.map(a=>{
      const arrow=a.direction==='up'?"▲":"▼"; const c=sevC(a.severity);
      return `<div class="anom-row" style="border-left:3px solid ${c}">
        <span class="anom-sev" style="background:${c}">${esc(a.severity)}</span>
        <span class="anom-arrow" style="color:${c}">${arrow} ${Math.abs(a.score).toFixed(1)}σ</span>
        <span class="anom-text">${esc(a.text)}</span>
      </div>`;
    }).join("");
  }

  async function loadSlos(){
    const box=$("#sloCards"); if(!box) return; box.innerHTML=`<div class="sub" style="grid-column:1/-1">Loading service levels…</div>`;
    let d; try{ d=await api("/api/slo"); }catch(e){
      // hidden root tier: the server answers 403 {error:'restricted'} — show a clean panel, not an error banner
      if(/^restricted$/i.test(e.message||"")){ const host=$("#view-slo"); if(host) host.innerHTML=`<div class="panel" style="text-align:center;padding:34px 20px">
        <div style="font-size:26px">🔒</div>
        <h2 style="margin:8px 0 4px">Restricted</h2>
        <div class="sub">The SLA page is limited to the platform owner.</div></div>`; return; }
      box.innerHTML=`<div class="albanner" style="grid-column:1/-1">${esc(e.message)}</div>`; return; }
    const slos=d.slos||[];
    if(!slos.length){ box.innerHTML=`<div class="okbox" style="grid-column:1/-1">No SLO targets yet.</div>`; return; }
    const canEdit=window.opsCan&&window.opsCan('editRules');
    box.innerHTML=slos.map(s=>{
      const c=statusColor(s.status);
      const bp=s.budgetPct==null?0:Math.max(0,Math.min(1,s.budgetPct));
      const budColor=s.budgetPct==null?"#94a3b8":s.budgetPct<=0?"#dc2626":s.budgetPct<0.25?"#d97706":"#16a34a";
      return `<div class="slo-card" style="border-top:3px solid ${c}">
        <div class="slo-h"><b>${esc(s.label)}</b><span class="slo-status" style="color:${c}">${esc(s.status.replace('_',' '))}</span></div>
        <div class="slo-att" style="color:${c}">${pct(s.attainment)}</div>
        <div class="rl">target ${pct(s.target)} · ${s.window_days}d · ${(s.total||0).toLocaleString()} events ${canEdit?`<button class="slo-edit" data-slo="${esc(s.journey)}" data-t="${s.target}" data-w="${s.window_days}" title="Edit target" style="border:none;background:none;cursor:pointer;color:var(--blue)">✎</button>`:''}</div>
        <div class="slo-spark">${sparkSvg(s.spark,s.target)}</div>
        <div class="rl" style="margin-top:6px">Error budget</div>
        <div class="slo-budget"><span style="width:${Math.round(bp*100)}%;background:${budColor}"></span></div>
        <div class="rl">${s.budgetRemaining>=0?`${s.budgetRemaining.toLocaleString()} of ${s.allowed.toLocaleString()} failures left`:`<span style="color:#dc2626">over budget by ${Math.abs(s.budgetRemaining).toLocaleString()}</span>`}</div>
      </div>`;
    }).join("");
    box.querySelectorAll(".slo-edit").forEach(b=>b.addEventListener("click",async()=>{
      const cur=Math.round(Number(b.dataset.t)*1000)/10;
      const v=prompt(`Target success % for "${b.dataset.slo}" (drives KPI colors + NOC banner):`, cur); if(v==null) return;
      const num=Number(v); if(!(num>0&&num<=100)){ alert("Enter a percentage between 0 and 100."); return; }
      const wv=prompt("Window (days):", b.dataset.w); if(wv==null) return; const wd=Number(wv);
      try{ await api("/api/slo/targets/"+encodeURIComponent(b.dataset.slo),{method:"PUT",body:JSON.stringify({target:num/100, window_days:(wd>0?Math.round(wd):undefined)})}); loadSlos(); }
      catch(e){ alert("Save failed: "+e.message); }
    }));
  }

  async function loadVendors(){
    const box=$("#vendBoard"); if(!box) return; box.innerHTML=`<div class="sub">Loading vendor health…</div>`;
    let d; try{ d=await api("/api/vendors?window="+vendWin); }catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const row=(name,rate,total)=>{ const c=rate==null?"#94a3b8":rate>=0.95?"#16a34a":rate>=0.85?"#d97706":"#dc2626";
      return `<div class="vend-row"><span class="vend-name">${esc(name)}</span><div class="vend-bar"><span style="width:${rate==null?0:Math.round(rate*100)}%;background:${c}"></span></div><span class="vend-rate" style="color:${c}">${pct(rate)}</span><span class="vend-vol rl">${(total||0).toLocaleString()}</span></div>`; };
    const grp=(title,rows,fn)=> (rows&&rows.length)?`<div class="vend-grp"><h5>${title}</h5>${rows.map(fn).join("")}</div>`:'';
    const html =
      grp("Payment gateways", d.paymentVendors, v=>row(v.vendor||"—", v.rate, v.total)) +
      grp("Couriers", d.couriers, v=>row(v.vendor||"—", v.rate, v.total)) +
      grp("Integrations", d.integrations, v=>row(VLABEL[v.journey]||v.journey, v.rate, v.total));
    box.innerHTML = html || `<div class="okbox">No vendor activity in the window.</div>`;
  }

  // SLA lives in the Settings gear menu (no nav tab) — activate its view directly,
  // mirroring window.openWorkbench: deactivate all tabs + views, clear the gear/opsBar, then render.
  window.openSla=()=>{
    const v=$("#view-slo"); if(!v) return;
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.remove("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    v.classList.add("active");
    render();
  };
  document.addEventListener("themechange",()=>{ if($("#view-slo")&&$("#view-slo").classList.contains("active")) render(); });
  document.addEventListener("opsdatarefresh",()=>{ if($("#view-slo")&&$("#view-slo").classList.contains("active")) render(); });
})();
