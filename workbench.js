/* L2 Workbench — the L2 follow-up hub (nav view "workbench", scoped to L2/L3/admin/super).
 * Four tabs, all backed by /api/workbench/*:
 *   ① Activity  — per-console-user activity & performance from audit_log (KPI cards + per-action
 *                 bars + hour-of-day + recent table). Actor emails shown to admins only (server-masked).
 *   ② Replay    — READ-ONLY "as-of" incident replay: pick a window (or a past alert) and see what
 *                 fired + which metrics are chartable then. Does NOT touch the live board / sim clock.
 *   ③ Test      — run any rule against a historic window (would-fire), fire a TEST alert, test a
 *                 notification channel, run synthetic probes. Needs editRules OR manageSync.
 *   ④ Docs      — upload/parse/search .md/.txt/.pdf; shared docs feed Yusr. Upload needs manageSync.
 * Frontend is MOUNTED (hard refresh to pick up); the server side is baked (rebuild). */
(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const API = window.API_BASE;
  const api=(p,opts)=>window.fetch(API+p,Object.assign({headers:{"Content-Type":"application/json"}},opts)).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||("HTTP "+r.status));}).catch(e=>{throw (e instanceof Error?e:new Error("HTTP "+r.status));});return r.json();});
  const num=v=>v==null?"—":Number(v).toLocaleString();
  const can=c=>window.opsCan&&window.opsCan(c);
  const SEV={P1:"#dc2626",P2:"#d97706",P3:"#2563eb",P4:"#64748b"};
  const ksa=iso=>{ if(!iso) return "—"; try{ return new Date(iso).toLocaleString("en-GB",{timeZone:"Asia/Riyadh",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).replace(","," "); }catch(e){ return String(iso); } };

  let tab="activity";
  const state={ actor:"all", days:30, actors:null, rules:null, docsSearch:"" };

  /* ---------------- shared little widgets ---------------- */
  function kpi(label,val,sub,color){
    return `<div style="flex:1;min-width:135px;border:1px solid var(--line);border-left:4px solid ${color||"var(--blue)"};border-radius:10px;background:var(--card);padding:10px 12px">
      <div class="rl" style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">${esc(label)}</div>
      <div style="font-size:22px;font-weight:800;color:var(--ink);margin-top:2px">${val}</div>
      ${sub?`<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:2px">${sub}</div>`:""}</div>`;
  }
  function bars(rows,labelKey,valKey,color){
    if(!rows||!rows.length) return `<div class="rl" style="padding:8px;color:var(--muted)">No data in this window.</div>`;
    const mx=Math.max(...rows.map(r=>Number(r[valKey])||0),1);
    return rows.map(r=>{ const v=Number(r[valKey])||0;
      return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
        <span class="mono" style="width:150px;text-align:right;font-size:11px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r[labelKey])}</span>
        <div style="flex:1;background:var(--bg);border-radius:5px;height:14px;overflow:hidden">
          <div style="width:${Math.max(1.5,v/mx*100).toFixed(1)}%;height:100%;background:${color||"#2563eb"};opacity:.85"></div></div>
        <span class="rl" style="width:60px;font-size:11px">${num(v)}</span></div>`; }).join("");
  }

  /* ---------------- ① ACTIVITY ---------------- */
  async function renderActivity(){
    const box=$("#wbBody");
    if(!state.actors){ try{ const a=await api("/api/workbench/actors"); state.actors=a.actors||[]; }catch(e){ state.actors=[]; } }
    const opts=`<option value="all">All users (${state.actors.length})</option>`+
      state.actors.map(a=>`<option value="${esc(a.actor)}" ${a.actor===state.actor?"selected":""}>${esc(a.actor)} · ${num(a.events)} events</option>`).join("");
    box.innerHTML=`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <span class="rl">User</span>
        <select id="wbActor" style="max-width:360px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)">${opts}</select>
        <span class="rl" style="margin-left:6px">Window</span>
        <div class="segsel" id="wbDays">${[7,30,90].map(d=>`<button data-d="${d}" class="${state.days===d?"on":""}">${d}d</button>`).join("")}</div>
        <span class="rl" style="margin-left:auto;font-size:10.5px;color:var(--muted)">from audit_log · KSA hours${can("manageUsers")?"":" · emails masked (admin-only)"}</span>
      </div><div id="wbActBody"><div class="sub">Loading activity…</div></div>`;
    $("#wbActor").onchange=e=>{ state.actor=e.target.value; loadActivity(); };
    document.querySelectorAll("#wbDays button").forEach(b=>b.onclick=()=>{ state.days=Number(b.dataset.d); renderActivity(); });
    loadActivity();
  }
  async function loadActivity(){
    const b=$("#wbActBody"); if(!b) return; b.style.opacity=".5";
    let d; try{ d=await api(`/api/workbench/user-activity?actor=${encodeURIComponent(state.actor)}&days=${state.days}`); }
    catch(e){ b.style.opacity=""; b.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    b.style.opacity="";
    const t=d.totals||{}, perf=d.perf||{};
    const hourRows=[...Array(24)].map((_,h)=>{ const row=(d.hours||[]).find(x=>x.hr===h); return { hr:String(h).padStart(2,"0")+":00", n:row?row.n:0 }; });
    b.innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        ${kpi("Events",num(t.events),`${num(t.active_days)} active day(s)`,"#2563eb")}
        ${kpi("Page views",num(t.page_views),"VIEW_PAGE","#0ea5e9")}
        ${kpi("Timeline opens",num(t.timeline_opens),"trace / error drilldowns","#16a34a")}
        ${kpi("Searches",num(t.searches),"search + filters","#7c3aed")}
        ${kpi("Unmask events",num(t.unmasks),"PII reveals",(t.unmasks>0?"#d97706":"#94a3b8"))}
        ${kpi("Restricted attempts",num(t.restricted),"blocked (root-only)",(t.restricted>0?"#dc2626":"#94a3b8"))}
        ${kpi("Exports",num(t.exports),"CSV / JSON","#0891b2")}
        ${kpi("Yusr latency",perf.avg_ms!=null?num(perf.avg_ms)+" ms":"—",`${num(perf.chats||0)} chats · ${num(perf.degraded||0)} degraded`,"#059669")}
        ${kpi("Last seen",ksa(t.last_seen),t.first_seen?("since "+ksa(t.first_seen)):"",  "#64748b")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:12px">
        <div class="apanel" style="grid-column:span 6;min-width:280px"><div class="ah"><b>Actions</b></div><div class="abody">${bars(d.byAction,"action","n","#2563eb")}</div></div>
        <div class="apanel" style="grid-column:span 6;min-width:280px"><div class="ah"><b>Pages opened <span class="rl" style="font-weight:600;color:var(--muted);font-size:11px">· VIEW_PAGE</span></b></div><div class="abody">${bars(d.pages,"page","n","#0ea5e9")}</div></div>
        <div class="apanel" style="grid-column:span 12"><div class="ah"><b>Hour of day <span class="rl" style="font-weight:600;color:var(--muted);font-size:11px">· KSA</span></b></div><div class="abody">${bars(hourRows,"hr","n","#7c3aed")}</div></div>
        <div class="apanel" style="grid-column:span 12"><div class="ah"><b>Recent activity <span class="rl" style="font-weight:600;color:var(--muted);font-size:11px">· latest 120</span></b></div>
          <div class="abody" style="overflow:auto;max-height:420px">${recentTable(d.recent,d.masked)}</div></div>
      </div>`;
  }
  function recentTable(rows,masked){
    if(!rows||!rows.length) return `<div class="rl" style="padding:8px;color:var(--muted)">No activity.</div>`;
    return `<table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead><tr style="text-align:left;color:var(--muted)"><th style="padding:4px 6px">When (KSA)</th>${state.actor==="all"?"<th>User</th>":""}<th>Role</th><th>Action</th><th>Target</th></tr></thead>
      <tbody>${rows.map(r=>`<tr style="border-top:1px solid var(--line)">
        <td class="mono" style="padding:4px 6px;white-space:nowrap">${esc(ksa(r.at))}</td>
        ${state.actor==="all"?`<td class="mono" style="font-size:10.5px">${esc(r.actor||"—")}</td>`:""}
        <td class="rl" style="font-size:10.5px">${esc(r.role||"—")}</td>
        <td class="mono" style="font-size:10.5px">${esc(r.action||"")}</td>
        <td class="mono" style="font-size:10.5px;color:var(--muted);word-break:break-all">${esc(r.target||"")}</td></tr>`).join("")}</tbody></table>
      ${masked?`<div class="rl" style="font-size:10px;color:var(--muted);margin-top:6px">Emails and IPs are hidden — visible to admins only.</div>`:""}`;
  }

  /* ---------------- ② REPLAY (read-only) ---------------- */
  function dtLocal(d){ const p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
  async function renderReplay(){
    const box=$("#wbBody");
    const now=new Date(), from=new Date(now.getTime()-24*3600e3);
    let past=[]; try{ const r=await api("/api/workbench/past-alerts?limit=100"); past=r.alerts||[]; }catch(e){}
    box.innerHTML=`<div style="border:1px dashed var(--line);border-radius:10px;padding:12px 14px;background:var(--card);margin-bottom:12px">
        <b style="font-size:12px">Read-only "as-of" replay</b>
        <div class="rl" style="font-size:11px;color:var(--muted);margin-top:4px;line-height:1.6">
          Shows what the board looked like in a past window — the incidents that were <b>open/firing</b> then and the metrics that have snapshots you can chart. This view <b>never touches the live board</b>.
          To actually <b>re-run</b> a window through the alert engine for a training walkthrough, an admin uses <span class="mono">Settings → Sync → Simulate replay</span> (which drives the sim clock) — then come back here to read the result.</div></div>
      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:12px">
        <div><div class="rl" style="font-size:10.5px">From</div><input type="datetime-local" id="wbFrom" value="${dtLocal(from)}" style="border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)"></div>
        <div><div class="rl" style="font-size:10.5px">To</div><input type="datetime-local" id="wbTo" value="${dtLocal(now)}" style="border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)"></div>
        <button class="pill" id="wbReplayRun" style="border-left-color:var(--green)">Show window</button>
        ${past.length?`<span class="rl" style="margin-left:6px">or jump to a past alert</span>
        <select id="wbPast" style="max-width:360px;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)">
          <option value="">—</option>${past.map(a=>`<option value="${esc(a.fired_at)}">[${esc(a.severity)}] ${esc(a.name)} · ${esc(ksa(a.fired_at))}</option>`).join("")}</select>`:""}
      </div><div id="wbReplayBody"></div>`;
    $("#wbReplayRun").onclick=runReplay;
    const ps=$("#wbPast"); if(ps) ps.onchange=()=>{ if(!ps.value) return; const c=new Date(ps.value); $("#wbFrom").value=dtLocal(new Date(c.getTime()-3*3600e3)); $("#wbTo").value=dtLocal(new Date(c.getTime()+3*3600e3)); runReplay(); };
  }
  async function runReplay(){
    const b=$("#wbReplayBody"); if(!b) return; b.innerHTML=`<div class="sub">Loading window…</div>`;
    const from=new Date($("#wbFrom").value).toISOString(), to=new Date($("#wbTo").value).toISOString();
    let d; try{ d=await api(`/api/workbench/replay?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
    catch(e){ b.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    if(window.audit) window.audit("APPLY_FILTER","workbench:replay");
    const sev=(d.bySeverity||[]).map(s=>`<span style="display:inline-block;background:${SEV[s.severity]||"#64748b"}18;color:${SEV[s.severity]||"#64748b"};border-radius:5px;padding:2px 8px;font-size:11px;font-weight:700;margin-right:6px">${esc(s.severity)} · ${num(s.n)}</span>`).join("")||`<span class="rl" style="color:var(--good);font-weight:700">No incidents in this window ✅</span>`;
    const rows=(d.alerts||[]).map(a=>`<tr style="border-top:1px solid var(--line)">
        <td class="mono" style="padding:4px 6px;white-space:nowrap">${esc(ksa(a.fired_at))}</td>
        <td><span style="color:${SEV[a.severity]||"#64748b"};font-weight:700">${esc(a.severity)}</span></td>
        <td>${esc(a.name)}</td>
        <td class="rl" style="font-size:10.5px">${esc(a.team||"—")}</td>
        <td class="mono" style="font-size:10.5px">${esc(a.metric_key)}</td>
        <td class="rl" style="font-size:10.5px">${a.status==="resolved"?("resolved "+esc(ksa(a.resolved_at))):"<b style='color:#dc2626'>still open</b>"}</td>
        <td style="text-align:right"><a href="#alerts" style="color:var(--blue);font-size:11px">open board ↗</a></td></tr>`).join("");
    const metrics=(d.metrics||[]).map(m=>`<span style="display:inline-block;border:1px solid var(--line);border-radius:6px;padding:3px 8px;margin:3px 4px 0 0;font-size:11px" title="${num(m.points)} snapshots ${esc(ksa(m.first_at))}–${esc(ksa(m.last_at))}"><span class="mono">${esc(m.metric_key)}</span> <span class="rl" style="color:var(--muted)">${esc(m.window_hours)}h · ${num(m.points)} pts</span></span>`).join("")||`<span class="rl" style="color:var(--muted)">No metric snapshots recorded in this window.</span>`;
    b.innerHTML=`<div style="margin-bottom:10px">${sev}</div>
      <div class="apanel" style="margin-bottom:12px"><div class="ah"><b>Incidents active in window <span class="rl" style="font-weight:600;color:var(--muted);font-size:11px">· ${num((d.alerts||[]).length)}</span></b></div>
        <div class="abody" style="overflow:auto;max-height:420px">${rows?`<table style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr style="text-align:left;color:var(--muted)"><th style="padding:4px 6px">Fired (KSA)</th><th>Sev</th><th>Incident</th><th>Team</th><th>Metric</th><th>Outcome</th><th></th></tr></thead><tbody>${rows}</tbody></table>`:`<div class="rl" style="padding:8px;color:var(--good)">No incidents fired in this window.</div>`}</div></div>
      <div class="apanel"><div class="ah"><b>Chartable metrics for this window <span class="rl" style="font-weight:600;color:var(--muted);font-size:11px">· metric_snapshots</span></b></div>
        <div class="abody">${metrics}<div class="rl" style="font-size:10.5px;color:var(--muted);margin-top:8px">Series API: <span class="mono">/api/metrics/series?key=&lt;metric&gt;&amp;window=&lt;h&gt;</span> — the Analytics and Alerts boards chart the same source.</div></div></div>`;
  }

  /* ---------------- ③ TEST / WHAT-IF ---------------- */
  async function renderTest(){
    const box=$("#wbBody");
    if(!(can("editRules")||can("manageSync"))){ box.innerHTML=`<div class="albanner">The test / what-if runner needs the Edit-rules or Manage-sync capability.</div>`; return; }
    if(!state.rules){ try{ const r=await api("/api/rules"); state.rules=(r.rules||[]).filter(x=>x.metric_key); }catch(e){ state.rules=[]; } }
    const now=new Date(), from=new Date(now.getTime()-24*3600e3);
    box.innerHTML=`<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:12px">
      <div class="apanel" style="grid-column:span 12"><div class="ah"><b>(a) Run a rule against a historic window <span class="rl" style="font-weight:600;color:var(--muted);font-size:11px">· would-fire, observed vs threshold · read-only</span></b></div>
        <div class="abody">
          <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
            <div style="flex:1;min-width:240px"><div class="rl" style="font-size:10.5px">Rule</div>
              <select id="wbRule" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)">
                ${state.rules.map(r=>`<option value="${esc(r.key)}">[${esc(r.severity)}] ${esc(r.name)}</option>`).join("")}</select></div>
            <div><div class="rl" style="font-size:10.5px">From</div><input type="datetime-local" id="wbTFrom" value="${dtLocal(from)}" style="border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)"></div>
            <div><div class="rl" style="font-size:10.5px">To</div><input type="datetime-local" id="wbTTo" value="${dtLocal(now)}" style="border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)"></div>
            <button class="pill" id="wbRuleRun" style="border-left-color:var(--green)">Evaluate</button>
          </div><div id="wbRuleOut" style="margin-top:10px"></div></div></div>

      <div class="apanel" style="grid-column:span 4;min-width:240px"><div class="ah"><b>(b) Fire a TEST alert</b></div>
        <div class="abody"><div class="rl" style="font-size:11px;color:var(--muted);margin-bottom:8px">Inserts a clearly-marked, auto-resolved test incident (context.test=true) and pushes it through ChatOps — verifies routing end-to-end. Never affects real KPIs.</div>
          <button class="pill" id="wbFireTest" style="border-left-color:#d97706">Fire test alert</button><div id="wbFireOut" class="rl" style="margin-top:8px"></div></div></div>
      <div class="apanel" style="grid-column:span 4;min-width:240px"><div class="ah"><b>(c) Test a notification channel</b></div>
        <div class="abody"><div class="rl" style="font-size:11px;color:var(--muted);margin-bottom:8px">Sends a TEST message to the configured Slack/Teams/WhatsApp channels (reuses the ChatOps notifier).</div>
          <button class="pill" id="wbNotifyTest" style="border-left-color:var(--blue)">Send channel test</button><div id="wbNotifyOut" class="rl" style="margin-top:8px"></div></div></div>
      <div class="apanel" style="grid-column:span 4;min-width:240px"><div class="ah"><b>(d) Synthetic checks</b></div>
        <div class="abody"><div class="rl" style="font-size:11px;color:var(--muted);margin-bottom:8px">Runs the read-only probes: API-gateway TCP reachability, Yusr/Ollama ping, and prod-sync freshness.</div>
          <button class="pill" id="wbSynthRun" style="border-left-color:#7c3aed">Run synthetic checks</button><div id="wbSynthOut" style="margin-top:8px"></div></div></div>
    </div>`;
    $("#wbRuleRun").onclick=async()=>{
      const out=$("#wbRuleOut"); out.innerHTML=`<span class="rl">Evaluating…</span>`;
      const key=$("#wbRule").value, from=new Date($("#wbTFrom").value).toISOString(), to=new Date($("#wbTTo").value).toISOString();
      try{ const d=await api(`/api/workbench/rule-test?key=${encodeURIComponent(key)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        const fire=d.would_fire; const vfmt=d.value==null?"—":(["rate","ratio"].includes(d.unit)?(d.value*100).toFixed(1)+"%":(Number.isInteger(d.value)?d.value:Number(d.value).toFixed(2)));
        const tfmt=["rate","ratio"].includes(d.unit)?(d.threshold*100).toFixed(1)+"%":d.threshold;
        out.innerHTML=`<div style="border:1px solid var(--line);border-left:4px solid ${fire?"#dc2626":"#16a34a"};border-radius:10px;padding:10px 12px;background:var(--card)">
          <div style="font-weight:800;color:${fire?"#dc2626":"#16a34a"};font-size:13px">${fire?"⚠ WOULD FIRE":"✓ would NOT fire"}</div>
          <div class="rl" style="font-size:11.5px;margin-top:4px;line-height:1.7">Observed <b>${esc(vfmt)}</b> ${esc(d.op_label)} threshold <b>${esc(tfmt)}</b> · sample <b>${num(d.sample)}</b>${d.enoughSample?"":` <span style="color:#d97706">(below min sample ${num(d.min_sample)})</span>`}<br>
          window ${esc(d.window_hours)}h ending ${esc(ksa(d.to))} · metric <span class="mono">${esc(d.metric_key)}</span></div></div>`;
      }catch(e){ out.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; }
    };
    $("#wbFireTest").onclick=async()=>{ const o=$("#wbFireOut"); o.textContent="Firing…";
      try{ const d=await api("/api/workbench/test-alert",{method:"POST",body:"{}"}); const ch=(d.notify&&d.notify.channels)||[]; o.innerHTML=`<span style="color:var(--good);font-weight:700">Test alert #${esc(d.alert&&d.alert.id)} raised &amp; auto-resolved.</span> ${ch.length?"Routed to: "+ch.map(esc).join(", "):"(no ChatOps channels configured)"}`; }
      catch(e){ o.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; } };
    $("#wbNotifyTest").onclick=async()=>{ const o=$("#wbNotifyOut"); o.textContent="Sending…";
      try{ const d=await api("/api/workbench/notify-test",{method:"POST",body:"{}"}); const ch=d.channels||[]; o.innerHTML=ch.length?`<span style="color:var(--good);font-weight:700">Sent to: ${ch.map(esc).join(", ")}</span>`:`<span style="color:#d97706">No channels configured (Settings → Notifications).</span>`; }
      catch(e){ o.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; } };
    $("#wbSynthRun").onclick=async()=>{ const o=$("#wbSynthOut"); o.innerHTML=`<span class="rl">Running…</span>`;
      try{ const d=await api("/api/workbench/synthetic"); o.innerHTML=synthCard(d); }
      catch(e){ o.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; } };
  }
  function synthCard(d){
    const line=(label,ok,detail)=>`<div style="display:flex;align-items:center;gap:7px;margin:4px 0;font-size:11.5px">
      <span style="width:9px;height:9px;border-radius:50%;background:${ok?"#16a34a":"#dc2626"};display:inline-block"></span>
      <b style="min-width:120px">${esc(label)}</b><span class="rl" style="color:var(--muted)">${detail}</span></div>`;
    const gw=d.apigw||{}, gwOk=Array.isArray(gw.targets)?gw.targets.filter(t=>t.state==="ok").length:(gw.ok||0), gwN=Array.isArray(gw.targets)?gw.targets.length:(gw.total||0);
    const as=d.assist||{}; const ps=d.prodSync||{};
    const stale=(ps.state||[]).filter(t=>t.last_status&&t.last_status!=="ok").length;
    return `<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--card)">
      ${line("API gateway",gwN>0&&gwOk===gwN,`${num(gwOk)}/${num(gwN)} targets reachable`)}
      ${line("Yusr / Ollama",!!as.ok,as.ok?`${esc(as.model||"")} ready`:`${esc(as.error||"unreachable")}`)}
      ${line("Prod-sync",ps.configured?stale===0:false,ps.configured?(stale===0?`${num((ps.state||[]).length)} tables in sync`:`${num(stale)} table(s) not ok`):"not configured")}
      <div class="rl" style="font-size:10px;color:var(--muted);margin-top:6px">checked ${esc(ksa(d.at))} · all probes read-only</div></div>`;
  }

  /* ---------------- ④ DOCS HUB ---------------- */
  async function renderDocs(){
    const box=$("#wbBody");
    const canUp=can("manageSync");
    box.innerHTML=`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <input id="wbDocSearch" placeholder="Search title / filename / content…" value="${esc(state.docsSearch)}" style="flex:1;min-width:220px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12px;color:var(--ink);background:var(--card)">
        <button class="pill" id="wbDocSearchBtn" style="border-left-color:var(--blue)">Search</button>
        <span id="wbDocStat" class="rl" style="margin-left:auto;font-size:10.5px;color:var(--muted)"></span>
      </div>
      ${canUp?`<div class="apanel" style="margin-bottom:12px"><div class="ah"><b>Upload a runbook <span class="rl" style="font-weight:600;color:var(--muted);font-size:11px">· .md · .txt · .pdf</span></b></div>
        <div class="abody"><div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
          <div><div class="rl" style="font-size:10.5px">File</div><input type="file" id="wbDocFile" accept=".md,.markdown,.txt,.text,.pdf" style="font-size:12px"></div>
          <div style="flex:1;min-width:180px"><div class="rl" style="font-size:10.5px">Title (optional)</div><input id="wbDocTitle" placeholder="defaults to filename" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--ink);background:var(--card)"></div>
          <label class="rl" style="font-size:11px;display:flex;align-items:center;gap:5px"><input type="checkbox" id="wbDocShared" checked> Shared · feed Yusr</label>
          <button class="pill" id="wbDocUp" style="border-left-color:var(--green)">Upload</button>
        </div><div id="wbDocUpOut" class="rl" style="margin-top:8px"></div>
        <div class="rl" style="font-size:10px;color:var(--muted);margin-top:6px">.md/.txt are indexed in full; .pdf text is extracted when the server has <span class="mono">pdftotext</span>, else the file is stored and marked "extraction pending". Shared docs become Yusr-answerable KB chunks (5-min cache).</div></div></div>`:
        `<div class="rl" style="font-size:11px;color:var(--muted);margin-bottom:10px">Uploading needs the Manage-sync capability — you can read &amp; search the shared library below.</div>`}
      <div id="wbDocList"><div class="sub">Loading docs…</div></div>`;
    $("#wbDocSearchBtn").onclick=()=>{ state.docsSearch=$("#wbDocSearch").value.trim(); loadDocs(); };
    $("#wbDocSearch").addEventListener("keydown",e=>{ if(e.key==="Enter"){ state.docsSearch=e.target.value.trim(); loadDocs(); } });
    if(canUp) wireUpload();
    loadDocs();
  }
  function wireUpload(){
    $("#wbDocUp").onclick=async()=>{
      const fi=$("#wbDocFile"), out=$("#wbDocUpOut");
      const file=fi.files&&fi.files[0]; if(!file){ out.innerHTML=`<span style="color:#d97706">Pick a file first.</span>`; return; }
      out.textContent="Reading…";
      const reader=new FileReader();
      reader.onload=async()=>{ try{
          const b64=String(reader.result).split(",").pop();
          out.textContent="Uploading…";
          const d=await api("/api/workbench/docs",{method:"POST",body:JSON.stringify({ name:file.name, mime:file.type||"", title:$("#wbDocTitle").value.trim()||undefined, shared:$("#wbDocShared").checked, dataB64:b64 })});
          out.innerHTML=`<span style="color:var(--good);font-weight:700">Uploaded "${esc(d.doc.title)}"</span> ${d.extracted?"· text indexed":"· "+esc(d.note||"stored")}`;
          fi.value=""; $("#wbDocTitle").value=""; loadDocs();
        }catch(e){ out.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`; } };
      reader.onerror=()=>{ out.innerHTML=`<span style="color:#dc2626">Could not read the file.</span>`; };
      reader.readAsDataURL(file);
    };
  }
  async function loadDocs(){
    const b=$("#wbDocList"); if(!b) return; b.style.opacity=".5";
    let d; try{ d=await api(`/api/workbench/docs${state.docsSearch?`?search=${encodeURIComponent(state.docsSearch)}`:""}`); }
    catch(e){ b.style.opacity=""; b.innerHTML=`<div class="albanner">${esc(e.message)}</div>`; return; }
    b.style.opacity="";
    const c=d.counts||{}; const st=$("#wbDocStat"); if(st) st.textContent=`${num(c.total||0)} docs · ${num(c.shared||0)} shared · ${num(c.with_text||0)} indexed${d.pdftext?"":" · pdftotext not installed"}`;
    const canEdit=can("manageSync");
    if(!d.docs||!d.docs.length){ b.innerHTML=`<div class="rl" style="padding:12px;color:var(--muted)">No documents${state.docsSearch?" match your search":" yet"}.</div>`; return; }
    b.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="text-align:left;color:var(--muted)"><th style="padding:5px 6px">Title</th><th>Type</th><th>Size</th><th>Uploaded by</th><th>When</th><th>Yusr</th><th></th></tr></thead>
      <tbody>${d.docs.map(x=>`<tr style="border-top:1px solid var(--line)">
        <td style="padding:5px 6px"><a href="${API}/api/workbench/docs/${x.id}/raw" target="_blank" style="color:var(--blue);font-weight:600">${esc(x.title)}</a>
          <div class="rl" style="font-size:10px;color:var(--muted)">${esc(x.filename)}${x.has_text?` · ${num(x.text_len)} chars`:` · <span style="color:#d97706">no text</span>`}</div></td>
        <td class="mono" style="font-size:10.5px">${esc((x.mime||"").split("/").pop())}</td>
        <td class="rl">${num(Math.round((x.size||0)/1024))} KB</td>
        <td class="mono" style="font-size:10.5px">${esc(x.uploaded_by||"—")}</td>
        <td class="rl" style="font-size:10.5px;white-space:nowrap">${esc(ksa(x.at))}</td>
        <td>${x.shared?`<span style="color:var(--good);font-weight:700;font-size:11px">shared</span>`:`<span class="rl" style="color:var(--muted);font-size:11px">private</span>`}</td>
        <td style="text-align:right;white-space:nowrap">${canEdit?`<button class="pill wb-doc-share" data-id="${x.id}" data-sh="${x.shared?0:1}" style="padding:2px 8px;border-left-color:${x.shared?"#94a3b8":"#16a34a"}">${x.shared?"Unshare":"Share"}</button>
          <button class="pill wb-doc-del" data-id="${x.id}" style="padding:2px 8px;border-left-color:#dc2626">✕</button>`:""}</td></tr>`).join("")}</tbody></table>`;
    document.querySelectorAll(".wb-doc-share").forEach(btn=>btn.onclick=async()=>{ try{ await api(`/api/workbench/docs/${btn.dataset.id}`,{method:"PATCH",body:JSON.stringify({shared:btn.dataset.sh==="1"})}); loadDocs(); }catch(e){ alert(e.message); } });
    document.querySelectorAll(".wb-doc-del").forEach(btn=>btn.onclick=async()=>{ if(!confirm("Delete this document?")) return; try{ await api(`/api/workbench/docs/${btn.dataset.id}`,{method:"DELETE"}); loadDocs(); }catch(e){ alert(e.message); } });
  }

  /* ---------------- shell ---------------- */
  const RENDER={ activity:renderActivity, replay:renderReplay, test:renderTest, docs:renderDocs };
  function setTab(t){ tab=t; document.querySelectorAll("#wbTabs button").forEach(b=>b.classList.toggle("on",b.dataset.t===t)); (RENDER[t]||renderActivity)(); }
  function render(){ if($("#wbNow")) $("#wbNow").textContent="loaded "+KT.t(Date.now(), true); setTab(tab); }

  document.querySelectorAll("#wbTabs button").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.t)));
  const rf=$("#wbRefresh"); if(rf) rf.addEventListener("click",()=>{ state.actors=null; state.rules=null; setTab(tab); });
  // L2 Workbench lives in the Settings gear menu (no nav tab) — activate its view directly,
  // mirroring window.openTicketsBoard: deactivate all tabs + views, clear the gear/opsBar, then render.
  window.openWorkbench=()=>{
    const v=$("#view-workbench"); if(!v) return;
    document.querySelectorAll(".navtab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
    const gear=document.getElementById("settingsBtn"); if(gear) gear.classList.remove("on");
    const ob=document.getElementById("opsBar"); if(ob) ob.classList.remove("show");
    v.classList.add("active");
    render();
  };
})();
