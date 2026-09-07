/* democfg.js — Settings › Demo mode (#settings-demo). Record-and-replay control for the presenter:
 *   · Record   — every API response the pages fetch is stored in a named set (browse the demo path once)
 *   · Replay   — pages answer from the set in ~1 ms, timestamps shifted to now, writes never reach prod
 *   · Off      — live data again
 * Per signed-in user (server/src/demo.js) — nobody else is affected. Same standalone-view pattern as
 * notifyclone.js. Buttons follow the console's green system; Record is the one red action. */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const API=window.API_BASE||"";
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(async r=>{ const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j; });
  const fmt=n=>Number(n||0).toLocaleString();
  const ts=iso=>{ try{ return new Date(iso).toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); }catch(e){ return iso||"—"; } };
  let ST=null, busy=false, armDel=null;

  const STYLE=`
    #view-demo .dm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
    #view-demo .dm-mode{display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:13px;padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card2,#f8fafc)}
    #view-demo .dm-mode.replay{border-color:var(--violet,#7c3aed);color:var(--violet,#7c3aed);background:rgba(124,58,237,.08)}
    #view-demo .dm-mode.record{border-color:#dc2626;color:#dc2626;background:rgba(220,38,38,.08)}
    #view-demo .dm-mode .dot{width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block}
    #view-demo .dm-mode.record .dot{animation:dmblink 1s infinite} @keyframes dmblink{50%{opacity:.25}}
    #view-demo .dm-btn{cursor:pointer;font:inherit;font-size:12.5px;font-weight:700;padding:8px 16px;border-radius:10px;border:1px solid var(--green,#0e9f5a);background:var(--green,#0e9f5a);color:#fff;display:inline-flex;align-items:center;gap:6px;transition:filter .15s,transform .06s} #view-demo .dm-btn:hover{filter:brightness(1.06)} #view-demo .dm-btn:active{transform:translateY(1px)} #view-demo .dm-btn:disabled{opacity:.55;cursor:progress}
    #view-demo .dm-btn.ghost{background:var(--card,#fff);color:var(--green,#0e9f5a)} #view-demo .dm-btn.ghost:hover{background:var(--green,#0e9f5a);color:#fff}
    #view-demo .dm-btn.rec{background:#dc2626;border-color:#dc2626} #view-demo .dm-btn.violet{background:var(--violet,#7c3aed);border-color:var(--violet,#7c3aed)}
    #view-demo .dm-btn.sm{padding:5px 11px;font-size:11.5px;border-radius:999px}
    #view-demo .dm-in{font:inherit;font-size:13px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card,#fff);color:var(--ink);min-width:220px}
    #view-demo .dm-cov{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
    #view-demo .dm-cov div{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;font-size:12.5px;background:var(--card2,#f8fafc)}
    #view-demo .dm-cov .ok{color:var(--green,#0e9f5a);font-weight:800} #view-demo .dm-cov .no{color:var(--muted);font-weight:700}
    #view-demo table.dm-t{width:100%;border-collapse:collapse;font-size:12.5px} #view-demo .dm-t th{text-align:left;font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line)} #view-demo .dm-t td{padding:9px 10px;border-bottom:1px solid var(--line-soft,var(--line));vertical-align:middle}
    #view-demo .dm-star{cursor:pointer;font-size:15px;color:var(--muted)} #view-demo .dm-star.on{color:#d97706}
    #view-demo .dm-note{font-size:12px;color:var(--muted);line-height:1.5}
    #view-demo .dm-banner{border-left:4px solid var(--green,#0e9f5a);background:var(--card2,#f8fafc);border-radius:10px;padding:10px 14px;font-size:12.5px;margin-top:10px}
    #view-demo .dm-banner.err{border-left-color:#dc2626}
    @media (max-width:700px){ #view-demo .dm-in{min-width:0;width:100%} #view-demo .dm-row{flex-direction:column;align-items:stretch} }
  `;

  function ensureView(){
    let v=document.getElementById("view-demo"); if(v) return v;
    const main=document.querySelector("main")||document.body;
    v=document.createElement("section"); v.id="view-demo"; v.className="view";
    v.innerHTML=`<style>${STYLE}</style><div class="page-head"><h1>Demo mode</h1>
      <div class="sub">Record the demo path once, then replay it instantly — every page answers from stored responses, timestamps shifted to now, nothing written to production. Applies to <b>your</b> session only.</div></div>
      <div id="demoHost" style="margin-top:12px"></div>`;
    main.appendChild(v); return v;
  }

  function modeChip(st){ const m=st.mode||"off"; return `<span class="dm-mode ${m}"><span class="dot"></span>${m==="replay"?"REPLAY · "+esc(st.set):m==="record"?"RECORDING · "+esc(st.set):"OFF · live data"}</span>`; }

  function render(msg){
    const host=document.getElementById("demoHost"); if(!host||!ST) return;
    const st=ST, sets=st.sets||[], cov=st.coverage||[];
    const setNames=sets.map(s=>s.name);
    const curSet=st.set||(sets[0]&&sets[0].name)||"CIO demo";
    host.innerHTML=`
      ${msg?`<div class="dm-banner${msg.err?" err":""}">${esc(msg.text)}</div>`:""}
      <div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0 0 4px">Status</h2><div class="dm-note">Mode of your session. Switching reloads the console so every page re-fetches.</div></div>${modeChip(st)}</div>
        <div class="dm-row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">
          <input id="dmSet" class="dm-in" list="dmSets" placeholder="Set name (e.g. CIO demo)" value="${esc(curSet)}"><datalist id="dmSets">${setNames.map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
          <button class="dm-btn rec" id="dmRec" ${st.mode==="record"?"disabled":""}>● Record</button>
          <button class="dm-btn violet" id="dmPlay" ${st.mode==="replay"?"disabled":""}>▶ Replay</button>
          <button class="dm-btn ghost" id="dmOff" ${st.mode==="off"?"disabled":""}>■ Off · live</button>
        </div>
        <div class="dm-note" style="margin-top:10px"><b>How to record:</b> press Record, then open in order — Home · Mobile dashboard · Monitoring (Gateway, Payments, Access) · Alerts · Fixed overview · SDA map · Errors (click a row, Open full trace) · Fixed alerts · Customer 360 with your number (Mobile and Fixed) · Tickets · Yusr (ask the 3–4 questions you will ask on stage) — then press Replay. Re-record any page later: Record again on the same set only overwrites what you open.</div>
      </div>
      <div class="panel"><h2 style="margin:0 0 8px">Coverage · ${esc(st.set||curSet)}</h2><div class="dm-note" style="margin-bottom:10px">Which parts of the demo path the set already holds (number of distinct responses).</div>
        <div class="dm-cov">${cov.map(c=>`<div><span>${esc(c.label)}</span>${c.recorded?`<span class="ok">✓ ${c.recorded}</span>`:`<span class="no">— not yet</span>`}</div>`).join("")}</div></div>
      <div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">Recorded sets</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="dm-btn ghost sm" id="dmWarm" title="Replay the ★ set against the server now to fill the response cache — the first paint after a deploy becomes fast for everyone">⚡ Warm cache now</button>
        <label class="dm-btn ghost sm" style="cursor:pointer">⬆ Import JSON<input id="dmImport" type="file" accept="application/json" hidden></label></div></div>
        <div class="dm-note" style="margin:6px 0 10px">★ marks the set replayed after every deploy to warm the cache (live data still wins for users — this only pre-computes it).</div>
        ${sets.length?`<div class="tscroll"><table class="dm-t"><thead><tr><th>★</th><th>Set</th><th>Responses</th><th>Captured</th><th>Replays</th><th>By</th><th></th></tr></thead><tbody>
          ${sets.map(s=>`<tr><td><span class="dm-star${s.warmup?" on":""}" data-warm="${esc(s.name)}" title="Use for cache warm-up">★</span></td><td><b>${esc(s.name)}</b>${s.note?`<div class="dm-note">${esc(s.note)}</div>`:""}</td><td>${fmt(s.responses)}</td><td>${s.captured_at?ts(s.captured_at):"—"}</td><td>${fmt(s.hits)}</td><td>${esc(s.created_by||"—")}</td>
            <td style="white-space:nowrap;text-align:right"><a class="dm-btn ghost sm" href="${API}/api/demo/sets/${encodeURIComponent(s.name)}/export" data-export="${esc(s.name)}">⬇ Export</a> <button class="dm-btn ghost sm" data-del="${esc(s.name)}" style="${armDel===s.name?"border-color:#dc2626;color:#dc2626":""}">${armDel===s.name?"Confirm delete":"Delete"}</button></td></tr>`).join("")}
        </tbody></table></div>`:`<div class="dm-note">No set yet — type a name and press Record.</div>`}
      </div>
      <div class="panel"><h2 style="margin:0 0 6px">What replay changes</h2><div class="dm-note">Reads answer from the set (falls back to live when a page was not recorded). Writes — ack, ticket, block user, rule edit — never reach the database: a recorded answer is returned, otherwise "Demo mode — nothing was changed". Yusr answers recorded questions instantly; new questions go to the live model. The ⚙ gear shows a violet dot while replay is on; nothing else in the chrome changes.</div></div>`;
    const $=s=>host.querySelector(s);
    const setName=()=>$("#dmSet").value.trim();
    const go=async(mode)=>{ if(busy) return; busy=true; try{ ST=await api("/api/demo/state",{method:"POST",body:JSON.stringify({mode,set:setName()})}); markGear(ST); if(mode!=="off"||true){ setTimeout(()=>{ location.hash="#home"; location.reload(); },150); } }catch(e){ render({err:true,text:e.message}); } finally{ busy=false; } };
    $("#dmRec").onclick=()=>{ if(!setName()) return render({err:true,text:"Give the set a name first."}); go("record"); };
    $("#dmPlay").onclick=()=>{ if(!setName()) return render({err:true,text:"Pick the set to replay."}); go("replay"); };
    $("#dmOff").onclick=()=>go("off");
    host.querySelectorAll("[data-warm]").forEach(el=>el.onclick=async()=>{ try{ const r=await api("/api/demo/sets/"+encodeURIComponent(el.dataset.warm),{method:"PATCH",body:JSON.stringify({warmup:!el.classList.contains("on")})}); ST.sets=r.sets; render(); }catch(e){ render({err:true,text:e.message}); } });
    host.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{ const n=b.dataset.del; if(armDel!==n){ armDel=n; render(); setTimeout(()=>{ if(armDel===n){ armDel=null; render(); } },4000); return; }
      armDel=null; try{ const r=await api("/api/demo/sets/"+encodeURIComponent(n),{method:"DELETE"}); ST=await api("/api/demo/state"); render({text:`Set "${n}" deleted.`}); }catch(e){ render({err:true,text:e.message}); } });
    host.querySelectorAll("[data-export]").forEach(a=>a.onclick=async e=>{ e.preventDefault(); try{ const r=await window.fetch(a.href); if(!r.ok) throw new Error("HTTP "+r.status); const b=await r.blob(); const u=URL.createObjectURL(b); const l=document.createElement("a"); l.href=u; l.download=`demo-${a.dataset.export}.json`; document.body.appendChild(l); l.click(); l.remove(); setTimeout(()=>URL.revokeObjectURL(u),2000); }catch(err){ render({err:true,text:"Export failed — "+err.message}); } });
    $("#dmImport").onchange=async e=>{ const f=e.target.files[0]; if(!f) return; try{ const j=JSON.parse(await f.text()); const name=prompt("Import into set name:", j.name||setName()||"imported"); if(!name) return; const r=await api("/api/demo/sets/import",{method:"POST",body:JSON.stringify({name,rows:j.rows||[]})}); ST=await api("/api/demo/state"); render({text:`Imported ${r.imported} responses into "${name}".`}); }catch(err){ render({err:true,text:"Import failed — "+err.message}); } };
    $("#dmWarm").onclick=async()=>{ const b=$("#dmWarm"); b.disabled=true; b.textContent="… warming"; try{ const r=await api("/api/demo/warmup",{method:"POST",body:"{}"}); render({text:r.set?`Warmed ${r.warmed} responses from "${r.set}" in ${Math.round(r.ms/1000)} s${r.failed?` (${r.failed} failed)`:""}.`:r.reason||"Nothing to warm — mark a set with ★ first."}); }catch(e){ render({err:true,text:e.message}); } };
  }

  function markGear(st){ const g=document.getElementById("settingsBtn"); if(!g) return; g.classList.toggle("demo-on", !!(st&&st.mode==="replay")); g.classList.toggle("demo-rec", !!(st&&st.mode==="record")); }

  async function load(){ try{ ST=await api("/api/demo/state"); markGear(ST); render(); }catch(e){ const h=document.getElementById("demoHost"); if(h) h.innerHTML=`<div class="dm-banner err">${esc(e.message)}</div>`; } }

  window.openDemoSettings=function(){
    ensureView();
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.add("on");
    const v=document.getElementById("view-demo"); if(v) v.classList.add("active");
    load();
  };
  // gear indicator at boot (per-user state lives on the server)
  document.addEventListener("consoleReady", ()=>{ setTimeout(()=>{
    try{ const it=document.getElementById("demoMenuItem"); const s=window.opsSession&&window.opsSession(); if(it) it.style.display=(s&&s.me&&s.me.caps&&s.me.caps.manageSync)?"":"none"; }catch(e){}
    api("/api/demo/state").then(markGear).catch(()=>{}); }, 800); });
})();
