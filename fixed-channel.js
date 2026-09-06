/* fixed-channel.js — Fixed › E-purchase and Fixed › Salam Home (one renderer, two pages).
 * MVNO-Dashboard style: customisable sections (pick + order, saved per user), every section split by product —
 * FTTX (FTTH and FTTB reported apart) | 5G home,
 * business and technical findings generated from the numbers. Data: /api/fixed/channel/:channel/all (fail-soft per
 * section). Contract: docs/FIXED-PAGES-CONTRACT.md — registers window.FIXED_PAGES.epurchase / .salamhome. */
(function(){
  "use strict";
  window.FIXED_PAGES = window.FIXED_PAGES || {};
  const SECTIONS=[
    ["kpis","KPIs","volume · conversion · orders · time · identity — vs the previous window"],
    ["findings","Findings","business and technical findings generated from this window"],
    ["journeys","Journeys","every workflow of the channel — attempts, outcomes, conversion, time"],
    ["flows","Flows","step funnel per journey — where customers leave"],
    ["plans","Plans","which plans customers pick — share and conversion"],
    ["campaigns","Campaigns","referral / QR codes vs consumer-direct"],
    ["payments","Payments","payments_v2 — success rate, methods, declines, money at risk"],
    ["errors","Errors","error control board categories — business rule vs fault"],
    ["integrations","Integrations","BSS · identity · payments calls — failure rate, p50 / p95"],
    ["regions","Regions","attempts, conversion, coverage and appointment failures by region"]];
  const SEGC={ftth:"#0e9f5a",fttb:"#7c3aed","5g":"#2563eb",other:"#94a3b8"};   // FTTX = FTTH + FTTB, always shown apart
  const SEV={P1:"#dc2626",P2:"#d97706",P3:"#2563eb",info:"#0e9f5a"};
  const $=(s,r)=>(r||document).querySelector(s);
  const sess=()=>(window.opsSession?window.opsSession():{});
  const num=v=>v==null||isNaN(v)?"—":Number(v).toLocaleString("en-US");
  const money=v=>v==null?"—":Number(v).toLocaleString("en-US",{maximumFractionDigits:0})+" SAR";
  const delta=(c,p)=>{ if(p==null||!p||c==null) return ""; const d=(c-p)/p; if(Math.abs(d)<.005) return `<span style="color:var(--muted);font-size:11px">= prev</span>`; return `<span style="color:${d>=0?"#0e9f5a":"#dc2626"};font-size:11px;font-weight:700">${d>=0?"▲":"▼"} ${Math.abs(d*100).toFixed(0)}%</span>`; };
  const pts=(c,p)=>{ if(p==null||c==null) return ""; const d=Math.round((c-p)*10)/10; if(!d) return ""; return `<span style="color:${d>=0?"#0e9f5a":"#dc2626"};font-size:11px;font-weight:700">${d>=0?"▲":"▼"} ${Math.abs(d)} pts</span>`; };
  const segTag=(k,l)=>`<span class="fxc-seg" style="--c:${SEGC[k]||"#94a3b8"}">${l||k}</span>`;
  const sevPill=s=>`<span style="display:inline-block;min-width:26px;text-align:center;font-size:10px;font-weight:800;color:#fff;background:${SEV[s]||"#64748b"};border-radius:6px;padding:1px 6px">${s==="info"?"trend":s}</span>`;

  /* ---- persisted section choice (per channel, per user; localStorage fallback) ---- */
  function chosen(ch){
    try{ const me=sess().me; const d=me&&me.dashboard&&me.dashboard.fixed&&me.dashboard.fixed[ch]; if(Array.isArray(d)&&d.length) return d.filter(k=>SECTIONS.find(s=>s[0]===k)); }catch(_){}
    try{ const l=JSON.parse(localStorage.getItem("fixed_sections_"+ch)||"null"); if(Array.isArray(l)&&l.length) return l.filter(k=>SECTIONS.find(s=>s[0]===k)); }catch(_){}
    return SECTIONS.map(s=>s[0]);
  }
  async function saveChosen(ch,list,FX){
    try{ localStorage.setItem("fixed_sections_"+ch,JSON.stringify(list)); }catch(_){}
    try{ const s=sess(); const dash=Object.assign({},(s.me&&s.me.dashboard)||{}); dash.fixed=Object.assign({},dash.fixed||{},{[ch]:list});
      await fetch((window.API_BASE||window.CONSOLE_BASE||"")+"/api/me/dashboard",{method:"PUT",headers:{"Content-Type":"application/json","X-Console-Role":localStorage.getItem("cons_role")||"","X-Console-User":localStorage.getItem("cons_email")||""},body:JSON.stringify(dash)});
      if(s.me) s.me.dashboard=dash; }catch(_){}
  }

  /* ---- page ---- */
  function makePage(ch,label){
    let segView=localStorage.getItem("fixed_segview_"+ch)||"";   // "" = side by side · ftth · 5g
    async function render(host,FX){
      ensureCss();
      const {esc,ts}=FX;
      host.innerHTML=`<div class="fxc-top">
          <div><div class="fxc-title">${esc(label)} <span class="rl fxc-sub" id="fxcMeta">loading…</span></div></div>
          <div class="fxc-tools">
            <span class="rl" style="font-size:11px;color:var(--muted);font-weight:700">Product</span>
            ${[["","FTTX + 5G side by side"],["ftth","FTTH"],["fttb","FTTB"],["5g","5G home"]].map(([k,l])=>`<button class="fxc-chip ${segView===k?"on":""}" data-seg="${k}" style="--c:${SEGC[k]||"#0f172a"}">${l}</button>`).join("")}
            <button class="btn fxc-cust" id="fxcCustomize" style="font-size:11.5px;padding:6px 12px">⚙ Customize sections</button>
          </div></div>
        <div id="fxcBody"><div style="padding:30px;text-align:center;color:var(--muted)">${window.salamLoader?window.salamLoader("Reading "+label+" data…"):"Loading…"}</div></div>`;
      host.querySelectorAll(".fxc-chip").forEach(b=>b.onclick=()=>{ segView=b.dataset.seg; localStorage.setItem("fixed_segview_"+ch,segView); render(host,FX); });
      $("#fxcCustomize",host).onclick=()=>customize(ch,FX,()=>render(host,FX));
      let data;
      try{ data=await FX.api(`/api/fixed/channel/${ch}/all?${FX.qs().replace(/&channel=[^&]*/,"")}${segView?`&segment=${segView}`:""}`); }
      catch(e){ $("#fxcBody",host).innerHTML=`<div class="albanner" style="border-left:4px solid #dc2626;padding:14px 16px"><b>${esc(label)} unavailable</b> — ${esc(e.message)}</div>`; return; }
      const S=data.sections, k=S.kpis;
      $("#fxcMeta",host).innerHTML=`· ${esc(data.desc)}${k&&!k.error?` · source <span class="mono">${esc(k.source)}</span> · ${ts(k.window.from).slice(0,10)} → ${ts(k.window.to).slice(0,10)} vs previous window · data since ${k.coverage&&k.coverage.oldest?ts(k.coverage.oldest).slice(0,10):"—"}`:""}${FX.state.channel&&FX.state.channel!==ch?` · <span style="color:#d97706">hub channel filter ignored on this page</span>`:""}`;
      const order=chosen(ch); const R={kpis:secKpis,findings:secFindings,journeys:secJourneys,flows:secFlows,plans:secPlans,campaigns:secCampaigns,payments:secPayments,errors:secErrors,integrations:secIntegrations,regions:secRegions};
      $("#fxcBody",host).innerHTML=order.map(key=>{ const meta=SECTIONS.find(s=>s[0]===key); const part=key==="findings"?S.findings:S[key];
        let body; try{ body=part&&part.error?`<div class="fxc-err">${esc(part.error)}</div>`:R[key](part,S,FX,segView); }catch(e){ body=`<div class="fxc-err">render failed — ${esc(e.message)}</div>`; }
        return `<section class="fxc-sec" id="fxc-${key}"><div class="fxc-sech"><h3>${esc(meta[1])}</h3><span class="rl">${esc(meta[2])}</span></div>${body}</section>`; }).join("");
      host.querySelectorAll("[data-goto]").forEach(a=>a.onclick=e=>{ e.preventDefault(); const t=$("#fxc-"+a.dataset.goto,host); if(t) t.scrollIntoView({behavior:"smooth",block:"start"}); });
    }
    return { label, render };
  }

  /* ---- helpers for the split layout ---- */
  const has=(rows,k)=>rows.some(r=>r.segment===k&&(r.n||r.attempts||(r.now&&r.now.attempts)));
  const segsOf=(rows,view)=>{ if(view) return [view]; const ks=[]; for(const k of ["ftth","fttb","5g","other"]) if(has(rows,k)) ks.push(k); return ks.length?ks:["ftth"]; };
  const absent=(rows)=>["ftth","fttb","5g"].filter(k=>!has(rows,k));
  const twoCol=(cols)=>`<div class="fxc-cols" style="grid-template-columns:repeat(${cols.length},minmax(0,1fr))">${cols.join("")}</div>`;
  const spark=(series,color,h)=>{ const H=h||40; const max=Math.max(1,...series.map(x=>x.n)); return `<div class="fxc-spark" style="height:${H}px">${series.map(x=>`<div title="${x.day} · ${num(x.n)} attempts · ${num(x.completed)} completed" style="height:${Math.max(2,Math.round(H*x.n/max))}px;background:linear-gradient(180deg,${color} ${x.n?Math.round(100*x.completed/x.n):0}%,var(--line) 0)"></div>`).join("")}</div>`; };
  const hbar=(v,max,c)=>`<div class="fxc-hbar"><div style="width:${max?Math.min(100,Math.round(100*v/max)):0}%;background:${c||"var(--green,#0e9f5a)"}"></div></div>`;
  const dayKey=d=>String(d).slice(0,10);
  const split2=(label,parts)=>{ const tot=parts.reduce((a,p)=>a+(Number(p[1])||0),0); return `<div class="fxc-split"><div class="fxc-kpi-l">${label}</div><div class="fxc-splitbar">${parts.map(p=>`<div title="${p[0]} ${num(p[1])}" style="width:${tot?Math.round(100*(Number(p[1])||0)/tot):0}%;background:${p[2]}"></div>`).join("")}</div><div class="fxc-splitl">${parts.map(p=>`<span><i style="background:${p[2]}"></i>${p[0]} <b>${num(p[1])}</b>${tot?` <span style="color:var(--muted)">${Math.round(100*(Number(p[1])||0)/tot)}%</span>`:""}</span>`).join("")}</div></div>`; };
  const PAL=["#0e9f5a","#2563eb","#d97706","#dc2626","#7c3aed","#0891b2","#94a3b8"];
  const stacked=(days,keys,h)=>{ const H=h||60; const max=Math.max(1,...days.map(d=>d.total)); return `<div class="fxc-spark" style="height:${H}px">${days.map(d=>{ let acc=0; return `<div title="${d.day} · ${num(d.total)}${keys.map(k=>d.steps[k]?` · ${k} ${d.steps[k]}`:"").join("")}" style="height:${Math.max(2,Math.round(H*d.total/max))}px;display:flex;flex-direction:column-reverse;background:none">${keys.map((k,i)=>d.steps[k]?`<span style="display:block;height:${Math.round(100*d.steps[k]/d.total)}%;background:${PAL[i%PAL.length]}"></span>`:"").join("")}</div>`; }).join("")}</div><div class="fxc-legend">${keys.map((k,i)=>`<span><i style="background:${PAL[i%PAL.length]}"></i>${k}</span>`).join("")}</div>`; };
  const hourChart=(rows,h)=>{ const H=h||56; const by={}; for(const r of rows) by[r.hour]=r; const max=Math.max(1,...rows.map(r=>r.n)); return `<div class="fxc-spark" style="height:${H}px">${Array.from({length:24},(_,i)=>{ const r=by[i]||{n:0,paid:0}; return `<div title="${String(i).padStart(2,"0")}:00 KSA · ${num(r.n)} payments · ${num(r.paid)} paid" style="height:${Math.max(2,Math.round(H*r.n/max))}px;background:linear-gradient(180deg,#0e9f5a ${r.n?Math.round(100*r.paid/r.n):0}%,#fca5a5 0)"></div>`; }).join("")}</div><div class="fxc-hours">${["00","06","12","18","23"].map(x=>`<span>${x}h</span>`).join("")}</div>`; };

  /* ---- sections ---- */
  function secKpis(k,S,FX,view){
    const {esc}=FX; const segs=segsOf(k.segments,view);
    const col=(sg)=>{ const c=sg.now, p=sg.prev||{};
      if(!c) return `<div class="fxc-segcard" style="--c:${SEGC[sg.segment]}"><div class="fxc-segh">${segTag(sg.segment,sg.label)}</div><div class="rl" style="color:var(--muted);font-size:12px;padding:8px 0">no attempts in this window</div></div>`;
      const days=k.byDay.filter(d=>d.segment===sg.segment).map(d=>({day:dayKey(d.day),n:d.n,completed:d.completed}));
      const t=(l,v,d,sub)=>`<div class="fxc-kpi"><div class="fxc-kpi-l">${l}</div><div class="fxc-kpi-v">${v} ${d||""}</div>${sub?`<div class="fxc-kpi-s">${sub}</div>`:""}</div>`;
      return `<div class="fxc-segcard" style="--c:${SEGC[sg.segment]}"><div class="fxc-segh">${segTag(sg.segment,sg.label)}<span class="rl" style="color:var(--muted);font-size:11px">${num(c.customers)} distinct customers</span></div>
        <div class="fxc-kpis">
          ${t("Attempts",num(c.attempts),delta(c.attempts,p.attempts),`${num(c.in_progress)} in progress · ${num(c.stalled)} stalled · ${num(c.abandoned)} abandoned`)}
          ${t("Completed",num(c.completed),delta(c.completed,p.completed),`<b style="color:${c.conversion<20?"#dc2626":c.conversion<40?"#d97706":"#0e9f5a"}">${c.conversion}%</b> conversion ${pts(c.conversion,p.conversion)}`)}
          ${t("BSS orders",num(c.with_order),delta(c.with_order,p.with_order),`${c.order_rate}% of attempts carry an order no.`)}
          ${t("Median time",c.median_min!=null?c.median_min+" min":"—","",`completed journeys${p.median_min!=null?` · was ${p.median_min} min`:""}`)}
          ${t("Identity (Nafath)",c.nafath_checks?`${c.nafath_fail_rate}% fail`:"—","",c.nafath_checks?`${num(c.nafath_failed)} of ${num(c.nafath_checks)} checks`:"no identity checks in this journey mix")}
          ${t("Referral codes",num(c.referral_codes),"", "distinct QR / promoter codes")}
        </div>
        <div class="fxc-mini">
          ${split2("Customers",[["Saudi",c.saudi,"#0e9f5a"],["Non-Saudi (Iqama)",c.non_saudi,"#d97706"]])}
          ${split2("Plan type",[["Postpaid",c.postpaid,"#2563eb"],["Prepaid",c.prepaid,"#7c3aed"]])}
          ${split2("Cancelled / expired",[["Postpaid",c.cancelled_postpaid,"#dc2626"],["Prepaid",c.cancelled_prepaid,"#f59e0b"]])}
        </div>
        ${spark(days,SEGC[sg.segment],44)}<div class="rl" style="font-size:10px;color:var(--muted)">attempts per KSA day · coloured share = completed</div></div>`; };
    const tot=k.total.now, tp=k.total.prev||{};
    const chMax=Math.max(1,...(k.by_channel||[]).map(c=>c.n)); const CHL={sda:"SDA dealers",epurchase:"E-purchase",salamhome:"Salam Home app"};
    const chans=(k.by_channel||[]).length?`<div class="fxc-segcard" style="--c:#94a3b8;margin-bottom:10px"><div class="fxc-segh"><b>All channels in this window</b><span class="rl" style="color:var(--muted);font-size:11px">Grafana "orders by source" — where this channel sits</span></div><div class="fxc-chans">${k.by_channel.map(c=>`<div class="fxc-chan ${c.current?"cur":""}"><div class="fxc-chan-l">${esc(CHL[c.channel]||c.channel)}${c.current?" ◀":""}</div><div class="fxc-chan-v">${num(c.n)} <span>${c.conversion}%</span></div>${hbar(c.n,chMax,c.current?"var(--green,#0e9f5a)":"#cbd5e1")}</div>`).join("")}</div></div>`:"";
    const naf=(k.nafath||[]).length?`<div class="fxc-segcard" style="--c:#2563eb;margin-top:10px"><div class="fxc-segh"><b>Identity checks (Nafath / Semati) — outcomes</b><span class="rl" style="color:var(--muted);font-size:11px">eligible vs non-eligible, per product</span></div><div class="fxc-kpis">${k.nafath.slice(0,8).map(x=>`<div class="fxc-kpi" style="min-width:120px"><div class="fxc-kpi-l">${esc(x.outcome)}</div><div class="fxc-kpi-v" style="font-size:16px;color:${/COMPLETED|SUCCESS|APPROVED|ELIGIBLE/i.test(x.outcome)?"#0e9f5a":"#dc2626"}">${num(x.n)}</div><div class="fxc-kpi-s">${segTag(x.segment,x.seg_label)}</div></div>`).join("")}</div></div>`:"";
    const miss=view?[]:absent(k.segments); const LBL={ftth:"FTTH",fttb:"FTTB","5g":"5G home"};
    const missNote=miss.length?`<div class="rl" style="font-size:11px;color:var(--muted);margin:-4px 0 10px">Not sold through this channel in the window: ${miss.map(m=>segTag(m,LBL[m])).join(" ")} — no column shown.</div>`:"";
    return `<div class="fxc-total">Channel total <b>${num(tot.attempts)}</b> attempts ${delta(tot.attempts,tp.attempts)} · <b>${num(tot.completed)}</b> completed (${tot.conversion}%) ${pts(tot.conversion,tp.conversion)} · ${num(tot.with_order)} BSS orders · ${num(tot.customers)} customers · Saudi ${num(tot.saudi)} / non-Saudi ${num(tot.non_saudi)}</div>`+missNote+chans+twoCol(segs.map(s=>col(k.segments.find(x=>x.segment===s)||{segment:s,label:s})))+naf;
  }
  function secFindings(f,S,FX){
    const {esc}=FX;
    const list=(items,empty)=>items.length?`<div class="fxc-flist">${items.slice(0,8).map(i=>`<a href="#" data-goto="${i.href}" class="fxc-find">${sevPill(i.sev)}${segTag(i.segment,i.seg_label)}<span>${esc(i.text)}</span></a>`).join("")}</div>`:`<div class="rl" style="color:var(--muted);font-size:12px;padding:6px 0">${empty}</div>`;
    return twoCol([`<div class="fxc-segcard" style="--c:#0e9f5a"><div class="fxc-segh"><b>💼 Business</b><span class="rl" style="color:var(--muted);font-size:11px">volume, conversion, drop-offs, payments</span></div>${list(f.business,"nothing unusual on the business side ✅")}</div>`,
      `<div class="fxc-segcard" style="--c:#dc2626"><div class="fxc-segh"><b>🛠 Technical</b><span class="rl" style="color:var(--muted);font-size:11px">faults, integrations, money at risk</span></div>${list(f.technical,"no technical finding in this window ✅")}</div>`]);
  }
  function secJourneys(j,S,FX,view){
    const {esc,tbl}=FX; const rows=view?j.rows.filter(r=>r.segment===view):j.rows; const max=Math.max(1,...rows.map(r=>r.n));
    return tbl(["JOURNEY","PRODUCT","ATTEMPTS","Δ PREV","COMPLETED","CONVERSION","STALLED","IN PROGRESS","ABANDONED","BSS ORDER","MEDIAN","WITH ERROR"],
      rows.map(r=>[`<b>${esc(r.label)}</b>`,segTag(r.segment,r.seg_label),`<b>${num(r.n)}</b>${hbar(r.n,max,SEGC[r.segment])}`,delta(r.n,r.prev_n),num(r.completed),
        `<b style="color:${r.conversion<20?"#dc2626":r.conversion<40?"#d97706":"#0e9f5a"}">${r.conversion}%</b> ${pts(r.conversion,r.prev_conversion)}`,num(r.stalled),num(r.in_progress),num(r.abandoned),`${num(r.with_order)} <span style="color:var(--muted)">· ${r.n?Math.round(100*r.with_order/r.n):0}%</span>`,r.median_min!=null?r.median_min+" min":"—",num(r.with_error)]));
  }
  function secFlows(fl,S,FX,view){
    const {esc}=FX; const ws=(view?fl.workflows.filter(w=>w.segment===view):fl.workflows).filter(w=>w.total>=3).slice(0,8);
    if(!ws.length) return `<div class="rl" style="color:var(--muted);font-size:12px">no journeys in this window</div>`;
    const sbd=(fl.stopsByDay||[]).length?`<div class="fxc-segcard" style="--c:#dc2626;margin-bottom:10px"><div class="fxc-segh"><b>Where journeys stopped — per day</b><span class="rl" style="color:var(--muted);font-size:11px">cancelled · expired · stalled, by the step reached (Grafana "cancelled by steps")</span></div>${stacked(fl.stopsByDay,(fl.stop_steps||[]).concat(["other"]),64)}</div>`:"";
    return sbd+`<div class="fxc-cols" style="grid-template-columns:repeat(auto-fit,minmax(380px,1fr))">${ws.map(w=>{ const max=Math.max(1,w.total);
      return `<div class="fxc-segcard" style="--c:${SEGC[w.segment]}"><div class="fxc-segh"><b>${esc(w.label)}</b>${segTag(w.segment,w.seg_label)}<span class="rl" style="margin-left:auto;font-size:11px;color:var(--muted)">${num(w.total)} attempts · <b style="color:${w.conversion<20?"#dc2626":"inherit"}">${w.conversion}%</b> complete</span></div>
        ${w.funnel.length?`<div class="fxc-funnel">${w.funnel.map((s,i)=>`<div class="fxc-fstep ${w.biggest_drop&&w.biggest_drop.step===s.step&&s.drop_pct>=20?"hot":""}" title="${esc(s.step)} · reached ${num(s.reached)} · left here ${num(s.drop)} (${s.drop_pct}%)"><span class="fxc-fname">${i+1}. ${esc(s.step.replace(/^(ePurchase|salamHome|promoters)/,""))}</span>${hbar(s.reached,max,SEGC[w.segment])}<span class="fxc-fn">${num(s.reached)}</span><span class="fxc-fd">${s.drop?`−${s.drop_pct}%`:""}</span></div>`).join("")}<div class="fxc-fstep done"><span class="fxc-fname">✓ completed</span>${hbar(w.completed,max,"#0e9f5a")}<span class="fxc-fn">${num(w.completed)}</span><span class="fxc-fd"></span></div></div>`:""}
        ${!w.steps_known?`<div class="rl" style="font-size:10px;color:#d97706;margin-top:4px">step order for this journey is not documented — steps ordered by frequency</div>`:""}
        ${w.stops.length?`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:8px">Stopped at: ${w.stops.slice(0,5).map(s=>`<span class="mono">${esc(s.step)}</span> ${num(s.n)} (${s.pct}%)`).join(" · ")}</div>`:""}</div>`; }).join("")}</div>`;
  }
  function secPlans(p,S,FX,view){
    const {esc,tbl}=FX; const rows=(view?p.rows.filter(r=>r.segment===view):p.rows).slice(0,25); const max=Math.max(1,...rows.map(r=>r.n));
    return tbl(["PLAN","PRODUCT","ATTEMPTS","SHARE","COMPLETED","CONVERSION","BSS ORDERS","JOURNEYS"],rows.map(r=>[`<b>${esc(r.plan)}</b>`,segTag(r.segment,r.seg_label),`<b>${num(r.n)}</b>${hbar(r.n,max,SEGC[r.segment])}`,`${r.share}%`,num(r.completed),`<b style="color:${r.conversion<20?"#dc2626":r.conversion<40?"#d97706":"#0e9f5a"}">${r.conversion}%</b>`,num(r.with_order),num(r.journeys)]));
  }
  function secCampaigns(c,S,FX,view){
    const {esc,tbl,ts}=FX; const split=view?c.split.filter(r=>r.segment===view):c.split;
    const cards=split.sort((a,b)=>b.n-a.n).map(r=>`<div class="fxc-segcard" style="--c:${SEGC[r.segment]}"><div class="fxc-segh"><b>${esc(r.kind)}</b>${segTag(r.segment,r.seg_label)}</div><div class="fxc-kpis"><div class="fxc-kpi"><div class="fxc-kpi-l">Attempts</div><div class="fxc-kpi-v">${num(r.n)}</div></div><div class="fxc-kpi"><div class="fxc-kpi-l">Completed</div><div class="fxc-kpi-v">${num(r.completed)}</div><div class="fxc-kpi-s"><b>${r.conversion}%</b> conversion</div></div></div></div>`).join("");
    const top=view?c.top.filter(r=>r.segment===view):c.top;
    return `<div class="rl" style="font-size:11.5px;color:var(--muted);margin-bottom:8px">${num(c.active_codes)} active codes · ${esc(c.note)}</div><div class="fxc-cols" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-bottom:10px">${cards||`<div class="rl" style="color:var(--muted);font-size:12px">no attempts</div>`}</div>`
      +(top.length?tbl(["CODE","PRODUCT","ATTEMPTS","COMPLETED","CONVERSION","BSS ORDERS","REGIONS","FIRST","LAST"],top.map(r=>[`<span class="mono">${esc(r.referral_code)}</span>`,segTag(r.segment,r.seg_label),num(r.n),num(r.completed),`<b>${r.conversion}%</b>`,num(r.with_order),num(r.regions),ts(r.first_at).slice(0,10),ts(r.last_at)])):"");
  }
  function secPayments(p,S,FX,view){
    const {esc,tbl,ts}=FX;
    if(!p.configured) return `<div class="rl" style="color:#d97706;font-size:12px">${esc(p.note)}</div>`;
    const segs=view?p.segments.filter(r=>r.segment===view):p.segments;
    const cards=segs.map(r=>`<div class="fxc-segcard" style="--c:${SEGC[r.segment]}"><div class="fxc-segh">${segTag(r.segment,r.seg_label)}<span class="rl" style="color:var(--muted);font-size:11px">${num(r.n)} payments linked</span></div>
      <div class="fxc-kpis"><div class="fxc-kpi"><div class="fxc-kpi-l">Success</div><div class="fxc-kpi-v" style="color:${r.paid_rate<70?"#dc2626":r.paid_rate<90?"#d97706":"#0e9f5a"}">${r.paid_rate}%</div><div class="fxc-kpi-s">${num(r.paid)} paid · ${num(r.failed)} failed · ${num(r.pending)} pending</div></div>
        <div class="fxc-kpi"><div class="fxc-kpi-l">Collected</div><div class="fxc-kpi-v">${money(r.paid_sar)}</div><div class="fxc-kpi-s">${r.methods.slice(0,3).map(m=>`${esc(m.method)} ${m.n}`).join(" · ")}</div></div></div>
      <div class="rl" style="font-size:10.5px;color:var(--muted)">apps: ${r.apps.slice(0,3).map(a=>`${esc(a.application)} ${a.n}`).join(" · ")}</div></div>`).join("");
    const pl=p.platform||{}; const pno=pl.paid_no_order||{}; const T=pl.totals||{}; const pr=pl.processing||{};
    const dayMax=Math.max(1,...(p.byDay||[]).map(d=>d.n));
    const stChip=(l,v,c)=>`<div class="fxc-kpi" style="min-width:110px"><div class="fxc-kpi-l">${l}</div><div class="fxc-kpi-v" style="font-size:18px;color:${c||"inherit"}">${v}</div></div>`;
    const stMap={}; for(const r of (pl.by_status||[])) stMap[String(r.status).toUpperCase()]=(stMap[String(r.status).toUpperCase()]||0)+Number(r.n||0);
    const platform=`<div class="fxc-segcard" style="--c:#0e9f5a;margin-bottom:10px"><div class="fxc-segh"><b>Payments platform — all Fixed channels, this window</b><span class="rl" style="color:var(--muted);font-size:11px">Grafana "Payments" board · payments_v2 · 1.00 SAR tests excluded</span></div>
      <div class="fxc-kpis" style="margin-bottom:8px">${stChip("Success rate",`${T.success_rate!=null?T.success_rate:"—"}%`,T.success_rate<70?"#dc2626":T.success_rate<90?"#d97706":"#0e9f5a")}${stChip("Failure rate",`${T.fail_rate!=null?T.fail_rate:"—"}%`,T.fail_rate>=30?"#dc2626":"inherit")}${stChip("Total",num(T.n))}${stChip("Avg processing",pr.avg_s!=null?pr.avg_s+" s":"—")}${stChip("Median processing",pr.p50_s!=null?pr.p50_s+" s":"—")}
        ${["PAID","CAPTURED","FAILED","AUTHORIZED","VOIDED","REFUNDED","INITIATED"].map(k=>stChip(k,num(stMap[k]||0),/PAID|CAPTURED/.test(k)?"#0e9f5a":/FAILED|VOIDED|REFUNDED/.test(k)?"#dc2626":"var(--muted)")).join("")}</div>
      <div class="fxc-cols" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <div><div class="fxc-kpi-l" style="margin-bottom:4px">Done payments by method</div>${tbl(["METHOD","PAID","FAILED","COLLECTED"],(pl.by_method||[]).map(r=>[`<b>${esc(r.method)}</b>`,num(r.paid),num(r.failed),money(r.paid_sar)]))}</div>
        <div><div class="fxc-kpi-l" style="margin-bottom:4px">By source (card / wallet / BNPL)</div>${tbl(["SOURCE","N","PAID","COLLECTED"],(pl.by_source||[]).map(r=>[`<b>${esc(r.source)}</b>`,num(r.n),num(r.paid),money(r.paid_sar)]))}</div>
        <div><div class="fxc-kpi-l" style="margin-bottom:4px">Payments per plan (invoice description)</div>${tbl(["DESCRIPTION","N","PAID","COLLECTED"],(pl.by_description||[]).map(r=>[esc(r.description),num(r.n),num(r.paid),money(r.paid_sar)]))}</div>
        <div><div class="fxc-kpi-l" style="margin-bottom:4px">Peak payment hours (KSA)</div>${hourChart(pl.by_hour||[],64)}</div>
      </div></div>`;
    const trend=`<div class="fxc-cols" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-bottom:10px">
        <div class="fxc-segcard"><div class="fxc-segh"><b>Daily trend</b><span class="rl" style="color:var(--muted);font-size:11px">orders · revenue (window)</span></div>${(pl.trend_day||[]).length?`<div class="fxc-spark" style="height:48px">${(()=>{ const mx=Math.max(1,...pl.trend_day.map(d=>Number(d.revenue_sar)||0)); return pl.trend_day.map(d=>`<div title="${d.day} · ${num(d.n)} payments · ${num(d.paid)} paid · ${money(d.revenue_sar)}" style="height:${Math.max(2,Math.round(46*(Number(d.revenue_sar)||0)/mx))}px;background:#0e9f5a"></div>`).join(""); })()}</div>`:""}${tbl(["DAY","PAYMENTS","PAID","REVENUE"],(pl.trend_day||[]).slice(-10).reverse().map(d=>[d.day,num(d.n),num(d.paid),money(d.revenue_sar)]))}</div>
        <div class="fxc-segcard"><div class="fxc-segh"><b>Monthly trend</b><span class="rl" style="color:var(--muted);font-size:11px">last 12 months, all Fixed</span></div>${(pl.trend_month||[]).length?`<div class="fxc-spark" style="height:48px">${(()=>{ const mx=Math.max(1,...pl.trend_month.map(d=>Number(d.revenue_sar)||0)); return pl.trend_month.map(d=>`<div title="${d.month} · ${num(d.paid)} paid · ${money(d.revenue_sar)}" style="height:${Math.max(2,Math.round(46*(Number(d.revenue_sar)||0)/mx))}px;background:#2563eb"></div>`).join(""); })()}</div>`:""}${tbl(["MONTH","PAYMENTS","PAID","REVENUE"],(pl.trend_month||[]).slice().reverse().map(d=>[d.month,num(d.n),num(d.paid),money(d.revenue_sar)]))}</div>
        <div class="fxc-segcard"><div class="fxc-segh"><b>Yearly</b></div>${tbl(["YEAR","PAYMENTS","PAID","REVENUE"],(pl.trend_year||[]).slice().reverse().map(d=>[d.year,num(d.n),num(d.paid),money(d.revenue_sar)]))}</div>
      </div>`;
    const recent=(pl.recent_failures||[]).length?`<div class="fxc-segcard" style="--c:#dc2626;margin-bottom:10px"><div class="fxc-segh"><b>Latest failed payments (platform)</b><span class="rl" style="color:var(--muted);font-size:11px">customer id masked</span></div>${tbl(["WHEN","CUSTOMER","AMOUNT","METHOD","CHANNEL","APP","STATUS","BANK MESSAGE"],pl.recent_failures.map(r=>[ts(r.created_at),esc(r.customer_key||"—"),money(r.amount_sar),esc(r.method),esc(r.channel||""),esc(r.application||""),`<b style="color:#dc2626">${esc(r.status)}</b>`,esc(r.bank_message||"")]))}</div>`:"";
    return `${p.error?`<div class="fxc-err">${esc(p.error)}</div>`:""}
      <div class="fxc-cols" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-bottom:10px">${cards||`<div class="rl" style="color:var(--muted);font-size:12px">no payment linked to this channel's attempts in the window (${num(p.linked_keys)} keys checked)</div>`}</div>
      ${(p.byDay||[]).length?`<div class="fxc-spark" style="height:40px;margin:4px 0 2px">${p.byDay.map(d=>`<div title="${d.day} · ${d.n} payments · ${d.paid} paid · ${d.failed} failed" style="height:${Math.max(2,Math.round(38*d.n/dayMax))}px;background:linear-gradient(180deg,#0e9f5a ${d.n?Math.round(100*d.paid/d.n):0}%,#fca5a5 0)"></div>`).join("")}</div><div class="rl" style="font-size:10px;color:var(--muted);margin-bottom:10px">linked payments per day · green = paid, red = failed</div>`:""}
      ${platform}${trend}${recent}
      <div class="fxc-cols" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
        <div class="fxc-segcard" style="--c:${pno.n>0?"#dc2626":"#0e9f5a"}"><div class="fxc-segh"><b>Money at risk (platform, all Fixed channels)</b></div><div class="fxc-kpis"><div class="fxc-kpi"><div class="fxc-kpi-l">Paid, no order reference</div><div class="fxc-kpi-v" style="color:${pno.n>0?"#dc2626":"inherit"}">${num(pno.n)}</div><div class="fxc-kpi-s">${money(pno.amount_sar)} taken with no order to show</div></div></div></div>
        <div class="fxc-segcard"><div class="fxc-segh"><b>Platform by status</b></div>${tbl(["STATUS","SOURCE","N","AMOUNT"],(pl.by_status||[]).slice(0,10).map(r=>[`<b style="color:${/PAID|CAPTURED/i.test(r.status)?"#0e9f5a":/INITIATED|PENDING/i.test(r.status)?"var(--muted)":"#dc2626"}">${esc(r.status)}</b>`,esc(r.source),num(r.n),money(r.amount_sar)]))}</div>
        <div class="fxc-segcard"><div class="fxc-segh"><b>Decline reasons</b></div>${tbl(["BANK MESSAGE","N"],(pl.fail_reasons||[]).map(r=>[esc(r.reason),num(r.n)]))}</div>
        <div class="fxc-segcard"><div class="fxc-segh"><b>By application</b><span class="rl" style="color:var(--muted);font-size:10.5px">Payment Optimization = routing layer</span></div>${tbl(["APPLICATION","N","PAID","COLLECTED"],(pl.by_application||[]).map(r=>[esc(r.application),num(r.n),num(r.paid),money(r.paid_sar)]))}</div>
      </div>
      ${p.sample&&p.sample.length?`<div style="margin-top:10px">${tbl(["WHEN","PRODUCT","STATUS","METHOD","AMOUNT","APP","ORDER","FTTH","BANK MESSAGE"],p.sample.map(r=>[ts(r.when),segTag(r.segment,{ftth:"FTTH",fttb:"FTTB","5g":"5G"}[r.segment]||"?"),`<b style="color:${/PAID|CAPTURED/i.test(r.status)?"#0e9f5a":"#dc2626"}">${esc(r.status)}</b>`,esc(r.method),money(r.amount_sar),esc(r.application||""),esc(r.order||"—"),esc(r.ftth||"—"),esc(r.bank_message||"")]))}</div>`:""}
      <div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:6px">${esc(p.note)}</div>`;
  }
  function secErrors(e,S,FX,view){
    const {esc,tbl,ts}=FX; const cats=view?e.categories.filter(r=>r.segment===view):e.categories; const max=Math.max(1,...cats.map(r=>r.n));
    const kl=k=>k==="business"?`<span class="fxc-kl b">business rule</span>`:`<span class="fxc-kl t">fault</span>`;
    const dayAgg={}; for(const d of (e.byDay||[])){ if(view&&d.segment!==view) continue; const k=dayKey(d.day); const o=dayAgg[k]=dayAgg[k]||{day:k,total:0,steps:{}}; const L={ftth:"FTTH",fttb:"FTTB","5g":"5G home"}[d.segment]||"other"; o.steps[L]=(o.steps[L]||0)+Number(d.n||0); o.total+=Number(d.n||0); }
    const otpAgg={}; for(const d of (e.otpByDay||[])){ if(view&&d.segment!==view) continue; const k=dayKey(d.day); const o=otpAgg[k]=otpAgg[k]||{day:k,total:0,steps:{}}; o.steps[d.seg_label]=(o.steps[d.seg_label]||0)+Number(d.n||0); o.total+=Number(d.n||0); }
    const dayRows=Object.values(dayAgg).sort((a,b)=>a.day<b.day?-1:1), otpRows=Object.values(otpAgg).sort((a,b)=>a.day<b.day?-1:1);
    const series=`<div class="fxc-cols" style="grid-template-columns:2fr 1fr;margin-bottom:10px"><div class="fxc-segcard" style="--c:#dc2626"><div class="fxc-segh"><b>Error events per day</b><span class="rl" style="color:var(--muted);font-size:11px">by product</span></div>${dayRows.length?stacked(dayRows,["FTTH","FTTB","5G home","other"],56):`<div class="rl" style="color:var(--muted);font-size:12px">none</div>`}</div>
      <div class="fxc-segcard" style="--c:#d97706"><div class="fxc-segh"><b>Unsuccessful OTP</b><span class="rl" style="color:var(--muted);font-size:11px">${num(e.otp_failed)} in window</span></div>${otpRows.length?stacked(otpRows,["FTTH","FTTB","5G home","product not recorded"],56):`<div class="rl" style="color:var(--muted);font-size:12px">no OTP failures recorded</div>`}</div></div>`;
    return `<div class="fxc-total">${num(e.totals.technical)} technical faults · ${num(e.totals.business)} business-rule stops · <b style="color:${e.totals.open?"#dc2626":"inherit"}">${num(e.totals.open)} open</b></div>`+series+`
      <div class="fxc-cols" style="grid-template-columns:2fr 1fr">
        <div>${tbl(["CATEGORY","CLASS","PRODUCT","TEAM","EVENTS","OPEN","ATTEMPTS","LAST"],cats.map(r=>[`<b>${esc(r.label)}</b><div class="rl" style="font-size:10px;color:var(--muted)">${esc(r.category)}${r.money_at_risk?" · 💰 money at risk":""}</div>`,kl(r.klass),segTag(r.segment,r.seg_label),esc(r.team),`<b>${num(r.n)}</b>${hbar(r.n,max,r.klass==="business"?"#94a3b8":"#dc2626")}`,r.open?`<b style="color:#dc2626">${num(r.open)}</b>`:"0",num(r.attempts),ts(r.last_at)]))}</div>
        <div class="fxc-segcard"><div class="fxc-segh"><b>By step</b></div>${tbl(["STEP","PRODUCT","N"],(view?e.by_step.filter(r=>r.segment===view):e.by_step).slice(0,12).map(r=>[`<span class="mono">${esc(r.step)}</span>`,segTag(r.segment,r.seg_label),num(r.n)]))}</div>
      </div>
      <div style="margin-top:10px">${tbl(["MESSAGE (ids folded)","CATEGORY","CODE","CLASS","PRODUCT","N","LAST"],(view?e.top_messages.filter(r=>r.segment===view):e.top_messages).slice(0,12).map(r=>[esc(r.message),`<span class="pill" style="font-size:10px">${esc(r.category)}</span>`,esc(r.code||""),kl(r.klass),segTag(r.segment,r.seg_label),num(r.n),ts(r.last_at)]))}</div>`;
  }
  function secIntegrations(g,S,FX,view){
    const {esc,tbl,ts}=FX; const rows=view?g.rows.filter(r=>r.segment===view):g.rows;
    const sys=g.systems.map(s=>`<div class="fxc-kpi" style="min-width:170px"><div class="fxc-kpi-l">${esc(s.system)}</div><div class="fxc-kpi-v" style="font-size:16px">${num(s.calls)} <span style="font-size:11px;color:${s.fail_rate>=10?"#dc2626":"var(--muted)"}">${s.fail_rate}% fail</span></div><div class="fxc-kpi-s">p95 ${s.p95>=1000?(s.p95/1000).toFixed(1)+" s":s.p95+" ms"}</div></div>`).join("");
    const strips=(g.failures_by_day||[]).length?`<div class="fxc-segcard" style="--c:#dc2626;margin-bottom:10px"><div class="fxc-segh"><b>API errors per endpoint — per day</b><span class="rl" style="color:var(--muted);font-size:11px">Grafana "API errors" strips · red intensity = failures that day</span></div>${g.failures_by_day.map(f=>{ const mx=Math.max(1,...f.days.map(d=>d.failed)); return `<div class="fxc-strip"><span class="mono fxc-strip-l" title="${esc(f.family)}">${esc(f.family)}</span><div class="fxc-strip-b">${f.days.map(d=>`<div title="${d.day} · ${d.failed} failed of ${d.calls}" style="opacity:${0.15+0.85*d.failed/mx}"></div>`).join("")}</div><b class="fxc-strip-n">${num(f.failed)}</b></div>`; }).join("")}</div>`:"";
    return `<div class="rl" style="font-size:11px;color:var(--muted);margin-bottom:6px">source <span class="mono">${esc(g.source)}</span>${g.note?` · <span style="color:#d97706">${esc(g.note)}</span>`:""}</div><div class="fxc-kpis" style="margin-bottom:10px">${sys||`<div class="rl" style="color:var(--muted);font-size:12px">no API calls recorded for this channel in the window</div>`}</div>${strips}
      ${rows.length?tbl(["ENDPOINT FAMILY","SYSTEM","PRODUCT","CALLS","FAIL %","5XX","TIMEOUTS","P50","P95","MAX","LAST"],rows.slice(0,40).map(r=>[`<span class="mono" style="font-size:10.5px">${esc(r.family)}</span>`,esc(r.system),segTag(r.segment,r.seg_label),num(r.calls),`<b style="color:${r.fail_rate>=10?"#dc2626":r.fail_rate>=3?"#d97706":"inherit"}">${r.fail_rate}%</b>`,num(r.s5xx),num(r.timeouts),r.p50+" ms",`<b style="color:${r.p95>=8000?"#dc2626":r.p95>=3000?"#d97706":"inherit"}">${r.p95>=1000?(r.p95/1000).toFixed(1)+" s":r.p95+" ms"}</b>`,r.max_ms>=1000?(r.max_ms/1000).toFixed(1)+" s":r.max_ms+" ms",ts(r.last_at)])):""}`;
  }
  function secRegions(r,S,FX,view){
    const {esc,tbl}=FX; const rows=(view?r.rows.filter(x=>x.segment===view):r.rows).slice(0,30); const max=Math.max(1,...rows.map(x=>x.n));
    return tbl(["REGION","PRODUCT","ATTEMPTS","COMPLETED","CONVERSION","NO COVERAGE","NO APPOINTMENT"],rows.map(x=>[`<b>${esc(x.region)}</b>`,segTag(x.segment,x.seg_label),`<b>${num(x.n)}</b>${hbar(x.n,max,SEGC[x.segment])}`,num(x.completed),`<b>${x.conversion}%</b>`,x.no_coverage?`<span style="color:#dc2626">${num(x.no_coverage)}</span>`:"0",x.no_appointment?`<span style="color:#d97706">${num(x.no_appointment)}</span>`:"0"]));
  }

  /* ---- customize modal ---- */
  function customize(ch,FX,onDone){
    const {esc}=FX; let order=chosen(ch); const checked=new Set(order); const all=SECTIONS.map(s=>s[0]); order=order.concat(all.filter(k=>!order.includes(k)));
    const ov=document.createElement("div"); ov.className="fxc-ov";
    const draw=()=>{ ov.innerHTML=`<div class="fxc-modal"><h3 style="margin:0 0 4px">Customize · ${esc(SECTIONS.length)} sections</h3><div class="rl" style="font-size:11.5px;color:var(--muted);margin-bottom:10px">Pick the sections for this page and their order. Saved for your user — the other Fixed pages are not affected.</div>
        <div class="fxc-list">${order.map((k,i)=>{ const m=SECTIONS.find(s=>s[0]===k); return `<div class="fxc-item"><label><input type="checkbox" data-k="${k}" ${checked.has(k)?"checked":""}> <b>${esc(m[1])}</b> <span class="rl" style="color:var(--muted);font-size:11px">${esc(m[2])}</span></label><span><button type="button" class="btn fxc-mv" data-mv="${i}|-1" ${i===0?"disabled":""} title="Move up">↑</button><button type="button" class="btn fxc-mv" data-mv="${i}|1" ${i===order.length-1?"disabled":""} title="Move down">↓</button></span></div>`; }).join("")}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn" id="fxcReset" style="font-size:12px">Reset to default</button><button class="btn" id="fxcCancel" style="font-size:12px">Cancel</button><button class="btn primary" id="fxcSave" style="font-size:12px">Save</button></div></div>`;
      ov.querySelectorAll("input[data-k]").forEach(i=>i.onchange=()=>{ if(i.checked) checked.add(i.dataset.k); else checked.delete(i.dataset.k); });
      ov.querySelectorAll("button[data-mv]").forEach(b=>b.onclick=()=>{ const [i,d]=b.dataset.mv.split("|").map(Number); const j=i+d; [order[i],order[j]]=[order[j],order[i]]; draw(); });
      $("#fxcCancel",ov).onclick=()=>ov.remove();
      $("#fxcReset",ov).onclick=async()=>{ await saveChosen(ch,all.slice(),FX); ov.remove(); onDone(); };
      $("#fxcSave",ov).onclick=async()=>{ const list=order.filter(k=>checked.has(k)); if(!list.length) return; await saveChosen(ch,list,FX); ov.remove(); onDone(); }; };
    draw(); ov.addEventListener("click",e=>{ if(e.target===ov) ov.remove(); }); document.body.appendChild(ov);
  }

  function ensureCss(){
    if(document.getElementById("fxc-css")) return;
    const st=document.createElement("style"); st.id="fxc-css"; st.textContent=`
      .fxc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
      .fxc-title{font-size:15px;font-weight:800}.fxc-sub{font-size:11px;color:var(--muted);font-weight:500}
      .fxc-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .fxc-chip{cursor:pointer;font:inherit;font-size:11.5px;font-weight:700;padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:inherit}
      .fxc-chip.on{background:var(--c);border-color:var(--c);color:#fff}
      .fxc-sec{background:var(--card,#fff);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin-bottom:12px;box-shadow:0 6px 24px rgba(15,23,42,.04)}
      .fxc-sech{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}.fxc-sech h3{margin:0;font-size:14px}.fxc-sech .rl{font-size:11px;color:var(--muted)}
      .fxc-cols{display:grid;gap:12px}
      .fxc-segcard{border:1px solid var(--line);border-left:3px solid var(--c,var(--line));border-radius:12px;padding:10px 12px;background:color-mix(in srgb,var(--card,#fff) 96%,var(--c,#fff))}
      .fxc-segh{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}
      .fxc-seg{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.4px;color:var(--c);border:1px solid var(--c);border-radius:6px;padding:1px 7px;white-space:nowrap}
      .fxc-kpis{display:flex;gap:10px;flex-wrap:wrap}
      .fxc-kpi{min-width:140px;max-width:260px;flex:1;background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
      .fxc-kpi-l{font-size:10px;letter-spacing:.6px;text-transform:uppercase;font-weight:700;color:var(--muted)}.fxc-kpi-v{font-size:20px;font-weight:800;line-height:1.15;margin-top:2px}.fxc-kpi-s{font-size:10.5px;color:var(--muted);margin-top:3px}
      .fxc-total{font-size:12px;color:var(--muted);margin-bottom:10px}.fxc-total b{color:inherit}
      .fxc-spark{display:flex;align-items:flex-end;gap:2px;margin-top:8px}.fxc-spark div{flex:1;min-width:3px;border-radius:2px 2px 0 0}
      .fxc-hbar{height:5px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:4px;min-width:60px}.fxc-hbar div{height:100%}
      .fxc-funnel{display:flex;flex-direction:column;gap:4px}
      .fxc-fstep{display:grid;grid-template-columns:170px 1fr 56px 52px;gap:8px;align-items:center;font-size:11.5px;padding:2px 6px;border-radius:6px}
      .fxc-fstep.hot{background:rgba(220,38,38,.07)}.fxc-fstep.done{border-top:1px dashed var(--line);margin-top:2px;padding-top:6px}
      .fxc-fname{font-family:ui-monospace,monospace;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fxc-fn{text-align:right;font-weight:700}.fxc-fd{text-align:right;color:#dc2626;font-size:10.5px;font-weight:700}
      .fxc-flist{display:flex;flex-direction:column;gap:6px}.fxc-find{display:flex;gap:8px;align-items:center;font-size:12px;color:inherit;text-decoration:none;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--card,#fff)}.fxc-find:hover{border-color:var(--green,#0e9f5a)}
      .fxc-kl{font-size:10px;font-weight:800;border-radius:6px;padding:1px 6px}.fxc-kl.b{background:rgba(148,163,184,.18);color:var(--ink-soft)}.fxc-kl.t{background:rgba(220,38,38,.12);color:var(--bad-fg)}
      .fxc-err{color:#dc2626;font-size:12px;padding:6px 0}
      .fxc-ov{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1400;display:flex;align-items:center;justify-content:center;padding:20px}
      .fxc-modal{background:var(--card,#fff);border:1px solid var(--line);border-radius:16px;padding:18px 20px;width:640px;max-width:100%;max-height:90vh;overflow:auto;box-shadow:0 30px 80px rgba(15,23,42,.35)}
      .fxc-list{display:flex;flex-direction:column;gap:4px}.fxc-mv{font-size:11px;padding:3px 9px;border-radius:999px;line-height:1.2} .fxc-mv:disabled{opacity:.35;cursor:default}
    .fxc-mv{font-size:11px;padding:3px 9px;border-radius:999px;line-height:1.2} .fxc-mv:disabled{opacity:.35;cursor:default}
    .fxc-item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font-size:12.5px}
      .fxc-item button{font:inherit;font-size:12px;padding:2px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card,#fff);cursor:pointer;margin-left:4px}.fxc-item button:disabled{opacity:.35;cursor:default}
      .fxc-mini{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:10px}
      .fxc-split{background:var(--card,#fff);border:1px solid var(--line);border-radius:10px;padding:8px 10px}.fxc-splitbar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--line);margin:6px 0 5px}.fxc-splitbar div{height:100%}
      .fxc-splitl{display:flex;gap:10px;flex-wrap:wrap;font-size:10.5px}.fxc-splitl i,.fxc-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:middle}
      .fxc-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:10.5px;color:var(--muted);margin-top:4px}
      .fxc-chans{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.fxc-chan{border:1px solid var(--line);border-radius:10px;padding:8px 10px;opacity:.75}.fxc-chan.cur{opacity:1;border-color:var(--green,#0e9f5a)}
      .fxc-chan-l{font-size:10px;letter-spacing:.6px;text-transform:uppercase;font-weight:700;color:var(--muted)}.fxc-chan-v{font-size:18px;font-weight:800}.fxc-chan-v span{font-size:11px;color:var(--muted);font-weight:600}
      .fxc-hours{display:flex;justify-content:space-between;font-size:9.5px;color:var(--muted);margin-top:2px}
      .fxc-strip{display:grid;grid-template-columns:260px 1fr 60px;gap:10px;align-items:center;margin:4px 0}.fxc-strip-l{font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fxc-strip-b{display:flex;gap:2px;height:14px}.fxc-strip-b div{flex:1;background:#dc2626;border-radius:2px}.fxc-strip-n{text-align:right;color:#dc2626}
      @media (max-width:900px){.fxc-cols{grid-template-columns:1fr !important}.fxc-fstep{grid-template-columns:120px 1fr 48px 44px}}`;
    document.head.appendChild(st);
  }

  window.FIXED_PAGES.epurchase = makePage("epurchase","E-purchase");
  window.FIXED_PAGES.salamhome = makePage("salamhome","Salam Home");
})();
