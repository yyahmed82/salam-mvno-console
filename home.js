/* Home dashboard — personal landing: dynamic greeting, today's global KPIs across all
 * journeys, and the user's chosen Analytics sections (reorderable, saved per user). */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API=(location.protocol==="file:")?"http://localhost:4600":"";
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  const sess=()=> (window.opsSession? window.opsSession():{});
  const num=v=> v==null?"—":Number(v).toLocaleString();
  const pct=v=> v==null?"—":(v*100).toFixed(1)+"%";
  let homeRangeH=24;
  let homeTodayH=24;   // intra-day sub-range (hours) — only used when "Today" is selected
  let homePlanType=""; // "" | postpaid | prepaid — global Plan type filter for the dashboard charts
  function applyPlanType(){ window.ANA_GLOBAL_FILTERS = homePlanType ? { plan_type: homePlanType } : {}; }
  // role-view templates for the Customize modal (section keys → ordered dashboard set)
  const FLOW_KEY='__order_flow';   // pseudo-section: the onboarding order-status flow tree
  const ROLE_PRESETS={
    "L1 · NOC":    [FLOW_KEY,"overview","integrations","funnel_newsim","funnel_mnp","payments"],
    "L2 · Debug":  ["error_codes","integrations","eligibility","delivery","payments"],
    "Business":    [FLOW_KEY,"growth_resellers","growth_campaigns","overview","funnel_newsim","funnel_mnp","plan_change","channels"]
  };
  // dashboards available on the home page = the analytics boards + the order-flow pseudo-section
  function homeDashList(){ const a=window.anaDashboards?window.anaDashboards():[]; return [
    {key:FLOW_KEY,name:'Order status flow',builtin:true,_flow:true},
    {key:'growth_resellers',name:'Resellers',builtin:true,_growth:'resellers'},
    {key:'growth_campaigns',name:'Campaigns',builtin:true,_growth:'campaigns'},
    ...a]; }

  // KSA = UTC+3, no DST. Start-of-today (00:00 KSA) as a real UTC instant.
  function ksaMidnight(){ const s=new Date(Date.now()+3*3600e3); s.setUTCHours(0,0,0,0); return s.getTime()-3*3600e3; }
  // "last N hours, but never before 00:00 KSA today" → {from,to} ISO. to = next hour boundary so the axis reaches now.
  function todayWindow(h){
    const to=new Date(); to.setUTCMinutes(0,0,0); to.setUTCHours(to.getUTCHours()+1);
    const from=Math.max(ksaMidnight(), to.getTime()-h*3600e3);
    return {from:new Date(from).toISOString(), to:to.toISOString()};
  }
  let homeYesterday=false;   // "Yesterday" range mode (its own [00:00,24:00) KSA window)
  let homeCustom=null;       // {from,to,label} — explicit from→to date range (overrides the segment ranges)
  // the window currently driving BOTH the KPI strip and the panels
  function currentRange(){
    if(homeCustom){ return {from:homeCustom.from, to:homeCustom.to, hours:Math.max(1,Math.round((new Date(homeCustom.to)-new Date(homeCustom.from))/3600e3))}; }
    if(homeYesterday){ const ys=ksaMidnight()-86400e3, ye=ksaMidnight(); return {hours:24, from:new Date(ys).toISOString(), to:new Date(ye).toISOString()}; }
    return (homeRangeH===24)
      ? Object.assign({hours:homeTodayH}, todayWindow(homeTodayH))
      : {hours:homeRangeH, from:null, to:null};
  }
  function rangeLabel(){
    if(homeCustom) return homeCustom.label||"custom range";
    if(homeYesterday) return "yesterday";
    if(homeRangeH!==24) return homeRangeH>=720?"30d":"7d";
    return homeTodayH===1?"last hour":("last "+homeTodayH+"h");
  }

  // ---- greeting ----
  function ksaHour(){ return new Date(Date.now()+3*3600e3).getUTCHours(); }
  function greetWord(){ const h=ksaHour(); return h<12?"Good morning":h<17?"Good afternoon":h<21?"Good evening":"Working late"; }
  // real wall-clock date in KSA — ISO ("2026-07-12") and pretty with weekday ("Sunday · 2026-07-12")
  function ksaISO(){ return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Riyadh",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
  function ksaToday(){ const wd=new Date().toLocaleDateString("en-GB",{timeZone:"Asia/Riyadh",weekday:"long"}); return `${wd} · ${ksaISO()}`; }
  const JOURNEYS=["new-SIM onboarding","MNP port-in","eSIM swap","plan change","Nafath verification","SIM delivery","activation","checkout & payment","eligibility"];
  const LINES=[
    n=>`Welcome back — want to see how the ${n} journey is doing today?`,
    n=>`Here's your snapshot. Curious how ${n} is trending right now?`,
    n=>`Good to have you back. ${n[0].toUpperCase()+n.slice(1)} is worth a look today.`,
    n=>`All caught up? The ${n} flow is one to keep an eye on today.`,
    n=>`Let's dig in — start with ${n} if you're not sure where to look.`
  ];
  function firstName(){ const me=sess().me; const nm=(me&&me.name)|| (sess().email? sess().email.split("@")[0]:"there"); return String(nm).split(/\s+/)[0]; }
  function renderGreeting(){
    const g=$("#homeGreeting"); if(!g) return;
    const j=JOURNEYS[Math.floor(Math.random()*JOURNEYS.length)];
    const line=LINES[Math.floor(Math.random()*LINES.length)](j);
    g.innerHTML=`<h1>${esc(greetWord())}, ${esc(firstName())}</h1><p>${esc(line)}</p>`;
    if($("#homeDay")) $("#homeDay").textContent=ksaToday();   // real today, not the data-clock
  }

  // ---- global today KPIs ----
  async function renderKpis(){
    const box=$("#homeKpis"); if(!box) return;
    const firstPaint=!box.querySelector(".home-kpi");
    if(firstPaint) box.innerHTML=`<div class="sub">Loading numbers…</div>`;
    else box.style.opacity=".5";                    // keep cards in place; just dim while updating
    const R=currentRange();
    const qs=(R.from&&R.to)?`?from=${encodeURIComponent(R.from)}&to=${encodeURIComponent(R.to)}`:`?hours=${R.hours||24}`;
    if($("#homeKpiRange")) $("#homeKpiRange").textContent="· "+rangeLabel();
    let d; try{ d=await api("/api/home"+qs); }catch(e){ box.style.opacity=""; if(firstPaint) box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    // #homeDay is the REAL today (set in renderGreeting via ksaToday()); never overwrite with the data-clock.
    // If the replica's latest data lags behind today, show a subtle "data as of" note instead.
    if($("#homeDay")) $("#homeDay").textContent=ksaToday();
    if($("#homeDay") && d.ksaDay && d.ksaDay!==ksaISO()){
      $("#homeDay").innerHTML=`${ksaToday()} <span class="rl" style="font-weight:700;color:var(--amber)">⚠ no data yet for today — latest is ${esc(d.ksaDay)} (replica behind)</span>`;
    }
    // color by the SLA target (green ≥ target · amber within 2pts · red below), not absolute — and show the sample size
    const rateSub=(r,target,sample)=>{ if(r==null) return ""; const t=target||0.95; const c=r>=t?"#16a34a":r>=t-0.02?"#d97706":"#dc2626";
      return `<span style="color:${c};font-weight:700" title="SLA target ${pct(t)}">${pct(r)}</span>${sample!=null?` <span class="rl" style="font-weight:600">· n=${num(sample)}</span>`:''}`; };
    // "vs previous equal window" delta chip
    const deltaChip=(cur,prv)=>{ if(cur==null||prv==null||prv===0) return ""; const dd=(cur-prv)/prv; const up=dd>=0; const c=up?"#16a34a":"#dc2626";
      return ` <span class="kdelta" style="color:${c}" title="vs previous ${rangeLabel()}">${up?'▲':'▼'} ${Math.abs(dd*100).toFixed(0)}%</span>`; };
    const sparkSvg=(arr)=>{ if(!arr||arr.length<2) return ""; const w=64,h=16,mx=Math.max(...arr,1);
      const pts=arr.map((v,i)=>`${(i/(arr.length-1)*w).toFixed(1)},${(h-(v/mx)*(h-2)-1).toFixed(1)}`).join(' ');
      return `<svg class="kspark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".5"/></svg>`; };
    const sp=d.spark||{}, pv=d.prev||{};
    const card=(label,value,sub,accent,spark,cur,prv)=>`<div class="home-kpi ${accent||''}"><div class="kv">${value}${deltaChip(cur,prv)}</div><div class="kl">${esc(label)}</div>${sub?`<div class="ks">${sub}</div>`:''}${sparkSvg(spark)}</div>`;
    const nt=(d.nafOk||0)+(d.nafPending||0)+(d.nafFailed||0);
    const nafSub=nt?`<span class="rl" style="font-weight:600">${Math.round((d.nafOk||0)/nt*100)}% done · ${Math.round((d.nafPending||0)/nt*100)}% pending · ${Math.round((d.nafFailed||0)/nt*100)}% fail</span>`:"";
    box.innerHTML=
      card("Orders", num(d.orders), null, "accent", sp.orders, d.orders, pv.orders)+
      card("Checkouts", num(d.checkouts), null, null, sp.checkouts, d.checkouts, pv.checkouts)+
      card("Payments OK", num(d.paidOk), rateSub(d.payRate, d.targets&&d.targets.payment, (d.paidOk||0)+(d.paidFail||0)), null, sp.paidOk, d.paidOk, pv.paidOk)+
      card("Activation calls (BSS)", num(d.actOk), rateSub(d.actRate, d.targets&&d.targets.activation, (d.actOk||0)+(d.actFail||0)), null, sp.actOk, d.actOk, pv.actOk)+
      card("Nafath completed", num(d.nafOk), nafSub, null, sp.nafOk, d.nafOk, pv.nafOk)+
      card("Delivery requests", num(d.deliveries), null, null, sp.deliveries, d.deliveries, pv.deliveries)+
      card("Change Plans", num(d.planOk), null, null, sp.planOk, d.planOk, pv.planOk)+
      card("Errors", num(d.errorsToday), (d.errorsToday? `<span style="color:#dc2626;font-weight:700">needs a look →</span>`:``), null, sp.errors);
    box.style.opacity="";
    // quick action: Errors card → Troubleshoot
    const cards=box.querySelectorAll(".home-kpi"); const errCard=cards[cards.length-1];
    if(errCard){ errCard.style.cursor="pointer"; errCard.title="Open Troubleshoot"; errCard.onclick=()=>{ if(window.setConsoleHash) window.setConsoleHash("troubleshoot"); }; }
  }

  // ---- chosen analytics sections ----
  function savedSections(){ const me=sess().me; return (me&&me.dashboard&&Array.isArray(me.dashboard.sections))?me.dashboard.sections.slice():[]; }
  async function renderDash(){
    const grid=$("#homeDash"); if(!grid) return;
    applyPlanType();   // keep the global Plan type overlay in sync before panels query
    const firstPaint=!grid.querySelector(".home-dash-title");
    if(firstPaint) grid.innerHTML=`<div class="sub" style="grid-column:span 12">Loading dashboards…</div>`;
    else grid.style.opacity=".5";                   // keep panels in place; dim while the new window loads
    let all=[]; try{ all=await window.anaEnsureLoaded(); }catch(e){}
    all=homeDashList();
    let sections=savedSections().filter(k=>all.find(d=>d.key===k));
    if(!sections.length){ sections=[FLOW_KEY]; if(all.find(d=>d.key==="overview")) sections.push("overview"); }   // default view
    if(!sections.length){ grid.style.opacity=""; grid.innerHTML=`<div class="home-empty">No dashboards available yet.</div>`; return; }
    // "Today" → intra-day same-day window (clamped at 00:00 KSA); 7d/30d → plain hours window.
    const R=currentRange();
    // build the new panels OFF-DOM, then swap them in atomically → no teardown flash on refresh
    const next=document.createElement("div");
    for(const key of sections){
      const d=all.find(x=>x.key===key); if(!d) continue;
      next.appendChild(el("div","home-dash-title",`${esc(d.name||key)}<span class="ln"></span>`));
      const holder=el("div");
      next.appendChild(holder);
      if(d._flow){ holder.style.cssText="grid-column:span 12"; await renderFlow(holder); }
      else if(d._growth){ holder.style.cssText="grid-column:span 12"; await renderGrowthSection(holder, d._growth, R); }
      else { holder.style.cssText="grid-column:span 12;display:grid;grid-template-columns:repeat(12,1fr);gap:12px"; await window.anaRenderDashboard(holder, key, R); }
    }
    grid.replaceChildren(...next.childNodes);
    grid.style.opacity="";
  }

  // ---- NOC status banner (computed health + incidents + worst signal + data freshness) ----
  async function renderNoc(){
    const box=$("#nocBanner"); if(!box) return;
    let d; try{ d=await api("/api/noc"); }catch(e){ box.style.display="none"; return; }
    box.style.display="flex"; box.className="noc "+(d.status||"ok");
    const inc=d.incidents||{}, fr=d.freshness||{}, oldest=fr.oldest;
    const freshTitle=(fr.sources||[]).map(s=>`${s.name}: ${s.ksa||'—'}${s.lagMin!=null?` (${s.lagMin}m)`:''}`).join("\n");
    const chip=[`<span>Incidents <b>${inc.open||0}</b>${inc.p1?` · <b style="color:#dc2626">${inc.p1} P1</b>`:inc.p2?` · <b style="color:#d97706">${inc.p2} P2</b>`:''}</span>`];
    if(oldest) chip.push(`<span class="noc-fresh" title="${esc(freshTitle)}">Data · oldest <b>${esc(oldest.name)}</b> ${oldest.lagMin}m</span>`);
    const word=d.status==='ok'?'All good':d.status==='degraded'?'Degraded':'Incident';
    box.innerHTML=`<span class="noc-dot"></span><span class="noc-h">${word}</span><span class="noc-sub">${esc(d.headline||'')}</span><span class="noc-chip">${chip.join("")}</span>`;
    box.style.cursor=d.status==='ok'?'default':'pointer';
    box.onclick=d.status==='ok'?null:()=>{ if(window.setConsoleHash) window.setConsoleHash('alerts'); };
    renderStaleBanner(oldest);
  }

  // ---- loud, actionable staleness banner: the one silent failure that quietly makes every
  //      KPI/alert/pill on this console wrong. Prominent above the NOC strip when the replica lags. ----
  function renderStaleBanner(oldest){
    const STALE_WARN=30, STALE_CRIT=90;   // minutes
    const host=$("#nocBanner"); if(!host||!host.parentNode) return;
    let sb=document.getElementById("staleBanner");
    if(oldest && oldest.lagMin!=null && oldest.lagMin>=STALE_WARN){
      if(!sb){ sb=document.createElement("div"); sb.id="staleBanner"; host.parentNode.insertBefore(sb, host); }
      const crit=oldest.lagMin>=STALE_CRIT;
      const bg=crit?"#fee2e2":"#fef3c7", fg=crit?"#991b1b":"#92400e", bd=crit?"#dc2626":"#d97706";
      sb.style.cssText=`display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:10px 14px;border-radius:10px;border-left:4px solid ${bd};background:${bg};color:${fg};font-size:13px;cursor:pointer`;
      sb.innerHTML=`<span style="font-size:16px">⚠</span>`+
        `<span style="flex:1"><b>Data may be stale</b> — ${esc(oldest.name)} is <b>${oldest.lagMin}m</b> behind. `+
        `Prod-sync is delayed or down; every figure below reflects the last successful sync, not live prod.</span>`+
        `<span style="font-weight:700;white-space:nowrap">Check sync health →</span>`;
      sb.title="Open Settings → Sync to check the prod-sync job and run a health self-check";
      sb.onclick=()=>{ if(window.setConsoleHash) window.setConsoleHash("settings-sync"); };
    } else if(sb){ sb.style.display="none"; }
  }

  // ---- live anomaly badges (seasonal-baseline spikes/drops the engine flags, before they even become tickets) ----
  async function renderAnoms(){
    const box=$("#nocAnoms"); if(!box) return;
    let d; try{ d=await api("/api/anomalies"); }catch(e){ box.style.display="none"; return; }
    const list=(d.anomalies||[]).slice().sort((a,b)=>Math.abs(b.score||0)-Math.abs(a.score||0)).slice(0,5);
    if(!list.length){ box.style.display="none"; box.innerHTML=""; return; }
    const sevC=s=>s==='P1'?"#dc2626":s==='P2'?"#d97706":"#2563eb";
    box.style.display="flex";
    box.innerHTML=list.map(a=>{ const c=sevC(a.severity); const arrow=a.direction==='up'?"▲":"▼";
      return `<span class="abadge" style="border-left-color:${c}" title="${esc(a.text||'')}"><span class="asev" style="background:${c}">${esc(a.severity||'')}</span><span class="aar" style="color:${c}">${arrow} ${Math.abs(a.score||0).toFixed(1)}σ</span><span class="atx">${esc(a.text||'')}</span></span>`;
    }).join("");
    box.querySelectorAll(".abadge").forEach(b=>b.addEventListener("click",()=>{ if(window.setConsoleHash) window.setConsoleHash('sla'); }));
  }

  // ---- Onboarding order-status flow tree (New SIM / MNP → eligibility → payment → SIM type → delivery) ----
  const FLOW_LAYOUT=[
    {id:'total',col:0,row:2,kind:'ok',big:true},
    {id:'elig_pass',col:1,row:1,label:'Eligibility Pass',kind:'ok'},
    {id:'elig_fail',col:1,row:3,label:'Eligibility Fail',kind:'ok'},
    {id:'total_payment',col:2,row:1,label:'Total Payment',kind:'ok'},
    {id:'pay_success',col:3,row:1,label:'Success Payment',kind:'ok'},
    {id:'pay_pending',col:3,row:3,label:'Pending Payment',kind:'warn'},
    {id:'pay_fail',col:3,row:4,label:'Fail Payment',kind:'bad'},
    {id:'esim',col:4,row:0,label:'eSIM',kind:'ok'},
    {id:'esim_activated',col:7,row:0,label:'Activated',kind:'ok'},
    {id:'esim_not_activated',col:7,row:1,label:'Not Activated',kind:'bad'},
    {id:'physical',col:4,row:2,label:'Physical SIM',kind:'ok'},
    {id:'assigned',col:5,row:2,label:'Assigned for Delivery',kind:'ok'},
    {id:'not_assigned',col:5,row:3,label:'Not Assigned',kind:'bad'},
    {id:'delivered',col:6,row:2,label:'Delivered',kind:'ok'},
    {id:'not_delivered',col:6,row:3,label:'Not Delivered',kind:'bad'},
    {id:'phys_activated',col:7,row:2,label:'Activated',kind:'ok'},
    {id:'phys_not_activated',col:7,row:3,label:'Not Activated',kind:'bad'}
  ];
  const FLOW_EDGES=[['total','elig_pass'],['total','elig_fail'],['elig_pass','total_payment'],['total_payment','pay_success'],['total_payment','pay_pending'],['total_payment','pay_fail'],['pay_success','esim'],['pay_success','physical'],['esim','esim_activated'],['esim','esim_not_activated'],['physical','assigned'],['physical','not_assigned'],['assigned','delivered'],['assigned','not_delivered'],['delivered','phys_activated'],['delivered','phys_not_activated']];
  const FLOW_KC={ok:{f:'#e7f8ef',s:'#10b981',t:'#065f46'},warn:{f:'#fdf3dc',s:'#f59e0b',t:'#92400e'},bad:{f:'#fdeceb',s:'#ef4444',t:'#991b1b'}};
  const FLOW_KC_MNP={ok:{f:'#e9f1fe',s:'#3b82f6',t:'#1e40af'},warn:{f:'#fdf3dc',s:'#f59e0b',t:'#92400e'},bad:{f:'#fdeceb',s:'#ef4444',t:'#991b1b'}};
  const kcFor=(kind,laneKey)=>((laneKey==='mnp'?FLOW_KC_MNP:FLOW_KC)[kind]||FLOW_KC.ok);
  const F_COLW=156,F_BOXW=112,F_BOXH=46,F_ROWH=70,F_PADX=18,F_LANEH=396,F_PHASEH=34; // F_PHASEH = header band for phase labels
  // customer-journey phases (visual grouping only) — x-ranges derived from column indices
  const FLOW_PHASES=[
    {num:'1',label:'ONBOARDING · BSS + GOV',c0:0,c1:1,ac:'#6366f1'},   // New SIM/MNP orders → Semati/Nafath eligibility
    {num:'2',label:'PAYMENTS',c0:2,c1:3,ac:'#14b8a6'},                 // total payment → success/pending/fail
    {num:'3',label:'ACTIVATION & DELIVERY',c0:4,c1:7,ac:'#8b5cf6'}     // eSIM/physical → activated/assigned → delivered → activated
  ];
  function flowPhaseZones(H){
    const pad=10, zy=4, zh=H-8;                                        // full height of both lanes + header band
    const zx=p=>({x0:F_PADX+p.c0*F_COLW-pad, x1:F_PADX+p.c1*F_COLW+F_BOXW+pad});
    const parts=FLOW_PHASES.map((p,i)=>{
      const {x0,x1}=zx(p), w=x1-x0;
      const band=`<rect x="${x0}" y="${zy}" width="${w}" height="${zh}" rx="14" fill="${p.ac}" fill-opacity="0.05" stroke="${p.ac}" stroke-opacity="0.14" stroke-width="1"/>`;
      const label=`<text class="flow-phase-t" x="${x0+w/2}" y="${zy+18}" text-anchor="middle" fill="${p.ac}">${p.num} · ${esc(p.label)}</text>`;
      let div=''; if(i>0){ const prev=zx(FLOW_PHASES[i-1]), xm=(prev.x1+x0)/2;
        div=`<line x1="${xm}" y1="${zy+10}" x2="${xm}" y2="${zy+zh-10}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 6"/>`; }
      return div+band+label;
    }).join("");
    return `<g pointer-events="none">${parts}</g>`;                    // backmost layer; never intercepts node clicks
  }
  let _flowWin=null;
  const flowXY=(n,yOff)=>{ const x=F_PADX+n.col*F_COLW,y=yOff+44+n.row*F_ROWH; return {x,y,cx:x+F_BOXW/2,cy:y+F_BOXH/2}; };
  function flowLaneSvg(lane,yOff){
    const map={}; FLOW_LAYOUT.forEach(n=>map[n.id]=n); const pos=id=>flowXY(map[id],yOff);
    const LW=F_PADX*2+6*F_COLW+F_BOXW+10;                       // same width math as flowPanel
    const lc=lane.key==='mnp'?'#3b82f6':'#10b981';              // lane accent (blue = MNP, green = New SIM)
    const laneBg=`<rect x="2" y="${yOff-2}" width="${LW-4}" height="${F_LANEH-14}" rx="14" fill="${lc}" fill-opacity="0.035" stroke="${lc}" stroke-opacity="0.22" stroke-width="1"/>`;
    const laneT=`<circle cx="${F_PADX+5}" cy="${yOff+18.5}" r="3.5" fill="${lc}"/><text class="flow-lane-t" x="${F_PADX+15}" y="${yOff+22}">${esc(lane.label)} LANE</text>`;
    const edges=FLOW_EDGES.map(([a,b],ei)=>{ const p=pos(a),ch=pos(b),x1=p.x+F_BOXW+2,y1=p.cy,x2=ch.x-2,y2=ch.cy,xm=(x1+x2)/2;
      const pid=`fe_${lane.key}_${a}_${b}`;                     // unique per lane — both lanes share one <svg>
      const track=`<path id="${pid}" class="flow-edge" stroke="${lc}" stroke-opacity="0.38" d="M${x1} ${y1} C ${xm} ${y1} ${xm} ${y2} ${x2} ${y2}"/>`;
      const dur=3.4+(ei%3)*0.6;                                 // vary speed a touch per edge
      const dots=[0,1].map(k=>{ const begin=-((ei*0.53)+(k*dur/2)); // negative begin = staggered, already mid-flight on load
        return `<circle class="flow-dot" r="2.1" fill="${lc}" fill-opacity="0.8" pointer-events="none">`
          +`<animateMotion dur="${dur.toFixed(1)}s" begin="${begin.toFixed(2)}s" repeatCount="indefinite"><mpath href="#${pid}" xlink:href="#${pid}"/></animateMotion></circle>`; }).join("");
      return track+dots; }).join("");
    const nodes=FLOW_LAYOUT.map(n=>{ const p=flowXY(n,yOff); const val=(n.id==='total')?(lane.nodes.orders||0):(lane.nodes[n.id]||0);
      const kc=kcFor(n.kind,lane.key), dim=val===0?' opacity="0.42"':'';
      const label=(n.id==='total')?(lane.label+' Orders'):n.label;
      const pct=lane.nodes.orders?Math.round(val/lane.nodes.orders*100):0;
      const w=n.big?F_BOXW+10:F_BOXW,h=n.big?F_BOXH+10:F_BOXH,bx=n.big?p.x-5:p.x,by=n.big?p.y-5:p.y;
      const inner=n.big
        ?`<text class="flow-nval" x="${p.cx}" y="${by+h/2+7}" text-anchor="middle" fill="${kc.t}" font-size="19">${val}</text>`
        :`<text class="flow-nval" x="${p.cx}" y="${by+24}" text-anchor="middle" fill="${kc.t}" font-size="16">${val}</text>`
         +`<text x="${p.cx}" y="${by+h-7}" text-anchor="middle" fill="${kc.s}" font-size="8.5" font-weight="700" letter-spacing="0.04em">${pct}%</text>`;
      return `<g class="fnode" data-lane="${lane.key}" data-node="${n.id}"${dim}><title>${esc(label)}: ${val} (${pct}% of ${esc(lane.label)})</title>`
        +`<text class="flow-nlabel" x="${p.cx}" y="${p.y-6}" text-anchor="middle">${esc(label)}</text>`
        +`<rect x="${bx}" y="${by}" width="${w}" height="${h}" rx="${n.big?12:10}" fill="${kc.f}" stroke="${kc.s}" stroke-width="1.5"/>`
        +inner+`</g>`;
    }).join("");
    return laneBg+laneT+edges+nodes;
  }
  function flowPanel(data, kpiOrders){
    const lanes=data.lanes||[]; const total=lanes.reduce((a,l)=>a+(l.nodes.orders||0),0);
    const W=F_PADX*2+7*F_COLW+F_BOXW+10, H=lanes.length*F_LANEH+10+F_PHASEH;   // extra top band for phase labels (cols 0..7)
    const recon = (kpiOrders==null)?'' : (Number(kpiOrders)===total
      ? ` · <span style="color:#16a34a;font-weight:700" title="Both count onboarding orders in this window — same definition">✓ reconciles to Orders KPI (${num(kpiOrders)})</span>`
      : ` · <span style="color:#d97706;font-weight:700" title="Same definition — any gap is a window/timing difference">Orders KPI here: ${num(kpiOrders)}</span>`);
    const ksa=iso=>{ try{ return new Date(new Date(iso).getTime()+3*3600e3).toISOString().replace('T',' ').slice(0,16); }catch(_){ return ''; } };
    const legend=`<span class="flow-legend">`
      +`<span class="lgi"><span class="dot" style="background:#10b981"></span>on track / success</span>`
      +`<span class="lgi"><span class="dot" style="background:#f59e0b"></span>pending / waiting</span>`
      +`<span class="lgi"><span class="dot" style="background:#ef4444"></span>failed / needs attention</span>`
      +`<span class="sep"></span>`
      +`<span class="lgi"><span class="dot" style="background:#10b981"></span>New SIM lane</span>`
      +`<span class="lgi"><span class="dot" style="background:#3b82f6"></span>MNP lane</span></span>`;
    return `<div class="flow-panel"><div class="flow-hd"><h3>Orders &amp; their current status</h3>`
      +`<span class="ft">Total on-boarding orders <b>${total}</b> · ${esc(ksa(data.from))} → ${esc(ksa(data.to))} KSA${recon} · click any box to drill in</span>${legend}</div>`
      +`<svg class="flow-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">${flowPhaseZones(H)}${lanes.map((l,i)=>flowLaneSvg(l,i*F_LANEH+6+F_PHASEH)).join("")}</svg></div>`;
  }
  async function renderFlow(host){
    if(!host) return;
    const R=currentRange()||{hours:24};
    let win; if(R.from&&R.to){ win={from:R.from,to:R.to}; } else { const d=new Date(); d.setUTCMinutes(0,0,0); d.setUTCHours(d.getUTCHours()+1); win={to:d.toISOString(),from:new Date(d.getTime()-(R.hours||24)*3600e3).toISOString()}; }
    _flowWin=win;
    let data; try{ data=await api(`/api/onboarding-flow?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`); }
    catch(e){ host.innerHTML=`<div class="flow-panel"><div class="albanner">${esc(e.message)}</div></div>`; return; }
    let kpiOrders=null; try{ const hk=await api(`/api/home?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`); kpiOrders=(hk&&hk.orders!=null)?hk.orders:null; }catch(_){}
    host.innerHTML=flowPanel(data, kpiOrders);
    host.querySelectorAll(".fnode").forEach(g=>g.addEventListener("click",()=>openFlowDrill(g.dataset.lane,g.dataset.node)));
  }
  const FLOW_NM={orders:'All orders',total:'All orders',elig_pass:'Eligibility pass',elig_fail:'Eligibility fail',total_payment:'Reached payment',pay_success:'Payment success',pay_pending:'Payment pending',pay_fail:'Payment failed',esim:'eSIM',esim_activated:'eSIM · activated',esim_not_activated:'eSIM · not activated',physical:'Physical SIM',assigned:'Assigned for delivery',not_assigned:'Not assigned for delivery',delivered:'Delivered',not_delivered:'Not delivered',phys_activated:'Physical · activated',phys_not_activated:'Physical · not activated'};
  async function openFlowDrill(lane,node){
    const ov=document.getElementById("txnDrawer"); if(!ov) return; ov.classList.add("open");
    const body=document.getElementById("txnDrawerBody"); const W=_flowWin||{};
    const qnode = node==='total'?'orders':node;   // the first box = all orders in the lane
    const qs=`?lane=${encodeURIComponent(lane)}&node=${encodeURIComponent(qnode)}`+((W.from&&W.to)?`&from=${encodeURIComponent(W.from)}&to=${encodeURIComponent(W.to)}`:"");
    const hd=`${lane==='mnp'?'MNP':'New SIM'} · ${FLOW_NM[node]||node}`;
    body.innerHTML=`<div class="drawer-hd"><b>${esc(hd)}</b><span class="x" id="dwXf">×</span></div><div class="tl"><div class="sub" style="padding:16px 18px">Loading orders…</div></div>`;
    document.getElementById("dwXf").onclick=()=>ov.classList.remove("open");
    let r; try{ r=await api("/api/onboarding-flow/orders"+qs); }catch(e){ body.querySelector(".tl").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const rows=r.rows||[]; const ksa=iso=>{ try{ return new Date(new Date(iso).getTime()+3*3600e3).toISOString().replace('T',' ').slice(5,16); }catch(_){ return ''; } };
    // renderList lets the Timeline drawer offer a ‹ Back that returns here (no re-fetch)
    function renderList(){
      let h=`<div class="drawer-hd"><b>${esc(hd)}</b><span class="x" id="dwXf2">×</span></div>`
        +`<div style="padding:12px 18px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)">${rows.length}${r.total>=200?'+':''} orders · ${r.unmasked?'🔓 PII visible · Super Admin':'🔒 PII masked'}</div><div class="tl">`;
      if(!rows.length) h+=`<div class="okbox">No orders at this node in the window.</div>`;
      rows.forEach(x=>{ h+=`<div class="tlitem"><span class="dot ${x.pay==='success'?'okdot':x.pay==='fail'?'faildot':'neutdot'}"></span>`
        +`<div class="src">${esc(x.mobile||'—')}</div>`
        +`<div class="dt">state ${esc(x.state||'—')} · payment ${esc(x.pay||'none')}${x.plan_id?` · plan ${esc(x.plan_id)}`:''}</div>`
        +`<div style="margin-top:6px"><button class="pill" data-tl="${esc(x.id)}" style="border-left-color:var(--blue);font-size:11px;padding:3px 9px">Timeline →</button></div>`
        +`<div class="ts">${ksa(x.at)} KSA</div></div>`; });
      h+=`</div>`; body.innerHTML=h;
      document.getElementById("dwXf2").onclick=()=>ov.classList.remove("open");
      body.querySelectorAll("[data-tl]").forEach(b=>b.addEventListener("click",()=>{ if(window.opsOpenTimeline) window.opsOpenTimeline(b.getAttribute("data-tl"), null, renderList); }));
    }
    renderList();
  }

  // ---- journey-health strip: one pill per journey, worst-of open alerts + recent errors ----
  async function renderJourneys(){
    const host=$("#homeJourneys"); if(!host) return;
    let d; try{ d=await api('/api/journey-health'); }catch(e){ host.style.display='none'; return; }
    const js=d.journeys||[]; if(!js.length){ host.style.display='none'; return; }
    host.style.display='flex';
    host.innerHTML=`<span class="rl" style="align-self:center;font-size:11px;font-weight:800;letter-spacing:.05em;color:var(--muted);margin-right:2px">JOURNEY HEALTH</span>`
      +js.map(j=>{
        const sub = (j.status==='red'||j.status==='amber') ? `<span class="jn">${esc(j.severity||'')}</span>`
          : (j.errors?`<span class="jn">${j.errors} err</span>`:'');
        const tip = `${j.label}: ${j.status==='ok'?'healthy':j.status}${j.severity?' · '+j.severity+' alert':''}${j.errors?' · '+j.errors+' errors (6h)':''}`;
        return `<button class="jhp jhp-${esc(j.status)}" data-cat="${esc((j.cats&&j.cats[0])||'')}" title="${esc(tip)}"><span class="jdot"></span>${esc(j.label)} ${sub}</button>`;
      }).join("");
    host.querySelectorAll('.jhp').forEach(b=>b.addEventListener('click',()=>{
      const cat=b.dataset.cat||'';
      // navigate with the category in the URL so it's shareable; the router selects the tile
      if(window.setConsoleHash) window.setConsoleHash('troubleshoot'+(cat?`?cat=${encodeURIComponent(cat)}`:''));
      else if(window.opsSelectErrorCategory) window.opsSelectErrorCategory(cat);
    }));
  }

  // ---- Growth summary cards (resellers + campaigns) linking into the Growth dashboard ----
  async function renderGrowthCards(){
    const anchor=$("#nocAnoms"); if(!anchor||!anchor.parentNode) return;   // right after the P1/P2 anomaly notifs, before the range picker
    let box=document.getElementById("homeGrowth");
    if(!box){ box=document.createElement("div"); box.id="homeGrowth"; box.style.margin="0 0 10px"; }
    anchor.parentNode.insertBefore(box, anchor.nextSibling);   // (re)position after the anomaly notifs
    let d; try{ d=await api("/api/growth/summary"); }catch(e){ box.style.display="none"; return; }
    const n=x=>Number(x||0).toLocaleString("en-US");
    const R=(d.resellers&&d.resellers.scorecard)||{}, C=(d.campaigns&&d.campaigns.scorecard)||{}, pvo=(d.campaigns&&d.campaigns.paidVsOrganic)||{};
    box.style.cssText="display:flex;gap:10px;flex-wrap:wrap;margin:0 0 10px";
    const cardHtml=(title,big,sub,color)=>`<button class="hg-card" style="flex:1;min-width:240px;text-align:left;background:var(--card);border:1px solid var(--line);border-left:4px solid ${color};border-radius:12px;padding:10px 14px;cursor:pointer">`+
      `<div style="font-weight:700;font-size:11.5px;color:${color}">${title}<span class="rl" style="float:right;font-weight:600">open →</span></div>`+
      `<div style="font-size:20px;font-weight:800;margin-top:2px">${big}</div><div class="rl">${sub}</div></button>`;
    box.innerHTML =
      cardHtml("RESELLERS · 30d", `${n(R.resellerActivated)} <span style="font-size:12px;font-weight:600;color:var(--muted)">activations · ${R.resellerSharePct||0}% share</span>`, `top path: ${esc(R.topReseller||'—')}`, "#2563eb") +
      cardHtml("CAMPAIGNS · 30d", `${n(pvo.paidActivated)} <span style="font-size:12px;font-weight:600;color:var(--muted)">paid activations</span>`, `best source: ${esc(C.bestSource||'—')} · top: ${esc((C.topCampaign||'—')).slice(0,22)}`, "#ea580c");
    box.querySelectorAll(".hg-card").forEach(b=>b.addEventListener("click",()=>{ if(window.setConsoleHash) window.setConsoleHash("growth"); }));
  }
  // ---- Growth as a configurable home section (Resellers / Campaigns), driven by the dashboard range ----
  function growthRangeQS(R){
    const to = R && R.to ? new Date(R.to) : new Date();
    const from = R && R.from ? new Date(R.from) : new Date(to.getTime() - ((R&&R.hours)||720)*3600e3);
    return `?from=${from.toISOString()}&to=${to.toISOString()}`;
  }
  async function renderGrowthSection(holder, which, R){
    const pinKey='growth_pin_'+which;
    const pinned=localStorage.getItem(pinKey)==='1';   // pinned → fixed 30d business window, ignores the ops range
    holder.innerHTML=`<div class="rl" style="padding:6px 0">Loading ${esc(which)}…</div>`;
    let d; try{ d=await api('/api/growth/summary'+(pinned?growthRangeQS({hours:720}):growthRangeQS(R))); }
    catch(e){ holder.innerHTML=`<div class="albanner">Growth needs the console API. ${esc(e.message)}</div>`; return; }
    const pinRow=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">`+
      `<span class="rl">Window: <b>${pinned?'30d — pinned':esc(rangeLabel())+' — follows dashboard'}</b></span>`+
      `<button class="pill gr-pin" title="${pinned?'Pinned to a fixed 30-day business window. Click to follow the dashboard date range instead.':'Following the dashboard date range. Click to pin a fixed 30-day business window (useful on short ops ranges).'}" style="padding:2px 10px;margin-left:auto;${pinned?'border-left-color:var(--blue)':''}">${pinned?'📌 30d · unpin':'📌 Pin 30d'}</button></div>`;
    const n=x=>Number(x||0).toLocaleString("en-US"), pct=x=>x==null?"—":(x*100).toFixed(1)+"%", money=x=>Math.round(Number(x||0)).toLocaleString("en-US")+" SAR";
    const PAL=["#0d9488","#2563eb","#7c3aed","#ea580c","#d97706","#0891b2","#4f46e5","#dc2626"];
    const barCell=(frac,c)=>`<div style="height:6px;border-radius:4px;background:var(--line-soft,rgba(148,163,184,.18));margin-top:3px"><div style="height:6px;border-radius:4px;width:${Math.max(0,Math.min(100,Math.round((frac||0)*100)))}%;background:${c}"></div></div>`;
    const chip=(t,v,c)=>`<div style="flex:1;min-width:140px;background:var(--card2,rgba(148,163,184,.06));border:1px solid var(--line);border-radius:10px;padding:8px 12px"><div style="font-size:18px;font-weight:800;color:${c}">${v}</div><div class="rl" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.03em">${esc(t)}</div></div>`;
    const wrap=inner=>`<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px">${inner}</div>`;
    if(which==='resellers'){
      const flows=d.resellers.flowTypes||[], chans=d.resellers.channels||[], sc=d.resellers.scorecard||{};
      const maxA=Math.max(1,...flows.map(f=>f.activated));
      const funnel=`<div style="font-weight:700;font-size:12px;margin-bottom:8px">Funnel by sales path <span class="rl">(flow_type)</span></div><table style="width:100%;border-collapse:collapse">
        <tr><th style="text-align:left;font-size:10px;color:var(--muted);padding:4px 8px">PATH</th><th style="text-align:right;font-size:10px;color:var(--muted);padding:4px 8px">CREATED</th><th style="text-align:right;font-size:10px;color:var(--muted);padding:4px 8px">ACTIVATED</th><th style="text-align:right;font-size:10px;color:var(--muted);padding:4px 8px">CONV</th><th style="text-align:right;font-size:10px;color:var(--muted);padding:4px 8px">REVENUE</th></tr>
        ${flows.map((f,i)=>`<tr><td style="padding:4px 8px"><b>${esc(f.label)}</b>${barCell(f.activated/maxA,PAL[i%PAL.length])}</td><td class="mono" style="text-align:right;padding:4px 8px">${n(f.created)}</td><td class="mono" style="text-align:right;padding:4px 8px"><b>${n(f.activated)}</b></td><td class="mono" style="text-align:right;padding:4px 8px">${pct(f.convRate)}</td><td class="mono" style="text-align:right;padding:4px 8px">${money(f.revenue)}</td></tr>`).join("")}</table>`;
      const maxC=Math.max(1,...chans.map(c=>c.activated));
      const channels=`<div style="font-weight:700;font-size:12px;margin-bottom:2px">Reseller channels <span class="rl">(tygo · soob)</span></div><div class="rl" style="font-size:10px;margin-bottom:6px">Orders on plans each reseller offers.</div>${chans.length?`<table style="width:100%;border-collapse:collapse">${chans.map((c,i)=>`<tr><td style="padding:4px 8px"><b>${esc(c.channel)}</b>${barCell(c.activated/maxC,PAL[i%PAL.length])}</td><td class="mono" style="text-align:right;padding:4px 8px">${n(c.orders)} ord</td><td class="mono" style="text-align:right;padding:4px 8px"><b>${n(c.activated)}</b></td><td class="mono" style="text-align:right;padding:4px 8px">${money(c.revenue)}</td></tr>`).join("")}</table>`:`<div class="rl">No tygo/soob orders yet in this window — resellers appear here once they have activity (<code>plan_channels</code> refreshes each prod-sync).</div>`}`;
      holder.innerHTML=pinRow+`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${chip("Total activations",n(sc.totalActivated),"#0d9488")}${chip("Reseller-driven",n(sc.resellerActivated)+" · "+(sc.resellerSharePct||0)+"%","#2563eb")}${chip("Top path",esc(sc.topReseller||"—"),"#7c3aed")}${chip("Reseller channels",n(chans.length),"#ea580c")}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${wrap(funnel)}${wrap(channels)}</div>`;
    } else {
      const srcs=d.campaigns.sources||[], camps=d.campaigns.campaigns||[], sc=d.campaigns.scorecard||{}, pvo=d.campaigns.paidVsOrganic||{};
      const maxS=Math.max(1,...srcs.map(s=>s.orders));
      const bySrc=`<div style="font-weight:700;font-size:12px;margin-bottom:8px">By source · medium</div><table style="width:100%;border-collapse:collapse">${srcs.slice(0,8).map((s,i)=>`<tr><td style="padding:4px 8px"><b>${esc(s.source)}</b> <span class="rl">· ${esc(s.medium)}</span>${barCell(s.orders/maxS,PAL[i%PAL.length])}</td><td class="mono" style="text-align:right;padding:4px 8px">${n(s.orders)} ord</td><td class="mono" style="text-align:right;padding:4px 8px"><b>${n(s.activated)}</b></td><td class="mono" style="text-align:right;padding:4px 8px">${pct(s.convRate)}</td></tr>`).join("")}</table>`;
      const topC=`<div style="font-weight:700;font-size:12px;margin-bottom:8px">Top campaigns</div>${camps.length?`<table style="width:100%;border-collapse:collapse">${camps.slice(0,8).map(c=>`<tr><td style="padding:4px 8px;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.campaign)}">${esc(c.label||c.campaign)}</td><td class="mono" style="text-align:right;padding:4px 8px">${n(c.orders)}</td><td class="mono" style="text-align:right;padding:4px 8px"><b>${n(c.activated)}</b></td><td class="mono" style="text-align:right;padding:4px 8px">${pct(c.convRate)}</td></tr>`).join("")}</table>`:`<div class="rl">No campaign-tagged orders in this window.</div>`}`;
      holder.innerHTML=pinRow+`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${chip("Paid activations",n(pvo.paidActivated),"#2563eb")}${chip("Organic activations",n(pvo.organicActivated),"#16a34a")}${chip("Best source",esc(sc.bestSource||"—"),"#7c3aed")}${chip("Top campaign",esc((sc.topCampaign||"—")).slice(0,22),"#ea580c")}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${wrap(bySrc)}${wrap(topC)}</div>`;
    }
    const pb=holder.querySelector('.gr-pin'); if(pb) pb.addEventListener('click',()=>{ localStorage.setItem(pinKey, pinned?'0':'1'); renderGrowthSection(holder, which, R); });
  }
  function renderAll(){ renderNoc(); renderAnoms(); renderGreeting(); renderKpis(); renderJourneys(); renderGrowthCards(); renderDash(); }

  // ---- customize (pick + reorder) ----
  function openCustomize(){
    let ov=$("#homeCustOv");
    if(!ov){ ov=el("div","modal-overlay"); ov.id="homeCustOv"; ov.innerHTML=`<div class="modal-card" id="homeCustCard" style="max-width:560px"></div>`; document.body.appendChild(ov);
      ov.addEventListener("click",e=>{ if(e.target===ov) ov.classList.remove("open"); }); }
    const all=homeDashList();
    const savedSet=new Set(savedSections());
    // working order: saved (in order) then the rest
    let order=[...savedSections().filter(k=>all.find(d=>d.key===k)), ...all.map(d=>d.key).filter(k=>!savedSet.has(k))];
    const checked=new Set(savedSet);
    function draw(){
      const card=$("#homeCustCard");
      card.innerHTML=`<div class="modal-head"><span class="path">Customize my dashboard</span><span class="x" id="hcX">×</span></div>
        <div class="modal-body">
          <div class="sub" style="margin-bottom:8px">Pick the Analytics sections to show on your home page and set their order. Only the date range applies on the dashboard — no other filters.</div>
          <div id="hcPresets" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px"></div>
          <div id="hcList"></div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
            <button class="pill" id="hcCancel">Cancel</button>
            <button class="pill" id="hcSave" style="border-left-color:var(--green)">Save</button>
          </div></div>`;
      const pbox=$("#hcPresets");
      pbox.innerHTML=`<span class="rl">Apply a role preset:</span>`+Object.keys(ROLE_PRESETS).map(name=>`<button class="pill" data-preset="${esc(name)}" style="border-left-color:var(--blue)">${esc(name)}</button>`).join("");
      pbox.querySelectorAll("[data-preset]").forEach(b=>b.addEventListener("click",()=>{
        const keys=ROLE_PRESETS[b.dataset.preset].filter(k=>all.find(d=>d.key===k));
        const rest=all.map(d=>d.key).filter(k=>!keys.includes(k));
        order=[...keys,...rest]; checked.clear(); keys.forEach(k=>checked.add(k)); draw();
      }));
      const list=$("#hcList");
      list.innerHTML=order.map((k,i)=>{ const d=all.find(x=>x.key===k)||{name:k};
        return `<div class="hc-row" draggable="true" data-idx="${i}" style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px;background:var(--card)">
          <span class="hc-grip" title="Drag to reorder" style="cursor:grab;color:var(--muted);font-size:15px;letter-spacing:-2px;user-select:none">⠿⠿</span>
          <input type="checkbox" data-k="${esc(k)}" ${checked.has(k)?'checked':''} style="width:15px;height:15px;accent-color:var(--green)">
          <span style="flex:1;font-size:12.5px;font-weight:600">${esc(d.name||k)}</span>
          <span class="rl" style="font-size:10px">${i+1}</span>
        </div>`; }).join("");
      list.querySelectorAll("input[data-k]").forEach(cb=>cb.addEventListener("change",()=>{ cb.checked?checked.add(cb.dataset.k):checked.delete(cb.dataset.k); }));
      // native drag-and-drop reordering
      let from=null;
      list.querySelectorAll(".hc-row").forEach(row=>{
        row.addEventListener("dragstart",e=>{ from=+row.dataset.idx; e.dataTransfer.effectAllowed="move"; try{e.dataTransfer.setData("text/plain",String(from));}catch(_){} row.style.opacity=".4"; });
        row.addEventListener("dragend",()=>{ row.style.opacity=""; list.querySelectorAll(".hc-row").forEach(r=>r.style.borderColor="var(--line)"); });
        row.addEventListener("dragover",e=>{ e.preventDefault(); e.dataTransfer.dropEffect="move"; row.style.borderColor="var(--green)"; });
        row.addEventListener("dragleave",()=>{ row.style.borderColor="var(--line)"; });
        row.addEventListener("drop",e=>{ e.preventDefault(); const to=+row.dataset.idx; if(from==null||from===to){ from=null; return; } const [m]=order.splice(from,1); order.splice(to,0,m); from=null; draw(); });
      });
      $("#hcX").onclick=$("#hcCancel").onclick=()=>ov.classList.remove("open");
      $("#hcSave").onclick=async()=>{
        const sections=order.filter(k=>checked.has(k));
        try{ await api("/api/me/dashboard",{method:"PUT",body:JSON.stringify({sections})});
          const s=sess(); if(s.me){ s.me.dashboard=Object.assign({},s.me.dashboard,{sections}); }
          ov.classList.remove("open"); renderDash();
        }catch(e){ alert("Save failed: "+e.message); }
      };
    }
    draw(); ov.classList.add("open");
  }

  // ---- nav / wiring ----
  function activateHome(){
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.remove("on");
    const t=document.getElementById("tourBtn"); if(t) t.classList.remove("on");
    const hm=document.getElementById("helpMenu"); if(hm) hm.classList.remove("open");
    const sm=document.getElementById("settingsMenu"); if(sm) sm.classList.remove("open");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    const v=document.getElementById("view-home"); if(v) v.classList.add("active");
    const tab=document.querySelector('.navtab[data-view="home"]'); if(tab) tab.classList.add("active");
    renderAll();
  }
  window.opsGoHome = activateHome;

  const logo=document.querySelector(".logo"); if(logo){ logo.style.cursor="pointer"; logo.title="Dashboard"; logo.addEventListener("click", activateHome); }
  // the Dashboard nav tab opens Home (app.js switches the view; we render it)
  document.querySelectorAll('.navtab[data-view="home"]').forEach(b=>b.addEventListener("click", renderAll));
  const cust=$("#homeCustomize"); if(cust) cust.addEventListener("click", openCustomize);
  const rangeBox=$("#homeRange");
  const todaySpan=$("#homeTodaySpan");
  const clearB=$("#homeDateClear");
  const syncTodayVis=()=>{ if(todaySpan) todaySpan.style.display=(homeRangeH===24 && !homeYesterday && !homeCustom)?"flex":"none"; };
  syncTodayVis();
  if(rangeBox) rangeBox.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    homeCustom=null; if(clearB) clearB.style.display="none";   // a segment range overrides any custom date range
    if(b.dataset.yday){ homeYesterday=true; } else { homeYesterday=false; homeRangeH=Number(b.dataset.h); }
    rangeBox.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); syncTodayVis(); renderKpis(); renderDash();
  }));
  const todayBox=$("#homeToday");
  if(todayBox) todayBox.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    homeCustom=null; if(clearB) clearB.style.display="none";
    homeTodayH=Number(b.dataset.h); todayBox.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); renderKpis(); renderDash();
  }));
  // from→to date range picker (overrides the segment ranges). Each date = a full KSA calendar day.
  const fromI=$("#homeFrom"), toI=$("#homeTo"), applyB=$("#homeDateApply");
  const ksaDayStart=s=>{ const [y,m,d]=String(s).split('-').map(Number); return new Date(Date.UTC(y,m-1,d)-3*3600e3); };  // 00:00 KSA of that date, as UTC
  function applyDates(){
    const fv=fromI&&fromI.value, tv=toI&&toI.value; if(!fv||!tv) return;
    let a=ksaDayStart(fv).getTime(), b=ksaDayStart(tv).getTime()+24*3600e3;   // inclusive of both KSA days
    if(a>=b){ const lo=Math.min(ksaDayStart(fv).getTime(),ksaDayStart(tv).getTime()), hi=Math.max(ksaDayStart(fv).getTime(),ksaDayStart(tv).getTime())+24*3600e3; a=lo; b=hi; }  // swap if reversed
    homeCustom={ from:new Date(a).toISOString(), to:new Date(b).toISOString(), label:`${fv} → ${tv}` };
    homeYesterday=false;
    if(rangeBox) rangeBox.querySelectorAll("button").forEach(x=>x.classList.remove("on"));
    if(clearB) clearB.style.display="";
    syncTodayVis(); renderKpis(); renderDash();
  }
  if(applyB) applyB.addEventListener("click", applyDates);
  if(clearB) clearB.addEventListener("click",()=>{
    homeCustom=null; if(fromI)fromI.value=""; if(toI)toI.value=""; clearB.style.display="none";
    homeRangeH=24; homeYesterday=false;
    if(rangeBox){ rangeBox.querySelectorAll("button").forEach(x=>x.classList.remove("on")); const td=rangeBox.querySelector('[data-h="24"]'); if(td) td.classList.add("on"); }
    syncTodayVis(); renderKpis(); renderDash();
  });
  document.addEventListener("themechange",()=>{ if($("#view-home")&&$("#view-home").classList.contains("active")) renderDash(); });
  // live auto-refresh (SSE-driven) — update KPIs + panels in place, no reload
  document.addEventListener("opsdatarefresh",()=>{ if($("#view-home")&&$("#view-home").classList.contains("active")){ renderNoc(); renderAnoms(); renderKpis(); renderDash(); } });
  // first render once the session (name + prefs) is loaded
  document.addEventListener("consoleReady", ()=>{ if($("#view-home")&&$("#view-home").classList.contains("active")) renderAll(); });
})();
