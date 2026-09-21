/* SLA page — SLO attainment + error budgets per journey. (Vendor & integration health moved to
 * Monitoring › Gateway & API on 21 Sep 2026 — see monitoring.js renderVendors.)
 * MVNO | Fixed tabs (21 Sep 2026): one tab per business, deep-linkable as #slo?tab=mobile|fixed
 * (the Executive Dashboard's "SLO / SLA" links land on the matching tab). */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const API = window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  const tv=(n,fb)=>{const v=getComputedStyle(document.documentElement).getPropertyValue(n).trim();return v||fb;};
  let CFG=null;
  let CFG_ACTIVE="mobile";
  const pct=v=> v==null?"—":(v*100).toFixed(1)+"%";
  const statusColor=s=> s==='met'?"#16a34a":s==='at_risk'?"#d97706":s==='breached'?"#dc2626":"#94a3b8";
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

  /* ── MVNO | Fixed tabs (21 Sep 2026) ───────────────────────────────────────────────────────
   * The page used to be one grid mixing both businesses, so "SLO / SLA" on the Executive
   * Dashboard's Fixed panel landed on MVNO cards first. The tab comes from, in order: the link
   * (#slo?tab=fixed — also accepts mvno), the tab already open, the last one chosen, else the
   * account's business. A single-business account sees its own business only, no tab bar.
   * Switching tabs re-filters what is already loaded (no refetch) and never re-renders the
   * acknowledgement section, so an unsaved edit there survives a switch — its Save still sends
   * both businesses, because the other business's card is hidden, not removed. */
  const SLO_TABS={
    mobile:{ label:"MVNO", sub:"journeys · integrations",
      icon:'<rect x="6.5" y="2.5" width="11" height="19" rx="2.4"/><path d="M10.5 18.5h3"/>' },
    fixed:{ label:"Fixed", sub:"FTTH · 5G · app",
      icon:'<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M6 9.6v10h12v-10"/><path d="M10 19.6v-5h4v5"/>' }
  };
  let TAB=null, OPEN_TAB=null, SLO_DATA=null, SLO_SEQ=0;
  const normTab=v=>{ v=String(v||"").toLowerCase(); return (v==="mobile"||v==="mvno")?"mobile":v==="fixed"?"fixed":null; };
  /* an objective's business: 'both' shows on both tabs; a journey objective without a definition is an MVNO journey */
  const sloBiz=s=>{ const b=String((s&&s.business)||"mobile").toLowerCase(); return b==="fixed"||b==="both"?b:"mobile"; };
  const inTab=(s,t)=>{ const b=sloBiz(s); return b==="both"||b===t; };
  function allowedTabs(){
    const me=((window.opsSession&&window.opsSession())||{}).me||{};
    return me.business==="mobile"?["mobile"]:me.business==="fixed"?["fixed"]:["mobile","fixed"];
  }
  function pickTab(req){
    const ok=allowedTabs();
    const fromHash=(/[?&]tab=([a-z]+)/.exec(location.hash||"")||[])[1];
    let saved=null; try{ saved=window.pf?window.pf.get("slo_tab",null):null; }catch(e){ saved=null; }
    for(const c of [req,fromHash,TAB,saved]){ const t=normTab(c); if(t&&ok.includes(t)) return t; }
    return ok[0];
  }
  const hashBase=()=>/^#sla(?:\?|$)/.test(location.hash||"")?"sla":"slo";
  /* the open tab is part of the URL, so a copied link opens the same view (replaceState: no hashchange, no reload) */
  function syncTabHash(){ try{ const h="#"+hashBase()+"?tab="+TAB; if(location.hash!==h&&history.replaceState) history.replaceState(null,"",h); }catch(e){} }
  function tabStats(t){
    if(!SLO_DATA) return null;
    const c={n:0,met:0,at_risk:0,breached:0,nodata:0};
    SLO_DATA.filter(s=>inTab(s,t)).forEach(s=>{ c.n++;
      if(s.status==="met") c.met++; else if(s.status==="at_risk") c.at_risk++; else if(s.status==="breached") c.breached++; else c.nodata++; });
    return c;
  }
  function paintTabs(){
    const bar=$("#sloTabs"); if(!bar) return;
    const tabs=allowedTabs();
    bar.innerHTML=tabs.map(t=>{
      const m=SLO_TABS[t], on=t===TAB, st=tabStats(t);
      let chip="", line=esc(m.sub);
      if(st){
        chip=!st.n?`<span class="slo-tab-chip">none</span>`
          :st.breached?`<span class="slo-tab-chip bad">${st.breached} breached</span>`
          :st.at_risk?`<span class="slo-tab-chip warn">${st.at_risk} at risk</span>`
          :st.met===st.n?`<span class="slo-tab-chip ok">all met</span>`
          :st.met?`<span class="slo-tab-chip ok">${st.met} met</span>`
          :`<span class="slo-tab-chip">no data</span>`;
        const parts=[st.n?`${st.n} objective${st.n===1?"":"s"}`:"no objective enabled"];
        if(st.breached||st.at_risk) parts.push(`${st.met} met`);
        if(st.breached&&st.at_risk) parts.push(`${st.at_risk} at risk`);
        if(st.nodata&&st.nodata<st.n) parts.push(`${st.nodata} no data`);
        line=parts.join(" · ");
      }
      return `<button type="button" role="tab" id="sloTab-${t}" class="slo-tab${on?" on":""}" data-tab="${t}" aria-selected="${on}" aria-controls="sloPane" tabindex="${on?0:-1}">
        <span class="slo-tab-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${m.icon}</svg></span>
        <span class="slo-tab-tx"><b>${esc(m.label)}</b><span>${line}</span></span>${chip}</button>`;
    }).join("");
    bar.querySelectorAll(".slo-tab").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
    /* WAI-ARIA tabs: ← / → move between the two tabs */
    bar.onkeydown=e=>{
      if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight") return;
      const i=tabs.indexOf(TAB), n=tabs[(i+(e.key==="ArrowRight"?1:tabs.length-1))%tabs.length];
      e.preventDefault(); setTab(n); const nb=bar.querySelector('.slo-tab[data-tab="'+n+'"]'); if(nb) nb.focus();
    };
  }
  function setTab(t){
    t=normTab(t); if(!t||!allowedTabs().includes(t)||t===TAB) return;
    TAB=t; try{ if(window.pf) window.pf.set("slo_tab",t); }catch(e){}
    const pg=document.querySelector("#view-slo .slo-page"); if(pg) pg.dataset.tab=t;
    const pane=$("#sloPane"); if(pane&&pane.hasAttribute("aria-labelledby")) pane.setAttribute("aria-labelledby","sloTab-"+t);
    paintTabs(); paintSlos(); syncTabHash();
    if(window.audit) window.audit("VIEW_PAGE","#"+hashBase()+"?tab="+t);
  }

  async function render(){
    const host=$("#view-slo"); if(!host) return;
    TAB=pickTab(OPEN_TAB); OPEN_TAB=null; SLO_DATA=null;
    try{ if(window.pf) window.pf.set("slo_tab",TAB); }catch(e){}
    const tabs=allowedTabs();
    host.innerHTML=`<div class="panel slo-page" data-tab="${TAB}">
      <div class="slo-page-head">
        <div><h2>Service levels</h2>
          <div class="sub">SLO attainment and error budgets per business — read from rollups, so it's instant.<span class="slo-only-mobile"> Vendor &amp; integration health lives in <a href="#monitoring?tab=gateway" style="color:var(--green);font-weight:700">Monitoring › Gateway &amp; API</a>.</span></div></div>
        ${isSuper()?`<button class="pill" id="sloOpenSettings" style="border-left-color:var(--green)">⚙ SLO definitions</button>`:''}
      </div>
      ${tabs.length>1?`<div class="slo-tabs" id="sloTabs" role="tablist" aria-label="Business"></div>`
        :`<div class="slo-scope">Showing <b>${esc(SLO_TABS[TAB].label)}</b> — your account is scoped to ${TAB==="fixed"?"Fixed":"Mobile"}.</div>`}
      <div id="sloPane"${tabs.length>1?` role="tabpanel" aria-labelledby="sloTab-${TAB}"`:""}>
        <h2 style="margin-top:14px">Current SLO attainment</h2>
        <div id="sloCards" class="slo-grid" style="margin-top:14px"></div>
        <div class="slo-only-mobile">
          <h2 style="margin-top:24px">Anomaly detection</h2>
          <div class="sub">Live signals vs each MVNO journey's seasonal baseline (hour-of-week median, robust z-score) — catches spikes &amp; drops a fixed threshold would miss.</div>
          <div id="anomBoard" style="margin-top:10px"></div>
        </div>
        <h2 style="margin-top:24px">Acknowledgement SLA — reminders &amp; escalation</h2>
        <div class="sub">What happens when nobody on L1 / L2 acknowledges an alert: reminder 1 → reminder 2 (warning) → reminder 3 + management escalation, per priority. The on / off switch and flap control apply to both businesses.</div>
        <div id="ackSlaBoard" style="margin-top:10px"></div>
      </div>
    </div>`;
    paintTabs(); syncTabHash();
    /* definitions open on the same business as the tab */
    const cfgBtn=$("#sloOpenSettings"); if(cfgBtn) cfgBtn.addEventListener("click",()=>{ CFG_ACTIVE=TAB; location.hash="#slo-settings"; });
    loadSlos(); loadAnomalies(); if(window.renderAckSlaSettings) window.renderAckSlaSettings($("#ackSlaBoard"));
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
  let DRAFT_DEFAULT=true, BASE_DEFAULT=true;   // Counts: the page-wide "count business errors" default
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
      location.hash="#sla?tab="+(CFG_ACTIVE==="fixed"?"fixed":"mobile");   // back to the business being edited
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
    DRAFT_DEFAULT=BASE_DEFAULT=!(CFG&&CFG.countBusinessErrors===false);
    BASE={}; DRAFT.forEach(s=>{ BASE[s.key]=stable(s); }); DIRTY.clear();
  }
  function markDirty(k){
    const cur=DRAFT.find(x=>x.key===k); if(!cur) return;
    if(stable(cur)===BASE[k]) DIRTY.delete(k); else DIRTY.add(k);
  }
  function sloBar(){
    const n=DIRTY.size+(DRAFT_DEFAULT===BASE_DEFAULT?0:1), bar=$("#sloDirtyBar");
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
      <div class="sd-counts">
        <label class="slo-switch" title="Count business outcomes in every objective that can tell them apart"><input type="checkbox" id="sloCountBiz" ${DRAFT_DEFAULT?"checked":""}><span></span></label>
        <div>
          <b>Count business errors</b>
          <div class="rl" style="font-weight:400;letter-spacing:0;color:var(--muted)">${DRAFT_DEFAULT
            ? "Every objective counts all negative outcomes — a declined card and a BSS timeout weigh the same. Switch off to measure platform health only; each objective can still override it."
            : "Objectives count <b>technical failures only</b> — the platform broke. Business outcomes (declines, denials, refusals) are excluded wherever the signal can tell them apart."}</div>
        </div>
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
    const cb=box.querySelector("#sloCountBiz");
    if(cb) cb.addEventListener("change",()=>{ DRAFT_DEFAULT=cb.checked; sloBar(); paintSloConfig(); });
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

  /* what this objective counts, on the card — so an operator can see at a glance why one reads
   * differently from the error board. Silent when it counts everything, which is the default. */
  function effCls(s){
    if(s.classLocked) return s.classLocked;
    if(!s.classCapable) return "all";
    const allowed=(s.classAllowed&&s.classAllowed.length?s.classAllowed:["all","technical","business"]);
    if(allowed.includes(s.errorClass)) return s.errorClass;
    const inherited=(DRAFT_DEFAULT===false)?"technical":"all";
    return allowed.includes(inherited)?inherited:allowed[0];
  }
  function clsChip(s){
    const c=effCls(s); if(c==="all") return "";
    return `<span class="sd-cls-chip${c==="business"?" biz":""}" title="${esc(s.classLocked?("fixed — "+(s.classNote||"")):"counts "+CLS_LABEL[c].toLowerCase())}">${c==="technical"?"technical only":"business only"}</span>`;
  }
  function defCard(s){
    const off=s.enabled===false, dirty=DIRTY.has(s.key);
    const met=(s.messages&&s.messages.met)||"";
    return `<article class="sd-card${off?" off":""}${dirty?" dirty":""}" data-key="${esc(s.key)}" tabindex="0">
      <div class="sd-top">
        <label class="slo-switch" title="${off?"Not measured — no dashboard card, no verdict":"Measured"}">
          <input type="checkbox" ${off?"":"checked"} aria-label="Measure ${esc(s.label||s.key)}"><span></span></label>
        <div class="sd-id">
          <div class="sd-name">${esc(s.label||s.key)}${clsChip(s)}${dirty?`<em class="sd-tag">changed</em>`:""}${off?`<em class="sd-tag off">not measured</em>`:""}</div>
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
    if(g("sdCls")) s.errorClass=g("sdCls").value||null;
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
  /* COUNTS — business vs technical (20 Sep 2026).
   * Whether a signal CAN be split is a fact about the signal, decided server-side (classCapable /
   * classLocked / classAllowed) and never editable here. Where it cannot, the control still renders
   * — disabled, with the reason in words — because a hidden control teaches an operator nothing and
   * a silently-ignored one is worse. Blank means "follow the page default". */
  const CLS_LABEL={all:"All errors",technical:"Technical errors only",business:"Business outcomes only"};
  function countsField(s){
    const inherited=(DRAFT_DEFAULT===false)?"technical":"all";
    if(s.classLocked) return `<label><span>Counts</span>
      <select disabled><option>${esc(CLS_LABEL[s.classLocked])}</option></select>
      <em class="sd-why">fixed — ${esc(s.classNote||"this objective measures that class by design")}</em></label>`;
    if(!s.classCapable) return `<label><span>Counts</span>
      <select disabled><option>All errors</option></select>
      <em class="sd-why">not split — ${esc(s.classNote||"this signal carries no error class")}</em></label>`;
    const allowed=(s.classAllowed&&s.classAllowed.length?s.classAllowed:["all","technical","business"]);
    const cur=allowed.includes(s.errorClass)?s.errorClass:"";
    const canInherit=allowed.includes(inherited);
    return `<label><span>Counts</span><select id="sdCls">
        ${canInherit?`<option value="" ${cur===""?"selected":""}>Page default — ${esc(CLS_LABEL[inherited])}</option>`:""}
        ${allowed.map(v=>`<option value="${v}" ${cur===v?"selected":""}>${esc(CLS_LABEL[v])}</option>`).join("")}
      </select>${allowed.includes("all")?"":`<em class="sd-why">recorded per class — there is no combined series</em>`}</label>`;
  }
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
      ${countsField(s)}
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
        : (!s.journey && !(s.metric&&s.metric.key))
          /* alpha.59 — an objective with neither a journey rollup nor a metric snapshot has no
             attainment series to draw. Saying "and SLA attainment" here would promise a card that
             can never appear. Payment reliability is the first of these: it is computed on the
             Executive Dashboard from settled vs unconfirmed payments. */
          ? "Measured on the Executive Dashboard only — this definition has no rollup or snapshot series, so the target below drives the tile and there is no attainment card."
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
    if(!DIRTY.size && DRAFT_DEFAULT===BASE_DEFAULT) return;
    const st=$("#sloCfgStatus"); if(st) st.textContent="Saving…";
    try{
      CFG=await api("/api/slo/config",{method:"PUT",body:JSON.stringify(Object.assign({},CFG,{slos:DRAFT,countBusinessErrors:DRAFT_DEFAULT}))});
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
    const seq=++SLO_SEQ;   // a re-render while this is in flight (theme / data refresh) owns the page now
    let d; try{ d=await api("/api/slo"); }catch(e){
      if(seq!==SLO_SEQ) return;
      // hidden root tier: the server answers 403 {error:'restricted'} — show a clean panel, not an error banner
      if(/^restricted$/i.test(e.message||"")){ const host=$("#view-slo"); if(host) host.innerHTML=`<div class="panel" style="text-align:center;padding:34px 20px">
        <div style="font-size:26px">🔒</div>
        <h2 style="margin:8px 0 4px">Restricted</h2>
        <div class="sub">The SLA page is limited to the platform owner.</div></div>`; return; }
      const b2=$("#sloCards"); if(b2) b2.innerHTML=`<div class="albanner" style="grid-column:1/-1">${esc(e.message)}</div>`; return; }
    if(seq!==SLO_SEQ) return;
    SLO_DATA=d.slos||[];
    paintTabs(); paintSlos();
  }
  /* the cards of the open tab, from what loadSlos already fetched */
  function paintSlos(){
    const box=$("#sloCards"); if(!box||!SLO_DATA) return;
    if(!SLO_DATA.length){ box.innerHTML=`<div class="okbox" style="grid-column:1/-1">No SLO targets yet.</div>`; return; }
    const slos=SLO_DATA.filter(s=>inTab(s,TAB));
    if(!slos.length){ box.innerHTML=`<div class="okbox" style="grid-column:1/-1">No ${esc(businessLabel(TAB))} objective is enabled yet${isSuper()?" — add or enable one in SLO definitions":""}.</div>`; return; }
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
    box.querySelectorAll(".slo-edit").forEach(b=>b.addEventListener("click",()=>{ CFG_ACTIVE=TAB; location.hash="#slo-settings"; }));
  }


  // SLA lives in the Settings gear menu (no nav tab) — activate its view directly,
  // mirroring window.openWorkbench: deactivate all tabs + views, clear the gear/opsBar, then render.
  // tab (optional): 'mobile' | 'mvno' | 'fixed' — otherwise read from #slo?tab=…, then the last one open.
  window.openSla=(tab)=>{
    const v=$("#view-slo"); if(!v) return;
    OPEN_TAB=normTab(tab);
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
