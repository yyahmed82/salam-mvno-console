#!/usr/bin/env python3
"""
Salam Digital Console — presentation builder.

Design system lifted from salam_console_enhanced.pptx (the Ops Console deck) so the two
decks look like one family: 16:9, near-black #0A0A0F, Salam green #00D66F, Liter type,
left copy column + right screenshot panel, numbered section dividers.

USAGE
    python3 build_deck.py

Screenshots: drop PNGs into ./shots/ named exactly as listed in shots/README.md
(e.g. 04-login.png). Re-run this script any time — slots with an image get the real
screenshot, slots without get a styled placeholder telling you what to capture.
Running it again is safe and idempotent; it always rewrites the .pptx from scratch.
"""
import os, glob
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
OUT = os.path.join(HERE, "Salam-Digital-Console.pptx")

# ---- design tokens (extracted from the reference deck) ----
BG      = RGBColor(0x0A, 0x0A, 0x0F)
GREEN   = RGBColor(0x00, 0xD6, 0x6F)
WHITE   = RGBColor(0xFF, 0xFF, 0xFF)
BODY    = RGBColor(0xE5, 0xE7, 0xEB)
MUTED   = RGBColor(0x9C, 0xA3, 0xAF)
PANEL   = RGBColor(0x12, 0x12, 0x1A)
BORDER  = RGBColor(0x1F, 0x29, 0x37)
AMBER   = RGBColor(0xF5, 0x9E, 0x0B)
RED     = RGBColor(0xDC, 0x26, 0x26)
FONT    = "Liter"

W, H = Inches(13.333), Inches(7.5)


def new_deck():
    p = Presentation()
    p.slide_width, p.slide_height = W, H
    return p


def slide(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])          # blank
    bg = s.background.fill
    bg.solid(); bg.fore_color.rgb = BG
    return s


def text(s, x, y, w, h, txt, size=12, color=BODY, bold=False, align=PP_ALIGN.LEFT,
         spacing=1.0, anchor=MSO_ANCHOR.TOP):
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    lines = txt.split("\n")
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        r = p.add_run(); r.text = ln
        f = r.font; f.name = FONT; f.size = Pt(size); f.bold = bold; f.color.rgb = color
    return tb


def rule(s, x, y, w=0.62, color=GREEN, h=0.03):
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = color
    sh.line.fill.background(); sh.shadow.inherit = False
    return sh


def panel(s, x, y, w, h, fill=PANEL, line=BORDER, radius=True):
    shape = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    sh = s.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = fill
    sh.line.color.rgb = line; sh.line.width = Pt(0.75)
    sh.shadow.inherit = False
    try: sh.adjustments[0] = 0.03
    except Exception: pass
    return sh


def header(s, eyebrow, title, sub=None, subw=3.45, subsize=12.5):
    text(s, 0.62, 0.31, 6.0, 0.19, eyebrow.upper(), 10.5, MUTED)
    text(s, 0.62, 0.62, 7.6, 0.42, title.upper(), 21, WHITE)
    rule(s, 0.62, 1.12)
    if sub:
        # width/size are tunable: card slides get a wide subtitle, screenshot slides a narrow one
        text(s, 0.62, 1.35, subw, 1.05, sub, subsize, BODY, spacing=1.18)


def bullets(s, items, x=0.62, y=2.62, w=3.35, step=0.66):
    for i, b in enumerate(items):
        text(s, x, y + i * step, w, 0.56, "● " + b, 12, GREEN, spacing=1.12)


def stats(s, pairs, y=5.35, x=0.62, gap=1.15):
    for i, (num, lbl) in enumerate(pairs):
        text(s, x + i * gap, y, 1.10, 0.52, num, 27, GREEN)
        text(s, x + i * gap, y + 0.52, 1.10, 0.21, lbl.upper(), 9, MUTED)


