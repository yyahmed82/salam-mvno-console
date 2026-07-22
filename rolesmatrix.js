/* Editable role × permission matrix (Settings → User management).
 * Rows = roles, columns = pages (views) + features (caps). Super Admin can edit and save;
 * everyone else sees it read-only. The super_admin row is always locked full. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API=(location.protocol==="file:")?"http://localhost:4600":"";
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
    const cols=[...DATA.views.map(v=>({...v,grp:"page"})),...DATA.caps.map(c=>({...c,grp:"feat"}))];
    const head=`<tr><th class="rm-role">Role</th>`+
      `<th class="rm-sep" colspan="${DATA.views.length}">PAGES</th>`+
      `<th class="rm-sep" colspan="${DATA.caps.length}">FEATURES</th></tr>`+
      `<tr><th class="rm-role"></th>`+cols.map(c=>`<th class="rm-col"><span>${esc(c.label)}</span></th>`).join("")+`</tr>`;
    const rows=DATA.roles.map(r=>{
      const cells=cols.map(c=>{
        const on = c.grp==="page" ? r.views[c.key] : r.caps[c.key];
        const dis = r.locked || !edit;
        return `<td class="rm-cell"><input type="checkbox" data-role="${r.name}" data-grp="${c.grp}" data-key="${c.key}" ${on?"checked":""} ${dis?"disabled":""}></td>`;
      }).join("");
      return `<tr class="${r.locked?'rm-locked':''}"><td class="rm-role"><b>${esc(r.label)}</b><small>${esc(r.team)}</small>${r.locked?'<span class="rm-lock">🔒 full</span>':''}</td>${cells}</tr>`;
    }).join("");
    host.innerHTML=`<div class="rm-wrap"><table class="rm-tbl">${head}${rows}</table></div>`+
      (edit?`<div class="rm-actions"><button class="pill" id="rmSave" style="border-left-color:var(--green)">Save permissions</button>
        <button class="pill" id="rmReset" style="border-left-color:var(--muted)">Reset to defaults</button>
        <span id="rmStatus" class="rl"></span></div>`
        :`<div class="rl" style="margin-top:8px">Read-only — only a Super Admin can change permissions.</div>`);
    if(edit){
      $("#rmSave").addEventListener("click",save);
      $("#rmReset").addEventListener("click",()=>{ if(confirm("Reset ALL roles to their built-in defaults?")) save(true); });
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
