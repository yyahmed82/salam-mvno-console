/* Yusr (يُسر) — floating AI assistant widget (bottom-right, every page).

 * "Yusr" = ease: the fast track for L1 / call-center to any answer in the console.
 * Backend: POST /api/assist/chat (local Ollama; degrades to rule-based answers).
 * Auth headers are injected globally by ops.js's fetch wrapper.
 * Deep-link actions navigate the SPA (e.g. #sub360?key=05…, #alerts).
 * Exposes window.openYusr(prefill, {send}) — used by the "Ask Yusr" hint chips.
 */
const AB=(window.API_BASE!==undefined)?window.API_BASE:window.CONSOLE_BASE;

(function(){
  "use strict";

  /* ---------- styles ---------- */
  const css = `
  #assistFab{position:fixed;right:22px;bottom:22px;z-index:1250;width:56px;height:56px;border-radius:50%;
    background:var(--green);color:#fff;border:none;cursor:pointer;box-shadow:0 6px 24px rgba(14,159,90,.45);
    display:flex;align-items:center;justify-content:center;font-size:24px;transition:transform .15s}
  #assistFab:hover{transform:scale(1.07)}
  #assistPanel{position:fixed;right:22px;bottom:90px;z-index:1251;width:380px;max-width:calc(100vw - 40px);
    height:540px;max-height:calc(100vh - 130px);background:var(--card);border:1px solid var(--line);
    border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}
  #assistPanel.open{display:flex}
  .as-head{background:var(--green);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px}
  .as-head .mark{width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;flex:0 0 36px}
  .as-head .t{font-weight:800;font-size:15px}
  .as-head .t .ar{font-weight:700;opacity:.9;margin-inline-start:4px;font-family:'Noto Kufi Arabic','Geeza Pro',Tahoma,sans-serif}
  .as-head .s{font-size:11px;opacity:.85;display:flex;align-items:center;gap:5px}
  .as-head .s .dot{width:7px;height:7px;border-radius:50%;background:#7CFC9A;display:inline-block}
  .as-head .x{margin-inline-start:auto;background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}
  .as-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--bg)}
  .as-msg{max-width:86%;padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
  .as-msg.user{align-self:flex-end;background:var(--green-bg);border:1px solid var(--green);border-radius:12px 12px 3px 12px}
  .as-msg.bot{align-self:flex-start;background:var(--card);border:1px solid var(--line);border-radius:12px 12px 12px 3px}
  .as-msg.bot .who{color:var(--green-dark);font-weight:800;font-size:11.5px;margin-bottom:3px}
  .as-msg.bot .deg{color:var(--muted);font-size:10.5px;margin-top:5px;font-style:italic}
  .as-src{font-size:10.5px;color:var(--muted);margin-top:5px}
  .as-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
  .as-acts a{font-size:11.5px;font-weight:700;color:var(--green-dark);border:1px solid var(--green);
    border-radius:8px;padding:4px 9px;text-decoration:none;background:var(--green-bg)}
  .as-sugs{display:flex;gap:6px;flex-wrap:wrap;padding:0 14px 8px;background:var(--bg)}
  .as-sugs button{font-size:11px;border:1px solid var(--line);background:var(--card);color:var(--ink-soft);
    border-radius:999px;padding:5px 10px;cursor:pointer}
  .as-sugs button:hover{border-color:var(--green);color:var(--green-dark)}
  .as-foot{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line);background:var(--card)}
  .as-foot input{flex:1;border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:13px;
    background:var(--card2);color:var(--ink);outline:none}
  .as-foot input:focus{border-color:var(--green)}
  .as-foot button{width:40px;height:38px;border:none;border-radius:10px;background:var(--green);color:#fff;
    font-size:16px;cursor:pointer}
  .as-foot button:disabled{opacity:.5;cursor:default}
  .as-typing{align-self:flex-start;color:var(--muted);font-size:12px;padding:4px 8px}
  .as-typing i{animation:asBlink 1.2s infinite;font-style:normal}
  .as-typing i:nth-child(2){animation-delay:.2s}.as-typing i:nth-child(3){animation-delay:.4s}
  @keyframes asBlink{0%,80%,100%{opacity:.25}40%{opacity:1}}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------- DOM ---------- */
  // Yusr mark: the Arabic ي letterform + an AI sparkle, white on Salam green
  const YUSR_MARK = `<svg viewBox="0 0 48 48" width="32" height="32" aria-hidden="true">
      <text x="21" y="32" text-anchor="middle" font-size="28" font-weight="800" fill="#fff"
        font-family="'Noto Kufi Arabic','Geeza Pro',Tahoma,sans-serif">ي</text>
      <path d="M36 7l1.7 3.6L41.3 12.3l-3.6 1.7L36 17.6l-1.7-3.6-3.6-1.7 3.6-1.6z" fill="#fff" opacity=".95"/>
    </svg>`;
  const fab = document.createElement('button');
  fab.id = 'assistFab'; fab.title = 'Yusr — يُسر · ask me anything'; fab.innerHTML = YUSR_MARK;
  const panel = document.createElement('div');
  panel.id = 'assistPanel';
  panel.innerHTML = `
    <div class="as-head">
      <div class="mark">${YUSR_MARK}</div>
      <div>
        <div class="t">Yusr <span class="ar">يُسر</span></div>
        <div class="s"><span class="dot"></span><span id="asStatus">Checking…</span></div>
      </div>
      <button class="x" id="asClose" title="Close">×</button>
    </div>
    <div class="as-body" id="asBody"></div>
    <div class="as-sugs" id="asSugs"></div>
    <div class="as-foot">
      <input id="asInput" type="text" placeholder="${(()=>{const b=((window.opsSession&&window.opsSession())||{}).me?.business; return b==="fixed"?"Ask me anything… (FTTH account, order, ODB, incident, how-to)":b==="mobile"?"Ask me anything… (MSISDN, National ID, payment, incident, how-to)":"Ask me anything… (MSISDN, FTTH account, incident, how-to)";})()}" autocomplete="off"/>
      <button id="asSend" title="Send">➤</button>
    </div>`;
  document.body.appendChild(fab); document.body.appendChild(panel);

  const body = panel.querySelector('#asBody');
  const sugsEl = panel.querySelector('#asSugs');
  const input = panel.querySelector('#asInput');
  const send = panel.querySelector('#asSend');

  const history = [];   // {role, content} — last few turns sent for context
  let busy = false;

  function esc(s){ const d=document.createElement('div'); d.textContent=String(s==null?'':s); return d.innerHTML; }
  // markdown-lite: **bold**, `code`
  function md(s){ return esc(s).replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>'); }

  function addUser(text){
    const el=document.createElement('div'); el.className='as-msg user'; el.textContent=text;
    body.appendChild(el); body.scrollTop=body.scrollHeight;
  }
  function addBot(r, askedQ){
    const el=document.createElement('div'); el.className='as-msg bot';
    let html = `<div class="who">Yusr · يُسر</div><div>${md(r.reply||'')}</div>`;
    if (r.sources && r.sources.length){
      const s=r.sources.map(x=> x.type==='runbook' ? (x.doc+' › '+x.section) : x.type).slice(0,3).join(' · ');
      html += `<div class="as-src">Sources: ${esc(s)}</div>`;
    }
    if (r.actions && r.actions.length){
      html += `<div class="as-acts">` + r.actions.map(a=>`<a href="${esc(a.href)}">${esc(a.label)}</a>`).join('') + `</div>`;
    }
    if (r.degraded) html += `<div class="deg">⚠ Answer built from data only — ${esc(r.llmHint || r.llmError || 'the language model is unreachable')}.</div>`;
    // feedback: 👍 also saves the (PII-scrubbed) Q→A pair into Yusr's case memory server-side
    if (r.intent && askedQ) html += `<div class="as-fb" style="margin-top:6px;display:flex;gap:6px;align-items:center">
      <button data-fb="1" title="Helpful — Yusr will remember this solution" style="border:1px solid var(--line);background:none;border-radius:7px;padding:2px 8px;cursor:pointer;font-size:13px">👍</button>
      <button data-fb="0" title="Not helpful" style="border:1px solid var(--line);background:none;border-radius:7px;padding:2px 8px;cursor:pointer;font-size:13px">👎</button></div>`;
    el.innerHTML = html;
    body.appendChild(el); body.scrollTop=body.scrollHeight;
    // clicking a deep link should also close the panel so the agent sees the page
    el.querySelectorAll('.as-acts a').forEach(a=>a.addEventListener('click', ()=>toggle(false)));
    const fb=el.querySelector('.as-fb');
    if(fb) fb.querySelectorAll('button').forEach(b=>b.addEventListener('click', async ()=>{
      const helpful=b.dataset.fb==='1';
      fb.innerHTML=`<span style="font-size:11px;color:var(--muted)">Sending…</span>`;
      try{
        const resp=await fetch(AB+'/api/assist/feedback',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({helpful,intent:r.intent,degraded:!!r.degraded,question:askedQ,reply:r.reply||''})});
        const j=await resp.json().catch(()=>({}));
        fb.innerHTML=`<span style="font-size:11px;color:var(--muted)">${helpful?(j.learned?'Thanks — saved to Yusr’s case memory ✓':'Thanks ✓'):'Thanks — noted ✓'}</span>`;
      }catch(_){ fb.innerHTML=`<span style="font-size:11px;color:var(--muted)">Could not send feedback</span>`; }
    }));
  }
  function setSugs(list){
    sugsEl.innerHTML='';
    (list||[]).forEach(s=>{
      const b=document.createElement('button'); b.textContent=s;
      // chips ending in "…" are templates (e.g. "Check subscriber 05…") — prefill for the agent to
      // complete instead of sending an incomplete question that would just get refused
      const tpl=/…\s*$|\.\.\.\s*$/.test(s);
      b.addEventListener('click', ()=>{ if(tpl){ input.value=s.replace(/…\s*$|\.\.\.\s*$/,' '); input.focus(); } else { input.value=s; ask(); } });
      sugsEl.appendChild(b);
    });
  }
  function typing(on){
    let t=body.querySelector('.as-typing');
    if(on){ if(!t){ t=document.createElement('div'); t.className='as-typing'; t.innerHTML='Yusr is thinking <i>●</i><i>●</i><i>●</i>'; body.appendChild(t);} body.scrollTop=body.scrollHeight; }
    else if(t) t.remove();
  }

  async function ask(){
    const q=(input.value||'').trim();
    if(!q||busy) return;
    input.value=''; addUser(q); setSugs([]);
    history.push({role:'user',content:q});
    busy=true; send.disabled=true; typing(true);
    try{
      const r=await fetch(AB+'/api/assist/chat',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message:q,history:history.slice(0,-1).slice(-6)})});
      // Parse defensively: a gateway timeout (nginx 502/504 while the LLM is thinking) returns an
      // HTML error page — r.json() on it threw "Unexpected token '<'". Read text, try JSON, and
      // give an honest, actionable message instead of a parser error.
      const raw=await r.text(); let j=null; try{ j=JSON.parse(raw); }catch(_){}
      typing(false);
      if(!j){
        const gw = r.status===502||r.status===504||/<html/i.test(raw);
        addBot({reply: gw
          ? '⚠ The gateway timed out while I was composing the answer (HTTP '+r.status+'). The model may be loading — ask again in a moment; a repeat of the same question is usually fast.'
          : '⚠ Unexpected non-JSON response from the console (HTTP '+r.status+'). If this repeats, check the server logs.'});
      }
      else if(!r.ok){ addBot({reply:'⚠ '+(j.error||('HTTP '+r.status))}); }
      else{
        addBot(j,q); setSugs(j.suggestions); history.push({role:'assistant',content:j.reply||''});
        // honest status: reflect whether the LLM actually answered (was hardcoded "Online" before,
        // even when every reply came from the degraded rule-based fallback)
        const stEl=panel.querySelector('#asStatus');
        if(stEl) stEl.textContent = j.degraded ? 'Data-only mode · LLM offline' : 'Online · troubleshoot faster';
      }
    }catch(e){ typing(false); addBot({reply:'⚠ Could not reach the console API: '+e.message}); }
    finally{ busy=false; send.disabled=false; input.focus(); }
  }

  function greet(){
    if(body.childElementCount) return;
    addBot({reply:"أهلاً! I'm **Yusr (يُسر)** — your fast track to any answer in the console, Mobile and Fixed.\nI can:\n• Look up a customer — paste an MSISDN (05xxxxxxxx), a National ID, an **FTTH account**, a BSS order number or a customer code\n• Tell you what is going on in Fixed — \"fixed issues today\", \"top FTTH errors this week\"\n• Search a **log reference ID** (the code in the customer's error dialog) live on the DMS nodes\n• Tell you what incidents are open right now\n• Explain any integration, and search the runbooks / error codes for fixes"});
    // NOTE: no real MSISDN here — the subscriber chip only prefills (agent completes the number)
    setSugs(['Fixed issues today','What incidents are open?','Search a log reference','Check subscriber 05…']);
  }

  function toggle(open){
    const on = open!=null ? open : !panel.classList.contains('open');
    panel.classList.toggle('open', on);
    if(on){ greet(); probeStatus(); setTimeout(()=>input.focus(),50); }
  }
  // header status = the real state of the model host (was a hard-coded "Online" that contradicted
  // the "LLM offline" shown after the first answer). Cheap: /api/assist/status pings Ollama (5 s cap).
  let probed=0;
  function probeStatus(){
    if(Date.now()-probed<60000) return; probed=Date.now();
    const stEl=panel.querySelector('#asStatus'); if(!stEl) return;
    fetch(AB+'/api/assist/status').then(r=>r.json()).then(j=>{
      stEl.textContent = j && j.llm ? 'Online · troubleshoot faster' : 'Data-only mode · LLM offline';
      stEl.title = j && j.hint ? j.hint : '';
      const dot=panel.querySelector('.as-head .dot'); if(dot) dot.style.background = j && j.llm ? '' : '#f59e0b';
      /* YOUR OWN AI USAGE TODAY (11 Sep 2026) — shown once you are over the warning line, so nobody is surprised
       * by a refusal; below the line the header stays clean. Budgets live in Settings › Agents › AI usage. */
      fetch(AB+'/api/llm/usage/mine').then(r=>r.json()).then(b=>{
        if(!b || !b.enabled || !b.cap) return;
        const pct=Math.round((b.pct||0)*100); if(pct < Math.round((b.warnAt||0.8)*100)) return;
        const over=pct>=100;
        stEl.innerHTML=`${stEl.textContent} · <span style="color:${over?'#fca5a5':'#fbbf24'};font-weight:700">AI budget ${pct} %</span>`;
        stEl.title=`${(b.used||0).toLocaleString()} of ${(b.cap||0).toLocaleString()} tokens used today (resets 00:00 KSA)${over?(b.block?' — answers are rule-based until midnight':' — over budget, warning only'):''}`;
      }).catch(()=>{});
    }).catch(()=>{ stEl.textContent='Data-only mode · LLM offline'; });
  }
  // public entry — used by the "Ask Yusr" hint chips across the console
  window.openYusr=function(prefill, opts){
    toggle(true);
    if(prefill){ input.value=prefill; if(opts&&opts.send) ask(); else setTimeout(()=>{ input.focus(); input.setSelectionRange(input.value.length,input.value.length); },80); }
  };
  fab.addEventListener('click', ()=>toggle());
  panel.querySelector('#asClose').addEventListener('click', ()=>toggle(false));
  send.addEventListener('click', ask);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') ask(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') toggle(false); });

  /* "Ask Yusr" hint chips were removed by design (2026-08-10) — the floating bubble is the single
   * entry point. window.openYusr stays public so any future page can deep-link into the chat. */

  // hide the bubble entirely when Yusr is disabled in Settings (the one kill-switch, all pages)
  fetch(AB+'/api/assist/enabled').then(r=>r.json()).then(j=>{
    if(j && j.enabled===false){ fab.style.display='none'; panel.classList.remove('open'); }
  }).catch(()=>{});
})();
