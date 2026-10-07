/* Console usage — the two charts at the top of the Audit page (7 Oct 2026).
 * Who opens the console: distinct people per KSA day since the first navigation row and per hour over the last 72 h,
 * split by business scope (Fixed / Mobile / Both — console_users.business), for every page or for one page.
 * Reads GET /api/audit/usage (super admin). Rendered by audit.js into #audUsage; follows its "hide my own activity". */
(function(){
  "use strict";
  const $=(s,r)=>(r||document).querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const API=window.API_BASE;
  const api=p=>window.fetch(API+p,{headers:{"Content-Type":"application/json"}}).then(r=>{ if(!r.ok) return r.json().then(e=>{ throw new Error(e.error||("HTTP "+r.status)); }); return r.json(); });
  const KSA="Asia/Riyadh";
  const fmtN=n=>Number(n||0).toLocaleString("en-US");
  const SERIES=[
    { k:"fixed",  label:"Fixed users",  color:"var(--green,#0e9f5a)" },
    { k:"mobile", label:"Mobile users", color:"var(--blue,#2563eb)" },
    { k:"both",   label:"Both (Fixed + Mobile)", color:"var(--purple,#7c3aed)" },
    { k:"total",  label:"Total", color:"var(--ink)", dashed:true }
  ];
  /* human names for the hash routes (anything else shows as its hash) */
  const PAGE_NAME={ "#home":"Home","#dashboard":"Dashboard","#exec":"Executive dashboard","#executive":"Executive dashboard","#noc":"NOC wall",
    "#salesops":"Sales Operations wall","#monitoring":"Monitoring","#troubleshoot":"Troubleshoot","#errors":"Troubleshoot","#alerts":"Alerts",
    "#fixed-alerts":"Fixed › Alerts","#fixed":"Fixed hub","#dms":"DMS","#analytics":"Reports","#subscriber":"Customer 360","#sub360":"Customer 360",
    "#explorer":"Explore","#topology":"Topology","#topology2":"Topology","#apigw":"API gateway","#workbench":"L2 Workbench","#settings":"Settings",
    "#settings-users":"User management","#users":"User management","#audit":"Audit log","#tickets":"Tickets & feedback","#sla":"IT Governance",
    "#arqami":"CST › Arqami","#cst-escalations":"CST › Escalations","#cst":"CST","#refunds":"Refund desk","#infra":"Infrastructure","#agents":"Agents",
    "#agents-live":"Mission control","#mission":"Mission control","#teams":"Teams","#oncall":"On-call","#slo":"SLO","#growth":"Growth","#live":"Live",
    "#otodocs":"OTO docs","#tapdocs":"TAP docs","#salamdocs":"Salam docs","#dmsdocs":"DMS docs","#dmsflows":"DMS flows","#semati":"Semati clearance",
    "#vendor-contracts":"Vendor contracts","#screensflow":"Screens flow","#person":"Person","#help":"Help" };
  const pageName=h=>PAGE_NAME[h]||h;
  const HIDE_KEY="aud_usage_hidden";
  const U={ page:"", hidden:new Set((()=>{ try{ return JSON.parse(localStorage.getItem(HIDE_KEY)||'[]'); }catch(e){ return []; } })()), data:null, host:null, opts:null, ro:null, tick:0 };
  const saveHidden=()=>{ try{ localStorage.setItem(HIDE_KEY, JSON.stringify([...U.hidden])); }catch(e){} };

  function ensureCss(){
    if(document.getElementById("audusage-css")) return;
    const st=document.createElement("style"); st.id="audusage-css";
    st.textContent=`
      .au{margin:12px 0 18px}
      .au-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:10px}
      .au-title{font-size:15px;font-weight:800;color:var(--ink);margin:0}
      .au-sub{font-size:12px;color:var(--muted);margin-top:3px;line-height:1.45;max-width:760px}
      .au-page{display:flex;flex-direction:column;gap:4px;min-width:240px}
      .au-page label{font-size:9px;letter-spacing:1px;font-weight:800;color:var(--muted)}
      .au-page select{font:inherit;font-size:13px;padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);max-width:100%}
      .au-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}
      .au-kpi{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:12px 14px;min-width:0}
      .au-kpi .l{font-size:10px;letter-spacing:.8px;font-weight:800;color:var(--muted);text-transform:uppercase}
      .au-kpi .v{font-size:26px;font-weight:800;color:var(--ink);line-height:1.15;margin-top:4px;font-variant-numeric:tabular-nums}
      .au-kpi .v small{font-size:12px;font-weight:600;color:var(--muted);margin-left:6px}
      .au-kpi .s{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:11.5px;color:var(--ink-soft,var(--ink));font-variant-numeric:tabular-nums}
      .au-kpi .s i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:1px}
      .au-cards{display:grid;grid-template-columns:1fr;gap:12px}
      .au-card{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:14px 16px 10px;min-width:0}
      .au-card h4{margin:0;font-size:13px;font-weight:800;color:var(--ink)}
      .au-card h4 small{font-weight:600;color:var(--muted);margin-left:8px;font-size:11.5px}
      .au-ctl{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px}
      .au-leg{display:flex;flex-wrap:wrap;gap:6px}
      .au-chip{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font:inherit;font-size:11.5px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);transition:border-color .14s,opacity .14s,transform .14s}
      .au-chip:hover{border-color:var(--green,#0e9f5a);transform:translateY(-1px)} .au-chip.off{opacity:.42} .au-chip.off i{background:var(--muted)!important}
      .au-chip i{display:inline-block;width:10px;height:10px;border-radius:3px;flex:none} .au-chip i.dash{height:0;border-top:2px dashed var(--ink);border-radius:0;width:12px}
      .au-chip b{font-variant-numeric:tabular-nums;color:var(--muted);font-weight:700}
      .au-svgwrap{position:relative;width:100%} .au-svgwrap svg{display:block;width:100%;height:auto;overflow:visible}
      .au-tip{position:absolute;pointer-events:none;z-index:5;background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow,0 8px 24px rgba(2,6,23,.16));padding:8px 10px;font-size:11.5px;min-width:190px;max-width:300px;display:none;color:var(--ink)}
      .au-tip b.t{display:block;font-size:12px;margin-bottom:4px} .au-tip .r{display:flex;align-items:center;gap:6px;line-height:1.55} .au-tip .r i{display:inline-block;width:9px;height:9px;border-radius:3px;flex:none} .au-tip .r span{flex:1} .au-tip .r b{font-variant-numeric:tabular-nums}
      .au-foot{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;color:var(--muted);margin-top:6px;align-items:center}
      .au-empty{padding:28px 10px;text-align:center;color:var(--muted);font-size:12.5px}
      .au-note{font-size:11.5px;color:var(--muted);margin-top:8px}
      @media (min-width:1100px){.au-cards{grid-template-columns:1fr 1fr}}
      @media (max-width:760px){.au-kpis{grid-template-columns:1fr 1fr} .au-kpi .v{font-size:22px} .au-page{min-width:0;width:100%} .au-tip{min-width:160px;max-width:80vw}}
      @media (max-width:480px){.au-kpis{grid-template-columns:1fr}}
    `;
    document.head.appendChild(st);
  }

  /* ---- public: render into a host (audit.js), opts = { notuser } ---- */
  async function render(host, opts){
    if(!host) return; ensureCss(); U.host=host; U.opts=opts||{};
    host.innerHTML=`<div class="au">
      <div class="au-head">
        <div><h3 class="au-title">Console usage</h3>
          <div class="au-sub">Who opens the console — <b>distinct people</b>, not events: per day since the first navigation record and per hour over the last 72 hours, split by business scope. Times in KSA.${U.opts.notuser?" <b>Your own activity is hidden</b> (the switch below)." : ""}</div></div>
        <div class="au-page"><label>PAGE</label><select id="auPage" title="Count only the people who opened one page"><option value="">All pages — anyone who opened the console</option></select></div>
      </div>
      <div class="au-kpis" id="auKpis"></div>
      <div class="au-cards">
        <div class="au-card" data-chart="daily"><div class="au-ctl"><h4>Daily<small id="auDailySub">since day 1</small></h4><div class="au-leg"></div></div><div class="au-body"><div class="au-empty">Loading…</div></div></div>
        <div class="au-card" data-chart="hourly"><div class="au-ctl"><h4>Hourly<small>last 72 hours</small></h4><div class="au-leg"></div></div><div class="au-body"><div class="au-empty">Loading…</div></div></div>
      </div></div>`;
    $("#auPage",host).addEventListener("change",e=>{ U.page=e.target.value; load(); });
    if(!U.ro&&window.ResizeObserver){ U.ro=new ResizeObserver(()=>{ if(U.data&&U.host&&U.host.isConnected) paintCharts(); }); }
    if(U.ro){ try{ U.ro.disconnect(); U.ro.observe(host); }catch(e){} }
    await load();
  }

  async function load(){
    const my=++U.tick; const host=U.host; if(!host) return;
    const q=new URLSearchParams(); if(U.page) q.set("page",U.page); if(U.opts.notuser) q.set("notuser",U.opts.notuser);
    let d; try{ d=await api("/api/audit/usage?"+q.toString()); }
    catch(e){ if(my!==U.tick) return; host.querySelectorAll(".au-body").forEach(b=>b.innerHTML=`<div class="au-empty">Usage unavailable — ${esc(e.message)}</div>`); return; }
    if(my!==U.tick||!host.isConnected) return;
    U.data=d; paintAll();
  }

  function paintAll(){
    const d=U.data, host=U.host; if(!d||!host) return;
    /* page dropdown: keep the current choice even when it fell out of the 72 h top list */
    const sel=$("#auPage",host); const cur=U.page;
    const opts=[`<option value="">All pages — anyone who opened the console</option>`]
      .concat((d.pages||[]).map(p=>`<option value="${esc(p.page)}"${p.page===cur?" selected":""}>${esc(pageName(p.page))} — ${fmtN(p.users72h)} in 72 h · ${fmtN(p.users_all)} ever</option>`));
    if(cur&&!(d.pages||[]).some(p=>p.page===cur)) opts.push(`<option value="${esc(cur)}" selected>${esc(pageName(cur))}</option>`);
    sel.innerHTML=opts.join("");
    const scope=d.page?`people who opened <b>${esc(pageName(d.page))}</b>`:"people who opened the console";
    const k=d.kpis||{}; const tile=(label,o,extra)=>`<div class="au-kpi"><div class="l">${label}</div><div class="v">${fmtN(o.total)}<small>${o.total===1?"person":"people"}</small></div>
      <div class="s">${SERIES.slice(0,3).map(s=>`<span><i style="background:${s.color}"></i>${esc(s.label.replace(" users","").replace(" (Fixed + Mobile)",""))} <b>${fmtN(o[s.k])}</b></span>`).join("")}</div>${extra?`<div class="au-note">${extra}</div>`:""}</div>`;
    $("#auKpis",host).innerHTML=tile("Today (KSA)",k.today||{})+tile("Last 72 hours",k.h72||{})+tile(`Since day 1 · ${esc(fmtDay(d.firstDay))}`,k.all||{},scope);
    $("#auDailySub",host).textContent=`since ${fmtDay(d.firstDay)} · ${(d.daily&&d.daily.ticks||[]).length} days`;
    paintCharts();
  }

  function fmtDay(iso){ try{ return new Date(iso+"T00:00:00Z").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}); }catch(e){ return iso; } }
  const fmtHour=iso=>new Date(iso).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:KSA});
  const fmtDayShort=iso=>new Date(iso).toLocaleDateString("en-GB",{day:"2-digit",month:"short",timeZone:KSA});
  const ksaHour=iso=>Number(new Date(iso).toLocaleTimeString("en-GB",{hour:"2-digit",hour12:false,timeZone:KSA}).slice(0,2));

  function paintCharts(){
    const d=U.data, host=U.host; if(!d||!host) return;
    host.querySelectorAll(".au-card").forEach(card=>{
      const kind=card.dataset.chart; const data=d[kind]; if(!data) return;
      drawChart(card, data, kind);
    });
  }

  function drawChart(card, data, kind){
    const body=$(".au-body",card), leg=$(".au-leg",card);
    const ticks=data.ticks||[]; const S=SERIES.map(s=>({...s,points:(data.series&&data.series[s.k])||ticks.map(()=>0)}));
    const vis=S.filter(s=>!U.hidden.has(s.k));
    leg.innerHTML=S.map(s=>{ const on=!U.hidden.has(s.k); const peak=Math.max(0,...s.points);
      return `<button type="button" class="au-chip${on?"":" off"}" data-k="${s.k}" title="${on?"Hide":"Show"} ${esc(s.label)}"><i class="${s.dashed?"dash":""}" style="${s.dashed?"":"background:"+s.color}"></i>${esc(s.label)} <b>${fmtN(peak)}</b></button>`; }).join("");
    leg.querySelectorAll(".au-chip").forEach(b=>b.onclick=()=>{ const k=b.dataset.k; if(U.hidden.has(k)) U.hidden.delete(k); else U.hidden.add(k); saveHidden(); paintCharts(); });
    const any=S.slice(0,3).some(s=>s.points.some(v=>v>0));
    if(!ticks.length||!any){ body.innerHTML=`<div class="au-empty">No navigation yet in this window${U.page?` for ${esc(pageName(U.page))}`:""}.</div>`; return; }
    const W=Math.max(300,Math.floor(body.clientWidth||card.clientWidth||800)); const H=Math.min(300,Math.max(190,Math.round(W*0.34)));
    const ML=36, MR=12, MT=14, MB=30; const iw=W-ML-MR, ih=H-MT-MB;
    let ymax=0; for(const s of vis) for(const v of s.points) if(v>ymax) ymax=v; if(ymax<=0) ymax=1;
    /* whole people on the axis: the top of the scale is the first of these at or above the peak, every gridline an integer */
    const nice=v=>[5,8,10,12,16,20,25,30,40,50,60,80,100,120,150,200,250,300,400,500,600,800,1000,1500,2000,3000,5000].find(c=>c>=v)||Math.ceil(v/1000)*1000;
    const ytop=nice(ymax*1.1);
    const X=i=>ML+(ticks.length>1?i/(ticks.length-1)*iw:iw/2), Y=v=>MT+ih-(v/ytop)*ih;
    const path=pts=>pts.map((v,i)=>`${i?"L":"M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const gridN=ytop%5===0?5:4; const grid=[];
    for(let g=0;g<=gridN;g++){ const v=ytop*g/gridN; grid.push(`<line x1="${ML}" x2="${W-MR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--line-soft,var(--line))" stroke-width="1"/><text x="${ML-6}" y="${(Y(v)+3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${Number.isInteger(v)?v:v.toFixed(1)}</text>`); }
    /* x labels: days → every n days; hours → every 6 h with the day name at midnight KSA */
    const xl=[]; const label=i=>kind==="hourly"?fmtHour(ticks[i]):fmtDayShort(ticks[i]+"T12:00:00Z");
    if(kind==="hourly"){
      /* clock labels at 00 / 06 / 12 / 18 KSA (every 12 h when narrow), the day written above each midnight */
      const step=iw<420?12:6; let lastX=-1e9;
      for(let i=0;i<ticks.length;i++){
        const hr=ksaHour(ticks[i]); if(hr%step!==0) continue;
        const x=X(i); if(x-lastX<34) continue; lastX=x;
        const anchor=i===0?"start":i===ticks.length-1?"end":"middle";
        if(hr===0) xl.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${MT}" y2="${MT+ih}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${x.toFixed(1)}" y="${H-19}" text-anchor="${anchor}" font-size="9.5" font-weight="700" fill="var(--ink-soft,var(--ink))">${esc(fmtDayShort(ticks[i]))}</text>`);
        xl.push(`<text x="${x.toFixed(1)}" y="${H-7}" text-anchor="${anchor}" font-size="10" fill="var(--muted)">${esc(fmtHour(ticks[i]))}</text>`);
      }
    } else {
      const every=Math.max(1,Math.ceil(ticks.length/Math.max(3,Math.floor(iw/72))));
      for(let i=0;i<ticks.length;i++){
        if(i%every!==0&&i!==ticks.length-1) continue;
        if(i===ticks.length-1&&ticks.length>1&&(ticks.length-1)%every<every/2&&(ticks.length-1)%every!==0) continue;   // never collide with the previous label
        const anchor=i===0?"start":i===ticks.length-1?"end":"middle";
        xl.push(`<text x="${X(i).toFixed(1)}" y="${H-7}" text-anchor="${anchor}" font-size="10" fill="var(--muted)">${esc(label(i))}</text>`);
      }
    }
    const lines=[];
    for(const s of vis){
      if(s.dashed){ lines.push(`<path d="${path(s.points)}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-dasharray="6 4" stroke-linejoin="round" opacity=".8"/>`); continue; }
      lines.push(`<path d="${path(s.points)}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`);
      if(ticks.length<=96) lines.push(s.points.map((v,i)=>v>0?`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.4" fill="${s.color}"/>`:"").join(""));
    }
    const last=ticks.length-1;
    body.innerHTML=`<div class="au-svgwrap"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${kind==="hourly"?"people per hour, last 72 hours":"people per day since day 1"}">
        ${grid.join("")}${xl.join("")}
        <line x1="${ML}" x2="${ML}" y1="${MT}" y2="${MT+ih}" stroke="var(--line)"/><line x1="${ML}" x2="${W-MR}" y1="${MT+ih}" y2="${MT+ih}" stroke="var(--line)"/>
        ${lines.join("")}
        <line x1="${X(last).toFixed(1)}" x2="${X(last).toFixed(1)}" y1="${MT}" y2="${MT+ih}" stroke="var(--green,#0e9f5a)" stroke-width="1" opacity=".35"/>
        <line class="au-cross" x1="0" x2="0" y1="${MT}" y2="${MT+ih}" stroke="var(--ink)" stroke-width="1" opacity="0" stroke-dasharray="3 3"/>
        <rect class="au-hit" x="${ML}" y="${MT}" width="${iw}" height="${ih}" fill="transparent" style="cursor:crosshair"/></svg><div class="au-tip"></div></div>
      <div class="au-foot"><span>${kind==="hourly"?"one point per clock hour, KSA — the green line is the current hour":"one point per KSA day — the green line is today"}</span><span>hover or touch for the values</span></div>`;
    const svg=$("svg",body), hit=$(".au-hit",body), cross=$(".au-cross",body), tip=$(".au-tip",body), wrap=$(".au-svgwrap",body);
    const total=S.find(s=>s.k==="total");
    const show=ev=>{ const r=svg.getBoundingClientRect(); const sx=W/r.width; const px=(ev.clientX-r.left)*sx; let i=Math.round((px-ML)/iw*(ticks.length-1)); i=Math.max(0,Math.min(ticks.length-1,i));
      cross.setAttribute("x1",X(i).toFixed(1)); cross.setAttribute("x2",X(i).toFixed(1)); cross.setAttribute("opacity",".5");
      const when=kind==="hourly"?`${fmtDayShort(ticks[i])} ${fmtHour(ticks[i])} → ${fmtHour(new Date(new Date(ticks[i]).getTime()+3600e3).toISOString())}`:fmtDay(ticks[i]);
      const rows=S.slice(0,3).map(s=>`<div class="r"><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${fmtN(s.points[i])}</b></div>`).join("")
        +`<div class="r" style="border-top:1px solid var(--line-soft,var(--line));margin-top:3px;padding-top:3px"><i class="dash" style="width:9px;height:0;border-top:2px dashed var(--ink);border-radius:0"></i><span><b>Total</b></span><b>${fmtN(total.points[i])}</b></div>`;
      tip.innerHTML=`<b class="t">${esc(when)} KSA · ${fmtN(total.points[i])} ${total.points[i]===1?"person":"people"}</b>${rows}`;
      tip.style.display="block"; const tw=tip.offsetWidth, ww=wrap.clientWidth; const lx=(ev.clientX-r.left); tip.style.left=(lx+tw+24>ww?Math.max(0,lx-tw-14):lx+14)+"px"; tip.style.top=Math.max(0,(ev.clientY-r.top)-10)+"px"; };
    hit.onmousemove=show; hit.onmouseleave=()=>{ tip.style.display="none"; cross.setAttribute("opacity","0"); };
    hit.ontouchstart=hit.ontouchmove=ev=>{ if(ev.touches&&ev.touches[0]) show(ev.touches[0]); };
  }

  window.auditUsage={ render, reload:load };
})();
