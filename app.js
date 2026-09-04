/* Salam DMS · MVNO Unified Console — renderers */
(function(){
"use strict";
const $ = s => document.querySelector(s);
const el = (t, cls, html) => { const e = document.createElement(t); if(cls) e.className = cls; if(html!=null) e.innerHTML = html; return e; };
const esc = s => String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;");

/* ============ NAV ============ */
document.querySelectorAll(".navtab").forEach(b=>{
  b.addEventListener("click", ()=>{
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.remove("on");
    b.classList.add("active");
    $("#view-"+b.dataset.view).classList.add("active");
  });
});
/* Settings open from the header gear via a small submenu — see settingsmenu.js */

/* ============ LANE COLORS ============ */
const SYS_COLOR = {
  "Customer / App":"#2563eb","Rails API":"#0e9f5a","Sidekiq":"#475569",
  "Oracle BSS":"#0d9488","Semati (CITC)":"#0d9488","Absher":"#7c3aed","TCC":"#0d9488","SSE":"#0d9488","PCalls":"#0d9488",
  "Nafath / IAM":"#7c3aed",
  "HyperPay":"#ea580c","Tap":"#ea580c","Tamara":"#ea580c","SalamPay / Merchalink":"#ea580c","EMKAN":"#ea580c","Hyperbill":"#ea580c",
  "SMSA":"#d97706","OTO":"#d97706","Barq":"#d97706","TAM":"#d97706","iMile":"#d97706","STCC":"#d97706","Manarat":"#d97706",
  "Saleor":"#2563eb","ZATCA (ClearTax)":"#dc2626",
  "Unifonic / Msegat":"#0891b2","SMTP":"#0891b2","Slack":"#0891b2","CVM":"#64748b","Adjust":"#64748b","Google Maps":"#64748b"
};
const laneColor = n => SYS_COLOR[n] || "#64748b";
// theme-aware color reader for inline SVG
const tv = (name, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; };

/* ============ SAMPLE RESOLVER ============ */
const SAMPLE_INDEX = (function(){
  const idx = {};
  if(typeof API_SAMPLES==="undefined") return idx;
  const norm = k => k.replace(/^(\w+(\|\w+)?)\s+/, (m,v)=>v.split("|")[0]+" ")
                      .replace(/\s*\(.*?\)\s*$/,"")     // drop "(OnboardingOrder)" suffix
                      .replace(/\/api\/v\d+\//,"/api/")  // strip version segment
                      .replace(/:[a-z_]+/g,":x")
                      .replace(/\?.*$/,"").replace(/\/$/,"").trim();
  Object.keys(API_SAMPLES).forEach(k=>{
    const n = norm(k);
    if(!idx[n]) idx[n] = {key:k, sample:API_SAMPLES[k]};
    // also index payment/initiate variants by object_type
  });
  idx.__objtype = {};
  Object.keys(API_SAMPLES).forEach(k=>{
    const m = k.match(/payment\/initiate\s*\((\w+)\)/i);
    if(m) idx.__objtype[m[1].toLowerCase()] = {key:k, sample:API_SAMPLES[k]};
  });
  return idx;
})();
function firstEndpoint(epRaw){
  // split composite ep strings and return the first concrete "VERB /path"
  const parts = epRaw.split(/ → | · | OR /);
  for(const p of parts){
    const pt = p.trim();
    const vm = pt.match(/^(GET|POST|PUT|PATCH|DELETE)(?:[|/](?:GET|POST|PUT|PATCH|DELETE))?\b/);
    if(!vm) continue;
    // find first real path token AFTER the verb token (avoids grabbing /POST from "GET/POST")
    const pm = pt.slice(vm[0].length).match(/\/[A-Za-z][^\s]*/);
    if(!pm) continue;
    let path = pm[0]
      .replace(/\([^)]*\)/g,"")   // strip inline "(_otp)", "(_with_account)"
      .replace(/\(.*$/,"")        // strip unclosed "(…"
      .split("?")[0]              // drop query
      .replace(/[.,;…)]+$/,"")    // trailing punctuation
      .split("|")[0];             // /prepaid|postpaid → /prepaid
    return {verb:vm[1], path};
  }
  return null;
}
function resolveSample(epRaw){
  const fe = firstEndpoint(epRaw); if(!fe) return null;
  // payment initiate → pick object_type variant
  if(/payment\/initiate/.test(fe.path)){
    const ot = (epRaw.match(/object_type=(\w+)/)||[])[1];
    if(ot && SAMPLE_INDEX.__objtype[ot.toLowerCase()]) return SAMPLE_INDEX.__objtype[ot.toLowerCase()];
    // default to onboarding
    if(SAMPLE_INDEX.__objtype["onboardingorder"]) return SAMPLE_INDEX.__objtype["onboardingorder"];
  }
  const norm = (fe.verb+" "+fe.path).replace(/\/api\/v\d+\//,"/api/").replace(/:[a-z_]+/g,":x").replace(/\/$/,"");
  if(SAMPLE_INDEX[norm]) return SAMPLE_INDEX[norm];
  // try path-only (ignore verb)
  const pathNorm = fe.path.replace(/\/api\/v\d+\//,"/api/").replace(/:[a-z_]+/g,":x").replace(/\/$/,"");
  const hit = Object.keys(SAMPLE_INDEX).find(k=> k!=="__objtype" && k.split(" ").slice(1).join(" ")===pathNorm);
  if(hit) return SAMPLE_INDEX[hit];
  // suffix match (short paths like /:id/double_auth_list)
  const suf = Object.keys(SAMPLE_INDEX).find(k=> k!=="__objtype" && (k.endsWith(pathNorm) || pathNorm.endsWith(k.split(" ").slice(1).join(" "))));
  if(suf) return SAMPLE_INDEX[suf];
  return {missing:true, ep:fe.verb+" "+fe.path};
}
/* ============ OFFICIAL API DOCS (Apollo/Sedco Slate reference) ============ */
// Manual, reliable endpoint → doc anchor map for the documented partner surface.
const DOC_ANCHOR = {
  "GET /api/apollo/plans":"plans",
  "GET /api/apollo/numbers":"get-numbers",
  "POST /api/apollo/numbers/reserve":"reserve-number",
  "DELETE /api/apollo/numbers/unreserve":"unreserve-number",
  "GET /api/apollo/numbers/vanities":"vanities",
  "POST /api/apollo/eligibility":"eligibility",
  "POST /api/apollo/semati/authorize":"nafath-v2",
  "GET /api/apollo/semati/check":"nafath-v2",
  "POST /api/apollo/checkout":"checkout",
  "POST /api/apollo/checkout/otp_confirm":"otp",
  "POST /api/apollo/checkout/otp_resend":"otp",
  "POST /api/apollo/checkout/confirm":"checkout-confirmation-payment",
  "POST /api/apollo/checkout/refund":"checkout-refund-payment",
  "POST /api/apollo/activation":"activation",
  "GET /api/apollo/checkout/esim_details":"activation-code-details",
  "GET /api/apollo/checkout/esim_qr":"activation-code-details",
  "POST /api/sedco/semati/authorize":"nafath-v2",
  "GET /api/sedco/semati/check":"nafath-v2",
  "POST /api/tygo/checkout":"checkout"
};
const DOC_BY_ID = {};
if(typeof API_DOCS!=="undefined") API_DOCS.forEach(d=>{ if(!DOC_BY_ID[d.id]||d.methodPath) DOC_BY_ID[d.id]=d; });
function resolveDoc(epRaw){
  const fe = firstEndpoint(epRaw); if(!fe) return null;
  const key = (fe.verb+" "+fe.path).replace(/\/api\/v\d+\//,"/api/").replace(/:[a-z_]+/g,":x").replace(/\/$/,"");
  // exact against DOC_ANCHOR (normalize its keys the same way)
  for(const k of Object.keys(DOC_ANCHOR)){
    const nk = k.replace(/:[a-z_]+/g,":x").replace(/\/$/,"");
    if(nk===key) return DOC_BY_ID[DOC_ANCHOR[k]] ? {doc:DOC_BY_ID[DOC_ANCHOR[k]], anchor:DOC_ANCHOR[k]} : {anchor:DOC_ANCHOR[k]};
  }
  return null;
}
function curlHi(txt){
  return esc(txt)
    .replace(/(-X\s*&quot;?\w+&quot;?)/,'<span class="b">$1</span>')
    .replace(/(-H\s*&#39;[^&]*&#39;)/g,'<span class="s">$1</span>')
    .replace(/(https?:\/\/[^\s&]+)/,'<span class="k">$1</span>');
}
function renderDocBlock(epRaw){
  const r = resolveDoc(epRaw); if(!r) return "";
  const anchorUrl = (typeof API_DOC_BASE!=="undefined"?API_DOC_BASE:"") + "#" + r.anchor;
  let h = `<div class="docblock"><div class="dochd"><span class="badge">📖 OFFICIAL API DOC</span>`;
  h += `<a class="livelink" href="${anchorUrl}" target="_blank" rel="noopener">Open live doc ↗</a></div>`;
  const d = r.doc;
  if(!d){ h += `<div class="prose">This endpoint is documented in the Salam partner API reference. Open the live doc for full details.</div></div>`; return h; }
  if(d.methodPath) h += `<div style="font-family:var(--mono);font-size:11.5px;color:#3730a3;margin-bottom:6px"><b>${esc(d.methodPath)}</b></div>`;
  if(d.prose && d.prose.length) h += `<div class="prose">${esc(d.prose.slice(0,2).join(" "))}</div>`;
  if(d.params && d.params.length){
    h += `<table class="params"><tr><th>PARAM</th><th>REQUIRED</th><th>DESCRIPTION</th></tr>`;
    d.params.forEach(p=>{ const req=/true|yes|required/i.test(p.required); h += `<tr><td>${esc(p.param)}</td><td class="${req?'req-yes':'req-no'}">${esc(p.required||'—')}</td><td>${esc(p.desc)}</td></tr>`; });
    h += `</table>`;
  }
  const hasCurl=d.curls&&d.curls.length, hasRes=d.responses&&d.responses.length;
  if(hasCurl||hasRes){
    const gid = "doc"+Math.random().toString(36).slice(2,7);
    h += `<div class="tabbtns">`;
    if(hasCurl) h += `<button class="tabbtn on" data-tab="${gid}-curl">curl request</button>`;
    if(hasRes) h += `<button class="tabbtn${hasCurl?'':' on'}" data-tab="${gid}-res">response</button>`;
    h += `</div>`;
    if(hasCurl) h += `<div class="codeblk" id="${gid}-curl">${curlHi(d.curls[0])}</div>`;
    if(hasRes) h += `<div class="codeblk" id="${gid}-res" style="display:${hasCurl?'none':'block'}">${esc(d.responses[0].slice(0,2600))}</div>`;
  }
  // referenced error codes
  if(typeof API_ERROR_CODES!=="undefined" && API_ERROR_CODES.length){
    h += `<div style="font-size:10px;letter-spacing:1px;color:#4338ca;font-weight:800;margin-top:10px">GLOBAL ERROR CODES</div><div class="errchips">`;
    API_ERROR_CODES.slice(0,16).forEach(e=>{ h += `<span class="errchip" title="${esc(e.message)} (HTTP ${esc(e.http)})">${esc(e.code)} ${esc(e.message).slice(0,22)}</span>`; });
    h += `</div>`;
  }
  h += `</div>`;
  return h;
}

function jsonHi(obj){
  let s = JSON.stringify(obj, null, 2);
  s = esc(s);
  s = s.replace(/&quot;([^&]+)&quot;(\s*:)/g,'<span class="k">&quot;$1&quot;</span>$2')
       .replace(/:\s*&quot;([^&]*)&quot;/g,': <span class="s">&quot;$1&quot;</span>')
       .replace(/:\s*(-?\d+\.?\d*)/g,': <span class="b">$1</span>')
       .replace(/:\s*(true|false|null)/g,': <span class="n">$1</span>');
  return s;
}
function openSampleModal(epRaw){
  const r = resolveSample(epRaw);
  const card = $("#sampleModalCard");
  const fe = firstEndpoint(epRaw) || {verb:"GET", path:epRaw};
  let h = `<div class="modal-head"><span class="verb ${fe.verb}">${esc(fe.verb)}</span><span class="path">${esc(fe.path)}</span><span class="x" id="modalClose">×</span></div><div class="modal-body">`;
  if(!r || r.missing){
    h += `<div class="nosample">No request/response sample catalogued for <code>${esc(r?r.ep:epRaw)}</code> yet. The 138+ sampled endpoints cover the main journeys; this one is a secondary/utility route. Shapes can be added to <code>samples.js</code>.</div>`;
  } else {
    const s = r.sample;
    h += `<h5>REQUEST</h5>`;
    if(s.req && s.req.headers && Object.keys(s.req.headers).length) h += `<div style="font-size:11px;color:#64748b;margin-bottom:5px">headers: ${Object.entries(s.req.headers).map(([k,v])=>`<code>${esc(k)}: ${esc(v)}</code>`).join("  ")}</div>`;
    if(s.req && s.req.query) h += `<div class="codeblk">${jsonHi(s.req.query)}</div>`;
    if(s.req && s.req.body!=null) h += `<div class="codeblk">${jsonHi(s.req.body)}</div>`;
    if(s.req && s.req.note) h += `<div style="font-size:11.5px;color:#92400e;margin-top:5px">${esc(s.req.note)}</div>`;
    if(!s.req || (s.req.body==null && !s.req.query)) h += `<div style="font-size:12px;color:#64748b">No request body (path/query only).</div>`;
    h += `<h5>RESPONSE</h5>`;
    if(s.res){
      h += `<div class="statusrow"><span class="stcode ok">${s.res.status||200}</span>${s.res.contentType?`<span style="font-size:11px;color:#64748b;align-self:center">${esc(s.res.contentType)}</span>`:""}</div>`;
      h += `<div class="codeblk">${typeof s.res.body==="string"?esc(s.res.body):jsonHi(s.res.body)}</div>`;
    }
    if(s.errors && s.errors.length){
      h += `<h5>ERROR RESPONSES</h5>`;
      s.errors.forEach(e=>{ h += `<div class="erritem"><div class="statusrow"><span class="stcode err">${e.status}</span></div><div class="codeblk">${jsonHi(e.body)}</div></div>`; });
    }
    if(s.logSig) h += `<h5>LOG SIGNATURE</h5><div class="logsig">${esc(s.logSig)}</div>`;
  }
  // official documentation block (Apollo/Sedco documented endpoints)
  const docHtml = renderDocBlock(epRaw);
  if(docHtml){ h += `<h5>DOCUMENTATION</h5>` + docHtml; }
  h += `</div>`;
  card.innerHTML = h;
  $("#sampleModal").classList.add("open");
  $("#modalClose").addEventListener("click", closeSampleModal);
  // doc tab switching
  card.querySelectorAll(".tabbtn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const target = btn.dataset.tab;
      const group = btn.parentElement;
      group.querySelectorAll(".tabbtn").forEach(b=>b.classList.remove("on"));
      btn.classList.add("on");
      // hide sibling code blocks in same doc group (share id prefix)
      const prefix = target.split("-").slice(0,-1).join("-");
      ["curl","res"].forEach(k=>{ const elx = card.querySelector("#"+prefix+"-"+k); if(elx) elx.style.display = (prefix+"-"+k===target)?"block":"none"; });
    });
  });
}
function closeSampleModal(){ $("#sampleModal").classList.remove("open"); }
document.getElementById("sampleModal").addEventListener("click", e=>{ if(e.target.id==="sampleModal") closeSampleModal(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeSampleModal(); });

/* ============ SEQUENCE DIAGRAM ============ */
function renderSequence(step, mode){
  const lanes = ["Customer / App","Rails API"];
  (step.intg||[]).forEach(i=>{ if(!lanes.includes(i)) lanes.push(i); });
  if(step.async){ if(!lanes.includes("Sidekiq")) lanes.push("Sidekiq");
    (step.async.to||[]).forEach(i=>{ if(!lanes.includes(i)) lanes.push(i); }); }
  const arrows = [];
  const isAsyncOnly = (step.ep||"").startsWith("—");
  if(!isAsyncOnly) arrows.push({f:"Customer / App", t:"Rails API", label: step.ep.length>62 ? step.ep.slice(0,60)+"…" : step.ep, kind:"api", clickable:true});
  (step.intg||[]).forEach(i=> arrows.push({f:"Rails API", t:i, label: laneCallLabel(step,i), kind:"sync"}));
  if(step.async){
    arrows.push({f:"Rails API", t:"Sidekiq", label:`enqueue ${step.async.w} · q:${step.async.q}`, kind:"async"});
    (step.async.to||[]).forEach(i=> arrows.push({f:"Sidekiq", t:i, label: step.async.w.split("::").pop()+" → "+i, kind:"sync"}));
  }
  if(mode==="failure" && step.fail) step.fail.forEach(f=> arrows.push({f:"Rails API", t:"Customer / App", label:"✕ "+f.at+": "+f.why, kind:"fail"}));

  const laneW = Math.max(150, Math.min(210, 1060/lanes.length));
  const W = laneW*lanes.length + 40, rowH = 44, topY = 56;
  const H = topY + arrows.length*rowH + 44;
  const X = i => 20 + laneW*i + laneW/2;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:inherit">`;
  s += `<defs>`;
  ["api","sync","async","fail"].forEach(k=>{
    const c = k==="api"?"#2563eb":k==="fail"?"#dc2626":k==="async"?"#64748b":"#ea580c";
    s += `<marker id="ar-${k}" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${c}"/></marker>`;
  });
  s += `</defs>`;
  lanes.forEach((l,i)=>{
    const c = laneColor(l), x = X(i);
    s += `<line x1="${x}" y1="${topY}" x2="${x}" y2="${H-16}" stroke="${tv('--line','#cbd5e1')}" stroke-dasharray="4 5" stroke-width="1"/>`;
    const bw = Math.min(laneW-14, 176);
    s += `<rect x="${x-bw/2}" y="12" width="${bw}" height="32" rx="9" fill="${tv('--card','#fff')}" stroke="${c}" stroke-width="1.6"/>`;
    s += `<text x="${x}" y="32" text-anchor="middle" font-size="11.5" font-weight="700" fill="${c}">${esc(l.length>24?l.slice(0,23)+"…":l)}</text>`;
  });
  arrows.forEach((a,i)=>{
    const y = topY + 22 + i*rowH;
    const x1 = X(lanes.indexOf(a.f)), x2 = X(lanes.indexOf(a.t));
    const c = a.kind==="api"?"#2563eb":a.kind==="fail"?"#dc2626":a.kind==="async"?"#64748b":"#ea580c";
    const dash = a.kind==="async"?` stroke-dasharray="6 4"`:a.kind==="fail"?` stroke-dasharray="3 3"`:"";
    s += `<line x1="${x1}" y1="${y}" x2="${x2+(x2>x1?-6:6)}" y2="${y}" stroke="${c}" stroke-width="1.7"${dash} marker-end="url(#ar-${a.kind})"/>`;
    const mx = (x1+x2)/2;
    const lbl = a.label.length>66 ? a.label.slice(0,64)+"…" : a.label;
    const cls = a.clickable ? ' class="apihit"' : '';
    const dataep = a.clickable ? ` data-ep="${esc(step.ep)}"` : '';
    if(a.clickable){
      s += `<text x="${mx}" y="${y-7}" text-anchor="middle" font-size="10.3" font-family="ui-monospace,Menlo,monospace" fill="#2563eb"${cls}${dataep} style="text-decoration:underline;text-decoration-style:dotted">${esc(lbl)}  ⤢</text>`;
    } else {
      s += `<text x="${mx}" y="${y-7}" text-anchor="middle" font-size="10.3" font-family="ui-monospace,Menlo,monospace" fill="${a.kind==='fail'?'#b91c1c':tv('--ink-soft','#334155')}">${esc(lbl)}</text>`;
    }
  });
  s += `</svg>`;
  return s;
}
function laneCallLabel(step, intg){
  const svc = (step.svc||[]).find(x=> x.toLowerCase().includes(intg.split(" ")[0].toLowerCase()));
  return svc || (step.svc&&step.svc[0]) || intg;
}

/* ============ STEP DETAIL PANEL ============ */
function renderStepDetail(j, idx, mode){
  const st = j.steps[idx];
  let h = `<h3>${idx+1}. ${esc(st.n)}</h3><div class="stepdesc">${esc(st.d)}</div>`;
  h += `<div class="seqwrap">${renderSequence(st, mode)}</div>`;
  h += `<div class="legend"><span><i style="background:#2563eb"></i>channel call</span><span><i style="background:#ea580c"></i>sync integration</span><span><i style="background:#64748b"></i>async enqueue</span><span><i style="background:#dc2626"></i>failure</span></div>`;
  h += `<div class="infocols"><div class="infocard"><h4>CALLS THIS STEP MAKES</h4><ul>`;
  if(!(st.ep||"").startsWith("—")){
    h += `<li><code class="apilink" data-ep="${esc(st.ep)}">${esc(st.ep)}</code></li>`;
    h += `<li class="clickhint">▸ click the endpoint (or the blue call arrow) for request / response sample</li>`;
  }
  h += `<li><b>Controller:</b> <span style="font-family:var(--mono);font-size:11px">${esc(st.ctl)}</span></li>`;
  if(st.svc && st.svc.length) h += `<li><b>Services:</b> ${st.svc.map(x=>`<code>${esc(x)}</code>`).join(" ")}</li>`;
  if(st.async) h += `<li><b>Async:</b> <code>${esc(st.async.w)}</code> on queue <code>${esc(st.async.q)}</code> → ${st.async.to.map(esc).join(", ")}</li>`;
  h += `</ul>`;
  if(st.tbl && st.tbl.length) h += `<div class="chips" style="margin-top:6px">${st.tbl.map(t=>`<span class="chip tbl">${esc(t)}</span>`).join("")}</div>`;
  if(st.st && st.st!=="—") h += `<div style="margin-top:8px"><span class="chip st">state: ${esc(st.st)}</span></div>`;
  h += `</div><div class="infocard"><h4>${mode==="failure"?"FAILURE MODES":"ON SUCCESS"}</h4>`;
  if(mode==="failure"){
    if(st.fail && st.fail.length) st.fail.forEach(f=>{ h += `<div class="failbox"><b>${esc(f.at)}</b> — ${esc(f.why)}<br><span style="color:#7f1d1d">↳ ${esc(f.fx)}</span></div>`; });
    else h += `<div class="okbox">No known failure branch at this step — validation happens up/downstream.</div>`;
  } else {
    h += `<div class="okbox">${esc(st.ok || "Step completes and the journey advances.")}</div>`;
  }
  h += `</div></div>`;
  return h;
}

/* ============ JOURNEY CATEGORIES + FILTERABLE PICKER ============ */
const CATEGORIES = [
  {id:"onboarding", label:"Onboarding",           color:"#0e9f5a", ids:["onb-physical","onb-esim","mnp","visitor"]},
  {id:"identity",   label:"Identity & Activation",color:"#7c3aed", ids:["nafath","activation","dealer-v12","datasim"]},
  {id:"dealer",     label:"Dealer & Partner",     color:"#ea580c", ids:["qr-posa","seller","apollo"]},
  {id:"payments",   label:"Payments & Billing",   color:"#2563eb", ids:["recharge","bill","renewal","payment-backbone"]},
  {id:"account",    label:"Account & Plan",       color:"#0d9488", ids:["change-plan","balance-transfer","sim-replacement","ot","termination","services","auth"]},
  {id:"commerce",   label:"Commerce & Browse",    color:"#d97706", ids:["saleor","guest-browse"]}
];
const CAT_OF = {};       // journeyId -> category
CATEGORIES.forEach(c=> c.ids.forEach(id=> CAT_OF[id]=c));
const catColor = jid => (CAT_OF[jid]||{}).color || "#64748b";

/* billing model per journey: subset of {prepaid, postpaid}. both = hybrid (billing-agnostic / switch). */
const BILLING_TAGS = {
  "onb-physical":["prepaid","postpaid"], "onb-esim":["prepaid","postpaid"], "mnp":["prepaid","postpaid"],
  "nafath":["prepaid","postpaid"], "activation":["prepaid","postpaid"], "qr-posa":["prepaid"],
  "seller":["prepaid","postpaid"], "dealer-v12":["prepaid","postpaid"], "visitor":["prepaid"],
  "ot":["prepaid","postpaid"], "change-plan":["prepaid","postpaid"], "balance-transfer":["prepaid"],
  "recharge":["prepaid"], "bill":["postpaid"], "renewal":["prepaid","postpaid"],
  "sim-replacement":["prepaid","postpaid"], "termination":["prepaid","postpaid"], "saleor":["prepaid","postpaid"],
  "datasim":["prepaid","postpaid"], "apollo":["prepaid","postpaid"], "services":["prepaid","postpaid"],
  "auth":["prepaid","postpaid"], "payment-backbone":["prepaid","postpaid"], "guest-browse":["prepaid","postpaid"]
};
/* access model per journey: subset of {logged, guest}. guest = anonymous / guest-OTP / visitor / partner-collected. */
const AUTH_TAGS = {
  "onb-physical":["guest"], "onb-esim":["guest"], "mnp":["guest"], "nafath":["logged","guest"],
  "activation":["guest"], "qr-posa":["guest"], "seller":["logged"], "dealer-v12":["logged"],
  "visitor":["guest"], "ot":["logged","guest"], "change-plan":["logged"], "balance-transfer":["logged"],
  "recharge":["logged","guest"], "bill":["logged","guest"], "renewal":["logged","guest"],
  "sim-replacement":["logged"], "termination":["logged"], "saleor":["logged","guest"],
  "datasim":["logged"], "apollo":["guest"], "services":["logged"], "auth":["logged","guest"],
  "payment-backbone":["logged","guest"], "guest-browse":["guest"]
};
const billingOf = id => BILLING_TAGS[id] || ["prepaid","postpaid"];
const authOf = id => AUTH_TAGS[id] || ["logged","guest"];
const billingBadge = id => { const b=billingOf(id); return b.length===2?"HYB":b[0]==="prepaid"?"PRE":"POST"; };
function billingMatch(id, sel){ const b=billingOf(id); return sel==="all" || (sel==="hybrid"? b.length===2 : b.includes(sel)); }
function authMatch(id, sel){ const a=authOf(id); return sel==="all" || a.includes(sel); }

// picker state per view
function buildPicker(cfg){
  // cfg: {filterEl, pillsEl, state:{cat,q}, getActive:()=>index, onPick:(index)=>void}
  const {filterEl, pillsEl, state, getActive, onPick} = cfg;
  // filter bar (built once)
  if(!filterEl.dataset.built){
    filterEl.dataset.built = "1";
    if(state.billing===undefined) state.billing="all";
    if(state.auth===undefined) state.auth="all";
    // row 1: search + category chips
    const row1 = el("div","jrow");
    const search = el("input","jsearch"); search.type="text"; search.placeholder="Search journeys…";
    search.addEventListener("input", ()=>{ state.q = search.value.trim().toLowerCase(); renderCats(); renderPills(); });
    const cats = el("div","jcats");
    row1.appendChild(search); row1.appendChild(cats);
    // row 2: billing + access segmented controls
    const row2 = el("div","jrow jrow2");
    const seg = (label, key, opts) => {
      const wrap = el("div","segwrap");
      wrap.appendChild(el("span","seglbl", label));
      const g = el("div","seg");
      opts.forEach(o=>{
        const b = el("button","segbtn"+(state[key]===o.v?" on":""), o.t);
        b.dataset.v=o.v; if(o.c) b.style.setProperty("--sc",o.c);
        b.addEventListener("click",()=>{ state[key]=o.v; g.querySelectorAll(".segbtn").forEach(x=>x.classList.toggle("on", x.dataset.v===o.v)); renderCats(); renderPills(); });
        g.appendChild(b);
      });
      wrap.appendChild(g); return wrap;
    };
    row2.appendChild(seg("Billing", "billing", [
      {v:"all",t:"All"},{v:"prepaid",t:"Prepaid",c:"#0e9f5a"},{v:"postpaid",t:"Postpaid",c:"#2563eb"},{v:"hybrid",t:"Hybrid",c:"#7c3aed"}]));
    row2.appendChild(seg("Access", "auth", [
      {v:"all",t:"All"},{v:"logged",t:"Logged-in",c:"#0d9488"},{v:"guest",t:"Guest / Visitor",c:"#ea580c"}]));
    filterEl.appendChild(row1); filterEl.appendChild(row2);
    filterEl._cats = cats;
  }
  const cats = filterEl._cats;
  function matches(j){
    const inCat = state.cat==="all" || (CAT_OF[j.id]&&CAT_OF[j.id].id===state.cat);
    const inQ = !state.q || j.name.toLowerCase().includes(state.q) || (j.tag||"").toLowerCase().includes(state.q) || (j.channel||"").toLowerCase().includes(state.q);
    return inCat && inQ && billingMatch(j.id, state.billing) && authMatch(j.id, state.auth);
  }
  function renderCats(){
    const qcount = id => JOURNEYS.filter(j=> (id==="all"|| (CAT_OF[j.id]&&CAT_OF[j.id].id===id)) && (!state.q || j.name.toLowerCase().includes(state.q)) && billingMatch(j.id,state.billing) && authMatch(j.id,state.auth)).length;
    cats.innerHTML = "";
    const allC = el("button","jcat"+(state.cat==="all"?" active":""), `<span class="cdot" style="--cc:#334155"></span>All <span class="cnt">${qcount("all")}</span>`);
    allC.style.setProperty("--cc","#334155");
    allC.addEventListener("click",()=>{ state.cat="all"; renderCats(); renderPills(); });
    cats.appendChild(allC);
    CATEGORIES.forEach(c=>{
      const n = qcount(c.id); if(n===0 && state.q) return; // hide empty cats while searching
      const b = el("button","jcat"+(state.cat===c.id?" active":""), `<span class="cdot"></span>${esc(c.label)} <span class="cnt">${n}</span>`);
      b.style.setProperty("--cc", c.color);
      b.addEventListener("click",()=>{ state.cat = state.cat===c.id?"all":c.id; renderCats(); renderPills(); });
      cats.appendChild(b);
    });
  }
  function renderPills(){
    pillsEl.innerHTML = "";
    const active = getActive();
    let shown = 0;
    JOURNEYS.forEach((j,i)=>{
      if(!matches(j)) return;
      shown++;
      const bb = billingBadge(j.id);
      const p = el("button","pill"+(i===active?" active":""), `${esc(j.name)}<span class="tag bt-${bb.toLowerCase()}">${bb}</span><span class="tag">${esc(j.tag)}</span>`);
      p.style.setProperty("--pc", catColor(j.id));
      p.addEventListener("click",()=> onPick(i));
      pillsEl.appendChild(p);
    });
    if(shown===0) pillsEl.appendChild(el("div","jempty","No journeys match — try another category or clear the search."));
  }
  cfg._refresh = ()=>{ renderCats(); renderPills(); };
  renderCats(); renderPills();
  return cfg;
}

/* bind clickable API endpoints inside a stage container */
function bindSampleClicks(container){
  container.querySelectorAll("[data-ep]").forEach(node=>{
    node.style.cursor = "pointer";
    node.addEventListener("click", ()=> openSampleModal(node.getAttribute("data-ep")));
  });
}

/* ============ EXPLORER ============ */
const ex = {j:0, s:0, mode:"success", filter:{cat:"all", q:""}, timer:null};
let exPicker;
function exStop(){ if(ex.timer){ clearInterval(ex.timer); ex.timer=null; const b=$("#ePlay"); if(b) b.textContent="▶ Play"; } }
function exRender(){
  const j = JOURNEYS[ex.j];
  if(exPicker) exPicker._refresh();
  $("#explorerDesc").innerHTML = j.desc + ` &nbsp;·&nbsp; <b>Channel:</b> ${esc(j.channel)}`;
  const list = $("#explorerSteps"); list.innerHTML = "";
  j.steps.forEach((s,i)=>{
    const it = el("div","stepitem"+(i===ex.s?" active":""), `<div class="idx">${i+1}</div><div class="nm">${esc(s.n)}</div><div class="id">${esc((s.ep||"").split(" ").pop().split("?")[0].slice(0,34))}</div>`);
    it.addEventListener("click",()=>{ex.s=i;exRender();});
    list.appendChild(it);
  });
  $("#explorerStage").innerHTML = renderStepDetail(j, ex.s, ex.mode);
  bindSampleClicks($("#explorerStage"));
  $("#eCounter").textContent = (ex.s+1)+" / "+j.steps.length;
  const tg = $("#explorerMode");
  tg.querySelector('[data-mode="success"]').className = ex.mode==="success"?"on-success":"";
  tg.querySelector('[data-mode="failure"]').className = ex.mode==="failure"?"on-failure":"";
}
exPicker = buildPicker({
  filterEl: $("#explorerFilter"), pillsEl: $("#explorerPills"), state: ex.filter,
  getActive: ()=>ex.j, onPick:(i)=>{ exStop(); ex.j=i; ex.s=0; exRender(); }
});
$("#ePrev").addEventListener("click",()=>{exStop();if(ex.s>0){ex.s--;exRender();}});
$("#eNext").addEventListener("click",()=>{exStop();if(ex.s<JOURNEYS[ex.j].steps.length-1){ex.s++;exRender();}});
$("#ePlay").addEventListener("click",()=>{
  if(ex.timer){ exStop(); return; }
  $("#ePlay").textContent="⏸ Pause";
  ex.timer=setInterval(()=>{
    if(ex.s<JOURNEYS[ex.j].steps.length-1){ ex.s++; exRender(); $("#ePlay").textContent="⏸ Pause"; }
    else exStop();
  },2600);
});
$("#explorerMode").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ex.mode=b.dataset.mode;exRender();}));

/* ============ TOPOLOGY ============ */
const nodePos = {}, nodeMeta = {};
function topoLayout(){
  const colX = [30, 330, 660, 1040];
  const colW = [230, 260, 320, 340];
  const colY = [26, 26, 26, 26];
  TOPO_GROUPS.forEach(g=>{
    const x = colX[g.col], w = colW[g.col];
    let y = colY[g.col];
    g._x = x; g._y = y; g._w = w;
    const rows = g.nodes.length;
    let ny = y + 30;
    g.nodes.forEach(n=>{
      const h = n.big ? 58 : 46;
      nodePos[n.id] = {x: x+12, y: ny, w: w-24, h, cx: x+w/2, cy: ny+h/2, color: (TOPO_GROUPS.find(gg=>gg.nodes.includes(n))||{}).color};
      nodeMeta[n.id] = {label:n.label, sub:n.sub, group:g.label};
      ny += h + 10;
    });
    g._h = (ny - y) + 6;
    colY[g.col] = ny + 26;
  });
}
let _topoFilter = "all";
function topoDraw(filter){
  _topoFilter = filter;
  topoLayout();
  const svg = $("#topoSvg");
  const H = Math.max(...[0,1,2,3].map(c=>{
    let m=0; TOPO_GROUPS.filter(g=>g.col===c).forEach(g=>{m=Math.max(m,g._y+g._h);}); return m;
  })) + 20;
  svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 1420 ${H}`);
  let s = `<defs>`;
  Object.entries(FLOW_TYPES).forEach(([k,v])=>{
    s += `<marker id="tp-${k}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${v.color}"/></marker>`;
  });
  s += `<style>.edge{transition:opacity .15s}.edge text{font-size:9px;fill:${tv('--muted','#64748b')}}.flowdash{stroke-dasharray:7 5;animation:fdash 1.2s linear infinite}@keyframes fdash{to{stroke-dashoffset:-12}}</style></defs>`;
  // edges under nodes
  TOPO_EDGES.forEach((e,i)=>{
    if(filter && filter!=="all" && e.type!==filter) return;
    const a = nodePos[e.f], b = nodePos[e.t]; if(!a||!b) return;
    const c = FLOW_TYPES[e.type].color;
    const x1 = a.x + (b.cx>a.cx ? a.w : 0), y1 = a.cy;
    const x2 = b.x + (b.cx>a.cx ? 0 : b.w), y2 = b.cy;
    const dx = Math.max(40, Math.abs(x2-x1)*0.35);
    const path = `M ${x1} ${y1} C ${x1+(b.cx>a.cx?dx:-dx)} ${y1}, ${x2+(b.cx>a.cx?-dx:dx)} ${y2}, ${x2} ${y2}`;
    const anim = (filter && filter!=="all") ? " flowdash" : "";
    s += `<g class="edge" data-f="${e.f}" data-t="${e.t}"><path d="${path}" fill="none" stroke="${c}" stroke-width="1.5" opacity="${filter&&filter!=="all"?0.95:0.42}" class="${anim}" marker-end="url(#tp-${e.type})"/>`;
    if(filter && filter!=="all"){
      const mx=(x1+x2)/2, my=(y1+y2)/2 - 5;
      s += `<text x="${mx}" y="${my}" text-anchor="middle">${esc(e.label)}</text>`;
    }
    s += `</g>`;
  });
  // groups + nodes
  TOPO_GROUPS.forEach(g=>{
    s += `<rect x="${g._x}" y="${g._y}" width="${g._w}" height="${g._h}" rx="12" fill="${g.color}08" stroke="${g.color}33"/>`;
    s += `<text x="${g._x+12}" y="${g._y+19}" font-size="9.5" font-weight="800" letter-spacing="1.2" fill="${g.color}">${esc(g.label)}</text>`;
    g.nodes.forEach(n=>{
      const p = nodePos[n.id];
      s += `<g class="nodebox" data-node="${n.id}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="9" fill="${tv('--card','#fff')}" stroke="${g.color}" stroke-width="${n.big?2:1.3}"/>`;
      s += `<text x="${p.x+11}" y="${p.y+19}" font-size="12" font-weight="800" fill="${tv('--ink','#1a2b3c')}">${esc(n.label)}</text>`;
      s += `<text x="${p.x+11}" y="${p.y+(n.big?36:33)}" font-size="9.5" fill="${tv('--muted','#64748b')}">${esc(n.sub)}</text></g>`;
    });
  });
  svg.innerHTML = s;
  svg.querySelectorAll(".nodebox").forEach(nb=>{
    nb.addEventListener("click",()=>showNodeDetail(nb.dataset.node));
  });
}
function showNodeDetail(id){
  const m = nodeMeta[id];
  const flows = TOPO_EDGES.filter(e=>e.f===id||e.t===id);
  const d = $("#nodeDetail");
  d.style.display = "block";
  d.innerHTML = `<h4>${esc(m.label)}</h4><p>${esc(m.sub)} · <i>${esc(m.group)}</i></p>
    <div class="flows">${flows.map(e=>{
      const other = e.f===id ? nodeMeta[e.t].label : nodeMeta[e.f].label;
      const dir = e.f===id ? "→" : "←";
      return `<div><span style="color:${FLOW_TYPES[e.type].color};font-weight:800">${dir}</span> <b>${esc(other)}</b> — ${esc(e.label)}</div>`;
    }).join("")}</div>
    <div style="text-align:right;margin-top:8px"><button onclick="this.closest('#nodeDetail').style.display='none'" style="border:1px solid var(--line);background:var(--card2);color:var(--ink);border-radius:7px;padding:4px 10px;font-size:11px;cursor:pointer">Close</button></div>`;
}
// flow chips
(function(){
  const wrap = $("#flowChips");
  const all = el("button","fchip active",`<i style="background:#0e9f5a"></i>All`);
  all.addEventListener("click",()=>{setChip(all);topoDraw("all");});
  wrap.appendChild(all);
  Object.entries(FLOW_TYPES).forEach(([k,v])=>{
    const c = el("button","fchip",`<i style="background:${v.color}"></i>${v.label}`);
    c.addEventListener("click",()=>{setChip(c);topoDraw(k);});
    wrap.appendChild(c);
  });
  function setChip(active){ wrap.querySelectorAll(".fchip").forEach(x=>x.classList.remove("active")); active.classList.add("active"); }
})();

