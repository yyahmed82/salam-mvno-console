/* Subscriber 360 — unified profile by MSISDN or National ID.
 * Auth headers (X-Console-User/Role) are injected globally by ops.js's fetch wrapper. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API = window.API_BASE;
  const api=(p)=>window.fetch(API+p).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  let curKey=null, unmasked=false, curLines=[];
  const SES=()=>(window.opsSession?window.opsSession():{});
  const canUnmask=()=>{ const s=SES(); return !!(s.me&&s.me.caps&&s.me.caps.unmaskPII); };

  const KSA=iso=>{ if(!iso) return "—"; try{ return new Date(iso).toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).replace(","," ·"); }catch(e){ return String(iso); } };
  const day=iso=>{ if(!iso) return "—"; try{ return new Date(iso).toLocaleDateString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"short",year:"numeric"}); }catch(e){ return String(iso); } };
  const dot=ok=> ok===true?'<span class="sb-dot ok"></span>':ok===false?'<span class="sb-dot fail"></span>':'<span class="sb-dot pend"></span>';

  function shell(){
    const host=$("#view-sub360"); if(!host) return;
    host.innerHTML=`<div class="panel">
      <h2>Customer 360</h2>
      <div class="sub">One customer, both businesses — <b>Mobile</b> (identity, lines/SIMs, plan, payments, journey) and <b>Fixed</b> (FTTH / 5G home services, orders, dealer, errors, payments). Search by MSISDN or National ID for mobile; by service/account number (FTTH…), customer code, customer ID, BSS order number, 5G number or ICCID for fixed. PII is masked unless you can unmask.</div>
      <div class="sb-search">
        <input id="sbKey" placeholder="MSISDN · National ID · FTTH account · customer code / ID · order no · ICCID" value="${esc(curKey||'')}">
        <button class="pill" id="sbGo" style="border-left-color:var(--green)">Look up</button>
      </div>
      <div id="sbBody" style="margin-top:14px"></div>
    </div>`;
    const go=()=>{ const k=$("#sbKey").value.trim(); if(k){ curKey=k; unmasked=false; curTab='overview'; load(); if(window.setConsoleHash) window.setConsoleHash("subscriber?key="+encodeURIComponent(k)); } };
    $("#sbGo").addEventListener("click",go);
    $("#sbKey").addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
    if(curKey) load();
  }

  async function load(){
    const box=$("#sbBody"); if(!box) return; box.innerHTML=`<div class="sub">Loading profile…</div>`;
    // both businesses in parallel — the Fixed lookup is optional (feature-gated on the server)
    const [dr,fr]=await Promise.allSettled([
      api("/api/subscriber?key="+encodeURIComponent(curKey)+(unmasked?"&unmask=1":"")),
      api("/api/fixed/customer?key="+encodeURIComponent(curKey)+(unmasked?"&unmask=1":""))
    ]);
    if(dr.status!=="fulfilled"){ box.innerHTML=`<div class="albanner">${esc(dr.reason&&dr.reason.message||"lookup failed")}</div>`; return; }
    const d=dr.value; curFixed=(fr.status==="fulfilled")?fr.value:{found:false,error:(fr.reason&&fr.reason.message)||""};
    hasFixed=!!(curFixed&&curFixed.found);
    if(!d.found){
      if(hasFixed){ box.innerHTML=fixedHead(curFixed)+`<div class="sbt-pane" data-tab="fixed">${fixedPane(curFixed)}</div>`; wireFixed(box);
        const ub=$("#sbUnmask"); if(ub) ub.addEventListener("click",()=>{ unmasked=!unmasked; load(); }); return; }
      box.innerHTML=`<div class="okbox">No customer found for “${esc(curKey)}” on either side. Mobile: MSISDN in intl format (9665…) or National ID. Fixed: service/account number, customer code or ID, order number, 5G number or ICCID.${curFixed&&curFixed.error?`<div class="rl" style="color:var(--muted);margin-top:6px">Fixed lookup: ${esc(curFixed.error)}</div>`:""}</div>`; return; }
    curLines = d.lines || [];
    /* CALL-CENTER LAYOUT (4 Sep 2026 redesign): one STICKY header (who is this + line selector +
     * gateway health + tabs — always visible while scrolling) over five task-focused tabs.
     * Every card renderer below is UNCHANGED — this is a re-arrangement, not a rewrite. */
    box.innerHTML = headCard(d.identity)
      + `<div class="sbt-pane" data-tab="overview">${liveCard('overview')+summaryRow(d.summary)+idCard(d.identity)}</div>`
      + `<div class="sbt-pane" data-tab="billing" hidden>${liveCard('billing')}</div>`
      + `<div class="sbt-pane" data-tab="usage" hidden>${liveCard('usage')}</div>`
      + `<div class="sbt-pane" data-tab="journey" hidden>${onboardingCard()+linesCard(d.lines)+timelineCard(d.events)}</div>`
      + `<div class="sbt-pane" data-tab="diag" hidden>${logsCard()+liveCard('diag')}</div>`
      + (hasFixed?`<div class="sbt-pane" data-tab="fixed" hidden>${fixedPane(curFixed)}</div>`:'');
    wireTabs(box); wireTimeline(box); wireLines(box); wireLogs(box); wireLive(box); wireOnboarding(box); if(hasFixed) wireFixed(box);
    if(!hasFixed&&curFixed){ const l=curFixed.link; const note=document.createElement("div"); note.className="rl"; note.style.cssText="font-size:11px;color:var(--muted);margin:6px 0 10px";
      note.textContent="Fixed services: "+(curFixed.error?"lookup failed — "+curFixed.error:(l&&l.reason?"could not link through nexus — "+l.reason:(l?"none found for this customer (nexus checked "+(l.ids?l.ids.length:0)+" workflow(s))":"none found for this key")));
      const head=box.querySelector(".sbt-head"); if(head) head.insertAdjacentElement("afterend",note); }
    const ub=$("#sbUnmask"); if(ub) ub.addEventListener("click",()=>{ unmasked=!unmasked; load(); });
  }

  /* ---- STICKY CUSTOMER HEADER + TABS (4 Sep 2026) -------------------------------------------- */
  const TABS=[
    {k:'overview', ic:'⌂',  name:'Overview'},
    {k:'billing',  ic:'﷼',  name:'Billing & Payments'},
    {k:'usage',    ic:'▦',  name:'Usage & Add-ons'},
    {k:'journey',  ic:'🧭', name:'Journey & Orders'},
    {k:'diag',     ic:'🩺', name:'Logs & Diagnostics'}
  ];
  let curTab='overview', curFixed=null, hasFixed=false;
  const tabsNow=()=>hasFixed?TABS.concat([{k:'fixed',ic:'🏠',name:'Fixed services'}]):TABS;
  function headCard(i){
    i=i||{};
    const unmaskBtn = canUnmask()? `<button class="pill" id="sbUnmask" style="border-left-color:var(--purple)">${unmasked?'Mask PII':'Unmask PII'}</button>` : '';
    const act = i.activated===true?'<span class="sb-badge ok">Activated</span>':i.activated===false?'<span class="sb-badge pend">Not activated</span>':'';
    const nJourney=(curLines||[]).length||null;
    return `<div class="sbt-head">
      <div class="sbt-head-row">
        <div class="sbt-avatar">👤</div>
        <div class="sbt-who">
          <div id="sbSalamNums" class="sbt-nums">…</div>
          <div class="rl sbt-sub">NID <b>${esc(i.nationality_id_number||'—')}</b> · ${esc(i.current_plan||'—')} ${act}
            <span style="color:var(--muted)">· <span id="sbLineCount">…</span> Salam line(s) · ${esc(i.flow||'—')}</span></div>
        </div>
        <span id="lvHealth" class="rl sbt-health"></span>
        ${unmaskBtn}
      </div>
      <div id="lvLineBar" class="sbt-linebar"></div>
      <div class="sbt-tabs">${tabsNow().map(t=>`<button class="sbt-tab${t.k===curTab?' on':''}" data-sbt="${t.k}">${t.ic} ${esc(t.name)}${t.k==='journey'&&nJourney?` <span class="sbt-n">${nJourney}</span>`:''}${t.k==='fixed'&&curFixed?` <span class="sbt-n">${curFixed.inventory_summary?curFixed.inventory_summary.active:(curFixed.services||[]).length}</span>`:''}</button>`).join('')}</div>
    </div>`;
  }
  function wireTabs(box){
    const show=k=>{
      curTab=k;
      box.querySelectorAll('.sbt-tab').forEach(b=>b.classList.toggle('on',b.dataset.sbt===k));
      box.querySelectorAll('.sbt-pane').forEach(p=>{ p.hidden=(p.dataset.tab!==k); });
    };
    box.querySelectorAll('.sbt-tab').forEach(b=>b.addEventListener('click',()=>show(b.dataset.sbt)));
    if(!tabsNow().some(t=>t.k===curTab)) curTab='overview';
    show(curTab);
  }

  function idCard(i){
    i=i||{};
    // Salam numbers, unmask, line count and status live in the sticky header now — this card
    // keeps the slower-moving order/identity details for the Overview tab.
    return `<div class="sb-id">
      <div class="sb-id-h"><b>Identity &amp; order details</b></div>
      <div class="sb-grid">
        ${kv('CONTACT MOBILE (order)',i.mobile_number)}
        ${kv('National ID',i.nationality_id_number)}
        ${kv('Current plan',i.current_plan)}
        ${kv('Status',i.status)}
        ${kv('Order state',i.state)}
        ${kv('Flow',i.flow)}
        ${kv('Order attempts',i.lines_count)}
        ${kv('First seen',day(i.first_seen))}
        ${kv('Last seen',day(i.last_seen))}
      </div></div>`;
  }
  const kv=(k,v)=>`<div class="sb-kv"><span class="sb-k">${esc(k)}</span><span class="sb-v">${esc(v==null||v===''?'—':v)}</span></div>`;

  const STAGE={payments:'Payments',activation_logs:'Activation',eligibility_logs:'Eligibility',nafath_logs:'Nafath',delivery_requests:'Delivery',change_plan_logs:'Plan change',onboarding_orders:'Onboarding'};
  function summaryRow(sum){
    sum=sum||{}; const keys=Object.keys(sum); if(!keys.length) return '';
    return `<div class="sb-summary">`+keys.map(k=>{ const s=sum[k];
      return `<div class="sb-stat"><div class="sb-stat-h">${esc(STAGE[k]||k)}</div>
        <div class="sb-stat-n">${s.total}</div>
        <div class="sb-stat-b">${s.ok?`<span class="ok">${s.ok} ok</span>`:''}${s.fail?`<span class="fail">${s.fail} fail</span>`:''}${s.pending?`<span class="pend">${s.pending} pending</span>`:''}</div></div>`;
    }).join('')+`</div>`;
  }

  /* Every line/order row is clickable → expands to THAT order's full journey (payments,
   * activation with request/response, delivery, …) fetched lazily from /api/transaction.
   * This is what makes a National-ID search with 12 lines fully explorable: the header
   * timeline covers only the most recent order; each line carries its own complete story. */
  function linesCard(lines){
    if(!lines||!lines.length) return '';
    const rows=lines.map((l,i)=>`<tr class="sb-line" data-oid="${esc(l.id)}" data-ln="ln${i}" role="button" tabindex="0" title="Click for this order's full journey">
      <td>${esc(l.mobile_number||'—')}</td><td>${esc(l.plan||'—')}</td>
      <td>${esc(l.line_type||'—')}</td><td>${esc(l.sim||'—')}</td>
      <td>${(v=>{const c=stClass(v);return `<span class="mono" style="${c==='ok'?'color:#16a34a;font-weight:700':c==='bad'?'color:#dc2626;font-weight:700':c==='mid'?'color:#d97706;font-weight:700':''}">${esc(v)}</span>`;})(l.status||l.aasm_state||'—')}</td>
      <td>${l.activated?'✓':'—'}</td><td class="rl">${day(l.created_at)}<span class="sb-chev">▸</span></td></tr>
      <tr class="sb-line-x" id="ln${i}" hidden><td colspan="7"><div class="sb-line-tl" id="ln${i}tl"><div class="sub">…</div></div></td></tr>`).join('');
    return `<div class="sb-block"><h3>Lines / SIMs <span class="rl">(${lines.length} · click a line for its full journey)</span></h3>
      <table class="sb-tbl"><thead><tr><th>MSISDN</th><th>Plan</th><th>Type</th><th>SIM</th><th>Status</th><th>Act.</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function wireLines(box){
    box.querySelectorAll('.sb-line').forEach(r=>{
      const toggle=async()=>{
        const x=document.getElementById(r.dataset.ln); if(!x) return;
        x.hidden=!x.hidden; r.classList.toggle('sb-open',!x.hidden);
        if(x.hidden||r.dataset.loaded) return;
        r.dataset.loaded='1';
        const holder=document.getElementById(r.dataset.ln+'tl');
        holder.innerHTML='<div class="sub">Loading this order’s journey…</div>';
        try{
          const tl=await api('/api/transaction?id='+encodeURIComponent(r.dataset.oid)+(unmasked?'&unmask=1':''));
          const evs=(tl&&tl.events)||[];
          holder.innerHTML = evs.length
            ? `<div class="sb-tl">${evRows(evs, r.dataset.ln)}</div>`
            : '<div class="okbox">No journey events recorded for this order.</div>';
          wireTimeline(holder);
        }catch(e){ r.dataset.loaded=''; holder.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; }
      };
      r.addEventListener('click',ev=>{ if(ev.target.closest('button,a')) return; toggle(); });
      r.addEventListener('keydown',ev=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); toggle(); } });
    });
  }

  /* Every timeline event is clickable → expands to the full trace the API already sends:
   * category, API endpoint, status, exec time, and the raw request/response payloads.
   * GENERIC by design: it renders whatever trace fields the event carries, so payments,
   * activation, Semati, Nafath, eligibility, delivery and plan-change all get the same drawer
   * with zero per-source code. PII inside payloads is governed server-side by maskDeep. */
  const fmtJson=v=>{ if(v==null) return null; try{ return typeof v==="string"?v:JSON.stringify(v,null,2); }catch(e){ return String(v); } };
  const xkv=(k,v)=> v==null||v===''?'':`<span class="sb-x-kv"><b>${esc(k)}</b> ${esc(v)}</span>`;
  /* TKT-000005 — status values were plain grey text, unreadable at a glance. One classifier,
   * used for the trace Status/Result AND the Lines table: green = success, red = failure,
   * amber = pending/in-flight, grey = unknown. */
  const stClass=v=>{ const x=String(v==null?'':v).toLowerCase();
    if(!x) return '';
    if(/^(00|0|200|201|204|success|succeeded|ok|completed|complete|done|delivered|active|activated|verified|paid|approved|y)$/.test(x)) return 'ok';
    if(/fail|error|declined|reject|denied|expired|cancel|abort|timeout|-\d|4\d\d|5\d\d/.test(x)) return 'bad';
    if(/pending|progress|await|initial|processing|created|sent|new/.test(x)) return 'mid';
    return ''; };
  const stChip=(k,v)=>{ if(v==null||v==='') return '';
    const c=stClass(v), col=c==='ok'?'background:var(--tint-green,#dcfce7);color:var(--tint-green-fg,#166534)':c==='bad'?'background:#fee2e2;color:#b91c1c':c==='mid'?'background:var(--tint-amber,#fef3c7);color:var(--tint-amber-fg,#b45309)':'background:var(--panel2,#f1f5f9);color:var(--muted,#64748b)';
    return `<span class="sb-x-kv"><b>${esc(k)}</b> <span class="mono" style="${col};border-radius:6px;padding:1px 8px;font-weight:700">${esc(v)}</span></span>`; };
  const xblock=(label,body,id)=>`<div class="sb-x-h"><span>${esc(label)}</span><button class="pill sb-copy" data-copy="${id}" style="border-left-color:var(--blue,#1d4ed8)">Copy</button></div><pre id="${id}">${esc(body)}</pre>`;

  // Render a set of events as clickable rows with trace drawers. `pfx` keeps element ids unique
  // so the SAME renderer serves the main journey AND any number of per-line nested timelines.
  function evRows(events, pfx){
    return events.map((e,i)=>{
      const req=fmtJson(e.request), res=fmtJson(e.response);
      const id=pfx+'x'+i;
      // payment events carry the UPG join key (payment_reference_id) in request.reference —
      // surface the gateway's own record of this exact payment (charges, bank state log, webhooks)
      const upgRef=(e.source==='payments'&&e.request&&typeof e.request==='object'&&e.request.reference)?String(e.request.reference):null;
      const drawer=`<div class="sb-ev-x" id="${id}" hidden>
        <div class="sb-x-grid">
          ${xkv('Category',STAGE[e.source]||e.source)}
          ${xkv('Type',e.kind)}
          ${xkv('API',e.endpoint)}
          ${stChip('Status',e.status)}
          ${xkv('Exec time',e.ms!=null?e.ms+'ms':null)}
          ${stChip('Result',e.ok===true?'ok':e.ok===false?'FAILED':'pending')}
          ${xkv('At (KSA)',KSA(e.at))}
          ${upgRef?`<button class="pill" data-sbupg="${esc(upgRef)}" style="padding:2px 10px;font-size:11px;border-left-color:#ea580c" title="The gateway's record of this exact payment — charge attempts, bank state log, webhook delivery">⇄ UPG gateway</button>`:''}
        </div>
        ${req?xblock('Request',req,pfx+'q'+i):''}
        ${res?xblock('Response',res,pfx+'r'+i):''}
        ${!req&&!res?`<div class="rl" style="padding:6px 2px">No request/response payload recorded for this event — the source table logged only the outcome.</div>`:''}
      </div>`;
      return `<div class="sb-ev sb-click" data-x="${id}" role="button" tabindex="0" title="Click for API, request & response${upgRef?' · ⇄ UPG available inside':''}">
        <div class="sb-ev-t">${dot(e.ok)}<span class="rl">${KSA(e.at)}</span></div>
        <div class="sb-ev-src">${esc(STAGE[e.source]||e.source)}<small>${esc(e.kind||'')}</small></div>
        <div class="sb-ev-d"><bdi>${esc(e.detail||'')}</bdi>${e.ms!=null?`<span class="rl" dir="ltr"> · ${e.ms}ms</span>`:''}<span class="sb-chev">▸</span></div>
      </div>${drawer}`;
    }).join('');
  }

  /* ---- LOGS (2 Sep 2026, Call Center ask) ----------------------------------------------------
   * Deeper visibility per subscriber without leaving the page. Three lazy sections, all riding
   * endpoints that already exist and already mask/audit:
   *   · OTP / SMS log      → /api/sms/search   (every OTP: channel, verified?, template text)
   *   · Login & session    → /api/login/state  (last auth, device/IP, reasoned verdict)
   *   · Full cross-system  → the transaction timeline drawer (replica + DMS ledgers + gateway)
   * Loaded on click so the profile stays fast; nothing is fetched the agent didn't ask for. */
  function logsCard(){
    return `<div class="sb-block"><h3>Logs <span class="rl">(this subscriber · loaded on demand)</span></h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 8px">
        <button class="pill" id="sbLogSms" style="border-left-color:#8b5cf6">✉ OTP / SMS log</button>
        <button class="pill" id="sbLogLogin" style="border-left-color:#0ea5e9">◔ Login &amp; session</button>
        <button class="pill" id="sbLogTl" style="border-left-color:#16a34a">⇄ Full cross-system timeline</button>
      </div>
      <div id="sbLogOut"></div></div>`;
  }
  function wireLogs(box){
    const out=()=>box.querySelector('#sbLogOut');
    const busy=()=>{ out().innerHTML='<div class="rl" style="padding:6px 2px">Loading…</div>'; };
    const smsB=box.querySelector('#sbLogSms');
    if(smsB) smsB.addEventListener('click', async ()=>{
      busy();
      try{
        const d=await api('/api/sms/search?q='+encodeURIComponent(curKey)+'&limit=25'+(unmasked?'&unmask=1':''));
        const rows=d.rows||[];
        if(!rows.length){ out().innerHTML=`<div class="rl" style="padding:6px 2px">${esc((d.notes||[]).join(' · ')||'No OTP/SMS records for this identifier.')}</div>`; return; }
        out().innerHTML=`<div style="border:1px solid var(--line);border-radius:8px;max-height:260px;overflow:auto"><table class="sb-tbl">
          <thead><tr><th>Sent (KSA)</th><th>Channel</th><th>Type</th><th>Status</th><th>Message</th></tr></thead><tbody>
          ${rows.map(r=>`<tr><td class="rl">${esc(KSA(r.sent_at))}</td><td>${esc(r.channel||'—')}</td><td>${esc(r.message_type||'—')}</td>
            <td style="font-weight:700;color:${r.status==='verified'?'#16a34a':/expired|fail/.test(r.status||'')?'#dc2626':'#d97706'}">${esc(r.status||'—')}</td>
            <td style="max-width:420px">${esc(r.body_en||r.body_note||'')}</td></tr>`).join('')}
          </tbody></table></div>`;
      }catch(e){ out().innerHTML=`<div class="albanner">${esc(e.message)}</div>`; }
    });
    const lgB=box.querySelector('#sbLogLogin');
    if(lgB) lgB.addEventListener('click', async ()=>{
      busy();
      try{
        const d=await api('/api/login/state?q='+encodeURIComponent(curKey)+(unmasked?'&unmask=1':''));
        let h='';
        const vtxt=v=>typeof v==='string'?v:(v&&(v.text||v.summary||v.verdict))||JSON.stringify(v);
        if(d.verdict) h+=`<div class="okbox" style="border-left:3px solid #0ea5e9"><b>Verdict:</b> ${esc(vtxt(d.verdict))}</div>`;
        (d.lines||[]).forEach(l=>{ h+=`<div class="sb-ev"><div class="sb-ev-d"><bdi>${esc(Object.entries(l).filter(([k,v])=>v!=null&&v!=='').map(([k,v])=>k+': '+v).join(' · '))}</bdi></div></div>`; });
        (d.evidence||[]).forEach(x=>{ h+=`<div class="rl" style="padding:3px 2px">· ${esc(typeof x==='string'?x:JSON.stringify(x))}</div>`; });
        (d.notes||[]).forEach(n=>{ h+=`<div class="rl" style="padding:3px 2px;color:var(--muted)">${esc(n)}</div>`; });
        out().innerHTML=h||'<div class="rl" style="padding:6px 2px">No login records found for this identifier.</div>';
      }catch(e){ out().innerHTML=`<div class="albanner">${esc(e.message)}</div>`; }
    });
    const tlB=box.querySelector('#sbLogTl');
    if(tlB) tlB.addEventListener('click', ()=>{ if(window.opsOpenTimeline) window.opsOpenTimeline(curKey, null, null); });
  }

  /* ---- LIVE CUSTOMER VIEW (2 Sep 2026) --------------------------------------------------------
   * Current truth straight from BSS via the UIL gateway (the same endpoints the app calls),
   * plus two replica panels. Per card: one-line answer, freshness stamp, ↻ Refresh (a REAL live
   * call), ▸ Trace (endpoint · request · response), and a history dropdown over the snapshot
   * cache — so "what did the balance say yesterday?" needs no new BSS call. Live panels load on
   * demand only (never hammer BSS on profile open); replica panels load themselves. */
  const LIVE_PANELS=[
    {k:'appview', ic:'📱', hint:"As in the customer's app — plan · usage · due amount", compose:true, tab:'overview', wide:true},
    {k:'balance', ic:'◉', hint:'Current balance (BSS)', tab:'overview'},
    {k:'app',     ic:'◔', hint:'App account & last login (replica)', auto:true, tab:'overview'},
    {k:'bill',    ic:'⎘', hint:'Account balance & last invoice (BSS, postpaid)', tab:'billing'},
    {k:'invoices',ic:'≣', hint:'Invoice list (BSS, postpaid)', tab:'billing'},
    {k:'payments',ic:'₨', hint:'Payments & recharges — app record (replica)', auto:true, wide:true, tab:'billing'},
    {k:'bundles', ic:'▦', hint:'Data / minutes bundles (BSS)', tab:'usage'},
    {k:'plan',    ic:'✦', hint:'Active price plan option (BSS)', tab:'usage'},
    {k:'addons',  ic:'➕', hint:'Addons — all subscriptions on the account (BSS)', tab:'usage'},
    {k:'vas',     ic:'🧩', hint:'VAS / addons activity — app record (as in CMS Service Logs)', auto:true, wide:true, tab:'usage'},
    {k:'profile', ic:'☰', hint:'Subscription profile & state (BSS)', tab:'diag'},
    {k:'osb',     ic:'🛢', hint:'OSB · Oracle bus — BSS-side story (archive, day-1 lag)', auto:true, wide:true, tab:'diag'}
  ];
  /* ONBOARDING · SCREEN BY SCREEN (3 Sep 2026) — reconstruct the exact app screens the customer
   * walked through, from the backend events each screen fires (order creation → eligibility →
   * Semati → Nafath → payment → delivery → activation, incl. the OSB/BSS provisioning tier).
   * Uses the SAME cross-system timeline the drawer uses (/api/transaction) — one fetch, then a
   * screen-mapping transform. Explicit button: the timeline fan-out is heavy. */
  const OB_STEPS=[
    {k:'order',    ic:'📝', name:'Registration & plan selection', m:e=>/order|onboarding/i.test(e.source||'')},
    {k:'elig',     ic:'🛂', name:'Eligibility check screen',      m:e=>/eligib/i.test(e.source||'')||/eligib/i.test(e.kind||'')},
    {k:'semati',   ic:'🛡', name:'ID verification (Semati/CITC)', m:e=>/semati/i.test((e.source||'')+(e.kind||'')+(e.endpoint||''))},
    {k:'nafath',   ic:'🪪', name:'Nafath approval screen',        m:e=>/nafath/i.test((e.source||'')+(e.kind||''))},
    {k:'payment',  ic:'₨', name:'Checkout & payment screen',     m:e=>/payment|checkout/i.test((e.source||'')+(e.kind||''))},
    {k:'delivery', ic:'📦', name:'Delivery / eSIM issuance',      m:e=>/delivery|courier/i.test((e.source||'')+(e.kind||''))},
    {k:'activate', ic:'▶', name:'SIM activation',                m:e=>/activation|activate/i.test((e.source||'')+(e.kind||''))},
    {k:'bss',      ic:'🛢', name:'BSS provisioning (behind the scenes)', m:e=>/OSB/i.test(e.source||'')}
  ];
  function onboardingCard(){
    // ORDER/SIM SELECTOR — every line attempt is traceable, not just the latest (3 Sep pm):
    // chips carry the order uuid; the timeline endpoint accepts it directly (Lines-drill contract)
    const chips=(curLines||[]).slice(0,8).map((l,i)=>`<button class="pill obSel${i===0?' obSelOn':''}" data-obid="${esc(l.id)}"
        style="padding:3px 10px;font-size:11px;border-left-color:${l.activated?'#16a34a':/fail|reject/i.test(l.status||'')?'#dc2626':'#d97706'}"
        title="${esc((l.plan||'')+' · '+(l.aasm_state||''))}">${esc(KSAd(l.created_at))} · ${esc(l.channel||'salam')} · ${esc(l.sim||'')}${l.activated?' ✓':''}</button>`).join('');
    return `<div class="sb-block"><h3>Onboarding journey <span class="rl">(screen by screen — until the SIM is active)</span></h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="pill" id="obTrace" style="padding:4px 12px;border-left-color:#16a34a">▶ Trace the exact journey</button>
        ${chips?`<span class="rl" style="font-weight:700;font-size:10.5px">SIM / ORDER:</span> ${chips}`:''}
        <span class="rl" style="color:var(--muted)">from the backend events each screen fires (app · gov checks · payment · delivery · BSS/OSB)</span>
      </div><div id="obOut" style="margin-top:8px"></div></div>`;
  }
  /* SIM PROVISIONING DETAIL — how THIS SIM came to exist: provider channel (salam/tygo/soob…),
   * flow, SIM type + ICCID, MNP donor, seller/store, order state flags. */
  function obProvisioning(l){
    if(!l) return '';
    const f=(lbl,v,mono)=>v==null||v===''?'':`<div style="min-width:130px"><div class="rl" style="font-size:9.5px;color:var(--muted);font-weight:700">${lbl}</div><div style="font-size:12px;${mono?'font-family:var(--mono,monospace);font-size:11px':''};font-weight:600">${esc(String(v))}</div></div>`;
    const chan=(l.channel||'salam');
    return `<div style="border:1px solid var(--line);border-radius:10px;background:var(--card);padding:10px 14px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <b style="font-size:12px">SIM provisioning</b>
        <span style="background:${chan==='salam'?'var(--tint-green,#dcfce7)':'#ede9fe'};color:${chan==='salam'?'#166534':'#5b21b6'};border-radius:5px;padding:0 8px;font-weight:800;font-size:10.5px">${esc(chan.toUpperCase())}</span>
        <span class="rl" style="color:var(--muted);font-size:10.5px">provider / sales channel (order origin)</span>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        ${f('FLOW',l.flow)}${f('LINE TYPE',l.line_type)}${f('SIM',l.sim)}
        ${f('ICCID',l.physical_sim_iccid,1)}
        ${f('MNP DONOR',l.mnp_operator)}${f('PORTED NUMBER',l.mnp_number,1)}
        ${f('PLAN',l.plan)}${f('ORDER STATE',l.aasm_state)}${f('STATUS',l.status)}
        ${f('ELIGIBLE',l.is_eligible===true?'yes':l.is_eligible===false?'NO':null)}
        ${f('COMPLETED',l.completed===true?'yes':'no')}${f('ACTIVATED',l.activated===true?'YES ✓':'no')}
        ${f('SELLER',l.seller_id,1)}${f('STORE',l.store_id,1)}
        ${f('ORDER ID',l.id,1)}
      </div></div>`;
  }
  function wireOnboarding(box){
    const b=box.querySelector('#obTrace'); if(!b) return;
    let selId=(curLines[0]||{}).id||null;
    box.querySelectorAll('.obSel').forEach(c=>c.addEventListener('click',()=>{
      box.querySelectorAll('.obSel').forEach(x=>x.classList.remove('obSelOn'));
      c.classList.add('obSelOn'); selId=c.dataset.obid; b.click();
    }));
    b.addEventListener('click', async ()=>{
      const out=box.querySelector('#obOut'); if(!out) return;
      b.disabled=true; out.innerHTML='<div class="rl">⏳ Tracing across all systems…</div>';
      try{
        const unmasked=sessionStorage.getItem('sb_unmask')==='1';
        const line=(curLines||[]).find(l=>l.id===selId)||null;
        const tl=await api('/api/transaction?id='+encodeURIComponent(selId||curKey)+(unmasked?'&unmask=1':''));
        const evs=(tl.events||[]).slice().sort((a,z)=>new Date(a.at)-new Date(z.at));
        if(!evs.length){ out.innerHTML=`<div class="rl" style="color:var(--muted)">${esc(tl.note||'No journey events recorded for this subscriber.')}</div>`; return; }
        /* LIFECYCLE SEGMENTATION (4 Sep): recycled MSISDNs carry events of PREVIOUS OWNERS
         * (966510050419: Apr-2022 Semati fails belong to an earlier holder). A gap > 90 days
         * splits the history into separate journeys, navigable ◀ ▶ — never stitched into one. */
        const segs=[]; let cur2=[];
        for(const e of evs){
          if(cur2.length && (new Date(e.at)-new Date(cur2[cur2.length-1].at))>90*864e5){ segs.push(cur2); cur2=[]; }
          cur2.push(e);
        }
        if(cur2.length) segs.push(cur2);
        let segIdx=segs.length-1;
        const fmt=t=>esc(KSA(t));
        const dur=(a,b2)=>{const ms=new Date(b2)-new Date(a); if(!(ms>0))return''; const m=Math.round(ms/60000);
          return m<1?'<1min':m<60?m+'min':(m/60).toFixed(1)+'h';};
        function renderSeg(){
          const sev=segs[segIdx];
          const steps=OB_STEPS.map(s=>{
            const mine=sev.filter(s.m);
            if(!mine.length) return {...s, state:'untouched'};
            const ok=mine.filter(e=>e.ok===true).length, fail=mine.filter(e=>e.ok===false).length;
            const first=mine[0], last=mine[mine.length-1];
            return {...s, state: last.ok===false?'failed':(ok?'done':'partial'), n:mine.length, ok, fail,
              first_at:first.at, last_at:last.at,
              last_detail:(last.detail||last.kind||'').slice(0,110), mine};
          });
          const reached=steps.filter(s=>s.state!=='untouched');
          const doneAct=steps.find(s=>s.k==='activate');
          const isLatest=segIdx===segs.length-1;
          const nav=segs.length>1?`<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
            <button class="pill" id="obPrev" ${segIdx===0?'disabled':''} style="padding:2px 10px">◀</button>
            <b style="font-size:12px">Journey ${segIdx+1} of ${segs.length}</b>
            <span class="rl">${fmt(sev[0].at)} → ${fmt(sev[sev.length-1].at)}</span>
            <button class="pill" id="obNext" ${isLatest?'disabled':''} style="padding:2px 10px">▶</button>
            ${!isLatest?'<span style="background:#fef3c7;color:#92400e;border-radius:5px;padding:0 8px;font-weight:700;font-size:10px">EARLIER LIFECYCLE — this number is recycled; these events may belong to a PREVIOUS owner</span>':''}
          </div>`:'';
          let prev=null;
          out.innerHTML=obProvisioning(isLatest?line:null)+nav
            +`<div class="rl" style="margin-bottom:6px"><b>${reached.length}</b> of ${OB_STEPS.length} stages touched · journey ${doneAct&&doneAct.state==='done'?'<b style="color:#16a34a">COMPLETED — SIM ACTIVE</b>':'<b style="color:#d97706">NOT COMPLETED</b>'} · started ${fmt(sev[0].at)}</div>`
            +steps.map(s=>{
              const col=s.state==='done'?'#16a34a':s.state==='failed'?'#dc2626':s.state==='partial'?'#d97706':'#cbd5e1';
              const gap=prev&&s.first_at?dur(prev,s.first_at):'';
              if(s.first_at) prev=s.last_at;
              return `<div style="display:flex;gap:10px;align-items:flex-start;position:relative;padding:0 0 2px 0">
                <div style="display:flex;flex-direction:column;align-items:center">
                  <div style="width:26px;height:26px;border-radius:50%;background:${s.state==='untouched'?'var(--card)':col}22;border:2.5px solid ${col};display:flex;align-items:center;justify-content:center;font-size:12px">${s.ic}</div>
                  <div style="width:2px;flex:1;min-height:14px;background:var(--line)"></div>
                </div>
                <div style="flex:1;padding-bottom:8px">
                  <div style="font-weight:800;font-size:12.5px;color:${s.state==='untouched'?'var(--muted)':'var(--ink)'}">${esc(s.name)}
                    ${s.state==='failed'?'<span style="background:#fee2e2;color:#b91c1c;border-radius:5px;padding:0 6px;font-weight:700;font-size:10px">FAILED</span>':''}
                    ${s.state==='done'?'<span style="color:#16a34a;font-weight:700;font-size:10.5px">✓</span>':''}
                    ${gap?`<span class="rl" style="color:var(--muted);font-size:10px">· +${gap} after previous</span>`:''}</div>
                  ${s.state==='untouched'?'<div class="rl" style="font-size:10.5px;color:var(--muted)">not reached</div>'
                    :`<div class="rl" style="font-size:11px">${fmt(s.first_at)}${s.last_at!==s.first_at?' → '+fmt(s.last_at):''} · ${s.n} event(s)${s.fail?` · <b style="color:#dc2626">${s.fail} failed</b>`:''}
                      <div style="color:var(--muted)">${esc(s.last_detail)}</div>
                      <details><summary style="cursor:pointer;font-size:10px;color:var(--muted)">all ${s.n} event(s)</summary>
                        ${s.mine.map(e=>`<div style="border-bottom:1px solid var(--line);padding:2px 0;font-size:10.5px">
                          <span class="mono">${fmt(e.at)}</span> · ${e.ok===false?'<b style="color:#dc2626">✖</b>':e.ok===true?'<span style="color:#16a34a">✓</span>':'·'} ${esc((e.source||'')+' — '+(e.detail||e.kind||'').slice(0,140))}</div>`).join('')}
                      </details></div>`}
                </div></div>`;}).join('')
            +`<div class="rl" style="font-size:10px;color:var(--muted)">Screens inferred from the backend calls each screen fires. Journeys split on 90-day gaps (recycled-number protection). Full raw view: the cross-system timeline.</div>`;
          const pb=out.querySelector('#obPrev'); if(pb) pb.addEventListener('click',()=>{ if(segIdx>0){segIdx--; renderSeg();} });
          const nb=out.querySelector('#obNext'); if(nb) nb.addEventListener('click',()=>{ if(segIdx<segs.length-1){segIdx++; renderSeg();} });
        }
        renderSeg();
      }catch(e){ out.innerHTML=`<div class="rl" style="color:#dc2626">${esc(e.message)}</div>`; }
      finally{ b.disabled=false; }
    });
  }

  function liveCard(tab){
    const list=LIVE_PANELS.filter(pn=>pn.tab===tab);
    if(!list.length) return '';
    const cards=list.map(pn=>`<div id="lvc_${pn.k}" style="border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:12px 14px;background:var(--panel,#fff);display:flex;flex-direction:column;min-height:120px${pn.wide?';grid-column:1/-1':''}">
      <div style="display:flex;align-items:center;gap:6px">
        <b style="font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(pn.hint)}">${pn.ic} ${esc(pn.hint)}</b>
        <span style="display:inline-flex;gap:5px;flex-shrink:0">
          <button class="pill" data-lvgo="${pn.k}" style="padding:2px 10px;font-size:11px;border-left-color:var(--green,#0e9f5a)" title="${pn.auto?'Refresh from the replica':'Live read from BSS (audited)'}">${pn.auto?'↻ Refresh':'⚡ Load'}</button>
          <button class="pill" data-lvtr="${pn.k}" style="padding:2px 9px;font-size:11px;border-left-color:#3b82f6" title="Show endpoint · request · response">{ }</button>
        </span>
      </div>
      <div class="rl" id="lvs_${pn.k}" style="color:var(--muted);font-size:10.5px;margin-top:3px;min-height:14px"></div>
      <div id="lvb_${pn.k}" style="margin-top:6px;font-size:12.5px;flex:1"><span class="rl" style="color:var(--muted)">${pn.auto?'Loading…':'⚡ Load calls BSS live for this line.'}</span></div>
      <div id="lvt_${pn.k}" hidden style="margin-top:7px"></div>
      <div id="lvh_${pn.k}" style="margin-top:5px"></div>
    </div>`).join('');
    return `<div class="sb-block">
      ${tab==='overview'?`<div class="rl" style="color:var(--muted);margin-bottom:4px">Live customer view — BSS via the UIL gateway + replica · ⚡ Load = audited live read · replica panels refresh themselves</div>`:''}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px;margin-top:6px">${cards}</div></div>`;
  }
  /* Salam line selector (2 Sep): order.mobile_number is the CONTACT number — the search key's
   * ACTIVATED Salam MSISDNs come from the server (activation_logs / mnp_number). Every BSS panel
   * queries the SELECTED line; refs are order ids (opaque), numbers arrive masked. */
  let _lvLine=null, _lvLines=[];
  async function lvLoadLines(box){
    const bar=box.querySelector('#lvLineBar'); if(!bar) return;
    try{
      const d=await api(`/api/subscriber/live/lines?key=${encodeURIComponent(curKey)}${unmasked?'&unmask=1':''}`);
      _lvLines=d.lines||[];
      if(!_lvLines.length){
        bar.innerHTML=d.error
          ?`<div class="okbox" style="border-left:3px solid #dc2626"><b>Salam line discovery failed:</b> ${esc(d.error)}</div>`
          :`<div class="okbox" style="border-left:3px solid var(--tint-amber-fg,#d97706)"><b>No activated Salam line found for this search key.</b>
          The order's contact number may belong to another operator — BSS reads will likely fail. If the customer has a Salam number, search with it directly.</div>`;
        const lc=document.getElementById('sbLineCount'); if(lc) lc.textContent=String(_lvLines.length);
      const sn=document.getElementById('sbSalamNums'); if(sn) sn.textContent='— none found —';
        return;
      }
      if(!_lvLine) _lvLine=_lvLines[0].ref;
      bar.innerHTML=`<span class="rl" style="font-weight:700;margin-right:6px">SALAM LINE</span>`+_lvLines.map(l=>
        `<button class="pill ${l.ref===_lvLine?'':'ghost'}" data-lvline="${esc(l.ref)}" style="padding:3px 12px;font-size:11.5px;border-left-color:${l.ref===_lvLine?'var(--green,#0e9f5a)':'var(--muted)'}"
           title="${esc(l.source)}${l.at?' · '+KSA(l.at):''}">${esc(l.msisdn)} <small style="color:var(--muted)">· ${esc(l.plan||l.source)}</small></button>`).join(' ')
        +`<span class="rl" style="margin-left:8px;color:var(--muted)">${_lvLines.length} line(s) · BSS reads use the selected line</span>`;
      // surface the Salam number(s) INSIDE the Identity card too — the first thing an agent reads
      const lc=document.getElementById('sbLineCount'); if(lc) lc.textContent=String(_lvLines.length);
      const sn=document.getElementById('sbSalamNums');
      if(sn) sn.innerHTML=_lvLines.map(l=>`<span class="mono" title="${esc(l.source)}" style="background:var(--tint-green,#dcfce7);color:var(--tint-green-fg,#166534);border-radius:6px;padding:1px 8px;font-weight:700;font-size:11.5px;white-space:nowrap">${esc(l.msisdn)}</span>`).join('')||'—';
      bar.querySelectorAll('[data-lvline]').forEach(b=>b.addEventListener('click',()=>{
        _lvLine=b.getAttribute('data-lvline');
        lvLoadLines(box);
        LIVE_PANELS.forEach(pn=>{ const bd=document.getElementById('lvb_'+pn.k);
          if(bd&&!pn.auto) bd.innerHTML='<span class="rl" style="color:var(--muted)">Line changed — ⚡ Load for a live read.</span>';
          const st=document.getElementById('lvs_'+pn.k); if(st&&!pn.auto) st.textContent=''; });
        LIVE_PANELS.filter(pn=>pn.auto).forEach(pn=>lvLoad(pn.k,false));
      }));
    }catch(e){ bar.innerHTML=`<div class="rl" style="color:#dc2626">${esc(e.message)}</div>`; }
  }
  const KSAd=v=>{ try{ const t=/^\d{10,}$/.test(String(v))?Number(v):Date.parse(String(v).replace(' ','T')); return new Date(t).toLocaleDateString('en-GB',{timeZone:'Asia/Riyadh',day:'2-digit',month:'short',year:'numeric'}); }catch(e){ return String(v); } };
  const lvMoney=v=>{ const n=Number(v); return Number.isFinite(n)?n.toLocaleString():esc(String(v)); };
  /* BSS → human. Field labels + value decoders so an agent never reads "paidType · 1". */
  const LV_LBL={'profile.identifier':'Subscriber ID','profile.subscriptionClass':'Subscription class',
    'profile.mobileNumber':'Mobile number','profile.created':'Customer since','profile.technologyType':'Technology',
    'profile.notificationPreference':'Notification preference','profile.spid':'Provider ID',
    'profile.cardPackageID':'SIM card (ICCID)','profile.paidType':'Billing type','profile.accountID':'BSS account no.',
    'profile.subscriptionType':'Subscription type','rating.primaryPricePlanID':'Price plan ID',
    'pricePlanDetails.identifier':'Plan ID','pricePlanDetails.name':'Plan name','pricePlanDetails.paidtype':'Billing type',
    'pricePlanDetails.subscriptionLevel':'Subscription level','pricePlanDetails.technology':'Technology',
    'pricePlanDetails.subscriptionType':'Plan code','pricePlanDetails.spid':'Provider ID','resultCode':'Result'};
  const LV_VAL=(key,v)=>{
    if(/paid.?type/i.test(key)) return String(v)==='1'?'Postpaid':String(v)==='0'?'Prepaid':v;
    if(/technolog/i.test(key)) return String(v)==='1001'?'GSM / mobile (1001)':v;
    if(/subscriptionType$/.test(key)&&String(v)==='0') return 'Individual (0)';
    if(/resultCode/i.test(key)) return String(v)==='0'?'OK (0)':v;
    return v; };
  /* execute-account-blnc-query answers with an ARRAY of {balanceType, amount} pairs (that is why
   * only resultCode showed as a scalar) — flatten it into a map first. */
  function lvBillMap(r){
    const m={};
    const arr=Array.isArray(r)?r:(Object.values(r||{}).find(v=>Array.isArray(v)&&v.length&&typeof v[0]==='object')||[]);
    for(const x of arr){ const bt=x.balanceType||x.type||x.name; const val=x.amount!=null?x.amount:(x.value!=null?x.value:x.balance);
      if(bt!=null&&val!=null) m[String(bt).toUpperCase()]=val; }
    for(const [kk,vv] of Object.entries(r||{})) if(typeof vv!=='object'&&vv!=null&&vv!=='') m[kk.toUpperCase()]=m[kk.toUpperCase()]??vv;
    return m; }
  function lvSummary(k,d){
    /* the UIL envelope is {uilTransactionId, responseCode, responseMessage, data:{...}} — the app
     * itself reads .data (optiva/client.rb send_request). Summaries read the PAYLOAD; the envelope
     * stays visible in ▸ trace. */
    const env=d.response||{};
    const r=(env&&typeof env==='object'&&env.data&&typeof env.data==='object')?env.data:env;
    const firstArray=o=>{ try{ for(const v of Object.values(o||{})) if(Array.isArray(v)&&v.length&&typeof v[0]==='object') return v; }catch(e){} return null; };
    try{
      if(k==='osb'){
        if(d.empty) return `<div class="rl" style="color:var(--muted)">${esc(d.note||'No OSB archive imported.')}</div>`;
        const acc={}; for(const a of (d.access||[])) (acc[a.ecid]=acc[a.ecid]||[]).push(a);
        const pipe=d.pipeline||[], qs=d.access_by_msisdn||[];
        const win=`${String((d.archive_window||{}).lo||'').slice(0,10)} → ${String((d.archive_window||{}).hi||'').slice(0,10)}`;
        if(!pipe.length&&!qs.length) return `<div class="rl" style="color:var(--muted)">No OSB records for this customer in the archive window (<b>${esc(win)}</b>). The BSS bus only logs payload records for flows that carry the MSISDN — routine balance reads correlate via the timeline instead.</div>`;
        const rows=pipe.slice(0,25).map(p=>{
          const hops=(p.ecid&&acc[p.ecid])||[];
          return `<tr><td class="rl mono" style="white-space:nowrap">${esc(KSA(p.ts))}</td>
            <td><b>${esc(String(p.pipeline||''))}</b>${p.stage?` <span class="rl" style="color:var(--muted);font-size:10px">${esc(p.stage)}</span>`:''}${p.direction?` <span class="rl" style="font-size:10px">${esc(p.direction)}</span>`:''}</td>
            <td>${p.fault?`<span style="background:#fee2e2;color:#b91c1c;border-radius:4px;padding:0 6px;font-weight:700;font-size:10px">✖ ${esc(p.fault_kind||'FAULT')}</span>`:'<span style="color:#16a34a;font-weight:700;font-size:10.5px">OK</span>'}</td>
            <td class="rl" style="font-size:10.5px">${hops.length?hops.map(h=>`${esc(h.uri.split('/').filter(Boolean).pop()||h.uri)} <b>${h.ms}ms</b>`).join(' · '):'—'}</td>
            <td>${p.payload?`<details><summary class="rl" style="cursor:pointer;font-size:10px;color:var(--muted)">payload</summary><pre style="font-size:10px;max-height:180px;overflow:auto;white-space:pre-wrap">${esc(p.payload)}</pre></details>`:'—'}</td></tr>`;}).join('');
        const qsRows=qs.slice(0,10).map(a=>`<tr><td class="rl mono" style="white-space:nowrap">${esc(KSA(a.ts))}</td>
          <td colspan="2" class="mono" style="font-size:10.5px">${esc(a.method)} ${esc(a.uri)}</td>
          <td class="rl">${a.ms}ms · HTTP ${esc(String(a.status))}</td><td>—</td></tr>`).join('');
        return `<div style="overflow-x:auto;max-height:340px;overflow-y:auto;border:1px solid var(--line,#e2e8f0);border-radius:8px"><table class="sb-tbl" style="min-width:760px;font-size:11.5px"><thead><tr>
          <th style="white-space:nowrap">When (KSA)</th><th>Pipeline / flow</th><th>Result</th><th>Backend hops (via ECID)</th><th>Detail</th></tr></thead>
          <tbody>${rows}${qsRows}</tbody></table></div>
          <div class="rl" style="color:var(--muted);margin-top:4px">archive window ${esc(win)} · msisdn + ECID correlation · day-1-lag live once the OSB SFTP feed is daily</div>`;
      }
      if(k==='vas'){
        const Y=v=>v===true||v==='t'||v==='true'||v===1||v==='1'||String(v).toLowerCase()==='yes';
        const chip=(v,lbl)=>v==null?'<span class="rl" style="color:var(--muted)">—</span>'
          :`<span style="background:${Y(v)?'#3b82f6':'#e2e8f0'};color:${Y(v)?'#fff':'#475569'};border-radius:4px;padding:0 6px;font-weight:700;font-size:10px">${Y(v)?'YES':'NO'}</span>`;
        if(!(d.rows||[]).length) return `<div class="rl" style="color:var(--muted)">No VAS/addon activity recorded for this customer.</div>`
          +((d.skipped||[]).length?`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:4px">${esc(d.skipped.join(' · '))}</div>`:'');
        return `<div style="overflow-x:auto;max-height:320px;overflow-y:auto;border:1px solid var(--line,#e2e8f0);border-radius:8px"><table class="sb-tbl" style="min-width:760px;font-size:11.5px"><thead><tr>
          <th style="white-space:nowrap">When (KSA)</th><th>Service</th><th>Group</th><th>Type</th><th>State</th><th>Req→Res</th><th>Platform</th><th>Plan</th></tr></thead><tbody>${
          d.rows.map(x=>{const act=/activ|add|enable|^1$/i.test(String(x.op||''))&&!/deactiv|remov|disable/i.test(String(x.op||''));
            const added=/added|active|success/i.test(String(x.state||''))&&!/remov/i.test(String(x.state||''));
            return `<tr><td class="rl mono" style="white-space:nowrap">${esc(KSA(x.at))}</td>
            <td><b>${esc(String(x.service))}</b> <span class="rl" style="color:var(--muted);font-size:10px">${esc(String(x.service_type||''))}</span></td>
            <td>${esc(String(x.group||'—'))}</td>
            <td>${x.op?`<span style="background:${act?'#16a34a':'#94a3b8'};color:#fff;border-radius:4px;padding:0 6px;font-weight:700;font-size:10px">${esc(String(x.op).toUpperCase())}</span>`:'—'}</td>
            <td style="font-weight:700;color:${added?'#16a34a':x.state?'#d97706':'inherit'}">${esc(String(x.state||'—'))}</td>
            <td style="white-space:nowrap">${chip(x.req_sent)}→${chip(x.res_received)}</td>
            <td>${esc(String(x.platform||'—'))}</td><td class="rl" style="font-size:10.5px">${esc(String(x.plan||'—'))}</td></tr>`;}).join('')}</tbody></table></div>`
          +`<div class="rl" style="color:var(--muted);margin-top:4px">same records as CMS → Service Logs${(d.skipped||[]).length?` · ${esc(d.skipped.join(' · '))}`:''}${(d.errors||[]).length?` · <span style="color:#dc2626">${esc(d.errors.join(' · '))}</span>`:''}</div>`;
      }
      if(d.rows) return `<div style="overflow-x:auto;max-height:300px;overflow-y:auto;border:1px solid var(--line,#e2e8f0);border-radius:8px"><table class="sb-tbl" style="min-width:640px;font-size:11.5px"><thead><tr>
        <th style="white-space:nowrap">When (KSA)</th><th>Type</th><th>Amount</th><th>Status</th><th>Rail</th><th>Method</th><th>Gateway ref</th><th>Fail reason</th></tr></thead><tbody>${
        d.rows.map(x=>{const TL={advanced_postpaid_payment:'Bill payment (advance)',OnboardingOrder:'New line order',Checkout:'Store checkout',Recharge:'Recharge',Invoice:'Invoice payment'};
        return `<tr ${x.pid?`data-pay="${esc(x.pid)}" style="cursor:pointer" title="Click for the full trace — app record, request/response to the gateway (Tap), ⇄ UPG correlation"`:''}><td class="rl mono" style="white-space:nowrap">${esc(KSA(x.created_at))}</td><td>${esc(TL[x.payment_on_type]||x.payment_on_type||'—')}</td>
        <td class="mono" style="text-align:end">${lvMoney(x.amount)}</td>
        <td style="font-weight:700;color:${x.status==='success'?'#16a34a':/fail/.test(x.status||'')?'#dc2626':x.status==='refunded'?'#7c3aed':'#d97706'}">${esc(x.status)}</td>
        <td>${esc(x.vendor||'—')}</td><td>${esc(x.payment_method||'—')}</td>
        <td class="mono" style="font-size:10.5px">${esc(x.payment_reference_id||'—')}</td>
        <td style="max-width:220px;font-size:11px;color:var(--muted)">${esc(x.fail_reason||'—')}</td></tr>`;}).join('')}</tbody></table></div>`
        +(d.note?`<div class="rl" style="margin-top:5px;color:var(--muted)">${esc(d.note)} Click any row for its full trace (app ⇄ gateway ⇄ Tap request/response).</div>`:'');
      if(d.state){ const st=d.state; let h='';
        const vtxt=v=>typeof v==='string'?v:(v&&(v.text||v.summary||v.verdict))||'';
        if(st.verdict&&vtxt(st.verdict)) h+=`<div><b>${esc(vtxt(st.verdict))}</b></div>`;
        (st.lines||[]).slice(0,3).forEach(l=>{
          const kv=Object.entries(l).filter(([a,b])=>b!=null&&b!==''&&typeof b!=='object')
            .map(([a,b])=>`${a.replace(/_/g,' ')}: ${b}`).join(' · ');
          h+=`<div class="rl" style="margin-top:4px;padding:5px 8px;background:var(--panel2,#f4f8f6);border-radius:7px">${esc(kv).slice(0,340)}</div>`; });
        (st.notes||[]).slice(0,2).forEach(n=>{ if(typeof n==='string') h+=`<div class="rl" style="margin-top:3px;color:var(--muted)">${esc(n)}</div>`; });
        return h||'<span class="rl">No app account found for this identifier.</span>'; }
      if(d.not_configured) return `<div class="okbox" style="border-left:3px solid var(--tint-amber-fg,#d97706)">${esc(d.note)}</div>`;
      if(d.error) return `<div class="rl" style="color:#dc2626">${esc(d.error)}</div>`;
      if(!d.ok){
        // KNOWN BSS ANSWERS, translated for the agent (the raw fault stays in ▸ trace)
        const raw=JSON.stringify(d.response||{});
        if(/createFault was passed NULL|faultCode/i.test(raw))
          return `<div class="okbox" style="border-left:3px solid var(--tint-amber-fg,#d97706)"><b>BSS read fault (OSB Error-1500 family).</b>
            The BSS could not serve this read. For a <b>pending / not-activated</b> line this is expected — the subscription
            does not exist in BSS yet; try an activated MSISDN. If it happens on an ACTIVE line, it is the INC0016809
            read-fault pattern — check Troubleshoot → Activation for a surge.</div>`;
        if(/subscriber not found|no subscription|not exist/i.test(raw))
          return `<div class="okbox" style="border-left:3px solid var(--tint-amber-fg,#d97706)"><b>BSS does not know this number</b> — the line is not (yet) provisioned. Normal for pending orders.</div>`;
        return `<div class="rl" style="color:#dc2626">BSS answered HTTP ${esc(d.http)} — open ▸ trace for the exact response.</div>`;
      }
      if(k==='balance'){
        const amt=[r.amount,r.balance,r.availableBalance,r.currentBalance,r.creditBalance].find(v=>v!=null&&v!=='');
        if(amt!=null) return `<span style="font-size:19px;font-weight:800">${lvMoney(Number(amt)/100)} <small>${esc(r.currency||'SAR')}</small></span>`
          +`<div class="rl" style="color:var(--muted)">raw ${lvMoney(amt)} halalas ÷ 100 (Money.from_cents)</div>`
          +`<div class="okbox" style="margin-top:6px;border-left:3px solid var(--tint-amber-fg,#d97706);font-size:11.5px">For a <b>POSTPAID</b> line the customer's app shows the <b>DUE AMOUNT</b> (see the 📱 card / Account balance), not this BSS subscription counter — a caller quoting "93.85" means the due, and both being different is normal.</div>`
          +(r.blockedBalance&&r.blockedBalance!=='0'?` <span class="rl" style="color:#d97706">· blocked ${lvMoney(r.blockedBalance)}</span>`:'')
          +(r.expirationDate?`<div class="rl">expires ${esc(KSA(Number(r.expirationDate)||r.expirationDate))}</div>`:'');
        // no known amount field — fall through to the generic field list (never "undefined SAR")
      }
      if(k==='bundles'){ const bs=r.bundles||(Array.isArray(r)?r:null)||firstArray(r);
        if(Array.isArray(bs)){ const act=bs.filter(b=>String(b.status)==='0');
          const U={'0':[v=>v/60,'MIN'],'1':[v=>v/1e9,'GB'],'7':[v=>v/1e6,'GB'],'2':[v=>v,'SMS']};
          return act.slice(0,8).map(b=>{ const x=(b.balances&&b.balances[0])||b; const u=U[String(b.unitType)]||[v=>v,''];
            const lim=Number(x.personalLimit||0)+Number(x.rolloverLimit||0), rem=Number(x.personalBalance||0)+Number(x.rolloverBalance||0);
            const un=UNLIM_CATS.has(String(x.bundleCategoryId||''));
            return `<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--line,#eef2f0);padding:3px 0;font-size:12px">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">▦ ${esc(b.bundleName||b.bundleID||'')}</span>
              <b style="white-space:nowrap">${un?'Unlimited':`${u[0](rem).toFixed(u[1]==='GB'?2:0)} / ${u[0](lim).toFixed(0)} ${u[1]}`}</b></div>`; }).join('')
            ||'<span class="rl">No active bundles.</span>'; } }
      if(k==='bill'){
        const bm=lvBillMap(r);
        const lia=bm['LAST_INVOICE_AMOUNT'], psli=bm['PAYMENTS_SINCE_LAST_INVOICE'];
        const dueMs=bm['LAST_INVOICE_DUE_DATE'];
        const g=(...names)=>{ for(const n of names){ if(bm[n.toUpperCase()]!=null) return bm[n.toUpperCase()]; } return null; };
        if(lia!=null){
          // Optiva::Responses::Bill#total — halalas, due = max(0, last_invoice + payments_since)/100
          const total=Math.max(0,(Number(lia)+Number(psli||0))/100);
          return `<div class="rl" style="font-weight:700;color:var(--muted)">DUE AMOUNT</div>
            <span style="font-size:19px;font-weight:800;color:${total>0?'#b45309':'#16a34a'}">${lvMoney(total.toFixed(2))} <small>SAR</small></span>
            ${dueMs?`<div class="rl">to be paid before <b>${esc(KSAd(dueMs))}</b></div>`:''}
            <div class="rl" style="margin-top:5px;color:var(--muted)">last invoice ${lvMoney(Number(lia)/100)} · payments since ${lvMoney(Number(psli||0)/100)} · adj ${lvMoney(Number(g('adjustments_since_last_invoice','ADJUSTMENTS_SINCE_LAST_INVOICE')||0)/100)}</div>`;
        }
        const kv=Object.entries(r).filter(([a,b])=>typeof b!=='object');
        return kv.slice(0,7).map(([a,b])=>`<div><span class="rl">${esc(a)}</span> · <b>${esc(String(b))}</b></div>`).join(''); }
      if(k==='addons'){
        // list-subscriptions answers every subscription under the ACCOUNT: the main line plus any
        // addon products. Field names vary by BSS version — read the common candidates, fall back
        // honestly (open { } trace shows the raw payload for unknown shapes).
        const subs=r.subscriptions||r.subscriptionList||r.subscriptionsList||(Array.isArray(r)?r:null)||firstArray(r);
        if(!Array.isArray(subs)||!subs.length) return `<div class="rl" style="color:var(--muted)">No subscriptions returned for this account.</div>`;
        const nameOf=x=>[x.offerName,x.productName,x.subscriptionName,x.pricePlanName,x.planName,x.name,x.offerID&&('offer '+x.offerID),x.productID&&('product '+x.productID)].find(v=>v!=null&&v!=='')||'—';
        const idOf=x=>[x.subscriptionId,x.subscriptionID,x.subscriberId,x.identifier,x.mobileNumber].find(v=>v!=null&&v!=='')||'';
        const stOf=x=>{const s=[x.status,x.state,x.subscriptionStatus].find(v=>v!=null&&v!=='');return s==null?null:String(s);};
        const main=subs.length===1;
        return `<b>${subs.length} subscription(s) on the account</b>${main?' <span class="rl" style="color:var(--muted)">(main line only — no addons)</span>':''}`
          +subs.slice(0,15).map(x=>{
            const st=stOf(x), active=st!=null&&/^(0|1)$|active|enable/i.test(st)&&!/inactive|disable|suspend|cancel/i.test(st);
            const dt=[x.activationDate,x.startDate,x.created,x.createdDate].find(v=>v!=null&&v!=='');
            return `<div class="rl" style="display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--line,#eef2f0);padding:4px 0">
              <span style="flex:1">➕ <b>${esc(String(nameOf(x)))}</b>${idOf(x)?` <span class="mono" style="font-size:10px;color:var(--muted)">${esc(String(idOf(x)))}</span>`:''}</span>
              ${st!=null?`<span style="background:${active?'var(--tint-green,#dcfce7)':'#fee2e2'};color:${active?'#166534':'#b91c1c'};border-radius:5px;padding:0 6px;font-weight:700;font-size:10.5px">${esc(active?'ACTIVE':st)}</span>`:''}
              ${dt?`<span class="rl mono" style="font-size:10px;color:var(--muted)">${esc(KSAd(String(dt)))}</span>`:''}</div>`;}).join('')
          +`<div class="rl" style="color:var(--muted);margin-top:3px">every subscription under the BSS account — addons appear alongside the main line; unknown fields: open { }</div>`;
      }
      if(k==='invoices'){ const inv=r.invoices||r.invoiceList||(Array.isArray(r)?r:null)||firstArray(r);
        if(Array.isArray(inv)) return `<b>${inv.length} invoice(s)</b>`+inv.slice(0,12).map(x=>{
          const amt=[x.amount,x.invoiceAmount,x.totalAmount].find(v=>v!=null&&v!=='');
          const dt=x.invoiceDate||x.billingDate||x.date||'';
          // paid detection: any status/outstanding-shaped field BSS provides (open { } if blank)
          const stRaw=[x.status,x.invoiceStatus,x.paid,x.paymentStatus].find(v=>v!=null&&v!=='');
          const outst=[x.outstandingAmount,x.balance,x.dueAmount,x.remainingAmount].find(v=>v!=null&&v!=='');
          let paid=null;
          if(outst!=null) paid=Number(outst)<=0;
          else if(stRaw!=null) paid=/paid|closed|settled|^1$|true/i.test(String(stRaw))&&!/un|not/i.test(String(stRaw));
          const badge=paid===true?'<span style="background:var(--tint-green,#dcfce7);color:#166534;border-radius:5px;padding:0 6px;font-weight:700;font-size:10.5px">PAID</span>'
            :paid===false?'<span style="background:#fee2e2;color:#b91c1c;border-radius:5px;padding:0 6px;font-weight:700;font-size:10.5px">NOT PAID</span>'
            :'<span class="rl" style="color:var(--muted);font-size:10px" title="BSS answer carries no paid flag — open { } and send me the field name">—</span>';
          return `<div class="rl" style="display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--line,#eef2f0);padding:4px 0">
            <span style="flex:1">≣ ${esc(KSAd(dt))}</span>${badge}
            <b style="min-width:86px;text-align:end">${amt!=null?lvMoney((Number(amt)/100).toFixed(2))+' SAR':'—'}</b>
            <button class="pill" data-invpdf="${esc(String(dt))}" data-invacct="${esc(String(x.accountID||x.accountId||x.account_id||''))}" style="padding:0 8px;font-size:10.5px;border-left-color:#3b82f6" title="Open the invoice PDF (fetched live from BSS, audited · can take up to ~90s)">PDF</button></div>`; }).join('')
          +`<div class="rl" style="color:var(--muted);margin-top:3px">amounts ÷100 (halalas), like the app's Statements tab</div>`; }
      // generic honest fallback: scalar fields of the PAYLOAD (one nested level too); the
      // envelope (uilTransactionId / responseCode / responseMessage) lives in ▸ trace, not here
      const SKIP=new Set(['uilTransactionId','responseCode','responseMessage','transactionId']);
      const kv=[];
      for(const [a,b] of Object.entries(r)){
        if(SKIP.has(a)||b==null||b==='') continue;
        if(typeof b!=='object'){ kv.push([a,b]); continue; }
        if(!Array.isArray(b)) for(const [a2,b2] of Object.entries(b)){
          if(b2!=null&&b2!==''&&typeof b2!=='object') kv.push([a+'.'+a2,b2]); }
      }
      if(kv.length) return kv.slice(0,12).map(([a,b])=>`<div><span class="rl">${esc(LV_LBL[a]||a.replace(/_/g,' '))}</span> · <b>${esc(String(LV_VAL(a,b)).slice(0,80))}</b></div>`).join('');
      const arr=firstArray(r);
      if(arr) return arr.slice(0,6).map(x=>`<div class="rl" style="padding:3px 0;border-bottom:1px solid var(--line,#eef2f0)">${esc(Object.entries(x).filter(([a,b])=>b!=null&&typeof b!=='object').slice(0,5).map(([a,b])=>a+': '+b).join(' · ')).slice(0,220)}</div>`).join('');
      return `<span class="rl">responseCode ${esc(env.responseCode||'—')} · ${esc(env.responseMessage||'')} — open ▸ trace for the full payload.</span>`;
    }catch(e){ return `<span class="rl">Rendered raw — open ▸ trace.</span>`; }
  }
  function lvStamp(k,d){
    const el=document.getElementById('lvs_'+k); if(!el) return;
    if(d.not_configured){ el.textContent='not configured'; return; }
    const src=d.contact_only?` · <b style="color:#d97706">⚠ contact number used</b>`:(d.line_source?` · via ${esc(d.line_source)}`:'');
    if(d.error||d.ok===false){ el.innerHTML='<b style="color:#dc2626">failed</b>'+(d.ms!=null?' · '+d.ms+'ms':'')+src; return; }
    const t=d.taken_at?KSA(d.taken_at):''; el.innerHTML=`${d.cached?'cached':'<b style="color:#16a34a">LIVE</b>'} · ${esc(t)}${d.ms!=null?' · '+d.ms+'ms':''}${src}`;
  }
  function lvTrace(k,d){
    const el=document.getElementById('lvt_'+k); if(!el) return;
    el.innerHTML=`<div class="rl" style="word-break:break-all"><b>${esc(d.endpoint||'—')}</b></div>
      ${d.request?`<div class="sb-x-h"><span>Request</span></div><pre style="max-height:150px;overflow:auto">${esc(JSON.stringify(d.request,null,1))}</pre>`:''}
      <div class="sb-x-h"><span>Response</span></div><pre style="max-height:220px;overflow:auto">${esc(JSON.stringify(d.response||d.state||d.rows||{},null,1))}</pre>`;
  }
  function lvHistory(k,d){
    const el=document.getElementById('lvh_'+k); if(!el) return;
    const h=d.history||[];
    if(!h.length){ el.innerHTML=''; return; }
    el.innerHTML=`<select data-lvhs="${k}" style="font-size:11px;max-width:100%"><option value="">history · ${h.length} snapshot(s)</option>
      ${h.map(x=>`<option value="${x.id}">${esc(KSA(x.taken_at))} · ${x.ok?'ok':'ERR'} · ${x.ms||'—'}ms</option>`).join('')}</select>`;
    el.querySelector('select').addEventListener('change',async ev=>{
      const id=ev.target.value; if(!id) return;
      try{ const snap=await api(`/api/subscriber/live/snapshot?key=${encodeURIComponent(curKey)}&id=${id}${unmasked?'&unmask=1':''}`);
        document.getElementById('lvb_'+k).innerHTML=`<div class="rl" style="color:#d97706;margin-bottom:4px">SNAPSHOT · ${esc(KSA(snap.taken_at))} (not live)</div>`+lvSummary(k,snap);
        lvTrace(k,snap); document.getElementById('lvt_'+k).hidden=false;
      }catch(e){ document.getElementById('lvb_'+k).innerHTML=`<div class="rl" style="color:#dc2626">${esc(e.message)}</div>`; }
    });
  }
  /* "AS IN THE CUSTOMER'S APP" — composes profile + bundles + bill into the exact home-screen
   * view the caller is looking at: plan/Active, Data·Minutes·SMS usage bars (BundleManagment
   * unit types: 0=seconds→min, 1=bytes→GB, 2=SMS; active=status "0"; used = limit − balance;
   * unlimited category ids from the app), DUE AMOUNT via Bill#total. Same math, same sources. */
  const UNLIM_CATS=new Set(['3000','4000','7000','8000','9000','10000','11000','12000','2600']);
  function lvAppView(pf,bd,bl,pl){
    const un=env=>{ const e=(env&&env.response)||{}; return (e.data&&typeof e.data==='object')?e.data:e; };
    const p=un(pf), list=(()=>{ const r=un(bd); if(Array.isArray(r)) return r;
      for(const v of Object.values(r||{})) if(Array.isArray(v)&&v.length&&typeof v[0]==='object') return v; return []; })();
    const act=list.filter(b=>String(b.status)==='0');
    const TYPES={'1':{grp:1,unit:'GB',cv:v=>v/1e9,dp:2},'7':{grp:1,unit:'GB',cv:v=>v/1e6,dp:2},
                 '0':{grp:2,unit:'MINs',cv:v=>v/60,dp:0},'2':{grp:3,unit:'SMS',cv:v=>v,dp:0}};
    const rows=[];
    for(const b of act){
      const T=TYPES[String(b.unitType)]; if(!T) continue;
      const x=(b.balances&&b.balances[0])||b;
      const name=b.bundleName||b.name||x.name||('bundle '+(b.bundleID||b.bundleId||''));
      const unlim=UNLIM_CATS.has(String(x.bundleCategoryId||''));
      const lim=Number(x.personalLimit||0)+Number(x.rolloverLimit||0);
      const rem=Number(x.personalBalance||0)+Number(x.rolloverBalance||0);
      const usedPct=lim?Math.max(0,Math.min(100,100*(lim-rem)/lim)):0;
      rows.push({grp:T.grp,html:`<div style="margin-top:8px"><div style="display:flex;justify-content:space-between;font-size:12px;gap:8px">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
        <span style="white-space:nowrap">${unlim?'<b style=\"color:#16a34a\">Unlimited</b>':`<b>${(T.cv(rem)).toFixed(T.dp).replace(/\.00$/,'')}</b> | ${(T.cv(lim)).toFixed(0)} ${T.unit}`}</span></div>
        <div style="height:7px;background:var(--line,#e2e8f0);border-radius:4px;margin-top:3px"><div style="height:7px;border-radius:4px;background:#0e9f5a;width:${unlim?100:usedPct.toFixed(0)}%"></div></div></div>`});
    }
    rows.sort((a,z)=>a.grp-z.grp);
    const bars=rows.map(r=>r.html);
    // expiryTime is a "YYYY-MM-DD HH:MM:SS" string; epoch-1970 stamps mean "no expiry"
    const exp=act.map(b=>{ const v=b.expiryTime||((b.balances&&b.balances[0])||{}).expiryTime; if(!v) return 0;
      const tms=/^\d+$/.test(String(v))?Number(v):Date.parse(String(v).replace(' ','T')); return tms||0; })
      .filter(x=>x>Date.now());
    const days=exp.length?Math.round((Math.min(...exp)-Date.now())/864e5):null;
    const bm=lvBillMap(un(bl));
    const lia=bm['LAST_INVOICE_AMOUNT'];
    const due=lia!=null?Math.max(0,(Number(lia)+Number(bm['PAYMENTS_SINCE_LAST_INVOICE']||0))/100):null;
    const dueMs=bm['LAST_INVOICE_DUE_DATE'];
    const rPlan=un(arguments.length>3?arguments[3]:null)||{};
    const planName=(rPlan.pricePlanDetails&&rPlan.pricePlanDetails.name)||rPlan.name||null;
    const planTxt=planName||(_lvLines.find(l=>l.ref===_lvLine)||{}).plan||(p.rating&&p.rating.primaryPricePlanID?'BSS plan '+p.rating.primaryPricePlanID:'—');
    return `<div style="display:flex;justify-content:space-between;align-items:baseline">
        <div><div class="rl" style="color:var(--muted)">Active Plan</div><b style="font-size:15px">${esc(planTxt)}</b></div>
        <div style="text-align:end"><b style="color:${pf.ok?'#16a34a':'#d97706'}">${pf.ok?'Active':'check profile'}</b>
        ${days!=null?`<div class="rl" style="color:var(--muted)">expires in ${days} day${days===1?'':'s'}</div>`:''}</div></div>
      ${bars.join('')||'<div class="rl" style="margin-top:6px;color:var(--muted)">No active bundles returned.</div>'}
      ${due!=null?`<div style="margin-top:10px;padding:8px 10px;background:var(--panel2,#f4f8f6);border-radius:8px;display:flex;justify-content:space-between;align-items:baseline">
        <span class="rl" style="font-weight:700;color:var(--muted)">DUE AMOUNT</span>
        <span><b style="font-size:16px;color:${due>0?'#b45309':'#16a34a'}">${lvMoney(due.toFixed(2))} SAR</b>${dueMs?`<span class="rl" style="color:var(--muted)"> · before ${esc(KSAd(dueMs))}</span>`:''}</span></div>`
      :(bl&&bl.error?`<div class="rl" style="margin-top:8px;color:var(--muted)">due amount: ${esc(bl.error)}</div>`:'')}`;
  }
  async function lvLoad(k,refresh){
    const body=document.getElementById('lvb_'+k); if(body) body.innerHTML='<span class="rl">Loading…</span>';
    const one=n=>api(`/api/subscriber/live?key=${encodeURIComponent(curKey)}&panel=${n}${_lvLine?`&line=${encodeURIComponent(_lvLine)}`:''}${refresh?'&refresh=1':''}${unmasked?'&unmask=1':''}`);
    if(k==='appview'){
      try{
        const [pf,bd,bl,pl]=await Promise.all([one('profile'),one('bundles'),one('bill'),one('plan')]);
        if(body) body.innerHTML=lvAppView(pf,bd,bl,pl);
        const el=document.getElementById('lvs_'+k);
        if(el) el.innerHTML=`${(pf.cached&&bd.cached)?'cached':'<b style="color:#16a34a">LIVE</b>'} · ${esc(KSA(new Date().toISOString()))} · profile+bundles+bill${pf.line_source?' · via '+esc(pf.line_source):''}`;
        const tr=document.getElementById('lvt_'+k);
        if(tr) tr.innerHTML=`<div class="sb-x-h"><span>Raw answers (4 calls)</span></div><pre style="max-height:240px;overflow:auto">${esc(JSON.stringify({profile:pf.response,bundles:bd.response,bill:bl.response||bl.error,plan:pl.response||pl.error},null,1))}</pre>`;
      }catch(e){ if(body) body.innerHTML=`<div class="rl" style="color:#dc2626">${esc(e.message)}</div>`; }
      return;
    }
    try{
      let d=await one(k);
      if(k==='balance'&&d.ok===false&&/createFault|faultCode/i.test(JSON.stringify(d.response||{}))&&!refresh){
        // Error-1500 is intermittent on the BSS side (INC0016809) — one automatic live retry
        const d2=await api(`/api/subscriber/live?key=${encodeURIComponent(curKey)}&panel=${k}${_lvLine?`&line=${encodeURIComponent(_lvLine)}`:''}&refresh=1${unmasked?'&unmask=1':''}`);
        if(d2&&d2.ok!==false) d=d2; else d.retried=true;
      }
      if(body) body.innerHTML=lvSummary(k,d)+(d.retried?'<div class="rl" style="color:var(--muted);font-size:10.5px">retried once — BSS counter still faulting (intermittent, INC0016809 family)</div>':'');
      lvStamp(k,d); lvTrace(k,d); lvHistory(k,d);
    }catch(e){ if(body) body.innerHTML=`<div class="rl" style="color:#dc2626">${esc(e.message)}</div>`; }
  }
  async function lvOpenPdf(date,btn){
    const old=btn.textContent; btn.textContent='⏳';
    const acct=btn.getAttribute('data-invacct')||'';
    try{
      const r=await window.fetch(`${API}/api/subscriber/live/invoice-pdf?key=${encodeURIComponent(curKey)}${_lvLine?`&line=${encodeURIComponent(_lvLine)}`:''}&date=${encodeURIComponent(date)}${acct?`&acct=${encodeURIComponent(acct)}`:''}`);
      if(!r.ok){ const e=await r.json().catch(()=>({})); throw new Error(e.error||('HTTP '+r.status)); }
      const blob=await r.blob();
      window.open(URL.createObjectURL(blob),'_blank');
    }catch(e){ alert('Invoice PDF: '+e.message); }
    btn.textContent=old;
  }
  function wireLive(box){
    _lvLine=null; _lvLines=[];
    lvLoadLines(box);
    box.querySelectorAll('[data-lvgo]').forEach(b=>b.addEventListener('click',()=>lvLoad(b.dataset.lvgo,true)));
    box.addEventListener('click',e=>{ const b=e.target.closest('[data-invpdf]'); if(b&&b.textContent!=='⏳'){ lvOpenPdf(b.getAttribute('data-invpdf'),b); return; }
      const pr=e.target.closest('tr[data-pay]');
      if(pr&&window.opsOpenTimeline) window.opsOpenTimeline(null,'pay:'+pr.getAttribute('data-pay'),null); });
    box.querySelectorAll('[data-lvtr]').forEach(b=>b.addEventListener('click',()=>{ const t=document.getElementById('lvt_'+b.dataset.lvtr); if(t) t.hidden=!t.hidden; }));
    LIVE_PANELS.filter(pn=>pn.auto).forEach(pn=>lvLoad(pn.k,false));
    // health chip: is the live gateway configured/reachable? (cheap, cached server-side by TTL)
    api('/api/subscriber/live/health').then(h=>{ const el=box.querySelector('#lvHealth'); if(!el) return;
      el.innerHTML=h.configured?(h.reachable?`<span style="color:#16a34a">● live gateway OK · ${h.ms}ms</span>`:`<span style="color:#dc2626">● gateway unreachable: ${esc(h.error||('HTTP '+h.http))}</span>`)
        :`<span style="color:#d97706">● live BSS not configured (LIVE_UIL_KEY)</span>`; }).catch(()=>{});
  }
  function timelineCard(events){
    if(!events||!events.length) return `<div class="sb-block"><h3>Journey timeline</h3><div class="okbox">No journey events for the most recent order — click any line below for its own journey.</div></div>`;
    return `<div class="sb-block"><h3>Journey timeline <span class="rl">(${events.length} events · most recent order · click a row for full trace)</span></h3><div class="sb-tl">${evRows(events,'sb')}</div></div>`;
  }

  // one-time styles for the trace drawer (kept here so the feature is a single-file change)
  (function(){ if(document.getElementById('sb360x-css')) return;
    const st=document.createElement('style'); st.id='sb360x-css'; st.textContent=`
      .sb-click{cursor:pointer}
      .sb-click:hover{background:rgba(0,138,71,.04)}
      .sb-chev{float:right;color:#94a3b8;transition:transform .15s;margin-left:8px}
      .sb-open .sb-chev{transform:rotate(90deg)}
      .sb-ev-x{border:1px solid var(--line,#e2e8f0);background:var(--panel,#f8fafc);border-radius:8px;padding:10px 14px;margin:2px 0 10px 26px}
      .sb-x-grid{display:flex;flex-wrap:wrap;gap:4px 20px;font-size:12px;margin-bottom:4px}
      .sb-x-kv b{color:#64748b;font-weight:600;margin-right:5px}
      .sb-x-h{display:flex;align-items:center;justify-content:space-between;margin-top:8px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
      .sb-ev-x pre{background:#0f172a;color:#e2e8f0;padding:10px 12px;border-radius:6px;overflow:auto;max-height:300px;font-size:11px;line-height:1.45;margin:6px 0 2px;white-space:pre-wrap;word-break:break-word}
      .sb-copy{font-size:10px;padding:2px 10px}
      .sb-ev-src{overflow:hidden}
      .sb-ev-src small{display:block;color:#94a3b8;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      tr.sb-line{cursor:pointer}
      tr.sb-line:hover td{background:rgba(0,138,71,.05)}
      tr.sb-line .sb-chev{float:none;margin-left:10px}
      tr.sb-line-x>td{background:var(--panel,#f8fafc);border-left:3px solid var(--green,#008a47);padding:8px 12px}
      .sb-line-tl .sb-ev-x{margin-left:0}
      /* --- 4 Sep 2026 call-center redesign: sticky customer header + tabs --- */
      .sbt-head{position:sticky;top:55px;z-index:35;background:var(--card,#fff);border:1px solid var(--line,#e2e8f0);border-radius:14px;padding:10px 16px 8px;margin:10px 0 12px;box-shadow:0 6px 18px rgba(15,23,42,.07)}
      .sbt-head-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .sbt-avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--green,#0e9f5a),#065f46);color:#fff;display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0;box-shadow:0 2px 6px rgba(6,95,70,.35)}
      .sbt-who{min-width:0;flex:1}
      .sbt-nums{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-weight:700;min-height:18px}
      .sbt-sub{margin-top:3px;font-size:11.5px}
      .sbt-health{white-space:nowrap}
      .sbt-linebar{margin-top:6px}
      .sbt-linebar:empty{display:none}
      .sbt-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px;border-top:1px solid var(--line,#eef2f0);padding-top:8px}
      .sbt-tab{border:1px solid var(--line,#e2e8f0);background:var(--panel,#fff);border-radius:999px;padding:5px 15px;font-size:12px;font-weight:700;cursor:pointer;color:var(--muted,#64748b);transition:all .12s}
      .sbt-tab:hover{border-color:var(--green,#0e9f5a);color:var(--ink,#0f172a)}
      .sbt-tab.on{background:var(--green,#0e9f5a);border-color:var(--green,#0e9f5a);color:#fff;box-shadow:0 2px 8px rgba(14,159,90,.35)}
      .sbt-n{background:var(--panel2,#eef2f0);color:var(--muted,#64748b);border-radius:8px;padding:0 6px;font-size:10px;font-weight:800}
      .sbt-tab.on .sbt-n{background:rgba(255,255,255,.28);color:#fff}
      .sbt-pane[hidden]{display:none}
      .sbt-pane{animation:sbtIn .16s ease}
      @keyframes sbtIn{from{opacity:.4;transform:translateY(3px)}to{opacity:1;transform:none}}`;
    document.head.appendChild(st);
  })();

  function wireTimeline(box){
    box.querySelectorAll('.sb-click').forEach(r=>{
      const toggle=()=>{ const x=document.getElementById(r.dataset.x); if(!x) return; x.hidden=!x.hidden; r.classList.toggle('sb-open',!x.hidden); };
      r.addEventListener('click',ev=>{ if(ev.target.closest('button')) return; toggle(); });
      r.addEventListener('keydown',ev=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); toggle(); } });
    });
    box.querySelectorAll('.sb-copy').forEach(b=>b.addEventListener('click',ev=>{
      ev.stopPropagation();
      const pre=document.getElementById(b.dataset.copy);
      if(pre&&navigator.clipboard) navigator.clipboard.writeText(pre.textContent).then(()=>{ const t=b.textContent; b.textContent='Copied ✓'; setTimeout(()=>{ b.textContent=t; },1200); });
    }));
  }

  // public entry (nav click, deep link, or "open profile" from Troubleshoot)

  /* ---- FIXED SIDE (Customer 360, 5 Sep 2026) — data from /api/fixed/customer ---- */
  const fxOut={COMPLETED:"var(--green,#0e9f5a)",STALLED:"#d97706",CANCELLED:"#dc2626",EXPIRED:"#64748b",IN_PROGRESS:"#2563eb"};
  const fts=v=>{ if(!v) return "—"; const d=new Date(v); if(isNaN(d)) return esc(v); return new Date(d.getTime()+3*3600e3).toISOString().replace("T"," ").slice(0,16); };
  const ftbl=(head,rows,empty)=>`<table class="mono" style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr>${head.map(h=>`<th style="text-align:left;padding:4px 6px;color:var(--muted);font-weight:700;font-size:10px;letter-spacing:.6px;border-bottom:1px solid var(--line)">${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td style="padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top">${c}</td>`).join("")}</tr>`).join("")||`<tr><td colspan="${head.length}" style="padding:10px;color:var(--muted)">${empty||"nothing"}</td></tr>`}</tbody></table>`;
  function fixedHead(f){
    const c=f.customer||{}; const unmaskBtn=canUnmask()?`<button class="pill" id="sbUnmask" style="border-left-color:var(--purple)">${unmasked?'Mask PII':'Unmask PII'}</button>`:'';
    return `<div class="sbt-head"><div class="sbt-head-row"><div class="sbt-avatar">🏠</div><div class="sbt-who">
        <div class="sbt-nums">Fixed customer · ${esc(c.cust_code||c.customer_id||curKey)}</div>
        <div class="rl sbt-sub">${f.inventory_summary?`<b>${f.inventory_summary.active} active fixed service(s)</b> in BSS · `:""}${c.attempts||0} journey attempt(s) · ${c.orders||0} order(s)${(c.channels||[]).length?" · "+(c.channels||[]).map(esc).join(" / "):""}${c.first_seen?` · first seen ${fts(c.first_seen)} · last ${fts(c.last_seen)}`:""}
          <span style="color:var(--muted)">· no mobile-side record for this key</span></div></div>${unmaskBtn}</div>
      <div class="sbt-tabs"><button class="sbt-tab on" data-sbt="fixed">🏠 Fixed services</button></div></div>`;
  }
  function fixedPane(f){
    const c=f.customer||{};
    const svc=(f.services||[]).map(s=>[`<b>${esc(s.service_no||"(no service no yet)")}</b>${s.order_number?`<div class="rl" style="color:var(--muted);font-size:10px">order ${esc(s.order_number)}</div>`:""}`,
      `${esc(s.label)}<div class="rl" style="color:var(--muted);font-size:10px">${esc(s.plan||"")}</div>`, esc(s.channel||""),
      `<b style="color:${fxOut[s.outcome]||"inherit"}">${esc(s.outcome)}</b><div class="rl" style="color:var(--muted);font-size:10px">${esc(s.step_reached||"")}</div>`,
      `${esc(s.odb||"—")}`, esc(s.region||"—"), s.dealer?`${esc(s.dealer)}<div class="rl" style="color:var(--muted);font-size:10px">${esc(s.staff||"")}</div>`:(s.referral_code?`QR ${esc(s.referral_code)}`:"—"), fts(s.started_at), s.completed_at?fts(s.completed_at):"—"]);
    const att=(f.attempts||[]).map(a=>[`<a href="#" class="sb-fxtrace" data-id="${esc(a.id)}" style="color:var(--green,#0e9f5a)">${fts(a.started_at)}</a>`, esc((window.FIXED_WF&&window.FIXED_WF[a.workflow])||a.workflow), esc(a.channel),
      `<b style="color:${fxOut[a.outcome]||"inherit"}">${esc(a.outcome)}</b>`, esc(a.step_reached||"—"), a.last_error_category?`<span class="pill" style="font-size:10px">${esc(a.last_error_category)}</span>`:"", esc(a.order_number||"—"), esc(a.service_no||"—"), esc(a.nafath_outcome||"—"), a.duration_s?Math.round(a.duration_s/60)+"m":"—"]);
    const errs=(f.errors||[]).map(e=>[fts(e.occurred_at),`<span class="pill" style="font-size:10px">${esc(e.category)}</span>`,esc(e.code||""),esc(e.message||"").slice(0,160),esc(e.step||""),e.resolved?"✓":"<span style='color:#dc2626'>open</span>"]);
    const pay=f.payments||{}; const payRows=(pay.rows||[]).map(p=>[fts(p.created_at),`<b style="color:${/PAID|CAPTURED/.test(p.status)?"var(--green,#0e9f5a)":"#dc2626"}">${esc(p.status)}</b>`,(p.amount_sar||0).toFixed(2)+" SAR",esc(p.method||p.source||""),esc(p.ftth_number||p.customer_id||""),esc(p.order_number||p.reference_id||"—"),esc(p.transaction_id||""),esc(p.bank_message||"").slice(0,80)]);
    const links=f.links||{}; const ms=(links.msisdn_full||[]);
    const xlink=ms.length?`<div style="margin-top:8px;font-size:12px">5G number(s) on this customer: ${ms.map(m=>`<button class="pill sb-xmob" data-m="${esc(m)}" style="font-size:11px;border-left-color:#2563eb">${esc(m)} → look up mobile side</button>`).join(" ")}</div>`
      :((links.msisdn||[]).length?`<div class="rl" style="margin-top:8px;font-size:11px;color:var(--muted)">5G number(s): ${links.msisdn.map(esc).join(", ")} — unmask to cross-search the mobile side</div>`:"");
    // INVENTORY — what the customer HAS in the fixed BSS (ZSmart), live or as last recorded by the app's own journeys
    const inv=f.inventory||{}; const invSt={active:"var(--green,#0e9f5a)",suspended:"#d97706",frozen:"#d97706",terminated:"#dc2626",deactivated:"#dc2626"};
    const invRows=(inv.subscriptions||[]).map(x=>[`<b>${esc(x.account||"—")}</b><div class="rl" style="color:var(--muted);font-size:10px">acct ${esc(x.acct_nbr||"—")}</div>`,
      `${esc(x.plan||x.offer||"—")}<div class="rl" style="color:var(--muted);font-size:10px">${esc(x.offer&&x.plan?x.offer:"")}${x.plan_id?" · plan "+esc(String(x.plan_id)):""}</div>`,
      x.speed_mbps?x.speed_mbps+" Mbps":"—", `<b style="color:${invSt[x.state_label]||"inherit"}">${esc(x.state_label||x.state||"—")}</b>${x.suspension_reason?`<div class="rl" style="font-size:10px;color:#d97706">${esc(x.suspension_reason)}</div>`:""}`,
      esc(x.provider||"—"), x.eff_date?esc(x.eff_date):"—", x.exp_date?esc(x.exp_date):"—", x.paid?"✓ paid":"unpaid",
      inv.owed&&inv.owed[x.account]?`<b style="color:${inv.owed[x.account].amount_sar>0?"#dc2626":"inherit"}">${inv.owed[x.account].amount_sar.toFixed(2)} SAR</b>`:"—"]);
    const invOrders=(inv.open_orders||[]).map(o=>[esc(o.created||""),esc(o.event||""),`<b>${esc(o.state_label||o.state||"")}</b>`,esc(o.channel||""),esc(o.payment||""),o.amount_sar!=null?o.amount_sar.toFixed(2)+" SAR":"—",esc(o.service||""),esc(o.order||"")]);
    const invNote=inv.available?`· <b>${inv.tier==="live"?"live BSS":"recorded"}</b>${inv.as_of?" · as of "+fts(inv.as_of):""}${inv.cached?" · cached":""}${inv.customer?` · BSS customer ${esc(inv.customer.cust_code||"—")} (${esc(inv.customer.state==="A"?"active":inv.customer.state||"—")}${inv.customer.since?", since "+esc(inv.customer.since):""})`:""}${inv.accounts&&inv.accounts.length?` · ${inv.accounts.length} billing account(s)`:""}${inv.live_reason?` · live unavailable: ${esc(inv.live_reason)}`:""}`
      :`· <span style="color:#d97706">BSS inventory unavailable${inv.reason?" — "+esc(inv.reason):""}</span>`;
    const invCard=`<div class="card" style="padding:14px 16px;margin-bottom:12px;border-left:3px solid var(--green,#0e9f5a)"><h3 style="margin:0 0 8px;font-size:13.5px">🏠 Fixed services — what the customer has <span class="rl" style="font-weight:400;color:var(--muted);font-size:11px">${invNote}</span></h3>
        ${ftbl(["ACCOUNT","PLAN · OFFER","SPEED","STATE","PROVIDER","SINCE","UNTIL","BILLING","OWED"],invRows,inv.available?"the fixed BSS lists no subscription for this customer":"connect FIXED_BSS_BASE (live) or NEXUS (recorded) to see the subscription inventory")}
        ${invOrders.length?`<div style="margin-top:10px;font-size:12px;font-weight:600">Open BSS orders (${invOrders.length})</div>${ftbl(["CREATED","EVENT","STATE","CHANNEL","PAYMENT","AMOUNT","SERVICE","ORDER"],invOrders,"")}`:""}</div>`;
    return invCard+`<div class="card" style="padding:14px 16px;margin-bottom:12px"><h3 style="margin:0 0 8px;font-size:13.5px">Fixed journeys <span class="rl" style="font-weight:400;color:var(--muted);font-size:11px">· orders attempted through the app / dealers · customer code ${esc(c.cust_code||"—")} · customer id ${esc(c.customer_id||"—")} · sources ${(f.sources||[]).join("+")}</span></h3>
        ${ftbl(["SERVICE / ACCOUNT","JOURNEY · PLAN","CHANNEL","STATUS","ODB","REGION","DEALER / QR","STARTED","COMPLETED"],svc,"no journeys — the customer never ordered through the app / dealers (inventory above is the authority)")}${xlink}</div>
      <div class="card" style="padding:14px 16px;margin-bottom:12px"><h3 style="margin:0 0 8px;font-size:13.5px">Payments <span class="rl" style="font-weight:400;color:var(--muted);font-size:11px">· payments_v2 ${pay.configured?(pay.error?"— "+esc(pay.error):"· live"):"— not configured"}</span></h3>
        ${ftbl(["WHEN","STATUS","AMOUNT","METHOD","SERVICE / CUST","ORDER / REF","TXN","BANK MESSAGE"],payRows,pay.configured?"no payments for this customer's keys":"payments_v2 grant pending")}</div>
      <div class="card" style="padding:14px 16px;margin-bottom:12px"><h3 style="margin:0 0 8px;font-size:13.5px">Errors <span class="rl" style="font-weight:400;color:var(--muted);font-size:11px">· error control board events for this customer's attempts / orders</span></h3>
        ${ftbl(["WHEN","CATEGORY","CODE","MESSAGE","STEP","STATE"],errs,"no error events")}</div>
      <div class="card" style="padding:14px 16px"><h3 style="margin:0 0 8px;font-size:13.5px">Attempts <span class="rl" style="font-weight:400;color:var(--muted);font-size:11px">· newest 60 · click a time for the API trace</span></h3>
        ${ftbl(["STARTED (KSA)","JOURNEY","CHANNEL","OUTCOME","STEP","LAST ERROR","ORDER","SERVICE","NAFATH","⏱"],att,"no attempts")}</div>`;
  }
  function wireFixed(box){
    box.querySelectorAll(".sb-fxtrace").forEach(a=>a.addEventListener("click",e=>{ e.preventDefault(); if(window.fixedMapOpenTrace) window.fixedMapOpenTrace(a.dataset.id); else location.hash="fixed?tab=map"; }));
    box.querySelectorAll(".sb-xmob").forEach(b=>b.addEventListener("click",()=>{ curKey=b.dataset.m; unmasked=false; curTab='overview'; $("#sbKey").value=curKey; load(); }));
  }
  window.openSub360=function(key,tab){ if(key){ curKey=String(key); unmasked=false; curTab=tab||'overview'; } shell(); };
  document.querySelectorAll('.navtab[data-view="sub360"]').forEach(b=>b.addEventListener("click",()=>shell()));
  document.addEventListener("themechange",()=>{ if($("#view-sub360")&&$("#view-sub360").classList.contains("active")) shell(); });
  // ⇄ UPG buttons inside event drawers (delegated: works for main + nested per-line timelines)
  document.addEventListener("click",e=>{
    const b=e.target.closest("[data-sbupg]"); if(!b) return;
    e.stopPropagation();
    if(window.opsUpgTrace) window.opsUpgTrace(b.dataset.sbupg);
    else alert("UPG correlation is available from the Troubleshoot page (module not loaded here).");
  });

  /* NO auto re-render on live sync (removed 17 Aug 2026, user request): re-running shell()
   * wiped open trace drawers mid-reading. The profile loads on entry / Look up only. */
})();
