/* Settings → Navigation & tabs — shared, super-admin-editable ordering + visibility
 * for the Analytics dashboards nav and the Troubleshoot error tiles.
 * Renders into #navCfg (segment data-seg="nav"). Reads/writes /api/ui-nav. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const API = (location.protocol==="file:") ? "http://localhost:4600" : (location.pathname.startsWith("/digital-console") ? "/digital-console" : "");
  const api=(p,opts)=>fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  const isSuper=()=>{ const s=(window.opsSession&&window.opsSession())||{}; return !!(s.me && s.me.realRole==="super_admin"); };
  const catOf=d=>(window.ANA_NAV&&window.ANA_NAV.cat)?window.ANA_NAV.cat(d):(d.builtin?'Other':'Yours');

  let S=null, META=null;

  function ensureCss(){
    if(document.getElementById("navcfg-css")) return;
    const st=document.createElement("style"); st.id="navcfg-css";
    st.textContent=`
      .nv-list{display:flex;flex-direction:column;gap:6px;margin-top:10px}
      .nv-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--line,#e5e7eb);border-radius:10px;background:var(--card,#fff)}
      .nv-row.sub{margin-left:26px;background:transparent;border-style:dashed}
      .nv-row.off{opacity:.5}
      .nv-grip{display:flex;flex-direction:column;gap:2px}
      .nv-mv{width:22px;height:17px;line-height:15px;text-align:center;border:1px solid var(--line,#e5e7eb);border-radius:5px;background:transparent;cursor:pointer;font-size:9px;color:var(--muted,#64748b);padding:0}
      .nv-mv:hover{color:#2563eb;border-color:#93c5fd}
      .nv-mv[disabled]{opacity:.3;cursor:default}
      .nv-name{flex:1;font-weight:600;font-size:14px}
      .nv-name small{font-weight:500;color:var(--muted,#64748b);margin-left:8px;font-size:11px}
      .nv-cat-hd{text-transform:uppercase;letter-spacing:.04em;font-size:12px}
      .nv-cnt{color:var(--muted,#64748b);font-size:12px;font-weight:600}
      .nv-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted,#64748b);cursor:pointer;user-select:none}
      .nv-actions{display:flex;align-items:center;gap:12px;margin:16px 2px 4px}
    `;
    document.head.appendChild(st);
  }

  function buildState(cfg){
    cfg=cfg||{};
    // errors
    const allErr=META.errCats.map(c=>c.category);
    const eo=(cfg.errors&&cfg.errors.order)||[];
    const errOrder=eo.filter(c=>allErr.includes(c)).concat(allErr.filter(c=>!eo.includes(c)));
    const errHidden=new Set((cfg.errors&&cfg.errors.hidden)||[]);
    // analytics — group dashboards by category
    const groups={}; META.dashboards.forEach(d=>{ const c=catOf(d); (groups[c] ||= []).push(d); });
    const allCats=Object.keys(groups);
    const defOrder=(window.ANA_NAV&&window.ANA_NAV.order)||['Platform','Onboarding','Payments','Activation','Servicing','Other','Yours'];
    const co=(cfg.analytics&&cfg.analytics.catOrder)||[];
    let catOrder=co.filter(c=>allCats.includes(c));
    defOrder.forEach(c=>{ if(allCats.includes(c)&&!catOrder.includes(c)) catOrder.push(c); });
    allCats.forEach(c=>{ if(!catOrder.includes(c)) catOrder.push(c); });
    const catHidden=new Set((cfg.analytics&&cfg.analytics.catHidden)||[]);
    const dashHidden=new Set((cfg.analytics&&cfg.analytics.dashHidden)||[]);
    const dOrdCfg=(cfg.analytics&&cfg.analytics.dashOrder)||{};
    const dashOrder={};
    catOrder.forEach(c=>{ const keys=groups[c].map(d=>d.key); const saved=(dOrdCfg[c]||[]).filter(k=>keys.includes(k)); dashOrder[c]=saved.concat(keys.filter(k=>!saved.includes(k))); });
    return { errOrder, errHidden, groups, catOrder, catHidden, dashHidden, dashOrder };
  }

  const nameOfDash=k=>{ const d=META.dashboards.find(x=>x.key===k); return d?d.name:k; };
  const labelOfErr=c=>{ const x=META.errCats.find(y=>y.category===c); return x?x.label:c; };
  const teamOfErr=c=>{ const x=META.errCats.find(y=>y.category===c); return x?x.team:''; };
  const mv=(arr,i,dir)=>{ const j=i+dir; if(j<0||j>=arr.length)return; const t=arr[i];arr[i]=arr[j];arr[j]=t; };
  const mvBtns=(du,dd)=>`<span class="nv-grip"><button class="nv-mv" data-mv="up" ${du?'disabled':''}>&#9650;</button><button class="nv-mv" data-mv="dn" ${dd?'disabled':''}>&#9660;</button></span>`;

  function render(){
    const host=$("#navCfg"); if(!host) return;
    ensureCss();
    if(!isSuper()){ host.innerHTML=`<div class="panel"><h2>Navigation &amp; tabs</h2><div class="albanner">Reordering and hiding tabs is available to Super Admins only. What you see is the shared layout set by an admin.</div></div>`; return; }
    host.innerHTML=`<div class="sub" style="padding:8px 2px">Loading…</div>`;
    Promise.all([
      api("/api/ui-nav").catch(()=>({})),
      api("/api/errors/categories").catch(()=>({categories:[]})),
      api("/api/analytics/dashboards").catch(()=>({dashboards:[]}))
    ]).then(([cfg,ec,dl])=>{
      META={ errCats:(ec.categories||[]), dashboards:(dl.dashboards||[]) };
      S=buildState(cfg||{});
      paint();
    }).catch(e=>{ host.innerHTML=`<div class="panel"><div class="albanner">${esc(e.message)}</div></div>`; });
  }

  function paint(){
    const host=$("#navCfg");
    const errRows=S.errOrder.map((cat,i)=>{
      const off=S.errHidden.has(cat);
      return `<div class="nv-row ${off?'off':''}" data-kind="err" data-id="${esc(cat)}" data-i="${i}">
        ${mvBtns(i===0,i===S.errOrder.length-1)}
        <span class="nv-name">${esc(labelOfErr(cat))}<small>${esc(teamOfErr(cat))}</small></span>
        <label class="nv-toggle"><input type="checkbox" data-tog="err" ${off?'':'checked'}> shown</label>
      </div>`;
    }).join("");
    const anaRows=S.catOrder.map((cat,i)=>{
      const off=S.catHidden.has(cat);
      const dks=S.dashOrder[cat]||[];
      const head=`<div class="nv-row ${off?'off':''}" data-kind="cat" data-id="${esc(cat)}" data-i="${i}">
        ${mvBtns(i===0,i===S.catOrder.length-1)}
        <span class="nv-name nv-cat-hd">${esc(cat)}</span><span class="nv-cnt">${dks.length}</span>
        <label class="nv-toggle"><input type="checkbox" data-tog="cat" ${off?'':'checked'}> shown</label>
      </div>`;
      const subs=dks.map((k,j)=>{
        const doff=S.dashHidden.has(k);
        return `<div class="nv-row sub ${doff?'off':''}" data-kind="dash" data-id="${esc(k)}" data-cat="${esc(cat)}" data-i="${j}">
          ${mvBtns(j===0,j===dks.length-1)}
          <span class="nv-name">${esc(nameOfDash(k))}</span>
          <label class="nv-toggle"><input type="checkbox" data-tog="dash" ${doff?'':'checked'}> shown</label>
        </div>`;
      }).join("");
      return head+subs;
    }).join("");

    host.innerHTML=`
      <div class="panel">
        <h2>Navigation &amp; tabs <span class="rl" style="font-weight:400;color:var(--muted)">— shared for everyone</span></h2>
        <div class="sub">Reorder with &#9650;&#9660; and untick <b>shown</b> to hide a tab. Changes apply to every console user. In Analytics, categories are the first level and the dashboards beneath each are the second.</div>
      </div>
      <div class="panel">
        <h3 style="margin:0 0 2px">Troubleshoot &mdash; error tabs</h3>
        <div class="sub">The category tiles on the Troubleshoot board.</div>
        <div class="nv-list" id="nvErr">${errRows}</div>
      </div>
      <div class="panel">
        <h3 style="margin:0 0 2px">Analytics &mdash; categories &amp; dashboards</h3>
        <div class="sub">First level = category buttons; second level = dashboards inside each.</div>
        <div class="nv-list" id="nvAna">${anaRows}</div>
      </div>
      <div class="nv-actions">
        <button class="pill" id="nvSave" style="border-left-color:var(--green)">Save layout</button>
        <button class="pill" id="nvReset" style="border-left-color:var(--muted,#94a3b8)">Reset to default</button>
        <span id="nvStatus" class="rl"></span>
      </div>`;
    wire();
  }

  function wire(){
    const host=$("#navCfg");
    host.querySelectorAll(".nv-mv").forEach(btn=>btn.addEventListener("click",()=>{
      const row=btn.closest(".nv-row"); const dir=btn.dataset.mv==="up"?-1:1;
      const kind=row.dataset.kind, i=Number(row.dataset.i);
      if(kind==="err") mv(S.errOrder,i,dir);
      else if(kind==="cat") mv(S.catOrder,i,dir);
      else if(kind==="dash") mv(S.dashOrder[row.dataset.cat],i,dir);
      paint();
    }));
    host.querySelectorAll("[data-tog]").forEach(cb=>cb.addEventListener("change",()=>{
      const row=cb.closest(".nv-row"); const id=row.dataset.id, on=cb.checked, kind=cb.dataset.tog;
      const set = kind==="err"?S.errHidden : kind==="cat"?S.catHidden : S.dashHidden;
      if(on) set.delete(id); else set.add(id);
      row.classList.toggle("off",!on);
    }));
    $("#nvSave").addEventListener("click",()=>savePayload(toPayload(),"Saved ✓ · shared with everyone"));
    $("#nvReset").addEventListener("click",()=>{
      if(!confirm("Reset all tab ordering and visibility to the built-in default?"))return;
      savePayload({analytics:{catOrder:[],catHidden:[],dashHidden:[],dashOrder:{}},errors:{order:[],hidden:[]}},"Reset ✓").then(()=>render());
    });
  }

  function toPayload(){
    return {
      analytics:{ catOrder:S.catOrder.slice(), catHidden:[...S.catHidden], dashHidden:[...S.dashHidden], dashOrder:S.dashOrder },
      errors:{ order:S.errOrder.slice(), hidden:[...S.errHidden] }
    };
  }
  function savePayload(payload,okMsg){
    const st=$("#nvStatus"); if(st)st.textContent="Saving…";
    return api("/api/ui-nav",{method:"PUT",body:JSON.stringify(payload)}).then(cfg=>{
      window.UI_NAV=cfg||{}; document.dispatchEvent(new CustomEvent("uinavchange"));
      if(st)st.textContent=okMsg||"Saved ✓";
    }).catch(e=>{ if(st)st.textContent="Error: "+e.message; });
  }

  window.renderNavCfg=render;
  document.querySelectorAll('[data-seg="nav"]').forEach(b=>b.addEventListener("click",()=>setTimeout(render,0)));
})();
