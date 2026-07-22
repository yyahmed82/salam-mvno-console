/* Notifications & escalation settings — Slack/Teams webhooks + on-call ladder.
 * Renders into #notifyCfg inside the Settings view (segment data-seg="notify"). */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const API=(location.protocol==="file:")?"http://localhost:4600":"";
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  const SEVS=["P1","P2","P3"];
  const TIERS=[["l1_bss","L1 BSS"],["l2_bss","L2 BSS"],["l1_digital","L1 Digital"],["l2_digital","L2 Digital"],["l3_digital","L3 Digital"]];
  const tierLabel=t=>{const m=TIERS.find(x=>x[0]===t);return m?m[1]:t;};
  let CH=null, ESC=null;

  async function render(){
    const host=$("#notifyCfg"); if(!host) return;
    host.innerHTML=`<div class="sub">Loading…</div>`;
    try{ [CH,ESC]=await Promise.all([api("/api/chatops"),api("/api/escalation")]); }
    catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    host.innerHTML=chatopsPanel()+escalationPanel();
    wire();
  }

  function chatopsPanel(){
    const c=CH||{};
    return `<div class="panel">
      <h2>Teams, Slack &amp; WhatsApp notifications</h2>
      <div class="sub">Push new incidents to a channel. <b>Teams</b> is the primary channel — paste the webhook URL from a Teams <b>Workflow</b> (the classic Incoming Webhook connector was retired May 2026). Slack and WhatsApp are optional.</div>
      <div class="nc-form" style="margin-top:14px">
        <label class="nc-row"><span>Enabled</span>
          <input type="checkbox" id="ncEnabled" ${c.enabled?"checked":""}></label>
        <label class="nc-row"><span>Teams webhook URL <small class="rl">(primary)</small></span>
          <input type="password" id="ncTeams" placeholder="https://…logic.azure.com/workflows/…" value="${esc(c.teamsUrl||"")}"></label>
        <label class="nc-row"><span>Slack webhook URL <small class="rl">(optional)</small></span>
          <input type="password" id="ncSlack" placeholder="https://hooks.slack.com/services/…" value="${esc(c.slackUrl||"")}"></label>
        <label class="nc-row"><span>Notify at / above</span>
          <select id="ncMin">${["P1","P2","P3"].map(s=>`<option ${c.minSeverity===s?"selected":""}>${s}</option>`).join("")}</select></label>
        <label class="nc-row"><span>Console URL <small class="rl">(for deep links in messages)</small></span>
          <input type="text" id="ncBase" placeholder="https://console.salam.sa" value="${esc(c.baseUrl||"")}"></label>
      </div>
      <h4 style="margin:18px 0 4px">WhatsApp group <span class="rl" style="font-weight:400">— Meta Cloud API (Official Business Account)</span></h4>
      <div class="sub" style="margin-bottom:10px">Posts to one WhatsApp group via the Groups API. Group max is 8 members; business-initiated messages may require an approved template. ${c.whatsappConfigured?'<b style="color:#16a34a">Configured ✓</b>':''}</div>
      <div class="nc-form">
        <label class="nc-row"><span>Phone-number ID</span>
          <input type="text" id="ncWaPhone" placeholder="1029384756…" value="${esc(c.waPhoneId||"")}"></label>
        <label class="nc-row"><span>Access token</span>
          <input type="password" id="ncWaToken" placeholder="${c.waTokenSet?'•••••• (stored — leave blank to keep)':'EAAG… permanent token'}"></label>
        <label class="nc-row"><span>Group ID</span>
          <input type="text" id="ncWaGroup" placeholder="1203630XXXXXXXXXX@g.us" value="${esc(c.waGroupId||"")}"></label>
        <label class="nc-row"><span>API version</span>
          <input type="text" id="ncWaVer" placeholder="v21.0" value="${esc(c.waApiVersion||"v21.0")}"></label>
      </div>
      <h4 style="margin:18px 0 4px">SMS <span class="rl" style="font-weight:400">— Unifonic (credentials in server env; secret)</span></h4>
      <div class="sub" style="margin-bottom:10px">Text the on-call number for high-severity incidents. Provider URL / AppSid / sender live in the server env (<code>SMS_*</code>) — here you control the toggle, recipients and severity. ${c.smsConfigured?'<b style="color:#16a34a">Provider configured ✓</b>':'<b style="color:#dc2626">Provider env not set</b>'}</div>
      <div class="nc-form">
        <label class="nc-row"><span>Send SMS</span>
          <input type="checkbox" id="ncSmsEnabled" ${c.smsEnabled?"checked":""}></label>
        <label class="nc-row"><span>Recipients</span>
          <input type="text" id="ncSmsTo" placeholder="966535713989, 9665… (blank = server SMS_TO)" value="${esc(c.smsTo||"")}"></label>
        <label class="nc-row"><span>Send for ≥</span>
          <select id="ncSmsMin">${["P1","P2","P3"].map(s=>`<option ${(c.smsMinSeverity||"P1")===s?"selected":""}>${s}</option>`).join("")}</select></label>
      </div>
      <div class="nc-actions">
        <button class="pill" id="ncSave" style="border-left-color:var(--green)">Save</button>
        <span class="rl">Test as</span>
        <select id="ncTestSev" class="nc-inline">${["P1","P2","P3"].map(s=>`<option ${s==="P2"?"selected":""}>${s}</option>`).join("")}</select>
        <button class="pill" id="ncTest" style="border-left-color:var(--blue)">Send test</button>
        <span id="ncStatus" class="rl"></span>
      </div>
      <div id="ncPreview" style="margin-top:10px"></div>
    </div>`;
  }

  function ladderRows(sev){
    const list=(ESC.policies&&ESC.policies[sev])||[];
    return list.map((s,i)=>`<div class="nc-step" data-sev="${sev}" data-i="${i}">
      <span class="nc-badge">${i+1}</span>
      <select class="nc-tier">${TIERS.map(t=>`<option value="${t[0]}" ${s.tier===t[0]?"selected":""}>${t[1]}</option>`).join("")}</select>
      <span class="rl">after</span>
      <input class="nc-min" type="number" min="0" step="5" value="${Number(s.afterMin)||0}"> <span class="rl">min</span>
      <span class="nc-oncall rl" data-tier="${s.tier}">…</span>
      <button class="nc-del" title="Remove step">✕</button>
    </div>`).join("");
  }
  function escalationPanel(){
    const e=ESC||{};
    return `<div class="panel">
      <h2>On-call escalation ladder</h2>
      <div class="sub">When a P-severity incident opens and isn't acknowledged, page the next tier after N minutes. Timing is real wall-clock from when the incident opened; escalation stops the moment someone acks, snoozes, or resolves it.</div>
      <label class="nc-row" style="max-width:260px;margin-top:12px"><span>Enabled</span>
        <input type="checkbox" id="ncEscEnabled" ${e.enabled?"checked":""}></label>
      ${SEVS.map(sev=>`<div class="nc-ladder" data-sev="${sev}">
        <h4>${sev} ladder</h4>
        <div class="nc-steps">${ladderRows(sev)}</div>
        <button class="pill nc-add" data-sev="${sev}" style="border-left-color:var(--purple)">+ Add tier</button>
      </div>`).join("")}
      <div class="nc-actions"><button class="pill" id="ncEscSave" style="border-left-color:var(--green)">Save ladder</button>
        <span id="ncEscStatus" class="rl"></span></div>
    </div>`;
  }

  function collectPolicies(){
    const pol={};
    SEVS.forEach(sev=>{
      pol[sev]=[...document.querySelectorAll(`.nc-step[data-sev="${sev}"]`)].map(row=>({
        tier:row.querySelector(".nc-tier").value,
        afterMin:Math.max(0,Number(row.querySelector(".nc-min").value)||0)
      })).sort((a,b)=>a.afterMin-b.afterMin);
    });
    return pol;
  }

  function refreshOnCall(){
    document.querySelectorAll(".nc-oncall").forEach(async el=>{
      const tier=el.parentElement.querySelector(".nc-tier").value; el.dataset.tier=tier;
      try{ const r=await api("/api/escalation/oncall?tier="+encodeURIComponent(tier));
        el.textContent = r.people.length ? ("on-call: "+r.people.map(p=>p.name||p.email).join(", ")) : "⚠ no one has this role";
        el.style.color = r.people.length ? "" : "#d97706";
      }catch(_){ el.textContent=""; }
    });
  }

  function wire(){
    $("#ncSave").addEventListener("click",async()=>{
      const st=$("#ncStatus"); st.textContent="Saving…";
      try{ CH=await api("/api/chatops",{method:"PUT",body:JSON.stringify({
        enabled:$("#ncEnabled").checked, slackUrl:$("#ncSlack").value.trim(), teamsUrl:$("#ncTeams").value.trim(),
        minSeverity:$("#ncMin").value, baseUrl:$("#ncBase").value.trim(),
        waPhoneId:$("#ncWaPhone").value.trim(), waToken:$("#ncWaToken").value.trim(), waGroupId:$("#ncWaGroup").value.trim(), waApiVersion:$("#ncWaVer").value.trim(),
        smsEnabled:$("#ncSmsEnabled").checked, smsTo:$("#ncSmsTo").value.trim(), smsMinSeverity:$("#ncSmsMin").value})});
        st.textContent=`Saved · Slack ${CH.slackConfigured?"✓":"—"} · Teams ${CH.teamsConfigured?"✓":"—"} · WhatsApp ${CH.whatsappConfigured?"✓":"—"} · SMS ${CH.smsConfigured?(CH.smsEnabled?"on":"off"):"env✗"}`;
      }catch(e){ st.textContent="Error: "+e.message; }
    });
    $("#ncTest").addEventListener("click",async()=>{
      const st=$("#ncStatus"); st.textContent="Sending test…";
      try{ const r=await api("/api/chatops/test",{method:"POST",body:JSON.stringify({severity:$("#ncTestSev").value})});
        const ch=(r.channels||[]);
        st.textContent = ch.length ? ch.map(c=>`${c.name} ${c.sent?"✓":"✗ "+(c.error||"")}`).join(" · ")
          : (r.dev?"No webhook set — preview below (dev mode)":"nothing sent");
        $("#ncPreview").innerHTML =
          (r.whatsappPreview ? `<div class="rl">WhatsApp message preview</div><pre class="nc-pre">${esc(r.whatsappPreview)}</pre>` : "") +
          (r.slackPreview ? `<div class="rl">Slack message preview</div><pre class="nc-pre">${esc(JSON.stringify(r.slackPreview,null,2))}</pre>` : "");
      }catch(e){ st.textContent="Error: "+e.message; }
    });
    // escalation ladder events (delegated)
    $("#notifyCfg").addEventListener("click",e=>{
      const add=e.target.closest(".nc-add");
      if(add){ const sev=add.dataset.sev; const steps=add.parentElement.querySelector(".nc-steps");
        ESC.policies=collectPolicies(); (ESC.policies[sev]=ESC.policies[sev]||[]).push({tier:"l2_digital",afterMin:15});
        steps.innerHTML=ladderRows(sev); refreshOnCall(); return; }
      const del=e.target.closest(".nc-del");
      if(del){ const row=del.closest(".nc-step"); const sev=row.dataset.sev; const steps=row.parentElement;
        row.remove(); ESC.policies=collectPolicies(); steps.innerHTML=ladderRows(sev); refreshOnCall(); return; }
    });
    $("#notifyCfg").addEventListener("change",e=>{ if(e.target.classList.contains("nc-tier")) refreshOnCall(); });
    $("#ncEscSave").addEventListener("click",async()=>{
      const st=$("#ncEscStatus"); st.textContent="Saving…";
      try{ ESC=await api("/api/escalation",{method:"PUT",body:JSON.stringify({enabled:$("#ncEscEnabled").checked, policies:collectPolicies()})});
        st.textContent="Saved ✓"; }
      catch(e){ st.textContent="Error: "+e.message; }
    });
    refreshOnCall();
  }

  window.renderNotifyCfg=render;
  document.querySelectorAll('[data-seg="notify"]').forEach(b=>b.addEventListener("click",()=>setTimeout(render,0)));
})();
