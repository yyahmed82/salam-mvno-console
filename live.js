/* Live updates — keep every page fresh without a manual browser reload.
 * Subscribes to the server's SSE stream (pushed after each prod sync) and re-renders
 * the ACTIVE view in place via the `opsdatarefresh` event that each view module listens to.
 * Falls back to a slow polling timer if SSE can't connect. A header "Live" pill shows
 * connection status + last-update age, and toggles auto-refresh (persisted per browser). */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const API=(location.protocol==="file:")?"http://localhost:4600":"";
  const KEY="cons_live";
  let on = localStorage.getItem(KEY)!=="off";      // default ON
  let es=null, pollTimer=null, lastUpdate=0, connected=false, busy=false;

  const pill=$("#liveBtn");
  function fmtAgo(){
    if(!lastUpdate) return "live";
    const s=Math.round((Date.now()-lastUpdate)/1000);
    if(s<60) return "updated "+s+"s ago";
    const m=Math.round(s/60); return "updated "+m+"m ago";
  }
  function paint(){
    if(!pill) return;
    pill.classList.toggle("on", on);
    pill.classList.toggle("live-connected", on&&connected);
    const dot = !on ? "❙❙" : (connected?"●":"◌");
    pill.innerHTML=`<span class="live-dot">${dot}</span><span class="live-lbl">${on?fmtAgo():"paused"}</span>`;
    pill.title = !on ? "Auto-refresh paused. Click to resume."
      : (connected?"Live — pages update after each sync. Click to pause.":"Live (connecting…). Click to pause.");
  }
  setInterval(paint, 15000);   // keep the "updated Xs ago" label ticking

  // re-render whichever view is active, in place (debounced against bursts)
  function refreshActive(){
    if(!on || document.hidden || busy) return;
    busy=true;
    try{ document.dispatchEvent(new CustomEvent("opsdatarefresh")); }catch(e){}
    lastUpdate=Date.now(); paint();
    setTimeout(()=>{ busy=false; }, 1500);
  }

  function connect(){
    if(!on || es || typeof EventSource==="undefined"){ if(on&&typeof EventSource==="undefined") startPoll(); return; }
    try{
      es=new EventSource(API+"/api/stream");
      es.addEventListener("hello",()=>{ connected=true; paint(); });
      es.addEventListener("refreshed",()=>{ connected=true; refreshActive(); });
      es.addEventListener("ping",()=>{ connected=true; });
      es.onerror=()=>{ connected=false; paint(); };   // EventSource auto-reconnects on its own
    }catch(e){ startPoll(); }
  }
  function disconnect(){ if(es){ try{es.close();}catch(_){}} es=null; connected=false; }
  // slow fallback poll — only fires when SSE isn't delivering
  function startPoll(){ if(pollTimer) return; pollTimer=setInterval(()=>{ if(on && !connected) refreshActive(); }, 90000); }

  function setOn(v){
    on=v; localStorage.setItem(KEY, on?"on":"off");
    if(on){ connect(); startPoll(); refreshActive(); } else { disconnect(); }
    paint();
  }
  if(pill) pill.addEventListener("click", ()=>setOn(!on));

  // pull once when the tab returns to the foreground (and re-open SSE if it dropped)
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && on){ if(!connected){ disconnect(); connect(); } refreshActive(); } });

  document.addEventListener("consoleReady", ()=>{ paint(); if(on){ connect(); startPoll(); } });
  paint();
})();
