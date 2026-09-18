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

  /* ── SLO definitions (super admin) ─────────────────────────────────────────────────────────
   * Rebuilt 18 Sep 2026. The previous screen rendered all sixteen definitions as always-open
   * forms — ~170 controls on one page, none of them readable at a glance, the operator messages
   * clipped inside 54px textareas. It also silently lost work: edits were collected from the DOM
   * at save time, so switching MVNO <-> Fixed discarded anything typed on the other side.
   *
   * Now the cards READ and a modal WRITES. Each card states the rule as the three verdicts it
   * actually produces — breached / at risk / met, laid out on a number line and derived exactly
   * the way server/src/slo.js derives them — so a target and band that do not mean what their
   * author thought are visible without opening anything. The pencil opens one definition in the
   * house modal. Every edit lands in an in-memory draft that survives tab switches, search and
   * filters; the sticky bar says how much is unsaved; nothing reaches the server until Save. */
  let DRAFT=null, BASE={}, EDIT_KEY=null, CFG_Q="", CFG_FILTER="all";
  const DIRTY=new Set();

  const stable=o=>JSON.stringify(o,(k,v)=> v&&typeof v==="object"&&!Array.isArray(v)
    ? Object.keys(v).sort().reduce((a,x)=>(a[x]=v[x],a),{}) : v);
  const trimNum=v=>{ const n=Number(v); return Number.isFinite(n)?String(Math.round(n*1000)/1000):String(v==null?"":v); };
  const unitSfx=u=> u==="percent"?"%" : u==="ms"?" ms" : u==="count_per_day"?" /day" : u==="count_per_24h"?" /24h" : "";
  const dispVal=(s,v)=> (v==null||!Number.isFinite(Number(v))) ? "—"
    : s.unit==="percent" ? trimNum(Number(v)*100)+"%" : trimNum(v)+unitSfx(s.unit);
  /* A range carries the unit once, on the upper bound: "93 – 95%", "100 – 120 /day". Repeating it
   * on both bounds overflowed the band chip and clipped the number that matters. */
  const rangeVal=(s,lo,hi)=> s.unit==="percent"
    ? trimNum(Number(lo)*100)+" – "+trimNum(Number(hi)*100)+"%"
    : trimNum(lo)+" – "+trimNum(hi)+unitSfx(s.unit);
  const dispBand=s=> s.warnBand==null?"—" : s.unit==="percent" ? trimNum(Number(s.warnBand)*100)+" pp" : trimNum(s.warnBand)+unitSfx(s.unit);
  const headline=s=> s.targetMode==="rolling_floor" ? "− "+trimNum(s.marginPp||0)+" pp"
    : s.unit==="state" ? (s.targetText||"—")
    : (s.direction==="lte"?"≤":"≥")+" "+dispVal(s,s.target);

  function slug(s){ return String(s||"slo").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"slo"; }

  /* The three verdicts a definition produces, in VALUE order (left = low), mirroring
   * server/src/slo.js:  lte -> met <= T, at_risk <= T+W, else breached
   *                     gte -> met >= T, at_risk >= T-W, else breached
   * Reading them as a number line is what catches a direction set the wrong way round. */
  function bandModel(s){
    if(s.targetMode==="rolling_floor") return {kind:"note", note:"met at or above the "+(s.baselineDays||7)+"-day average minus "+trimNum(s.marginPp||0)+" pp"};
    if(s.unit==="state"||s.direction==="state") return {kind:"note", note:"met while the state reads "+(s.targetText||"—")};
    const T=Number(s.target), W=Number(s.warnBand||0);
    if(!Number.isFinite(T)) return {kind:"note", note:"no target set — this definition cannot produce a verdict"};
    if(s.direction==="lte") return {kind:"bands", bands:[
      {v:"ok",   label:"met",      range:"≤ "+dispVal(s,T)},
      {v:"warn", label:"at risk",  range:W?rangeVal(s,T,T+W):"no band"},
      {v:"bad",  label:"breached", range:"> "+dispVal(s,T+W)} ]};
    return {kind:"bands", bands:[
      {v:"bad",  label:"breached", range:"< "+dispVal(s,T-W)},
      {v:"warn", label:"at risk",  range:W?rangeVal(s,T-W,T):"no band"},
      {v:"ok",   label:"met",      range:"≥ "+dispVal(s,T)} ]};
  }
  function bandStrip(s,wide){
    const m=bandModel(s);
    if(m.kind!=="bands") return '<div class="sd-band note'+(wide?" wide":"")+'">'+esc(m.note)+'</div>';
    return '<div class="sd-band'+(wide?" wide":"")+'">'+m.bands.map(b=>
      '<div class="sd-b '+b.v+'"><i></i><span>'+esc(b.label)+'</span><b>'+esc(b.range)+'</b></div>').join("")+'</div>';
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
          <div class="sub">Every target, warning band, window and operator message behind the Executive Dashboard SLO cards, SLA attainment and the health verdicts. Open a definition to change it — nothing reaches the server until you save.</div>
        </div>
        <div class="slo-admin-actions">
          <button class="pill" id="sloBackHealth" style="--pc:var(--blue)">← SLA health</button>
          <button class="pill" id="sloCfgReset" style="--pc:var(--muted)">Reset defaults</button>
          <button class="pill sd-apply" id="sloCfgSave" disabled>Save changes</button>
        </div>
      </div>
      <div id="sloConfigBoard" style="margin-top:14px"></div>
      <div id="sloCfgStatus" class="rl" style="margin-top:10px"></div>
    </div>
    <div class="sd-bar" id="sloDirtyBar" role="status">
      <span class="sd-dot"></span>
      <div class="sd-barx"><b id="sloDirtyN">1 definition changed</b><span>not saved yet — targets on the dashboard are unchanged</span></div>
      <button class="pill sd-ghost" id="sloDiscard">Discard</button>
      <button class="pill sd-apply" id="sloBarSave">Save changes</button>
    </div>`;
    $("#sloBackHealth").addEventListener("click",()=>{
      if(DIRTY.size && !confirm(DIRTY.size+" definition change"+(DIRTY.size===1?"":"s")+" have not been saved. Leave anyway?")) return;
      location.hash="#sla";
    });
    $("#sloCfgSave").addEventListener("click",saveSloConfig);
    $("#sloBarSave").addEventListener("click",saveSloConfig);
    $("#sloDiscard").addEventListener("click",discardDraft);
    $("#sloCfgReset").addEventListener("click",resetSloConfig);
    loadSloConfig();
  }

  async function loadSloConfig(){
    const box=$("#sloConfigBoard"); if(!box) return;
    box.innerHTML=`<div class="sub">Loading SLO definitions…</div>`;
    try{ CFG=await api("/api/slo/config"); resetDraft(); paintSloConfig(); }
    catch(e){ box.innerHTML=`<div class="albanner">SLO target editor is Super Admin only. ${esc(e.message)}</div>`; }
  }
  function resetDraft(){
    DRAFT=JSON.parse(JSON.stringify((CFG&&CFG.slos)||[]));
    BASE={}; DRAFT.forEach(s=>{ BASE[s.key]=stable(s); }); DIRTY.clear();
  }
  function markDirty(k){
    const cur=DRAFT.find(x=>x.key===k); if(!cur) return;
    if(stable(cur)===BASE[k]) DIRTY.delete(k); else DIRTY.add(k);
  }
  function sloBar(){
    const n=DIRTY.size, bar=$("#sloDirtyBar");
    if(bar){ bar.classList.toggle("on",n>0); const l=$("#sloDirtyN"); if(l&&n) l.textContent=n===1?"1 definition changed":n+" definitions changed"; }
    const top=$("#sloCfgSave"); if(top){ top.textContent=n?("Save "+n+" change"+(n===1?"":"s")):"Save changes"; top.disabled=!n; }
  }

  /* Board chrome: summary, business tabs, search, filters. Repainted only when the set of
   * definitions changes — the cards repaint on their own so typing in search keeps focus. */
  function paintSloConfig(){
    const box=$("#sloConfigBoard"); if(!box||!DRAFT) return;
    const total=DRAFT.length, enabled=DRAFT.filter(s=>s.enabled!==false).length;
    const mvno=DRAFT.filter(s=>(s.business||"mobile")==="mobile").length, fixed=DRAFT.filter(s=>s.business==="fixed").length;
    const fil=[["all","All"],["enabled","Measured"],["disabled","Not measured"],["changed",DIRTY.size?"Changed · "+DIRTY.size:"Changed"]];
    box.innerHTML=`
      <div class="slo-admin-summary">
        <button type="button" data-k="enabled" title="Show only measured definitions"><b>${enabled}</b><span>enabled of ${total}</span></button>
        <button type="button" data-k="mvno" title="Show MVNO definitions"><b>${mvno}</b><span>MVNO definitions</span></button>
        <button type="button" data-k="fixed" title="Show Fixed definitions"><b>${fixed}</b><span>Fixed definitions</span></button>
        <button type="button" data-k="disabled" title="Show only definitions that are not measured"><b>${total-enabled}</b><span>not measured / disabled</span></button>
      </div>
      <div class="sd-tools">
        <div class="slo-admin-tabs" role="tablist" aria-label="SLO business">
          <button type="button" role="tab" aria-selected="${CFG_ACTIVE==="mobile"}" data-biz="mobile" class="${CFG_ACTIVE==="mobile"?"on":""}">MVNO</button>
          <button type="button" role="tab" aria-selected="${CFG_ACTIVE==="fixed"}" data-biz="fixed" class="${CFG_ACTIVE==="fixed"?"on":""}">Fixed</button>
        </div>
        <div class="sd-search"><span aria-hidden="true">⌕</span><input id="sloSearch" type="search" placeholder="Search name, key, group or message…" value="${esc(CFG_Q)}" aria-label="Search SLO definitions"></div>
        <div class="sd-filters">${fil.map(([k,l])=>`<button type="button" data-fil="${k}" class="${CFG_FILTER===k?"on":""}">${esc(l)}</button>`).join("")}</div>
      </div>
      <div class="slo-admin-shell">
        <aside class="slo-group-nav" id="sloGroupNav"></aside>
        <div class="slo-group-main" id="sloGroupMain"></div>
      </div>`;
    box.querySelectorAll(".slo-admin-tabs button").forEach(b=>b.addEventListener("click",()=>{ CFG_ACTIVE=b.dataset.biz||"mobile"; paintSloConfig(); }));
    box.querySelectorAll(".slo-admin-summary button").forEach(b=>b.addEventListener("click",()=>{
      const k=b.dataset.k;
      if(k==="mvno"||k==="fixed"){ CFG_ACTIVE=k==="mvno"?"mobile":"fixed"; CFG_FILTER="all"; }
      else CFG_FILTER = CFG_FILTER===k ? "all" : k;
      paintSloConfig();
    }));
    box.querySelectorAll(".sd-filters button").forEach(b=>b.addEventListener("click",()=>{
      CFG_FILTER=b.dataset.fil;
      box.querySelectorAll(".sd-filters button").forEach(x=>x.classList.toggle("on",x===b));
      paintCards();
    }));
    const sb=box.querySelector("#sloSearch");
    if(sb) sb.addEventListener("input",()=>{ CFG_Q=sb.value; paintCards(); });
    paintCards(); sloBar();
  }

  function visibleDefs(){
    const q=CFG_Q.trim().toLowerCase();
    return DRAFT.filter(s=>{
      if((s.business||"mobile")!==CFG_ACTIVE) return false;
      if(CFG_FILTER==="enabled"&&s.enabled===false) return false;
      if(CFG_FILTER==="disabled"&&s.enabled!==false) return false;
      if(CFG_FILTER==="changed"&&!DIRTY.has(s.key)) return false;
      if(!q) return true;
      return [s.label,s.key,s.group,s.note,(s.messages&&s.messages.met)||"",(s.messages&&s.messages.breached)||""]
        .join(" ").toLowerCase().indexOf(q)>=0;
    });
  }

  function paintCards(){
    const main=$("#sloGroupMain"), nav=$("#sloGroupNav"); if(!main) return;
    const shown=visibleDefs();
    const groups={}; shown.forEach(s=>{ (groups[s.group||"SLOs"] ||= []).push(s); });
    const entries=Object.entries(groups);
    if(nav) nav.innerHTML = entries.length
      ? `<div class="slo-cfg-gh" style="margin-bottom:8px"><span>Groups</span></div>`+
        entries.map(([g,items])=>`<button type="button" data-target="slo-group-${esc(slug(g))}"><span>${esc(g)}</span><b>${items.length}</b></button>`).join("")
      : `<div class="slo-cfg-gh"><span>Groups</span></div><div class="rl" style="padding:6px 2px">nothing to show</div>`;
    main.innerHTML = entries.length
      ? entries.map(([g,items])=>`
        <section class="slo-cfg-group" id="slo-group-${esc(slug(g))}">
          <div class="slo-cfg-gh"><span>${esc(g)}</span><b>${items.length}</b></div>
          <div class="sd-grid">${items.map(defCard).join("")}</div>
        </section>`).join("")
      : `<div class="okbox sd-empty">No ${esc(businessLabel(CFG_ACTIVE))} definition matches${CFG_Q?` “${esc(CFG_Q)}”`:""}${CFG_FILTER!=="all"?` in “${esc(CFG_FILTER)}”`:""}. <button type="button" class="sd-link" id="sloClearFil">Clear filters</button></div>`;
    const cf=$("#sloClearFil"); if(cf) cf.addEventListener("click",()=>{ CFG_Q=""; CFG_FILTER="all"; paintSloConfig(); });
    if(nav) nav.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
      const el=document.getElementById(b.dataset.target); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); }));
    main.querySelectorAll(".sd-card").forEach(card=>{
      const k=card.dataset.key;
      const sw=card.querySelector(".slo-switch input");
      if(sw) sw.addEventListener("change",()=>{
        const s=DRAFT.find(x=>x.key===k); if(!s) return;
        s.enabled=sw.checked; markDirty(k);
        if(CFG_FILTER==="all"){ card.classList.toggle("off",!sw.checked); card.classList.toggle("dirty",DIRTY.has(k)); refreshChrome(); }
        else paintCards(), refreshChrome();
      });
      card.addEventListener("click",e=>{ if(e.target.closest(".slo-switch")) return; openDef(k); });
    });
  }

  function refreshChrome(){
    const box=$("#sloConfigBoard"); if(!box||!DRAFT) return;
    const total=DRAFT.length, enabled=DRAFT.filter(s=>s.enabled!==false).length;
    const put=(k,v)=>{ const el=box.querySelector('.slo-admin-summary [data-k="'+k+'"] b'); if(el) el.textContent=v; };
    put("enabled",enabled); put("disabled",total-enabled);
    const ch=box.querySelector('.sd-filters [data-fil="changed"]'); if(ch) ch.textContent=DIRTY.size?"Changed · "+DIRTY.size:"Changed";
    sloBar();
  }

  function defCard(s){
    const off=s.enabled===false, dirty=DIRTY.has(s.key);
    const met=(s.messages&&s.messages.met)||"";
    return `<article class="sd-card${off?" off":""}${dirty?" dirty":""}" data-key="${esc(s.key)}" tabindex="0">
      <div class="sd-top">
        <label class="slo-switch" title="${off?"Not measured — no dashboard card, no verdict":"Measured"}">
          <input type="checkbox" ${off?"":"checked"} aria-label="Measure ${esc(s.label||s.key)}"><span></span></label>
        <div class="sd-id">
          <div class="sd-name">${esc(s.label||s.key)}${dirty?`<em class="sd-tag">changed</em>`:""}${off?`<em class="sd-tag off">not measured</em>`:""}</div>
          <div class="sd-key"><span class="mono">${esc(s.key)}</span>${s.note?` · ${esc(s.note)}`:""}</div>
        </div>
        <button type="button" class="sd-edit" title="Edit this definition" aria-label="Edit ${esc(s.label||s.key)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
      </div>
      <div class="sd-nums">
        <div class="sd-n big"><b>${esc(headline(s))}</b><span>${s.targetMode==="rolling_floor"?"rolling floor":s.unit==="state"?"target state":"target"}</span></div>
        <div class="sd-n"><b>${esc(s.unit==="state"?"—":dispBand(s))}</b><span>warning band</span></div>
        <div class="sd-n"><b>${esc(String(s.windowDays==null?"—":s.windowDays))}<em>d</em></b><span>window</span></div>
      </div>
      ${bandStrip(s)}
      ${met?`<div class="sd-quote">${esc(met)}</div>`:`<div class="sd-quote empty">No “met” message — the dashboard card will show the target only.</div>`}
    </article>`;
  }

  /* ── one definition, in the house modal ─────────────────────────────────────────────────── */
  function defOverlay(){
    let ov=document.getElementById("sloDefOv");
    if(!ov){
      ov=document.createElement("div"); ov.id="sloDefOv"; ov.className="modal-overlay";
      ov.innerHTML=`<div class="modal-card sd-modal" id="sloDefCard" role="dialog" aria-modal="true" aria-label="SLO definition"></div>`;
      document.body.appendChild(ov);
      ov.addEventListener("click",e=>{ if(e.target===ov) closeDef(); });
    }
    return ov;
  }
  function closeDef(){ const ov=document.getElementById("sloDefOv"); if(ov) ov.classList.remove("open"); document.removeEventListener("keydown",defKeys); EDIT_KEY=null; }
  function defKeys(e){
    if(e.key==="Escape"){ e.preventDefault(); closeDef(); }
    else if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){ e.preventDefault(); applyDef(); }
  }
  function openDef(key){
    const s=DRAFT&&DRAFT.find(x=>x.key===key); if(!s) return;
    EDIT_KEY=key;
    const ov=defOverlay(), card=ov.querySelector("#sloDefCard");
    const hint={met:"Shown on the SLO card while the journey sits inside its target.",
                at_risk:"Shown inside the warning band — the operator's early warning.",
                breached:"Shown once the target is missed; say what to check first."};
    card.innerHTML=`
      <div class="modal-head"><span class="path">SLO definition · ${esc(businessLabel(s.business))}</span><span class="x" id="sdX" role="button" aria-label="Close">×</span></div>
      <div class="modal-body sd-body">
        <div class="sd-mhead">
          <label class="slo-switch" title="Measured / not measured"><input type="checkbox" id="sdEnabled" ${s.enabled!==false?"checked":""}><span></span></label>
          <div style="flex:1;min-width:0">
            <input id="sdLabel" class="sd-labelin" value="${esc(s.label||"")}" placeholder="Definition name">
            <div class="sd-key"><span class="mono">${esc(s.key)}</span>${s.group?` · ${esc(s.group)}`:""}${s.note?` · ${esc(s.note)}`:""}</div>
          </div>
        </div>
        <h5>How it is measured</h5>
        <div id="sdRule"></div>
        <h5>What this produces</h5>
        <div id="sdPreview"></div>
        <h5>Operator messages</h5>
        <div class="sd-msgs">${["met","at_risk","breached"].map(k=>
          `<label><span>${k==="at_risk"?"Near target":k[0].toUpperCase()+k.slice(1)}</span>
            <textarea id="sdM_${k}" rows="3" placeholder="What an operator should read in this state">${esc((s.messages&&s.messages[k])||"")}</textarea>
            <i>${esc(hint[k])}</i></label>`).join("")}</div>
      </div>
      <div class="sd-foot">
        <span class="sd-footnote">Applies to the draft — the page Save writes it to the console database.</span>
        <button type="button" class="pill sd-ghost" id="sdCancel">Cancel</button>
        <button type="button" class="pill sd-apply" id="sdApply">Apply</button>
      </div>`;
    paintRule();
    card.querySelector("#sdX").onclick=closeDef;
    card.querySelector("#sdCancel").onclick=closeDef;
    card.querySelector("#sdApply").onclick=applyDef;
    card.querySelector("#sdEnabled").addEventListener("change",paintPreview);
    ov.classList.add("open");
    document.addEventListener("keydown",defKeys);
    setTimeout(()=>{ const el=card.querySelector("#sdLabel"); if(el){ el.focus(); el.select(); } },40);
  }

  /* Read the modal back into a definition object. Direction and unit are read BEFORE the target,
   * so flipping percent -> count/day keeps the number the operator is looking at and changes what
   * it means, rather than silently dividing it by a hundred. */
  function formDef(){
    const base=(DRAFT&&DRAFT.find(x=>x.key===EDIT_KEY))||{};
    const s=JSON.parse(JSON.stringify(base));
    const g=id=>document.getElementById(id);
    if(g("sdLabel")) s.label=g("sdLabel").value;
    if(g("sdEnabled")) s.enabled=g("sdEnabled").checked;
    if(g("sdDir")) s.direction=g("sdDir").value;
    if(g("sdUnit")) s.unit=g("sdUnit").value;
    if(g("sdWin")){ const w=Number(g("sdWin").value); if(Number.isFinite(w)&&w>0) s.windowDays=w; }
    if(g("sdTarget")){
      const v=g("sdTarget").value;
      if(s.targetMode==="rolling_floor") s.marginPp=Number(v)||0;
      else if(s.unit==="state") s.targetText=v;
      else { const n=Number(v); if(Number.isFinite(n)) s.target = s.unit==="percent" ? n/100 : n; }
    }
    if(g("sdWarn")){ const w=Number(g("sdWarn").value); if(Number.isFinite(w)) s.warnBand = s.unit==="percent" ? w/100 : w; }
    ["met","at_risk","breached"].forEach(k=>{ const el=g("sdM_"+k); if(el){ s.messages=s.messages||{}; s.messages[k]=el.value; } });
    return s;
  }
  /* The rule grid re-renders on direction/unit change because those decide which target control is
   * even meaningful: a state SLO has no numeric target, a rolling floor has no fixed one. */
  function paintRule(){
    const host=document.getElementById("sdRule"); if(!host) return;
    const s=formDef();
    const isRoll=s.targetMode==="rolling_floor", isState=s.unit==="state";
    const tField = isRoll
      ? `<label><span>Rolling margin</span><div class="sd-inline"><input id="sdTarget" type="number" min="0" max="100" step="0.5" value="${esc(s.marginPp==null?"":s.marginPp)}"><em>pp below the ${esc(String(s.baselineDays||7))}-day average</em></div></label>`
      : isState
      ? `<label><span>Target state</span><input id="sdTarget" value="${esc(s.targetText||"")}" placeholder="SUCCESS daily"></label>`
      : `<label><span>Target</span><div class="sd-inline"><input id="sdTarget" type="number" step="0.1" min="0" value="${esc(fmtTarget(s))}"><em>${esc(s.unit==="percent"?"%":(unitSfx(s.unit).trim()||"value"))}</em></div></label>`;
    host.innerHTML=`<div class="sd-rule-grid">
      <label><span>Rule</span><div class="sd-inline"><select id="sdDir">
        <option value="gte" ${s.direction==="gte"?"selected":""}>≥ target</option>
        <option value="lte" ${s.direction==="lte"?"selected":""}>≤ target</option>
        <option value="state" ${s.direction==="state"?"selected":""}>state</option></select>
        <em>${s.direction==="lte"?"lower is better":s.direction==="state"?"must match a value":"higher is better"}</em></div></label>
      <label><span>Unit</span><select id="sdUnit">
        <option value="percent" ${s.unit==="percent"?"selected":""}>percent</option>
        <option value="count_per_day" ${s.unit==="count_per_day"?"selected":""}>count / day</option>
        <option value="count_per_24h" ${s.unit==="count_per_24h"?"selected":""}>count / 24h</option>
        <option value="ms" ${s.unit==="ms"?"selected":""}>milliseconds</option>
        <option value="state" ${s.unit==="state"?"selected":""}>state</option></select></label>
      ${tField}
      <label><span>Warning band</span>${isState
        ? `<input disabled value="—">`
        : `<div class="sd-inline"><input id="sdWarn" type="number" step="0.1" min="0" value="${esc(fmtWarn(s))}"><em>${esc(s.unit==="percent"?"pp":(unitSfx(s.unit).trim()||"wide"))}</em></div>`}</label>
      <label><span>Window</span><div class="sd-inline"><input id="sdWin" type="number" min="1" max="400" step="1" value="${esc(s.windowDays==null?"":s.windowDays)}"><em>days</em></div></label>
    </div>`;
    host.querySelectorAll("select").forEach(el=>el.addEventListener("change",paintRule));
    host.querySelectorAll("input").forEach(el=>el.addEventListener("input",paintPreview));
    paintPreview();
  }
  function paintPreview(){
    const host=document.getElementById("sdPreview"); if(!host) return;
    const s=formDef();
    host.innerHTML=bandStrip(s,true)+
      `<div class="sd-prevnote">${s.enabled===false
        ? "Not measured — this definition produces no dashboard card and no verdict."
        : "Measured over "+esc(String(s.windowDays||"—"))+" day"+(Number(s.windowDays)===1?"":"s")+", on the Executive Dashboard and SLA attainment."}</div>`;
  }
  function applyDef(){
    if(!EDIT_KEY||!DRAFT) return closeDef();
    const s=formDef(), i=DRAFT.findIndex(x=>x.key===EDIT_KEY);
    if(i>=0) DRAFT[i]=s;
    const k=EDIT_KEY;
    markDirty(k); closeDef(); paintCards(); refreshChrome();
    const card=document.querySelector('.sd-card[data-key="'+(window.CSS&&CSS.escape?CSS.escape(k):k)+'"]');
    if(card){ card.classList.add("flash"); setTimeout(()=>card.classList.remove("flash"),900); }
  }

  function discardDraft(){
    if(!DIRTY.size) return;
    if(!confirm("Discard "+DIRTY.size+" unsaved definition change"+(DIRTY.size===1?"":"s")+"?")) return;
    resetDraft(); paintSloConfig();
    const st=$("#sloCfgStatus"); if(st) st.textContent="";
  }
  async function saveSloConfig(){
    if(!DIRTY.size) return;
    const st=$("#sloCfgStatus"); if(st) st.textContent="Saving…";
    try{
      CFG=await api("/api/slo/config",{method:"PUT",body:JSON.stringify(Object.assign({},CFG,{slos:DRAFT}))});
      resetDraft(); paintSloConfig(); loadSlos();
      if(st) st.textContent="Saved. Executive Dashboard SLO cards, SLA attainment and health messages now use these values.";
    }catch(e){ if(st) st.innerHTML=`<span style="color:#dc2626">Save failed: ${esc(e.message)}</span>`; }
  }
  async function resetSloConfig(){
    if(!confirm("Reset SLO target definitions to the Salam defaults? Any unsaved changes are discarded too.")) return;
    const st=$("#sloCfgStatus"); if(st) st.textContent="Resetting…";
    try{ CFG=await api("/api/slo/config/reset",{method:"POST",body:"{}"}); resetDraft(); paintSloConfig(); loadSlos();
      if(st) st.textContent="Defaults restored."; }
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
