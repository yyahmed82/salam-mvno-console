/* Yusr (يُسر) settings — STANDALONE replacement page (reachable at #settings-assist).
 * Same clone pattern as the notify page: renders the full config + usage/perf stats into its OWN
 * view (#view-assist-clone) appended to <main>, independent of the settings gear/segment machinery.
 * Element IDs are suffixed "C" and every query is scoped to this view's host so it can never collide
 * with the legacy #assistCfg segment. Same /api/assist/* endpoints. */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const API = (location.protocol==="file:") ? "http://localhost:4600" : (location.pathname.startsWith("/digital-console") ? "/digital-console" : "");
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  let CFG=null, STATS=null, FILT=null;
  const GREEN="var(--green)", AMBER="#f59e0b";
  const host=()=>document.getElementById("assistCfgClone");
  const $c=sel=>{ const h=host(); return h?h.querySelector(sel):null; };
  const ksaT=iso=>{ try{ return KT.md(iso); }catch(_){ return ""; } };

  function ensureView(){
    let v=document.getElementById("view-assist-clone");
    if(v) return v;
    const main=document.querySelector("main")||document.body;
    v=document.createElement("section");
    v.id="view-assist-clone"; v.className="view";
    v.innerHTML=`<div class="page-head"><h1>Yusr <span style="font-family:'Noto Kufi Arabic','Geeza Pro',Tahoma">يُسر</span> — AI assistant</h1>
      <div class="sub">Local LLM (Ollama) copilot for L1 &amp; call-center. Data never leaves the network; PII stays masked per role.</div></div>
      <div id="assistCfgClone" style="margin-top:12px"></div>`;
    main.appendChild(v);
    return v;
  }

  /* ------------------------------ config panel ------------------------------ */
  async function render(){
    ensureView();
    const h=host(); if(!h) return;
    h.innerHTML=`<div class="sub">Loading…</div>`;
    try{ CFG=await api("/api/assist/config"); }
    catch(e){
      // hidden root tier: the server answers 403 {error:'restricted'} — show a clean panel, not an error banner
      if(/^restricted$/i.test(e.message||"")){
        h.innerHTML=`<div class="panel" style="text-align:center;padding:34px 20px">
          <div style="font-size:26px">🔒</div>
          <h2 style="margin:8px 0 4px">Restricted</h2>
          <div class="sub">This configuration page is limited to the platform owner.</div></div>`;
        return;
      }
      h.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    h.innerHTML=`
      <div class="panel">
        <h2>Configuration</h2>
        <div style="display:flex;flex-direction:column;gap:12px;max-width:560px;margin-top:8px">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600">
            <input type="checkbox" id="acEnabledC" ${CFG.enabled?"checked":""}/> Enable Yusr everywhere
          </label>
          <div class="sub" style="margin-top:-8px">The single kill-switch: unchecked hides the chat bubble on every page and blocks the chat API for all users.</div>
          <label>Ollama URL
            <input id="acUrlC" type="text" value="${esc(CFG.ollamaUrl)}" placeholder="http://host.docker.internal:11434"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)"/>
          </label>
          <label>Model
            <input id="acModelC" type="text" value="${esc(CFG.model)}" placeholder="llama3.1"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)"/>
          </label>
          <label>Timeout (ms)
            <input id="acTimeoutC" type="number" value="${esc(CFG.timeoutMs)}" min="5000" max="120000" step="1000"
              style="width:160px;margin-top:4px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)"/>
          </label>
          <div style="display:flex;gap:10px;align-items:center">
            <button id="acSaveC" class="navtab" style="background:var(--green);color:#fff;border-color:var(--green)">Save</button>
            <button id="acTestC" class="navtab">Test connection</button>
            <span id="acStatusC" class="sub"></span>
          </div>
          <div id="acModelsC" class="sub"></div>
        </div>
      </div>
      <div class="panel" style="margin-top:14px">
        <h2 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">Usage &amp; performance
          <select id="asDaysC" style="font-size:12px;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)">
            <option value="1">last 24h</option><option value="7" selected>last 7 days</option><option value="30">last 30 days</option>
          </select>
          <button id="asRefreshC" class="navtab" style="font-size:12px;padding:4px 10px">Refresh</button>
        </h2>
        <div class="sub">Aggregated from the audit trail — intent, latency and mode only; question text is never stored.</div>
        <div id="asStatsC" style="margin-top:12px"><div class="sub">Loading…</div></div>
      </div>`;
    // wire config controls (scoped to this view)
    $c("#acSaveC").addEventListener("click",async()=>{
      const st=$c("#acStatusC"); st.textContent="Saving…";
      try{
        CFG=await api("/api/assist/config",{method:"PUT",body:JSON.stringify({
          enabled:$c("#acEnabledC").checked, ollamaUrl:$c("#acUrlC").value.trim(),
          model:$c("#acModelC").value.trim(), timeoutMs:Number($c("#acTimeoutC").value)||45000 })});
        st.textContent="Saved ✓";
      }catch(e){ st.textContent="Error: "+e.message; }
    });
    $c("#acTestC").addEventListener("click",async()=>{
      const st=$c("#acStatusC"), ml=$c("#acModelsC"); st.textContent="Testing…"; ml.textContent="";
      try{
        const r=await api("/api/assist/ping");
        if(r.ok){
          st.textContent=`Connected ✓ · model "${CFG.model}" ${r.modelAvailable?"available ✓":"NOT pulled ✗"}`;
          ml.textContent=(r.models&&r.models.length)?("Models on server: "+r.models.join(", ")):"No models pulled yet — run: ollama pull "+CFG.model;
        }else{
          st.textContent="Unreachable ✗ — "+(r.error||"")+" ("+(r.url||"")+")";
          ml.textContent="Is Ollama running? Install from ollama.com, then: ollama pull "+CFG.model;
        }
      }catch(e){ st.textContent="Error: "+e.message; }
    });
    $c("#asRefreshC").addEventListener("click",()=>loadStats());
    $c("#asDaysC").addEventListener("change",()=>loadStats());
    loadStats(true);
  }

  /* ------------------------------ stats (cross-filtered server-side) ------------------------------ */
  async function loadStats(reset){
    const box=$c("#asStatsC"); if(!box) return;
    if(reset===true) FILT=null;
    const days=Number(($c("#asDaysC")||{}).value)||7;
    let qs="?days="+days;
    if(FILT) qs+="&"+encodeURIComponent(FILT.type)+"="+encodeURIComponent(String(FILT.value));
    box.innerHTML=`<div class="sub">Loading…</div>`;
    try{ STATS=await api("/api/assist/stats"+qs); }
    catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    renderStats();
  }

  function renderStats(){
    const box=$c("#asStatsC"); if(!box||!STATS) return;
    const s=STATS, pct=v=>Math.round((v||0)*100)+"%";
    const ms=v=>v==null?"—":(v>=1000?(v/1000).toFixed(1)+" s":v+" ms");
    const card=(label,val,hint,sub)=>`<div style="flex:1;min-width:118px;border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--card2)">
      <div style="font-size:21px;font-weight:800">${val==null?"—":val}</div>
      <div class="sub" style="margin-top:2px">${esc(label)}${hint?` <span title="${esc(hint)}">ⓘ</span>`:""}</div>
      ${sub?`<div class="sub" style="font-size:10px;margin-top:1px">${esc(sub)}</div>`:""}</div>`;
    const L=s.latency||{llm:{},dataOnly:{}};
    let h=`<div style="display:flex;gap:10px;flex-wrap:wrap">`
      +card("Chats", s.chats)
      +card("Last 24h", s.last24h)
      +card("Agents", s.users)
      +card("Degraded", pct(s.degradedRate), "share of replies answered by the rule-based fallback because the LLM was unreachable")
      +card("LLM latency", ms(L.llm.avg), "average / p95 of replies actually answered by the LLM", L.llm.avg!=null?`p95 ${ms(L.llm.p95)} · n=${L.llm.n}`:"no LLM replies yet")
      +card("Fallback latency", ms(L.dataOnly.avg), "data-only replies (LLM offline) — context gathering time only", L.dataOnly.avg!=null?`p95 ${ms(L.dataOnly.p95)} · n=${L.dataOnly.n}`:"")
      +card("Helpful", (s.feedback&&s.feedback.rate!=null)?pct(s.feedback.rate):"—", "share of replies rated 👍 by agents", s.feedback&&s.feedback.total?`${s.feedback.helpful} of ${s.feedback.total} rated`:"no ratings yet")
      +card("Learned cases", s.learnedCases||0, "PII-scrubbed problem→resolution pairs saved from 👍 replies — retrieved for future similar questions (how Yusr learns from use)")
      +`</div>`;
    h+=`<div style="margin-top:10px;border:1px solid var(--line);border-radius:10px;padding:9px 12px;background:var(--card2);font-size:11.5px;line-height:1.55">
      <b>Legend:</b>
      <span style="color:var(--green-dark);font-weight:700">LLM</span> — the local AI model (Ollama) composed the answer from the gathered data (subscriber profile, failures, alerts, runbooks). Conversational, explains causes.
      &nbsp;·&nbsp; <span style="color:#b45309;font-weight:700">data-only</span> — the model was unreachable, so Yusr replied with the raw gathered data only (rule-based, no AI reasoning). Accurate but terse.
      A high data-only share means the Ollama server is down or not installed — check "Test connection" above.</div>`;
    if(!s.chats && !FILT){ box.innerHTML=h+`<div class="sub" style="margin-top:12px">No chats in this window yet.</div>`; return; }

    const daily=s.daily||[];
    if(daily.length){
      const W=Math.max(320,Math.min(760,daily.length*46)), H=120, PB=18, PT=14;
      const mx=Math.max(...daily.map(d=>d.n),1), bw=Math.min(34,(W-10)/daily.length-8);
      const y=v=>H-PB-(v/mx)*(H-PB-PT);
      let svg="";
      daily.forEach((d,i)=>{
        const x=6+i*((W-10)/daily.length)+((W-10)/daily.length-bw)/2;
        const llm=d.n-d.degraded, hAll=H-PB-y(d.n), hLlm=d.n?hAll*(llm/d.n):0;
        const sel=FILT&&FILT.type==="day"&&FILT.value===d.day;
        svg+=`<g class="asDayC" data-day="${esc(d.day)}" style="cursor:pointer" opacity="${FILT&&FILT.type==="day"&&!sel?0.35:1}">
          <title>${esc(d.day)} — ${d.n} chats (${llm} LLM · ${d.degraded} data-only) · click to ${sel?"unfilter":"filter"}</title>
          <rect x="${x}" y="${y(d.n)}" width="${bw}" height="${Math.max(2,hAll-hLlm)}" fill="${AMBER}" rx="3"/>
          <rect x="${x}" y="${y(d.n)+(hAll-hLlm)}" width="${bw}" height="${Math.max(0,hLlm)}" fill="${GREEN}" rx="3"/>
          ${sel?`<rect x="${x-2}" y="${y(d.n)-2}" width="${bw+4}" height="${hAll+4}" fill="none" stroke="var(--ink)" stroke-width="1.5" rx="4"/>`:""}
          <text x="${x+bw/2}" y="${y(d.n)-3}" text-anchor="middle" font-size="9" fill="var(--ink-soft)">${d.n}</text>
          <text x="${x+bw/2}" y="${H-5}" text-anchor="middle" font-size="8.5" fill="var(--muted)">${esc(d.day.slice(5))}</text></g>`;
      });
      h+=`<div style="margin-top:16px"><b style="font-size:12.5px">Per day</b>
        <span class="sub" style="margin-inline-start:8px"><span style="color:${GREEN}">■</span> LLM · <span style="color:${AMBER}">■</span> data-only · click a bar to filter everything</span>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block;margin-top:4px">${svg}</svg></div>`;
    }

    const bar=(cls,key,label,n,deg,max,sel)=>{
      const w=Math.max(2,Math.round(n/max*100)), dw=n?Math.round(deg/n*w):0;
      return `<div class="${cls}" data-k="${esc(key)}" style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;cursor:pointer;opacity:${sel===false?0.4:1}"
        title="${esc(label)} — ${n} chats · ${deg} data-only · click to ${sel?"unfilter":"filter"}">
        <span style="width:150px;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${sel?"font-weight:700":""}">${esc(label)}</span>
        <span style="flex:1;background:var(--card2);border-radius:6px;overflow:hidden;position:relative">
          <span style="display:block;width:${w}%;height:11px;background:${GREEN}"></span>
          <span style="position:absolute;top:0;left:0;display:block;width:${dw}%;height:11px;background:${AMBER}"></span></span>
        <span style="width:40px;text-align:right">${n}</span></div>`;
    };
    h+=`<div style="display:flex;gap:26px;flex-wrap:wrap;margin-top:16px">`;
    if((s.intents||[]).length){
      h+=`<div style="flex:1;min-width:260px"><b style="font-size:12.5px">By intent</b>`;
      const mx1=Math.max(...s.intents.map(x=>x.n),1);
      for(const x of s.intents) h+=bar("asIntentC",x.intent,x.intent,x.n,x.degraded||0,mx1,FILT&&FILT.type==="intent"?(FILT.value===x.intent):null);
      h+=`</div>`;
    }
    if((s.agents||[]).length){
      h+=`<div style="flex:1;min-width:260px"><b style="font-size:12.5px">By agent</b>`;
      const mx2=Math.max(...s.agents.map(x=>x.n),1);
      for(const x of s.agents) h+=bar("asAgentC",x.actor||"—",x.actor||"—",x.n,x.degraded||0,mx2,FILT&&FILT.type==="agent"?(FILT.value===x.actor):null);
      h+=`</div>`;
    }
    h+=`</div>`;

    h+=`<div style="display:flex;gap:26px;flex-wrap:wrap;margin-top:16px">`;
    const hrs=s.hours||[];
    if(hrs.some(x=>x.n>0)){
      const mxH=Math.max(...hrs.map(x=>x.n),1);
      h+=`<div style="flex:1;min-width:280px"><b style="font-size:12.5px">By hour (KSA)</b>
        <div style="display:flex;align-items:flex-end;gap:2px;height:52px;margin-top:6px">`
        +hrs.map(x=>`<div title="${String(x.hour).padStart(2,"0")}:00 — ${x.n} chats" style="flex:1;background:${x.n?GREEN:"var(--card2)"};height:${Math.max(3,Math.round(x.n/mxH*100))}%;border-radius:2px 2px 0 0"></div>`).join("")
        +`</div><div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted)"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></div>`;
    }
    const lh=s.latencyHist||[];
    if(lh.some(x=>x.n>0)){
      const mxL=Math.max(...lh.map(x=>x.n),1);
      h+=`<div style="flex:1;min-width:220px"><b style="font-size:12.5px">Latency distribution</b>`;
      for(const x of lh){
        const w=Math.max(2,Math.round(x.n/mxL*100));
        h+=`<div style="display:flex;align-items:center;gap:8px;margin-top:5px;font-size:11.5px">
          <span style="width:52px;color:var(--ink-soft)">${esc(x.label)}</span>
          <span style="flex:1;background:var(--card2);border-radius:5px;overflow:hidden"><span style="display:block;width:${w}%;height:9px;background:var(--blue,#3b82f6)"></span></span>
          <span style="width:34px;text-align:right">${x.n}</span></div>`;
      }
      h+=`</div>`;
    }
    h+=`</div>`;

    const rows=s.recent||[];
    h+=`<div style="margin-top:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b style="font-size:12.5px">Activity</b>`;
    if(FILT) h+=`<span id="asFiltChipC" style="font-size:11.5px;border:1px solid var(--green);background:var(--green-bg);color:var(--green-dark);border-radius:999px;padding:3px 10px;cursor:pointer" title="Remove filter">${esc(FILT.label)} ✕</span>`;
    h+=`<span class="sub">latest ${rows.length}${s.chats>rows.length?` of ${s.chats}`:""} · click any chart to filter everything</span>
      <span style="margin-inline-start:auto;display:flex;gap:6px">
        <button class="asModeC navtab" data-m="false" style="font-size:11px;padding:3px 9px;${FILT&&FILT.type==="mode"&&String(FILT.value)==="false"?"background:var(--green);color:#fff;border-color:var(--green)":""}">LLM</button>
        <button class="asModeC navtab" data-m="true" style="font-size:11px;padding:3px 9px;${FILT&&FILT.type==="mode"&&String(FILT.value)==="true"?"background:#b45309;color:#fff;border-color:#b45309":""}">data-only</button>
      </span></div>`;
    h+=`<table style="width:100%;margin-top:6px;font-size:12px;border-collapse:collapse">
      <tr style="color:var(--muted);text-align:left"><th style="padding:4px 6px">When (KSA)</th><th>Agent</th><th>Intent</th><th>Mode</th><th style="text-align:right">latency</th></tr>`
      +(rows.length?rows.map(r=>`<tr style="border-top:1px solid var(--line)">
        <td style="padding:4px 6px;white-space:nowrap">${esc(ksaT(r.at))}</td>
        <td>${esc(r.actor||"—")}</td><td>${esc(r.intent||"—")}</td>
        <td>${r.degraded?`<span style="color:#b45309">data-only${r.llm_error?` · ${esc(r.llm_error)}`:""}</span>`:`<span style="color:var(--green-dark)">LLM</span>`}</td>
        <td style="text-align:right">${r.ms!=null?ms(r.ms):"—"}</td></tr>`).join("")
      :`<tr><td colspan="5" class="sub" style="padding:10px 6px">No chats match this filter.</td></tr>`)
      +`</table>`;
    box.innerHTML=h;

    const setF=f=>{ FILT=(FILT&&f&&FILT.type===f.type&&String(FILT.value)===String(f.value))?null:f; loadStats(); };
    box.querySelectorAll(".asDayC").forEach(g=>g.addEventListener("click",()=>setF({type:"day",value:g.dataset.day,label:"day "+g.dataset.day})));
    box.querySelectorAll(".asIntentC").forEach(g=>g.addEventListener("click",()=>setF({type:"intent",value:g.dataset.k,label:"intent: "+g.dataset.k})));
    box.querySelectorAll(".asAgentC").forEach(g=>g.addEventListener("click",()=>setF({type:"agent",value:g.dataset.k,label:"agent: "+g.dataset.k})));
    box.querySelectorAll(".asModeC").forEach(b=>b.addEventListener("click",()=>setF({type:"mode",value:b.dataset.m==="true",label:b.dataset.m==="true"?"data-only replies":"LLM replies"})));
    const chip=$c("#asFiltChipC"); if(chip) chip.addEventListener("click",()=>{ FILT=null; loadStats(); });
  }

  /* ------------------------------ open (view switch) ------------------------------ */
  window.openAssistClone=function(){
    ensureView();
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.add("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    document.getElementById("view-assist-clone").classList.add("active");
    render();
  };
})();
