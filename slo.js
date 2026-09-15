/* SLA page — SLO attainment + error budgets per journey, and vendor/integration health. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const API = window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  const tv=(n,fb)=>{const v=getComputedStyle(document.documentElement).getPropertyValue(n).trim();return v||fb;};
  let vendWin=24;
  let CFG=null;
  let CFG_ACTIVE="mobile";
  const pct=v=> v==null?"—":(v*100).toFixed(1)+"%";
  const statusColor=s=> s==='met'?"#16a34a":s==='at_risk'?"#d97706":s==='breached'?"#dc2626":"#94a3b8";
  const VLABEL={activation:"Activation (BSS)",semati:"Semati provisioning",nafath:"Nafath (Absher)",eligibility:"Eligibility (CITC)",change_plan:"Plan change"};
  const businessLabel=b=>({mobile:"MVNO",fixed:"Fixed",both:"Fixed / MVNO"}[String(b||"").toLowerCase()]||b||"MVNO");
  const isSuper=()=>{ const s=(window.opsSession&&window.opsSession())||{}; return !!(s.me && (s.me.realRole==="super_admin" || (s.me.realRoles||[]).includes("super_admin"))); };
  const fmtTarget=(s)=>{
    if(s.unit==="percent") return s.target==null?"":(Number(s.target)*100).toFixed(Number(s.target)*100%1?1:0);
    return s.target==null?"":String(s.target);
  };
  const fmtWarn=(s)=>{
    if(s.unit==="percent") return s.warnBand==null?"":(Number(s.warnBand)*100).toFixed(Number(s.warnBand)*100%1?1:0);
    return s.warnBand==null?"":String(s.warnBand);
  };
  const smallInput=(name,val,attrs)=>`<input data-f="${name}" value="${esc(val==null?"":val)}" ${attrs||""}>`;

  function sparkSvg(vals,target){
    if(!vals||!vals.filter(v=>v!=null).length) return `<div class="rl" style="padding:8px 0">no data</div>`;
    const W=200,H=36,n=vals.length;
    const x=i=>(i/(Math.max(1,n-1)))*W, y=v=>H-2-(v*(H-4));
    let d="",started=false; vals.forEach((v,i)=>{ if(v==null)return; d+=(started?"L":"M")+x(i).toFixed(1)+","+y(v).toFixed(1)+" "; started=true; });
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:36px">
      <line x1="0" y1="${y(target).toFixed(1)}" x2="${W}" y2="${y(target).toFixed(1)}" stroke="${tv('--muted','#94a3b8')}" stroke-dasharray="3 3" stroke-width="1"/>
      <path d="${d}" fill="none" stroke="#2563eb" stroke-width="1.6"/></svg>`;
  }

  async function render(){
    const host=$("#view-slo"); if(!host) return;
    host.innerHTML=`<div class="panel">
      <div class="slo-page-head">
        <div><h2>Service levels &amp; vendor health</h2>
          <div class="sub">SLO attainment and error budgets per journey, plus live partner/integration health — read from rollups, so it's instant.</div></div>
        ${isSuper()?`<button class="pill" id="sloOpenSettings" style="border-left-color:var(--green)">⚙ SLO definitions</button>`:''}
      </div>
      <h2 style="margin-top:14px">Current SLO attainment</h2>
      <div id="sloCards" class="slo-grid" style="margin-top:14px"></div>
      <h2 style="margin-top:24px">Vendor &amp; integration health</h2>
      <div style="display:flex;gap:8px;align-items:center;margin:6px 0 12px">
        <span class="rl">Window</span>
        <div class="segsel" id="vendWin"><button data-h="24" class="${vendWin===24?'on':''}">24h</button><button data-h="168" class="${vendWin===168?'on':''}">7d</button><button data-h="720" class="${vendWin===720?'on':''}">30d</button></div>
      </div>
      <div id="vendBoard"></div>
      <h2 style="margin-top:24px">Anomaly detection</h2>
      <div class="sub">Live signals vs each journey's seasonal baseline (hour-of-week median, robust z-score) — catches spikes &amp; drops a fixed threshold would miss.</div>
      <div id="anomBoard" style="margin-top:10px"></div>
      <h2 style="margin-top:24px">Acknowledgement SLA — reminders &amp; escalation</h2>
      <div class="sub">What happens when nobody on L1 / L2 acknowledges an alert: reminder 1 → reminder 2 (warning) → reminder 3 + management escalation, per business and per priority.</div>
      <div id="ackSlaBoard" style="margin-top:10px"></div>
    </div>`;
    const cfgBtn=$("#sloOpenSettings"); if(cfgBtn) cfgBtn.addEventListener("click",()=>{ location.hash="#slo-settings"; });
    $("#vendWin").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ vendWin=Number(b.dataset.h); $("#vendWin").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); loadVendors(); }));
    loadSlos(); loadVendors(); loadAnomalies(); if(window.renderAckSlaSettings) window.renderAckSlaSettings($("#ackSlaBoard"));
  }

  async function renderSettings(){
    const host=$("#view-slo-settings"); if(!host) return;
    if(!isSuper()){
      host.innerHTML=`<div class="panel" style="text-align:center;padding:34px 20px">
        <div style="font-size:26px">🔒</div>
        <h2 style="margin:8px 0 4px">Super Admin Only</h2>
        <div class="sub">SLO definitions control operational targets and dashboard verdicts.</div>
      </div>`;
      return;
    }
    host.innerHTML=`<div class="panel">
      <div class="slo-admin-hero">
        <div>
          <div class="slo-kicker">SLA / SLO CONTROL CENTER</div>
          <h2>SLO Definitions</h2>
          <div class="sub">Define targets, warning bands, windows, and operator messages for Fixed / MVNO. These values drive Executive Dashboard SLO cards, SLA attainment, and health messages.</div>
        </div>
        <div class="slo-admin-actions">
          <button class="pill" id="sloBackHealth" style="border-left-color:var(--blue)">← SLA health</button>
          <button class="pill" id="sloCfgReset" style="border-left-color:var(--muted)">Reset defaults</button>
          <button class="pill" id="sloCfgSave" style="border-left-color:var(--green)">Save changes</button>
        </div>
      </div>
      <div id="sloConfigBoard" style="margin-top:14px"></div>
      <div id="sloCfgStatus" class="rl" style="margin-top:10px"></div>
    </div>`;
    $("#sloBackHealth").addEventListener("click",()=>{ location.hash="#sla"; });
    $("#sloCfgSave").addEventListener("click",saveSloConfig);
    $("#sloCfgReset").addEventListener("click",resetSloConfig);
    loadSloConfig();
  }

  async function loadSloConfig(){
    const box=$("#sloConfigBoard"); if(!box) return;
    box.innerHTML=`<div class="sub">Loading SLO definitions…</div>`;
    try{ CFG=await api("/api/slo/config"); paintSloConfig(); }
    catch(e){ box.innerHTML=`<div class="albanner">SLO target editor is Super Admin only. ${esc(e.message)}</div>`; }
  }

  function paintSloConfig(){
    const box=$("#sloConfigBoard"); if(!box||!CFG) return;
    const all=CFG.slos||[];
    const active=all.filter(s=>(s.business||"mobile")===CFG_ACTIVE);
    const groups={};
    active.forEach(s=>{ (groups[s.group||"SLOs"] ||= []).push(s); });
    const groupCounts=Object.entries(groups);
    const total=all.length, enabled=all.filter(s=>s.enabled!==false).length;
    const mvno=all.filter(s=>s.business==="mobile").length, fixed=all.filter(s=>s.business==="fixed").length;
    const cards=groupCounts.map(([g,items])=>`
      <section class="slo-cfg-group" id="slo-group-${esc(slug(g))}">
        <div class="slo-cfg-gh"><span>${esc(g)}</span><b>${items.length}</b></div>
        <div class="slo-def-grid">${items.map(s=>cfgRow(s)).join("")}</div>
      </section>`).join("");
    box.innerHTML=`<div class="slo-admin-summary">
        <div><b>${enabled}</b><span>enabled of ${total}</span></div>
        <div><b>${mvno}</b><span>MVNO definitions</span></div>
        <div><b>${fixed}</b><span>Fixed definitions</span></div>
        <div><b>${all.filter(s=>s.enabled===false).length}</b><span>not measured / disabled</span></div>
      </div>
      <div class="slo-admin-tabs" role="tablist" aria-label="SLO business">
        <button type="button" data-biz="mobile" class="${CFG_ACTIVE==="mobile"?"on":""}">MVNO</button>
        <button type="button" data-biz="fixed" class="${CFG_ACTIVE==="fixed"?"on":""}">Fixed</button>
      </div>
      <div class="slo-admin-shell">
        <aside class="slo-group-nav">
          <div class="slo-cfg-gh" style="margin-bottom:8px">Groups</div>
          ${groupCounts.map(([g,items])=>`<button type="button" data-target="slo-group-${esc(slug(g))}"><span>${esc(g)}</span><b>${items.length}</b></button>`).join("")}
        </aside>
        <div class="slo-group-main">${cards||`<div class="okbox">No definitions for ${esc(businessLabel(CFG_ACTIVE))}.</div>`}</div>
      </div>`;
    box.querySelectorAll(".slo-admin-tabs button").forEach(b=>b.addEventListener("click",()=>{ CFG_ACTIVE=b.dataset.biz||"mobile"; paintSloConfig(); }));
    box.querySelectorAll(".slo-group-nav button").forEach(b=>b.addEventListener("click",()=>{ const el=document.getElementById(b.dataset.target); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); }));
  }

  function cfgRow(s){
    const isRoll=s.targetMode==="rolling_floor";
    const dirSel=`<select data-f="direction"><option value="gte" ${s.direction==="gte"?"selected":""}>≥ target</option><option value="lte" ${s.direction==="lte"?"selected":""}>≤ target</option><option value="state" ${s.direction==="state"?"selected":""}>state</option></select>`;
    const unitSel=`<select data-f="unit"><option value="percent" ${s.unit==="percent"?"selected":""}>%</option><option value="count_per_day" ${s.unit==="count_per_day"?"selected":""}>count/day</option><option value="count_per_24h" ${s.unit==="count_per_24h"?"selected":""}>count/24h</option><option value="ms" ${s.unit==="ms"?"selected":""}>ms</option><option value="state" ${s.unit==="state"?"selected":""}>state</option></select>`;
    const target=isRoll
      ? `<div class="slo-stack">${smallInput("marginPp",s.marginPp,'type="number" min="0" max="100" step="0.5"')}<span class="rl">pp below ${esc(s.baselineDays||7)}d avg</span></div>`
      : s.unit==="state" ? smallInput("targetText",s.targetText||"SUCCESS daily")
      : smallInput("target",fmtTarget(s),'type="number" step="0.1" min="0"');
    return `<article class="slo-def-card" data-key="${esc(s.key)}" id="${esc(slug(s.group||"slo")+"-"+s.key)}">
      <div class="slo-def-head">
        <label class="slo-switch"><input type="checkbox" data-f="enabled" ${s.enabled!==false?"checked":""}><span></span></label>
        <div><input data-f="label" class="slo-title-input" value="${esc(s.label)}"><div class="rl">${esc(businessLabel(s.business))} · ${esc(s.key)}${s.note?` · ${esc(s.note)}`:""}</div></div>
      </div>
      <div class="slo-form-grid">
        <label><span>Rule</span>${dirSel}</label>
        <label><span>Unit</span>${unitSel}</label>
        <label><span>${isRoll?"Rolling margin":"Target"}</span>${target}</label>
        <label><span>Warning band</span>${s.unit==="state"?`<input disabled value="—">`:smallInput("warnBand",fmtWarn(s),'type="number" step="0.1" min="0"')}</label>
        <label><span>Window days</span>${smallInput("windowDays",s.windowDays,'type="number" min="1" max="400" step="1"')}</label>
      </div>
      <div class="slo-msgs">
        <label><span>When met</span><textarea data-msg="met" rows="2">${esc((s.messages&&s.messages.met)||"")}</textarea></label>
        <label><span>Near target</span><textarea data-msg="at_risk" rows="2">${esc((s.messages&&s.messages.at_risk)||"")}</textarea></label>
        <label><span>Breached</span><textarea data-msg="breached" rows="2">${esc((s.messages&&s.messages.breached)||"")}</textarea></label>
      </div>
    </article>`;
  }

  function collectSloConfig(){
    const next=JSON.parse(JSON.stringify(CFG||{version:1,slos:[]}));
    const map=Object.fromEntries((next.slos||[]).map(s=>[s.key,s]));
    document.querySelectorAll("#sloConfigBoard .slo-def-card[data-key]").forEach(row=>{
      const s=map[row.dataset.key]; if(!s) return;
      const val=f=>row.querySelector(`[data-f="${f}"]`);
      s.enabled=!!(val("enabled")&&val("enabled").checked);
      s.label=(val("label")&&val("label").value)||s.label;
      s.direction=(val("direction")&&val("direction").value)||s.direction;
      s.unit=(val("unit")&&val("unit").value)||s.unit;
      s.windowDays=Number((val("windowDays")||{}).value)||s.windowDays;
      if(s.targetMode==="rolling_floor") s.marginPp=Number((val("marginPp")||{}).value)||0;
      else if(s.unit==="state") s.targetText=(val("targetText")&&val("targetText").value)||s.targetText;
      else {
        const tv=Number((val("target")||{}).value);
        s.target=s.unit==="percent"?tv/100:tv;
      }
      const wb=Number((val("warnBand")||{}).value);
      if(Number.isFinite(wb)) s.warnBand=s.unit==="percent"?wb/100:wb;
      s.messages=s.messages||{};
      row.querySelectorAll("[data-msg]").forEach(i=>{ s.messages[i.dataset.msg]=i.value; });
    });
    return next;
  }

  function slug(s){
    return String(s||"slo").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"slo";
  }

  async function saveSloConfig(){
    const st=$("#sloCfgStatus"); if(st) st.textContent="Saving…";
    try{ CFG=await api("/api/slo/config",{method:"PUT",body:JSON.stringify(collectSloConfig())}); if(st) st.textContent="Saved. Dashboard targets now use these values."; paintSloConfig(); loadSlos(); }
    catch(e){ if(st) st.innerHTML=`<span style="color:#dc2626">Save failed: ${esc(e.message)}</span>`; }
  }

  async function resetSloConfig(){
    if(!confirm("Reset SLO target definitions to the Salam defaults?")) return;
    const st=$("#sloCfgStatus"); if(st) st.textContent="Resetting…";
    try{ CFG=await api("/api/slo/config/reset",{method:"POST",body:"{}"}); if(st) st.textContent="Defaults restored."; paintSloConfig(); loadSlos(); }
    catch(e){ if(st) st.innerHTML=`<span style="color:#dc2626">Reset failed: ${esc(e.message)}</span>`; }
  }

  async function loadAnomalies(){
    const box=$("#anomBoard"); if(!box) return; box.innerHTML=`<div class="sub">Scanning baseline…</div>`;
    let d; try{ d=await api("/api/anomalies"); }catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const list=d.anomalies||[];
    if(!list.length){ box.innerHTML=`<div class="okbox">No anomalies — every journey is within its seasonal band.</div>`; return; }
    const sevC=s=>s==='P1'?"#dc2626":s==='P2'?"#d97706":"#2563eb";
    box.innerHTML=list.map(a=>{
      const arrow=a.direction==='up'?"▲":"▼"; const c=sevC(a.severity);
      return `<div class="anom-row" style="border-left:3px solid ${c}">
        <span class="anom-sev" style="background:${c}">${esc(a.severity)}</span>
        <span class="anom-arrow" style="color:${c}">${arrow} ${Math.abs(a.score).toFixed(1)}σ</span>
        <span class="anom-text">${esc(a.text)}</span>
      </div>`;
    }).join("");
  }

  async function loadSlos(){
    const box=$("#sloCards"); if(!box) return; box.innerHTML=`<div class="sub" style="grid-column:1/-1">Loading service levels…</div>`;
    let d; try{ d=await api("/api/slo"); }catch(e){
      // hidden root tier: the server answers 403 {error:'restricted'} — show a clean panel, not an error banner
      if(/^restricted$/i.test(e.message||"")){ const host=$("#view-slo"); if(host) host.innerHTML=`<div class="panel" style="text-align:center;padding:34px 20px">
        <div style="font-size:26px">🔒</div>
        <h2 style="margin:8px 0 4px">Restricted</h2>
        <div class="sub">The SLA page is limited to the platform owner.</div></div>`; return; }
      box.innerHTML=`<div class="albanner" style="grid-column:1/-1">${esc(e.message)}</div>`; return; }
    const slos=d.slos||[];
    if(!slos.length){ box.innerHTML=`<div class="okbox" style="grid-column:1/-1">No SLO targets yet.</div>`; return; }
    const canEdit=isSuper();
    box.innerHTML=slos.map(s=>{
      const c=statusColor(s.status);
      const bp=s.budgetPct==null?0:Math.max(0,Math.min(1,s.budgetPct));
      const budColor=s.budgetPct==null?"#94a3b8":s.budgetPct<=0?"#dc2626":s.budgetPct<0.25?"#d97706":"#16a34a";
      return `<div class="slo-card" style="border-top:3px solid ${c}">
        <div class="slo-h"><b>${esc(s.label)}</b><span class="slo-status" style="color:${c}">${esc(s.status.replace('_',' '))}</span></div>
        <div class="slo-att" style="color:${c}">${pct(s.attainment)}</div>
        <div class="rl">${esc(s.targetText||("target "+pct(s.target)))} · ${s.window_days}d · ${(s.total||0).toLocaleString()} events ${canEdit?`<button class="slo-edit" data-slo="${esc(s.journey)}" title="Edit in target builder" style="border:none;background:none;cursor:pointer;color:var(--blue)">✎</button>`:''}</div>
        <div class="slo-spark">${sparkSvg(s.spark,s.target)}</div>
        <div class="rl" style="margin-top:6px">Error budget</div>
        <div class="slo-budget"><span style="width:${Math.round(bp*100)}%;background:${budColor}"></span></div>
        <div class="rl">${s.budgetRemaining>=0?`${s.budgetRemaining.toLocaleString()} of ${s.allowed.toLocaleString()} failures left`:`<span style="color:#dc2626">over budget by ${Math.abs(s.budgetRemaining).toLocaleString()}</span>`}</div>
      </div>`;
    }).join("");
    box.querySelectorAll(".slo-edit").forEach(b=>b.addEventListener("click",()=>{ location.hash="#slo-settings"; }));
  }

  async function loadVendors(){
    const box=$("#vendBoard"); if(!box) return; box.innerHTML=`<div class="sub">Loading vendor health…</div>`;
    let d; try{ d=await api("/api/vendors?window="+vendWin); }catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const row=(name,rate,total)=>{ const c=rate==null?"#94a3b8":rate>=0.95?"#16a34a":rate>=0.85?"#d97706":"#dc2626";
      return `<div class="vend-row"><span class="vend-name">${esc(name)}</span><div class="vend-bar"><span style="width:${rate==null?0:Math.round(rate*100)}%;background:${c}"></span></div><span class="vend-rate" style="color:${c}">${pct(rate)}</span><span class="vend-vol rl">${(total||0).toLocaleString()}</span></div>`; };
    const grp=(title,rows,fn)=> (rows&&rows.length)?`<div class="vend-grp"><h5>${title}</h5>${rows.map(fn).join("")}</div>`:'';
    const html =
      grp("Payment gateways", d.paymentVendors, v=>row(v.vendor||"—", v.rate, v.total)) +
      grp("Couriers", d.couriers, v=>row(v.vendor||"—", v.rate, v.total)) +
      grp("Integrations", d.integrations, v=>row(VLABEL[v.journey]||v.journey, v.rate, v.total));
    box.innerHTML = html || `<div class="okbox">No vendor activity in the window.</div>`;
  }

  // SLA lives in the Settings gear menu (no nav tab) — activate its view directly,
  // mirroring window.openWorkbench: deactivate all tabs + views, clear the gear/opsBar, then render.
  window.openSla=()=>{
    const v=$("#view-slo"); if(!v) return;
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.remove("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    v.classList.add("active");
    render();
  };
  window.openSloSettings=()=>{
    const v=$("#view-slo-settings"); if(!v) return;
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.remove("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    v.classList.add("active");
    renderSettings();
  };
  document.addEventListener("themechange",()=>{ if($("#view-slo")&&$("#view-slo").classList.contains("active")) render(); });
  document.addEventListener("opsdatarefresh",()=>{ if($("#view-slo")&&$("#view-slo").classList.contains("active")) render(); });
  document.addEventListener("themechange",()=>{ if($("#view-slo-settings")&&$("#view-slo-settings").classList.contains("active")) renderSettings(); });
})();
