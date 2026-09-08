/* fixed-alerts.js — Fixed / Salam Home "Alerts" sub-page (hub contract: docs/FIXED-PAGES-CONTRACT.md).
 * Sub-tabs: Rules (unified engine, segment=fixed) · History (fired alerts, last 7d) · Prod engine (transition).
 * Reads:  GET /api/fixed/alerts/rules · /history?days=7 · /prod?days=7   (server/src/fixedAlerts.js)
 * Writes: ONLY the existing shared endpoints — PATCH /api/rules/:id (cap editRules) for the ON toggle and
 *         the inline editor; GET /api/rules/:id/history for the per-rule config-change log.
 * Load after fixed.js:  <script src="fixed-alerts.js"></script>  (index.html). Vanilla JS, no build. */
(function(){
  "use strict";
  const FX = () => window.FX;
  const $ = (s, r) => (r || document).querySelector(s);
  const SEV_COLOR = { P1:"#dc2626", P2:"#d97706", P3:"#64748b", P4:"#94a3b8" };
  const PROD_SEV = ["P0","P1","P2","P3","P4"], PROD_SEV_COLOR = ["#dc2626","#dc2626","#d97706","#64748b","#94a3b8"];
  const TEAM_LABEL = { SALES_OPS:"Sales Ops", DIGITAL_OPS:"Digital Ops", OSS_OPS:"OSS Ops", BSS_OPS:"BSS Ops", COMPLIANCE:"Compliance", FRAUD_SECURITY:"Fraud & Security", FIELD:"Field" };
  const OPSYM = { gte:"≥", gt:">", lte:"≤", lt:"<", eq:"=" };
  let sub = "rules", cache = { rules:null, history:null, prod:null };
  const canEdit = () => !!(window.opsCan && window.opsCan("editRules"));

  // write helper — same session headers fixed.js uses (FX.api is GET-only)
  async function apiW(path, method, body){
    const r = await fetch((window.API_BASE||window.CONSOLE_BASE||"")+path, { method, body: body!=null?JSON.stringify(body):undefined,
      headers:{ "Content-Type":"application/json", "X-Console-Role":localStorage.getItem("cons_role")||"", "X-Console-User":localStorage.getItem("cons_email")||"" } });
    const j = await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||("HTTP "+r.status)); return j;
  }

  const fmtVal = (unit, v) => v==null ? "—" : (unit==="rate"||unit==="pp") ? (Number(v)*100).toFixed(1)+(unit==="pp"?"pp":"%") : unit==="ratio" ? Number(v).toFixed(2)+"×" : (Number.isInteger(Number(v))?String(v):Number(v).toFixed(2));
  const sevPill = s => `<span class="sevpill" style="background:${SEV_COLOR[s]||"#64748b"}">${FX().esc(s)}</span>`;
  const prodSevPill = n => `<span class="sevpill" style="background:${PROD_SEV_COLOR[n]||"#64748b"}">${FX().esc(PROD_SEV[n]||("P"+n))}</span>`;
  const cond = r => `${r.operator} ${fmtVal(r.unit, r.threshold)}` + (r.min_sample?` · ≥${r.min_sample}`:"") + (r.channel&&r.channel!=="any"?` · ${r.channel}`:"") + (r.dim&&Object.keys(r.dim).length?` · ${Object.entries(r.dim).map(([k,v])=>k+"="+v).join(",")}`:"");
  const active = r => (r.active_from!=null&&r.active_to!=null) ? `KSA ${String(r.active_from).padStart(2,"0")}:00–${String(r.active_to).padStart(2,"0")}:00` : "always";
  const win = h => Number(h)>=48 && Number(h)%24===0 ? (Number(h)/24)+"d" : h+"h";

  async function render(host){
    const fx = FX(), esc = fx.esc;
    const tabs = [["rules","Alert rules","unified engine · segment fixed"],["history","History","fired alerts · last 7d"],["prod","Prod engine (transition)","/operations-console rules & firings"]];
    host.innerHTML = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        ${tabs.map(([k,l,s])=>`<button class="pill ${sub===k?"active":""}" data-fxsub="${k}" title="${esc(s)}">${esc(l)}</button>`).join("")}
        <span class="rl" style="font-size:10.5px;color:var(--muted);margin-left:6px"><a href="#fixed-alerts" style="color:var(--green,#0e9f5a);font-weight:700">Open the live incident view →</a> (ack · snooze · guide · discussion · metric charts) · Fixed rules run in the SAME alert engine as MVNO (alertRunner) — metrics fixed_* read sda_ops. Edits use the shared /api/rules endpoints.</span>
      </div><div id="fxAlBanner"></div><div id="fxAlBody"><div style="padding:24px;text-align:center;color:var(--muted)">${window.salamLoader?window.salamLoader("Loading Fixed alerts…"):"Loading…"}</div></div>`;
    host.querySelectorAll("[data-fxsub]").forEach(b=>b.addEventListener("click",()=>{ sub=b.dataset.fxsub; render(host); }));
    try {
      if(sub==="rules") await renderRules(host);
      else if(sub==="history") await renderHistory(host);
      else await renderProd(host);
    } catch(e){ $("#fxAlBody",host).innerHTML = `<div class="albanner" style="border-left:4px solid #dc2626"><b>Could not load</b> — ${esc(e.message)}</div>`; }
  }
  const banner = (host, msg) => { const b=$("#fxAlBanner",host); if(b) b.innerHTML = msg?`<div class="albanner">${msg}</div>`:""; };

  /* ---------------- Rules ---------------- */
  async function renderRules(host){
    const fx = FX(), esc = fx.esc;
    const [d, h] = await Promise.all([fx.api("/api/fixed/alerts/rules"), fx.api("/api/fixed/alerts/history?days=7").catch(()=>({rows:[]}))]);
    cache.rules = d; cache.history = h;
    const rules = d.rules||[], edit = canEdit();
    const fired = {}; (h.rows||[]).forEach(a=>{ (fired[a.rule_key] ||= []).push(a); });
    let html = "";
    if(!d.opsConfigured) html += `<div class="albanner" style="margin:0 0 10px"><b>OPS_DATABASE_URL not set</b> — fixed_* metrics return no data, so these rules are evaluated as "no data in window" and never fire. Set it and restart to activate.</div>`;
    html += `<table class="alerts"><tr><th>ON</th><th>PRI</th><th>RULE</th><th>TEAM</th><th>METRIC</th><th>CONDITION</th><th>WINDOW</th><th>ACTIVE</th><th>LATEST</th><th>7D</th><th></th></tr>`;
    rules.forEach(r=>{
      const lt = r.latest, f = fired[r.key]||[], open = f.filter(a=>a.status==="open").length;
      const ltHtml = lt ? `<b>${esc(fmtVal(r.unit, lt.value))}</b><div class="rl" style="font-size:10px;color:var(--muted)">n=${esc(lt.sample)} · ${fx.ts(lt.at)}</div>` : `<span class="rl" style="color:var(--muted)">no data</span>`;
      html += `<tr class="rule-row" data-rk="${esc(r.key)}">
        <td><label class="switch"><input type="checkbox" data-rid="${r.id}" ${r.enabled?"checked":""} ${edit?"":"disabled"}><span class="slider"></span></label></td>
        <td>${sevPill(r.severity)}</td>
        <td><b>${esc(r.name)}</b>${r.builtin?' <span class="rl" style="font-size:10px">builtin</span>':""}${r.alert_class?` <span class="pill" style="font-size:9.5px;padding:1px 6px">${esc(r.alert_class)}</span>`:""}<br><span style="color:var(--muted);font-size:11px">${esc(r.description||"")}</span></td>
        <td>${esc(r.team||"—")}</td>
        <td class="mono" title="${esc(r.metric_label||"")}">${esc(r.metric_key)}</td>
        <td class="mono">${esc(cond(r))}</td>
        <td>${esc(win(r.window_hours))}</td>
        <td class="mono">${esc(active(r))}</td>
        <td>${ltHtml}</td>
        <td>${f.length?`<b style="color:${open?"#dc2626":"inherit"}">${f.length}</b>${open?` <span class="rl" style="font-size:10px;color:#dc2626">${open} open</span>`:""}`:`<span class="rl" style="color:var(--muted)">0</span>`}</td>
        <td style="white-space:nowrap"><button class="pill" data-hist="${r.id}" style="padding:3px 9px">History</button>${edit?` <button class="pill" data-edit="${r.id}" style="padding:3px 9px">Edit</button>`:""}</td>
      </tr><tr class="fx-detail" data-for="${esc(r.key)}" hidden><td colspan="11" style="background:var(--bg)"></td></tr>`;
    });
    html += `</table>`;
    if(!rules.length) html += `<div class="okbox" style="margin-top:6px">No Fixed rules seeded yet — run <span class="mono">node server/src/init.js</span> (or Settings → Reseed rules).</div>`;
    html += `<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:10px">Condition = operator threshold · min sample · channel · dim. LATEST = last metric snapshot the engine computed for this rule (value · sample · sim time, KSA). Toggles/edits need the <b>editRules</b> capability.</div>`;
    $("#fxAlBody",host).innerHTML = html;
    const body = $("#fxAlBody",host);
    body.querySelectorAll("input[data-rid]").forEach(cb=>cb.addEventListener("change", async ()=>{
      try{ await apiW("/api/rules/"+encodeURIComponent(cb.dataset.rid), "PATCH", { enabled: cb.checked }); banner(host,""); }
      catch(e){ banner(host, "Failed to update rule: "+esc(e.message)); cb.checked=!cb.checked; }
    }));
    const byId = id => rules.find(x=>String(x.id)===String(id));
    body.querySelectorAll("[data-hist]").forEach(b=>b.addEventListener("click",()=>toggleDetail(host, byId(b.dataset.hist), "hist", fired)));
    body.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>toggleDetail(host, byId(b.dataset.edit), "edit", fired)));
  }

  async function toggleDetail(host, r, mode, fired){
    const fx = FX(), esc = fx.esc;
    const row = host.querySelector(`.fx-detail[data-for="${CSS.escape(r.key)}"]`); if(!row) return;
    const cell = row.firstElementChild;
    if(!row.hidden && cell.dataset.mode===mode){ row.hidden=true; return; }
    cell.dataset.mode = mode; row.hidden = false;
    if(mode==="hist"){
      const f = fired[r.key]||[];
      cell.innerHTML = `<div style="padding:8px 4px"><b style="font-size:12px">${esc(r.name)} — firings, last 7 days (unified engine)</b>
        ${fx.tbl(["STATUS","FIRED (KSA)","LAST SEEN","RESOLVED","OBSERVED","PEAK","N","BREACHES","MESSAGE"], f.map(a=>[
          `<b style="color:${a.status==="open"?"#dc2626":"var(--green,#0e9f5a)"}">${esc(a.status)}</b>`, fx.ts(a.fired_at), fx.ts(a.last_seen_at), a.resolved_at?fx.ts(a.resolved_at):"—",
          esc(fmtVal(r.unit,a.observed_value)), esc(fmtVal(r.unit,a.peak_value)), esc(a.sample), esc(a.breach_count), `<span style="white-space:normal">${esc(a.message||"")}</span>`]))}
        <div id="fxChg_${r.id}" class="rl" style="font-size:10.5px;color:var(--muted);margin-top:6px">loading config changes…</div></div>`;
      try{ const hh = await fx.api("/api/rules/"+encodeURIComponent(r.id)+"/history"); const ch=(hh.changes||[]).slice(0,10);
        const el=$("#fxChg_"+r.id,host); if(el) el.innerHTML = ch.length ? "Config changes: "+ch.map(c=>`${fx.ts(c.created_at)} ${esc(c.actor||"")} ${esc(c.action)}`).join(" · ") : "No config changes recorded.";
      }catch(e){ const el=$("#fxChg_"+r.id,host); if(el) el.textContent="config changes unavailable: "+e.message; }
    } else {
      const g=(k,d)=> r[k]!=null?r[k]:d, inp=(id,val,extra)=>`<input id="${id}" type="number" step="any" value="${esc(val)}" ${extra||""} style="width:90px;font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">`;
      const sel=(v,x)=>v===x?"selected":"";
      cell.innerHTML = `<div style="padding:10px 4px;display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:10.5px;color:var(--muted)">OPERATOR<br><select id="fxe_op" style="font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">${Object.entries(OPSYM).map(([v,l])=>`<option value="${v}" ${sel(r.operator,v)}>${l} ${v}</option>`).join("")}</select></label>
        <label style="font-size:10.5px;color:var(--muted)">THRESHOLD${r.unit==="rate"||r.unit==="pp"?" (0–1)":""}<br>${inp("fxe_thr", g("threshold",0))}</label>
        <label style="font-size:10.5px;color:var(--muted)">WINDOW (h)<br>${inp("fxe_win", g("window_hours",1),'min="1"')}</label>
        <label style="font-size:10.5px;color:var(--muted)">MIN SAMPLE<br>${inp("fxe_min", g("min_sample",0),'min="0"')}</label>
        <label style="font-size:10.5px;color:var(--muted)">SEVERITY<br><select id="fxe_sev" style="font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">${["P1","P2","P3","P4"].map(s=>`<option ${sel(r.severity,s)}>${s}</option>`).join("")}</select></label>
        <label style="font-size:10.5px;color:var(--muted)">TEAM<br><select id="fxe_team" style="font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card,#fff);color:inherit">${["","BSS Ops","Digital Ops","Sales Ops","OSS Ops"].map(t=>`<option value="${t}" ${sel(r.team||"",t)}>${t||"—"}</option>`).join("")}</select></label>
        <label style="font-size:10.5px;color:var(--muted)">ACTIVE KSA from–to (blank = always)<br>${inp("fxe_from", r.active_from!=null?r.active_from:"",'min="0" max="23"')} ${inp("fxe_to", r.active_to!=null?r.active_to:"",'min="0" max="23"')}</label>
        <button class="pill" id="fxe_save" style="border-left-color:var(--green)">Save</button>
        <span class="rl" style="font-size:10.5px;color:var(--muted)">Saves via PATCH /api/rules/${esc(r.id)} · builtin rows keep their key; name/description/runbook are edited on the main Alerts page.</span></div>`;
      $("#fxe_save",host).onclick = async ()=>{
        const v=id=>$("#"+id,host).value;
        const body = { operator:v("fxe_op"), threshold:Number(v("fxe_thr")), window_hours:Number(v("fxe_win")), min_sample:Number(v("fxe_min")), severity:v("fxe_sev"), team:v("fxe_team")||null,
          active_from: v("fxe_from")!==""?Number(v("fxe_from")):null, active_to: v("fxe_to")!==""?Number(v("fxe_to")):null };
        if(!Number.isFinite(body.threshold)||!(body.window_hours>0)){ banner(host,"Threshold / window must be numbers."); return; }
        try{ await apiW("/api/rules/"+encodeURIComponent(r.id), "PATCH", body); banner(host,""); await renderRules(host); }
        catch(e){ banner(host, "Save failed: "+esc(e.message)); }
      };
    }
  }

  /* ---------------- History ---------------- */
  async function renderHistory(host){
    const fx = FX(), esc = fx.esc;
    const h = await fx.api("/api/fixed/alerts/history?days=7"); cache.history = h;
    const rows = h.rows||[], open = rows.filter(a=>a.status==="open");
    $("#fxAlBody",host).innerHTML = `<div class="topo-stats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        ${fx.chip("FIRED · 7D", fx.fmt(rows.length))}${fx.chip("OPEN NOW", fx.fmt(open.length), open.length?"#dc2626":null)}
        ${fx.chip("P1", fx.fmt(rows.filter(a=>a.severity==="P1").length), rows.some(a=>a.severity==="P1")?"#dc2626":null)}
        ${fx.chip("RULES INVOLVED", fx.fmt(new Set(rows.map(a=>a.rule_key)).size))}</div>
      ${fx.card("Fired Fixed alerts (unified engine)", fx.tbl(["STATUS","PRI","RULE","TEAM","FIRED (KSA)","LAST SEEN","RESOLVED","OBSERVED","N","BREACHES","ACK","MESSAGE"], rows.map(a=>[
        `<b style="color:${a.status==="open"?"#dc2626":"var(--green,#0e9f5a)"}">${esc(a.status)}</b>`, sevPill(a.severity), `<b>${esc(a.name)}</b><div class="rl" style="font-size:10px;color:var(--muted)">${esc(a.rule_key)}</div>`, esc(a.team||"—"),
        fx.ts(a.fired_at), fx.ts(a.last_seen_at), a.resolved_at?fx.ts(a.resolved_at):"—", esc(a.observed_value==null?"—":a.observed_value), esc(a.sample==null?"—":a.sample), esc(a.breach_count), esc(a.ack_by||a.assignee||"—"), `<span style="white-space:normal">${esc(a.message||"")}</span>`])), `last ${esc(h.days)} days · ack / assign on the main Alerts page`)}`;
  }

  /* ---------------- Prod engine (transition) ---------------- */
  async function renderProd(host){
    const fx = FX(), esc = fx.esc;
    const p = await fx.api("/api/fixed/alerts/prod?days=7"); cache.prod = p;
    if(!p.configured){ $("#fxAlBody",host).innerHTML = `<div class="albanner"><b>OPS_DATABASE_URL not set</b> — the prod console's alert_rules / alert_events cannot be read.</div>`; return; }
    const unified = (cache.rules && cache.rules.rules) || (await fx.api("/api/fixed/alerts/rules").catch(()=>({rules:[]}))).rules || [];
    const uByName = {}; unified.forEach(r=>{ uByName[r.name]=r; });
    const last = {}; (p.last||[]).forEach(l=>{ last[l.rule_key]=l; });
    const firedBy = {}; (p.events||[]).forEach(e=>{ firedBy[e.rule_key]=(firedBy[e.rule_key]||0)+1; });
    const rulesTbl = fx.tbl(["ON","PRI","RULE (prod)","TEAM","METRIC","CONDITION","WINDOW","ACTIVE","LAST EVAL","FIRED 7D","UNIFIED TWIN"], (p.rules||[]).map(r=>{
      const u = uByName[r.name]; const l = last[r.key];
      const c = `${r.operator} ${r.threshold}` + (r.min_sample!=null?` · ≥${r.min_sample}`:"") + (r.channel?` · ${r.channel}`:"") + (r.scope?` · scope="${r.scope}"`:"");
      const act = (r.active_start!=null&&r.active_end!=null) ? `KSA ${String(r.active_start).padStart(2,"0")}:00–${String(r.active_end).padStart(2,"0")}:00` : "always";
      return [ r.enabled?`<b style="color:var(--green,#0e9f5a)">on</b>`:`<span style="color:var(--muted)">off</span>`, prodSevPill(Number(r.severity)), `<b>${esc(r.name)}</b><div class="rl" style="font-size:10px;color:var(--muted)">${esc(r.key)}${r.builtin?" · builtin":""}</div>`,
        esc(TEAM_LABEL[r.team]||r.team||"—"), `<span class="mono">${esc(r.metric)}</span>`, `<span class="mono">${esc(c)}</span>`, esc(win(r.window_hours)), `<span class="mono">${esc(act)}</span>`,
        l ? `<b style="color:${l.status==="FIRED"?"#dc2626":l.status==="OK"?"var(--green,#0e9f5a)":"var(--muted)"}">${esc(l.status)}</b> ${esc(l.metric_text||"")}<div class="rl" style="font-size:10px;color:var(--muted)">${fx.ts(l.fired_at)}</div>` : "—",
        firedBy[r.key]?`<b style="color:#dc2626">${firedBy[r.key]}</b>`:"0",
        u ? `<span class="mono" style="font-size:10.5px">${esc(u.key)}</span> ${u.enabled?`<span style="color:var(--green,#0e9f5a)">on</span>`:`<span style="color:var(--muted)">off</span>`}${u.latest?`<div class="rl" style="font-size:10px;color:var(--muted)">latest ${esc(fmtVal(u.unit,u.latest.value))} (n=${esc(u.latest.sample)})</div>`:`<div class="rl" style="font-size:10px;color:var(--muted)">no snapshot yet</div>`}` : `<span style="color:#d97706">not ported</span>` ];
    }));
    const evTbl = fx.tbl(["FIRED (KSA)","PRI","RULE","TEAM","VALUE","THRESHOLD","DETAIL"], (p.events||[]).map(e=>[fx.ts(e.fired_at), prodSevPill(Number(e.severity)), esc(e.rule_name), esc(TEAM_LABEL[e.team]||e.team||"—"), esc(e.metric_text||e.metric_value), esc(e.threshold), `<span style="white-space:normal">${esc(e.detail||"")}</span>`]));
    $("#fxAlBody",host).innerHTML = `<div class="albanner" style="margin:0 0 12px"><b>Transition view.</b> These are the prod Operations Console's own alert rules and firings (sda_ops alert_rules / alert_events, read-only). They run in parallel with the unified engine during the parity week (convergence plan, Phase 3) and will be retired once the unified twins fire identically — after that this tab goes away. Edit prod rules in /operations-console, not here.</div>
      ${fx.card("Prod engine rules", rulesTbl, `${esc((p.rules||[]).length)} rules · UNIFIED TWIN matched by rule name`)}
      <div style="height:12px"></div>
      ${fx.card("Prod engine firings", evTbl, `status FIRED · last ${esc(p.days)} days · newest 300`)}`;
  }

  window.FIXED_PAGES = window.FIXED_PAGES || {};
  window.FIXED_PAGES.alerts = { label: "Alerts", sub: "rules · history · prod engine", render };
})();
