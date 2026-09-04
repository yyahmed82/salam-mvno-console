#!/usr/bin/env python3
"""Digital-API / APIGW Error Catalog PDF — companion to the payment-errors catalog, same house
style (reportlab, dark-green headers, business/technical palette).

  python3 tools/build-apigw-catalog-pdf.py apigw-catalog.json [out.pdf]

HONESTY FIRST: unlike payments (app DB holds years), the ONLY per-call APIGW record is the
console's capture — live 13 Aug 2026, 7-day retention. This catalog therefore covers the full
available window (~7 days, millions of calls) and SAYS SO on page one, with the forward plan
that makes future editions monthly. It must never be silently retitled as a 12-month report."""
import json, sys, datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

DARK = colors.HexColor('#0b3b2e'); GREEN = colors.HexColor('#0e9f5a')
INK = colors.HexColor('#11241d'); MUTED = colors.HexColor('#5f6f69')
RED = colors.HexColor('#b3261e'); BLUE = colors.HexColor('#2563eb')
LINE = colors.HexColor('#dde7e1'); ZEBRA = colors.HexColor('#f4f8f6')

SS = getSampleStyleSheet()
H1 = ParagraphStyle('h1', parent=SS['Title'], textColor=DARK, fontSize=20, spaceAfter=6)
H2 = ParagraphStyle('h2', parent=SS['Heading2'], textColor=DARK, fontSize=13, spaceBefore=10, spaceAfter=4)
P = ParagraphStyle('p', parent=SS['Normal'], textColor=INK, fontSize=9, leading=12)
PM = ParagraphStyle('pm', parent=P, textColor=MUTED, fontSize=8)
TH = ParagraphStyle('th', parent=P, textColor=colors.white, fontSize=8, leading=10)
TD = ParagraphStyle('td', parent=P, fontSize=8, leading=10)

def tbl(head, rows, widths, aligns=None):
    data = [[Paragraph(str(h), TH) for h in head]]
    for r in rows:
        data.append([Paragraph(str(c), TD) for c in r])
    t = Table(data, colWidths=widths, repeatRows=1)
    st = [('BACKGROUND', (0, 0), (-1, 0), DARK), ('GRID', (0, 0), (-1, -1), 0.4, LINE),
          ('VALIGN', (0, 0), (-1, -1), 'TOP')]
    for i in range(2, len(data), 2):
        st.append(('BACKGROUND', (0, i), (-1, i), ZEBRA))
    t.setStyle(TableStyle(st))
    return t

def cls_word(c):
    return f'<font color="#b3261e"><b>{c}</b></font>' if c == 'technical' else (
           f'<font color="#2563eb"><b>{c}</b></font>' if c == 'business' else c)

