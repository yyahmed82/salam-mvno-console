/* Analytics view — Grafana-style editable panels over the query engine. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = (location.protocol==="file:") ? "http://localhost:4600" : (location.pathname.startsWith("/digital-console") ? "/digital-console" : "");
  const PAL=["#2563eb","#16a34a","#ea580c","#7c3aed","#0d9488","#dc2626","#d97706","#0891b2","#db2777"];
  const st={dashboards:[],dashKey:null,dashCat:"",spec:{filters:{},panels:[]},catalog:{},range:24,valCache:{},dirty:false};
  const tv=(n,fb)=>{const v=getComputedStyle(document.documentElement).getPropertyValue(n).trim();return v||fb;};
  function api(p,opts){ return (window.fetch)(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();}); }
  const canEdit=()=> window.opsCan && window.opsCan("editRules");
  const grp=v=>Number(v).toLocaleString(undefined,{maximumFractionDigits:2});                 // 1,012,440.23
  const compact=v=>{ v=Number(v); const a=Math.abs(v); if(a>=1e9)return (v/1e9).toFixed(2)+"B"; if(a>=1e6)return (v/1e6).toFixed(2)+"M"; if(a>=1e4)return (v/1e3).toFixed(1)+"K"; return grp(v); };
  const fmtV=(v,rate)=> v==null?"—":rate?(v*100).toFixed(1)+"%":grp(v);

  async function values(ds,dim){ const k=ds+"."+dim; if(st.valCache[k])return st.valCache[k]; try{ const r=await api(`/api/analytics/values?dataset=${ds}&dim=${dim}`); st.valCache[k]=r.values||[]; }catch(e){ st.valCache[k]=[]; } return st.valCache[k]; }
  // filter values may be scalars or {value,label}; option value stays the id, text shows "id - name"
  const optNorm=it=> (it&&typeof it==="object")?{value:it.value,label:it.label}:{value:it,label:String(it)};
  const optTag=cur=>it=>{ const o=optNorm(it); return `<option value="${esc(String(o.value))}" ${String(o.value)===String(cur)?"selected":""}>${esc(o.label)}</option>`; };
  // effective period for a panel (its own override, else the dashboard range) + auto-appended title
  const hoursLabel=h=>{ h=Number(h)||24; return h>=168?(Math.round(h/24)+"d"):(h+"h"); };
  const effHours=(panel,rangeH)=> panel.rangeHours || rangeH || (window.OPS_RANGE&&window.OPS_RANGE.hours) || st.range || 24;
  const titleHTML=(panel,rangeH)=>`${esc(panel.title)} <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· ${hoursLabel(effHours(panel,rangeH))}</span>`;
  // ALWAYS display KSA (Asia/Riyadh) time on chart axes/tooltips, independent of the viewer's browser timezone
  const KSA_FMT=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  const ksaParts=t=>{ const o={}; for(const p of KSA_FMT.formatToParts(new Date(t))) o[p.type]=p.value; return o; };
  const ksaHM=t=>{ const P=ksaParts(t); return `${P.hour}:${P.minute}`; };
  const ksaMD=t=>{ const P=ksaParts(t); return `${P.month}-${P.day}`; };

  // ---------- charts ----------
  // per-panel hidden-series state (legend toggle); keyed by panel object identity
  const HIDDEN=new WeakMap();
  const hiddenFor=panel=>{ let s=HIDDEN.get(panel); if(!s){ s=new Set(); HIDDEN.set(panel,s); } return s; };
  // draw a fetched result into a panel body + wire clickable legend (no refetch on toggle)
  function paint(bodyEl, panel, res){
    const hid=hiddenFor(panel);
    if(res.kind==="stat") bodyEl.innerHTML=statView(res);
    else if(res.kind==="table") bodyEl.innerHTML=tableView(res);
    else if(res.kind==="pie") bodyEl.innerHTML=pieChart(res,hid);
    else if(panel.viz==="column") bodyEl.innerHTML=columnChart(res,hid);
    else if(panel.viz==="bar") bodyEl.innerHTML=barChart(res);
    else bodyEl.innerHTML=lineChart(res,hid);
    bodyEl.querySelectorAll(".leg-item").forEach(li=>li.addEventListener("click",()=>{
      const k=li.dataset.k; if(k==null) return; hid.has(k)?hid.delete(k):hid.add(k); paint(bodyEl, panel, res);
    }));
  }
  function lineChart(res,hidden){
    hidden=hidden||new Set();
    const all=res.series||[]; if(!all.length) return `<div class="sub">No data in range.</div>`;
    const prev=res.prev||[];
    const colorOf=i=>PAL[i%PAL.length];                       // color by ORIGINAL index → stable when toggling
    const vis=all.filter(s=>!hidden.has(s.key));
    const W=560,H=150,pl=34,pb=8,pt=8,pr=8;   // x labels are rotated HTML below the SVG (no SVG bottom labels)
    // DOMAIN = the requested window [res._from, res._to] so the axis reaches "now" even if recent hours
    // have no data yet (empty hours show as a gap → surfaces sync lag). Falls back to the data extent.
    const dataT=[...new Set([...all,...prev].flatMap(s=>s.points).map(p=>+new Date(p.t)))].sort((a,b)=>a-b);
    const t0 = res._from ? +new Date(res._from) : (dataT[0] ?? Date.now());
    const t1 = res._to   ? +new Date(res._to)   : (dataT[dataT.length-1] ?? Date.now());
    const visV=[...vis,...prev].flatMap(s=>s.points).map(p=>p.v).filter(v=>v!=null);
    let max=res.rate?1:Math.max(...visV,1), min=0;
    // bucket size (from the data) → drives gap-breaking + "current partial bucket" exclusion at any granularity
    const step=(()=>{ let m=Infinity; for(let k=1;k<dataT.length;k++){ const d=dataT[k]-dataT[k-1]; if(d>0&&d<m)m=d; } return isFinite(m)?m:3600e3; })();
    const x=t=>pl+((t-t0)/((t1-t0)||1))*(W-pl-pr);
    const y=v=>H-pb-((v-min)/((max-min)||1))*(H-pb-pt);
    let g="";
    for(let i=0;i<=3;i++){ const yy=pt+(H-pb-pt)*i/3; const val=max-(max-min)*i/3; g+=`<line x1="${pl}" y1="${yy}" x2="${W-pr}" y2="${yy}" stroke="${tv('--line-soft','#eee')}" stroke-width="1"/><text x="${pl-4}" y="${yy+3}" text-anchor="end" font-size="8" fill="${tv('--muted','#94a3b8')}">${res.rate?Math.round(val*100)+'%':Math.round(val)}</text>`; }
    // hourly ticks across the FULL domain (so every hour of the window shows, data or not)
    const HR=3600e3; const ticks=[]; for(let t=Math.ceil(t0/HR)*HR; t<=t1+1; t+=HR) ticks.push(t);
    if(ticks.length<=240) ticks.forEach(t=>{ const xx=x(t).toFixed(1); g+=`<line x1="${xx}" y1="${pt}" x2="${xx}" y2="${H-pb}" stroke="${tv('--line-soft','#eee')}" stroke-width="0.5" opacity="0.3"/>`; });
    // auto-detect sharp DROPS per visible series (dip below 40% of the series median) → red band + markers
    const drops=[];
    if(res._markDrops){ const nowBk=Math.floor(Date.now()/step)*step;   // current in-progress bucket (any granularity)
      all.forEach((s,si)=>{ if(hidden.has(s.key))return;
        const P=s.points.filter(p=>p.v!=null).map(p=>({t:+new Date(p.t),v:p.v})).filter(p=>p.t<nowBk);   // skip the partial current bucket
        if(P.length<4)return;
        const sv=P.map(p=>p.v).slice().sort((a,b)=>a-b); const med=sv[sv.length>>1]||0; if(med<5)return;   // ignore tiny series
        const thr=med*0.4; let run=null;
        for(let k=0;k<P.length;k++){ const low=P[k].v<thr;
          if(low&&run==null){ run=k; }
          else if(!low&&run!=null){ drops.push({start:P[run].t,end:P[k].t,c:colorOf(si),key:s.key}); run=null; } }   // start = FIRST low hour, end = recovery hour
        if(run!=null) drops.push({start:P[run].t,end:P[P.length-1].t,c:colorOf(si),key:s.key,ongoing:true});
      }); }
    drops.forEach(d=>{ const xa=x(d.start), xb=x(d.end); g+=`<rect x="${xa.toFixed(1)}" y="${pt}" width="${Math.max(0,xb-xa).toFixed(1)}" height="${H-pb-pt}" fill="#dc2626" opacity="0.07"/>`; });
    // break the line across gaps (>1 missing bucket) instead of drawing a misleading diagonal
    const pathD=pts=>{ let d="",lt=null; pts.forEach(p=>{ const t=+new Date(p.t); const move=lt==null||(t-lt)>step*1.75; d+=`${move?'M':'L'}${x(t).toFixed(1)},${y(p.v).toFixed(1)} `; lt=t; }); return d.trim(); };
    prev.forEach((s,i)=>{ const c=colorOf(i); const pts=s.points.filter(p=>p.v!=null);
      g+=`<path d="${pathD(pts)}" fill="none" stroke="${c}" stroke-width="1.4" stroke-dasharray="3 3" opacity="0.5"/>`; });
    const nowMs=Date.now();   // "live head" only when the last point is genuinely the current, still-filling bucket (near now) — never for stale/sparse data
    all.forEach((s,i)=>{ if(hidden.has(s.key)) return; const c=colorOf(i); const pts=s.points.filter(p=>p.v!=null);
      const lastT = pts.length ? +new Date(pts[pts.length-1].t) : 0;
      const liveOn = pts.length>=2 && lastT >= nowMs - step*1.5 && lastT <= nowMs + step;
      const solid = liveOn ? pts.slice(0,-1) : pts;   // completed buckets → solid line
      g+=`<path d="${pathD(solid)}" fill="none" stroke="${c}" stroke-width="1.8"/>`;
      if(liveOn){                                     // dashed "growing" tail + pulsing head to the in-progress point
        const lp=pts[pts.length-1], lt=+new Date(lp.t), lx=x(lt), ly=y(lp.v), pv=solid[solid.length-1];
        if(pv){ const pt0=+new Date(pv.t); if((lt-pt0)<=step*1.75) g+=`<path d="M${x(pt0).toFixed(1)},${y(pv.v).toFixed(1)} L${lx.toFixed(1)},${ly.toFixed(1)}" fill="none" stroke="${c}" stroke-width="1.8" stroke-dasharray="4 3"/>`; }
        g+=`<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.6" fill="${c}"><title>${ksaMD(lt)} ${ksaHM(lt)} KSA · ${esc(s.label||s.key)} (in progress): ${res.rate?(lp.v*100).toFixed(1)+'%':grp(lp.v)}</title><animate attributeName="r" values="2.6;4.6;2.6" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;.35;1" dur="1.6s" repeatCount="indefinite"/></circle>`;
      }
      // hover dot per completed bucket → read exact time + value
      if(solid.length<=120) solid.forEach(p=>{ const t=+new Date(p.t); g+=`<circle cx="${x(t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="1.7" fill="${c}"><title>${ksaMD(t)} ${ksaHM(t)} KSA · ${esc(s.label||s.key)}: ${res.rate?(p.v*100).toFixed(1)+'%':grp(p.v)}</title></circle>`; }); });
    // red vertical lines + exact KSA times at each drop's start & end
    drops.forEach(d=>{ [['↓',d.start,true],['↑',d.end,!d.ongoing]].forEach(([mk,t,show])=>{ if(!show)return; const xx=x(t).toFixed(1);
      g+=`<line x1="${xx}" y1="${pt}" x2="${xx}" y2="${H-pb}" stroke="#dc2626" stroke-width="1.1" stroke-dasharray="3 2"/>`;
      g+=`<text x="${xx}" y="${pt+7}" fill="#dc2626" font-size="7" font-weight="700" text-anchor="middle">${mk}${ksaHM(t)}</text>`; }); });
    // ops event markers (deploys / campaigns / maintenance) within the domain — answers "what changed at HH:MM?"
    const EVK={deploy:'#7c3aed',campaign:'#0891b2',maintenance:'#64748b',incident:'#dc2626',note:'#334155'};
    (window.OPS_EVENTS||[]).forEach(ev=>{ const t=+new Date(ev.at); if(isNaN(t)||t<t0||t>t1) return; const xx=x(t).toFixed(1); const c=EVK[ev.kind]||'#334155';
      const tip=`${esc(ev.kind)} · ${esc(ev.title)}${ev.area?` · ${esc(ev.area)}`:''} · ${ksaMD(t)} ${ksaHM(t)} KSA`;
      g+=`<line x1="${xx}" y1="${pt}" x2="${xx}" y2="${H-pb}" stroke="${c}" stroke-width="1" stroke-dasharray="2 2" opacity="0.65"><title>${tip}</title></line>`;
      g+=`<path d="M${xx},${pt+4} l-3.2,-4 l6.4,0 z" fill="${c}"><title>${tip}</title></path>`; });
    // one label per hour tick (capped ~30), date shown at day boundaries, rotated HTML below
    const maxLab=30, lstride=Math.max(1,Math.ceil(ticks.length/maxLab));
    let lastDay=null, xlabels="";
    ticks.forEach((t,i)=>{ if(i%lstride!==0 && i!==ticks.length-1) return; const day=ksaMD(t); const showDay=day!==lastDay; lastDay=day;
      const lbl=(showDay?day+' ':'')+ksaHM(t);
      const p=(x(t)/W*100).toFixed(2);   // fraction of the (stretched) SVG width
      xlabels+=`<span style="left:${p}%">${esc(lbl)}</span>`; });
    // interactive-hover payload: per-bucket value of every VISIBLE series (drives the guide line + tooltip)
    const attrEsc=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    // Per-series index (timestamp → point) built ONCE. Replaces an O(points²·series) find() that
    // constructed a Date on every comparison — the main-thread freeze ("Page Unresponsive") on long
    // ranges (30d ≈ 720 buckets/series). Now the hover payload is O(points·series).
    const sidx=all.map(s=>{ const m=new Map(); (s.points||[]).forEach(pp=>{ if(pp.v!=null) m.set(+new Date(pp.t), pp); }); return m; });
    // Keep the embedded hover JSON small on long ranges (it's re-parsed on every mousemove): stride to ≤360 buckets.
    const inDom=dataT.filter(t=>t>=t0&&t<=t1);
    const hvStride=Math.max(1, Math.ceil(inDom.length/360));
    const hvB=[];
    inDom.forEach((t,ti)=>{ if(ti%hvStride!==0) return; const e=[];
      all.forEach((s,idx)=>{ if(hidden.has(s.key)) return; const p=sidx[idx].get(t); if(!p) return;
        e.push({l:s.label||s.key, c:colorOf(idx), cy:+y(p.v).toFixed(1), v:res.rate?(p.v*100).toFixed(1)+'%':grp(p.v)}); });
      if(e.length) hvB.push({cx:+x(t).toFixed(1), tl:`${ksaMD(t)} ${ksaHM(t)} KSA`, e}); });
    const hvPayload=attrEsc(JSON.stringify({W,H,buckets:hvB}));
    let leg=all.length>1?all.map((s,i)=>`<span class="leg-item ${hidden.has(s.key)?'off':''}" data-k="${esc(String(s.key))}" title="${esc(s.title||s.key)}"><i style="background:${colorOf(i)}"></i>${esc(s.label||s.key)}</span>`).join(""):"";
    if(prev.length) leg+=`<span><i style="background:${tv('--muted','#94a3b8')};opacity:.6"></i>previous period</span>`;
    return `<div class="lc-wrap"><svg class="linechart" data-hv="${hvPayload}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:150px;display:block">${g}</svg><div class="xlabels">${xlabels}</div></div>${leg?`<div class="aleg">${leg}</div>`:""}`;
  }
  // "pie"/"donut" now render as sorted HORIZONTAL BARS — easier to compare magnitudes at a glance (R2 §2.1)
  function pieChart(res,hidden){
    hidden=hidden||new Set();
    const relabel=s=>{ const lb=String(s.label||s.key||'').trim(); return (!lb||lb==='—'||lb==='-'||lb==='null'||lb==='undefined')?'Unknown / not returned':lb; };
    let all=(res.slices||[]).filter(s=>s.value>0).map((s,i)=>({...s,_i:i,label:relabel(s)})); if(!all.length) return `<div class="sub">No data.</div>`;
    const grand=all.reduce((a,s)=>a+s.value,0)||1;
    let vis=all.filter(s=>!hidden.has(s.key)).sort((a,b)=>b.value-a.value);
    // collapse the long tail into "Other (n)" so the chart stays readable + comprehensive (still 100%)
    const TOP=12;
    if(vis.length>TOP){
      const head=vis.slice(0,TOP-1), tail=vis.slice(TOP-1);
      vis=[...head,{ key:'__other', _i:TOP-1, label:`Other (${tail.length})`,
        title:tail.map(s=>`${s.label}: ${grp(s.value)}`).join(' · '),
        value:tail.reduce((a,s)=>a+s.value,0) }];
    }
    const max=Math.max(...vis.map(s=>s.value),1);
    const wide=vis.some(s=>String(s.label).length>22);   // long labels (e.g. decline reasons) get a wider, wrapping column
    return `<div class="bars${wide?' bars-wide':''}">`+vis.map(s=>{ const c=PAL[s._i%PAL.length]; const w=Math.max(2,Math.round(s.value/max*100));
      const pct=(s.value/grand*100), pctTxt=pct>=1?Math.round(pct)+'%':pct.toFixed(1)+'%';
      const dv = s.key==='__other' ? '' : ` data-val="${esc(String(s.key==null?'':s.key))}"`;
      return `<div class="barrow"${dv}><span class="blabel" title="${esc(s.title||s.label)}"><span class="bnm">${esc(s.label)}</span></span><span class="bt" style="width:${w}%;background:${c}"></span><span class="bn">${grp(s.value)} · ${pctTxt}</span></div>`;
    }).join("")+`</div>`;
  }
  function barChart(res){
    const series=res.series||[]; if(!series.length) return `<div class="sub">No data in range.</div>`;
    const rows=series.map((s,i)=>({key:s.key,label:s.label||s.key,sub:s.sub||"",title:s.title||s.key,val:s.points.reduce((a,p)=>a+(p.v||0),0),c:PAL[i%PAL.length]})).sort((a,b)=>b.val-a.val);
    const max=Math.max(...rows.map(r=>r.val),1);
    return `<div class="bars">`+rows.map(r=>`<div class="barrow"><span class="blabel" title="${esc(r.title)}"><span class="bnm">${esc(r.label)}</span>${r.sub?`<span class="bsub">${esc(r.sub)}</span>`:''}</span><span class="bt" style="width:${Math.round(r.val/max*100)}%;background:${r.c}"></span><span class="bn">${res.rate?(r.val).toFixed(1):grp(r.val)}</span></div>`).join("")+`</div>`;
  }
  // onboarding funnel — step bars + step-to-step conversion %, worst drop flagged as the bottleneck
  function funnelChart(res){
    const steps=(res.steps||[]).filter(s=>s.n!=null); if(!steps.length) return `<div class="sub">No data.</div>`;
    const top=steps[0].n||1;
    const conv=steps.map((s,i)=> i===0?null : (steps[i-1].n>0? s.n/steps[i-1].n : null));
    let worstIdx=-1, worst=1.1; conv.forEach((c,i)=>{ if(i>0 && c!=null && c<worst){ worst=c; worstIdx=i; } });
    const overall=top>0?(steps[steps.length-1].n/top):null;
    const body=steps.map((s,i)=>{ const w=Math.max(2,Math.round((s.n/(top||1))*100)); const c=conv[i]; const bottleneck=i===worstIdx;
      const cc=c==null?"":(c<0.5?"#dc2626":c<0.8?"#d97706":"#16a34a");
      const convTxt=c==null?`<span class="fpct">—</span>`:`<span class="fpct" style="color:${cc}">${(c*100).toFixed(0)}%${bottleneck?' ⚠':''}</span>`;
      return `<div class="frow"><span class="fnm" title="${esc(s.label)}">${esc(s.label)}</span><span class="fbar" style="width:${w}%;background:${bottleneck?'#dc2626':'var(--green)'}"></span><span class="fn">${grp(s.n)}</span>${convTxt}</div>`;
    }).join("");
    return `<div class="funnel">${body}</div><div class="rl" style="margin-top:5px">overall ${overall==null?'—':(overall*100).toFixed(1)+'%'} · % = step conversion · ⚠ = biggest drop-off</div>`;
  }
  // stuck onboarding orders — age-highlighted table with a "View 360" jump
  function fmtAge(sec){ sec=Number(sec)||0; const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60); return h>=1?`${h}h ${m}m`:`${m}m`; }
  function incompleteTable(res){
    const rows=res.orders||[]; if(!rows.length) return `<div class="okbox">No stuck orders in the last ${res.hours}h ✅</div>`;
    return `<div style="overflow:auto;max-height:320px"><table class="atable">
      <tr><th>Order</th><th>Mobile</th><th>Channel</th><th>SIM</th><th>Status</th><th>Elig</th><th>Stuck for</th><th></th></tr>`+
      rows.map(o=>{ const s=Number(o.age_sec); const c=s>7200?'#dc2626':s>3600?'#d97706':'var(--muted)';
        return `<tr><td>${esc(o.id)}</td><td>${esc(o.mobile_number||'')}</td><td>${esc(o.channel)}</td><td>${esc(o.sim)}</td><td>${esc(o.status||'—')}</td><td>${o.is_eligible==null?'—':(o.is_eligible?'✅':'✗')}</td><td style="color:${c};font-weight:700;white-space:nowrap">${fmtAge(s)}</td><td>${o.mobile_number?`<button class="pill" data-mob="${esc(o.mobile_number)}" style="padding:2px 8px">View</button>`:''}</td></tr>`;
      }).join("")+`</table></div><div class="rl" style="margin-top:4px">Created but not completed/activated · oldest first · red &gt; 2h stuck</div>`;
  }
  // vertical column chart — one column per series (aggregated over the range), y-axis scaled
  function columnChart(res,hidden){
    hidden=hidden||new Set();
    const all=(res.series||[]).map((s,i)=>({key:s.key,label:s.label||s.key,title:s.title||s.key,val:s.points.reduce((a,p)=>a+(p.v||0),0),_i:i}));
    if(!all.length) return `<div class="sub">No data in range.</div>`;
    const vis=all.filter(s=>!hidden.has(s.key));
    const max=Math.max(...vis.map(r=>r.val),res.rate?1:0,1);
    const W=560,H=170,pl=34,pb=30,pt=8,pr=8,n=all.length,gap=(W-pl-pr)/n,bw=Math.min(48,gap*0.6);
    const y=v=>H-pb-(v/max)*(H-pb-pt);
    let g="";
    for(let i=0;i<=3;i++){ const yy=pt+(H-pb-pt)*i/3; const val=max-max*i/3; g+=`<line x1="${pl}" y1="${yy}" x2="${W-pr}" y2="${yy}" stroke="${tv('--line-soft','#eee')}" stroke-width="1"/><text x="${pl-4}" y="${yy+3}" text-anchor="end" font-size="8" fill="${tv('--muted','#94a3b8')}">${res.rate?Math.round(val*100)+'%':Math.round(val)}</text>`; }
    all.forEach(r=>{ if(hidden.has(r.key))return; const cx=pl+gap*r._i+gap/2; const yy=y(r.val); const c=PAL[r._i%PAL.length];
      g+=`<rect x="${(cx-bw/2).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,H-pb-yy).toFixed(1)}" rx="2" fill="${c}"><title>${esc(r.title)}: ${res.rate?(r.val*100).toFixed(1)+'%':grp(r.val)}</title></rect>`;
      g+=`<text x="${cx.toFixed(1)}" y="${H-pb+11}" text-anchor="middle" font-size="8" fill="${tv('--muted','#94a3b8')}">${esc(String(r.label).slice(0,12))}</text>`; });
    const leg=all.length>1?all.map(r=>`<span class="leg-item ${hidden.has(r.key)?'off':''}" data-k="${esc(String(r.key))}" title="${esc(r.title)}"><i style="background:${PAL[r._i%PAL.length]}"></i>${esc(r.label)}</span>`).join(""):"";
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:170px">${g}</svg>${leg?`<div class="aleg">${leg}</div>`:""}`;
  }
  function statView(res){
    const rate=res.rate, v=res.value;
    // direction-aware + SLA-aligned: failure/return rates are GOOD when low (0% = green, not red)
    let cls=""; if(rate&&v!=null){ cls = res.bad ? (v<=0.05?"good":v<=0.15?"warn":"bad") : (v>=0.95?"good":v>=0.85?"warn":"bad"); }
    const disp = (v==null)?"—":(rate?fmtV(v,true):compact(v));      // compact hero (1.01M)
    const full = (v==null)?"—":(rate?fmtV(v,true):grp(v));          // exact on hover
    const nTag = (rate && res.sample!=null) ? `<div class="rl" style="font-size:10px;margin-top:2px">n=${grp(res.sample)}</div>` : "";  // sample size → flags tiny-sample rates
    return `<div class="astat rate ${cls}" title="${esc(full)}">${esc(disp)}</div>${nTag}`;
  }
  function tableView(res){
    const rows=res.rows||[]; if(!rows.length) return `<div class="sub">No rows.</div>`;
    const cols=Object.keys(rows[0]);
    return `<div style="overflow:auto;max-height:280px"><table class="atable"><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join("")}</tr>`+
      rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(r[c]==null?'':String(r[c]).slice(0,40))}</td>`).join("")}</tr>`).join("")+`</table></div>`;
  }

  // ---------- panel rendering ----------
  function mergedFilters(panel, globalFilters){
    const ds=st.catalog.datasets[panel.dataset]; if(!ds) return panel.filters||{};
    const gf = Object.assign({}, globalFilters||st.spec.filters||{}, window.ANA_GLOBAL_FILTERS||{});   // page/home-level overlay (e.g. plan_type)
    const gl={}; for(const[k,val]of Object.entries(gf)){ if(val===""||val==null) continue; if(k==='plan_type' || ds.filters.includes(k)) gl[k]=val; }   // plan_type is a special cross-dataset filter
    return Object.assign(gl, panel.filters||{});
  }
  async function renderPanel(panel, bodyEl, range, globalFilters){
    bodyEl.innerHTML=`<div class="sub">…</div>`;
    const R=range||window.OPS_RANGE||{hours:st.range||24};
    const eff = panel.rangeHours ? {hours:panel.rangeHours} : R;   // per-chart override ignores the global from/to
    // compute the window on the CLIENT (real browser clock, UTC-aligned to hour) so the axis always reaches "now"
    let win;
    if(eff.from&&eff.to){ win={from:eff.from,to:eff.to}; }
    else { const d=new Date(); d.setUTCMinutes(0,0,0); d.setUTCHours(d.getUTCHours()+1); win={to:d.toISOString(), from:new Date(d.getTime()-(eff.hours||24)*3600e3).toISOString()}; }
    if(panel.viz==='funnel'){   // step-to-step onboarding funnel (own endpoint, not the metric engine)
      const ch=(panel.filters&&panel.filters.number_order_type)||"";
      const pt=(window.ANA_GLOBAL_FILTERS&&window.ANA_GLOBAL_FILTERS.plan_type)||"";
      const qs=`?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}${ch!==""?`&channel=${encodeURIComponent(ch)}`:""}${pt?`&plan_type=${encodeURIComponent(pt)}`:""}`;
      let fr; try{ fr=await api("/api/funnel"+qs); }catch(e){ bodyEl.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
      bodyEl.innerHTML=funnelChart(fr); return;
    }
    if(panel.viz==='incomplete'){   // stuck onboarding orders table (own endpoint)
      const hrs=Math.max(1,Math.round((new Date(win.to)-new Date(win.from))/3600e3));
      let ir; try{ ir=await api(`/api/incomplete-orders?hours=${hrs}&limit=${panel.limit||40}`); }catch(e){ bodyEl.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
      bodyEl.innerHTML=incompleteTable(ir);
      bodyEl.querySelectorAll("[data-mob]").forEach(b=>b.addEventListener("click",()=>{ const m=b.getAttribute("data-mob"); if(m&&window.setConsoleHash) window.setConsoleHash("subscriber?key="+encodeURIComponent(m)); }));
      return;
    }
    const q={dataset:panel.dataset,metric:panel.metric,bucket:panel.bucket,groupBy:panel.groupBy,viz:panel.viz,compare:panel.compare||null,filters:mergedFilters(panel,globalFilters),rangeHours:eff.hours,limit:panel.limit||80,from:win.from,to:win.to};
    let res; try{ res=await api("/api/analytics/query",{method:"POST",body:JSON.stringify(q)}); }
    catch(e){ bodyEl.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    res._from=win.from; res._to=win.to;   // domain for the x-axis (line chart)
    res._markDrops=!!panel.markDrops;      // auto red markers on sharp dips
    paint(bodyEl, panel, res);
    // drill-down: click a decline-reason bar → list the actual declined payments in this window
    if(panel.viz==='pie' && panel.dataset==='payments' && (panel.groupBy==='decline'||panel.groupBy==='fail_reason')){
      bodyEl.querySelectorAll('.barrow[data-val]').forEach(b=>{ b.classList.add('clk'); b.title='Click to list these declined payments';
        b.addEventListener('click',()=>openDeclined(b.getAttribute('data-val'), win)); });
    }
  }

  // Declined-payment drill-down drawer (reuses the shared #txnDrawer). Lists the failed payments
  // behind a decline reason in the chart's window, with the gateway response + a link to the timeline.
  async function openDeclined(reason, win){
    const ov=document.getElementById('txnDrawer'); if(!ov) return; ov.classList.add('open');
    const body=document.getElementById('txnDrawerBody');
    const ksa=iso=>KT.md(iso);
    const label=(!reason||reason==='—')?'Unknown / not returned':reason;
    body.innerHTML=`<div class="drawer-hd"><b>Declined payments</b><span class="x" id="dwXd">×</span></div><div class="tl"><div class="sub" style="padding:16px 18px">Loading declined payments…</div></div>`;
    document.getElementById('dwXd').onclick=()=>ov.classList.remove('open');
    let r; try{ r=await api(`/api/payments/declined?reason=${encodeURIComponent(reason)}&from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}&limit=200`); }
    catch(e){ body.querySelector('.tl').innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const rows=r.rows||[];
    let h=`<div class="drawer-hd"><b>Declined · ${esc(label)}</b><span class="x" id="dwXd2">×</span></div>
      <div style="padding:12px 18px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted)">
        ${rows.length}${r.total>=200?'+':''} declined · ${ksa(win.from)} → ${ksa(win.to)} KSA · ${r.unmasked?'🔓 PII visible · Super Admin':'🔒 PII masked'}
      </div><div class="tl">`;
    if(!rows.length) h+=`<div class="okbox">No declined payments for this reason in the window.</div>`;
    rows.forEach((x,ix)=>{
      h+=`<div class="tlitem"><span class="dot faildot"></span>
        <div class="src">${esc(String(x.amount))} SAR · ${esc(x.vendor||'—')} · ${esc(x.card||'—')}</div>
        <div class="dt">${esc(x.mobile||'—')} · ${esc(x.on_type||'—')}${x.ref?` · ref ${esc(x.ref)}`:''}</div>
        <div class="tl-ep mono">${esc(x.reason||'—')}</div>
        ${x.response!=null?`<button class="tl-rrbtn" data-rr="${ix}">gateway response ▾</button><div class="tl-rr" id="drr_${ix}" hidden><div class="codeblk"><pre style="margin:0;white-space:pre-wrap;font-size:11px">${esc(JSON.stringify(x.response,null,2))}</pre></div></div>`:''}
        <div style="margin-top:7px"><button class="pill" data-tl="pay:${esc(x.id)}" style="border-left-color:var(--blue);font-size:11px;padding:3px 9px">Timeline →</button></div>
        <div class="ts">${ksa(x.when)} KSA</div></div>`;
    });
    h+=`</div>`; body.innerHTML=h;
    document.getElementById('dwXd2').onclick=()=>ov.classList.remove('open');
    body.querySelectorAll('.tl-rrbtn').forEach(b=>b.addEventListener('click',()=>{ const box=document.getElementById('drr_'+b.dataset.rr); if(!box)return; const op=box.hasAttribute('hidden'); if(op)box.removeAttribute('hidden'); else box.setAttribute('hidden',''); b.textContent=op?'gateway response ▴':'gateway response ▾'; }));
    body.querySelectorAll('[data-tl]').forEach(b=>b.addEventListener('click',()=>{ if(window.opsOpenTimeline) window.opsOpenTimeline(null, b.getAttribute('data-tl')); }));
  }

  // save the current user's PERSONAL copy of a board (never touches the shared board)
  async function savePersonal(key, spec){
    try{ await api(`/api/analytics/dashboards/${encodeURIComponent(key)}/mine`,{method:"PUT",body:JSON.stringify({spec})});
      const d=st.dashboards.find(x=>x.key===key); if(d){ d.spec=JSON.parse(JSON.stringify(spec)); d.mine=true; }
    }catch(e){ alert("Save failed: "+e.message); }
  }
  async function resetShared(){
    try{ await api(`/api/analytics/dashboards/${encodeURIComponent(st.dashKey)}/mine`,{method:"DELETE"}); }
    catch(e){ alert(e.message); return; }
    await load(); selectDash(st.dashKey);
  }
  function renderGrid(){
    const grid=$("#anaGrid");
    const firstPaint=!grid.querySelector(".apanel");
    if(!firstPaint) grid.style.opacity=".5";              // keep charts in place; dim while the new render loads
    const next=document.createElement("div");             // build OFF-DOM, then swap in atomically → no flicker
    const d=st.dashboards.find(x=>x.key===st.dashKey);
    if(d&&d.mine){ const b=el("div","apersonal"); b.style.gridColumn="span 12";
      b.innerHTML=`<span class="rl">✎ You've personalized this board — only you see these edits.</span> <button class="pill" id="anaResetShared" style="border-left-color:var(--muted)">↺ Reset to shared</button>`;
      next.appendChild(b); }
    (st.spec.panels||[]).forEach((panel,idx)=>{
      const p=el("div","apanel"); p.style.gridColumn=`span ${Math.min(12,Math.max(2,panel.w||6))}`;
      p.innerHTML=`<div class="ah"><b>${titleHTML(panel)}</b><div class="atools"><button data-edit="${idx}" title="Edit chart">✎</button><button data-del="${idx}" title="Remove">✕</button></div></div><div class="abody"></div>`;
      next.appendChild(p);
      renderPanel(panel, p.querySelector(".abody"));
    });
    grid.replaceChildren(...next.childNodes);
    grid.style.opacity="";
    const rs=grid.querySelector("#anaResetShared"); if(rs) rs.addEventListener("click",resetShared);
    grid.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openEditor(Number(b.dataset.edit))));
    grid.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{ st.spec.panels.splice(Number(b.dataset.del),1); await savePersonal(st.dashKey, st.spec); renderGrid(); }));
  }

  // ---------- global variables ----------
  let _filtersTok=0;
  async function renderFilters(){
    const bar=$("#anaFilters"); if(!bar) return;
    const myTok=++_filtersTok;   // guard: only the newest call may write the bar
    const GLOBAL=["platform","plan","vendor","status","sim_type","number_order_type","flow_type"];
    const dsList=[...new Set((st.spec.panels||[]).map(p=>p.dataset))];
    // build into a detached fragment so concurrent renders can't interleave appends → no dup fields
    const frag=document.createDocumentFragment(); let any=false;
    for(const key of GLOBAL){
      const ds=dsList.find(d=> st.catalog.datasets[d] && st.catalog.datasets[d].filters.includes(key));
      if(!ds) continue;
      const vals=await values(ds,key);
      if(myTok!==_filtersTok) return;   // a newer render started while we awaited — abandon this one
      if(!vals.length) continue;
      const cur=st.spec.filters[key]||"";
      const w=el("div","avar",`<label>${key.toUpperCase().replace(/_/g,' ')}</label>`);
      const sel=el("select"); sel.innerHTML=`<option value="">All</option>`+vals.map(optTag(cur)).join("");
      sel.addEventListener("change",()=>{ st.spec.filters[key]=sel.value; st.dirty=true; renderGrid(); });
      w.appendChild(sel); frag.appendChild(w); any=true;
    }
    if(myTok!==_filtersTok) return;
    bar.innerHTML="";   // swap in atomically, only now
    if(any) bar.appendChild(frag);
    else bar.innerHTML=`<div class="sub" style="font-size:11px">No shared filters for these panels — use per-panel Edit for dataset-specific filters.</div>`;
  }

  // ---------- panel editor ----------
  function openEditor(idx, ctx){
    ctx = ctx || { spec: st.spec, dashKey: st.dashKey, onApplied: ()=>{ renderGrid(); renderFilters(); } };
    const isNew = idx==null;
    const panel = isNew ? {title:"New panel",dataset:"payments",metric:"count",viz:"line",bucket:"hour",groupBy:null,filters:{},w:6} : JSON.parse(JSON.stringify(ctx.spec.panels[idx]));
    const card=$("#panelModalCard");
    const dsOpts=Object.entries(st.catalog.datasets).map(([k,d])=>`<option value="${k}" ${k===panel.dataset?'selected':''}>${esc(d.label)}</option>`).join("");
    function metricOpts(ds){ return Object.entries(st.catalog.datasets[ds].metrics).map(([k,m])=>`<option value="${k}" ${k===panel.metric?'selected':''}>${esc(m.label)}</option>`).join(""); }
    function dimOpts(ds){ return `<option value="">none</option>`+st.catalog.datasets[ds].dims.map(d=>`<option value="${d}" ${d===panel.groupBy?'selected':''}>${esc(d)}</option>`).join(""); }
    function draw(){
      card.innerHTML=`<div class="modal-head"><span class="path">${isNew?'Add panel':'Edit panel'}</span><span class="x" id="pmX">×</span></div>
      <div class="modal-body">
        <div class="ffull"><label>TITLE</label><input id="pm_title" value="${esc(panel.title)}"></div>
        <div class="fgrid" style="margin-top:10px">
          <div><label>DATASET</label><select id="pm_ds">${dsOpts}</select></div>
          <div><label>VISUALIZATION</label><select id="pm_viz">${['line','bar (horizontal)','column (vertical)','stat','table','pie','donut'].map(o=>{const v=o.split(' ')[0];return `<option value="${v}" ${v===panel.viz?'selected':''}>${o}</option>`;}).join("")}</select></div>
          <div id="pm_metric_wrap"><label>METRIC</label><select id="pm_metric">${metricOpts(panel.dataset)}</select></div>
          <div id="pm_bucket_wrap"><label>TIME BUCKET</label><select id="pm_bucket">${[['minute','1 min'],['5min','5 min'],['15min','15 min'],['hour','hour'],['day','day'],['week','week']].map(([v,l])=>`<option value="${v}" ${v===panel.bucket?'selected':''}>${l}</option>`).join("")}</select></div>
          <div id="pm_group_wrap"><label>GROUP BY</label><select id="pm_group">${dimOpts(panel.dataset)}</select></div>
          <div><label>WIDTH (1–12)</label><input id="pm_w" type="number" min="2" max="12" value="${panel.w||6}"></div>
          <div id="pm_compare_wrap"><label>COMPARE</label><select id="pm_compare"><option value="">none</option><option value="prev" ${panel.compare==='prev'?'selected':''}>today vs yesterday</option></select></div>
          <div id="pm_range_wrap"><label>TIME RANGE</label><select id="pm_range">${[['','Dashboard range'],['6','Last 6h'],['12','Last 12h'],['24','Last 24h'],['48','Last 48h'],['72','Last 3d'],['168','Last 7d'],['720','Last 30d']].map(([v,l])=>`<option value="${v}" ${String(panel.rangeHours||'')===v?'selected':''}>${l}</option>`).join("")}</select></div>
          <div id="pm_drops_wrap"><label>MARK DROPS</label><label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:12.5px;padding-top:4px"><input type="checkbox" id="pm_drops" ${panel.markDrops?'checked':''}> red lines on sharp dips</label></div>
        </div>
        <div id="pm_filters"></div>
        <div class="dpanel" style="margin-top:12px"><h4>PREVIEW</h4><div id="pm_preview" style="min-height:80px"></div></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="pill" id="pm_cancel">Cancel</button>
          <button class="pill" id="pm_apply" style="border-left-color:var(--green)">${isNew?'Add':'Apply'}</button>
        </div>
      </div>`;
      // filters block
      const ds=st.catalog.datasets[panel.dataset];
      const fb=card.querySelector("#pm_filters");
      fb.innerHTML=`<label style="font-size:10px;letter-spacing:.6px;color:var(--muted);font-weight:800;margin-top:12px;display:block">FILTERS</label><div class="fgrid" id="pm_fg"></div>`;
      const fg=card.querySelector("#pm_fg");
      ds.filters.forEach(async fk=>{
        const wrap=el("div"); wrap.innerHTML=`<label>${esc(fk)}</label>`;
        const sel=el("select"); sel.dataset.fk=fk; sel.innerHTML=`<option value="">any</option>`;
        fg.appendChild(wrap); wrap.appendChild(sel);
        const vals=await values(panel.dataset,fk);
        sel.innerHTML=`<option value="">any</option>`+vals.map(optTag(panel.filters[fk])).join("");
        sel.addEventListener("change",()=>{ if(sel.value)panel.filters[fk]=sel.value; else delete panel.filters[fk]; preview(); });
      });
      // viz-dependent visibility
      const viz=panel.viz;
      card.querySelector("#pm_metric_wrap").style.display = viz==="table"?"none":"";
      card.querySelector("#pm_bucket_wrap").style.display = (viz==="stat"||viz==="table"||viz==="pie"||viz==="donut")?"none":"";
      card.querySelector("#pm_group_wrap").style.display = (viz==="stat"||viz==="table")?"none":"";
      card.querySelector("#pm_compare_wrap").style.display = (viz==="line"||viz==="bar"||viz==="column")?"":"none";
      // wire
      const gather=()=>{ panel.title=card.querySelector("#pm_title").value; panel.dataset=card.querySelector("#pm_ds").value;
        panel.viz=card.querySelector("#pm_viz").value; panel.w=Number(card.querySelector("#pm_w").value)||6;
        if(card.querySelector("#pm_metric")) panel.metric=card.querySelector("#pm_metric").value;
        if(card.querySelector("#pm_bucket")) panel.bucket=card.querySelector("#pm_bucket").value;
        if(card.querySelector("#pm_group")) panel.groupBy=card.querySelector("#pm_group").value||null;
        panel.compare = card.querySelector("#pm_compare") ? (card.querySelector("#pm_compare").value||null) : null;
        const rg=card.querySelector("#pm_range"); panel.rangeHours = rg&&rg.value ? Number(rg.value) : null;
        const dc=card.querySelector("#pm_drops"); panel.markDrops = !!(dc && dc.checked);
        panel.bucket = panel.viz==="stat"?"stat":panel.viz==="table"?"none":(panel.viz==="pie"||panel.viz==="donut")?"pie":(['stat','none','pie'].includes(panel.bucket)?'hour':panel.bucket); };
      card.querySelector("#pm_ds").addEventListener("change",()=>{ gather(); panel.metric="count"; panel.groupBy=null; panel.filters={}; draw(); });
      card.querySelector("#pm_viz").addEventListener("change",()=>{ gather(); draw(); });
      ["#pm_title","#pm_metric","#pm_bucket","#pm_group","#pm_w","#pm_compare","#pm_range","#pm_drops"].forEach(sid=>{ const e=card.querySelector(sid); if(e) e.addEventListener("change",()=>{ gather(); preview(); }); });
      card.querySelector("#pmX").onclick=()=>$("#panelModal").classList.remove("open");
      card.querySelector("#pm_cancel").onclick=()=>$("#panelModal").classList.remove("open");
      card.querySelector("#pm_apply").onclick=async()=>{ gather(); if(isNew) ctx.spec.panels.push(panel); else ctx.spec.panels[idx]=panel; $("#panelModal").classList.remove("open"); await savePersonal(ctx.dashKey, ctx.spec); ctx.onApplied&&ctx.onApplied(); };
      preview();
    }
    async function preview(){ const pv=card.querySelector("#pm_preview"); if(pv) await renderPanel(panel, pv); }
    $("#panelModal").classList.add("open");
    draw();
  }
  document.getElementById("panelModal").addEventListener("click",e=>{ if(e.target.id==="panelModal") e.currentTarget.classList.remove("open"); });

  // ---------- dashboards (SVG icon nav) ----------
  const _svg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const DASH_SVG = d => { const s=((d.key||'')+' '+(d.name||'')).toLowerCase();
    if(!d.builtin) return _svg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>');
    if(/overview/.test(s)) return _svg('<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>');
    if(/trend/.test(s)) return _svg('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>');
    if(/new.?sim/.test(s)) return _svg('<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/>');
    if(/mnp|funnel/.test(s)) return _svg('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>');
    if(/activation/.test(s)) return _svg('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>');
    if(/swap|replacement/.test(s)) return _svg('<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>');
    if(/plan/.test(s)) return _svg('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>');
    if(/payment/.test(s)) return _svg('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>');
    if(/eligib|identity|kyc|nafath|semati/.test(s)) return _svg('<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>');
    if(/integration|health/.test(s)) return _svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>');
    if(/channel|device/.test(s)) return _svg('<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>');
    if(/delivery/.test(s)) return _svg('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>');
    if(/error|code/.test(s)) return _svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>');
    if(/onboard|orders/.test(s)) return _svg('<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>');
    return _svg('<circle cx="12" cy="12" r="9"/>'); };
  // group dashboards by journey layer
  // explicit category + sub-tab order per dashboard key — wins over the name regex below.
  // Onboarding journey group: Overview first, then the funnels, then Change Plan + Transfer Ownership.
  const DASH_META = {
    overview:{cat:'Onboarding',ord:1}, funnel_newsim:{cat:'Onboarding',ord:2}, funnel_mnp:{cat:'Onboarding',ord:3},
    plan_change:{cat:'Onboarding',ord:4}, transfer_ownership:{cat:'Onboarding',ord:5}
  };
  const DASH_CAT = d => { if(d && DASH_META[d.key]) return DASH_META[d.key].cat; if(!d.builtin) return 'Yours';
    const s=((d.key||'')+' '+(d.name||'')).toLowerCase();
    if(/payment/.test(s)) return 'Payments';
    if(/onboard|orders|overview|funnel|mnp|new.?sim/.test(s)) return 'Onboarding';
    if(/activation|eligib|error|code|semati|nafath|identity/.test(s)) return 'Activation';
    if(/delivery|swap|replacement|plan/.test(s)) return 'Servicing';
    if(/integration|health|channel|device/.test(s)) return 'Platform';
    return 'Other'; };
  const DASH_ORD = d => (d && DASH_META[d.key] && DASH_META[d.key].ord) || 99;
  const CAT_ORDER=['Platform','Onboarding','Payments','Activation','Servicing','Other','Yours'];
  // expose the grouping so the Settings → Navigation editor can list categories/dashboards
  window.ANA_NAV = { cat: DASH_CAT, order: CAT_ORDER.slice() };
  function ensureIconCss(){
    if(document.getElementById("icontab-css")) return;
    const st2=document.createElement("style"); st2.id="icontab-css";
    st2.textContent=`
      .anacat-bar{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;margin:2px 0 14px}
      .catchip{padding:8px 16px;border:1px solid var(--line,#e5e7eb);background:transparent;color:var(--muted,#64748b);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:999px;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.03);transition:background .16s,border-color .16s,color .16s,box-shadow .16s,transform .16s}
      .catchip:hover{color:#2563eb;border-color:#93c5fd;background:rgba(37,99,235,.06);transform:translateY(-1px);box-shadow:0 3px 12px rgba(37,99,235,.14)}
      .catchip.active{color:#fff;background:#2563eb;border-color:#2563eb;box-shadow:0 5px 14px rgba(37,99,235,.30)}
      .catchip .cc-n{opacity:.5;font-weight:600;margin-left:5px}
      .catchip.active .cc-n{opacity:.85}
      .anadash-bar{display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;padding:2px 0 4px}
      .icontab{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border:1px solid var(--line,#e5e7eb);border-radius:10px;background:transparent;color:var(--muted,#64748b);font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer;transition:background .16s,border-color .16s,color .16s,box-shadow .16s,transform .16s}
      .icontab svg{width:17px;height:17px;flex:0 0 auto;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .16s}
      .icontab:hover{background:rgba(37,99,235,.06);border-color:#93c5fd;color:#2563eb;transform:translateY(-1px);box-shadow:0 2px 10px rgba(37,99,235,.12)}
      .icontab:hover svg{transform:scale(1.12)}
      .icontab.active{background:#2563eb;border-color:#2563eb;color:#fff;box-shadow:0 6px 16px rgba(37,99,235,.32)}
      .icontab.active svg{stroke:#fff}
    `;
    document.head.appendChild(st2);
  }
  function renderDashTabs(){
    const bar=$("#anaDashes"); if(!bar) return;
    ensureIconCss();
    // shared nav config: hide dashboards/categories and honour the saved category order
    const nav=(window.uiNav?window.uiNav().analytics:{catOrder:[],catHidden:[],dashHidden:[]});
    const dashHidden=new Set(nav.dashHidden||[]), catHidden=new Set(nav.catHidden||[]);
    const groups={}; st.dashboards.forEach(d=>{ if(dashHidden.has(d.key)) return; const c=DASH_CAT(d); (groups[c] ||= []).push(d); });
    // baseline sub-tab order: explicit ord (Overview first…), then name. Saved dashOrder overrides below.
    Object.keys(groups).forEach(c=>{ groups[c].sort((a,b)=> DASH_ORD(a)-DASH_ORD(b) || String(a.name||'').localeCompare(String(b.name||''))); });
    // honour saved dashboard order within each category
    const dOrd=nav.dashOrder||{};
    Object.keys(groups).forEach(c=>{ const ord=dOrd[c]; if(ord&&ord.length){ const ix=k=>{const i=ord.indexOf(k);return i<0?999:i;}; groups[c]=groups[c].slice().sort((a,b)=>ix(a.key)-ix(b.key)); } });
    const order=(nav.catOrder&&nav.catOrder.length) ? nav.catOrder.concat(CAT_ORDER.filter(c=>!nav.catOrder.includes(c))) : CAT_ORDER;
    const cats=order.filter(c=>groups[c]&&groups[c].length&&!catHidden.has(c));
    const active=st.dashboards.find(d=>d.key===st.dashKey);
    const wantCat=active?DASH_CAT(active):null;
    if(!st.dashCat || !cats.includes(st.dashCat)) st.dashCat = (wantCat&&cats.includes(wantCat))?wantCat:(cats[0]||"");
    // level 1 — category tabs
    const catBar=document.getElementById("anaCats");
    if(catBar){ catBar.className="anacat-bar";
      catBar.innerHTML=cats.map(c=>`<button class="catchip ${c===st.dashCat?'active':''}" data-cat="${esc(c)}">${esc(c)}<span class="cc-n">${groups[c].length}</span></button>`).join("");
      catBar.querySelectorAll("[data-cat]").forEach(b=>b.addEventListener("click",()=>{ const c=b.dataset.cat; const first=(groups[c]||[])[0]; st.dashCat=c; if(first) selectDash(first.key); else renderDashTabs(); }));
    }
    // level 2 — dashboards in the selected category (hidden when a category has just one dashboard)
    const items=groups[st.dashCat]||[];
    bar.className="anadash-bar"; bar.innerHTML="";
    if(items.length<=1){ bar.style.display="none"; }
    else { bar.style.display="";
      items.forEach(d=>{
        const isActive=d.key===st.dashKey;
        const p=el("button","icontab"+(isActive?" active":""), `${DASH_SVG(d)}<span>${esc(d.name)}${d.builtin?'':' •'}</span>`);
        p.title=d.name+(d.builtin?'':' (custom)');
        p.setAttribute("aria-label", d.name);
        p.addEventListener("click",()=>{ selectDash(d.key); });
        bar.appendChild(p);
      });
    }
  }
  function selectDash(key){ const d=st.dashboards.find(x=>x.key===key); if(!d)return; st.dashKey=key; st.spec=JSON.parse(JSON.stringify(d.spec||{filters:{},panels:[]})); if(!st.spec.filters)st.spec.filters={}; if(!st.spec.panels)st.spec.panels=[]; st.dirty=false; renderDashTabs(); renderFilters(); renderGrid(); }

  async function load(){
    try{ st.catalog=await api("/api/analytics/catalog"); }
    catch(e){ $("#anaGrid").innerHTML=`<div class="albanner" style="grid-column:span 12">Analytics needs the console API. ${esc(e.message)}</div>`; return; }
    const dl=await api("/api/analytics/dashboards"); st.dashboards=dl.dashboards||[];
    if(!st.dashboards.length){ $("#anaGrid").innerHTML=`<div class="sub" style="grid-column:span 12">No dashboards.</div>`; return; }
    if(!st.dashKey || !st.dashboards.find(d=>d.key===st.dashKey)) st.dashKey=st.dashboards[0].key;
    selectDash(st.dashKey);
  }

  // controls
  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="analytics") b.addEventListener("click",()=>{ if(!st.dashboards.length){ const g=$("#anaGrid"); if(g&&!g.querySelector(".apanel")) g.innerHTML=`<div class="sub" style="grid-column:span 12">Loading analytics…</div>`; load(); } else { renderDashTabs(); renderFilters(); renderGrid(); } }); });
  document.addEventListener("uinavchange",()=>{ if(st.dashboards.length && $("#view-analytics")) renderDashTabs(); });
  document.addEventListener("themechange",()=>{ if($("#view-analytics").classList.contains("active")) renderGrid(); });
  document.addEventListener("opsrangechange",()=>{ if($("#view-analytics").classList.contains("active")) renderGrid(); });
  document.addEventListener("opsdatarefresh",()=>{ if($("#view-analytics").classList.contains("active")) renderGrid(); });
  const anaRef=$("#anaRefresh"); if(anaRef) anaRef.addEventListener("click",renderGrid);
  $("#anaAdd").addEventListener("click",()=>openEditor(null));   // any user → adds to their personal view
  $("#anaSave").addEventListener("click",async()=>{
    if(!canEdit()){ alert("Your role can't save dashboards."); return; }
    const name=prompt("Save dashboard as:", st.dashboards.find(d=>d.key===st.dashKey)?.name||"My dashboard"); if(!name)return;
    const key = st.dashKey.startsWith("custom_")?st.dashKey:("custom_"+name.toLowerCase().replace(/[^a-z0-9]+/g,"_").slice(0,30));
    try{ await api(`/api/analytics/dashboards/${key}`,{method:"PUT",body:JSON.stringify({name,spec:st.spec})}); st.dirty=false; await load(); st.dashKey=key; selectDash(key); }
    catch(e){ alert("Save failed: "+e.message); }
  });

  // ---------- reuse API (Home dashboard) ----------
  async function ensureLoaded(){
    if(!st.catalog||!st.catalog.datasets){ try{ st.catalog=await api("/api/analytics/catalog"); }catch(e){} }
    if(!st.dashboards.length){ try{ const dl=await api("/api/analytics/dashboards"); st.dashboards=dl.dashboards||[]; }catch(e){} }
    return st.dashboards;
  }
  window.anaEnsureLoaded = ensureLoaded;
  window.anaDashboards = ()=> st.dashboards.slice();
  // render one dashboard's panels (read-only) into a container, using an explicit range
  window.anaRenderDashboard = async (container, dashKey, range)=>{
    await ensureLoaded();
    const d = st.dashboards.find(x=>x.key===dashKey);
    if(!d){ container.innerHTML=`<div class="sub" style="grid-column:span 12">Dashboard not found.</div>`; return; }
    const spec = d.spec||{filters:{},panels:[]};
    const redraw=()=>window.anaRenderDashboard(container, dashKey, range);
    container.innerHTML="";
    const panels=spec.panels||[];
    const yield_=()=>new Promise(r=>requestAnimationFrame(()=>r()));
    // 1) Lay out every panel shell WITH a loader immediately, so the grid appears at once (no blank freeze).
    const bodies=panels.map((panel,idx)=>{
      const p=el("div","apanel"); p.style.gridColumn=`span ${Math.min(12,Math.max(2,panel.w||6))}`;
      p.innerHTML=`<div class="ah"><b>${titleHTML(panel, range&&range.hours)}</b><div class="atools"><button data-edit="${idx}" title="Edit chart">✎</button><button data-del="${idx}" title="Remove">✕</button></div></div><div class="abody">${window.salamLoader?window.salamLoader("Loading…"):'<div class="sub">Loading…</div>'}</div>`;
      container.appendChild(p);
      return p.querySelector(".abody");
    });
    // 2) Fetch panels in PARALLEL (fast), each filling its own shell as it resolves — panel-by-panel,
    //    never a blank frozen page. A yield after each render lets the browser paint between commits
    //    so the tab never trips the "unresponsive" watchdog.
    await Promise.all(panels.map(async (panel,idx)=>{
      try{ await renderPanel(panel, bodies[idx], range, spec.filters||{}); }
      catch(e){ bodies[idx].innerHTML=`<div class="albanner">${esc(e.message||e)}</div>`; }
      await yield_();
    }));
    // per-chart edit/remove → saves to the user's personal copy of THIS board, then redraws
    container.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openEditor(Number(b.dataset.edit),{spec,dashKey,onApplied:redraw})));
    container.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{ spec.panels.splice(Number(b.dataset.del),1); await savePersonal(dashKey,spec); redraw(); }));
  };

  // ---- interactive hover for EVERY line chart (guide line + colored dots + floating tooltip) ----
  (function initLineHover(){
    let tip=null;
    const escT=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
    function hide(){ if(tip) tip.style.display="none"; document.querySelectorAll(".lc-guide,.lc-dotwrap").forEach(n=>n.remove()); }
    function tipEl(){ if(!tip){ tip=document.createElement("div"); tip.className="lc-tip"; tip.style.display="none"; document.body.appendChild(tip); } return tip; }
    document.addEventListener("mousemove", e=>{
      const wrap = e.target.closest && e.target.closest(".lc-wrap");
      if(!wrap){ hide(); return; }
      const svg = wrap.querySelector("svg.linechart[data-hv]"); if(!svg){ hide(); return; }
      let data; try{ data=JSON.parse(svg.getAttribute("data-hv")); }catch(_){ hide(); return; }
      if(!data.buckets || !data.buckets.length){ hide(); return; }
      const rect = svg.getBoundingClientRect();
      const vbX = ((e.clientX-rect.left)/rect.width) * data.W;
      let b=data.buckets[0], bd=Infinity; for(const bk of data.buckets){ const d=Math.abs(bk.cx-vbX); if(d<bd){ bd=d; b=bk; } }
      const leftPx = (b.cx/data.W)*rect.width;
      // vertical guide
      let guide=wrap.querySelector(".lc-guide"); if(!guide){ guide=document.createElement("div"); guide.className="lc-guide"; wrap.appendChild(guide); }
      guide.style.left=leftPx+"px"; guide.style.height=rect.height+"px";
      // colored dots at each series value
      let dw=wrap.querySelector(".lc-dotwrap"); if(!dw){ dw=document.createElement("div"); dw.className="lc-dotwrap"; wrap.appendChild(dw); }
      dw.innerHTML=b.e.map(en=>`<i style="left:${leftPx}px;top:${(en.cy/data.H)*rect.height}px;background:${en.c}"></i>`).join("");
      // tooltip
      const t=tipEl();
      t.innerHTML=`<div class="lc-tip-h">${escT(b.tl)}</div>`+b.e.map(en=>`<div class="lc-tip-r"><i style="background:${en.c}"></i><span>${escT(en.l)}</span><b>${escT(en.v)}</b></div>`).join("");
      t.style.display="block";
      const tw=t.offsetWidth, th=t.offsetHeight;
      let lx=e.clientX+14; if(lx+tw>window.innerWidth-8) lx=e.clientX-tw-14;
      let ly=e.clientY-th-12; if(ly<8) ly=e.clientY+18;
      t.style.left=lx+"px"; t.style.top=ly+"px";
    });
    document.addEventListener("mouseleave", ()=>hide());
    window.addEventListener("scroll", ()=>hide(), true);
  })();

  // ---- ops event timeline: load once + refresh on each live tick; charts read window.OPS_EVENTS ----
  async function ensureEvents(){ try{ const d=await api("/api/events"); window.OPS_EVENTS=d.events||[]; }catch(e){} }
  window.anaReloadEvents = ensureEvents;
  document.addEventListener("consoleReady", ensureEvents);
  document.addEventListener("opsdatarefresh", ensureEvents);
  ensureEvents();
})();
