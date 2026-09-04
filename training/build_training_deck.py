#!/usr/bin/env python3
"""
Salam Digital Console — 3-day workshop deck (light technical style).

Deliberately different from the promo deck: light background for projector + print, dense but clean,
code blocks, tables, callouts, LAB / QUIZ / KEY-POINT slides. Dark Salam-green dividers between days.

USAGE   python3 build_training_deck.py
Screenshots: drop PNGs into ./shots/ (names listed in shots/README.md). Re-run any time.
"""
import os, glob
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
OUT = os.path.join(HERE, "Salam-Console-Training.pptx")

# ---- light technical palette ----
BG      = RGBColor(0xFF, 0xFF, 0xFF)
INK     = RGBColor(0x0F, 0x17, 0x2A)   # near-black text
BODY    = RGBColor(0x33, 0x41, 0x55)
MUTED   = RGBColor(0x64, 0x74, 0x8B)
GREEN   = RGBColor(0x00, 0x8A, 0x47)   # Salam green, darkened for light bg
GREENBG = RGBColor(0xEC, 0xFD, 0xF3)
DARK    = RGBColor(0x0A, 0x0A, 0x0F)   # divider slides
CODEBG  = RGBColor(0x1E, 0x29, 0x3B)
CODEFG  = RGBColor(0xE2, 0xE8, 0xF0)
PANEL   = RGBColor(0xF8, 0xFA, 0xFC)
LINE    = RGBColor(0xE2, 0xE8, 0xF0)
AMBER   = RGBColor(0xB4, 0x53, 0x09)
AMBERBG = RGBColor(0xFF, 0xFB, 0xEB)
RED     = RGBColor(0xB9, 0x1C, 0x1C)
REDBG   = RGBColor(0xFE, 0xF2, 0xF2)
BLUE    = RGBColor(0x1D, 0x4E, 0xD8)
BLUEBG  = RGBColor(0xEF, 0xF6, 0xFF)
FONT    = "Aptos"           # falls back cleanly; Calibri-class metrics
MONO    = "Consolas"

W, H = Inches(13.333), Inches(7.5)


def deck():
    p = Presentation(); p.slide_width, p.slide_height = W, H; return p


def slide(prs, fill=BG):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg = s.background.fill; bg.solid(); bg.fore_color.rgb = fill
    return s