/* ============ INTEGRATIONS VIEW ============ */
(function(){
  const dirBadge = d => `<span class="dir ${d==="both"?"both":d==="out"?"out":"in"}">${d==="both"?"OUT+WEBHOOK":d.toUpperCase()}</span>`;
  let h = `<h3 style="margin:14px 0 6px;font-size:14px">External integrations (${INTEGRATIONS.length})</h3>
  <table class="cat"><tr><th>SYSTEM</th><th>CATEGORY</th><th>DIRECTION</th><th>IMPLEMENTATION</th><th>TRIGGERED FROM</th><th>NOTES</th></tr>`;
  INTEGRATIONS.forEach(i=>{ h += `<tr><td><b>${esc(i.name)}</b></td><td>${esc(i.cat)}</td><td>${dirBadge(i.dir)}</td><td><code>${esc(i.cls)}</code></td><td>${esc(i.from)}</td><td>${esc(i.note)}</td></tr>`; });
  h += `</table>`;
  h += `<h3 style="margin:22px 0 6px;font-size:14px">Inbound webhooks & callbacks</h3>
  <table class="cat"><tr><th>ENDPOINT</th><th>CALLER</th><th>EFFECT</th></tr>`;
  WEBHOOKS.forEach(w=>{ h += `<tr><td><code>${esc(w.path)}</code></td><td>${esc(w.caller)}</td><td>${esc(w.does)}</td></tr>`; });
  h += `</table>`;
  h += `<h3 style="margin:22px 0 6px;font-size:14px">Sidekiq workers (43 classes)</h3>
  <div class="desc" style="margin-bottom:8px"><b>Queues:</b> ${esc(QUEUES)}</div>
  <table class="cat"><tr><th>WORKER(S)</th><th>QUEUE</th><th>RESPONSIBILITY</th></tr>`;
  WORKERS.forEach(w=>{ h += `<tr><td><code>${esc(w.w)}</code></td><td>${esc(w.q)}</td><td>${esc(w.does)}</td></tr>`; });
  h += `</table>`;
  h += `<h3 style="margin:22px 0 6px;font-size:14px">Cron (whenever)</h3><ul style="padding-left:18px;font-size:12.5px;line-height:1.9">`;
  CRON.forEach(c=>{ h += `<li>${esc(c)}</li>`; });
  h += `</ul>`;
  $("#integrationsBody").innerHTML = h;
})();

/* re-render SVG-bearing views when the theme changes */
document.addEventListener("themechange", ()=>{
  try { topoDraw(_topoFilter); } catch(e){}
  try { exRender(); } catch(e){}
});

/* init */
topoDraw("all");
exRender();
})();

/* 360 quick-access pill (3 Sep 2026) — clicks through to the existing sub360 navtab so every
   permission/router rule applies unchanged; active state follows the hash (incl. deep links). */
(function(){
  const b=document.getElementById('nav360'); if(!b) return;
  b.addEventListener('click', ()=>{
    const t=document.querySelector('.navtab[data-view="sub360"]');
    if(t) t.click(); else location.hash='#subscriber';
  });
  const upd=()=>b.classList.toggle('active', /^#subscriber/.test(location.hash||''));
  window.addEventListener('hashchange', upd); upd();
})();