def shot(s, slot, caption, x=4.45, y=1.25, w=8.38, h=5.42):
    """Insert shots/<slot>.png if present, else a styled 'capture this' placeholder."""
    hit = glob.glob(os.path.join(SHOTS, slot + ".*"))
    hit = [f for f in hit if f.lower().endswith((".png", ".jpg", ".jpeg"))]
    if hit:
        pic = s.shapes.add_picture(hit[0], Inches(x), Inches(y), width=Inches(w))
        # keep inside the frame: if too tall, re-add constrained by height
        if pic.height > Inches(h):
            sp = pic._element; sp.getparent().remove(sp)
            pic = s.shapes.add_picture(hit[0], Inches(x), Inches(y), height=Inches(h))
            pic.left = Inches(x + (w - pic.width.inches) / 2)
        return pic
    ph = panel(s, x, y, w, h)
    text(s, x, y + h / 2 - 0.55, w, 0.3, "▢", 22, RGBColor(0x37, 0x41, 0x51), align=PP_ALIGN.CENTER)
    text(s, x, y + h / 2 - 0.12, w, 0.3, slot + ".png", 13, MUTED, align=PP_ALIGN.CENTER)
    text(s, x, y + h / 2 + 0.30, w, 0.6, caption, 10.5, RGBColor(0x6B, 0x72, 0x80),
         align=PP_ALIGN.CENTER, spacing=1.2)
    return ph


def divider(s, num, title, sub):
    text(s, 0.62, 1.46, 4.17, 1.67, num, 90, GREEN)
    text(s, 0.62, 3.33, 11.0, 0.57, title.upper(), 33, WHITE, bold=True)
    rule(s, 0.62, 4.04, 0.83)
    text(s, 0.62, 4.27, 9.0, 0.6, sub, 16.5, BODY)


def card(s, x, y, w, h, title, body, accent=GREEN, tsize=13, bsize=11):
    """Panel with an accent tick, a title and a body. Body height is clamped so a short
    card can never compute a negative box (which silently spilled text across the slide)."""
    panel(s, x, y, w, h)
    rule(s, x + 0.28, y + 0.22, 0.34, accent, 0.025)
    text(s, x + 0.28, y + 0.38, w - 0.56, 0.3, title, tsize, WHITE)
    text(s, x + 0.28, y + 0.72, w - 0.56, max(0.3, h - 0.85), body, bsize, BODY, spacing=1.22)


# ==================================================================================
prs = new_deck()

# ---------- 1 COVER ----------
s = slide(prs)
panel(s, 1.04, 0.42, 11.25, 6.67, BG, BORDER)
text(s, 0, 2.29, 13.333, 0.21, "MVNO DIGITAL OPERATIONS", 10.5, MUTED, align=PP_ALIGN.CENTER)
text(s, 0, 2.62, 13.333, 0.95, "DIGITAL CONSOLE", 42, WHITE, bold=True, align=PP_ALIGN.CENTER)
rule(s, 5.62, 3.75, 2.08)
text(s, 0, 4.06, 13.333, 0.4, "See every journey. Catch every failure. Before the customer calls.",
     16.5, BODY, align=PP_ALIGN.CENTER)
text(s, 0, 4.62, 13.333, 0.26, "Salam Mobile  ·  Digital Ops  ·  v1.0", 12, MUTED, align=PP_ALIGN.CENTER)
stats(s, [("38", "alert rules"), ("24", "journeys"), ("79", "panels"), ("16M", "rows watched")],
      y=5.55, x=3.9, gap=1.55)

# ---------- 2 THE PAIN ----------
s = slide(prs)
header(s, "the problem", "Blind spots cost money",
       "Every dashboard said production was healthy — while customers were being charged twice, "
       "left unactivated, and told to call back.", subw=11.9, subsize=13.5)
rows = [
 ("A gateway goes down and nobody notices",
  "UPG stopped taking payments. Failover to HyperPay kept the blended rate green — L1 found out "
  "34 minutes later, from a customer."),
 ("Money taken, order never completes",
  "The gateway captured the charge; the confirmation never landed. Counted as neither success "
  "nor failure — it fell through silently."),
 ("The same customer charged twice",
  "One order, two captures at the gateway — only visible by reconciling against the provider."),
 ("A provider that flaps under a noisy baseline",
  "Semati fails ~55% on a normal day. A flat threshold either screams all day or never fires."),
]
for i, (t, b) in enumerate(rows):
    card(s, 0.62, 2.55 + i * 1.16, 6.0, 1.06, t, b, RED, 12, 9.5)
