#!/usr/bin/env python3
"""Salam Journey-Errors Catalog · Sep 2025 → Aug 2026 — the 12-month companion to the
payment-errors catalog, built from the monthly JSONs journeyErrExport.js extracted.

  python3 tools/build-journey-errors-pdf.py ./journey-errors [out.pdf]

Families with TRUE 12-month history: eligibility (Semati), BSS activation, Nafath identity.
APIGW is EXCLUDED by design (capture exists only since 13 Aug 2026 — stated, not padded).
Recharge & Invoice have no backend logs of these kinds — their 12-month story is the payments
catalog; this report says so on its scope page instead of inventing numbers.
Classification = console doctrine: technical only when Salam IT is at fault; Nafath terminal
statuses are ALWAYS business."""
import json, os, sys
from collections import defaultdict
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

DARK = colors.HexColor('#0b3b2e'); INK = colors.HexColor('#11241d')
MUTED = colors.HexColor('#5f6f69'); LINE = colors.HexColor('#dde7e1')
ZEBRA = colors.HexColor('#f4f8f6'); RED = colors.HexColor('#b3261e'); BLUE = colors.HexColor('#2563eb')

SS = getSampleStyleSheet()
H1 = ParagraphStyle('h1', parent=SS['Title'], textColor=DARK, fontSize=20, spaceAfter=6)
H2 = ParagraphStyle('h2', parent=SS['Heading2'], textColor=DARK, fontSize=13, spaceBefore=10, spaceAfter=4)
P = ParagraphStyle('p', parent=SS['Normal'], textColor=INK, fontSize=9, leading=12)
PM = ParagraphStyle('pm', parent=P, textColor=MUTED, fontSize=8)
TH = ParagraphStyle('th', parent=P, textColor=colors.white, fontSize=8, leading=10)
TD = ParagraphStyle('td', parent=P, fontSize=8, leading=10)

