/* Fixed / Salam Home — dedicated tab (nav: after DMS). Stage 1 of the unified console: every number
 * on this page is read from the Operations Console read model (sda_ops.beta, kept fresh by the
 * dealer-ops watcher on 152) through /api/fixed/*. Same definitions as /operations-console-beta.
 * Sections: freshness strip · KPIs · outcome mix · by workflow · by channel · integrations (Nafath /
 * Manafith) · regions · top dealers · error categories · Salam Home app (B2C) · recent attempts + find. */
(function(){
  "use strict";
  /* HUB CONTRACT — every Fixed sub-page is its own file (fixed-<key>.js) that registers
   *   window.FIXED_PAGES[key] = { label, sub, render(hostEl, ctx) }      (render is idempotent; ctx = window.FX)
   * and gets its data from /api/fixed/<key>/... (server: server/src/fixed<Key>.js mounted by fixed.js).
   * Shared helpers live on window.FX (api, esc, ts, fmt, tbl, card, chip, bar, state, qs). Keys and order below. */
  const TAB_ORDER=[["overview","Operations Dashboard","KPIs · funnel · dealers · SLOs · trends · alerts"],
    /* the two pages the Fixed Operations agent used to generate as static HTML — live since 12 Sep 2026 */
    ["exec","Executive","north-star KPIs · SLOs · top issues"],["ops","Operations","health · trends · pipeline · alerts"],["epurchase","Epurchase","web / QR channel · journeys · payments · findings"],["salamhome","Salam Home","app channel · buy + manage-line · payments · findings"],["epwatch","Payments watch","5G e-purchase · stock locks · card holds · webhooks"],["map","SDA map","dealers · pins · trace"],["qr","QR codes","referral orders · consent"],
    ["dash","Reports","KPIs · trends · dealers & QR"],["errors","Troubleshoot","error control board · live failures"],["alerts","Alerts","rules · history"],
    /* OCU · restricted (alpha.166): customers who did not finish an FTTH / 5G purchase — own view fixed_leads, OCU + Super Admin only */
    ["leads","Leads","OCU retention desk · restricted"],
    ["playbook","Playbook","SLA / OLA / action plans"],["diagrams","Diagrams","payments · journeys"],["alertjourney","Alert journey","trigger → history · clocks · credits"],
    /* own pages since 11 Sep 2026 — they used to be cards inside Diagrams */
    ["bsstopo","Topology","digital / BSS HLD — channels → 3Scale/OSB → Oracle BSS"],["journeys","Journeys","every dealer & QR journey, step by step"],
    ["report","KPI digest","branded e-mail report"]];
  window.FIXED_PAGES = window.FIXED_PAGES || {};
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const SES={ email:localStorage.getItem("cons_email")||"", role:localStorage.getItem("cons_role")||"report_manager" };
  const fmt=n=>Number(n||0).toLocaleString("en-US");
  const KSA=3*3600e3;
  const ts=(v,secs)=>{ if(!v) return "—"; const d=new Date(v); if(isNaN(d)) return esc(v);
    const s=new Date(d.getTime()+KSA).toISOString().replace("T"," "); return (secs?s.slice(0,19):s.slice(0,16)); };
  async function api(path,opts){
    const r=await fetch((window.API_BASE||window.CONSOLE_BASE||"")+path,{...(opts||{}),headers:{"Content-Type":"application/json","X-Console-Role":SES.role,"X-Console-User":SES.email,...((opts&&opts.headers)||{})}});
    const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j;
  }
  // The hub carries no filters (Yosri, 6 Sep): channel is always "All" — pages that need one (Errors, Reports) own it —
  // and the range is chosen inside the page that uses it via fx.rangeChips()/fx.bindRange().
  /* RANGE CONTROL (TKT-000064, 24 Sep 2026) — one control for every Fixed page: quick presets from the last 5 minutes to
   * 90 days plus a custom start / end (KSA). The window is carried as range=<key> or range=custom&from=&to= (ISO UTC), which
   * fixed360.parseScope already understands, so every /api/fixed endpoint follows it; the chosen window is kept in
   * localStorage (fixed_range / fixed_from / fixed_to) and in deep links (#fixed?tab=map&range=custom&from=…&to=…). */
  const RANGES=[["5m","5 min"],["15m","15 min"],["30m","30 min"],["1h","1 h"],["6h","6 h"],["24h","24 h"],["7d","7 d"],["30d","30 d"],["90d","90 d"]];
  const RANGE_MIN={"5m":5,"15m":15,"30m":30,"1h":60,"6h":360,"24h":1440,"7d":10080,"30d":43200,"90d":129600};
  const state={ range:localStorage.getItem("fixed_range")||"7d", from:localStorage.getItem("fixed_from")||"", to:localStorage.getItem("fixed_to")||"", channel:"", find:"", outcome:"" };
  if(state.range!=="custom"&&!RANGE_MIN[state.range]) state.range="7d";
  if(state.range==="custom"&&!(state.from&&state.to)) state.range="7d";
  try{ localStorage.removeItem("fixed_channel"); }catch(e){}
  const KSA_MS=3*3600e3;
  const isoToKsaLocal=iso=>{ const d=new Date(iso); if(isNaN(d)) return ""; return new Date(d.getTime()+KSA_MS).toISOString().slice(0,16); };   // for <input type=datetime-local>, shown as KSA
  const ksaLocalToIso=v=>{ if(!v) return ""; const d=new Date(v+":00+03:00"); return isNaN(d)?"":d.toISOString(); };
  const fmtKsa=iso=>{ const d=new Date(iso); if(isNaN(d)) return "—"; const s=new Date(d.getTime()+KSA_MS).toISOString(); return s.slice(5,10).replace("-","/")+" "+s.slice(11,16); };
  const windowOf=()=>{ const now=Date.now(); if(state.range==="custom") return { from:new Date(state.from), to:new Date(state.to) }; const m=RANGE_MIN[state.range]||10080; return { from:new Date(now-m*60000), to:new Date(now) }; };
  const windowLabel=()=>{ const w=windowOf(); const mins=Math.round((w.to-w.from)/60000); const len=mins<60?`${mins} min`:mins<1440?`${Math.round(mins/60*10)/10} h`:`${Math.round(mins/1440*10)/10} d`; return `${fmtKsa(w.from)} → ${fmtKsa(w.to)} KSA · ${len}${state.range==="custom"?"":" · live"}`; };
  const rangeChips=(label="Range")=>{
    const on=k=>state.range===k;
    const btn=(k,l)=>`<button type="button" class="fx-r${on(k)?" on":""}" data-m="${k}" style="cursor:pointer;font:inherit;font-size:11.5px;font-weight:700;padding:5px 11px;border:1px solid ${on(k)?"var(--green,#0e9f5a)":"var(--line)"};border-radius:999px;background:${on(k)?"var(--green,#0e9f5a)":"var(--card,#fff)"};color:${on(k)?"#fff":"inherit"};transition:transform .14s,box-shadow .14s,border-color .14s">${l}</button>`;
    const w=windowOf();
    return `<div class="fx-range" style="display:flex;flex-direction:column;gap:6px;min-width:0">
      ${label?`<span class="rl" style="font-size:10.5px;color:var(--muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase">${label}</span>`:""}
      <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">${RANGES.map(([m,l])=>btn(m,l)).join("")}${btn("custom","🗓 Custom")}</div>
      <div class="fx-rcustom" ${on("custom")?"":"hidden"} style="display:${on("custom")?"grid":"none"};grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px 8px;align-items:end;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card2,rgba(148,163,184,.08))">
        <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">From · KSA<input type="datetime-local" class="fx-rfrom" step="60" value="${isoToKsaLocal(state.from||w.from.toISOString())}" style="display:block;width:100%;margin-top:3px;font:inherit;font-size:12px;padding:5px 7px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:var(--ink);box-sizing:border-box"></label>
        <label style="display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">To · KSA<input type="datetime-local" class="fx-rto" step="60" value="${isoToKsaLocal(state.to||w.to.toISOString())}" style="display:block;width:100%;margin-top:3px;font:inherit;font-size:12px;padding:5px 7px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:var(--ink);box-sizing:border-box"></label>
        <div style="display:flex;gap:5px;flex-wrap:wrap;grid-column:1/-1;align-items:center">
          ${[["today","Today"],["yesterday","Yesterday"],["week","This week"],["month","This month"]].map(([k,l])=>`<button type="button" class="fx-rq" data-q="${k}" style="cursor:pointer;font:inherit;font-size:10.5px;font-weight:700;padding:3px 9px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink)">${l}</button>`).join("")}
          <button type="button" class="fx-rapply" style="margin-left:auto;cursor:pointer;font:inherit;font-size:11.5px;font-weight:800;padding:5px 12px;border:1px solid var(--green,#0e9f5a);border-radius:999px;background:var(--green,#0e9f5a);color:#fff">Apply</button>
        </div>
        <div class="fx-rerr rl" style="grid-column:1/-1;font-size:10.5px;color:#dc2626;display:none"></div>
      </div>
      <div class="fx-rwin rl" style="font-size:10.5px;color:var(--muted);font-family:var(--mono,ui-monospace,monospace)">${windowLabel()}</div>
    </div>`;
  };
  const saveRange=()=>{ try{ localStorage.setItem("fixed_range",state.range); localStorage.setItem("fixed_from",state.from||""); localStorage.setItem("fixed_to",state.to||""); }catch(e){} };
  const bindRange=(root,onChange)=>{
    const R=root||document; const fire=()=>{ saveRange(); if(onChange) onChange(state.range); else render(curTab); };
    R.querySelectorAll(".fx-r").forEach(b=>b.onclick=()=>{
      const k=b.dataset.m;
      if(k==="custom"){ const box=R.querySelector(".fx-rcustom"); if(box){ box.hidden=false; box.style.display="grid"; } R.querySelectorAll(".fx-r").forEach(x=>{ const on=x.dataset.m==="custom"; x.classList.toggle("on",on); x.style.background=on?"var(--green,#0e9f5a)":"var(--card,#fff)"; x.style.color=on?"#fff":"inherit"; x.style.borderColor=on?"var(--green,#0e9f5a)":"var(--line)"; }); const f=R.querySelector(".fx-rfrom"); if(f) f.focus(); return; }
      state.range=k; state.from=""; state.to=""; fire();
    });
    const err=m=>{ const e=R.querySelector(".fx-rerr"); if(e){ e.textContent=m||""; e.style.display=m?"block":"none"; } };
    const apply=()=>{
      const f=R.querySelector(".fx-rfrom"), t=R.querySelector(".fx-rto"); if(!f||!t) return;
      const from=ksaLocalToIso(f.value), to=ksaLocalToIso(t.value);
      if(!from||!to) return err("Pick both a start and an end.");
      if(new Date(to)<=new Date(from)) return err("End must be after start.");
      if(new Date(to)-new Date(from)>92*86400e3) return err("Windows are limited to 92 days — use the reports export for longer.");
      if(new Date(to)>Date.now()+60000) return err("End cannot be in the future.");
      err(""); state.range="custom"; state.from=from; state.to=to; fire();
    };
    const ap=R.querySelector(".fx-rapply"); if(ap) ap.onclick=apply;
    R.querySelectorAll(".fx-rfrom,.fx-rto").forEach(i=>i.addEventListener("keydown",e=>{ if(e.key==="Enter") apply(); }));
    R.querySelectorAll(".fx-rq").forEach(b=>b.onclick=()=>{
      const now=new Date(Date.now()+KSA_MS); const y=now.getUTCFullYear(), mo=now.getUTCMonth(), d=now.getUTCDate(), dow=(now.getUTCDay()+1)%7;   // KSA week starts Sunday
      let a,z; const q=b.dataset.q;
      if(q==="today"){ a=Date.UTC(y,mo,d); z=Date.now()+KSA_MS; }
      else if(q==="yesterday"){ a=Date.UTC(y,mo,d-1); z=Date.UTC(y,mo,d); }
      else if(q==="week"){ a=Date.UTC(y,mo,d-dow); z=Date.now()+KSA_MS; }
      else { a=Date.UTC(y,mo,1); z=Date.now()+KSA_MS; }
      const f=R.querySelector(".fx-rfrom"), t=R.querySelector(".fx-rto"); if(f) f.value=new Date(a).toISOString().slice(0,16); if(t) t.value=new Date(z).toISOString().slice(0,16); apply();
    });
  };
  const qs=()=>`range=${encodeURIComponent(state.range)}${state.range==="custom"?`&from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}`:""}${state.channel?`&channel=${state.channel}`:""}`;
  const rangeQs=()=>qs().replace(/&channel=[^&]*/,"");
  function applyRouteQuery(){
    try{
      const raw=(location.hash.split("?")[1]||""); if(!raw) return;
      const P=new URLSearchParams(raw), range=P.get("range");
      if(/(?:^|&)(range|find|outcome|channel)=/.test(raw)){ state.find=""; state.outcome=""; state.channel=""; }
      if(range==="custom"&&P.get("from")&&P.get("to")){ state.range="custom"; state.from=P.get("from"); state.to=P.get("to"); saveRange(); }
      else if(range&&RANGE_MIN[range]){ state.range=range; state.from=""; state.to=""; saveRange(); }
      if(P.has("find")) state.find=P.get("find")||"";
      if(P.has("outcome")) state.outcome=P.get("outcome")||"";
      if(P.has("channel")) state.channel=P.get("channel")||"";
    }catch(e){}
  }

  const OUT_COLOR={COMPLETED:"var(--green,#0e9f5a)",STALLED:"#d97706",CANCELLED:"#dc2626",EXPIRED:"#64748b",IN_PROGRESS:"#2563eb"};
  const chip=(l,v,c,sub)=>`<div class="stat" style="min-width:130px"><b style="${c?`color:${c}`:""}">${v}</b><span>${esc(l)}</span>${sub?`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:3px">${sub}</div>`:""}</div>`;
  const bar=(n,max,color)=>`<div style="height:6px;border-radius:4px;background:var(--line);overflow:hidden;min-width:80px"><div style="width:${max?Math.round(100*n/max):0}%;height:100%;background:${color||"var(--green,#0e9f5a)"}"></div></div>`;
  const card=(title,body,sub)=>`<div class="topo-card" style="padding:14px 16px"><div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px"><h3 style="margin:0;font-size:13.5px">${title}</h3>${sub?`<span class="rl" style="font-size:10.5px;color:var(--muted)">${sub}</span>`:""}</div>${body}</div>`;
  const tbl=(head,rows)=>`<div class="tblwrap"><table class="mono" style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr>${head.map(h=>`<th style="text-align:left;padding:4px 6px;color:var(--muted);font-weight:700;font-size:10px;letter-spacing:.6px;border-bottom:1px solid var(--line)">${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td style="padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top">${c}</td>`).join("")}</tr>`).join("")||`<tr><td colspan="${head.length}" style="padding:10px;color:var(--muted)">nothing in this window</td></tr>`}</tbody></table></div>`;

  async function renderOverview(host){
    host.innerHTML=`<div style="display:flex;justify-content:flex-end;margin-bottom:10px">${rangeChips()}</div><div id="fxFresh"></div>
      <div id="fxOps"></div>
      <div id="fxBody"><div style="padding:30px;text-align:center;color:var(--muted)">${window.salamLoader?window.salamLoader("Reading Fixed data…"):"Loading…"}</div></div>`;
    bindRange(host);
    try{
      const [d,b2c]=await Promise.all([api("/api/fixed/summary?"+qs()), api("/api/fixed/b2c?range="+state.range).catch(()=>null)]);
      drawFresh(d.freshness,d.source);
      drawBody(d,b2c);
      return true;
    }catch(e){
      $("#fxBody").innerHTML=`<div class="albanner" style="border-left:4px solid #dc2626;padding:14px 16px"><b>Fixed data unavailable</b> — ${esc(e.message)}<div class="rl" style="font-size:11px;color:var(--muted);margin-top:4px">Set OPS_DATABASE_URL (sda_ops) and restart. /api/fixed/ping shows each source.</div></div>`;
      return false;
    }
  }
  /* Operations Dashboard (12 Sep 2026): the old Overview plus the ops half that used to be its own
   * "Operations" page — SLOs, day trends, the stop-step pipeline and alerts, each shown once.
   * Laid out like Mobile › Operations Dashboard: status header + SLO compliance LEAD the page
   * (that is what someone opening it needs first), the heavy analytics follow the page's own KPIs. */
  window.FIXED_PAGES.overview={ label:"Operations Dashboard", sub:"KPIs · funnel · dealers · SLOs · trends · alerts",
    render:async (host,fx)=>{
      const p=renderOverview(host,fx);
      /* #fxOps exists as soon as renderOverview has painted its shell (synchronously, before its
       * first await), so the status header + SLOs load in parallel with the Fixed summary instead
       * of waiting for it. */
      const top=$("#fxOps"); if(top && window.execopsFixedTop) window.execopsFixedTop(top);
      const ok=await p;
      if(window.execopsFixedBottom){ const b=document.createElement("div"); b.className="xo-block"; host.appendChild(b); window.execopsFixedBottom(b); }
      if(ok){ appendAttemptsCard(host); await loadAttempts(); }
    }
  };

  /* ---- HUB ---- */
  let curTab="overview";
  async function render(tab){
    const host=$("#view-fixed"); if(!host) return;
    applyRouteQuery();
    if(tab && window.FIXED_PAGES[tab]) curTab=tab; else if(tab && !window.FIXED_PAGES[tab]) curTab="overview";
    // page-level scope: a deep link to a Fixed page the role lacks falls back to the first page the role holds
    const held=window.FIXED_VIEWS_HELD, ftv=window.FIXED_TAB_VIEWS||{};
    if(held && held.length && !held.includes(ftv[curTab]||"fixed")){ const ok=TAB_ORDER.map(t=>t[0]).find(k=>window.FIXED_PAGES[k]&&held.includes(ftv[k]||"fixed")); if(ok) curTab=ok; }
    const tabs=TAB_ORDER.map(([k,l,sub])=>{ const on=k===curTab, has=!!window.FIXED_PAGES[k];
      return `<button class="fx-tab" data-t="${k}" ${has?"":"disabled"} title="${esc(sub)}${has?"":" — coming in the next drop"}" style="cursor:${has?"pointer":"default"};font:inherit;font-size:12.5px;font-weight:${on?"800":"600"};padding:7px 13px;border:1px solid ${on?"var(--green,#0e9f5a)":"var(--line)"};border-bottom:${on?"3px solid var(--green,#0e9f5a)":"1px solid var(--line)"};border-radius:10px;background:${on?"var(--card,#fff)":"transparent"};color:${has?"inherit":"var(--muted)"};opacity:${has?1:.55}">${l}</button>`; }).join("");
    const cur=TAB_ORDER.find(t=>t[0]===curTab)||TAB_ORDER[0];
    host.innerHTML=`<div class="fx-hub" style="padding:0 var(--fx-pad,18px) 40px;max-width:1440px;margin:0 auto">
      <div class="fx-hubbar" style="position:sticky;top:var(--hdr);z-index:26;background:var(--card);border-bottom:1px solid var(--line);box-shadow:0 4px 14px rgba(15,23,42,.05);margin:0 calc(-1*var(--fx-pad,18px)) 14px;padding:10px var(--fx-pad,18px);display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div><h2 style="margin:0;font-size:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span><span style="color:var(--muted);font-weight:600">Fixed ›</span> ${esc(cur[1])}</span>${curTab==="leads"?`<span title="Restricted section — every view, reveal and change is recorded" style="display:inline-flex;align-items:center;gap:6px;font-size:9.5px;font-weight:800;letter-spacing:.12em;color:#fff;background:linear-gradient(135deg,#b91c1c,#7f1d1d);border-radius:999px;padding:4px 10px 3px 8px"><i style="width:7px;height:7px;border-radius:50%;background:#fca5a5;box-shadow:0 0 0 3px rgba(252,165,165,.25)"></i>RESTRICTED · RECORDED</span>`:""}</h2>
            <div class="rl" style="font-size:10.5px;color:var(--muted)">${curTab==="leads"?`${esc(cur[2])} · FTTH · 5G · every channel — <b style="color:#b91c1c">confidential customer data: every view, reveal and change is audited</b>`:`${esc(cur[2])} · FTTH · 5G home · e-purchase / QR · Salam Home app — Operations Console data, stage 1 · other pages: <b>Fixed ▾</b> menu`}</div></div>
        </div>
      </div>
      <div id="fxPage"></div>
    </div>`;
    const page=$("#fxPage");
    try{ await window.FIXED_PAGES[curTab].render(page, window.FX); }
    catch(e){ page.innerHTML=`<div class="albanner" style="border-left:4px solid #dc2626;padding:14px 16px"><b>${esc(curTab)} failed</b> — ${esc(e.message)}</div>`; }
  }

  function drawFresh(f,src){
    if(!f) return;
    const bad=f.stale;
    $("#fxFresh").innerHTML=`<div class="albanner" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;border-left:4px solid ${bad?"#d97706":"var(--green,#0e9f5a)"};padding:9px 14px;margin-bottom:14px;font-size:12px">
      <span><b>${bad?"⚠ Data may be stale":"● Live"}</b> · source <span class="mono">${esc(src||"")}</span></span>
      <span class="rl" style="color:var(--muted)">ingest cursor <span class="mono">${ts(f.cursor_ts,true)}</span> KSA · watcher tick <span class="mono">${f.lag_min==null?"—":f.lag_min+" min ago"}</span></span>
      <span class="rl" style="color:var(--muted)">newest attempt <span class="mono">${ts(f.newest_attempt)}</span> · newest error <span class="mono">${ts(f.newest_error)}</span></span>
      <span class="rl" style="margin-left:auto;font-size:10.5px;color:var(--muted)">written by opsb-ingest-watch on 152 · read-only here · stage 1 of the convergence plan</span></div>`;
  }

  function drawBody(d,b2c){
    const k=d.kpis;
    const outMax=Math.max(1,...d.outcomes.map(o=>o.n));
    const wfMax=Math.max(1,...d.byWorkflow.map(o=>o.n));
    const dayMax=Math.max(1,...d.byDay.map(o=>o.n));
    const naf=d.integrations.nafath, man=d.integrations.manafith;
    const spark=d.byDay.length?`<div style="display:flex;align-items:flex-end;gap:2px;height:46px;margin-top:6px">${d.byDay.map(x=>`<div title="${ts(x.day).slice(0,10)} · ${fmt(x.n)} attempts · ${fmt(x.completed)} completed" style="flex:1;min-width:3px;height:${Math.max(2,Math.round(44*x.n/dayMax))}px;background:linear-gradient(180deg,var(--green,#0e9f5a) ${Math.round(100*x.completed/Math.max(1,x.n))}%,var(--line) 0)"></div>`).join("")}</div>`:"";
    $("#fxBody").innerHTML=`
      <div class="topo-stats" style="margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap">
        ${chip("ATTEMPTS",fmt(k.attempts),null,`${ts(d.window.from).slice(0,10)} → ${ts(d.window.to).slice(0,10)}`)}
        ${chip("COMPLETED",fmt(k.completed),"var(--green,#0e9f5a)",`${k.conversion}% conversion`)}
        ${chip("BSS ORDER CREATED",fmt(k.withOrder),null,`${k.attempts?Math.round(100*k.withOrder/k.attempts):0}% of attempts`)}
        ${chip("ACTIVE DEALERS",fmt(k.activeDealers),null,"distinct SDA staff")}
        ${chip("AVG TIME TO COMPLETE",k.avgDurationS?Math.round(k.avgDurationS/60)+" min":"—")}
        ${chip("NAFATH FAIL RATE",naf.total?naf.failRate+"%":"—",naf.failRate>25?"#dc2626":null,`${fmt(naf.total)} 5G checks`)}
        ${chip("MANAFITH DENIED",man.total?man.deniedRate+"%":"—",man.deniedRate>10?"#d97706":null,`${fmt(man.denied)} of ${fmt(man.total)}`)}
      </div>
      <div class="gcards">
        ${card("Outcome mix",d.outcomes.map(o=>`<div style="display:grid;grid-template-columns:110px 1fr 70px;gap:8px;align-items:center;font-size:12px;margin:4px 0"><span class="mono">${esc(o.outcome)}</span>${bar(o.n,outMax,OUT_COLOR[o.outcome])}<b style="text-align:right">${fmt(o.n)}</b></div>`).join("")+spark,"attempts per KSA day, green share = completed")}
        ${card("By journey (workflow)",d.byWorkflow.map(w=>`<div style="display:grid;grid-template-columns:1fr 90px 60px 60px;gap:8px;align-items:center;font-size:12px;margin:4px 0"><span>${esc(w.label)}</span>${bar(w.n,wfMax)}<b style="text-align:right">${fmt(w.n)}</b><span class="mono" style="text-align:right;color:${w.conversion<40?"#d97706":"var(--muted)"}">${w.conversion}%</span></div>`).join(""),"count · conversion")}
        ${card("By channel",d.byChannel.map(c=>`<div style="display:flex;justify-content:space-between;font-size:12px;margin:5px 0"><span class="mono">${esc(c.channel)}</span><span><b>${fmt(c.n)}</b> <span style="color:var(--muted)">· ${c.conversion}%</span></span></div>`).join("")+`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:8px">consumer-direct e-purchase (no referral code) excluded — same as the beta</div>`)}
        ${card("Nafath outcomes (SDA · 5G)",naf.breakdown.map(o=>`<div style="display:flex;justify-content:space-between;font-size:12px;margin:5px 0"><span class="mono">${esc(o.outcome)}</span><b>${fmt(o.n)}</b></div>`).join("")||`<div style="color:var(--muted);font-size:12px">no Nafath checks in window</div>`)}
      </div>
      <div class="gcards">
        ${card("Regions",tbl(["REGION","ATTEMPTS","COMPLETED","NAFATH FAIL","MANAFITH DENIED"],d.byRegion.map(r=>[esc(r.region),fmt(r.n),fmt(r.completed),r.nafath_failed?`<span style="color:#dc2626">${fmt(r.nafath_failed)}</span>`:"0",r.manafith_denied?`<span style="color:#d97706">${fmt(r.manafith_denied)}</span>`:"0"])),"order region, else dealer region")}
        ${card("Top dealers",tbl(["DEALER","STAFF","REGION","ATTEMPTS","CONV.","LAST SEEN"],d.topDealers.map(r=>[`<b>${esc(r.dealer_name||r.dealer_code||"—")}</b><div class="rl" style="color:var(--muted);font-size:10px">${esc(r.dealer_code||"")}</div>`,`${esc(r.staff_name||"")}<div class="rl" style="color:var(--muted);font-size:10px">${esc(r.staff_code)} · ${esc(r.role||"")}</div>`,esc(r.region||"—"),fmt(r.n),`${r.conversion}%`,ts(r.last_seen)])),"by attempts in window")}
        ${card("Error categories",tbl(["CATEGORY","EVENTS","OPEN","LAST"],d.errors.map(e=>[`<span class="pill" style="font-size:10.5px">${esc(e.category)}</span>`,fmt(e.n),e.open?`<b style="color:#dc2626">${fmt(e.open)}</b>`:"0",ts(e.last_at)])),"error_events · taxonomy from the Error Control Board")}
        ${b2c?card("Salam Home app (B2C)",tbl(["JOURNEY","ATTEMPTS","COMPLETED","STALLED","IN PROGRESS","BSS ORDER"],b2c.byWorkflow.map(w=>[esc(w.label),fmt(w.n),`${fmt(w.completed)} <span style="color:var(--muted)">· ${w.conversion}%</span>`,fmt(w.stalled),fmt(w.in_progress),fmt(w.with_order)]))+`<div class="rl" style="font-size:10.5px;color:#d97706;margin-top:8px">${esc(b2c.provisional)}</div>`,"channel salamhome · "+state.range):""}
      </div>`;
  }

  function appendAttemptsCard(host){
    const wrap=document.createElement("div");
    wrap.innerHTML=card("Recent attempts",`<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <input id="fxFind" placeholder="ODB · order # · service # · ICCID · mobile · cust code" value="${esc(state.find)}" style="font:inherit;font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit;min-width:320px">
        <select id="fxOut" style="font:inherit;font-size:12px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit"><option value="">any outcome</option>${["COMPLETED","STALLED","CANCELLED","EXPIRED","IN_PROGRESS"].map(o=>`<option ${state.outcome===o?"selected":""}>${o}</option>`).join("")}</select>
        <button id="fxGo" class="btn" style="font-size:11.5px;padding:6px 13px">Find</button>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">identifiers shown as last digits only · full values: Phase 2 (unmask, audited)</span></div>
      <div id="fxAttempts"></div>`,"newest 100 in window");
    host.appendChild(wrap.firstElementChild);
    $("#fxGo").onclick=()=>{ state.find=$("#fxFind").value.trim(); state.outcome=$("#fxOut").value; loadAttempts(); };
    $("#fxFind").onkeydown=e=>{ if(e.key==="Enter") $("#fxGo").click(); };
  }

  async function loadAttempts(){
    const el=$("#fxAttempts"); if(!el) return;
    el.innerHTML=`<div style="color:var(--muted);font-size:12px;padding:8px">loading…</div>`;
    try{
      const r=await api(`/api/fixed/attempts?${qs()}&limit=100${state.find?`&find=${encodeURIComponent(state.find)}`:""}${state.outcome?`&outcome=${state.outcome}`:""}`);
      el.innerHTML=tbl(["STARTED (KSA)","JOURNEY","CHANNEL","DEALER / QR","ORDER #","ODB / SERVICE","OUTCOME","STEP","LAST ERROR","REGION","⏱"],
        r.rows.map(a=>[ts(a.started_at),esc(window.FIXED_WF&&window.FIXED_WF[a.workflow]||a.workflow),esc(a.channel),
          a.dealer_code?`${esc(a.dealer_name||a.dealer_code)}<div class="rl" style="color:var(--muted);font-size:10px">${esc(a.staff_code||"")}</div>`:(a.referral_code?`QR ${esc(a.referral_code)}`:"—"),
          esc(a.order_number||"—"),`${esc(a.odb||"")}${a.service_no?`<div class="rl" style="color:var(--muted);font-size:10px">${esc(a.service_no)}</div>`:""}`,
          `<b style="color:${OUT_COLOR[a.outcome]||"inherit"}">${esc(a.outcome)}</b>`,esc(a.step_reached||"—"),
          a.last_error_category?`<span class="pill" style="font-size:10px">${esc(a.last_error_category)}</span>`:"",esc(a.region||"—"),a.duration_s?Math.round(a.duration_s/60)+"m":"—"]));
    }catch(e){ el.innerHTML=`<div style="color:#dc2626;font-size:12px;padding:8px">${esc(e.message)}</div>`; }
  }

  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="fixed") b.addEventListener("click", ()=>render(curTab)); });
  window.openFixed=render;   // openFixed("map") deep-links a sub-tab
  /* "trace ›" for a workflow / request id → Fixed › Troubleshoot with the raw app-log grep run on that id
     (successes + failures, request/response, the whole journey per requestId) — better than the SDA map,
     which only shows the order pin (1 Oct 2026). wf_st_… ids also prefill the board's Workflow ID field. */
  window.fixedTraceHash=function(id){ const v=String(id||"").trim(); if(!v) return "fixed?tab=errors";
    return "fixed?tab=errors&openOnly=0"+(/^wf_/i.test(v)?"&workflowId="+encodeURIComponent(v):"")+"&grep="+encodeURIComponent(v); };
  window.FX={ api, esc, ts, fmt, tbl, card, chip, bar, state, qs, rangeQs, windowOf, windowLabel, RANGE_MIN, OUT_COLOR, KSA, rangeChips, bindRange, rerender:()=>render(curTab) };
})();
