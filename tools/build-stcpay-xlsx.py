#!/usr/bin/env python3
"""Build the STC Pay incident workbook from docs/stcpay-report.json (written by deploy152/stcpay-report.cjs on 152).
Usage: python3 tools/build-stcpay-xlsx.py docs/stcpay-report.json docs/STC-Pay-HyperPay-window-2026-09.xlsx
Sheets: Summary · Daily (chart) · Hourly (chart) · Cases (every STC Pay attempt, masked mobile) · Baseline · Method.
"""
import json, sys, datetime as dt
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

src = sys.argv[1] if len(sys.argv) > 1 else 'docs/stcpay-report.json'
out = sys.argv[2] if len(sys.argv) > 2 else 'docs/STC-Pay-HyperPay-window-2026-09.xlsx'
J = json.load(open(src))

FONT = 'Arial'
NAVY, TEAL, RED, GREY, LIGHT = '1F3A5F', '0E7C86', 'B42318', '667085', 'F2F4F7'
H = Font(name=FONT, bold=True, color='FFFFFF', size=10)
B = Font(name=FONT, size=10)
BB = Font(name=FONT, size=10, bold=True)
T = Font(name=FONT, size=16, bold=True, color=NAVY)
S = Font(name=FONT, size=10, color=GREY, italic=True)
hd_fill = PatternFill('solid', fgColor=NAVY)
sec_fill = PatternFill('solid', fgColor=TEAL)
kpi_fill = PatternFill('solid', fgColor=LIGHT)
red_fill = PatternFill('solid', fgColor='FEE4E2')
thin = Side(style='thin', color='D0D5DD')
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
INT, PCT, SAR = '#,##0', '0.0%', '#,##0.00'

def ksa(iso):
    d = dt.datetime.fromisoformat(iso.replace('Z', '+00:00')) + dt.timedelta(hours=3)
    return d.strftime('%a %d %b %Y %H:%M') + ' KSA'

win = J['window']
FROM, TO = ksa(win['from']), ksa(win['to'])

def header(ws, row, cols, fill=hd_fill):
    for i, c in enumerate(cols, 1):
        x = ws.cell(row=row, column=i, value=c); x.font = H; x.fill = fill; x.border = BOX
        x.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws.row_dimensions[row].height = 30

def put(ws, row, col, v, fmt=None, bold=False, fill=None):
    x = ws.cell(row=row, column=col, value=v); x.font = BB if bold else B; x.border = BOX
    if fmt: x.number_format = fmt
    if fill: x.fill = fill
    return x

def widths(ws, w):
    for i, x in enumerate(w, 1): ws.column_dimensions[get_column_letter(i)].width = x

wb = Workbook()

# ---------------------------------------------------------------- Daily (built first: Summary formulas point here)
daily = J['daily']
days = sorted({d['day'] for d in daily})
by = {(d['day'], d['vendor']): d for d in daily}
def g(day, vendor, k):
    r = by.get((day, vendor)); return (r or {}).get(k, 0) or 0

wsD = wb.active; wsD.title = 'Daily'
wsD['A1'] = 'STC Pay via HyperPay — daily failures (KSA days)'; wsD['A1'].font = T
wsD['A2'] = f'Window {FROM} → {TO}. STC Pay = HyperPay attempts whose payment brand / method is STC Pay. Fail rate = failed ÷ (success + failed); pending (customer never returned from the gateway page) is excluded from the rate.'; wsD['A2'].font = S
DCOLS = ['Day (KSA)', 'STC Pay attempts', 'STC Pay success', 'STC Pay failed', 'STC Pay fail rate', 'Distinct customers failed', 'Amount attempted (SAR)',
         'HyperPay other rails attempts', 'HyperPay other rails success', 'HyperPay other rails failed', 'Other rails fail rate',
         'HyperPay pending (abandoned)', 'UPG (salam) attempts', 'UPG success', 'UPG failed', 'UPG fail rate']
