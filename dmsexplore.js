/* DMS — EXPLORE (17 Sep 2026): the dealer journeys as the production code defines them, and the
 * flow rules that recognise abnormal ones from the databases. Data comes from one server spec
 * (dmsJourneySpec.js → /api/dms/journeys/spec) and the rule runner (dmsFlowRules.js →
 * /api/dms/flow-rules). Mounted by dms.js as window.renderDmsExplore(host). Read-only page;
 * "Run now" is the one action and it is audited server-side. Dark mode + phone friendly. */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const SES=()=>({ email:localStorage.getItem("cons_email")||"", role:localStorage.getItem("cons_role")||"report_manager" });
  const base=()=>(window.API_BASE||window.CONSOLE_BASE||"");
  const hdr=()=>({ "Content-Type":"application/json","X-Console-Role":SES().role,"X-Console-User":SES().email });
  async function api(path,opt){ const r=await fetch(base()+path,Object.assign({headers:hdr()},opt||{})); if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||("HTTP "+r.status)); return r.json(); }
  const ago=iso=>{ if(!iso) return "never"; const m=Math.round((Date.now()-new Date(iso))/60000); return m<1?"just now":m<60?m+" min ago":m<1440?Math.round(m/60)+" h ago":Math.round(m/1440)+" d ago"; };
  const SEVC={P2:"var(--red,#dc2626)",P3:"var(--amber,#b45309)",P4:"var(--muted)"};
  let SPEC=null, RULES=null, fam="all", qtext="", open=new Set(), actor="dealer";
  const famActor=k=>((SPEC&&SPEC.families[k])||{}).actor||"dealer";

  function ruleChip(id){
    const r=(RULES||[]).find(x=>x.id===id); const meta=r||(SPEC&&SPEC.rules[id])||{sev:"P4",title:id};
    const n=r&&r.last&&!r.last.error?r.last.n:null; const impl=r&&r.implemented;
    const col=n==null?"var(--muted)":n>0?SEVC[meta.sev]:"var(--green,#0e9f6e)";
    return `<a href="#" data-rule="${esc(id)}" class="pill" title="${esc(meta.title)}${impl?"":" · not implemented yet"}" style="font-size:10.5px;padding:2px 8px;border-left-color:${col};text-decoration:none;color:inherit;opacity:${impl?1:.55}">${esc(id)}${n!=null?` <b style="color:${col}">${n}${r.last.capped?"+":""}</b>`:""}</a>`;
  }
  function journeyCard(j){
    const o=open.has(j.key); const F=SPEC.families[j.family]||{};
    return `<div class="topo-card" style="padding:10px 12px;background:var(--card,#fff);display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-size:15px">${esc(F.icon||"")}</span><b style="font-size:12.5px">${esc(j.label)}</b>
        ${j.sanity&&j.sanity.length?`<span class="rl mono" style="font-size:9.5px;color:var(--muted)" title="row numbers in the CRQ000000185185 30-flow sanity list">sanity #${esc(j.sanity.join(", #"))}</span>`:""}
        <span style="margin-left:auto;display:flex;gap:4px;flex-wrap:wrap">${(j.rules||[]).map(ruleChip).join("")}${!(j.rules||[]).length&&famActor(j.family)!=="dealer"?`<span class="rl" style="font-size:9.5px;color:var(--muted);align-self:center" title="candidate rules for this family are listed under the journeys (prefix A) — none wired yet">no rule wired yet</span>`:""}</span>
      </div>
      <div class="rl" style="font-size:11px;color:var(--muted)">${esc(j.purpose)}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${(j.systems||[]).map(s=>`<span class="rl" style="font-size:9.5px;padding:1px 7px;border:1px solid var(--line);border-radius:999px;color:var(--muted)">${esc(SPEC.systems[s]||s)}</span>`).join("")}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="pill" data-toggle="${esc(j.key)}" style="font-size:11px;padding:4px 10px">${o?"▾ Hide flow":"▸ Flow, signature & break points"}</button>
        ${j.console?`<button class="pill" data-board="${esc(j.console)}" style="font-size:11px;padding:4px 10px" title="journeys board key ${esc(j.console)}">Journeys board · ${esc(j.console)}</button>`:famActor(j.family)==="dealer"?`<span class="rl" style="font-size:10px;color:var(--amber,#b45309);align-self:center">no ledger table — cms_logs only</span>`:`<span class="rl" style="font-size:10px;color:var(--amber,#b45309);align-self:center">no board yet — see signature for the trace it leaves</span>`}
        <a href="#dmsdocs?j=${esc(j.key)}" class="pill" style="font-size:11px;padding:4px 10px;text-decoration:none;color:inherit" title="every endpoint of this journey in the DMS API reference">API reference ↗</a>
        <span class="rl" style="font-size:10px;color:var(--muted);align-self:center">${esc(F.doc||"")}</span>
      </div>
      ${o?`<div style="border-top:1px solid var(--line);padding-top:8px;display:grid;grid-template-columns:1fr;gap:10px">
        <div><div class="rl" style="font-weight:800;font-size:11px;margin-bottom:4px">FLOW · what the app calls, in order</div>
          <ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px">${(j.steps||[]).map(s=>`<li style="font-size:11px"><span class="mono" style="font-weight:700">${esc(s.ep)}</span> <span class="rl" style="font-size:9.5px;color:var(--muted)">${esc(SPEC.systems[s.svc]||s.svc||"")}</span>${s.note?`<div class="rl" style="font-size:10.5px;color:var(--muted)">${esc(s.note)}</div>`:""}</li>`).join("")}</ol></div>
        <div><div class="rl" style="font-weight:800;font-size:11px;margin-bottom:4px;color:var(--green,#0e9f6e)">NORMAL · the rows a good run leaves (in order)</div>
          <ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px">${(j.signature||[]).map(s=>`<li class="mono" style="font-size:10.5px">${esc(s)}</li>`).join("")}</ol></div>
        <div><div class="rl" style="font-weight:800;font-size:11px;margin-bottom:4px;color:var(--red,#dc2626)">WHERE IT BREAKS · from the code</div>
          <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:3px">${(j.breaks||[]).map(s=>`<li class="rl" style="font-size:10.5px">${esc(s)}</li>`).join("")}</ul></div>
      </div>`:""}
    </div>`;
  }
  function candidatesTable(){
    const C=Object.entries((SPEC&&SPEC.rules)||{}).filter(([id,r])=>r.candidate&&(fam==="all"?famActor(r.family)===actor:r.family===fam));
    if(!C.length) return "";
    return `<div class="topo-card" style="padding:10px 12px;background:var(--card,#fff);margin-bottom:12px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:12px">Candidate rules (admin &amp; system) — defined from the code, not wired yet</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">${C.length} candidates · DMS-CODE-G-ADMIN.md · each becomes a scheduled SQL check in dmsFlowRules.js once validated on live data</span></div>
      <div style="overflow:auto;margin-top:8px;border:1px solid var(--line);border-radius:10px"><table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:600px">
        <thead><tr style="text-align:left"><th style="padding:6px 8px">rule</th><th style="padding:6px 8px">sev</th><th style="padding:6px 8px">what it would recognise</th><th style="padding:6px 8px">family</th></tr></thead>
        <tbody>${C.map(([id,r])=>`<tr style="border-top:1px solid var(--line);opacity:.8"><td class="mono" style="padding:5px 8px;font-weight:800">${esc(id)}</td><td style="padding:5px 8px;font-weight:800;color:${SEVC[r.sev]||"var(--muted)"}">${esc(r.sev)}</td><td style="padding:5px 8px">${esc(r.title)}</td><td class="rl" style="padding:5px 8px;color:var(--muted)">${esc((SPEC.families[r.family]||{}).label||r.family)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  function rulesTable(){
    const rs=(RULES||[]).slice().sort((a,z)=>{ const na=a.last&&!a.last.error?a.last.n:-1, nz=z.last&&!z.last.error?z.last.n:-1; if((nz>0)-(na>0)) return (nz>0)-(na>0); return (a.sev>z.sev?1:a.sev<z.sev?-1:0)||a.id.localeCompare(z.id); });
    const hits=rs.filter(r=>r.last&&!r.last.error&&r.last.n>0).length, impl=rs.filter(r=>r.implemented).length;
    return `<div class="topo-card" style="padding:10px 12px;background:var(--card,#fff)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <b style="font-size:12px">Flow rules</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">${impl}/${rs.length} implemented · ${hits} with findings · window ${esc(String((RULES&&RULES.__st&&RULES.__st.windowH)||2))} h · every ${esc(String(Math.round(((RULES&&RULES.__st&&RULES.__st.intervalSec)||900)/60)))} min · identifiers masked at ingest · rules marked <b>validating</b> do not alert yet</span>
        <button id="dxRun" class="btn" style="margin-left:auto;font-size:11.5px;padding:5px 12px">Run all now</button>
      </div>
      <div style="overflow:auto;margin-top:8px;border:1px solid var(--line);border-radius:10px">
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:760px">
        <thead><tr style="text-align:left"><th style="padding:6px 8px">rule</th><th style="padding:6px 8px">sev</th><th style="padding:6px 8px">what it recognises</th><th style="padding:6px 8px">family</th><th style="padding:6px 8px;text-align:right">cases</th><th style="padding:6px 8px">last run</th><th style="padding:6px 8px">note</th></tr></thead>
        <tbody>${rs.map(r=>{ const L=r.last; const n=L&&!L.error?L.n:null; const col=n==null?"var(--muted)":n>0?SEVC[r.sev]:"var(--green,#0e9f6e)";
          return `<tr data-rrow="${esc(r.id)}" style="border-top:1px solid var(--line);cursor:pointer;${r.implemented?"":"opacity:.55"}">
            <td class="mono" style="padding:5px 8px;font-weight:800">${esc(r.id)}</td>
            <td style="padding:5px 8px;font-weight:800;color:${SEVC[r.sev]};white-space:nowrap">${esc(r.sev)}${r.alert===false?`<span class="rl" title="runs and is visible here, but does not raise an alert until its cross-table join is validated against live data" style="font-weight:600;color:var(--muted);font-size:9.5px"> · validating</span>`:""}</td>
            <td style="padding:5px 8px">${esc(r.title)}</td>
            <td class="rl" style="padding:5px 8px;color:var(--muted)">${esc(r.family)}</td>
            <td class="mono" style="padding:5px 8px;text-align:right;font-weight:800;color:${col}">${n==null?(r.implemented?"—":"n/a"):n+(L.capped?"+":"")}</td>
            <td class="rl" style="padding:5px 8px;color:var(--muted)">${L?esc(ago(L.at))+(L.ms!=null?` · ${esc(String(L.ms))} ms`:""):"never"}</td>
            <td class="rl" style="padding:5px 8px;color:${L&&L.error?(L.skipped?"var(--amber,#b45309)":"var(--red,#dc2626)"):"var(--muted)"};font-size:10.5px">${r.retired?`<span style="color:var(--muted)">retired · ${esc(r.retired)}</span>`:esc(L?(L.error||L.note||""):(r.implemented?"":"defined in DMS-JOURNEYS-CODE.md §6 — not wired yet"))}</td></tr>
            <tr data-rdet="${esc(r.id)}" style="display:none"><td colspan="7" style="padding:6px 10px;background:var(--bg,transparent)"><div class="rl" style="font-size:11px;color:var(--muted)">Loading…</div></td></tr>`; }).join("")}</tbody></table></div></div>`;
  }
  async function showRule(host,id){
    const det=host.querySelector(`tr[data-rdet="${CSS.escape(id)}"]`); if(!det) return;
    const on=det.style.display!=="none"; host.querySelectorAll("tr[data-rdet]").forEach(t=>t.style.display="none"); if(on) return;
    det.style.display=""; const cell=det.firstElementChild;
    try{
      const h=await api(`/api/dms/flow-rules/${encodeURIComponent(id)}?limit=30`);
      const last=h.history&&h.history[0]; const sample=(last&&last.sample)||[];
      const cols=sample.length?Object.keys(sample[0]):[];
      const js=(SPEC.journeys||[]).filter(j=>(j.rules||[]).includes(id));
      cell.innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
          <b style="font-size:11.5px">${esc(id)} · ${esc((SPEC.rules[id]||{}).title||"")}</b>
          <span class="rl" style="font-size:10.5px;color:var(--muted)">journeys: ${js.map(j=>`<a href="#" data-open="${esc(j.key)}" style="color:inherit">${esc(j.label)}</a>`).join(", ")||"—"}</span>
          <span class="mono" style="margin-left:auto;font-size:10px;color:var(--muted)">${(h.history||[]).slice(0,30).reverse().map(x=>x.error?"·":x.n>0?"▮":"▁").join("")} <span class="rl">(last 30 runs)</span></span>
        </div>
        ${last&&last.error?`<div style="font-size:11px;color:${last.skipped?"var(--amber,#b45309)":"var(--red,#dc2626)"}">${esc(last.error)}</div>`:""}
        ${sample.length?`<div style="overflow:auto"><table style="border-collapse:collapse;font-size:10.5px;min-width:600px"><thead><tr>${cols.map(c=>`<th style="padding:3px 6px;text-align:left;color:var(--muted)">${esc(c)}</th>`).join("")}</tr></thead>
          <tbody>${sample.map(r=>`<tr style="border-top:1px solid var(--line)">${cols.map(c=>`<td class="mono" style="padding:3px 6px;white-space:nowrap">${esc(r[c]==null?"":(typeof r[c]==="string"&&/^\d{4}-\d\d-\d\dT/.test(r[c])?r[c].replace("T"," ").slice(0,19):r[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          <div class="rl" style="font-size:10px;color:var(--muted);margin-top:4px">${sample.length} of ${last.n}${last.capped?"+":""} · window ${esc(String(last.win_from||"").replace("T"," ").slice(0,16))} → ${esc(String(last.win_to||"").replace("T"," ").slice(0,16))} UTC${last.note?" · "+esc(last.note):""}</div>`
          :`<div class="rl" style="font-size:11px;color:var(--muted)">${last?(last.n===0?"no cases in the last window":"no sample stored"):"never run"}</div>`}`;
      cell.querySelectorAll("a[data-open]").forEach(a=>a.addEventListener("click",e=>{ e.preventDefault(); open.add(a.dataset.open); render(host); const el=host.querySelector(`[data-toggle="${CSS.escape(a.dataset.open)}"]`); if(el) el.scrollIntoView({behavior:"smooth",block:"center"}); }));
    }catch(e){ cell.innerHTML=`<div style="font-size:11px;color:var(--red,#dc2626)">${esc(e.message)}</div>`; }
  }
  function render(host){
    if(!SPEC){ host.innerHTML=`<div class="rl">Loading journey spec…</div>`; return; }
    const actors=Object.entries(SPEC.actors||{dealer:"Dealer app"});
    const fams=Object.entries(SPEC.families).filter(([k,f])=>(f.actor||"dealer")===actor);
    const inActor=j=>famActor(j.family)===actor;
    const js=(SPEC.journeys||[]).filter(j=>inActor(j)&&(fam==="all"||j.family===fam)&&(!qtext||JSON.stringify(j).toLowerCase().includes(qtext)));
    host.innerHTML=`<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
        ${actors.map(([k,l])=>`<button class="pill" data-actor="${esc(k)}" style="font-size:11.5px;padding:5px 12px;font-weight:${actor===k?800:600};${actor===k?"border-left-color:var(--green,#0e9f6e);":""}">${esc(l)} <span class="mono" style="font-size:10px;color:var(--muted)">${SPEC.journeys.filter(j=>famActor(j.family)===k).length}</span></button>`).join("")}
        <span class="rl" style="font-size:10px;color:var(--muted)">${actor==="dealer"?"what the DMS app does, from the 17 Sep 2026 code":actor==="admin"?"back-office (CMS portal) journeys — from the 30 Sep 2026 code; most leave NO audit row":"scheduled jobs, the audit pipeline and inbound callbacks — from the 30 Sep 2026 code"}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <button class="pill" data-fam="all" style="font-size:11px;padding:4px 10px;font-weight:${fam==="all"?800:600}">All (${SPEC.journeys.filter(inActor).length})</button>
        ${fams.map(([k,f])=>`<button class="pill" data-fam="${esc(k)}" style="font-size:11px;padding:4px 10px;font-weight:${fam===k?800:600}">${esc(f.icon)} ${esc(f.label)} (${SPEC.journeys.filter(j=>j.family===k).length})</button>`).join("")}
        <input id="dxq" placeholder="search endpoints, tables, codes…" value="${esc(qtext)}" style="margin-left:auto;font:inherit;font-size:11.5px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit;min-width:200px">
        <span class="rl" style="font-size:10px;color:var(--muted)">from the production code of ${esc(SPEC.generated)} · ${esc(SPEC.doc)}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,460px),1fr));gap:10px;margin-bottom:12px">${js.map(journeyCard).join("")||`<div class="rl">no journey matches</div>`}</div>
      ${candidatesTable()}
      <div id="dxRules">${actor==="dealer"?rulesTable():""}</div>`;
    host.querySelectorAll("[data-actor]").forEach(b=>b.addEventListener("click",()=>{ actor=b.dataset.actor; fam="all"; render(host); if(window.audit) window.audit("DMS_EXPLORE_SCOPE",actor); }));
    host.querySelectorAll("[data-fam]").forEach(b=>b.addEventListener("click",()=>{ fam=b.dataset.fam; render(host); }));
    const qi=host.querySelector("#dxq"); qi.addEventListener("input",()=>{ qtext=qi.value.trim().toLowerCase(); const pos=qi.selectionStart; render(host); const q2=host.querySelector("#dxq"); q2.focus(); q2.setSelectionRange(pos,pos); });
    host.querySelectorAll("[data-toggle]").forEach(b=>b.addEventListener("click",()=>{ const k=b.dataset.toggle; if(open.has(k)) open.delete(k); else open.add(k); render(host); }));
    host.querySelectorAll("[data-board]").forEach(b=>b.addEventListener("click",()=>{ const el=document.querySelector("#dmsJourneys"); if(el) el.scrollIntoView({behavior:"smooth"}); if(window.openDmsJourney) window.openDmsJourney(b.dataset.board); }));
    host.querySelectorAll("a[data-rule]").forEach(a=>a.addEventListener("click",e=>{ e.preventDefault(); const row=host.querySelector(`tr[data-rrow="${CSS.escape(a.dataset.rule)}"]`); if(row){ row.scrollIntoView({behavior:"smooth",block:"center"}); showRule(host,a.dataset.rule); } }));
    host.querySelectorAll("tr[data-rrow]").forEach(tr=>tr.addEventListener("click",()=>showRule(host,tr.dataset.rrow)));
    const run=host.querySelector("#dxRun"); if(run) run.addEventListener("click",async()=>{ run.disabled=true; run.textContent="Running… (up to a few minutes)"; try{ await api("/api/dms/flow-rules/run",{method:"POST"}); await loadRules(); render(host); if(window.audit) window.audit("DMS_FLOW_RULES_RUN","dms:explore"); }catch(e){ run.textContent=e.message.slice(0,60); setTimeout(()=>render(host),2500); } });
  }
  async function loadRules(){ try{ const r=await api("/api/dms/flow-rules"); RULES=r.rules||[]; RULES.__st=r.status||{}; }catch(e){ RULES=[]; RULES.__st={error:e.message}; } }
  window.renderDmsExplore=async function(host){
    if(!host) return; render(host);
    try{ if(!SPEC) SPEC=await api("/api/dms/journeys/spec"); await loadRules(); render(host); }
    catch(e){ host.innerHTML=`<div class="rl" style="color:var(--red,#dc2626)">${esc(e.message)} — the server does not expose the journey spec yet (deploy pending?)</div>`; }
  };
})();
