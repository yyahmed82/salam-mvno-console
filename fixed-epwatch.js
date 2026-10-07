/* fixed-epwatch.js — Fixed › "Payments watch" (registers window.FIXED_PAGES.epwatch).
 * Money and stock the read models cannot see, read straight from nexus through /api/fixed/epwatch/overview
 * (server/src/fixedEpWatch.js): 5G e-purchase (Naqeel delivery) funnel and every paid journey classified,
 * SIM-check outcome at the location step, SIM / landline locks never released, card authorisations neither
 * captured nor voided, e-purchase FTTH journeys charged before the order, payment webhooks, Salam Home
 * post → pre. Window chips 7 / 30 / 60 days (snapshot memoised 10 min server-side). Phone, iPad, dark mode. */
(function(){
  "use strict";
  const LS=k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const SAVE=(k,v)=>{ try{ localStorage.setItem(k,v); }catch(e){} };
  const S={ days:Number(LS("fixed_epw_days"))||30, cls:"", unmask:false, tick:0 };
  const TONE={ red:{fg:"#dc2626",bg:"rgba(220,38,38,.12)"}, amber:{fg:"#d97706",bg:"rgba(217,119,6,.14)"}, green:{fg:"#059669",bg:"rgba(5,150,105,.13)"},
    blue:{fg:"#2563eb",bg:"rgba(37,99,235,.12)"}, grey:{fg:"var(--muted)",bg:"rgba(100,116,139,.13)"} };
  const STYLE=`
    .epw{display:flex;flex-direction:column;gap:14px}
    .epw-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
    .epw-head h2{margin:0;font-size:17px;font-weight:800;letter-spacing:-.2px}
    .epw-head .sub{font-size:12px;color:var(--muted);margin-top:3px;max-width:760px;line-height:1.45}
    .epw-ctl{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .epw-btn{cursor:pointer;font:inherit;font-size:11.5px;font-weight:700;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink);transition:border-color .14s,background .14s,transform .14s}
    .epw-btn:hover{border-color:var(--green,#0e9f5a);transform:translateY(-1px)}
    .epw-btn.on{background:var(--green,#0e9f5a);border-color:var(--green,#0e9f5a);color:#fff}
    .epw-btn:disabled{opacity:.5;cursor:default;transform:none}
    .epw-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
    .epw-tile{background:var(--card,#fff);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;padding:10px 12px;cursor:pointer;text-align:left;font:inherit;color:var(--ink);transition:transform .14s,box-shadow .14s}
    .epw-tile:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(2,6,23,.08)}
    .epw-tile b{display:block;font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1}
    .epw-tile span{display:block;font-size:11.5px;font-weight:700;margin-top:3px}
    .epw-tile small{display:block;font-size:10.5px;color:var(--muted);margin-top:3px;line-height:1.35}
    .epw-tile.bad{border-left-color:#dc2626} .epw-tile.bad b{color:#dc2626}
    .epw-tile.warn{border-left-color:#d97706} .epw-tile.warn b{color:#d97706}
    .epw-tile.ok{border-left-color:#059669}
    .epw-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .epw-card{background:var(--card,#fff);border:1px solid var(--line);border-radius:14px;padding:14px 16px;min-width:0;box-shadow:0 1px 3px rgba(2,6,23,.05)}
    .epw-card h3{margin:0;font-size:13.5px;font-weight:800}
    .epw-card .cs{font-size:11px;color:var(--muted);margin:3px 0 10px;line-height:1.45}
    .epw-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
    .epw-pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;white-space:nowrap}
    .epw-fun{display:flex;flex-direction:column;gap:5px}
    .epw-frow{display:grid;grid-template-columns:minmax(120px,190px) 1fr 54px 62px;gap:8px;align-items:center;font-size:11.5px}
    .epw-frow .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .epw-frow .b{height:10px;border-radius:5px;background:var(--line);overflow:hidden} .epw-frow .b div{height:100%;background:var(--green,#0e9f5a);border-radius:5px}
    .epw-frow .v{text-align:right;font-weight:800;font-variant-numeric:tabular-nums} .epw-frow .d{text-align:right;font-size:10.5px;color:#dc2626;font-weight:700}
    .epw-chs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
    .epw-ch{border:1px solid var(--line);border-radius:10px;padding:6px 10px;font-size:11px;color:var(--muted)} .epw-ch b{display:block;font-size:16px;color:var(--ink)}
    .epw-days{display:flex;align-items:flex-end;gap:2px;height:84px;margin-top:6px}
    .epw-days .c{flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-width:3px;height:100%;position:relative}
    .epw-days .c i{display:block;width:100%} .epw-days .c i.s{background:rgba(100,116,139,.35);border-radius:3px 3px 0 0} .epw-days .c i.p{background:#2563eb} .epw-days .c i.o{background:var(--green,#0e9f5a)}
    .epw-leg{display:flex;gap:12px;flex-wrap:wrap;font-size:10.5px;color:var(--muted);margin-top:6px} .epw-leg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:middle}
    .epw-tbl{width:100%;border-collapse:collapse;font-size:11.5px}
    .epw-tbl th{text-align:left;padding:5px 6px;color:var(--muted);font-weight:700;font-size:10px;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--line);white-space:nowrap}
    .epw-tbl td{padding:6px;border-bottom:1px solid var(--line);vertical-align:top}
    .epw-tbl td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
    .epw-tbl .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
    .epw-scroll{max-height:420px;overflow:auto;-webkit-overflow-scrolling:touch;border-radius:8px}
    .epw-note{font-size:11px;color:var(--muted);line-height:1.5;margin-top:8px}
    .epw-warn{font-size:11.5px;color:#b45309;background:rgba(217,119,6,.10);border:1px solid rgba(217,119,6,.35);border-radius:10px;padding:8px 10px}
    .epw-empty{padding:14px 4px;color:var(--muted);font-size:12px}
    .epw-wide{grid-column:1/-1}
    @media (max-width:980px){.epw-grid{grid-template-columns:1fr}}
    @media (max-width:640px){.epw-frow{grid-template-columns:110px 1fr 44px 52px;gap:6px}.epw-tile b{font-size:19px}.epw-ctl{margin-left:0}.epw-card{padding:12px}}
  `;
  const pill=(txt,tone)=>{ const t=TONE[tone]||TONE.grey; return `<span class="epw-pill" style="color:${t.fg};background:${t.bg}">${txt}</span>`; };
  const fmt=v=>Number(v||0).toLocaleString("en-US");
  const ksa=v=>{ if(!v) return "—"; const d=new Date(v); if(isNaN(d)) return "—"; return d.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Riyadh"}); };
  const ago=v=>{ if(!v) return ""; const h=(Date.now()-new Date(v).getTime())/3600e3; return h<1?Math.round(h*60)+" min":h<48?Math.round(h)+" h":Math.round(h/24)+" d"; };
  const table=(head,rows,cls)=>rows.length?`<div class="tblwrap epw-scroll"><table class="epw-tbl"><thead><tr>${head.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.join("")}</tr>`).join("")}</tbody></table></div>`:`<div class="epw-empty">${cls||"Nothing here."}</div>`;
  const td=(v,c)=>`<td${c?` class="${c}"`:""}>${v==null||v===""?"—":v}</td>`;

  async function render(host,fx){
    const my=++S.tick, esc=fx.esc;
    if(!document.getElementById("epw-style")){ const st=document.createElement("style"); st.id="epw-style"; st.textContent=STYLE; document.head.appendChild(st); }
    host.innerHTML=`<div class="epw"><div class="epw-head"><div><h2>Payments watch</h2><div class="sub">Money and stock the read models cannot see — read live from nexus: 5G e-purchase (Naqeel delivery) paid journeys, SIM / landline locks, card holds, e-purchase FTTH charged before the order, payment webhooks.</div></div>
      <div class="epw-ctl">${[7,30,60].map(d=>`<button type="button" class="epw-btn${S.days===d?" on":""}" data-d="${d}">${d} days</button>`).join("")}<button type="button" class="epw-btn" id="epwRefresh" title="Re-read (the server keeps a 10-minute snapshot)">↻ Refresh</button></div></div>
      <div id="epwBody"><div style="padding:30px;text-align:center;color:var(--muted)">${window.salamLoader?window.salamLoader("Reading nexus…"):"Loading…"}</div></div></div>`;
    host.querySelectorAll(".epw-btn[data-d]").forEach(b=>b.onclick=()=>{ S.days=Number(b.dataset.d); SAVE("fixed_epw_days",S.days); render(host,fx); });
    host.querySelector("#epwRefresh").onclick=()=>render(host,fx);
    let d; try{ d=await fx.api(`/api/fixed/epwatch/overview?days=${S.days}${S.unmask?"&unmask=1":""}`); }
    catch(e){ if(my!==S.tick) return; host.querySelector("#epwBody").innerHTML=`<div class="epw-warn">Payments watch unavailable — ${esc(e.message)}</div>`; return; }
    if(my!==S.tick||!host.isConnected) return;
    draw(host,fx,d);
  }

  function draw(host,fx,d){
    const esc=fx.esc, g=d.fiveG, cnt=k=>(g.byCls[k]||0);
    const hook24=d.webhooks.sources.reduce((a,s)=>a+(s.failed_24h||0),0), unfinished=d.webhooks.sources.reduce((a,s)=>a+(s.unfinished||0),0);
    const tiles=[
      ["no_bss", cnt("no_bss")+cnt("bss_failed"), "5G paid — no BSS order", "≥ 72 h after the Naqeel order, or BSS failed at delivery", "#epw-paid"],
      ["naqeel_fail_charged", cnt("naqeel_fail_charged"), "5G Naqeel failed, charged", "card captured without a shipment", "#epw-paid"],
      ["rto_no_refund", cnt("rto_no_refund"), "5G returned, refund missing", "Naqeel return-to-origin without a refund", "#epw-paid"],
      ["paid_stopped", cnt("paid_stopped"), "5G paid, stopped before order", "payment taken, journey never reached the Naqeel order", "#epw-paid"],
      ["locks", d.locks.leakedTotal, "Stock locks never released", "SIM / landline LOCKED on expired journeys", "#epw-locks", "warn"],
      ["holds", d.holds.rows.length, "Card holds not settled", "AUTHORIZED, journey expired > 60 min", "#epw-holds"],
      ["ftth", d.ftth.summary.no_later_charged, "FTTH charged, no order", `≈ ${fmt(d.ftth.summary.sar_no_later)} SAR · no later order by the customer`, "#epw-ftth"],
      ["hooks", hook24+unfinished, "Webhook failures", `${hook24} failed 24 h · ${unfinished} unfinished (${d.days} d)`, "#epw-hooks", "warn"],
    ];
    const tileHtml=tiles.map(([k,v,l,s,anchor,soft])=>`<button type="button" class="epw-tile ${v?(soft?"warn":"bad"):"ok"}" data-go="${anchor}"><b>${fmt(v)}</b><span>${esc(l)}</span><small>${esc(s)}</small></button>`).join("");

    /* 5G funnel */
    const maxF=Math.max(1,...g.funnel.map(f=>f.reached), g.total);
    const funnel=g.total?`<div class="epw-chs">${g.channels.map(c=>`<div class="epw-ch">${esc(c.label)}<b>${fmt(c.total)}</b></div>`).join("")}<div class="epw-ch">all channels<b>${fmt(g.total)}</b></div></div>
      <div class="epw-fun">${g.funnel.map(f=>`<div class="epw-frow"><span class="l" title="${esc(f.step)}">${esc(f.label)}</span><div class="b"><div style="width:${Math.round(100*f.reached/maxF)}%"></div></div><span class="v">${fmt(f.reached)}</span><span class="d">${f.drop?`−${fmt(f.drop)} · ${f.drop_pct}%`:""}</span></div>`).join("")}</div>
      ${g.unknownSteps.length?`<div class="epw-note">Steps not in the 30 Sep code: ${g.unknownSteps.map(u=>esc(u.step)+" ("+u.n+")").join(", ")}</div>`:""}`:`<div class="epw-empty">No 5G e-purchase journey in the window.</div>`;
    const maxD=Math.max(1,...g.daily.map(x=>x.started));
    const days=g.daily.length?`<div class="epw-days">${g.daily.map(x=>{ const h=v=>Math.round(100*v/maxD); return `<div class="c" title="${esc(x.day)} · ${x.started} started · ${x.past_location} past location · ${x.ordered} paid + ordered"><i class="s" style="height:${h(x.started-x.past_location)}%"></i><i class="p" style="height:${h(x.past_location-x.ordered)}%"></i><i class="o" style="height:${h(x.ordered)}%"></i></div>`; }).join("")}</div>
      <div class="epw-leg"><span><i style="background:rgba(100,116,139,.35)"></i>ended at location</span><span><i style="background:#2563eb"></i>past location</span><span><i style="background:var(--green,#0e9f5a)"></i>paid + ordered</span><span>${esc(g.daily[0].day)} → ${esc(g.daily[g.daily.length-1].day)}</span></div>`:"";

    /* SIM check */
    const simTot=g.simCheck.filter(r=>r.call==="querySimCard").reduce((a,r)=>a+r.n,0);
    const sim=table(["Call","Outcome","Calls","Share"], g.simCheck.map(r=>{ const ok=/simState I$|resultCode 0$/.test(r.outcome); return [td(esc(r.call),"mono"),td(pill(esc(r.outcome),ok?"green":"red")),td(fmt(r.n),"num"),td(r.call==="querySimCard"&&simTot?Math.round(100*r.n/simTot)+"%":"","num")]; }),"No SIM check logged in the last 7 days.");

    /* paid 5G journeys */
    const clsKeys=Object.keys(g.byCls);
    const paidRows=g.paid.filter(p=>!S.cls||p.cls===S.cls);
    const paid=`<div class="epw-chips"><button type="button" class="epw-btn${!S.cls?" on":""}" data-cls="">All ${fmt(g.paid.length)}</button>${clsKeys.map(k=>`<button type="button" class="epw-btn${S.cls===k?" on":""}" data-cls="${k}">${esc((g.classes[k]||{}).label||k)} · ${g.byCls[k]}</button>`).join("")}</div>`+
      table(["State","Journey","Channel","Created","Last change","Invoice","SAR","BSS order","Naqeel","Customer"], paidRows.map(p=>[
        td(pill(esc(p.clsLabel),p.tone)), td(esc(p.id),"mono"), td(esc(p.chLabel)), td(ksa(p.created_at)), td(`${ksa(p.updated_at)}<br><small style="color:var(--muted)">${ago(p.updated_at)} ago</small>`),
        td(esc(p.inv||"—")), td(p.amount_sar!=null?fmt(p.amount_sar):"","num"),
        td(p.order_nbr?`<span class="mono">${esc(p.order_nbr)}</span>`:(p.order_err?`<small style="color:#dc2626">${esc(p.order_err)}</small>`:(p.placeholder?`<small style="color:var(--muted)">placeholder 11223344</small>`:""))),
        td(p.naqeel?`<small class="mono">${Object.entries(p.naqeel).map(([k,v])=>esc(k)+": "+esc(v)).join("<br>")}</small>`:"")+"",
        td(`${esc(p.customer||"")}${p.mobile?`<br><small class="mono" style="color:var(--muted)">${esc(p.mobile)}</small>`:""}`)
      ]),"No paid 5G e-purchase journey in the window.");

    /* locks */
    const lockCounts=d.locks.counts.map(r=>`${pill(esc(r.goods)+" · "+esc(r.status)+" "+fmt(r.n),r.status==="LOCKED"?(r.leaked?"red":"amber"):"green")}`).join(" ");
    const locks=`<div class="epw-chips">${lockCounts}${d.unmaskAvailable?`<button type="button" class="epw-btn${S.unmask?" on":""}" id="epwUnmask" title="Full serials for the inventory team — audited (pii.unmask)">${S.unmask?"Hide full serials":"Show full serials"}</button>`:""}</div>`+
      table(["Goods","Serial","Journey","Channel","Stopped at","Expired","Locked"], d.locks.leaked.map(r=>[td(pill(esc(r.goods),"amber")),td(esc(r.sn),"mono"),td(esc(r.wf),"mono"),td(esc(r.chLabel)),td(esc(r.stepLabel)),td(`${ksa(r.expired_at)}<br><small style="color:var(--muted)">${ago(r.expired_at)} ago</small>`),td(ksa(r.created_at))]),"No leaked lock.");

    /* holds */
    const holds=table(["Journey type","Journey","Channel","Step","Invoice","Expired","Order in context"], d.holds.rows.map(r=>[td(esc(r.type)),td(esc(r.wf),"mono"),td(esc(r.chLabel)),td(esc(r.step)),td(esc(r.invoice),"mono"),td(`${ksa(r.expired_at)}<br><small style="color:var(--muted)">${ago(r.expired_at)} ago</small>`),td(r.has_order?pill("yes → capture","green"):pill("no → void","amber"))]),"No unsettled authorisation.");
    const mix=d.holds.mix.length?`<div class="epw-chips" style="margin-top:8px">${d.holds.mix.map(m=>pill(`${esc(m.wf==="ePurchase5GWhiteLabel"?"5G":"FTTH")} · ${esc(m.status)} ${fmt(m.n)}`,m.status==="AUTHORIZED"?"amber":m.status==="VOIDED"||m.status==="REFUNDED"?"grey":"green")).join(" ")}</div>`:"";

    /* FTTH */
    const fs=d.ftth.summary, maxW=Math.max(1,...d.ftth.weekly.map(w=>w.total));
    const ftth=`<div class="epw-chs"><div class="epw-ch">expired after paying<b>${fmt(fs.total)}</b></div><div class="epw-ch">same customer reached the order later<b>${fmt(fs.retried)}</b></div><div class="epw-ch">charged, no later order<b style="color:#dc2626">${fmt(fs.no_later_charged)}</b></div><div class="epw-ch">≈ SAR<b>${fmt(fs.sar_no_later)}</b></div><div class="epw-ch">card hold only<b>${fmt(fs.held)}</b></div></div>
      ${d.ftth.weekly.length?`<div class="epw-fun">${d.ftth.weekly.map(w=>`<div class="epw-frow"><span class="l">week of ${esc(w.week)}</span><div class="b"><div style="width:${Math.round(100*w.no_later_charged/maxW)}%;background:#dc2626"></div></div><span class="v">${fmt(w.no_later_charged)}</span><span class="d" style="color:var(--muted)">of ${fmt(w.total)}</span></div>`).join("")}</div>`:""}
      <div style="margin-top:10px">${table(["Journey","Channel","Paid","Expired at","Invoice","SAR","Customer"], d.ftth.list.map(r=>[td(esc(r.id),"mono"),td(esc(r.chLabel)),td(ksa(r.created_at)),td(`${esc(r.stepLabel)}<br><small style="color:var(--muted)">${ksa(r.expired_at)}</small>`),td(esc(r.inv)),td(r.amount_sar!=null?fmt(r.amount_sar):"","num"),td(esc(r.customer||""),"mono")]),"None in the window.")}</div>
      <div class="epw-note">The order is created only after verification + OTP (the OTP step's afterFinish). A charged invoice on a journey that expired at those steps means the money was taken and no order was placed — unless an order was created another way (back-office). <b>To be confirmed with Finance / the Fixed squad before acting</b>; the matching alert rule is seeded OFF.</div>`;

    /* webhooks */
    const hooks=table(["Source","OK","Failed","Unfinished","Failed 24 h","Newest","Last failure"], d.webhooks.sources.map(s=>[td(esc(s.source)),td(fmt(s.ok),"num"),td(s.failed?`<span style="color:#dc2626">${fmt(s.failed)}</span>`:"0","num"),td(s.unfinished?`<span style="color:#d97706">${fmt(s.unfinished)}</span>`:"0","num"),td(fmt(s.failed_24h),"num"),td(ksa(s.newest)),td(ksa(s.last_fail))]),"No webhook in the window.")+
      (d.webhooks.failures.length?`<div style="margin-top:10px">${table(["Source","When","Retries","Reason"], d.webhooks.failures.map(f=>[td(esc(f.source)),td(ksa(f.created_at)),td(fmt(f.retries),"num"),td(`<small>${esc(f.reason||"")}</small>`)]))}</div>`:"")+
      `<div class="epw-note">The Naqeel delivery webhook (delivered / returned) is not recorded in webhook_requests by the backend — its outcome shows only in the paid-journey states above.</div>`;

    /* post → pre */
    const p2=d.post2pre, maxP=Math.max(1,p2.total);
    const post2pre=p2.total?`<div class="epw-fun">${p2.funnel.map(f=>`<div class="epw-frow"><span class="l">${esc(f.label)}</span><div class="b"><div style="width:${Math.round(100*f.reached/maxP)}%"></div></div><span class="v">${fmt(f.reached)}</span><span class="d">${f.drop?`−${fmt(f.drop)}`:""}</span></div>`).join("")}</div>`:`<div class="epw-empty">No post → pre journey in the last ${d.days} days — the journey is in the 30 Sep code but not used yet.</div>`;

    host.querySelector("#epwBody").innerHTML=`
      ${d.warnings&&d.warnings.length?`<div class="epw-warn" style="margin-bottom:12px">Some parts could not be read: ${d.warnings.map(esc).join(" · ")}</div>`:""}
      <div class="epw-tiles">${tileHtml}</div>
      <div class="epw-grid" style="margin-top:14px">
        <div class="epw-card"><h3>5G e-purchase · journeys</h3><div class="cs">ePurchase5GWhiteLabel — live since 17 Sep · web and Salam Home app · last ${d.days} days. The location step reserves stock at Naqeel, checks the SIM in BSS and locks SIM + landline.</div>${funnel}${days}</div>
        <div class="epw-card"><h3>Location step · SIM check (7 days)</h3><div class="cs">BSS answers for the SIM Naqeel reserved. <b>simState I</b> = sellable; anything else stops the journey with "Sim card is not available" — Naqeel stock and BSS inventory out of step.</div>${sim}</div>
        <div class="epw-card epw-wide" id="epw-paid"><h3>5G e-purchase · every paid journey</h3><div class="cs">Order number 11223344 is a placeholder written at payment; the real BSS order is created when Naqeel reports the delivery (event 7). Returned shipments (events 9 / 113) are refunded and the stock released.</div>${paid}</div>
        <div class="epw-card" id="epw-locks"><h3>Stock locks never released</h3><div class="cs">SIM (ICCID) and landline (MSISDN) locked at the location step on journeys that expired more than 2 h ago. Cancelling a journey does not release them and no scheduler runs the release — ask the inventory team to release these serials.</div>${locks}</div>
        <div class="epw-card" id="epw-holds"><h3>Card holds not settled</h3><div class="cs">epurchase_payments rows still AUTHORIZED on journeys expired more than 60 min ago. The backend's 10-minute loop should capture (order exists) or void them. The row can be stale — confirm the invoice in payments before acting.</div>${holds}${mix}</div>
        <div class="epw-card epw-wide" id="epw-ftth"><h3>E-purchase FTTH · charged before the order</h3><div class="cs">Journeys holding a PAID / CAPTURED invoice that expired at verification or OTP, last ${d.days} days, checked against the same customer's later journeys.</div>${ftth}</div>
        <div class="epw-card" id="epw-hooks"><h3>Payment webhooks</h3><div class="cs">webhook_requests per source, last ${d.days} days. Unfinished = no outcome 10 min after arrival (the handler crashed or is still running).</div>${hooks}</div>
        <div class="epw-card"><h3>Salam Home · post → pre</h3><div class="cs">salamHomeChangePlanPost2Pre — SADAD instant invoice for the open bill, then the payment.</div>${post2pre}</div>
      </div>
      <div class="epw-note">Snapshot ${ksa(d.generated_at)} KSA · read in ${fmt(d.took_ms)} ms · cached 10 min · names cut to the first name, numbers to their last digits${d.unmasked?" · <b>full serials shown (audited)</b>":""}.</div>`;

    const body=host.querySelector("#epwBody");
    body.querySelectorAll(".epw-tile").forEach(b=>b.onclick=()=>{ const t=body.querySelector(b.dataset.go); if(t) t.scrollIntoView({behavior:"smooth",block:"start"}); });
    body.querySelectorAll(".epw-btn[data-cls]").forEach(b=>b.onclick=()=>{ S.cls=b.dataset.cls; draw(host,fx,d); const t=body.querySelector("#epw-paid"); if(t) t.scrollIntoView({block:"nearest"}); });
    const um=body.querySelector("#epwUnmask"); if(um) um.onclick=()=>{ S.unmask=!S.unmask; render(host,fx); };
  }

  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.epwatch={ label:"Payments watch", sub:"5G e-purchase · stock locks · card holds · webhooks", render:(host,fx)=>render(host,fx||window.FX) };
})();
