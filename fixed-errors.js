/* fixed-errors.js — Fixed › Errors: the Operations Console "Live error control board" (apps/web/src/app/errors/page.tsx)
 * reproduced on the unified console. Data: /api/fixed/errors/{summary,live,detail,resolve} (server/src/fixedErrors.js).
 * Window chips on this page (3h … 1 year) override the hub range; channel select seeds from the hub channel.
 * Identifiers arrive masked (last digits); "Unmask (audited)" only for caps.unmaskPII; "Ack" only for caps.ackErrors. */
(function(){
  "use strict";
  const FX=()=>window.FX;
  const WINDOWS=[["3h","Last 3h"],["6h","Last 6h"],["24h","Last 24h"],["today","Today"],["7d","Last 7d"],["30d","1 month"],["90d","3 months"],["365d","1 year"]];
  const TEAMS=["OSS","IDENTITY","BSS","CLIENT","PLATFORM"];
  const TEAM_COLOR={OSS:"#dc2626",IDENTITY:"#d97706",BSS:"#2563eb",CLIENT:"var(--muted)",PLATFORM:"var(--muted)"};
  const PRIO_COLOR=["#dc4c4c","#dc4c4c","#d29922","#7d8590","#7d8590"];
  const TONE={red:{bg:"rgba(220,76,76,.16)",fg:"#dc2626"},amber:{bg:"rgba(210,153,34,.16)",fg:"#b45309"},muted:{bg:"rgba(125,133,144,.14)",fg:"var(--muted)"}};
  const ID_FIELDS=[["serviceNo","Service no. (FTTH… / 5G no.)"],["odb","ODB / plate no (ODB: prefix ok)"],["iccid","SIM ICCID"],["cpe","CPE serial"],["msisdn","MSISDN / mobile"],["custCode","Customer code (custCode)"],["customerId","Customer ID"],["workflowId","Workflow ID (wf_st_…)"]];
  const LS=k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const S={ win:LS("fixed_err_win")||"today", channel:null, openOnly:true, team:"", prio:"", category:"", tech:"all", find:"", ids:{}, expanded:null, timer:null, tick:0 };
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
  const chip=(on,label,attrs)=>`<button ${attrs} style="cursor:pointer;font:inherit;font-size:11.5px;font-weight:${on?"800":"600"};padding:5px 11px;border:1px solid ${on?"var(--green,#0e9f5a)":"var(--line)"};border-radius:999px;background:${on?"var(--green,#0e9f5a)":"var(--card,#fff)"};color:${on?"#fff":"inherit"}">${label}</button>`;
  const prioBadge=p=>`<span style="display:inline-block;padding:1px 7px;border-radius:6px;font-size:10px;font-weight:800;color:#fff;background:${PRIO_COLOR[p]||"#7d8590"}">P${p}</span>`;
  const catBadge=(r)=>{ const esc=FX().esc; const t=TONE[r.tone]||TONE.muted; return `<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap"><span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${t.bg};color:${t.fg};border:1px solid var(--line)">${esc(r.label||r.category)}</span><span style="font-size:10px;font-weight:700;color:${TEAM_COLOR[r.team]||"var(--muted)"}">${esc(r.team||"")}</span></span>`; };
  const inp=(id,ph,val,extra)=>`<input id="${id}" placeholder="${FX().esc(ph)}" value="${FX().esc(val||"")}" autocomplete="off" style="font:inherit;font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit;${extra||"min-width:150px"}">`;

  function qs(){ const fx=FX(); const ch=S.channel==null?(fx.state.channel||""):S.channel;
    let q=`range=${encodeURIComponent(S.win)}${ch?`&channel=${encodeURIComponent(ch)}`:""}${S.openOnly?"&openOnly=1":""}${S.tech!=="all"?`&tech=${S.tech}`:""}`;
    if(S.find) q+=`&find=${encodeURIComponent(S.find)}`; for(const [k] of ID_FIELDS) if(S.ids[k]) q+=`&${k}=${encodeURIComponent(S.ids[k])}`; return q; }

  async function render(host,fx){
    const esc=fx.esc;
    if(S.timer){ clearInterval(S.timer); S.timer=null; }
    const ch=S.channel==null?(fx.state.channel||""):S.channel;
    host.innerHTML=`<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px"><h3 style="margin:0;font-size:15px">Live error control board</h3>
        <span class="rl" style="font-size:11px;color:var(--muted)">SDA &amp; QR journey errors as they happen — filter by team / category / priority and time window; open a row to see the failed step, the request / response and how often it has happened before.</span></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:stretch;margin-bottom:10px">
        <div class="topo-card" style="flex:1 1 380px;padding:10px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <div style="display:flex;gap:4px;flex-wrap:wrap">${WINDOWS.map(([k,l])=>chip(S.win===k,l,`class="fe-win" data-w="${k}"`)).join("")}</div>
          <select id="feCh" style="font:inherit;font-size:12px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
            <option value="" ${ch===""?"selected":""}>All channels</option><option value="sda" ${ch==="sda"?"selected":""}>SDA (dealer)</option><option value="epurchase" ${ch==="epurchase"?"selected":""}>QR / e-purchase</option><option value="salamhome" ${ch==="salamhome"?"selected":""}>Salam Home app</option></select>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input id="feOpen" type="checkbox" ${S.openOnly?"checked":""}> Open only</label>
          <span id="feCounts" class="rl" style="margin-left:auto;font-size:12px;color:var(--muted)"></span>
          <button id="feClear" class="btn" style="font-size:11px;padding:5px 11px">Clear</button>
        </div>
        <div class="topo-card" style="flex:1 1 380px;padding:10px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          ${inp("feFind","🔍 Search any ID — ODB · service · ICCID · MSISDN · order · customer · workflow…",S.find,"flex:1 1 100%;min-width:240px")}
          ${inp("feId-serviceNo",ID_FIELDS[0][1],S.ids.serviceNo,"flex:1 1 180px;min-width:150px")}
          <div style="display:flex;gap:4px">${[["all","All"],["fttx","FTTX"],["5g","5G"]].map(([k,l])=>chip(S.tech===k,l,`class="fe-tech" data-t="${k}"`)).join("")}</div>
          ${ID_FIELDS.slice(1).map(([k,l])=>inp("feId-"+k,l,S.ids[k],"flex:1 1 150px;min-width:130px")).join("")}
          <button id="feGo" class="btn" style="font-size:11.5px;padding:6px 13px">Find</button>
          <span class="rl" style="font-size:10.5px;color:var(--muted)">identifiers are shown as last digits only · full values via Unmask (audited)</span>
        </div>
      </div>
      <div id="feTeams" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"></div>
      <div id="fePrio" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px"></div>
      <div id="feTiles" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:16px"><div class="topo-card" style="padding:14px;color:var(--muted)">${window.salamLoader?window.salamLoader("Reading error events…"):"Loading…"}</div></div>
      <div class="topo-card" style="padding:0;overflow:auto"><div id="feRows"></div><div id="feMore" style="padding:10px;text-align:center"></div></div>
      <div id="feStamp" class="rl" style="font-size:10.5px;color:var(--muted);margin-top:6px"></div>`;
    host.querySelectorAll(".fe-win").forEach(b=>b.onclick=()=>{ S.win=b.dataset.w; try{ localStorage.setItem("fixed_err_win",S.win); }catch(e){} render(host,fx); });
    host.querySelectorAll(".fe-tech").forEach(b=>b.onclick=()=>{ S.tech=b.dataset.t; render(host,fx); });
    host.querySelector("#feCh").onchange=e=>{ S.channel=e.target.value; render(host,fx); };
    host.querySelector("#feOpen").onchange=e=>{ S.openOnly=e.target.checked; render(host,fx); };
    const go=()=>{ S.find=host.querySelector("#feFind").value.trim(); for(const [k] of ID_FIELDS) S.ids[k]=host.querySelector("#feId-"+k).value.trim(); render(host,fx); };
    host.querySelector("#feGo").onclick=go; host.querySelectorAll("input[id^=feId-],#feFind").forEach(i=>i.onkeydown=e=>{ if(e.key==="Enter") go(); });
    host.querySelector("#feClear").onclick=()=>{ Object.assign(S,{channel:"",openOnly:true,team:"",prio:"",category:"",tech:"all",find:"",ids:{},expanded:null}); render(host,fx); };
    await load(host,fx,true);
    S.timer=setInterval(()=>{ if(!host.isConnected||!document.body.contains(host)){ clearInterval(S.timer); S.timer=null; return; }
      if(document.visibilityState!=="visible") return; load(host,fx,false); },60000);
  }

  async function load(host,fx,first){
    const esc=fx.esc, fmt=fx.fmt; const my=++S.tick;
    try{
      let lq=qs(); if(S.team) lq+=`&team=${S.team}`; if(S.prio!=="") lq+=`&priority=${S.prio}`; if(S.category) lq+=`&category=${encodeURIComponent(S.category)}`;
      const [sum,live]=await Promise.all([fx.api("/api/fixed/errors/summary?"+qs()), fx.api("/api/fixed/errors/live?"+lq+"&limit=100")]);
      if(my!==S.tick||!host.isConnected) return;
      const $=s=>host.querySelector(s);
      $("#feCounts").textContent=`${fmt(sum.open)} open · ${fmt(sum.total)} total`;
      $("#feTeams").innerHTML=chip(S.team==="","All teams",`class="fe-team" data-t=""`)+TEAMS.map(t=>chip(S.team===t,`${t} · ${fmt(S.openOnly?sum.byTeam[t].open:sum.byTeam[t].total)}`,`class="fe-team" data-t="${t}"`)).join("");
      $("#fePrio").innerHTML=`<span class="rl" style="font-size:11px;color:var(--muted)">Priority:</span>`+chip(S.prio==="","All",`class="fe-prio" data-p=""`)+[0,1,2,3,4].map(p=>chip(S.prio===String(p),`P${p} · ${fmt(S.openOnly?sum.byPriority[p].open:sum.byPriority[p].total)}`,`class="fe-prio" data-p="${p}"`)).join("");
      host.querySelectorAll(".fe-team").forEach(b=>b.onclick=()=>{ S.team=(S.team===b.dataset.t)?"":b.dataset.t; load(host,fx,true); });
      host.querySelectorAll(".fe-prio").forEach(b=>b.onclick=()=>{ S.prio=(S.prio===b.dataset.p)?"":b.dataset.p; load(host,fx,true); });
      const tiles=sum.byCategory.filter(c=>(!S.team||c.team===S.team)&&(S.prio===""||String(c.priority)===S.prio));
      $("#feTiles").innerHTML=tiles.length?tiles.map(c=>{ const on=S.category===c.category; const t=TONE[c.tone]||TONE.muted;
        return `<button class="topo-card fe-tile" data-c="${esc(c.category)}" style="text-align:left;padding:12px 14px;cursor:pointer;font:inherit;color:inherit;border:1px solid ${on?"var(--green,#0e9f5a)":"var(--line)"};background:var(--card,#fff)">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:12px;font-weight:600">${esc(c.label)}</span><span style="display:flex;align-items:center;gap:6px">${prioBadge(c.priority)}<span style="font-size:10px;font-weight:700;color:${TEAM_COLOR[c.team]||"var(--muted)"}">${esc(c.team)}</span></span></div>
          <div style="display:flex;align-items:baseline;gap:8px;margin-top:6px"><span style="font-size:24px;font-weight:800;color:${t.fg}">${fmt(S.openOnly?c.open:c.total)}</span><span class="rl" style="font-size:11px;color:var(--muted)">${S.openOnly?`${fmt(c.total)} total · ${fmt(c.last3h)} in 3h`:`${fmt(c.open)} open · ${fmt(c.last3h)} in 3h`}</span></div></button>`; }).join("")
        :`<div class="topo-card" style="padding:14px;color:var(--muted)">No errors in this window.</div>`;
      host.querySelectorAll(".fe-tile").forEach(b=>b.onclick=()=>{ S.category=(S.category===b.dataset.c)?"":b.dataset.c; load(host,fx,true); });
      drawRows(host,fx,live.rows,first);
      $("#feMore").innerHTML=live.nextCursor?`<button id="feMoreBtn" class="btn" style="font-size:11px;padding:5px 12px">Load more</button>`:"";
      const mb=$("#feMoreBtn"); if(mb) mb.onclick=async()=>{ mb.disabled=true; try{ const more=await fx.api("/api/fixed/errors/live?"+lq+"&limit=100&cursor="+encodeURIComponent(live.nextCursor)); live.rows=live.rows.concat(more.rows); live.nextCursor=more.nextCursor; drawRows(host,fx,live.rows,true); $("#feMore").innerHTML=more.nextCursor?`<span class="rl" style="color:var(--muted);font-size:11px">more available — narrow the window</span>`:""; }catch(e){ mb.disabled=false; } };
      $("#feStamp").textContent=`window ${fx.ts(sum.from)} → ${fx.ts(sum.to)} KSA · consumer-direct e-purchase excluded · refreshed ${fx.ts(new Date().toISOString(),true)} · auto-refresh 60 s`;
    }catch(e){ if(my!==S.tick) return; const t=host.querySelector("#feTiles"); if(t) t.innerHTML=`<div class="albanner" style="grid-column:1/-1;border-left:4px solid #dc2626;padding:12px 14px"><b>Error board unavailable</b> — ${esc(e.message)}</div>`; }
  }

  function drawRows(host,fx,rows,keepExpanded){
    const esc=fx.esc; const el=host.querySelector("#feRows"); if(!el) return;
    const th=h=>`<th style="text-align:left;padding:7px 10px;color:var(--muted);font-weight:700;font-size:10px;letter-spacing:.6px;border-bottom:1px solid var(--line)">${h}</th>`;
    const dealer=r=>{ if(r.channel==="epurchase"&&r.referral_code) return `<a href="#fixed?tab=qr&ref=${encodeURIComponent(r.referral_code)}" style="color:#2563eb">${esc(r.referral_code)} <span style="font-size:10px;color:var(--muted)">QR ↗</span></a>`;
      if(r.dealer_code) return `<a href="#fixed?tab=map&dealer=${encodeURIComponent(r.dealer_id||r.dealer_code)}" style="color:#2563eb">${esc(r.dealer_code)} <span style="font-size:10px;color:var(--muted)">↗</span></a>`;
      return `<span style="color:var(--muted)" title="No dealer/staff captured for this journey">unattributed</span>`; };
    const status=r=>r.resolved?`<span style="font-size:11px;font-weight:600;color:var(--green,#0e9f5a)">resolved</span>`:r.acked?`<span style="font-size:11px;font-weight:600;color:#2563eb" title="acked by ${esc(r.acked_by||"")}">acked</span>`:`<span style="font-size:11px;font-weight:600;color:#d97706">open</span>`;
    el.innerHTML=`<table class="mono" style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr>${["PRI","TIME KSA","CATEGORY","DEALER / QR","REGION","STATUS"].map(th).join("")}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr class="fe-row" data-id="${esc(r.id)}" style="cursor:pointer">
        <td style="padding:6px 10px;border-bottom:1px solid var(--line)">${prioBadge(r.priority)}</td><td style="padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap">${fmtT(r.occurred_at)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid var(--line)">${catBadge(r)}${r.code?`<span class="rl" style="font-size:10px;color:var(--muted);margin-left:6px">${esc(r.code)}</span>`:""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid var(--line)" class="fe-nostop">${dealer(r)}</td><td style="padding:6px 10px;border-bottom:1px solid var(--line)">${esc(r.region||"—")}</td>
        <td style="padding:6px 10px;border-bottom:1px solid var(--line)">${status(r)}</td></tr><tr class="fe-x" data-id="${esc(r.id)}" hidden><td colspan="6" style="padding:12px 14px;background:var(--bg,rgba(0,0,0,.03));border-bottom:1px solid var(--line)"></td></tr>`).join("")
      :`<tr><td colspan="6" style="padding:12px;color:var(--muted)">No errors match these filters.</td></tr>`}</tbody></table>`;
    el.querySelectorAll(".fe-row").forEach(tr=>tr.onclick=e=>{ if(e.target.closest("a")) return; const id=tr.dataset.id; const x=el.querySelector(`.fe-x[data-id="${CSS.escape(id)}"]`);
      if(S.expanded===id){ S.expanded=null; x.hidden=true; return; } el.querySelectorAll(".fe-x").forEach(o=>o.hidden=true); S.expanded=id; x.hidden=false; expand(host,fx,x.firstElementChild,rows.find(r=>r.id===id)); });
    if(keepExpanded&&S.expanded){ const x=el.querySelector(`.fe-x[data-id="${CSS.escape(S.expanded)}"]`); const r=rows.find(r=>r.id===S.expanded); if(x&&r){ x.hidden=false; expand(host,fx,x.firstElementChild,r); } }
  }

  async function expand(host,fx,cell,row){
    const esc=fx.esc, fmt=fx.fmt; const c=caps();
    cell.innerHTML=`<span style="color:var(--muted);font-size:12px">loading…</span>`;
    let d; try{ d=await fx.api("/api/fixed/errors/detail?id="+encodeURIComponent(row.id)); }catch(e){ cell.innerHTML=`<span style="color:#dc2626;font-size:12px">${esc(e.message)}</span>`; return; }
    if(!cell.isConnected) return;
    const pre=(html)=>`<pre style="margin:0;max-height:220px;overflow:auto;background:var(--card,#fff);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:11px;white-space:pre-wrap;word-break:break-word">${html==null?"—":html}</pre>`;
    const draw=(req,res,unmasked,extra)=>`<div style="display:grid;gap:8px;grid-template-columns:1fr 1fr"><div><div style="font-weight:700;margin-bottom:4px;font-size:12px">Request ${unmasked?`<span style="font-size:10px;font-weight:700;margin-left:8px;padding:1px 7px;border-radius:10px;border:1px solid #b7791f;color:#b45309" title="Raw customer data fetched live from nexus — this view is recorded in the audit log">⚠ PII UNMASKED — audited</span>`:""}</div>${pre(renderReq(req,row.step))}</div>
      <div><div style="font-weight:700;margin-bottom:4px;font-size:12px">Response</div>${pre(res==null?null:esc(pretty(res)))}</div></div>${extra||""}`;
    const sim=d.similar||{};
    const tl=(d.timeline||[]);
    cell.innerHTML=`<div style="display:grid;gap:10px;font-size:12px">
      <div><span style="color:var(--muted)">What happened: </span>${esc(d.event.message||d.event.label)}${d.event.step?` <span style="color:var(--muted)">· step ${esc(d.event.step)}</span>`:""}
        <span class="rl" style="color:var(--muted);font-size:10.5px;margin-left:10px">${esc(d.event.label)} · ${esc(d.event.team)} · base P${d.event.basePriority}${d.event.order_number?` · order ${esc(d.event.order_number)}`:""}${d.event.acct_masked?` · acct ${esc(d.event.acct_masked)}`:""}${d.event.cust_masked?` · cust …${esc(d.event.cust_masked)}`:""}${d.event.dealer_name?` · ${esc(d.event.dealer_name)}`:""}</span></div>
      <div id="feBodies">${(d.request!=null||d.response!=null)?draw(d.request,d.response,false):`<div style="color:var(--muted);font-size:11px">No captured request/response for this error (older event — re-ingest or backfill to populate).</div>`}</div>
      <div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--card,#fff)"><div style="font-weight:700;margin-bottom:6px">Similar cases <span class="rl" style="font-weight:400;color:var(--muted);font-size:10.5px">signature ${esc(d.event.signature||d.event.category)}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:16px"><span><b>${fmt(sim.d30)}</b> in 30d <span style="color:var(--muted)">(${fmt(sim.d7)} in 7d · ${fmt(sim.all)} ever)</span></span><span>last seen <b>${esc(rel(sim.lastSeen))}</b></span><span>affected today <b>${fmt(sim.affectedToday)}</b></span><span>median resolve <b>${sim.medianResolveMins!=null?sim.medianResolveMins+"m":"—"}</b></span>${sim.biggestDay?`<span>biggest day <b>${esc(sim.biggestDay.day)}</b> (${fmt(sim.biggestDay.count)})</span>`:""}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${d.event.attempt_id?`<button id="feTrace" class="btn" style="font-size:11px;padding:5px 11px">Open full trace → (${tl.length} calls)</button>`:""}
        ${c.unmaskPII&&d.event.attempt_id?`<button id="feUnmask" class="btn" style="font-size:11px;padding:5px 11px;border-color:#b7791f;color:#b45309" ${d.unmaskAvailable?"":"disabled title='NEXUS_DATABASE_URL not configured'"}>Unmask (audited)</button>`:""}
        ${c.ackErrors&&!d.event.resolved?`<button id="feAck" class="btn" style="font-size:11px;padding:5px 11px">${d.event.acked?"Un-ack":"Ack"}</button>`:""}
        ${d.event.acked?`<span class="rl" style="font-size:10.5px;color:var(--muted)">acked by ${esc(d.event.acked_by||"")}</span>`:""}
        <span class="rl" style="font-size:10.5px;color:var(--muted);margin-left:auto">attempt <span class="mono">${esc(d.event.attempt_id||"—")}</span> · event <span class="mono">${esc(d.event.id)}</span></span></div>
      <div id="feTl" hidden></div></div>`;
    const $=s=>cell.querySelector(s);
    const tb=$("#feTrace"); if(tb) tb.onclick=()=>{ const t=$("#feTl"); t.hidden=!t.hidden; if(!t.innerHTML) t.innerHTML=fx.tbl(["TIME KSA","METHOD","ENDPOINT","STATUS","MS","ERROR","INFO"],tl.map(x=>[fmtT(x.created_at),esc(x.method||""),`<span class="mono">${esc(x.endpoint)}</span>`,`<b style="color:${x.status>=400?"#dc2626":x.status>=200?"var(--green,#0e9f5a)":"inherit"}">${esc(x.status==null?"—":x.status)}</b>`,esc(x.duration_ms==null?"—":x.duration_ms),esc(x.error_class||x.error_msg||""),esc(x.info||"")])); };
    const ub=$("#feUnmask"); if(ub) ub.onclick=async()=>{ if(!confirm("Fetch the RAW (unmasked) request/response for this failing step from nexus? This access is written to the audit log.")) return; ub.disabled=true; ub.textContent="fetching…";
      try{ const u=await fx.api("/api/fixed/errors/detail?unmask=1&id="+encodeURIComponent(row.id)); const um=u.unmask||{};
        if(!um.unmaskAvailable){ ub.textContent="Unmask unavailable"; ub.title=um.error||"nexus not configured"; return; }
        if(!um.matched){ ub.textContent="no raw call matched"; return; }
        $("#feBodies").innerHTML=draw(um.request,um.response,true,`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:4px">raw endpoint <span class="mono">${esc(um.endpoint||"")}</span> · ${fmtT(um.at)} · ${fmt(um.calls)} api_logs rows${um.context?` · <a href="#" id="feCtx">workflow context</a>`:""}</div>${um.context?`<pre id="feCtxPre" hidden style="margin-top:6px;max-height:260px;overflow:auto;background:var(--card,#fff);border:1px solid #b7791f;border-radius:8px;padding:10px;font-size:11px;white-space:pre-wrap;word-break:break-word">${esc(pretty(um.context))}</pre>`:""}`);
        const cx=$("#feCtx"); if(cx) cx.onclick=e=>{ e.preventDefault(); const p=$("#feCtxPre"); p.hidden=!p.hidden; };
        ub.textContent="unmasked"; }catch(e){ ub.disabled=false; ub.textContent="Unmask failed: "+e.message; } };
    const ab=$("#feAck"); if(ab) ab.onclick=async()=>{ ab.disabled=true; try{ const undo=!!d.event.acked;
        const r=await fetch((window.API_BASE||window.CONSOLE_BASE||"")+"/api/fixed/errors/resolve",{method:"POST",headers:{"Content-Type":"application/json","X-Console-Role":localStorage.getItem("cons_role")||"report_manager","X-Console-User":localStorage.getItem("cons_email")||""},body:JSON.stringify({id:row.id,undo})});
        const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); load(host,fx,true); }catch(e){ ab.disabled=false; ab.textContent="Ack failed: "+e.message; } };
  }

  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.errors={ label:"Errors", sub:"error control board", render };
})();
