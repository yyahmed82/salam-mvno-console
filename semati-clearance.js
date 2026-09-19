/* Governance › Semati Clearance — release MSISDN + ID pairs on Semati (TCC) so the number can be sold again.
 * Paste or load a list → review what will be sent → confirm → watch each row come back as
 * Cleared / Not cleared / Error → download the result file. Identifiers are masked on screen;
 * the full values come only from the server, only for the right caller, and every reveal,
 * run, cancel and export is written to the audit log. See server/src/semati.js for the rules. */
(function(){
  "use strict";
  const $ = s => document.querySelector(s);
  const API = window.API_BASE || "";
  const esc = s => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const num = v => (v == null || v === "") ? "—" : Number(v).toLocaleString("en-US");
  const api = (p, opts) => window.fetch(API + p, Object.assign({ headers: { "Content-Type": "application/json" } }, opts))
    .then(r => { if(!r.ok) return r.json().catch(()=>({})).then(e => { throw new Error(e.error || ("HTTP " + r.status)); }); return r.json(); });
  const me = () => ((window.opsSession && window.opsSession()) || {}).me || {};
  const caps = () => me().caps || {};
  const ksa = v => v ? (window.ksaDTS ? window.ksaDTS(v) : new Date(v).toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })) : "—";

  const S = { health: null, business: null, parsed: null, file: null, job: null, filter: "all", full: false, poll: null, jobs: [], view: "run" };
  const LABEL = { cleared: "Cleared", not_cleared: "Not cleared", error: "Error · retry", cancelled: "Cancelled", pending: "Pending" };
  const TONE = { cleared: "ok", not_cleared: "warn", error: "bad", cancelled: "muted", pending: "muted" };

  /* ---------- styles: the console's tokens, both themes, phone first ---------- */
  function installCss(){
    if($("#semCss")) return;
    const st = document.createElement("style"); st.id = "semCss";
    st.textContent = `
      #view-semati-clearance .sm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:12px}
      #view-semati-clearance .sm-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:900}
      #view-semati-clearance h2{margin:2px 0 4px}
      #view-semati-clearance .sm-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      #view-semati-clearance .sm-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;padding:6px 11px;font-size:11.5px;font-weight:800;background:var(--card2);color:var(--ink-soft)}
      #view-semati-clearance .sm-chip i{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:none}
      #view-semati-clearance .sm-chip.ok{color:var(--green-dark);background:var(--green-bg);border-color:var(--green-line,var(--green))} #view-semati-clearance .sm-chip.ok i{background:var(--green)}
      #view-semati-clearance .sm-chip.bad{color:var(--tint-red-fg);background:var(--tint-red);border-color:var(--red-line,var(--red))} #view-semati-clearance .sm-chip.bad i{background:var(--red)}
      #view-semati-clearance .sm-chip.warn{color:var(--tint-warn-fg);background:var(--tint-warn-bg);border-color:var(--tint-warn-line)} #view-semati-clearance .sm-chip.warn i{background:var(--amber)}
      #view-semati-clearance .sm-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--card)}
      #view-semati-clearance .sm-seg button{border:0;background:transparent;color:var(--ink-soft);font-weight:800;font-size:12px;padding:7px 13px;cursor:pointer;font-family:inherit}
      #view-semati-clearance .sm-seg button.on{background:var(--green);color:#fff}
      #view-semati-clearance .sm-steps{display:grid;grid-template-columns:1.1fr .9fr;gap:14px;align-items:start}
      #view-semati-clearance .sm-step{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:16px 18px;min-width:0}
      #view-semati-clearance .sm-step h3{margin:0 0 4px;font-size:15px;display:flex;align-items:center;gap:10px}
      #view-semati-clearance .sm-n{width:24px;height:24px;border-radius:50%;background:var(--green);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;flex:none}
      #view-semati-clearance textarea{width:100%;min-height:150px;resize:vertical;border:1px solid var(--line);border-radius:10px;background:var(--card2);color:var(--ink);padding:10px 12px;font:12.5px/1.5 var(--mono,ui-monospace,Menlo,monospace);box-sizing:border-box}
      #view-semati-clearance textarea:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px var(--green-bg)}
      #view-semati-clearance .sm-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
      #view-semati-clearance .sm-file{position:relative;overflow:hidden}
      #view-semati-clearance .sm-file input{position:absolute;inset:0;opacity:0;cursor:pointer}
      #view-semati-clearance .sm-primary{border:1px solid var(--green);background:var(--green);color:#fff;border-radius:10px;padding:9px 16px;font-weight:900;font-size:12.5px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:8px;transition:background .15s,transform .15s}
      #view-semati-clearance .sm-primary:hover{background:var(--green-dark);transform:translateY(-1px)}
      #view-semati-clearance .sm-primary[disabled]{opacity:.45;cursor:not-allowed;transform:none}
      #view-semati-clearance .sm-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}
      #view-semati-clearance .sm-kpi{border:1px solid var(--line);border-radius:12px;padding:11px 13px;background:var(--card2)}
      #view-semati-clearance .sm-kpi b{display:block;font-size:22px;color:var(--ink);font-variant-numeric:tabular-nums;line-height:1.1}
      #view-semati-clearance .sm-kpi span{display:block;font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-top:3px}
      #view-semati-clearance .sm-kpi.ok b{color:var(--green-dark)} #view-semati-clearance .sm-kpi.warn b{color:var(--tint-warn-fg)} #view-semati-clearance .sm-kpi.bad b{color:var(--red)}
      #view-semati-clearance .sm-bar{height:8px;border-radius:99px;background:var(--line-soft,var(--line));overflow:hidden;margin:10px 0 6px}
      #view-semati-clearance .sm-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--green),var(--green-dark));width:0;transition:width .4s ease}
      #view-semati-clearance .sm-filters{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
      #view-semati-clearance .sm-filters button{border:1px solid var(--line);border-radius:999px;background:var(--card);padding:6px 11px;font-weight:800;font-size:11.5px;color:var(--ink-soft);cursor:pointer;font-family:inherit}
      #view-semati-clearance .sm-filters button.on{border-color:var(--green);background:var(--green-bg);color:var(--green-dark)}
      #view-semati-clearance .sm-tablewrap{overflow:auto;border:1px solid var(--line);border-radius:12px;max-height:520px}
      #view-semati-clearance table{width:100%;border-collapse:collapse;font-size:12.5px}
      #view-semati-clearance th{position:sticky;top:0;background:var(--card2);text-align:left;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
      #view-semati-clearance td{padding:8px 10px;border-bottom:1px solid var(--line-soft,var(--line));vertical-align:top;color:var(--ink)}
      #view-semati-clearance td.mono{font-family:var(--mono,ui-monospace,Menlo,monospace);font-variant-numeric:tabular-nums;white-space:nowrap}
      #view-semati-clearance td.why{color:var(--ink-soft);max-width:520px}
      #view-semati-clearance .sm-st{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:900;white-space:nowrap;border:1px solid var(--line);background:var(--card2);color:var(--ink-soft)}
      #view-semati-clearance .sm-st i{width:7px;height:7px;border-radius:50%;background:var(--muted)}
      #view-semati-clearance .sm-st.ok{color:var(--green-dark);background:var(--green-bg);border-color:var(--green-line,var(--green))} #view-semati-clearance .sm-st.ok i{background:var(--green)}
      #view-semati-clearance .sm-st.warn{color:var(--tint-warn-fg);background:var(--tint-warn-bg);border-color:var(--tint-warn-line)} #view-semati-clearance .sm-st.warn i{background:var(--amber)}
      #view-semati-clearance .sm-st.bad{color:var(--tint-red-fg);background:var(--tint-red);border-color:var(--red-line,var(--red))} #view-semati-clearance .sm-st.bad i{background:var(--red)}
      #view-semati-clearance tr.bad td{background:var(--tint-red)}
      #view-semati-clearance .sm-note{font-size:12px;color:var(--muted);line-height:1.5;margin-top:8px}
      #view-semati-clearance .sm-note b{color:var(--ink)}
      #view-semati-clearance .sm-hist{display:grid;gap:8px}
      #view-semati-clearance .sm-job{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--card);cursor:pointer;text-align:left;color:var(--ink);font-family:inherit}
      #view-semati-clearance .sm-job:hover{border-color:var(--green)}
      #view-semati-clearance .sm-job .id{font-weight:900;font-variant-numeric:tabular-nums}
      #view-semati-clearance .sm-job small{display:block;color:var(--muted);font-size:11px}
      #view-semati-clearance .sm-job .cts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      #view-semati-clearance .sm-modal{position:fixed;inset:0;background:var(--scrim,rgba(15,23,42,.55));z-index:200;display:flex;align-items:center;justify-content:center;padding:16px}
      #view-semati-clearance .sm-modal .box{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 22px;max-width:520px;width:100%;box-shadow:var(--shadow-lg,0 20px 50px rgba(0,0,0,.35))}
      #view-semati-clearance .sm-modal h3{margin:0 0 8px}
      #view-semati-clearance .sm-modal .big{font-size:34px;font-weight:900;color:var(--ink);margin:6px 0 2px;font-variant-numeric:tabular-nums}
      #view-semati-clearance .sm-modal .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
      #view-semati-clearance .sm-lock{text-align:center;padding:34px 20px}
      #view-semati-clearance .sm-lock code{display:inline-block;margin:3px;padding:3px 8px;border-radius:6px;background:var(--code-bg,var(--card2));color:var(--code-fg,var(--ink));font-size:12px}
      @media (max-width:900px){ #view-semati-clearance .sm-steps{grid-template-columns:1fr} #view-semati-clearance .sm-kpis{grid-template-columns:repeat(2,minmax(0,1fr))} #view-semati-clearance .sm-job{grid-template-columns:1fr} #view-semati-clearance .sm-job .cts{justify-content:flex-start} #view-semati-clearance td.why{max-width:none} }
    `;
    document.head.appendChild(st);
  }

  function activateView(){
    document.querySelectorAll(".navtab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x => x.classList.toggle("active", x.id === "view-semati-clearance"));
    const gear = document.getElementById("settingsBtn"); if(gear) gear.classList.add("on");
    const ob = document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
  }
  const stopPoll = () => { if(S.poll){ clearInterval(S.poll); S.poll = null; } };

  /* ---------- shell ---------- */
  function shell(){
    const host = $("#view-semati-clearance"); if(!host) return;
    installCss();
    const h = S.health || {};
    const biz = (h.businesses || []);
    if(!S.business && biz.length) S.business = (window.BUSINESS === "fixed" ? "fixed" : biz[0].key);
    const p = h.probe || {};
    const chip = !h.configured ? `<span class="sm-chip bad"><i></i>Not configured</span>`
      : p.reachable === true ? `<span class="sm-chip ok" title="${esc((h.transport === 'ssh' ? 'curl on ' + h.host : 'direct') + ' → ' + h.url)}"><i></i>Semati reachable · HTTP ${esc(p.http)} · ${esc(p.ms)} ms · ${h.transport === "ssh" ? "via " + esc(h.host) : "direct"}</span>`
      : p.reachable === false ? `<span class="sm-chip bad" title="${esc(p.error || '')}"><i></i>Semati unreachable from ${esc(h.transport === "ssh" ? h.host : "152")} — ${esc((p.error || "").slice(0, 60))}</span>`
      : `<span class="sm-chip warn"><i></i>Checking…</span>`;
    host.innerHTML = `<div class="panel">
      <div class="sm-head">
        <div>
          <div class="sm-kicker">IT GOVERNANCE · NATIONAL NUMBER REGISTRY</div>
          <h2>Semati Clearance</h2>
          <div class="sub">Release an MSISDN from the customer ID it is registered under on Semati (TCC), so the number is available for sale again. Mobile and Fixed (5G home). Every row is sent one at a time, exactly as the operations script did — with the outcome, the operator and the time on the record.</div>
        </div>
        <div class="sm-actions">
          ${chip}
          ${h.configured && h.tlsInsecure ? `<span class="sm-chip warn" title="SEMATI_CLEAR_TLS_INSECURE=1 — the certificate on this hop is not verified. Put it back to 0 once the intercepting CA is installed on the curl host."><i></i>TLS not verified</span>` : ""}
          ${biz.length > 1 ? `<span class="sm-seg" id="smBiz">${biz.map(b => `<button type="button" data-b="${esc(b.key)}" class="${S.business === b.key ? "on" : ""}">${esc(b.label)}</button>`).join("")}</span>` : biz.length === 1 ? `<span class="sm-chip">${esc(biz[0].label)}</span>` : ""}
          <button class="pill" id="smTabRun" style="border-left-color:var(--green)">Run a list</button>
          <button class="pill" id="smTabHist" style="border-left-color:var(--blue)">History</button>
          <button class="pill" id="smTabLookup" style="border-left-color:var(--indigo,var(--blue))">Check a number</button>
        </div>
      </div>
      ${p.hint ? `<div class="albanner" style="margin:0 0 12px">${esc(p.hint)}</div>` : ""}
      <div id="smBody"></div>
      <div id="smStatus" class="rl" style="margin-top:10px"></div>
    </div>`;
    host.querySelectorAll("#smBiz button").forEach(b => b.onclick = () => { S.business = b.dataset.b; shell(); paint(); });
    $("#smTabRun").onclick = () => { S.view = "run"; setStatus(""); paint(); };
    $("#smTabHist").onclick = () => { S.view = "hist"; setStatus(""); paint(); };
    $("#smTabLookup").onclick = () => { S.view = "lookup"; setStatus(""); paint(); };
  }
  const setStatus = (t, tone) => { const el = $("#smStatus"); if(el){ el.textContent = t || ""; el.style.color = tone === "bad" ? "var(--red)" : tone === "ok" ? "var(--green-dark)" : ""; } };

  /* ---------- the run view: load → review → confirm → progress → results ---------- */
  function paint(){
    const body = $("#smBody"); if(!body) return;
    const h = S.health || {};
    if(!h.configured){
      body.innerHTML = `<div class="sm-lock"><div style="font-size:26px">Locked</div><h2 style="margin:8px 0 4px">Not configured on this server</h2>
        <div class="sub">The page stays locked until these keys are set in <code>/apps/unified/.env</code> and the app is restarted:</div>
        <div style="margin-top:10px">${(h.missing || []).map(m => `<code>${esc(m)}</code>`).join("")}</div>
        <div class="sm-note" style="max-width:640px;margin:14px auto 0">The API key and the operator block go only in <b>.env</b> — never in the console settings, never in git. The request is issued from an API host over the collector SSH channel (152 has no internet); <code>SEMATI_CLEAR_HOST</code> picks which one.</div></div>`;
      return;
    }
    if(S.view === "hist") return paintHistory();
    if(S.view === "lookup") return paintLookup();
    if(S.job) return paintJob();
    const pr = S.parsed;
    body.innerHTML = `<div class="sm-steps">
      <div class="sm-step">
        <h3><span class="sm-n">1</span>Load the list</h3>
        <div class="sub">One pair per line: <b>MSISDN, customer ID</b> — with an optional third column for the ID type. The type is inferred from the ID when missing (1… = national ID, 2… = iqama). Separators: comma, semicolon, tab or space. A header line is skipped.</div>
        <textarea id="smText" placeholder="966181800001, 1109544633&#10;966181800016, 2053922759, 2&#10;0561234567; 1023456789" spellcheck="false">${esc(S.text || "")}</textarea>
        <div class="sm-row">
          <label class="pill sm-file" style="border-left-color:var(--blue)">${S.file ? "File: " + esc(S.file.name) : "Load .xlsx / .csv / .txt"}<input type="file" id="smFile" accept=".xlsx,.csv,.txt,.tsv"></label>
          ${S.file ? `<button class="pill" id="smFileClear" style="border-left-color:var(--muted)">Remove file</button>` : ""}
          <button class="sm-primary" id="smParse">Review the list →</button>
        </div>
        <div class="sm-note">Nothing is sent to Semati at this step. Rows are validated and de-duplicated; you confirm before anything is released.</div>
      </div>
      <div class="sm-step">
        <h3><span class="sm-n">2</span>Review and confirm</h3>
        ${pr ? reviewHtml(pr) : `<div class="sub">Load a list to see what would be sent.</div>
          <div class="sm-note"><b>What the answers mean.</b> <b>Cleared</b> — Semati code 600, the number is free to sell again. <b>Not cleared</b> — code 727 <i>MOBILE_DOESNT_EXIST</i>: the MSISDN is not registered under this ID, so it was already released or the ID does not match; Semati does not say which. <b>Error</b> — no verdict (TCC down, timeout): retry those rows later.</div>`}
      </div>
    </div>`;
    const fi = $("#smFile"); if(fi) fi.onchange = () => { const f = fi.files && fi.files[0]; if(!f) return;
      const rd = new FileReader(); rd.onload = () => { S.file = { name: f.name, b64: String(rd.result).split(",")[1] || "" }; S.parsed = null; paint(); }; rd.readAsDataURL(f); };
    const fc = $("#smFileClear"); if(fc) fc.onclick = () => { S.file = null; S.parsed = null; paint(); };
    $("#smParse").onclick = parseList;
    const go = $("#smGo"); if(go) go.onclick = confirmRun;
    const t = $("#smText"); if(t) t.oninput = () => { S.text = t.value; };
  }
  function reviewHtml(pr){
    const s = pr.summary || {}; const rows = pr.rows || [];
    const sendable = Math.min(s.valid || 0, s.maxRows || s.valid || 0);
    const bad = rows.filter(r => !r.ok);
    return `<div class="sm-kpis">
        <div class="sm-kpi"><b>${num(s.total)}</b><span>rows read</span></div>
        <div class="sm-kpi ok"><b>${num(s.valid)}</b><span>will be sent</span></div>
        <div class="sm-kpi ${s.invalid ? "bad" : ""}"><b>${num(s.invalid)}</b><span>invalid · skipped</span></div>
        <div class="sm-kpi ${s.duplicates ? "warn" : ""}"><b>${num(s.duplicates)}</b><span>duplicates · skipped</span></div>
      </div>
      ${s.capped ? `<div class="albanner">The list has ${num(s.valid)} valid rows; this server sends at most ${num(s.maxRows)} per run. The first ${num(s.maxRows)} go now — run the rest as a second list.</div>` : ""}
      ${bad.length ? `<div class="sm-tablewrap" style="max-height:220px;margin-top:10px"><table><thead><tr><th>Line</th><th>MSISDN</th><th>Customer ID</th><th>Why it is skipped</th></tr></thead><tbody>
        ${bad.slice(0, 200).map(r => `<tr class="bad"><td class="mono">${esc(r.line)}</td><td class="mono">${esc(maskLocal(r.msisdn))}</td><td class="mono">${esc(maskLocal(r.personId))}</td><td class="why">${esc(r.issue)}</td></tr>`).join("")}
        ${bad.length > 200 ? `<tr><td colspan="4" class="why">… and ${num(bad.length - 200)} more</td></tr>` : ""}</tbody></table></div>` : ""}
      <div class="sm-row" style="margin-top:14px">
        <button class="sm-primary" id="smGo" ${sendable ? "" : "disabled"}>Release ${num(sendable)} number${sendable === 1 ? "" : "s"} on Semati →</button>
        <span class="sm-note" style="margin:0">for <b>${esc(bizLabel())}</b>${pr.filename ? " · from " + esc(pr.filename) : ""}</span>
      </div>
      <div class="sm-note">Identifiers are shown masked. The full values stay in your list and in the result file you download when the run ends.</div>`;
  }
  const maskLocal = v => { const s = String(v || ""); return s.length <= 3 ? (s ? "***" : "") : "*".repeat(s.length - 3) + s.slice(-3); };
  const bizLabel = () => { const b = ((S.health || {}).businesses || []).find(x => x.key === S.business); return b ? b.label : S.business || ""; };

  async function parseList(){
    const t = $("#smText"); const text = t ? t.value : (S.text || "");
    if(!S.file && !text.trim()){ setStatus("Paste some rows or load a file first.", "bad"); return; }
    setStatus("Reading the list…");
    try {
      const body = S.file ? { file: S.file } : { text };
      S.parsed = await api("/api/semati/parse", { method: "POST", body: JSON.stringify(body) });
      S.parsed.textRows = S.parsed.rows;   // full values, kept only in this page until the run is created
      setStatus(`${num(S.parsed.summary.valid)} of ${num(S.parsed.summary.total)} rows can be sent.`, "ok");
    } catch(e){ S.parsed = null; setStatus(e.message, "bad"); }
    paint();
  }

  function confirmRun(){
    const pr = S.parsed; if(!pr) return;
    const s = pr.summary; const sendable = Math.min(s.valid, s.maxRows || s.valid);
    const h = S.health || {};
    const host = $("#view-semati-clearance");
    const m = document.createElement("div"); m.className = "sm-modal";
    m.innerHTML = `<div class="box">
      <div class="sm-kicker">Confirm — this writes to the national registry</div>
      <h3>Release these numbers on Semati?</h3>
      <div class="big">${num(sendable)}</div>
      <div class="sub">MSISDN + ID pairs for <b>${esc(bizLabel())}</b>, sent one at a time${h.transport === "ssh" ? ` from <b>${esc(h.host)}</b>` : ""} as <b>${esc(h.operator && h.operator.username || "the configured operator")}</b>. A released number can be sold again immediately; the console cannot undo it.</div>
      <div class="sm-note">You can cancel while it runs — rows not yet sent stay untouched. Each answer is written to the audit log with your name.</div>
      <div class="acts"><button class="pill" id="smNo" style="border-left-color:var(--muted)">Back</button><button class="sm-primary" id="smYes">Yes, release ${num(sendable)}</button></div>
    </div>`;
    host.appendChild(m);
    const close = () => m.remove();
    $("#smNo").onclick = close; m.addEventListener("click", e => { if(e.target === m) close(); });
    $("#smYes").onclick = async () => {
      $("#smYes").disabled = true; $("#smYes").textContent = "Starting…";
      try {
        const rows = (pr.textRows || pr.rows).filter(r => r.ok).map(r => ({ msisdn: r.msisdn, personId: r.personId, idType: r.idType }));
        const r = await api("/api/semati/jobs", { method: "POST", body: JSON.stringify({ business: S.business, rows, source: pr.source, filename: pr.filename }) });
        close(); S.parsed = null; S.file = null; S.text = ""; S.filter = "all"; S.full = false;
        setStatus("");
        await loadJob(r.id); startPoll();
      } catch(e){ close(); setStatus(e.message, "bad"); }
    };
  }

  async function loadJob(id, full){
    try { S.job = await api(`/api/semati/jobs/${id}${full ? "?full=1" : ""}`); S.full = !!S.job.full; }
    catch(e){ setStatus(e.message, "bad"); if(full){ S.full = false; return; } S.job = null; }
    paint();
  }
  function startPoll(){ stopPoll(); S.poll = setInterval(async () => { if(!S.job) return stopPoll();
    try { const j = await api(`/api/semati/jobs/${S.job.id}${S.full ? "?full=1" : ""}`); S.job = j; paintJob(); if(j.status !== "running" && j.status !== "queued") stopPoll(); } catch(_){} }, 1500); }

  function paintJob(){
    const body = $("#smBody"); const j = S.job; if(!body || !j) return;
    const c = j.counts || {}; const done = (c.cleared || 0) + (c.not_cleared || 0) + (c.errors || 0) + (c.cancelled || 0);
    const live = j.status === "running" || j.status === "queued";
    const pct = j.total ? Math.round(done / j.total * 100) : 0;
    const rows = (j.rows || []).filter(r => S.filter === "all" ? true : S.filter === "error" ? r.status === "error" : r.status === S.filter);
    const canFull = !!(caps().unmaskPII) || (j.createdBy && j.createdBy === String(me().email || "").toLowerCase());
    body.innerHTML = `
      <div class="sm-row" style="margin:0 0 6px;justify-content:space-between">
        <div><span class="sm-kicker">Run #${esc(j.id)} · ${esc(j.businessLabel)} · by ${esc(j.createdBy)} · ${esc(ksa(j.createdAt))}</span>
          <div style="font-weight:900;font-size:15px;margin-top:2px">${live ? `Releasing ${num(j.total)} numbers — ${num(done)} answered` : `${esc(j.status === "done" ? "Finished" : j.status === "cancelled" ? "Cancelled" : j.status === "failed" ? "Failed" : j.status)} · ${num(j.total)} rows${j.finishedAt ? " · " + esc(ksa(j.finishedAt)) : ""}`}</div></div>
        <div class="sm-actions">
          ${live ? `<button class="pill" id="smCancel" style="border-left-color:var(--red)">Cancel the rest</button>` : ""}
          ${!live && j.inMemory && canFull && !S.full ? `<button class="pill" id="smFull" style="border-left-color:var(--amber)">Show full numbers</button>` : ""}
          ${!live ? `<button class="pill" id="smXlsx" style="border-left-color:var(--green)">Download results (XLSX)</button>` : ""}
          ${!live ? `<button class="pill" id="smNew" style="border-left-color:var(--blue)">New list</button>` : ""}
        </div>
      </div>
      <div class="sm-bar"><i style="width:${pct}%"></i></div>
      <div class="sm-kpis">
        <div class="sm-kpi ok"><b>${num(c.cleared || 0)}</b><span>cleared</span></div>
        <div class="sm-kpi warn"><b>${num(c.not_cleared || 0)}</b><span>not cleared</span></div>
        <div class="sm-kpi ${c.errors ? "bad" : ""}"><b>${num(c.errors || 0)}</b><span>error · retry</span></div>
        <div class="sm-kpi"><b>${num(live ? j.total - done : (c.cancelled || 0))}</b><span>${live ? "waiting" : "cancelled"}</span></div>
      </div>
      ${!live && j.inMemory ? `<div class="sm-note">${S.full ? "<b>Full identifiers shown</b> — this reveal is on the audit log." : "Identifiers are masked on screen."} The full values are kept for <b>${esc((S.health || {}).resultTtlMin || 120)} minutes</b> after the run, then only the masked outcome remains — <b>download the result file now</b>.</div>` : ""}
      ${!live && !j.inMemory ? `<div class="sm-note">This run is older than the download window: the outcome is kept, the full identifiers are not. Use <b>Check a number</b> to confirm a specific pair.</div>` : ""}
      <div class="sm-filters">${[["all", "All " + num(j.total)], ["cleared", "Cleared " + num(c.cleared || 0)], ["not_cleared", "Not cleared " + num(c.not_cleared || 0)], ["error", "Error " + num(c.errors || 0)]].map(([k, l]) => `<button type="button" data-f="${k}" class="${S.filter === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
      <div class="sm-tablewrap"><table><thead><tr><th>#</th><th>MSISDN</th><th>Customer ID</th><th>Type</th><th>Status</th><th>Semati</th><th>Why</th><th>When (KSA)</th></tr></thead><tbody>
        ${rows.slice(0, 2000).map(r => `<tr><td class="mono">${esc(r.seq)}</td><td class="mono">${esc(r.msisdn)}</td><td class="mono">${esc(r.personId)}</td><td class="mono">${esc(r.idType == null ? "" : r.idType)}</td>
          <td><span class="sm-st ${TONE[r.status] || ""}"><i></i>${esc(LABEL[r.status] || r.status)}</span></td>
          <td class="mono">${r.code != null ? esc(r.code) + (r.message ? " · " + esc(r.message) : "") : "—"}</td>
          <td class="why">${esc(r.reason || "")}</td><td class="mono">${esc(r.processedAt ? ksa(r.processedAt) : "")}</td></tr>`).join("")}
        ${rows.length > 2000 ? `<tr><td colspan="8" class="why">… ${num(rows.length - 2000)} more rows — they are all in the XLSX.</td></tr>` : ""}
        ${!rows.length ? `<tr><td colspan="8" class="why">Nothing in this filter.</td></tr>` : ""}</tbody></table></div>`;
    body.querySelectorAll(".sm-filters button").forEach(b => b.onclick = () => { S.filter = b.dataset.f; paintJob(); });
    const cb = $("#smCancel"); if(cb) cb.onclick = async () => { cb.disabled = true; try { await api(`/api/semati/jobs/${j.id}/cancel`, { method: "POST", body: "{}" }); setStatus("Cancelling — rows already sent keep their answer.", "ok"); } catch(e){ setStatus(e.message, "bad"); } };
    const fb = $("#smFull"); if(fb) fb.onclick = () => loadJob(j.id, true);
    const xb = $("#smXlsx"); if(xb) xb.onclick = () => { window.open(API + `/api/semati/jobs/${j.id}/export`, "_blank"); };
    const nb = $("#smNew"); if(nb) nb.onclick = () => { stopPoll(); S.job = null; S.full = false; paint(); };
  }

  /* ---------- history + lookup ---------- */
  async function paintHistory(){
    const body = $("#smBody"); if(!body) return;
    body.innerHTML = `<div class="sub">Loading runs…</div>`;
    try { S.jobs = (await api("/api/semati/jobs?limit=60")).jobs || []; } catch(e){ body.innerHTML = `<div class="albanner">${esc(e.message)}</div>`; return; }
    if(!S.jobs.length){ body.innerHTML = `<div class="sub">No clearance run yet.</div>`; return; }
    body.innerHTML = `<div class="sm-hist">${S.jobs.map(j => `<button type="button" class="sm-job" data-id="${j.id}">
        <div><div class="id">#${esc(j.id)}</div><small>${esc(j.businessLabel)}</small></div>
        <div><div style="font-weight:800">${esc(j.status === "done" ? "Finished" : j.status)} · ${num(j.total)} rows${j.filename ? " · " + esc(j.filename) : ""}</div><small>${esc(j.createdBy)} · ${esc(ksa(j.createdAt))}${j.host ? " · via " + esc(j.host) : ""}${j.inMemory ? " · full file still available" : ""}</small></div>
        <div class="cts"><span class="sm-st ok"><i></i>${num(j.cleared)} cleared</span><span class="sm-st warn"><i></i>${num(j.notCleared)} not</span>${j.errors ? `<span class="sm-st bad"><i></i>${num(j.errors)} error</span>` : ""}${j.cancelled ? `<span class="sm-st"><i></i>${num(j.cancelled)} cancelled</span>` : ""}</div>
      </button>`).join("")}</div>`;
    body.querySelectorAll(".sm-job").forEach(b => b.onclick = async () => { S.view = "run"; S.filter = "all"; S.full = false; await loadJob(Number(b.dataset.id)); if(S.job && (S.job.status === "running" || S.job.status === "queued")) startPoll(); });
  }
  function paintLookup(){
    const body = $("#smBody"); if(!body) return;
    body.innerHTML = `<div class="sm-step" style="max-width:720px">
      <h3><span class="sm-n">?</span>Was this pair cleared?</h3>
      <div class="sub">The console keeps the outcome of every run against a keyed hash of the pair — so this answers without a national ID ever being stored.</div>
      <div class="sm-row"><input class="jsearch" id="smLkM" placeholder="MSISDN (966…)" style="padding-left:12px;background-image:none"><input class="jsearch" id="smLkP" placeholder="Customer ID (10 digits)" style="padding-left:12px;background-image:none"><button class="sm-primary" id="smLkGo">Check</button></div>
      <div id="smLkOut" style="margin-top:12px"></div></div>`;
    $("#smLkGo").onclick = async () => {
      const out = $("#smLkOut"); out.innerHTML = `<div class="sub">Looking…</div>`;
      try {
        const r = await api(`/api/semati/lookup?msisdn=${encodeURIComponent($("#smLkM").value)}&personId=${encodeURIComponent($("#smLkP").value)}`);
        if(!r.hits.length){ out.innerHTML = `<div class="albanner">This pair has never been sent from the console.</div>`; return; }
        out.innerHTML = `<div class="sm-tablewrap"><table><thead><tr><th>Run</th><th>MSISDN</th><th>Customer ID</th><th>Status</th><th>Semati</th><th>Why</th><th>When (KSA)</th><th>By</th></tr></thead><tbody>
          ${r.hits.map(x => `<tr><td class="mono">#${esc(x.job)} · ${esc(x.businessLabel)}</td><td class="mono">${esc(x.msisdn)}</td><td class="mono">${esc(x.personId)}</td><td><span class="sm-st ${TONE[x.status] || ""}"><i></i>${esc(LABEL[x.status] || x.status)}</span></td><td class="mono">${x.code != null ? esc(x.code) + " · " + esc(x.message || "") : "—"}</td><td class="why">${esc(x.reason || "")}</td><td class="mono">${esc(ksa(x.processedAt))}</td><td>${esc(x.by)}</td></tr>`).join("")}</tbody></table></div>`;
      } catch(e){ out.innerHTML = `<div class="albanner">${esc(e.message)}</div>`; }
    };
  }

  /* ---------- entry ---------- */
  window.openSematiClearance = async function(){
    activateView(); installCss();
    const host = $("#view-semati-clearance"); if(!host) return;
    if(!caps().sematiClear){
      host.innerHTML = `<div class="panel"><div class="sm-lock"><div style="font-size:26px">Locked</div><h2 style="margin:8px 0 4px">Semati clearance is a capability</h2><div class="sub">Your role does not hold <b>Semati clearance</b>. A Super Admin grants it in Settings › Users › Roles — it releases numbers on a national registry, so it is handed out deliberately.</div></div></div>`;
      return;
    }
    if(!S.health){ host.innerHTML = `<div class="panel"><div class="sub">Checking the Semati configuration…</div></div>`; }
    try { S.health = await api("/api/semati/health"); }
    catch(e){ host.innerHTML = `<div class="panel"><div class="albanner">${esc(e.message)}</div></div>`; return; }
    shell(); paint();
    if(S.health.running && !S.job){ await loadJob(S.health.running); if(S.job) startPoll(); }
  };
})();
