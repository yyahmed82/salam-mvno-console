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
  const API = window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts))
    .then(r=>{ if(!r.ok) return r.json().catch(()=>({})).then(e=>{ throw new Error(e.error||("HTTP "+r.status)); }); return r.json(); });

  const MAX_FILES=4, MAX_MB=5, ALLOWED=["image/png","image/jpeg","image/webp","image/gif"];
  const KIND_LABEL={enhancement:"Suggestion / enhancement",issue:"Issue"};
  const SEG_LABEL={mobile:"Mobile",fixed:"Fixed"};
  const segPill=sg=>sg==="fixed"?`<span class="tk-seg tk-seg-fixed">🏠 Fixed</span>`:`<span class="tk-seg tk-seg-mobile">📱 Mobile</span>`;
  // default business = where the user is: any Fixed page → Fixed, else Mobile
  const guessSegment=()=>/^#fixed/.test(location.hash||"")?"fixed":"mobile";
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
    ov.innerHTML=`<div class="modal-card tkm-card" id="ticketModalCard" style="max-width:640px"></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click",e=>{ if(e.target===ov) closeModal(); });
    return ov;
  }
  function closeModal(){ const ov=document.getElementById("ticketModalOv"); if(ov) ov.classList.remove("open"); PICKED=[]; }
  window.openTicketModal=function(){
    const ov=ensureModal(); PICKED=[]; TK_SEG=guessSegment(); TK_KIND="issue";
    ov.querySelector("#ticketModalCard").innerHTML=formHtml();
    ov.classList.add("open");
    wireForm();
  };
  /* Business-first modal (6 Sep 2026): step 1 = which business (two themed tabs, Mobile blue / Fixed green);
   * step 2 = the form for that business (type as segmented pills, title, description, screenshots).
   * The chosen business drives the accent colour, the header copy and the placeholder hints. */
  let TK_SEG=null, TK_KIND="issue";
  const SEG_META={
    mobile:{ic:"📱",name:"Mobile",tag:"MVNO",blurb:"Selfcare app · DMS dealers · payments · activation · SIM / eSIM",accent:"#2563eb",soft:"rgba(37,99,235,.12)",
      ph:"e.g. eSIM activation stuck at 'processing' for MSISDN …924",dph:"What happened? Which line / order / payment? What did you expect? Steps to reproduce…"},
    fixed:{ic:"🏠",name:"Fixed",tag:"FTTH · FTTB · 5G home",blurb:"SDA dealers · e-purchase / QR · Salam Home app · BSS orders",accent:"#0e9f5a",soft:"rgba(14,159,90,.12)",
      ph:"e.g. feasibility check fails for ODB KRZAHR05053 on the app",dph:"What happened? Which service / ODB / order / dealer? What did you expect? Steps to reproduce…"}};
  function formHtml(){
    const m=TK_SEG?SEG_META[TK_SEG]:null;
    const tab=(k)=>{ const x=SEG_META[k]; const on=TK_SEG===k; return `<button type="button" class="tkb-tab${on?" on":""}" data-seg="${k}" style="--acc:${x.accent};--soft:${x.soft}">
        <span class="tkb-ic">${x.ic}</span><span class="tkb-txt"><b>${x.name}</b><small>${x.tag}</small></span>${on?'<span class="tkb-chk">✓</span>':''}</button>`; };
    const kind=(k,l,sub,ic)=>`<button type="button" class="tkk${TK_KIND===k?" on":""}" data-kind="${k}"><span class="tkk-ic">${ic}</span><span><b>${l}</b><small>${sub}</small></span></button>`;
    return `<div class="tkm" style="--acc:${m?m.accent:"var(--green)"};--soft:${m?m.soft:"var(--green-bg)"}">
      <div class="tkm-head"><div><div class="tkm-title">Raise a ticket</div><div class="tkm-sub">${m?`${m.ic} ${m.name} · ${m.blurb}`:"Report an issue or suggest an improvement — you'll get an e-mail when it is under evaluation."}</div></div><button type="button" class="tkm-x" id="tkX" title="Close (Esc)">✕</button></div>
      <div class="tkm-step"><span class="tkm-n">1</span> Which business is this about?</div>
      <div class="tkb-tabs">${tab("mobile")}${tab("fixed")}</div>
      ${m?`<div class="tkm-form">
        <div class="tkm-step"><span class="tkm-n">2</span> Tell us what you need</div>
        <div class="tkk-row">${kind("issue","Issue","Something is broken or wrong","🐞")}${kind("enhancement","Suggestion","An enhancement or a new idea","💡")}</div>
        <label class="tkm-lbl">Title</label>
        <input id="tkTitle" class="tkm-in" type="text" maxlength="300" placeholder="${esc(m.ph)}">
        <label class="tkm-lbl">Description</label>
        <textarea id="tkDesc" class="tkm-in" rows="5" placeholder="${esc(m.dph)}"></textarea>
        <label class="tkm-lbl">Screenshots <span>optional · up to ${MAX_FILES} · PNG / JPG / WEBP / GIF · ${MAX_MB} MB each</span></label>
        <div id="tkDrop" class="tkm-drop">🖼️ Drag &amp; drop images here, or <b>browse</b><input id="tkFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple style="display:none"></div>
        <div id="tkThumbs" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"></div>
        <div id="tkMsg" class="sub" style="margin-top:8px;min-height:16px"></div>
        <div class="tkm-actions"><button type="button" id="tkSubmit" class="tkm-btn primary">${m.ic} Submit ${m.name} ticket</button><button type="button" id="tkCancel" class="tkm-btn">Cancel</button>
          <span class="tkm-hint">${TK_KIND==="issue"?"Goes to the console team as an issue":"Logged as a suggestion for the roadmap"}</span></div>
      </div>`:`<div class="tkm-empty">Pick <b>Mobile</b> or <b>Fixed</b> to continue — the form adapts to the business.</div>`}
    </div>`;
  }
  function wireForm(){
    const ov=document.getElementById("ticketModalOv"); const $=s=>ov.querySelector(s);
    const rerender=()=>{ const t=$("#tkTitle"), d=$("#tkDesc"); const keep={t:t?t.value:"",d:d?d.value:""}; $("#ticketModalCard").innerHTML=formHtml(); wireForm(); const t2=$("#tkTitle"), d2=$("#tkDesc"); if(t2) t2.value=keep.t; if(d2) d2.value=keep.d; renderThumbs(); };
    $("#tkX").onclick=closeModal;
    ov.querySelectorAll(".tkb-tab").forEach(b=>b.onclick=()=>{ TK_SEG=b.dataset.seg; rerender(); const t=$("#tkTitle"); if(t) t.focus(); });
    ov.querySelectorAll(".tkk").forEach(b=>b.onclick=()=>{ TK_KIND=b.dataset.kind; rerender(); });
    if(!ov.__esc){ ov.__esc=e=>{ if(e.key==="Escape"&&ov.classList.contains("open")) closeModal(); }; document.addEventListener("keydown",ov.__esc); }
    const cancel=$("#tkCancel"); if(cancel) cancel.onclick=closeModal;
    const drop=$("#tkDrop"), file=$("#tkFile"); if(!drop) return;
    drop.onclick=()=>file.click();
    file.onchange=()=>{ addFiles(file.files); file.value=""; };
    drop.addEventListener("dragover",e=>{ e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave",()=>{ drop.classList.remove("over"); });
    drop.addEventListener("drop",e=>{ e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
    $("#tkSubmit").onclick=submit;
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
    const kind=TK_KIND||"issue";
    const segment=TK_SEG||"mobile";
    const title=ov.querySelector("#tkTitle").value.trim();
    const description=ov.querySelector("#tkDesc").value.trim();
    const msg=ov.querySelector("#tkMsg"), btn=ov.querySelector("#tkSubmit");
    if(!title){ msg.textContent="Please add a title."; return; }
    btn.disabled=true; msg.textContent="Submitting…";
    const files=PICKED.map(f=>({name:f.name,mime:f.mime,dataB64:f.dataUrl}));
    try{
      const out=await api("/api/tickets",{method:"POST",body:JSON.stringify({kind,segment,title,description,files})});
      const m=SEG_META[segment]||SEG_META.mobile;
      ov.querySelector("#ticketModalCard").innerHTML=`<div class="tkm" style="--acc:${m.accent};--soft:${m.soft}">
        <div class="tkm-head"><div><div class="tkm-title">Ticket raised</div><div class="tkm-sub">${m.ic} ${m.name} · ${kind==="issue"?"issue":"suggestion"}</div></div><button type="button" class="tkm-x" id="tkX2" title="Close">✕</button></div>
        <div style="text-align:center;padding:26px 22px 8px">
          <div style="width:64px;height:64px;border-radius:50%;background:var(--soft);display:inline-flex;align-items:center;justify-content:center;font-size:30px;animation:tkPop .25s cubic-bezier(.2,.8,.2,1)">✅</div>
          <h2 style="margin:12px 0 4px;font-size:18px">Thank you</h2>
          <div class="sub">Your ${m.name} ticket is logged and now under evaluation.</div>
          <div style="margin:16px 0 6px;font-size:22px;font-weight:800;color:var(--acc);letter-spacing:.3px">${esc(out.ref)}</div>
          <div class="sub">${out.emailed?"A confirmation e-mail has been sent to you.":"Logged. (E-mail confirmation is not configured on this server.)"}</div>
          <div style="margin-top:18px"><button type="button" id="tkDone" class="tkm-btn primary">Done</button></div>
        </div></div>`;
      ov.querySelector("#tkDone").onclick=closeModal; ov.querySelector("#tkX2").onclick=closeModal;
      if(window.audit) window.audit("TICKET_RAISE_UI", out.ref);
    }catch(e){ msg.textContent="Error: "+e.message; btn.disabled=false; }
  }

  /* ============================ (b) Admin board (manageUsers) ============================ */
  let FILT={status:"",kind:"",segment:"",search:""};
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
    const qs=[]; if(FILT.status) qs.push("status="+encodeURIComponent(FILT.status)); if(FILT.kind) qs.push("kind="+encodeURIComponent(FILT.kind)); if(FILT.segment) qs.push("segment="+encodeURIComponent(FILT.segment)); if(FILT.search) qs.push("search="+encodeURIComponent(FILT.search));
    try{ data=await api("/api/tickets"+(qs.length?"?"+qs.join("&"):"")); }
    catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const c=data.counts||{};
    const chip=(val,label,color)=>`<button class="tkChip" data-status="${val}" style="font-size:11.5px;padding:4px 11px;border-radius:999px;border:1px solid ${FILT.status===val?(color||"var(--green)"):"var(--line)"};background:${FILT.status===val?(color||"var(--green)"):"var(--card2)"};color:${FILT.status===val?"#fff":"var(--ink-soft)"};cursor:pointer">${esc(label)}${val&&c[val]!=null?` <b>${c[val]}</b>`:""}</button>`;
    let h=`<div class="panel"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${chip("","All")}${STATUSES.map(s=>chip(s,STATUS_LABEL[s],STATUS_COLOR[s])).join("")}
      <span style="margin-inline-start:auto;display:flex;gap:8px;align-items:center">
        <select id="tkSegFilt" style="font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)">
          <option value="">📱🏠 Both businesses</option><option value="mobile"${FILT.segment==="mobile"?" selected":""}>📱 Mobile${data.bySegment&&data.bySegment.mobile!=null?" ("+data.bySegment.mobile+" open)":""}</option><option value="fixed"${FILT.segment==="fixed"?" selected":""}>🏠 Fixed${data.bySegment&&data.bySegment.fixed!=null?" ("+data.bySegment.fixed+" open)":""}</option></select>
        <select id="tkKindFilt" style="font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)">
          <option value="">All types</option><option value="issue"${FILT.kind==="issue"?" selected":""}>Issues</option><option value="enhancement"${FILT.kind==="enhancement"?" selected":""}>Suggestions</option></select>
        <input id="tkSearch" type="text" placeholder="Search ref / title / user" value="${esc(FILT.search)}" style="font-size:12px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink);width:200px">
        <button id="tkRefresh" class="navtab" style="font-size:12px;padding:5px 11px">Refresh</button>
      </span></div>`;
    const rows=data.tickets||[];
    h+=`<table style="width:100%;margin-top:12px;font-size:12.5px;border-collapse:collapse">
      <tr style="color:var(--muted);text-align:left"><th style="padding:6px 8px">Ref</th><th>Business</th><th>Type</th><th>Title</th><th>Status</th><th>Priority</th><th>Raised by</th><th>When (KSA)</th><th></th></tr>`
      +(rows.length?rows.map(t=>`<tr class="tkRow" data-ref="${esc(t.ref)}" style="border-top:1px solid var(--line);cursor:pointer">
        <td style="padding:7px 8px;font-family:var(--mono);font-weight:700;white-space:nowrap">${esc(t.ref)}</td>
        <td>${segPill(t.segment)}</td>
        <td>${t.kind==="enhancement"?"💡 Suggestion":"🐞 Issue"}</td>
        <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}${t.file_count?` <span class="sub">📎${t.file_count}</span>`:""}</td>
        <td>${statusPill(t.status)}</td><td>${esc(t.priority)}</td>
        <td>${esc(t.created_by||"—")}</td><td style="white-space:nowrap">${esc(ksaT(t.created_at))}</td>
        <td style="text-align:right;color:var(--muted)">›</td></tr>`).join("")
      :`<tr><td colspan="9" class="sub" style="padding:14px 8px">No tickets match this filter.</td></tr>`)
      +`</table></div>`;
    box.innerHTML=h;
    box.querySelectorAll(".tkChip").forEach(b=>b.onclick=()=>{ FILT.status=b.dataset.status; renderBoard(); });
    box.querySelector("#tkKindFilt").onchange=e=>{ FILT.kind=e.target.value; renderBoard(); };
    box.querySelector("#tkSegFilt").onchange=e=>{ FILT.segment=e.target.value; renderBoard(); };
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
        <div class="sub" style="margin-top:4px">${segPill(t.segment)} · ${esc(KIND_LABEL[t.kind]||t.kind)} · raised by <b>${esc(t.created_by||"—")}</b> · ${esc(ksaT(t.created_at))} KSA</div>
        ${t.description?`<div style="${lbl}">DESCRIPTION</div><div style="white-space:pre-wrap;font-size:13px;line-height:1.55;background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">${esc(t.description)}</div>`:""}`;
    if((t.files||[]).length){
      h+=`<div style="${lbl}">SCREENSHOTS (${t.files.length})</div><div id="tdImgs" style="display:flex;gap:8px;flex-wrap:wrap"></div>`;
    }
    // admin controls
    h+=`<div style="${lbl}">UPDATE</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:11.5px;color:var(--muted)">Status<br><select id="tdStatus" style="${sel};margin-top:3px">${STATUSES.map(s=>`<option value="${s}"${t.status===s?" selected":""}>${STATUS_LABEL[s]}</option>`).join("")}</select></label>
        <label style="font-size:11.5px;color:var(--muted)">Priority<br><select id="tdPriority" style="${sel};margin-top:3px">${PRIORITIES.map(p=>`<option value="${p}"${t.priority===p?" selected":""}>${p}</option>`).join("")}</select></label>
        <label style="font-size:11.5px;color:var(--muted)">Business<br><select id="tdSegment" style="${sel};margin-top:3px"><option value="mobile"${(t.segment||"mobile")==="mobile"?" selected":""}>📱 Mobile</option><option value="fixed"${t.segment==="fixed"?" selected":""}>🏠 Fixed</option></select></label>
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
          status:body.querySelector("#tdStatus").value, priority:body.querySelector("#tdPriority").value, segment:body.querySelector("#tdSegment").value,
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
