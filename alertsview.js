/* Live Alerts view — talks to the console API (server/src/api.js).
 * When the page is served by the Node server, uses same-origin.
 * When opened as file://, points at http://localhost:4600 and shows a hint if unreachable. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const el = (t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = (location.protocol==="file:") ? "http://localhost:4600" : "";
  let atab = "open";

  async function api(path, opts){
    const r = await fetch(API+path, Object.assign({headers:{"Content-Type":"application/json"}}, opts));
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.json();
  }
  function banner(msg){ $("#alBanner").innerHTML = msg ? `<div class="albanner">${msg}</div>` : ""; }
  const sevColor = s => ({P1:"#dc2626",P2:"#d97706",P3:"#64748b",P4:"#94a3b8"}[s]||"#64748b");
  const fmtVal = (v,unit)=> v==null?"—" : (unit==="rate"||unit==="ratio") ? (v*100).toFixed(1)+"%" : (Number.isInteger(+v)?v:(+v).toFixed(2));
  const timeAgo = iso => { if(!iso) return "—"; const d=new Date(iso); if(isNaN(d)) return "—"; return new Date(d.getTime()+3*3600e3).toISOString().replace("T"," ").slice(0,16)+" KSA"; };

  async function load(){
    banner("");
    let health;
    try { health = await api("/api/health"); }
    catch(e){
      banner(`Console API not reachable at <b>${API||location.origin}</b>. Start it with <span class="mono">cd server && npm install && npm run init && npm run serve</span> (then open <span class="mono">http://localhost:4600</span>), or run <span class="mono">docker compose -f docker-compose.console.yml up</span>. The static views (Topology, Journeys) work without it.`);
      $("#alStats").innerHTML=""; $("#alBody").innerHTML=""; return;
    }
    // summary
    let sum={bySeverity:[],byTeam:[],latest_sim_now:null};
    try { sum = await api("/api/alerts/summary"); } catch(e){}
    $("#alSimNow").textContent = sum.latest_sim_now ? ("virtual now: "+timeAgo(sum.latest_sim_now)) : "no sync yet — click ▷ Sync now";
    const sevMap={P1:0,P2:0,P3:0,P4:0};
    (sum.bySeverity||[]).forEach(r=> sevMap[r.severity]=r.open);
    const totalOpen = Object.values(sevMap).reduce((a,b)=>a+ (b||0),0);
    $("#alStats").innerHTML =
      `<div class="sevcard sev-p1"><b>${sevMap.P1||0}</b><span>P1 CRITICAL OPEN</span></div>`+
      `<div class="sevcard sev-p2"><b>${sevMap.P2||0}</b><span>P2 OPEN</span></div>`+
      `<div class="sevcard sev-p3"><b>${sevMap.P3||0}</b><span>P3 OPEN</span></div>`+
      `<div class="stat"><b>${totalOpen}</b><span>TOTAL OPEN · ${health.rules} RULES</span></div>`;
    if(atab==="rules") renderRules();
    else if(atab==="metrics") renderMetrics();
    else renderAlerts();
  }

  /* ---- robust stats for the seasonal baseline band (item 3) ---- */
  const _median = a => { if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; };
  const _mad = (a,med)=>{ if(!a.length) return null; return _median(a.map(x=>Math.abs(x-med))); };
  const _hodKsa = iso => { const d=new Date(new Date(iso).getTime()+3*3600e3); return isNaN(d)?null:d.getUTCHours(); }; // KSA hour-of-day 0..23
  /* Diurnal (hour-of-day, KSA) baseline from the series itself: per hour-of-day bucket,
   * median ± k·(MAD/0.6745). A point gets its bucket's band only if the bucket has ≥3
   * samples. The chart spans ~a week, so hour-of-day (not hour-of-week) keeps enough
   * samples per bucket while still capturing the day/night pattern. Mirrors anomaly.js. */
  function baselineBand(points, k){
    const buckets={};
    points.forEach(p=>{ if(p.value==null||!p.sim_now) return; const h=_hodKsa(p.sim_now); if(h==null) return; (buckets[h] ||= []).push(Number(p.value)); });
    const stat={};
    Object.entries(buckets).forEach(([h,arr])=>{
      if(arr.length<3) return;
      const med=_median(arr); let m=_mad(arr,med);
      if(m==null) return;
      if(m===0) m = med===0?0:Math.max(1e-9, med*0.05);
      const half=(k*m)/0.6745;
      stat[h]={ lo:Math.max(0, med-half), hi:med+half };
    });
    return points.map(p=>{ if(p.value==null||!p.sim_now) return null; const s=stat[_hodKsa(p.sim_now)]; return s?{lo:s.lo,hi:s.hi}:null; });
  }

  /* ---- dependency-free SVG sparkline: seasonal band + severity-coloured thresholds ----
   * opts.thrObjs = [{value, severity, operator}] — each threshold drawn in its own severity
   * colour (P1 red / P2 amber / P3 grey). A shaded blue band shows the expected diurnal range. */
  function sparkline(points, opts){
    const W=opts.w||280, H=opts.h||64, pad=4;
    const vals = points.map(p=>p.value).filter(v=>v!=null).map(Number);
    if(!vals.length) return `<svg viewBox="0 0 ${W} ${H}"><text x="8" y="${Math.round(H/2)+4}" font-size="11" fill="#94a3b8">no data in window</text></svg>`;
    const thrObjs = opts.thrObjs || [];
    const thr = thrObjs.map(t=>Number(t.value));
    const band = (opts.showBand===false) ? points.map(()=>null) : baselineBand(points, 2);  // ~2σ expected range
    const bandVals = band.filter(Boolean).flatMap(b=>[b.lo,b.hi]);
    let lo = Math.min(...vals, ...thr, ...(bandVals.length?bandVals:[])), hi = Math.max(...vals, ...thr, ...(bandVals.length?bandVals:[]));
    if(opts.unit==='rate'||opts.unit==='ratio'){ lo=Math.min(lo,0); hi=Math.max(hi, ...thr, Math.max(...vals)); }
    if(hi===lo) hi=lo+1;
    const n = points.length;
    const x = i => pad + (i/(Math.max(1,n-1)))*(W-2*pad);
    const y = v => H-pad - ((v-lo)/(hi-lo))*(H-2*pad);
    // seasonal band as shaded area over contiguous runs (breaks where a bucket lacks samples)
    let bandPath='';
    for(let i=0;i<n;){
      if(!band[i]){ i++; continue; }
      let j=i; while(j<n && band[j]) j++;
      let up='', dn='';
      for(let kk=i;kk<j;kk++){ up += `${kk===i?'M':'L'}${x(kk).toFixed(1)},${y(band[kk].hi).toFixed(1)} `; }
      for(let kk=j-1;kk>=i;kk--){ dn += `L${x(kk).toFixed(1)},${y(band[kk].lo).toFixed(1)} `; }
      bandPath += `<path d="${up}${dn}Z" fill="#2563eb" fill-opacity="0.10" stroke="none"/>`;
      i=j;
    }
    // build value path over non-null (bridge gaps)
    let d='', started=false;
    points.forEach((p,i)=>{ if(p.value==null) return; const cmd=started?'L':'M'; d+=`${cmd}${x(i).toFixed(1)},${y(Number(p.value)).toFixed(1)} `; started=true; });
    // breach markers — a point breaches if ANY rule's own condition is met there
    const breachAt = v => thrObjs.some(t => (t.operator==='lte'||t.operator==='lt') ? v<=Number(t.value) : v>=Number(t.value));
    let dots='';
    points.forEach((p,i)=>{ if(p.value==null) return; const v=Number(p.value);
      if(breachAt(v)) dots+=`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${opts.dotR||2.6}" fill="#dc2626"/>`;
    });
    let thrLines='';
    thrObjs.forEach(t=>{ const yy=y(Number(t.value)).toFixed(1); const col=sevColor(t.severity);
      thrLines+=`<line x1="${pad}" y1="${yy}" x2="${W-pad}" y2="${yy}" stroke="${col}" stroke-width="1" stroke-dasharray="3 3" opacity="0.8"/>`; });
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${bandPath}
      ${thrLines}
      <path d="${d}" fill="none" stroke="#2563eb" stroke-width="${opts.lw||1.6}"/>
      ${dots}
    </svg>`;
  }

  // Metric-charts state: cached card models + active filters (survive re-paints, no refetch)
  let _mcards = [];
  const M_RANK = {P1:1,P2:2,P3:3,P4:4};
  let MFILTER = { team:"all", breachingOnly:false };

  async function renderMetrics(){
    $("#alBody").innerHTML = `<div class="sub" style="padding:6px 2px">Loading metric series…</div>`;
    const rulesData = await api("/api/rules");
    const catalog = rulesData.catalog || [];
    const rulesByMetric = {};
    (rulesData.rules||[]).forEach(r=>{ (rulesByMetric[r.metric_key] ||= []).push(r); });
    // pick a representative window per metric = smallest rule window (or 3)
    const windowFor = k => { const rs=rulesByMetric[k]; return rs&&rs.length ? Math.min(...rs.map(r=>Number(r.window_hours))) : 3; };
    _mcards = await Promise.all(catalog.map(async m=>{
      const w = windowFor(m.key);
      let pts=[];
      try { pts = (await api(`/api/metrics/series?key=${encodeURIComponent(m.key)}&window=${w}`)).points || []; } catch(e){}
      const rs = rulesByMetric[m.key]||[];
      const thrObjs = rs.map(r=>({ value:Number(r.threshold), severity:r.severity, operator:r.operator }));
      const last = [...pts].reverse().find(p=>p.value!=null);
      const lastVal = last ? Number(last.value) : null;
      const breachedRules = last ? rs.filter(r=> (r.operator==='lte'||r.operator==='lt') ? lastVal<=Number(r.threshold) : lastVal>=Number(r.threshold)) : [];
      const breachSev = breachedRules.length ? breachedRules.map(r=>r.severity).sort((a,b)=>M_RANK[a]-M_RANK[b])[0] : null;
      const teams = [...new Set(rs.map(r=>r.team).filter(Boolean))];
      return { m, w, pts, rs, thrObjs, latest: last?fmtVal(last.value,m.unit):"—", nowBreached:breachedRules.length>0, breachSev, teams };
    }));
    paintMetrics();
  }

  /* ---- L1-friendly presentation helpers (display only — no data/behaviour changes) ---- */
  const mLabel = m => String(m.label).replace(/\bSDA\b/g, "DMS");  // display: SDA renamed to DMS (source label in metrics.js)
  const thrTxt = (m,v) => (m.unit==='rate'||m.unit==='ratio') ? (Math.round(Number(v)*10000)/100)+'%' : String(v);

  // "Now vs normal": median of the series + the diurnal expected band at the latest point.
  function baselineInfo(c){
    const vals = c.pts.map(p=>p.value).filter(v=>v!=null).map(Number);
    if(!vals.length) return null;
    const med = _median(vals);
    const band = [...baselineBand(c.pts, 2)].reverse().find(Boolean) || null;
    const lastP = [...c.pts].reverse().find(p=>p.value!=null);
    const lastVal = lastP ? Number(lastP.value) : null;
    let deltaPct = null;
    if(lastVal!=null && med!=null && med>0) deltaPct = Math.round(((lastVal-med)/med)*100);
    return { med, band, lastVal, deltaPct };
  }

  // Plain-words "✔ Healthy when … / ✘ Alerts when …" derived from operator + threshold (+ higher_is_bad)
  function ruleWords(c){
    const m=c.m, rs=[...c.rs].sort((a,b)=>(M_RANK[a.severity]||9)-(M_RANK[b.severity]||9));
    if(!rs.length) return "";
    const highRules = rs.filter(r=>r.operator==='gte'||r.operator==='gt');
    const lowRules  = rs.filter(r=>r.operator==='lte'||r.operator==='lt');
    const hb = rs[0].higher_is_bad!=null ? !!rs[0].higher_is_bad : highRules.length>0;
    const lines=[];
    if(highRules.length){
      const tight = highRules.reduce((a,b)=> Number(a.threshold)<=Number(b.threshold)?a:b);
      lines.push(`<span class="ok">✔ Healthy when ${tight.operator==='gt'?'at or below':'below'} <b>${thrTxt(m,tight.threshold)}</b></span>`);
      lines.push(`<span class="bad">✘ Alerts ${[...highRules].sort((a,b)=>Number(a.threshold)-Number(b.threshold)).map(r=>`<b>${esc(r.severity)}</b> ${r.operator==='gt'?'above':'at or above'} <b>${thrTxt(m,r.threshold)}</b>`).join(" · ")}</span>`);
    }
    if(lowRules.length){
      const tight = lowRules.reduce((a,b)=> Number(a.threshold)>=Number(b.threshold)?a:b);
      lines.push(`<span class="ok">✔ Healthy when ${tight.operator==='lt'?'at or above':'above'} <b>${thrTxt(m,tight.threshold)}</b></span>`);
      lines.push(`<span class="bad">✘ Alerts ${[...lowRules].sort((a,b)=>Number(b.threshold)-Number(a.threshold)).map(r=>`<b>${esc(r.severity)}</b> ${r.operator==='lt'?'below':'at or below'} <b>${thrTxt(m,r.threshold)}</b>`).join(" · ")}</span>`);
    }
    return `<div class="mokx">${lines.join("<br>")} <span class="dim">(${hb?"higher is worse":"lower is worse"})</span></div>`;
  }

  // Triage banner: a 3-second plain-English summary computed from ALL cards (ignores filters)
  function triageBanner(){
    const total=_mcards.length;
    if(!total) return "";
    const br=_mcards.filter(c=>c.nowBreached)
      .sort((a,b)=>(M_RANK[a.breachSev]||9)-(M_RANK[b.breachSev]||9) || String(a.m.label).localeCompare(String(b.m.label)));
    if(!br.length){
      return `<div class="mtriage t-ok"><span class="mtri-ico">✔</span><div>
        <b>All clear — every metric (${total} of ${total}) is inside its normal range.</b>
        <div class="mtri-sub">Nothing needs your attention right now. Each card below is one health metric: the blue line is recent behaviour, the shaded band is its usual range, and the dashed lines are the alert thresholds.</div>
      </div></div>`;
    }
    const worst=br[0].breachSev;
    const cls = worst==="P1" ? "t-p1" : worst==="P2" ? "t-p2" : "t-p3";
    const names = br.slice(0,3).map(c=>`<b>${esc(mLabel(c.m))}</b> is at <b>${esc(c.latest)}</b> (${esc(c.breachSev)})`).join("; ")
      + (br.length>3 ? ` — and ${br.length-3} more` : "");
    const advice = (worst==="P1"||worst==="P2")
      ? `Start with the ${worst==="P1"?"red":"amber"} card${br.length>1?"s":""} at the top — each one explains what the metric means and when it alerts. Click a card for its firing history, and open the <b>Troubleshoot</b> board to find the affected orders.`
      : `These are low-severity (P3) — worth a look, but not urgent. Click a card for its firing history.`;
    return `<div class="mtriage ${cls}"><span class="mtri-ico">⚠</span><div>
      <b>${br.length} of ${total} metrics ${br.length===1?"is":"are"} alerting right now${worst==="P1"?" — includes a P1 critical":""}.</b>
      <div class="mtri-sub">${names}. ${advice}</div>
    </div></div>`;
  }

  // Item 2 (sort + filter) + item 4 (severity-coloured thresholds) + item 1 (clickable → firing history)
  function paintMetrics(){
    const teamsAll = [...new Set(_mcards.flatMap(c=>c.teams))].sort();
    const bar = `<div class="mfbar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:2px 2px 12px">
      <label class="rl" style="display:flex;gap:6px;align-items:center;cursor:pointer;user-select:none">
        <input type="checkbox" id="mfBreach" ${MFILTER.breachingOnly?"checked":""}> Breaching only</label>
      <span class="rl" style="margin-left:8px">Team:</span>
      ${["all",...teamsAll].map(t=>`<button class="pill mfchip${MFILTER.team===t?" active":""}" data-team="${esc(t)}" style="padding:3px 10px">${t==="all"?"All":esc(t)}</button>`).join("")}
      <span class="rl" style="margin-left:auto">${_mcards.filter(c=>c.nowBreached).length} breaching · ${_mcards.length} metrics</span>
    </div>`;
    let list = _mcards.slice();
    if(MFILTER.breachingOnly) list = list.filter(c=>c.nowBreached);
    if(MFILTER.team!=="all") list = list.filter(c=>c.teams.includes(MFILTER.team));
    // breaching first (by severity), then alphabetical
    list.sort((a,b)=>{
      const ar=a.nowBreached?M_RANK[a.breachSev]:99, br=b.nowBreached?M_RANK[b.breachSev]:99;
      if(ar!==br) return ar-br;
      return String(a.m.label).localeCompare(String(b.m.label));
    });
    const cards = list.map(c=>{
      const m=c.m, rs=c.rs;
      const accent = c.nowBreached ? sevColor(c.breachSev) : "#16a34a";
      const stateCls = c.nowBreached ? ("mstate-"+String(c.breachSev).toLowerCase()) : "mstate-ok";
      const thrChips = rs.map(r=>`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px"><i style="display:inline-block;width:12px;border-top:2px dashed ${sevColor(r.severity)}"></i>${esc(r.severity)} ${r.operator==='lte'||r.operator==='lt'?'≤':'≥'} ${thrTxt(m,r.threshold)}</span>`).join("");
      const rid = rs[0] ? rs[0].id : "";
      const mlabel = mLabel(m);
      const statusPill = c.nowBreached
        ? `<span class="mstatus sp" style="background:${sevColor(c.breachSev)}">⚠ ALERTING · ${esc(c.breachSev)}</span>`
        : `<span class="mstatus ok">✔ HEALTHY · in normal range</span>`;
      const bi = baselineInfo(c);
      let cmp = "";
      if(bi && bi.med!=null){
        let delta = "";
        if(bi.deltaPct!=null){
          if(Math.abs(bi.deltaPct)<10) delta = `<span class="mdelta" style="background:var(--tint-green);color:var(--tint-green-fg)">≈ normal</span>`;
          else{
            const up=bi.deltaPct>0;
            delta = c.nowBreached
              ? `<span class="mdelta" style="background:${sevColor(c.breachSev)};color:#fff">${up?"▲":"▼"} ${Math.abs(bi.deltaPct)}% ${up?"above":"below"} normal</span>`
              : `<span class="mdelta" style="background:var(--card2);color:var(--muted);border:1px solid var(--line)">${up?"▲":"▼"} ${Math.abs(bi.deltaPct)}% ${up?"above":"below"} normal</span>`;
          }
        }
        cmp = `<div class="mcompare">now <b ${c.nowBreached?`style="color:${sevColor(c.breachSev)}"`:""}>${esc(c.latest)}</b> · normal ≈ <b>${esc(fmtVal(bi.med,m.unit))}</b>${bi.band?` <span class="dim">(usually ${esc(fmtVal(bi.band.lo,m.unit))}–${esc(fmtVal(bi.band.hi,m.unit))})</span>`:""} ${delta}</div>`;
      }
      const desc = (rs[0] && rs[0].description)
        ? esc(rs[0].description)
        : "No alert rule is attached to this metric yet — it is shown for context only.";
      return `<div class="mcard ${stateCls}${rid?" mclickable":""}" ${rid?`data-mrule="${rid}" title="Click for firing history"`:""} style="border-left:5px solid ${accent};${rid?"cursor:pointer":""}">
        <div class="mtop">${statusPill}${rid?`<span class="mhint">firing history ↗</span>`:""}</div>
        <div class="mh"><b>${esc(mlabel)}</b><span class="mval ${c.nowBreached?"breachdot":""}" ${c.nowBreached?`style="color:${sevColor(c.breachSev)}"`:""}>${esc(c.latest)}</span></div>
        ${cmp}
        <div class="mdesc"><span class="mdt">What this means</span>${desc}</div>
        ${ruleWords(c)}
        ${sparkline(c.pts, {unit:m.unit, thrObjs:c.thrObjs, w:560, h:130, lw:2, dotR:3.4})}
        <div class="mlegend">${rs.length?thrChips:""}<span><i style="border-color:#2563eb"></i>value</span><span><i style="border:none;border-top:none;background:#2563eb;opacity:.22;height:8px"></i>expected range</span>${rs.length?`<span><b style="color:#dc2626">●</b> threshold crossed</span>`:""}</div>
        <div class="msub">${esc(m.key)} · ${c.w}h window · ${c.pts.length} pts${rs.length?` · ${rs.length} rule(s)`:""}</div>
      </div>`;
    }).join("");
    $("#alBody").innerHTML = triageBanner() + bar + `<div class="mgrid">${cards || '<div class="okbox">No metrics match this filter.</div>'}</div>`;
    // wire filters (re-paint only, no refetch)
    const bc=$("#mfBreach"); if(bc) bc.addEventListener("change",()=>{ MFILTER.breachingOnly=bc.checked; paintMetrics(); });
    $("#alBody").querySelectorAll(".mfchip").forEach(b=>b.addEventListener("click",()=>{ MFILTER.team=b.dataset.team; paintMetrics(); }));
    // clickable card → that metric's rule firing history
    $("#alBody").querySelectorAll("[data-mrule]").forEach(card=>card.addEventListener("click",()=>{
      const c=_mcards.find(x=>x.rs[0]&&String(x.rs[0].id)===String(card.dataset.mrule));
      if(c) openHistory(c.rs[0].id, c.rs[0]);
    }));
  }

  const dur = s => s==null?"—" : s<60?`${s}s` : s<3600?`${Math.round(s/60)}m` : s<86400?`${(s/3600).toFixed(1)}h` : `${(s/86400).toFixed(1)}d`;
  const canAck = ()=> window.opsCan && window.opsCan("ackErrors");

  /* ---- Guided Response (L1) — runbook lookup + one-click actions on open alerts ---- */
  const GENERIC_RUNBOOK = "Investigate the metric in Analytics/Troubleshoot; check with the owning team; escalate per severity if it persists.";
  let _rbMap = null, _rbPromise = null;                 // rule key -> runbook, fetched once & reused
  function loadRunbooks(){
    if(_rbMap) return Promise.resolve(_rbMap);
    if(!_rbPromise) _rbPromise = api("/api/rules").then(d=>{
      _rbMap = {};
      (d.rules||[]).forEach(r=>{ if(r.key && r.runbook) _rbMap[r.key]=r.runbook; });
      return _rbMap;
    }).catch(()=>{ _rbPromise=null; return {}; });      // degrade gracefully; retry on next open
    return _rbPromise;
  }
  function rbStepsHtml(rb){
    const txt = String(rb||"").trim();
    if(!txt) return `<div class="grstep"><span class="grn">i</span><span>${esc(GENERIC_RUNBOOK)}</span></div>`;
    const lines = txt.split(/\r?\n/).map(s=>s.replace(/^\s*(?:\d+[.)]|[-*•])\s*/,"").trim()).filter(Boolean);
    return lines.map((s,i)=>`<div class="grstep"><span class="grn">${i+1}</span><span>${esc(s)}</span></div>`).join("");
  }
  function guideHtml(a, rb){
    const steps = rb===undefined ? `<div class="rl">Loading runbook…</div>` : rbStepsHtml(rb);
    return `<div class="grbox" style="border-left:3px solid ${sevColor(a.severity)}">
      <div class="grhead">GUIDED RESPONSE
        <span class="sevpill" style="background:${sevColor(a.severity)}">${esc(a.severity)}</span>
        <span class="grteam">Team: ${esc(a.team||"unassigned")}</span>
        <span class="mono" style="font-weight:400;letter-spacing:0">${esc(a.rule_key||"")}</span></div>
      <div id="grsteps_${a.id}">${steps}</div>
      <div class="gract">
        ${canAck()?`<button class="pill" id="grnotify_${a.id}" style="border-left-color:#dc2626">⚡ Notify on-call</button><span class="grres" id="grnres_${a.id}"></span>`:''}
        <button class="pill" id="grtixbtn_${a.id}" style="border-left-color:#2563eb">🎫 Related tickets</button>
        <button class="pill" id="grts_${a.id}" style="border-left-color:var(--green)">🔧 Open in Troubleshoot</button>
      </div>
      <div id="grtix_${a.id}"></div>
    </div>`;
  }
  async function grNotify(id){
    const btn=$("#grnotify_"+id), out=$("#grnres_"+id); if(!btn||!out) return;
    btn.disabled=true; out.textContent="sending…";
    try{
      const d = await api(`/api/alerts/${id}/notify`,{method:"POST",body:JSON.stringify({})});
      const ch = d.channels||[];
      out.innerHTML = ch.length
        ? ch.map(c=>`<span style="color:${c.sent?'#16a34a':'#dc2626'}" title="${esc(c.error||'')}">${esc(c.name)} ${c.sent?'✓':'✗'}</span>`).join(' · ')
        : `<span style="color:#d97706">no ChatOps channels configured</span>`;
    }catch(e){ out.innerHTML=`<span style="color:#dc2626">notify failed: ${esc(e.message)}</span>`; btn.disabled=false; return; }
    btn.textContent="⚡ Notified";
  }
  async function grTickets(id){
    const host=$("#grtix_"+id); if(!host) return;
    if(host.dataset.open==="1"){ host.dataset.open="0"; host.innerHTML=""; return; }
    host.dataset.open="1"; host.innerHTML=`<div class="rl" style="margin-top:6px">Checking ServiceNow…</div>`;
    let d; try{ d=await api("/api/alerts/"+id+"/tickets"); }catch(e){ host.innerHTML=`<div class="rl" style="margin-top:6px">ServiceNow: ${esc(e.message)}</div>`; return; }
    if(!d.configured){ host.innerHTML=`<div class="rl" style="margin-top:6px">ServiceNow not configured.</div>`; return; }
    if(d.error){ host.innerHTML=`<div class="rl" style="margin-top:6px">ServiceNow unreachable: ${esc(d.error)}</div>`; return; }
    const t=d.tickets||[];
    if(!t.length){ host.innerHTML=`<div class="rl" style="margin-top:6px">No related tickets.</div>`; return; }
    host.innerHTML = `<div style="margin-top:6px">`+t.map(x=>`<div class="grtik"><a href="${esc(x.link)}" target="_blank" rel="noopener" class="mono">${esc(x.number)}</a> · ${esc(x.short_description||"")} <span class="rl">${esc(x.state||"")}${x.priority?` · ${esc(x.priority)}`:""}</span></div>`).join("")+`</div>`;
  }
  async function toggleGuide(id, a){
    const row=$("#grrow_"+id); if(!row||!a) return;
    if(!row.hasAttribute("hidden")){ row.setAttribute("hidden",""); return; }
    row.removeAttribute("hidden");
    const cell=row.querySelector("td");
    cell.innerHTML = guideHtml(a, _rbMap ? (_rbMap[a.rule_key]||null) : undefined);
    const nb=$("#grnotify_"+id); if(nb) nb.onclick=()=>grNotify(id);
    const tb=$("#grtixbtn_"+id); if(tb) tb.onclick=()=>grTickets(id);
    const ts=$("#grts_"+id); if(ts) ts.onclick=()=>{ if(window.setConsoleHash) window.setConsoleHash("troubleshoot"); };
    if(!_rbMap){                                        // fill steps in when rules arrive; never blocks the table render
      const map = await loadRunbooks();
      const steps=$("#grsteps_"+id);
      if(steps && !row.hasAttribute("hidden")) steps.innerHTML = rbStepsHtml(map[a.rule_key]||null);
    }
  }

  async function renderAlerts(){
    let stats={}; try{ stats=await api("/api/incidents/stats"); }catch(e){}
    loadRunbooks();                                     // prefetch rule runbooks (cached; never blocks render)
    const data = await api("/api/alerts?status="+(atab==="all"?"all":"open"));
    const rows = data.alerts||[];
    const byId = {}; rows.forEach(a=>{ byId[a.id]=a; });
    // root-cause grouping: place each correlated child directly under its provider root, and
    // count children per root so the root row can say "N correlated".
    const childCount = {};
    rows.forEach(a=>{ if(a.correlation&&a.correlation.role==='child'){ childCount[a.correlation.parent]=(childCount[a.correlation.parent]||0)+1; } });
    const childrenByParent = {};
    rows.forEach(a=>{ if(a.correlation&&a.correlation.role==='child'){ (childrenByParent[a.correlation.parent]=childrenByParent[a.correlation.parent]||[]).push(a); } });
    const used = new Set(); const ordered = [];
    rows.forEach(a=>{
      if(a.correlation&&a.correlation.role==='child') return;   // rendered under its root
      ordered.push(a); used.add(a.id);
      if(a.correlation&&a.correlation.role==='root'){ (childrenByParent[a.rule_key]||[]).forEach(ch=>{ if(!used.has(ch.id)){ ordered.push(ch); used.add(ch.id); } }); }
    });
    rows.forEach(a=>{ if(!used.has(a.id)) ordered.push(a); });   // any orphan children (root not open) fall through normally
    const strip = `<div class="incstrip">
      <div class="incstat"><b>${stats.open_total??0}</b><span>OPEN</span></div>
      <div class="incstat"><b style="color:${(stats.unacked||0)>0?'#dc2626':'#16a34a'}">${stats.unacked??0}</b><span>UNACKED</span></div>
      <div class="incstat"><b>${dur(stats.mtta_sec)}</b><span>MTTA · 30d</span></div>
      <div class="incstat"><b>${dur(stats.mttr_sec)}</b><span>MTTR · 30d</span></div>
      <div class="incstat"><b>${stats.resolved_24h??0}</b><span>RESOLVED · 24h</span></div>
    </div>`;
    if(!rows.length){ $("#alBody").innerHTML = strip + `<div class="okbox" style="margin-top:6px">No ${atab==="all"?"":"open "}alerts. ${atab==="open"?"All clear — or run a sync/simulate to evaluate rules against the replica.":""}</div>`; return; }
    let h = strip + `<table class="alerts"><tr><th>SEV</th><th>INCIDENT</th><th>TEAM</th><th>OBSERVED</th><th>STATUS</th><th>OWNER</th><th>FIRST → LAST</th><th>ACTIONS</th></tr>`;
    ordered.forEach(a=>{
      const snoozed = a.snoozed_until && new Date(a.snoozed_until)>new Date();
      const cr = a.correlation||null;
      const isChild = cr && cr.role==='child';
      const corrLine = !cr ? '' :
        cr.role==='child'   ? `<br><span class="rl" style="color:#7c3aed">↳ correlated under <b>${esc(cr.parentName)}</b> · not separately paged</span>` :
        cr.role==='related' ? `<br><span class="rl" style="color:#0891b2">related to ${esc(cr.parentName)}</span>` :
        cr.role==='root'    ? `<br><span class="rl" style="color:#dc2626;font-weight:700">◆ root cause${childCount[a.rule_key]?` · ${childCount[a.rule_key]} correlated`:''}</span>${cr.impacts&&cr.impacts.length?`<br><span class="rl">blocks: ${cr.impacts.map(j=>`<span style="display:inline-block;background:#fee2e2;color:#991b1b;border-radius:4px;padding:0 5px;margin:1px 2px 0 0;font-size:10.5px">${esc(j)}</span>`).join("")}</span>`:''}` : '';
      const stateTag = a.status!=='open' ? `<span class="st-resolved">resolved</span>`
        : snoozed ? `<span style="color:#7c3aed;font-weight:700">snoozed</span>`
        : a.ack_at ? `<span style="color:#0891b2;font-weight:700">acked</span>`
        : `<span class="st-open">open${a.breach_count>1?` ×${a.breach_count}`:""}</span>`;
      const acts = (a.status==='open' && canAck()) ? `
        ${a.ack_at?'':`<button class="pill" data-ack="${a.id}" style="padding:3px 8px">Ack</button>`}
        <button class="pill" data-snooze="${a.id}" style="padding:3px 8px">${snoozed?'Snoozed':'Snooze'}</button>
        <button class="pill" data-resolve="${a.id}" style="padding:3px 8px;border-left-color:#16a34a">Resolve</button>` : '';
      h += `<tr${isChild?' style="opacity:.62"':''}>
        <td><span class="sevpill" style="background:${sevColor(a.severity)}">${esc(a.severity)}</span></td>
        <td>${isChild?'<span style="color:var(--muted)">↳ </span>':''}<b>${esc(a.name)}</b><br><span class="mono" style="color:var(--muted)">${esc(a.metric_key)} ${esc(a.operator)} ${esc(a.threshold)}</span>${corrLine}</td>
        <td>${esc(a.team||"—")}</td>
        <td><b>${esc(a.message? a.message.split("observed ")[1]||"" : "")}</b><br><span class="rl">${esc(a.window_hours)}h window</span></td>
        <td>${stateTag}</td>
        <td class="mono" style="font-size:11px">${a.assignee?esc(a.assignee.split("@")[0]):'—'}${a.ack_by?`<br><span style="color:var(--muted)">ack ${esc(a.ack_by.split("@")[0])}</span>`:''}</td>
        <td class="mono" style="color:var(--muted)">${timeAgo(a.fired_at)}<br>${timeAgo(a.last_seen_at)}</td>
        <td style="white-space:nowrap">${a.status==='open'?`<button class="pill" data-guide="${a.id}" style="padding:3px 8px;border-left-color:#2563eb">▶ Guide</button> `:''}<button class="pill" data-det="${a.id}" style="padding:3px 8px">Details</button> ${acts}</td>
      </tr>
      ${a.status==='open'?`<tr class="grrow" id="grrow_${a.id}" hidden><td colspan="8"></td></tr>`:''}
      <tr class="incdetail" id="incdet_${a.id}" hidden><td colspan="8"></td></tr>`;
    });
    h += `</table>`;
    $("#alBody").innerHTML = h;
    const body=$("#alBody");
    body.querySelectorAll("[data-ack]").forEach(b=>b.addEventListener("click",()=>incAction(b.dataset.ack,"ack")));
    body.querySelectorAll("[data-snooze]").forEach(b=>b.addEventListener("click",()=>{ const hrs=prompt("Snooze for how many hours?","1"); if(hrs) incAction(b.dataset.snooze,"snooze",{hours:Number(hrs)}); }));
    body.querySelectorAll("[data-resolve]").forEach(b=>b.addEventListener("click",()=>{ if(confirm("Resolve this incident?")) incAction(b.dataset.resolve,"resolve"); }));
    body.querySelectorAll("[data-det]").forEach(b=>b.addEventListener("click",()=>toggleDetail(b.dataset.det)));
    body.querySelectorAll("[data-guide]").forEach(b=>b.addEventListener("click",()=>toggleGuide(b.dataset.guide, byId[b.dataset.guide])));
  }
  async function incAction(id, action, payload){
    try{ await api(`/api/alerts/${id}/${action}`,{method:"POST",body:JSON.stringify(payload||{})}); renderAlerts(); }
    catch(e){ banner(`${action} failed: ${esc(e.message)}`); }
  }
  async function toggleDetail(id){
    const row=$("#incdet_"+id); if(!row) return;
    if(!row.hasAttribute("hidden")){ row.setAttribute("hidden",""); return; }
    row.removeAttribute("hidden");
    const cell=row.querySelector("td"); cell.innerHTML=`<div class="sub">Loading…</div>`;
    let d; try{ d=await api("/api/alerts/"+id); }catch(e){ cell.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const comments=(d.comments||[]).map(c=>`<div style="margin:4px 0"><b>${esc((c.author||'').split("@")[0]||'—')}</b> <span class="rl">${timeAgo(c.created_at)}</span><br>${esc(c.body)}</div>`).join("")||`<div class="rl">No comments yet.</div>`;
    cell.innerHTML=`<div style="padding:10px 6px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div><h5 style="margin:0 0 6px">RUNBOOK</h5>${d.runbook?`<div style="font-size:12.5px;white-space:pre-wrap">${esc(d.runbook)}</div>`:`<div class="rl">No runbook set for this rule. Add one in the rule editor.</div>`}
        <h5 style="margin:14px 0 6px">MESSAGE</h5><div class="mono" style="font-size:11.5px">${esc(d.alert.message||'')}</div></div>
      <div><h5 style="margin:0 0 6px">DISCUSSION</h5><div id="inccomm_${id}">${comments}</div>
        ${canAck()?`<div style="display:flex;gap:6px;margin-top:8px"><input id="incin_${id}" class="jsearch" placeholder="Add a comment…" style="flex:1"><button class="pill" id="incsend_${id}" style="border-left-color:var(--green)">Post</button></div>`:''}</div>
    </div><div id="sntix_${id}" style="padding:0 6px 12px"><div class="rl">Checking ServiceNow for related tickets…</div></div>`;
    const send=$("#incsend_"+id);
    if(send) send.onclick=async()=>{ const v=$("#incin_"+id).value.trim(); if(!v)return; try{ await api(`/api/alerts/${id}/comment`,{method:"POST",body:JSON.stringify({body:v})}); row.setAttribute("hidden",""); toggleDetail(id); }catch(e){ banner(esc(e.message)); } };
    loadSnTickets(id);
  }
  // READ-ONLY ServiceNow correlation — incidents this alert likely caused (server queries SN Table API)
  async function loadSnTickets(id){
    const host=$("#sntix_"+id); if(!host) return;
    let d; try{ d=await api("/api/alerts/"+id+"/tickets"); }catch(e){ host.innerHTML=`<div class="rl">ServiceNow: ${esc(e.message)}</div>`; return; }
    if(!d.configured){ host.innerHTML=`<div class="rl">ServiceNow correlation not configured — set <span class="mono">SN_URL / SN_USER / SN_PASS</span> (read-only account) in the console env.</div>`; return; }
    if(d.error){ host.innerHTML=`<h5 style="margin:2px 0 6px">RELATED SERVICENOW TICKETS</h5><div class="albanner">ServiceNow unreachable: ${esc(d.error)}</div>`; return; }
    const t=d.tickets||[];
    const head=`<h5 style="margin:2px 0 6px">RELATED SERVICENOW TICKETS <span class="rl">(${t.length}${d.journey?` · ${esc(d.journey)}`:""})</span></h5>`;
    if(!t.length){ host.innerHTML=head+`<div class="okbox">No matching ServiceNow incidents in the window.</div>`; return; }
    host.innerHTML=head+`<table class="alerts"><tr><th>INCIDENT</th><th>SHORT DESCRIPTION</th><th>PRI</th><th>STATE</th><th>OPENED</th></tr>`+
      t.map(x=>`<tr>
        <td><a href="${esc(x.link)}" target="_blank" rel="noopener" class="mono">${esc(x.number)}</a></td>
        <td>${esc(x.short_description||"")}</td>
        <td>${esc(x.priority||"")}</td>
        <td>${esc(x.state||"")}</td>
        <td class="mono" style="color:var(--muted)">${esc((x.opened_at||"").slice(0,16))}</td>
      </tr>`).join("")+`</table>`;
  }

  let _catalog = [];
  const CHANNELS = ["any","app","web","sda","posa","partner"];
  async function renderRules(){
    const data = await api("/api/rules");
    const rules = data.rules||[];
    _catalog = data.catalog||[];
    const canEdit = window.opsCan && window.opsCan("editRules");
    const canMail = window.opsCan && window.opsCan("manageSync");
    let h = `<div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">`;
    if(canEdit) h += `<button class="pill" id="newRuleBtn" style="border-left-color:var(--green)">+ New rule</button>`;
    if(canMail) h += `<button class="pill" id="mailDigestBtn" style="border-left-color:#2563eb">✉ Send email digest</button>`;
    h += `<span class="rl" style="align-self:center">Recipients = users with <b>Mail alert</b> on (Settings → User management). Digest also auto-emails when a new alert fires.</span></div>`;
    h += `<table class="alerts"><tr><th>ON</th><th>SEV</th><th>RULE</th><th>TEAM</th><th>METRIC</th><th>CONDITION</th><th>WINDOW</th><th>ACTIVE (KSA)</th><th></th></tr>`;
    rules.forEach(r=>{
      const cond = `${r.operator} ${r.unit==='rate'||r.unit==='ratio' ? (r.threshold*100)+'%' : r.threshold}` + (r.min_sample?` · n≥${r.min_sample}`:"") + (r.channel&&r.channel!=='any'?` · ${r.channel}`:"") + (r.dim&&Object.keys(r.dim).length?` · ${Object.entries(r.dim).map(([k,v])=>k+'='+v).join(',')}`:"");
      const active = (r.active_from!=null&&r.active_to!=null) ? `${r.active_from}:00–${r.active_to}:00` : "always";
      h += `<tr class="rule-row">
        <td><label class="switch"><input type="checkbox" data-rid="${r.id}" ${r.enabled?"checked":""} ${canEdit?'':'disabled'}><span class="slider"></span></label></td>
        <td><span class="sevpill" style="background:${sevColor(r.severity)}">${esc(r.severity)}</span></td>
        <td><b>${esc(r.name)}</b>${r.builtin?' <span class="rl" style="font-size:10px">builtin</span>':''}<br><span style="color:var(--muted);font-size:11px">${esc(r.description||"")}</span></td>
        <td>${esc(r.team||"—")}</td>
        <td class="mono">${esc(r.metric_key)}</td>
        <td class="mono">${esc(cond)}</td>
        <td>${esc(r.window_hours)}h</td>
        <td class="mono">${esc(active)}</td>
        <td style="white-space:nowrap"><button class="pill" data-hist="${r.id}" style="padding:3px 9px">History</button>${canEdit?` <button class="pill" data-edit="${r.id}" style="padding:3px 9px">Edit</button>`:''}</td>
      </tr>`;
    });
    h += `</table>`;
    $("#alBody").innerHTML = h;
    $("#alBody").querySelectorAll("input[data-rid]").forEach(cb=>{
      cb.addEventListener("change", async ()=>{
        try{ await api("/api/rules/"+cb.dataset.rid, {method:"PATCH", body:JSON.stringify({enabled:cb.checked})}); }
        catch(e){ banner("Failed to update rule: "+e.message); cb.checked=!cb.checked; }
      });
    });
    const byId = id => rules.find(x=>String(x.id)===String(id));
    $("#alBody").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openRuleModal(byId(b.dataset.edit))));
    $("#alBody").querySelectorAll("[data-hist]").forEach(b=>b.addEventListener("click",()=>openHistory(b.dataset.hist, byId(b.dataset.hist))));
    const nb=$("#newRuleBtn"); if(nb) nb.addEventListener("click", ()=>openRuleModal(null));
    const mb=$("#mailDigestBtn"); if(mb) mb.addEventListener("click", ()=>sendDigest(mb));
  }

  async function sendDigest(btn){
    const old=btn.textContent; btn.textContent="… sending"; btn.disabled=true;
    try{
      const r=await api("/api/alerts/notify",{method:"POST",body:JSON.stringify({})});
      if(r.sent) banner(`✉ Digest sent to ${r.recipients.length} recipient(s): ${esc(r.recipients.join(", "))} — ${r.firing} firing / ${r.total} rules.`);
      else if(r.dev) { banner(`Dev mode (no SMTP): digest not emailed. Would send to ${r.recipients.length||0} recipient(s). Showing preview.`); showPreview(r.previewHtml); }
      else if(r.reason) banner(`Not sent — ${esc(r.reason)}`);
      else banner(`Not sent${r.error?': '+esc(r.error):''}.`);
    }catch(e){ banner("Digest failed: "+esc(e.message)); }
    btn.textContent=old; btn.disabled=false;
  }
  function showPreview(html){
    const card=$("#ruleModalCard");
    card.innerHTML=`<div class="modal-head"><span class="path">Alert email preview</span><span class="x" id="ruX">×</span></div>
      <div class="modal-body"><div class="sub" style="margin-bottom:8px">This is exactly what recipients receive once SMTP is configured.</div>
        <div style="border:1px solid var(--line);border-radius:10px;overflow:auto">${html}</div></div>`;
    $("#ruleModal").classList.add("open");
    $("#ruX").onclick=()=>$("#ruleModal").classList.remove("open");
  }

  async function openHistory(id, rule){
    const card=$("#ruleModalCard");
    card.innerHTML=`<div class="modal-head"><span class="path">History · ${esc(rule?rule.name:'')}</span><span class="x" id="ruX">×</span></div>
      <div class="modal-body">${window.salamLoader?window.salamLoader("Loading rule history…"):"Loading…"}</div>`;
    $("#ruleModal").classList.add("open");
    $("#ruX").onclick=()=>$("#ruleModal").classList.remove("open");
    let d; try{ d=await api("/api/rules/"+id+"/history"); }
    catch(e){ card.querySelector(".modal-body").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const fires=d.fires||[], changes=d.changes||[];
    let h=`<h5 style="margin:0 0 6px">FIRING HISTORY (${fires.length})</h5>`;
    if(!fires.length) h+=`<div class="okbox">This rule has not fired in the recorded history.</div>`;
    else { h+=`<table class="alerts"><tr><th>STATUS</th><th>OBSERVED</th><th>×</th><th>FIRED</th><th>LAST SEEN</th><th>RESOLVED</th></tr>`+
      fires.map(f=>`<tr>
        <td class="${f.status==='open'?'st-open':'st-resolved'}">${esc(f.status)}</td>
        <td class="mono">${f.observed_value==null?'—':esc(f.observed_value)}${f.sample!=null?` (n=${esc(f.sample)})`:''}</td>
        <td>${esc(f.breach_count||1)}</td>
        <td class="mono" style="color:var(--muted)">${timeAgo(f.fired_at)}</td>
        <td class="mono" style="color:var(--muted)">${timeAgo(f.last_seen_at)}</td>
        <td class="mono" style="color:var(--muted)">${f.resolved_at?timeAgo(f.resolved_at):'—'}</td>
      </tr>`).join("")+`</table>`; }
    h+=`<h5 style="margin:16px 0 6px">CONFIG CHANGES (${changes.length})</h5>`;
    if(!changes.length) h+=`<div class="okbox">No configuration changes recorded.</div>`;
    else { h+=`<table class="alerts"><tr><th>WHEN</th><th>WHO</th><th>ACTION</th></tr>`+
      changes.map(c=>`<tr><td class="mono" style="color:var(--muted)">${timeAgo(c.created_at)}</td><td>${esc(c.actor||'—')}</td><td class="mono">${esc(c.action)}</td></tr>`).join("")+`</table>`; }
    card.querySelector(".modal-body").innerHTML=h;
  }

  function openRuleModal(rule){
    const card=$("#ruleModalCard");
    const isEdit=!!rule;
    const sel=(v,x)=>v===x?"selected":"";
    const opts=_catalog.map(m=>`<option value="${m.key}" ${sel(rule&&rule.metric_key,m.key)}>${esc(m.label)} (${m.unit})</option>`).join("");
    const chOpts=CHANNELS.map(c=>`<option value="${c}" ${sel((rule&&rule.channel)||'any',c)}>${c==='any'?'Any':c}</option>`).join("");
    const g=(k,d)=> rule&&rule[k]!=null?rule[k]:d;
    card.innerHTML=`<div class="modal-head"><span class="path">${isEdit?'Edit alert rule'+(rule.builtin?' (builtin)':''):'New alert rule'}</span><span class="x" id="ruX">×</span></div>
      <div class="modal-body">
        <div class="ffull"><label>NAME</label><input id="ru_name" placeholder="e.g. Payment failure spike (web)" value="${esc(g('name',''))}"></div>
        <div class="fgrid" style="margin-top:10px">
          <div><label>METRIC</label><select id="ru_metric">${opts}</select></div>
          <div><label>OPERATOR</label><select id="ru_op">
            ${[['gte','≥ at least'],['gt','&gt; more than'],['lte','≤ at most'],['lt','&lt; less than'],['eq','= equals']].map(([v,l])=>`<option value="${v}" ${sel(g('operator','gte'),v)}>${l}</option>`).join("")}</select></div>
          <div><label>THRESHOLD</label><input id="ru_thr" type="number" step="any" value="${esc(g('threshold',0.2))}"></div>
          <div><label>WINDOW (hours)</label><input id="ru_win" type="number" value="${esc(g('window_hours',3))}"></div>
          <div><label>MIN SAMPLE</label><input id="ru_min" type="number" value="${esc(g('min_sample',20))}"></div>
          <div><label>SEVERITY</label><select id="ru_sev">${['P1','P2','P3','P4'].map(s=>`<option ${sel(g('severity','P3'),s)}>${s}</option>`).join("")}</select></div>
          <div><label>CHANNEL</label><select id="ru_ch">${chOpts}</select></div>
          <div><label>TEAM</label><select id="ru_team">${['','BSS Ops','Digital Ops','Sales Ops','OSS Ops'].map(t=>`<option value="${t}" ${sel(g('team',''),t)}>${t||'—'}</option>`).join("")}</select></div>
          <div><label>ACTIVE HOURS (KSA, optional)</label><div style="display:flex;gap:6px"><input id="ru_from" type="number" placeholder="from" min="0" max="23" value="${rule&&rule.active_from!=null?rule.active_from:''}"><input id="ru_to" type="number" placeholder="to" min="0" max="23" value="${rule&&rule.active_to!=null?rule.active_to:''}"></div></div>
        </div>
        <div class="ffull"><label>DESCRIPTION</label><textarea id="ru_desc" rows="2">${esc(g('description',''))}</textarea></div>
        <div class="ffull"><label>RUNBOOK <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">— what to do when this fires (shown on the incident)</span></label><textarea id="ru_runbook" rows="2" placeholder="e.g. Check ClearTax ZATCA queue; if backed up, page BSS on-call.">${esc(g('runbook',''))}</textarea></div>
        <div class="testbox" id="ru_testbox">Click <b>Test now</b> to evaluate this rule against the current data.</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="pill" id="ru_test">Test now</button>
          <button class="pill" id="ru_save" style="border-left-color:var(--green)">${isEdit?'Save changes':'Save rule'}</button>
        </div>
      </div>`;
    $("#ruleModal").classList.add("open");
    const gather=()=>({name:$("#ru_name").value.trim(), metric_key:$("#ru_metric").value, operator:$("#ru_op").value,
      threshold:Number($("#ru_thr").value), window_hours:Number($("#ru_win").value), min_sample:Number($("#ru_min").value),
      severity:$("#ru_sev").value, channel:$("#ru_ch").value, team:$("#ru_team").value||null, description:$("#ru_desc").value.trim(),
      runbook:$("#ru_runbook").value.trim()||null,
      active_from:$("#ru_from").value!==""?Number($("#ru_from").value):null, active_to:$("#ru_to").value!==""?Number($("#ru_to").value):null});
    $("#ruX").onclick=()=>$("#ruleModal").classList.remove("open");
    $("#ru_test").onclick=async()=>{
      const tb=$("#ru_testbox"); tb.innerHTML="Testing…";
      try{ const r=await api("/api/rules/test",{method:"POST",body:JSON.stringify(gather())});
        const val = r.value==null?"—":(r.unit==="rate"||r.unit==="ratio")?(r.value*100).toFixed(1)+"%":r.value;
        tb.innerHTML=`Observed <b>${val}</b> (n=${r.sample}) at ${String(r.now).replace('T',' ').slice(0,16)}Z — `+
          (r.would_fire?`<span style="color:var(--red);font-weight:800">WOULD FIRE ✕</span>`:`<span style="color:#16a34a;font-weight:800">would not fire ✓</span>`)+
          (r.enoughSample?"":` <span style="color:var(--muted)">(below min sample)</span>`);
      }catch(e){ tb.innerHTML=`<span style="color:var(--red)">${esc(e.message)}</span>`; }
    };
    $("#ru_save").onclick=async()=>{
      const gg=gather(); if(!gg.name){ alert("Name required"); return; }
      try{
        if(isEdit) await api("/api/rules/"+rule.id,{method:"PATCH",body:JSON.stringify(gg)});
        else await api("/api/rules",{method:"POST",body:JSON.stringify(gg)});
        $("#ruleModal").classList.remove("open"); renderRules();
      }catch(e){ alert("Save failed: "+e.message); }
    };
  }
  document.getElementById("ruleModal").addEventListener("click",e=>{ if(e.target.id==="ruleModal") e.currentTarget.classList.remove("open"); });

  // controls
  document.addEventListener("click", async (e)=>{
    const t = e.target.closest("[data-atab]");
    if(t){ atab=t.dataset.atab; $("#alTabs").querySelectorAll(".pill").forEach(p=>p.classList.toggle("active",p===t)); load(); return; }
  });
  function bind(){
    $("#alRefresh").addEventListener("click", load);
    $("#alSyncNow").addEventListener("click", async ()=>{
      $("#alSyncNow").textContent="… syncing";
      try{ const r=await api("/api/sync",{method:"POST",body:JSON.stringify({})}); banner(`Sync done @ ${timeAgo(r.sim_now)} — ${r.written} snapshots, +${r.opened} opened / ${r.resolved} resolved.`); }
      catch(e){ banner("Sync failed: "+e.message); }
      $("#alSyncNow").textContent="▷ Sync now"; load();
    });
    $("#alSimulate").addEventListener("click", async ()=>{
      $("#alSimulate").textContent="… replaying";
      try{ const r=await api("/api/simulate",{method:"POST",body:JSON.stringify({stepHours:3,steps:56})}); banner(`Replay ${timeAgo(r.from)} → ${timeAgo(r.to)} (${r.ticks} ticks). Open alerts reflect the final virtual now.`); }
      catch(e){ banner("Simulate failed: "+e.message); }
      $("#alSimulate").textContent="⏩ Simulate replay"; load();
    });
  }

  // re-render charts/tables when theme changes (if the alerts view is visible)
  document.addEventListener("themechange", ()=>{
    const av=document.querySelector("#view-alerts");
    if(av && av.classList.contains("active")) load();
  });
  document.addEventListener("opsdatarefresh", ()=>{
    const av=document.querySelector("#view-alerts");
    if(av && av.classList.contains("active")) load();
  });

  // lazy-load when the Alerts tab is first shown
  let loaded=false;
  document.querySelectorAll(".navtab").forEach(b=>{
    if(b.dataset.view==="alerts") b.addEventListener("click", ()=>{ if(!loaded){ loaded=true; bind(); } load(); });
  });
})();
