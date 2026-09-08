/* Notifications & escalation settings — STANDALONE replacement page (reachable at
 * #settings-notify and #settings-notify-clone). Renders the full Teams/Slack/WhatsApp/SMS config
 * PLUS the on-call escalation ladder into its OWN view (#view-notify-clone), independent of the
 * settings gear/menu/segment machinery that the legacy in-settings notify segment used.
 * Element IDs are suffixed "C" and all row queries are scoped to this view's host so it can never
 * collide with the (now-hidden) legacy #notifyCfg segment. Same /api/chatops + /api/escalation. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const API = window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  const SEVS=["P1","P2","P3"];
  const TIERS=[["l1_bss","L1 BSS"],["l2_bss","L2 BSS"],["l1_digital","L1 Digital"],["l2_digital","L2 Digital"],["l3_digital","L3 Digital"]];
  let CH=null, ESC=null;
  const host=()=>document.getElementById("notifyCfgClone");
  const q=sel=>{ const h=host(); return h?[...h.querySelectorAll(sel)]:[]; };

  // Build the standalone view container inside <main> exactly once.
  function ensureView(){
    let v=document.getElementById("view-notify-clone");
    if(v) return v;
    const main=document.querySelector("main")||document.body;
    v=document.createElement("section");
    v.id="view-notify-clone";
    v.className="view";
    v.innerHTML=`<div class="page-head"><h1>Notifications &amp; escalation</h1>
      <div class="sub">Route incidents to Teams / Slack / WhatsApp / SMS and configure the on-call ladder.</div></div>
      <div id="notifyCfgClone" style="margin-top:12px"></div>`;
    main.appendChild(v);
    return v;
  }

  function chatopsPanel(){
    const c=CH||{}; const f=c.fixed||{};
    return `<div class="panel">
      <h2>Teams, Slack &amp; WhatsApp notifications</h2>
      <div class="sub">Push new incidents to a channel. <b>Teams</b> is the primary channel — paste the webhook URL from a Teams <b>Workflow</b> (the classic Incoming Webhook connector was retired May 2026). Slack and WhatsApp are optional. The webhooks and recipients in this first block are the <b style="color:var(--green)">Mobile (MVNO)</b> channels; the <b style="color:var(--purple)">Fixed</b> business has its own block below.</div>
      <div class="nc-form" style="margin-top:14px">
        <label class="nc-row"><span>Enabled</span>
          <input type="checkbox" id="ncEnabledC" ${c.enabled?"checked":""}></label>
        <label class="nc-row"><span>Teams webhook URL <small class="rl">(primary)</small></span>
          <input type="password" id="ncTeamsC" placeholder="https://…logic.azure.com/workflows/…" value="${esc(c.teamsUrl||"")}"></label>
        <label class="nc-row"><span>Slack webhook URL <small class="rl">(optional)</small></span>
          <input type="password" id="ncSlackC" placeholder="https://hooks.slack.com/services/…" value="${esc(c.slackUrl||"")}"></label>
        <label class="nc-row"><span>Notify at / above</span>
          <select id="ncMinC">${["P1","P2","P3"].map(s=>`<option ${c.minSeverity===s?"selected":""}>${s}</option>`).join("")}</select></label>
        <label class="nc-row"><span>Console URL <small class="rl">(for deep links in messages)</small></span>
          <input type="text" id="ncBaseC" placeholder="https://console.salam.sa" value="${esc(c.baseUrl||"")}"></label>
      </div>
      <h4 style="margin:18px 0 4px">WhatsApp <span class="rl" style="font-weight:400">— Meta Cloud API · 1:1 fan-out to on-call numbers</span></h4>
      <div class="sub" style="margin-bottom:10px">Sends each alert individually to every recipient (the Cloud API doesn't support groups). For proactive alerts, set an <b>approved template name</b>; without one, messages only deliver inside a 24-hour customer-initiated window. ${c.whatsappConfigured?'<b style="color:var(--good)">Configured ✓</b>':''}</div>
      <div class="nc-form">
        <label class="nc-row"><span>Phone-number ID</span>
          <input type="text" id="ncWaPhoneC" placeholder="1029384756…" value="${esc(c.waPhoneId||"")}"></label>
        <label class="nc-row"><span>Access token</span>
          <input type="password" id="ncWaTokenC" placeholder="${c.waTokenSet?'•••••• (stored — leave blank to keep)':'EAAG… permanent token'}"></label>
        <label class="nc-row"><span>Recipients</span>
          <input type="text" id="ncWaToC" placeholder="9665xxxxxxxx, 9665yyyyyyyy (E.164, no +)" value="${esc(c.waTo||"")}"></label>
        <label class="nc-row"><span>Template name</span>
          <input type="text" id="ncWaTplC" placeholder="incident_alert (approved in Meta)" value="${esc(c.waTemplate||"")}"></label>
        <label class="nc-row"><span>Template language</span>
          <input type="text" id="ncWaTplLangC" placeholder="en" value="${esc(c.waTemplateLang||"en")}"></label>
        <label class="nc-row"><span>API version</span>
          <input type="text" id="ncWaVerC" placeholder="v21.0" value="${esc(c.waApiVersion||"v21.0")}"></label>
        <label class="nc-row"><span>API base (relay)</span>
          <input type="text" id="ncWaBaseC" placeholder="empty = graph.facebook.com directly · or http://172.31.38.115:8089" value="${esc(c.waBaseUrl||"")}"></label>
      </div>
      <div class="sub" style="margin-top:-4px;margin-bottom:8px">152 has no direct internet — point <b>API base</b> at the nginx relay on the reverse proxy (115:8089), which forwards only to graph.facebook.com and only from this host. Env <code>WA_BASE_URL</code> overrides this field.</div>
      <h4 style="margin:18px 0 4px">SMS <span class="rl" style="font-weight:400">— Unifonic (credentials in server env; secret) · Mobile recipients</span></h4>
      <div class="sub" style="margin-bottom:10px">Text the on-call number for high-severity incidents. Provider URL / AppSid / sender live in the server env (<code>SMS_*</code>) — here you control the toggle, recipients and severity. ${c.smsConfigured?'<b style="color:var(--good)">Provider configured ✓</b>':'<b style="color:#dc2626">Provider env not set</b>'}</div>
      <div class="nc-form">
        <label class="nc-row"><span>Send SMS</span>
          <input type="checkbox" id="ncSmsEnabledC" ${c.smsEnabled?"checked":""}></label>
        <label class="nc-row"><span>Recipients</span>
          <input type="text" id="ncSmsToC" placeholder="966535713989, 9665… (blank = server SMS_TO)" value="${esc(c.smsTo||"")}"></label>
        <label class="nc-row"><span>Send for ≥</span>
          <select id="ncSmsMinC">${["P1","P2","P3"].map(s=>`<option ${(c.smsMinSeverity||"P1")===s?"selected":""}>${s}</option>`).join("")}</select></label>
      </div>
      <h4 style="margin:18px 0 4px">Fixed business channels <span class="rl" style="font-weight:400">— FTTH · 5G home · e-purchase · Salam Home app</span></h4>
      <div class="sub" style="margin-bottom:10px">Fixed alerts (<code>fixed_*</code> rules) are delivered <b>only</b> to these channels and Mobile alerts only to the ones above — the two businesses never share a Teams room, a WhatsApp list or an SMS list, and neither side falls back to the other. Same webhook format, same message template; WhatsApp uses the sender / token / template above with its own recipients. ${c.fixedTeamsConfigured?'<b style="color:var(--good)">Teams ✓</b> ':''}${c.fixedSlackConfigured?'<b style="color:var(--good)">Slack ✓</b> ':''}${c.fixedWhatsappConfigured?'<b style="color:var(--good)">WhatsApp ✓</b>':''}</div>
      <div class="nc-form">
        <label class="nc-row"><span>Teams webhook URL <small class="rl">(Fixed workflow)</small></span>
          <input type="password" id="ncFxTeamsC" placeholder="https://…logic.azure.com/workflows/… (a different Workflow than Mobile)" value="${esc(f.teamsUrl||"")}"></label>
        <label class="nc-row"><span>Slack webhook URL <small class="rl">(optional)</small></span>
          <input type="password" id="ncFxSlackC" placeholder="https://hooks.slack.com/services/…" value="${esc(f.slackUrl||"")}"></label>
        <label class="nc-row"><span>WhatsApp recipients <small class="rl">(Fixed on-call)</small></span>
          <input type="text" id="ncFxWaToC" placeholder="9665xxxxxxxx, 9665yyyyyyyy (E.164, no +)" value="${esc(f.waTo||"")}"></label>
        <label class="nc-row"><span>SMS recipients <small class="rl">(Fixed on-call)</small></span>
          <input type="text" id="ncFxSmsToC" placeholder="9665xxxxxxxx (blank = no SMS for Fixed)" value="${esc(f.smsTo||"")}"></label>
      </div>
      <div class="nc-actions">
        <button class="pill" id="ncSaveC" style="border-left-color:var(--green)">Save</button>
        <span class="rl">Test as</span>
        <select id="ncTestSevC" class="nc-inline">${["P1","P2","P3"].map(s=>`<option ${s==="P2"?"selected":""}>${s}</option>`).join("")}</select>
        <select id="ncTestSegC" class="nc-inline"><option value="mvno">Mobile channels</option><option value="fixed">Fixed channels</option></select>
        <button class="pill" id="ncTestC" style="border-left-color:var(--blue)">Send test</button>
        <span id="ncStatusC" class="rl"></span>
      </div>
      <div id="ncPreviewC" style="margin-top:10px"></div>
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
        <input type="checkbox" id="ncEscEnabledC" ${e.enabled?"checked":""}></label>
      ${SEVS.map(sev=>`<div class="nc-ladder" data-sev="${sev}">
        <h4>${sev} ladder</h4>
        <div class="nc-steps">${ladderRows(sev)}</div>
        <button class="pill nc-add" data-sev="${sev}" style="border-left-color:var(--purple)">+ Add tier</button>
      </div>`).join("")}
      <div class="nc-actions"><button class="pill" id="ncEscSaveC" style="border-left-color:var(--green)">Save ladder</button>
        <span id="ncEscStatusC" class="rl"></span></div>
    </div>`;
  }

  function collectPolicies(){
    const pol={};
    SEVS.forEach(sev=>{
      pol[sev]=q(`.nc-step[data-sev="${sev}"]`).map(row=>({
        tier:row.querySelector(".nc-tier").value,
        afterMin:Math.max(0,Number(row.querySelector(".nc-min").value)||0)
      })).sort((a,b)=>a.afterMin-b.afterMin);
    });
    return pol;
  }
  function refreshOnCall(){
    q(".nc-oncall").forEach(async el=>{
      const tier=el.parentElement.querySelector(".nc-tier").value; el.dataset.tier=tier;
      try{ const r=await api("/api/escalation/oncall?tier="+encodeURIComponent(tier));
        el.textContent = r.people.length ? ("on-call: "+r.people.map(p=>p.name||p.email).join(", ")) : "⚠ no one has this role";
        el.style.color = r.people.length ? "" : "#d97706";
      }catch(_){ el.textContent=""; }
    });
  }

  function wire(){
    $("#ncSaveC").addEventListener("click",async()=>{
      const st=$("#ncStatusC"); st.textContent="Saving…";
      try{ CH=await api("/api/chatops",{method:"PUT",body:JSON.stringify({
        enabled:$("#ncEnabledC").checked, slackUrl:$("#ncSlackC").value.trim(), teamsUrl:$("#ncTeamsC").value.trim(),
        minSeverity:$("#ncMinC").value, baseUrl:$("#ncBaseC").value.trim(),
        waPhoneId:$("#ncWaPhoneC").value.trim(), waToken:$("#ncWaTokenC").value.trim(), waTo:$("#ncWaToC").value.trim(), waTemplate:$("#ncWaTplC").value.trim(), waTemplateLang:$("#ncWaTplLangC").value.trim()||"en", waApiVersion:$("#ncWaVerC").value.trim(), waBaseUrl:$("#ncWaBaseC").value.trim(),
        smsEnabled:$("#ncSmsEnabledC").checked, smsTo:$("#ncSmsToC").value.trim(), smsMinSeverity:$("#ncSmsMinC").value,
        fixed:{ teamsUrl:$("#ncFxTeamsC").value.trim(), slackUrl:$("#ncFxSlackC").value.trim(), waTo:$("#ncFxWaToC").value.trim(), smsTo:$("#ncFxSmsToC").value.trim() }})});
        st.textContent=`Saved · Mobile: Slack ${CH.slackConfigured?"✓":"—"} · Teams ${CH.teamsConfigured?"✓":"—"} · WhatsApp ${CH.whatsappConfigured?"✓":"—"} · SMS ${CH.smsConfigured?(CH.smsEnabled?"on":"off"):"env✗"}  |  Fixed: Slack ${CH.fixedSlackConfigured?"✓":"—"} · Teams ${CH.fixedTeamsConfigured?"✓":"—"} · WhatsApp ${CH.fixedWhatsappConfigured?"✓":"—"} · SMS ${CH.fixedSmsConfigured&&CH.smsEnabled?"on":"—"}`;
      }catch(e){ st.textContent="Error: "+e.message; }
    });
    $("#ncTestC").addEventListener("click",async()=>{
      const st=$("#ncStatusC"); st.textContent="Sending test…";
      try{ const r=await api("/api/chatops/test",{method:"POST",body:JSON.stringify({severity:$("#ncTestSevC").value, segment:$("#ncTestSegC").value})});
        const ch=(r.channels||[]); const biz=r.business?`[${r.business}] `:"";
        st.textContent = biz + (r.skipped
            ? "Not sent — "+(r.skipped==="chatops disabled"?"notifications are OFF. Tick “Enabled” + Save, then test.":r.skipped)+" · preview below"
          : ch.length ? ch.map(c=>`${c.name} ${c.sent?"✓":"✗ "+(c.error||"")}`).join(" · ")
          : (r.dev?"No "+(r.business||"")+" channel set — preview below (dev mode)":"nothing sent"));
        $("#ncPreviewC").innerHTML =
          (r.whatsappPreview ? `<div class="rl">WhatsApp message preview</div><pre class="nc-pre">${esc(r.whatsappPreview)}</pre>` : "") +
          (r.slackPreview ? `<div class="rl">Slack message preview</div><pre class="nc-pre">${esc(JSON.stringify(r.slackPreview,null,2))}</pre>` : "");
      }catch(e){ st.textContent="Error: "+e.message; }
    });
    // escalation ladder events (delegated, scoped to this view's host)
    const h=host();
    h.addEventListener("click",e=>{
      const add=e.target.closest(".nc-add");
      if(add){ const sev=add.dataset.sev; const steps=add.parentElement.querySelector(".nc-steps");
        ESC.policies=collectPolicies(); (ESC.policies[sev]=ESC.policies[sev]||[]).push({tier:"l2_digital",afterMin:15});
        steps.innerHTML=ladderRows(sev); refreshOnCall(); return; }
      const del=e.target.closest(".nc-del");
      if(del){ const row=del.closest(".nc-step"); const sev=row.dataset.sev; const steps=row.parentElement;
        row.remove(); ESC.policies=collectPolicies(); steps.innerHTML=ladderRows(sev); refreshOnCall(); return; }
    });
    h.addEventListener("change",e=>{ if(e.target.classList.contains("nc-tier")) refreshOnCall(); });
    $("#ncEscSaveC").addEventListener("click",async()=>{
      const st=$("#ncEscStatusC"); st.textContent="Saving…";
      try{ ESC=await api("/api/escalation",{method:"PUT",body:JSON.stringify({enabled:$("#ncEscEnabledC").checked, policies:collectPolicies()})});
        st.textContent="Saved ✓"; }
      catch(e){ st.textContent="Error: "+e.message; }
    });
    refreshOnCall();
  }

  async function render(){
    const h=host(); if(!h) return;
    h.innerHTML=`<div class="sub">Loading…</div>`;
    try{ [CH,ESC]=await Promise.all([api("/api/chatops"),api("/api/escalation")]); }
    catch(e){ h.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    h.innerHTML=chatopsPanel()+escalationPanel();
    wire();
  }

  window.openNotifyClone=function(){
    ensureView();
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.add("on");
    const v=document.getElementById("view-notify-clone"); if(v) v.classList.add("active");
    render();
  };
  // expose under the canonical name too, so any caller opening the notify settings lands here
  window.renderNotifyCfg=function(){ if(document.getElementById("view-notify-clone")) render(); };
})();
