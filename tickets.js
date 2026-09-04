/* Internal tickets / feedback — TWO surfaces:
 *   (a) "Raise a ticket" modal, available to EVERY signed-in user (help "?" menu item). Kind
 *       (enhancement/issue) + title + description + up to 4 screenshots → POST /api/tickets.
 *   (b) "Tickets" admin board (manageUsers), a standalone view (#view-tickets) with a filterable
 *       table; a row opens a detail drawer with screenshots, description, comments and the
 *       status / priority / resolution controls.
 * Same auth transport as the rest of the console: window.fetch is patched (ops.js) to attach the
 * session token, so plain fetch() calls here are authenticated. Screenshots are fetched as blobs
 * (an <img src> can't carry the auth header) and shown via object URLs. */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const API = (location.protocol==="file:") ? "http://localhost:4600" : (location.pathname.startsWith("/digital-console") ? "/digital-console" : "");
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts))
    .then(r=>{ if(!r.ok) return r.json().catch(()=>({})).then(e=>{ throw new Error(e.error||("HTTP "+r.status)); }); return r.json(); });

  const MAX_FILES=4, MAX_MB=5, ALLOWED=["image/png","image/jpeg","image/webp","image/gif"];
  const KIND_LABEL={enhancement:"Suggestion / enhancement",issue:"Issue"};
  const STATUSES=["open","under_evaluation","in_progress","closed","rejected"];
  const STATUS_LABEL={open:"Open",under_evaluation:"Under evaluation",in_progress:"In progress",closed:"Closed",rejected:"Rejected"};
  const STATUS_COLOR={open:"#2563eb",under_evaluation:"#7c3aed",in_progress:"#0891b2",closed:"#16a34a",rejected:"#b91c1c"};
  const PRIORITIES=["low","normal","high","urgent"];
  const ksaT=iso=>{ try{ return new Date(iso).toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).replace(",",""); }catch(_){ return String(iso); } };
  const can=c=>{ try{ return window.opsCan&&window.opsCan(c); }catch(_){ return false; } };
  const statusPill=s=>`<span style="font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:12px;color:#fff;background:${STATUS_COLOR[s]||"#64748b"}">${esc(STATUS_LABEL[s]||s)}</span>`;
  function readFile(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result)); r.onerror=()=>rej(new Error("read failed")); r.readAsDataURL(file); }); }

  /* ============================ (a) Raise-a-ticket modal ============================ */
  let PICKED=[];   // {name,mime,size,dataUrl}
  function ensureModal(){
    let ov=document.getElementById("ticketModalOv");
    if(ov) return ov;
    ov=document.createElement("div"); ov.id="ticketModalOv"; ov.className="modal-overlay";
    ov.innerHTML=`<div class="modal-card" id="ticketModalCard" style="max-width:560px"></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click",e=>{ if(e.target===ov) closeModal(); });
    return ov;
  }
  function closeModal(){ const ov=document.getElementById("ticketModalOv"); if(ov) ov.classList.remove("open"); PICKED=[]; }
  window.openTicketModal=function(){
    const ov=ensureModal(); PICKED=[];
    ov.querySelector("#ticketModalCard").innerHTML=formHtml();
    ov.classList.add("open");
    wireForm();
  };
  function formHtml(){
    const inp="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink);font:inherit";
    return `<div class="modal-head"><span class="path">Raise a ticket</span><span class="x" id="tkX">×</span></div>
      <div class="modal-body">
        <div class="sub" style="margin-bottom:12px">Suggest an improvement or report an issue you hit in the console. You'll get an email confirming it's under evaluation.</div>
        <h5>Type</h5>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label class="tkKind" style="flex:1;min-width:150px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;display:flex;gap:8px;align-items:flex-start">
            <input type="radio" name="tkKind" value="issue" checked style="margin-top:2px">
            <span><b>Issue</b><div class="sub" style="font-size:11px">Something is broken or wrong</div></span></label>
          <label class="tkKind" style="flex:1;min-width:150px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;display:flex;gap:8px;align-items:flex-start">
            <input type="radio" name="tkKind" value="enhancement" style="margin-top:2px">
            <span><b>Suggestion</b><div class="sub" style="font-size:11px">An enhancement or new idea</div></span></label>
        </div>
        <h5>Title</h5>
        <input id="tkTitle" type="text" maxlength="300" placeholder="Short summary" style="${inp}">
        <h5>Description</h5>
        <textarea id="tkDesc" rows="5" placeholder="What happened? What did you expect? Steps to reproduce…" style="${inp};resize:vertical"></textarea>
        <h5>Screenshots <span class="sub" style="font-weight:400">(optional · up to ${MAX_FILES} · PNG/JPG/WEBP/GIF · ${MAX_MB}MB each)</span></h5>
        <div id="tkDrop" style="border:1.5px dashed var(--line);border-radius:10px;padding:16px;text-align:center;cursor:pointer;color:var(--muted);font-size:12.5px">
          Drag &amp; drop images here, or <b style="color:var(--green)">browse</b>
          <input id="tkFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple style="display:none"></div>
        <div id="tkThumbs" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"></div>
        <div id="tkMsg" class="sub" style="margin-top:10px"></div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:14px">
          <button id="tkSubmit" class="navtab" style="background:var(--green);color:#fff;border-color:var(--green)">Submit ticket</button>
          <button id="tkCancel" class="navtab">Cancel</button>
        </div>
      </div>`;
  }
  function wireForm(){
    const $=s=>document.getElementById("ticketModalOv").querySelector(s);
    $("#tkX").onclick=closeModal; $("#tkCancel").onclick=closeModal;
    const drop=$("#tkDrop"), file=$("#tkFile");
    drop.onclick=()=>file.click();
    file.onchange=()=>{ addFiles(file.files); file.value=""; };
    drop.addEventListener("dragover",e=>{ e.preventDefault(); drop.style.borderColor="var(--green)"; });
    drop.addEventListener("dragleave",()=>{ drop.style.borderColor="var(--line)"; });
    drop.addEventListener("drop",e=>{ e.preventDefault(); drop.style.borderColor="var(--line)"; addFiles(e.dataTransfer.files); });
    $("#tkSubmit").onclick=submit;
    document.querySelectorAll("#ticketModalOv .tkKind input").forEach(r=>r.onchange=()=>{
      document.querySelectorAll("#ticketModalOv .tkKind").forEach(l=>l.style.borderColor= l.querySelector("input").checked?"var(--green)":"var(--line)");
    });
  }
  async function addFiles(list){
    const msg=document.getElementById("tkMsg");
    for(const f of Array.from(list||[])){
      if(PICKED.length>=MAX_FILES){ msg.textContent=`Only ${MAX_FILES} screenshots allowed.`; break; }
      if(!ALLOWED.includes(f.type)){ msg.textContent=`"${f.name}" is not a supported image type.`; continue; }
      if(f.size>MAX_MB*1024*1024){ msg.textContent=`"${f.name}" is over ${MAX_MB}MB.`; continue; }
      try{ const dataUrl=await readFile(f); PICKED.push({name:f.name,mime:f.type,size:f.size,dataUrl}); }catch(_){ msg.textContent="Could not read "+f.name; }
    }
    renderThumbs();
  }
  function renderThumbs(){
    const box=document.getElementById("tkThumbs"); if(!box) return;
    box.innerHTML=PICKED.map((f,i)=>`<div style="position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:1px solid var(--line)">
      <img src="${f.dataUrl}" style="width:100%;height:100%;object-fit:cover">
      <span data-i="${i}" class="tkDel" title="Remove" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px">×</span>
    </div>`).join("");
    box.querySelectorAll(".tkDel").forEach(b=>b.onclick=()=>{ PICKED.splice(Number(b.dataset.i),1); renderThumbs(); });
  }
  async function submit(){
    const ov=document.getElementById("ticketModalOv");
    const kind=(ov.querySelector('input[name="tkKind"]:checked')||{}).value||"issue";
    const title=ov.querySelector("#tkTitle").value.trim();
    const description=ov.querySelector("#tkDesc").value.trim();
    const msg=ov.querySelector("#tkMsg"), btn=ov.querySelector("#tkSubmit");
    if(!title){ msg.textContent="Please add a title."; return; }
    btn.disabled=true; msg.textContent="Submitting…";
    const files=PICKED.map(f=>({name:f.name,mime:f.mime,dataB64:f.dataUrl}));
    try{
      const out=await api("/api/tickets",{method:"POST",body:JSON.stringify({kind,title,description,files})});
      ov.querySelector("#ticketModalCard").innerHTML=`<div class="modal-head"><span class="path">Ticket raised</span><span class="x" id="tkX2">×</span></div>
        <div class="modal-body" style="text-align:center;padding:26px 22px">
          <div style="font-size:34px">✅</div>
          <h2 style="margin:8px 0 4px">Thank you</h2>
          <div class="sub">Your ticket has been logged and is now under evaluation.</div>
          <div style="margin:16px 0;font-size:22px;font-weight:800;color:var(--green)">${esc(out.ref)}</div>
          <div class="sub">${out.emailed?"A confirmation email has been sent to you.":"Logged. (Email confirmation is not configured on this server.)"}</div>
          <div style="margin-top:18px"><button id="tkDone" class="navtab" style="background:var(--green);color:#fff;border-color:var(--green)">Done</button></div>
        </div>`;
      ov.querySelector("#tkDone").onclick=closeModal; ov.querySelector("#tkX2").onclick=closeModal;
      if(window.audit) window.audit("TICKET_RAISE_UI", out.ref);
    }catch(e){ msg.textContent="Error: "+e.message; btn.disabled=false; }
  }

  /* ============================ (b) Admin board (manageUsers) ============================ */
  let FILT={status:"",kind:"",search:""};
  function ensureBoard(){
    let v=document.getElementById("view-tickets");
    if(v) return v;
    const main=document.querySelector("main")||document.body;
    v=document.createElement("section"); v.id="view-tickets"; v.className="view";
    v.innerHTML=`<div class="page-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div><h1>Tickets &amp; feedback</h1>
      <div class="sub">Internal suggestions &amp; issues raised by console users. Update status, priority and add a resolution note.</div></div>
      <button id="ticketsNewBtn" class="navtab" style="background:var(--green);color:#fff;border-color:var(--green);white-space:nowrap;flex:0 0 auto">＋ New ticket</button></div>
      <div id="ticketsBoard" style="margin-top:12px"></div>`;
    const nb=v.querySelector("#ticketsNewBtn"); if(nb) nb.addEventListener("click",()=>window.openTicketModal());
    main.appendChild(v);
    return v;
  }
  window.openTicketsBoard=function(){
    ensureBoard();
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.add("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    document.getElementById("view-tickets").classList.add("active");
    renderBoard();
  };
  async function renderBoard(){
    const box=document.getElementById("ticketsBoard"); if(!box) return;
    box.innerHTML=`<div class="sub">Loading…</div>`;
    let data;
    const qs=[]; if(FILT.status) qs.push("status="+encodeURIComponent(FILT.status)); if(FILT.kind) qs.push("kind="+encodeURIComponent(FILT.kind)); if(FILT.search) qs.push("search="+encodeURIComponent(FILT.search));
    try{ data=await api("/api/tickets"+(qs.length?"?"+qs.join("&"):"")); }
    catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const c=data.counts||{};
    const chip=(val,label,color)=>`<button class="tkChip" data-status="${val}" style="font-size:11.5px;padding:4px 11px;border-radius:999px;border:1px solid ${FILT.status===val?(color||"var(--green)"):"var(--line)"};background:${FILT.status===val?(color||"var(--green)"):"var(--card2)"};color:${FILT.status===val?"#fff":"var(--ink-soft)"};cursor:pointer">${esc(label)}${val&&c[val]!=null?` <b>${c[val]}</b>`:""}</button>`;
    let h=`<div class="panel"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${chip("","All")}${STATUSES.map(s=>chip(s,STATUS_LABEL[s],STATUS_COLOR[s])).join("")}
      <span style="margin-inline-start:auto;display:flex;gap:8px;align-items:center">
        <select id="tkKindFilt" style="font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)">
          <option value="">All types</option><option value="issue"${FILT.kind==="issue"?" selected":""}>Issues</option><option value="enhancement"${FILT.kind==="enhancement"?" selected":""}>Suggestions</option></select>
        <input id="tkSearch" type="text" placeholder="Search ref / title / user" value="${esc(FILT.search)}" style="font-size:12px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink);width:200px">
        <button id="tkRefresh" class="navtab" style="font-size:12px;padding:5px 11px">Refresh</button>
      </span></div>`;
    const rows=data.tickets||[];
    h+=`<table style="width:100%;margin-top:12px;font-size:12.5px;border-collapse:collapse">
      <tr style="color:var(--muted);text-align:left"><th style="padding:6px 8px">Ref</th><th>Type</th><th>Title</th><th>Status</th><th>Priority</th><th>Raised by</th><th>When (KSA)</th><th></th></tr>`
      +(rows.length?rows.map(t=>`<tr class="tkRow" data-ref="${esc(t.ref)}" style="border-top:1px solid var(--line);cursor:pointer">
        <td style="padding:7px 8px;font-family:var(--mono);font-weight:700;white-space:nowrap">${esc(t.ref)}</td>
        <td>${t.kind==="enhancement"?"💡 Suggestion":"🐞 Issue"}</td>
        <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}${t.file_count?` <span class="sub">📎${t.file_count}</span>`:""}</td>
        <td>${statusPill(t.status)}</td><td>${esc(t.priority)}</td>
        <td>${esc(t.created_by||"—")}</td><td style="white-space:nowrap">${esc(ksaT(t.created_at))}</td>
        <td style="text-align:right;color:var(--muted)">›</td></tr>`).join("")
      :`<tr><td colspan="8" class="sub" style="padding:14px 8px">No tickets match this filter.</td></tr>`)
      +`</table></div>`;
    box.innerHTML=h;
    box.querySelectorAll(".tkChip").forEach(b=>b.onclick=()=>{ FILT.status=b.dataset.status; renderBoard(); });
    box.querySelector("#tkKindFilt").onchange=e=>{ FILT.kind=e.target.value; renderBoard(); };
    const s=box.querySelector("#tkSearch"); s.onkeydown=e=>{ if(e.key==="Enter"){ FILT.search=s.value.trim(); renderBoard(); } };
    box.querySelector("#tkRefresh").onclick=()=>{ FILT.search=(box.querySelector("#tkSearch").value||"").trim(); renderBoard(); };
    box.querySelectorAll(".tkRow").forEach(r=>r.onclick=()=>openDrawer(r.dataset.ref));
  }

  /* ---- detail drawer (admin) ---- */
  const _objUrls=[];
  function ensureDrawer(){
    let ov=document.getElementById("ticketDrawerOv");
    if(ov) return ov;
    ov=document.createElement("div"); ov.id="ticketDrawerOv"; ov.className="drawer-ov";
    ov.innerHTML=`<div class="drawer" id="ticketDrawerBody"></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click",e=>{ if(e.target===ov) closeDrawer(); });
    return ov;
  }
  function closeDrawer(){ const ov=document.getElementById("ticketDrawerOv"); if(ov) ov.classList.remove("open"); while(_objUrls.length){ try{ URL.revokeObjectURL(_objUrls.pop()); }catch(_){}} }
  async function openDrawer(ref){
    const ov=ensureDrawer(); const body=ov.querySelector("#ticketDrawerBody");
    body.innerHTML=`<div class="drawer-hd"><span>${esc(ref)}</span><span class="x" id="tdX">×</span></div><div style="padding:16px"><div class="sub">Loading…</div></div>`;
    ov.classList.add("open"); body.querySelector("#tdX").onclick=closeDrawer;
    let t;
    try{ t=await api("/api/tickets/"+encodeURIComponent(ref)); }
    catch(e){ body.innerHTML=`<div class="drawer-hd"><span>${esc(ref)}</span><span class="x" id="tdX">×</span></div><div style="padding:16px"><div class="albanner">${esc(e.message)}</div></div>`; body.querySelector("#tdX").onclick=closeDrawer; return; }
    renderDrawer(body,t);
  }
  function renderDrawer(body,t){
    const lbl="font-size:10.5px;letter-spacing:1px;color:var(--muted);font-weight:800;margin:16px 0 6px";
    const sel="padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink);font:inherit";
    let h=`<div class="drawer-hd"><span style="font-family:var(--mono);font-weight:700">${esc(t.ref)}</span> ${statusPill(t.status)}<span class="x" id="tdX">×</span></div>
      <div style="padding:16px 18px">
        <div style="font-size:16px;font-weight:700">${t.kind==="enhancement"?"💡 ":"🐞 "}${esc(t.title)}</div>
        <div class="sub" style="margin-top:4px">${esc(KIND_LABEL[t.kind]||t.kind)} · raised by <b>${esc(t.created_by||"—")}</b> · ${esc(ksaT(t.created_at))} KSA</div>
        ${t.description?`<div style="${lbl}">DESCRIPTION</div><div style="white-space:pre-wrap;font-size:13px;line-height:1.55;background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">${esc(t.description)}</div>`:""}`;
    if((t.files||[]).length){
      h+=`<div style="${lbl}">SCREENSHOTS (${t.files.length})</div><div id="tdImgs" style="display:flex;gap:8px;flex-wrap:wrap"></div>`;
    }
    // admin controls
    h+=`<div style="${lbl}">UPDATE</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:11.5px;color:var(--muted)">Status<br><select id="tdStatus" style="${sel};margin-top:3px">${STATUSES.map(s=>`<option value="${s}"${t.status===s?" selected":""}>${STATUS_LABEL[s]}</option>`).join("")}</select></label>
        <label style="font-size:11.5px;color:var(--muted)">Priority<br><select id="tdPriority" style="${sel};margin-top:3px">${PRIORITIES.map(p=>`<option value="${p}"${t.priority===p?" selected":""}>${p}</option>`).join("")}</select></label>
      </div>
      <div style="${lbl}">RESOLUTION / NOTE</div>
      <textarea id="tdResolution" rows="3" placeholder="Outcome, decision, or next step (emailed to the raiser on status change)" style="${sel};width:100%;resize:vertical">${esc(t.resolution||"")}</textarea>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
        <button id="tdSave" class="navtab" style="background:var(--green);color:#fff;border-color:var(--green)">Save changes</button>
        <span id="tdMsg" class="sub"></span></div>`;
    // comments
    h+=`<div style="${lbl}">COMMENTS</div><div id="tdComments">`;
    h+=(t.comments||[]).length?t.comments.map(c=>`<div style="border-top:1px solid var(--line);padding:8px 0;font-size:12.5px"><b>${esc(c.author||"—")}</b> <span class="sub">${esc(ksaT(c.at))}</span><div style="white-space:pre-wrap;margin-top:2px">${esc(c.body)}</div></div>`).join(""):`<div class="sub">No comments yet.</div>`;
    h+=`</div><div style="display:flex;gap:8px;margin-top:8px">
        <input id="tdComment" type="text" placeholder="Add a comment…" style="${sel};flex:1">
        <button id="tdAddComment" class="navtab">Add</button></div>
      </div>`;
    body.innerHTML=h;
    body.querySelector("#tdX").onclick=closeDrawer;
    // lazy-load screenshots as authenticated blobs
    if((t.files||[]).length){
      const imgs=body.querySelector("#tdImgs");
      t.files.forEach(f=>{
        const a=document.createElement("a"); a.style.cssText="display:block;width:96px;height:96px;border-radius:8px;overflow:hidden;border:1px solid var(--line)"; a.title=f.filename;
        const im=document.createElement("img"); im.style.cssText="width:100%;height:100%;object-fit:cover"; a.appendChild(im); imgs.appendChild(a);
        window.fetch(API+"/api/tickets/"+t.id+"/file/"+f.id).then(r=>r.ok?r.blob():null).then(b=>{ if(!b) return; const u=URL.createObjectURL(b); _objUrls.push(u); im.src=u; a.href=u; a.target="_blank"; }).catch(()=>{});
      });
    }
    body.querySelector("#tdSave").onclick=async()=>{
      const msg=body.querySelector("#tdMsg"); msg.textContent="Saving…";
      try{
        const out=await api("/api/tickets/"+encodeURIComponent(t.ref),{method:"PATCH",body:JSON.stringify({
          status:body.querySelector("#tdStatus").value, priority:body.querySelector("#tdPriority").value,
          resolution:body.querySelector("#tdResolution").value })});
        msg.textContent="Saved ✓"+(out.emailed?" · creator notified":"");
        renderBoard();
      }catch(e){ msg.textContent="Error: "+e.message; }
    };
    const ci=body.querySelector("#tdComment");
    const addC=async()=>{ const v=ci.value.trim(); if(!v) return; try{ await api("/api/tickets/"+encodeURIComponent(t.ref)+"/comments",{method:"POST",body:JSON.stringify({body:v})}); openDrawer(t.ref); }catch(e){ body.querySelector("#tdMsg").textContent="Error: "+e.message; } };
    body.querySelector("#tdAddComment").onclick=addC;
    ci.onkeydown=e=>{ if(e.key==="Enter") addC(); };
  }

  /* ---- self-wire the two entry points once the DOM is ready ---- */
  function wireEntries(){
    const raise=document.getElementById("hmRaiseTicket");
    if(raise) raise.onclick=()=>{ const hm=document.getElementById("helpMenu"); if(hm) hm.classList.remove("open"); window.openTicketModal(); };
    const board=document.querySelector('#settingsMenu [data-tickets]');
    if(board) board.onclick=()=>{ const sm=document.getElementById("settingsMenu"); if(sm) sm.classList.remove("open"); window.openTicketsBoard(); };
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",wireEntries); else wireEntries();
})();
