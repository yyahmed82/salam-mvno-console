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
  const TAB_ORDER=[["overview","Overview","KPIs · funnel · dealers"],
    /* the two pages the Fixed Operations agent used to generate as static HTML — live since 12 Sep 2026 */
    ["exec","Executive","north-star KPIs · SLOs · top issues"],["ops","Operations","health · trends · pipeline · alerts"],["epurchase","E-purchase","web / QR channel · journeys · payments · findings"],["salamhome","Salam Home","app channel · buy + manage-line · payments · findings"],["map","SDA map","dealers · pins · trace"],["qr","QR codes","referral orders · consent"],
    ["dash","Reports","KPIs · trends · dealers & QR"],["errors","Errors","error control board"],["alerts","Alerts","rules · history"],
    ["playbook","Playbook","SLA / OLA / action plans"],["diagrams","Diagrams","payments · journeys"],
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
  async function api(path){
    const r=await fetch((window.API_BASE||window.CONSOLE_BASE||"")+path,{headers:{"Content-Type":"application/json","X-Console-Role":SES.role,"X-Console-User":SES.email}});
    const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j;
  }
  // The hub carries no filters (Yosri, 6 Sep): channel is always "All" — pages that need one (Errors, Reports) own it —
  // and the range is chosen inside the page that uses it via fx.rangeChips()/fx.bindRange().
  const state={ range:localStorage.getItem("fixed_range")||"7d", channel:"", find:"", outcome:"" };
  try{ localStorage.removeItem("fixed_channel"); }catch(e){}
  const RANGES=[["24h","24h"],["7d","7d"],["30d","30d"],["90d","90d"]];
  const rangeChips=(label="Range")=>`<span class="fx-range" style="display:inline-flex;gap:5px;align-items:center;flex-wrap:wrap">${label?`<span class="rl" style="font-size:10.5px;color:var(--muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase">${label}</span>`:""}${RANGES.map(([m,l])=>`<button type="button" class="fx-r${state.range===m?" on":""}" data-m="${m}" style="cursor:pointer;font:inherit;font-size:11.5px;font-weight:700;padding:5px 12px;border:1px solid ${state.range===m?"var(--green,#0e9f5a)":"var(--line)"};border-radius:999px;background:${state.range===m?"var(--green,#0e9f5a)":"var(--card,#fff)"};color:${state.range===m?"#fff":"inherit"};transition:transform .14s,box-shadow .14s,border-color .14s">${l}</button>`).join("")}</span>`;
  const bindRange=(root,onChange)=>{ (root||document).querySelectorAll(".fx-r").forEach(b=>b.onclick=()=>{ state.range=b.dataset.m; localStorage.setItem("fixed_range",state.range); if(onChange) onChange(state.range); else render(curTab); }); };
  const qs=()=>`range=${state.range}${state.channel?`&channel=${state.channel}`:""}`;

  const OUT_COLOR={COMPLETED:"var(--green,#0e9f5a)",STALLED:"#d97706",CANCELLED:"#dc2626",EXPIRED:"#64748b",IN_PROGRESS:"#2563eb"};
  const chip=(l,v,c,sub)=>`<div class="stat" style="min-width:130px"><b style="${c?`color:${c}`:""}">${v}</b><span>${esc(l)}</span>${sub?`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:3px">${sub}</div>`:""}</div>`;
  const bar=(n,max,color)=>`<div style="height:6px;border-radius:4px;background:var(--line);overflow:hidden;min-width:80px"><div style="width:${max?Math.round(100*n/max):0}%;height:100%;background:${color||"var(--green,#0e9f5a)"}"></div></div>`;
  const card=(title,body,sub)=>`<div class="topo-card" style="padding:14px 16px"><div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px"><h3 style="margin:0;font-size:13.5px">${title}</h3>${sub?`<span class="rl" style="font-size:10.5px;color:var(--muted)">${sub}</span>`:""}</div>${body}</div>`;
  const tbl=(head,rows)=>`<table class="mono" style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr>${head.map(h=>`<th style="text-align:left;padding:4px 6px;color:var(--muted);font-weight:700;font-size:10px;letter-spacing:.6px;border-bottom:1px solid var(--line)">${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td style="padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top">${c}</td>`).join("")}</tr>`).join("")||`<tr><td colspan="${head.length}" style="padding:10px;color:var(--muted)">nothing in this window</td></tr>`}</tbody></table>`;

  async function renderOverview(host){
    host.innerHTML=`<div style="display:flex;justify-content:flex-end;margin-bottom:10px">${rangeChips()}</div><div id="fxFresh"></div>
      <div id="fxBody"><div style="padding:30px;text-align:center;color:var(--muted)">${window.salamLoader?window.salamLoader("Reading Fixed data…"):"Loading…"}</div></div>`;
    bindRange(host);
    try{
      const [d,b2c]=await Promise.all([api("/api/fixed/summary?"+qs()), api("/api/fixed/b2c?range="+state.range).catch(()=>null)]);
      drawFresh(d.freshness,d.source);
      drawBody(d,b2c);
      await loadAttempts();
    }catch(e){
      $("#fxBody").innerHTML=`<div class="albanner" style="border-left:4px solid #dc2626;padding:14px 16px"><b>Fixed data unavailable</b> — ${esc(e.message)}<div class="rl" style="font-size:11px;color:var(--muted);margin-top:4px">Set OPS_DATABASE_URL (sda_ops) and restart. /api/fixed/ping shows each source.</div></div>`;
    }
  }
  window.FIXED_PAGES.overview={ label:"Overview", render:renderOverview };

  /* ---- HUB ---- */
  let curTab="overview";
  async function render(tab){
    const host=$("#view-fixed"); if(!host) return;
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
          <div><h2 style="margin:0;font-size:16px"><span style="color:var(--muted);font-weight:600">Fixed ›</span> ${esc(cur[1])}</h2>
            <div class="rl" style="font-size:10.5px;color:var(--muted)">${esc(cur[2])} · FTTH · 5G home · e-purchase / QR · Salam Home app — Operations Console data, stage 1 · other pages: <b>Fixed ▾</b> menu</div></div>
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
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px;margin-bottom:12px">
        ${card("Outcome mix",d.outcomes.map(o=>`<div style="display:grid;grid-template-columns:110px 1fr 70px;gap:8px;align-items:center;font-size:12px;margin:4px 0"><span class="mono">${esc(o.outcome)}</span>${bar(o.n,outMax,OUT_COLOR[o.outcome])}<b style="text-align:right">${fmt(o.n)}</b></div>`).join("")+spark,"attempts per KSA day, green share = completed")}
        ${card("By journey (workflow)",d.byWorkflow.map(w=>`<div style="display:grid;grid-template-columns:1fr 90px 60px 60px;gap:8px;align-items:center;font-size:12px;margin:4px 0"><span>${esc(w.label)}</span>${bar(w.n,wfMax)}<b style="text-align:right">${fmt(w.n)}</b><span class="mono" style="text-align:right;color:${w.conversion<40?"#d97706":"var(--muted)"}">${w.conversion}%</span></div>`).join(""),"count · conversion")}
        ${card("By channel",d.byChannel.map(c=>`<div style="display:flex;justify-content:space-between;font-size:12px;margin:5px 0"><span class="mono">${esc(c.channel)}</span><span><b>${fmt(c.n)}</b> <span style="color:var(--muted)">· ${c.conversion}%</span></span></div>`).join("")+`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:8px">consumer-direct e-purchase (no referral code) excluded — same as the beta</div>`)}
        ${card("Nafath outcomes (SDA · 5G)",naf.breakdown.map(o=>`<div style="display:flex;justify-content:space-between;font-size:12px;margin:5px 0"><span class="mono">${esc(o.outcome)}</span><b>${fmt(o.n)}</b></div>`).join("")||`<div style="color:var(--muted);font-size:12px">no Nafath checks in window</div>`)}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:12px;margin-bottom:12px">
        ${card("Regions",tbl(["REGION","ATTEMPTS","COMPLETED","NAFATH FAIL","MANAFITH DENIED"],d.byRegion.map(r=>[esc(r.region),fmt(r.n),fmt(r.completed),r.nafath_failed?`<span style="color:#dc2626">${fmt(r.nafath_failed)}</span>`:"0",r.manafith_denied?`<span style="color:#d97706">${fmt(r.manafith_denied)}</span>`:"0"])),"order region, else dealer region")}
        ${card("Top dealers",tbl(["DEALER","STAFF","REGION","ATTEMPTS","CONV.","LAST SEEN"],d.topDealers.map(r=>[`<b>${esc(r.dealer_name||r.dealer_code||"—")}</b><div class="rl" style="color:var(--muted);font-size:10px">${esc(r.dealer_code||"")}</div>`,`${esc(r.staff_name||"")}<div class="rl" style="color:var(--muted);font-size:10px">${esc(r.staff_code)} · ${esc(r.role||"")}</div>`,esc(r.region||"—"),fmt(r.n),`${r.conversion}%`,ts(r.last_seen)])),"by attempts in window")}
        ${card("Error categories",tbl(["CATEGORY","EVENTS","OPEN","LAST"],d.errors.map(e=>[`<span class="pill" style="font-size:10.5px">${esc(e.category)}</span>`,fmt(e.n),e.open?`<b style="color:#dc2626">${fmt(e.open)}</b>`:"0",ts(e.last_at)])),"error_events · taxonomy from the Error Control Board")}
        ${b2c?card("Salam Home app (B2C)",tbl(["JOURNEY","ATTEMPTS","COMPLETED","STALLED","IN PROGRESS","BSS ORDER"],b2c.byWorkflow.map(w=>[esc(w.label),fmt(w.n),`${fmt(w.completed)} <span style="color:var(--muted)">· ${w.conversion}%</span>`,fmt(w.stalled),fmt(w.in_progress),fmt(w.with_order)]))+`<div class="rl" style="font-size:10.5px;color:#d97706;margin-top:8px">${esc(b2c.provisional)}</div>`,"channel salamhome · "+state.range):""}
      </div>
      ${card("Recent attempts",`<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
          <input id="fxFind" placeholder="ODB · order # · service # · ICCID · mobile · cust code" value="${esc(state.find)}" style="font:inherit;font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit;min-width:320px">
          <select id="fxOut" style="font:inherit;font-size:12px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit"><option value="">any outcome</option>${["COMPLETED","STALLED","CANCELLED","EXPIRED","IN_PROGRESS"].map(o=>`<option ${state.outcome===o?"selected":""}>${o}</option>`).join("")}</select>
          <button id="fxGo" class="btn" style="font-size:11.5px;padding:6px 13px">Find</button>
          <span class="rl" style="font-size:10.5px;color:var(--muted)">identifiers shown as last digits only · full values: Phase 2 (unmask, audited)</span></div>
        <div id="fxAttempts"></div>`,"newest 100 in window")}`;
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
  window.FX={ api, esc, ts, fmt, tbl, card, chip, bar, state, qs, OUT_COLOR, KSA, rangeChips, bindRange, rerender:()=>render(curTab) };
})();
