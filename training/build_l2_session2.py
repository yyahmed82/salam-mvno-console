#!/usr/bin/env python3
"""
Salam Digital Console — L2 REVIEW · SESSION 2 (FINAL): "Is it USEFUL?"

Structure (user-specified):
  1. Opening recap quiz on sessions 1–2 (data sync, users, dashboard, alerts, notifications, analytics)
  2. TROUBLESHOOTING deep-dive — concrete HISTORIC cases from this console's own life
  3. Yusr (يُسر) — now LIVE with a local LLM + learning loop
  4. The "know" sections — topology / API GW / journeys / integrations
  5. FINAL GLOBAL QUIZ + sign-off verdicts

No timings anywhere (per standing instruction). Same template as the series deck (deckkit).
USAGE   python3 build_l2_session2.py
OUTPUT  Salam-Console-L2-Session2-FINAL.pptx
"""
import os
from pptx import Presentation
from pptx.util import Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor
from deckkit import *

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "Salam-Console-L2-Session2-FINAL.pptx")
prs = Presentation(); prs.slide_width, prs.slide_height = W, H
S = lambda fill=BG: slide(prs, fill)

# ---- no-time variants of deckkit's section/labhead/pollhead (series has NO minute details) ----
def section3(s, num, title, sub, modules):
    s.background.fill.solid(); s.background.fill.fore_color.rgb = DARK
    text(s, 0.62, 1.5, 6.0, 0.35, num.upper(), 12, GREEN, bold=True)
    text(s, 0.62, 1.9, 11.5, 0.8, title, 34, WHITE, bold=True)
    rule(s, 0.62, 2.95, 1.1, GREEN)
    text(s, 0.62, 3.2, 11.5, 0.45, sub, 14, RGBColor(0xE2, 0xE8, 0xF0))
    for i, name in enumerate(modules):
        y = 4.0 + i * 0.6
        box(s, 0.62, y, 11.5, 0.5, DARK2, RGBColor(0x27, 0x2B, 0x38))
        text(s, 0.88, y + 0.13, 0.6, 0.24, "●", 10.5, GREEN, bold=True)
        text(s, 1.4, y + 0.13, 10.2, 0.24, name, 11.5, RGBColor(0xE2, 0xE8, 0xF0))

def casehead(s, num, title, color=RED):
    box(s, 0, 0, 13.333, 1.05, color, None, radius=False)
    text(s, 0.62, 0.22, 11.0, 0.26, f"{num}  ·  REAL INCIDENT  ·  worked live", 10.5, RGBColor(0xFE, 0xE2, 0xE2), bold=True)
    text(s, 0.62, 0.52, 12.2, 0.4, title, 19, WHITE, bold=True)

def pollhead3(s, n, title):
    box(s, 0, 0, 13.333, 1.05, BLUE, None, radius=False)
    text(s, 0.62, 0.22, 11.0, 0.26, f"QUIZ {n}  ·  everyone answers", 10.5, RGBColor(0xDB, 0xEA, 0xFE), bold=True)
    text(s, 0.62, 0.52, 12.2, 0.4, title, 19, WHITE, bold=True)

# ════════════════════════ TITLE ════════════════════════
s = S(DARK)
text(s, 0, 1.9, 13.333, 0.25, "L2 REVIEW SERIES · SESSION 2 of 2 · FINAL", 11, GREEN, bold=True, align=PP_ALIGN.CENTER)
text(s, 0, 2.3, 13.333, 0.95, "Session 2 — Is it USEFUL?", 40, WHITE, bold=True, align=PP_ALIGN.CENTER)
rule(s, 5.9, 3.4, 1.55, GREEN)
text(s, 0, 3.66, 13.333, 0.45, "Troubleshooting with real cases · Yusr AI copilot · Topology & journeys · Final quiz",
     15, RGBColor(0xE2,0xE8,0xF0), align=PP_ALIGN.CENTER)
text(s, 0, 4.25, 13.333, 0.6, "Everything today runs LIVE on the console. When a number looks wrong — say so.\nTwo of this week's dashboard fixes exist because someone in this room challenged a number.",
     12, RGBColor(0x94,0xA3,0xB8), align=PP_ALIGN.CENTER, spacing=1.35)
