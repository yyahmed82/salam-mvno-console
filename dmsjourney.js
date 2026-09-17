/* DMS JOURNEYS UI v2 — dealer activity end to end, from DMS's own audit trail (dms_audit_logs).
 * Renders into #dmsJourneys on the DMS page; dms.js passes the page's sticky range {from,to}.
 * Layers: ⓐ journey trace (identifier → merged timeline) · ⓑ SALE FLOW strip (eligibility →
 * activation → notify, volumes per step) · ⓒ KPI cards · ⓓ drill: EVERYTHING clickable —
 * chart buckets → that hour/day's codes+APIs+dealers · code chips → filter failures · dealers →
 * Dealer 360 lookup. All aggregates from console DB (instant); identifiers masked at ingest. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const n=x=>Number(x||0).toLocaleString("en-US");
  const SES={ email:localStorage.getItem("cons_email")||"", role:localStorage.getItem("cons_role")||"report_manager" };
  async function api(path){
    const r=await fetch((window.API_BASE||window.CONSOLE_BASE)+path,
      {headers:{"Content-Type":"application/json","X-Console-Role":SES.role,"X-Console-User":SES.email}});
    if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||("HTTP "+r.status));
    return r.json();
  }
  let W=null;
  const winFallback=()=>{ const to=new Date(); return { from:new Date(to.getTime()-24*3600e3).toISOString(), to:to.toISOString() }; };

  /* merge hourly buckets to daily when the window is long — keeps charts readable on 30d */
  const foldObj=(dst,src)=>{ for(const [k,v] of Object.entries(src||{})) dst[k]=(dst[k]||0)+Number(v); return dst; };
  function mergeDaily(hourly){
    if((hourly||[]).length<=60) return { rows:hourly||[], unit:"hour" };
    const by=new Map();
    for(const h of hourly){
      const d=new Date(new Date(h.t).getTime()+3*3600e3).toISOString().slice(0,10);   // KSA day
      let B=by.get(d); if(!B){ B={ t:d, calls:0, errors:0, dealers:0, codes:{}, apis:{}, top_dealers:{} }; by.set(d,B); }
      B.calls+=Number(h.calls); B.errors+=Number(h.errors); B.dealers=Math.max(B.dealers,Number(h.dealers||0));
      foldObj(B.codes,h.codes); foldObj(B.apis,h.apis); foldObj(B.top_dealers,h.top_dealers);
    }
    return { rows:[...by.values()], unit:"day" };
  }
  const lbl=(t,unit)=>unit==="day"?t:KT.dt(t);

  /* GLOBAL PII MODE — one switch for the whole console, persisted per BROWSER SESSION
   * (sessionStorage: survives refresh, dies when the tab closes — requested 1 Sep). The client
   * state is a convenience; the SERVER still checks the capability and audits pii.unmask on
   * every unmasked fetch — a tampered flag yields masked data, never a bypass. */
  window.PII = window.PII || {
    on:(function(){ try{ return sessionStorage.getItem("consolePII")==="1"; }catch(e){ return false; } })(),
    can(){ try{ const s=window.opsSession&&window.opsSession(); return !!(s&&s.me&&s.me.caps&&s.me.caps.unmaskPII); }catch(e){ return false; } },
    set(v){ this.on=!!v&&this.can(); try{ sessionStorage.setItem("consolePII", this.on?"1":"0"); }catch(e){} }
  };
  const um=()=>!!(window.PII&&window.PII.on);
  const canUnmask=()=>window.PII.can();

  /* Dealer POPUP — you were 3 screens down a table; jumping to the top Dealer 360 section lost
   * your place. The overlay keeps your scroll position; "Full Dealer 360 ↗" still jumps up for
   * the statement export / unmask controls. */
  async function openDealer360(code){
    if(!code) return;
    const old=document.getElementById("djOv"); if(old) old.remove();
    const ov=document.createElement("div"); ov.id="djOv";
    ov.style.cssText="position:fixed;inset:0;z-index:1300;background:rgba(15,23,42,.55);backdrop-filter:blur(2px);overflow:auto;padding:3vh 3vw";
    const header=()=>`
      <div style="position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:12px 18px;background:var(--card,#fff);border-bottom:1px solid var(--line);border-radius:16px 16px 0 0">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:rgba(14,159,90,.12);font-size:15px">👤</span>
        <div style="line-height:1.15"><b style="font-size:13.5px">Dealer <span class="mono">${esc(code)}</span></b><br>
          <span class="rl" style="font-size:9.5px;color:${um()?"#dc2626":"var(--muted)"}">${um()?"🔓 identifiers in full — audited":"quick view · masked"}</span></div>
        <span style="flex:1"></span>
        ${canUnmask()?`<button id="djOvUm" class="pill" style="font-size:11px;padding:4px 12px;${um()?"border-left-color:#dc2626":""}">${um()?"🔓 Hide":"🔒 Reveal"}</button>`:""}
        <button id="djOvFull" class="pill" style="font-size:11px;padding:4px 12px">Full Dealer 360 ↗</button>
        <button id="djOvX" title="Close (Esc)" style="cursor:pointer;width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:var(--card2,rgba(148,163,184,.08));color:inherit;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center">✕</button>
      </div>`;
    ov.innerHTML=`<div id="djOvCard" style="max-width:1320px;margin:0 auto;background:var(--card,#fff);border:1px solid var(--line);border-radius:16px;box-shadow:0 24px 70px rgba(2,6,23,.45);overflow:hidden">
      <div id="djOvHead">${header()}</div>
      <div id="djOvBody" style="padding:14px 18px"><div class="rl">Loading dealer…</div></div></div>`;
    document.body.appendChild(ov); document.body.style.overflow="hidden";
    const close=()=>{ ov.remove(); document.body.style.overflow=""; document.removeEventListener("keydown",onEsc); };
    const onEsc=e=>{ if(e.key==="Escape") close(); };
    document.addEventListener("keydown",onEsc);
    ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
    const wire=()=>{
      ov.querySelector("#djOvX").addEventListener("click",close);
      ov.querySelector("#djOvFull").addEventListener("click",()=>{ close();
        const q=$("#d360q"), go=$("#d360go");
        if(q&&go){ q.value=code; go.click(); const el=document.getElementById("dms360"); if(el) el.scrollIntoView({behavior:"smooth"}); } });
      const umBtn=ov.querySelector("#djOvUm");
      if(umBtn) umBtn.addEventListener("click",()=>{ window.PII.set(!window.PII.on); load(); });
    };
    const load=async()=>{
      ov.querySelector("#djOvHead").innerHTML=header(); wire();
      const body=ov.querySelector("#djOvBody"); body.innerHTML=`<div class="rl">Loading dealer…</div>`;
      try{
        const d=await api(`/api/dms/dealer360?q=${encodeURIComponent(code)}${um()?"&unmask=1":""}`);
        body.innerHTML=(d.unmasked?`<div style="border:1px solid #dc2626;border-radius:9px;padding:6px 11px;margin-bottom:10px;background:rgba(220,38,38,.06);font-size:11px;font-weight:700;color:#dc2626">🔓 Identifiers shown in full — this reveal is recorded in the audit log.</div>`:"")
          +(window.renderDealerCardHtml?window.renderDealerCardHtml(d)
          :`<pre class="mono" style="font-size:11px;white-space:pre-wrap">${esc(JSON.stringify(d,null,2).slice(0,4000))}</pre>`)
          +`<div id="djOvTl" style="margin-top:14px"></div>`;
        if(window.audit) window.audit(d.unmasked?"DEALER_360_UNMASK":"DEALER_360","popup:"+String(code).slice(0,40));
        const el=ov.querySelector("#djOvTl");
        if(el&&window.renderDealerActivity){ const P=d.found&&d.dealer?d.dealer:{};
          window.renderDealerActivity(el,{username:P.username||null,dealer_code:P.dealer_code||null,id:P.id!=null?P.id:null,q:code},{compact:true,days:7}); }
      }catch(e){ body.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; }
    };
    wire(); load();
  }

  /* ROW DETAIL POPUP — the ⇄/row click answer: EVERY column of the source row (live by PK,
   * masked unless global PII is on) + the cross-journey trace of its reference, in place. */
  async function openRowPopup(key,id){
    if(!key||!id) return;
    const old=document.getElementById("djRv"); if(old) old.remove();
    const ov=document.createElement("div"); ov.id="djRv";
    ov.style.cssText="position:fixed;inset:0;z-index:1301;background:rgba(15,23,42,.55);backdrop-filter:blur(2px);overflow:auto;padding:3vh 3vw";
    const header=(d)=>`
      <div style="position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:12px 18px;background:var(--card,#fff);border-bottom:1px solid var(--line);border-radius:16px 16px 0 0">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:rgba(37,99,235,.12);font-size:14px">${(d&&d.icon)||"⧉"}</span>
        <div style="line-height:1.15"><b style="font-size:13.5px">${esc((d&&d.label)||key)} · row <span class="mono">#${esc(String(id))}</span></b><br>
          <span class="rl" style="font-size:9.5px;color:${um()?"#dc2626":"var(--muted)"}">${um()?"🔓 identifiers in full — audited":"every column · masked"}${d&&d.source?` · ${esc(d.source)}`:""}</span></div>
        <span style="flex:1"></span>
        ${canUnmask()?`<button id="djRvUm" class="pill" style="font-size:11px;padding:4px 12px;${um()?"border-left-color:#dc2626":""}">${um()?"🔓 Hide":"🔒 Reveal"}</button>`:""}
        <button id="djRvX" title="Close (Esc)" style="cursor:pointer;width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:var(--card2,rgba(148,163,184,.08));color:inherit;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center">✕</button>
      </div>`;
    ov.innerHTML=`<div style="max-width:1200px;margin:0 auto;background:var(--card,#fff);border:1px solid var(--line);border-radius:16px;box-shadow:0 24px 70px rgba(2,6,23,.45);overflow:hidden">
      <div id="djRvHead">${header(null)}</div>
      <div id="djRvBody" style="padding:14px 18px"><div class="rl">Loading row…</div></div></div>`;
    document.body.appendChild(ov); document.body.style.overflow="hidden";
    const close=()=>{ ov.remove(); document.body.style.overflow=""; document.removeEventListener("keydown",onEsc); };
    const onEsc=e=>{ if(e.key==="Escape") close(); };
    document.addEventListener("keydown",onEsc);
    ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
    const wire=()=>{ ov.querySelector("#djRvX").addEventListener("click",close);
      const b=ov.querySelector("#djRvUm"); if(b) b.addEventListener("click",()=>{ window.PII.set(!window.PII.on); load(); }); };
    const load=async()=>{
      wire();
      const body=ov.querySelector("#djRvBody"); body.innerHTML=`<div class="rl">Loading row…</div>`;
      try{
        const d=await api(`/api/dms/journeys/${encodeURIComponent(key)}/row?id=${encodeURIComponent(id)}${um()?"&unmask=1":""}`);
        ov.querySelector("#djRvHead").innerHTML=header(d); wire();
        if(!d.found){ body.innerHTML=`<div class="rl">Row not found (purged or wrong id).</div>`; return; }
        const cells=(d.fields||[]).map(f=>`<div style="border:1px solid var(--line);border-radius:9px;padding:6px 10px;background:var(--card2,rgba(148,163,184,.05));min-width:0">
            <div class="rl" style="font-size:9px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)">${esc(f.k)}</div>
            <div class="mono" style="font-size:11px;overflow-wrap:anywhere;${f.v==null?"color:var(--muted)":""}">${f.v==null?"—":esc(f.v)}</div></div>`).join("");
        body.innerHTML=(d.unmasked?`<div style="border:1px solid #dc2626;border-radius:9px;padding:6px 11px;margin-bottom:10px;background:rgba(220,38,38,.06);font-size:11px;font-weight:700;color:#dc2626">🔓 Identifiers shown in full — this reveal is recorded in the audit log.</div>`:"")
          +`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:7px">${cells}</div>`
          +`<div id="djRvTrace" style="margin-top:14px">${d.ref?`<div class="rl" style="font-size:11px">Tracing reference <span class="mono">${esc(d.ref)}</span> across all journeys…</div>`:`<div class="rl" style="font-size:10px;color:var(--muted)">No correlation reference on this row — cross-journey trace not possible.</div>`}</div>`;
        if(d.ref){
          try{
            const t=await api(`/api/dms/journeys/trace?q=${encodeURIComponent(d.ref)}${um()?"&unmask=1":""}`);
            const el=ov.querySelector("#djRvTrace"); if(el) el.innerHTML=`<b style="font-size:11.5px">Cross-journey trace</b> <span class="rl" style="font-size:9.5px;color:var(--muted)">reference ${esc(d.ref)} · ${n((t.hits||[]).length)} step(s), oldest first</span>`+traceListHtml(t,ov);
          }catch(e){ const el=ov.querySelector("#djRvTrace"); if(el) el.innerHTML=`<div class="rl" style="font-size:10.5px;color:var(--warn-fg)">trace: ${esc(e.message)}</div>`; }
        }
      }catch(e){ body.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; }
    };
    wire(); load();
    if(window.audit) window.audit("VIEW_PAGE",`#dms?row=${key}#${id}`);
  }

  /* shared trace timeline markup (used by the trace box AND the row popup) */
  function traceListHtml(d,root){
    const rows=(d.hits||[]).map(h=>`<div style="display:flex;gap:9px;align-items:baseline;padding:4px 0;border-top:1px solid var(--line)">
      <span class="mono rl" style="font-size:10px;white-space:nowrap;color:var(--muted)">${esc(KT.md(h.at))}Z</span>
      <span>${h.icon||"•"}</span><b style="font-size:11.5px;min-width:120px">${esc(h.label)}</b>
      <span class="mono" style="font-size:10.5px;font-weight:700;color:${h.err?"#dc2626":"#16a34a"}">${esc(h.code||"—")}</span>
      ${h.msisdn?`<span class="mono" style="font-size:10px">${esc(h.msisdn)}</span>`:""}
      <span class="rl" style="flex:1;font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(h.message||"")}">${esc(h.message||h.api||"")}</span>
      ${h.dealer?`<button class="mono dj-dlr" data-d="${esc(h.dealer)}" style="cursor:pointer;background:none;border:none;color:inherit;font-size:10px;padding:0;text-decoration:underline dotted">${esc(h.dealer)}</button>`:""}</div>`).join("");
    const html=rows||`<div class="rl" style="font-size:10.5px;padding:4px 0">No other journey rows share this reference.</div>`;
    setTimeout(()=>{ (root||document).querySelectorAll("#djRvTrace .dj-dlr").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); openDealer360(b.dataset.d); })); },0);
    return `<div style="margin-top:4px">${html}</div>`;
  }

  async function render(w){
    W=w&&w.from?w:(W||winFallback());
    const box=$("#dmsJourneys"); if(!box) return;
    box.innerHTML=`<div class="rl">Loading journeys…</div>`;
    let d; try{ d=await api(`/api/dms/journeys?from=${encodeURIComponent(W.from)}&to=${encodeURIComponent(W.to)}`); }
    catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const all=d.journeys||[];
    const J=all.filter(j=>j.calls>0), silent=all.filter(j=>!j.calls);
    const get=k=>all.find(x=>x.key===k)||{calls:0,errors:0};

    /* ⓑ SALE FLOW — the main dealer sale, step volumes in this window. Steps also serve other
     * journeys (Semati checks run for swaps too), so this is step VOLUME, not a strict funnel. */
    const FLOW=[["semati","Identity · Semati"],["nafath","Identity · Nafath"],["activation","SIM activation"],["dealer_sms","Customer SMS"]];
    const fnode=([k,l],i)=>{ const j=get(k); const rate=j.calls?Math.round(1000*j.errors/j.calls)/10:0;
      return `${i?'<span style="color:var(--muted);font-size:16px;align-self:center">→</span>':""}
        <button class="dmsj-flow" data-j="${k}" style="cursor:pointer;font:inherit;color:inherit;text-align:center;background:var(--card2,rgba(148,163,184,.06));border:1px solid ${j.errors?(rate>=3?"#dc2626":"#d97706"):"var(--line)"};border-radius:11px;padding:8px 16px;min-width:120px">
          <div style="font-size:17px;font-weight:800">${n(j.calls)}</div>
          <div class="rl" style="font-size:10px;color:var(--muted)">${esc(l)}</div>
          ${j.errors?`<div style="font-size:10px;font-weight:700;color:#dc2626">${n(j.errors)} fail</div>`:`<div style="font-size:10px;color:var(--good);font-weight:700">✓</div>`}
        </button>`; };
    const wallet=get("topup"), refill=get("wallet_refill");
    const flowStrip=`<div style="border:1px solid var(--line);border-radius:12px;background:var(--card,#fff);padding:10px 14px;margin-bottom:12px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <b style="font-size:11.5px;min-width:86px">SALE FLOW<br><span class="rl" style="font-weight:600;font-size:9.5px;color:var(--muted)">this window</span></b>
        ${FLOW.map(fnode).join("")}
        <span style="flex:1"></span>
        <div class="rl" style="font-size:10px;color:var(--muted);text-align:right">wallet activity: <b>${n(wallet.calls)}</b> top-ups · <b>${n(refill.calls)}</b> refills<br>steps also serve other journeys — volumes, not a strict funnel</div>
      </div></div>`;

    const spark=(j)=>{ const M=mergeDaily(j.spark.map(x=>({t:x.t,calls:x.c,errors:x.e}))); const S=M.rows;
      if(S.length<2) return "";
      const w2=120,ht=26,max=Math.max(1,...S.map(x=>x.calls));
      const bw=Math.max(1.5,w2/S.length-1);
      return `<svg viewBox="0 0 ${w2} ${ht}" style="width:120px;height:26px">${S.map((x,i)=>{
        const bh=Math.max(1,(ht-2)*x.calls/max), eh=x.errors?Math.max(1,(ht-2)*x.errors/max):0, X=i*(w2/S.length);
        return `<rect x="${X}" y="${ht-bh}" width="${bw}" height="${bh}" fill="#0e9f5a" opacity=".5"/>`+
          (eh?`<rect x="${X}" y="${ht-eh}" width="${bw}" height="${eh}" fill="#dc2626" opacity=".9"/>`:"");
      }).join("")}</svg>`; };
    const fresh=(st)=>{ if(!st) return `<span style="color:#94a3b8">not synced yet</span>`;
      if(/error|not visible|no id|no timestamp/i.test(st.note||"")) return `<span style="color:#dc2626" title="${esc(st.note)}">⚠ ${esc((st.note||"").slice(0,34))}</span>`;
      if(/behind/i.test(st.note||"")) return `<span style="color:var(--warn-fg)">${esc(st.note)}</span>`;
      const age=(Date.now()-new Date(st.updated_at).getTime())/60000;
      return age<12?`<span style="color:var(--good)">● live</span>`:`<span style="color:var(--warn-fg)">● ${Math.round(age)}m ago</span>`; };
    const card=(j)=>{ const rate=j.calls?Math.round(1000*j.errors/j.calls)/10:0;
      return `<button class="dmsj-card" data-j="${j.key}" title="Click for the full breakdown: trend, response codes, APIs, dealers, failures" style="text-align:left;cursor:pointer;font:inherit;color:inherit;background:var(--card,#fff);border:1px solid var(--line);border-left:4px solid ${j.errors?(rate>=5?"#dc2626":rate>=1?"#d97706":"#16a34a"):"#16a34a"};border-radius:12px;padding:10px 13px;min-width:225px;flex:1">
        <div style="display:flex;align-items:center;gap:7px"><span>${j.icon||"•"}</span><b style="font-size:12px">${esc(j.label)}</b>
          <span style="margin-left:auto">${spark(j)}</span></div>
        <div style="display:flex;gap:13px;align-items:baseline;margin-top:5px">
          <span style="font-size:19px;font-weight:800">${n(j.calls)}</span>
          ${j.errors?`<span style="font-size:11.5px;font-weight:700;color:${rate>=5?"#dc2626":"#d97706"}">${n(j.errors)} fail${rate>=0.1?` (${rate}%)`:""}</span>`:`<span style="font-size:11.5px;color:var(--good);font-weight:700">✓ clean</span>`}
          ${j.peak_dealers?`<span class="rl" style="font-size:10px;color:var(--muted)">peak ${n(j.peak_dealers)} dealers/h</span>`:""}
        </div>
        <div class="rl" style="font-size:9.5px;margin-top:3px">${fresh(j.state)}${j.note?` · ${esc(j.note)}`:""}</div></button>`; };

    box.innerHTML=`
      <div class="topo-card" style="padding:10px 12px;background:var(--card,#fff);margin-bottom:12px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b style="font-size:12px">Journey trace</b>
          <span class="rl" style="font-size:10.5px;color:var(--muted)">one MSISDN · national ID · reference → every DMS step it touched, in order</span>
          <input id="djq" placeholder="e.g. 9665… / 10… / logs reference" style="flex:1 1 240px;min-width:200px;font:inherit;font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
          <button id="djgo" class="btn" style="font-size:12px;padding:6px 14px">Trace</button>
          ${canUnmask()?`<button id="djTUm" class="pill" title="Reveal identifiers in trace results — recorded in the audit log" style="font-size:11px;padding:5px 11px;${um()?"border-left-color:#dc2626":""}">${um()?"🔓 Unmasked":"🔒 Masked"}</button>`:""}
          <span id="djmsg" class="rl" style="font-size:10.5px;color:var(--muted)"></span></div>
        <div id="djtrace" style="margin-top:8px"></div></div>
      ${flowStrip}
      <div style="display:flex;gap:10px;flex-wrap:wrap">${J.map(card).join("")||`<div class="rl">No journey data in this range yet.</div>`}</div>
      ${silent.length?`<div class="rl" style="font-size:10px;color:var(--muted);margin-top:7px">No traffic in range: ${silent.map(x=>esc(x.label)).join(" · ")}</div>`:""}
      <div id="djdrill" style="margin-top:12px"></div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-top:8px">Source: Clara <span class="mono">dms_audit_logs</span> — written by the DMS services themselves. Aggregated every 5 min; identifiers masked at ingest. Failure = code that looks 4xx/5xx/E*/FAIL (code semantics to be confirmed with the DMS team). <b>Cards, flow steps, chart bars, code chips and dealers are clickable.</b></div>`;
    box.querySelectorAll(".dmsj-card,.dmsj-flow").forEach(b=>b.addEventListener("click",()=>drill(b.dataset.j)));
    const go=()=>trace(($("#djq")||{}).value);
    $("#djgo").onclick=go;
    $("#djq").addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
    const tum=$("#djTUm"); if(tum) tum.onclick=()=>{
      window.PII.set(!window.PII.on);
      tum.textContent=um()?"🔓 Unmasked":"🔒 Masked";
      tum.style.borderLeftColor=um()?"#dc2626":"";
      if((($("#djq")||{}).value||"").trim()) go();   // re-run with the new mode (audited server-side)
    };
  }

  /* ---- drill: one journey, everything clickable ---- */
  let _d=null,_M=null,_codeFilter=null,_focus=null,_rows=[],_nextBefore=null,_rowsFilter="",_evBackup=[];
  async function drill(key){
    const host=$("#djdrill"); if(!host) return;
    host.innerHTML=`<div class="rl">Loading ${esc(key)}…</div>`;
    try{ _d=await api(`/api/dms/journeys/${encodeURIComponent(key)}?from=${encodeURIComponent(W.from)}&to=${encodeURIComponent(W.to)}`); }
    catch(e){ host.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    _M=mergeDaily(_d.hourly||[]); _codeFilter=null; _focus=null;
    _rows=[]; _nextBefore=null; _rowsFilter="";
    _evBackup=(_d.events||[]).map(e=>({...e}));
    if(um()) await applyEventMask();   // global PII mode carries over (audited per fetch server-side)
    paintDrill();
    loadRows(true);
    host.scrollIntoView({behavior:"smooth",block:"nearest"});
    if(window.audit) window.audit("VIEW_PAGE","#dms?journey="+key);
  }
  function paintDrill(){
    const host=$("#djdrill"), d=_d, M=_M; if(!host||!d) return;
    const rows=M.rows, max=Math.max(1,...rows.map(r=>Number(r.calls)));
    const bars=rows.map((r,i)=>`<div class="dj-bar" data-i="${i}" title="${esc(lbl(r.t,M.unit))} · ${n(r.calls)} calls · ${n(r.errors)} fail · click for this ${M.unit}'s codes, APIs and dealers" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:56px;min-width:4px;cursor:pointer;${_focus===i?"outline:2px solid #0e9f5a;outline-offset:1px;border-radius:2px;":""}">
        ${Number(r.errors)?`<div style="background:#dc2626;height:${Math.max(2,Math.round(50*r.errors/max))}px"></div>`:""}
        <div style="background:#0e9f5a;opacity:${_focus==null||_focus===i?".6":".22"};height:${Math.max(2,Math.round(50*(r.calls-r.errors)/max))}px"></div>
      </div>`).join("");
    const F=_focus!=null?rows[_focus]:null;
    const chipRow=(obj,tone)=>Object.entries(obj||{}).sort((a,z)=>z[1]-a[1]).slice(0,10)
      .map(([v,c])=>`<span class="mono" style="font-size:10px;border:1px solid var(--line);border-radius:6px;padding:1px 7px;color:${tone==="code"&&/^[45]|^E|FAIL/i.test(v)?"#dc2626":"var(--muted)"}">${esc(v)} × ${n(c)}</span>`).join(" ");
    const focusPanel=F?`<div style="border:1px solid #0e9f5a;border-radius:10px;padding:8px 12px;margin:8px 0;background:rgba(14,159,90,.05)">
        <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:4px">
          <b style="font-size:11.5px">${esc(lbl(F.t,M.unit))} — this ${M.unit} only</b>
          <span class="rl" style="font-size:10.5px"><b>${n(F.calls)}</b> calls · <b style="color:${F.errors?"#dc2626":"#16a34a"}">${n(F.errors)}</b> fail · ${n(F.dealers)} dealers</span>
          <button class="pill" id="djFx" style="margin-left:auto;font-size:10px;padding:1px 8px">clear</button></div>
        <div class="rl" style="font-size:10px;margin:3px 0"><b>codes</b> ${chipRow(F.codes,"code")||"—"}</div>
        <div class="rl" style="font-size:10px;margin:3px 0"><b>APIs</b> ${chipRow(F.apis)||"—"}</div>
        <div class="rl" style="font-size:10px;margin:3px 0"><b>dealers</b> ${Object.entries(F.top_dealers||{}).sort((a,z)=>z[1]-a[1]).slice(0,8).map(([v,c])=>`<button class="mono dj-dlr" data-d="${esc(v)}" style="cursor:pointer;background:none;font-size:10px;border:1px solid var(--line);border-radius:6px;padding:1px 7px;color:inherit" title="Open in Dealer 360">${esc(v)} × ${n(c)}</button>`).join(" ")||"—"}</div>
      </div>`:"";
    const codes=(d.codes||[]).map(x=>`<button class="mono dj-code" data-c="${esc(x.code)}" style="cursor:pointer;background:${_codeFilter===x.code?"rgba(220,38,38,.1)":"none"};font-size:10px;border:1px solid ${_codeFilter===x.code?"#dc2626":"var(--line)"};border-radius:6px;padding:1px 7px;color:${/^[45]|^E|FAIL/i.test(x.code)?"#dc2626":"var(--muted)"}" title="Click to filter the failures table">${esc(x.code)} × ${n(x.n)}</button>`).join(" ");
    const apis=(d.apis||[]).slice(0,8).map(x=>`<div style="display:flex;gap:8px;font-size:10.5px;padding:1px 0"><span class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.v)}">${esc(x.v)}</span><b>${n(x.n)}</b></div>`).join("");
    const dlrs=(d.top_dealers||[]).slice(0,8).map(x=>`<div style="display:flex;gap:8px;font-size:10.5px;padding:1px 0"><button class="mono dj-dlr" data-d="${esc(x.v)}" style="cursor:pointer;background:none;border:none;color:inherit;font-size:10.5px;padding:0;text-decoration:underline dotted;flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Open in Dealer 360">${esc(x.v)}</button><b>${n(x.n)}</b></div>`).join("");
    let evs=(d.events||[]);
    if(_codeFilter) evs=evs.filter(r=>r.code===_codeFilter);
    if(F){ const t0=new Date(M.unit==="day"?F.t+"T00:00:00+03:00":F.t).getTime(), t1=t0+(M.unit==="day"?864e5:36e5);
      evs=evs.filter(r=>{ const t=new Date(r.at).getTime(); return t>=t0&&t<t1; }); }
    const evRows=evs.slice(0,50).map(r=>`<tr class="dj-ev" data-id="${r.src_id||""}" title="Click for every column of this row + its trace" style="cursor:pointer">
      <td class="mono rl" style="padding:2px 6px;white-space:nowrap">${esc(KT.md(r.at))}Z</td>
      <td>${r.dealer?`<button class="mono dj-dlr" data-d="${esc(r.dealer)}" style="cursor:pointer;background:none;border:none;color:inherit;font-size:10.5px;padding:0;text-decoration:underline dotted">${esc(r.dealer)}</button>`:"—"}</td>
      <td class="mono">${esc(r.msisdn||"—")}</td>
      <td class="mono" style="color:#dc2626;font-weight:700">${esc(r.code||"—")}</td>
      <td class="rl" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.message||"")}">${esc((r.message||"").slice(0,80))}</td>
      <td class="rl" style="font-size:10px;color:var(--muted)">${esc(r.api||"")}</td>
      <td>${r.ref?`<button class="pill dj-ref" data-ref="${esc(r.ref)}" title="Trace this reference across all journeys" style="padding:1px 7px;font-size:10px">⇄ ${esc(String(r.ref).slice(0,14))}</button>`:""}</td></tr>`).join("");
    host.innerHTML=`<div class="topo-card" style="border-left:3px solid #0e9f5a;padding:10px 12px;background:var(--card,#fff)">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <b style="font-size:12px">${esc(d.label)}</b>
        ${d.note?`<span class="rl" style="font-size:10px;color:var(--muted)">${esc(d.note)}</span>`:""}
        <span class="mono rl" style="font-size:9.5px;color:var(--muted)">${esc(d.source&&d.source.table||"")}</span>
        ${canUnmask()?`<button class="pill" id="djUm" title="${um()?"Identifiers shown in full — recorded in the audit log":"Reveal identifiers in this drill (All calls, failures). The action is recorded in the audit log."}" style="margin-left:auto;font-size:11px;padding:2px 10px;${um()?"border-left-color:#dc2626":""}">${um()?"🔓 Unmasked — hide":"🔒 Masked — reveal"}</button>`:""}
        <button class="pill" id="djX" style="${canUnmask()?"":"margin-left:auto;"}font-size:11px;padding:2px 10px">✕ close</button></div>
      ${um()?`<div style="border:1px solid #dc2626;border-radius:9px;padding:5px 11px;margin-bottom:8px;background:rgba(220,38,38,.06);font-size:11px;font-weight:700;color:#dc2626">🔓 Identifiers shown in full — this reveal is recorded in the audit log.</div>`:""}
      <div class="rl" style="font-size:9.5px;color:var(--muted);margin-bottom:2px">per ${M.unit} — green ok · red fail · <b>click a bar</b> to break it down</div>
      <div style="display:flex;gap:2px;align-items:flex-end;margin-bottom:4px">${bars||'<span class="rl">no data in range</span>'}</div>
      ${focusPanel}
      ${codes?`<div style="margin:6px 0"><b style="font-size:11px">Response codes</b> <span class="rl" style="font-size:9.5px;color:var(--muted)">(every call · click to filter failures)</span><br>${codes}</div>`:""}
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin:6px 0">
        ${apis?`<div style="flex:1;min-width:230px"><b style="font-size:11px">Top APIs</b>${apis}</div>`:""}
        ${dlrs?`<div style="flex:1;min-width:210px"><b style="font-size:11px">Top dealers</b> <span class="rl" style="font-size:9px;color:var(--muted)">click → Dealer 360</span>${dlrs}</div>`:""}
      </div>
      <b style="font-size:11px">Failures</b> <span class="rl" style="font-size:9.5px;color:var(--muted)">${_codeFilter?`filtered: ${esc(_codeFilter)} · `:""}${F?`in selected ${M.unit} · `:""}masked · ⇄ traces the reference</span>
      ${evRows?`<table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-top:4px"><tr><th style="text-align:left;font-size:9.5px;color:var(--muted);padding:2px 6px">AT</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">DEALER</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">MSISDN</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">CODE</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">MESSAGE</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">API</th><th></th></tr>${evRows}</table>`
        :`<div class="rl" style="color:var(--good);font-size:11px;margin-top:4px">No failures${_codeFilter||F?" matching this selection":""} in this range.</div>`}
      <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
        <b style="font-size:11px">All calls</b>
        <span class="rl" style="font-size:9.5px;color:var(--muted)">every row, success included · latest first · live from the DMS table${_codeFilter?` · <b style="color:var(--warn-fg)">filtered server-side: code ${esc(_codeFilter)}</b> (click the chip again to clear)`:""}</span>
        <input id="djRF" value="${esc(_rowsFilter)}" placeholder="filter loaded rows… code / dealer / api / number" style="flex:1 1 220px;min-width:180px;font:inherit;font-size:11px;padding:4px 8px;border:1px solid var(--line);border-radius:7px;background:var(--card,#fff);color:inherit">
        <span id="djRn" class="rl" style="font-size:10px;color:var(--muted)"></span></div>
      <div id="djRows" style="margin-top:4px"><div class="rl" style="font-size:10.5px">Loading latest calls…</div></div></div>`;
    $("#djX").onclick=()=>{ host.innerHTML=""; _d=null; };
    const umBtn=$("#djUm"); if(umBtn) umBtn.onclick=async()=>{
      window.PII.set(!window.PII.on);
      await applyEventMask();     // failures: live re-fetch by PK when revealing, backup when hiding
      paintDrill();
      loadRows(true);             // All calls: refetch with/without unmask (server audits pii.unmask)
    };
    const fx=$("#djFx"); if(fx) fx.onclick=()=>{ _focus=null; paintDrill(); };
    host.querySelectorAll(".dj-bar").forEach(b=>b.addEventListener("click",()=>{ _focus=(_focus===Number(b.dataset.i))?null:Number(b.dataset.i); paintDrill(); }));
    host.querySelectorAll(".dj-code").forEach(b=>b.addEventListener("click",()=>{
      _codeFilter=(_codeFilter===b.dataset.c)?null:b.dataset.c;
      paintDrill();
      loadRows(true);          // All calls refetches with the code filter applied on the SERVER
    }));
    host.querySelectorAll(".dj-ev").forEach(row=>row.addEventListener("click",()=>{ if(row.dataset.id) openRowPopup(_d&&_d.key,row.dataset.id); }));
    host.querySelectorAll(".dj-dlr").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); openDealer360(b.dataset.d); }));
    host.querySelectorAll(".dj-ref").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); const q=$("#djq"); if(q) q.value=b.dataset.ref; trace(b.dataset.ref); }));
    const rf=$("#djRF"); if(rf){ let tm=null; rf.addEventListener("input",()=>{ clearTimeout(tm);
      tm=setTimeout(()=>{ _rowsFilter=rf.value.trim().toLowerCase(); const p=rf.selectionStart; paintRows(); const r2=$("#djRF"); if(r2){ r2.focus(); r2.setSelectionRange(p,p); } },250); }); }
    if(_rows.length) paintRows();
  }

  /* ---- All-calls browser: live PK-paged rows, client-side quick filter ---- */
  async function loadRows(reset){
    if(!_d) return;
    const holder=$("#djRows"); if(!holder) return;
    try{
      const ps=new URLSearchParams();
      if(_nextBefore&&!reset) ps.set("before",_nextBefore);
      if(um()) ps.set("unmask","1");
      if(_codeFilter) ps.set("code",_codeFilter);   // server-side code filter (the chip)
      const qs=ps.toString();
      const r=await api(`/api/dms/journeys/${encodeURIComponent(_d.key)}/rows${qs?"?"+qs:""}`);
      _rows=reset?r.rows:_rows.concat(r.rows);
      _nextBefore=r.next_before;
      paintRows();
    }catch(e){ holder.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; }
  }
  /* failures live in the console DB MASKED (masked at ingest, by design). Revealing them
   * re-fetches the SAME rows from the DMS source by primary key — audited server-side. */
  async function applyEventMask(){
    if(!_d) return;
    if(!um()){ _d.events=_evBackup.map(e=>({...e})); return; }
    const ids=(_d.events||[]).map(e=>e.src_id).filter(Boolean);
    if(!ids.length) return;
    try{
      const r=await api(`/api/dms/journeys/${encodeURIComponent(_d.key)}/rows?ids=${ids.slice(0,150).join(",")}&unmask=1`);
      const by=new Map((r.rows||[]).map(x=>[Number(x.id),x]));
      _d.events=_d.events.map(e=>{ const f=by.get(Number(e.src_id));
        return f?{...e,msisdn:f.msisdn,customer:f.customer,message:f.message??e.message}:e; });
    }catch(e){ /* stay masked on failure */ window.PII.set(false); }
  }
  function paintRows(){
    const holder=$("#djRows"), cnt=$("#djRn"); if(!holder) return;
    let rows=_rows;
    if(_rowsFilter) rows=rows.filter(r=>[r.code,r.dealer,r.api,r.msisdn,r.customer,r.message,r.ref]
      .some(v=>v&&String(v).toLowerCase().includes(_rowsFilter)));
    if(cnt) cnt.textContent=`${rows.length.toLocaleString()} shown${_rowsFilter?` of ${_rows.length.toLocaleString()} loaded`:" (loaded)"}`;
    const tr=rows.slice(0,400).map(r=>`<tr class="dj-row" data-id="${r.id}" title="Click for every column of this row + its cross-journey trace" style="cursor:pointer;border-top:1px solid var(--line);${r.err?"background:rgba(220,38,38,.04)":""}">
      <td class="mono rl" style="padding:2px 6px;white-space:nowrap">${esc(KT.md(r.at))}Z</td>
      <td>${r.dealer?`<button class="mono dj-dlr" data-d="${esc(r.dealer)}" style="cursor:pointer;background:none;border:none;color:inherit;font-size:10.5px;padding:0;text-decoration:underline dotted">${esc(r.dealer)}</button>`:"—"}</td>
      <td class="mono">${esc(r.msisdn||"—")}</td><td class="mono">${esc(r.customer||"—")}</td>
      <td class="mono" style="font-weight:700;color:${r.err?"#dc2626":"#16a34a"}">${esc(r.code||"—")}</td>
      <td class="rl" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.message||"")}">${esc((r.message||"").slice(0,70))}</td>
      <td class="rl" style="font-size:10px;color:var(--muted)">${esc(r.api||"")}</td>
      <td>${r.ref?`<button class="pill dj-ref2" data-id="${r.id}" style="padding:1px 7px;font-size:10px" title="Full row + trace across all journeys">⇄</button>`:""}</td></tr>`).join("");
    holder.innerHTML=tr
      ?`<div style="max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:9px"><table style="width:100%;border-collapse:collapse;font-size:10.5px">
          <tr><th style="text-align:left;font-size:9.5px;color:var(--muted);padding:3px 6px">AT</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">DEALER</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">MSISDN</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">CUSTOMER</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">CODE</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">MESSAGE</th><th style="text-align:left;font-size:9.5px;color:var(--muted)">API</th><th></th></tr>${tr}</table></div>`
        +(_nextBefore?`<button id="djRmore" class="pill" style="margin-top:6px;font-size:11px;padding:3px 12px">Load ${_rowsFilter?"more (older)":"100 more"}</button>`:`<div class="rl" style="font-size:9.5px;color:var(--muted);margin-top:4px">end of table</div>`)
      :`<div class="rl" style="font-size:10.5px;padding:4px 0">${_rows.length?"No loaded rows match the filter — Load more to search older rows.":"No rows."}${_nextBefore?"":""}</div>`
        +(_nextBefore&&!tr?`<button id="djRmore" class="pill" style="margin-top:4px;font-size:11px;padding:3px 12px">Load more (older)</button>`:"");
    const more=$("#djRmore"); if(more) more.addEventListener("click",()=>loadRows(false));
    holder.querySelectorAll(".dj-row").forEach(row=>row.addEventListener("click",()=>openRowPopup(_d&&_d.key,row.dataset.id)));
    holder.querySelectorAll(".dj-dlr").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); openDealer360(b.dataset.d); }));
    holder.querySelectorAll(".dj-ref2").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); openRowPopup(_d&&_d.key,b.dataset.id); }));
  }

    async function trace(q){
    const out=$("#djtrace"), msg=$("#djmsg"); if(!out) return;
    q=String(q||"").trim(); if(!q) return;
    /* a DEALER code (dis_012125, pos_019361, rtl_371327934…) is not a customer identifier — the digit trace would follow
       a stranger's number. Open the dealer instead: profile + everything the dealer did in DMS (17 Sep 2026). */
    if(/^[a-z]{2,5}_\d{3,}$/i.test(q)){
      out.innerHTML=`<div class="rl" style="font-size:11px"><b>${esc(q)}</b> is a dealer code — opening the dealer's own activity (every DMS ledger, journeys + list). For a customer story, trace an MSISDN, national ID or reference.</div>`;
      openDealer360(q); return;
    }
    out.innerHTML=`<div class="rl">Tracing ${esc(q.length>18?q.slice(0,18)+"…":q)} …</div>`; if(msg) msg.textContent="";
    let d; try{ d=await api(`/api/dms/journeys/trace?q=${encodeURIComponent(q)}${um()?"&unmask=1":""}`); }
    catch(e){ out.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    if(!(d.hits||[]).length){
      /* TKT-000016 follow-through: a hex trace/log reference (the app's "log reference ID") is
       * NOT a DMS reference — the honest "no match" here left agents at a dead end while the
       * cross-system timeline CAN resolve it (case analyzer / payment refs). Hand off instead. */
      const looksForeign=/^[0-9a-f]{12,64}$/i.test(q)&&/[a-f]/i.test(q)&&!/^9665\d{8}$/.test(q);
      out.innerHTML=`<div class="rl" style="padding:6px 0">No DMS journey rows matched. Scanned: ${esc((d.scanned||[]).join(", ")||"none")}.${(d.skipped||[]).length?` <span style="color:var(--muted)">Skipped (no usable index): ${esc(d.skipped.map(x=>x.key).join(", "))}</span>`:""}</div>`
        +(looksForeign?`<div class="okbox" style="border-left:3px solid var(--tint-amber-fg,#d97706);margin-top:4px">
          This looks like an <b>app trace / log reference</b> (what the mobile app shows in its error dialog) — those never appear in the DMS ledgers.
          <button class="pill" id="djForeignTl" style="margin-inline-start:8px;padding:2px 10px;font-size:11px;border-left-color:var(--green,#0e9f5a)">⇄ Resolve it in the cross-system timeline</button></div>`:"");
      const fb=$("#djForeignTl");
      if(fb) fb.addEventListener("click",()=>{ if(window.opsOpenTimeline) window.opsOpenTimeline(q,null,null); });
      return;
    }
    const rows=d.hits.map(h=>`<div style="display:flex;gap:9px;align-items:baseline;padding:4px 0;border-top:1px solid var(--line)">
      <span class="mono rl" style="font-size:10px;white-space:nowrap;color:var(--muted)">${esc(KT.md(h.at))}Z</span>
      <span>${h.icon||"•"}</span><b style="font-size:11.5px;min-width:120px">${esc(h.label)}</b>
      <span class="mono" style="font-size:10.5px;font-weight:700;color:${h.err?"#dc2626":"#16a34a"}">${esc(h.code||"—")}</span>
      ${h.msisdn?`<span class="mono" style="font-size:10px">${esc(h.msisdn)}</span>`:""}
      <span class="rl" style="flex:1;font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(h.message||"")}">${esc(h.message||h.api||"")}</span>
      ${h.dealer?`<button class="mono dj-dlr" data-d="${esc(h.dealer)}" style="cursor:pointer;background:none;border:none;color:inherit;font-size:10px;padding:0;text-decoration:underline dotted">${esc(h.dealer)}</button>`:""}</div>`).join("");
    out.innerHTML=`<div style="border:1px solid ${d.unmasked?"#dc2626":"var(--line)"};border-radius:10px;padding:8px 12px;background:var(--card2,rgba(148,163,184,.06))">
      ${d.unmasked?`<div style="font-size:10.5px;font-weight:700;color:#dc2626;margin-bottom:3px">🔓 Identifiers shown in full — recorded in the audit log.</div>`:""}
      <div class="rl" style="font-size:10.5px;margin-bottom:2px"><b>${n(d.hits.length)}</b> step(s), oldest first — the full DMS story of ${esc(d.q)}
        <span style="color:var(--muted)">· scanned ${esc((d.scanned||[]).join(", "))}${(d.skipped||[]).length?` · skipped: ${esc(d.skipped.map(x=>x.key).join(", "))}`:""}</span></div>
      ${rows}</div>`;
    out.querySelectorAll(".dj-dlr").forEach(b=>b.addEventListener("click",()=>openDealer360(b.dataset.d)));
  }

  window.renderDmsJourneys=render;
  window.openDealerPopup=openDealer360;   // used by the ③ commissioning board (dms.js)
  window.openDmsRowPopup=openRowPopup;    // used by dmsactivity.js (dealer activity rows → full ledger row + trace)
})();