header(wsD, 4, DCOLS)
r0 = 5
for i, day in enumerate(days):
    r = r0 + i
    hp = by.get((day, 'hyperpay'), {})
    put(wsD, r, 1, dt.date.fromisoformat(day), 'ddd dd mmm', bold=True)
    put(wsD, r, 2, hp.get('stc_attempts', 0), INT); put(wsD, r, 3, hp.get('stc_ok', 0), INT); put(wsD, r, 4, hp.get('stc_fail', 0), INT, fill=red_fill)
    put(wsD, r, 5, f'=IF(C{r}+D{r}=0,0,D{r}/(C{r}+D{r}))', PCT, fill=red_fill)
    put(wsD, r, 6, hp.get('stc_fail_customers', 0), INT); put(wsD, r, 7, float(hp.get('stc_fail_amount', 0) or 0), SAR)
    put(wsD, r, 8, f'={hp.get("attempts",0)}-B{r}', INT); put(wsD, r, 9, f'={hp.get("ok",0)}-C{r}', INT); put(wsD, r, 10, f'={hp.get("fail",0)}-D{r}', INT)
    put(wsD, r, 11, f'=IF(I{r}+J{r}=0,0,J{r}/(I{r}+J{r}))', PCT)
    put(wsD, r, 12, hp.get('pending', 0), INT)
    put(wsD, r, 13, g(day, 'salam', 'attempts'), INT); put(wsD, r, 14, g(day, 'salam', 'ok'), INT); put(wsD, r, 15, g(day, 'salam', 'fail'), INT)
    put(wsD, r, 16, f'=IF(N{r}+O{r}=0,0,O{r}/(N{r}+O{r}))', PCT)
rl = r0 + len(days) - 1; rt = rl + 1
put(wsD, rt, 1, 'Total', bold=True, fill=kpi_fill)
for c in (2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15):
    L = get_column_letter(c); put(wsD, rt, c, f'=SUM({L}{r0}:{L}{rl})', SAR if c == 7 else INT, bold=True, fill=kpi_fill)
put(wsD, rt, 5, f'=IF(C{rt}+D{rt}=0,0,D{rt}/(C{rt}+D{rt}))', PCT, bold=True, fill=kpi_fill)
put(wsD, rt, 11, f'=IF(I{rt}+J{rt}=0,0,J{rt}/(I{rt}+J{rt}))', PCT, bold=True, fill=kpi_fill)
put(wsD, rt, 16, f'=IF(N{rt}+O{rt}=0,0,O{rt}/(N{rt}+O{rt}))', PCT, bold=True, fill=kpi_fill)
wsD.cell(row=rt + 1, column=1, value='Distinct-customer total is on the Summary sheet (a customer failing on two days is counted once there, once per day here). UPG columns show traffic only on 10 Sep after 18:10 KSA re-enable.').font = S
widths(wsD, [14, 12, 12, 12, 12, 14, 16, 14, 14, 14, 12, 14, 12, 12, 12, 12])
wsD.freeze_panes = 'B5'

ch = BarChart(); ch.type = 'col'; ch.style = 10; ch.title = 'STC Pay failed attempts per day (HyperPay-only window)'
ch.y_axis.title = 'Failed attempts'; ch.x_axis.title = 'Day (KSA)'; ch.height = 9; ch.width = 22
ch.add_data(Reference(wsD, min_col=4, min_row=4, max_row=rl), titles_from_data=True)
ch.set_categories(Reference(wsD, min_col=1, min_row=r0, max_row=rl))
ch.series[0].graphicalProperties.solidFill = RED
ch.dataLabels = DataLabelList(); ch.dataLabels.showVal = True
ln = LineChart(); ln.add_data(Reference(wsD, min_col=6, min_row=4, max_row=rl), titles_from_data=True)
ln.series[0].graphicalProperties.line.solidFill = NAVY; ln.series[0].graphicalProperties.line.width = 28000
ln.y_axis.axId = 200; ln.y_axis.title = 'Distinct customers'; ln.y_axis.crosses = 'max'
ch += ln
wsD.add_chart(ch, f'A{rt + 4}')

