/* DMS API reference viewer — every endpoint of the 14 DMS services, from the decompiled production
 * JARs (30 Sep 2026, git tag v20260930-appdigp01 in the private dms-source repo). Data: dmsApiDocs.json
 * built by ~/dms-releases tooling (apidocs_build.py + apidocs_enrich.py); refresh after each release.
 * Under ? → EXPLORE. Deep links: #dmsdocs?s=<section id> · #dmsdocs?j=<journey key> (endpoints of a
 * DMS ▸ Explore journey) · #dmsdocs?q=<text>. Read-only; evidence only — "not determined from code"
 * stays visible as such. Dark mode + phone friendly. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  let D=null, SPEC=null, sel=null, q="", caller="all", svc="all", jkey="", openEp=new Set(), lastHash="";
  const VERBC={GET:"#0d9488",POST:"#2563eb",PUT:"#b45309",DELETE:"#dc2626",PATCH:"#7c3aed"};
  const CALLC={app:"#0e9f6e",cms:"#b45309",internal:"#64748b",portal:"#2563eb",partner:"#7c3aed",callback:"#dc2626",unknown:"#94a3b8"};

  async function load(){
    if(D) return D;
    try{ const r=await fetch("dmsApiDocs.json?v=20261001a"); if(r.ok) D=await r.json(); }catch(e){}
    try{ if(!SPEC){ const base=(window.API_BASE||window.CONSOLE_BASE||""); const r=await fetch(base+"/api/dms/journeys/spec",{headers:{"X-Console-User":localStorage.getItem("cons_email")||"","X-Console-Role":localStorage.getItem("cons_role")||"report_manager"}}); if(r.ok) SPEC=await r.json(); } }catch(e){}
    return D;
  }
  /* endpoints of a DMS ▸ Explore journey: the api-docs journey key OR any step path of the spec journey */
  function journeyPaths(key){
    const j=SPEC&&(SPEC.journeys||[]).find(x=>x.key===key); if(!j) return null;
    const pats=[]; (j.steps||[]).forEach(s=>{ const m=/((?:\/[a-z0-9_\-{}.]+)+\*?)/i.exec(String(s.ep||"")); if(m) pats.push(m[1]); });
    return { label:j.label, pats };
  }
  function epMatchesJourney(e){
    if(!jkey) return true;
    if(e.journey===jkey) return true;
    const jp=journeyPaths(jkey); if(!jp) return false;
    return jp.pats.some(p=>p.endsWith("*")?e.path.startsWith(p.slice(0,-1)):(e.path===p||e.path.endsWith(p)));
  }
  function epOk(e,s){
    if(caller!=="all"&&(e.caller||s.caller)!==caller) return false;
    if(svc!=="all"&&s.service!==svc) return false;
    if(!epMatchesJourney(Object.assign({journey:s.journey},e))) return false;
    if(q){ const ql=q.toLowerCase(); const hay=(e.verb+" "+e.path+" "+(e.summary||"")+" "+(e.method||"")+" "+((e.request||{}).dto||"")+" "+((e.request||{}).fields||[]).map(f=>f.name).join(" ")+" "+(e.downstream||[]).join(" ")+" "+(e.writes||[]).join(" ")).toLowerCase(); if(!hay.includes(ql)) return false; }
    return true;
  }
  function visible(){ return (D.sections||[]).map(s=>({s,eps:(s.endpoints||[]).filter(e=>epOk(e,s))})).filter(x=>x.eps.length); }

  function tree(){
    const V=visible(); const byS={};
    V.forEach(x=>{ (byS[x.s.service]=byS[x.s.service]||[]).push(x); });
    const svcs=(D.services||[]).filter(s=>byS[s.id]);
    return svcs.map(sv=>`<div style="margin-top:8px;padding:2px 8px;font-size:11.5px;font-weight:800;display:flex;gap:6px;align-items:baseline"><span>${esc(sv.name.replace(/ \(.*$/,""))}</span><span class="mono" style="font-size:9.5px;color:var(--muted);font-weight:600">${esc(sv.context||"")} · ${byS[sv.id].reduce((a,x)=>a+x.eps.length,0)}</span></div>`+
      byS[sv.id].map(({s,eps})=>`<div class="dad-it ${sel===s.id?"on":""}" data-id="${esc(s.id)}" style="padding:4px 8px 4px 18px;border-radius:7px;cursor:pointer;font-size:11.5px;font-weight:600;display:flex;gap:6px;align-items:center;${sel===s.id?"background:var(--green-bg,rgba(16,185,129,.12));":""}">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.ctrl)}">${esc(s.title||s.ctrl)}</span>
        <span style="font-size:9px;font-weight:800;color:${CALLC[s.caller]||"var(--muted)"}">${esc(s.caller||"")}</span><span class="mono" style="font-size:9.5px;color:var(--muted)">${eps.length}</span></div>`).join("")).join("")||`<div class="rl" style="padding:8px;color:var(--muted)">no endpoint matches</div>`;
  }
  function fieldsTable(fs){
    if(!fs||!fs.length) return `<div class="rl" style="color:var(--muted);font-size:10.5px">no body</div>`;
    return `<table><thead><tr><th>field</th><th>type</th><th>required</th><th>note</th></tr></thead><tbody>${fs.map(f=>`<tr><td class="mono">${esc(f.name)}</td><td class="mono" style="color:var(--muted)">${esc(f.type)}</td><td>${f.required===true?`<b style="color:var(--red,#dc2626)">yes</b>`:f.required===false?"no":`<span class="rl" style="color:var(--muted)" title="no @Valid / javax.validation on this DTO — not determined from code">n/d</span>`}</td><td class="rl" style="color:var(--muted)">${esc(f.note||"")}</td></tr>`).join("")}</tbody></table>`;
  }
  function epCard(e,s){
    const id=s.id+"|"+e.verb+" "+e.path; const o=openEp.has(id); const R=e.response||{}; const jl=e.journey||s.journey;
    const jlabel=jl&&((D.journeys||{})[jl]||(SPEC&&(SPEC.journeys||[]).find(x=>x.key===jl)||{}).label||jl);
    return `<div class="dad-ep" style="border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:8px;background:var(--card2,rgba(148,163,184,.05))">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;cursor:pointer" data-ep="${esc(id)}">
        <span class="mono" style="font-size:10px;font-weight:900;color:#fff;background:${VERBC[e.verb]||"#64748b"};border-radius:5px;padding:1px 6px">${esc(e.verb)}</span>
        <span class="mono" style="font-size:12px;font-weight:800;word-break:break-all">${esc(e.path)}</span>
        <span style="font-size:9.5px;font-weight:800;color:${CALLC[e.caller||s.caller]||"var(--muted)"}" title="who calls it, from the code">${esc(e.caller||s.caller||"")}</span>
        ${jl?`<a href="#dmsdocs?j=${esc(jl)}" class="rl" style="font-size:9.5px;color:#0d9488;text-decoration:none" title="all endpoints of this journey">${esc(jlabel)}</a>`:""}
        ${e.enriched===false?`<span class="rl" style="font-size:9.5px;color:var(--amber,#b45309)">mechanical extraction only</span>`:""}
        <span class="mono" style="margin-left:auto;font-size:10px;color:var(--muted)">${esc(e.method||"")}${(e.request||{}).dto?` · ${esc(e.request.dto)}`:""}</span>
      </div>
      ${e.summary?`<div class="rl" style="font-size:11px;margin-top:4px">${esc(e.summary)}</div>`:""}
      ${o?`<div class="dad-det" style="margin-top:8px;display:grid;grid-template-columns:1fr;gap:10px">
        <div><div class="dad-h">REQUEST${e.headers&&e.headers.length?` · headers read: <span class="mono" style="font-weight:600">${esc(e.headers.join(", "))}</span>`:""}</div>${fieldsTable((e.request||{}).fields)}</div>
        <div><div class="dad-h">RESPONSE · ${esc(R.type||"")}${R.data_types&&R.data_types.length?` · data: <span class="mono" style="font-weight:600">${esc(R.data_types.join(", "))}</span>`:""}</div>
          ${R.fields&&R.fields.length?fieldsTable(R.fields):""}
          ${R.codes&&R.codes.length?`<table><thead><tr><th>code</th><th>meaning (as set in the code)</th></tr></thead><tbody>${R.codes.map(c=>`<tr><td class="mono" style="font-weight:800;color:${c.code==="00"||c.code==="600"?"var(--green,#0e9f6e)":"var(--red,#dc2626)"}">${esc(c.code)}</td><td>${esc(c.meaning)}</td></tr>`).join("")}</tbody></table>`:`<div class="rl" style="color:var(--muted);font-size:10.5px">no explicit codes found in this endpoint's implementation</div>`}</div>
        ${e.downstream&&e.downstream.length?`<div><div class="dad-h">DOWNSTREAM · in call order</div><ol style="margin:0;padding-left:18px;font-size:11px;display:flex;flex-direction:column;gap:2px">${e.downstream.map(x=>`<li class="mono">${esc(x)}</li>`).join("")}</ol></div>`:""}
        ${e.writes&&e.writes.length?`<div><div class="dad-h" style="color:var(--green,#0e9f6e)">WRITES · tables &amp; ledger rows</div><ul style="margin:0;padding-left:18px;font-size:11px">${e.writes.map(x=>`<li class="mono">${esc(x)}</li>`).join("")}</ul></div>`:""}
        ${e.called_by&&e.called_by.length?`<div><div class="dad-h">CALLED BY (Feign clients in the tree)</div><div class="mono" style="font-size:10.5px">${esc(e.called_by.join(" · "))}</div></div>`:""}
        ${e.notes&&e.notes.length?`<div><div class="dad-h" style="color:var(--red,#dc2626)">NOTES · from the code</div><ul style="margin:0;padding-left:18px;font-size:11px">${e.notes.map(x=>`<li class="rl">${esc(x)}</li>`).join("")}</ul></div>`:""}
        <div class="mono" style="font-size:10px;color:var(--muted)">${esc(e.file||s.file||"")}${e.impl?` · impl ${esc(e.impl)}`:""}</div>
      </div>`:""}
    </div>`;
  }
  function page(){
    const s=(D.sections||[]).find(x=>x.id===sel);
    if(!s) return `<div class="rl">Pick a controller on the left.</div>`;
    const sv=(D.services||[]).find(x=>x.id===s.service)||{};
    const eps=(s.endpoints||[]).filter(e=>epOk(e,s));
    const jl=s.journey; const jlabel=jl&&((D.journeys||{})[jl]||(SPEC&&(SPEC.journeys||[]).find(x=>x.key===jl)||{}).label||jl);
    return `<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
        <h3 style="margin:0;font-size:15px">${esc(s.title||s.ctrl)}</h3>
        <span class="mono" style="font-size:11px;color:var(--muted)">${esc(s.ctrl)} · ${esc(s.base||"")}</span>
        <span style="font-size:10px;font-weight:800;color:${CALLC[s.caller]||"var(--muted)"}">${esc(s.caller||"")}</span>
        ${jl?`<a href="#dmsdocs?j=${esc(jl)}" style="font-size:10.5px;color:#0d9488">journey: ${esc(jlabel)}</a>`:""}
        <span class="rl" style="margin-left:auto;font-size:10px;color:var(--muted)">internal link <span class="mono">#dmsdocs?s=${esc(s.id)}</span></span></div>
      <div class="rl" style="font-size:11.5px;margin:6px 0 10px">${esc(s.summary||"")}</div>
      <div class="rl" style="font-size:10.5px;color:var(--muted);margin-bottom:10px">${esc(sv.name||s.service)} · ${esc(sv.jar||"")} · context <span class="mono">${esc(sv.context||"")}</span> · port <span class="mono">${esc(String(sv.port||""))}</span> · auth: ${esc(sv.auth||"")} · audit: ${esc(sv.audit||"")}</div>
      <div style="display:flex;gap:8px;margin-bottom:8px"><button class="pill" id="dadAll" style="font-size:10.5px;padding:3px 9px">${eps.every(e=>openEp.has(s.id+"|"+e.verb+" "+e.path))?"Collapse all":"Expand all"} (${eps.length})</button></div>
      ${eps.map(e=>epCard(e,s)).join("")||`<div class="rl" style="color:var(--muted)">no endpoint of this controller matches the filters</div>`}`;
  }
  function counts(){ const V=visible(); return V.reduce((a,x)=>a+x.eps.length,0); }
  let pendingQs="";
  async function render(qs){
    const host=$("#view-dmsdocs"); if(!host) return; if(typeof qs==="string"&&qs) pendingQs=qs;
    await load();
    if(!D){ host.innerHTML=`<div style="padding:24px;max-width:760px;margin:0 auto"><h2>DMS API reference</h2><div class="albanner" style="margin-top:10px">dmsApiDocs.json not found — rebuild it from the decompiled release (see DMS-API-REFERENCE.md), then deploy.</div></div>`; return; }
    const h=pendingQs?"#dmsdocs?"+pendingQs:(location.hash||""); pendingQs=""; let m;
    if(h!==lastHash){ lastHash=h;
      if((m=/[?&]s=([a-z0-9_\-]+)/i.exec(h))&&(D.sections||[]).some(x=>x.id===m[1])) sel=m[1];
      if((m=/[?&]j=([a-z0-9_\-]+)/i.exec(h))) { jkey=m[1]; caller="all"; svc="all"; }
      if((m=/[?&]q=([^&]+)/i.exec(h))) q=decodeURIComponent(m[1]); }
    if(jkey){ const V=visible(); if(!V.some(x=>x.s.id===sel)) sel=V.length?V[0].s.id:sel; }
    if(!sel) sel=((D.sections||[]).find(s=>s.id==="dms_customer_service-sim-activation")||D.sections[0]||{}).id;
    const callers=Object.keys(D.callers||{}); const jlab=jkey&&((D.journeys||{})[jkey]||(journeyPaths(jkey)||{}).label||jkey);
    const feign=(D.feign_clients_without_matching_controller||[]);
    host.innerHTML=`<div style="padding:14px 18px;max-width:1500px;margin:0 auto">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:8px">
        <h2 style="margin:0;font-size:17px">DMS API reference — every endpoint, from the production code</h2>
        <span class="rl" style="color:var(--muted)">${esc(String(D.generated||""))} · ${(D.services||[]).length} services · ${(D.sections||[]).length} controllers · ${(D.index||[]).length} endpoints · ${esc(D.source||"")}</span></div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <input id="dadQ" placeholder="search path, DTO field, downstream, table…" value="${esc(q)}" class="mono" style="flex:1;min-width:220px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2,rgba(148,163,184,.06));color:var(--ink);font-size:11.5px">
        <select id="dadSvc" style="font:inherit;font-size:11px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit"><option value="all">all services</option>${(D.services||[]).map(s=>`<option value="${esc(s.id)}" ${svc===s.id?"selected":""}>${esc(s.name.replace(/ \(.*$/,""))} (${s.endpoints})</option>`).join("")}</select>
        ${["all"].concat(callers).map(c=>`<button class="pill" data-caller="${esc(c)}" style="font-size:10.5px;padding:3px 9px;font-weight:${caller===c?800:600};${caller===c?"border-left-color:"+(CALLC[c]||"var(--green,#0e9f6e)")+";":""}" title="${esc((D.callers||{})[c]||"every caller")}">${esc(c)}</button>`).join("")}
        ${jkey?`<span class="pill" style="font-size:10.5px;padding:3px 9px;border-left-color:#0d9488">journey: ${esc(jlab)} <a href="#" id="dadJx" style="color:inherit;margin-left:4px" title="clear">✕</a></span>`:""}
        <span class="mono" style="font-size:10.5px;color:var(--muted)">${counts()} shown</span>
      </div>
      <div style="display:flex;gap:14px;align-items:flex-start" class="dad-cols">
        <div class="dad-tree" style="width:300px;flex-shrink:0;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:8px;max-height:calc(100vh - 230px);overflow:auto"><div id="dadTree">${tree()}</div></div>
        <div style="flex:1;min-width:0;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:14px 18px;min-height:400px;max-height:calc(100vh - 230px);overflow:auto" id="dadPage">${page()}</div>
      </div>
      ${feign.length?`<details style="margin-top:10px;font-size:11px"><summary class="rl" style="cursor:pointer;color:var(--amber,#b45309);font-weight:700">${feign.length} Feign clients call a path no controller serves (dead or broken integrations) — from the code</summary>
        <table style="margin-top:6px"><thead><tr><th>caller</th><th>client</th><th>eureka target</th><th>call</th><th>target service</th></tr></thead><tbody>${feign.map(f=>`<tr><td class="mono">${esc(f.caller)}</td><td class="mono">${esc(f.client)}</td><td class="mono">${esc(f.eureka)}</td><td class="mono">${esc(f.verb)} ${esc(f.path)}</td><td class="mono" style="color:var(--muted)">${esc(f.target_service||"not in the tree")}</td></tr>`).join("")}</tbody></table></details>`:""}
      <style>#view-dmsdocs table{border-collapse:collapse;font-size:11px;margin:4px 0;max-width:100%}#view-dmsdocs td,#view-dmsdocs th{border:1px solid var(--line);padding:3px 7px;text-align:left;vertical-align:top}#view-dmsdocs th{color:var(--muted);font-weight:700;font-size:10px}
        .dad-h{font-size:10.5px;font-weight:800;margin-bottom:3px}
        @media (max-width:820px){#view-dmsdocs .dad-cols{flex-direction:column}#view-dmsdocs .dad-tree{width:auto;max-height:220px}#view-dmsdocs #dadPage{max-height:none}}</style></div>`;
    const setHash=()=>{ const nh="dmsdocs?s="+sel+(jkey?"&j="+jkey:""); lastHash="#"+nh; if(window.setConsoleHash) window.setConsoleHash(nh); };
    const wireTree=()=>{ host.querySelectorAll(".dad-it").forEach(el=>el.addEventListener("click",()=>{ sel=el.dataset.id; setHash(); render(); if(window.audit) window.audit("VIEW_DMS_DOC", sel.slice(0,40)); })); };
    const wirePage=()=>{
      host.querySelectorAll("[data-ep]").forEach(el=>el.addEventListener("click",ev=>{ if(ev.target.closest("a")) return; const id=el.dataset.ep; if(openEp.has(id)) openEp.delete(id); else openEp.add(id); const pg=$("#dadPage"); const st=pg.scrollTop; pg.innerHTML=page(); pg.scrollTop=st; wirePage(); }));
      const all=$("#dadAll"); if(all) all.addEventListener("click",()=>{ const s=(D.sections||[]).find(x=>x.id===sel); const eps=(s.endpoints||[]).filter(e=>epOk(e,s)); const ids=eps.map(e=>s.id+"|"+e.verb+" "+e.path); if(ids.every(i=>openEp.has(i))) ids.forEach(i=>openEp.delete(i)); else ids.forEach(i=>openEp.add(i)); const pg=$("#dadPage"); pg.innerHTML=page(); wirePage(); });
    };
    wireTree(); wirePage();
    const on=host.querySelector(".dad-it.on"); if(on) on.scrollIntoView({block:"nearest"});
    const qi=$("#dadQ"); qi.addEventListener("input",()=>{ q=qi.value.trim(); const t=$("#dadTree"); t.innerHTML=tree(); wireTree(); const pg=$("#dadPage"); pg.innerHTML=page(); wirePage(); host.querySelectorAll(".mono").length; });
    $("#dadSvc").addEventListener("change",e=>{ svc=e.target.value; const V=visible(); if(!V.some(x=>x.s.id===sel)&&V.length) sel=V[0].s.id; render(); });
    host.querySelectorAll("[data-caller]").forEach(b=>b.addEventListener("click",()=>{ caller=b.dataset.caller; const V=visible(); if(!V.some(x=>x.s.id===sel)&&V.length) sel=V[0].s.id; render(); }));
    const jx=$("#dadJx"); if(jx) jx.addEventListener("click",e=>{ e.preventDefault(); jkey=""; lastHash="#dmsdocs?s="+sel; if(window.setConsoleHash) window.setConsoleHash("dmsdocs?s="+sel); render(); });
  }
  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="dmsdocs") b.addEventListener("click", render); });
  window.addEventListener("hashchange",()=>{ if(/^#dmsdocs/.test(location.hash)&&$("#view-dmsdocs")&&$("#view-dmsdocs").classList.contains("active")) render(); });
  window.openDmsDocs=render;
})();
