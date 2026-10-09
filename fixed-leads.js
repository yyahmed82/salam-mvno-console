/* fixed-leads.js — Fixed › Leads (OCU retention team, 9 Oct 2026). Registers window.FIXED_PAGES.leads for the Fixed hub.
 * Data: /api/fixed/leads/* (server/src/fixedLeads.js). Confidential section:
 *   - nothing loads before the member accepts today's terms (server-enforced, recorded with time, IP and device);
 *   - a restricted band, a personal watermark (e-mail · date) over the page, copy / print blocked inside the section;
 *   - names and numbers masked; "Reveal & call" shows ONE lead's contact for 90 s, audited and capped server-side.
 * Workflow: My queue · Team pool (take) · Team (supervisors: assign, spread) · Closed · Team & challenges (points,
 * leaderboard, best of last week, challenges, feed) · Batches (supervisors: import .xlsx / .csv) · Offers (the OCU
 * playbook, MSD v1.2) · Settings (supervisors). A lead opens in a drawer: journey, Salam relationship, Agent 2's coaching
 * (score, offer path, opener AR/EN, talking points, objections), outcomes, remark, comments, timeline. */
(function(){
  "use strict";
  const BASE=()=>(window.API_BASE||window.CONSOLE_BASE||"");
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const KT=()=>window.KT||null;
  const md=v=>{ if(!v) return "—"; const k=KT(); if(k&&k.md) return k.md(v); const d=new Date(new Date(v).getTime()+3*3600e3); return d.toISOString().slice(5,16).replace("T"," "); };
  const hm=v=>{ const d=new Date(new Date(v).getTime()+3*3600e3); return d.toISOString().slice(11,16); };
  const ago=v=>{ if(!v) return "—"; const s=(Date.now()-new Date(v).getTime())/1000; if(s<0){ const f=-s; return f<3600?"in "+Math.max(1,Math.round(f/60))+" min":f<86400?"in "+Math.round(f/3600)+" h":"in "+Math.round(f/86400)+" d"; }
    return s<60?"just now":s<3600?Math.round(s/60)+" min ago":s<86400?Math.round(s/3600)+" h ago":Math.round(s/86400)+" d ago"; };
  const n=v=>Number(v)||0;
  async function api(path,opts){
    const get=!opts||!opts.method||opts.method==="GET";
    const url=BASE()+path+(get?(path.includes("?")?"&":"?")+"_t="+Date.now():"");
    const r=await fetch(url,{...(opts||{}),headers:{"Content-Type":"application/json",...((opts&&opts.headers)||{})}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){ const e=new Error(j.error||("HTTP "+r.status)); e.status=r.status; e.code=j.code; throw e; }
    return j;
  }
  const post=(p,b)=>api(p,{method:"POST",body:JSON.stringify(b||{})});
  const I={
    shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>',
    lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    eye:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    spark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
    trophy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/></svg>',
    flame:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.8 1.2 3 2.5 3.5C11 9 11 5 12 2z"/></svg>',
    clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>',
    upload:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    tag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H3V10zM7 10l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.6a2 2 0 0 1 2 2.3l-1.3 8A2 2 0 0 1 17.8 21H7"/></svg>',
    down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3h4v11zM17 14l-4 8a2.5 2.5 0 0 1-2.5-2.5V15H4.9a2 2 0 0 1-2-2.3l1.3-8A2 2 0 0 1 6.2 3H17"/></svg>',
    info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    mail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    filter:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>',
    /* products (alpha.168): fiber · 5G, and the type of line — FTTH home, FTTB building, 5G HomeFi router, 5G FWA antenna */
    fiber:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3.5 0 4.5-10 9-10s5.5 10 9 10"/><circle cx="3" cy="17" r="1.2" fill="currentColor"/><circle cx="21" cy="17" r="1.2" fill="currentColor"/></svg>',
    g5:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 20v-3M9.7 20v-6.5M14.3 20V10M19 20V6"/></svg>',
    home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5L12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/></svg>',
    bldg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h1.5M13.5 7H15M9 11h1.5M13.5 11H15M9 15h1.5M13.5 15H15M11 21v-3h2v3"/></svg>',
    router:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01M10.5 16.5h.01"/><path d="M8.6 9.6a4.8 4.8 0 0 1 6.8 0M6.2 7.2a8.2 8.2 0 0 1 11.6 0"/></svg>',
    tower:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="1.8"/><path d="M12 11v10M8.5 21h7"/><path d="M8.2 5.6a5 5 0 0 0 0 6.8M15.8 5.6a5 5 0 0 1 0 6.8M5.5 3a8.8 8.8 0 0 0 0 12M18.5 3a8.8 8.8 0 0 1 0 12"/></svg>',
  };
  const SVC_ICON={ ftth:"home", fttb:"bldg", "5g_homefi":"router", "5g_fwa":"tower", "5g":"g5" };
  const PRODUCT={ ftth:"Fiber", "5g":"5G" };
  const RES_GROUPS=[["Could not reach",["no_answer","busy","wrong_number"]],["Talked to the customer",["callback","interested","offer_made","won","not_interested","ordered_elsewhere","dnc"]]];
  const S={ host:null, gate:null, meta:null, tab:"mine", list:null, board:null, sel:new Set(), filters:{ product:"", svc:"", plan:"", ptype:"", source:"", reason:"", temp:"", q:"", assignee:"" },
    sort:{ col:"smart", dir:"desc" }, page:0, size:100, seq:0, facets:null, open:null, revealT:null, loading:false, batch:null,
    shown:new Map(), unmaskUntil:0, unmaskUsed:0, unmaskPerDay:null, tick:null };

  /* ---------------------------------------------------------------- styles */
  function css(){
    if(document.getElementById("ldCss")) return;
    const st=document.createElement("style"); st.id="ldCss";
    st.textContent=`
.ld{position:relative;--ld-red:#b91c1c;--ld-red2:#7f1d1d;--ld-hot:#dc2626;--ld-warm:#d97706;--ld-cold:#64748b;--ld-gold:#d4a017;-webkit-user-select:none;user-select:none}
.ld input,.ld textarea,.ld select,.ld [contenteditable]{-webkit-user-select:text;user-select:text}
.ld *{box-sizing:border-box}
:where(.ld,.ld-dr,.ld-toast,.ld-mb) svg{width:15px;height:15px;flex:none}
.ld-call .tm svg{width:13px;height:13px}
.ld-band{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 16px;border-radius:14px;margin:2px 0 14px;color:#fee2e2;background:linear-gradient(100deg,#3b0a0a 0%,#7f1d1d 45%,#991b1b 100%);box-shadow:0 10px 30px rgba(127,29,29,.25)}
.ld-band .dot{width:10px;height:10px;border-radius:50%;background:#f87171;box-shadow:0 0 0 0 rgba(248,113,113,.7);animation:ldPulse 1.8s infinite;flex:none}
@keyframes ldPulse{0%{box-shadow:0 0 0 0 rgba(248,113,113,.7)}70%{box-shadow:0 0 0 10px rgba(248,113,113,0)}100%{box-shadow:0 0 0 0 rgba(248,113,113,0)}}
.ld-band b{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:#fff}
.ld-band .msg{font-size:12.5px;opacity:.92;flex:1;min-width:240px}
.ld-band .who{font-size:11.5px;opacity:.85;white-space:nowrap;display:flex;gap:10px;align-items:center}
.ld-band .who span{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);padding:3px 9px;border-radius:999px}
.ld-wm{position:fixed;left:0;right:0;bottom:0;top:var(--hdr,64px);pointer-events:none;z-index:4;opacity:.055;background-repeat:repeat}
[data-theme="dark"] .ld-wm{opacity:.07;filter:invert(1)}
@media print{ body *{visibility:hidden!important} body::before{content:"Restricted — Fixed › Leads cannot be printed";visibility:visible;display:block;padding:40px;font:700 20px Arial} }
/* gate */
.ld-gate{max-width:720px;margin:24px auto 60px;border-radius:20px;overflow:hidden;background:var(--card);border:1px solid var(--line);box-shadow:0 30px 80px rgba(15,23,42,.18)}
.ld-gate .hd{padding:26px 28px 22px;color:#fff;background:radial-gradient(120% 140% at 0% 0%,#991b1b 0%,#450a0a 60%,#1c0505 100%);position:relative}
.ld-gate .hd .ic{width:52px;height:52px;border-radius:16px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.ld-gate .hd .ic svg{width:28px;height:28px}
.ld-gate .hd .k{font-size:11px;letter-spacing:.2em;font-weight:800;text-transform:uppercase;color:#fecaca;display:flex;align-items:center;gap:8px}
.ld-gate .hd h2{margin:6px 0 4px;font-size:22px;color:#fff}
.ld-gate .hd p{margin:0;font-size:13px;color:#fecaca}
.ld-gate .bd{padding:22px 28px 26px}
.ld-gate ol{margin:0 0 18px;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
.ld-gate li{display:flex;gap:12px;align-items:flex-start;font-size:13.5px;line-height:1.5;color:var(--ink)}
.ld-gate li i{font-style:normal;flex:none;width:24px;height:24px;border-radius:8px;background:var(--tint-red,rgba(220,38,38,.1));color:var(--ld-red);font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
[data-theme="dark"] .ld-gate li i{color:#fca5a5}
.ld-gate .chk{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card2,var(--bg));cursor:pointer;font-size:13px;font-weight:600}
.ld-gate .chk input{width:18px;height:18px;margin-top:1px;accent-color:#b91c1c;flex:none}
.ld-gate .rec{font-size:11.5px;color:var(--muted);margin:10px 2px 16px;display:flex;gap:6px;align-items:center}
.ld-gate .rec svg{width:13px;height:13px}
.ld-gate .act{display:flex;gap:10px;flex-wrap:wrap}
/* buttons */
.ld-btn{text-decoration:none;font:inherit;font-size:13px;font-weight:700;border-radius:11px;padding:9px 16px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;display:inline-flex;gap:8px;align-items:center;justify-content:center;transition:transform .12s,box-shadow .15s,border-color .15s,background .15s;white-space:nowrap}
.ld-btn:hover{border-color:var(--green,#0e9f5a);box-shadow:0 4px 14px rgba(15,23,42,.08)}
.ld-btn:active{transform:translateY(1px)}
.ld-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
.ld-btn svg{width:15px;height:15px}
.ld-btn.p{background:linear-gradient(135deg,#0e9f5a,#047857);border-color:transparent;color:#fff}
.ld-btn.p:hover{box-shadow:0 8px 20px rgba(4,120,87,.3)}
.ld-btn.r{background:linear-gradient(135deg,#b91c1c,#7f1d1d);border-color:transparent;color:#fff}
.ld-btn.r:hover{box-shadow:0 8px 20px rgba(127,29,29,.35)}
.ld-btn.s{padding:6px 11px;font-size:12px;border-radius:9px}
.ld-btn.g{background:transparent}
.ld-btn.on{border-color:var(--green,#0e9f5a);background:var(--green-bg,#e8f7f0);color:var(--green-dark,#0a7a45)}
/* hero */
.ld-hero{display:grid;grid-template-columns:minmax(220px,1.2fr) repeat(5,minmax(120px,1fr));gap:10px;margin-bottom:14px}
.ld-hi{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:13px 15px;position:relative;overflow:hidden;min-width:0}
.ld-hi .l{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.ld-hi .v{font-size:26px;font-weight:850;line-height:1.1;margin-top:5px;font-variant-numeric:tabular-nums;color:var(--ink)}
.ld-hi .s{font-size:11.5px;color:var(--muted);margin-top:3px}
.ld-hi.hello{background:linear-gradient(135deg,#064e3b,#0e9f5a);border-color:transparent;color:#ecfdf5}
.ld-hi.hello .l{color:#a7f3d0}.ld-hi.hello .v{color:#fff;font-size:20px}.ld-hi.hello .s{color:#d1fae5}
.ld-hi.due .v{color:var(--ld-hot)}
.ld-bar{height:6px;border-radius:999px;background:var(--line);overflow:hidden;margin-top:8px}
.ld-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#0e9f5a,#22c55e)}
.ld-bar.gold i{background:linear-gradient(90deg,#d4a017,#f59e0b)}
.ld-brief{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);border-left:4px solid #7c3aed;background:var(--card);border-radius:14px;padding:12px 15px;margin-bottom:14px}
.ld-brief .ic{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;flex:none}
.ld-brief .ic svg{width:17px;height:17px}
.ld-brief b{font-size:12px;color:var(--ink)} .ld-brief p{margin:3px 0 0;font-size:13px;line-height:1.5;color:var(--ink)}
/* tabs */
.ld-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px;padding:4px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
.ld-tab{font:inherit;font-size:12.5px;font-weight:700;padding:8px 13px;border-radius:10px;border:0;background:transparent;color:var(--muted);cursor:pointer;display:inline-flex;gap:7px;align-items:center}
.ld-tab:hover{background:var(--bg);color:var(--ink)}
.ld-tab.on{background:var(--green-bg,#e8f7f0);color:var(--green-dark,#0a7a45);box-shadow:inset 0 -2px 0 var(--green,#0e9f5a)}
.ld-tab .c{font-size:10.5px;font-weight:800;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--bg);border:1px solid var(--line);display:inline-flex;align-items:center;justify-content:center;color:var(--ink)}
.ld-tab .c.hot{background:var(--ld-hot);border-color:var(--ld-hot);color:#fff}
/* filters */
.ld-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.ld-in,.ld-sel{font:inherit;font-size:12.5px;padding:8px 11px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);min-width:0}
.ld-in:focus,.ld-sel:focus{outline:none;border-color:var(--green,#0e9f5a);box-shadow:0 0 0 3px rgba(14,159,90,.15)}
.ld-in.q{flex:1;min-width:200px}
.ld-bulk{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 12px;border:1px dashed var(--green,#0e9f5a);border-radius:12px;background:var(--green-bg,#e8f7f0);margin-bottom:10px;font-size:12.5px;color:var(--green-dark,#0a7a45);font-weight:700}
/* list */
.ld-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--ink);white-space:nowrap}
.ld-chip svg{width:12px;height:12px}
.ld-chip.f{background:var(--tint-green,#e8f7f0);color:var(--tint-green-fg,#0a7a45);border-color:transparent}
.ld-chip.g5{background:var(--tint-violet,#ede9fe);color:var(--tint-violet-fg,#5b21b6);border-color:transparent}
.ld-chip.src{background:var(--tint-blue,#e0edff);color:var(--tint-blue-fg,#1d4ed8);border-color:transparent}
.ld-chip.rel{background:var(--tint-amber,#fef3c7);color:var(--tint-amber-fg,#92400e);border-color:transparent}
.ld-chip.red{background:var(--tint-red,#fee2e2);color:var(--tint-red-fg,#b91c1c);border-color:transparent}
.ld-chip.st{background:var(--card);}
.ld-chip.won{background:linear-gradient(135deg,#0e9f5a,#047857);color:#fff;border-color:transparent}
.ld-empty{text-align:center;padding:46px 20px;border:1px dashed var(--line);border-radius:16px;color:var(--muted);font-size:13.5px;background:var(--card)}
.ld-empty b{display:block;font-size:15px;color:var(--ink);margin-bottom:4px}
.ld-more{display:flex;justify-content:center;margin-top:12px}
/* list toolbar (alpha.168) */
.ld-tb{display:flex;flex-direction:column;gap:9px;margin-bottom:10px}
.ld-tb .r1{display:flex;gap:8px;align-items:center}
.ld-qw{flex:1;min-width:0;position:relative;display:flex;align-items:center;margin:0}
.ld-qw>svg{position:absolute;left:12px;color:var(--muted);pointer-events:none}
.ld-qw .ld-in.q{width:100%;min-width:0;padding-left:35px;height:38px}
.ld-ftg{display:none}
.ld-ftg .c{font-size:10.5px;font-weight:800;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--green,#0e9f5a);color:#fff;display:inline-flex;align-items:center;justify-content:center}
.ld-fx{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
.ld-fx .ld-sel{max-width:240px;height:34px;padding:6px 10px}
.ld-sel.on{border-color:var(--green,#0e9f5a);background:var(--green-bg,#e8f7f0);color:var(--green-dark,#0a7a45);font-weight:700}
.ld-xs{border:0;background:transparent;color:inherit;cursor:pointer;padding:0 0 0 5px;display:inline-flex;align-items:center}
.ld-xs svg{width:12px;height:12px}
.ld-tb .r2{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.ld-seg{display:inline-flex;gap:3px;padding:3px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.ld-seg button{font:inherit;font-size:12px;font-weight:700;border:0;background:transparent;color:var(--muted);padding:6px 11px;border-radius:9px;cursor:pointer;display:inline-flex;gap:7px;align-items:center;white-space:nowrap;transition:background .15s,color .15s}
.ld-seg button:hover{background:var(--bg);color:var(--ink)}
.ld-seg .d{width:9px;height:9px;border-radius:50%;flex:none}
.ld-seg .k{font-variant-numeric:tabular-nums;font-weight:800;color:var(--ink);opacity:.7}
.ld-seg .k:empty{display:none}
.ld-seg .tp-hot .d{background:#ef4444}.ld-seg .tp-warm .d{background:#f59e0b}.ld-seg .tp-cold .d{background:#0ea5e9}.ld-seg .tp-none .d{border:1.5px dashed var(--muted)}
.ld-seg button.on,.ld-seg button.on:hover{color:#fff}.ld-seg button.on .k{color:#fff;opacity:.92}.ld-seg button.on .d{background:#fff;border-color:#fff}
.ld-seg .tp-all.on{background:var(--solid,#1a2b3c);color:var(--solid-fg,#fff)}
.ld-seg .tp-hot.on{background:linear-gradient(135deg,#f87171,#dc2626)}.ld-seg .tp-warm.on{background:linear-gradient(135deg,#fbbf24,#d97706)}
.ld-seg .tp-cold.on{background:linear-gradient(135deg,#38bdf8,#0369a1)}.ld-seg .tp-none.on{background:#64748b}
.ld-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.ld-meta .ld-sel{height:34px;padding:6px 10px}
.ld-cnt{margin-right:4px}.ld-cnt b{color:var(--ink);font-size:14px;font-variant-numeric:tabular-nums}
/* the table */
.ld-tw{border:1px solid var(--line);border-radius:16px;background:var(--card);overflow:clip;box-shadow:0 1px 2px rgba(15,23,42,.04)}
#ldTblBox.busy{opacity:.55;pointer-events:none;transition:opacity .15s}
.ld-t{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;color:var(--ink)}
.ld-t th{position:sticky;top:var(--ld-top,var(--hdr,55px));z-index:3;background:var(--card2,#f8fafc);text-align:left;font-size:10.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);padding:10px;border-bottom:1px solid var(--line);white-space:nowrap}
.ld-t th.s{cursor:pointer}
.ld-t th.s:hover,.ld-t th.s:focus-visible{color:var(--ink);outline:none}
.ld-t th .ar{margin-left:5px;font-size:9px;opacity:.35}
.ld-t th.on{color:var(--green-dark,#0a7a45)}.ld-t th.on .ar{opacity:1}
.ld-t td{padding:9px 10px;border-bottom:1px solid var(--line-soft,var(--line));vertical-align:middle;background:var(--card);transition:background .12s}
.ld-t tbody tr:last-child td{border-bottom:0}
.ld-t tbody tr{cursor:pointer;outline:none}
.ld-t tbody tr:hover td{background:var(--card2,#f8fafc)}
.ld-t tbody tr.sel td{background:var(--green-bg,#e8f7f0)}
.ld-t tbody tr:focus-visible td{background:var(--card2,#f8fafc);box-shadow:inset 0 2px 0 var(--green,#0e9f5a),inset 0 -2px 0 var(--green,#0e9f5a)}
.ld-t tbody tr>td:first-child{box-shadow:inset 4px 0 0 var(--tc,transparent)}
.ld-t tr.t-hot{--tc:#ef4444}.ld-t tr.t-warm{--tc:#f59e0b}.ld-t tr.t-cold{--tc:#0ea5e9}
.ld-t td.c-card{display:none}
.ld-t .c-sel{width:36px;padding-right:2px}
.ld-t input[type=checkbox]{width:16px;height:16px;accent-color:#0e9f5a;cursor:pointer;vertical-align:middle;margin:0}
.ld-t .c-score{width:62px}
.ld-t .c-age{white-space:nowrap;font-variant-numeric:tabular-nums}
.ld-t .c-act{text-align:right;white-space:nowrap;width:1%}
.ld .mono{font-family:var(--mono,monospace)}
.ld-scp{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:46px;height:36px;border-radius:11px;color:#fff;font-weight:850;font-size:14px;line-height:1;font-variant-numeric:tabular-nums;flex:none}
.ld-scp i{font-style:normal;font-size:8px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-top:3px;opacity:.95}
.ld-scp.hot{background:linear-gradient(135deg,#f87171,#dc2626);box-shadow:0 3px 10px rgba(220,38,38,.25)}
.ld-scp.warm{background:linear-gradient(135deg,#fbbf24,#d97706);box-shadow:0 3px 10px rgba(217,119,6,.22)}
.ld-scp.cold{background:linear-gradient(135deg,#38bdf8,#0369a1);box-shadow:0 3px 10px rgba(3,105,161,.2)}
.ld-scp.none{color:var(--muted);border:1.5px dashed var(--line);background:transparent}
.ld-cu{min-width:0}
.ld-cu .nm{font-family:var(--mono,monospace);font-weight:750;font-size:12.5px;white-space:nowrap;color:var(--ink);letter-spacing:.02em}
.ld-cu .nm.no{font-family:inherit;font-weight:600;font-style:italic;color:var(--muted);font-size:12px;letter-spacing:0}
.ld-cu .mb{font-size:11.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px}
.ld-cu .bd{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}
.ld-mini{font-size:10px;font-weight:800;padding:1px 7px;border-radius:999px;white-space:nowrap;line-height:1.55}
.ld-mini.mob{background:var(--tint-amber,#fff7ed);color:var(--tint-amber-fg,#9a3412)}
.ld-mini.fx{background:var(--tint-red,#fef2f2);color:var(--tint-red-fg,#991b1b)}
.ld-mini.lost{background:var(--bg);color:var(--muted);border:1px solid var(--line)}
.ld-mini.j{background:var(--tint-blue,#eef2ff);color:var(--tint-blue-fg,#3730a3)}
.ld-pd{--c:#059669;display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;padding:3px 10px 3px 7px;border-radius:999px;white-space:nowrap;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-color:color-mix(in srgb,var(--c) 32%,transparent);background:color-mix(in srgb,var(--c) 12%,transparent);color:color-mix(in srgb,var(--c) 82%,var(--ink))}
.ld-pd svg{width:15px;height:15px;color:var(--c)}
.ld-pd.p-ftth{--c:#059669}.ld-pd.p-5g{--c:#7c3aed}
.ld-pd.y-ftth{--c:#059669}.ld-pd.y-fttb{--c:#0d9488}.ld-pd.y-5g_homefi{--c:#7c3aed}.ld-pd.y-5g_fwa{--c:#db2777}.ld-pd.y-5g{--c:#8b5cf6}
.ld-ty{--c:#059669;display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:12px;white-space:nowrap;color:var(--ink);color:color-mix(in srgb,var(--c) 86%,var(--ink))}
.ld-ty svg{width:16px;height:16px;color:var(--c)}
.y-ftth{--c:#059669}.y-fttb{--c:#0d9488}.y-5g_homefi{--c:#7c3aed}.y-5g_fwa{--c:#db2777}.y-5g{--c:#8b5cf6}
.ld-pl{font-weight:600;line-height:1.3;max-width:190px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ld-pl b,.ld-cd .pl b{font-weight:850;color:var(--ink)}
.ld-ptp{display:inline-flex;align-items:baseline;gap:5px;font-size:11px;font-weight:800;padding:2px 9px;border-radius:999px;white-space:nowrap;border:1px solid transparent}
.ld-ptp.post{color:var(--blue,#2563eb);border-color:var(--blue-line,#bfdbfe);background:var(--tint-blue,#eef2ff)}
.ld-ptp.pre{color:var(--warn-fg,#b45309);border-color:var(--amber-line,#fde68a);background:var(--tint-warn-bg,#fffbeb)}
.ld-ptp small{font-size:10px;font-weight:700;opacity:.8}
.ld-sr{--c:#64748b;display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:12px;white-space:nowrap;color:var(--ink)}
.ld-sr::before{content:"";width:8px;height:8px;border-radius:3px;background:var(--c);flex:none}
.s-epurchase{--c:#2563eb}.s-salamhome{--c:#4f46e5}.s-sda{--c:#ea580c}.s-sda_promoter{--c:#b45309}.s-qr{--c:#ca8a04}.s-dashpro{--c:#475569}.s-import{--c:#65a30d}
.ld-rs,.ld-stc{--c:#64748b;display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;padding:2px 9px 2px 8px;border-radius:999px;white-space:nowrap;background:var(--bg);color:var(--ink);background:color-mix(in srgb,var(--c) 14%,transparent);color:color-mix(in srgb,var(--c) 78%,var(--ink))}
.ld-rs::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--c);flex:none}
.r-payment{--c:#7c3aed}.r-price{--c:#d97706}.r-identity{--c:#2563eb}.r-otp{--c:#0891b2}.r-appointment{--c:#0d9488}.r-stock{--c:#ea580c}.r-coverage{--c:#64748b}
.r-early,.r-abandoned{--c:#94a3b8}.r-lead_rejected{--c:#e11d48}.r-lead_stale{--c:#a16207}.r-campaign{--c:#16a34a}.r-rejected_install{--c:#be123c}
.st-new{--c:#2563eb}.st-assigned{--c:#64748b}.st-contacted{--c:#0891b2}.st-callback{--c:#d97706}.st-interested{--c:#16a34a}.st-offer{--c:#7c3aed}
.st-lost,.st-unreachable,.st-duplicate{--c:#94a3b8}.st-dnc{--c:#dc2626}
.ld-stc.st-won{background:linear-gradient(135deg,#0e9f5a,#047857);color:#fff}
.ld-stc .pulse{width:7px;height:7px;border-radius:50%;background:#ef4444;animation:ldPulse 1.6s infinite;flex:none}
.ld-sub{font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.35}
.ld-sub.clip{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
.ld-sub .late{color:var(--bad-fg,#b91c1c)}
.ld-dim{color:var(--muted)}
.ld-own{display:inline-flex;align-items:center;gap:7px;font-weight:700;white-space:nowrap}
.ld-own i{font-style:normal;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#0e9f5a,#047857);color:#fff;font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex:none}
.ld-btn.w{border-color:var(--green,#0e9f5a);color:var(--green-dark,#0a7a45)}
.ld-pg{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px;font-size:12.5px;color:var(--muted)}
.ld-pg b{color:var(--ink)}
.ld-pg .b{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ld-pg .n{padding:0 6px;font-weight:700;color:var(--ink);white-space:nowrap}
/* contacts on screen: reveal one lead (eye on the row), unmask the page (alpha.168) */
.ld-eye{border:1px solid var(--line);background:var(--card);color:var(--muted);width:24px;height:24px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;margin-left:7px;vertical-align:-6px;padding:0;transition:color .15s,border-color .15s,background .15s}
.ld-eye svg{width:13px;height:13px}
.ld-eye:hover,.ld-eye:focus-visible{color:var(--red,#dc2626);border-color:var(--red-line,#fecaca);background:var(--tint-red,#fef2f2);outline:none}
.ld-eye:disabled{opacity:.5;cursor:wait}
.ld-cu.on .nm2{font-weight:800;font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}
.ld-cu.on .nm2 small{display:block;font-weight:600;color:var(--muted);font-size:11.5px;font-family:"Noto Kufi Arabic","Geeza Pro",Tahoma,sans-serif;text-align:left}
.ld-tel{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono,monospace);font-weight:800;font-size:12.5px;color:var(--red,#dc2626);text-decoration:none;letter-spacing:.02em}
.ld-tel svg{width:12px;height:12px}
.ld-tel:hover{text-decoration:underline}
.ld-cu.on .mb{max-width:none;overflow:visible}
.ld-mini.un{display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;font-variant-numeric:tabular-nums}
.ld-mini.un svg{width:10px;height:10px}
.ld-unm{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:9px 12px 9px 14px;border-radius:12px;margin-bottom:10px;color:#fee2e2;background:linear-gradient(100deg,#450a0a,#7f1d1d 45%,#b91c1c);box-shadow:0 8px 22px rgba(127,29,29,.22);font-size:12.5px;line-height:1.45}
.ld-unm>svg{width:17px;height:17px;color:#fff}
.ld-unm span{flex:1;min-width:200px}.ld-unm b{color:#fff;font-variant-numeric:tabular-nums}
.ld-unm .ld-btn{background:#fff;color:#7f1d1d;border-color:transparent}
.ld-mb{position:fixed;inset:0;background:var(--scrim,rgba(2,6,23,.45));z-index:1450;display:flex;align-items:center;justify-content:center;padding:16px;animation:ldFade .15s ease-out}
@keyframes ldFade{from{opacity:0}to{opacity:1}}
.ld-md{width:min(520px,100%);background:var(--card);border-radius:18px;border:1px solid var(--line);box-shadow:0 30px 80px rgba(2,6,23,.35);overflow:hidden;-webkit-user-select:none;user-select:none}
.ld-md .hd{padding:18px 20px 16px;color:#fff;background:radial-gradient(120% 140% at 0% 0%,#991b1b 0%,#450a0a 70%,#1c0505 100%)}
.ld-md .hd b{display:flex;gap:9px;align-items:center;font-size:16px}
.ld-md .hd b svg{width:20px;height:20px}
.ld-md .hd small{display:block;margin-top:4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#fecaca;font-weight:800}
.ld-md .bd{padding:16px 20px 6px;font-size:13.5px;line-height:1.55;color:var(--ink)}
.ld-md .bd p{margin:0 0 10px}.ld-md .bd ul{margin:0 0 6px;padding-left:18px;color:var(--ink-soft,var(--ink))}.ld-md .bd li{margin:3px 0}
.ld-md .ft{display:flex;gap:8px;justify-content:flex-end;padding:10px 20px 18px;flex-wrap:wrap}
/* alpha.170: name origin, e-mail, language; the temperature legend */
.ld-cu.on .nm2.no{font-style:italic;font-weight:600;color:var(--muted);font-size:12px}
.ld-cu.on .nm2 small.fr{display:block;font-family:inherit;font-weight:700;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-top:1px}
.ld-mail{display:inline-flex;align-items:center;margin-left:6px;color:var(--muted);cursor:help;vertical-align:-2px}.ld-mail svg{width:13px;height:13px}
.ld-mini.en{background:var(--tint-violet,#ede9fe);color:var(--tint-violet-fg,#5b21b6)}
.ld-tb .r2 .lft{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}
.ld-how{color:var(--muted)}.ld-how svg{width:15px;height:15px}
.ld-how.on{color:var(--green-dark,#0a7a45);border-color:var(--green,#0e9f5a);background:var(--green-bg,#e8f7f0)}
.ld-leg{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:14px 16px;margin-bottom:10px;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px}
.ld-leg .bands{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ld-leg .b{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line-soft,var(--line));border-radius:12px;padding:10px;background:var(--card2,var(--bg))}
.ld-leg .b b{display:block;font-size:12.5px;color:var(--ink)}.ld-leg .b p{margin:3px 0 0;font-size:12px;line-height:1.45;color:var(--ink-soft,var(--ink))}
.ld-leg .how b{font-size:12.5px;color:var(--ink)}
.ld-leg .base{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin:8px 0;font-size:12px;color:var(--muted)}.ld-leg .base>span:first-child{margin-right:3px}
.ld-leg ul{margin:0;padding-left:18px;font-size:12px;line-height:1.55;color:var(--ink-soft,var(--ink))}
@media (max-width:1100px){.ld-leg{grid-template-columns:1fr}}
@media (max-width:700px){.ld-leg .bands{grid-template-columns:1fr}.ld-how span{display:none}.ld-tb .r2 .lft{flex-wrap:nowrap}.ld-tb .r2 .lft .ld-seg{flex:1;min-width:0}}
/* a lead as a card (phone, iPad upright) */
.ld-cd .h{display:flex;gap:10px;align-items:flex-start}
.ld-cd .h .w{flex:1;min-width:0}
.ld-cd .h .a{flex:none}
.ld-cd .h input{margin-top:10px}
.ld-cd .l{display:flex;gap:6px 8px;align-items:center;flex-wrap:wrap;margin-top:9px;font-size:12px;min-width:0}
.ld-cd .l .pl{font-weight:650;color:var(--ink)}
.ld-cd .l.rs .ld-sub,.ld-cd .l.st .ld-sub{margin-top:0}
.ld-cd .ld-cu .mb{max-width:none}
@media (max-width:1400px){.ld-pl{max-width:160px}.ld-sub.clip{max-width:175px}.ld-t .c-ptype small{display:none}}
@media (max-width:1240px){.ld-t th,.ld-t td{padding-left:8px;padding-right:8px}.ld-pl{max-width:150px}.ld-sub.clip{max-width:160px}.ld-cu .mb{max-width:160px}}
@media (max-width:980px){
  .ld-tw{border:0;background:transparent;overflow:visible;box-shadow:none;border-radius:0}
  .ld-t,.ld-t tbody{display:block}
  .ld-t thead{display:none}
  .ld-t tbody tr{display:block;margin-bottom:9px;border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:inset 4px 0 0 var(--tc,transparent);overflow:hidden}
  .ld-t tbody tr>td{display:none}
  .ld-t tbody tr>td.c-card{display:block;padding:12px 13px 12px 15px;border:0;background:transparent;box-shadow:none}
  .ld-t tbody tr:hover td,.ld-t tbody tr.sel td{background:transparent}
  .ld-t tbody tr:hover{background:var(--card);border-color:var(--green-line,#bbf7d0)}
  .ld-t tbody tr.sel{background:var(--green-bg,#e8f7f0);border-color:var(--green,#0e9f5a)}
  .ld-t tbody tr:focus-visible{border-color:var(--green,#0e9f5a)}
  .ld-t tbody tr:focus-visible td{box-shadow:none}
}
@media (max-width:700px){
  .ld-ftg{display:inline-flex}
  .ld-fx{display:none}
  .ld-fx.open{display:grid;grid-template-columns:1fr 1fr;gap:7px}
  .ld-fx .ld-sel{max-width:none;width:100%}
  .ld-tb .r2{flex-direction:column;align-items:stretch;gap:8px;flex-wrap:nowrap}
  .ld-tb .r2>*{min-width:0;max-width:100%}
  .ld-seg{overflow-x:auto;scrollbar-width:none;max-width:100%}.ld-seg::-webkit-scrollbar{display:none}
  .ld-seg button{padding:6px 9px}
  .ld-meta{justify-content:space-between}
  .ld-meta .ld-cnt{flex:1 1 100%}
  .ld-meta .ld-sel{flex:1}
  .ld-pg{justify-content:center;text-align:center}
  #ldUnmB .ld-btn span{display:none}
  .ld-unm span{min-width:0;flex:1 1 100%}
}
/* drawer */
.ld-scrim{position:fixed;inset:0;background:var(--scrim,rgba(2,6,23,.45));z-index:1400;opacity:0;transition:opacity .2s}
.ld-scrim.on{opacity:1}
.ld-dr{position:fixed;top:0;right:0;bottom:0;width:min(760px,100vw);background:var(--bg);z-index:1401;box-shadow:-20px 0 60px rgba(2,6,23,.25);transform:translateX(102%);transition:transform .26s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;-webkit-user-select:none;user-select:none}
.ld-dr.on{transform:none}
.ld-dr .dh{padding:16px 20px 14px;background:var(--card);border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:flex-start}
.ld-dr .dh h3{margin:0;font-size:18px;color:var(--ink);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ld-dr .dh .sub{font-size:12.5px;color:var(--muted);margin-top:4px}
.ld-dr .db{flex:1;overflow:auto;padding:16px 20px 30px;display:flex;flex-direction:column;gap:14px}
.ld-x{margin-left:auto;width:36px;height:36px;border-radius:11px;border:1px solid var(--line);background:var(--card);color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.ld-x svg{width:16px;height:16px}
.ld-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px}
.ld-card h4{margin:0 0 10px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);display:flex;gap:8px;align-items:center}
.ld-card h4 svg{width:14px;height:14px}
.ld-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.ld-kv div{font-size:12.5px;color:var(--ink)} .ld-kv span{display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.ld-call{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:14px 16px;border-radius:16px;border:1px solid #fecaca;background:linear-gradient(135deg,rgba(254,226,226,.7),rgba(255,255,255,0));}
[data-theme="dark"] .ld-call{border-color:rgba(248,113,113,.35);background:linear-gradient(135deg,rgba(127,29,29,.35),rgba(0,0,0,0))}
.ld-call .num{font-family:var(--mono,monospace);font-size:24px;font-weight:850;letter-spacing:.04em;color:var(--ink)}
.ld-call .nm{font-size:13px;color:var(--ink);font-weight:700}
.ld-call .nm small{display:block;font-weight:500;color:var(--muted);font-size:11.5px}
.ld-call .tm{font-size:11px;color:var(--muted);display:flex;gap:6px;align-items:center}
.ld-ring{width:34px;height:34px;flex:none}
/* coach */
.ld-coach{border:1px solid rgba(124,58,237,.35);background:linear-gradient(160deg,rgba(124,58,237,.08),rgba(79,70,229,.02) 60%),var(--card)}
.ld-coach h4{color:#7c3aed}
[data-theme="dark"] .ld-coach h4{color:#c4b5fd}
.ld-path{display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;margin:4px 0 12px}
.ld-step{flex:1;min-width:150px;border:1px solid var(--line);border-radius:12px;padding:9px 11px;background:var(--card);position:relative}
.ld-step .n{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.ld-step b{display:block;font-size:12.5px;color:var(--ink);margin-top:2px}
.ld-step .pr{font-size:12px;color:var(--muted);margin-top:3px}
.ld-step .pr s{opacity:.7} .ld-step .pr em{font-style:normal;font-weight:800;color:var(--green-dark,#0a7a45)}
.ld-step.first{border-color:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,.12)}
.ld-say{border-radius:12px;padding:10px 12px;background:var(--bg);border:1px solid var(--line);font-size:13.5px;line-height:1.55;color:var(--ink);margin-bottom:8px}
.ld-say[dir=rtl]{font-family:"Noto Kufi Arabic","Geeza Pro",Tahoma,sans-serif;font-size:14px}
.ld-pts{margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.55;color:var(--ink)}
.ld-obj{border-top:1px dashed var(--line);margin-top:10px;padding-top:8px}
.ld-obj details{padding:6px 0;font-size:12.5px;color:var(--ink)} .ld-obj summary{cursor:pointer;font-weight:700}
.ld-obj p{margin:5px 0 0 14px;color:var(--muted)}
/* outcomes */
.ld-res{display:flex;flex-direction:column;gap:10px}
.ld-res .grp{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.ld-res .row{display:flex;gap:6px;flex-wrap:wrap}
.ld-res .ld-btn.won{border-color:#0e9f5a;color:var(--green-dark,#0a7a45)}
.ld-form{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--bg);display:flex;flex-direction:column;gap:10px}
.ld-form label{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);display:flex;flex-direction:column;gap:5px}
.ld-preset{display:flex;gap:6px;flex-wrap:wrap}
.ld-tl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0}
.ld-tl li{display:grid;grid-template-columns:86px 1fr;gap:10px;padding:8px 0;border-bottom:1px dashed var(--line);font-size:12.5px;color:var(--ink)}
.ld-tl li:last-child{border-bottom:0}
.ld-tl .w{color:var(--muted);font-size:11.5px}
.ld-tl .pt{font-size:10.5px;font-weight:800;color:#047857;background:var(--tint-green,#e8f7f0);border-radius:999px;padding:1px 7px;margin-left:6px}
.ld-cmt{display:flex;gap:8px}
.ld-cmt textarea{flex:1;min-height:44px;resize:vertical}
/* team */
.ld-grid2{display:grid;grid-template-columns:1.3fr 1fr;gap:14px}
.ld-pod{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;align-items:end;margin-bottom:12px}
.ld-pod .p{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:12px;text-align:center}
.ld-pod .p .m{width:38px;height:38px;border-radius:50%;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff}
.ld-pod .p.r1{padding-top:22px;border-color:#d4a017;box-shadow:0 10px 30px rgba(212,160,23,.18)} .ld-pod .p.r1 .m{background:linear-gradient(135deg,#f5c542,#d4a017)}
.ld-pod .p.r2 .m{background:linear-gradient(135deg,#cbd5e1,#94a3b8)} .ld-pod .p.r3 .m{background:linear-gradient(135deg,#e7a46a,#b45309)}
.ld-pod .p b{display:block;font-size:13px;color:var(--ink)} .ld-pod .p span{font-size:11.5px;color:var(--muted)}
.ld-best{display:flex;gap:14px;align-items:center;border-radius:16px;padding:14px 16px;margin-bottom:14px;color:#422006;background:linear-gradient(120deg,#fde68a,#fbbf24 60%,#f59e0b);box-shadow:0 12px 30px rgba(245,158,11,.25)}
.ld-best .ic{width:46px;height:46px;border-radius:14px;background:rgba(255,255,255,.45);display:flex;align-items:center;justify-content:center;flex:none} .ld-best .ic svg{width:26px;height:26px}
.ld-best b{font-size:16px} .ld-best small{display:block;font-size:12px;opacity:.85}
.ld-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.ld-tbl th{text-align:left;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:7px 8px;border-bottom:1px solid var(--line)}
.ld-tbl td{padding:8px;border-bottom:1px solid var(--line-soft,var(--line));color:var(--ink)}
.ld-tbl tr.me td{background:var(--green-bg,#e8f7f0);font-weight:700}
.ld-ch{border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--card);margin-bottom:8px}
.ld-ch .h{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.ld-ch b{font-size:13px;color:var(--ink)} .ld-ch small{font-size:11.5px;color:var(--muted)}
.ld-ch.done{border-color:#0e9f5a;background:linear-gradient(135deg,rgba(14,159,90,.08),transparent)}
.ld-feed{list-style:none;margin:0;padding:0}
.ld-feed li{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px dashed var(--line);font-size:12.5px;color:var(--ink)}
.ld-feed li i{width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none;color:#fff;font-style:normal}
.ld-feed li i svg{width:14px;height:14px}
/* offers */
.ld-offers{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-bottom:14px}
.ld-off{border:1px solid var(--line);border-radius:18px;padding:16px;background:var(--card);position:relative;overflow:hidden}
.ld-off .stp{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.ld-off h5{margin:6px 0 4px;font-size:15px;color:var(--ink)}
.ld-off .price{display:flex;align-items:baseline;gap:8px;margin:8px 0}
.ld-off .price b{font-size:30px;font-weight:900;color:var(--green-dark,#0a7a45)} .ld-off .price s{color:var(--muted);font-size:14px}
.ld-off .meta{font-size:12px;color:var(--muted);line-height:1.6}
.ld-off.std{background:linear-gradient(150deg,rgba(14,159,90,.10),transparent 55%),var(--card)}
.ld-rules{margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:var(--ink)}
/* batches */
.ld-drop{border:2px dashed var(--line);border-radius:16px;padding:22px;text-align:center;background:var(--card);transition:border-color .15s,background .15s;cursor:pointer}
.ld-drop.over{border-color:var(--green,#0e9f5a);background:var(--green-bg,#e8f7f0)}
.ld-drop svg{width:28px;height:28px;color:var(--green,#0e9f5a)}
.ld-drop b{display:block;margin-top:6px;font-size:14px;color:var(--ink)} .ld-drop small{color:var(--muted);font-size:12px}
.ld-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ld-two>label{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700;color:var(--muted);min-width:0}
.ld-two>label>.ld-in,.ld-two>label>.ld-sel{width:100%}
.ld-form .ld-two>label{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.ld-check{display:flex;gap:6px;flex-wrap:wrap}
.ld-check label{display:inline-flex;gap:6px;align-items:center;font-size:12.5px;font-weight:600;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);cursor:pointer;color:var(--ink)}
.ld-check input{accent-color:#0e9f5a}
.ld-note{font-size:12px;color:var(--muted);line-height:1.5}
.ld-err{border:1px solid var(--red-line,#fecaca);background:var(--tint-red,#fee2e2);color:var(--tint-red-fg,#b91c1c);border-radius:12px;padding:10px 12px;font-size:12.5px}
.ld-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);z-index:1500;background:#0f172a;color:#fff;font-size:13px;font-weight:700;padding:11px 18px;border-radius:12px;box-shadow:0 14px 40px rgba(2,6,23,.35);opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;max-width:92vw;text-align:center}
.ld-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
.ld-toast.ok{background:linear-gradient(135deg,#047857,#0e9f5a)}
.ld-confetti{position:fixed;inset:0;pointer-events:none;z-index:1600;overflow:hidden}
.ld-confetti i{position:absolute;top:-12px;width:9px;height:14px;border-radius:2px;animation:ldFall 2.4s cubic-bezier(.2,.6,.4,1) forwards}
@keyframes ldFall{to{transform:translateY(105vh) rotate(720deg);opacity:.9}}
@media (prefers-reduced-motion:reduce){.ld-band .dot{animation:none}.ld-confetti{display:none}}
/* responsive */
@media (max-width:1180px){.ld-hero{grid-template-columns:repeat(5,minmax(0,1fr))}.ld-hero .hello{grid-column:1/-1}.ld-grid2{grid-template-columns:1fr}.ld-filters .q{flex:1 1 100%}}
@media (max-width:700px){
  .ld-hero{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ld-hi{padding:11px 12px}.ld-hi .v{font-size:22px}
  .ld-band{padding:10px 12px;border-radius:12px;gap:8px}.ld-band .msg{min-width:0;font-size:12px;flex:1 1 100%}.ld-band .who{white-space:normal;flex-wrap:wrap;gap:6px}
  .ld-hero .ld-hi:last-child{grid-column:1/-1}
  .ld-tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.ld-tabs::-webkit-scrollbar{display:none}.ld-tab{flex:none}
    .ld-dr .dh{padding:12px 14px}.ld-dr .db{padding:12px 12px 26px}.ld-call .num{font-size:21px}
  .ld-two{grid-template-columns:1fr}.ld-pod{gap:6px}.ld-pod .p{padding:9px 6px}
  .ld-gate{margin:10px 0 40px;border-radius:16px}.ld-gate .hd{padding:20px 18px 18px}.ld-gate .bd{padding:16px 18px 20px}
  .ld-tl li{grid-template-columns:70px 1fr}
  .ld-toast{bottom:calc(84px + env(safe-area-inset-bottom,0px));max-width:calc(100vw - 32px);text-align:center}
}`;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- small helpers */
  function toast(msg,ok){ let t=document.getElementById("ldToast"); if(!t){ t=document.createElement("div"); t.id="ldToast"; t.className="ld-toast"; document.body.appendChild(t); }
    t.textContent=msg; t.classList.toggle("ok",!!ok); t.classList.add("on"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("on"),2600); }
  function confetti(){ if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c=document.createElement("div"); c.className="ld-confetti"; const cols=["#0e9f5a","#22c55e","#f59e0b","#7c3aed","#ef4444","#0ea5e9","#facc15"];
    for(let i=0;i<90;i++){ const p=document.createElement("i"); p.style.left=Math.random()*100+"vw"; p.style.background=cols[i%cols.length]; p.style.animationDelay=(Math.random()*0.5)+"s"; p.style.animationDuration=(1.8+Math.random()*1.4)+"s"; p.style.transform=`rotate(${Math.random()*360}deg)`; c.appendChild(p); }
    document.body.appendChild(c); setTimeout(()=>c.remove(),3600); }
  const me=()=>((window.opsSession&&window.opsSession())||{}).me||{};
  const first=s=>{ const w=String(s||"").split("@")[0].split(/[\s._-]+/).filter(Boolean); const x=w.find(t=>t.length>1)||w[0]||""; return x.replace(/^./,c=>c.toUpperCase()); };
  const scoreBox=L=>`<div class="sc ${L.temp||"none"}" title="${L.score!=null?"Agent 2 score "+L.score+" · "+(L.temp||""):"not scored yet"}">${L.score!=null?L.score:"–"}<small>${L.temp||"new"}</small></div>`;
  const prodChip=L=>`<span class="ld-chip ${L.product==="5g"?"g5":"f"}">${esc(PRODUCT[L.product]||L.product)} · ${esc(L.plan_label||"")}</span>`;
  const srcChip=L=>`<span class="ld-chip src">${esc((S.meta&&S.meta.sources[L.source])||L.source)}</span>`;
  function relChips(L){ const r=L.relation||{}; const out=[];
    if(r.mobile&&r.mobile.active) out.push(`<span class="ld-chip rel" title="${r.mobile.active} active Salam Mobile order(s)">Salam Mobile customer</span>`);
    if(r.fixed&&r.fixed.orders) out.push(`<span class="ld-chip red" title="ordered Salam fiber / 5G before — not a new acquisition">Ordered Fixed before</span>`);
    if(r.fixed&&r.fixed.priorLost) out.push(`<span class="ld-chip" title="an earlier lead for this person was lost">Lost before</span>`);
    return out.join(""); }
  function dueChip(L){ if(!L.next_action_at) return ""; const t=new Date(L.next_action_at).getTime(); const late=t<Date.now(); const soon=t-Date.now()<15*60e3;
    return `<span class="ld-chip ${late||soon?"red":""}">${I.clock}${late?"call back · overdue "+esc(ago(L.next_action_at).replace(" ago","")):"call back "+esc(ago(L.next_action_at))}</span>`; }
  function statusChip(L){ const lb=(S.meta&&S.meta.statuses[L.status])||L.status; return `<span class="ld-chip ${L.status==="won"?"won":"st"}">${esc(lb)}${L.status==="won"&&L.won_auto?" · by an order":""}</span>`; }

  /* ---------------------------------------------------------------- watermark + band */
  function watermark(root){
    const m=me(); const who=(m.email||"").toLowerCase(); const day=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
    const txt=`${who} · ${day} · RESTRICTED · OCU`;
    const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='420' height='220'><text x='10' y='120' transform='rotate(-24 210 110)' font-family='Arial' font-size='15' font-weight='700' fill='%23000'>${txt.replace(/&/g,"").replace(/</g,"").replace(/#/g,"")}</text></svg>`;
    let wm=root.querySelector(".ld-wm"); if(!wm){ wm=document.createElement("div"); wm.className="ld-wm"; root.appendChild(wm); }
    wm.style.backgroundImage=`url("data:image/svg+xml;utf8,${svg.replace(/"/g,"'").replace(/\n/g,"")}")`;
  }
  function band(){
    const m=me(); const acc=S.gate&&S.gate.acceptedAt;
    return `<div class="ld-band" role="note"><span class="dot"></span><b>Restricted · OCU eyes only</b>
      <span class="msg">Leads are Salam's market fuel. Never copy, export, photograph or share them — every view, reveal and action is recorded.</span>
      <span class="who"><span>${esc(m.name||m.email||"")}</span><span id="ldRevealUse">reveals ${S.meta?`0 / ${n(S.meta.reveal.perHour)} per hour`:"—"}</span>${acc?`<span>accepted ${esc(hm(acc))} KSA</span>`:""}</span></div>`;
  }

  /* ---------------------------------------------------------------- gate */
  function renderGate(host){
    const g=S.gate; const m=me(); const now=new Date();
    host.innerHTML=`<div class="ld"><div class="ld-gate" role="dialog" aria-labelledby="ldGateT">
      <div class="hd"><div class="ic">${I.shield}</div><div class="k"><span class="dot" style="width:8px;height:8px;border-radius:50%;background:#f87171;display:inline-block;animation:ldPulse 1.8s infinite"></span>Restricted section · critical data</div>
        <h2 id="ldGateT">${esc(g.terms.title)}</h2><p>OCU retention team and super admins only. Read and accept before any lead is shown — once a day.</p></div>
      <div class="bd"><ol>${g.terms.points.map((p,i)=>`<li><i>${i+1}</i><span>${esc(p)}</span></li>`).join("")}</ol>
        <label class="chk"><input type="checkbox" id="ldAcc"> <span>I have read these rules and I accept them for today.</span></label>
        <div class="rec">${I.lock}Recorded with your name (${esc(m.name||m.email||"")}), ${esc(md(now))} KSA, your IP address and this device · terms ${esc(g.terms.version)}</div>
        ${g.me&&g.me.viewAs?`<div class="ld-err" style="margin-bottom:12px">You are viewing the console as ${esc(g.me.viewAs)} — acceptance is personal. Return to your own account to accept.</div>`:""}
        <div class="act"><button class="ld-btn r" id="ldGo" disabled>${I.shield}Accept and open the leads</button><button class="ld-btn g" id="ldLeave">Leave this section</button></div>
      </div></div></div>`;
    const cb=host.querySelector("#ldAcc"), go=host.querySelector("#ldGo");
    cb.onchange=()=>{ go.disabled=!cb.checked||!!(g.me&&g.me.viewAs); };
    go.onclick=async()=>{ go.disabled=true; try{ await post("/api/fixed/leads/accept",{version:g.terms.version}); toast("Accepted — welcome to Leads",true); await boot(host); }catch(e){ toast(e.message); go.disabled=false; } };
    host.querySelector("#ldLeave").onclick=()=>{ location.hash="#"+((window.consoleHomeHash&&window.consoleHomeHash())||"home"); };
  }

  /* ---------------------------------------------------------------- workspace */
  const TABS=[["mine","My queue"],["pool","Team pool"],["team","Team",true],["closed","Closed"],["board","Team & challenges"],["batches","Batches",true],["offers","Offers playbook"],["settings","Settings",true]];
  function shell(host){
    const mgr=S.meta.me.manager; const c=(S.list&&S.list.counts)||{};
    host.innerHTML=`<div class="ld" id="ldRoot">${band()}${S.meta.piiReady?"":`<div class="ld-err" style="margin-bottom:12px"><b>Leads are not flowing yet.</b> The server's protection key (LEADS_PII_KEY) is not set, so nothing is harvested or imported — the console owner adds it once on the server.</div>`}<div id="ldHero"></div><div id="ldBrief"></div>
      <div class="ld-tabs" role="tablist">${TABS.filter(t=>!t[2]||mgr).map(([k,l])=>`<button class="ld-tab${S.tab===k?" on":""}" data-t="${k}" role="tab">${esc(l)}${k==="mine"?`<span class="c${n(c.due)?" hot":""}" id="ldCmine">${n(c.mine)}</span>`:k==="pool"?`<span class="c" id="ldCpool">${n(c.pool)}</span>`:k==="team"?`<span class="c" id="ldCteam">${n(c.team)}</span>`:""}</button>`).join("")}</div>
      <div id="ldBody"></div></div>`;
    const root=host.querySelector("#ldRoot"); watermark(root);
    host.querySelectorAll(".ld-tab").forEach(b=>b.onclick=()=>{ S.tab=b.dataset.t; S.sel.clear(); host.querySelectorAll(".ld-tab").forEach(x=>x.classList.toggle("on",x===b)); body(); });
    /* copy is blocked inside the section, except in the fields a member types into */
    root.addEventListener("copy",e=>{ const t=e.target; if(t&&t.closest&&t.closest("input,textarea")) return; e.preventDefault(); toast("Copy is disabled in Leads — the data stays here"); },true);
    root.addEventListener("dragstart",e=>e.preventDefault());
  }
  async function hero(){
    try{ S.board=await api("/api/fixed/leads/board"); }catch(e){ return; }
    const b=S.board, m=b.me, t=b.team; const el=document.getElementById("ldHero"); if(!el) return;
    const tw=n(m.targets&&m.targets.dailyWins)||2, tww=n(m.targets&&m.targets.weeklyWins)||10;
    const hour=new Date(Date.now()+3*3600e3).getUTCHours(); const hi=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";
    const ocuN=Math.max(1,(S.meta.members||[]).filter(x=>!x.notOcu).length), teamT=tww*ocuN;
    const myName=first((me().name)||m.name||m.email);
    const sup=!!(S.meta.me.manager&&!m.ocu);   /* a supervisor or super admin who works no queue: the team's day, not empty personal counters */
    const twd=tw*ocuN;
    el.innerHTML=sup?`<div class="ld-hero">
      <div class="ld-hi hello"><div class="l">${esc(hi)}</div><div class="v">${esc(myName)}</div><div class="s">Supervisor view · team today: ${n(t.calls_today)} call(s) · ${n(t.contacts_today)} reached · ${n(t.won_today)} won</div></div>
      <div class="ld-hi"><div class="l">Open leads · team</div><div class="v">${fmt(t.open)}</div><div class="s">${fmt(t.pool)} in the pool · ${fmt(t.hot)} hot</div></div>
      <div class="ld-hi ${n(t.overdue)?"due":""}"><div class="l">Call-backs overdue</div><div class="v">${fmt(t.overdue)}</div><div class="s">across the team</div></div>
      <div class="ld-hi"><div class="l">Won today · team</div><div class="v">${n(t.won_today)} <span style="font-size:13px;color:var(--muted);font-weight:700">/ ${twd}</span></div><div class="ld-bar"><i style="width:${Math.min(100,Math.round(n(t.won_today)/Math.max(1,twd)*100))}%"></i></div></div>
      <div class="ld-hi"><div class="l">Team won · week</div><div class="v">${n(t.won_week_ocu)} <span style="font-size:13px;color:var(--muted);font-weight:700">/ ${teamT}</span></div><div class="ld-bar gold"><i style="width:${Math.min(100,Math.round(n(t.won_week_ocu)/teamT*100))}%"></i></div><div class="s">${t.conv_week!=null?t.conv_week+" % of the leads the team closed":"no lead closed yet this week"}</div></div>
      <div class="ld-hi"><div class="l">First call · SLA</div><div class="v">${t.first_contact_within!=null?t.first_contact_within+" %":"—"}</div><div class="s">within ${n(t.sla_min)} min this week${t.first_contact_avg_min!=null?" · avg "+t.first_contact_avg_min+" min":""}</div></div>
    </div>`:`<div class="ld-hero">
      <div class="ld-hi hello"><div class="l">${esc(hi)}</div><div class="v">${esc(myName)}${m.rank?` · #${m.rank} this week`:""}</div><div class="s">${n(m.pts_week)} points this week · ${n(m.calls_today)} call(s) today · ${n(m.contacts_today)} reached</div></div>
      <div class="ld-hi"><div class="l">My open leads</div><div class="v">${n(m.open)}</div><div class="s">${n(m.untouched)} not called yet · ${n(m.hot)} hot</div></div>
      <div class="ld-hi ${n(m.due)?"due":""}"><div class="l">Call back now</div><div class="v">${n(m.due)}</div><div class="s">due within 15 min or overdue</div></div>
      <div class="ld-hi"><div class="l">Won today</div><div class="v">${n(m.won_today)} <span style="font-size:13px;color:var(--muted);font-weight:700">/ ${tw}</span></div><div class="ld-bar"><i style="width:${Math.min(100,Math.round(n(m.won_today)/tw*100))}%"></i></div></div>
      <div class="ld-hi"><div class="l">Team won · week</div><div class="v">${n(t.won_week_ocu)} <span style="font-size:13px;color:var(--muted);font-weight:700">/ ${teamT}</span></div><div class="ld-bar gold"><i style="width:${Math.min(100,Math.round(n(t.won_week_ocu)/teamT*100))}%"></i></div><div class="s">${t.conv_week!=null?t.conv_week+" % of the leads the team closed":"no lead closed yet this week"}</div></div>
      <div class="ld-hi"><div class="l">First call · SLA</div><div class="v">${t.first_contact_within!=null?t.first_contact_within+" %":"—"}</div><div class="s">within ${n(t.sla_min)} min this week${t.first_contact_avg_min!=null?" · avg "+t.first_contact_avg_min+" min":""}</div></div>
    </div>`;
    const br=document.getElementById("ldBrief"); if(br) br.innerHTML=b.brief?`<div class="ld-brief"><div class="ic">${I.spark}</div><div><b>Agent 2 · team brief · ${esc(md(b.brief.at))} KSA</b><p>${esc(b.brief.text)}</p></div></div>`:"";
  }
  function body(){
    const el=document.getElementById("ldBody"); if(!el) return;
    if(["mine","pool","team","closed"].includes(S.tab)) return listView(el);
    delete el.dataset.lv;
    if(S.tab==="board") return boardView(el);
    if(S.tab==="batches") return batchesView(el);
    if(S.tab==="offers") return offersView(el);
    if(S.tab==="settings") return settingsView(el);
  }

  /* ---------------------------------------------------------------- list (alpha.168) — a table: temperature, customer, product, type, plan,
   * plan type, channel, reason, age, status, owner; sortable headers; each filter shows its counts (the other filters applied); pages of
   * 50 / 100 / 200; the same lead becomes a card on a phone or an iPad held upright (td.c-card, shown under 980 px). */
  const TEMP_LABEL={hot:"Hot",warm:"Warm",cold:"Cold"};
  /* where a shown name came from (alpha.170) — the journey's own is not labelled */
  const NAME_FROM={ account:"the Salam Home account", bss:"Salam Fixed (BSS)", mobile:"Salam Mobile", import:"the imported list", dashpro:"DashPro" };
  const NO_NAME="The website and the Salam Home app ask for the identity (Yakeen) only after payment — this customer stopped before it, and no Salam Home account, Salam Fixed or Salam Mobile record carries the name";
  /* the temperature bands, from the coach's own code (meta.scoring) */
  const bands=()=>((S.meta&&S.meta.scoring&&S.meta.scoring.bands)||{hot:70,warm:45});
  const TEMP_TIP={ hot:()=>`Hot — score ${bands().hot} and above: call first`, warm:()=>`Warm — score ${bands().warm} to ${bands().hot-1}: call today`, cold:()=>`Cold — score below ${bands().warm}: lower odds`, none:()=>"Not scored yet — Agent 2 scores new and changed leads every 10 minutes" };
  /* contacts on screen (alpha.168): S.shown holds { name, mobile, tel, until, how: reveal | unmask } per lead id, in memory only */
  const shownOf=id=>{ const x=S.shown.get(String(id)); return x&&x.until>Date.now()?x:null; };
  const mmss=ms=>{ const t=Math.max(0,Math.round(ms/1000)); return Math.floor(t/60)+":"+String(t%60).padStart(2,"0"); };
  const unmaskOn=()=>S.unmaskUntil>Date.now();
  const unmaskHere=()=>{ const u=S.meta&&S.meta.unmask; return !!(u&&u.can&&(u.scope==="any"||S.tab==="mine"||S.tab==="closed")); };
  const unmaskable=x=>x.status!=="dnc"&&(((S.meta.unmask||{}).scope==="any")||x.assignee===S.meta.me.email||x.won_by===S.meta.me.email);
  const canRevealRow=x=>x.status!=="dnc"&&(S.meta.me.manager||x.assignee===S.meta.me.email);
  const CLOSED_ST=["won","lost","dnc","unreachable","duplicate"];
  const pref=(k,v)=>{ try{ if(v===undefined) return localStorage.getItem("ld_"+k); localStorage.setItem("ld_"+k,String(v)); }catch(_){} return null; };
  const memberName=e=>((S.meta.members||[]).find(m=>m.email===e)||{}).name||String(e||"").split("@")[0];
  const initials=s=>String(s||"").split(/[\s.@_-]+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("");
  const ageShort=v=>{ if(!v) return "—"; const s=Math.max(0,(Date.now()-new Date(v).getTime())/1000); return s<3600?Math.max(1,Math.round(s/60))+" min":s<86400?Math.round(s/3600)+" h":Math.round(s/86400)+" d"; };
  const fmt=v=>n(v).toLocaleString("en-US");
  const canSel=()=>!!(S.meta.me.manager&&(S.tab==="team"||S.tab==="pool"));
  const FILTER_KEYS=["product","svc","plan","ptype","source","reason","temp","assignee"];
  const activeFilters=()=>FILTER_KEYS.filter(k=>S.filters[k]&&(k!=="assignee"||S.tab==="team")).length+(S.batch?1:0);
  function cols(){ return [canSel()?["sel",""]:null,["score","Temp",1],["cust","Customer"],["svc","Product",1],["plan","Plan",1],["ptype","Plan type",1],
    ["source","Channel",1],["reason","Reason",1],["age","Age",1],["status","Status",1],(S.tab==="team"||S.tab==="closed")?["owner","Owner",1]:null,["act",""]].filter(Boolean); }
  const scorePill=x=>`<span class="ld-scp ${x.temp||"none"}" title="${x.score!=null?`Agent 2 score ${x.score} / 100 · ${esc(TEMP_TIP[x.temp]?TEMP_TIP[x.temp]():"")}`:esc(TEMP_TIP.none())}">${x.score!=null?x.score:"–"}<i>${esc(TEMP_LABEL[x.temp]||"new")}</i></span>`;
  function custHtml(x){ const r=x.relation||{}; const b=[];
    if(r.mobile&&r.mobile.active) b.push(`<span class="ld-mini mob" title="${n(r.mobile.active)} active Salam Mobile line(s)">Salam Mobile</span>`);
    if(r.fixed&&r.fixed.orders) b.push(`<span class="ld-mini fx" title="Ordered Salam fiber / 5G before — not a new acquisition">Ordered before</span>`);
    if(r.fixed&&r.fixed.priorLost) b.push(`<span class="ld-mini lost" title="An earlier lead for this person was lost">Lost before</span>`);
    if(n(x.journeys)>1) b.push(`<span class="ld-mini j" title="${n(x.journeys)} journeys by this person while the lead was open">×${n(x.journeys)} journeys</span>`);
    if(x.bss&&!(r.fixed&&r.fixed.orders)) b.push(`<span class="ld-mini fx" title="Salam Fixed (BSS) already knows this person — a current or past Salam Fixed customer">Salam Fixed customer</span>`);
    if(x.lang==="en") b.push(`<span class="ld-mini en" title="Chose English on the journey — call in English">English</span>`);
    const ct=x.city||x.region?`<span class="ct"> · ${esc(x.city||x.region)}</span>`:""; const sh=shownOf(x.id);
    if(sh){ const nm=sh.name||{}, has=nm.en||nm.ar; const fr=NAME_FROM[sh.from]||"";
      return `<div class="ld-cu on" data-cu="${x.id}"><div class="nm2${has?"":" no"}" title="${has?esc([nm.en,nm.ar].filter(Boolean).join(" · "))+(fr?" — name from "+esc(fr):""):esc(NO_NAME)}">${has?esc(nm.en||nm.ar):"No name in Salam's records"}${nm.en&&nm.ar?`<small dir="rtl">${esc(nm.ar)}</small>`:""}${fr?`<small class="fr">from ${esc(fr)}</small>`:""}</div>
      <div class="mb"><a class="ld-tel" href="tel:${esc(sh.tel)}" title="Call ${esc(sh.mobile)}">${I.phone}${esc(sh.mobile)}</a>${sh.email?`<span class="ld-mail" title="${esc(sh.email)}">${I.mail}</span>`:""}${ct}</div><div class="bd"><span class="ld-mini un" title="${sh.how==="reveal"?"Revealed":"Unmasked"} — recorded under your name; masked again when the time runs out">${I.eye}<b data-left="${x.id}">${mmss(sh.until-Date.now())}</b></span>${b.join("")}</div></div>`; }
    return `<div class="ld-cu" data-cu="${x.id}"><div class="nm${x.customer_mask?"":" no"}">${esc(x.customer_mask||"Name not captured")}${canRevealRow(x)?`<button class="ld-eye" data-reveal="${x.id}" title="Reveal the name and number for 90 s — recorded" aria-label="Reveal lead ${x.id}">${I.eye}</button>`:""}</div><div class="mb"><span class="mono">${esc(x.mobile_mask||"")}</span>${ct}</div>${b.length?`<div class="bd">${b.join("")}</div>`:""}</div>`; }
  const prodHtml=x=>`<span class="ld-pd p-${x.product==="5g"?"5g":"ftth"}">${x.product==="5g"?I.g5:I.fiber}${esc(PRODUCT[x.product]||x.product)}</span>`;
  const svcHtml=x=>x.svc_type?`<span class="ld-ty y-${esc(x.svc_type)}">${I[SVC_ICON[x.svc_type]]||""}${esc((S.meta.svc||{})[x.svc_type]||x.svc_type)}</span>`:`<span class="ld-dim">—</span>`;
  /* the table's Product cell: one pill per type of line — FTTH home · FTTB building (fiber greens) · 5G HomeFi router · 5G FWA antenna (5G purples) */
  const typePill=x=>{ const t=x.svc_type||(x.product==="5g"?"5g":"ftth"); return `<span class="ld-pd y-${esc(t)}" title="${esc(PRODUCT[x.product]||x.product)} · ${esc((S.meta.svc||{})[t]||t)}">${I[SVC_ICON[t]]||""}${esc((S.meta.svc||{})[t]||t)}</span>`; };
  /* plan names without what the other columns already say (Salam, Postpaid / Prepaid), the speed in bold; the full name on hover */
  const planShort=v=>{ const t=String(v||"").replace(/^Salam\s+/i,"").replace(/\s*\b(post-?paid|pre-?paid)\b/ig,"").replace(/\s{2,}/g," ").trim()||String(v||"");
    return esc(t).replace(/\b(\d{2,4})(\s?Mbps)?\b/i,(m,a,b)=>`<b>${a}${b||""}</b>`); };
  const planHtml=x=>`<div class="ld-pl" title="${esc(x.plan_label||"")}${x.plan_id?" · plan id "+esc(x.plan_id):""}">${x.plan_label?planShort(x.plan_label):"—"}</div>`;
  const ptypeHtml=x=>x.plan_type?`<span class="ld-ptp ${x.plan_type==="prepaid"?"pre":"post"}">${esc((S.meta.ptypes||{})[x.plan_type]||x.plan_type)}${x.period&&String(x.period)!=="1"?`<small>${esc(x.period)} mo</small>`:""}</span>`:`<span class="ld-dim" title="Plan type not known yet — read from the journey in nexus on the next harvest">—</span>`;
  const srcHtml=x=>`<span class="ld-sr s-${esc(x.source)}" title="${esc((S.meta.sources||{})[x.source]||x.source)}">${esc((S.meta.sourcesShort||{})[x.source]||(S.meta.sources||{})[x.source]||x.source)}</span>${x.dealer&&["sda","qr","sda_promoter"].includes(x.source)?`<div class="ld-sub mono" title="dealer">${esc(x.dealer)}</div>`:""}`;
  const reasonHtml=(x,wide)=>`<span class="ld-rs r-${esc(x.reason_class||"abandoned")}">${esc((S.meta.reasons||{})[x.reason_class]||x.reason_class||"—")}</span><div class="ld-sub${wide?"":" clip"}" title="${esc(x.reason||"")}${x.step_label?" · step: "+esc(x.step_label):""}">${esc(x.reason||x.step_label||"")}</div>`;
  function statusHtml(x,due,wide){ const lb=(S.meta.statuses||{})[x.status]||x.status; const closed=CLOSED_ST.includes(x.status); const sub=[];
    if(n(x.attempts)) sub.push(n(x.attempts)+" call"+(n(x.attempts)>1?"s":""));
    if(x.next_action_at&&!closed){ const late=new Date(x.next_action_at).getTime()<Date.now(); sub.push(late?`<b class="late">overdue ${esc(ago(x.next_action_at).replace(" ago",""))}</b>`:`call back ${esc(ago(x.next_action_at))}`); }
    if(x.status==="won") sub.push(x.won_auto?(x.won_by?"by an order · credited":"ordered on their own"):"by the team");
    if(x.status==="lost"&&x.lost_reason) sub.push(esc(x.lost_reason));
    if(closed&&x.closed_at) sub.push("closed "+esc(ago(x.closed_at)));
    if(x.offer_code&&x.offer_code!=="STD") sub.push(esc(x.offer_code));
    return `<span class="ld-stc st-${esc(x.status)}">${due?`<span class="pulse" title="call back now"></span>`:""}${esc(lb)}</span>${sub.length?`<div class="ld-sub${wide?"":" clip"}" title="${esc(sub.join(" · ").replace(/<[^>]+>/g,""))}">${sub.join(" · ")}</div>`:""}`; }
  const ownerHtml=e=>`<span class="ld-own" title="${esc(e)}"><i>${esc(initials(memberName(e)))}</i>${esc(first(memberName(e)))}</span>`;
  const actHtml=x=>S.tab==="pool"?`<button class="ld-btn s p" data-take="${x.id}">Take</button>`:`<button class="ld-btn s${S.tab==="mine"?" w":""}" data-open="${x.id}">${S.tab==="mine"?I.phone+"Work":"Open"}</button>`;
  function cardHtml(x,due,sel){ const who=x.assignee&&S.tab!=="mine";
    return `<div class="ld-cd"><div class="h">${canSel()?`<input type="checkbox" data-sel="${x.id}" ${sel?"checked":""} aria-label="Select lead ${x.id}">`:""}${scorePill(x)}<div class="w">${custHtml(x)}</div><div class="a">${actHtml(x)}</div></div>
      <div class="l">${typePill(x)}<span class="pl" title="${esc(x.plan_label||"")}">${x.plan_label?planShort(x.plan_label):""}</span>${ptypeHtml(x)}</div>
      <div class="l"><span class="ld-sr s-${esc(x.source)}">${esc((S.meta.sourcesShort||{})[x.source]||x.source)}</span>${x.dealer&&["sda","qr","sda_promoter"].includes(x.source)?`<span class="ld-dim mono">· ${esc(x.dealer)}</span>`:""}<span class="ld-dim">· ${esc(ageShort(x.occurred_at))} ago</span></div>
      <div class="l rs">${reasonHtml(x,true)}</div>
      <div class="l st">${statusHtml(x,due,true)}${who?ownerHtml(x.assignee):""}</div></div>`; }
  function rowHtml(x,cs){
    const closed=CLOSED_ST.includes(x.status); const due=!closed&&x.next_action_at&&new Date(x.next_action_at).getTime()<Date.now()+15*60e3; const sel=S.sel.has(String(x.id));
    const C={ sel:()=>`<td class="c-sel"><input type="checkbox" data-sel="${x.id}" ${sel?"checked":""} aria-label="Select lead ${x.id}"></td>`,
      score:()=>`<td class="c-score">${scorePill(x)}</td>`, cust:()=>`<td class="c-cust">${custHtml(x)}</td>`, svc:()=>`<td class="c-svc">${typePill(x)}</td>`,
      plan:()=>`<td class="c-plan">${planHtml(x)}</td>`, ptype:()=>`<td class="c-ptype">${ptypeHtml(x)}</td>`,
      source:()=>`<td class="c-source">${srcHtml(x)}</td>`, reason:()=>`<td class="c-reason">${reasonHtml(x)}</td>`,
      age:()=>`<td class="c-age" title="${esc(md(x.occurred_at))} KSA"><span class="${Date.now()-new Date(x.occurred_at).getTime()>7*864e5?"ld-dim":""}">${esc(ageShort(x.occurred_at))}</span></td>`,
      status:()=>`<td class="c-status">${statusHtml(x,due)}</td>`, owner:()=>{ const o=S.tab==="closed"?(x.won_by||x.assignee):x.assignee; return `<td class="c-owner">${o?ownerHtml(o):`<span class="ld-dim">${S.tab==="closed"?"—":"Team pool"}</span>`}</td>`; },
      act:()=>`<td class="c-act">${actHtml(x)}</td>` };
    return `<tr class="t-${x.temp||"none"}${due?" due":""}${sel?" sel":""}" data-id="${x.id}" tabindex="0" aria-label="Lead ${x.id}">${cs.map(([k])=>C[k]()).join("")}<td class="c-card" colspan="${cs.length}">${cardHtml(x,due,sel)}</td></tr>`; }
  function tableHtml(rows){
    const cs=cols(), so=S.sort;
    const th=cs.map(([k,l,s])=>{ if(k==="sel") return `<th class="c-sel"><input type="checkbox" id="ldAll" aria-label="Select every lead on this page"></th>`;
      const on=so.col===k; const tip=k==="score"?`Agent 2's score (5–98) of how likely the customer is to order — Hot ${bands().hot}+, Warm ${bands().warm}–${bands().hot-1}, Cold below ${bands().warm}. Click to sort.`:`Sort by ${l.toLowerCase()}`;
      return `<th class="c-${k}${s?" s":""}${on?" on":""}"${s?` data-sort="${k}" tabindex="0" role="columnheader" aria-sort="${on?(so.dir==="asc"?"ascending":"descending"):"none"}" title="${esc(tip)}"`:""}>${esc(l)}${s?`<span class="ar">${on?(so.dir==="asc"?"▲":"▼"):"↕"}</span>`:""}</th>`; }).join("");
    return `<div class="ld-tw"><table class="ld-t"><thead><tr>${th}</tr></thead><tbody>${rows.map(x=>rowHtml(x,cs)).join("")}</tbody></table></div>`; }

  /* toolbar: search · filters with counts · temperature · count, sort, rows per page */
  function toolbarHtml(){
    return `<div class="ld-tb"><div class="r1"><label class="ld-qw">${I.search}<input class="ld-in q" id="ldQ" placeholder="Find: full mobile or ID (exact) · lead # · plan · city · reason · dealer" value="${esc(S.filters.q)}" autocomplete="off" spellcheck="false" aria-label="Find a lead"></label>
        <button class="ld-btn s ld-ftg" id="ldFtg" aria-expanded="false" aria-controls="ldFx">${I.filter}Filters<span class="c" id="ldFn"></span></button><span id="ldUnmB"></span></div>
      <div class="ld-fx" id="ldFx"></div>
      <div class="r2"><div class="lft"><div class="ld-seg" id="ldSeg" role="group" aria-label="Temperature"></div><button class="ld-btn s g ld-how" id="ldHow" aria-expanded="false" aria-controls="ldLegend">${I.info}<span>How temperature works</span></button></div><div class="ld-meta" id="ldMeta"></div></div></div>
      <div id="ldLegend"></div><div id="ldUnm"></div><div id="ldBulk"></div><div id="ldTblBox"><div class="ld-empty">Loading…</div></div><div id="ldPager"></div>`; }
  function selHtml(key,all,opts,facet){
    const cur=S.filters[key]||""; const cnt=facet?new Map(facet.map(x=>[String(x.k),x.n])):null;
    const list=cnt?opts.filter(([v])=>cnt.has(v)||v===cur):opts;
    return `<select class="ld-sel${cur?" on":""}" data-f="${key}" aria-label="${esc(all)}"><option value="">${esc(all)}</option>${list.map(([v,l])=>`<option value="${esc(v)}"${v===cur?" selected":""}>${esc(l)}${cnt&&cnt.has(v)?" · "+fmt(cnt.get(v)):""}</option>`).join("")}</select>`; }
  function renderFilters(){
    const m=S.meta, F=S.facets||{}, box=document.getElementById("ldFx"); if(!box) return;
    const plans=(F.plan||[]).map(x=>[String(x.k),String(x.k)]); if(S.filters.plan&&!plans.find(p=>p[0]===S.filters.plan)) plans.unshift([S.filters.plan,S.filters.plan]);
    box.innerHTML=selHtml("product","All products",[["ftth","Fiber"],["5g","5G"]],F.product)
      +selHtml("svc","All types",Object.entries(m.svc||{}),F.svc)
      +selHtml("plan","All plans",plans,F.plan)
      +selHtml("ptype","Any plan type",[["postpaid","Postpaid"],["prepaid","Prepaid"],["unknown","Plan type not known"]],F.ptype)
      +selHtml("source","All channels",Object.entries(m.sources||{}),F.source)
      +selHtml("reason","All reasons",Object.entries(m.reasons||{}),F.reason)
      +(S.tab==="team"?selHtml("assignee","Everyone",[["none","Not assigned"]].concat((m.members||[]).map(x=>[x.email,x.name])),F.assignee):"")
      +(S.batch?`<span class="ld-chip src">batch #${esc(S.batch)}<button class="ld-xs" id="ldNoBatch" aria-label="Show every batch">${I.x}</button></span>`:"")
      +(activeFilters()?`<button class="ld-btn s g" id="ldReset">${I.x}Clear filters</button>`:"");
    const k=activeFilters(); const fn=document.getElementById("ldFn"); if(fn){ fn.textContent=k?String(k):""; fn.style.display=k?"":"none"; }
    const seg=document.getElementById("ldSeg"); const T=new Map((F.temp||[]).map(x=>[x.k,x.n])); const all=[...T.values()].reduce((a,b)=>a+b,0);
    if(seg) seg.innerHTML=[["","All",all],["hot","Hot",T.get("hot")],["warm","Warm",T.get("warm")],["cold","Cold",T.get("cold")],["none","Not scored",T.get("none")]]
      .map(([v,l,c])=>`<button class="tp-${v||"all"}${(S.filters.temp||"")===v?" on":""}" data-temp="${v}" aria-pressed="${(S.filters.temp||"")===v}" title="${esc(v?TEMP_TIP[v]():"Every temperature")}">${v?`<span class="d"></span>`:""}${esc(l)}<span class="k">${S.facets?fmt(c):""}</span></button>`).join(""); }
  function legendHtml(){
    const sc=(S.meta&&S.meta.scoring)||{}, b=bands();
    const band=(t,pill,range,txt)=>`<div class="b"><span class="ld-scp ${t}">${esc(pill)}<i>${t==="none"?"new":TEMP_LABEL[t]}</i></span><div><b>${t==="none"?"Not scored":TEMP_LABEL[t]+" · "+esc(range)}</b><p>${esc(txt)}</p></div></div>`;
    return `<div class="ld-leg"><div class="bands">
        ${band("hot",`${b.hot}+`,`${b.hot}–98`,"Call first. Strong intent — they reached payment or the confirmation code, booked an appointment, or keep coming back — and it is recent.")}
        ${band("warm",`${b.warm}+`,`${b.warm}–${b.hot-1}`,"Call today. The intent is there but something stopped them: the price, the identity check, stock or the appointment.")}
        ${band("cold",`<${b.warm}`,`below ${b.warm}`,"Lower odds: no coverage at the address, left at the first step, more than two weeks old, or already ordered Salam fiber.")}
        ${band("none","–","","New on the desk — Agent 2 scores new and changed leads every 10 minutes.")}</div>
      <div class="how"><b>How Agent 2 scores a lead (5 to 98)</b>
        <div class="base"><span>Starts from where the customer stopped:</span>${(sc.base||[]).map(x=>`<span class="ld-rs r-${esc(x.cls)}">${esc(x.label)} ${n(x.points)}</span>`).join("")}</div>
        <ul>${(sc.adjust||[]).map(t=>`<li>${esc(t)}</li>`).join("")}</ul></div></div>`; }
  function paintLegend(){ const box=document.getElementById("ldLegend"), b=document.getElementById("ldHow"); const on=pref("legend")==="1";
    if(box) box.innerHTML=on?legendHtml():""; if(b){ b.classList.toggle("on",on); b.setAttribute("aria-expanded",String(on)); } }
  const SORTS=[["smart","Smart order — call-backs due first"],["score:desc","Temperature — hottest first"],["age:asc","Newest first"],["age:desc","Oldest first"],["svc:asc","Product"],["plan:asc","Plan"],["ptype:asc","Plan type"],["source:asc","Channel"],["reason:asc","Reason"],["status:asc","Status"],["owner:asc","Owner"],["journeys:desc","Most journeys"],["calls:desc","Most calls"],["next:asc","Next call-back"]];
  function renderMeta(r){
    const el=document.getElementById("ldMeta"); if(!el) return; const cur=S.sort.col==="smart"?"smart":S.sort.col+":"+S.sort.dir;
    const opts=SORTS.filter(([v])=>!v.startsWith("owner")||S.tab==="team"||S.tab==="closed"); if(!opts.find(o=>o[0]===cur)) opts.push([cur,"By "+S.sort.col+(S.sort.dir==="asc"?" ▲":" ▼")]);
    el.innerHTML=`<span class="ld-cnt"><b>${fmt(r.total)}</b> lead${r.total===1?"":"s"}</span>
      <select class="ld-sel" id="ldSo" aria-label="Sort">${opts.map(([v,l])=>`<option value="${v}"${v===cur?" selected":""}>${esc(l)}</option>`).join("")}</select>
      <select class="ld-sel" id="ldPs" aria-label="Rows per page">${[50,100,200].map(z=>`<option value="${z}"${z===S.size?" selected":""}>${z} rows</option>`).join("")}</select>`;
    el.querySelector("#ldSo").onchange=e=>{ const [c,d]=e.target.value.split(":"); S.sort={col:c,dir:d||"desc"}; S.page=0; listView(document.getElementById("ldBody"),true); };
    el.querySelector("#ldPs").onchange=e=>{ S.size=Number(e.target.value)||100; pref("size",S.size); S.page=0; listView(document.getElementById("ldBody"),true); }; }
  function pagerHtml(r){ if(!r.total) return ""; const pages=Math.max(1,Math.ceil(r.total/r.limit)), pg=Math.floor(r.offset/r.limit)+1; const from=r.offset+1, to=r.offset+r.rows.length;
    return `<div class="ld-pg"><span>${fmt(from)}–${fmt(to)} of <b>${fmt(r.total)}</b></span>${pages>1?`<div class="b"><button class="ld-btn s" data-pg="1" ${pg<=1?"disabled":""} aria-label="First page">«</button><button class="ld-btn s" data-pg="${pg-1}" ${pg<=1?"disabled":""}>‹ Previous</button><span class="n">Page ${pg} of ${pages}</span><button class="ld-btn s" data-pg="${pg+1}" ${pg>=pages?"disabled":""}>Next ›</button><button class="ld-btn s" data-pg="${pages}" ${pg>=pages?"disabled":""} aria-label="Last page">»</button></div>`:""}</div>`; }
  function bindToolbar(el){
    const q=document.getElementById("ldQ"); let qt=null; if(q) q.oninput=()=>{ clearTimeout(qt); qt=setTimeout(()=>{ S.filters.q=q.value.trim(); S.page=0; listView(el,true); },450); };
    const ft=document.getElementById("ldFtg"), fx=document.getElementById("ldFx"); if(ft) ft.onclick=()=>{ const o=fx.classList.toggle("open"); ft.setAttribute("aria-expanded",String(o)); };
    fx.addEventListener("change",e=>{ const s=e.target.closest("[data-f]"); if(!s) return; S.filters[s.dataset.f]=s.value; S.page=0; S.sel.clear(); listView(el,true); });
    fx.addEventListener("click",e=>{ if(e.target.closest("#ldReset")){ FILTER_KEYS.forEach(k=>S.filters[k]=""); S.batch=null; S.page=0; listView(el,true); } else if(e.target.closest("#ldNoBatch")){ S.batch=null; S.page=0; listView(el,true); } });
    document.getElementById("ldSeg").addEventListener("click",e=>{ const b=e.target.closest("[data-temp]"); if(!b) return; S.filters.temp=b.dataset.temp; S.page=0; listView(el,true); });
    document.getElementById("ldTblBox").addEventListener("click",e=>{ const rv=e.target.closest("[data-reveal]"); if(rv){ e.stopPropagation(); revealRow(rv.dataset.reveal); } });
    document.getElementById("ldHow").onclick=()=>{ pref("legend",pref("legend")==="1"?"0":"1"); paintLegend(); };
    paintStrip(); paintLegend();
  }
  function bindTable(el){
    const box=document.getElementById("ldTblBox");
    box.querySelectorAll("th[data-sort]").forEach(th=>{ const go=()=>{ const k=th.dataset.sort; S.sort=S.sort.col===k?{col:k,dir:S.sort.dir==="asc"?"desc":"asc"}:{col:k,dir:["score","journeys","calls"].includes(k)?"desc":"asc"}; S.page=0; listView(el,true); };
      th.onclick=go; th.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } }; });
    box.querySelectorAll("tbody tr").forEach(tr=>{ tr.onclick=e=>{ if(e.target.closest("button,input,a,label")) return; openLead(tr.dataset.id); };
      tr.onkeydown=e=>{ if(e.key==="Enter"&&e.target===tr){ e.preventDefault(); openLead(tr.dataset.id); } }; });
    box.querySelectorAll("[data-open]").forEach(b=>b.onclick=e=>{ e.stopPropagation(); openLead(b.dataset.open); });
    box.querySelectorAll("[data-take]").forEach(b=>b.onclick=async e=>{ e.stopPropagation(); box.querySelectorAll(`[data-take="${b.dataset.take}"]`).forEach(x=>x.disabled=true);
      try{ await post(`/api/fixed/leads/lead/${b.dataset.take}/take`); toast("Taken — it is in your queue",true); listView(el,true); hero(); }catch(x){ toast(x.message); box.querySelectorAll(`[data-take="${b.dataset.take}"]`).forEach(y=>y.disabled=false); } });
    const sync=()=>{ box.querySelectorAll("tbody tr").forEach(tr=>tr.classList.toggle("sel",S.sel.has(tr.dataset.id))); const all=document.getElementById("ldAll"); const ids=(S.list.rows||[]).map(x=>String(x.id));
      if(all){ const k=ids.filter(i=>S.sel.has(i)).length; all.checked=k>0&&k===ids.length; all.indeterminate=k>0&&k<ids.length; } bulkBar(); };
    box.querySelectorAll("[data-sel]").forEach(cb=>cb.onchange=e=>{ e.stopPropagation(); const id=cb.dataset.sel; if(cb.checked) S.sel.add(id); else S.sel.delete(id); box.querySelectorAll(`[data-sel="${id}"]`).forEach(x=>{ if(x!==cb) x.checked=cb.checked; }); sync(); });
    const all=document.getElementById("ldAll"); if(all) all.onchange=()=>{ (S.list.rows||[]).forEach(x=>{ if(all.checked) S.sel.add(String(x.id)); else S.sel.delete(String(x.id)); }); box.querySelectorAll("[data-sel]").forEach(c=>c.checked=S.sel.has(c.dataset.sel)); sync(); };
    sync();
    const pg=document.getElementById("ldPager"); pg.querySelectorAll("[data-pg]").forEach(b=>b.onclick=()=>{ S.page=Math.max(0,Number(b.dataset.pg)-1); listView(el,true).then(()=>{ const t=document.getElementById("ldFx"); if(t) t.closest(".ld-tb").scrollIntoView({block:"start",behavior:"smooth"}); }); });
  }
  async function listView(el,keep){
    if(el.dataset.lv!==S.tab||!document.getElementById("ldTblBox")){ el.dataset.lv=S.tab; S.page=0; el.innerHTML=toolbarHtml(); bindToolbar(el); renderFilters(); }
    else if(!keep) S.page=0;
    const seq=++S.seq; const f=S.filters, so=S.sort;
    const qs=new URLSearchParams({ view:S.tab, limit:String(S.size), offset:String(S.page*S.size), facets:"1" });
    if(so.col==="smart") qs.set("sort","smart"); else { qs.set("sort",so.col); qs.set("dir",so.dir); }
    ["product","svc","plan","ptype","source","reason","temp","q"].forEach(k=>{ if(f[k]) qs.set(k,f[k]); }); if(S.tab==="team"&&f.assignee) qs.set("assignee",f.assignee); if(S.batch) qs.set("batch",S.batch);
    const box=document.getElementById("ldTblBox"); box.classList.add("busy");
    let r; try{ r=await api("/api/fixed/leads/list?"+qs.toString()); }catch(e){ if(seq===S.seq){ box.classList.remove("busy"); box.innerHTML=`<div class="ld-err">${esc(e.message)}</div>`; } return; }
    if(seq!==S.seq) return;                                   // a newer request (filter, page, sort) superseded this one
    if(r.offset>0&&!r.rows.length&&r.total){ S.page=Math.max(0,Math.ceil(r.total/S.size)-1); return listView(el,true); }   // the page emptied (leads taken meanwhile)
    S.list=r; S.facets=r.facets||S.facets; box.classList.remove("busy");
    const c=r.counts||{}; const setc=(id,v,hot)=>{ const x=document.getElementById(id); if(x){ x.textContent=n(v); if(hot!=null) x.classList.toggle("hot",!!hot); } };
    setc("ldCmine",c.mine,n(c.due)); setc("ldCpool",c.pool); setc("ldCteam",c.team);
    renderFilters(); renderMeta(r);
    if(!r.rows.length){ const fl=activeFilters()||f.q;
      box.innerHTML=`<div class="ld-empty"><b>${fl?"No lead matches these filters":S.tab==="mine"?"Your queue is empty":S.tab==="pool"?"The team pool is empty":"Nothing here"}</b>${fl?`<button class="ld-btn s" id="ldClr2">${I.x}Clear the filters and the search</button>`:S.tab==="mine"?"Take leads from the Team pool, or ask your supervisor to assign a batch.":"New leads arrive every 15 minutes from the website, the Salam Home app and SDA."}</div>`;
      const c2=document.getElementById("ldClr2"); if(c2) c2.onclick=()=>{ FILTER_KEYS.forEach(k=>S.filters[k]=""); S.filters.q=""; S.batch=null; const q=document.getElementById("ldQ"); if(q) q.value=""; listView(el,true); };
      document.getElementById("ldPager").innerHTML=""; bulkBar(); return; }
    box.innerHTML=tableHtml(r.rows); document.getElementById("ldPager").innerHTML=pagerHtml(r); bindTable(el); paintStrip(); stickTop();
    if(unmaskOn()) unmaskVisible();
  }

  /* ---------------------------------------------------------------- unmask (alpha.168) — one lead from its row (the audited 90 s reveal) or
   * the page for a few minutes (POST /unmask: supervisors any list, members their own leads; recorded lead by lead as pii.unmask). Contacts
   * live in this page's memory only, never in storage; the clock, "Mask now" or leaving Leads masks them again. */
  /* the table's header sticks under the console header and the Fixed hub bar (both sticky) */
  function stickTop(){ const hb=document.querySelector(".fx-hubbar"), root=document.getElementById("ldRoot"); if(!root) return;
    const hdr=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hdr"))||55;
    root.style.setProperty("--ld-top",(hb&&getComputedStyle(hb).position==="sticky"?Math.round(hdr+hb.getBoundingClientRect().height):hdr)+"px"); }
  let stickT=null; window.addEventListener("resize",()=>{ clearTimeout(stickT); stickT=setTimeout(stickTop,150); });
  function paintCust(id){ const x=((S.list&&S.list.rows)||[]).find(r=>String(r.id)===String(id)); if(!x) return; document.querySelectorAll(`[data-cu="${id}"]`).forEach(c=>{ c.outerHTML=custHtml(x); }); }
  function startTick(){ if(S.tick) return;
    S.tick=setInterval(()=>{ const now=Date.now();
      [...S.shown.entries()].forEach(([k,v])=>{ if(v.until<=now){ S.shown.delete(k); paintCust(k); if(S.open===k) fillLead(k); } });
      if(S.unmaskUntil&&S.unmaskUntil<=now) stopUnmask();
      document.querySelectorAll("[data-left]").forEach(t=>{ const k=t.dataset.left; t.textContent=mmss(k==="strip"?S.unmaskUntil-now:((S.shown.get(k)||{}).until||0)-now); });
      if(!S.shown.size&&!unmaskOn()){ clearInterval(S.tick); S.tick=null; } },1000); }
  async function revealRow(id){
    const bs=document.querySelectorAll(`[data-reveal="${id}"]`); bs.forEach(b=>b.disabled=true);
    let r; try{ r=await post(`/api/fixed/leads/lead/${id}/reveal`); }catch(e){ toast(e.message); bs.forEach(b=>b.disabled=false); return; }
    S.shown.set(String(id),{ name:r.name||{}, from:r.from||null, email:r.email||null, lang:r.lang||null, mobile:r.mobile, tel:r.tel, until:Date.now()+(n(r.seconds)||90)*1000, how:"reveal" });
    const u=document.getElementById("ldRevealUse"); if(u&&r.used) u.textContent=`reveals ${n(r.used.hour)} / ${n(r.used.perHour)} per hour`;
    paintCust(id); startTick(); }
  async function unmaskVisible(){
    if(!unmaskOn()||!S.list||!unmaskHere()) return;
    const ids=(S.list.rows||[]).filter(x=>unmaskable(x)&&!shownOf(x.id)).map(x=>x.id); if(!ids.length) return;
    let r; try{ r=await post("/api/fixed/leads/unmask",{ids,view:S.tab}); }catch(e){ toast(e.message); if(e.status===403||e.status===429) stopUnmask(true); return; }
    if(S.unmaskFresh){ S.unmaskFresh=false; const t=Date.parse(r.until); if(t) S.unmaskUntil=t; }
    S.unmaskUsed=n(r.used); S.unmaskPerDay=r.perDay; let k=0;
    Object.entries(r.contacts||{}).forEach(([id,c])=>{ if(c&&c.mobile){ S.shown.set(String(id),{ name:c.name||{}, from:c.from||null, email:c.email||null, lang:c.lang||null, mobile:c.mobile, tel:c.tel, until:S.unmaskUntil, how:"unmask" }); k++; } });
    ids.forEach(paintCust); paintStrip(); startTick();
    const miss=ids.length-k; if(miss>0) toast(`${k} unmasked · ${miss} without a readable number in their source`); }
  function stopUnmask(quiet){ const was=S.unmaskUntil>0; S.unmaskUntil=0; S.unmaskFresh=false;
    [...S.shown.entries()].forEach(([k,v])=>{ if(v.how==="unmask"){ S.shown.delete(k); paintCust(k); if(S.open===k) fillLead(k); } });
    paintStrip(); if(was&&!quiet) toast("Contacts masked again"); }
  function paintStrip(){
    const b=document.getElementById("ldUnmB"), st=document.getElementById("ldUnm"); if(!b&&!st) return; const on=unmaskOn(), u=S.meta.unmask||{};
    if(b){ b.innerHTML=unmaskHere()&&!on?`<button class="ld-btn s r" id="ldUnmask" title="Show the names and numbers of this page for ${n(u.minutes)} min — recorded lead by lead">${I.eye}<span>Unmask</span></button>`:"";
      const ub=document.getElementById("ldUnmask"); if(ub) ub.onclick=confirmUnmask; }
    if(st){ st.innerHTML=on?`<div class="ld-unm" role="status">${I.eye}<span><b>Unmasked view</b> · contacts shown for <b data-left="strip">${mmss(S.unmaskUntil-Date.now())}</b>${unmaskHere()?"":" · this list stays masked (your own leads only)"} · every lead shown is recorded under your name${S.unmaskPerDay?` · ${fmt(S.unmaskUsed)} / ${fmt(S.unmaskPerDay)} today`:""}</span><button class="ld-btn s" id="ldMaskNow">${I.lock}Mask now</button></div>`:"";
      const mn=document.getElementById("ldMaskNow"); if(mn) mn.onclick=()=>stopUnmask(); } }
  function confirmUnmask(){
    const u=S.meta.unmask||{}; const rows=((S.list&&S.list.rows)||[]).filter(unmaskable);
    if(!rows.length) return toast(u.scope==="any"?"Nothing to unmask on this page":"Only your own leads can be unmasked — take leads from the pool first");
    const mb=document.createElement("div"); mb.className="ld-mb";
    mb.innerHTML=`<div class="ld-md" role="dialog" aria-modal="true" aria-labelledby="ldMdT"><div class="hd"><b id="ldMdT">${I.eye}Unmask the contacts on this page?</b><small>Restricted · recorded lead by lead</small></div>
      <div class="bd"><p>The names and mobile numbers of the <b>${rows.length}</b> lead${rows.length===1?"":"s"} on this page${u.scope==="any"?"":" (your own leads)"} are shown for <b>${n(u.minutes)} minutes</b>. Pages you open meanwhile are unmasked too.</p>
        <ul><li>Each lead shown is recorded under your name — audit <i>pii.unmask</i> and the lead's timeline.</li><li>${u.capped?`Daily limit: ${fmt(u.perDay)} leads per person; the console owners are told when it is reached.`:"Super admin: recorded, no daily limit."}</li><li>Never copy, photograph or share them. "Mask now", the clock or leaving Leads hides them again.</li></ul></div>
      <div class="ft"><button class="ld-btn g" data-x>Cancel</button><button class="ld-btn r" data-go>${I.eye}Unmask ${rows.length} lead${rows.length===1?"":"s"}</button></div></div>`;
    document.body.appendChild(mb);
    const esc2=e=>{ if(e.key==="Escape") close(); }; const close=()=>{ mb.remove(); document.removeEventListener("keydown",esc2); };
    document.addEventListener("keydown",esc2); mb.onclick=e=>{ if(e.target===mb) close(); }; mb.querySelector("[data-x]").onclick=close;
    const go=mb.querySelector("[data-go]"); go.focus();
    go.onclick=()=>{ close(); S.unmaskUntil=Date.now()+n(u.minutes)*60e3; S.unmaskFresh=true; paintStrip(); unmaskVisible(); }; }
  function bulkBar(){
    const el=document.getElementById("ldBulk"); if(!el) return; if(!S.sel.size){ el.innerHTML=""; return; }
    const ms=S.meta.members||[];
    el.innerHTML=`<div class="ld-bulk">${S.sel.size} selected · <select class="ld-sel" id="ldBto"><option value="">Assign to…</option>${ms.map(m=>`<option value="${esc(m.email)}">${esc(m.name)}</option>`).join("")}<option value="__pool">Back to the pool</option></select>
      <button class="ld-btn s p" id="ldBgo">Assign</button><span style="opacity:.6">or</span><button class="ld-btn s" id="ldBspread">Spread across the team</button><button class="ld-btn s g" id="ldBclr">Clear</button></div>`;
    const ids=()=>[...S.sel].map(Number);
    document.getElementById("ldBgo").onclick=async()=>{ const v=document.getElementById("ldBto").value; if(!v) return toast("Choose who receives them");
      try{ const r=await post("/api/fixed/leads/assign",{ids:ids(),mode:"one",to:v==="__pool"?null:v}); toast(`${r.assigned} lead(s) assigned`,true); S.sel.clear(); body(); hero(); }catch(e){ toast(e.message); } };
    document.getElementById("ldBspread").onclick=async()=>{ const list=ms.filter(m=>!m.notOcu).map(m=>m.email); if(!list.length) return toast("No OCU member yet");
      try{ const r=await post("/api/fixed/leads/assign",{ids:ids(),mode:"spread",members:list}); toast(`${r.assigned} lead(s) spread across ${Object.keys(r.counts).length} member(s)`,true); S.sel.clear(); body(); hero(); }catch(e){ toast(e.message); } };
    document.getElementById("ldBclr").onclick=()=>{ S.sel.clear(); document.querySelectorAll("[data-sel]").forEach(c=>c.checked=false); bulkBar(); };
  }

  /* ---------------------------------------------------------------- drawer */
  function closeLead(){ const d=document.getElementById("ldDr"), s=document.getElementById("ldScrim"); if(d){ d.classList.remove("on"); setTimeout(()=>d.remove(),260); } if(s){ s.classList.remove("on"); setTimeout(()=>s.remove(),220); }
    clearInterval(S.revealT); S.open=null; try{ const h=location.hash.replace(/&lead=\d+/,""); history.replaceState(null,"",h); }catch(_){} document.removeEventListener("keydown",escClose); }
  const escClose=e=>{ if(e.key==="Escape") closeLead(); };
  async function openLead(id){
    S.open=String(id);
    let sc=document.getElementById("ldScrim"); if(!sc){ sc=document.createElement("div"); sc.id="ldScrim"; sc.className="ld-scrim"; document.body.appendChild(sc); sc.onclick=closeLead; }
    let d=document.getElementById("ldDr"); if(!d){ d=document.createElement("div"); d.id="ldDr"; d.className="ld-dr"; d.setAttribute("role","dialog"); document.body.appendChild(d);
      d.addEventListener("copy",e=>{ const t=e.target; if(t&&t.closest&&t.closest("input,textarea")) return; e.preventDefault(); toast("Copy is disabled in Leads"); },true); }
    d.innerHTML=`<div class="dh"><div><h3>Lead #${esc(id)}</h3><div class="sub">loading…</div></div><button class="ld-x" id="ldX" aria-label="Close">${I.x}</button></div><div class="db"></div>`;
    d.querySelector("#ldX").onclick=closeLead; requestAnimationFrame(()=>{ sc.classList.add("on"); d.classList.add("on"); });
    document.addEventListener("keydown",escClose);
    try{ const h=location.hash.replace(/&lead=\d+/,""); history.replaceState(null,"",h+(h.includes("?")?"&":"?")+"lead="+id); }catch(_){}
    await fillLead(id);
  }
  async function fillLead(id){
    const d=document.getElementById("ldDr"); if(!d) return;
    let r; try{ r=await api(`/api/fixed/leads/lead/${id}`); }catch(e){ d.querySelector(".db").innerHTML=`<div class="ld-err">${esc(e.message)}</div>`; d.querySelector(".sub").textContent=""; return; }
    const L=r.lead, a=r.advice, can=r.can, m=S.meta; const rel=L.relation||{}; const hist=r.history||{};
    d.querySelector(".dh").innerHTML=`${scoreBox(L).replace('class="sc','class="sc" style="width:52px;height:52px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-weight:850" data-x="')}
      <div style="min-width:0"><h3><span class="mask" style="font-family:var(--mono,monospace)">${esc(L.customer_mask||"—")}</span>${statusChip(L)}${typePill(L)}</h3>
        <div class="sub">Lead #${esc(L.id)} · ${esc(m.sources[L.source]||L.source)} · ${esc(PRODUCT[L.product]||L.product)} · ${esc(L.plan_label||"")} · ${esc(ago(L.occurred_at))}${L.assignee?` · ${esc(((m.members||[]).find(x=>x.email===L.assignee)||{}).name||L.assignee)}`:" · in the team pool"}</div></div>
      <button class="ld-x" id="ldX" aria-label="Close">${I.x}</button>`;
    d.querySelector("#ldX").onclick=closeLead;
    const sc=d.querySelector(".dh .sc"); if(sc){ sc.className="sc "+(L.temp||"none"); sc.removeAttribute("data-x"); sc.style.cssText="width:52px;height:52px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:850;font-size:17px;flex:none;"+(L.temp?"color:#fff;background:"+(L.temp==="hot"?"linear-gradient(135deg,#ef4444,#b91c1c)":L.temp==="warm"?"linear-gradient(135deg,#f59e0b,#d97706)":"linear-gradient(135deg,#38bdf8,#0369a1)"):"color:var(--muted);background:var(--bg);border:1px dashed var(--line)"); }
    const closed=["won","lost","unreachable","dnc","duplicate"].includes(L.status);
    const offers=m.offers||[]; const offerOf=c=>offers.find(o=>o.code===c);
    const path=(a&&a.path&&a.path.length?a.path:["STD"]).map(offerOf).filter(Boolean);
    const sh=shownOf(L.id);
    const callCard=`<div class="ld-call" id="ldCall">
        ${sh?`<div style="flex:1;min-width:220px"><div class="nm">${esc((sh.name&&(sh.name.ar||sh.name.en))||"No name in Salam's records")}<small>${esc((sh.name&&sh.name.ar&&sh.name.en)?sh.name.en:"")}${NAME_FROM[sh.from]?" · name from "+esc(NAME_FROM[sh.from]):""}</small></div><div class="num">${esc(sh.mobile)}</div>
          ${sh.email||sh.lang?`<div class="tm">${sh.email?`${I.mail}${esc(sh.email)}`:""}${sh.email&&sh.lang?" · ":""}${sh.lang?(sh.lang==="en"?"speaks English":"speaks Arabic"):""}</div>`:""}
          <div class="tm">${I.lock}${sh.how==="unmask"?"Unmasked":"Revealed"} · recorded · hides in <b data-left="${esc(L.id)}">${mmss(sh.until-Date.now())}</b></div></div><a class="ld-btn p" href="tel:${esc(sh.tel)}">${I.phone}Call now</a>${can.take?`<button class="ld-btn" id="ldTake">Take this lead</button>`:""}`
        :can.take?`<div style="flex:1;min-width:220px"><div class="nm">This lead is in the team pool<small>${can.manage&&can.reveal?"Take it to work it, or reveal the number now — recorded.":"Take it to reveal the number and call — it moves to your queue."}</small></div></div>${can.manage&&can.reveal?`<button class="ld-btn r" id="ldReveal">${I.eye}Reveal & call</button>`:""}<button class="ld-btn p" id="ldTake">Take this lead</button>`
        :can.reveal?`<div style="flex:1;min-width:220px"><div class="num">${esc(L.mobile_mask||"—")}</div><div class="tm">${I.lock}Revealed for 90 s · recorded · ${esc(m.reveal.perHour)} per hour max</div></div><button class="ld-btn r" id="ldReveal">${I.eye}Reveal & call</button>`
        :`<div class="nm">${L.status==="dnc"?"The customer asked not to be called.":"This lead is in another member's queue."}</div>`}</div>`;
    const journey=`<div class="ld-card"><h4>${I.clock}Where the customer stopped</h4><div class="ld-kv">
        <div><span>Step</span>${esc(L.step_label||"—")}</div><div><span>Why</span>${esc(L.reason||"—")}</div><div><span>When</span>${esc(md(L.occurred_at))} KSA</div>
        <div><span>Channel</span>${esc(m.sources[L.source]||L.source)}${L.dealer?" · "+esc(L.dealer):""}</div><div><span>Journeys</span>${n(L.journeys)} by this person</div><div><span>Area</span>${esc([L.city,L.region].filter(Boolean).join(" · ")||"—")}</div>
        ${L.facts&&L.facts.invoice?`<div><span>Card</span>${esc(L.facts.invoice)}</div>`:""}${L.facts&&L.facts.nafath?`<div><span>Nafath</span>${esc(L.facts.nafath)}</div>`:""}${L.facts&&L.facts.dealerReason?`<div style="grid-column:1/-1"><span>Dealer's reason</span>${esc(L.facts.dealerReason)}</div>`:""}
        <div><span>ID type</span>${esc(L.nid_kind||"—")}</div></div></div>`;
    const relCard=`<div class="ld-card"><h4>${I.users}Relationship with Salam</h4><div class="ld-kv">
        <div><span>Salam Mobile</span>${rel.mobile?(rel.mobile.active?`<b style="color:var(--green-dark,#0a7a45)">Customer · ${n(rel.mobile.active)} active order(s)</b>`:"Not a mobile customer"):"Unknown"}</div>
        <div><span>Fixed before</span>${n(hist.orders)?`<b style="color:#b91c1c">${n(hist.orders)} order(s)${hist.lastOrderAt?" · last "+esc(md(hist.lastOrderAt)):""}</b>`:n(hist.journeys)?`${n(hist.journeys)} other journey(s), no order`:"No other journey seen"}</div>
        <div><span>Earlier leads</span>${n(hist.priorLeads)?`${n(hist.priorLeads)} · won ${n(hist.priorWon)} · lost ${n(hist.priorLost)}`:"None"}</div></div>
        ${n(hist.orders)&&L.product==="ftth"?`<div class="ld-note" style="margin-top:8px">Ordered fiber before — the OCU discount is for new acquisitions only: pitch the standard plans.</div>`:""}</div>`;
    const coach=`<div class="ld-card ld-coach"><h4>${I.spark}Agent 2 · coach${a?` <span style="margin-left:auto;font-size:10.5px;letter-spacing:0;text-transform:none;font-weight:600;color:var(--muted)">${a.deterministic?"rules":"model "+esc(a.model||"")} · ${esc(ago(a.at))}</span>`:""}</h4>
        ${a?`<div class="ld-path">${path.map((o,i)=>`<div class="ld-step${i===0?" first":""}"><div class="n">${i===0?"Start here":"If declined · step "+(i+1)}</div><b>${esc(o.label)}</b>${o.offer?`<div class="pr"><s>${n(o.price)} SAR</s> → <em>${n(o.offer)} SAR</em> × ${n(o.months)} months · ${esc(o.speed||"")}</div>`:`<div class="pr">${esc(o.detail||"")}</div>`}</div>`).join("")}</div>
          <div class="ld-say" dir="rtl" lang="ar">${esc(a.opener_ar||"")}</div><div class="ld-say">${esc(a.opener_en||"")}</div>
          <ul class="ld-pts">${(a.points||[]).map(p=>`<li>${esc(p)}</li>`).join("")}</ul>
          <div class="ld-kv" style="margin-top:10px"><div><span>Best time to call</span>${esc(a.best_time||"—")}</div><div><span>Next action</span>${esc(a.next_action||"—")}</div><div style="grid-column:1/-1"><span>Why this score</span>${esc(a.why||"—")}</div></div>
          <div class="ld-obj">${(a.objections||[]).map(o=>`<details><summary>“${esc(o.objection)}”</summary><p>${esc(o.answer)}</p></details>`).join("")}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center"><button class="ld-btn s" id="ldAsk">${I.spark}Ask Agent 2 again</button><span style="flex:1"></span><span class="ld-note">Useful?</span><button class="ld-btn s ${a.helpful===true?"on":""}" data-fb="true" aria-label="helpful">${I.up}</button><button class="ld-btn s ${a.helpful===false?"on":""}" data-fb="false" aria-label="not helpful">${I.down}</button></div>`
        :`<div class="ld-note" style="margin-bottom:10px">No advice yet — Agent 2 coaches every new lead within 10 minutes.</div><button class="ld-btn s" id="ldAsk">${I.spark}Ask Agent 2 now</button>`}</div>`;
    const outcomes=can.work&&!closed?`<div class="ld-card"><h4>${I.phone}Log the call</h4><div class="ld-res">${RES_GROUPS.map(([g,keys])=>`<div class="grp">${esc(g)}</div><div class="row">${keys.map(k=>`<button class="ld-btn s ${k==="won"?"won":""}" data-res="${k}">${esc(m.results[k]||k)}</button>`).join("")}</div>`).join("")}</div><div id="ldForm"></div></div>`
      :closed?`<div class="ld-card"><h4>${I.trophy}Outcome</h4><div style="font-size:13px;color:var(--ink)">${L.status==="won"?`Won ${L.won_auto?"by an order seen in SDA / the website":""}${L.won_ref?" · order "+esc(L.won_ref):""}${L.won_by?" · credited to "+esc(((m.members||[]).find(x=>x.email===L.won_by)||{}).name||L.won_by):""}`:esc(m.statuses[L.status]||L.status)+(L.lost_reason?" · "+esc(L.lost_reason):"")}</div>${can.manage?`<button class="ld-btn s" id="ldReopen" style="margin-top:10px">Reopen</button>`:""}</div>`:"";
    const remark=`<div class="ld-card"><h4>${I.tag}Remark</h4><div class="ld-cmt"><textarea class="ld-in" id="ldRem" placeholder="Short remark for whoever opens this lead next (no numbers — they are masked)" ${can.work?"":"disabled"}>${esc(L.remark||"")}</textarea>${can.work?`<button class="ld-btn s" id="ldRemB">Save</button>`:""}</div></div>`;
    const evLabel=e=>{ const x=e.detail||{}; switch(e.kind){ case "created": return x.source==="import"?"Imported in batch #"+esc(x.batch):"Lead created from the journey";
      case "attempt": return `Another attempt · ${esc(m.sources[x.source]||x.source)}${x.step?" · "+esc(x.step):""}${x.reason?" — "+esc(x.reason):""}`;
      case "assigned": return x.to?(x.self?"Took the lead":"Assigned to "+esc(((m.members||[]).find(y=>y.email===x.to)||{}).name||x.to)):"Back to the pool";
      case "reveal": return "Revealed the number"; case "unmask": return `Contact unmasked in the list${x.view?" ("+esc(x.view)+")":""}`; case "view": return "Opened the lead";
      case "call": return `${esc(m.results[x.result]||x.result)}${x.callbackAt?" · call back "+esc(md(x.callbackAt)):""}${x.offer?" · "+esc(x.offer):""}${x.lost_reason?" · "+esc(x.lost_reason):""}${x.note?" — “"+esc(x.note)+"”":""}`;
      case "offer": return `Offer ${esc(x.offer)}${x.months?" · "+x.months+" months":""}`;
      case "won": return x.auto?`Won — the customer ordered (${esc(x.how==="sda_account"?"SDA account "+(x.staff||""):x.how==="contacted"?"after our call":"on their own")}${x.ref?" · "+esc(x.ref):""})`:`Order placed${x.orderRef?" · "+esc(x.orderRef):""}${x.offer?" · "+esc(x.offer):""}`;
      case "comment": return "“"+esc(x.text)+"”"; case "remark": return "Remark: "+esc(x.text||"(cleared)"); case "ai": return `Asked Agent 2 · score ${esc(x.score)}`;
      case "expired": return `Closed — nobody called it within ${esc(x.days)} days`;
      case "reopen": return "Reopened"; case "priority": return "Priority "+esc(x.priority); default: return esc(e.kind); } };
    const tl=`<div class="ld-card"><h4>${I.clock}Comments & timeline</h4><div class="ld-cmt" style="margin-bottom:10px"><textarea class="ld-in" id="ldCm" placeholder="Add a comment for the team"></textarea><button class="ld-btn s p" id="ldCmB">Post</button></div>
      <ul class="ld-tl">${(r.events||[]).map(e=>`<li><span class="w">${esc(md(e.at))}</span><span><b>${esc(e.who)}</b> · ${evLabel(e)}${e.points?`<span class="pt">+${e.points}</span>`:""}</span></li>`).join("")}</ul></div>`;
    d.querySelector(".db").innerHTML=callCard+coach+outcomes+journey+relCard+remark+tl;
    /* bindings */
    const tk=d.querySelector("#ldTake"); if(tk) tk.onclick=async()=>{ tk.disabled=true; try{ await post(`/api/fixed/leads/lead/${L.id}/take`); toast("Taken — it is in your queue",true); fillLead(L.id); refreshList(); }catch(e){ toast(e.message); tk.disabled=false; } };
    const rv=d.querySelector("#ldReveal"); if(rv) rv.onclick=()=>reveal(L);
    const ask=d.querySelector("#ldAsk"); if(ask) ask.onclick=async()=>{ ask.disabled=true; ask.innerHTML=`${I.spark}Thinking…`; try{ const x=await post(`/api/fixed/leads/lead/${L.id}/advise`); toast(x.model?"Agent 2 updated the advice":"Advice refreshed (rules — the model is not available)",true); fillLead(L.id); }catch(e){ toast(e.message); ask.disabled=false; } };
    d.querySelectorAll("[data-fb]").forEach(b=>b.onclick=async()=>{ try{ await post(`/api/fixed/leads/lead/${L.id}/advice/feedback`,{helpful:b.dataset.fb==="true"}); d.querySelectorAll("[data-fb]").forEach(x=>x.classList.toggle("on",x===b)); toast("Thanks — Agent 2 learns from it",true); }catch(e){ toast(e.message); } });
    d.querySelectorAll("[data-res]").forEach(b=>b.onclick=()=>outcomeForm(L,b.dataset.res,path));
    const rb=d.querySelector("#ldRemB"); if(rb) rb.onclick=async()=>{ try{ await post(`/api/fixed/leads/lead/${L.id}/remark`,{text:d.querySelector("#ldRem").value}); toast("Remark saved",true); fillLead(L.id); }catch(e){ toast(e.message); } };
    const cb=d.querySelector("#ldCmB"); if(cb) cb.onclick=async()=>{ const t=d.querySelector("#ldCm").value.trim(); if(!t) return; try{ await post(`/api/fixed/leads/lead/${L.id}/comment`,{text:t}); fillLead(L.id); }catch(e){ toast(e.message); } };
    const ro=d.querySelector("#ldReopen"); if(ro) ro.onclick=async()=>{ try{ await post(`/api/fixed/leads/lead/${L.id}/reopen`); toast("Reopened",true); fillLead(L.id); refreshList(); }catch(e){ toast(e.message); } };
  }
  async function reveal(L){
    const box=document.getElementById("ldCall"); if(!box) return; const b=box.querySelector("#ldReveal"); if(b) b.disabled=true;
    let r; try{ r=await post(`/api/fixed/leads/lead/${L.id}/reveal`); }catch(e){ toast(e.message); if(b) b.disabled=false; return; }
    S.shown.set(String(L.id),{ name:r.name||{}, from:r.from||null, email:r.email||null, lang:r.lang||null, mobile:r.mobile, tel:r.tel, until:Date.now()+(n(r.seconds)||90)*1000, how:"reveal" }); paintCust(L.id);
    let left=n(r.seconds)||90; const ring=s=>{ const p=Math.max(0,s/(n(r.seconds)||90)); const c=2*Math.PI*15; return `<svg class="ld-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" stroke-width="3"/><circle cx="18" cy="18" r="15" fill="none" stroke="#b91c1c" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-p)}" transform="rotate(-90 18 18)"/><text x="18" y="22" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">${s}</text></svg>`; };
    const paint=()=>{ box.innerHTML=`<div style="flex:1;min-width:220px"><div class="nm">${esc((r.name&&(r.name.ar||r.name.en))||"No name in Salam's records")}<small>${esc((r.name&&r.name.ar&&r.name.en)?r.name.en:"")}${NAME_FROM[r.from]?" · name from "+esc(NAME_FROM[r.from]):""}</small></div><div class="num">${esc(r.mobile)}</div>
      ${r.email||r.lang?`<div class="tm">${r.email?`${I.mail}${esc(r.email)}`:""}${r.email&&r.lang?" · ":""}${r.lang?(r.lang==="en"?"speaks English":"speaks Arabic"):""}</div>`:""}
      <div class="tm">${I.lock}Recorded · hides in ${left} s · ${n(r.used.hour)} / ${n(r.used.perHour)} reveals this hour</div></div>${ring(left)}<a class="ld-btn p" href="tel:${esc(r.tel)}" id="ldDial">${I.phone}Call now</a>`; };
    paint(); const u=document.getElementById("ldRevealUse"); if(u) u.textContent=`reveals ${n(r.used.hour)} / ${n(r.used.perHour)} per hour`;
    clearInterval(S.revealT); S.revealT=setInterval(()=>{ left--; if(left<=0||!document.getElementById("ldCall")){ clearInterval(S.revealT); if(document.getElementById("ldCall")) fillLead(L.id); return; } paint(); },1000);
    const hide=()=>{ if(document.hidden){ clearInterval(S.revealT); if(document.getElementById("ldCall")) fillLead(L.id); document.removeEventListener("visibilitychange",hide); } };
    document.addEventListener("visibilitychange",hide);
  }
  function outcomeForm(L,res,path){
    const f=document.getElementById("ldForm"); if(!f) return; const m=S.meta;
    const offers=(m.offers||[]).filter(o=>o.product==="any"||o.product===L.product);
    const def=(path||[]).map(o=>o.code).find(c=>offers.find(o=>o.code===c))||(offers[0]||{}).code;
    const ksaLocal=t=>new Date(t+3*3600e3).toISOString().slice(0,16);
    const preset=(h,l)=>`<button class="ld-btn s" data-pre="${h}">${l}</button>`;
    const nowK=new Date(Date.now()+3*3600e3); const at=(dd,hh)=>{ const x=new Date(Date.UTC(nowK.getUTCFullYear(),nowK.getUTCMonth(),nowK.getUTCDate()+dd,hh,0)); return x.getTime()-3*3600e3; };
    let html=`<div class="ld-form"><b style="font-size:13px;color:var(--ink)">${esc(m.results[res])}</b>`;
    if(["callback","interested","offer_made","no_answer","busy"].includes(res)) html+=`<label>${res==="callback"?"Call back at (KSA)":"Next call (KSA, optional)"}<div class="ld-preset">${preset(Date.now()+3600e3,"In 1 hour")}${preset(at(0,20),"Today 20:00")}${preset(at(1,10),"Tomorrow 10:00")}${preset(at(1,17),"Tomorrow 17:00")}</div><input type="datetime-local" class="ld-in" id="ldCbAt" value="${res==="callback"?ksaLocal(Date.now()+3600e3):""}"></label>`;
    if(["offer_made","won"].includes(res)) html+=`<label>Offer<select class="ld-sel" id="ldOff">${offers.map(o=>`<option value="${esc(o.code)}"${o.code===def?" selected":""}>${esc(o.label)}${o.offer?` — ${o.offer} SAR × ${o.months} m`:""}</option>`).join("")}</select></label>`;
    if(res==="won") html+=`<label>Order / service number (SDA)<input class="ld-in" id="ldRef" placeholder="e.g. the SDA order number"></label>`;
    if(res==="not_interested") html+=`<label>Reason<div class="ld-preset" id="ldLr">${(m.lostReasons||[]).map(x=>`<button class="ld-btn s" data-lr="${esc(x)}">${esc(x)}</button>`).join("")}</div></label>`;
    if(res==="dnc") html+=`<div class="ld-note">The lead closes and nobody calls this customer from the OCU desk again.</div>`;
    html+=`<label>Note (optional)<textarea class="ld-in" id="ldNote" placeholder="What the customer said — numbers are masked"></textarea></label><div style="display:flex;gap:8px"><button class="ld-btn ${res==="won"?"p":"p"}" id="ldSave">${res==="won"?I.trophy+"Confirm the order":"Save"}</button><button class="ld-btn g" id="ldCancel">Cancel</button></div></div>`;
    f.innerHTML=html; f.scrollIntoView({behavior:"smooth",block:"nearest"});
    let lost=null;
    f.querySelectorAll("[data-pre]").forEach(b=>b.onclick=()=>{ const i=f.querySelector("#ldCbAt"); if(i) i.value=ksaLocal(Number(b.dataset.pre)); });
    f.querySelectorAll("[data-lr]").forEach(b=>b.onclick=()=>{ lost=b.dataset.lr; f.querySelectorAll("[data-lr]").forEach(x=>x.classList.toggle("on",x===b)); });
    f.querySelector("#ldCancel").onclick=()=>{ f.innerHTML=""; };
    f.querySelector("#ldSave").onclick=async()=>{
      const body={ result:res, note:(f.querySelector("#ldNote")||{}).value||"" };
      const cbv=f.querySelector("#ldCbAt"); if(cbv&&cbv.value){ const t=new Date(cbv.value+":00+03:00"); if(!isNaN(t)) body.callbackAt=t.toISOString(); }
      const off=f.querySelector("#ldOff"); if(off) body.offerCode=off.value;
      const ref=f.querySelector("#ldRef"); if(ref) body.orderRef=ref.value.trim();
      if(res==="not_interested"){ if(!lost) return toast("Pick the reason"); body.lostReason=lost; }
      const sv=f.querySelector("#ldSave"); sv.disabled=true;
      try{ const r=await post(`/api/fixed/leads/lead/${L.id}/outcome`,body);
        if(res==="won"){ confetti(); toast(`Order placed — +${n(r.points)} points. Great job!`,true); } else toast(`${m.results[res]} saved${n(r.points)?` · +${n(r.points)} points`:""}`,true);
        fillLead(L.id); refreshList(); hero(); }
      catch(e){ toast(e.message); sv.disabled=false; }
    };
  }
  function refreshList(){ if(["mine","pool","team","closed"].includes(S.tab)){ const el=document.getElementById("ldBody"); if(el) listView(el,true); } }

  /* ---------------------------------------------------------------- team & challenges */
  async function boardView(el){
    el.innerHTML=`<div class="ld-empty">Loading…</div>`;
    try{ S.board=await api("/api/fixed/leads/board"); }catch(e){ el.innerHTML=`<div class="ld-err">${esc(e.message)}</div>`; return; }
    const b=S.board, lb=b.leaderboard, mgr=S.meta.me.manager;
    const pod=[lb[1],lb[0],lb[2]].map((x,i)=>{ const rk=[2,1,3][i]; return x?`<div class="p r${rk}"><div class="m">${rk}</div><b>${esc(x.name)}</b><span>${n(x.points)} pts · ${n(x.won)} won</span></div>`:`<div class="p r${rk}" style="opacity:.4"><div class="m">${rk}</div><b>—</b><span>no points yet</span></div>`; }).join("");
    const metricL={wins:"orders",contacts:"customers reached",points:"points",offers:"offers made",calls:"calls",wins_500:"Fiber 500 OCU orders",wins_std:"standard-plan orders"};
    const feedIc=f=>f.kind==="won"?`<i style="background:linear-gradient(135deg,#0e9f5a,#047857)">${I.trophy}</i>`:`<i style="background:linear-gradient(135deg,#7c3aed,#4f46e5)">${I.tag}</i>`;
    el.innerHTML=`${b.best?`<div class="ld-best"><div class="ic">${I.trophy}</div><div><small>Best member of last week</small><b>${esc(b.best.name)}</b><small>${n(b.best.points)} points · ${n(b.best.won)} order(s) · week of ${esc(b.best.week)}</small></div></div>`:""}
      <div class="ld-grid2"><div><div class="ld-card"><h4>${I.trophy}This week's leaderboard · since ${esc(b.week)}</h4><div class="ld-pod">${pod}</div>
        ${lb.length?`<table class="ld-tbl"><thead><tr><th>#</th><th>Member</th><th>Points</th><th>Orders</th><th>Calls</th><th>Reached</th><th>Offers</th></tr></thead><tbody>${lb.map(x=>`<tr class="${x.me?"me":""}"><td>${x.rank}</td><td>${esc(x.name)}</td><td><b>${n(x.points)}</b></td><td>${n(x.won)}</td><td>${n(x.calls)}</td><td>${n(x.contacts)}</td><td>${n(x.offers)}</td></tr>`).join("")}</tbody></table>`:`<div class="ld-note">No points yet this week — the first call of the week starts the board.</div>`}
        <div class="ld-note" style="margin-top:10px">Points: reached a customer +${n(S.meta.points.contact)} · first call within ${n(S.meta.sla)} min +${n(S.meta.points.fast)} · interested +${n(S.meta.points.interested)} · offer +${n(S.meta.points.offer)} · order with the OCU offer +${n(S.meta.points.won)} · order on a standard plan +${n(S.meta.points.won_std)}.</div></div></div>
      <div><div class="ld-card"><h4>${I.flame}Challenges</h4>${b.challenges.length?b.challenges.map(c=>`<div class="ld-ch${c.done?" done":""}"><div class="h"><b>${esc(c.title)}</b><small>${esc(c.scope==="member"?"each member":"whole team")} · ${esc(c.period)}</small></div>
          <div class="ld-bar ${c.done?"":"gold"}"><i style="width:${Math.min(100,Math.round(n(c.progress)/Math.max(1,n(c.target))*100))}%"></i></div>
          <div class="h" style="margin-top:6px"><small>${n(c.progress)} / ${n(c.target)} ${esc(metricL[c.metric]||c.metric)}${c.done?" · done!":""}</small>${c.reward?`<small>reward: ${esc(c.reward)}</small>`:""}${mgr?`<a href="#" data-endch="${c.id}" style="font-size:11.5px;color:var(--muted)">end</a>`:""}</div></div>`).join(""):`<div class="ld-note">No challenge running.${mgr?" Start one below.":""}</div>`}
        ${mgr?`<div class="ld-form" style="margin-top:10px"><b style="font-size:12.5px">New challenge</b><div class="ld-two"><label>Title<input class="ld-in" id="chT" placeholder="Fiber week — 10 orders"></label><label>Reward<input class="ld-in" id="chR" placeholder="Team lunch on Thursday"></label></div>
          <div class="ld-two"><label>Measure<select class="ld-sel" id="chM">${Object.entries(metricL).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join("")}</select></label><label>Target<input class="ld-in" id="chN" type="number" min="1" value="10"></label></div>
          <div class="ld-two"><label>Who<select class="ld-sel" id="chS"><option value="team">The whole team</option><option value="member">Each member</option></select></label><label>Period<select class="ld-sel" id="chP"><option value="week">This week</option><option value="day">Today</option><option value="month">This month</option></select></label></div>
          <button class="ld-btn p" id="chGo">Start the challenge</button></div>`:""}</div>
        <div class="ld-card" style="margin-top:14px"><h4>${I.spark}Team feed</h4>${b.feed.length?`<ul class="ld-feed">${b.feed.map(f=>`<li>${feedIc(f)}<span><b>${esc(f.who||"A member")}</b> ${f.kind==="won"?(f.auto?"— the customer ordered after the call · ":"won ")+esc(PRODUCT[f.product]||"")+" · "+esc(f.plan||""):"offered "+esc(f.offer||"")}${f.offer&&f.kind==="won"?" · "+esc(f.offer):""}<br><span class="ld-note">${esc(ago(f.at))} · ${esc(S.meta.sources[f.source]||f.source)}</span></span></li>`).join("")}</ul>`:`<div class="ld-note">The team's wins and offers of the last 7 days appear here.</div>`}
          ${n(b.self_won_7d)?`<div class="ld-note" style="margin-top:10px;padding-top:9px;border-top:1px dashed var(--line)">+ ${n(b.self_won_7d)} customer(s) ordered on their own in 7 days, before anyone called — closed automatically, no points.</div>`:""}</div></div></div>`;
    const go=el.querySelector("#chGo"); if(go) go.onclick=async()=>{ const v=id=>el.querySelector(id).value; if(!v("#chT").trim()) return toast("Give the challenge a title");
      try{ await post("/api/fixed/leads/challenges",{title:v("#chT"),reward:v("#chR"),metric:v("#chM"),target:Number(v("#chN")),scope:v("#chS"),period:v("#chP")}); toast("Challenge started",true); boardView(el); }catch(e){ toast(e.message); } };
    el.querySelectorAll("[data-endch]").forEach(a=>a.onclick=async e=>{ e.preventDefault(); try{ await api(`/api/fixed/leads/challenges/${a.dataset.endch}`,{method:"DELETE"}); boardView(el); }catch(x){ toast(x.message); } });
  }

  /* ---------------------------------------------------------------- batches */
  async function batchesView(el){
    const ms=(S.meta.members||[]).filter(m=>!m.notOcu);
    el.innerHTML=`<div class="ld-grid2"><div class="ld-card"><h4>${I.upload}Import a batch</h4>
      ${S.meta.piiReady?"":`<div class="ld-err" style="margin-bottom:10px">Batch import needs LEADS_PII_KEY on the server — imported contacts are kept encrypted.</div>`}
      <div class="ld-drop" id="ldDrop" tabindex="0">${I.upload}<b>Drop an .xlsx or .csv here, or click to choose</b><small>Header row with at least a mobile column — name, national ID, package, reason, city are read when present. At most 2,000 rows.</small><input type="file" id="ldFile" accept=".xlsx,.csv" hidden></div>
      <div class="ld-two" style="margin-top:12px"><label class="ld-note" style="display:flex;flex-direction:column;gap:5px;font-weight:700">Batch name<input class="ld-in" id="ldBn" placeholder="Rejected installations — week 41"></label>
        <label class="ld-note" style="display:flex;flex-direction:column;gap:5px;font-weight:700">What these customers did<select class="ld-sel" id="ldBr"><option value="rejected_install">Rejected the installation</option><option value="campaign">Campaign / other list</option><option value="lead_stale">Asked before, never called</option><option value="abandoned">Did not finish a journey</option></select></label></div>
      <div class="ld-two" style="margin-top:10px"><label class="ld-note" style="display:flex;flex-direction:column;gap:5px;font-weight:700">Product when the file does not say<select class="ld-sel" id="ldBp"><option value="ftth">Fiber (FTTH)</option><option value="5g">5G HomeFi</option></select></label>
        <div class="ld-note" style="display:flex;flex-direction:column;gap:5px;font-weight:700">Spread to<div class="ld-check">${ms.map(m=>`<label><input type="checkbox" data-sp="${esc(m.email)}" checked>${esc(m.name)}</label>`).join("")||"no OCU member yet — the batch goes to the pool"}</div></div></div>
      <div id="ldImpRes" style="margin-top:12px"></div></div>
      <div class="ld-card"><h4>${I.users}Batches</h4><div id="ldBl"><div class="ld-note">Loading…</div></div></div></div>`;
    const drop=el.querySelector("#ldDrop"), inp=el.querySelector("#ldFile");
    const send=async file=>{ if(!file) return; if(file.size>6*1024*1024) return toast("The file is larger than 6 MB");
      const res=el.querySelector("#ldImpRes"); res.innerHTML=`<div class="ld-note">Reading ${esc(file.name)}…</div>`;
      const b64=await new Promise((ok,ko)=>{ const fr=new FileReader(); fr.onload=()=>ok(String(fr.result).split(",")[1]||""); fr.onerror=ko; fr.readAsDataURL(file); });
      const members=[...el.querySelectorAll("[data-sp]:checked")].map(x=>x.dataset.sp);
      try{ const r=await post("/api/fixed/leads/import",{ name:el.querySelector("#ldBn").value||file.name, fileName:file.name, b64, reasonClass:el.querySelector("#ldBr").value, product:el.querySelector("#ldBp").value, assign:members.length?{members}:null });
        res.innerHTML=`<div class="ld-card" style="border-color:#0e9f5a"><b style="font-size:13px">Batch #${esc(r.batch)} imported</b><div class="ld-kv" style="margin-top:8px"><div><span>Rows</span>${n(r.rows)}</div><div><span>New leads</span><b>${n(r.accepted)}</b></div><div><span>Already open (added)</span>${n(r.merged)}</div><div><span>Duplicates in the file</span>${n(r.duplicates)}</div><div><span>Ordered already</span>${n(r.ordered)}</div><div><span>Refused (no mobile)</span>${n(r.rejected)}</div></div>${r.spread?`<div class="ld-note" style="margin-top:8px">Spread: ${Object.entries(r.spread.counts||{}).map(([k,v])=>esc(((S.meta.members||[]).find(x=>x.email===k)||{}).name||k)+" "+v).join(" · ")}</div>`:""}</div>`;
        toast(`${n(r.accepted)} new lead(s) imported`,true); loadB(); hero(); }
      catch(e){ res.innerHTML=`<div class="ld-err">${esc(e.message)}</div>`; } };
    drop.onclick=()=>inp.click(); drop.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); inp.click(); } };
    inp.onchange=()=>send(inp.files[0]);
    drop.ondragover=e=>{ e.preventDefault(); drop.classList.add("over"); }; drop.ondragleave=()=>drop.classList.remove("over");
    drop.ondrop=e=>{ e.preventDefault(); drop.classList.remove("over"); send(e.dataTransfer.files[0]); };
    async function loadB(){ const box=el.querySelector("#ldBl"); try{ const r=await api("/api/fixed/leads/batches");
      box.innerHTML=r.batches.length?`<table class="ld-tbl"><thead><tr><th>Batch</th><th>When</th><th>New</th><th>Open</th><th>Won</th><th></th></tr></thead><tbody>${r.batches.map(b=>`<tr><td><b>#${esc(b.id)}</b> ${esc(b.name)}<div class="ld-note">${esc(b.created_by||"")}</div></td><td>${esc(md(b.created_at))}</td><td>${n(b.accepted)}<span class="ld-note"> / ${n(b.rows)}</span></td><td>${n(b.open)}</td><td>${n(b.won)}</td><td><button class="ld-btn s" data-bt="${esc(b.id)}">Show</button></td></tr>`).join("")}</tbody></table>`:`<div class="ld-note">No batch yet.</div>`;
      box.querySelectorAll("[data-bt]").forEach(x=>x.onclick=()=>{ S.batch=x.dataset.bt; S.tab="team"; document.querySelectorAll(".ld-tab").forEach(t=>t.classList.toggle("on",t.dataset.t==="team")); body(); }); }
      catch(e){ box.innerHTML=`<div class="ld-err">${esc(e.message)}</div>`; } }
    loadB();
  }

  /* ---------------------------------------------------------------- offers playbook */
  function offersView(el){
    const m=S.meta; const off=m.offers||[];
    el.innerHTML=`<div class="ld-offers">${off.map(o=>`<div class="ld-off ${o.code==="STD"?"std":""}"><div class="stp">${o.code==="STD"?"Step 1 · always first":"Step "+n(o.step)+" · if the customer is not interested"}</div><h5>${esc(o.label)}</h5>
        ${o.offer?`<div class="price"><b>${n(o.offer)} SAR</b><s>${n(o.price)} SAR</s></div><div class="meta">for the first <b>${n(o.months)} months</b>, then ${n(o.price)} SAR · ${esc(o.speed||"")}<br>OTT: ${esc(o.ott||"—")} · contract ${n(o.contract)} months · ${esc(o.product==="ftth"?"FTTH only":"")}${o.detail?"<br>"+esc(o.detail):""}</div>`:`<div class="meta" style="margin-top:8px">${esc(o.detail||"")}</div>`}</div>`).join("")}</div>
      <div class="ld-grid2"><div class="ld-card"><h4>${I.shield}Rules of the OCU offer</h4><ul class="ld-rules">${(m.rules||[]).map(r=>`<li>${esc(r)}</li>`).join("")}</ul><div class="ld-note" style="margin-top:10px">${esc(m.offerSource||"")}</div></div>
      <div class="ld-card"><h4>${I.spark}How Agent 2 uses it</h4><div class="ld-note" style="font-size:13px;color:var(--ink)">For every lead Agent 2 writes the <b>offer path</b>: the standard plan first, then the shortest discount that fits — Fiber 500 at 180 SAR for 3 months when speed matters, Fiber 300 at 145 SAR for 4 months when the price stopped the customer, 6 months only after 4 was declined. 5G leads and customers who ordered fiber before get the standard plans only. It also writes the opener in Arabic and English, three talking points and the answers to the likely objections, from what converted for the team — never with a name or a number.</div></div></div>`;
  }

  /* ---------------------------------------------------------------- settings (supervisors) */
  async function settingsView(el){
    el.innerHTML=`<div class="ld-empty">Loading…</div>`;
    let s; try{ s=await api("/api/fixed/leads/settings"); }catch(e){ el.innerHTML=`<div class="ld-err">${esc(e.message)}</div>`; return; }
    const d=s.desk, sup=s.super, hv=s.harvest||{}, st=(hv.state||{}).lastStats||{};
    const chk=(grp,k,l,v)=>`<label><input type="checkbox" data-${grp}="${k}" ${v?"checked":""}>${esc(l)}</label>`;
    const num=(id,l,v,dis)=>`<label>${esc(l)}<input class="ld-in" type="number" id="${id}" value="${esc(v)}" ${dis?"disabled":""}></label>`;
    el.innerHTML=`<div class="ld-grid2"><div>
      <div class="ld-card"><h4>${I.users}Team</h4>
        <label class="ld-note" style="display:flex;flex-direction:column;gap:5px;font-weight:700">Supervisors (assign, import, challenges)${sup?"":" — set by a super admin"}<input class="ld-in" id="stSup" value="${esc(d.supervisors.join(", "))}" ${sup?"":"disabled"} placeholder="name@salam.sa, …"></label>
        <table class="ld-tbl" style="margin-top:10px"><thead><tr><th>Member</th><th>SDA account (credits SDA orders)</th></tr></thead><tbody>${s.members.filter(m=>!m.notOcu).map(m=>`<tr><td>${esc(m.name)}<div class="ld-note">${esc(m.email)}</div></td><td><input class="ld-in" data-sc="${esc(m.email)}" value="${esc((d.staffCodes||{})[m.email]||"")}" placeholder="OCU_001" style="max-width:150px"></td></tr>`).join("")||`<tr><td colspan="2" class="ld-note">No user holds the OCU role yet — add them in User management (role OCU · Leads, business Fixed).</td></tr>`}</tbody></table></div>
      <div class="ld-card" style="margin-top:14px"><h4>${I.clock}Where leads come from</h4><div class="ld-check">${Object.entries(S.meta.sources).filter(([k])=>k!=="import").map(([k,l])=>chk("src",k,l,d.sources[k])).join("")}</div>
        <div class="ld-check" style="margin-top:8px">${chk("prd","ftth","Fiber (FTTH)",d.products.ftth)}${chk("prd","5g","5G HomeFi",d.products["5g"])}</div>
        <div class="ld-check" style="margin-top:8px"><label title="Off: only the promoter leads a dealer rejected. Nexus holds tens of thousands of NEW promoter captures nobody updates."><input type="checkbox" id="stPnew" ${d.promoterNew?"checked":""}>Also promoter leads still NEW after ${n(d.staleLeadDays)} day(s)</label></div>
        <div class="ld-two" style="margin-top:10px">${num("stAge","Lead after (hours without finishing)",d.minAgeHours)}${num("stLook","History look-back (days)",d.lookbackDays)}</div>
        <div class="ld-two" style="margin-top:6px">${num("stMaxAge","New lead only if the journey is at most (days)",d.leadMaxAgeDays)}${num("stExp","Close a lead nobody called after (days)",d.expireDays)}</div>
        <div class="ld-two" style="margin-top:6px">${num("stStale","Promoter lead stale after (days)",d.staleLeadDays)}${num("stAttr","Credit an order within (days of the call)",d.attributionDays)}</div>
        <div class="ld-note" style="margin-top:10px">Last harvest: ${hv.state&&hv.state.lastRun?esc(md(hv.state.lastRun))+" KSA · "+n(st.scanned)+" journeys · "+n(st.created)+" new · "+n(st.won_auto)+" won by an order"+(n(st.expired)?" · "+n(st.expired)+" expired":"")+(st.paused?" · <b style='color:#b91c1c'>paused — no LEADS_PII_KEY</b>":""):"not yet"} · read model ${hv.readModel?"on":"off"} · nexus ${hv.nexus?"on":"off"} · MVNO ${hv.mvno?"on":"off"} · DashPro ${hv.dashpro?"connected":"not configured"}${(st.errors||[]).length?` · <b style="color:#b91c1c">${esc(st.errors[0])}</b>`:""}</div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="ld-btn s" id="stHarv">Harvest now</button><button class="ld-btn s" id="stDig">Send the digest now</button></div></div>
    </div><div>
      <div class="ld-card"><h4>${I.trophy}Targets & points</h4><div class="ld-two">${num("stTd","Orders per member per day",d.targets.dailyWins)}${num("stTw","Orders per member per week",d.targets.weeklyWins)}</div>
        <div class="ld-two" style="margin-top:6px">${num("stSla","First-call target (minutes)",d.slaFirstContactMin)}${num("stMax","Open leads per member (max)",d.maxOpenPerMember)}</div>
        <div class="ld-two" style="margin-top:6px">${Object.entries(d.points).map(([k,v])=>num("stP_"+k,"Points · "+({contact:"reached",fast:"fast first call",interested:"interested",offer:"offer",won:"order (OCU offer)",won_std:"order (standard plan)"}[k]||k),v)).join("")}</div></div>
      <div class="ld-card" style="margin-top:14px"><h4>${I.lock}Protection</h4><div class="ld-two">${num("stRh","Reveals per member per hour",d.revealPerHour,!sup)}${num("stRd","Reveals per member per day",d.revealPerDay,!sup)}</div>
        <div class="ld-two" style="margin-top:6px"><label>Unmask a page${sup?"":" — set by a super admin"}<select class="ld-sel" id="stUw" ${sup?"":"disabled"}>${[["members","Supervisors + members (own leads)"],["supervisors","Supervisors only"],["off","Nobody — one lead at a time"]].map(([k,l])=>`<option value="${k}"${(d.unmaskWho||"members")===k?" selected":""}>${esc(l)}</option>`).join("")}</select></label>${num("stUm","Unmasked for (minutes)",d.unmaskMinutes||10,!sup)}</div>
        <div class="ld-two" style="margin-top:6px">${num("stUd","Leads a person may unmask per day",d.unmaskPerDay||600,!sup)}<div class="ld-note" style="align-self:end">Every unmasked lead is recorded (audit pii.unmask and its timeline). A customer who asked not to be called is never shown.</div></div>
        <div class="ld-note" style="margin-top:8px">Contacts at rest: ${s.piiReady?`encrypted / hashed with ${esc(s.keySource)}`:"<b style='color:#b91c1c'>LEADS_PII_KEY not set — the harvest and batch import are paused</b>"} · terms version ${esc(d.terms.version)} · Agent 2 coach ${s.coach.enabled?"every "+n(s.coach.intervalMin)+" min, team brief at "+n(s.coach.briefHour)+":00 KSA":"off"}</div>
        <label class="ld-note" style="display:flex;flex-direction:column;gap:5px;font-weight:700;margin-top:10px">Digest mail (no customer data) — hours KSA<input class="ld-in" id="stDh" value="${esc((d.digest.hours||[]).join(", "))}"></label>
        <div class="ld-check" style="margin-top:6px"><label><input type="checkbox" id="stDon" ${d.digest.on?"checked":""}>Send the digest to the OCU team</label></div></div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="ld-btn p" id="stSave">Save settings</button></div>
    </div></div>`;
    const v=id=>{ const x=el.querySelector("#"+id); return x?x.value:null; };
    el.querySelector("#stSave").onclick=async()=>{
      const body={ sources:{}, products:{}, staffCodes:{}, minAgeHours:v("stAge"), lookbackDays:v("stLook"), leadMaxAgeDays:v("stMaxAge"), expireDays:v("stExp"), staleLeadDays:v("stStale"), attributionDays:v("stAttr"), slaFirstContactMin:v("stSla"), maxOpenPerMember:v("stMax"),
        targets:{ dailyWins:v("stTd"), weeklyWins:v("stTw") }, points:Object.fromEntries(Object.keys(d.points).map(k=>[k,v("stP_"+k)])), digest:{ on:el.querySelector("#stDon").checked, hours:v("stDh") } };
      el.querySelectorAll("[data-src]").forEach(x=>body.sources[x.dataset.src]=x.checked); el.querySelectorAll("[data-prd]").forEach(x=>body.products[x.dataset.prd]=x.checked); body.promoterNew=!!(el.querySelector("#stPnew")||{}).checked;
      el.querySelectorAll("[data-sc]").forEach(x=>{ if(x.value.trim()) body.staffCodes[x.dataset.sc]=x.value.trim(); });
      if(sup){ body.supervisors=v("stSup").split(/[,;\s]+/).filter(Boolean); body.revealPerHour=v("stRh"); body.revealPerDay=v("stRd"); body.unmaskWho=v("stUw"); body.unmaskMinutes=v("stUm"); body.unmaskPerDay=v("stUd"); }
      try{ await api("/api/fixed/leads/settings",{method:"PUT",body:JSON.stringify(body)}); toast("Settings saved",true); S.meta=await api("/api/fixed/leads/meta"); settingsView(el); }catch(e){ toast(e.message); } };
    el.querySelector("#stHarv").onclick=async e=>{ e.target.disabled=true; try{ const r=await post("/api/fixed/leads/harvest"); toast(`Harvest: ${n(r.scanned)} journeys · ${n(r.created)} new lead(s) · ${n(r.won_auto)} won by an order`,true); settingsView(el); hero(); }catch(x){ toast(x.message); e.target.disabled=false; } };
    el.querySelector("#stDig").onclick=async e=>{ e.target.disabled=true; try{ const r=await post("/api/fixed/leads/digest"); toast(r&&r.sent!=null?`Digest sent to ${n(r.sent)} member(s)`:"Digest skipped",true); }catch(x){ toast(x.message); } e.target.disabled=false; };
  }

  /* ---------------------------------------------------------------- boot */
  /* the drawer and the reveal clock live outside the page: leaving Fixed › Leads closes them */
  window.addEventListener("hashchange",()=>{ if(!/^#fixed\?(?:[^#]*&)?tab=leads(?:&|$)/.test(location.hash||"")){ if(document.getElementById("ldDr")) closeLead(); S.shown.clear(); S.unmaskUntil=0; S.unmaskFresh=false; } });
  async function boot(host){
    S.host=host; css();
    host.innerHTML=`<div class="ld"><div class="ld-empty">Opening the restricted section…</div></div>`;
    try{ S.gate=await api("/api/fixed/leads/gate"); }
    catch(e){ host.innerHTML=`<div class="ld"><div class="ld-gate"><div class="hd"><div class="ic">${I.lock}</div><div class="k">Restricted section</div><h2>Leads are for the OCU team</h2><p>${esc(e.message)}</p></div></div></div>`; return; }
    if(!S.gate.accepted){ renderGate(host); return; }
    S.gate.acceptedAt=S.gate.acceptedAt||Date.now();
    try{ S.meta=await api("/api/fixed/leads/meta"); }catch(e){ if(e.code==="accept_required"){ S.gate.accepted=false; renderGate(host); return; } host.innerHTML=`<div class="ld-err">${esc(e.message)}</div>`; return; }
    if(!S.meta.me.manager&&TABS.find(t=>t[0]===S.tab&&t[2])) S.tab="mine";
    /* a supervisor or super admin who works no queue opens on the Team list, not on an empty "My queue" (alpha.170) */
    if(!S.booted&&S.meta.me.manager&&S.tab==="mine"&&!(S.meta.members||[]).some(x=>x.email===S.meta.me.email&&!x.notOcu)) S.tab="team";
    S.booted=true;
    shell(host); hero(); body();
    const m=/(?:^|[?&])lead=(\d+)/.exec(location.hash); if(m) openLead(m[1]);
  }
  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.leads={ label:"Leads", sub:"OCU · confidential", render:(host)=>boot(host) };
})();
