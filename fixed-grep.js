/* fixed-grep.js — Fixed › Troubleshoot: "Grep the app log" (17 Sep 2026).
 *
 * The board answers from the sda_ops read models and the app-log lane from fixed_app_events — both keep only
 * FAILED steps and only the fields the collector parses, so a customer id an engineer finds in one
 * `grep -rn '<id>' /app/log/sda/combined.log` on 146 comes back "No errors in this window" here. This panel is
 * that grep, in the console: any free-text term against the WHOLE log line (every field), successes AND
 * failures, with the request / response bodies, stitched into the journey its requestId shares.
 *
 * ADDITIVE BY DESIGN — it sits beside the existing filters and changes none of them. Nothing on the board
 * calls it; it only runs when a person presses Search (it greps a live prod app node over SSH).
 * Data: /api/fixed/applog/grep (server/src/fixedLogGrep.js). Rendered with the board's own fe-* classes, so
 * the result reads as one UI with the error rows above it. */
(function(){
  "use strict";
  const S={ term:"", deep:false, regex:false, limit:200, expand:true, res:null, busy:false, open:false, expanded:new Set(), raw:new Set() };
  const esc=s=>window.FX?window.FX.esc(s):String(s==null?"":s);
  const fmtT=v=>{ if(!v) return "—"; const d=new Date(v); return isNaN(d)?"—":d.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Asia/Riyadh"}); };
  const pretty=v=>{ if(v==null||v==="") return null; if(typeof v==="string"){ try{ return JSON.stringify(JSON.parse(v),null,2); }catch(e){ return v; } } return JSON.stringify(v,null,2); };
  const OUT={ success:{label:"success",bg:"rgba(14,159,90,.14)",fg:"var(--green,#0e9f5a)"}, failed:{label:"failed",bg:"rgba(220,76,76,.16)",fg:"#dc2626"}, unknown:{label:"no verdict",bg:"rgba(125,133,144,.14)",fg:"var(--muted)"} };
  const okPill=ok=>ok===true?`<span class="fg-pill" style="background:rgba(14,159,90,.14);color:var(--green,#0e9f5a)">ok</span>`
    :ok===false?`<span class="fg-pill" style="background:rgba(220,76,76,.16);color:#dc2626">fail</span>`
    :`<span class="fg-pill" style="background:rgba(125,133,144,.14);color:var(--muted)">—</span>`;
  const STYLE=`
    #fgWrap{background:var(--card,#fff);border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 3px rgba(2,6,23,.05);padding:16px 22px;margin-bottom:14px}
    #fgWrap .fg-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    #fgWrap .fg-t{font-size:14px;font-weight:800;letter-spacing:-.1px} #fgWrap .fg-sub{font-size:12px;color:var(--muted);margin-top:3px;max-width:900px}
    #fgWrap .fg-body{margin-top:12px;display:flex;flex-direction:column;gap:10px;min-width:0}
    #fgWrap .fg-body>*{min-width:0;max-width:100%}
    #fgWrap .fg-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap} #fgWrap .fg-row .fe-in{flex:1 1 320px}
    #fgWrap label.fg-ck{display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer;white-space:nowrap} #fgWrap label.fg-ck input{accent-color:var(--green,#0e9f5a);width:15px;height:15px}
    #fgWrap select.fe-in{flex:0 0 auto;width:auto;padding:9px 10px}
    #fgWrap .fg-note{font-size:11.5px;color:var(--muted)} #fgWrap .fg-note b{color:var(--ink)}
    #fgWrap .fg-warn{border-left:4px solid #dc2626;background:rgba(220,76,76,.07);border-radius:8px;padding:9px 12px;font-size:12.5px}
    #fgWrap .fg-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;line-height:1.5}
    #fgWrap .fg-ids{font-size:11.5px;color:var(--muted)} #fgWrap .fg-ids b{color:var(--ink);font-weight:600}
    #fgOut{margin-top:6px}
    #fgOut table.fe-tbl{width:100%;border-collapse:collapse;font-size:13px;min-width:760px}
    #fgOut{min-width:0;max-width:100%}
    #fgOut .fg-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px;max-width:100%}
    #fgOut th{text-align:left;padding:11px 14px;color:var(--muted);font-weight:700;font-size:11px;letter-spacing:.6px;text-transform:uppercase;border-bottom:1px solid var(--line)}
    #fgOut td{padding:10px 14px;border-bottom:1px solid var(--line-soft,var(--line));vertical-align:middle;overflow:hidden}
    #fgOut td .cut{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #fgOut tr.fg-r{cursor:pointer;transition:background .12s} #fgOut tr.fg-r:hover td{background:var(--card2,#f8fafc)} #fgOut tr.fg-r.open td{background:var(--card2,#f8fafc)}
    #fgOut tr.fg-r td:first-child{box-shadow:inset 3px 0 0 transparent;transition:box-shadow .12s} #fgOut tr.fg-r:hover td:first-child,#fgOut tr.fg-r.open td:first-child{box-shadow:inset 3px 0 0 var(--green,#0e9f5a)}
    #fgOut .fg-caret{display:inline-block;color:var(--muted);font-size:12px;margin-left:8px;transition:transform .15s} #fgOut tr.fg-r.open .fg-caret{transform:rotate(90deg);color:var(--green,#0e9f5a)}
    #fgOut .fg-x td{padding:12px 14px 16px;background:var(--card,#fff)}
    #fgOut .fg-step{border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:10px;background:var(--card2,#f8fafc)}
    #fgOut .fg-step .fg-sh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px}
    #fgOut .fg-step .fg-msg{font-weight:700} #fgOut .fg-step .fg-meta{color:var(--muted);font-size:11.5px}
    #fgOut .fg-io{display:grid;gap:10px;grid-template-columns:1fr 1fr;margin-top:9px} @media (max-width:900px){#fgOut .fg-io{grid-template-columns:1fr}}
    #fgOut .fg-io h6{margin:0 0 5px;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--muted)}
    #fgOut pre{margin:0;max-height:260px;overflow:auto;background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
    @media (max-width:700px){#fgWrap{padding:14px 12px} #fgOut table.fe-tbl{min-width:640px;font-size:12px} #fgOut th,#fgOut td{padding-left:9px;padding-right:9px} #fgOut pre{font-size:11px}
      #fgWrap label.fg-ck{white-space:normal} #fgWrap label.fg-ck .fg-note{display:none} #fgWrap .fg-row .fe-in{flex:1 1 100%} #fgWrap select.fe-in{width:100%}
      #fgOut .fg-step .fg-sh{align-items:flex-start} #fgOut .fg-step button[data-raw]{margin-left:0}
      #fgOut .fg-x .fg-xin{position:sticky;left:0;width:calc(100vw - 86px);max-width:calc(100vw - 86px)}}
  `;
  const btn=(id,label,extra)=>`<button type="button" id="${id}" class="fe-btn fe-exp" ${extra||""}>${label}</button>`;

  function render(host,fx,prefill){
    if(!host) return;
    if(prefill&&!S.term) S.term=String(prefill).trim();
    host.innerHTML=`<div id="fgWrap"><style>${STYLE}</style>
      <div class="fg-head">
        <div style="flex:1 1 auto"><div class="fg-t">Grep the app log <span style="font-weight:600;color:var(--muted);font-size:12px">· combined.log on 146 (RUH-App-P01), read live over SSH</span></div>
          <div class="fg-sub">The board and the app-log lane keep only <b>failed</b> steps. This searches the <b>raw</b> log line by line — any field (customer ID, national ID, MSISDN, ICCID, IMSI, custCode, order no, plate, staff ID, requestId, an error phrase…) — and returns <b>successes and failures</b> with their request / response. Matching lines are stitched into the journey their requestId shares, so you get the whole case, not only the line that carried your term.</div></div>
        <button type="button" id="fgToggle" class="fe-btn">${S.open?"Hide":"Open grep"}</button>
      </div>
      <div class="fg-body" ${S.open?"":"hidden"} id="fgBody">
        <div class="fg-row">
          <input id="fgTerm" class="fe-in" placeholder="Search the raw log — e.g. 1054887433 · 05xxxxxxxx · 8996… · wf_st_… · &quot;does not match NIC records&quot;" value="${esc(S.term)}" autocomplete="off" spellcheck="false">
          ${btn("fgGo","🔎 Search log")}
        </div>
        <div class="fg-row">
          <label class="fg-ck"><input type="checkbox" id="fgDeep" ${S.deep?"checked":""}> include rotated files <span class="fg-note">(slower — only when the case is older than the current file)</span></label>
          <label class="fg-ck"><input type="checkbox" id="fgRe" ${S.regex?"checked":""}> regular expression</label>
          <label class="fg-ck"><input type="checkbox" id="fgExp" ${S.expand?"checked":""}> pull the full journey per requestId</label>
          <select id="fgLimit" class="fe-in" title="Newest matching lines kept per file">${[100,200,500,1000].map(n=>`<option value="${n}"${S.limit===n?" selected":""}>${n} lines</option>`).join("")}</select>
        </div>
        <div class="fg-note">Explicit action only — nothing here runs on the 60 s auto-refresh. Credentials (Nafath tokens, apiKey, passwords) are masked on the node before anything leaves it; customer data is shown as the log holds it and <b>every search is written to the audit log</b>.</div>
        <div id="fgOut"></div>
      </div></div>`;
    const $=s=>host.querySelector(s);
    const toggle=()=>{ S.open=!S.open; $("#fgBody").hidden=!S.open; $("#fgToggle").textContent=S.open?"Hide":"Open grep"; if(S.open) $("#fgTerm").focus(); };
    $("#fgToggle").onclick=toggle;
    $("#fgDeep").onchange=e=>{ S.deep=e.target.checked; }; $("#fgRe").onchange=e=>{ S.regex=e.target.checked; };
    $("#fgExp").onchange=e=>{ S.expand=e.target.checked; }; $("#fgLimit").onchange=e=>{ S.limit=Number(e.target.value)||200; };
    $("#fgTerm").onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); run(host,fx); } };
    $("#fgGo").onclick=()=>run(host,fx);
    if(S.res) draw(host,fx);
  }

  async function run(host,fx){
    const $=s=>host.querySelector(s); const t=$("#fgTerm"); if(!t) return;
    S.term=t.value.trim();
    if(S.term.length<3){ $("#fgOut").innerHTML=`<div class="fg-warn">Type at least 3 characters — a one- or two-character grep would read the whole log for nothing.</div>`; return; }
    if(S.busy) return; S.busy=true; S.expanded=new Set(); S.raw=new Set();
    const go=$("#fgGo"); const old=go.textContent; go.disabled=true; go.textContent="… searching the node";
    $("#fgOut").innerHTML=`<div class="fg-note" style="padding:12px 2px">${window.salamLoader?window.salamLoader("Grepping combined.log on 146 — this reads the live file, it can take up to a minute…"):"Searching…"}</div>`;
    try{
      const q=`q=${encodeURIComponent(S.term)}&limit=${S.limit}${S.deep?"&deep=1":""}${S.regex?"&regex=1":""}${S.expand?"":"&expand=0"}`;
      S.res=await fx.api("/api/fixed/applog/grep?"+q);
      draw(host,fx);
    }catch(e){ S.res=null; $("#fgOut").innerHTML=`<div class="fg-warn"><b>Log search failed</b> — ${esc(e.message)}</div>`; }
    finally{ S.busy=false; go.disabled=false; go.textContent=old; }
  }

  function draw(host,fx){
    const el=host.querySelector("#fgOut"); if(!el) return; const d=S.res||{};
    if(d.configured===false){ el.innerHTML=`<div class="fg-warn"><b>Not configured</b> — ${esc(d.error||"FIXED_LOG_HOSTS is not set on 152, so the console has no path to the app node.")}</div>`; return; }
    if(d.ok===false){ el.innerHTML=`<div class="fg-warn">${esc(d.error||"search refused")}</div>`; return; }
    const groups=d.groups||[];
    const hostLine=(d.hosts||[]).map(h=>h.error?`<span style="color:#dc2626">${esc(h.host)}: ${esc(h.error)}</span>`
      :`<b>${esc(h.host)}</b> ${(h.files||[]).map(f=>`${esc(String(f.file).split("/").pop())} · ${f.hits}`).join(" · ")||"no match"}`).join(" &nbsp;·&nbsp; ");
    el.innerHTML=`<div class="fg-note" style="margin:6px 0 8px">${d.total_hits||0} matching line${d.total_hits===1?"":"s"} · ${d.returned||0} returned${d.expanded?` (+${d.expanded} more pulled in by requestId)`:""} · ${groups.length} case${groups.length===1?"":"s"} · ${Math.round((d.ms||0)/100)/10}s · ${esc(d.scope||"")}<br>${hostLine}</div>
      ${d.note?`<div class="fg-note" style="margin-bottom:8px">${esc(d.note)}</div>`:""}
      ${d.expand_skipped?`<div class="fg-note" style="margin-bottom:8px">Journey expansion skipped — ${esc(d.expand_skipped)}</div>`:""}
      ${d.errors?`<div class="fg-warn" style="margin-bottom:8px">${d.errors.map(e=>esc(e)).join("<br>")}</div>`:""}
      ${groups.length?`<div class="fg-scroll"><table class="fe-tbl"><thead><tr><th>TIME KSA</th><th>OUTCOME</th><th>WHAT</th><th>CHANNEL / PATH</th><th>IDENTIFIERS</th><th>STEPS</th></tr></thead><tbody>${groups.map((g,i)=>{
        const o=OUT[g.outcome]||OUT.unknown;
        const ids=Object.entries(g.ids||{}).slice(0,4).map(([k,v])=>`${esc(k)} <b>${esc(v)}</b>`).join(" · ");
        const what=g.reason||(g.rows[g.rows.length-1]||{}).message||"—";
        return `<tr class="fg-r" data-i="${i}" tabindex="0"><td style="white-space:nowrap">${fmtT(g.to)}</td>
          <td><span class="fg-pill" style="background:${o.bg};color:${o.fg}">${o.label}</span></td>
          <td style="max-width:360px" title="${esc(String(what).slice(0,400))}">${esc(String(what).slice(0,160))}</td>
          <td style="max-width:220px" title="${esc(g.path||"")}"><span class="fg-ids cut">${esc(g.channel||"—")}</span><span class="mono cut" style="font-size:11.5px">${esc(g.path||"—")}</span></td>
          <td class="fg-ids" style="max-width:260px">${ids||"—"}${g.request_id?`<span class="mono cut" style="font-size:11px">req ${esc(g.request_id)}</span>`:""}</td>
          <td style="white-space:nowrap">${g.steps}${g.failed?` <span style="color:#dc2626;font-weight:700">(${g.failed} failed)</span>`:""}<span class="fg-caret">›</span></td></tr>
          <tr class="fg-x" data-i="${i}" hidden><td colspan="6"></td></tr>`; }).join("")}</tbody></table></div>`
      :`<div class="fg-note" style="padding:10px 2px">No line in the searched files carries this term.</div>`}`;
    el.querySelectorAll("tr.fg-r").forEach(tr=>{
      tr.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); tr.click(); } };
      tr.onclick=()=>{ const i=tr.dataset.i; const x=el.querySelector(`tr.fg-x[data-i="${i}"]`); if(!x) return;
        if(!x.hidden){ x.hidden=true; tr.classList.remove("open"); S.expanded.delete(i); return; }
        x.hidden=false; tr.classList.add("open"); S.expanded.add(i); steps(el,x.firstElementChild,groups[Number(i)],i); };
    });
    for(const i of S.expanded){ const tr=el.querySelector(`tr.fg-r[data-i="${i}"]`), x=el.querySelector(`tr.fg-x[data-i="${i}"]`);
      if(tr&&x&&groups[Number(i)]){ x.hidden=false; tr.classList.add("open"); steps(el,x.firstElementChild,groups[Number(i)],i); } }
  }

  /* one case, step by step, in log order — exactly the lines the node holds, with request and response */
  function steps(el,cell,g,gi){
    const pre=v=>`<pre>${v==null?"—":esc(pretty(v))}</pre>`;
    /* the detail lives INSIDE the horizontally-scrolling table, so on a phone it would be drawn off to the
     * right of the viewport — the same sticky-left trick the error board uses for its expanded row. */
    const body=(g.rows||[]).map((r,j)=>{
      const rawId=`fgraw-${gi}-${j}`;
      return `<div class="fg-step">
        <div class="fg-sh">${okPill(r.ok)}<span class="fg-msg">${esc(r.unparsed?"(non-JSON log line)":r.message||"—")}</span>
          <span class="fg-meta">${fmtT(r.ts)}${r.status!=null?` · HTTP ${esc(r.status)}`:""}${r.ms!=null?` · ${esc(r.ms)} ms`:""}${r.level?` · ${esc(r.level)}`:""}${r.service?` · ${esc(r.service)}`:""}${r.via==="request_id"?` · <span title="pulled in by requestId — this line does not carry your search term">via requestId</span>`:""}</span>
          <button type="button" class="fe-btn" data-raw="${rawId}" style="margin-left:auto">raw line</button></div>
        ${r.error?`<div class="fg-meta" style="color:#dc2626;margin-top:6px">${esc(r.error.message||r.error.code||"error")}${r.error.code&&r.error.message?` (${esc(r.error.code)})`:""}</div>`:""}
        ${(r.request!=null||r.response!=null||r.input!=null)?`<div class="fg-io">
            <div><h6>Request${r.input!=null&&r.request==null?" (input)":""}</h6>${pre(r.request!=null?r.request:r.input)}</div>
            <div><h6>Response</h6>${pre(r.response)}</div></div>`:``}
        ${r.input!=null&&r.request!=null?`<div style="margin-top:9px"><h6 style="margin:0 0 5px;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--muted)">Raw input</h6>${pre(r.input)}</div>`:""}
        <pre id="${rawId}" hidden style="margin-top:9px">${esc(JSON.stringify(r,null,2))}</pre>
      </div>`; }).join("")||`<div class="fg-note">no lines</div>`;
    cell.innerHTML=`<div class="fg-xin">${body}</div>`;
    cell.querySelectorAll("button[data-raw]").forEach(b=>b.onclick=()=>{ const p=cell.querySelector("#"+b.dataset.raw); if(p) p.hidden=!p.hidden; });
  }

  /* the board's empty state calls this: open the panel, carry the term over, search straight away */
  function searchFor(term){
    const t=document.getElementById("fgTerm"); if(!t) return;
    S.term=String(term||"").trim(); S.open=true;
    const body=document.getElementById("fgBody"), tg=document.getElementById("fgToggle");
    if(body){ body.hidden=false; } if(tg) tg.textContent="Hide";
    t.value=S.term; t.scrollIntoView({behavior:"smooth",block:"center"});
    const go=document.getElementById("fgGo"); if(go) go.click();
  }
  window.fixedGrep={ render, searchFor, state:S };
})();