for i, (v, l) in enumerate([("4", "recap questions"), ("5", "historic cases"), ("1", "AI copilot, live"), ("8", "final quiz Qs")]):
    kpi(s, 3.05 + i*2.0, 5.35, 1.8, 1.0, v, l, GREEN)

# ════════════════════════ AGENDA ════════════════════════
s = S()
head(s, "SESSION 2", "Agenda — the final review", "Four blocks, then you sign the verdicts.")
for i, (t, d, c, cb) in enumerate([
    ("① WARM-UP QUIZ", "Session 1 recap — sync, users, dashboard, alerts, notifications, analytics. Hands up / call out.", GREEN, GREENBG),
    ("② TROUBLESHOOTING", "The core of today. Five real cases this console lived through — replayed the way L1/L2 would work them.", RED, REDBG),
    ("③ YUSR · يُسر", "The AI copilot — now answering with a real local LLM on this server. Scope, PII, learning loop, live demo.", PURPLE, PURPBG),
    ("④ KNOW THE MAP", "Topology, API Gateway, 24 customer journeys, 32 integrations — where to LOOK when something breaks.", BLUE, BLUEBG)]):
    x = 0.62 + (i % 2) * 6.15; y = 1.95 + (i // 2) * 2.3
    box(s, x, y, 5.9, 2.05, cb, c)
    text(s, x+0.3, y+0.22, 5.3, 0.32, t, 14, c, bold=True)
    text(s, x+0.3, y+0.62, 5.35, 1.3, d, 11, BODY, spacing=1.25)
banner(s, 0.62, 6.45, 12.1, "Then: the FINAL QUIZ (8 questions, both sessions) and the three sign-off verdicts.", "key")

# ════════════════════════ ① RECAP QUIZ ════════════════════════
s = S()
section3(s, "①", "Warm-up — do you still own session 1?", "Four questions. Shout the letter. Wrong answers are the useful ones.",
        ["Data sync", "Users & PII", "Dashboard", "Alerts & notify"])

def quiz(n, title, q, opts, ans, why, extra=None):
    s = S()
    pollhead3(s, n, title)
    text(s, 0.62, 1.7, 12.1, 0.7, q, 15, INK, bold=True, spacing=1.2)
    options(s, opts)
    reveal(s, ans, why, extra)

quiz("R1", "Data sync", "The dashboard says “updated 4 minutes ago”. Prod had an order 2 minutes ago. Is the console broken?",
     ["A — Yes, data must be real-time", "B — No: replica syncs every ~5 min, so 4–7 min lag is the healthy steady state",
      "C — Only broken if lag > 15 min", "D — The console shows cached data from midnight"],
     "B", "Prod-sync pulls every 5 minutes with a safety cutoff — steady-state lag 4–7 min is NORMAL.",
     "If the source itself freezes >60 min, the console declares DATA FROZEN on its own banner — you saw that logic in session 1.")

quiz("R2", "Users & PII", "An L1 agent opens Subscriber 360. The MSISDN shows 05*****290. Why?",
     ["A — A display bug", "B — The subscriber opted out of tracking",
      "C — PII is masked per ROLE; only unmaskPII capability + the unmask toggle reveals it", "D — The number was ported out"],
     "C", "Masking is applied server-side per the caller's capabilities — the browser never receives what the role can't see.",
     "Same governance applies to Yusr: the LLM only ever sees the masked pack.")

quiz("R3", "Dashboard", "Orders KPI says 58,982 and the order tree header shows “✓ reconciles”. What does that ✓ prove?",
     ["A — The tree is drawn from the KPI number", "B — Both counts come from the same raw definition & window — independently computed, they MATCH",
      "C — Nothing, it is decorative", "D — That rollups are enabled"],
     "B", "Two independent computations agreeing is the whole point — that's your session-1 'is the data true?' check, automated.",
     "This week the tree also became a proven PARTITION: every order lands in exactly one box (verify-flow.cjs, 384 combinations).")

quiz("R4", "Alerts", "A P2 rule with min_sample 20 sees a 100% failure rate from 3 events in its window. What happens?",
     ["A — It fires — 100% is critical", "B — It fires as P3 instead",
      "C — Nothing: min_sample gates it — 3 events is noise, not signal", "D — It pages the on-call directly"],
     "C", "Rules fire on threshold + MINIMUM SAMPLE inside the window — that's what keeps 3am single-failure noise out of Teams.",
     "Reminder from session 1: that same gate is why count-based watchdogs exist for low-volume windows.")

# ════════════════════════ ② TROUBLESHOOTING ════════════════════════
s = S()
section3(s, "②", "Troubleshooting — five cases this console lived", "Not lab exercises. Each of these happened, on this platform, with these tools.",
        ["BSS 1500", "Semati outage", "Stuck payments", "Courier mystery", "The missing 3"])

# method slide
s = S()
head(s, "METHOD", "The troubleshooting spine", "Every case today walks the same five steps — learn the spine, not the cases.")
steps = [("SYMPTOM", "ticket / alert /\nangry dashboard"), ("SCOPE", "Troubleshoot page:\none customer or many?"),
         ("TRACE", "timeline drawer:\nrequest / response / ms"), ("CAUSE", "error catalog + runbook\n+ past cases (Yusr)"), ("VERIFY", "sql.cjs on the replica —\nnever trust, always check")]
for i, (t, d) in enumerate(steps):
    node(s, 0.62 + i*2.52, 2.3, 2.2, 1.25, t, d, WHITE, GREEN if i in (0,4) else BLUE)
    if i < 4: arrow_r(s, (0.62 + i*2.52, 2.3, 2.2, 1.25), (0.62 + (i+1)*2.52, 2.3, 2.2, 1.25))
checklist(s, 0.62, 4.0, 12.1, [
    "Troubleshoot → category tiles (Payment / Activation / Eligibility / Delivery / Ownership) → drill to the exact failing call",
    "Subscriber 360 → every event clickable → full request/response JSON in the drawer (PII masked per your role)",
    "Dashboard flow tree → Find (MSISDN / NID) → the customer's whole journey lights up, ending at the box where it stopped",
    "sql.cjs on 152 → read-only SQL against the replica when you need the raw truth — same tool you used in session 1"],
    title="THE FOUR SURFACES YOU'LL USE ALL DAY")

# CASE 1 — BSS 1500
s = S()
casehead(s, "CASE 1", "BSS error 1500 — the incident that taught us about paths", RED)
text(s, 0.62, 1.62, 12.1, 0.62, "INC0016809: customers failing activation with BSS status 1500. The console showed SOME of it — and missed the rest. Why?",
     12.5, BODY, spacing=1.25)
node(s, 0.62, 2.45, 3.6, 1.15, "WRITE path", "activation_logs (replica)\nconsole SAW these fails", WHITE, GREEN)
node(s, 4.9, 2.45, 3.6, 1.15, "READ path", "OSB get-subscription-profile\nlives in dms_audit_logs.uil_logs\n(Clara MySQL) — console was BLIND", WHITE, RED)
node(s, 9.2, 2.45, 3.5, 1.15, "FIX", "OSB fault watcher —\npolls uil_logs every 5m,\nthreshold-calibrated", WHITE, BLUE)
arrow_r(s, (0.62,2.45,3.6,1.15), (4.9,2.45,3.6,1.15)); arrow_r(s, (4.9,2.45,3.6,1.15), (9.2,2.45,3.5,1.15))
checklist(s, 0.62, 3.95, 12.1, [
    "Lesson 1 — an error family can live in TWO systems: the replica shows writes; OSB read-faults never reach it",
    "Lesson 2 — “no alert fired” ≠ “no problem”: 4 new low-volume-aware rules were back-tested against the real incident window",
    "Lesson 3 — the fix is only done when you can PROVE the rule would have fired on the historic data — we did, it would"],
    title="WHAT L2 SHOULD TAKE FROM IT")
banner(s, 0.62, 6.35, 12.1, "LIVE: Troubleshoot → BSS tile → api × status_code breakdown; OSB read-faults appear via the uil_logs watcher.", "info")

# CASE 2 — Semati
s = S()
casehead(s, "CASE 2", "Semati / TCC outage #28713 — layered detection", RED)
text(s, 0.62, 1.62, 12.1, 0.62, "Government eligibility provider degrading: error 715 “Service not available” + 5002 transport resets. One blended failure-rate metric slept through it.",
     12.5, BODY, spacing=1.25)
t = [["Layer", "Signal", "Rule"],
     ["APP layer", "715 — provider up but refusing", "provider_error_rate ≥50% over 15 min (P1)"],
     ["TRANSPORT", "5002 / 408 / SSL resets", "transport_error_rate ≥15% over 30 min (P2)"],
     ["SILENCE", "zero successful Semati calls while platform is live", "success_volume ≤ 0 with min_sample (P1)"],
     ["CANARY", "synthetic probe calls Semati on a schedule", "sematiProbe — catches it at 3am with no traffic"]]
table(s, 0.62, 2.42, 12.1, t, [2.0, 5.0, 5.1], size=10.5)
banner(s, 0.62, 5.6, 12.1, "Principle: chronic-noise providers need LAYERED rules — app / transport / silence / canary — not one blended rate.", "key")
banner(s, 0.62, 6.25, 12.1, "LIVE: Troubleshoot → Eligibility → filter Semati; Alerts board → the four Semati rules and their thresholds.", "info")

# CASE 3 — payments
s = S()
casehead(s, "CASE 3", "Stuck & duplicate payments — definitions matter", RED)
text(s, 0.62, 1.62, 12.1, 0.62, "“Payments stuck” once counted every abandoned checkout — thousands of false positives. The fix was a DEFINITION, not a query.",
     12.5, BODY, spacing=1.25)
checklist(s, 0.62, 2.4, 12.1, [
    "STUCK (real) = pending + gateway COMMIT RESPONSE present + older than 30 min — the gateway charged, the app never finalised",
    "ABANDONED = pending with NO commit response — customer reached the page and left. Normal business, not an incident",
    "DUPLICATE SUSPECT = same customer + amount charged 2+ times within 30 min — reconcile against Tap before refunding",
    "DECLINE REASONS = gateway code + message parsed from payment_commit_response — the drill-down drawer shows WHY each card failed"],
    title="THE FOUR DEFINITIONS L1 MUST NOT MIX UP")
banner(s, 0.62, 5.55, 12.1, "LIVE: Troubleshoot → Payment stuck (note how small the number is now) → decline-reason drawer on a failed payment.", "info")
banner(s, 0.62, 6.2, 12.1, "L2 check: are the stuck thresholds (P2 ≥15 / P1 ≥40 over 3h) still right for current volume? You own this number.", "warn")

# CASE 4 — courier mystery (this week!)
s = S()
casehead(s, "CASE 4", "This week: the courier mystery — 398 “missing” deliveries", RED)
text(s, 0.62, 1.6, 12.1, 0.62, "During THIS review, the tree showed reseller orders with no courier. Investigation, live, with the tools you have:",
     12.5, BODY, spacing=1.25)
steps = [("SYMPTOM", "398 tygo orders,\nno delivery row"), ("VERIFY", "sql.cjs: split by flag\n× payment status"),
         ("FINDING 1", "true = courier required\n(code, not opinion)"), ("FINDING 2", "224 = shop pickup\n(flag=false, legit)"), ("RESULT", "backlog was 0 —\neSIMs need no courier")]
for i, (t2, d) in enumerate(steps):
    node(s, 0.62 + i*2.52, 2.35, 2.2, 1.2, t2, d, WHITE, RED if i == 0 else (GREEN if i == 4 else BLUE))
    if i < 4: arrow_r(s, (0.62 + i*2.52, 2.35, 2.2, 1.2), (0.62 + (i+1)*2.52, 2.35, 2.2, 1.2))
checklist(s, 0.62, 3.9, 12.1, [
    "The dashboard now has Shop pickup (violet) and Courier not created (red) boxes because of this investigation",
    "A new alert (courier_backlog, P2 ≥5 / P1 ≥15 after 30-min grace) pages if paid customers are ever really stranded",
    "The scary number collapsed to ZERO once definitions were right — “alarming” and “wrong” are different problems"],
    title="WHAT CHANGED BECAUSE WE CHECKED")
banner(s, 0.62, 6.3, 12.1, "This is the review working: a challenged number → verified on raw data → dashboard corrected → alert added. Repeat forever.", "key")

# CASE 5 — the missing 3
s = S()
casehead(s, "CASE 5", "The missing 3 — “4 eligible, 1 payment. Where are the others?”", RED)
text(s, 0.62, 1.6, 12.1, 0.62, "Asked in this room, yesterday. Four eligible orders, one reached payment. The tree LOST three orders — or did it?",
     12.5, BODY, spacing=1.25)
node(s, 0.62, 2.4, 2.9, 1.1, "Eligibility Pass", "4 orders", WHITE, GREEN)
node(s, 4.3, 2.05, 2.9, 1.0, "Total Payment", "1 — has a payment record", WHITE, BLUE)
node(s, 4.3, 3.25, 2.9, 1.0, "No payment (NEW)", "3 — eligible, never paid:\nabandoned before payment", WHITE, AMBER)
arrow_r(s, (0.62,2.4,2.9,1.1), (4.3,2.05,2.9,1.0)); arrow_r(s, (0.62,2.4,2.9,1.1), (4.3,3.25,2.9,1.0))
checklist(s, 8.0, 2.05, 4.7, [
    "Boxes must PARTITION: every parent order in exactly one child",
    "verify-flow.cjs proves it over all 384 possible order shapes",
    "The gap became a visible drop-off box, not silent loss"], title="THE RULE", rowh=0.6)
banner(s, 0.62, 4.75, 12.1, "LIVE: flow tree → Find that customer's NID → the 4 orders light their paths; 3 end at “No payment”, 1 at “Not delivered”. Then Timeline → the full trace.", "info")
banner(s, 0.62, 5.4, 12.1, "L2 homework carried forward: whenever a funnel step loses orders silently, demand the partition proof.", "warn")

# ════════════════════════ ③ YUSR ════════════════════════
s = S()
section3(s, "③", "Yusr يُسر — the AI copilot, now with a real brain", "As of last night, a local LLM (llama3.1) answers on this server. Nothing leaves the network.",
        ["What it does", "PII & scope", "Learning loop", "Live demo"])

s = S()
head(s, "YUSR", "What the LLM actually does", "The AI never fetches data. It reasons over what the console gathered — masked per YOUR role.")
node(s, 0.62, 2.1, 2.7, 1.15, "Your question", "MSISDN / NID /\nincident / how-to", WHITE, BLUE)
node(s, 3.9, 2.1, 3.1, 1.15, "Console gathers", "profile · timeline · failures\nCST tickets · alerts · runbooks\n· 32 integrations · past cases", WHITE, GREEN)
node(s, 7.6, 2.1, 2.6, 1.15, "PII mask", "per your role —\nbefore the model\nsees anything", WHITE, AMBER)
node(s, 10.7, 2.1, 2.0, 1.15, "Local LLM", "llama3.1 on 152\nno cloud, ever", WHITE, PURPLE)
arrow_r(s, (0.62,2.1,2.7,1.15), (3.9,2.1,3.1,1.15)); arrow_r(s, (3.9,2.1,3.1,1.15), (7.6,2.1,2.6,1.15)); arrow_r(s, (7.6,2.1,2.6,1.15), (10.7,2.1,2.0,1.15))
checklist(s, 0.62, 3.7, 12.1, [
    "LLM mode — conversational answer that EXPLAINS the cause and quotes the trace  ·  data-only mode — raw facts when the model is down (still correct, just terse)",
    "Out-of-scope questions are refused BEFORE the model; answers come only from gathered context — “not in the data” beats invention",
    "Arabic works: «لماذا فشل الدفع» routes like English  ·  the header honestly shows “Data-only mode” if the LLM is unreachable",
    "Settings → Yusr: kill-switch, usage KPIs, latency split, helpful-rate — L2 can audit the copilot like any other component"],
    title="THE CONTRACT")

s = S()
head(s, "YUSR", "It learns from YOUR thumbs", "The model's weights never change — the team's knowledge grows around it.")
node(s, 0.62, 2.15, 3.2, 1.2, "Agent rates 👍", "on a correct answer", WHITE, GREEN)
node(s, 4.5, 2.15, 3.6, 1.2, "Case memory", "PII-SCRUBBED problem →\nresolution saved (dedup +\nupvotes rank retrieval)", WHITE, BLUE)
node(s, 8.8, 2.15, 3.9, 1.2, "Next similar question", "“we solved a similar case: …”\n— your own proven practice,\ncited back to you", WHITE, PURPLE)
arrow_r(s, (0.62,2.15,3.2,1.2), (4.5,2.15,3.6,1.2)); arrow_r(s, (4.5,2.15,3.6,1.2), (8.8,2.15,3.9,1.2))
checklist(s, 0.62, 3.85, 12.1, [
    "👍 is a real action — it teaches Yusr for the whole team. Rate only genuinely correct answers",
    "👎 feeds the helpful-rate KPI so we see WHICH intents need better runbooks",
    "Numbers are scrubbed before storage (05812… → 0581******) — case memory holds patterns, not people",
    "A month of honest ratings = the dataset for a real fine-tune later. Today: retrieval. Tomorrow: weights"],
    title="RULES OF ENGAGEMENT FOR L1 & L2")
banner(s, 0.62, 6.3, 12.1, "LIVE DEMO: ask Yusr about yesterday's Case-5 customer → watch it cite the failures; rate it; ask again and see the case memory.", "info")

# ════════════════════════ ④ KNOW THE MAP ════════════════════════
s = S()
section3(s, "④", "Know the map — topology & journeys", "When something breaks at 3am, these pages tell you WHERE before you ask WHY.",
        ["Topology", "API Gateway", "24 journeys", "32 integrations"])

s = S()
head(s, "MAP", "Four pages, one habit", "Each answers a different “where”. Open them before you open a ticket.")
t = [["Page", "Question it answers", "What L2 should verify"],
     ["Topology", "How do DMS / BSS / OSB / gov providers connect?", "Are the components & links still accurate after R7.2?"],
     ["API Gateway", "Are the GW nodes reachable RIGHT NOW? (live 30s probe)", "Probe targets match the real infra IPs (172.31.43.9/.10)"],
     ["Journeys", "What are the 24 customer journeys, step by step, with APIs & tables?", "Do the steps match today's production behaviour?"],
     ["Integrations", "All 32 external systems, direction, workers, webhooks — from code", "Anything retired / added? (This catalog also feeds Yusr)"]]
table(s, 0.62, 2.05, 12.1, t, [2.1, 5.4, 4.6], size=10.5)
banner(s, 0.62, 5.35, 12.1, "LIVE: Topology → follow one MNP order across the map · APIGW → watch a probe tick · Journeys → open journey #7 (Apollo) — the shop-pickup flag from Case 4 lives here.", "info")
banner(s, 0.62, 6.0, 12.1, "These are the ONLY pages that document the platform from the platform. If they drift from reality, file it in the review log.", "warn")

# ════════════════════════ FINAL QUIZ ════════════════════════
s = S()
section3(s, "🏁", "FINAL QUIZ — the whole review", "Eight questions covering both sessions. Individually, on paper or phone. Winner gets bragging rights on the certificate.",
        ["Data truth", "Alerts", "Troubleshooting", "Yusr & map"])

quiz("F1", "Flow tree", "A PAID physical reseller order requires courier delivery but has NO delivery_requests row after 30+ min. Which box owns it?",
     ["A — Not Assigned", "B — Shop pickup (reseller)", "C — Courier not created", "D — Partner-fulfilled"],
     "C", "Courier not created = paid + courier required (flag ≠ false) + no delivery row — the real dispatch backlog, with its own P1/P2 alert.",
     "D was retired this week — “partners ship their own SIMs” turned out to be false; they use oto/tam like everyone.")

quiz("F2", "Reseller flag", "apollo_require_delivery = false on a tygo order means…",
     ["A — Courier delivery required", "B — Delivery skipped — customer collects the SIM in the shop",
      "C — The order is not eligible", "D — eSIM only"],
     "B", "commit_worker skips delivery creation ONLY when the flag is false — that IS the shop-pickup case. Default/absent = couriered.",
     "We proved this from the code and the live data after believing the opposite. The code is the ground truth.")

quiz("F3", "Payments", "Pending payment, NO gateway commit response, 2 hours old. What is it?",
     ["A — Stuck payment — page L2", "B — Duplicate suspect", "C — Abandoned checkout — normal, no action", "D — A ZATCA reporting failure"],
     "C", "No commit response = the gateway never charged — the customer walked away. STUCK requires the commit response to be present.",
     None)

quiz("F4", "BSS 1500", "Where do OSB READ-path faults (get-subscription-profile) live?",
     ["A — activation_logs on the replica", "B — dms_audit_logs.uil_logs — a separate MySQL, polled by the OSB watcher",
      "C — payments.extra", "D — They are not recorded anywhere"],
     "B", "That blindness was the INC0016809 lesson: write path in the replica, read path in uil_logs — the watcher closed the gap.",
     None)

quiz("F5", "Semati", "Semati returns 715 “Service not available” on 60% of calls for 20 minutes. Which layer is failing?",
     ["A — Transport / TLS", "B — The provider APP — up but refusing", "C — Our replica sync", "D — The API gateway"],
     "B", "715 = application-layer refusal (P1 rule). 5002/408/SSL resets = transport layer. Different layers, different runbooks.",
     None)

quiz("F6", "Yusr", "Yusr's header says “Data-only mode · LLM offline”. What are you getting?",
     ["A — Nothing — the bot is down", "B — Cached answers from yesterday",
      "C — Correct raw data (profile, failures, tickets, alerts) without AI reasoning", "D — Answers from the cloud fallback"],
     "C", "The console's gathering pipeline still runs — only the reasoning layer is missing. There is NO cloud fallback, by design.",
     None)

quiz("F7", "PII", "Which statement about Yusr's case memory is TRUE?",
     ["A — It stores full questions including MSISDNs", "B — Identifiers are scrubbed before storage (0581****** / 2*********)",
      "C — Only super_admin answers are saved", "D — It uploads cases to Ollama.com"],
     "B", "Case memory keeps problem PATTERNS, not people. Scrubbing is tested — no MSISDN/NID survives into storage.",
     None)

quiz("F8", "Method", "A dashboard number looks impossible. Session-approved FIRST move?",
     ["A — Screenshot it to the group chat", "B — Assume the console is broken and use Grafana",
      "C — Drill into it, then verify the raw truth with sql.cjs on the replica", "D — Restart the console"],
     "C", "Trust, but verify — every number in the console is drillable, and the replica is one read-only query away. That habit found every bug this week.",
     None)

# ════════════════════════ VERDICTS & CLOSE ════════════════════════
s = S()
head(s, "SIGN-OFF", "The three verdicts", "This is what the whole series was for. Your names go on these.")
verdict(s, 0.62, 1.95, 12.1, 1.35, "VERDICT 1", "Is the DATA true? (sync, KPIs, order tree, funnel — after this week's fixes)",
        ["Sign off", "Sign off with exceptions (log them)", "Not yet — blockers listed"])
verdict(s, 0.62, 3.45, 12.1, 1.35, "VERDICT 2", "Are the ALERTS right? (43 rules, thresholds, escalation & notification routing)",
        ["Sign off", "Sign off with threshold changes (name them)", "Not yet"])
verdict(s, 0.62, 4.95, 12.1, 1.35, "VERDICT 3", "Is it USEFUL? (would you open the console FIRST in the next incident?)",
        ["Yes — it's the first tab", "Yes, alongside existing tools", "Not yet — say what's missing"])

s = S(DARK)
text(s, 0, 2.1, 13.333, 0.3, "L2 REVIEW SERIES — COMPLETE", 12, GREEN, bold=True, align=PP_ALIGN.CENTER)
text(s, 0, 2.5, 13.333, 0.8, "شكراً — this console is better because you pushed back", 30, WHITE, bold=True, align=PP_ALIGN.CENTER)
text(s, 0, 3.5, 13.333, 0.9, "Changed BY this review: the No-payment box · Shop-pickup & Courier-not-created split · plan filter\n· customer Find in the tree · order IDs in drill-downs · Yusr scope & Arabic fixes · the partition proof itself.",
     12.5, RGBColor(0xE2,0xE8,0xF0), align=PP_ALIGN.CENTER, spacing=1.35)
text(s, 0, 4.6, 13.333, 0.6, "Keep going: log findings in the L2 Review Log · rate Yusr honestly · challenge every number.\nCertificates follow attendance — details in 06-TEAMS-AND-CERTIFICATES.",
     11.5, RGBColor(0x94,0xA3,0xB8), align=PP_ALIGN.CENTER, spacing=1.3)

prs.save(OUT)
print("saved:", OUT, "· slides:", len(prs.slides._sldIdLst))
