/* fixed-report.js — Fixed › Report: the branded Activity Digest (same HTML the prod Operations Console e-mails),
 * rendered live by /api/fixed/report/html for a 24h or 7d window. Port of apps/web/src/app/report/page.tsx:
 * window picker · digest in a sandboxed iframe (srcdoc) · "Open in new tab" · "Download HTML". */
(function(){
  "use strict";
  const FX=()=>window.FX;
  const st={ hours:Number(localStorage.getItem("fixed_report_hours"))||24, html:"", win:null, blobUrl:null };
  const stamp=()=>new Date(Date.now()+3*3600e3).toISOString().slice(0,16).replace("T","_").replace(":","");

  async function render(host, fx){
    const {esc}=fx;
    const wbtn=(h,l)=>`<button class="fr-w" data-h="${h}" style="cursor:pointer;font:inherit;font-size:12px;font-weight:${st.hours===h?"800":"600"};padding:5px 14px;border:1px solid ${st.hours===h?"var(--green,#0e9f5a)":"var(--line)"};border-radius:999px;background:${st.hours===h?"var(--green,#0e9f5a)":"var(--card,#fff)"};color:${st.hours===h?"#fff":"inherit"}">${l}</button>`;
    host.innerHTML=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <div><h3 style="margin:0;font-size:15px">Activity digest</h3><div class="rl" style="font-size:11px;color:var(--muted)">Branded KPI report — the same digest the Operations Console e-mails, rendered live for the window · counts every attempt (consumer-direct included), like the prod report</div></div>
        <span class="rl" style="font-size:11px;color:var(--muted);font-weight:700;margin-left:auto">Window</span>${wbtn(24,"24h")}${wbtn(168,"7d")}
        <button id="frRefresh" class="btn" style="font-size:11.5px;padding:5px 12px">Refresh</button>
        <button id="frOpen" class="btn" style="font-size:11.5px;padding:5px 12px" disabled>Open in new tab ↗</button>
        <button id="frDl" class="btn" style="font-size:11.5px;padding:5px 12px" disabled>Download HTML</button></div>
      <div id="frMeta" class="rl" style="font-size:10.5px;color:var(--muted);margin-bottom:8px"></div>
      <div class="topo-card" style="padding:0;overflow:hidden"><div id="frBody" style="padding:30px;text-align:center;color:var(--muted)">${window.salamLoader?window.salamLoader("Building the digest…"):"Building the digest…"}</div></div>`;
    host.querySelectorAll(".fr-w").forEach(b=>b.onclick=()=>{ st.hours=Number(b.dataset.h); localStorage.setItem("fixed_report_hours",String(st.hours)); render(host,fx); });
    host.querySelector("#frRefresh").onclick=()=>render(host,fx);
    host.querySelector("#frOpen").onclick=()=>{ if(!st.html) return; if(st.blobUrl) URL.revokeObjectURL(st.blobUrl); st.blobUrl=URL.createObjectURL(new Blob([st.html],{type:"text/html"})); window.open(st.blobUrl,"_blank","noopener"); };
    host.querySelector("#frDl").onclick=()=>{ if(!st.html) return; const u=URL.createObjectURL(new Blob([st.html],{type:"text/html"})); const a=document.createElement("a"); a.href=u; a.download=`salam-fixed-digest_${st.hours}h_${stamp()}.html`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),2000); };
    try{
      const r=await fx.api(`/api/fixed/report/html?window=${st.hours}`);
      st.html=r.html||""; st.win=r.window;
      const body=host.querySelector("#frBody"); if(!body) return;
      body.style.padding="0"; body.style.textAlign="";
      body.innerHTML=`<iframe id="frFrame" sandbox="allow-same-origin" title="Activity digest" style="width:100%;height:80vh;min-height:600px;border:0;display:block;background:#EDF4EF"></iframe>`;
      body.querySelector("#frFrame").srcdoc=st.html;
      host.querySelector("#frMeta").innerHTML=`${fx.ts(r.window.from)} → ${fx.ts(r.window.to)} KSA · last ${r.window.hours}h · ${(st.html.length/1024).toFixed(0)} KB · charts are inline SVG (no external scripts)`;
      host.querySelector("#frOpen").disabled=false; host.querySelector("#frDl").disabled=false;
    }catch(e){
      const body=host.querySelector("#frBody"); if(body) body.innerHTML=`<div class="albanner" style="border-left:4px solid #dc2626;padding:14px 16px;text-align:left"><b>Report unavailable</b> — ${esc(e.message)}</div>`;
    }
  }

  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.report={ label:"Report", sub:"branded KPI digest", render:(host,fx)=>render(host,fx||FX()) };
})();
