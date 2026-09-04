#!/usr/bin/env python3
"""
L2 Review Log — the artefact that makes the between-sessions loop real.

Four sheets:
  1 Findings        what L2 log during the day (the main one)
  2 Threshold sign-off   every rule, with a KEEP/CHANGE/DELETE verdict column
  3 Definitions sign-off what each KPI counts, confirmed or vetoed
  4 Alert triage     every alert that fired: actionable or noise

Rule and metric rows are generated FROM seedRules.js, so the sheet can never drift from the system.

USAGE   python3 build_l2_log.py
OUTPUT  L2-Review-Log.xlsx
"""
import os, re, json, subprocess
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(HERE, "..", "server", "src"))
OUT = os.path.join(HERE, "L2-Review-Log.xlsx")

GREEN = "008A47"; DARK = "0F172A"; LIGHT = "F1F5F9"; AMBER = "B45309"
HDR = Font(bold=True, color="FFFFFF", size=11)
THIN = Side(style="thin", color="D8DEE7")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def rules_from_source():
    """Read the live rule list rather than retyping it — a sign-off sheet that disagrees with the
    running system is worse than no sheet."""
    node = f"""
      const {{RULES}} = require({json.dumps(os.path.join(SRC, 'seedRules.js'))});
      console.log(JSON.stringify(RULES.map(r => ({{
        key: r.key, name: r.name, sev: r.severity, metric: r.metric_key,
        op: r.operator, th: r.threshold, win: r.window_hours, mins: r.min_sample || 0
      }}))));
    """
    try:
        out = subprocess.run(["node", "-e", node], capture_output=True, text=True, timeout=30)
        return json.loads(out.stdout.strip())
    except Exception as e:
        print(f"  ! could not read seedRules.js ({e}) — threshold sheet will be empty")
        return []


def sheet(wb, title, headers, widths, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = title[:31]
    ws.append(headers)
    for c in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = HDR
        cell.fill = PatternFill("solid", fgColor=GREEN)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 28
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[chr(64 + i)].width = w
    ws.freeze_panes = "A2"
    return ws


def dv(ws, col, options, rows=400):
    d = DataValidation(type="list", formula1='"' + ",".join(options) + '"', allow_blank=True)
    ws.add_data_validation(d)
    d.add(f"{col}2:{col}{rows}")


wb = Workbook()

# ── 1 · findings ────────────────────────────────────────────────────────────
ws = sheet(wb, "1 · Findings",
           ["Date", "Who", "Where (page)", "What you expected", "What the console showed",
            "Type", "Severity", "Evidence (order ref / alert id)", "Status", "Owner", "Fixed on", "Notes"],
           [11, 14, 18, 34, 34, 14, 11, 26, 13, 14, 11, 30], first=True)
dv(ws, "F", ["Data wrong", "Alert noisy", "Alert missing", "Hard to use", "Feature gap", "Question"])
dv(ws, "G", ["Blocker", "High", "Medium", "Low"])
dv(ws, "I", ["New", "Triaged", "In progress", "Fixed", "Won't fix", "Not a defect"])
ws.append(["", "", "Dashboard", "e.g. 215 orders for the last hour",
           "e.g. 198 — disagrees with the Orders KPI", "Data wrong", "High",
           "order ref / screenshot", "New", "", "", "EXAMPLE ROW — delete me"])
for c in range(1, 13):
    ws.cell(row=2, column=c).font = Font(italic=True, color="94A3B8", size=10)

# ── 2 · threshold sign-off ──────────────────────────────────────────────────
rules = rules_from_source()
ws2 = sheet(wb, "2 · Threshold sign-off",
            ["Rule key", "Name", "Sev", "Metric", "Condition", "Window", "Min sample",
             "Verdict", "New threshold", "Why (in your words)", "Reviewed by"],
            [26, 42, 7, 24, 16, 9, 11, 12, 14, 40, 14])
dv(ws2, "H", ["KEEP", "CHANGE", "DELETE", "MISSING RULE"])
sev_fill = {"P1": "FEE2E2", "P2": "FEF3C7", "P3": "DBEAFE"}
for r in rules:
    ws2.append([r["key"], r["name"], r["sev"], r["metric"],
                f'{r["op"]} {r["th"]}', f'{r["win"]}h', r["mins"], "", "", "", ""])
    row = ws2.max_row
    ws2.cell(row=row, column=3).fill = PatternFill("solid", fgColor=sev_fill.get(r["sev"], "FFFFFF"))
    ws2.cell(row=row, column=3).alignment = Alignment(horizontal="center")
    for c in range(1, 12):
        ws2.cell(row=row, column=c).border = BORDER
        ws2.cell(row=row, column=c).alignment = Alignment(wrap_text=True, vertical="top")
ws2.auto_filter.ref = f"A1:K{ws2.max_row}"

# ── 3 · definitions sign-off ────────────────────────────────────────────────
ws3 = sheet(wb, "3 · Definitions",
            ["Area", "What it counts today", "The question", "Confirmed?", "If not — correct definition", "Owner"],
            [24, 46, 40, 13, 46, 14])
dv(ws3, "D", ["Confirmed", "Needs change", "Undecided"])
for row in [
    ("Eligibility pass", "is_eligible = true", "does this match how CITC/Semati decides?"),
    ("Total payment", "eligible AND a payment row exists", "should abandoned checkouts count here?"),
    ("Pending payment", "status pending or initiated", "how long before pending means STUCK? (now 3h)"),
    ("Stuck payment", "pending AND gateway commit response present", "is the commit-response test right?"),
    ("Physical SIM", "paid AND sim_type is not eSIM", "any other SIM types missing?"),
    ("Not assigned", "no delivery request AND not a partner", "is the partner split right? (new this week)"),
    ("Partner fulfilled", "order origin is tygo or soob", "is the partner list complete?"),
    ("Delivered", "delivery_state in the completed list", "is that list complete and current?"),
    ("Activated", "onboarding_orders.activated", "does BSS agree with this flag?"),
    ("Reseller attribution", "external_service_name on the order row", "confirm we never use plan_channels"),
    ("Data freshness", "amber at 10 min, red at 45 min", "are those the right thresholds for you?"),
    ("Coverage", "replica + OSB + APIGW probe only", "which missing source hurts most?"),
]:
    ws3.append(list(row) + ["", "", ""])
    for c in range(1, 7):
        ws3.cell(row=ws3.max_row, column=c).border = BORDER
        ws3.cell(row=ws3.max_row, column=c).alignment = Alignment(wrap_text=True, vertical="top")

# ── 4 · alert triage ────────────────────────────────────────────────────────
ws4 = sheet(wb, "4 · Alert triage",
            ["Date/time", "Rule", "Sev", "Actionable or noise?", "Did you act?", "What you did",
             "Should it have fired?", "Notes"],
            [17, 30, 7, 20, 13, 40, 20, 32])
dv(ws4, "D", ["Actionable", "Noise", "Not sure"])
dv(ws4, "E", ["Yes", "No", "Acknowledged only"])
dv(ws4, "G", ["Yes", "No — too sensitive", "No — wrong metric", "Yes but too late"])

wb.save(OUT)
print(f"✓ {OUT}")
print(f"  sheet 2 pre-filled with {len(rules)} live rules"
      f"{' (from seedRules.js)' if rules else ''}")
print("  every sheet has drop-downs so verdicts stay consistent")
