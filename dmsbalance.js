/* DMS — BULK WALLET BALANCE (17 Sep 2026). The "please provide the current balance for the
 * users below" mail (INC0027800: a partner pastes ~45 usernames, Ops raises a P4, the app team
 * answers with a username · running_balance sheet). This panel is that sheet, on demand:
 * paste the list → dms_users → wallet service decrypt → table + the same two-column Excel.
 * Mounted by dms.js under Dealer 360 as window.renderBulkBalance(host). Fails soft: an old
 * server without the endpoint shows the reason instead of a broken panel. */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const SES=()=>({ email:localStorage.getItem("cons_email")||"", role:localStorage.getItem("cons_role")||"report_manager" });
  const base=()=>(window.API_BASE||window.CONSOLE_BASE||"");
  const hdr=()=>({ "Content-Type":"application/json","X-Console-Role":SES().role,"X-Console-User":SES().email });
  const sar=v=>v==null?"—":Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  let last=null, lastList="";

  function kpi(l,v,c){ return `<div class="topo-card" style="padding:8px 12px;min-width:110px"><div class="rl" style="font-size:10px;color:var(--muted);font-weight:700">${esc(l)}</div><div class="mono" style="font-size:18px;font-weight:800;color:${c||"inherit"}">${esc(v)}</div></div>`; }

  function shell(host){
    host.innerHTML=`<div class="topo-card" style="padding:10px 12px;background:var(--card,#fff)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <b style="font-size:12px">Bulk wallet balance</b>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">paste usernames or dealer codes (one per line, comma or space) — the "balance report" mail, answered here</span>
        <span id="bbSrc" class="rl mono" style="margin-left:auto;font-size:9.5px;color:var(--muted)"></span>
      </div>
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;align-items:flex-start">
        <textarea id="bbList" rows="6" placeholder="dis_011149&#10;mtl_010765&#10;pos_016740 …" spellcheck="false" style="flex:1 1 260px;min-width:220px;box-sizing:border-box;font:inherit;font-family:ui-monospace,Menlo,monospace;font-size:12px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit;resize:vertical">${esc(lastList)}</textarea>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:150px">
          <button id="bbRun" class="btn" style="font-size:12px;padding:7px 14px">Get balances</button>
          <button id="bbXls" class="btn" style="font-size:11.5px;padding:6px 13px;display:none">⤓ Excel (balance report)</button>
          <button id="bbCsv" class="pill" style="font-size:11px;padding:5px 10px;display:none">⤓ CSV</button>
          <button id="bbCopy" class="pill" style="font-size:11px;padding:5px 10px;display:none">Copy username · balance</button>
          <button id="bbClr" class="pill" style="font-size:11px;padding:5px 10px">Clear</button>
        </div>
      </div>
      <div id="bbMsg" class="rl" style="font-size:11px;color:var(--muted);margin-top:6px"></div>
      <div id="bbOut" style="margin-top:8px"></div></div>`;
    const ta=host.querySelector("#bbList"), run=host.querySelector("#bbRun"), msg=host.querySelector("#bbMsg"), out=host.querySelector("#bbOut");
    const show=(id,on)=>{ const b=host.querySelector(id); if(b) b.style.display=on?"":"none"; };
    ta.addEventListener("input",()=>{ lastList=ta.value; });
    host.querySelector("#bbClr").addEventListener("click",()=>{ ta.value=""; lastList=""; last=null; out.innerHTML=""; msg.textContent=""; ["#bbXls","#bbCsv","#bbCopy"].forEach(i=>show(i,false)); });
    run.addEventListener("click",async()=>{
      const list=ta.value.trim(); if(!list){ msg.textContent="paste at least one username or dealer code"; return; }
      run.disabled=true; run.textContent="Looking up…"; msg.textContent="dms_users → wallet service (decrypt) …"; out.innerHTML="";
      try{
        const r=await fetch(base()+"/api/dms/wallet/bulk-balance",{method:"POST",headers:hdr(),body:JSON.stringify({list})});
        const j=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(j.error||("HTTP "+r.status));
        last=j; renderOut(host,j); ["#bbXls","#bbCsv","#bbCopy"].forEach(i=>show(i,true));
        msg.innerHTML=`${j.found}/${j.asked} found · ${j.with_balance} with a balance · total <b class="mono">${esc(sar(j.total_balance))} SAR</b>`
          +(j.not_found.length?` · <span style="color:var(--amber,#b45309)">not found: ${esc(j.not_found.join(", "))}</span>`:"")
          +(j.rejected&&j.rejected.length?` · <span style="color:var(--amber,#b45309)">ignored (not a username): ${esc(j.rejected.join(", "))}</span>`:"")
          +(j.wallet&&j.wallet.error?` · <span style="color:var(--red,#dc2626)">wallet service: ${esc(j.wallet.error)}</span>`:"");
        const src=host.querySelector("#bbSrc"); if(src) src.textContent=j.wallet&&j.wallet.via?("via "+j.wallet.via):"";
        if(window.audit) window.audit("DEALER_BULK_BALANCE","dms:bulk-balance:"+j.asked);
      }catch(e){ msg.innerHTML=`<span style="color:var(--red,#dc2626)">${esc(e.message)}</span>`; }
      finally{ run.disabled=false; run.textContent="Get balances"; }
    });
    host.querySelector("#bbXls").addEventListener("click",async()=>{
      const b=host.querySelector("#bbXls"); b.disabled=true; b.textContent="Building…";
      try{
        const r=await fetch(base()+"/api/dms/wallet/bulk-balance?format=xlsx",{method:"POST",headers:hdr(),body:JSON.stringify({list:ta.value})});
        if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||("HTTP "+r.status));
        const blob=await r.blob(); const url=URL.createObjectURL(blob); const m=/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition")||"");
        const a=document.createElement("a"); a.href=url; a.download=m?m[1]:"balance_report.xlsx"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),4000);
      }catch(e){ msg.innerHTML=`<span style="color:var(--red,#dc2626)">${esc(e.message)}</span>`; }
      finally{ b.disabled=false; b.textContent="⤓ Excel (balance report)"; }
    });
    host.querySelector("#bbCsv").addEventListener("click",()=>{
      if(!last) return;
      const H=["input","username","dealer_code","account_number","dealer_type","user_status","wallet_status","balance_updated_on","running_balance","note"];
      const q=v=>{ const s=v==null?"":String(v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
      const csv="﻿"+[H.join(","),...last.rows.map(r=>H.map(h=>q(r[h])).join(","))].join("\n");
      const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})); a.download="balance_report_"+new Date().toISOString().slice(0,10)+".csv"; a.click();
    });
    host.querySelector("#bbCopy").addEventListener("click",async()=>{
      if(!last) return;
      const txt=last.rows.filter(r=>r.found).map(r=>`${r.username}\t${r.running_balance==null?"":r.running_balance}`).join("\n");
      try{ await navigator.clipboard.writeText(txt); msg.textContent="copied "+last.rows.filter(r=>r.found).length+" lines (username ⇥ balance)"; }catch(e){ msg.textContent="clipboard blocked by the browser — use CSV"; }
    });
  }

  function renderOut(host,j){
    const out=host.querySelector("#bbOut");
    const zero=j.rows.filter(r=>r.found&&r.running_balance!=null&&r.running_balance<=0).length;
    const inactive=j.rows.filter(r=>r.found&&(String(r.user_status||"").toLowerCase()!=="active"||(r.wallet_status&&String(r.wallet_status).toLowerCase()!=="active"))).length;
    const st=s=>{ const v=String(s||"").toLowerCase(); const c=v==="active"?"var(--green,#0e9f6e)":v?"var(--amber,#b45309)":"var(--muted)"; return `<span style="color:${c};font-weight:700">${esc(s||"—")}</span>`; };
    out.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        ${kpi("asked",j.asked)}${kpi("found",j.found,j.found<j.asked?"var(--amber,#b45309)":"var(--green,#0e9f6e)")}${kpi("with balance",j.with_balance)}
        ${kpi("total SAR",sar(j.total_balance))}${kpi("zero / negative",zero,zero?"var(--amber,#b45309)":"inherit")}${kpi("not active",inactive,inactive?"var(--amber,#b45309)":"inherit")}
      </div>
      <div style="overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:10px">
      <table class="tbl" style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:820px">
        <thead><tr style="text-align:left"><th style="padding:6px 8px">#</th><th style="padding:6px 8px">input</th><th style="padding:6px 8px">username</th><th style="padding:6px 8px">dealer code</th><th style="padding:6px 8px">wallet account</th><th style="padding:6px 8px">type</th><th style="padding:6px 8px">user</th><th style="padding:6px 8px">wallet</th><th style="padding:6px 8px">balance updated</th><th style="padding:6px 8px;text-align:right">running_balance</th><th style="padding:6px 8px">note</th></tr></thead>
        <tbody>${j.rows.map((r,i)=>`<tr style="border-top:1px solid var(--line);${r.found?"":"opacity:.75"}">
          <td class="mono" style="padding:5px 8px;color:var(--muted)">${i+1}</td>
          <td class="mono" style="padding:5px 8px">${esc(r.input)}</td>
          <td class="mono" style="padding:5px 8px">${r.found?`<a href="#" data-open="${esc(r.username)}" style="color:inherit;font-weight:700">${esc(r.username)}</a>`:"—"}</td>
          <td class="mono" style="padding:5px 8px">${esc(r.dealer_code||"—")}</td>
          <td class="mono" style="padding:5px 8px">${esc(r.account_number||"—")}</td>
          <td style="padding:5px 8px">${esc(r.dealer_type||"—")}</td>
          <td style="padding:5px 8px">${r.found?st(r.user_status):"—"}</td>
          <td style="padding:5px 8px">${r.found?st(r.wallet_status):"—"}</td>
          <td class="mono" style="padding:5px 8px;color:var(--muted)">${esc(r.balance_updated_on||"—")}</td>
          <td class="mono" style="padding:5px 8px;text-align:right;font-weight:800;color:${r.running_balance==null?"var(--muted)":r.running_balance<=0?"var(--amber,#b45309)":"inherit"}">${esc(sar(r.running_balance))}</td>
          <td class="rl" style="padding:5px 8px;color:var(--muted);font-size:10.5px">${esc(r.note||"")}</td></tr>`).join("")}</tbody></table></div>
      <div class="rl" style="font-size:10px;color:var(--muted);margin-top:6px">${esc(j.wallet&&j.wallet.basis||"")}</div>`;
    out.querySelectorAll("a[data-open]").forEach(a=>a.addEventListener("click",e=>{ e.preventDefault(); if(window.openDealer360) window.openDealer360(a.dataset.open); }));
  }

  window.renderBulkBalance=function(host){ if(!host) return; shell(host); if(last) { renderOut(host,last); ["#bbXls","#bbCsv","#bbCopy"].forEach(i=>{ const b=host.querySelector(i); if(b) b.style.display=""; }); } };
})();
