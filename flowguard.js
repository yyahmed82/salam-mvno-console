/* flowguard.js — Mobile › ONBOARDING FLOW GUARD (29 Sep 2026 · TKT-000068 / TKT-000069 by Sreekanth).
 * Orders placed through a flow the business never approved — a vanity number with a prepaid plan, a plan already
 * disabled when the order was placed, a number class that does not match the plan family — found on the replica
 * every 15 min (server/src/flowGuard.js), kept with their evidence, raised as incidents on the Mobile digital L2 team.
 * Tabs: Findings (kinds · status · search · drawer with evidence, Customer 360, INC) · Plan catalog (every plan, its
 * live state, its timeline of enabled / price changes, the allow-list) · Detectors (runs, settings).
 * Route #flowguard (?tab= &kind= &status= &q=). Dark mode through tokens; phone / iPad: tiles wrap, the table becomes
 * cards, the drawer takes the screen. Every button follows the console's green system — no browser defaults. */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const API=window.API_BASE||window.CONSOLE_BASE||"";
  const api=(p,o)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},o||{})).then(r=>r.json().then(j=>{ if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j; }));
  const SES=()=>window.opsSession?window.opsSession():{};
  const caps=()=>{ const s=SES(); return (s.me&&s.me.caps)||{}; };
  const canManage=()=>!!caps().manageSync; const canAct=()=>!!caps().ackErrors;
  const n0=v=>Number(v||0).toLocaleString("en-US"); const sar=v=>Number(v||0).toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0});
  const ksa=iso=>{ if(!iso) return "—"; const d=new Date(iso); return isNaN(d)?"—":d.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Riyadh"}); };
  const ksaD=iso=>{ if(!iso) return "—"; const d=new Date(iso); return isNaN(d)?"—":d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric",timeZone:"Asia/Riyadh"}); };
  const age=iso=>{ if(!iso) return "—"; const h=(Date.now()-new Date(iso).getTime())/36e5; if(h<1) return Math.round(h*60)+" min"; if(h<48) return Math.round(h)+" h"; return Math.round(h/24)+" d"; };
  const STATUS_L={open:"Open · not activated",activated:"Activated",expired:"Expired",dismissed:"Dismissed",resolved:"Resolved"};
  const S={ tab:"findings", kind:"", status:"active", q:"", days:90, data:null, rows:[], plans:null, planQ:"", planFilter:"all", timer:null };

  const CSS=`
  #view-flowguard .fg-wrap{display:flex;flex-direction:column;gap:14px}
  #view-flowguard .fg-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap} #view-flowguard .fg-head h2{margin:0;font-size:20px} #view-flowguard .fg-head .sub{color:var(--muted);font-size:12.5px;max-width:980px;line-height:1.45}
  #view-flowguard .fg-head .sp{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  #view-flowguard .fg-btn{cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:6px 13px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);transition:border-color .14s,color .14s,transform .14s;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  #view-flowguard .fg-btn:hover{border-color:var(--green);color:var(--green);transform:translateY(-1px)} #view-flowguard .fg-btn.p{background:var(--green);border-color:var(--green);color:#fff} #view-flowguard .fg-btn.p:hover{color:#fff;filter:brightness(1.06)} #view-flowguard .fg-btn.bad{border-color:var(--red);color:var(--bad-fg)} #view-flowguard .fg-btn:disabled{opacity:.5;cursor:default;transform:none} #view-flowguard .fg-btn.sm{padding:3px 9px;font-size:11px}
  #view-flowguard .fg-live{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:var(--green);border:1px solid var(--green);border-radius:999px;padding:3px 10px;white-space:nowrap} #view-flowguard .fg-live i{width:7px;height:7px;border-radius:50%;background:var(--green);animation:fgPulse 1.6s infinite} @keyframes fgPulse{0%,100%{opacity:1}50%{opacity:.25}}
  #view-flowguard .fg-live.stale{color:var(--warn-fg);border-color:var(--amber)} #view-flowguard .fg-live.stale i{background:var(--amber);animation:none} #view-flowguard .fg-live.err{color:var(--bad-fg);border-color:var(--red)} #view-flowguard .fg-live.err i{background:var(--red);animation:none}
  #view-flowguard .fg-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
  #view-flowguard .fg-tile{border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--card);min-width:0} #view-flowguard .fg-tile .l{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)} #view-flowguard .fg-tile .v{font-size:25px;font-weight:800;line-height:1.15;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #view-flowguard .fg-tile .v small{font-size:12px;font-weight:700;color:var(--muted);margin-left:5px} #view-flowguard .fg-tile .s{font-size:11.5px;color:var(--muted);margin-top:2px;line-height:1.35}
  #view-flowguard .fg-tile.hot .v{color:var(--red)} #view-flowguard .fg-tile.warn .v{color:var(--warn-fg)} #view-flowguard .fg-tile.ok .v{color:var(--green)} #view-flowguard .fg-tile.blue .v{color:var(--blue)}
  #view-flowguard .fg-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none} #view-flowguard .fg-tabs::-webkit-scrollbar{display:none} #view-flowguard .fg-tab{cursor:pointer;font:inherit;font-size:12.5px;font-weight:700;padding:9px 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted);white-space:nowrap;margin-bottom:-1px} #view-flowguard .fg-tab:hover{color:var(--ink)} #view-flowguard .fg-tab.on{color:var(--green);border-bottom-color:var(--green)} #view-flowguard .fg-tab b{display:inline-block;min-width:18px;padding:0 6px;margin-left:6px;border-radius:999px;font-size:10.5px;background:var(--line);color:var(--ink);text-align:center} #view-flowguard .fg-tab.on b{background:var(--green);color:#fff} #view-flowguard .fg-tab b.hot{background:var(--red);color:#fff}
  #view-flowguard .fg-kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}
  #view-flowguard .fg-kind{cursor:pointer;border:1px solid var(--line);border-radius:14px;padding:11px 13px;background:var(--card);transition:border-color .14s,transform .14s;min-width:0} #view-flowguard .fg-kind:hover{transform:translateY(-1px);border-color:var(--green)} #view-flowguard .fg-kind.on{border-color:var(--green);box-shadow:0 0 0 2px color-mix(in srgb,var(--green) 25%,transparent)}
  #view-flowguard .fg-kind b{display:flex;align-items:center;gap:6px;font-size:13px} #view-flowguard .fg-kind .n{font-size:20px;font-weight:800;margin-top:3px} #view-flowguard .fg-kind .n small{font-size:11.5px;font-weight:600;color:var(--muted);margin-left:6px} #view-flowguard .fg-kind .n.hot{color:var(--red)} #view-flowguard .fg-kind .why{font-size:11px;color:var(--muted);margin-top:4px;line-height:1.35}
  #view-flowguard .fg-sev{display:inline-block;font-size:9.5px;font-weight:800;border-radius:6px;padding:1px 6px;background:var(--tint-amber);color:var(--tint-amber-fg);letter-spacing:.3px}
  #view-flowguard .fg-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap} #view-flowguard .fg-tools .cnt{margin-left:auto;font-size:11.5px;color:var(--muted)}
  #view-flowguard .fg-chip{cursor:pointer;font:inherit;font-size:11.5px;font-weight:700;padding:4px 11px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--muted);white-space:nowrap} #view-flowguard .fg-chip:hover{border-color:var(--green);color:var(--green)} #view-flowguard .fg-chip.on{color:var(--solid-fg);background:var(--solid);border-color:var(--solid)} #view-flowguard .fg-chip.on.hot{background:var(--red);border-color:var(--red);color:#fff}
  #view-flowguard .fg-in{font:inherit;font-size:12.5px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);min-width:220px;color-scheme:inherit}
  #view-flowguard select.fg-in{min-width:0;padding-right:26px;appearance:none;-webkit-appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 14px) 12px,calc(100% - 9px) 12px;background-size:5px 5px;background-repeat:no-repeat}
  #view-flowguard .fg-card{border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--card);min-width:0} #view-flowguard .fg-card h4{margin:0 0 6px;font-size:12.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap} #view-flowguard .fg-card h4 span{color:var(--muted);font-weight:400}
  #view-flowguard table.fg{width:100%;border-collapse:collapse;font-size:12.5px} #view-flowguard table.fg th{text-align:left;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);padding:8px 8px;border-bottom:1px solid var(--line);white-space:nowrap} #view-flowguard table.fg td{padding:9px 8px;border-bottom:1px solid var(--line-soft);vertical-align:top} #view-flowguard table.fg td.num,#view-flowguard table.fg th.num{text-align:right;white-space:nowrap}
  #view-flowguard tr.activated td:first-child{box-shadow:inset 3px 0 0 var(--red)} #view-flowguard tr.open td:first-child{box-shadow:inset 3px 0 0 var(--amber)} #view-flowguard tr.resolved td:first-child{box-shadow:inset 3px 0 0 var(--green)} #view-flowguard tr.dismissed td,#view-flowguard tr.expired td{opacity:.62}
  #view-flowguard .fg-st{display:inline-block;font-size:10.5px;font-weight:800;border-radius:6px;padding:2px 7px;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap} #view-flowguard .fg-st.activated{background:var(--tint-red);color:var(--tint-red-fg)} #view-flowguard .fg-st.open{background:var(--tint-amber);color:var(--tint-amber-fg)} #view-flowguard .fg-st.resolved{background:var(--tint-green);color:var(--tint-green-fg)} #view-flowguard .fg-st.dismissed,#view-flowguard .fg-st.expired{background:var(--line);color:var(--muted)} #view-flowguard .fg-st.disabled{background:var(--tint-red);color:var(--tint-red-fg)} #view-flowguard .fg-st.enabled{background:var(--tint-green);color:var(--tint-green-fg)} #view-flowguard .fg-st.allowed{background:var(--tint-blue);color:var(--tint-blue-fg)}
  #view-flowguard .fg-cls{display:inline-block;font-size:10px;font-weight:800;border-radius:999px;padding:1px 8px;color:#fff;white-space:nowrap;vertical-align:middle}
  #view-flowguard .fg-ev{display:flex;gap:4px;flex-wrap:wrap} #view-flowguard .fg-ev span{font-size:10.5px;border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:var(--muted);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} #view-flowguard .fg-ev span b{color:var(--ink)}
  #view-flowguard .fg-note{font-size:10.5px;color:var(--muted);margin-top:3px;line-height:1.35;word-break:break-word}
  #view-flowguard .fg-act{display:flex;gap:4px;flex-wrap:wrap}
  #view-flowguard .fg-empty{padding:26px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px;line-height:1.5}
  #view-flowguard .fg-warn{padding:10px 13px;border-radius:12px;background:var(--tint-warn-bg);border:1px solid var(--tint-warn-line);color:var(--tint-warn-fg);font-size:12px;line-height:1.45}
  #view-flowguard .fg-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  #view-flowguard .fg-tl{border-left:2px solid var(--line);margin-left:6px;padding-left:12px} #view-flowguard .fg-tl .ev{position:relative;padding:3px 0 7px} #view-flowguard .fg-tl .ev:before{content:"";position:absolute;left:-17px;top:8px;width:8px;height:8px;border-radius:50%;background:var(--green)} #view-flowguard .fg-tl .ev.bad:before{background:var(--red)} #view-flowguard .fg-tl .ev .t{font-size:11px;color:var(--muted)} #view-flowguard .fg-tl .ev .d{font-size:12.5px;word-break:break-word}
  #view-flowguard .fg-def{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;font-size:12.5px;line-height:1.45} #view-flowguard .fg-def>div:nth-child(odd){color:var(--muted);font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;padding-top:2px} #view-flowguard .fg-def>div{min-width:0;word-break:break-word}
  #view-flowguard .fg-pol{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px 14px} #view-flowguard .fg-pol label{display:flex;flex-direction:column;gap:4px;font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--muted)} #view-flowguard .fg-pol input,#view-flowguard .fg-pol textarea{font:inherit;font-size:12.5px;padding:6px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);text-transform:none;letter-spacing:0;font-weight:500;width:100%;box-sizing:border-box}
  #view-flowguard .fg-drawer{position:fixed;top:0;right:0;bottom:0;width:min(640px,100vw);background:var(--card);border-left:1px solid var(--line);box-shadow:-12px 0 32px var(--scrim);z-index:1260;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .2s} #view-flowguard .fg-drawer.on{transform:none}
  #view-flowguard .fg-drawer .hd{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap} #view-flowguard .fg-drawer .hd h3{margin:0;font-size:15px;flex:1;min-width:0} #view-flowguard .fg-drawer .bd{overflow:auto;padding:14px 16px;font-size:12.5px;padding-bottom:calc(14px + var(--safe-b,0px))}
  #view-flowguard .fg-drawer .kv{display:grid;grid-template-columns:150px 1fr;gap:4px 10px;margin-bottom:12px} #view-flowguard .fg-drawer .kv div:nth-child(odd){color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px} #view-flowguard .fg-drawer .kv div{min-width:0;word-break:break-word}
  #view-flowguard .fg-form{display:grid;gap:8px;margin-top:10px} #view-flowguard .fg-form input,#view-flowguard .fg-form textarea{font:inherit;font-size:12.5px;padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);width:100%;box-sizing:border-box}
  #view-flowguard .fg-hist{font-size:10.5px;color:var(--muted);line-height:1.4} #view-flowguard .fg-hist b{color:var(--ink)}
  @media (max-width:860px){ #view-flowguard .fg-grid2{grid-template-columns:1fr} #view-flowguard .fg-tiles{grid-template-columns:repeat(2,1fr)} #view-flowguard .fg-head .sp{margin-left:0} #view-flowguard .fg-in{min-width:0;flex:1 1 140px} #view-flowguard .fg-def{grid-template-columns:1fr} #view-flowguard .fg-drawer .kv{grid-template-columns:1fr}
    #view-flowguard table.fg thead{display:none} #view-flowguard table.fg tr{display:block;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;padding:6px 8px} #view-flowguard table.fg td{display:block;border:0;padding:4px 6px;text-align:left!important} #view-flowguard table.fg td:before{content:attr(data-l);display:block;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px} #view-flowguard table.fg td:empty{display:none} }
  @media (max-width:480px){ #view-flowguard .fg-tiles{grid-template-columns:1fr 1fr} #view-flowguard .fg-tile .v{font-size:21px} }`;

  /* ------------------------------------------------------------------ helpers */
  const K=()=>(S.data&&S.data.kinds)||{}; const kindLabel=k=>(K()[k]||{}).label||k; const kindShort=k=>(K()[k]||{}).short||k;
  const clsColor=g=>{ const C=(S.data&&S.data.classes)||{}; return (C[g]&&C[g].color)||"#94a3b8"; };
  const clsChip=r=>`<span class="fg-cls" style="background:${esc(clsColor(r.group_id))}" title="numbers.group_id ${esc(r.group_id)}">${esc(r.number_class||("group "+r.group_id))}</span>`;
  const typeL=t=>Number(t)===2?"postpaid":"prepaid";
  function evChips(e,max){ return `<div class="fg-ev">${Object.entries(e||{}).filter(([k,v])=>v!=null&&v!==""&&k!=="rule").slice(0,max||6).map(([k,v])=>`<span title="${esc(typeof v==="object"?JSON.stringify(v):v)}"><b>${esc(k.replace(/_/g," "))}</b> ${esc(typeof v==="object"?JSON.stringify(v):String(v))}</span>`).join("")}</div>`; }
  function setHash(){ if(!window.setConsoleHash) return; const q=[`tab=${S.tab}`]; if(S.kind) q.push("kind="+S.kind); if(S.status&&S.status!=="active") q.push("status="+S.status); if(S.q) q.push("q="+encodeURIComponent(S.q)); try{ window.setConsoleHash("flowguard?"+q.join("&")); }catch(_){} }
  function toast(m){ if(window.opsToast) window.opsToast(m); else console.warn(m); }

  /* ------------------------------------------------------------------ view */
  function ensureView(){
    if(document.getElementById("fgCss")) return;
    const st=document.createElement("style"); st.id="fgCss"; st.textContent=CSS; document.head.appendChild(st);
    let v=document.getElementById("view-flowguard"); if(!v){ v=document.createElement("section"); v.id="view-flowguard"; v.className="view"; document.querySelector("main")?.appendChild(v); }
    v.innerHTML=`<div class="fg-wrap">
      <div class="fg-head"><div><h2>⚑ Onboarding flow guard</h2><div class="sub">Orders placed through a flow the business never approved — a <b>vanity number with a prepaid plan</b>, a plan that was <b>already disabled</b> when the order was placed, a <b>number class that does not match the plan</b> (data SIM ↔ voice). Found on the replica every 15 min from the chosen number, the order and the plan; an <b>activated</b> one opens a P3 incident on the Mobile digital L2 team (TCS) with the case in the triage note. Attempts the checkout refused stay here until their reservation lapses.</div></div>
        <div class="sp"><span class="fg-live" id="fgLive"><i></i> loading</span><button class="fg-btn" id="fgRun" title="scan the replica now — the same run the scheduler does every 15 min">↻ Run detectors now</button><button class="fg-btn" id="fgReload">Refresh</button></div></div>
      <div class="fg-tiles" id="fgTiles"></div>
      <div class="fg-tabs" id="fgTabs"></div>
      <div id="fgPanel"></div>
      <div class="fg-drawer" id="fgDrawer" aria-hidden="true"></div></div>`;
    v.querySelector("#fgRun").addEventListener("click",async()=>{ const b=v.querySelector("#fgRun"); b.disabled=true; b.textContent="… scanning"; try{ const r=await api("/api/flowguard/run",{method:"POST",body:"{}"}); toast(r.error?("Run failed — "+r.error):`Scanned ${n0(r.scanned)} chosen numbers · ${n0(r.found)} finding(s), ${n0(r.new_rows)} new${r.plan_changes?` · ${r.plan_changes} plan change(s)`:""} in ${Math.round((r.ms||0)/1000)} s`); await load(); }catch(e){ toast(e.message); } finally{ b.disabled=false; b.textContent="↻ Run detectors now"; } });
    v.querySelector("#fgReload").addEventListener("click",()=>load());
    v.addEventListener("click",e=>{ const t=e.target.closest("[data-act]"); if(!t) return; const a=t.dataset.act;
      if(a==="close") closeDrawer(); else if(a==="c360"&&t.dataset.key){ location.hash="#subscriber?key="+encodeURIComponent(t.dataset.key); closeDrawer(); }
      else if(a==="set") openSet(t.dataset.id,t.dataset.status); else if(a==="open") openRow(t.dataset.id); });
  }
  function drawer(html){ const d=document.getElementById("fgDrawer"); d.innerHTML=html; d.classList.add("on"); d.setAttribute("aria-hidden","false"); }
  function closeDrawer(){ const d=document.getElementById("fgDrawer"); d.classList.remove("on"); d.setAttribute("aria-hidden","true"); }

  function renderLive(d){ const el=document.getElementById("fgLive"); const lr=d.last_run; if(!lr){ el.className="fg-live stale"; el.innerHTML="<i></i> no run yet — first scan 1 min after start"; return; }
    if(lr.error){ el.className="fg-live err"; el.innerHTML=`<i></i> last run failed · ${esc(lr.error)}`; return; }
    const stale=(Date.now()-new Date(lr.at).getTime())>45*60e3; el.className="fg-live"+(stale?" stale":""); el.innerHTML=`<i></i> ${d.running?"scanning now":"last scan "+age(lr.at)+" ago"} · every ${d.cfg.intervalMin} min${lr.backfill?" · backfill "+lr.days+" d":""}`; }
  function renderTiles(d){ const t=d.tiles||{}; const K_=d.kinds||{}; const act24=Object.values(K_).reduce((a,k)=>a+Number(k.activated_24h||0),0);
    document.getElementById("fgTiles").innerHTML=[
      [`Activated · needs an INC`,n0(t.activated_no_inc),`of ${n0(t.activated)} activated through a non-approved flow`,Number(t.activated_no_inc)?"hot":"ok"],
      [`Activated in 24 h`,n0(act24),`the P3 rules fire on these`,act24?"hot":"ok"],
      [`Open attempts`,n0(t.open),`not activated — the checkout held; expire with the reservation`,Number(t.open)?"warn":"ok"],
      [`Orders · 7 d / 30 d`,`${n0(t.orders_7d)}<small>/ ${n0(t.orders_30d)}</small>`,`findings by order date, all kinds`,"blue"],
      [`Vanity fees at stake`,`${sar(t.vanity_sar)}<small>SAR</small>`,`activated vanity numbers on prepaid plans (Apollo catalog prices)`,Number(t.vanity_sar)?"hot":"ok"],
      [`Plan timeline since`,d.history_since?ksaD(d.history_since):"—",`${n0((d.plan_changes||[]).length)} change(s) recorded · ${n0((d.disabled_plans||[]).length)} plan(s) disabled now`,"blue"]
    ].map(([l,v,s,c])=>`<div class="fg-tile ${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join(""); }
  function renderTabs(){ const t=(S.data&&S.data.tiles)||{}; const tabs=[["findings","Findings",Number(t.activated_no_inc||0)+Number(t.open||0),Number(t.activated_no_inc)>0],["plans","Plan catalog",(S.data&&S.data.disabled_plans||[]).length,false],["detectors","Detectors & settings",0,false]];
    document.getElementById("fgTabs").innerHTML=tabs.map(([k,l,n,hot])=>`<button class="fg-tab ${S.tab===k?"on":""}" data-tab="${k}">${l}${n?`<b class="${hot?"hot":""}">${n0(n)}</b>`:""}</button>`).join("");
    document.querySelectorAll("#fgTabs [data-tab]").forEach(b=>b.onclick=()=>{ S.tab=b.dataset.tab; closeDrawer(); setHash(); renderTabs(); renderPanel(); }); }
  function renderPanel(){ const host=document.getElementById("fgPanel"); if(S.tab==="findings") renderFindings(host); else if(S.tab==="plans") renderPlans(host); else renderDetectors(host); }

  /* ---- Findings ---- */
  function renderFindings(host){ const K_=K();
    host.innerHTML=`<div class="fg-wrap">
      <div class="fg-kinds">${Object.entries(K_).map(([k,x])=>`<div class="fg-kind ${S.kind===k?"on":""}" data-kind="${k}"><b><span class="fg-sev">${esc(x.severity)}</span>${esc(x.label)}</b><div class="n ${Number(x.activated)?"hot":""}">${n0(x.activated)}<small>activated · ${n0(x.open)} open · ${n0(x.activated_24h)} in 24 h</small></div><div class="why">${esc(x.why)}</div></div>`).join("")}</div>
      <div class="fg-tools"><span class="fg-chip ${S.status==="active"?"on hot":""}" data-st="active">Activated + open</span><span class="fg-chip ${S.status==="activated"?"on hot":""}" data-st="activated">Activated</span><span class="fg-chip ${S.status==="open"?"on":""}" data-st="open">Open attempts</span><span class="fg-chip ${S.status==="resolved"?"on":""}" data-st="resolved">Resolved</span><span class="fg-chip ${S.status==="dismissed"?"on":""}" data-st="dismissed">Dismissed</span><span class="fg-chip ${S.status==="expired"?"on":""}" data-st="expired">Expired</span><span class="fg-chip ${S.status==="all"?"on":""}" data-st="all">All</span>
        <select class="fg-in" id="fgDays"><option value="7" ${S.days===7?"selected":""}>7 days</option><option value="30" ${S.days===30?"selected":""}>30 days</option><option value="90" ${S.days===90?"selected":""}>90 days</option><option value="365" ${S.days===365?"selected":""}>1 year</option></select>
        <input class="fg-in" id="fgQ" placeholder="checkout code · order id · plan · INC · last 3 digits" value="${esc(S.q)}"><span class="cnt" id="fgCnt"></span></div>
      <div id="fgRows"><div class="fg-empty">loading…</div></div></div>`;
    host.querySelectorAll("[data-kind]").forEach(el=>el.onclick=()=>{ S.kind=S.kind===el.dataset.kind?"":el.dataset.kind; setHash(); renderFindings(host); loadRows(); });
    host.querySelectorAll("[data-st]").forEach(el=>el.onclick=()=>{ S.status=el.dataset.st; setHash(); renderFindings(host); loadRows(); });
    host.querySelector("#fgDays").onchange=e=>{ S.days=Number(e.target.value); loadRows(); };
    let t; host.querySelector("#fgQ").oninput=e=>{ clearTimeout(t); t=setTimeout(()=>{ S.q=e.target.value.trim(); setHash(); loadRows(); },350); };
    loadRows();
  }
  async function loadRows(){ const host=document.getElementById("fgRows"); if(!host) return;
    try{ const st=S.status==="active"?"":S.status; let rows=(await api(`/api/flowguard/findings?status=${encodeURIComponent(st||"all")}&kind=${encodeURIComponent(S.kind)}&q=${encodeURIComponent(S.q)}&days=${S.days}`)).rows||[];
      if(S.status==="active") rows=rows.filter(r=>r.status==="activated"||r.status==="open"); S.rows=rows; renderRows(); }
    catch(e){ host.innerHTML=`<div class="fg-empty">${esc(e.message)}</div>`; }
  }
  function renderRows(){ const host=document.getElementById("fgRows"); const rows=S.rows; const cnt=document.getElementById("fgCnt"); if(cnt) cnt.textContent=`${n0(rows.length)} finding(s)`;
    if(!rows.length){ host.innerHTML=`<div class="fg-empty">Nothing here — ${S.status==="active"?"no activated order and no open attempt":"no finding with this status"} for ${S.kind?kindLabel(S.kind).toLowerCase():"any kind"} in the last ${S.days} days.<br>The detectors run every 15 min; "Run detectors now" scans immediately.</div>`; return; }
    host.innerHTML=`<table class="fg"><thead><tr><th>Order (KSA)</th><th>Kind</th><th>Status</th><th>Checkout · order</th><th>Number</th><th>Plan</th><th class="num">SAR</th><th>Evidence</th><th>INC</th><th></th></tr></thead><tbody>
      ${rows.map(r=>`<tr class="${esc(r.status)}"><td data-l="Order">${ksa(r.event_at)}<div class="fg-note">${age(r.event_at)} ago${r.activated_at?" · activated "+ksa(r.activated_at):""}</div></td><td data-l="Kind"><b>${esc(kindShort(r.kind))}</b></td><td data-l="Status"><span class="fg-st ${esc(r.status)}">${esc(STATUS_L[r.status]||r.status)}</span></td>
        <td data-l="Checkout · order"><b>${esc(r.checkout_id||"—")}</b><div class="fg-note">${esc(r.order_id||"")}</div></td><td data-l="Number">${esc(r.number_masked||"—")} ${clsChip(r)}</td><td data-l="Plan">${esc(r.plan_name||r.plan_id)}<div class="fg-note">${typeL(r.plan_type)} · ${r.plan_enabled?"enabled":"disabled"}${r.disabled_since?" since "+ksaD(r.disabled_since):""}</div></td>
        <td class="num" data-l="SAR">${r.amount!=null?sar(r.amount):"—"}</td><td data-l="Evidence">${evChips(r.evidence,4)}${r.note?`<div class="fg-note">${esc(r.note)}</div>`:""}</td><td data-l="INC">${r.inc?`<b>${esc(r.inc)}</b>`:"—"}</td>
        <td data-l="Actions"><div class="fg-act"><button class="fg-btn sm" data-act="open" data-id="${r.id}">Details</button><button class="fg-btn sm" data-act="c360" data-key="${esc(r.order_id||"")}">Customer 360</button>${canAct()&&(r.status==="activated"||r.status==="open")?`<button class="fg-btn sm p" data-act="set" data-id="${r.id}" data-status="resolved">Resolve · INC</button><button class="fg-btn sm" data-act="set" data-id="${r.id}" data-status="dismissed">Dismiss</button>`:""}${canAct()&&(r.status==="dismissed"||r.status==="resolved")?`<button class="fg-btn sm" data-act="set" data-id="${r.id}" data-status="open">Reopen</button>`:""}</div></td></tr>`).join("")}</tbody></table>`; }
  const findRow=id=>S.rows.find(r=>String(r.id)===String(id));
  function openRow(id){ const r=findRow(id); if(!r) return; const x=K()[r.kind]||{}; const e=r.evidence||{};
    drawer(`<div class="hd"><h3>${esc(kindLabel(r.kind))} · ${esc(r.checkout_id||r.order_id)}</h3><button class="fg-btn" data-act="c360" data-key="${esc(r.order_id||"")}">Customer 360</button><button class="fg-btn" data-act="close">✕</button></div>
      <div class="bd"><div class="kv"><div>Status</div><div><span class="fg-st ${esc(r.status)}">${esc(STATUS_L[r.status]||r.status)}</span>${r.activated_at?" · activated "+ksa(r.activated_at):""}</div><div>Order placed</div><div>${ksa(r.event_at)} · ${esc(e.platform||"platform unknown")}${e.port_in?" · port-in":""}</div>
        <div>Number</div><div>${esc(r.number_masked)} ${clsChip(r)}<div class="fg-note">reservation ${esc(e.reservation_id||"—")} · reserved ${ksa(e.number_reserved_at)} · until ${ksaD(r.reservation_expires)}</div></div>
        <div>Plan</div><div><b>${esc(r.plan_name)}</b> · ${typeL(r.plan_type)} · ${esc(e.plan_price!=null?e.plan_price+" SAR":"")} · ref ${esc(e.plan_ref||"—")}<div class="fg-note">${r.plan_enabled?"enabled now":"disabled now"}${r.disabled_since?` · disabled since ${ksa(r.disabled_since)} (${esc(r.disabled_source||"")})${e.hours_after_disable!=null?" · order came "+e.hours_after_disable+" h after":""}`:""}</div></div>
        ${r.amount!=null?`<div>At stake</div><div><b>${sar(r.amount)} SAR</b>${e.vanity_price_sar!=null?" · vanity fee (Apollo catalog)":""}</div>`:""}
        ${e.mismatch?`<div>Mismatch</div><div>${esc(e.mismatch)}</div>`:""}
        <div>Why it counts</div><div>${esc(x.why||"")}</div><div>What to do</div><div>${esc(x.action||"")}</div>
        <div>Detected</div><div>${ksa(r.detected_at)} · last seen ${ksa(r.last_seen_at)}</div>${r.inc||r.note?`<div>INC · note</div><div>${r.inc?"<b>"+esc(r.inc)+"</b> ":""}${esc(r.note||"")}${r.updated_by?`<div class="fg-note">by ${esc(r.updated_by)} · ${ksa(r.updated_at)}</div>`:""}</div>`:""}</div>
        <div class="fg-card"><h4>Evidence <span>as read on the replica</span></h4>${evChips(e,20)}</div>
        ${canAct()?`<div class="fg-act" style="margin-top:12px">${r.status==="activated"||r.status==="open"?`<button class="fg-btn p" data-act="set" data-id="${r.id}" data-status="resolved">Resolve with INC</button><button class="fg-btn" data-act="set" data-id="${r.id}" data-status="dismissed">Dismiss</button>`:`<button class="fg-btn" data-act="set" data-id="${r.id}" data-status="open">Reopen</button>`}</div>`:""}
      </div>`); }
  function openSet(id,status){ const r=findRow(id); if(!r) return;
    drawer(`<div class="hd"><h3>${esc(STATUS_L[status]||status)} · ${esc(r.checkout_id||r.order_id)}</h3><button class="fg-btn" data-act="close">✕</button></div><div class="bd"><div class="kv"><div>Kind</div><div>${esc(kindLabel(r.kind))}</div><div>Number · plan</div><div>${esc(r.number_masked)} ${clsChip(r)} · ${esc(r.plan_name)} (${typeL(r.plan_type)})</div></div>
      <div class="fg-form"><input id="fgInc" placeholder="INC number (e.g. INC0029427)" value="${esc(r.inc||"")}"><textarea id="fgNote" rows="3" placeholder="note — the decision (kept / converted / charged), who took it, or why dismissed">${esc(r.note||"")}</textarea><div><button class="fg-btn p" id="fgSave">Save as ${esc(STATUS_L[status]||status)}</button></div></div></div>`);
    document.getElementById("fgSave").addEventListener("click",async()=>{ try{ await api(`/api/flowguard/${id}/status`,{method:"POST",body:JSON.stringify({status,inc:document.getElementById("fgInc").value.trim(),note:document.getElementById("fgNote").value.trim()})}); closeDrawer(); await load(); }catch(e){ toast(e.message);} });
  }

  /* ---- Plan catalog ---- */
  async function renderPlans(host){ host.innerHTML=`<div class="fg-empty">loading the plan catalog…</div>`;
    try{ if(!S.plans) S.plans=(await api("/api/flowguard/plans")).plans||[]; }catch(e){ host.innerHTML=`<div class="fg-empty">${esc(e.message)}</div>`; return; }
    const d=S.data||{}; const st=d.settings||{};
    const rows=S.plans.filter(p=>S.planFilter==="all"||(S.planFilter==="disabled"&&!p.enabled)||(S.planFilter==="changed"&&p.history.some(h=>!h.first))||(S.planFilter==="allowed"&&p.allowed)||(S.planFilter==="findings"&&p.findings)).filter(p=>!S.planQ||String(p.name||"").toLowerCase().includes(S.planQ.toLowerCase())||String(p.id)===S.planQ||String(p.ref||"")===S.planQ);
    host.innerHTML=`<div class="fg-wrap">
      <div class="fg-warn">The timeline starts with the first scan (${d.history_since?ksaD(d.history_since):"not yet"}) and records every change of <b>enabled</b>, price, billing type and name from then on. Before that date "disabled at order time" is judged against the plan's <code>updated_at</code> and the evidence says so. Plans sold through their own flow while hidden from the public catalog are <b>allow-listed</b> (Detectors & settings) and never counted: ${esc((st.allow_patterns||[]).join(" · ")||"none")}${(st.allow_plan_ids||[]).length?" · ids "+esc(st.allow_plan_ids.join(", ")):""}.</div>
      <div class="fg-tools">${[["all","All"],["disabled","Disabled now"],["changed","Changed"],["allowed","Allow-listed"],["findings","With findings"]].map(([k,l])=>`<span class="fg-chip ${S.planFilter===k?"on":""}" data-pf="${k}">${l}</span>`).join("")}<input class="fg-in" id="fgPlanQ" placeholder="plan name · id · Optiva ref" value="${esc(S.planQ)}"><span class="cnt">${n0(rows.length)} of ${n0(S.plans.length)} plans</span></div>
      <table class="fg"><thead><tr><th>Plan</th><th>Type</th><th class="num">Price</th><th>State</th><th>Timeline</th><th class="num">Findings</th></tr></thead><tbody>
      ${rows.map(p=>`<tr class="${p.enabled?"":"disabled"}"><td data-l="Plan"><b>${esc(p.name||"—")}</b><div class="fg-note">id ${esc(p.id)} · ref ${esc(p.ref||"—")}${p.data_plan?" · data SIM / MBB":""}</div></td><td data-l="Type">${typeL(p.plan_type)}</td><td class="num" data-l="Price">${p.price!=null?sar(p.price):"—"}</td>
        <td data-l="State"><span class="fg-st ${p.enabled?"enabled":"disabled"}">${p.enabled?"enabled":"disabled"}</span>${p.allowed?` <span class="fg-st allowed" title="sold through a dedicated flow — never counted">allow-listed</span>`:""}<div class="fg-note">updated ${ksaD(p.updated_at)}</div></td>
        <td data-l="Timeline"><div class="fg-hist">${p.history.length?p.history.slice(0,5).map(h=>`${ksaD(h.seen_at)} · ${h.first?"first seen · "+(h.enabled?"enabled":"disabled"):Object.entries(h.changed||{}).map(([k,v])=>`<b>${esc(k)}</b> ${esc(Array.isArray(v)?v[0]+" → "+v[1]:v)}`).join(", ")}`).join("<br>"):"—"}</div></td>
        <td class="num" data-l="Findings">${p.findings?`${n0(p.findings)}${p.findings_activated?` <span class="fg-st activated">${n0(p.findings_activated)} act.</span>`:""}`:"—"}</td></tr>`).join("")}</tbody></table></div>`;
    host.querySelectorAll("[data-pf]").forEach(el=>el.onclick=()=>{ S.planFilter=el.dataset.pf; renderPlans(host); });
    let t; host.querySelector("#fgPlanQ").oninput=e=>{ clearTimeout(t); t=setTimeout(()=>{ S.planQ=e.target.value.trim(); renderPlans(host); },300); };
  }

  /* ---- Detectors & settings ---- */
  function renderDetectors(host){ const d=S.data||{}; const st=d.settings||{}; const K_=K();
    host.innerHTML=`<div class="fg-wrap"><div class="fg-grid2">
      <div class="fg-card"><h4>Detectors <span>one bounded query per run · the replica only · no customer identifier stored (numbers masked to the last three digits)</span></h4>
        <div class="fg-def">${Object.entries(K_).map(([k,x])=>`<div>${esc(x.short)}</div><div><b>${esc(x.label)}</b> · rule ${esc(x.severity)} on activation · ${n0(x.activated)} activated, ${n0(x.open)} open, ${n0(x.expired)} expired, ${n0(x.dismissed)} dismissed<div class="fg-note">${esc(x.why)}</div></div>`).join("")}
          <div>Classes</div><div>${Object.entries(d.classes||{}).map(([g,c])=>`<span class="fg-cls" style="background:${esc(c.color)}">${esc(c.label)} · ${g}${c.price?" · "+sar(c.price)+" SAR":""}</span>`).join(" ")}<div class="fg-note">numbers.group_id = the Apollo vanity id = the BSS msisdn group (the DMS dealer app uses the same numbering)</div></div>
          <div>Schedule</div><div>every ${esc(d.cfg&&d.cfg.intervalMin)} min · window ${esc(d.cfg&&d.cfg.lookbackDays)} days · backfill ${esc(d.cfg&&d.cfg.backfillDays)} days on the first run · FLOW_GUARD=0 disables</div>
          <div>Rules</div><div>onboarding_flow_vanity_prepaid (P3) · _attempts (P4) · onboarding_flow_plan_disabled (P3) · _attempts (P4) · onboarding_flow_class_mismatch (P3) — owner Mobile digital L2 (TCS); Agent 2 writes the triage note from the finding, Agent 1 reports the 24 h picture. <a href="#alerts?tab=rules">Alert rules</a></div></div></div>
      <div class="fg-card"><h4>Runs <span>last 12</span></h4>${(d.runs||[]).length?`<table class="fg"><thead><tr><th>At (KSA)</th><th class="num">ms</th><th class="num">Scanned</th><th class="num">Found</th><th class="num">New</th><th class="num">Activated</th><th class="num">Expired</th><th class="num">Plan Δ</th></tr></thead><tbody>${d.runs.map(r=>`<tr><td data-l="At">${ksa(r.at)}${r.backfill?" · backfill":""}${r.errors&&Object.keys(r.errors).length?` <span class="fg-st activated">error</span>`:""}</td><td class="num" data-l="ms">${n0(r.ms)}</td><td class="num" data-l="Scanned">${n0(r.scanned)}</td><td class="num" data-l="Found">${n0(r.found)}</td><td class="num" data-l="New">${n0(r.new_rows)}</td><td class="num" data-l="Activated">${n0(r.activated)}</td><td class="num" data-l="Expired">${n0(r.expired)}</td><td class="num" data-l="Plan changes">${n0(r.plan_changes)}</td></tr>`).join("")}</tbody></table>`:`<div class="fg-empty">no run recorded yet</div>`}</div></div>
      <div class="fg-card"><h4>Allow-list <span>plans sold through a dedicated flow while hidden from the public catalog — never counted as "disabled plan"</span></h4>
        <div class="fg-pol"><label>Name patterns (comma-separated, case-insensitive)<textarea id="fgPat" rows="2" ${canManage()?"":"disabled"}>${esc((st.allow_patterns||[]).join(", "))}</textarea></label><label>Plan ids (comma-separated)<input id="fgIds" ${canManage()?"":"disabled"} value="${esc((st.allow_plan_ids||[]).join(", "))}"></label><label>Note<input id="fgNoteS" ${canManage()?"":"disabled"} value="${esc(st.note||"")}"></label></div>
        <div class="fg-act" style="margin-top:10px">${canManage()?`<button class="fg-btn p" id="fgSaveS">Save allow-list</button>`:`<span class="fg-note">manageSync is needed to edit</span>`}${st.updated_by?`<span class="fg-note">last change by ${esc(st.updated_by)} · ${ksa(st.updated_at)}</span>`:""}</div>
        <div class="fg-note" style="margin-top:8px">Disabled now and still receiving orders: ${(d.disabled_plans||[]).length?d.disabled_plans.slice(0,14).map(p=>`<b>${esc(p.name)}</b>${p.allowed?" (allow-listed)":""}`).join(" · "):"none recorded yet"}.</div></div></div>`;
    const b=host.querySelector("#fgSaveS"); if(b) b.onclick=async()=>{ try{ await api("/api/flowguard/settings",{method:"POST",body:JSON.stringify({allow_patterns:host.querySelector("#fgPat").value,allow_plan_ids:host.querySelector("#fgIds").value.split(/[,\s]+/).filter(Boolean),note:host.querySelector("#fgNoteS").value})}); S.plans=null; toast("Allow-list saved — applied on the next scan"); await load(); }catch(e){ toast(e.message); } };
  }

  /* ------------------------------------------------------------------ load */
  async function load(){ try{ S.data=await api("/api/flowguard/overview"); renderLive(S.data); renderTiles(S.data); renderTabs(); renderPanel(); }
    catch(e){ document.getElementById("fgTiles").innerHTML=`<div class="fg-empty">${esc(e.message)}</div>`; } }
  window.openFlowGuard=function(qs){
    ensureView();
    const src=qs||location.hash; const P=k=>{ const m=new RegExp("(?:^|[?&])"+k+"=([^&]+)").exec(src); return m?decodeURIComponent(m[1]):""; };
    if(/^(findings|plans|detectors)$/.test(P("tab"))) S.tab=P("tab"); if(/^[a-z_]+$/.test(P("kind"))) S.kind=P("kind"); if(/^(active|activated|open|resolved|dismissed|expired|all)$/.test(P("status"))) S.status=P("status"); if(P("q")) S.q=P("q");
    if(document.getElementById("fgDrawer")) closeDrawer();
    setHash(); load();
    if(S.timer) clearInterval(S.timer);
    S.timer=setInterval(()=>{ const v=document.getElementById("view-flowguard"); if(!v||!v.classList.contains("active")){ clearInterval(S.timer); S.timer=null; return; } if(document.visibilityState==="visible"&&!document.getElementById("fgDrawer").classList.contains("on")) load(); },120000);
  };
})();
