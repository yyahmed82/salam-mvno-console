/* navmenucfg.js — Settings › Navigation › Header menus (alpha.160, 9 Oct 2026)
 *
 * The editor of the console's top menu (runtime: navmenu.js · API: /api/ui-nav/menu, super admins). One submenu level:
 *   top level   pages, links and menus
 *   in a menu   pages, links and plain labels (dividers) — a menu never holds a menu
 * Every entry: add · edit (label, target, the roles that see it) · move ▲ ▼ (order among its neighbours) · ◀ out of its
 * menu · ▶ into the menu just above it (when the entry above is a page or link, ▶ turns it into a menu holding both) ·
 * remove. A page removed from the menus waits under "Not in the menus" and can be added back; Reset returns the default.
 * "Visible to" roles hide an entry (or a whole menu) from the other roles — presentation only: the page's permissions
 * still decide who may open it. The list is exact (alpha.161): a super admin sees a restricted entry only when Super
 * Admin is selected (View as user shows a role's menus).
 * Nothing is live until Save; "Preview in the header" draws the draft in this browser only. */
(function(){
  "use strict";
  const $=(s,r)=>(r||document).querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const isSuper=()=>{ const s=(window.opsSession&&window.opsSession())||{}; return !!(s.me && (s.me.realRole==="super_admin"||(s.me.realRoles||[]).includes("super_admin"))); };
  const LABEL_MAX=48;
  const SVG=(d,w)=>`<svg viewBox="0 0 24 24" width="${w||14}" height="${w||14}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC={
    up:SVG('<path d="M6 15l6-6 6 6"/>'), down:SVG('<path d="M6 9l6 6 6-6"/>'), out:SVG('<path d="M15 6l-6 6 6 6"/>'), in:SVG('<path d="M9 6l6 6-6 6"/>'),
    edit:SVG('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'), del:SVG('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus:SVG('<path d="M12 5v14M5 12h14"/>'), menu:SVG('<path d="M4 6h16M4 12h16M4 18h10"/>',13), head:SVG('<path d="M5 7h14M5 12h9"/>',13),
    link:SVG('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',13),
    eye:SVG('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',13),
    undo:SVG('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',13), save:SVG('<path d="M5 12l5 5 9-10"/>',14),
    lock:SVG('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',11)
  };
  const clone=x=>JSON.parse(JSON.stringify(x));
  const sig=x=>JSON.stringify(x||null);

  let host=null, E=null;   // E = { items, saved (sig of the server copy), form, msg, previewing }
  let CAT=new Map();       // page key → catalogue entry (label, hash, icon, menuLabel…)
  let ROLES=[];            // [{ key, label, team }] from /api/roles — the "Visible to" picker
  const roleLabel=k=>(ROLES.find(r=>r.key===k)||{}).label||k;
  const rolesText=r=>!r||!r.length?"":r.length<=2?r.map(roleLabel).join(" · "):`${roleLabel(r[0])} +${r.length-1}`;
  function loadRoles(){
    if(ROLES.length) return Promise.resolve(ROLES);
    return fetch((window.API_BASE||window.CONSOLE_BASE||"")+"/api/roles",{headers:{"Content-Type":"application/json"}}).then(r=>r.ok?r.json():{roles:{}})
      .then(j=>{ ROLES=Object.entries(j.roles||{}).map(([key,v])=>({ key, label:(v&&v.label)||key, team:(v&&v.team)||"" })); return ROLES; }).catch(()=>ROLES);
  }

  /* ---------------------------------------------------------------- tree helpers */
  const N=()=>window.NAVMENU;
  const pathOf=s=>String(s).split(".").map(Number);
  const listOf=p=>p.length===1?E.items:E.items[p[0]].items;
  const nodeAt=p=>listOf(p)[p[p.length-1]];
  const usedPages=()=>{ const u=new Map(); E.items.forEach((x,i)=>{ if(x.t==="page") u.set(x.key,[i]); if(x.t==="menu") (x.items||[]).forEach((c,j)=>{ if(c.t==="page") u.set(c.key,[i,j]); }); }); return u; };
  const pageLabel=k=>(CAT.get(k)||{}).label||k;
  const labelOf=x=>x.t==="page"?(x.label||pageLabel(x.key)):(x.label||"");
  const newMenuKey=()=>"m-"+Date.now().toString(36).slice(-5)+Math.random().toString(36).slice(2,4);
  const menuName=k=>{ const m=E.items.find(x=>x.t==="menu"&&x.key===k); return m?m.label:""; };
  function routeHint(href){
    if(/^https?:\/\//i.test(href)) return { ok:/^https?:\/\/[^\s"'<>`\\]{3,}$/i.test(href), text:"Opens in a new tab" };
    if(!/^#[A-Za-z0-9_\-/?=&.%:+,~@!*'()]*$/.test(href)) return { ok:false, text:"Start with # for a console page (e.g. #opsreports?tab=week) or with https:// for a link" };
    const info=window.consoleRouteInfo&&window.consoleRouteInfo(href.slice(1));
    if(!info) return { ok:false, text:"No console page at this address" };
    const L=N().linkInfo(href), p=L.page;
    return { ok:true, text:`Opens ${p?(p.menuLabel?p.menuLabel+" › ":"")+p.label:"a console page"}${info.need?` · shown to roles with the “${info.need}” page`:""}` };
  }
  function targetText(x){
    if(x.t==="page"){ const c=CAT.get(x.key); return c?`${c.menuLabel?c.menuLabel+" › ":""}${c.label} · #${c.hash}`:x.key; }
    if(x.t==="link"){ if(/^https?:/i.test(x.href)) return "External · "+x.href; const L=N().linkInfo(x.href); return (L.page?(L.page.menuLabel?L.page.menuLabel+" › ":"")+L.page.label+" · ":"")+x.href; }
    if(x.t==="menu"){ const n=(x.items||[]).filter(c=>c.t!=="head").length; return n?`${n} entr${n===1?"y":"ies"}`:"empty — add entries or move some in with ▶"; }
    return "";
  }

  /* ---------------------------------------------------------------- css */
  function ensureCss(){
    if($("#nmCss")) return;
    const st=document.createElement("style"); st.id="nmCss";
    st.textContent=`
#navMenuCfg .nm-panel{padding:18px 20px}
#navMenuCfg .nm-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
#navMenuCfg .nm-hd h2{margin:0 0 4px}
#navMenuCfg .nm-hd .sub{max-width:780px;line-height:1.5}
#navMenuCfg .nm-state{font-size:11.5px;color:var(--muted);white-space:nowrap;padding-top:4px}
#navMenuCfg .nm-state b{color:var(--ink)} #navMenuCfg .nm-state .dirty{color:var(--amber,#d97706);font-weight:700}
#navMenuCfg .nm-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 10px}
#navMenuCfg .nm-legend{font-size:11.5px;color:var(--muted);margin-left:auto}
#navMenuCfg .nm-addbtn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;font-weight:700;color:var(--green-dark);background:var(--green-bg);border:1px solid transparent;border-radius:10px;padding:7px 12px;cursor:pointer}
#navMenuCfg .nm-addbtn:hover{border-color:var(--green)} #navMenuCfg .nm-addbtn:focus-visible{outline:2px solid var(--green);outline-offset:2px}
#navMenuCfg .nm-tree,#navMenuCfg .nm-kids{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
#navMenuCfg .nm-kids{margin:6px 0 2px 22px;padding-left:14px;border-left:2px solid var(--line)}
html[dir=rtl] #navMenuCfg .nm-kids{margin:6px 22px 2px 0;padding:0 14px 0 0;border-left:0;border-right:2px solid var(--line)}
#navMenuCfg .nm-row{display:flex;align-items:center;gap:12px;padding:9px 10px 9px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);transition:border-color .15s,box-shadow .15s}
#navMenuCfg .nm-row:hover{border-color:color-mix(in srgb,var(--green) 45%,var(--line))}
#navMenuCfg .nm-row.menu{background:var(--card2,var(--bg))}
#navMenuCfg .nm-row.head{border-style:dashed;background:transparent;padding-top:6px;padding-bottom:6px}
#navMenuCfg .nm-row.flash{border-color:var(--green);box-shadow:0 0 0 3px var(--green-bg)}
#navMenuCfg .nm-fold{width:26px;height:26px;margin-right:-4px;display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer}
#navMenuCfg .nm-fold:hover{background:var(--green-bg);color:var(--green-dark)} #navMenuCfg .nm-fold:focus-visible{outline:2px solid var(--green)}
#navMenuCfg .nm-ic{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--bg);border:1px solid var(--line);color:var(--muted);font-size:13px}
#navMenuCfg .nm-ic svg{width:14px;height:14px}
#navMenuCfg .nm-row.menu .nm-ic{background:var(--green);border-color:var(--green);color:#fff}
#navMenuCfg .nm-row.head .nm-ic{width:24px;height:24px;background:transparent;border-style:dashed}
#navMenuCfg .nm-txt{flex:1;min-width:0}
#navMenuCfg .nm-lb{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;color:var(--ink);flex-wrap:wrap}
#navMenuCfg .nm-row.head .nm-lb{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
#navMenuCfg .nm-tg{font-size:11.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#navMenuCfg .nm-chip{font-style:normal;font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid var(--line);color:var(--muted);background:var(--bg)}
#navMenuCfg .nm-chip.menu{color:var(--green-dark);background:var(--green-bg);border-color:transparent}
#navMenuCfg .nm-chip.link{color:var(--tint-blue-fg,#3730a3);background:var(--tint-blue,#eef2ff);border-color:transparent}
#navMenuCfg .nm-chip.renamed{color:var(--tint-amber-fg,#9a3412);background:var(--tint-amber,#fff7ed);border-color:transparent;text-transform:none;letter-spacing:0;font-weight:700}
#navMenuCfg .nm-acts{display:flex;gap:4px;flex:none}
#navMenuCfg .nm-b{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink-soft,var(--ink));cursor:pointer;transition:background .12s,color .12s,border-color .12s}
#navMenuCfg .nm-b:hover{background:var(--green-bg);border-color:var(--green);color:var(--green-dark)}
#navMenuCfg .nm-b:focus-visible{outline:2px solid var(--green);outline-offset:1px}
#navMenuCfg .nm-b.x:hover{background:var(--tint-red,#fef2f2);border-color:var(--red);color:var(--red)}
#navMenuCfg .nm-b[aria-disabled="true"]{opacity:.32;cursor:default;background:var(--card);border-color:var(--line);color:var(--muted)}
#navMenuCfg .nm-addrow{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;font:inherit;font-size:12px;font-weight:700;color:var(--muted);background:transparent;border:1px dashed var(--line);border-radius:10px;padding:6px 11px;cursor:pointer}
#navMenuCfg .nm-addrow:hover{color:var(--green-dark);border-color:var(--green);background:var(--green-bg)}
#navMenuCfg .nm-form{border:1px solid var(--green);border-radius:12px;background:var(--card);padding:14px;box-shadow:0 0 0 3px var(--green-bg);display:flex;flex-direction:column;gap:12px}
#navMenuCfg .nm-form h4{margin:0;font-size:13px}
#navMenuCfg .nm-seg{align-self:flex-start;display:inline-flex;gap:4px;flex-wrap:wrap;background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:3px}
#navMenuCfg .nm-seg button{font:inherit;font-size:12px;font-weight:700;color:var(--muted);background:transparent;border:0;border-radius:8px;padding:6px 12px;cursor:pointer}
#navMenuCfg .nm-seg button[aria-pressed="true"]{background:var(--card);color:var(--green-dark);box-shadow:0 1px 3px rgba(2,6,23,.12)}
#navMenuCfg .nm-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:12px}
#navMenuCfg .nm-f{display:flex;flex-direction:column;gap:5px;font-size:11.5px;font-weight:700;color:var(--muted);min-width:0}
#navMenuCfg .nm-in{font:inherit;font-size:13px;font-weight:500;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 11px;min-width:0;width:100%;box-sizing:border-box}
#navMenuCfg .nm-in:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px var(--green-bg)}
#navMenuCfg select.nm-in{appearance:none;-webkit-appearance:none;padding-right:32px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center}
#navMenuCfg .nm-hint{font-size:11.5px;color:var(--muted);font-weight:500}
#navMenuCfg .nm-hint.bad{color:var(--red);font-weight:700}
#navMenuCfg .nm-hint.warn{color:var(--tint-amber-fg,#9a3412)}
#navMenuCfg .nm-fa{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#navMenuCfg .nm-sec{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;font-weight:700;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:7px 13px;cursor:pointer}
#navMenuCfg .nm-sec:hover{border-color:var(--green);color:var(--green-dark)}
#navMenuCfg .nm-sec.warn:hover{border-color:var(--red);color:var(--red)}
#navMenuCfg .nm-sec[disabled],#navMenuCfg .btn[disabled]{opacity:.45;cursor:default;filter:none}
#navMenuCfg .nm-err{font-size:12px;font-weight:700;color:var(--red)}
#navMenuCfg .nm-off{margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
#navMenuCfg .nm-off h4{margin:0 0 4px;font-size:13px} #navMenuCfg .nm-off .sub{margin-bottom:8px}
#navMenuCfg .nm-offl{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
#navMenuCfg .nm-pchip{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;font-weight:600;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 6px 4px 11px;cursor:pointer}
#navMenuCfg .nm-pchip small{color:var(--muted);font-weight:500}
#navMenuCfg .nm-pchip i{font-style:normal;display:inline-flex;width:20px;height:20px;border-radius:50%;align-items:center;justify-content:center;background:var(--green-bg);color:var(--green-dark)}
#navMenuCfg .nm-pchip:hover{border-color:var(--green)}
#navMenuCfg .nm-dest{width:auto;padding:5px 9px;font-size:12px}
#navMenuCfg .nm-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
#navMenuCfg .nm-msg{font-size:12px;color:var(--muted)} #navMenuCfg .nm-msg.ok{color:var(--green-dark);font-weight:700} #navMenuCfg .nm-msg.bad{color:var(--red);font-weight:700}
#navMenuCfg .nm-chip.roles{display:inline-flex;align-items:center;gap:4px;color:var(--tint-amber-fg,#9a3412);background:var(--tint-amber,#fff7ed);border-color:transparent;text-transform:none;letter-spacing:0;font-weight:700}
#navMenuCfg .nm-roles>span{display:block}
#navMenuCfg .nm-rl{display:flex;flex-wrap:wrap;gap:6px;max-height:190px;overflow:auto;padding:2px}
#navMenuCfg .nm-rc{font:inherit;font-size:12px;font-weight:600;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:5px 11px;cursor:pointer}
#navMenuCfg .nm-rc:hover{border-color:var(--green)}
#navMenuCfg .nm-rc[aria-pressed="true"]{background:var(--green);border-color:var(--green);color:#fff}
#navMenuCfg .nm-rc.all[aria-pressed="true"]{background:var(--green-bg);border-color:var(--green);color:var(--green-dark)}
#navMenuCfg .nm-rc:focus-visible{outline:2px solid var(--green);outline-offset:1px}
#navMenuCfg .nm-prev{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;color:var(--tint-amber-fg,#9a3412);background:var(--tint-amber,#fff7ed);border-radius:999px;padding:3px 10px}
@media (max-width:760px){
  #navMenuCfg .nm-panel{padding:14px}
  #navMenuCfg .nm-row{flex-wrap:wrap;gap:8px 10px}
  #navMenuCfg .nm-txt{flex:1 1 0;min-width:0}
  #navMenuCfg .nm-acts{width:100%;justify-content:flex-end;gap:6px}
  #navMenuCfg .nm-b{width:36px;height:34px}
  #navMenuCfg .nm-kids{margin-left:8px;padding-left:10px}
  #navMenuCfg .nm-grid{grid-template-columns:1fr}
  #navMenuCfg .nm-legend{margin-left:0;width:100%}
  #navMenuCfg .nm-tg{white-space:normal;overflow-wrap:anywhere}
}`;
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- render */
  function rowHtml(x, p, sibs){
    const ps=p.join("."), i=p[p.length-1], top=p.length===1, form=!!E.form;
    const dis=(cond,why)=>cond?` aria-disabled="true" title="${esc(why)}"`:"";
    const lb=labelOf(x), renamed=x.t==="page"&&x.label&&x.label!==pageLabel(x.key);
    const chip=x.t==="menu"?'<em class="nm-chip menu">Menu</em>':x.t==="link"?`<em class="nm-chip link">${/^https?:/i.test(x.href)?"External link":"Link"}</em>`:x.t==="head"?"":'<em class="nm-chip">Page</em>';
    const icon=x.t==="menu"?IC.menu:x.t==="head"?IC.head:x.t==="link"?(/^https?:/i.test(x.href)?N().icon.ext:(N().linkInfo(x.href).page||{}).icon||IC.link):((CAT.get(x.key)||{}).icon||IC.link);
    const above=top&&i>0?E.items[i-1]:null;
    const inWhy=!top?"Already inside a menu — one submenu level only":x.t==="menu"?"A menu cannot go inside another menu — one submenu level only":!above?"Nothing above to move into":
      above.t==="menu"?`Move into “${above.label}” (as its last entry)`:`Turn “${labelOf(above)}” into a menu holding it and this entry`;
    const folded=x.t==="menu"&&E.fold.has(x.key);
    return `<div class="nm-row ${x.t}${E.flash===ps?" flash":""}" data-p="${ps}">
      ${x.t==="menu"?`<button type="button" class="nm-fold" data-a="fold" aria-expanded="${!folded}" aria-label="${folded?"Show":"Hide"} the entries of ${esc(x.label)}" title="${folded?"Show":"Hide"} its entries">${folded?IC.in:IC.down}</button>`:""}
      <span class="nm-ic">${icon}</span>
      <div class="nm-txt"><div class="nm-lb">${esc(lb)}${chip}${renamed?`<em class="nm-chip renamed" title="The page's own name">was ${esc(pageLabel(x.key))}</em>`:""}${x.roles&&x.roles.length?`<em class="nm-chip roles" title="Visible to: ${esc(x.roles.map(roleLabel).join(", "))}${x.roles.includes("super_admin")?"":" — not to super admins"}">${IC.lock} ${esc(rolesText(x.roles))}</em>`:""}</div>${x.t!=="head"?`<div class="nm-tg">${esc(targetText(x))}</div>`:""}</div>
      <div class="nm-acts">
        <button type="button" class="nm-b" data-a="up" aria-label="Move up"${dis(form||i===0,i===0?"Already first":"Finish the open form first")}>${IC.up}</button>
        <button type="button" class="nm-b" data-a="down" aria-label="Move down"${dis(form||i===sibs-1,i===sibs-1?"Already last":"Finish the open form first")}>${IC.down}</button>
        <button type="button" class="nm-b" data-a="out" aria-label="Move out of the menu"${dis(form||top||x.t==="head",top?"Already at the top level":x.t==="head"?"A label only lives inside a menu":"")}${!top&&x.t!=="head"&&!form?` title="Move out of “${esc(E.items[p[0]].label)}” (to the top level, right after it)"`:""}>${IC.out}</button>
        <button type="button" class="nm-b" data-a="in" aria-label="Move into the menu above"${dis(form||!top||x.t==="menu"||!above,inWhy)}${top&&x.t!=="menu"&&above&&!form?` title="${esc(inWhy)}"`:""}>${IC.in}</button>
        <button type="button" class="nm-b" data-a="edit" aria-label="Edit"${dis(form,"Finish the open form first")}${form?"":` title="Edit the label${x.t==="page"||x.t==="link"?" and the target":""}"`}>${IC.edit}</button>
        <button type="button" class="nm-b x" data-a="del" aria-label="Remove"${dis(form,"Finish the open form first")}${form?"":` title="${x.t==="page"?"Remove from the menus (it waits below, under Not in the menus)":x.t==="menu"?"Remove the menu (its pages wait below)":"Remove"}"`}>${IC.del}</button>
      </div></div>`;
  }
  function formHtml(){
    const F=E.form, d=F.draft;
    const types=F.types.map(t=>`<button type="button" data-ft="${t}" aria-pressed="${d.t===t}">${{page:"Page",link:"Link",head:"Label",menu:"Menu"}[t]}</button>`).join("");
    const used=usedPages(), own=F.path&&d.origKey;
    const groups={}; CAT.forEach(c=>{ const g=c.menuLabel||"Main"; (groups[g] ||= []).push(c); });
    const opts=Object.keys(groups).map(g=>`<optgroup label="${esc(g)}">${groups[g].map(c=>{ const u=used.get(c.key); const where=u&&c.key!==own?(u.length===1?" — at the top level":` — in ${esc(E.items[u[0]].label)}`):(!u?" — not in the menus":"");
      return `<option value="${esc(c.key)}"${d.key===c.key?" selected":""}>${esc(c.label)}${where}</option>`; }).join("")}</optgroup>`).join("");
    const head=F.path?(d.t==="menu"?"Edit menu":d.t==="head"?"Edit label":"Edit entry"):(F.parent!=null?`Add to “${esc(E.items[F.parent].label)}”`:"Add to the top level");
    let fields="";
    if(d.t==="page"){
      const c=CAT.get(d.key), u=c&&used.get(c.key), dup=u&&c.key!==own;
      fields=`<div class="nm-grid"><label class="nm-f">Page<select class="nm-in" data-f="key">${opts}</select></label>
        <label class="nm-f">Label in the menu<input class="nm-in" data-f="label" maxlength="${LABEL_MAX}" value="${esc(d.label||"")}" placeholder="${esc(c?c.label:"")}"></label></div>
        <div class="nm-hint${dup?"":""}">${c?(dup?`Already ${u.length===1?"at the top level":"in “"+esc(E.items[u[0]].label)+"”"} — this entry will be a second link to it (#${esc(c.hash)}).`:`Opens ${esc(c.menuLabel?c.menuLabel+" › ":"")}${esc(c.label)} · #${esc(c.hash)}. Leave the label empty to use the page's own name.`):""}</div>`;
    } else if(d.t==="link"){
      const h=d.href?routeHint(d.href):null;
      const list=Array.from(CAT.values()).map(c=>`<option value="#${esc(c.hash)}">${esc((c.menuLabel?c.menuLabel+" › ":"")+c.label)}</option>`).join("");
      fields=`<div class="nm-grid"><label class="nm-f">Label in the menu<input class="nm-in" data-f="label" maxlength="${LABEL_MAX}" value="${esc(d.label||"")}" placeholder="e.g. Weekly Report"></label>
        <label class="nm-f">Target<input class="nm-in" data-f="href" value="${esc(d.href||"")}" placeholder="#opsreports?tab=week  ·  https://…" list="nmTargets" autocomplete="off" spellcheck="false"></label></div>
        <datalist id="nmTargets">${list}</datalist>
        <div class="nm-hint${h&&!h.ok?" bad":""}" data-hint>${h?esc(h.text):"A console address (#… — any page, with its filters) or an https:// link (opens in a new tab)."}</div>`;
    } else {
      fields=`<label class="nm-f">${d.t==="menu"?"Menu name":"Label text"}<input class="nm-in" data-f="label" maxlength="${LABEL_MAX}" value="${esc(d.label||"")}" placeholder="${d.t==="menu"?"e.g. VP Operations":"e.g. MONITORING"}"></label>
        <div class="nm-hint">${d.t==="menu"?"A menu opens one level of pages, links and labels.":"A plain divider inside the menu — it groups the entries below it."}</div>`;
    }
    if(d.t!=="head"){
      const sel=d.roles||[];
      fields+=`<div class="nm-f nm-roles"><span>Visible to${d.t==="menu"?" — the whole menu":""}</span>
        <div class="nm-rl" role="group" aria-label="Visible to"><button type="button" class="nm-rc all" data-role="*" aria-pressed="${!sel.length}">Every role with access</button>${ROLES.map(r=>`<button type="button" class="nm-rc" data-role="${esc(r.key)}" aria-pressed="${sel.includes(r.key)}"${r.team?` title="${esc(r.team)}"`:""}>${esc(r.label)}</button>`).join("")}</div>
        <div class="nm-hint${sel.length&&!sel.includes("super_admin")?" warn":""}">${sel.length?`Shown only to ${esc(sel.map(roleLabel).join(", "))}${d.t==="menu"?" (an entry inside can narrow it further)":""}.${sel.includes("super_admin")?"":` Super Admin is not selected, so it leaves your header too.`} `:"No role selected: every role that can open the page sees it. "}It only hides the entry — who may open a page is still decided by its permissions. <b>View as user</b> shows a role's menus.</div></div>`;
    }
    return `<div class="nm-form" role="group" aria-label="${esc(head)}"><h4>${head}</h4>${F.types.length>1?`<div class="nm-seg" role="group" aria-label="Type">${types}</div>`:""}${fields}
      <div class="nm-fa"><button type="button" class="btn" data-a="form-ok">${IC.save} ${F.path?"Apply":"Add"}</button><button type="button" class="nm-sec" data-a="form-cancel">Cancel</button><span class="nm-err" data-err>${F.err?esc(F.err):""}</span></div></div>`;
  }
  function render(){
    if(!host) return;
    if(!isSuper()){ host.innerHTML=`<div class="panel"><h2>Header menus</h2><div class="albanner">Changing the console's menus is available to Super Admins only. The menus you see are the shared layout.</div></div>`; return; }
    if(!E){ host.innerHTML=`<div class="panel"><h2>Header menus</h2><div class="sub">Loading…</div></div>`; return; }
    if(!E.fold) E.fold=new Set();
    const F=E.form, used=usedPages();
    const kids=(x,i)=>{
      const items=x.items||[];
      let h=items.map((c,j)=>{ const p=[i,j]; let r=`<li>${rowHtml(c,p,items.length)}</li>`; if(F&&F.path===p.join(".")) r=`<li>${formHtml()}</li>`; return r; }).join("");
      if(F&&!F.path&&F.parent===i) h+=`<li>${formHtml()}</li>`;
      else h+=`<li><button type="button" class="nm-addrow" data-a="add-in" data-m="${i}"${F?' disabled':''}>${IC.plus} Add a page, link or label to “${esc(x.label)}”</button></li>`;
      return `<ol class="nm-kids">${h}</ol>`;
    };
    const tree=E.items.map((x,i)=>{ const p=[i];
      const row=F&&F.path===String(i)?formHtml():rowHtml(x,p,E.items.length);
      const open=x.t==="menu"&&(!E.fold.has(x.key)||(F&&(F.parent===i||(F.path&&F.path.split(".")[0]===String(i)&&F.path.includes(".")))));
      return `<li>${row}${open?kids(x,i):""}</li>`; }).join("")+(F&&!F.path&&F.parent==null?`<li>${formHtml()}</li>`:"");
    const off=Array.from(CAT.values()).filter(c=>!used.has(c.key));
    const dirty=sig(E.items)!==E.saved, sv=N().saved();
    const state=dirty?`<span class="dirty">Unsaved changes</span>`:(sv?`Saved ${esc(window.KT?window.KT.dt(sv.updatedAt):new Date(sv.updatedAt).toLocaleString())}${sv.updatedBy?` by <b>${esc(sv.updatedBy)}</b>`:""}`:"Default layout (nothing saved yet)");
    const menus=E.items.map((x,i)=>x.t==="menu"?`<option value="${i}">${esc(x.label)}</option>`:"").join("");
    host.innerHTML=`<div class="panel nm-panel">
      <div class="nm-hd"><div><h2>Header menus <span class="rl" style="font-weight:400;color:var(--muted)">— shared for everyone</span></h2>
        <div class="sub">The console's top menu: pages and links at the top level, and menus that open one level of pages, links and labels — never deeper. Everyone gets the same layout, showing only the pages their role allows. Nothing changes for others until you <b>Save</b>.</div></div>
        <div class="nm-state">${state}${E.previewing?` &nbsp;<span class="nm-prev">${IC.eye} Previewing in your header</span>`:""}</div></div>
      <div class="nm-tools">
        <button type="button" class="nm-addbtn" data-a="add-top"${F?" disabled":""}>${IC.plus} Page or link</button>
        <button type="button" class="nm-addbtn" data-a="add-menu"${F?" disabled":""}>${IC.plus} Menu</button>
        <span class="nm-legend">▲ ▼ order · ◀ out of a menu · ▶ into the menu above · ✎ label &amp; target</span>
      </div>
      <ol class="nm-tree">${tree}</ol>
      <div class="nm-off"><h4>Not in the menus <span class="rl" style="font-weight:400;color:var(--muted)">(${off.length})</span></h4>
        ${off.length?`<div class="sub">Pages nobody reaches from the menus (a link to them still opens them). Add one back to</div>
          <div class="nm-offl"><select class="nm-in nm-dest" data-f="dest" aria-label="Add to"><option value="">the top level</option>${menus}</select>${off.map(c=>`<button type="button" class="nm-pchip" data-a="add-back" data-k="${esc(c.key)}"${F?" disabled":""} title="Add back · #${esc(c.hash)}">${esc(c.label)}${c.menuLabel?` <small>${esc(c.menuLabel)}</small>`:""}<i>${IC.plus}</i></button>`).join("")}</div>`
          :`<div class="sub">Every console page is in the menus.</div>`}</div>
      <div class="nm-foot">
        <button type="button" class="btn" data-a="save"${!dirty||F?" disabled":""}>${IC.save} Save menus</button>
        <button type="button" class="nm-sec" data-a="preview"${F?" disabled":""}>${IC.eye} Preview in the header</button>
        <button type="button" class="nm-sec" data-a="discard"${!dirty&&!E.previewing?" disabled":""}>${IC.undo} Discard changes</button>
        <button type="button" class="nm-sec warn" data-a="reset"${F?" disabled":""}>Reset to default</button>
        <span class="nm-msg${E.msg&&E.msg.cls?" "+E.msg.cls:""}" data-msg>${E.msg?esc(E.msg.text):""}</span>
      </div></div>`;
    if(F){ const f=host.querySelector('.nm-form [data-f="label"]')||host.querySelector('.nm-form [data-f="href"]'); if(f&&!F.focused){ F.focused=true; f.focus(); } }
    if(E.flash){ const r=host.querySelector(`.nm-row[data-p="${E.flash}"]`); if(r&&r.scrollIntoView&&E.scroll){ r.scrollIntoView({block:"nearest"}); } E.flash=null; E.scroll=false; }
  }
  const say=(text,cls)=>{ E.msg={text,cls}; };

  /* ---------------------------------------------------------------- actions */
  function move(p, a){
    const top=p.length===1, i=p[p.length-1], list=listOf(p), x=list[i];
    if(a==="up"&&i>0){ [list[i-1],list[i]]=[list[i],list[i-1]]; E.flash=(top?[i-1]:[p[0],i-1]).join("."); }
    else if(a==="down"&&i<list.length-1){ [list[i+1],list[i]]=[list[i],list[i+1]]; E.flash=(top?[i+1]:[p[0],i+1]).join("."); }
    else if(a==="out"&&!top&&x.t!=="head"){ list.splice(i,1); E.items.splice(p[0]+1,0,x); E.flash=String(p[0]+1); say(`“${labelOf(x)}” moved out of “${E.items[p[0]].label}”.`); }
    else if(a==="in"&&top&&x.t!=="menu"&&i>0){
      const above=E.items[i-1];
      if(above.t==="menu"){ E.fold.delete(above.key); (above.items ||= []).push(x); E.items.splice(i,1); E.flash=[i-1,above.items.length-1].join("."); say(`“${labelOf(x)}” moved into “${above.label}”.`); }
      else { const m={ t:"menu", key:newMenuKey(), label:labelOf(above), items:[above,x] }; E.items.splice(i-1,2,m); E.flash=String(i-1);
        say(`“${m.label}” is now a menu holding “${labelOf(above)}” and “${labelOf(x)}” — rename them with ✎.`); }
    } else return;
    E.scroll=true; render();
  }
  function remove(p){
    const list=listOf(p), x=list[p[p.length-1]];
    if(x.t==="menu"){ const n=(x.items||[]).filter(c=>c.t==="page").length, l=(x.items||[]).filter(c=>c.t==="link").length;
      if(!confirm(`Remove the menu “${x.label}”?${n?` Its ${n} page${n>1?"s":""} will wait under “Not in the menus”.`:""}${l?` Its ${l} link${l>1?"s":""} and its labels are deleted.`:""}`)) return; }
    list.splice(p[p.length-1],1);
    say(x.t==="page"?`“${labelOf(x)}” removed — it waits under “Not in the menus”.`:`“${labelOf(x)||"Label"}” removed.`);
    render();
  }
  function openForm(opts){
    const types=opts.types, draft=opts.draft;
    E.form={ path:opts.path||null, parent:opts.parent==null?null:opts.parent, types, draft, focused:false };
    E.msg=null; render();
  }
  function edit(p){
    const x=nodeAt(p);
    if(x.t==="menu") return openForm({ path:p.join("."), types:["menu"], draft:{ t:"menu", label:x.label, roles:(x.roles||[]).slice() } });
    if(x.t==="head") return openForm({ path:p.join("."), types:["head"], draft:{ t:"head", label:x.label } });
    const d=x.t==="page"?{ t:"page", key:x.key, origKey:x.key, label:x.label&&x.label!==pageLabel(x.key)?x.label:"" }:{ t:"link", label:x.label, href:x.href };
    d.roles=(x.roles||[]).slice();
    if(x.t==="page") d.href="#"+((CAT.get(x.key)||{}).hash||""); else { const L=N().linkInfo(x.href); d.key=L.page?L.page.key:firstFree(); }
    openForm({ path:p.join("."), types:["page","link"], draft:d });
  }
  const firstFree=()=>{ const u=usedPages(); const c=Array.from(CAT.values()).find(c=>!u.has(c.key))||Array.from(CAT.values())[0]; return c?c.key:""; };
  function readForm(){
    const F=E.form, d=F.draft, f=k=>host.querySelector(`.nm-form [data-f="${k}"]`);
    if(f("label")) d.label=f("label").value.replace(/\s+/g," ").trim().slice(0,LABEL_MAX);
    if(f("key")) d.key=f("key").value;
    if(f("href")) d.href=f("href").value.trim();
    return d;
  }
  function commitForm(){
    const F=E.form, d=readForm(), err=m=>{ F.err=m; const e=host.querySelector(".nm-form [data-err]"); if(e) e.textContent=m; };
    let node;
    if(d.t==="menu"){ if(!d.label) return err("Give the menu a name."); node=F.path?Object.assign(nodeAt(pathOf(F.path)),{ label:d.label }):{ t:"menu", key:newMenuKey(), label:d.label, items:[] }; }
    else if(d.t==="head"){ if(!d.label) return err("Write the label text."); node={ t:"head", label:d.label }; }
    else if(d.t==="page"){
      const c=CAT.get(d.key); if(!c) return err("Choose a page.");
      const u=usedPages().get(c.key), dup=u&&c.key!==d.origKey;
      const label=d.label&&d.label!==c.label?d.label:"";
      node=dup?{ t:"link", label:label||c.label, href:"#"+c.hash }:(label?{ t:"page", key:c.key, label }:{ t:"page", key:c.key });
    } else {
      if(!d.label) return err("Give the link a label.");
      const h=routeHint(d.href||""); if(!d.href||!h.ok) return err(d.href?h.text:"Write the target address.");
      node={ t:"link", label:d.label, href:d.href };
    }
    if(node.t!=="head"){ if(d.roles&&d.roles.length) node.roles=d.roles.slice(); else delete node.roles; }
    if(F.path){ const p=pathOf(F.path); if(d.t!=="menu") listOf(p)[p[p.length-1]]=node; E.flash=F.path; }
    else if(F.parent!=null){ const m=E.items[F.parent]; (m.items ||= []).push(node); E.flash=[F.parent,m.items.length-1].join("."); }
    else { E.items.push(node); E.flash=String(E.items.length-1); }
    say(F.path?`“${labelOf(node)}” updated.`:`“${labelOf(node)}” added.`);
    E.form=null; E.scroll=true; render();
  }
  function act(a, el){
    const row=el.closest(".nm-row"), p=row?pathOf(row.dataset.p):null;
    if(el.getAttribute("aria-disabled")==="true"||el.disabled) return;
    switch(a){
      case "fold": { const m=nodeAt(p); if(E.fold.has(m.key)) E.fold.delete(m.key); else E.fold.add(m.key); return render(); }
      case "up": case "down": case "out": case "in": return move(p,a);
      case "del": return remove(p);
      case "edit": return edit(p);
      case "add-top": return openForm({ parent:null, types:["page","link","menu"], draft:{ t:"link", label:"", href:"", key:firstFree() } });
      case "add-menu": return openForm({ parent:null, types:["menu"], draft:{ t:"menu", label:"" } });
      case "add-in": return openForm({ parent:Number(el.dataset.m), types:["page","link","head"], draft:{ t:"link", label:"", href:"", key:firstFree() } });
      case "add-back": { const k=el.dataset.k, dest=host.querySelector('[data-f="dest"]'), m=dest&&dest.value!==""?E.items[Number(dest.value)]:null;
        if(m){ E.fold.delete(m.key); (m.items ||= []).push({ t:"page", key:k }); E.flash=[E.items.indexOf(m),m.items.length-1].join("."); } else { E.items.push({ t:"page", key:k }); E.flash=String(E.items.length-1); }
        say(`“${pageLabel(k)}” added back${m?` to “${m.label}”`:" at the top level"}.`); E.scroll=true; return render(); }
      case "form-ok": return commitForm();
      case "form-cancel": E.form=null; return render();
      case "save": return save();
      case "preview": N().preview(clone(E.items)); E.previewing=true; say("Your header shows the draft — only in this browser, until you save or discard."); return render();
      case "discard": N().restore(); E.items=N().current(); E.previewing=false; say("Changes discarded."); return render();
      case "reset": if(!confirm("Reset the menus to the default layout for everyone? Renamed entries, links and menus you added are removed.")) return;
        say("Resetting…"); render();
        return N().reset().then(()=>{ E.items=N().current(); E.saved=sig(N().savedItems()); E.previewing=false; say("Back to the default layout — for everyone.","ok"); render(); })
          .catch(e=>{ say("Reset failed: "+e.message,"bad"); render(); });
    }
  }
  function save(){
    say("Saving…"); render();
    return N().save(clone(E.items)).then(()=>{ E.items=N().current(); E.saved=sig(N().savedItems()); E.previewing=false;
      say("Saved — your header shows it now; everyone else gets it on their next page load.","ok"); render(); })
      .catch(e=>{ say("Not saved: "+e.message,"bad"); render(); });
  }
  function wire(){
    if(host.dataset.wired) return; host.dataset.wired="1";
    host.addEventListener("click", e=>{
      const rc=e.target.closest(".nm-form [data-role]");
      if(rc&&E.form){ readForm(); const d=E.form.draft, k=rc.dataset.role; d.roles=d.roles||[];
        if(k==="*") d.roles=[]; else d.roles=d.roles.includes(k)?d.roles.filter(r=>r!==k):d.roles.concat(k);
        E.form.focused=true; render(); const nb=host.querySelector(`.nm-form [data-role="${k.replace(/"/g,"")}"]`); if(nb) nb.focus(); return; }
      const t=e.target.closest("[data-a],[data-ft]"); if(!t||!host.contains(t)) return;
      if(t.dataset.ft){ readForm(); const d=E.form.draft, was=d.t; d.t=t.dataset.ft;
        if(was==="page"&&d.t==="link"&&!d.href){ const c=CAT.get(d.key); if(c) d.href="#"+c.hash; if(!d.label&&c) d.label=c.label; }
        if(was==="link"&&d.t==="page"){ const L=N().linkInfo(d.href||""); if(L.page) d.key=L.page.key; }
        E.form.focused=false; return render(); }
      act(t.dataset.a, t);
    });
    host.addEventListener("change", e=>{ const f=e.target.closest(".nm-form [data-f]"); if(!f||!E.form) return;
      if(f.dataset.f==="key"){ readForm(); render(); } });
    host.addEventListener("input", e=>{ const f=e.target.closest('.nm-form [data-f="href"]'); if(!f) return;
      const h=host.querySelector(".nm-form [data-hint]"); if(!h) return; const v=f.value.trim(); const r=v?routeHint(v):null;
      h.textContent=r?r.text:"A console address (#… — any page, with its filters) or an https:// link (opens in a new tab)."; h.classList.toggle("bad",!!(r&&!r.ok)); });
    host.addEventListener("keydown", e=>{ if(!E||!E.form) return; if(e.key==="Enter"&&e.target.matches(".nm-form input")){ e.preventDefault(); commitForm(); } else if(e.key==="Escape"){ E.form=null; render(); } });
  }

  window.renderNavMenuCfg=function(el){
    host=el||host||$("#navMenuCfg"); if(!host) return;
    ensureCss();
    /* a direct load of #settings-nav can route before the deferred navmenu.js has run — wait for it */
    if(!window.NAVMENU){ host.innerHTML=`<div class="panel"><h2>Header menus</h2><div class="sub">Loading…</div></div>`;
      const h=host; document.addEventListener("navmenuready",()=>window.renderNavMenuCfg(h),{once:true}); return; }
    wire();
    CAT=new Map(N().catalogue().map(c=>[c.key,c]));
    if(!ROLES.length) loadRoles().then(()=>{ if(E) render(); });
    const savedSig=()=>sig(N().savedItems());
    if(!E||(!E.form&&sig(E.items)===E.saved&&!E.previewing)){
      E={ items:N().current(), saved:savedSig(), form:null, msg:null, previewing:false, fold:new Set() };
      E.items.forEach(x=>{ if(x.t==="menu"&&(x.items||[]).length>6) E.fold.add(x.key); });   // long menus start folded: the tree reads at a glance
      /* re-read the server copy (another admin may have saved since this page loaded); keep any edit already started */
      const before=sig(E.items);
      N().load().catch(()=>null).then(()=>{ if(E.form||sig(E.items)!==before) return; E.items=N().current(); E.saved=savedSig(); render(); });
    }
    render();
  };
})();
