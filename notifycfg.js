/* Notifications & escalation settings — Slack/Teams webhooks + on-call ladder.
 * Renders into #notifyCfg inside the Settings view (segment data-seg="notify"). */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const API = window.API_BASE;
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
    const c=CH||{}; const f=c.fixed||{};
    return `<div class="panel">
      <h2>Teams, Slack &amp; WhatsApp notifications</h2>
      <div class="sub">Push new incidents to a channel. <b>Teams</b> is the primary channel — paste the webhook URL from a Teams <b>Workflow</b> (the classic Incoming Webhook connector was retired May 2026). Slack and WhatsApp are optional. The webhooks and recipients in this first block are the <b style="color:var(--green)">Mobile (MVNO)</b> channels; the <b style="color:var(--purple)">Fixed</b> business has its own block below.</div>
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
      <h4 style="margin:18px 0 4px">WhatsApp <span class="rl" style="font-weight:400">— Meta Cloud API · 1:1 fan-out to on-call numbers</span></h4>
      <div class="sub" style="margin-bottom:10px">Sends each alert individually to every recipient (the Cloud API doesn't support groups). For proactive alerts, set an <b>approved template name</b>; without one, messages only deliver inside a 24-hour customer-initiated window. ${c.whatsappConfigured?'<b style="color:var(--good)">Configured ✓</b>':''}</div>
      <div class="nc-form">
        <label class="nc-row"><span>Phone-number ID</span>
          <input type="text" id="ncWaPhone" placeholder="1029384756…" value="${esc(c.waPhoneId||"")}"></label>
        <label class="nc-row"><span>Access token</span>
          <input type="password" id="ncWaToken" placeholder="${c.waTokenSet?'•••••• (stored — leave blank to keep)':'EAAG… permanent token'}"></label>
        <label class="nc-row"><span>Recipients</span>
          <input type="text" id="ncWaTo" placeholder="9665xxxxxxxx, 9665yyyyyyyy (E.164, no +)" value="${esc(c.waTo||"")}"></label>
        <label class="nc-row"><span>Template name</span>
          <input type="text" id="ncWaTpl" placeholder="incident_alert (approved in Meta)" value="${esc(c.waTemplate||"")}"></label>
        <label class="nc-row"><span>Template language</span>
          <input type="text" id="ncWaTplLang" placeholder="en" value="${esc(c.waTemplateLang||"en")}"></label>
        <label class="nc-row"><span>API version</span>
          <input type="text" id="ncWaVer" placeholder="v21.0" value="${esc(c.waApiVersion||"v21.0")}"></label>
        <label class="nc-row"><span>API base (relay)</span>
          <input type="text" id="ncWaBase" placeholder="empty = graph.facebook.com directly · or http://172.31.38.115:8089" value="${esc(c.waBaseUrl||"")}"></label>
      </div>
      <div class="sub" style="margin-top:-4px;margin-bottom:8px">152 has no direct internet — point <b>API base</b> at the nginx relay on the reverse proxy (115), which forwards only to graph.facebook.com and only from this host. Env <code>WA_BASE_URL</code> overrides this field.</div>
      <h4 style="margin:18px 0 4px">SMS <span class="rl" style="font-weight:400">— Unifonic (credentials in server env; secret) · Mobile recipients</span></h4>
      <div class="sub" style="margin-bottom:10px">Text the on-call number for high-severity incidents. Provider URL / AppSid / sender live in the server env (<code>SMS_*</code>) — here you control the toggle, recipients and severity. ${c.smsConfigured?'<b style="color:var(--good)">Provider configured ✓</b>':'<b style="color:#dc2626">Provider env not set</b>'}</div>
      <div class="nc-form">
        <label class="nc-row"><span>Send SMS</span>
          <input type="checkbox" id="ncSmsEnabled" ${c.smsEnabled?"checked":""}></label>
        <label class="nc-row"><span>Recipients</span>
          <input type="text" id="ncSmsTo" placeholder="966535713989, 9665… (blank = server SMS_TO)" value="${esc(c.smsTo||"")}"></label>
        <label class="nc-row"><span>Send for ≥</span>
          <select id="ncSmsMin">${["P1","P2","P3"].map(s=>`<option ${(c.smsMinSeverity||"P1")===s?"selected":""}>${s}</option>`).join("")}</select></label>
      </div>
      <h4 style="margin:18px 0 4px">Fixed business channels <span class="rl" style="font-weight:400">— FTTH · 5G home · e-purchase · Salam Home app</span></h4>
      <div class="sub" style="margin-bottom:10px">Fixed alerts (<code>fixed_*</code> rules) are delivered <b>only</b> to these channels and Mobile alerts only to the ones above — the two businesses never share a Teams room, a WhatsApp list or an SMS list, and neither side falls back to the other. Same webhook format, same message template; WhatsApp uses the sender / token / template above with its own recipients. ${c.fixedTeamsConfigured?'<b style="color:var(--good)">Teams ✓</b> ':''}${c.fixedSlackConfigured?'<b style="color:var(--good)">Slack ✓</b> ':''}${c.fixedWhatsappConfigured?'<b style="color:var(--good)">WhatsApp ✓</b>':''}</div>
      <div class="nc-form">
        <label class="nc-row"><span>Teams webhook URL <small class="rl">(Fixed workflow)</small></span>
          <input type="password" id="ncFxTeams" placeholder="https://…logic.azure.com/workflows/… (a different Workflow than Mobile)" value="${esc(f.teamsUrl||"")}"></label>
        <label class="nc-row"><span>Slack webhook URL <small class="rl">(optional)</small></span>
          <input type="password" id="ncFxSlack" placeholder="https://hooks.slack.com/services/…" value="${esc(f.slackUrl||"")}"></label>
        <label class="nc-row"><span>WhatsApp recipients <small class="rl">(Fixed on-call)</small></span>
          <input type="text" id="ncFxWaTo" placeholder="9665xxxxxxxx, 9665yyyyyyyy (E.164, no +)" value="${esc(f.waTo||"")}"></label>
        <label class="nc-row"><span>SMS recipients <small class="rl">(Fixed on-call)</small></span>
          <input type="text" id="ncFxSmsTo" placeholder="9665xxxxxxxx (blank = no SMS for Fixed)" value="${esc(f.smsTo||"")}"></label>
      </div>
      <div class="nc-actions">
        <button class="pill" id="ncSave" style="border-left-color:var(--green)">Save</button>
        <span class="rl">Test as</span>
        <select id="ncTestSev" class="nc-inline">${["P1","P2","P3"].map(s=>`<option ${s==="P2"?"selected":""}>${s}</option>`).join("")}</select>
        <select id="ncTestSeg" class="nc-inline"><option value="mvno">Mobile channels</option><option value="fixed">Fixed channels</option></select>
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
        waPhoneId:$("#ncWaPhone").value.trim(), waToken:$("#ncWaToken").value.trim(), waTo:$("#ncWaTo").value.trim(), waTemplate:$("#ncWaTpl").value.trim(), waTemplateLang:$("#ncWaTplLang").value.trim()||"en", waApiVersion:$("#ncWaVer").value.trim(), waBaseUrl:$("#ncWaBase").value.trim(),
        smsEnabled:$("#ncSmsEnabled").checked, smsTo:$("#ncSmsTo").value.trim(), smsMinSeverity:$("#ncSmsMin").value,
        fixed:{ teamsUrl:$("#ncFxTeams").value.trim(), slackUrl:$("#ncFxSlack").value.trim(), waTo:$("#ncFxWaTo").value.trim(), smsTo:$("#ncFxSmsTo").value.trim() }})});
        st.textContent=`Saved · Mobile: Slack ${CH.slackConfigured?"✓":"—"} · Teams ${CH.teamsConfigured?"✓":"—"} · WhatsApp ${CH.whatsappConfigured?"✓":"—"} · SMS ${CH.smsConfigured?(CH.smsEnabled?"on":"off"):"env✗"}  |  Fixed: Slack ${CH.fixedSlackConfigured?"✓":"—"} · Teams ${CH.fixedTeamsConfigured?"✓":"—"} · WhatsApp ${CH.fixedWhatsappConfigured?"✓":"—"} · SMS ${CH.fixedSmsConfigured&&CH.smsEnabled?"on":"—"}`;
      }catch(e){ st.textContent="Error: "+e.message; }
    });
    $("#ncTest").addEventListener("click",async()=>{
      const st=$("#ncStatus"); st.textContent="Sending test…";
      try{ const r=await api("/api/chatops/test",{method:"POST",body:JSON.stringify({severity:$("#ncTestSev").value, segment:$("#ncTestSeg").value})});
        const ch=(r.channels||[]); const biz=r.business?`[${r.business}] `:"";
        st.textContent = biz + (ch.length ? ch.map(c=>`${c.name} ${c.sent?"✓":"✗ "+(c.error||"")}`).join(" · ")
          : (r.dev?"No "+(r.business||"")+" channel set — preview below (dev mode)":"nothing sent"));
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
