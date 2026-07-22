/* Yusr (يُسر) — floating AI assistant widget (bottom-right, every page).
 * "Yusr" = ease: the fast track for L1 / call-center to any answer in the console.
 * Backend: POST /api/assist/chat (local Ollama; degrades to rule-based answers).
 * Auth headers are injected globally by ops.js's fetch wrapper.
 * Deep-link actions navigate the SPA (e.g. #sub360?key=05…, #alerts).
 * Exposes window.openYusr(prefill, {send}) — used by the "Ask Yusr" hint chips.
 */
(function(){
  "use strict";

  /* ---------- styles ---------- */
  const css = `
  #assistFab{position:fixed;right:22px;bottom:22px;z-index:400;width:56px;height:56px;border-radius:50%;
    background:var(--green);color:#fff;border:none;cursor:pointer;box-shadow:0 6px 24px rgba(14,159,90,.45);
    display:flex;align-items:center;justify-content:center;font-size:24px;transition:transform .15s}
  #assistFab:hover{transform:scale(1.07)}
  #assistPanel{position:fixed;right:22px;bottom:90px;z-index:401;width:380px;max-width:calc(100vw - 40px);
    height:540px;max-height:calc(100vh - 130px);background:var(--card);border:1px solid var(--line);
    border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}
  #assistPanel.open{display:flex}
  .as-head{background:var(--green);color:#fff;padding:12px 16px;display:flex;align-items:center;gap:10px}
  .as-head .mark{width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;flex:0 0 36px}
  .as-head .t{font-weight:800;font-size:15px}
  .as-head .t .ar{font-weight:700;opacity:.9;margin-inline-start:4px;font-family:'Noto Kufi Arabic','Geeza Pro',Tahoma,sans-serif}
  .yusr-hint b{color:var(--green-dark)}
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
        <div class="s"><span class="dot"></span><span id="asStatus">Online · troubleshoot faster</span></div>
      </div>
      <button class="x" id="asClose" title="Close">×</button>
    </div>
    <div class="as-body" id="asBody"></div>
    <div class="as-sugs" id="asSugs"></div>
    <div class="as-foot">
      <input id="asInput" type="text" placeholder="Ask me anything… (MSISDN, incident, how-to)" autocomplete="off"/>
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
  function addBot(r){
    const el=document.createElement('div'); el.className='as-msg bot';
    let html = `<div class="who">Yusr · يُسر</div><div>${md(r.reply||'')}</div>`;
    if (r.sources && r.sources.length){
      const s=r.sources.map(x=> x.type==='runbook' ? (x.doc+' › '+x.section) : x.type).slice(0,3).join(' · ');
      html += `<div class="as-src">Sources: ${esc(s)}</div>`;
    }
    if (r.actions && r.actions.length){
      html += `<div class="as-acts">` + r.actions.map(a=>`<a href="${esc(a.href)}">${esc(a.label)}</a>`).join('') + `</div>`;
    }
    if (r.degraded) html += `<div class="deg">⚠ LLM offline (${esc(r.llmError||'unreachable')}) — showing data-only answer.</div>`;
    el.innerHTML = html;
    body.appendChild(el); body.scrollTop=body.scrollHeight;
    // clicking a deep link should also close the panel so the agent sees the page
    el.querySelectorAll('.as-acts a').forEach(a=>a.addEventListener('click', ()=>toggle(false)));
  }
  function setSugs(list){
    sugsEl.innerHTML='';
    (list||[]).forEach(s=>{
      const b=document.createElement('button'); b.textContent=s;
      b.addEventListener('click', ()=>{ input.value=s; ask(); });
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
      const r=await fetch('/api/assist/chat',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({message:q,history:history.slice(0,-1).slice(-6)})});
      const j=await r.json();
      typing(false);
      if(!r.ok){ addBot({reply:'⚠ '+(j.error||('HTTP '+r.status))}); }
      else{ addBot(j); setSugs(j.suggestions); history.push({role:'assistant',content:j.reply||''}); }
    }catch(e){ typing(false); addBot({reply:'⚠ Could not reach the console API: '+e.message}); }
    finally{ busy=false; send.disabled=false; input.focus(); }
  }

  function greet(){
    if(body.childElementCount) return;
    addBot({reply:"أهلاً! I'm **Yusr (يُسر)** — your fast track to any answer in the console.\nI can:\n• Look up a subscriber — just paste an MSISDN (05xxxxxxxx) or National ID\n• Tell you what incidents are open right now\n• Search the ops runbooks and error codes for fixes"});
    setSugs(['What incidents are open?','How do I handle a stuck UPG payment?','Check subscriber 0581416290']);
  }

  function toggle(open){
    const on = open!=null ? open : !panel.classList.contains('open');
    panel.classList.toggle('open', on);
    if(on){ greet(); setTimeout(()=>input.focus(),50); }
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

  /* ---------- "Ask Yusr" hint chips on key pages ---------- */
  function hintChip(q, send, title){
    const b=document.createElement('button');
    b.className='pill yusr-hint'; b.style.borderLeftColor='var(--green)';
    b.innerHTML='✦ Ask <b>Yusr</b>'; b.title=title||'Yusr — accurate answers & shortcuts, fast';
    b.addEventListener('click',()=>window.openYusr(q,{send:!!send}));
    return b;
  }
  function placeHints(){
    // Troubleshoot / Error Control Board — next to Export
    const ex=document.getElementById('errExport');
    if(ex && !ex.parentElement.querySelector('.yusr-hint'))
      ex.parentElement.appendChild(hintChip('How do I troubleshoot ', false, 'Yusr — describe the error, get the runbook fix'));
    // Live Alerts — next to Sync now
    const al=document.getElementById('alSyncNow');
    if(al && !al.parentElement.querySelector('.yusr-hint'))
      al.parentElement.appendChild(hintChip('What incidents are open and what should I check first?', true, 'Yusr — incident triage'));
    // Home — a prominent CTA beside the greeting (not buried in the range bar)
    const greet=document.getElementById('homeGreeting');
    if(greet && !document.querySelector('.yusr-hint.yusr-home')){
      const c=hintChip(null,false,'Yusr — ask anything about today’s numbers');
      c.classList.add('yusr-home'); c.style.float='right'; c.style.marginLeft='12px';
      greet.insertAdjacentElement('beforebegin', c);
    }
    // Integrations / docs page
    const ig=document.querySelector('#view-integrations .panel .sub');
    if(ig && !ig.parentElement.querySelector('.yusr-hint')){
      const c=hintChip('Explain the integration ', false, 'Yusr — how any integration/webhook works');
      c.style.marginTop='8px'; ig.insertAdjacentElement('afterend', c);
    }
  }
  placeHints(); setTimeout(placeHints, 1500);   // second pass for late-rendered bars

  // hide the bubble + hints entirely when Yusr is disabled in Settings
  fetch('/api/assist/enabled').then(r=>r.json()).then(j=>{
    if(j && j.enabled===false){
      fab.style.display='none'; panel.classList.remove('open');
      document.querySelectorAll('.yusr-hint').forEach(h=>h.style.display='none');
    }
  }).catch(()=>{});
})();
