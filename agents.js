/* agents.js — Settings › Agents (10 Sep 2026): the LLM layer (primary / fallback, on-prem) and the two PM2 agents
 *   · Agent 1 — log intelligence (salam-agent-log): signatures, assessments, daily reports
 *   · Agent 2 — incident operations (salam-agent-incident): triage notes, duplicates, flapping, policy
 * Standalone view (#view-agents, route #agents / #settings-agents), root tier only — same gate as Yusr's config.
 * API: /api/llm/*, /api/agents/* (agentsApi.js). Green-only navigation; dark mode via tokens; phone/iPad friendly. */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const API=window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{ if(!r.ok) return r.json().then(e=>{ throw new Error(e.error||("HTTP "+r.status)); }); return r.json(); });
  const md=iso=>{ if(!iso) return "—"; try{ return window.KT?KT.md(iso):new Date(iso).toLocaleString(); }catch(_){ return String(iso).slice(0,16); } };
  const ago=iso=>{ if(!iso) return "never"; const m=Math.round((Date.now()-new Date(iso).getTime())/60000); return m<1?"just now":m<60?m+" min ago":m<1440?Math.round(m/60)+" h ago":Math.round(m/1440)+" d ago"; };
  const n=v=>Number(v||0).toLocaleString("en-US");
  const pct=v=>v==null?"—":Math.round(Number(v))+"%";
  let OV=null, TAB="signatures", F={sig:{days:7,class:"all",status:"all",segment:"all",q:""},tri:{days:7,kind:"all",segment:"all",q:""}};
  const host=()=>document.getElementById("agentsHost");
  const $a=s=>{ const h=host(); return h?h.querySelector(s):null; };

  const CSS=`
  .ag-wrap{display:flex;flex-direction:column;gap:14px}
  .ag-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
  .ag-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;position:relative}
  .ag-card h3{margin:0 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
  .ag-big{font-size:26px;font-weight:800;color:var(--ink);line-height:1.1}
  .ag-sub{font-size:12px;color:var(--muted);margin-top:4px}
  .ag-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#94a3b8;margin-right:6px;vertical-align:middle}
  .ag-dot.on{background:var(--green);box-shadow:0 0 0 3px var(--green-bg)} .ag-dot.off{background:#dc2626}
  .ag-btn{border:none;border-radius:9px;padding:8px 13px;font-size:12.5px;font-weight:700;cursor:pointer;background:var(--green);color:#fff;display:inline-flex;align-items:center;gap:6px}
  .ag-btn:hover{background:var(--green-dark)} .ag-btn.o{background:transparent;color:var(--green);border:1px solid var(--green)} .ag-btn.o:hover{background:var(--green-bg)}
  .ag-btn.sm{padding:5px 9px;font-size:11.5px;border-radius:7px} .ag-btn[disabled]{opacity:.5;cursor:default}
  .ag-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:0}
  .ag-tab{background:transparent;border:none;border-bottom:3px solid transparent;padding:9px 12px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer}
  .ag-tab.on{color:var(--green);border-bottom-color:var(--green)}
  .ag-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}
  .ag-filters select,.ag-filters input,.ag-form select,.ag-form input{background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:12.5px;color:var(--ink)}
  .ag-filters input[type=search]{min-width:200px;flex:1}
  .ag-tablew{overflow:auto;border:1px solid var(--line);border-radius:12px}
  .ag-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:760px}
  .ag-table th{position:sticky;top:0;background:var(--card2);color:var(--muted);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
  .ag-table td{padding:8px 10px;border-bottom:1px solid var(--line-soft);vertical-align:top;color:var(--ink)}
  .ag-table tr:hover td{background:var(--green-bg)} .ag-table tr.sel td{background:var(--green-bg)}
  .ag-mono{font-family:ui-monospace,Menlo,monospace;font-size:11.5px}
  .ag-chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:700;border:1px solid var(--line);color:var(--ink-soft);background:var(--card2)}
  .ag-chip.tech{color:#b91c1c;border-color:var(--red-line)} .ag-chip.biz{color:#1d4ed8;border-color:var(--blue-line)} .ag-chip.g{color:var(--green);border-color:var(--green-line)} .ag-chip.a{color:#b45309;border-color:var(--amber-line)}
  .ag-detail{background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-top:10px;font-size:13px;line-height:1.55}
  .ag-detail dl{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;margin:8px 0} .ag-detail dt{color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em} .ag-detail dd{margin:0}
  .ag-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:8px} .ag-form label{font-size:11px;color:var(--muted);display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em}
  .ag-form input,.ag-form select{width:100%;box-sizing:border-box}
  .ag-note{font-size:12px;color:var(--muted);line-height:1.5}
  .ag-bar{height:7px;border-radius:6px;background:var(--card2,#e2e8f0);overflow:hidden}
  .ag-bar i{display:block;height:100%;border-radius:6px}
  .ag-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
  .ag-form label{display:flex;flex-direction:column;gap:3px;font-size:10.5px;font-weight:800;letter-spacing:.04em;color:var(--muted);text-transform:uppercase}
  .ag-form input,.ag-form select{font:inherit;font-size:12.5px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink);text-transform:none;letter-spacing:0;font-weight:600}
  .ag-in{font:inherit;font-size:12.5px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)}
  .ag-in.sm{padding:3px 7px;font-size:11.5px}
  .ag-tbl{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:4px}
  .ag-tbl th{text-align:left;font-size:9.5px;letter-spacing:.08em;color:var(--muted);padding:4px 8px;border-bottom:1px solid var(--line)}
  .ag-tbl td{padding:4px 8px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--ink)}
  .ag-rules{display:flex;flex-wrap:wrap;gap:6px;max-height:220px;overflow:auto;padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--card2)}
  .ag-rules label{display:inline-flex;gap:5px;align-items:center;font-size:12px;padding:3px 8px;border-radius:8px;border:1px solid var(--line);background:var(--card);cursor:pointer}
  .ag-rules label.on{border-color:var(--green);background:var(--green-bg)}
  .ag-pre{white-space:pre-wrap;font-size:13px;line-height:1.55}
  .ag-toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--panel-dark);color:var(--panel-dark-fg);padding:10px 16px;border-radius:10px;font-size:13px;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,.25)}
  @media(max-width:720px){ .ag-detail dl{grid-template-columns:1fr} .ag-tab{padding:8px 9px;font-size:12px} .ag-big{font-size:22px} }`;

  function ensureView(){
    let v=document.getElementById("view-agents"); if(v) return v;
    const st=document.createElement("style"); st.textContent=CSS; document.head.appendChild(st);
    const main=document.querySelector("main")||document.body;
    v=document.createElement("section"); v.id="view-agents"; v.className="view";
    v.innerHTML=`<div class="page-head"><h1>Agents &amp; LLM</h1><div class="sub">On-prem language models and the two autonomous services: <b>log intelligence</b> (signatures · daily report) and <b>incident operations</b> (triage · duplicates · policy). Nothing leaves the network.</div></div><div id="agentsHost" style="margin-top:12px"></div>`;
    main.appendChild(v); return v;
  }
  function toast(t){ const d=document.createElement("div"); d.className="ag-toast"; d.textContent=t; document.body.appendChild(d); setTimeout(()=>d.remove(),2600); }

  /* ------------------------------ overview ------------------------------ */
  async function render(){
    ensureView(); const h=host(); if(!h) return;
    h.innerHTML=`<div class="sub">Loading…</div>`;
    try{ OV=await api("/api/agents/overview"); }
    catch(e){
      if(/^restricted$/i.test(e.message||"")){ h.innerHTML=`<div class="panel" style="text-align:center;padding:34px 20px"><div style="font-size:26px">🔒</div><div style="font-weight:700;margin-top:6px">Root tier only</div><div class="sub">Agents and the LLM layer are configured by the console owners.</div></div>`; return; }
      h.innerHTML=`<div class="panel"><b>Could not load</b> — ${esc(e.message)}</div>`; return;
    }
    const L=OV.llm||{}, hp=(L.health||{}).primary||{}, hf=(L.health||{}).fallback||{}, A=OV.agents||{}, S=OV.signatures||{}, T=OV.triage||{};
    const prov=(name,p,hh)=>p?`<div class="ag-card"><h3>${name} · ${esc(p.kind)}</h3><div class="ag-big" style="font-size:18px"><span class="ag-dot ${hh.ok?"on":hh.configured===false?"":"off"}"></span>${esc(p.model)}</div>
        <div class="ag-sub ag-mono">${esc(p.url)}</div><div class="ag-sub">${hh.ok?`reachable · ${hh.ms} ms · model ${hh.modelAvailable?"installed":"<b style='color:#b91c1c'>NOT installed</b>"}`:`<b style="color:#b91c1c">${esc(hh.error||"unreachable")}</b>`}${p.keyed?" · key set":""} · timeout ${Math.round(p.timeoutMs/1000)} s</div></div>`
      :`<div class="ag-card"><h3>${name}</h3><div class="ag-sub">not configured — set it below to get automatic failover</div></div>`;
    const calls=(L.recent24h||[]).map(r=>`${esc(r.provider)}: ${r.ok}/${r.calls} ok · avg ${n(r.avg_ms)} ms${r.via_fallback?` · ${r.via_fallback} via fallback`:""}`).join("<br>")||"no calls in 24 h";
    const agent=(title,a,extra)=>`<div class="ag-card"><h3>${title}</h3><div class="ag-big" style="font-size:18px"><span class="ag-dot ${a.alive?"on":"off"}"></span>${a.alive?"running":"not running"}</div>
        <div class="ag-sub">last run ${ago(a.last&&a.last.started_at)}${a.last&&a.last.ok===false?` · <b style="color:#b91c1c">failed: ${esc(a.last.error||"")}</b>`:""} · ${a.d1.ok}/${a.d1.runs} runs ok in 24 h</div><div class="ag-sub">${extra}</div></div>`;
    h.innerHTML=`<div class="ag-wrap">
      <div class="panel"><h2>LLM layer</h2><div class="sub">Order: <b>${esc(L.order||"primary-first")}</b> · every call is audited (llm_calls) · a failed or slow primary fails over automatically.</div>
        <div class="ag-grid" style="margin-top:10px">${prov("Primary",L.primary,hp)}${prov("Fallback",L.fallback,hf)}<div class="ag-card"><h3>Calls · 24 h</h3><div class="ag-sub" style="font-size:12.5px;color:var(--ink)">${calls}</div>
          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><button class="ag-btn sm o" id="agProbe">Probe</button><button class="ag-btn sm o" id="agTest">Test call</button><button class="ag-btn sm o" id="agSelf" title="Four probes of growing size — tells you whether an empty answer is the context window, the JSON grammar, or a model that is not running">Self-test</button><button class="ag-btn sm o" id="agCfgT">Configure</button></div><div id="agSelfOut" style="margin-top:8px"></div></div></div></div>
        <div id="agCfg" hidden class="ag-detail"></div></div>
      <div class="ag-grid">
        ${agent("Agent 1 · Log intelligence",A.log||{alive:false,d1:{runs:0,ok:0}},`${n(S.total)} signatures · <b>${n(S.new24)}</b> new 24 h · ${n(S.events24)} events 24 h · ${n(S.tech24)} technical`)}
        <div class="ag-card"><h3>To review</h3><div class="ag-big">${n(S.to_review)}</div><div class="ag-sub">assessed signatures awaiting a human decision · ${n(S.unassessed)} not yet assessed</div></div>
        ${agent("Agent 2 · Incident operations",A.incident||{alive:false,d1:{runs:0,ok:0}},`${n(T.d1)} triaged 24 h · ${n(T.dup24)} duplicates · ${n(T.flap24)} flapping · mode <b>${esc((OV.policy||{}).mode||"advise")}</b>`)}
        <div class="ag-card"><h3>Triage quality</h3><div class="ag-big">${T.helpful+T.unhelpful?Math.round(100*T.helpful/(T.helpful+T.unhelpful))+"%":"—"}</div><div class="ag-sub">rated helpful (${n(T.helpful)} 👍 · ${n(T.unhelpful)} 👎) · avg confidence ${pct(T.avg_conf)} · ${n(T.applied)} policy actions · ${n(T.avg_ms)} ms avg</div></div>
      </div>
      <div class="panel" style="padding-top:10px">
        <div class="ag-tabs">${[["signatures","Signatures"],["triage","Triage notes"],["reports","Daily reports"],["policy","Policy"],["budget","AI usage & budget"],["calls","LLM calls"]].map(t=>`<button class="ag-tab ${TAB===t[0]?"on":""}" data-t="${t[0]}">${t[1]}</button>`).join("")}
          <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;padding:6px 0"><button class="ag-btn sm o" data-run="log">Run log agent now</button><button class="ag-btn sm o" data-run="incident">Triage open incidents now</button><button class="ag-btn sm o" data-run="report">Build &amp; mail daily report</button></span></div>
        <div id="agTabBody"></div></div></div>`;
    h.querySelectorAll(".ag-tab").forEach(b=>b.addEventListener("click",()=>{ TAB=b.dataset.t; h.querySelectorAll(".ag-tab").forEach(x=>x.classList.toggle("on",x===b)); renderTab(); }));
    h.querySelectorAll("[data-run]").forEach(b=>b.addEventListener("click",async()=>{ const w=b.dataset.run; if(w==="report"&&!confirm("Build the daily log report now and mail it to the Mail-report audience?")) return;
      b.disabled=true; b.textContent="Running…"; try{ const r=await api("/api/agents/run/"+w,{method:"POST",body:"{}"}); toast(w+" done: "+JSON.stringify(r.result).slice(0,140)); render(); }catch(e){ toast("Failed: "+e.message); b.disabled=false; } }));
    const probe=$a("#agProbe"); if(probe) probe.addEventListener("click",async()=>{ probe.disabled=true; try{ await api("/api/llm/probe",{method:"POST",body:"{}"}); render(); }catch(e){ toast(e.message); probe.disabled=false; } });
    /* SELF-TEST (11 Sep 2026): why the agents get "no answer" — context window vs JSON grammar vs model not running */
    const self=$a("#agSelf"); if(self) self.addEventListener("click",async()=>{
      self.disabled=true; const old=self.textContent; self.textContent="Probing…";
      try{ const r=await api("/api/llm/selftest",{method:"POST",body:JSON.stringify({provider:"primary"})});
        const host=$a("#agSelfOut");
        if(host) host.innerHTML = !r.configured ? `<div class="ag-note">No primary model configured.</div>`
          : `<div class="ag-note" style="border-left:3px solid ${r.probes.every(x=>x.ok)?"var(--green,#0e9f5a)":"#d97706"};padding-left:10px">
              <b>${esc(r.model||"")}</b> · ${esc(r.url||"")} · prompt cap ${r.prompt_cap} chars<br><b>${esc(r.verdict)}</b>
              <table class="ag-tbl" style="margin-top:6px"><tr><th>PROBE</th><th>ANSWERED</th><th>MS</th><th>DETAIL</th></tr>
              ${r.probes.map(x=>`<tr><td>${esc(x.name)}</td><td style="color:${x.ok?"var(--green,#0e9f5a)":"#dc2626"};font-weight:800">${x.ok?"yes":"no"}</td><td>${x.ms}</td><td style="max-width:420px;word-break:break-word">${esc(x.error||x.answer||"")}</td></tr>`).join("")}</table></div>`;
        else toast(r.verdict||"done");
      }catch(e){ toast(e.message); }
      self.disabled=false; self.textContent=old; });
    const test=$a("#agTest"); if(test) test.addEventListener("click",async()=>{ test.disabled=true; test.textContent="Asking…"; try{ const r=await api("/api/llm/test",{method:"POST",body:"{}"}); toast(`${r.provider} · ${r.model} · ${r.ms} ms${r.fallback?" (fallback)":""}: ${r.text}`); }catch(e){ toast(e.message); } test.disabled=false; test.textContent="Test call"; });
    const cfgT=$a("#agCfgT"); if(cfgT) cfgT.addEventListener("click",()=>{ const c=$a("#agCfg"); c.hidden=!c.hidden; if(!c.hidden) renderCfg(); });
    renderTab();
  }

  function renderCfg(){
    const c=$a("#agCfg"), L=OV.llm||{}, p=L.primary||{}, f=L.fallback||{};
    const fld=(pre,o,ro)=>`<div><label>Kind</label><select data-k="${pre}.kind" ${ro?"disabled":""}><option value="ollama" ${o.kind!=="openai"?"selected":""}>Ollama (/api/chat)</option><option value="openai" ${o.kind==="openai"?"selected":""}>OpenAI-compatible (vLLM · llama.cpp · LM Studio)</option></select></div>
      <div><label>URL</label><input data-k="${pre}.url" value="${esc(o.url||"")}" placeholder="http://host:port" ${ro?"disabled":""}></div><div><label>Model</label><input data-k="${pre}.model" value="${esc(o.model||"")}" ${ro?"disabled":""}></div>
      <div><label>API key (optional)</label><input data-k="${pre}.key" type="password" placeholder="${o.keyed?"••••• (set)":"none"}" ${ro?"disabled":""}></div><div><label>Timeout (s)</label><input data-k="${pre}.timeoutMs" type="number" min="5" max="300" value="${Math.round((o.timeoutMs||75000)/1000)}" ${ro?"disabled":""}></div>`;
    c.innerHTML=`<b>Primary</b> <span class="ag-note">— comes from .env (LLM_PRIMARY_* or OLLAMA_URL/OLLAMA_MODEL) or Yusr's settings; override here only if you must.</span><div class="ag-form">${fld("primary",p,false)}</div>
      <b style="display:block;margin-top:12px">Fallback</b> <span class="ag-note">— a second on-prem engine (GPU VM with vLLM, a second Ollama, llama.cpp server). Leave URL empty for none.</span><div class="ag-form">${fld("fallback",f,false)}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap"><label class="ag-note">Order <select id="agOrder"><option value="primary-first" ${L.order!=="fallback-first"?"selected":""}>primary first</option><option value="fallback-first" ${L.order==="fallback-first"?"selected":""}>fallback first (maintenance)</option></select></label>
      <button class="ag-btn" id="agCfgSave">Save &amp; probe</button><span class="ag-note">Saved in the console DB (settings key <code>llm</code>); the agents pick it up within 30 s, no restart.</span></div>`;
    $a("#agCfgSave").addEventListener("click",async()=>{
      const get=k=>{ const el=c.querySelector(`[data-k="${k}"]`); return el?el.value.trim():""; };
      const body={ order:$a("#agOrder").value };
      for(const pre of ["primary","fallback"]){ const url=get(pre+".url"); body[pre]=url?{kind:get(pre+".kind"),url,model:get(pre+".model"),timeoutMs:Number(get(pre+".timeoutMs"))*1000||undefined}:null; const key=get(pre+".key"); if(key) body[pre].key=key; }
      try{ await api("/api/llm/config",{method:"PUT",body:JSON.stringify(body)}); toast("LLM configuration saved"); render(); }catch(e){ toast("Not saved: "+e.message); }
    });
  }

  /* ------------------------------ tabs ------------------------------ */
  /* ---------------------- AI usage & budget (11 Sep 2026) ----------------------
   * Tokens per person and per agent, per KSA day, against a ceiling anyone can see. Humans and machines are
   * budgeted separately so an agent storm can never eat a person's allowance. */
  let BU={days:14};
  const tk=v=>v==null?"—":v>=1e6?(v/1e6).toFixed(2)+"M":v>=1e3?(v/1e3).toFixed(1)+"k":String(v);
  const bar=(pct,cap)=>{ const p=Math.max(0,Math.min(1,pct||0)); const col=!cap?"var(--muted)":p>=1?"#dc2626":p>=0.8?"#d97706":"var(--green,#0e9f5a)";
    return `<div class="ag-bar"><i style="width:${(p*100).toFixed(1)}%;background:${col}"></i></div>`; };
  function usageChart(rows){
    const W=720,H=110,pad=18; if(!rows.length) return `<div class="ag-sub">No calls in this period.</div>`;
    const max=Math.max(1,...rows.map(r=>r.tokens));
    const bw=Math.max(4,(W-2*pad)/rows.length-3);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:110px">
      ${rows.map((r,i)=>{ const x=pad+i*((W-2*pad)/rows.length); const h=(r.tokens/max)*(H-28); const ha=(r.agent_tokens/max)*(H-28);
        return `<g><title>${esc(String(r.day).slice(0,10))}: ${r.tokens.toLocaleString()} tokens (${r.agent_tokens.toLocaleString()} agents) · ${r.calls} calls</title>
          <rect x="${x.toFixed(1)}" y="${(H-12-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,h).toFixed(1)}" fill="#2563eb" opacity=".85" rx="2"/>
          <rect x="${x.toFixed(1)}" y="${(H-12-ha).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,ha).toFixed(1)}" fill="#7c3aed" opacity=".9" rx="2"/></g>`; }).join("")}
      <line x1="${pad}" y1="${H-12}" x2="${W-pad}" y2="${H-12}" stroke="var(--line)" stroke-width="1"/></svg>
      <div class="ag-sub" style="display:flex;gap:14px;flex-wrap:wrap"><span><i style="display:inline-block;width:9px;height:9px;background:#2563eb;border-radius:2px"></i> all calls</span><span><i style="display:inline-block;width:9px;height:9px;background:#7c3aed;border-radius:2px"></i> agents</span><span>peak ${tk(max)} tokens/day</span></div>`;
  }
  async function tabBudget(b){
    b.innerHTML=`<div class="sub" style="padding:12px 0">Loading usage…</div>`;
    let U; try{ U=await api(`/api/llm/usage?days=${BU.days}`); }catch(e){ b.innerHTML=`<div class="sub">${esc(e.message)}</div>`; return; }
    const B=U.budget||{}, cur=(B.price&&B.price.currency)||"SAR";
    const cost=U.byProvider.reduce((a,r)=>a+Number(r.cost||0),0);
    const row=(r,kind)=>`<tr data-subj="${esc(r.subject)}">
      <td><b>${esc(String(r.subject).split("@")[0])}</b><div class="ag-sub ag-mono">${esc(r.subject)}</div></td>
      <td style="min-width:170px">${bar(r.pct,r.cap)}<div class="ag-sub">${tk(r.today)} of ${r.cap?tk(r.cap):"∞"} today${r.cap?` · ${Math.round(r.pct*100)} %`:""}</div></td>
      <td><b>${tk(r.tokens)}</b><div class="ag-sub">${U.days} d</div></td>
      <td>${n(r.calls)}${r.blocked?`<div class="ag-sub" style="color:#dc2626">${r.blocked} refused</div>`:""}${r.failed?`<div class="ag-sub">${r.failed} failed</div>`:""}</td>
      <td>${Number(r.cost)>0?`${Number(r.cost).toFixed(2)} ${esc(cur)}`:'<span class="ag-sub">on-prem</span>'}</td>
      <td class="ag-sub">${md(r.last_at)}</td>
      <td><input class="ag-in sm" data-cap="${esc(r.subject)}" data-kind="${kind}" type="number" min="0" step="1000" value="${r.cap||0}" style="width:110px" title="0 = no ceiling for this ${kind==="user"?"person":"agent"}"></td></tr>`;
    b.innerHTML=`
      <div class="ag-filters"><select data-f="days">${[7,14,30,90].map(x=>`<option value="${x}" ${x==BU.days?"selected":""}>last ${x} days</option>`).join("")}</select>
        <span class="ag-sub">Budgets reset at 00:00 KSA. Tokens are what the model actually processes — measured when the provider reports them, otherwise estimated from characters.</span></div>
      <div class="ag-grid" style="margin-bottom:12px">
        <div class="ag-card"><h3>Console today</h3><div class="ag-big">${tk(U.today.tokens)}</div>${bar(U.today.pct,U.today.cap)}<div class="ag-sub">of ${U.today.cap?tk(U.today.cap):"∞"} tokens · ${n(U.today.calls)} calls</div></div>
        <div class="ag-card"><h3>This month</h3><div class="ag-big">${tk(U.month.tokens)}</div>${bar(U.month.pct,U.month.cap)}<div class="ag-sub">of ${U.month.cap?tk(U.month.cap):"∞"} tokens</div></div>
        <div class="ag-card"><h3>People</h3><div class="ag-big">${U.users.length}</div><div class="ag-sub">used AI in ${U.days} days · top ${esc(U.users[0]?String(U.users[0].subject).split("@")[0]:"—")} ${U.users[0]?tk(U.users[0].tokens):""}</div></div>
        <div class="ag-card"><h3>Cost</h3><div class="ag-big">${cost>0?cost.toFixed(2)+" "+esc(cur):"0"}</div><div class="ag-sub">${cost>0?"cloud / GPU fallback only":"everything ran on-prem — no external cost"}</div></div>
      </div>
      <div class="ag-detail"><b>Tokens per day</b>${usageChart(U.byDay)}</div>
      <h3 style="margin:16px 0 4px;font-size:13px">People</h3>
      ${U.users.length?`<div class="ag-tablew"><table class="ag-table"><thead><tr><th>User</th><th>Today vs ceiling</th><th>Tokens</th><th>Calls</th><th>Cost</th><th>Last</th><th>Daily ceiling</th></tr></thead><tbody>${U.users.map(r=>row(r,"user")).join("")}</tbody></table></div>`:`<div class="ag-sub">Nobody used Yusr in this period.</div>`}
      <h3 style="margin:16px 0 4px;font-size:13px">Agents (services)</h3>
      ${U.agents.length?`<div class="ag-tablew"><table class="ag-table"><thead><tr><th>Service</th><th>Today vs ceiling</th><th>Tokens</th><th>Calls</th><th>Cost</th><th>Last</th><th>Daily ceiling</th></tr></thead><tbody>${U.agents.map(r=>row(r,"caller")).join("")}</tbody></table></div>`:`<div class="ag-sub">No agent calls in this period.</div>`}
      <div class="ag-detail" style="margin-top:16px"><b>Budget</b>
        <div class="ag-form" style="margin-top:8px">
          <label>Budgets on<select id="bEn"><option value="1" ${B.enabled!==false?"selected":""}>on — meter and enforce</option><option value="0" ${B.enabled===false?"selected":""}>off — meter only</option></select></label>
          <label>Over the ceiling<select id="bBlk"><option value="1" ${B.block!==false?"selected":""}>refuse further AI calls until midnight</option><option value="0" ${B.block===false?"selected":""}>warn only, never refuse</option></select></label>
          <label>First warning at<select id="bWarn">${[0.5,0.6,0.7,0.8,0.9].map(x=>`<option value="${x}" ${Number(B.warnAt)===x?"selected":""}>${x*100} %</option>`).join("")}</select></label>
          <label>Per user · tokens/day<input id="bUser" class="ag-in" type="number" min="0" step="1000" value="${B.dailyUser||0}"></label>
          <label>Per agent · tokens/day<input id="bCaller" class="ag-in" type="number" min="0" step="1000" value="${B.dailyCaller||0}"></label>
          <label>Whole console · tokens/day<input id="bGlobal" class="ag-in" type="number" min="0" step="10000" value="${B.dailyGlobal||0}"></label>
          <label>Whole console · tokens/month<input id="bMonth" class="ag-in" type="number" min="0" step="100000" value="${B.monthlyGlobal||0}"></label>
          <label>Mail the person at the warning<select id="bNU"><option value="1" ${B.notifyUser!==false?"selected":""}>yes</option><option value="0" ${B.notifyUser===false?"selected":""}>no</option></select></label>
          <label>Mail super admins<select id="bNA"><option value="1" ${B.notifyAdmins!==false?"selected":""}>yes</option><option value="0" ${B.notifyAdmins===false?"selected":""}>no</option></select></label>
          <label>Cost per 1k tokens · primary<input id="bP1" class="ag-in" type="number" min="0" step="0.001" value="${(B.price&&B.price.primary)||0}"></label>
          <label>Cost per 1k tokens · fallback<input id="bP2" class="ag-in" type="number" min="0" step="0.001" value="${(B.price&&B.price.fallback)||0}"></label>
          <label>Currency<input id="bCur" class="ag-in" value="${esc(cur)}" style="width:90px"></label>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="ag-btn sm" id="bSave">Save budget</button><span class="ag-sub" id="bMsg">0 = no ceiling. A refused call is never an error for the user: Yusr answers from the rule engine and the agents write their measured-evidence note.</span></div></div>
      ${(U.events||[]).length?`<div class="ag-detail" style="margin-top:12px"><b>Budget notifications</b><div class="ag-tablew"><table class="ag-table"><thead><tr><th>When</th><th>Subject</th><th>Threshold</th><th>Used</th><th>Ceiling</th><th>Mailed</th></tr></thead><tbody>${U.events.map(e=>`<tr><td class="ag-sub">${md(e.at)}</td><td>${esc(e.subject)} <span class="ag-chip">${esc(e.kind)}</span></td><td><span class="ag-chip ${e.threshold==="over"?"a":""}">${e.threshold==="over"?"ceiling reached":"warning"}</span></td><td>${tk(Number(e.used))}</td><td>${tk(Number(e.cap))}</td><td class="ag-sub">${esc(e.mailed_to||"—")}</td></tr>`).join("")}</tbody></table></div></div>`:""}`;
    b.querySelector("[data-f=days]").addEventListener("change",e=>{ BU.days=Number(e.target.value); tabBudget(b); });
    const save=async(patch,msg)=>{ const m=b.querySelector("#bMsg"); if(m) m.textContent="Saving…";
      try{ await api("/api/llm/budget",{method:"PUT",body:JSON.stringify(patch)}); toast(msg||"Budget saved"); tabBudget(b); }
      catch(e){ toast(e.message); if(m) m.textContent=e.message; } };
    b.querySelectorAll("[data-cap]").forEach(inp=>inp.addEventListener("change",()=>{
      const key=inp.dataset.kind==="user"?"perUser":"perCaller"; const cur2={...(B[key]||{})};
      const v=Number(inp.value)||0; const subj=inp.dataset.cap;
      if(v===Number(inp.dataset.kind==="user"?B.dailyUser:B.dailyCaller)) delete cur2[subj]; else cur2[subj]=v;
      save({[key]:cur2}, `Ceiling for ${subj.split("@")[0]} set to ${v?tk(v)+" tokens/day":"the default"}`);
    }));
    b.querySelector("#bSave").addEventListener("click",()=>save({
      enabled:b.querySelector("#bEn").value==="1", block:b.querySelector("#bBlk").value==="1", warnAt:Number(b.querySelector("#bWarn").value),
      dailyUser:Number(b.querySelector("#bUser").value)||0, dailyCaller:Number(b.querySelector("#bCaller").value)||0,
      dailyGlobal:Number(b.querySelector("#bGlobal").value)||0, monthlyGlobal:Number(b.querySelector("#bMonth").value)||0,
      notifyUser:b.querySelector("#bNU").value==="1", notifyAdmins:b.querySelector("#bNA").value==="1",
      price:{primary:Number(b.querySelector("#bP1").value)||0, fallback:Number(b.querySelector("#bP2").value)||0, currency:b.querySelector("#bCur").value.trim()||"SAR"},
    }));
  }

  function renderTab(){ const b=$a("#agTabBody"); if(!b) return; b.innerHTML=`<div class="sub" style="padding:12px 0">Loading…</div>`; ({signatures:tabSig,triage:tabTri,reports:tabRep,policy:tabPol,budget:tabBudget,calls:tabCalls}[TAB]||tabSig)(b); }
  const filt=(b,defs,onchange)=>{ const d=document.createElement("div"); d.className="ag-filters"; d.innerHTML=defs; b.appendChild(d); d.querySelectorAll("select,input").forEach(el=>el.addEventListener(el.type==="search"?"input":"change",()=>onchange(d))); return d; };
  const daysSel=v=>`<select data-f="days">${[1,3,7,14,30,90].map(x=>`<option value="${x}" ${x==v?"selected":""}>${x} day${x>1?"s":""}</option>`).join("")}</select>`;
  const segSel=v=>`<select data-f="segment"><option value="all" ${v==="all"?"selected":""}>Both businesses</option><option value="mvno" ${v==="mvno"?"selected":""}>Mobile</option><option value="fixed" ${v==="fixed"?"selected":""}>Fixed</option></select>`;
  const read=(d,F)=>{ d.querySelectorAll("[data-f]").forEach(el=>F[el.dataset.f]=el.value); };

  async function tabSig(b){
    b.innerHTML=""; const f=F.sig;
    filt(b,`${daysSel(f.days)}${segSel(f.segment)}<select data-f="class"><option value="all">All classes</option><option value="technical" ${f.class==="technical"?"selected":""}>Technical</option><option value="business" ${f.class==="business"?"selected":""}>Business</option></select>
      <select data-f="status">${["all","new","assessed","reviewed","known","ignored","ticketed"].map(s=>`<option value="${s}" ${f.status===s?"selected":""}>${s==="all"?"All statuses":s}</option>`).join("")}</select><input type="search" data-f="q" value="${esc(f.q)}" placeholder="Search endpoint · code · pattern · category · owner">`,d=>{ read(d,f); load(); });
    const w=document.createElement("div"); b.appendChild(w); const det=document.createElement("div"); b.appendChild(det);
    let rows=[];
    async function load(){ w.innerHTML=`<div class="sub">Loading…</div>`; det.innerHTML="";
      try{ rows=(await api(`/api/agents/signatures?days=${f.days}&class=${f.class}&status=${f.status}&segment=${f.segment}&q=${encodeURIComponent(f.q)}`)).signatures; }catch(e){ w.innerHTML=`<div class="sub">${esc(e.message)}</div>`; return; }
      if(!rows.length){ w.innerHTML=`<div class="sub" style="padding:14px 0">No signatures for this filter. ${OV.agents.log&&OV.agents.log.alive?"":"Agent 1 is not running — check <code>pm2 logs salam-agent-log</code>."}</div>`; return; }
      w.innerHTML=`<div class="ag-tablew"><table class="ag-table"><thead><tr><th>Endpoint / source</th><th>Code</th><th>Pattern</th><th>24 h</th><th>Total</th><th>Class</th><th>Category</th><th>Sev</th><th>Owner</th><th>Status</th><th>Last seen</th></tr></thead><tbody>${rows.map(r=>`<tr data-id="${r.id}"><td class="ag-mono">${esc(r.endpoint||r.source)}<div class="ag-sub">${esc(r.source)} · ${r.segment==="fixed"?"Fixed":"Mobile"}</div></td><td class="ag-mono">${esc(r.code||"—")}</td><td style="max-width:360px">${esc(String(r.message_pattern||"").slice(0,140))}</td><td><b>${n(r.last_24h)}</b></td><td>${n(r.total)}</td><td>${r.class?`<span class="ag-chip ${r.class==="technical"?"tech":"biz"}">${esc(r.class)}</span>`:"<span class='ag-chip'>pending</span>"}</td><td>${esc(r.category||"—")}</td><td>${esc(r.severity_hint||"—")}</td><td>${esc(r.owner_team||"—")}</td><td><span class="ag-chip ${r.status==="reviewed"||r.status==="known"?"g":r.status==="new"?"a":""}">${esc(r.status)}</span></td><td class="ag-sub">${md(r.last_seen)}</td></tr>`).join("")}</tbody></table></div>`;
      w.querySelectorAll("tr[data-id]").forEach(tr=>tr.addEventListener("click",()=>{ w.querySelectorAll("tr").forEach(x=>x.classList.toggle("sel",x===tr)); detail(rows.find(r=>String(r.id)===tr.dataset.id)); }));
    }
    function detail(r){ if(!r) return;
      det.innerHTML=`<div class="ag-detail"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>Signature #${r.id} · ${esc(r.endpoint||r.source)} · ${esc(r.code||"")}</b><span class="ag-sub">first ${md(r.first_seen)} · last ${md(r.last_seen)} · hosts ${esc((r.hosts||[]).join(", ")||"—")}</span></div>
        <dl><dt>Pattern</dt><dd class="ag-mono">${esc(r.message_pattern)}</dd><dt>Sample</dt><dd class="ag-mono" style="white-space:pre-wrap">${esc(r.sample||"")}</dd>
        <dt>Assessment</dt><dd>${r.assessed_at?`<span class="ag-chip ${r.class==="technical"?"tech":"biz"}">${esc(r.class)}</span> ${esc(r.category)} · ${esc(r.severity_hint)} · confidence ${pct((r.confidence||0)*100)} · by ${esc(r.assessed_by)} ${md(r.assessed_at)}`:"not assessed yet"}</dd>
        <dt>Probable cause</dt><dd>${esc(r.probable_cause||"—")}</dd><dt>Runbook</dt><dd>${esc(r.runbook||"—")}</dd>${r.reviewed_by?`<dt>Reviewed</dt><dd>${esc(r.reviewed_by)} · ${md(r.reviewed_at)}</dd>`:""}</dl>
        <div class="ag-form"><div><label>Status</label><select id="agSigSt">${["new","assessed","reviewed","known","ignored","ticketed"].map(s=>`<option ${r.status===s?"selected":""}>${s}</option>`).join("")}</select></div><div><label>Class</label><select id="agSigCl"><option value="">keep</option><option value="technical">technical</option><option value="business">business</option></select></div>
        <div><label>Owner team</label><input id="agSigOw" value="${esc(r.owner_team||"")}"></div><div style="grid-column:1/-1"><label>Note</label><input id="agSigNo" value="${esc(r.note||"")}" placeholder="Why known / ignored · ticket number · what was fixed"></div></div>
        <div style="margin-top:10px;display:flex;gap:8px"><button class="ag-btn" id="agSigSave">Save review</button><button class="ag-btn o" id="agSigClose">Close</button></div></div>`;
      det.querySelector("#agSigSave").addEventListener("click",async()=>{ try{ await api("/api/agents/signatures/"+r.id,{method:"PUT",body:JSON.stringify({status:det.querySelector("#agSigSt").value,class:det.querySelector("#agSigCl").value||undefined,owner_team:det.querySelector("#agSigOw").value,note:det.querySelector("#agSigNo").value})}); toast("Review saved"); load(); }catch(e){ toast(e.message); } });
      det.querySelector("#agSigClose").addEventListener("click",()=>{ det.innerHTML=""; });
      det.scrollIntoView({behavior:"smooth",block:"nearest"});
    }
    load();
  }

  async function tabTri(b){
    b.innerHTML=""; const f=F.tri;
    filt(b,`${daysSel(f.days)}${segSel(f.segment)}<select data-f="kind"><option value="all">All kinds</option>${["triage","duplicate","flapping"].map(k=>`<option ${f.kind===k?"selected":""}>${k}</option>`).join("")}</select><input type="search" data-f="q" value="${esc(f.q)}" placeholder="Search alert · rule · cause · team">`,d=>{ read(d,f); load(); });
    const w=document.createElement("div"); b.appendChild(w);
    async function load(){ w.innerHTML=`<div class="sub">Loading…</div>`; let rows=[];
      try{ rows=(await api(`/api/agents/triage?days=${f.days}&kind=${f.kind}&segment=${f.segment}&q=${encodeURIComponent(f.q)}`)).triage; }catch(e){ w.innerHTML=`<div class="sub">${esc(e.message)}</div>`; return; }
      if(!rows.length){ w.innerHTML=`<div class="sub" style="padding:14px 0">No triage notes yet. ${OV.agents.incident&&OV.agents.incident.alive?"The agent adds one to every new open incident within a few minutes.":"Agent 2 is not running — check <code>pm2 logs salam-agent-incident</code>."}</div>`; return; }
      w.innerHTML=`<div class="ag-tablew"><table class="ag-table"><thead><tr><th>Incident</th><th>Kind</th><th>Probable cause · impact</th><th>Team</th><th>First action</th><th>Conf.</th><th>History</th><th>Outcome</th><th>When</th><th>Rate</th></tr></thead><tbody>${rows.map(r=>`<tr>
        <td><a href="#${r.segment==="fixed"?"fixed-alerts":"alerts"}?id=${r.alert_id}" style="color:var(--green);font-weight:700;text-decoration:none">#${r.alert_id}</a> <span class="ag-chip ${r.severity==="P1"?"tech":r.severity==="P2"?"a":""}">${esc(r.severity||"")}</span><div class="ag-sub" style="max-width:220px">${esc(r.name||r.rule_key||"")}</div></td>
        <td><span class="ag-chip ${r.kind==="duplicate"?"a":r.kind==="flapping"?"tech":"g"}">${esc(r.kind)}</span>${r.duplicate_of?`<div class="ag-sub">of #${r.duplicate_of}</div>`:""}${r.applied&&Object.keys(r.applied).length?`<div class="ag-sub">policy: ${esc(JSON.stringify(r.applied))}</div>`:""}</td>
        <td style="max-width:340px">${esc(r.probable_cause||"—")}${r.impact?`<div class="ag-sub">${esc(r.impact)}</div>`:""}</td><td>${esc(r.suggested_team||"—")}</td><td style="max-width:260px">${esc(r.suggested_action||"—")}</td><td>${r.confidence!=null?pct(r.confidence*100):"—"}${r.priority_hint?`<div class="ag-sub">${esc(r.priority_hint)}</div>`:""}</td>
        <td class="ag-sub">${n(r.similar_30d)}× / 30 d${r.median_life_min!=null?`<br>median ${r.median_life_min} min`:""}</td><td class="ag-sub">${esc(r.alert_status||"")}${r.ack_by?`<br>ack ${esc(String(r.ack_by).split("@")[0])}`:""}${r.team?`<br>team ${esc(r.team)}`:""}</td><td class="ag-sub">${md(r.created_at)}<br>${n(r.ms)} ms</td>
        <td style="white-space:nowrap"><button class="ag-btn sm ${r.helpful===true?"":"o"}" data-fb="1" data-id="${r.id}" title="Helpful">👍</button> <button class="ag-btn sm ${r.helpful===false?"":"o"}" data-fb="0" data-id="${r.id}" title="Not helpful">👎</button></td></tr>`).join("")}</tbody></table></div>`;
      w.querySelectorAll("[data-fb]").forEach(bt=>bt.addEventListener("click",async()=>{ try{ await api(`/api/agents/triage/${bt.dataset.id}/feedback`,{method:"PUT",body:JSON.stringify({helpful:bt.dataset.fb==="1"})}); load(); }catch(e){ toast(e.message); } }));
    }
    load();
  }

  async function tabRep(b){
    let reps=[]; try{ reps=(await api("/api/agents/reports")).reports; }catch(e){ b.innerHTML=`<div class="sub">${esc(e.message)}</div>`; return; }
    if(!reps.length){ b.innerHTML=`<div class="sub" style="padding:14px 0">No daily report yet — the first one is built at the report hour (06:00 KSA) or with “Build &amp; mail daily report”.</div>`; return; }
    b.innerHTML=`<div class="ag-tablew" style="margin-top:10px"><table class="ag-table" style="min-width:600px"><thead><tr><th>#</th><th>Kind</th><th>Period (KSA)</th><th>Mailed to</th><th>Morning note</th></tr></thead><tbody>${reps.map(r=>`<tr data-id="${r.id}"><td>${r.id}</td><td>${esc(r.kind)}</td><td class="ag-sub">${md(r.period_start)} → ${md(r.period_end)}</td><td>${n(r.mailed_to)}</td><td class="ag-sub" style="max-width:520px">${esc(String(r.narrative||"").slice(0,160))}</td></tr>`).join("")}</tbody></table></div><div id="agRep"></div>`;
    b.querySelectorAll("tr[data-id]").forEach(tr=>tr.addEventListener("click",async()=>{ const d=b.querySelector("#agRep"); d.innerHTML=`<div class="sub">Loading…</div>`;
      try{ const r=await api("/api/agents/reports/"+tr.dataset.id); const s=r.summary||{};
        d.innerHTML=`<div class="ag-detail"><b>Report #${r.id}</b> · ${md(r.period_start)} → ${md(r.period_end)} KSA<div class="ag-pre" style="margin:8px 0 12px">${esc(r.narrative||"")}</div>
          <div class="ag-tablew"><table class="ag-table" style="min-width:600px"><thead><tr><th>Endpoint</th><th>Code</th><th>24 h</th><th>Class</th><th>Category</th><th>Probable cause</th><th>Owner</th></tr></thead><tbody>${(s.top||[]).slice(0,20).map(t=>`<tr><td class="ag-mono">${esc(t.endpoint||t.source)}</td><td class="ag-mono">${esc(t.code||"")}</td><td>${n(t.last_24h)}</td><td>${esc(t.class||"")}</td><td>${esc(t.category||"")}</td><td>${esc(t.probable_cause||"")}</td><td>${esc(t.owner_team||"")}</td></tr>`).join("")}</tbody></table></div>
          <div class="ag-sub" style="margin-top:8px">${(s.fresh||[]).length} new signatures · ${n(s.signatures_total)} known · alerts by severity: ${(s.alerts||[]).map(a=>`${a.severity} ${a.n} (${a.acked} acked)`).join(" · ")||"—"}</div></div>`; }
      catch(e){ d.innerHTML=`<div class="sub">${esc(e.message)}</div>`; } }));
  }

  async function tabPol(b){
    let d; try{ d=await api("/api/agents/policy"); }catch(e){ b.innerHTML=`<div class="sub">${esc(e.message)}</div>`; return; }
    const P=d.policy, rules=d.rules||[];
    const chips=(id,sel)=>`<div class="ag-rules" id="${id}">${rules.map(r=>`<label class="${sel.includes(r.key)?"on":""}"><input type="checkbox" value="${esc(r.key)}" ${sel.includes(r.key)?"checked":""} hidden><span class="ag-chip ${r.severity==="P1"?"tech":r.severity==="P2"?"a":""}">${esc(r.severity)}</span>${esc(r.name)}<span class="ag-sub ag-mono">${esc(r.key)}</span></label>`).join("")}</div>`;
    b.innerHTML=`<div class="ag-detail" style="margin-top:10px"><b>Autonomy</b><div class="ag-note" style="margin:4px 0 10px">The agent always writes a triage note. What it may <i>do</i> is decided here, rule by rule. Acknowledging, closing real incidents and escalating stay with people and the SLA ladder.</div>
      <label style="display:block;margin:6px 0"><input type="radio" name="agMode" value="advise" ${P.mode!=="assist"?"checked":""}> <b>Advise</b> — notes only (default)</label>
      <label style="display:block;margin:6px 0 14px"><input type="radio" name="agMode" value="assist" ${P.mode==="assist"?"checked":""}> <b>Assist</b> — apply the allow-listed actions below, every action commented on the incident and audited</label>
      <b>Set the owner team automatically</b> <span class="ag-note">(only when the incident has no team yet)</span>${chips("agAT",P.autoTeam||[])}
      <b style="display:block;margin-top:12px">Auto-resolve exact duplicates</b> <span class="ag-note">(same rule already open and triaged within 60 min)</span>${chips("agAR",P.autoResolveDup||[])}
      <div style="margin-top:12px;display:flex;gap:8px"><button class="ag-btn" id="agPolSave">Save policy</button></div></div>`;
    b.querySelectorAll(".ag-rules label").forEach(l=>l.addEventListener("click",()=>setTimeout(()=>l.classList.toggle("on",l.querySelector("input").checked),0)));
    b.querySelector("#agPolSave").addEventListener("click",async()=>{ const pick=id=>[...b.querySelectorAll(`#${id} input:checked`)].map(i=>i.value);
      try{ await api("/api/agents/policy",{method:"PUT",body:JSON.stringify({mode:b.querySelector("[name=agMode]:checked").value,autoTeam:pick("agAT"),autoResolveDup:pick("agAR")})}); toast("Policy saved — the agent applies it on its next tick"); render(); }catch(e){ toast(e.message); } });
  }

  async function tabCalls(b){
    let rows=[]; try{ rows=(await api("/api/llm/calls?limit=150")).calls; }catch(e){ b.innerHTML=`<div class="sub">${esc(e.message)}</div>`; return; }
    if(!rows.length){ b.innerHTML=`<div class="sub" style="padding:14px 0">No LLM calls recorded yet.</div>`; return; }
    b.innerHTML=`<div class="ag-tablew" style="margin-top:10px"><table class="ag-table"><thead><tr><th>When</th><th>Purpose</th><th>Caller</th><th>Provider</th><th>Model</th><th>ms</th><th>OK</th><th>Prompt</th><th>Answer</th><th>Error</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="ag-sub">${md(r.at)}</td><td>${esc(r.purpose)}</td><td class="ag-sub">${esc(r.caller||"")}</td><td>${esc(r.provider)}${r.fallback?' <span class="ag-chip a">fallback</span>':""}</td><td class="ag-mono">${esc(r.model||"")}</td><td>${n(r.ms)}</td><td>${r.ok?'<span class="ag-chip g">ok</span>':'<span class="ag-chip tech">fail</span>'}</td><td class="ag-sub">${n(r.prompt_chars)}</td><td class="ag-sub">${n(r.answer_chars)}</td><td class="ag-sub" style="max-width:280px">${esc(r.error||"")}</td></tr>`).join("")}</tbody></table></div>`;
  }

  /* ------------------------------ open ------------------------------ */
  window.openAgents=function(){
    ensureView();
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.add("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    document.getElementById("view-agents").classList.add("active");
    render();
  };
  window.renderAgents=render;
})();
