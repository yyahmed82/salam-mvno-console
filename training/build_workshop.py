#!/usr/bin/env python3
"""
Salam Digital Console — WORKSHOP DECK (module-based, diagram-heavy, interactive).

Structure: 20 modules grouped into 4 flexible SESSIONS. Cover one or more modules per session
depending on the room's pace. Every scenario is drawn as a schematic, not described in bullets.
Live polls are built in (question slide → reveal slide) and mirror the Kahoot import file.

USAGE   python3 build_workshop.py
Screenshots optional: drop into ./shots/ (see shots/README.md).
"""
import os, glob
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE
from deckkit import *   # palette + drawing toolkit

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
OUT = os.path.join(HERE, "Salam-Console-Workshop.pptx")

# every link and name comes from one config file — edit that, not the slides
import json
CFG = json.load(open(os.path.join(HERE, "workshop.config.json"), encoding="utf-8"))
TEAMS, CERT = CFG["teams"], CFG["certificate"]

prs = Presentation(); prs.slide_width, prs.slide_height = W, H
S = lambda fill=BG: slide(prs, fill)
PIC = lambda s, slot, cap, **kw: shot(s, slot, cap, SHOTS, **kw)

def poll(n, question, opts, ans_idx, why, remember, mins="5 min"):
    """Emits TWO slides: the question (attendees answer first), then the reveal.
    Mirrors the Kahoot import file so in-room and app-based play stay identical."""
    letters = "ABCD"
    # --- question slide ---
    s = S(); pollhead(s, n, question, mins)
    options(s, opts, x=0.62, y=1.75, w=7.6, step=0.82)
    box(s, 8.6, 1.75, 4.12, 2.6, BLUEBG, BLUE)
    text(s, 8.9, 2.0, 3.6, 0.28, "HOW TO ANSWER", 10, BLUE, bold=True)
    text(s, 8.9, 2.35, 3.6, 1.8,
         "1.  Kahoot / Slido — join with the room code\n\n"
         "2.  Or: hold up A / B / C / D fingers on my count of three\n\n"
         "No conferring. Wrong answers are the useful ones.", 11, INK, spacing=1.28)
    box(s, 8.6, 4.55, 4.12, 1.1, PANEL, LINE)
    text(s, 8.9, 4.78, 3.6, 0.6, "Everyone answers.\nWe reveal on the next slide.", 11.5, MUTED, spacing=1.25)
    # --- reveal slide ---
    s = S(); pollhead(s, f"{n} · reveal", question, "discuss")
    options(s, opts, x=0.62, y=1.75, w=5.9, step=0.72)
    box(s, 6.85, 1.75, 5.87, 0.72, GREENBG, GREEN)
    text(s, 7.15, 1.94, 5.4, 0.35, f"\u2713  ANSWER: {letters[ans_idx]}", 15, GREEN, bold=True)
    text(s, 6.85, 2.7, 5.87, 0.25, "WHY IT MATTERS", 9.5, MUTED, bold=True)
    text(s, 6.85, 3.0, 5.87, 1.9, why, 11.5, BODY, spacing=1.3)
    callout(s, 6.85, 5.0, 5.87, 1.4, "remember this one", remember, "key", 11.5)
    return s


# ══════════════════════════════════════ TITLE ══════════════════════════════════════
s = S(DARK)
text(s, 0, 2.15, 13.333, 0.25, "TECHNICAL WORKSHOP  ·  20 MODULES  ·  4 SESSIONS", 11, GREEN, bold=True, align=PP_ALIGN.CENTER)
text(s, 0, 2.55, 13.333, 0.95, "Salam Digital Console", 42, WHITE, bold=True, align=PP_ALIGN.CENTER)
rule(s, 5.9, 3.65, 1.55, GREEN)
text(s, 0, 3.92, 13.333, 0.45, "Operate it · troubleshoot with it · tune it · trust it", 16, RGBColor(0xE2,0xE8,0xF0), align=PP_ALIGN.CENTER)
text(s, 0, 4.5, 13.333, 0.3, "Hands-on throughout  ·  live production data  ·  bring your laptop", 12, RGBColor(0x94,0xA3,0xB8), align=PP_ALIGN.CENTER)
for i, (v, l) in enumerate([("20", "modules"), ("9", "labs"), ("4", "live polls"), ("5", "scenarios"), ("38", "alert rules")]):
    x = 1.55 + i * 2.15
    box(s, x, 5.25, 1.95, 1.05, DARK2, RGBColor(0x27,0x2B,0x38))
    text(s, x, 5.44, 1.95, 0.4, v, 22, GREEN, bold=True, align=PP_ALIGN.CENTER)
    text(s, x, 5.9, 1.95, 0.22, l.upper(), 8.5, RGBColor(0x94,0xA3,0xB8), align=PP_ALIGN.CENTER)

# ══════════════════════════════════════ MAP ══════════════════════════════════════
s = S()
head(s, "the map", "20 modules · 4 sessions · run at your own pace",
     "Sessions are containers, not calendars. Cover one or more modules per sitting — the modules are self-contained.")
groups = [
    ("SESSION 1 — Foundations", GREEN, GREENBG, [
        "M1  Why this exists — four blind spots", "M2  Architecture & the data pipeline",
        "M3  Access, roles & PII", "M4  Dashboard anatomy", "M5  Order status flow"]),
    ("SESSION 2 — Troubleshooting", BLUE, BLUEBG, [
        "M6  Troubleshoot & the 10 categories", "M7  Payment forensics — 3 states",
        "M8  The failover trap (INC0014859)", "M9  Timeline & Subscriber 360",
        "M10 BSS read-path faults"]),
    ("SESSION 3 — Alerting", PURPLE, PURPBG, [
        "M11 Alerts, metrics & the golden rule", "M12 Correlation & suppression",
        "M13 Escalation & guided response", "M14 SLA & error budget", "M15 Anomaly detection"]),
    ("SESSION 4 — Depth", AMBER, AMBERBG, [
        "M16 Analytics & building panels", "M17 Growth & attribution traps",
        "M18 Rule tuning discipline", "M19 Yusr AI assistant", "M20 Platform & handover"]),
]
for i, (title, c, bgc, mods) in enumerate(groups):
    x = 0.62 + i * 3.13
    box(s, x, 2.15, 2.95, 4.45, bgc, c)
    text(s, x + 0.22, 2.35, 2.5, 0.5, title, 11, c, bold=True, spacing=1.15)
    for j, m in enumerate(mods):
        text(s, x + 0.22, 3.05 + j * 0.68, 2.55, 0.6, m, 10, INK, spacing=1.15)
text(s, 0.62, 6.85, 12.1, 0.3, "Each module: 10 min demo → 15 min lab → 5 min debrief.  Labs and polls are interleaved.", 11, GREEN, bold=True)

# ══════════════════════════════════════ WHERE EVERYTHING LIVES ═══════════════════════════
s = S()
head(s, "before we start", "Where everything lives",
     f"One team, one channel. Everything below is also pinned in Teams › {TEAMS['team_name']} › {TEAMS['channel_name']}.")
linkrow(s, 0.62, 2.15, 5.95, 1.22, "Join the live session", TEAMS["session_join_url"],
        "Same link every session. Joining from the room? Mute your laptop.", accent=PURPLE, accentbg=PURPBG)
linkrow(s, 6.77, 2.15, 5.95, 1.22, "Teams channel — ask anything", TEAMS["channel_url"],
        "Questions during and after. Answered in-channel so everyone sees the answer.")
linkrow(s, 0.62, 3.52, 5.95, 1.22, "Group chat — during the session", TEAMS["group_chat_url"],
        "Quick shouts, lab blockers, “I'm stuck on step 3”.")
linkrow(s, 6.77, 3.52, 5.95, 1.22, "Recordings", TEAMS["recordings_url"],
        "Every session recorded. Missed one? Watch it, then tell me in-channel.")
linkrow(s, 0.62, 4.89, 5.95, 1.22, "Files — deck, labs, cheat-sheet", TEAMS["files_url"],
        "Lab guide, scenarios, the printable L1 cheat-sheet.")
linkrow(s, 6.77, 4.89, 5.95, 1.22, "The console itself", CFG["console_url"],
        "Bring your laptop. You'll be signed in during LAB 1.", accent=GREEN, accentbg=GREENBG)
box(s, 0.62, 6.28, 12.1, 0.92, GREENBG, GREEN)
text(s, 0.92, 6.44, 11.5, 0.24, "ONE RULE FOR THE WHOLE PROGRAMME", 9.5, GREEN, bold=True)
text(s, 0.92, 6.72, 11.5, 0.32, "Ask in the channel, not in a DM. Every question one person has, four people have — "
     "and the channel is the record we keep.", 12, INK)

