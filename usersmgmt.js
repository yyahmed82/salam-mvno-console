/* usersmgmt.js — USER MANAGEMENT page, redesigned (10 Sep 2026).
 *   KPI strip (click = filter) · multi-criteria filter bar (search, business, role, status, ACK holder, mail flags, tags,
 *   sort) · compact people table with inline switches (mail alert / report, ACK Mobile / Fixed) · bulk actions on a
 *   selection · 30-day activity per user (actions, acks, MTTA, last seen) · "New user" as a drawer · XLSX export.
 * Rendered into #usersBody by ops.js renderUserMgmt() → window.renderUsersMgmt(host). The edit drawer stays in ops.js
 * (window.openUserPanel). Data: GET /api/users → { users, activity }, PATCH /api/users/:id, POST /api/users. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const API=window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{ if(!r.ok) return r.json().then(e=>{ throw new Error(e.error||("HTTP "+r.status)); }); return r.json(); });
  const TAGS=["BSS","OSS","DIGITAL","FIXED","SALES OPS","PLATFORM","IDENTITY","CALL CENTER"];
  const BIZ={mobile:["📱","Mobile","#7c3aed"],fixed:["🏠","Fixed","var(--green,#0e9f5a)"],both:["📱🏠","Both","linear-gradient(90deg,#7c3aed,#0e9f5a)"]};
  let ROLES=[]; let USERS=[]; let ACT={}; let HOST=null;
  const F={q:"",biz:"",roles:new Set(),status:"",ack:"",mail:"",tags:new Set(),sort:"name"};
  const SEL=new Set();
  const ago=iso=>{ if(!iso) return null; const m=Math.round((Date.now()-new Date(iso))/60000); if(m<1) return "just now"; if(m<60) return m+" min"; const h=Math.round(m/60); if(h<48) return h+" h"; const d=Math.round(h/24); if(d<60) return d+" d"; return Math.round(d/30)+" mo"; };
  const ksa=iso=>{ if(!iso) return "—"; try{ return new Date(iso).toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).replace(","," "); }catch(e){ return String(iso); } };
  const rolesOf=u=>(u.roles&&u.roles.length)?u.roles:(u.role?[u.role]:[]);
  const roleLabel=k=>{ const r=ROLES.find(x=>x[0]===k); return r?r[1]:k; };
  const isSuper=u=>rolesOf(u).includes("super_admin");
  const seen7=u=>u.last_login&&(Date.now()-new Date(u.last_login))<7*86400e3;
  const initials=u=>String(u.name||u.email||"?").split(/[\s.@_-]+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join("");
  const hue=s=>{ let h=0; for(const c of String(s)) h=(h*31+c.charCodeAt(0))%360; return h; };

  async function loadRoles(){ try{ const rr=await api("/api/roles"); const m=rr.roles||{}; ROLES=Object.entries(m).sort((a,b)=>(a[1].rank-b[1].rank)||a[1].label.localeCompare(b[1].label)).map(([k,v])=>[k,v.label]); }catch(e){ if(!ROLES.length) ROLES=[["super_admin","Super admin"],["admin","Admin"]]; } }

  function filtered(){
    const q=F.q.trim().toLowerCase();
    let list=USERS.filter(u=>{
      if(q&&![u.email,u.name,u.team,u.mobile,(u.tags||[]).join(" "),rolesOf(u).map(roleLabel).join(" ")].some(x=>String(x||"").toLowerCase().includes(q))) return false;
      if(F.biz&&(u.business||"both")!==F.biz) return false;
      if(F.roles.size&&!rolesOf(u).some(r=>F.roles.has(r))) return false;
      if(F.status==="active"&&!u.enabled) return false; if(F.status==="blocked"&&u.enabled) return false;
      if(F.status==="never"&&u.last_login) return false; if(F.status==="seen7"&&!seen7(u)) return false;
      if(F.status==="super"&&!isSuper(u)) return false;
      if(F.ack==="mobile"&&!u.ack_mobile) return false; if(F.ack==="fixed"&&!u.ack_fixed) return false; if(F.ack==="none"&&(u.ack_mobile||u.ack_fixed)) return false;
      if(F.mail==="alert"&&!u.mail_alert) return false; if(F.mail==="report"&&!u.mail_report) return false; if(F.mail==="none"&&(u.mail_alert||u.mail_report)) return false;
      if(F.tags.size&&![...F.tags].every(t=>(u.tags||[]).includes(t))) return false;
      return true; });
    const a=ACT;
    const key={ name:u=>String(u.name||u.email).toLowerCase(), seen:u=>-(u.last_login?new Date(u.last_login).getTime():0), created:u=>-(u.created_at?new Date(u.created_at).getTime():0), activity:u=>-((a[u.email.toLowerCase()]||{}).actions30||0), acks:u=>-((a[u.email.toLowerCase()]||{}).acks30||0) }[F.sort]||(u=>u.email);
    return list.sort((x,y)=>{ const kx=key(x),ky=key(y); return kx<ky?-1:kx>ky?1:0; });
  }

  function kpis(){
    const n=USERS.length, act=USERS.filter(u=>u.enabled).length, blk=n-act, never=USERS.filter(u=>!u.last_login).length, s7=USERS.filter(seen7).length;
    const mob=USERS.filter(u=>(u.business||"both")==="mobile").length, fix=USERS.filter(u=>(u.business||"both")==="fixed").length, both=n-mob-fix;
    const am=USERS.filter(u=>u.ack_mobile&&u.enabled).length, af=USERS.filter(u=>u.ack_fixed&&u.enabled).length, ma=USERS.filter(u=>u.mail_alert&&u.enabled).length, mr=USERS.filter(u=>u.mail_report&&u.enabled).length, sup=USERS.filter(u=>isSuper(u)&&u.enabled).length;
    const acks=Object.values(ACT).reduce((s,x)=>s+(x.acks30||0),0);
    const card=(v,l,sub,c,f)=>`<button type="button" class="um-kpi${f&&isOn(f)?" on":""}" ${f?`data-kf='${JSON.stringify(f)}'`:""} style="--c:${c}"><b>${v}</b><span>${l}</span>${sub?`<small>${sub}</small>`:""}</button>`;
    return `<div class="um-kpis">
      ${card(n,"USERS",`${act} active · ${blk} blocked`,"var(--green,#0e9f5a)",{status:""})}
      ${card(s7,"SEEN · 7 DAYS",`${never} never signed in`,"#2563eb",{status:"seen7"})}
      ${card(never,"NEVER SIGNED IN","invitation not used","#d97706",{status:"never"})}
      ${card(blk,"BLOCKED","sign-in disabled","#dc2626",{status:"blocked"})}
      ${card(mob,"📱 MOBILE",`${both} both · ${fix} fixed`,"#7c3aed",{biz:"mobile"})}
      ${card(fix,"🏠 FIXED",`${both} both · ${mob} mobile`,"var(--green,#0e9f5a)",{biz:"fixed"})}
      ${card(am,"ACK · MOBILE","holders (R1 audience)","#7c3aed",{ack:"mobile"})}
      ${card(af,"ACK · FIXED","holders (R1 audience)","var(--green,#0e9f5a)",{ack:"fixed"})}
      ${card(ma,"MAIL ALERT","receive every alert","#0891b2",{mail:"alert"})}
      ${card(mr,"MAIL REPORT","daily report","#0891b2",{mail:"report"})}
      ${card(acks,"ACKS · 30 D","by all users","#16a34a",{sort:"acks"})}
      ${card(sup,"SUPER ADMINS","full access","#64748b",{status:"super"})}
    </div>`;
  }
  const isOn=f=>Object.entries(f).every(([k,v])=>k==="sort"?F.sort===v:F[k]===v);

  function toolbar(list){
    const chip=(k,v,l,on)=>`<button type="button" class="um-fchip${on?" on":""}" data-fk="${k}" data-fv="${esc(v)}">${l}</button>`;
    return `<div class="um-tools">
      <div class="um-search"><span>⌕</span><input id="umQ" value="${esc(F.q)}" placeholder="Search name, e-mail, team, mobile, role, tag…"><button type="button" id="umQx" title="Clear" ${F.q?"":"hidden"}>✕</button></div>
      <div class="um-frow"><span class="um-flbl">Business</span>${["mobile","fixed","both"].map(b=>chip("biz",b,BIZ[b][0]+" "+BIZ[b][1],F.biz===b)).join("")}
        <span class="um-flbl">Status</span>${[["active","Active"],["blocked","Blocked"],["never","Never signed in"],["seen7","Seen 7 d"],["super","Super admin"]].map(([v,l])=>chip("status",v,l,F.status===v)).join("")}
        <span class="um-flbl">ACK holder</span>${[["mobile","📱 Mobile"],["fixed","🏠 Fixed"],["none","None"]].map(([v,l])=>chip("ack",v,l,F.ack===v)).join("")}
        <span class="um-flbl">Mail</span>${[["alert","Alert"],["report","Report"],["none","None"]].map(([v,l])=>chip("mail",v,l,F.mail===v)).join("")}</div>
      <div class="um-frow"><span class="um-flbl">Roles</span>${ROLES.map(([k,l])=>chip("role",k,l,F.roles.has(k))).join("")}</div>
      <div class="um-frow"><span class="um-flbl">Tags</span>${TAGS.map(t=>chip("tag",t,t,F.tags.has(t))).join("")}
        <span class="um-flbl" style="margin-left:auto">Sort</span><select id="umSort" class="um-sel">${[["name","Name"],["seen","Last seen"],["created","Newest"],["activity","Most active · 30 d"],["acks","Most acks · 30 d"]].map(([v,l])=>`<option value="${v}" ${F.sort===v?"selected":""}>${l}</option>`).join("")}</select>
        <button type="button" class="pill" id="umClear" style="padding:3px 10px">Clear filters</button></div>
      <div class="um-count"><b>${list.length}</b> of ${USERS.length} user${USERS.length===1?"":"s"}${SEL.size?` · <b style="color:var(--green)">${SEL.size} selected</b>`:""}</div>
    </div>`;
  }

  function bulkbar(){
    if(!SEL.size) return "";
    const b=(k,l,c)=>`<button type="button" class="pill um-bulk" data-bulk="${k}" style="padding:4px 10px;border-left-color:${c||"var(--green)"}">${l}</button>`;
    return `<div class="um-bulkbar"><b>${SEL.size} selected</b>
      ${b("ack_mobile:1","+ ACK Mobile","#7c3aed")}${b("ack_mobile:0","− ACK Mobile","#7c3aed")}${b("ack_fixed:1","+ ACK Fixed")}${b("ack_fixed:0","− ACK Fixed")}
      ${b("mail_alert:1","+ Mail alert","#0891b2")}${b("mail_alert:0","− Mail alert","#0891b2")}${b("mail_report:1","+ Mail report","#0891b2")}${b("mail_report:0","− Mail report","#0891b2")}
      ${b("business:mobile","→ Mobile","#7c3aed")}${b("business:fixed","→ Fixed")}${b("business:both","→ Both","#64748b")}
      ${b("enabled:0","Block","#dc2626")}${b("enabled:1","Unblock")}
      <button type="button" class="pill" id="umSelNone" style="padding:4px 10px;margin-left:auto">Deselect</button><span id="umBulkMsg" class="rl"></span></div>`;
  }

  function row(u){
    const a=ACT[u.email.toLowerCase()]||{}; const biz=BIZ[u.business||"both"]; const rs=rolesOf(u);
    const sw=(field,on,dis,title,color)=>`<label class="switch um-sw" title="${esc(title)}"><input type="checkbox" data-uid="${u.id}" data-field="${field}" ${on?"checked":""} ${dis?"disabled":""}><span class="slider" style="${on&&color?`background:${color}`:""}"></span></label>`;
    const last=u.last_login?`<span title="${ksa(u.last_login)} KSA">${ago(u.last_login)==="just now"?"just now":ago(u.last_login)+" ago"}</span>`:`<span style="color:#d97706">never signed in</span>`;
    return `<tr data-uid="${u.id}" class="${u.enabled?"":"u-blocked"}${SEL.has(u.id)?" sel":""}">
      <td class="um-c"><input type="checkbox" class="um-selchk" data-uid="${u.id}" ${SEL.has(u.id)?"checked":""}></td>
      <td class="um-who"><div class="um-av" style="background:hsl(${hue(u.email)} 55% 45%)">${esc(initials(u))}</div>
        <div class="um-id"><b>${esc(u.name||u.email.split("@")[0])}</b>${isSuper(u)?' <span class="um-super">SUPER</span>':""}<div class="um-mail">${esc(u.email)}</div><div class="um-sub">${[u.team,u.mobile].filter(Boolean).map(esc).join(" · ")||'<span style="color:var(--muted)">no team / mobile</span>'}</div></div></td>
      <td><span class="um-bizpill" style="background:${biz[2]}">${biz[0]} ${biz[1]}</span></td>
      <td><div class="um-roles">${rs.map(r=>`<span class="um-role${r==="super_admin"?" super":r==="admin"?" admin":""}">${esc(roleLabel(r))}</span>`).join("")||'<span class="rl">—</span>'}</div>
        ${(u.tags||[]).length?`<div class="um-tagrow">${u.tags.map(t=>`<span class="tagchip mini on" data-tag="${esc(t)}" style="pointer-events:none;padding:1px 7px;font-size:9.5px">${esc(t)}</span>`).join("")}</div>`:""}</td>
      <td><div class="um-st"><span class="status-pill ${u.enabled?"active":"blocked"}">${u.enabled?"Active":"Blocked"}</span><div class="um-last">${last}</div></div></td>
      <td class="um-c">${sw("mail_alert",u.mail_alert,false,"Receives every alert mail (with SOP)","#0891b2")}</td>
      <td class="um-c">${sw("mail_report",u.mail_report,false,"Receives the daily report","#0891b2")}</td>
      <td class="um-c"><div class="um-ackc">${sw("ack_mobile",u.ack_mobile,(u.business||"both")==="fixed","May take a Mobile incident — Reminder 1 audience","#7c3aed")}${sw("ack_fixed",u.ack_fixed,(u.business||"both")==="mobile","May take a Fixed incident — Reminder 1 audience","#0e9f5a")}</div></td>
      <td class="um-actv"><div><b>${a.actions30||0}</b> <span class="rl">actions</span></div><div><b style="color:${a.acks30?"var(--green)":"inherit"}">${a.acks30||0}</b> <span class="rl">acks${a.mtta_min!=null?` · MTTA ${a.mtta_min<60?a.mtta_min+" min":Math.round(a.mtta_min/60)+" h"}`:""}</span></div>${a.last_action?`<div class="rl">last ${ago(a.last_action)==="just now"?"just now":ago(a.last_action)+" ago"}</div>`:""}</td>
      <td class="um-act"><button type="button" class="ubtn edit" data-edit="${u.id}">✎ Edit</button><button type="button" class="ubtn ${u.enabled?"block":"unblock"}" data-block="${u.id}">${u.enabled?"Block":"Unblock"}</button></td>
    </tr>`;
  }

  function render(){
    if(!HOST) return;
    const list=filtered(); const allSel=list.length&&list.every(u=>SEL.has(u.id));
    HOST.innerHTML=`<div class="um-head"><div class="rl">People who can sign in to the console — roles, business scope, notifications and who holds acknowledgements. Click a KPI to filter.</div>
        <div class="um-headbtns"><button type="button" class="pill" id="umExport" style="border-left-color:var(--blue);padding:5px 12px">⬇ CSV</button><button type="button" class="btn" id="umNew">＋ New user</button></div></div>
      ${kpis()}${toolbar(list)}${bulkbar()}
      <div class="um-wrap"><table class="umtable um-v2">
        <tr><th class="um-c"><input type="checkbox" id="umSelAll" ${allSel?"checked":""} title="Select all shown"></th><th>USER</th><th>BUSINESS</th><th>ROLES · TAGS</th><th>STATUS</th><th class="um-c">MAIL<br>ALERT</th><th class="um-c">MAIL<br>REPORT</th><th class="um-c">ACK HOLDER<br><span class="rl">📱 · 🏠</span></th><th>ACTIVITY · 30 D</th><th>ACTIONS</th></tr>
        ${list.map(row).join("")||`<tr><td colspan="10" style="padding:22px;color:var(--muted);text-align:center">No user matches these filters.</td></tr>`}
      </table></div>`;
    wire();
  }

  function wire(){
    const h=HOST;
    h.querySelectorAll("[data-kf]").forEach(b=>b.onclick=()=>{ const f=JSON.parse(b.dataset.kf); const on=isOn(f); for(const k of Object.keys(f)){ if(k==="sort") F.sort=on?"name":f[k]; else F[k]=on?"":f[k]; } render(); });
    const q=h.querySelector("#umQ"); let t; q.oninput=()=>{ clearTimeout(t); t=setTimeout(()=>{ F.q=q.value; const pos=q.selectionStart; render(); const nq=HOST.querySelector("#umQ"); nq.focus(); nq.setSelectionRange(pos,pos); },220); };
    h.querySelector("#umQx").onclick=()=>{ F.q=""; render(); };
    h.querySelectorAll("[data-fk]").forEach(b=>b.onclick=()=>{ const k=b.dataset.fk,v=b.dataset.fv;
      if(k==="role"){ F.roles.has(v)?F.roles.delete(v):F.roles.add(v); } else if(k==="tag"){ F.tags.has(v)?F.tags.delete(v):F.tags.add(v); } else F[k]=(F[k]===v?"":v); render(); });
    h.querySelector("#umSort").onchange=e=>{ F.sort=e.target.value; render(); };
    h.querySelector("#umClear").onclick=()=>{ F.q="";F.biz="";F.roles.clear();F.status="";F.ack="";F.mail="";F.tags.clear();F.sort="name"; render(); };
    h.querySelector("#umNew").onclick=openNewUser;
    h.querySelector("#umExport").onclick=exportXlsx;
    const all=h.querySelector("#umSelAll"); if(all) all.onchange=()=>{ const list=filtered(); if(all.checked) list.forEach(u=>SEL.add(u.id)); else list.forEach(u=>SEL.delete(u.id)); render(); };
    h.querySelectorAll(".um-selchk").forEach(c=>c.onchange=()=>{ const id=Number(c.dataset.uid); c.checked?SEL.add(id):SEL.delete(id); render(); });
    const dn=h.querySelector("#umSelNone"); if(dn) dn.onclick=()=>{ SEL.clear(); render(); };
    h.querySelectorAll(".um-sw input[data-field]").forEach(cb=>cb.onchange=async()=>{ const id=cb.dataset.uid; const u=USERS.find(x=>String(x.id)===id); const f=cb.dataset.field; const v=cb.checked;
      try{ await api("/api/users/"+id,{method:"PATCH",body:JSON.stringify({[f]:v})}); if(u) u[f]=v; const r=cb.closest("tr"); r.classList.add("flash"); setTimeout(()=>r.classList.remove("flash"),600); HOST.querySelector(".um-kpis").outerHTML=kpis(); h.querySelectorAll("[data-kf]").forEach(b=>b.onclick=()=>{ const f2=JSON.parse(b.dataset.kf); const on=isOn(f2); for(const k of Object.keys(f2)){ if(k==="sort") F.sort=on?"name":f2[k]; else F[k]=on?"":f2[k]; } render(); }); }
      catch(e){ cb.checked=!v; alert(e.message); } });
    h.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{ const u=USERS.find(x=>String(x.id)===b.dataset.edit); if(u&&window.openUserPanel) window.openUserPanel(u); });
    h.querySelectorAll("[data-block]").forEach(b=>b.onclick=async()=>{ const id=b.dataset.block; const enable=b.classList.contains("unblock");
      if(!enable&&!b.dataset.armed){ b.dataset.armed="1"; const t0=b.textContent; b.textContent="Confirm block"; b.classList.add("arm"); setTimeout(()=>{ if(b.isConnected){ delete b.dataset.armed; b.textContent=t0; b.classList.remove("arm"); } },4000); return; }
      try{ await api("/api/users/"+id,{method:"PATCH",body:JSON.stringify({enabled:enable})}); await reload(); }catch(e){ alert(e.message); } });
    h.querySelectorAll("[data-bulk]").forEach(b=>b.onclick=async()=>{ const [f,vraw]=b.dataset.bulk.split(":"); const v=(f==="business")?vraw:vraw==="1"; const ids=[...SEL]; const m=h.querySelector("#umBulkMsg"); let ok=0,fail=0; m.textContent=`Applying to ${ids.length}…`;
      for(const id of ids){ try{ await api("/api/users/"+id,{method:"PATCH",body:JSON.stringify({[f]:v})}); ok++; }catch(e){ fail++; } }
      m.textContent=`${ok} updated${fail?` · ${fail} failed`:""}`; await reload(); });
  }

  /* ---- New user drawer (same look as the edit drawer in ops.js) ---- */
  function openNewUser(){
    let ov=document.getElementById("newUserPanel");
    if(!ov){ ov=document.createElement("div"); ov.id="newUserPanel"; ov.className="drawer-ov"; ov.innerHTML=`<div class="drawer" id="newUserBody"></div>`; document.body.appendChild(ov); ov.addEventListener("click",e=>{ if(e.target===ov) close(); }); }
    const body=ov.querySelector("#newUserBody");
    const close=()=>{ ov.classList.remove("open"); document.removeEventListener("keydown",onEsc); }; const onEsc=e=>{ if(e.key==="Escape") close(); };
    body.innerHTML=`<div class="drawer-hd"><span class="av ud-av">＋</span><div style="min-width:0"><div style="font-weight:800;font-size:14px">New console user</div><div style="font-size:11px;opacity:.8">No password — a welcome mail with a sign-in code is sent</div></div><span class="x" id="nuX" title="Close">×</span></div>
      <div class="ud-body">
        <div class="um-lbl">E-MAIL</div><input class="um-input" id="nuEmail" placeholder="person@salam.sa · @salammobile.sa" autocomplete="off">
        <div class="ud-grid"><div><div class="um-lbl">NAME</div><input class="um-input" id="nuName" placeholder="Full name"></div><div><div class="um-lbl">MOBILE</div><input class="um-input" id="nuMobile" placeholder="05x xxx xxxx" inputmode="tel"></div></div>
        <div class="um-lbl">TEAM <span class="ud-hint">free text</span></div><input class="um-input" id="nuTeam" placeholder="e.g. TCS L1 · Sigma L2 · Digital Ops">
        <div class="um-lbl">BUSINESS <span class="ud-hint">which side of the console</span></div>
        <div class="um-biz" id="nuBiz">${["mobile","fixed","both"].map(b=>`<button type="button" class="bizchip ${b} ${b==="both"?"on":""}" data-biz="${b}">${BIZ[b][0]} ${BIZ[b][1]}</button>`).join("")}</div>
        <div class="um-lbl">ROLES</div><div class="um-checks" id="nuRoles">${ROLES.map(([k,l])=>`<label class="um-check"><input type="checkbox" value="${k}" ${k==="admin"?"checked":""}><span>${l}</span></label>`).join("")}</div>
        <div class="um-lbl">NOTIFICATIONS &amp; ACKNOWLEDGEMENTS</div>
        <div class="um-checks">
          <label class="um-check"><input type="checkbox" id="nuMailAlert"><span>Mail alert</span></label>
          <label class="um-check"><input type="checkbox" id="nuMailReport"><span>Mail report</span></label>
          <label class="um-check"><input type="checkbox" id="nuAckM"><span>ACK holder · 📱 Mobile</span></label>
          <label class="um-check"><input type="checkbox" id="nuAckF"><span>ACK holder · 🏠 Fixed</span></label>
        </div>
        <div class="um-lbl">TEAM TAGS</div><div class="um-tags" id="nuTags">${TAGS.map(t=>`<button type="button" class="tagchip" data-tag="${t}">${t}</button>`).join("")}</div>
        <div class="ud-actions"><button type="button" class="um-btn" id="nuAdd">Create user</button><button type="button" class="tkm-btn" id="nuCancel">Cancel</button><span class="ud-msg" id="nuMsg"></span></div>
      </div>`;
    body.querySelector("#nuX").onclick=close; body.querySelector("#nuCancel").onclick=close;
    body.querySelectorAll("#nuBiz .bizchip").forEach(c=>c.onclick=()=>{ body.querySelectorAll("#nuBiz .bizchip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); const b=c.dataset.biz; body.querySelector("#nuAckM").disabled=b==="fixed"; body.querySelector("#nuAckF").disabled=b==="mobile"; if(b==="fixed") body.querySelector("#nuAckM").checked=false; if(b==="mobile") body.querySelector("#nuAckF").checked=false; });
    body.querySelectorAll("#nuTags .tagchip").forEach(c=>c.onclick=()=>c.classList.toggle("on"));
    const msg=(t,bad)=>{ const m=body.querySelector("#nuMsg"); m.textContent=t; m.style.color=bad?"var(--red)":"var(--green-dark)"; };
    body.querySelector("#nuAdd").onclick=async()=>{
      const email=body.querySelector("#nuEmail").value.trim().toLowerCase();
      if(!/@(salam\.sa|salammobile\.sa)$/i.test(email)){ msg("Use a @salam.sa or @salammobile.sa e-mail.",true); body.querySelector("#nuEmail").focus(); return; }
      const roles=[...body.querySelectorAll("#nuRoles input:checked")].map(x=>x.value); if(!roles.length){ msg("Pick at least one role.",true); return; }
      const payload={ email, name:body.querySelector("#nuName").value.trim()||null, mobile:body.querySelector("#nuMobile").value.trim()||null, team:body.querySelector("#nuTeam").value.trim()||null, roles,
        business:(body.querySelector("#nuBiz .bizchip.on")||{}).dataset.biz||"both", tags:[...body.querySelectorAll("#nuTags .tagchip.on")].map(x=>x.dataset.tag),
        mail_alert:body.querySelector("#nuMailAlert").checked, mail_report:body.querySelector("#nuMailReport").checked, ack_mobile:body.querySelector("#nuAckM").checked, ack_fixed:body.querySelector("#nuAckF").checked };
      const btn=body.querySelector("#nuAdd"); btn.disabled=true; msg("Creating…");
      try{ await api("/api/users",{method:"POST",body:JSON.stringify(payload)}); msg("Created — welcome mail sent."); setTimeout(close,500); await reload(); }
      catch(e){ msg(e.message,true); btn.disabled=false; }
    };
    ov.classList.add("open"); document.addEventListener("keydown",onEsc); setTimeout(()=>body.querySelector("#nuEmail").focus(),120);
  }

  function exportXlsx(){
    const list=filtered();
    const rows=[["Name","E-mail","Team","Mobile","Business","Roles","Tags","Status","Last sign-in (KSA)","Mail alert","Mail report","ACK Mobile","ACK Fixed","Actions 30 d","Acks 30 d","MTTA (min)","Created (KSA)"]];
    list.forEach(u=>{ const a=ACT[u.email.toLowerCase()]||{}; rows.push([u.name||"",u.email,u.team||"",u.mobile||"",u.business||"both",rolesOf(u).map(roleLabel).join(", "),(u.tags||[]).join(", "),u.enabled?"active":"blocked",u.last_login?ksa(u.last_login):"never",u.mail_alert?"yes":"no",u.mail_report?"yes":"no",u.ack_mobile?"yes":"no",u.ack_fixed?"yes":"no",a.actions30||0,a.acks30||0,a.mtta_min==null?"":a.mtta_min,u.created_at?ksa(u.created_at):""]); });
    const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`console_users_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }

  async function reload(){ try{ const d=await api("/api/users"); USERS=d.users||[]; ACT=d.activity||{}; }catch(e){ if(HOST) HOST.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; } render(); }

  window.renderUsersMgmt=async function(host){ HOST=host; ensureCss(); if(!HOST.firstChild) HOST.innerHTML=`<div class="sub">Loading users…</div>`; await loadRoles(); await reload(); };
  window.reloadUsersMgmt=reload;

  function ensureCss(){
    if(document.getElementById("um2-css")) return;
    const st=document.createElement("style"); st.id="um2-css"; st.textContent=`
      .um-head{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.um-headbtns{margin-left:auto;display:flex;gap:8px;align-items:center}
      .um-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:8px;margin-bottom:12px}
      .um-kpi{text-align:left;border:1px solid var(--line);border-left:4px solid var(--c);background:var(--card);border-radius:10px;padding:9px 11px;cursor:pointer;font:inherit;color:inherit;transition:transform .1s,box-shadow .15s}
      .um-kpi:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(2,6,23,.12)}.um-kpi.on{outline:2px solid var(--c);outline-offset:-2px;background:var(--panel2,var(--card))}
      .um-kpi b{display:block;font-size:20px;line-height:1.1}.um-kpi span{display:block;font-size:9.5px;letter-spacing:.9px;font-weight:800;color:var(--muted);margin-top:3px}.um-kpi small{display:block;font-size:10.5px;color:var(--muted);margin-top:2px}
      .um-tools{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px 12px;margin-bottom:10px}
      .um-search{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;background:var(--bg);padding:6px 10px;margin-bottom:8px}.um-search span{color:var(--muted);font-size:16px}
      .um-search input{flex:1;border:0;background:transparent;font:inherit;font-size:13.5px;color:inherit;outline:0}.um-search button{border:0;background:var(--line);color:var(--ink);border-radius:999px;width:22px;height:22px;cursor:pointer;font-size:11px}
      .um-frow{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}.um-flbl{font-size:9.5px;letter-spacing:1px;font-weight:800;color:var(--muted);margin:0 4px 0 6px}.um-frow .um-flbl:first-child{margin-left:0}
      .um-fchip{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:999px;padding:3px 10px;font:inherit;font-size:11.5px;font-weight:600;cursor:pointer}.um-fchip.on{background:var(--green,#0e9f5a);border-color:var(--green,#0e9f5a);color:#fff}
      .um-sel{font:inherit;font-size:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:inherit;padding:4px 8px}
      .um-count{font-size:12px;color:var(--muted);margin-top:4px}
      .um-bulkbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;border:1px solid var(--green,#0e9f5a);background:rgba(14,159,90,.08);border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:12.5px}
      .umtable.um-v2 td{vertical-align:middle;padding:9px 10px}.umtable.um-v2 th{white-space:nowrap}.um-c{text-align:center}
      .um-who{display:flex;gap:10px;align-items:center;min-width:240px}.um-av{width:36px;height:36px;border-radius:50%;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;flex:none}
      .um-id b{font-size:13px}.um-mail{font-size:11.5px;color:var(--muted);font-family:ui-monospace,Menlo,monospace}.um-sub{font-size:11px;color:var(--muted)}
      .um-super{display:inline-block;background:#0b3d2b;color:#c9f3de;font-size:9px;font-weight:800;letter-spacing:.6px;border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:2px}
      .um-bizpill{display:inline-block;color:#fff;font-weight:700;font-size:11px;border-radius:999px;padding:3px 10px;white-space:nowrap}
      .um-roles{display:flex;flex-wrap:wrap;gap:4px}.um-role{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:1px 7px;font-size:10.5px;font-weight:700;background:var(--bg)}.um-role.super{background:#0b3d2b;color:#c9f3de;border-color:#0b3d2b}.um-role.admin{background:rgba(14,159,90,.12);border-color:var(--green,#0e9f5a)}
      .um-tagrow{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px}.um-last{font-size:11px;color:var(--muted);margin-top:3px}
      .um-ackc{display:inline-flex;gap:6px}.um-sw{transform:scale(.85)}
      .um-actv{font-size:11.5px;white-space:nowrap}.um-actv b{font-size:13px}
      .um-act{white-space:nowrap}.um-act .ubtn{margin-right:6px}
      tr.sel td{background:rgba(14,159,90,.06)}tr.flash td{background:rgba(14,159,90,.18);transition:background .6s}
      @media (max-width:760px){.um-kpis{grid-template-columns:repeat(2,1fr)}.um-who{min-width:180px}.um-headbtns{margin-left:0;width:100%}}`;
    document.head.appendChild(st);
  }
})();
