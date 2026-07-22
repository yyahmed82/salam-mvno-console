/* Yusr (يُسر) settings — enable toggle, Ollama URL/model, connection test.
 * Renders into #assistCfg inside the Settings view (segment data-seg="assist"). */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const API=(location.protocol==="file:")?"http://localhost:4600":"";
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  let CFG=null;

  async function render(){
    const host=$("#assistCfg"); if(!host) return;
    host.innerHTML=`<div class="sub">Loading…</div>`;
    try{ CFG=await api("/api/assist/config"); }
    catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    host.innerHTML=`
      <div class="panel">
        <h2>Yusr <span style="font-family:'Noto Kufi Arabic','Geeza Pro',Tahoma">يُسر</span> — AI assistant</h2>
        <div class="sub">"Yusr" = ease. Local LLM (Ollama) that helps L1 &amp; call-center agents troubleshoot faster: subscriber lookups,
          open incidents, runbook &amp; error-code search. Data never leaves the network; PII stays masked per the agent's role.</div>
        <div style="display:flex;flex-direction:column;gap:12px;max-width:560px;margin-top:14px">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600">
            <input type="checkbox" id="acEnabled" ${CFG.enabled?"checked":""}/> Enabled (chat bubble on every page)
          </label>
          <label>Ollama URL
            <input id="acUrl" type="text" value="${esc(CFG.ollamaUrl)}" placeholder="http://host.docker.internal:11434"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)"/>
            <div class="sub" style="margin-top:3px">From the console container, the host machine's Ollama is <code>http://host.docker.internal:11434</code>.</div>
          </label>
          <label>Model
            <input id="acModel" type="text" value="${esc(CFG.model)}" placeholder="llama3.1"
              style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)"/>
          </label>
          <label>Timeout (ms)
            <input id="acTimeout" type="number" value="${esc(CFG.timeoutMs)}" min="5000" max="120000" step="1000"
              style="width:160px;margin-top:4px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)"/>
          </label>
          <div style="display:flex;gap:10px;align-items:center">
            <button id="acSave" class="navtab" style="background:var(--green);color:#fff;border-color:var(--green)">Save</button>
            <button id="acTest" class="navtab">Test connection</button>
            <span id="acStatus" class="sub"></span>
          </div>
          <div id="acModels" class="sub"></div>
        </div>
      </div>`;
    wire();
  }

  function wire(){
    $("#acSave").addEventListener("click",async()=>{
      const st=$("#acStatus"); st.textContent="Saving…";
      try{
        CFG=await api("/api/assist/config",{method:"PUT",body:JSON.stringify({
          enabled:$("#acEnabled").checked, ollamaUrl:$("#acUrl").value.trim(),
          model:$("#acModel").value.trim(), timeoutMs:Number($("#acTimeout").value)||45000 })});
        st.textContent="Saved ✓";
      }catch(e){ st.textContent="Error: "+e.message; }
    });
    $("#acTest").addEventListener("click",async()=>{
      const st=$("#acStatus"), ml=$("#acModels"); st.textContent="Testing…"; ml.textContent="";
      try{
        const r=await api("/api/assist/ping");
        if(r.ok){
          st.textContent=`Connected ✓ · model "${CFG.model}" ${r.modelAvailable?"available ✓":"NOT pulled ✗"}`;
          ml.textContent=(r.models&&r.models.length)?("Models on server: "+r.models.join(", ")):"No models pulled yet — run: ollama pull "+CFG.model;
        }else{
          st.textContent="Unreachable ✗ — "+(r.error||"")+" ("+r.url+")";
          ml.textContent="Is Ollama running? Install from ollama.com, then: ollama pull "+CFG.model;
        }
      }catch(e){ st.textContent="Error: "+e.message; }
    });
  }

  window.renderAssistCfg=render;
  document.querySelectorAll('[data-seg="assist"]').forEach(b=>b.addEventListener("click",()=>setTimeout(render,0)));
})();
