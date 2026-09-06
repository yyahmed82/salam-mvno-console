/* fixed-errors.js — Fixed › Errors: the Operations Console "Live error control board" (apps/web/src/app/errors/page.tsx)
 * reproduced on the unified console. Data: /api/fixed/errors/{summary,live,detail,resolve} (server/src/fixedErrors.js).
 * Window chips on this page (3h … 1 year) override the hub range. The board has its own channel select and starts on
 * ALL channels like /operations-console/errors (QR errors are epurchase — a hub chip on SDA would hide them); it follows
 * the hub chip only when the user changes it. Identifier searches apply live (debounced) or on Enter.
 * Identifiers arrive masked (last digits); "Unmask (audited)" only for caps.unmaskPII; "Ack" only for caps.ackErrors. */
(function(){
  "use strict";
  const FX=()=>window.FX;
  const WINDOWS=[["3h","Last 3h"],["6h","Last 6h"],["24h","Last 24h"],["today","Today"],["7d","Last 7d"],["30d","1 month"],["90d","3 months"],["365d","1 year"]];
  const TEAMS=["OSS","IDENTITY","BSS","CLIENT","PLATFORM"];
  const TEAM_COLOR={OSS:"#dc2626",IDENTITY:"#d97706",BSS:"#2563eb",CLIENT:"var(--muted)",PLATFORM:"var(--muted)"};
  const PRIO_COLOR=["#dc4c4c","#dc4c4c","#d29922","#7d8590","#7d8590"];
  const TONE={red:{bg:"rgba(220,76,76,.16)",fg:"#dc2626"},amber:{bg:"rgba(210,153,34,.16)",fg:"var(--warn-fg)"},muted:{bg:"rgba(125,133,144,.14)",fg:"var(--muted)"}};
  const ID_FIELDS=[["serviceNo","Service no. (FTTH… / 5G no.)"],["odb","ODB / plate no (ODB: prefix ok)"],["iccid","SIM ICCID"],["cpe","CPE serial"],["msisdn","MSISDN / mobile"],["custCode","Customer code (custCode)"],["customerId","Customer ID"],["workflowId","Workflow ID (wf_st_…)"]];
  const LS=k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const S={ win:LS("fixed_err_win")||"today", channel:"", hubSeen:undefined, openOnly:true, team:"", prio:"", category:"", tech:"all", find:"", ids:{}, expanded:null, timer:null, tick:0 };
  const caps=()=>{ try{ const s=window.opsSession&&window.opsSession(); return (s&&s.me&&s.me.caps)||{}; }catch(e){ return {}; } };
  const fmtT=v=>{ if(!v) return "—"; const d=new Date(v); return isNaN(d)?"—":d.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Riyadh"}); };
  const rel=v=>{ if(!v) return "never"; const ms=Date.now()-new Date(v).getTime(); if(ms<0) return "just now"; const m=Math.floor(ms/6e4); if(m<60) return m+"m ago"; const h=Math.floor(m/60); if(h<48) return h+"h ago"; return Math.floor(h/24)+" days ago"; };
  const pretty=v=>{ if(v==null||v==="") return null; if(typeof v==="string"){ try{ return JSON.stringify(JSON.parse(v),null,2); }catch(e){ return v; } } return JSON.stringify(v,null,2); };
  /* friendly request view (page.tsx renderReq): feasibility → plate only; GET → query lines; POST → body */
  function renderReq(v,step){ const esc=FX().esc; if(v==null) return null; let p=v; if(typeof v==="string"){ try{ p=JSON.parse(v); }catch(e){ return esc(v); } }
    if(!p||typeof p!=="object") return esc(pretty(p)); const url=typeof p.url==="string"?p.url:""; const hay=(step||"")+" "+url;
    if(/salamcheckplateno|feasib/i.test(hay)){ const m=url.match(/[?&]plateNumber=([^&]+)/i); if(m){ let x=m[1]; try{ x=decodeURIComponent(x); }catch(e){} return "plateNumber : "+esc(x); } }
    const body=p.body&&typeof p.body==="object"?p.body:null; const empty=!body||!Object.keys(body).length; const qi=url.indexOf("?");
    if(qi>=0&&empty){ const lines=[]; new URLSearchParams(url.slice(qi+1)).forEach((val,k)=>lines.push(esc(k)+" : "+esc(val))); if(lines.length) return lines.join("\n"); }
    if(!empty) return esc(JSON.stringify(body,null,2)); return esc(pretty(p)); }
  /* one class attribute only — a second class="" is ignored by the browser and the chip falls back to the grey default */
  const chip=(on,label,attrs)=>{ const m=attrs.match(/\s*class="([^"]*)"/); const rest=m?attrs.replace(m[0],""):attrs; return `<button type="button" class="fe-chip${on?" on":""}${m?" "+m[1]:""}" ${rest}>${label}</button>`; };
  const prioBadge=p=>`<span class="fe-pri" style="background:${PRIO_COLOR[p]||"#7d8590"}">P${p}</span>`;
  const catBadge=(r)=>{ const esc=FX().esc; const t=TONE[r.tone]||TONE.muted; return `<span class="fe-cat"><span class="fe-catpill" style="background:${t.bg};color:${t.fg}">${esc(r.label||r.category)}</span><span class="fe-team" style="color:${TEAM_COLOR[r.team]||"var(--muted)"}">${esc(r.team||"")}</span></span>`; };
  const inp=(id,ph,val,extra)=>`<input id="${id}" class="fe-in" placeholder="${FX().esc(ph)}" value="${FX().esc(val||"")}" autocomplete="off" spellcheck="false" style="${extra||""}">`;
  const STYLE=`
    #fxErr h1{margin:0 0 2px;font-size:20px;font-weight:800;letter-spacing:-.2px} #fxErr .fe-sub{font-size:12.5px;color:var(--muted);margin-bottom:14px}
    #fxErr .fe-cards{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px} @media (max-width:1000px){#fxErr .fe-cards{grid-template-columns:1fr}}
    #fxErr .fe-card{background:var(--card,#fff);border:1px solid var(--line);border-radius:14px;padding:18px 22px;box-shadow:0 1px 3px rgba(2,6,23,.05);display:flex;flex-direction:column;gap:14px}
    #fxErr .fe-chip{cursor:pointer;font:inherit;font-size:12px;font-weight:600;padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink);transition:background .14s,border-color .14s,color .14s,transform .14s,box-shadow .14s;white-space:nowrap}
    #fxErr .fe-chip:hover{border-color:var(--green,#0e9f5a);color:var(--green,#0e9f5a);transform:translateY(-1px);box-shadow:0 3px 10px rgba(2,6,23,.08)} #fxErr .fe-chip:active{transform:none}
    #fxErr .fe-chip.on{background:var(--green,#0e9f5a);border-color:var(--green,#0e9f5a);color:#fff;font-weight:700} #fxErr .fe-chip.on:hover{color:#fff}
    #fxErr .fe-chip.fe-team.on,#fxErr .fe-chip.fe-prio.on{box-shadow:0 3px 10px rgba(14,159,90,.3)}
    #fxErr .fe-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    #fxErr .fe-in,#fxErr select.fe-in{font:inherit;font-size:13px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card2,#f1f5f9);color:var(--ink);width:100%;box-sizing:border-box;transition:border-color .15s,box-shadow .15s,background .15s}
    #fxErr .fe-in:focus{outline:none;border-color:var(--green,#0e9f5a);background:var(--card,#fff);box-shadow:0 0 0 3px rgba(14,159,90,.15)}
    #fxErr .fe-in::placeholder{color:var(--muted)}
    #fxErr .fe-grid{display:grid;gap:10px} #fxErr .fe-grid.c4{grid-template-columns:repeat(4,1fr)} #fxErr .fe-grid.c2{grid-template-columns:1fr 1fr} @media (max-width:1300px){#fxErr .fe-grid.c4{grid-template-columns:1fr 1fr}}
    #fxErr .fe-row1{display:flex;gap:10px;align-items:center} #fxErr .fe-row1 .fe-in{flex:1}
    #fxErr .fe-foot{display:flex;align-items:center;gap:12px;margin-top:auto} #fxErr .fe-foot label{display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer}
    #fxErr .fe-foot input[type=checkbox]{accent-color:var(--green,#0e9f5a);width:15px;height:15px}
    #fxErr .fe-counts{margin-left:auto;font-size:12.5px;color:var(--muted)}
    #fxErr .fe-btn{cursor:pointer;font:inherit;font-size:12px;font-weight:600;padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink);transition:border-color .14s,color .14s,transform .14s} #fxErr .fe-btn:hover{border-color:var(--green,#0e9f5a);color:var(--green,#0e9f5a);transform:translateY(-1px)}
    #fxErr .fe-hint{font-size:11px;color:var(--muted)}
    #fxErr .fe-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin:14px 0 18px}
    #fxErr .fe-tile{text-align:left;padding:14px 16px;cursor:pointer;font:inherit;color:inherit;border:1px solid var(--line);border-radius:14px;background:var(--card,#fff);box-shadow:0 1px 3px rgba(2,6,23,.05);transition:transform .15s,box-shadow .15s,border-color .15s}
    #fxErr .fe-tile:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(2,6,23,.10);border-color:var(--green,#0e9f5a)} #fxErr .fe-tile.on{border-color:var(--green,#0e9f5a);box-shadow:0 0 0 3px rgba(14,159,90,.15)}
    #fxErr .fe-tile .lbl{font-size:13px;font-weight:700;line-height:1.25} #fxErr .fe-tile .big{font-size:26px;font-weight:800;line-height:1}
    #fxErr .fe-pri{display:inline-block;padding:1px 8px;border-radius:7px;font-size:10.5px;font-weight:800;color:#fff;line-height:1.5}
    #fxErr .fe-cat{display:inline-flex;align-items:center;gap:8px;white-space:nowrap} #fxErr .fe-catpill{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700} #fxErr .fe-team{font-size:11px;font-weight:800;letter-spacing:.3px}
    #fxErr .fe-tablecard{background:var(--card,#fff);border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 3px rgba(2,6,23,.05);overflow:hidden}
    #fxErr table.fe-tbl{width:100%;border-collapse:collapse;font-size:13px} #fxErr .fe-tbl th{text-align:left;padding:12px 16px;color:var(--muted);font-weight:700;font-size:11px;letter-spacing:.6px;text-transform:uppercase;border-bottom:1px solid var(--line)}
    #fxErr .fe-tbl td{padding:10px 16px;border-bottom:1px solid var(--line-soft,var(--line));vertical-align:middle} #fxErr tr.fe-row{cursor:pointer;transition:background .12s} #fxErr tr.fe-row:hover td{background:var(--card2,#f8fafc)}
    #fxErr tr.fe-row td:first-child{box-shadow:inset 3px 0 0 transparent;transition:box-shadow .12s} #fxErr tr.fe-row:hover td:first-child,#fxErr tr.fe-row.open td:first-child{box-shadow:inset 3px 0 0 var(--green,#0e9f5a)}
    #fxErr tr.fe-row.open td{background:var(--card2,#f8fafc)} #fxErr tr.fe-row:focus-visible{outline:2px solid var(--green,#0e9f5a);outline-offset:-2px}
    #fxErr .fe-caret{display:inline-block;color:var(--muted);font-size:12px;margin-left:8px;transition:transform .15s,color .15s} #fxErr tr.fe-row:hover .fe-caret{color:var(--green,#0e9f5a)} #fxErr tr.fe-row.open .fe-caret{transform:rotate(90deg);color:var(--green,#0e9f5a)}
    #fxErr .fe-link{color:var(--green,#0e9f5a);font-weight:700;text-decoration:underline;text-underline-offset:3px} #fxErr .fe-link small{font-size:10px;color:var(--muted);font-weight:600}
    #fxErr .fe-st{font-size:12px;font-weight:700} #fxErr .fe-st.open{color:var(--warn-fg)} #fxErr .fe-st.acked{color:#2563eb} #fxErr .fe-st.resolved{color:var(--green,#0e9f5a)}
    #fxErr .fe-x td{padding:14px 16px 18px;background:var(--card,#fff)}
    #fxErr .fe-xgrid{display:grid;gap:12px;font-size:13px} #fxErr .fe-what{font-size:13px} #fxErr .fe-what .k{color:var(--muted)}
    #fxErr .fe-io{display:grid;gap:12px;grid-template-columns:1fr 1fr} @media (max-width:900px){#fxErr .fe-io{grid-template-columns:1fr}}
    #fxErr .fe-io h5{margin:0 0 6px;font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px}
    #fxErr .fe-io pre{margin:0;max-height:240px;overflow:auto;background:var(--card2,#f8fafc);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
    #fxErr .fe-pii{font-size:10.5px;font-weight:800;padding:1px 8px;border-radius:999px;border:1px solid #b7791f;color:var(--warn-fg);background:rgba(217,119,6,.08)}
    #fxErr .fe-sim{border:1px solid var(--line);border-radius:12px;padding:12px 16px;background:var(--card2,#f8fafc)} #fxErr .fe-sim b.t{display:block;font-size:13px;margin-bottom:6px} #fxErr .fe-sim .f{display:flex;flex-wrap:wrap;gap:18px;font-size:12.5px} #fxErr .fe-sim .f span span{color:var(--muted)}
    #fxErr .fe-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    #fxErr .fe-empty{padding:16px;color:var(--muted);font-size:13px}
  `;
  function qs(){ const ch=S.channel||"";
    let q=`range=${encodeURIComponent(S.win)}${ch?`&channel=${encodeURIComponent(ch)}`:""}${S.openOnly?"&openOnly=1":""}${S.tech!=="all"?`&tech=${S.tech}`:""}`;
    if(S.find) q+=`&find=${encodeURIComponent(S.find)}`; for(const [k] of ID_FIELDS) if(S.ids[k]) q+=`&${k}=${encodeURIComponent(S.ids[k])}`; return q; }

  async function render(host,fx){
    const esc=fx.esc;
    if(S.timer){ clearInterval(S.timer); S.timer=null; }
    if(S.hubSeen===undefined) S.hubSeen=fx.state.channel||"";                      // first paint: board starts on All channels (prod default)
    else if((fx.state.channel||"")!==S.hubSeen){ S.hubSeen=fx.state.channel||""; S.channel=S.hubSeen; }   // hub chip changed by the user → follow it
    const ch=S.channel||"";
    host.innerHTML=`<div id="fxErr"><style>${STYLE}</style>
      <h1>Live error control board</h1>
      <div class="fe-sub">SDA &amp; QR journey errors as they happen — filter by team / category / priority and time window; open a row to see the failed step, the request / response and how often it has happened before.</div>
      <div class="fe-cards">
        <div class="fe-card">
          <div class="fe-chips">${WINDOWS.map(([k,l])=>chip(S.win===k,l,`class="fe-win" data-w="${k}"`)).join("")}</div>
          <select id="feCh" class="fe-in">
            <option value="" ${ch===""?"selected":""}>All channels</option><option value="sda" ${ch==="sda"?"selected":""}>SDA (dealer)</option><option value="epurchase" ${ch==="epurchase"?"selected":""}>QR / e-purchase</option><option value="salamhome" ${ch==="salamhome"?"selected":""}>Salam Home app</option></select>
          <div class="fe-foot"><label><input id="feOpen" type="checkbox" ${S.openOnly?"checked":""}> Open only</label><span id="feCounts" class="fe-counts"></span><button id="feClear" class="fe-btn">Clear</button></div>
        </div>
        <div class="fe-card">
          ${inp("feFind","Search any ID — ODB · service · ICCID · MSISDN · order · customer · workflow…",S.find)}
          <div class="fe-row1">${inp("feId-serviceNo",ID_FIELDS[0][1]+"…",S.ids.serviceNo)}<div class="fe-chips">${[["all","All"],["fttx","FTTX"],["5g","5G"]].map(([k,l])=>chip(S.tech===k,l,`class="fe-tech" data-t="${k}"`)).join("")}</div></div>
          ${inp("feId-odb","ODB / plate no (with or without ODB: prefix)…",S.ids.odb)}
          <div class="fe-grid c4">${inp("feId-iccid","SIM ICCID…",S.ids.iccid)}${inp("feId-cpe","CPE serial…",S.ids.cpe)}${inp("feId-msisdn","MSISDN / mobile…",S.ids.msisdn)}${inp("feId-custCode","Customer code (custCode)…",S.ids.custCode)}</div>
          <div class="fe-grid c2">${inp("feId-customerId","Customer ID…",S.ids.customerId)}${inp("feId-workflowId","Workflow ID (wf_st_…)…",S.ids.workflowId)}</div>
          <div class="fe-hint">searches apply as you type (Enter to apply now) · identifiers are shown as last digits only · full values via Unmask (audited)</div>
        </div>
      </div>
      <div id="feTeams" class="fe-chips" style="margin-bottom:8px"></div>
      <div id="fePrio" class="fe-chips" style="margin-bottom:4px"></div>
      <div id="feTiles" class="fe-tiles"><div class="fe-tile" style="cursor:default;color:var(--muted)">${window.salamLoader?window.salamLoader("Reading error events…"):"Loading…"}</div></div>
      <div class="fe-tablecard"><div id="feRows"></div><div id="feMore" style="padding:10px;text-align:center"></div></div>
      <div id="feStamp" class="rl" style="font-size:11px;color:var(--muted);margin-top:8px"></div></div>`;
    host.querySelectorAll(".fe-win").forEach(b=>b.onclick=()=>{ S.win=b.dataset.w; try{ localStorage.setItem("fixed_err_win",S.win); }catch(e){} render(host,fx); });
    host.querySelectorAll(".fe-tech").forEach(b=>b.onclick=()=>{ S.tech=b.dataset.t; render(host,fx); });
    host.querySelector("#feCh").onchange=e=>{ S.channel=e.target.value; render(host,fx); };
    host.querySelector("#feOpen").onchange=e=>{ S.openOnly=e.target.checked; render(host,fx); };
    const read=()=>{ S.find=host.querySelector("#feFind").value.trim(); for(const [k] of ID_FIELDS) S.ids[k]=host.querySelector("#feId-"+k).value.trim(); };
    let deb=null; const go=()=>{ clearTimeout(deb); read(); S.category=""; load(host,fx,true); };
    host.querySelectorAll("input[id^=feId-],#feFind").forEach(i=>{ i.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); go(); } }; i.oninput=()=>{ clearTimeout(deb); deb=setTimeout(go,450); }; });
    host.querySelector("#feClear").onclick=()=>{ Object.assign(S,{channel:"",openOnly:true,team:"",prio:"",category:"",tech:"all",find:"",ids:{},expanded:null}); render(host,fx); };
    host.querySelector("#feFind").focus();
    await load(host,fx,true);
    S.timer=setInterval(()=>{ if(!host.isConnected||!document.body.contains(host)){ clearInterval(S.timer); S.timer=null; return; }
      if(document.visibilityState!=="visible") return; load(host,fx,true); },60000);
  }

  async function load(host,fx,first){
    const esc=fx.esc, fmt=fx.fmt; const my=++S.tick;
    try{
      const sum=await fx.api("/api/fixed/errors/summary?"+qs());
      if(my!==S.tick||!host.isConnected) return;
      // a category tile selected earlier may not exist under the new window / search — drop it instead of filtering invisibly
      if(S.category&&!sum.byCategory.some(c=>c.category===S.category)) S.category="";
      let lq=qs(); if(S.team) lq+=`&team=${S.team}`; if(S.prio!=="") lq+=`&priority=${S.prio}`; if(S.category) lq+=`&category=${encodeURIComponent(S.category)}`;
      const live=await fx.api("/api/fixed/errors/live?"+lq+"&limit=100");
      if(my!==S.tick||!host.isConnected) return;
      const $=s=>host.querySelector(s);
      const catOn=S.category?sum.byCategory.find(c=>c.category===S.category):null;
      $("#feCounts").innerHTML=`${fmt(sum.open)} open · ${fmt(sum.total)} total`+(catOn?` <button type="button" class="fe-chip on" id="feCatOff" title="Remove the category filter" style="margin-left:8px">category: ${esc(catOn.label)} ✕</button>`:"");
      const co=$("#feCatOff"); if(co) co.onclick=()=>{ S.category=""; load(host,fx,true); };
      $("#feTeams").innerHTML=chip(S.team==="","All teams",`class="fe-team" data-t=""`)+TEAMS.map(t=>chip(S.team===t,`${t} · ${fmt(S.openOnly?sum.byTeam[t].open:sum.byTeam[t].total)}`,`class="fe-team" data-t="${t}"`)).join("");
      $("#fePrio").innerHTML=`<span style="font-size:12px;color:var(--muted);margin-right:2px">Priority:</span>`+chip(S.prio==="","All",`class="fe-prio" data-p=""`)+[0,1,2,3,4].map(p=>chip(S.prio===String(p),`P${p} · ${fmt(S.openOnly?sum.byPriority[p].open:sum.byPriority[p].total)}`,`class="fe-prio" data-p="${p}"`)).join("");
      host.querySelectorAll(".fe-team").forEach(b=>b.onclick=()=>{ S.team=(S.team===b.dataset.t)?"":b.dataset.t; load(host,fx,true); });
      host.querySelectorAll(".fe-prio").forEach(b=>b.onclick=()=>{ S.prio=(S.prio===b.dataset.p)?"":b.dataset.p; load(host,fx,true); });
      const tiles=sum.byCategory.filter(c=>(!S.team||c.team===S.team)&&(S.prio===""||String(c.priority)===S.prio));
      $("#feTiles").innerHTML=tiles.length?tiles.map(c=>{ const on=S.category===c.category; const t=TONE[c.tone]||TONE.muted;
        return `<button class="fe-tile${on?" on":""}" data-c="${esc(c.category)}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><span class="lbl">${esc(c.label)}</span><span style="display:flex;align-items:center;gap:8px;flex:none;padding-top:2px">${prioBadge(c.priority)}<span class="fe-team" style="color:${TEAM_COLOR[c.team]||"var(--muted)"}">${esc(c.team)}</span></span></div>
          <div style="display:flex;align-items:baseline;gap:10px;margin-top:10px"><span class="big" style="color:${t.fg}">${fmt(S.openOnly?c.open:c.total)}</span><span style="font-size:12px;color:var(--muted)">${S.openOnly?`${fmt(c.total)} total · ${fmt(c.last3h)} in 3h`:`${fmt(c.open)} open · ${fmt(c.last3h)} in 3h`}</span></div></button>`; }).join("")
        :`<div class="fe-tile" style="cursor:default;color:var(--muted)">No errors in this window.</div>`;
      host.querySelectorAll(".fe-tile").forEach(b=>b.onclick=()=>{ S.category=(S.category===b.dataset.c)?"":b.dataset.c; load(host,fx,true); });
      drawRows(host,fx,live.rows,first);
      $("#feMore").innerHTML=live.nextCursor?`<button id="feMoreBtn" class="btn" style="font-size:11px;padding:5px 12px">Load more</button>`:"";
      const mb=$("#feMoreBtn"); if(mb) mb.onclick=async()=>{ mb.disabled=true; try{ const more=await fx.api("/api/fixed/errors/live?"+lq+"&limit=100&cursor="+encodeURIComponent(live.nextCursor)); live.rows=live.rows.concat(more.rows); live.nextCursor=more.nextCursor; drawRows(host,fx,live.rows,true); $("#feMore").innerHTML=more.nextCursor?`<span class="rl" style="color:var(--muted);font-size:11px">more available — narrow the window</span>`:""; }catch(e){ mb.disabled=false; } };
      $("#feStamp").textContent=`window ${fx.ts(sum.from)} → ${fx.ts(sum.to)} KSA · consumer-direct e-purchase excluded · refreshed ${fx.ts(new Date().toISOString(),true)} · auto-refresh 60 s`;
    }catch(e){ if(my!==S.tick) return; const t=host.querySelector("#feTiles"); if(t) t.innerHTML=`<div class="albanner" style="grid-column:1/-1;border-left:4px solid #dc2626;padding:12px 14px"><b>Error board unavailable</b> — ${esc(e.message)}</div>`; }
  }

  function drawRows(host,fx,rows,keepExpanded){
    const esc=fx.esc; const el=host.querySelector("#feRows"); if(!el) return;
    const dealer=r=>{ if(r.channel==="epurchase"&&r.referral_code) return `<a class="fe-link" href="#fixed?tab=qr&ref=${encodeURIComponent(r.referral_code)}">${esc(r.referral_code)} <small>QR ↗</small></a>`;
      if(r.dealer_code) return `<a class="fe-link" href="#fixed?tab=map&dealer=${encodeURIComponent(r.dealer_id||r.dealer_code)}">${esc(r.dealer_code)} <small>↗</small></a>`;
      return `<span style="color:var(--muted)" title="No dealer/staff captured for this journey">unattributed</span>`; };
    const status=r=>r.resolved?`<span class="fe-st resolved">resolved</span>`:r.acked?`<span class="fe-st acked" title="acked by ${esc(r.acked_by||"")}">acked</span>`:`<span class="fe-st open">open</span>`;
    el.innerHTML=`<table class="fe-tbl"><thead><tr>${["PRI","TIME","CATEGORY","DEALER / QR","REGION","STATUS"].map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr class="fe-row${S.expanded===r.id?" open":""}" data-id="${esc(r.id)}" tabindex="0" title="Open: failed step, request / response, similar cases">
        <td>${prioBadge(r.priority)}</td><td style="white-space:nowrap">${fmtT(r.occurred_at)}</td>
        <td>${catBadge(r)}${r.code?`<span class="rl" style="font-size:10.5px;color:var(--muted);margin-left:8px">${esc(r.code)}</span>`:""}</td>
        <td class="fe-nostop">${dealer(r)}</td><td>${esc(r.region||"—")}</td><td style="white-space:nowrap">${status(r)}<span class="fe-caret" aria-hidden="true">›</span></td></tr><tr class="fe-x" data-id="${esc(r.id)}" hidden><td colspan="6"></td></tr>`).join("")
      :`<tr><td colspan="6" class="fe-empty">No errors match these filters${S.category?` (category <b>${esc(S.category)}</b> is selected — click the tile again or the ✕ chip to remove it)`:S.team||S.prio!==""?` (team / priority filter active)`:""}.</td></tr>`}</tbody></table>`;
    el.querySelectorAll(".fe-row").forEach(tr=>tr.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); tr.click(); } });
    el.querySelectorAll(".fe-row").forEach(tr=>tr.onclick=e=>{ if(e.target.closest("a")) return; e.preventDefault();
      const id=tr.dataset.id; const x=el.querySelector(`.fe-x[data-id="${id.replace(/[^\w-]/g,"")}"]`); if(!x) return;
      const isOpen=!x.hidden;                                   // truth = the DOM, never a remembered id
      el.querySelectorAll(".fe-x").forEach(o=>o.hidden=true); el.querySelectorAll(".fe-row.open").forEach(o=>o.classList.remove("open"));
      if(isOpen){ S.expanded=null; return; }
      S.expanded=id; x.hidden=false; tr.classList.add("open"); expand(host,fx,x.firstElementChild,rows.find(r=>r.id===id)); });
    if(keepExpanded&&S.expanded){ const x=el.querySelector(`.fe-x[data-id="${String(S.expanded).replace(/[^\w-]/g,"")}"]`); const r=rows.find(r=>r.id===S.expanded); if(x&&r){ x.hidden=false; expand(host,fx,x.firstElementChild,r); } }
  }

  async function expand(host,fx,cell,row){
    const esc=fx.esc, fmt=fx.fmt; const c=caps();
    cell.innerHTML=`<span style="color:var(--muted);font-size:12px">loading…</span>`;
    let d; try{ d=await fx.api("/api/fixed/errors/detail?id="+encodeURIComponent(row.id)); }catch(e){ cell.innerHTML=`<span style="color:#dc2626;font-size:12px">${esc(e.message)}</span>`; return; }
    if(!cell.isConnected) return;
    const pre=(html)=>`<pre>${html==null?"—":html}</pre>`;
    const draw=(req,res,unmasked,extra)=>`<div class="fe-io"><div><h5>Request ${unmasked?`<span class="fe-pii" title="Raw customer data fetched live from nexus — this view is recorded in the audit log">⚠ PII UNMASKED — audited</span>`:""}</h5>${pre(renderReq(req,row.step))}</div>
      <div><h5>Response</h5>${pre(res==null?null:esc(pretty(res)))}</div></div>${extra||""}`;
    const sim=d.similar||{};
    const tl=(d.timeline||[]);
    cell.innerHTML=`<div class="fe-xgrid">
      <div class="fe-what"><span class="k">What happened: </span><b style="font-weight:600">${esc(d.event.message||d.event.label)}</b>${d.event.step?` <span class="k">· step ${esc(d.event.step)}</span>`:""}
        <span class="rl" style="color:var(--muted);font-size:11px;margin-left:10px">${esc(d.event.label)} · ${esc(d.event.team)} · base P${d.event.basePriority}${d.event.order_number?` · order ${esc(d.event.order_number)}`:""}${d.event.acct_masked?` · acct ${esc(d.event.acct_masked)}`:""}${d.event.cust_masked?` · cust …${esc(d.event.cust_masked)}`:""}${d.event.dealer_name?` · ${esc(d.event.dealer_name)}`:""}</span></div>
      <div id="feBodies">${(d.request!=null||d.response!=null)?draw(d.request,d.response,false):`<div style="color:var(--muted);font-size:12px">No captured request/response for this error (older event — re-ingest or backfill to populate).</div>`}</div>
      <div class="fe-sim"><b class="t">Similar cases <span class="rl" style="font-weight:400;color:var(--muted);font-size:10.5px">signature ${esc(d.event.signature||d.event.category)}</span></b>
        <div class="f"><span><b>${fmt(sim.d30)}</b> in 30d <span>(${fmt(sim.d7)} in 7d · ${fmt(sim.all)} ever)</span></span><span>last seen <b>${esc(rel(sim.lastSeen))}</b></span><span>affected today <b>${fmt(sim.affectedToday)}</b></span><span>median resolve <b>${sim.medianResolveMins!=null?sim.medianResolveMins+"m":"—"}</b></span>${sim.biggestDay?`<span>biggest day <b>${esc(sim.biggestDay.day)}</b> (${fmt(sim.biggestDay.count)})</span>`:""}</div></div>
      <div class="fe-actions">
        ${d.event.attempt_id?`<button id="feTrace" class="fe-btn">Open full trace → <span style="color:var(--muted);font-weight:500">(${tl.length} calls)</span></button>`:""}
        ${c.unmaskPII&&d.event.attempt_id?`<button id="feUnmask" class="fe-btn" style="border-color:#b7791f;color:var(--warn-fg)" ${d.unmaskAvailable?"":"disabled title='NEXUS_DATABASE_URL not configured'"}>🔓 Unmask (audited)</button>`:""}
        ${c.ackErrors&&!d.event.resolved?`<button id="feAck" class="fe-btn">${d.event.acked?"Un-ack":"Ack"}</button>`:""}
        ${d.event.acked?`<span class="rl" style="font-size:10.5px;color:var(--muted)">acked by ${esc(d.event.acked_by||"")}</span>`:""}
        <span class="rl" style="font-size:10.5px;color:var(--muted);margin-left:auto">attempt <span class="mono">${esc(d.event.attempt_id||"—")}</span> · event <span class="mono">${esc(d.event.id)}</span></span></div>
      <div id="feTl" hidden></div></div>`;
    const $=s=>cell.querySelector(s);
    const tb=$("#feTrace"); if(tb) tb.onclick=()=>{ const t=$("#feTl"); t.hidden=!t.hidden; if(!t.innerHTML) t.innerHTML=fx.tbl(["TIME KSA","METHOD","ENDPOINT","STATUS","MS","ERROR","INFO"],tl.map(x=>[fmtT(x.created_at),esc(x.method||""),`<span class="mono">${esc(x.endpoint)}</span>`,`<b style="color:${x.status>=400?"#dc2626":x.status>=200?"var(--green,#0e9f5a)":"inherit"}">${esc(x.status==null?"—":x.status)}</b>`,esc(x.duration_ms==null?"—":x.duration_ms),esc(x.error_class||x.error_msg||""),esc(x.info||"")])); };
    const ub=$("#feUnmask"); if(ub) ub.onclick=async()=>{ if(!confirm("Fetch the RAW (unmasked) request/response for this failing step from nexus? This access is written to the audit log.")) return; ub.disabled=true; ub.textContent="fetching…";
      try{ const u=await fx.api("/api/fixed/errors/detail?unmask=1&id="+encodeURIComponent(row.id)); const um=u.unmask||{};
        if(!um.unmaskAvailable){ ub.textContent="Unmask unavailable"; ub.title=um.error||"nexus not configured"; return; }
        if(!um.matched){ ub.textContent="no raw call matched"; return; }
        $("#feBodies").innerHTML=draw(um.request,um.response,true,`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:6px">raw endpoint <span class="mono">${esc(um.endpoint||"")}</span> · ${fmtT(um.at)} · ${fmt(um.calls)} api_logs rows${um.context?` · <a href="#" id="feCtx">workflow context</a>`:""}</div>${um.context?`<pre id="feCtxPre" hidden style="margin-top:6px;max-height:260px;overflow:auto;background:var(--card2,#f8fafc);border:1px solid #b7791f;border-radius:10px;padding:12px;font-size:12px;white-space:pre-wrap;word-break:break-word">${esc(pretty(um.context))}</pre>`:""}`);
        const cx=$("#feCtx"); if(cx) cx.onclick=e=>{ e.preventDefault(); const p=$("#feCtxPre"); p.hidden=!p.hidden; };
        ub.textContent="unmasked"; }catch(e){ ub.disabled=false; ub.textContent="Unmask failed: "+e.message; } };
    const ab=$("#feAck"); if(ab) ab.onclick=async()=>{ ab.disabled=true; try{ const undo=!!d.event.acked;
        const r=await fetch((window.API_BASE||window.CONSOLE_BASE||"")+"/api/fixed/errors/resolve",{method:"POST",headers:{"Content-Type":"application/json","X-Console-Role":localStorage.getItem("cons_role")||"report_manager","X-Console-User":localStorage.getItem("cons_email")||""},body:JSON.stringify({id:row.id,undo})});
        const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); load(host,fx,true); }catch(e){ ab.disabled=false; ab.textContent="Ack failed: "+e.message; } };
  }

  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.errors={ label:"Errors", sub:"error control board", render };
})();