def main(src, out):
    d = json.load(open(src))
    w = d['window']; lo, hi = str(w['lo'])[:10], str(w['hi'])[:10]
    total = int(w['n'])
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=16*mm, rightMargin=16*mm,
                            topMargin=14*mm, bottomMargin=14*mm,
                            title='Salam Digital-API / APIGW Error Catalog')
    E = []
    # ---- page 1: title + the honesty block --------------------------------------------------
    E.append(Paragraph('Salam Digital-API / APIGW — Error Catalog', H1))
    E.append(Paragraph(f'Capture window <b>{lo} → {hi}</b> · <b>{total:,}</b> API calls · generated {d["generated"][:16].replace("T"," ")} UTC', P))
    E.append(Spacer(1, 6))
    E.append(Paragraph('Why this catalog is not 12 months (and must not pretend to be)', H2))
    E.append(Paragraph(
        'The Digital-API gateway keeps no long-term per-call log. The only per-call record is the '
        'operations console’s own capture on the API hosts — <b>live since 13 Aug 2026 with a '
        '7-day retention</b>. Every number here is measured over the full available window above: '
        'a complete, statistically meaningful picture of one representative week — not a year. '
        'The 12-month view exists for payments (app database), and for eligibility / BSS activation / '
        'Nafath (replica logs) in the companion journey-errors monthlies.', P))
    E.append(Spacer(1, 4))
    E.append(Paragraph(
        '<b>Forward plan:</b> a nightly rollup (path × code × class × day) into a permanent '
        'table makes the NEXT edition of this catalog a true monthly, accumulating from today — '
        'first full month available end of September 2026.', P))
    E.append(Spacer(1, 6))
    E.append(Paragraph('Classification doctrine', H2))
    E.append(Paragraph(
        'technical = Salam IT at fault (timeouts, 5xx, transport, BSS 1500/5002 family) — pageable. '
        'business = the platform answered and the outcome belongs to the customer, bank, CITC or policy '
        '— reportable, not pageable. Same errclass rules as the console’s Troubleshoot, alerts '
        'and the payment catalog, so no two reports can disagree.', P))

    # ---- volumes & classes ------------------------------------------------------------------
    E.append(Paragraph('1 · Daily volume and outcome classes', H2))
    days = sorted({r['day'] for r in d['daily']})
    cls_names = ['success', 'business', 'technical', '(none)']
    rows = []
    for day in days:
        m = {r['cls']: r['n'] for r in d['daily'] if r['day'] == day}
        tot = sum(m.values())
        rows.append([day, f'{tot:,}'] + [f"{m.get(c, 0):,}" for c in cls_names[:3]]
                    + [f"{100.0*m.get('technical',0)/tot:.2f}%" if tot else '0%'])
    E.append(tbl(['Day', 'Calls', 'Success', 'Business', 'Technical', 'Tech %'],
                 rows, [24*mm, 26*mm, 26*mm, 26*mm, 26*mm, 20*mm]))

    # ---- journeys ---------------------------------------------------------------------------
    E.append(Paragraph('2 · The four report journeys — outcome mix and latency', H2))
    E.append(Paragraph('Journey attribution is by API path family; "Onboarding" covers New SIM and MNP '
                       '(the gateway does not distinguish the lane).', PM))
    jn = {}
    for r in d['journey_cls']:
        j = jn.setdefault(r['journey'], {'n': 0, 'cls': {}, 'p95': 0})
        j['n'] += r['n']; j['cls'][r['cls']] = r['n']; j['p95'] = max(j['p95'], r['p95_ms'] or 0)
    rows = [[j, f"{v['n']:,}", f"{v['cls'].get('success',0):,}", f"{v['cls'].get('business',0):,}",
             f"{v['cls'].get('technical',0):,}",
             f"{100.0*v['cls'].get('technical',0)/v['n']:.2f}%" if v['n'] else '0%',
             f"{v['p95']:,} ms"]
            for j, v in sorted(jn.items(), key=lambda x: -x[1]['n'])]
    E.append(tbl(['Journey', 'Calls', 'Success', 'Business', 'Technical', 'Tech %', 'worst p95'],
                 rows, [40*mm, 22*mm, 22*mm, 22*mm, 22*mm, 18*mm, 20*mm]))

    # ---- technical catalog ------------------------------------------------------------------
    E.append(PageBreak())
    E.append(Paragraph('3 · Technical failures — the catalog (Salam IT actionable)', H2))
    E.append(tbl(['API path', 'Code', 'Message (masked)', 'Journey', 'Count', 'Avg ms'],
                 [[r['path'], r['code'], r['msg'], r['journey'], f"{r['n']:,}", r['avg_ms'] or '—']
                  for r in d['top_technical']],
                 [52*mm, 12*mm, 58*mm, 26*mm, 14*mm, 12*mm]))

    # ---- business catalog -------------------------------------------------------------------
    E.append(PageBreak())
    E.append(Paragraph('4 · Business outcomes — top refusal families (not platform faults)', H2))
    E.append(tbl(['API path', 'Code', 'Message (masked)', 'Journey', 'Count'],
                 [[r['path'], r['code'], r['msg'], r['journey'], f"{r['n']:,}"]
                  for r in d['top_business']],
                 [54*mm, 12*mm, 62*mm, 28*mm, 16*mm]))

    # ---- latency ----------------------------------------------------------------------------
    E.append(PageBreak())
    E.append(Paragraph('5 · Slowest endpoints by p95 (≥500 calls)', H2))
    E.append(tbl(['API path', 'Calls', 'Avg ms', 'p95 ms', 'Max ms', 'Tech fails'],
                 [[r['path'], f"{r['n']:,}", r['avg_ms'], f"{r['p95_ms']:,}", f"{r['max_ms']:,}", r['tech']]
                  for r in d['slowest']],
                 [70*mm, 18*mm, 18*mm, 20*mm, 22*mm, 18*mm]))

    E.append(Paragraph('6 · Hour-of-day profile (KSA) and per-host split', H2))
    E.append(tbl(['Hour KSA', 'Calls', 'Technical'],
                 [[f"{r['hour_ksa']:02d}:00", f"{r['n']:,}", r['tech']] for r in d['hourly']],
                 [24*mm, 34*mm, 28*mm]))
    E.append(Spacer(1, 4))
    E.append(tbl(['API host', 'Calls', 'Technical'],
                 [[r['host'], f"{r['n']:,}", r['tech']] for r in d['hosts']],
                 [44*mm, 34*mm, 28*mm]))
    E.append(Spacer(1, 8))
    E.append(Paragraph('Source: console API-traffic capture on the Digital-API hosts. Messages are '
                       'PII-masked at capture and re-masked at extraction. Companion reports: '
                       'Salam-Payment-Errors-Catalog (12 months) and the Journey-Errors monthlies '
                       '(eligibility / BSS / Nafath, 12 months).', PM))
    doc.build(E)
    print('wrote', out)

if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else 'apigw-catalog.json'
    out = sys.argv[2] if len(sys.argv) > 2 else 'Salam-DigitalAPI-Errors-Catalog.pdf'
    main(src, out)
