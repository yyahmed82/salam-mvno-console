/* landing.js — HOME · executive landing for both businesses (5 Sep 2026, v2).
 * Layout: hero (greeting · date · global status indicators) → executive insights (auto-written from anomalies + fixed
 * deltas) → growth row (7-day vs previous 7 days, 30-day sparklines) → two equal business columns (Mobile · Fixed) →
 * needs-attention (open alerts + open Fixed error categories). Reads existing endpoints only. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const num=v=>Number(v||0).toLocaleString("en-US");
  const pct=v=>v==null?"—":Math.round(Number(v)*100)+"%";
  const sess=()=>{ try{ return (window.opsSession&&window.opsSession())||{}; }catch(e){ return {}; } };
  const api=p=>fetch((window.API_BASE||"")+p,{headers:{"Content-Type":"application/json"}}).then(async r=>{ const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j; });
  const ksaHour=()=>Number(new Date().toLocaleString("en-GB",{timeZone:"Asia/Riyadh",hour:"2-digit",hour12:false}));
  const greet=()=>{ const h=ksaHour(); return h<12?"Good morning":h<17?"Good afternoon":h<21?"Good evening":"Working late"; };
  const today=()=>new Date().toLocaleDateString("en-GB",{timeZone:"Asia/Riyadh",weekday:"long",day:"2-digit",month:"long",year:"numeric"});
  const first=()=>{ const me=sess().me; const nm=(me&&me.name)||(sess().email?sess().email.split("@")[0]:"there"); return String(nm).split(/\s+/)[0]; };
  const views=()=>((sess().me||{}).views)||[];
  const delta=(cur,prv)=>{ if(cur==null||prv==null||!prv) return ""; const d=(cur-prv)/prv, up=d>=0; return `<span class="ld-delta" style="color:${up?"#16a34a":"#dc2626"}">${up?"▲":"▼"} ${Math.abs(d*100).toFixed(0)}%</span>`; };
  const spark=(arr,color)=>{ if(!arr||arr.length<2) return ""; const w=120,h=30,mx=Math.max(...arr,1); const pts=arr.map((v,i)=>`${(i/(arr.length-1)*w).toFixed(1)},${(h-(v/mx)*(h-3)-1).toFixed(1)}`).join(" ");
    return `<svg class="ld-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color||"#0e9f5a"}" stroke-width="2" stroke-linejoin="round"/><polyline points="0,${h} ${pts} ${w},${h}" fill="${color||"#0e9f5a"}" opacity=".12"/></svg>`; };
  const tile=(label,value,sub,href,accent)=>`<a href="${href}" class="ld-tile${accent?" ld-"+accent:""}"><div class="ld-v">${value}</div><div class="ld-l">${esc(label)}</div>${sub?`<div class="ld-s">${sub}</div>`:""}</a>`;
  const rate=(r,t)=>{ if(r==null) return "—"; const c=r>=(t||.95)?"#16a34a":r>=(t||.95)-.02?"#d97706":"#dc2626"; return `<span style="color:${c}">${pct(r)}</span>`; };
  const bucket=(arr,n)=>{ if(!arr||!arr.length) return []; const size=Math.max(1,Math.ceil(arr.length/n)); const out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size).reduce((a,b)=>a+b,0)); return out; };

  function shell(){
    const host=$("#view-landing"); if(!host) return;
    host.innerHTML=`<div class="ld-wrap">
      <div class="ld-hero">
        <div class="ld-hero-l"><h1 class="ld-h1">${esc(greet())}, ${esc(first())}</h1>
          <div class="ld-sub">${esc(today())} · KSA · one console, both businesses</div></div>
        <div class="ld-hero-r"><div class="ld-status-lbl">GLOBAL STATUS</div><div id="ldStatus" class="ld-status"><span class="ld-loading">checking…</span></div></div>
      </div>
      <div id="ldInsights" class="ld-insights"></div>
      <div class="ld-sec"><h3>Growth <span>7 days vs the 7 before · 30-day trend</span></h3><div id="ldGrowth" class="ld-growth"><div class="ld-loading">Loading…</div></div></div>
      <div class="ld-cols">
        <section class="ld-col" id="ldMobile"><div class="ld-colh"><span class="ld-ic">📱</span><div><h2>Mobile</h2><div class="ld-colsub">MVNO · selfcare app, DMS dealers, payments, activation · last 24 h</div></div><a href="#dashboard" class="ld-open">Dashboard →</a></div><div class="ld-body"><div class="ld-loading">Loading…</div></div></section>
        <section class="ld-col" id="ldFixed"><div class="ld-colh"><span class="ld-ic">🏠</span><div><h2>Fixed</h2><div class="ld-colsub">FTTH · 5G home · SDA dealers · e-purchase / QR · Salam Home app · last 24 h</div></div><a href="#fixed" class="ld-open">Overview →</a></div><div class="ld-body"><div class="ld-loading">Loading…</div></div></section>
      </div>
      <div class="ld-sec" id="ldMineSec"><h3>My incidents <span>what I acknowledged or was handed — age, time in my hands, SLA</span></h3><div id="ldMine" class="ld-mine"><div class="ld-loading">Loading…</div></div></div>
      <div class="ld-sec"><h3>Needs attention <span>open incidents and open Fixed error categories</span></h3><div id="ldAttention" class="ld-att"><div class="ld-loading">Loading…</div></div></div>
      <div class="ld-quick">
        <a href="#subscriber" class="ld-q">◉ Customer 360</a><a href="#alerts" class="ld-q" data-biz="mobile">🔔 Alerts</a><a href="#troubleshoot" class="ld-q" data-biz="mobile">⚡ Troubleshoot</a><a href="#fixed?tab=map" class="ld-q" data-biz="fixed">🗺 SDA map</a><a href="#fixed?tab=errors" class="ld-q" data-biz="fixed">⚠ Fixed errors</a><a href="#fixed?tab=alerts" class="ld-q" data-biz="fixed">🔔 Fixed alerts</a><a href="#analytics" class="ld-q" data-biz="mobile">📈 Analytics</a>
      </div>
    </div>`;
    ensureCss(); load();
  }

  async function load(){
    const biz=(sess().me||{}).business||"both";
    renderMine();   // independent of the business fetches below
    const canM=views().includes("dashboard")&&biz!=="fixed", canF=views().includes("fixed")&&biz!=="mobile";
    // a single-business account sees a single-column home; the other column is removed, not greyed
    const mc=$("#ldMobile"), fc=$("#ldFixed"); if(mc) mc.hidden=(biz==="fixed"); if(fc) fc.hidden=(biz==="mobile");
    /* single-business account: one full-width column (no empty twin), only that business's quick links,
     * and the "Needs attention" heading names what it will show */
    const wrap=$(".ld-wrap"); if(wrap) wrap.classList.toggle("ld-single", biz!=="both");
    document.querySelectorAll(".ld-q[data-biz]").forEach(a=>{ a.hidden=(biz!=="both"&&a.dataset.biz!==biz); });
    const attSpan=[...document.querySelectorAll("#view-landing .ld-sec h3 span")].find(x=>/incidents/.test(x.textContent));
    if(attSpan) attSpan.textContent=biz==="mobile"?"open incidents, anomalies and error categories":biz==="fixed"?"open Fixed error categories":"open incidents and open Fixed error categories";
    const sub=$(".ld-sub"); if(sub&&biz!=="both") sub.textContent=sub.textContent.replace("one console, both businesses", biz==="fixed"?"Fixed business":"Mobile business");
    const P=(p,fb)=>api(p).catch(()=>fb);
    const now=Date.now(), d7=7*864e5;
    const [m24,m7,noc,anoms,al,f24,f7,f7p,f30,merr]=await Promise.all([
      canM?P("/api/home?hours=24",null):null, canM?P("/api/home?hours=168",null):null, canM?P("/api/noc",{}):{}, canM?P("/api/anomalies",{}):{}, canM?P("/api/alerts?status=open",[]):[],
      canF?P("/api/fixed/summary?range=24h",null):null, canF?P("/api/fixed/summary?range=7d",null):null,
      canF?P(`/api/fixed/summary?from=${encodeURIComponent(new Date(now-2*d7).toISOString())}&to=${encodeURIComponent(new Date(now-d7).toISOString())}`,null):null,
      canF?P("/api/fixed/summary?range=30d",null):null,
      canM?P("/api/errors/summary?window=24",null):null ]);
    renderStatus({m24,noc,f24,al}); renderInsights({m24,m7,anoms,f7,f7p,f24}); renderGrowth({m7,f7,f7p,f30}); renderMobile({m24,noc,al,canM}); renderFixed({f24,canF}); renderAttention({al,f24,anoms,merr});
  }

  function renderStatus({m24,noc,f24,al}){
    const S=[]; const open=Array.isArray(al)?al:(al&&al.rows)||[]; const p1=open.filter(a=>a.severity==="P1").length;
    const st=(noc&&noc.status)||(m24?"ok":"na");
    S.push(["Mobile journeys", st==="ok"?"ok":st==="degraded"?"warn":st==="na"?"na":"bad", (noc&&noc.headline)||"NOC status", "#dashboard"]);
    if(m24){ const t=(m24.targets||{}); S.push(["Payments", m24.payRate==null?"na":m24.payRate>=(t.pay||.95)?"ok":m24.payRate>=(t.pay||.95)-.02?"warn":"bad", `success ${pct(m24.payRate)} · ${num(m24.paidFail)} failed`, "#troubleshoot?cat=payment"]);
      S.push(["Activation", m24.actRate==null?"na":m24.actRate>=(t.act||.95)?"ok":"warn", `BSS ${pct(m24.actRate)}`, "#troubleshoot?cat=activation"]); }
    if(f24){ const k=f24.kpis||{}, naf=(f24.integrations||{}).nafath||{}, fr=f24.freshness||{}; const openErr=(f24.errors||[]).reduce((a,e)=>a+Number(e.open||0),0);
      S.push(["Fixed journeys", fr.stale?"warn":openErr>2000?"warn":"ok", `${num(k.attempts)} attempts · ${k.conversion||0}% completed`, "#fixed"]);
      S.push(["Identity (Nafath)", naf.total?(naf.failRate>25?"bad":naf.failRate>12?"warn":"ok"):"na", naf.total?`fail ${naf.failRate}% on ${num(naf.total)} checks`:"no 5G checks", "#fixed?tab=dash"]);
      S.push(["Fixed data", fr.stale?"bad":"ok", fr.stale?`watcher ${fr.lag_min} min behind`:`live · ${fr.lag_min==null?"—":fr.lag_min+" min"}`, "#fixed"]); }
    S.push(["Incidents", p1?"bad":open.length?"warn":"ok", `${open.length} open${p1?` · ${p1} P1`:""}`, "#alerts"]);
    const col={ok:"#16a34a",warn:"#d97706",bad:"#dc2626",na:"#94a3b8"};
    $("#ldStatus").innerHTML=S.map(([l,s,t,h])=>`<a href="${h}" class="ld-pill" data-tip="${esc(t)}" style="--c:${col[s]}"><span class="ld-pd"></span>${esc(l)}</a>`).join("");
    tips($("#ldStatus"));
  }

  function renderInsights({m24,m7,anoms,f7,f7p,f24}){
    const box=$("#ldInsights"); const M=[], F=[];
    const list=((anoms&&anoms.anomalies)||[]).slice().sort((a,b)=>Math.abs(b.score||0)-Math.abs(a.score||0)).slice(0,3);
    list.forEach(a=>M.push({sev:a.severity||"P3", text:a.text||`${a.metric||""} ${a.direction==="up"?"above":"below"} its seasonal norm (${Math.abs(a.score||0).toFixed(1)}σ)`, href:"#sla", tag:"Mobile"}));
    if(m7&&m7.prev){ const c=m7.actOk, p=m7.prev.actOk; if(c!=null&&p){ const d=(c-p)/p; M.push({sev:Math.abs(d)>.15?"P2":"info", text:`Mobile activations ${d>=0?"up":"down"} ${Math.abs(d*100).toFixed(0)}% week-on-week (${num(c)} vs ${num(p)})`, href:"#dashboard", tag:"Mobile"}); } }
    if(m24&&m24.errorsTechnical>0) M.push({sev:m24.errorsTechnical>50?"P2":"P3", text:`${num(m24.errorsTechnical)} technical errors on Mobile in 24 h (platform failed to answer) · ${num(m24.errorsBusiness)} business errors`, href:"#troubleshoot?cls=technical", tag:"Mobile"});
    // Fixed — today's open error categories first (what the operator must act on), then the weekly trends
    const fe=((f24&&f24.errors)||[]).filter(e=>e.open>0).sort((a,b)=>b.open-a.open);
    if(fe.length){ const tot=fe.reduce((a,e)=>a+Number(e.open||0),0); const top=fe[0];
      F.push({sev:top.open>1000?"P1":top.open>100?"P2":"P3", text:`${num(tot)} open Fixed errors in 24 h across ${fe.length} categories — top ${top.category} ${num(top.open)}${fe[1]?`, then ${fe[1].category} ${num(fe[1].open)}`:""}`, href:"#fixed?tab=errors", tag:"Fixed"}); }
    if(f7&&f7p){ const c=f7.kpis||{}, p=f7p.kpis||{}; if(p.completed){ const d=(c.completed-p.completed)/p.completed; F.push({sev:Math.abs(d)>.15?"P2":"info", text:`Fixed completed orders ${d>=0?"up":"down"} ${Math.abs(d*100).toFixed(0)}% week-on-week (${num(c.completed)} vs ${num(p.completed)}) · conversion ${c.conversion}% vs ${p.conversion}%`, href:"#fixed?tab=dash", tag:"Fixed"}); }
      const naf=(f7.integrations||{}).nafath||{}; if(naf.total&&naf.failRate>12) F.push({sev:naf.failRate>25?"P2":"P3", text:`Nafath failing on ${naf.failRate}% of ${num(naf.total)} 5G identity checks (7 d)`, href:"#fixed?tab=dash", tag:"Fixed"}); }
    else if(f24){ const k=f24.kpis||{}; if(k.attempts) F.push({sev:"info", text:`Fixed today: ${num(k.attempts)} attempts, ${num(k.completed)} completed (${k.conversion}%)`, href:"#fixed", tag:"Fixed"}); }
    const rank={P1:0,P2:1,P3:2,info:3}; const bySev=(a,b)=>rank[a.sev]-rank[b.sev];
    const out=M.sort(bySev).slice(0,3).concat(F.sort(bySev).slice(0,3));
    if(!out.length){ box.style.display="none"; return; }
    const col={P1:"#dc2626",P2:"#d97706",P3:"#2563eb",info:"#0e9f5a"};
    box.style.display="grid"; box.innerHTML=out.map(i=>`<a href="${i.href}" class="ld-ins" style="--c:${col[i.sev]||"#64748b"}"><span class="ld-ins-tag">${esc(i.tag)}</span><span class="ld-ins-sev">${esc(i.sev==="info"?"trend":i.sev)}</span><span class="ld-ins-t">${esc(i.text)}</span></a>`).join("");
  }

  function renderGrowth({m7,f7,f7p,f30}){
    const box=$("#ldGrowth"); const cards=[];
    if(m7){ const p=m7.prev||{}, sp=m7.spark||{};
      cards.push(gcard("Mobile activations","7 d",num(m7.actOk),delta(m7.actOk,p.actOk),spark(bucket(sp.actOk,30),"#0e9f5a"),"#dashboard"));
      cards.push(gcard("Mobile orders","7 d",num(m7.orders),delta(m7.orders,p.orders),spark(bucket(sp.orders,30),"#2563eb"),"#dashboard")); }
    if(f7){ const c=f7.kpis||{}, p=(f7p&&f7p.kpis)||{}; const days=(f30&&f30.byDay)||[];
      cards.push(gcard("Fixed completed","7 d",num(c.completed),delta(c.completed,p.completed),spark(days.map(x=>Number(x.completed||0)),"#0e9f5a"),"#fixed?tab=dash"));
      cards.push(gcard("Fixed attempts","7 d",num(c.attempts),delta(c.attempts,p.attempts),spark(days.map(x=>Number(x.n||0)),"#2563eb"),"#fixed?tab=dash")); }
    box.innerHTML=cards.join("")||`<div class="ld-loading">No growth data for your role.</div>`;
  }
  const gcard=(l,w,v,d,sp,href)=>`<a href="${href}" class="ld-g"><div class="ld-g-l">${esc(l)} <span>${esc(w)}</span></div><div class="ld-g-v">${v} ${d}</div>${sp}</a>`;

  function renderMobile({m24,noc,al,canM}){
    const body=$("#ldMobile .ld-body"); if(!canM){ body.innerHTML=`<div class="ld-loading">Your role has no Mobile dashboard access.</div>`; return; }
    if(!m24){ body.innerHTML=`<div class="ld-loading" style="color:#dc2626">Mobile data unavailable.</div>`; return; }
    const d=m24, open=Array.isArray(al)?al:(al&&al.rows)||[]; const p1=open.filter(a=>a.severity==="P1").length; const st=(noc&&noc.status)||"ok"; const fr=((noc&&noc.freshness)||{}).oldest;
    body.innerHTML=`<div class="ld-noc ld-${st}"><span class="ld-dot"></span><b>${st==="ok"?"All good":st==="degraded"?"Degraded":"Incident"}</b><span class="ld-nocsub">${esc((noc&&noc.headline)||"")}</span><span class="ld-nocr">${open.length} open alert${open.length===1?"":"s"}${p1?` · <b style="color:#dc2626">${p1} P1</b>`:""}${fr?` · data ${fr.lagMin}m behind`:""}</span></div>
      <div class="ld-grid">
        ${tile("Orders",num(d.orders),"new SIM + MNP","#dashboard","green")}
        ${tile("Checkouts",num(d.checkouts),"","#dashboard")}
        ${tile("Payments OK",num(d.paidOk),`${rate(d.payRate,(d.targets||{}).pay)} · ${num(d.paidFail)} failed`,"#troubleshoot?cat=payment")}
        ${tile("Activations (BSS)",num(d.actOk),`${rate(d.actRate,(d.targets||{}).act)} · ${num(d.actFail)} failed`,"#troubleshoot?cat=activation")}
        ${tile("Nafath completed",num(d.nafOk),"","#troubleshoot?cat=nafath")}
        ${tile("Deliveries",num(d.deliveries),"","#troubleshoot?cat=delivery")}
        ${tile("Business errors",num(d.errorsBusiness),"expected — API said no","#troubleshoot?cls=business","blue")}
        ${tile("Technical errors",num(d.errorsTechnical),d.errorsTechnical?"needs a look →":"all clear","#troubleshoot?cls=technical",d.errorsTechnical?"red":"")}
      </div>`;
  }

  function renderFixed({f24,canF}){
    const body=$("#ldFixed .ld-body"); if(!canF){ body.innerHTML=`<div class="ld-loading">Your role has no Fixed access.</div>`; return; }
    if(!f24){ body.innerHTML=`<div class="ld-loading" style="color:#d97706">Fixed data unavailable.</div>`; return; }
    const d=f24, k=d.kpis||{}, naf=(d.integrations||{}).nafath||{}, man=(d.integrations||{}).manafith||{}, f=d.freshness||{};
    const openErr=(d.errors||[]).reduce((a,e)=>a+Number(e.open||0),0); const stale=!!f.stale;
    body.innerHTML=`<div class="ld-noc ld-${stale?"degraded":"ok"}"><span class="ld-dot"></span><b>${stale?"Data may be stale":"Live"}</b><span class="ld-nocsub">${esc(String(d.source||""))}</span><span class="ld-nocr">watcher ${f.lag_min==null?"—":f.lag_min+" min ago"} · newest attempt ${f.newest_attempt?new Date(new Date(f.newest_attempt).getTime()+3*3600e3).toISOString().slice(11,16)+" KSA":"—"}</span></div>
      <div class="ld-grid">
        ${tile("Attempts",num(k.attempts),"FTTH · 5G · QR · app","#fixed","green")}
        ${tile("Completed",num(k.completed),`${k.conversion||0}% conversion`,"#fixed?tab=dash")}
        ${tile("BSS orders",num(k.withOrder),`${k.attempts?Math.round(100*k.withOrder/k.attempts):0}% of attempts`,"#fixed?tab=dash")}
        ${tile("Active dealers",num(k.activeDealers),"SDA staff · map","#fixed?tab=map")}
        ${tile("Nafath fail",naf.total?naf.failRate+"%":"—",`${num(naf.total)} 5G checks`,"#fixed?tab=dash",naf.failRate>25?"red":"")}
        ${tile("Manafith denied",man.total?man.deniedRate+"%":"—",`${num(man.denied)} of ${num(man.total)}`,"#fixed?tab=dash",man.deniedRate>10?"amber":"")}
        ${tile("Avg time to complete",k.avgDurationS?Math.round(k.avgDurationS/60)+" min":"—","completed attempts","#fixed?tab=dash")}
        ${tile("Open errors",num(openErr),(d.errors||[]).slice(0,2).map(e=>esc(e.category)).join(" · ")||"error control board","#fixed?tab=errors",openErr?"red":"")}
      </div>`;
  }

  /* MY INCIDENTS — the open alerts I hold (ack) or am assigned; a reminder list with the three clocks and the SLA verdict */
  async function renderMine(){
    const box=$("#ldMine"); if(!box) return;
    let d; try{ d=await api("/api/incidents/mine"); }catch(e){ box.innerHTML=`<div class="ld-loading">${esc(e.message)}</div>`; return; }
    const list=(d&&d.incidents)||[];
    if(!list.length){ box.innerHTML=`<div class="ld-loading">Nothing in your hands right now ✅ — incidents you acknowledge or receive by hand-over appear here.</div>`; return; }
    const dur=m=>{ m=Math.max(0,Math.round(m||0)); if(m<60) return m+"m"; const h=Math.floor(m/60); if(h<48) return h+"h"+(m%60?String(m%60).padStart(2,"0"):""); return Math.floor(h/24)+"d "+(h%24)+"h"; };
    const col=s=>s==="P1"?"#dc2626":s==="P2"?"#d97706":"#2563eb";
    const rows=list.map(a=>{
      const sla=a.overdue?`<span class="ld-sla bad">SLA overdue by ${dur(-a.remaining_min)}</span>`:a.remaining_min<a.sla_hours*60*0.25?`<span class="ld-sla warn">${dur(a.remaining_min)} left of ${a.sla_hours}h</span>`:`<span class="ld-sla ok">${dur(a.remaining_min)} left of ${a.sla_hours}h</span>`;
      const ack=a.ack_min==null?`<span class="ld-sla warn">not acked</span>`:`acked in ${dur(a.ack_min)}${a.ack_late?` <span class="ld-sla bad">late (target ${dur(a.ack_target_min)})</span>`:""}`;
      const seg=a.segment==="fixed"?`<span class="ld-segchip fx">🏠 FIXED</span>`:`<span class="ld-segchip mb">📱 MOBILE</span>`;
      const role=a.role==="assignee"?"assigned to me":a.role==="holder+assignee"?"ack + assigned to me":"acked by me";
      return `<a href="${esc(a.link)}" class="ld-row ld-mrow${a.overdue?" ld-overdue":""}">
        <span class="ld-sev" style="background:${col(a.severity)}">${esc(a.severity)}</span>
        <span class="ld-mmain"><span class="ld-row-t">${esc(a.name)}</span> ${seg}${a.snoozed_until?`<span class="ld-segchip" style="color:#7c3aed;border-color:#7c3aed">snoozed</span>`:""}<br>
          <span class="ld-msub">${esc(role)} · ${esc(a.team||"")} · fired ${dur(a.age_min)} ago · in my hands ${dur(a.mine_min)} · ${ack}${a.breach_count>1?` · ×${a.breach_count}`:""}</span></span>
        <span class="ld-row-s">${sla}</span></a>`;
    }).join("");
    const over=list.filter(a=>a.overdue).length;
    box.innerHTML=`<div class="ld-att-col"><div class="ld-att-h">${list.length} open in my hands${over?` · <span style="color:#dc2626">${over} over SLA</span>`:""} · SLA P1 ${d.sla.resolve_h.P1}h · P2 ${d.sla.resolve_h.P2}h · P3 ${d.sla.resolve_h.P3}h</div>${rows}</div>`;
  }

  function renderAttention({al,f24,anoms,merr}){
    const box=$("#ldAttention"); const ksa=t=>t?new Date(new Date(t).getTime()+3*3600e3).toISOString().slice(11,16)+" KSA":"—";
    const col=s=>s==="P1"?"#dc2626":s==="P2"?"#d97706":"#2563eb";
    const rows=[];
    // 1. open alerts (metric incidents)
    const open=(Array.isArray(al)?al:(al&&al.rows)||[]).slice().sort((a,b)=>String(a.severity).localeCompare(String(b.severity)));
    open.slice(0,4).forEach(a=>rows.push(`<a href="#alerts" class="ld-row"><span class="ld-sev" style="background:${col(a.severity)}">${esc(a.severity||"")}</span><span class="ld-row-t">${esc(a.name||a.rule_key||a.title||"alert")}</span><span class="ld-row-s">incident · ${esc(a.team||"")}${a.last_seen_at?" · "+ksa(a.last_seen_at):""}</span></a>`));
    // 2. seasonal anomalies (the P1s shown in the insights row — they belong here too)
    const an=((anoms&&anoms.anomalies)||[]).slice().sort((a,b)=>Math.abs(b.score||0)-Math.abs(a.score||0)).slice(0,3);
    an.forEach(a=>rows.push(`<a href="#sla" class="ld-row"><span class="ld-sev" style="background:${col(a.severity||"P3")}">${esc(a.severity||"P3")}</span><span class="ld-row-t">${esc(a.metric||a.text||"anomaly")}</span><span class="ld-row-s">anomaly · ${Math.abs(a.score||0).toFixed(1)}σ ${a.direction==="up"?"above":"below"} norm</span></a>`));
    // 3. error categories with volume (Error Control Board, 24 h)
    const cats=((merr&&merr.summary)||[]).filter(c=>c.total>0).sort((a,b)=>(b.technical-a.technical)||(b.total-a.total)).slice(0,Math.max(2,6-rows.length));
    cats.forEach(c=>rows.push(`<a href="#troubleshoot?cat=${encodeURIComponent(c.category)}" class="ld-row"><span class="ld-sev" style="background:${c.technical>50?"#dc2626":c.technical>0?"#d97706":"#2563eb"}">${num(c.total)}</span><span class="ld-row-t">${esc(c.label||c.category)}</span><span class="ld-row-s">${num(c.business)} business · ${num(c.technical)} technical · ${esc(c.team||"")}</span></a>`));
    const left=rows.length?rows.join(""):`<div class="ld-loading">Nothing open on Mobile ✅</div>`;
    const errs=((f24&&f24.errors)||[]).filter(e=>e.open>0).slice(0,6);
    const right=errs.length?errs.map(e=>`<a href="#fixed?tab=errors" class="ld-row"><span class="ld-sev" style="background:${e.open>1000?"#dc2626":e.open>100?"#d97706":"#2563eb"}">${num(e.open)}</span><span class="ld-row-t">${esc(e.category)}</span><span class="ld-row-s">${num(e.n)} events · last ${ksa(e.last_at)}</span></a>`).join("")
      :`<div class="ld-loading">No open Fixed error categories ✅</div>`;
    const bz=(sess().me||{}).business||"both";
    const colM=`<div class="ld-att-col"><div class="ld-att-h">📱 Mobile · incidents, anomalies, error categories (24 h)</div>${left}</div>`;
    const colF=`<div class="ld-att-col"><div class="ld-att-h">🏠 Fixed · open error categories (24 h)</div>${right}</div>`;
    box.innerHTML=bz==="mobile"?colM:bz==="fixed"?colF:colM+colF;
  }

  function tips(root){ if(!root||!window.navTipShow) return; root.querySelectorAll("[data-tip]").forEach(el=>{ el.addEventListener("mouseenter",()=>window.navTipShow(el)); el.addEventListener("mouseleave",()=>window.navTipHide()); }); }

  function ensureCss(){
    if(document.getElementById("landing-css")) return;
    const st=document.createElement("style"); st.id="landing-css"; st.textContent=`
      .ld-wrap{padding:6px 24px 40px;max-width:1500px;margin:0 auto}
      .ld-hero{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin:14px 0 14px;padding:22px 26px;border-radius:20px;background:linear-gradient(135deg,var(--card) 0%,var(--green-bg,#eefbf3) 100%);border:1px solid var(--line);box-shadow:0 10px 34px rgba(15,23,42,.06)}
      .ld-h1{margin:0;font-size:30px;letter-spacing:-.4px}
      .ld-sub{color:var(--muted);font-size:13px;margin-top:4px}
      .ld-status-lbl{font-size:9px;letter-spacing:1.6px;font-weight:800;color:var(--muted);margin-bottom:6px;text-align:right}
      .ld-status{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .ld-pill{display:inline-flex;align-items:center;gap:7px;text-decoration:none;color:var(--ink);font-size:12px;font-weight:700;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:7px 12px 7px 9px;transition:all .15s ease}
      .ld-pill:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(15,23,42,.1);border-color:var(--c)}
      .ld-pd{width:9px;height:9px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent)}
      .ld-insights{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:10px;margin:0 0 16px}
      .ld-ins{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:12px;padding:10px 14px;font-size:12.5px;transition:all .15s ease}
      .ld-ins:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(15,23,42,.08)}
      .ld-ins-tag{font-size:9.5px;letter-spacing:1px;font-weight:800;color:var(--muted)} .ld-ins-sev{font-size:10px;font-weight:800;color:#fff;background:var(--c);border-radius:6px;padding:2px 7px} .ld-ins-t{flex:1}
      .ld-sec h3{margin:6px 0 10px;font-size:14px} .ld-sec h3 span{font-weight:500;color:var(--muted);font-size:11.5px;margin-left:6px}
      .ld-growth{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-bottom:16px} @media (max-width:700px){ .ld-growth{grid-template-columns:1fr 1fr;gap:8px} .ld-hero{padding:16px 16px !important} .ld-hero h1{font-size:22px !important} }
      .ld-g{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px 8px;transition:all .15s ease}
      .ld-g:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(15,23,42,.08);border-color:var(--green)}
      .ld-g-l{font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;font-weight:700;color:var(--muted)} .ld-g-l span{text-transform:none;letter-spacing:0;font-weight:500;margin-left:4px}
      .ld-g-v{font-size:26px;font-weight:800;margin:4px 0 4px;display:flex;align-items:baseline;gap:8px} .ld-delta{font-size:12px;font-weight:700}
      .ld-spark{width:100%;height:34px;display:block}
      .ld-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
      @media (max-width:1100px){ .ld-cols{grid-template-columns:1fr} }
      .ld-col{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px 18px 18px;box-shadow:0 8px 30px rgba(15,23,42,.05)}
      .ld-colh{display:flex;align-items:center;gap:12px;margin-bottom:12px} .ld-colh h2{margin:0;font-size:18px} .ld-colsub{font-size:11.5px;color:var(--muted)}
      .ld-ic{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#0e9f5a,#019c20);display:flex;align-items:center;justify-content:center;font-size:19px;box-shadow:0 6px 16px rgba(14,159,90,.3)}
      .ld-open{margin-left:auto;text-decoration:none;font-size:12px;font-weight:700;color:var(--green);border:1px solid var(--green);border-radius:999px;padding:6px 12px;white-space:nowrap} .ld-open:hover{background:var(--green);color:#fff}
      .ld-noc{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:12px;padding:9px 12px;font-size:12.5px;margin-bottom:12px;flex-wrap:wrap}
      .ld-noc .ld-nocsub{color:var(--muted)} .ld-noc .ld-nocr{margin-left:auto;color:var(--muted);font-size:11.5px}
      .ld-dot{width:10px;height:10px;border-radius:50%;background:#16a34a;flex:0 0 10px} .ld-degraded .ld-dot{background:#d97706} .ld-incident .ld-dot{background:#dc2626;animation:livePulse 1.4s infinite}
      .ld-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px} @media (max-width:1400px){ .ld-grid{grid-template-columns:repeat(2,1fr)} } @media (max-width:700px){ .ld-grid{gap:8px} .ld-v{font-size:19px} .ld-tile{padding:10px 11px} }
      .ld-tile{display:block;text-decoration:none;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:12px 14px;transition:all .15s ease;border-left-width:4px}
      .ld-tile:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(15,23,42,.08);border-color:var(--green)}
      .ld-green{border-left-color:#0e9f5a} .ld-blue{border-left-color:#2563eb} .ld-red{border-left-color:#dc2626} .ld-amber{border-left-color:#d97706}
      .ld-v{font-size:22px;font-weight:800;line-height:1.1} .ld-l{font-size:10px;letter-spacing:.6px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-top:3px} .ld-s{font-size:11px;color:var(--muted);margin-top:3px}
      .ld-att{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px} @media (max-width:1100px){ .ld-att{grid-template-columns:1fr} }
      .ld-single .ld-cols,.ld-single .ld-att{grid-template-columns:1fr} .ld-single .ld-col .ld-grid{grid-template-columns:repeat(4,1fr)} @media (max-width:900px){ .ld-single .ld-col .ld-grid{grid-template-columns:repeat(2,1fr)} }
      .ld-att-col{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 14px} .ld-att-h{font-size:11px;letter-spacing:.8px;font-weight:800;color:var(--muted);margin-bottom:8px;text-transform:uppercase}
      .ld-row{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;padding:7px 8px;border-radius:10px;font-size:12.5px} .ld-row:hover{background:var(--bg)}
      .ld-sev{font-size:10px;font-weight:800;color:#fff;border-radius:6px;padding:2px 7px;min-width:26px;text-align:center} .ld-row-t{font-weight:600} .ld-row-s{margin-left:auto;color:var(--muted);font-size:11px}
      .ld-quick{display:flex;gap:8px;flex-wrap:wrap}
      .ld-q{text-decoration:none;color:var(--ink);font-size:12px;font-weight:700;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:7px 13px;transition:all .15s ease}
      .ld-q:hover{border-color:var(--green);transform:translateY(-1px);box-shadow:0 6px 16px rgba(15,23,42,.08)}
      .ld-loading{color:var(--muted);font-size:12.5px;padding:10px 2px}
      .ld-mine{margin-bottom:16px} .ld-mrow{align-items:flex-start} .ld-mmain{flex:1;min-width:0} .ld-msub{font-size:11.5px;color:var(--muted)} .ld-overdue{background:rgba(220,38,38,.06)}
      .ld-sla{font-size:11px;font-weight:800;border-radius:999px;padding:2px 8px;white-space:nowrap} .ld-sla.ok{color:#0e9f5a;background:rgba(14,159,90,.12)} .ld-sla.warn{color:var(--warn-fg,#b45309);background:rgba(217,119,6,.14)} .ld-sla.bad{color:#dc2626;background:rgba(220,38,38,.14)}
      .ld-segchip{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.3px;padding:1px 6px;border-radius:999px;border:1px solid var(--line);color:var(--muted);margin-left:6px;vertical-align:1px} .ld-segchip.fx{color:#0e9f5a;border-color:#0e9f5a} .ld-segchip.mb{color:#2563eb;border-color:#2563eb}
      @media (max-width:700px){ .ld-mrow{flex-wrap:wrap} .ld-mrow .ld-row-s{margin-left:36px} }`;
    document.head.appendChild(st);
  }

  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="landing") b.addEventListener("click", shell); });
  window.openLanding=shell;
  const boot=()=>{ if(!location.hash||/^#(home|landing)?$/.test(location.hash)) setTimeout(shell,0); };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
