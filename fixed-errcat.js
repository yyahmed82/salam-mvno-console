/* fixed-errcat.js — Fixed › Troubleshoot: the ERROR CATALOGUE panel (15 Sep 2026).
 * Every distinct error message the Fixed side has logged (board = sda_ops error_events · app = combined.log), registered
 * automatically as it appears, with the AUTO class the rules give it and an OVERRIDE the operator can set:
 * Technical / Business. The effective class drives the board chips and pills, exports, the lane, the impact check,
 * the exec KPI and the alerts. Opened from the "Classify errors…" button in the Class row. */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt=n=>Number(n||0).toLocaleString("en-US");
  const ksa=v=>v?new Date(v).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Riyadh"}):"—";
  const CLS={ technical:{label:"Technical",color:"#ef4444",bg:"rgba(239,68,68,.14)"}, business:{label:"Business",color:"#3b82f6",bg:"rgba(59,130,246,.14)"} };
  const S={ q:"", src:"", cls:"", only:"", open:false, busy:false };
  const STYLE=`
    .ec-wrap{margin:6px 0 12px;border:1px solid var(--line);border-radius:14px;background:var(--card,#fff);box-shadow:0 1px 3px rgba(2,6,23,.05);overflow:hidden}
    .ec-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--line)} .ec-head h3{margin:0;font-size:14px;font-weight:800} .ec-head .ec-sub{font-size:12px;color:var(--muted)}
    .ec-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line)}
    .ec-tools input,.ec-tools select{font:inherit;font-size:12.5px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card2,#f8fafc);color:var(--ink)} .ec-tools input{flex:1 1 260px;min-width:0} .ec-tools input:focus,.ec-tools select:focus{outline:none;border-color:var(--green,#0e9f5a);box-shadow:0 0 0 3px rgba(14,159,90,.15)}
    .ec-btn{cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink)} .ec-btn:hover{border-color:var(--green,#0e9f5a);color:var(--green,#0e9f5a)} .ec-btn.p{background:var(--green,#0e9f5a);border-color:var(--green,#0e9f5a);color:#fff}
    .ec-tblwrap{overflow-x:auto;max-height:540px;overflow-y:auto} .ec-tbl{width:100%;border-collapse:collapse;font-size:12px} .ec-tbl th{position:sticky;top:0;background:var(--card,#fff);text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line)}
    .ec-tbl td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top} .ec-tbl tr:hover td{background:var(--card2,#f8fafc)}
    .ec-msg{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .ec-msg.full{white-space:normal;word-break:break-word}
    .ec-pill{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap} .ec-src{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:6px;background:rgba(125,133,144,.14);color:var(--muted)}
    .ec-new{font-size:10px;font-weight:800;color:#fff;background:#d97706;padding:1px 6px;border-radius:999px;margin-left:6px;vertical-align:1px}
    .ec-sel{font:inherit;font-size:12px;padding:5px 26px 5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2,#f8fafc);color:var(--ink);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 14px) 55%,calc(100% - 9px) 55%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
    .ec-sel.technical{border-color:#ef4444;color:#ef4444;font-weight:700} .ec-sel.business{border-color:#3b82f6;color:#3b82f6;font-weight:700}
    .ec-note{font:inherit;font-size:11.5px;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2,#f8fafc);color:var(--ink);width:150px}
    .ec-foot{padding:8px 16px;font-size:11.5px;color:var(--muted)} .ec-empty{padding:18px 16px;font-size:12.5px;color:var(--muted)}
    @media (max-width:640px){ .ec-msg{max-width:220px} .ec-note{width:100px} }`;
  const pill=c=>{ const x=CLS[c]; return x?`<span class="ec-pill" style="background:${x.bg};color:${x.color}">${x.label}</span>`:`<span class="ec-pill" style="background:rgba(125,133,144,.14);color:var(--muted)">unclassified</span>`; };

  async function load(el,fx){
    const t=el.querySelector("#ecBody"); if(!t) return; t.innerHTML=`<div class="ec-empty">${window.salamLoader?window.salamLoader("Reading the catalogue…"):"Loading…"}</div>`;
    let d; try{ d=await fx.api(`/api/fixed/errors/catalog?q=${encodeURIComponent(S.q)}&src=${S.src}&cls=${S.cls}&only=${S.only}`); }catch(e){ t.innerHTML=`<div class="ec-empty" style="color:#ef4444">${esc(e.message)}</div>`; return; }
    const T=d.totals||{}; const h=el.querySelector("#ecSub"); if(h) h.textContent=`${fmt(T.n)} distinct errors · ${fmt(T.technical)} technical · ${fmt(T.business)} business · ${fmt(T.overridden)} set by an operator · ${fmt(T.new7)} new in 7 d`;
    if(!(d.rows||[]).length){ t.innerHTML=`<div class="ec-empty">No error matches. New messages register within 5 minutes of being logged.</div>`; return; }
    t.innerHTML=`<div class="ec-tblwrap"><table class="ec-tbl"><thead><tr><th>Error message (digits masked)</th><th>Source · where</th><th>Seen</th><th>Auto</th><th>Effective</th><th>Set to</th><th>Note</th></tr></thead><tbody>${d.rows.map((r,i)=>`<tr data-i="${i}">
        <td><div class="ec-msg" title="${esc(r.sample||r.sig)}">${esc(r.sig)}${r.is_new?`<span class="ec-new">NEW</span>`:""}</div>${r.sample&&r.sample!==r.sig?`<div class="ec-msg full" style="color:var(--muted);font-size:10.5px;margin-top:2px">${esc(String(r.sample).slice(0,160))}</div>`:""}</td>
        <td><span class="ec-src">${r.src==="app"?"app log":"board"}</span><div style="font-size:11px;color:var(--muted);margin-top:3px">${esc(r.category||"")}${r.step?` · ${esc(String(r.step).replace(/^\/api\/transferRest\/(wsc|drm)\/prod\//,""))}`:""}</div></td>
        <td style="white-space:nowrap"><b>${fmt(r.total)}</b><div style="font-size:11px;color:var(--muted)">last ${esc(ksa(r.last_seen))}<br>first ${esc(ksa(r.first_seen))}</div></td>
        <td>${pill(r.auto_class)}</td><td>${pill(r.effective)}${r.class_override?`<div style="font-size:10.5px;color:var(--muted);margin-top:2px">${esc(r.updated_by||"")} · ${esc(ksa(r.updated_at))}</div>`:""}</td>
        <td><select class="ec-sel ${r.class_override||""}" data-sig="${esc(r.sig)}" data-src="${esc(r.src)}"><option value=""${!r.class_override?" selected":""}>Auto (${r.auto_class||"?"})</option><option value="technical"${r.class_override==="technical"?" selected":""}>Technical</option><option value="business"${r.class_override==="business"?" selected":""}>Business</option></select></td>
        <td><input class="ec-note" placeholder="why…" value="${esc(r.note||"")}" data-sig="${esc(r.sig)}" data-src="${esc(r.src)}"></td></tr>`).join("")}</tbody></table></div>
      <div class="ec-foot">Auto = what the rules decide (category → HTTP 5xx → message text; an empty message is technical, a readable "no" is business). Setting a class here overrides the rules everywhere — board, exports, lane, impact check, dashboards, alerts — and re-labels the last 30 days of app-log rows. Business = the API answered with a NO (blacklist, wrong OTP, no ports, NIC mismatch). Technical = the platform / provider failed (timeout, 5xx, unknown error, CC-S-… codes).</div>`;
    t.querySelectorAll(".ec-sel").forEach(sel=>sel.onchange=async()=>{ const tr=sel.closest("tr"); const note=tr.querySelector(".ec-note").value.trim(); sel.disabled=true;
      try{ const r=await fx.api("/api/fixed/errors/catalog/classify",{method:"POST",body:JSON.stringify({sig:sel.dataset.sig,src:sel.dataset.src,cls:sel.value,note})}); sel.className="ec-sel "+(sel.value||""); tr.children[4].innerHTML=pill(sel.value||r.auto_class)+(sel.value?`<div style="font-size:10.5px;color:var(--muted);margin-top:2px">just now${r.relabelled?` · ${fmt(r.relabelled)} rows re-labelled`:""}</div>`:"");
        if(window.__feReload) window.__feReload(); }
      catch(e){ alert("Could not save: "+e.message); } finally{ sel.disabled=false; } });
    t.querySelectorAll(".ec-note").forEach(inp=>inp.onkeydown=async ev=>{ if(ev.key!=="Enter") return; ev.preventDefault(); const tr=inp.closest("tr"); const sel=tr.querySelector(".ec-sel"); try{ await fx.api("/api/fixed/errors/catalog/classify",{method:"POST",body:JSON.stringify({sig:inp.dataset.sig,src:inp.dataset.src,cls:sel.value,note:inp.value.trim()})}); inp.style.borderColor="var(--green,#0e9f5a)"; setTimeout(()=>inp.style.borderColor="",1200); }catch(e){ alert("Could not save: "+e.message); } });
  }

  function render(el,fx){
    if(!el) return;
    if(!document.getElementById("ecStyle")){ const st=document.createElement("style"); st.id="ecStyle"; st.textContent=STYLE; document.head.appendChild(st); }
    if(!S.open){ el.innerHTML=""; return; }
    el.innerHTML=`<div class="ec-wrap"><div class="ec-head"><h3>Error catalogue — classification</h3><span class="ec-sub" id="ecSub">loading…</span><span style="margin-left:auto;display:flex;gap:6px"><button type="button" class="ec-btn" id="ecSync" title="Register what was logged since the last sync (runs every 5 min anyway)">Sync now</button><button type="button" class="ec-btn" id="ecClose">Close</button></span></div>
      <div class="ec-tools"><input id="ecQ" placeholder="search message · category · step…" value="${esc(S.q)}">
        <select id="ecSrc"><option value="">Both sources</option><option value="board"${S.src==="board"?" selected":""}>Board (sda_ops)</option><option value="app"${S.src==="app"?" selected":""}>App log</option></select>
        <select id="ecCls"><option value="">Any class</option><option value="technical"${S.cls==="technical"?" selected":""}>Technical</option><option value="business"${S.cls==="business"?" selected":""}>Business</option></select>
        <select id="ecOnly"><option value="">All</option><option value="new"${S.only==="new"?" selected":""}>New in 7 days</option><option value="unreviewed"${S.only==="unreviewed"?" selected":""}>Not reviewed (auto only)</option><option value="overridden"${S.only==="overridden"?" selected":""}>Set by an operator</option></select></div>
      <div id="ecBody"></div></div>`;
    let deb=null; const q=el.querySelector("#ecQ"); q.oninput=()=>{ clearTimeout(deb); deb=setTimeout(()=>{ S.q=q.value.trim(); load(el,fx); },400); };
    el.querySelector("#ecSrc").onchange=e=>{ S.src=e.target.value; load(el,fx); }; el.querySelector("#ecCls").onchange=e=>{ S.cls=e.target.value; load(el,fx); }; el.querySelector("#ecOnly").onchange=e=>{ S.only=e.target.value; load(el,fx); };
    el.querySelector("#ecClose").onclick=()=>{ S.open=false; render(el,fx); };
    el.querySelector("#ecSync").onclick=async ev=>{ ev.target.disabled=true; try{ await fx.api("/api/fixed/errors/catalog/sync",{method:"POST",body:"{}"}); await load(el,fx); }catch(e){ alert(e.message); } finally{ ev.target.disabled=false; } };
    load(el,fx);
  }
  window.fixedErrCat={ toggle:(el,fx)=>{ S.open=!S.open; render(el,fx); }, render, isOpen:()=>S.open };
})();
