/* Ops layer: sessions/roles, PII governance, Error Control Board, transaction
 * timelines, and Settings (sync engine + user management). Talks to the console API. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const el = (t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
  const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  // robust timestamp formatter → KSA (UTC+3) — tolerates ISO strings, Dates, epoch, or junk
  const fmtTs = (v, secs) => { if(v==null||v==="") return "—"; const d=new Date(v); if(isNaN(d.getTime())) return esc(String(v));
    const s=new Date(d.getTime()+3*3600e3).toISOString().replace("T"," "); return (secs? s.slice(0,19): s.slice(0,16))+" KSA"; };
  const API = window.API_BASE;
window.API_BASE = API;   // one source of truth for files that fetch outside the api() helper;
  // branded loader — Salam-green hourglass (draining sand) + spinner ring
  const salamLoader = (msg) => `<div class="salam-loader">
    <div class="sl-stage">
      <svg class="sl-ring" viewBox="0 0 104 104"><circle cx="52" cy="52" r="46"/></svg>
      <svg class="sl-hg" viewBox="0 0 60 84" aria-hidden="true">
        <defs><linearGradient id="slSand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#93d64f"/><stop offset="1" stop-color="#1f9e57"/></linearGradient></defs>
        <g class="sl-hgflip">
          <path class="sl-frame" d="M13 6H47M13 78H47M15 6C15 30 45 30 45 42 45 54 15 54 15 78M45 6C45 30 15 30 15 42 15 54 45 54 45 78"/>
          <path class="sl-sand-top" d="M18 10H42L30 39Z"/>
          <path class="sl-sand-bot" d="M30 45 43 74H17Z"/>
          <line class="sl-stream" x1="30" y1="40" x2="30" y2="52"/>
        </g>
      </svg>
    </div>
    <div class="sl-cap">${msg||"Loading…"}</div></div>`;
  window.salamLoader = salamLoader;
  // tiny JSON syntax highlighter for req/res blocks (matches the .codeblk token colors)
  function jsonHi(v){ let s; try{ s=JSON.stringify(v,null,2); }catch(e){ s=String(v); }
    return esc(s)
      .replace(/(&quot;|")(\\.|[^"\\])*?\1(\s*:)?/g, m=> /:\s*$/.test(m) ? `<span class="k">${m}</span>` : `<span class="s">${m}</span>`)
      .replace(/\b(true|false|null)\b/g, '<span class="b">$1</span>')
      .replace(/(^|[\s:\[,])(-?\d+(?:\.\d+)?)/g, '$1<span class="n">$2</span>'); }

  // ---- session ----
  const SES = { email: localStorage.getItem('cons_email')||"", role: localStorage.getItem('cons_role')||"super_admin",
    token: localStorage.getItem('cons_token')||"", me:null };
  // identity = the session token (server-side sessions); role header is only the super-admin preview
  const authHeaders = ()=>({ "X-Console-Role": SES.role, "X-Console-Token": SES.token||"" });
  /* A 401 must NOT immediately nuke the session: a single stray/early call (a poll fired before
   * sign-in finished, an iframe, a queued request) would clear the token and cascade "Not signed in."
   * into every other panel. Instead: re-validate once against /api/me and only sign out if the
   * server truly rejects the token we hold. */
  let _kicked = false, _validating = null;
  function kickToLogin(){
    if(_kicked) return;
    if(!SES.token){ return; }                    // no token at all → nothing to invalidate
    if(_validating) return;
    _validating = (async ()=>{
      try{
        const r = await _fetch(API+"/api/me", { headers: authHeaders() });
        if(r.ok) return;                          // token is fine — that 401 was unrelated/stale
      }catch(e){ return; }                        // network blip → keep the session
      _kicked = true;
      localStorage.removeItem('cons_token'); SES.token = "";
      try{ showGate(); }catch(e){ location.reload(); }
    })().finally(()=>{ _validating = null; });
  }
  /* ---- API transport: auth + de-dupe + concurrency cap + micro-cache -------------------
   * A dashboard render fires hundreds of panel queries at once; unbounded parallel fetches
   * were freezing/crashing the tab even with a fast server. Three guards, all GET-only:
   *   1. DEDUPE   identical in-flight GETs share ONE network request
   *   2. LIMIT    at most MAXPAR requests in flight; the rest queue (browser cap is ~6/host anyway)
   *   3. CACHE    a GET result is reused for CACHE_MS — kills the repeated noc/journey-health calls
   * Mutations (POST/PUT/DELETE) bypass all three and also purge the cache.            */
  const MAXPAR = 6, CACHE_MS = 4000;
  const _fetch = window.fetch.bind(window);
  const _inflight = new Map(), _cache = new Map();
  let _active = 0; const _queue = [];
  const _pump = ()=>{ while(_active < MAXPAR && _queue.length){ const job=_queue.shift(); _active++; job(); } };
  function _slot(run){                       // returns a promise, respecting the concurrency cap
    return new Promise((resolve,reject)=>{
      _queue.push(()=> run().then(resolve,reject).finally(()=>{ _active--; _pump(); }));
      _pump();
    });
  }
  // Global PII preference (super admins): Settings → User management → "PII visibility" card.
  // When ON, ?unmask=1 is appended to every PII-capable endpoint, so ALL pages (Sub360, timelines,
  // dashboard drill-downs, locate) show real values without hunting per-page toggles. Server still
  // enforces the unmaskPII capability — this flag does nothing for non-super roles.
  const PII_EPS = ["/api/subscriber", "/api/transaction", "/api/onboarding-flow/orders", "/api/onboarding-flow/locate"];
  /* GLOBAL PII MODE — one switch for the whole console, persisted per BROWSER SESSION
   * (sessionStorage: survives refresh, dies with the tab — requested 1 Sep). One system for the
   * DMS/map/journey toggles and this wrapper; the server still verifies the capability and
   * audits pii.unmask on every unmasked fetch. */
  window.PII = window.PII || { on:(function(){ try{ return sessionStorage.getItem("consolePII")==="1"; }catch(e){ return false; } })(),
    can(){ try{ const s2=window.opsSession&&window.opsSession(); return !!(s2&&s2.me&&s2.me.caps&&s2.me.caps.unmaskPII); }catch(e){ return false; } },
    set(v){ this.on=!!v&&this.can(); try{ sessionStorage.setItem("consolePII", this.on?"1":"0"); }catch(e){} } };
  window.opsPiiUnmask = ()=> !!(window.PII && window.PII.on);
  window.opsSetPiiUnmask = v=>{ if(window.PII) window.PII.set(v); };
  window.fetch = async (url, opts={})=>{
    const isApi = typeof url==="string" && url.includes("/api/");
    if(!isApi) return _fetch(url, opts);
    // NAMESPACE GUARD — the console owns <CONSOLE_BASE>/* (e.g. /unified-console/*), never root /api/ (which belongs to the
    // public site). Any root-relative /api/... is rewritten here exactly once, so a file that forgets
    // the prefix still routes correctly instead of hitting the website and getting an HTML 404/405.
    if(url.startsWith("/api/") && API) url = API + url;
    if(window.opsPiiUnmask() && PII_EPS.some(e=>url.includes(e)) && !url.includes("unmask="))
      url += (url.includes("?")?"&":"?") + "unmask=1";
    opts.headers = Object.assign({}, opts.headers, authHeaders());
    const method = (opts.method||"GET").toUpperCase();
    const key = method+" "+url;

    if(method!=="GET"){ _cache.clear(); return _core(url, opts, key); }   // writes invalidate reads

    const hit = _cache.get(key);
    if(hit && hit.until > Date.now()) return hit.res.clone();
    if(_inflight.has(key)) return (await _inflight.get(key)).clone();     // ride the in-flight one

    const p = _slot(()=> _core(url, opts, key));
    _inflight.set(key, p);
    try{
      const r = await p;
      if(r.ok) _cache.set(key, { res: r.clone(), until: Date.now()+CACHE_MS });
      return r.clone();
    } finally { _inflight.delete(key); }
  };
  /* TKT-000006 — global loading indicator. A 2px animated bar under the header while any API
   * call is in flight. Shows only after 250ms (no flicker on cached/fast calls), hides when the
   * in-flight count returns to zero. One place — every page benefits, no per-page spinners. */
  let _busyN = 0, _busyT = null;
  function _busy(d){
    _busyN = Math.max(0, _busyN + d);
    let bar = document.getElementById("apiBusyBar");
    if(_busyN > 0){
      if(!bar && !_busyT) _busyT = setTimeout(()=>{ _busyT = null; if(_busyN <= 0) return;
        const b = document.createElement("div"); b.id = "apiBusyBar";
        b.style.cssText = "position:fixed;top:0;left:0;right:0;height:2px;z-index:9999;pointer-events:none;background:linear-gradient(90deg,transparent,var(--green,#0e9f5a),transparent);background-size:40% 100%;background-repeat:no-repeat;animation:apiBusySlide 1.1s linear infinite";
        if(!document.getElementById("apiBusyCss")){ const st = document.createElement("style"); st.id = "apiBusyCss";
          st.textContent = "@keyframes apiBusySlide{0%{background-position:-40% 0}100%{background-position:140% 0}}"; document.head.appendChild(st); }
        document.body.appendChild(b); }, 250);
    } else { if(_busyT){ clearTimeout(_busyT); _busyT = null; } if(bar) bar.remove(); }
  }
  async function _core(url, opts, key){
    _busy(1);
    try{ return await _coreInner(url, opts, key); } finally { _busy(-1); }
  }
  async function _coreInner(url, opts, key){
    let r = await _fetch(url, opts);
    // self-heal: if a rate limit is ever hit, wait out Retry-After (capped) and retry once
    if(r.status===429){
      const wait = Math.min(2000, (Number(r.headers.get("Retry-After"))||1)*1000);
      await new Promise(res=>setTimeout(res, wait));
      r = await _fetch(url, opts);
    }
    if(r.status===401 && !String(url).includes("/api/auth/")){
      // a request that raced sign-in carries the pre-login (empty) token → retry once with the
      // current one before concluding anything is wrong.
      if(SES.token){
        opts.headers = Object.assign({}, opts.headers, authHeaders());
        r = await _fetch(url, opts);
      }
      if(r.status===401) kickToLogin();     // still rejected → validate + maybe sign out
    }
    return r;
  }
  window.__apiStats = ()=>({ inflight:_inflight.size, queued:_queue.length, active:_active, cached:_cache.size });
  // NOTE: goes through window.fetch (not _fetch) so it gets de-dupe + concurrency cap + cache
  async function api(path, opts){ const r=await window.fetch(API+path, Object.assign({headers:{"Content-Type":"application/json"}}, opts)); if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||("HTTP "+r.status)); return r.json(); }

  /* Role labels for the account chip and the Super-Admin "preview as role" picker.
   * Seeded with every role the server ships (26 since 19 Sep 2026) and hydrated from /api/roles so
   * custom roles created in Settings > Users > Roles show up without a deploy. Before that the map
   * held 10 of them, so anyone on a newer role saw the raw key ("l1_oss") as their job title and
   * could not be previewed at all. */
  let ROLE_LABELS = {super_admin:"Super Admin",admin:"Admin",report_manager:"Sales Ops",fixed_ops:"Fixed Ops",b2c_admin:"Salam Home (B2C)",
    errors_manager:"Errors Manager",events_manager:"Events Manager",
    l1_bss:"L1 BSS",l2_bss:"L2 BSS",l1_digital:"L1 Digital",l2_digital:"L2 Digital",l3_digital:"L3 Digital",
    l1_oss:"L1 OSS",l2_oss:"L2 OSS",l3_oss:"L3 OSS",l1_infra:"L1 Infra",l2_infra:"L2 Infra",l3_infra:"L3 Infra",
    l1_data:"L1 Data",l2_data:"L2 Data",l3_data:"L3 Data",
    l1_enterprise:"L1 Enterprise",l2_enterprise:"L2 Enterprise",l3_enterprise:"L3 Enterprise",
    cio:"CIO / Executive",call_center:"Call Center"};
  let ROLE_TEAMS = {};
  let ROLE_RANKS = {};
  let rolesHydrated = false;
  async function hydrateRoleLabels(){
    try{
      const rr = await api("/api/roles"); const m = rr.roles || {};
      if(!Object.keys(m).length) return;
      const L={}, T={}, R={};
      for(const [k,v] of Object.entries(m)){ L[k]=v.label||k; T[k]=v.team||""; R[k]=typeof v.rank==="number"?v.rank:9; }
      ROLE_LABELS=L; ROLE_TEAMS=T; ROLE_RANKS=R; rolesHydrated=true;
      const sel=document.getElementById("rmRole"); if(sel){ const cur=sel.value; sel.innerHTML=roleOptions(cur); }
    }catch(e){}
  }
  /* grouped by team, best rank first - 26 flat options in one list is a scroll, not a choice */
  function roleOptions(current){
    const keys=Object.keys(ROLE_LABELS);
    const groups={};
    for(const k of keys){ const t=ROLE_TEAMS[k]||"Roles"; (groups[t]=groups[t]||[]).push(k); }
    const teamRank=t=>Math.min(...groups[t].map(k=>ROLE_RANKS[k]!=null?ROLE_RANKS[k]:9));
    const opt=k=>`<option value="${k}" ${k===current?'selected':''}>${esc(ROLE_LABELS[k])}</option>`;
    if(!rolesHydrated) return keys.map(opt).join("");
    return Object.keys(groups).sort((a,b)=>teamRank(a)-teamRank(b)||a.localeCompare(b))
      .map(t=>`<optgroup label="${esc(t)}">${groups[t].sort((a,b)=>(ROLE_RANKS[a]-ROLE_RANKS[b])||ROLE_LABELS[a].localeCompare(ROLE_LABELS[b])).map(opt).join("")}</optgroup>`).join("");
  }

  // ---- export helper (CSV / JSON), shared globally ----
  function toCSV(rows){ const cols=[...new Set(rows.flatMap(r=>Object.keys(r)))];
    const q=v=>{ v=v==null?"":typeof v==="object"?JSON.stringify(v):String(v); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
    return [cols.join(","),...rows.map(r=>cols.map(c=>q(r[c])).join(","))].join("\n"); }
  function download(content,name,type){ const b=new Blob([content],{type}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(u),1000); }
  window.opsExport = function(rows,name,anchor){
    if(!rows||!rows.length){ return; }
    document.querySelectorAll(".export-menu").forEach(m=>m.remove());
    const menu=el("div","export-menu",`<button data-f="xlsx">⤓ Download Excel</button><button data-f="csv">⤓ Download CSV</button><button data-f="json">⤓ Download JSON</button>`);
    document.body.appendChild(menu);
    const r=anchor?anchor.getBoundingClientRect():{bottom:56,left:56};
    menu.style.top=(r.bottom+6)+"px"; menu.style.left=Math.min(r.left,window.innerWidth-190)+"px";
    // Excel first — it is what everyone actually asks for. Falls back silently if xlsxout.js
    // failed to load, rather than showing a button that does nothing.
    const xb=menu.querySelector('[data-f=xlsx]');
    if(window.opsXlsx) xb.onclick=()=>{ window.opsXlsx.save([{name:'Data',rows}], name, {source:'export-menu'}); menu.remove(); };
    else xb.remove();
    // CSV and JSON are audited too — the format changes, the accountability does not
    const auditDl=(fmt,file)=>{ try{ if(window.audit) window.audit('EXPORT_'+fmt.toUpperCase(), file,
      { file, page:(location.hash||'#dashboard').replace(/^#/,''), rows:rows.length, source:'export-menu' }); }catch(e){} };
    menu.querySelector('[data-f=csv]').onclick=()=>{ auditDl('csv',name+".csv"); download(toCSV(rows),name+".csv","text/csv"); menu.remove(); };
    menu.querySelector('[data-f=json]').onclick=()=>{ auditDl('json',name+".json"); download(JSON.stringify(rows,null,2),name+".json","application/json"); menu.remove(); };
    setTimeout(()=>document.addEventListener("click",function h(e){ if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener("click",h); } }),50);
  };
  window.opsCan = c => can(c);
  window.opsSession = () => SES;   // { email, role, me:{name,mobile,dashboard,...} }
  /* 2 Sep 2026 view split: home→'dashboard', dms→'dms' (own view), every Explore-menu entry
   * (topology/apigw/docs/journeys/integrations/sub360) → the single 'explore' view. */
  const NAV_VIEW = { landing:"dashboard", execops:"exec", nocwall:"noc", home:"dashboard", topology:"explore", topology2:"explore", apigw:"explore", dmshld:"explore", mvnohld:"explore",
    explorer:"explore", integrations:"explore", monitoring:"monitoring", dms:"dms", fixed:"fixed", otodocs:"explore", salamdocs:"explore", tapdocs:"explore", alerts:"alerts", errors:"errors", analytics:"analytics", sub360:"explore", settings:"settings" };

  async function loadMe(){
    try { SES.me = await api("/api/me"); SES.role = SES.me.role; }
    catch(e){ SES.me = { role:SES.role, views:["dashboard","explore","alerts","errors","settings"], caps:{} }; }
    applyScope(); renderChip(); applyFeatureFlags();
    // Mark the session as ready so late-loading listeners (e.g. the hash router) that
    // registered after this dispatch can still detect readiness and self-heal.
    window.__consoleReady = true;
    document.dispatchEvent(new CustomEvent("consoleReady"));
  }
  // interface feature flags from the server (e.g. hide the AR/EN language switch)
  function applyFeatureFlags(){
    const f = (SES.me && SES.me.features) || {};
    const langBtn = document.getElementById("langToggle");
    if(langBtn){
      const on = f.langSwitch === true;
      langBtn.style.display = on ? "" : "none";
      if(!on && window.i18n && window.i18n.lang !== "en") window.i18n.setLang("en", true);   // force English when the switch is off
    }
  }
  window.opsApplyFeatureFlags = applyFeatureFlags;
  function can(c){ return SES.me && SES.me.caps && SES.me.caps[c]; }
  function applyScope(){
    const views = (SES.me&&SES.me.views)||[];
    const FTV = (SES.me&&SES.me.fixedTabViews)||{};
    document.querySelectorAll(".navtab").forEach(b=>{
      // Fixed sub-pages answer to their own view (matrix column); the hub itself to 'fixed'
      const v = b.dataset.fxtab ? (FTV[b.dataset.fxtab]||"fixed") : NAV_VIEW[b.dataset.view];
      // Executive / Operations: the Home entries need either business, the Mobile entries need the Dashboard view
      const ok = b.dataset.view==="execops" ? (views.includes("dashboard")||views.includes("fixed")) : views.includes(v);
      b.classList.toggle("hidden", !ok);   // Dashboard too — a real gated view since 2 Sep 2026
    });
    window.FIXED_TAB_VIEWS = FTV; window.FIXED_VIEWS_HELD = views.filter(v=>/^fixed/.test(v));
    // business scope (6 Sep 2026): the server already intersected the views with the user's business; here the
    // whole Mobile ▾ / Fixed ▾ group is hidden for the other side (incl. shared-view items like docs / topology)
    const biz = (SES.me&&SES.me.business)||"both"; window.BUSINESS = biz;
    document.querySelectorAll('.navdrop[data-drop="mobile"] .navtab').forEach(b=>{ if(biz==="fixed") b.classList.add("hidden"); });
    document.querySelectorAll('.navdrop[data-drop="home"] .navtab[data-fxtab]').forEach(b=>{ if(biz==="mobile") b.classList.add("hidden"); });
    document.documentElement.setAttribute("data-business", biz);
    const isSuper = SES.me && (SES.me.realRole==="super_admin" || (SES.me.realRoles||[]).includes("super_admin"));
    const show = (id, on) => { const el = document.getElementById(id); if(el) el.style.display = on ? "" : "none"; };
    const has = v => views.includes(v);
    // IT GOVERNANCE — the 'governance' view (SLA · vendors & contracts · SLO definitions)
    ["governGroup","slaMenuItem","vendorContractsMenuItem","sloSettingsMenuItem"].forEach(id=>show(id, has("governance")));
    // REGULATORY AFFAIRS — the 'cst' view (Arqami · CST escalations)
    ["cstGroup","cstArqamiMenuItem","cstEscMenuItem"].forEach(id=>show(id, has("cst")));
    // NOC WALL — the 'noc' view. Its two entries are .navtab buttons, so they also answer to the nav scoping above.
    document.querySelectorAll('#settingsMenu .navtab[data-view="nocwall"]').forEach(b=>b.classList.toggle("hidden", !has("noc")));
    // Agents & LLM stays a root-tier surface: it configures the models, not a business page.
    show("agentsMenuItem", !!(SES.me && SES.me.root!==false && isSuper));
    // if current active tab is hidden, jump to first visible
    const active = document.querySelector(".navtab.active");
    if(active && active.classList.contains("hidden")){
      const first = document.querySelector(".navtab:not(.hidden)"); if(first) first.click();
    }
    /* User management — the 'users' view, which only Super Admin holds. The gear entry used to be shown to
     * anyone who could open the gear at all (i.e. any role with 'settings'), so an Admin could click it and
     * collect a 403 from /api/users. Hide the door rather than lock it in their face. */
    const usersMi = document.querySelector('#settingsMenu [data-seg="users"]'); if(usersMi) usersMi.style.display = has("users")?"":"none";
    const up = $("#usersPanel"); if(up) up.style.display = has("users")?"":"none";
    // settings gear visibility by role
    const gear = document.getElementById("settingsBtn"); if(gear) gear.style.display = views.includes("settings")?"":"none";
    // audit log — super admin only, AND the hidden root tier when ROOT_ADMINS is configured
    // (me.root===false means the server WILL 403 — hiding here is cosmetic, the gate is server-side)
    show("auditMenuItem", has("audit") && !!(SES.me && SES.me.root!==false));
    // Tickets & feedback board — the 'tickets' view. Raising a ticket stays open to everyone.
    show("ticketsMenuItem", has("tickets"));
    // On-call view — removed from the "?" menu on 18 Sep 2026. It is the "On-call" tab of each Alerts
    // page (alertsview.js → renderOncallInto), and #oncall / #fixed-oncall still open it full screen.
    // L2 Workbench menu item — only roles holding the 'workbench' view see it (server requireView gates access)
    const wm = document.getElementById("workbenchMenuItem"); if(wm) wm.style.display = "none";   // 16 Sep 2026: removed from the gear menu by design (#workbench stays reachable by hash)
    // Yusr config page — root tier only once ROOT_ADMINS is set (root stays true for all when unset)
    const yi = document.querySelector('#settingsMenu [data-seg="assist"]'); if(yi) yi.style.display = (SES.me && SES.me.root===false)?"none":"";
  }
  function displayName(){ return (SES.me&&SES.me.name) || (SES.email? SES.email.split("@")[0] : "Sign in"); }
  function renderChip(){
    const c = $("#userChip"); if(!c) return;
    const who = displayName();
    const init = (who&&who[0]? who[0] : "?").toUpperCase();
    c.innerHTML = `<span class="av">${esc(init)}</span><span>${esc(who)}</span>`;
  }

  // ---- role sign-in / switch modal ----
  function openRoleModal(){
    hydrateRoleLabels();
    const card = $("#roleModalCard");
    const isSuper = SES.me && SES.me.realRole === 'super_admin';
    const nm = displayName();
    card.innerHTML = `<div class="modal-head"><span class="path">Account</span><span class="x" id="rmX">×</span></div>
      <div class="modal-body">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="av" style="width:38px;height:38px;border-radius:50%;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">${esc((nm||'?')[0].toUpperCase())}</span>
          <div><div style="font-weight:700">${esc(nm)}</div><div class="rl" style="color:var(--muted);font-size:11px">${esc(ROLE_LABELS[SES.role]||SES.role)}${isSuper&&SES.role!=='super_admin'?' · previewing':''} · ${esc(SES.email||'')}</div></div>
        </div>
        <h5 style="margin-top:16px">MY PROFILE</h5>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><label style="font-size:9.5px;letter-spacing:1px;color:var(--muted);font-weight:800">NAME</label><input id="pfName" class="jsearch" style="width:100%" value="${esc((SES.me&&SES.me.name)||'')}" placeholder="Full name"></div>
          <div><label style="font-size:9.5px;letter-spacing:1px;color:var(--muted);font-weight:800">MOBILE</label><input id="pfMobile" class="jsearch" style="width:100%" value="${esc((SES.me&&SES.me.mobile)||'')}" placeholder="05x xxx xxxx"></div>
        </div>
        <div style="text-align:right;margin-top:8px"><button class="pill" id="pfSave" style="border-left-color:var(--green)">Save profile</button> <span id="pfMsg" class="rl"></span></div>
        ${isSuper?`<h5 style="margin-top:16px">PREVIEW AS ROLE <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(Super Admin only)</span></h5>
        <select id="rmRole" class="jsearch" style="width:100%">
          ${roleOptions(SES.role)}
        </select>`:''}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
          <button class="pill" id="rmSignout" style="border-left-color:var(--red)">Sign out</button>
          ${isSuper?`<button class="pill" id="rmApply" style="border-left-color:var(--green)">Apply preview</button>`:''}
        </div>
      </div>`;
    $("#roleModal").classList.add("open");
    $("#rmX").onclick = ()=>$("#roleModal").classList.remove("open");
    $("#pfSave").onclick = async ()=>{
      const name=$("#pfName").value.trim(), mobile=$("#pfMobile").value.trim();
      try{ await api("/api/me",{method:"PATCH",body:JSON.stringify({name,mobile})});
        if(SES.me){ SES.me.name=name; SES.me.mobile=mobile; }
        renderChip(); $("#pfMsg").textContent="✓ saved";
      }catch(e){ $("#pfMsg").textContent=e.message; }
    };
    if(isSuper){
      $("#rmApply").onclick = async ()=>{
        SES.role = $("#rmRole").value; localStorage.setItem('cons_role',SES.role);
        $("#roleModal").classList.remove("open");
        await loadMe();
        const active=document.querySelector(".navtab:not(.hidden)"); if(active) active.click();
      };
    }
    $("#rmSignout").onclick = ()=>{ $("#roleModal").classList.remove("open"); _origSignout(); };
  }
  $("#roleModal").addEventListener("click",e=>{ if(e.target.id==="roleModal") $("#roleModal").classList.remove("open"); });

  // ================= ERROR CONTROL BOARD =================
  const __es = (window.pf && window.pf.get('err_state', null)) || {};
  const errState = { window:__es.window||24, team:__es.team||"", category:__es.category||"", q:"", lastFeed:[], sim:__es.sim||null, pinned:!!__es.pinned, rangeKey:__es.rangeKey||"range", codeFilter:__es.codeFilter||"", gwFilter:__es.gwFilter||"", clsFilter:__es.clsFilter||"", hasCls:false };
  function saveErr(){ if(window.pf) window.pf.set('err_state', { window:errState.window, team:errState.team, category:errState.category, sim:errState.sim, pinned:errState.pinned, rangeKey:errState.rangeKey, codeFilter:errState.codeFilter, gwFilter:errState.gwFilter, clsFilter:errState.clsFilter }); }
  // Business vs Technical color standard (errclass.js): business = the API said no (blue) ·
  // technical = the API failed to answer (red). Shared badge — reused by later rollout steps.
  const CLS_COLOR = { business:{c:"#3b82f6",bg:"var(--err-biz-bg)",label:"Business"}, technical:{c:"#ef4444",bg:"var(--err-tec-bg)",label:"Technical"}, success:{c:"#10b981",bg:"var(--ok-bg)",label:"Success"} };
  const clsBadge = (cls, reason) => { const k=CLS_COLOR[cls]; if(!k) return "";
    return `<span class="clspill" title="${esc(reason||k.label)}" style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.02em;background:${k.bg};color:${k.c};border:1px solid ${k.c}55;margin-left:6px;white-space:nowrap;vertical-align:middle">${k.label}</span>`; };
  window.clsBadge = clsBadge;
  // payment gateway colors — UPG / HyperPay / Tap / Tamara / Emkan / Samsung Pay / … (badge + filter chips)
  const GW_COLOR = { 'UPG':'#ff7849', 'HyperPay':'#2563eb', 'Tap':'#16a34a', 'Tamara':'#0891b2', 'Emkan':'#d97706', 'Samsung Pay':'#8b5cf6', 'Apple Pay':'#0ea5e9', 'STC Pay':'#7c3aed',
    // delivery carriers (badge on delivery rows)
    'oto':'#ea580c', 'tam':'#0d9488', 'smsa':'#2563eb', 'stcc':'#7c3aed', 'aramex':'#dc2626', 'jt':'#d97706' };
  const gwColor = g => GW_COLOR[g] || '#94a3b8';
  const gwBadge = g => g ? `<span class="gwpill" title="Gateway: ${esc(g)}" style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.02em;background:${gwColor(g)}1e;color:${gwColor(g)};border:1px solid ${gwColor(g)}55;margin-right:6px;white-space:nowrap">${esc(g)}</span>` : '';
  const CAT_COLOR = {payment:"#ea580c",activation:"#0d9488",semati:"#7c3aed",nafath:"#7c3aed",eligibility:"#2563eb",change_plan:"#0891b2",change_ownership:"#4f46e5",delivery:"#d97706"};
  // map each Troubleshoot error tile to the rule whose runbook best fits it (for the L1 triage panel)
  const CAT_RUNBOOK_RULE = {payment:"payment_fail_storm",payment_stuck:"payment_stuck_storm",payment_dup:"payment_duplicate",activation:"activation_fail_storm_technical",semati:"semati_provider_down",nafath:"nafath_fail_storm",eligibility:"eligibility_deny_spike",change_plan:"change_plan_fail_spike_technical",delivery:"delivery_fail_spike"};
  const CAT_RUNBOOK_FALLBACK = {change_ownership:"1) Troubleshoot → Change Ownership: open a failing case and read its detail (checkout_type 5). 2) Split cause: Nafath transfer-of-ownership step vs BSS ownership update. 3) If Nafath, check the identity path; if BSS, check the ownership API. 4) Escalate to Digital Ops L2 if systemic."};
  let _rbCache=null;
  function loadRuleRunbooks(){   // fetch once: rule.key -> runbook text
    if(_rbCache) return _rbCache;
    _rbCache=api("/api/rules").then(d=>{ const arr=(d&&d.rules)||[]; const m={}; arr.forEach(r=>{ if(r.runbook) m[r.key]=r.runbook; }); return m; })
      .catch(()=>{ _rbCache=null; return {}; });
    return _rbCache;
  }
  function rbSteps(text){   // split "1) .. 2) .." into <li> steps; fall back to one line
    const parts=String(text||"").split(/\s+(?=\d\)\s)/).map(s=>s.replace(/^\d\)\s*/,"").trim()).filter(Boolean);
    return (parts.length?parts:[String(text||"").trim()]).map(s=>`<li>${esc(s)}</li>`).join("");
  }
  function renderRunbookPanel(cat){
    const feed=$("#errFeed"); if(!feed||!feed.parentNode) return;
    let rb=document.getElementById("errRunbook");
    if(!rb){ rb=document.createElement("div"); rb.id="errRunbook"; feed.parentNode.insertBefore(rb, feed); }
    if(!cat){ rb.style.display="none"; rb.innerHTML=""; return; }
    const col=CAT_COLOR[cat]||"#64748b";
    rb.style.cssText=`display:block;margin:10px 0;padding:10px 14px;border-radius:10px;border-left:4px solid ${col};background:var(--card2,rgba(148,163,184,.08))`;
    rb.innerHTML=`<div style="font-weight:800;font-size:12px;letter-spacing:.02em;color:${col};margin-bottom:4px">▸ GUIDED RESPONSE</div><ol id="rbOl" style="margin:0 0 0 18px;padding:0;font-size:12.5px;line-height:1.5"><li>Loading runbook…</li></ol>${catReferenceHtml(cat,col)}`;
    const ruleKey=CAT_RUNBOOK_RULE[cat];
    loadRuleRunbooks().then(map=>{
      const text=(ruleKey&&map[ruleKey]) || CAT_RUNBOOK_FALLBACK[cat] || "Identify the dominant error code / vendor in the feed below, check the owning integration, and escalate to the owning team if it persists.";
      const ol=document.getElementById("rbOl"); if(ol) ol.innerHTML=rbSteps(text);
    });
  }
  // Per-category L1 / customer-care reference appended under the runbook steps (collapsible).
  function catReferenceHtml(cat,col){
    const row=(code,desc)=>`<tr><td style="padding:2px 10px 2px 0;white-space:nowrap;font-family:var(--mono);font-size:11.5px;color:${col};font-weight:700;vertical-align:top">${esc(code)}</td><td style="padding:2px 0;font-size:12px">${desc}</td></tr>`;
    if(cat==='payment') return paymentReferenceHtml(col,row);
    if(cat==='activation') return bssReferenceHtml(col,row);
    if(cat!=='nafath') return "";
    return `<details style="margin-top:10px;border-top:1px dashed var(--line,#e2e8f0);padding-top:8px">`+
      `<summary style="cursor:pointer;font-weight:800;font-size:11.5px;letter-spacing:.02em;color:${col}">NAFATH SERVICE TYPES & CUSTOMER-CARE REFERENCE</summary>`+
      `<div style="font-size:12px;line-height:1.55;margin-top:8px">`+
        `<div style="margin-bottom:6px">Each row's <b>service</b> field = what the customer was trying to do (identity is verified via Nafath or Absher — see <code>auth_type</code>):</div>`+
        `<table style="border-collapse:collapse;margin-bottom:8px"><tbody>`+
          row('new_mobile','Issue a new mobile number (new individual line)')+
          row('new_sim','Issue a new SIM / eSIM')+
          row('change_plan','Change plan type (prepaid ↔ postpaid)')+
          row('transfer_ownership_local','Transfer number ownership <b>within Salam</b> (both parties on Salam)')+
          row('transfer_ownership_global','Transfer number ownership <b>between networks</b> (from another operator)')+
        `</tbody></table>`+
        `<div style="margin-bottom:6px"><b>⚠ Ownership transfers</b> (<code>transfer_ownership_local/global</code>) are Nafath-authorized but are pulled into the <b>Change Ownership</b> tile — not this one. If a customer's ownership transfer failed, look under Change Ownership.</div>`+
        `<div style="margin-bottom:6px"><b>What the status means &amp; what to tell the customer:</b></div>`+
        `<table style="border-collapse:collapse;margin-bottom:8px"><tbody>`+
          row('expired','Customer did not approve in time — ask them to retry and approve in the <b>Nafath app</b> within the time window.')+
          row('rejected / denied','Approval was declined — check they are approving the right request under the correct national ID / Absher account.')+
          row('400-N069','A Nafath provider error — if the volume is rising it is provider-side, not the customer; escalate.')+
          row('400-N999','No / invalid response from Nafath — provider or transport issue; escalate, do not ask the customer to keep retrying.')+
        `</tbody></table>`+
        `<div><b>Provider note:</b> the Nafath authorize endpoint runs on the TCC / CITC platform (same as Semati), so a CITC outage can hit both — check the <b>CITC upstream</b> composite alert before blaming our side.</div>`+
      `</div></details>`;
  }
  // Activation (BSS/Semati) reference + the OSB read-path SOAP-fault note (Activation tile).
  function bssReferenceHtml(col,row){
    const sub=t=>`<div style="font-weight:800;font-size:11px;letter-spacing:.02em;color:${col};margin:10px 0 4px">${t}</div>`;
    return `<details style="margin-top:10px;border-top:1px dashed var(--line,#e2e8f0);padding-top:8px" open>`+
      `<summary style="cursor:pointer;font-weight:800;font-size:11.5px;letter-spacing:.02em;color:${col}">BSS / SEMATI STATUS CODES · OSB READ-PATH FAULTS · REFERENCE</summary>`+
      `<div style="font-size:12px;line-height:1.55;margin-top:8px">`+
        `<div>The chips above group activation failures by <b>status_code · api</b> from <code>activation_logs</code> (the BSS/Semati <b>write-path</b>: account/subscriber create, number provisioning, transfer-operator).</div>`+
        sub('WRITE-PATH STATUS CODES')+
        `<table style="border-collapse:collapse"><tbody>`+
          row('00','BSS account/subscriber create — <b>OK</b> (success).')+
          row('600','Semati — <b>OK</b> (success).')+
          row('727','Semati MOBILE_DOESNT_EXIST — number not found in the CITC registry (common on transfer-operator / MNP).')+
          row('715','Semati SERVICE_NOT_AVAILABLE — CITC provider down; check the CITC upstream composite alert.')+
          row('726 / 738 / 740','Semati validation errors (person/number state) — usually data-side, not an outage.')+
          row('812 / 823','Semati transport / gateway errors — provider-side; escalate if the volume rises.')+
        `</tbody></table>`+
        `<div style="margin-top:8px;padding:8px 10px;border-radius:8px;border-left:3px solid #dc2626;background:rgba(220,38,38,.06)">`+
          `<div style="font-weight:800;color:#dc2626;font-size:11.5px">⚠ BSS READ-PATH — OSB SOAP FAULTS (response 1500 · "OSB-382000")</div>`+
          `<div style="margin-top:4px">Since the <b>IMPACT R7.2 Siebel CNE go-live (24 Jul 2026)</b>, the BSS <b>read</b> APIs — <code>bss/invoices/list-invoices</code>, <code>bss/account/list-account</code>, <code>bss/account/get-account</code>, <code>bss/subscription/get-sub</code> — intermittently return <b>1500 / OSB-382000</b> (client received SOAP fault / OSB timeout), in bursts of ~100–200/min. This is what makes the app show <b>"plans not found / details missing"</b>, <b>greyed balance transfer</b>, and general <b>slowness</b> — the write transactions above still succeed.</div>`+
          `<div style="margin-top:4px"><b>Where to look:</b> these read faults are logged in the <b>OSB integration layer</b> (<code>logs.uil_logs</code>), which is <b>not replicated into this console</b>, so they do not appear in the chips above. Query <code>logs.uil_logs</code> (response_Code = 1500) on the integration DB for live counts, and track the per-minute frequency to confirm it is trending down.</div>`+
        `</div>`+
      `</div></details>`;
  }
  // Payments L1 / RCA / UPG-correlation reference (Payment tile).
  function paymentReferenceHtml(col,row){
    const sub=t=>`<div style="font-weight:800;font-size:11px;letter-spacing:.02em;color:${col};margin:10px 0 4px">${t}</div>`;
    return `<details style="margin-top:10px;border-top:1px dashed var(--line,#e2e8f0);padding-top:8px">`+
      `<summary style="cursor:pointer;font-weight:800;font-size:11.5px;letter-spacing:.02em;color:${col}">PAYMENTS RCA · GATEWAYS · UPG CORRELATION · CUSTOMER-CARE REFERENCE</summary>`+
      `<div style="font-size:12px;line-height:1.55;margin-top:8px">`+
        `<div>The chips above group declines by <b>gateway code · message</b>. A single code surging across customers = a systemic gateway/UPG issue, not the customer. Codes come from <code>payment_commit_response.gateway.response</code> (UPG/salam) or <code>fail_reason</code> (hyperpay/tap).</div>`+

        sub('GATEWAYS / VENDORS (the <code>vendor</code> field)')+
        `<table style="border-collapse:collapse"><tbody>`+
          row('salam / merchalink','SalamPay via Merchalink = the <b>UPG</b> unified gateway. Real code·message in <code>payment_commit_response.gateway.response</code>. Webhook = Merchalink callback.')+
          row('hyperpay','HyperPay card gateway — reason is in <code>fail_reason</code>.')+
          row('tap','Tap Payments (3-D Secure card flow) — reason in <code>fail_reason</code>; Tap callback confirms capture.')+
          row('tamara / emkan','BNPL / instalment providers — declines often eligibility/limit, not card errors.')+
        `</tbody></table>`+

        sub('METHODS (<code>payment_method</code> / <code>card_type</code>)')+
        `<table style="border-collapse:collapse"><tbody>`+
          row('credit-card / mada','Card rails (mada = local debit). card_type: 1 credit · 2 mada · 0 Apple Pay · 3 Amex · 4 STC.')+
          row('samsung-pay','<b>NEW</b> (launched recently) — detected broadly (<code>payment_method</code>/<code>vendor</code> ~ samsung). Has its own P1/P2 alerts; confirm the exact tag from live data.')+
          row('apple-pay / stc-pay','Wallet rails — token/3DS issues show as gateway declines.')+
        `</tbody></table>`+

        sub('STATUSES & THE STUCK CASE')+
        `<table style="border-collapse:collapse"><tbody>`+
          row('pending / initiated','Not yet confirmed. Older than 30 min = <b>STUCK</b> → the UPG/Tap confirmation webhook never landed: the customer may be <b>charged while the app shows unpaid</b>. Do NOT ask them to pay again — reconcile by <code>payment_reference_id</code> (Payment Stuck tile).')+
          row('success','Captured.')+
          row('fail / failed','Declined — reason in the code·message chips above.')+
        `</tbody></table>`+

        sub('REPEATED CASES → WHAT TO TELL THE CUSTOMER')+
        `<table style="border-collapse:collapse"><tbody>`+
          row('Insufficient funds','Bank declined for balance — ask them to use another card/method.')+
          row('Incorrect CVV / expired / invalid card','Data error — retry with the correct card details.')+
          row('3DS / OTP / authentication failed','They did not complete the bank OTP — retry and complete the OTP prompt.')+
          row('Do not honor / restricted','Issuer declined — advise they contact their bank or try another card.')+
          row('Stuck (charged, app unpaid)','Reassure: do not pay again — it auto-reconciles or is refunded; escalate by ref if not resolved.')+
          row('Duplicate charge','Captured twice — refund the extra (Payment Duplicate tile).')+
          row('Samsung Pay failing','New method — have them try card/mada while we investigate; check the Samsung Pay alert.')+
        `</tbody></table>`+

        sub('UPG CORRELATION & PROACTIVE')+
        `<div style="margin-bottom:4px"><b>Join key:</b> <code>payment_reference_id</code> (MVNO) = the UPG transaction ref. The UPG gateway response (code, message) is already stored on the MVNO side in <code>payment_commit_response.gateway.response</code> — that is what the chips read, so most correlation needs no second DB.</div>`+
        `<div style="margin-bottom:4px">For settlement truth (captured vs not, refunds, webhook delivery), look the <code>payment_reference_id</code> up in the <b>UPG prod DB</b>; the Merchalink callback (<code>callbacks_controller#merchalink</code>) is the UPG webhook.</div>`+
        `<div><b>Proactive:</b> blended payment storms have their own P1/P2; Samsung Pay has dedicated P1/P2; and a single decline code surging in the chips is your earliest systemic-gateway signal — filter to it and correlate the ref against UPG.</div>`+
      `</div></details>`;
  }
  // categories that support a provider code·message breakdown filter, with the tile-appropriate heading
  const CODE_BREAKDOWN = {
    semati: { title: 'SEMATI FAILURES · responseCode · responseMessage' },
    nafath: { title: 'NAFATH FAILURES · status · message' },
    payment: { title: 'PAYMENT DECLINES · gateway code · message' },
    activation: { title: 'ACTIVATION · BSS / SEMATI · status_code · api' },
    delivery: { title: 'DELIVERY FAILURES · reason · state' }
  };
  // reflect the selected category into the URL so each Troubleshoot category is shareable
  // (#troubleshoot?cat=semati). replaceState → no reload / no hashchange loop.
  function reflectCatUrl(cat){
    try{ const h='#troubleshoot'+(cat?`?cat=${encodeURIComponent(cat)}`:''); if(location.hash!==h && history.replaceState) history.replaceState(null,'',h); }catch(e){}
  }

  /* ---- UPG / payments deep-dive: the INVOICE-LEVEL truth (April-2026 lesson: gateway exports
   * count charge ATTEMPTS; here we show FINAL outcomes) — funnel per gateway, retry-success %,
   * decline reasons and a 14-day abandonment/decline trend. Payment tile only. */
  let _upgVendor = "";
  /* PAYMENT GATEWAY REGISTRY (9 Sep 2026): ⇄ UPG is the UPG (SalamPay) gateway's own DB — it only knows UPG (vendor
   * 'salam') charges, so the button appears only on UPG rows and only while UPG is enabled in Settings → Payment
   * gateways. Disabled gateways are labelled as such in the deep-dive chips. */
  let _gwReg=null; async function gwRegistry(){ if(_gwReg && Date.now()-_gwReg.at<60000) return _gwReg; try{ const d=await api("/api/gateways"); _gwReg={at:Date.now(),map:Object.fromEntries((d.gateways||[]).map(g=>[g.key,g]))}; }catch(_){ _gwReg={at:Date.now(),map:{}}; } return _gwReg; }
  const isUpgRow = v => /salam|upg|merchalink/i.test(String(v||""));
  const upgOn = () => !_gwReg || !_gwReg.map.salam || _gwReg.map.salam.enabled!==false;
  const gwOff = v => { const k=/salam|upg|merchalink/i.test(String(v||""))?"salam":/hyper/i.test(String(v||""))?"hyperpay":/tap/i.test(String(v||""))?"tap":/apollo/i.test(String(v||""))?"apollo":null; const g=k&&_gwReg&&_gwReg.map[k]; return g&&g.enabled===false?g:null; };
  async function renderUpgDeep(){
    const feed=$("#errFeed"); if(!feed||!feed.parentNode) return;
    let host=document.getElementById("upgDeep");
    if(errState.category!=="payment"){ if(host) host.remove(); return; }
    if(!host){ host=document.createElement("div"); host.id="upgDeep"; const cb=document.getElementById("codeBreak"); (cb&&cb.parentNode?cb.parentNode:feed.parentNode).insertBefore(host, cb?cb.nextSibling:feed); }
    host.innerHTML=`<div class="sub" style="margin:10px 0 6px">Loading UPG deep-dive…</div>`;
    const simQ=errState.sim?`&sim=${encodeURIComponent(errState.sim)}`:"";
    let d; try{ [d]=await Promise.all([api(`/api/payments/deep-dive?window=${errState.window}${simQ}${_upgVendor?`&vendor=${encodeURIComponent(_upgVendor)}`:""}`), gwRegistry()]); }
    catch(e){ host.innerHTML=""; return; }
    const liveGw=_gwReg?Object.values(_gwReg.map).filter(g=>g.enabled).map(g=>g.label):[];
    const wrap=x=>`<div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0;background:var(--card)">
      <div style="font-weight:800;font-size:12.5px;margin-bottom:2px">PAYMENTS DEEP-DIVE <span class="rl" style="font-weight:600">· ${liveGw.length?`live gateway${liveGw.length>1?"s":""}: <b style="color:var(--green)">${esc(liveGw.join(" · "))}</b> · `:""}final outcomes, not attempts · ${d.sim?`${d.hours}h window ending ${esc(KT.dt(d.sim))}Z`:`last ${d.hours}h`} · click any number for the cases</span></div>${x}</div>`;
    const F=d.funnel||[];
    if(!F.length){ host.innerHTML=wrap(`<div class="rl">No payments in this window.</div>`); return; }
    // vendor chips
    const vends=[...new Set(F.map(f=>f.vendor))];
    const chips=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px;align-items:center">
      <button class="teamchip ${_upgVendor===""?"active":""}" data-uv="">All gateways</button>
      ${vends.map(v=>{ const off=gwOff(v); return `<button class="teamchip ${_upgVendor===v?"active":""}" data-uv="${esc(v)}" ${off?`title="disabled in Settings → Payment gateways${off.since?" since "+new Date(off.since).toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})+" KSA":""} — rows here predate the switch-off" style="opacity:.6"`:""}>${esc(v==='salam'?'UPG (salam)':v)}${off?' <span style="font-size:9.5px;font-weight:800;letter-spacing:.04em">· OFF</span>':''}</button>`; }).join("")}
      <span style="flex:1"></span>
      <input id="udSearch" class="mono" placeholder="MSISDN / customer ID / service no…" style="padding:4px 8px;border:1px solid var(--line);border-radius:7px;background:var(--card2);color:var(--ink);font-size:11px;width:210px">
      <button class="pill" id="udSearchGo" style="padding:3px 9px;font-size:11px;border-left-color:#0e9f5a" title="All transactions for this customer, end to end (incl. ⇄ UPG)">💳 Customer 360</button></div>`;
    // funnel bars (aggregate over the filtered rows)
    const agg=F.reduce((a,f)=>{ for(const k of ['total','success','declined','failed_noanswer','abandoned','stuck','refunded']) a[k]=(a[k]||0)+(f[k]||0); return a; },{});
    const seg=(label,val,color,note,key)=>{ const pct=agg.total?Math.round(100*val/agg.total):0;
      return `<div style="min-width:130px;flex:1;cursor:${key?'pointer':'default'}" ${key?`data-updrill="${key}" title="Show the ${label.toLowerCase()} cases"`:''}><div style="font-size:11px;font-weight:700;color:${color}">${label}</div>
        <div style="font-size:19px;font-weight:800;color:${color}">${(val||0).toLocaleString()} <span style="font-size:11px;font-weight:700;color:var(--muted)">${pct}%</span></div>
        <div class="rl" style="font-size:10px">${note}</div></div>`; };
    const rt=d.retry||{}; const rtPct=rt.sampled?Math.round(100*(rt.recovered||0)/rt.sampled):null;
    const funnel=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px">
      ${seg("SUCCESS",agg.success,"#10b981","completed & confirmed","success")}
      ${seg("ABANDONED",agg.abandoned,"#64748b","initiated · no gateway answer · customer left","abandoned")}
      ${seg("DECLINED",agg.declined,"#3b82f6","gateway said no (business)","declined")}
      ${seg("STUCK",agg.stuck,"#ef4444","answered but not finalised (callback gap)","stuck")}
      ${seg("FAIL·NO ANSWER",agg.failed_noanswer,"#d97706","failed without gateway response","failed_noanswer")}
      <div style="min-width:150px;flex:1"><div style="font-size:11px;font-weight:700;color:#7c3aed">RETRY-SUCCESS 24h</div>
        <div style="font-size:19px;font-weight:800;color:#7c3aed">${rtPct==null?"—":rtPct+"%"}</div>
        <div class="rl" style="font-size:10px">of failed/abandoned customers paid later (n=${rt.sampled||0})</div></div></div>`;
    // per-gateway table
    const cell=(f,key,val,style)=>`<td style="${style};cursor:pointer;text-decoration:underline dotted" data-updrill="${key}" data-upv="${esc(f.vendor)}" title="Show these cases">${val.toLocaleString()}</td>`;
    const tbl=`<table class="alerts"><tr><th>GATEWAY</th><th>TOTAL</th><th>SUCCESS</th><th>ABANDONED</th><th>DECLINED</th><th>STUCK</th></tr>${
      F.map(f=>`<tr><td class="mono">${esc(f.vendor==='salam'?'UPG (salam)':f.vendor)}</td><td>${f.total.toLocaleString()}</td>
        ${cell(f,'success',f.success,'color:#10b981;font-weight:700')}${cell(f,'abandoned',f.abandoned,'')}
        ${cell(f,'declined',f.declined,'color:#3b82f6')}${cell(f,'stuck',f.stuck,f.stuck?'color:#ef4444':'')}</tr>`).join("")}</table>`;
    // 14-day trend: abandonment % (grey) + decline % (blue) mini-bars
    const T=d.trend||[]; let trend="";
    if(T.length>1){
      const W=760,H=90,pl=30,pb=16,pt=6;
      const maxP=Math.max(...T.map(r=>r.total?Math.max(r.abandoned/r.total,r.declined/r.total)*100:0),10);
      const bw=Math.max(4,Math.floor((W-pl)/T.length)-3);
      const x=i=>pl+i*((W-pl)/T.length), y=v=>H-pb-(v/maxP)*(H-pb-pt);
      let g="";
      T.forEach((r,i)=>{ const ab=r.total?100*r.abandoned/r.total:0, dc=r.total?100*r.declined/r.total:0;
        g+=`<rect x="${x(i)}" y="${y(ab)}" width="${bw/2}" height="${Math.max(1,(H-pb)-y(ab))}" fill="#64748b" opacity=".7" style="cursor:pointer" data-upday="${esc(String(r.day).slice(0,10))}" data-upout="abandoned"><title>${esc(String(r.day))}: abandoned ${ab.toFixed(1)}% (${r.abandoned}/${r.total}) — click for cases</title></rect>`;
        g+=`<rect x="${x(i)+bw/2}" y="${y(dc)}" width="${bw/2}" height="${Math.max(1,(H-pb)-y(dc))}" fill="#3b82f6" opacity=".8" style="cursor:pointer" data-upday="${esc(String(r.day).slice(0,10))}" data-upout="declined"><title>${esc(String(r.day))}: declined ${dc.toFixed(1)}% (${r.declined}/${r.total}) — click for cases</title></rect>`;
        g+=`<text x="${x(i)+bw/2}" y="${H-4}" text-anchor="middle" font-size="7.5" fill="var(--muted)">${String(r.day).slice(8,10)}</text>`; });
      trend=`<div class="rl" style="margin:8px 0 2px;font-weight:700">14-day trend · <span style="color:var(--muted)">abandonment%</span> vs <span style="color:#3b82f6">decline%</span></div>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:780px;height:${H}px">${g}</svg>`;
    }
    const dec=(d.declines||[]).filter(x=>x.reason&&x.reason!=='—');
    const decHtml=dec.length?`<div class="rl" style="margin:8px 0 2px;font-weight:700">Top decline reasons</div>${dec.map(x=>`<span class="teamchip" style="cursor:default;margin:2px 3px 0 0">${esc(clipTxt(x.reason,60))} · <b>${x.n}</b></span>`).join("")}`:"";
    host.innerHTML=wrap(chips+funnel+tbl+trend+decHtml);
    host.querySelectorAll("[data-uv]").forEach(b=>b.addEventListener("click",()=>{ _upgVendor=b.dataset.uv||""; if(window.audit) window.audit("APPLY_FILTER","troubleshoot:upg_vendor:"+(_upgVendor||"all")); renderUpgDeep(); }));
    host.querySelectorAll("[data-updrill]").forEach(el=>el.addEventListener("click",()=>openUpgDrill(el.dataset.updrill, el.dataset.upv||_upgVendor, null)));
    host.querySelectorAll("[data-upday]").forEach(el=>el.addEventListener("click",()=>openUpgDrill(el.dataset.upout, _upgVendor, el.dataset.upday)));
    const uds=host.querySelector("#udSearch"), udg=host.querySelector("#udSearchGo");
    const udGo=()=>{ const v=(uds&&uds.value||"").trim(); if(!v) return; const main=$("#custMsisdn"); if(main) main.value=v; customer360(); };
    if(udg) udg.addEventListener("click",udGo);
    if(uds) uds.addEventListener("keydown",e=>{ if(e.key==="Enter") udGo(); });
  }

  /* Deep-dive drill modal — the cases behind one funnel number. Each row: journey Timeline
   * (app side) + ⇄ UPG (gateway side) = the end-to-end correlation, one click each way. */
  const OUT_LABEL={success:"SUCCESS",abandoned:"ABANDONED — customer left",declined:"DECLINED (business)",stuck:"STUCK — callback gap",failed_noanswer:"FAIL · NO ANSWER",refunded:"REFUNDED"};
  async function openUpgDrill(outcome, vendor, day){
    const card=$("#panelModalCard"); if(!card) return;
    card.innerHTML=`<div class="modal-head"><span class="path">Payments · ${esc(OUT_LABEL[outcome]||outcome)}${vendor?` · ${esc(vendor)}`:""}${day?` · ${esc(day)}`:""}</span><span class="x" id="udX">×</span></div>
      <div class="modal-body">${window.salamLoader?window.salamLoader("Loading cases…"):"Loading…"}</div>`;
    $("#panelModal").classList.add("open"); $("#udX").onclick=()=>$("#panelModal").classList.remove("open");
    if(window.audit) window.audit("UPG_DRILL", outcome+(vendor?":"+vendor:"")+(day?":"+day:""));
    const simQ=errState.sim?`&sim=${encodeURIComponent(errState.sim)}`:"";
    let d; try{ d=await api(`/api/payments/deep-dive/drill?outcome=${encodeURIComponent(outcome)}&window=${errState.window}${simQ}${vendor?`&vendor=${encodeURIComponent(vendor)}`:""}${day?`&day=${encodeURIComponent(day)}`:""}`); }
    catch(e){ card.querySelector(".modal-body").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const body=card.querySelector(".modal-body");
    const R=d.rows||[];
    if(!R.length){ body.innerHTML=`<div class="rl">No cases in this slice.</div>`; return; }
    body.innerHTML=`<div class="rl" style="margin-bottom:6px">${d.total.toLocaleString()} case(s)${d.total>R.length?` — showing latest ${R.length}`:""}${day?` on ${esc(day)}`:""}. Timeline = the customer's journey (app side)${R.some(r=>isUpgRow(r.vendor))&&upgOn()?"; ⇄ UPG = the UPG gateway's view of the same payment (UPG rows only — HyperPay has no gateway-side feed yet)":""}.</div>
      <table class="alerts"><tr><th>WHEN (KSA)</th><th>MOBILE</th><th>AMOUNT</th><th>GW</th><th>CONTEXT</th><th>REASON</th><th></th></tr>${
      R.map(r=>`<tr>
        <td class="mono" style="font-size:10.5px">${esc(KT.md(r.created_at))}</td>
        <td class="mono">${esc(r.mobile||"—")}</td><td>${esc(r.amount)} </td>
        <td class="mono" style="font-size:10.5px">${esc(r.vendor||"—")}</td>
        <td style="font-size:11px">${esc(r.payment_on_type||"")}${r.platform?` · ${esc(r.platform)}`:""}</td>
        <td style="font-size:11px">${esc(clipTxt(r.reason&&r.reason!=="—"?r.reason:"",42))}</td>
        <td style="white-space:nowrap">
          ${r.payment_on_id?`<button class="pill" style="padding:3px 8px" data-udt="${esc(r.payment_on_type==='OnboardingOrder'?r.payment_on_id:'')}" data-udr="pay:${esc(r.id)}">Timeline</button>`:""}
          ${r.ref&&isUpgRow(r.vendor)&&upgOn()?`<button class="pill" style="padding:3px 7px;border-left-color:#ea580c" data-udu="${esc(r.ref)}">⇄ UPG</button>`:""}
        </td></tr>`).join("")}</table>`;
    body.querySelectorAll("[data-udt]").forEach(b=>b.addEventListener("click",()=>{ $("#panelModal").classList.remove("open"); openTimeline(b.dataset.udt||null,false,b.dataset.udr); }));
    body.querySelectorAll("[data-udu]").forEach(b=>b.addEventListener("click",()=>window.opsUpgTrace(b.dataset.udu)));
  }
  const clipTxt=(s,n)=>{ s=String(s||""); return s.length>n?s.slice(0,n-1)+"…":s; };
  // Semati/Nafath failures grouped by provider code · message — clickable to filter the feed.
  async function renderCodeBreakdown(){
    const feed=$("#errFeed"); if(!feed||!feed.parentNode) return;
    let host=document.getElementById("codeBreak");
    const cfg=CODE_BREAKDOWN[errState.category];
    if(!cfg){ if(host){ host.style.display="none"; host.innerHTML=""; } return; }
    const cat=errState.category;
    if(!host){ host=document.createElement("div"); host.id="codeBreak"; feed.parentNode.insertBefore(host, feed); }
    host.style.display="block";
    let d; try{ d=await api(`/api/errors/code-breakdown?category=${encodeURIComponent(cat)}&window=${errState.window}${errState.sim?`&sim=${encodeURIComponent(errState.sim)}`:''}`); }
    catch(e){ host.style.display="none"; host.innerHTML=""; return; }
    if(errState.category!==cat){ return; }   // a faster tile switch won this race — leave that render's output
    // guard against an older backend that doesn't know this category yet (would echo a fallback set):
    // only render when the response's category matches what we asked for.
    if(d && d.category && d.category!==cat){ host.style.display="none"; host.innerHTML=""; return; }
    const codes=(d&&d.codes)||[], total=(d&&d.total)||0;
    if(!codes.length){ host.style.display="none"; host.innerHTML=""; return; }
    const col=CAT_COLOR[cat]||"#64748b";
    const chip=(codeVal,msg,count,active)=>{
      const pct=total?Math.round(count*100/total):0;
      const base=`display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;border:1px solid ${col}44;font-size:12px;cursor:pointer`;
      const style=active?`${base};background:${col};color:#fff`:`${base};background:${col}12;color:var(--ink)`;
      return `<button class="codechip" data-code="${esc(String(codeVal))}" title="${esc(msg||'')}" style="${style}"><b>${esc(String(codeVal))}</b><span style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(msg||'—')}</span><span style="opacity:.8;font-weight:700">${count} · ${pct}%</span></button>`;
    };
    const allBase=`padding:5px 10px;border-radius:999px;border:1px solid var(--line);font-size:12px;cursor:pointer;font-weight:700`;
    // BY GATEWAY chips (Payment tile only) — colour-coded UPG / HyperPay / Tap / Tamara / Emkan / Samsung Pay
    const gws=(cat==='payment' && d && d.gateways)?d.gateways:[];
    const gwChip=(g,count,active)=>{ const c=gwColor(g), pct=total?Math.round(count*100/total):0;
      const base=`display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;border:1px solid ${c}66;font-size:12px;cursor:pointer;font-weight:700`;
      return `<button class="gwchip" data-gw="${esc(g)}" style="${active?`${base};background:${c};color:#fff`:`${base};background:${c}1e;color:${c}`}"><b>${esc(g)}</b><span style="opacity:.85">${count} · ${pct}%</span></button>`; };
    const gwSection = gws.length ? `<div style="margin-top:9px;border-top:1px dashed ${col}44;padding-top:8px">`+
      `<div style="font-weight:800;font-size:11px;letter-spacing:.02em;color:${col};margin-bottom:6px">BY GATEWAY <span class="rl" style="font-weight:600">— which gateway the decline came from</span></div>`+
      `<div style="display:flex;flex-wrap:wrap;gap:6px"><button class="gwchip" data-gw="" style="${allBase};${!errState.gwFilter?'background:var(--ink);color:var(--bg)':'background:transparent;color:var(--muted)'}">All gateways</button>`+
      gws.map(g=>gwChip(g.gw,g.count,errState.gwFilter===g.gw)).join("")+`</div></div>` : '';
    host.innerHTML=`<div style="margin:10px 0;padding:10px 12px;border-radius:10px;border-left:4px solid ${col};background:var(--card2,rgba(148,163,184,.08))">`+
      `<div style="font-weight:800;font-size:12px;letter-spacing:.02em;color:${col};margin-bottom:7px">${cfg.title} <span class="rl" style="font-weight:600">(${total} in ${errState.window}h — click to filter)</span></div>`+
      `<div style="display:flex;flex-wrap:wrap;gap:6px">`+
      `<button class="codechip" data-code="" style="${allBase};${!errState.codeFilter?`background:var(--ink);color:var(--bg)`:`background:transparent;color:var(--muted)`}">All codes</button>`+
      codes.map(c=>chip(c.code,c.message,c.count,errState.codeFilter===String(c.code))).join("")+
      `</div>`+gwSection+`</div>`;
    host.querySelectorAll(".codechip").forEach(b=>b.addEventListener("click",()=>{ errState.codeFilter=b.dataset.code||""; if(window.audit) window.audit("APPLY_FILTER",`troubleshoot:${cat}_code:`+(b.dataset.code||"all")); saveErr(); loadErrors(); }));
    host.querySelectorAll(".gwchip").forEach(b=>b.addEventListener("click",()=>{ errState.gwFilter=b.dataset.gw||""; if(window.audit) window.audit("APPLY_FILTER",`troubleshoot:payment_gw:`+(b.dataset.gw||"all")); saveErr(); loadErrors(); }));
  }
  // BSS/Semati write-path health matrix (api × ok/fail/top-code) — shown on the Activation tile so you
  // can see, per BSS/Semati endpoint, what's succeeding (00/600) vs failing. Reads /api/errors/bss-breakdown.
  async function renderBssMatrix(){
    const feed=$("#errFeed"); if(!feed||!feed.parentNode) return;
    let host=document.getElementById("bssMatrix");
    if(errState.category!=='activation'){ if(host){ host.style.display="none"; host.innerHTML=""; } return; }
    if(!host){ host=document.createElement("div"); host.id="bssMatrix"; feed.parentNode.insertBefore(host, feed); }
    host.style.display="block";
    let d; try{ d=await api(`/api/errors/bss-breakdown?window=${errState.window}${errState.sim?`&sim=${encodeURIComponent(errState.sim)}`:''}`); }
    catch(e){ host.style.display="none"; host.innerHTML=""; return; }
    if(errState.category!=='activation'){ return; }
    const apis=(d&&d.apis)||[]; const col=CAT_COLOR['activation']||"#0e9f5a";
    if(!apis.length){ host.style.display="none"; host.innerHTML=""; return; }
    const pc=x=>x==null?"—":(x*100).toFixed(1)+"%";
    const rowH=a=>`<tr>
      <td style="padding:3px 10px 3px 0;font-family:var(--mono);font-size:11.5px;white-space:nowrap">${esc(a.api)}</td>
      <td style="padding:3px 8px;text-align:right;color:var(--good);font-weight:700">${a.ok}</td>
      <td style="padding:3px 8px;text-align:right;color:${a.fail?'#dc2626':'var(--muted)'};font-weight:700">${a.fail}</td>
      <td style="padding:3px 8px;text-align:right;font-weight:700;color:${a.failRate>=0.3?'#dc2626':a.failRate>0?'#d97706':'var(--muted)'}">${pc(a.failRate)}</td>
      <td style="padding:3px 0 3px 8px;font-family:var(--mono);font-size:11px;color:${col}">${a.topFailCode?esc(a.topFailCode):'—'}</td></tr>`;
    host.innerHTML=`<div style="margin:10px 0;padding:10px 12px;border-radius:10px;border-left:4px solid ${col};background:var(--card2,rgba(148,163,184,.08))">`+
      `<div style="font-weight:800;font-size:12px;letter-spacing:.02em;color:${col};margin-bottom:7px">BSS / SEMATI WRITE-PATH · api × status <span class="rl" style="font-weight:600">(${d.fails}/${d.total} failed · ${pc(d.failRate)} — activation_logs, ${errState.window}h)</span></div>`+
      `<table style="border-collapse:collapse;width:100%"><thead><tr style="color:var(--muted);font-size:10px;text-align:right">`+
        `<th style="text-align:left;padding:2px 10px 2px 0">API</th><th style="padding:2px 8px">OK</th><th style="padding:2px 8px">FAIL</th><th style="padding:2px 8px">FAIL%</th><th style="text-align:left;padding:2px 0 2px 8px">TOP CODE</th></tr></thead>`+
        `<tbody>${apis.map(rowH).join("")}</tbody></table>`+
      `<div class="rl" style="margin-top:6px;font-size:10px">Write-path (create-subscriber, provisioning, transfer-operator). BSS read-path 1500/OSB-382000 faults are in <code>logs.uil_logs</code> (not this replica) — see the runbook reference above.</div>`+
      `</div>`;
  }
  // Live OSB read-path fault panel (1500 / OSB-382000) from the integration log (logs.uil_logs, MySQL) —
  // a SEPARATE source from the replica. Shows total + per-minute frequency + top APIs when connected,
  // else a setup card. Only on the Activation tile. Reads /api/osb/faults.
  async function renderOsbPanel(){
    const feed=$("#errFeed"); if(!feed||!feed.parentNode) return;
    let host=document.getElementById("osbPanel");
    if(errState.category!=='activation'){ if(host){ host.style.display="none"; host.innerHTML=""; } return; }
    if(!host){ host=document.createElement("div"); host.id="osbPanel"; feed.parentNode.insertBefore(host, feed); }
    host.style.display="block";
    const col="#dc2626";
    let d; try{ d=await api(`/api/osb/faults?minutes=60`); }catch(e){ d={configured:false,error:e.message}; }
    if(errState.category!=='activation'){ return; }
    const wrap=inner=>`<div style="margin:10px 0;padding:10px 12px;border-radius:10px;border-left:4px solid ${col};background:rgba(220,38,38,.06)">`+
      `<div style="font-weight:800;font-size:12px;letter-spacing:.02em;color:${col};margin-bottom:7px">BSS READ-PATH · OSB SOAP FAULTS <span class="rl" style="font-weight:600">(1500 / OSB-382000 · live from logs.uil_logs)</span></div>${inner}</div>`;
    if(!d || d.configured===false){
      host.innerHTML=wrap(`<div style="font-size:12px;line-height:1.55">Not connected. These faults live in the OSB integration DB (<code>logs.uil_logs</code>, MySQL) — separate from the console replica. To show them live here, set on the console (get the real OSB/UIL MySQL host from the OSB/BSS team — not the FTTH server):<div style="font-family:var(--mono);font-size:11px;margin:6px 0;padding:8px 10px;background:var(--card2,rgba(148,163,184,.12));border-radius:6px">OSB_LOG_URL=mysql://user:pass@&lt;osb-mysql-host&gt;:3306/logs</div>(optional overrides: OSB_LOG_TABLE, OSB_LOG_TIME_COL, OSB_LOG_CODE_COL, OSB_LOG_API_COL, OSB_FAULT_CODE) then rebuild. Until then, query <code>logs.uil_logs</code> directly.${d&&d.error?`<div class="rl" style="margin-top:6px;color:${col}">${esc(d.error)}</div>`:''}</div>`);
      return;
    }
    if(d.ok===false){ host.innerHTML=wrap(`<div style="font-size:12px;color:${col}">OSB source configured but unreachable: ${esc(d.error||'error')}. Check VPN / credentials.</div>`); return; }
    const series=d.series||[], peak=d.peakPerMin||Math.max(1,...series.map(s=>s.count),1);
    const bars=series.slice(-40).map(s=>`<div title="${esc(s.t)}: ${s.count}" style="flex:1;min-width:2px;display:flex;flex-direction:column;justify-content:flex-end;height:100%"><div style="background:${col};height:${Math.round(s.count/peak*100)}%;min-height:1px;border-radius:2px 2px 0 0"></div></div>`).join("");
    const apis=(d.byApi||[]).slice(0,8);
    host.innerHTML=wrap(
      `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">`+
        `<div><div style="font-size:24px;font-weight:800;color:${col}">${d.total}</div><div class="rl" style="font-size:10px;text-transform:uppercase">faults · last ${d.minutes||60}m</div></div>`+
        `<div><div style="font-size:24px;font-weight:800">${peak}</div><div class="rl" style="font-size:10px;text-transform:uppercase">peak / min</div></div>`+
        `<div style="flex:1;min-width:220px"><div class="rl" style="font-size:10px;text-transform:uppercase;margin-bottom:2px">per-minute frequency</div><div style="display:flex;align-items:flex-end;gap:1px;height:52px">${bars||'<span class="rl">no faults in window ✓</span>'}</div></div>`+
      `</div>`+
      (apis.length?`<table style="border-collapse:collapse;width:100%"><thead><tr style="color:var(--muted);font-size:10px"><th style="text-align:left;padding:2px 10px 2px 0">TOP FAULTING API</th><th style="text-align:right;padding:2px 0">FAULTS</th></tr></thead><tbody>`+
        apis.map(a=>`<tr><td style="padding:2px 10px 2px 0;font-family:var(--mono);font-size:11.5px">${esc(a.api||'—')}</td><td style="padding:2px 0;text-align:right;font-weight:700;color:${col}">${a.count}</td></tr>`).join("")+`</tbody></table>`:'')+
      (d.sampleMessage?`<div class="rl" style="margin-top:6px;font-size:10px;font-family:var(--mono)">${esc(String(d.sampleMessage).slice(0,120))}</div>`:'')
    );
  }
  function syncErrRange(){ if(errState.pinned) return; const R=window.OPS_RANGE; if(R){ errState.window=R.hours; errState.sim=R.to||null; errState.rangeKey="range"; } }
  // dashboard-style quick window picker on the error board (local override of the global RANGE)
  function renderErrRange(){
    const host=document.getElementById("errRange"); if(!host) return;
    const ksaMid=()=>{ const s=new Date(Date.now()+3*3600e3); s.setUTCHours(0,0,0,0); return s.getTime()-3*3600e3; };
    const presets=[["range","Range"],["today","Today"],["yday","Yesterday"],["168","7d"],["720","30d"],["1","Last 1h"],["3","3h"],["6","6h"],["12","12h"],["24","24h"]];
    host.innerHTML=`<span class="rl" style="margin-right:4px">Window</span>`+presets.map(p=>`<button class="teamchip ${errState.rangeKey===p[0]?"active":""}" data-rk="${p[0]}">${p[1]}</button>`).join("");
    host.querySelectorAll("[data-rk]").forEach(b=>b.addEventListener("click",()=>{
      const k=b.dataset.rk; errState.rangeKey=k;
      if(k==="range"){ errState.pinned=false; }
      else { errState.pinned=true;
        if(k==="today"){ errState.window=Math.max(1,Math.ceil((Date.now()-ksaMid())/3600e3)); errState.sim=null; }
        else if(k==="yday"){ errState.window=24; errState.sim=new Date(ksaMid()).toISOString(); }
        else { errState.window=Number(k); errState.sim=null; } }
      saveErr();
      loadErrors();
    }));
  }
  async function loadErrors(){
    syncErrRange();
    renderErrRange();
    gwRegistry().catch(()=>{});                        // registry (which gateways are live) — gates the ⇄ UPG actions
    const simQ = errState.sim?`&sim=${encodeURIComponent(errState.sim)}`:'';
    let sum;
    try { sum = await api(`/api/errors/summary?window=${errState.window}${simQ}${errState.team?`&team=${encodeURIComponent(errState.team)}`:''}`); }
    catch(e){ $("#errKpis").innerHTML=""; $("#errFeed").innerHTML=`<div class="albanner">Error board needs the console API. ${esc(e.message)}</div>`; return; }
    $("#errNow").textContent = sum.now ? ("as of "+KT.dt(sum.now)+" KSA") : "real-time";
    let tiles = sum.summary||[];
    { // shared nav config: hide + reorder the error category tiles
      const en=(window.uiNav?window.uiNav().errors:{order:[],hidden:[]});
      const hidden=new Set(en.hidden||[]);
      if(hidden.size) tiles=tiles.filter(t=>!hidden.has(t.category));
      if(en.order&&en.order.length){ const idx=c=>{ const i=en.order.indexOf(c); return i<0?999:i; };
        tiles=tiles.slice().sort((a,b)=>idx(a.category)-idx(b.category)); }
    }
    const total = tiles.reduce((a,t)=>a+t.total,0);
    const totB = tiles.reduce((a,t)=>a+(t.business||0),0), totT = tiles.reduce((a,t)=>a+(t.technical||0),0);
    errState.hasCls = tiles.some(t=>t.business!=null || t.technical!=null);   // old backend → hide the split UI
    renderClsStrip(total, totB, totT);
    // "B x · T y" split line on each category tile (business = API said no · technical = API failed to answer)
    const tileSplit = t => (t.business==null && t.technical==null) ? '' :
      `<span style="font-size:10px;font-weight:800;letter-spacing:0;margin-top:2px" title="Business (API said no) · Technical (API failed to answer)"><span style="display:inline;color:${CLS_COLOR.business.c};margin:0">B ${(t.business||0).toLocaleString()}</span><span style="display:inline;color:var(--muted);margin:0"> · </span><span style="display:inline;color:${CLS_COLOR.technical.c};margin:0">T ${(t.technical||0).toLocaleString()}</span></span>`;
    $("#errKpis").innerHTML = `<div class="kpi ${errState.category===''?'active':''}" data-cat=""><b>${total}</b><span>ALL FAILURES · ${errState.window}h</span></div>`+
      tiles.map(t=>`<div class="kpi ${errState.category===t.category?'active':''}" data-cat="${t.category}" style="border-left:4px solid ${CAT_COLOR[t.category]||'#94a3b8'}"><span class="tm">${esc(t.team)}</span><b>${t.total}</b><span>${esc(t.label).toUpperCase()}</span>${tileSplit(t)}</div>`).join("");
    $("#errKpis").querySelectorAll(".kpi").forEach(k=>k.addEventListener("click",()=>{ errState.category=k.dataset.cat; errState.codeFilter=""; errState.gwFilter=""; reflectCatUrl(errState.category); saveErr(); loadErrors(); }));
    renderRunbookPanel(errState.category);   // L1 triage steps for the selected category
    renderCodeBreakdown();                   // Semati/Nafath/Payment/Activation code·message breakdown + filter
    renderUpgDeep();                         // UPG/payments deep-dive funnel (invoice-level truth) — payment tile only
    renderBssMatrix();                       // BSS/Semati write-path api × ok/fail matrix (Activation tile)
    renderOsbPanel();                        // live OSB read-path 1500/OSB-382000 faults (Activation tile)
    // team filter chips (+ Business/Technical class chips in their own sub-container)
    const teams=[...new Set((tiles.length?tiles:[]).map(t=>t.team))];
    const allTeams=["BSS Ops","Digital Ops","Sales Ops","OSS Ops"];
    $("#errTeamFilter").innerHTML = `<button class="teamchip ${errState.team===''?'active':''}" data-team="">All teams</button>`+
      allTeams.map(t=>`<button class="teamchip ${errState.team===t?'active':''}" data-team="${t}">${esc(t)}</button>`).join("")+
      `<span id="errClsFilter" style="display:flex;gap:8px;align-items:center;margin-left:auto"></span>`;
    $("#errTeamFilter").querySelectorAll(".teamchip[data-team]").forEach(c=>c.addEventListener("click",()=>{ errState.team=c.dataset.team; saveErr(); loadErrors(); }));
    renderClsChips();
    // feed
    let feed;
    try { feed = await api(`/api/errors/feed?window=${errState.window}${simQ}${errState.category?`&category=${errState.category}`:''}${errState.team?`&team=${encodeURIComponent(errState.team)}`:''}${errState.q?`&q=${encodeURIComponent(errState.q)}`:''}${errState.codeFilter?`&code=${encodeURIComponent(errState.codeFilter)}`:''}${errState.gwFilter?`&gw=${encodeURIComponent(errState.gwFilter)}`:''}${errState.clsFilter?`&cls=${errState.clsFilter}`:''}&limit=120`); }
    catch(e){ $("#errFeed").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    errState.lastFeed = feed.feed||[];
    renderErrFeed();
  }
  // 3-way strip above the tiles: All failures / Business (API said no) / Technical (API failed to answer)
  function renderClsStrip(total, totB, totT){
    let strip=document.getElementById("errClsStrip");
    const kp=$("#errKpis"); if(!kp||!kp.parentNode) return;
    if(!strip){ strip=document.createElement("div"); strip.id="errClsStrip"; kp.parentNode.insertBefore(strip, kp); }
    if(!errState.hasCls){ strip.style.display="none"; strip.innerHTML=""; return; }
    strip.style.cssText="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px";
    strip.innerHTML =
      `<div class="kpi" style="cursor:default"><b>${total.toLocaleString()}</b><span>ALL FAILURES · ${errState.window}h</span></div>`+
      `<div class="kpi" style="cursor:default;border-left:4px solid ${CLS_COLOR.business.c};background:${CLS_COLOR.business.bg}"><b style="color:${CLS_COLOR.business.c}">${totB.toLocaleString()}</b><span style="color:${CLS_COLOR.business.c}">BUSINESS — API SAID NO (EXPECTED)</span></div>`+
      `<div class="kpi" style="cursor:default;border-left:4px solid ${CLS_COLOR.technical.c};background:${CLS_COLOR.technical.bg}"><b style="color:${CLS_COLOR.technical.c}">${totT.toLocaleString()}</b><span style="color:${CLS_COLOR.technical.c}">TECHNICAL — API FAILED TO ANSWER</span></div>`;
  }
  // [All | Business | Technical] chips — filter the visible feed rows CLIENT-SIDE by err_class
  function renderClsChips(){
    const host=document.getElementById("errClsFilter"); if(!host) return;
    if(!errState.hasCls){ host.innerHTML=""; return; }
    const mk=(k,l)=>{ const col=k?CLS_COLOR[k].c:null; const act=errState.clsFilter===k;
      const style=col?(act?`background:${col};border-color:${col};color:#fff`:`border-color:${col}66;color:${col}`):'';
      return `<button class="teamchip clschip ${act?'active':''}" data-cls="${k}" style="${style}">${l}</button>`; };
    host.innerHTML = `<span class="rl" style="font-weight:700">Class</span>`+mk("","All")+mk("business","Business")+mk("technical","Technical");
    host.querySelectorAll(".clschip").forEach(b=>b.addEventListener("click",()=>{
      errState.clsFilter=b.dataset.cls||"";
      if(window.audit) window.audit("APPLY_FILTER","troubleshoot:class:"+(b.dataset.cls||"all"));
      /* Was: renderErrFeed() only, filtering the rows already in memory. That is why "Technical"
       * showed 2 rows out of 23 — the 120 fetched rows were almost all business, so the rare class
       * was already gone before the filter ran. The server now applies the class, so the chip has
       * to go and ask for the right rows. */
      saveErr(); renderClsChips();
      loadErrors();
    }));
  }
  // feed table render (client-side err_class filter applied here so chip clicks don't refetch)
  function renderErrFeed(){
    const all = errState.lastFeed||[];
    const rows = errState.clsFilter ? all.filter(r=>r.err_class===errState.clsFilter) : all;
    if(!rows.length){ $("#errFeed").innerHTML=`<div class="okbox" style="margin-top:8px">No failures match — try a wider window or clear filters.</div>`; return; }
    let h=`<table class="alerts"><tr><th>WHEN</th><th>CATEGORY</th><th>TEAM</th><th>IDENTIFIER</th><th>MOBILE</th><th>DETAIL</th><th></th></tr>`;
    rows.forEach(r=>{
      // order UUID is non-PII; identifier field is masked by the server for other ids
      const idShow = (r.order_id && /^[0-9a-f-]{8,}$/i.test(r.order_id)) ? r.order_id.slice(0,8)+'…' : (r.identifier||'—');
      h+=`<tr>
      <td class="mono" style="color:var(--muted);white-space:nowrap">${fmtTs(r.when)}</td>
      <td><span class="catpill" style="background:${(CAT_COLOR[r.category]||'#64748b')}22;color:${CAT_COLOR[r.category]||'#334155'}">${esc(r.category)}</span>${clsBadge(r.err_class, r.err_reason)}</td>
      <td>${esc(r.team)}</td>
      <td class="mono" style="font-size:10.5px">${esc(idShow)}</td>
      <td class="mono">${esc(r.mobile||'—')}</td>
      <td style="font-size:12px">${r.gw?gwBadge(r.gw):''}${esc(r.detail||'')}</td>
      <td style="white-space:nowrap"><button class="pill" data-row="${esc(r.id||'')}" data-oid="${esc(r.order_id||'')}" style="padding:4px 10px">Timeline →</button>${
        ((r.category==='payment'||r.category==='payment_stuck')&&r.ref&&isUpgRow(r.gw)&&upgOn())?` <button class="pill" data-upg="${esc(r.ref)}" style="padding:4px 8px;border-left-color:#ea580c" title="UPG gateway side: every charge attempt on this invoice + state transitions (UPG rows only)">⇄ UPG</button>`:''}</td>
    </tr>`; });
    h+=`</table>`;
    $("#errFeed").innerHTML=h;
    $("#errFeed").querySelectorAll("[data-row]").forEach(b=>b.addEventListener("click",()=>openTimeline(b.dataset.oid||null, false, b.dataset.row)));
    $("#errFeed").querySelectorAll("[data-upg]").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); window.opsUpgTrace(b.dataset.upg); }));
  }

  // ================= TRANSACTION TIMELINE DRAWER =================
  async function openTimeline(id, unmask=false, row=null, onBack=null, nav=null, opts=null){
    if(window.audit) window.audit(unmask?"VIEW_TRACE_UNMASKED":"VIEW_TRACE", String(row||id||"").slice(0,60));
    const ov=$("#txnDrawer"); ov.classList.add("open");
    const key = row ? `row=${encodeURIComponent(row)}`
      : String(id||'').startsWith('dms:') ? `dmsrow=${encodeURIComponent(String(id).slice(4))}`
      : `id=${encodeURIComponent(id||'')}`;
    const backBtn = onBack?`<button id="dwBack" style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.45);border-radius:8px;color:#fff;font-size:12px;font-weight:700;padding:4px 12px;cursor:pointer;margin-right:12px">‹ Back to list</button>`:'';
    const wireBack=()=>{ if(onBack){ const bb=document.getElementById("dwBack"); if(bb) bb.onclick=()=>onBack(); } };
    $("#txnDrawerBody").innerHTML=`<div class="drawer-hd">${backBtn}<b>Transaction timeline</b><span class="x" id="dwX">×</span></div><div class="tl">${salamLoader("Assembling the end-to-end timeline…<br><b>scanning payments · activation · Nafath · delivery · change plans</b>")}</div>`;
    $("#dwX").onclick=()=>ov.classList.remove("open"); wireBack();
    let tl;
    const extra = opts && opts.lineRef ? `&line=${encodeURIComponent(opts.lineRef)}` : "";
    try { tl=await api(`/api/transaction?${key}${unmask?'&unmask=1':''}${extra}`); }
    catch(e){ $("#txnDrawerBody").querySelector(".tl").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const o=tl.order;
    const events = Array.isArray(tl.events) ? tl.events : [];
    const fails = events.filter(e=>e.ok===false).length, oks = events.filter(e=>e.ok===true).length, pend = events.filter(e=>e.ok==null).length;
    /* live toggle (31 Aug): the old static "PII visible" chip LOOKED unmasked while data was
       masked — now it is a real button on the global PII switch, and reopening refetches. */
    const unmaskBtn = can("unmaskPII")
      ? `<button class="pill" id="dwPii" style="padding:3px 10px;font-size:11px;${window.opsPiiUnmask()?'border-left-color:#dc2626':''}">${window.opsPiiUnmask()?'🔓 Unmasked — hide':'🔒 Masked — reveal'}</button>`
      : `<span class="rl" style="align-self:center">🔒 PII masked</span>`;
    const navBtn=(idb,lbl,en)=>`<button id="${idb}" ${en?'':'disabled'} style="background:rgba(255,255,255,${en?'.16':'.06'});border:1px solid rgba(255,255,255,${en?'.45':'.18'});border-radius:8px;color:${en?'#fff':'rgba(255,255,255,.4)'};font-size:12px;font-weight:700;padding:4px 12px;cursor:${en?'pointer':'default'}">${lbl}</button>`;
    const navHtml=nav?`<span style="display:inline-flex;align-items:center;gap:7px;margin-right:12px">${navBtn('dwPrev','‹ Prev',!!nav.onPrev)}<span style="color:#fff;font-size:11.5px;font-weight:700">${esc(nav.pos||'')}</span>${navBtn('dwNext','Next ›',!!nav.onNext)}</span>`:'';
    let h=`<div class="drawer-hd">${backBtn}${navHtml}<b>Transaction timeline</b><span class="x" id="dwX2">×</span></div>
      <div style="padding:14px 18px;border-bottom:1px solid var(--line)">
        <div class="mono" style="font-size:12px">id: ${esc(tl.identifier)||'—'}</div>
        ${o?`<div style="font-size:12.5px;margin-top:6px"><b>Order</b> ${esc(o.id)} · state <span class="catpill">${esc(o.aasm_state)}</span> · plan ${esc(o.plan_id)} · completed ${esc(o.completed)} · activated ${esc(o.activated)}<br>
          <span style="color:var(--muted)">mobile ${esc(o.mobile_number)} · nid ${esc(o.nationality_id_number)}${o.customer_name?' · '+esc(o.customer_name):''}</span></div>`
          :`<div style="color:var(--muted);font-size:12.5px;margin-top:6px">No onboarding order resolved for this identifier — showing related events.</div>`}
        <div style="margin-top:8px;font-size:11.5px;color:var(--muted)">${events.length} event${events.length===1?'':'s'}${events.length?` · <span style="color:var(--good)">${oks} ok</span> · <span style="color:#dc2626">${fails} failed</span>${pend?` · <span style="color:#d97706">${pend} in-progress</span>`:''}`:''}</div>
        ${(()=>{ const c=tl.customer; if(!c) return "";
          if(!c.registered) return `<div style="margin-top:7px;font-size:11.5px"><span style="background:#94a3b822;color:var(--muted);border-radius:6px;padding:1px 8px;font-weight:700">NOT REGISTERED</span> <span class="rl">no app account for this mobile — journey ran without login (dealer/web checkout)</span></div>`;
          const ago=t=>{ if(!t) return "never"; const m=Math.round((Date.now()-new Date(t).getTime())/60000);
            return m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`; };
          return `<div style="margin-top:7px;font-size:11.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${c.logged_in?`<span style="background:#10b98122;color:#0e9f5a;border-radius:6px;padding:1px 8px;font-weight:700" title="last login within 7 days — the app's JWT session token is still valid">LOGGED IN</span>`
                         :`<span style="background:#94a3b822;color:var(--muted);border-radius:6px;padding:1px 8px;font-weight:700" title="last login older than the 7-day JWT lifetime — no live app session">NOT LOGGED IN</span>`}
            <span class="rl">last login <b>${ago(c.last_login_at)}</b>${c.last_login_at?` <span class="mono" style="color:var(--muted)">(${esc(KT.dt(c.last_login_at))}Z)</span>`:""}
              · ${esc(c.platform||"?")}${c.app_version?" v"+esc(c.app_version):""} · ${c.sign_in_count} login${c.sign_in_count===1?"":"s"}
              ${c.verified?` · <span style="color:#0e9f5a">verified</span>`:` · <span style="color:#d97706">unverified</span>`}</span></div>`; })()}
        <div style="margin-top:10px;display:flex;align-items:center;flex-wrap:wrap;gap:8px">${unmaskBtn}
          ${events.length?`<button class="pill" id="dwApigwWin" style="padding:3px 10px;font-size:11px;border-left-color:#3b82f6" title="What the API gateway saw during this order's time window (per-endpoint latency + every error/slow call)">⇄ APIGW activity in this window</button>`:''}
          ${tl.identifier?`<button class="pill" id="dwSmsLink" style="padding:3px 10px;font-size:11px;border-left-color:#8b5cf6" title="Every OTP/SMS sent to this identifier — channel, verify status, template text (TKT-000008)">✉ SMS details</button>`:''}
          <div id="dwSmsBox" style="flex-basis:100%"></div>
        </div>
      </div>
      <div class="tl">`;
    // TKT-000016: server may resolve a reference-shaped search (trace id / payment uuid / gateway
    // ref) and explain itself — surface that note instead of a bare "no events".
    if(tl.note) h+=`<div class="okbox" style="border-left:3px solid var(--amber,#d97706)">${esc(tl.note)}</div>`;
    // Phase 2 (3 Sep): a reference shaped like a DMS app-log id (16-hex Sleuth trace / UIL txn
    // uuid) can be grepped live on the 4 DMS nodes. Explicit button — never automatic (SSH fan-out).
    if(tl.logref) h+=`<div class="okbox" style="border-left:3px solid #3b82f6"><b>⛏ DMS application logs</b> — search this reference directly on the DMS app nodes (retention ≈ 7 days).
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
        <button class="pill" id="dwDmsLog" data-ref="${esc(tl.logref)}" style="padding:3px 10px;font-size:11px;border-left-color:#3b82f6">Search current logs (fast)</button>
        <input id="dwDmsLogDate" type="date" style="font-size:11px;padding:2px 4px;border:1px solid var(--line,#e2e8f0);border-radius:6px">
        <span class="rl">set the request date to deep-search that day&rsquo;s rotated logs too (~1&ndash;2 min)</span>
      </div><div id="dwDmsLogOut" style="margin-top:8px"></div></div>`;
    if(tl.reference&&tl.reference.known_case) h+=`<div class="okbox"><b>${esc(tl.reference.known_case.title)}</b> · ${esc(tl.reference.known_case.classification)}<br>${esc(tl.reference.known_case.explanation)}<br><b>Action:</b> ${esc(tl.reference.known_case.action)}</div>`;
    if(!events.length&&!tl.note) h+=`<div class="okbox">No events found for this identifier in the current data window.</div>`;
    // ⇄ APIGW: any event whose request/response carries a transaction id can be traced end-to-end
    // (app call ⇄ gateway hops ⇄ uil_logs payloads) via the Case analyzer — same contract as ⇄ UPG.
    const findTxn=(o,depth)=>{ if(o==null||(depth||0)>4) return null;
      if(typeof o==="object"){ for(const k of Object.keys(o)){ const v=o[k];
        if(/^(uil[_-]?)?(transaction|txn)[_-]?id$/i.test(k)&&typeof v==="string"&&/^[\w.-]{6,64}$/.test(v)
           &&!/^(chg|pay|inv|src|tok|auth|ref|card|req)_/i.test(v))   // Tap/UPG object ids → that's ⇄ UPG, not APIGW
          return v;
        const r=findTxn(v,(depth||0)+1); if(r) return r; } }
      return null; };
    events.forEach((e,ix)=>{
      const dot = e.ok===true?'okdot':e.ok===false?'faildot':'neutdot';
      const hasRR = e.request!=null || e.response!=null;
      const txn = findTxn(e.request)||findTxn(e.response);
      // courier wire trace: the delivery event's DB summary is NOT the real exchange — the true
      // createOrder request/response lives in sidekiq.log; the button fetches it by reference id
      const courierRef = e.source==="delivery_requests"
        ? ((e.request&&(e.request.orderId_we_sent||e.request.internal_reference_id||e.request.external_reference_id))
           ||(e.response&&e.response.courier_shipment_id)||null) : null;
      h+=`<div class="tlitem"><span class="dot ${dot}"></span>
        <div class="src">${esc(e.source)} · ${esc(e.kind)}${e.ms!=null?` <span class="tl-ms">${esc(e.ms)} ms</span>`:''}</div>
        <div class="dt">${esc(e.detail)}</div>
        ${e.endpoint?`<div class="tl-ep mono">${window.otoDoc&&window.otoDoc.ready()?window.otoDoc.linkify(esc(e.endpoint)):esc(e.endpoint)}${(e.status!=null&&e.status!=='')?` · <b>${esc(e.status)}</b>`:''}</div>`:''}
        ${hasRR?`<button class="tl-rrbtn" data-rr="${ix}">req / res ▾</button>`:''}
        ${courierRef?`<button class="tl-rrbtn" data-courier="${esc(courierRef)}" title="The REAL request/response exchanged with the courier (from sidekiq.log on the API hosts)" style="border-color:#0d9488;color:#0d9488">⇄ Courier wire</button>`:''}
        ${txn?`<button class="tl-rrbtn" data-gwtxn="${esc(txn)}" title="Trace this call end-to-end: app ⇄ APIGW hops ⇄ UIL request/response" style="border-color:#3b82f6;color:#3b82f6">⇄ APIGW</button>`:''}
        ${hasRR?`<div class="tl-rr" id="tlrr_${ix}" hidden></div>`:''}
        <div class="ts">${fmtTs(e.at, true)}</div></div>`;
    });
    h+=`</div>`;
    $("#txnDrawerBody").innerHTML=h;
    $("#dwX2").onclick=()=>ov.classList.remove("open"); wireBack();
    // LAZY req/res rendering — jsonHi over full stored payloads (BSS responses, callbacks) is
    // the expensive part of drawer paint; with dozens of events it froze the open. Now the
    // drawer paints instantly and each block is highlighted only on first expand.
    $("#txnDrawerBody").querySelectorAll(".tl-rrbtn[data-rr]").forEach(b=>b.addEventListener("click",()=>{
      const box=$("#tlrr_"+b.dataset.rr); if(!box) return;
      const open=box.hasAttribute("hidden");
      if(open && !box.dataset.l){
        const ev=events[Number(b.dataset.rr)]||{};
        box.innerHTML=(ev.request!=null?`<div class="tl-rrlabel">${esc((ev.rr&&ev.rr.req)||"REQUEST")}</div><div class="codeblk">${jsonHi(ev.request)}</div>`:"")
          +(ev.response!=null?`<div class="tl-rrlabel">${esc((ev.rr&&ev.rr.res)||"RESPONSE")}</div><div class="codeblk">${jsonHi(ev.response)}</div>`:"");
        box.dataset.l="1";
      }
      if(open) box.removeAttribute("hidden"); else box.setAttribute("hidden","");
      b.innerHTML = (open?"req / res ▴":"req / res ▾");
    }));
    // ⇄ APIGW window: gateway picture for this order's exact lifetime (±2 min padding)
    const dp=$("#dwPii"); if(dp) dp.addEventListener("click",()=>{
      window.opsSetPiiUnmask(!window.opsPiiUnmask());
      openTimeline(id, false, row, onBack, nav, opts);         // refetch — wrapper appends unmask=1 when ON
    });
    if(nav){ const pv=$("#dwPrev"), nx=$("#dwNext");
      if(pv&&nav.onPrev) pv.onclick=()=>nav.onPrev();
      if(nx&&nav.onNext) nx.onclick=()=>nav.onNext(); }
    const wb=$("#dwApigwWin"); if(wb) wb.addEventListener("click",()=>{
      const ts=events.map(e=>new Date(e.at).getTime()).filter(Number.isFinite);
      if(!ts.length) return;
      const from=new Date(Math.min(...ts)-120000).toISOString(), to=new Date(Math.max(...ts)+120000).toISOString();
      if(window.audit) window.audit("APIGW_WINDOW", `${tl.identifier||''} ${from}→${to}`.slice(0,80));
      openApigwWindow(from,to);
    });
    /* TKT-000008 — SMS details inline: /api/sms/search for this identifier (OTP rows, channel,
     * verified?, template text). Toggle open/closed; results stay masked per the PII rules. */
    const sb=$("#dwSmsLink"); if(sb) sb.addEventListener("click", async ()=>{
      const box=$("#dwSmsBox"); if(!box) return;
      if(box.innerHTML){ box.innerHTML=""; return; }
      box.innerHTML=`<div class="rl" style="margin-top:6px">Loading SMS…</div>`;
      try{
        // same id/row/dmsrow the timeline was opened with — the server resolves the subscriber
        // (tl.identifier is MASKED here by design and must never be echoed back as a query)
        const d=await api(`/api/transaction/sms?${key}&limit=20`);
        const rows=d.rows||[];
        if(!rows.length){ box.innerHTML=`<div class="rl" style="margin-top:6px">${esc((d.notes||[]).join(' · ')||'No OTP/SMS records for this identifier.')}</div>`; return; }
        box.innerHTML=`<div style="margin-top:8px;border:1px solid var(--line);border-radius:8px;max-height:220px;overflow:auto"><table class="alerts" style="font-size:11.5px">
          <tr><th>SENT (KSA)</th><th>CHANNEL</th><th>TYPE</th><th>STATUS</th><th>MESSAGE</th></tr>
          ${rows.map(r=>`<tr><td class="mono">${esc(KT.dt(r.sent_at))}</td><td>${esc(r.channel||'—')}</td><td>${esc(r.message_type||'—')}</td>
            <td style="font-weight:700;color:${r.status==='verified'?'var(--good)':/expired|fail/.test(r.status||'')?'#dc2626':'#d97706'}">${esc(r.status||'—')}</td>
            <td style="max-width:380px">${esc(r.body_en||r.body_note||'')}</td></tr>`).join('')}
        </table></div>`;
      }catch(e){ box.innerHTML=`<div class="rl" style="margin-top:6px;color:#dc2626">${esc(e.message)}</div>`; }
    });
    /* Phase 2 (3 Sep) — DMS app-log reference search: SSH grep on the 4 DMS nodes, staged
     * (current logs fast; +date = that day's rotated gz). Shared UI — also used by the Case
     * analyzer modal. Results are server-cached (dated searches are immutable), so repeats
     * and Yusr→drawer cross-checks return instantly. */
    window._dmsLogResultHtml=window._dmsLogResultHtml||function(d){
      let hh="";
      if(!d.total_hits){ hh+=`<div class="rl" style="color:#d97706">${esc(d.note||"No match in the searched window.")}</div>`; }
      else{
        const fileRows=(d.hosts||[]).flatMap(hst=>(hst.files||[]).map(f=>`<tr><td class="mono">${esc(hst.host)}</td><td>${esc(f.service||"—")}</td><td class="mono" style="font-size:10.5px">${esc((f.file||"").split("/").pop())}</td><td style="font-weight:700">${f.hits}</td></tr>`));
        hh+=`<div class="rl"><b>${d.total_hits}</b> matching line(s) · ${esc(d.scope||"")} · ${d.ms}ms${d.cached?` · <span style="color:var(--good);font-weight:700">served from cache</span>`:""}</div>
          <div style="border:1px solid var(--line);border-radius:8px;max-height:140px;overflow:auto;margin-top:4px"><table class="alerts" style="font-size:11px">
          <tr><th>NODE</th><th>SERVICE</th><th>FILE</th><th>HITS</th></tr>${fileRows.join("")}</table></div>`;
        if((d.hops||[]).length){
          hh+=`<div class="rl" style="margin-top:6px"><b>What the logs say happened</b></div>
            <div style="border:1px solid var(--line);border-radius:8px;max-height:200px;overflow:auto;margin-top:4px"><table class="alerts" style="font-size:11px">
            <tr><th>HOP</th><th>CALL</th><th>RESULT</th><th>MS</th></tr>
            ${d.hops.map(hp=>{const bad=hp.response_code&&!/^(00|0|200|600)$/.test(String(hp.response_code));
              return `<tr><td>${esc(hp.kind)}</td><td class="mono" style="font-size:10.5px;max-width:280px;overflow:hidden">${esc((hp.url||"").replace(/^https?:\/\//,""))}</td>
              <td style="font-weight:700;color:${bad?"#dc2626":"#16a34a"}">${esc(hp.response_code||hp.status||"—")}${hp.response_message?" · "+esc(hp.response_message):""}</td>
              <td class="mono">${esc(hp.ms||"—")}</td></tr>`;}).join("")}</table></div>`;
        }
        if((d.uil_transaction_ids||[]).length) hh+=`<div class="rl" style="margin-top:6px">UIL transaction id(s): ${d.uil_transaction_ids.map(t=>`<code>${esc(t)}</code>`).join(" · ")} — paste one in Troubleshoot search for the gateway ⇄ uil_logs tiers.</div>`;
        const rawAll=(d.hosts||[]).filter(x=>(x.lines||[]).length).map(x=>`== ${x.host} ==\n${x.lines.join("\n")}${x.ctx?`\n-- context --\n${x.ctx}`:""}`).join("\n\n");
        if(rawAll) hh+=`<details style="margin-top:6px"><summary class="rl" style="cursor:pointer">Raw log lines (as on the nodes)</summary><pre style="font-size:10px;max-height:260px;overflow:auto;white-space:pre-wrap">${esc(rawAll.slice(0,20000))}</pre></details>`;
      }
      if(d.errors) hh+=`<div class="rl" style="color:#dc2626;margin-top:4px">Node errors: ${esc(d.errors.join(" · "))}</div>`;
      return hh;
    };
    window._dmsLogRun=window._dmsLogRun||async function(btn, dateEl, out){
      if(!out||!btn) return;
      const ref=btn.dataset.ref, date=(dateEl&&dateEl.value)||"";
      btn.disabled=true;
      out.innerHTML=`<div class="rl">⏳ Searching ${date?`current logs + rotated files of ${esc(date)}`:"current logs"} on the DMS nodes… ${date?"(deep search — up to ~1 min; instant if cached)":""}</div>`;
      try{
        const d=await api(`/api/apigw/logref/${encodeURIComponent(ref)}${date?`?date=${encodeURIComponent(date)}`:""}`);
        if(d.error||d.ok===false){ out.innerHTML=`<div class="rl" style="color:#dc2626">${esc(d.error||"search failed")}</div>`; return; }
        out.innerHTML=window._dmsLogResultHtml(d);
      }catch(e){ out.innerHTML=`<div class="rl" style="color:#dc2626">${esc(e.message)}</div>`; }
      finally{ btn.disabled=false; btn.textContent=date?"Search again":"Search current logs (fast)"; }
    };
    const dlb=$("#dwDmsLog"); if(dlb) dlb.addEventListener("click", ()=>window._dmsLogRun(dlb, $("#dwDmsLogDate"), $("#dwDmsLogOut")));
    $("#txnDrawerBody").querySelectorAll("[data-courier]").forEach(b=>b.addEventListener("click",()=>{
      openCourierTrace(b.dataset.courier);
    }));
    $("#txnDrawerBody").querySelectorAll("[data-gwtxn]").forEach(b=>b.addEventListener("click",()=>{
      if(window.audit) window.audit("APIGW_TXN_DRILL","timeline:"+b.dataset.gwtxn.slice(0,40));
      // the timeline drawer sits at z-210, above the modal's z-200 — lift the analyzer modal
      // above it for this open only, and self-reset when it closes (drawer stays underneath)
      const pm=document.getElementById("panelModal");
      if(pm){ pm.style.zIndex="300";
        const obs=new MutationObserver(()=>{ if(!pm.classList.contains("open")){ pm.style.zIndex=""; obs.disconnect(); } });
        obs.observe(pm,{attributes:true,attributeFilter:["class"]}); }
      if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(b.dataset.gwtxn);
    }));
    const ub=$("#dwUnmask"); if(ub) ub.onclick=()=>openTimeline(id, !unmask, row, onBack, nav, opts);   // preserve row + back so unmask re-resolves the same txn
  }
  /* Courier wire trace — the REAL exchange with the delivery partner (OTO/SMSA/Barq/…), fetched
   * on demand from sidekiq.log on the API hosts. Every courier client logs its full HTTP
   * conversation there (HTTParty debug_output); the delivery_requests row is only a summary.
   * Auth tokens are redacted server-side; PII masked per role; every view audited. */
  async function openCourierTrace(ref){
    const card=$("#panelModalCard"); const pm=$("#panelModal");
    pm.style.zIndex="300";
    const obs=new MutationObserver(()=>{ if(!pm.classList.contains("open")){ pm.style.zIndex=""; obs.disconnect(); } });
    obs.observe(pm,{attributes:true,attributeFilter:["class"]});
    card.innerHTML=`<div class="modal-head"><span class="path">Courier wire · ${esc(ref)}</span><span class="x" id="cwX">×</span></div>
      <div class="modal-body">${window.salamLoader?window.salamLoader("Reading sidekiq.log on the API hosts…<br><b>exact-match search, newest 300MB</b>"):"Loading…"}</div>`;
    pm.classList.add("open");
    $("#cwX").onclick=()=>pm.classList.remove("open");
    let d; try{ d=await api(`/api/delivery/trace?ref=${encodeURIComponent(ref)}${can("unmaskPII")?"&unmask=1":""}`); }
    catch(e){ card.querySelector(".modal-body").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    let h="";
    if(d.db){ const r=d.db;
      h+=`<div class="rl" style="margin-bottom:8px"><b>${esc(r.vendor||"courier")}</b> · state <span class="mono">${esc(r.delivery_state||"—")}</span>
        · our order <span class="mono">${esc(r.internal_reference_id||"—")}</span> · courier id <span class="mono">${esc(r.external_reference_id||"—")}</span>
        · created ${esc(KT.dt(r.created_at||""))}${r.delivered_at?` · delivered ${esc(KT.dt(r.delivered_at))}`:""}</div>`; }
    const L=d.log||{};
    if(!L.configured){ h+=`<div class="rl">Wire trace needs the SSH log channel (API_LOG_HOSTS) — not configured.</div>`; }
    else if(L.error){ h+=`<div class="albanner">${esc(L.error)}</div>`; }
    else if(!(L.entries||[]).length){ h+=`<div class="rl" style="color:var(--muted)">${esc(L.note||"No wire lines found.")}</div>`; }
    else {
      h+=`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-bottom:8px">SOURCE OF TRUTH: ${esc(L.source||"sidekiq.log")} · host ${esc(L.host||"")} · matched: ${(L.refs||[]).map(x=>`<span class="mono">${esc(x)}</span>`).join(" · ")} · Bearer tokens redacted server-side</div>`;
      if(L.exchange_found) h+=`<div class="rl" style="font-size:11px;margin-bottom:8px"><b style="color:#0d9488">THE createOrder EXCHANGE</b> — one request, one response, isolated from the log${L.hidden?` · <span style="color:var(--muted)">${L.hidden} unrelated log fragments hidden (token refresh, adjacent workers)</span>`:""}</div>`;
      else h+=`<div class="rl" style="font-size:11px;margin-bottom:8px;color:#d97706">Could not isolate a single createOrder exchange — showing the raw matches (the createOrder may be older than the searched log window; only callbacks/workers reference this shipment now).</div>`;
      const K={request:["#3b82f6","REQUEST →"],request_body:["#3b82f6","REQUEST BODY →"],response_status:["#16a34a","← RESPONSE"],response_body:["#16a34a","← RESPONSE BODY"],worker_event:["#7c3aed","WORKER EVENT"]};
      const oln=t=>window.otoDoc&&window.otoDoc.ready()?window.otoDoc.linkify(t):t;   // /rest/v2/* → doc links
      (L.entries||[]).forEach(en=>{ const [c,label]=K[en.kind]||["#64748b",en.kind.toUpperCase()];
        h+=`<div style="border:1px solid var(--line);border-left:3px solid ${c};border-radius:8px;background:var(--card);padding:7px 10px;margin-bottom:6px">
          <div style="font-size:10px;font-weight:800;color:${c};letter-spacing:.04em">${esc(label)}${en.host?` <span class="mono" style="color:var(--muted);font-weight:600">· ${esc(en.host)}</span>`:""}</div>
          ${en.line?`<div class="mono" style="font-size:11px;margin-top:3px">${oln(esc(en.line))}</div>`:""}
          ${en.body?`<div class="jt-wrap" style="margin-top:4px">${jsonTree(en.body,null,0)}</div>`:""}
          ${en.text?`<pre class="mono" style="font-size:10.5px;white-space:pre-wrap;word-break:break-all;margin:4px 0 0;max-height:170px;overflow:auto">${esc(en.text)}</pre>`:""}</div>`; });
    }
    h+=`<div class="rl" style="margin-top:8px;font-size:10.5px;color:var(--muted)">Field map (from the app's courier client): request <span class="mono">orderId</span> = our internal_reference_id · response/callback <span class="mono">otoId</span> = external_reference_id · request <span class="mono">ref1</span> = the customer's NATIONALITY ID (not a shipment ref).</div>`;
    card.querySelector(".modal-body").innerHTML=h;
    if(window.audit) window.audit("DELIVERY_TRACE_UI", String(ref).slice(0,40));
  }

  /* Gateway activity for a time window — endpoint league + every error/slow span while an order
   * was moving. Opens above the timeline drawer; spans with a UIL txn id chain into the analyzer. */
  async function openApigwWindow(from,to){
    const card=$("#panelModalCard");
    const pm=$("#panelModal");
    pm.style.zIndex="300";
    const obs=new MutationObserver(()=>{ if(!pm.classList.contains("open")){ pm.style.zIndex=""; obs.disconnect(); } });
    obs.observe(pm,{attributes:true,attributeFilter:["class"]});
    const lbl=`${KT.dts(from)} → ${KT.t(to, true)} KSA`;
    card.innerHTML=`<div class="modal-head"><span class="path">APIGW activity · ${esc(lbl)}</span><span class="x" id="gwWinX">×</span></div>
      <div class="modal-body">${window.salamLoader?window.salamLoader("Reading gateway traces…"):"Loading…"}</div>`;
    pm.classList.add("open");
    $("#gwWinX").onclick=()=>pm.classList.remove("open");
    let d; try{ d=await api(`/api/apigw/window?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
    catch(e){ card.querySelector(".modal-body").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    if(!d.configured){ card.querySelector(".modal-body").innerHTML=`<div class="rl">Gateway trace collector not configured (ZIPKIN_HOSTS).</div>`; return; }
    let h="";
    const eps=d.endpoints||[];
    if(!eps.length&&!(d.slow||[]).length){
      h=`<div class="rl">No gateway data stored for this window — the collector went live 17 Aug 2026 ~21:38 KSA; earlier windows predate capture.</div>`;
    } else {
      const pCol=v=>v==null?"":v>=3000?"color:#dc2626;font-weight:700":v>=1000?"color:#d97706;font-weight:700":"";
      h+=`<div style="font-weight:800;font-size:12px;margin:0 0 4px">ENDPOINTS ACTIVE IN THIS WINDOW <span class="rl" style="font-weight:600;color:var(--muted)">· errors first · what the gateway processed while this order moved</span></div>
        <table class="alerts"><tr><th>SERVICE</th><th>ENDPOINT</th><th>CALLS</th><th>ERRORS</th><th>P95 ms</th><th>MAX ms</th></tr>
        ${eps.map(r=>`<tr><td class="rl">${esc(r.service)}</td>
          <td class="mono" style="word-break:break-all">${r.method&&r.method!=="-"?`<b>${esc(r.method)}</b> `:""}${esc(r.path)}</td>
          <td class="mono">${Number(r.calls).toLocaleString()}</td>
          <td class="mono" style="${r.errors?"color:#dc2626;font-weight:700":""}">${Number(r.errors).toLocaleString()}</td>
          <td class="mono" style="${pCol(r.p95_ms)}">${r.p95_ms!=null?Number(r.p95_ms).toLocaleString():"—"}</td>
          <td class="mono">${r.max_ms!=null?Number(r.max_ms).toLocaleString():"—"}</td></tr>`).join("")}</table>`;
      const sl=d.slow||[];
      h+=`<div style="font-weight:800;font-size:12px;margin:12px 0 4px">ERRORS &amp; SLOW CALLS IN THIS WINDOW <span class="rl" style="font-weight:600;color:var(--muted)">· full spans · chronological</span></div>`;
      h+=sl.length?`<table class="alerts"><tr><th>AT (KSA)</th><th>SERVICE</th><th>ENDPOINT</th><th>ms</th><th>HTTP</th><th>ERROR</th><th></th></tr>
        ${sl.map(r=>`<tr><td class="mono rl">${esc(KT.t(r.ts, true))}</td>
          <td class="rl">${esc(r.service)}</td>
          <td class="mono" style="word-break:break-all">${esc(r.path||"—")}</td>
          <td class="mono" style="font-weight:700;color:${r.duration_ms>=3000?"#dc2626":"var(--ink)"}">${Number(r.duration_ms).toLocaleString()}</td>
          <td class="mono" style="${r.status_code&&Number(r.status_code)>=400?"color:#dc2626;font-weight:700":""}">${esc(r.status_code||"—")}</td>
          <td class="rl" style="color:#dc2626">${esc(r.error||"")}</td>
          <td>${r.uil_transaction_id?`<button class="pill" data-gwwintxn="${esc(r.uil_transaction_id)}" style="padding:2px 8px;font-size:10.5px">Analyze</button>`:""}</td></tr>`).join("")}</table>`
        :`<div class="rl" style="color:var(--good);font-weight:700">No gateway errors or slow calls in this window — the gateway tier was clean while this order moved.</div>`;
    }
    card.querySelector(".modal-body").innerHTML=h;
    card.querySelectorAll("[data-gwwintxn]").forEach(b=>b.addEventListener("click",()=>{
      if(window.opsAnalyzeTrace) window.opsAnalyzeTrace(b.dataset.gwwintxn);
    }));
  }
  $("#txnDrawer").addEventListener("click",e=>{ if(e.target.id==="txnDrawer") e.currentTarget.classList.remove("open"); });
  window.opsOpenTimeline = (id, row, onBack, nav, opts)=>openTimeline(id||null, false, row||null, onBack||null, nav||null, opts||null);   // let other views open the txn timeline (with optional ‹Back)

  // ================= SETTINGS: SYNC ENGINE =================
  async function loadSyncSettings(){
    let data;
    try { data=await api("/api/settings/sync"); }
    catch(e){ $("#syncSettings").innerHTML=`<div class="albanner">Needs the console API. ${esc(e.message)}</div>`; return; }
    const s=data.sync||{}; const editable=can("manageSync");
    const isSuper = SES.me && SES.me.realRole==="super_admin";
    const modeBtn=(v,label,desc)=>`<button data-mode="${v}" class="${s.mode===v?'on':''}" title="${desc}">${label}</button>`;
    $("#syncSettings").innerHTML=`
      <div class="setrow">
        <label>STATE</label>
        <label class="switch"><input type="checkbox" id="syncEnabled" ${s.enabled?'checked':''} ${editable?'':'disabled'}><span class="slider"></span></label>
        <span style="font-weight:700;color:${s.enabled?'var(--good)':'#94a3b8'}">${s.enabled?'AUTO — running':'MANUAL — stopped'}</span>
        <span class="rl" style="margin-left:auto">${data.scheduler&&data.scheduler.running?'scheduler active':'scheduler idle'}</span>
      </div>
      <div class="setrow"><label>MODE</label>
        <div class="segsel" id="syncMode">
          ${modeBtn('manual','Manual','Only run on button click')}
          ${modeBtn('auto_replay','Auto · Replay','Advance a virtual clock across the data — simulate live traffic')}
          ${modeBtn('auto_real','Auto · Live','Sync at real wall-clock (for a truly live replica)')}
        </div>
      </div>
      <div class="setrow">
        <label>INTERVAL</label><input type="number" id="syncInterval" value="${s.intervalSec||15}" min="3" ${editable?'':'disabled'}><span class="rl">sec</span>
        <label>STEP</label><input type="number" id="syncStep" value="${s.stepHours||3}" min="1" ${editable?'':'disabled'}><span class="rl">h (replay)</span>
        <button class="pill" id="syncSave" style="border-left-color:var(--green);margin-left:auto" ${editable?'':'disabled'}>Save</button>
      </div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:4px">
        <b>Manual</b>: nothing runs automatically — use Sync/Simulate in Live Alerts. &nbsp;
        <b>Auto · Replay</b> (recommended for the static dump): every interval, advance ${s.stepHours||3}h of virtual time and evaluate — a live-traffic stream. &nbsp;
        <b>Auto · Live</b>: for a genuinely live replica.</div>
      ${editable?'':'<div class="albanner" style="margin-top:10px">Your role can view sync settings but not change them (needs manageSync: Super Admin / Admin / Events Manager).</div>'}
      <div class="setrow" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <label>SYNC-HEALTH REPORT</label>
        <span class="rl">Auto-emailed at <b>08:00</b> &amp; <b>20:00</b> KSA to users with <b>Mail report</b> on.</span>
        ${editable?'<button class="pill" id="shSend" style="border-left-color:#2563eb;margin-left:auto">✉ Send sync-health now</button>':''}
      </div>
      <div id="shResult" class="rl" style="margin-top:2px"></div>
      ${can("manageUsers")?`<div class="setrow" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <label>HEALTH SELF-CHECK</label>
        <span class="rl">Is the tooling itself healthy? Replica freshness, sync job, alert engine &amp; notification channels/keys.</span>
        <button class="pill" id="scRun" style="border-left-color:#2563eb;margin-left:auto">↻ Run self-check</button>
      </div>
      <div id="scResult" style="margin-top:6px"></div>`:''}
      <div class="setrow" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <label>INTERFACE</label>
        <label class="switch"><input type="checkbox" id="featLangSwitch" ${(SES.me&&SES.me.features&&SES.me.features.langSwitch)?'checked':''} ${can("manageUsers")?'':'disabled'}><span class="slider"></span></label>
        <span class="rl">Show the Arabic / English language switch in the header</span>
      </div>
      <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <div class="setrow"><label>EVENT TIMELINE</label><span class="rl">Deploys, campaigns &amp; maintenance — shown as markers on every trend chart.</span></div>
        ${editable?`<div class="setrow" style="flex-wrap:wrap;gap:6px">
          <select id="evKind" style="max-width:130px"><option value="deploy">Deploy</option><option value="campaign">Campaign</option><option value="maintenance">Maintenance</option><option value="incident">Incident</option><option value="note">Note</option></select>
          <input id="evTitle" placeholder="Title" style="flex:1;min-width:150px">
          <input id="evArea" placeholder="Area (opt)" style="max-width:120px">
          <input id="evAt" type="datetime-local" style="max-width:190px">
          <button class="pill" id="evAdd" style="border-left-color:var(--green)">Add</button>
        </div>`:''}
        <div id="evList" style="margin-top:8px"></div>
      </div>
      <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <div class="setrow"><label>ERROR CODES</label><span class="rl">Human labels for BSS/activation status codes — shown as "code - meaning" on error charts.</span></div>
        ${editable?`<div class="setrow" style="flex-wrap:wrap;gap:6px">
          <input id="ecCode" placeholder="Code (e.g. 823)" style="max-width:150px">
          <input id="ecLabel" placeholder="Meaning" style="flex:1;min-width:160px">
          <input id="ecArea" placeholder="Area (opt)" style="max-width:120px">
          <button class="pill" id="ecAdd" style="border-left-color:var(--green)">Save</button>
        </div>
        <details style="margin-top:6px"><summary class="rl" style="cursor:pointer">Bulk paste a list…</summary>
          <textarea id="ecBulk" rows="4" placeholder="One per line:  code, meaning, area(optional)&#10;823, MSISDN already provisioned, semati&#10;727, Nafath session expired, nafath" style="width:100%;margin-top:6px;font-family:var(--mono);font-size:11.5px"></textarea>
          <button class="pill" id="ecBulkAdd" style="border-left-color:var(--blue)">Import list</button>
        </details>`:''}
        <div id="ecList" style="margin-top:8px"></div>
      </div>
      ${isSuper?`<div id="prodSyncBox" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px"></div>`:''}`;
    loadErrCodes();
    const ecAdd=$("#ecAdd");
    if(ecAdd) ecAdd.addEventListener("click", async ()=>{
      const code=$("#ecCode").value.trim(), label=$("#ecLabel").value.trim(); if(!code||!label){ (code?$("#ecLabel"):$("#ecCode")).focus(); return; }
      try{ await api("/api/error-codes",{method:"PUT",body:JSON.stringify({code,label,area:$("#ecArea").value.trim()||null})});
        $("#ecCode").value=""; $("#ecLabel").value=""; $("#ecArea").value=""; loadErrCodes();
      }catch(e){ alert("Save failed: "+e.message); }
    });
    const ecBulk=$("#ecBulkAdd");
    if(ecBulk) ecBulk.addEventListener("click", async ()=>{
      const text=$("#ecBulk").value.trim(); if(!text) return;
      try{ const r=await api("/api/error-codes/bulk",{method:"POST",body:JSON.stringify({text})}); $("#ecBulk").value=""; loadErrCodes(); alert("Imported "+r.imported+" codes."); }
      catch(e){ alert("Import failed: "+e.message); }
    });
    loadEvents();
    const evAdd=$("#evAdd");
    if(evAdd) evAdd.addEventListener("click", async ()=>{
      const title=$("#evTitle").value.trim(); if(!title){ $("#evTitle").focus(); return; }
      const atv=$("#evAt").value; const at=atv? new Date(atv).toISOString() : new Date().toISOString();
      try{ await api("/api/events",{method:"POST",body:JSON.stringify({kind:$("#evKind").value,title,area:$("#evArea").value.trim()||null,at})});
        $("#evTitle").value=""; $("#evArea").value=""; if(window.anaReloadEvents) window.anaReloadEvents(); loadEvents();
      }catch(e){ alert("Add failed: "+e.message); }
    });
    const langFeat=$("#featLangSwitch");
    if(langFeat && can("manageUsers")) langFeat.addEventListener("change", async ()=>{
      try{ const r=await api("/api/settings/features",{method:"PUT",body:JSON.stringify({langSwitch:langFeat.checked})});
        if(SES.me) SES.me.features=r; applyFeatureFlags();
      }catch(e){ alert("Save failed: "+e.message); langFeat.checked=!langFeat.checked; }
    });
    if(isSuper) loadProdSync();
    // sync-health manual send (any time)
    const shBtn=$("#shSend");
    if(shBtn) shBtn.onclick=async()=>{
      shBtn.disabled=true; const old=shBtn.textContent; shBtn.textContent="… sending";
      try{
        const r=await api("/api/sync-health/send",{method:"POST",body:JSON.stringify({})});
        if(r.sent) $("#shResult").innerHTML=`✅ Sent (${esc(r.status)}) to ${r.recipients.length}: ${esc(r.recipients.join(", "))}`;
        else if(r.dev){ $("#shResult").innerHTML=`Dev mode (no SMTP) — opened a preview in a new tab. Status: <b>${esc(r.status)}</b>.`; const w=window.open("","_blank"); if(w){ w.document.write(r.previewHtml); w.document.close(); } }
        else if(r.reason) $("#shResult").innerHTML=`Not sent — ${esc(r.reason)}`;
        else $("#shResult").innerHTML=`Not sent${r.error?': '+esc(r.error):''}.`;
      }catch(e){ $("#shResult").textContent="Failed: "+e.message; }
      shBtn.textContent=old; shBtn.disabled=false;
    };
    // health self-check (admin) — auto-runs on open, re-runnable
    const scBtn=$("#scRun");
    if(scBtn){
      async function runSelfCheck(){
        const host=$("#scResult"); if(!host) return;
        host.innerHTML=`<span class="rl">Running…</span>`; scBtn.disabled=true;
        try{
          const r=await api("/api/health/selfcheck");
          const dot=st=>({ok:'var(--good)',warn:'#d97706',fail:'#dc2626',off:'#94a3b8'}[st]||'#94a3b8');
          const sum=r.summary||{};
          host.innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;font-size:12px">`+
            (sum.fail?`<span style="color:#dc2626;font-weight:800">${sum.fail} FAIL</span>`:'')+
            (sum.warn?`<span style="color:#d97706;font-weight:800">${sum.warn} WARN</span>`:'')+
            `<span style="color:var(--good);font-weight:800">${sum.ok||0} OK</span>`+
            (sum.off?`<span style="color:#94a3b8;font-weight:700">${sum.off} off</span>`:'')+
            `<span class="rl" style="margin-left:auto">as of ${new Date(r.now).toLocaleTimeString('en-GB',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'})} KSA</span></div>`+
            `<div style="display:grid;grid-template-columns:auto 1fr;gap:5px 12px;align-items:baseline">`+
            (r.checks||[]).map(c=>`<span style="display:inline-flex;align-items:center;gap:7px;font-weight:600;white-space:nowrap"><span style="width:9px;height:9px;border-radius:50%;background:${dot(c.status)};flex:none"></span>${esc(c.label)}</span>`+
              `<span class="rl" style="color:${c.status==='fail'?'#dc2626':c.status==='warn'?'var(--warn-fg)':'var(--muted)'}">${esc(c.detail||'')}</span>`).join("")+
            `</div>`;
        }catch(e){ host.innerHTML=`<div class="albanner">Self-check failed: ${esc(e.message)}</div>`; }
        scBtn.disabled=false;
      }
      scBtn.onclick=runSelfCheck;
      runSelfCheck();
    }
    if(editable){
      let mode=s.mode;
      $("#syncMode").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ mode=b.dataset.mode; $("#syncMode").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); }));
      $("#syncSave").onclick=async()=>{
        const body={ enabled:$("#syncEnabled").checked, mode, intervalSec:Number($("#syncInterval").value), stepHours:Number($("#syncStep").value) };
        try{ await api("/api/settings/sync",{method:"PUT",body:JSON.stringify(body)}); loadSyncSettings(); }
        catch(e){ alert("Save failed: "+e.message); }
      };
      $("#syncEnabled").addEventListener("change",()=>$("#syncSave").click());
    }
  }
  // event-timeline admin (list + delete) shown inside the sync settings page
  async function loadEvents(){
    const box=$("#evList"); if(!box) return;
    let d; try{ d=await api("/api/events"); }catch(e){ box.innerHTML=""; return; }
    const evs=(d.events||[]).slice(0,12);
    const KC={deploy:'#7c3aed',campaign:'#0891b2',maintenance:'#64748b',incident:'#dc2626',note:'#334155'};
    if(!evs.length){ box.innerHTML=`<div class="rl">No events yet.</div>`; return; }
    box.innerHTML=evs.map(e=>{ const t=new Date(e.at).toLocaleString('en-GB',{timeZone:'Asia/Riyadh',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0"><span style="width:9px;height:9px;border-radius:2px;background:${KC[e.kind]||'#334155'};flex:0 0 9px"></span><b style="text-transform:capitalize">${esc(e.kind)}</b><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.title)}</span>${e.area?`<span class="rl">· ${esc(e.area)}</span>`:''}<span class="rl" style="margin-left:auto;white-space:nowrap">${esc(t)} KSA</span>${can("manageSync")?`<button data-ev="${e.id}" title="Delete" style="cursor:pointer;border:none;background:none;color:var(--muted);font-size:15px">×</button>`:''}</div>`;
    }).join("");
    box.querySelectorAll("[data-ev]").forEach(b=>b.addEventListener("click", async ()=>{
      try{ await api("/api/events/"+b.dataset.ev,{method:"DELETE"}); if(window.anaReloadEvents) window.anaReloadEvents(); loadEvents(); }catch(e){ alert(e.message); }
    }));
  }
  // error-code label admin (list + delete)
  async function loadErrCodes(){
    const box=$("#ecList"); if(!box) return;
    let d; try{ d=await api("/api/error-codes"); }catch(e){ box.innerHTML=""; return; }
    const codes=(d.codes||[]);
    if(!codes.length){ box.innerHTML=`<div class="rl">No labels yet — add the common codes so charts read "code - meaning".</div>`; return; }
    box.innerHTML=codes.map(c=>`<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0"><b style="font-family:var(--mono)">${esc(c.code)}</b><span>${esc(c.label)}</span>${c.area?`<span class="rl">· ${esc(c.area)}</span>`:''}${can("manageSync")?`<button data-ec="${esc(c.code)}" title="Delete" style="margin-left:auto;cursor:pointer;border:none;background:none;color:var(--muted);font-size:15px">×</button>`:''}</div>`).join("");
    box.querySelectorAll("[data-ec]").forEach(b=>b.addEventListener("click", async ()=>{
      try{ await api("/api/error-codes/"+encodeURIComponent(b.dataset.ec),{method:"DELETE"}); loadErrCodes(); }catch(e){ alert(e.message); }
    }));
  }

  // ================= SETTINGS: PROD → LOCAL DATA SYNC (super admin) =================
  let _prodPoll=null;
  async function loadProdSync(){
    const box=$("#prodSyncBox"); if(!box) return;
    let d; try{ d=await api("/api/prod-sync/status"); }
    catch(e){ box.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    renderProdSync(d);
  }
  function renderProdSync(d){
    const box=$("#prodSyncBox"); if(!box) return;
    const running=d.running;
    const rows=(d.state||[]).map(r=>`<tr>
      <td class="mono">${esc(r.table_name)}</td>
      <td style="text-align:right">${r.rows_synced==null?'—':Number(r.rows_synced).toLocaleString()}</td>
      <td class="mono" style="color:var(--muted)">${r.watermark?fmtTs(r.watermark):'—'}</td>
      <td>${r.last_status?`<span class="catpill">${esc(r.last_status)}</span>`:'—'}</td>
      <td class="mono" style="color:var(--muted)">${r.last_run_at?fmtTs(r.last_run_at):'—'}</td>
      ${r.last_error?`<td style="color:#dc2626;font-size:11px">${esc(r.last_error)}</td>`:'<td></td>'}
    </tr>`).join("");
    box.innerHTML=`
      <div class="setrow"><label>PROD DATA SYNC</label>
        <span class="rl">Incremental, read-only pull from the prod reporting replica into the local replica. ${d.configured?`<b style="color:var(--good)">connected</b>`:`<b style="color:#d97706">PROD_DATABASE_URL not set on the console</b>`}${running?` · <b style="color:#2563eb">running…</b>`:''}</span>
        <span style="margin-left:auto;display:flex;gap:8px;align-items:center">
          <label class="rl" style="display:flex;gap:5px;align-items:center">test one day (KSA)<input type="date" id="psDate" style="padding:4px 6px"></label>
          <button class="pill" id="psDry" ${running||!d.configured?'disabled':''}>Dry-run</button>
          <button class="pill" id="psRun" style="border-left-color:var(--green)" ${running||!d.configured?'disabled':''}>Run sync</button>
        </span>
      </div>
      <div id="psResult" class="rl" style="margin:4px 0 8px"></div>
      ${rows?`<div style="overflow-x:auto"><table class="alerts"><tr><th>TABLE</th><th style="text-align:right">ROWS</th><th>WATERMARK</th><th>STATUS</th><th>LAST RUN</th><th>ERROR</th></tr>${rows}</table></div>`
        :`<div class="okbox">No sync has run yet. ${d.configured?'Click <b>Dry-run</b> to preview row counts.':'Configure PROD_DATABASE_URL (see <code>.env.prod-sync</code>) or use the shell script.'}</div>`}
      <div style="font-size:11px;color:var(--muted);margin-top:8px">Runs where the console can reach prod on VPN. Watermark = last created/updated pulled per table; re-runs only fetch the delta. Same engine as <code>scripts/sync-from-prod.sh</code>.</div>`;
    const dry=$("#psDry"), run=$("#psRun");
    if(dry) dry.onclick=()=>runProdSync(true);
    if(run) run.onclick=()=>{ if(confirm("Start an incremental prod → local sync now?")) runProdSync(false); };
    // poll while running
    clearInterval(_prodPoll); _prodPoll=null;
    if(running){ _prodPoll=setInterval(loadProdSync, 3000); }
  }
  async function runProdSync(dryRun){
    const res=$("#psResult"); if(res) res.innerHTML=dryRun?"Counting…":"Starting…";
    const date=($("#psDate")&&$("#psDate").value)||null;
    try{
      const r=await api("/api/prod-sync/run",{method:"POST",body:JSON.stringify({dryRun,date})});
      if(dryRun){
        const lines=(r.results||[]).map(x=>`${esc(x.table)}: ${x.error?('<span style="color:#dc2626">'+esc(x.error)+'</span>'):x.skipped?('skipped ('+esc(x.skipped)+')'):(Number(x.rows).toLocaleString()+' would sync')}`).join(" · ");
        if(res) res.innerHTML=`<b>${Number(r.rows).toLocaleString()}</b> rows would sync across ${r.tables} tables — ${lines}`;
        loadProdSync();
      } else {
        if(res) res.innerHTML="Sync started in the background…";
        loadProdSync();
      }
    }catch(e){ if(res) res.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; }
  }

  // ================= SETTINGS: USERS + ROLES REFERENCE =================
  async function loadUsersAndRoles(){
    // PII visibility card (Super Admin only) — the one clear mask/unmask switch for the whole console
    (function(){
      const ref=$("#rolesRef"); if(!ref) return;
      let card=document.getElementById("piiCard");
      if(!can("unmaskPII")){ if(card) card.remove(); return; }
      if(!card){ card=document.createElement("div"); card.id="piiCard"; ref.parentElement.insertBefore(card, ref); }
      const on=window.opsPiiUnmask();
      card.innerHTML=`<div class="panel" style="margin-bottom:14px;border-left:3px solid ${on?'var(--warn-fg)':'var(--green)'}">
        <h2 style="display:flex;align-items:center;gap:10px">PII visibility <span style="font-size:11px;font-weight:700;color:${on?'var(--warn-fg)':'var(--green-dark)'}">${on?'🔓 UNMASKED':'🔒 MASKED (default)'}</span></h2>
        <div class="sub">One switch for the whole console: Subscriber 360, timelines, dashboard drill-downs and the customer locator. Applies only to your account (Super Admin) — other roles always see masked data. Every unmasked view is audited.</div>
        <button id="piiToggle" class="navtab" style="margin-top:10px;${on?'':'background:var(--green);color:#fff;border-color:var(--green)'}">${on?'🔒 Switch back to MASKED':'🔓 Unmask PII for my session'}</button>
      </div>`;
      const b=document.getElementById("piiToggle");
      if(b) b.addEventListener("click",()=>{
        const next=!window.opsPiiUnmask();
        window.opsSetPiiUnmask(next);
        if(window.audit) window.audit(next?"PII_UNMASK_ON":"PII_UNMASK_OFF","settings-users");
        _cache.clear();                       // masked responses must not be served from the micro-cache
        loadUsersAndRoles();
      });
    })();
    // roles reference (always visible)
    try {
      const rr=await api("/api/roles");
      const roles=rr.roles||{};
      $("#rolesRef").innerHTML=`<table class="alerts"><tr><th>ROLE</th><th>TEAM</th><th>SEES</th><th>CAN</th><th>NOTE</th></tr>`+
        Object.entries(roles).map(([k,r])=>{
          const caps=Object.entries(r.caps).filter(([,v])=>v).map(([c])=>c).join(', ')||'—';
          return `<tr><td><b>${esc(r.label)}</b></td><td>${esc(r.team)}</td><td class="mono" style="font-size:10.5px">${esc(r.views.join(' '))}</td><td class="mono" style="font-size:10.5px">${esc(caps)}</td><td style="font-size:11.5px;color:var(--muted)">${esc(r.note)}</td></tr>`;
        }).join("")+`</table>`;
    } catch(e){ $("#rolesRef").innerHTML=`<div class="sub">${esc(e.message)}</div>`; }
    // editable permissions matrix (renders its own read-only view for non-super users)
    if(window.renderRolesMatrix) window.renderRolesMatrix();
    // users (super admin)
    if(!can("manageUsers")){ $("#usersBody").innerHTML=`<div class="okbox">User management is available to Super Admins only.</div>`; return; }
    renderUserMgmt();
  }

  /* role list — DYNAMIC since 2 Sep 2026 (custom roles + label changes appear without a deploy);
   * fetched from /api/roles each render, falling back to the last known list. */
  let UM_ROLES = [["super_admin","Super admin"],["admin","Admin"],["report_manager","Sales Ops"],["errors_manager","Errors manager"],["events_manager","Events manager"],
    ["l1_bss","L1 BSS"],["l2_bss","L2 BSS"],["l1_digital","L1 Digital"],["l2_digital","L2 Digital"],["l3_digital","L3 Digital"],["call_center","Call Center"]];
  async function refreshRoleList(){
    try{ const rr=await api("/api/roles"); const m=rr.roles||{};
      UM_ROLES = Object.entries(m).sort((a,b)=>(a[1].rank-b[1].rank)||a[1].label.localeCompare(b[1].label)).map(([k,v])=>[k,v.label]);
    }catch(e){}
  }
  const UM_TAGS = ["BSS","OSS","DIGITAL","FIXED","SALES OPS","PLATFORM","IDENTITY","CALL CENTER"];
  const fmtLogin = d => { if(!d) return "—"; const x=new Date(d); return x.toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"numeric",month:"short"})+", "+x.toLocaleTimeString("en-GB",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit"}); };

  async function renderUserMgmt(){
    // 10 Sep 2026 — the redesigned page lives in usersmgmt.js (KPIs, multi-criteria filters, bulk, activity); this
    // legacy renderer stays only as a fallback when that module is not loaded
    if(window.renderUsersMgmt){ return window.renderUsersMgmt($("#usersBody")); }
    let users=[];
    await refreshRoleList();
    try { users=(await api("/api/users")).users||[]; }
    catch(e){ $("#usersBody").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }

    const roleChecks = (name, sel) => UM_ROLES.map(([v,l])=>
      `<label class="um-check"><input type="checkbox" name="${name}" value="${v}" ${v===sel?'checked':''}><span>${l}</span></label>`).join("");
    const tagChips = sel => UM_TAGS.map(t=>`<button type="button" class="tagchip ${sel.includes(t)?'on':''}" data-tag="${t}">${t}</button>`).join("");
    const BIZ=[["mobile","📱 Mobile","MVNO team"],["fixed","🏠 Fixed","Fixed team"],["both","📱🏠 Both","Mobile + Fixed"]];
    const bizSeg = sel => BIZ.map(([v,l,t])=>`<button type="button" class="bizchip ${v} ${sel===v?'on':''}" data-biz="${v}" title="${t}">${l}</button>`).join("");

    // ---- New user card ----
    const card = `<div class="um-card">
      <h4>New user</h4>
      <div class="um-lbl">EMAIL</div><input class="um-input" id="nuEmail" placeholder="person@salam.sa">
      <div class="um-lbl">NAME</div><input class="um-input" id="nuName" placeholder="Full name">
      <div class="um-lbl">MOBILE</div><input class="um-input" id="nuMobile" placeholder="05x xxx xxxx">
      <div class="um-lbl">BUSINESS <span style="font-weight:400;text-transform:none;letter-spacing:0">— which side of the console</span></div>
      <div class="um-biz" id="nuBiz">${bizSeg("both")}</div>
      <div class="um-lbl">ROLES</div><div class="um-checks" id="nuRoles">${roleChecks("nuRole","admin")}</div>
      <div class="um-lbl">NOTIFICATIONS</div>
      <div class="um-checks">
        <label class="um-check"><input type="checkbox" id="nuMailReport"><span>Mail report</span></label>
        <label class="um-check"><input type="checkbox" id="nuMailAlert"><span>Mail alert</span></label>
      </div>
      <div class="um-lbl">TEAM TAGS</div><div class="um-tags" id="nuTags">${tagChips([])}</div>
      <div class="um-note">Only @salam.sa and @salammobile.sa email addresses are accepted. No password is set — the user gets a welcome email and signs in with an emailed code.</div>
      <button class="um-btn" id="nuAdd">Create user</button>
    </div>`;

    // ---- Users table ----
    const rows = users.map(u=>{
      const urs=(u.roles&&u.roles.length)?u.roles:(u.role?[u.role]:[]);
      const utags=(u.tags||[]);
      /* the same person card as the Alerts owner column (person.js) — avatar, name, e-mail, role · team */
      const extra=(u.mobile||'').trim();      // last sign-in already has its own column — don't say it twice
      const who = window.PERSON
        ? PERSON.chip(u.email, { o:{ name:u.name, role_label:(UM_ROLES.find(([v])=>urs.includes(v))||[,null])[1]||null, team:u.team, enabled:u.enabled!==false },
            sub: extra?`<div class="rl mono">${esc(extra)}</div>`:'' })
        : `<div class="u-who"><b>${esc(u.email)}</b><span>${esc([u.name||'',u.mobile||'',u.team||''].filter(Boolean).join(' · ')||'no name yet')}</span></div>`;
      return `<tr data-uid="${u.id}" class="${u.enabled?'':'u-blocked'}">
        <td class="u-email u-sticky">${who}</td>
        <td><div class="um-biz mini">${bizSeg(u.business||"both")}</div></td>
        <td><div class="um-rolecell">${UM_ROLES.map(([v,l])=>`<label><input type="checkbox" data-role="${v}" ${urs.includes(v)?'checked':''}><span>${l}</span></label>`).join("")}</div></td>
        <td><div class="u-tagedit">${UM_TAGS.map(t=>`<button type="button" class="tagchip mini ${utags.includes(t)?'on':''}" data-tag="${t}">${t}</button>`).join("")}</div></td>
        <td><span class="status-pill ${u.enabled?'active':'blocked'}">${u.enabled?'Active':'Blocked'}</span><div class="u-last">${u.last_login?'seen '+fmtLogin(u.last_login):'never signed in'}</div></td>
        <td style="text-align:center"><input type="checkbox" class="um-cellchk" data-field="mail_report" ${u.mail_report?'checked':''}></td>
        <td style="text-align:center"><input type="checkbox" class="um-cellchk" data-field="mail_alert" ${u.mail_alert?'checked':''}></td>
        <td><div class="um-ack">
          <button type="button" class="tagchip mini um-ackchip ${u.ack_mobile?'on':''}" data-ack="ack_mobile" ${u.business==='fixed'?'disabled title="Fixed-only account — cannot hold Mobile incidents"':'title="May take / receive a Mobile incident hand-over"'}>📱 Mobile</button>
          <button type="button" class="tagchip mini um-ackchip ${u.ack_fixed?'on':''}" data-ack="ack_fixed" ${u.business==='mobile'?'disabled title="Mobile-only account — cannot hold Fixed incidents"':'title="May take / receive a Fixed incident hand-over"'}>🏠 Fixed</button>
        </div></td>
        <td class="u-act u-sticky-r"><div class="u-actin"><button type="button" class="ubtn edit" data-edit title="Edit name, mobile, team, roles…">✎ Edit</button><button type="button" class="ubtn ${u.enabled?'block':'unblock'}" data-block>${u.enabled?'Block':'Unblock'}</button></div></td>
      </tr>`;
    }).join("");
    const table = `<div class="um-wrap"><table class="umtable">
      <tr><th class="u-sticky">USER</th><th>BUSINESS</th><th>ROLES</th><th>TAGS</th><th>STATUS</th><th>MAIL REPORT</th><th>MAIL ALERT</th><th title="Who may take or receive an incident hand-over on each side">ACK HOLDER</th><th class="u-sticky-r">ACTIONS</th></tr>
      ${rows||`<tr><td colspan="9" style="color:var(--muted);padding:18px">No users yet.</td></tr>`}
    </table></div>`;
    window.__umUsers = users;   // the edit panel reads the full row from here

    $("#usersBody").innerHTML = card + table;
    wireUserMgmt();
  }

  function wireUserMgmt(){
    const body=$("#usersBody");
    // --- new user card: single-select roles ---
    const roleBox=$("#nuRoles");
    // roles are multi-select (a user can hold several roles) — no single-select enforcement
    // tag chips toggle
    $("#nuTags").querySelectorAll(".tagchip").forEach(c=>c.addEventListener("click",()=>c.classList.toggle("on")));
    $("#nuBiz").querySelectorAll(".bizchip").forEach(c=>c.addEventListener("click",()=>{ $("#nuBiz").querySelectorAll(".bizchip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); }));
    // create
    $("#nuAdd").onclick=async()=>{
      const email=$("#nuEmail").value.trim();
      const rolesSel=[...roleBox.querySelectorAll('input[name="nuRole"]:checked')].map(e=>e.value);
      if(!email){ $("#nuEmail").focus(); return; }
      if(!/@(salam\.sa|salammobile\.sa)$/i.test(email)){ alert("Use a @salam.sa or @salammobile.sa email."); return; }
      if(!rolesSel.length){ alert("Select at least one role."); return; }
      const payload={ email, name:$("#nuName").value.trim()||null, mobile:$("#nuMobile").value.trim()||null, roles: rolesSel,
        tags:[...$("#nuTags").querySelectorAll(".tagchip.on")].map(c=>c.dataset.tag),
        business:(($("#nuBiz").querySelector(".bizchip.on")||{}).dataset||{}).biz||"both",
        mail_report:$("#nuMailReport").checked, mail_alert:$("#nuMailAlert").checked };
      const btn=$("#nuAdd"); btn.disabled=true;
      try{ await api("/api/users",{method:"POST",body:JSON.stringify(payload)}); renderUserMgmt(); }
      catch(e){ alert(e.message); btn.disabled=false; }
    };
    // --- table rows ---
    body.querySelectorAll("tr[data-uid]").forEach(tr=>{
      const id=tr.dataset.uid;
      const patch=async b=>{ try{ await api("/api/users/"+id,{method:"PATCH",body:JSON.stringify(b)}); }catch(e){ alert(e.message); renderUserMgmt(); } };
      // multi-select role checkboxes
      const roleCbs=[...tr.querySelectorAll(".um-rolecell input[data-role]")];
      roleCbs.forEach(cb=>cb.addEventListener("change",()=>{
        let sel=roleCbs.filter(x=>x.checked).map(x=>x.dataset.role);
        if(!sel.length){ cb.checked=true; sel=[cb.dataset.role]; }   // keep at least one role
        patch({roles:sel});
      }));
      // business scope (single choice)
      tr.querySelectorAll(".um-biz .bizchip").forEach(c=>c.addEventListener("click",()=>{
        tr.querySelectorAll(".um-biz .bizchip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); patch({business:c.dataset.biz});
      }));
      // editable team tags
      tr.querySelectorAll(".u-tagedit .tagchip").forEach(c=>c.addEventListener("click",()=>{
        c.classList.toggle("on");
        patch({tags:[...tr.querySelectorAll(".u-tagedit .tagchip.on")].map(x=>x.dataset.tag)});
      }));
      // notification checkboxes
      tr.querySelectorAll(".um-cellchk[data-field]").forEach(cb=>cb.addEventListener("change",()=>patch({[cb.dataset.field]:cb.checked})));
      tr.querySelectorAll(".um-ackchip[data-ack]").forEach(b=>b.addEventListener("click",()=>{ if(b.disabled) return; const on=!b.classList.contains("on"); b.classList.toggle("on",on); patch({[b.dataset.ack]:on}); }));
      // edit → side panel with every field
      const ed=tr.querySelector("[data-edit]");
      if(ed) ed.addEventListener("click",()=>{ const u=(window.__umUsers||[]).find(x=>String(x.id)===String(id)); if(u) openUserPanel(u); });
      // block / unblock — two clicks, no browser dialog: the first arms the button for 4 s
      const blk=tr.querySelector("[data-block]");
      if(blk) blk.addEventListener("click",async()=>{
        const enable=blk.classList.contains("unblock");
        if(!enable && !blk.dataset.armed){ blk.dataset.armed="1"; const t=blk.textContent; blk.textContent="Confirm block"; blk.classList.add("arm");
          setTimeout(()=>{ if(blk.isConnected){ delete blk.dataset.armed; blk.textContent=t; blk.classList.remove("arm"); } },4000); return; }
        await patch({enabled:enable}); renderUserMgmt();
      });
    });
  }

  /* ---- user edit panel (6 Sep 2026): one place for every field of an account ----
   * Slides in from the right (same .drawer as the transaction trace → full screen on phones). Saves with ONE
   * PATCH so a half-edited row is never left behind; Block / Unblock lives in a marked danger zone. */
  function openUserPanel(u){
    let ov=document.getElementById("userPanel");
    if(!ov){ ov=document.createElement("div"); ov.id="userPanel"; ov.className="drawer-ov"; ov.innerHTML=`<div class="drawer" id="userPanelBody"></div>`; document.body.appendChild(ov);
      ov.addEventListener("click",e=>{ if(e.target===ov) closeUserPanel(); }); }
    const body=ov.querySelector("#userPanelBody");
    const urs=(u.roles&&u.roles.length)?u.roles:(u.role?[u.role]:[]);
    const utags=u.tags||[];
    const BIZ=[["mobile","📱 Mobile"],["fixed","🏠 Fixed"],["both","📱🏠 Both"]];
    const lr=u.legacy_ref||{}; const src={digital:"Digital console",operations:"Fixed console (sda_ops)",both:"both consoles",unified:"created here"}[u.source]||"created here";
    body.innerHTML=`
      <div class="drawer-hd"><span class="av ud-av">${esc((u.name||u.email||"?")[0].toUpperCase())}</span>
        <div style="min-width:0"><div style="font-weight:800;font-size:14px;overflow:hidden;text-overflow:ellipsis">${esc(u.email)}</div>
        <div style="font-size:11px;opacity:.8">${u.enabled?'Active':'Blocked'} · ${esc(src)}${u.last_login?' · last seen '+fmtLogin(u.last_login):' · never signed in'}</div></div>
        <span class="x" id="udX" title="Close">×</span></div>
      <div class="ud-body">
        <div class="ud-grid">
          <div><div class="um-lbl">NAME</div><input class="um-input" id="udName" value="${esc(u.name||'')}" placeholder="Full name"></div>
          <div><div class="um-lbl">MOBILE</div><input class="um-input" id="udMobile" value="${esc(u.mobile||'')}" placeholder="05xxxxxxxx" inputmode="tel"></div>
        </div>
        <div class="um-lbl">TEAM <span class="ud-hint">free text · shown next to the name</span></div>
        <input class="um-input" id="udTeam" value="${esc(u.team||'')}" placeholder="e.g. Digital Ops · SDA · Call center">
        <div class="um-lbl">BUSINESS <span class="ud-hint">which side of the console this person works on</span></div>
        <div class="um-biz" id="udBiz">${BIZ.map(([v,l])=>`<button type="button" class="bizchip ${v} ${(u.business||'both')===v?'on':''}" data-biz="${v}">${l}</button>`).join("")}</div>
        <div class="um-lbl">ROLES</div>
        <div class="um-checks" id="udRoles">${UM_ROLES.map(([v,l])=>`<label class="um-check"><input type="checkbox" value="${v}" ${urs.includes(v)?'checked':''}><span>${l}</span></label>`).join("")}</div>
        <div class="um-lbl">TEAM TAGS</div>
        <div class="um-tags" id="udTags">${UM_TAGS.map(t=>`<button type="button" class="tagchip ${utags.includes(t)?'on':''}" data-tag="${t}">${t}</button>`).join("")}</div>
        <div class="um-lbl">NOTIFICATIONS &amp; ONBOARDING</div>
        <div class="um-checks">
          <label class="um-check"><input type="checkbox" id="udMailReport" ${u.mail_report?'checked':''}><span>Mail report</span></label>
          <label class="um-check"><input type="checkbox" id="udMailAlert" ${u.mail_alert?'checked':''}><span>Mail alert</span></label>
          <label class="um-check" title="May take / receive a Mobile incident hand-over"><input type="checkbox" id="udAckMobile" ${u.ack_mobile?'checked':''} ${u.business==='fixed'?'disabled':''}><span>Ack holder · 📱 Mobile</span></label>
          <label class="um-check" title="May take / receive a Fixed incident hand-over"><input type="checkbox" id="udAckFixed" ${u.ack_fixed?'checked':''} ${u.business==='mobile'?'disabled':''}><span>Ack holder · 🏠 Fixed</span></label>
          <label class="um-check"><input type="checkbox" id="udTour" ${u.tour_seen?'checked':''}><span>Quick tour seen</span> <span class="ud-hint">(untick to replay it at next sign-in)</span></label>
        </div>
        ${(lr.ops_roles&&lr.ops_roles.length)||lr.digital_id?`<div class="um-lbl">PROVENANCE</div><div class="ud-prov">Imported from ${esc(src)}${u.imported_at?' on '+fmtLogin(u.imported_at):''}${(lr.ops_roles&&lr.ops_roles.length)?` · legacy Fixed roles: <span class="mono">${esc(lr.ops_roles.join(', '))}</span>`:''}</div>`:''}
        <div class="ud-actions">
          <button type="button" class="um-btn" id="udSave">Save changes</button>
          <button type="button" class="tkm-btn" id="udCancel">Cancel</button>
          <span class="ud-msg" id="udMsg"></span>
        </div>
        <div class="ud-danger">
          <div><b>${u.enabled?'Block this account':'Unblock this account'}</b><div class="ud-hint">${u.enabled?'The person can no longer sign in. Nothing is deleted — unblock restores everything.':'Sign-in is restored with the same roles and scope.'}</div></div>
          <button type="button" class="ubtn ${u.enabled?'block':'unblock'}" id="udBlock">${u.enabled?'Block':'Unblock'}</button>
        </div>
      </div>`;
    body.querySelector("#udX").onclick=closeUserPanel; body.querySelector("#udCancel").onclick=closeUserPanel;
    body.querySelectorAll("#udBiz .bizchip").forEach(c=>c.onclick=()=>{ body.querySelectorAll("#udBiz .bizchip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); });
    body.querySelectorAll("#udTags .tagchip").forEach(c=>c.onclick=()=>c.classList.toggle("on"));
    const msg=(t,bad)=>{ const m=body.querySelector("#udMsg"); m.textContent=t; m.style.color=bad?"var(--red)":"var(--green-dark)"; };
    body.querySelector("#udSave").onclick=async()=>{
      const roles=[...body.querySelectorAll("#udRoles input:checked")].map(x=>x.value);
      if(!roles.length){ msg("Pick at least one role.",true); return; }
      const payload={ name:body.querySelector("#udName").value.trim(), mobile:body.querySelector("#udMobile").value.trim(), team:body.querySelector("#udTeam").value.trim(),
        business:(body.querySelector("#udBiz .bizchip.on")||{}).dataset.biz||"both", roles,
        tags:[...body.querySelectorAll("#udTags .tagchip.on")].map(x=>x.dataset.tag),
        mail_report:body.querySelector("#udMailReport").checked, mail_alert:body.querySelector("#udMailAlert").checked, tour_seen:body.querySelector("#udTour").checked,
        ack_mobile:body.querySelector("#udAckMobile").checked, ack_fixed:body.querySelector("#udAckFixed").checked };
      const btn=body.querySelector("#udSave"); btn.disabled=true; msg("Saving…");
      try{ await api("/api/users/"+u.id,{method:"PATCH",body:JSON.stringify(payload)}); msg("Saved."); setTimeout(closeUserPanel,350); renderUserMgmt(); }
      catch(e){ msg(e.message,true); btn.disabled=false; }
    };
    const blk=body.querySelector("#udBlock");
    blk.onclick=async()=>{
      const enable=!u.enabled;
      if(!enable && !blk.dataset.armed){ blk.dataset.armed="1"; blk.textContent="Confirm block"; blk.classList.add("arm"); setTimeout(()=>{ if(blk.isConnected){ delete blk.dataset.armed; blk.textContent="Block"; blk.classList.remove("arm"); } },4000); return; }
      try{ await api("/api/users/"+u.id,{method:"PATCH",body:JSON.stringify({enabled:enable})}); closeUserPanel(); renderUserMgmt(); }
      catch(e){ msg(e.message,true); }
    };
    ov.classList.add("open"); document.addEventListener("keydown",escUserPanel);
    setTimeout(()=>{ const n=body.querySelector("#udName"); if(n) n.focus(); },120);
  }
  window.openUserPanel=openUserPanel;   // used by usersmgmt.js
  function escUserPanel(e){ if(e.key==="Escape") closeUserPanel(); }
  function closeUserPanel(){ const ov=document.getElementById("userPanel"); if(ov) ov.classList.remove("open"); document.removeEventListener("keydown",escUserPanel); }

  async function loadConfigChanges(){
    const box=$("#configChanges"); if(!box) return;
    box.innerHTML=`<div class="sub">Loading…</div>`;
    try{
      const d=await api("/api/config-changes?limit=60"); const c=d.changes||[];
      if(!c.length){ box.innerHTML=`<div class="okbox">No <code>Setting</code> changes recorded yet${d.note?` (${esc(d.note)})`:''}. Changes appear here once admins edit settings in the backend.</div>`; return; }
      box.innerHTML=`<table class="alerts"><tr><th>WHEN</th><th>SETTING</th><th>EVENT</th><th>CHANGED BY</th><th>DIFF</th></tr>`+
        c.map(x=>`<tr>
          <td class="mono" style="color:var(--muted);white-space:nowrap">${fmtTs(x.created_at)}</td>
          <td class="mono">${esc(x.var||('#'+x.item_id))}</td>
          <td>${esc(x.event)}</td>
          <td>${esc(x.whodunnit||'—')}</td>
          <td class="mono" style="font-size:10.5px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.changes||'')}</td>
        </tr>`).join("")+`</table>`;
    }catch(e){ box.innerHTML=`<div class="sub">${esc(e.message)}</div>`; }
  }

  // mobile drawer
  const burger=$("#navBurger"), navEl=document.querySelector("nav");
  if(burger) burger.addEventListener("click", ()=> navEl.classList.toggle("open"));

  // settings now opens from the header gear (see app.js) — expose its loaders
  window.opsLoadSettings = ()=>{ loadSyncSettings(); loadUsersAndRoles(); loadConfigChanges(); if(window.renderWorkbenchInline) window.renderWorkbenchInline(); if(navEl) navEl.classList.remove("open"); };

  // ---- wire nav + lazy loads ----
  document.querySelectorAll(".navtab").forEach(b=>{
    b.addEventListener("click", ()=>{ if(navEl) navEl.classList.remove("open"); });
    if(b.dataset.view==="errors") b.addEventListener("click", loadErrors);
  });

  // deep-link entry point: preselect a Troubleshoot error category (e.g. from the
  // dashboard journey-health pills). Sets the filter; the nav switch triggers the load,
  // and if Troubleshoot is already open we reload in place.
  window.opsSelectErrorCategory = function(cat){
    errState.category = cat || "";
    errState.team = "";
    errState.codeFilter = "";
    errState.gwFilter = "";
    reflectCatUrl(errState.category);
    if($("#view-errors") && $("#view-errors").classList.contains("active")) loadErrors();
  };

  /* ---- Centralised dashboard → Troubleshoot navigation --------------------------------
   * The dashboard (home.js) and the Error board (Troubleshoot) keep SEPARATE range state
   * (home_range vs window.OPS_RANGE). Bare setConsoleHash("troubleshoot") links dropped the
   * dashboard's selected period AND the class, so a drill-down from a filtered KPI opened the
   * wrong window with no class filter. Every dashboard→Troubleshoot jump now routes through
   * here (or the equivalent #troubleshoot?from&to&cls&cat deep link), which pushes the caller's
   * period into OPS_RANGE and pre-selects the class/category before the board loads. */
  function applyErrTarget(t){
    t = t || {};
    // 1) period → OPS_RANGE (Troubleshoot + Analytics both follow this global range)
    if(t.from && t.to){
      const hours = t.hours || Math.max(1, Math.round((new Date(t.to)-new Date(t.from))/3600e3));
      window.OPS_RANGE = { key:"Custom", hours, from:t.from, to:t.to };
    } else if(t.hours){
      window.OPS_RANGE = { key:(t.hours>=720?"Last 30d":t.hours>=168?"Last 7d":t.hours+"h"), hours:Number(t.hours), from:null, to:null };
    }
    // 2) class + category filters (only overwrite when the caller specified them)
    errState.pinned = false; errState.rangeKey = "range";
    if(t.cls !== undefined) errState.clsFilter = t.cls || "";
    if(t.cat !== undefined){ errState.category = t.cat || ""; errState.team = ""; errState.codeFilter = ""; errState.gwFilter = ""; }
    syncErrRange();            // fold the new OPS_RANGE into errState.window/sim
    saveErr();
    document.dispatchEvent(new CustomEvent("opsrangechange", { detail: window.OPS_RANGE }));
    if($("#view-errors") && $("#view-errors").classList.contains("active")) loadErrors();
  }
  window.opsApplyErrTarget = applyErrTarget;   // used by the router for deep links / refresh
  // navigate to Troubleshoot carrying period + class + category (shareable in the URL)
  window.opsGoTroubleshoot = function(t){
    t = t || {};
    applyErrTarget(t);
    const p = new URLSearchParams();
    if(t.from) p.set("from", t.from);
    if(t.to) p.set("to", t.to);
    if(t.cls) p.set("cls", t.cls);
    if(t.cat) p.set("cat", t.cat);
    const qs = p.toString();
    if(window.setConsoleHash) window.setConsoleHash("troubleshoot" + (qs ? "?" + qs : ""));
  };
  $("#errSearch").addEventListener("input", ()=>{ errState.q=$("#errSearch").value.trim(); clearTimeout(window._eqt); window._eqt=setTimeout(()=>{ loadErrors(); if(errState.q&&window.audit) window.audit("APPLY_FILTER","troubleshoot:search"); },350); });

  /* ---- Case analyzer: trace id / request id ("Device ID" in the app error dialog) → diagnosis ---- */
  async function analyzeCase(){
    const rawIn=($("#caseTrace").value||"").trim(); if(!rawIn) return;
    // tolerate pasting the whole error-dialog text — extract the trace/request token
    const tk=/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})/i.exec(rawIn);
    const id=tk?tk[1]:rawIn;
    const card=$("#panelModalCard");
    card.innerHTML=`<div class="modal-head"><span class="path">Case analyzer · ${esc(id.slice(0,20))}…</span><span class="x" id="caseX">×</span></div>
      <div class="modal-body">${window.salamLoader?window.salamLoader("Analyzing case…"):"Analyzing…"}</div>`;
    $("#panelModal").classList.add("open");
    $("#caseX").onclick=()=>$("#panelModal").classList.remove("open");
    if(window.audit) window.audit("CASE_ANALYZE", id.slice(0,40));
    let d; try{ d=await api("/api/trace/"+encodeURIComponent(id)); }
    catch(e){ card.querySelector(".modal-body").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    let h="";
    if(!d.found){
      h=`<div class="albanner">No stored events for this id.</div>
        <div class="rl" style="margin-top:8px">${esc(d.note||"")}</div>`;
      // Phase 2 (3 Sep): 16-hex ids are DMS app-log references — searchable live, no ssh needed
      if(/^[0-9a-f]{16}$/i.test(String(id).trim()))
        h+=`<div class="okbox" style="border-left:3px solid #3b82f6;margin-top:8px"><b>⛏ This is a DMS app-log reference shape</b> — search it right here on the DMS app nodes (retention ≈ 7 days).
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
            <button class="pill" id="caseDmsBtn" data-ref="${esc(String(id).trim().toLowerCase())}" style="padding:3px 10px;font-size:11px;border-left-color:#3b82f6">Search current logs (fast)</button>
            <input id="caseDmsDate" type="date" style="font-size:11px;padding:2px 4px;border:1px solid var(--line,#e2e8f0);border-radius:6px">
            <span class="rl">set the request date to deep-search that day (~1 min; instant if already searched)</span>
          </div><div id="caseDmsOut" style="margin-top:8px"></div></div>`;
      else
        h+=`<div class="rl" style="margin-top:8px">Manual check on the API hosts:</div>
        <div class="mono" style="font-size:11px;background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-top:6px">ssh -i /root/.ssh/api_log_ed25519 console_ro@172.31.43.17 "grep '${esc(id)}' /www/app/salam_api/shared/log/api_error_logger.production.log | tail -3"</div>`;
    } else {
      const kb=d.known_case;
      if(kb) h+=`<div style="border-left:4px solid #7c3aed;background:#7c3aed11;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:10px">
        <div style="font-weight:800">${esc(kb.title)} <span class="rl" style="font-weight:600">· ${esc(kb.classification)}</span></div>
        <div style="font-size:12px;margin-top:4px;line-height:1.55">${esc(kb.explanation)}</div>
        <div style="font-size:12px;margin-top:6px;line-height:1.55"><b>Action:</b> ${esc(kb.action)}</div></div>`;
      const ib=d.ip_block;
      if(ib) h+=`<div style="border-left:4px solid #ef4444;background:#ef444411;border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:10px">
        <div style="font-weight:800">IP BLOCK DETAIL <span class="rl" style="font-weight:600">· live settings: limit ${esc(ib.settings.ip_request_rate_limit)} · session ${esc(ib.settings.ip_session_time)}s · elapse ${esc(ib.settings.ip_elapse_time)}s (${esc(ib.settings.source)})</span></div>
        <div style="font-size:12px;margin-top:4px;line-height:1.55"><b>Why blocked:</b> ${esc(ib.condition)}<br>${esc(ib.detail||"")}</div>
        ${ib.last_allowed_at?`<div style="font-size:12px;margin-top:4px">Last request that <b>passed</b> the gate: <span class="mono">${esc(KT.dts(ib.last_allowed_at))}</span> (outcome ${esc(ib.last_allowed_outcome)})</div>`:""}
        <div style="font-size:12px;margin-top:2px">Block active since <span class="mono">${esc(KT.dts(ib.first_block_at||""))}</span> · ${esc(ib.blocked_attempts)} blocked attempt(s) recorded</div>
        ${ib.auto_unblock_human?`<div style="font-size:12px;margin-top:2px"><b>Auto-unblock:</b> ${esc(ib.auto_unblock_human)}</div>`:""}
        ${ib.unblock_now?`<div class="mono" style="font-size:10.5px;background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:7px 9px;margin-top:6px">${esc(ib.unblock_now)}</div>`:""}
      </div>`;
      h+=`<div class="rl" style="margin-bottom:6px">${d.kind==="transaction"
          ?`<b>Transaction-level match</b> — no app-error events, correlated via the transaction id`
          :`<b>${d.occurrences}</b> occurrence(s) · first ${esc(KT.dt(d.first_seen||""))} · last ${esc(KT.dt(d.last_seen||""))} · ${esc(d.platform||"?")} v${esc(d.app_version||"?")}`}</div>
        <div class="rl">Exception: <span class="mono">${esc((d.exception_classes||[]).join(", ")||"—")}</span> · codes <span class="mono">${esc((d.error_codes||[]).join(", "))}</span></div>
        <div class="rl">Endpoint(s): <span class="mono">${esc((d.endpoints||[]).join(" · "))}</span></div>
        ${(d.frames||[]).length?`<div class="rl">Code frame: <span class="mono" style="font-size:11px">${esc(d.frames[0])}</span></div>`:""}
        ${d.sample_message?`<div class="mono" style="font-size:11px;background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-top:8px">${esc(d.sample_message)}</div>`:""}
        ${(d.entries||[]).length?`<table class="alerts" style="margin-top:10px"><tr><th>WHEN</th><th>HOST</th><th>CODE</th><th>ENDPOINT</th></tr>
        ${(d.entries||[]).map(e2=>`<tr><td class="mono">${esc(KT.dts(e2.ts||""))}</td><td class="mono">${esc(e2.host)}</td><td class="mono">${esc(e2.error_code)}</td><td class="mono">${esc((e2.controller||"")+"#"+(e2.action||""))}</td></tr>`).join("")}</table>`:""}`;
      /* ---- end-to-end tier view: APP (Digital API) → GATEWAY (APIGW hops) → UIL/OSB payloads.
       * Same contract as ⇄ UPG for payments: one id, the whole story, every tier optional. ---- */
      const g=d.gateway;
      if(g){
        if((g.app||[]).length){
          h+=`<div style="font-weight:800;font-size:12px;margin:12px 0 4px">APP CALL · Digital API <span class="rl" style="font-weight:600;color:var(--muted)">· api_traffic_events (request path · response code/message · exec time)</span></div>
            <table class="alerts"><tr><th>WHEN (KSA)</th><th>HOST</th><th>API</th><th>CODE</th><th>RESPONSE</th><th>ms</th></tr>
            ${g.app.map(a=>`<tr><td class="mono">${esc(KT.dts(a.ts||""))}</td><td class="mono">${esc(a.host)}</td>
              <td class="mono" style="word-break:break-all">${esc(a.path)}</td>
              <td class="mono" style="font-weight:700;color:${a.err_class==="success"?"#16a34a":a.err_class==="technical"?"#dc2626":"#d97706"}">${esc(a.response_code||"—")}</td>
              <td class="rl" style="max-width:260px">${esc((a.response_message||"").slice(0,120))}</td>
              <td class="mono" style="font-weight:700">${a.duration_ms!=null?a.duration_ms:"—"}</td></tr>`).join("")}</table>
            <button class="pill" id="gwPayloadBtn" data-txn="${esc(d.id)}" style="margin-top:6px;padding:3px 10px;font-size:11px;border-left-color:#3b82f6" title="SSH-fetches the full JSON line from api_logger on the API hosts — a few seconds">Fetch full request / response JSON</button>
            <div id="gwPayloadOut"></div>`;
        }
        const sp=(g.gateway&&g.gateway.spans)||[];
        if(sp.length){
          const total=Math.max(1,g.gateway.total_ms||1);
          h+=`<div style="font-weight:800;font-size:12px;margin:12px 0 4px">GATEWAY HOPS · APIGW <span class="rl" style="font-weight:600;color:var(--muted)">· ${sp.length} hop(s) · total ${esc(g.gateway.total_ms)}ms · ${esc(g.gateway.source||"")}</span></div>
            <div style="border:1px solid var(--line);border-radius:10px;background:var(--card);padding:8px 10px">${sp.map(s=>{
              const left=Math.min(97,100*(s.offset_ms||0)/total), wid=Math.max(1.5,100*(s.ms||0)/total);
              const bad=s.err||(s.status&&Number(s.status)>=400);
              return `<div style="display:flex;align-items:center;gap:8px;padding:2.5px 0;font-size:11px">
                <span class="rl" style="min-width:170px;text-align:right;color:var(--muted)">${esc(s.service||"?")}${s.kind?` <b style="color:var(--ink)">${esc(s.kind)}</b>`:""}</span>
                <span style="flex:1;position:relative;height:13px;background:var(--card2);border-radius:4px;overflow:hidden">
                  <span style="position:absolute;left:${left}%;width:${wid}%;top:0;bottom:0;background:${bad?"#ef4444":"#3b82f6"};opacity:.85;border-radius:3px" title="+${esc(s.offset_ms)}ms · ${esc(s.ms)}ms"></span></span>
                <span class="mono" style="min-width:56px;text-align:right;font-weight:700;color:${bad?"#dc2626":"var(--ink)"}">${esc(s.ms)}ms</span>
                <span class="mono" style="min-width:40px;font-weight:700;color:${bad?"#dc2626":"#16a34a"}">${esc(s.err?"ERR":(s.status||"ok"))}</span>
                <span class="mono rl" style="flex:2;word-break:break-all">${esc((s.method?s.method+" ":"")+(s.path||""))}</span></div>`;}).join("")}
            ${sp.some(s=>s.err)?`<div class="rl" style="margin-top:6px;color:#dc2626">${sp.filter(s=>s.err).map(s=>`${esc(s.service)}: ${esc(s.err)}`).join(" · ")}</div>`:""}</div>`;
        } else if(g.gateway&&g.gateway.source==="none"){
          h+=`<div class="rl" style="margin-top:10px;color:var(--muted)">No gateway spans for this id — live Zipkin only holds ~1–3h, and stored spans cover errors + slow calls only. Recent + fast + successful calls leave aggregates, not per-call spans.</div>`;
        }
        if(g.uil&&g.uil.ok&&(g.uil.rows||[]).length){
          h+=`<div style="font-weight:800;font-size:12px;margin:12px 0 4px">UIL / OSB LOG <span class="rl" style="font-weight:600;color:var(--muted)">· ${esc(g.uil.table||"uil_logs")} · full request/response payloads (PII masked)</span></div>`;
          g.uil.rows.forEach(r=>{
            h+=`<div style="border:1px solid var(--line);border-radius:10px;background:var(--card);padding:8px 10px;margin-bottom:6px">
              <div class="mono" style="font-size:11px">${esc(Object.entries(r.fields||{}).map(([k,v])=>`${k}=${v}`).join(" · "))}</div>
              ${Object.entries(r.payloads||{}).map(([k,v])=>`<details style="margin-top:5px"><summary class="mono" style="cursor:pointer;font-size:11px;font-weight:700">${esc(k)} (${v.length} chars)</summary>
                <pre class="mono" style="font-size:10.5px;white-space:pre-wrap;word-break:break-all;background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:8px;max-height:260px;overflow:auto;margin:4px 0 0">${esc(v)}</pre></details>`).join("")}</div>`;
          });
        } else if(g.uil&&g.uil.configured&&g.uil.ok===false){
          h+=`<div class="rl" style="margin-top:8px;color:var(--muted)">UIL/OSB payload lookup unavailable: ${esc(g.uil.error||"")}</div>`;
        }
      }
      h+=`<div class="rl" style="margin-top:8px">Tip: ask Yusr the same — paste the id (or "txn &lt;id&gt;") in the chat and it answers with this analysis + runbook context. Attach the customer's screenshot to a ticket ("?" → Raise a ticket) to keep the case on record.</div>`;
    }
    card.querySelector(".modal-body").innerHTML=h;
    // DMS app-log search inline (Phase 2) — shared runner; server caches, so repeats are instant
    const cdb=card.querySelector("#caseDmsBtn");
    if(cdb) cdb.addEventListener("click", ()=>window._dmsLogRun(cdb, card.querySelector("#caseDmsDate"), card.querySelector("#caseDmsOut")));
    // full request/response JSON — on-demand SSH grep of the api_logger on the API hosts
    const pbtn=card.querySelector("#gwPayloadBtn");
    if(pbtn) pbtn.addEventListener("click", async ()=>{
      const out=card.querySelector("#gwPayloadOut");
      pbtn.disabled=true; pbtn.textContent="Fetching from the API hosts…";
      let p; try{ p=await api(`/api/apigw/txn/${encodeURIComponent(pbtn.dataset.txn)}/payloads${can("unmaskPII")?"?unmask=1":""}`); }
      catch(e){ out.innerHTML=`<div class="albanner" style="margin-top:6px">${esc(e.message)}</div>`; pbtn.disabled=false; pbtn.textContent="Fetch full request / response JSON"; return; }
      pbtn.style.display="none";
      if(!p.configured){ out.innerHTML=`<div class="rl" style="margin-top:6px">API_LOG_HOSTS not configured.</div>`; return; }
      if(!(p.rows||[]).length){ out.innerHTML=`<div class="rl" style="margin-top:6px">${esc(p.note||p.error||"No matching log line found.")}</div>`; return; }
      out.innerHTML=p.rows.map((r,i)=>`<div style="border:1px solid var(--line);border-radius:10px;background:var(--card);padding:8px 10px;margin-top:6px">
        <div class="mono" style="font-size:11px;font-weight:700">${esc((r.method||"")+" "+(r.path||""))} <span class="rl" style="font-weight:600;color:var(--muted)">· ${esc(r.host)}${r.duration?` · ${esc(r.duration)}s`:""}${r.response_date?` · ${esc(r.response_date)}`:""}</span></div>
        ${r.request_body!=null?`<div class="tl-rrlabel" style="margin-top:5px">REQUEST BODY</div><div class="jt-wrap">${jsonTree(r.request_body,null,0)}</div>`:""}
        ${r.response_body!=null?`<div class="tl-rrlabel" style="margin-top:5px">RESPONSE BODY</div><div class="jt-wrap">${jsonTree(r.response_body,null,0)}</div>`:""}
      </div>`).join("");
      if(window.audit) window.audit("APIGW_PAYLOAD_VIEW", pbtn.dataset.txn.slice(0,40));
    });
  }
  const cgo=$("#caseGo"); if(cgo) cgo.addEventListener("click", analyzeCase);
  const cin=$("#caseTrace"); if(cin) cin.addEventListener("keydown", e=>{ if(e.key==="Enter") analyzeCase(); });
  // programmatic entry (Monitoring app-errors drill rows → Case analyzer)
  window.opsAnalyzeTrace = function(id){ const inp=$("#caseTrace"); if(inp) inp.value=String(id||""); analyzeCase(); };
  window.opsCourierTrace = ref=>openCourierTrace(ref);   // Monitoring ⑥ stuck-shipments drill

  /* ---- Customer payments 360: one MSISDN → every transaction end to end. App-side rows with
   * status/decline, then per row: journey Timeline + ⇄ UPG (the gateway's view of that exact
   * payment). PII masked per role; each lookup audited server-side. ---- */
  const STATC={success:"#10b981",fail:"#dc2626",failed:"#dc2626",pending:"#d97706",refunded:"#a78bfa"};
  async function customer360(){
    const inp=$("#custMsisdn"); const ms=((inp&&inp.value)||"").replace(/[^0-9+]/g,"");
    if(ms.length<8){ alert("Enter a full MSISDN, customer ID (10 digits) or service number"); return; }
    const card=$("#panelModalCard"); if(!card) return;
    card.innerHTML=`<div class="modal-head"><span class="path">Customer 360 · payments</span><span class="x" id="c3X">×</span></div>
      <div class="modal-body">${window.salamLoader?window.salamLoader("Loading transactions…"):"Loading…"}</div>`;
    $("#panelModal").classList.add("open"); $("#c3X").onclick=()=>$("#panelModal").classList.remove("open");
    let d; try{ d=await api(`/api/customer/payments?q=${encodeURIComponent(ms)}&days=90`); }
    catch(e){ card.querySelector(".modal-body").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const body=card.querySelector(".modal-body");
    if(d.error){ body.innerHTML=`<div class="albanner">${esc(d.error)}</div>`; return; }
    const R=d.rows||[];
    if(!R.length){ body.innerHTML=`<div class="rl">No payments for ${esc(d.msisdn)} in the last ${d.days} days.</div>`; return; }
    const chips=Object.entries(d.summary||{}).map(([k,v])=>`<span class="teamchip" style="cursor:default;color:${STATC[k]||'var(--ink)'}">${esc(k)} · <b>${v}</b></span>`).join(" ");
    body.innerHTML=`<div class="rl" style="margin-bottom:6px"><b>${esc(d.msisdn)}</b> <span style="font-size:10px">(${esc(d.matched_by||"")})</span> · ${d.total} transaction(s) · last ${d.days} days ${d.unmasked?"":"· PII masked"} ${d.upg_available?"":"· ⇄ UPG unavailable (not configured)"}</div>
      <div style="margin-bottom:8px">${chips}</div>
      <table class="alerts"><tr><th>WHEN (KSA)</th><th>TYPE</th><th>AMOUNT</th><th>GW · PLATFORM</th><th>STATUS / REASON</th><th></th></tr>${
      R.map(r=>{ const col=STATC[r.status]||"var(--ink)";
        return `<tr>
        <td class="mono" style="font-size:10.5px">${esc(KT.dt(r.created_at||""))}</td>
        <td style="font-size:11px">${esc(r.payment_on_type||"—")}</td>
        <td>${esc(r.amount)}</td>
        <td class="mono" style="font-size:10.5px">${esc(r.vendor||"—")}${r.platform?` · ${esc(r.platform)}`:""}</td>
        <td style="font-size:11px"><span style="color:${col};font-weight:700">${esc(r.status)}</span>${r.decline&&r.decline!=="—"?`<br><span class="rl" style="font-size:10px">${esc(String(r.decline).slice(0,48))}</span>`:(r.fail_reason?`<br><span class="rl" style="font-size:10px">${esc(String(r.fail_reason).slice(0,48))}</span>`:"")}</td>
        <td style="white-space:nowrap">
          ${r.on_id&&r.payment_on_type==="OnboardingOrder"?`<button class="pill" style="padding:3px 8px" data-c3t="${esc(r.on_id)}" data-c3r="pay:${esc(r.id)}">Timeline</button>`:""}
          ${r.ref&&d.upg_available&&isUpgRow(r.vendor)&&upgOn()?`<button class="pill" style="padding:3px 7px;border-left-color:#ea580c" data-c3u="${esc(r.ref)}">⇄ UPG</button>`:""}
        </td></tr>`; }).join("")}</table>
      <div class="rl" style="margin-top:8px">⇄ UPG opens the gateway's record of that exact payment — charge attempts, bank state log and webhook delivery. Lookups are audited.</div>`;
    body.querySelectorAll("[data-c3t]").forEach(b=>b.addEventListener("click",()=>{ $("#panelModal").classList.remove("open"); openTimeline(b.dataset.c3t||null,false,b.dataset.c3r); }));
    body.querySelectorAll("[data-c3u]").forEach(b=>b.addEventListener("click",()=>window.opsUpgTrace(b.dataset.c3u)));
  }
  const c3go=$("#custGo"); if(c3go) c3go.addEventListener("click", customer360);
  const c3in=$("#custMsisdn"); if(c3in) c3in.addEventListener("keydown", e=>{ if(e.key==="Enter") customer360(); });

  /* Collapsible JSON tree (native <details>) — used for gateway payloads in the UPG drawer.
   * Objects/arrays render as expandable nodes; primitives as key: value lines. Data is already
   * sanitized+masked server-side (upgLink.sanitize), so this is purely presentation. */
  function jsonTree(v,key,depth){
    const K=key!=null?`<span class="jt-k">${esc(key)}</span><span class="jt-c">: </span>`:"";
    if(v===null||v===undefined) return `<div class="jt-row">${K}<span class="jt-null">null</span></div>`;
    if(typeof v!=="object"){
      const cls=typeof v==="number"?"jt-num":typeof v==="boolean"?"jt-bool":"jt-str";
      const txt=typeof v==="string"?`"${esc(v)}"`:esc(String(v));
      return `<div class="jt-row">${K}<span class="${cls}">${txt}</span></div>`;
    }
    const isArr=Array.isArray(v), entries=isArr?v.map((x,i)=>[i,x]):Object.entries(v);
    const badge=isArr?`[${entries.length}]`:`{${entries.length}}`;
    const open=depth<1?" open":"";                       // first level expanded, rest collapsed
    return `<details class="jt"${open}><summary class="jt-row">${K}<span class="jt-badge">${badge}</span></summary>
      <div class="jt-ch">${entries.map(([k,x])=>jsonTree(x,String(k),(depth||0)+1)).join("")}</div></details>`;
  }
  (function(){ if(document.getElementById("jt-css")) return;
    const st=document.createElement("style"); st.id="jt-css"; st.textContent=`
      .jt-wrap{background:var(--panel-dark);border-radius:8px;padding:8px 12px;margin-top:6px;font-family:var(--mono);font-size:11px;line-height:1.6;max-height:340px;overflow:auto}
      .jt-wrap .jt-row{color:var(--panel-dark-fg);white-space:pre-wrap;word-break:break-word}
      .jt-wrap summary.jt-row{cursor:pointer;list-style:none;user-select:none}
      .jt-wrap summary.jt-row::before{content:"▸";display:inline-block;width:12px;color:var(--muted);transition:transform .12s}
      .jt-wrap details[open]>summary.jt-row::before{transform:rotate(90deg)}
      .jt-wrap .jt-ch{margin-left:16px;border-left:1px solid var(--line);padding-left:8px}
      .jt-k{color:#7dd3fc}.jt-str{color:#bbf7d0}.jt-num{color:#fbbf24}.jt-bool{color:#f472b6}.jt-null{color:var(--muted)}
      .jt-badge{color:#94a3b8;font-size:10px}.jt-c{color:var(--muted)}
      .jt-head{display:flex;align-items:center;justify-content:space-between;margin-top:8px;font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}`;
    document.head.appendChild(st); })();

  /* ---- UPG gateway correlation: paste an invoice / payment reference → both sides of the
   * transaction (app asked → gateway did). Renders in the same modal as the case analyzer. ---- */
  window.opsUpgTrace = async function(key){
    const card=$("#panelModalCard"); if(!card) return;
    card.innerHTML=`<div class="modal-head"><span class="path">UPG gateway · ${esc(String(key).slice(0,24))}</span><span class="x" id="ugX">×</span></div>
      <div class="modal-body">${window.salamLoader?window.salamLoader("Querying the gateway…"):"Loading…"}</div>`;
    $("#panelModal").classList.add("open");
    $("#ugX").onclick=()=>$("#panelModal").classList.remove("open");
    if(window.audit) window.audit("UPG_TRACE", String(key).slice(0,40));
    let d; try{ d=await api("/api/upg/trace?key="+encodeURIComponent(key)); }
    catch(e){ card.querySelector(".modal-body").innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    const body=card.querySelector(".modal-body");
    if(!d.configured){ body.innerHTML=`<div class="rl">UPG correlation is not configured on this console (UPG_DATABASE_URL unset).</div>`; return; }
    if(!d.found){ body.innerHTML=`<div class="albanner">No UPG invoice matches this reference.</div><div class="rl" style="margin-top:6px">${esc(d.note||"")}</div>`; return; }
    const CLS={success:"#10b981",abandoned:"#64748b",declined:"#3b82f6",technical:"#ef4444",pre_bank:"#94a3b8",refunded:"#a78bfa",open:"#d97706"};
    const inv=d.invoice, s=d.summary;
    const dt=x=>x?esc(KT.dts(x))+"Z":"—";
    let h=`<div style="border-left:3px solid ${s.outcome==='PAID'?'#10b981':'#64748b'};background:${s.outcome==='PAID'?'var(--tint-green)':'var(--card2)'};border-radius:0 8px 8px 0;padding:9px 12px;margin-bottom:10px">
        <b>Invoice ${esc(inv.id)}</b> · ${esc(inv.status||"")} · ${esc(inv.amount)} ${inv.channel?`· ${esc(inv.channel)}`:""}${inv.description?` · ${esc(inv.description)}`:""}
        <div class="rl" style="font-size:11px;margin-top:3px">created ${dt(inv.created_at)}${inv.expires_at?` · expires ${dt(inv.expires_at)}`:""}${inv.reference_id?` · app ref <span class="mono">${esc(inv.reference_id)}</span>`:""}</div>
        <div style="font-size:12px;margin-top:3px;line-height:1.5">${esc(s.verdict)}</div></div>
      <div class="rl" style="margin-bottom:6px">${s.attempts} charge attempt(s) · ${s.untouched} never engaged · ${s.technical} technical</div>`;
    h+=(d.charges||[]).map(c=>{
      const col=CLS[c.class]||"#94a3b8";
      const steps=(c.activities||[]).map(a=>`<span class="mono" style="font-size:10.5px">${esc(a.status)}</span> <span class="rl" style="font-size:10px">${esc(KT.t(a.at||"", true))}</span>`).join(' <span style="color:var(--muted)">→</span> ');
      // sanitized gateway payload — headline chips + collapsible JSON tree (pgAdmin-style)
      let gw="";
      if(c.gateway){
        const g=c.gateway, pick=(o,path)=>path.split(".").reduce((a,k)=>a&&a[k]!==undefined?a[k]:null,o);
        const heads=[["gw code",pick(g,"gateway.response.code")||pick(g,"response_code")],["gw msg",pick(g,"gateway.response.message")||pick(g,"response_message")],["status",g.status],["auth",pick(g,"authorization_code")||pick(g,"auth_code")]]
          .filter(([,v])=>v!=null&&v!=="").slice(0,4);
        const chips=heads.length?`<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px 10px">${heads.map(([k,v])=>`<span class="rl" style="font-size:10px"><span style="color:var(--muted)">${esc(k)}:</span> <span class="mono">${esc(clipTxt(String(v),40))}</span></span>`).join("")}</div>`:"";
        const jid="gwjson_"+Math.random().toString(36).slice(2,8);
        gw=chips+`<div class="jt-head"><span>gateway_payload <span style="font-weight:600;text-transform:none">(sanitized · PAN/PII masked)</span></span>
            <button class="pill" style="padding:1px 9px;font-size:10px" data-gwcopy="${jid}">Copy JSON</button></div>
          <div class="jt-wrap" id="${jid}" data-json="${esc(JSON.stringify(g))}">${jsonTree(g,null,0)}</div>`;
      }
      return `<div style="border:1px solid var(--line);border-left:3px solid ${col};border-radius:0 8px 8px 0;padding:8px 11px;margin:7px 0">
        <div><b class="mono" style="font-size:11.5px">${esc(c.id)}</b> · <span style="color:${col};font-weight:700">${esc(c.label)}</span>
          ${c.method?`<span class="rl"> · ${esc(c.method)}</span>`:""}${c.bank_message?`<span class="rl"> · ${esc(c.bank_message)}</span>`:""}</div>
        <div class="rl" style="font-size:10.5px;margin-top:3px">created ${dt(c.created_at)}${c.finalized_at&&c.finalized_at!==c.created_at?` · final ${dt(c.finalized_at)}`:""}${c.secs_to_final!=null?` · ${c.secs_to_final<120?c.secs_to_final+"s":Math.round(c.secs_to_final/60)+" min"} to final`:""}${c.transaction_id?` · txn <span class="mono">${esc(c.transaction_id)}</span>`:""}</div>
        <div style="margin-top:4px">${steps||'<span class="rl">no state log</span>'}</div>${gw}
        ${c.never_engaged?`<div class="rl" style="margin-top:3px;color:var(--muted)">⚠ created and expired untouched — no card entry, no 3DS, no bank call</div>`:""}
      </div>`; }).join("");
    const W=d.webhooks||[];
    if(W.length){
      // status colors: DELIVERED green · PENDING amber · FAILED red (webhooks table semantics)
      const WCOL=s=>{ s=String(s||"").toUpperCase();
        return /DELIVER/.test(s)?"#10b981":/PEND/.test(s)?"#d97706":/FAIL|ERROR/.test(s)?"#ef4444":"#64748b"; };
      const TCOL=t=>{ t=String(t||"").toUpperCase();
        return /PAID|SUCCESS/.test(t)?"#10b981":/FAIL/.test(t)?"#ef4444":"#334155"; };
      h+=`<div class="rl" style="margin:10px 0 3px;font-weight:700">WEBHOOK DELIVERIES → app (${W.length})</div>
        <table class="alerts"><tr><th>CREATED (KSA)</th><th>TYPE</th><th>STATUS</th><th>RETRIES</th><th>NOTIFIED AT (KSA)</th><th>PAYMENT</th></tr>${
        W.map(w=>{ const st=w.webhook_status||w.status||w.state||"—";
          const ty=w.webhook_type||w.event||w.event_type||w.type||"—";
          const scol=WCOL(st);
          return `<tr><td class="mono" style="font-size:10px">${dt(w.created_at)}</td>
          <td style="font-size:10.5px;font-weight:700;color:${TCOL(ty)}">${esc(ty)}</td>
          <td><span style="display:inline-block;padding:1px 8px;border-radius:9px;background:${scol}1c;color:${scol};font-weight:800;font-size:10px">${esc(st)}</span></td>
          <td class="mono" style="color:${Number(w.retries||w.attempts||0)>0?'#d97706':'inherit'}">${esc(String(w.retries!=null?w.retries:(w.attempts||0)))}</td>
          <td class="mono" style="font-size:10px">${w.notified_at?dt(w.notified_at):`<span style="color:#d97706">not notified</span>`}</td>
          <td class="mono" style="font-size:9.5px">${esc(clipTxt(String(w.payment_id||w.url||w.endpoint||"—"),22))}</td></tr>`; }).join("")}</table>
        <div class="rl" style="margin-top:3px;font-size:10px">DELIVERED = the app confirmed receipt · PENDING = queued, app not yet notified · FAILED = delivery failed (payment state in the app may lag the gateway — this is the callback-gap signature).</div>`;
    } else h+=`<div class="rl" style="margin-top:8px">No webhook delivery records ${d.missing_indexes&&d.missing_indexes.some(m=>m.includes('webhook'))?"(lookup disabled — index missing, see below)":"for this invoice"}.</div>`;
    if(d.missing_indexes&&d.missing_indexes.length)
      h+=`<div style="border-left:3px solid #d97706;background:var(--card2);border-radius:0 8px 8px 0;padding:7px 11px;margin-top:8px;font-size:11px">
        <b>Partial view — protecting the gateway.</b> These lookups are disabled because the UPG DB lacks the supporting index (the console never runs un-indexed scans against production):
        <div class="mono" style="font-size:10.5px;margin-top:3px">${d.missing_indexes.map(esc).join("<br>")}</div></div>`;
    h+=`<div class="rl" style="margin-top:8px">Source: UPG gateway database (read-only, index-gated). “Attempts” is what gateway reports count; the invoice outcome above is what revenue follows.</div>`;
    body.innerHTML=h;
    body.querySelectorAll("[data-gwcopy]").forEach(b=>b.addEventListener("click",()=>{
      const el=body.querySelector("#"+b.dataset.gwcopy); if(!el) return;
      try{ navigator.clipboard.writeText(JSON.stringify(JSON.parse(el.dataset.json),null,2)); b.textContent="Copied ✓"; setTimeout(()=>b.textContent="Copy JSON",1200); }catch(e){}
    }));
  };
  document.addEventListener("opsrangechange", ()=>{ if($("#view-errors").classList.contains("active")) loadErrors(); });
  /* NO auto re-render on live sync (removed 17 Aug 2026, user request): the error board is an
   * investigation surface — auto refresh was re-fetching the UPG deep-dive and collapsing open
   * panels every few seconds mid-analysis. The page now loads on entry and on user-driven
   * range/filter changes only; a browser refresh (or re-entering the view) fetches fresh data. */
  document.addEventListener("uinavchange", ()=>{ if($("#view-errors").classList.contains("active")) loadErrors(); });
  /* Troubleshoot export — server-side, exactly as filtered (window / pinned range end, team, category, class, code, gateway, search) */
  async function errExport(format){
    const btn=$(format==="pdf"?"#errPdf":"#errXlsx"); if(!btn||btn.disabled) return;
    const old=btn.textContent; btn.disabled=true; btn.textContent="… building";
    try{
      const p=new URLSearchParams({format, window:String(errState.window)});
      if(errState.sim) p.set("sim",errState.sim); if(errState.team) p.set("team",errState.team); if(errState.category) p.set("category",errState.category);
      if(errState.q) p.set("q",errState.q); if(errState.codeFilter) p.set("code",errState.codeFilter); if(errState.gwFilter) p.set("gw",errState.gwFilter); if(errState.clsFilter) p.set("cls",errState.clsFilter);
      const r=await window.fetch(API+"/api/errors/export?"+p.toString());
      if(!r.ok){ const j=await r.json().catch(()=>({})); throw new Error(j.error||("HTTP "+r.status)); }
      const cd=r.headers.get("Content-Disposition")||""; const m=/filename="([^"]+)"/.exec(cd);
      const blob=await r.blob(); const href=URL.createObjectURL(blob); const a=document.createElement("a");
      a.href=href; a.download=m?m[1]:`troubleshoot.${format}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(href),2000);
    }catch(e){ alert("Export failed — "+e.message); }
    finally{ btn.disabled=false; btn.textContent=old; }
  }
  const errX=$("#errXlsx"); if(errX) errX.addEventListener("click",()=>errExport("xlsx"));
  const errP=$("#errPdf"); if(errP) errP.addEventListener("click",()=>errExport("pdf"));
  $("#userChip").addEventListener("click", openRoleModal);

  // ================= LOGIN GATE =================
  const ALLOWED = /@(salam\.sa|salammobile\.sa)$/i;
  const validDomain = e => ALLOWED.test(String(e||"").trim());
  function showGate(){ $("#loginGate").classList.add("show"); document.body.classList.add("locked"); showEmailStep(); const i=$("#lgEmail"); if(i){ i.value=""; $("#lgBtn").disabled=true; i.focus(); } }
  function hideGate(){ $("#loginGate").classList.remove("show"); document.body.classList.remove("locked"); }
  function showEmailStep(){ $("#lgStepEmail").style.display=""; $("#lgStepCode").style.display="none"; $("#lgErr").textContent=""; }
  function showCodeStep(email){ $("#lgStepEmail").style.display="none"; $("#lgStepCode").style.display=""; $("#lgCodeTo").textContent="→ "+email; $("#lgErr2").textContent=""; const c=$("#lgCode"); c.value=""; c.focus(); }
  async function sendCode(){
    const err=$("#lgErr"), btn=$("#lgBtn");
    const v=$("#lgEmail").value.trim().toLowerCase();
    if(!validDomain(v)){ err.textContent="Use a @salam.sa or @salammobile.sa email."; return; }
    btn.disabled=true; btn.textContent="Sending…";
    try{
      const r=await api("/api/auth/request-otp",{method:"POST",body:JSON.stringify({email:v})});
      SES.pendingEmail=v;
      showCodeStep(v);
      const hint=$("#lgDevHint");
      if(r.dev && r.devCode){ hint.style.display="block"; hint.innerHTML=`Dev mode (no SMTP): your code is <b>${esc(r.devCode)}</b> — also printed in the server logs.`; }
      else if(r.mailError){ hint.style.display="block"; hint.innerHTML=`⚠ Email delivery failed (relay policy) — your code was still generated. Ask an admin to read it from the server log, or check with IT that mail relay from this server is allowed.`; }
      else { hint.style.display="none"; }
    }catch(e){ err.textContent=e.message; }
    btn.disabled=false; btn.textContent="Send code";
  }
  async function verifyCode(){
    const err=$("#lgErr2"), btn=$("#lgVerify");
    const code=$("#lgCode").value.trim();
    if(code.length<4){ return; }
    btn.disabled=true; btn.textContent="Verifying…";
    try{
      const r=await api("/api/auth/verify-otp",{method:"POST",body:JSON.stringify({email:SES.pendingEmail, code})});
      SES.email=r.email; SES.role=r.role; SES.token=r.token||"";
      localStorage.setItem('cons_email',r.email); localStorage.setItem('cons_role',r.role); localStorage.setItem('cons_token',SES.token);
      _kicked=false; _cache.clear(); _inflight.clear();   // drop anything fetched pre-login (incl. 401s)
      hideGate(); showEmailStep(); await loadMe();
      const active=document.querySelector(".navtab:not(.hidden)"); if(active) active.click();
    }catch(e){ err.textContent=e.message; }
    btn.disabled=false; btn.textContent="Verify & sign in";
  }
  function wireGate(){
    const email=$("#lgEmail"), btn=$("#lgBtn");
    const check=()=>{ const ok=validDomain(email.value); btn.disabled=!ok; $("#lgErr").textContent=(email.value&&!ok)?"Use a @salam.sa or @salammobile.sa email.":""; };
    email.addEventListener("input", check);
    email.addEventListener("keydown", e=>{ if(e.key==="Enter" && !btn.disabled) sendCode(); });
    btn.addEventListener("click", sendCode);
    const code=$("#lgCode"), vbtn=$("#lgVerify");
    code.addEventListener("input", ()=>{ code.value=code.value.replace(/\D/g,''); vbtn.disabled=code.value.length<4; });
    code.addEventListener("keydown", e=>{ if(e.key==="Enter" && !vbtn.disabled) verifyCode(); });
    vbtn.addEventListener("click", verifyCode);
    $("#lgBack").addEventListener("click", e=>{ e.preventDefault(); showEmailStep(); });
    $("#lgResend").addEventListener("click", e=>{ e.preventDefault(); sendCode(); });
  }
  function bootAuth(){
    wireGate();
    const email=localStorage.getItem('cons_email')||"";
    // a stored email alone is no longer a session — the token is
    if(email && validDomain(email) && SES.token){ SES.email=email; hideGate(); loadMe(); }
    else { SES.email=""; showGate(); }
  }

  // sign out: kill the server-side session too, then return to the gate
  const _origSignout = ()=>{ try{ api("/api/auth/logout",{method:"POST",body:"{}"}); }catch(e){}
    SES.email=""; SES.role="report_manager"; SES.token="";
    localStorage.removeItem('cons_email'); localStorage.removeItem('cons_token'); localStorage.setItem('cons_role','report_manager'); showGate(); };

  // re-render theme-sensitive ops views on theme change
  document.addEventListener("themechange", ()=>{
    const active=document.querySelector(".view.active");
    if(active && active.id==="view-errors") loadErrors();
  });

  // ---- boot ----
  bootAuth();
  // DMS log-search helpers are defined lazily at drawer render (window._dmsLogRun / _dmsLogResultHtml);
  // ensure they exist at load too so the Case analyzer can use them before any drawer was opened.
  if(!window._dmsLogRun){
    window._dmsLogResultHtml=function(d){
      let hh="";
      if(!d.total_hits){ hh+=`<div class="rl" style="color:#d97706">${esc(d.note||"No match in the searched window.")}</div>`; }
      else{
        const fileRows=(d.hosts||[]).flatMap(hst=>(hst.files||[]).map(f=>`<tr><td class="mono">${esc(hst.host)}</td><td>${esc(f.service||"—")}</td><td class="mono" style="font-size:10.5px">${esc((f.file||"").split("/").pop())}</td><td style="font-weight:700">${f.hits}</td></tr>`));
        hh+=`<div class="rl"><b>${d.total_hits}</b> matching line(s) · ${esc(d.scope||"")} · ${d.ms}ms${d.cached?` · <span style="color:var(--good);font-weight:700">served from cache</span>`:""}</div>
          <div style="border:1px solid var(--line);border-radius:8px;max-height:140px;overflow:auto;margin-top:4px"><table class="alerts" style="font-size:11px">
          <tr><th>NODE</th><th>SERVICE</th><th>FILE</th><th>HITS</th></tr>${fileRows.join("")}</table></div>`;
        if((d.hops||[]).length){
          hh+=`<div class="rl" style="margin-top:6px"><b>What the logs say happened</b></div>
            <div style="border:1px solid var(--line);border-radius:8px;max-height:200px;overflow:auto;margin-top:4px"><table class="alerts" style="font-size:11px">
            <tr><th>HOP</th><th>CALL</th><th>RESULT</th><th>MS</th></tr>
            ${d.hops.map(hp=>{const bad=hp.response_code&&!/^(00|0|200|600)$/.test(String(hp.response_code));
              return `<tr><td>${esc(hp.kind)}</td><td class="mono" style="font-size:10.5px;max-width:280px;overflow:hidden">${esc((hp.url||"").replace(/^https?:\/\//,""))}</td>
              <td style="font-weight:700;color:${bad?"#dc2626":"#16a34a"}">${esc(hp.response_code||hp.status||"—")}${hp.response_message?" · "+esc(hp.response_message):""}</td>
              <td class="mono">${esc(hp.ms||"—")}</td></tr>`;}).join("")}</table></div>`;
        }
        if((d.uil_transaction_ids||[]).length) hh+=`<div class="rl" style="margin-top:6px">UIL transaction id(s): ${d.uil_transaction_ids.map(t=>`<code>${esc(t)}</code>`).join(" · ")} — paste one in Troubleshoot search for the gateway ⇄ uil_logs tiers.</div>`;
        const rawAll=(d.hosts||[]).filter(x=>(x.lines||[]).length).map(x=>`== ${x.host} ==\n${x.lines.join("\n")}${x.ctx?`\n-- context --\n${x.ctx}`:""}`).join("\n\n");
        if(rawAll) hh+=`<details style="margin-top:6px"><summary class="rl" style="cursor:pointer">Raw log lines (as on the nodes)</summary><pre style="font-size:10px;max-height:260px;overflow:auto;white-space:pre-wrap">${esc(rawAll.slice(0,20000))}</pre></details>`;
      }
      if(d.errors) hh+=`<div class="rl" style="color:#dc2626;margin-top:4px">Node errors: ${esc(d.errors.join(" · "))}</div>`;
      return hh;
    };
    window._dmsLogRun=async function(btn, dateEl, out){
      if(!out||!btn) return;
      const ref=btn.dataset.ref, date=(dateEl&&dateEl.value)||"";
      btn.disabled=true;
      out.innerHTML=`<div class="rl">⏳ Searching ${date?`current logs + rotated files of ${esc(date)}`:"current logs"} on the DMS nodes… ${date?"(deep search — up to ~1 min; instant if cached)":""}</div>`;
      try{
        const d=await api(`/api/apigw/logref/${encodeURIComponent(ref)}${date?`?date=${encodeURIComponent(date)}`:""}`);
        if(d.error||d.ok===false){ out.innerHTML=`<div class="rl" style="color:#dc2626">${esc(d.error||"search failed")}</div>`; return; }
        out.innerHTML=window._dmsLogResultHtml(d);
      }catch(e){ out.innerHTML=`<div class="rl" style="color:#dc2626">${esc(e.message)}</div>`; }
      finally{ btn.disabled=false; btn.textContent=date?"Search again":"Search current logs (fast)"; }
    };
  }
})();
