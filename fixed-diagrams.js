/* fixed-diagrams.js — Fixed › Diagrams: the four payments / journeys reference pages from the prod Operations
 * Console (apps/web/public/playbook/*.html, copied verbatim into fixed-diagrams/). Port of apps/web/src/app/diagrams/page.tsx:
 * gallery of 4 cards in reading order → the chosen page opens in an iframe panel below (theme passed as ?theme=),
 * with "Open in new tab". List comes from /api/fixed/diagrams/list. */
(function(){
  "use strict";
  const FX=()=>window.FX;
  const st={ slug:null };
  const base=()=>(window.API_BASE||window.CONSOLE_BASE||"");
  const theme=()=>{ const t=document.documentElement.dataset.theme||document.body.dataset.theme||""; if(t) return t==="light"?"light":"dark";
    try{ return window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"; }catch(e){ return "light"; } };

  async function render(host, fx){
    const {esc}=fx;
    host.innerHTML=`<div style="padding:24px;text-align:center;color:var(--muted)">Loading diagrams…</div>`;
    let list; try{ list=(await fx.api("/api/fixed/diagrams/list")).diagrams||[]; }
    catch(e){ host.innerHTML=`<div class="albanner" style="border-left:4px solid #dc2626;padding:14px 16px"><b>Diagrams unavailable</b> — ${esc(e.message)}</div>`; return; }
    list.sort((a,b)=>(a.order||99)-(b.order||99));
    const q=new URLSearchParams((location.hash.split("?")[1]||"")); const want=q.get("d"); if(want&&list.some(d=>d.slug===want)) st.slug=want;
    const active=list.find(d=>d.slug===st.slug)||null;
    const url=d=>`${base()}/${d.url}?theme=${theme()}${d.slug==="diagram-journeys-explorer"&&q.get("j")?`&j=${encodeURIComponent(q.get("j"))}`:""}`;
    host.innerHTML=`<div style="margin-bottom:12px"><h3 style="margin:0 0 3px;font-size:15px">Payments architecture &amp; journeys, end to end</h3>
        <div class="rl" style="font-size:11px;color:var(--muted);max-width:760px">Interactive views of how an order becomes a paid, provisioned service. New to the platform? Read them in order — the map, then one journey, then the deep analysis, then every dealer / QR journey step by step. Same pages as /operations-console → Diagrams.</div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:14px">
        ${list.map((d,i)=>{ const on=active&&active.slug===d.slug; return `<button class="fdg-card topo-card" data-s="${esc(d.slug)}" style="text-align:left;cursor:pointer;font:inherit;padding:14px 16px;border:1px solid ${on?"var(--green,#0e9f5a)":"var(--line)"};box-shadow:${on?"0 0 0 2px var(--green,#0e9f5a) inset":"none"};display:flex;flex-direction:column;gap:6px;color:inherit;background:var(--card,#fff)">
            <span style="display:flex;align-items:center;gap:8px"><span class="mono" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--green,#0e9f5a);color:#fff;font-size:11px;font-weight:800">${d.order||i+1}</span><b style="font-size:13px">${esc(d.title.replace(/\s*\(.*\)\s*$/,""))}</b></span>
            <span class="pill" style="align-self:flex-start;font-size:10px">${esc(d.tagline||"Interactive diagram")}</span>
            <small style="color:var(--muted);font-size:11.5px;line-height:1.45">${esc(d.blurb||"")}</small>
            <span style="margin-top:auto;font-size:11.5px;font-weight:700;color:var(--green,#0e9f5a)">${on?"Showing below ↓":"Open →"}</span></button>`; }).join("")}
      </div>
      <div id="fdgPanel">${active?`<div class="topo-card" style="padding:0;overflow:hidden">
          <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap">
            <b style="font-size:12.5px">${esc(active.title)}</b><span class="rl" style="font-size:10.5px;color:var(--muted)">${esc(active.tagline||"")}</span>
            <span style="margin-left:auto;display:flex;gap:6px"><a class="btn" href="${esc(url(active))}" target="_blank" rel="noreferrer" style="font-size:11px;padding:4px 10px;text-decoration:none">Open in new tab ↗</a><button id="fdgClose" class="btn" style="font-size:11px;padding:4px 10px">Close ✕</button></span></div>
          <iframe src="${esc(url(active))}" title="${esc(active.title)}" style="width:100%;height:78vh;min-height:520px;border:0;display:block;background:${theme()==="dark"?"#05070d":"#fff"}"></iframe></div>`
        :`<div class="rl" style="font-size:11px;color:var(--muted);text-align:center;padding:14px">pick a diagram above — it opens here, full width</div>`}</div>`;
    host.querySelectorAll(".fdg-card").forEach(b=>b.onclick=()=>{ st.slug=b.dataset.s; const h="fixed?tab=diagrams&d="+encodeURIComponent(st.slug); if(location.hash!=="#"+h) history.replaceState(null,"","#"+h); render(host,fx); setTimeout(()=>{ const p=host.querySelector("#fdgPanel"); if(p&&p.scrollIntoView) p.scrollIntoView({behavior:"smooth",block:"start"}); },50); });
    const c=host.querySelector("#fdgClose"); if(c) c.onclick=()=>{ st.slug=null; history.replaceState(null,"","#fixed?tab=diagrams"); render(host,fx); };
  }

  /* SOLO PAGES (11 Sep 2026) — Journeys and BSS Topology were reachable only by opening the Diagrams
   * gallery and picking a card, and when they were nav items sharing tab=diagrams all three highlighted
   * at once. They are their own Fixed pages now: same viewer, one diagram, no gallery. */
  async function solo(host, fx, slug, heading, blurb){
    const {esc}=fx;
    host.innerHTML=`<div style="padding:24px;text-align:center;color:var(--muted)">Loading…</div>`;
    let list; try{ list=(await fx.api("/api/fixed/diagrams/list")).diagrams||[]; }
    catch(e){ host.innerHTML=`<div class="albanner" style="border-left:4px solid #dc2626;padding:14px 16px"><b>Unavailable</b> — ${esc(e.message)}</div>`; return; }
    const d=list.find(x=>x.slug===slug);
    if(!d){ host.innerHTML=`<div class="albanner" style="padding:14px 16px">This page is not registered on the server yet.</div>`; return; }
    const u=`${base()}/${d.url}?theme=${theme()}`;
    host.innerHTML=`<div style="margin-bottom:12px"><h3 style="margin:0 0 3px;font-size:15px">${esc(heading)}</h3>
        <div class="rl" style="font-size:11px;color:var(--muted);max-width:820px">${esc(blurb)}</div></div>
      <div class="topo-card" style="padding:0;overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap">
          <b style="font-size:12.5px">${esc(d.title)}</b><span class="rl" style="font-size:10.5px;color:var(--muted)">${esc(d.tagline||"")}</span>
          <span style="margin-left:auto"><a class="btn" href="${esc(u)}" target="_blank" rel="noreferrer" style="font-size:11px;padding:4px 10px;text-decoration:none">Open in new tab ↗</a></span></div>
        <iframe src="${esc(u)}" title="${esc(d.title)}" style="width:100%;height:80vh;min-height:560px;border:0;display:block;background:${theme()==="dark"?"#05070d":"#fff"}"></iframe></div>`;
  }

  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.diagrams={ label:"Diagrams", sub:"payments · journeys", render:(host,fx)=>render(host,fx||FX()) };
  window.FIXED_PAGES.journeys={ label:"Journeys", sub:"dealer & QR journeys", render:(host,fx)=>solo(host, fx||FX(), "diagram-journeys-explorer",
    "Every journey, end to end", "All dealer (FTTH / FTTB / 5G / Lead) and QR (e-purchase) journeys — step through each one, success or failure, with the exact API calls and what stops the order at every step.") };
  window.FIXED_PAGES.bsstopo={ label:"BSS Topology", sub:"digital / BSS HLD", render:(host,fx)=>solo(host, fx||FX(), "diagram-fixed-bss-hld",
    "The whole Fixed estate, one map", "IMPACT B2C Release 5 and 6 view: every channel, the digital edge, the 3Scale/OSB integration hub, the Oracle BSS core and every OSS, network and external partner. Click a node for its role, servers and flows.") };
})();
