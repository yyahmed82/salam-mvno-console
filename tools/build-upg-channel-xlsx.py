#!/usr/bin/env python3
"""Web vs Mobile-app UPG payments workbook — daily table + line chart + % split.
Usage: python3 tools/build-upg-channel-xlsx.py /tmp/upg-channel-2026-08.json ../UPG-Web-vs-App-Aug2026.xlsx
Input: JSON from server/src/upgChannelSplit.js. Grouping: mobile = ios/android/huawei;
web = web/desktop/browser; anything else (incl. '(not stamped)') = its own honest column."""
import json, sys
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.chart import LineChart, Reference
from openpyxl.styles import Font, PatternFill, Alignment

src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src))
MOBILE = {"ios", "android", "huawei", "harmony"}
WEB = {"web", "desktop", "browser", "mweb"}

days = defaultdict(lambda: {"web": 0, "mobile": 0, "other": 0, "web_ok": 0, "mobile_ok": 0,
                            "web_amt": 0.0, "mobile_amt": 0.0, "other_names": set()})
raw_platforms = defaultdict(int)
for r in d["app_daily"]:
    day = str(r["day"])[:10]; p = r["platform"]; raw_platforms[p] += r["n"]
    b = days[day]
    if p in MOBILE:
        b["mobile"] += r["n"]; b["mobile_ok"] += r["ok"]; b["mobile_amt"] += float(r["ok_amount"] or 0)
    elif p in WEB:
        b["web"] += r["n"]; b["web_ok"] += r["ok"]; b["web_amt"] += float(r["ok_amount"] or 0)
    else:
        b["other"] += r["n"]; b["other_names"].add(p)

wb = Workbook(); ws = wb.active; ws.title = "Daily Web vs App"
hdr = ["Day", "Web payments", "Mobile-app payments", "Other/unstamped", "Total",
       "Web %", "Mobile %", "Web success", "Mobile success",
       "Web success SAR", "Mobile success SAR"]
ws.append(hdr)
for c in ws[1]:
    c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1F7A4D")
    c.alignment = Alignment(horizontal="center")
tw = tm = to_ = 0
for day in sorted(days):
    b = days[day]; tot = b["web"] + b["mobile"] + b["other"]
    tw += b["web"]; tm += b["mobile"]; to_ += b["other"]
    ws.append([day, b["web"], b["mobile"], b["other"], tot,
               round(100 * b["web"] / tot, 1) if tot else 0,
               round(100 * b["mobile"] / tot, 1) if tot else 0,
               b["web_ok"], b["mobile_ok"], round(b["web_amt"], 2), round(b["mobile_amt"], 2)])
gt = tw + tm + to_
ws.append(["TOTAL", tw, tm, to_, gt,
           round(100 * tw / gt, 1) if gt else 0, round(100 * tm / gt, 1) if gt else 0, "", "", "", ""])
for c in ws[ws.max_row]: c.font = Font(bold=True)
for col, w in zip("ABCDEFGHIJK", [12, 14, 18, 15, 10, 9, 10, 12, 14, 15, 16]):
    ws.column_dimensions[col].width = w

ch = LineChart(); ch.title = f"UPG payments {d['month']} — Web vs Mobile app (daily)"
ch.y_axis.title = "payments"; ch.x_axis.title = "day"; ch.height, ch.width = 9, 26
n = ws.max_row - 1  # exclude TOTAL
ch.add_data(Reference(ws, min_col=2, max_col=3, min_row=1, max_row=n), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=2, max_row=n))
ws.add_chart(ch, "M2")

ws2 = wb.create_sheet("Raw platforms")
ws2.append(["platform (as stamped)", "payments"]); ws2["A1"].font = ws2["B1"].font = Font(bold=True)
for p, n2 in sorted(raw_platforms.items(), key=lambda x: -x[1]): ws2.append([p, n2])
ws2.append([]); ws2.append(["Scope: app payments on the UPG rail (reference = UPG invoice shape). "
                            "Grouping — mobile: ios/android/huawei · web: web/desktop/browser · rest shown as-is."])

if d.get("upg_daily"):
    ws3 = wb.create_sheet("UPG channel (gateway)")
    chans = sorted({r["channel"] for r in d["upg_daily"]})
    ws3.append(["Day"] + chans)
    for c in ws3[1]: c.font = Font(bold=True)
    per = defaultdict(dict)
    for r in d["upg_daily"]: per[str(r["day"])[:10]][r["channel"]] = r["n"]
    for day in sorted(per): ws3.append([day] + [per[day].get(c, 0) for c in chans])
    ws3.append([]); ws3.append(["Cross-check: the gateway's own `channel` field — compare with the app-side split."])
elif d.get("upg_note"):
    wb.create_sheet("UPG channel (gateway)").append([d["upg_note"]])

wb.save(dst)
print(f"wrote {dst} · days {len(days)} · web {tw} · mobile {tm} · other {to_}")
