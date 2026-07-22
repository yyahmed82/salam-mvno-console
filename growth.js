/* Growth dashboard — Resellers (flow_type + channel) & Campaigns (UTM) for executive/business review.
 * Reads /api/growth/summary. Its own period picker (7/30/90d) independent of the ops range. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const SES = { email: localStorage.getItem("cons_email")||"", role: localStorage.getItem("cons_role")||"report_manager" };
  async function api(path){
    const r = await fetch(path, { headers:{ "Content-Type":"application/json", "X-Console-Role":SES.role, "X-Console-User":SES.email } });
    if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error || ("HTTP "+r.status));
    return r.json();
  }
  const num = n => Number(n||0).toLocaleString("en-US");
  const pct = x => x==null?"—":(x*100).toFixed(1)+"%";
  const money = n => Math.round(Number(n||0)).toLocaleString("en-US")+" SAR";
  const PALETTE = ["#0d9488","#2563eb","#7c3aed","#ea580c","#d97706","#0891b2","#4f46e5","#dc2626","#16a34a","#64748b"];

  let days = 30;

  function bar(frac, color){
    const w = Math.max(0, Math.min(100, Math.round((frac||0)*100)));
    return `<div style="height:7px;border-radius:4px;background:var(--line-soft,rgba(148,163,184,.18))"><div style="height:7px;border-radius:4px;width:${w}%;background:${color}"></div></div>`;
  }
  function card(label, value, sub, color){
    return `<div style="flex:1;min-width:150px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px">
      <div style="font-size:22px;font-weight:800;color:${color||'var(--ink)'}">${value}</div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.03em;color:var(--muted);text-transform:uppercase;margin-top:2px">${esc(label)}</div>
      ${sub?`<div class="rl" style="margin-top:2px">${sub}</div>`:''}</div>`;
  }
  function th(cols){ return `<tr>${cols.map(c=>`<th style="text-align:${c.r?'right':'left'};padding:6px 10px;font-size:10.5px;letter-spacing:.03em;color:var(--muted);border-bottom:1px solid var(--line)">${esc(c.t)}</th>`).join("")}</tr>`; }

  async function render(){
    const host = $("#view-growth"); if(!host) return;
    host.innerHTML = `<div class="rl" style="padding:20px">Loading growth analytics…</div>`;
    let d; try{ d=await api(`/api/growth/summary?days_placeholder=1&to=&from=&window=${days}`); }
    catch(e){ host.innerHTML=`<div class="albanner" style="margin:16px">Growth needs the console API. ${esc(e.message)}</div>`; return; }
    // the endpoint defaults to 30d; re-fetch with an explicit from when days!=30
    if(days!==30){ const to=new Date(d.now); const from=new Date(to.getTime()-days*864e5);
      try{ d=await api(`/api/growth/summary?from=${from.toISOString()}&to=${to.toISOString()}`); }catch(e){} }

    const R=d.resellers||{}, C=d.campaigns||{}, MX=d.matrix||{rows:[],cols:[],cells:[]};
    const rsc=R.scorecard||{}, csc=C.scorecard||{};
    const flows=(R.flowTypes||[]); const maxAct=Math.max(1,...flows.map(f=>f.activated));
    const chans=(R.channels||[]); const maxChan=Math.max(1,...chans.map(c=>c.activated));
    const srcs=(C.sources||[]); const maxSrc=Math.max(1,...srcs.map(s=>s.orders));
    const camps=(C.campaigns||[]);
    const pvo=C.paidVsOrganic||{}; const pvoMax=Math.max(1,pvo.paidActivated||0,pvo.organicActivated||0);

    const rangeBtns = [7,30,90].map(n=>`<button class="pill gr-range${n===days?' on':''}" data-days="${n}" style="padding:4px 12px${n===days?';background:var(--ink);color:var(--bg)':''}">${n}d</button>`).join(" ");

    host.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin:4px 0 14px">
      <div><div style="font-size:18px;font-weight:800">Growth · Resellers &amp; Campaigns</div>
        <div class="rl">Executive view · last ${days} days · as of ${new Date(d.now).toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})} KSA</div></div>
      <div style="margin-left:auto">${rangeBtns}</div>
    </div>

    <!-- RESELLERS -->
    <div style="font-weight:800;font-size:13px;color:var(--ink);margin:6px 0 8px">① RESELLERS &amp; CHANNELS</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${card("Total activations", num(rsc.totalActivated), `${num(rsc.totalCreated)} orders created`, "#0d9488")}
      ${card("Reseller-driven", num(rsc.resellerActivated), `${rsc.resellerSharePct||0}% of activations`, "#2563eb")}
      ${card("Top reseller path", esc(rsc.topReseller||"—"), "by activations", "#7c3aed")}
      ${card("Active channels", num(chans.length), "with orders in period", "#ea580c")}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
      <div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px">
        <div style="font-weight:700;font-size:12px;margin-bottom:8px">Funnel by sales path <span class="rl">(flow_type)</span></div>
        <table style="width:100%;border-collapse:collapse">${th([{t:"PATH"},{t:"CREATED",r:1},{t:"ACTIVATED",r:1},{t:"CONV",r:1},{t:"REVENUE",r:1}])}
        ${flows.map((f,i)=>`<tr>
          <td style="padding:6px 10px"><b>${esc(f.label)}</b>${bar(f.activated/maxAct, PALETTE[i%PALETTE.length])}</td>
          <td style="padding:6px 10px;text-align:right" class="mono">${num(f.created)}</td>
          <td style="padding:6px 10px;text-align:right" class="mono"><b>${num(f.activated)}</b></td>
          <td style="padding:6px 10px;text-align:right" class="mono">${pct(f.convRate)}</td>
          <td style="padding:6px 10px;text-align:right" class="mono">${money(f.revenue)}</td></tr>`).join("")}</table>
      </div>
      <div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px">
        <div style="font-weight:700;font-size:12px;margin-bottom:2px">Channel breakdown <span class="rl">(plan_channels: tygo / soob / …)</span></div>
        <div class="rl" style="margin-bottom:6px;font-size:10.5px">Orders on plans each channel offers — a plan can belong to several channels.</div>
        ${chans.length?`<table style="width:100%;border-collapse:collapse">${th([{t:"CHANNEL"},{t:"ORDERS",r:1},{t:"ACTIVATED",r:1},{t:"REVENUE",r:1}])}
        ${chans.map((c,i)=>`<tr>
          <td style="padding:6px 10px"><b>${esc(c.channel)}</b>${bar(c.activated/maxChan, PALETTE[i%PALETTE.length])}</td>
          <td style="padding:6px 10px;text-align:right" class="mono">${num(c.orders)}</td>
          <td style="padding:6px 10px;text-align:right" class="mono"><b>${num(c.activated)}</b></td>
          <td style="padding:6px 10px;text-align:right" class="mono">${money(c.revenue)}</td></tr>`).join("")}</table>`
        :`<div class="rl" style="padding:8px 0">No channel data yet — <code>plan_channels</code> starts syncing after the next prod-sync. New resellers (tygo/soob) appear here once they have orders.</div>`}
      </div>
    </div>

    <!-- CAMPAIGNS -->
    <div style="font-weight:800;font-size:13px;color:var(--ink);margin:6px 0 8px">② CAMPAIGNS &amp; DIGITAL REFERRALS <span class="rl">(UTM)</span></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${card("Paid activations", num(pvo.paidActivated), `${num(pvo.paidOrders)} paid orders`, "#2563eb")}
      ${card("Organic activations", num(pvo.organicActivated), `${num(pvo.organicOrders)} organic orders`, "#16a34a")}
      ${card("Best-converting source", esc(csc.bestSource||"—"), "by activation rate", "#7c3aed")}
      ${card("Top campaign", esc((csc.topCampaign||"—")).slice(0,26), "by orders", "#ea580c")}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
      <div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px">
        <div style="font-weight:700;font-size:12px;margin-bottom:8px">By source · medium</div>
        <table style="width:100%;border-collapse:collapse">${th([{t:"SOURCE · MEDIUM"},{t:"ORDERS",r:1},{t:"ACTIVATED",r:1},{t:"CONV",r:1}])}
        ${srcs.slice(0,10).map((s,i)=>`<tr>
          <td style="padding:6px 10px"><b>${esc(s.source)}</b> <span class="rl">· ${esc(s.medium)}</span>${bar(s.orders/maxSrc, PALETTE[i%PALETTE.length])}</td>
          <td style="padding:6px 10px;text-align:right" class="mono">${num(s.orders)}</td>
          <td style="padding:6px 10px;text-align:right" class="mono"><b>${num(s.activated)}</b></td>
          <td style="padding:6px 10px;text-align:right" class="mono">${pct(s.convRate)}</td></tr>`).join("")}</table>
      </div>
      <div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px">
        <div style="font-weight:700;font-size:12px;margin-bottom:8px">Top campaigns</div>
        ${camps.length?`<table style="width:100%;border-collapse:collapse">${th([{t:"CAMPAIGN"},{t:"SRC"},{t:"ORD",r:1},{t:"ACT",r:1},{t:"CONV",r:1}])}
        ${camps.slice(0,12).map(c=>`<tr>
          <td style="padding:6px 10px;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.campaign)}">${esc(c.label||c.campaign)}</td>
          <td style="padding:6px 10px"><span class="rl">${esc(c.source)}</span></td>
          <td style="padding:6px 10px;text-align:right" class="mono">${num(c.orders)}</td>
          <td style="padding:6px 10px;text-align:right" class="mono"><b>${num(c.activated)}</b></td>
          <td style="padding:6px 10px;text-align:right" class="mono">${pct(c.convRate)}</td></tr>`).join("")}</table>`
        :`<div class="rl" style="padding:8px 0">No campaign-tagged orders in this window.</div>`}
      </div>
    </div>

    <!-- CORRELATION -->
    <div style="font-weight:800;font-size:13px;color:var(--ink);margin:6px 0 8px">③ ACQUISITION × DISTRIBUTION <span class="rl">(activations — which source feeds which path)</span></div>
    <div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;overflow-x:auto">
      ${MX.rows.length&&MX.cols.length?matrixHtml(MX):`<div class="rl">Not enough data for the correlation matrix in this window.</div>`}
    </div>
    <div class="rl" style="margin:8px 0 24px">Reseller = non-normal sales paths (indirect · POSA · Apollo · partner · QR). Revenue = plan price on activated orders. Data from the prod replica.</div>`;

    host.querySelectorAll(".gr-range").forEach(b=>b.addEventListener("click",()=>{ days=Number(b.dataset.days); render(); }));
  }

  function matrixHtml(MX){
    const flat = MX.cells.flat(); const max = Math.max(1, ...flat);
    const heat = v => { if(!v) return "transparent"; const a = 0.12 + 0.78*(v/max); return `rgba(13,148,136,${a.toFixed(2)})`; };
    let h = `<table style="border-collapse:collapse;min-width:100%"><tr><th style="padding:6px 10px;text-align:left;font-size:10.5px;color:var(--muted)">PATH \\ SOURCE</th>${MX.cols.map(c=>`<th style="padding:6px 10px;font-size:10.5px;color:var(--muted);text-align:center">${esc(c)}</th>`).join("")}</tr>`;
    MX.rows.forEach((r,ri)=>{ h+=`<tr><td style="padding:6px 10px;font-weight:700;white-space:nowrap">${esc(r)}</td>${MX.cols.map((c,ci)=>{ const v=(MX.cells[ri]||[])[ci]||0; return `<td style="padding:6px 10px;text-align:center;background:${heat(v)};color:${v>max*0.55?'#fff':'var(--ink)'}" class="mono">${v||''}</td>`; }).join("")}</tr>`; });
    return h+`</table>`;
  }

  // wire nav + hash
  document.querySelectorAll('.navtab').forEach(b=>{ if(b.dataset.view==="growth") b.addEventListener("click", render); });
  window.openGrowth = ()=>{ const v=$("#view-growth"); if(v && !v.classList.contains("active")){ const t=document.querySelector('.navtab[data-view="growth"]'); if(t) t.click(); } else render(); };
})();