def tbl(head, rows, widths):
    data = [[Paragraph(str(h), TH) for h in head]] + \
           [[Paragraph(str(c), TD) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1)
    st = [('BACKGROUND', (0, 0), (-1, 0), DARK), ('GRID', (0, 0), (-1, -1), 0.4, LINE),
          ('VALIGN', (0, 0), (-1, -1), 'TOP')]
    for i in range(2, len(data), 2):
        st.append(('BACKGROUND', (0, i), (-1, i), ZEBRA))
    t.setStyle(TableStyle(st))
    return t

def cw(c):  # colored class word
    return {'technical': '<font color="#b3261e"><b>technical</b></font>',
            'business': '<font color="#2563eb"><b>business</b></font>'}.get(c, c)

def main(src, out):
    months = []
    for f in sorted(os.listdir(src)):
        if f.endswith('.json'):
            months.append(json.load(open(os.path.join(src, f))))
    if not months:
        sys.exit(f'no monthly JSONs in {src}')
    mk = [m['month'] for m in months]

    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm,
                            topMargin=13*mm, bottomMargin=13*mm,
                            title='Salam Journey-Errors Catalog Sep2025-Aug2026')
    E = []
    # ---- scope page -------------------------------------------------------------------------
    E.append(Paragraph('Salam — Journey Errors Catalog', H1))
    E.append(Paragraph(f'<b>{mk[0]} → {mk[-1]}</b> · onboarding backend failures across 12 months · '
                       'companion to the Payment-Errors Catalog', P))
    E.append(Spacer(1, 6))
    E.append(Paragraph('Scope & sources — what is (and is not) in this report', H2))
    E.append(Paragraph(
        '<b>In:</b> the three failure families with true 12-month history on the application replica — '
        '<b>Eligibility</b> (Semati checks), <b>BSS Activation</b>, and <b>Nafath identity</b>. These are '
        'onboarding-stage systems, so they tell the New SIM and MNP story end to end.', P))
    E.append(Paragraph(
        '<b>Recharge & Invoice:</b> these journeys have no eligibility/BSS/Nafath stage — their backend '
        'record is the payment itself, fully covered for the same 12 months in the Payment-Errors Catalog '
        'and the monthly UPG workbooks. Stated here so nobody looks for missing pages.', P))
    E.append(Paragraph(
        '<b>Excluded — APIGW/Digital-API:</b> per-call gateway records exist only since 13 Aug 2026 '
        '(7-day retention). A separate one-week APIGW catalog exists; its history accumulates monthly '
        'from Sep 2026 onward.', P))
    E.append(Spacer(1, 4))
    E.append(Paragraph('Classification doctrine', H2))
    E.append(Paragraph(
        f'{cw("technical")} = Salam IT at fault (1500/5002/timeouts/transport — pageable). '
        f'{cw("business")} = the platform delivered a verdict that belongs to the customer, CITC or policy '
        '(reportable, not pageable). Nafath terminal statuses (failed/expired/rejected/cancelled) are '
        'ALWAYS business: a terminal status proves the request was delivered and CITC answered — "failed" '
        'is the customer failing verification in the Nafath app, typically a wrong number choice.', P))

    # ---- orders funnel ----------------------------------------------------------------------
    E.append(Paragraph('1 · Onboarding funnel per month (per lane)', H2))
    E.append(Paragraph('id_submitted = customer entered National ID + nationality (the corrected '
                       'pre-eligibility definition); denied = submitted AND refused. '
                       'pre-elig drop = created − id_submitted (browsing abandonment, NOT refusals).', PM))
    for lane, flag in [('New SIM', False), ('MNP', True)]:
        rows = []
        for m in months:
            o = next((x for x in m.get('orders', []) if bool(x['mnp']) == flag), None)
            if not o:
                continue
            rows.append([m['month'], f"{o['created']:,}", f"{o['created']-o['id_submitted']:,}",
                         f"{o['id_submitted']:,}", f"{o['eligible']:,}", f"{o['denied']:,}",
                         f"{o['activated']:,}"])
        E.append(Paragraph(f'{lane}', ParagraphStyle('l', parent=P, fontSize=10, spaceBefore=6, textColor=DARK)))
        E.append(tbl(['Month', 'Created', 'Pre-elig drop', 'ID submitted', 'Eligible', 'Denied', 'Activated'],
                     rows, [18*mm, 24*mm, 26*mm, 26*mm, 24*mm, 20*mm, 22*mm]))

    # ---- eligibility ------------------------------------------------------------------------
    E.append(PageBreak())
    E.append(Paragraph('2 · Eligibility (Semati) — 12 months', H2))
    rows, code_tot = [], defaultdict(lambda: [0, ''])
    for m in months:
        et = m.get('eligibility_total', {})
        cby = {'business': 0, 'technical': 0}
        for c in m.get('eligibility_codes', []):
            cby[c['cls']] = cby.get(c['cls'], 0) + c['n']
            code_tot[c['code']][0] += c['n']; code_tot[c['code']][1] = c['cls']
        bad = et.get('bad', 0) or 1
        rows.append([m['month'], f"{et.get('n',0):,}", f"{et.get('bad',0):,}",
                     f"{cby.get('business',0):,}", f"{cby.get('technical',0):,}",
                     f"{100.0*cby.get('technical',0)/bad:.1f}%"])
    E.append(tbl(['Month', 'Checks', 'Failures', 'Business', 'Technical', 'Tech %'],
                 rows, [18*mm, 26*mm, 24*mm, 24*mm, 24*mm, 18*mm]))
    E.append(Paragraph('Top failure codes across the year', H2))
    top = sorted(code_tot.items(), key=lambda x: -x[1][0])[:12]
    tot = sum(v[0] for _, v in top) or 1
    E.append(tbl(['Code', 'Class', 'Count (12mo)', 'Share of top'],
                 [[c, cw(v[1]), f'{v[0]:,}', f'{100.0*v[0]/tot:.1f}%'] for c, v in top],
                 [22*mm, 26*mm, 30*mm, 26*mm]))
    E.append(Paragraph('605 (business refusal) dominates every single month; the technical family '
                       '(5002/715) concentrates in May–Jul 2026 — the Semati/TCC degradation the '
                       'console alerted on live.', PM))

    # ---- activation -------------------------------------------------------------------------
    E.append(PageBreak())
    E.append(Paragraph('3 · BSS Activation — 12 months', H2))
    rows, fam = [], defaultdict(lambda: [0, ''])
    for m in months:
        at = m.get('activation_total', {})
        cby = {'business': 0, 'technical': 0}
        for c in m.get('activation_codes', []):
            cby[c['cls']] = cby.get(c['cls'], 0) + c['n']
            fam[(c['api'], c['code'])][0] += c['n']; fam[(c['api'], c['code'])][1] = c['cls']
        bad = at.get('bad', 0) or 1
        fk = 100.0 * at.get('with_fk', 0) / at['n'] if at.get('n') else 0
        rows.append([m['month'], f"{at.get('n',0):,}", f"{at.get('bad',0):,}",
                     f"{cby.get('business',0):,}", f"{cby.get('technical',0):,}",
                     f"{100.0*cby.get('technical',0)/bad:.1f}%", f'{fk:.0f}%'])
    E.append(tbl(['Month', 'Calls', 'Failures', 'Business', 'Technical', 'Tech %', 'order-FK'],
                 rows, [18*mm, 24*mm, 22*mm, 22*mm, 22*mm, 16*mm, 16*mm]))
    E.append(Paragraph('order-FK = share of activation rows linkable to an order (lane attribution '
                       'is only trustworthy where this is high — stated, not guessed).', PM))
    E.append(Paragraph('Top failure families across the year', H2))
    topf = sorted(fam.items(), key=lambda x: -x[1][0])[:14]
    E.append(tbl(['API', 'Code', 'Class', 'Count (12mo)'],
                 [[a, c, cw(v[1]), f'{v[0]:,}'] for (a, c), v in topf],
                 [64*mm, 18*mm, 26*mm, 28*mm]))

    # ---- nafath -----------------------------------------------------------------------------
    E.append(PageBreak())
    E.append(Paragraph('4 · Nafath identity — 12 months (all business, per doctrine)', H2))
    BAD = ('expired', 'rejected', 'failed', 'cancelled', 'denied')
    rows = []
    for m in months:
        by = defaultdict(int); tot = 0
        for r in m.get('nafath', []):
            tot += r['n']
            if r['status'] in BAD:
                by[r['status']] += r['n']
        bad = sum(by.values())
        rows.append([m['month'], f'{tot:,}', f'{bad:,}', f"{100.0*bad/(tot or 1):.1f}%"]
                    + [f"{by.get(s,0):,}" for s in BAD])
    E.append(tbl(['Month', 'Requests', 'Failed*', 'Rate'] + [s for s in BAD],
                 rows, [16*mm, 22*mm, 18*mm, 14*mm, 18*mm, 18*mm, 16*mm, 20*mm, 16*mm]))
    E.append(Paragraph('*All failure statuses are customer/CITC outcomes — a terminal status proves '
                       'Salam’s platform delivered the request. The May-2026 spike coincides with the '
                       'request-volume spike (222k), not with a Salam fault. Salam-IT Nafath issues '
                       'would appear as failed API calls to Nafath, a different (7-day) source.', PM))
    E.append(Spacer(1, 8))
    E.append(Paragraph('Sources: application replica (eligibility_logs · activation_logs · nafath_logs · '
                       'onboarding_orders), extracted day-sliced and throttled on 25 Aug 2026; PII masked '
                       'at extraction. Companions: Salam-Payment-Errors-Catalog (12mo), UPG monthlies, '
                       'Journey-Errors monthly workbooks, Digital-API weekly catalog.', PM))
    doc.build(E)
    print('wrote', out, f'({len(months)} months)')

if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else './journey-errors'
    out = sys.argv[2] if len(sys.argv) > 2 else 'Salam-Journey-Errors-Catalog-Sep2025-Aug2026.pdf'
    main(src, out)
