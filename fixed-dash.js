/* fixed-dash.js — Fixed › Dashboards (Dealers / QR codes). Replicates the prod Operations Console
 * "Dashboards" page (apps/web/src/components/Dashboards.tsx + QrDashboards.tsx) on the unified hub:
 * Dealers/QR toggle · chip rows (outcome · plan · role · region | consent) · Export CSV/JSON ·
 * 6 KPI tiles · orders-over-time stacked bars · outcome donut · top dealers · plan mix · region performance ·
 * integration health. Data: /api/fixed/dash/{dealers,qr,export}. Inline SVG only, no chart library. */
(function(){
  "use strict";
  const FX=()=>window.FX;
  const OUTCOME_CHIPS=[["COMPLETED","Completed"],["IN_PROGRESS","In progress"],["STALLED","Stalled (error)"],["CANCELLED","Cancelled"],["EXPIRED","Expired"]];
  const PLAN_CHIPS=[["ftth","FTTH"],["fttb","FTTB"],["fiveGWhiteLabel","5G HomeFI"],["fiveGFWA","5G FWA"],["promoters","Lead"]];
  const ROLE_CHIPS=[["ADMIN","Admin"],["ACTIVATOR","Activator"],["PROMOTER","Promoter"]];
  const REGIONS=["Central","Western","Eastern","Southern","Northern"];
  const COLOR={completed:"#3fb950",stalled:"#d29922",cancelled:"#f85149",expired:"#6e7681",in_progress:"#4d8af0",other:"#94a3b8",blue:"#2563eb",accent:"#0e9f5a"};
  const consentColor=r=>r>=.6?"#3fb950":r>=.3?"#d29922":"#f85149";
  // page state survives re-renders (hub range/channel changes) but is not persisted
  const st={ view:"dealers", outcome:new Set(), plan:new Set(), role:new Set(), region:new Set(), consent:"all", busy:null };

  const qsDims=()=>{ const p=[];
    if(st.outcome.size) p.push("outcome="+[...st.outcome].join(","));
    if(st.plan.size) p.push("plan="+[...st.plan].join(","));
    if(st.view==="dealers"){ if(st.role.size) p.push("role="+[...st.role].join(",")); if(st.region.size) p.push("region="+encodeURIComponent([...st.region].join(","))); }
    else if(st.consent!=="all") p.push("consent="+st.consent);
    return p.length?"&"+p.join("&"):""; };
  const anyFilter=()=>st.outcome.size+st.plan.size+(st.view==="dealers"?st.role.size+st.region.size:0)>0||(st.view==="qr"&&st.consent!=="all");

  const chipBtn=(cls,val,label,on,small)=>`<button class="${cls}" data-v="${val}" style="cursor:pointer;font:inherit;font-size:${small?"11px":"12px"};font-weight:700;padding:${small?"3px 10px":"5px 13px"};border:1px solid ${on?"var(--green,#0e9f5a)":"var(--line)"};border-radius:999px;background:${on?"var(--green,#0e9f5a)":"var(--card,#fff)"};color:${on?"#fff":"inherit"}">${label}</button>`;
  const fg=(label,html)=>`<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span class="rl" style="font-size:10px;letter-spacing:.8px;color:var(--muted);font-weight:800;text-transform:uppercase;margin-right:2px">${label}</span>${html}</div>`;
  const tile=(label,v,color)=>`<div class="stat" style="min-width:140px;flex:1"><b style="font-size:22px;${color?`color:${color}`:""}">${v}</b><span>${label}</span></div>`;

  /* ---- inline SVG charts ---- */
  function stackedBars(series, esc){
    if(!series.length) return `<div style="color:var(--muted);font-size:12px;padding:20px 0">no orders in this window</div>`;
    const W=Math.max(320,series.length*14), H=150, pb=18, max=Math.max(1,...series.map(d=>d.completed+d.other));
    const bw=Math.max(3,(W/series.length)-3);
    const bars=series.map((d,i)=>{ const x=i*(W/series.length); const ho=(d.other/max)*(H-pb), hc=(d.completed/max)*(H-pb);
      return `<g><title>${esc(d.date)}: ${d.completed} completed, ${d.other} other</title><rect x="${x.toFixed(1)}" y="${(H-pb-ho-hc).toFixed(1)}" width="${bw.toFixed(1)}" height="${ho.toFixed(1)}" fill="${COLOR.other}" rx="1"/><rect x="${x.toFixed(1)}" y="${(H-pb-hc).toFixed(1)}" width="${bw.toFixed(1)}" height="${hc.toFixed(1)}" fill="${COLOR.completed}" rx="1"/></g>`; }).join("");
    const step=Math.max(1,Math.ceil(series.length/8));
    const labels=series.map((d,i)=>(i%step===0||i===series.length-1)?`<text x="${(i*(W/series.length)+bw/2).toFixed(1)}" y="${H-4}" font-size="9" text-anchor="middle" fill="var(--muted)">${esc(d.date.slice(5))}</text>`:"").join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="height:150px;display:block;font-family:inherit">${bars}${labels}</svg>
      <div style="display:flex;gap:14px;margin-top:6px;color:var(--muted);font-size:11px"><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${COLOR.completed};margin-right:4px"></i>completed</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${COLOR.other};margin-right:4px"></i>other</span></div>`;
  }
  function donut(mix, esc){
    const segs=[["completed",mix.completed],["stalled",mix.stalled],["cancelled",mix.cancelled],["expired",mix.expired]];
    if(mix.in_progress) segs.push(["in_progress",mix.in_progress]);
    const total=segs.reduce((s,[,n])=>s+n,0)||1;
    const cx=64,cy=64,R=58,r=34; let a0=-Math.PI/2; const paths=[];
    const pol=(rad,a)=>[cx+rad*Math.cos(a),cy+rad*Math.sin(a)];
    const nonzero=segs.filter(([,n])=>n>0);
    if(nonzero.length===1) paths.push(`<circle cx="${cx}" cy="${cy}" r="${(R+r)/2}" fill="none" stroke="${COLOR[nonzero[0][0]]}" stroke-width="${R-r}"/>`);
    else for(const [o,n] of segs){ if(!n) continue; const a1=a0+(n/total)*Math.PI*2, L=a1-a0>Math.PI?1:0;
      const [x0,y0]=pol(R,a0),[x1,y1]=pol(R,a1),[i1,j1]=pol(r,a1),[i0,j0]=pol(r,a0);
      paths.push(`<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${L} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${i1.toFixed(2)} ${j1.toFixed(2)} A ${r} ${r} 0 ${L} 0 ${i0.toFixed(2)} ${j0.toFixed(2)} Z" fill="${COLOR[o]}"><title>${o} ${n}</title></path>`); a0=a1; }
    return `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 128 128" width="128" height="128">${paths.join("")}<text x="64" y="68" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor">${total===1&&!nonzero.length?0:total}</text></svg>
      <div style="font-size:12px">${segs.map(([o,n])=>`<div style="margin:5px 0"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${COLOR[o]};margin-right:6px"></i>${esc(o)} — <b>${n.toLocaleString("en-US")}</b> (${Math.round(n/total*100)}%)</div>`).join("")}</div></div>`;
  }
  const hbar=(w,color)=>`<span style="display:inline-block;vertical-align:middle;height:8px;width:${Math.max(2,w)}px;max-width:100%;background:${color};border-radius:4px;margin-right:6px"></span>`;
  const barRow=(label,w,color,val)=>`<div style="display:grid;grid-template-columns:150px 1fr auto;gap:8px;align-items:center;font-size:12px;margin:5px 0"><span class="rl" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span><span style="height:8px;border-radius:4px;background:var(--line);overflow:hidden"><span style="display:block;height:100%;width:${Math.max(2,w)}%;background:${color}"></span></span><span style="white-space:nowrap">${val}</span></div>`;

  /* ---- shell ---- */
  function shell(host, fx, inner){
    const {esc}=fx;
    const chips=`<div style="display:flex;flex-direction:column;gap:6px;margin:10px 0 14px">
      ${fg("Outcome",OUTCOME_CHIPS.map(([v,l])=>chipBtn("fd-o",v,l,st.outcome.has(v),true)).join(""))}
      ${fg("Plan",PLAN_CHIPS.map(([v,l])=>chipBtn("fd-p",v,l,st.plan.has(v),true)).join(""))}
      ${st.view==="dealers"?fg("Role",ROLE_CHIPS.map(([v,l])=>chipBtn("fd-r",v,l,st.role.has(v),true)).join(""))+fg("Region",REGIONS.map(r=>chipBtn("fd-g",r,r,st.region.has(r),true)).join(""))
        :fg("Consent",chipBtn("fd-c","consented","Consented",st.consent==="consented",true)+chipBtn("fd-c","noconsent","No consent",st.consent==="noconsent",true))}
      ${anyFilter()?`<div><button id="fdClear" class="btn" style="font-size:11px;padding:3px 10px">Clear ✕</button></div>`:""}</div>`;
    host.innerHTML=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${chipBtn("fd-v","dealers","Dealers",st.view==="dealers")}${chipBtn("fd-v","qr","QR codes",st.view==="qr")}
        <span class="rl" style="font-size:10.5px;color:var(--muted);margin-left:6px">${(()=>{const ch=localStorage.getItem("fixed_channel")||"";if(st.view==="dealers"){if(ch==="salamhome")return "🏠 Salam Home app journeys (beta data, stage 1) · Role / Region chips are dealer-only and do not apply here";if(ch==="epurchase")return "e-purchase / QR journeys · Role chips do not apply";return "SDA dealer channel · same definitions as /operations-console → Dashboards";}return "e-purchase journeys carrying a referral (QR) code";})()}</span>
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="btn fd-x" data-f="csv" style="font-size:11.5px;padding:5px 12px" ${st.busy?"disabled":""}>${st.busy==="csv"?"Exporting…":"Export CSV"}</button>
          <button class="btn fd-x" data-f="json" style="font-size:11.5px;padding:5px 12px" ${st.busy?"disabled":""}>${st.busy==="json"?"Exporting…":"Export JSON"}</button></span></div>
      ${chips}<div id="fdBody">${inner}</div>`;
    const tog=(set,v)=>{ set.has(v)?set.delete(v):set.add(v); render(host,fx); };
    host.querySelectorAll(".fd-v").forEach(b=>b.onclick=()=>{ st.view=b.dataset.v; render(host,fx); });
    host.querySelectorAll(".fd-o").forEach(b=>b.onclick=()=>tog(st.outcome,b.dataset.v));
    host.querySelectorAll(".fd-p").forEach(b=>b.onclick=()=>tog(st.plan,b.dataset.v));
    host.querySelectorAll(".fd-r").forEach(b=>b.onclick=()=>tog(st.role,b.dataset.v));
    host.querySelectorAll(".fd-g").forEach(b=>b.onclick=()=>tog(st.region,b.dataset.v));
    host.querySelectorAll(".fd-c").forEach(b=>b.onclick=()=>{ st.consent=st.consent===b.dataset.v?"all":b.dataset.v; render(host,fx); });
    const clr=host.querySelector("#fdClear"); if(clr) clr.onclick=()=>{ st.outcome.clear(); st.plan.clear(); st.role.clear(); st.region.clear(); st.consent="all"; render(host,fx); };
    host.querySelectorAll(".fd-x").forEach(b=>b.onclick=()=>doExport(host,fx,b.dataset.f));
  }

  async function doExport(host,fx,format){
    if(st.busy) return; st.busy=format; render(host,fx,true);
    try{
      const base=(window.API_BASE||window.CONSOLE_BASE||"");
      const r=await fetch(`${base}/api/fixed/dash/export?which=${st.view}&format=${format}&${fx.qs()}${qsDims()}`,{headers:{"X-Console-Role":localStorage.getItem("cons_role")||"",
        "X-Console-User":localStorage.getItem("cons_email")||""}});
      if(!r.ok){ const j=await r.json().catch(()=>({})); throw new Error(j.error||("HTTP "+r.status)); }
      const blob=await r.blob(); const href=URL.createObjectURL(blob); const a=document.createElement("a");
      a.href=href; a.download=`fixed-${st.view}-export.${format}`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
    }catch(e){ alert("Export failed — "+e.message); }
    finally{ st.busy=null; render(host,fx,true); }
  }

  /* ---- render ---- */
  let lastData=null, lastKey="";
  async function render(host, fx, keep){
    const {esc,fmt,card,tbl}=fx;
    const key=st.view+"|"+fx.qs()+qsDims();
    if(!(keep&&lastData&&lastKey===key)){
      shell(host,fx,`<div style="padding:24px;text-align:center;color:var(--muted)">${window.salamLoader?window.salamLoader("Loading dashboards…"):"Loading dashboards…"}</div>`);
      try{ lastData=await fx.api(`/api/fixed/dash/${st.view}?${fx.qs()}${qsDims()}`); lastKey=key; }
      catch(e){ shell(host,fx,`<div class="albanner" style="border-left:4px solid #dc2626;padding:14px 16px"><b>Could not load dashboards</b> — ${esc(e.message)}</div>`); return; }
    }
    const d=lastData;
    if(!d.kpis.attempts){
      shell(host,fx,`<div class="topo-card" style="text-align:center;padding:40px 20px;max-width:420px;margin:24px auto"><h4 style="margin:0 0 8px">No data for this period</h4><div style="color:var(--muted);margin-bottom:14px;font-size:12.5px">No order attempts match the current range, channel and filters.</div>${anyFilter()?`<button id="fdClear2" class="btn">Clear filters</button>`:""}</div>`);
      const b=host.querySelector("#fdClear2"); if(b) b.onclick=()=>{ st.outcome.clear(); st.plan.clear(); st.role.clear(); st.region.clear(); st.consent="all"; render(host,fx); };
      return;
    }
    const k=d.kpis, mix=d.outcomeMix, plans=[...d.planMix].sort((a,b)=>b.count-a.count), maxp=Math.max(1,...plans.map(p=>p.count));
    const planCard=card(st.view==="qr"?"Plan mix (QR)":"Plan mix",plans.map(p=>barRow(esc(p.plan),p.count/maxp*100,COLOR.blue,`<b>${fmt(p.count)}</b>`)).join("")||`<div style="color:var(--muted);font-size:12px">—</div>`);
    const tsCard=card(st.view==="qr"?"QR orders over time (completed vs other)":"Orders over time (completed vs other)",stackedBars(d.ordersOverTime,esc),"per KSA day");
    let html;
    if(st.view==="dealers"){
      const maxc=Math.max(1,...d.topDealers.map(x=>x.completed)), maxRc=Math.max(1,...d.regionPerformance.map(r=>r.completed));
      const I=d.integrations, nafMax=Math.max(1,...Object.values(I.nafath.breakdown));
      html=`<div class="topo-stats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          ${tile("ATTEMPTS",fmt(k.attempts))}${tile("COMPLETED",fmt(k.completed),COLOR.completed)}${tile("CONVERSION",k.conversion+"%")}${tile("ACTIVE DEALERS",fmt(k.activeDealers))}${tile("STALLED",fmt(k.stalled),COLOR.stalled)}${tile("CANCELLED",fmt(k.cancelled),COLOR.cancelled)}</div>
        <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:12px">
          <div style="grid-column:span 7">${tsCard}</div>
          <div style="grid-column:span 5">${card("Outcome mix",donut(mix,esc))}</div>
          <div style="grid-column:span 7">${card("Top dealers by completed orders",tbl(["DEALER","ROLE","CITY","COMPLETED","CONV."],d.topDealers.map(x=>[esc(x.name||"—"),esc(x.role),esc(x.city||"—"),`${hbar(x.completed/maxc*90,COLOR.accent)}${fmt(x.completed)}`,x.conv+"%"])))}</div>
          <div style="grid-column:span 5">${planCard}</div>
          <div style="grid-column:span 12">${card("Region performance",d.regionPerformance.map(r=>barRow(esc(r.region),r.completed/maxRc*100,COLOR.accent,`<b>${fmt(r.completed)}</b> / ${fmt(r.total)} <small style="color:var(--muted)">(${r.conv}%)</small>`)).join("")||`<div style="color:var(--muted);font-size:12px">no region data</div>`,"completed / attempts (dealer region)")}</div>
          <div style="grid-column:span 12">${card("Integration health",`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px">
            <div><div style="color:var(--muted);font-size:11px;margin-bottom:6px">Nafath / Semati (5G)</div>
              <div style="display:flex;gap:18px;align-items:baseline;flex-wrap:wrap"><div><b style="font-size:22px;color:${I.nafath.failRate>20?COLOR.cancelled:"inherit"}">${I.nafath.failRate}%</b><small style="color:var(--muted)"> failure rate</small></div>
                <div><b style="font-size:18px;color:${COLOR.cancelled}">${fmt(I.nafath.mobileExistsCount)}</b><small style="color:var(--muted)"> MOBILE_EXISTS</small></div>
                <div><b style="font-size:18px">${fmt(I.nafath.withOutcome)}</b><small style="color:var(--muted)"> / ${fmt(I.nafath.total)} attempts</small></div></div>
              <div style="margin-top:10px">${Object.entries(I.nafath.breakdown).map(([o,v])=>`<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px"><span style="width:110px;color:var(--muted)">${esc(o)}</span><span style="height:8px;width:${Math.round(v/nafMax*160)}px;background:${o==="COMPLETED"?COLOR.completed:COLOR.cancelled};border-radius:4px"></span><b>${fmt(v)}</b></div>`).join("")}</div>
              <div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:6px">Semati provisioning failures (FAILED + MOBILE_EXISTS): <b>${fmt(I.semati.failed)}</b> · ${I.semati.failRate}%</div></div>
            <div><div style="color:var(--muted);font-size:11px;margin-bottom:6px">Manafith (dealer validation)</div>
              <div style="display:flex;gap:18px;align-items:baseline;flex-wrap:wrap"><div><b style="font-size:22px;color:${I.manafith.deniedRate>10?COLOR.cancelled:"inherit"}">${I.manafith.deniedRate}%</b><small style="color:var(--muted)"> denied rate</small></div>
                <div><b style="font-size:18px;color:${COLOR.completed}">${fmt(I.manafith.allowed)}</b><small style="color:var(--muted)"> allowed</small></div>
                <div><b style="font-size:18px;color:${COLOR.cancelled}">${fmt(I.manafith.denied)}</b><small style="color:var(--muted)"> denied</small></div></div>
              ${I.topDealersByFailure.length?`<div style="margin-top:12px"><div style="color:var(--muted);font-size:11px;margin-bottom:4px">Top dealers by integration failures</div>${I.topDealersByFailure.map(x=>`<div style="display:flex;justify-content:space-between;font-size:11px;margin:2px 0"><span>${esc(x.name||"(unknown)")}</span><b style="color:${COLOR.cancelled}">${fmt(x.failures)}</b></div>`).join("")}</div>`:""}
              ${I.byRegion.length?`<div style="margin-top:12px"><div style="color:var(--muted);font-size:11px;margin-bottom:4px">By region · Nafath fail % · Manafith denied %</div>${I.byRegion.slice(0,8).map(x=>`<div style="display:flex;justify-content:space-between;font-size:11px;margin:2px 0"><span>${esc(x.region)}</span><span class="mono">${x.nafathFailureRate}% <small style="color:var(--muted)">(${fmt(x.nafathTotal)})</small> · ${x.deniedRate}% <small style="color:var(--muted)">(${fmt(x.dvTotal)})</small></span></div>`).join("")}</div>`:""}</div>
          </div>`)}</div>
        </div>`;
    } else {
      const maxc=Math.max(1,...d.leaderboard.map(x=>x.completed)), total=Object.values(mix).reduce((s,n)=>s+n,0)||1, maxRc=Math.max(1,...d.byRegion.map(r=>r.completed));
      html=`<div class="topo-stats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          ${tile("QR CODES",fmt(k.qrCodes))}${tile("ATTEMPTS",fmt(k.attempts))}${tile("COMPLETED",fmt(k.completed),COLOR.completed)}${tile("CONVERSION",k.conversion+"%")}${tile("CONSENT RATE",Math.round(k.consentRate*100)+"%",consentColor(k.consentRate))}${tile("STALLED",fmt(mix.stalled),COLOR.stalled)}</div>
        <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:12px">
          <div style="grid-column:span 7">${tsCard}</div>
          <div style="grid-column:span 5">${planCard}</div>
          <div style="grid-column:span 7">${card("QR leaderboard · consent rate",tbl(["QR CODE","ORDERS","COMPLETED","CONV.","CONSENT"],d.leaderboard.map(x=>[`<span class="mono">${esc(x.referralCode)}</span>`,fmt(x.orders),`${hbar(x.completed/maxc*90,COLOR.accent)}${fmt(x.completed)}`,x.conv+"%",`${hbar(x.consentRate*90,consentColor(x.consentRate))}${Math.round(x.consentRate*100)}%`]))+`<div style="margin-top:8px;color:var(--muted);font-size:11px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${COLOR.completed};margin-right:5px"></i>completed · ${Math.round(mix.completed/total*100)}% of outcomes</div>`,"top 12 by orders")}</div>
          <div style="grid-column:span 5">${card("Outcome mix (QR)",donut(mix,esc))}</div>
          <div style="grid-column:span 12">${card("By region (QR)",d.byRegion.map(r=>barRow(esc(r.region),r.completed/maxRc*100,COLOR.accent,`<b>${fmt(r.completed)}</b> / ${fmt(r.total)} <small style="color:var(--muted)">(${r.conv}%)</small>`)).join("")||`<div style="color:var(--muted);font-size:12px">no region data</div>`,"dealer region of the referring code")}</div>
        </div>`;
    }
    shell(host,fx,html);
  }

  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.dash={ label:"Dashboards", sub:"KPIs & trends", render:(host,fx)=>render(host,fx||FX()) };
})();
