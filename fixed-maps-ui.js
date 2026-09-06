/* fixed-maps-ui.js — shared look & feel for the Fixed map pages (SDA map · QR codes) and the order-trace modal.
 * One injected stylesheet (deploy.sh ships only .js/.html, so CSS lives here) + tiny helpers used by fixed-map.js
 * and fixed-qr.js: skeleton loaders, outcome pills, the recent-orders list, modal open/close with Esc.
 * Design: one accent per page (--fxa: green for dealers, violet for QR), chips with press/hover motion, KPI tiles
 * with an accent bar, timeline stepper in the trace, glass overlays on the map, dark-mode through the console vars. */
(function(){
  "use strict";
  const CSS=`
  /* ---- tokens ---- */
  #fxm{--fxa:#0e9f5a;--fxa-soft:rgba(14,159,90,.12)} #fxq{--fxa:#7c3aed;--fxa-soft:rgba(124,58,237,.12)}
  #fxm .fxchip.blue,#fxq .fxchip.blue{--fxa:#2563eb;--fxa-soft:rgba(37,99,235,.12)}
  [data-theme="dark"] #fxm{--fxa:#10b981} 
  #fxm,#fxq{animation:fxFade .25s ease}
  @keyframes fxFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

  /* ---- chips (filters) ---- */
  #fxm .fxchip,#fxq .fxchip{display:inline-flex;align-items:center;gap:5px;cursor:pointer;font:inherit;font-size:11px;font-weight:600;line-height:1.2;padding:5px 11px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink);position:relative;transition:transform .16s cubic-bezier(.2,.8,.2,1),box-shadow .16s,border-color .16s,background .16s,color .16s;user-select:none;white-space:nowrap}
  #fxm .fxchip:hover,#fxq .fxchip:hover{border-color:var(--fxa);color:var(--fxa);background:var(--fxa-soft);transform:translateY(-1px);box-shadow:0 4px 12px rgba(2,6,23,.08)}
  #fxm .fxchip:active,#fxq .fxchip:active{transform:translateY(0) scale(.96);box-shadow:none}
  #fxm .fxchip:focus-visible,#fxq .fxchip:focus-visible{outline:2px solid var(--fxa);outline-offset:2px}
  #fxm .fxchip.on,#fxq .fxchip.on{background:linear-gradient(135deg,var(--fxa),color-mix(in srgb,var(--fxa) 72%,#0b1220));border-color:transparent;color:#fff;box-shadow:0 4px 14px color-mix(in srgb,var(--fxa) 38%,transparent)}
  #fxm .fxchip.on:hover,#fxq .fxchip.on:hover{color:#fff;filter:brightness(1.06)}
  #fxm .fxchip.on::before,#fxq .fxchip.on::before{content:"✓";font-size:9.5px;font-weight:800;opacity:.95}
  #fxm .fxchip.on[data-mode]::before,#fxq .fxchip.on[data-mode]::before{content:"●";font-size:7px}
  #fxm .fxchip.ghost,#fxq .fxchip.ghost{border-style:dashed;color:var(--muted)}

  /* ---- sidebar groups ---- */
  #fxm h4,#fxq h4{margin:0 0 7px;font-size:10px;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;display:flex;align-items:center;gap:6px}
  #fxm h4::before,#fxq h4::before{content:"";width:3px;height:10px;border-radius:2px;background:var(--fxa);flex:none}
  #fxm .grp,#fxq .grp{display:flex;flex-direction:column;gap:3px;padding:10px 0 0;border-top:1px dashed var(--line-soft,var(--line))}
  #fxm .grp:first-of-type,#fxq .grp:first-of-type{border-top:0;padding-top:0}
  #fxm .chips,#fxq .chips{display:flex;gap:5px;flex-wrap:wrap}
  #fxm input,#fxq input{transition:border-color .15s,box-shadow .15s}
  #fxm input:focus,#fxq input:focus{outline:none;border-color:var(--fxa) !important;box-shadow:0 0 0 3px var(--fxa-soft)}
  #fxmQList>div:hover,#fxqQList>div:hover{background:var(--fxa-soft)}
  #fxmSide,#fxqSide,#fxmRight,#fxqRight{scrollbar-width:thin}

  /* ---- KPI tiles ---- */
  #fxm .kpi,#fxq .kpi{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:12px;padding:9px 11px 8px;background:linear-gradient(180deg,var(--card,#fff),var(--card2,#f8fafc));transition:transform .18s cubic-bezier(.2,.8,.2,1),box-shadow .18s,border-color .18s}
  #fxm .kpi::after,#fxq .kpi::after{content:"";position:absolute;left:0;top:0;height:3px;width:100%;background:linear-gradient(90deg,var(--fxa),transparent);opacity:.75}
  #fxm .kpi:hover,#fxq .kpi:hover{transform:translateY(-2px);box-shadow:0 10px 22px rgba(2,6,23,.10);border-color:color-mix(in srgb,var(--fxa) 40%,var(--line))}
  #fxm .kpi b,#fxq .kpi b{font-size:20px;letter-spacing:-.3px;display:block;font-variant-numeric:tabular-nums;line-height:1.15}
  #fxm .kpi span,#fxq .kpi span{font-size:9.5px;color:var(--muted);letter-spacing:.7px;text-transform:uppercase;font-weight:700}
  #fxm .kpi .vs,#fxq .kpi .vs{text-transform:none;letter-spacing:0}

  /* ---- right panel tables ---- */
  #fxm table.mono,#fxq table.mono{font-size:11.5px}
  #fxm th.sortable,#fxq th.sortable{cursor:pointer;user-select:none;transition:color .15s}
  #fxm th.sortable:hover,#fxq th.sortable:hover{color:var(--fxa) !important}
  #fxm tr.rowc,#fxq tr.rowc{cursor:pointer;transition:background .12s}
  #fxm tr.rowc td,#fxq tr.rowc td{transition:background .12s,box-shadow .12s}
  #fxm tr.rowc:hover td,#fxq tr.rowc:hover td{background:var(--fxa-soft)}
  #fxm tr.rowc td:first-child,#fxq tr.rowc td:first-child{box-shadow:inset 3px 0 0 transparent}
  #fxm tr.rowc:hover td:first-child,#fxq tr.rowc:hover td:first-child{box-shadow:inset 3px 0 0 var(--fxa)}
  #fxm .vs,#fxq .vs{font-size:10px;font-weight:700;margin-left:4px}

  /* ---- recent orders list (replaces the raw table) ---- */
  .fxlist{display:flex;flex-direction:column;gap:4px}
  .fxrow{display:grid;grid-template-columns:22px 62px minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 9px;border:1px solid var(--line);border-radius:10px;background:var(--card,#fff);cursor:pointer;transition:transform .15s cubic-bezier(.2,.8,.2,1),box-shadow .15s,border-color .15s;position:relative}
  .fxrow:hover{transform:translateX(3px);border-color:var(--fxa);box-shadow:0 6px 16px rgba(2,6,23,.09)}
  .fxrow:active{transform:translateX(3px) scale(.99)}
  .fxrow .n{font-size:10px;color:var(--muted);font-weight:700;text-align:center;width:18px;height:18px;border-radius:50%;background:var(--card2,#f1f5f9);display:inline-flex;align-items:center;justify-content:center}
  .fxrow .t{font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
  .fxrow .m{min-width:0;display:flex;flex-direction:column;gap:2px}
  .fxrow .m .l1{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px}
  .fxrow .m .l2{font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fxrow .go{color:var(--muted);font-size:14px;opacity:0;transform:translateX(-4px);transition:opacity .15s,transform .15s}
  .fxrow:hover .go{opacity:1;transform:none;color:var(--fxa)}
  .fxo{display:inline-flex;align-items:center;gap:4px;font-size:9.5px;font-weight:800;letter-spacing:.4px;padding:2px 7px;border-radius:999px;color:var(--oc,#64748b);background:color-mix(in srgb,var(--oc,#64748b) 14%,transparent);border:1px solid color-mix(in srgb,var(--oc,#64748b) 35%,transparent);white-space:nowrap}
  .fxo::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--oc,#64748b)}
  .fxo.live::before{animation:fxPulse 1.4s infinite}
  @keyframes fxPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--oc) 55%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
  .fxtag{font-size:9.5px;padding:1px 7px;border-radius:999px;background:var(--card2,#f1f5f9);border:1px solid var(--line);color:var(--muted)}
  .fxtag.err{color:var(--bad-fg);border-color:rgba(220,38,38,.35);background:rgba(220,38,38,.08)}

  /* ---- map overlays ---- */
  #fxmLegend,#fxqLegend{background:color-mix(in srgb,var(--card,#fff) 84%,transparent) !important;backdrop-filter:blur(10px) saturate(1.2);-webkit-backdrop-filter:blur(10px) saturate(1.2);border-radius:12px !important;box-shadow:0 8px 24px rgba(2,6,23,.16) !important;padding:8px 12px !important;gap:12px !important;font-weight:600}
  #fxmMapNote,#fxqMapNote{background:color-mix(in srgb,var(--card,#fff) 84%,transparent) !important;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:999px !important;padding:5px 12px !important;box-shadow:0 6px 18px rgba(2,6,23,.14);font-weight:600}
  .fxm-legend-dot,.fxq-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px;box-shadow:0 0 0 2px color-mix(in srgb,var(--card,#fff) 90%,transparent),0 0 0 3px rgba(2,6,23,.08)}
  #fxmMapWrap,#fxqMapWrap{box-shadow:inset 0 0 0 1px var(--line),0 1px 3px rgba(2,6,23,.06)}
  .fx-ksa-btn{margin:0 10px 24px 0;background:var(--card,#fff);border:1px solid var(--line);border-radius:999px;box-shadow:0 4px 12px rgba(2,6,23,.18);padding:7px 13px;font:700 11.5px/1 inherit;cursor:pointer;color:var(--ink,#333);transition:transform .15s,box-shadow .15s}
  .fx-ksa-btn:hover{transform:translateY(-1px);box-shadow:0 8px 18px rgba(2,6,23,.22)}

  /* ---- skeleton loader ---- */
  .fxskel{display:flex;flex-direction:column;gap:8px;padding:6px 2px}
  .fxskel i{display:block;height:12px;border-radius:6px;background:linear-gradient(90deg,var(--line-soft,#eef2f6) 25%,var(--line,#e2e8f0) 37%,var(--line-soft,#eef2f6) 63%);background-size:400% 100%;animation:fxShimmer 1.3s ease infinite}
  @keyframes fxShimmer{0%{background-position:100% 0}100%{background-position:0 0}}

  /* ---- buttons (modal + panels) ---- */
  .fxbtn{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:10px;font:inherit;font-size:11.5px;font-weight:700;border:1px solid var(--line);background:var(--card,#fff);color:var(--ink);cursor:pointer;transition:transform .15s cubic-bezier(.2,.8,.2,1),box-shadow .15s,background .15s,border-color .15s,color .15s;white-space:nowrap}
  .fxbtn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(2,6,23,.10);border-color:var(--green,#0e9f5a);color:var(--green,#0e9f5a)}
  .fxbtn:active{transform:translateY(0) scale(.97);box-shadow:none}
  .fxbtn:focus-visible{outline:2px solid var(--green,#0e9f5a);outline-offset:2px}
  .fxbtn.primary{background:linear-gradient(135deg,var(--green,#0e9f5a),var(--green-dark,#0a7a45));color:#fff;border-color:transparent}
  .fxbtn.primary:hover{color:#fff;filter:brightness(1.06)}
  .fxbtn.warn{color:var(--warn-fg);border-color:rgba(217,119,6,.45);background:rgba(217,119,6,.08)}
  .fxbtn.warn:hover{background:#d97706;color:#fff;border-color:#d97706}
  .fxbtn.icon{width:34px;height:34px;padding:0;justify-content:center;border-radius:50%;font-size:14px}
  .fxbtn.icon:hover{border-color:#dc2626;color:#dc2626;background:rgba(220,38,38,.08)}
  .fxbtn.back{padding:6px 10px;border-radius:999px}

  /* ---- trace modal ---- */
  #fxmModal{backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);background:rgba(15,23,42,.45)}
  #fxmModal .fxt{background:var(--card,#fff);border:1px solid var(--line);border-radius:18px;width:min(1120px,96vw);max-height:92vh;overflow:auto;padding:0;box-shadow:0 30px 80px rgba(2,6,23,.35);animation:fxtIn .22s cubic-bezier(.2,.8,.2,1);scrollbar-width:thin}
  @keyframes fxtIn{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
  .fxt-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 18px;background:color-mix(in srgb,var(--card,#fff) 92%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  .fxt-head::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--oc,var(--green))}
  .fxt-title{font-size:15px;font-weight:800;letter-spacing:-.2px}
  .fxt-id{font-size:11px;color:var(--muted);padding:2px 8px;border-radius:6px;background:var(--card2,#f1f5f9)}
  .fxt-body{padding:14px 18px 18px}
  .fxt-note{border-left:4px solid #d97706;background:rgba(217,119,6,.08);padding:8px 12px;font-size:11.5px;border-radius:0 10px 10px 0;margin-bottom:12px}
  .fxt-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:14px}
  .fxt-fact{background:var(--card2,#f8fafc);border:1px solid var(--line-soft,var(--line));border-radius:10px;padding:7px 10px;min-width:0;transition:border-color .15s,transform .15s}
  .fxt-fact:hover{border-color:var(--line);transform:translateY(-1px)}
  .fxt-fact span{display:block;font-size:9px;color:var(--muted);letter-spacing:.7px;text-transform:uppercase;font-weight:700;margin-bottom:2px}
  .fxt-fact div{font-size:11.5px;font-weight:600;word-break:break-word;font-variant-numeric:tabular-nums}
  .fxt-cols{display:grid;grid-template-columns:280px minmax(0,1fr);gap:18px}
  @media (max-width:820px){.fxt-cols{grid-template-columns:1fr}}
  /* ---- responsive (6 Sep 2026): tablet = list on top, map + detail side by side; phone = one column, map keeps a real height ---- */
  @media (max-width:1180px){
    #fxm,#fxq{grid-template-columns:minmax(0,1fr) 320px !important;grid-template-rows:auto minmax(0,1fr);height:auto !important;min-height:0 !important}
    #fxmSide,#fxqSide{grid-column:1/-1;flex-direction:row !important;flex-wrap:wrap;align-items:flex-start;gap:10px 16px !important;max-height:none}
    #fxmSide>*,#fxqSide>*{flex:1 1 220px;min-width:0}
    #fxmSide .grp,#fxqSide .grp{margin:0}
    #fxmMapWrap,#fxqMapWrap{height:min(64vh,620px);min-height:380px !important}
    #fxmRight,#fxqRight{max-height:min(64vh,620px)}
  }
  @media (max-width:700px){
    #fxm,#fxq{grid-template-columns:1fr !important;grid-template-rows:auto;gap:10px}
    #fxmSide,#fxqSide{flex-direction:column !important;gap:10px !important} #fxmSide>*,#fxqSide>*{flex:0 0 auto;width:100%}
    #fxmMapWrap,#fxqMapWrap{height:56vh;min-height:320px !important;border-radius:14px}
    #fxmRight,#fxqRight{max-height:none;min-height:200px}
    #fxmLegend,#fxqLegend{left:8px;right:8px;bottom:8px;font-size:10px;gap:6px 8px}
    #fxmMapNote,#fxqMapNote{right:8px;top:8px;max-width:calc(100% - 16px);white-space:normal}
    #fxmModal{align-items:flex-end;padding:0}
    #fxmModal .fxt{width:100%;max-width:100%;max-height:calc(100dvh - 20px);border-radius:20px 20px 0 0;border-bottom:0;padding-bottom:env(safe-area-inset-bottom,0px)}
    .fxt-body{padding:12px 12px 16px}
    .fxbtn,.fxchip{min-height:34px}
  }
  .fxt h4{margin:0 0 8px;font-size:10px;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;display:flex;align-items:center;gap:6px}
  .fxt h4::before{content:"";width:3px;height:10px;border-radius:2px;background:var(--oc,var(--green));flex:none}
  .fxt-steps{position:relative;padding-left:2px}
  .fxt-step{position:relative;padding:5px 0 7px 32px;font-size:11.5px}
  .fxt-step::before{content:"";position:absolute;left:10px;top:0;bottom:0;width:2px;background:var(--line)}
  .fxt-step:first-child::before{top:14px} .fxt-step:last-child::before{bottom:calc(100% - 14px)}
  .fxt-dot{position:absolute;left:1px;top:5px;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:9.5px;font-weight:800;background:var(--sc,#94a3b8);box-shadow:0 0 0 3px var(--card,#fff)}
  .fxt-step.skip .fxt-dot{background:var(--card2,#f1f5f9);color:var(--muted);border:1px solid var(--line)}
  .fxt-step.cur .fxt-dot{animation:fxtRing 1.6s infinite}
  @keyframes fxtRing{0%{box-shadow:0 0 0 3px var(--card,#fff),0 0 0 3px color-mix(in srgb,var(--sc) 60%,transparent)}70%{box-shadow:0 0 0 3px var(--card,#fff),0 0 0 10px transparent}100%{box-shadow:0 0 0 3px var(--card,#fff),0 0 0 3px transparent}}
  .fxt-step b{display:block;font-weight:700} .fxt-step.skip b{color:var(--muted);font-weight:500}
  .fxt-step .d{font-size:10.5px;color:var(--muted);word-break:break-word;margin-top:1px}
  .fxt-calls{border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .fxt-call{border-top:1px solid var(--line-soft,var(--line))} .fxt-call:first-child{border-top:0}
  .fxt-call summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:24px 70px 52px minmax(0,1fr) 54px 64px;gap:8px;align-items:center;padding:7px 10px;font-size:11.5px;transition:background .12s}
  .fxt-call summary::-webkit-details-marker{display:none}
  .fxt-call summary:hover{background:var(--fxa-soft,rgba(14,159,90,.08))}
  .fxt-call[open] summary{background:var(--card2,#f8fafc)}
  .fxt-call .i{color:var(--muted);font-size:10px;font-weight:700} .fxt-call .tm{color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums}
  .fxt-call .me{font-weight:800;font-size:10.5px;letter-spacing:.3px} .fxt-call .ep{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
  .fxt-call .ms{color:var(--muted);font-size:10.5px;text-align:right;font-variant-numeric:tabular-nums}
  .fxt-st{justify-self:start;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;color:var(--oc);background:color-mix(in srgb,var(--oc) 14%,transparent);border:1px solid color-mix(in srgb,var(--oc) 35%,transparent)}
  .fxt-call .err{font-size:11px;color:var(--bad-fg);margin:4px 10px 4px 42px} .fxt-call .info{font-size:11px;color:var(--muted);margin:2px 10px 4px 42px}
  .fxt-io{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:4px 10px 10px 42px} @media (max-width:820px){.fxt-io{grid-template-columns:1fr;margin-left:10px}}
  .fxt-io span{display:block;font-size:9px;color:var(--muted);letter-spacing:.7px;text-transform:uppercase;font-weight:700;margin-bottom:3px}
  .fxt-io pre{margin:0;font-size:10.5px;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;background:var(--card2,#f8fafc);border:1px solid var(--line-soft,var(--line));padding:8px;border-radius:8px}
  .fxt-raw{font-size:10.5px;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.25);padding:10px;border-radius:10px}
  .fxt-empty{font-size:11.5px;color:var(--muted);padding:10px;border:1px dashed var(--line);border-radius:10px;text-align:center}
  .fxt details.sd summary{font-size:11px;cursor:pointer;color:var(--muted)} .fxt details.sd pre{font-size:10.5px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;background:var(--card2);padding:8px;border-radius:8px;border:1px solid var(--line-soft,var(--line))}

  @media (max-width:1100px){ #fxm,#fxq{grid-template-columns:1fr !important;height:auto !important} #fxmMapWrap,#fxqMapWrap{height:460px} }
  `;
  if(!document.getElementById("fxMapsCss")){ const st=document.createElement("style"); st.id="fxMapsCss"; st.textContent=CSS; document.head.appendChild(st); }

  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const OUT={COMPLETED:"#3fb950",STALLED:"#d29922",CANCELLED:"#f85149",EXPIRED:"#6e7681",IN_PROGRESS:"#4d8af0",lead:"#a371f7"};
  const OUT_LABEL={COMPLETED:"Completed",STALLED:"Stalled",CANCELLED:"Cancelled",EXPIRED:"Expired",IN_PROGRESS:"In progress"};
  const skeleton=(n=6)=>`<div class="fxskel">${Array.from({length:n},(_,i)=>`<i style="width:${[92,70,84,60,78,66][i%6]}%"></i>`).join("")}</div>`;
  const outcomePill=(o,color)=>{ const k=String(o||"").toUpperCase(); return `<span class="fxo${k==="IN_PROGRESS"?" live":""}" style="--oc:${color||OUT[k]||"#64748b"}">${esc(OUT_LABEL[k]||o||"—")}</span>`; };
  /* rows: [{id,idx,time,outcome,color,tags:[{t,err}],line2,ref}] → clickable list; caller binds [data-att] */
  const orderList=(rows,empty)=>rows.length?`<div class="fxlist">${rows.map(r=>`<div class="fxrow" data-att="${esc(r.id)}" title="Open the order trace"><span class="n">${r.idx}</span><span class="t">${esc(r.time)}</span>
      <div class="m"><div class="l1">${outcomePill(r.outcome,r.color)}${(r.tags||[]).map(t=>`<span class="fxtag${t.err?" err":""}">${esc(t.t)}</span>`).join("")}${r.ref?`<span class="mono" style="font-size:10.5px;font-weight:600">${esc(r.ref)}</span>`:""}</div>${r.line2?`<div class="l2">${esc(r.line2)}</div>`:""}</div><span class="go">›</span></div>`).join("")}</div>`
    :`<div class="fxt-empty">${esc(empty||"none in this window")}</div>`;
  const closeModal=ov=>{ ov.classList.remove("open"); document.removeEventListener("keydown",ov.__esc); };
  const armModal=ov=>{ if(ov.__esc) document.removeEventListener("keydown",ov.__esc); ov.__esc=e=>{ if(e.key==="Escape") closeModal(ov); }; document.addEventListener("keydown",ov.__esc); };
  window.FXUI={skeleton,outcomePill,orderList,armModal,closeModal,OUT,OUT_LABEL};
})();