def text(s, x, y, w, h, txt, size=12, color=BODY, bold=False, align=PP_ALIGN.LEFT,
         spacing=1.15, font=FONT, anchor=MSO_ANCHOR.TOP):
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    for i, ln in enumerate(txt.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align; p.line_spacing = spacing
        r = p.add_run(); r.text = ln
        f = r.font; f.name = font; f.size = Pt(size); f.bold = bold; f.color.rgb = color
    return tb


def box(s, x, y, w, h, fill=PANEL, line=LINE, radius=True):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
                            Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = fill
    if line: sh.line.color.rgb = line; sh.line.width = Pt(0.75)
    else: sh.line.fill.background()
    sh.shadow.inherit = False
    try: sh.adjustments[0] = 0.04
    except Exception: pass
    return sh


def rule(s, x, y, w=0.7, color=GREEN, h=0.035):
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = color; sh.line.fill.background()
    sh.shadow.inherit = False; return sh


def head(s, kicker, title, sub=None, subw=11.9):
    text(s, 0.62, 0.42, 8.0, 0.2, kicker.upper(), 10, GREEN, bold=True)
    text(s, 0.62, 0.72, 12.1, 0.45, title, 25, INK, bold=True)
    rule(s, 0.62, 1.28)
    if sub: text(s, 0.62, 1.5, subw, 0.6, sub, 12.5, MUTED)


def code(s, x, y, w, h, lines, size=10.5):
    box(s, x, y, w, h, CODEBG, None)
    text(s, x + 0.22, y + 0.18, w - 0.44, h - 0.36, lines, size, CODEFG, font=MONO, spacing=1.28)


def callout(s, x, y, w, h, label, body, kind="key"):
    pal = {"key": (GREENBG, GREEN), "warn": (AMBERBG, AMBER), "stop": (REDBG, RED),
           "info": (BLUEBG, BLUE)}[kind]
    box(s, x, y, w, h, pal[0], pal[1])
    text(s, x + 0.26, y + 0.18, w - 0.52, 0.25, label.upper(), 10, pal[1], bold=True)
    text(s, x + 0.26, y + 0.5, w - 0.52, h - 0.68, body, 11.5, INK, spacing=1.22)


def bullets(s, items, x=0.62, y=2.2, w=6.0, step=0.5, size=12, color=BODY, marker="—"):
    for i, b in enumerate(items):
        text(s, x, y + i * step, w, 0.45, f"{marker}  {b}", size, color, spacing=1.15)


def table(s, x, y, w, rows, colw, size=10.5, header=True, rowh=0.34):
    """Simple text table: rows = list of lists."""
    for r, row in enumerate(rows):
        yy = y + r * rowh
        if r == 0 and header:
            box(s, x, yy, w, rowh, RGBColor(0xF1, 0xF5, 0xF9), LINE)
        elif r % 2 == 0:
            box(s, x, yy, w, rowh, RGBColor(0xFB, 0xFC, 0xFD), None)
        cx = x
        for c, cell in enumerate(row):
            text(s, cx + 0.14, yy + 0.07, colw[c] - 0.2, rowh - 0.1, str(cell), size,
                 INK if r == 0 else BODY, bold=(r == 0 and header))
            cx += colw[c]
    return y + len(rows) * rowh


def shot(s, slot, caption, x=6.95, y=2.05, w=5.75, h=3.9):
    hit = [f for f in glob.glob(os.path.join(SHOTS, slot + ".*"))
           if f.lower().endswith((".png", ".jpg", ".jpeg"))]
    if hit:
        pic = s.shapes.add_picture(hit[0], Inches(x), Inches(y), width=Inches(w))
        if pic.height > Inches(h):
            el = pic._element; el.getparent().remove(el)
            pic = s.shapes.add_picture(hit[0], Inches(x), Inches(y), height=Inches(h))
            pic.left = Inches(x + (w - pic.width.inches) / 2)
        return pic
    box(s, x, y, w, h, PANEL, LINE)
    text(s, x, y + h / 2 - 0.4, w, 0.3, "▢", 20, RGBColor(0xCB, 0xD5, 0xE1), align=PP_ALIGN.CENTER)
    text(s, x, y + h / 2 - 0.05, w, 0.3, slot + ".png", 11.5, MUTED, align=PP_ALIGN.CENTER)
    text(s, x, y + h / 2 + 0.32, w, 0.5, caption, 10, MUTED, align=PP_ALIGN.CENTER)


def divider(s, day, title, sub, mins):
    text(s, 0.62, 2.1, 6.0, 0.4, day.upper(), 12, GREEN, bold=True)
    text(s, 0.62, 2.55, 11.5, 0.9, title, 38, RGBColor(0xFF, 0xFF, 0xFF), bold=True)
    rule(s, 0.62, 3.75, 1.1, GREEN)
    text(s, 0.62, 4.05, 10.0, 0.5, sub, 15, RGBColor(0xE2, 0xE8, 0xF0))
    text(s, 0.62, 4.75, 10.0, 0.3, mins, 11.5, RGBColor(0x94, 0xA3, 0xB8))


def labslide(s, num, title, goal, steps, expect, note, mins):
    # NOTE: arg order is (expect, note, mins) — matches every call site below.
    box(s, 0, 0, 13.333, 1.15, GREEN, None, radius=False)
    text(s, 0.62, 0.26, 9.0, 0.3, f"LAB {num}  ·  {mins}", 11, RGBColor(0xD1, 0xFA, 0xE5), bold=True)
    text(s, 0.62, 0.58, 11.5, 0.4, title, 20, RGBColor(0xFF, 0xFF, 0xFF), bold=True)
    text(s, 0.62, 1.42, 12.1, 0.35, "GOAL", 10, GREEN, bold=True)
    text(s, 0.62, 1.68, 12.1, 0.4, goal, 13, INK)
    text(s, 0.62, 2.3, 6.0, 0.3, "STEPS", 10, GREEN, bold=True)
    for i, st in enumerate(steps):
        text(s, 0.62, 2.58 + i * 0.46, 6.1, 0.42, f"{i+1}.  {st}", 11.5, BODY, spacing=1.15)
    callout(s, 7.05, 2.3, 5.65, 1.5, "expected result", expect, "key")
    if note: callout(s, 7.05, 3.95, 5.65, 1.5, "if it goes wrong", note, "warn")


def quizslide(s, n, title, questions, mins):
    box(s, 0, 0, 13.333, 1.15, RGBColor(0x1D, 0x4E, 0xD8), None, radius=False)
    text(s, 0.62, 0.26, 9.0, 0.3, f"QUIZ {n}  ·  {mins}", 11, RGBColor(0xDB, 0xEA, 0xFE), bold=True)
    text(s, 0.62, 0.58, 11.5, 0.4, title, 20, RGBColor(0xFF, 0xFF, 0xFF), bold=True)
    for i, q in enumerate(questions):
        y = 1.5 + i * 0.62
        text(s, 0.62, y, 12.1, 0.55, f"{i+1}.  {q}", 12.5, INK, spacing=1.18)
    text(s, 0.62, 6.85, 12.1, 0.3, "Answer key in 04-QUIZZES.md  ·  discuss every answer — ask “why?”",
         10, MUTED)


prs = deck()

# ============================== TITLE ==============================
s = slide(prs, DARK)
text(s, 0, 2.35, 13.333, 0.25, "TECHNICAL WORKSHOP  ·  3 SESSIONS", 11, GREEN, bold=True, align=PP_ALIGN.CENTER)
text(s, 0, 2.72, 13.333, 0.9, "Salam Digital Console", 40, RGBColor(0xFF, 0xFF, 0xFF), bold=True, align=PP_ALIGN.CENTER)
rule(s, 5.9, 3.78, 1.55, GREEN)
text(s, 0, 4.05, 13.333, 0.45, "Operate it. Troubleshoot with it. Tune it.", 16, RGBColor(0xE2, 0xE8, 0xF0), align=PP_ALIGN.CENTER)
text(s, 0, 4.62, 13.333, 0.3, "Hands-on  ·  bring your laptop  ·  we use live production data",
     12, RGBColor(0x94, 0xA3, 0xB8), align=PP_ALIGN.CENTER)
for i, (d, t) in enumerate([("DAY 1", "Foundations & access"), ("DAY 2", "Troubleshooting & incidents"),
                            ("DAY 3", "Analytics, tuning & platform")]):
    x = 1.85 + i * 3.4
    box(s, x, 5.35, 3.05, 1.0, RGBColor(0x15, 0x17, 0x21), RGBColor(0x27, 0x2B, 0x38))
    text(s, x + 0.28, 5.55, 2.5, 0.25, d, 10, GREEN, bold=True)
    text(s, x + 0.28, 5.83, 2.6, 0.35, t, 12, RGBColor(0xE2, 0xE8, 0xF0))

# ============================== HOW THIS WORKS ==============================
s = slide(prs)
head(s, "how this workshop works", "Nobody watches. Everybody clicks.",
     "Every module is the same shape: 10 minutes of demo, 15 minutes where you do it, 5 minutes debrief.")
rows = [["", "Format", "You will…"],
        ["Demo", "I drive, you watch", "See the screen and the reasoning behind it"],
        ["Lab", "You drive, I help", "Do it on your own laptop, on live data"],
        ["Scenario", "Role-play", "Handle a realistic customer or incident case"],
        ["Quiz", "Open discussion", "Check understanding — we discuss every answer"]]
table(s, 0.62, 2.3, 8.4, rows, [1.5, 2.6, 4.3], rowh=0.42)
callout(s, 9.25, 2.3, 3.45, 2.1, "ground rules",
        "Interrupt me any time.\nReal customer data — nothing leaves this room.\n"
        "You cannot break production.", "info")
callout(s, 9.25, 4.55, 3.45, 1.6, "if your screen differs",
        "Say so immediately. It's usually your role — and that's a lesson, not a problem.", "warn")

# ============================== DAY 1 DIVIDER ==============================
s = slide(prs, DARK)
divider(s, "Day 1", "Foundations & Access", "Why this exists · architecture · sign-in · roles · the daily loop", "2h 45m  ·  everyone")

# ============================== M1.1 THE PROBLEM ==============================
s = slide(prs)
head(s, "module 1.1", "Four blind spots that cost us",
     "Every one of these was real. Every one looked fine on a dashboard at the time.")
items = [
 ("A gateway died behind failover", "UPG stopped taking payments. Traffic failed over to HyperPay, so the blended success rate stayed green. Noticed 34 minutes later — by a customer.", RED, REDBG),
 ("Charged, but never activated", "The gateway captured the money; the confirmation never arrived. Counted as neither success nor failure — invisible.", RED, REDBG),
 ("The same customer charged twice", "One order, two captures. Only provable by reconciling with the gateway.", AMBER, AMBERBG),
 ("A provider that flaps", "Semati fails ~55% on a normal day. A flat threshold either screams constantly or never fires.", AMBER, AMBERBG)]
for i, (t, b, c, bgc) in enumerate(items):
    x = 0.62 + (i % 2) * 6.2; y = 2.25 + (i // 2) * 2.05
    box(s, x, y, 5.9, 1.8, bgc, c)
    text(s, x + 0.3, y + 0.26, 5.3, 0.3, t, 13.5, INK, bold=True)
    text(s, x + 0.3, y + 0.66, 5.3, 1.0, b, 11, BODY, spacing=1.2)
text(s, 0.62, 6.5, 12.1, 0.4,
     "Ask yourself: how long would each of these take to explain today, without the console?", 12.5, GREEN, bold=True)

# ============================== M1.2 ARCHITECTURE ==============================
s = slide(prs)
head(s, "module 1.2", "Architecture — where the numbers come from",
     "Three facts that explain almost every question you'll have about the data.")
code(s, 0.62, 2.15, 7.3, 2.75,
     "prod  (172.31.43.123)          ← the real system. We NEVER write here.\n"
     "  │   read-only · incremental · every 5 min\n"
     "  ▼\n"
     "salam_replica (172.31.15.121)  ← everything you SEE is queried from here\n"
     "mvno_console  (172.31.15.121)  ← rules · alerts · users · audit log\n"
     "  │\n"
     "console app (152:4600, PM2) → nginx (115) → salam.sa/digital-console/", 11)
for i, (n, t, b) in enumerate([
    ("1", "Read-only by construction", "The prod connection is forced read-only at the database level. The console observes; humans act."),
    ("2", "~5 minutes is normal", "Not a fault. A cron watchdog measures the lag and only syncs when we're actually behind."),
    ("3", "It tells you when it's blind", "If the pipeline stalls, a banner says the figures are NOT live — stale data outranks every other status.")]):
    y = 2.15 + i * 1.05
    box(s, 8.2, y, 4.5, 0.92)
    text(s, 8.42, y + 0.14, 0.3, 0.3, n, 13, GREEN, bold=True)
    text(s, 8.78, y + 0.14, 3.7, 0.25, t, 11.5, INK, bold=True)
    text(s, 8.78, y + 0.44, 3.75, 0.45, b, 9.5, BODY, spacing=1.15)
callout(s, 0.62, 5.15, 7.3, 1.35, "why a replica at all?",
        "Dashboards and alert scans are heavy, repetitive queries. Running them against the database that "
        "serves customers is the load you least want. The replica absorbs it.", "key")

# ============================== LAB 1.1 ==============================
s = slide(prs)
labslide(s, "1.1", "Everyone signs in", "You are logged in, at the right role, and know what that role means.",
         ["Open https://salam.sa/digital-console/",
          "Enter your @salam.sa work email → Send code",
          "Get the 6-digit code (inbox — check junk)",
          "Enter it. You're in.",
          "Look top-right: your name + role. Say your role out loud."],
         "Your role label appears top-right and you can state it.",
         "“No console account” = not created yet, tell me.\n“Use a @salam.sa email” = personal address, by design.\nCode expires in 10 min — just request another.", "20 min")

# ============================== M1.3 ROLES ==============================
s = slide(prs)
head(s, "module 1.2b", "Roles — least privilege, enforced in code",
     "Your role decides which pages exist for you and what you can do on them. It is not a suggestion.")
rows = [["Role", "Sees", "Can also do"],
        ["Super Admin", "everything", "manage users · unmask PII · everything"],
        ["L3 Digital", "all except user mgmt", "edit rules · manage sync · unmask PII"],
        ["L2 Digital / L2 BSS", "ops pages", "edit rules · export · acknowledge"],
        ["L1 Digital / L1 BSS", "ops pages", "export · acknowledge"],
        ["Report Manager", "analytics · SLA · alerts", "export only — no Troubleshoot"],
        ["Errors Manager", "troubleshoot · alerts", "edit rules · export · acknowledge"]]
table(s, 0.62, 2.2, 8.3, rows, [2.5, 2.7, 3.1], rowh=0.42)
callout(s, 9.2, 2.2, 3.5, 2.0, "the PII rule",
        "Only Super Admin and L3 Digital can unmask customer data — and every unmask is written to "
        "the audit log with your name on it.", "stop")
callout(s, 9.2, 4.4, 3.5, 1.7, "multi-role users",
        "Get the union of views and the OR of capabilities, labelled by their highest role.", "info")
text(s, 0.62, 5.45, 8.3, 0.5,
     "Try it now: compare your visible tabs with the person next to you. Different? That's the model working.",
     12, GREEN, bold=True)

# ============================== M1.4 DASHBOARD ==============================
s = slide(prs)
head(s, "module 1.3", "The Dashboard, field by field",
     "One screen that answers: is today normal — and if not, where?")
bullets(s, ["8 KPI cards — each with a sparkline, a vs-previous delta and a sample size (n=)",
            "Colour is relative to the SLA target, not to zero",
            "8 journey-health tiles — the whole customer path at a glance",
            "NOC banner — plain-English headline of the worst thing happening",
            "Ranges: Today · Yesterday · 7d · 30d, plus intra-day (last 1/3/6/12/24h)",
            "Order status flow — 19 nodes, clickable down to the orders behind them"], y=2.15, step=0.47, w=6.1)
shot(s, "d1-dashboard", "Dashboard · full page")
callout(s, 0.62, 5.25, 6.1, 1.3, "before you quote any number",
        "Check for the staleness banner. If it's there, the figures are NOT live — say so before "
        "repeating them to a customer or a manager.", "warn")

# ============================== LAB 1.3 ==============================
s = slide(prs)
labslide(s, "1.3", "Read today's health", "Answer “is today normal?” with evidence.",
         ["Dashboard → range = Today. Note orders, payments OK, success %, errors",
          "Switch to 7d, then 30d — which numbers move most? Why?",
          "Check the journey-health strip — anything amber or red?",
          "Look for a staleness banner — is there one?",
          "Open the Order status flow. Find the biggest drop-off stage."],
         "You can say whether today is normal, and point at the number that proves it.",
         "Small numbers at 09:00 are expected — “Today” is a short window, not a fault.", "20 min")

# ============================== QUIZ 1 ==============================
s = slide(prs)
quizslide(s, "1", "Foundations", [
 "Where does the console read its data from?",
 "How fresh is the data normally — and is that a fault?",
 "Can the console change anything in production?",
 "Who can unmask customer PII, and what happens when they do?",
 "A red staleness banner appears. What do you do before quoting a number?",
 "A KPI is red. Does that mean the system is broken?",
 "Why can't the Report Manager see the Troubleshoot tab?"], "10 min")

# ============================== DAY 2 DIVIDER ==============================
s = slide(prs, DARK)
divider(s, "Day 2", "Troubleshooting & Incidents", "From a customer complaint to a root cause — and running the response", "3h  ·  L1 + L2 core")

# ============================== M2.1 TROUBLESHOOT ==============================
s = slide(prs)
head(s, "module 2.1", "Troubleshoot — the Error Control Board",
     "Live failures grouped by category and owner team. This is where an L1 spends most of their day.")
bullets(s, ["Search by mobile · order id · ICCID · national ID",
            "10 categories, each tagged with the team that owns it",
            "Code · message drill-down on 5 categories — the actual reason, not just “failed”",
            "Gateway chips: UPG · HyperPay · Tap · Samsung Pay",
            "Expand any row → the full end-to-end timeline",
            "Export any view to CSV or JSON"], y=2.15, step=0.47, w=6.1)
shot(s, "d2-troubleshoot", "Troubleshoot · Error Control Board")
callout(s, 0.62, 5.25, 6.1, 1.3, "built-in reference cards",
        "Payments, BSS/Semati codes and Nafath each have a reference card with customer-facing wording. "
        "You don't need a separate wiki.", "key")

# ============================== M2.2 THE BIG DISTINCTION ==============================
s = slide(prs)
head(s, "module 2.2  ·  the most important idea in this workshop",
     "Failed vs Stuck vs Abandoned", "Three payment states that look similar and mean completely different things.")
cards = [("FAILED", "status = fail", "The bank or gateway declined it. Nothing was taken.",
          "Read the decline code → use the cheat-sheet wording. Customer can retry.", RED, REDBG),
         ("STUCK", "pending + commit response, >30 min", "The gateway answered — money may have moved — but our system never confirmed it.",
          "ESCALATE to L2 with the payment_reference_id. Customer may be charged.", AMBER, AMBERBG),
         ("ABANDONED", "pending, NO commit response", "The customer reached the payment page and never completed it.",
          "Not an incident. Help them try again.", GREEN, GREENBG)]
for i, (t, cond, mean, act, c, bgc) in enumerate(cards):
    x = 0.62 + i * 4.05
    box(s, x, 2.2, 3.8, 3.5, bgc, c)
    text(s, x + 0.28, 2.42, 3.2, 0.3, t, 15, c, bold=True)
    text(s, x + 0.28, 2.78, 3.25, 0.35, cond, 9.5, MUTED, font=MONO)
    text(s, x + 0.28, 3.2, 3.25, 1.0, mean, 11, INK, spacing=1.2)
    rule(s, x + 0.28, 4.3, 0.5, c, 0.02)
    text(s, x + 0.28, 4.5, 3.25, 1.0, act, 11, BODY, spacing=1.2)
callout(s, 0.62, 5.95, 12.1, 1.0, "why this matters more than anything else today",
        "Get this wrong and you either refund customers who never paid, or leave charged customers stranded. "
        "The console distinguishes them by one thing: did the gateway ever answer?", "key")

# ============================== LAB 2.1 ==============================
s = slide(prs)
labslide(s, "2.1", "Find the customer  (Scenario A)",
         "Turn “I paid but nothing happened” into a factual answer and a sentence you'd actually say.",
         ["Troubleshoot → search the number I give you",
          "Did a payment exist? What status?",
          "If failed — what's the decline code and message?",
          "Where did the order stop: payment, activation, delivery?",
          "Expand → read the timeline. Decide: failed, stuck or abandoned?"],
         "A verdict you can justify, plus the customer wording from the cheat-sheet.",
         "“Not found” usually means no failures for that number (good news) — or try the last 9 digits.", "25 min")

# ============================== M2.3 THE FAILOVER TRAP ==============================
s = slide(prs)
head(s, "module 2.3", "Why a healthy average can hide a dead gateway",
     "INC0014859, in one slide. This is the reasoning pattern, not just the story.")
box(s, 0.62, 2.15, 5.9, 2.4, REDBG, RED)
text(s, 0.9, 2.4, 5.3, 0.3, "WHAT THE DASHBOARD SHOWED", 11, RED, bold=True)
text(s, 0.9, 2.78, 5.3, 1.5,
     "Payment success 84%  ✓ healthy\nNo alert firing\nNo customer complaints yet\n\n"
     "…while UPG had taken zero payments for 34 minutes.", 12, INK, spacing=1.3)
box(s, 6.85, 2.15, 5.85, 2.4, GREENBG, GREEN)
text(s, 7.13, 2.4, 5.3, 0.3, "WHY", 11, GREEN, bold=True)
text(s, 7.13, 2.78, 5.3, 1.5,
     "Traffic auto-failed-over to HyperPay.\nThe successes were real — they just all came from a "
     "different gateway.\n\nThe blend hid the outage.", 12, INK, spacing=1.3)
callout(s, 0.62, 4.8, 12.1, 0.95, "the fix — and the habit",
        "Per-gateway zero-success watchdogs (UPG P1, HyperPay P2, Tap P2). The habit: whenever you see an "
        "average, ask “averaged over what?” — then split it.", "key")
text(s, 0.62, 6.0, 12.1, 0.4, "Try it now:  Troubleshoot → Payment → click through the gateway chips. Is one gateway worse than the others right now?",
     12, GREEN, bold=True)

# ============================== M2.4 ALERTS ==============================
s = slide(prs)
head(s, "module 2.4", "Alerts — 38 rules, 28 metrics, one golden rule",
     "The console watches continuously so nobody has to stare at a dashboard.")
box(s, 0.62, 2.1, 12.1, 0.95, GREENBG, GREEN)
text(s, 0.95, 2.32, 11.5, 0.5,
     "“An alert fires on CHANGE FROM NORMAL — not on the normal baseline.”", 16, GREEN, bold=True)
text(s, 0.95, 2.72, 11.5, 0.3,
     "The steady state lives on the SLA page. The Alerts page is for things that just got worse.", 11.5, BODY)
bullets(s, ["Every rule has: a window, a minimum sample gate, a severity and a written runbook",
            "Correlation: a provider outage pages ONCE as root cause, suppressing ~8 symptom rules",
            "Metric charts show a seasonal expected band — what's normal for this hour of the week",
            "Escalation ladder climbs until someone acknowledges (P1: 0 → 10 → 25 min)"],
        y=3.3, step=0.5, w=6.1)
shot(s, "d2-alerts", "Alerts · open alerts / metric charts", y=3.25, h=2.9)
callout(s, 0.62, 5.5, 6.1, 1.05, "acknowledging is not paperwork",
        "Ack stops the ladder climbing. It's how you stop your manager's phone ringing.", "info")

# ============================== LAB 2.3 ==============================
s = slide(prs)
labslide(s, "2.3", "Run an incident  (Scenario D)",
         "Practise the response, not just the observation. Roles: L1 responder · L2 · manager.",
         ["Open the incident. Read headline + severity aloud",
          "Read the runbook attached to it. Do step 1",
          "Acknowledge — and say why that matters",
          "State the blast radius: what else is affected?",
          "Hand over to L2: what, since when, what you checked",
          "L2: check correlation (root or symptom?) and related tickets"],
         "A handover naming the rule, the numbers and what was already checked — not “payments are broken”.",
         "If nothing is open right now, use Alerts → History and replay a past incident.", "25 min")

# ============================== QUIZ 2 ==============================
s = slide(prs)
quizslide(s, "2", "Troubleshooting & incidents", [
 "A payment is pending 45 min WITH a commit response. What is it, and what do you do?",
 "Same, but with NO commit response. What is it now?",
 "Why does the duplicate tile say “suspected” rather than “confirmed”?",
 "Blended success is 84% and looks fine. How can a gateway still be dead?",
 "Semati fails ~55% on a normal day. When should an alert fire?",
 "What does acknowledging an incident actually do?",
 "Which is an incident rather than a customer case?"], "10 min")

# ============================== DAY 3 DIVIDER ==============================
s = slide(prs, DARK)
divider(s, "Day 3", "Analytics, Tuning & Platform", "Build your own views · tune alerting safely · understand what's underneath", "2h 45m  ·  L2 + L3 + ops leads")

# ============================== M3.1 ANALYTICS ==============================
s = slide(prs)
head(s, "module 3.1", "Analytics — 14 dashboards, 79 panels, or build your own",
     "A charting workspace over live data. No BI ticket, no waiting.")
bullets(s, ["14 preset dashboards across 7 categories",
            "7 visualisation types: line · bar · stat · table · pie · donut · funnel",
            "7 datasets: payments · onboarding · activation · nafath · delivery · change_plan · checkouts",
            "Build: dataset → metric → viz → time bucket → group by → filters",
            "Save to a personal or shared dashboard"], y=2.15, step=0.48, w=6.1)
shot(s, "d3-analytics", "Analytics · a preset dashboard")
callout(s, 0.62, 4.85, 6.1, 1.6, "common mistakes",
        "Grouping by a field with hundreds of values (unreadable) · a window so short there's no data · "
        "using a rate when you wanted a count.", "warn")

# ============================== M3.2 ATTRIBUTION ==============================
s = slide(prs)
head(s, "module 3.2", "Attribution — how a number can be confidently wrong",
     "A true story from this console, and the reason you should always ask where a number comes from.")
box(s, 0.62, 2.15, 5.9, 2.5, REDBG, RED)
text(s, 0.9, 2.4, 5.3, 0.3, "WHAT WE REPORTED", 11, RED, bold=True)
text(s, 0.9, 2.78, 5.3, 1.6,
     "A reseller channel showed 311 orders.\n\nIt hadn't launched yet.\n\n"
     "The real number was 65 — and they were test orders.", 12, INK, spacing=1.3)
box(s, 6.85, 2.15, 5.85, 2.5, GREENBG, GREEN)
text(s, 7.13, 2.4, 5.3, 0.3, "WHY", 11, GREEN, bold=True)
text(s, 7.13, 2.78, 5.3, 1.6,
     "We counted via plan_channels — a CONFIG table meaning “which channels MAY sell this plan”.\n\n"
     "A plan enabled on 5 channels made 1 order count 5 times.", 12, INK, spacing=1.3)
callout(s, 0.62, 4.9, 12.1, 1.0, "the rule that prevents it",
        "Attribute from the fact recorded on the row itself (the order's own origin), never from a "
        "configuration table. “May sell” is not “did sell”.", "key")
text(s, 0.62, 6.15, 12.1, 0.4, "Habit to build: when a number surprises you, ask “what exactly was counted, and joined to what?”",
     12, GREEN, bold=True)

# ============================== M3.3 TUNING ==============================
s = slide(prs)
head(s, "module 3.3", "Tuning a rule without crying wolf",
     "An alert nobody trusts is worse than no alert. Here's the discipline.")
steps = [("1", "Look at the chart first", "Open the metric chart. What IS normal for this hour of the week? Read the seasonal band."),
         ("2", "Set above the noise", "Not above zero. The threshold should sit above normal variation, not above nothing."),
         ("3", "Gate the sample", "min_sample stops a quiet 04:00 hour from firing on three events."),
         ("4", "Test now", "Evaluates against live data without saving. It should NOT fire on a healthy system."),
         ("5", "Save, then watch 24h", "Trust it only after it has survived a full daily cycle."),
         ("6", "If it cried wolf — raise the bar", "Never delete the rule. A deleted rule is a blind spot with no record.")]
for i, (n, t, b) in enumerate(steps):
    x = 0.62 + (i % 2) * 6.2; y = 2.15 + (i // 2) * 1.42
    box(s, x, y, 5.9, 1.25)
    text(s, x + 0.28, y + 0.2, 0.35, 0.3, n, 14, GREEN, bold=True)
    text(s, x + 0.68, y + 0.2, 5.0, 0.28, t, 12.5, INK, bold=True)
    text(s, x + 0.68, y + 0.55, 5.0, 0.6, b, 10.5, BODY, spacing=1.18)
callout(s, 0.62, 6.5, 12.1, 0.75, "the test",
        "If you can't say what the rule would STILL catch after your change, you've broken it.", "stop")

# ============================== LAB 3.3 ==============================
s = slide(prs)
labslide(s, "3.3", "Tune a rule  (Scenario E)",
         "Make a noisy rule trustworthy again — without losing coverage.",
         ["Alerts → Metric charts → find the metric. Study the seasonal band",
          "Alerts → Alert rules → open the nominated rule",
          "Change ONE thing: threshold, window, min-sample or active hours",
          "Test now — it must NOT fire against healthy live data",
          "Save with a comment: what you changed and why",
          "Tell the room what it will still catch"],
         "A safer rule you can justify, with coverage intact.",
         "Changing two things at once means you won't know which one worked. One change at a time.", "20 min")

# ============================== M3.4 PLATFORM ==============================
s = slide(prs)
head(s, "module 3.4", "What's underneath — and why you should care",
     "Four engineering decisions that explain the behaviour you'll see day to day.")
items = [("Prod-sync + watchdog", "Read-only, watermarked, batched. A cron watchdog measures lag first and only syncs when behind — so a healthy system adds zero load to production."),
         ("Response caching", "Stale-while-revalidate: only the first viewer after a sync waits. A 30-day dashboard went from 4.6s to 8ms."),
         ("Everything is UTC", "Timestamps are stored as UTC in naive columns. A non-UTC process or DB session shifts every window — this bug once made the dashboard show zeros while the data was perfect."),
         ("Honest failure", "If the pipeline stalls, the console says so loudly. Wrong-but-plausible numbers are the most dangerous state a monitoring tool can be in.")]
for i, (t, b) in enumerate(items):
    x = 0.62 + (i % 2) * 6.2; y = 2.15 + (i // 2) * 1.95
    box(s, x, y, 5.9, 1.75)
    rule(s, x + 0.28, y + 0.24, 0.4, GREEN, 0.025)
    text(s, x + 0.28, y + 0.45, 5.3, 0.3, t, 13, INK, bold=True)
    text(s, x + 0.28, y + 0.82, 5.35, 0.85, b, 10.5, BODY, spacing=1.2)

# ============================== QUIZ 3 ==============================
s = slide(prs)
quizslide(s, "3", "Analytics, tuning & platform", [
 "An SLO says “at risk”. What does that mean, and what should you do?",
 "Where must reseller attribution come from — and why not plan_channels?",
 "What do you do BEFORE changing an alert threshold?",
 "What does “Test now” do?",
 "An alert cries wolf every night at 03:00. What's the right fix?",
 "Why does everything run in UTC?",
 "Yusr — where does your data go when you ask it a question?"], "10 min")

# ============================== HANDOVER ==============================
s = slide(prs)
head(s, "close", "It's yours now",
     "The console isn't finished and it isn't mine. Here's what happens next.")
for i, (t, b) in enumerate([
    ("Your first week", "Day 1: open the dashboard each morning.  Day 2: handle one real case end to end.  "
                        "Day 3: acknowledge one real incident.  Day 4: build one panel.  Day 5: report one thing that's wrong."),
    ("When something looks wrong", "Say so. Reseller numbers were once inflated by a bad join; a staleness banner "
                                   "once cried wolf overnight. Both were found by someone saying “that looks wrong”."),
    ("Where to get help", "Yusr (in-console) → the L1 cheat-sheet → your L2 → the console owner.")]):
    y = 2.15 + i * 1.4
    box(s, 0.62, y, 12.1, 1.2)
    rule(s, 0.9, y + 0.22, 0.4, GREEN, 0.025)
    text(s, 0.9, y + 0.43, 11.5, 0.3, t, 13.5, INK, bold=True)
    text(s, 0.9, y + 0.78, 11.5, 0.35, b, 11, BODY, spacing=1.2)
box(s, 0.62, 6.4, 12.1, 0.85, GREENBG, GREEN)
text(s, 0.95, 6.6, 11.5, 0.45,
     "Agree now:  who opens the dashboard each morning  ·  where feedback goes  ·  when we review the rules together",
     13, GREEN, bold=True)

prs.save(OUT)
n = len([f for f in glob.glob(os.path.join(SHOTS, "*")) if f.lower().endswith((".png", ".jpg", ".jpeg"))])
print(f"✓ {OUT}")
print(f"  slides: {len(prs.slides._sldIdLst)}   screenshots found: {n}")