panel(s, 7.05, 2.55, 5.67, 4.4)
text(s, 7.38, 2.85, 5.0, 0.3, "WHAT IT COST", 12, WHITE)
rule(s, 7.38, 3.2, 0.34, RED, 0.025)
for i, (k, v) in enumerate([
    ("34 min", "blind spot before a gateway outage was noticed"),
    ("Silent", "captured-but-unconfirmed payments, excluded from every rate"),
    ("Manual", "three teams and a WhatsApp group to answer one question"),
    ("Reactive", "the customer was the monitoring system"),
]):
    yy = 3.48 + i * 0.83
    text(s, 7.38, yy, 1.55, 0.4, k, 16, RED)
    text(s, 8.95, yy + 0.04, 3.5, 0.7, v, 10, BODY, spacing=1.18)

# ---------- 3 THE SOLUTION ----------
s = slide(prs)
header(s, "the solution", "One console. Every journey.",
       "Live production telemetry, plain-English alerts and a guided runbook — in one place, "
       "for every team.")
bullets(s, ["All 24 journeys, end to end", "Failure → root cause in minutes",
            "Alerts on change, not on baseline", "Role-scoped · PII masked by default"])
stats(s, [("6", "nav areas"), ("38", "rules"), ("28", "metrics"), ("11", "roles")])
shot(s, "03-dashboard-hero", "Dashboard · full page, 30d range")

# ---------- 4 SCALE ----------
s = slide(prs)
header(s, "the scale", "What it watches",
       "Real production volume, synced continuously from the prod replica — read-only, never a "
       "write path.", subw=11.9, subsize=13.5)
tbl = [("16.0M", "devices seen"), ("8.0M", "order attempts"), ("4.9M", "payment attempts"),
       ("4.4M", "activation calls"), ("2.3M", "Nafath checks"), ("506K", "registered users")]