ch2 = LineChart(); ch2.title = 'Daily fail rate — STC Pay vs other HyperPay rails vs UPG'; ch2.style = 12; ch2.height = 9; ch2.width = 22
ch2.y_axis.number_format = '0%'; ch2.y_axis.scaling.min = 0; ch2.y_axis.scaling.max = 1; ch2.y_axis.title = 'Fail rate'
for col, colr in ((5, RED), (11, TEAL), (16, NAVY)):
    ch2.add_data(Reference(wsD, min_col=col, min_row=4, max_row=rl), titles_from_data=True)
    s = ch2.series[-1]; s.graphicalProperties.line.solidFill = colr; s.graphicalProperties.line.width = 28000; s.marker.symbol = 'circle'
ch2.set_categories(Reference(wsD, min_col=1, min_row=r0, max_row=rl))
wsD.add_chart(ch2, f'I{rt + 4}')

# ---------------------------------------------------------------- Summary
ws = wb.create_sheet('Summary', 0)
ws['A1'] = 'STC Pay payment failures — HyperPay-only window'; ws['A1'].font = T
ws['A2'] = f'From {FROM} (UPG + Tap switched off, HyperPay sole customer gateway) to {TO} (UPG re-enabled). Source: Salam selfcare payments (production replica), extracted {ksa(J["generated_at"])}.'; ws['A2'].font = S
ws.merge_cells('A2:F2'); ws['A2'].alignment = Alignment(wrap_text=True, vertical='top'); ws.row_dimensions[2].height = 32

r = 4
ws.cell(row=r, column=1, value='Key figures (STC Pay rail, whole window)').font = Font(name=FONT, size=12, bold=True, color=NAVY); r += 1
header(ws, r, ['Indicator', 'Value', 'Note']); r += 1
kpis = [
    ('STC Pay attempts', f"=Daily!B{rt}", INT, 'Every payment where the customer chose STC Pay on the HyperPay page'),
    ('STC Pay successful', f"=Daily!C{rt}", INT, ''),
    ('STC Pay failed', f"=Daily!D{rt}", INT, 'Declined by HyperPay before reaching STC Pay'),
    ('STC Pay fail rate', f"=Daily!E{rt}", PCT, 'failed ÷ (success + failed)'),
    ('Distinct customers who failed', J['recovered']['failed_customers'], INT, 'Unique mobile numbers with ≥ 1 failed STC Pay attempt'),
    ('Customers who later paid on another rail', J['recovered']['later_paid_other_rail'], INT, 'Same mobile, a successful payment after the failure (within window + 3 days) on mada / Visa / Master / UPG'),
    ('Customers not recovered', f'=B{r+4}-B{r+5}', INT, 'No successful payment found after their STC Pay failure'),
    ('Amount attempted on STC Pay (SAR)', f"=Daily!G{rt}", SAR, 'Sum of the failed attempts (includes retries of the same basket)'),
    ('Days in window', len(days), INT, f'{days[0]} → {days[-1]} (KSA)'),
    ('Average failed attempts per customer', f'=IF(B{r+4}=0,0,B{r+2}/B{r+4})', '0.0', 'Customers retried repeatedly — see retry distribution'),
]
for lab, v, fmt, note in kpis:
    put(ws, r, 1, lab, bold=True, fill=kpi_fill); put(ws, r, 2, v, fmt, bold=True, fill=red_fill if 'fail' in lab.lower() else kpi_fill); put(ws, r, 3, note); r += 1
r += 1

