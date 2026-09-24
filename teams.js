/* Settings › Teams — the responder-team registry (24 Sep 2026). Super Admin page #teams.
 * business × domain × level, bound to the vendor contract that carries the obligations; members with their rights
 * (ack · resolve · re-assign); the rules and open incidents each team owns; the contract clocks that apply. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const API = window.API_BASE || "";
  const esc = s => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const api = (p, opts) => window.fetch(API + p, Object.assign({ headers: { "Content-Type": "application/json" } }, opts))
    .then(r => { if(!r.ok) return r.json().then(e => { throw new Error(e.error || ("HTTP " + r.status)); }); return r.json(); });
  const isSuper = () => { const s = (window.opsSession && window.opsSession()) || {}; return !!(s.me && (s.me.realRole === "super_admin" || (s.me.realRoles || []).includes("super_admin"))); };
  const DOMAIN_COLOR={ digital:"#0e9f5a", bss:"#7c3aed", oss:"#0891b2", infra:"#64748b", adm:"#d97706", network:"#2563eb", soc:"#dc2626", payments:"#db2777", rafm:"#9333ea", sales:"#ca8a04", other:"#64748b" };
  let REG = null, ACTIVE = null, USERS = null, VENDORS = null, FILTER = { biz:"all", q:"" };

  function installCss(){
    if(document.getElementById("teamsCss")) return;
    const st=document.createElement("style"); st.id="teamsCss"; st.textContent=`
      #view-teams .tm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:12px;flex-wrap:wrap}
      #view-teams .tm-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:900}
      #view-teams .tm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}
      #view-teams .tm-kpis>div{border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--card2,var(--card))}
      #view-teams .tm-kpis b{display:block;font-size:22px;color:var(--ink)} #view-teams .tm-kpis span{font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.08em}
      #view-teams .tm-grid{display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:14px;align-items:start}
      #view-teams .tm-dom{font-size:10.5px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:12px 0 6px;display:flex;align-items:center;gap:8px}
      #view-teams .tm-dom i{width:10px;height:10px;border-radius:3px;background:var(--dc);display:inline-block}
      #view-teams .tm-card{width:100%;text-align:left;border:1px solid var(--line);border-left:4px solid var(--dc);border-radius:10px;background:var(--card);padding:10px 12px;margin-bottom:6px;cursor:pointer;color:var(--ink);font:inherit}
      #view-teams .tm-card:hover{border-color:var(--dc)} #view-teams .tm-card.on{background:var(--card2,var(--card));box-shadow:0 0 0 2px var(--dc) inset}
      #view-teams .tm-card h3{margin:0;font-size:13.5px} #view-teams .tm-card .rl{display:block;margin-top:3px}
      #view-teams .tm-badges{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}
      #view-teams .tm-b{font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
      #view-teams .tm-b.warn{color:#d97706;border-color:#d97706} #view-teams .tm-b.bad{color:#dc2626;border-color:#dc2626} #view-teams .tm-b.ok{color:var(--green);border-color:var(--green)}
      #view-teams .tm-detail{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:16px;position:sticky;top:8px}
      #view-teams .tm-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
      #view-teams .tm-form label{display:block;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
      #view-teams .tm-form input,#view-teams .tm-form select,#view-teams .tm-form textarea{width:100%;font:inherit;font-size:13px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2,var(--card));color:var(--ink);box-sizing:border-box}
      #view-teams .tm-form .full{grid-column:1/-1}
      #view-teams .tm-sec{margin-top:16px} #view-teams .tm-sec h4{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
      #view-teams .tm-clocks{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
      #view-teams .tm-clock{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--card2,var(--card))} #view-teams .tm-clock span{display:block;font-size:10.5px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.06em} #view-teams .tm-clock b{font-size:13px}
      #view-teams .tm-members{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:6px;max-height:340px;overflow:auto;padding:2px}
      #view-teams .tm-m{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--card2,var(--card))}
      #view-teams .tm-m.off{opacity:.55} #view-teams .tm-m .who{flex:1;min-width:0} #view-teams .tm-m .who b{display:block;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} #view-teams .tm-m .who span{font-size:11px;color:var(--muted)}
      #view-teams .tm-m .rts{display:flex;gap:4px} #view-teams .tm-m .rts label{font-size:10px;font-weight:800;color:var(--muted);display:flex;align-items:center;gap:2px;cursor:pointer}
      #view-teams .tm-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
      @media (max-width:900px){ #view-teams .tm-grid{grid-template-columns:1fr} #view-teams .tm-detail{position:static} }`;
    document.head.appendChild(st);
  }
  function activateView(){
    document.querySelectorAll(".navtab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x => x.classList.toggle("active", x.id === "view-teams"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.add("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
  }
  function shell(inner){
    const host=$("#view-teams"); if(!host) return; installCss();
    host.innerHTML=`<div class="panel"><div class="tm-head"><div><div class="tm-kicker">INCIDENT OWNERSHIP</div><h2 style="margin:2px 0">Responder teams</h2>
      <div class="sub">Who owns which incident: business × domain × level, bound to the vendor contract whose clocks apply. Members may ack, resolve and re-assign the team's incidents; the per-business ACK holders stay the on-call fallback. Agent 2 proposes the rule → team mapping under Alerts › Alert rules.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="pill" href="#alerts" style="border-left-color:#2563eb;text-decoration:none">Alert rules · team mapping</a><a class="pill" href="#vendor-contracts" style="text-decoration:none">Vendors &amp; contracts</a><button class="pill" id="tmNew" style="border-left-color:var(--green)">＋ New team</button></div></div>
      <div id="tmBody">${inner||'<div class="sub">Loading…</div>'}</div></div>`;
    const nb=$("#tmNew"); if(nb) nb.onclick=()=>{ ACTIVE="__new"; paint(); };
  }
  window.openTeams = async function(){
    activateView();
    if(!isSuper()){ shell(`<div style="text-align:center;padding:34px 20px"><div style="font-size:26px">Locked</div><h2 style="margin:8px 0 4px">Super Admin Only</h2><div class="sub">Team membership decides who may act on which incident — it is controlled by super users.</div></div>`); return; }
    shell();
    try{
      const [reg, users, vc] = await Promise.all([api("/api/teams?all=1"), api("/api/users").catch(()=>({users:[]})), api("/api/vendor-contracts").catch(()=>null)]);
      REG=reg; USERS=(users.users||[]).filter(u=>u.enabled!==false).sort((a,b)=>String(a.name||a.email).localeCompare(String(b.name||b.email))); VENDORS=vc;
      if(!ACTIVE || (ACTIVE!=="__new" && !REG.teams.some(t=>t.key===ACTIVE))) ACTIVE=(REG.teams[0]||{}).key||null;
      paint();
    }catch(e){ const b=$("#tmBody"); if(b) b.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; }
  };
  const bizIcon=b=>b==="fixed"?"🏠 Fixed":b==="mobile"?"📱 Mobile":"📱🏠 Both";
  function paint(){
    const b=$("#tmBody"); if(!b||!REG) return;
    const teams=REG.teams||[]; const active=teams.filter(t=>t.active);
    const withMembers=active.filter(t=>t.members>0).length, bound=active.filter(t=>t.vendor_id).length, members=active.reduce((n,t)=>n+(t.members||0),0);
    const q=FILTER.q.trim().toLowerCase();
    const shown=teams.filter(t=>(FILTER.biz==="all"||t.business==="both"||t.business===FILTER.biz)&&(!q||[t.key,t.name,t.description,t.vendor_id,(t.aliases||[]).join(" ")].join(" ").toLowerCase().includes(q)));
    const groups={}; shown.forEach(t=>{ (groups[t.domain]=groups[t.domain]||[]).push(t); });
    b.innerHTML=`<div class="tm-kpis"><div><b>${active.length}</b><span>active teams</span></div><div><b>${members}</b><span>memberships</span></div><div><b style="color:${withMembers<active.length?'#d97706':'var(--green)'}">${active.length-withMembers}</b><span>teams without members</span></div><div><b>${bound}</b><span>bound to a contract</span></div></div>
      <div class="rfbar" style="margin:0 0 6px"><div class="rfchips">${[["all","All"],["mobile","📱 Mobile"],["fixed","🏠 Fixed"]].map(([v,l])=>`<button class="pill rfc${FILTER.biz===v?" active":""}" data-biz="${v}" style="padding:3px 10px">${l}</button>`).join("")}</div><input id="tmQ" class="jsearch" type="search" placeholder="search team · vendor · alias…" value="${esc(FILTER.q)}" style="flex:1 1 200px"></div>
      <div class="tm-grid"><aside>${Object.keys(groups).map(d=>`<div class="tm-dom" style="--dc:${DOMAIN_COLOR[d]||'#64748b'}"><i></i>${esc((REG.domains||{})[d]||d)}</div>${groups[d].map(card).join("")}`).join("")||'<div class="okbox">No team matches.</div>'}</aside><section class="tm-detail" id="tmDetail"></section></div>`;
    b.querySelectorAll("[data-biz]").forEach(x=>x.onclick=()=>{ FILTER.biz=x.dataset.biz; paint(); });
    let t=null; $("#tmQ").addEventListener("input",e=>{ FILTER.q=e.target.value; clearTimeout(t); t=setTimeout(paint,200); });
    b.querySelectorAll(".tm-card").forEach(c=>c.onclick=()=>{ ACTIVE=c.dataset.key; paint(); });
    paintDetail();
  }
  function card(t){
    return `<button type="button" class="tm-card${t.key===ACTIVE?" on":""}" data-key="${esc(t.key)}" style="--dc:${DOMAIN_COLOR[t.domain]||'#64748b'}${t.active?"":";opacity:.5"}"><h3>${esc(t.name)}</h3><span class="rl">${bizIcon(t.business)} · ${esc(t.level)}${t.vendor_id?` · ${esc(t.vendor_id)}`:" · Salam internal"}</span>
      <div class="tm-badges"><span class="tm-b ${t.members?"ok":"warn"}">${t.members||0} member${t.members===1?"":"s"}</span>${t.contract_id?`<span class="tm-b">contract</span>`:""}${t.mail_dl?`<span class="tm-b">DL</span>`:""}${!t.active?`<span class="tm-b bad">inactive</span>`:""}</div></button>`;
  }
  async function paintDetail(){
    const host=$("#tmDetail"); if(!host) return;
    const isNew=ACTIVE==="__new"; const base=isNew?{ key:"", name:"", business:"both", domain:"other", level:"L2", aliases:[], keywords:[], active:true, sort:100 }:(REG.teams.find(t=>t.key===ACTIVE)||null);
    if(!base){ host.innerHTML=`<div class="sub">Pick a team.</div>`; return; }
    let det={ members:[], obligations:null, load:{}, rules:[] };
    if(!isNew){ host.innerHTML=`<div class="sub">Loading ${esc(base.name)}…</div>`; try{ det=await api("/api/teams/"+encodeURIComponent(base.key)); }catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; } }
    const vendors=(VENDORS&&VENDORS.vendors)||[], contracts=(VENDORS&&VENDORS.contracts)||[];
    const opt=(list,cur,lab)=>`<option value="">— none</option>`+list.map(x=>`<option value="${esc(x.id)}"${x.id===cur?" selected":""}>${esc(lab(x))}</option>`).join("");
    const ob=det.obligations; const clocks=ob?[["Response",ob.response],["Restoration",ob.restoration],["Resolution",ob.resolution],["RCA",ob.rca]]:[];
    const tgt=c=>c&&c.target?["P1","P2","P3","P4"].filter(p=>c.target[p]).map(p=>`<div><span class="rl">${p}</span> <b>${esc(c.target[p])}</b></div>`).join("")||Object.entries(c.target).slice(0,3).map(([k,v])=>`<div><span class="rl">${esc(k)}</span> <b>${esc(String(v).slice(0,60))}</b></div>`).join(""):"—";
    const memberSet=new Map(det.members.map(m=>[String(m.email).toLowerCase(),m]));
    host.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap"><div><h3 style="margin:0">${isNew?"New team":esc(base.name)}</h3>${!isNew?`<div class="rl">${bizIcon(base.business)} · ${esc((REG.domains||{})[base.domain]||base.domain)} · ${esc(base.level)}${base.seeded?" · seeded":""} · key <span class="mono">${esc(base.key)}</span></div>`:""}</div>
      ${!isNew?`<div style="display:flex;gap:10px"><div class="tm-clock"><span>open</span><b style="color:${det.load.open?'#dc2626':'inherit'}">${det.load.open||0}</b></div><div class="tm-clock"><span>unacked</span><b style="color:${det.load.unacked?'#d97706':'inherit'}">${det.load.unacked||0}</b></div><div class="tm-clock"><span>30 d</span><b>${det.load.fired_30d||0}</b></div><div class="tm-clock"><span>MTTR</span><b>${det.load.mttr_min!=null?(det.load.mttr_min<60?det.load.mttr_min+" min":(det.load.mttr_min/60).toFixed(1)+" h"):"—"}</b></div></div>`:""}</div>
      <div class="tm-form" style="margin-top:12px">
        <div><label>Key</label><input id="tfKey" value="${esc(base.key)}" ${isNew?"":"disabled"} placeholder="e.g. bss-l2"></div>
        <div><label>Name</label><input id="tfName" value="${esc(base.name)}" placeholder="e.g. Oracle · BSS L3"></div>
        <div><label>Business</label><select id="tfBiz">${["both","mobile","fixed"].map(v=>`<option value="${v}"${base.business===v?" selected":""}>${bizIcon(v)}</option>`).join("")}</select></div>
        <div><label>Domain</label><select id="tfDom">${Object.entries(REG.domains||{}).map(([k,l])=>`<option value="${k}"${base.domain===k?" selected":""}>${esc(l)}</option>`).join("")}</select></div>
        <div><label>Level</label><select id="tfLvl">${(REG.levels||["L1","L2","L3"]).map(v=>`<option${base.level===v?" selected":""}>${v}</option>`).join("")}</select></div>
        <div><label>Vendor</label><select id="tfVendor">${opt(vendors,base.vendor_id,v=>v.name)}</select></div>
        <div><label>Contract</label><select id="tfContract">${opt(contracts,base.contract_id,c=>(c.title||c.id).slice(0,70))}</select></div>
        <div><label>Mail DL</label><input id="tfDl" value="${esc(base.mail_dl||"")}" placeholder="team-dl@salam.sa"></div>
        <div><label>Sort</label><input id="tfSort" type="number" value="${esc(base.sort||100)}"></div>
        <div class="full"><label>Description</label><input id="tfDesc" value="${esc(base.description||"")}" placeholder="what this team owns"></div>
        <div><label>Legacy labels (aliases)</label><input id="tfAliases" value="${esc((base.aliases||[]).join(", "))}" placeholder="BSS Ops, Data Ops"></div>
        <div><label>Keywords for Agent 2 mapping</label><input id="tfKw" value="${esc((base.keywords||[]).join(", "))}" placeholder="billing, invoice, brm"></div>
        <div class="full"><label class="um-check" style="display:inline-flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0"><input type="checkbox" id="tfActive" ${base.active!==false?"checked":""}> <span>Active — offered in re-assign, new ticket and rule editor</span></label></div>
      </div>
      <div class="tm-actions"><button class="um-btn" id="tfSave">${isNew?"Create team":"Save team"}</button><span class="ud-msg" id="tfMsg"></span></div>
      ${!isNew?`<div class="tm-sec"><h4>Contract clocks that apply ${ob?`· ${esc(ob.vendor&&ob.vendor.name||"")}${ob.contract?` · ${esc(ob.contract.title||ob.contract.id)}`:""}`:""}</h4>
        ${ob?`<div class="tm-clocks">${clocks.map(([l,c])=>`<div class="tm-clock"><span>${l}${c&&c.weight?` · ${esc(typeof c.weight==="object"?Object.entries(c.weight).map(([k,v])=>k+" "+v).join(" · "):c.weight)}`:""}</span>${c?tgt(c):"<b>—</b>"}</div>`).join("")}</div>${ob.escalation?`<div class="rl" style="margin-top:6px">Escalation ladder: ${esc(ob.escalation.title)} · <a href="#vendor-contracts" style="color:var(--green)">Vendors &amp; contracts ›</a></div>`:""}`:`<div class="rl">No vendor bound — Salam internal team, the console ack SLA is the only clock.</div>`}</div>
      <div class="tm-sec"><h4>Members · ${det.members.length} <span class="rl" style="text-transform:none;letter-spacing:0;font-weight:400">— tick to add; A = ack · R = resolve · X = re-assign</span></h4>
        <input id="tfMemQ" class="jsearch" type="search" placeholder="filter people…" style="margin-bottom:6px">
        <div class="tm-members" id="tfMembers">${(USERS||[]).map(u=>{ const e=String(u.email).toLowerCase(); const m=memberSet.get(e); const bizOk=base.business==="both"||(u.business||"both")==="both"||u.business===base.business;
          return `<div class="tm-m${m?"":" off"}${bizOk?"":" nob"}" data-email="${esc(e)}" data-q="${esc((u.name||"")+" "+e+" "+(u.team||""))}"><input type="checkbox" class="tfIn" ${m?"checked":""}><div class="who"><b>${esc(u.name||e.split("@")[0])}</b><span>${esc(e)}${u.team?` · ${esc(u.team)}`:""}${!bizOk?` · <span style="color:#d97706">${esc(u.business)} only</span>`:""}</span></div>
            <div class="rts"><label title="may acknowledge"><input type="checkbox" class="tfA" ${!m||m.can_ack?"checked":""}>A</label><label title="may resolve"><input type="checkbox" class="tfR" ${!m||m.can_resolve?"checked":""}>R</label><label title="may re-assign"><input type="checkbox" class="tfX" ${!m||m.can_reassign?"checked":""}>X</label></div></div>`; }).join("")}</div>
        <div class="tm-actions"><button class="um-btn" id="tfSaveMem">Save members</button><span class="ud-msg" id="tfMemMsg"></span></div></div>
      <div class="tm-sec"><h4>Rules owned · ${det.rules.length}</h4>${det.rules.length?`<div style="display:flex;gap:4px;flex-wrap:wrap">${det.rules.slice(0,40).map(r=>`<span class="tm-b${r.enabled?"":" bad"}" title="${esc(r.key)}">${esc(r.severity)} · ${esc(r.name)}</span>`).join("")}${det.rules.length>40?`<span class="rl">+${det.rules.length-40} more</span>`:""}</div>`:`<div class="rl">No rule names this team yet — approve Agent 2's proposals under Alerts › Alert rules, or set the team in the rule editor.</div>`}</div>`:""}`;
    const msg=(id,t,bad)=>{ const m=host.querySelector(id); m.textContent=t; m.style.color=bad?"var(--red)":"var(--green-dark)"; };
    host.querySelector("#tfSave").onclick=async()=>{
      const key=(host.querySelector("#tfKey").value||"").trim().toLowerCase(); if(!key){ msg("#tfMsg","A key is needed (letters, digits, dashes).",true); return; }
      const payload={ name:host.querySelector("#tfName").value.trim(), business:host.querySelector("#tfBiz").value, domain:host.querySelector("#tfDom").value, level:host.querySelector("#tfLvl").value, vendor_id:host.querySelector("#tfVendor").value||null, contract_id:host.querySelector("#tfContract").value||null,
        mail_dl:host.querySelector("#tfDl").value.trim(), sort:Number(host.querySelector("#tfSort").value)||100, description:host.querySelector("#tfDesc").value.trim(), aliases:host.querySelector("#tfAliases").value, keywords:host.querySelector("#tfKw").value, active:host.querySelector("#tfActive").checked };
      if(!payload.name){ msg("#tfMsg","A name is needed.",true); return; }
      msg("#tfMsg","Saving…");
      try{ const r=await api("/api/teams/"+encodeURIComponent(key),{method:"PUT",body:JSON.stringify(payload)}); ACTIVE=r.team.key; if(window.TEAMS) window.TEAMS.at=0; REG=await api("/api/teams?all=1"); paint(); }
      catch(e){ msg("#tfMsg",e.message,true); }
    };
    const mq=host.querySelector("#tfMemQ"); if(mq) mq.addEventListener("input",()=>{ const q=mq.value.trim().toLowerCase(); host.querySelectorAll("#tfMembers .tm-m").forEach(x=>{ x.style.display=!q||x.dataset.q.toLowerCase().includes(q)?"":"none"; }); });
    host.querySelectorAll("#tfMembers .tfIn").forEach(cb=>cb.addEventListener("change",()=>cb.closest(".tm-m").classList.toggle("off",!cb.checked)));
    const sm=host.querySelector("#tfSaveMem"); if(sm) sm.onclick=async()=>{
      const members=[...host.querySelectorAll("#tfMembers .tm-m")].filter(x=>x.querySelector(".tfIn").checked).map(x=>({ email:x.dataset.email, can_ack:x.querySelector(".tfA").checked, can_resolve:x.querySelector(".tfR").checked, can_reassign:x.querySelector(".tfX").checked }));
      msg("#tfMemMsg","Saving…");
      try{ await api("/api/teams/"+encodeURIComponent(base.key)+"/members",{method:"PUT",body:JSON.stringify({members})}); msg("#tfMemMsg",`Saved — ${members.length} member${members.length===1?"":"s"}.`); if(window.TEAMS) window.TEAMS.at=0; REG=await api("/api/teams?all=1"); paint(); }
      catch(e){ msg("#tfMemMsg",e.message,true); }
    };
  }
})();
