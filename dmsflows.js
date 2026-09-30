/* DMS JOURNEYS — step by step (like Mobile › Journeys, but for the dealer app / CMS / system flows of the
 * DMS platform). One data source: /api/dms/journeys/spec (dmsJourneySpec.js + dmsAdminJourneys.js —
 * endpoint order, systems, signature, break points, from the decompiled production code) joined with
 * dmsApiDocs.json (per endpoint: what it does, request fields, response codes, downstream calls in order,
 * tables written). Success path = the calls of the step and the rows it leaves; Failure mode = the codes
 * the endpoint answers and the journey's break points. Click an endpoint → its API-reference card.
 * Deep links: #dms-journeys?j=<key>&s=<n>. Read-only. Dark mode + phone. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const tv=(n,fb)=>{ const v=getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v||fb; };
  const base=()=>(window.API_BASE||window.CONSOLE_BASE||"");
  const hdr=()=>({ "X-Console-Role":localStorage.getItem("cons_role")||"report_manager","X-Console-User":localStorage.getItem("cons_email")||"" });
  let SPEC=null, DOCS=null, EPX=null;                       // spec, api docs, path → endpoint index
  const st={ j:0, s:0, mode:"success", actor:"dealer", fam:"all", q:"", timer:null };
  const ACTORC={dealer:"#0e9f5a",admin:"#b45309",system:"#7c3aed"};
  const FAMC={access:"#0d9488",activation:"#0e9f5a",lifecycle:"#2563eb",money:"#d97706",inventory:"#7c3aed",admin_users:"#b45309",admin_channels:"#ea580c",admin_money:"#d97706",admin_config:"#0d9488",admin_reports:"#64748b",system:"#7c3aed"};

  async function load(){
    if(!SPEC){ try{ const r=await fetch(base()+"/api/dms/journeys/spec",{headers:hdr()}); if(r.ok) SPEC=await r.json(); }catch(e){} }
    if(!DOCS){ try{ const r=await fetch("dmsApiDocs.json?v=20261001a"); if(r.ok) DOCS=await r.json(); }catch(e){} }
    if(DOCS&&!EPX){ EPX={}; (DOCS.sections||[]).forEach(s=>(s.endpoints||[]).forEach(e=>{ const k=e.path.replace(/\/+$/,""); (EPX[k]=EPX[k]||[]).push(Object.assign({_sec:s},e)); })); }
  }
  /* "POST /cus/simactivation/activate" | "/onboarding/device/* (register)" | "(inside login) Nafath initiate" → api-docs endpoint */
  function resolve(ep){
    if(!EPX) return null; const m=/((?:\/[a-z0-9_\-{}.]+)+)/i.exec(String(ep||"")); if(!m) return null;
    const p=m[1].replace(/\/+$/,""); const verb=(/^(GET|POST|PUT|DELETE|PATCH)\b/i.exec(String(ep).trim())||[])[1];
    if(!/^\/(cus|onboarding|apc|pay|chs|was|uil|tpi|reports|audit-log|doc_management|cab|rabbit|notification|salambi)\b/i.test(p)) return null;   // only real service paths, not "auth: /generateotp"
    let c=EPX[p]||[]; if(!c.length&&p.split("/").length>2){ const k=Object.keys(EPX).find(k=>k.endsWith(p)); if(k) c=EPX[k]; }
    if(!c.length&&/\*$/.test(m[1])){ const pre=m[1].slice(0,-1); const k=Object.keys(EPX).find(k=>k.startsWith(pre)); if(k) c=EPX[k]; }
    if(!c.length) return null; return (verb&&c.find(e=>e.verb===verb.toUpperCase()))||c[0];
  }
  const laneOf=d=>{ const s=String(d); if(/^UIL\b|\/tpi\/|\/uil\//i.test(s)) return "UIL"; if(/Optiva|BSS SOAP|SOAP/i.test(s)) return "Optiva BSS (SOAP)"; if(/wallet|\/was\//i.test(s)) return "Wallet (trms)"; if(/^APC\b|\/apc\//i.test(s)) return "App-content"; if(/^CHS\b|\/chs\//i.test(s)) return "Channel svc"; if(/^ONB\b|\/onboarding\//i.test(s)) return "Onboarding svc"; if(/^CUS\b|\/cus\//i.test(s)) return "Customer svc"; if(/Keycloak/i.test(s)) return "Keycloak"; if(/Semati|TCC/i.test(s)) return "Semati / TCC"; if(/Nafath/i.test(s)) return "Nafath"; if(/Absher|ELM/i.test(s)) return "Absher"; if(/notification|SMS|esmg|FCM|mail/i.test(s)) return "Notification"; if(/Magento/i.test(s)) return "Magento"; if(/HyperPay/i.test(s)) return "HyperPay"; if(/VRA|voucher/i.test(s)) return "VRA"; if(/Redis/i.test(s)) return "Redis"; if(/OpenKM/i.test(s)) return "OpenKM"; if(/Rabbit|producer|\/rabbit\//i.test(s)) return "RabbitMQ ledger"; if(/AppCrm|CRM/i.test(s)) return "AppCrm"; return s.split(/[ /]/)[0].slice(0,18)||"downstream"; };
  const svcLane=k=>({cus:"Customer svc",onb:"Onboarding svc",apc:"App-content",pay:"Payment svc",uil:"UIL",wallet:"Wallet (trms)",chs:"Channel svc",rpt:"Reports svc",con:"Audit consumer",prd:"Audit producer",cab:"Callback svc",doc:"Doc-mgmt svc",sched:"Scheduled job",bss:"Optiva BSS (SOAP)",semati:"Semati / TCC",nafath:"Nafath",kc:"Keycloak",sms:"Notification"}[k]||((SPEC&&SPEC.systems[k])||k||"service").split(" ")[0]);
  const actorOf=j=>((SPEC.families[j.family]||{}).actor)||"dealer";
  const callerLane=j=>actorOf(j)==="dealer"?"DMS app":actorOf(j)==="admin"?"CMS portal":"Scheduler / caller";
  const stepName=s=>{ const e=resolve(s.ep); if(e&&e.method) return e.method.replace(/([a-z])([A-Z])/g,"$1 $2").toLowerCase().replace(/^./,c=>c.toUpperCase());
    const t=String(s.ep||"").replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i,"").replace(/^[—\s]+/,"").replace(/^\((.*?)\)\s*/,"$1 · ").trim(); return t.length>46?t.slice(0,44)+"…":t; };

  /* ---------- picker ---------- */
  function journeys(){ return (SPEC.journeys||[]).filter(j=>(st.actor==="all"||actorOf(j)===st.actor)&&(st.fam==="all"||j.family===st.fam)&&(!st.q||(j.label+" "+j.purpose+" "+j.steps.map(x=>x.ep).join(" ")).toLowerCase().includes(st.q))); }
  /* ---------- navigator: actor tabs + search on top, family-grouped list on the left ---------- */
  const collapsed=new Set();
  function renderPicker(){
    const T=$("#dfTop"), N=$("#dfNav"); if(!T||!N) return;
    const acts=[["all","All"]].concat(Object.entries(SPEC.actors||{}));
    const J=journeys(); const cur=J[st.j];
    T.innerHTML=`<div class="dfseg">${acts.map(([k,l])=>`<button class="${st.actor===k?"on":""}" data-actor="${esc(k)}" style="--ac:${ACTORC[k]||"#0e9f5a"}">${esc(l)} <b>${(SPEC.journeys||[]).filter(j=>k==="all"||actorOf(j)===k).length}</b></button>`).join("")}</div>
      <input id="dfQ" placeholder="search journeys, endpoints, tables…" value="${esc(st.q)}" class="dfq">
      <span class="rl" style="font-size:10.5px;color:var(--muted)">${J.length} journey${J.length===1?"":"s"}</span>`;
    T.querySelectorAll("[data-actor]").forEach(b=>b.addEventListener("click",()=>{ st.actor=b.dataset.actor; st.fam="all"; pick(0); }));
    const q=$("#dfQ"); q.addEventListener("input",()=>{ st.q=q.value.trim().toLowerCase(); const pos=q.selectionStart; pick(0); const q2=$("#dfQ"); q2.focus(); q2.setSelectionRange(pos,pos); });
    const fams=Object.entries(SPEC.families).filter(([k,f])=>(st.actor==="all"||(f.actor||"dealer")===st.actor)&&J.some(j=>j.family===k));
    N.innerHTML=fams.map(([k,f])=>{ const items=J.map((j,i)=>[j,i]).filter(([j])=>j.family===k); const col=collapsed.has(k)&&!(cur&&cur.family===k);
      return `<div class="dfgrp"><div class="dfgh" data-grp="${esc(k)}"><span class="cdot" style="background:${FAMC[k]||"#64748b"}"></span><span>${esc(f.icon||"")} ${esc(f.label)}</span><span class="cnt">${items.length}</span><span class="car">${col?"▸":"▾"}</span></div>
        ${col?"":`<div class="dfgi">${items.map(([j,i])=>`<button class="dfit ${i===st.j?"on":""}" data-i="${i}" title="${esc(j.purpose||"")}"><span>${esc(j.label)}</span><span class="mono" style="font-size:9.5px;color:var(--muted)">${(j.steps||[]).length}</span></button>`).join("")}</div>`}</div>`; }).join("")||`<div class="jempty">No DMS journey matches — clear the search or pick another scope.</div>`;
    N.querySelectorAll("[data-i]").forEach(b=>b.addEventListener("click",()=>pick(+b.dataset.i)));
    N.querySelectorAll("[data-grp]").forEach(h=>h.addEventListener("click",()=>{ const g=h.dataset.grp; if(collapsed.has(g)) collapsed.delete(g); else collapsed.add(g); renderPicker(); }));
    /* phone: the same list as a select */
    const S=$("#dfSel"); if(S){ S.innerHTML=fams.map(([k,f])=>`<optgroup label="${esc(f.label)}">${J.map((j,i)=>[j,i]).filter(([j])=>j.family===k).map(([j,i])=>`<option value="${i}" ${i===st.j?"selected":""}>${esc(j.label)}</option>`).join("")}</optgroup>`).join(""); S.onchange=()=>pick(+S.value); }
    return cur;
  }
  function pick(i){ stop(); st.j=i; st.s=0; render(); }
  function stop(){ if(st.timer){ clearInterval(st.timer); st.timer=null; } const b=$("#dfPlay"); if(b) b.textContent="▶ Play"; }

  /* ---------- sequence diagram (same visual language as Journeys) ---------- */
  function sequence(j, s, e, mode){
    const caller=callerLane(j), svc=svcLane(s.svc);
    const lanes=[caller, svc]; const arrows=[];
    const isInternal=/^[—(]/.test(String(s.ep||""));
    if(!isInternal) arrows.push({f:caller,t:svc,label:String(s.ep).length>62?String(s.ep).slice(0,60)+"…":String(s.ep),kind:"api",clickable:!!e});
    else arrows.push({f:svc,t:svc,label:String(s.ep).replace(/^[—(]+|[)]+$/g,"").slice(0,60),kind:"async",self:true});
    const ds=(e&&e.downstream)||[]; ds.slice(0,14).forEach(d=>{ const l=laneOf(d); if(l===svc) return; if(!lanes.includes(l)) lanes.push(l); arrows.push({f:svc,t:l,label:d,kind:/RabbitMQ|producer/i.test(d)?"async":"sync"}); });
    if(ds.length>14) arrows.push({f:svc,t:svc,label:`… +${ds.length-14} more downstream calls (see API reference)`,kind:"async",self:true});
    const writes=(e&&e.writes)||[]; if(writes.some(w=>/^ledger:/.test(w))){ if(!lanes.includes("RabbitMQ ledger")) lanes.push("RabbitMQ ledger"); arrows.push({f:svc,t:"RabbitMQ ledger",label:"HttpLoggingFilter → cms/uil/onboarding ledger row",kind:"async"}); }
    if(mode==="failure"){ const codes=((e&&e.response&&e.response.codes)||[]).filter(c=>c.code!=="00"&&c.code!=="600").slice(0,6); codes.forEach(c=>arrows.push({f:svc,t:caller,label:"✕ "+c.code+": "+String(c.meaning).slice(0,52),kind:"fail"})); }
    const laneW=Math.max(140,Math.min(200,1060/lanes.length)); const W=laneW*lanes.length+40, rowH=42, topY=56; const H=topY+arrows.length*rowH+44; const X=i=>20+laneW*i+laneW/2;
    let h=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:inherit"><defs>`;
    ["api","sync","async","fail"].forEach(k=>{ const c=k==="api"?"#2563eb":k==="fail"?"#dc2626":k==="async"?"#64748b":"#ea580c"; h+=`<marker id="dar-${k}" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${c}"/></marker>`; });
    h+=`</defs>`;
    lanes.forEach((l,i)=>{ const x=X(i); const c=i===0?"#2563eb":i===1?"#0e9f5a":l==="RabbitMQ ledger"?"#64748b":"#ea580c"; h+=`<line x1="${x}" y1="${topY}" x2="${x}" y2="${H-16}" stroke="${tv('--line','#cbd5e1')}" stroke-dasharray="4 5"/>`; const bw=Math.min(laneW-14,176); h+=`<rect x="${x-bw/2}" y="12" width="${bw}" height="32" rx="9" fill="${tv('--card','#fff')}" stroke="${c}" stroke-width="1.6"/><text x="${x}" y="32" text-anchor="middle" font-size="11.5" font-weight="700" fill="${c}">${esc(l.length>22?l.slice(0,21)+"…":l)}</text>`; });
    arrows.forEach((a,i)=>{ const y=topY+22+i*rowH; const x1=X(lanes.indexOf(a.f)), x2=X(lanes.indexOf(a.t)); const c=a.kind==="api"?"#2563eb":a.kind==="fail"?"#dc2626":a.kind==="async"?"#64748b":"#ea580c"; const dash=a.kind==="async"?` stroke-dasharray="6 4"`:a.kind==="fail"?` stroke-dasharray="3 3"`:"";
      if(a.self){ h+=`<path d="M${x1},${y-8} h34 v16 h-28" fill="none" stroke="${c}" stroke-width="1.6"${dash} marker-end="url(#dar-${a.kind})"/>`; h+=`<text x="${x1+40}" y="${y+4}" font-size="10.3" font-family="ui-monospace,Menlo,monospace" fill="${tv('--ink-soft','#334155')}">${esc(a.label.length>70?a.label.slice(0,68)+"…":a.label)}</text>`; return; }
      h+=`<line x1="${x1}" y1="${y}" x2="${x2+(x2>x1?-6:6)}" y2="${y}" stroke="${c}" stroke-width="1.7"${dash} marker-end="url(#dar-${a.kind})"/>`;
      const mx=(x1+x2)/2, lbl=a.label.length>66?a.label.slice(0,64)+"…":a.label;
      if(a.clickable) h+=`<text x="${mx}" y="${y-7}" text-anchor="middle" font-size="10.3" font-family="ui-monospace,Menlo,monospace" fill="#2563eb" class="apihit" data-dep="${esc(e.path)}" data-verb="${esc(e.verb)}" style="text-decoration:underline;text-decoration-style:dotted;cursor:pointer">${esc(lbl)}  ⤢</text>`;
      else h+=`<text x="${mx}" y="${y-7}" text-anchor="middle" font-size="10.3" font-family="ui-monospace,Menlo,monospace" fill="${a.kind==="fail"?"#dc2626":tv('--ink-soft','#334155')}">${esc(lbl)}</text>`; });
    return h+`</svg>`;
  }

  /* ---------- step detail ---------- */
  function stepDetail(j, idx, mode){
    const s=j.steps[idx]; const e=resolve(s.ep); const sec=e&&e._sec;
    let h=`<h3>${idx+1}. ${esc(stepName(s))}</h3><div class="stepdesc">${esc((e&&e.summary)||s.note||"")}</div>`;
    h+=`<div class="seqwrap">${sequence(j,s,e,mode)}</div>`;
    h+=`<div class="legend"><span><i style="background:#2563eb"></i>caller → service</span><span><i style="background:#ea580c"></i>downstream call (in order)</span><span><i style="background:#64748b"></i>ledger / async</span><span><i style="background:#dc2626"></i>failure code</span></div>`;
    h+=`<div class="infocols"><div class="infocard"><h4>CALLS THIS STEP MAKES</h4><ul>`;
    if(e){ h+=`<li><code class="apilink" data-dep="${esc(e.path)}" data-verb="${esc(e.verb)}" style="cursor:pointer">${esc(e.verb)} ${esc(e.path)}</code></li><li class="clickhint" style="font-size:11px;color:var(--muted)">▸ click the endpoint (or the blue arrow) for request fields, response codes, downstream &amp; tables</li>`; }
    else h+=`<li><code>${esc(s.ep)}</code> <span style="font-size:11px;color:var(--muted)">— not a public endpoint (internal step, job or callback)</span></li>`;
    if(e) h+=`<li><b>Controller:</b> <span style="font-family:var(--mono);font-size:11px">${esc(sec.ctrl)}#${esc(e.method)}</span>${e.impl?` · <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">${esc(e.impl)}</span>`:""}</li>`;
    h+=`<li><b>Service:</b> <code>${esc(SPEC.systems[s.svc]||s.svc||"")}</code></li>`;
    if(e&&e.downstream&&e.downstream.length) h+=`<li><b>Downstream (${e.downstream.length}):</b> ${e.downstream.slice(0,8).map(d=>`<code>${esc(d)}</code>`).join(" ")}${e.downstream.length>8?` <span style="color:var(--muted)">+${e.downstream.length-8} more</span>`:""}</li>`;
    if(s.note&&e) h+=`<li><b>From the code:</b> <span style="color:var(--ink-soft)">${esc(s.note)}</span></li>`;
    h+=`</ul>`;
    const tbl=(e&&e.writes)||[]; if(tbl.length) h+=`<div class="chips" style="margin-top:6px">${tbl.map(t=>`<span class="chip tbl">${esc(t)}</span>`).join("")}</div>`;
    h+=`</div><div class="infocard"><h4>${mode==="failure"?"FAILURE MODES":"ON SUCCESS · WHAT IT LEAVES"}</h4>`;
    if(mode==="failure"){
      const codes=((e&&e.response&&e.response.codes)||[]).filter(c=>c.code!=="00"&&c.code!=="600");
      codes.forEach(c=>{ h+=`<div class="failbox"><b>${esc(c.code)}</b> — ${esc(c.meaning)}</div>`; });
      const notes=(e&&e.notes)||[]; notes.forEach(n=>{ h+=`<div class="failbox"><b>break point</b> — ${esc(n)}</div>`; });
      if(!codes.length&&!notes.length) h+=`<div class="okbox">No explicit failure code set in this endpoint's implementation — the journey-level break points are listed below the steps.</div>`;
    } else {
      const sig=(j.signature||[]); const mine=sig.filter(x=>{ const m=/((?:\/[a-z0-9_\-{}.]+)+)/i.exec(String(s.ep||"")); return m&&x.includes(m[1].split("/").filter(Boolean).slice(-1)[0]); });
      h+=`<div class="okbox">${esc(mine.length?mine.join(" · "):(s.note||"Step completes; see the journey signature below for the rows a good run leaves."))}</div>`;
      const ok=((e&&e.response&&e.response.codes)||[]).find(c=>c.code==="00"||c.code==="600"); if(ok) h+=`<div style="margin-top:8px"><span class="chip st">response ${esc(ok.code)} · ${esc(ok.meaning)}</span></div>`;
    }
    h+=`</div></div>`;
    return h;
  }
  function journeyFooter(j, mode){
    if(mode==="failure") return `<div class="infocard" style="margin-top:14px"><h4>WHERE THIS JOURNEY BREAKS · from the code</h4><ul>${(j.breaks||[]).map(b=>`<li class="fail">✕ ${esc(b)}</li>`).join("")||"<li>—</li>"}</ul>${(j.rules||[]).length?`<div class="chips" style="margin-top:6px">${j.rules.map(r=>`<span class="chip" title="${esc(((SPEC.rules||{})[r]||{}).title||r)}">${esc(r)}</span>`).join("")}</div>`:""}</div>`;
    return `<div class="infocard" style="margin-top:14px"><h4>NORMAL RUN · THE ROWS IT LEAVES, IN ORDER</h4><ol style="padding-left:18px;font-family:var(--mono);font-size:11px;display:flex;flex-direction:column;gap:4px">${(j.signature||[]).map(x=>`<li>${esc(x)}</li>`).join("")||"<li>—</li>"}</ol>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${(j.systems||[]).map(k=>`<span class="chip" style="background:var(--card2,rgba(148,163,184,.12));color:var(--muted)">${esc(SPEC.systems[k]||k)}</span>`).join("")}</div></div>`;
  }

  /* ---------- endpoint modal (reuses the Journeys sample modal shell) ---------- */
  function openEndpoint(path, verb){
    const c=(EPX&&EPX[path])||[]; const e=c.find(x=>x.verb===verb)||c[0]; if(!e) return;
    const card=$("#sampleModalCard"), ov=$("#sampleModal"); if(!card||!ov) return;
    const R=e.response||{}, F=(e.request||{}).fields||[];
    let h=`<div class="modal-head"><span class="verb ${esc(e.verb)}">${esc(e.verb)}</span><span class="path">${esc(e.path)}</span><span class="x" id="dfModalX" style="cursor:pointer">×</span></div><div class="modal-body">
      <div style="font-size:12.5px;line-height:1.55">${esc(e.summary||"")}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">${esc(e._sec.ctrl)}#${esc(e.method)}${e.impl?" · "+esc(e.impl):""} · caller <b>${esc(e.caller||e._sec.caller||"")}</b>${e.headers&&e.headers.length?` · headers ${esc(e.headers.join(", "))}`:""}</div>
      <h5>REQUEST${(e.request||{}).dto?` · ${esc(e.request.dto)}`:""}</h5>`;
    h+=F.length?`<div class="codeblk" style="font-family:var(--mono);font-size:11px;white-space:pre-wrap">${F.map(f=>`${f.required===true?"<b>*</b>":" "} ${esc(f.name)}: ${esc(f.type)}${f.note?"   // "+esc(f.note):""}`).join("\n")}</div><div style="font-size:10.5px;color:var(--muted);margin-top:3px">* = required by the DTO validation annotations · unmarked = optional or not determined from code</div>`:`<div style="font-size:12px;color:var(--muted)">No request body (path / headers only).</div>`;
    h+=`<h5>RESPONSE · ${esc(R.type||"")}${R.data_types&&R.data_types.length?" · data: "+esc(R.data_types.join(", ")):""}</h5>`;
    h+=(R.codes||[]).length?`<div>${R.codes.map(c=>`<div class="statusrow" style="margin-bottom:4px"><span class="stcode ${c.code==="00"||c.code==="600"?"ok":"err"}">${esc(c.code)}</span><span style="font-size:12px;align-self:center">${esc(c.meaning)}</span></div>`).join("")}</div>`:`<div style="font-size:12px;color:var(--muted)">No explicit response codes found in this endpoint's implementation.</div>`;
    if(e.downstream&&e.downstream.length) h+=`<h5>DOWNSTREAM · IN CALL ORDER</h5><ol style="padding-left:18px;font-family:var(--mono);font-size:11px;display:flex;flex-direction:column;gap:3px">${e.downstream.map(d=>`<li>${esc(d)}</li>`).join("")}</ol>`;
    if(e.writes&&e.writes.length) h+=`<h5>WRITES</h5><div class="chips">${e.writes.map(w=>`<span class="chip tbl">${esc(w)}</span>`).join("")}</div>`;
    if(e.notes&&e.notes.length) h+=`<h5>NOTES · FROM THE CODE</h5><ul style="padding-left:18px;font-size:12px">${e.notes.map(n=>`<li>${esc(n)}</li>`).join("")}</ul>`;
    h+=`<div style="margin-top:12px;font-size:11px;color:var(--muted)">${esc(e.file||"")} · <a href="#dmsdocs?s=${esc(e._sec.id)}" style="color:#0d9488" id="dfModalGo">open in the DMS API reference ↗</a></div></div>`;
    card.innerHTML=h; ov.classList.add("open");
    $("#dfModalX").addEventListener("click",()=>ov.classList.remove("open"));
    const go=$("#dfModalGo"); if(go) go.addEventListener("click",()=>ov.classList.remove("open"));
    if(window.audit) window.audit("VIEW_DMS_EP",(e.verb+" "+e.path).slice(0,60));
  }

  /* ---------- render ---------- */
  function render(){
    const host=$("#view-dmsflows"); if(!host||!SPEC) return;
    if(!host.querySelector("#dfNav")) host.innerHTML=`<div class="panel">
        <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap"><h2 style="margin:0">DMS journeys — step by step</h2>
          <div class="sub" style="margin:0">dealer app · CMS back-office · system — every journey as a data flow across services, from the decompiled production code (git tag v20260930-appdigp01). Endpoints open the API reference.</div></div>
        <div id="dfTop" class="dftop"></div>
        <div class="dfwrap">
          <aside id="dfNav" class="dfnav"></aside>
          <select id="dfSel" class="dfsel"></select>
          <div class="dfmain">
            <div class="modebar" style="margin:0 0 10px"><div class="toggle" id="dfMode"><button data-mode="success" class="on-success">✓ Success path</button><button data-mode="failure">✕ Failure mode</button></div>
              <div class="stepnav"><button id="dfPrev">‹ Prev</button><span class="counter" id="dfCounter">1 / 1</span><button id="dfNext">Next ›</button><button class="play" id="dfPlay">▶ Play</button></div></div>
            <div class="desc" id="dfDesc"></div>
            <div class="journey-grid"><div class="steplist" id="dfSteps"></div><div class="stage" id="dfStage"></div></div>
            <div id="dfFoot"></div></div></div></div>`+
      `<style>
        #view-dmsflows .dftop{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
        #view-dmsflows .dfseg{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--card)}
        #view-dmsflows .dfseg button{border:0;background:transparent;padding:7px 14px;font:inherit;font-size:12px;font-weight:700;color:var(--muted);cursor:pointer;display:flex;gap:6px;align-items:center}
        #view-dmsflows .dfseg button b{font-size:10px;background:var(--bg);border-radius:9px;padding:1px 6px;color:var(--muted)}
        #view-dmsflows .dfseg button.on{background:var(--ac);color:#fff}#view-dmsflows .dfseg button.on b{background:rgba(255,255,255,.25);color:#fff}
        #view-dmsflows .dfq{flex:1;min-width:200px;font:inherit;font-size:11.5px;padding:7px 11px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:inherit}
        #view-dmsflows .dfwrap{display:grid;grid-template-columns:270px minmax(0,1fr);gap:16px;align-items:start}
        #view-dmsflows .dfnav{position:sticky;top:70px;max-height:calc(100vh - 90px);overflow:auto;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:6px}
        #view-dmsflows .dfsel{display:none;width:100%;font:inherit;font-size:12.5px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:inherit;margin-bottom:10px}
        #view-dmsflows .dfgh{display:flex;gap:7px;align-items:center;padding:8px 8px 5px;font-size:10.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--muted);cursor:pointer;user-select:none}
        #view-dmsflows .dfgh .cdot{width:8px;height:8px;border-radius:50%}#view-dmsflows .dfgh .cnt{margin-left:auto;font-size:9.5px;background:var(--bg);border-radius:9px;padding:1px 6px}#view-dmsflows .dfgh .car{font-size:10px}
        #view-dmsflows .dfit{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:600;padding:6px 9px 6px 22px;border-radius:8px;cursor:pointer;line-height:1.3}
        #view-dmsflows .dfit:hover{background:var(--card2,rgba(148,163,184,.12))}
        #view-dmsflows .dfit.on{background:var(--green);color:#fff}#view-dmsflows .dfit.on .mono{color:rgba(255,255,255,.8)!important}
        #view-dmsflows .dfmain{min-width:0}
        @media (max-width:1100px){#view-dmsflows .dfwrap{grid-template-columns:230px minmax(0,1fr)}}
        @media (max-width:820px){#view-dmsflows .dfwrap{grid-template-columns:1fr}#view-dmsflows .dfnav{display:none}#view-dmsflows .dfsel{display:block}#view-dmsflows .journey-grid{grid-template-columns:1fr}#view-dmsflows .infocols{grid-template-columns:1fr}#view-dmsflows .stepnav{margin-left:0}#view-dmsflows .dfseg{width:100%}#view-dmsflows .dfseg button{flex:1;justify-content:center;padding:7px 6px}}
      </style>`;
    const J=journeys(); if(st.j>=J.length) st.j=0; const j=J[st.j];
    renderPicker();
    if(!j){ $("#dfDesc").innerHTML=""; $("#dfSteps").innerHTML=""; $("#dfStage").innerHTML=`<div class="rl">No journey selected.</div>`; $("#dfFoot").innerHTML=""; return; }
    if(st.s>=j.steps.length) st.s=0;
    const F=SPEC.families[j.family]||{};
    $("#dfDesc").innerHTML=`${esc(j.purpose)} &nbsp;·&nbsp; <b>Actor:</b> ${esc((SPEC.actors||{})[actorOf(j)]||actorOf(j))} &nbsp;·&nbsp; <b>Family:</b> ${esc(F.label||j.family)}${j.sanity&&j.sanity.length?` &nbsp;·&nbsp; <b>Sanity list:</b> #${esc(j.sanity.join(", #"))}`:""} &nbsp;·&nbsp; <span style="font-size:11px;color:var(--muted)">${esc(F.doc||"")}</span>${j.console?` &nbsp;·&nbsp; <a href="#dms" style="color:#0d9488" data-board="${esc(j.console)}">journeys board · ${esc(j.console)}</a>`:""} &nbsp;·&nbsp; <a href="#dmsdocs?j=${esc(j.key)}" style="color:#0d9488">all endpoints ↗</a>`;
    const L=$("#dfSteps"); L.innerHTML=j.steps.map((s,i)=>`<div class="stepitem ${i===st.s?"active":""}" data-s="${i}"><div class="idx">${i+1}</div><div class="nm">${esc(stepName(s))}</div><div class="id">${esc(String(s.ep||"").replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i,"").split(" ")[0].slice(0,36))}</div></div>`).join("");
    L.querySelectorAll("[data-s]").forEach(el=>el.addEventListener("click",()=>{ stop(); st.s=+el.dataset.s; render(); }));
    const S=$("#dfStage"); S.innerHTML=stepDetail(j,st.s,st.mode);
    $("#dfFoot").innerHTML=journeyFooter(j,st.mode);
    host.querySelectorAll("[data-dep]").forEach(n=>n.addEventListener("click",()=>openEndpoint(n.dataset.dep,n.dataset.verb)));
    $("#dfCounter").textContent=(st.s+1)+" / "+j.steps.length;
    const tg=$("#dfMode"); tg.querySelector('[data-mode="success"]').className=st.mode==="success"?"on-success":""; tg.querySelector('[data-mode="failure"]').className=st.mode==="failure"?"on-failure":"";
    if(window.setConsoleHash) window.setConsoleHash("dms-journeys?j="+j.key+"&s="+(st.s+1));
    if(!host._wired){ host._wired=true;
      $("#dfPrev").addEventListener("click",()=>{ stop(); if(st.s>0){ st.s--; render(); } });
      $("#dfNext").addEventListener("click",()=>{ stop(); const J2=journeys(); if(J2[st.j]&&st.s<J2[st.j].steps.length-1){ st.s++; render(); } });
      $("#dfPlay").addEventListener("click",()=>{ if(st.timer){ stop(); return; } $("#dfPlay").textContent="⏸ Pause"; st.timer=setInterval(()=>{ const J2=journeys(); if(J2[st.j]&&st.s<J2[st.j].steps.length-1){ st.s++; render(); $("#dfPlay").textContent="⏸ Pause"; } else stop(); },2600); });
      $("#dfMode").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ st.mode=b.dataset.mode; render(); }));
      host.addEventListener("click",ev=>{ const a=ev.target.closest("[data-board]"); if(a&&window.openDmsJourney){ setTimeout(()=>window.openDmsJourney(a.dataset.board),600); } });
    }
  }
  async function open(qs){
    const host=$("#view-dmsflows"); if(!host) return; qs=typeof qs==="string"?qs:"";
    if(!SPEC) host.innerHTML=`<div class="panel"><h2>DMS journeys — step by step</h2><div class="rl">Loading the journey spec…</div></div>`;
    await load();
    if(!SPEC){ host.innerHTML=`<div class="panel"><h2>DMS journeys</h2><div class="rl" style="color:var(--red,#dc2626)">The server does not expose /api/dms/journeys/spec (deploy pending?)</div></div>`; return; }
    const src=qs||(location.hash.split("?")[1]||""); const m=/(?:^|&)j=([a-z0-9_\-]+)/i.exec(src); if(m){ st.fam=""; st.q=""; const jj=(SPEC.journeys||[]).find(x=>x.key===m[1]); if(jj){ st.actor=actorOf(jj); st.fam="all"; const i=journeys().findIndex(x=>x.key===m[1]); st.j=i; const ms=/(?:^|&)s=(\d+)/.exec(src); st.s=ms?Math.max(0,+ms[1]-1):0; } }
    render();
  }
  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="dmsflows") b.addEventListener("click", open); });
  window.openDmsFlows=open;
})();
