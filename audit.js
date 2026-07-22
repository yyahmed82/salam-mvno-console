/* Audit trail — client activity tracker + the Audit Log page (super-admin).
 * window.audit(action,target,detail) self-reports navigation/filter/trace activity. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API=(location.protocol==="file:")?"http://localhost:4600":"";
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});

  // ---- tracker (fire-and-forget) ----
  let _last="";
  window.audit=function(action,target,detail){
    try{
      const s=(window.opsSession&&window.opsSession())||{}; if(!s.email) return;   // only track signed-in users
      const key=action+"|"+(target||""); if(action==="VIEW_PAGE" && key===_last) return; if(action==="VIEW_PAGE") _last=key;
      window.fetch(API+"/api/audit/track",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,target:target||"",detail:detail||{}})}).catch(()=>{});
    }catch(e){}
  };

  // ---- audit page ----
  const isSuper=()=>{ const s=(window.opsSession&&window.opsSession())||{}; return s.me && s.me.realRole==="super_admin"; };
  const state={ user:"", action:"all", from:"", to:"", nav:true, openDays:{} };
  const NAV_ACTIONS=new Set(["VIEW_PAGE","APPLY_FILTER"]);
  function device(ua){ if(!ua) return "—";
    const br=/Edg/.test(ua)?"Edge":/OPR|Opera/.test(ua)?"Opera":/Chrome/.test(ua)?"Chrome":/Firefox/.test(ua)?"Firefox":/Safari/.test(ua)?"Safari":"Browser";
    const os=/Mac OS X|Macintosh/.test(ua)?"macOS":/Windows/.test(ua)?"Windows":/Android/.test(ua)?"Android":/iPhone|iPad|iOS/.test(ua)?"iOS":/Linux/.test(ua)?"Linux":"";
    return os?`${br} · ${os}`:br; }
  function actColor(a){ if(/FAIL|SUSPECT|REPLACED/.test(a)) return "#dc2626"; if(/UNMASK|pii/.test(a)) return "#d97706"; if(a==="LOGIN"||a==="auth.login") return "#16a34a"; if(NAV_ACTIONS.has(a)) return "#64748b"; return "#2563eb"; }
  const fmtTime=iso=>{ try{ return new Date(iso).toLocaleTimeString("en-GB",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit",second:"2-digit"}); }catch(e){ return ""; } };
  const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const todayKsa=()=> new Date(Date.now()).toLocaleDateString("en-CA",{timeZone:"Asia/Riyadh"});

  window.openAudit=function(){
    if(!isSuper()){ return; }
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const g=document.getElementById("settingsBtn"); if(g) g.classList.add("on");
    const t=document.getElementById("tourBtn"); if(t) t.classList.remove("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    const v=document.getElementById("view-audit"); if(v) v.classList.add("active");
    render();
  };

  async function render(){
    const host=$("#view-audit"); if(!host) return;
    if(!isSuper()){ host.innerHTML=`<div class="panel"><div class="albanner">The audit log is available to Super Admins only.</div></div>`; return; }
    let actions=[]; try{ actions=(await api("/api/audit/actions")).actions||[]; }catch(e){}
    host.innerHTML=`<div class="panel">
      <h2>Audit log</h2>
      <div class="sub">Security-relevant events — sign-ins, failed sign-ins, page/filter navigation, and customer-data (trace) access. Drill down: year ▸ month ▸ day ▸ events.</div>
      <div class="aud-filters">
        <div><label>USER</label><input id="audUser" class="jsearch" placeholder="email contains…" value="${esc(state.user)}"></div>
        <div><label>ACTION</label><select id="audAction" class="jsearch">
          <option value="all">All</option>${actions.map(a=>`<option value="${esc(a.action)}" ${state.action===a.action?"selected":""}>${esc(a.action)} (${a.c})</option>`).join("")}</select></div>
        <div><label>FROM</label><input id="audFrom" type="date" class="jsearch" value="${esc(state.from)}"></div>
        <div><label>TO</label><input id="audTo" type="date" class="jsearch" value="${esc(state.to)}"></div>
        <label class="aud-nav"><input type="checkbox" id="audNav" ${state.nav?"checked":""}> Show navigation events</label>
        <button class="pill" id="audExport" style="border-left-color:#2563eb">⤓ Export</button>
      </div>
      <div id="audTotal" class="rl" style="margin:10px 0"></div>
      <div id="audTree"></div>
    </div>`;
    $("#audUser").addEventListener("input",()=>{ state.user=$("#audUser").value.trim(); clearTimeout(window._aqt); window._aqt=setTimeout(loadTree,350); });
    $("#audAction").addEventListener("change",()=>{ state.action=$("#audAction").value; loadTree(); });
    $("#audFrom").addEventListener("change",()=>{ state.from=$("#audFrom").value; loadTree(); });
    $("#audTo").addEventListener("change",()=>{ state.to=$("#audTo").value; loadTree(); });
    $("#audNav").addEventListener("change",()=>{ state.nav=$("#audNav").checked; loadTree(); });
    $("#audExport").addEventListener("click",exportAll);
    loadTree();
  }

  function qs(extra){ const p=new URLSearchParams(); if(state.user)p.set("user",state.user); if(state.action&&state.action!=="all")p.set("action",state.action); if(state.from)p.set("from",state.from); if(state.to)p.set("to",state.to); if(!state.nav)p.set("nav","0"); Object.entries(extra||{}).forEach(([k,v])=>p.set(k,v)); return p.toString(); }

  async function loadTree(){
    const tree=$("#audTree"); if(!tree) return; tree.innerHTML=`<div class="sub">Loading…</div>`;
    let d; try{ d=await api("/api/audit/tree?"+qs()); }catch(e){ tree.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    $("#audTotal").innerHTML=`<b>${(d.total||0).toLocaleString()}</b> events`;
    const days=d.days||[];
    if(!days.length){ tree.innerHTML=`<div class="okbox">No events match.</div>`; return; }
    const years={};
    days.forEach(({d,c})=>{ const [y,m]=d.split("-"); (years[y]??={count:0,months:{}}); years[y].count+=c; (years[y].months[m]??={count:0,days:[]}); years[y].months[m].count+=c; years[y].months[m].days.push({d,c}); });
    const yKeys=Object.keys(years).sort().reverse();
    const today=todayKsa();
    tree.innerHTML=yKeys.map((y,yi)=>{
      const yo=years[y]; const yOpen=yi===0;
      const months=Object.keys(yo.months).sort().reverse().map((m,mi)=>{
        const mo=yo.months[m]; const mOpen=yi===0&&mi===0;
        const daysH=mo.days.map(({d,c})=>{
          const lbl=d===today?"Today":Number(d.split("-")[2])+"";
          return `<div class="aud-day"><div class="aud-drow" data-day="${d}"><span class="aud-caret">▸</span>${esc(lbl)}<span class="aud-cnt">${c} events</span></div><div class="aud-events" id="audev_${d}" hidden></div></div>`;
        }).join("");
        return `<div class="aud-month"><div class="aud-mrow ${mOpen?'open':''}"><span class="aud-caret">▾</span>${MONTHS[Number(m)-1]}<span class="aud-cnt">${mo.count} events</span></div><div class="aud-mbody" ${mOpen?'':'hidden'}>${daysH}</div></div>`;
      }).join("");
      return `<div class="aud-year"><div class="aud-yrow ${yOpen?'open':''}"><span class="aud-caret">▾</span>${esc(y)}<span class="aud-cnt">${yo.count} events</span></div><div class="aud-ybody" ${yOpen?'':'hidden'}>${months}</div></div>`;
    }).join("");
    // collapse/expand
    tree.querySelectorAll(".aud-yrow").forEach(r=>r.addEventListener("click",()=>toggle(r,r.parentElement.querySelector(".aud-ybody"))));
    tree.querySelectorAll(".aud-mrow").forEach(r=>r.addEventListener("click",()=>toggle(r,r.parentElement.querySelector(".aud-mbody"))));
    tree.querySelectorAll(".aud-drow").forEach(r=>r.addEventListener("click",()=>openDay(r.dataset.day, r)));
    // auto-open today's events
    const todayRow=tree.querySelector(`.aud-drow[data-day="${today}"]`); if(todayRow) openDay(today, todayRow);
  }
  function toggle(row, body){ if(!body) return; const hid=body.hasAttribute("hidden"); if(hid){ body.removeAttribute("hidden"); row.classList.add("open"); } else { body.setAttribute("hidden",""); row.classList.remove("open"); } row.querySelector(".aud-caret").textContent = hid?"▾":"▸"; }
  async function openDay(day, row){
    const box=$("#audev_"+day); if(!box) return;
    if(!box.hasAttribute("hidden")){ box.setAttribute("hidden",""); row.classList.remove("open"); row.querySelector(".aud-caret").textContent="▸"; return; }
    box.removeAttribute("hidden"); row.classList.add("open"); row.querySelector(".aud-caret").textContent="▾";
    box.innerHTML=`<div class="sub" style="padding:6px">Loading…</div>`;
    let d; try{ d=await api("/api/audit/events?"+qs({day, limit:500})); }catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const rows=d.rows||[];
    box.innerHTML=`<table class="alerts aud-tbl"><tr><th>TIME</th><th>USER</th><th>ACTION</th><th>TARGET</th><th>IP</th><th>DEVICE</th></tr>`+
      rows.map(r=>`<tr>
        <td class="mono" style="color:var(--muted)">${fmtTime(r.at)}</td>
        <td>${esc(r.actor||"—")}</td>
        <td><span class="catpill" style="background:${actColor(r.action)}1f;color:${actColor(r.action)}">${esc(r.action)}</span></td>
        <td class="mono" style="font-size:11px">${esc(r.target||"—")}</td>
        <td class="mono" style="font-size:11px;color:var(--muted)">${esc(r.ip||"—")}</td>
        <td style="font-size:11px;color:var(--muted)">${esc(device(r.ua))}</td>
      </tr>`).join("")+`</table>`;
  }
  async function exportAll(){
    try{ const d=await api("/api/audit/events?"+qs({limit:2000})); const rows=d.rows||[];
      const cols=["at","actor","role","action","target","ip","ua"];
      const csv=[cols.join(",")].concat(rows.map(r=>cols.map(c=>{let v=r[c]==null?"":typeof r[c]==="object"?JSON.stringify(r[c]):String(r[c]);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}).join(","))).join("\n");
      const b=new Blob([csv],{type:"text/csv"}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download="audit_log.csv"; a.click(); setTimeout(()=>URL.revokeObjectURL(u),1000);
    }catch(e){ alert("Export failed: "+e.message); }
  }
})();
