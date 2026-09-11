/* Salam DMS · Topology 2 — interactive, source-linked system map (PAYMENTS slice).
 * Reads window.TOPO2 (topo2data.js). Renders a zoom/pan SVG map + filters + search, and a
 * click-through side inspector with tabs: Overview · API doc · Source refs · Failures · Dependencies.
 * Standalone from the legacy Topology page (data.js/app.js) so both can run side by side. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const SVGNS = "http://www.w3.org/2000/svg";

  let T = null;                       // window.TOPO2
  const POS = {};                     // node id → {x,y,cx,cy}
  const NODE_BY = {};                 // id → node
  let sel = null;                     // current selection {kind:'node'|'edge', data}
  const filterKinds = new Set();      // kinds hidden
  let q = "";                         // search query
  const view = { k: 1, tx: 0, ty: 0 };
  const W = 168, H = 50, VGAP = 18, COLW = 250, MX = 34, MY = 46;

  /* the page now has two tabs — the source map draws into #t2Host, the HLD atlas sits in #t2Hld */
  function hostEl() { return document.getElementById("t2Host") || document.getElementById("view-topology2"); }
  function selectTab(t) {
    const map = t !== "hld";
    const mh = document.getElementById("t2Host"), hl = document.getElementById("t2Hld");
    if (!mh || !hl) return;
    mh.hidden = !map; hl.hidden = map;
    document.querySelectorAll("#t2Tabs .t2tab").forEach(b => b.classList.toggle("active", (b.dataset.t2 === "hld") === !map));
    /* the atlas is only fetched the first time it is asked for */
    const f = document.getElementById("mvnoHldFrame");
    if (!map && f && !f.getAttribute("src")) f.setAttribute("src", f.dataset.src || "mvno-rodod-hld.html");
    try { history.replaceState(null, "", "#" + (map ? "topology2" : "mvnohld")); } catch (e) {}
  }
  function wireTabs() {
    document.querySelectorAll("#t2Tabs .t2tab").forEach(b => {
      if (b.__wired) return; b.__wired = true;
      b.addEventListener("click", () => selectTab(b.dataset.t2));
    });
  }

  function boot() {
    T = window.TOPO2;
    wireTabs();
    const host = hostEl();
    if (!host || !T) return;
    host.innerHTML = shell();
    layout();
    drawFilters();
    render();
    wire();
  }

  function shell() {
    return `
    <div class="panel" style="padding:0;overflow:hidden">
      <div class="t2-head">
        <div>
          <div style="font-size:18px;font-weight:800">Topology · ${esc(T.meta.domain)} <span class="rl" style="font-weight:600;font-size:11px">— source-linked map · ${esc(T.meta.repo)} ${esc(T.meta.release)}</span></div>
          <div class="rl">Click any component or flow → API doc · source refs (class · file · line) · failure cases · dependencies. Drag to pan, scroll to zoom.</div>
        </div>
        <div class="t2-tools">
          <input id="t2Search" placeholder="Search component / class / file…" />
          <button class="pill" id="t2Reset">Reset view</button>
        </div>
      </div>
      <div class="t2-filters" id="t2Filters"></div>
      <div class="t2-stage">
        <svg id="t2Svg" xmlns="${SVGNS}"><defs>
          <marker id="t2arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>
        </defs><g id="t2Pan"></g></svg>
        <aside id="t2Inspector" class="t2-insp"></aside>
      </div>
    </div>
    <style>
      .t2-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
      .t2-tools{display:flex;gap:8px;align-items:center}
      .t2-tools input{padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink);font-size:12px;min-width:230px}
      .t2-filters{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--line);align-items:center}
      .t2-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid var(--line);background:var(--card2);color:var(--ink);font-size:11px;font-weight:700;cursor:pointer;user-select:none}
      .t2-chip.off{opacity:.38;text-decoration:line-through}
      .t2-chip i{width:9px;height:9px;border-radius:2px;display:inline-block}
      .t2-stage{position:relative;display:flex;flex-direction:column}
      #t2Svg{flex:1;height:calc(100vh - 440px);min-height:340px;display:block;cursor:grab;background:
        radial-gradient(circle at 1px 1px, var(--line-soft,#e5e7eb) 1px, transparent 0) 0 0/22px 22px}
      #t2Svg.grabbing{cursor:grabbing}
      .t2-node rect{rx:9;transition:filter .1s}
      .t2-node text{pointer-events:none}
      .t2-node.dim{opacity:.18}
      .t2-node.hit rect{stroke:#f59e0b !important;stroke-width:2.5}
      .t2-edge{fill:none;transition:opacity .1s}
      .t2-edge.dim{opacity:.05}
      .t2-insp{height:0;overflow:hidden;transition:height .16s ease;border-top:0 solid var(--line);background:var(--card)}
      .t2-insp.open{height:340px;border-top:1px solid var(--line)}
      .t2-ibody{width:100%;height:340px;overflow:auto;padding:12px 18px}
      .t2-doc2{display:grid;grid-template-columns:minmax(280px,1fr) minmax(320px,1.2fr);gap:20px}
      @media(max-width:1000px){.t2-doc2{grid-template-columns:1fr}}
      .t2-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:var(--card2);border:1px solid var(--line);margin:0 6px 6px 0}
      .t2-badge b{font-family:var(--mono,monospace)}
      .t2-live-ok{border-left:3px solid #10b981}
      .t2-live-fail{border-left:3px solid #ef4444}
      .t2-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:10px 0}
      .t2-tab{padding:5px 10px;border-radius:7px;border:1px solid var(--line);background:var(--card2);font-size:11px;font-weight:700;cursor:pointer}
      .t2-tab.on{background:var(--ink);color:var(--card)}
      .t2-src{border:1px solid var(--line);border-radius:8px;padding:9px 11px;margin:8px 0;background:var(--card2)}
      .t2-src .cls{font-family:var(--mono,monospace);font-weight:800;font-size:12px}
      .t2-fl{font-family:var(--mono,monospace);font-size:11px;color:var(--blue,#2563eb)}
      .t2-meth{font-family:var(--mono,monospace);font-size:11px;margin:3px 0;color:var(--ink)}
      .t2-meth b{color:#7c3aed}
      .t2-dep{display:inline-block;font-family:var(--mono,monospace);font-size:10.5px;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1px 6px;margin:2px 3px 0 0}
      .t2-fail{border-left:3px solid #ef4444;padding:4px 9px;margin:7px 0;background:#ef44440d;border-radius:0 6px 6px 0;font-size:12px}
      .t2-kv{font-size:12px;margin:4px 0}
      .t2-code{font-family:var(--mono,monospace);font-size:11px;white-space:pre-wrap;background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0}
      .t2-pill-req{display:inline-block;font-size:10px;font-weight:800;padding:1px 7px;border-radius:5px;background:#0e9f5a22;color:#0e9f5a;margin-right:6px}
    </style>`;
  }

  // ---- layout: columns by group.col, nodes stacked within column ------------------------------
  function layout() {
    const byCol = {};
    T.groups.forEach(g => { byCol[g.col] = g; });
    const nodesByGroup = {};
    T.nodes.forEach(n => { (nodesByGroup[n.group] ||= []).push(n); NODE_BY[n.id] = n; });
    let maxRows = 0, maxCol = 0;
    T.groups.forEach(g => {
      const list = nodesByGroup[g.id] || [];
      maxRows = Math.max(maxRows, list.length);
      maxCol = Math.max(maxCol, g.col);
      list.forEach((n, i) => {
        const x = MX + g.col * COLW, y = MY + i * (H + VGAP);
        POS[n.id] = { x, y, cx: x + W / 2, cy: y + H / 2 };
      });
    });
    const svg = $("#t2Svg");
    svg.__w = MX * 2 + maxCol * COLW + W;
    svg.__h = MY + maxRows * (H + VGAP) + 20;
    svg.setAttribute("viewBox", `0 0 ${svg.__w} ${svg.__h}`);
    svg.__groups = nodesByGroup;
  }

  function edgeColor(type) { return (T.kinds[type] && T.kinds[type].color) || "#94a3b8"; }

  function edgePath(e) {
    const a = POS[e.from], b = POS[e.to]; if (!a || !b) return null;
    const forward = b.x >= a.x;
    const x1 = forward ? a.x + W : a.x, y1 = a.cy;
    const x2 = forward ? b.x : b.x + W, y2 = b.cy;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.4) * (forward ? 1 : -1);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }

  function hiddenNode(n) {
    if (filterKinds.has(n.kind)) return true;
    if (q) { const hay = (n.label + " " + n.sub + " " + JSON.stringify(n.detail || {})).toLowerCase(); if (!hay.includes(q)) return true; }
    return false;
  }

  function render() {
    const g = $("#t2Pan");
    g.setAttribute("transform", `translate(${view.tx},${view.ty}) scale(${view.k})`);
    let h = "";
    // group headers
    T.groups.forEach(gr => {
      const x = MX + gr.col * COLW;
      h += `<text x="${x}" y="26" font-size="11" font-weight="800" letter-spacing=".5" fill="${gr.color}">${esc(gr.label)}</text>`;
    });
    // edges
    T.edges.forEach((e, i) => {
      const p = edgePath(e); if (!p) return;
      const dim = hiddenNode(NODE_BY[e.from]) || hiddenNode(NODE_BY[e.to]);
      const c = edgeColor(e.type);
      h += `<path class="t2-edge${dim ? " dim" : ""}" data-edge="${i}" d="${p}" stroke="${c}" stroke-width="1.6" opacity="0.4" marker-end="url(#t2arrow)"><title>${esc(e.label || "")}</title></path>`;
    });
    // nodes
    T.nodes.forEach(n => {
      const p = POS[n.id]; if (!p) return;
      const dim = hiddenNode(n);
      const c = (T.kinds[n.kind] && T.kinds[n.kind].color) || "#64748b";
      h += `<g class="t2-node${dim ? " dim" : ""}" data-node="${esc(n.id)}" style="cursor:pointer">
        <rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="9" fill="var(--card2)" stroke="var(--line)" stroke-width="1"/>
        <rect x="${p.x}" y="${p.y}" width="4" height="${H}" rx="2" fill="${c}"/>
        <text x="${p.x + 12}" y="${p.y + 20}" font-size="12" font-weight="800" fill="var(--ink)">${esc(clip(n.label, 22))}</text>
        <text x="${p.x + 12}" y="${p.y + 36}" font-size="9.5" fill="var(--muted)">${esc(clip(n.sub, 30))}</text>
      </g>`;
    });
    g.innerHTML = h;
    // wire node/edge clicks
    g.querySelectorAll("[data-node]").forEach(el => el.addEventListener("click", ev => { ev.stopPropagation(); selectNode(el.dataset.node); }));
    g.querySelectorAll("[data-edge]").forEach(el => el.addEventListener("click", ev => { ev.stopPropagation(); selectEdge(Number(el.dataset.edge)); }));
    applyHighlight();
  }

  const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  function drawFilters() {
    const host = $("#t2Filters");
    const chips = Object.entries(T.kinds).map(([k, v]) =>
      `<span class="t2-chip" data-kind="${k}"><i style="background:${v.color}"></i>${esc(v.label)}</span>`).join("");
    host.innerHTML = `<span class="rl" style="font-weight:700;margin-right:2px">Filter</span>${chips}
      <span class="rl" style="margin-left:auto">${T.nodes.length} components · ${T.edges.length} flows</span>`;
    host.querySelectorAll("[data-kind]").forEach(c => c.addEventListener("click", () => {
      const k = c.dataset.kind; if (filterKinds.has(k)) filterKinds.delete(k); else filterKinds.add(k);
      c.classList.toggle("off", filterKinds.has(k)); render();
    }));
  }

  // ---- selection + highlight ------------------------------------------------------------------
  function neighbors(id) { const up = new Set(), down = new Set();
    T.edges.forEach(e => { if (e.from === id) down.add(e.to); if (e.to === id) up.add(e.from); }); return { up, down }; }

  function applyHighlight() {
    const g = $("#t2Pan");
    g.querySelectorAll(".t2-node").forEach(el => el.classList.remove("hit"));
    g.querySelectorAll(".t2-edge").forEach(el => el.style.opacity = el.classList.contains("dim") ? "" : "0.4");
    if (!sel) return;
    if (sel.kind === "node") {
      const id = sel.data.id; const nb = neighbors(id);
      const el = g.querySelector(`[data-node="${cssEsc(id)}"]`); if (el) el.classList.add("hit");
      g.querySelectorAll(".t2-edge").forEach((pe, i) => {
        const e = T.edges[i]; if (e.from === id || e.to === id) pe.style.opacity = "0.95"; else if (!pe.classList.contains("dim")) pe.style.opacity = "0.08";
      });
    } else if (sel.kind === "edge") {
      const i = sel.idx; const pe = g.querySelectorAll(".t2-edge")[i]; if (pe) pe.style.opacity = "1";
    }
  }
  const cssEsc = s => (window.CSS && CSS.escape) ? CSS.escape(s) : s;

  function selectNode(id) { sel = { kind: "node", data: NODE_BY[id] }; openInspector(); applyHighlight(); if (window.audit) window.audit("VIEW_TOPO2", id); }
  function selectEdge(i) { sel = { kind: "edge", idx: i, data: T.edges[i] }; openInspector(); applyHighlight(); }

  // ---- inspector ------------------------------------------------------------------------------
  let tab = "overview";
  function openInspector() {
    const insp = $("#t2Inspector"); insp.classList.add("open");
    tab = "overview"; renderInspector();
  }
  function closeInspector() { $("#t2Inspector").classList.remove("open"); sel = null; applyHighlight(); }

  function renderInspector() {
    const insp = $("#t2Inspector");
    const isNode = sel.kind === "node";
    const d = sel.data.detail || {};
    const title = isNode ? sel.data.label : `${NODE_BY[sel.data.from] ? NODE_BY[sel.data.from].label : sel.data.from} → ${NODE_BY[sel.data.to] ? NODE_BY[sel.data.to].label : sel.data.to}`;
    const sub = isNode ? sel.data.sub : (sel.data.label || "flow");
    const kindLabel = isNode ? (T.kinds[sel.data.kind] || {}).label : (T.kinds[sel.data.type] || {}).label;
    const tabs = [["overview", "Overview"], ["doc", "API doc"], ["src", "Source refs"], ["fail", "Failures"], ["deps", "Dependencies"]];
    insp.innerHTML = `<div class="t2-ibody">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div><div style="font-size:15px;font-weight:800">${esc(title)}</div>
          <div class="rl">${esc(kindLabel || "")}${sub ? " · " + esc(sub) : ""}</div></div>
        <button class="pill" id="t2Close" style="padding:2px 9px">✕</button>
      </div>
      <div class="t2-tabs">${tabs.map(t => `<span class="t2-tab ${tab === t[0] ? "on" : ""}" data-tab="${t[0]}">${t[1]}</span>`).join("")}</div>
      <div id="t2TabBody">${tabBody(d)}</div>
    </div>`;
    insp.querySelector("#t2Close").addEventListener("click", closeInspector);
    insp.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; renderInspector(); }));
    if (tab === "doc") { const live = insp.querySelector("#t2Live"); if (live) loadLive(live.dataset.node, live); }
  }

  // ---- live evidence: masked sample payload + timing + vendor stats from the replica ----------
  const _liveCache = {};
  async function loadLive(nodeId, el) {
    if (!nodeId) { el.innerHTML = ""; return; }
    if (_liveCache[nodeId]) { el.innerHTML = liveHtml(_liveCache[nodeId]); return; }
    try {
      const API = window.API_BASE;
      const r = await window.fetch(API + "/api/topo2/sample?node=" + encodeURIComponent(nodeId));
      const d = await r.json();
      _liveCache[nodeId] = d;
      el.innerHTML = liveHtml(d);
    } catch (e) { el.innerHTML = `<div class="rl">No live sample available.</div>`; }
  }
  function liveHtml(d) {
    let h = `<div class="rl" style="font-weight:800;margin-bottom:6px">LIVE EVIDENCE <span style="font-weight:600">· masked · replica</span></div>`;
    const has = d.timing || d.stats || (d.samples && d.samples.length);
    if (!has) return h + `<div class="rl">No live sample for this component yet (no matching rows / traffic-log not collected).</div>`;
    // timing badges
    if (d.timing) h += `<div style="margin-bottom:8px">
      <span class="t2-badge" title="mean response time">avg <b>${d.timing.avg_ms} ms</b></span>
      <span class="t2-badge" title="95th percentile">p95 <b>${d.timing.p95_ms} ms</b></span>
      <span class="t2-badge">max <b>${d.timing.max_ms} ms</b></span>
      <span class="t2-badge">n <b>${d.timing.n.toLocaleString()}</b> · ${d.timing.window_days}d</span></div>`;
    // vendor stats
    if (d.stats) {
      const s = d.stats;
      h += `<div style="margin-bottom:8px">
        <span class="t2-badge">${s.window_days}d vol <b>${(s.total||0).toLocaleString()}</b></span>
        <span class="t2-badge" style="color:#10b981">ok <b>${(s.success||0).toLocaleString()}</b></span>
        <span class="t2-badge" style="color:#ef4444">fail <b>${(s.fail||0).toLocaleString()}</b></span>
        ${s.success_rate!=null?`<span class="t2-badge">success <b>${s.success_rate}%</b></span>`:""}</div>`;
      if (s.top_decline) h += `<div class="t2-fail" style="margin:0 0 8px">Top decline · <b>${esc(s.top_decline.code||"")}</b> ${esc(s.top_decline.message||"")} <span class="rl">×${s.top_decline.n}</span></div>`;
    }
    // masked sample payloads
    (d.samples || []).forEach(s => {
      if (!s.response) return;
      const cls = s.outcome === "success" ? "t2-live-ok" : "t2-live-fail";
      h += `<div class="rl" style="margin:8px 0 2px;font-weight:700">${s.outcome === "success" ? "✓ success" : "✕ fail"} sample${s.when ? ` · ${esc(KT.dt(s.when))}` : ""}${s.amount != null ? ` · ${esc(s.amount)} SAR` : ""}</div>
        <div class="t2-code ${cls}">${esc(pretty(s.response))}</div>`;
    });
    return h;
  }
  function pretty(o) { try { return clip(JSON.stringify(o, null, 1), 1400); } catch (e) { return String(o); } }

  function tabBody(d) {
    if (tab === "overview") return overviewTab(d);
    if (tab === "doc") return docTab(d);
    if (tab === "src") return srcTab(d);
    if (tab === "fail") return failTab(d);
    if (tab === "deps") return depsTab(d);
    return "";
  }

  function overviewTab(d) {
    let h = `<div class="t2-kv">${esc(d.overview || "No description yet.")}</div>`;
    const s = (d.src || []); if (s.length) h += `<div class="rl" style="margin-top:10px">Primary class</div><div class="t2-src"><div class="cls">${esc(s[0].cls)}</div><div class="t2-fl">${esc(s[0].file)}${s[0].line ? ":" + s[0].line : ""}</div></div>`;
    if (d.doc) h += `<div class="rl" style="margin-top:8px">Has an API contract — see the <b>API doc</b> tab.</div>`;
    if (d.failures && d.failures.length) h += `<div class="rl" style="margin-top:6px">${d.failures.length} known failure case(s) — see <b>Failures</b>.</div>`;
    return h;
  }

  function docTab(d) {
    // two columns: the contract (left) + live, masked evidence from the replica/logs (right)
    const nodeId = sel.kind === "node" ? sel.data.id : sel.data.to;   // edges → use the target node
    return `<div class="t2-doc2">
      <div>${contractHtml(d)}</div>
      <div id="t2Live" data-node="${esc(nodeId)}"><div class="rl">Loading live sample &amp; timing…</div></div>
    </div>`;
  }
  function contractHtml(d) {
    const doc = d.doc;
    if (!doc) return `<div class="rl">No API contract for this component. (Internal helper / model.)</div>`;
    // real Slate doc reference
    if (doc.ref && typeof API_DOCS !== "undefined") {
      const real = API_DOCS.find(x => x.id === doc.ref);
      if (real) {
        let h = `<span class="t2-pill-req">REAL DOC</span> <b>${esc(real.methodPath || real.title)}</b>`;
        if (real.prose) h += `<div class="t2-kv" style="margin-top:6px">${esc(clip(strip(real.prose), 400))}</div>`;
        if (real.params && real.params.length) h += `<div class="rl" style="margin-top:8px">Params</div>` + real.params.slice(0, 12).map(p => `<div class="t2-meth">${esc(typeof p === "string" ? p : (p.name || JSON.stringify(p)))}</div>`).join("");
        if (real.curls && real.curls.length) h += `<div class="rl" style="margin-top:8px">Example</div><div class="t2-code">${esc(clip(real.curls[0], 500))}</div>`;
        if (real.responses && real.responses.length) h += `<div class="rl" style="margin-top:8px">Responses</div><div class="t2-code">${esc(clip(String(real.responses[0].body || real.responses[0]), 500))}</div>`;
        return h;
      }
    }
    // synthesised contract from source
    let h = `<span class="t2-pill-req" style="background:#7c3aed22;color:#7c3aed">FROM SOURCE</span> <b>${esc(doc.verb || "")} ${esc(doc.path || "")}</b>`;
    if (doc.req && doc.req.length) h += `<div class="rl" style="margin-top:8px">Request</div>` + doc.req.map(r => `<div class="t2-meth">${esc(r)}</div>`).join("");
    if (doc.res && doc.res.length) h += `<div class="rl" style="margin-top:8px">Response</div>` + doc.res.map(r => `<div class="t2-meth">${esc(r)}</div>`).join("");
    if (doc.fail && doc.fail.length) h += `<div class="rl" style="margin-top:8px">Failure cases</div>` + doc.fail.map(r => `<div class="t2-fail">${esc(r)}</div>`).join("");
    return h;
  }
  const strip = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  function fileLink(file, line) {
    const url = T.meta.repoUrl;
    const label = esc(file) + (line ? ":" + line : "");
    if (url) return `<a class="t2-fl" href="${esc(url + file + (line ? "#L" + line : ""))}" target="_blank" rel="noopener">${label} ↗</a>`;
    return `<span class="t2-fl">${label}</span>`;
  }

  function srcTab(d) {
    const s = d.src || [];
    if (!s.length) return `<div class="rl">No direct source class for this flow node.</div>`;
    return s.map(x => `<div class="t2-src">
      <div class="cls">${esc(x.cls)}</div>
      <div style="margin:3px 0">${fileLink(x.file, x.line)}</div>
      ${(x.methods || []).map(mm => `<div class="t2-meth"><b>${esc(mm.n)}</b>@${mm.l} — ${esc(mm.p)}</div>`).join("")}
      ${(x.deps || []).length ? `<div class="rl" style="margin-top:6px">calls</div>${x.deps.map(dp => `<span class="t2-dep">${esc(dp)}</span>`).join("")}` : ""}
    </div>`).join("");
  }

  function failTab(d) {
    const f = d.failures || [];
    if (!f.length) return `<div class="rl">No failure cases catalogued for this node yet.</div>`;
    return f.map(x => `<div class="t2-fail"><b>${esc(x.type)}</b>${x.at ? ` <span class="t2-fl">${esc(x.at)}</span>` : ""}<div style="margin-top:2px">${esc(x.note || "")}</div></div>`).join("");
  }

  function depsTab(d) {
    let h = "";
    // code-level deps (from src)
    const codeDeps = new Set(); (d.src || []).forEach(s => (s.deps || []).forEach(x => codeDeps.add(x)));
    if (codeDeps.size) h += `<div class="rl">Code dependencies (calls)</div><div style="margin:4px 0 10px">${[...codeDeps].map(x => `<span class="t2-dep">${esc(x)}</span>`).join("")}</div>`;
    // graph deps (edges) — only for nodes
    if (sel.kind === "node") {
      const nb = neighbors(sel.data.id);
      const list = (set, dir) => [...set].map(id => `<div class="t2-meth" data-goto="${esc(id)}" style="cursor:pointer">${dir} <b>${esc(NODE_BY[id] ? NODE_BY[id].label : id)}</b></div>`).join("");
      if (nb.up.size) h += `<div class="rl" style="margin-top:6px">Upstream (calls in)</div>${list(nb.up, "←")}`;
      if (nb.down.size) h += `<div class="rl" style="margin-top:6px">Downstream (calls out)</div>${list(nb.down, "→")}`;
    }
    if (!h) h = `<div class="rl">No dependencies recorded.</div>`;
    // clickable neighbor navigation
    setTimeout(() => { document.querySelectorAll("#t2TabBody [data-goto]").forEach(el => el.addEventListener("click", () => selectNode(el.dataset.goto))); }, 0);
    return h;
  }

  // ---- pan / zoom + wiring --------------------------------------------------------------------
  function wire() {
    const svg = $("#t2Svg");
    let drag = null;
    svg.addEventListener("mousedown", e => { if (e.target.closest("[data-node],[data-edge]")) return; drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; svg.classList.add("grabbing"); });
    window.addEventListener("mousemove", e => { if (!drag) return; view.tx = drag.tx + (e.clientX - drag.x); view.ty = drag.ty + (e.clientY - drag.y); applyTransform(); });
    window.addEventListener("mouseup", () => { drag = null; svg.classList.remove("grabbing"); });
    svg.addEventListener("wheel", e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.12 : 0.89; view.k = Math.min(2.4, Math.max(0.4, view.k * f)); applyTransform(); }, { passive: false });
    svg.addEventListener("click", e => { if (!e.target.closest("[data-node],[data-edge]")) closeInspector(); });
    $("#t2Reset").addEventListener("click", () => { view.k = 1; view.tx = 0; view.ty = 0; applyTransform(); });
    const si = $("#t2Search"); si.addEventListener("input", () => { q = si.value.trim().toLowerCase(); render(); });
  }
  function applyTransform() { $("#t2Pan").setAttribute("transform", `translate(${view.tx},${view.ty}) scale(${view.k})`); }

  // public entry — called by the router / nav
  window.openTopology2 = function (tab) {
    const host = hostEl();
    if (host && (!T || !host.querySelector("#t2Svg"))) boot(); else wireTabs();
    selectTab(tab === "hld" ? "hld" : "map");
  };
  // build eagerly once DOM + data are present (so the tab is instant)
  if (document.readyState !== "loading") setTimeout(boot, 0);
  else document.addEventListener("DOMContentLoaded", boot);
})();