ws.cell(row=r, column=1, value='Decline reasons returned by HyperPay (STC Pay, failed attempts)').font = Font(name=FONT, size=12, bold=True, color=NAVY); r += 1
header(ws, r, ['Result code', 'Reason', 'Failed attempts', 'Distinct customers', 'Share']); r += 1
r_reason0 = r
for x in J['reasons']:
    put(ws, r, 1, x['code']); put(ws, r, 2, x['reason']); put(ws, r, 3, x['n'], INT); put(ws, r, 4, x['customers'], INT)
    put(ws, r, 5, f'=IF(SUM($C${r_reason0}:$C${r_reason0+len(J["reasons"])-1})=0,0,C{r}/SUM($C${r_reason0}:$C${r_reason0+len(J["reasons"])-1}))', PCT); r += 1
r += 1

ws.cell(row=r, column=1, value='All HyperPay rails in the same window (context)').font = Font(name=FONT, size=12, bold=True, color=NAVY); r += 1
header(ws, r, ['Rail / brand', 'Attempts', 'Success', 'Failed', 'Pending (abandoned)', 'Fail rate']); r += 1
for x in J['rails']:
    fill = red_fill if 'stc' in x['rail'] else None
    put(ws, r, 1, x['rail'], bold=bool(fill), fill=fill); put(ws, r, 2, x['attempts'], INT, fill=fill); put(ws, r, 3, x['ok'], INT, fill=fill); put(ws, r, 4, x['fail'], INT, fill=fill); put(ws, r, 5, x['pending'], INT, fill=fill)
    put(ws, r, 6, f'=IF(C{r}+D{r}=0,0,D{r}/(C{r}+D{r}))', PCT, fill=fill); r += 1
ws.cell(row=r, column=1, value='"(initiated - no gateway answer)" = checkout created but the customer never completed the HyperPay page; it is not a decline and is excluded from fail rates.').font = S; r += 2

ws.cell(row=r, column=1, value='STC Pay failures by platform').font = Font(name=FONT, size=12, bold=True, color=NAVY); r += 1
header(ws, r, ['Platform', 'Attempts', 'Success', 'Failed', 'Share of STC Pay attempts']); r += 1
p0 = r
for x in J['byPlatform']:
    put(ws, r, 1, x['platform']); put(ws, r, 2, x['attempts'], INT); put(ws, r, 3, x['ok'], INT); put(ws, r, 4, x['fail'], INT)
    put(ws, r, 5, f'=IF(SUM($B${p0}:$B${p0+len(J["byPlatform"])-1})=0,0,B{r}/SUM($B${p0}:$B${p0+len(J["byPlatform"])-1}))', PCT); r += 1
r += 1

ws.cell(row=r, column=1, value='STC Pay failures by payment purpose').font = Font(name=FONT, size=12, bold=True, color=NAVY); r += 1
header(ws, r, ['Purpose', 'Attempts', 'Success', 'Failed', 'Amount attempted (SAR)']); r += 1
for x in J['byPurpose']:
    put(ws, r, 1, x['purpose']); put(ws, r, 2, x['attempts'], INT); put(ws, r, 3, x['ok'], INT); put(ws, r, 4, x['fail'], INT); put(ws, r, 5, float(x['fail_amount'] or 0), SAR); r += 1
r += 1

ws.cell(row=r, column=1, value='How many times customers retried STC Pay before giving up').font = Font(name=FONT, size=12, bold=True, color=NAVY); r += 1
header(ws, r, ['Failed attempts per customer', 'Customers', 'Share of failed customers']); r += 1
buckets = [('1', 1, 1), ('2', 2, 2), ('3', 3, 3), ('4 – 5', 4, 5), ('6 – 10', 6, 10), ('11 – 20', 11, 20), ('21+', 21, 10**9)]
b0 = r
for lab, lo, hi in buckets:
    n = sum(x['customers'] for x in J['retries'] if lo <= x['tries'] <= hi)
    put(ws, r, 1, lab); put(ws, r, 2, n, INT); put(ws, r, 3, f'=IF(SUM($B${b0}:$B${b0+len(buckets)-1})=0,0,B{r}/SUM($B${b0}:$B${b0+len(buckets)-1}))', PCT); r += 1
