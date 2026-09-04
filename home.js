/* Home dashboard — personal landing: dynamic greeting, today's global KPIs across all
 * journeys, and the user's chosen Analytics sections (reorderable, saved per user). */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = (location.protocol==="file:") ? "http://localhost:4600" : (location.pathname.startsWith("/digital-console") ? "/digital-console" : "");
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  const sess=()=> (window.opsSession? window.opsSession():{});
  const num=v=> v==null?"—":Number(v).toLocaleString();
  const pct=v=> v==null?"—":(v*100).toFixed(1)+"%";
  const __hr = (window.pf && window.pf.get('home_range', null)) || {};
  let homeRangeH = __hr.h!=null ? Number(__hr.h) : 24;
  let homeTodayH = __hr.todayH!=null ? Number(__hr.todayH) : 24;   // intra-day sub-range (hours) — only used when "Today" is selected
  let homeRangeIdx = __hr.idx!=null ? __hr.idx : null;   // which range button was active (resolves the Today vs Last-24h tie)
  function saveHomeRange(){ if(window.pf) window.pf.set('home_range', { h:homeRangeH, todayH:homeTodayH, yday:homeYesterday, custom:homeCustom, idx:homeRangeIdx }); }
  let homePlanType=""; // "" | postpaid | prepaid — global Plan type filter for the dashboard charts
  function applyPlanType(){ window.ANA_GLOBAL_FILTERS = homePlanType ? { plan_type: homePlanType } : {}; }
  // role-view templates for the Customize modal (section keys → ordered dashboard set)
  const FLOW_KEY='__order_flow';   // pseudo-section: the onboarding order-status flow tree
  const SCREENS_KEY='__screens_flow'; // pseudo-section: journeys as Figma app screens with per-screen counts
  const ROLE_PRESETS={
    "L1 · NOC":    [FLOW_KEY,"overview","integrations","funnel_newsim","funnel_mnp","payments"],
    "L2 · Debug":  ["error_codes","integrations","eligibility","delivery","payments"],
    "Business":    [FLOW_KEY,"growth_resellers","growth_campaigns","mnp_donors","overview","funnel_newsim","funnel_mnp","plan_change","channels"]
  };
  // dashboards available on the home page = the analytics boards + the order-flow pseudo-section
  function homeDashList(){ const a=window.anaDashboards?window.anaDashboards():[]; return [
    {key:FLOW_KEY,name:'Order status flow',builtin:true,_flow:true},
    {key:SCREENS_KEY,name:'App screens flow',builtin:true,_screens:true},
    {key:'growth_resellers',name:'Resellers',builtin:true,_growth:'resellers'},
    {key:'growth_campaigns',name:'Campaigns',builtin:true,_growth:'campaigns'},
    {key:'mnp_donors',name:'Port-ins by donor operator',builtin:true,_mnp:true},
    {key:'servicing',name:'Servicing · existing customers',builtin:true,_servicing:true},
    {key:'oracle_stack',name:'Oracle stack · OSB transactions (archive POC)',builtin:true,_oracle:true},
    {key:'hyperpay',name:'HyperPay · customer payments (STC Pay watch)',builtin:true,_hyperpay:true},
    // dealers_dms lives on the dedicated DMS tab now — keep it off the home dashboard list
    ...a.filter(d=>d.key!=='dealers_dms')]; }

  // KSA = UTC+3, no DST. Start-of-today (00:00 KSA) as a real UTC instant.
  function ksaMidnight(){ const s=new Date(Date.now()+3*3600e3); s.setUTCHours(0,0,0,0); return s.getTime()-3*3600e3; }
  // "last N hours, but never before 00:00 KSA today" → {from,to} ISO. to = next hour boundary so the axis reaches now.
  function todayWindow(h){
    const to=new Date(); to.setUTCMinutes(0,0,0); to.setUTCHours(to.getUTCHours()+1);
    const from=Math.max(ksaMidnight(), to.getTime()-h*3600e3);
    return {from:new Date(from).toISOString(), to:to.toISOString()};
  }
  let homeYesterday = !!__hr.yday;   // "Yesterday" range mode (its own [00:00,24:00) KSA window)
  let homeCustom = __hr.custom || null;       // {from,to,label,fv,tv} — explicit from→to date range (overrides the segment ranges)
  // the window currently driving BOTH the KPI strip and the panels
  function currentRange(){
    if(homeCustom){ return {from:homeCustom.from, to:homeCustom.to, hours:Math.max(1,Math.round((new Date(homeCustom.to)-new Date(homeCustom.from))/3600e3))}; }
    if(homeYesterday){ const ys=ksaMidnight()-86400e3, ye=ksaMidnight(); return {hours:24, from:new Date(ys).toISOString(), to:new Date(ye).toISOString()}; }
    return (homeRangeH===24)
      ? Object.assign({hours:homeTodayH}, todayWindow(homeTodayH))
      : {hours:homeRangeH, from:null, to:null};
  }
  // open Troubleshoot carrying the dashboard's CURRENT period + a class (business/technical) + category,
  // so every drill-down from a KPI/gauge/journey pill lands on the matching window & filter.
  function goTS(cls, cat){
    let R = currentRange();
    // relative preset (7d/30d → from/to null) → resolve to an ABSOLUTE window anchored to the board's
    // data-end, so Troubleshoot lands on the exact same period the dashboard is showing (and the URL
    // is shareable). Otherwise Troubleshoot would re-anchor to its own "now" and drift.
    if(!(R.from && R.to)){
      const to = window.__opsBoardNow || new Date().toISOString();
      const from = new Date(new Date(to).getTime() - (R.hours||24)*3600e3).toISOString();
      R = { from, to, hours:R.hours };
    }
    if(window.opsGoTroubleshoot) window.opsGoTroubleshoot({ from:R.from, to:R.to, hours:R.hours, cls:cls||"", cat:cat||"" });
    else if(window.setConsoleHash) window.setConsoleHash("troubleshoot");
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
    // Errors split (errclass): business = the API said no (expected, informational, blue) ·
    // technical = the API failed to answer (platform issue, red, drills to Troubleshoot).
    // Fall back to the single legacy card when the server doesn't send the split yet.
    const hasErrSplit = d.errorsBusiness!=null || d.errorsTechnical!=null;
    const errCards = hasErrSplit
      ? card("Business errors", num(d.errorsBusiness), `<span style="color:#3b82f6;font-weight:700">expected — API said no</span>`, null, null)+
        card("Technical errors", num(d.errorsTechnical), (d.errorsTechnical? `<span style="color:#ef4444;font-weight:700">needs a look →</span>`:`<span class="rl" style="font-weight:700;color:#16a34a">all clear</span>`), null, sp.errors)
      : card("Errors", num(d.errorsToday), (d.errorsToday? `<span style="color:#dc2626;font-weight:700">needs a look →</span>`:``), null, sp.errors);
    box.innerHTML=
      card("Orders", num(d.orders), null, "accent", sp.orders, d.orders, pv.orders)+
      card("Checkouts", num(d.checkouts), null, null, sp.checkouts, d.checkouts, pv.checkouts)+
      card("Payments OK", num(d.paidOk), rateSub(d.payRate, d.targets&&d.targets.payment, (d.paidOk||0)+(d.paidFail||0)), null, sp.paidOk, d.paidOk, pv.paidOk)+
      card("Activation calls (BSS)", num(d.actOk), rateSub(d.actRate, d.targets&&d.targets.activation, (d.actOk||0)+(d.actFail||0)), null, sp.actOk, d.actOk, pv.actOk)+
      card("Nafath completed", num(d.nafOk), nafSub, null, sp.nafOk, d.nafOk, pv.nafOk)+
      card("Delivery requests", num(d.deliveries), null, null, sp.deliveries, d.deliveries, pv.deliveries)+
      card("Change Plans", num(d.planOk), null, null, sp.planOk, d.planOk, pv.planOk)+
      errCards;
    box.style.opacity="";
    // quick action: Technical errors (or legacy Errors) card → Troubleshoot; Business card is informational
    const cards=box.querySelectorAll(".home-kpi"); const errCard=cards[cards.length-1];
    if(errCard){ errCard.style.cursor="pointer"; errCard.title="Open Troubleshoot"; errCard.onclick=()=>goTS(hasErrSplit?"technical":"", "");
      if(hasErrSplit) errCard.style.borderLeft="4px solid #ef4444"; }
    if(hasErrSplit){ const bizCard=cards[cards.length-2]; if(bizCard) bizCard.style.borderLeft="4px solid #3b82f6"; }
  }

  // ---- "API call outcomes" — Grafana-style semicircle gauges (Success / Business / Technical).
  // Data = /api/home apiOutcomes (same window + sources as the KPI strip and errors.summary()).
  // Rendered into the Overview board just before "Orders over time"; if the server doesn't send
  // apiOutcomes yet (old build), the card is skipped entirely.
  function outcomeGauge(label,val,color,total,cls){
    const share=total>0?(val||0)/total:0;
    const fill=Math.max(2, share*100).toFixed(1);          // min 2% arc so tiny slices stay visible
    const arc="M 14 64 A 46 46 0 0 1 106 64";
    return `<div style="flex:1;min-width:150px;text-align:center${cls?';cursor:pointer':''}"${cls?` data-cls="${esc(cls)}" title="Open Troubleshoot"`:''}>
      <svg viewBox="0 0 120 74" style="max-width:190px;margin:0 auto">
        <path d="${arc}" fill="none" stroke="var(--line)" stroke-opacity=".45" stroke-width="10" stroke-linecap="round"/>
        <path d="${arc}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" pathLength="100" stroke-dasharray="${fill} 100"/>
        <text x="60" y="56" text-anchor="middle" font-size="18" font-weight="800" fill="${color}">${num(val)}</text>
      </svg>
      <div style="font-size:11.5px;font-weight:700;color:${color};margin-top:2px">${esc(label)}</div>
      <div class="rl" style="font-size:10px;color:var(--muted)">${total>0?(share*100).toFixed(1)+"% of calls":"—"}</div></div>`;
  }
  async function renderOutcomes(holder,R){
    const qs=(R&&R.from&&R.to)?`?from=${encodeURIComponent(R.from)}&to=${encodeURIComponent(R.to)}`:`?hours=${(R&&R.hours)||24}`;
    let d; try{ d=await api("/api/home"+qs); }catch(_){ return; }
    const o=d&&d.apiOutcomes; if(!o) return;               // old server → no card at all
    const total=(o.success||0)+(o.business||0)+(o.technical||0);
    const p=el("div","apanel"); p.style.gridColumn="span 12";
    p.innerHTML=`<div class="ah"><b>API call outcomes <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· ${esc(rangeLabel())} · ${num(total)} calls</span></b></div>`
      +`<div class="abody" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-around;align-items:flex-end">`
      +outcomeGauge("Success",o.success,"#10b981",total,null)
      +outcomeGauge("Business error",o.business,"#3b82f6",total,"business")
      +outcomeGauge("Technical error",o.technical,"#ef4444",total,"technical")
      +`</div>`;
    const before=[...holder.querySelectorAll(".apanel .ah b")].find(b=>b.textContent.trim().startsWith("Orders over time"));
    if(before) holder.insertBefore(p, before.closest(".apanel")); else holder.appendChild(p);
    p.querySelectorAll("[data-cls]").forEach(g=>g.addEventListener("click",()=>goTS(g.dataset.cls||"", "")));
  }

  /* Payments — FINAL-outcome funnel on the dashboard (same numbers as the Troubleshoot
   * deep-dive: outcome-per-payment, not gateway charge attempts — per the Aug-2026 UPG analysis).
   * Every tile jumps to Troubleshoot → payment tile carrying the exact same period. */
  async function renderPayFunnel(holder,R){
    let win, simQ="";
    if(R&&R.from&&R.to){ win=Math.max(1,Math.round((new Date(R.to)-new Date(R.from))/3600e3)); simQ=`&sim=${encodeURIComponent(R.to)}`; }
    else { win=(R&&R.hours)||24; const to=window.__opsBoardNow; if(to) simQ=`&sim=${encodeURIComponent(to)}`; }
    let d; try{ d=await api(`/api/payments/deep-dive?window=${win}${simQ}`); }catch(_){ return; }
    const F=d&&d.funnel; if(!F||!F.length) return;
    const a=F.reduce((x,f)=>{ for(const k of ['total','success','declined','abandoned','stuck','failed_noanswer']) x[k]=(x[k]||0)+(f[k]||0); return x; },{});
    if(!a.total) return;
    const rt=d.retry||{}; const rtPct=rt.sampled?Math.round(100*(rt.recovered||0)/rt.sampled):null;
    const p=el("div","apanel"); p.style.gridColumn="span 12";
    p.innerHTML=`<div class="ah"><b>Payments — final outcomes <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· ${esc(rangeLabel())} · ${num(a.total)} payments · outcome per payment, not gateway attempts</span></b></div>`
      +`<div class="abody" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-around;align-items:flex-end">`
      +outcomeGauge("Success",a.success,"#10b981",a.total,"pay")
      +outcomeGauge("Abandoned",a.abandoned,"#64748b",a.total,"pay")
      +outcomeGauge("Declined",a.declined,"#3b82f6",a.total,"pay")
      +outcomeGauge("Stuck",a.stuck,"#ef4444",a.total,"pay")
      +`<div style="flex:1;min-width:150px;text-align:center"><div style="font-size:26px;font-weight:800;color:#7c3aed;margin-top:18px">${rtPct==null?"—":rtPct+"%"}</div>
        <div style="font-size:11.5px;font-weight:700;color:#7c3aed;margin-top:2px">Retry-success 24h</div>
        <div class="rl" style="font-size:10px;color:var(--muted)">of failed/abandoned paid later</div></div>`
      +`</div>`;
    holder.appendChild(p);
    p.querySelectorAll("[data-cls]").forEach(g=>{ g.title="Open Troubleshoot · payment"; g.addEventListener("click",()=>goTS("","payment")); });
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
    if(!sections.length){ sections=[FLOW_KEY,SCREENS_KEY,"servicing"]; if(all.find(d=>d.key==="overview")) sections.push("overview"); }   // default view
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
      // FAIL-SOFT (3 Sep): one broken/slow section must never hold the whole dashboard on
      // "Loading…" — render its error inline and keep going.
      try{
        if(d._flow){ holder.style.cssText="grid-column:span 12"; await renderFlow(holder); }
        else if(d._screens){ holder.style.cssText="grid-column:span 12"; await window.screensFlowRender(holder, R); }
        else if(d._growth){ holder.style.cssText="grid-column:span 12"; await renderGrowthSection(holder, d._growth, R); }
        else if(d._mnp){ holder.style.cssText="grid-column:span 12"; await renderMnpSection(holder, R); }
        else if(d._servicing){ holder.style.cssText="grid-column:span 12"; await renderServicing(holder, R); }
        else if(d._oracle){ holder.style.cssText="grid-column:span 12"; await renderOracleStack(holder, R); }
        else if(d._hyperpay){ holder.style.cssText="grid-column:span 12"; await renderHyperpay(holder, R); }
        else { holder.style.cssText="grid-column:span 12;display:grid;grid-template-columns:repeat(12,1fr);gap:12px"; await window.anaRenderDashboard(holder, key, R); if(key==="overview"){ await renderOutcomes(holder, R); await renderPayFunnel(holder, R); } }
      }catch(e){ holder.innerHTML=`<div class="rl" style="color:#dc2626;padding:8px 2px">Section failed to load: ${esc(String(e&&e.message||e).slice(0,140))}</div>`; }
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
      // upstream-frozen is always critical — every figure on the page is stale but looks normal
      const crit=oldest.lagMin>=STALE_CRIT || !!oldest.upstream;
      const bg=crit?"#fee2e2":"#fef3c7", fg=crit?"#991b1b":"#92400e", bd=crit?"#dc2626":"#d97706";
      sb.style.cssText=`display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:10px 14px;border-radius:10px;border-left:4px solid ${bd};background:${bg};color:${fg};font-size:13px;cursor:pointer`;
      sb.innerHTML=`<span style="font-size:16px">⚠</span>`+
        `<span style="flex:1"><b>Data may be stale</b> — ${
          oldest.upstream ? `newest <b>${esc(oldest.name)}</b> row is <b>${oldest.lagMin}m</b> old, but our sync ran ${oldest.syncLagMin==null?'just':oldest.syncLagMin+'m'} ago and reported OK — <b>the upstream prod source is running ~${Math.round(oldest.lagMin/60)}h behind</b> (delayed/lagging replica). Running a sync will NOT help; the source itself has no newer rows`
          : oldest.bySync ? `last successful prod-sync was <b>${oldest.lagMin}m</b> ago`
          : `${esc(oldest.name)} is <b>${oldest.lagMin}m</b> behind`}. `+
        `Every figure below reflects the last data we received, not live prod.</span>`+
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
    // TRUE refusals only: customer submitted National ID + nationality and the check said NO.
    // (is_eligible defaults to false at creation — without the id_submitted guard this box was
    // absorbing every browser who picked a plan and left, which confused L2 repeatedly.)
    {id:'elig_fail',col:1,row:3,label:'Eligibility Fail',kind:'bad'},
    // Never reached the ID form: browsing / plan choice / number selection drop-off. Amber —
    // it is funnel abandonment (UX/price signal), not a refusal and not a platform fault.
    {id:'pre_elig',col:1,row:4,label:'Pre-eligibility drop',kind:'warn'},
    {id:'total_payment',col:2,row:1,label:'Total Payment',kind:'ok'},
    // Eligible but no payment record — abandoned before paying. Amber drop-off; makes Eligibility Pass
    // fully account for its orders (reached payment + no payment) instead of silently losing them.
    {id:'no_payment',col:2,row:3,label:'No payment',kind:'warn'},
    {id:'pay_success',col:3,row:1,label:'Success Payment',kind:'ok'},
    {id:'pay_pending',col:3,row:3,label:'Pending Payment',kind:'warn'},
    {id:'pay_fail',col:3,row:4,label:'Fail Payment',kind:'bad'},
    {id:'esim',col:4,row:0,label:'eSIM',kind:'ok'},
    {id:'esim_activated',col:7,row:0,label:'Activated',kind:'ok'},
    {id:'esim_not_activated',col:7,row:1,label:'Not Activated',kind:'bad'},
    {id:'physical',col:4,row:2,label:'Physical SIM',kind:'ok'},
    {id:'assigned',col:5,row:2,label:'Assigned for Delivery',kind:'ok'},
    {id:'not_assigned',col:5,row:3,label:'Not Assigned',kind:'bad'},
    // Reseller (tygo/soob) order that required courier delivery (apollo_require_delivery not false)
    // but has NO delivery_requests row. Resellers use the SAME oto/tam carriers, so this is a real
    // dispatch backlog — RED, not neutral. Distinct from Not Assigned so a reseller courier outage
    // is visible on its own. Age-thresholded alert rule watches the paid+aged subset.
    {id:'courier_not_created',col:5,row:4,label:'Courier not created',kind:'bad'},
    // Shop pickup at the reseller (apollo_require_delivery=false → delivery skipped, no courier row) —
    // customer collects in the tygo shop. Carved out of the Partner box so it doesn't read as a
    // courier backlog or a delivery failure. Couriered reseller orders (flag true/default) go via
    // oto/tam through the normal Assigned→Delivered path instead.
    {id:'shop_pickup',col:5,row:5,label:'Shop pickup (reseller)',kind:'info'},
    {id:'delivered',col:6,row:2,label:'Delivered',kind:'ok'},
    {id:'not_delivered',col:6,row:3,label:'Not Delivered',kind:'bad'},
    {id:'phys_activated',col:7,row:2,label:'Activated',kind:'ok'},
    {id:'phys_not_activated',col:7,row:3,label:'Not Activated',kind:'bad'}
  ];
  const FLOW_EDGES=[['total','elig_pass'],['total','elig_fail'],['total','pre_elig'],['elig_pass','total_payment'],['elig_pass','no_payment'],['total_payment','pay_success'],['total_payment','pay_pending'],['total_payment','pay_fail'],['pay_success','esim'],['pay_success','physical'],['esim','esim_activated'],['esim','esim_not_activated'],['physical','assigned'],['physical','not_assigned'],['physical','courier_not_created'],['physical','shop_pickup'],['assigned','delivered'],['assigned','not_delivered'],['delivered','phys_activated'],['delivered','phys_not_activated']];
  // 'info' = neither good nor bad, just handled elsewhere (partner-fulfilled). Violet keeps it
  // visually distinct from both the green success path and the red exception boxes.
  const FLOW_KC={ok:{f:'#e7f8ef',s:'#10b981',t:'#065f46'},warn:{f:'#fdf3dc',s:'#f59e0b',t:'#92400e'},bad:{f:'#fdeceb',s:'#ef4444',t:'#991b1b'},info:{f:'#f3f0fe',s:'#8b5cf6',t:'#5b21b6'}};
  const FLOW_KC_MNP={ok:{f:'#e9f1fe',s:'#3b82f6',t:'#1e40af'},warn:{f:'#fdf3dc',s:'#f59e0b',t:'#92400e'},bad:{f:'#fdeceb',s:'#ef4444',t:'#991b1b'},info:{f:'#f3f0fe',s:'#8b5cf6',t:'#5b21b6'}};
  const kcFor=(kind,laneKey)=>((laneKey==='mnp'?FLOW_KC_MNP:FLOW_KC)[kind]||FLOW_KC.ok);
  const F_COLW=156,F_BOXW=112,F_BOXH=46,F_ROWH=70,F_PADX=18,F_LANEH=470,F_PHASEH=34; // F_PHASEH = header band for phase labels; lane holds up to row 5 (shop-pickup)
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
  let _flowWin=null, _flowPlan=null, _flowPlanList=null, _flowHits=[], _flowHost=null, _flowSearchVal='', _flowKey=null, _flowChan=null, _flowChans=[];   // TKT-000012 channel filter
  // one-time CSS for the flow control bar + the "located" node highlight
  function flowCssOnce(){ if(document.getElementById("flowCss")) return; const s=document.createElement("style"); s.id="flowCss";
    s.textContent=`.flow-ctrls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0 2px;font-size:12px}
.flow-ctrls select,.flow-ctrls input{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit}
.flow-ctrls input{width:210px}
.flow-ctrls .fbtn{cursor:pointer;padding:5px 12px;border-radius:8px;border:1px solid var(--blue);background:var(--blue);color:#fff;font-weight:600}
.flow-ctrls .fbtn.ghost{background:transparent;color:var(--blue)}
.flow-ctrls .flabel{color:var(--muted);font-weight:600}
.flow-loc{margin:6px 0 2px;display:flex;flex-direction:column;gap:6px}
.flow-loc .lrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:7px 10px;border:1px solid var(--line);border-left:3px solid var(--blue);border-radius:8px;background:var(--card,#fff)}
.flow-loc .lrow b{font-size:12px}.flow-loc .lrow .muted{color:var(--muted);font-size:11px}
.flow-loc .lrow .fbtn{margin-left:auto}
.fnode.fhit rect{stroke-width:3.5!important;filter:drop-shadow(0 0 6px rgba(59,130,246,.7))}
.fnode.fhit .flow-nlabel{font-weight:800}`;
    document.head.appendChild(s); }
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
      // courier-not-created node: name which resellers are backed up, so "is it just tygo?" is one hover
      const pb=n.id==='courier_not_created'&&lane.partners&&Object.keys(lane.partners).length
        ? '\n'+Object.entries(lane.partners).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`${c}: ${v}`).join(' · ')
          +'\nPaid, courier required, no delivery request created — dispatch backlog.' : '';
      return `<g class="fnode" data-lane="${lane.key}" data-node="${n.id}"${dim}><title>${esc(label)}: ${val} (${pct}% of ${esc(lane.label)})${esc(pb)}</title>`
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
    const ksa=iso=>{ try{ return KT.dt(iso); }catch(_){ return ''; } };
    const legend=`<span class="flow-legend">`
      +`<span class="lgi"><span class="dot" style="background:#10b981"></span>on track / success</span>`
      +`<span class="lgi"><span class="dot" style="background:#f59e0b"></span>pending / waiting</span>`
      +`<span class="lgi"><span class="dot" style="background:#ef4444"></span>failed / needs attention</span>`
      +`<span class="sep"></span>`
      +`<span class="lgi"><span class="dot" style="background:#10b981"></span>New SIM lane</span>`
      +`<span class="lgi"><span class="dot" style="background:#3b82f6"></span>MNP lane</span></span>`;
    return `<div class="flow-panel"><div class="flow-hd"><h3>Orders &amp; their current status</h3>`
      +`<span class="ft">Total on-boarding orders <b>${total}</b> · ${esc(ksa(data.from))} → ${esc(ksa(data.to))} KSA${recon} · click any box to drill in</span>${legend}</div>`
      +flowControlsHtml()
      +`<div class="flow-loc" id="flowLocRes"></div>`
      +`<svg class="flow-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">${flowPhaseZones(H)}${lanes.map((l,i)=>flowLaneSvg(l,i*F_LANEH+6+F_PHASEH)).join("")}</svg></div>`;
  }
  // control bar: plan-name filter + MSISDN / national-id locator
  function flowControlsHtml(){
    /* TKT-000007: 🟢/⚪ = plan enabled/disabled (native <option> can't render styled dots —
     * emoji is the cross-platform way), "(n)" = orders for that plan IN THE CURRENT WINDOW
     * (same query scope as the tree, so the count always reconciles with what selecting the
     * plan shows), plus the price. List = every enabled plan + any disabled plan that still
     * has orders in the window. Sorted busiest-first. */
    const tot=(_flowPlanList||[]).reduce((a,p)=>a+(Number(p.n)||0),0);
    const fmtP=p=>{
      const dot=p.enabled===false?'⚪':'🟢';
      const price=(p.price!=null&&p.price!=='')?` · SAR ${Number(p.price)%1?Number(p.price).toFixed(2):Number(p.price)}`:'';
      const cnt=p.n!=null?` · (${p.n})`:'';
      const off=p.enabled===false?' · inactive':'';
      return `${dot} ${p.id} – ${p.label||p.id}${price}${off}${cnt}`;
    };
    const opts=[`<option value="">All plans${tot?` · (${tot})`:''}</option>`].concat((_flowPlanList||[]).map(p=>
      `<option value="${esc(p.id)}"${String(_flowPlan||'')===String(p.id)?' selected':''}>${esc(fmtP(p))}</option>`)).join('');
    return `<div class="flow-ctrls">`
      +`<span class="flabel">Plan</span><select id="flowPlan" title="Show the same New SIM + MNP flow for one plan">${opts}</select>`
      +`<span class="flabel" style="margin-left:8px">Find</span>`
      +`<input id="flowSearch" placeholder="MSISDN or National ID" value="${esc(_flowSearchVal||'')}" />`
      +`<button class="fbtn" id="flowLocate">Locate</button>`
      +`<button class="fbtn ghost" id="flowClear">Clear</button>`
      /* TKT-000012 — source segregation: one chip per stamped origin (salam = the app/web,
         tygo/soob = resellers via Apollo; a future channel appears on its own, no code change) */
      +(_flowChans.length?`<span class="flabel" style="margin-left:10px">Source</span>`
        +(_flowChans.length<=6
          // ≤6 channels: chips — distribution visible at a glance, one-click filter (TKT-000012)
          ?`<button class="fbtn ${_flowChan?'ghost':''}" data-chan="">All</button>`
            +_flowChans.map(c=>`<button class="fbtn ${_flowChan===c.channel?'':'ghost'}" data-chan="${esc(c.channel)}" title="${c.n.toLocaleString()} orders in this window">${esc(c.channel)} · ${c.n>=1000?(c.n/1000).toFixed(1)+'k':c.n}</button>`).join('')
          // >6 channels (future growth): compact selector, same filter contract
          :`<select id="flowChanSel" class="fbtn" style="padding:3px 8px"><option value="">All sources</option>`
            +_flowChans.map(c=>`<option value="${esc(c.channel)}" ${_flowChan===c.channel?'selected':''}>${esc(c.channel)} · ${c.n.toLocaleString()}</option>`).join('')+`</select>`):'')
      +`</div>`;
  }
  /* ORACLE STACK FLOW (POC, 3 Sep 2026) — the DMS HLD's Oracle block, live: transaction counts,
   * p95 latency and fault badges per component, computed from the imported OSB log archive
   * (osbArchive.js). Sample window is the archive's own span — the header says so honestly. */
  async function renderOracleStack(host, R){
    // follows the DASHBOARD RANGE: pick 1 Sep / 2 Sep and see that day's Oracle-stack numbers.
    // R={from,to} for explicit dates, else {hours} back from now.
    const R2=R||{hours:24};
    const from=R2.from||new Date(Date.now()-(R2.hours||24)*3600e3).toISOString();
    const to=R2.to||new Date().toISOString();
    let d; try{ d=await api(`/api/home/oracle-stack?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
    catch(e){ host.innerHTML=''; return; }
    if(!d||!d.ok){ host.innerHTML=`<div class="rl" style="color:var(--muted);padding:8px 2px">${esc((d&&d.note)||'Oracle stack: no OSB archive imported yet.')}</div>`; return; }
    const n=v=>Number(v||0).toLocaleString();
    const win=`${String(d.window.lo||'').slice(0,10)} → ${String(d.window.hi||'').slice(0,10)}`;
    if(!Number(d.totals.access)){
      host.innerHTML=`<div class="rl" style="color:var(--muted);padding:8px 2px">No OSB data in the selected range — the imported archive covers <b>${esc(win)}</b>. Pick those dates (Dates → Apply), or import a newer archive. Once the daily SFTP feed is live this follows the range automatically (day-1 lag).</div>`;
      return;
    }
    const box=(c,extra)=>{const ep=c.calls?100*c.faults/Math.max(1,Number(c.calls)):0;
      return `<div style="border:1.5px solid #d9a7a7;background:#f8ecec;border-radius:8px;padding:10px 12px;min-width:150px;flex:1">
        <div style="font-weight:800;font-size:12px;color:#7a2e2e">${esc(c.label)}</div>
        <div style="font-size:20px;font-weight:800;margin-top:2px">${n(c.calls)}</div>
        <div class="rl" style="font-size:10.5px;color:var(--muted)">${c.avg_ms!=null&&c.calls?`avg ${n(c.avg_ms)}ms · max ${n(c.max_ms)}ms`:(c.pipeline_records?`${n(c.pipeline_records)} pipeline record(s)`:'—')}</div>
        ${c.faults?`<div style="margin-top:4px"><span style="background:#fee2e2;color:#b91c1c;border-radius:5px;padding:0 6px;font-weight:700;font-size:10.5px">✖ ${n(c.faults)} fault(s)</span></div>`:''}
        ${extra||''}</div>`;};
    host.innerHTML=`
      <div class="rl" style="margin:2px 0 8px;color:var(--muted)">POC · <b>selected range</b> ${esc(String(d.from||'').slice(0,10))} → ${esc(String(d.to||'').slice(0,10))} · archive covers ${esc(win)} (both OSB nodes) · faults = OSB-382000 / SOAP faults in pipeline payloads · goes live day-1-lagged once the daily SFTP feed lands</div>
      <div style="background:var(--tint-green,#dcfce7);border:1.5px solid #86efac;border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:14px;margin-bottom:6px">
        <b style="font-size:12.5px">App / Web / DMS → API GW → UIL</b>
        <span class="rl">→</span>
        <b style="font-size:14px">OSB entry: ${n(d.entry.calls)} transactions</b>
        <span class="rl" style="color:var(--muted)">avg ${d.entry.avg_ms!=null?n(d.entry.avg_ms)+'ms':'—'} · ${n(d.entry.faults)} fault(s)</span>
      </div>
      <div style="border:2px solid #c0392b;border-radius:10px;padding:12px;position:relative">
        <span style="position:absolute;top:-9px;left:14px;background:var(--bg,#fff);padding:0 8px;color:#c0392b;font-weight:800;font-size:11px;letter-spacing:1px">ORACLE</span>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${d.components.map(c=>box(c)).join('')}
          ${box({...d.other,label:'Other services'})}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
          <div style="border:1px dashed #d9a7a7;border-radius:8px;padding:6px 12px" class="rl">SADAD biller notifications: <b>${n(d.sadad_notifications)}</b></div>
          <div style="border:1px dashed #d9a7a7;border-radius:8px;padding:6px 12px" class="rl">Total OSB transactions: <b>${n(d.totals.access)}</b> · pipeline records: <b>${n(d.totals.pipeline)}</b> · total faults: <b style="color:#b91c1c">${n(d.totals.faults)}</b></div>
        </div>
      </div>`;
  }

  /* HYPERPAY WATCH (3 Sep 2026) — UPG/Tap just disabled; HyperPay carries customer payments now.
   * Hourly attempts vs success (all + STC Pay), the -10001 "try a different payment method"
   * error bars, per-rail table and top fail reasons. Follows the dashboard range. */
  async function renderHyperpay(host, R){
    const R2=R||{hours:24};
    const from=R2.from||new Date(Date.now()-(R2.hours||24)*3600e3).toISOString();
    const to=R2.to||new Date().toISOString();
    let d; try{ d=await api(`/api/home/hyperpay?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
    catch(e){ host.innerHTML=`<div class="rl" style="color:#dc2626;padding:8px 2px">HyperPay watch: ${esc(e.message)}</div>`; return; }
    const n=v=>Number(v||0).toLocaleString();
    const S=d.series||[];
    if(!S.length){
      host.innerHTML=`<div class="rl" style="color:var(--muted);padding:8px 2px">No HyperPay customer payments since the cutover (3 Sep 16:27 KSA) in this range yet — replica lags a few minutes.
        Vendors seen post-cutover: ${(d.vendors||[]).map(v=>`<code>${esc(v.v)}</code>·${n(v.n)}`).join(' ')||'—'} —
        if HyperPay rows appear under a different vendor value, tell me and I bind it.</div>`;
      return;
    }
    // continuous 5-min (or hourly) buckets across the window — gaps drawn as zero, not skipped
    const step=(d.step_sec||300)*1000;
    const t0=Math.floor(new Date(S[0].b).getTime()/step)*step;
    const t1=Math.max(new Date(S[S.length-1].b).getTime(), Date.now()-step);
    const buckets=[]; for(let t=t0;t<=t1;t+=step) buckets.push(t);
    const at=m=>{const o={}; for(const r of m) o[new Date(r.b||r.h).getTime()]=r; return o;};
    const bySer=at(S), byErr=at(d.err_series||[]);
    const KSAt=t=>{const dt=new Date(t+3*3600e3);return String(dt.getUTCHours()).padStart(2,"0")+":"+String(dt.getUTCMinutes()).padStart(2,"0");};
    // totals for chips
    const tN=S.reduce((a,r)=>a+r.n,0), tOK=S.reduce((a,r)=>a+r.ok,0), tFL=S.reduce((a,r)=>a+r.fl,0);
    const sN=S.reduce((a,r)=>a+(r.stc_n||0),0), sOK=S.reduce((a,r)=>a+(r.stc_ok||0),0);
    const tE=(d.err_series||[]).reduce((a,r)=>a+r.n,0);
    const pct=(a,b)=>b?`${(100*a/b).toFixed(1)}%`:'—';
    const chip=(lbl,val,color)=>`<div style="border:1px solid var(--line);border-left:4px solid ${color};border-radius:8px;padding:8px 14px;background:var(--card)">
      <div class="rl" style="font-size:10px;color:var(--muted);font-weight:700">${lbl}</div><div style="font-size:18px;font-weight:800">${val}</div></div>`;
    // generic multi-series SVG line chart
    function lineChart(seriesDefs,H){
      const Wd=1000,P=34,n_=buckets.length||1;
      const x=i=>P+(Wd-2*P)*(n_<2?0.5:i/(n_-1));
      const maxV=Math.max(1,...seriesDefs.flatMap(s2=>buckets.map(t=>s2.get(t)||0)));
      const y=v=>H-P-(H-2*P)*(v/maxV);
      const lines=seriesDefs.map(s2=>`<polyline fill="none" stroke="${s2.color}" stroke-width="${s2.w||1.8}" ${s2.dash?`stroke-dasharray="${s2.dash}"`:''} points="${buckets.map((t,i)=>`${x(i).toFixed(1)},${y(s2.get(t)||0).toFixed(1)}`).join(' ')}"><title>${esc(s2.label)}</title></polyline>`).join('');
      const every=Math.max(1,Math.ceil(n_/24));
      const ticks=buckets.map((t,i)=>i%every===0?`<text x="${x(i).toFixed(1)}" y="${H-10}" font-size="8" fill="#94a3b8" text-anchor="middle">${KSAt(t)}</text>`:'').join('');
      const grid=[0.25,0.5,0.75,1].map(f=>`<line x1="${P}" x2="${Wd-P}" y1="${y(maxV*f).toFixed(1)}" y2="${y(maxV*f).toFixed(1)}" stroke="#e2e8f0" stroke-width=".6"/><text x="${P-4}" y="${(y(maxV*f)+3).toFixed(1)}" font-size="8" fill="#94a3b8" text-anchor="end">${Math.round(maxV*f)}</text>`).join('');
      return `<svg viewBox="0 0 ${Wd} ${H}" style="width:100%;height:auto">${grid}${lines}${ticks}</svg>`;
    }
    const lg=items=>`<div class="rl" style="font-size:10.5px;color:var(--muted);padding:0 6px">${items.map(i2=>`<span style="color:${i2.color};font-weight:700">— ${esc(i2.label)}</span>`).join(' · ')}</div>`;
    // chart 1 — success vs failures (+ attempts context + -10001)
    const c1=[
      {label:'attempts',color:'#94a3b8',w:1.1,get:t=>(bySer[t]||{}).n},
      {label:'success',color:'#16a34a',w:2.2,get:t=>(bySer[t]||{}).ok},
      {label:'failures',color:'#dc2626',w:2.2,get:t=>(bySer[t]||{}).fl},
      {label:'-10001 app errors',color:'#7c3aed',w:1.3,dash:'4 3',get:t=>(byErr[t]||{}).n}
    ];
    // chart 2 — failures per method/brand
    const brands=[...new Set((d.brand_fails||[]).map(r=>r.brand))];
    const PAL=['#7c3aed','#2563eb','#d97706','#0891b2','#db2777','#16a34a','#64748b','#dc2626','#a16207'];
    const bmap={}; for(const r of (d.brand_fails||[])){ (bmap[r.brand]=bmap[r.brand]||{})[new Date(r.b).getTime()]=r.n; }
    const c2=brands.map((br,i)=>({label:br,color:PAL[i%PAL.length],w:1.8,get:t=>(bmap[br]||{})[t]}));
    // chart 3 — failures per platform (ios / android / web)
    const seriesOf=(rows,key,val)=>{const set=[...new Set((rows||[]).map(r=>r[key]))];
      const m={}; for(const r of (rows||[])){ (m[r[key]]=m[r[key]]||{})[new Date(r.b).getTime()]=r[val]; }
      return set.map((s2,i)=>({label:s2,color:PAL[i%PAL.length],w:1.8,get:t=>(m[s2]||{})[t]}));};
    const c3=seriesOf(d.plat_fails,'plat','n');
    // chart 4 — STC Pay failures per platform
    const c4=seriesOf(d.stc_plat_series,'plat','fl');
    const stepLbl=(d.step_sec||300)===300?'5-minute':'hourly';
    host.innerHTML=`
      <div class="rl" style="margin:2px 0 8px;color:var(--muted)">HyperPay is the ONLY enabled customer gateway — <b>live since 3 Sep 16:27 KSA</b> (view clamped to the cutover; no UPG/Tap data included). ${stepLbl} buckets · ${esc(String(d.from).slice(0,16))} → ${esc(String(d.to).slice(0,16))} · KSA times.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        ${chip('HYPERPAY ATTEMPTS',n(tN),'#2563eb')}
        ${chip('SUCCESS',`${n(tOK)} · ${pct(tOK,tN)}`, tN&&tOK/tN<.5?'#dc2626':'#16a34a')}
        ${chip('FAILURES',`${n(tFL)} · ${pct(tFL,tN)}`, tFL?'#dc2626':'#94a3b8')}
        ${chip('STC PAY',`${n(sN)} · ok ${pct(sOK,sN)}`, sN&&sOK/sN<.5?'#dc2626':'#7c3aed')}
        ${chip('✖ -10001 ERRORS',n(tE), tE?'#dc2626':'#94a3b8')}
      </div>
      <div style="border:1px solid var(--line);border-radius:10px;background:var(--card);padding:8px;margin-bottom:10px">
        <div class="rl" style="font-weight:700;padding:0 6px 4px">PAYMENTS OVER TIME — success vs failures (${stepLbl})</div>
        ${lineChart(c1,230)}${lg(c1)}
      </div>
      <div style="border:1px solid var(--line);border-radius:10px;background:var(--card);padding:8px;margin-bottom:10px">
        <div class="rl" style="font-weight:700;padding:0 6px 4px">FAILURES PER METHOD — STC Pay · Mada · Visa · Apple Pay … (${stepLbl})</div>
        ${brands.length?lineChart(c2,210)+lg(c2):'<div class="rl" style="color:var(--muted);padding:6px">no failures in the window 🎉</div>'}
        ${brands.length===1&&/credit|card|\?/.test(brands[0])?`<div class="rl" style="color:#d97706;font-size:10.5px;padding:2px 6px">⚠ brand not stamped — methods collapse to "${esc(brands[0])}".
          Keys: ${(d.resp_keys||[]).slice(0,12).map(k2=>`<code>${esc(k2.k)}</code>`).join(' ')} ·
          type values: ${(d.type_values||[]).map(t2=>`<code>${esc(t2.t)}</code>·${t2.n}`).join(' ')||'—'}
          <details style="margin-top:2px"><summary style="cursor:pointer">failed-payment response samples (masked)</summary>
          <pre style="font-size:9.5px;white-space:pre-wrap;max-height:160px;overflow:auto">${esc((d.resp_sample||[]).join('\n\n———\n\n'))}</pre></details></div>`:''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px">
        <div style="border:1px solid var(--line);border-radius:10px;background:var(--card);padding:8px">
          <div class="rl" style="font-weight:700;padding:0 6px 4px">FAILURES PER PLATFORM — iOS · Android · Web</div>
          ${c3.length?lineChart(c3,190)+lg(c3):'<div class="rl" style="color:var(--muted);padding:6px">no failures in the window</div>'}
        </div>
        <div style="border:1px solid var(--line);border-radius:10px;background:var(--card);padding:8px">
          <div class="rl" style="font-weight:700;padding:0 6px 4px;color:#7c3aed">STC PAY FAILURES PER PLATFORM</div>
          ${c4.length?lineChart(c4,160)+lg(c4):'<div class="rl" style="color:var(--muted);padding:6px">no STC Pay failures in the window</div>'}
          ${(d.stc_plat_table||[]).length?`<table class="alerts" style="font-size:11px;margin-top:4px">
            <tr><th>PLATFORM</th><th>STC ATTEMPTS</th><th>OK</th><th>%</th><th>FAILED</th></tr>
            ${d.stc_plat_table.map(r2=>{const p2=r2.n?100*r2.ok/r2.n:0;
              return `<tr><td>${esc(r2.plat)}</td><td>${n(r2.n)}</td><td>${n(r2.ok)}</td>
              <td style="font-weight:700;color:${p2<50?'#dc2626':'#16a34a'}">${p2.toFixed(1)}%</td><td>${n(r2.failed)}</td></tr>`;}).join('')}</table>`:''}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="border:1px solid var(--line);border-radius:10px;overflow:auto;max-height:240px"><table class="alerts" style="font-size:11.5px">
          <tr><th>RAIL / BRAND</th><th>ATTEMPTS</th><th>SUCCESS</th><th>%</th><th>FAILED</th></tr>
          ${(d.rails||[]).map(r2=>{const p2=r2.n?100*r2.ok/r2.n:0;
            return `<tr${/stc/.test(r2.rail)?' style="background:var(--tint-green,#f0fdf4)"':''}><td class="mono">${esc(r2.rail)}</td><td>${n(r2.n)}</td><td>${n(r2.ok)}</td>
            <td style="font-weight:700;color:${p2<50?'#dc2626':p2<75?'#d97706':'#16a34a'}">${p2.toFixed(1)}%</td><td>${n(r2.failed)}</td></tr>`;}).join('')}</table>
          <div class="rl" style="font-size:10px;color:var(--muted);padding:4px 8px">Brand = the GATEWAY's answer (a "Credit Card" app payment lands under its real brand: mada/visa/master). "(initiated — no gateway answer)" = checkout opened but never completed — abandonment, not failures.</div></div>
        <div style="border:1px solid var(--line);border-radius:10px;padding:8px 12px;max-height:240px;overflow:auto">
          <div class="rl" style="font-weight:700;margin-bottom:4px">TOP FAIL REASONS (HyperPay, window)</div>
          ${(()=>{const fr=d.fail_reasons||[];
            const part=(flag,lbl,color)=>{const L=fr.filter(f2=>!!f2.is_stc===flag);
              return `<div class="rl" style="font-weight:700;font-size:10.5px;color:${color};margin-top:4px">${lbl} · ${n(L.reduce((a,x)=>a+x.n,0))}</div>`
                +(L.map(f2=>`<div class="rl" style="display:flex;gap:8px;border-bottom:1px solid var(--line);padding:3px 0"><span style="flex:1">${esc(f2.reason)}</span><b>${n(f2.n)}</b></div>`).join('')
                  ||'<div class="rl" style="color:var(--muted);font-size:10.5px">none</div>');};
            return part(true,'STC PAY','#7c3aed')+part(false,'CARDS / OTHER RAILS','#2563eb');})()}
        </div>
      </div>`;
  }

  async function renderFlow(host){
    if(!host) return; _flowHost=host; flowCssOnce();
    const R=currentRange()||{hours:24};
    let win; if(R.from&&R.to){ win={from:R.from,to:R.to}; } else { const d=new Date(); d.setUTCMinutes(0,0,0); d.setUTCHours(d.getUTCHours()+1); win={to:d.toISOString(),from:new Date(d.getTime()-(R.hours||24)*3600e3).toISOString()}; }
    _flowWin=win;
    // refetched EVERY render (not cached like before): the per-plan counts are window-scoped,
    // so changing the dashboard range must refresh them. Falls back to the plain catalog if
    // the flow endpoint is unavailable (older server) — dots/counts just don't show.
    try{ const pl=await api(`/api/plans/flow?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`); _flowPlanList=(pl&&pl.plans)||[]; }
    catch(_){ if(_flowPlanList===null){ try{ const pl=await api('/api/plans'); _flowPlanList=(pl&&pl.plans)||[]; }catch(__){ _flowPlanList=[]; } } }
    const planQS=_flowPlan?`&plan=${encodeURIComponent(_flowPlan)}`:'';
    const keyQS=_flowKey?`&key=${encodeURIComponent(_flowKey)}`:'';
    const chanQS=_flowChan?`&channel=${encodeURIComponent(_flowChan)}`:'';
    let data; try{ data=await api(`/api/onboarding-flow?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}${planQS}${keyQS}${chanQS}`); }
    catch(e){ host.innerHTML=`<div class="flow-panel"><div class="albanner">${esc(e.message)}</div></div>`; return; }
    _flowChans=(data&&data.channels)||[];
    // reconcile-to-KPI only makes sense for the full unfiltered tree
    let kpiOrders=null; if(!_flowPlan&&!_flowKey&&!_flowChan){ try{ const hk=await api(`/api/home?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`); kpiOrders=(hk&&hk.orders!=null)?hk.orders:null; }catch(_){} }
    host.innerHTML=flowPanel(data, kpiOrders);
    host.querySelectorAll(".fnode").forEach(g=>g.addEventListener("click",()=>openFlowDrill(g.dataset.lane,g.dataset.node)));
    wireFlowControls(host);
    // when filtered to a customer, fetch their order(s) to mark WHERE each ended + offer the timeline
    if(_flowKey){ try{ const lr=await api(`/api/onboarding-flow/locate?key=${encodeURIComponent(_flowKey)}`); _flowHits=(lr&&lr.matches)||[]; }catch(_){ _flowHits=[]; } }
    else { _flowHits=[]; }
    applyFlowHits(host); renderLocResults(host);
  }
  // re-outline the located node(s) after any re-render
  function applyFlowHits(host){
    host.querySelectorAll(".fnode.fhit").forEach(g=>g.classList.remove("fhit"));
    (_flowHits||[]).forEach(h=>{ const g=host.querySelector(`.fnode[data-lane="${h.lane}"][data-node="${h.node}"]`); if(g) g.classList.add("fhit"); });
  }
  function renderLocResults(host){
    const box=host.querySelector("#flowLocRes"); if(!box) return;
    if(!_flowKey){ box.innerHTML=''; return; }
    const hits=_flowHits||[];
    const ksa=iso=>{ try{ return KT.dt(iso); }catch(_){ return ''; } };
    if(!hits.length){ box.innerHTML=`<div class="lrow muted">No order found for “${esc(_flowKey)}” in this period — widen the date range if the order is older.</div>`; return; }
    const head=`<div class="lrow" style="border-left-color:#16a34a"><b>Filtered to ${esc(_flowKey)}</b> · <span>${hits.length} order${hits.length>1?'s':''} — the path each took is lit up in the tree above (ends at the glowing box)</span></div>`;
    box.innerHTML=head+hits.map(h=>`<div class="lrow"><b>${h.lane==='mnp'?'MNP':'New SIM'}</b> · ends at <span>${esc(FLOW_NM[h.node]||h.node)}</span>`
      +` <span class="muted">${esc(h.mobile||h.nationality_id_number||'—')}${h.id?` · order ${esc(h.id)}`:''} · ${esc(h.plan||('plan '+(h.plan_id||'—')))} · state ${esc(h.state||'—')} · pay ${esc(h.pay||'none')} · ${esc(ksa(h.at))} KSA</span>`
      +`<button class="fbtn ghost" data-tl="${esc(h.id)}">Timeline →</button></div>`).join('');
    box.querySelectorAll("[data-tl]").forEach(b=>b.addEventListener("click",()=>{ if(window.opsOpenTimeline) window.opsOpenTimeline(b.getAttribute("data-tl"), null, null); }));
  }
  // Locate = FILTER the whole tree to this customer, so its order(s) flow end-to-end through the boxes.
  function doLocate(host){ _flowKey=(_flowSearchVal||'').trim()||null; renderFlow(host); }
  function wireFlowControls(host){
    const sel=host.querySelector("#flowPlan"); if(sel) sel.addEventListener("change",()=>{ _flowPlan=sel.value||null; renderFlow(host); });
    const inp=host.querySelector("#flowSearch");
    if(inp){ inp.addEventListener("input",()=>{ _flowSearchVal=inp.value; }); inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); doLocate(host); } }); }
    const loc=host.querySelector("#flowLocate"); if(loc) loc.addEventListener("click",()=>doLocate(host));
    const clr=host.querySelector("#flowClear"); if(clr) clr.addEventListener("click",()=>{ _flowSearchVal=''; _flowKey=null; _flowHits=[]; if(inp) inp.value=''; renderFlow(host); });
    host.querySelectorAll("[data-chan]").forEach(b=>b.addEventListener("click",()=>{ _flowChan=b.getAttribute("data-chan")||null; renderFlow(host); }));
    const fcs=host.querySelector("#flowChanSel"); if(fcs) fcs.addEventListener("change",()=>{ _flowChan=fcs.value||null; renderFlow(host); });
  }
  const FLOW_NM={orders:'All orders',total:'All orders',elig_pass:'Eligibility pass',elig_fail:'Eligibility fail (submitted ID + nationality, check answered NO)',pre_elig:'Pre-eligibility drop (never submitted the ID form — browsing / plan / number selection abandonment, NOT a refusal)',total_payment:'Reached payment',no_payment:'Eligible · no payment (abandoned before paying, or not paid yet)',pay_success:'Payment success',pay_pending:'Payment pending',pay_fail:'Payment failed',esim:'eSIM',esim_activated:'eSIM · activated',esim_not_activated:'eSIM · not activated',physical:'Physical SIM',assigned:'Assigned for delivery',not_assigned:'Not assigned for delivery (Salam-fulfilled)',courier_not_created:'Courier not created (paid reseller order needing courier, but no delivery_requests row — dispatch backlog)',shop_pickup:'Shop pickup at reseller (apollo_require_delivery=false — delivery skipped, collected in-shop, not couriered)',delivered:'Delivered',not_delivered:'Not delivered',phys_activated:'Physical · activated',phys_not_activated:'Physical · not activated'};
  async function openFlowDrill(lane,node){
    const ov=document.getElementById("txnDrawer"); if(!ov) return; ov.classList.add("open");
    const body=document.getElementById("txnDrawerBody"); const W=_flowWin||{};
    const qnode = node==='total'?'orders':node;   // the first box = all orders in the lane
    const qs=`?lane=${encodeURIComponent(lane)}&node=${encodeURIComponent(qnode)}`+((W.from&&W.to)?`&from=${encodeURIComponent(W.from)}&to=${encodeURIComponent(W.to)}`:"")+(_flowPlan?`&plan=${encodeURIComponent(_flowPlan)}`:"")+(_flowKey?`&key=${encodeURIComponent(_flowKey)}`:"")+(_flowChan?`&channel=${encodeURIComponent(_flowChan)}`:"");
    const hd=`${lane==='mnp'?'MNP':'New SIM'}${_flowChan?` · ${_flowChan}`:''} · ${FLOW_NM[node]||node}`;
    body.innerHTML=`<div class="drawer-hd"><b>${esc(hd)}</b><span class="x" id="dwXf">×</span></div><div class="tl"><div class="sub" style="padding:16px 18px">Loading orders…</div></div>`;
    document.getElementById("dwXf").onclick=()=>ov.classList.remove("open");
    let r; try{ r=await api("/api/onboarding-flow/orders"+qs); }catch(e){ body.querySelector(".tl").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const rows=r.rows||[]; const ksa=iso=>{ try{ return KT.md(iso); }catch(_){ return ''; } };
    // renderList lets the Timeline drawer offer a ‹ Back that returns here (no re-fetch)
    function renderList(){
      let h=`<div class="drawer-hd"><b>${esc(hd)}</b><span class="x" id="dwXf2">×</span></div>`
        +`<div style="padding:12px 18px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)">${rows.length}${r.total>=200?'+':''} orders · ${r.unmasked?'🔓 PII visible · Super Admin':'🔒 PII masked'}</div><div class="tl">`;
      if(!rows.length) h+=`<div class="okbox">No orders at this node in the window.</div>`;
      rows.forEach(x=>{ h+=`<div class="tlitem"><span class="dot ${x.pay==='success'?'okdot':x.pay==='fail'?'faildot':'neutdot'}"></span>`
        +`<div class="src">${esc(x.mobile||'—')}${x.id?` <span style="color:var(--muted);font-weight:400;font-size:11px">· order ${esc(x.id)}</span>`:''}</div>`
        +`<div class="dt">state ${esc(x.state||'—')} · payment ${esc(x.pay||'none')}${(x.plan||x.plan_id)?` · ${esc(x.plan||('plan '+x.plan_id))}`:''}</div>`
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
      // carry the dashboard period + category so the drill-down matches the current window (shareable URL)
      goTS('', cat);
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
      const channels=`<div style="font-weight:700;font-size:12px;margin-bottom:2px">Reseller channels <span class="rl">(tygo · soob)</span></div><div class="rl" style="font-size:10px;margin-bottom:6px">Orders that actually came through each reseller app (order's external_service_name — includes test orders).</div>${chans.length?`<table style="width:100%;border-collapse:collapse">${chans.map((c,i)=>`<tr><td style="padding:4px 8px"><b>${esc(c.channel)}</b>${barCell(c.activated/maxC,PAL[i%PAL.length])}</td><td class="mono" style="text-align:right;padding:4px 8px">${n(c.orders)} ord</td><td class="mono" style="text-align:right;padding:4px 8px"><b>${n(c.activated)}</b></td><td class="mono" style="text-align:right;padding:4px 8px">${money(c.revenue)}</td></tr>`).join("")}</table>`:`<div class="rl">No tygo/soob orders yet in this window — resellers appear here once orders arrive through their app (external_service_name).</div>`}`;
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
  // ---- MNP port-ins by donor operator, as a configurable home section (follows dashboard range) ----
  async function renderMnpSection(holder, R){
    const pinKey='mnp_pin';
    const pinned=localStorage.getItem(pinKey)==='1';   // pinned → fixed 30d window, ignores the ops range
    holder.innerHTML=`<div class="rl" style="padding:6px 0">Loading port-ins…</div>`;
    let d; try{ d=await api('/api/growth/mnp-donors'+(pinned?growthRangeQS({hours:720}):growthRangeQS(R))); }
    catch(e){ holder.innerHTML=`<div class="albanner">Port-ins need the console API. ${esc(e.message)}</div>`; return; }
    const n=x=>Number(x||0).toLocaleString("en-US"), pct=x=>x==null?"—":(x*100).toFixed(1)+"%";
    const PAL=["#0d9488","#2563eb","#7c3aed","#ea580c","#d97706","#0891b2","#4f46e5","#dc2626"];
    const barCell=(frac,c)=>`<div style="height:6px;border-radius:4px;background:var(--line-soft,rgba(148,163,184,.18));margin-top:3px"><div style="height:6px;border-radius:4px;width:${Math.max(0,Math.min(100,Math.round((frac||0)*100)))}%;background:${c}"></div></div>`;
    const chip=(t,v,c)=>`<div style="flex:1;min-width:140px;background:var(--card2,rgba(148,163,184,.06));border:1px solid var(--line);border-radius:10px;padding:8px 12px"><div style="font-size:18px;font-weight:800;color:${c}">${v}</div><div class="rl" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.03em">${esc(t)}</div></div>`;
    const donors=d.donors||[]; const maxT=Math.max(1,...donors.map(x=>x.total));
    const pinRow=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span class="rl">Window: <b>${pinned?'30d — pinned':esc(rangeLabel())+' — follows dashboard'}</b></span>`+
      `<button class="pill mnp-pin" title="${pinned?'Pinned to a fixed 30-day window. Click to follow the dashboard range.':'Following the dashboard range. Click to pin a fixed 30-day window.'}" style="padding:2px 10px;margin-left:auto;${pinned?'border-left-color:var(--blue)':''}">${pinned?'📌 30d · unpin':'📌 Pin 30d'}</button></div>`;
    const table=donors.length?`<table style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left;font-size:10px;color:var(--muted);padding:4px 8px">DONOR OPERATOR</th><th style="text-align:right;font-size:10px;color:var(--muted);padding:4px 8px">PORT-INS</th><th style="text-align:right;font-size:10px;color:var(--muted);padding:4px 8px">SHARE</th><th style="text-align:right;font-size:10px;color:var(--muted);padding:4px 8px">ACTIVATED</th><th style="text-align:right;font-size:10px;color:var(--muted);padding:4px 8px">ACTIVATION</th></tr>
      ${donors.map((x,i)=>`<tr><td style="padding:4px 8px"><b>${esc(x.operator)}</b>${barCell(x.total/maxT,PAL[i%PAL.length])}</td><td class="mono" style="text-align:right;padding:4px 8px"><b>${n(x.total)}</b></td><td class="mono" style="text-align:right;padding:4px 8px">${pct(x.share)}</td><td class="mono" style="text-align:right;padding:4px 8px">${n(x.activated)}</td><td class="mono" style="text-align:right;padding:4px 8px">${pct(x.activationRate)}</td></tr>`).join("")}</table>
      <div class="rl" style="margin-top:6px;font-size:10px">Where subscribers are porting FROM. Activation = the port completed and the line went live; low activation on a donor = porting friction.</div>`
      :`<div class="rl" style="padding:8px 0">No port-ins in this window.</div>`;
    holder.innerHTML=pinRow+`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${chip("Total port-ins",n(d.totalPortins),"#0d9488")}${chip("Top donor",esc(d.topDonor||"—"),"#2563eb")}${chip("Overall activation",pct(d.overallActivationRate),"#7c3aed")}${chip("Donor networks",n(donors.length),"#ea580c")}</div><div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px">${table}</div>`;
    const pb=holder.querySelector('.mnp-pin'); if(pb) pb.addEventListener('click',()=>{ localStorage.setItem(pinKey, pinned?'0':'1'); renderMnpSection(holder, R); });
  }
  /* ---- SERVICING · existing customers (recharges · bills · change plans · vouchers) ----
   * Same selected range as the rest of the dashboard. Chart + table with lane/status filters.
   * Every row drills: payments/change-plans → Transaction timeline; vouchers → txn analyzer
   * (vouchers write no DB row — the API-log capture is their only record, 7-day retention). */
  let _svcLane='', _svcStatus='', _svcData=null, _svcKey='', _svcWin=null, _svcHost=null;
  const SVC_NM={recharge:'Recharge',bill:'Bill payment',renewal:'Renewal',change_plan:'Change plan (paid)',
    change_plan_journey:'Change plan (journey)',sim_replacement:'SIM replacement',ownership:'Ownership transfer',
    advanced_postpaid:'Advanced postpaid',voucher:'Voucher recharge'};
  const svcName=l=>SVC_NM[l]||l;
  const SVC_PAL={recharge:'#0d9488',bill:'#2563eb',renewal:'#7c3aed',change_plan:'#ea580c',change_plan_journey:'#d97706',
    sim_replacement:'#0891b2',ownership:'#4f46e5',advanced_postpaid:'#db2777',voucher:'#16a34a'};
  async function renderServicing(holder, R){
    holder.innerHTML=`<div class="rl" style="padding:6px 0">Loading servicing journeys…</div>`;
    let win; if(R&&R.from&&R.to){ win={from:R.from,to:R.to}; } else { const d=new Date(); d.setUTCMinutes(0,0,0); d.setUTCHours(d.getUTCHours()+1); win={to:d.toISOString(),from:new Date(d.getTime()-((R&&R.hours)||24)*3600e3).toISOString()}; }
    _svcWin=win; _svcHost=holder;
    const keyQS=_svcKey?`&key=${encodeURIComponent(_svcKey)}`:'';
    let d; try{ d=await api(`/api/servicing?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}${keyQS}`); }
    catch(e){ holder.innerHTML=`<div class="albanner">Servicing view needs the console API. ${esc(e.message)}</div>`; return; }
    _svcData=d; svcDraw(holder);
  }
  function svcDraw(holder){
    const d=_svcData; if(!d) return;
    const n=x=>Number(x||0).toLocaleString("en-US");
    const lanes=d.lanes||[];
    // customer filter bar (server-side resolution: msisdn / customer id / national id)
    const F=d.filtered;
    const filterBar=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <span class="rl" style="font-weight:700">Customer</span>
      <input id="svcKey" placeholder="MSISDN / customer id / national id" value="${esc(_svcKey)}" class="mono"
        style="padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2,rgba(148,163,184,.06));color:var(--ink);font-size:11.5px;width:230px">
      <button class="pill" id="svcKeyGo" style="padding:3px 12px">Filter</button>
      ${_svcKey?`<button class="pill" id="svcKeyClr" style="padding:3px 12px">Clear</button>`:''}
      ${F&&F.found?`<span class="rl" style="color:#0e9f5a;font-weight:700">filtered · matched via ${esc(F.via)}</span>${F.voucher_note?`<span class="rl" style="font-size:10px;color:var(--muted)">· ${esc(F.voucher_note)}</span>`:''}`:''}
      ${F&&F.found===false?`<span class="rl" style="color:#d97706;font-weight:700">${esc(F.note||'no match')}</span>`:''}
    </div>`;
    const wireFilter=()=>{
      const go=()=>{ const v=(holder.querySelector('#svcKey')||{}).value||''; _svcKey=v.trim(); renderServicing(_svcHost||holder, _svcWin?{from:_svcWin.from,to:_svcWin.to}:null); };
      const b=holder.querySelector('#svcKeyGo'); if(b) b.addEventListener('click',go);
      const i=holder.querySelector('#svcKey'); if(i) i.addEventListener('keydown',e=>{ if(e.key==='Enter') go(); });
      const c=holder.querySelector('#svcKeyClr'); if(c) c.addEventListener('click',()=>{ _svcKey=''; renderServicing(_svcHost||holder, _svcWin?{from:_svcWin.from,to:_svcWin.to}:null); });
    };
    if(!lanes.length){
      holder.innerHTML=filterBar+`<div class="rl" style="padding:8px 0">${F&&F.found===false?'No transactions — customer not found.':_svcKey?'No servicing transactions for this customer in this window.':'No servicing transactions in this window.'}</div>`;
      wireFilter(); return;
    }
    // lane cards — click to filter chart + table
    const card=l=>{ const c=SVC_PAL[l.lane]||'#64748b'; const on=_svcLane===l.lane;
      const rate=l.total?Math.round(100*(l.ok||0)/l.total):null;
      return `<div class="svc-card" data-lane="${esc(l.lane)}" title="${esc(l.source_note||'click to filter')}" style="flex:1;min-width:158px;cursor:pointer;background:var(--card2,rgba(148,163,184,.06));border:1px solid ${on?c:'var(--line)'};${on?`box-shadow:0 0 0 1px ${c};`:''}border-radius:10px;padding:8px 12px">
        <div style="display:flex;align-items:baseline;gap:6px"><span style="font-size:18px;font-weight:800;color:${c}">${n(l.total)}</span>
          <span style="font-size:11px;font-weight:700;color:${rate==null?'var(--muted)':rate>=90?'#16a34a':rate>=60?'#d97706':'#dc2626'}">${rate==null?'':rate+'%✓'}</span></div>
        <div class="rl" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.03em">${esc(svcName(l.lane))}</div>
        <div class="rl" style="font-size:10px;margin-top:2px"><span style="color:#16a34a">${n(l.ok)} ok</span> · <span style="color:#dc2626">${n(l.fail)} fail</span>${l.pending?` · <span style="color:#d97706">${n(l.pending)} pend</span>`:''}${l.rate_limited?` · <span style="color:#e11d48">${n(l.rate_limited)} blocked</span>`:''}</div>
      </div>`; };
    // stacked chart over time for the selected lane (or all)
    const S=(d.series||[]).filter(r=>!_svcLane||r.lane===_svcLane);
    const bx=new Map();
    S.forEach(r=>{ const k=String(r.t); let b=bx.get(k); if(!b){ b={t:k,total:0,ok:0,fail:0}; bx.set(k,b); } b.total+=r.total||0; b.ok+=r.ok||0; b.fail+=r.fail||0; });
    const B=[...bx.values()].sort((a,b)=>new Date(a.t)-new Date(b.t));
    let chart='';
    if(B.length>1){
      const W=980,HT=110,pl=38,pb=16,pt=6;
      const maxV=Math.max(...B.map(r=>r.total),1);
      const bw=Math.max(3,Math.floor((W-pl)/B.length)-2);
      const x=i=>pl+i*((W-pl)/B.length), y=v=>HT-pb-(v/maxV)*(HT-pb-pt);
      let g='';
      B.forEach((r,i)=>{ const lbl=d.unit==='hour'?KT.dt(r.t):KT.d(r.t);
        const pend=Math.max(0,r.total-r.ok-r.fail);
        let y0=HT-pb;
        [['ok','#10b981',r.ok],['fail','#ef4444',r.fail],['pend','#d9770688',pend]].forEach(([k2,c2,v2])=>{
          if(!v2) return; const h=(v2/maxV)*(HT-pb-pt); y0-=h;
          g+=`<rect x="${x(i)}" y="${y0}" width="${bw}" height="${Math.max(1,h)}" fill="${c2}"><title>${esc(lbl)}: ${v2} ${k2}</title></rect>`; });
        if(i%Math.ceil(B.length/14)===0) g+=`<text x="${x(i)+bw/2}" y="${HT-3}" text-anchor="middle" font-size="7.5" fill="var(--muted)">${esc(d.unit==='hour'?lbl.slice(11,16):lbl.slice(5))}</text>`; });
      chart=`<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:10px">
        <div class="rl" style="font-weight:700;font-size:11px;margin-bottom:4px">${esc(_svcLane?svcName(_svcLane):'All servicing')} per ${esc(d.unit)} <span style="font-weight:600;color:var(--muted)">· green ok · red fail · amber pending/abandoned</span></div>
        <svg viewBox="0 0 ${W} ${HT}" style="width:100%;height:${HT}px">${g}</svg></div>`;
    }
    // table + status filter
    const stChip=(v,lbl)=>`<button class="pill svc-st" data-st="${esc(v)}" style="padding:2px 10px;font-size:10.5px;${_svcStatus===v?'border-left-color:var(--blue);font-weight:800;':''}">${esc(lbl)}</button>`;
    const rows=(d.rows||[]).filter(r=>(!_svcLane||r.lane===_svcLane)&&(!_svcStatus||String(r.status)===_svcStatus)).slice(0,40);
    const stCol=s=>s==='success'?'#16a34a':/fail/.test(s)?'#dc2626':s==='rate-limited'?'#e11d48':s==='technical'?'#dc2626':s==='business'?'#3b82f6':'#d97706';
    const ksa=iso=>{ try{ return KT.md(iso); }catch(_){ return ''; } };
    const table=`<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <span class="rl" style="font-weight:700">Latest transactions</span>
        ${stChip('','All')}${stChip('success','Success')}${stChip('failed','Failed')}${stChip('fail','Fail')}${stChip('pending','Pending')}${stChip('rate-limited','Blocked (-704)')}
        <span class="rl" style="margin-left:auto;font-size:10px">vouchers: from API-log capture · last 7 days · PII masked — drill for detail</span></div>
      ${rows.length?`<table style="width:100%;border-collapse:collapse;font-size:11.5px">
        <tr><th style="text-align:left;font-size:10px;color:var(--muted);padding:3px 6px">WHEN (KSA)</th><th style="text-align:left;font-size:10px;color:var(--muted)">JOURNEY</th><th style="text-align:left;font-size:10px;color:var(--muted)">MOBILE</th><th style="text-align:left;font-size:10px;color:var(--muted)">DETAIL</th><th style="text-align:left;font-size:10px;color:var(--muted)">STATUS</th><th></th></tr>
        ${rows.map(r=>`<tr style="border-top:1px solid var(--line)">
          <td class="mono" style="padding:3px 6px;white-space:nowrap">${esc(ksa(r.at))}</td>
          <td><span style="color:${SVC_PAL[r.lane]||'var(--ink)'};font-weight:700">${esc(svcName(r.lane))}</span></td>
          <td class="mono">${esc(r.mobile||'—')}</td>
          <td class="rl" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.detail||'')}">${esc(r.detail||'')}</td>
          <td><span style="color:${stCol(String(r.status))};font-weight:700">${esc(r.status)}</span></td>
          <td style="text-align:right">${r.row?`<button class="pill" data-svctl="${esc(r.row)}" style="padding:2px 8px;font-size:10px">Timeline →</button>`
            :r.txn?`<button class="pill" data-svctxn="${esc(r.txn)}" style="padding:2px 8px;font-size:10px" title="app ⇄ APIGW ⇄ UIL">⇄ Analyze</button>`:''}</td></tr>`).join('')}</table>`
        :`<div class="rl" style="padding:8px 0">No transactions match the current filters.</div>`}</div>`;
    holder.innerHTML=filterBar+`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${lanes.map(card).join('')}</div>`+chart+table;
    wireFilter();
    holder.querySelectorAll('.svc-card').forEach(c=>c.addEventListener('click',()=>{ _svcLane=_svcLane===c.dataset.lane?'':c.dataset.lane; svcDraw(holder); }));
    holder.querySelectorAll('.svc-st').forEach(b=>b.addEventListener('click',()=>{ _svcStatus=b.dataset.st; svcDraw(holder); }));
    holder.querySelectorAll('[data-svctl]').forEach(b=>b.addEventListener('click',()=>{ if(window.opsOpenTimeline) window.opsOpenTimeline(null, b.dataset.svctl, null); }));
    holder.querySelectorAll('[data-svctxn]').forEach(b=>b.addEventListener('click',()=>{ if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(b.dataset.svctxn); }));
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
  // restore the saved range highlight/state into the picker UI on load
  function reflectHomeRange(){
    if(!rangeBox) return;
    const btns=[...rangeBox.querySelectorAll("button")];
    btns.forEach(x=>x.classList.remove("on"));
    if(homeCustom){
      if(clearB) clearB.style.display="";
      if(homeCustom.fv && fromI) fromI.value=homeCustom.fv;
      if(homeCustom.tv && toI) toI.value=homeCustom.tv;
    } else {
      if(clearB) clearB.style.display="none";
      let b = (homeRangeIdx!=null && btns[homeRangeIdx]) ? btns[homeRangeIdx]
            : btns.find(x=> homeYesterday ? x.dataset.yday : (!x.dataset.yday && Number(x.dataset.h)===homeRangeH));
      (b||btns[0]).classList.add("on");
    }
    // restore the intra-day sub-range highlight (#homeToday: Last hour / 3h / 6h / 12h / 24h)
    const tb=document.getElementById("homeToday");
    if(tb){ const tbtns=[...tb.querySelectorAll("button")]; tbtns.forEach(x=>x.classList.remove("on"));
      const t=tbtns.find(x=>Number(x.dataset.h)===homeTodayH); if(t) t.classList.add("on"); }
    syncTodayVis();
  }
  if(rangeBox) rangeBox.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    homeCustom=null; if(clearB) clearB.style.display="none";   // a segment range overrides any custom date range
    if(b.dataset.yday){ homeYesterday=true; } else { homeYesterday=false; homeRangeH=Number(b.dataset.h); }
    homeRangeIdx=[...rangeBox.querySelectorAll("button")].indexOf(b);
    rangeBox.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); saveHomeRange(); syncTodayVis(); renderKpis(); renderDash();
  }));
  const todayBox=$("#homeToday");
  if(todayBox) todayBox.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    homeCustom=null; if(clearB) clearB.style.display="none";
    homeTodayH=Number(b.dataset.h); todayBox.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); saveHomeRange(); renderKpis(); renderDash();
  }));
  // from→to date range picker (overrides the segment ranges). Each date = a full KSA calendar day.
  const fromI=$("#homeFrom"), toI=$("#homeTo"), applyB=$("#homeDateApply");
  const ksaDayStart=s=>{ const [y,m,d]=String(s).split('-').map(Number); return new Date(Date.UTC(y,m-1,d)-3*3600e3); };  // 00:00 KSA of that date, as UTC
  function applyDates(){
    const fv=fromI&&fromI.value, tv=toI&&toI.value; if(!fv||!tv) return;
    let a=ksaDayStart(fv).getTime(), b=ksaDayStart(tv).getTime()+24*3600e3;   // inclusive of both KSA days
    if(a>=b){ const lo=Math.min(ksaDayStart(fv).getTime(),ksaDayStart(tv).getTime()), hi=Math.max(ksaDayStart(fv).getTime(),ksaDayStart(tv).getTime())+24*3600e3; a=lo; b=hi; }  // swap if reversed
    homeCustom={ from:new Date(a).toISOString(), to:new Date(b).toISOString(), label:`${fv} → ${tv}`, fv:fv, tv:tv };
    homeYesterday=false; homeRangeIdx=null;
    if(rangeBox) rangeBox.querySelectorAll("button").forEach(x=>x.classList.remove("on"));
    if(clearB) clearB.style.display="";
    saveHomeRange(); syncTodayVis(); renderKpis(); renderDash();
  }
  if(applyB) applyB.addEventListener("click", applyDates);
  if(clearB) clearB.addEventListener("click",()=>{
    homeCustom=null; if(fromI)fromI.value=""; if(toI)toI.value=""; clearB.style.display="none";
    homeRangeH=24; homeYesterday=false; homeRangeIdx=0;
    if(rangeBox){ rangeBox.querySelectorAll("button").forEach(x=>x.classList.remove("on")); const td=rangeBox.querySelector('[data-h="24"]'); if(td) td.classList.add("on"); }
    saveHomeRange(); syncTodayVis(); renderKpis(); renderDash();
  });
  reflectHomeRange();   // apply the restored range selection to the picker UI on load
  document.addEventListener("themechange",()=>{ if($("#view-home")&&$("#view-home").classList.contains("active")) renderDash(); });
  // live auto-refresh (SSE-driven) — update KPIs + panels in place, no reload
  document.addEventListener("opsdatarefresh",()=>{ if($("#view-home")&&$("#view-home").classList.contains("active")){ renderNoc(); renderAnoms(); renderKpis(); renderDash(); } });
  // first render once the session (name + prefs) is loaded
  document.addEventListener("consoleReady", ()=>{ if($("#view-home")&&$("#view-home").classList.contains("active")) renderAll(); });

  /* Sticky range bar: toggle .stuck when the bar reaches its sticky offset (55px header), so it
   * gains an opaque card background + shadow only while floating over content. rAF-throttled
   * scroll listener — an IntersectionObserver sentinel would need DOM insertion for no gain. */
  (function(){
    const bar=document.querySelector('#view-home .home-bar'); if(!bar) return;
    let t=false;
    const on=()=>{ t=false; bar.classList.toggle('stuck', bar.getBoundingClientRect().top<=56 && window.scrollY>10); };
    document.addEventListener('scroll',()=>{ if(!t){ t=true; requestAnimationFrame(on); } },{passive:true});
    on();
  })();
})();
