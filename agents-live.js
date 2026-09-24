/* agents-live.js — AI agents · MISSION CONTROL (24 Sep 2026): "what they did, what they are doing now, what they should do".
 * Four robots on one stage — Log intelligence, Incident triage, Team mapping, Yusr — wired to the on-prem BRAIN (llm.js).
 * Each robot breathes, blinks, works (arms + thinking dots) when its service is running or calling the model, sleeps when
 * disabled, goes red on a failed run, amber when stale. Under the stage: one card per agent with DID (runs as sentences +
 * concrete outputs), NOW (state, live countdown, model calls, tokens, 24 h sparkline) and NEXT (queue, next tick, next
 * report, what waits for a HUMAN). A 24 h REPLAY player narrates the runs step by step (Prev · Auto-play · Next, ← →).
 * Data: GET /api/agents/mission (server/src/agentsMission.js), refreshed every 30 s. Route #agents-live · #mission · #robots.
 * Dark mode via tokens; phone / iPad: the stage stacks, the cards go single column. */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
  const API=window.API_BASE||window.CONSOLE_BASE||"";
  const api=p=>window.fetch(API+p,{headers:{"Content-Type":"application/json"}}).then(r=>{ if(!r.ok) return r.json().then(e=>{ throw new Error(e.error||("HTTP "+r.status)); }); return r.json(); });
  const n=v=>Number(v||0).toLocaleString("en-US");
  const ksa=(iso,sec)=>{ if(!iso) return "—"; const d=new Date(iso); if(isNaN(d)) return "—"; return d.toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",...(sec?{second:"2-digit"}:{}),timeZone:"Asia/Riyadh"}); };
  const hm=iso=>{ const d=new Date(iso); return isNaN(d)?"—":d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Riyadh"}); };
  const ago=iso=>{ if(!iso) return "never"; const s=Math.round((Date.now()-new Date(iso).getTime())/1000); if(s<0) return "just now"; if(s<60) return s+" s ago"; const m=Math.floor(s/60); if(m<60) return m+" min ago"; const h=Math.floor(m/60); if(h<48) return h+" h "+(m%60)+" min ago"; return Math.floor(h/24)+" d ago"; };
  const until=iso=>{ if(!iso) return "—"; const s=Math.round((new Date(iso).getTime()-Date.now())/1000); if(s<=0) return "now"; if(s<60) return "in "+s+" s"; const m=Math.floor(s/60); if(m<60) return "in "+m+" min "+(s%60)+" s"; const h=Math.floor(m/60); return "in "+h+" h "+(m%60)+" min"; };
  const dur=(a,b)=>{ if(!a) return ""; const ms=(b?new Date(b):new Date()).getTime()-new Date(a).getTime(); if(ms<1000) return "<1 s"; const s=Math.round(ms/1000); return s<60?s+" s":Math.floor(s/60)+" min "+(s%60)+" s"; };
  const gb=b=>b==null?"—":(b>=1e9?(b/1e9).toFixed(1)+" GB":Math.round(b/1e6)+" MB");
  const up=s=>{ if(s==null) return "—"; if(s<3600) return Math.floor(s/60)+" min"; if(s<86400) return Math.floor(s/3600)+" h "+Math.floor(s%3600/60)+" min"; return Math.floor(s/86400)+" d "+Math.floor(s%86400/3600)+" h"; };
  const bar=(v,max,label,txt)=>{ const p=max?Math.max(0,Math.min(100,v/max*100)):0; return `<div class="am-m"><span class="l">${label}</span><div class="am-bar"><i class="${p>85?"hot":p>60?"warm":""}" style="width:${p.toFixed(0)}%"></i></div><span class="v">${txt}</span></div>`; };
  function hudAgent(a,d){
    const pr=a.proc||{}; const u=a.usage||{}; const tk=a.tokens||{}; const host=(d.perf&&d.perf.host)||{}; const cores=host.cores||1;
    return `<div class="am-hud"><h6>${esc(a.pm2)} <span>${pr.status?esc(pr.status):"no pm2 view"}${pr.pid?" · pid "+pr.pid:""}</span></h6>
      ${bar(pr.cpuPct||0,100,"CPU",pr.cpuPct==null?"—":pr.cpuPct+" %")}
      ${bar(pr.memBytes||0,1.5e9,"RAM",gb(pr.memBytes))}
      ${bar(tk.tokens||0,600000,"tokens today",n(tk.tokens))}
      ${bar(u.tok_s||0,40,"speed",u.tok_s?u.tok_s+" tok/s":"—")}
      ${bar(u.avg_ms||0,60000,"latency",u.avg_ms?Math.round(u.avg_ms/1000)+" s avg":"—")}
      <div class="ft">7 d: <b>${n(u.calls)}</b> calls · p95 ${u.p95_ms?Math.round(u.p95_ms/1000)+" s":"—"} · fail ${u.calls?Math.round((u.calls-(u.ok||0))/u.calls*100):0} % · ${n(u.tokens)} tokens<br>up ${esc(up(pr.uptimeSec))}${pr.restarts!=null?" · "+pr.restarts+" restart(s)":""} · host ${cores} cores</div></div>`;
  }
  function hudBrain(d){
    const h=(d.perf&&d.perf.host)||{}; const m=(d.perf&&d.perf.model)||{}; const mem=h.mem||{}; const u=(d.usage&&d.usage.total)||{};
    const models=(m.models||[]).map(x=>`<div class="am-m" style="grid-template-columns:1fr auto"><span><b>${esc(x.name)}</b> <span class="l">${esc(x.params||"")} ${esc(x.quant||"")}</span></span><span class="v">${esc(x.processor)} · ${gb(x.sizeBytes)}</span></div>`).join("");
    return `<div class="am-hud"><h6>${esc(h.hostname||"host")} <span>${h.cores||"?"} cores${h.gpu&&h.gpu.length?" · GPU":" · no GPU"}</span></h6>
      ${bar(h.cpuPct||0,100,"CPU",h.cpuPct==null?"—":h.cpuPct+" %")}
      ${bar(mem.used||0,mem.total||1,"RAM",gb(mem.used)+" / "+gb(mem.total))}
      ${bar((h.load||[0])[0],h.cores||1,"load 1 m",((h.load||[0])[0]||0).toFixed(2))}
      ${(h.gpu||[]).map(g=>bar(g.memUsedMb,g.memTotalMb,"GPU",g.utilPct+" % · "+Math.round(g.memUsedMb/1024)+"/"+Math.round(g.memTotalMb/1024)+" GB")).join("")}
      <div style="margin-top:6px;border-top:1px dashed var(--line);padding-top:6px"><div class="ft" style="margin:0 0 2px">model server · ${esc(m.kind||"?")}${m.error?` · <span style="color:#dc2626">${esc(m.error)}</span>`:""}</div>${models||`<div class="ft">no model resident (loads on the next call — first answer slower)</div>`}</div>
      <div class="ft">7 d: ${n(u.calls)} calls · ${n(u.tokens)} tokens · avg ${u.avg_ms?Math.round(u.avg_ms/1000)+" s":"—"} · up ${esc(up(h.uptimeSec))}</div></div>`;
  }
  const COLOR={ log:"#2563eb", incident:"#0e9f5a", map:"#7c3aed", yusr:"#d97706" };
  const STATE={ working:{label:"working",fg:"#0e9f5a"}, idle:{label:"idle · waiting for the next tick",fg:"#2563eb"}, stale:{label:"stale — no run when one was due",fg:"#d97706"}, error:{label:"last run failed",fg:"#dc2626"}, disabled:{label:"disabled",fg:"#64748b"}, never:{label:"never ran yet",fg:"#64748b"} };
  const S={ data:null, timer:null, tick:null, sel:null, play:{steps:[],i:-1,auto:null,speed:1}, open:false, tab:"live", pin:null, plan:{target:"onprem",model:"14b",conc:null} };

  const CSS=`
  #view-agentsmission .am-wrap{display:flex;flex-direction:column;gap:14px}
  #view-agentsmission .am-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap} #view-agentsmission .am-head .sp{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  #view-agentsmission .am-live{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:var(--green,#0e9f5a);border:1px solid var(--green,#0e9f5a);border-radius:999px;padding:3px 10px} #view-agentsmission .am-live i{width:7px;height:7px;border-radius:50%;background:var(--green,#0e9f5a);animation:amPulse 1.6s infinite}
  #view-agentsmission .am-btn{cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:6px 13px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink);transition:border-color .14s,color .14s,transform .14s} #view-agentsmission .am-btn:hover{border-color:var(--green,#0e9f5a);color:var(--green,#0e9f5a);transform:translateY(-1px)}
  #view-agentsmission .am-btn.p{background:var(--green,#0e9f5a);border-color:var(--green,#0e9f5a);color:#fff} #view-agentsmission .am-btn.p:hover{color:#fff;filter:brightness(1.06)} #view-agentsmission .am-btn:disabled{opacity:.5;cursor:default;transform:none}
  /* ---- the stage ---- */
  #view-agentsmission .am-stage{position:relative;border:1px solid var(--line);border-radius:18px;padding:18px 18px 12px;overflow:hidden;background:radial-gradient(120% 90% at 50% 0%,rgba(14,159,90,.10) 0%,transparent 55%),linear-gradient(180deg,var(--card,#fff),var(--card2,#f8fafc));box-shadow:0 1px 3px rgba(2,6,23,.05)}
  #view-agentsmission .am-stage:before{content:"";position:absolute;inset:0;background-image:linear-gradient(var(--line-soft,var(--line)) 1px,transparent 1px),linear-gradient(90deg,var(--line-soft,var(--line)) 1px,transparent 1px);background-size:28px 28px;opacity:.35;pointer-events:none}
  #view-agentsmission .am-brain{position:relative;z-index:7;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;margin-bottom:6px}
  #view-agentsmission .am-core{position:relative;width:88px;height:88px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 35% 30%,#fff,var(--green,#0e9f5a) 55%,#065f46);color:#fff;font-size:30px;box-shadow:0 10px 30px rgba(14,159,90,.35)}
  #view-agentsmission .am-core:before,#view-agentsmission .am-core:after{content:"";position:absolute;inset:-10px;border-radius:50%;border:2px solid var(--green,#0e9f5a);opacity:0;animation:amRing 2.6s ease-out infinite} #view-agentsmission .am-core:after{animation-delay:1.3s}
  #view-agentsmission .am-core.off{background:radial-gradient(circle at 35% 30%,#fff,#94a3b8 55%,#475569);box-shadow:none} #view-agentsmission .am-core.off:before,#view-agentsmission .am-core.off:after{animation:none}
  #view-agentsmission .am-brainx{font-size:12.5px;color:var(--muted);line-height:1.5;min-width:220px} #view-agentsmission .am-brainx b{color:var(--ink);font-size:14px;display:block}
  #view-agentsmission .am-wires{position:relative;z-index:1;width:100%;height:auto;display:block;margin:-4px 0 -8px}
  #view-agentsmission .am-robots{position:relative;z-index:1;display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  #view-agentsmission .am-rb{position:relative;text-align:center;cursor:pointer;border-radius:14px;padding:6px 6px 10px;transition:background .15s,transform .15s;border:1px solid transparent}
  #view-agentsmission .am-rb:hover{background:rgba(14,159,90,.06);transform:translateY(-2px)} #view-agentsmission .am-rb.sel{border-color:var(--green,#0e9f5a);background:rgba(14,159,90,.08)}
  #view-agentsmission .am-rb svg{width:118px;height:132px;overflow:visible;display:block;margin:0 auto}
  #view-agentsmission .am-rb .nm{font-weight:800;font-size:13.5px;margin-top:2px} #view-agentsmission .am-rb .st{font-size:11.5px;font-weight:700;margin-top:2px} #view-agentsmission .am-rb .pm{font-size:10.5px;color:var(--muted)}
  #view-agentsmission .am-bub{position:relative;margin:8px auto 0;max-width:230px;font-size:11.5px;line-height:1.35;color:var(--ink);background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;padding:7px 10px;box-shadow:0 4px 12px rgba(2,6,23,.08);min-height:34px;text-align:left}
  #view-agentsmission .am-bub:before{content:"";position:absolute;top:-6px;left:50%;width:10px;height:10px;background:var(--card,#fff);border-left:1px solid var(--line);border-top:1px solid var(--line);transform:translateX(-50%) rotate(45deg)}
  #view-agentsmission .am-bub .t{color:var(--muted);font-size:10.5px;display:block}
  /* robot animation states */
  #view-agentsmission .rb-body{transform-origin:50% 100%;animation:amBob 3.2s ease-in-out infinite}
  #view-agentsmission .rb-eye{transform-origin:center;animation:amBlink 4.5s infinite} #view-agentsmission .rb-eye.r{animation-delay:.15s}
  #view-agentsmission .rb-lamp{animation:amLamp 1.4s ease-in-out infinite}
  #view-agentsmission .rb-arm{transform-origin:var(--ox) var(--oy)}
  #view-agentsmission .st-working .rb-arm.l{animation:amArmL .9s ease-in-out infinite} #view-agentsmission .st-working .rb-arm.r{animation:amArmR .9s ease-in-out infinite .45s}
  #view-agentsmission .st-working .rb-body{animation-duration:1.4s} #view-agentsmission .st-working .rb-gear{animation:amSpin 1.6s linear infinite;transform-origin:center}
  #view-agentsmission .rb-think{opacity:0} #view-agentsmission .st-working .rb-think{opacity:1} #view-agentsmission .st-working .rb-think circle{animation:amDots 1.2s infinite} #view-agentsmission .st-working .rb-think circle:nth-child(2){animation-delay:.2s} #view-agentsmission .st-working .rb-think circle:nth-child(3){animation-delay:.4s}
  #view-agentsmission .st-error .rb-body{animation:amShake .5s ease-in-out infinite} #view-agentsmission .st-error .rb-eye{fill:#dc2626}
  #view-agentsmission .st-stale .rb-body{animation-duration:6s} #view-agentsmission .st-stale .rb-lamp{animation-duration:3s}
  #view-agentsmission .st-disabled svg,#view-agentsmission .st-never svg{filter:grayscale(1);opacity:.55} #view-agentsmission .st-disabled .rb-body,#view-agentsmission .st-never .rb-body{animation:none} #view-agentsmission .st-disabled .rb-lamp{animation:none;opacity:.3} #view-agentsmission .st-disabled .rb-eye{transform:scaleY(.15)}
  #view-agentsmission .rb-zz{opacity:0} #view-agentsmission .st-disabled .rb-zz{opacity:1;animation:amZz 2.4s ease-in-out infinite}
  #view-agentsmission .am-pkt{offset-rotate:0deg;animation:amFlow 1.8s linear infinite} #view-agentsmission .am-pkt.d2{animation-delay:.6s} #view-agentsmission .am-pkt.d3{animation-delay:1.2s}
  @keyframes amBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}} @keyframes amBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
  @keyframes amLamp{0%,100%{opacity:1}50%{opacity:.35}} @keyframes amArmL{0%,100%{transform:rotate(0)}50%{transform:rotate(-28deg)}} @keyframes amArmR{0%,100%{transform:rotate(0)}50%{transform:rotate(28deg)}}
  @keyframes amSpin{to{transform:rotate(360deg)}} @keyframes amDots{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}} @keyframes amShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}
  @keyframes amZz{0%{opacity:0;transform:translate(0,0)}30%{opacity:1}100%{opacity:0;transform:translate(8px,-14px)}} @keyframes amRing{0%{transform:scale(.7);opacity:.7}100%{transform:scale(1.5);opacity:0}} @keyframes amPulse{0%,100%{opacity:1}50%{opacity:.3}}
  @keyframes amFlow{0%{offset-distance:0%;opacity:0}10%{opacity:1}90%{opacity:1}100%{offset-distance:100%;opacity:0}}
  /* ---- detail cards ---- */
  #view-agentsmission .am-cards{display:grid;grid-template-columns:1fr;gap:14px}
  #view-agentsmission .am-card{background:var(--card,#fff);border:1px solid var(--line);border-radius:16px;padding:16px 18px;box-shadow:0 1px 3px rgba(2,6,23,.05);border-top:4px solid var(--ac);scroll-margin-top:90px}
  #view-agentsmission .am-card.sel{box-shadow:0 0 0 3px rgba(14,159,90,.18)}
  #view-agentsmission .am-ch{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px} #view-agentsmission .am-ch h2{margin:0;font-size:16px;font-weight:800;letter-spacing:-.2px} #view-agentsmission .am-ch .tag{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:var(--ac);color:#fff}
  #view-agentsmission .am-ch .pm2{font-size:11px;color:var(--muted);font-family:ui-monospace,Menlo,monospace} #view-agentsmission .am-ch .stt{margin-left:auto;font-size:12px;font-weight:800;display:inline-flex;align-items:center;gap:6px} #view-agentsmission .am-ch .stt i{width:9px;height:9px;border-radius:50%;background:currentColor;animation:amPulse 1.6s infinite}
  #view-agentsmission .am-role{font-size:12.5px;color:var(--muted);margin-bottom:12px;line-height:1.45}
  #view-agentsmission .am-3{display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:12px} @media (max-width:900px){#view-agentsmission .am-3{grid-template-columns:1fr}}
  #view-agentsmission .am-col{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--card2,#f8fafc);min-width:0} #view-agentsmission .am-col h4{margin:0 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:800;display:flex;align-items:center;gap:6px}
  #view-agentsmission .am-col h4 b{font-size:14px;color:var(--ac)}
  #view-agentsmission .am-tl{list-style:none;margin:0;padding:0;font-size:12px} #view-agentsmission .am-tl li{display:grid;grid-template-columns:44px 10px 1fr;gap:6px;padding:4px 0;border-bottom:1px dashed var(--line-soft,var(--line));align-items:start} #view-agentsmission .am-tl li:last-child{border:0}
  #view-agentsmission .am-tl .t{color:var(--muted);font-variant-numeric:tabular-nums;font-size:11px;padding-top:1px} #view-agentsmission .am-tl .d{width:8px;height:8px;border-radius:50%;margin-top:4px;background:var(--green,#0e9f5a)} #view-agentsmission .am-tl .d.bad{background:#dc2626} #view-agentsmission .am-tl .d.run{background:#d97706;animation:amPulse 1s infinite}
  #view-agentsmission .am-tl .x{line-height:1.35;word-break:break-word} #view-agentsmission .am-tl .x small{color:var(--muted)}
  #view-agentsmission .am-out{margin-top:10px} #view-agentsmission .am-out h5{margin:0 0 4px;font-size:11px;color:var(--muted);font-weight:700}
  #view-agentsmission .am-row{display:flex;gap:8px;align-items:baseline;font-size:12px;padding:4px 0;border-bottom:1px dashed var(--line-soft,var(--line));flex-wrap:wrap} #view-agentsmission .am-row:last-child{border:0} #view-agentsmission .am-row .k{flex:1 1 160px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} #view-agentsmission .am-row a{color:var(--green,#0e9f5a);font-weight:700;text-decoration:none}
  #view-agentsmission .am-pill{display:inline-block;font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:999px;background:rgba(125,133,144,.14);color:var(--muted);white-space:nowrap} #view-agentsmission .am-pill.g{background:rgba(14,159,90,.14);color:var(--green,#0e9f5a)} #view-agentsmission .am-pill.b{background:rgba(37,99,235,.14);color:#2563eb} #view-agentsmission .am-pill.r{background:rgba(220,38,38,.14);color:#dc2626} #view-agentsmission .am-pill.a{background:rgba(217,119,6,.14);color:#b45309} #view-agentsmission .am-pill.v{background:rgba(124,58,237,.14);color:#7c3aed}
  #view-agentsmission .am-big{font-size:19px;font-weight:800;line-height:1.1;letter-spacing:-.3px} #view-agentsmission .am-kv{font-size:12px;line-height:1.55} #view-agentsmission .am-kv span{color:var(--muted)}
  #view-agentsmission .am-cd{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.5px;color:var(--ac);line-height:1.1}
  #view-agentsmission .am-q{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px dashed var(--line-soft,var(--line))} #view-agentsmission .am-q:last-child{border:0} #view-agentsmission .am-q .num{flex:none;font-size:18px;font-weight:800;min-width:52px;text-align:right;font-variant-numeric:tabular-nums;letter-spacing:-.3px} #view-agentsmission .am-q .num.z{color:var(--muted)} #view-agentsmission .am-q .lb{flex:1;min-width:0;font-size:12px;line-height:1.3} #view-agentsmission .am-q .lb small{display:block;color:var(--muted);font-size:11px}
  #view-agentsmission .am-q.hu .num{color:#b45309} #view-agentsmission .am-q a{margin-left:auto;font-size:11px;font-weight:700;color:var(--green,#0e9f5a);text-decoration:none;white-space:nowrap;border:1px solid var(--green,#0e9f5a);border-radius:999px;padding:2px 9px} #view-agentsmission .am-q a:hover{background:var(--green,#0e9f5a);color:#fff}
  #view-agentsmission .am-spark{display:flex;align-items:flex-end;gap:2px;height:34px;margin-top:6px} #view-agentsmission .am-spark i{flex:1;background:var(--ac);opacity:.75;border-radius:2px 2px 0 0;min-height:2px} #view-agentsmission .am-spark i.bad{background:#dc2626} #view-agentsmission .am-spark i.now{opacity:1;box-shadow:0 0 0 1px var(--ac)}
  /* ---- replay ---- */
  #view-agentsmission .am-player{position:sticky;bottom:10px;z-index:5;background:var(--card,#fff);border:1px solid var(--green,#0e9f5a);border-radius:16px;padding:12px 16px;box-shadow:0 10px 30px rgba(2,6,23,.18)}
  #view-agentsmission .am-player .ctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap} #view-agentsmission .am-player .ctl select{font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2,#f1f5f9);color:var(--ink)}
  #view-agentsmission .am-player .cnt{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums} #view-agentsmission .am-player .x{margin-left:auto}
  #view-agentsmission .am-narr{margin-top:8px;font-size:13.5px;line-height:1.45;min-height:40px} #view-agentsmission .am-narr b.w{color:var(--ac)} #view-agentsmission .am-narr .t{color:var(--muted);font-size:12px;margin-right:6px}
  #view-agentsmission .am-track{position:relative;height:56px;margin-top:8px;border-radius:10px;background:var(--card2,#f8fafc);border:1px solid var(--line);overflow:hidden}
  #view-agentsmission .am-track .lane{position:absolute;left:0;right:0;height:12px} #view-agentsmission .am-track .lane i{position:absolute;top:2px;width:7px;height:7px;border-radius:50%;transform:translateX(-50%);cursor:pointer;opacity:.75} #view-agentsmission .am-track .lane i.on{opacity:1;transform:translateX(-50%) scale(1.5);box-shadow:0 0 0 2px var(--card,#fff)}
  #view-agentsmission .am-track .cur{position:absolute;top:0;bottom:0;width:2px;background:var(--ink);opacity:.6;transform:translateX(-50%)} #view-agentsmission .am-track .hr{position:absolute;bottom:0;font-size:9.5px;color:var(--muted);transform:translateX(-50%)}
  /* ---- tabs ---- */
  #view-agentsmission .am-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 2px} #view-agentsmission .am-tab{cursor:pointer;font:inherit;font-size:13px;font-weight:700;padding:8px 16px;border:1px solid var(--line);border-radius:999px;background:var(--card,#fff);color:var(--ink);transition:all .14s} #view-agentsmission .am-tab:hover{border-color:var(--green,#0e9f5a);color:var(--green,#0e9f5a)} #view-agentsmission .am-tab.on{background:var(--green,#0e9f5a);border-color:var(--green,#0e9f5a);color:#fff}
  /* ---- perf HUD ---- */
  #view-agentsmission .am-hud{display:none;position:absolute;left:50%;top:6px;transform:translateX(-50%);z-index:6;width:262px;text-align:left;background:var(--card,#fff);border:1px solid var(--ac);border-radius:12px;padding:10px 12px;box-shadow:0 12px 30px rgba(2,6,23,.22);font-size:11.5px}
  #view-agentsmission .am-rb:hover .am-hud,#view-agentsmission .am-rb.pin .am-hud,#view-agentsmission .am-brainw:hover .am-hud,#view-agentsmission .am-brainw.pin .am-hud{display:block}
  #view-agentsmission .am-hud h6{margin:0 0 6px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ac);font-weight:800;display:flex;justify-content:space-between;gap:8px;white-space:nowrap;overflow:hidden} #view-agentsmission .am-hud h6 span{overflow:hidden;text-overflow:ellipsis} #view-agentsmission .am-hud h6 span{color:var(--muted);font-weight:600;letter-spacing:0;text-transform:none}
  #view-agentsmission .am-m{display:grid;grid-template-columns:54px 1fr auto;gap:6px;align-items:center;padding:3px 0} #view-agentsmission .am-m .l{color:var(--muted)} #view-agentsmission .am-m .v{text-align:right;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
  #view-agentsmission .am-bar{height:7px;border-radius:4px;background:var(--line-soft,var(--line));overflow:hidden} #view-agentsmission .am-bar i{display:block;height:100%;border-radius:4px;background:var(--ac);transition:width .6s} #view-agentsmission .am-bar i.hot{background:#dc2626} #view-agentsmission .am-bar i.warm{background:#d97706}
  #view-agentsmission .am-hud .ft{margin-top:6px;color:var(--muted);font-size:10.5px}
  #view-agentsmission .am-brainw{position:relative;cursor:pointer} #view-agentsmission .am-brainw .am-hud{width:300px;--ac:var(--green,#0e9f5a);left:0;transform:none}
  #view-agentsmission .am-hint{font-size:10.5px;color:var(--muted);text-align:center;margin-top:4px}
  /* ---- the move plan ---- */
  #view-agentsmission .am-plan{display:flex;flex-direction:column;gap:14px}
  #view-agentsmission .am-pk{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px} #view-agentsmission .am-pk .k{background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;padding:12px 14px} #view-agentsmission .am-pk .k b{display:block;font-size:22px;font-weight:800;letter-spacing:-.3px;line-height:1.1} #view-agentsmission .am-pk .k span{font-size:11.5px;color:var(--muted)}
  #view-agentsmission .am-opts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px} @media (max-width:960px){#view-agentsmission .am-opts{grid-template-columns:1fr}}
  #view-agentsmission .am-opt{background:var(--card,#fff);border:1px solid var(--line);border-radius:16px;padding:16px 18px;border-top:4px solid var(--oc);cursor:pointer;transition:transform .15s,box-shadow .15s} #view-agentsmission .am-opt:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(2,6,23,.10)} #view-agentsmission .am-opt.on{box-shadow:0 0 0 3px rgba(14,159,90,.18)}
  #view-agentsmission .am-opt h3{margin:0 0 2px;font-size:15px;font-weight:800} #view-agentsmission .am-opt .who{font-size:11.5px;color:var(--muted);margin-bottom:8px} #view-agentsmission .am-opt ul{margin:6px 0 0;padding-left:16px;font-size:12.5px;line-height:1.5} #view-agentsmission .am-opt .verdict{margin-top:10px;font-size:12px;font-weight:700;padding:6px 10px;border-radius:9px;background:rgba(125,133,144,.12)} #view-agentsmission .am-opt .verdict.go{background:rgba(14,159,90,.14);color:var(--green,#0e9f5a)} #view-agentsmission .am-opt .verdict.no{background:rgba(220,38,38,.12);color:#dc2626} #view-agentsmission .am-opt .verdict.mid{background:rgba(217,119,6,.14);color:#b45309}
  #view-agentsmission .am-sec{background:var(--card,#fff);border:1px solid var(--line);border-radius:16px;padding:16px 18px} #view-agentsmission .am-sec h2{margin:0 0 4px;font-size:15px;font-weight:800} #view-agentsmission .am-sec .sub{margin-bottom:10px}
  #view-agentsmission table.am-t{width:100%;border-collapse:collapse;font-size:12.5px} #view-agentsmission .am-t th{text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line)} #view-agentsmission .am-t td{padding:8px 10px;border-bottom:1px solid var(--line-soft,var(--line));vertical-align:top} #view-agentsmission .am-t tr.hl td{background:rgba(14,159,90,.07)} #view-agentsmission .am-t .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  #view-agentsmission .am-ctl{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12.5px} #view-agentsmission .am-ctl label{display:flex;align-items:center;gap:6px} #view-agentsmission .am-ctl select,#view-agentsmission .am-ctl input{font:inherit;font-size:12.5px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2,#f1f5f9);color:var(--ink)} #view-agentsmission .am-ctl input{width:90px}
  #view-agentsmission .am-steps{counter-reset:st;list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px} #view-agentsmission .am-steps li{position:relative;padding:12px 12px 12px 44px;border:1px solid var(--line);border-radius:12px;background:var(--card2,#f8fafc);font-size:12.5px;line-height:1.45} #view-agentsmission .am-steps li:before{counter-increment:st;content:counter(st);position:absolute;left:12px;top:12px;width:24px;height:24px;border-radius:50%;background:var(--green,#0e9f5a);color:#fff;font-weight:800;font-size:12px;display:grid;place-items:center} #view-agentsmission .am-steps li b{display:block;margin-bottom:2px} #view-agentsmission .am-steps li .d{color:var(--muted);font-size:11px}
  #view-agentsmission .am-code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;background:var(--card2,#f8fafc);border:1px solid var(--line);border-radius:10px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;line-height:1.5}
  #view-agentsmission .am-charts{display:grid;grid-template-columns:1fr 1fr;gap:14px} @media (max-width:980px){#view-agentsmission .am-charts{grid-template-columns:1fr}}
  #view-agentsmission .am-ch2{background:var(--card,#fff);border:1px solid var(--line);border-radius:16px;padding:14px 16px} #view-agentsmission .am-ch2 h3{margin:0 0 2px;font-size:14px;font-weight:800} #view-agentsmission .am-ch2 .sub{font-size:11.5px;margin-bottom:8px} #view-agentsmission .am-ch2 svg{width:100%;height:auto;display:block;overflow:visible}
  #view-agentsmission .am-ch2 .big{font-size:26px;font-weight:800;letter-spacing:-.4px;line-height:1} #view-agentsmission .am-delta{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px} #view-agentsmission .am-delta div{font-size:11.5px;color:var(--muted)} #view-agentsmission .am-delta b{display:block;font-size:18px;color:var(--ink);letter-spacing:-.3px}
  #view-agentsmission .am-ba{display:grid;grid-template-columns:1fr 64px 1fr;gap:12px;align-items:stretch;margin-top:12px} @media (max-width:820px){#view-agentsmission .am-ba{grid-template-columns:1fr} #view-agentsmission .am-ba .arrow{transform:rotate(90deg);height:40px}}
  #view-agentsmission .am-ba .side{border-radius:16px;padding:14px 16px;border:1px solid var(--line);background:var(--card2,#f8fafc)} #view-agentsmission .am-ba .side h4{margin:0 0 10px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;display:flex;align-items:center;gap:8px} #view-agentsmission .am-ba .side h4 span{font-size:11px;letter-spacing:0;text-transform:none;font-weight:600;color:var(--muted)}
  #view-agentsmission .am-ba .before{opacity:.8;filter:saturate(.6)} #view-agentsmission .am-ba .before h4{color:var(--muted)}
  #view-agentsmission .am-ba .after{border-color:var(--green,#0e9f5a);background:linear-gradient(160deg,rgba(14,159,90,.14),rgba(14,159,90,.03));box-shadow:0 0 0 3px rgba(14,159,90,.12),0 14px 34px rgba(14,159,90,.18);animation:amGlow 3s ease-in-out infinite} #view-agentsmission .am-ba .after h4{color:var(--green,#0e9f5a)}
  @keyframes amGlow{0%,100%{box-shadow:0 0 0 3px rgba(14,159,90,.12),0 14px 34px rgba(14,159,90,.18)}50%{box-shadow:0 0 0 6px rgba(14,159,90,.18),0 18px 40px rgba(14,159,90,.26)}}
  #view-agentsmission .am-ba .arrow{display:grid;place-items:center;font-size:34px;color:var(--green,#0e9f5a);animation:amArrow 1.4s ease-in-out infinite} @keyframes amArrow{0%,100%{transform:translateX(0)}50%{transform:translateX(8px)}}
  #view-agentsmission .am-bar2{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:baseline;padding:7px 0;border-bottom:1px dashed var(--line-soft,var(--line))} #view-agentsmission .am-bar2:last-child{border:0} #view-agentsmission .am-bar2 .l{font-size:12px;color:var(--muted)} #view-agentsmission .am-bar2 .v{font-size:24px;font-weight:800;letter-spacing:-.5px;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap} #view-agentsmission .after .am-bar2 .v{color:var(--green,#0e9f5a)}
  #view-agentsmission .am-bar2 .d{display:inline-block;margin-left:8px;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(14,159,90,.16);color:var(--green,#0e9f5a);vertical-align:middle} #view-agentsmission .am-bar2 .d.bad{background:rgba(220,38,38,.14);color:#dc2626}
  #view-agentsmission .am-race{margin-top:14px;border:1px solid var(--line);border-radius:16px;padding:14px 16px;background:var(--card,#fff)} #view-agentsmission .am-race h3{margin:0 0 2px;font-size:14px;font-weight:800} #view-agentsmission .am-lane{display:grid;grid-template-columns:150px 1fr 90px;gap:10px;align-items:center;margin-top:10px} #view-agentsmission .am-lane .nm{font-size:12px;font-weight:700} #view-agentsmission .am-lane .nm small{display:block;color:var(--muted);font-weight:500}
  #view-agentsmission .am-track2{position:relative;height:26px;border-radius:13px;background:var(--card2,#f8fafc);border:1px solid var(--line);overflow:hidden} #view-agentsmission .am-track2 i{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:13px;background:var(--lc);transition:width .08s linear} #view-agentsmission .am-track2 b{position:absolute;right:10px;top:4px;font-size:12px;font-variant-numeric:tabular-nums} #view-agentsmission .am-track2 .fl{position:absolute;right:8px;top:2px;font-size:16px;display:none} #view-agentsmission .am-track2.done .fl{display:block}
  #view-agentsmission .am-lane .clk{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;text-align:right;letter-spacing:-.5px} #view-agentsmission .am-lane .clk.win{color:var(--green,#0e9f5a)}
  #view-agentsmission .am-wins{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px} @media (max-width:960px){#view-agentsmission .am-wins{grid-template-columns:1fr}}
  #view-agentsmission .am-win{border:1px solid var(--line);border-radius:16px;padding:14px 16px;background:var(--card,#fff);border-top:4px solid var(--oc);cursor:pointer;transition:transform .15s,box-shadow .15s;position:relative} #view-agentsmission .am-win:hover{transform:translateY(-2px)} #view-agentsmission .am-win.on{box-shadow:0 0 0 3px rgba(14,159,90,.18)} #view-agentsmission .am-win.on:after{content:"our pick";position:absolute;top:-12px;right:12px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:var(--green,#0e9f5a);color:#fff;padding:2px 8px;border-radius:999px}
  #view-agentsmission .am-win h3{margin:0 0 8px;font-size:14px;font-weight:800;color:var(--oc)} #view-agentsmission .am-win .row{display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line-soft,var(--line));font-size:12px} #view-agentsmission .am-win .row:last-child{border:0} #view-agentsmission .am-win .row b{font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap} #view-agentsmission .am-win .row .ic{font-size:15px;text-align:center} #view-agentsmission .am-win .row .neg b{color:#dc2626}
  #view-agentsmission .am-score{height:8px;border-radius:4px;background:var(--line-soft,var(--line));overflow:hidden;margin-top:10px} #view-agentsmission .am-score i{display:block;height:100%;background:var(--oc);border-radius:4px;transition:width .8s}
  #view-agentsmission .am-val{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px} #view-agentsmission .am-val .v{border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--card2,#f8fafc);border-left:4px solid var(--green,#0e9f5a)} #view-agentsmission .am-val .v b{display:block;font-size:22px;letter-spacing:-.4px;line-height:1.1} #view-agentsmission .am-val .v small{color:var(--muted);font-size:11.5px;display:block;margin-top:3px;line-height:1.35} #view-agentsmission .am-val .v .from{font-size:12px;color:var(--muted);text-decoration:line-through;margin-right:6px}
  #view-agentsmission .am-in{width:84px;font:inherit;font-size:11.5px;padding:2px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card2,#f1f5f9);color:var(--ink)}
  #view-agentsmission .am-refs{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px} #view-agentsmission .am-ref{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--card2,#f8fafc);font-size:12px;line-height:1.45} #view-agentsmission .am-ref a{color:var(--green,#0e9f5a);font-weight:700;text-decoration:none} #view-agentsmission .am-ref a:hover{text-decoration:underline} #view-agentsmission .am-ref .w{display:block;color:var(--muted);font-size:11px}
  #view-agentsmission .am-reco{border:1px solid var(--green,#0e9f5a);border-radius:16px;padding:16px 18px;background:rgba(14,159,90,.06)} #view-agentsmission .am-reco h2{margin:0 0 6px;font-size:15px;font-weight:800} #view-agentsmission .am-reco ol{margin:6px 0 0;padding-left:20px;font-size:12.5px;line-height:1.55} #view-agentsmission .am-reco li b{color:var(--green,#0e9f5a)}
  #view-agentsmission .am-note{font-size:11.5px;color:var(--muted);border-left:3px solid #d97706;padding:6px 10px;background:rgba(217,119,6,.06);border-radius:0 8px 8px 0}
  @media (max-width:820px){#view-agentsmission .am-hud{width:220px} #view-agentsmission .am-robots{grid-template-columns:1fr 1fr} #view-agentsmission .am-rb svg{width:96px;height:108px} #view-agentsmission .am-wires{display:none} #view-agentsmission .am-bub{max-width:100%}}
  @media (max-width:520px){#view-agentsmission .am-robots{grid-template-columns:1fr 1fr;gap:6px} #view-agentsmission .am-card{padding:12px} #view-agentsmission .am-player{bottom:4px;padding:10px}}
  @media (prefers-reduced-motion:reduce){#view-agentsmission *{animation-duration:0s!important}}
  `;

  /* ---- the robot (SVG) — colour per agent, classes drive the state animations ---- */
  function robot(color,face){
    return `<svg viewBox="0 0 120 134" aria-hidden="true">
      <g class="rb-think" transform="translate(88,10)"><circle cx="0" cy="0" r="3" fill="${color}"/><circle cx="9" cy="-4" r="4" fill="${color}"/><circle cx="20" cy="-10" r="5" fill="${color}"/></g>
      <text class="rb-zz" x="86" y="22" font-size="14" font-weight="800" fill="var(--muted)">z z</text>
      <g class="rb-body">
        <line x1="60" y1="8" x2="60" y2="22" stroke="${color}" stroke-width="3"/><circle class="rb-lamp" cx="60" cy="7" r="5" fill="${color}"/>
        <rect x="30" y="22" width="60" height="44" rx="14" fill="${color}"/><rect x="36" y="30" width="48" height="28" rx="9" fill="#0b1220" opacity=".85"/>
        <ellipse class="rb-eye" cx="50" cy="44" rx="5" ry="6" fill="#7dfcc0"/><ellipse class="rb-eye r" cx="70" cy="44" rx="5" ry="6" fill="#7dfcc0"/>
        ${face==="smile"?`<path d="M50 52 Q60 58 70 52" stroke="#7dfcc0" stroke-width="2" fill="none" stroke-linecap="round"/>`:`<rect x="52" y="52" width="16" height="3" rx="1.5" fill="#7dfcc0" opacity=".8"/>`}
        <rect x="52" y="66" width="16" height="7" rx="2" fill="${color}" opacity=".7"/>
        <rect x="26" y="73" width="68" height="44" rx="12" fill="${color}" opacity=".92"/>
        <g class="rb-gear" transform="translate(60,95)"><circle r="11" fill="#0b1220" opacity=".85"/><circle r="4" fill="${color}"/><g stroke="${color}" stroke-width="3" stroke-linecap="round"><line x1="0" y1="-9" x2="0" y2="-5"/><line x1="0" y1="9" x2="0" y2="5"/><line x1="-9" y1="0" x2="-5" y2="0"/><line x1="9" y1="0" x2="5" y2="0"/></g></g>
        <g class="rb-arm l" style="--ox:26px;--oy:80px"><rect x="8" y="76" width="18" height="9" rx="4.5" fill="${color}"/><circle cx="8" cy="80.5" r="6" fill="${color}"/></g>
        <g class="rb-arm r" style="--ox:94px;--oy:80px"><rect x="94" y="76" width="18" height="9" rx="4.5" fill="${color}"/><circle cx="112" cy="80.5" r="6" fill="${color}"/></g>
        <rect x="38" y="117" width="14" height="12" rx="4" fill="${color}"/><rect x="68" y="117" width="14" height="12" rx="4" fill="${color}"/>
      </g></svg>`;
  }
  function ensureView(){
    let v=document.getElementById("view-agentsmission"); if(v) return v;
    const st=document.createElement("style"); st.textContent=CSS; document.head.appendChild(st);
    const main=document.querySelector("main")||document.body;
    v=document.createElement("section"); v.id="view-agentsmission"; v.className="view";
    v.innerHTML=`<div class="page-head"><div class="am-head"><div><h1 style="margin:0">AI agents · Mission control</h1><div class="sub">Four autonomous services on the on-prem model — what each one <b>did</b>, is <b>doing now</b>, and <b>should do next</b>. Nothing leaves the network; nothing is applied without a human.</div></div>
      <div class="sp"><span class="am-live"><i></i>live · <span id="amAge">—</span></span><button class="am-btn" id="amReplay">▶ Replay last 24 h</button><button class="am-btn" id="amRefresh">↻ Refresh</button></div></div></div><div class="am-tabs"><button class="am-tab on" data-tab="live">🤖 Mission control</button><button class="am-tab" data-tab="plan">🚀 Move to vLLM / GPU — effort &amp; options</button></div><div id="amHost" class="am-wrap" style="margin-top:12px"><div class="sub" style="padding:24px">${window.salamLoader?window.salamLoader("Waking the robots…"):"Loading…"}</div></div>`;
    main.appendChild(v);
    v.querySelector("#amRefresh").onclick=()=>load(true); v.querySelector("#amReplay").onclick=()=>toggleReplay();
    v.querySelectorAll(".am-tab").forEach(b=>b.onclick=()=>{ S.tab=b.dataset.tab; v.querySelectorAll(".am-tab").forEach(x=>x.classList.toggle("on",x===b)); v.querySelector("#amReplay").style.display=S.tab==="live"?"":"none"; render(); });
    return v;
  }
  const host=()=>document.getElementById("amHost");
  const $=s=>{ const h=host(); return h?h.querySelector(s):null; };

  async function load(force){
    const h=host(); if(!h) return;
    try{ const d=await api("/api/agents/mission"); S.data=d; render(); }
    catch(e){ if(!S.data||force) h.innerHTML=`<div class="albanner" style="border-left:4px solid #dc2626;padding:12px 14px"><b>Mission control unavailable</b> — ${esc(e.message)}</div>`; }
  }

  function stateOf(a){ if(S.play.i>=0){ const st=S.play.steps[S.play.i]; if(st&&st.agent===a.key) return "working"; if(st) return "idle"; } if((S.pulse&&S.pulse.inflight||[]).some(x=>x.agent===a.key)||(S.pulse&&S.pulse.runs||[]).some(x=>x.agent===a.key)) return "working"; if(a.calls&&a.calls.length&&a.state==="idle"&&a.calls.some(c=>Date.now()-new Date(c.last_at).getTime()<90e3)) return "working"; return a.state; }
  function lastSentence(a){
    const inf=(S.pulse&&S.pulse.inflight||[]).filter(x=>x.agent===a.key); if(inf.length){ const x=inf[0]; return `<span class="t">now · thinking for ${Math.round(x.ms/1000)} s</span>${a.key==="yusr"?`answering ${x.actor?esc(x.actor)+"'s":"a"} question…`:esc(x.purpose.replace(/^agent-\w+\./,""))+" — asking the model…"}`; }
    if(a.key==="yusr"){ const y=a.outputs.yusr||{}; return y.calls24?`answered <b>${n(y.calls24)}</b> questions from ${n(y.people24)} people in 24 h · last ${esc(ago(y.last_at))}${y.blocked?` · ${n(y.blocked)} refused (budget)`:""}`:"no question in the last 24 h"; }
    const d=a.did&&a.did[0]; if(!d) return a.state==="disabled"?"switched off in the environment (AGENT_*_ENABLED=0)":"no run recorded yet";
    return `<span class="t">${esc(hm(d.at))} KSA</span>${esc(d.text)}`;
  }
  function render(){
    const d=S.data; if(!d) return; const h=host(); if(!h) return;
    const ageEl=document.getElementById("amAge"); if(ageEl) ageEl.textContent=ksa(d.at,true);
    const br=d.brain||{}; const hp=br.health||{}; const okBrain=hp.ok!==false&&!br.error; const prim=br.primary||{};
    const calls5=d.agents.reduce((a,x)=>a+(x.calls||[]).reduce((s,c)=>s+c.calls,0),0);
    const stage=`<div class="am-stage">
      <div class="am-brain"><div class="am-brainw${S.pin==="brain"?" pin":""}" data-pin="brain" title="hover / click: host · CPU · RAM · loaded model"><div class="am-core ${okBrain?"":"off"}">🧠</div>${hudBrain(d)}</div>
        <div class="am-brainx"><b>${esc(prim.model||"model not configured")}</b>${esc(prim.kind||"")} · ${esc((prim.url||"").replace(/^https?:\/\//,""))}<br>${okBrain?`<span style="color:var(--green,#0e9f5a);font-weight:700">answering</span>`:`<span style="color:#dc2626;font-weight:700">not answering</span>`}${hp.ms?` · ${n(hp.ms)} ms probe`:""} · <b style="display:inline;font-size:12.5px">${n(d.budget.total)}</b> tokens today · ${calls5?`<span style="color:var(--green,#0e9f5a);font-weight:700">${n(calls5)} call(s) in the last 5 min</span>`:"quiet for 5 min"}</div></div>
      <svg class="am-wires" viewBox="0 0 1000 70" preserveAspectRatio="none">${d.agents.map((a,i)=>{ const x=125+i*250; const path=`M500,0 C500,45 ${x},25 ${x},70`; const hot=(a.calls||[]).length>0||stateOf(a)==="working"; return `<path id="amW${i}" d="${path}" fill="none" stroke="${COLOR[a.key]}" stroke-width="2" stroke-dasharray="6 6" opacity="${hot?".9":".3"}"/>${hot?[1,2,3].map(k=>`<circle r="4" fill="${COLOR[a.key]}" class="am-pkt d${k}" style="offset-path:path('${path}')"/>`).join(""):""}`; }).join("")}</svg>
      <div class="am-robots">${d.agents.map(a=>{ const st=stateOf(a); const sm=a.key==="yusr"&&st==="idle"?{label:"idle · waiting for a question",fg:"#2563eb"}:(STATE[st]||STATE.idle); return `<div class="am-rb st-${st}${S.sel===a.key?" sel":""}${S.pin===a.key?" pin":""}" data-k="${a.key}" data-pin="${a.key}" title="${esc(a.name)} — click: pin the performance panel · double-click: open the card">${robot(COLOR[a.key],a.key==="yusr"?"smile":"")}
          <div class="nm">${esc(a.name)}</div><div class="st" style="color:${sm.fg}">● ${esc(st==="idle"&&a.next&&a.next.tick?"idle · next "+until(a.next.tick):sm.label)}</div><div class="pm">${esc(a.short)} · <span class="mono">${esc(a.pm2)}</span></div>
          <div class="am-bub" data-bub="${a.key}">${lastSentence(a)}</div><div style="--ac:${COLOR[a.key]}">${hudAgent(a,d)}</div></div>`; }).join("")}</div><div class="am-hint">hover a robot for CPU · RAM · tokens · speed · latency — click to pin</div></div>`;
    if(S.tab==="plan"){ h.innerHTML=plan(d); bindPlan(); if(S.tick) clearInterval(S.tick); return; }
    const cards=`<div class="am-cards">${d.agents.map(card).join("")}</div>`;
    h.innerHTML=stage+cards+(S.open?player():"");
    h.querySelectorAll("[data-pin]").forEach(el=>el.onclick=e=>{ if(e.target.closest(".am-hud")) return; const k=el.dataset.pin; S.pin=(S.pin===k)?null:k; h.querySelectorAll("[data-pin]").forEach(x=>x.classList.toggle("pin",x.dataset.pin===S.pin)); });
    h.querySelectorAll(".am-rb").forEach(el=>el.ondblclick=()=>{ S.sel=el.dataset.k; h.querySelectorAll(".am-rb").forEach(x=>x.classList.toggle("sel",x.dataset.k===S.sel)); h.querySelectorAll(".am-card").forEach(x=>x.classList.toggle("sel",x.dataset.k===S.sel)); const c=h.querySelector(`.am-card[data-k="${S.sel}"]`); if(c) c.scrollIntoView({behavior:"smooth",block:"start"}); });
    if(S.open) bindPlayer();
    if(S.tick) clearInterval(S.tick);
    S.tick=setInterval(()=>{ if(!h.isConnected){ clearInterval(S.tick); return; } h.querySelectorAll("[data-until]").forEach(el=>el.textContent=until(el.dataset.until)); h.querySelectorAll("[data-since]").forEach(el=>el.textContent=dur(el.dataset.since)); h.querySelectorAll(".am-rb .st[data-next]").forEach(el=>el.textContent="● idle · next "+until(el.dataset.next)); },1000);
    h.querySelectorAll(".am-rb").forEach(el=>{ const a=d.agents.find(x=>x.key===el.dataset.k); const st=el.querySelector(".st"); if(a&&stateOf(a)==="idle"&&a.next&&a.next.tick) st.dataset.next=a.next.tick; });
  }
  function spark(a){
    const H=[]; const now=Date.now(); for(let i=23;i>=0;i--){ const t=Math.floor(now/3600e3)*3600e3-i*3600e3; const r=(a.hours||[]).find(x=>new Date(x.h).getTime()===t); const c=(a.tokensHourly||[]).find(x=>new Date(x.h).getTime()===t); H.push({t,runs:r?r.runs:0,failed:r?r.failed:0,calls:c?c.calls:0}); }
    const v=H.map(x=>a.key==="yusr"?x.calls:x.runs); const mx=Math.max(1,...v);
    return `<div class="am-spark" title="last 24 h · ${a.key==="yusr"?"questions":"runs"} per hour">${H.map((x,i)=>`<i class="${x.failed?"bad":""}${i===23?" now":""}" style="height:${Math.max(2,Math.round(v[i]/mx*34))}px" title="${esc(hm(new Date(x.t).toISOString()))} · ${v[i]} ${a.key==="yusr"?"questions":"runs"}${x.failed?" · "+x.failed+" failed":""}"></i>`).join("")}</div>`;
  }
  function card(a){
    const st=stateOf(a); const sm=a.key==="yusr"&&st==="idle"?{label:"idle · waiting for a question",fg:"#2563eb"}:(STATE[st]||STATE.idle); const c=COLOR[a.key]; const o=a.outputs||{};
    const did=(a.did||[]).length?`<ul class="am-tl">${a.did.map(r=>`<li><span class="t">${esc(hm(r.at))}</span><span class="d ${r.ok===false?"bad":(!r.end?"run":"")}"></span><span class="x">${esc(r.text)}${r.end?` <small>· ${esc(dur(r.at,r.end))}</small>`:""}</span></li>`).join("")}</ul>${a.quiet?`<div class="sub" style="font-size:11px;margin-top:6px">+ ${n(a.quiet)} quiet tick(s) with nothing to do</div>`:""}`
      :a.key==="yusr"?``:`<div class="sub" style="font-size:12px">No run in the last 48 h.</div>`;
    let outputs="";
    if(o.triage&&o.triage.length) outputs+=`<div class="am-out"><h5>Latest triage notes</h5>${o.triage.slice(0,6).map(t=>`<div class="am-row"><span class="am-pill ${t.kind==="duplicate"?"a":t.kind==="flapping"?"v":"g"}">${esc(t.kind)}</span><a class="k" href="#alerts?id=${t.alert_id}" title="${esc(t.probable_cause||"")}">#${t.alert_id} ${esc(t.name||t.rule_key||"")}</a>${t.priority_hint?`<span class="am-pill b">${esc(t.priority_hint)}</span>`:""}${t.suggested_team?`<span class="am-pill">${esc(t.suggested_team)}</span>`:""}${t.confidence!=null?`<span class="am-pill">${Math.round(t.confidence*100)} %</span>`:""}${t.helpful===true?`<span class="am-pill g">👍</span>`:t.helpful===false?`<span class="am-pill r">👎</span>`:""}</div>`).join("")}</div>`;
    if(o.signatures&&o.signatures.length) outputs+=`<div class="am-out"><h5>Latest signatures explained</h5>${o.signatures.slice(0,6).map(s=>`<div class="am-row"><span class="am-pill ${s.class==="technical"?"r":"b"}">${esc(s.class||"?")}</span><span class="k" title="${esc(s.pattern||"")}">${esc(s.endpoint||s.source||"")}${s.code?` · ${esc(s.code)}`:""}</span><span class="am-pill">${esc(s.owner_team||s.category||"")}</span><span class="am-pill ${s.segment==="fixed"?"a":"v"}">${esc(s.segment)}</span><span class="am-pill">${n(s.last_24h)} / 24 h</span></div>`).join("")}</div>`;
    if(o.proposals&&o.proposals.length) outputs+=`<div class="am-out"><h5>Latest team proposals</h5>${o.proposals.slice(0,6).map(p=>`<div class="am-row"><span class="am-pill ${p.status==="proposed"?"a":p.status==="approved"?"g":"r"}">${esc(p.status)}</span><span class="k" title="${esc(p.reason||"")}">${esc(p.rule_key)}</span><span>→ <b>${esc(p.suggested_team)}</b></span><span class="am-pill">${esc(p.method)} · ${Math.round((p.confidence||0)*100)} %</span></div>`).join("")}</div>`;
    if(o.report) outputs+=`<div class="am-out"><h5>Last daily report · ${esc(ksa(o.report.created_at))} · mailed to ${n(o.report.mailed_to)}</h5><div style="font-size:12px;line-height:1.45;color:var(--ink)">${esc(o.report.narrative||"")}${o.report.narrative&&o.report.narrative.length>=300?"…":""}</div></div>`;
    if(a.key==="yusr"){ const y=o.yusr||{}; outputs+=`<div class="am-kv"><b class="am-big">${n(y.calls24)}</b> questions in 24 h<br><span>people</span> ${n(y.people24)} · <span>median answer</span> ${y.avg_ms?n(y.avg_ms)+" ms":"—"} · <span>refused by budget</span> ${n(y.blocked)}<br><span>last question</span> ${esc(ago(y.last_at))}</div>`; }
    const tk=a.tokens||{};
    const now=`<div class="am-kv"><div class="am-big" style="color:${sm.fg}">${esc(sm.label)}</div>
      ${(a.inflight||[]).length?`<div>model call in progress: <b>${esc(a.inflight[0].purpose)}</b>${a.inflight[0].actor?` for <b>${esc(a.inflight[0].actor)}</b>`:""} · <b data-since="${a.inflight[0].at}">${esc(dur(a.inflight[0].at))}</b></div>`:""}${st==="working"&&a.last&&!a.last.finished_at?`<div>running for <b data-since="${a.last.started_at}">${esc(dur(a.last.started_at))}</b></div>`:a.last?`<div><span>last run</span> ${esc(ago(a.last.started_at))} · ${a.last.ok===false?`<span style="color:#dc2626;font-weight:700">failed</span>`:`took ${esc(dur(a.last.started_at,a.last.finished_at))}`}</div>`:""}
      ${a.every?`<div><span>cadence</span> every ${a.every>=3600e3?(a.every/3600e3)+" h":(a.every/60e3)+" min"}</div>`:""}
      <div><span>model calls · last 5 min</span> ${(a.calls||[]).length?a.calls.map(x=>`<b>${n(x.calls)}</b> ${esc(x.purpose)}${x.failed?` <span style="color:#dc2626">(${x.failed} failed)</span>`:""}`).join(", "):"none"}</div>
      <div><span>today</span> <b>${n(tk.calls)}</b> calls · <b>${n(tk.tokens)}</b> tokens${tk.avg_ms?` · ${n(tk.avg_ms)} ms avg`:""}${tk.blocked?` · <span style="color:#dc2626">${n(tk.blocked)} refused by budget</span>`:""}</div></div>${spark(a)}`;
    const nx=a.next||{};
    const next=`${nx.tick?`<div class="am-cd" data-until="${nx.tick}">${esc(until(nx.tick))}</div><div class="sub" style="font-size:11px;margin-bottom:8px">next tick · ${esc(hm(nx.tick))} KSA${st==="stale"?` · <span style="color:#d97706;font-weight:700">overdue — check pm2 ${esc(a.pm2)}</span>`:""}</div>`:a.key==="yusr"?`<div class="am-cd">on demand</div><div class="sub" style="font-size:11px;margin-bottom:8px">answers when someone asks</div>`:`<div class="am-cd">—</div>`}
      ${nx.report?`<div class="am-q"><span class="num">${String(nx.reportHour).padStart(2,"0")}:00</span><span class="lb">daily report<small>${esc(ksa(nx.report))} KSA · <span data-until="${nx.report}">${esc(until(nx.report))}</span></small></span></div>`:""}
      ${(a.queue||[]).map(q=>`<div class="am-q"><span class="num${q.n?"":" z"}">${n(q.n)}</span><span class="lb">${esc(q.label)}<small>${esc(q.hint||"")}</small></span>${q.link&&q.n?`<a href="${q.link}">open</a>`:""}</div>`).join("")}
      ${(a.human||[]).length?`<h4 style="margin-top:10px">🙋 needs a human</h4>${a.human.map(q=>`<div class="am-q hu"><span class="num${q.n?"":" z"}">${n(q.n)}</span><span class="lb">${esc(q.label)}<small>${esc(q.hint||"")}</small></span>${q.link&&q.n?`<a href="${q.link}">go</a>`:""}</div>`).join("")}`:""}
      ${a.key==="yusr"?`<div class="sub" style="font-size:12px">Ask it from the ✦ button — every answer is logged in Settings › Agents › LLM calls.</div>`:""}`;
    return `<div class="am-card${S.sel===a.key?" sel":""}" data-k="${a.key}" style="--ac:${c}"><div class="am-ch"><span class="tag">${esc(a.short)}</span><h2>${esc(a.name)}</h2><span class="pm2">${esc(a.pm2)}</span><span class="stt" style="color:${sm.fg}"><i></i>${esc(sm.label)}</span></div>
      <div class="am-role">${esc(a.role)}</div>
      <div class="am-3"><div class="am-col"><h4><b>✓</b> what it did</h4>${did}${outputs}</div><div class="am-col"><h4><b>◉</b> what it is doing now</h4>${now}</div><div class="am-col"><h4><b>→</b> what it should do</h4>${next}</div></div></div>`;
  }

  /* ---- replay: every run of the last 24 h, in order, narrated ---- */
  function buildSteps(){
    const d=S.data; const steps=[]; const since=Date.now()-24*3600e3;
    for(const a of d.agents){ for(const r of (a.did||[])){ if(new Date(r.at).getTime()<since) continue; steps.push({agent:a.key,name:a.name,at:r.at,end:r.end,ok:r.ok,text:r.text}); } }
    steps.sort((x,y)=>new Date(x.at)-new Date(y.at)); return steps.slice(-200);
  }
  function player(){
    const p=S.play; const st=p.steps; const since=Date.now()-24*3600e3; const X=t=>((new Date(t).getTime()-since)/(24*3600e3)*100).toFixed(2);
    const lanes=S.data.agents.filter(a=>a.key!=="yusr");
    return `<div class="am-player"><div class="ctl"><b style="font-size:13px">Replay · last 24 h</b><span class="cnt" id="amCnt">${p.i+1} / ${st.length}</span><button class="am-btn" id="amPrev" title="←">‹ Prev</button><button class="am-btn p" id="amAuto">${p.auto?"❚❚ Pause":"▶ Auto-play"}</button><button class="am-btn" id="amNext" title="→">Next ›</button>
        <select id="amSpeed" title="seconds per step"><option value="4"${p.speed===4?" selected":""}>slow · 4 s</option><option value="2.5"${p.speed===2.5?" selected":""}>2.5 s</option><option value="1"${p.speed===1?" selected":""}>fast · 1 s</option></select><button class="am-btn x" id="amClose">✕ Close</button></div>
      <div class="am-narr" id="amNarr">${st.length?(p.i>=0?narr(st[p.i]):"Press <b>Next</b> or <b>Auto-play</b> — each step is one run of one agent, the robot on the stage works while its step is shown."):"No run in the last 24 h to replay."}</div>
      <div class="am-track" id="amTrack">${lanes.map((a,li)=>`<div class="lane" style="top:${4+li*13}px">${st.map((s,i)=>s.agent===a.key?`<i data-i="${i}" class="${i===p.i?"on":""}" style="left:${X(s.at)}%;background:${s.ok===false?"#dc2626":COLOR[a.key]}" title="${esc(hm(s.at))} · ${esc(a.name)}"></i>`:"").join("")}</div>`).join("")}
        ${[0,6,12,18,24].map(k=>`<span class="hr" style="left:${k/24*100}%">${esc(hm(new Date(since+k*3600e3).toISOString()))}</span>`).join("")}${p.i>=0?`<div class="cur" style="left:${X(st[p.i].at)}%"></div>`:""}</div></div>`;
  }
  const narr=s=>`<span class="t">${esc(hm(s.at))} KSA</span><b class="w" style="--ac:${COLOR[s.agent]}">${esc(s.name)}</b> — ${esc(s.text)}${s.end?` <span class="t">(${esc(dur(s.at,s.end))})</span>`:""}${s.ok===false?` <span style="color:#dc2626;font-weight:700">✗</span>`:" ✓"}`;
  function bindPlayer(){
    const h=host(); const p=S.play; const go=i=>{ if(!p.steps.length) return; p.i=Math.max(0,Math.min(p.steps.length-1,i)); const nr=h.querySelector("#amNarr"); if(nr) nr.innerHTML=narr(p.steps[p.i]); const c=h.querySelector("#amCnt"); if(c) c.textContent=(p.i+1)+" / "+p.steps.length;
      h.querySelectorAll("#amTrack .lane i").forEach(el=>el.classList.toggle("on",Number(el.dataset.i)===p.i)); const cur=h.querySelector("#amTrack .cur"); const since=Date.now()-24*3600e3; const left=((new Date(p.steps[p.i].at).getTime()-since)/(24*3600e3)*100).toFixed(2)+"%"; if(cur) cur.style.left=left; else h.querySelector("#amTrack").insertAdjacentHTML("beforeend",`<div class="cur" style="left:${left}"></div>`);
      h.querySelectorAll(".am-rb").forEach(el=>{ const a=S.data.agents.find(x=>x.key===el.dataset.k); el.className="am-rb st-"+stateOf(a)+(S.sel===a.key?" sel":"")+(S.pin===a.key?" pin":""); const b=el.querySelector(".am-bub"); if(b&&a.key===p.steps[p.i].agent) b.innerHTML=`<span class="t">${esc(hm(p.steps[p.i].at))} KSA · replay</span>${esc(p.steps[p.i].text)}`; });
      if(p.i===p.steps.length-1&&p.auto) stopAuto(); };
    const stopAuto=()=>{ if(p.auto){ clearInterval(p.auto); p.auto=null; } const b=h.querySelector("#amAuto"); if(b) b.textContent="▶ Auto-play"; };
    h.querySelector("#amPrev").onclick=()=>go(p.i-1); h.querySelector("#amNext").onclick=()=>go(p.i+1);
    h.querySelector("#amAuto").onclick=()=>{ if(p.auto) return stopAuto(); if(p.i>=p.steps.length-1) p.i=-1; go(p.i+1); p.auto=setInterval(()=>go(p.i+1),p.speed*1000); h.querySelector("#amAuto").textContent="❚❚ Pause"; };
    h.querySelector("#amSpeed").onchange=e=>{ p.speed=Number(e.target.value); if(p.auto){ clearInterval(p.auto); p.auto=setInterval(()=>go(p.i+1),p.speed*1000); } };
    h.querySelector("#amClose").onclick=()=>toggleReplay();
    h.querySelectorAll("#amTrack .lane i").forEach(el=>el.onclick=()=>go(Number(el.dataset.i)));
    if(!S.keys){ S.keys=e=>{ if(!S.open||!document.getElementById("view-agentsmission").classList.contains("active")) return; if(/input|select|textarea/i.test(e.target.tagName)) return; if(e.key==="ArrowRight"){ e.preventDefault(); go(S.play.i+1); } if(e.key==="ArrowLeft"){ e.preventDefault(); go(S.play.i-1); } }; document.addEventListener("keydown",S.keys); }
    S.play.go=go;
  }
  function toggleReplay(){ S.open=!S.open; if(S.open){ S.play={steps:buildSteps(),i:-1,auto:null,speed:S.play.speed||2.5}; } else { if(S.play.auto) clearInterval(S.play.auto); S.play.i=-1; S.play.auto=null; } render(); const b=document.getElementById("amReplay"); if(b) b.textContent=S.open?"■ Stop replay":"▶ Replay last 24 h"; if(S.open){ const pl=host().querySelector(".am-player"); if(pl) pl.scrollIntoView({behavior:"smooth",block:"end"}); } }

  /* ---------------- the move: vLLM on a GPU server — on-prem or cloud ---------------- */
  const MODELS={ "allam":{name:"ALLaM 7B Instruct (SDAIA · Arabic + English)",vram:"~14 GB fp16 · ~5 GB INT4",gpu:"1 × L4 (24 GB) is enough",tps:"~700–1 300 tok/s aggregate, ~70–100 tok/s per stream",note:"the Kingdom's own bilingual model (Apache-2.0, on Hugging Face, vLLM-ready) — the natural choice for Yusr in Arabic and for Arabic incident text; keep Qwen/Llama for JSON-heavy triage until benchmarked"},
    "8b":{name:"Llama 3.1 8B Instruct",vram:"~16 GB fp16 · ~8 GB AWQ/INT4",gpu:"1 × L4 (24 GB) or A10G",tps:"~600–1 200 tok/s aggregate, ~60–90 tok/s per stream",note:"same model as today — the safest first step, quality unchanged, only speed"},
    "14b":{name:"Qwen2.5 14B Instruct",vram:"~28 GB fp16 · ~10 GB AWQ/INT4",gpu:"1 × L40S / A100 40 GB (fp16) or 1 × L4 with AWQ",tps:"~400–900 tok/s aggregate, ~40–70 tok/s per stream",note:"noticeably better JSON discipline and Arabic — the GPU VM request already names it"},
    "32b":{name:"Qwen2.5 32B Instruct",vram:"~64 GB fp16 · ~20 GB AWQ/INT4",gpu:"1 × A100 80 GB / H100, or 2 × L40S",tps:"~250–600 tok/s aggregate, ~25–45 tok/s per stream",note:"best reasoning on triage; only worth it once the agents' prompts grow (evidence packs, RCA drafts)"} };
  const OPTS=[
    {k:"onprem",c:"#0e9f5a",name:"A · On-prem GPU server + vLLM",who:"Salam data centre · Infra team · same VLAN as 152 and 121",bul:["one GPU server: L40S 48 GB recommended (card ≈ 30–34 k SAR, a 1-GPU server ≈ 45–70 k SAR); L4 24 GB minimum (card ≈ 8–11 k SAR, server ≈ 22–35 k SAR)","Ubuntu 22.04 · NVIDIA driver + CUDA · Docker · vLLM (OpenAI-compatible /v1) as a service; weights pulled once through the proxy (Qwen2.5 / Llama 3.1 / ALLaM from Hugging Face)","console: LLM_FALLBACK_* → Self-test → order flip in Settings › Agents — no code change","data never leaves Salam's network; PDPL and the on-prem-only decision satisfied by construction"],
      effort:"1–2 weeks after the hardware lands (procurement 2–8 weeks) · ~3 person-days Infra · ~1 person-day console",cost:"capex ≈ 45–70 k SAR one-off (L40S server) or 22–35 k SAR (L4) · then power and rack only",verdict:{c:"go",t:"Recommended target — matches the on-prem-only decision; the console already supports it"}},
    {k:"cloudvm",c:"#d97706",name:"B · KSA-resident GPU cloud + vLLM",who:"in-Kingdom GPU rental: DCP (dcp.sa, per-second billing, PDPL), Google Cloud Dammam G2/L4 via CNTXT, Alibaba Cloud Riyadh (SCCC), Oracle Riyadh / Jeddah",bul:["same vLLM image on a rented GPU inside Saudi Arabia — DCP lists L40S from 5.2 SAR/h, A100 from 7.3 SAR/h, H100 from 17.27 SAR/h; Google Dammam L4 ≈ 2.7 SAR/h (g2-standard-4, US list ≈ 0.71 USD/h — Dammam is priced higher)","data stays in the Kingdom but leaves Salam's network → private link / VPN / IP allowlist from 152 and a DPA with the provider","ideal as the 2-week BRIDGE and BENCHMARK before buying: rent an L40S for a month (≈ 3 800 SAR), run the Self-test and a replay of real triage prompts, size the on-prem server from the numbers","console side identical to A (LLM_FALLBACK_*)"],
      effort:"1–2 weeks elapsed (DPA + network) · ~2 person-days Infra/Sec · ~1 person-day console",cost:"opex ≈ 2 000–3 800 SAR/month for one L4/L40S always-on (DCP L40S 5.2 SAR/h × 730 h ≈ 3 800 SAR) · A100 ≈ 5 300 SAR/month · plus the private link",verdict:{c:"mid",t:"Recommended as the bridge: rent for one or two months, benchmark, then buy A with real numbers"}},
    {k:"cloudapi",c:"#dc2626",name:"C · Managed inference API",who:"in-Kingdom: DCP inference API (api.dcp.sa/v1, OpenAI-compatible, from 0.05 SAR per 1M tokens), stc Group sovereign LLM platform (Llama 405B, SambaNova), ALLaM via Azure AI Foundry / IBM watsonx · outside KSA: not an option for incident data",bul:["fastest to try — kind=openai + key, one .env change; the strongest models without owning a GPU","every prompt leaves Salam's network to a third party: masked incident context, customer counts, dealer names — needs a DPA, a PDPL assessment and an exception to the on-prem-only decision even when the provider is in the Kingdom","per-token billing: at today's volume a few SAR a day; grows with every new agent and longer evidence packs","no control of model version, context size or availability during an incident storm"],
      effort:"1–2 days technically · weeks for legal / DPA / security approval",cost:"opex at today's volume: tens of SAR/month at DCP list price (0.05 SAR per 1M tokens), hundreds at hyperscaler prices — the cost is the policy exception, not the bill",verdict:{c:"no",t:"Not for incident data — acceptable only for non-sensitive experiments (e.g. Arabic phrasing tests for Yusr with synthetic prompts)"}} ];
  function plan(d){
    const u=(d.usage&&d.usage.total)||{}; const bc=(d.usage&&d.usage.byCaller)||{}; const peak=(d.usage&&d.usage.peakHour)||null; const h=(d.perf&&d.perf.host)||{}; const md=(d.perf&&d.perf.model)||{};
    const tokS=Object.values(bc).map(x=>x.tok_s).filter(Boolean); const curTps=tokS.length?Math.round(tokS.reduce((a,b)=>a+b,0)/tokS.length*10)/10:null;
    const avgS=u.avg_ms?Math.round(u.avg_ms/1000):null; const perDay=(u.perDay||{}); const conc=S.plan.conc||Math.max(2,(d.usage&&d.usage.maxConcurrent)||1);
    const answerPerDay=Math.round((u.answer_tokens||0)/7); const peakTok=peak?Number(peak.answer_tokens||0):0;
    const needTps=Math.max(20,Math.round(peakTok/3600*3)); // sustain 3× the busiest hour's answer tokens
    const m=MODELS[S.plan.model]; const opt=OPTS.find(o=>o.k===S.plan.target)||OPTS[0];
    const inc=bc["salam-agent-incident"]||{}; const gpuSpeed=GPU_TPS[S.plan.model]; const gain=curTps?Math.round(gpuSpeed/curTps):null;
    const backlog=(d.agents.find(a=>a.key==="log")||{}).queue||[]; const unassessed=(backlog.find(q=>/assess/.test(q.label))||{}).n||0;
    return `<div class="am-plan">
      <div class="am-sec"><h2>Where we are — measured on our console, last 7 days</h2><div class="sub">These are our real numbers from <code>llm_calls</code> and the 152 host — the load any new server must carry from day one.</div>
        <div class="am-pk">
          <div class="k"><b>${n(perDay.calls)}</b><span>model calls / day (${n(u.calls)} in 7 d)</span></div>
          <div class="k"><b>${n(perDay.tokens)}</b><span>tokens / day · ${n(answerPerDay)} generated</span></div>
          <div class="k"><b>${curTps!=null?curTps+" tok/s":"—"}</b><span>generation speed today (CPU · ${esc((md.models&&md.models[0]&&md.models[0].name)||(d.brain&&d.brain.primary&&d.brain.primary.model)||"model")})</span></div>
          <div class="k"><b>${avgS!=null?avgS+" s":"—"}</b><span>average answer · p95 ${inc.p95_ms?Math.round(inc.p95_ms/1000)+" s":"—"} on triage</span></div>
          <div class="k"><b>${n(d.usage&&d.usage.maxConcurrent)}</b><span>max concurrent calls (24 h) · ${h.cores||"?"} CPU cores, ${gb((h.mem||{}).total)} RAM, ${h.gpu&&h.gpu.length?"GPU present":"no GPU"}</span></div>
          <div class="k"><b>${n(unassessed)}</b><span>signatures waiting for the model — the CPU cannot keep up with the log agent</span></div>
        </div>
        ${peak?`<div class="am-note" style="margin-top:10px">Busiest hour of the week: ${esc(ksa(peak.h))} KSA — ${n(peak.calls)} calls, ${n(peak.tokens)} tokens. A GPU server should sustain about <b>3 × that hour</b> without queueing: <b>≈ ${n(needTps)} tok/s aggregate</b>. Every option below does that with one mid-range GPU.</div>`:""}</div>

      ${valueSection(d)}
      <div class="am-sec"><h2>What changes in our console — almost nothing</h2><div class="sub">llm.js already speaks two dialects (Ollama and OpenAI-compatible) with fail-over, JSON mode, probe, budget and audit. vLLM is OpenAI-compatible, so the move is configuration, tested live with the Self-test on Settings › Agents.</div>
        <div class="am-code">LLM_FALLBACK_KIND=openai
LLM_FALLBACK_URL=http://&lt;gpu-server&gt;:8000/v1
LLM_FALLBACK_MODEL=${S.plan.model==="allam"?"humain-ai/ALLaM-7B-Instruct-preview":S.plan.model==="8b"?"meta-llama/Llama-3.1-8B-Instruct":S.plan.model==="14b"?"Qwen/Qwen2.5-14B-Instruct":"Qwen/Qwen2.5-32B-Instruct"}
LLM_FALLBACK_KEY=            # empty on-prem, or the vLLM --api-key
# order: Settings › Agents › Configure → "fallback first" once the Self-test is green for a day · Ollama on 152 stays the safety net</div>
        <div class="sub" style="margin-top:8px">Then: Settings › Agents › <b>Probe</b> and <b>Self-test</b> (all five probes, JSON grammar on/off) → watch Mission control for a day (speed, p95, fail %) → flip the order. Rollback = one line.</div></div>

      <div class="am-sec"><h2>Pick our scenario</h2>
        <div class="am-ctl"><label>Where <select id="amTarget">${OPTS.map(o=>`<option value="${o.k}"${S.plan.target===o.k?" selected":""}>${esc(o.name)}</option>`).join("")}</select></label>
          <label>Model <select id="amModel">${Object.entries(MODELS).map(([k,x])=>`<option value="${k}"${S.plan.model===k?" selected":""}>${esc(x.name)}</option>`).join("")}</select></label>
          <label>Concurrency to plan for <input id="amConc" type="number" min="1" max="64" value="${conc}"></label></div>
        <div class="am-pk" style="margin-top:12px">
          <div class="k"><b>${esc(m.gpu)}</b><span>GPU for ${esc(m.name)} · VRAM ${esc(m.vram)}</span></div>
          <div class="k"><b>${gain?"≈ "+gain+"×":"—"}</b><span>faster per answer than today (${esc(m.tps)})</span></div>
          <div class="k"><b>${avgS!=null?Math.max(1,Math.round(avgS/(gain||1)))+" s":"—"}</b><span>expected average triage answer instead of ${avgS!=null?avgS+" s":"—"}</span></div>
          <div class="k"><b>${conc} streams</b><span>vLLM batches them on one GPU — no queueing at this concurrency</span></div>
        </div>
        <div class="am-note" style="margin-top:10px">${esc(m.note)}. Throughput figures are indicative public vLLM numbers for these GPU classes — confirm with a one-hour benchmark on the real server (the Self-test reports tok/s).</div></div>

      <div class="am-opts">${OPTS.map(o=>`<div class="am-opt${S.plan.target===o.k?" on":""}" data-opt="${o.k}" style="--oc:${o.c}"><h3>${esc(o.name)}</h3><div class="who">${esc(o.who)}</div><ul>${o.bul.map(b=>`<li>${esc(b)}</li>`).join("")}</ul>
          <div class="am-kv" style="margin-top:8px"><span>effort</span> ${esc(o.effort)}<br><span>cost</span> ${esc(o.cost)}</div><div class="verdict ${o.verdict.c}">${esc(o.verdict.t)}</div></div>`).join("")}</div>

      <div class="am-sec"><h2>Our plan for ${esc(opt.name)}</h2><div class="sub">Sequenced so that our production never depends on the new server until it has answered for a full day.</div>
        <ol class="am-steps">${steps(S.plan.target).map(s=>`<li><b>${esc(s[0])}</b>${esc(s[1])}<div class="d">${esc(s[2])}</div></li>`).join("")}</ol></div>

      <div class="am-sec"><h2>Side by side</h2><table class="am-t"><thead><tr><th>Criterion</th><th>Today · CPU on 152</th>${OPTS.map(o=>`<th style="color:${o.c}">${esc(o.name.slice(0,1))}</th>`).join("")}</tr></thead><tbody>
        ${[["Data stays in Salam's network","yes","yes","no — stays in KSA (private link + DPA)","no — stays in KSA only with an in-Kingdom provider"],["Answer speed (8B–14B)",curTps?curTps+" tok/s":"~15 tok/s","40–90 tok/s per stream","40–90 tok/s per stream","fast"],["Concurrent agents + Yusr","one at a time (shared CPU)","batched on GPU","batched on GPU","unlimited"],["Console change","—","2 .env lines","2 .env lines + network","2 .env lines + key"],["Time to first answer","—","1–2 weeks after hardware (procurement 2–8 wk)","1–2 weeks","days (policy: weeks)"],["Monthly run cost","0 (existing VM)","power only · 45–70 k SAR once","≈ 2 000–5 300 SAR","tens of SAR → grows with use"],["Model choice","8B (RAM-bound)","up to 32B","up to 70B+","any"],["Policy fit (on-prem only)","✓","✓","exception (in-Kingdom, not on-prem)","✗"]].map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td>${r.slice(2).map((c,i)=>`<td class="${OPTS[i].k===S.plan.target?"hl":""}">${esc(c)}</td>`).join("")}</tr>`).join("")}
      </tbody></table><div class="am-note" style="margin-top:10px">Prices are indicative KSA-market figures in SAR (public list prices at 1 USD = 3.75 SAR, September 2026) and throughput figures are published vLLM benchmarks — not a quote. Get two quotes for the on-prem server and one month of in-Kingdom rental as the benchmark before deciding.</div></div>
      ${recoSection()}${refsSection()}</div>`;
  }
  /* ---- the value: measured today vs projected, drawn ---- */
  const OPTC={today:"#64748b",onprem:"#0e9f5a",cloudvm:"#d97706",cloudapi:"#dc2626"};
  const GPU_TPS={"allam":85,"8b":75,"14b":55,"32b":35}; const PREFILL=2500;   // per-stream generation tok/s on an L4/L40S class GPU, and prompt-processing tok/s
  function projected(u,model,where){
    const calls=Math.max(1,u.calls||1); const pt=(u.prompt_tokens||0)/calls, at=(u.answer_tokens||0)/calls;
    const tps=where==="cloudapi"?60:GPU_TPS[model]; const net=where==="onprem"?0.05:where==="cloudvm"?0.15:0.4;
    return Math.max(0.8,pt/PREFILL+at/tps+net);   // seconds
  }
  const secs=v=>v==null?"—":v>=60?(v/60).toFixed(1)+" min":v>=10?Math.round(v)+" s":v.toFixed(1)+" s";
  function hbars(rows,max,unit){   // rows: [{label, sub, v, c, txt}]
    const W=520, L=150, R=70, rowH=26, H=rows.length*rowH+8; const iw=W-L-R;
    return `<svg viewBox="0 0 ${W} ${H}">${rows.map((r,i)=>{ const y=4+i*rowH; const w=Math.max(2,r.v/max*iw); return `<text x="${L-8}" y="${y+16}" text-anchor="end" font-size="11" font-weight="${r.bold?"800":"600"}" fill="var(--ink)">${esc(r.label)}</text><rect x="${L}" y="${y+4}" width="${w.toFixed(1)}" height="16" rx="5" fill="${r.c}" opacity="${r.bold?"1":".85"}"/><text x="${(L+w+6).toFixed(1)}" y="${y+16}" font-size="11" font-weight="800" fill="var(--ink)">${esc(r.txt)}</text>`; }).join("")}</svg>`;
  }
  function valueSection(d){
    const u=(d.usage&&d.usage.total)||{}; const bc=(d.usage&&d.usage.byCaller)||{}; const model=S.plan.model; const where=S.plan.target; const md=(d.perf&&d.perf.model)||{};
    const callers=[["salam-agent-incident","Triage note (Agent 2)"],["salam-agent-log","Signature batch (Agent 1)"],["console","Yusr answer"]].filter(([k])=>bc[k]&&bc[k].calls);
    /* 1 · latency per answer: measured today vs the three targets */
    const latRows=[]; let maxL=1;
    for(const [k,label] of callers){ const x=bc[k]; const today=(x.avg_ms||0)/1000; const p95=(x.p95_ms||0)/1000; const rows=[{label,sub:"today · CPU",v:today,c:OPTC.today,txt:secs(today)+" (p95 "+secs(p95)+")",bold:false}];
      for(const o of OPTS){ const v=projected(x,model,o.k); rows.push({label:"  "+o.name.slice(0,1)+" · "+(o.k==="onprem"?"on-prem GPU":o.k==="cloudvm"?"cloud GPU VM":"managed API"),v,c:OPTC[o.k],txt:secs(v)+"  ("+Math.max(1,Math.round(today/v))+"× faster)",bold:o.k===where}); }
      latRows.push(...rows); maxL=Math.max(maxL,today*1.05); }
    /* 2 · capacity: answers per hour the model server can deliver (sequential CPU vs batched GPU) */
    const inc=bc["salam-agent-incident"]||{avg_ms:18000,prompt_tokens:0,answer_tokens:0,calls:1}; const todayPerH=inc.avg_ms?Math.round(3600e3/inc.avg_ms):0;
    const conc=S.plan.conc||Math.max(2,(d.usage&&d.usage.maxConcurrent)||1);
    const capRows=[{label:"today · CPU (1 stream)",v:todayPerH,c:OPTC.today,txt:n(todayPerH)+" / h"}].concat(OPTS.map(o=>{ const per=projected(inc,model,o.k); const v=Math.round(3600/per*(o.k==="cloudapi"?conc:Math.min(conc,16))); return {label:o.name.slice(0,1)+" · "+conc+" streams",v,c:OPTC[o.k],txt:n(v)+" / h",bold:o.k===where}; }));
    const maxC=Math.max(...capRows.map(r=>r.v),1);
    /* 3 · backlog drain: the unassessed signatures, 15 per batch, one batch = one log-agent call */
    const logU=bc["salam-agent-log"]||{avg_ms:26000,prompt_tokens:0,answer_tokens:0,calls:1}; const backlog=((d.agents.find(a=>a.key==="log")||{}).queue||[]).reduce((m,q)=>/assess/.test(q.label)?q.n:m,0);
    const batches=Math.ceil(backlog/15); const todayH=batches*(logU.avg_ms||26000)/3600e3; const drain=OPTS.map(o=>({k:o.k,h:batches*projected(logU,model,o.k)/3600/Math.min(conc,8)}));
    const maxD=Math.max(todayH,1e-6); const W=520,H=150,L=44,B=24; const iw=W-L-12, ih=H-B-10;
    const curve=(rate,c,w)=>{ const pts=[]; for(let i=0;i<=40;i++){ const t=i/40*maxD; const left=Math.max(0,backlog-backlog*(t/rate)); pts.push(`${(L+t/maxD*iw).toFixed(1)},${(10+ih-left/Math.max(1,backlog)*ih).toFixed(1)}`); if(left<=0) break; } return `<polyline points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`; };
    const drainSvg=`<svg viewBox="0 0 ${W} ${H}"><line x1="${L}" x2="${W-12}" y1="${10+ih}" y2="${10+ih}" stroke="var(--line)"/><line x1="${L}" x2="${L}" y1="10" y2="${10+ih}" stroke="var(--line)"/>
      <text x="${L-6}" y="16" text-anchor="end" font-size="10" fill="var(--muted)">${n(backlog)}</text><text x="${L-6}" y="${10+ih}" text-anchor="end" font-size="10" fill="var(--muted)">0</text>
      ${[0,.25,.5,.75,1].map(f=>`<text x="${(L+f*iw).toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="10" fill="var(--muted)">${secs(f*maxD*3600)}</text>`).join("")}
      ${curve(todayH,OPTC.today,2)}${drain.map(x=>curve(x.h,OPTC[x.k],x.k===where?3.5:1.6)).join("")}</svg>`;
    /* 4 · effort vs value: x = weeks to first answer, y = value score, bubble = monthly run cost */
    const pts=[{k:"today",x:0,y:10,r:8,name:"stay on CPU",c:OPTC.today},{k:"onprem",x:4,y:90,r:9,name:"A · on-prem GPU (after procurement)",c:OPTC.onprem},{k:"cloudvm",x:1.5,y:74,r:13,name:"B · KSA GPU rental (bridge)",c:OPTC.cloudvm},{k:"cloudapi",x:0.5,y:38,r:11,name:"C · managed API",c:OPTC.cloudapi}];
    const EW=520,EH=200,EL=40,EB=28; const ex=x=>EL+x/5*(EW-EL-16), ey=y=>10+(1-y/100)*(EH-EB-10);
    const effSvg=`<svg viewBox="0 0 ${EW} ${EH}"><line x1="${EL}" x2="${EW-16}" y1="${ey(0)}" y2="${ey(0)}" stroke="var(--line)"/><line x1="${EL}" x2="${EL}" y1="10" y2="${ey(0)}" stroke="var(--line)"/>
      ${[0,1,2,3,4,5].map(w=>`<text x="${ex(w)}" y="${EH-8}" text-anchor="middle" font-size="10" fill="var(--muted)">${w} wk</text>`).join("")}<text x="${EL-6}" y="${ey(100)+4}" text-anchor="end" font-size="10" fill="var(--muted)">value</text><text x="${EL-6}" y="${ey(0)}" text-anchor="end" font-size="10" fill="var(--muted)">0</text>
      ${pts.map(p=>`<circle cx="${ex(p.x)}" cy="${ey(p.y)}" r="${p.r}" fill="${p.c}" opacity="${p.k===where?"1":".55"}" stroke="${p.k===where?"var(--ink)":"none"}" stroke-width="2"/><text x="${ex(p.x)+p.r+6}" y="${ey(p.y)+4}" font-size="11" font-weight="${p.k===where?"800":"600"}" fill="var(--ink)">${esc(p.name)}</text>`).join("")}
</svg>`;
    /* 5 · 24-month cost: A capex once, B monthly, C per token growing 15 %/quarter */
    const capex=S.plan.capex||55000, cloudM=S.plan.cloudM||3800, apiPer1M=S.plan.apiPer1M||2, apiM0=Math.max(5,Math.round(((u.perDay||{}).tokens||0)*30/1e6*apiPer1M));
    const series={onprem:[],cloudvm:[],cloudapi:[]}; let a=capex,b=0,c=0; for(let m=0;m<=24;m++){ series.onprem.push(a); series.cloudvm.push(b); series.cloudapi.push(c); a+=capex*0.01; b+=cloudM; c+=apiM0*Math.pow(1.15,Math.floor(m/3)); }
    const maxK=Math.max(...Object.values(series).map(x=>x[24]),1); const CW=1040,CH=200,CL=54,CB=24; const cx=m=>CL+m/24*(CW-CL-12), cy=v=>10+(1-v/maxK)*(CH-CB-10);
    const costSvg=`<svg viewBox="0 0 ${CW} ${CH}"><line x1="${CL}" x2="${CW-12}" y1="${cy(0)}" y2="${cy(0)}" stroke="var(--line)"/>${[0,.5,1].map(f=>`<text x="${CL-6}" y="${cy(f*maxK)+4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(f*maxK/1000)} k SAR</text><line x1="${CL}" x2="${CW-12}" y1="${cy(f*maxK)}" y2="${cy(f*maxK)}" stroke="var(--line-soft,var(--line))"/>`).join("")}
      ${[0,6,12,18,24].map(m=>`<text x="${cx(m)}" y="${CH-6}" text-anchor="middle" font-size="10" fill="var(--muted)">M${m}</text>`).join("")}
      ${Object.entries(series).map(([k,v])=>`<polyline points="${v.map((y,m)=>`${cx(m).toFixed(1)},${cy(y).toFixed(1)}`).join(" ")}" fill="none" stroke="${OPTC[k]}" stroke-width="${k===where?3.5:1.8}" opacity="${k===where?1:.7}"/><text x="${cx(24)+4}" y="${cy(v[24])+4}" font-size="10" font-weight="800" fill="${OPTC[k]}">${k==="onprem"?"A":k==="cloudvm"?"B":"C"}</text>`).join("")}</svg>`;
    const incToday=(inc.avg_ms||0)/1000, incNew=projected(inc,model,where); const yu=bc.console||null;
    const optName=(OPTS.find(o=>o.k===where)||{}).name||"";
    const logToday=(logU.avg_ms||0)/1000, logNew=projected(logU,model,where); const yuToday=yu?(yu.avg_ms||0)/1000:null, yuNew=yu?projected(yu,model,where):null;
    const capNew=(capRows.find(r=>r.bold)||capRows[1]).v; const drainNew=(drain.find(z=>z.k===where)||drain[0]).h;
    /* hours of waiting removed per day — every call of every agent and every Yusr question, today's average minus the projected one */
    const savedH=[["salam-agent-incident",incToday-incNew],["salam-agent-log",logToday-logNew],["console",yu?yuToday-yuNew:0]].reduce((a,[k,dt])=>a+((bc[k]||{}).calls||0)/7*Math.max(0,dt),0)/3600;
    const pct=(a,b)=>a>0?Math.round((1-b/a)*100):0; const times=(a,b)=>b>0?Math.max(1,Math.round(a/b)):1;
    const baRow=(label,value,delta,bad)=>`<div class="am-bar2"><span class="l">${label}</span><span class="v">${esc(String(value))}${delta?`<span class="d${bad?" bad":""}">${esc(delta)}</span>`:""}</span></div>`;
    const beforeRows=[["a triage note lands after",secs(incToday)],["a signature batch takes",secs(logToday)],yu?["a Yusr answer takes",secs(yuToday)]:null,["incidents annotated per hour",n(todayPerH)],["the signature backlog clears in",todayH>48?Math.round(todayH/24)+" days":secs(todayH*3600)],["model",esc((md.models&&md.models[0]&&md.models[0].params)||"8B")+" on CPU · one call at a time"]].filter(Boolean);
    const afterRows=[["a triage note lands after",secs(incNew),"−"+pct(incToday,incNew)+" %"],["a signature batch takes",secs(logNew),"×"+times(logToday,logNew)+" faster"],yu?["a Yusr answer takes",secs(yuNew),"×"+times(yuToday,yuNew)+" faster"]:null,["incidents annotated per hour",n(capNew),"×"+times(capNew,Math.max(1,todayPerH))],["the signature backlog clears in",drainNew>48?Math.round(drainNew/24)+" days":secs(drainNew*3600),"−"+pct(todayH,drainNew)+" %"],["model",(model==="allam"?"ALLaM 7B":model==="8b"?"8B":model==="14b"?"14B":"32B")+" on GPU · "+conc+" streams at once",model==="8b"?"same quality, GPU speed":"bigger model"]].filter(Boolean);
    /* what we win in each scenario — the same yardsticks for A, B and C */
    const winCard=o=>{ const pI=projected(inc,model,o.k), pL=projected(logU,model,o.k), pY=yu?projected(yu,model,o.k):null; const capO=capRows.find(r=>r.label.startsWith(o.name.slice(0,1)+" ·")); const dr=drain.find(z=>z.k===o.k)||{h:0};
      const saved=[["salam-agent-incident",incToday-pI],["salam-agent-log",logToday-pL],["console",yu?yuToday-pY:0]].reduce((a,[k,dt])=>a+((bc[k]||{}).calls||0)/7*Math.max(0,dt),0)/3600;
      const cost=o.k==="onprem"?`≈ ${n(Math.round(capex/24))} SAR/month over 24 mo (one-off ${n(capex)})`:o.k==="cloudvm"?`≈ ${n(cloudM)} SAR/month`:`≈ ${n(apiM0)} SAR/month today, grows with use`;
      const policy=o.k==="onprem"?["✓","data never leaves our network",false]:o.k==="cloudvm"?["◐","stays in the Kingdom · leaves our network (DPA + link)",false]:["✗","leaves our network to a third party · policy exception",true];
      const score=o.k==="onprem"?92:o.k==="cloudvm"?74:38;
      return `<div class="am-win${where===o.k?" on":""}" data-win="${o.k}" style="--oc:${o.c}"><h3>${esc(o.name)}</h3>
        <div class="row"><span class="ic">⏱</span><span>triage note ${secs(incToday)} → </span><b>${secs(pI)}</b></div>
        <div class="row"><span class="ic">🧠</span><span>annotations per hour</span><b>${n(capO?capO.v:0)} / h</b></div>
        <div class="row"><span class="ic">📚</span><span>backlog of ${n(backlog)} clears in</span><b>${dr.h>48?Math.round(dr.h/24)+" d":secs(dr.h*3600)}</b></div>
        <div class="row"><span class="ic">🕒</span><span>waiting removed, per day</span><b>${saved>=1?saved.toFixed(1)+" h":Math.round(saved*60)+" min"}</b></div>
        <div class="row"><span class="ic">💰</span><span>run cost</span><b style="font-size:12px">${esc(cost)}</b></div>
        <div class="row${policy[2]?" neg":""}"><span class="ic">${policy[0]}</span><span>${esc(policy[1])}</span><b></b></div>
        <div class="row"><span class="ic">📅</span><span>first production answer</span><b style="font-size:12px">${o.k==="onprem"?"1–2 wk after hardware":o.k==="cloudvm"?"1–2 weeks":"days + approvals"}</b></div>
        <div class="am-score"><i style="width:${score}%"></i></div><div class="sub" style="font-size:11px;margin-top:4px">overall fit for Salam · ${score} / 100</div></div>`; };
    return `<div class="am-sec"><h2>What we really gain — today measured, tomorrow projected on ${esc(optName)}</h2><div class="sub">The left side is what our agents live with today (real 7-day averages from <code>llm_calls</code>); the right side is the same prompts and answers on the GPU class of the scenario we picked above (prompt ${n(PREFILL)} tok/s · answer ${GPU_TPS[model]} tok/s per stream${where==="cloudapi"?" · API ≈ 60 tok/s + 0.4 s network":where==="cloudvm"?" · + 0.15 s private link":""}).</div>
      <div class="am-ba">
        <div class="side before"><h4>Today <span>· CPU on 152 · ${esc((md.models&&md.models[0]&&md.models[0].name)||"llama3.1")}</span></h4>${beforeRows.map(r=>baRow(r[0],r[1])).join("")}</div>
        <div class="arrow">➜</div>
        <div class="side after"><h4>With ${esc(optName.replace(/^[ABC] · /,""))} <span>· ${esc(MODELS[model].name)}</span></h4>${afterRows.map(r=>baRow(r[0],r[1],r[2])).join("")}</div>
      </div>
      <div class="am-race"><h3>See it — one triage note, side by side <button type="button" class="am-btn p" id="amRaceBtn" style="margin-left:10px">▶ Race it</button></h3><div class="sub">real time, scaled so that today's ${secs(incToday)} takes 5 seconds on screen · the on-call's P1 acknowledgement clock is 5 minutes — the note must be there before it</div>
        <div class="am-lane"><span class="nm">Today · CPU<small>${esc((md.models&&md.models[0]&&md.models[0].params)||"8B")} · Ollama on 152</small></span><div class="am-track2" data-lane="today" style="--lc:#64748b"><i></i><span class="fl">🏁</span></div><span class="clk" data-clk="today">0.0 s</span></div>
        <div class="am-lane"><span class="nm" style="color:var(--green,#0e9f5a)">After · ${esc(optName.slice(0,1))}<small>${esc(MODELS[model].name)} · vLLM</small></span><div class="am-track2" data-lane="after" style="--lc:var(--green,#0e9f5a)"><i></i><span class="fl">🏁</span></div><span class="clk" data-clk="after">0.0 s</span></div>
        <div class="sub" id="amRaceMsg" style="margin-top:8px;font-size:12px"></div></div>
      <div class="am-val" style="margin-top:14px"><div class="v"><b>${savedH>=1?savedH.toFixed(1)+" h":Math.round(savedH*60)+" min"}</b><small>of waiting removed <strong>every day</strong> for our agents and the people asking Yusr (${n(Math.round(u.calls/7))} calls/day × the seconds saved on each)</small></div><div class="v"><b>${n(capNew)} / h</b><small>incidents we can annotate per hour instead of ${n(todayPerH)} — an incident storm no longer queues behind one CPU</small></div><div class="v"><b>${drainNew>48?Math.round(drainNew/24)+" days":secs(drainNew*3600)}</b><small>to explain the ${n(backlog)} signatures waiting today (instead of ${todayH>48?Math.round(todayH/24)+" days":secs(todayH*3600)}) — the log agent finally catches up</small></div></div>
      <h3 style="margin:18px 0 0;font-size:14px;font-weight:800">What we win in each scenario <span class="sub" style="font-weight:500">— same yardsticks, click a card to make it our pick</span></h3>
      <div class="am-wins">${OPTS.map(winCard).join("")}</div>
      <div class="am-charts" style="margin-top:14px">
        <div class="am-ch2"><h3>Latency per answer</h3><div class="sub">average seconds per call · today measured, targets projected · the bold bar is the chosen scenario</div>${hbars(latRows,maxL)}</div>
        <div class="am-ch2"><h3>Capacity — answers per hour</h3><div class="sub">the CPU answers one call at a time; vLLM batches ${conc} streams on one GPU (planned concurrency above)</div>${hbars(capRows,maxC)}</div>
        <div class="am-ch2"><h3>Backlog drain — ${n(backlog)} signatures</h3><div class="sub">grey = today at ${secs((logU.avg_ms||0)/1000)} per batch · colours = the three targets; x axis = time from now</div>${drainSvg}</div>
        <div class="am-ch2"><h3>Effort vs value</h3><div class="sub">x = weeks to the first production answer · y = value (speed × capacity × policy fit) · bubble = monthly run cost</div>${effSvg}</div>
        <div class="am-ch2" style="grid-column:1/-1"><h3>Cumulative cost over 24 months — SAR, indicative (KSA market, September 2026)</h3><div class="sub">A = one-off server <input id="amCapex" type="number" value="${capex}" class="am-in"> SAR (+ 1 %/month power &amp; upkeep) · B = in-Kingdom GPU rental always-on <input id="amCloudM" type="number" value="${cloudM}" class="am-in"> SAR/month (DCP L40S 5.2 SAR/h ≈ 3 800; Google Dammam L4 ≈ 2 000; A100 ≈ 5 300) · C = managed API at <input id="amApi" type="number" step="0.05" value="${apiPer1M}" class="am-in" style="width:60px"> SAR per 1M tokens on today's ${n((u.perDay||{}).tokens)} tokens/day (≈ ${n(apiM0)} SAR/month) growing 15 % a quarter</div>${costSvg}
          <div class="am-delta"><div>break-even A vs B<b>${cloudM?Math.ceil(capex/cloudM)+" months":"—"}</b></div><div>24-month total A<b>${n(Math.round(series.onprem[24]))} SAR</b></div><div>24-month total B<b>${n(Math.round(series.cloudvm[24]))} SAR</b></div><div>24-month total C<b>${n(Math.round(series.cloudapi[24]))} SAR <span style="font-size:11px;color:#dc2626;font-weight:600">+ policy exception</span></b></div><div>rate used<b>1 USD = 3.75 SAR</b></div></div></div>
      </div></div>`;
  }
  function recoSection(){
    return `<div class="am-reco"><h2>Our best approach — the sequence for Salam</h2><div class="sub" style="margin-bottom:4px">Given our on-prem-only decision, the PDPL scope of our prompts (masked incident context, dealer names, customer counts), the CPU backlog we measured above and what the KSA market offers us today.</div>
      <ol>
        <li><b>Week 1–2 · rent in the Kingdom, benchmark.</b> One L40S at DCP (≈ 3 800 SAR/month, per-second billing, in-Kingdom, PDPL) or a G2/L4 on Google Cloud Dammam via CNTXT, wired as <code>LLM_FALLBACK_*</code>. Run the Self-test and a replay of last week's triage prompts; the HUD gives tok/s, p95 and fail % on Qwen2.5-14B, Llama 3.1-8B and ALLaM-7B side by side.</li>
        <li><b>Week 2 · flip the order</b> in Settings › Agents (fallback first). Agent 1 drains the ${"signature"} backlog in hours, triage notes land in seconds, Yusr becomes conversational. Ollama on 152 stays the safety net.</li>
        <li><b>Week 2–8 · buy the on-prem server with real numbers.</b> One L40S server (≈ 45–70 k SAR) pays back a 3 800 SAR/month rental in 12–18 months and removes the private link and the DPA. Same vLLM image, same .env lines pointed at the new host.</li>
        <li><b>Arabic.</b> Serve ALLaM-7B-Instruct (SDAIA, Apache-2.0) next to Qwen on the same GPU for Yusr's Arabic answers and Arabic incident text; keep Qwen/Llama for JSON-strict triage until ALLaM passes the JSON self-test.</li>
        <li><b>Keep managed APIs out of incident data.</b> DCP's OpenAI-compatible API (from 0.05 SAR per 1M tokens), stc's sovereign LLM platform or ALLaM on Azure AI Foundry are fine for synthetic / non-sensitive experiments only, after a DPA.</li>
      </ol></div>`;
  }
  function refsSection(){
    const R=[
      ["vLLM — OpenAI-compatible server","https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html","the server llm.js will talk to (kind=openai); docker image vllm/vllm-openai"],
      ["vLLM — quantisation (AWQ / GPTQ / FP8)","https://docs.vllm.ai/en/latest/features/quantization/","fit 14B on a 24 GB L4 or 32B on a 48 GB L40S"],
      ["Qwen2.5-14B-Instruct (Hugging Face)","https://huggingface.co/Qwen/Qwen2.5-14B-Instruct","the model the GPU VM request names — strong JSON and Arabic"],
      ["Llama 3.1 8B Instruct (Hugging Face)","https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct","what Ollama runs today — same model, GPU speed"],
      ["ALLaM-7B-Instruct-preview (SDAIA / HUMAIN)","https://huggingface.co/humain-ai/ALLaM-7B-Instruct-preview","the Saudi bilingual model, Apache-2.0, vLLM-ready"],
      ["DCP — GPUs on demand in Saudi Arabia","https://dcp.sa/","in-Kingdom L40S from 5.2 SAR/h, H100 from 17.27 SAR/h, per-second billing, PDPL; OpenAI-compatible API at api.dcp.sa/v1"],
      ["Saudi cloud regions — who is really live in KSA","https://vision2030.ai/sectors/technology/saudi-arabia-cloud-regions/","Google Dammam (G2/L4 via CNTXT), Oracle Riyadh & Jeddah, Alibaba Riyadh (SCCC), Huawei, Tencent; AWS and Azure KSA not yet launched"],
      ["Google Cloud Dammam (me-central2) via CNTXT","https://cntxt.com/","the hyperscaler route in the Kingdom — G2 (L4) machine types"],
      ["stc Group sovereign LLM platform","https://developingtelecoms.com/telecom-technology/telecom-cloud-virtualization/18013-saudi-llm-sovereign-cloud-platform-launched-by-stc-group.html","inferencing-as-a-service in KSA (Llama 405B, SambaNova) — an operator-grade option to ask for a quote"],
      ["HUMAIN / ALLaM for enterprises","https://www.humain.ai/","HUMAIN ONE, ALLaM 34B, ALLaM on Azure AI Foundry and IBM watsonx"],
      ["NVIDIA L40S — buy vs rent","https://gpucost.org/gpu/l40s","≈ 9 k USD (≈ 34 k SAR) card; buying pays off after ~11 months of 24/7 rental"],
      ["NVIDIA L4 — price guide","https://jarvislabs.ai/blog/l4-gpu-price","2–3 k USD card (≈ 8–11 k SAR); Google g2-standard-4 ≈ 0.71 USD/h US list"],
      ["Saudi PDPL — SDAIA","https://sdaia.gov.sa/en/SDAIA/about/Pages/RegulationsAndPolicies.aspx","the residency and DPA test every non-on-prem option must pass"],
    ];
    return `<div class="am-sec"><h2>References &amp; solutions</h2><div class="sub">Public sources behind the figures above (opened at the time of writing, September 2026) — verify prices before a purchase order.</div>
      <div class="am-refs">${R.map(r=>`<div class="am-ref"><a href="${r[1]}" target="_blank" rel="noopener">${esc(r[0])} ↗</a><span class="w">${esc(r[2])}</span></div>`).join("")}</div></div>`;
  }
  function steps(t){
    const common=[["Benchmark on the real box","one hour of the Self-test + a replay of yesterday's triage prompts: tok/s, p95, JSON validity","Infra + console · ½ day"],["Wire as FALLBACK","LLM_FALLBACK_* on /apps/unified/.env, restart the three PM2 apps, Probe green","console · 1 h"],["Shadow for a day","order primary-first: Ollama answers, vLLM takes over only on timeout — Mission control shows both","console · 1 day wait"],["Flip the order","Settings › Agents › Configure → order \"fallback first\" · Ollama on 152 stays the safety net · raise AGENT_INCIDENT_MAX_PER_TICK and let Agent 1 drain the backlog","console · 1 h"],["Retune budgets","per-agent ceilings up (600k → 2M tokens/day), Yusr numCtx 8192, longer evidence packs in the prompts","console · ½ day"]];
    if(t==="onprem") return [["Order / allocate the GPU server","L40S 48 GB (or L4 24 GB minimum), 128 GB RAM, NVMe, same VLAN as 152 and 121","Infra · procurement 1–6 weeks"],["OS + driver + Docker","Ubuntu 22.04, NVIDIA driver 550+, CUDA 12, nvidia-container-toolkit","Infra · ½ day"],["vLLM service","docker run vllm/vllm-openai --model <model> --max-model-len 8192 --api-key <key> --gpu-memory-utilization 0.9 · weights pulled through the proxy once","Infra · ½ day"],["Firewall + allowlist","152 → gpu:8000 only · monitoring probe · nvidia-smi exporter to the console (the brain HUD shows GPU % when nvidia-smi is on 152; add the exporter for a remote box)","Infra + Sec · ½ day"],...common];
    if(t==="cloudvm") return [["Pick the in-Kingdom provider","DCP (per-second L40S, PDPL) for a fast bridge; Google Cloud Dammam (via CNTXT) / Alibaba Riyadh / Oracle Riyadh if Salam already holds a contract · DPA + PDPL note on what the prompts contain (masked incident context)","Sec + Procurement · 3–10 days"],["Private connectivity","VPN or private link from Salam DC to the provider · IP allowlist both ways (152 → gpu:8000 only)","Network · 1–3 days"],["GPU + vLLM","docker vllm/vllm-openai on the rented L40S · weights on the VM disk · auto-restart · stop the VM when the benchmark is done","Infra · ½ day"],["Benchmark month","run the agents on it for 2–4 weeks; the Mission control HUD records tok/s, p95, fail % — that is the sizing for the on-prem purchase","console · 1 month wait"],...common];
    return [["Policy exception","a written exception to the on-prem-only decision, scoped to non-sensitive purposes","Management + Sec · weeks"],["Prompt scrubbing","strip dealer names, MSISDN tails, customer ids before the call — new code in llm.js","console · 2 days"],["Key + kind=openai","LLM_FALLBACK_KIND=openai, URL of the provider, key in .env","console · 1 h"],...common.slice(0,3)];
  }
  function bindPlan(){ const h=host(); const rr=()=>render();
    const t=h.querySelector("#amTarget"); if(t) t.onchange=e=>{ S.plan.target=e.target.value; rr(); };
    const m=h.querySelector("#amModel"); if(m) m.onchange=e=>{ S.plan.model=e.target.value; rr(); };
    const c=h.querySelector("#amConc"); if(c) c.onchange=e=>{ S.plan.conc=Math.max(1,Math.min(64,Number(e.target.value)||1)); rr(); };
    h.querySelectorAll(".am-opt").forEach(el=>el.onclick=()=>{ S.plan.target=el.dataset.opt; rr(); });
    const cx=h.querySelector("#amCapex"); if(cx) cx.onchange=e=>{ S.plan.capex=Math.max(0,Number(e.target.value)||0); rr(); };
    const cm=h.querySelector("#amCloudM"); if(cm) cm.onchange=e=>{ S.plan.cloudM=Math.max(0,Number(e.target.value)||0); rr(); };
    const ca=h.querySelector("#amApi"); if(ca) ca.onchange=e=>{ S.plan.apiPer1M=Math.max(0,Number(e.target.value)||0); rr(); };
    h.querySelectorAll(".am-win").forEach(el=>el.onclick=()=>{ S.plan.target=el.dataset.win; rr(); });
    /* count-up on the AFTER side */
    h.querySelectorAll(".after .am-bar2 .v").forEach(el=>{ const txt=el.firstChild; if(!txt||txt.nodeType!==3) return; const m=/^([\d.,]+)(.*)$/.exec(txt.nodeValue||""); if(!m) return; const target=Number(m[1].replace(/,/g,"")); if(!isFinite(target)) return; const dec=(m[1].split(".")[1]||"").length; const t0=performance.now(); const step=t=>{ const k=Math.min(1,(t-t0)/900); const v=target*(1-Math.pow(1-k,3)); txt.nodeValue=(dec?v.toFixed(dec):Math.round(v).toLocaleString("en-US"))+m[2]; if(k<1) requestAnimationFrame(step); }; requestAnimationFrame(step); });
    const rb=h.querySelector("#amRaceBtn"); if(rb) rb.onclick=()=>race(h); }
  function race(h){
    const d=S.data; const bc=(d.usage&&d.usage.byCaller)||{}; const inc=bc["salam-agent-incident"]||{avg_ms:18000,prompt_tokens:0,answer_tokens:0,calls:1};
    const today=(inc.avg_ms||0)/1000, after=projected(inc,S.plan.model,S.plan.target); const scale=5000/Math.max(today,0.1);   // today = 5 s on screen
    const lanes={today:{el:h.querySelector('[data-lane="today"]'),clk:h.querySelector('[data-clk="today"]'),dur:today},after:{el:h.querySelector('[data-lane="after"]'),clk:h.querySelector('[data-clk="after"]'),dur:after}};
    const msg=h.querySelector("#amRaceMsg"); const btn=h.querySelector("#amRaceBtn"); if(!lanes.today.el||!lanes.after.el) return; btn.disabled=true; msg.textContent="";
    for(const l of Object.values(lanes)){ l.el.classList.remove("done"); l.el.querySelector("i").style.width="0"; l.clk.classList.remove("win"); l.clk.textContent="0.0 s"; }
    const t0=performance.now(); let announced=false;
    const tick=t=>{ const el=(t-t0)/scale; let all=true;
      for(const [k,l] of Object.entries(lanes)){ const v=Math.min(el,l.dur); l.clk.textContent=v.toFixed(1)+" s"; l.el.querySelector("i").style.width=(v/l.dur*100).toFixed(1)+"%"; if(v>=l.dur){ l.el.classList.add("done"); if(k==="after"){ l.clk.classList.add("win"); if(!announced){ announced=true; msg.innerHTML=`<b style="color:var(--green,#0e9f5a)">The note is on the incident after ${after.toFixed(1)} s</b> — the CPU is still at ${Math.round(after/today*100)} % of its answer; it finishes ${Math.round(today-after)} s later. Over a day that is ${Math.round((today-after)*((inc.calls||0)/7))} s of waiting removed on triage alone.`; } } } else all=false; }
      if(!all) requestAnimationFrame(tick); else btn.disabled=false; };
    requestAnimationFrame(tick);
  }

  /* the pulse: every 4 s, what the model is answering right now → robots switch to "working" instantly, bubbles narrate */
  async function pulseTick(){
    const v=document.getElementById("view-agentsmission"); if(!v||!v.classList.contains("active")){ clearInterval(S.pulseTimer); S.pulseTimer=null; return; }
    if(document.visibilityState!=="visible"||S.tab!=="live"||S.play.i>=0||!S.data) return;
    let p; try{ p=await api("/api/agents/pulse"); }catch(e){ return; }
    const before=JSON.stringify(S.pulse&&{i:S.pulse.inflight,r:S.pulse.runs}); S.pulse=p;
    if(before===JSON.stringify({i:p.inflight,r:p.runs})) return;           // nothing changed — no DOM work
    const h=host(); if(!h) return;
    for(const a of S.data.agents){ a.inflight=p.inflight.filter(x=>x.agent===a.key); const el=h.querySelector(`.am-rb[data-k="${a.key}"]`); if(!el) continue;
      const st=stateOf(a); el.className="am-rb st-"+st+(S.sel===a.key?" sel":"")+(S.pin===a.key?" pin":"");
      const b=el.querySelector(".am-bub"); if(b) b.innerHTML=lastSentence(a);
      const sm=a.key==="yusr"&&st==="idle"?{label:"idle · waiting for a question",fg:"#2563eb"}:(STATE[st]||STATE.idle); const stEl=el.querySelector(".st"); if(stEl){ stEl.style.color=sm.fg; if(st==="idle"&&a.next&&a.next.tick){ stEl.dataset.next=a.next.tick; stEl.textContent="● idle · next "+until(a.next.tick); } else { delete stEl.dataset.next; stEl.textContent="● "+(a.inflight.length&&a.key==="yusr"?"thinking…":sm.label); } }
      const card=h.querySelector(`.am-card[data-k="${a.key}"] .stt`); if(card){ card.style.color=sm.fg; card.innerHTML=`<i></i>${esc(a.inflight.length&&a.key==="yusr"?"thinking…":sm.label)}`; } }
    /* wires: packets flow while a call is in flight */
    h.querySelectorAll(".am-wires path[id^=amW]").forEach((path,i)=>{ const a=S.data.agents[i]; if(!a) return; const hot=(a.inflight||[]).length>0||(a.calls||[]).length>0; path.setAttribute("opacity",hot?".9":".3"); const has=h.querySelector(`.am-wires .am-pkt[data-i="${i}"]`);
      if(hot&&!has){ const d=path.getAttribute("d"); path.insertAdjacentHTML("afterend",[1,2,3].map(k=>`<circle r="4" fill="${COLOR[a.key]}" class="am-pkt d${k}" data-i="${i}" style="offset-path:path('${d}')"/>`).join("")); }
      if(!hot&&has) h.querySelectorAll(`.am-wires .am-pkt[data-i="${i}"]`).forEach(x=>x.remove()); });
  }
  window.openAgentsMission=function(){
    ensureView();
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.add("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    document.getElementById("view-agentsmission").classList.add("active");
    load(true);
    if(S.timer) clearInterval(S.timer);
    S.timer=setInterval(()=>{ const v=document.getElementById("view-agentsmission"); if(!v||!v.classList.contains("active")){ clearInterval(S.timer); S.timer=null; return; } if(document.visibilityState==="visible"&&!S.play.auto) load(false); },30000);
    if(S.pulseTimer) clearInterval(S.pulseTimer);
    S.pulseTimer=setInterval(pulseTick,4000);
  };
})();