# ══════════════════════════════════════ SESSION 1 ══════════════════════════════════════
s = S(DARK)
section(s, "session 1", "Foundations", "What it is, where the data comes from, who sees what, and how to read today",
        [("M1", "Why this exists — the four blind spots that cost us", "20 min"),
         ("M2", "Architecture & the data pipeline", "15 min"),
         ("M3", "Access, roles & PII  + LAB 1 (sign-in) + LAB 2 (permissions)", "40 min"),
         ("M4", "Dashboard anatomy  + LAB 3", "35 min"),
         ("M5", "Order status flow  + LAB 4", "25 min"),
         ("", "LIVE POLL 1", "10 min")])

# ─────────── M1 · blind spots ───────────
s = S()
head(s, "module 1", "Four blind spots that cost us real money",
     "Every one of these was real. Every one looked healthy on a dashboard at the time.", badge="M1")
items = [("A gateway died behind failover", "UPG stopped taking payments. Traffic auto-failed-over to HyperPay, so the blended success rate stayed green.", "34 min blind", RED, REDBG),
         ("Charged, never activated", "The gateway captured the money; the confirmation never arrived. Counted as neither success nor failure.", "silently invisible", RED, REDBG),
         ("Charged twice", "One order, two captures at the gateway. Only provable by reconciling with the provider.", "refund + complaint", AMBER, AMBERBG),
         ("A provider that flaps", "Semati fails ~55% on a NORMAL day. A flat threshold screams constantly or never fires.", "alert fatigue", AMBER, AMBERBG)]
