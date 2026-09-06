/* Editable role × permission matrix (Settings → User management).
 * Rows = roles, columns = pages (views) + features (caps). Super Admin can edit and save;
 * everyone else sees it read-only. The super_admin row is always locked full. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  const SES=()=>(window.opsSession?window.opsSession():{});
  const isSuper=()=>{ const s=SES(); return !!(s.me&&s.me.realRole==="super_admin"); };
  let DATA=null;

  async function render(){
    const host=$("#rolesMatrix"); if(!host) return;
    host.innerHTML=`<div class="sub">Loading…</div>`;
    try{ DATA=await api("/api/roles/matrix"); }
    catch(e){ host.innerHTML=`<div class="okbox">${esc(e.message)}</div>`; return; }
    const edit=isSuper();
    // pages in three families so the matrix reads like the nav: shared (Home · Customer 360 · Settings) · Mobile · Fixed
    const isFixed=v=>/^fixed/.test(v.key), isShared=v=>["explore","settings","users"].includes(v.key);
    const mob=DATA.views.filter(v=>!isFixed(v)&&!isShared(v)), fix=DATA.views.filter(isFixed), shr=DATA.views.filter(isShared);
    const views=[...mob,...fix,...shr];
    const cols=[...views.map(v=>({...v,grp:"page"})),...DATA.caps.map(c=>({...c,grp:"feat"}))];
    const head=`<tr><th class="rm-role">Role</th>`+
      (mob.length?`<th class="rm-sep" colspan="${mob.length}">📱 MOBILE PAGES</th>`:"")+
      (fix.length?`<th class="rm-sep rm-sep-fixed" colspan="${fix.length}">🏠 FIXED PAGES</th>`:"")+
      (shr.length?`<th class="rm-sep" colspan="${shr.length}">SHARED</th>`:"")+
      `<th class="rm-sep" colspan="${DATA.caps.length}">FEATURES</th></tr>`+
      `<tr><th class="rm-role"></th>`+cols.map(c=>`<th class="rm-col ${/^fixed/.test(c.key)&&c.grp==="page"?"rm-col-fixed":""}"><span>${esc(String(c.label).replace(/^Fixed · /,""))}</span></th>`).join("")+`</tr>`;
    const rows=DATA.roles.map(r=>{
      const cells=cols.map(c=>{
        const on = c.grp==="page" ? r.views[c.key] : r.caps[c.key];
        const dis = r.locked || !edit;
        return `<td class="rm-cell"><input type="checkbox" data-role="${r.name}" data-grp="${c.grp}" data-key="${c.key}" ${on?"checked":""} ${dis?"disabled":""}></td>`;
      }).join("");
      const del = (r.custom&&edit)?` <button class="rm-del" data-del="${r.name}" title="Delete this custom role (only when no user holds it)">✕</button>`:"";
      return `<tr class="${r.locked?'rm-locked':''}"><td class="rm-role"><b>${esc(r.label)}</b>${r.custom?'<span class="rm-lock" style="background:var(--tint-amber);color:var(--tint-amber-fg)">custom</span>':''}${del}<small>${esc(r.team)}</small>${r.locked?'<span class="rm-lock">🔒 full</span>':''}</td>${cells}</tr>`;
    }).join("");
    host.innerHTML=`<div class="rm-wrap"><table class="rm-tbl">${head}${rows}</table></div>`+
      (edit?`<div class="rm-actions"><button class="pill" id="rmSave" style="border-left-color:var(--green)">Save permissions</button>
        <button class="pill" id="rmAdd" style="border-left-color:var(--blue,#2b7bb9)">＋ Add role</button>
        <button class="pill" id="rmReset" style="border-left-color:var(--muted)">Reset to defaults</button>
        <span id="rmStatus" class="rl"></span></div>
      <div id="rmAddForm" style="display:none;margin-top:10px;padding:12px 14px;background:var(--panel2,#f4f8f6);border-radius:10px;max-width:640px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
          <label style="font-size:11px;font-weight:700">NAME (slug)<br><input id="rmNewName" placeholder="e.g. finance_ops" style="width:150px"></label>
          <label style="font-size:11px;font-weight:700">LABEL<br><input id="rmNewLabel" placeholder="Finance Ops" style="width:150px"></label>
          <label style="font-size:11px;font-weight:700">TEAM<br><input id="rmNewTeam" placeholder="Finance" style="width:110px"></label>
          <label style="font-size:11px;font-weight:700">START FROM<br><select id="rmNewClone" style="width:150px"></select></label>
          <button class="pill" id="rmAddGo" style="border-left-color:var(--green)">Create</button>
        </div>
        <div class="rl" style="margin-top:6px">The new role starts as a copy of the chosen role (never with user management), then tune its checkboxes above and Save.</div>
      </div>`
        :`<div class="rl" style="margin-top:8px">Read-only — only a Super Admin can change permissions.</div>`);
    if(edit){
      $("#rmSave").addEventListener("click",save);
      $("#rmReset").addEventListener("click",()=>{ if(confirm("Reset ALL roles to their built-in defaults? Custom roles keep existing but lose their overrides.")) save(true); });
      $("#rmAdd").addEventListener("click",()=>{ const f=$("#rmAddForm"); const show=f.style.display==="none";
        f.style.display=show?"":"none";
        if(show){ const sel=$("#rmNewClone");
          sel.innerHTML=DATA.roles.filter(r=>!r.locked).map(r=>`<option value="${r.name}" ${r.name==="call_center"?"selected":""}>${esc(r.label)}</option>`).join(""); } });
      const go=$("#rmAddGo"); if(go) go.addEventListener("click",async()=>{
        const st=$("#rmStatus"); if(st) st.textContent="Creating…";
        try{ DATA=await api("/api/roles",{method:"POST",body:JSON.stringify({
            name:$("#rmNewName").value, label:$("#rmNewLabel").value, team:$("#rmNewTeam").value, clone_from:$("#rmNewClone").value })});
          if(st) st.textContent="Role created ✓ — tune its row and Save"; render();
        }catch(e){ if(st) st.textContent="Error: "+e.message; } });
      document.querySelectorAll("#rolesMatrix .rm-del").forEach(b=>b.addEventListener("click",async()=>{
        if(!confirm(`Delete custom role '${b.dataset.del}'? Only possible when no user holds it.`)) return;
        const st=$("#rmStatus"); if(st) st.textContent="Deleting…";
        try{ DATA=await api("/api/roles/"+encodeURIComponent(b.dataset.del),{method:"DELETE"});
          if(st) st.textContent="Role deleted ✓"; render();
        }catch(e){ if(st) st.textContent="Error: "+e.message; } }));
    }
  }

  function collect(){
    const ov={};
    DATA.roles.forEach(r=>{ if(r.locked) return; ov[r.name]={views:[],caps:{}}; });
    document.querySelectorAll('#rolesMatrix input[type=checkbox]').forEach(cb=>{
      const role=cb.dataset.role; if(!ov[role]) return;   // skip locked super_admin
      if(cb.dataset.grp==="page"){ if(cb.checked) ov[role].views.push(cb.dataset.key); }
      else ov[role].caps[cb.dataset.key]=cb.checked;
    });
    return ov;
  }
  async function save(reset){
    const st=$("#rmStatus"); if(st) st.textContent="Saving…";
    const overrides = reset===true ? {} : collect();
    try{ DATA=await api("/api/roles/matrix",{method:"PUT",body:JSON.stringify({overrides})});
      if(st) st.textContent="Saved ✓ — applies on each user's next request";
      render();
    }catch(e){ if(st) st.textContent="Error: "+e.message; }
  }

  window.renderRolesMatrix=render;
})();