r += 1

ws.cell(row=r, column=1, value='Baseline — the 7 days before the cutover (UPG as main gateway)').font = Font(name=FONT, size=12, bold=True, color=NAVY); r += 1
header(ws, r, ['Gateway', 'Attempts', 'Success', 'Failed', 'Fail rate']); r += 1
agg = defaultdict(lambda: [0, 0, 0])
for x in J['baseline_before']:
    a = agg[x['vendor']]; a[0] += x['attempts']; a[1] += x['ok']; a[2] += x['fail']
for v, (a, o, f) in sorted(agg.items(), key=lambda kv: -kv[1][0]):
    put(ws, r, 1, v); put(ws, r, 2, a, INT); put(ws, r, 3, o, INT); put(ws, r, 4, f, INT); put(ws, r, 5, f'=IF(C{r}+D{r}=0,0,D{r}/(C{r}+D{r}))', PCT); r += 1
ws.cell(row=r, column=1, value='Baseline covers 27 Aug 00:00 KSA → 3 Sep 16:27 KSA. UPG failures there are ordinary declines (insufficient funds, wrong OTP…), not a gateway fault.').font = S
widths(ws, [44, 34, 70, 18, 22, 12])
ws.freeze_panes = 'A4'

# ---------------------------------------------------------------- Hourly
wsH = wb.create_sheet('Hourly')
wsH['A1'] = 'HyperPay hourly profile (KSA hours) — STC Pay vs all rails'; wsH['A1'].font = T
header(wsH, 3, ['Hour (KSA)', 'STC Pay attempts', 'STC Pay failed', 'STC Pay fail rate', 'All HyperPay attempts', 'All HyperPay failed', 'All-rails fail rate'])
hr = 4
for x in J['hourly']:
    put(wsH, hr, 1, dt.datetime.strptime(x['hour'], '%Y-%m-%d %H:%M'), 'ddd dd mmm hh:mm'); put(wsH, hr, 2, x['stc_attempts'], INT); put(wsH, hr, 3, x['stc_fail'], INT)
    put(wsH, hr, 4, f'=IF(B{hr}=0,0,C{hr}/B{hr})', PCT); put(wsH, hr, 5, x['attempts'], INT); put(wsH, hr, 6, x['fail'], INT); put(wsH, hr, 7, f'=IF(E{hr}=0,0,F{hr}/E{hr})', PCT); hr += 1
widths(wsH, [20, 14, 14, 14, 18, 16, 14]); wsH.freeze_panes = 'B4'
ch3 = LineChart(); ch3.title = 'STC Pay failed attempts per hour'; ch3.height = 9; ch3.width = 30; ch3.style = 12
ch3.add_data(Reference(wsH, min_col=3, min_row=3, max_row=hr - 1), titles_from_data=True); ch3.set_categories(Reference(wsH, min_col=1, min_row=4, max_row=hr - 1))
ch3.series[0].graphicalProperties.line.solidFill = RED; ch3.series[0].graphicalProperties.line.width = 20000; ch3.x_axis.number_format = 'dd mmm'
wsH.add_chart(ch3, 'I3')

# ---------------------------------------------------------------- Cases
wsC = wb.create_sheet('Cases')
CC = ['#', 'Date / time (KSA)', 'Status', 'Amount (SAR)', 'Platform', 'Gateway', 'Rail', 'Payment method', 'Purpose', 'Result code', 'Gateway reason', 'HyperPay reference', 'Customer mobile (masked)', 'Payment id']
header(wsC, 1, CC)
for i, c in enumerate(J['cases'], 1):
    row = [i, c['ksa_time'], c['status'], float(c['amount'] or 0), c['platform'], c['vendor'], c['rail'], c['payment_method'], c['purpose'], c['code'], c['reason'], c['gateway_ref'], c['mobile_masked'], c['id']]
    for j, v in enumerate(row, 1):
        x = wsC.cell(row=i + 1, column=j, value=v); x.font = B
        if j == 4: x.number_format = SAR