for i, (t, b, tag, c, bgc) in enumerate(items):
    x = 0.62 + (i % 2) * 6.2; y = 2.15 + (i // 2) * 2.1
    box(s, x, y, 5.9, 1.88, bgc, c)
    text(s, x + 0.28, y + 0.24, 4.2, 0.3, t, 13.5, INK, bold=True)
    box(s, x + 4.35, y + 0.2, 1.35, 0.32, WHITE, c)
    text(s, x + 4.35, y + 0.27, 1.35, 0.22, tag, 8.5, c, bold=True, align=PP_ALIGN.CENTER)
    text(s, x + 0.28, y + 0.68, 5.35, 1.05, b, 11, BODY, spacing=1.22)
callout(s, 0.62, 6.42, 12.1, 0.82, "the common thread",
        "In every case the AGGREGATE looked fine. The failure was only visible when you split the number — "
        "by gateway, by state, by provider. That is the habit this workshop builds.", "key", 11.5)

# ─────────── M2 · architecture diagram ───────────
s = S()
head(s, "module 2", "Architecture — where every number comes from",
     "Follow one payment from production to your screen.", badge="M2")
n_prod = node(s, 0.62, 2.35, 2.25, 1.0, "PRODUCTION", "172.31.43.123", WHITE, RED, 11, 8.5)
n_repl = node(s, 3.55, 2.35, 2.25, 1.0, "salam_replica", "172.31.15.121", WHITE, BLUE, 11, 8.5)
n_cons = node(s, 6.48, 2.35, 2.25, 1.0, "mvno_console", "rules · alerts · audit", WHITE, PURPLE, 11, 8.5)
n_app  = node(s, 9.41, 2.35, 2.25, 1.0, "Console app", "152 : 4600 · PM2", WHITE, GREEN, 11, 8.5)
arrow_r(s, n_prod, n_repl, BLUE, 2.0); edge_label(s, 2.72, 2.05, 1.9, "read-only · every 5 min", BLUE)
arrow_r(s, n_repl, n_cons, FAINT); arrow_r(s, n_cons, n_app, FAINT)
n_user = node(s, 9.41, 4.35, 2.25, 0.8, "You", "salam.sa/digital-console", WHITE, GREEN, 11, 8)
arrow_d(s, n_app, n_user, GREEN)
box(s, 0.62, 4.35, 8.15, 0.8, AMBERBG, AMBER)
text(s, 0.88, 4.52, 7.7, 0.5, "⚠  The prod connection is forced  default_transaction_read_only = on  — the console can NEVER write to production.",
     11.5, INK, spacing=1.15)
facts = [("Why a replica?", "Dashboards and alert scans are heavy repetitive queries. Running them on the DB that serves customers is the load you least want."),
         ("Why 5 minutes?", "A deliberate trade. For anything where seconds matter, the alerting path pages you — you don't watch a dashboard."),
         ("What if it stalls?", "A banner says the figures are NOT live. Stale data outranks every other status on the page.")]
for i, (t, b) in enumerate(facts):
    x = 0.62 + i * 4.06
    box(s, x, 5.45, 3.85, 1.35)
    rule(s, x + 0.26, 5.65, 0.35, GREEN, 0.025)
    text(s, x + 0.26, 5.85, 3.35, 0.25, t, 11.5, INK, bold=True)
    text(s, x + 0.26, 6.14, 3.4, 0.6, b, 9.5, BODY, spacing=1.18)

# ─────────── M2b · sync pipeline detail ───────────
s = S()
head(s, "module 2 · detail", "The sync pipeline, and how it protects production",
     "Two independent mechanisms keep the data fresh without ever loading prod.", badge="M2")
lane(s, 0.62, 2.2, 12.1, 1.75, "in-app scheduler")
a = node(s, 1.9, 2.55, 1.95, 0.95, "every 5 min", "prodSyncScheduler", WHITE, BLUE, 10, 8)
b = node(s, 4.35, 2.55, 1.95, 0.95, "watermark", "per table", WHITE, BLUE, 10, 8)
c = node(s, 6.8, 2.55, 1.95, 0.95, "batch pull", "10k rows + sleep", WHITE, BLUE, 10, 8)
d = node(s, 9.25, 2.55, 1.95, 0.95, "upsert", "idempotent", WHITE, BLUE, 10, 8)
arrow_r(s, a, b); arrow_r(s, b, c); arrow_r(s, c, d)
lane(s, 0.62, 4.15, 12.1, 1.75, "cron watchdog (belt & braces)", RGBColor(0xFA,0xFA,0xFF))
e = node(s, 1.9, 4.5, 1.95, 0.95, "measure lag", "2 indexed reads", WHITE, PURPLE, 10, 8)
f = node(s, 4.35, 4.5, 1.95, 0.95, "< 10 min?", "exit, do nothing", WHITE, GREEN, 10, 8)
g = node(s, 6.8, 1.0 + 3.5, 1.95, 0.95, "sync + verify", "retry ×3, backoff", WHITE, AMBER, 10, 8)
h = node(s, 9.25, 4.5, 1.95, 0.95, "self-heal", "windowed re-pull", WHITE, AMBER, 10, 8)
arrow_r(s, e, f); arrow_r(s, f, g); arrow_r(s, g, h)
edge_label(s, 3.85, 5.55, 1.0, "healthy", GREEN); edge_label(s, 6.3, 5.55, 1.0, "behind", AMBER)
callout(s, 0.62, 6.1, 5.9, 1.05, "why measure first",
        "On a healthy system the watchdog does NOTHING — it exits after two cheap reads. Prod sees no extra load.", "key")
callout(s, 6.85, 6.1, 5.85, 1.05, "self-heal",
        "A wedged cursor won't fix itself by re-running the same delta — so it forces an explicit windowed re-pull.", "info")

# ─────────── M3 · roles matrix ───────────
s = S()
head(s, "module 3", "Access, roles & PII — least privilege enforced in code",
     "Your role decides which pages EXIST for you. Not a policy — the page simply doesn't render.", badge="M3")
rows = [["Role", "Troubleshoot", "Analytics", "Settings", "Edit rules", "Unmask PII", "Users"],
        ["Super Admin", "✓", "✓", "✓", "✓", "✓", "✓"],
        ["L3 Digital", "✓", "✓", "✓", "✓", "✓", "—"],
        ["L2 Digital / BSS", "✓", "✓", "—", "✓", "—", "—"],
        ["L1 Digital / BSS", "✓", "✓", "—", "—", "—", "—"],
        ["Report Manager", "—", "✓", "—", "—", "—", "—"],
        ["Errors Manager", "✓", "—", "—", "✓", "—", "—"]]
cols = {}
for r in range(1, 7):
    for c in range(1, 7):
        cols[(r, c)] = GREEN if rows[r][c] == "✓" else FAINT
table(s, 0.62, 2.2, 8.0, rows, [2.0, 1.3, 1.1, 1.0, 1.1, 1.1, 0.4], rowh=0.42, colors=cols, size=10.5)
callout(s, 8.85, 2.2, 3.87, 1.85, "the PII rule",
        "Only Super Admin and L3 Digital can unmask customer data — and every unmask is written to the "
        "audit log with your name on it.", "stop")
callout(s, 8.85, 4.25, 3.87, 1.6, "multi-role users",
        "Union of views, OR of capabilities, labelled by the highest-ranked role.", "info")
text(s, 0.62, 5.1, 8.0, 0.6,
     "Escalation ladder — P1: L1 Digital (0) → L2 Digital (+10) → L3 Digital (+25)   ·   stops the moment someone acknowledges",
     11, BODY, spacing=1.2)
callout(s, 0.62, 5.9, 12.1, 0.95, "try it now",
        "Compare your visible tabs with the person next to you. Different? That's the model working. "
        "Ask the Report Manager to open Troubleshoot — the tab isn't there at all.", "key", 11.5)

# ─────────── LAB 1 ───────────
s = S()
labhead(s, "1", "Sign in & discover your own permissions", "25 min")
text(s, 0.62, 1.35, 6.0, 0.25, "STEPS", 9.5, GREEN, bold=True)
for i, st in enumerate(["Open https://salam.sa/digital-console/",
                        "Enter your @salam.sa email → Send code",
                        "Enter the 6-digit code (check junk, or I'll read it out)",
                        "Look top-right: your name + role. Say your role aloud",
                        "Write down which top-nav tabs you can see",
                        "Compare with your neighbour — same tabs?",
                        "Open Troubleshoot (if you have it). Is the mobile number masked?",
                        "Try ⚙ Settings. Can you?"]):
    text(s, 0.62, 1.65 + i * 0.44, 6.1, 0.4, f"{i+1}.  {st}", 11.5, BODY)
callout(s, 6.95, 1.35, 5.75, 1.9, "expected result — say this sentence out loud",
        "“I am a ________.  I can see ________.  I cannot ________.\nCustomer numbers appear ________ to me.”", "key", 12)
callout(s, 6.95, 3.45, 5.75, 1.55, "if you can't get in",
        "“No console account” → not created yet, tell me.\n“Use a @salam.sa email” → personal address, by design.\n"
        "Code invalid → expired after 10 min, request another.", "warn", 10.5)
callout(s, 6.95, 5.2, 5.75, 1.5, "facilitator demo",
        "L1 and L3 open the SAME row side by side. L1 sees 05••••••89. L3 clicks Unmask. Then open "
        "⚙ → Audit log and watch the entry appear with the L3's name.", "note", 10.5)

# ─────────── M4 · dashboard anatomy ───────────
s = S()
head(s, "module 4", "Dashboard anatomy — reading it correctly",
     "One screen that answers: is today normal, and if not, where?", badge="M4")
parts = [("① NOC banner", "Plain-English headline of the worst thing happening right now. Green / amber / red."),
         ("② Journey health", "8 tiles — Onboarding · Eligibility · Identity · Payments · Activation · Delivery · Change Plan · Ownership."),
         ("③ KPI strip", "8 cards, each with a sparkline, a vs-previous delta and n= sample size. Coloured against the SLA TARGET, not zero."),
         ("④ Range controls", "Today · Yesterday · 7d · 30d, plus intra-day (last 1/3/6/12/24h, same-day KSA)."),
         ("⑤ Order status flow", "19 nodes across 3 stages, clickable down to the orders behind each box."),
         ("⑥ Staleness banner", "Appears when data is behind. Outranks everything — figures are NOT live.")]
for i, (t, b) in enumerate(parts):
    y = 2.1 + i * 0.79
    box(s, 0.62, y, 6.1, 0.68)
    text(s, 0.85, y + 0.1, 1.75, 0.24, t, 11, GREEN, bold=True)
    text(s, 2.55, y + 0.1, 4.0, 0.5, b, 9.5, BODY, spacing=1.15)
PIC(s, "d1-dashboard", "Dashboard · full page", x=6.95, y=2.1, w=5.75, h=3.55)
callout(s, 6.95, 5.8, 5.75, 1.0, "before you quote any number",
        "Check for the staleness banner. If it's there, say so before repeating the figure to anyone.", "warn")

# ─────────── M5 · order flow tree ───────────
s = S()
head(s, "module 5", "Order status flow — where orders actually stop",
     "Three stages, two lanes, 19 clickable nodes. Every box lists the exact orders behind it.", badge="M5")
stages = [("① ONBOARDING", "BSS + GOV", 0.62, GREENBG, GREEN), ("② PAYMENTS", "gateway", 4.9, BLUEBG, BLUE),
          ("③ ACTIVATION & DELIVERY", "BSS + courier", 9.18, PURPBG, PURPLE)]
for t, sub, x, bgc, c in stages:
    box(s, x, 2.1, 3.55, 3.7, bgc, c)
    text(s, x + 0.2, 2.28, 3.1, 0.24, t, 10.5, c, bold=True)
    text(s, x + 0.2, 2.52, 3.1, 0.2, sub, 8.5, MUTED)
o  = node(s, 0.95, 3.1, 1.35, 0.62, "Orders", None, WHITE, GREEN, 10)
ep = node(s, 2.75, 2.85, 1.25, 0.55, "Elig. pass", None, WHITE, GREEN, 9)
ef = node(s, 2.75, 3.55, 1.25, 0.55, "Elig. fail", None, REDBG, RED, 9)
arrow_r(s, o, ep, GREEN); arrow_r(s, o, ef, RED)
tp = node(s, 5.2, 3.1, 1.25, 0.62, "Total pay", None, WHITE, BLUE, 9)
sp = node(s, 6.85, 2.6, 1.35, 0.55, "Success", None, GREENBG, GREEN, 9)
pp = node(s, 6.85, 3.3, 1.35, 0.55, "Pending", None, AMBERBG, AMBER, 9)
fp = node(s, 6.85, 4.0, 1.35, 0.55, "Fail", None, REDBG, RED, 9)
arrow_r(s, ep, tp, GREEN); arrow_r(s, tp, sp, GREEN); arrow_r(s, tp, pp, AMBER); arrow_r(s, tp, fp, RED)
es = node(s, 9.5, 2.6, 1.3, 0.55, "eSIM", None, WHITE, PURPLE, 9)
ps = node(s, 9.5, 3.4, 1.3, 0.55, "Physical", None, WHITE, PURPLE, 9)
ac = node(s, 11.25, 2.6, 1.25, 0.55, "Activated", None, GREENBG, GREEN, 9)
na = node(s, 11.25, 3.4, 1.25, 0.55, "Not act.", None, REDBG, RED, 9)
dl = node(s, 9.5, 4.2, 1.3, 0.55, "Delivered", None, WHITE, PURPLE, 9)
arrow_r(s, sp, es, GREEN); arrow_r(s, es, ac, GREEN); arrow_r(s, ps, na, RED); arrow_r(s, ps, dl, PURPLE)
box(s, 0.62, 6.0, 6.1, 1.15, GREENBG, GREEN)
text(s, 0.88, 6.2, 5.6, 0.25, "WHAT TO LOOK FOR", 9.5, GREEN, bold=True)
text(s, 0.88, 6.48, 5.6, 0.55, "The biggest DROP between two adjacent boxes is where your customers are being lost today.", 11, INK, spacing=1.2)
callout(s, 6.95, 6.0, 5.75, 1.15, "two lanes",
        "New SIM and MNP are shown separately — port-ins fail for different reasons than new lines.", "info")

# ─────────── POLL 1 ───────────
poll("1", "Where does the console read its data from — and can it write to production?",
     ["Production directly — and yes, it can refund payments",
      "A replica synced from prod — and no, it is read-only against production",
      "A nightly CSV export — no writes possible",
      "The BSS directly — writes allowed for admins"], 1,
     "The console reads a replica synced every ~5 minutes. The production connection is forced "
     "default_transaction_read_only = on, so it CANNOT write — by construction, not by policy.",
     "Heavy dashboard and alert queries never touch the database that serves your customers.")

# ══════════════════════════════════════ SESSION 2 ══════════════════════════════════════
s = S(DARK)
section(s, "session 2", "Troubleshooting", "From a customer complaint to a named root cause — with the screens that get you there",
        [("M6", "Troubleshoot & the 10 categories  + LAB 5", "35 min"),
         ("M7", "Payment forensics — failed vs stuck vs abandoned  + LAB 6", "40 min"),
         ("M8", "The failover trap — INC0014859 dissected", "20 min"),
         ("M9", "Timeline & Subscriber 360  + LAB 7", "25 min"),
         ("M10", "BSS read-path faults (OSB 1500)", "15 min"),
         ("", "LIVE POLL 2", "10 min")])

# ─────────── M6 · troubleshoot categories ───────────
s = S()
head(s, "module 6", "Troubleshoot — 10 categories, each with an owner",
     "Live failures grouped by category and owning team. Where an L1 spends most of the day.", badge="M6")
cats = [("Payment / gateway", "Digital Ops"), ("Payment stuck (unconfirmed)", "Digital Ops"),
        ("Payment duplicate (suspected)", "Digital Ops"), ("Change Ownership", "Digital Ops"),
        ("Activation (BSS)", "Digital Ops"), ("Semati / MSISDN provisioning", "Digital Ops"),
        ("Nafath / identity", "Digital Ops"), ("Eligibility", "Sales Ops"),
        ("Change Plan", "Digital Ops"), ("Delivery", "Digital Ops")]
for i, (c_, team) in enumerate(cats):
    x = 0.62 + (i % 2) * 3.3; y = 2.15 + (i // 2) * 0.62
    box(s, x, y, 3.1, 0.52)
    text(s, x + 0.18, y + 0.09, 2.3, 0.34, c_, 9.5, INK, bold=True, spacing=1.05)
    text(s, x + 0.18, y + 0.3, 2.7, 0.2, team, 8, MUTED)
box(s, 7.3, 2.15, 5.42, 3.1, PANEL, LINE)
text(s, 7.55, 2.35, 4.9, 0.25, "SEARCH ACCEPTS", 9.5, GREEN, bold=True)
for i, k in enumerate(["mobile number", "order id", "ICCID", "national ID"]):
    text(s, 7.55, 2.65 + i * 0.3, 4.9, 0.26, "•  " + k, 11, BODY)
text(s, 7.55, 4.0, 4.9, 0.25, "CODE · MESSAGE DRILL-DOWN", 9.5, GREEN, bold=True)
for i, k in enumerate(["Semati — responseCode · message", "Nafath — status · message",
                       "Payment — gateway code · message", "Activation — status_code × api",
                       "Delivery — reason · state"]):
    text(s, 7.55, 4.3 + i * 0.24, 4.9, 0.22, "•  " + k, 9.5, BODY)
callout(s, 0.62, 5.35, 6.4, 1.35, "built-in reference cards — no separate wiki",
        "Payments (gateway map + customer wording) · BSS/Semati status codes · Nafath service types. "
        "Each card includes what to SAY to the customer.", "key")
callout(s, 7.3, 5.35, 5.42, 1.35, "everything is filterable & exportable",
        "Team · category · time range · gateway chips · code chips. Any view exports to CSV or JSON.", "info")

# ─────────── M7 · the three payment states (the key module) ───────────
s = S()
head(s, "module 7  ·  the single most important idea in this workshop",
     "Failed vs Stuck vs Abandoned", "Three states that look almost identical and mean completely different things.", badge="M7")
n_start = node(s, 0.62, 2.6, 1.6, 0.75, "Customer", "hits pay page", WHITE, BLUE, 10, 8)
n_gw    = node(s, 2.85, 2.6, 1.9, 0.75, "Gateway called?", None, WHITE, BLUE, 10)
arrow_r(s, n_start, n_gw, BLUE)
n_ab = node(s, 5.4, 1.65, 2.5, 0.85, "ABANDONED", "pending · NO commit", GREENBG, GREEN, 11, 8.5, GREEN)
n_ok = node(s, 5.4, 2.72, 2.5, 0.85, "SUCCESS", "money taken, order flows", GREENBG, GREEN, 11, 8.5, GREEN)
n_fl = node(s, 5.4, 3.79, 2.5, 0.85, "FAILED", "declined by bank/gw", REDBG, RED, 11, 8.5, RED)
n_st = node(s, 5.4, 4.86, 2.5, 0.85, "STUCK", "pending + commit >30m", AMBERBG, AMBER, 11, 8.5, AMBER)
for n, c, lbl in [(n_ab, GREEN, "never finished"), (n_ok, GREEN, "confirmed"), (n_fl, RED, "declined"), (n_st, AMBER, "gateway answered,\nwe never confirmed")]:
    arrow(s, 4.8, 2.98, n[0] - 0.06, n[1] + n[3] / 2, c, 1.5)
acts = [(n_ab, "Not an incident. Help them retry.", GREEN),
        (n_ok, "Nothing to do.", GREEN),
        (n_fl, "Read the decline code → cheat-sheet wording. Customer can retry.", RED),
        (n_st, "ESCALATE to L2 with payment_reference_id. Customer may be charged.", AMBER)]
for n, a, c in acts:
    box(s, 8.2, n[1], 4.52, 0.85, WHITE, c)
    text(s, 8.42, n[1] + 0.16, 4.1, 0.55, a, 10, INK, spacing=1.18)
callout(s, 0.62, 5.95, 12.1, 1.3, "the one field that decides it — payment_commit_response",
        "Did the gateway ever answer?  YES → money may have moved → STUCK, escalate.   "
        "NO → the customer simply never finished → ABANDONED, not an incident.\n"
        "Get this wrong and you refund people who never paid, or strand people who were charged.", "stop", 11.5)

# ─────────── M7b · the historical bug ───────────
s = S()
head(s, "module 7 · why this was invisible before", "The denominator bug",
     "A single line of SQL logic hid thousands of charged-but-unactivated customers.", badge="M7")
box(s, 0.62, 2.2, 5.9, 2.3, REDBG, RED)
text(s, 0.9, 2.42, 5.3, 0.25, "THE OLD METRIC", 10, RED, bold=True)
code(s, 0.9, 2.72, 5.35, 0.95, "payment_failure_rate =\n   failed / (success + failed)", 11, WHITE, RGBColor(0x7F,0x1D,0x1D))
text(s, 0.9, 3.82, 5.3, 0.55, "pending / initiated were excluded from the denominator entirely.", 11, INK, spacing=1.2)
box(s, 6.85, 2.2, 5.85, 2.3, AMBERBG, AMBER)
text(s, 7.13, 2.42, 5.3, 0.25, "THE CONSEQUENCE", 10, AMBER, bold=True)
text(s, 7.13, 2.75, 5.35, 1.6,
     "A payment the gateway CAPTURED but our app never confirmed was counted as:\n\n"
     "•  not a success\n•  not a failure\n\n…so it appeared in no rate, no chart, no alert.", 11, INK, spacing=1.25)
callout(s, 0.62, 4.75, 12.1, 0.95, "the fix",
        "Two new metrics (payment_stuck_initiated, payment_duplicate_suspect), three new rules, and two dedicated "
        "Troubleshoot tiles listing the payment_reference_ids so an agent can act on a specific case.", "key", 11.5)
callout(s, 0.62, 5.9, 12.1, 1.1, "then refined again — because the first fix over-counted",
        "The stuck definition originally counted every pending row, which swept in ordinary abandonment (473 “stuck” "
        "payments that weren't stuck at all). Requiring a real commit response separated the two. "
        "Lesson: a metric is a hypothesis — keep testing it against reality.", "note", 11)

# ─────────── LAB 6 ───────────
s = S()
labhead(s, "6", "Payment forensics  ·  Scenario A + B", "30 min")
text(s, 0.62, 1.3, 6.1, 0.25, "PART 1 — find the customer", 9.5, GREEN, bold=True)
for i, st in enumerate(["Troubleshoot → search the number I give you",
                        "Did a payment exist? What status?",
                        "If failed — what is the decline code and message?",
                        "Expand the row → read the timeline",
                        "Verdict: failed, stuck or abandoned? Justify it"]):
    text(s, 0.62, 1.6 + i * 0.4, 6.1, 0.36, f"{i+1}.  {st}", 11, BODY)
text(s, 0.62, 3.75, 6.1, 0.25, "PART 2 — the duplicate tile", 9.5, GREEN, bold=True)
for i, st in enumerate(["Open “Payment duplicate (suspected)”",
                        "Why does it say SUSPECTED and not confirmed?",
                        "What would you need to confirm it?",
                        "What can you promise the customer right now?"]):
    text(s, 0.62, 4.05 + i * 0.4, 6.1, 0.36, f"{i+1}.  {st}", 11, BODY)
callout(s, 6.95, 1.3, 5.75, 1.75, "expected result",
        "A verdict you can defend, plus the exact sentence you'd say to the customer — taken from the cheat-sheet.", "key")
callout(s, 6.95, 3.2, 5.75, 1.75, "the honest answer on duplicates",
        "“Suspected” because the app database cannot see the gateway's second capture. Only reconciliation "
        "against Tap/UPG confirms it. Never promise a refund from this screen alone.", "warn", 10.5)
callout(s, 6.95, 5.1, 5.75, 1.6, "if “not found”",
        "Usually means no failures for that number — which is good news, say so. Or try the last 9 digits.", "info", 10.5)

# ─────────── M8 · failover trap ───────────
s = S()
head(s, "module 8", "The failover trap — INC0014859 dissected",
     "How a dead gateway hid behind a healthy-looking average for 34 minutes.", badge="M8")
timeline(s, 1.1, 2.75, 11.1, [
    (0.0, "09:09", "last UPG success"),
    (0.28, "09:10–09:43", "UPG at zero · HyperPay absorbs"),
    (0.62, "09:43", "L1 notices — via a customer"),
    (1.0, "today", "watchdog fires in ≤30 min")], BLUE)
box(s, 0.62, 3.7, 5.9, 1.55, REDBG, RED)
text(s, 0.9, 3.9, 5.3, 0.25, "WHAT THE DASHBOARD SHOWED", 10, RED, bold=True)
text(s, 0.9, 4.2, 5.35, 0.95, "Payment success 84%  ✓\nNo alert firing\nNo complaints yet\n…while UPG had taken ZERO payments.", 11, INK, spacing=1.25)
box(s, 6.85, 3.7, 5.85, 1.55, GREENBG, GREEN)
text(s, 7.13, 3.9, 5.3, 0.25, "WHY THE AVERAGE LIED", 10, GREEN, bold=True)
text(s, 7.13, 4.2, 5.35, 0.95, "Traffic auto-failed-over to HyperPay.\nThe successes were real — they just all came from a different gateway.", 11, INK, spacing=1.25)
box(s, 0.62, 5.45, 12.1, 0.62, PANEL, LINE)
text(s, 0.88, 5.6, 11.6, 0.35, "BLENDED VIEW:   UPG 0%  +  HyperPay 96%   →   reported 84%  ✓ “healthy”", 12, INK, bold=True, font=MONO)
callout(s, 0.62, 6.25, 12.1, 0.95, "the fix — and the habit worth more than the fix",
        "Per-gateway zero-success watchdogs (UPG P1 · HyperPay P2 · Tap P2). The habit: whenever you see an average, "
        "ask “averaged over WHAT?” — then split it by that dimension.", "key", 11.5)

# ─────────── M10 · OSB read path ───────────
s = S()
head(s, "module 10", "The faults that live in another database",
     "BSS read-path SOAP faults (1500 / OSB-382000) — invisible to every write-path dashboard.", badge="M10")
w1 = node(s, 0.62, 2.4, 2.3, 0.9, "WRITE path", "create subscriber", GREENBG, GREEN, 11, 8.5, GREEN)
w2 = node(s, 3.3, 2.4, 2.3, 0.9, "status 00 ✓", "activation OK", WHITE, GREEN, 11, 8.5)
arrow_r(s, w1, w2, GREEN)
r1 = node(s, 0.62, 3.75, 2.3, 0.9, "READ path", "list-invoices, get-sub", REDBG, RED, 11, 8.5, RED)
r2 = node(s, 3.3, 3.75, 2.3, 0.9, "1500 fault", "100–200 / min", REDBG, RED, 11, 8.5, RED)
arrow_r(s, r1, r2, RED)
n_cust = node(s, 6.2, 3.05, 2.6, 1.1, "Customer sees", "“plans not loading”\ngreyed balance transfer", AMBERBG, AMBER, 11, 8.5)
arrow_r(s, r2, n_cust, RED)
n_db = node(s, 9.5, 3.05, 3.22, 1.1, "logs.uil_logs  (MySQL)", "a SEPARATE database\nnot in our replica", WHITE, PURPLE, 11, 8.5)
arrow_r(s, n_cust, n_db, FAINT, dashed=True)
callout(s, 0.62, 5.15, 5.9, 1.05, "why nobody saw it",
        "Writes succeeded, so activation dashboards stayed green. The faults were logged in a database "
        "the console doesn't replicate.", "warn")
callout(s, 6.85, 5.15, 5.85, 1.05, "what we did",
        "Read logs.uil_logs directly: live fault totals, per-minute frequency, top failing APIs — plus a P1 "
        "watcher when it spikes.", "key")
text(s, 0.62, 6.45, 12.1, 0.5,
     "Lesson: “the dashboard is green” only means the things we measure are green. Always ask what ISN'T instrumented.",
     12, GREEN, bold=True)

# ─────────── POLL 2 ───────────
poll("2", "A payment is pending, 45 minutes old, WITH a gateway commit response. What is it?",
     ["Abandoned — the customer never finished. Help them retry",
      "Stuck — the gateway answered but we never confirmed. Escalate with the reference id",
      "A duplicate charge — refund immediately",
      "Normal — pending payments always take an hour"], 1,
     "A commit response means the gateway ANSWERED — money may have moved. The app never finalised it, so the "
     "customer may be charged while their order shows unpaid. That is an escalation, with the payment_reference_id.",
     "No commit response = abandoned = not an incident. One field separates a refund case from a retry.")

# ══════════════════════════════════════ SESSION 3 ══════════════════════════════════════
s = S(DARK)
section(s, "session 3", "Alerting & Response", "How the console watches, why it stays quiet, and what to do when it isn't",
        [("M11", "Alerts, metrics & the golden rule", "20 min"),
         ("M12", "Correlation & suppression — one page, not ten", "15 min"),
         ("M13", "Escalation & guided response  + LAB 8 (run an incident)", "40 min"),
         ("M14", "SLA targets & error budget", "15 min"),
         ("M15", "Anomaly detection vs seasonal baseline", "15 min"),
         ("", "LIVE POLL 3", "10 min")])

# ─────────── M11 · golden rule ───────────
s = S()
head(s, "module 11", "Alerts — 38 rules over 28 metrics, one golden rule",
     "The console watches continuously so that nobody has to stare at a dashboard.", badge="M11")
box(s, 0.62, 2.1, 12.1, 1.0, GREENBG, GREEN)
text(s, 0.95, 2.3, 11.5, 0.4, "“An alert fires on CHANGE FROM NORMAL — not on the normal baseline.”", 17, GREEN, bold=True)
text(s, 0.95, 2.74, 11.5, 0.28, "The steady state lives on the SLA page. The Alerts page is for things that JUST GOT WORSE.", 11.5, BODY)
box(s, 0.62, 3.35, 5.9, 2.15, REDBG, RED)
text(s, 0.9, 3.55, 5.3, 0.25, "NAIVE THRESHOLD", 10, RED, bold=True)
text(s, 0.9, 3.88, 5.35, 1.45,
     "Semati fails ~55% on a normal day.\n\nAlert at >10%  →  fires every single day, all day.\nAlert at >90%  →  never fires, even during an outage.\n\nBoth are useless.", 11, INK, spacing=1.25)
box(s, 6.85, 3.35, 5.85, 2.15, GREENBG, GREEN)
text(s, 7.13, 3.55, 5.3, 0.25, "WHAT WE DO INSTEAD", 10, GREEN, bold=True)
text(s, 7.13, 3.88, 5.35, 1.45,
     "Thresholds tuned ABOVE the observed baseline\n+ a minimum sample gate\n+ a window that matches the failure shape\n"
     "+ flapping detection (ok→fail transitions)\n+ a zero-success watchdog for hard outages.", 11, INK, spacing=1.25)
parts = [("Window", "how long the condition must hold"), ("Min sample", "stops a quiet hour firing on 3 events"),
         ("Severity", "P1 pages, P2 notifies, P3 logs"), ("Runbook", "the steps, attached to the alert itself")]
for i, (t, b) in enumerate(parts):
    x = 0.62 + i * 3.06
    box(s, x, 5.7, 2.85, 1.05)
    text(s, x + 0.22, 5.88, 2.4, 0.24, t, 11, GREEN, bold=True)
    text(s, x + 0.22, 6.16, 2.45, 0.5, b, 9.5, BODY, spacing=1.15)

# ─────────── M12 · correlation tree ───────────
s = S()
head(s, "module 12", "Correlation — one page instead of ten",
     "A provider outage doesn't fire one alert. It fires everything downstream. So we group them.", badge="M12")
root = node(s, 4.8, 2.25, 3.6, 0.95, "Semati provider unreachable", "P1  ·  ROOT CAUSE", REDBG, RED, 12, 9, RED)
syms = ["Activation failures", "Eligibility denials", "MNP port-ins failing", "Change plan errors",
        "Onboarding drop", "SIM swap failures"]
for i, sm in enumerate(syms):
    x = 0.62 + (i % 3) * 4.28; y = 4.05 + (i // 3) * 1.0
    n = node(s, x, y, 3.95, 0.72, sm, "suppressed", RGBColor(0xF8,0xFA,0xFC), LINE, 10, 8, MUTED)
    arrow(s, 6.6, 3.28, x + 1.97, y - 0.05, FAINT, 1.1, dashed=True)
callout(s, 0.62, 6.15, 5.9, 1.05, "without correlation",
        "Ten pages at 03:00. People start ignoring alerts — and then miss the real one.", "stop")
callout(s, 6.85, 6.15, 5.85, 1.05, "with correlation",
        "One page naming the root cause, with the blast radius printed on it. Symptoms grouped underneath.", "key")

# ─────────── M13 · escalation ladder ───────────
s = S()
head(s, "module 13", "Escalation & guided response",
     "The runbook travels with the alert. The ladder climbs until someone acknowledges.", badge="M13")
text(s, 0.62, 2.15, 6.1, 0.25, "P1 LADDER", 10, RED, bold=True)
timeline(s, 1.2, 2.9, 5.2, [(0.0, "0 min", "L1 Digital"), (0.45, "+10", "L2 Digital"), (1.0, "+25", "L3 Digital")], RED, above=False)
text(s, 0.62, 3.85, 6.1, 0.25, "P2 LADDER", 10, AMBER, bold=True)
timeline(s, 1.2, 4.6, 5.2, [(0.0, "0 min", "L1 BSS"), (0.45, "+20", "L2 BSS"), (1.0, "+45", "L2 Digital")], AMBER, above=False)
box(s, 0.62, 5.5, 6.1, 1.25, GREENBG, GREEN)
text(s, 0.88, 5.7, 5.6, 0.25, "ACK STOPS THE LADDER", 10, GREEN, bold=True)
text(s, 0.88, 5.98, 5.6, 0.6, "Acknowledging is not paperwork. It's how you stop the next person's phone from ringing.", 11, INK, spacing=1.2)
text(s, 7.05, 2.15, 5.7, 0.25, "WHAT EVERY INCIDENT CARRIES", 10, GREEN, bold=True)
for i, (t, b) in enumerate([("Runbook steps", "written per rule — no wiki hunt at 3am"),
                            ("Blast radius", "what else this blocks, printed on the incident"),
                            ("Related tickets", "ServiceNow incidents customers already raised"),
                            ("Metric + threshold", "the number that fired it, vs the line"),
                            ("Actions", "ack · assign · snooze · resolve · comment")]):
    y = 2.5 + i * 0.72
    box(s, 7.05, y, 5.67, 0.62)
    text(s, 7.28, y + 0.09, 2.0, 0.24, t, 10.5, GREEN, bold=True)
    text(s, 9.35, y + 0.09, 3.2, 0.44, b, 9.5, BODY, spacing=1.12)
callout(s, 7.05, 6.15, 5.67, 1.05, "if a runbook step is wrong",
        "That's a bug in the RULE, not something to work around. L2+ can edit it — fix it while it's fresh.", "info")

# ─────────── LAB 8 ───────────
s = S()
labhead(s, "8", "Run an incident end to end  ·  Scenario D", "25 min · role-play")
roles = [("L1 — first responder", "Opens it, reads the runbook, acknowledges, states blast radius, hands over"),
         ("L2 — escalation", "Checks correlation (root or symptom?), related tickets, decides resolve or hold"),
         ("Manager", "Asks the awkward question: “is this affecting customers right now, and how many?”"),
         ("Everyone else", "Observes, then critiques the handover against the checklist")]
for i, (r, d) in enumerate(roles):
    y = 1.35 + i * 0.78
    box(s, 0.62, y, 6.1, 0.68)
    text(s, 0.85, y + 0.1, 5.6, 0.24, r, 11, GREEN, bold=True)
    text(s, 0.85, y + 0.36, 5.6, 0.28, d, 9.5, BODY)
text(s, 0.62, 4.6, 6.1, 0.25, "THE 9 STEPS", 9.5, GREEN, bold=True)
text(s, 0.62, 4.88, 6.1, 1.9,
     "1. Open it — read headline + severity aloud\n2. Read the runbook. Do step 1\n3. Acknowledge — say why\n"
     "4. State the blast radius\n5. Hand over to L2 (see criteria →)\n6. L2: check correlation\n"
     "7. L2: check related tickets\n8. Answer the manager with DATA\n9. Resolve, or comment what we're waiting on",
     10.5, BODY, spacing=1.25)
callout(s, 6.95, 1.35, 5.75, 2.2, "a good handover names three things",
        "1. The RULE that fired\n2. The NUMBER vs its threshold\n3. What you ALREADY CHECKED\n\n"
        "“Payments are broken” is not a handover.", "key", 11.5)
callout(s, 6.95, 3.7, 5.75, 1.7, "critique checklist",
        "☐ acked promptly   ☐ runbook actually read\n☐ handover named rule + numbers\n☐ blast radius quoted, not guessed\n"
        "☐ correlation checked   ☐ decision recorded", "info", 10.5)
callout(s, 6.95, 5.55, 5.75, 1.15, "if nothing is open",
        "Use Alerts → History and replay a past incident. The muscle memory is the same.", "warn", 10.5)

# ─────────── M14 · SLA & error budget ───────────
s = S()
head(s, "module 14", "SLA targets & error budget — the steady-state scoreboard",
     "Alerts tell you what just broke. SLA tells you whether you're keeping your promises.", badge="M14")
rows = [["Journey", "Target", "Window"],
        ["Payment success", "95%", "7 days"], ["Activation (BSS)", "98%", "30 days"],
        ["Semati provisioning", "97%", "30 days"], ["Nafath completion", "90%", "7 days"],
        ["Eligibility approval", "90%", "30 days"], ["Delivery success", "95%", "30 days"],
        ["Change Plan success", "97%", "30 days"]]
table(s, 0.62, 2.15, 5.5, rows, [2.9, 1.3, 1.3], rowh=0.38)
box(s, 6.5, 2.15, 6.22, 1.55, BLUEBG, BLUE)
text(s, 6.78, 2.35, 5.7, 0.25, "ERROR BUDGET — the useful part", 10, BLUE, bold=True)
text(s, 6.78, 2.65, 5.7, 0.95,
     "A 95% target over 7 days allows 5% failures. If you've used 80% of that allowance by Wednesday, "
     "you're “at risk” — act BEFORE the breach, not after.", 11, INK, spacing=1.22)
for i, (st, desc, c, bgc) in enumerate([("MET", "within target, budget healthy", GREEN, GREENBG),
                                        ("AT RISK", "still met, but budget nearly spent", AMBER, AMBERBG),
                                        ("BREACHED", "target missed for the window", RED, REDBG),
                                        ("NO DATA", "not enough volume to judge", MUTED, PANEL)]):
    y = 3.95 + i * 0.72
    box(s, 6.5, y, 6.22, 0.62, bgc, c)
    text(s, 6.75, y + 0.17, 1.4, 0.26, st, 11, c, bold=True)
    text(s, 8.2, y + 0.18, 4.3, 0.26, desc, 10, INK)
callout(s, 0.62, 5.35, 5.5, 1.4, "vendor health sits here too",
        "Per-gateway and per-courier health over 24h / 7d / 30d — so “which partner is dragging us down” is a "
        "screen, not an argument.", "key", 10.5)

# ─────────── M15 · anomaly ───────────
s = S()
head(s, "module 15", "Anomaly detection — comparing today to the right yesterday",
     "Thresholds catch what you predicted. Anomaly detection catches what you didn't.", badge="M15")
box(s, 0.62, 2.2, 5.9, 2.5, PANEL, LINE)
text(s, 0.9, 2.4, 5.3, 0.25, "THE PROBLEM WITH A FLAT LINE", 10, RED, bold=True)
text(s, 0.9, 2.72, 5.35, 1.8,
     "Traffic at 03:00 Friday looks nothing like 13:00 Sunday.\n\nA single threshold across all hours either "
     "fires all night or misses a real daytime drop.", 11, INK, spacing=1.3)
box(s, 6.85, 2.2, 5.85, 2.5, GREENBG, GREEN)
text(s, 7.13, 2.4, 5.3, 0.25, "SEASONAL BASELINE", 10, GREEN, bold=True)
text(s, 7.13, 2.72, 5.35, 1.8,
     "168 buckets — one per hour of the week.\nEach compared against its OWN median over 4 weeks, using a robust "
     "z-score (≥3.5σ).\n\n“This Tuesday 14:00 vs every recent Tuesday 14:00.”", 11, INK, spacing=1.3)
box(s, 0.62, 4.95, 12.1, 0.72, PANEL, LINE)
text(s, 0.88, 5.12, 11.6, 0.4, "Example output:   P3  ▼ 21.6σ   semati volume 21 is 21.6σ below the seasonal norm 53 (expected 48–58)",
     12, INK, bold=True, font=MONO)
callout(s, 0.62, 5.9, 12.1, 1.0, "why the volume floor matters",
        "Anomaly detection ignores journeys below a minimum hourly volume — otherwise every quiet night produces "
        "dramatic-looking percentage swings on tiny numbers.", "info", 11.5)

# ─────────── POLL 3 ───────────
poll("3", "Semati fails ~55% on a completely normal day. When should an alert fire?",
     ["Whenever any failure occurs — every failure matters",
      "Above 10% — that's an industry standard",
      "When failures rise meaningfully ABOVE that 55% baseline, with enough sample",
      "Never — 55% is too noisy to alert on at all"], 2,
     "Alert on CHANGE FROM NORMAL. A rule set at 10% would fire every day forever; a rule set at 90% would sleep "
     "through a real outage. Tune above the observed baseline, and gate it with a minimum sample.",
     "The steady 55% belongs on the SLA page. The Alerts page is only for what just got worse.")

# ══════════════════════════════════════ SESSION 4 ══════════════════════════════════════
s = S(DARK)
section(s, "session 4", "Depth & Ownership", "Build your own views, tune the system safely, and take it over",
        [("M16", "Analytics — 14 dashboards, 79 panels, or build your own  + LAB 9", "40 min"),
         ("M17", "Growth & attribution traps", "20 min"),
         ("M18", "Rule tuning discipline  + LAB 10", "35 min"),
         ("M19", "Yusr — the on-premise AI assistant", "15 min"),
         ("M20", "Platform internals & handover", "20 min"),
         ("", "LIVE POLL 4 + certification", "15 min")])

# ─────────── M16 · analytics ───────────
s = S()
head(s, "module 16", "Analytics — a BI workspace built in",
     "14 preset dashboards, 79 panels — and anyone can build their own without raising a ticket.", badge="M16")
n1 = node(s, 0.62, 2.5, 2.1, 0.85, "Dataset", "7 to choose", WHITE, BLUE, 11, 8.5)
n2 = node(s, 3.15, 2.5, 2.1, 0.85, "Metric", "count / rate / sum", WHITE, BLUE, 11, 8.5)
n3 = node(s, 5.68, 2.5, 2.1, 0.85, "Visualisation", "7 types", WHITE, BLUE, 11, 8.5)
n4 = node(s, 8.21, 2.5, 2.1, 0.85, "Bucket + group", "hour/day × field", WHITE, BLUE, 11, 8.5)
n5 = node(s, 10.74, 2.5, 1.98, 0.85, "Save", "personal / shared", GREENBG, GREEN, 11, 8.5, GREEN)
for a_, b_ in [(n1, n2), (n2, n3), (n3, n4), (n4, n5)]: arrow_r(s, a_, b_, FAINT)
box(s, 0.62, 3.8, 5.9, 1.5, PANEL, LINE)
text(s, 0.88, 3.98, 5.4, 0.25, "7 DATASETS", 9.5, GREEN, bold=True)
text(s, 0.88, 4.26, 5.4, 0.95, "payments · onboarding · activation · nafath · delivery · change_plan · checkouts", 11, BODY, spacing=1.25)
box(s, 6.85, 3.8, 5.85, 1.5, PANEL, LINE)
text(s, 7.1, 3.98, 5.4, 0.25, "7 VISUALISATIONS", 9.5, GREEN, bold=True)
text(s, 7.1, 4.26, 5.4, 0.95, "line · bar · stat · table · pie · donut · funnel  (+ a stuck-orders panel)", 11, BODY, spacing=1.25)
callout(s, 0.62, 5.5, 5.9, 1.3, "good questions to build",
        "“Payment success by gateway, hourly, 7d”\n“Activation failures by status code, 24h”\n“Orders by flow type, 30d”", "key", 10.5)
callout(s, 6.85, 5.5, 5.85, 1.3, "common mistakes",
        "Grouping by a field with hundreds of values · a window too short to contain data · a rate where you wanted a count.", "warn", 10.5)

# ─────────── M17 · attribution fan-out (the diagram) ───────────
s = S()
head(s, "module 17", "Attribution — how a number can be confidently wrong",
     "A true story from this console, and the habit that prevents it.", badge="M17")
text(s, 0.62, 2.05, 5.9, 0.25, "✗  WRONG — counting via a CONFIG table", 10, RED, bold=True)
o1 = node(s, 0.62, 2.4, 1.5, 0.7, "1 order", None, WHITE, RED, 10)
pc = node(s, 2.5, 2.4, 1.8, 0.7, "plan_channels", "“may sell”", REDBG, RED, 10, 8)
arrow_r(s, o1, pc, RED)
for i, ch in enumerate(["tygo", "soob", "posa", "apollo", "partner"]):
    y = 1.85 + i * 0.52
    n = node(s, 4.75, y, 1.5, 0.42, ch, None, REDBG, RED, 9)
    arrow(s, 4.3, 2.75, 4.7, y + 0.21, RED, 1.0)
box(s, 0.62, 3.35, 5.6, 0.62, REDBG, RED)
text(s, 0.88, 3.52, 5.1, 0.35, "1 order counted 5 times → soob showed 311 orders. It hadn't launched.", 10.5, INK, bold=True)
text(s, 6.85, 2.05, 5.85, 0.25, "✓  RIGHT — counting the fact on the row", 10, GREEN, bold=True)
o2 = node(s, 6.85, 2.4, 1.5, 0.7, "1 order", None, WHITE, GREEN, 10)
es = node(s, 8.75, 2.4, 2.3, 0.7, "external_service_name", "stamped at creation", GREENBG, GREEN, 9.5, 8)
ch = node(s, 11.35, 2.4, 1.37, 0.7, "tygo", None, GREENBG, GREEN, 10)
arrow_r(s, o2, es, GREEN); arrow_r(s, es, ch, GREEN)
box(s, 6.85, 3.35, 5.85, 0.62, GREENBG, GREEN)
text(s, 7.1, 3.52, 5.4, 0.35, "1 order = 1 channel. Real numbers: tygo 26,107 · soob 65 (test orders).", 10.5, INK, bold=True)
callout(s, 0.62, 4.3, 12.1, 1.05, "the rule",
        "Attribute from the fact recorded ON THE ROW (the order's own origin) — never from a configuration table. "
        "“Which channels MAY sell this plan” is not “which channel DID sell it”.", "key", 11.5)
callout(s, 0.62, 5.55, 12.1, 1.35, "the habit this should build in you",
        "When a number surprises you — a channel that isn't launched showing sales, a total that seems too round, a "
        "figure that doubled overnight — ask: WHAT exactly was counted, and JOINED to what?\n"
        "This bug was found because someone said “that looks wrong”. Please be that person.", "note", 11.5)

# ─────────── M18 · tuning ───────────
s = S()
head(s, "module 18", "Tuning a rule without crying wolf",
     "An alert nobody trusts is worse than no alert at all. Here is the discipline.", badge="M18")
steps = [("1", "Look at the chart FIRST", "Open the metric chart. What IS normal for this hour of the week? Read the seasonal band before touching anything."),
         ("2", "Set above the noise", "Not above zero. The threshold sits above normal variation."),
         ("3", "Gate the sample", "min_sample stops a quiet 04:00 firing on three events."),
         ("4", "Test now", "Evaluates against live data without saving. On a healthy system it must NOT fire."),
         ("5", "Save, then watch 24h", "Trust it only after a full daily cycle has passed."),
         ("6", "If it cried wolf — raise the bar", "Never delete. A deleted rule is a blind spot with no record.")]
for i, (n_, t, b) in enumerate(steps):
    x = 0.62 + (i % 2) * 6.2; y = 2.15 + (i // 2) * 1.35
    box(s, x, y, 5.9, 1.18)
    d = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x + 0.24), Inches(y + 0.22), Inches(0.42), Inches(0.42))
    d.fill.solid(); d.fill.fore_color.rgb = GREENBG; d.line.color.rgb = GREEN; d.shadow.inherit = False
    text(s, x + 0.24, y + 0.29, 0.42, 0.28, n_, 12, GREEN, bold=True, align=PP_ALIGN.CENTER)
    text(s, x + 0.8, y + 0.2, 4.9, 0.26, t, 12, INK, bold=True)
    text(s, x + 0.8, y + 0.5, 4.95, 0.6, b, 9.5, BODY, spacing=1.18)
callout(s, 0.62, 6.35, 12.1, 0.85, "the test before you save",
        "If you cannot say what the rule would STILL catch after your change, you have broken it — not tuned it.", "stop", 12)

# ─────────── M19 · Yusr ───────────
s = S()
head(s, "module 19", "Yusr  يُسر  — an AI teammate that runs on our own network",
     "Ask in plain language, get one answer instead of five screens.", badge="M19")
q = node(s, 0.62, 2.5, 2.4, 0.9, "Your question", "“what happened to 05…?”", WHITE, BLUE, 10.5, 8)
r = node(s, 3.35, 2.5, 2.2, 0.9, "Intent router", "4 intents", WHITE, BLUE, 10.5, 8)
m = node(s, 5.88, 2.5, 2.2, 0.9, "PII masking", "to YOUR role", AMBERBG, AMBER, 10.5, 8)
l = node(s, 8.41, 2.5, 2.2, 0.9, "Local LLM", "Ollama, on-prem", GREENBG, GREEN, 10.5, 8)
a = node(s, 10.94, 2.5, 1.78, 0.9, "Answer", "+ deep links", WHITE, GREEN, 10.5, 8)
for x_, y_ in [(q, r), (r, m), (m, l), (l, a)]: arrow_r(s, x_, y_, FAINT)
box(s, 0.62, 3.85, 5.9, 1.5, GREENBG, GREEN)
text(s, 0.88, 4.05, 5.4, 0.25, "WHAT IT'S GOOD AT", 9.5, GREEN, bold=True)
text(s, 0.88, 4.35, 5.4, 0.9, "Summarising a subscriber's recent failures · listing open incidents · "
     "citing CST/ServiceNow tickets by number · pointing you to the right screen", 10.5, INK, spacing=1.2)
box(s, 6.85, 3.85, 5.85, 1.5, AMBERBG, AMBER)
text(s, 7.1, 4.05, 5.4, 0.25, "THE RULE", 9.5, AMBER, bold=True)
text(s, 7.1, 4.35, 5.4, 0.9, "VERIFY before you act on it with a customer. It's a fast assistant, not an "
     "authority. It degrades to rule-based answers if the model is down.", 10.5, INK, spacing=1.2)
callout(s, 0.62, 5.55, 12.1, 1.05, "privacy by design",
        "The model runs on our own network — data never leaves it. And the context is masked to the ASKER's "
        "permissions before it reaches the model: Yusr can only ever tell you what your role may already see.", "key", 11.5)

# ─────────── M20 · platform ───────────
s = S()
head(s, "module 20", "Platform internals — four decisions that explain the behaviour",
     "The engineering that keeps the numbers honest and the pages fast.", badge="M20")
items = [("Read-only sync + watchdog", "Watermarked, batched, throttled. The watchdog measures lag first and only syncs when behind — a healthy system adds zero prod load.", GREEN),
         ("Response caching", "Stale-while-revalidate + single-flight: only the first viewer after a sync waits. A 30-day dashboard went 4.6s → 8ms.", BLUE),
         ("Everything in UTC", "Timestamps are stored as UTC in naive columns. A non-UTC process OR database session shifts every window — this bug once made the dashboard show zeros while the data was perfect.", AMBER),
         ("Honest failure", "If the pipeline stalls, the console says so loudly. Wrong-but-plausible numbers are the most dangerous state a monitoring tool can be in.", RED)]
for i, (t, b, c) in enumerate(items):
    x = 0.62 + (i % 2) * 6.2; y = 2.15 + (i // 2) * 2.05
    box(s, x, y, 5.9, 1.85)
    rule(s, x + 0.28, y + 0.24, 0.42, c, 0.03)
    text(s, x + 0.28, y + 0.46, 5.3, 0.28, t, 12.5, INK, bold=True)
    text(s, x + 0.28, y + 0.82, 5.35, 0.9, b, 10, BODY, spacing=1.2)
box(s, 0.62, 6.3, 12.1, 0.9, PANEL, LINE)
text(s, 0.88, 6.48, 11.6, 0.5, "Measured:   30-day dashboard 4.6s → 8ms cached   ·   timeline lookups 20–30s → indexed   ·   "
     "sync lag warning at 10 min, critical at 45", 11.5, INK, font=MONO)

# ─────────── POLL 4 ───────────
poll("4", "Reseller channel numbers must be attributed from…",
     ["plan_channels — the table listing which channels may sell each plan",
      "The order's own recorded origin (external_service_name)",
      "UTM parameters only",
      "Whatever the commercial team reports manually"], 1,
     "plan_channels is CONFIGURATION — “which channels MAY sell this plan”. A plan enabled on five channels made one "
     "order count five times, inflating an unlaunched channel to 311 orders (real: 65 test orders).",
     "Attribute from the fact stamped on the row, never from a table describing possibilities.")

# ══════════════════════════════════════ CERTIFICATION ══════════════════════════════════
s = S()
head(s, "certification", "Your certificate",
     "Two grades, issued from the attendance register and the quiz scores. It is earned, not handed out.")

for i, (grade, colr, bgc, headline, crit, means) in enumerate([
    ("CERTIFICATE OF COMPLETION", GREEN, GREENBG, "You can operate the console on your own.",
     [f"All {len(CFG['sessions'])} sessions attended",
      f"Quiz score ≥ {CERT['completion_min_score']}%",
      "Scenario A completed unaided"],
     "Recognised for the L1/L2 console duty roster."),
    ("CERTIFICATE OF ATTENDANCE", BLUE, BLUEBG, "You were in the room for the material.",
     [f"At least {CERT['attendance_min_sessions']} of {len(CFG['sessions'])} sessions attended",
      "Assessment not passed or not sat",
      "Re-sit the quiz any time to upgrade"],
     "Upgrade by re-sitting the quiz — no need to re-attend.")]):
    x = 0.62 + i * 6.15
    box(s, x, 2.15, 5.95, 3.35, bgc, colr)
    text(s, x + 0.3, 2.4, 5.35, 0.26, grade, 10.5, colr, bold=True)
    text(s, x + 0.3, 2.72, 5.35, 0.34, headline, 14, INK, bold=True)
    rule(s, x + 0.3, 3.18, 0.5, colr, 0.03)
    for j, cr in enumerate(crit):
        yy = 3.42 + j * 0.42
        text(s, x + 0.3, yy, 0.3, 0.26, "✓" if i == 0 else "•", 11, colr, bold=True)
        text(s, x + 0.62, yy, 5.0, 0.3, cr, 11.5, BODY)
    box(s, x + 0.3, 4.78, 5.35, 0.58, WHITE, colr)
    text(s, x + 0.5, 4.95, 5.0, 0.3, means, 10.5, colr, bold=True)

for i, (t, b) in enumerate([
    ("Signed", "Issued by Digital & MVNO Operations and countersigned by the console owner."),
    ("Verifiable", "Every certificate carries a unique ID recorded in the issue register — a claim can be checked."),
    ("Traceable", "Grade, sessions and score are printed on the face. Nothing is implied.")]):
    x = 0.62 + i * 4.1
    box(s, x, 5.68, 3.9, 1.05)
    text(s, x + 0.26, 5.86, 3.4, 0.26, t, 12, INK, bold=True)
    text(s, x + 0.26, 6.16, 3.4, 0.5, b, 9.5, BODY, spacing=1.18)

# ─────────── HANDOVER ───────────
s = S()
head(s, "close", "It's yours now",
     "The console isn't finished, and it isn't mine.")
for i, (t, b) in enumerate([
    ("Your first week", "Day 1 open the dashboard each morning · Day 2 handle one real case end to end · "
                        "Day 3 acknowledge one real incident · Day 4 build one panel · Day 5 report one thing that's wrong"),
    ("When a number looks wrong, say so", "Reseller figures were once inflated by a bad join. A staleness banner once cried wolf on quiet "
                                          "overnight tables. Both were found by someone saying “that looks wrong”."),
    ("Where to get help", "Yusr (in-console)  →  the L1 cheat-sheet  →  your L2  →  the console owner")]):
    y = 2.15 + i * 1.32
    box(s, 0.62, y, 12.1, 1.15)
    rule(s, 0.9, y + 0.2, 0.42, GREEN, 0.03)
    text(s, 0.9, y + 0.42, 11.4, 0.28, t, 13, INK, bold=True)
    text(s, 0.9, y + 0.74, 11.4, 0.35, b, 10.5, BODY, spacing=1.2)
box(s, 0.62, 6.15, 12.1, 1.05, GREENBG, GREEN)
text(s, 0.95, 6.32, 11.5, 0.28, "AGREE BEFORE YOU LEAVE THE ROOM", 10, GREEN, bold=True)
text(s, 0.95, 6.62, 11.5, 0.4, "Who opens the dashboard each morning  ·  where feedback goes  ·  when we review the alert rules together",
     12.5, INK, bold=True)

prs.save(OUT)
n = len([f for f in glob.glob(os.path.join(SHOTS, "*")) if f.lower().endswith((".png", ".jpg", ".jpeg"))])
print(f"✓ {OUT}")
print(f"  slides: {len(prs.slides._sldIdLst)}   screenshots found: {n}")
