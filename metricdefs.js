/* metricdefs.js — Alerts › "⚙ Metrics" (console-managed custom metrics) and "⛁ Data sources" tabs, both segments.
 * Server: server/src/customMetrics.js (/api/metric-defs…) and server/src/datasets.js (/api/datasets…).
 * Loaded by index.html after alertsview.js; alertsview dispatches window.renderMetricDefsInto / renderSourcesInto.
 * Vanilla JS, no build. Dark mode + phone: reuses the rule-drawer classes (.drawer .rdrawer .rd-*) and .rlb badges. */
(function(){
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const API = window.API_BASE || window.CONSOLE_BASE || "";
  async function api(path, opts) {
    const r = await fetch(API + path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ("HTTP " + r.status)); return j;
  }
  const canEdit = () => !!(window.opsCan && window.opsCan("editRules"));
  const ago = iso => { if (!iso) return "—"; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60e3); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
  const fmtVal = (unit, v) => v == null ? "—" : unit === "rate" ? (Number(v) * 100).toFixed(1) + "%" : unit === "ms" ? Math.round(Number(v)) + " ms" : Number.isInteger(Number(v)) ? String(v) : Number(v).toFixed(2);
  const STATUS = { draft: ["draft", ""], shadow: ["shadow", "purple"], live: ["live", "ok"], suspended: ["suspended", "red"], retired: ["retired", ""] };
  const stPill = st => { const [l, c] = STATUS[st] || [st, ""]; return `<span class="rlb ${c}">${esc(l)}</span>`; };
  const fresh = d => { const f = d.freshness || {}; const c = d.status === "synced" ? "ok" : d.status === "lagging" ? "warn" : d.status === "stale" ? "red" : ""; const t = d.status === "unavailable" ? (f.reason || "unavailable") : d.status === "empty" ? "no rows in 2 days" : `newest ${ago(f.newest)} · lag ${f.lagMin} min · ${f.n1h} rows/h`; return `<span class="rlb ${c}" title="${esc(t)}">${esc(d.status)}</span> <span class="rl">${esc(t)}</span>`; };
  const OPS = { eq: "= equals", neq: "≠ not", in: "in list (a, b, c)", like: "contains", gt: "> more than", gte: "≥ at least", lt: "< less than", lte: "≤ at most", null: "is empty", notnull: "is set" };
  const MEAS = { count: ["Count of rows", "how many rows match the filters in the window"], rate: ["Rate (share of rows)", "rows matching the NUMERATOR ÷ rows matching the filters — the classic failure rate"], p95: ["p95 of a numeric column", "95th percentile (latency, duration, amount)"], p50: ["Median (p50) of a numeric column", ""], avg: ["Average of a numeric column", ""], distinct: ["Distinct values of a column", "e.g. distinct dealers / request ids hit"] };
  let DS = {};   // dataset key → dataset (with columns)
  const ACTION = { create: ["created", "ok"], update: ["updated", ""], status: ["status", "purple"], rollback: ["rollback", "warn"], suspend: ["suspended", "red"], auto_promote: ["auto → live", "ok"] };
  const actPill = a => { const [l, c] = ACTION[a] || [a, ""]; return `<span class="rlb ${c}">${esc(l)}</span>`; };
  const fv = v => v == null || v === "" ? "<i style='opacity:.6'>—</i>" : esc(typeof v === "object" ? JSON.stringify(v) : String(v));
  const diffHtml = ch => { const ks = Object.keys(ch || {}); if (!ks.length) return "<span class='rl'>no field change</span>"; return ks.map(k => `<div style="font-size:11.5px;line-height:1.5"><span class="mono" style="color:var(--muted)">${esc(k)}</span>: ${fv(ch[k].from)} <span style="color:var(--muted)">→</span> <b>${fv(ch[k].to)}</b></div>`).join(""); };
  const when = iso => iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + "Z" : "—";

  /* ================= DATA SOURCES ================= */
  async function renderSourcesInto(body, SEG) {
    body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">${window.salamLoader ? window.salamLoader("Checking data sources…") : "Loading…"}</div>`;
    let list; try { list = (await api("/api/datasets?segment=" + SEG)).datasets; } catch (e) { body.innerHTML = `<div class="albanner">${esc(e.message)}</div>`; return; }
    list.forEach(d => DS[d.key] = d);
    const synced = list.filter(d => d.status === "synced").length, bad = list.filter(d => d.status === "stale" || d.status === "unavailable").length;
    let h = `<div class="rl" style="margin:0 0 10px;max-width:980px">Every table this segment's metrics read, mapped to the <b>prod source the L2 team monitors</b>, how it is synced and whether it is fresh <b>right now</b> (newest row vs the expected lag). The same "data as of" stamp is written on each incident. ${canEdit() ? "Label, prod equivalent and expected lag are editable (audited)." : ""}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><span class="rlb ok">${synced} synced</span><span class="rlb warn">${list.filter(d => d.status === "lagging").length} lagging</span><span class="rlb red">${bad} stale / unavailable</span><button class="pill" id="dsRefresh" style="margin-left:auto">↻ Refresh</button></div>
      <div style="overflow-x:auto"><table class="alerts" style="min-width:960px"><tr><th>STATUS</th><th>CONSOLE DATASET</th><th>PROD EQUIVALENT (what L2 watches)</th><th>SYNC</th><th>EXPECTED LAG</th><th>FRESHNESS</th>${canEdit() ? "<th></th>" : ""}</tr>`;
    for (const d of list) {
      h += `<tr data-ds="${esc(d.key)}"><td>${fresh(d).split(" ")[0]}</td>
        <td><b>${esc(d.label)}</b>${d.overridden ? ' <span class="rl" style="font-size:10px">edited</span>' : ""}<br><span class="mono" style="font-size:11px;color:var(--muted)">${esc(d.pool ? d.pool + " · " + d.table : "—")}${d.timeCol ? " · " + esc(d.timeCol) : ""}</span>${d.columns && d.columns.length ? `<div class="rl" style="font-size:10.5px">${d.columns.length} usable columns${d.columns.some(c => c.derived) ? " · derived: " + esc(d.columns.filter(c => c.derived).map(c => c.name).join(", ")) : ""}</div>` : ""}</td>
        <td style="max-width:360px"><span class="ds-prod">${esc(d.prod)}</span></td><td class="rl">${esc(d.sync)}</td><td><span class="ds-lag">${d.lagMin} min</span></td><td>${fresh(d)}</td>
        ${canEdit() ? `<td style="white-space:nowrap"><button class="pill" data-dsedit="${esc(d.key)}" style="padding:3px 10px">✎ Edit</button></td>` : ""}</tr>`;
    }
    body.innerHTML = h + `</table></div>`;
    $("#dsRefresh", body).onclick = () => renderSourcesInto(body, SEG);
    body.querySelectorAll("[data-dsedit]").forEach(b => b.onclick = () => {
      const d = DS[b.dataset.dsedit]; const tr = b.closest("tr");
      tr.innerHTML = `<td colspan="7"><div class="fgrid" style="grid-template-columns:1fr 2fr 120px"><div><label>LABEL</label><input id="dsl" value="${esc(d.label)}"></div><div><label>PROD EQUIVALENT (what the L2 team monitors)</label><input id="dsp" value="${esc(d.prod)}"></div><div><label>EXPECTED LAG (min)</label><input id="dsg" type="number" min="1" value="${d.lagMin}"></div></div>
        <div style="display:flex;gap:6px;margin-top:8px"><button class="pill" id="dsSave" style="border-left-color:var(--green)">Save</button><button class="pill" id="dsCancel">Cancel</button></div></td>`;
      $("#dsCancel", tr).onclick = () => renderSourcesInto(body, SEG);
      $("#dsSave", tr).onclick = async () => { try { await api("/api/datasets/" + encodeURIComponent(d.key), { method: "PATCH", body: JSON.stringify({ label: $("#dsl", tr).value, prod: $("#dsp", tr).value, lagMin: Number($("#dsg", tr).value) }) }); renderSourcesInto(body, SEG); } catch (e) { alert(e.message); } };
    });
  }

  /* ================= METRICS LIST ================= */
  function measureText(spec) {
    const m = spec.measure || {}; const f = (spec.filters || []).length;
    let t = m.type === "rate" ? `rate: ${(m.numerator || []).map(x => x.col + " " + (OPS[x.op] || x.op).split(" ")[0] + " " + (x.value ?? "")).join(" & ")}` : m.type === "count" ? "count" : `${m.type}(${m.column})`;
    if (f) t += ` · ${f} filter${f > 1 ? "s" : ""}`; if (spec.dimension) t += ` · by ${spec.dimension}${spec.includeAll ? " + all" : ""}`;
    return t;
  }
  async function renderMetricDefsInto(body, SEG) {
    body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">${window.salamLoader ? window.salamLoader("Loading custom metrics…") : "Loading…"}</div>`;
    let defs, dsl, cat, chg; try { [defs, dsl, cat, chg] = await Promise.all([api("/api/metric-defs?segment=" + SEG).then(r => r.defs), api("/api/datasets?segment=" + SEG).then(r => r.datasets), api("/api/metric-defs/catalog?segment=" + SEG).then(r => r.metrics), api("/api/metric-defs/changes?segment=" + SEG + "&days=30").then(r => r.changes).catch(() => [])]); } catch (e) { body.innerHTML = `<div class="albanner">${esc(e.message)}</div>`; return; }
    const lastBy = {}; for (const c of chg) if (!lastBy[c.key]) lastBy[c.key] = c;
    dsl.forEach(d => DS[d.key] = d);
    const builtin = cat.filter(m => !m.custom); const q0 = (window.__mdQ || "").toLowerCase();
    const match = m => !q0 || (m.key + " " + m.label + " " + (m.source || "")).toLowerCase().includes(q0);
    const lastTxt = m => m.last ? `${fmtVal(m.unit, m.last.value)}${m.last.rows > 1 ? ` · ${m.last.rows} rows` : ""} · n=${m.last.sample} · ${ago(m.last.at)}` : "<span class='rl'>no snapshot in 2 days — no enabled rule needs it</span>";
    let h = `<div class="rl" style="margin:0 0 10px;max-width:980px">The <b>full metric registry</b> of ${SEG === "fixed" ? "Fixed" : "Mobile"}: <b>${builtin.length} built-in code metrics</b> (server/src — every key a rule can reference, with the rules using it and the latest computed value) and the <b>custom metrics</b> defined here without code or deploy (data source · measure · filters · dimension → a bounded, parameterised query; lifecycle <b>draft → shadow → live</b>, in shadow nothing pages). Built-in metrics are edited in code only; see the Alerting reference document for the contract.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">${canEdit() ? `<button class="pill" id="mdNew" style="border-left-color:var(--green)">+ New custom metric</button>` : ""}<input id="mdQ" placeholder="search key · label · source…" value="${esc(window.__mdQ || "")}" style="flex:1 1 200px;min-width:160px;border:1px solid var(--line);background:var(--card2);border-radius:8px;padding:6px 10px;color:var(--ink)"><span class="rlb">${builtin.length} built-in</span><span class="rlb ok">${defs.filter(d => d.status === "live").length} live</span><span class="rlb purple">${defs.filter(d => d.status === "shadow").length} shadow</span><span class="rlb">${defs.filter(d => d.status === "draft").length} draft</span>${defs.some(d => d.status === "suspended") ? `<span class="rlb red">${defs.filter(d => d.status === "suspended").length} suspended</span>` : ""}<button class="pill" id="mdLog" style="border-left-color:#7c3aed">⌛ Change log · ${chg.length}</button><button class="pill" id="mdRefresh">↻ Refresh</button></div>
      <div id="mdLogBox" ${window.__mdLogOpen ? "" : "hidden"} style="margin-bottom:12px"><div class="rl" style="margin-bottom:6px">Every change to a custom metric in the last 30 days — who, when, which field from → to. Same trail as Activity log (actions metric.*); rules on these metrics are tracked in Alert rules → History.</div>
        ${chg.length ? `<div style="overflow-x:auto"><table class="alerts" style="min-width:900px;font-size:11.5px"><tr><th>WHEN</th><th>WHO</th><th>METRIC</th><th>ACTION</th><th>CHANGES (field: from → to)</th><th>NOTE</th></tr>${chg.map(c => `<tr><td class="rl" style="white-space:nowrap">${esc(when(c.at))}<br><span style="font-size:10px">${esc(ago(c.at))}</span></td><td class="rl">${esc(c.actor || "")}${c.source === "system" ? " <span class='rlb' style='font-size:9.5px'>system</span>" : ""}</td><td class="mono" style="font-size:11px">${esc(c.key)}<br><span class="rl" style="font-size:10px">v${c.version}</span></td><td>${actPill(c.action)}</td><td>${diffHtml(c.changes)}</td><td class="rl">${esc(c.note || "")}</td></tr>`).join("")}</table></div>` : `<div class="okbox">No change recorded in the last 30 days.</div>`}</div>`;
    h += `<p style="font-weight:800;font-size:12px;letter-spacing:.05em;color:var(--muted);margin:14px 0 6px">CUSTOM METRICS · CONSOLE-MANAGED</p>`;
    if (!defs.length) h += `<div class="okbox">No custom metric yet for ${SEG === "fixed" ? "Fixed" : "Mobile"}. ${canEdit() ? ("Click <b>+ New custom metric</b> — e.g. " + (SEG === "fixed" ? "“Epurchase feasibility technical rate by provider” on the error board, or “p95 of checkPayment” on the app log." : "“payment failure rate by vendor” on payments, or “technical activation failures by platform” on activation_logs.")) : "An alert admin can create one."}</div>`;
    else {
      h += `<div style="overflow-x:auto"><table class="alerts" style="min-width:980px"><tr><th>STATUS</th><th>METRIC</th><th>SOURCE</th><th>MEASURE</th><th>RULES</th><th>LAST RUN</th><th>OWNER</th><th></th></tr>`;
      for (const d of defs) {
        const ds = DS[d.spec.dataset] || {};
        const last = d.last_run ? `${d.last_rows} row${d.last_rows === 1 ? "" : "s"} · ${d.last_ms} ms · ${ago(d.last_run)}` : "never";
        h += `<tr class="${d.status === "retired" ? "off" : ""}"><td>${stPill(d.status)}${d.status === "shadow" && d.shadow_until ? `<div class="rl" style="font-size:10px">until ${esc(new Date(d.shadow_until).toISOString().slice(0, 16).replace("T", " "))}Z · would fire ×${d.would_fire}</div>` : ""}${d.last_error ? `<div class="rl" style="font-size:10px;color:#dc2626;max-width:180px">${esc(d.last_error).slice(0, 120)}</div>` : ""}</td>
          <td><b>${esc(d.label)}</b><br><span class="mono" style="font-size:11px;color:var(--muted)">${esc(d.key)}</span> <span class="rl" style="font-size:10px">v${d.version} · ${esc(d.unit)}${d.higher_is_bad ? " ↑bad" : " ↓bad"}</span>${d.description ? `<div class="rl" style="font-size:11px;max-width:360px">${esc(d.description)}</div>` : ""}</td>
          <td>${esc(ds.label || d.spec.dataset)}<br>${ds.key ? fresh(ds).split(" ")[0] : ""}</td><td class="rl" style="max-width:260px">${esc(measureText(d.spec))}</td>
          <td>${d.rules ? `${d.rules_on}/${d.rules} on` : `<span class="rl">none</span>`}${d.status === "live" || d.status === "shadow" ? `<div class="rl" style="font-size:10px">Alert rules → + New rule → metric “${esc(d.label)}”</div>` : ""}</td>
          <td class="rl">${esc(last)}</td><td class="rl">${esc(d.owner || "")}<br><span style="font-size:10px">${ago(d.updated_at)} · ${esc(d.updated_by || "")}</span>${lastBy[d.key] ? `<br><span style="font-size:10px">last: ${esc((ACTION[lastBy[d.key].action] || [lastBy[d.key].action])[0])} · ${Object.keys(lastBy[d.key].changes || {}).length} field(s)</span>` : ""}</td>
          <td style="white-space:nowrap">${canEdit() ? `<div class="actbar"><button class="pill actp" data-mdedit="${esc(d.key)}">Edit</button>${d.status === "draft" || d.status === "suspended" || d.status === "retired" ? `<button class="pill" data-mdst="${esc(d.key)}" data-st="shadow" style="border-left-color:#7c3aed">▶ Shadow</button>` : ""}${d.status === "shadow" ? `<button class="pill" data-mdst="${esc(d.key)}" data-st="live" style="border-left-color:var(--green)">✔ Go live</button>` : ""}${d.status === "live" || d.status === "shadow" ? `<button class="pill" data-mdst="${esc(d.key)}" data-st="retired">Retire</button>` : ""}</div>` : ""}</td></tr>`;
      }
      h += `</table></div>`;
    }
    const bl = builtin.filter(match);
    h += `<p style="font-weight:800;font-size:12px;letter-spacing:.05em;color:var(--muted);margin:18px 0 6px">BUILT-IN METRICS · CODE (${bl.length}${q0 ? " of " + builtin.length : ""})</p>
      <div style="overflow-x:auto"><table class="alerts" style="min-width:980px"><tr><th>KEY</th><th>WHAT IT MEASURES</th><th>UNIT</th><th>SOURCE</th><th>RULES</th><th>LATEST VALUE</th><th>DEFINED IN</th></tr>${bl.map(m => `<tr><td class="mono" style="font-size:11px">${esc(m.key)}</td><td><b>${esc(m.label)}</b></td><td class="rl">${esc(m.unit)} ${m.higher_is_bad ? "↑bad" : "↓bad"}</td><td class="rl" style="max-width:220px">${esc(m.source)}</td><td>${m.rules ? `${m.rules_on}/${m.rules} on` : `<span class="rl">none</span>`}</td><td class="rl">${lastTxt(m)}</td><td class="mono rl" style="font-size:10.5px">${esc(m.file)}</td></tr>`).join("")}</table></div>`;
    body.innerHTML = h;
    $("#mdRefresh", body).onclick = () => renderMetricDefsInto(body, SEG);
    $("#mdLog", body).onclick = () => { const b = $("#mdLogBox", body); b.hidden = !b.hidden; window.__mdLogOpen = !b.hidden; };
    const qi = $("#mdQ", body); if (qi) { let t = null; qi.oninput = () => { window.__mdQ = qi.value; clearTimeout(t); t = setTimeout(() => { const pos = qi.selectionStart; renderMetricDefsInto(body, SEG).then(() => { const n = $("#mdQ", body); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); }, 250); }; }
    const nb = $("#mdNew", body); if (nb) nb.onclick = () => openMetricDrawer(null, SEG, () => renderMetricDefsInto(body, SEG));
    body.querySelectorAll("[data-mdedit]").forEach(b => b.onclick = async () => { const d = defs.find(x => x.key === b.dataset.mdedit); openMetricDrawer(d, SEG, () => renderMetricDefsInto(body, SEG)); });
    body.querySelectorAll("[data-mdst]").forEach(b => b.onclick = async () => {
      const st = b.dataset.st; let hours = 24;
      if (st === "shadow") { const v = prompt("Shadow period in hours — computed and charted, rules record what they WOULD fire, nobody is paged. Auto-promotes to live afterwards.", "24"); if (v == null) return; hours = Number(v) || 24; }
      if (st === "live" && !confirm("Go live now? Rules on this metric will page from the next sync.")) return;
      if (st === "retired" && !confirm("Retire this metric? Rules on it will report “no data in window”.")) return;
      try { await api("/api/metric-defs/" + encodeURIComponent(b.dataset.mdst) + "/status", { method: "POST", body: JSON.stringify({ status: st, shadowHours: hours }) }); renderMetricDefsInto(body, SEG); } catch (e) { alert(e.message); }
    });
  }

  /* ================= DRAWER (6 steps) ================= */
  function drawerEl() {
    let ov = document.getElementById("metricDrawer");
    if (!ov) { ov = document.createElement("div"); ov.id = "metricDrawer"; ov.className = "drawer-ov"; ov.innerHTML = `<div class="drawer rdrawer" id="metricDrawerBody"></div>`; document.body.appendChild(ov);
      ov.addEventListener("click", e => { if (e.target === ov) closeDrawer(); });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && ov.classList.contains("open")) closeDrawer(); }); }
    return ov;
  }
  function closeDrawer() { const ov = document.getElementById("metricDrawer"); if (ov) ov.classList.remove("open"); document.body.style.overflow = ""; }
  function openMetricDrawer(def, SEG, onSaved) {
    const ov = drawerEl(), body = $("#metricDrawerBody");
    const S = def ? JSON.parse(JSON.stringify(def.spec)) : { dataset: "", measure: { type: "rate", numerator: [] }, filters: [], dimension: null, includeAll: true };
    const meta = { label: def ? def.label : "", description: def ? def.description || "" : "", unit: def ? def.unit : "", higher_is_bad: def ? def.higher_is_bad !== false : true, owner: def ? def.owner || "" : "", key: def ? def.key : "" };
    const dsList = Object.values(DS).filter(d => d.segment === SEG && !d.info);
    const cols = () => (DS[S.dataset] && DS[S.dataset].columns) || [];
    const colOpts = (sel, filter) => cols().filter(filter || (() => true)).map(c => `<option value="${esc(c.name)}" ${sel === c.name ? "selected" : ""}>${esc(c.name)}${c.derived ? " · derived" : ""} (${c.type})</option>`).join("");
    const opOpts = sel => Object.entries(OPS).map(([k, l]) => `<option value="${k}" ${sel === k ? "selected" : ""}>${l}</option>`).join("");
    const filterRows = (arr, id) => arr.map((f, i) => `<div class="fgrid" style="grid-template-columns:1.2fr 1fr 1.2fr 34px;gap:6px;margin-bottom:6px" data-frow="${i}" data-fset="${id}">
        <select data-fk="col">${colOpts(f.col)}</select><select data-fk="op">${opOpts(f.op)}</select>
        <input data-fk="value" list="mdvals_${id}_${i}" placeholder="value" value="${esc(f.value ?? "")}" ${f.op === "null" || f.op === "notnull" ? "disabled" : ""}><datalist id="mdvals_${id}_${i}"></datalist>
        <button type="button" class="pill" data-fdel="${i}" style="padding:2px 8px">×</button></div>`).join("") + `<button type="button" class="pill" data-fadd="${id}" style="padding:3px 10px">+ condition</button>`;
    const dsNote = () => { const d = DS[S.dataset]; if (!d) return "Pick a source."; return `<b>${esc(d.label)}</b> · ${esc(d.pool)}.${esc(d.table)} · prod: ${esc(d.prod)}<br>${fresh(d)}`; };
    const render = () => {
      const m = S.measure;
      body.innerHTML = `
      <div class="drawer-hd"><div><div style="font-size:10.5px;letter-spacing:.08em;opacity:.8">${def ? "EDIT CUSTOM METRIC · " + esc(def.status).toUpperCase() + " · v" + def.version : "NEW CUSTOM METRIC · " + (SEG === "fixed" ? "FIXED" : "MOBILE")}</div><div style="font-weight:800;font-size:15px" id="mdTitle">${esc(meta.label || "Untitled metric")}</div></div><span class="x" id="mdX">×</span></div>
      <div class="rd-nav">${[["src", "1 · Source"], ["meas", "2 · Measure"], ["filt", "3 · Filters"], ["dim", "4 · Dimension"], ["prev", "5 · Preview"], ["pub", "6 · Publish"]].map(([k, l], i) => `<button type="button" class="pill${i === 0 ? " active" : ""}" data-mdnav="${k}" style="padding:4px 10px">${l}</button>`).join("")}</div>
      <div class="rd-body">
        <section class="rd-sec" id="md_src"><h4>1 · Source — which registered dataset?</h4>
          <div class="ffull" style="margin-top:0"><label>DATASET</label><select id="md_ds"><option value="">— choose —</option>${dsList.map(d => `<option value="${esc(d.key)}" ${S.dataset === d.key ? "selected" : ""}>${esc(d.label)} · ${esc(d.pool)}.${esc(d.table)}</option>`).join("")}</select></div>
          <div class="rl" id="md_dsnote" style="margin-top:6px">${dsNote()}</div>
          <div class="rl" style="margin-top:6px">Only registered tables, their introspected columns (PII-looking columns excluded) and the declared derived expressions (channel, class, provider, host…) can be used — see the Data sources tab.</div>
        </section>
        <section class="rd-sec" id="md_meas"><h4>2 · Measure — what number?</h4>
          <div class="fgrid"><div><label>MEASURE</label><select id="md_mt">${Object.entries(MEAS).map(([k, [l]]) => `<option value="${k}" ${m.type === k ? "selected" : ""}>${l}</option>`).join("")}</select><div class="rl" id="md_mhelp" style="margin-top:3px">${esc((MEAS[m.type] || [])[1] || "")}</div></div>
            <div id="md_mcol" ${["p50", "p95", "avg", "distinct"].includes(m.type) ? "" : "hidden"}><label>COLUMN</label><select id="md_mc">${colOpts(m.column, c => m.type === "distinct" ? c.type !== "json" : c.type === "number")}</select></div></div>
          <div id="md_num" ${m.type === "rate" ? "" : "hidden"} style="margin-top:8px"><label>NUMERATOR — rows that count as “hit” <span class="lbl-soft">(all conditions must hold)</span></label><div id="md_numrows">${filterRows(m.numerator || [], "num")}</div></div>
        </section>
        <section class="rd-sec" id="md_filt"><h4>3 · Filters — which rows are in scope? <span class="lbl-soft">(the denominator for a rate)</span></h4>
          <div id="md_filtrows">${filterRows(S.filters || [], "flt")}</div>
          <div class="rl" style="margin-top:6px">Values are picked from the last 7 days of data (focus the value box). “in list” takes a, b, c. The time window itself comes from the rule (window_hours) — never put a date here.</div>
        </section>
        <section class="rd-sec" id="md_dim"><h4>4 · Dimension — one row per…</h4>
          <div class="fgrid"><div><label>GROUP BY (optional)</label><select id="md_dim"><option value="">— no dimension (one row) —</option>${colOpts(S.dimension, c => c.type !== "json" && c.type !== "time")}</select></div>
            <div><label>&nbsp;</label><label style="display:flex;gap:8px;align-items:center;font-size:12px;text-transform:none;letter-spacing:0"><input type="checkbox" id="md_all" style="width:auto" ${S.includeAll ? "checked" : ""}> also emit an <b>all</b> row (dim = all)</label></div></div>
          <div class="rl" style="margin-top:6px">With a dimension, every rule on this metric must select its row with a dimension filter, e.g. {"channel":"salamhome"} or {"channel":"all"} — an unfiltered rule on a multi-row metric reads an arbitrary row.</div>
        </section>
        <section class="rd-sec" id="md_prev"><h4>5 · Preview &amp; cost — run it on the real source</h4>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="margin:0">WINDOW (h)</label><input id="md_win" type="number" step="any" min="0.25" value="1" style="width:80px"><button type="button" class="pill" id="md_test" style="border-left-color:#2563eb">▶ Test now</button><button type="button" class="pill" id="md_prevw" style="border-left-color:#7c3aed">📈 7-day preview</button><span class="rl" id="md_cost"></span></div>
          <div id="md_testbox" class="rl" style="margin-top:8px">Test = one evaluation right now (value, sample and query time per dimension). Preview = 28 evaluations across 7 days (6 h apart) to see the normal band before you set a threshold. Both are bounded to 10 s per query.</div>
        </section>
        <section class="rd-sec" id="md_pub"><h4>6 · Publish</h4>
          <div class="fgrid"><div><label>LABEL</label><input id="md_label" value="${esc(meta.label)}" placeholder="e.g. Epurchase feasibility technical rate by provider"></div><div><label>KEY <span class="lbl-soft">— ${SEG === "fixed" ? "fixed_custom_" : "custom_"}… auto from the label${def ? " (fixed)" : ""}</span></label><input id="md_key" class="mono" value="${esc(meta.key)}" ${def ? "disabled" : ""} placeholder="auto"></div>
            <div><label>UNIT</label><select id="md_unit">${["rate", "count", "ms", "ratio"].map(u => `<option value="${u}" ${(meta.unit || (m.type === "rate" ? "rate" : ["p50", "p95", "avg"].includes(m.type) ? "ms" : "count")) === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
            <div><label>DIRECTION</label><select id="md_hib"><option value="1" ${meta.higher_is_bad ? "selected" : ""}>higher is bad (failures, latency)</option><option value="0" ${!meta.higher_is_bad ? "selected" : ""}>lower is bad (successes, volume)</option></select></div>
            <div><label>OWNER</label><input id="md_owner" value="${esc(meta.owner)}" placeholder="team or person"></div></div>
          <div class="ffull"><label>DESCRIPTION <span class="lbl-soft">— what a reader should understand</span></label><textarea id="md_desc" rows="2">${esc(meta.description)}</textarea></div>
          <div class="ffull"><label>CHANGE NOTE <span class="lbl-soft">— why this change (kept in the change log with the field-level diff)</span></label><input id="md_note" placeholder="e.g. TLS excluded after provider confirmed the 5xx are a health check"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" class="pill" id="md_save" style="border-left-color:var(--green)">💾 Save ${def ? "(new version)" : "draft"}</button>${def && def.status !== "draft" ? "" : `<button type="button" class="pill" id="md_shadow" style="border-left-color:#7c3aed">Save &amp; start shadow (24 h)</button>`}${def ? `<button type="button" class="pill" id="md_hist">History / rollback</button>` : ""}<span class="rl" id="md_msg" style="align-self:center"></span></div>
          <div id="md_histbox"></div>
        </section>
      </div>`;
      wire();
    };
    const readFilters = id => Array.from(body.querySelectorAll(`[data-fset="${id}"]`)).map(row => ({ col: $('[data-fk="col"]', row).value, op: $('[data-fk="op"]', row).value, value: $('[data-fk="value"]', row).value }));
    const collect = () => {
      S.dataset = $("#md_ds", body).value; S.measure = { type: $("#md_mt", body).value };
      if (["p50", "p95", "avg", "distinct"].includes(S.measure.type)) S.measure.column = $("#md_mc", body).value;
      if (S.measure.type === "rate") S.measure.numerator = readFilters("num");
      S.filters = readFilters("flt"); S.dimension = $("#md_dim", body).value || null; S.includeAll = $("#md_all", body).checked;
      meta.label = $("#md_label", body).value.trim(); meta.description = $("#md_desc", body).value; meta.unit = $("#md_unit", body).value; meta.higher_is_bad = $("#md_hib", body).value === "1"; meta.owner = $("#md_owner", body).value; if (!def) meta.key = $("#md_key", body).value.trim();
      return S;
    };
    const rerender = () => { collect(); render(); };
    function wire() {
      $("#mdX", body).onclick = closeDrawer;
      body.querySelectorAll("[data-mdnav]").forEach(b => b.onclick = () => { body.querySelectorAll("[data-mdnav]").forEach(x => x.classList.toggle("active", x === b)); const s = $("#md_" + b.dataset.mdnav, body); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); });
      $("#md_ds", body).onchange = () => { collect(); S.filters = []; S.measure.numerator = []; S.dimension = null; render(); };
      $("#md_mt", body).onchange = rerender;
      body.querySelectorAll("[data-fadd]").forEach(b => b.onclick = () => { collect(); const arr = b.dataset.fadd === "num" ? S.measure.numerator : S.filters; arr.push({ col: (cols()[0] || {}).name || "", op: "eq", value: "" }); render(); });
      body.querySelectorAll("[data-fdel]").forEach(b => b.onclick = () => { collect(); const row = b.closest("[data-fset]"); const arr = row.dataset.fset === "num" ? S.measure.numerator : S.filters; arr.splice(Number(row.dataset.frow), 1); render(); });
      body.querySelectorAll('[data-fk="op"]').forEach(sel => sel.onchange = rerender);
      body.querySelectorAll('[data-fk="value"]').forEach(inp => inp.onfocus = async () => {
        const row = inp.closest("[data-fset]"); const col = $('[data-fk="col"]', row).value; const dl = $("datalist", row); if (!S.dataset || !col || dl.dataset.loaded === col) return;
        try { const v = (await api(`/api/datasets/${encodeURIComponent(S.dataset)}/values?column=${encodeURIComponent(col)}`)).values; dl.innerHTML = v.map(x => `<option value="${esc(x.v)}">${x.n != null ? x.n + " rows" : ""}</option>`).join(""); dl.dataset.loaded = col; } catch (_) {}
      });
      $("#md_label", body).oninput = () => { $("#mdTitle", body).textContent = $("#md_label", body).value || "Untitled metric"; };
      $("#md_test", body).onclick = async () => {
        collect(); const box = $("#md_testbox", body); box.innerHTML = "Running…";
        try { const r = await api("/api/metric-defs/test", { method: "POST", body: JSON.stringify({ segment: SEG, spec: S, windowHours: Number($("#md_win", body).value) || 1 }) });
          $("#md_cost", body).textContent = `${r.ms} ms · ${r.rows.length} row${r.rows.length === 1 ? "" : "s"}`;
          box.innerHTML = r.rows.length ? `<table class="alerts" style="font-size:11.5px"><tr><th>DIM</th><th>VALUE</th><th>SAMPLE</th></tr>${r.rows.map(x => `<tr><td class="mono">${esc(Object.entries(x.dim).map(([k, v]) => k + "=" + v).join(", ") || "—")}</td><td><b>${fmtVal($("#md_unit", body).value, x.value)}</b></td><td>${x.sample}</td></tr>`).join("")}</table><details style="margin-top:6px"><summary class="rl">compiled SQL</summary><pre class="mono" style="white-space:pre-wrap;font-size:10.5px">${esc(r.sql)}</pre></details>` : `<span class="rl">No row in the window (${r.ms} ms) — widen the window or loosen the filters.</span>`;
        } catch (e) { box.innerHTML = `<span style="color:#dc2626">${esc(e.message)}</span>`; }
      };
      $("#md_prevw", body).onclick = async () => {
        collect(); const box = $("#md_testbox", body); box.innerHTML = "Replaying 7 days (up to 28 evaluations)…";
        try { const r = await api("/api/metric-defs/preview", { method: "POST", body: JSON.stringify({ segment: SEG, spec: S, windowHours: Number($("#md_win", body).value) || 1 }) });
          const unit = $("#md_unit", body).value; const series = {};
          for (const p of r.points) for (const row of (p.rows || [])) { const k = Object.entries(row.dim).map(([a, b]) => a + "=" + b).join(",") || "—"; (series[k] = series[k] || []).push({ t: p.t, v: row.value }); }
          const keys = Object.keys(series).slice(0, 6);
          $("#md_cost", body).textContent = `${r.ms} ms for ${r.points.length} evaluations`;
          box.innerHTML = keys.length ? keys.map(k => { const pts = series[k]; const vals = pts.map(p => p.v).filter(v => v != null); const mx = Math.max(...vals, 0) || 1; const w = 420, h = 44;
            const path = pts.map((p, i) => `${(i / Math.max(1, pts.length - 1) * w).toFixed(1)},${(h - (p.v == null ? 0 : p.v / mx * (h - 4)) - 2).toFixed(1)}`).join(" ");
            const sorted = vals.slice().sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)];
            return `<div style="display:flex;gap:10px;align-items:center;margin:4px 0"><span class="mono" style="width:150px;font-size:11px">${esc(k)}</span><svg width="${w}" height="${h}" style="max-width:100%"><polyline fill="none" stroke="#0e9f5a" stroke-width="1.6" points="${path}"/></svg><span class="rl" style="font-size:11px">median ${fmtVal(unit, med)} · max ${fmtVal(unit, Math.max(...vals))}</span></div>`; }).join("") + `<div class="rl" style="margin-top:4px">Set the P2 threshold above the normal band and the P1 twin at ~2×.</div>` : `<span class="rl">No data in the last 7 days.</span>`;
          if (r.points.some(p => p.error)) box.insertAdjacentHTML("beforeend", `<div style="color:#dc2626">${esc(r.points.find(p => p.error).error)}</div>`);
        } catch (e) { box.innerHTML = `<span style="color:#dc2626">${esc(e.message)}</span>`; }
      };
      const save = async (thenShadow) => {
        collect(); const msg = $("#md_msg", body); msg.textContent = "Saving…";
        try {
          const payload = { segment: SEG, label: meta.label, key: meta.key || undefined, description: meta.description, unit: meta.unit, higher_is_bad: meta.higher_is_bad, owner: meta.owner, spec: S, note: ($("#md_note", body) || {}).value || undefined };
          const r = def ? await api("/api/metric-defs/" + encodeURIComponent(def.key), { method: "PUT", body: JSON.stringify(payload) }) : await api("/api/metric-defs", { method: "POST", body: JSON.stringify(payload) });
          if (thenShadow) await api("/api/metric-defs/" + encodeURIComponent(r.def.key) + "/status", { method: "POST", body: JSON.stringify({ status: "shadow", shadowHours: 24 }) });
          msg.textContent = "Saved ✓"; closeDrawer(); onSaved && onSaved();
        } catch (e) { msg.innerHTML = `<span style="color:#dc2626">${esc(e.message)}</span>`; }
      };
      $("#md_save", body).onclick = () => save(false);
      const sh = $("#md_shadow", body); if (sh) sh.onclick = () => save(true);
      const hb = $("#md_hist", body); if (hb) hb.onclick = async () => {
        const box = $("#md_histbox", body); box.innerHTML = "Loading…";
        try { const [r, cl] = await Promise.all([api("/api/metric-defs/" + encodeURIComponent(def.key)), api("/api/metric-defs/" + encodeURIComponent(def.key) + "/changes").then(x => x.changes).catch(() => [])]);
          box.innerHTML = `<p style="font-weight:800;font-size:11px;letter-spacing:.05em;color:var(--muted);margin:10px 0 4px">VERSIONS</p><table class="alerts" style="font-size:11.5px"><tr><th>VER</th><th>WHEN</th><th>WHO</th><th>NOTE</th><th>STATUS</th><th></th></tr>${r.versions.map(v => `<tr><td>v${v.version}</td><td class="rl">${esc(when(v.at))}</td><td class="rl">${esc(v.actor || "")}</td><td class="rl">${esc(v.note || "")}</td><td>${stPill(v.status)}</td><td>${v.version !== def.version ? `<button type="button" class="pill" data-rb="${v.version}" style="padding:2px 8px">↩ Roll back</button>` : ""}</td></tr>`).join("")}</table>
            <p style="font-weight:800;font-size:11px;letter-spacing:.05em;color:var(--muted);margin:12px 0 4px">CHANGE LOG · field level</p>${cl.length ? `<table class="alerts" style="font-size:11.5px"><tr><th>WHEN</th><th>WHO</th><th>ACTION</th><th>CHANGES</th><th>NOTE</th></tr>${cl.map(c => `<tr><td class="rl" style="white-space:nowrap">${esc(when(c.at))}</td><td class="rl">${esc(c.actor || "")}</td><td>${actPill(c.action)} <span class="rl" style="font-size:10px">v${c.version}</span></td><td>${diffHtml(c.changes)}</td><td class="rl">${esc(c.note || "")}</td></tr>`).join("")}</table>` : "<span class='rl'>no change recorded</span>"}`;
          box.querySelectorAll("[data-rb]").forEach(b => b.onclick = async () => { if (!confirm("Restore v" + b.dataset.rb + " as a new version?")) return; try { await api("/api/metric-defs/" + encodeURIComponent(def.key) + "/rollback", { method: "POST", body: JSON.stringify({ version: Number(b.dataset.rb) }) }); closeDrawer(); onSaved && onSaved(); } catch (e) { alert(e.message); } });
        } catch (e) { box.innerHTML = `<span style="color:#dc2626">${esc(e.message)}</span>`; }
      };
    }
    render(); ov.classList.add("open"); document.body.style.overflow = "hidden";
  }

  window.renderMetricDefsInto = renderMetricDefsInto;
  window.renderSourcesInto = renderSourcesInto;
  window.openMetricDrawer = openMetricDrawer;
})();
