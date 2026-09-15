/* fixed-applane.js — Fixed › Troubleshoot: the "From the app log" lane (15 Sep 2026).
 * Data: /api/fixed/applog/lane?range= (server/src/fixedAppLane.js ← fixed_app_events ← combined.log on 146).
 * Sits above the error control board and follows its window chips. Shows, per channel, the failing steps with
 * the real reason text and an hourly failure sparkline; the identity / eligibility providers with a true
 * success rate (Yakeen/ELM is visible ONLY here); and retry loops (a worker failing the same way on a flat
 * cadence). Collapsible; state remembered per browser. */
(function(){
  "use strict";
  const LS=k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const CH_COLOR={ sda:"var(--green,#0e9f5a)", salamhome:"var(--warn-fg,#b45309)", web:"#2563eb", payments:"#7c3aed" };
  const STYLE=`
    .fa-lane{margin:0 0 16px;border:1px solid var(--line);border-radius:14px;background:var(--card,#fff);box-shadow:0 1px 3px rgba(2,6,23,.05);overflow:hidden}
    .fa-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 18px;cursor:pointer;user-select:none}
    .fa-head h2{margin:0;font-size:14px;font-weight:800;letter-spacing:-.1px} .fa-head .fa-st{font-size:12px;color:var(--muted)}
    .fa-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:6px;vertical-align:1px} .fa-dot.on{background:var(--green,#0e9f5a);box-shadow:0 0 0 3px rgba(14,159,90,.18)} .fa-dot.warn{background:#d97706}
    .fa-tog{margin-left:auto;cursor:pointer;font:inherit;font-size:12px;font-weight:600;padding:4px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink)} .fa-tog:hover{border-color:var(--green,#0e9f5a);color:var(--green,#0e9f5a)}
    .fa-body{padding:0 18px 16px;border-top:1px solid var(--line)}
    .fa-loop{margin:14px 0 4px;padding:10px 14px;border-left:4px solid #d97706;background:rgba(217,119,6,.08);border-radius:8px;font-size:12.5px;line-height:1.5}
    .fa-loop b{font-weight:700} .fa-loop .fa-k{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
    .fa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;margin-top:14px}
    .fa-card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--card2,#f8fafc);min-width:0}
    .fa-card .fa-t{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap} .fa-card .fa-t b{font-size:13px} .fa-card .fa-t .fa-n{font-size:20px;font-weight:800;margin-left:auto}
    .fa-card .fa-sub{font-size:11px;color:var(--muted)} .fa-spark{display:block;width:100%;height:34px;margin:8px 0 6px}
    .fa-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
    .fa-steps li{font-size:12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:6px 8px;border-radius:8px;background:var(--card,#fff);border:1px solid var(--line)}
    .fa-steps .fa-s{font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fa-steps .fa-r{grid-column:1/-1;color:var(--muted);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fa-steps .fa-c{font-weight:700;white-space:nowrap} .fa-steps .fa-c.red{color:#dc2626} .fa-steps .fa-c.amber{color:#d97706}
    .fa-prov{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-top:14px}
    .fa-p{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--card2,#f8fafc);min-width:0;overflow:hidden} .fa-p b{font-size:12.5px} .fa-p .fa-rate{font-size:22px;font-weight:800;line-height:1.1;margin:4px 0}
    .fa-p .fa-rate.g{color:var(--green,#0e9f5a)} .fa-p .fa-rate.a{color:#d97706} .fa-p .fa-rate.r{color:#dc2626} .fa-p .fa-rate.m{color:var(--muted)}
    .fa-p .fa-sub{font-size:11px;color:var(--muted);line-height:1.4} .fa-p .fa-last{font-size:11px;color:var(--ink);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fa-h3{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 0 0}
    .fa-note{font-size:11.5px;color:var(--muted);margin-top:12px;line-height:1.5}
    .fa-empty{font-size:12.5px;color:var(--muted);padding:14px 0}
    .fa-imp{margin-top:14px;border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--card2,#f8fafc)}
    .fa-imp .fa-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center} .fa-imp input,.fa-imp select{font:inherit;font-size:13px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:var(--ink)} .fa-imp input{flex:1 1 320px;min-width:0} .fa-imp input:focus,.fa-imp select:focus{outline:none;border-color:var(--green,#0e9f5a);box-shadow:0 0 0 3px rgba(14,159,90,.15)}
    .fa-btn{cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:7px 14px;border:1px solid var(--green,#0e9f5a);border-radius:999px;background:var(--green,#0e9f5a);color:#fff;white-space:nowrap} .fa-btn:hover{filter:brightness(1.06)} .fa-btn:disabled{opacity:.55;cursor:not-allowed}
    .fa-btn.o{background:var(--card,#fff);color:var(--ink);border-color:var(--line)} .fa-btn.o:hover{border-color:var(--green,#0e9f5a);color:var(--green,#0e9f5a)}
    .fa-verd{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:3px 10px;border-radius:999px;color:#fff} .fa-verd.ongoing{background:#ef4444} .fa-verd.recovering{background:#d97706} .fa-verd.cleared,.fa-verd.quiet{background:var(--green,#0e9f5a)} .fa-verd.none{background:var(--muted)}
    .fa-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:10px} .fa-kpi{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--card,#fff)} .fa-kpi b{display:block;font-size:18px;font-weight:800} .fa-kpi span{font-size:11px;color:var(--muted)}
    .fa-imp .fa-spark{height:44px;margin-top:10px} .fa-reasons{margin:8px 0 0;padding:0;list-style:none;font-size:12px} .fa-reasons li{padding:4px 0;border-top:1px solid var(--line);display:flex;gap:8px;align-items:baseline} .fa-reasons li b{white-space:nowrap} .fa-reasons li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fa-pr{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--card2,#f8fafc);grid-column:1/-1;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center} .fa-pr .fa-pdot{display:inline-flex;align-items:center;gap:6px;font-size:12px} .fa-pr .fa-pdot i{width:9px;height:9px;border-radius:50%;display:inline-block}
    .fa-hist{width:100%;font-size:11.5px;border-collapse:collapse;margin-top:6px} .fa-hist td,.fa-hist th{padding:4px 6px;border-top:1px solid var(--line);text-align:left} .fa-hist th{color:var(--muted);font-weight:600}
    @media (max-width:640px){ .fa-head{padding:10px 14px} .fa-body{padding:0 12px 14px} .fa-grid,.fa-prov{grid-template-columns:1fr} }`;
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt=n=>Number(n||0).toLocaleString("en-US");
  const rel=v=>{ if(!v) return "—"; const m=Math.floor((Date.now()-new Date(v).getTime())/6e4); if(m<1) return "just now"; if(m<60) return m+" min ago"; const h=Math.floor(m/60); if(h<48) return h+" h ago"; return Math.floor(h/24)+" d ago"; };
  const spark=(rows,color)=>{ if(!rows||!rows.length) return `<svg class="fa-spark" viewBox="0 0 100 34" preserveAspectRatio="none"><line x1="0" y1="30" x2="100" y2="30" stroke="var(--line)" stroke-width="1"/></svg>`;
    const max=Math.max(1,...rows.map(r=>r.failed)); const w=100/rows.length;
    return `<svg class="fa-spark" viewBox="0 0 100 34" preserveAspectRatio="none" aria-label="failures per ${rows.length>48?"day":"hour"}">${rows.map((r,i)=>{ const h=Math.max(r.failed?1.5:0,28*r.failed/max); return `<rect x="${(i*w+w*0.15).toFixed(2)}" y="${(30-h).toFixed(2)}" width="${(w*0.7).toFixed(2)}" height="${h.toFixed(2)}" rx="1" fill="${color}" opacity=".85"><title>${esc(String(r.b).replace("T"," ").slice(0,16))} — ${r.failed} failed of ${r.total}</title></rect>`; }).join("")}<line x1="0" y1="30.5" x2="100" y2="30.5" stroke="var(--line)" stroke-width="1"/></svg>`; };
  const rateCls=r=>r==null?"m":r>=97?"g":r>=90?"a":"r";

  const IM={ q:"", hours:24, res:null, busy:false };
  const ksa=v=>v?new Date(v).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Riyadh"}):"—";
  const VERD={ ongoing:"ONGOING — still failing now", recovering:"RECOVERING — fewer in the last 15 min", cleared:"CLEARED — nothing for 30 min", quiet:"QUIET — last one under 30 min ago", none:"NOT SEEN in this window" };
  function impactHtml(r){ if(!r) return ""; if(r.error) return `<div class="fa-sub" style="color:#ef4444;margin-top:8px">${esc(r.error)}</div>`;
    const bars=r.series.map(x=>({b:x.b,failed:x.app+x.board,total:x.app+x.board}));
    return `<div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="fa-verd ${r.verdict}">${esc(r.verdict)}</span><span style="font-size:12.5px">${esc(VERD[r.verdict]||"")}</span><span class="fa-sub">· matched “${esc(r.keywords.join(" ")||r.provider)}”${r.provider?` · provider <b>${esc(r.provider)}</b>`:""} · last ${r.hours} h</span></div>
      <div class="fa-kpis"><div class="fa-kpi"><b>${fmt(r.total)}</b><span>failures · app ${fmt(r.app.n)} + board ${fmt(r.board.n)}</span></div>
        <div class="fa-kpi"><b>${fmt(r.last15)}</b><span>last 15 min · previous hour ${r.prevRate}/15 min</span></div>
        <div class="fa-kpi"><b>${esc(ksa(r.firstSeen))}</b><span>first seen (KSA)</span></div><div class="fa-kpi"><b>${esc(ksa(r.lastSeen))}</b><span>last seen${r.sinceMin!=null?` · ${r.sinceMin} min ago`:""}</span></div>
        <div class="fa-kpi"><b><span style="color:#ef4444">${fmt(r.app.technical+r.board.technical)}</span> / <span style="color:#3b82f6">${fmt(r.app.business+r.board.business)}</span></b><span>technical / business</span></div>
        <div class="fa-kpi"><b>${fmt(r.app.requests)}${r.board.customers?` · ${fmt(r.board.customers)}`:""}</b><span>affected requests${r.board.customers?" · customers":""}</span></div>
        <div class="fa-kpi"><b>${(r.app.channels||[]).map(c=>`${esc(c.channel)} ${fmt(c.n)}`).join(" · ")||"—"}</b><span>by channel (app log)</span></div></div>
      ${spark(bars,r.verdict==="ongoing"?"#ef4444":r.verdict==="recovering"?"#d97706":"var(--green,#0e9f5a)")}
      ${(r.app.reasons||[]).length?`<ul class="fa-reasons">${r.app.reasons.map(x=>`<li><b style="color:${x.cls==="technical"?"#ef4444":x.cls==="business"?"#3b82f6":"var(--muted)"}">${fmt(x.n)}</b><span title="${esc(x.reason)}">${esc(x.path!=="-"?x.path.replace(/^(sda|ePurchase|salamApp|paymentOptimization)\.(actions\.)?/,"")+" · ":"")}${esc(x.reason)}</span><span class="fa-sub" style="margin-left:auto;white-space:nowrap">${esc(ksa(x.last))}</span></li>`).join("")}</ul>`:""}
      <div class="fa-sub" style="margin-top:8px">${esc(r.note)}</div>`; }
  async function runImpact(el,fx){ if(IM.busy) return; IM.busy=true; const out=el.querySelector("#faImpOut"); if(out) out.innerHTML=`<div class="fa-sub" style="margin-top:8px">checking…</div>`;
    try{ IM.res=await fx.api(`/api/fixed/applog/impact?q=${encodeURIComponent(IM.q)}&hours=${IM.hours}`); }catch(e){ IM.res={error:e.message}; }
    IM.busy=false; const o=el.querySelector("#faImpOut"); if(o) o.innerHTML=impactHtml(IM.res); }
  function probeHtml(p){ if(!p) return ""; const last=p.last; const dot=c=>c==="ok"?"var(--green,#0e9f5a)":c==="business"?"#3b82f6":c==="skipped"?"var(--muted)":"#ef4444";
    if(!p.configured) return `<div class="fa-pr"><b>Yakeen / ELM probe</b><span class="fa-sub">not configured — set ${esc((p.missing||[]).join(", "))} in /apps/unified/.env on 152</span></div>`;
    return `<div class="fa-pr"><b>Yakeen / ELM probe</b>${last?`<span class="fa-verd ${last.verdict==="up"?"cleared":last.verdict==="answering"?"quiet":"ongoing"}">${esc(last.verdict)}</span><span class="fa-sub">last run ${esc(ksa(last.run_at))} · ${esc(last.trigger)}${last.actor?" · "+esc(last.actor):""} · ${last.ok_count}/${last.total} ok</span>${(last.results||[]).map(r=>`<span class="fa-pdot" title="${esc(r.message||"")}"><i style="background:${dot(r.cls)}"></i>${esc(r.label.replace("Yakeen ",""))}${r.ms!=null?` <span class="fa-sub">${r.ms} ms</span>`:""}</span>`).join("")}`:`<span class="fa-sub">no run yet</span>`}
      <span style="margin-left:auto;display:flex;gap:6px;align-items:center"><span class="fa-sub">scheduled ${esc((p.times||[]).join(" / "))} KSA · mail → ${esc(Array.isArray(p.mailTo)?p.mailTo.join(", "):p.mailTo)}</span><button type="button" class="fa-btn" id="faProbeRun" ${p.manualLeft>0?"":"disabled"} title="every call is billed by ELM — ${p.manualCap} manual runs per day">Run now · ${p.manualLeft} of ${p.manualCap} left today</button><button type="button" class="fa-btn o" id="faProbeHist">History</button></span><div id="faProbeHistOut" style="flex-basis:100%" hidden></div></div>`; }
  async function render(el,fx,win){
    if(!el) return;
    if(!document.getElementById("faStyle")){ const st=document.createElement("style"); st.id="faStyle"; st.textContent=STYLE; document.head.appendChild(st); }
    const open=LS("fixed_app_lane_open")!=="0";
    let d; try{ d=await fx.api("/api/fixed/applog/lane?range="+encodeURIComponent(win||"today")); }
    catch(e){ el.innerHTML=`<div class="fa-lane"><div class="fa-head"><h2>From the app log</h2><span class="fa-st" style="color:#dc2626">unavailable — ${esc(e.message)}</span></div></div>`; return; }
    if(!el.isConnected) return;
    let probe=null; try{ probe=await fx.api("/api/fixed/yakeen/probe/status"); }catch(e){ probe=null; }
    const c=d.collector||{}; const st=!c.configured?`<span class="fa-dot warn"></span>not collected — set FIXED_LOG_HOSTS on 152`
      : c.error?`<span class="fa-dot warn"></span>collector error: ${esc(c.error)}`
      : c.newest?`<span class="fa-dot on"></span>live · combined.log on 146 · newest line ${esc(rel(c.newest))}${c.lagMin>10?` <span style="color:#d97706">(lagging)</span>`:""}`
      : `<span class="fa-dot warn"></span>armed, nothing read yet`;
    const totalFail=d.channels.reduce((a,x)=>a+x.failed,0);
    const loops=(d.loops||[]).map(l=>`<div class="fa-loop"><b>Retry loop</b> · <span class="fa-k">${esc(l.step||l.path)}</span> — “${esc(l.reason)}” · <b>${fmt(l.n)}</b> times in ${esc(String(l.spanMin))} min${l.perRun?` · ~${fmt(l.perRun)} per run every few minutes`:""}${l.requests?"":" · no customer request behind it"} · channel ${esc(l.channel)} · last ${esc(rel(l.last))}. A worker is failing the same way on a schedule — one ticket, not ${fmt(l.n)} errors.</div>`).join("");
    const cards=d.channels.map(ch=>{ const col=CH_COLOR[ch.key]||"var(--muted)";
      return `<div class="fa-card"><div class="fa-t"><b style="color:${col}">${esc(ch.label)}</b><span class="fa-sub" title="${esc(ch.desc)}">${ch.total?`${fmt(ch.failed)} failed of ${fmt(ch.total)} step calls`:"no step calls in this window"}</span><span class="fa-n" style="color:${ch.failed?col:"var(--muted)"}">${fmt(ch.failed)}</span></div>
        ${spark(ch.series,col)}
        ${ch.steps.length?`<ul class="fa-steps">${ch.steps.map(s=>`<li title="${esc(s.path)} — ${fmt(s.failed)} failed of ${fmt(s.n)}${s.reasons>1?` · ${s.reasons} distinct reasons`:""} · last ${esc(rel(s.last_fail))}"><span class="fa-s">${esc(s.step)}</span><span class="fa-c ${s.rate>=50?"red":s.rate>=20?"amber":""}">${fmt(s.failed)}${s.n>s.failed?` / ${fmt(s.n)}`:""}${s.rate!=null&&s.n>s.failed?` · ${s.rate}%`:""}</span><span class="fa-r">${esc(s.last_reason||"—")}</span></li>`).join("")}</ul>`
        :`<div class="fa-sub">no failing step</div>`}</div>`; }).join("");
    const prov=d.providers.map(p=>{ const cls=rateCls(p.rate); const lf=p.lastFail;
      return `<div class="fa-p" title="${esc(p.desc)}"><b>${esc(p.label)}</b><div class="fa-rate ${cls}">${p.rate==null?"—":p.rate+"%"}</div>
        <div class="fa-sub">${p.calls?`${fmt(p.calls)} calls · ${fmt(p.failed)} failed${p.failed?` (${fmt(p.technical)} technical · ${fmt(p.business)} refused)`:""}`:"no call in this window"}</div>
        ${lf?`<div class="fa-last" title="${esc(lf.reason||"")}"><span style="color:${lf.reason_class==="technical"?"#ef4444":lf.reason_class==="business"?"#3b82f6":"var(--muted)"}">${esc(lf.reason_class||"fail")}${lf.status_code?" "+lf.status_code:""}</span> · ${esc(lf.reason||"")} · ${esc(rel(lf.ts))}</div>`:""}</div>`; }).join("");
    el.innerHTML=`<div class="fa-lane"><div class="fa-head" id="faHead"><h2>From the app log</h2><span class="fa-st">${st}</span><span class="fa-st">· <b>${fmt(totalFail)}</b> failed steps in this window</span><button type="button" class="fa-tog" id="faTog">${open?"Hide":"Show"}</button></div>
      <div class="fa-body" id="faBody" ${open?"":"hidden"}>${loops}
        <div class="fa-h3">Failing steps by channel — reason text as the app logged it</div><div class="fa-grid">${cards}</div>
        <div class="fa-h3">Impact check — paste the error text from a screenshot or mail, or a provider name</div>
        <div class="fa-imp"><div class="fa-row"><input id="faImpQ" placeholder="e.g. Failed to validate customer info with Yakeen · There are no available ports · blacklist · Yakeen" value="${esc(IM.q)}"><select id="faImpH">${[3,6,12,24,48,72,168].map(h=>`<option value="${h}"${IM.hours===h?" selected":""}>last ${h<24?h+" h":(h/24)+" d"}</option>`).join("")}</select><button type="button" class="fa-btn" id="faImpGo">Check impact</button></div><div id="faImpOut">${impactHtml(IM.res)}</div></div>
        <div class="fa-h3">Identity &amp; eligibility providers — success rate</div>${d.providers.some(p=>p.calls)||probe?`<div class="fa-prov">${prov}${probeHtml(probe)}</div>`:`<div class="fa-empty">no provider call in this window</div>`}
        <div class="fa-note">${esc(d.note)} Yakeen success = a getYakeenInfo response line without an error object. Window ${esc(String(d.from).replace("T"," ").slice(0,16))} → ${esc(String(d.to).replace("T"," ").slice(0,16))} UTC, ${d.bucket==="day"?"daily":"hourly"} bars.</div></div></div>`;
    const tog=()=>{ const b=el.querySelector("#faBody"), t=el.querySelector("#faTog"); const now=b.hidden; b.hidden=!now; t.textContent=now?"Hide":"Show"; try{ localStorage.setItem("fixed_app_lane_open",now?"1":"0"); }catch(e){} };
    el.querySelector("#faTog").onclick=e=>{ e.stopPropagation(); tog(); }; el.querySelector("#faHead").onclick=tog;
    const q=el.querySelector("#faImpQ"), h=el.querySelector("#faImpH"), go=el.querySelector("#faImpGo");
    if(q){ q.oninput=()=>{ IM.q=q.value.trim(); }; q.onkeydown=ev=>{ if(ev.key==="Enter"){ ev.preventDefault(); IM.q=q.value.trim(); runImpact(el,fx); } }; }
    if(h) h.onchange=()=>{ IM.hours=Number(h.value)||24; if(IM.q) runImpact(el,fx); };
    if(go) go.onclick=()=>{ IM.q=(q&&q.value.trim())||IM.q; if(IM.q) runImpact(el,fx); };
    const pr=el.querySelector("#faProbeRun"); if(pr) pr.onclick=async()=>{ pr.disabled=true; pr.textContent="running… (4 ELM calls)"; try{ await fx.api("/api/fixed/yakeen/probe/run",{method:"POST",body:"{}"}); render(el,fx,win); }catch(e2){ pr.textContent="failed: "+e2.message.slice(0,80); } };
    const ph=el.querySelector("#faProbeHist"); if(ph) ph.onclick=async()=>{ const o=el.querySelector("#faProbeHistOut"); if(!o) return; if(!o.hidden){ o.hidden=true; return; } o.hidden=false; o.innerHTML=`<span class="fa-sub">loading…</span>`;
      try{ const hh=await fx.api("/api/fixed/yakeen/probe/history?limit=20"); o.innerHTML=`<table class="fa-hist"><tr><th>Run (KSA)</th><th>Trigger</th><th>Verdict</th><th>OK</th><th>Login</th><th>Detail</th><th>Mailed</th></tr>${(hh.runs||[]).map(r=>`<tr><td>${esc(ksa(r.run_at))}</td><td>${esc(r.trigger)}${r.actor?" · "+esc(r.actor):""}</td><td><span class="fa-verd ${r.verdict==="up"?"cleared":r.verdict==="answering"?"quiet":"ongoing"}">${esc(r.verdict)}</span></td><td>${r.ok_count}/${r.total}</td><td>${r.login&&r.login.ok?"ok":"FAILED"}</td><td>${(r.results||[]).filter(x=>x.cls!=="ok").map(x=>esc(x.label.replace("Yakeen ","")+": "+(x.message||x.cls))).join(" · ")||"all answered"}</td><td>${(r.mailed_to||[]).length||0}</td></tr>`).join("")||"<tr><td colspan=7>no runs yet</td></tr>"}</table>`; }catch(e3){ o.innerHTML=`<span class="fa-sub" style="color:#ef4444">${esc(e3.message)}</span>`; } };
  }
  window.fixedAppLane={ render };
})();
