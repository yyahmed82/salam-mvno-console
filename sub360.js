/* Subscriber 360 — unified profile by MSISDN or National ID.
 * Auth headers (X-Console-User/Role) are injected globally by ops.js's fetch wrapper. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const API=(location.protocol==="file:")?"http://localhost:4600":"";
  const api=(p)=>window.fetch(API+p).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));});return r.json();});
  let curKey=null, unmasked=false;
  const SES=()=>(window.opsSession?window.opsSession():{});
  const canUnmask=()=>{ const s=SES(); return !!(s.me&&s.me.caps&&s.me.caps.unmaskPII); };

  const KSA=iso=>{ if(!iso) return "—"; try{ return new Date(iso).toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).replace(","," ·"); }catch(e){ return String(iso); } };
  const day=iso=>{ if(!iso) return "—"; try{ return new Date(iso).toLocaleDateString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"short",year:"numeric"}); }catch(e){ return String(iso); } };
  const dot=ok=> ok===true?'<span class="sb-dot ok"></span>':ok===false?'<span class="sb-dot fail"></span>':'<span class="sb-dot pend"></span>';

  function shell(){
    const host=$("#view-sub360"); if(!host) return;
    host.innerHTML=`<div class="panel">
      <h2>Subscriber 360</h2>
      <div class="sub">One unified profile per subscriber — identity, lines/SIMs, plan, and the full journey timeline across every system. Search by MSISDN or National ID. PII is masked unless you can unmask.</div>
      <div class="sb-search">
        <input id="sbKey" placeholder="MSISDN (9665…) or National ID" value="${esc(curKey||'')}">
        <button class="pill" id="sbGo" style="border-left-color:var(--green)">Look up</button>
      </div>
      <div id="sbBody" style="margin-top:14px"></div>
    </div>`;
    const go=()=>{ const k=$("#sbKey").value.trim(); if(k){ curKey=k; unmasked=false; load(); if(window.setConsoleHash) window.setConsoleHash("subscriber?key="+encodeURIComponent(k)); } };
    $("#sbGo").addEventListener("click",go);
    $("#sbKey").addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });
    if(curKey) load();
  }

  async function load(){
    const box=$("#sbBody"); if(!box) return; box.innerHTML=`<div class="sub">Loading profile…</div>`;
    let d; try{ d=await api("/api/subscriber?key="+encodeURIComponent(curKey)+(unmasked?"&unmask=1":"")); }
    catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    if(!d.found){ box.innerHTML=`<div class="okbox">No subscriber found for “${esc(curKey)}”. Try the MSISDN in intl format (9665…) or the National ID.</div>`; return; }
    box.innerHTML = idCard(d.identity) + summaryRow(d.summary) + linesCard(d.lines) + timelineCard(d.events);
    const ub=$("#sbUnmask"); if(ub) ub.addEventListener("click",()=>{ unmasked=!unmasked; load(); });
  }

  function idCard(i){
    i=i||{};
    const unmaskBtn = canUnmask()? `<button class="pill" id="sbUnmask" style="border-left-color:var(--purple);margin-left:auto">${unmasked?'Mask PII':'Unmask PII'}</button>` : '';
    const act = i.activated===true?'<span class="sb-badge ok">Activated</span>':i.activated===false?'<span class="sb-badge pend">Not activated</span>':'';
    return `<div class="sb-id">
      <div class="sb-id-h"><b>Identity</b>${act}${unmaskBtn}</div>
      <div class="sb-grid">
        ${kv('MSISDN',i.mobile_number)}
        ${kv('National ID',i.nationality_id_number)}
        ${kv('Current plan',i.current_plan)}
        ${kv('Status',i.status)}
        ${kv('Order state',i.state)}
        ${kv('Flow',i.flow)}
        ${kv('Lines',i.lines_count)}
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

  function linesCard(lines){
    if(!lines||!lines.length) return '';
    const rows=lines.map(l=>`<tr>
      <td>${esc(l.mobile_number||'—')}</td><td>${esc(l.plan||'—')}</td>
      <td>${esc(l.line_type||'—')}</td><td>${esc(l.sim||'—')}</td>
      <td>${esc(l.status||l.aasm_state||'—')}</td>
      <td>${l.activated?'✓':'—'}</td><td class="rl">${day(l.created_at)}</td></tr>`).join('');
    return `<div class="sb-block"><h3>Lines / SIMs <span class="rl">(${lines.length})</span></h3>
      <table class="sb-tbl"><thead><tr><th>MSISDN</th><th>Plan</th><th>Type</th><th>SIM</th><th>Status</th><th>Act.</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function timelineCard(events){
    if(!events||!events.length) return `<div class="sb-block"><h3>Journey timeline</h3><div class="okbox">No journey events.</div></div>`;
    const rows=events.map(e=>`<div class="sb-ev">
      <div class="sb-ev-t">${dot(e.ok)}<span class="rl">${KSA(e.at)}</span></div>
      <div class="sb-ev-src">${esc(STAGE[e.source]||e.source)}<small>${esc(e.kind||'')}</small></div>
      <div class="sb-ev-d">${esc(e.detail||'')}${e.ms!=null?`<span class="rl"> · ${e.ms}ms</span>`:''}</div>
    </div>`).join('');
    return `<div class="sb-block"><h3>Journey timeline <span class="rl">(${events.length} events)</span></h3><div class="sb-tl">${rows}</div></div>`;
  }

  // public entry (nav click, deep link, or "open profile" from Troubleshoot)
  window.openSub360=function(key){ if(key){ curKey=String(key); unmasked=false; } shell(); };
  document.querySelectorAll('.navtab[data-view="sub360"]').forEach(b=>b.addEventListener("click",()=>shell()));
  document.addEventListener("themechange",()=>{ if($("#view-sub360")&&$("#view-sub360").classList.contains("active")) shell(); });
  document.addEventListener("opsdatarefresh",()=>{ if($("#view-sub360")&&$("#view-sub360").classList.contains("active")) shell(); });
})();