for i, (n, l) in enumerate(tbl):
    x = 0.62 + (i % 3) * 4.15; y = 2.2 + (i // 3) * 1.5
    panel(s, x, y, 3.85, 1.25)
    text(s, x + 0.3, y + 0.22, 3.2, 0.55, n, 30, GREEN)
    text(s, x + 0.3, y + 0.82, 3.2, 0.25, l.upper(), 10, MUTED)
panel(s, 0.62, 5.35, 12.1, 1.4)
text(s, 0.95, 5.62, 11.4, 0.3, "THE FUNNEL, IN ONE LINE", 11, WHITE)
text(s, 0.95, 5.98, 11.4, 0.5,
     "16M devices  →  8M order attempts  →  2.6M checkouts  →  4.9M payment attempts  "
     "→  506K users  ·  362K deliveries", 13, GREEN)

# ---------- 5 SECTION 01 ----------
s = slide(prs); divider(s, "01", "Why it matters", "Four real incidents — and what the console now catches")

# ---------- 6 PROOF: UPG ----------
s = slide(prs)
header(s, "proof · INC0014859", "The outage that hid behind failover",
       "Failover to HyperPay kept the blended rate green — so no aggregate dashboard could see it.")
bullets(s, ["Per-gateway zero-success watchdog (P1)",
            "Fires even when failover masks the blend",
            "Sibling rules for HyperPay & Tap",
            "Colour-coded gateway chips on Troubleshoot"])
stats(s, [("30m", "detect window"), ("3", "gateway watchdogs"), ("P1", "severity")])
shot(s, "06-upg-alert", "Alerts › rule detail — UPG gateway zero-success watchdog")

# ---------- 7 PROOF: PAYMENTS ----------
s = slide(prs)
header(s, "proof · UPG / Tap", "Charged but not activated",
       "Pending payments were excluded from the failure-rate denominator — so a captured charge "
       "counted as neither success nor failure.")
bullets(s, ["\"Payment stuck (unconfirmed)\" tile — with refs",
            "\"Payment duplicate (suspected)\" tile",
            "Tightened to require a real commit response",
            "Tap reconciliation confirms authoritatively"])
stats(s, [("2", "new metrics"), ("3", "new rules"), ("2", "drill-downs")])
shot(s, "07-payment-stuck", "Troubleshoot › Payment stuck (unconfirmed) tile + feed")

# ---------- 8 PROOF: SEMATI ----------
s = slide(prs)
header(s, "proof · INC0012977 / INC0013148", "Catching a provider that flaps",
       "Semati returns 715 and transport errors intermittently — invisible to a flat threshold "
       "against a ~55% baseline.")
bullets(s, ["7-rule family tuned above the baseline",
            "Flapping rule: ok→fail transitions, not a rate",
            "Correlation pages once, not ten times",
            "Synthetic canary covers the 3am no-traffic gap"])
stats(s, [("7", "semati rules"), ("60s", "canary"), ("1", "page, not 10")])
shot(s, "08-semati-correlation", "Alerts › open incident with correlation + blast radius")

# ---------- 9 PROOF: BSS READ PATH ----------
s = slide(prs)
header(s, "proof · OSB 1500 / OSB-382000", "The faults nobody could see",
       "BSS read APIs threw SOAP faults in bursts of 100–200/min. Writes still succeeded, so "
       "activation dashboards stayed green.")
bullets(s, ["Reads logs.uil_logs directly — a separate DB",
            "Live per-minute fault frequency + top APIs",
            "P1 watcher when faults spike",
            "Reference card tells L1 exactly where to look"])
stats(s, [("1500", "fault code"), ("100–200", "per minute"), ("P1", "watcher")])
shot(s, "09-osb-faults", "Troubleshoot › Activation › BSS read-path OSB fault panel")

# ---------- 10 BEFORE / AFTER ----------
s = slide(prs)
header(s, "the shift", "From reactive to proactive",
       "The same incident, before and after the console.", subw=11.9, subsize=13.5)
panel(s, 0.62, 2.1, 5.9, 4.4); panel(s, 6.82, 2.1, 5.9, 4.4)
text(s, 0.95, 2.42, 5.2, 0.3, "BEFORE", 13, RED)
text(s, 7.15, 2.42, 5.2, 0.3, "AFTER", 13, GREEN)
before = ["Customer calls the call centre",
          "Agent escalates to L1 on WhatsApp",
          "L1 asks BSS, Payments, and Digital",
          "Someone greps logs on three systems",
          "Hours later: a root cause, maybe",
          "No record, no trend, no prevention"]
after = ["Console pages on-call in minutes",
         "Incident carries its own runbook",
         "Root cause named + blast radius printed",
         "Agent sees the customer's full timeline",
         "One-click ack · assign · resolve",
         "History proves recurrence to the vendor"]
for i, b in enumerate(before):
    text(s, 0.95, 2.95 + i * 0.56, 5.3, 0.4, "✕  " + b, 11, BODY)
for i, a in enumerate(after):
    text(s, 7.15, 2.95 + i * 0.56, 5.3, 0.4, "✓  " + a, 11, GREEN)

# ---------- 11 SECTION 02 ----------
s = slide(prs); divider(s, "02", "Daily operations", "Sign in, see the day, fix what broke")

# ---------- 12 LOGIN ----------
s = slide(prs)
header(s, "secure access", "Sign in with your work email",
       "A one-time code to your Salam address, then a real server-side session — and you only see "
       "what your role needs.")
bullets(s, ["@salam.sa / @salammobile.sa only — enforced",
            "Registered accounts only; no self-signup",
            "12-hour sliding session, token never stored raw",
            "PII masked by default — unmask is audited"])
stats(s, [("11", "roles"), ("8×6", "views×caps"), ("20", "PII fields")])
shot(s, "12-login", "Sign-in card — email step (and code step if you have it)")

# ---------- 13 DASHBOARD ----------
s = slide(prs)
header(s, "dashboard", "The whole business, one screen",
       "Eight KPIs with deltas, eight journey-health tiles, and a banner that says in plain English "
       "whether today is fine.")
bullets(s, ["Coloured against SLA target, not a raw number",
            "Today · Yesterday · 7d · 30d + intra-day",
            "Customize: pick sections, 3 role presets",
            "Loud banner if data is stale — never silent"])
stats(s, [("8", "KPIs"), ("8", "journeys"), ("3", "presets")])
shot(s, "13-dashboard-kpis", "Dashboard › KPI strip + journey health + NOC banner")

# ---------- 14 FLOW TREE ----------
s = slide(prs)
header(s, "order status flow", "Where orders actually stop",
       "Eligibility → payment → activation & delivery. Every box is clickable and lists the exact "
       "orders behind it.")
bullets(s, ["19 labelled nodes across 3 stages",
            "New SIM and MNP lanes side by side",
            "Reconciles to the Orders KPI",
            "Click any node → the order list → the timeline"])
stats(s, [("19", "nodes"), ("2", "lanes"), ("3", "stages")])
shot(s, "14-flow-tree", "Dashboard › Order status flow (both lanes visible)")

# ---------- 15 TROUBLESHOOT ----------
s = slide(prs)
header(s, "troubleshoot", "Type a number. See what broke.",
       "Live failures grouped by category and owner team — searchable by mobile, order, ICCID or "
       "national ID.")
bullets(s, ["10 categories, each with its owner team",
            "Code · message drill-down on 5 categories",
            "Gateway chips: UPG · HyperPay · Tap · Samsung",
            "Export any view to CSV or JSON"])
stats(s, [("10", "categories"), ("5", "drill-downs"), ("4", "search keys")])
shot(s, "15-troubleshoot", "Troubleshoot › Error Control Board with category tiles")

# ---------- 16 TIMELINE ----------
s = slide(prs)
header(s, "subscriber 360 & timeline", "One customer, one story",
       "Payment, activation, Nafath, eligibility, delivery and plan change — assembled into one "
       "chronological narrative.")
bullets(s, ["Search by MSISDN or national ID",
            "Request/response captured at each step",
            "Masked by default; unmask is logged",
            "Answers \"what happened to this customer?\""])
stats(s, [("6", "systems joined"), ("1", "timeline")])
shot(s, "16-timeline", "Troubleshoot › expanded row timeline, or #sub360")

# ---------- 17 ALERTS ----------
s = slide(prs)
header(s, "alerts", "It watches so you don't have to",
       "38 rules over 28 metrics, each with a window, a sample gate and a runbook — alerting on "
       "change from normal, not on the baseline.")
bullets(s, ["Open · History · Metric charts · Rules",
            "Seasonal expected-range band on every chart",
            "Self-serve: edit, test against live, save",
            "Replay history as live traffic to tune"])
stats(s, [("38", "rules"), ("28", "metrics"), ("P1–P3", "severities")])
shot(s, "17-alerts", "Alerts › Open alerts (or Metric charts with the band)")

# ---------- 18 GUIDED RESPONSE ----------
s = slide(prs)
header(s, "guided response", "The runbook comes with the alert",
       "Every incident carries its steps, blast radius and escalation path — so whoever is paged at "
       "3am never hunts for the wiki.")
bullets(s, ["Runbook steps written per rule",
            "Root cause named; symptoms suppressed under it",
            "Ack · assign · snooze · resolve · comment",
            "On-call ladder climbs until acknowledged"])
stats(s, [("0/10/25", "P1 ladder (min)"), ("5", "channels")])
shot(s, "18-guided-response", "Alerts › incident detail with runbook + Notify on-call")

# ---------- 19 SLA ----------
s = slide(prs)
header(s, "SLA & vendor health",
       "Are we keeping our promises?",
       "Seven service levels with attainment and error budget, plus per-vendor health for gateways "
       "and couriers.")
bullets(s, ["7 SLOs: met · at risk · breached",
            "Error budget remaining, 7-day sparkline",
            "Vendor board over 24h / 7d / 30d",
            "Anomaly detection vs seasonal baseline"])
stats(s, [("7", "SLOs"), ("168", "baseline buckets"), ("3.5σ", "threshold")])
shot(s, "19-sla", "SLA › service levels + vendor health board")

# ---------- 20 SECTION 03 ----------
s = slide(prs); divider(s, "03", "Insight & growth", "From what broke — to what's working")

# ---------- 21 ANALYTICS ----------
s = slide(prs)
header(s, "analytics", "A BI workspace, built in",
       "Fourteen dashboards and seventy-nine panels over live data — and anyone can build their own "
       "without raising a ticket.")
bullets(s, ["14 dashboards · 79 panels · 7 datasets",
            "7 chart types, all dependency-free",
            "Add a panel: dataset → metric → viz → filters",
            "Save personal or shared dashboards"])
stats(s, [("14", "dashboards"), ("79", "panels"), ("7", "viz types")])
shot(s, "21-analytics", "Analytics › a rich dashboard (Payments or Overview)")

# ---------- 22 GROWTH ----------
s = slide(prs)
header(s, "growth", "Which channels actually produce lines",
       "Sales paths, resellers, campaigns and referrals — measured by activated lines, not clicks.")
bullets(s, ["Funnel by sales path with conversion",
            "Campaigns by source · medium (UTM)",
            "Acquisition × distribution matrix",
            "Apollo referral leaderboard"])
stats(s, [("8", "sales paths"), ("5", "sections"), ("3", "periods")])
shot(s, "22-growth", "Growth › Resellers & Campaigns (sections ① and ②)")

# ---------- 23 MNP ----------
s = slide(prs)
header(s, "MNP port-ins", "Who is switching to Salam — and from where",
       "Port-ins by donor operator with activation rate. Low activation on one donor means porting "
       "friction, not demand.")
bullets(s, ["Per-operator: port-ins, share, activation rate",
            "Spot a donor-specific porting problem",
            "Top donor + overall activation at a glance",
            "Also available as a home dashboard section"])
stats(s, [("5", "growth section"), ("MNP", "lane on the flow tree")])
shot(s, "23-mnp-donors", "Growth › ⑤ MNP port-ins by donor operator")

# ---------- 24 DEALERS / QR ----------
s = slide(prs)
header(s, "dealers & QR partners", "Channel performance, end to end",
       "Attempts, completions, conversion and stalled orders per dealer and QR partner, with "
       "integration health alongside.")
bullets(s, ["KPI tiles: attempts → completed → activated",
            "Top dealers, plan mix, orders over time",
            "QR/POSA source leaderboard",
            "Integration health bars per journey"])
stats(s, [("2", "scopes"), ("6", "KPI tiles")])
shot(s, "24-dealers", "Dealers dashboard (or QR partners scope)")

# ---------- 25 SECTION 04 ----------
s = slide(prs); divider(s, "04", "Intelligence & platform", "The AI teammate, the integrations, and the engineering underneath")

# ---------- 26 YUSR ----------
s = slide(prs)
header(s, "Yusr  ·  يُسر", "An AI teammate that knows your data",
       "Ask in plain language and get one answer instead of five screens. Runs on-premise — data "
       "never leaves the network.")
bullets(s, ["Customer · alerts · runbook · smalltalk intents",
            "Cites open CST/ServiceNow tickets by number",
            "PII masked to the asker's own permissions",
            "Degrades to rule-based answers if the LLM is down"])
stats(s, [("100%", "on-network"), ("4", "intents"), ("0", "data egress")])
shot(s, "26-yusr", "Yusr chat open with a subscriber answer")

# ---------- 27 INTEGRATIONS ----------
s = slide(prs)
header(s, "integrations", "Read-only by design",
       "The console reaches into six external systems to enrich what it shows — and writes to "
       "none of them.", subw=11.9, subsize=13.5)
items = [("ServiceNow", "Related customer tickets on every incident; Yusr cites them by number."),
         ("OSB · uil_logs", "BSS read-path SOAP faults from a database nothing else replicates."),
         ("Tap", "Authoritative reconciliation for duplicate and stuck charges."),
         ("Semati canary", "Synthetic probe every 60s — catches outages with no traffic."),
         ("API Gateway probe", "True per-node reachability, TCP connect only."),
         ("Teams · Slack · WhatsApp · SMS · Email", "Five ways to reach on-call, severity-gated.")]
for i, (t, b) in enumerate(items):
    x = 0.62 + (i % 2) * 6.2; y = 2.1 + (i // 2) * 1.55
    card(s, x, y, 5.9, 1.35, t, b, GREEN, 12.5, 10)

# ---------- 28 TOPOLOGY ----------
s = slide(prs)
header(s, "topology & API gateway", "The map of everything",
       "43 nodes, 56 flows — plus a live NOC view of the DMS integration hub with real per-node "
       "reachability.")
bullets(s, ["43 nodes · 56 flows · 9 flow types",
            "32 external integrations catalogued",
            "43 Sidekiq workers across 22 queues",
            "Live green/amber/red per gateway node"])
stats(s, [("43", "nodes"), ("32", "integrations"), ("15", "webhooks")])
shot(s, "28-topology", "Topology page — or the #apigw hub map with the live status strip")

# ---------- 29 SECURITY ----------
s = slide(prs)
header(s, "security & governance", "Least privilege, and a record of everything",
       "Eleven roles across an editable matrix. Customer data is masked unless a named senior "
       "unmasks it — and that is logged.")
bullets(s, ["Domain-locked sign-in, server-side sessions",
            "Only Super Admin & L3 Digital can unmask PII",
            "Audit log: logins, unmasks, rule & user changes",
            "Read-only against production, always"])
stats(s, [("11", "roles"), ("20", "PII fields"), ("100%", "read-only")])
shot(s, "29-roles", "Settings › Roles & permissions matrix (or Audit log)")

# ---------- 30 RELIABILITY ----------
s = slide(prs)
header(s, "reliability engineering", "Built to stay honest",
       "The console's biggest risk is showing stale numbers as if they were live. Several layers "
       "exist purely to prevent that.", subw=11.9, subsize=13.5)
items = [("Prod-sync", "Read-only session, watermarks, bounded batches — never a write path, never a load spike."),
         ("Watchdog (cron)", "Measures lag first, syncs only when behind, retries with backoff, self-heals a wedged cursor."),
         ("Staleness banner", "If data is behind, that outranks every other status — figures are marked NOT live."),
         ("Response cache", "Stale-while-revalidate + single-flight: 30-day views open instantly, DB spared the repeat work.")]
for i, (t, b) in enumerate(items):
    x = 0.62 + (i % 2) * 6.2; y = 2.1 + (i // 2) * 1.62
    card(s, x, y, 5.9, 1.42, t, b, GREEN, 12.5, 10)
panel(s, 0.62, 5.5, 12.1, 1.1)
text(s, 0.95, 5.72, 11.5, 0.3, "MEASURED", 11, WHITE)
text(s, 0.95, 6.05, 11.5, 0.35,
     "30-day dashboard 4.6s → 8ms cached   ·   timeline lookups 20–30s → indexed   ·   "
     "sync lag alert at 10 min, critical at 45", 12, GREEN)

# ---------- 31 STATUS ----------
s = slide(prs)
header(s, "where we are", "Live in production",
       "Deployed on the internal network, syncing from the prod replica, serving the team today.", subw=11.9, subsize=13.5)
panel(s, 0.62, 2.1, 5.9, 4.3); panel(s, 6.82, 2.1, 5.9, 4.3)
text(s, 0.95, 2.42, 5.2, 0.3, "RUNNING NOW", 13, GREEN)
for i, t in enumerate(["Console live on the internal network",
                       "Prod-sync every 5 minutes, watchdog on cron",
                       "38 alert rules armed",
                       "Role-based access + audit log active",
                       "OSB BSS fault monitoring connected",
                       "Published to the team via reverse proxy"]):
    text(s, 0.95, 2.95 + i * 0.55, 5.3, 0.4, "✓  " + t, 11, GREEN)
text(s, 7.15, 2.42, 5.2, 0.3, "NEXT", 13, AMBER)
for i, t in enumerate(["SMTP relay whitelist — email alerts & OTP",
                       "API-gateway probe targets (SOC firewall)",
                       "ServiceNow ticket correlation (SOC firewall)",
                       "Yusr LLM model on-box",
                       "Roll out to wider ops & commercial teams",
                       "Tune thresholds against live baselines"]):
    text(s, 7.15, 2.95 + i * 0.55, 5.3, 0.4, "→  " + t, 11, BODY)

# ---------- 32 CLOSE ----------
s = slide(prs)
panel(s, 1.04, 0.42, 11.25, 6.67, BG, BORDER)
text(s, 0, 2.5, 13.333, 0.21, "SALAM DIGITAL CONSOLE", 10.5, MUTED, align=PP_ALIGN.CENTER)
text(s, 0, 2.85, 13.333, 0.8, "Know first. Fix faster.", 38, WHITE, bold=True, align=PP_ALIGN.CENTER)
rule(s, 5.62, 3.85, 2.08)
text(s, 0, 4.15, 13.333, 0.8,
     "Every journey, every failure, every customer — in one place.\n"
     "Built from real incidents, for the people who answer for them.",
     15, BODY, align=PP_ALIGN.CENTER, spacing=1.3)
stats(s, [("38", "rules"), ("28", "metrics"), ("79", "panels"), ("24", "journeys"), ("11", "roles")],
      y=5.5, x=3.35, gap=1.35)

prs.save(OUT)
n_ph = len(glob.glob(os.path.join(SHOTS, "*.png"))) + len(glob.glob(os.path.join(SHOTS, "*.jpg")))
print(f"✓ {OUT}")
print(f"  slides: {len(prs.slides.__iter__.__self__._sldIdLst)}   screenshots found: {n_ph}")
