/* fixed-errtrend.js — Fixed › Troubleshoot: "Evolution by hour" — one line per error message over the selected period.
 * Data: /api/fixed/errors/trend (server/src/fixedErrorTrend.js) — read from the console-side hourly rollup, never from
 * the read models, memoised per URL; the board's filters (window, channel, type, provider, class, category, team,
 * message, open only) flow through. No chart library: one responsive SVG, redrawn on resize, hover crosshair with the
 * values of every visible line at that hour, legend chips that toggle lines, the message selected on the board drawn
 * bold. Owner: fixed-errors.js calls window.fixedErrTrend.render(el, fx, { qs, msg, openOnly, onPick }). */
(function(){
  "use strict";
  const LS=k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const SAVE=(k,v)=>{ try{ localStorage.setItem(k,v); }catch(e){} };
  const T={ top:Number(LS("fixed_trend_top"))||8, bucket:LS("fixed_trend_bucket")||"auto", hidden:new Set(), other:LS("fixed_trend_other")!=="0", all:LS("fixed_trend_all")==="1", tick:0, last:null, ro:null };
  const PALETTE=["#2563eb","#dc2626","#059669","#d97706","#7c3aed","#0891b2","#db2777","#65a30d","#ea580c","#4f46e5","#0d9488","#b91c1c","#9333ea","#ca8a04","#1d4ed8","#be123c","#15803d","#c026d3","#0369a1","#a16207"];
  const CLS={ business:{fg:"#3b82f6",bg:"rgba(59,130,246,.14)"}, technical:{fg:"#ef4444",bg:"rgba(239,68,68,.14)"} };
  const STYLE=`
    .fet{background:var(--card,#fff);border:1px solid var(--line);border-radius:14px;padding:14px 18px 10px;box-shadow:0 1px 3px rgba(2,6,23,.05);margin:6px 0 14px}
    .fet-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px} .fet-head h3{margin:0;font-size:14px;font-weight:800;letter-spacing:-.1px} .fet-head .sub{font-size:11.5px;color:var(--muted)}
    .fet-ctl{margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap} .fet-ctl select{font:inherit;font-size:12px;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2,#f1f5f9);color:var(--ink)}
    .fet-ctl label{display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;color:var(--ink)} .fet-ctl input{accent-color:var(--green,#0e9f5a)}
    .fet-svgwrap{position:relative;width:100%} .fet-svgwrap svg{display:block;width:100%;height:auto;overflow:visible}
    .fet-tip{position:absolute;pointer-events:none;z-index:5;background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(2,6,23,.16);padding:8px 10px;font-size:11.5px;min-width:220px;max-width:380px;display:none}
    .fet-tip b.t{display:block;font-size:12px;margin-bottom:4px} .fet-tip .r{display:flex;align-items:center;gap:6px;line-height:1.5} .fet-tip .r i{display:inline-block;width:9px;height:9px;border-radius:3px;flex:none} .fet-tip .r span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .fet-tip .r b{font-variant-numeric:tabular-nums}
    .fet-leg{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
    .fet-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;cursor:pointer;font:inherit;font-size:11.5px;padding:4px 9px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink);transition:border-color .14s,opacity .14s,transform .14s}
    .fet-chip:hover{border-color:var(--green,#0e9f5a);transform:translateY(-1px)} .fet-chip.off{opacity:.42} .fet-chip.off i{background:var(--muted)!important} .fet-chip.sel{border-color:var(--green,#0e9f5a);box-shadow:0 0 0 3px rgba(14,159,90,.15);font-weight:700}
    .fet-chip i{display:inline-block;width:10px;height:10px;border-radius:3px;flex:none} .fet-chip .m{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .fet-chip .n{color:var(--muted);font-variant-numeric:tabular-nums;font-weight:700}
    .fet-chip .c{font-size:9.5px;font-weight:800;padding:1px 6px;border-radius:999px;letter-spacing:.02em} .fet-chip .f{color:var(--muted);font-size:11px;padding:0 2px;border-radius:4px} .fet-chip .f:hover{color:var(--green,#0e9f5a)}
    .fet-foot{display:flex;flex-wrap:wrap;gap:8px 14px;font-size:11px;color:var(--muted);margin-top:8px;align-items:center} .fet-foot .warn{color:var(--warn-fg,#b45309);font-weight:700}
    .fet-empty{padding:18px 4px;color:var(--muted);font-size:12.5px}
    @media (max-width:700px){.fet{padding:12px 12px 8px} .fet-chip .m{max-width:200px} .fet-tip{min-width:180px;max-width:82vw}}
  `;
  const fmtN=v=>Number(v||0).toLocaleString("en-US");
  const ksa=(iso,bucket)=>{ const d=new Date(iso); if(isNaN(d)) return "—"; return bucket==="day"?d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",timeZone:"Asia/Riyadh"}):d.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Riyadh"}); };
  const short=(s,n)=>{ s=String(s||""); return s.length>n?s.slice(0,n-1)+"…":s; };
  const rel=v=>{ if(!v) return "never"; const m=Math.floor((Date.now()-new Date(v).getTime())/6e4); if(m<1) return "just now"; if(m<60) return m+" min ago"; const h=Math.floor(m/60); if(h<48) return h+" h ago"; return Math.floor(h/24)+" d ago"; };

  async function render(el,fx,opts){
    if(!el) return; const my=++T.tick; opts=opts||{};
    if(!el.querySelector(".fet")){ el.innerHTML=`<style>${STYLE}</style><div class="fet"><div class="fet-head"><h3>Evolution by hour</h3><span class="sub">each error message over the selected period · from the hourly rollup</span><div class="fet-ctl"></div></div><div class="fet-body"><div class="fet-empty">${window.salamLoader?window.salamLoader("Reading the hourly rollup…"):"Loading…"}</div></div></div>`; }
    const q=`${opts.qs||""}&top=${T.top}&bucket=${T.bucket}`;
    let d; try{ d=await fx.api("/api/fixed/errors/trend?"+q); }catch(e){ if(my!==T.tick) return; el.querySelector(".fet-body").innerHTML=`<div class="fet-empty">Trend unavailable — ${fx.esc(e.message)}</div>`; return; }
    if(my!==T.tick||!el.isConnected) return;
    T.last={d,fx,opts,el};
    draw(el,fx,d,opts);
    if(!T.ro&&window.ResizeObserver){ T.ro=new ResizeObserver(()=>{ if(T.last&&T.last.el.isConnected) paint(T.last.el,T.last.fx,T.last.d,T.last.opts); }); }
    if(T.ro){ try{ T.ro.disconnect(); T.ro.observe(el); }catch(e){} }
  }

  function draw(el,fx,d,opts){
    const esc=fx.esc; const ctl=el.querySelector(".fet-ctl");
    ctl.innerHTML=`<select id="fetTop" title="How many messages get their own line (the rest are summed into Other)">${[5,8,12,20].map(n=>`<option value="${n}"${T.top===n?" selected":""}>Top ${n}</option>`).join("")}</select>
      <select id="fetBucket" title="Point granularity — Auto: hourly up to 8 days, daily beyond"><option value="auto"${T.bucket==="auto"?" selected":""}>Auto (${d.bucket})</option><option value="hour"${T.bucket==="hour"?" selected":""}>Hourly</option><option value="day"${T.bucket==="day"?" selected":""}>Daily</option></select>
      <label title="Every other message summed into one dashed line"><input type="checkbox" id="fetOther"${T.other?" checked":""}> Other</label>
      <label title="All errors together (grey area)"><input type="checkbox" id="fetAll"${T.all?" checked":""}> All errors</label>
      <button type="button" class="fe-btn" id="fetReset" title="Show every line again">Show all</button>`;
    ctl.querySelector("#fetTop").onchange=e=>{ T.top=Number(e.target.value); SAVE("fixed_trend_top",T.top); render(el,fx,opts); };
    ctl.querySelector("#fetBucket").onchange=e=>{ T.bucket=e.target.value; SAVE("fixed_trend_bucket",T.bucket); render(el,fx,opts); };
    ctl.querySelector("#fetOther").onchange=e=>{ T.other=e.target.checked; SAVE("fixed_trend_other",T.other?"1":"0"); paint(el,fx,d,opts); };
    ctl.querySelector("#fetAll").onchange=e=>{ T.all=e.target.checked; SAVE("fixed_trend_all",T.all?"1":"0"); paint(el,fx,d,opts); };
    ctl.querySelector("#fetReset").onclick=()=>{ T.hidden.clear(); paint(el,fx,d,opts); };
    paint(el,fx,d,opts);
  }

  function paint(el,fx,d,opts){
    const esc=fx.esc; const body=el.querySelector(".fet-body"); if(!body) return;
    const ticks=d.ticks||[]; const series=(d.series||[]).map((s,i)=>({...s,color:PALETTE[i%PALETTE.length],key:s.msg}));
    if(!ticks.length||!series.length){ body.innerHTML=`<div class="fet-empty">No errors in this period${d.note?` · ${esc(d.note)}`:""}.</div>`; return; }
    const sel=opts.msg||d.selected||"";
    const lines=series.filter(s=>!T.hidden.has(s.key));
    const other=T.other&&d.other?{...d.other,key:"__other",color:"var(--muted)",dashed:true}:null;
    const all=T.all&&d.all?d.all:null;
    const W=Math.max(320,Math.floor(body.clientWidth||el.clientWidth||900)), H=Math.min(340,Math.max(220,Math.round(W*0.30)));
    const ML=44, MR=14, MT=12, MB=30; const iw=W-ML-MR, ih=H-MT-MB;
    let ymax=0; for(const s of lines) for(const v of s.points) if(v>ymax) ymax=v; if(other) for(const v of other.points) if(v>ymax) ymax=v; if(all) for(const v of all.points) if(v>ymax) ymax=v;
    if(ymax<=0) ymax=1; const nice=v=>{ const p=Math.pow(10,Math.floor(Math.log10(v))); const m=v/p; const r=m<=1?1:m<=2?2:m<=5?5:10; return r*p; }; const ytop=nice(ymax*1.08);
    const X=i=>ML+(ticks.length>1?i/(ticks.length-1)*iw:iw/2), Y=v=>MT+ih-(v/ytop)*ih;
    const path=pts=>pts.map((v,i)=>`${i?"L":"M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const area=pts=>`M${X(0).toFixed(1)},${(MT+ih).toFixed(1)} `+pts.map((v,i)=>`L${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")+` L${X(pts.length-1).toFixed(1)},${(MT+ih).toFixed(1)} Z`;
    const gridN=4; const grid=[]; for(let g=0;g<=gridN;g++){ const v=ytop*g/gridN; grid.push(`<line x1="${ML}" x2="${W-MR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--line-soft,var(--line))" stroke-width="1"/><text x="${ML-6}" y="${(Y(v)+4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtN(Math.round(v))}</text>`); }
    const labelEvery=Math.max(1,Math.ceil(ticks.length/Math.max(3,Math.floor(iw/90)))); const xl=[];
    for(let i=0;i<ticks.length;i+=labelEvery) xl.push(`<text x="${X(i).toFixed(1)}" y="${H-8}" text-anchor="${i===0?"start":"middle"}" font-size="10" fill="var(--muted)">${esc(ksa(ticks[i],d.bucket))}</text>`);
    const dim=sel&&lines.some(s=>s.key===sel);
    const svgLines=[];
    if(all) svgLines.push(`<path d="${area(all.points)}" fill="var(--muted)" opacity=".10"/><path d="${path(all.points)}" fill="none" stroke="var(--muted)" stroke-width="1.2" opacity=".55"/>`);
    if(other) svgLines.push(`<path d="${path(other.points)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4" opacity=".8"/>`);
    for(const s of lines){ const isSel=s.key===sel; svgLines.push(`<path d="${path(s.points)}" fill="none" stroke="${s.color}" stroke-width="${isSel?3.2:1.8}" stroke-linejoin="round" stroke-linecap="round" opacity="${dim&&!isSel?.35:1}"/>`);
      if(ticks.length<=48) svgLines.push(s.points.map((v,i)=>v>0?`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${isSel?3:2.2}" fill="${s.color}" opacity="${dim&&!isSel?.35:1}"/>`:"").join("")); }
    body.innerHTML=`<div class="fet-svgwrap"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="error evolution chart">
        ${grid.join("")}${xl.join("")}
        <line x1="${ML}" x2="${ML}" y1="${MT}" y2="${MT+ih}" stroke="var(--line)"/><line x1="${ML}" x2="${W-MR}" y1="${MT+ih}" y2="${MT+ih}" stroke="var(--line)"/>
        ${svgLines.join("")}
        <line id="fetCross" x1="0" x2="0" y1="${MT}" y2="${MT+ih}" stroke="var(--ink)" stroke-width="1" opacity="0" stroke-dasharray="3 3"/>
        <rect id="fetHit" x="${ML}" y="${MT}" width="${iw}" height="${ih}" fill="transparent" style="cursor:crosshair"/></svg><div class="fet-tip"></div></div>
      <div class="fet-leg">${series.map(s=>{ const c=CLS[s.cls]; const on=!T.hidden.has(s.key); return `<button type="button" class="fet-chip${on?"":" off"}${s.key===sel?" sel":""}" data-k="${esc(s.key)}" title="${esc(s.msg)}\nclick: show / hide this line · ⌕ filters the board on this message"><i style="background:${s.color}"></i><span class="m">${esc(short(s.msg,64))}</span>${c?`<span class="c" style="background:${c.bg};color:${c.fg}">${s.cls==="technical"?"T":"B"}</span>`:""}<span class="n">${fmtN(d.openOnly?s.open:s.total)}</span><span class="f" data-pick="${esc(s.key)}" title="Filter the board on this message">⌕</span></button>`; }).join("")}
        ${d.other?`<button type="button" class="fet-chip${T.other?"":" off"}" data-k="__other" title="${esc(d.other.msg)} — summed"><i style="background:var(--muted);border:1px dashed var(--ink)"></i><span class="m">${esc(d.other.msg)}</span><span class="n">${fmtN(d.openOnly?d.other.open:d.other.total)}</span></button>`:""}</div>
      <div class="fet-foot"><span><b>${fmtN(d.distinct)}</b> distinct messages · <b>${fmtN(d.openOnly?d.all.open:d.all.total)}</b> ${d.openOnly?"open":"errors"} in the period · ${d.bucket==="day"?"daily":"hourly"} points, KSA</span>
        <span>rollup refreshed ${esc(rel(d.coverage&&d.coverage.fresh_at))}${d.coverage&&d.coverage.from?` · history from ${esc(ksa(d.coverage.from,"day"))}`:""}${d.coverage&&d.coverage.error?` · <span class="warn">rollup error: ${esc(d.coverage.error)}</span>`:""}</span>
        ${d.note?`<span class="warn">${esc(d.note)}</span>`:""}</div>`;
    body.querySelectorAll(".fet-chip").forEach(b=>b.onclick=e=>{ const p=e.target.closest("[data-pick]"); if(p){ e.stopPropagation(); if(opts.onPick) opts.onPick(p.dataset.pick); return; }
      const k=b.dataset.k; if(k==="__other"){ T.other=!T.other; SAVE("fixed_trend_other",T.other?"1":"0"); const cb=el.querySelector("#fetOther"); if(cb) cb.checked=T.other; } else { if(T.hidden.has(k)) T.hidden.delete(k); else T.hidden.add(k); } paint(el,fx,d,opts); });
    /* hover: nearest tick → crosshair + every visible value at that time, biggest first */
    const svg=body.querySelector("svg"), hit=body.querySelector("#fetHit"), cross=body.querySelector("#fetCross"), tip=body.querySelector(".fet-tip"), wrap=body.querySelector(".fet-svgwrap");
    const show=ev=>{ const r=svg.getBoundingClientRect(); const sx=W/r.width; const px=(ev.clientX-r.left)*sx; let i=Math.round((px-ML)/iw*(ticks.length-1)); i=Math.max(0,Math.min(ticks.length-1,i));
      cross.setAttribute("x1",X(i).toFixed(1)); cross.setAttribute("x2",X(i).toFixed(1)); cross.setAttribute("opacity",".5");
      const rows=lines.map(s=>({label:s.msg,color:s.color,v:s.points[i]})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v).slice(0,12);
      if(other&&other.points[i]>0) rows.push({label:d.other.msg,color:"var(--muted)",v:other.points[i]});
      const tot=d.all?d.all.points[i]:rows.reduce((a,x)=>a+x.v,0); const end=d.bucket==="day"?"":" → "+new Date(new Date(ticks[i]).getTime()+3600e3).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Riyadh"});
      tip.innerHTML=`<b class="t">${esc(ksa(ticks[i],d.bucket))}${end} KSA · <span style="color:var(--muted);font-weight:600">${fmtN(tot)} ${d.openOnly?"open":"errors"}</span></b>${rows.length?rows.map(x=>`<div class="r"><i style="background:${x.color}"></i><span title="${esc(x.label)}">${esc(short(x.label,52))}</span><b>${fmtN(x.v)}</b></div>`).join(""):`<div class="r"><span style="color:var(--muted)">nothing at this time</span></div>`}`;
      tip.style.display="block"; const tw=tip.offsetWidth, ww=wrap.clientWidth; const lx=(ev.clientX-r.left); tip.style.left=(lx+tw+24>ww?Math.max(0,lx-tw-14):lx+14)+"px"; tip.style.top=Math.max(0,(ev.clientY-r.top)-10)+"px"; };
    hit.onmousemove=show; hit.onmouseleave=()=>{ tip.style.display="none"; cross.setAttribute("opacity","0"); };
    hit.ontouchstart=hit.ontouchmove=ev=>{ if(ev.touches&&ev.touches[0]) show(ev.touches[0]); };
  }

  window.fixedErrTrend={ render };
})();
