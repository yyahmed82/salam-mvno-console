/* Vendors & contracts page — Super Admin-only SLA/SLO reference catalog. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const API = window.API_BASE || "";
  const esc = s => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const api = (p, opts) => window.fetch(API + p, Object.assign({ headers: { "Content-Type": "application/json" } }, opts))
    .then(r => { if(!r.ok) return r.json().then(e => { throw new Error(e.error || ("HTTP " + r.status)); }); return r.json(); });

  let CFG = null;
  let ACTIVE_VENDOR = "sigma";
  let ACTIVE_TAB = "obligations";

  const isSuper = () => {
    const s = (window.opsSession && window.opsSession()) || {};
    return !!(s.me && (s.me.realRole === "super_admin" || (s.me.realRoles || []).includes("super_admin")));
  };
  const list = v => Array.isArray(v) ? v : [];
  const join = (v, sep) => list(v).map(esc).join(sep || " · ");
  const clone = v => JSON.parse(JSON.stringify(v || {}));
  const PRIORITIES = ["P1", "P2", "P3", "P4"];
  const DEFAULT_ESCALATION_POLICY = {
    P1: { reminder1Min: 10, reminder2Min: 30, reminder3Min: 60, repeat3Min: 60, informManagement: true },
    P2: { reminder1Min: 30, reminder2Min: 60, reminder3Min: 120, repeat3Min: 120, informManagement: true },
    P3: { reminder1Min: 120, reminder2Min: 240, reminder3Min: 480, repeat3Min: 0, informManagement: false },
    P4: { reminder1Min: 480, reminder2Min: 1440, reminder3Min: 2880, repeat3Min: 0, informManagement: false }
  };
  const jsonMini = v => {
    if(v == null) return "-";
    if(typeof v === "string" || typeof v === "number") return esc(v);
    return esc(Object.entries(v).map(([k,val]) => k + ": " + (typeof val === "object" ? JSON.stringify(val) : val)).join(" | "));
  };
  const phaseClass = s => s === "ready" ? "ready" : "next";
  const statusClass = s => /^(ready|live|enabled|ok)$/i.test(String(s || "")) ? "ready" : "next";
  const labelize = s => String(s == null ? "" : s).replace(/_/g, " ");
  const money = v => {
    if(v == null || v === "") return "not set";
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n.toLocaleString("en-US") + " SAR" : "not set";
  };
  const pct = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n + "%" : "-";
  };

  function installCss(){
    if(document.getElementById("vendorContractsCss")) return;
    const st = document.createElement("style");
    st.id = "vendorContractsCss";
    st.textContent = `
      #view-vendor-contracts .vc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}
      #view-vendor-contracts .vc-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:900}
      #view-vendor-contracts .vc-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      #view-vendor-contracts .vc-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:14px 0}
      #view-vendor-contracts .vc-summary>div{border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--card2)}
      #view-vendor-contracts .vc-summary b{display:block;font-size:22px;color:var(--ink)}
      #view-vendor-contracts .vc-summary span{display:block;font-size:12px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.08em}
      #view-vendor-contracts .vc-phases{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:14px 0 18px}
      #view-vendor-contracts .vc-phase{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:12px;min-height:142px;border-top:3px solid var(--muted)}
      #view-vendor-contracts .vc-phase.ready{border-top-color:var(--green,#16a34a)}
      #view-vendor-contracts .vc-phase.next{border-top-color:var(--blue,#2563eb)}
      #view-vendor-contracts .vc-phase h4{margin:4px 0 6px;font-size:14px}
      #view-vendor-contracts .vc-badge{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:11px;font-weight:900;text-transform:uppercase;background:var(--card2);color:var(--ink-soft)}
      #view-vendor-contracts .vc-badge.ready{color:var(--green-dark);background:var(--green-bg);border-color:var(--green-line,var(--green))}
      #view-vendor-contracts .vc-badge.next{color:var(--blue);background:var(--tint-blue);border-color:var(--blue-line,var(--blue))}
      #view-vendor-contracts .vc-grid{display:grid;grid-template-columns:310px 1fr;gap:14px;align-items:start}
      #view-vendor-contracts .vc-list{display:grid;gap:10px}
      #view-vendor-contracts .vc-vendor{border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);padding:12px;text-align:left;cursor:pointer}
      #view-vendor-contracts .vc-vendor.on{border-color:var(--green,#16a34a);box-shadow:0 0 0 2px rgba(16,185,129,.12)}
      #view-vendor-contracts .vc-vendor h3{margin:0 0 5px;font-size:18px}
      #view-vendor-contracts .vc-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      #view-vendor-contracts .vc-tag{font-size:11px;font-weight:850;border:1px solid var(--line);border-radius:999px;padding:3px 8px;background:var(--card2);color:var(--ink-soft)}
      #view-vendor-contracts .vc-detail{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:14px;min-width:0;overflow:hidden}
      #view-vendor-contracts .vc-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);padding-bottom:12px}
      #view-vendor-contracts .vc-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
      #view-vendor-contracts .vc-tabs button{border:1px solid var(--line);border-radius:999px;background:var(--card);padding:7px 12px;font-weight:850;color:var(--ink-soft);cursor:pointer}
      #view-vendor-contracts .vc-tabs button.on{border-color:var(--green);background:var(--green-bg);color:var(--green-dark)}
      #view-vendor-contracts #vcTabBody{overflow-x:auto}
      #view-vendor-contracts .vc-ob-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      #view-vendor-contracts .vc-ob{border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--card2)}
      #view-vendor-contracts .vc-ob h4{margin:0 0 8px;font-size:15px}
      #view-vendor-contracts .vc-meta{font-size:12.5px;color:var(--muted);line-height:1.55}
      #view-vendor-contracts .vc-meta b{color:var(--ink)}
      #view-vendor-contracts .vc-table{width:100%;min-width:720px;border-collapse:collapse;font-size:13px}
      #view-vendor-contracts .vc-table th{text-align:left;color:var(--muted);font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:9px;border-bottom:1px solid var(--line)}
      #view-vendor-contracts .vc-table td{padding:9px;border-bottom:1px solid var(--line);vertical-align:top}
      #view-vendor-contracts .vc-json{width:100%;min-height:420px;border:1px solid var(--line);border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.45;background:var(--code-bg,var(--card2));color:var(--code-fg,var(--ink))}
      #view-vendor-contracts .vc-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      #view-vendor-contracts .vc-plan{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:12px;overflow-x:auto}
      #view-vendor-contracts .vc-plan h4{margin:0 0 8px}
      #view-vendor-contracts .vc-plan li{margin:7px 0;color:var(--ink-soft)}
      #view-vendor-contracts .vc-flow-note{border:1px solid var(--line);border-radius:8px;background:var(--card2);padding:12px;margin-bottom:12px;color:var(--ink-soft);line-height:1.55}
      #view-vendor-contracts .vc-flow-grid{display:grid;gap:12px}
      #view-vendor-contracts .vc-flow-card{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:12px}
      #view-vendor-contracts .vc-flow-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:10px}
      #view-vendor-contracts .vc-flow-form{display:grid;grid-template-columns:1fr 1.4fr;gap:10px;margin:10px 0}
      #view-vendor-contracts .vc-field span{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:900;margin-bottom:5px}
      #view-vendor-contracts .vc-input,#view-vendor-contracts .vc-textarea{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink);padding:8px 10px;font:inherit}
      #view-vendor-contracts .vc-textarea{min-height:68px;resize:vertical}
      #view-vendor-contracts .vc-management-box{border:1px solid var(--line);border-radius:8px;background:var(--card2);padding:10px}
      #view-vendor-contracts .vc-help{font-size:12px;color:var(--muted);line-height:1.45;margin-top:6px}
      #view-vendor-contracts .vc-warn-mini{display:inline-flex;align-items:center;gap:6px;margin-top:8px;border:1px solid rgba(245,158,11,.42);border-radius:999px;background:rgba(245,158,11,.11);color:var(--orange,#f59e0b);font-size:12px;font-weight:850;padding:4px 9px}
      #view-vendor-contracts .vc-channel-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0 12px}
      #view-vendor-contracts .vc-check{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;padding:5px 10px;background:var(--card2);font-weight:800;color:var(--ink-soft)}
      #view-vendor-contracts .vc-switch{display:inline-flex;align-items:center;gap:8px;font-weight:900;color:var(--ink)}
      #view-vendor-contracts .vc-switch input,#view-vendor-contracts .vc-check input{accent-color:var(--green,#16a34a)}
      #view-vendor-contracts .vc-flow-item{border:1px solid var(--line);border-radius:8px;background:var(--card2);padding:12px;margin-top:10px}
      #view-vendor-contracts .vc-flow-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px}
      #view-vendor-contracts .vc-flow-table{width:100%;min-width:760px;border-collapse:collapse;margin-top:8px;font-size:13px}
      #view-vendor-contracts .vc-flow-table th{text-align:left;color:var(--muted);font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:8px;border-bottom:1px solid var(--line)}
      #view-vendor-contracts .vc-flow-table td{padding:8px;border-bottom:1px solid var(--line)}
      #view-vendor-contracts .vc-num{width:96px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--ink);padding:7px 8px;font:inherit}
      #view-vendor-contracts .vc-priority{display:inline-flex;min-width:34px;justify-content:center;border-radius:999px;padding:3px 8px;font-size:12px;font-weight:900;color:#fff;background:#64748b}
      #view-vendor-contracts .vc-priority.p1{background:#ef4444}
      #view-vendor-contracts .vc-priority.p2{background:#f59e0b}
      #view-vendor-contracts .vc-priority.p3{background:#64748b}
      #view-vendor-contracts .vc-priority.p4{background:#94a3b8;color:#0f172a}
      #view-vendor-contracts .vc-info-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}
      #view-vendor-contracts .vc-info-card{border:1px solid var(--line);border-radius:8px;background:var(--card2);padding:12px}
      #view-vendor-contracts .vc-info-card b{display:block;font-size:18px;color:var(--ink);margin-bottom:2px}
      #view-vendor-contracts .vc-info-card span{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
      #view-vendor-contracts .vc-map-table{width:100%;min-width:980px;border-collapse:collapse;font-size:13px}
      #view-vendor-contracts .vc-map-table th{text-align:left;color:var(--muted);font-size:11px;letter-spacing:.11em;text-transform:uppercase;padding:9px;border-bottom:1px solid var(--line)}
      #view-vendor-contracts .vc-map-table td{padding:10px 9px;border-bottom:1px solid var(--line);vertical-align:top}
      #view-vendor-contracts .vc-roll-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      #view-vendor-contracts .vc-roll-card{border:1px solid var(--line);border-radius:8px;background:var(--card2);padding:12px}
      #view-vendor-contracts .vc-roll-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px}
      #view-vendor-contracts .vc-source-row{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}
      #view-vendor-contracts .vc-source-chip{border:1px solid var(--line);border-radius:999px;background:var(--card);padding:3px 8px;font-size:11px;font-weight:850;color:var(--ink-soft)}
      #view-vendor-contracts .vc-money-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:10px 0}
      #view-vendor-contracts .vc-pen-card{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:12px;margin-bottom:12px}
      #view-vendor-contracts .vc-pen-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:10px}
      #view-vendor-contracts .vc-pen-fields{display:grid;grid-template-columns:1.2fr .7fr .8fr;gap:10px;margin-bottom:10px}
      #view-vendor-contracts .vc-pen-table{width:100%;min-width:1080px;border-collapse:collapse;font-size:13px}
      #view-vendor-contracts .vc-pen-table th{text-align:left;color:var(--muted);font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:8px;border-bottom:1px solid var(--line)}
      #view-vendor-contracts .vc-pen-table td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
      #view-vendor-contracts .vc-pen-table textarea{min-height:50px}
      #view-vendor-contracts .vc-money{font-variant-numeric:tabular-nums;font-weight:900;color:var(--ink)}
      html[data-theme="dark"] #view-vendor-contracts .vc-summary>div,
      html[data-theme="dark"] #view-vendor-contracts .vc-phase,
      html[data-theme="dark"] #view-vendor-contracts .vc-vendor,
      html[data-theme="dark"] #view-vendor-contracts .vc-detail,
      html[data-theme="dark"] #view-vendor-contracts .vc-tabs button,
      html[data-theme="dark"] #view-vendor-contracts .vc-plan,
      html[data-theme="dark"] #view-vendor-contracts .vc-flow-card,
      html[data-theme="dark"] #view-vendor-contracts .vc-pen-card{background:var(--card)!important;color:var(--ink)!important}
      html[data-theme="dark"] #view-vendor-contracts .vc-ob,
      html[data-theme="dark"] #view-vendor-contracts .vc-tag,
      html[data-theme="dark"] #view-vendor-contracts .vc-badge,
      html[data-theme="dark"] #view-vendor-contracts .vc-flow-note,
      html[data-theme="dark"] #view-vendor-contracts .vc-flow-item,
      html[data-theme="dark"] #view-vendor-contracts .vc-check,
      html[data-theme="dark"] #view-vendor-contracts .vc-management-box,
      html[data-theme="dark"] #view-vendor-contracts .vc-info-card,
      html[data-theme="dark"] #view-vendor-contracts .vc-roll-card{background:var(--card2)!important;color:var(--ink-soft)!important}
      html[data-theme="dark"] #view-vendor-contracts .vc-input,
      html[data-theme="dark"] #view-vendor-contracts .vc-textarea,
      html[data-theme="dark"] #view-vendor-contracts .vc-num{background:var(--bg)!important;color:var(--ink)!important;border-color:var(--line)!important}
      html[data-theme="dark"] #view-vendor-contracts .vc-tabs button.on,
      html[data-theme="dark"] #view-vendor-contracts .vc-badge.ready{background:var(--green-bg)!important;color:var(--green-dark)!important}
      html[data-theme="dark"] #view-vendor-contracts .vc-badge.next{background:var(--tint-blue)!important;color:var(--blue)!important}
      @media (max-width:1050px){#view-vendor-contracts .vc-summary,#view-vendor-contracts .vc-phases,#view-vendor-contracts .vc-info-grid,#view-vendor-contracts .vc-money-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#view-vendor-contracts .vc-grid,#view-vendor-contracts .vc-two,#view-vendor-contracts .vc-flow-form,#view-vendor-contracts .vc-roll-grid,#view-vendor-contracts .vc-pen-fields{grid-template-columns:1fr}#view-vendor-contracts .vc-ob-grid{grid-template-columns:1fr}}
      @media (max-width:640px){#view-vendor-contracts .vc-head,#view-vendor-contracts .vc-detail-head,#view-vendor-contracts .vc-pen-head{flex-direction:column}#view-vendor-contracts .vc-actions{justify-content:flex-start;width:100%}#view-vendor-contracts .vc-actions .pill{flex:1 1 150px;justify-content:center}#view-vendor-contracts .vc-summary,#view-vendor-contracts .vc-phases,#view-vendor-contracts .vc-info-grid,#view-vendor-contracts .vc-money-grid{grid-template-columns:1fr}#view-vendor-contracts .vc-tabs button{flex:1 1 140px}#view-vendor-contracts .vc-table{min-width:640px}#view-vendor-contracts .vc-json{min-height:340px;font-size:12px}}
    `;
    document.head.appendChild(st);
  }

  function shell(message){
    const host = $("#view-vendor-contracts");
    if(!host) return;
    installCss();
    host.innerHTML = `<div class="panel">
      <div class="vc-head">
        <div>
          <div class="vc-kicker">SLA / CONTRACT CONTROL CENTER</div>
          <h2>Vendors &amp; Contracts</h2>
          <div class="sub">Reference catalog for Fixed / MVNO vendors, contract obligations, global SLAs/SLOs, assignments, evidence plans, and the rollout path to extend ACK SLA governance.</div>
        </div>
        <div class="vc-actions">
          <button class="pill" id="vcBackSla" style="border-left-color:var(--blue)">SLA health</button>
          <button class="pill" id="vcReset" style="border-left-color:var(--muted)">Reset defaults</button>
          <button class="pill" id="vcSave" style="border-left-color:var(--green)">Save changes</button>
        </div>
      </div>
      <div id="vcBody">${message || `<div class="sub">Loading vendors and contract obligations...</div>`}</div>
      <div id="vcStatus" class="rl" style="margin-top:10px"></div>
    </div>`;
    const b = $("#vcBackSla"); if(b) b.onclick = () => { location.hash = "#sla"; };
    const r = $("#vcReset"); if(r) r.onclick = reset;
    const s = $("#vcSave"); if(s) s.onclick = saveFromJson;
  }

  function activateView(){
    document.querySelectorAll(".navtab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x => x.classList.toggle("active", x.id === "view-vendor-contracts"));
    const gear = document.getElementById("settingsBtn"); if(gear) gear.classList.add("on");
    const ob = document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
  }

  window.openVendorContracts = async function(){
    activateView();
    if(!isSuper()){
      shell(`<div style="text-align:center;padding:34px 20px">
        <div style="font-size:26px">Locked</div>
        <h2 style="margin:8px 0 4px">Super Admin Only</h2>
        <div class="sub">Vendor contracts and global SLA/SLO definitions affect governance and must be controlled by super users.</div>
      </div>`);
      return;
    }
    shell();
    try {
      CFG = await api("/api/vendor-contracts");
      if(!CFG.vendors || !CFG.vendors.some(v => v.id === ACTIVE_VENDOR)) ACTIVE_VENDOR = (CFG.vendors && CFG.vendors[0] && CFG.vendors[0].id) || "sigma";
      paint();
    } catch(e) {
      const body = $("#vcBody");
      if(body) body.innerHTML = `<div class="albanner">${esc(e.message)}</div>`;
    }
  };

  function paint(){
    const body = $("#vcBody"); if(!body || !CFG) return;
    const sum = CFG.summary || {};
    body.innerHTML = `
      <div class="vc-summary">
        <div><b>${esc(sum.vendors || 0)}</b><span>vendors</span></div>
        <div><b>${esc(sum.contracts || 0)}</b><span>contracts</span></div>
        <div><b>${esc(sum.obligations || 0)}</b><span>SLA/SLO obligations</span></div>
        <div><b>${esc(sum.evidenceMappings || 0)}</b><span>evidence maps</span></div>
        <div><b>${esc((sum.rolloutSurfaces || 0) + "/" + (sum.penaltyRules || 0))}</b><span>rollout / penalty</span></div>
        <div><b>${esc((sum.readyPhases || 0) + "/" + list(CFG.phases).length)}</b><span>phases ready</span></div>
      </div>
      <div class="vc-phases">${list(CFG.phases).map((p,i)=>`
        <article class="vc-phase ${phaseClass(p.status)}">
          <span class="vc-badge ${phaseClass(p.status)}">${esc(p.status)}</span>
          <h4>${i+1}. ${esc(p.title)}</h4>
          <div class="vc-meta">${esc(p.outcome)}</div>
          <div class="vc-meta" style="margin-top:8px"><b>Control:</b> ${esc(p.riskControl)}</div>
        </article>`).join("")}</div>
      <div class="vc-grid">
        <aside class="vc-list">${list(CFG.vendors).map(v => vendorCard(v)).join("")}</aside>
        <section class="vc-detail" id="vcDetail"></section>
      </div>`;
    body.querySelectorAll(".vc-vendor").forEach(b => b.addEventListener("click", () => { collectPendingEdits(); ACTIVE_VENDOR = b.dataset.vendor; paint(); }));
    paintDetail();
  }

  function vendorCard(v){
    const obs = list(CFG.obligations).filter(o => o.vendorId === v.id).length;
    return `<button type="button" class="vc-vendor ${v.id === ACTIVE_VENDOR ? "on" : ""}" data-vendor="${esc(v.id)}">
      <h3>${esc(v.name)}</h3>
      <div class="vc-meta">${esc(v.type)} · ${esc(v.contractStatus || "reference")}</div>
      <div class="vc-tags"><span class="vc-tag">${join(v.businessScope, " / ")}</span><span class="vc-tag">${obs} obligations</span></div>
      <div class="vc-meta" style="margin-top:8px">${esc(v.supportWindow)}</div>
    </button>`;
  }

  function paintDetail(){
    const box = $("#vcDetail"); if(!box || !CFG) return;
    const vendor = list(CFG.vendors).find(v => v.id === ACTIVE_VENDOR) || list(CFG.vendors)[0] || {};
    const contracts = list(CFG.contracts).filter(c => c.vendorId === vendor.id);
    const obligations = list(CFG.obligations).filter(o => o.vendorId === vendor.id);
    const assignments = list(CFG.assignments).filter(a => a.vendorId === vendor.id);
    if(ACTIVE_TAB === "tests") ACTIVE_TAB = "escalation";
    box.innerHTML = `
      <div class="vc-detail-head">
        <div>
          <h2 style="margin:0">${esc(vendor.name || "Vendor")}</h2>
          <div class="sub">${esc(vendor.legalName || "")} · ${join(vendor.domains, " · ")}</div>
        </div>
        <span class="vc-badge ready">${esc(join(vendor.businessScope, " / ") || "scope")}</span>
      </div>
      <div class="vc-tabs">
        ${tabBtn("obligations","Obligations")}
        ${tabBtn("evidence","Evidence connectors")}
        ${tabBtn("escalation","Reminders & escalation")}
        ${tabBtn("rollout","Operational rollout")}
        ${tabBtn("penalties","Penalty model")}
        ${tabBtn("contracts","Contracts")}
        ${tabBtn("assignments","Assignments")}
        ${tabBtn("json","Advanced JSON")}
      </div>
      <div id="vcTabBody"></div>`;
    box.querySelectorAll(".vc-tabs button").forEach(b => b.addEventListener("click", () => { collectPendingEdits(); ACTIVE_TAB = b.dataset.tab; paintDetail(); }));
    const tab = $("#vcTabBody");
    if(ACTIVE_TAB === "contracts") tab.innerHTML = contractsTab(contracts);
    else if(ACTIVE_TAB === "assignments") tab.innerHTML = assignmentsTab(assignments);
    else if(ACTIVE_TAB === "evidence") tab.innerHTML = evidenceTab(vendor, obligations);
    else if(ACTIVE_TAB === "escalation") tab.innerHTML = escalationTab(contracts, obligations);
    else if(ACTIVE_TAB === "rollout") tab.innerHTML = rolloutTab(vendor);
    else if(ACTIVE_TAB === "penalties") tab.innerHTML = penaltiesTab(vendor, contracts, obligations);
    else if(ACTIVE_TAB === "json") tab.innerHTML = jsonTab();
    else tab.innerHTML = obligationsTab(obligations);
  }

  function tabBtn(id,label){ return `<button type="button" data-tab="${id}" class="${ACTIVE_TAB === id ? "on" : ""}">${label}</button>`; }

  function obligationsTab(rows){
    if(!rows.length) return `<div class="okbox">No obligations configured for this vendor.</div>`;
    return `<div class="vc-ob-grid">${rows.map(o => `
      <article class="vc-ob">
        <h4>${esc(o.title)}</h4>
        <div class="vc-tags"><span class="vc-tag">${esc(o.category)}</span><span class="vc-tag">${esc(o.attainmentTarget || "-")}</span><span class="vc-tag">phase ${esc(o.phase || "-")}</span></div>
        <div class="vc-meta" style="margin-top:10px"><b>Applies to:</b> ${join((o.appliesTo||{}).business, " / ")} · ${join((o.appliesTo||{}).domains, " · ")}</div>
        <div class="vc-meta"><b>Target:</b> ${jsonMini(o.target)}</div>
        <div class="vc-meta"><b>Weight:</b> ${jsonMini(o.weight)}</div>
        <div class="vc-meta"><b>Evidence plan:</b> ${join(o.evidencePlan, " · ")}</div>
        <div class="vc-meta" style="margin-top:8px"><b>Breach message:</b> ${esc((o.operatorMessages||{}).breached || "")}</div>
      </article>`).join("")}</div>`;
  }

  function contractsTab(rows){
    if(!rows.length) return `<div class="okbox">No contracts configured for this vendor.</div>`;
    return `<table class="vc-table"><thead><tr><th>Contract</th><th>Scope</th><th>Source</th><th>Penalty / note</th></tr></thead><tbody>
      ${rows.map(c => `<tr>
        <td><b>${esc(c.title)}</b><div class="vc-meta">${esc(c.status)} · ${esc(c.effectiveFrom || "-")} -> ${esc(c.effectiveTo || "open")}</div></td>
        <td>${join(c.businessScope, " / ")}<div class="vc-meta">${join(c.domains, " · ")}</div></td>
        <td>${esc(c.sourceDoc)}<div class="vc-meta">${esc(c.sourcePages)}</div></td>
        <td>${esc(c.penaltyCap || "-")}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  function assignmentsTab(rows){
    const ev = list(CFG.evidenceSources);
    return `<div class="vc-two">
      <div class="vc-plan"><h4>Assignments</h4>
        ${rows.length ? `<table class="vc-table"><tbody>${rows.map(a => `<tr><td><b>${esc(a.business)}</b><div class="vc-meta">${join(a.domains, " · ")}</div></td><td>${join(a.journeys, " · ")}<div class="vc-meta">${join(a.consoleSurfaces, " · ")}</div></td></tr>`).join("")}</tbody></table>` : `<div class="sub">No assignments configured.</div>`}
      </div>
      <div class="vc-plan"><h4>Evidence sources</h4>
        <table class="vc-table"><tbody>${ev.map(e => `<tr><td><span class="vc-badge ${e.status === "live" ? "ready" : "next"}">${esc(e.status)}</span></td><td><b>${esc(e.label)}</b><div class="vc-meta">${esc(e.use)}</div></td></tr>`).join("")}</tbody></table>
      </div>
    </div>`;
  }

  function evidenceTab(vendor, obligations){
    const ids = new Set(obligations.map(o => o.id));
    const sourcesByKey = Object.fromEntries(list(CFG.evidenceSources).map(s => [s.key, s]));
    const mappings = list(CFG.evidenceMappings).filter(m => ids.has(m.obligationId));
    const sourceKeys = new Set();
    mappings.forEach(m => list(m.sources).forEach(s => sourceKeys.add(s)));
    const live = Array.from(sourceKeys).filter(k => (sourcesByKey[k] || {}).status === "live").length;
    const partial = Array.from(sourceKeys).filter(k => (sourcesByKey[k] || {}).status === "partial").length;
    const planned = Array.from(sourceKeys).filter(k => (sourcesByKey[k] || {}).status === "planned").length;
    return `<div>
      <div class="vc-flow-note">
        <b>Phase 4 - Evidence connectors.</b>
        This maps each contractual SLA/SLO obligation to the facts the console can use. Live sources can support dashboards today; partial sources must show confidence; planned sources stay governance/manual until the connector is wired.
      </div>
      <div class="vc-info-grid">
        <div class="vc-info-card"><b>${esc(mappings.length)}</b><span>mapped obligations</span><div class="vc-meta">for ${esc(vendor.name || "vendor")}</div></div>
        <div class="vc-info-card"><b>${esc(live + partial)}</b><span>usable sources</span><div class="vc-meta">${esc(live)} live · ${esc(partial)} partial</div></div>
        <div class="vc-info-card"><b>${esc(planned)}</b><span>planned sources</span><div class="vc-meta">kept informational/manual</div></div>
      </div>
      <div style="overflow-x:auto">
        <table class="vc-map-table">
          <thead><tr><th>SLA item</th><th>Primary metric</th><th>Evidence connectors</th><th>Readiness</th><th>Console surface</th><th>Control / next step</th></tr></thead>
          <tbody>${mappings.map(m => evidenceRow(m, obligations.find(o => o.id === m.obligationId) || {}, sourcesByKey)).join("")}</tbody>
        </table>
      </div>
    </div>`;
  }

  function evidenceRow(m, obligation, sourcesByKey){
    const sourceChips = list(m.sources).map(k => {
      const s = sourcesByKey[k] || { key:k, label:k, status:"planned" };
      return `<span class="vc-source-chip">${esc(s.label || k)} · ${esc(labelize(s.status))}</span>`;
    }).join("");
    return `<tr>
      <td><b>${esc(obligation.title || m.obligationId)}</b><div class="vc-meta">${esc(obligation.category || "-")} · target ${jsonMini(obligation.target)}</div></td>
      <td><b>${esc(m.metric || "-")}</b><div class="vc-meta">${esc(m.calculation || "-")}</div></td>
      <td><div class="vc-source-row">${sourceChips}</div><div class="vc-meta" style="margin-top:6px">primary: ${esc(m.primarySource || "-")}</div></td>
      <td><span class="vc-badge ${statusClass(m.readiness)}">${esc(labelize(m.readiness || "planned"))}</span><div class="vc-meta">confidence: ${esc(m.confidence || "pending")}</div></td>
      <td>${esc(m.surface || "-")}</td>
      <td><b>Control:</b> ${esc(m.controls || "-")}<div class="vc-meta"><b>Next:</b> ${esc(m.nextStep || "-")}</div></td>
    </tr>`;
  }

  function rolloutTab(vendor){
    const rows = list(CFG.rolloutSurfaces).filter(r => list(r.vendors).includes(vendor.id));
    return `<div>
      <div class="vc-flow-note">
        <b>Phase 5 - Operational rollout.</b>
        These are the console surfaces where vendor SLA evidence should appear. The mode remains informational until UAT, evidence confidence review, and vendor-owner sign-off are complete.
      </div>
      <div class="vc-roll-grid">${rows.map(r => rolloutCard(r)).join("")}</div>
    </div>`;
  }

  function rolloutCard(r){
    return `<article class="vc-roll-card">
      <div class="vc-roll-head">
        <div>
          <h4 style="margin:0">${esc(r.title)}</h4>
          <div class="vc-meta">${esc(r.audience || "-")}</div>
        </div>
        <span class="vc-badge ${statusClass(r.status)}">${esc(labelize(r.status || "planned"))}</span>
      </div>
      <div class="vc-tags"><span class="vc-tag">${esc(r.mode || "informational")}</span><span class="vc-tag">${join(r.businessScope, " / ")}</span></div>
      <div class="vc-meta" style="margin-top:10px"><b>Surfaces:</b> ${join(r.surfaces, " · ")}</div>
      <div class="vc-meta"><b>Shows:</b> ${esc(r.shows || "-")}</div>
      <div class="vc-source-row">${list(r.evidenceSources).map(k => `<span class="vc-source-chip">${esc(k)}</span>`).join("")}</div>
      <div class="vc-meta" style="margin-top:10px"><b>Gate:</b> ${esc(r.gate || "-")}</div>
      <div class="vc-meta"><b>Control:</b> ${esc(r.controls || "-")}</div>
    </article>`;
  }

  function penaltiesTab(vendor, contracts, obligations){
    const governance = CFG.penaltyGovernance || {};
    const allRules = list(CFG.penaltyRules).filter(r => r.vendorId === vendor.id);
    const readyContracts = contracts.filter(c => Number(c.eligibleMonthlyFeeSar) > 0 && c.monthlyPenaltyCapPercent != null).length;
    const weightedRules = allRules.filter(r => ruleWeightPercent(r) != null).length;
    const pendingApproval = allRules.filter(r => String(r.approvalStatus || "").includes("required")).length;
    return `<div>
      <div class="vc-flow-note">
        <b>Penalty model - candidate estimates only.</b>
        Configure the commercial inputs that let the console estimate exposure from SLA breaches: eligible monthly fee, contract cap, item weight, evidence required, exclusions, and approval status. Nothing here deducts money or pages a vendor until evidence and commercial/legal sign-off are complete.
      </div>
      <div class="vc-info-grid">
        <div class="vc-info-card"><b>${esc(readyContracts + "/" + contracts.length)}</b><span>contracts with fee/cap</span><div class="vc-meta">fee is required before exposure can be estimated</div></div>
        <div class="vc-info-card"><b>${esc(weightedRules + "/" + allRules.length)}</b><span>weighted rules</span><div class="vc-meta">blank weights stay governance-only</div></div>
        <div class="vc-info-card"><b>${esc(pendingApproval)}</b><span>pending approval</span><div class="vc-meta">commercial/legal validation required</div></div>
      </div>
      <div class="vc-two" style="margin-bottom:12px">
        <div class="vc-plan">
          <h4>Calculation</h4>
          <div class="vc-meta"><b>Mode:</b> ${esc(labelize(governance.mode || "estimate_only"))}</div>
          <div class="vc-meta"><b>Currency:</b> ${esc(governance.currency || "SAR")}</div>
          <div class="vc-meta"><b>Formula:</b> ${esc(governance.formula || "candidate = fee * weight * breach factor")}</div>
        </div>
        <div class="vc-plan">
          <h4>Formal approval controls</h4>
          <ul>${list(governance.controls).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        </div>
      </div>
      ${list(CFG.penaltyCandidateExamples).length ? `<div class="vc-two" style="margin-bottom:12px">
        ${list(CFG.penaltyCandidateExamples).map(ex => `<div class="vc-plan"><h4>${esc(ex.title)}</h4><div class="vc-meta"><b>Formula:</b> ${esc(ex.formula)}</div><div class="vc-meta"><b>Example:</b> ${esc(ex.example)}</div></div>`).join("")}
      </div>` : ""}
      ${contracts.map(c => penaltyContractCard(c, allRules.filter(r => r.contractId === c.id), obligations)).join("")}
    </div>`;
  }

  function penaltyContractCard(contract, rules, obligations){
    const obById = Object.fromEntries(list(obligations).map(o => [o.id, o]));
    const estimate = contractPenaltyEstimate(contract, rules);
    return `<article class="vc-pen-card" data-penalty-contract="${esc(contract.id)}">
      <div class="vc-pen-head">
        <div>
          <h3 style="margin:0">${esc(contract.title)}</h3>
          <div class="vc-meta">${join(contract.businessScope, " / ")} · ${join(contract.domains, " · ")} · ${esc(contract.status || "reference")}</div>
        </div>
        <span class="vc-badge next">${esc(labelize(contract.penaltyMode || "estimate_only"))}</span>
      </div>
      <div class="vc-pen-fields">
        <label class="vc-field"><span>Eligible monthly fee (SAR)</span><input class="vc-input" type="number" min="0" step="1" data-contract-fee value="${valueAttr(contract.eligibleMonthlyFeeSar)}" placeholder="enter commercial fee"></label>
        <label class="vc-field"><span>Monthly cap %</span><input class="vc-input" type="number" min="0" step="0.1" data-contract-cap value="${valueAttr(contract.monthlyPenaltyCapPercent)}" placeholder="ex: 5"></label>
        <label class="vc-field"><span>Penalty mode</span><select class="vc-input" data-contract-penalty-mode>${selectOptions(contract.penaltyMode || "estimate_only", [["estimate_only","Estimate only"],["governance_candidate","Governance candidate"],["manual_approved_record","Manual approved record"]])}</select></label>
      </div>
      <div class="vc-money-grid">
        <div class="vc-info-card"><b class="vc-money">${esc(money(contract.eligibleMonthlyFeeSar))}</b><span>eligible fee</span></div>
        <div class="vc-info-card"><b>${esc(pct(contract.monthlyPenaltyCapPercent))}</b><span>contract cap</span><div class="vc-meta">${esc(estimate.capAmount == null ? "cap amount not set" : money(estimate.capAmount))}</div></div>
        <div class="vc-info-card"><b class="vc-money">${esc(estimate.uncapped == null ? "-" : money(estimate.uncapped))}</b><span>candidate sum</span></div>
        <div class="vc-info-card"><b class="vc-money">${esc(estimate.capped == null ? "-" : money(estimate.capped))}</b><span>capped exposure</span></div>
      </div>
      ${Number(contract.eligibleMonthlyFeeSar) > 0 ? "" : `<div class="vc-warn-mini">Enter the eligible monthly fee to calculate SAR exposure</div>`}
      <div style="overflow-x:auto;margin-top:10px">
        <table class="vc-pen-table">
          <thead><tr><th>On</th><th>SLA item</th><th>Weight / breach factor</th><th>Evidence required</th><th>Exclusions</th><th>Approval</th><th>Candidate</th></tr></thead>
          <tbody>${rules.map(r => penaltyRuleRow(r, obById[r.obligationId] || {}, contract)).join("")}</tbody>
        </table>
      </div>
      <div class="vc-meta" style="margin-top:10px"><b>Contract note:</b> ${esc(contract.penaltyCap || "-")}</div>
    </article>`;
  }

  function penaltyRuleRow(rule, obligation, contract){
    const candidate = estimateForRule(rule, contract);
    const hasSeverity = rule.severityWeights && typeof rule.severityWeights === "object";
    const weightInput = hasSeverity
      ? `<div class="vc-source-row">${PRIORITIES.map(p => `<label class="vc-field" style="min-width:92px"><span>${p} weight %</span><input class="vc-num" type="number" min="0" step="0.1" data-sev-weight="${p}" value="${valueAttr(rule.severityWeights[p])}"></label>`).join("")}</div>`
      : `<input class="vc-num" type="number" min="0" step="0.1" data-rule-weight value="${valueAttr(rule.weightPercent)}" placeholder="%">`;
    return `<tr data-penalty-rule="${esc(rule.id)}">
      <td><input type="checkbox" data-penalty-enabled ${rule.enabled !== false ? "checked" : ""}></td>
      <td><b>${esc(obligation.title || rule.obligationId)}</b><div class="vc-meta">${esc(obligation.category || "-")} · target ${jsonMini(obligation.target)}</div><div class="vc-meta">${esc(rule.calculationMethod || "-")}</div></td>
      <td>${weightInput}<div class="vc-meta" style="margin-top:5px">breach factor: ${esc(rule.breachFactor || "1.0")}</div></td>
      <td><textarea class="vc-textarea" data-rule-evidence>${esc(list(rule.evidenceRequired).join("\n"))}</textarea></td>
      <td><textarea class="vc-textarea" data-rule-exclusions>${esc(list(rule.exclusions).join("\n"))}</textarea></td>
      <td><select class="vc-input" data-rule-approval>${selectOptions(rule.approvalStatus || "commercial_validation_required", [["commercial_validation_required","Commercial validation required"],["evidence_pending","Evidence pending"],["vendor_review","Vendor review"],["approved_governance","Approved for governance"],["approved_penalty","Approved penalty - manual"]])}</select><textarea class="vc-textarea" data-rule-notes style="margin-top:6px">${esc(rule.notes || "")}</textarea></td>
      <td><b class="vc-money">${esc(candidate == null ? "-" : money(candidate))}</b><div class="vc-meta">${hasSeverity ? "max single severity candidate" : "single rule candidate"}</div></td>
    </tr>`;
  }

  function contractPenaltyEstimate(contract, rules){
    const fee = Number(contract.eligibleMonthlyFeeSar);
    if(!Number.isFinite(fee) || fee <= 0) return { uncapped: null, capAmount: null, capped: null };
    const uncapped = rules.filter(r => r.enabled !== false).reduce((total, rule) => total + (estimateForRule(rule, contract) || 0), 0);
    const capPct = Number(contract.monthlyPenaltyCapPercent);
    const ruleCaps = rules.map(r => Number(r.monthlyCapPercent)).filter(Number.isFinite);
    const effectiveCapPct = Number.isFinite(capPct) ? capPct : (ruleCaps.length ? Math.max(...ruleCaps) : null);
    const capAmount = effectiveCapPct == null ? null : Math.round(fee * effectiveCapPct / 100);
    return { uncapped, capAmount, capped: capAmount == null ? uncapped : Math.min(uncapped, capAmount) };
  }

  function estimateForRule(rule, contract){
    const fee = Number(contract.eligibleMonthlyFeeSar);
    const weight = ruleWeightPercent(rule);
    if(!Number.isFinite(fee) || fee <= 0 || weight == null) return null;
    return Math.round(fee * Number(weight) / 100);
  }

  function ruleWeightPercent(rule){
    if(rule.weightPercent != null && rule.weightPercent !== "" && Number.isFinite(Number(rule.weightPercent))) return Number(rule.weightPercent);
    const weights = rule.severityWeights && typeof rule.severityWeights === "object"
      ? Object.values(rule.severityWeights).filter(v => v != null && v !== "").map(Number).filter(Number.isFinite)
      : [];
    return weights.length ? Math.max(...weights) : null;
  }

  function selectOptions(value, options){
    return options.map(opt => {
      const val = Array.isArray(opt) ? opt[0] : opt;
      const label = Array.isArray(opt) ? opt[1] : labelize(opt);
      return `<option value="${esc(val)}" ${String(value) === String(val) ? "selected" : ""}>${esc(label)}</option>`;
    }).join("");
  }

  function valueAttr(v){
    return v == null || v === "" ? "" : esc(v);
  }

  function num(v, fb){
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : (fb || 0);
  }

  function defaultFlowPolicy(){
    return clone(DEFAULT_ESCALATION_POLICY);
  }

  function flowForContract(contract, obligations){
    CFG.escalationFlows = list(CFG.escalationFlows);
    let flow = CFG.escalationFlows.find(f => f.contractId === contract.id);
    if(!flow){
      flow = {
        id: contract.id + "-escalation",
        vendorId: contract.vendorId,
        contractId: contract.id,
        title: contract.title + " escalation",
        enabled: true,
        mode: "reference",
        ownerGroup: "Service delivery",
        description: "Reference reminder and escalation ladder per contractual SLA item.",
        channels: { mail: true, teams: false, whatsapp: false, managementMail: true },
        managementRecipients: [],
        defaultPolicy: defaultFlowPolicy(),
        items: []
      };
      CFG.escalationFlows.push(flow);
    }
    flow.defaultPolicy = flow.defaultPolicy || defaultFlowPolicy();
    flow.channels = Object.assign({ mail: true, teams: false, whatsapp: false, managementMail: true }, flow.channels || {});
    flow.managementRecipients = list(flow.managementRecipients);
    flow.items = list(flow.items);
    obligations.forEach(ob => {
      if(!flow.items.some(item => item.obligationId === ob.id)){
        flow.items.push({
          obligationId: ob.id,
          enabled: true,
          severityPolicy: clone(flow.defaultPolicy),
          ownerHint: "L1 -> L2/vendor owner -> service delivery -> management",
          message: ((ob.operatorMessages || {}).breached || (ob.title + " breached; escalate to vendor owner."))
        });
      }
    });
    return flow;
  }

  function policyCell(policy, sev, field, fallback){
    const row = (policy || {})[sev] || {};
    return num(row[field], fallback);
  }

  function escalationTab(contracts, obligations){
    if(!contracts.length) return `<div class="okbox">No contracts configured for this vendor.</div>`;
    return `<div>
      <div class="vc-flow-note">
        <b>Contract SLA reminders &amp; escalation.</b>
        Configure how each vendor contract should behave when an SLA item is at risk or breached: reminder 1, reminder 2, reminder 3 with escalation, repeated management reminders, and which channels are allowed. This is reference/configuration only until phase 4 evidence connectors are signed off.
      </div>
      <div class="vc-flow-grid">
        ${contracts.map(c => contractEscalationCard(c, obligations.filter(o => o.contractId === c.id))).join("")}
      </div>
    </div>`;
  }

  function contractEscalationCard(contract, obligations){
    const flow = flowForContract(contract, obligations);
    return `<article class="vc-flow-card" data-flow-id="${esc(flow.id)}" data-flow-contract="${esc(contract.id)}">
      <div class="vc-flow-head">
        <div>
          <h3 style="margin:0">${esc(flow.title || contract.title)}</h3>
          <div class="vc-meta">${esc(contract.title)} · ${join(contract.businessScope, " / ")} · ${join(contract.domains, " · ")}</div>
        </div>
        <label class="vc-switch"><input type="checkbox" data-flow-enabled ${flow.enabled !== false ? "checked" : ""}> enabled</label>
      </div>
      <div class="vc-meta" style="margin-bottom:8px">${esc(flow.description || "")}</div>
      <div class="vc-flow-form">
        <label class="vc-field"><span>Owner group</span><input class="vc-input" data-flow-owner-group value="${esc(flow.ownerGroup || "")}"></label>
        <div class="vc-management-box">
          <label class="vc-field"><span>Management recipients used by Inform management</span><textarea class="vc-textarea" data-flow-management placeholder="name@email.sa, another@email.sa">${esc(list(flow.managementRecipients).join(", "))}</textarea></label>
          <div class="vc-help">Add the managers for this contract here. Any SLA row with <b>Inform management</b> enabled sends its management/R3 notification to this list, separate from the team recipients.</div>
          ${managementHint(flow)}
        </div>
      </div>
      <div class="vc-channel-row">
        ${channelCheck(flow, "mail", "Mail")}
        ${channelCheck(flow, "teams", "Teams")}
        ${channelCheck(flow, "whatsapp", "WhatsApp")}
        ${channelCheck(flow, "managementMail", "Management mail")}
      </div>
      ${obligations.map(o => escalationItemCard(o, list(flow.items).find(item => item.obligationId === o.id) || {}, flow.defaultPolicy)).join("")}
    </article>`;
  }

  function channelCheck(flow, key, label){
    const channels = flow.channels || {};
    return `<label class="vc-check"><input type="checkbox" data-flow-channel="${esc(key)}" ${channels[key] ? "checked" : ""}> ${esc(label)}</label>`;
  }

  function managementHint(flow){
    return list(flow.managementRecipients).length
      ? `<div class="vc-help"><b>${esc(list(flow.managementRecipients).length)}</b> management recipient(s) configured for this contract.</div>`
      : `<div class="vc-warn-mini">Management list not configured yet</div>`;
  }

  function escalationItemCard(obligation, item, fallbackPolicy){
    const policy = item.severityPolicy || fallbackPolicy || DEFAULT_ESCALATION_POLICY;
    return `<article class="vc-flow-item" data-flow-item="${esc(obligation.id)}">
      <div class="vc-flow-item-head">
        <div>
          <h4 style="margin:0">${esc(obligation.title)}</h4>
          <div class="vc-meta">${esc(obligation.category)} · target ${jsonMini(obligation.target)} · evidence: ${join(obligation.evidencePlan, " · ")}</div>
        </div>
        <label class="vc-switch"><input type="checkbox" data-flow-item-enabled ${item.enabled !== false ? "checked" : ""}> on</label>
      </div>
      <label class="vc-field"><span>Breach / escalation message</span><textarea class="vc-textarea" data-flow-item-message>${esc(item.message || (obligation.operatorMessages || {}).breached || "")}</textarea></label>
      <div style="overflow-x:auto">
        <table class="vc-flow-table">
          <thead><tr><th>Priority</th><th>Reminder 1<br>min after breach/risk</th><th>Reminder 2<br>warning</th><th>Reminder 3<br>+ escalation</th><th>Repeat R3<br>every min</th><th>Inform management<br>uses list above</th></tr></thead>
          <tbody>${PRIORITIES.map(sev => severityRow(policy, sev)).join("")}</tbody>
        </table>
      </div>
    </article>`;
  }

  function severityRow(policy, sev){
    const p = (policy || {})[sev] || {};
    return `<tr data-sev="${sev}">
      <td><span class="vc-priority ${sev.toLowerCase()}">${sev}</span></td>
      <td><input class="vc-num" type="number" min="0" step="1" data-field="reminder1Min" value="${esc(policyCell(policy, sev, "reminder1Min", p.reminder1Min))}"></td>
      <td><input class="vc-num" type="number" min="0" step="1" data-field="reminder2Min" value="${esc(policyCell(policy, sev, "reminder2Min", p.reminder2Min))}"></td>
      <td><input class="vc-num" type="number" min="0" step="1" data-field="reminder3Min" value="${esc(policyCell(policy, sev, "reminder3Min", p.reminder3Min))}"></td>
      <td><input class="vc-num" type="number" min="0" step="1" data-field="repeat3Min" value="${esc(policyCell(policy, sev, "repeat3Min", p.repeat3Min))}"></td>
      <td><label class="vc-switch"><input type="checkbox" data-field="informManagement" ${p.informManagement ? "checked" : ""}> inform</label></td>
    </tr>`;
  }

  function jsonTab(){
    return `<div class="vc-plan">
      <h4>Advanced source-of-truth editor</h4>
      <div class="sub" style="margin-bottom:8px">Use this for bulk edits until phase 2 adds richer forms for contacts, clauses, and evidence mappings.</div>
      <textarea class="vc-json" id="vcJson">${esc(JSON.stringify(CFG, null, 2))}</textarea>
    </div>`;
  }

  async function saveFromJson(){
    const st = $("#vcStatus");
    const editor = $("#vcJson");
    let payload = CFG;
    if(editor){
      try { payload = JSON.parse(editor.value); }
      catch(e){ if(st) st.innerHTML = `<span style="color:var(--red)">Invalid JSON: ${esc(e.message)}</span>`; return; }
    } else {
      collectPendingEdits();
      payload = CFG;
    }
    if(st) st.textContent = "Saving vendor contracts...";
    try {
      CFG = await api("/api/vendor-contracts", { method: "PUT", body: JSON.stringify(payload) });
      if(st) st.textContent = "Saved. The reference catalog is updated.";
      paint();
    } catch(e) {
      if(st) st.innerHTML = `<span style="color:var(--red)">Save failed: ${esc(e.message)}</span>`;
    }
  }

  async function reset(){
    if(!confirm("Reset vendor contracts to the seeded Sigma/TCS defaults?")) return;
    const st = $("#vcStatus"); if(st) st.textContent = "Resetting...";
    try {
      CFG = await api("/api/vendor-contracts/reset", { method: "POST", body: "{}" });
      ACTIVE_VENDOR = (CFG.vendors && CFG.vendors[0] && CFG.vendors[0].id) || "sigma";
      if(st) st.textContent = "Defaults restored.";
      paint();
    } catch(e) {
      if(st) st.innerHTML = `<span style="color:var(--red)">Reset failed: ${esc(e.message)}</span>`;
    }
  }

  function collectEscalationEdits(){
    if(!CFG) return;
    const cards = document.querySelectorAll("#view-vendor-contracts [data-flow-id]");
    if(!cards.length) return;
    CFG.escalationFlows = list(CFG.escalationFlows);
    cards.forEach(card => {
      const id = card.getAttribute("data-flow-id");
      let flow = CFG.escalationFlows.find(f => f.id === id);
      if(!flow){
        flow = { id, vendorId: ACTIVE_VENDOR, contractId: card.getAttribute("data-flow-contract"), items: [] };
        CFG.escalationFlows.push(flow);
      }
      const enabled = card.querySelector("[data-flow-enabled]");
      const ownerGroup = card.querySelector("[data-flow-owner-group]");
      const management = card.querySelector("[data-flow-management]");
      if(enabled) flow.enabled = !!enabled.checked;
      if(ownerGroup) flow.ownerGroup = ownerGroup.value.trim();
      if(management) flow.managementRecipients = management.value.split(/[,\n;]/).map(x => x.trim()).filter(Boolean);
      flow.channels = flow.channels || {};
      card.querySelectorAll("[data-flow-channel]").forEach(cb => {
        flow.channels[cb.getAttribute("data-flow-channel")] = !!cb.checked;
      });
      const existingItems = byObligation(flow.items);
      flow.items = Array.from(card.querySelectorAll("[data-flow-item]")).map(itemEl => {
        const obligationId = itemEl.getAttribute("data-flow-item");
        const base = existingItems[obligationId] || {};
        const enabledBox = itemEl.querySelector("[data-flow-item-enabled]");
        const msg = itemEl.querySelector("[data-flow-item-message]");
        const item = {
          ...base,
          obligationId,
          enabled: enabledBox ? !!enabledBox.checked : base.enabled !== false,
          message: msg ? msg.value.trim() : (base.message || ""),
          severityPolicy: {}
        };
        itemEl.querySelectorAll("[data-sev]").forEach(row => {
          const sev = row.getAttribute("data-sev");
          item.severityPolicy[sev] = {};
          row.querySelectorAll("[data-field]").forEach(input => {
            const field = input.getAttribute("data-field");
            item.severityPolicy[sev][field] = field === "informManagement" ? !!input.checked : num(input.value, 0);
          });
        });
        return item;
      });
    });
  }

  function collectPendingEdits(){
    collectEscalationEdits();
    collectPenaltyEdits();
  }

  function collectPenaltyEdits(){
    if(!CFG) return;
    const contracts = document.querySelectorAll("#view-vendor-contracts [data-penalty-contract]");
    const rules = document.querySelectorAll("#view-vendor-contracts [data-penalty-rule]");
    if(!contracts.length && !rules.length) return;
    CFG.contracts = list(CFG.contracts);
    CFG.penaltyRules = list(CFG.penaltyRules);
    contracts.forEach(card => {
      const id = card.getAttribute("data-penalty-contract");
      const contract = CFG.contracts.find(c => c.id === id);
      if(!contract) return;
      const fee = card.querySelector("[data-contract-fee]");
      const cap = card.querySelector("[data-contract-cap]");
      const mode = card.querySelector("[data-contract-penalty-mode]");
      if(fee) contract.eligibleMonthlyFeeSar = numOrNull(fee.value);
      if(cap) contract.monthlyPenaltyCapPercent = numOrNull(cap.value);
      if(mode) contract.penaltyMode = mode.value;
    });
    rules.forEach(row => {
      const id = row.getAttribute("data-penalty-rule");
      const rule = CFG.penaltyRules.find(r => r.id === id);
      if(!rule) return;
      const enabled = row.querySelector("[data-penalty-enabled]");
      const weight = row.querySelector("[data-rule-weight]");
      const approval = row.querySelector("[data-rule-approval]");
      const evidence = row.querySelector("[data-rule-evidence]");
      const exclusions = row.querySelector("[data-rule-exclusions]");
      const notes = row.querySelector("[data-rule-notes]");
      if(enabled) rule.enabled = !!enabled.checked;
      if(weight) rule.weightPercent = numOrNull(weight.value);
      const sevInputs = row.querySelectorAll("[data-sev-weight]");
      if(sevInputs.length){
        rule.severityWeights = rule.severityWeights || {};
        sevInputs.forEach(input => { rule.severityWeights[input.getAttribute("data-sev-weight")] = numOrNull(input.value); });
      }
      if(approval) rule.approvalStatus = approval.value;
      if(evidence) rule.evidenceRequired = parseLines(evidence.value);
      if(exclusions) rule.exclusions = parseLines(exclusions.value);
      if(notes) rule.notes = notes.value.trim();
    });
  }

  function numOrNull(v){
    const s = String(v == null ? "" : v).trim();
    if(!s) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function parseLines(v){
    return String(v || "").split(/[\n;]+/).map(x => x.trim()).filter(Boolean);
  }

  function byObligation(items){
    const out = {};
    list(items).forEach(item => { if(item && item.obligationId) out[item.obligationId] = item; });
    return out;
  }
})();
