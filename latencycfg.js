/* latencycfg.js — LATENCY ALERTING CONFIGURATION, shared: global p95 threshold, manual per-API overrides and the
 * per-API thresholds derived from history (apiLatencyBaseline.js). Lives under Mobile › Alerts › Alert rules as the
 * last section (10 Sep 2026 — moved out of Monitoring › Gateway, which now only links here).
 *   window.renderLatencyConfig(host)  — renders + wires; re-renders itself after every save / apply */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API=window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{ if(!r.ok) return r.json().then(e=>{ throw new Error(e.error||("HTTP "+r.status)); }); return r.json(); });
  let thr=null, HOST=null;
  const renderTraffic=()=>{ if(HOST) window.renderLatencyConfig(HOST); };
  /* ---- Latency alerting panel (global p95 ms + per-API overrides) ---- */
  function thresholdPanel(apis){
    const canEdit=window.opsCan&&window.opsCan("manageSync");
    const rows=Object.entries((thr&&(thr.manual||thr.perApi))||{});
    return `<div class="apanel" style="grid-column:span 12"><div class="ah"><b>Latency alerting
        <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· api_latency_p95 fires when an API's p95 ≥ its threshold (per-API override, else global) — value stored as p95 ÷ threshold, rule = ratio ≥ 100%</span></b></div>
      <div class="abody">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span class="rl">Global p95 threshold</span>
          <input id="monThrGlobal" type="number" min="1" step="50" value="${esc((thr&&thr.globalMs)||1500)}" ${canEdit?"":"disabled"}
            style="width:110px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)"> <span class="rl">ms</span>
          ${canEdit?`<button class="pill" id="monThrSave" style="border-left-color:var(--green)">Save thresholds</button><span id="monThrMsg" class="rl"></span>`
                   :`<span class="rl" style="color:var(--muted)">read-only — needs the Manage-sync capability</span>`}
        </div>
        <div class="rl" style="margin-top:10px;font-weight:700">Manual per-API overrides <span style="font-weight:400;color:var(--muted)">(win over the history-derived lines below)</span></div>
        <div id="monThrRows" style="margin-top:4px">${rows.map(([a,v],i)=>thrRow(a,v,i,canEdit,apis)).join("")}</div>
        ${canEdit?`<button class="pill" id="monThrAdd" style="border-left-color:var(--blue);margin-top:8px">+ Per-API override</button>`:""}
        <div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:8px">Changes are audited and take effect on the next sync tick (no rule edit needed). Rules: api_latency_breach (P2, ≥100%), api_latency_storm (P1, ≥200%), api_latency_per_api (P2, worst API vs its own override).</div>
        ${baselinePanel()}
      </div></div>`;
  }
  /* ---- Per-API thresholds from history (apiLatencyBaseline.js): top-N APIs by calls, threshold = baseline p95 × k ---- */
  function baselinePanel(){
    const canEdit=window.opsCan&&window.opsCan("manageSync");
    const a=(thr&&thr.auto)||{}; const autoN=Object.keys((thr&&thr.perApiAuto)||{}).length;
    const inp=(id,v,w,step)=>`<input id="${id}" type="number" min="1" step="${step||1}" value="${esc(v)}" ${canEdit?"":"disabled"} style="width:${w}px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)">`;
    return `<div style="margin-top:14px;padding:12px 14px;border:1px solid var(--line);border-left:4px solid var(--green);border-radius:10px;background:var(--card)">
      <div style="font-weight:800;font-size:12.5px">Per-API thresholds from history <span class="rl" style="font-weight:600;color:var(--muted)">· each API judged against its OWN normal: threshold = its baseline p95 (median of the daily p95s over the lookback) × multiplier, never below the floor · manual overrides above always win</span></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <span class="rl">Lookback</span><select id="lbDays" ${canEdit?"":"disabled"} style="border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)">${[3,7,14,30].map(d=>`<option value="${d}" ${(a.days||7)===d?"selected":""}>${d} days</option>`).join("")}</select>
        <span class="rl">Top</span>${inp("lbTop",a.topN||50,70)}<span class="rl">APIs by calls</span>
        <span class="rl">× multiplier</span>${inp("lbMult",a.mult||2,70,0.5)}
        <span class="rl">floor</span>${inp("lbFloor",a.floorMs||1000,90,50)}<span class="rl">ms</span>
        <button class="pill" id="lbPreview" style="border-left-color:var(--blue)">Preview</button>
        ${canEdit?`<button class="pill" id="lbApply" style="border-left-color:var(--green)">Apply as per-API thresholds</button>
        <label class="rl" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="lbAuto" ${a.enabled?"checked":""}> recalibrate automatically (every 6 h from the daily roll-up)</label>`:""}
        <span id="lbMsg" class="rl"></span></div>
      <div class="rl" style="margin-top:6px;color:var(--muted)">${autoN?`<b style="color:var(--green)">${autoN} API line(s) active from history</b> · last run ${a.lastRun?new Date(a.lastRun).toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})+" KSA":"—"} by ${esc(a.lastBy||"—")} · ${esc(a.source||"")}`:"no history-derived lines yet — Preview, then Apply"}</div>
      <div id="lbTable" style="margin-top:8px"></div></div>`;
  }
  function wireBaseline(){
    const msg=$("#lbMsg"); if(!$("#lbPreview")) return;
    const params=()=>`days=${$("#lbDays").value}&topN=${$("#lbTop").value}&mult=${$("#lbMult").value}&floorMs=${$("#lbFloor").value}`;
    const paint=d=>{ const t=$("#lbTable");
      t.innerHTML=`<div class="rl" style="margin-bottom:4px">Source: ${esc(d.source)} · global ${esc(d.globalMs)} ms · ${d.rows.length} API(s)</div>
        <div style="overflow:auto;max-height:520px"><table class="alerts" style="font-size:11.5px"><tr><th>#</th><th>API</th><th style="text-align:right">Calls</th><th style="text-align:right">Avg</th><th style="text-align:right">Baseline p95</th><th style="text-align:right">Max p95</th><th style="text-align:right">Tech fails</th><th style="text-align:right">Current</th><th style="text-align:right">Suggested</th></tr>
        ${d.rows.map((r,i)=>`<tr><td class="rl">${i+1}</td><td class="mono" style="font-size:11px">${esc(r.api)}</td><td style="text-align:right">${Number(r.calls).toLocaleString()}</td><td style="text-align:right">${esc(r.avg_ms)} ms</td><td style="text-align:right"><b>${esc(r.p95_base)} ms</b></td><td style="text-align:right;color:var(--muted)">${esc(r.p95_max)} ms</td><td style="text-align:right;color:${r.tech_fails?'#dc2626':'inherit'}">${esc(r.tech_fails)}</td><td style="text-align:right;color:var(--muted)">${esc(r.current)} ms <span style="font-size:9.5px">${esc(r.current_source)}</span></td><td style="text-align:right"><b style="color:${r.suggested<r.current?'var(--green)':r.suggested>r.current?'#d97706':'inherit'}">${esc(r.suggested)} ms</b></td></tr>`).join("")}</table></div>`; };
    $("#lbPreview").onclick=async()=>{ msg.textContent="Computing…"; try{ const d=await api("/api/monitoring/latency-baseline?"+params()); paint(d); msg.textContent=""; }catch(e){ msg.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; } };
    const ap=$("#lbApply"); if(ap) ap.onclick=async()=>{ if(!confirm("Replace the history-derived per-API thresholds with this suggestion? Manual overrides are kept and still win.")) return; msg.textContent="Applying…";
      try{ const r=await api("/api/monitoring/latency-baseline/apply",{method:"POST",body:JSON.stringify({days:Number($("#lbDays").value),topN:Number($("#lbTop").value),mult:Number($("#lbMult").value),floorMs:Number($("#lbFloor").value),enabled:$("#lbAuto")&&$("#lbAuto").checked})});
        msg.innerHTML=`<span style="color:var(--good);font-weight:700">Applied ${r.applied} API line(s) ✓ (audited · effective next sync tick)</span>`; thr=await api("/api/monitoring/latency-thresholds"); renderTraffic(); }
      catch(e){ msg.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; } };
    const au=$("#lbAuto"); if(au) au.onchange=async()=>{ try{ await api("/api/monitoring/latency-baseline/auto",{method:"POST",body:JSON.stringify({enabled:au.checked,days:Number($("#lbDays").value),topN:Number($("#lbTop").value),mult:Number($("#lbMult").value),floorMs:Number($("#lbFloor").value)})}); msg.textContent=au.checked?"Automatic recalibration ON":"Automatic recalibration off"; }catch(e){ msg.textContent=e.message; } };
  }

  function thrRow(apiPath,val,i,canEdit,apis){
    return `<div class="mon-thr-row" style="display:flex;gap:8px;align-items:center;margin:4px 0">
      <input list="monApiList" class="mono mon-thr-api" value="${esc(apiPath)}" placeholder="/api/…" ${canEdit?"":"disabled"}
        style="flex:1;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:11.5px;color:var(--ink);background:var(--card)">
      <input type="number" class="mon-thr-ms" min="1" step="50" value="${esc(val)}" ${canEdit?"":"disabled"}
        style="width:110px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)">
      <span class="rl">ms</span>
      ${canEdit?`<button class="pill mon-thr-del" style="border-left-color:#dc2626;padding:3px 9px">✕</button>`:""}
    </div>`;
  }
  function wireThresholds(apis){
    const add=$("#monThrAdd");
    if(add) add.onclick=()=>{ $("#monThrRows").insertAdjacentHTML("beforeend", thrRow("",1000,99,true,apis)); wireDel(); };
    wireDel();
    const save=$("#monThrSave");
    if(save) save.onclick=async ()=>{
      const perApi={};
      document.querySelectorAll(".mon-thr-row").forEach(r=>{
        const a=r.querySelector(".mon-thr-api").value.trim(), v=Number(r.querySelector(".mon-thr-ms").value);
        if(a&&v>0) perApi[a]=v;
      });
      const body={ globalMs:Number($("#monThrGlobal").value)||1500, perApi };
      const msg=$("#monThrMsg"); msg.textContent="Saving…";
      try{ thr=await api("/api/monitoring/latency-thresholds",{method:"PUT",body:JSON.stringify(body)});
        msg.innerHTML=`<span style="color:var(--good);font-weight:700">Saved ✓ (audited)</span>`;
        renderTraffic();   // repaint the per-API table with the new limits
      }catch(e){ msg.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; }
    };
  }
  function wireDel(){ document.querySelectorAll(".mon-thr-del").forEach(b=>b.onclick=()=>b.closest(".mon-thr-row").remove()); }
  window.renderLatencyConfig=async function(host){
    if(!host) return; HOST=host;
    if(!host.firstChild) host.innerHTML=`<div class="sub">Loading latency thresholds…</div>`;
    try{ thr=await api("/api/monitoring/latency-thresholds"); }catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const apis=Object.keys(Object.assign({},thr.perApiAuto||{},thr.manual||{})).sort();
    host.innerHTML=`<datalist id="monApiList">${apis.map(a=>`<option value="${esc(a)}">`).join("")}</datalist>`+thresholdPanel(apis).replace('class="apanel" style="grid-column:span 12"','class="apanel" id="latencyCfgPanel"');
    wireThresholds(apis); wireBaseline();
    if(/sec=latency/.test(location.hash)) setTimeout(()=>{ const p=$("#latencyCfgPanel"); if(p) p.scrollIntoView({behavior:"smooth",block:"start"}); },150);
  };
})();
