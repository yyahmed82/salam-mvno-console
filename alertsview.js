/* Live Alerts view — talks to the console API (server/src/api.js).
 * When the page is served by the Node server, uses same-origin.
 * When opened as file://, points at http://localhost:4600 and shows a hint if unreachable. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const el = (t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = window.API_BASE;
  /* SEGMENT (8 Sep 2026): the same incident UI serves both businesses. 'mvno' at #alerts, 'fixed' at #fixed-alerts —
   * the server scopes /api/alerts, /api/alerts/summary, /api/incidents/stats and /api/rules to the segment asked. */
  let SEG = "mvno";
  const SEG_PATHS = /^\/api\/(alerts(\/summary)?|incidents\/stats|rules)(\?|$)/;
  const withSeg = path => SEG_PATHS.test(path) ? path + (path.includes("?") ? "&" : "?") + "segment=" + SEG : path;
  const hashOf = () => SEG === "fixed" ? "fixed-alerts" : "alerts";
  window.alertsSegment = () => SEG;
  let atab = (window.pf && window.pf.get('alerts_tab','open')) || "open";
  /* After a mail deep link (#alerts?id=… / ?rule=…) is handled, strip the query from the URL
   * WITHOUT firing hashchange (replaceState). Two reasons: a re-click of the SAME mail link then
   * produces a real hash change and works again (same-hash clicks fire no event at all), and a
   * later manual reload doesn't replay the jump. */
  function deepLinkDone(){
    try{ if(/[?&](id|rule)=/.test(location.hash||"")) history.replaceState(null, "", location.pathname + location.search + "#" + hashOf()); }catch(e){}
    // with the query gone, refresh cycles can't replay the jump — so the consumed markers can
    // reset, which is what lets a SECOND click on the very same mail link work
    setTimeout(()=>{ window.__alertDeepDone=""; window.__ruleDeepDone=""; window.__alertDeepTried=""; }, 0);
  }

  async function api(path, opts){
    const r = await fetch(API+withSeg(path), Object.assign({headers:{"Content-Type":"application/json"}}, opts));
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.json();
  }
  function banner(msg){ $("#alBanner").innerHTML = msg ? `<div class="albanner">${msg}</div>` : ""; }
  const sevColor = s => ({P1:"#dc2626",P2:"#d97706",P3:"#64748b",P4:"#94a3b8"}[s]||"#64748b");
  /* Business/Technical alert class — colors follow the errclass.js console-wide standard
   * (business blue / technical red). No 'Mixed': every formerly-blended rule was split or
   * reclassified (2026-08-11), so every rule is exactly one class. */
  const CLS_STYLE = { technical:{label:"Technical",fg:"#ef4444",bg:"var(--err-tec-bg)"},
                      business: {label:"Business", fg:"#3b82f6",bg:"var(--err-biz-bg)"} };
  const clsChip = c => { const s=CLS_STYLE[c]; return s?` <span style="display:inline-block;background:${s.bg};color:${s.fg};border-radius:4px;padding:0 6px;font-size:10.5px;font-weight:700">${s.label}</span>`:""; };
  let CLSFILTER = { alerts:"all", rules:"all" };            // client-side class filters per tab
  function clsBar(scope, items){
    const cnt = c => items.filter(x=>x.alert_class===c).length;
    const chips = [["all","All",items.length],["technical","Technical",cnt("technical")],["business","Business",cnt("business")]];
    return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 2px 10px"><span class="rl">Class:</span>${chips.map(([v,l,n])=>`<button class="pill clsfchip${CLSFILTER[scope]===v?" active":""}" data-clsf="${v}" data-clsscope="${scope}" style="padding:3px 10px">${l} · ${n}</button>`).join("")}</div>`;
  }
  function wireClsBar(rerender){
    $("#alBody").querySelectorAll("[data-clsf]").forEach(b=>b.addEventListener("click",()=>{ CLSFILTER[b.dataset.clsscope]=b.dataset.clsf; rerender(); }));
  }
  const fmtVal = (v,unit)=> v==null?"—" : (unit==="rate"||unit==="ratio") ? (v*100).toFixed(1)+"%" : (Number.isInteger(+v)?v:(+v).toFixed(2));
  const timeAgo = iso => { if(!iso) return "—"; const d=new Date(iso); if(isNaN(d)) return "—"; return KT.dt(iso)+" KSA"; };

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
      `<div class="stat"><b>${totalOpen}</b><span>TOTAL OPEN · ${sum.rules!=null?sum.rules:health.rules} RULES</span></div>`;
    /* MAIL DEEP LINKS must beat the REMEMBERED sub-tab. The page restores the last-used tab
     * (pf 'alerts_tab'), so a reader whose last visit ended on "Alert rules" arrived from a
     * mail link and saw... the rules list, because both handlers lived inside renderAlerts()
     * which never ran. #alerts?id=N forces the OPEN list (that is where the incident row is);
     * #alerts?rule=key opens the rule edit modal from HERE, independent of any tab. */
    const _mid=/[?&]id=(\d+)/.exec(location.hash||"");
    // an incident row exists on BOTH the Open-alerts and History tables — only leave a tab that
    // has no incident table at all. Being on History must stay on History: a resolved alert
    // only exists there.
    if(_mid && _mid[1]!==window.__alertDeepDone && atab!=="open" && atab!=="all") atab="open";
    const _mr=/[?&]rule=([\w.-]+)/.exec(location.hash||"");
    if(_mr && decodeURIComponent(_mr[1])!==window.__ruleDeepDone){
      const key=decodeURIComponent(_mr[1]); window.__ruleDeepDone=key;
      api("/api/rules").then(data=>{
        _catalog = data.catalog || _catalog;        // the edit modal needs the metric catalog
        const rule=(data.rules||[]).find(r=>r.key===key);
        if(rule) openRuleModal(rule);
        else banner(`Rule “${esc(key)}” not found — it may have been renamed or deleted.`);
        deepLinkDone();
      }).catch(()=>{});
    }
    const _tabs=$("#alTabs"); if(_tabs) _tabs.querySelectorAll(".pill").forEach(p=>p.classList.toggle("active", p.dataset.atab===atab));
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
    // NEVER Math.min(...arr) here: spread passes every point as a call argument, and a 7-day
    // range at fine buckets is tens of thousands of points → "Maximum call stack size exceeded"
    // and the whole Metric charts tab dies. Loop-based extent has no argument limit.
    const extent = (arrs)=>{ let l=Infinity, h=-Infinity;
      for(const a of arrs) for(const v of a){ if(v<l) l=v; if(v>h) h=v; }
      return [l,h]; };
    let [lo,hi] = extent([vals, thr, bandVals]);
    if(opts.unit==='rate'||opts.unit==='ratio'){ if(lo>0) lo=0; }
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

  let _mLoading = false;
  async function renderMetrics(){
    // Live refresh fires this every sync tick (~5 min). Two rules keep the tab stable:
    //  1. never stack loads — a 33-series fetch can outlive the refresh interval, and stacked
    //     runs made the tab reset to "Loading…" forever;
    //  2. never wipe rendered content — build off-screen, swap when ready. The spinner is only
    //     for the very first paint, when there is nothing to keep showing.
    if(_mLoading) return;
    _mLoading = true;
    /* No full-page spinner any more: _loadMetrics paints the grid from /api/rules first and fills
       the series in afterwards, so there is never a moment with nothing on screen. */
    if(!_mcards || !_mcards.length)
      $("#alBody").innerHTML = `<div class="sub" style="padding:6px 2px">Building metric cards…</div>`;
    try{ await _loadMetrics(); } finally { _mLoading = false; }
  }
  /* PROGRESSIVE LOAD.
   * This used to Promise.all() one series fetch per metric (~33 of them) and paint only when the
   * LAST one landed, so the tab sat on "Loading metric series…" for as long as the slowest query
   * — and any one slow series held the whole page hostage.
   * Now: the grid is built from /api/rules alone (labels, thresholds, teams, descriptions — all
   * of which are known without touching the series) and painted immediately; the sparklines then
   * fill in card by card. Fetches run 4 at a time rather than all at once, which also keeps the
   * source pool from being drained by a single tab — the failure that showed the replica as DOWN
   * earlier today. */
  const M_CONCURRENCY = 4;
  async function _loadMetrics(){
    const rulesData = await api("/api/rules");
    const catalog = rulesData.catalog || [];
    const rulesByMetric = {};
    (rulesData.rules||[]).forEach(r=>{ (rulesByMetric[r.metric_key] ||= []).push(r); });
    // pick a representative window per metric = smallest rule window (or 3)
    const windowFor = k => { const rs=rulesByMetric[k]; return rs&&rs.length ? Math.min(...rs.map(r=>Number(r.window_hours))) : 3; };

    // 1) skeleton — everything the rules already tell us, painted at once
    _mcards = catalog.map(m=>{
      const rs = rulesByMetric[m.key]||[];
      return { m, w: windowFor(m.key), pts: [], rs,
        thrObjs: rs.map(r=>({ value:Number(r.threshold), severity:r.severity, operator:r.operator })),
        latest: "…", nowBreached:false, breachSev:null,
        teams: [...new Set(rs.map(r=>r.team).filter(Boolean))], pending:true };
    });
    paintMetrics();

    // 2) fill each card in place; repaint at most ~3×/second so the page stays responsive
    let lastPaint = 0;
    const fill = async c => {
      let pts=[];
      try { pts = (await api(`/api/metrics/series?key=${encodeURIComponent(c.m.key)}&window=${c.w}`)).points || []; }
      catch(e){ c.loadError = e.message; }
      const last = [...pts].reverse().find(p=>p.value!=null);
      const lastVal = last ? Number(last.value) : null;
      const breached = last ? c.rs.filter(r=> (r.operator==='lte'||r.operator==='lt') ? lastVal<=Number(r.threshold) : lastVal>=Number(r.threshold)) : [];
      c.pts = pts;
      c.latest = last ? fmtVal(last.value, c.m.unit) : (c.loadError ? "error" : "—");
      c.nowBreached = breached.length>0;
      c.breachSev = breached.length ? breached.map(r=>r.severity).sort((a,b)=>M_RANK[a]-M_RANK[b])[0] : null;
      c.pending = false;
      if(Date.now()-lastPaint > 320){ lastPaint = Date.now(); paintMetrics(); }
    };
    const queue = _mcards.slice();
    await Promise.all(Array.from({length:Math.min(M_CONCURRENCY,queue.length)}, async ()=>{
      while(queue.length){ const c=queue.shift(); if(c) await fill(c); }
    }));
    paintMetrics();   // final, with everything settled
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
      ? `Start with the ${worst==="P1"?"red":"amber"} card${br.length>1?"s":""} at the top — each one explains what the metric means and when it alerts. Click a card for its firing history, and open the <b>${SEG==="fixed"?"Fixed › Errors":"Troubleshoot"}</b> board to find the affected ${SEG==="fixed"?"orders across SDA · QR · Web · Salam Home app":"orders"}.`
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
      /* a card whose series has not landed yet is dimmed and shows a shimmer where the sparkline
         will be — so the grid reads as "loading", never as "this metric is empty" */
      return `<div class="mcard ${stateCls}${rid?" mclickable":""}${c.pending?" mpending":""}" ${rid?`data-mrule="${rid}" title="Click for firing history"`:""} style="border-left:5px solid ${accent};${rid?"cursor:pointer":""}">
        <div class="mtop">${statusPill}${rid?`<span class="mhint">firing history ↗</span>`:""}</div>
        <div class="mh"><b>${esc(mlabel)}</b><span class="mval ${c.nowBreached?"breachdot":""}" ${c.nowBreached?`style="color:${sevColor(c.breachSev)}"`:""}>${esc(c.latest)}</span></div>
        ${cmp}
        <div class="mdesc"><span class="mdt">What this means</span>${desc}</div>
        ${ruleWords(c)}
        ${sparkline(c.pts, {unit:m.unit, thrObjs:c.thrObjs, w:560, h:130, lw:2, dotR:3.4})}
        <div class="mlegend">${rs.length?thrChips:""}<span><i style="border-color:#2563eb"></i>value</span><span><i style="border:none;border-top:none;background:#2563eb;opacity:.22;height:8px"></i>expected range</span>${rs.length?`<span><b style="color:#dc2626">●</b> threshold crossed</span>`:""}</div>
        <div class="msub">${esc(m.key)} · ${c.w}h window · ${c.pending?`<span style="color:var(--muted)">loading series…</span>`:(c.loadError?`<span style="color:#dc2626">series failed: ${esc(c.loadError)}</span>`:`${c.pts.length} pts`)}${rs.length?` · ${rs.length} rule(s)`:""}</div>
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
  let _rbMap = null, _rbPromise = null; const _trigMap = {};                 // rule key -> runbook, fetched once & reused
  function loadRunbooks(){
    if(_rbMap) return Promise.resolve(_rbMap);
    if(!_rbPromise) _rbPromise = api("/api/rules").then(d=>{
      _rbMap = {};
      (d.rules||[]).forEach(r=>{ if(r.key && r.runbook) _rbMap[r.key]=r.runbook; if(r.key && r.trigger_codes) _trigMap[r.key]=r.trigger_codes; });
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
      ${_trigMap[a.rule_key]?`<div class="rl" style="margin:2px 0 6px"><b>Triggered by:</b> <span class="mono" style="font-size:11px">${esc(_trigMap[a.rule_key])}</span></div>`:''}
      <div id="grsteps_${a.id}">${steps}</div>
      <div class="gract">
        ${canAck()?`<button class="pill" id="grnotify_${a.id}" style="border-left-color:#dc2626">⚡ Notify on-call</button><span class="grres" id="grnres_${a.id}"></span>`:''}
        <button class="pill" id="grtixbtn_${a.id}" style="border-left-color:#2563eb">🎫 Related tickets</button>
        <button class="pill" id="grts_${a.id}" style="border-left-color:var(--green)">${SEG==="fixed"?"⚠ Open Fixed › Errors":"🔧 Open in Troubleshoot"}</button>
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
        ? ch.map(c=>`<span style="color:${c.sent?'var(--good)':'#dc2626'}" title="${esc(c.error||'')}">${esc(c.name)} ${c.sent?'✓':'✗'}</span>`).join(' · ')
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
    // Fixed alerts troubleshoot on the Fixed error control board (all channels); Mobile keeps the MVNO Troubleshoot page
    const ts=$("#grts_"+id); if(ts) ts.onclick=()=>{ if(window.setConsoleHash) window.setConsoleHash(SEG==="fixed"?"fixed?tab=errors":"troubleshoot"); };
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
    const allRows = data.alerts||[];
    // client-side class filter (chips) — server always returns everything
    const rows = CLSFILTER.alerts==="all" ? allRows : allRows.filter(a=>a.alert_class===CLSFILTER.alerts);
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
      <div class="incstat"><b style="color:${(stats.unacked||0)>0?'#dc2626':'var(--good)'}">${stats.unacked??0}</b><span>UNACKED</span></div>
      <div class="incstat"><b>${dur(stats.mtta_sec)}</b><span>MTTA · 30d</span></div>
      <div class="incstat"><b>${dur(stats.mttr_sec)}</b><span>MTTR · 30d</span></div>
      <div class="incstat"><b>${stats.resolved_24h??0}</b><span>RESOLVED · 24h</span></div>
    </div>`;
    if(!rows.length){
      $("#alBody").innerHTML = strip + clsBar("alerts", allRows) + `<div class="okbox" style="margin-top:6px">No ${atab==="all"?"":"open "}alerts${CLSFILTER.alerts!=="all"?" in this class":""}. ${atab==="open"&&CLSFILTER.alerts==="all"?"All clear — or run a sync/simulate to evaluate rules against the replica.":""}</div>`;
      wireClsBar(renderAlerts); return;
    }
    let h = strip + clsBar("alerts", allRows) + `<table class="alerts"><tr><th>SEV</th><th>INCIDENT</th><th>TEAM</th><th>OBSERVED</th><th>STATUS</th><th>OWNER</th><th>FIRST → LAST</th><th>ACTIONS</th></tr>`;
    ordered.forEach(a=>{
      const snoozed = a.snoozed_until && new Date(a.snoozed_until)>new Date();
      const cr = a.correlation||null;
      const isChild = cr && cr.role==='child';
      const corrLine = !cr ? '' :
        cr.role==='child'   ? `<br><span class="rl" style="color:#7c3aed">↳ correlated under <b>${esc(cr.parentName)}</b> · not separately paged</span>` :
        cr.role==='related' ? `<br><span class="rl" style="color:#0891b2">related to ${esc(cr.parentName)}</span>` :
        cr.role==='root'    ? `<br><span class="rl" style="color:#dc2626;font-weight:700">◆ root cause${childCount[a.rule_key]?` · ${childCount[a.rule_key]} correlated`:''}</span>${cr.impacts&&cr.impacts.length?`<br><span class="rl">blocks: ${cr.impacts.map(j=>`<span style="display:inline-block;background:var(--tint-red);color:var(--tint-red-fg);border-radius:4px;padding:0 5px;margin:1px 2px 0 0;font-size:10.5px">${esc(j)}</span>`).join("")}</span>`:''}` : '';
      const snChip = a.sn_number ? `<br><button class="pill" data-snopen="${a.id}" style="padding:1px 7px;font-size:10.5px;border-left-color:${/resolved|closed/i.test(a.sn_state||'')?'var(--good)':'#d97706'}" title="ServiceNow ${esc(a.sn_number)} · ${esc(a.sn_state||'New')}">🎫 ${esc(a.sn_number)} · ${esc(a.sn_state||'New')}</button>` : '';
      const stateTag = (a.status!=='open' ? `<span class="st-resolved">resolved</span>`
        : snoozed ? `<span style="color:#7c3aed;font-weight:700">snoozed</span>`
        : a.ack_at ? `<span style="color:#0891b2;font-weight:700">acked</span>`
        : `<span class="st-open">open${a.breach_count>1?` ×${a.breach_count}`:""}</span>`) + snChip;
      const me=((window.opsSession&&window.opsSession().me)||{}).email||"";
      const acts = (a.status==='open' && canAck()) ? `
        ${a.ack_at?(a.ack_by&&a.ack_by!==me?`<button class="pill" data-reack="${a.id}" style="padding:3px 8px;border-left-color:#0891b2" title="Take the acknowledgement over from ${esc(a.ack_by)} — logged in the incident discussion and the audit trail">Re-ack</button> `:'')+`<button class="pill" data-handover="${a.id}" style="padding:3px 8px;border-left-color:#0891b2" title="Hand the acknowledgement to a colleague on this side — logged">Hand over</button>`:`<button class="pill" data-ack="${a.id}" style="padding:3px 8px">Ack</button>`}
        ${a.ack_at&&!a.sn_number?`<button class="pill" data-sn="${a.id}" style="padding:3px 8px;border-left-color:#2563eb" title="Raise this confirmed incident in ServiceNow (ServiceHub)">🎫 ServiceNow</button> `:''}${a.ack_at?`<button class="pill" data-comms="${a.id}" style="padding:3px 8px;border-left-color:#2563eb" title="Send the incident notification mail (L1 template)">✉ Comms</button> `:''}
        <button class="pill" data-snooze="${a.id}" style="padding:3px 8px">${snoozed?'Snoozed':'Snooze'}</button>
        <button class="pill" data-resolve="${a.id}" style="padding:3px 8px;border-left-color:var(--good)">Resolve</button>` : '';
      h += `<tr${isChild?' style="opacity:.62"':''}>
        <td><span class="sevpill" style="background:${sevColor(a.severity)}">${esc(a.severity)}</span></td>
        <td>${isChild?'<span style="color:var(--muted)">↳ </span>':''}<b>${esc(a.name)}</b>${clsChip(a.alert_class)}<br><span class="mono" style="color:var(--muted)">${esc(a.metric_key)} ${esc(a.operator)} ${esc(a.threshold)}</span>${corrLine}</td>
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
    body.querySelectorAll("[data-reack]").forEach(b=>b.addEventListener("click",()=>{ const a=byId[b.dataset.reack]||{}; if(confirm(`Take over the acknowledgement from ${a.ack_by||"the current holder"}? This is logged on the incident.`)) incAction(b.dataset.reack,"ack"); }));
    body.querySelectorAll("[data-handover]").forEach(b=>b.addEventListener("click",()=>handoverPanel(b, byId[b.dataset.handover])));
    SEG_ROWS=byId;
    body.querySelectorAll("[data-sn],[data-snopen]").forEach(b=>b.addEventListener("click",()=>snPanel(b.dataset.sn||b.dataset.snopen)));
    body.querySelectorAll("[data-comms]").forEach(b=>b.addEventListener("click",()=>snPanel(b.dataset.comms,"comms")));
    body.querySelectorAll("[data-snooze]").forEach(b=>b.addEventListener("click",()=>{ const hrs=prompt("Snooze for how many hours?","1"); if(hrs) incAction(b.dataset.snooze,"snooze",{hours:Number(hrs)}); }));
    body.querySelectorAll("[data-resolve]").forEach(b=>b.addEventListener("click",()=>{ if(confirm("Resolve this incident?")) incAction(b.dataset.resolve,"resolve"); }));
    body.querySelectorAll("[data-det]").forEach(b=>b.addEventListener("click",()=>toggleDetail(b.dataset.det)));
    body.querySelectorAll("[data-guide]").forEach(b=>b.addEventListener("click",()=>toggleGuide(b.dataset.guide, byId[b.dataset.guide])));
    wireClsBar(renderAlerts);
    /* Deep link from the alert MAIL — read ONCE per page load, then cleared, so the periodic
     * refresh doesn't keep yanking the reader back:
     *   #alerts?id=<alert id>  (fired rows)  → scroll to the incident, open its GUIDE (the
     *     step-by-step runbook walker) plus the detail row — "open and start acting"
     *   #alerts?rule=<key>     (ok rows)     → open that rule's edit popup, where the
     *     thresholds, trigger codes and runbook live */
    const _dm=/[?&]id=(\d+)/.exec(location.hash||"");
    if(_dm && _dm[1]!==window.__alertDeepDone){
      const id=_dm[1];
      const btn=body.querySelector(`[data-det="${id}"]`);
      if(btn){
        window.__alertDeepDone=id; window.__alertDeepTried="";
        toggleDetail(id);
        const g=body.querySelector(`[data-guide="${id}"]`);
        if(g) toggleGuide(id, byId[id]);          // open alerts get the guided runbook directly
        const tr=btn.closest("tr");
        tr.scrollIntoView({behavior:"smooth",block:"center"});
        tr.style.outline="2px solid #0e9f5a"; tr.style.outlineOffset="-2px";
        setTimeout(()=>{ tr.style.outline=""; }, 6000);
        deepLinkDone();
      } else if(atab==="open" && window.__alertDeepTried!==id){
        /* not in the OPEN list — it resolved since the mail was sent. It still exists on the
         * History table, so switch there ONCE and re-render; the id stays unconsumed so this
         * handler runs again against the full list. */
        window.__alertDeepTried=id; atab="all";
        if(window.pf) window.pf.set('alerts_tab', atab);
        load();
      } else {
        window.__alertDeepDone=id; window.__alertDeepTried="";
        banner(`Alert #${esc(id)} is not in the open list or the recent history — it may be older than the current range.`);
        deepLinkDone();
      }
    }
  }
  /* hand-over picker: colleagues who may hold an ack on THIS side (/api/alerts/holders?segment=), inline in the row */
  let _holders=null, _holdersSeg=null;
  async function holders(){ if(_holders && _holdersSeg===SEG) return _holders; const d=await api("/api/alerts/holders?segment="+SEG); _holders=d.holders||[]; _holdersSeg=SEG; return _holders; }
  async function handoverPanel(btn, a){
    const cell=btn.parentElement; if(!cell||cell.querySelector(".hoPanel")) return;
    let list=[]; try{ list=await holders(); }catch(e){ banner(`Could not load colleagues: ${esc(e.message)}`); return; }
    const me=((window.opsSession&&window.opsSession().me)||{}).email||"";
    const opts=list.filter(u=>u.email!==(a.ack_by||"")).map(u=>`<option value="${esc(u.email)}"${u.email===me?" selected":""}>${esc(u.name)} · ${esc(u.email)}</option>`).join("");
    const p=el("div","hoPanel"); p.style.cssText="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px";
    p.innerHTML=`<span class="rl" style="color:var(--muted)">hand ack ${a.ack_by?`from <b>${esc(a.ack_by.split("@")[0])}</b>`:""} to</span>
      <select class="fe-in" style="font:inherit;font-size:12px;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:var(--ink);max-width:260px">${opts||'<option value="">no eligible colleague</option>'}</select>
      <input placeholder="note (optional)" maxlength="300" style="font:inherit;font-size:12px;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:var(--ink);width:180px">
      <button class="pill" style="padding:3px 8px;border-left-color:var(--green,#0e9f5a)">Confirm</button><button class="pill" style="padding:3px 8px">Cancel</button>`;
    cell.appendChild(p);
    const [ok,cancel]=p.querySelectorAll("button"); const sel=p.querySelector("select"), note=p.querySelector("input");
    cancel.onclick=()=>p.remove();
    ok.onclick=()=>{ const to=sel.value; if(!to) return; incAction(a.id,"ack",{to, note:note.value.trim()}); };
    sel.focus();
  }
  let SEG_ROWS={};
  /* ---- ServiceNow ticket + incident comms (Phase 1: manual, after ack) ------------------------------
   * The panel lives in the incident's detail row (#incdet_<id>): draft → Raise in ServiceNow → INC card with
   * work notes, state refresh, comms history → Send incident comms (the L1 "Critical Incident Notification"). */
  const inp=(id,v,ph,extra)=>`<input id="${id}" value="${esc(v==null?"":v)}" placeholder="${esc(ph||"")}" ${extra||""}>`;
  const ta=(id,v,rows,ph)=>`<textarea id="${id}" rows="${rows||3}" placeholder="${esc(ph||"")}">${esc(v==null?"":v)}</textarea>`;
  const IMP={"1":"1 — High","2":"2 — Medium","3":"3 — Low"};
  const selImp=(id,v)=>`<select id="${id}">${["1","2","3"].map(x=>`<option value="${x}"${String(v)===x?" selected":""}>${IMP[x]}</option>`).join("")}</select>`;
  const snStateColor=s=>/resolved|closed/i.test(s||"")?"var(--good)":/progress|hold/i.test(s||"")?"#0891b2":"#d97706";
  async function snPanel(id, mode){
    const row=$("#incdet_"+id); if(!row) return;
    row.removeAttribute("hidden");
    const cell=row.querySelector("td"); cell.innerHTML=`<div class="sub">Loading ServiceNow…</div>`;
    let d; try{ d=await api(`/api/alerts/${id}/servicenow`); }catch(e){ cell.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const a=(SEG_ROWS[id])||{};
    const status=`<div class="rl" style="margin-bottom:8px">${d.configured?`ServiceNow connected · ${d.writeEnabled?'<b style="color:var(--good)">ticket creation ON</b>':'<b style="color:#d97706">dry run</b> — writes are off in Settings → Notifications → ServiceNow'}`:'<b style="color:#d97706">ServiceNow credentials not set on 152</b> — the console shows the draft; nothing is sent'}${d.poller&&d.poller.lastSync?` · state synced ${timeAgo(d.poller.lastSync)}`:''}</div>`;
    const commsHist=(d.comms||[]).length?`<h5 style="margin:12px 0 4px">COMMS SENT</h5>`+(d.comms||[]).map(c=>`<div class="rl" style="margin:2px 0">${c.ok?'✅':'✗'} <b>${esc(c.kind)}</b> · ${esc(c.subject||'')} · ${c.n||0} recipient(s) · ${esc((c.sent_by||'').split('@')[0])} · ${timeAgo(c.sent_at)}${c.error?` · <span style="color:#dc2626">${esc(c.error)}</span>`:''}</div>`).join(""):"";
    let h;
    if(d.linked){
      const L=d.linked;
      h=`<div style="padding:10px 6px">${status}
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:10px 12px;border:1px solid var(--line);border-left:4px solid ${snStateColor(L.state)};border-radius:10px;background:var(--card,#fff)">
          <a href="${esc(L.link||'#')}" target="_blank" rel="noopener" class="mono" style="font-size:15px;font-weight:800;color:var(--green)">${esc(L.number)} ↗</a>
          <span class="rl">state <b style="color:${snStateColor(L.state)}">${esc(L.state||'New')}</b></span>
          <span class="rl">raised by ${esc((L.created_by||'').split('@')[0])} · ${timeAgo(L.created_at)}</span>
          ${L.synced_at?`<span class="rl">synced ${timeAgo(L.synced_at)}</span>`:''}
          <button class="pill" id="snRefresh_${id}" style="padding:3px 8px;border-left-color:#0891b2">↻ Refresh state</button>
          ${d.allowed?`<button class="pill" id="snComms_${id}" style="padding:3px 8px;border-left-color:var(--green)">✉ Send incident comms</button>`:''}
        </div>
        ${d.allowed?`<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px">
          <select id="snNoteKind_${id}" class="fe-in" style="font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:var(--ink)"><option value="work_notes">Work note (internal)</option><option value="comments">Comment (customer-visible)</option></select>
          <input id="snNote_${id}" class="jsearch" placeholder="Follow-up to post on ${esc(L.number)}…" style="flex:1;min-width:200px">
          <button class="pill" id="snNoteSend_${id}" style="padding:3px 10px;border-left-color:var(--green)">Post to ServiceNow</button></div>`:''}
        ${commsHist}
        <div id="snComsHost_${id}"></div>
        <div id="snMsg_${id}" class="rl" style="margin-top:6px"></div></div>`;
    } else {
      const f=d.draft||{};
      const gate=!d.acked?`<div class="albanner">Acknowledge the incident first — only a confirmed incident is raised in ServiceNow.</div>`:!d.allowed?`<div class="albanner">Only the ack holder (${esc(a.ack_by||'—')}), an ACK · ${SEG==="fixed"?"FIXED":"MOBILE"} holder or an ops admin can raise this.</div>`:"";
      h=`<div style="padding:10px 6px">${status}${gate}
        <h5 style="margin:0 0 6px">RAISE IN SERVICENOW · ${esc(f.business||'')} <span class="rl">(review, then confirm — one INC per incident)</span></h5>
        <div class="snf">
          <label>Short description</label>${inp("snSd_"+id,f.short_description,"",'maxlength="160"')}
          <label>Description</label>${ta("snDesc_"+id,f.description,9)}
          <label>Impact</label>${selImp("snImp_"+id,f.impact)}
          <label>Urgency</label>${selImp("snUrg_"+id,f.urgency)}
          <label>Assignment group</label>${inp("snGrp_"+id,f.assignment_group,"e.g. MVNO-MS-App-Digital-Chnls (display name)")}
          <label>Category</label>${inp("snCat_"+id,f.category,"optional — instance value")}
          <label>Subcategory</label>${inp("snSub_"+id,f.subcategory,"optional")}
          <label>Caller</label><div class="rl" style="padding-top:7px">${f.caller_email?esc(f.caller_email)+' (looked up by e-mail; falls back to the service account)':'service account'} · correlation <span class="mono">${esc(f.correlation_id||'')}</span></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <button class="pill" id="snRaise_${id}" style="border-left-color:var(--green)" ${(d.acked&&d.allowed)?'':'disabled'}>${d.writeEnabled&&d.configured?'🎫 Raise in ServiceNow':'🎫 Dry run — show what would be created'}</button>
          <button class="pill" id="snClose_${id}">Close</button>
          <span id="snMsg_${id}" class="rl"></span></div>
        <pre id="snPayload_${id}" class="nc-pre" style="display:none;margin-top:8px;max-height:260px;overflow:auto"></pre>
        ${commsHist}</div>`;
    }
    cell.innerHTML=h;
    const msg=$("#snMsg_"+id);
    const on=(sel,fn)=>{ const b=$(sel); if(b) b.onclick=fn; };
    on("#snClose_"+id,()=>row.setAttribute("hidden",""));
    on("#snRaise_"+id,async()=>{
      const b=$("#snRaise_"+id); b.disabled=true; msg.textContent="Sending…";
      try{ const r=await api(`/api/alerts/${id}/servicenow`,{method:"POST",body:JSON.stringify({short_description:$("#snSd_"+id).value.trim(),description:$("#snDesc_"+id).value,impact:$("#snImp_"+id).value,urgency:$("#snUrg_"+id).value,assignment_group:$("#snGrp_"+id).value.trim(),category:$("#snCat_"+id).value.trim(),subcategory:$("#snSub_"+id).value.trim()})});
        if(r.dryRun){ msg.innerHTML=`<b style="color:#d97706">Not sent</b> — ${esc(r.reason)}. This is the exact payload that would be POSTed to /api/now/table/incident:`; const p=$("#snPayload_"+id); p.style.display="block"; p.textContent=JSON.stringify(r.payload,null,2); b.disabled=false; return; }
        msg.innerHTML=`<b style="color:var(--good)">${esc(r.number)} ${r.reused?'linked':'created'}</b>`; setTimeout(()=>{ renderAlerts(); snPanel(id); },400);
      }catch(e){ msg.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; b.disabled=false; }
    });
    on("#snRefresh_"+id,async()=>{ msg.textContent="Refreshing…"; try{ const r=await api(`/api/alerts/${id}/servicenow/sync`,{method:"POST",body:"{}"}); msg.textContent=r.error?`Sync error: ${r.error}`:`Checked ${r.checked||0} linked ticket(s), ${r.changed||0} changed`; renderAlerts(); snPanel(id); }catch(e){ msg.textContent=e.message; } });
    on("#snNoteSend_"+id,async()=>{ const t=$("#snNote_"+id).value.trim(); if(!t) return; msg.textContent="Posting…";
      try{ const r=await api(`/api/alerts/${id}/servicenow/note`,{method:"POST",body:JSON.stringify({text:t,kind:$("#snNoteKind_"+id).value})}); msg.innerHTML=r.dryRun?`<b style="color:#d97706">Dry run</b> — would post ${esc(r.field)}: ${esc(r.body)}`:`<b style="color:var(--good)">Posted</b> as ${esc(r.field)}`; $("#snNote_"+id).value=""; }
      catch(e){ msg.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; } });
    on("#snComms_"+id,()=>commsPanel(id,$("#snComsHost_"+id)));
    if(mode==="comms"){ const host=$("#snComsHost_"+id); if(host) commsPanel(id,host); }
  }
  async function commsPanel(id, host){
    if(!host||host.dataset.open) return; host.dataset.open="1";
    host.innerHTML=`<div class="sub">Preparing the comms mail…</div>`;
    let d; try{ d=await api(`/api/alerts/${id}/comms/draft`); }catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; delete host.dataset.open; return; }
    const kinds=[["initial","Initial notification"],["update","Status update"],["resolved","Resolved"]];
    host.innerHTML=`<h5 style="margin:12px 0 6px">INCIDENT COMMS MAIL · ${esc(d.business)} <span class="rl">(same template as the L1 notification — review, then send · Bcc, lists never exposed)</span></h5>
      ${d.previous?`<div class="rl" style="margin-bottom:6px">Last sent: <b>${esc(d.previous.kind)}</b> by ${esc((d.previous.sent_by||'').split('@')[0])} ${timeAgo(d.previous.sent_at)}</div>`:''}
      <div class="snf">
        <label>Mail type</label><select id="cmKind_${id}">${kinds.map(([k,l])=>`<option value="${k}"${d.kind===k?" selected":""}>${l}</option>`).join("")}</select>
        <label>Subject title</label>${inp("cmTitle_"+id,d.title,"e.g. Bill Run SADAD Loading Slowness")}
        <label>Priority · ticket · reported</label><div class="rl" style="padding-top:7px"><b>${esc(d.priority)}</b> · ${d.ticket?`<span class="mono">${esc(d.ticket)}</span>`:'<span style="color:#d97706">no ServiceNow ticket yet</span>'} · ${esc(d.reported)}</div>
        <label>Issue description</label>${inp("cmDesc_"+id,d.description,"")}
        <label>Business / service impact</label><select id="cmImp_${id}"><option${d.impact==="Yes"?" selected":""}>Yes</option><option${d.impact==="No"?" selected":""}>No</option><option${d.impact==="Partial"?" selected":""}>Partial</option></select>
        <label>Impacted service / application</label>${inp("cmSvc_"+id,d.impacted_service,"")}
        <label>Status update</label>${ta("cmStatus_"+id,d.status,3,"what is happening now")}
        <label>Bridge link</label>${inp("cmBridge_"+id,d.bridge,"https://teams.microsoft.com/l/meetup-join/… (optional)")}
        <label>Recipients</label>${ta("cmTo_"+id,(d.recipients||[]).join(", "),2,"comma-separated — prefilled from Settings → Notifications → Incident comms ("+esc(d.business)+" "+esc(d.priority)+" list)")}
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
        <button class="pill" id="cmPrev_${id}" style="border-left-color:#2563eb">👁 Preview</button>
        <button class="pill" id="cmSend_${id}" style="border-left-color:var(--green)">✉ Send to ${(d.recipients||[]).length} recipient(s)</button>
        <button class="pill" id="cmCancel_${id}">Cancel</button>
        <span id="cmMsg_${id}" class="rl"></span></div>
      <iframe id="cmFrame_${id}" style="display:none;width:100%;height:520px;border:1px solid var(--line);border-radius:10px;background:#fff;margin-top:8px"></iframe>`;
    const form=()=>({kind:$("#cmKind_"+id).value,title:$("#cmTitle_"+id).value.trim(),description:$("#cmDesc_"+id).value.trim(),impact:$("#cmImp_"+id).value,impacted_service:$("#cmSvc_"+id).value.trim(),status:$("#cmStatus_"+id).value.trim(),bridge:$("#cmBridge_"+id).value.trim(),recipients:$("#cmTo_"+id).value});
    const msg=$("#cmMsg_"+id);
    $("#cmTo_"+id).addEventListener("input",()=>{ const n=$("#cmTo_"+id).value.split(/[,;\s]+/).filter(x=>/@/.test(x)).length; $("#cmSend_"+id).textContent=`✉ Send to ${n} recipient(s)`; });
    $("#cmCancel_"+id).onclick=()=>{ host.innerHTML=""; delete host.dataset.open; };
    $("#cmPrev_"+id).onclick=async()=>{ msg.textContent="Rendering…"; try{ const r=await window.fetch(API+`/api/alerts/${id}/comms/preview`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form())}); const html=await r.text(); const fr=$("#cmFrame_"+id); fr.style.display="block"; fr.srcdoc=html; msg.textContent=""; }catch(e){ msg.textContent=e.message; } };
    $("#cmSend_"+id).onclick=async()=>{ const f=form(); if(!confirm(`Send the ${f.kind} comms mail "${d.priority}-${f.title}" now?`)) return; const b=$("#cmSend_"+id); b.disabled=true; msg.textContent="Sending…";
      try{ const r=await api(`/api/alerts/${id}/comms`,{method:"POST",body:JSON.stringify(f)}); msg.innerHTML=r.ok?`<b style="color:var(--good)">Sent</b> "${esc(r.subject)}" to ${r.recipients} recipient(s)`:`<b style="color:#d97706">Not sent</b> — ${esc(r.error||(r.dev?'no SMTP (dev)':''))}`; setTimeout(()=>snPanel(id),800); }
      catch(e){ msg.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; b.disabled=false; } };
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
    const comments=(d.comments||[]).map(c=>c.author==='system'
      ? `<div style="margin:4px 0;padding:4px 8px;border-left:3px solid #0891b2;background:rgba(8,145,178,.08);border-radius:6px"><span class="rl" style="color:#0891b2;font-weight:700">ownership</span> <span class="rl">${timeAgo(c.created_at)}</span><br>${esc(c.body)}</div>`
      : `<div style="margin:4px 0"><b>${esc((c.author||'').split("@")[0]||'—')}</b> <span class="rl">${timeAgo(c.created_at)}</span><br>${esc(c.body)}</div>`).join("")||`<div class="rl">No comments yet.</div>`;
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
  async function renderErrClass(){
    const host=$("#ecSection"); if(!host) return;
    let d; try{ d=await api("/api/errclass"); }catch(e){ host.innerHTML=`<div class="rl">${esc(e.message)}</div>`; return; }
    const ov=d.overrides||{};
    const chip=(c,removable,side)=>`<span class="mono" style="background:${side==='tech'?'var(--err-tec-bg)':'var(--err-biz-bg)'};color:${side==='tech'?'var(--bad-fg)':'var(--blue)'};border-radius:6px;padding:1px 8px;margin:2px;display:inline-block">${esc(c)}${removable?` <a href="#" data-ecdel="${esc(c)}" data-ecside="${side}" style="text-decoration:none;color:inherit;font-weight:800">×</a>`:''}</span>`;
    host.innerHTML=`<div class="apanel"><div class="ah"><b>Business / Technical code classification</b>
        <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· TKT-000017 — reclassify codes without a deploy · applies to NEW events from save (history keeps its ingest class) · audited</span></div>
      <div class="abody" style="font-size:12.5px">
        <div style="margin-bottom:6px"><b style="color:var(--bad-fg)">TECHNICAL codes</b> <span class="rl">(built-in: ${d.builtin_tech.map(c=>chip(c,(ov.tech_remove||[]).includes(c)?false:true,'techrm')).join('')})</span><br>
          <span class="rl">added:</span> ${(ov.tech_add||[]).map(c=>chip(c,true,'tech')).join('')||'<span class="rl">—</span>'}
          ${(ov.tech_remove||[]).length?`<br><span class="rl">demoted to heuristic:</span> ${(ov.tech_remove||[]).map(c=>chip(c,true,'techundo')).join('')}`:''}
        </div>
        <div style="margin-bottom:8px"><b style="color:var(--blue)">BUSINESS codes</b> <span class="rl">(built-in: ${d.builtin_biz.map(c=>chip(c,false,'biz')).join('')})</span><br>
          <span class="rl">added (these OVERRIDE technical — the TKT-17 fix):</span> ${(ov.biz_add||[]).map(c=>chip(c,true,'biz')).join('')||'<span class="rl">—</span>'}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="ecCode" placeholder="code e.g. 706 or -501" style="width:130px">
          <button class="pill" id="ecAddBiz" style="border-left-color:var(--blue)">→ mark BUSINESS</button>
          <button class="pill" id="ecAddTech" style="border-left-color:var(--bad-fg)">→ mark TECHNICAL</button>
          <span id="ecStatus" class="rl"></span>
        </div>
        <div class="rl" style="margin-top:6px;color:var(--muted)">Scope: the API/replica classifier (Troubleshoot feed &amp; tiles, dashboard error KPIs, traffic ingest, alert metrics built on err_class). DMS journey codes have their own success set. To silence a specific rule instead, edit that rule.</div>
      </div></div>`;
    const save=async(ovNew)=>{ const st=$("#ecStatus"); if(st) st.textContent="Saving…";
      try{ await api("/api/errclass",{method:"PUT",body:JSON.stringify({overrides:ovNew})}); if(st) st.textContent="Saved ✓ — applies to new events now"; renderErrClass(); }
      catch(e){ if(st) st.textContent="Error: "+e.message; } };
    const cur=()=>({ tech_add:[...(ov.tech_add||[])], biz_add:[...(ov.biz_add||[])], tech_remove:[...(ov.tech_remove||[])], biz_remove:[...(ov.biz_remove||[])] });
    $("#ecAddBiz").onclick=()=>{ const c=$("#ecCode").value.trim(); if(!c) return; const o=cur(); if(!o.biz_add.includes(c)) o.biz_add.push(c); o.tech_add=o.tech_add.filter(x=>x!==c); save(o); };
    $("#ecAddTech").onclick=()=>{ const c=$("#ecCode").value.trim(); if(!c) return; const o=cur(); if(!o.tech_add.includes(c)) o.tech_add.push(c); o.biz_add=o.biz_add.filter(x=>x!==c); save(o); };
    host.querySelectorAll("[data-ecdel]").forEach(a=>a.addEventListener("click",e=>{ e.preventDefault();
      const c=a.getAttribute("data-ecdel"), side=a.getAttribute("data-ecside"), o=cur();
      if(side==='tech') o.tech_add=o.tech_add.filter(x=>x!==c);
      else if(side==='biz') o.biz_add=o.biz_add.filter(x=>x!==c);
      else if(side==='techrm'){ if(!o.tech_remove.includes(c)) o.tech_remove.push(c); }
      else if(side==='techundo') o.tech_remove=o.tech_remove.filter(x=>x!==c);
      save(o); }));
  }
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
    h += clsBar("rules", rules);
    const list = CLSFILTER.rules==="all" ? rules : rules.filter(r=>r.alert_class===CLSFILTER.rules);
    h += `<table class="alerts"><tr><th>ON</th><th>SEV</th><th>RULE</th><th>TEAM</th><th>METRIC</th><th>TRIGGER CODES</th><th>CONDITION</th><th>WINDOW</th><th>ACTIVE (KSA)</th><th></th></tr>`;
    list.forEach(r=>{
      const cond = `${r.operator} ${r.unit==='rate'||r.unit==='ratio' ? (r.threshold*100)+'%' : r.threshold}` + (r.min_sample?` · n≥${r.min_sample}`:"") + (r.channel&&r.channel!=='any'?` · ${r.channel}`:"") + (r.dim&&Object.keys(r.dim).length?` · ${Object.entries(r.dim).map(([k,v])=>k+'='+v).join(',')}`:"");
      const active = (r.active_from!=null&&r.active_to!=null) ? `${r.active_from}:00–${r.active_to}:00` : "always";
      h += `<tr class="rule-row">
        <td><label class="switch"><input type="checkbox" data-rid="${r.id}" ${r.enabled?"checked":""} ${canEdit?'':'disabled'}><span class="slider"></span></label></td>
        <td><span class="sevpill" style="background:${sevColor(r.severity)}">${esc(r.severity)}</span></td>
        <td><b>${esc(r.name)}</b>${clsChip(r.alert_class)}${r.builtin?' <span class="rl" style="font-size:10px">builtin</span>':''}<br><span style="color:var(--muted);font-size:11px">${esc(r.description||"")}</span></td>
        <td>${esc(r.team||"—")}</td>
        <td class="mono">${esc(r.metric_key)}</td>
        <td class="mono" style="font-size:10.5px;max-width:210px;white-space:normal">${r.trigger_codes?esc(r.trigger_codes):'<span class="rl">—</span>'}</td>
        <td class="mono">${esc(cond)}</td>
        <td>${esc(r.window_hours)}h</td>
        <td class="mono">${esc(active)}</td>
        <td style="white-space:nowrap"><button class="pill" data-hist="${r.id}" style="padding:3px 9px">History</button>${canEdit?` <button class="pill" data-edit="${r.id}" style="padding:3px 9px">Edit</button>`:''}</td>
      </tr>`;
    });
    h += `</table>`;
    if(!list.length) h += `<div class="okbox" style="margin-top:6px">No rules in this class.</div>`;
    /* TKT-000017 — Business/Technical CODE CLASSIFICATION, editable without a deploy. This is the
     * classifier every feed/tile/alert metric uses; a code moved to Business stops counting as
     * technical from save time (history keeps its ingest-time class). */
    if(canEdit) h += `<div id="ecSection" style="margin-top:24px"></div>`;
    // anomaly-engine signals (seasonal baseline) — individually configurable, appended below the threshold rules
    if(canEdit) h += `<div id="anomSection" style="margin-top:24px">${window.salamLoader?window.salamLoader("Loading anomaly signals…"):"Loading anomaly signals…"}</div>`;
    $("#alBody").innerHTML = h;
    if(canEdit) renderErrClass();
    wireClsBar(renderRules);
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
    if(canEdit) renderAnomalySignals();
  }

  /* ---- anomaly-engine signals: enable/disable + tune sensitivity/lookback per signal ---- */
  async function renderAnomalySignals(){
    const wrap = $("#anomSection"); if(!wrap) return;
    let d; try{ d = await api("/api/anomaly/rules"); }
    catch(e){ wrap.innerHTML = `<div class="albanner">Could not load anomaly signals: ${esc(e.message)}</div>`; return; }
    const g = d.global||{}, sigs = d.signals||[];
    const gnum = (id,val,step,min)=>`<input id="${id}" type="number" step="${step||'any'}" ${min!=null?`min="${min}"`:''} value="${esc(val)}" style="width:74px">`;
    const gchk = (id,on)=>`<label class="switch"><input id="${id}" type="checkbox" ${on?'checked':''}><span class="slider"></span></label>`;
    let h = `<h3 style="margin:0 0 2px">Anomaly detection · seasonal baseline</h3>
      <div class="rl" style="margin-bottom:10px">These are not threshold rules — each signal is scored against its own hour-of-week norm (robust z-score). Tune sensitivity (σ), lookback and on/off per signal, or set the engine-wide defaults below. Changes apply on the next sync — no deploy needed.</div>
      <div class="anom-global" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;background:var(--card,#0f172a11);border:1px solid #8883;border-radius:8px;padding:10px 12px;margin-bottom:12px">
        <div><label class="rl">Engine on</label><br>${gchk('an_enabled',g.enabled)}</div>
        <div><label class="rl">Raise incidents</label><br>${gchk('an_raise',g.raiseAlerts)}</div>
        <div><label class="rl">Gateway drops</label><br>${gchk('an_gw',g.gatewayAlerts!==false)}</div>
        <div><label class="rl">Sensitivity (σ)</label><br>${gnum('an_z',g.z,'0.1',1.5)}</div>
        <div><label class="rl">Lookback (weeks)</label><br>${gnum('an_lb',g.lookbackWeeks,'1',1)}</div>
        <div><label class="rl">Min sample</label><br>${gnum('an_min',g.minSample,'1',0)}</div>
        <div><label class="rl">Volume floor</label><br>${gnum('an_vf',g.volFloor,'1',0)}</div>
        <button class="pill" id="an_save" style="border-left-color:var(--green)">Save defaults</button>
      </div>`;
    h += `<table class="alerts"><tr><th>ON</th><th>SIGNAL</th><th>TYPE</th><th>SENSITIVITY</th><th>LOOKBACK</th><th>MIN n</th><th>VOL FLOOR</th><th>SEV CAP</th><th>SOURCE</th><th></th></tr>`;
    sigs.forEach(s=>{
      const e = s.eff||{}, ov = s.override||null;
      const isVol = s.kind==='volume';
      h += `<tr class="rule-row">
        <td><label class="switch"><input type="checkbox" data-anon="${esc(s.sig)}" ${e.enabled?'checked':''}><span class="slider"></span></label></td>
        <td><b class="mono">${esc(s.sig)}</b><br><span style="color:var(--muted);font-size:11px">${esc(s.label||'')}</span></td>
        <td><span class="rl">${esc(s.type)}</span></td>
        <td class="mono">≥ ${esc(e.z)}σ</td>
        <td class="mono">${esc(e.lookbackWeeks)}w</td>
        <td class="mono">${esc(e.minSample)}</td>
        <td class="mono">${isVol?esc(e.volFloor):'—'}</td>
        <td class="mono">${e.maxSeverity?esc(e.maxSeverity):'—'}</td>
        <td>${ov?'<span class="clschip" style="background:#f59e0b22;color:var(--warn-fg)">custom</span>':'<span class="rl">global</span>'}</td>
        <td style="white-space:nowrap"><button class="pill" data-anedit="${esc(s.sig)}" style="padding:3px 9px">Edit</button></td>
      </tr>`;
    });
    h += `</table>`;
    wrap.innerHTML = h;
    // global defaults save
    $("#an_save").onclick = async ()=>{
      const body = { enabled:$("#an_enabled").checked, raiseAlerts:$("#an_raise").checked, gatewayAlerts:$("#an_gw").checked,
        z:Number($("#an_z").value), lookbackWeeks:Number($("#an_lb").value), minSample:Number($("#an_min").value), volFloor:Number($("#an_vf").value) };
      $("#an_save").textContent="Saving…";
      try{ await api("/api/anomaly/config",{method:"PUT",body:JSON.stringify(body)}); renderAnomalySignals(); }
      catch(e){ banner("Save failed: "+e.message); $("#an_save").textContent="Save defaults"; }
    };
    // per-signal on/off
    wrap.querySelectorAll("input[data-anon]").forEach(cb=>cb.addEventListener("change", async ()=>{
      try{ await api("/api/anomaly/rules/"+encodeURIComponent(cb.dataset.anon),{method:"PATCH",body:JSON.stringify({enabled:cb.checked})}); renderAnomalySignals(); }
      catch(e){ banner("Failed to update signal: "+e.message); cb.checked=!cb.checked; }
    }));
    const byS = sig => sigs.find(x=>x.sig===sig);
    wrap.querySelectorAll("[data-anedit]").forEach(b=>b.addEventListener("click",()=>openAnomalyModal(byS(b.dataset.anedit), g)));
  }

  // plain-language description of what a given anomaly signal watches + why a deviation matters
  function sigExplain(s){
    const J = {
      payment:"payment attempts", activation:"BSS activations", semati:"Semati / MSISDN provisioning calls",
      nafath:"Nafath identity verifications", eligibility:"eligibility checks (Semati / Nafath gov)",
      delivery:"SIM delivery requests", change_plan:"plan-change operations", onboarding:"onboarding orders",
      checkout:"checkouts" };
    const subject = J[s.journey] || (s.journey ? s.journey.replace(/_/g,' ') : "this journey");
    if(s.kind==='gateway_drop') return `Watches each ${s.journey==='delivery'?'courier':'payment gateway'}'s own volume vs its hour-of-week norm. A drop means that provider is down or traffic is failing over to another — caught even when the overall total still looks healthy.`;
    if(s.kind==='failure_rate') return `Watches the fail ÷ (ok+fail) ratio for ${subject} against its own hour-of-week norm. A spike means this step is breaking more than usual for the time of day.`;
    return `Watches total volume of ${subject} against its hour-of-week norm. A sharp DROP usually means an upstream outage; a SPIKE can mean a retry storm.`;
  }

  function openAnomalyModal(s, g){
    const card=$("#ruleModalCard");
    const e = s.eff||{}, ov = s.override||{}, isVol = s.kind==='volume';
    const has = k => ov && (k in ov);
    // each field shows the effective value; leaving it as the global default clears the override
    const row = (id,label,val,step,min,note)=>`<div><label>${label}</label><input id="${id}" type="number" step="${step||'any'}" ${min!=null?`min="${min}"`:''} value="${esc(val)}">${note?`<div class="rl" style="margin-top:3px;line-height:1.5">${note}</div>`:''}</div>`;
    const sevOpts = ['','P1','P2','P3','P4'].map(x=>`<option value="${x}" ${ov.maxSeverity===x?'selected':''}>${x||'— none —'}</option>`).join("");
    const gEcho = v => `<span style="color:var(--muted)">global <b>${esc(v)}</b></span>`;
    card.innerHTML=`<div class="modal-head"><span class="path">Tune anomaly signal · ${esc(s.sig)}</span><span class="x" id="ruX">×</span></div>
      <div class="modal-body">
        <div style="background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:9px 11px;margin-bottom:10px">
          <div style="font-weight:700;font-size:12px;margin-bottom:2px">${esc(s.label||s.sig)}</div>
          <div class="rl" style="line-height:1.55">${sigExplain(s)}</div>
        </div>
        <details style="margin-bottom:10px">
          <summary style="cursor:pointer;font-size:11px;font-weight:700;color:var(--muted)">How seasonal anomaly detection works</summary>
          <div class="rl" style="line-height:1.6;margin-top:6px">For each signal the engine learns a <b>168-bucket hour-of-week baseline</b> (one value per hour of the week, KSA) from the last few weeks, using the <b>median + MAD</b> so a few bad hours don't skew it. The current hour is scored with a robust z-score — how many σ it sits from that hour's norm. When |σ| crosses <b>Sensitivity</b>, an incident opens and flows through the normal ack / assign / on-call path. Severity auto-scales with the deviation (bigger = higher). This is not a fixed threshold — it adapts to the day/night and weekday/weekend pattern.</div>
        </details>
        <div class="rl" style="margin-bottom:10px">Each box is pre-filled with the <b>effective</b> value. Leave it to <b>inherit the global default</b>; type a value to <b>override just this signal</b> (the row is then marked <i>custom</i>). Changes take effect on the next sync — no deploy.</div>
        <div class="fgrid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          ${row('an_ez','SENSITIVITY (σ)',e.z,'0.1',1.5,`Trip threshold: fires when this hour is ≥ this many σ from the norm. <b>Higher = less sensitive</b> (only bigger deviations page); lower catches smaller ones. ${gEcho(g.z)}`)}
          ${row('an_elb','LOOKBACK (weeks)',e.lookbackWeeks,'1',1,`Weeks of history that build the baseline. More = smoother &amp; slower to adapt; fewer = reacts faster to recent shifts. ${gEcho(g.lookbackWeeks)}`)}
          ${row('an_emin','MIN SAMPLE',e.minSample,'1',0,`Minimum events in the hour before it scores at all — guards against false alarms on tiny samples. ${gEcho(g.minSample)}`)}
          ${isVol?row('an_evf','VOLUME FLOOR (quiet-hours guard)',e.volFloor,'1',0,`If the hour's seasonal norm is below this many events/hr, a deviation is capped to <b>P3</b> (no page) — silences normal night-time lulls. ${gEcho(g.volFloor)}`):''}
          <div><label>SEVERITY CAP (optional)</label><select id="an_esev">${sevOpts}</select><div class="rl" style="margin-top:3px;line-height:1.5">Severity auto-scales with σ (bigger deviation → P1). Set a ceiling so this signal <b>never pages more severe</b> than the chosen level. Leave <i>none</i> to let it scale.</div></div>
        </div>
        <div class="modal-foot" style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;align-items:center">
          <span class="rl" style="margin-right:auto">On/off is set by the row toggle, not here.</span>
          <button class="pill" id="an_reset">Reset to global</button>
          <button class="pill" id="an_esave" style="border-left-color:var(--green)">Save override</button>
        </div>
      </div>`;
    $("#ruleModal").classList.add("open");
    $("#ruX").onclick=()=>$("#ruleModal").classList.remove("open");
    // save: send only the fields that differ from the global default (so unchanged ones keep inheriting)
    $("#an_esave").onclick=async()=>{
      const patch={};
      const diff=(id,gv)=>{ const el=$("#"+id); if(!el) return; const v=Number(el.value); if(!isNaN(v) && v!==Number(gv)) return v; return undefined; };
      const z=diff('an_ez',g.z); if(z!==undefined) patch.z=z;
      const lb=diff('an_elb',g.lookbackWeeks); if(lb!==undefined) patch.lookbackWeeks=lb;
      const mn=diff('an_emin',g.minSample); if(mn!==undefined) patch.minSample=mn;
      if(isVol){ const vf=diff('an_evf',g.volFloor); if(vf!==undefined) patch.volFloor=vf; }
      const sev=$("#an_esev").value; patch.maxSeverity = sev||null;
      // enabled is owned by the row toggle — not touched here
      try{ await api("/api/anomaly/rules/"+encodeURIComponent(s.sig),{method:"PATCH",body:JSON.stringify(patch)});
        $("#ruleModal").classList.remove("open"); renderAnomalySignals(); }
      catch(e){ alert("Save failed: "+e.message); }
    };
    $("#an_reset").onclick=async()=>{
      try{ await api("/api/anomaly/rules/"+encodeURIComponent(s.sig),{method:"PATCH",body:JSON.stringify({reset:true})});
        $("#ruleModal").classList.remove("open"); renderAnomalySignals(); }
      catch(e){ alert("Reset failed: "+e.message); }
    };
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
        <div class="ffull"><label>TRIGGER CODES <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">— which error codes / conditions fire this alert (shown to L2 on the incident)</span></label><input id="ru_codes" placeholder="e.g. 715, 5002 (Semati provider) · excludes 727/726 business declines" value="${esc(g('trigger_codes',''))}"></div>
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
      severity:$("#ru_sev").value, channel:$("#ru_ch").value, team:$("#ru_team").value||null, description:$("#ru_desc").value.trim(), trigger_codes:$("#ru_codes").value.trim()||null,
      runbook:$("#ru_runbook").value.trim()||null,
      active_from:$("#ru_from").value!==""?Number($("#ru_from").value):null, active_to:$("#ru_to").value!==""?Number($("#ru_to").value):null});
    $("#ruX").onclick=()=>$("#ruleModal").classList.remove("open");
    $("#ru_test").onclick=async()=>{
      const tb=$("#ru_testbox"); tb.innerHTML="Testing…";
      try{ const r=await api("/api/rules/test",{method:"POST",body:JSON.stringify(gather())});
        const val = r.value==null?"—":(r.unit==="rate"||r.unit==="ratio")?(r.value*100).toFixed(1)+"%":r.value;
        tb.innerHTML=`Observed <b>${val}</b> (n=${r.sample}) at ${KT.dt(r.now)}Z — `+
          (r.would_fire?`<span style="color:var(--red);font-weight:800">WOULD FIRE ✕</span>`:`<span style="color:var(--good);font-weight:800">would not fire ✓</span>`)+
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
    if(t){ atab=t.dataset.atab; if(window.pf) window.pf.set('alerts_tab',atab); $("#alTabs").querySelectorAll(".pill").forEach(p=>p.classList.toggle("active",p===t)); load(); return; }
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

  /* Lazy-load when the Alerts tab is shown.
   * This used to hang off the navtab CLICK alone, which left one dead path: router.clickNav()
   * skips the click when the tab is ALREADY active, so arriving at #alerts by deep link, reload
   * or back-button rendered the shell — header, tabs, range bar — and never called load(). The
   * page looked broken while nothing had actually failed. Expose an opener the router can call
   * and self-heal if the view is already active at boot. */
  let loaded=false;
  /* header pill + subtitle follow the segment; the anomaly / error-class tabs are Mobile-only */
  function paintSeg(){
    const pill=$("#alSegPill"), sub=$("#alSegSub");
    if(pill){ pill.textContent = SEG==="fixed" ? "FIXED · FTTH · 5G · APP" : "MOBILE · MVNO"; }
    if(sub){ sub.textContent = SEG==="fixed" ? "Fixed rules only (fixed_* metrics over sda_ops) — Mobile alerts live under Mobile › Alerts" : "Mobile (MVNO) rules only — Fixed alerts live under Fixed › Alerts"; }
    document.querySelectorAll('#alTabs [data-atab="anomaly"],#alTabs [data-atab="errclass"]').forEach(b=>b.classList.toggle("hidden", SEG==="fixed"));
    const lg=$("#alFixedLegacy"); if(lg) lg.hidden = SEG!=="fixed";
    if(SEG==="fixed" && (atab==="anomaly"||atab==="errclass")) atab="open";
  }
  function open(seg){
    const want = seg==="fixed" ? "fixed" : "mvno";
    const changed = want!==SEG; SEG = want;
    if(!loaded){ loaded=true; bind(); }
    paintSeg();
    if(changed){ _rbPromise=null; }                      // runbooks / rules cache is per segment
    load();
  }
  window.openAlerts=open;
  document.querySelectorAll(".navtab").forEach(b=>{
    if(b.dataset.view==="alerts") b.addEventListener("click", open);
  });
  document.addEventListener("consoleReady",()=>{
    const av=document.querySelector("#view-alerts");
    if(av && av.classList.contains("active") && !loaded) open();
  });
})();
