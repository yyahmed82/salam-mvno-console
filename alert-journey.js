/* alert-journey.js — ALERT JOURNEY MAP (24 Sep 2026). One renderer, two homes:
 *   Mobile › Explore › Alert journey   (#alert-journey, view "alertjourney")   → renderAlertJourney(host, "mvno")
 *   Fixed  › Explore › Alert journey   (#fixed?t=alertjourney, FIXED_PAGES)    → renderAlertJourney(host, "fixed")
 * Everything an incident can go through, from the evaluation tick to the history book — the gates, the people, Agent 2,
 * the contract clocks and the credit arithmetic — drawn per business line, with reference samples that replay the
 * exact path. Reads the live team registry (/api/teams) for names; contract targets mirror vendorContracts.js.
 * Theme follows the console (CSS variables --card / --line / --ink / --muted / --green). */
(function(){
  "use strict";
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const NS="http://www.w3.org/2000/svg";
  const el=(t,a,txt)=>{ const e=document.createElementNS(NS,t); for(const k in a) e.setAttribute(k,a[k]); if(txt!=null) e.textContent=txt; return e; };
  const BD=8*60, DAY=24*60;
  const fm=m=>m==null?"—":m===Infinity?"never":m<60?`${m} min`:m%DAY===0?`${m/DAY} d`:m%60===0?`${m/60} h`:`${(m/60).toFixed(1)} h`;

  /* ---------- per-business content ---------- */
  const BIZ={
    mvno:{ label:"Mobile · MVNO", short:"Mobile", hash:"alerts", icon:"📱",
      sources:[["src_rule","Rule engine","metric · op · threshold · window","alertRunner · Rails/17-18 replica"],["src_anom","Anomaly engine","seasonal baseline signals","anomaly.js"],["src_dms","DMS flow rules · journeys","activation · lifecycle · money · audit","dmsFlowRules · dmsJourneys"],["src_samp","OSB · UIL samplers · Workbench","integration faults · L2 tests","osbArchive · uilSampler"],["src_manual","Manual ticket","a person opens it · picks the team","POST /alerts/manual"]],
      teams:[["mobile-digital-l2","TCS · Mobile Digital & BSS L2","tcs"],["bss-l2","BSS Operations · L2","sigma"],["bss-l3","Oracle · BSS L3","oracle"],["adm-mobile-l3","ADM Mobile · L3","tcs"],["dms-l3","Evamp & Saanga · DMS / UIL L3","evamp"],["payments","Payments & Gateways","none"],["rafm","Subex · RAFM","subex"],["network-noc","Network NOC","none"],["digital-l1","Salam Digital Ops · L1","none"]],
      notes:{ notify:"Mobile digest to Mail-alert users (business mobile / both) with the PDF report; ChatOps Mobile channel; exec radar Mobile half; NOC wall.", holders:"ACK · 📱 Mobile holders (console_users.ack_mobile) are the on-call fallback.", data:"Rules read the prod-replica of the Rails MVNO stack: orders, payments (Tap / UPG / HyperPay), OTP, KYC, APIGW traffic, DMS activations." },
    },
    fixed:{ label:"Fixed · FTTH / 5G home", short:"Fixed", hash:"fixed-alerts", icon:"🏠",
      sources:[["src_rule","Fixed rule engine","fixed_* rules · per channel","alertRunner · sda_ops / B2C read models"],["src_anom","Fixed errors board","error control board · live failures","fixedErrors.js"],["src_dms","App-log watchers","Yakeen · nexus/146 · Salam Home","fixedApplog"],["src_samp","Order journeys","e-purchase · QR · dealer FTTH / 5G","fixed journeys"],["src_manual","Manual ticket","a person opens it · picks the team","POST /alerts/manual"]],
      teams:[["fixed-apps-l2","Sigma · Fixed Applications L2","sigma"],["oss-l2","OSS Operations · L2","sigma"],["bss-l2","BSS Operations · L2","sigma"],["infra-l2","Infrastructure & DC · L2","sigma"],["adm-fixed-l3","ADM Fixed · L3","sigma"],["bss-l3","Oracle · BSS / OSS L3","oracle"],["payments","Payments & Gateways","none"],["network-noc","Network NOC","none"],["digital-l1","Salam Digital Ops · L1","none"]],
      notes:{ notify:"Fixed digest to Mail-alert users (business fixed / both); ChatOps Fixed channel; exec radar Fixed half; NOC wall.", holders:"ACK · 🏠 Fixed holders (console_users.ack_fixed) are the on-call fallback.", data:"Rules read the Operations Console read models (sda_ops, opsBeta B2C), the nexus/146 Node back end, the Salam Home app and e-purchase / QR channels." },
    },
  };
  /* contract targets (minutes) — mirrors vendorContracts.js obligations */
  const T={
    tcs:{name:"TCS · SALAM-CONT-206-2022 WP1 (Amendment 1)",fee:697064,cap:10,resp:{P1:15,P2:30,P3:120,P4:BD},rest:{P1:240,P2:480,P3:3*BD,P4:5*BD},rca:{P1:2880,P2:2880},w:{resp:{P1:1,P2:1,P3:1,P4:0},rest:{P1:3,P2:1,P3:1,P4:0},rca:{P1:1,P2:1}},mode:"weight"},
    sigma:{name:"Sigma · CONT-SALAM-167-2024 + Amendment 1",fee:464100,cap:40,resp:{P1:10,P2:15,P3:30,P4:60},rest:{P1:120,P2:240,P3:480,P4:DAY},resol:{P1:240,P2:360,P3:BD,P4:2*BD},rca:{},w:{resp:{P1:1,P2:1,P3:1,P4:1},rest:{P1:2,P2:2,P3:1,P4:1},resol:{P1:2,P2:1,P3:1,P4:1}},idx:{P1:5,P2:3,P3:2,P4:1},mode:"impact"},
    oracle:{name:"Oracle · SAL-OD-14253496 Managed Services",fee:916000,cap:10,resp:{P1:15,P2:30,P3:60,P4:240},rest:{P1:240,P2:480,P3:2*BD,P4:5*BD},rca:{P1:2*BD,P2:5*BD},w:{},mode:"band"},
    subex:{name:"Subex · SALAM-CONT-138-2022 RAFM",fee:152114,cap:10,resp:{P1:30,P2:30,P3:240,P4:5*BD},rest:{P1:240,P2:600,P3:5*BD},rca:{},w:{},mode:"none"},
    evamp:{name:"Evamp & Saanga · TeC DMP / UIL L3",fee:0,cap:5,resp:{},rest:{P1:240,P2:480},rca:{},w:{},mode:"hourly"},
    none:{name:"Salam internal · console ack SLA only",fee:0,cap:0,resp:{P1:15,P2:60,P3:240,P4:1440},rest:{P1:240,P2:1440,P3:4320,P4:10080},rca:{},w:{},mode:"none"},
  };
  const ACK_SLA={P1:15,P2:60,P3:240,P4:1440}, LADDER={P1:[5,15,30,30],P2:[15,30,60,60],P3:[30,60,120,0],P4:[0,0,0,0]};

  /* reference samples per business — replay the exact path */
  const SAMPLES={
    mvno:[
      { id:"M-1", title:"P1 · Tap payment failures > 40 % (payment_gateway_fail)", sev:"P1", team:"payments", src:"rule", ack:8, rest:1.9, rca:0, reason:"fixed", twist:"reassign",
        story:["09:12 KSA · rule payment_gateway_fail breaches: 312 failed / 520 attempts on Tap, 187 distinct customers → P1 (above the 50-customer floor)","09:12 · incident #4821 opens on TCS · Mobile Digital & BSS L2 (rule team) · digest + PDF mailed · ChatOps · radar","09:14 · Agent 2: cause 'Tap acquirer 5xx on authorize', impact 'checkout blocked for card payments', suggested team payments (92 %)","09:17 · R1 reminder → TCS L2 members + DL, Mobile ACK holders","09:20 · acked by a TCS L2 member (MTTA 8 min · TCS response P1 < 15 min met)","09:26 · re-assigned to Payments & Gateways — reason 'Tap side, not the app' · ack released · Payments mailed · first_ack_at kept","09:31 · Payments member acks · ServiceNow INC0154 raised · comms mail to L1","11:06 · resolved fixed / mitigated — Tap re-routed to UPG · hold 4 h on the rule (1 h window would re-fire)","11:06 · restoration 1 h 54 min · TCS restoration P1 < 4 h met · no credit","next day · RCA from Tap attached · rule note: add UPG fallback runbook step"] },
      { id:"M-2", title:"P2 · Postpaid bill run overdue (bss_bill_run_late)", sev:"P2", team:"bss-l3", src:"rule", ack:41, rest:11, rca:30, reason:"fixed", twist:"none",
        story:["02:05 · bill run for cycle 24 not finished 8 h after start → P2 on BSS Operations · L2","02:20 · R1 → BSS L2 members; 02:35 · R2 → wider Mobile mail-alert audience","02:46 · acked by BSS L2 (MTTA 41 min · console ack SLA 60 min met)","03:10 · re-assigned to Oracle · BSS L3 — 'BRM rating job stuck on ECE' · Remedy ticket to Oracle","13:05 · resolved after Oracle fix — restoration 11 h vs Oracle P2 < 8 h → BREACH on restoration","RCA delivered 30 h later (target 5 BD · met)","month: 1 of 6 P2 restorations missed → attainment 83 % → 2 % service credit band on the Oracle monthly fee (cap 10 %)"] },
      { id:"M-3", title:"P4 · OTP verify-rate dip — 1 customer (otp_verify_drop, floor)", sev:"P4", team:"digital-l1", src:"rule", ack:0, rest:0.5, rca:0, reason:"single_customer", twist:"none",
        story:["14:40 · otp_verify_drop breaches on 1 distinct customer → fires at the floor severity P4 (rule severity P2)","14:40 · digest only · no reminders for P4","15:10 · runner auto-clears after clearHoldMin (condition gone) · resolve_reason=cleared","L1 marks it single customer on review → Noise scorecard; rule review: raise min_customers to 5","no vendor clock: Salam L1 team, no contract bound"] },
    ],
    fixed:[
      { id:"F-1", title:"P1 · Salam Home app login failures (fixed_app_login_fail)", sev:"P1", team:"fixed-apps-l2", src:"rule", ack:6, rest:3.2, rca:0, reason:"fixed", twist:"hold",
        story:["07:48 KSA · fixed_app_login_fail: 640 failures / 25 min, 410 customers → P1 on Sigma · Fixed Applications L2","07:48 · Fixed digest + ChatOps Fixed · radar Fixed half · NOC wall","07:50 · Agent 2: cause 'nexus/146 auth pod OOM after 07:40 deploy', first action 'roll back auth-service', team fixed-apps-l2 (95 %)","07:53 · R1 → Sigma Fixed L2 members + DL, Fixed ACK holders","07:54 · acked by Sigma L2 (MTTA 6 min · Sigma response P1 10 min met)","08:30 · L3 parallel escalation to ADM Fixed at 50 % of the 2 h restoration clock (contract)","11:00 · resolved fixed — rollback + hotfix · restoration 3 h 12 min vs Sigma P1 2 h → BREACH · hold 8 h on the rule","credit: weight 2 % × impact index 5 (P1) = 10 % of eligible monthly fee 464,100 = 46,410 SAR (monthly cap 40 %)","Sigma RCA report attached to the incident (no contractual deadline)"] },
      { id:"F-2", title:"P2 · FTTH provisioning work orders stuck (fixed_prov_stuck)", sev:"P2", team:"oss-l2", src:"src_samp", ack:12, rest:7.5, rca:0, reason:"fixed", twist:"none",
        story:["10:15 · 38 FTTH work orders in 'provisioning' > 4 h → P2 on OSS Operations · L2","10:27 · acked by OSS L2 (MTTA 12 min · Sigma response P2 15 min met)","12:00 · escalation to Oracle · OSS L3 — OSM cartridge error · Remedy ticket","17:45 · resolved — orders re-driven · restoration 7 h 30 min vs Sigma P2 4 h → BREACH; Oracle P2 8 h met","credit: weight 2 % × impact index 3 (P2) = 6 % of 464,100 = 27,846 SAR (Sigma); Oracle none"] },
      { id:"F-3", title:"P3 · QR e-purchase decline spike — duplicate (fixed_qr_declines)", sev:"P3", team:"payments", src:"rule", ack:0, rest:0.2, rca:0, reason:"duplicate", twist:"dup",
        story:["16:02 · fixed_qr_declines breaches while #5108 (same rule) is already open from 15:31","16:04 · Agent 2: exact duplicate of #5108 (same rule, open, within 60 min) → comment; policy assist + rule allow-listed → auto-resolved duplicate","no reminders, no page · counted on the Noise scorecard · excluded from vendor measurement","#5108 keeps the clocks and the team"] },
    ],
  };

  /* ---------- map model ---------- */
  const COLS=[["DETECT","engines that can open an incident","slate"],["EVALUATE","gates on every sync tick","blue"],["OPEN","the incident row · everyone told","red"],["OWN","a person takes it","green"],["WORK","the clocks run","amber"],["RESOLVE","closed with a reason","teal"],["HISTORY","learn · measure · pay","purple"]];
  const HUE={slate:"#64748b",blue:"#2563eb",red:"#dc2626",green:"#0e9f5a",amber:"#d97706",teal:"#0891b2",purple:"#7c3aed",pink:"#db2777"};
  const CW=250, GAP=34, X0=40, W=232;
  const CX=COLS.map((_,i)=>X0+i*(CW+GAP)+CW/2);
  const LANES=[["FLOW",70,420],["PEOPLE · AGENT 2",420,600],["CONTRACT CLOCKS",600,720],["OUTCOMES · MONEY",720,850]];
  const VBW=X0*2+7*CW+6*GAP, VBH=850;

  function buildNodes(seg){
    const N={}; const node=(id,c,y,h,title,sub,tag,color)=>{ N[id]={id,x:CX[c],y,w:W,h,title,sub,tag,color:color||COLS[c][2]}; };
    BIZ[seg].sources.forEach((s,i)=>node(s[0],0,86+i*58,50,s[1],s[2],s[3],i===4?"blue":"slate"));
    node("src_agent",0,440,60,"Agent 2 · rule → team mapping","keywords first · model if unsure · human approves","every 6 h · alert_rule_team_suggestions","purple");
    node("src_contract",0,626,60,"Vendors & contracts","team → vendor → contract → obligations","vendorContracts.js","pink");
    node("g_gate",1,86,50,"Enabled · hours · gateway","paused gateway = cannot fire","enabled · active_from / to");
    node("g_thr",1,144,50,"Threshold & sample","min_sample · dim · channel","operator · threshold");
    node("g_count",1,202,56,"Impact count · customer floor","events · customers · services","min_customers → severity ↓");
    node("g_corr",1,266,56,"Correlation & twins","root · child (not paged) · related","twin collapsed = duplicate");
    node("g_hold",1,330,56,"Held · re-open · new?","held_until · reopenMin","flap control","amber");
    node("g_team",1,440,60,"Owner from the rule","alert_rules.team (registry key)","aliases resolve legacy labels","blue");
    node("g_obl",1,626,60,"Obligations attached","response · restoration · resolution · RCA","for THIS severity","pink");
    node("o_open",2,180,76,"INCIDENT OPEN · unacked","alerts row · fired_at · opened_wall · team","status=open · customers · segment","red");
    node("o_notify",2,86,60,"Notify","digest + PDF · ChatOps · radar · NOC wall","Mail-alert users · team DL","red");
    node("o_agent",2,440,66,"Agent 2 triage (≤ 3 min)","dup? flapping? cause · impact · team · action","agent_triage · agent comment","purple");
    node("o_ladder",2,520,66,"Ack reminders R1 → R3","team + DL → ACK holders → wider → mgmt","alert_reminders · repeat","amber");
    node("o_clock",2,626,60,"Response clock starts","t0 = fired_at","console ack SLA 15 / 60 / 240 min","pink");
    node("w_ack",3,180,76,"ACKNOWLEDGED","ack_by · ack_at · first ack = MTTA","team member · ACK holder · admin","green");
    node("w_actions",3,272,72,"Ownership moves","take over · hand over · assign to me","snooze · comment · checklist","green");
    node("w_reassign",3,440,66,"Re-assign to a team","reason required · ack released","first_ack_at kept · ladder restarts","amber");
    node("w_sn",3,520,66,"ServiceNow · comms","one INC per incident · L1 mail","after ack only","blue");
    node("w_resp",3,626,60,"Response met?","ack_at − fired_at vs target","breach → monthly KPI","pink");
    node("k_work",4,180,76,"WORKING","runbook checklist · timeline · discussion","team + vendor on it","amber");
    node("k_esc",4,272,66,"Vendor escalation ladder","per-contract reminders · management","escalationFlows","amber");
    node("k_l3",4,440,66,"L3 / product bug","parallel L3 at 50 % of restoration clock","Sigma → Oracle / Evamp · TCS → ADM","purple");
    node("k_rest",4,626,66,"Restoration · resolution · RCA","fired_at → resolved_at · RCA after restore","targets per vendor & severity","pink");
    node("k_breach",4,740,60,"Breach flagged","clock passed · evidence on the timeline","weight × impact → credit","red");
    node("r_resolve",5,180,76,"RESOLVED","reason · note · resolved_by · resolved_at","fixed · single · false-positive · dup · maint","teal");
    node("r_auto",5,272,60,"Auto-cleared by runner","condition clear ≥ clearHoldMin","resolved_by=system","teal");
    node("r_hold",5,340,60,"Hold on the rule","1 h · 4 h · 8 h · window (cap 12 h)","held_until · release early","amber");
    node("r_reopen",5,440,60,"Re-open (flap)","fires again inside reopenMin","reopen_count +1 · no new page","amber");
    node("r_dup",5,520,60,"Duplicate / collapsed","Agent 2 (assist) · twin rule","comment · no page","purple");
    node("r_rca",5,626,60,"RCA delivered","48 h TCS · 2 BD Oracle","rca clock stops","pink");
    node("r_credit",5,740,60,"Credit computed","per KPI weight · monthly cap","penalty ledger","red");
    node("h_hist",6,180,76,"HISTORY","History tab · XLSX · timeline · audit","alerts + incident_comments","purple");
    node("h_stats",6,272,60,"MTTA · MTTR · 30 d","per side · per team · per person","incidents/stats · owner cards","purple");
    node("h_noise",6,340,60,"Noise scorecard","reasons → which rules cry wolf","rule 7-day badges","purple");
    node("h_learn",6,440,66,"Learn → retune","threshold · floor · team · runbook","Agent 2 re-maps on change","purple");
    node("h_vendor",6,626,60,"Vendor measurement","attainment per KPI per month","SLA report · governance pack","pink");
    node("h_money",6,740,60,"Credit / penalty ledger","invoice deduction · SteerCo","Finance validates","red");
    return N;
  }
  const EDGES=[
    ["src_rule","g_gate"],["src_anom","g_thr"],["src_dms","g_count"],["src_samp","g_count"],["src_manual","o_open","manual: gates skipped"],
    ["g_gate","g_thr"],["g_thr","g_count"],["g_count","g_corr"],["g_corr","g_hold"],["g_hold","o_open","new incident"],["g_hold","r_reopen","re-open","loop"],
    ["src_agent","g_team","approved proposal"],["g_team","o_open"],["src_contract","g_obl"],["g_obl","o_clock"],
    ["o_open","o_notify"],["o_open","o_agent"],["o_open","o_ladder"],["o_open","o_clock"],["o_agent","r_dup","exact duplicate","loop"],["o_agent","g_team","suggested team (assist)","loop"],
    ["o_open","w_ack","ack"],["o_ladder","w_ack","someone takes it"],
    ["w_ack","w_actions"],["w_actions","w_reassign"],["w_reassign","o_open","ack released · new team","loop"],["w_ack","w_sn"],["o_clock","w_resp"],["w_ack","w_resp","ack_at"],
    ["w_ack","k_work"],["k_work","k_esc"],["k_esc","k_l3"],["w_resp","k_rest"],["k_rest","k_breach","target passed","bad"],
    ["k_work","r_resolve","resolve"],["k_work","r_auto"],["r_resolve","r_hold"],["r_hold","g_hold","quiet until released","loop"],["r_auto","r_reopen"],["r_reopen","o_open","same incident","loop"],
    ["k_rest","r_rca"],["k_breach","r_credit"],["r_resolve","k_rest","resolved_at"],
    ["r_resolve","h_hist"],["r_auto","h_hist"],["r_dup","h_hist"],["h_hist","h_stats"],["h_stats","h_noise"],["h_noise","h_learn"],["h_learn","src_agent","rule changed → re-map","loop"],
    ["r_rca","h_vendor"],["r_credit","h_money"],["h_vendor","h_money"]
  ];
  const D={
    src_rule:["Rule engine","every sync tick","Each enabled rule is recomputed from zero over its rolling window (window_hours) against the read models. Nothing is stateful in the rule itself; the incident row is the memory.",["Inputs: metric_key · operator · threshold · min_sample · dim · channel · active hours","Output: a breach signature (value, sample, customers, services) per rule per tick","Paused by a disabled payment gateway or a hold placed by a resolve"]],
    src_anom:["Anomaly / errors board","seasonal baseline · live failures","Signals compare the live value to the same hour / weekday baseline (Mobile) or come from the error control board (Fixed). Each carries its own severity and team, so it enters the same gates as any threshold rule."],
    src_dms:["Flow rules · watchers","business-flow checks","Mobile: dealer activation, lifecycle, money and audit-pipeline checks (dms_*). Fixed: Yakeen, nexus/146 and Salam Home app-log watchers. Same lifecycle from there."],
    src_samp:["Samplers · journeys","integration faults · L2 tests","Sampled integration faults, Workbench test failures and journey checks open incidents directly with the team of their configuration."],
    src_manual:["Manual ticket","POST /api/alerts/manual","A person with ackErrors opens an incident by hand and hands it to a team from the first second. It is a normal alerts row (rule_key manual_ticket / fixed_manual_ticket, source=manual, created_by), so the ack SLA, the ladder, the radar, the history export and the vendor clocks all apply.",["The segment must be one the creator's business covers","The team must cover that side","The team is mailed on creation; the creator may always act on the ticket"]],
    src_agent:["Agent 2 · rule → team mapping","every 6 h · human approves","Deterministic keyword scoring first (team keywords vs rule key, name, metric, description, class, codes; side-aware), one model call only for ambiguous rules and only choosing from the registry. Proposals wait under Alerts › Alert rules › Team mapping.",["Approve → alert_rules.team = key (operator-edited, the seed keeps it) and the rule's open incidents move","Reject is remembered until the rule changes","Never applied on its own, in any policy mode"]],
    src_contract:["Vendors & contracts","vendorContracts.js","The signed obligations per vendor and contract: response, restoration, resolution, RCA, availability, governance; escalation ladders; penalty rules with weights and caps; financials. A team bound to a contract inherits these on every incident it owns."],
    g_gate:["Enabled · hours · gateway","first gate","A disabled rule, a rule outside its KSA active window, or a rule scoped to a disabled payment gateway never evaluates. Disabling a gateway auto-resolves its open incidents and pauses its rules."],
    g_thr:["Threshold and sample","the condition","observed op threshold, with min_sample as the floor of evidence; dim (platform, gateway…) and channel filter the population."],
    g_count:["Impact count and customer floor","identity counting","count_by events | customers | services. Below min_customers the alert still fires but at single_customer_severity (usually P4) and carries customers=1, which pre-selects the single-customer resolve reason."],
    g_corr:["Correlation and twins","root · child · related","A child of an open root incident is grouped under it and not separately paged. Two rules watching the same signal (twins) carry one incident; the twin's open row is closed as duplicate by the runner."],
    g_hold:["Held · re-open · new incident","flap control","If the rule is held (held_until from a resolve) nothing happens. If an incident of this rule resolved inside reopenMin, that same incident re-opens (reopen_count +1, no new page, same ack holder). Otherwise a new incident row is inserted."],
    g_team:["Owner from the rule","alert_rules.team","The incident inherits the rule's team key. Legacy labels (Digital Ops, BSS Ops…) resolve through the team aliases, so every incident lands on a registry team and its members' rights apply."],
    g_obl:["Obligations attached","team → vendor → contract","The drawer resolves team → vendor_id → contract_id → obligations and picks the targets for this severity. No obligations for a Salam internal team (L1)."],
    o_open:["Incident open · unacked","status=open","Columns set: rule_key, name, severity, team, metric, observed, sample, window, dim, message, fired_at, last_seen_at, opened_wall, segment, customers, services, source. The ladder, Agent 2 and the clocks start together.",["Radar and NOC wall show it within the next refresh","Every later breach updates last_seen_at, peak_value, breach_count"]],
    o_notify:["Notify","digest · ChatOps · radar","Mail-alert users get the digest with the PDF report and the runbook; ChatOps channels are posted per business; the exec radar and the NOC wall pick it up. The team DL is mailed for manual tickets and re-assignments."],
    o_agent:["Agent 2 triage","≤ 3 min after open","Deterministic evidence first: exact duplicate (same rule, open, within 60 min), flapping (reopen_count ≥ 3), the rule's last 30 days, what fired within ±10 min, the busiest backend signatures. Then one model call: probable cause, impact, suggested team (registry key), first action, priority hint, confidence. Posted as an agent comment.",["advise mode: comment only","assist mode: sets alerts.team when empty (allow-listed rules), auto-resolves exact duplicates (allow-listed rules)"]],
    o_ladder:["Ack reminders R1 → R3","ackSla.js","While unacked: R1 to the team's members with can_ack plus the team DL, then the per-business ACK holders; R2 adds everyone with Mail alert on that side; R3 adds management; P1/P2 repeat. Each send is a row in alert_reminders and a line on the timeline."],
    o_clock:["Response clock starts","t0 = fired_at","The vendor response target counts from fired_at. The console ack SLA (15 / 60 / 240 / 1440 min) is the internal equivalent and drives the UNACKED counter and MTTA."],
    w_ack:["Acknowledged","ack_by · ack_at","Who may ack: admins, a member of the incident's team with can_ack, an ACK holder of that business (on-call fallback), the ticket creator, or anyone with ackErrors when the incident has no team. First ack fixes MTTA; the ladder stops; the ack holder is accountable."],
    w_actions:["Ownership moves","within the team","Take over the ack (re-ack), hand over to a colleague who is a team member or an ACK holder (mail to both), assign to me (assignee only), snooze until, comment, tick the runbook checklist. All on the timeline and in the audit log."],
    w_reassign:["Re-assign to a team","reason required","The incident moves to another registry team (must cover the side). The ack is released so the receiving team's ack clock starts; first_ack_at is preserved for MTTA; reminder level resets; reassign_count +1; the team is mailed; audit incident.reassign."],
    w_sn:["ServiceNow and comms","after ack only","One INC per incident (idempotent), created by the ack holder, an ACK holder or an admin; incident comms mail to L1 audiences. Related SN tickets are correlated read-only in the drawer."],
    w_resp:["Response met?","ack_at − fired_at","Compared with the contract response target for this severity. A miss is a breach on the response KPI for the month; the drawer shows the target next to the measured value."],
    k_work:["Working","runbook · timeline · discussion","The checklist keeps who ticked what; the timeline merges fired, ack, hand-overs, reminders, ServiceNow, comms, comments, agent notes, rule edits and the resolve into one list."],
    k_esc:["Vendor escalation ladder","escalationFlows","Per contract: reminder minutes per priority and management inform, mirroring the console ladder but evaluated per obligation once evidence connectors are on."],
    k_l3:["L3 / product bug","parallel escalation","Sigma must open a parallel L3 escalation at 50 % of the restoration clock; product-bug resolution follows the L3 vendor SLA (Oracle 30/60/90/120 BD, Evamp P1 continuous effort). Mobile code fixes go to ADM Mobile L3 (TCS)."],
    k_rest:["Restoration · resolution · RCA","the clocks","Restoration: fired_at → resolved_at. Resolution (non-bug): the permanent fix window. RCA: from restoration to the delivered report. Targets per vendor and severity in the table below."],
    k_breach:["Breach flagged","target passed","When a measured clock passes its target the incident is marked as a breach on that KPI; the evidence is the timeline. Breaches feed the monthly attainment per KPI, which is what the penalty rule reads."],
    r_resolve:["Resolved","reason · note · hold","Rights as for ack. Reasons: fixed, single_customer, false_positive, duplicate, maintenance. A system comment and the audit entry record the reason; an optional hold keeps the rule quiet while its window drains."],
    r_auto:["Auto-cleared","resolved_by=system","When the condition stays clear for clearHoldMin the runner resolves the incident with reason cleared. Counts for MTTR; a quick re-fire re-opens the same row."],
    r_hold:["Hold on the rule","held_until","none · 1 h · 4 h · 8 h · window (rule window capped at 12 h). Shown in the held bar with Release; the runner retires it when it expires."],
    r_reopen:["Re-open (flap)","reopenMin","A breach of the same rule inside reopenMin re-opens the same incident instead of paging again. Agent 2 flags flapping at 3 re-opens and asks the model for the cause."],
    r_dup:["Duplicate / collapsed","no page","Agent 2 detects exact duplicates; in assist mode allow-listed rules are auto-resolved with a comment. The runner collapses twin-rule incidents on its own."],
    r_rca:["RCA delivered","rca clock stops","TCS: draft and final within 48 h of restoration for P1/P2 (1 % weight for P2). Oracle: 2 BD P1, 5 BD P2. Sigma: detailed RCA per incident, no deadline stated."],
    r_credit:["Credit computed","per the signed penalty rules","TCS: KPI weight (1–3 %) of the monthly charges, cap 10 %/month. Sigma: weight × impact index (5/3/2/1), monthly cap 40 % of the eligible fee, aggregate cap 10 % of contract price. Oracle: 2 % / 5 % service credits per KPI band, cap 10 % of the monthly fee. Evamp: 0.03 % of the quarterly fee per P1 incident per hour beyond SLA, cap 5 %."],
    h_hist:["History","History tab · XLSX","Resolved incidents stay in the alerts table; the History tab, the XLSX export, the timeline endpoint and the audit log are the record. Comments and reminders are kept with the incident."],
    h_stats:["MTTA · MTTR · 30 days","incidents/stats","Per side; owner cards show per person: acks in 24 h, average time-to-ack 7 d, incidents held. Settings › Teams shows open, unacked, 30-day fires and MTTR per team."],
    h_noise:["Noise scorecard","which rules cry wolf","Resolve reasons single_customer, false_positive and duplicate, plus resolved-without-ack, feed the 7-day badges on each rule and the Noise tab."],
    h_learn:["Learn → retune","rule editor","Raise the threshold or the customer floor, change the team, edit the runbook. Any rule change is logged (alert_rule_changes) and makes Agent 2 re-propose the team on its next run."],
    h_vendor:["Vendor measurement","attainment per KPI per month","met / total per KPI (response, restoration, RCA…) excluding false positives, maintenance and duplicates, per contract, per month. The vendor's SLA report is reconciled against it."],
    h_money:["Credit / penalty ledger","Finance validates","Credits per month per contract, capped per the contract, deducted on the invoice or raised at SteerCo. The console figure is the evidence; Finance confirms the amount."],
  };

  function css(){
    if(document.getElementById("ajCss")) return;
    const st=document.createElement("style"); st.id="ajCss"; st.textContent=`
      .aj{--aj-slate:#64748b;--aj-blue:#2563eb;--aj-red:#dc2626;--aj-green:var(--green,#0e9f5a);--aj-amber:#d97706;--aj-teal:#0891b2;--aj-purple:#7c3aed;--aj-pink:#db2777;font-size:13px;color:var(--ink)}
      .aj .aj-head{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-end;margin:0 0 12px}
      .aj .aj-kicker{font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
      .aj h2{margin:2px 0 0;font-size:20px}
      .aj .aj-legend{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:11.5px;color:var(--muted)} .aj .aj-legend span{display:inline-flex;align-items:center;gap:5px} .aj .aj-legend i{width:12px;height:12px;border-radius:3px;background:var(--c);display:inline-block}
      .aj .aj-stages{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin:12px 0}
      .aj .aj-stage{border:1px solid var(--line);border-top:4px solid var(--c);border-radius:10px;padding:9px 11px;background:var(--card);cursor:pointer}
      .aj .aj-stage:hover,.aj .aj-stage.on{box-shadow:0 0 0 2px var(--c) inset}
      .aj .aj-stage b{display:block;font-size:12.5px;color:var(--c)} .aj .aj-stage span{font-size:11px;color:var(--muted)}
      .aj .aj-map{border:1px solid var(--line);border-radius:14px;background:var(--card);overflow-x:auto}
      .aj .aj-map svg{display:block;min-width:2000px;width:100%;height:auto;font-family:inherit}
      .aj .lane{fill:var(--card2,rgba(148,163,184,.06))} .aj .lane.alt{fill:transparent}
      .aj .colband{fill:var(--c);opacity:.07} .aj .colhead{fill:var(--c)} .aj .colhead-t{fill:#fff;font-size:13px;font-weight:800;letter-spacing:.08em} .aj .colhead-s{fill:#fff;font-size:10.5px;opacity:.9}
      .aj .lanelbl{fill:var(--muted);font-size:10.5px;font-weight:800;letter-spacing:.12em}
      .aj .edge{fill:none;stroke:var(--line);stroke-width:1.8} .aj .edge.flow{stroke:var(--aj-green);stroke-dasharray:6 6;animation:ajdash 1.4s linear infinite} .aj .edge.loop{stroke:var(--aj-amber);stroke-dasharray:4 5;animation:ajdash 1.8s linear infinite} .aj .edge.bad{stroke:var(--aj-red);stroke-width:2.2} .aj .edge.dim{opacity:.2}
      .aj .elbl{font-size:10px;fill:var(--muted);paint-order:stroke;stroke:var(--card);stroke-width:4px;font-weight:600}
      @keyframes ajdash{to{stroke-dashoffset:-24}}
      .aj .node{cursor:pointer} .aj .node rect.bg{fill:var(--card);stroke:var(--c);stroke-width:1.6;rx:10;transition:filter .2s,stroke-width .2s}
      .aj .node .bar{fill:var(--c)} .aj .node text{fill:var(--ink);font-size:12.5px;font-weight:700;pointer-events:none} .aj .node .s{fill:var(--muted);font-size:10.5px;font-weight:500} .aj .node .tag{font-family:var(--mono,ui-monospace,monospace);font-size:9.5px;fill:var(--c)}
      .aj .node:hover rect.bg,.aj .node.on rect.bg{stroke-width:2.6;filter:drop-shadow(0 0 8px var(--c))} .aj .node.lit rect.bg{stroke-width:3;filter:drop-shadow(0 0 14px var(--c))} .aj .node.big rect.bg{stroke-width:2.4}
      .aj .token{fill:var(--aj-green);filter:drop-shadow(0 0 6px var(--aj-green))}
      .aj .aj-grid{display:grid;gap:14px;margin-top:14px;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)} @media(max-width:1000px){.aj .aj-grid{grid-template-columns:1fr} .aj .aj-stages{grid-template-columns:repeat(4,minmax(0,1fr))}}
      .aj .aj-panel{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:14px 16px}
      .aj .aj-panel h3{margin:0 0 8px;font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
      .aj .aj-detail h4{margin:0;font-size:17px} .aj .aj-detail .path{font-family:var(--mono,monospace);font-size:11px;color:var(--aj-green);margin:2px 0 8px} .aj .aj-detail ul{margin:6px 0 0 18px;padding:0} .aj .aj-detail li{margin:3px 0}
      .aj .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px} .aj .chip{border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:11px;color:var(--muted);background:var(--card2,transparent)} .aj .chip.green{border-color:var(--aj-green);color:var(--aj-green)} .aj .chip.red{border-color:var(--aj-red);color:var(--aj-red)} .aj .chip.amber{border-color:var(--aj-amber);color:var(--aj-amber)}
      .aj .form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px} .aj .form label{display:block;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}
      .aj .form input,.aj .form select{width:100%;font:inherit;font-size:13px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card2,var(--card));color:var(--ink);box-sizing:border-box}
      .aj .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
      .aj .clocks{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px}
      .aj .clock{border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:var(--card2,transparent);border-left:4px solid var(--line)} .aj .clock.ok{border-left-color:var(--aj-green)} .aj .clock.bad{border-left-color:var(--aj-red)} .aj .clock.na{opacity:.6}
      .aj .clock span{display:block;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)} .aj .clock b{display:block;font-size:16px;font-family:var(--mono,monospace);margin-top:2px} .aj .clock small{display:block;color:var(--muted);font-size:11px}
      .aj .calc{font-family:var(--mono,monospace);font-size:12px;background:var(--card2,transparent);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:10px;white-space:pre-wrap;line-height:1.55} .aj .calc .hi{color:var(--aj-red);font-weight:700} .aj .calc .ok{color:var(--aj-green);font-weight:700}
      .aj .tl{position:relative;margin-top:10px;height:80px;border:1px solid var(--line);border-radius:10px;background:var(--card2,transparent);overflow:hidden}
      .aj .tl-seg{position:absolute;top:28px;height:26px;border-radius:6px;font-size:10.5px;font-weight:700;color:#fff;display:flex;align-items:center;padding:0 8px;white-space:nowrap;overflow:hidden}
      .aj .tl-mark{position:absolute;top:8px;width:2px;height:64px;background:var(--ink);opacity:.5} .aj .tl-lbl{position:absolute;top:4px;font-size:10px;color:var(--muted);transform:translateX(-50%);white-space:nowrap}
      .aj .tl-tgt{position:absolute;top:60px;height:10px;border-top:2px dashed var(--aj-red);font-size:9.5px;color:var(--aj-red);padding-left:3px;white-space:nowrap}
      .aj table{border-collapse:collapse;width:100%;font-size:12.5px} .aj th{text-align:left;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line)} .aj td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top} .aj td.m{font-family:var(--mono,monospace);white-space:nowrap} .aj .tw{overflow-x:auto}
      .aj .samples{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
      .aj .sample{border:1px solid var(--line);border-left:4px solid var(--c);border-radius:10px;padding:10px 12px;background:var(--card)} .aj .sample b{display:block;font-size:12.5px} .aj .sample ol{margin:6px 0 0 16px;padding:0;font-size:11.5px;color:var(--muted);line-height:1.5} .aj .sample ol li{margin:2px 0}
      .aj .foot{color:var(--muted);font-size:12px;margin-top:12px}
      @media (prefers-reduced-motion:reduce){.aj .edge.flow,.aj .edge.loop{animation:none}}`;
    document.head.appendChild(st);
  }

  /* ---------- render ---------- */
  async function render(host, seg){
    if(!host) return; css(); seg=seg==="fixed"?"fixed":"mvno"; const B=BIZ[seg]; const N=buildNodes(seg);
    let TEAMS={}; try{ const r=await fetch((window.API_BASE||"")+"/api/teams"); if(r.ok){ const d=await r.json(); (d.teams||[]).forEach(t=>{ TEAMS[t.key]=t; }); } }catch(e){}
    const teamName=k=>(TEAMS[k]&&TEAMS[k].name)||((B.teams.find(t=>t[0]===k)||[])[1])||k;
    const teamOpts=B.teams.map(([k,n,v])=>`<option value="${k}" data-v="${v}">${esc(teamName(k))}${v!=="none"?" · "+v:""}</option>`).join("");
    host.innerHTML=`<div class="aj" id="aj_${seg}">
      <div class="aj-head"><div><div class="aj-kicker">${B.icon} ${esc(B.label)} · alert journey</div><h2>From the first tick to the history book</h2>
        <div class="rl" style="color:var(--muted);max-width:80ch">Every path a ${B.short} incident can take: the gates, the people, Agent 2, the contract clocks and the money. Click a stage or a node for the rules behind it; play a scenario or load a reference sample to light the exact path.</div></div>
        <div class="aj-legend"><span><i style="--c:var(--aj-green)"></i>console flow</span><span><i style="--c:var(--aj-amber)"></i>loop back</span><span><i style="--c:var(--aj-red)"></i>breach</span><span><i style="--c:var(--aj-purple)"></i>Agent 2</span><span><i style="--c:var(--aj-blue)"></i>people</span><span><i style="--c:var(--aj-pink)"></i>contract</span></div></div>
      <div class="aj-stages">${COLS.map(([t,s,c],i)=>`<div class="aj-stage" data-col="${i}" style="--c:${HUE[c]}"><b>${i+1} · ${t}</b><span>${esc(s)}</span></div>`).join("")}</div>
      <div class="aj-map"><svg viewBox="0 0 ${VBW} ${VBH}" role="img" aria-label="${esc(B.label)} alert journey"></svg></div>
      <div class="aj-grid">
        <section class="aj-panel aj-detail"><h3>Stage detail</h3><div class="ajd"><h4>Pick a node on the map</h4></div></section>
        <section class="aj-panel"><h3>Scenario · play the ${B.short} journey</h3>
          <div class="form">
            <div><label>Severity</label><select class="sSev"><option>P1</option><option selected>P2</option><option>P3</option><option>P4</option></select></div>
            <div><label>Owning team · contract</label><select class="sTeam">${teamOpts}</select></div>
            <div><label>Opened by</label><select class="sSrc"><option value="rule">${esc(B.sources[0][1])}</option><option value="anomaly">${esc(B.sources[1][1])}</option><option value="dms">${esc(B.sources[2][1])}</option><option value="samp">${esc(B.sources[3][1])}</option><option value="manual">Manual ticket</option></select></div>
            <div><label>Ack after (min)</label><input class="sAck" type="number" min="0" value="22"></div>
            <div><label>Restored after (h)</label><input class="sRes" type="number" min="0" step="0.1" value="9"></div>
            <div><label>RCA after restore (h)</label><input class="sRca" type="number" min="0" value="60"></div>
            <div><label>Resolve reason</label><select class="sReason"><option value="fixed">Fixed / mitigated</option><option value="single_customer">Single customer</option><option value="false_positive">False positive</option><option value="duplicate">Duplicate</option><option value="maintenance">Maintenance</option><option value="cleared">Auto-cleared by runner</option></select></div>
            <div><label>Twist</label><select class="sTwist"><option value="none">Straight through</option><option value="reassign">Re-assigned to another team</option><option value="dup">Agent 2: duplicate</option><option value="reopen">Fires again inside reopen window</option><option value="hold">Resolved with 8 h hold</option><option value="noack">Nobody acks (escalation ladder)</option></select></div>
            <div><label>Eligible monthly fee (SAR)</label><input class="sFee" type="number" min="0" value="0"></div>
            <div><label>Incidents this month · missed</label><input class="sMonth" value="12 · 2"></div>
          </div>
          <div class="actions"><button type="button" class="pill sPlay" style="border-left-color:var(--aj-green);padding:6px 14px;font-weight:700">▶ Play scenario</button><button type="button" class="pill sReset" style="padding:6px 12px">Reset</button><span class="rl sMsg" style="color:var(--muted)"></span></div>
          <div class="tl"></div><div class="clocks"></div><div class="calc">Play a scenario or load a sample below to see the measured clocks against the signed targets and the credit estimate.</div>
        </section>
      </div>
      <section class="aj-panel" style="margin-top:14px"><h3>${B.short} reference samples · click to replay</h3>
        <div class="samples">${SAMPLES[seg].map((s,i)=>`<div class="sample" data-i="${i}" style="--c:${HUE[s.sev==="P1"?"red":s.sev==="P2"?"amber":"slate"]}"><b>${esc(s.id)} · ${esc(s.title)}</b><span class="rl" style="color:var(--muted)">${esc(teamName(s.team))} · ${s.twist!=="none"?esc(s.twist)+" · ":""}${esc(s.reason)}</span><ol>${s.story.map(x=>`<li>${esc(x)}</li>`).join("")}</ol><div class="actions"><button type="button" class="pill sLoad" data-i="${i}" style="border-left-color:var(--aj-green);padding:4px 10px">▶ Replay on the map</button></div></div>`).join("")}</div>
        <div class="foot">Samples are illustrative journeys built on the ${B.short} rules and teams as configured; times are KSA. They are not real incidents.</div></section>
      <div class="aj-grid">
        <section class="aj-panel"><h3>Contract clocks · ${B.short} teams · per severity</h3><div class="tw"><table class="tgt"></table></div>
          <div class="foot">Targets as encoded in Vendors &amp; contracts. BD = business day (8 h). Response = fired_at → first ack (first_ack_at survives a re-assignment); restoration = fired_at → resolved_at; RCA = restoration → report.</div></section>
        <section class="aj-panel"><h3>Console clocks · ${B.short} ack SLA &amp; reminder ladder</h3><div class="tw"><table>
          <tr><th>Sev</th><th>Ack SLA</th><th>R1 → team + DL, ${B.short} ACK holders</th><th>R2 → + wider Mail-alert</th><th>R3 → + management</th><th>Repeat</th><th>Resolve SLA</th></tr>
          ${["P1","P2","P3","P4"].map(p=>`<tr><td><span class="chip ${p==="P1"?"red":p==="P2"?"amber":""}">${p}</span></td><td class="m">${fm(ACK_SLA[p])}</td>${LADDER[p][0]?`<td class="m">${LADDER[p][0]} min</td><td class="m">${LADDER[p][1]} min</td><td class="m">${LADDER[p][2]} min</td><td class="m">${LADDER[p][3]?"every "+LADDER[p][3]+" min":"—"}</td>`:`<td colspan="4">informational · digest only</td>`}<td class="m">${fm({P1:240,P2:1440,P3:4320,P4:10080}[p])}</td></tr>`).join("")}
        </table></div><div class="foot">${esc(B.notes.holders)} ${esc(B.notes.notify)} Ladder per business in Settings › Notifications &amp; escalation.</div></section>
      </div>
      <section class="aj-panel" style="margin-top:14px"><h3>All the ways a ${B.short} incident closes · and what happens next</h3><div class="tw"><table>
        <tr><th>Close</th><th>Who / what</th><th>Written</th><th>Feeds</th><th>Next</th></tr>
        <tr><td><b>Resolve · fixed / mitigated</b></td><td>team member with can_resolve · ${B.short} ACK holder · ack holder · admin</td><td class="m">status=resolved · resolve_reason · resolved_by · note</td><td>MTTR, vendor restoration clock, history</td><td>optional hold on the rule (1 h · 4 h · 8 h · window, cap 12 h); release early from the held bar</td></tr>
        <tr><td><b>Resolve · single customer</b></td><td>same rights · pre-selected when customers = 1</td><td class="m">resolve_reason=single_customer</td><td>Noise scorecard</td><td>rule review: raise the customer floor or min_sample</td></tr>
        <tr><td><b>Resolve · false positive</b></td><td>same rights</td><td class="m">resolve_reason=false_positive</td><td>Noise scorecard · rule badge</td><td>rule review; excluded from vendor measurement</td></tr>
        <tr><td><b>Resolve · duplicate</b></td><td>a person, or Agent 2 in assist mode for allow-listed rules</td><td class="m">resolve_reason=duplicate · agent comment</td><td>Noise scorecard</td><td>work the original; twins are collapsed by the runner itself</td></tr>
        <tr><td><b>Resolve · maintenance</b></td><td>same rights</td><td class="m">resolve_reason=maintenance</td><td>excluded from vendor measurement</td><td>—</td></tr>
        <tr><td><b>Auto-cleared</b></td><td>the runner, condition clear for clearHoldMin</td><td class="m">resolve_reason=cleared · resolved_by=system</td><td>MTTR, history</td><td>re-fire inside reopenMin re-opens the same incident; later → new incident</td></tr>
        <tr><td><b>Gateway disabled</b></td><td>Settings › Payment gateways</td><td class="m">resolved · rule paused</td><td>audit</td><td>rules of that gateway cannot fire until re-enabled</td></tr>
        <tr><td><b>Re-opened</b></td><td>the runner (flap control)</td><td class="m">status=open · reopen_count · resolved_at=NULL</td><td>Agent 2 flags flapping at ≥ 3</td><td>same ack holder keeps it; reminders resume only if unacked</td></tr>
      </table></div><div class="foot">${esc(B.notes.data)}</div></section>
    </div>`;
    const root=host.querySelector(".aj"), svg=root.querySelector("svg"), q=s=>root.querySelector(s);

    /* draw */
    LANES.forEach(([lbl,y1,y2],i)=>{ svg.appendChild(el("rect",{x:0,y:y1,width:VBW,height:y2-y1,class:"lane"+(i%2?" alt":"")})); svg.appendChild(el("text",{x:10,y:y1+16,class:"lanelbl"},lbl)); });
    COLS.forEach(([t,s,c],i)=>{ const x=X0+i*(CW+GAP); svg.appendChild(el("rect",{x,y:70,width:CW,height:VBH-80,class:"colband",style:`--c:${HUE[c]}`,rx:14}));
      svg.appendChild(el("rect",{x,y:10,width:CW,height:48,rx:10,class:"colhead",style:`--c:${HUE[c]}`})); svg.appendChild(el("text",{x:x+CW/2,y:30,class:"colhead-t","text-anchor":"middle"},`${i+1} · ${t}`)); svg.appendChild(el("text",{x:x+CW/2,y:46,class:"colhead-s","text-anchor":"middle"},s)); });
    const defs=el("defs",{}); defs.innerHTML=`<marker id="ajar_${seg}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>`; svg.appendChild(defs);
    const gE=el("g",{class:"edges"}); svg.appendChild(gE);
    EDGES.forEach(([a,b,lbl,kind])=>{ const A=N[a],Bn=N[b]; if(!A||!Bn) return; let d;
      if(Bn.x>A.x){ const x1=A.x+A.w/2,y1=A.y+A.h/2,x2=Bn.x-Bn.w/2,y2=Bn.y+Bn.h/2,c=(x2-x1)/2; d=`M${x1} ${y1} C${x1+c} ${y1} ${x2-c} ${y2} ${x2} ${y2}`; }
      else if(Bn.x<A.x){ const x1=A.x-A.w/2,y1=A.y+A.h/2,x2=Bn.x+Bn.w/2,y2=Bn.y+Bn.h/2; const dy=Math.max(50,(y2-y1)); d=`M${x1} ${y1} C${x1-70} ${y1+dy} ${x2+70} ${y2+dy} ${x2} ${y2}`; }
      else { d=`M${A.x} ${A.y+A.h} L${Bn.x} ${Bn.y}`; }
      const p=el("path",{d,class:"edge"+(kind==="loop"?" loop":kind==="bad"?" bad":""),"marker-end":`url(#ajar_${seg})`,"data-a":a,"data-b":b}); gE.appendChild(p);
      if(lbl){ const m=p.getPointAtLength(p.getTotalLength()*0.5); gE.appendChild(el("text",{x:m.x,y:m.y-5,"text-anchor":"middle",class:"elbl"},lbl)); } });
    const gN=el("g",{}); svg.appendChild(gN);
    Object.values(N).forEach(n=>{ const g=el("g",{class:"node"+(n.h>=76?" big":""),"data-id":n.id,transform:`translate(${n.x-n.w/2} ${n.y})`,tabindex:0,role:"button","aria-label":n.title,style:`--c:${HUE[n.color]||n.color}`});
      g.appendChild(el("rect",{class:"bg",width:n.w,height:n.h})); g.appendChild(el("rect",{class:"bar",x:0,y:0,width:5,height:n.h,rx:2}));
      g.appendChild(el("text",{x:14,y:18},n.title)); if(n.sub) g.appendChild(el("text",{x:14,y:33,class:"s"},n.sub)); if(n.tag&&n.h>=50) g.appendChild(el("text",{x:14,y:n.h-8,class:"tag"},n.tag));
      g.addEventListener("click",()=>select(n.id)); g.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); select(n.id); } }); gN.appendChild(g); });
    const tok=el("circle",{r:8,class:"token",cx:-30,cy:-30}); svg.appendChild(tok);

    function select(id){
      root.querySelectorAll(".node").forEach(g=>g.classList.toggle("on",g.dataset.id===id));
      root.querySelectorAll(".edge").forEach(p=>{ const hit=p.dataset.a===id||p.dataset.b===id; p.classList.toggle("dim",!hit); p.classList.toggle("flow",hit&&!p.classList.contains("loop")&&!p.classList.contains("bad")); });
      const d=D[id], n=N[id]; if(!d) return;
      const src=B.sources.find(s=>s[0]===id); const title=src?src[1]:d[0];
      const outs=EDGES.filter(e=>e[0]===id).map(e=>`<span class="chip green">→ ${esc(N[e[1]].title)}${e[2]?" · "+esc(e[2]):""}</span>`).join(""); const ins=EDGES.filter(e=>e[1]===id).map(e=>`<span class="chip">${esc(N[e[0]].title)} →</span>`).join("");
      q(".ajd").innerHTML=`<h4>${esc(title)}</h4><div class="path">${esc(d[1])}${n.tag&&n.tag!==d[1]?" · "+esc(n.tag):""}</div><div>${esc(d[2])}</div>${d[3]?`<ul>${d[3].map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}<div class="chips">${ins}${outs}</div>`;
    }
    root.querySelectorAll(".aj-stage").forEach(s=>s.addEventListener("click",()=>{ const i=Number(s.dataset.col); root.querySelectorAll(".aj-stage").forEach(x=>x.classList.toggle("on",x===s)); const first=Object.values(N).filter(n=>n.x===CX[i]).sort((a,b)=>(b.h-a.h)||(a.y-b.y))[0]; if(first) select(first.id); root.querySelectorAll(".node").forEach(g=>g.classList.toggle("lit",N[g.dataset.id].x===CX[i])); }));

    /* targets table */
    const vendorsHere=[...new Set(B.teams.map(t=>t[2]))];
    q(".tgt").innerHTML=`<tr><th>Team · contract</th><th>P1 resp / restore</th><th>P2</th><th>P3</th><th>P4</th><th>Monthly cap</th></tr>`+B.teams.map(([k,n,v])=>{ const t=T[v]; return `<tr><td><b>${esc(teamName(k))}</b><br><span class="rl" style="color:var(--muted)">${esc(t.name)}</span></td>${["P1","P2","P3","P4"].map(p=>`<td class="m">${fm(t.resp[p])} / ${fm(t.rest[p])}${t.resol?` / ${fm(t.resol[p])}`:""}${t.rca[p]?`<br>RCA ${fm(t.rca[p])}`:""}</td>`).join("")}<td class="m">${t.cap?t.cap+" %":"—"}</td></tr>`; }).join("");

    /* scenario */
    let timer=null;
    function light(ids,step){ root.querySelectorAll(".node").forEach(g=>g.classList.remove("lit")); clearInterval(timer); let i=0;
      timer=setInterval(()=>{ if(i>=ids.length){ clearInterval(timer); return; } const n=N[ids[i]]; const g=root.querySelector(`.node[data-id="${ids[i]}"]`); if(g) g.classList.add("lit"); if(n){ tok.setAttribute("cx",n.x-n.w/2-10); tok.setAttribute("cy",n.y+n.h/2); } i++; },step||380); }
    const pct=(v,d)=>d?Math.round(v/d*100):0;
    function play(){
      const sev=q(".sSev").value, teamKey=q(".sTeam").value, vk=(q(".sTeam").selectedOptions[0]||{}).dataset.v||"none", t=T[vk], src=q(".sSrc").value, twist=q(".sTwist").value, reason=q(".sReason").value;
      const ack=Number(q(".sAck").value)||0, rest=Math.round((Number(q(".sRes").value)||0)*60), rca=Math.round((Number(q(".sRca").value)||0)*60);
      const fee=Number(q(".sFee").value)||t.fee||0; const mm=String(q(".sMonth").value).match(/(\d+)\D+(\d+)/); const monthN=mm?Number(mm[1]):12, monthMiss=mm?Number(mm[2]):0;
      let ids=[src==="manual"?"src_manual":src==="anomaly"?"src_anom":src==="dms"?"src_dms":src==="samp"?"src_samp":"src_rule"];
      if(src!=="manual") ids.push("g_gate","g_thr","g_count","g_corr","g_hold");
      ids.push("g_team","g_obl","o_open","o_notify","o_agent");
      let breach=false;
      if(twist==="dup"){ ids.push("r_dup","h_hist","h_noise"); }
      else {
        if(twist==="noack") ids.push("o_ladder","o_ladder","o_ladder");
        ids.push("o_clock"); if(twist!=="noack") ids.push("w_ack","w_resp");
        if(twist==="reassign") ids.push("w_actions","w_reassign","o_open","o_ladder","w_ack");
        ids.push("k_work"); const tr=t.rest[sev]; if(tr&&rest>tr) ids.push("k_esc"); if(t.resol&&tr&&rest>tr/2) ids.push("k_l3"); ids.push("k_rest");
        breach=!!((t.resp[sev]&&(twist==="noack"||ack>t.resp[sev]))||(tr&&rest>tr)||(t.rca[sev]&&rca>t.rca[sev]));
        if(breach) ids.push("k_breach");
        ids.push(reason==="cleared"?"r_auto":"r_resolve");
        if(twist==="hold") ids.push("r_hold","g_hold"); if(twist==="reopen") ids.push("r_reopen","o_open","w_ack","r_resolve");
        if(t.rca[sev]) ids.push("r_rca"); if(breach&&t.mode!=="none") ids.push("r_credit");
        ids.push("h_hist","h_stats"); if(["single_customer","false_positive","duplicate"].includes(reason)) ids.push("h_noise","h_learn");
        if(t.mode!=="none") ids.push("h_vendor"); if(breach&&t.mode!=="none") ids.push("h_money");
      }
      light(ids,360);
      const C=[]; const clock=(lbl,val,tgt,note,force)=>C.push({lbl,val,tgt,note,state:force||(tgt==null?"na":(val<=tgt?"ok":"bad"))});
      clock("Console ack SLA",twist==="noack"?null:ack,ACK_SLA[sev],twist==="noack"?"never acked":"MTTA",twist==="noack"?"bad":null);
      clock("Response (vendor)",twist==="noack"?null:ack,t.resp[sev]||null,t.resp[sev]?fm(t.resp[sev])+" target":"no target in contract",twist==="noack"&&t.resp[sev]?"bad":null);
      clock("Restoration",twist==="dup"?null:rest,t.rest[sev]||null,t.rest[sev]?fm(t.rest[sev])+" target":"no target");
      if(t.resol) clock("Resolution (non-bug)",rest,t.resol[sev],fm(t.resol[sev])+" target · Amendment 1");
      clock("RCA",t.rca[sev]?rca:null,t.rca[sev]||null,t.rca[sev]?fm(t.rca[sev])+" after restore":"no RCA deadline");
      q(".clocks").innerHTML=C.map(c=>`<div class="clock ${c.state}"><span>${c.lbl}</span><b>${c.val==null?"—":fm(c.val)}</b><small>${c.note}</small></div>`).join("");
      const total=Math.max(rest+(t.rca[sev]?rca:0),(t.rest[sev]||0)+(t.rca[sev]||0),60)*1.08; const X=v=>Math.min(99,v/total*100);
      const segs=[]; if(twist!=="noack") segs.push({a:0,b:ack,c:"var(--aj-amber)",l:"unacked "+fm(ack)}); segs.push({a:twist==="noack"?0:ack,b:rest,c:"var(--aj-blue)",l:"working "+fm(Math.max(0,rest-(twist==="noack"?0:ack)))}); if(t.rca[sev]) segs.push({a:rest,b:rest+rca,c:"var(--aj-purple)",l:"RCA "+fm(rca)});
      const marks=[[0,"fired"],[twist==="noack"?null:ack,"ack"],[rest,"resolved"],[t.rca[sev]?rest+rca:null,"RCA"]].filter(m=>m[0]!=null);
      const tg=[[t.resp[sev],"resp target"],[t.rest[sev],"restore target"],[t.rca[sev]?(t.rest[sev]||rest)+t.rca[sev]:null,"RCA target"]].filter(m=>m[0]);
      q(".tl").innerHTML=segs.map(s=>`<div class="tl-seg" style="left:${X(s.a)}%;width:${Math.max(2,X(s.b)-X(s.a))}%;background:${s.c}">${s.l}</div>`).join("")+marks.map((m,i)=>`<div class="tl-mark" style="left:${X(m[0])}%"></div><div class="tl-lbl" style="left:${X(m[0])}%;top:${i%2?4:14}px">${m[1]}</div>`).join("")+tg.map(m=>`<div class="tl-tgt" style="left:${X(m[0])}%;width:${Math.max(1,100-X(m[0]))}%">${m[1]} ${fm(m[0])}</div>`).join("");
      let out=[]; const excl=["false_positive","maintenance","duplicate"].includes(reason)||twist==="dup";
      out.push(`team / contract : ${teamName(teamKey)} · ${t.name}\nseverity        : ${sev} · opened by ${src} · closed as ${reason}${twist!=="none"?" · twist: "+twist:""}`);
      if(excl) out.push(`\nexcluded from vendor measurement (reason ${reason}): no KPI counted, no credit. Still counts for MTTA/MTTR and the noise scorecard.`);
      else if(t.mode==="none") out.push(`\nno vendor contract bound → console clocks only.\nack SLA ${fm(ACK_SLA[sev])} : ${twist==="noack"?'<span class="hi">never acked → R1 / R2 / R3 + management, repeating</span>':ack<=ACK_SLA[sev]?'<span class="ok">met</span>':'<span class="hi">missed by '+fm(ack-ACK_SLA[sev])+'</span>'}`);
      else {
        const kpis=[["response",t.resp[sev],twist==="noack"?Infinity:ack,(t.w.resp||{})[sev]],["restoration",t.rest[sev],rest,(t.w.rest||{})[sev]],["resolution",t.resol&&t.resol[sev],rest,(t.w.resol||{})[sev]],["rca",t.rca[sev],rca,(t.w.rca||{})[sev]]].filter(k=>k[1]);
        let credit=0, lines=[];
        kpis.forEach(([k,tgt,val,w])=>{ const miss=val>tgt; const misses=monthMiss+(miss?1:0), att=pct(monthN-misses,monthN);
          let line=`${k.padEnd(11)} target ${fm(tgt).padEnd(8)} measured ${fm(val).padEnd(8)} ${miss?'<span class="hi">BREACH</span>':'<span class="ok">met</span>'} · month ${att} % (${monthN-misses}/${monthN})`;
          if(miss){
            if(t.mode==="weight"){ const c=fee*(w||1)/100; credit+=c; line+=`\n            → ${w||1} % weight × ${fee.toLocaleString()} = ${Math.round(c).toLocaleString()} SAR`; }
            else if(t.mode==="impact"){ const c=fee*((w||1)*t.idx[sev])/100; credit+=c; line+=`\n            → weight ${w||1} % × impact index ${t.idx[sev]} (${sev}) × ${fee.toLocaleString()} = ${Math.round(c).toLocaleString()} SAR`; }
            else if(t.mode==="band"){ const band=k==="response"?(att>=98?2:5):(att>=99.7?0:2); const c=fee*band/100; credit+=c; line+=`\n            → attainment ${att} % → ${band} % service credit × ${fee.toLocaleString()} = ${Math.round(c).toLocaleString()} SAR${band===0?" (warning / SteerCo band)":""}`; }
            else if(t.mode==="hourly"){ const hrs=Math.max(0,(val-tgt)/60); const c=fee*0.0003*hrs; credit+=c; line+=`\n            → ${hrs.toFixed(1)} h beyond SLA × 0.03 % of quarterly fee ${fee.toLocaleString()} = ${Math.round(c).toLocaleString()} SAR`; }
          }
          lines.push(line); });
        const capV=fee*t.cap/100, applied=Math.min(credit,capV);
        out.push("\n"+lines.join("\n"));
        out.push(`\ncredit this incident : ${Math.round(credit).toLocaleString()} SAR${credit>capV?` → capped at ${t.cap} % of the monthly fee = <span class="hi">${Math.round(applied).toLocaleString()} SAR</span>`:credit?` (monthly cap ${t.cap} % = ${Math.round(capV).toLocaleString()} SAR)`:""}${t.mode==="impact"?"\naggregate cap        : 10 % of total contract price over the term (Sigma cl. 12)":""}${t.mode==="band"?"\nnote                 : Oracle credits are monthly attainment bands, shown as if this incident tips the band; shared root cause → highest credit only":""}`);
      }
      q(".calc").innerHTML=out.join("\n"); q(".sMsg").textContent=`${ids.length} steps · ${C.filter(c=>c.state==="bad").length} clock(s) breached`;
      if(window.audit) window.audit("VIEW_ALERT_JOURNEY", `${seg} ${sev} ${teamKey} ${twist}`);
    }
    q(".sPlay").addEventListener("click",play);
    q(".sReset").addEventListener("click",()=>{ clearInterval(timer); root.querySelectorAll(".node").forEach(g=>g.classList.remove("lit","on")); root.querySelectorAll(".edge").forEach(p=>p.classList.remove("dim","flow")); tok.setAttribute("cx",-30); q(".clocks").innerHTML=""; q(".tl").innerHTML=""; q(".calc").textContent="Play a scenario or load a sample below."; q(".sMsg").textContent=""; });
    q(".sTeam").addEventListener("change",()=>{ const v=(q(".sTeam").selectedOptions[0]||{}).dataset.v||"none"; q(".sFee").value=T[v].fee||0; });
    q(".sFee").value=T[(q(".sTeam").selectedOptions[0]||{}).dataset.v||"none"].fee||0;
    root.querySelectorAll(".sLoad").forEach(b=>b.addEventListener("click",()=>{ const s=SAMPLES[seg][Number(b.dataset.i)]; q(".sSev").value=s.sev; q(".sTeam").value=s.team; q(".sSrc").value=s.src==="src_samp"?"samp":s.src; q(".sAck").value=s.ack; q(".sRes").value=s.rest; q(".sRca").value=s.rca; q(".sReason").value=s.reason; q(".sTwist").value=s.twist; const v=(q(".sTeam").selectedOptions[0]||{}).dataset.v||"none"; q(".sFee").value=T[v].fee||0; play(); root.querySelector(".aj-map").scrollIntoView({behavior:"smooth",block:"start"}); }));
    ["o_open","w_ack","k_work","r_resolve","h_hist","g_hold","w_resp","k_rest"].forEach(id=>root.querySelectorAll(`.edge[data-a="${id}"]`).forEach(p=>{ if(!p.classList.contains("loop")&&!p.classList.contains("bad")) p.classList.add("flow"); }));
    select("o_open");
  }

  window.renderAlertJourney=render;
  /* Mobile home: the view section + navtab */
  function mobile(){ const host=document.getElementById("view-alertjourney"); if(host) render(host,"mvno"); }
  document.querySelectorAll(".navtab").forEach(b=>{ if(b.dataset.view==="alertjourney") b.addEventListener("click", mobile); });
  window.openAlertJourney=mobile;
  /* Fixed home: a hub page */
  window.FIXED_PAGES=window.FIXED_PAGES||{};
  window.FIXED_PAGES.alertjourney={ label:"Alert journey", sub:"trigger → history · clocks · credits", render:(host)=>render(host,"fixed") };
})();
