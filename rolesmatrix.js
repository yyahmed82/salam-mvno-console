/* rolesmatrix.js — Settings › User management › Roles & permissions  (rebuilt 19 Sep 2026)
 *
 * The old screen was one table: 14 roles × 27 columns of bare checkboxes under rotated headers. You could not
 * tell what a box meant without counting columns, could not see whether a role was held by anyone, and saving
 * wrote silently. On a phone it was unusable.
 *
 * Now: pick a role on the left, edit it on the right. Pages are grouped the way the nav is grouped (Mobile ·
 * Fixed · Cross-business · Shared), each group has a select-all, every feature carries the sentence that says
 * what it actually grants, and a live preview shows the navigation that role would get. The wide grid survives
 * underneath as a READ-ONLY heat map — good for "who can export?", never for editing. Saving shows the diff and
 * how many people each change touches before it writes.
 *
 * Super Admin is locked full and cannot be reduced (enforced again server-side in roles.mergeOverrides).
 * Everyone else sees this read-only — and since 19 Sep 2026 only Super Admin can load the page at all, because
 * /api/users and /api/roles/* are pinned to requireSuper rather than to a tick box inside this very matrix. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const API=window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts))
    .then(r=>{ if(!r.ok) return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));}); return r.json(); });
  const SES=()=>(window.opsSession?window.opsSession():{});
  const isSuper=()=>{ const s=SES(); return !!(s.me&&(s.me.realRole==="super_admin"||(s.me.realRoles||[]).includes("super_admin"))); };

  let DATA=null, DRAFT=null, SEL=null, Q="", BUSY=false;

  const GROUP_LABEL={ mobile:"Mobile", fixed:"Fixed", cross:"Cross-business", shared:"Shared" };
  const GROUP_NOTE={ mobile:"MVNO pages, hidden for a Fixed-only account", fixed:"FTTH · FTTB · 5G home pages, hidden for a Mobile-only account",
    cross:"Belongs to neither business — survives both scopes", shared:"Customer 360, settings and the console itself" };
  const GROUP_ORDER=["mobile","fixed","cross","shared"];

  /* the nav as a person meets it, so the preview reads like the console and not like a list of keys */
  const NAV_MAP=[
    ["Top bar", [["dashboard","Home"],["exec","Executive Dashboard"],["explore","Customer 360"]]],
    ["Mobile ▾", [["dashboard","Operations Dashboard"],["monitoring","Monitoring › Connectivity & APIs"],["dms","Monitoring › DMS"],
      ["errors","Troubleshoot"],["alerts","Alerts"],["analytics","Reports"],["explore","Explore — topology, docs, journeys"]]],
    ["Fixed ▾", [["fixed","Operations Dashboard"],["fixed_epurchase","Monitoring › Epurchase"],["fixed_salamhome","Monitoring › Salam Home app"],
      ["fixed_maps","Monitoring › SDA map & QR codes"],["errors_placeholder",null],["fixed_errors","Troubleshoot"],["fixed_alerts","Alerts"],["fixed_leads","Leads · OCU (restricted)"],
      ["fixed_reports","Reports"],["fixed_explore","Playbook & Diagrams"]]],
    ["⚙ Settings", [["settings","Settings panels"],["noc","NOC wall"],["tickets","Tickets & feedback"],["audit","Audit log"],
      ["governance","IT Governance — SLA, vendors, SLO"],["cst","Regulatory — CST Arqami & escalations"],["users","User management"]]],
    ["Elsewhere", [["workbench","L2 Workbench"]]]
  ];

  function ensureCss(){
    if(document.getElementById("rolesmatrix-css")) return;
    const st=document.createElement("style"); st.id="rolesmatrix-css";
    st.textContent=`
      .rp{display:grid;grid-template-columns:minmax(230px,280px) 1fr;gap:16px;align-items:start}
      .rp-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
      .rp-search{flex:1;min-width:150px;max-width:300px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;
        background:var(--card);color:var(--ink);font:inherit;font-size:13px}
      .rp-search:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px var(--green-bg)}
      .rp-btn{border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-size:12.5px;font-weight:700;
        padding:8px 14px;border-radius:10px;cursor:pointer;transition:background .15s,border-color .15s,transform .15s}
      .rp-btn:hover:not(:disabled){border-color:var(--green);transform:translateY(-1px)}
      .rp-btn:disabled{opacity:.45;cursor:default}
      .rp-btn.go{background:linear-gradient(135deg,#0e9f5a,#019c20);border-color:transparent;color:#fff;box-shadow:0 4px 12px rgba(14,159,90,.28)}
      .rp-btn.go:hover:not(:disabled){filter:brightness(1.06)}
      .rp-btn.ghost{background:transparent}
      .rp-dirty{margin-left:auto;display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;
        color:var(--tint-amber-fg);background:var(--tint-amber);padding:6px 11px;border-radius:999px}
      .rp-dirty[hidden]{display:none}
      /* ---- role list ---- */
      .rp-list{display:flex;flex-direction:column;gap:6px;max-height:620px;overflow:auto;padding-right:4px;scrollbar-width:thin}
      .rp-role{display:flex;align-items:flex-start;gap:10px;width:100%;text-align:left;padding:10px 12px;border-radius:11px;cursor:pointer;
        border:1px solid var(--line);background:var(--card);font:inherit;color:var(--ink);transition:border-color .15s,background .15s,transform .15s}
      .rp-role:hover{border-color:var(--green);transform:translateX(2px)}
      .rp-role.on{border-color:var(--green);background:var(--green-bg);box-shadow:inset 3px 0 0 var(--green)}
      .rp-role .rp-av{width:30px;height:30px;border-radius:9px;flex:none;display:flex;align-items:center;justify-content:center;
        font-size:12px;font-weight:800;background:var(--bg);border:1px solid var(--line);color:var(--muted)}
      .rp-role.on .rp-av{background:var(--green);border-color:transparent;color:#fff}
      .rp-role .rp-rt{min-width:0;flex:1}
      .rp-role b{display:block;font-size:13px;font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .rp-role small{display:block;font-size:10.5px;color:var(--muted);margin-top:2px}
      .rp-tag{display:inline-block;font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
        padding:2px 6px;border-radius:5px;margin-left:5px;vertical-align:1px}
      .rp-tag.lock{background:var(--green-bg);color:var(--green-dark)}
      .rp-tag.custom{background:var(--tint-amber);color:var(--tint-amber-fg)}
      .rp-tag.mod{background:var(--tint-blue,rgba(37,99,235,.12));color:var(--blue,#2563eb)}
      .rp-tag.zero{background:var(--bg);color:var(--muted);border:1px solid var(--line)}
      /* ---- editor ---- */
      .rp-ed{border:1px solid var(--line);border-radius:14px;background:var(--card);overflow:hidden}
      .rp-hd{padding:15px 18px;border-bottom:1px solid var(--line);background:var(--bg)}
      .rp-hd h3{margin:0 0 3px;font-size:16px;font-weight:800;letter-spacing:-.01em}
      .rp-hd p{margin:6px 0 0;font-size:12.5px;color:var(--muted);line-height:1.55;max-width:70ch}
      .rp-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin-top:8px}
      .rp-meta b{color:var(--ink);font-weight:700}
      .rp-sec{padding:15px 18px;border-bottom:1px solid var(--line)}
      .rp-sec:last-child{border-bottom:0}
      .rp-sec>h4{margin:0 0 3px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:800}
      .rp-grp{margin-top:14px}
      .rp-grp-h{display:flex;align-items:center;gap:9px;margin-bottom:7px}
      .rp-grp-h b{font-size:12px;font-weight:800}
      .rp-grp-h small{font-size:10.5px;color:var(--muted);flex:1;min-width:0}
      .rp-all{border:1px solid var(--line);background:transparent;color:var(--muted);font:inherit;font-size:10.5px;font-weight:700;
        padding:3px 9px;border-radius:7px;cursor:pointer;flex:none}
      .rp-all:hover{border-color:var(--green);color:var(--green-dark)}
      .rp-opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(235px,1fr));gap:5px}
      .rp-opt{display:flex;align-items:flex-start;gap:9px;padding:8px 10px;border-radius:9px;border:1px solid transparent;cursor:pointer;
        background:var(--bg);transition:border-color .13s,background .13s}
      .rp-opt:hover{border-color:var(--line)}
      .rp-opt.on{background:var(--green-bg);border-color:transparent}
      .rp-opt.ro{cursor:default;opacity:.75}
      .rp-opt input{margin:1px 0 0;accent-color:var(--green);width:15px;height:15px;flex:none;cursor:inherit}
      .rp-opt span{min-width:0;font-size:12.5px;line-height:1.4}
      .rp-opt em{display:block;font-style:normal;font-size:10.5px;color:var(--muted);margin-top:2px;line-height:1.45}
      /* ---- nav preview ---- */
      .rp-prev{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:10px}
      .rp-prev section{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--bg)}
      .rp-prev h5{margin:0 0 6px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:800}
      .rp-prev li{list-style:none;font-size:12px;padding:2.5px 0;color:var(--ink)}
      .rp-prev li.off{color:var(--muted);text-decoration:line-through;opacity:.5}
      .rp-prev li i{font-style:normal;color:var(--green);margin-right:6px;font-size:10px}
      .rp-prev li.off i{color:var(--muted)}
      .rp-prev .none{font-size:11.5px;color:var(--muted);font-style:italic}
      /* ---- heat map ---- */
      .rp-heat-wrap{margin-top:18px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card)}
      .rp-heat-hd{padding:13px 16px;border-bottom:1px solid var(--line);background:var(--bg);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .rp-heat-hd b{font-size:13px}
      .rp-heat-hd small{font-size:11.5px;color:var(--muted)}
      .rp-scroll{overflow:auto;max-height:460px;scrollbar-width:thin}
      table.rp-heat{border-collapse:separate;border-spacing:0;font-size:11px;width:max-content;min-width:100%}
      table.rp-heat th,table.rp-heat td{padding:0;border-bottom:1px solid var(--line)}
      table.rp-heat thead th{position:sticky;top:0;z-index:3;background:var(--card);border-bottom:1px solid var(--line)}
      table.rp-heat thead tr.g th{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:800;
        padding:7px 6px;text-align:center;border-left:1px solid var(--line)}
      table.rp-heat thead tr.c th{height:118px;vertical-align:bottom;padding:0 0 8px}
      table.rp-heat thead tr.c th span{display:block;writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;
        font-size:10.5px;font-weight:600;color:var(--ink);margin:0 auto;max-height:104px;overflow:hidden}
      table.rp-heat th.rp-rn{position:sticky;left:0;z-index:4;background:var(--card);text-align:left;padding:8px 12px;min-width:150px;
        border-right:1px solid var(--line)}
      table.rp-heat tbody th.rp-rn{z-index:2;font-weight:700;font-size:12px}
      table.rp-heat tbody th.rp-rn small{display:block;font-weight:500;font-size:10px;color:var(--muted)}
      table.rp-heat tbody tr{cursor:pointer}
      table.rp-heat tbody tr:hover th.rp-rn,table.rp-heat tbody tr:hover td{background:var(--bg)}
      table.rp-heat tbody tr.on th.rp-rn,table.rp-heat tbody tr.on td{background:var(--green-bg)}
      table.rp-heat td{text-align:center;width:26px;min-width:26px}
      .rp-dot{display:inline-block;width:11px;height:11px;border-radius:3px;background:var(--line)}
      .rp-dot.y{background:var(--green)}
      .rp-dot.n{background:transparent;border:1px solid var(--line)}
      /* ---- diff dialog ---- */
      .rp-mask{position:fixed;inset:0;z-index:4000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:18px}
      .rp-dlg{background:var(--card);border:1px solid var(--line);border-radius:16px;max-width:620px;width:100%;max-height:82vh;
        display:flex;flex-direction:column;box-shadow:0 26px 70px rgba(15,23,42,.35)}
      .rp-dlg header{padding:16px 20px;border-bottom:1px solid var(--line)}
      .rp-dlg header h3{margin:0;font-size:16px;font-weight:800}
      .rp-dlg header p{margin:5px 0 0;font-size:12.5px;color:var(--muted)}
      .rp-dlg .body{padding:14px 20px;overflow:auto;flex:1}
      .rp-dlg footer{padding:13px 20px;border-top:1px solid var(--line);display:flex;gap:9px;justify-content:flex-end;flex-wrap:wrap}
      .rp-chg{border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin-bottom:9px;background:var(--bg)}
      .rp-chg b{font-size:13px}
      .rp-chg .who{font-size:11px;color:var(--muted);margin-left:6px}
      .rp-chg ul{margin:7px 0 0;padding:0}
      .rp-chg li{list-style:none;font-size:12px;padding:2px 0}
      .rp-chg li.add{color:var(--green-dark)} .rp-chg li.add::before{content:"+ ";font-weight:800}
      .rp-chg li.rem{color:var(--red,#dc2626)} .rp-chg li.rem::before{content:"− ";font-weight:800}
      .rp-warn{font-size:12px;line-height:1.5;background:var(--tint-amber);color:var(--tint-amber-fg);border-radius:9px;padding:9px 12px;margin-bottom:11px}
      /* stacked: the role list becomes a horizontal strip, so a card must size to its content and let the
         next one peek in — width:100% from the base rule would make each card fill the screen and hide the rest */
      @media (max-width:900px){ .rp{grid-template-columns:1fr} .rp-list{max-height:none;flex-direction:row;overflow-x:auto;padding:2px 2px 8px;scroll-snap-type:x proximity}
        .rp-role{width:auto;min-width:184px;max-width:230px;flex:none;scroll-snap-align:start} .rp-role:hover{transform:none} }
      @media (max-width:560px){ .rp-opts{grid-template-columns:1fr} .rp-bar{gap:7px} .rp-search{max-width:none} .rp-dirty{margin-left:0} }
    `;
    document.head.appendChild(st);
  }

  /* ---------- draft state ---------- */
  const roleOf=n=>DATA.roles.find(r=>r.name===n);
  function initDraft(){ DRAFT={}; DATA.roles.forEach(r=>{ DRAFT[r.name]={views:{...r.views},caps:{...r.caps}}; }); }
  function diffOf(n){
    const base=roleOf(n), d=DRAFT[n]; if(!base||!d) return null;
    const av=[],rv=[],ac=[],rc=[];
    DATA.views.forEach(v=>{ if(!!d.views[v.key]!==!!base.views[v.key]) (d.views[v.key]?av:rv).push(v.label); });
    DATA.caps.forEach(c=>{ if(!!d.caps[c.key]!==!!base.caps[c.key]) (d.caps[c.key]?ac:rc).push(c.label); });
    return (av.length||rv.length||ac.length||rc.length)?{name:n,label:base.label,users:base.users||0,av,rv,ac,rc}:null;
  }
  const allDiffs=()=>DATA.roles.map(r=>diffOf(r.name)).filter(Boolean);

  /* ---------- pieces ---------- */
  function roleList(){
    const q=Q.toLowerCase();
    const shown=DATA.roles.filter(r=>!q||r.label.toLowerCase().includes(q)||r.team.toLowerCase().includes(q)||r.name.includes(q));
    if(!shown.length) return `<div class="sub" style="padding:10px">No role matches “${esc(Q)}”.</div>`;
    return shown.map(r=>{
      const d=DRAFT[r.name], pages=DATA.views.filter(v=>d.views[v.key]).length, feats=DATA.caps.filter(c=>d.caps[c.key]).length;
      const init=(r.label.match(/[A-Za-z]/)||["?"])[0].toUpperCase();
      const tags=(r.locked?`<span class="rp-tag lock">full</span>`:"")+(r.custom?`<span class="rp-tag custom">custom</span>`:"")
        +(diffOf(r.name)?`<span class="rp-tag mod">edited</span>`:"")+(!r.users?`<span class="rp-tag zero">0 users</span>`:"");
      return `<button type="button" class="rp-role ${SEL===r.name?"on":""}" data-role="${esc(r.name)}">
        <span class="rp-av">${esc(init)}</span>
        <span class="rp-rt"><b>${esc(r.label)}${tags}</b>
        <small>${esc(r.team)} · ${pages} page${pages===1?"":"s"} · ${feats} feature${feats===1?"":"s"}${r.users?` · ${r.users} user${r.users===1?"":"s"}`:""}</small></span></button>`;
    }).join("");
  }

  /* restricted pages (alpha.166): Fixed › Leads belongs to the OCU role and Super Admin only — the server drops it from any
   * other role on every merge (roles.PINNED_VIEWS), so the box is locked here instead of saving a tick that never applies */
  const pinnedOff=(view,role)=>{ const p=DATA&&DATA.pinned&&DATA.pinned[view]; return !!p && !p.includes(role); };
  function optRow(kind,key,label,on,ro,note){
    return `<label class="rp-opt ${on?"on":""} ${ro?"ro":""}">
      <input type="checkbox" data-k="${kind}" data-key="${esc(key)}" ${on?"checked":""} ${ro?"disabled":""}>
      <span>${esc(label)}${note?`<em>${esc(note)}</em>`:""}</span></label>`;
  }

  function navPreview(d){
    return NAV_MAP.map(([sec,items])=>{
      const li=items.filter(([k])=>k!=="errors_placeholder").map(([k,lab])=>{
        const on=!!d.views[k];
        return `<li class="${on?"":"off"}"><i>${on?"●":"○"}</i>${esc(lab)}</li>`;
      }).join("");
      const any=items.some(([k])=>k!=="errors_placeholder"&&d.views[k]);
      return `<section><h5>${esc(sec)}</h5>${any?`<ul style="margin:0;padding:0">${li}</ul>`:`<div class="none">nothing in this menu</div>`}</section>`;
    }).join("");
  }

  function editor(){
    if(!SEL) return `<div class="rp-ed"><div class="rp-sec"><div class="sub">Pick a role on the left to see and edit what it can reach.</div></div></div>`;
    const r=roleOf(SEL), d=DRAFT[SEL], ro=r.locked||!isSuper();
    const seen=r.last_seen?new Date(r.last_seen).toLocaleDateString("en-GB"):null;
    const groups=GROUP_ORDER.map(g=>{
      const vs=DATA.views.filter(v=>(v.group||"shared")===g); if(!vs.length) return "";
      const onN=vs.filter(v=>d.views[v.key]).length;
      return `<div class="rp-grp"><div class="rp-grp-h"><b>${GROUP_LABEL[g]}</b><small>${GROUP_NOTE[g]}</small>
        <span style="font-size:10.5px;color:var(--muted);font-weight:700">${onN}/${vs.length}</span>
        ${ro?"":`<button type="button" class="rp-all" data-all="${g}">${vs.filter(v=>!pinnedOff(v.key,SEL)).every(v=>d.views[v.key])?"none":"all"}</button>`}</div>
        <div class="rp-opts">${vs.map(v=>{ const lock=pinnedOff(v.key,SEL); return optRow("view",v.key,v.label,!!d.views[v.key],ro||lock,lock?"OCU and Super Admin only — restricted section":""); }).join("")}</div></div>`;
    }).join("");
    return `<div class="rp-ed">
      <div class="rp-hd">
        <h3>${esc(r.label)}${r.locked?`<span class="rp-tag lock">locked full</span>`:""}${r.custom?`<span class="rp-tag custom">custom</span>`:""}</h3>
        <div class="rp-meta"><span>Team <b>${esc(r.team)}</b></span><span>Key <b>${esc(r.name)}</b></span>
          <span>Held by <b>${r.users||0}</b> user${r.users===1?"":"s"}</span>
          ${r.never_signed_in?`<span>Never signed in <b>${r.never_signed_in}</b></span>`:""}
          ${seen?`<span>Last sign-in <b>${esc(seen)}</b></span>`:""}</div>
        ${r.note?`<p>${esc(r.note)}</p>`:""}
        ${r.locked?`<p><b>Super Admin cannot be reduced.</b> The server forces it full on every merge, so a mistake here can never lock the console owner out.</p>`:""}
      </div>
      <div class="rp-sec"><h4>Pages this role can open</h4>${groups}</div>
      <div class="rp-sec"><h4>What this role can do</h4>
        <div class="rp-opts" style="margin-top:9px">${DATA.caps.map(c=>optRow("cap",c.key,c.label,!!d.caps[c.key],ro||c.key==="manageUsers"&&!r.locked,c.note||"")).join("")}</div>
        ${r.locked?"":`<div class="sub" style="margin-top:9px;font-size:11.5px">Manage users &amp; roles is fixed to Super Admin: <code>/api/users</code> and <code>/api/roles/*</code> check the tier, not this box.</div>`}
      </div>
      <div class="rp-sec"><h4>What this role would see</h4>
        <div class="sub" style="font-size:11.5px">The navigation as it renders for this role — a Mobile-only or Fixed-only account then loses the other side's menu on top of this.</div>
        <div class="rp-prev">${navPreview(d)}</div></div>
    </div>`;
  }

  function heat(){
    /* order by family, not by the order the server happened to list them — otherwise one stray page in the
     * middle of the array splits a group header into two, and the heat map stops reading as four blocks */
    const rank=g=>{const i=GROUP_ORDER.indexOf(g);return i<0?GROUP_ORDER.length:i;};
    const vcols=DATA.views.map((v,i)=>({...v,g:v.group||"shared",kind:"view",_i:i}))
      .sort((a,b)=>rank(a.g)-rank(b.g)||a._i-b._i);
    const cols=[...vcols,...DATA.caps.map(c=>({...c,g:"feat",kind:"cap"}))];
    const runs=[]; cols.forEach(c=>{ const last=runs[runs.length-1]; if(last&&last.g===c.g) last.n++; else runs.push({g:c.g,n:1}); });
    const GL={...GROUP_LABEL,feat:"Features"};
    const head=`<thead><tr class="g"><th class="rp-rn"></th>${runs.map(r=>`<th colspan="${r.n}">${GL[r.g]||r.g}</th>`).join("")}</tr>
      <tr class="c"><th class="rp-rn">Role</th>${cols.map(c=>`<th><span>${esc(String(c.label).replace(/^Fixed · /,""))}</span></th>`).join("")}</tr></thead>`;
    const body=DATA.roles.map(r=>{ const d=DRAFT[r.name];
      const cells=cols.map(c=>{ const on=c.kind==="view"?d.views[c.key]:d.caps[c.key];
        return `<td><span class="rp-dot ${on?"y":"n"}"></span></td>`; }).join("");
      return `<tr class="${SEL===r.name?"on":""}" data-role="${esc(r.name)}"><th class="rp-rn">${esc(r.label)}<small>${esc(r.team)} · ${r.users||0} user${r.users===1?"":"s"}</small></th>${cells}</tr>`;
    }).join("");
    return `<div class="rp-heat-wrap"><div class="rp-heat-hd"><b>Everything at a glance</b>
      <small>Read-only — click a row to edit it above. Reflects unsaved edits.</small></div>
      <div class="rp-scroll"><table class="rp-heat">${head}<tbody>${body}</tbody></table></div></div>`;
  }

  /* ---------- render ---------- */
  function paint(){
    const host=$("#rolesMatrix"); if(!host) return;
    const dirty=allDiffs();
    host.innerHTML=`<div class="rp-bar">
        <input class="rp-search" id="rpQ" type="search" placeholder="Find a role…" value="${esc(Q)}" autocomplete="off" spellcheck="false">
        ${isSuper()?`<button type="button" class="rp-btn ghost" id="rpAdd">+ Add role</button>
        <button type="button" class="rp-btn ghost" id="rpReset">Reset to defaults</button>
        <span class="rp-dirty" id="rpDirty" ${dirty.length?"":"hidden"}>${dirty.length} role${dirty.length===1?"":"s"} edited</span>
        <button type="button" class="rp-btn go" id="rpSave" ${dirty.length?"":"disabled"}>Review &amp; save</button>`
        :`<span class="sub" style="font-size:12px">Read-only — Super Admin edits roles.</span>`}
      </div>
      <div class="rp"><div class="rp-list" id="rpList">${roleList()}</div><div id="rpEd">${editor()}</div></div>${heat()}`;
    wire(host);
  }

  function wire(host){
    const q=host.querySelector("#rpQ");
    if(q) q.addEventListener("input",()=>{ Q=q.value; const l=host.querySelector("#rpList"); if(l){ l.innerHTML=roleList(); wireList(host); } });
    wireList(host);
    host.querySelectorAll("table.rp-heat tbody tr").forEach(tr=>tr.addEventListener("click",()=>{ SEL=tr.dataset.role; paint();
      const e=document.querySelector("#rpEd"); if(e) e.scrollIntoView({behavior:"smooth",block:"nearest"}); }));
    const ed=host.querySelector("#rpEd");
    if(ed){
      ed.addEventListener("change",e=>{ const i=e.target.closest("input[type=checkbox]"); if(!i||!SEL) return;
        const d=DRAFT[SEL]; (i.dataset.k==="view"?d.views:d.caps)[i.dataset.key]=i.checked; paint(); });
      ed.addEventListener("click",e=>{ const b=e.target.closest("[data-all]"); if(!b||!SEL) return;
        const g=b.dataset.all, vs=DATA.views.filter(v=>(v.group||"shared")===g), d=DRAFT[SEL];
        const free=vs.filter(v=>!pinnedOff(v.key,SEL)); const turnOn=free.some(v=>!d.views[v.key]); free.forEach(v=>{ d.views[v.key]=turnOn; }); paint(); });
    }
    const s=host.querySelector("#rpSave"); if(s) s.addEventListener("click",confirmSave);
    const a=host.querySelector("#rpAdd"); if(a) a.addEventListener("click",addRole);
    const rs=host.querySelector("#rpReset"); if(rs) rs.addEventListener("click",resetAll);
  }
  function wireList(host){
    host.querySelectorAll(".rp-role").forEach(b=>b.addEventListener("click",()=>{ SEL=b.dataset.role; paint(); }));
  }

  /* ---------- save ---------- */
  function confirmSave(){
    const diffs=allDiffs(); if(!diffs.length) return;
    const people=diffs.reduce((a,d)=>a+d.users,0);
    const losing=diffs.filter(d=>(d.rv.length||d.rc.length)&&d.users>0);
    const body=diffs.map(d=>`<div class="rp-chg"><b>${esc(d.label)}</b><span class="who">${d.users} user${d.users===1?"":"s"}</span><ul>
      ${d.av.map(x=>`<li class="add">${esc(x)}</li>`).join("")}${d.ac.map(x=>`<li class="add">${esc(x)}</li>`).join("")}
      ${d.rv.map(x=>`<li class="rem">${esc(x)}</li>`).join("")}${d.rc.map(x=>`<li class="rem">${esc(x)}</li>`).join("")}</ul></div>`).join("");
    const warn=losing.length?`<div class="rp-warn"><b>${losing.reduce((a,d)=>a+d.users,0)} user${losing.reduce((a,d)=>a+d.users,0)===1?"":"s"} lose access.</b>
      It applies on their next request — anyone mid-session is cut off from the pages below without warning.</div>`:"";
    const mask=document.createElement("div"); mask.className="rp-mask";
    mask.innerHTML=`<div class="rp-dlg" role="dialog" aria-modal="true" aria-label="Review permission changes">
      <header><h3>Review ${diffs.length} change${diffs.length===1?"":"s"}</h3>
        <p>Affecting ${people} user${people===1?"":"s"} in total.</p></header>
      <div class="body">${warn}${body}</div>
      <footer><button type="button" class="rp-btn ghost" data-x="1">Cancel</button>
        <button type="button" class="rp-btn go" data-go="1">Save permissions</button></footer></div>`;
    document.body.appendChild(mask);
    const close=()=>mask.remove();
    mask.addEventListener("click",e=>{ if(e.target===mask||e.target.closest("[data-x]")) close(); });
    document.addEventListener("keydown",function esc2(e){ if(e.key==="Escape"){ close(); document.removeEventListener("keydown",esc2); } });
    mask.querySelector("[data-go]").addEventListener("click",async e=>{
      const btn=e.currentTarget; if(BUSY) return; BUSY=true; btn.disabled=true; btn.textContent="Saving…";
      try{
        const overrides={};
        DATA.roles.forEach(r=>{ if(r.locked) return; const d=DRAFT[r.name];
          overrides[r.name]={ views:DATA.views.filter(v=>d.views[v.key]).map(v=>v.key),
                              caps:Object.fromEntries(DATA.caps.map(c=>[c.key,!!d.caps[c.key]])) }; });
        DATA=await api("/api/roles/matrix",{method:"PUT",body:JSON.stringify({overrides})});
        initDraft(); close(); paint(); toast(`Saved — ${diffs.length} role${diffs.length===1?"":"s"} updated.`);
      }catch(err){ btn.disabled=false; btn.textContent="Save permissions"; toast("Save failed — "+err.message,true); }
      finally{ BUSY=false; }
    });
  }

  async function addRole(){
    const name=window.prompt("New role key (letters, digits, underscore):"); if(!name) return;
    const label=window.prompt("Display name:",name)||name;
    try{ DATA=await api("/api/roles",{method:"POST",body:JSON.stringify({name,label,clone_from:SEL||"call_center"})});
      initDraft(); SEL=String(name).toLowerCase().replace(/[^a-z0-9]+/g,"_"); paint(); toast(`Role “${label}” created — set its pages now.`); }
    catch(e){ toast(e.message,true); }
  }
  async function resetAll(){
    if(!window.confirm("Drop every saved override and return all roles to the built-in defaults?")) return;
    try{ DATA=await api("/api/roles/matrix",{method:"PUT",body:JSON.stringify({overrides:{}})}); initDraft(); paint(); toast("Back to the built-in defaults."); }
    catch(e){ toast(e.message,true); }
  }
  function toast(msg,bad){
    const t=document.createElement("div");
    t.style.cssText=`position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:5000;padding:11px 18px;border-radius:11px;
      font-size:13px;font-weight:600;box-shadow:0 12px 34px rgba(15,23,42,.28);
      background:${bad?"var(--red,#dc2626)":"linear-gradient(135deg,#0e9f5a,#019c20)"};color:#fff`;
    t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),3600);
  }

  async function render(){
    const host=$("#rolesMatrix"); if(!host) return;
    ensureCss();
    host.innerHTML=`<div class="sub">Loading roles…</div>`;
    try{ DATA=await api("/api/roles/matrix"); }
    catch(e){ host.innerHTML=`<div class="okbox">${esc(e.message)}</div>`; return; }
    DATA.roles.sort((a,b)=>(a.rank-b.rank)||a.label.localeCompare(b.label));
    initDraft(); if(!SEL||!roleOf(SEL)) SEL=DATA.roles[0]&&DATA.roles[0].name;
    paint();
  }
  window.renderRolesMatrix=render;
})();
