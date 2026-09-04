/* fixed-playbook.js — Fixed › Playbook: SLA / OLA / action plans (ops_docs from the prod Operations Console,
 * edits stored as unified-console overrides). Port of apps/web/src/components/PlaybookDocs.tsx.
 * Left: list grouped by kind · right: markdown rendered by the tiny renderer below (HTML escaped first) ·
 * "Updated … by … · seeded" · Edit / + New document only when the session has caps.editRules. */
(function(){
  "use strict";
  const FX=()=>window.FX;
  const KIND_LABEL={ PLAYBOOK:"Playbook", SLA:"SLA", OLA:"OLA", ACTION_PLAN:"Action plans" };
  const KIND_ORDER=["PLAYBOOK","SLA","OLA","ACTION_PLAN"];
  const st={ slug:null, edit:null, saving:false };

  async function caps(){
    try{ const s=window.opsSession&&window.opsSession(); if(s&&s.me&&s.me.caps) return s.me.caps; }catch(e){}
    try{ const me=await FX().api("/api/me"); return me.caps||{}; }catch(e){ return {}; }
  }
  const fmtKsa=v=>{ if(!v) return "—"; const d=new Date(v); return isNaN(d)?"—":d.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Riyadh"}); };

  /* ---- minimal markdown → HTML (escape first; headings · bold · code · links · lists · tables · paragraphs) ---- */
  function inline(t){
    const esc=FX().esc; let s=esc(t);
    s=s.replace(/`([^`]+)`/g,(m,c)=>`<code style="background:var(--line);padding:1px 5px;border-radius:4px;font-size:12px">${c}</code>`);
    s=s.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
    s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#[^)\s]*|\/[^)\s]*)\)/g,(m,l,u)=>`<a href="${u.replace(/"/g,"&quot;")}" target="_blank" rel="noreferrer">${l}</a>`);
    return s;
  }
  function md(src){
    const lines=String(src||"").replace(/\r/g,"").split("\n"); const out=[]; let i=0;
    const trimCells=r=>{ const c=r.split("|").map(x=>x.trim()); if(c[0]==="") c.shift(); if(c.length&&c[c.length-1]==="") c.pop(); return c; };
    while(i<lines.length){
      const line=lines[i];
      let m;
      if((m=/^(#{1,3})\s+(.*)$/.exec(line))){ const lv=m[1].length; const style=lv===1?"margin:4px 0 8px;font-size:18px":lv===2?"margin:16px 0 6px;font-size:14.5px;color:var(--green,#0e9f5a)":"margin:14px 0 4px;font-size:13px";
        out.push(`<h${lv+1} style="${style}">${inline(m[2])}</h${lv+1}>`); i++; continue; }
      if(line.includes("|")&&/---/.test(lines[i+1]||"")){
        const head=trimCells(line); const rows=[]; i+=2;
        while(i<lines.length&&lines[i].includes("|")){ rows.push(trimCells(lines[i])); i++; }
        const cell="padding:5px 9px;border-bottom:1px solid var(--line);font-size:12.5px;text-align:left;vertical-align:top";
        out.push(`<table style="border-collapse:collapse;width:100%;margin:8px 0"><thead><tr>${head.map(h=>`<th style="${cell};background:var(--line);font-weight:700">${inline(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td style="${cell}">${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        continue; }
      if(/^\s*([-*]|\d+\.)\s+/.test(line)){
        const ordered=/^\s*\d+\./.test(line); const items=[];
        while(i<lines.length&&/^\s*([-*]|\d+\.)\s+/.test(lines[i])){ items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/,"")); i++; }
        out.push(`<${ordered?"ol":"ul"} style="margin:6px 0 6px 20px">${items.map(it=>`<li style="margin-bottom:3px">${inline(it)}</li>`).join("")}</${ordered?"ol":"ul"}>`);
        continue; }
      if(/^\s*>\s?/.test(line)){ const q=[]; while(i<lines.length&&/^\s*>\s?/.test(lines[i])){ q.push(lines[i].replace(/^\s*>\s?/,"")); i++; }
        out.push(`<blockquote style="margin:8px 0;padding:6px 12px;border-left:3px solid var(--green,#0e9f5a);color:var(--muted)">${q.map(inline).join("<br>")}</blockquote>`); continue; }
      if(/^```/.test(line)){ const code=[]; i++; while(i<lines.length&&!/^```/.test(lines[i])){ code.push(lines[i]); i++; } i++;
        out.push(`<pre class="mono" style="background:var(--line);padding:10px;border-radius:8px;font-size:11.5px;overflow:auto">${FX().esc(code.join("\n"))}</pre>`); continue; }
      if(/^\s*(---|\*\*\*)\s*$/.test(line)){ out.push(`<hr style="border:0;border-top:1px solid var(--line);margin:12px 0">`); i++; continue; }
      if(line.trim()===""){ i++; continue; }
      out.push(`<p style="margin:6px 0;font-size:13.5px;line-height:1.55">${inline(line)}</p>`); i++;
    }
    return out.join("");
  }
  window.FIXED_MD=md;   // shared by other Fixed pages if they need it

  /* ---- render ---- */
  async function render(host, fx){
    const {esc}=fx;
    host.innerHTML=`<div style="padding:24px;text-align:center;color:var(--muted)">${window.salamLoader?window.salamLoader("Loading playbook…"):"Loading…"}</div>`;
    let docs, c;
    try{ [docs,c]=await Promise.all([fx.api("/api/fixed/playbook/list"), caps()]); }
    catch(e){ host.innerHTML=`<div class="albanner" style="border-left:4px solid #dc2626;padding:14px 16px"><b>Playbook unavailable</b> — ${esc(e.message)}</div>`; return; }
    const canEdit=!!c.editRules;
    const list=docs.docs||[];
    const q=new URLSearchParams((location.hash.split("?")[1]||""));
    if(!st.slug||!list.some(d=>d.slug===st.slug)){ const want=q.get("doc"); st.slug=(want&&list.some(d=>d.slug===want))?want:(list[0]?list[0].slug:null); }
    const grouped={}; for(const d of list) (grouped[d.kind]=grouped[d.kind]||[]).push(d);
    const left=KIND_ORDER.concat(Object.keys(grouped).filter(k=>!KIND_ORDER.includes(k))).filter(k=>grouped[k]&&grouped[k].length).map(k=>`<div style="margin-bottom:10px">
        <div class="rl" style="font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);margin:4px 0 4px 6px;font-weight:800">${esc(KIND_LABEL[k]||k)}</div>
        ${grouped[k].map(d=>`<button class="fp-doc" data-s="${esc(d.slug)}" style="display:block;width:100%;text-align:left;padding:6px 8px;border-radius:6px;border:none;cursor:pointer;font:inherit;font-size:12.5px;margin-bottom:2px;background:${st.slug===d.slug?"var(--green,#0e9f5a)":"transparent"};color:${st.slug===d.slug?"#fff":"inherit"}">${esc(d.title)}${d.overridden?` <span title="edited in the unified console" style="font-size:9px;opacity:.8">●</span>`:""}</button>`).join("")}</div>`).join("");
    host.innerHTML=`<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="margin:0;font-size:15px">Operational playbook</h3>
        <span class="rl" style="font-size:11px;color:var(--muted)">SLA / OLA and per-alert action plans for Sales Ops &amp; Digital Ops · read from the Operations Console (ops_docs) · ${canEdit?"edits are saved as unified-console overrides":"editing requires the Edit-rules capability"}</span>
        ${canEdit?`<button id="fpNew" class="btn" style="margin-left:auto;font-size:11.5px;padding:5px 12px">+ New document</button>`:""}</div>
      <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
        <div class="topo-card" style="flex:0 0 250px;padding:10px;max-height:75vh;overflow:auto">${left||`<div style="color:var(--muted);font-size:12px;padding:8px">no documents</div>`}</div>
        <div id="fpDoc" class="topo-card" style="flex:1 1 480px;min-width:320px;padding:18px"></div></div>`;
    host.querySelectorAll(".fp-doc").forEach(b=>b.onclick=()=>{ st.slug=b.dataset.s; st.edit=null; render(host,fx); });
    const nb=host.querySelector("#fpNew"); if(nb) nb.onclick=()=>{ st.edit={ kind:"PLAYBOOK", title:"", body:"# New document\n\n", relatedRuleKey:null }; drawDoc(host,fx,canEdit); };
    await drawDoc(host,fx,canEdit);
  }

  async function drawDoc(host,fx,canEdit){
    const el=host.querySelector("#fpDoc"); if(!el) return; const {esc}=fx;
    if(st.edit){
      const e=st.edit;
      el.innerHTML=`<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
          <select id="fpKind" style="font:inherit;font-size:12px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">${["PLAYBOOK","SLA","OLA","ACTION_PLAN"].map(k=>`<option value="${k}" ${e.kind===k?"selected":""}>${esc(KIND_LABEL[k])}</option>`).join("")}</select>
          <input id="fpTitle" value="${esc(e.title)}" placeholder="Document title" style="flex:1;min-width:220px;font:inherit;font-size:14px;font-weight:700;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">
          <input id="fpRule" value="${esc(e.relatedRuleKey||"")}" placeholder="related rule key (optional)" class="mono" style="flex:0 0 200px;font-size:11.5px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit"></div>
        <textarea id="fpBody" rows="22" placeholder="Markdown — # headings, | tables |, - lists, **bold**, [links](https://…)" class="mono" style="width:100%;box-sizing:border-box;font-size:12px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">${esc(e.body)}</textarea>
        <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;align-items:center"><span id="fpErr" style="color:#dc2626;font-size:12px;margin-right:auto"></span>
          <button id="fpCancel" class="btn" style="font-size:11.5px">Cancel</button><button id="fpSave" class="btn" style="font-size:11.5px;background:var(--green,#0e9f5a);color:#fff;border-color:var(--green,#0e9f5a)">${st.saving?"Saving…":"Save"}</button></div>`;
      el.querySelector("#fpCancel").onclick=()=>{ st.edit=null; drawDoc(host,fx,canEdit); };
      el.querySelector("#fpSave").onclick=async()=>{
        if(st.saving) return;
        const body={ slug:e.slug, kind:el.querySelector("#fpKind").value, title:el.querySelector("#fpTitle").value.trim(), body:el.querySelector("#fpBody").value, relatedRuleKey:el.querySelector("#fpRule").value.trim()||null };
        if(body.title.length<2){ el.querySelector("#fpErr").textContent="title required"; return; }
        st.saving=true; el.querySelector("#fpSave").textContent="Saving…";
        try{
          const r=await fetch((window.API_BASE||window.CONSOLE_BASE||"")+"/api/fixed/playbook/doc",{method:"POST",headers:{"Content-Type":"application/json","X-Console-Role":localStorage.getItem("cons_role")||"","X-Console-User":localStorage.getItem("cons_email")||""},body:JSON.stringify(body)});
          const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||("HTTP "+r.status));
          st.slug=j.slug; st.edit=null; st.saving=false; if(window.toast) window.toast("Document saved"); render(host,fx);
        }catch(err){ st.saving=false; el.querySelector("#fpSave").textContent="Save"; el.querySelector("#fpErr").textContent=err.message; }
      };
      return;
    }
    if(!st.slug){ el.innerHTML=`<span style="color:var(--muted);font-size:12.5px">Select a document${canEdit?", or create a new one":""}.</span>`; return; }
    el.innerHTML=`<span style="color:var(--muted);font-size:12px">Loading…</span>`;
    let d; try{ d=await fx.api("/api/fixed/playbook/doc?slug="+encodeURIComponent(st.slug)); }
    catch(e){ el.innerHTML=`<span style="color:#dc2626;font-size:12px">${esc(e.message)}</span>`; return; }
    el.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <div class="rl" style="font-size:11px;color:var(--muted)">Updated ${esc(fmtKsa(d.updated_at))}${d.updated_by?` by ${esc(d.updated_by)}`:""}${d.builtin?" · seeded":""}${d.overridden?" · edited here (override)":""}${d.related_rule_key?` · rule <span class="mono">${esc(d.related_rule_key)}</span>`:""}</div>
        ${canEdit?`<button id="fpEdit" class="btn" style="font-size:11.5px;padding:4px 12px">Edit</button>`:""}</div>
      <div id="fpMd">${md(d.body)}</div>`;
    const eb=el.querySelector("#fpEdit"); if(eb) eb.onclick=()=>{ st.edit={ slug:d.slug, kind:d.kind, title:d.title, body:d.body||"", relatedRuleKey:d.related_rule_key }; drawDoc(host,fx,canEdit); };
  }

  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.playbook={ label:"Playbook", sub:"SLA / OLA / action plans", render:(host,fx)=>render(host,fx||FX()) };
})();