n = len(J['cases']) + 1
tab = Table(displayName='StcPayCases', ref=f'A1:{get_column_letter(len(CC))}{n}')
tab.tableStyleInfo = TableStyleInfo(name='TableStyleLight9', showRowStripes=True)
wsC.add_table(tab)
widths(wsC, [7, 19, 8, 12, 9, 10, 10, 13, 22, 12, 36, 42, 16, 38]); wsC.freeze_panes = 'C2'

# ---------------------------------------------------------------- Baseline detail
wsB = wb.create_sheet('Baseline')
wsB['A1'] = 'Daily volumes by gateway, 7 days before the cutover (KSA days)'; wsB['A1'].font = T
header(wsB, 3, ['Day (KSA)', 'Gateway', 'Attempts', 'Success', 'Failed', 'Fail rate'])
br = 4
for x in J['baseline_before']:
    put(wsB, br, 1, dt.date.fromisoformat(x['day']), 'ddd dd mmm'); put(wsB, br, 2, x['vendor']); put(wsB, br, 3, x['attempts'], INT); put(wsB, br, 4, x['ok'], INT); put(wsB, br, 5, x['fail'], INT)
    put(wsB, br, 6, f'=IF(D{br}+E{br}=0,0,E{br}/(D{br}+E{br}))', PCT); br += 1
widths(wsB, [14, 12, 12, 12, 12, 12]); wsB.freeze_panes = 'A4'

# ---------------------------------------------------------------- Method
wsM = wb.create_sheet('Method')
wsM['A1'] = 'Method & definitions'; wsM['A1'].font = T
lines = [
    ('Source', 'Salam selfcare `payments` table, production replica (same rows as production; read-only extract by the Operations Console on ruh-salam-site03).'),
    ('Window', f'{FROM} → {TO}. Start = gateway registry cutover (UPG + Tap disabled, HyperPay only). End = gateway registry "UPG re-enabled" timestamp ({win["to_how"]}).'),
    ('STC Pay attempt', 'A HyperPay payment whose gateway response paymentBrand, card_type or payment_method contains "stc". Identified per row, not by customer.'),
    ('Status', 'success = gateway confirmed; fail = gateway declined; pending = checkout created but customer never completed the gateway page (abandoned). Fail rate = fail ÷ (success + fail).'),
    ('Distinct customers', 'Unique customer mobile numbers with at least one failed STC Pay attempt in the window.'),
    ('Later paid on another rail', 'A customer counted above who has a successful payment on any non-STC Pay rail (mada / Visa / Master / UPG) after the failed attempt and before window end + 3 days.'),
    ('Amount attempted', 'Sum of the amount field over failed STC Pay rows. Retries of the same basket are counted each time, so it is exposure, not lost revenue.'),
    ('Result code 800.100.156', 'HyperPay: "transaction declined (format error)" — the request rejected by the acquirer/connector configuration before any customer authentication; no STC Pay OTP was ever shown.'),
    ('Masking', 'Customer mobiles are masked (first two + last two digits). Full identifiers can be provided from the console on request.'),
    ('Times', 'All dates and times are KSA (UTC+3).'),
]
for i, (k, v) in enumerate(lines, 3):
    put(wsM, i, 1, k, bold=True, fill=kpi_fill); x = put(wsM, i, 2, v); x.alignment = Alignment(wrap_text=True, vertical='top'); wsM.row_dimensions[i].height = 44
widths(wsM, [26, 120])

for w in wb.worksheets:
    w.sheet_view.showGridLines = False if w.title in ('Summary', 'Method') else True
wb.save(out)
print('wrote', out, '| cases', len(J['cases']), '| days', len(days))
