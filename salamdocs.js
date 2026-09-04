/* Salam Selfcare API docs viewer — the app's own Slate documentation (served with basic auth at
 * staging-proxy.salammobile.sa/api-docs), imported straight from the selfcare-backend repo by
 * tools/import-salam-api-docs.js into salamApiDocs.json. Under ? → EXPLORE, deep links
 * #salamdocs?s=<anchor> (same anchors as the official page, e.g. #checkout). */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  let D=null, sel=null, q="";

  function cleanHtml(h){
    return String(h||"")
      .replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"")
      .replace(/\son\w+="[^"]*"/gi,"").replace(/\son\w+='[^']*'/gi,"").replace(/javascript:/gi,"")
      .replace(/<img[^>]*>/gi,"");
  }
  async function load(){
    if(D) return D;
    try{ const r=await fetch("salamApiDocs.json?_="+Date.now()); if(r.ok) D=await r.json(); }catch(e){}
    return D;
  }
  load();

  function tree(){
    const ql=q.toLowerCase();
    return (D.sections||[]).filter(s=>!ql||s.title.toLowerCase().includes(ql)||s.id.includes(ql)).map(s=>
      `<div class="sad-it ${sel===s.id?"on":""}" data-id="${esc(s.id)}" style="padding:4px 8px 4px ${s.level===1?8:22}px;border-radius:7px;cursor:pointer;font-size:${s.level===1?"12px":"11.5px"};font-weight:${s.level===1?800:600};${sel===s.id?"background:var(--green-bg,rgba(16,185,129,.12));":""}${s.level===1?"margin-top:6px;":""}">${esc(s.title)}</div>`).join("");
  }
  function page(){
    const s=(D.sections||[]).find(x=>x.id===sel);
    if(!s) return `<div class="rl">Pick a section on the left.</div>`;
    return `<div class="rl" style="margin-bottom:8px;color:var(--muted)">
        <a href="${esc((D.external_base||"")+s.id)}" target="_blank" style="color:#0d9488">official page (staging-proxy, basic auth) ↗</a>
        · internal link: <span class="mono">#salamdocs?s=${esc(s.id)}</span></div>
      <div class="sad-doc">${cleanHtml(s.html)}</div>`;
  }
  async function render(){
    const host=$("#view-salamdocs"); if(!host) return;
    await load();
    if(!D){
      host.innerHTML=`<div style="padding:24px;max-width:760px;margin:0 auto"><h2>Salam Selfcare API docs</h2>
        <div class="albanner" style="margin-top:10px">salamApiDocs.json not found — run the importer, then deploy:</div>
        <pre class="mono" style="font-size:12px;background:var(--card2,rgba(148,163,184,.08));border:1px solid var(--line);border-radius:9px;padding:12px;margin-top:8px">cd ~/Documents/Claude/Projects/"Salam DMS"/mvno-console
node tools/import-salam-api-docs.js
cd deploy152 && ./deploy.sh</pre></div>`;
      return;
    }
    const m=/s=([a-z0-9-]+)/.exec(location.hash||""); if(m&&(D.sections||[]).some(x=>x.id===m[1])) sel=m[1];
    if(!sel) sel=((D.sections||[]).find(s=>s.id==="checkout")||D.sections[0]||{}).id;
    host.innerHTML=`<div style="padding:14px 18px;max-width:1440px;margin:0 auto">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <h2 style="margin:0;font-size:17px">Salam Selfcare API — documentation</h2>
        <span class="rl" style="color:var(--muted)">from the app repo (vendor/api-docs) · imported ${esc(String(D.imported_at||"").slice(0,10))} · ${(D.sections||[]).length} sections · refresh: node tools/import-salam-api-docs.js</span></div>
      <div style="display:flex;gap:14px;align-items:flex-start">
        <div style="width:270px;flex-shrink:0;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px;max-height:calc(100vh - 200px);overflow:auto">
          <input id="sadQ" placeholder="search sections…" value="${esc(q)}" class="mono" style="width:100%;box-sizing:border-box;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2,rgba(148,163,184,.06));color:var(--ink);font-size:11.5px;margin-bottom:6px">
          <div id="sadTree">${tree()}</div></div>
        <div style="flex:1;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:16px 20px;min-height:400px;max-height:calc(100vh - 200px);overflow:auto" id="sadPage">${page()}</div>
      </div>
      <style>.sad-doc{font-size:12.5px;line-height:1.65}.sad-doc table{border-collapse:collapse;margin:8px 0;font-size:11.5px}
        .sad-doc td,.sad-doc th{border:1px solid var(--line);padding:4px 8px;text-align:left}
        .sad-doc code{background:var(--card2,rgba(148,163,184,.1));border-radius:4px;padding:1px 4px;font-family:var(--mono);font-size:11px}
        .sad-doc pre{background:var(--card2,rgba(148,163,184,.08));border:1px solid var(--line);border-radius:9px;padding:10px;overflow:auto;font-family:var(--mono);font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:380px}
        .sad-doc h1,.sad-doc h2,.sad-doc h3{font-size:14px;margin:12px 0 4px}.sad-doc a{color:#0d9488}
        .sad-doc blockquote{border-left:3px solid var(--line);margin:6px 0;padding:2px 10px;color:var(--muted)}</style>`;
    const wire=()=>{ host.querySelectorAll(".sad-it").forEach(el=>el.addEventListener("click",()=>{ sel=el.dataset.id;
      if(window.setConsoleHash) window.setConsoleHash("salamdocs?s="+sel); render();
      if(window.audit) window.audit("VIEW_SALAM_DOC", sel.slice(0,30)); })); };
    wire();
    const pg=$("#sadPage"); if(pg) pg.scrollTop=0;
    const on=host.querySelector(".sad-it.on"); if(on) on.scrollIntoView({block:"nearest"});
    window.scrollTo(0,0);
    const qi=$("#sadQ"); if(qi) qi.addEventListener("input",()=>{ q=qi.value.trim(); const t=$("#sadTree"); if(t){ t.innerHTML=tree(); wire(); } });
  }

  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="salamdocs") b.addEventListener("click", render); });
  window.openSalamDocs=render;
})();
