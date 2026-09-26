/* Teams management › Responder teams — the responder-team registry (24 Sep 2026). Super Admin page #teams.
 * business × domain × level, bound to the vendor contract that carries the obligations; members with their rights
 * (ack · resolve · re-assign); the rules and open incidents each team owns; the contract clocks that apply.
 * Section "Refund desks" (26 Sep 2026, #teams?section=refunds): who handles refunds per business — the executing team,
 * the approvers (the ONLY recipients of the approval request), the copy list, the internal ticket (P4), the two SLA
 * clocks and the agent's mode. Source of truth for Agent 2's refund desk (server/src/refundDesk.js). */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const API = window.API_BASE || "";
  const esc = s => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const api = (p, opts) => window.fetch(API + p, Object.assign({ headers: { "Content-Type": "application/json" } }, opts))
    .then(r => { if(!r.ok) return r.json().then(e => { throw new Error(e.error || ("HTTP " + r.status)); }); return r.json(); });
  const isSuper = () => { const s = (window.opsSession && window.opsSession()) || {}; return !!(s.me && (s.me.realRole === "super_admin" || (s.me.realRoles || []).includes("super_admin"))); };
  const DOMAIN_COLOR={ digital:"#0e9f5a", bss:"#7c3aed", oss:"#0891b2", infra:"#64748b", adm:"#d97706", network:"#2563eb", soc:"#dc2626", payments:"#db2777", rafm:"#9333ea", sales:"#ca8a04", other:"#64748b" };
  let REG = null, ACTIVE = null, USERS = null, VENDORS = null, FILTER = { biz:"all", q:"" }, SECTION = "teams", DESKS = null;
  const ksa=iso=>{ if(!iso) return "—"; const d=new Date(iso); return isNaN(d)?"—":d.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Riyadh"}); };
  const hrs=h=>h==null?"—":h<1?Math.round(h*60)+" min":h<48?(Math.round(h*10)/10)+" h":(Math.round(h/24*10)/10)+" d";
  const sar=v=>Number(v||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

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
      #view-teams .tm-seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden;background:var(--card)} #view-teams .tm-seg button{border:0;border-right:1px solid var(--line);background:transparent;padding:6px 14px;font:inherit;font-size:12px;font-weight:800;cursor:pointer;color:var(--muted);white-space:nowrap} #view-teams .tm-seg button:last-child{border-right:0} #view-teams .tm-seg button.on{background:var(--solid,var(--ink));color:var(--solid-fg,#fff)}
      #view-teams .tm-desks{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:14px;align-items:start}
      #view-teams .tm-desk{border:1px solid var(--line);border-top:4px solid var(--dc);border-radius:12px;background:var(--card);padding:14px 16px;min-width:0}
      #view-teams .tm-desk.off{opacity:.92} #view-teams .tm-desk h3{margin:0;font-size:15px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      #view-teams .tm-live{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:2px 9px;border:1px solid var(--line);color:var(--muted)} #view-teams .tm-live i{width:7px;height:7px;border-radius:50%;background:var(--muted);display:inline-block} #view-teams .tm-live.on{color:var(--green);border-color:var(--green)} #view-teams .tm-live.on i{background:var(--green)} #view-teams .tm-live.soon{color:#d97706;border-color:#d97706} #view-teams .tm-live.soon i{background:#d97706}
      #view-teams .tm-warn{margin:10px 0 0;padding:9px 12px;border-radius:10px;background:var(--tint-warn-bg,rgba(217,119,6,.1));border:1px solid var(--tint-warn-line,#d97706);color:var(--tint-warn-fg,#92400e);font-size:12px;line-height:1.45} #view-teams .tm-warn b{display:block;margin-bottom:2px}
      #view-teams .tm-fs{margin-top:14px} #view-teams .tm-fs>h4{margin:0 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);display:flex;gap:8px;align-items:center;flex-wrap:wrap} #view-teams .tm-fs>h4 span{font-weight:400;text-transform:none;letter-spacing:0}
      #view-teams .tm-sw{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:var(--ink);cursor:pointer;text-transform:none;letter-spacing:0} #view-teams .tm-sw input{width:16px;height:16px;accent-color:var(--green);margin:0}
      #view-teams .tm-row{display:flex;gap:10px 16px;flex-wrap:wrap;align-items:center}
      #view-teams .tm-num{display:inline-flex;align-items:center;gap:6px;font-size:12.5px} #view-teams .tm-num input{width:74px;font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2,var(--card));color:var(--ink)} #view-teams .tm-num select{font:inherit;font-size:13px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2,var(--card));color:var(--ink)}
      #view-teams .tm-pick{border:1px solid var(--line);border-radius:10px;padding:6px 8px;background:var(--card2,var(--card))} #view-teams .tm-chips{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px} #view-teams .tm-chips:empty{display:none}
      #view-teams .tm-pchip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:2px 4px 2px 9px;font-size:12px;background:var(--card);max-width:100%} #view-teams .tm-pchip b{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px} #view-teams .tm-pchip small{color:var(--muted);white-space:nowrap} #view-teams .tm-pchip.bad{border-color:#dc2626;color:#dc2626} #view-teams .tm-pchip.bad small{color:#dc2626}
      #view-teams .tm-pchip button{border:0;background:transparent;color:var(--muted);cursor:pointer;font:inherit;font-size:13px;line-height:1;padding:2px 5px;border-radius:999px} #view-teams .tm-pchip button:hover{color:#dc2626} #view-teams .tm-pchip.warn{border-color:#d97706} #view-teams .tm-pchip.warn small{color:#d97706}
      #view-teams .tm-aff{display:inline-block;font-size:9.5px;font-weight:800;border-radius:999px;padding:0 6px;border:1px solid var(--c);color:var(--c);white-space:nowrap;vertical-align:1px;margin-right:2px}
      #view-teams .tm-pick input{width:100%;font:inherit;font-size:12.5px;padding:5px 4px;border:0;background:transparent;color:var(--ink);outline:none;box-sizing:border-box}
      #view-teams .tm-sla{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px} #view-teams .tm-sla>div{border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:var(--card2,var(--card))} #view-teams .tm-sla span{display:block;font-size:10.5px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.06em} #view-teams .tm-sla b{font-size:18px;display:block;margin-top:2px} #view-teams .tm-sla small{display:block;font-size:11px;color:var(--muted);margin-top:1px;line-height:1.35} #view-teams .tm-sla b.bad{color:#dc2626} #view-teams .tm-sla b.ok{color:var(--green)}
      #view-teams .tm-flow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;margin-top:8px} #view-teams .tm-flow span{border:1px solid var(--line);border-radius:8px;padding:3px 8px;background:var(--card2,var(--card))} #view-teams .tm-flow i{color:var(--muted);font-style:normal}
      #view-teams .tm-note{font-size:11.5px;color:var(--muted);line-height:1.45;margin-top:6px}
      #view-teams .tm-rules{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
      @media (max-width:900px){ #view-teams .tm-grid{grid-template-columns:1fr} #view-teams .tm-detail{position:static} #view-teams .tm-desks{grid-template-columns:1fr} }`;
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
    const refunds=SECTION==="refunds";
    host.innerHTML=`<div class="panel"><div class="tm-head"><div><div class="tm-kicker">${refunds?"REFUND OWNERSHIP":"INCIDENT OWNERSHIP"}</div><h2 style="margin:2px 0">${refunds?"Refund desks":"Responder teams"}</h2>
      <div class="sub">${refunds?"Who handles refunds, per business: the team that posts the refund in the gateway back office, the approvers — the <b>only</b> people who receive the approval request —, the copy list, the internal ticket and the two SLA clocks. This is what Agent 2's refund desk reads; there is no fallback list: with no approver nothing is mailed."
        :"Who owns which incident: business × domain × level, bound to the vendor contract whose clocks apply. Members may ack, resolve and re-assign the team's incidents; the per-business ACK holders stay the on-call fallback. Agent 2 proposes the rule → team mapping under Alerts › Alert rules."}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><div class="tm-seg" id="tmSeg"><button data-sec="teams" class="${refunds?"":"on"}">Teams${REG?` · ${(REG.teams||[]).filter(t=>t.active).length}`:""}</button><button data-sec="refunds" class="${refunds?"on":""}">💸 Refund desks</button></div>
        ${refunds?`<a class="pill" href="#refunds?tab=desk" style="border-left-color:#dc2626;text-decoration:none">Refund desk · live</a><a class="pill" href="#sla" style="text-decoration:none">Ack SLA ladders</a>`
        :`<a class="pill" href="#alerts" style="border-left-color:#2563eb;text-decoration:none">Alert rules · team mapping</a><a class="pill" href="#vendor-contracts" style="text-decoration:none">Vendors &amp; contracts</a><button class="pill" id="tmNew" style="border-left-color:var(--green)">＋ New team</button>`}</div></div>
      <div id="tmBody">${inner||'<div class="sub">Loading…</div>'}</div></div>`;
    const nb=$("#tmNew"); if(nb) nb.onclick=()=>{ ACTIVE="__new"; paint(); };
    host.querySelectorAll("#tmSeg [data-sec]").forEach(x=>x.onclick=()=>{ if(x.dataset.sec===SECTION) return; SECTION=x.dataset.sec; try{ const h=SECTION==="refunds"?"teams?section=refunds":"teams"; if(window.setConsoleHash) window.setConsoleHash(h); else if(location.hash!=="#"+h) history.replaceState(null,"","#"+h); }catch(_){ } shell(); paint(); });
  }
  window.openTeams = async function(){
    activateView();
    try{ const qs=(location.hash.split("?")[1]||""); SECTION=/(?:^|&)section=refunds/.test(qs)?"refunds":"teams"; }catch(_){ SECTION="teams"; }
    if(!isSuper()){ shell(`<div style="text-align:center;padding:34px 20px"><div style="font-size:26px">Locked</div><h2 style="margin:8px 0 4px">Super Admin Only</h2><div class="sub">Team membership decides who may act on which incident — it is controlled by super users.</div></div>`); return; }
    shell();
    try{
      const [reg, users, vc] = await Promise.all([api("/api/teams?all=1"), api("/api/users").catch(()=>({users:[]})), api("/api/vendor-contracts").catch(()=>null)]);
      REG=reg; USERS=(users.users||[]).filter(u=>u.enabled!==false).sort((a,b)=>String(a.name||a.email).localeCompare(String(b.name||b.email))); VENDORS=vc;
      if(!ACTIVE || (ACTIVE!=="__new" && !REG.teams.some(t=>t.key===ACTIVE))) ACTIVE=(REG.teams[0]||{}).key||null;
      shell(); paint();
    }catch(e){ const b=$("#tmBody"); if(b) b.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; }
  };
  const bizIcon=b=>b==="fixed"?"🏠 Fixed":b==="mobile"?"📱 Mobile":"📱🏠 Both";
  /* affiliation (26 Sep 2026): Salam team vs contract resource, from the e-mail (usersmgmt.js › Affiliation rules) */
  const AFF_COLOR=o=>(window.AFFS&&window.AFFS.colors&&window.AFFS.colors[o])||(/^Salam/.test(o||"")?"#0e9f5a":o?"#2563eb":"#d97706");
  const affTag=u=>{ const k=u.affiliation||"unclassified"; const o=u.affiliation_org||(k==="salam"?"Salam":k==="contract"?"contract":"unclassified"); return ` <span class="tm-aff" style="--c:${AFF_COLOR(k==="unclassified"?"":o)}" title="${k==="salam"?"Salam team":k==="contract"?"contract resource":"unclassified — User management › Affiliation rules"}">${k==="salam"?"🏢":k==="contract"?"📄":"❔"} ${esc(o)}</span>`; };
  const affMix=emails=>{ const m={}; emails.forEach(e=>{ const u=(USERS||[]).find(x=>String(x.email).toLowerCase()===String(e).toLowerCase()); const o=u?(u.affiliation==="salam"?"Salam":u.affiliation==="contract"?(u.affiliation_org||"contract"):"unclassified"):"unknown"; m[o]=(m[o]||0)+1; }); return Object.entries(m).map(([o,n])=>`${n} ${o}`).join(" · "); };
  function paint(){
    const b=$("#tmBody"); if(!b||!REG) return;
    if(SECTION==="refunds"){ paintDesks(); return; }
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
      <div class="tm-sec"><h4>Members · ${det.members.length}${det.members.length?` <span class="rl" style="text-transform:none;letter-spacing:0;font-weight:600">· ${esc(affMix(det.members.map(m=>m.email)))}</span>`:""} <span class="rl" style="text-transform:none;letter-spacing:0;font-weight:400">— tick to add; A = ack · R = resolve · X = re-assign</span></h4>
        <input id="tfMemQ" class="jsearch" type="search" placeholder="filter people…" style="margin-bottom:6px">
        <div class="tm-members" id="tfMembers">${(USERS||[]).map(u=>{ const e=String(u.email).toLowerCase(); const m=memberSet.get(e); const bizOk=base.business==="both"||(u.business||"both")==="both"||u.business===base.business;
          return `<div class="tm-m${m?"":" off"}${bizOk?"":" nob"}" data-email="${esc(e)}" data-q="${esc((u.name||"")+" "+e+" "+(u.team||"")+" "+(u.affiliation_org||""))}"><input type="checkbox" class="tfIn" ${m?"checked":""}><div class="who"><b>${esc(u.name||e.split("@")[0])}</b><span>${affTag(u).trim()} ${esc(e)}${u.team?` · ${esc(u.team)}`:""}${!bizOk?` · <span style="color:#d97706">${esc(u.business)} only</span>`:""}</span></div>
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

  /* ── Refund desks ──────────────────────────────────────────────────────────────────────────────────────────────── */
  const DESK_COLOR={ mobile:"#0e9f5a", fixed:"#7c3aed" };
  const userOf=em=>(USERS||[]).find(u=>String(u.email).toLowerCase()===String(em).toLowerCase());
  const otherBiz=b=>b==="mobile"?"fixed":"mobile";
  async function paintDesks(){
    const b=$("#tmBody"); if(!b) return;
    if(!DESKS){ b.innerHTML='<div class="sub">Loading the refund desks…</div>'; try{ DESKS=await api("/api/teams/refund-desks"); }catch(e){ b.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; } }
    const D=DESKS;
    b.innerHTML=`<datalist id="tmUsersDl">${(USERS||[]).map(u=>`<option value="${esc(String(u.email).toLowerCase())}">${esc(u.name||"")}${u.affiliation_org?" · "+esc(u.affiliation_org)+(u.affiliation==="contract"?" (contract)":""):""}${u.business&&u.business!=="both"?" · "+esc(u.business):""}</option>`).join("")}</datalist>
      <div class="tm-desks">${(D.desks||[]).map(deskCard).join("")}</div>
      <div class="tm-note" style="margin-top:12px"><b>How it fits together.</b> Agent 2 reviews every candidate and routes it to the desk's executing team; the approval request (the table L2 used to type by hand, with the evidence and the payment ids, XLSX attached) goes <b>To</b> the approvers and <b>Cc</b> the executing team; a person approves on the page (one click, recorded by name); L2 posts the refund in the gateway back office; the console closes the case from the register. The internal ticket per batch is chased by the ack ladder of its severity (Settings › SLA — P4 has its own gentle ladder: 4 h · 12 h · 24 h). The two SLA clocks feed two P4 rules that open one ticket each while a case is overdue and clear on their own. Every address of the other business is dropped and shown here.</div>`;
    b.querySelectorAll(".tm-desk").forEach(wireDesk);
  }
  function deskCard(d){
    const biz=d.business; const color=DESK_COLOR[biz]||"#64748b"; const T=d.team_info; const S=d.sla||{}; const A=S.approval||{}, X=S.execution||{}; const O=d.open||{};
    const teams=(DESKS.teams||[]).filter(t=>t.business==="both"||t.business===biz);
    const live=!d.ready?["soon","planned"]:d.enabled?["on","live"]:["","off"];
    const rules=(DESKS.rules||[]).filter(r=>/^refund_(approval|execution)_overdue$/.test(r.key));
    const chip=(em,kind)=>{ const u=userOf(em); const bad=u&&u.business&&u.business!=="both"&&u.business!==biz; const contract=kind==="approvers"&&u&&u.affiliation==="contract"; return `<span class="tm-pchip${bad?" bad":""}${contract?" warn":""}" data-em="${esc(em)}" title="${bad?`${esc(em)} is a ${esc(u.business)} user — never mailed by this desk`:contract?`${esc(em)} is a contract resource (${esc(u.affiliation_org||"")}) — the approval is Salam's decision`:esc(em)}"><b>${esc(u&&u.name?u.name:em.split("@")[0])}</b><small>${u?(bad?`${esc(u.business)} user — not mailed`:(u.affiliation==="salam"?"🏢 "+esc(u.affiliation_org||"Salam"):u.affiliation==="contract"?"📄 "+esc(u.affiliation_org||"contract")+" · contract":(u.team?esc(u.team):"console user"))):"external"}</small><button type="button" title="remove">✕</button></span>`; };
    return `<div class="tm-desk${d.enabled?"":" off"}" data-biz="${biz}" style="--dc:${color}">
      <h3>${biz==="fixed"?"🏠":"📱"} ${esc(d.label)} <span class="tm-live ${live[0]}"><i></i>${live[1]}</span><span class="rl" style="font-weight:400;margin-left:auto">${d.saved&&d.updated_at?`saved ${ksa(d.updated_at)}${d.updated_by?" by "+esc(String(d.updated_by).split("@")[0]):""}`:"defaults — not saved yet"}</span></h3>
      <div class="tm-note">${biz==="mobile"?"Salam Mobile · the six detectors on the replica · refunds posted by L2 in <b>proxycms</b> · mode <b>"+esc(d.mode)+"</b>":"Salam Home · Fixed refund cases (Moyasar) — the desk is defined now so the team, the approvers and the SLAs are ready; its detectors arrive with the Fixed refund radar."}</div>
      ${(d.warnings||[]).length?`<div class="tm-warn"><b>Before it can reach the right people</b>${d.warnings.map(w=>`<div>· ${esc(w.text)}</div>`).join("")}</div>`:""}
      ${d.ready?`<div class="tm-sla">
        <div><span>Open cases</span><b class="${O.open?"bad":"ok"}">${O.open||0}</b><small>${sar(O.sar)} SAR · ${O.approved||0} approved · ${O.in_batches||0} in a request</small></div>
        <div><span>Approval clock</span><b class="${A.overdue?"bad":"ok"}">${A.overdue||0} overdue</b><small>${A.waiting||0} waiting for a decision · oldest ${hrs(A.oldest_h)} · SLA ${d.approve_within_h} h</small></div>
        <div><span>Execution clock</span><b class="${X.overdue?"bad":"ok"}">${X.overdue||0} overdue</b><small>${X.waiting||0} approved, not posted · oldest ${hrs(X.oldest_h)} · SLA ${d.refund_within_h} h</small></div>
        <div><span>30 d attainment</span><b>${A.pct_30d==null?"—":A.pct_30d+"%"} <span style="display:inline;font-size:12px;text-transform:none;letter-spacing:0;color:var(--muted)">/ ${X.pct_30d==null?"—":X.pct_30d+"%"}</span></b><small>decision ${A.done_30d||0} decided · median ${hrs(A.median_h)} · execution ${X.done_30d||0} posted · median ${hrs(X.median_h)}</small></div></div>`:""}
      <div class="tm-fs"><h4>Who</h4>
        <div class="tm-form">
          <div class="full"><label>Executing team <span style="text-transform:none;letter-spacing:0;font-weight:400">— posts the refund in ${esc(d.gateway)}; receives the digest of new cases and the copy of the approval request; owns the batch ticket</span></label>
            <select data-f="team">${teams.map(t=>`<option value="${esc(t.key)}"${t.key===d.team?" selected":""}>${esc(t.name)} · ${esc(t.level||"")}${t.business==="both"?" · both businesses":""} · ${t.members||0} member${t.members===1?"":"s"}${t.mail_dl?" · DL":""}</option>`).join("")}${T||teams.some(t=>t.key===d.team)?"":`<option value="${esc(d.team)}" selected>${esc(d.team)} (not in the registry)</option>`}</select>
            <div class="tm-note">${T?`${esc(T.name)} · ${T.members} member${T.members===1?"":"s"}${T.mail_dl?" · DL "+esc(T.mail_dl):" · no DL"}${(d.excluded&&d.excluded.members||[]).length?` · <span style="color:#dc2626">${d.excluded.members.length} member(s) of the other business not mailed</span>`:""} · <a href="#teams" data-team="${esc(T.key)}" style="color:var(--green)">members ›</a>`:"pick a team of the registry"}</div></div>
          <div class="full"><label>Approvers <span style="text-transform:none;letter-spacing:0;font-weight:400">— the <b>only</b> To of the approval request; nothing is sent without one · pick a console user or type an e-mail</span></label>
            <div class="tm-pick" data-pick="approvers"><div class="tm-chips">${(d.approvers||[]).map(e=>chip(e,"approvers")).join("")}</div><input list="tmUsersDl" placeholder="name or e-mail, Enter to add…" autocomplete="off"></div></div>
          <div class="full"><label>Copy <span style="text-transform:none;letter-spacing:0;font-weight:400">— Cc of the approval request, besides the executing team (e.g. the head of the department)</span></label>
            <div class="tm-pick" data-pick="cc"><div class="tm-chips">${(d.cc||[]).map(e=>chip(e,"cc")).join("")}</div><input list="tmUsersDl" placeholder="name or e-mail, Enter to add…" autocomplete="off"></div></div>
        </div></div>
      <div class="tm-fs"><h4>Internal ticket <span>· one per approval batch, owned by the executing team, resolved when every case is closed</span></h4>
        <div class="tm-row"><label class="tm-sw"><input type="checkbox" data-f="open_incident" ${d.open_incident?"checked":""}> Open a ticket per batch</label>
          <span class="tm-num">Severity <select data-f="ticket_severity">${(DESKS.severities||["P1","P2","P3","P4"]).map(s=>`<option${s===d.ticket_severity?" selected":""}>${s}</option>`).join("")}</select></span>
          <label class="tm-sw"><input type="checkbox" data-f="chatops" ${d.chatops?"checked":""}> also post it to the ${biz==="fixed"?"Fixed":"Mobile"} ChatOps channels</label></div>
        <div class="tm-note">P4 = internal: the team is reminded by the P4 ack ladder (Settings › SLA), nobody is paged, management is not informed. Raise it only if a batch must be treated like a customer incident.</div></div>
      <div class="tm-fs"><h4>SLA clocks <span>· the desk's two promises; overdue cases open a P4 ticket each (rules below)</span></h4>
        <div class="tm-row"><span class="tm-num">Decision within <input type="number" min="1" max="720" data-f="approve_within_h" value="${esc(d.approve_within_h)}"> h of the request</span><span class="tm-num">Refund posted within <input type="number" min="1" max="720" data-f="refund_within_h" value="${esc(d.refund_within_h)}"> h of the approval</span></div>
        <div class="tm-flow"><span>request mailed</span><i>→ ${esc(d.approve_within_h)} h →</i><span>approved / dismissed on the page</span><i>→ ${esc(d.refund_within_h)} h →</i><span>refund in ${esc(d.gateway)} → case closed from the register</span></div>
        ${rules.length?`<div class="tm-rules">${rules.map(r=>`<span class="tm-b${r.enabled?"":" bad"}" title="${esc(r.key)}">${esc(r.severity)} · ${esc(r.name.replace(/\s*\(P\d\)$/,""))} → ${esc(teamName(r.team))}</span>`).join("")}<a class="tm-b" href="#alerts" style="text-decoration:none">rules ›</a></div>`:""}</div>
      <div class="tm-fs"><h4>Agent 2 <span>· what the refund desk does on its own — never the approval, never the refund</span></h4>
        <div class="tm-row"><label class="tm-sw"><input type="checkbox" data-f="enabled" ${d.enabled?"checked":""}> Desk enabled</label>
          <span class="tm-num">Mode <select data-f="mode"><option value="advise"${d.mode==="advise"?" selected":""}>advise — a person sends the request</option><option value="assist"${d.mode==="assist"?" selected":""}>assist — the request goes out daily on its own</option></select></span>
          <span class="tm-num">at <input type="number" min="0" max="23" data-f="report_hour" value="${esc(d.report_hour)}"> h KSA</span>
          <label class="tm-sw"><input type="checkbox" data-f="notify_new" ${d.notify_new?"checked":""}> digest of new cases to the team</label>
          <span class="tm-num">model verdict kept from <input type="number" min="0" max="100" data-f="min_confidence_pct" value="${Math.round((d.min_confidence||0.5)*100)}"> %</span></div>
        <div class="tm-form" style="margin-top:8px"><div class="full"><label>Note</label><input data-f="note" value="${esc(d.note||"")}" placeholder="e.g. approvals by the Head of Digital Operations; finance copied for amounts above 1,000 SAR"></div></div></div>
      <div class="tm-actions"><button class="um-btn" data-save="${biz}">Save desk</button><span class="ud-msg" data-msg="${biz}"></span></div>
    </div>`;
  }
  const teamName=k=>{ const t=(DESKS&&DESKS.teams||[]).find(x=>x.key===k)||(REG&&REG.teams||[]).find(x=>x.key===k||x.name===k||(x.aliases||[]).includes(k)); return t?t.name:(k||"—"); };
  function wireDesk(card){
    const biz=card.dataset.biz; const desk=(DESKS.desks||[]).find(d=>d.business===biz)||{};
    const list=kind=>[...card.querySelectorAll(`[data-pick="${kind}"] .tm-pchip`)].map(x=>x.dataset.em);
    const wireX=()=>card.querySelectorAll(".tm-pchip button").forEach(x=>{ x.onclick=()=>x.closest(".tm-pchip").remove(); });
    wireX();
    card.querySelectorAll(".tm-pick").forEach(pk=>{
      const kind=pk.dataset.pick; const inp=pk.querySelector("input"); const chips=pk.querySelector(".tm-chips");
      const add=()=>{ const em=String(inp.value||"").trim().toLowerCase(); if(!em) return; if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ inp.setCustomValidity("an e-mail address"); inp.reportValidity(); setTimeout(()=>inp.setCustomValidity(""),1200); return; }
        if(list(kind).includes(em)){ inp.value=""; return; }
        const u=userOf(em); const bad=u&&u.business&&u.business!=="both"&&u.business!==biz;
        const contract=kind==="approvers"&&u&&u.affiliation==="contract";
        chips.insertAdjacentHTML("beforeend",`<span class="tm-pchip${bad?" bad":""}${contract?" warn":""}" data-em="${esc(em)}"><b>${esc(u&&u.name?u.name:em.split("@")[0])}</b><small>${u?(bad?`${esc(u.business)} user — not mailed`:(u.affiliation==="salam"?"🏢 "+esc(u.affiliation_org||"Salam"):u.affiliation==="contract"?"📄 "+esc(u.affiliation_org||"contract")+" · contract":(u.team?esc(u.team):"console user"))):"external"}</small><button type="button" title="remove">✕</button></span>`); wireX(); inp.value=""; };
      inp.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===","){ e.preventDefault(); add(); } });
      inp.addEventListener("change",()=>{ if(userOf(inp.value)) add(); });   // a datalist pick fires change
      inp.addEventListener("blur",()=>{ if(inp.value.trim()) add(); });
    });
    const hours=card.querySelectorAll('[data-f="approve_within_h"],[data-f="refund_within_h"]'); hours.forEach(h=>h.addEventListener("input",()=>{ const f=card.querySelector(".tm-flow"); if(!f) return; const a=card.querySelector('[data-f="approve_within_h"]').value, r=card.querySelector('[data-f="refund_within_h"]').value; f.querySelectorAll("i")[0].textContent=`→ ${a} h →`; f.querySelectorAll("i")[1].textContent=`→ ${r} h →`; }));
    const tl=card.querySelector("[data-team]"); if(tl) tl.onclick=e=>{ e.preventDefault(); ACTIVE=tl.dataset.team; SECTION="teams"; try{ if(window.setConsoleHash) window.setConsoleHash("teams"); }catch(_){ } shell(); paint(); };
    const btn=card.querySelector("[data-save]"); const msgEl=card.querySelector("[data-msg]"); const msg=(t,bad)=>{ msgEl.textContent=t; msgEl.style.color=bad?"var(--red,#dc2626)":"var(--green-dark,var(--green))"; };
    btn.onclick=async()=>{
      const g=f=>card.querySelector(`[data-f="${f}"]`);
      const body={ enabled:g("enabled").checked, mode:g("mode").value, team:g("team").value, approvers:list("approvers"), cc:list("cc"), open_incident:g("open_incident").checked, ticket_severity:g("ticket_severity").value, chatops:g("chatops").checked,
        approve_within_h:Number(g("approve_within_h").value), refund_within_h:Number(g("refund_within_h").value), report_hour:Number(g("report_hour").value), notify_new:g("notify_new").checked, min_confidence:Number(g("min_confidence_pct").value)/100, note:g("note").value.trim() };
      const bad=body.approvers.filter(e=>{ const u=userOf(e); return u&&u.business&&u.business!=="both"&&u.business!==biz; });
      if(bad.length && !confirm(`${bad.join(", ")} ${bad.length>1?"are":"is"} registered for ${otherBiz(biz)} — this desk will never mail them. Save anyway?`)) return;
      if(!body.approvers.length && !confirm(`No approver: the approval request cannot be sent for the ${desk.label||biz} desk until one is defined. Save anyway?`)) return;
      btn.disabled=true; msg("Saving…");
      try{ const r=await api("/api/teams/refund-desks/"+biz,{method:"PUT",body:JSON.stringify(body)}); DESKS.desks=DESKS.desks.map(d=>d.business===biz?r.desk:d); if(r.rules) DESKS.rules=r.rules; msg("Saved ✓"); paintDesks(); }
      catch(e){ msg(e.message,true); btn.disabled=false; }
    };
  }
})();
