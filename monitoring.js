/* Monitoring — two blocks:
 *  1) CONNECTIVITY & HEALTH strip: one card per console dependency (green ok / amber warn /
 *     red fail / grey not-configured) with latency, from GET /api/monitoring/health.
 *  2) API HEALTH: mirrors the ops "Digital-API traffic" Grafana dashboard. Source is picked by
 *     server/src/apiTraffic.js: SSH collector → console-DB api_traffic_events when API_LOG_HOSTS
 *     is set (adds an All/17/18 host chip), else grafana.transaction_logs MySQL — outcome gauges,
 *     response-code distribution, avg/max duration trend, top-20 slow calls, per-API table with
 *     the errclass business/technical split, plus the Latency-alerting threshold editor
 *     (global p95 ms + per-API overrides → console_settings 'api_latency_thresholds', which the
 *     api_latency_p95 metric divides by, so edits here flow straight into alert firing).
 * Frontend is MOUNTED (hard refresh to pick up); the server side is baked (rebuild). */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = window.API_BASE;
  /* A missing route returns the SPA's index.html, not JSON — and r.json() on HTML throws the
   * browser's own parser error ("The string did not match the expected pattern." in Safari),
   * which got shown to the operator as if the DATA were malformed. Read the body once as text
   * and decide, so the message names the real problem: an endpoint this server build doesn't
   * have, i.e. the frontend was deployed without the server. */
  const api=async (p,opts)=>{
    const r=await window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts));
    const body=await r.text();
    let j=null; try{ j=body?JSON.parse(body):null; }catch(_){}
    if(!r.ok) throw new Error((j&&j.error) || `HTTP ${r.status} on ${p.split("?")[0]}`);
    if(j===null) throw new Error(`${p.split("?")[0]} returned no JSON (HTTP ${r.status}) — this console build is missing that endpoint. Deploy the server: bash deploy152/deploy.sh`);
    return j;
  };
  const num=v=>v==null?"—":Number(v).toLocaleString();
  const pct=v=>v==null?"—":(v*100).toFixed(1)+"%";
  const ms=v=>v==null?"—":(v>=10000?(v/1000).toFixed(1)+" s":Math.round(v).toLocaleString()+" ms");

  // errclass COLOR STANDARD (matches errclass.js / the Grafana dealer dashboards)
  const CLS={success:"#10b981",business:"#3b82f6",technical:"#ef4444"};
  const ST={ok:{c:"#10b981",t:"OK"},warn:{c:"#d97706",t:"DEGRADED"},fail:{c:"#ef4444",t:"DOWN"},off:{c:"#94a3b8",t:"NOT CONFIGURED"}};

  let winH=(window.pf&&Number(window.pf.get('mon_hours',24)))||24;   // 1 / 6 / 24 / 72 / 168
  /* PAGE-WIDE date range (like the dashboard): explicit From/To beats the rolling presets.
   * Endpoints that understand from/to (APIGW family, app-errors) receive it via monQS(); the
   * remaining live-window panels keep the preset hours and the bar says so. */
  let monFrom="", monTo="";
  const monQS=()=> (monFrom&&monTo) ? `&from=${encodeURIComponent(monFrom)}&to=${encodeURIComponent(monTo)}` : "";
  /* ---- generic table sorting: click any header of a .msort table. Values are parsed as
   * date ("2026-08-26 15:54:08"), then number ("15,030"), else compared as text. */
  function monSortable(tbl){
    if(!tbl||tbl.dataset.msort) return; tbl.dataset.msort="1";
    const val=td=>{ const t=(td.textContent||"").trim().replace(/Z$/,"");
      if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(t)) return new Date(t.replace(" ","T")).getTime();
      const n=Number(t.replace(/[,%\s]/g,"")); if(t!==""&&!isNaN(n)) return n;
      return t.toLowerCase(); };
    tbl.querySelectorAll("tr:first-child th").forEach((th,ci)=>{
      th.style.cursor="pointer"; th.title="Click to sort";
      th.addEventListener("click",()=>{
        const dir=th.dataset.dir==="a"?"d":"a"; th.dataset.dir=dir;
        tbl.querySelectorAll("th").forEach(h=>{ if(h!==th) delete h.dataset.dir; h.textContent=h.textContent.replace(/ [▲▼]$/,""); });
        th.textContent=th.textContent.replace(/ [▲▼]$/,"")+(dir==="a"?" ▲":" ▼");
        const rows=[...tbl.querySelectorAll("tr")].slice(1);
        rows.sort((r1,r2)=>{ const a=val(r1.cells[ci]),b=val(r2.cells[ci]);
          return (a<b?-1:a>b?1:0)*(dir==="a"?1:-1); });
        rows.forEach(r=>tbl.appendChild(r));
      });
    });
  }
  /* ---- generic export: any rendered table → themed, audited xlsx (xlsxout.js is global) */
  function monExport(tbl,name,meta){
    if(!tbl||!window.opsXlsx) return;
    const cols=[...tbl.querySelectorAll("tr:first-child th")].map(th=>(th.textContent||"col").replace(/ [▲▼]$/,"").trim()||"·");
    const rows=[...tbl.querySelectorAll("tr")].slice(1).map(tr=>{
      const o={}; [...tr.cells].forEach((td,i)=>{ o[cols[i]||("c"+i)]=(td.textContent||"").trim(); }); return o; });
    window.opsXlsx.save([{name:"Data",cols:cols.filter(Boolean),rows}],name,
      Object.assign({source:"monitoring",window:(monFrom&&monTo)?`${monFrom} to ${monTo}`:`last ${winH}h`},meta||{}));
  }
  const monExportBtn=(id,label)=>`<button class="pill" id="${id}" style="padding:3px 10px;font-size:11px;border-left-color:#0e9f5a;margin-left:auto">${label||"⬇ Export xlsx"}</button>`;
  /* ---- PAGE-TOP range bar: one place, visible immediately, drives every tab ---- */
  function renderMonRange(){
    const host=$("#monRange"); if(!host) return;
    host.innerHTML=`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card,#fff)">
      <span class="rl" style="font-weight:700">Time range</span>
      <div class="segsel" id="monWinTop">${[1,6,24,72,168].map(h=>`<button data-h="${h}" class="${winH===h&&!monFrom?"on":""}">${h>=24?(h/24)+"d":h+"h"}</button>`).join("")}</div>
      <span class="rl" style="margin-left:6px">Dates</span>
      <input type="date" id="monFromT" value="${esc(monFrom.slice(0,10))}" style="border:1px solid var(--line);border-radius:8px;padding:4px 8px;font-size:12px;color:var(--ink);background:var(--card)">
      <span class="rl" style="font-size:11px">→</span>
      <input type="date" id="monToT" value="${esc(monTo.slice(0,10))}" style="border:1px solid var(--line);border-radius:8px;padding:4px 8px;font-size:12px;color:var(--ink);background:var(--card)">
      <button class="pill" id="monDateApplyT" style="border-left-color:var(--blue);padding:4px 10px">Apply</button>
      ${monFrom?`<button class="pill" id="monDateClearT" style="border-left-color:#94a3b8;padding:4px 8px">Clear</button>
        <span class="rl" style="font-size:10px;color:#b26b00">date range active — APIGW &amp; Error panels use it; live panels show the equivalent span ending now</span>`
        :`<span class="rl" style="font-size:10px;color:var(--muted)">applies to every tab · KSA</span>`}
    </div>`;
    const rerender=()=>{ renderMonRange(); renderTraffic(); renderAppErrors(); renderSms(); renderApigw(); renderUil(); renderOsbArch(); };
    host.querySelectorAll("#monWinTop button").forEach(b=>b.onclick=()=>{ winH=Number(b.dataset.h); monFrom=monTo=""; monErrFrom=monErrTo="";
      if(window.pf) window.pf.set('mon_hours',winH); rerender(); if(window.audit) window.audit("APPLY_FILTER","monitoring:window"); });
    const ap=host.querySelector("#monDateApplyT"); if(ap) ap.onclick=()=>{
      const f=host.querySelector("#monFromT").value, t=host.querySelector("#monToT").value;
      if(!f||!t||f>=t) return alert("Pick a valid From → To date range");
      monFrom=f+"T00:00"; monTo=t+"T23:59"; monErrFrom=monFrom; monErrTo=monTo;
      winH=Math.min(720,Math.max(1,Math.ceil((new Date(monTo)-new Date(monFrom))/3600e3)));
      rerender(); if(window.audit) window.audit("APPLY_FILTER","monitoring:dates"); };
    const cl=host.querySelector("#monDateClearT"); if(cl) cl.onclick=()=>{ monFrom=monTo=""; monErrFrom=monErrTo="";
      winH=(window.pf&&Number(window.pf.get('mon_hours',24)))||24; rerender(); };
    // sticky "stuck" shadow, same behaviour as the dashboard range bar
    if(!host.dataset.stickyWired){ host.dataset.stickyWired="1"; let t=false;
      const on=()=>{ t=false; host.classList.toggle("stuck", host.getBoundingClientRect().top<=56 && window.scrollY>10); };
      document.addEventListener("scroll",()=>{ if(!t){ t=true; requestAnimationFrame(on); } },{passive:true}); on(); }
  }
  let apiFilter="";
  let hostFilter="";     // collector mode only — which api host (17/18); "" = all
  let thr=null;          // { globalMs, perApi } — latency thresholds (lazy-loaded)
  let lastTraffic=null;

  /* ---------- 1) CONNECTIVITY & HEALTH ---------- */
  /* Hover/focus polish lives in one injected stylesheet: :hover can't be expressed inline, and
   * editing the global CSS for a single section would spread this change across files. */
  (function injectCss(){
    if(document.getElementById("monCss")) return;
    const s=document.createElement("style"); s.id="monCss";
    s.textContent=`
      .mon-chip{transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease}
      .mon-chip:hover{transform:translateY(-1px);box-shadow:0 5px 16px rgba(15,23,42,.13)}
      .mon-chip:focus-visible{outline:2px solid var(--blue,#2563eb);outline-offset:2px}
      .mon-chip.sel{box-shadow:0 5px 16px rgba(15,23,42,.16)}
      .mon-tab{transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease,background .12s ease}
      .mon-tab:hover{transform:translateY(-1px)}
      .mon-tab:focus-visible{outline:2px solid var(--blue,#2563eb);outline-offset:2px}
      #monRange{position:sticky;top:var(--hdr);z-index:30;transition:box-shadow .15s}
      #monRange.stuck>div{box-shadow:0 6px 18px rgba(15,23,42,.16)}
      .mon-sum{cursor:pointer;border-radius:6px;padding:1px 5px}
      .mon-sum:hover{background:var(--line-soft,rgba(148,163,184,.18))}
      .mon-sum.on{background:var(--line-soft,rgba(148,163,184,.28));font-weight:800}
      .sms-kpi{transition:transform .12s ease,box-shadow .12s ease}
      .sms-kpi:hover{transform:translateY(-1px);box-shadow:0 5px 16px rgba(15,23,42,.13)}
      .sms-kpi:focus-visible{outline:2px solid var(--blue,#2563eb);outline-offset:2px}
      .sms-row:hover,.sms-pick:hover{background:var(--line-soft,rgba(148,163,184,.16))}
      @keyframes monFlash{0%{box-shadow:0 0 0 0 rgba(37,99,235,.45)}100%{box-shadow:0 0 0 14px rgba(37,99,235,0)}}
      .monflash{animation:monFlash 1.3s ease-out;border-radius:12px}
      .gwrow{cursor:pointer;transition:background .12s ease}
      .gwrow:hover{background:var(--line-soft,rgba(148,163,184,.16))}
      .gwprob{transition:transform .12s ease,box-shadow .12s ease}
      .gwprob:hover{transform:translateY(-1px);box-shadow:0 5px 16px rgba(15,23,42,.13)}
      @keyframes monIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
      #monDetail,#smsDetail{animation:monIn .14s ease}`;
    document.head.appendChild(s);
  })();

  /* WHAT EACH CHECK MEANS — the strip used to show a status and a latency, which tells you
   * something is amber but not what to do about it. This is that missing half: what is actually
   * probed, why it matters, and the first move when it is not green. `tab` links the dependency
   * to the section that investigates it, so a red chip is one click from the evidence. */
  const WHATIS={
    console_api:{ what:"This console's own Node process on 172.31.38.152 (salam-unified).", why:"If this is down you are not reading this page — it is here so uptime and version are visible after a deploy.", red:"pm2 logs salam-console --err" },
    replica:{ what:"The Postgres replica the console reads (orders, payments, users…), plus how long ago prod-sync last landed rows.", why:"Every number in this console comes from here. A stale sync looks exactly like 'nothing happened' — which is how we once concluded sign-in tracking was broken.", red:"DOWN = no connection: check the network and SOURCE_DATABASE_URL. SATURATED = the database is fine but every pooled connection is busy — find the slow query (pg_stat_activity) or raise SOURCE_POOL_MAX. The two are different problems.", tab:"access" },
    console_db:{ what:"The console's own database: rules, snapshots, sessions, collected API logs.", why:"Alerts, audit and the API-traffic collector all write here.", red:"Verify CONSOLE_DATABASE_URL and disk space on 152." },
    ollama:{ what:"The local LLM that answers as Yusr (llama3.1, CPU-only on this box).", why:"Yusr degrades to runbook search without it — nothing else on the console is affected.", red:"systemctl status ollama · Settings → Yusr" },
    osb:{ what:"The OSB MySQL log store (uil_logs) on 172.31.43.72 — the BSS read path.", why:"It is the only source for BSS-side faults such as the 1500 read errors; without it a BSS failure looks like a silent app error.", red:"Check OSB_LOG_URL and the firewall rule 152 → 43.72:3306", tab:"gateway" },
    apigw:{ what:"TCP reachability of each API-Gateway node.", why:"The first hop of every customer request. Partial reachability means uneven latency, not an outage — which is why it shows DEGRADED rather than DOWN.", red:"Open Gateway & API for the per-node probe history.", tab:"gateway" },
    servicenow:{ what:"Read-only link to ServiceNow for incident correlation.", why:"Lets an alert show the matching ticket. Purely additive — nothing breaks without it.", red:"Set SN_URL / SN_USER / SN_PASS and restart." },
    api_traffic:{ what:"The API-log feed: SSH collector on hosts 17/18, or the Grafana MySQL fallback.", why:"Feeds latency, error-rate and the login funnel. If it stalls, those panels quietly go flat instead of going red.", red:"Check API_LOG_HOSTS and the SSH key; see the collector age above.", tab:"gateway" },
    payments_funnel:{ what:"Last 24 h of payment attempts: captured, declined, stuck.", why:"Stuck means the gateway took the money and the app still says pending — the one payment state that costs a customer directly.", red:"Open Payments GW and work the stuck list.", tab:"payments" },
    upg_db:{ what:"Read-only connection to the UPG (Tap) gateway database.", why:"Without it a payment can only be seen from our side, so 'declined' and 'no answer' cannot be told apart.", red:"Set UPG_DATABASE_URL; confirm the read-only grant.", tab:"payments" },
    apigw_traces:{ what:"Zipkin span capture from the gateway.", why:"The gateway keeps roughly 1–3 h; the console keeps 30 days. Once a span ages out upstream it exists only here.", red:"Set ZIPKIN_HOSTS — every hour it is off is an hour that cannot be recovered.", tab:"gateway" }
  };
  /* which dependencies decide each tab's status dot */
  const TAB_KEYS={ gateway:["apigw","apigw_traces","api_traffic","osb"], payments:["upg_db","payments_funnel"],
                   access:["replica","api_traffic"], sms:[], delivery:[], resellers:[] };
  let lastHealth=null, healthFilter="", selChip="";

  async function renderHealth(){
    const box=$("#monHealth"); if(!box) return;
    if(!$("#monRange").firstChild) renderMonRange();   // sticky page-top time bar, once per load
    if(!box.firstChild) box.innerHTML=`<div class="sub">Checking connectivity…</div>`;
    let d; try{ d=await api("/api/monitoring/health"); }
    catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    lastHealth=d;
    if($("#monNow")) $("#monNow").textContent="checked "+KT.t(d.now, true);
    paintHealth();
    renderTabs();          // dependency status flows into the tab dots
  }

  // one compact chip per dependency — scannable in a glance, expandable on click
  function paintHealth(){
    const box=$("#monHealth"), d=lastHealth; if(!box||!d) return;
    const chip=c=>{ const s=ST[c.status]||ST.off;
      const hide=healthFilter&&c.status!==healthFilter;
      const metric=c.ms!=null?ms(c.ms):(c.status==="off"?"not set":"");
      return `<button class="mon-chip${selChip===c.key?" sel":""}" data-k="${esc(c.key)}" title="${esc(c.detail||"")}" style="
        display:${hide?"none":"inline-flex"};align-items:center;gap:7px;cursor:pointer;font:inherit;text-align:left;
        border:1px solid ${selChip===c.key?s.c:"var(--line)"};border-left:3px solid ${s.c};border-radius:999px;
        padding:5px 12px 5px 10px;background:${selChip===c.key?s.c+"12":"var(--card,#fff)"};color:inherit">
        <span style="width:8px;height:8px;border-radius:50%;background:${s.c};flex:0 0 auto;${c.status==="ok"?"box-shadow:0 0 0 3px "+s.c+"22":""}"></span>
        <span style="font-size:11.5px;font-weight:700;white-space:nowrap">${esc(c.label)}</span>
        ${metric?`<span style="font-size:10px;color:var(--muted);white-space:nowrap">${esc(metric)}</span>`:""}
        ${c.status!=="ok"?`<span style="font-size:9px;font-weight:800;letter-spacing:.04em;color:${s.c}">${s.t}</span>`:""}
      </button>`; };
    const sum=(label,n,st,color)=>`<span class="mon-sum${healthFilter===st?" on":""}" data-st="${st}" style="color:${n?color:"var(--muted)"}">${n||0} ${label}</span>`;
    box.innerHTML=`<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-weight:800;font-size:12px;color:var(--ink)">⊙ CONNECTIVITY &amp; HEALTH</span>
        <span class="rl" style="font-size:11px;display:flex;gap:4px;align-items:center">
          ${sum("ok",d.summary.ok,"ok","#10b981")}·${sum("degraded",d.summary.warn,"warn","#d97706")}·${sum("down",d.summary.fail,"fail","#ef4444")}·${sum("not configured",d.summary.off,"off","#94a3b8")}
        </span>
        <span class="rl" style="font-size:10px;color:var(--muted)">click a status to filter · click a chip for what it means</span>
      </div>
      <div style="display:flex;gap:7px;flex-wrap:wrap">${d.checks.map(chip).join("")}</div>
      <div id="monDetail"></div>`;
    box.querySelectorAll(".mon-chip").forEach(b=>b.addEventListener("click",()=>{
      selChip=(selChip===b.dataset.k)?"":b.dataset.k; paintHealth();
    }));
    box.querySelectorAll(".mon-sum").forEach(b=>b.addEventListener("click",()=>{
      healthFilter=(healthFilter===b.dataset.st)?"":b.dataset.st; paintHealth();
    }));
    if(selChip) paintDetail();
  }

  function paintDetail(){
    const host=$("#monDetail"), d=lastHealth; if(!host||!d) return;
    const c=(d.checks||[]).find(x=>x.key===selChip); if(!c){ host.innerHTML=""; return; }
    const s=ST[c.status]||ST.off, w=WHATIS[c.key]||{};
    /* When the chip's section is ALREADY the open tab, "Open X →" did nothing visible — activate()
     * short-circuits on an unchanged tab that is already drawn, so the click looked broken. Say
     * what the button will actually do, and scroll+flash the panel instead of pretending to
     * navigate. */
    const here=w.tab && w.tab===curTab;
    const jump=w.tab?`<button class="pill mon-jump" data-tab="${esc(w.tab)}" style="padding:4px 12px;font-size:11px">${
      here?"Jump to the panel ↓":"Open "+esc((TABS.find(t=>t.key===w.tab)||{}).label||w.tab)+" →"}</button>`:"";
    host.innerHTML=`<div style="margin-top:9px;border:1px solid ${s.c}55;border-left:3px solid ${s.c};border-radius:11px;padding:10px 13px;background:${s.c}0a">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        <b style="font-size:12.5px">${esc(c.label)}</b>
        <span style="font-size:9.5px;font-weight:800;letter-spacing:.05em;color:${s.c};border:1px solid ${s.c};border-radius:999px;padding:1px 8px">${s.t}</span>
        <span class="rl" style="font-size:11px;color:var(--muted)">${esc(c.detail||"")}${c.ms!=null?` · ${esc(ms(c.ms))}`:""}</span>
        <span style="flex:1"></span>${jump}
        <button class="pill mon-close" style="padding:4px 10px;font-size:11px">✕</button>
      </div>
      ${w.what?`<div class="rl" style="font-size:11px;white-space:normal;margin-top:6px"><b>What it checks.</b> ${esc(w.what)}</div>`:""}
      ${w.why?`<div class="rl" style="font-size:11px;white-space:normal;color:var(--muted)"><b>Why it matters.</b> ${esc(w.why)}</div>`:""}
      ${w.red&&c.status!=="ok"?`<div class="rl" style="font-size:11px;white-space:normal;color:var(--warn-fg);margin-top:3px"><b>First move.</b> ${esc(w.red)}</div>`:""}
    </div>`;
    const j=host.querySelector(".mon-jump");
    if(j) j.addEventListener("click",()=>{
      const tab=j.dataset.tab;
      activate(tab);
      // bring the panel into view and flash it — the whole point of the button is "show me"
      const pane=document.querySelector(`#monPanes .monpane[data-pane="${tab}"]`);
      if(pane){
        pane.scrollIntoView({behavior:"smooth",block:"start"});
        pane.classList.remove("monflash"); void pane.offsetWidth; pane.classList.add("monflash");
        setTimeout(()=>pane.classList.remove("monflash"),1400);
      }
    });
    const x=host.querySelector(".mon-close"); if(x) x.addEventListener("click",()=>{ selChip=""; paintHealth(); });
  }

  /* ---------- 2) API HEALTH ---------- */
  // semicircle gauge — same SVG style as home.js outcomeGauge
  function gauge(label,val,color,total){
    const share=total>0?(val||0)/total:0;
    const fill=Math.max(2,share*100).toFixed(1);
    const arc="M 14 64 A 46 46 0 0 1 106 64";
    return `<div style="flex:1;min-width:150px;text-align:center">
      <svg viewBox="0 0 120 74" style="max-width:190px;margin:0 auto">
        <path d="${arc}" fill="none" stroke="var(--line)" stroke-opacity=".45" stroke-width="10" stroke-linecap="round"/>
        <path d="${arc}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" pathLength="100" stroke-dasharray="${fill} 100"/>
        <text x="60" y="56" text-anchor="middle" font-size="18" font-weight="800" fill="${color}">${num(val)}</text>
      </svg>
      <div style="font-size:11.5px;font-weight:700;color:${color};margin-top:2px">${esc(label)}</div>
      <div class="rl" style="font-size:10px;color:var(--muted)">${total>0?(share*100).toFixed(1)+"% of calls":"—"}</div></div>`;
  }

  function codeBars(codes){
    const mx=Math.max(...codes.map(c=>c.count),1);
    return codes.map(c=>{ const col=CLS[c.cls]||"#64748b";
      return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
        <span class="mono" style="width:90px;text-align:right;font-size:11px;font-weight:700;color:${col}">${esc(c.code)}</span>
        <div style="flex:1;background:var(--bg);border-radius:5px;height:14px;overflow:hidden">
          <div style="width:${Math.max(1.5,c.count/mx*100).toFixed(1)}%;height:100%;background:${col};opacity:.85"></div></div>
        <span class="rl" style="width:70px;font-size:11px">${num(c.count)}</span></div>`; }).join("");
  }

  // avg + max duration over time — simple SVG line pair (home.js spark style, bigger)
  function durationSvg(series){
    if(!series||series.length<2) return `<div class="rl" style="padding:12px">Not enough data points in this window.</div>`;
    const W=760,H=180,P=34;
    const mx=Math.max(...series.map(s=>s.max||0),1);
    const X=i=>P+(i/(series.length-1))*(W-P-10);
    const Y=v=>H-18-((v||0)/mx)*(H-34);
    const line=(k,col,wd)=>`<polyline fill="none" stroke="${col}" stroke-width="${wd}" stroke-linejoin="round" points="${series.map((s,i)=>`${X(i).toFixed(1)},${Y(s[k]).toFixed(1)}`).join(" ")}"/>`;
    const gridY=[0,.25,.5,.75,1].map(f=>{ const v=mx*f;
      return `<line x1="${P}" y1="${Y(v)}" x2="${W-10}" y2="${Y(v)}" stroke="var(--line)" stroke-opacity=".4"/>
        <text x="${P-4}" y="${Y(v)+3}" text-anchor="end" font-size="9" fill="var(--muted)">${v>=1000?(v/1000).toFixed(1)+"s":Math.round(v)}</text>`; }).join("");
    const tickN=Math.min(6,series.length);
    const ticks=[...Array(tickN)].map((_,i)=>{ const idx=Math.round(i*(series.length-1)/(tickN-1)); const t=new Date(series[idx].t);
      return `<text x="${X(idx)}" y="${H-4}" text-anchor="middle" font-size="9" fill="var(--muted)">${KT.t(series[idx].t)}</text>`; }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${gridY}${ticks}
      ${line("max","#d97706",1.4)}${line("avg","#2563eb",2)}
      <g font-size="10" font-weight="700"><rect x="${P}" y="4" width="8" height="3" fill="#2563eb"/><text x="${P+12}" y="9" fill="#2563eb">AVG</text>
      <rect x="${P+52}" y="4" width="8" height="3" fill="#d97706"/><text x="${P+64}" y="9" fill="#d97706">MAX</text>
      <text x="${W-10}" y="9" text-anchor="end" fill="var(--muted)" font-weight="600">duration (ms, KSA axis)</text></g></svg>`;
  }

  function slowTable(rows){
    if(!rows.length) return `<div class="rl" style="padding:8px">No calls in this window.</div>`;
    return `<table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead><tr style="text-align:left;color:var(--muted)"><th style="padding:4px 6px">When (KSA)</th><th>API</th><th>Txn</th><th>Code</th><th style="text-align:right">Duration</th></tr></thead>
      <tbody>${rows.map(r=>`<tr style="border-top:1px solid var(--line)">
        <td class="mono" style="padding:4px 6px;white-space:nowrap">${esc(KT.dts(r.at))}</td>
        <td class="mono" style="word-break:break-all">${esc(r.api)}</td>
        <td class="mono" style="font-size:10.5px">${r.txn?`<a href="javascript:void(0)" data-slowtxn="${esc(r.txn)}" title="End-to-end: app call ⇄ APIGW hops ⇄ UIL payloads" style="color:#3b82f6;text-decoration:none;font-weight:700">${esc(r.txn)} ⇄</a>`:`<span style="color:var(--muted)">—</span>`}</td>
        <td class="mono">${esc(r.code||"—")}</td>
        <td style="text-align:right;font-weight:700;color:${r.ms>=(thr&&thr.globalMs||1500)?"#ef4444":"var(--ink)"}">${esc(ms(r.ms))}</td></tr>`).join("")}</tbody></table>`;
  }

  function perApiTable(rows){
    if(!rows.length) return `<div class="rl" style="padding:8px">No calls in this window.</div>`;
    const ovr=(thr&&thr.perApi)||{};
    return `<table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead><tr style="text-align:right;color:var(--muted)"><th style="text-align:left;padding:4px 6px">API</th><th>Calls</th><th>Success %</th>
        <th style="color:${CLS.business}">Business fails</th><th style="color:${CLS.technical}">Technical fails</th><th>Avg</th><th>p95</th><th>Threshold</th></tr></thead>
      <tbody>${rows.map(r=>{ const lim=ovr[r.api]>0?ovr[r.api]:(thr&&thr.globalMs)||1500; const breach=r.p95Ms!=null&&r.p95Ms>=lim;
        return `<tr class="papi-row" data-api="${esc(r.api)}" style="border-top:1px solid var(--line);text-align:right;cursor:pointer" title="Click: select this API + load its failing request/response samples">
        <td class="mono" style="text-align:left;padding:4px 6px;word-break:break-all">${esc(r.api)}</td>
        <td>${num(r.calls)}</td>
        <td style="font-weight:700;color:${r.successRate==null?"var(--muted)":r.successRate>=.95?"#16a34a":r.successRate>=.85?"#d97706":"#dc2626"}">${pct(r.successRate)}</td>
        <td style="color:${CLS.business};font-weight:${r.business?700:400}">${num(r.business)}</td>
        <td style="color:${CLS.technical};font-weight:${r.technical?700:400}">${num(r.technical)}</td>
        <td>${esc(ms(r.avgMs))}</td>
        <td style="font-weight:700;color:${breach?"#ef4444":"var(--ink)"}">${esc(ms(r.p95Ms))}${breach?" ⚠":""}</td>
        <td class="rl" style="font-size:10.5px">${num(lim)} ms${ovr[r.api]>0?" ·":""} ${ovr[r.api]>0?"<b>override</b>":""}</td></tr>`; }).join("")}</tbody></table>`;
  }

  function errList(errors){
    if(!errors.length) return `<div class="rl" style="padding:8px;color:var(--good);font-weight:700">No error messages in this window.</div>`;
    return errors.map(e=>{ const col=CLS[e.cls]||"#64748b";
      return `<div style="display:flex;gap:8px;align-items:baseline;border-top:1px solid var(--line);padding:5px 2px;font-size:11.5px">
        <span class="mono" style="font-weight:800;color:${col};min-width:60px">${esc(e.code)}</span>
        <span style="flex:1;word-break:break-word">${esc(e.msg)}</span>
        <span style="display:inline-block;background:${col}18;color:${col};border-radius:4px;padding:0 6px;font-size:10px;font-weight:700">${e.cls==="technical"?"Technical":"Business"}</span>
        <span class="rl" style="min-width:50px;text-align:right">×${num(e.count)}</span></div>`; }).join("");
  }

  /* Latency alerting configuration (global p95, manual per-API overrides, per-API thresholds from history) moved to
   * Mobile › Alerts › Alert rules › "Latency thresholds" (latencycfg.js, 10 Sep 2026) — this tab only READS thr to colour the table. */

  async function renderTraffic(){
    const box=$("#monTraffic"); if(!box) return;
    if(!box.firstChild) box.innerHTML=`<div class="sub">Loading API traffic…</div>`; else box.style.opacity=".5";
    if(!thr){ try{ thr=await api("/api/monitoring/latency-thresholds"); }catch(e){ thr={globalMs:1500,perApi:{}}; } }
    let d; try{ d=await api(`/api/monitoring/traffic?hours=${winH}${apiFilter?`&api=${encodeURIComponent(apiFilter)}`:""}${hostFilter?`&host=${encodeURIComponent(hostFilter)}`:""}`); }
    catch(e){ box.style.opacity=""; box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    lastTraffic=d; box.style.opacity="";

    const srcLabel=d.mode==="collector"?"SSH collector → api_traffic_events (console DB)":"Digital-API traffic (grafana.transaction_logs)";
    const head=`<div style="font-weight:800;font-size:13px;color:var(--ink);margin:4px 0 8px">② API HEALTH
        <span class="rl" style="font-weight:600">· ${esc(srcLabel)}</span></div>`;

    if(!d.configured){
      box.innerHTML=head+`<div style="border:1px dashed var(--line);border-radius:10px;padding:18px;background:var(--card)">
        <b>API-traffic source not configured.</b>
        <div class="rl" style="margin-top:6px;line-height:1.7;color:var(--muted)"><b>Preferred — SSH collector:</b> the console pulls
        <span class="mono">api_logger.production.log</span> increments straight from the api hosts into its own DB. Set in the server env:<br>
        <span class="mono">API_LOG_HOSTS=&lt;server17-ip&gt;,&lt;server18-ip&gt; · API_LOG_USER=… · API_LOG_KEY=…</span> (see deploy152/env.template for the ssh-copy-id prereqs)<br>
        <b>Fallback — Grafana MySQL:</b> the same DB the ops Grafana dashboard reads (fed every 5 min by the api_logger cron parser):<br>
        <span class="mono">API_TRAFFIC_URL=mysql://&lt;readonly_user&gt;:&lt;pass&gt;@172.31.43.175:3306/grafana</span><br>
        then restart the console. The connectivity strip above will turn the "API traffic" card green when it works.</div></div>`;
      return;
    }
    if(!d.ok){
      box.innerHTML=head+`<div class="albanner">API-traffic DB configured but unreachable: ${esc(d.error||"unknown error")}</div>`;
      return;
    }

    /* Window + Dates moved to the STICKY page-top bar (#monRange) — one time control for the
     * whole page, not one hidden inside this panel. Host + API filters stay local. */
    const selector=`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      ${d.hosts&&d.hosts.length?`<span class="rl" style="margin-left:8px">Host</span>
      <div class="segsel" id="monHost"><button data-h="" class="${hostFilter?"":"on"}">All</button>${d.hosts.map(x=>`<button data-h="${esc(x)}" class="${hostFilter===x?"on":""}">.${esc(String(x).split(".").pop())}</button>`).join("")}</div>`:""}
      <span class="rl" style="margin-left:8px">API</span>
      <select id="monApiSel" class="mono" style="max-width:560px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:11.5px;color:var(--ink);background:var(--card)">
        ${(()=>{
          /* Each option carries the endpoint's own numbers FOR THE SELECTED PERIOD — calls,
           * failures (biz+tech), p95 — ordered most-failed first, then most-called, so the API
           * that needs attention is at the top of the list, not alphabetically buried.
           * (perApi is the same data as the health table below, so they can never disagree.) */
          const stats={}; (d.perApi||[]).forEach(r=>{ stats[r.api]=r; });
          const fails=r=>Number(r.business||0)+Number(r.technical||0);
          const ranked=(d.perApi||[]).slice().sort((a,b)=>fails(b)-fails(a)||Number(b.calls||0)-Number(a.calls||0));
          const quiet=(d.apis||[]).filter(a=>!stats[a]).sort();
          const totC=ranked.reduce((s,r)=>s+Number(r.calls||0),0), totF=ranked.reduce((s,r)=>s+fails(r),0);
          const lbl=r=>{ const f=fails(r);
            return `${r.api}  ·  ${Number(r.calls||0).toLocaleString()} calls  ·  ${f?f.toLocaleString()+" fail":"0 fail"}`
              +`${r.p95Ms!=null?"  ·  p95 "+Math.round(r.p95Ms).toLocaleString()+"ms":""}`
              +`${r.avgMs!=null?"  ·  avg "+Math.round(r.avgMs).toLocaleString()+"ms":""}`; };
          return `<option value="">All APIs (${(d.apis||[]).length})  ·  ${totC.toLocaleString()} calls  ·  ${totF.toLocaleString()} fail</option>`
            +(ranked.length?`<optgroup label="— by failures, then volume (this period) —">`
              +ranked.map(r=>`<option value="${esc(r.api)}" ${r.api===apiFilter?"selected":""}>${esc(lbl(r))}</option>`).join("")+`</optgroup>`:"")
            +(quiet.length?`<optgroup label="— no calls in this period —">`
              +quiet.map(a=>`<option value="${esc(a)}" ${a===apiFilter?"selected":""}>${esc(a)}</option>`).join("")+`</optgroup>`:"");
        })()}
      </select>
      <span class="rl" style="margin-left:auto;font-size:10.5px;color:var(--muted)">success = code in [${d.successCodes.map(esc).join(", ")}] · KSA times · global p95 ${d.globalP95!=null?esc(ms(d.globalP95)):"—"}</span>
    </div>`;

    const g=d.gauges;
    box.innerHTML=head+selector+`<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:12px">
      <div class="apanel" style="grid-column:span 12"><div class="ah"><b>Call outcomes <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· last ${d.hours||winH}h${apiFilter?` · ${esc(apiFilter)}`:""}</span></b></div>
        <div class="abody" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-around;align-items:flex-end">
          ${gauge("Total calls",g.total,"#64748b",g.total)}${gauge("Success",g.success,CLS.success,g.total)}${gauge("Failure",g.failure,CLS.technical,g.total)}
        </div></div>
      <div class="apanel" style="grid-column:span 5;min-width:260px"><div class="ah"><b>Response-code distribution</b></div>
        <div class="abody">${codeBars(d.codes)}</div></div>
      <div class="apanel" style="grid-column:span 7;min-width:300px"><div class="ah"><b>Duration — AVG &amp; MAX <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· ${d.bucketMin}-min buckets</span></b></div>
        <div class="abody">${durationSvg(d.series)}</div></div>
      <div class="apanel" style="grid-column:span 12"><div class="ah"><b>Top 20 slowest calls <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· click a Txn ⇄ to trace it end-to-end: app call → APIGW hops → UIL request/response</span></b></div>
        <div class="abody" style="overflow:auto">${slowTable(d.slowest)}</div></div>
      ${apiFilter?`<div class="apanel" style="grid-column:span 12;border-left:4px solid #2563eb"><div class="ah" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>Request / response samples <span class="rl mono" style="font-weight:600;font-size:11px;color:var(--muted)">· ${esc(apiFilter)} · live grep of api_logger on the hosts</span></b>
          <span style="flex:1"></span>
          <button class="pill" id="monSampFail" style="padding:3px 10px;font-size:11px;border-left-color:#dc2626">⚠ Failures only</button>
          <button class="pill" id="monSampAll" style="padding:3px 10px;font-size:11px">All calls</button></div>
        <div class="abody" id="monApiSamples"><div class="rl" style="color:var(--muted)">Click “Failures only” or “All calls” to fetch the latest request/response pairs for this endpoint (on-demand — a few seconds).</div></div></div>`:""}
      <div class="apanel" style="grid-column:span 12"><div class="ah"><b>Per-API health <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· success% · business vs technical fails (errclass) · avg/p95 vs threshold · click a row to select the API + load its samples</span></b></div>
        <div class="abody" style="overflow:auto;max-height:420px">${perApiTable(d.perApi)}</div></div>
      <div class="apanel" style="grid-column:span 12"><div class="ah"><b>Error messages <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· top failing code · message pairs (MSISDN-like strings masked server-side)</span></b></div>
        <div class="abody">${errList(d.errors)}</div></div>
      <div class="apanel" style="grid-column:span 12"><div class="abody" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>Latency alerting</b><span class="rl">global p95 threshold <b>${esc((thr&&thr.globalMs)||1500)} ms</b> · ${Object.keys((thr&&thr.manual)||{}).length} manual override(s) · ${Object.keys((thr&&thr.perApiAuto)||{}).length} history-derived line(s)</span><a href="#alerts?tab=rules&sec=latency" class="pill" style="margin-left:auto;text-decoration:none;border-left-color:var(--green)">Configure in Alerts › Alert rules › Latency thresholds ›</a></div></div>
    </div>`;

    // wiring
    // Window/Dates handlers moved to the sticky page-top bar (renderMonRange)
    document.querySelectorAll("#monHost button").forEach(b=>b.onclick=()=>{ hostFilter=b.dataset.h||""; renderTraffic(); if(window.audit) window.audit("APPLY_FILTER","monitoring:host"); });
    // request/response samples for the selected API (on-demand SSH grep — never auto-fired)
    const sf=$("#monSampFail"); if(sf) sf.onclick=()=>renderApiSamples(true);
    const sa=$("#monSampAll"); if(sa) sa.onclick=()=>renderApiSamples(false);
    // per-API row click = select that API and pre-load its FAILING samples — the one-click path
    // from "this API has 162 technical fails" to the actual failing request/response
    box.querySelectorAll(".papi-row").forEach(tr=>tr.addEventListener("click",()=>{
      apiFilter=tr.dataset.api||""; renderTraffic().then?.(()=>{});
      setTimeout(()=>renderApiSamples(true),400);
      if(window.audit) window.audit("APPLY_FILTER","monitoring:api:"+(apiFilter||"").slice(0,50));
    }));
    const sel=$("#monApiSel"); if(sel) sel.onchange=()=>{ apiFilter=sel.value; renderTraffic(); if(window.audit) window.audit("APPLY_FILTER","monitoring:api"); };
    // txn ⇄ end-to-end drill: slowest-calls row → Troubleshoot Case analyzer (app ⇄ APIGW ⇄ UIL)
    box.querySelectorAll("[data-slowtxn]").forEach(a=>a.addEventListener("click",()=>{
      if(window.audit) window.audit("APIGW_TXN_DRILL", a.dataset.slowtxn);
      if(window.setConsoleHash) window.setConsoleHash("troubleshoot");
      setTimeout(()=>{ if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(a.dataset.slowtxn); },300);
    }));
  }

  /* ---- request/response SAMPLES for the selected API (api_logger on 17/18, live grep) ------
   * Renders the exact log lines ops used to paste into mails, as readable cards: call header
   * (status · code · duration · platform/app · host · KSA time), request body and response body
   * side by side, and "Analyze ›" per sample (the request's transactionId IS the UIL id, so the
   * Case analyzer opens the full end-to-end story). Masked by default; unmask audited. */
  async function renderApiSamples(failOnly, unmask){
    const host=$("#monApiSamples"); if(!host||!apiFilter) return;
    host.innerHTML=`<div class="rl">Grepping api_logger on the hosts for <span class="mono">${esc(apiFilter)}</span>… (a few seconds)</div>`;
    let d; try{ d=await api(`/api/monitoring/api-samples?path=${encodeURIComponent(apiFilter)}&fail=${failOnly?"1":"0"}&limit=8&window=${winH}${monQS()}${unmask?"&unmask=1":""}`); }
    catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    if(!d.configured){ host.innerHTML=`<div class="rl" style="color:var(--muted)">API_LOG_HOSTS not configured — live samples need the SSH collector.</div>`; return; }
    if(!d.ok){ host.innerHTML=`<div class="albanner">${esc(d.error||"lookup failed")}</div>`; return; }
    const rows=d.rows||[];
    const pretty=v=>{ let s; try{ s=typeof v==="string"?v:JSON.stringify(v,null,2); }catch(_){ s=String(v); }
      return esc(s.length>3500?s.slice(0,3500)+"\n… truncated":s); };
    const cards=rows.map(r=>{
      const bad=r.failed;
      return `<div style="border:1px solid var(--line);border-left:4px solid ${bad?"#dc2626":"#16a34a"};border-radius:10px;margin-bottom:10px;overflow:hidden">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:7px 10px;background:var(--line-soft,rgba(148,163,184,.14));font-size:11px">
        <b>${esc(r.verb)}</b><span class="mono">${esc(r.path)}</span>
        <b style="color:${bad?"#dc2626":"#16a34a"}">${esc(String(r.http_status??"—"))}${r.response_code?` · code ${esc(r.response_code)}`:""}</b>
        ${r.duration_ms!=null?`<span class="rl">${Number(r.duration_ms).toLocaleString()} ms</span>`:""}
        <span class="rl">${esc(r.app_platform||"?")} v${esc(r.app_version||"?")}</span>
        <span class="rl">host ${esc(String(r.host||"").split(".").pop())}</span>
        <span class="rl">${esc(r.ts||"")}</span>
        <span style="flex:1"></span>
        ${r.txn?`<button class="pill samp-an" data-txn="${esc(r.txn)}" style="padding:2px 9px;font-size:10.5px;border-left-color:#2563eb">Analyze ›</button>`:""}
      </div>
      ${r.response_message?`<div style="padding:5px 10px;font-size:11px;color:${bad?"#dc2626":"var(--muted)"};font-weight:${bad?700:400}">${esc(r.response_message)}</div>`:""}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px">
        <div><div style="font-size:9.5px;font-weight:800;color:var(--muted);margin-bottom:3px">REQUEST BODY</div>
          <pre style="margin:0;max-height:230px;overflow:auto;background:var(--panel-dark);color:var(--panel-dark-fg);border-radius:8px;padding:8px;font-size:10px;line-height:1.45;white-space:pre-wrap;word-break:break-word">${r.request_body!=null?pretty(r.request_body):"(no body)"}</pre></div>
        <div><div style="font-size:9.5px;font-weight:800;color:var(--muted);margin-bottom:3px">RESPONSE BODY</div>
          <pre style="margin:0;max-height:230px;overflow:auto;background:var(--panel-dark);color:var(--panel-dark-fg);border-radius:8px;padding:8px;font-size:10px;line-height:1.45;white-space:pre-wrap;word-break:break-word">${r.response_body!=null?pretty(r.response_body):"(no body)"}</pre></div>
      </div></div>`;
    }).join("");
    host.innerHTML=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <span class="rl" style="font-size:11px">${rows.length} sample(s) · ${d.failOnly?"failures":"all calls"} · ${d.source==="stored"?"<b style='color:#0e9f5a'>stored history (30d, follows the time filter)</b>":"live log grep (recent hours only)"} · newest first${d.errors?` · <span style="color:#d97706">${esc(d.errors.join(" · "))}</span>`:""}</span>
        <span style="flex:1"></span>
        ${d.can_unmask?`<button class="pill" id="sampMask" style="padding:3px 10px;font-size:11px;border-left-color:${d.unmasked?"#94a3b8":"#dc2626"}">${d.unmasked?"Mask":"Unmask (audited)"}</button>`:""}
      </div>`
      +(cards||`<div class="rl" style="color:var(--good);font-weight:700">No ${d.failOnly?"failing ":""}calls for this endpoint in the recent log window ✓</div>`);
    host.querySelectorAll(".samp-an").forEach(b=>b.addEventListener("click",()=>{
      if(window.setConsoleHash) window.setConsoleHash("troubleshoot");
      setTimeout(()=>{ if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(b.dataset.txn); },300);
      if(window.audit) window.audit("API_SAMPLE_ANALYZE", b.dataset.txn);
    }));
    const sm=host.querySelector("#sampMask"); if(sm) sm.onclick=()=>renderApiSamples(failOnly, !d.unmasked);
  }

  /* ---- ③ App errors & IP rate-limiting (api_error_logger.production.log via SSH collector) ----
   * KPIs for the IpRetrial limiter: -704 blocks, unique IPs, LOW-RETRY blocks (blocked with ≤3
   * prior attempts = the gap-block flaw hitting one-shot users / shared CGNAT IPs), per-action
   * split, top blocked IPs — plus the general app error-code mix from the same log. */
  let monErrCat = "";                      // category drill-down filter for the app-errors panel
  let monErrFrom = "", monErrTo = "";      // custom date/time range (overrides the window buttons)
  const monErrRangeQS = () => (monErrFrom && monErrTo) ? `&from=${encodeURIComponent(monErrFrom)}&to=${encodeURIComponent(monErrTo)}` : "";
  async function renderAppErrors(){
    const box=$("#monAppErrors"); if(!box) return;
    if(!box.firstChild) box.innerHTML=`<div class="sub">Loading app error log…</div>`;
    let d; try{ d=await api(`/api/monitoring/app-errors?hours=${winH}${monErrRangeQS()}${monErrCat?`&cat=${encodeURIComponent(monErrCat)}`:""}`); }
    catch(e){ box.innerHTML=""; return; }   // route absent (old build) → hide quietly
    const rangeLbl = d.range ? `${KT.dt(d.range.from)} → ${KT.dt(d.range.to)} KSA` : `last ${d.hours||winH}h`;
    const head=`<div style="font-weight:800;font-size:13px;color:var(--ink);margin:4px 0 8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">④ ACCESS · APP ERRORS · IP RATE-LIMITING
      <span class="rl" style="font-weight:600" title="Source: the Rails app's own error log (ApiErrorLogger) on the API servers — application-layer errors returned to customers. NOT gateway logs: requests rejected at the APIGW never reach this log (gateway-log collector pending access).">· app-layer log (Rails on 17/18) → api_error_events · ${esc(rangeLbl)} <span style="cursor:help">ⓘ</span></span>
      <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
        <input type="datetime-local" id="monErrFrom" value="${esc(monErrFrom)}" style="padding:4px 6px;border:1px solid var(--line);border-radius:7px;background:var(--card2);color:var(--ink);font-size:11px">
        <span class="rl">→</span>
        <input type="datetime-local" id="monErrTo" value="${esc(monErrTo)}" style="padding:4px 6px;border:1px solid var(--line);border-radius:7px;background:var(--card2);color:var(--ink);font-size:11px">
        <button class="pill" id="monErrApply" style="padding:3px 10px;border-left-color:var(--green)">Apply</button>
        ${d.range?`<button class="pill" id="monErrClear" style="padding:3px 10px">✕ range</button>`:""}
      </span></div>`;
    const t=d.totals||{}, rl=d.rateLimit||{};
    if(!t.total){
      const c=d.collector||{}; const err=(c.hosts||[]).map(h=>h.lastError).filter(Boolean)[0];
      box.innerHTML=head+`<div style="border:1px dashed var(--line);border-radius:10px;padding:14px;background:var(--card)" class="rl">
        No app-error events in the window yet.${c.configured?` Collector armed (${(c.hosts||[]).length} hosts)${err?` — last error: ${esc(err)}`:""}.`:" Collector not configured (API_LOG_HOSTS)."}
        A quiet log is good news — this fills only when the app renders errors (incl. -704 rate-limit blocks).</div>`;
      return;
    }
    const chip=(label,val,color,title)=>`<div class="stat" title="${esc(title||"")}" style="min-width:130px"><b style="${color?`color:${color}`:""}">${val}</b><span>${esc(label)}</span></div>`;
    const lowShare = rl.blocks ? Math.round(100*(rl.low_retry_blocks||0)/rl.blocks) : 0;
    const chips=`<div class="topo-stats" style="margin-bottom:10px">
      ${chip("APP ERRORS · "+d.hours+"h", (t.total||0).toLocaleString(), null, "all api_error_logger events")}
      ${chip("RATE-LIMIT BLOCKS (-704)", (rl.blocks||0).toLocaleString(), rl.blocks?"#dc2626":"#16a34a", "IpRetrial IP_RETRIES_EXCEEDED")}
      ${chip("UNIQUE BLOCKED IPs", (rl.unique_ips||0).toLocaleString(), null, "distinct ip_address among -704 blocks")}
      ${chip("LOW-RETRY BLOCKS", `${(rl.low_retry_blocks||0).toLocaleString()} (${lowShare}%)`, rl.low_retry_blocks?"#d97706":"#16a34a", "blocked with ≤3 prior attempts — gap-block flaw / shared-IP signature")}
    </div>`;
    // ---- WHO WAS BLOCKED: search the limiter by customer or IP -----------------------------
    const ipSearch = `<div class="topo-card" style="margin-bottom:0;padding:10px 12px;background:var(--card,#fff)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <b style="font-size:12px">Who was blocked?</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">find the IP(s) a customer used and whether the limiter is holding them</span>
        <input id="ipqInput" placeholder="MSISDN, National ID or IP address" style="flex:1 1 260px;min-width:220px;font:inherit;font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
        <select id="ipqHours" style="font:inherit;font-size:12px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
          <option value="24">24h</option><option value="168" selected>7d</option><option value="720">30d</option>
        </select>
        <button id="ipqGo" class="btn" style="font-size:12px;padding:6px 14px">Search</button>
        <button id="ipqFresh" class="pill" title="Pull this customer's row from the source now, instead of waiting for the 30-minute sync" style="font-size:12px;padding:6px 12px">↻ Pull latest</button>
      </div>
      <div id="ipqOut" style="margin-top:8px"></div></div>`;
    /* ---- LOGIN FUNNEL: password → OTP → balance ------------------------------------------
     * The app writes its sign-in tracking when the PASSWORD is accepted and writes nothing at
     * all when the OTP is verified, so the only way to see the OTP drop-off is to compare the
     * two endpoints in the API log. That comparison is this panel. */
    const loginPanel = `<div class="topo-card" style="margin-bottom:10px;padding:10px 12px;background:var(--card,#fff)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
        <b style="font-size:12px">Login funnel</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">password → OTP → balance · where customers fall out of the sign-in</span>
        <span style="flex:1"></span>
        <select id="lgfHours" style="font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
          <option value="6">6h</option><option value="24" selected>24h</option><option value="72">3d</option><option value="168">7d</option>
        </select>
        <button id="lgfGo" class="btn" style="font-size:12px;padding:5px 12px">Refresh</button>
      </div>
      <div id="lgfOut"><div class="rl">loading…</div></div></div>`;
    // ---- daily history chart (since Aug 2026, independent of the window buttons) ----
    const H=d.history||{}, days=H.daily||[], ht=H.totals||{};
    let histPanel="";
    if(days.length){
      const W=980, HT=150, pl=40, pb=22, pt=10, pr=8;
      const maxV=Math.max(...days.map(x=>x.total),1);
      const bw=Math.max(3,Math.floor((W-pl-pr)/days.length)-2);
      const x=i=>pl+i*((W-pl-pr)/days.length);
      const y=v=>HT-pb-(v/maxV)*(HT-pb-pt);
      let g="";
      for(let i=0;i<=3;i++){ const yy=pt+(HT-pb-pt)*i/3; const val=Math.round(maxV-(maxV)*i/3);
        g+=`<line x1="${pl}" y1="${yy}" x2="${W-pr}" y2="${yy}" stroke="var(--line)" stroke-opacity=".4"/><text x="${pl-5}" y="${yy+3}" text-anchor="end" font-size="9" fill="var(--muted)">${val}</text>`; }
      days.forEach((r,i)=>{
        g+=`<rect x="${x(i)}" y="${y(r.total)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.total))}" fill="#94a3b8" opacity=".55"><title>${esc(String(r.day))}: ${r.total} errors</title></rect>`;
        if(r.rl_blocks) g+=`<rect x="${x(i)}" y="${y(r.rl_blocks)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.rl_blocks))}" fill="#dc2626" opacity=".85"><title>${esc(String(r.day))}: ${r.rl_blocks} rate-limit blocks · ${r.rl_ips} IPs</title></rect>`;
        const dd=String(r.day).slice(8,10);
        if(i%Math.ceil(days.length/20)===0) g+=`<text x="${x(i)+bw/2}" y="${HT-8}" text-anchor="middle" font-size="8.5" fill="var(--muted)">${dd}</text>`;
      });
      histPanel=`<div class="apanel" style="grid-column:span 12"><div class="ah"><b>Daily cases since ${esc(H.from||"Aug 2026")}
          <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· grey = all app errors · red = rate-limit blocks (-704) · total ${((ht.total||0)).toLocaleString()} / blocks ${((ht.rl_blocks||0)).toLocaleString()} / ${((ht.rl_ips||0)).toLocaleString()} IPs · data from ${esc(String(ht.oldest||"").slice(0,10)||"—")}</span></b></div>
        <div class="abody"><svg viewBox="0 0 ${W} ${HT}" style="width:100%;height:${HT}px">${g}</svg></div></div>`;
    }
    // category chips — clickable drill-down (filters the code table + audit)
    const catChips=(d.byCategory||[]).map(c=>`<button class="teamchip ${monErrCat===c.key?"active":""}" data-mcat="${esc(c.key)}"
      title="${esc(c.desc||"")}" style="border-left:3px solid ${esc(c.color)};${monErrCat===c.key?`background:${esc(c.color)};color:#fff`:""}">
      ${esc(c.label)} <b>${(c.n||0).toLocaleString()}</b>${c.cls==='technical'?' ⚠':''}</button>`).join("");
    const catBar=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
      <span class="rl" style="font-weight:700">Categories</span>
      <button class="teamchip ${monErrCat===""?"active":""}" data-mcat="">All</button>${catChips}
      <span class="rl" style="margin-left:auto">⚠ = technical class · from error_codes.rb (source-derived)</span></div>`;
    const codeRows=(d.byCode||[]).map(c=>`<tr class="mon-code-row" data-code="${esc(c.error_code)}" style="cursor:pointer" title="Click for recent occurrences + case drill">
      <td class="mono">${esc(c.error_code)}</td>
      <td class="mono" style="font-size:10.5px">${esc(c.constant||"—")}</td>
      <td><span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;background:${esc(c.cat_color)}22;color:${esc(c.cat_color)}">${esc(c.cat_label||"")}</span></td>
      <td>${(c.n||0).toLocaleString()}</td><td class="rl">${esc(c.meaning||c.sample||"")} <span style="color:var(--blue);font-size:10px;font-weight:700">→</span></td></tr>`).join("");
    // stacked hourly chart by category (48h) — the readability chart
    let catChart="";
    { const HBC=d.hourlyByCat||{}, CM=d.categories||{};
      const hoursK=Object.keys(HBC).sort();
      if(hoursK.length>1){
        const totalsByCat={}; hoursK.forEach(h=>Object.entries(HBC[h]).forEach(([k,n])=>totalsByCat[k]=(totalsByCat[k]||0)+n));
        const topCats=Object.entries(totalsByCat).sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]);
        const W=980,HT=120,pl=36,pb=16,pt=6;
        const maxH=Math.max(...hoursK.map(h=>Object.values(HBC[h]).reduce((a,b)=>a+b,0)),1);
        const bw=Math.max(4,Math.floor((W-pl)/hoursK.length)-2);
        const x=i=>pl+i*((W-pl)/hoursK.length);
        let g="";
        for(let i=0;i<=2;i++){ const yy=pt+(HT-pb-pt)*i/2; const val=Math.round(maxH-maxH*i/2);
          g+=`<line x1="${pl}" y1="${yy}" x2="${W-6}" y2="${yy}" stroke="var(--line)" stroke-opacity=".35"/><text x="${pl-5}" y="${yy+3}" text-anchor="end" font-size="8.5" fill="var(--muted)">${val}</text>`; }
        hoursK.forEach((h,i)=>{
          let y0=HT-pb;
          const total=Object.values(HBC[h]).reduce((a,b)=>a+b,0);
          for(const k of [...topCats,'__rest']){
            const n=k==='__rest'?(total-topCats.reduce((a,c2)=>a+(HBC[h][c2]||0),0)):(HBC[h][k]||0);
            if(!n) continue;
            const hgt=(n/maxH)*(HT-pb-pt); y0-=hgt;
            const col=k==='__rest'?'var(--line)':((CM[k]||{}).color||'#94a3b8');
            g+=`<rect x="${x(i)}" y="${y0}" width="${bw}" height="${Math.max(1,hgt)}" fill="${col}" opacity=".85"><title>${esc(KT.dt(h))} · ${esc(k==='__rest'?'other':((CM[k]||{}).label||k))}: ${n}</title></rect>`;
          }
          if(i%Math.ceil(hoursK.length/16)===0) g+=`<text x="${x(i)+bw/2}" y="${HT-4}" text-anchor="middle" font-size="7.5" fill="var(--muted)">${String(h).slice(11,13)}h</text>`;
        });
        const legend=topCats.map(k=>`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:10.5px"><i style="width:9px;height:9px;border-radius:2px;background:${(CM[k]||{}).color||'#94a3b8'};display:inline-block"></i>${esc((CM[k]||{}).label||k)}</span>`).join("")+`<span style="font-size:10.5px"><i style="width:9px;height:9px;border-radius:2px;background:var(--line);display:inline-block;margin-right:4px"></i>other</span>`;
        catChart=`<div class="apanel" style="grid-column:span 12"><div class="ah"><b>Hourly by category <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· last 48h · stacked · hover any segment</span></b></div>
          <div class="abody"><svg viewBox="0 0 ${W} ${HT}" style="width:100%;height:${HT}px">${g}</svg><div style="margin-top:6px">${legend}</div></div></div>`;
      } }
    const actRows=(rl.byAction||[]).map(a=>`<tr><td class="mono">${esc(a.action)}</td><td>${(a.n||0).toLocaleString()}</td></tr>`).join("");
    const ipRows=(rl.topIps||[]).map(i=>`<tr><td class="mono">${esc(i.ip_address)}</td><td>${(i.blocks||0).toLocaleString()}</td><td class="mono">${i.min_retry==null?"—":i.min_retry}–${i.max_retry==null?"—":i.max_retry}</td><td class="mono rl">${esc(KT.dt(i.last_at||""))}</td><td><button class="pill" data-unblk="${esc(i.ip_address)}" style="padding:2px 8px;font-size:10.5px;border-left-color:#0e9f5a">Unblock</button></td></tr>`).join("");
    // rate-limit deep panel: 48h hourly chart + live limiter settings + code-derived explanation
    const RLH=(rl.hourly||[]); let rlChart="";
    if(RLH.length>1){
      const W=760,HT=84,pl=30,pb=14,pt=6;
      const maxV=Math.max(...RLH.map(r=>r.blocks),1);
      const bw=Math.max(3,Math.floor((W-pl)/RLH.length)-2);
      const x=i=>pl+i*((W-pl)/RLH.length), y=v=>HT-pb-(v/maxV)*(HT-pb-pt);
      let g=""; RLH.forEach((r,i)=>{ g+=`<rect x="${x(i)}" y="${y(r.blocks)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.blocks))}" fill="#e11d48" opacity=".8"><title>${esc(KT.dt(r.h))}: ${r.blocks} blocks · ${r.ips} IPs</title></rect>`;
        if(i%Math.ceil(RLH.length/16)===0) g+=`<text x="${x(i)+bw/2}" y="${HT-3}" text-anchor="middle" font-size="7.5" fill="var(--muted)">${String(r.h).slice(11,13)}h</text>`; });
      rlChart=`<svg viewBox="0 0 ${W} ${HT}" style="width:100%;height:${HT}px">${g}</svg>`;
    }
    const st=(rl.settings||[]).map(s=>`<span class="t2-dep" style="font-family:var(--mono);font-size:10.5px;border:1px solid var(--line);border-radius:6px;padding:1px 7px;margin-right:6px">${esc(s.var)}=${esc(s.value)}</span>`).join("");
    const rlPanel=`<div class="apanel" style="grid-column:span 12"><div class="ah"><b>IP rate-limiting · 48h hourly blocks <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· source: IpRetrial concern (recharge voucher/validate)</span></b></div>
      <div class="abody">${rlChart||`<div class="rl">No blocks in the last 48h ✓</div>`}
        <div style="margin-top:8px">${st||""}</div>
        <div class="rl" style="margin-top:6px;line-height:1.55">${esc(rl.explain||"")}</div>
        <div style="margin-top:10px;padding-top:9px;border-top:1px dashed var(--line);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b style="font-size:11.5px">UNBLOCK AN IP</b>
          <input id="unblkIp" placeholder="e.g. 172.16.51.19" class="mono" style="padding:5px 8px;border:1px solid var(--line);border-radius:7px;background:var(--card2);color:var(--ink);font-size:11.5px;width:170px">
          <button class="pill" id="unblkCheck" style="padding:4px 10px">Check</button>
          <button class="pill" id="unblkGo" style="padding:4px 10px;border-left-color:#0e9f5a">Unblock</button>
          <span id="unblkOut" class="rl" style="font-size:11px"></span>
        </div></div></div>`;
    /* One tinted, titled block for everything login-related. The page is long and these two
       panels answer the same question from two sides, so they read as one section rather than
       two cards that happen to sit next to each other. */
    const loginSection = `<section style="border:1px solid rgba(14,159,90,.35);border-radius:14px;padding:12px;margin-bottom:12px;
        background:linear-gradient(180deg,rgba(14,159,90,.09),rgba(14,159,90,.025))">
      <div style="display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;margin-bottom:9px">
        <span style="font-weight:800;font-size:11px;letter-spacing:.06em;color:#0e9f5a;border:1px solid #0e9f5a;border-radius:999px;padding:2px 10px">LOGIN &amp; ACCESS</span>
        <b style="font-size:12.5px">Who signed in, where sign-ins fail, and who the limiter is holding</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">accepted passwords are counted from the app’s own sign-in tracking · replica synced every 30 min</span>
      </div>
      ${loginPanel}${ipSearch}</section>`;
    box.innerHTML=head+chips+loginSection+catBar+`<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:12px">
      ${catChart}
      ${histPanel}
      <div class="apanel" style="grid-column:span 6;min-width:300px"><div class="ah"><b>Error codes${monErrCat?` · ${esc(monErrCat)}`:""} <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· constant + meaning from source</span></b></div>
        <div class="abody">${codeRows?`<table class="alerts"><tr><th>CODE</th><th>CONSTANT</th><th>CATEGORY</th><th>N</th><th>MEANING / SAMPLE</th></tr>${codeRows}</table>`:`<div class="rl">—</div>`}</div></div>
      <div class="apanel" style="grid-column:span 2;min-width:170px"><div class="ah"><b>Blocks by action</b></div>
        <div class="abody">${actRows?`<table class="alerts"><tr><th>ACTION</th><th>BLOCKS</th></tr>${actRows}</table>`:`<div class="rl">No rate-limit blocks ✓</div>`}</div></div>
      <div class="apanel" style="grid-column:span 4;min-width:260px"><div class="ah"><b>Top blocked IPs <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· retry range shows gap-block victims (min 1)</span></b></div>
        <div class="abody">${ipRows?`<table class="alerts"><tr><th>IP</th><th>BLOCKS</th><th>RETRIES</th><th>LAST</th><th></th></tr>${ipRows}</table>`:`<div class="rl">—</div>`}</div></div>
      ${rlPanel}
    </div>`;
    /* ---- login funnel: the three endpoints a sign-in touches, and the OTP drop-off ---- */
    (function wireLoginFunnel(){
      const sel=box.querySelector("#lgfHours"), go=box.querySelector("#lgfGo"), out=box.querySelector("#lgfOut");
      if(!sel||!out) return;
      const num=n=>(n==null?"—":Number(n).toLocaleString());
      const draw=d=>{
        const S=d.steps||[], D=d.drop||null;
        const stepCard=s=>{
          const okc=s.ok_pct==null?"var(--muted)":(s.ok_pct>=95?"#16a34a":s.ok_pct>=85?"#d97706":"#dc2626");
          const codes=(s.codes||[]).filter(c=>!c.ok).slice(0,5).map(c=>
            `<div class="rl" style="font-size:10.5px;white-space:nowrap" title="${esc(c.hint||"")}">
               <span class="mono" style="color:${c.cls==="technical"?"#dc2626":"var(--warn-fg)"}">${esc(c.code)}</span>
               ${esc(c.label||"")} <b>${num(c.n)}</b></div>`).join("")
            || `<div class="rl" style="font-size:10.5px;color:var(--good)">no failures</div>`;
          /* A step whose successes are not recorded anywhere must SAY SO. Printing 0 there would
             read as "nobody completed the OTP", which is a measurement gap, not a fact. */
          const headline=s.not_measured
            ? `<div style="font-size:13px;font-weight:800;line-height:1.3;color:var(--muted)">not measured</div>
               <div class="rl" style="font-size:10.5px;margin-bottom:4px">${num(s.fail)} failures visible</div>`
            : `<div style="font-size:19px;font-weight:800;line-height:1.1">${num(s.total)}</div>
               <div class="rl" style="font-size:10.5px;margin-bottom:4px">success <b style="color:${okc}">${s.ok_pct==null?"—":s.ok_pct+"%"}</b>
                 <span style="color:var(--muted)">(${num(s.ok)} ok · ${num(s.fail)} failed)</span></div>`;
          return `<div style="flex:1 1 200px;min-width:190px;border:1px solid var(--line);border-radius:10px;padding:8px 10px">
            <div style="font-size:11px;font-weight:800">${esc(s.label)}</div>
            <div class="rl" style="font-size:10px;color:var(--muted);white-space:normal;margin-bottom:4px">${esc(s.note)}</div>
            ${headline}${codes}
            ${s.source?`<div class="rl" style="font-size:9.5px;color:var(--muted);margin-top:3px">source: ${esc(s.source)}</div>`:""}</div>`;
        };
        const dropCard=D?`<div style="flex:1 1 210px;min-width:200px;border:1px solid var(--line);border-radius:10px;padding:8px 10px">
            <div style="font-size:11px;font-weight:800">Sign-in outcome</div>
            <div class="rl" style="font-size:10px;color:var(--muted);white-space:normal;margin-bottom:4px">what the platform does and does not record</div>
            <div style="font-size:19px;font-weight:800;line-height:1.1">${num(D.passwords_accepted)}</div>
            <div class="rl" style="font-size:10.5px;margin-bottom:4px">passwords accepted</div>
            <div class="rl" style="font-size:10.5px;color:var(--muted)">failed at password: <b>${num(D.password_failures)}</b></div>
            <div class="rl" style="font-size:10.5px;color:var(--muted)">wrong OTP entered: <b>${num(D.wrong_otp)}</b></div>
            <div class="rl" style="font-size:10.5px;color:var(--warn-fg);white-space:normal;margin-top:4px">
              Abandoned at OTP: <b>not computable</b></div>
            <div class="rl" style="font-size:10px;color:var(--muted);white-space:normal">${esc(D.why_not||"")}</div>
          </div>`:"";
        const otpMode=d.otp_required===false
          ? `<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:5px">• OTP on login is currently <b>OFF</b> (Setting.login_otp = false) — an accepted password issues a token immediately.</div>`
          : d.otp_required===true
          ? `<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:5px">• OTP on login is <b>ON</b> (Setting.login_otp = true), for clients sending the new-registration flag.</div>`
          : "";
        out.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch">${S.map(stepCard).join("")}${dropCard}</div>${otpMode}
          ${(d.notes||[]).map(n=>`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:5px;white-space:normal">• ${esc(n)}</div>`).join("")}`;
      };
      const run=async()=>{
        out.innerHTML=`<div class="rl">loading…</div>`;
        try{ draw(await api(`/api/login/funnel?hours=${encodeURIComponent(sel.value)}`)); }
        catch(e){ out.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; }
      };
      if(go) go.addEventListener("click",run);
      sel.addEventListener("change",run);
      run();
    })();

    /* ---- who was blocked: customer / IP → the IPs they used and the limiter's verdict ---- */
    (function wireIpSearch(){
      const inp=box.querySelector("#ipqInput"), go=box.querySelector("#ipqGo"),
            hrs=box.querySelector("#ipqHours"), out=box.querySelector("#ipqOut"),
            fresh=box.querySelector("#ipqFresh");
      if(!inp||!go||!out) return;
      const run=async()=>{
        const q=inp.value.trim(); if(!q) return;
        out.innerHTML=`<div class="rl">searching…</div>`;
        let d, L=null;
        try{
          /* both lookups in parallel — the limiter view and the login view answer different
             halves of "what happened to this customer", and they read different databases */
          const [a,b]=await Promise.all([
            api(`/api/monitoring/ip-search?q=${encodeURIComponent(q)}&hours=${encodeURIComponent(hrs.value)}`),
            api(`/api/login/state?q=${encodeURIComponent(q)}`).catch(()=>null)
          ]);
          d=a; L=b;
        }
        catch(e){ out.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
        if(window.audit) window.audit("IP_SEARCH", q.slice(0,24));
        /* LOGIN CARD — what the app actually recorded for this subscriber, and what it proves.
           Deliberately never a bare yes/no: the platform issues one-year tokens and keeps no
           session, so "logged in right now" is not a fact that exists to be read. */
        const loginCard=(()=>{
          if(!L||!L.verdict) return "";
          const V=L.verdict, F=L.freshness||{};
          const col=V.state==="authenticating-now"?"#16a34a":V.state==="recent"?"#0e9f5a":
                    V.state==="idle"?"#64748b":V.state==="never"?"var(--warn-fg)":"#dc2626";
          /* "SIGNED IN TODAY" was read as "is logged in right now" — which is precisely the claim
             the platform cannot support (1-year tokens, no session table, no write on logout).
             The label now names the EVENT that was recorded, not a state. */
          const lbl=V.state==="authenticating-now"?"AUTHENTICATED JUST NOW":V.state==="recent"?"LAST AUTHENTICATED TODAY":
                    V.state==="idle"?"LAST AUTHENTICATED EARLIER":V.state==="never"?"NEVER AUTHENTICATED":"NOT OBSERVABLE";
          const lineRows=(L.lines||[]).map(l=>`<tr>
              <td class="mono">${esc(l.mobile||"—")}</td>
              <td>${l.last_auth_at?esc(KT.dt(l.last_auth_at)):"—"}</td>
              <td>${l.sign_in_count==null?"—":Number(l.sign_in_count).toLocaleString()}</td>
              <td class="mono">${esc(l.ip||"—")}</td>
              <td style="font-size:10.5px">${esc([l.platform,l.app_version].filter(Boolean).join(" ")||"—")}</td></tr>`).join("");
          const ev=(L.evidence||[]).map(e=>`<div class="rl" style="font-size:10.5px;color:var(--muted);white-space:normal">
              • ${esc(e.kind)} ${esc(KT.dt(e.at))} — ${esc(e.detail)} <i>${esc(e.proves||"")}</i></div>`).join("");
          const fresh=`<div class="rl" style="font-size:10.5px;white-space:normal;margin-top:4px;color:${F.users_in_sync?"var(--muted)":"var(--warn-fg)"}">
              <b>Data feed:</b> ${esc(F.verdict||"")}</div>`;
          return `<div style="border:1px solid ${col};border-radius:10px;padding:8px 10px;margin-bottom:8px">
            <div><span style="font-weight:800;color:${col};border:1px solid ${col};border-radius:999px;padding:1px 9px;font-size:10px;letter-spacing:.04em">${lbl}</span>
              <b style="margin-left:7px;font-size:12px">${esc(V.headline||"")}</b></div>
            <div class="rl" style="font-size:10.5px;color:var(--muted);white-space:normal;margin-top:3px">${esc(V.why||"")}</div>
            ${V.not_a_session?`<div class="rl" style="font-size:10.5px;color:var(--warn-fg);white-space:normal">${esc(V.not_a_session)}</div>`:""}
            ${V.token?`<div class="rl" style="font-size:10.5px;color:var(--muted);white-space:normal">${esc(V.token)}</div>`:""}
            ${V.fix?`<div class="rl" style="font-size:10.5px;color:var(--warn-fg);white-space:normal">Fix: ${esc(V.fix)}</div>`:""}
            ${lineRows?`<table class="alerts" style="margin-top:6px"><tr><th>LINE</th><th>PASSWORD ACCEPTED (KSA)</th><th>SIGN-INS</th><th>IP</th><th>DEVICE</th></tr>${lineRows}</table>`:""}
            ${ev}${fresh}
            ${(L.notes||[]).map(n=>`<div class="rl" style="font-size:10.5px;color:var(--muted);white-space:normal">• ${esc(n)}</div>`).join("")}
          </div>`;
        })();
        const notes=(d.notes||[]).map(n=>`<div class="rl" style="color:var(--muted);font-size:11px">• ${esc(n)}</div>`).join("");
        const stale=(d.customer&&d.customer.last_login_age_days>30);
        const cust=d.customer?`<div class="rl" style="font-size:11.5px;margin-bottom:6px">Customer <b>${esc(d.customer.mobile||"—")}</b>
          · ${esc(d.customer.platform||"—")} · ${d.customer.sign_in_count||0} sign-ins
          ${d.customer.last_login_at?`· stored sign-in <b${stale?' style="color:#d97706"':''}>${esc(KT.dt(d.customer.last_login_at))}</b>
            <span style="color:var(--muted);font-size:10px">(${esc(d.customer.last_login_source||"")}${(d.tracking&&d.tracking.users_table_synced===false)?" · users snapshot, not live":(stale?` · ${d.customer.last_login_age_days}d old`:"")})</span>`
            :`· <span style="color:var(--muted)">no sign-in timestamp on file</span>`}</div>`:"";
        const S=d.session;
        const sPill=S?(()=>{
          const col=S.verdict.startsWith('active now')?'var(--good)':(S.verdict.startsWith('session may')?'#d97706':'#64748b');
          const lbl=S.verdict.startsWith('active now')?'LOGGED IN NOW':(S.verdict.startsWith('session may')?'SESSION MAY BE LIVE':(S.verdict.startsWith('no recent')?'NOT LOGGED IN':'UNKNOWN'));
          const ago=S.age_minutes==null?'':(S.age_minutes<60?`${S.age_minutes}m ago`:(S.age_minutes<1440?`${Math.round(S.age_minutes/60)}h ago`:`${Math.round(S.age_minutes/1440)}d ago`));
          return `<div class="rl" style="font-size:11.5px;margin-bottom:6px">
            <span style="font-weight:800;color:${col};border:1px solid ${col};border-radius:999px;padding:1px 9px;font-size:10px;letter-spacing:.04em">${lbl}</span>
            ${S.last_activity_at?`<span style="margin-left:6px">last authenticated activity <b>${esc(KT.dt(S.last_activity_at))}</b> (${ago})</span>`:''}
            ${(S.evidence||[]).length?`<span style="color:var(--muted)"> · ${S.evidence.map(e=>esc(e.kind+': '+e.detail)).join(' · ')}</span>`:''}
            <div style="color:var(--muted);font-size:10px">${esc(S.basis)}</div></div>`;
        })():"";
        const lines=(d.lines&&d.lines.length>1)?`<div class="rl" style="font-size:11px;margin-bottom:6px">Lines under this identity: `+
          d.lines.map(l=>`<b>${esc(l.mobile)}</b> <span style="color:var(--muted)">(${l.sign_in_count||0} sign-ins${l.last_sign_in?` · ${esc(KT.d(l.last_sign_in))}`:""})</span>`).join(" · ")+`</div>`:"";
        if(!(d.ips||[]).length){ out.innerHTML=loginCard+cust+sPill+lines+notes+`<div class="rl">No IP could be checked for that input.</div>`; return; }
        const rows=d.ips.map(x=>{
          const st=x.private
            ? `<span style="color:var(--muted);font-weight:700">not checkable</span>`
            : (x.blocked_now
              ? `<span style="color:#dc2626;font-weight:800">BLOCKED NOW</span>`
              : (x.blocks ? `<span style="color:#d97706;font-weight:700">was blocked</span>` : `<span style="color:var(--good);font-weight:700">never blocked</span>`));
          const acts=(x.by_action||[]).map(a=>`${esc(a.act)} ${a.n}`).join(" · ")||"—";
          const ttl=(x.live&&x.live.keys&&x.live.keys.length)
            ? x.live.keys.map(k=>`${esc(k.action)}${k.ttl_seconds>0?` (${Math.round(k.ttl_seconds/3600)}h left)`:""}`).join(" · ") : "";
          return `<tr>
            <td class="mono">${esc(x.ip)}<div class="rl" style="font-size:10px;color:var(--muted)">${esc(x.source)}</div>
              ${x.note?`<div class="rl" style="font-size:10px;color:var(--warn-fg);max-width:280px;white-space:normal">⚠ ${esc(x.note)}</div>`:""}</td>
            <td>${st}${ttl?`<div class="rl" style="font-size:10px;color:var(--muted)">${ttl}</div>`:""}</td>
            <td>${(x.blocks||0).toLocaleString()}</td>
            <td>${x.retries||"—"}</td>
            <td>${(x.errors||0).toLocaleString()}</td>
            <td>${x.last_block?esc(KT.dt(x.last_block)):"—"}</td>
            <td style="font-size:10.5px">${esc(acts)}</td>
            <td>${x.blocked_now?`<button class="btn ipq-unb" data-ip="${esc(x.ip)}" style="font-size:11px;padding:3px 10px">Unblock</button>`:""}</td></tr>`;
        }).join("");
        out.innerHTML=loginCard+cust+sPill+lines+notes+`<table class="alerts" style="margin-top:4px">
          <tr><th>IP</th><th>LIMITER</th><th>BLOCKS</th><th>RETRIES</th><th>ERRORS</th><th>LAST BLOCK (KSA)</th><th>ACTIONS BLOCKED</th><th></th></tr>${rows}</table>
          <div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:6px">Blocks come from the app error log (-704); “BLOCKED NOW” is read live from the limiter’s Redis keys. The error log stores no customer id, so a customer is matched through the IP the app recorded at sign-in.</div>`;
        out.querySelectorAll(".ipq-unb").forEach(b=>b.addEventListener("click",async()=>{
          b.disabled=true; b.textContent="…";
          try{ await api("/api/monitoring/ip-unblock",{method:"POST",body:JSON.stringify({ip:b.dataset.ip})}); run(); }
          catch(e){ b.disabled=false; b.textContent="Unblock"; alert(e.message); }
        }));
      };
      go.addEventListener("click",run);
      inp.addEventListener("keydown",e=>{ if(e.key==="Enter") run(); });
      /* Pull this one customer's row from the source, then re-run the search. Removes the
         "log in → wait 30 minutes → still nothing → is it broken?" loop entirely. */
      if(fresh) fresh.addEventListener("click",async()=>{
        const q=inp.value.trim(); if(!q) return;
        const label=fresh.textContent; fresh.disabled=true; fresh.textContent="pulling…";
        try{
          const r=await api("/api/login/refresh",{method:"POST",body:JSON.stringify({q})});
          fresh.textContent=`↻ ${r.rows||0} row${r.rows===1?"":"s"}`;
          await run();
        }catch(e){ out.innerHTML=`<div class="albanner">${esc(e.message)}</div>`+out.innerHTML; }
        finally{ setTimeout(()=>{ fresh.disabled=false; fresh.textContent=label; },2500); }
      });
    })();
    box.querySelectorAll("[data-mcat]").forEach(b=>b.addEventListener("click",()=>{
      monErrCat=b.dataset.mcat||""; if(window.audit) window.audit("APPLY_FILTER","monitoring:app-errors-cat:"+(monErrCat||"all")); renderAppErrors();
    }));
    /* ---- IP unblock (IpRetrial Redis keys; super_admin enforced server-side) ---- */
    const unblkOut=box.querySelector("#unblkOut");
    const say=(t,ok)=>{ if(unblkOut){ unblkOut.textContent=t; unblkOut.style.color=ok?"#0e9f5a":"#dc2626"; } };
    const ipVal=()=>((box.querySelector("#unblkIp")||{}).value||"").trim();
    async function unblkStatus(ip){
      const d=await api("/api/monitoring/ip-block?ip="+encodeURIComponent(ip));
      if(!d.configured) return say("not configured — set IPRL_REDIS_URL (see env.template) and redeploy",false);
      if(d.error) return say(d.error,false);
      if(!d.tracked) return say(ip+" is not tracked — no limiter keys, nothing to unblock",true);
      say(ip+" tracked: "+d.keys.map(k=>`${k.action}${k.expires_human?` (expires ${k.expires_human})`:""}`).join(" · "),false);
    }
    async function unblkDo(ip){
      if(!confirm(`Unblock ${ip}?\nThis deletes its IpRetrial limiter keys — the IP can immediately retry recharge validation.`)) return;
      const d=await api("/api/monitoring/ip-unblock",{method:"POST",body:JSON.stringify({ip})});
      if(!d.configured) return say("not configured — set IPRL_REDIS_URL and redeploy",false);
      if(d.error) return say(d.error,false);
      say(d.deleted?`✓ ${ip} unblocked — ${d.deleted} key(s) removed (audited)`:`${ip} had no limiter keys — already clear`,true);
      if(window.audit) window.audit("IP_UNBLOCK_UI", ip);
    }
    const bc=box.querySelector("#unblkCheck"); if(bc) bc.addEventListener("click",()=>{ const ip=ipVal(); if(ip) unblkStatus(ip).catch(e=>say(e.message,false)); });
    const bg=box.querySelector("#unblkGo"); if(bg) bg.addEventListener("click",()=>{ const ip=ipVal(); if(ip) unblkDo(ip).catch(e=>say(e.message,false)); });
    box.querySelectorAll("[data-unblk]").forEach(b=>b.addEventListener("click",()=>{
      const inp=box.querySelector("#unblkIp"); if(inp) inp.value=b.dataset.unblk;
      unblkDo(b.dataset.unblk).catch(e=>say(e.message,false));
    }));
    box.querySelectorAll(".mon-code-row").forEach(r=>r.addEventListener("click",()=>openErrDrill(Number(r.dataset.code))));
    const ap=box.querySelector("#monErrApply"); if(ap) ap.addEventListener("click",()=>{
      const f=box.querySelector("#monErrFrom").value, t=box.querySelector("#monErrTo").value;
      if(f&&t&&f<t){ monErrFrom=f; monErrTo=t; if(window.audit) window.audit("APPLY_FILTER","monitoring:app-errors-range"); renderAppErrors(); }
    });
    const cl=box.querySelector("#monErrClear"); if(cl) cl.addEventListener("click",()=>{ monErrFrom=""; monErrTo=""; renderAppErrors(); });
  }

  /* ---- per-code drill modal: recent occurrences → Case analyzer / Troubleshoot correlation ---- */
  const CAT2TS={ nafath:"nafath", payment:"payment", eligibility:"eligibility", backend:"activation" };  // app-cat → Troubleshoot tile
  async function openErrDrill(code){
    const card=document.getElementById("panelModalCard"); if(!card) return;
    card.innerHTML=`<div class="modal-head"><span class="path">App error ${esc(code)} · recent occurrences</span><span class="x" id="medX">×</span></div>
      <div class="modal-body">${window.salamLoader?window.salamLoader("Loading occurrences…"):"Loading…"}</div>`;
    document.getElementById("panelModal").classList.add("open");
    document.getElementById("medX").onclick=()=>document.getElementById("panelModal").classList.remove("open");
    let d; try{ d=await api(`/api/monitoring/app-errors/drill?code=${encodeURIComponent(code)}&hours=${winH}${monErrRangeQS()}`); }
    catch(e){ card.querySelector(".modal-body").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const ds=d.describe||{};
    const tsCat=CAT2TS[ds.category]||"";
    let h=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;margin-bottom:8px">
      <div><b class="mono">${esc(ds.constant||code)}</b> <span class="rl">· ${esc(ds.category_label||"")} (${esc(ds.class||"")})</span>
        <div class="rl" style="margin-top:2px">${esc(ds.message||"")}</div></div>
      <button class="pill" id="medTS" style="border-left-color:var(--blue)">Open Troubleshoot${tsCat?` · ${esc(tsCat)}`:""} ↗</button></div>`;
    // mini 48h trend for this code
    const HH=d.hourly||[];
    if(HH.length>1){ const W=680,HT=64,pl=26,pb=12,pt=4;
      const maxV=Math.max(...HH.map(r=>r.n),1); const bw=Math.max(3,Math.floor((W-pl)/HH.length)-2);
      const x=i=>pl+i*((W-pl)/HH.length), y=v=>HT-pb-(v/maxV)*(HT-pb-pt);
      let g=""; HH.forEach((r,i)=>{ g+=`<rect x="${x(i)}" y="${y(r.n)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.n))}" fill="${esc((ds.class==='technical')?'#ef4444':'#3b82f6')}" opacity=".8"><title>${esc(KT.dt(r.h))}: ${r.n}</title></rect>`; });
      h+=`<svg viewBox="0 0 ${W} ${HT}" style="width:100%;height:${HT}px">${g}</svg>`; }
    h+=`<div style="display:flex;margin-top:8px">${monExportBtn("medX")}</div>
      <table class="alerts msort" id="medTbl" style="margin-top:4px"><tr><th>WHEN</th><th>ENDPOINT</th><th>PLATFORM</th><th>MESSAGE</th><th></th></tr>
      ${(d.entries||[]).map(e2=>`<tr>
        <td class="mono">${esc(KT.dts(e2.ts||""))}</td>
        <td class="mono" style="font-size:10.5px">${esc(((e2.controller||"").replace("Api::","")+"#"+(e2.action||"")))}</td>
        <td class="mono">${esc(e2.platform||"—")}${e2.app_version?` v${esc(e2.app_version)}`:""}</td>
        <td class="rl">${esc((e2.message||e2.exception_class||"").slice(0,60))}</td>
        <td>${e2.trace_id?`<button class="pill med-case" data-tr="${esc(e2.trace_id)}" style="padding:2px 8px" title="Full case: all events for this trace + known-case diagnosis">🔎 case</button>`:""}</td>
      </tr>`).join("")}</table>
      <div class="rl" style="margin-top:8px">🔎 case = all backend events for that customer's trace (the app dialog's "Device ID") with the known-case diagnosis. "Open Troubleshoot" maps this category to the journey board on the same window for the request/response timelines.</div>`;
    card.querySelector(".modal-body").innerHTML=h;
    const mt=card.querySelector("#medTbl"); if(mt) monSortable(mt);
    const mx=card.querySelector("#medX"); if(mx) mx.onclick=()=>monExport(mt,`app_errors_${String(code).replace(/[^\w-]/g,"_")}`,{code:String(code)});
    card.querySelectorAll(".med-case").forEach(b=>b.addEventListener("click",()=>{
      document.getElementById("panelModal").classList.remove("open");
      if(window.setConsoleHash) window.setConsoleHash("troubleshoot");
      setTimeout(()=>{ if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(b.dataset.tr); },300);
    }));
    const tsB=card.querySelector("#medTS"); if(tsB) tsB.addEventListener("click",()=>{
      document.getElementById("panelModal").classList.remove("open");
      if(window.opsGoTroubleshoot) window.opsGoTroubleshoot({ hours:winH, cls:(ds.class==='technical'?'technical':''), cat:tsCat });
    });
  }

  /* ---- ④ SMS / notifications (Unifonic) ----
   * The app records NO SMS gateway response (Sms::Base discards it), so health = three proxies:
   * OTP funnel from the replica (sent→verified), the live sms_vendor, and the reachability
   * probe (curl executed FROM the API hosts over the collector SSH channel). */
  async function renderSms(){
    const box=$("#monSms"); if(!box) return;
    if(!box.firstChild) box.innerHTML=`<div class="sub">Loading SMS health…</div>`;
    let d; try{ d=await api(`/api/monitoring/sms-health?window=${winH}`); }
    catch(e){ box.innerHTML=""; return; }   // old build → hide
    const head=`<div style="font-weight:800;font-size:13px;color:var(--ink);margin:4px 0 8px">⑤ SMS · NOTIFICATIONS (UNIFONIC)
      <span class="rl" style="font-weight:600">· OTP funnel (replica) + gateway reachability from the API hosts · last ${d.hours||winH}h</span></div>`;
    const o=d.otp||{};
    const vr=o.sent?Math.round(100*(o.verified||0)/o.sent):null;
    const vrColor=vr==null?"var(--muted)":vr>=70?"#10b981":vr>=50?"#d97706":"#dc2626";
    /* KPI tiles are now doors: each one that maps to a set of recipients opens that list, so
       "8,904 sent" becomes "which numbers" without leaving the page. */
    const chip=(label,val,color,title,bucket)=>`<div class="stat${bucket?" sms-kpi":""}" ${bucket?`data-bucket="${bucket}" role="button" tabindex="0"`:""}
      title="${esc(title||"")}${bucket?" · click for the recipients":""}" style="min-width:128px${bucket?";cursor:pointer":""}">
      <b style="${color?`color:${color}`:""}">${val}</b><span>${esc(label)}${bucket?' <span style="opacity:.5">›</span>':""}</span></div>`;
    const chips=`<div class="topo-stats" style="margin-bottom:10px">
      ${chip("OTP SMS SENT",(o.sent||0).toLocaleString(),null,"otps created (delivery_method=sms)","sent")}
      ${chip("VERIFIED",(o.verified||0).toLocaleString(),"#10b981","customer received the SMS and entered the code","verified")}
      ${chip("VERIFY RATE",vr==null?"—":vr+"%",vrColor,"verified ÷ sent — a drop = delivery problem")}
      ${chip("AVG TIME-TO-VERIFY",o.avg_verify_secs!=null?o.avg_verify_secs+"s":"—",null,"created → verified")}
      ${chip("NEVER ENTERED",((o.sent||0)-(o.verified||0)).toLocaleString(),"#d97706","sent but never verified — non-delivery or abandonment","unverified")}
      ${chip("RETRY STORMS",(o.storm_targets||0).toLocaleString(),o.storm_targets?"#d97706":"#16a34a","targets with ≥3 OTPs in the window — customers not receiving SMS","storm")}
    </div>`;
    /* Per-customer SMS history. The platform stores no SMS body, so this searches the one SMS
       type it does record (OTP) and rebuilds the text from the app's own templates. */
    const smsSearch=`<div class="topo-card" style="padding:10px 12px;margin-bottom:10px;background:var(--card,#fff)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <b style="font-size:12px">SMS history</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">every OTP message we recorded for one customer — content, timing and outcome</span>
        <input id="smsQ" placeholder="MSISDN or National ID" style="flex:1 1 240px;min-width:200px;font:inherit;font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
        <button id="smsGo" class="btn" style="font-size:12px;padding:6px 14px">Search</button>
      </div>
      <div id="smsOut" style="margin-top:8px"></div></div>`;
    // vendor line
    const V=d.vendors||[]; const cur=V.find(v=>v.enabled);
    const vendorLine=`<div class="rl" style="margin-bottom:10px">Active SMS vendor:
      <b>${cur?esc(cur.klass_name.replace('Sms::','')):"unknown"}</b>${cur?` <span style="color:var(--muted)">· since ${esc(KT.dt(cur.updated_at||""))}</span>`:""}
      ${V.filter(v=>!v.enabled).map(v=>` · <span style="color:var(--muted)">${esc(v.klass_name.replace('Sms::',''))} (standby)</span>`).join("")}</div>`;
    // probe card
    const ps=d.probeStatus||{}, pr=d.probe||{}, sum=pr.summary||{};
    let probeHtml;
    if(!ps.configured){
      probeHtml=`<div style="border:1px dashed var(--line);border-radius:10px;padding:12px;background:var(--card)" class="rl">
        Reachability probe not configured — set <span class="mono">SMS_PROBE_URL</span> (the Unifonic base URL from the app credentials) on the console and restart. The probe curls the gateway FROM the API hosts every few minutes.</div>`;
    } else {
      const up=sum.checks?Math.round(100*(sum.reachable||0)/sum.checks):null;
      const rows=(pr.rows||[]).map(r=>`<tr><td class="mono">${esc(r.host)}</td>
        <td style="color:${r.http_code!=null?"#10b981":"#dc2626"};font-weight:700">${r.http_code!=null?esc(r.http_code):"DOWN"}</td>
        <td class="mono">${r.ms!=null?r.ms+" ms":"—"}</td><td class="rl">${esc(r.error||"")}</td>
        <td class="mono rl">${esc(KT.dts(r.ts||""))}</td></tr>`).join("");
      probeHtml=`<div class="apanel"><div class="ah"><b>Gateway reachability <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· ${esc(ps.url||"")} · 24h uptime ${up==null?"—":up+"%"} · avg ${sum.avg_ms!=null?sum.avg_ms+" ms":"—"} · any HTTP answer = reachable</span></b></div>
        <div class="abody">${rows?`<table class="alerts"><tr><th>FROM HOST</th><th>RESULT</th><th>LATENCY</th><th>ERROR</th><th>AT</th></tr>${rows}</table>`:`<div class="rl">No probe results yet (first cycle runs ~25s after boot).</div>`}</div></div>`;
    }
    // hourly sent/verified chart
    const Hh=d.hourly||[]; let chart="";
    if(Hh.length>1){
      const W=760,HT=90,pl=34,pb=14,pt=6;
      const maxV=Math.max(...Hh.map(r=>r.sent),1);
      const bw=Math.max(3,Math.floor((W-pl)/Hh.length)-2);
      const x=i=>pl+i*((W-pl)/Hh.length), y=v=>HT-pb-(v/maxV)*(HT-pb-pt);
      let g="";
      Hh.forEach((r,i)=>{ g+=`<rect x="${x(i)}" y="${y(r.sent)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.sent))}" fill="#94a3b8" opacity=".5"><title>${esc(KT.dt(r.h))}: sent ${r.sent}</title></rect>
        <rect x="${x(i)}" y="${y(r.verified)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.verified))}" fill="#10b981" opacity=".85"><title>verified ${r.verified}</title></rect>`; });
      chart=`<div class="apanel" style="margin-top:12px"><div class="ah"><b>OTP sent vs verified <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· hourly · grey = sent · green = verified — the gap is non-delivery + abandonment</span></b></div>
        <div class="abody"><svg viewBox="0 0 ${W} ${HT}" style="width:100%;max-width:780px;height:${HT}px">${g}</svg></div></div>`;
    }
    box.innerHTML=head+chips+smsSearch+vendorLine+probeHtml+chart;
    wireSms(box);
  }

  /* ---- SMS: per-customer history + recipient lists behind the KPI tiles ---- */
  const SMS_ST={ verified:{c:"#10b981",t:"VERIFIED"}, "expired-unverified":{c:"#d97706",t:"NEVER ENTERED"},
                 "awaiting-entry":{c:"#3b82f6",t:"AWAITING CODE"},
                 /* a login OTP leaves no row, so "was it entered" is unknowable — say that, don't
                    borrow one of the outcomes above and imply we checked */
                 "sent-login":{c:"#2563eb",t:"LOGIN OTP · SENT"} };
  function wireSms(box){
    const inp=box.querySelector("#smsQ"), go=box.querySelector("#smsGo"), out=box.querySelector("#smsOut");

    const runSearch=async()=>{
      const q=(inp&&inp.value||"").trim(); if(!q||!out) return;
      out.innerHTML=`<div class="rl">searching…</div>`;
      let d; try{ d=await api(`/api/sms/search?q=${encodeURIComponent(q)}`); }
      catch(e){ out.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
      if(window.audit) window.audit("SMS_SEARCH", q.slice(0,24));
      const T=d.totals||{};
      const notes=(d.notes||[]).map(n=>`<div class="rl" style="font-size:10.5px;color:var(--muted);white-space:normal">• ${esc(n)}</div>`).join("");
      if(!(d.rows||[]).length){ out.innerHTML=notes+`<div class="rl" style="margin-top:4px">No OTP messages on record for that input.</div>`; return; }
      const sum=`<div class="rl" style="font-size:11.5px;margin-bottom:6px">
        <b>${num(T.total)}</b> OTP messages${q?` for <b>${esc(q)}</b>`:""} ·
        <span style="color:#10b981">${num(T.verified)} verified</span> ·
        <span style="color:#d97706">${num(T.expired)} never entered</span>
        ${T.pending?` · <span style="color:#3b82f6">${num(T.pending)} awaiting</span>`:""}
        ${T.login?` · <span style="color:#2563eb">${num(T.login)} login OTP (derived)</span>`:""}
        ${T.avg_verify_sec!=null?` · avg ${T.avg_verify_sec}s to enter`:""}
        ${T.first?`<span style="color:var(--muted)"> · ${esc(KT.d(T.first))} → ${esc(KT.d(T.last))}</span>`:""}</div>`;
      /* What this list can and cannot contain — shown up front, because the customer's handset
         will always have more messages than we hold and the difference must not look like a bug. */
      const cov=(d.coverage||[]).length?`<details style="margin-bottom:6px"><summary class="rl" style="cursor:pointer;font-size:10.5px;color:var(--muted)">
          What this list covers — and what the platform never records</summary>
        <table class="alerts" style="margin-top:4px"><tr><th>SMS KIND</th><th>RECORDED</th><th>HOW</th></tr>
        ${d.coverage.map(c=>`<tr><td>${esc(c.kind)}</td>
          <td style="font-weight:700;color:${c.recorded==="fully"?"#10b981":c.recorded==="derived"?"#2563eb":"#dc2626"}">${esc(c.recorded)}</td>
          <td style="font-size:10.5px;color:var(--muted);white-space:normal;max-width:420px">${esc(c.how)}</td></tr>`).join("")}
        </table></details>`:"";
      const rows=d.rows.map((r,i)=>{
        const s=SMS_ST[r.status]||{c:"#64748b",t:r.status};
        const grade=r.type_source==="live"?`<span title="read from the app cache — exact" style="color:#10b981;font-weight:800">exact</span>`:r.type_source==="derived"?`<span title="reconstructed from the sign-in tracking" style="color:#2563eb;font-weight:800">derived</span>`
          :r.type_source==="inferred"?`<span title="deduced from ${esc(r.type_because||"")}" style="color:var(--warn-fg);font-weight:800">inferred</span>`
          :`<span style="color:var(--muted)">not recorded</span>`;
        return `<tr class="sms-row" data-i="${i}" style="cursor:pointer">
          <td class="mono">${esc(KT.dt(r.sent_at))}</td>
          <td><span style="font-weight:800;font-size:10px;color:${s.c}">${esc(s.t)}</span></td>
          <td>${r.message_type?esc(r.message_type.replace(/_/g," ")):"—"} <span style="font-size:9.5px">${grade}</span></td>
          <td>${r.time_to_verify_sec!=null?r.time_to_verify_sec+"s":"—"}</td>
          <td class="mono">${esc(r.recipient_mobile||"redirected")}</td>
          <td style="font-size:10.5px;color:var(--muted)">${r.body_en?esc(r.body_en.split("\n")[0]).slice(0,58)+"…":"—"}</td></tr>`;
      }).join("");
      out.innerHTML=sum+cov+`<table class="alerts"><tr><th>SENT (KSA)</th><th>OUTCOME</th><th>MESSAGE TYPE</th><th>TIME TO ENTER</th><th>RECIPIENT</th><th>PREVIEW</th></tr>${rows}</table>`+notes;
      out.querySelectorAll(".sms-row").forEach(tr=>tr.addEventListener("click",()=>smsDetail(d.rows[Number(tr.dataset.i)],q)));
    };

    /* Detail opens in the shared modal, not inline below the table: the list can be 60 rows long,
       and pushing content down meant clicking row 3 scrolled the row you clicked out of view. */
    function smsDetail(r,typedNumber){
      const ov=document.getElementById("panelModal"), host=document.getElementById("panelModalCard");
      if(!ov||!host||!r) return;
      const s=SMS_ST[r.status]||{c:"#64748b",t:r.status};
      const body=(txt,lang)=>txt?`<div style="margin-top:6px">
        <div class="rl" style="font-size:10px;color:var(--muted);letter-spacing:.04em">${lang}</div>
        <pre style="white-space:pre-wrap;font-size:11.5px;margin:2px 0 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);${lang==="ARABIC"?"direction:rtl;text-align:right":""}">${esc(txt)}</pre></div>`:"";
      const grade=r.type_source==="live"?["#10b981","exact — read from the app cache"]
        :r.type_source==="derived"?["#2563eb","derived from the sign-in tracking"]
        :r.type_source==="inferred"?["var(--warn-fg)","inferred from "+(r.type_because||"nearby activity")]
        :["#64748b","message type not recorded"];
      host.style.maxWidth="640px";
      host.innerHTML=`<div style="border-top:3px solid ${s.c};border-radius:12px 12px 0 0;margin:-1px -1px 0"></div>
        <div style="padding:14px 16px 16px">
        <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
          <b style="font-size:14px">${esc(KT.dt(r.sent_at))}</b>
          <span style="font-size:9.5px;font-weight:800;color:${s.c};border:1px solid ${s.c};border-radius:999px;padding:1px 8px">${esc(s.t)}</span>
          <span style="flex:1"></span>
          <button class="pill sms-360" data-m="${esc(typedNumber||"")}" style="padding:4px 12px;font-size:11px">Subscriber 360 →</button>
          <button class="pill sms-x" style="padding:4px 11px;font-size:12px">✕</button>
        </div>
        <div class="rl" style="font-size:11px;color:var(--muted);margin-top:4px">
          <b style="color:var(--ink)">${esc((r.message_type||"unknown type").replace(/_/g," "))}</b>
          · <span style="color:${grade[0]}">${esc(grade[1])}</span> · ${esc(r.channel||"sms")}
          ${r.verified_at?` · code entered ${esc(KT.dt(r.verified_at))} after ${r.time_to_verify_sec}s`:""}
          ${r.device?` · ${esc(r.device)}`:""}</div>
        <div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:3px">
          number <span class="mono">${esc(r.recipient_mobile||r.identifier||"—")}</span> (${esc(r.identifier_kind||"—")})
          ${r.confirmation_reference?` · ref <span class="mono">${esc(r.confirmation_reference)}</span>`:""}
          · code stored: ${r.has_code?"yes":"no"} <i>(never displayed)</i></div>
        ${r.recipient_note?`<div class="rl" style="font-size:10.5px;color:var(--warn-fg);white-space:normal;margin-top:5px">⚠ ${esc(r.recipient_note)}</div>`:""}
        ${body(r.body_en,"ENGLISH")}${body(r.body_ar,"ARABIC")}
        <div class="rl" style="font-size:10.5px;color:var(--muted);white-space:normal;margin-top:7px">${esc(r.body_note||"")}</div>
      </div>`;
      const close=()=>ov.classList.remove("open");
      const x=host.querySelector(".sms-x"); if(x) x.addEventListener("click",close);
      /* Fail loudly rather than silently: an empty or masked value here means the caller lost the
         real number, and a button that does nothing when clicked is worse than one that says why. */
      const s3=host.querySelector(".sms-360");
      if(s3) s3.addEventListener("click",()=>{
        const m=s3.dataset.m||"";
        if(!m||m.includes("*")){ s3.textContent="number unavailable"; s3.disabled=true; return; }
        close();
        if(window.openSub360) window.openSub360(m);
        else if(window.setConsoleHash) window.setConsoleHash("subscriber?key="+encodeURIComponent(m));
      });
      ov.classList.add("open");
      document.addEventListener("keydown",function esc2(e){ if(e.key==="Escape"){ close(); document.removeEventListener("keydown",esc2); } });
    }

    if(go) go.addEventListener("click",runSearch);
    if(inp) inp.addEventListener("keydown",e=>{ if(e.key==="Enter") runSearch(); });

    // KPI tile → the recipients behind the number
    const openBucket=async(bucket)=>{
      if(!out) return;
      out.innerHTML=`<div class="rl">loading recipients…</div>`;
      if(inp) inp.value="";
      let d; try{ d=await api(`/api/sms/recipients?bucket=${encodeURIComponent(bucket)}&hours=${winH}`); }
      catch(e){ out.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
      const rows=(d.rows||[]).map(r=>`<tr class="sms-pick" data-m="${esc(r.otp_for)}" style="cursor:pointer">
        <td class="mono">${esc(r.otp_for)}</td><td>${num(r.n)}</td>
        <td style="color:${r.verify_rate>=70?"#10b981":r.verify_rate>=40?"#d97706":"#dc2626"};font-weight:700">${r.verify_rate==null?"—":r.verify_rate+"%"}</td>
        <td class="mono">${esc(KT.dt(r.last_at))}</td></tr>`).join("");
      out.innerHTML=`<div class="rl" style="font-size:11.5px;margin-bottom:5px"><b>${num(d.count)}</b> numbers ${esc(d.label)} · last ${d.hours||winH}h
          <span style="color:var(--muted)">· click a row for that customer's full SMS history</span></div>
        <table class="alerts"><tr><th>NUMBER</th><th>OTPs</th><th>VERIFIED</th><th>LAST (KSA)</th></tr>${rows||`<tr><td colspan="4" class="rl">none</td></tr>`}</table>
        <div class="rl" style="font-size:10.5px;color:var(--muted);white-space:normal;margin-top:5px">• ${esc(d.note||"")}</div>
        <div id="smsDetail"></div>`;
      out.querySelectorAll(".sms-pick").forEach(tr=>tr.addEventListener("click",()=>{ if(inp) inp.value=tr.dataset.m; runSearch(); }));
    };
    box.querySelectorAll(".sms-kpi").forEach(el=>{
      el.addEventListener("click",()=>openBucket(el.dataset.bucket));
      el.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" ") { e.preventDefault(); openBucket(el.dataset.bucket); } });
    });
  }

  /* ---- ⑤ APIGW GATEWAY TRACES (Zipkin distillation) ----
   * Reads what zipkinCollector.js persisted: per-minute aggregates (permanent) + full outlier
   * spans (errors / >slow_ms). The gateway's own Zipkin forgets after ~1-3h; this doesn't. */
  /* Phase 3 (3 Sep 2026) — DMS SERVICES · UIL LIVE-LOG ROLLUPS. 5-min aggregates parsed from
   * the UIL summary blocks on the 4 DMS app nodes (uilSampler.js): per-API volume/latency,
   * per-instance liveness (a silent live instance = LB hole), and the business-code mix per
   * provider group. Console-DB reads only — instant. */
  async function renderUil(){
    const box=$("#monUil"); if(!box) return;
    if(!box.firstChild) box.innerHTML=`<div class="sub">Loading DMS services…</div>`;
    let d; try{ d=await api(`/api/monitoring/uil?hours=${winH}`); }
    catch(e){ box.innerHTML=""; return; }   // old build → hide
    const head=`<div style="font-weight:800;font-size:13px;color:var(--ink);margin:4px 0 8px">④ DMS SERVICES · UIL LIVE LOGS
      <span class="rl" style="font-weight:600">· per-call summary blocks sampled from the app nodes every 5 min · last ${d.hours||winH}h</span></div>`;
    const smp=d.sampler||{};
    if(!smp.configured){ box.innerHTML=head+`<div style="border:1px dashed var(--line);border-radius:10px;padding:12px;background:var(--card)" class="rl">
      Sampler not configured (needs console_ro on the DMS app nodes — DMSLOG_HOSTS).</div>`; return; }
    if(!(d.apis||[]).length){ box.innerHTML=head+`<div style="border:1px dashed var(--line);border-radius:10px;padding:12px;background:var(--card)" class="rl">
      No samples yet — first data appears ~5 minutes after deploy.${smp.error?` <span style="color:#dc2626">${esc(smp.error)}</span>`:""}</div>`; return; }
    // instance liveness chips — an instance that stops sampling while others continue = LB hole
    const now=Date.now();
    const instChips=(d.instances||[]).map(i=>{
      const age=(now-new Date(i.last_seen).getTime())/60000, stale=age>20;
      return `<span class="pill" style="padding:3px 10px;font-size:11px;border-left-color:${stale?"#dc2626":"#10b981"}"
        title="${esc(i.host)} · last sample ${Math.round(age)}m ago">${esc(i.host.split(".").pop())}·${esc(String(i.inst).replace("unified-integration-layer","L")||"L1")}&nbsp;<b>(${i.calls})</b>${stale?" ⚠":""}</span>`;
    }).join(" ");
    // provider code mix (top groups)
    const byGrp={};
    for(const c of (d.codes||[])){ (byGrp[c.grp]=byGrp[c.grp]||[]).push(c); }
    const grpHtml=Object.entries(byGrp).slice(0,6).map(([g,list])=>{
      const tot=list.reduce((a,x)=>a+Number(x.n),0);
      const bad=list.filter(x=>!/^(00|0|000|0000|200|201|600)$/.test(x.code)).reduce((a,x)=>a+Number(x.n),0);
      return `<div style="border:1px solid var(--line);border-radius:10px;background:var(--card);padding:8px 10px;min-width:150px">
        <div style="font-weight:800;font-size:12px">${esc(g||"—")} <span class="rl" style="color:${bad?"#d97706":"#16a34a"}">${bad? (100*bad/tot).toFixed(1)+"% non-OK":"clean"}</span></div>
        <div class="rl" style="font-size:10.5px;margin-top:3px">${list.slice(0,4).map(x=>`<code>${esc(x.code)}</code>·${x.n}`).join(" &nbsp;")}</div></div>`;
    }).join("");
    const rows=(d.apis||[]).slice(0,25).map(a=>{
      const ep=Number(a.calls)?100*Number(a.errors)/Number(a.calls):0;
      return `<tr><td class="mono" style="font-size:10.5px;max-width:330px;overflow:hidden">${esc(a.api)}</td>
        <td style="font-weight:700">${a.calls}</td>
        <td style="font-weight:700;color:${ep>10?"#dc2626":ep>2?"#d97706":"#16a34a"}">${a.errors} (${ep.toFixed(1)}%)</td>
        <td class="mono">${a.avg_ms}ms</td><td class="mono" style="color:${a.max_ms>10000?"#dc2626":"inherit"}">${a.max_ms}ms</td></tr>`;
    }).join("");
    box.innerHTML=head+`
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <span class="rl" style="font-weight:700">LIVE UIL INSTANCES:</span> ${instChips||'<span class="rl">—</span>'}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">${grpHtml}</div>
      <div style="border:1px solid var(--line);border-radius:10px;max-height:340px;overflow:auto"><table class="alerts" style="font-size:11.5px">
        <tr><th>API (UIL path)</th><th>CALLS</th><th>NON-OK</th><th>AVG</th><th>MAX</th></tr>${rows}</table></div>
      <div class="rl" style="margin-top:6px;color:var(--muted)">Sampler: cycle ${smp.cycles||0} · ${smp.last_ms!=null?smp.last_ms+"ms":"—"} · ${esc(smp.last_run||"")}${smp.error?` · <span style="color:#dc2626">${esc(smp.error)}</span>`:""}</div>`;
  }

  /* OSB · ORACLE BUS (3 Sep 2026) — per-URI latency/p95 + fault feed from the imported OSB log
   * archive (osbArchive.js). Window-filtered like every Monitoring tab; when the selected window
   * has no archive coverage it says so honestly. Becomes a rolling day-1-lag view once the OSB
   * SFTP delivery is daily. */
  async function renderOsbArch(){
    const box=$("#monOsbArch"); if(!box) return;
    if(!box.firstChild) box.innerHTML=`<div class="sub">Loading OSB…</div>`;
    const to=monTo||new Date().toISOString();
    const from=monFrom||new Date(Date.now()-winH*3600e3).toISOString();
    let topo,fl;
    try{
      topo=await api(`/api/osb/archive/topology?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      fl=await api(`/api/osb/archive/faults?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=25`);
    }catch(e){ box.innerHTML=""; return; }   // old build / no perms → hide
    const head=`<div style="font-weight:800;font-size:13px;color:var(--ink);margin:4px 0 8px">⑤ OSB · ORACLE BUS
      <span class="rl" style="font-weight:600">· from the OSB log archive (SFTP) · window-filtered · day-1 lag once the feed is daily</span></div>`;
    if(!Array.isArray(topo)||!topo.length){
      box.innerHTML=head+`<div style="border:1px dashed var(--line);border-radius:10px;padding:12px;background:var(--card)" class="rl">
        No OSB data in this window — the imported archive covers 31 Aug → 2 Sep. Set the Dates filter to those days, or import a newer archive.</div>`;
      return;
    }
    const rows=topo.slice(0,20).map(t=>`<tr><td class="mono" style="font-size:10.5px;max-width:330px;overflow:hidden">${esc(t.uri)}</td>
      <td style="font-weight:700">${Number(t.calls).toLocaleString()}</td><td class="mono">${esc(String(t.avg_ms))}ms</td>
      <td class="mono" style="color:${t.p95_ms>5000?"#dc2626":t.p95_ms>1500?"#d97706":"inherit"}">${esc(String(t.p95_ms))}ms</td>
      <td class="mono">${Number(t.max_ms).toLocaleString()}ms</td></tr>`).join("");
    const fk=(fl&&fl.byKind||[]).map(k=>`<span class="pill" style="padding:3px 10px;font-size:11px;border-left-color:#dc2626">${esc(k.fault_kind||"?")} <b>${Number(k.n).toLocaleString()}</b></span>`).join(" ");
    const fRows=((fl&&fl.list)||[]).slice(0,12).map(f=>`<div style="border-bottom:1px solid var(--line);padding:5px 0">
      <div class="rl"><b style="color:#dc2626">✖ ${esc(f.fault_kind||"fault")}</b> · ${esc(KT.dt(f.ts))}Z · ${esc(f.server||"")} · ${esc(f.pipeline||"")}${f.stage?" · "+esc(f.stage):""}${(f.msisdns||[]).length?` · ${esc(f.msisdns.join(", "))}`:""}</div>
      <details><summary class="rl" style="cursor:pointer;font-size:10.5px;color:var(--muted)">payload</summary>
      <pre style="font-size:10px;max-height:200px;overflow:auto;white-space:pre-wrap">${esc(f.payload||"")}</pre></details></div>`).join("");
    box.innerHTML=head
      +`<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px"><span class="rl" style="font-weight:700">FAULTS:</span> ${fk||'<span class="rl" style="color:var(--good)">none in window</span>'}</div>`
      +`<div style="border:1px solid var(--line);border-radius:10px;max-height:320px;overflow:auto"><table class="alerts" style="font-size:11.5px">
        <tr><th>OSB SERVICE / BACKEND</th><th>CALLS</th><th>AVG</th><th>P95</th><th>MAX</th></tr>${rows}</table></div>`
      +(fRows?`<div class="rl" style="margin-top:8px"><b>Fault feed (payload forensics)</b></div><div style="border:1px solid var(--line);border-radius:10px;padding:4px 10px;max-height:300px;overflow:auto">${fRows}</div>`:"");
  }

  async function renderApigw(){
    const box=$("#monApigw"); if(!box) return;
    if(!box.firstChild) box.innerHTML=`<div class="sub">Loading gateway traces…</div>`;
    let d; try{ d=await api(`/api/monitoring/apigw?window=${winH}${monQS()}`); }
    catch(e){ box.innerHTML=""; return; }   // old build → hide
    const head=`<div style="font-weight:800;font-size:13px;color:var(--ink);margin:4px 0 8px">① API GATEWAY · TRACES
      <span class="rl" style="font-weight:600">· Zipkin spans distilled per-minute (gateway keeps only ~1–3h — the console keeps 30 days) · last ${d.hours||winH}h</span></div>`;
    if(!d.configured){ box.innerHTML=head+`<div style="border:1px dashed var(--line);border-radius:10px;padding:12px;background:var(--card)" class="rl">
      Trace collector not configured — set <span class="mono">ZIPKIN_HOSTS</span> on the console and restart.</div>`; return; }

    // collector status line
    const hosts=(d.collector&&d.collector.hosts)||[];
    const hostLine=hosts.map(h=>`<span class="mono" style="color:${h.lastError?"#dc2626":"#10b981"};font-weight:700">${esc(h.host)}</span>${h.lastError?` <span class="rl" style="color:#dc2626">${esc(h.lastError)}</span>`:` <span class="rl" style="color:var(--muted)">${h.spans||0} spans · ${h.traces||0} traces · ${h.ms!=null?h.ms+"ms":"—"}${h.lastRunAt?" · "+esc(KT.t(h.lastRunAt, true))+"Z":""}</span>`}`).join(" &nbsp;·&nbsp; ");
    const statusLine=`<div class="rl" style="margin-bottom:10px">Collector: ${hostLine||"—"} &nbsp;·&nbsp; <span style="color:var(--muted)">${Number(d.statRows||0).toLocaleString()} aggregate rows stored</span></div>`;

    // chips
    const totCalls=(d.endpoints||[]).reduce((a,r)=>a+(r.calls||0),0);
    const totErr=(d.endpoints||[]).reduce((a,r)=>a+(r.errors||0),0);
    const eRate=totCalls?(100*totErr/totCalls):null;
    const chip=(label,val,color,title)=>`<div class="stat" title="${esc(title||"")}" style="min-width:128px"><b style="${color?`color:${color}`:""}">${val}</b><span>${esc(label)}</span></div>`;
    const chips=`<div class="topo-stats" style="margin-bottom:10px">
      ${chip("GATEWAY CALLS",totCalls.toLocaleString(),null,"sum of aggregated spans in the window (top 40 endpoints)")}
      ${chip("ERRORS",totErr.toLocaleString(),totErr?"#dc2626":"#16a34a","spans with error tag or HTTP ≥ 400")}
      ${chip("ERROR RATE",eRate==null?"—":eRate.toFixed(2)+"%",eRate>2?"#dc2626":eRate>0.5?"#d97706":"#16a34a","errors ÷ calls")}
      ${chip("OUTLIER SPANS KEPT",((d.slow||[]).length>=40?"40+":String((d.slow||[]).length)),null,"full spans stored: errors + calls slower than the slow threshold")}
    </div>`;

    // timeline: calls bars (grey) + errors (red)
    const S=d.series||[]; let chart="";
    if(S.length>1){
      const W=980,HT=110,pl=40,pb=16,pt=6;
      const maxV=Math.max(...S.map(r=>r.calls),1);
      const bw=Math.max(2,Math.floor((W-pl)/S.length)-1);
      const x=i=>pl+i*((W-pl)/S.length), y=v=>HT-pb-(v/maxV)*(HT-pb-pt);
      let g="";
      S.forEach((r,i)=>{ const lbl=KT.dt(r.t);
        g+=`<rect x="${x(i)}" y="${y(r.calls)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.calls))}" fill="#94a3b8" opacity=".45"><title>${esc(lbl)}: ${r.calls} calls</title></rect>`;
        if(r.errors) g+=`<rect x="${x(i)}" y="${y(r.errors)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.errors))}" fill="#ef4444" opacity=".9"><title>${esc(lbl)}: ${r.errors} errors</title></rect>`; });
      chart=`<div class="apanel" style="grid-column:span 12"><div class="ah"><b>Gateway traffic <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· per ${esc(d.unit)} · grey = calls · red = errors</span></b></div>
        <div class="abody"><svg viewBox="0 0 ${W} ${HT}" style="width:100%;max-width:1000px;height:${HT}px">${g}</svg></div></div>`;
    }

    // endpoint league table
    const pCol=v=>v==null?"":v>=3000?"color:#dc2626;font-weight:700":v>=1000?"color:#d97706;font-weight:700":"";
    const epRows=(d.endpoints||[]).map((r,i)=>`<tr class="gwrow" data-ep="${i}" title="Click for this endpoint's own trend, error rate and slowest traces">
      <td class="rl">${esc(r.service)}</td>
      <td class="mono" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.path)}">${r.method&&r.method!=="-"?`<b>${esc(r.method)}</b> `:""}${esc(r.path)}</td>
      <td class="mono">${Number(r.calls).toLocaleString()}</td>
      <td class="mono" style="${r.errors?"color:#dc2626;font-weight:700":""}">${Number(r.errors).toLocaleString()}</td>
      <td class="mono">${r.avg_ms!=null?Number(r.avg_ms).toLocaleString():"—"}</td>
      <td class="mono" style="${pCol(r.p95_ms)}">${r.p95_ms!=null?Number(r.p95_ms).toLocaleString():"—"}</td>
      <td class="mono">${r.max_ms!=null?Number(r.max_ms).toLocaleString():"—"}</td></tr>`).join("");
    const epTable=`<div class="apanel" style="grid-column:span 12;margin-top:12px"><div class="ah"><b>Latency by endpoint <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· top 40 by volume · click a row · headers sort · scroll inside the box</span></b></div>
      <div class="abody">${epRows?`<div style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="alerts msort" id="gwEpLeague"><tr><th>SERVICE</th><th>ENDPOINT</th><th>CALLS</th><th>ERRORS</th><th>AVG ms</th><th>P95 ms</th><th>MAX ms</th></tr>${epRows}</table></div>`:`<div class="rl">No aggregated spans in this window yet.</div>`}</div></div>`;

    // outlier spans (errors + slow) — the WHOLE ROW opens the stored trace (spans + the app-side
    // call when linked); the Analyze button additionally jumps into the Troubleshoot analyzer
    const slowRows=(d.slow||[]).map(r=>`<tr class="gwtr" data-trace="${esc(r.trace_id||"")}" style="cursor:pointer" title="Click: full stored trace — every span, status, error and the request/response when linked">
      <td class="mono rl">${esc(KT.dts(r.ts))}Z</td>
      <td class="rl">${esc(r.service)}</td>
      <td class="mono" style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.path)}">${esc(r.path||r.name||"—")}</td>
      <td class="mono" style="${r.duration_ms>=3000?"color:#dc2626;font-weight:700":"font-weight:700"}">${Number(r.duration_ms).toLocaleString()}</td>
      <td class="mono" style="${r.status_code&&Number(r.status_code)>=400?"color:#dc2626;font-weight:700":""}">${esc(r.status_code||"—")}</td>
      <td class="rl" style="color:#dc2626">${esc(r.error||"")}</td>
      <td>${r.uil_transaction_id?`<button class="pill" data-apigwuil="${esc(r.uil_transaction_id)}" style="padding:2px 8px;font-size:10.5px" title="Open in Troubleshoot case analyzer">Analyze</button>`:`<span class="mono rl" style="color:var(--muted)" title="trace ${esc(r.trace_id||"")}">${esc((r.trace_id||"").slice(0,8))}</span>`}</td></tr>`).join("");
    const slowTable2=`<div class="apanel" style="grid-column:span 12;margin-top:12px"><div class="ah" style="display:flex;align-items:center"><b>Errors &amp; slow calls <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· full spans kept for every error and every call over the slow threshold · click a row for the trace · headers sort</span></b>${monExportBtn("gwSlowX")}</div>
      <div class="abody">${slowRows?`<div style="max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="alerts msort" id="gwSlowTbl"><tr><th>AT (KSA)</th><th>SERVICE</th><th>ENDPOINT</th><th>ms</th><th>HTTP</th><th>ERROR</th><th></th></tr>${slowRows}</table></div>`:`<div class="rl" style="color:var(--good);font-weight:700">No errors or slow calls captured in this window.</div>`}</div></div>`;

    /* ---- WHAT NEEDS ATTENTION, above the fold ----
     * The league table is sorted by VOLUME, so the endpoint that is actually broken can sit at
     * row 30 behind healthy giants. These three cards rank the same 40 rows by the three ways an
     * API hurts a customer — it fails, it times out, it crawls — so the worst offender is visible
     * without scrolling or sorting. Counts are real (aggregated spans); the timeout figure is
     * explicitly from the kept outlier spans, which is a sample, and says so. */
    const EPS=d.endpoints||[];
    const label=r=>`${r.method&&r.method!=="-"?r.method+" ":""}${r.path}`;
    const byErr=EPS.filter(r=>Number(r.errors)>0)
      .map(r=>({...r,rate:Number(r.calls)?Number(r.errors)*100/Number(r.calls):0}))
      .sort((a,b)=>b.errors-a.errors).slice(0,3);
    const bySlow=EPS.filter(r=>r.p95_ms!=null).sort((a,b)=>b.p95_ms-a.p95_ms).slice(0,3);
    const TO=/(timeout|timed out|deadline|ETIMEDOUT|read time)/i;
    const toSpans=(d.slow||[]).filter(s=>TO.test(String(s.error||""))||[408,504].includes(Number(s.status_code)));
    const toBy={}; toSpans.forEach(s=>{ const k=`${s.service}||${s.path}`; toBy[k]=(toBy[k]||0)+1; });
    const toTop=Object.entries(toBy).sort((a,b)=>b[1]-a[1]).slice(0,3)
      .map(([k,n])=>({service:k.split("||")[0],path:k.split("||")[1],n}));
    const probCard=(title,accent,headline,sub,rows,foot)=>`<div class="gwprob" style="flex:1 1 260px;min-width:250px;border:1px solid var(--line);border-left:4px solid ${accent};border-radius:12px;padding:10px 12px;background:var(--card,#fff)">
      <div style="font-size:10.5px;font-weight:800;letter-spacing:.05em;color:${accent}">${esc(title)}</div>
      <div style="font-size:20px;font-weight:800;line-height:1.15;margin-top:2px">${headline}</div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-bottom:7px">${esc(sub)}</div>
      ${rows||`<div class="rl" style="font-size:10.5px;color:var(--good);font-weight:700">none in this window ✓</div>`}
      ${foot?`<div class="rl" style="font-size:9.5px;color:var(--muted);margin-top:5px;white-space:normal">${esc(foot)}</div>`:""}</div>`;
    /* One row: truncated path on the left, figure pinned right with real breathing room.
     * The previous version emitted TWO style attributes on the same div when the row was
     * clickable — HTML keeps the first and silently drops the second, so display:flex,
     * white-space:nowrap and the font size were all lost and the number collided with a
     * wrapped path. One attribute only, always. */
    const miniRow=(txt,val,col,idx)=>{
      const click=(idx!=null&&idx>=0);
      return `<div class="rl${click?" gwjump":""}"${click?` data-ep="${idx}"`:""} title="${esc(txt)}"
        style="font-size:10.5px;display:flex;align-items:baseline;gap:14px;white-space:nowrap;padding:3px 0;border-top:1px solid var(--line-soft,rgba(148,163,184,.16))${click?";cursor:pointer":""}">
        <span class="mono" style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left">${esc(txt)}</span>
        <b style="flex:0 0 auto;color:${col};font-variant-numeric:tabular-nums">${esc(val)}</b></div>`;
    };
    const idxOf=r=>EPS.findIndex(x=>x.path===r.path&&x.service===r.service&&x.method===r.method);
    const problems=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 2px">
      ${probCard("① FAILING","#dc2626",Number(totErr).toLocaleString(),"errors across all endpoints",
        byErr.map(r=>miniRow(label(r),`${Number(r.errors).toLocaleString()} · ${r.rate.toFixed(1)}%`,"#dc2626",idxOf(r))).join(""))}
      ${probCard("② TIMING OUT","var(--warn-fg)",toSpans.length?Number(toSpans.length).toLocaleString():"0","spans that timed out or returned 408/504",
        toTop.map(r=>miniRow(r.path,`${r.n}×`,"var(--warn-fg)",EPS.findIndex(x=>x.path===r.path&&x.service===r.service))).join(""),
        "Counted from the outlier spans the collector keeps, not from every call — treat as a signal, not a total.")}
      ${probCard("③ SLOWEST","#d97706",bySlow.length?Number(bySlow[0].p95_ms).toLocaleString()+" ms":"—","worst p95 in this window",
        bySlow.map(r=>miniRow(label(r),Number(r.p95_ms).toLocaleString()+" ms",r.p95_ms>=3000?"#dc2626":"#d97706",idxOf(r))).join(""))}
    </div>`;

    box.innerHTML=head+statusLine+chips+problems+chart
      +`<div id="gwErrFocus" style="grid-column:span 12"></div>`+epTable+slowTable2;
    // problem-card rows and league-table rows both open the same endpoint detail
    const openEp=i=>{ const r=EPS[Number(i)]; if(r) apigwEndpoint(r); };
    box.querySelectorAll(".gwrow").forEach(tr=>tr.addEventListener("click",()=>openEp(tr.dataset.ep)));
    box.querySelectorAll(".gwjump").forEach(el=>el.addEventListener("click",()=>{ if(el.dataset.ep!=null&&el.dataset.ep!=="-1") openEp(el.dataset.ep); }));
    box.querySelectorAll("[data-apigwuil]").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation();
      if(window.setConsoleHash) window.setConsoleHash("troubleshoot");
      setTimeout(()=>{ if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(b.dataset.apigwuil); },300);
      if(window.audit) window.audit("APIGW_SPAN_ANALYZE", b.dataset.apigwuil);
    }));
    box.querySelectorAll(".gwtr").forEach(tr=>tr.addEventListener("click",()=>{ if(tr.dataset.trace) apigwTrace(tr.dataset.trace); }));
    const st=$("#gwSlowTbl"); if(st) monSortable(st);
    const lg=$("#gwEpLeague"); if(lg) monSortable(lg);
    const sx=$("#gwSlowX"); if(sx) sx.onclick=()=>monExport(st,"apigw_errors_slow",{panel:"errors-and-slow"});
    renderErrFocus();
  }

  /* ---- ERROR FOCUS — the failure-family lens over the kept spans -------------------------
   * Built for the live 1500 chase: pick a family (1500 / timeout / 5xx / 4xx / other) and the
   * panel shows ITS trend, ITS endpoints and ITS recent cases in the page's window — every case
   * clickable to the stored trace, the table sortable, the whole thing exportable. */
  let gwFam=(window.pf&&window.pf.get('mon_fam',''))||"";
  async function renderErrFocus(){
    const host=$("#gwErrFocus"); if(!host) return;
    host.innerHTML=`<div class="apanel" style="margin-top:12px"><div class="abody rl">Loading error focus…</div></div>`;
    let d; try{ d=await api(`/api/monitoring/apigw/errfocus?window=${winH}${monQS()}${gwFam?`&fam=${encodeURIComponent(gwFam)}`:""}`); }
    catch(e){ host.innerHTML=""; return; }
    const FAMC={ "1500":"#dc2626", timeout:"var(--warn-fg)", "5xx":"#ef4444", "4xx":"#d97706", other:"#64748b" };
    const FAML={ "1500":"1500 · BSS/OSB SOAP fault", timeout:"Timeouts (408/504)", "5xx":"HTTP 5xx", "4xx":"HTTP 4xx", other:"Other" };
    const fams=d.families||[]; const famTot=fams.reduce((a,f)=>a+f.n,0);
    const chipEl=(key,lbl,n)=>`<button class="pill gwfam${(gwFam===key)?" on":""}" data-fam="${esc(key)}"
      style="padding:4px 12px;font-size:11.5px;border-left-color:${FAMC[key]||"#64748b"};${gwFam===key?"font-weight:800;background:var(--line-soft,rgba(148,163,184,.25))":""}">
      ${esc(lbl)} <b style="color:${FAMC[key]||"#64748b"}">${Number(n).toLocaleString()}</b></button>`;
    const chipsHtml=[chipEl("","All families",famTot)]
      .concat(fams.map(f=>chipEl(f.fam,FAML[f.fam]||f.fam,f.n))).join(" ");
    // KPI strip for the selected family
    const cases=d.cases||[]; const topEp=(d.top||[])[0];
    const lastCase=cases[0];
    const kpi=(l,v,c,t)=>`<div class="stat" title="${esc(t||"")}" style="min-width:150px"><b style="${c?`color:${c}`:""}">${v}</b><span>${esc(l)}</span></div>`;
    const famName=gwFam?(FAML[gwFam]||gwFam):"all families";
    const famSel=gwFam?fams.find(f=>f.fam===gwFam):null;
    const famCount=gwFam?(famSel?famSel.n:0):famTot;
    const kpis=`<div class="topo-stats" style="margin:10px 0 8px">
      ${kpi("FAILED CASES ("+famName.split(" ")[0]+")",Number(famCount).toLocaleString(),famCount?"#dc2626":"#16a34a","kept spans matching the selected family in the window")}
      ${kpi("WORST ENDPOINT",topEp?esc(topEp.path.split("/").slice(-2).join("/")):"—",topEp?"#dc2626":null,topEp?topEp.path+" · "+topEp.n+" cases":"")}
      ${kpi("LAST SEEN (KSA)",lastCase?esc(KT.dts(lastCase.ts)):"—",null,"newest matching case — is this live or historical?")}
      ${kpi("WINDOW",d.from?esc(d.from.slice(0,16).replace("T"," "))+" → "+esc(String(d.to).slice(0,16).replace("T"," ")):"last "+d.hours+"h")}
    </div>`;
    /* manager view: family mix donut + top-endpoint share bars — the "what is failing and
     * where" answer without reading a single table row */
    const donut=(()=>{ if(!fams.length) return "";
      const R=44,CX=60,CY=60,CIRC=2*Math.PI*R; let off=0,segs="";
      fams.forEach(f=>{ const frac=f.n/(famTot||1), len=frac*CIRC;
        segs+=`<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${FAMC[f.fam]||"#64748b"}" stroke-width="16"
          stroke-dasharray="${len} ${CIRC-len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${CX} ${CY})"
          ${gwFam&&gwFam!==f.fam?'opacity=".25"':""}><title>${esc(FAML[f.fam]||f.fam)}: ${f.n} (${(100*frac).toFixed(1)}%)</title></circle>`;
        off+=len; });
      const leg=fams.map(f=>`<div style="display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--muted)">
        <span style="width:9px;height:9px;border-radius:2px;background:${FAMC[f.fam]||"#64748b"}"></span>
        ${esc(FAML[f.fam]||f.fam)} <b style="color:var(--ink)">${Number(f.n).toLocaleString()}</b>
        <span>${(100*f.n/(famTot||1)).toFixed(1)}%</span></div>`).join("");
      return `<div style="flex:0 0 auto;display:flex;gap:14px;align-items:center">
        <svg viewBox="0 0 120 120" style="width:120px;height:120px">${segs}
          <text x="60" y="57" text-anchor="middle" font-size="17" font-weight="800" fill="#dc2626">${famTot.toLocaleString()}</text>
          <text x="60" y="72" text-anchor="middle" font-size="8" fill="#94a3b8">FAILED SPANS</text></svg>
        <div style="display:flex;flex-direction:column;gap:3px">${leg}</div></div>`; })();
    const hbars=(()=>{ const T=(d.top||[]).slice(0,6); if(!T.length) return "";
      const mx=Math.max(...T.map(r=>r.n),1);
      return `<div style="flex:1 1 320px;min-width:280px">
        <div style="font-weight:800;font-size:10px;letter-spacing:.05em;color:var(--muted);margin-bottom:5px">SHARE BY ENDPOINT (TOP 6)</div>
        ${T.map(r=>`<div style="display:flex;align-items:center;gap:8px;margin:3px 0" title="${esc(r.path)} · ${r.n} cases">
          <span class="mono" style="flex:0 0 210px;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left">${esc(r.path)}</span>
          <div style="flex:1;height:12px;background:var(--line-soft,rgba(148,163,184,.18));border-radius:6px;overflow:hidden">
            <div style="width:${(100*r.n/mx).toFixed(1)}%;height:100%;background:${gwFam?(FAMC[gwFam]||"#dc2626"):"#dc2626"};border-radius:6px"></div></div>
          <b style="flex:0 0 44px;text-align:right;font-size:11px;color:#dc2626">${Number(r.n).toLocaleString()}</b></div>`).join("")}
      </div>`; })();
    const managerRow=(donut||hbars)?`<div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center;margin:6px 0 10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card,#fff)">${donut}${hbars}</div>`:"";
    // trend chart for the family
    const S=d.series||[]; let chart="";
    if(S.length>1){
      const W=980,HT=110,pl=36,pb=16,pt=6;
      const maxV=Math.max(...S.map(r=>r.n),1);
      const bw=Math.max(2,Math.floor((W-pl)/S.length)-1);
      const x=i=>pl+i*((W-pl)/S.length), y=v=>HT-pb-(v/maxV)*(HT-pb-pt);
      const col=gwFam?(FAMC[gwFam]||"#dc2626"):"#dc2626";
      let g=""; S.forEach((r,i)=>{ g+=`<rect x="${x(i)}" y="${y(r.n)}" width="${bw}" height="${Math.max(1,(HT-pb)-y(r.n))}" fill="${col}" opacity=".8"><title>${esc(KT.dt(r.t))}: ${r.n}</title></rect>`; });
      g+=`<text x="4" y="12" font-size="9" fill="#94a3b8">max ${maxV.toLocaleString()}/${esc(d.unit)}</text>`;
      chart=`<svg viewBox="0 0 ${W} ${HT}" style="width:100%;max-width:1000px;height:${HT}px">${g}</svg>`;
    }
    const topRows=(d.top||[]).map(r=>`<tr><td class="rl">${esc(r.service)}</td>
      <td class="mono" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.path)}">${esc(r.path)}</td>
      <td class="mono" style="color:#dc2626;font-weight:700">${Number(r.n).toLocaleString()}</td>
      <td class="mono">${r.avg_ms!=null?Number(r.avg_ms).toLocaleString():"—"}</td>
      <td class="mono rl">${esc(KT.dts(r.last_seen))}</td></tr>`).join("");
    const caseRows=cases.map(r=>`<tr class="gwtr" data-trace="${esc(r.trace_id||"")}" style="cursor:pointer" title="Click for the full stored trace + request/response">
      <td class="mono rl">${esc(KT.dts(r.ts))}</td>
      <td><span style="color:${FAMC[r.fam]||"#64748b"};font-weight:800;font-size:10.5px">${esc(r.fam)}</span></td>
      <td class="rl">${esc(r.service)}</td>
      <td class="mono" style="max-width:330px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.path)}">${esc(r.path||"—")}</td>
      <td class="mono" style="${r.status_code&&Number(r.status_code)>=400?"color:#dc2626;font-weight:700":""}">${esc(r.status_code||"—")}</td>
      <td class="mono">${r.duration_ms!=null?Number(r.duration_ms).toLocaleString():"—"}</td>
      <td class="rl" style="color:#dc2626;max-width:300px;white-space:normal">${esc(r.error||"")}</td>
      <td>${r.uil_transaction_id?`<button class="pill" data-apigwuil="${esc(r.uil_transaction_id)}" style="padding:2px 8px;font-size:10.5px">Analyze</button>`:""}</td></tr>`).join("");
    host.innerHTML=`<div class="apanel" style="margin-top:12px;border-left:4px solid ${gwFam?(FAMC[gwFam]||"#dc2626"):"#dc2626"}">
      <div class="ah" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>Error focus <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· failure families over the kept spans · pick one to isolate it</span></b>
        <span style="flex:1"></span>${monExportBtn("gwFocusX","⬇ Export cases")}</div>
      <div class="abody">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px">${chipsHtml}</div>
        ${kpis}${managerRow}${chart}
        ${topRows?`<div style="font-weight:800;font-size:11px;letter-spacing:.04em;color:var(--muted);margin:10px 0 4px">TOP ENDPOINTS FOR ${esc(famName.toUpperCase())}</div>
          <div style="max-height:230px;overflow:auto;border:1px solid var(--line);border-radius:8px">
          <table class="alerts msort"><tr><th>SERVICE</th><th>ENDPOINT</th><th>CASES</th><th>AVG ms</th><th>LAST SEEN (KSA)</th></tr>${topRows}</table></div>`:""}
        ${caseRows?`<div style="font-weight:800;font-size:11px;letter-spacing:.04em;color:var(--muted);margin:12px 0 4px">RECENT CASES · ${cases.length} · newest first · click a row for trace + request/response · headers sort</div>
          <div style="max-height:380px;overflow:auto;border:1px solid var(--line);border-radius:8px">
          <table class="alerts msort" id="gwFocusTbl"><tr><th>AT (KSA)</th><th>FAM</th><th>SERVICE</th><th>ENDPOINT</th><th>HTTP</th><th>ms</th><th>ERROR</th><th></th></tr>${caseRows}</table></div>`
          :`<div class="rl" style="color:var(--good);font-weight:700">No failed cases for ${esc(famName)} in this window ✓</div>`}
        <div id="gwImpacted" style="margin-top:12px">
          <button class="pill" id="gwImpLoad" style="border-left-color:#dc2626;padding:5px 12px">👥 Load impacted customers (uil_logs · 1500/OSB faults)</button>
          <span class="rl" style="font-size:10px;color:var(--muted);margin-left:8px">the list the BSS mails paste by hand — MSISDNs/accounts extracted from the fault rows, masked, exportable</span>
        </div>
      </div></div>`;
    host.querySelectorAll(".gwfam").forEach(b=>b.onclick=()=>{ gwFam=b.dataset.fam||"";
      if(window.pf) window.pf.set('mon_fam',gwFam); renderErrFocus();
      if(window.audit) window.audit("APPLY_FILTER","monitoring:errfam:"+(gwFam||"all")); });
    host.querySelectorAll(".msort").forEach(monSortable);
    host.querySelectorAll(".gwtr").forEach(tr=>tr.addEventListener("click",()=>{ if(tr.dataset.trace) apigwTrace(tr.dataset.trace); }));
    host.querySelectorAll("[data-apigwuil]").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation();
      if(window.setConsoleHash) window.setConsoleHash("troubleshoot");
      setTimeout(()=>{ if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(b.dataset.apigwuil); },300); }));
    const fx=$("#gwFocusX"); if(fx) fx.onclick=()=>monExport($("#gwFocusTbl"),`apigw_errfocus_${gwFam||"all"}`,{family:gwFam||"all"});
    const il=$("#gwImpLoad"); if(il) il.onclick=()=>renderImpacted(false);
  }

  /* ---- IMPACTED CUSTOMERS (uil_logs, 1500/OSB fault family) --------------------------------
   * On-demand only (it queries the OSB MySQL — never auto-fired on every render). Masked by
   * default; the Unmask button appears only for the PII capability, is per-click and audited
   * server-side. Export exports exactly what is displayed. */
  async function renderImpacted(unmask){
    const host=$("#gwImpacted"); if(!host) return;
    host.innerHTML=`<div class="rl">Querying uil_logs for the fault window… (bounded, up to ~8s)</div>`;
    let d; try{ d=await api(`/api/monitoring/apigw/impacted?window=${winH}${monQS()}${unmask?"&unmask=1":""}`); }
    catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    if(!d.configured){ host.innerHTML=`<div class="rl" style="color:var(--muted)">uil_logs source not configured (OSB_LOG_URL) — the impacted list needs the OSB integration log.</div>`; return; }
    if(!d.ok){ host.innerHTML=`<div class="albanner">uil_logs: ${esc(d.error||"lookup failed")}</div>`; return; }
    const rows=(d.impacted||[]).map(r=>`<tr>
      <td class="mono" style="font-weight:700">${esc(r.id)}</td>
      <td><span class="rl" style="font-size:10px;font-weight:800;color:${r.type==="msisdn"?"#2563eb":r.type==="account"?"#7c3aed":"var(--warn-fg)"}">${esc(r.type)}</span></td>
      <td class="mono" style="color:#dc2626;font-weight:700">${Number(r.hits).toLocaleString()}</td>
      <td class="rl" style="max-width:340px;white-space:normal;font-size:10.5px">${esc(r.apis||"—")}</td>
      <td class="mono rl">${esc(r.first?KT.dts(r.first):"—")}</td>
      <td class="mono rl">${esc(r.last?KT.dts(r.last):"—")}</td></tr>`).join("");
    host.innerHTML=`<div style="border:1px solid var(--line);border-left:4px solid #dc2626;border-radius:10px;padding:10px 12px;background:var(--card,#fff)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <b style="font-size:12.5px">Impacted customers · 1500/OSB faults</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">${(d.impacted||[]).length} identifiers · from ${Number(d.rows_scanned).toLocaleString()} fault rows · last ${Math.round(d.minutes/60)}h${d.truncated?" · TRUNCATED (narrow the window)":""}</span>
        ${d.note?`<span class="rl" style="font-size:10px;color:#b26b00">${esc(d.note)}</span>`:""}
        <span style="flex:1"></span>
        ${d.can_unmask?`<button class="pill" id="gwImpMask" style="padding:3px 10px;font-size:11px;border-left-color:${d.unmasked?"#94a3b8":"#dc2626"}">${d.unmasked?"Mask":"Unmask (audited)"}</button>`:""}
        ${monExportBtn("gwImpX","⬇ Export list")}
        <button class="pill" id="gwImpReload" style="padding:3px 10px;font-size:11px">↻</button>
      </div>
      ${rows?`<div style="max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-top:8px">
        <table class="alerts msort" id="gwImpTbl"><tr><th>IDENTIFIER</th><th>TYPE</th><th>HITS</th><th>APIs</th><th>FIRST (KSA)</th><th>LAST (KSA)</th></tr>${rows}</table></div>`
        :`<div class="rl" style="color:var(--good);font-weight:700;margin-top:8px">No identifiers found in the fault rows of this window ✓</div>`}
      <div class="rl" style="font-size:10px;color:var(--muted);margin-top:6px">Identifiers are extracted from the uil_logs fault rows (request/response fields). Masked by default; unmasked views are audited per click. Export carries exactly what is on screen — attach it to the incident mail instead of pasting numbers.</div>
    </div>`;
    const it=$("#gwImpTbl"); if(it) monSortable(it);
    const ix=$("#gwImpX"); if(ix) ix.onclick=()=>monExport(it,`impacted_1500_${new Date().toISOString().slice(0,10)}`,{source:"uil_logs",unmasked:!!d.unmasked});
    const im=$("#gwImpMask"); if(im) im.onclick=()=>renderImpacted(!d.unmasked);
    const ir=$("#gwImpReload"); if(ir) ir.onclick=()=>renderImpacted(!!d.unmasked);
    if(window.audit) window.audit("APIGW_IMPACTED_VIEW", `n=${(d.impacted||[]).length}${d.unmasked?" unmasked":""}`);
  }

  /* ---- ONE STORED TRACE — the row-click destination everywhere on this tab ---------------
   * Every span the collector kept for the trace (service, path, status, error, duration), the
   * Digital-API side of the same call when a UIL transaction links them, and the jump into the
   * Troubleshoot analyzer for the full request/response bodies. */
  const monMask=s=>String(s==null?"":s).replace(/\d{7,}/g,m=>"*".repeat(m.length-3)+m.slice(-3));
  const monJson=v=>{ let s; try{ s=typeof v==="string"?v:JSON.stringify(v,null,2); }catch(_){ s=String(v); }
    return esc(monMask(s.length>4000?s.slice(0,4000)+"\n… truncated":s)); };
  async function apigwTrace(traceId, back){
    const ov=document.getElementById("panelModal"), host=document.getElementById("panelModalCard");
    if(!ov||!host) return;
    host.style.maxWidth="960px";
    host.innerHTML=`<div style="padding:14px 16px"><div class="rl">Loading trace ${esc(traceId.slice(0,12))}…</div></div>`;
    ov.classList.add("open");
    let d; try{ d=await api(`/api/monitoring/apigw/trace?trace=${encodeURIComponent(traceId)}`); }
    catch(e){ host.innerHTML=`<div style="padding:16px"><div class="albanner">${esc(e.message)}</div></div>`; return; }
    const spans=(d.spans||[]).map(s=>`<tr>
      <td class="mono rl">${esc(KT.dts(s.ts))}</td>
      <td class="rl">${esc(s.service||"—")}</td>
      <td class="mono" style="max-width:330px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.path||s.name||"")}">${s.method&&s.method!=="-"?`<b>${esc(s.method)}</b> `:""}${esc(s.path||s.name||"—")}</td>
      <td class="mono">${esc(s.kind||"—")}</td>
      <td class="mono" style="${s.status_code&&Number(s.status_code)>=400?"color:#dc2626;font-weight:700":""}">${esc(s.status_code||"—")}</td>
      <td class="mono" style="${Number(s.duration_ms)>=3000?"color:#dc2626;font-weight:700":"font-weight:700"}">${s.duration_ms!=null?Number(s.duration_ms).toLocaleString():"—"}</td>
      <td class="rl" style="color:#dc2626;max-width:260px;white-space:normal">${esc(s.error||"")}</td></tr>`).join("");
    const app=(d.app||[]).map(a=>`<tr>
      <td class="mono rl">${esc(KT.dts(a.ts))}</td>
      <td class="rl">${esc(a.host||"—")}</td>
      <td class="mono" style="max-width:330px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.path||"—")}</td>
      <td class="mono" style="font-weight:700">${esc(a.response_code||"—")}</td>
      <td class="rl" style="max-width:300px;white-space:normal">${esc(a.response_message||"—")}</td>
      <td class="mono">${a.duration_ms!=null?Number(a.duration_ms).toLocaleString():"—"}</td></tr>`).join("");
    const uil=(d.uil_ids||[])[0];
    host.innerHTML=`<div style="padding:14px 16px 16px">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        ${back?`<button class="pill" id="gwTrBack" style="padding:4px 11px;font-size:11.5px">‹ Back to list</button>`:""}
        <b style="font-size:13.5px">Trace</b><span class="mono rl">${esc(d.trace)}</span>
        ${uil?`<button class="pill" id="gwTrAn" style="padding:4px 11px;font-size:11.5px;border-left-color:#2563eb">Open in Case analyzer ›</button>`:""}
        <span style="flex:1"></span>${monExportBtn("gwTrX")}<button class="pill gw-x" style="padding:4px 11px;font-size:12px">✕</button>
      </div>
      <div style="font-weight:800;font-size:11px;letter-spacing:.04em;color:var(--muted);margin:10px 0 4px">GATEWAY SPANS · every hop the collector kept for this trace</div>
      ${spans?`<table class="alerts msort" id="gwTrTbl"><tr><th>AT (KSA)</th><th>SERVICE</th><th>OPERATION</th><th>KIND</th><th>HTTP</th><th>ms</th><th>ERROR</th></tr>${spans}</table>`
        :`<div class="rl">Only the outlier span of this trace was kept — the summary row above is the whole record.</div>`}
      ${app?`<div style="font-weight:800;font-size:11px;letter-spacing:.04em;color:var(--muted);margin:12px 0 4px">DIGITAL-API SIDE · the app call this trace served (linked by UIL transaction)</div>
        <table class="alerts"><tr><th>AT (KSA)</th><th>HOST</th><th>API PATH</th><th>CODE</th><th>RESPONSE (masked)</th><th>ms</th></tr>${app}</table>`:""}
      <div id="gwTrUil"></div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-top:10px">${uil?"Request/response below comes from uil_logs (OSB/BSS integration layer), PII-masked. The Case analyzer holds the same case with the app-side timeline.":"This trace carries no UIL transaction id — the gateway spans above are the whole stored record (the request body was never captured for it)."}</div>
    </div>`;
    host.querySelector(".gw-x").addEventListener("click",()=>ov.classList.remove("open"));
    const bk=host.querySelector("#gwTrBack"); if(bk) bk.onclick=()=>{ if(typeof back==="function") back(); };
    const an=host.querySelector("#gwTrAn"); if(an) an.onclick=()=>{ ov.classList.remove("open");
      if(window.setConsoleHash) window.setConsoleHash("troubleshoot");
      setTimeout(()=>{ if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(uil); },300); };
    const tb=host.querySelector("#gwTrTbl"); if(tb) monSortable(tb);
    const tx=host.querySelector("#gwTrX"); if(tx) tx.onclick=()=>monExport(tb,`apigw_trace_${d.trace.slice(0,12)}`,{trace:d.trace});
    /* REQUEST / RESPONSE inline — the ask behind "we feel lost on the 1500": the SOAP fault's
     * actual body. Fetched through the existing txn correlator (app + gateway + uil_logs). */
    if(uil){
      const uh=host.querySelector("#gwTrUil");
      uh.innerHTML=`<div class="rl" style="margin-top:10px">Loading request/response from uil_logs…</div>`;
      try{
        const t=await api(`/api/apigw/txn/${encodeURIComponent(uil)}`);
        const rows=(t&&t.uil&&t.uil.rows)||[];
        if(rows.length){
          uh.innerHTML=`<div style="font-weight:800;font-size:11px;letter-spacing:.04em;color:var(--muted);margin:12px 0 4px">REQUEST / RESPONSE · uil_logs (OSB/BSS) · txn <span class="mono">${esc(uil)}</span></div>`
            +rows.slice(0,3).map(r=>{
              const req=r.request!=null?r.request:(r.request_body!=null?r.request_body:null);
              const rsp=r.response!=null?r.response:(r.response_body!=null?r.response_body:null);
              return `<div style="border:1px solid var(--line);border-radius:10px;margin-bottom:8px;overflow:hidden">
              <div style="display:flex;gap:8px;align-items:center;padding:6px 10px;background:var(--line-soft,rgba(148,163,184,.14));font-size:11px">
                <b class="mono">${esc(r.api||r.service||r.path||"uil call")}</b>
                <span class="rl">${esc(r.created_at?KT.dts(r.created_at):"")}</span>
                ${r.response_code||r.status?`<b style="color:${String(r.response_code||r.status).match(/^(200|0{2,4})$/)?"#16a34a":"#dc2626"}">${esc(r.response_code||r.status)}</b>`:""}
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px">
                <div><div style="font-size:9.5px;font-weight:800;color:var(--muted);margin-bottom:3px">REQUEST</div>
                  <pre style="margin:0;max-height:220px;overflow:auto;background:var(--panel-dark);color:var(--panel-dark-fg);border-radius:8px;padding:8px;font-size:10px;line-height:1.45;white-space:pre-wrap;word-break:break-word">${req!=null?monJson(req):"(not captured)"}</pre></div>
                <div><div style="font-size:9.5px;font-weight:800;color:var(--muted);margin-bottom:3px">RESPONSE</div>
                  <pre style="margin:0;max-height:220px;overflow:auto;background:var(--panel-dark);color:var(--panel-dark-fg);border-radius:8px;padding:8px;font-size:10px;line-height:1.45;white-space:pre-wrap;word-break:break-word">${rsp!=null?monJson(rsp):"(not captured)"}</pre></div>
              </div></div>`;
            }).join("");
        } else {
          uh.innerHTML=`<div class="rl" style="margin-top:10px;color:var(--muted)">${esc((t&&t.uil&&(t.uil.error||t.uil.note))||"No uil_logs row matched this transaction — the request/response was not recorded on the integration layer.")}</div>`;
        }
      }catch(e){ uh.innerHTML=`<div class="rl" style="margin-top:10px;color:#dc2626">uil lookup failed: ${esc(e.message)}</div>`; }
    }
    if(window.audit) window.audit("APIGW_TRACE_VIEW", d.trace.slice(0,32));
  }

  /* ---- ONE ENDPOINT, in detail ----
   * Opened from any row of the latency table or the attention cards. The league table answers
   * "which endpoint", this answers "what is happening to it": how its traffic, errors and p95
   * moved over the window, and the slowest kept traces with their status, error text and the
   * transaction id needed to follow the call into Troubleshoot. */
  async function apigwEndpoint(r){
    const ov=document.getElementById("panelModal"), host=document.getElementById("panelModalCard");
    if(!ov||!host||!r) return;
    host.style.maxWidth="880px";
    const title=`${r.method&&r.method!=="-"?r.method+" ":""}${r.path}`;
    host.innerHTML=`<div style="padding:14px 16px 16px"><div class="rl">Loading ${esc(title)}…</div></div>`;
    ov.classList.add("open");
    const close=()=>ov.classList.remove("open");
    document.addEventListener("keydown",function k(e){ if(e.key==="Escape"){ close(); document.removeEventListener("keydown",k); } });

    let d; try{
      d=await api(`/api/monitoring/apigw/endpoint?service=${encodeURIComponent(r.service||"")}`+
        `&path=${encodeURIComponent(r.path)}&method=${encodeURIComponent(r.method||"")}&window=${winH}${monQS()}`);
    }catch(e){ host.innerHTML=`<div style="padding:16px"><div class="albanner">${esc(e.message)}</div></div>`; return; }
    const T=d.totals||{}, S=d.series||[];
    const erCol=T.error_rate>=5?"#dc2626":T.error_rate>0?"#d97706":"#16a34a";
    const pCol2=v=>v>=3000?"#dc2626":v>=1000?"#d97706":"#16a34a";
    const kpi=(l,v,c,t)=>`<div class="stat" title="${esc(t||"")}" style="min-width:112px"><b style="${c?`color:${c}`:""}">${v}</b><span>${esc(l)}</span></div>`;

    // calls (bars) + p95 (line) on one axis pair — the two curves together show whether slowness
    // tracks load or is independent of it, which is the first question in any latency triage
    let svg="";
    if(S.length>1){
      const W=820,H=140,pl=44,pb=20,pt=8;
      const maxC=Math.max(...S.map(x=>x.calls),1), maxP=Math.max(...S.map(x=>Number(x.p95_ms)||0),1);
      const bw=Math.max(2,Math.floor((W-pl)/S.length)-2);
      const x=i=>pl+i*((W-pl)/S.length), yC=v=>H-pb-(v/maxC)*(H-pb-pt), yP=v=>H-pb-(v/maxP)*(H-pb-pt);
      let g="";
      S.forEach((p,i)=>{
        g+=`<rect x="${x(i)}" y="${yC(p.calls)}" width="${bw}" height="${Math.max(1,(H-pb)-yC(p.calls))}" fill="#94a3b8" opacity=".45"><title>${esc(KT.dt(p.t))}: ${p.calls} calls</title></rect>`;
        if(p.errors) g+=`<rect x="${x(i)}" y="${yC(p.errors)}" width="${bw}" height="${Math.max(1,(H-pb)-yC(p.errors))}" fill="#dc2626" opacity=".85"><title>${p.errors} errors</title></rect>`;
      });
      const pts=S.map((p,i)=>`${x(i)+bw/2},${yP(Number(p.p95_ms)||0)}`).join(" ");
      g+=`<polyline points="${pts}" fill="none" stroke="#d97706" stroke-width="2"/>`;
      g+=`<text x="4" y="12" font-size="9" fill="#94a3b8">calls</text><text x="4" y="${H-4}" font-size="9" fill="#d97706">p95 ${Number(maxP).toLocaleString()}ms</text>`;
      svg=`<div class="apanel" style="margin-top:10px"><div class="ah"><b>Over the window <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· grey = calls · red = errors · amber line = p95</span></b></div>
        <div class="abody"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">${g}</svg></div></div>`;
    }
    const spans=(d.spans||[]).map(s=>`<tr class="gwtr2" data-trace="${esc(s.trace_id||"")}" style="cursor:pointer" title="Click for the full stored trace">
      <td class="mono rl">${esc(KT.dts(s.ts))}</td>
      <td class="mono" style="font-weight:700;color:${Number(s.duration_ms)>=3000?"#dc2626":"inherit"}">${Number(s.duration_ms).toLocaleString()}</td>
      <td class="mono" style="${s.status_code&&Number(s.status_code)>=400?"color:#dc2626;font-weight:700":""}">${esc(s.status_code||"—")}</td>
      <td class="rl" style="color:#dc2626;max-width:280px;white-space:normal">${esc(s.error||"")}</td>
      <td class="rl">${esc(s.host||"")}</td>
      <td>${s.uil_transaction_id?`<button class="pill gw-an" data-uil="${esc(s.uil_transaction_id)}" style="padding:2px 8px;font-size:10.5px">Analyze</button>`:`<span class="mono rl" title="trace ${esc(s.trace_id||"")}">${esc((s.trace_id||"").slice(0,8))}</span>`}</td></tr>`).join("");

    host.innerHTML=`<div style="padding:14px 16px 16px">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        <b style="font-size:13.5px" class="mono">${esc(title)}</b>
        <span class="rl" style="font-size:11px;color:var(--muted)">${esc(r.service||"")} · last ${d.hours||winH}h</span>
        <span style="flex:1"></span><button class="pill gw-x" style="padding:4px 11px;font-size:12px">✕</button>
      </div>
      <div class="topo-stats" style="margin:9px 0 0">
        ${kpi("CALLS",Number(T.calls).toLocaleString(),null,"aggregated spans in the window")}
        ${kpi("ERRORS",Number(T.errors).toLocaleString(),T.errors?"#dc2626":"#16a34a")}
        ${kpi("ERROR RATE",(T.error_rate||0)+"%",erCol)}
        ${kpi("AVG",T.avg_ms!=null?Number(T.avg_ms).toLocaleString()+" ms":"—")}
        ${kpi("P95",T.p95_ms!=null?Number(T.p95_ms).toLocaleString()+" ms":"—",T.p95_ms!=null?pCol2(T.p95_ms):null,"95% of calls finish under this")}
        ${kpi("MAX",T.max_ms!=null?Number(T.max_ms).toLocaleString()+" ms":"—")}
      </div>
      ${svg}
      <div class="apanel" style="margin-top:10px"><div class="ah" style="display:flex;align-items:center"><b>Slowest kept traces
        <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· click a row for the trace · headers sort</span></b>${monExportBtn("gwEpX")}</div>
        <div class="abody">${spans?`<table class="alerts msort" id="gwEpTbl"><tr><th>AT (KSA)</th><th>ms</th><th>HTTP</th><th>ERROR</th><th>HOST</th><th></th></tr>${spans}</table>`
          :`<div class="rl" style="color:var(--good);font-weight:700">No errors or slow calls kept for this endpoint ✓</div>`}</div></div>
    </div>`;
    host.querySelector(".gw-x").addEventListener("click",close);
    const et=host.querySelector("#gwEpTbl"); if(et) monSortable(et);
    const ex=host.querySelector("#gwEpX"); if(ex) ex.onclick=()=>monExport(et,`apigw_endpoint_${String(r.path||"").split("/").pop()||"ep"}`,{endpoint:r.path});
    host.querySelectorAll(".gwtr2").forEach(tr=>tr.addEventListener("click",e=>{
      if(e.target.closest("button")) return;
      // second-level popup → carry a "Back to list" that re-opens THIS endpoint's popup
      if(tr.dataset.trace) apigwTrace(tr.dataset.trace, ()=>apigwEndpoint(r));
    }));
    host.querySelectorAll(".gw-an").forEach(b=>b.addEventListener("click",()=>{
      close();
      if(window.setConsoleHash) window.setConsoleHash("troubleshoot");
      setTimeout(()=>{ if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(b.dataset.uil); },300);
      if(window.audit) window.audit("APIGW_SPAN_ANALYZE", b.dataset.uil);
    }));
    if(window.audit) window.audit("APIGW_ENDPOINT", String(r.path||"").slice(0,60));
  }

  /* ---- ⑥ DELIVERY PARTNERS ----
   * Per-vendor state funnel (buckets = the app's own DeliveryRequest model mapping), daily
   * outcome chart, and shipments stuck >24h — each drillable to the REAL courier wire
   * (sidekiq.log request/response) and the customer timeline. */
  async function renderDelivery(){
    const box=$("#monDelivery"); if(!box) return;
    if(!box.firstChild) box.innerHTML=`<div class="sub">Loading delivery partners…</div>`;
    let d; try{ d=await api(`/api/monitoring/delivery?window=${Math.max(winH,24)*7}`); }
    catch(e){ box.innerHTML=""; return; }   // old build → hide
    const head=`<div style="font-weight:800;font-size:13px;color:var(--ink);margin:4px 0 8px">⑥ DELIVERY PARTNERS
      <span class="rl" style="font-weight:600">· per-vendor funnel + stuck shipments · last ${Math.round(d.hours/24)}d · state buckets mirror the app's DeliveryRequest model · drill = REAL courier request/response from sidekiq.log</span></div>`;
    const BC={completed:"#10b981",in_progress:"#3b82f6",new:"#94a3b8",undelivered:"#ef4444",refused:"#e11d48",cancelled:"#64748b"};
    // per-vendor funnel
    const byV={};
    (d.vendors||[]).forEach(r=>{ (byV[r.vendor]=byV[r.vendor]||{})[r.bucket]=r.n; });
    const times={}; (d.delivery_time||[]).forEach(r=>{ times[r.vendor]=r; });
    const vRows=Object.entries(byV).map(([v,b])=>{ const tot=Object.values(b).reduce((a,x)=>a+x,0);
      const bar=Object.entries(BC).map(([k,c])=>b[k]?`<span title="${k}: ${b[k]}" style="display:inline-block;height:9px;width:${Math.max(1,100*b[k]/tot)}%;background:${c}"></span>`:"").join("");
      const t=times[v];
      return `<tr><td style="padding:4px 8px;font-weight:700">${esc(v)}</td>
        <td class="mono" style="text-align:right">${tot.toLocaleString()}</td>
        <td style="min-width:220px"><div style="border-radius:5px;overflow:hidden;white-space:nowrap;font-size:0">${bar}</div></td>
        <td class="mono" style="text-align:right;color:var(--good);font-weight:700">${(b.completed||0).toLocaleString()}</td>
        <td class="mono" style="text-align:right;color:#ef4444">${((b.undelivered||0)+(b.refused||0)).toLocaleString()}</td>
        <td class="mono" style="text-align:right">${t&&t.avg_hours!=null?t.avg_hours+"h":"—"}</td></tr>`; }).join("");
    const legend=Object.entries(BC).map(([k,c])=>`<span style="color:${c}">● ${k}</span>`).join(" · ");
    const funnel=`<div class="apanel" style="grid-column:span 12"><div class="ah"><b>Vendors <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· ${legend}</span></b></div>
      <div class="abody">${vRows?`<table class="alerts"><tr><th>VENDOR</th><th style="text-align:right">SHIPMENTS</th><th>STATE MIX</th><th style="text-align:right">DELIVERED</th><th style="text-align:right">FAILED</th><th style="text-align:right">AVG TIME</th></tr>${vRows}</table>`:`<div class="rl">No delivery requests in this window.</div>`}</div></div>`;
    // daily chart
    const byDay={};
    (d.series||[]).forEach(r=>{ const k=String(r.t).slice(0,10); (byDay[k]=byDay[k]||{})[r.bucket]=(byDay[k][r.bucket]||0)+r.n; });
    const days=Object.entries(byDay).sort((a,b)=>a[0]<b[0]?-1:1);
    let chart="";
    if(days.length>1){
      const W=980,HT=110,pl=36,pb=16,pt=6;
      const maxV=Math.max(...days.map(([,b])=>Object.values(b).reduce((a,x)=>a+x,0)),1);
      const bw=Math.max(4,Math.floor((W-pl)/days.length)-3);
      const x=i=>pl+i*((W-pl)/days.length), y=v=>HT-pb-(v/maxV)*(HT-pb-pt);
      let g="";
      days.forEach(([day,b],i)=>{ let y0=HT-pb;
        ["completed","in_progress","new","undelivered","refused","cancelled"].forEach(k=>{
          const v=b[k]||0; if(!v) return; const hh=(v/maxV)*(HT-pb-pt); y0-=hh;
          g+=`<rect x="${x(i)}" y="${y0}" width="${bw}" height="${Math.max(1,hh)}" fill="${BC[k]}" opacity=".88"><title>${day} · ${k}: ${v}</title></rect>`; });
        if(i%Math.ceil(days.length/14)===0) g+=`<text x="${x(i)+bw/2}" y="${HT-3}" text-anchor="middle" font-size="7.5" fill="var(--muted)">${day.slice(5)}</text>`; });
      chart=`<div class="apanel" style="grid-column:span 12"><div class="ah"><b>Daily outcomes</b></div>
        <div class="abody"><svg viewBox="0 0 ${W} ${HT}" style="width:100%;height:${HT}px">${g}</svg></div></div>`;
    }
    // stuck shipments
    const sRows=(d.stuck||[]).map(r=>`<tr>
      <td class="mono" style="padding:3px 6px">${esc(KT.md(r.created_at))}</td>
      <td>${esc(r.vendor||"?")}</td>
      <td class="mono" style="color:#d97706;font-weight:700">${esc(r.delivery_state||"—")}</td>
      <td class="mono" style="color:#dc2626;font-weight:700;text-align:right">${r.age_h}h</td>
      <td class="mono">${esc(r.internal_reference_id||"—")}</td>
      <td class="mono">${esc(r.receiver_mobile||"—")}</td>
      <td style="white-space:nowrap">
        ${r.internal_reference_id||r.external_reference_id?`<button class="pill mon-courier" data-ref="${esc(r.internal_reference_id||r.external_reference_id)}" style="padding:2px 8px;font-size:10px;border-left-color:#0d9488">⇄ Wire</button>`:""}
        <button class="pill mon-deltl" data-row="del:${r.id}" style="padding:2px 8px;font-size:10px">Timeline →</button></td></tr>`).join("");
    const stuckP=`<div class="apanel" style="grid-column:span 12"><div class="ah"><b>Stuck shipments <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· open &gt;24h, oldest first · ⇄ Wire = the real courier request/response</span></b></div>
      <div class="abody">${sRows?`<table class="alerts"><tr><th>CREATED</th><th>VENDOR</th><th>STATE</th><th style="text-align:right">AGE</th><th>OUR REF</th><th>MOBILE</th><th></th></tr>${sRows}</table>`:`<div class="rl" style="color:var(--good);font-weight:700">No shipments stuck beyond 24h in this window.</div>`}</div></div>`;
    box.innerHTML=head+`<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:12px">${funnel}${chart}${stuckP}</div>`;
    box.querySelectorAll(".mon-courier").forEach(b=>b.addEventListener("click",()=>{ if(window.opsCourierTrace) window.opsCourierTrace(b.dataset.ref); }));
    box.querySelectorAll(".mon-deltl").forEach(b=>b.addEventListener("click",()=>{ if(window.opsOpenTimeline) window.opsOpenTimeline(null,b.dataset.row,null); }));
  }

  /* ---------- 6) PAYMENTS GATEWAY — UPG / Tap ----------
   * New panel. Payment health was previously visible only from the Dashboard funnel and the
   * Troubleshoot deep-dive, i.e. as a business metric. This is the OPS view of the same rail:
   * is the gateway reachable at all, and of the payments that did run, which outcome did they
   * reach. The outcome split is the one from paymentErrorReport — success / declined (the bank
   * answered no) / no-answer (nothing came back) / abandoned (customer never engaged) /
   * stuck (gateway answered, we still say pending) — because "failed" alone hides who is at
   * fault. Stuck is the row to watch: it is money the customer paid that we have not credited. */
  async function renderPayments(){
    const box=$("#monPayments"); if(!box) return;
    box.innerHTML=`<div class="rl" style="padding:14px">Loading payment gateway…</div>`;
    let h=null,d=null,err=null;
    try{ [h,d]=await Promise.all([ api("/api/upg/health").catch(e=>({configured:false,error:e.message})),
                                   api(`/api/payments/deep-dive?window=${winH}`) ]); }
    catch(e){ err=e.message; }
    const head=`<div style="font-weight:800;font-size:13px;color:var(--ink);margin:4px 0 8px">③ PAYMENTS GATEWAY
      <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· UPG (Tap) · outcomes over the last ${winH}h</span></div>`;
    if(err){ box.innerHTML=head+`<div class="albanner">${esc(err)}</div>`; return; }

    // link health — the gateway DB the console reads for correlation
    const hs=!h||h.configured===false?ST.off:(h.ok?ST.ok:ST.fail);
    const hCard=`<div class="topo-card" style="padding:10px 12px;margin-bottom:10px;background:var(--card,#fff);border-left:3px solid ${hs.c}">
      <b style="font-size:12px">Gateway link</b>
      <span style="margin-left:8px;font-weight:800;font-size:10px;letter-spacing:.05em;color:${hs.c}">${hs.t}</span>
      <span class="rl" style="font-size:10.5px;color:var(--muted);margin-left:8px">
        ${h&&h.configured===false?"UPG_DATABASE_URL not set — payment correlation is unavailable"
          :`${h&&h.ms!=null?ms(h.ms):"—"}${h&&h.db?` · ${esc(h.db)}`:""}${h&&h.error?` · ${esc(h.error)}`:""}`}</span></div>`;

    const F=(d&&d.funnel)||[];
    const tot=k=>F.reduce((a,r)=>a+Number(r[k]||0),0);
    const T=tot("total"), OK=tot("success"), DEC=tot("declined"), NOA=tot("failed_noanswer"),
          ABN=tot("abandoned"), STK=tot("stuck"), REF=tot("refunded");
    const share=n=>T?((n*100)/T).toFixed(1)+"%":"—";
    const kpi=(label,val,sub,color,title)=>`<div class="stat" title="${esc(title||"")}" style="min-width:132px">
      <b style="${color?`color:${color}`:""}">${val}</b><span>${esc(label)}</span>
      ${sub?`<i style="display:block;font-size:10px;color:var(--muted);font-style:normal">${esc(sub)}</i>`:""}</div>`;
    const chips=`<div class="topo-stats" style="margin-bottom:10px">
      ${kpi("ATTEMPTS · "+winH+"h",num(T),null,null,"every payment row created in the window")}
      ${kpi("CAPTURED",num(OK),share(OK),"#16a34a","status = success")}
      ${kpi("DECLINED",num(DEC),share(DEC),"#3b82f6","the bank answered no — business outcome, not a fault")}
      ${kpi("NO ANSWER",num(NOA),share(NOA),"#ef4444","failed with nothing returned by the gateway — technical")}
      ${kpi("ABANDONED",num(ABN),share(ABN),"#94a3b8","customer never engaged with the payment page")}
      ${kpi("STUCK",num(STK),share(STK),STK?"#dc2626":"#16a34a","gateway answered but we still show pending — money taken, not credited")}
      ${kpi("REFUNDED",num(REF),share(REF),null,"status = refunded")}
    </div>`;

    const vRows=F.map(r=>{
      const t=Number(r.total||0), ok=Number(r.success||0);
      const rate=t?(ok*100/t):null;
      const c=rate==null?"var(--muted)":(rate>=90?"#16a34a":rate>=75?"#d97706":"#dc2626");
      return `<tr><td><b>${esc(r.vendor)}</b></td><td>${num(r.total)}</td>
        <td style="color:${c};font-weight:800">${rate==null?"—":rate.toFixed(1)+"%"}</td>
        <td>${num(r.declined)}</td><td>${num(r.failed_noanswer)}</td><td>${num(r.abandoned)}</td>
        <td style="${Number(r.stuck)?"color:#dc2626;font-weight:800":""}">${num(r.stuck)}</td>
        <td>${num(r.refunded)}</td></tr>`;
    }).join("");
    const vendorP=`<div class="apanel" style="grid-column:span 7;min-width:340px"><div class="ah"><b>By gateway
      <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· capture rate = success ÷ attempts</span></b></div>
      <div class="abody">${vRows?`<table class="alerts"><tr><th>VENDOR</th><th>ATTEMPTS</th><th>CAPTURE</th><th>DECLINED</th><th>NO ANSWER</th><th>ABANDONED</th><th>STUCK</th><th>REFUNDED</th></tr>${vRows}</table>`:`<div class="rl">No payments in this window.</div>`}</div></div>`;

    const DR=(d&&d.declines)||[];
    const dMax=Math.max(1,...DR.map(x=>Number(x.n||0)));
    const dRows=DR.map(x=>`<tr><td style="max-width:260px;white-space:normal">${esc(x.reason||"—")}</td>
      <td style="width:90px"><div style="height:6px;border-radius:3px;background:var(--line-soft,rgba(148,163,184,.18))">
        <div style="height:6px;border-radius:3px;width:${Math.round(Number(x.n||0)*100/dMax)}%;background:#3b82f6"></div></div></td>
      <td style="text-align:right">${num(x.n)}</td></tr>`).join("");
    const declP=`<div class="apanel" style="grid-column:span 5;min-width:280px"><div class="ah"><b>Why payments failed
      <span class="rl" style="font-weight:600;font-size:11px;color:var(--muted)">· gateway reason, as returned</span></b></div>
      <div class="abody">${dRows?`<table class="alerts"><tr><th>REASON</th><th></th><th style="text-align:right">N</th></tr>${dRows}</table>`:`<div class="rl">No declines recorded.</div>`}</div></div>`;

    const R=(d&&d.retry)||{};
    const recov=R.sampled?((Number(R.recovered||0)*100)/Number(R.sampled)).toFixed(1):null;
    const retryP=`<div class="apanel" style="grid-column:span 12"><div class="ah"><b>Did the customer come back?</b></div>
      <div class="abody"><div class="rl" style="font-size:11.5px;white-space:normal">
        Of <b>${num(R.sampled)}</b> sampled failed or abandoned attempts, <b style="color:${recov&&Number(recov)>=50?"#16a34a":"#d97706"}">${recov==null?"—":recov+"%"}</b>
        were followed by a successful payment from the same number within 24 hours.
        <span style="color:var(--muted)">A high number means the failure cost time, not revenue; a low number means it cost revenue.
        ${STK?`Separately, <b style="color:#dc2626">${num(STK)} stuck</b> attempt(s) need reconciliation — the gateway has the money and the app does not know.`:""}</span>
      </div></div></div>`;

    box.innerHTML=head+hCard+chips+`<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:12px">${vendorP}${declP}${retryP}</div>`;
  }

  /* ---------- 7) RESELLERS — the Growth page, rehomed ----------
   * Growth was a top-level tab showing reseller and campaign performance, which is the same
   * subject as the reseller integration health monitored here. Rather than fork the code, the
   * existing #view-growth section is MOVED into this pane once and growth.js renders into it
   * exactly as before — no duplicated queries, no second implementation to keep in step. */
  function renderResellers(){
    const host=$("#monResellers"); if(!host) return;
    const g=document.getElementById("view-growth");
    if(g && g.parentNode!==host){
      g.classList.remove("view");            // stop the global view switcher from hiding it
      g.classList.add("active");
      g.style.display="";
      host.appendChild(g);
    }
    if(window.renderGrowth) window.renderGrowth();
    else if(!g) host.innerHTML=`<div class="rl" style="padding:16px">Growth module not loaded.</div>`;
  }

  /* ---------- ⑧ AI · YUSR — observing the AI itself ----------
   * The one part of the console that did not appear IN the console. Aggregates only (no agents,
   * no message text — that stays on the root-only Settings→Yusr panel). Fails soft everywhere:
   * an old server without /api/assist/health just hides the pane. */
  async function renderAiHealth(){
    const box=$("#monAi"); if(!box) return;
    if(!box.firstChild) box.innerHTML=`<div class="sub">Loading AI health…</div>`;
    let d; try{ d=await api(`/api/assist/health?days=7`); }
    catch(e){ box.innerHTML=`<div class="rl" style="color:var(--muted)">AI health endpoint not available on this build.</div>`; return; }
    const pct=v=>v==null?"—":Math.round(v*100)+"%";
    const msf=v=>v==null?"—":(v>=1000?(v/1000).toFixed(1)+"s":v+"ms");
    const degC=d.degradedRate>0.15?"#dc2626":d.degradedRate>0.05?"#d97706":"#10b981";
    const fbC=d.feedback.rate==null?"var(--muted)":d.feedback.rate>=0.8?"#10b981":d.feedback.rate>=0.6?"#d97706":"#dc2626";
    const m=d.model||{};
    const mTxt=!m.enabled?["DISABLED","#6b7280"]:!m.ok?["UNREACHABLE","#dc2626"]:m.modelAvailable===false?["MODEL MISSING","#dc2626"]:["LIVE","#10b981"];
    const chip=(label,val,color,title)=>`<div class="stat" title="${esc(title||"")}" style="min-width:128px">
      <b style="${color?`color:${color}`:""}">${val}</b><span>${esc(label)}</span></div>`;
    const head=`<div style="font-weight:800;font-size:13px;color:var(--ink);margin:4px 0 8px">⑧ AI · YUSR
      <span class="rl" style="font-weight:600">· the portal observing its own AI — local LLM${m.name?` (${esc(m.name)})`:""} · last ${d.days} days</span></div>`;
    const chips=`<div class="topo-stats" style="margin-bottom:10px">
      ${chip("MODEL",`<span style="color:${mTxt[1]}">●</span> ${mTxt[0]}`,null,"live probe of the local Ollama host")}
      ${chip("QUESTIONS · 7D",(d.chats||0).toLocaleString(),null,`${d.users||0} distinct users`)}
      ${chip("LAST 24H",(d.last24h||0).toLocaleString(),null,"questions in the last 24 hours")}
      ${chip("ANSWER P95",msf(d.latency.llm.p95),null,`avg ${msf(d.latency.llm.avg)} · LLM share avg ${msf(d.latency.llm.avg_llm)} · context pack avg ${msf(d.latency.llm.avg_pack)}`)}
      ${chip("FALLBACK RATE",pct(d.degradedRate),degC,`${d.degraded} of ${d.chats} answered rule-based because the LLM failed or timed out`)}
      ${chip("👍 RATE",d.feedback.rate==null?"—":pct(d.feedback.rate),fbC,`${d.feedback.helpful}/${d.feedback.total} rated helpful — our hallucination-risk proxy`)}
      ${chip("LEARNED CASES",(d.learnedCases||0).toLocaleString(),null,"PII-scrubbed 👍 answers reused as team memory")}
      ${d.retrieval?chip("EMPTY RETRIEVAL",pct(d.retrieval.emptyRate),d.retrieval.emptyRate>0.2?"#d97706":"#10b981",`answers built on zero retrieved rows (avg ${d.retrieval.avgSources} sources) — the #1 precursor of a wrong answer`):""}
    </div>`;
    const maxH=Math.max(1,...d.latencyHist.map(x=>x.n));
    const histRows=d.latencyHist.map(x=>`<div class="bar-like" style="display:grid;grid-template-columns:52px 1fr 46px;gap:8px;align-items:center;font-size:11.5px;padding:3px 0">
      <span style="color:var(--muted)">${esc(x.label)}</span>
      <span style="height:8px;border-radius:6px;background:linear-gradient(90deg,#5b2d8e,rgba(91,45,142,.25));width:${Math.max(2,100*x.n/maxH)}%"></span>
      <b style="text-align:right">${x.n.toLocaleString()}</b></div>`).join("");
    const maxD=Math.max(1,...(d.daily||[]).map(x=>x.n));
    const dailyBars=(d.daily||[]).map(x=>`<div title="${esc(x.day)} · ${x.n} questions · ${x.degraded} fallback" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:64px">
      <div style="background:#dc2626;opacity:.85;height:${Math.round(60*(x.degraded||0)/maxD)}px"></div>
      <div style="background:#5b2d8e;height:${Math.max(2,Math.round(60*(x.n-(x.degraded||0))/maxD))}px;border-radius:2px 2px 0 0"></div>
      <div style="font-size:9px;color:var(--muted);text-align:center;margin-top:2px">${esc(String(x.day).slice(8))}</div></div>`).join("");
    const errRows=(d.llmErrors||[]).length?`<div style="margin-top:10px"><b style="font-size:11.5px">Fallback causes</b>
      ${d.llmErrors.map(e2=>`<div class="rl" style="font-size:11px">· ${esc(e2.err)} — ${e2.n}×</div>`).join("")}</div>`:"";
    const guard=`<div class="topo-card" style="padding:10px 12px;margin-top:10px;background:var(--card,#fff)">
      <b style="font-size:12px">Guardrails, by construction</b>
      <div class="rl" style="font-size:11.5px;margin-top:4px">PII masked <b>before</b> inference · inference local (nothing leaves Salam) · question text never logged · every unmask audited · no model-initiated action.</div></div>`;
    box.innerHTML=head+chips+`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="topo-card" style="padding:10px 12px;background:var(--card,#fff)">
        <b style="font-size:12px">Answer-time distribution</b>${histRows}${errRows}</div>
      <div class="topo-card" style="padding:10px 12px;background:var(--card,#fff)">
        <b style="font-size:12px">Daily questions <span class="rl" style="font-weight:600">(red = fallback)</span></b>
        <div style="display:flex;gap:3px;align-items:flex-end;margin-top:8px">${dailyBars||'<span class="rl">no data yet</span>'}</div></div>
    </div>`+guard;
  }

  /* ================= SUB-TABS =================
   * ORDER = THE PATH A REQUEST TRAVELS, which is also the order you triage in:
   *   gateway → our API → can the customer get in → does the money move → does the SMS arrive →
   *   does the SIM arrive → and finally the channel that sold it.
   * That ordering is the whole point: when something breaks you walk left to right and the first
   * red tab is the layer at fault. Alphabetical or "most used first" would destroy that.
   * API health lives WITH the gateway (your call): both answer "is the request path healthy",
   * and the two panels are read together when latency moves. */
  const ICON={
    gateway:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="1.6"/><circle cx="14" cy="12" r="1.6"/><circle cx="10" cy="18" r="1.6"/>',
    access:'<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    payments:'<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M2.5 10h19"/>',
    sms:'<path d="M21 12a8 8 0 1 1-3.2-6.4"/><path d="M7 10h8M7 14h5"/>',
    delivery:'<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
    resellers:'<path d="M3 17l6-6 4 4 7-7"/><path d="M17 7h4v4"/>'
  };
  const TABS=[
    { key:"gateway",   label:"Gateway & API", sub:"edge nodes · traces · dealer UIL",  color:"#2563eb", render:()=>{ renderApigw(); renderTraffic(); if(window.renderDealerGw) window.renderDealerGw(); renderUil(); renderOsbArch(); } },
    { key:"payments",  label:"Payments GW",   sub:"UPG · Tap · capture & stuck",        color:"#d97706", render:renderPayments },
    { key:"access",    label:"Access",        sub:"login · IP blocking · app errors",   color:"#0e9f5a", render:renderAppErrors },
    { key:"sms",       label:"SMS gateways",  sub:"Unifonic · Msegat · OTP delivery",   color:"#0891b2", render:renderSms },
    { key:"delivery",  label:"Delivery",      sub:"OTO · SMSA · Barq · iMile",          color:"#7c3aed", render:renderDelivery },
    { key:"resellers", label:"Resellers",     sub:"Apollo · Tygo · Soob · campaigns",   color:"#e11d48", render:renderResellers },
    { key:"ai",        label:"AI · Yusr",     sub:"LLM health · latency · feedback",    color:"#5b2d8e", render:renderAiHealth }
  ];
  // deep link wins over the saved preference (#monitoring?tab=sms — Yusr links, TKT-000008)
  const hashTab=(/\btab=([a-z]+)/.exec(location.hash||'')||[])[1];
  let curTab=hashTab||(window.pf&&window.pf.get('mon_tab','gateway'))||'gateway';
  if(!TABS.some(t=>t.key===curTab)) curTab='gateway';
  const drawn={};   // lazy: a tab renders on first open, then only on Refresh

  /* worst status among the dependencies a tab owns — so a red chip in the strip surfaces on the
     tab that investigates it, and you can see which section to open without opening any */
  function tabStatus(key){
    const keys=TAB_KEYS[key]||[]; if(!keys.length||!lastHealth) return null;
    const found=(lastHealth.checks||[]).filter(c=>keys.includes(c.key));
    if(!found.length) return null;
    for(const rank of ["fail","warn","off","ok"]) if(found.some(c=>c.status===rank)) return rank;
    return null;
  }

  function renderTabs(){
    const bar=$("#monTabs"); if(!bar) return;
    // equal-width columns: the tab row reads as one control instead of ragged pills, and the
    // active section never shifts position when its label length changes
    bar.setAttribute("style","display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:8px;margin:16px 0 12px");
    bar.innerHTML=TABS.map(t=>{
      const on=t.key===curTab, st=tabStatus(t.key), sc=st&&ST[st]?ST[st].c:null;
      const dot=(st&&st!=="ok")?`<span title="${esc(ST[st].t)}" style="position:absolute;top:7px;right:8px;width:7px;height:7px;border-radius:50%;background:${sc}"></span>`:"";
      return `<button class="mon-tab" data-tab="${t.key}" aria-current="${on?"page":"false"}" style="
        position:relative;display:flex;align-items:center;gap:9px;cursor:pointer;text-align:left;width:100%;
        border:1px solid ${on?t.color:"var(--line)"};border-radius:12px;padding:8px 12px;
        background:${on?t.color+"14":"var(--card,#fff)"};color:inherit;font:inherit;
        box-shadow:${on?`inset 0 -2.5px 0 ${t.color}`:"none"}">
        <span style="flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:27px;height:27px;border-radius:8px;background:${t.color}${on?"22":"14"}">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="${t.color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[t.key]||""}</svg></span>
        <span style="line-height:1.2;min-width:0">
          <span style="display:block;font-size:12px;font-weight:800;color:${on?t.color:"var(--ink)"}">${esc(t.label)}</span>
          <span style="display:block;font-size:9.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.sub)}</span>
        </span>${dot}</button>`;
    }).join("");
    bar.querySelectorAll(".mon-tab").forEach(b=>b.addEventListener("click",()=>activate(b.dataset.tab)));
  }

  function activate(key,force){
    const tab=TABS.find(t=>t.key===key)||TABS[0];
    const changed=(tab.key!==curTab);
    curTab=tab.key;
    if(window.pf) window.pf.set('mon_tab',curTab);
    document.querySelectorAll("#monPanes .monpane").forEach(p=>{
      p.style.display=(p.dataset.pane===curTab)?"":"none";
    });
    renderTabs();
    if(force||!drawn[curTab]){ drawn[curTab]=true; try{ tab.render(); }catch(e){ console.error("monitoring tab",curTab,e); } }
    try{ const h="#monitoring?tab="+curTab; if(location.hash!==h&&history.replaceState) history.replaceState(null,"",h); }catch(e){}
    // audit real navigation only — a Refresh re-runs activate() and must not fill the log
    if(changed && window.audit) window.audit("VIEW_PAGE","#monitoring?tab="+curTab);
  }

  async function render(){ renderHealth(); activate(curTab,true); }

  // nav tab + refresh + router deep-link support
  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="monitoring") b.addEventListener("click", render); });
  const rf=$("#monRefresh"); if(rf) rf.addEventListener("click", render);
  window.openMonitoring=(tab)=>{
    if(tab && TABS.some(t=>t.key===tab)) curTab=tab;
    const v=$("#view-monitoring");
    if(v && !v.classList.contains("active")){ const t=document.querySelector('.navtab[data-view="monitoring"]'); if(t) t.click(); }
    else render();
  };
})();
