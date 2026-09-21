/* acksla.js — ACKNOWLEDGEMENT SLA, front side (10 Sep 2026).
 *   1. Settings › SLA: the "Acknowledgement SLA" section — two cards (Mobile / Fixed), per priority the reminder
 *      ladder (R1 / R2 / R3 minutes, repeat, management step), management contacts, ChatOps toggle, preview mails,
 *      the live overdue list and the last reminders sent.   window.renderAckSlaSettings(host)
 *   2. Notices: home page (under GLOBAL STATUS) and each Alerts page banner — "N alert(s) unacknowledged beyond
 *      SLA · worst …"; the STATUS cell chip (⏰ R2 · 17 min) on the alert rows.   window.ackSlaNotice(seg, host)
 * Server: ackSla.js — GET/PUT /api/ack-sla, GET /api/ack-sla/status?segment=, POST /api/ack-sla/preview|tick */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API=window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{ if(!r.ok) return r.json().then(e=>{ throw new Error(e.error||("HTTP "+r.status)); }); return r.json(); });
  const LV={1:{w:"Reminder 1",c:"#d97706",bg:"rgba(217,119,6,.10)"},2:{w:"Reminder 2",c:"#ea580c",bg:"rgba(234,88,12,.12)"},3:{w:"Reminder 3 · escalated",c:"#dc2626",bg:"rgba(220,38,38,.12)"}};
  const mins=m=>m>=60?`${Math.floor(m/60)} h ${m%60} min`:`${m} min`;
  const sevC=s=>s==='P1'?"#dc2626":s==='P2'?"#d97706":"#64748b";
  const ksa=t=>t?new Date(new Date(t).getTime()+3*3600e3).toISOString().slice(5,16).replace("T"," ")+" KSA":"—";

  /* ── notices (home + Alerts banner) ─────────────────────────────────────────────────────────── */
  let _st=null,_stAt=0;
  async function fetchStatus(){ if(_st&&Date.now()-_stAt<20000) return _st; try{ _st=await api("/api/ack-sla/status"); _stAt=Date.now(); }catch(e){ _st=null; } return _st; }
  window.ackSlaStatus=fetchStatus;
  function sideNotice(side,label,board){
    if(!side||!side.enabled||!side.overdue) return "";
    const w=side.worst; const lv=w?Math.max(1,w.level):1; const L=LV[lv];
    const nx=w&&w.next?` · next: ${w.next.repeat?"repeat ":""}R${w.next.level} in ${w.next.inMin} min`:"";
    return `<a href="#${board}${w?`?id=${w.id}`:""}" class="acksla-notice" style="--c:${L.c};--bg:${L.bg}">
      <span class="acksla-ic">${lv>=3?"🚨":lv===2?"⚠️":"⏰"}</span>
      <span><b>${side.overdue} ${esc(label)} alert${side.overdue>1?"s":""} unacknowledged beyond SLA</b>${w?` — worst <b style="color:${sevC(w.severity)}">${esc(w.severity)}</b> ${esc(w.name)} · open ${mins(w.elapsed_min)} · ${w.level?esc(LV[w.level].w)+" sent":"reminder due"}${nx}`:""}
      ${side.level3?`<span class="acksla-chip" style="background:#dc2626">${side.level3} escalated to management</span>`:""}</span>
      <span class="acksla-go">Open ›</span></a>`;
  }
  /* seg: 'mvno' | 'fixed' | null (both) — renders into host (cleared when nothing is overdue) */
  window.ackSlaNotice=async function(seg,host){
    if(!host) return; ensureCss();
    const st=await fetchStatus(); if(!st){ host.innerHTML=""; return; }
    let h="";
    if(seg!=="fixed") h+=sideNotice(st.mobile,"Mobile","alerts");
    if(seg!=="mvno") h+=sideNotice(st.fixed,"Fixed","fixed-alerts");
    host.innerHTML=h;
  };
  /* STATUS-cell chip for an alert row (alertsview): needs the row's ack_reminder_level / opened_wall */
  window.ackSlaChip=function(a){
    if(!a||a.status!=='open'||a.ack_at) return "";
    const lv=Number(a.ack_reminder_level)||0; if(!lv) return "";
    const el=Math.max(0,Math.round((Date.now()-new Date(a.opened_wall||a.fired_at))/60000));
    return `<br><span class="acksla-chip" style="background:${LV[lv].c}" title="${esc(LV[lv].w)} mailed to the team${lv>=3?" · management informed":""} — unacknowledged ${mins(el)}. Ack stops the reminders.">${lv>=3?"🚨":"⏰"} R${lv} · ${mins(el)}</span>`;
  };

  /* ── settings section (SLA page) ────────────────────────────────────────────────────────────── *
   * Cards and history rows carry data-biz (21 Sep 2026) so the SLA page's MVNO | Fixed tabs show one
   * business: CSS hides the other one, it stays in the DOM, so Save still sends both sides as loaded. */
  const PR=["P1","P2","P3"], BZ=[["mobile","📱 Mobile (MVNO)","var(--green,#0e9f5a)","mvno"],["fixed","🏠 Fixed","var(--purple,#7c3aed)","fixed"]];
  window.renderAckSlaSettings=async function(host){
    if(!host) return; ensureCss();
    host.innerHTML=`<div class="sub">Loading acknowledgement SLA…</div>`;
    let d,st,people=[]; try{ [d,st]=await Promise.all([api("/api/ack-sla"), fetchStatus()]); }catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    try{ people=(await api("/api/ack-sla/people")).people||[]; }catch(e){ people=[]; }
    const person=em=>people.find(p=>String(p.email).toLowerCase()===String(em).toLowerCase());
    const cfg=d.config; const canEdit=window.opsCan&&window.opsCan("manageSync");
    const me=((window.opsSession&&window.opsSession().me)||{}).email||"";
    const card=([b,label,color,seg])=>{
      const c=cfg[b]; const side=st&&st[b];
      const rows=PR.map(p=>{ const L=c[p]; return `<tr>
        <td><span class="sevpill" style="background:${sevC(p)}">${p}</span></td>
        <td><input type="number" min="0" max="1440" data-k="${b}.${p}.r1" value="${L.r1}" ${canEdit?"":"disabled"}></td>
        <td><input type="number" min="0" max="1440" data-k="${b}.${p}.r2" value="${L.r2}" ${canEdit?"":"disabled"}></td>
        <td><input type="number" min="0" max="1440" data-k="${b}.${p}.r3" value="${L.r3}" ${canEdit?"":"disabled"}></td>
        <td><input type="number" min="0" max="1440" data-k="${b}.${p}.repeat" value="${L.repeat}" ${canEdit?"":"disabled"} title="0 = reminder 3 is sent once"></td>
        <td><label class="switch"><input type="checkbox" data-k="${b}.${p}.management" ${L.management?"checked":""} ${canEdit?"":"disabled"}><span class="slider"></span></label></td></tr>`; }).join("");
      const over=side&&side.alerts?side.alerts.filter(x=>x.overdue&&!x.child):[];
      const live=!side?"":!side.enabled?`<div class="rl" style="margin-top:8px;color:var(--muted)">reminders are <b>off</b> for this side</div>`
        :!side.unacked?`<div class="okbox" style="margin-top:8px">No unacknowledged ${label.replace(/^\S+\s/,"")} alert right now ✅</div>`
        :`<div class="acksla-live"><div class="rl" style="font-weight:800;letter-spacing:.06em;margin-bottom:4px">LIVE · ${side.unacked} unacknowledged · <span style="color:${over.length?'#dc2626':'var(--good)'}">${over.length} beyond SLA</span></div>
          ${side.alerts.slice(0,6).map(x=>`<a href="#${seg==='fixed'?'fixed-alerts':'alerts'}?id=${x.id}" class="acksla-row"><span class="sevpill" style="background:${sevC(x.severity)}">${esc(x.severity)}</span><span class="acksla-n">${esc(x.name)}${x.child?' <span class="rl">(correlated child — root is reminded)</span>':''}</span><span class="rl">${mins(x.elapsed_min)} · ${x.level?`<b style="color:${LV[x.level].c}">R${x.level} sent</b>`:"no reminder yet"}${x.next?` · next R${x.next.level} in ${x.next.inMin} min`:""}</span></a>`).join("")}</div>`;
      return `<div class="acksla-card" data-biz="${b}" style="border-top:3px solid ${color}">
        <div class="acksla-h"><b style="color:${color}">${label}</b><label class="switch" title="Reminders for this business"><input type="checkbox" data-k="${b}.enabled" ${c.enabled?"checked":""} ${canEdit?"":"disabled"}><span class="slider"></span></label></div>
        <div style="overflow-x:auto"><table class="alerts acksla-t"><tr><th>PRIORITY</th><th>REMINDER 1<br><span class="rl">min after fired</span></th><th>REMINDER 2<br><span class="rl">warning</span></th><th>REMINDER 3<br><span class="rl">+ escalation</span></th><th>REPEAT R3<br><span class="rl">every … min</span></th><th>INFORM<br><span class="rl">management</span></th></tr>${rows}</table></div>
        <div class="rl" style="margin:8px 0 4px;font-weight:700">Management — ${label.replace(/^\S+\s/,"")} <span style="font-weight:400;color:var(--muted)">· informed at reminder 3 (separate mail, never in the team's recipient list)</span></div>
        <div class="acksla-pick" data-pick="${b}" ${canEdit?"":"data-ro=1"}>
          <div class="acksla-chips">${c.management.split(", ").filter(Boolean).map(em=>chip(em)).join("")}</div>
          ${canEdit?`<input class="acksla-pin" placeholder="type a name or email — pick from the users list…" autocomplete="off"><div class="acksla-dd" hidden></div>`:""}
          <input type="hidden" data-k="${b}.management" value="${esc(c.management)}">
        </div>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:8px">
          <label style="display:flex;gap:6px;align-items:center;font-size:12.5px"><label class="switch"><input type="checkbox" data-k="${b}.chatops" ${c.chatops?"checked":""} ${canEdit?"":"disabled"}><span class="slider"></span></label> also post reminders 2 &amp; 3 to the ${label.replace(/^\S+\s/,"")} Teams / WhatsApp channels</label>
          ${canEdit?`<span class="rl">Preview to <b>${esc(me.split("@")[0])}</b>:</span>${[1,2,3].map(l=>`<button class="pill" data-prev="${b}" data-lv="${l}" style="padding:3px 9px;border-left-color:${LV[l].c}">✉ R${l}</button>`).join("")}`:""}
        </div>${live}</div>`; };
    function chip(em){ const p=person(em); const biz=p?(p.business==='fixed'?'🏠':p.business==='mobile'?'📱':'📱🏠'):''; return `<span class="acksla-pchip" data-em="${esc(em)}"><b>${esc(p&&p.name?p.name:em.split("@")[0])}</b><span class="rl">${esc(em)}${p&&p.team?' · '+esc(p.team):''} ${biz}</span>${canEdit?`<button type="button" class="acksla-x" title="Remove">✕</button>`:""}</span>`; }
    const hist=(d.history||[]).slice(0,12);
    host.innerHTML=`
      <div class="acksla-intro">
        <label style="display:flex;gap:8px;align-items:center;font-weight:700"><label class="switch"><input type="checkbox" data-k="enabled" ${cfg.enabled?"checked":""} ${canEdit?"":"disabled"}><span class="slider"></span></label> Acknowledgement SLA ${cfg.enabled?'<span style="color:var(--good)">on</span>':'<span style="color:#dc2626">off</span>'}</label>
        <div class="rl" style="margin-top:6px">L1 receives every alert by mail with the SOP the moment it fires. When <b>nobody on L1 / L2 acknowledges</b> it, the console reminds the <b>ACK holders</b> of that side (users list → ACK · MOBILE / ACK · FIXED), then from reminder 2 the whole business: <b style="color:${LV[1].c}">Reminder 1</b> (notice) → <b style="color:${LV[2].c}">Reminder 2</b> (warning, + ChatOps) → <b style="color:${LV[3].c}">Reminder 3</b> (critical) with a separate <b>for-information mail to management</b>, then repeats until someone presses Ack. Reminders stop on Ack / Snooze / Resolve; correlated children are not reminded separately; timing is wall-clock from the moment the alert opened. Each send is logged on the incident, in the audit trail and shown as a notice on the home page and the Alerts pages.</div>
      </div>
      <div class="acksla-grid">${BZ.map(card).join("")}</div>
      <div class="acksla-intro" id="ackslaFlap" style="margin-top:12px"><div class="sub">Loading flap control…</div></div>
      ${canEdit?`<div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap"><button class="btn" id="ackslaSave">Save acknowledgement SLA</button><button class="pill" id="ackslaTick" style="padding:5px 12px" title="Evaluate every open unacknowledged alert now (sends what is due)">▷ Run check now</button><span id="ackslaMsg" class="rl"></span></div>`:""}
      ${hist.length?`<div class="rl" style="font-weight:800;letter-spacing:.06em;margin:16px 0 6px">LAST REMINDERS SENT</div><div style="overflow-x:auto"><table class="alerts" style="font-size:11.5px"><tr><th>WHEN</th><th>SIDE</th><th>LEVEL</th><th>ALERT</th><th>OPEN FOR</th><th>MAILED<br><span class="rl">ack holders</span></th><th>MGMT</th><th>CHATOPS</th><th>OUTCOME</th></tr>
        ${hist.map(r=>`<tr data-biz="${r.business==='fixed'?'fixed':'mobile'}"><td class="mono">${ksa(r.sent_at)}</td><td>${r.business==='fixed'?'🏠 Fixed':'📱 Mobile'}</td><td><span class="acksla-chip" style="background:${LV[r.level].c}">R${r.level}</span></td><td><b style="color:${sevC(r.severity)}">${esc(r.severity||'')}</b> ${esc(r.name||('#'+r.alert_id))}</td><td>${mins(r.elapsed_min)}</td><td>${r.recipients} <span class="rl">(${r.holders||0})</span></td><td>${r.management||'—'}</td><td>${(r.channels||[]).length?(r.channels||[]).map(c=>esc(c.channel||c.name||'?')).join('/'):'—'}</td><td>${r.mail_ok?'<span style="color:var(--good)">sent</span>':`<span style="color:#d97706">${esc(r.error||'not sent')}</span>`}${r.ack_at?` · acked by ${esc(String(r.ack_by||'').split('@')[0])}`:r.status!=='open'?' · resolved':''}</td></tr>`).join("")}
        ${["mobile","fixed"].filter(b=>!hist.some(r=>(r.business==='fixed'?'fixed':'mobile')===b)).map(b=>`<tr data-biz="${b}"><td colspan="9" class="rl" style="text-align:center;padding:10px">No ${b==='fixed'?'Fixed':'Mobile'} reminder among the ${hist.length} most recent.</td></tr>`).join("")}</table></div>`:""}`;
    renderFlap($("#ackslaFlap"), canEdit);
    if(!canEdit) return;
    /* management pickers: chips + autocomplete over the console users (keyboard: ↑↓ Enter, Esc) */
    host.querySelectorAll(".acksla-pick").forEach(pk=>{
      const hid=pk.querySelector("input[type=hidden]"), chips=pk.querySelector(".acksla-chips"), inp=pk.querySelector(".acksla-pin"), dd=pk.querySelector(".acksla-dd");
      const list=()=>[...chips.querySelectorAll(".acksla-pchip")].map(x=>x.dataset.em);
      const sync=()=>{ hid.value=list().join(", "); };
      const add=em=>{ em=String(em||"").trim().toLowerCase(); if(!em||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)||list().includes(em)) return; chips.insertAdjacentHTML("beforeend",chip(em)); wireX(); sync(); inp.value=""; dd.hidden=true; };
      const wireX=()=>chips.querySelectorAll(".acksla-x").forEach(x=>x.onclick=()=>{ x.closest(".acksla-pchip").remove(); sync(); });
      wireX();
      let sel=0;
      const paint=()=>{ const q=inp.value.trim().toLowerCase(); const have=list();
        const m=people.filter(p=>!have.includes(String(p.email).toLowerCase())&&(!q||String(p.email).toLowerCase().includes(q)||String(p.name||"").toLowerCase().includes(q)||String(p.team||"").toLowerCase().includes(q))).slice(0,8);
        if(!m.length&&!(q.includes("@"))){ dd.hidden=true; return; }
        sel=Math.min(sel,Math.max(0,m.length-1));
        dd.innerHTML=m.map((p,i)=>`<div class="acksla-opt${i===sel?" on":""}" data-em="${esc(p.email)}"><b>${esc(p.name||p.email.split("@")[0])}</b> <span class="rl">${esc(p.email)}${p.team?' · '+esc(p.team):''} · ${p.business==='fixed'?'Fixed':p.business==='mobile'?'Mobile':'Both'}</span></div>`).join("")+(q.includes("@")&&!m.some(p=>p.email.toLowerCase()===q)?`<div class="acksla-opt${m.length===sel?" on":""}" data-em="${esc(q)}"><b>Add address</b> <span class="rl">${esc(q)} (not a console user)</span></div>`:"");
        dd.hidden=false; dd.querySelectorAll(".acksla-opt").forEach(o=>o.onmousedown=e=>{ e.preventDefault(); add(o.dataset.em); }); };
      inp.addEventListener("input",()=>{ sel=0; paint(); });
      inp.addEventListener("focus",paint);
      inp.addEventListener("blur",()=>setTimeout(()=>{ dd.hidden=true; },120));
      inp.addEventListener("keydown",e=>{ const opts=dd.querySelectorAll(".acksla-opt"); if(e.key==="ArrowDown"){ sel=Math.min(opts.length-1,sel+1); paint(); e.preventDefault(); } else if(e.key==="ArrowUp"){ sel=Math.max(0,sel-1); paint(); e.preventDefault(); } else if(e.key==="Enter"){ e.preventDefault(); const o=opts[sel]; if(o) add(o.dataset.em); else add(inp.value); } else if(e.key==="Escape"){ dd.hidden=true; } else if(e.key==="Backspace"&&!inp.value){ const last=chips.querySelector(".acksla-pchip:last-child"); if(last){ last.remove(); sync(); } } });
    });
    const collect=()=>{ const out={}; host.querySelectorAll("[data-k]").forEach(el=>{ const path=el.dataset.k.split("."); let o=out; for(let i=0;i<path.length-1;i++){ o[path[i]]=o[path[i]]||{}; o=o[path[i]]; } o[path[path.length-1]]=el.type==="checkbox"?el.checked:(el.tagName==="TEXTAREA"||el.type==="hidden"?el.value:Number(el.value)); }); return out; };
    const msg=(t,c)=>{ const m=$("#ackslaMsg"); if(m){ m.textContent=t; m.style.color=c||"var(--muted)"; } };
    $("#ackslaSave").addEventListener("click",async()=>{ msg("Saving…"); try{ await api("/api/ack-sla",{method:"PUT",body:JSON.stringify(collect())}); _st=null; msg("Saved ✓ — applies from the next check (every minute)","var(--good)"); setTimeout(()=>window.renderAckSlaSettings(host),900); }catch(e){ msg(e.message,"#dc2626"); } });
    $("#ackslaTick").addEventListener("click",async()=>{ msg("Checking…"); try{ const r=await api("/api/ack-sla/tick",{method:"POST"}); _st=null; msg(r.skipped?`skipped — ${r.skipped}`:`${r.checked} unacknowledged checked · ${r.sent} reminder(s) sent`, r.sent?"#d97706":"var(--good)"); if(r.sent) setTimeout(()=>window.renderAckSlaSettings(host),900); }catch(e){ msg(e.message,"#dc2626"); } });
    host.querySelectorAll("[data-prev]").forEach(b=>b.addEventListener("click",async()=>{ const t=b.textContent; b.textContent="…"; try{ const r=await api("/api/ack-sla/preview",{method:"POST",body:JSON.stringify({business:b.dataset.prev,level:Number(b.dataset.lv)})}); msg(r.mail&&r.mail.sent?`Preview R${r.level} mailed to ${r.to} (alert: ${r.alert.severity} ${r.alert.name})${r.management_mail?' + the management mail':''}`:`not sent — ${(r.mail&&(r.mail.error||r.mail.reason))||'no SMTP configured'}`, r.mail&&r.mail.sent?"var(--good)":"#d97706"); }catch(e){ msg(e.message,"#dc2626"); } b.textContent=t; }));
  };

  /* flap control — one incident per problem: re-open within N min instead of a new incident; resolve only after N min clear */
  async function renderFlap(host, canEdit){
    if(!host) return; let v; try{ v=await api("/api/alert-flap"); }catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    host.innerHTML=`<div style="font-weight:700">Flap control <span class="rl" style="font-weight:400;color:var(--muted)">· one incident per problem — measured 5–9 Sep: the payment failure storm re-opened 257 times in 4 days because every threshold crossing was a new incident (new mail, new row to acknowledge)</span></div>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:12.5px">
        <label>Re-open the same incident if the rule fires again within <input type="number" min="0" max="1440" id="flapReopen" value="${v.reopenMin}" ${canEdit?"":"disabled"} style="width:70px;font:inherit;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:inherit"> min of resolving (ack, owner and discussion kept; no new mail)</label>
        <label>Resolve only after the condition has been clear for <input type="number" min="0" max="240" id="flapHold" value="${v.clearHoldMin}" ${canEdit?"":"disabled"} style="width:60px;font:inherit;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:inherit"> min</label>
        ${canEdit?`<button class="pill" id="flapSave" style="padding:4px 12px;border-left-color:var(--green)">Save flap control</button><span id="flapMsg" class="rl"></span>`:""}
      </div>`;
    const b=$("#flapSave"); if(b) b.onclick=async()=>{ const m=$("#flapMsg"); m.textContent="Saving…"; try{ const r=await api("/api/alert-flap",{method:"PUT",body:JSON.stringify({reopenMin:Number($("#flapReopen").value),clearHoldMin:Number($("#flapHold").value)})}); m.textContent=`Saved ✓ — re-open ${r.reopenMin} min · clear-hold ${r.clearHoldMin} min (applies from the next sync tick)`; m.style.color="var(--good)"; }catch(e){ m.textContent=e.message; m.style.color="#dc2626"; } };
  }
  function ensureCss(){
    if(document.getElementById("acksla-css")) return;
    const st=document.createElement("style"); st.id="acksla-css"; st.textContent=`
      .acksla-notice{display:flex;gap:10px;align-items:center;background:var(--bg);border:1px solid var(--c);border-left:5px solid var(--c);background:var(--bg);border-radius:10px;padding:9px 13px;margin:0 0 10px;font-size:12.5px;color:inherit;text-decoration:none;line-height:1.45}
      .acksla-notice:hover{filter:brightness(1.05)}
      .acksla-ic{font-size:18px}.acksla-go{margin-left:auto;font-weight:800;color:var(--c);white-space:nowrap}
      .acksla-chip{display:inline-block;color:#fff;border-radius:5px;padding:0 6px;font-size:10.5px;font-weight:800;letter-spacing:.03em;margin-left:4px;white-space:nowrap}
      .acksla-intro{background:var(--panel2,var(--panel));border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:12px}
      .acksla-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}
      .acksla-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
      .acksla-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:14px}
      .acksla-t input[type=number]{width:72px;font:inherit;font-size:12.5px;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:inherit}
      .acksla-t th{white-space:nowrap}.acksla-t td{vertical-align:middle}
      .acksla-pick{position:relative;border:1px solid var(--line);border-radius:10px;background:var(--bg);padding:6px 8px}
      .acksla-chips{display:flex;flex-wrap:wrap;gap:6px}
      .acksla-pchip{display:inline-flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-left:3px solid #7f1d1d;border-radius:8px;padding:3px 8px;font-size:12px;line-height:1.3}
      .acksla-pchip .rl{font-size:10.5px}.acksla-x{border:0;background:none;color:#dc2626;font-weight:800;cursor:pointer;padding:0 2px;font-size:12px}
      .acksla-pin{width:100%;border:0;outline:0;background:transparent;font:inherit;font-size:12.5px;padding:6px 2px 2px;color:inherit}
      .acksla-dd{position:absolute;left:0;right:0;top:100%;z-index:30;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(2,6,23,.25);max-height:260px;overflow:auto;margin-top:4px}
      .acksla-opt{padding:7px 10px;cursor:pointer;font-size:12.5px;border-bottom:1px solid var(--line)}.acksla-opt:last-child{border-bottom:0}.acksla-opt.on,.acksla-opt:hover{background:rgba(14,159,90,.12)}
      .acksla-live{margin-top:10px;border-top:1px dashed var(--line);padding-top:8px}
      .acksla-row{display:flex;gap:8px;align-items:center;padding:4px 0;text-decoration:none;color:inherit;font-size:12.5px;border-bottom:1px solid var(--line)}
      .acksla-row:last-child{border-bottom:0}.acksla-n{flex:1;min-width:0}
      @media (max-width:640px){.acksla-notice{flex-wrap:wrap}.acksla-go{margin-left:0}.acksla-t input[type=number]{width:56px}}`;
    document.head.appendChild(st);
  }
  document.addEventListener("opsdatarefresh",()=>{ _st=null; });
})();
