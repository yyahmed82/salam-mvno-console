/* refunds.js — Mobile › REFUND EXPOSURE (25 Sep 2026). What the platform already owes customers, detected every 15 min
 * on the replica (server/src/refundRadar.js) — before the complaint, before the call centre, before the INC. Six kinds:
 * paid-not-activated · same number ported in twice · change plan charged then failed · SIM/eSIM replacement paid ·
 * delivery failed on a paid order · charged twice. Each row carries its evidence and opens the customer's trace
 * (Troubleshoot timeline) and Customer 360. Humans close the loop here: Approve / Refunded / Dismiss with the INC —
 * the register the approval mails never had. Route #refunds (optional ?q=<mobile>, ?kind=, ?status=).
 * Dark mode through tokens; phone/iPad: tiles wrap, table becomes cards. */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const API=window.API_BASE||window.CONSOLE_BASE||"";
  const api=(p,o)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},o||{})).then(r=>r.json().then(j=>{ if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j; }));
  const SES=()=>window.opsSession?window.opsSession():{};
  const canUnmask=()=>{ const s=SES(); return !!(s.me&&s.me.caps&&s.me.caps.unmaskPII); };
  const isSuper=()=>{ const m=(SES().me)||{}; return m.realRole==="super_admin"||(m.realRoles||[]).includes("super_admin"); };
  const sar=v=>Number(v||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  const ksa=iso=>{ if(!iso) return "—"; const d=new Date(iso); return isNaN(d)?"—":d.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Riyadh"}); };
  const age=iso=>{ if(!iso) return "—"; const h=(Date.now()-new Date(iso).getTime())/36e5; if(h<1) return Math.round(h*60)+" min"; if(h<48) return Math.round(h)+" h"; return Math.round(h/24)+" d"; };
  const S={ status:"open", kind:"", q:"", unmask:null, data:null, rows:[], timer:null, drawer:null };
  const STATUS_L={open:"Open",approved:"Approved",refunded:"Refunded",dismissed:"Dismissed",resolved_auto:"Resolved by the platform"};

  const CSS=`
  #view-refunds .rf-wrap{display:flex;flex-direction:column;gap:14px}
  #view-refunds .rf-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap} #view-refunds .rf-head h2{margin:0;font-size:20px} #view-refunds .rf-head .sub{color:var(--muted);font-size:12.5px;max-width:900px}
  #view-refunds .rf-head .sp{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  #view-refunds .rf-btn{cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:6px 13px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink);transition:border-color .14s,color .14s,transform .14s}
  #view-refunds .rf-btn:hover{border-color:var(--green,#0e9f5a);color:var(--green,#0e9f5a);transform:translateY(-1px)} #view-refunds .rf-btn.p{background:var(--green,#0e9f5a);border-color:var(--green,#0e9f5a);color:#fff} #view-refunds .rf-btn.warn{border-color:#d97706;color:#b45309} #view-refunds .rf-btn.bad{border-color:#dc2626;color:#dc2626} #view-refunds .rf-btn:disabled{opacity:.5;cursor:default;transform:none}
  #view-refunds .rf-live{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:var(--green,#0e9f5a);border:1px solid var(--green,#0e9f5a);border-radius:999px;padding:3px 10px} #view-refunds .rf-live i{width:7px;height:7px;border-radius:50%;background:var(--green,#0e9f5a);animation:rfPulse 1.6s infinite} @keyframes rfPulse{0%,100%{opacity:1}50%{opacity:.25}}
  #view-refunds .rf-live.stale{color:#b45309;border-color:#d97706} #view-refunds .rf-live.stale i{background:#d97706;animation:none}
  #view-refunds .rf-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  #view-refunds .rf-tile{border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--card,#fff)} #view-refunds .rf-tile .l{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)} #view-refunds .rf-tile .v{font-size:26px;font-weight:800;line-height:1.15;margin-top:4px} #view-refunds .rf-tile .s{font-size:11.5px;color:var(--muted);margin-top:2px}
  #view-refunds .rf-tile.hot .v{color:#dc2626} #view-refunds .rf-tile.warn .v{color:#b45309} #view-refunds .rf-tile.ok .v{color:var(--green,#0e9f5a)}
  #view-refunds .rf-kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
  #view-refunds .rf-kind{cursor:pointer;border:1px solid var(--line);border-radius:14px;padding:11px 13px;background:var(--card,#fff);transition:border-color .14s,transform .14s} #view-refunds .rf-kind:hover{transform:translateY(-1px);border-color:var(--green,#0e9f5a)} #view-refunds .rf-kind.on{border-color:var(--green,#0e9f5a);box-shadow:0 0 0 2px rgba(14,159,90,.18)}
  #view-refunds .rf-kind b{display:block;font-size:13px} #view-refunds .rf-kind .n{font-size:20px;font-weight:800;margin-top:3px} #view-refunds .rf-kind .n small{font-size:12px;font-weight:600;color:var(--muted);margin-left:6px} #view-refunds .rf-kind .why{font-size:11px;color:var(--muted);margin-top:4px;line-height:1.35}
  #view-refunds .rf-kind.err{border-color:#dc2626} #view-refunds .rf-kind .e{font-size:11px;color:#dc2626;margin-top:4px}
  #view-refunds .rf-trend{border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--card,#fff)} #view-refunds .rf-trend h4{margin:0 0 6px;font-size:12.5px} #view-refunds .rf-trend svg{width:100%;height:96px;display:block}
  #view-refunds .rf-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap} #view-refunds .rf-chip{cursor:pointer;font:inherit;font-size:11.5px;font-weight:700;padding:4px 11px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--muted)} #view-refunds .rf-chip.on{color:#fff;background:var(--ink,#111);border-color:var(--ink,#111)} #view-refunds .rf-chip.on.open{background:#dc2626;border-color:#dc2626}
  #view-refunds .rf-tools input{font:inherit;font-size:12.5px;padding:6px 11px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink);min-width:220px}
  #view-refunds table.rf{width:100%;border-collapse:collapse;font-size:12.5px} #view-refunds table.rf th{text-align:left;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);padding:8px 8px;border-bottom:1px solid var(--line)} #view-refunds table.rf td{padding:9px 8px;border-bottom:1px solid var(--line-soft,var(--line));vertical-align:top}
  #view-refunds tr.open td:first-child{box-shadow:inset 3px 0 0 #dc2626} #view-refunds tr.approved td:first-child{box-shadow:inset 3px 0 0 #d97706} #view-refunds tr.refunded td:first-child,#view-refunds tr.resolved_auto td:first-child{box-shadow:inset 3px 0 0 var(--green,#0e9f5a)} #view-refunds tr.dismissed td{opacity:.6}
  #view-refunds .rf-ev{display:flex;gap:4px;flex-wrap:wrap} #view-refunds .rf-ev span{font-size:10.5px;border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:var(--muted);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} #view-refunds .rf-ev span b{color:var(--ink)}
  #view-refunds .rf-st{display:inline-block;font-size:10.5px;font-weight:800;border-radius:6px;padding:2px 7px;text-transform:uppercase;letter-spacing:.3px} #view-refunds .rf-st.open{background:#fee2e2;color:#b91c1c} #view-refunds .rf-st.approved{background:#fef3c7;color:#92400e} #view-refunds .rf-st.refunded,#view-refunds .rf-st.resolved_auto{background:#dcfce7;color:#166534} #view-refunds .rf-st.dismissed{background:var(--line);color:var(--muted)}
  :root[data-theme="dark"] #view-refunds .rf-st.open{background:rgba(220,38,38,.22);color:#fca5a5} :root[data-theme="dark"] #view-refunds .rf-st.approved{background:rgba(217,119,6,.22);color:#fcd34d} :root[data-theme="dark"] #view-refunds .rf-st.refunded,:root[data-theme="dark"] #view-refunds .rf-st.resolved_auto{background:rgba(22,163,74,.22);color:#86efac}
  #view-refunds .rf-act{display:flex;gap:4px;flex-wrap:wrap} #view-refunds .rf-act .rf-btn{padding:3px 9px;font-size:11px}
  #view-refunds .rf-drawer{position:fixed;top:0;right:0;bottom:0;width:min(640px,100vw);background:var(--card,#fff);border-left:1px solid var(--line);box-shadow:-12px 0 32px rgba(2,6,23,.18);z-index:60;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .2s} #view-refunds .rf-drawer.on{transform:none}
  #view-refunds .rf-drawer .hd{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)} #view-refunds .rf-drawer .hd h3{margin:0;font-size:15px;flex:1} #view-refunds .rf-drawer .bd{overflow:auto;padding:14px 16px;font-size:12.5px}
  #view-refunds .rf-drawer .kv{display:grid;grid-template-columns:150px 1fr;gap:4px 10px;margin-bottom:12px} #view-refunds .rf-drawer .kv div:nth-child(odd){color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
  #view-refunds .rf-tl{border-left:2px solid var(--line);margin-left:6px;padding-left:12px} #view-refunds .rf-tl .ev{position:relative;padding:4px 0 8px} #view-refunds .rf-tl .ev:before{content:"";position:absolute;left:-17px;top:9px;width:8px;height:8px;border-radius:50%;background:var(--green,#0e9f5a)} #view-refunds .rf-tl .ev.bad:before{background:#dc2626} #view-refunds .rf-tl .ev .t{font-size:11px;color:var(--muted)} #view-refunds .rf-tl .ev .d{font-size:12.5px}
  #view-refunds .rf-form{display:grid;gap:8px;margin-top:10px} #view-refunds .rf-form input,#view-refunds .rf-form textarea{font:inherit;font-size:12.5px;padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card,#fff);color:var(--ink)}
  #view-refunds .rf-empty{padding:26px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px}
  @media (max-width:860px){ #view-refunds table.rf thead{display:none} #view-refunds table.rf tr{display:block;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;padding:6px 8px} #view-refunds table.rf td{display:block;border:0;padding:4px 6px} #view-refunds table.rf td:before{content:attr(data-l);display:block;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px} #view-refunds .rf-drawer .kv{grid-template-columns:1fr} }`;

  function ensureView(){
    if(document.getElementById("rfCss")) return;
    const st=document.createElement("style"); st.id="rfCss"; st.textContent=CSS; document.head.appendChild(st);
    let v=document.getElementById("view-refunds"); if(!v){ v=document.createElement("section"); v.id="view-refunds"; v.className="view"; document.querySelector("main")?.appendChild(v); }
    v.innerHTML=`<div class="rf-wrap">
      <div class="rf-head"><div><h2>💸 Refund exposure</h2><div class="sub">Money the platform already owes customers — found on the replica every 15 min, <b>before the complaint, before the call centre, before the INC</b>. Paid but never activated · same number ported in twice · change plan charged then failed · SIM/eSIM replacement paid · delivery failed on a paid order · charged twice. Each row keeps its evidence and opens the customer's trace; close the loop here with the INC number.</div></div>
        <div class="sp"><span class="rf-live" id="rfLive"><i></i> loading</span><button class="rf-btn" id="rfRun">↻ Run detectors now</button><button class="rf-btn" id="rfUnmask" style="display:none"></button></div></div>
      <div class="rf-tiles" id="rfTiles"></div>
      <div class="rf-kinds" id="rfKinds"></div>
      <div class="rf-trend"><h4>Detected per day — last 30 days <span style="color:var(--muted);font-weight:400">· bars = candidates, line = SAR</span></h4><div id="rfTrend"></div></div>
      <div class="rf-tools"><span id="rfStatus"></span><input id="rfQ" placeholder="mobile · order · payment id · INC"><button class="rf-btn" id="rfGo">Search</button><span style="margin-left:auto;font-size:11.5px;color:var(--muted)" id="rfCount"></span></div>
      <div id="rfTable"></div>
      <div class="rf-drawer" id="rfDrawer"></div>
    </div>`;
    v.querySelector("#rfRun").addEventListener("click",async()=>{ const b=v.querySelector("#rfRun"); b.disabled=true; b.textContent="running…"; try{ await api("/api/refunds/run",{method:"POST",body:"{}"}); await load(); }catch(e){ alert(e.message);} b.disabled=false; b.textContent="↻ Run detectors now"; });
    v.querySelector("#rfGo").addEventListener("click",()=>{ S.q=v.querySelector("#rfQ").value.trim(); loadRows(); });
    v.querySelector("#rfQ").addEventListener("keydown",e=>{ if(e.key==="Enter"){ S.q=e.target.value.trim(); loadRows(); } });
    const um=v.querySelector("#rfUnmask"); if(canUnmask()){ um.style.display=""; um.addEventListener("click",()=>{ S.unmask=!S.unmask; loadRows(); }); }
    v.addEventListener("click",e=>{ const b=e.target.closest("[data-act]"); if(!b) return; const id=b.dataset.id; const act=b.dataset.act;
      if(act==="c360"){ const k=b.dataset.key; if(window.openSub360){ window.openSub360(k); if(window.setConsoleHash) window.setConsoleHash("subscriber?key="+encodeURIComponent(k)); } else location.hash="#subscriber?key="+encodeURIComponent(k); return; }
      if(act==="trace"){ openTrace(id); return; }
      if(act==="set"){ openSet(id,b.dataset.status); return; }
      if(act==="close"){ closeDrawer(); return; }
      if(act==="kind"){ S.kind=S.kind===b.dataset.kind?"":b.dataset.kind; renderKinds(); loadRows(); return; }
      if(act==="status"){ S.status=b.dataset.status; renderStatus(); loadRows(); return; } });
  }
  function renderStatus(){ const el=document.getElementById("rfStatus"); if(!el) return; el.innerHTML=[["open","Open"],["approved","Approved"],["refunded","Refunded"],["dismissed","Dismissed"],["resolved_auto","Resolved by platform"],["all","All"]].map(([k,l])=>`<button class="rf-chip ${S.status===k?"on "+k:""}" data-act="status" data-status="${k}">${l}</button>`).join(" "); }
  function renderTiles(d){
    const o=d.open||{}; const stale=d.last_run&&d.last_run.at&&(Date.now()-new Date(d.last_run.at).getTime())>3*d.tick_min*60e3;
    const live=document.getElementById("rfLive"); live.className="rf-live"+(stale?" stale":""); live.innerHTML=`<i></i> ${d.last_run&&d.last_run.at?"last scan "+ksa(d.last_run.at)+" · "+(d.last_run.found||0)+" found · "+(d.last_run.ms||0)+" ms":"no scan yet"} · every ${d.tick_min} min · ${d.lookback_days} d window`;
    document.getElementById("rfTiles").innerHTML=`
      <div class="rf-tile ${o.open?"hot":"ok"}"><div class="l">Open candidates</div><div class="v">${o.open||0}</div><div class="s">customers owed, not yet handled</div></div>
      <div class="rf-tile ${o.sar>3000?"hot":o.sar>0?"warn":"ok"}"><div class="l">SAR at stake</div><div class="v">${sar(o.sar)}</div><div class="s">sum of open candidates</div></div>
      <div class="rf-tile ${o.new_24h>=8?"hot":o.new_24h?"warn":"ok"}"><div class="l">New in 24 h</div><div class="v">${o.new_24h||0}</div><div class="s">alert at 8 (refund_exposure_surge)</div></div>
      <div class="rf-tile ${o.older_7d?"warn":"ok"}"><div class="l">Older than 7 days</div><div class="v">${o.older_7d||0}</div><div class="s">still open — the customer has probably called</div></div>
      <div class="rf-tile"><div class="l">Oldest open</div><div class="v" style="font-size:18px">${o.oldest?age(o.oldest):"—"}</div><div class="s">${o.oldest?ksa(o.oldest):"nothing open"}</div></div>`;
  }
  function renderKinds(){
    const d=S.data; if(!d) return; const err=(d.last_run&&d.last_run.errors)||{};
    const agg={}; (d.by_kind||[]).forEach(x=>{ const a=agg[x.kind]=agg[x.kind]||{open:0,sar:0,all:0}; a.all+=x.n; if(x.status==="open"){ a.open+=x.n; a.sar+=x.sar; } });
    document.getElementById("rfKinds").innerHTML=Object.entries(d.kinds).map(([k,v])=>{ const a=agg[k]||{open:0,sar:0,all:0}; const e=err[k];
      return `<div class="rf-kind ${S.kind===k?"on":""} ${e?"err":""}" data-act="kind" data-kind="${k}"><b>${esc(v.label)}</b><div class="n">${a.open}<small>open · ${sar(a.sar)} SAR · ${a.all} in window</small></div><div class="why">${esc(v.why)}</div>${e?`<div class="e">detector error: ${esc(e)}</div>`:""}</div>`; }).join("");
  }
  function renderTrend(d){
    const t=d.trend||[]; const el=document.getElementById("rfTrend"); if(!t.length){ el.innerHTML='<div class="rf-empty" style="padding:14px">nothing detected in the window yet</div>'; return; }
    const W=900,H=96,pad=6; const mx=Math.max(1,...t.map(x=>x.n)); const ms=Math.max(1,...t.map(x=>x.sar)); const bw=(W-pad*2)/t.length;
    const bars=t.map((x,i)=>`<rect x="${pad+i*bw+1}" y="${H-10-(x.n/mx)*(H-24)}" width="${Math.max(2,bw-2)}" height="${(x.n/mx)*(H-24)}" rx="2" fill="var(--green,#0e9f5a)" opacity=".75"><title>${x.day.slice(0,10)}: ${x.n} · ${sar(x.sar)} SAR</title></rect>`).join("");
    const line=t.map((x,i)=>`${i?"L":"M"}${pad+i*bw+bw/2},${H-10-(x.sar/ms)*(H-24)}`).join(" ");
    el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}<path d="${line}" fill="none" stroke="#d97706" stroke-width="2"/><text x="${pad}" y="${H-1}" font-size="9" fill="var(--muted)">${t[0].day.slice(5,10)}</text><text x="${W-pad}" y="${H-1}" font-size="9" text-anchor="end" fill="var(--muted)">${t[t.length-1].day.slice(5,10)}</text></svg>`;
  }
  function evChips(e){ return `<div class="rf-ev">${Object.entries(e||{}).filter(([k,v])=>v!=null&&v!=="").slice(0,6).map(([k,v])=>`<span title="${esc(typeof v==="object"?JSON.stringify(v):v)}"><b>${esc(k.replace(/_/g," "))}</b> ${esc(typeof v==="object"?JSON.stringify(v):String(v))}</span>`).join("")}</div>`; }
  function renderRows(){
    const rows=S.rows; const el=document.getElementById("rfTable"); document.getElementById("rfCount").textContent=rows.length+" row(s)";
    if(!rows.length){ el.innerHTML='<div class="rf-empty">No candidates for this filter — good news, or the detectors have not run yet.</div>'; return; }
    const um=document.getElementById("rfUnmask"); if(um&&um.style.display!=="none") um.textContent=S.unmask?"Mask PII":"Unmask PII";
    el.innerHTML=`<table class="rf"><thead><tr><th>Event</th><th>Kind</th><th>Customer</th><th>SAR</th><th>Evidence</th><th>Age</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>{ const key=r.order_id||r.mobile||r.payment_id; const st=r.status;
      return `<tr class="${st}"><td data-l="Event">${ksa(r.event_at)}<div style="font-size:10.5px;color:var(--muted)">seen ${ksa(r.detected_at)}</div></td>
        <td data-l="Kind"><b>${esc((S.data.kinds[r.kind]||{}).label||r.kind)}</b></td>
        <td data-l="Customer">${r.customer_name?`<b>${esc(r.customer_name)}</b><br>`:""}${esc(r.mobile||"—")}${r.identifier?`<div style="font-size:10.5px;color:var(--muted)">${esc(r.identifier)}</div>`:""}</td>
        <td data-l="SAR"><b>${sar(r.amount)}</b></td><td data-l="Evidence">${evChips(r.evidence)}</td><td data-l="Age">${age(r.event_at)}</td>
        <td data-l="Status"><span class="rf-st ${st}">${esc(STATUS_L[st]||st)}</span>${r.inc?`<div style="font-size:11px;margin-top:3px"><b>${esc(r.inc)}</b></div>`:""}${r.updated_by?`<div style="font-size:10.5px;color:var(--muted)">${esc(r.updated_by.split("@")[0])} · ${ksa(r.updated_at)}</div>`:""}${r.note?`<div style="font-size:10.5px;color:var(--muted)">${esc(r.note)}</div>`:""}</td>
        <td data-l="Actions"><div class="rf-act"><button class="rf-btn" data-act="trace" data-id="${r.id}">Trace</button><button class="rf-btn" data-act="c360" data-key="${esc(key)}">Customer 360</button>${st==="open"||st==="approved"?`<button class="rf-btn warn" data-act="set" data-id="${r.id}" data-status="approved" ${st==="approved"?"disabled":""}>Approve</button><button class="rf-btn p" data-act="set" data-id="${r.id}" data-status="refunded">Refunded</button><button class="rf-btn" data-act="set" data-id="${r.id}" data-status="dismissed">Dismiss</button>`:`<button class="rf-btn" data-act="set" data-id="${r.id}" data-status="open">Reopen</button>`}</div></td></tr>`; }).join("")}</tbody></table>`;
  }
  async function loadRows(){
    try{ const j=await api(`/api/refunds?status=${encodeURIComponent(S.status)}&kind=${encodeURIComponent(S.kind)}&q=${encodeURIComponent(S.q)}${S.unmask?"&unmask=1":""}`); S.rows=j.rows||[]; if(S.data) S.data.kinds=j.kinds||S.data.kinds; renderRows(); }
    catch(e){ document.getElementById("rfTable").innerHTML=`<div class="rf-empty">${esc(e.message)}</div>`; }
  }
  async function load(){
    try{ S.data=await api("/api/refunds/overview"); renderTiles(S.data); renderKinds(); renderTrend(S.data); }
    catch(e){ document.getElementById("rfTiles").innerHTML=`<div class="rf-empty">${esc(e.message)}</div>`; }
    renderStatus(); await loadRows();
  }
  function closeDrawer(){ const d=document.getElementById("rfDrawer"); d.classList.remove("on"); }
  function drawer(html){ const d=document.getElementById("rfDrawer"); d.innerHTML=html; d.classList.add("on"); }
  async function openTrace(id){
    const r=S.rows.find(x=>String(x.id)===String(id)); if(!r) return; const key=r.order_id||r.payment_id||r.mobile; const kinds=S.data.kinds;
    drawer(`<div class="hd"><h3>Trace · ${esc((kinds[r.kind]||{}).label||r.kind)}</h3><button class="rf-btn" data-act="c360" data-key="${esc(r.order_id||r.mobile||r.payment_id)}">Customer 360</button><button class="rf-btn" data-act="close">✕</button></div>
      <div class="bd"><div class="kv"><div>Customer</div><div>${esc(r.customer_name||"—")} · ${esc(r.mobile||"—")}${r.identifier?" · "+esc(r.identifier):""}</div><div>Amount</div><div><b>${sar(r.amount)} SAR</b></div><div>Event</div><div>${ksa(r.event_at)} (${age(r.event_at)} ago) · detected ${ksa(r.detected_at)}</div><div>Order / payment</div><div>${esc(r.order_id||"—")} · ${esc(r.payment_id||"—")}</div><div>Why flagged</div><div>${esc((kinds[r.kind]||{}).why||"")}</div><div>Refund mail reason</div><div>${esc((kinds[r.kind]||{}).mail_reason||"")}</div></div>
      <h4 style="margin:0 0 6px;font-size:12.5px">Evidence</h4>${evChips(r.evidence)}<h4 style="margin:14px 0 6px;font-size:12.5px">Customer timeline (Troubleshoot)</h4><div id="rfTl" style="color:var(--muted)">loading…</div></div>`);
    try{ const t=await api("/api/transaction?id="+encodeURIComponent(key)+(S.unmask?"&unmask=1":"")); const ev=(t.events||[]).slice(-40);
      document.getElementById("rfTl").innerHTML=ev.length?`<div class="rf-tl">${ev.map(e=>`<div class="ev ${e.ok===false?"bad":""}"><div class="t">${ksa(e.at||e.when)} · ${esc(e.source||"")} · ${esc(e.kind||e.category||"")}</div><div class="d">${esc(e.detail||"")}</div></div>`).join("")}</div>`:'<div class="rf-empty">no timeline events for this key</div>'; }
    catch(e){ document.getElementById("rfTl").innerHTML=`<div class="rf-empty">${esc(e.message)}</div>`; }
  }
  function openSet(id,status){
    const r=S.rows.find(x=>String(x.id)===String(id)); if(!r) return;
    drawer(`<div class="hd"><h3>${esc(STATUS_L[status]||status)} · ${esc(r.mobile||r.order_id||"")}</h3><button class="rf-btn" data-act="close">✕</button></div><div class="bd"><div class="kv"><div>Kind</div><div>${esc((S.data.kinds[r.kind]||{}).label||r.kind)}</div><div>Amount</div><div><b>${sar(r.amount)} SAR</b></div></div>
      <div class="rf-form"><input id="rfInc" placeholder="INC number (e.g. INC0029427)" value="${esc(r.inc||"")}"><textarea id="rfNote" rows="3" placeholder="note — who approved, refund transaction id, or why dismissed">${esc(r.note||"")}</textarea><div><button class="rf-btn p" id="rfSave">Save as ${esc(STATUS_L[status]||status)}</button></div></div></div>`);
    document.getElementById("rfSave").addEventListener("click",async()=>{ try{ await api(`/api/refunds/${id}/status`,{method:"POST",body:JSON.stringify({status,inc:document.getElementById("rfInc").value.trim(),note:document.getElementById("rfNote").value.trim()})}); closeDrawer(); await load(); }catch(e){ alert(e.message);} });
  }
  window.openRefunds=function(qs){
    ensureView(); if(S.unmask===null) S.unmask=isSuper()&&canUnmask();
    const m=/(?:^|[?&])q=([^&]+)/.exec(qs||location.hash); if(m){ S.q=decodeURIComponent(m[1]); const i=document.getElementById("rfQ"); if(i) i.value=S.q; }
    const k=/(?:^|[?&])kind=([a-z_]+)/.exec(qs||location.hash); if(k) S.kind=k[1];
    const st=/(?:^|[?&])status=([a-z_]+)/.exec(qs||location.hash); if(st) S.status=st[1];
    load();
    if(S.timer) clearInterval(S.timer);
    S.timer=setInterval(()=>{ const v=document.getElementById("view-refunds"); if(!v||!v.classList.contains("active")){ clearInterval(S.timer); S.timer=null; return; } if(document.visibilityState==="visible") load(); },60000);
  };
})();
