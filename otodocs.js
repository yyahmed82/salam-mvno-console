/* OTO Courier API — imported documentation viewer ("Confluence-style", under ? → EXPLORE).
 * Reads otoDocs.json (produced by tools/import-oto-docs.js on a machine with internet — 152
 * cannot fetch OTO). Left: folder tree + search. Right: endpoint page with method, full URL,
 * description (sanitized HTML from the official docs), request/response examples, and links to
 * BOTH our internal anchor (#otodocs?ep=<id>) and the official page (apis.tryoto.com/#<id>).
 * Also exposes window.otoDoc.linkify() so any /rest/v2/... shown in the console becomes a link. */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  let D=null, sel=null, q="";

  // sanitize the official docs' HTML: strip scripts/styles/handlers, keep tables & formatting
  function cleanHtml(h){
    return String(h||"")
      .replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"")
      .replace(/\son\w+="[^"]*"/gi,"").replace(/\son\w+='[^']*'/gi,"")
      .replace(/javascript:/gi,"")
      .replace(/<img[^>]*>/gi,"");
  }
  const short=u=>String(u||"").replace(/^https?:\/\/[^/]+/,"");

  /* ---- public linkifier: turn "/rest/v2/createOrder" (or "createOrder") into doc links ---- */
  window.otoDoc={
    ready:()=>!!D,
    idFor(token){ if(!D) return null; return D.index[String(token||"").toLowerCase()]||null; },
    // escaped-text in, html out — safe to call on already-escaped strings
    linkify(escapedText){
      if(!D) return escapedText;
      return String(escapedText).replace(/(\/rest\/v2\/[A-Za-z0-9_\/-]+|\bv2\/[A-Za-z]+|createOrder|orderStatus|refreshToken)/g, m=>{
        const id=D.index[m.toLowerCase()]||D.index[("/rest/"+m).toLowerCase()]||D.index[("/rest/v2/"+m).toLowerCase()];
        return id?`<a href="#otodocs?ep=${id}" style="color:#0d9488;font-weight:700;text-decoration:none" title="OTO docs: ${m}">${m}</a>`:m;
      });
    }
  };

  async function load(){
    if(D) return D;
    try{ const r=await fetch("otoDocs.json?_="+Date.now()); if(r.ok) D=await r.json(); }catch(e){}
    // rebuild the lookup index CLIENT-SIDE with a canonical rule: when the docs contain the
    // same endpoint several times (webhook ×4, clientInfo ×2 — reference vs use-case copies),
    // the entry with the RICHEST description wins, deterministically.
    if(D&&Array.isArray(D.endpoints)){
      const best={};
      D.endpoints.forEach(e=>{
        const p=String(e.url||"").replace(/^https?:\/\/[^/]+/,"").toLowerCase();
        for(const k of [p,p.replace(/^\/rest/,""),p.split("/").pop(),String(e.name||"").toLowerCase()]){
          if(!k) continue;
          if(!best[k]||String(e.desc||"").length>best[k].len) best[k]={id:e.id,len:String(e.desc||"").length};
        }
      });
      D.index={}; Object.entries(best).forEach(([k,v])=>D.index[k]=v.id);
    }
    return D;
  }
  load();   // warm at boot so linkify works everywhere without opening the page

  function tree(){
    const byF={};
    (D.pages||[]).forEach(p=>{ (byF[p.folder||"Guides"]=byF[p.folder||"Guides"]||[]).push({id:p.id,name:p.name,guide:true}); });
    (D.endpoints||[]).forEach(e=>{ (byF[e.folder||"API"]=byF[e.folder||"API"]||[]).push({id:e.id,name:e.name,method:e.method,path:short(e.url)}); });
    const ql=q.toLowerCase();
    const match=x=>!ql||String(x.name+" "+(x.path||"")).toLowerCase().includes(ql);
    return Object.entries(byF).map(([f,items])=>{
      const vis=items.filter(match); if(!vis.length) return "";
      return `<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--muted);text-transform:uppercase;padding:2px 6px">${esc(f)}</div>
        ${vis.map(x=>`<div class="oto-it ${sel===x.id?"on":""}" data-id="${esc(x.id)}" style="display:flex;gap:6px;align-items:center;padding:4px 8px;border-radius:7px;cursor:pointer;${sel===x.id?"background:var(--green-bg,rgba(16,185,129,.12));":""}">
          ${x.method?`<span class="mono" style="font-size:9px;font-weight:800;color:${x.method==="GET"?"#16a34a":"#2563eb"}">${esc(x.method)}</span>`:`<span style="font-size:9px">📄</span>`}
          <span style="font-size:11.5px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.path||x.name)}">${esc(x.name)}</span></div>`).join("")}</div>`;
    }).join("");
  }

  function page(){
    const g=(D.pages||[]).find(p=>p.id===sel);
    if(g) return `<h2 style="margin:0 0 4px">${esc(g.name)}</h2>
      <div class="rl" style="margin-bottom:10px;color:var(--muted)">${esc(g.folder)} · <a href="https://apis.tryoto.com/#${esc(g.id)}" target="_blank" style="color:#0d9488">official page ↗</a></div>
      <div class="oto-doc">${cleanHtml(g.desc)}</div>`;
    const e=(D.endpoints||[]).find(x=>x.id===sel);
    if(!e) return `<div class="rl">Pick an endpoint on the left — or use search.</div>`;
    return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="mono" style="font-size:13px;font-weight:800;padding:3px 10px;border-radius:7px;background:${e.method==="GET"?"#16a34a22":"#2563eb22"};color:${e.method==="GET"?"#16a34a":"#2563eb"}">${esc(e.method)}</span>
        <h2 style="margin:0">${esc(e.name)}</h2></div>
      <div class="mono" style="font-size:12.5px;margin:6px 0 2px">${esc(e.url)}</div>
      <div class="rl" style="margin-bottom:12px;color:var(--muted)">${esc(e.folder)} ·
        <a href="https://apis.tryoto.com/#${esc(e.id)}" target="_blank" style="color:#0d9488">official page ↗</a> ·
        internal link: <span class="mono">#otodocs?ep=${esc(e.id)}</span></div>
      <div class="oto-doc">${cleanHtml(e.desc)}</div>
      ${e.body?`<div style="font-weight:800;font-size:11px;margin:12px 0 4px">REQUEST EXAMPLE</div>
        <pre class="mono" style="font-size:11px;background:var(--card2,rgba(148,163,184,.08));border:1px solid var(--line);border-radius:9px;padding:10px;white-space:pre-wrap;word-break:break-all;max-height:340px;overflow:auto">${esc(e.body)}</pre>`:""}
      ${(e.responses||[]).map(r=>`<div style="font-weight:800;font-size:11px;margin:12px 0 4px">RESPONSE ${esc(r.status||"")} ${esc(r.name?("— "+r.name):"")}</div>
        <pre class="mono" style="font-size:11px;background:var(--card2,rgba(148,163,184,.08));border:1px solid var(--line);border-radius:9px;padding:10px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow:auto">${esc(r.body||"")}</pre>`).join("")}`;
  }

  async function render(){
    const host=$("#view-otodocs"); if(!host) return;
    await load();
    if(!D){
      host.innerHTML=`<div style="padding:24px;max-width:760px;margin:0 auto">
        <h2>OTO Courier API — reference</h2>
        <div class="albanner" style="margin-top:10px">otoDocs.json not found — the docs have not been imported yet.</div>
        <div class="rl" style="margin-top:10px;line-height:1.7">Run the importer on your Mac (152 has no internet), then deploy the frontend:</div>
        <pre class="mono" style="font-size:12px;background:var(--card2,rgba(148,163,184,.08));border:1px solid var(--line);border-radius:9px;padding:12px;margin-top:8px">cd ~/Documents/Claude/Projects/"Salam DMS"/mvno-console
node tools/import-oto-docs.js
cd deploy152 && ./deploy.sh</pre></div>`;
      return;
    }
    // honor deep link #otodocs?ep=<id>
    const m=/ep=([0-9a-f-]{36})/.exec(location.hash||""); if(m) sel=m[1];
    if(!sel && D.endpoints && D.endpoints.length) sel=(D.endpoints.find(e=>/createOrder/i.test(e.url))||D.endpoints[0]).id;
    host.innerHTML=`<div style="padding:14px 18px;max-width:1440px;margin:0 auto">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <h2 style="margin:0;font-size:17px">OTO Courier API — reference</h2>
        <span class="rl" style="color:var(--muted)">imported ${esc(String(D.imported_at||"").slice(0,10))} · ${(D.endpoints||[]).length} endpoints · ${(D.pages||[]).length} guides · refresh: node tools/import-oto-docs.js</span></div>
      <div style="display:flex;gap:14px;align-items:flex-start">
        <div style="width:290px;flex-shrink:0;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:10px;max-height:calc(100vh - 200px);overflow:auto">
          <input id="otoQ" placeholder="search endpoints…" value="${esc(q)}" class="mono" style="width:100%;box-sizing:border-box;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2,rgba(148,163,184,.06));color:var(--ink);font-size:11.5px;margin-bottom:8px">
          <div id="otoTree">${tree()}</div></div>
        <div style="flex:1;border:1px solid var(--line);border-radius:12px;background:var(--card);padding:16px 20px;min-height:400px;max-height:calc(100vh - 200px);overflow:auto" id="otoPage">${page()}</div>
      </div>
      <style>.oto-doc{font-size:12.5px;line-height:1.65}.oto-doc table{border-collapse:collapse;margin:8px 0;font-size:11.5px}
        .oto-doc td,.oto-doc th{border:1px solid var(--line);padding:4px 8px;text-align:left}
        .oto-doc code,.oto-doc pre{background:var(--card2,rgba(148,163,184,.1));border-radius:4px;padding:1px 4px;font-family:var(--mono)}
        .oto-doc h1,.oto-doc h2,.oto-doc h3{font-size:14px;margin:12px 0 4px}.oto-doc a{color:#0d9488}</style>`;
    host.querySelectorAll(".oto-it").forEach(el=>el.addEventListener("click",()=>{ sel=el.dataset.id;
      if(window.setConsoleHash) window.setConsoleHash("otodocs?ep="+sel); render();
      if(window.audit) window.audit("VIEW_OTO_DOC", sel.slice(0,12)); }));
    // land clean: content pane at its top, selected item visible in the tree
    const pg=$("#otoPage"); if(pg) pg.scrollTop=0;
    const on=host.querySelector(".oto-it.on"); if(on) on.scrollIntoView({block:"nearest"});
    window.scrollTo(0,0);
    const qi=$("#otoQ"); if(qi) qi.addEventListener("input",()=>{ q=qi.value.trim(); const t=$("#otoTree"); if(t) t.innerHTML=tree();
      document.querySelectorAll(".oto-it").forEach(el=>el.addEventListener("click",()=>{ sel=el.dataset.id; render(); })); });
  }

  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="otodocs") b.addEventListener("click", render); });
  window.openOtoDocs=render;
})();
