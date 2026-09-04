#!/usr/bin/env python3
"""Payment Errors — 12-month classified catalog, as a PDF.

Same structure and voice as Payment-Errors-Classified-Catalog-20Aug2026.pdf, extended to
Sep 2025 – Aug 2026 and carrying the four-journey + logged/guest segregation BI asked for.

WHAT THIS REPORT CAN AND CANNOT SAY — read before editing anything here
The 20 Aug catalog could state a business-vs-technical split for every failure because it joined
20,525 references to the UPG gateway one by one. This report covers 553,492 failures over 12
months; that join is not feasible at this volume. The app side stores a reason for only 1.3% of
failures (6,941 of 553,492) — the other 98.7% are "(no message)" because the app persists no
bank_message. So this PDF reports:
   · the FUNNEL and the JOURNEY segregation at full 12-month scale — solid, complete
   · the identity segregation — solid, with each journey's basis named
   · failure REASONS only where the app recorded one, with the coverage stated up front
It does NOT restate the 96/4 business-technical split across 12 months, because that number
cannot be produced from this data without the gateway pass. Saying otherwise would be inventing it.

The `rail` dimension is deliberately ABSENT. payments.card_type is effectively hardcoded to 1
(98.3% "Credit card"); the real rail lives in payment_commit_response#>>'{data,source}'. Proof:
the gateway-derived 20 Aug catalog found 4,369 Apple Pay failures in 19 days, while card_type
finds only 801 across 12 months. Charting card_type as "rail" would be worse than omitting it.

Usage:  python3 tools/build-bi-pdf.py [indir] [outfile]
"""
import json, glob, os, sys, collections, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from families import family, ORDER, KIND_COLOR

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle,
                                PageBreak, KeepTogether)

IN  = sys.argv[1] if len(sys.argv) > 1 else 'bi2/bi'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'Salam-Payment-Errors-Catalog-Sep2025-Aug2026.pdf'
TMP = '/tmp/bi-charts'; os.makedirs(TMP, exist_ok=True)

GREEN = '#00A651'; DARK = '#0B3B2E'; INK = '#11241D'; GREY = '#5F6F69'
AMBER = '#D97706'; RED = '#B3261E'; BLUE = '#2563EB'; TEAL = '#0E9F6E'; LIGHT = '#F2F6F3'

JL = {'1_new_sim': '① New SIM', '2_mnp': '② MNP port-in', '3_recharge': '③ Recharge',
      '4_invoice': '④ Invoice payment', '5_checkout': '⑤ Checkout',
      '1_2_order_type_unknown': 'Order · type unset', 'other': 'Other'}
FOUR = ['1_new_sim', '2_mnp', '3_recharge', '4_invoice']

# ------------------------------------------------------------------ load
months, data, ident = [], {}, {}
for f in sorted(glob.glob(os.path.join(IN, '20*.json'))):
    d = json.load(open(f)); months.append(d['month']); data[d['month']] = d
for f in sorted(glob.glob(os.path.join(IN, 'identity-*.json'))):
    d = json.load(open(f)); ident[d['month']] = d
if not months: sys.exit(f'no data in {IN}')

num = lambda v: float(v) if v not in (None, '') else 0.0
F = collections.Counter()
for m in months:
    for k, v in data[m]['funnel'].items():
        F[k] += num(v) if k.endswith('_sar') else v

JT = collections.defaultdict(collections.Counter)          # journey -> outcome
JM = collections.defaultdict(lambda: collections.Counter())  # journey -> month -> total
for m in months:
    for r in data[m]['journey']:
        JT[r['journey']][r['outcome']] += r['n']
        JT[r['journey']]['total'] += r['n']
        JM[r['journey']][m] += r['n']

ID = collections.defaultdict(collections.Counter)
for m in months:
    for r in ident.get(m, {}).get('rows', []):
        ID[r['journey']][r['account_status']] += r['n']
CO = collections.Counter()
for m in months:
    for r in data[m]['journey']:
        if r['journey'] == '5_checkout': CO[r['identity']] += r['n']

REASON = collections.Counter()
for m in months:
    for r in data[m]['reasons']: REASON[r['reason']] += r['n']
NO_MSG = REASON['(no message)']
WITH_MSG = sum(v for k, v in REASON.items() if k != '(no message)')

# ---- PER-MONTH cuts for sections 2b / 3b / 4b -------------------------------------------
# Every one of these comes from the SAME per-month JSON that produced the 12-month totals, so a
# monthly column always sums back to the annual figure above it. Nothing here is re-derived or
# re-queried; if a monthly row disagreed with the annual table that would be a bug, not a finding.
JMO = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))  # journey>month>outcome
for m in months:
    for r in data[m]['journey']:
        JMO[r['journey']][m][r['outcome']] += r['n']
        JMO[r['journey']][m]['total'] += r['n']

IDM = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))  # journey>month>status
for m in months:
    for r in ident.get(m, {}).get('rows', []):
        IDM[r['journey']][m][r['account_status']] += r['n']
        IDM[r['journey']][m]['total'] += r['n']

IDO = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))   # journey>status>outcome
IDOM = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))  # (journey,status)>month>outcome
for m in months:
    for r in ident.get(m, {}).get('rows', []):
        IDO[r['journey']][r['account_status']][r['outcome']] += r['n']
        IDO[r['journey']][r['account_status']]['total'] += r['n']
        IDOM[(r['journey'], r['account_status'])][m][r['outcome']] += r['n']
        IDOM[(r['journey'], r['account_status'])][m]['total'] += r['n']

COM = collections.defaultdict(collections.Counter)                                   # month>checkout identity
for m in months:
    for r in data[m]['journey']:
        if r['journey'] == '5_checkout':
            COM[m][r['identity']] += r['n']
            COM[m]['total'] += r['n']

RM = collections.defaultdict(collections.Counter)                                    # month>reason
for m in months:
    for r in data[m]['reasons']: RM[m][r['reason']] += r['n']

# ---- FAILURE FAMILIES (sections 2c / 3c / 4c) --------------------------------------------
# Universe = failed + never_attempted + stuck_callback. 'refunded' (21,165 over 12 months) is
# deliberately OUT: a refund is a completed payment reversed later, not a payment that failed.
# That is the whole of the difference between this universe and (total − success).
FAM  = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))  # journey>month>family
for m in months:
    for r in data[m]['journey']:
        if r['outcome'] == 'never_attempted':
            FAM[r['journey']][m]['Abandoned — never engaged'] += r['n']
        elif r['outcome'] == 'stuck_callback':
            FAM[r['journey']][m]['Stuck after gateway answer'] += r['n']
    for r in data[m]['reasons']:
        f = 'No acquirer message (UPG)' if r['reason'] == '(no message)' else family(r['reason'])
        FAM[r['journey']][m][f] += r['n']

FAM_TOT = collections.Counter()                       # family -> 12-month total, all journeys
FAM_MON = collections.defaultdict(collections.Counter)  # month  -> family
FAM_J   = collections.defaultdict(collections.Counter)  # journey-> family
for j in FAM:
    for m in FAM[j]:
        for f, n in FAM[j][m].items():
            FAM_TOT[f] += n; FAM_MON[m][f] += n; FAM_J[j][f] += n
FAM_UNIV = sum(FAM_TOT.values())
FAMS = [f for f, _ in ORDER if FAM_TOT[f]]            # display order, empty families dropped

# monthly tables cannot carry ten columns; these six groups keep every payment counted
GROUPS = [('Abandoned',    ['Abandoned — never engaged']),
          ('No message',   ['No acquirer message (UPG)']),
          ('Declines',     ['Card / bank decline']),
          ('Auth / 3DS',   ['Authentication / 3DS']),
          ('Config',       ['Acquirer configuration']),
          ('Technical',    ['Timeout / gateway technical', 'Stuck after gateway answer']),
          ('Other',        ['Cancelled by user', 'Unspecified failure', 'Other / unclassified'])]
grp = lambda c, keys: sum(c[x] for x in keys)

# the instrumented subset — the only rows where the rail is real (see section 5)
INSTR = collections.Counter()
for m in months:
    for r in data[m]['reasons']:
        if r['vendor'] in ('hyperpay', 'tap') and r['reason'] != '(no message)':
            INSTR[(r['reason'], r['rail'])] += r['n']

TOP_REASONS = [r for r, _ in REASON.most_common(20) if r != '(no message)'][:6]
SHORT = {'transaction declined (format error)': 'format error',
         'transaction declined by authorization system': 'authz refused',
         'transaction declined (amount exceeds credit)': 'exceeds credit',
         'The authentication is cancelled or abandoned': 'auth abandoned',
         'risk management transaction timeout': 'risk timeout',
         'transaction declined (invalid configuration data)': 'bad config',
         'Previously pending transaction timed out': 'pending timeout',
         'bin blacklisted': 'bin blacklist',
         'transaction declined (invalid card)': 'invalid card'}
short = lambda r: SHORT.get(r, r[:16])
ml = lambda m: datetime.date(int(m[:4]), int(m[5:7]), 1).strftime('%b %y')

def pc(n, d):
    if not d: return '—'
    v = n / d * 100
    if v and v < 0.01: return '<0.01%'      # '0.00%' reads as zero, which is not what it means
    return f'{v:.2f}%' if 0 < v < 0.1 else f'{v:.1f}%'
k = lambda n: f'{n:,.0f}'

# ------------------------------------------------------------------ charts
plt.rcParams.update({'font.size': 8.5, 'axes.edgecolor': '#CCD6D1', 'axes.labelcolor': INK,
                     'text.color': INK, 'xtick.color': GREY, 'ytick.color': GREY,
                     'axes.spines.top': False, 'axes.spines.right': False})
thousands = FuncFormatter(lambda x, p: f'{x/1000:.0f}k' if x >= 1000 else f'{x:.0f}')


def save(fig, name):
    p = f'{TMP}/{name}.png'
    fig.savefig(p, dpi=190, bbox_inches='tight', facecolor='white'); plt.close(fig)
    return p


def ch_funnel_bar():
    fig, ax = plt.subplots(figsize=(9.4, 1.15))
    segs = [('success', F['success'], GREEN), ('never attempted', F['never_attempted'], AMBER),
            ('failed', F['failed'], RED)]
    left = 0; tot = F['total']
    for lab, v, c in segs:
        ax.barh(0, v, left=left, color=c, height=.8)
        if v / tot > .12:                       # comfortably inside
            ax.text(left + v / 2, 0, f'{lab}\n{k(v)} ({pc(v,tot)})', ha='center', va='center',
                    color='white', fontsize=9, fontweight='bold')
        else:                                   # too narrow — label below, never clipped
            ax.text(left + v / 2, -.62, f'{lab}\n{k(v)} ({pc(v,tot)})', ha='center', va='top',
                    color=c, fontsize=8, fontweight='bold')
        left += v
    ax.set_xlim(0, tot); ax.set_ylim(-1.5, .55); ax.axis('off')
    return save(fig, 'funnel')


def ch_monthly():
    fig, ax = plt.subplots(figsize=(9.4, 2.9))
    s = [data[m]['funnel']['success'] for m in months]
    n = [data[m]['funnel']['never_attempted'] for m in months]
    f = [data[m]['funnel']['failed'] for m in months]
    ax.bar(months, s, label='success', color=GREEN)
    ax.bar(months, n, bottom=s, label='never attempted', color=AMBER)
    ax.bar(months, f, bottom=[a + b for a, b in zip(s, n)], label='failed', color=RED)
    ax.yaxis.set_major_formatter(thousands)
    ax.legend(ncol=3, frameon=False, loc='upper right', fontsize=8)
    ax.set_title('Monthly funnel — Aug 2026 is a partial month', loc='left', fontsize=9, color=GREY)
    plt.xticks(rotation=45, ha='right')
    return save(fig, 'monthly')


def ch_journeys():
    fig, ax = plt.subplots(figsize=(9.4, 2.6))
    js = FOUR + ['5_checkout']
    labels = [JL[j] for j in js]
    succ = [JT[j]['success'] for j in js]
    nev  = [JT[j]['never_attempted'] for j in js]
    fail = [JT[j]['failed'] for j in js]
    y = range(len(js))
    ax.barh(y, succ, color=GREEN, label='success')
    ax.barh(y, nev, left=succ, color=AMBER, label='never attempted')
    ax.barh(y, fail, left=[a + b for a, b in zip(succ, nev)], color=RED, label='failed')
    ax.set_yticks(list(y)); ax.set_yticklabels(labels); ax.invert_yaxis()
    ax.xaxis.set_major_formatter(thousands)
    ax.legend(ncol=3, frameon=False, loc='lower right', fontsize=8)
    for i, j in enumerate(js):
        t = JT[j]['total']
        ax.text(t + 40000, i, f'{k(t)}  ·  {pc(JT[j]["success"], t)} success',
                va='center', fontsize=8, color=GREY)
    ax.set_xlim(0, max(JT[j]['total'] for j in js) * 1.34)
    ax.set_title('The four journeys (⑤ Checkout shown for completeness)', loc='left',
                 fontsize=9, color=GREY)
    return save(fig, 'journeys')


def ch_identity():
    fig, axes = plt.subplots(1, 3, figsize=(9.4, 2.5))
    # ③ and ④ — account membership
    for ax, j in zip(axes[:2], ['3_recharge', '4_invoice']):
        d = ID[j]; tot = sum(d.values())
        vals = [d.get('has_user_account', 0), d.get('guest_record_only', 0),
                d.get('no_record', 0) + d.get('no_mobile_recorded', 0)]
        ax.pie(vals, colors=[BLUE, TEAL, '#C8D2CE'], startangle=90,
               wedgeprops=dict(width=.42, edgecolor='white'),
               autopct=lambda p: f'{p:.0f}%' if p > 4 else '', pctdistance=.78,
               textprops=dict(fontsize=8, color='white', fontweight='bold'))
        ax.set_title(f'{JL[j]}\naccount membership', fontsize=8.5, color=INK)
    # ⑤ — the real logged/guest split
    ax = axes[2]; tot = sum(CO.values())
    vals = [CO.get('checkout_user', 0), CO.get('checkout_guest', 0),
            CO.get('checkout_anonymoususer', 0) + CO.get('checkout_deleteduser', 0)]
    ax.pie(vals, colors=[BLUE, TEAL, '#C8D2CE'], startangle=90,   # identical semantics to the two rings left
           wedgeprops=dict(width=.42, edgecolor='white'),
           autopct=lambda p: f'{p:.0f}%' if p > 4 else '', pctdistance=.78,
           textprops=dict(fontsize=8, color='white', fontweight='bold'))
    ax.set_title('⑤ Checkout\nlogged in vs guest (recorded)', fontsize=8.5, color=INK)
    fig.legend(['registered / logged in', 'guest', 'neither / anonymous'],
               ncol=3, frameon=False, loc='lower center', fontsize=8, bbox_to_anchor=(.5, -.06))
    return save(fig, 'identity')


def ch_reasons():
    top = [(r, n) for r, n in REASON.most_common(14) if r != '(no message)'][:12]
    fig, ax = plt.subplots(figsize=(9.4, 2.9))
    labs = [r[:52] for r, _ in top][::-1]; vals = [n for _, n in top][::-1]
    ax.barh(labs, vals, color=BLUE)
    for i, v in enumerate(vals): ax.text(v * 1.02, i, k(v), va='center', fontsize=8, color=INK)
    ax.set_xlim(0, max(vals) * 1.2)
    ax.set_title(f'Failure reasons where the app recorded one — {k(WITH_MSG)} of {k(F["failed"])} '
                 f'failures ({pc(WITH_MSG, F["failed"])})', loc='left', fontsize=9, color=GREY)
    return save(fig, 'reasons')


def ch_journey_monthly():
    fig, ax = plt.subplots(figsize=(9.4, 2.5))
    for j, c in zip(FOUR + ['5_checkout'], [GREEN, '#7C3AED', BLUE, AMBER, '#6B7280']):
        ys = [JMO[j][m]['success'] / JMO[j][m]['total'] * 100 if JMO[j][m]['total'] else None
              for m in months]
        ax.plot([ml(m) for m in months], ys, marker='o', ms=3.2, lw=1.6, color=c, label=JL[j])
    ax.set_ylim(0, 100); ax.set_ylabel('success rate %', fontsize=8)
    ax.legend(ncol=5, frameon=False, fontsize=7.5, loc='upper center', bbox_to_anchor=(.5, 1.22))
    ax.grid(axis='y', color='#EDF2EF', lw=.8)
    plt.xticks(rotation=45, ha='right')
    return save(fig, 'journey_monthly')


def ch_identity_monthly():
    fig, ax = plt.subplots(figsize=(9.4, 2.4))
    r3 = [IDM['3_recharge'][m]['has_user_account'] / IDM['3_recharge'][m]['total'] * 100
          if IDM['3_recharge'][m]['total'] else None for m in months]
    r4 = [IDM['4_invoice'][m]['has_user_account'] / IDM['4_invoice'][m]['total'] * 100
          if IDM['4_invoice'][m]['total'] else None for m in months]
    c5 = [COM[m]['checkout_user'] / COM[m]['total'] * 100 if COM[m]['total'] else None
          for m in months]
    x = [ml(m) for m in months]
    ax.plot(x, r3, marker='o', ms=3.2, lw=1.7, color=BLUE, label='③ Recharge — mobile has an account')
    ax.plot(x, r4, marker='s', ms=3.2, lw=1.7, color=TEAL, label='④ Invoice — mobile has an account')
    ax.plot(x, c5, marker='^', ms=3.4, lw=1.7, color=AMBER, label='⑤ Checkout — genuinely logged in')
    ax.set_ylim(0, 100); ax.set_ylabel('% of payments', fontsize=8)
    ax.legend(ncol=3, frameon=False, fontsize=7.5, loc='upper center', bbox_to_anchor=(.5, 1.24))
    ax.grid(axis='y', color='#EDF2EF', lw=.8)
    plt.xticks(rotation=45, ha='right')
    return save(fig, 'identity_monthly')


def ch_reason_monthly():
    # Two things at once: how many failures carried a reason, and what SHARE that was. The share
    # matters more — a month can show more reasoned failures simply because it had more failures.
    fig, ax = plt.subplots(figsize=(9.4, 2.4))
    wm = [sum(v for r, v in RM[m].items() if r != '(no message)') for m in months]
    fl = [data[m]['funnel']['failed'] for m in months]
    x = [ml(m) for m in months]
    ax.bar(x, wm, color=BLUE, label='failures with a recorded reason')
    ax.set_ylabel('failures with a reason', fontsize=8)
    ax.yaxis.set_major_formatter(FuncFormatter(          # 1,500 and 2,000 both rendered as "2k"
        lambda v, _: f'{v/1000:.1f}k'.replace('.0k', 'k') if v >= 1000 else f'{v:.0f}'))
    ax2 = ax.twinx()
    ax2.plot(x, [w / f * 100 if f else None for w, f in zip(wm, fl)], color=RED, lw=1.8,
             marker='o', ms=3.2, label='coverage % of all failures')
    ax2.set_ylim(0, 8); ax2.set_ylabel('coverage %', fontsize=8, color=RED)
    ax2.tick_params(axis='y', colors=RED); ax2.spines['right'].set_visible(True)
    hA, lA = ax.get_legend_handles_labels(); hB, lB = ax2.get_legend_handles_labels()
    ax.legend(hA + hB, lA + lB, ncol=2, frameon=False, fontsize=7.5,
              loc='upper center', bbox_to_anchor=(.5, 1.22))
    plt.setp(ax.get_xticklabels(), rotation=45, ha='right')
    return save(fig, 'reason_monthly')


def ch_families():
    # the direct analogue of the shared chart: one bar per family, coloured by what it means
    fig, ax = plt.subplots(figsize=(9.4, 3.1))
    kind = dict(ORDER)
    fs = [f for f in FAMS][::-1]
    vals = [FAM_TOT[f] for f in fs]
    ax.barh(fs, vals, color=[KIND_COLOR[kind[f]] for f in fs])
    for i, v in enumerate(vals):
        ax.text(v * 1.015, i, f'{k(v)}  ({v/FAM_UNIV*100:.1f}%)', va='center', fontsize=8, color=INK)
    ax.set_xscale('log'); ax.set_xlim(.8, FAM_UNIV * 12)
    ax.set_title(f'Failure families over {k(FAM_UNIV)} non-successful payments — customer-side blue · '
                 f'acquirer config amber · technical red · coverage artefact grey  (LOG scale)',
                 loc='left', fontsize=8.5, color=GREY)
    return save(fig, 'families')


def ch_families_journey():
    # share-of-family within each journey: the shape differs sharply between journeys
    fig, ax = plt.subplots(figsize=(9.4, 2.4))
    js = FOUR + ['5_checkout']
    kind = dict(ORDER)
    left = [0] * len(js)
    for f in FAMS:
        vals = [FAM_J[j][f] / sum(FAM_J[j].values()) * 100 if sum(FAM_J[j].values()) else 0 for j in js]
        ax.barh([JL[j] for j in js], vals, left=left, color=KIND_COLOR[kind[f]],
                edgecolor='white', lw=.6)
        left = [a + b for a, b in zip(left, vals)]
    ax.set_xlim(0, 100); ax.invert_yaxis()
    ax.set_xlabel('% of that journey\'s non-successful payments', fontsize=8)
    ax.set_title('Family mix by journey — the amber and red slivers are too small to see, which is '
                 'the point', loc='left', fontsize=8.5, color=GREY)
    seen, handles = [], []
    for f in FAMS:
        kd = kind[f]
        if kd in seen: continue
        seen.append(kd)
        handles.append(plt.Rectangle((0, 0), 1, 1, color=KIND_COLOR[kd]))
    ax.legend(handles, ['customer-side (abandoned · declines · auth)', 'no acquirer message',
                        'acquirer configuration', 'technical'][:len(handles)],
              ncol=4, frameon=False, fontsize=7.3, loc='lower center', bbox_to_anchor=(.5, -.52))
    return save(fig, 'families_journey')


def ch_instrumented():
    # reason · rail, for the vendors that actually report both — mirrors the second shared chart
    top = INSTR.most_common(14)[::-1]
    fig, ax = plt.subplots(figsize=(9.4, 3.2))
    labs = [f'{r[:38]} · {rail}' for (r, rail), _ in top]
    vals = [n for _, n in top]
    cmap = {'Apple Pay': '#0E9F6E', 'STC Pay': '#0E9F6E', 'mada': AMBER,
            'Credit card': BLUE, 'Amex': BLUE, 'Other': GREY}
    ax.barh(labs, vals, color=[cmap.get(rail, BLUE) for (_, rail), _ in top])
    for i, v in enumerate(vals): ax.text(v * 1.02, i, k(v), va='center', fontsize=8, color=INK)
    ax.set_xlim(0, max(vals) * 1.22)
    ax.set_title(f'Reason · rail — HyperPay and Tap only ({k(sum(INSTR.values()))} failures). '
                 f'Wallets teal · mada amber · card blue', loc='left', fontsize=8.5, color=GREY)
    return save(fig, 'instrumented')


charts = {n: fn() for n, fn in [('funnel', ch_funnel_bar), ('monthly', ch_monthly),
                                ('families', ch_families),
                                ('families_journey', ch_families_journey),
                                ('instrumented', ch_instrumented),
                                ('journey_monthly', ch_journey_monthly),
                                ('identity_monthly', ch_identity_monthly),
                                ('reason_monthly', ch_reason_monthly),
                                ('journeys', ch_journeys), ('identity', ch_identity),
                                ('reasons', ch_reasons)]}

# ------------------------------------------------------------------ document
ss = getSampleStyleSheet()
H1 = ParagraphStyle('H1', parent=ss['Title'], fontSize=19, textColor=colors.HexColor(INK),
                    alignment=1, spaceAfter=4, fontName='Helvetica-Bold')
SUB = ParagraphStyle('SUB', parent=ss['Normal'], fontSize=8, textColor=colors.HexColor(GREY),
                     alignment=1, spaceAfter=12)
H2 = ParagraphStyle('H2', parent=ss['Heading2'], fontSize=12.5, textColor=colors.HexColor(GREEN),
                    spaceBefore=13, spaceAfter=7, fontName='Helvetica-Bold')
TH = None   # defined after BODY; white bold, for cells inside the dark header row
BODY = ParagraphStyle('BODY', parent=ss['Normal'], fontSize=9.2, leading=13.4,
                      textColor=colors.HexColor(INK), spaceAfter=7)
CAP = ParagraphStyle('CAP', parent=ss['Normal'], fontSize=7.8, leading=10.5,
                     textColor=colors.HexColor(GREY), spaceAfter=5)
NOTE = ParagraphStyle('NOTE', parent=ss['Normal'], fontSize=8.2, leading=11.5,
                      textColor=colors.HexColor(AMBER), spaceAfter=6)
TH = ParagraphStyle('TH', parent=ss['Normal'], fontSize=8, leading=10.5,
                    textColor=colors.white, fontName='Helvetica-Bold', spaceAfter=0)
TD = ParagraphStyle('TD', parent=ss['Normal'], fontSize=8, leading=10.5,
                    textColor=colors.HexColor(INK), spaceAfter=0)
TDR = ParagraphStyle('TDR', parent=TD, alignment=2)   # right-aligned numeric cell

story = []
W = 175 * mm


def img(name, w=W):
    from PIL import Image as PImage
    iw, ih = PImage.open(charts[name]).size
    return Image(charts[name], width=w, height=w * ih / iw)


def table(rows, widths, header=True, align_right=None):
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    st = [('FONTSIZE', (0, 0), (-1, -1), 8),
          ('LEADING', (0, 0), (-1, -1), 10.5),
          ('VALIGN', (0, 0), (-1, -1), 'TOP'),
          ('GRID', (0, 0), (-1, -1), .4, colors.HexColor('#DDE7E1')),
          ('TOPPADDING', (0, 0), (-1, -1), 3.5),
          ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5)]
    if header:
        st += [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(DARK)),
               ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
               ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold')]
    for c in (align_right or []):
        st.append(('ALIGN', (c, 0), (c, -1), 'RIGHT'))
    t.setStyle(TableStyle(st))
    return t


def mtable(rows, widths, align_right=None, fs=7.2):
    t = Table(rows, colWidths=widths, repeatRows=1)
    st = [('FONTSIZE', (0, 0), (-1, -1), fs), ('LEADING', (0, 0), (-1, -1), fs + 1.9),
          ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
          ('GRID', (0, 0), (-1, -1), .35, colors.HexColor('#DDE7E1')),
          ('TOPPADDING', (0, 0), (-1, -1), 2.2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2.2),
          ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(DARK)),
          ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
          ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
          ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
          ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F7FAF8')])]
    for c in (align_right or []): st.append(('ALIGN', (c, 0), (c, -1), 'RIGHT'))
    t.setStyle(TableStyle(st))
    return t


THW = ParagraphStyle('THW', parent=ss['Normal'], fontSize=6.6, leading=7.8, alignment=2,
                     textColor=colors.white, fontName='Helvetica-Bold', spaceAfter=0)

SUBH = ParagraphStyle('SUBH', parent=ss['Heading3'], fontSize=10, textColor=colors.HexColor(DARK),
                      spaceBefore=10, spaceAfter=5, fontName='Helvetica-Bold')

# ---- title
story += [
    Paragraph('Payment Errors — 12-month classified catalog', H1),
    Paragraph(f'September 2025 – August 2026 · {k(F["total"])} payments · segregated by journey and by '
              f'customer identity · app replica, read-only · built {datetime.date.today():%d %b %Y}', SUB),
    Paragraph(
        f'<b>Result: {k(F["success"])} succeeded ({pc(F["success"], F["total"])}), '
        f'{k(F["failed"])} failed ({pc(F["failed"], F["total"])}), and '
        f'{k(F["never_attempted"])} ({pc(F["never_attempted"], F["total"])}) were never attempted — '
        f'a payment record was created but the customer never reached or never finished the payment '
        f'page.</b> That third number is the largest single block in the dataset and it is not an '
        f'error: it is unfinished intent. Only {k(F["stuck_callback"])} payments '
        f'({pc(F["stuck_callback"], F["total"])}) are stuck after a gateway answer — the true '
        f'platform-fault bucket, and it is very small.', BODY),
]

# ---- 1 funnel
story += [Paragraph('1 · The funnel — where 12 months of payments went', H2),
          Paragraph(f'All payments Sep 2025 – Aug 2026 — {k(F["total"])} total · '
                    f'{k(F["success_sar"])} SAR collected · {k(F["failed_sar"])} SAR failed', CAP),
          img('funnel'), Spacer(1, 7), img('monthly'), Spacer(1, 5),
          Paragraph(
              'Volume declines steadily from ~490k payments a month in late 2025 to ~377k by July '
              '2026, while the outcome mix stays flat — the shape of the funnel does not change, '
              'only its size. No single incident month stands out. August 2026 is partial (the '
              'month was still running when the data was taken) and must not be compared to the '
              'others.', BODY)]

# ---- 2 journeys
story += [PageBreak(),
          Paragraph('2 · The four journeys — the segregation requested', H2),
          img('journeys'), Spacer(1, 6)]

rows = [['Journey', 'Payments', 'Success', 'Failed', 'Never attempted', 'Stuck', 'Success rate']]
for j in FOUR + ['5_checkout']:
    t = JT[j]
    rows.append([JL[j], k(t['total']), k(t['success']), k(t['failed']),
                 k(t['never_attempted']), k(t['stuck_callback']), pc(t['success'], t['total'])])
tot_j = sum(JT[j]['total'] for j in JT)
rows.append(['ALL (incl. other)', k(tot_j), k(F['success']), k(F['failed']),
             k(F['never_attempted']), k(F['stuck_callback']), pc(F['success'], F['total'])])
story += [table(rows, [42*mm, 23*mm, 22*mm, 20*mm, 27*mm, 17*mm, 24*mm], align_right=[1,2,3,4,5,6]),
          Spacer(1, 7),
          Paragraph(
              f'<b>Recharge dominates.</b> {pc(JT["3_recharge"]["total"], tot_j)} of all payments are '
              f'recharges ({k(JT["3_recharge"]["total"])}), invoice payments a further '
              f'{pc(JT["4_invoice"]["total"], tot_j)}. New SIM and MNP together are '
              f'{pc(JT["1_new_sim"]["total"] + JT["2_mnp"]["total"], tot_j)} of payment volume — '
              f'commercially important, operationally a small share of transactions.', BODY),
          Paragraph(
              f'<b>The success rate differs sharply by journey.</b> New SIM converts at '
              f'{pc(JT["1_new_sim"]["success"], JT["1_new_sim"]["total"])} and MNP at '
              f'{pc(JT["2_mnp"]["success"], JT["2_mnp"]["total"])}, against '
              f'{pc(JT["3_recharge"]["success"], JT["3_recharge"]["total"])} for recharge. The gap is '
              f'almost entirely never-attempted, not failure: onboarding creates a payment record '
              f'early in a long journey, so abandonment lands here rather than in the failure count.', BODY)]

# ---- 2b journeys, month by month
story += [PageBreak(),
          Paragraph('2b · The same four journeys, month by month', SUBH),
          Paragraph(
              'Identical criteria to the table above, cut by month. Each journey block sums exactly '
              'to its annual row. August 2026 is a partial month in every block and must not be read '
              'as a decline.', BODY),
          img('journey_monthly'), Spacer(1, 4),
          Paragraph(
              '<b>The lines are not flat, and they do not all move the same way.</b> Excluding partial '
              'August: ① New SIM falls from 81.7% to 74.2% (−7.5 points), while ③ Recharge rises from '
              '45.7% to 51.7% (+6.0) and ④ Invoice from 54.1% to 62.3% (+8.2). ② MNP is broadly flat '
              'apart from a 68.6% dip in March 2026.', BODY),
          Paragraph(
              '<b>New SIM is losing customers to abandonment, not to payment failure.</b> Over the same '
              'window its never-attempted share climbs from 10.9% to 16.7% (+5.8 points) while its '
              'failure share moves only 4.5% to 5.8% (+1.3). Monthly New SIM volume also falls from '
              '~14.0k to ~10.7k. Whatever changed sits in the onboarding journey ahead of the payment '
              'page — this report can locate it but cannot diagnose it; that needs the funnel '
              'instrumentation in the console, not the payments table.', BODY)]

for j in FOUR + ['5_checkout']:
    rows = [['Month', 'Payments', 'Success', 'Failed', 'Never attempted', 'Stuck', 'Success rate']]
    for m in months:
        c = JMO[j][m]
        rows.append([ml(m), k(c['total']), k(c['success']), k(c['failed']),
                     k(c['never_attempted']), k(c['stuck_callback']), pc(c['success'], c['total'])])
    t = JT[j]
    rows.append(['12-month', k(t['total']), k(t['success']), k(t['failed']),
                 k(t['never_attempted']), k(t['stuck_callback']), pc(t['success'], t['total'])])
    blk = mtable(rows, [20*mm, 27*mm, 25*mm, 23*mm, 28*mm, 20*mm, 32*mm],
                 align_right=[1, 2, 3, 4, 5, 6])
    blk.setStyle(TableStyle([('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E8F1EC')),
                             ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold')]))
    story += [KeepTogether([Paragraph(JL[j] + ' — by month', SUBH), blk, Spacer(1, 3)])]

# ---- 2c journeys by failure category
story += [PageBreak(),
          Paragraph('2c · The same journeys, by failure category', SUBH),
          Paragraph(
              f'Every non-successful payment — {k(FAM_UNIV)} of them — placed in one family, using '
              f'the same grouping as the charts BI circulated. Refunds ({k(21165)} over the year) are '
              f'excluded: a refund is a completed payment reversed later, not a payment that failed. '
              f'Families never overlap, so each journey column sums to that journey\'s non-successful '
              f'total.', BODY),
          img('families_journey'), Spacer(1, 6)]

kind = dict(ORDER)
KIND_WORD = {'customer': 'customer-side', 'coverage': 'not a reason — a coverage gap',
             'config': 'ACQUIRER CONFIG', 'technical': 'technical'}
rows = [[Paragraph(c, THW) for c in ['Failure family', 'What it means'] +
         [JL[j] for j in FOUR] + ['⑤ Checkout', 'All', 'Share']]]
for f in FAMS:
    rows.append([Paragraph(f, TD), Paragraph(KIND_WORD[kind[f]], TD)] +
                [Paragraph(k(FAM_J[j][f]), TDR) for j in FOUR + ['5_checkout']] +
                [Paragraph(k(FAM_TOT[f]), TDR), Paragraph(pc(FAM_TOT[f], FAM_UNIV), TDR)])
rows.append([Paragraph('<b>All non-successful</b>', TD), Paragraph('', TD)] +
            [Paragraph('<b>' + k(sum(FAM_J[j].values())) + '</b>', TDR) for j in FOUR + ['5_checkout']] +
            [Paragraph('<b>' + k(FAM_UNIV) + '</b>', TDR), Paragraph('<b>100%</b>', TDR)])
tb = mtable(rows, [37*mm, 30*mm, 17*mm, 17*mm, 20*mm, 18*mm, 18*mm, 20*mm, 15*mm])
tb.setStyle(TableStyle([('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E8F1EC'))]))
story += [tb, Spacer(1, 6),
          Paragraph(
              f'<b>Abandonment is not a payment problem and it dwarfs everything else</b> — '
              f'{pc(FAM_TOT["Abandoned — never engaged"], FAM_UNIV)} of all non-successful payments '
              f'never reached the acquirer at all. Of what genuinely reached a gateway and failed, '
              f'{pc(FAM_TOT["No acquirer message (UPG)"], FAM_TOT["No acquirer message (UPG)"] + sum(FAM_TOT[f] for f in FAMS if f not in ("Abandoned — never engaged", "No acquirer message (UPG)")))} '
              f'carries no reason we can read — see 4c for why that is a vendor question, not an app one.', BODY)]

for j in FOUR:
    rows = [[Paragraph(c, THW) for c in ['Month'] + [g for g, _ in GROUPS] + ['Total']]]
    for m in months:
        c = FAM[j][m]
        rows.append([Paragraph(ml(m), TD)] +
                    [Paragraph(k(grp(c, ks)), TDR) for _, ks in GROUPS] +
                    [Paragraph(k(sum(c.values())), TDR)])
    c = FAM_J[j]
    rows.append([Paragraph('<b>12-month</b>', TD)] +
                [Paragraph('<b>' + k(grp(c, ks)) + '</b>', TDR) for _, ks in GROUPS] +
                [Paragraph('<b>' + k(sum(c.values())) + '</b>', TDR)])
    blk = mtable(rows, [17*mm, 24*mm, 24*mm, 21*mm, 21*mm, 19*mm, 22*mm, 19*mm, 24*mm])
    blk.setStyle(TableStyle([('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E8F1EC'))]))
    story += [KeepTogether([Paragraph(JL[j] + ' — failure category by month', SUBH), blk, Spacer(1, 3)])]

story += [Paragraph(
    'Column groups: <b>Abandoned</b> = never engaged · <b>No message</b> = reached a gateway, no '
    'readable reason · <b>Declines</b> = card / bank refusals · <b>Auth / 3DS</b> = authentication '
    'outcomes · <b>Config</b> = acquirer configuration · <b>Technical</b> = timeouts, gateway faults '
    'and payments stuck after an answer · <b>Other</b> = user cancellations and unspecified.', CAP)]

# ---- 3 identity
story += [PageBreak(),
          Paragraph('3 · Logged in vs not — reported three different ways, because it is recorded three different ways', H2),
          Paragraph(
              'The application does not record one thing called "logged in". It records three, and '
              'this report keeps them apart rather than blending them into a single number that '
              'would not be true of any of them.', BODY),
          img('identity'), Spacer(1, 8)]

rows = [['Journey', 'What is actually recorded', 'Split']]
rows.append([JL['1_new_sim'] + ' / ' + JL['2_mnp'],
             'orderable_type on the order — 99.99% AnonymousUser. Correct behaviour: a customer '
             'has no account before buying their first SIM.',
             'No split shown.<br/>Inventing one would misrepresent the journey.'])
r3 = ID['3_recharge']; t3 = sum(r3.values())
rows.append([JL['3_recharge'],
             'Nothing. payment_on_id is NULL on 100% of recharge payments — no identity link exists. '
             'Reported instead: does the paying mobile exist in users / guests?',
             f'has account <b>{pc(r3["has_user_account"], t3)}</b><br/>'
             f'guest record only <b>{pc(r3["guest_record_only"], t3)}</b><br/>'
             f'neither {pc(r3["no_record"] + r3["no_mobile_recorded"], t3)}'])
r4 = ID['4_invoice']; t4 = sum(r4.values())
rows.append([JL['4_invoice'], 'Same as recharge — no identity link; account membership reported.',
             f'has account <b>{pc(r4["has_user_account"], t4)}</b><br/>'
             f'guest record only <b>{pc(r4["guest_record_only"], t4)}</b><br/>'
             f'neither {pc(r4["no_record"], t4)}'])
tc = sum(CO.values())
rows.append([JL['5_checkout'],
             'checkoutable_type on the checkout — genuinely carries User / Guest / AnonymousUser. '
             'The only journey where logged-in state is directly recorded.',
             f'logged in <b>{pc(CO["checkout_user"], tc)}</b><br/>'
             f'guest <b>{pc(CO["checkout_guest"], tc)}</b><br/>'
             f'anonymous {pc(CO["checkout_anonymoususer"] + CO["checkout_deleteduser"], tc)}'])
story += [table([[Paragraph(c, TH if i == 0 else TD) for c in r] for i, r in enumerate(rows)],
                [40*mm, 88*mm, 47*mm]), Spacer(1, 7),
          Paragraph(
              '<b>Please do not relabel the recharge and invoice columns "logged in / not logged in".</b> '
              'They say whether that mobile number is a registered customer, not whether the person '
              'was authenticated when they paid — the application does not store that. Roughly one '
              'payment in five on both journeys comes from a number with no user account, which is '
              'consistent with the guest recharge flow being heavily used.', NOTE),
          Paragraph(
              '<i>A proxy that was tested and rejected:</i> comparing customer_mobile_number to '
              'target_mobile_number. Over 12 months it returned 3,509,083 "same" against 24 '
              '"different" — the application writes both columns with the same value, so the '
              'comparison is a constant, not a signal. It was dropped rather than shipped.', CAP)]

# ---- 3b identity, month by month
story += [PageBreak(),
          Paragraph('3b · The identity split, month by month', SUBH),
          Paragraph(
              'The same three measures as above, per month — and the same warning applies to every '
              'row: ③ and ④ report whether the paying mobile is a registered customer, ⑤ reports '
              'genuine session state. They are three different things and are not summable across '
              'the row.', BODY),
          img('identity_monthly'), Spacer(1, 6)]

rows = [['Month', '③ payments', '③ has acct', '③ guest rec', '④ payments', '④ has acct',
         '④ guest rec', '⑤ payments', '⑤ logged in', '⑤ guest']]
for m in months:
    a, b_, c = IDM['3_recharge'][m], IDM['4_invoice'][m], COM[m]
    rows.append([ml(m),
                 k(a['total']), pc(a['has_user_account'], a['total']), pc(a['guest_record_only'], a['total']),
                 k(b_['total']), pc(b_['has_user_account'], b_['total']), pc(b_['guest_record_only'], b_['total']),
                 k(c['total']), pc(c['checkout_user'], c['total']), pc(c['checkout_guest'], c['total'])])
rows.append(['12-month',
             k(t3), pc(r3['has_user_account'], t3), pc(r3['guest_record_only'], t3),
             k(t4), pc(r4['has_user_account'], t4), pc(r4['guest_record_only'], t4),
             k(tc), pc(CO['checkout_user'], tc), pc(CO['checkout_guest'], tc)])
tb = mtable(rows, [15*mm, 20*mm, 17*mm, 17*mm, 20*mm, 17*mm, 17*mm, 20*mm, 16*mm, 16*mm],
            align_right=list(range(1, 10)))
tb.setStyle(TableStyle([('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E8F1EC')),
                        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold')]))
story += [tb, Spacer(1, 5),
          Paragraph(
              'The residual — "neither" for ③ and ④, "anonymous" for ⑤ — is the remainder of each '
              'group of three and is omitted for width; it is in the workbook in full. ① New SIM and '
              '② MNP are absent from this table for the reason given above: the app records '
              'AnonymousUser on 99.99% of those orders, so a monthly split would be twelve rows of '
              'the same non-answer.', CAP),
          Paragraph(
              'Recharge sits near three-quarters registered in every single month, drifting gently up '
              'from 73.0% to 78.4% across the year. ④ Invoice moves further in the same direction — '
              '67.2% to 79.2%, twelve points — while ⑤ Checkout\'s genuinely-logged-in share stays '
              'flat around 65%. There is no month in which the guest share spikes.', BODY),
          Paragraph(
              'The steadiness is itself the finding: guest recharge is a permanent, designed-for share '
              'of the business, not an anomaly to be chased. The upward drift on ③ and ④ is consistent '
              'with the registered base growing over the year rather than with behaviour changing, but '
              'this table cannot separate those two explanations and should not be used to claim '
              'either.', BODY)]

# ---- 3c identity by failure category
story += [PageBreak(),
          Paragraph('3c · Failure category by customer identity', SUBH),
          Paragraph(
              '<b>This cut is deliberately shallower than 2c, and the reason matters.</b> The identity '
              'pass records an outcome per payment, not an acquirer message, so only the three '
              'families that come from the outcome itself can be split by identity: abandoned, '
              'reached-a-gateway-and-failed, and stuck. Declines, authentication and configuration '
              'cannot be broken down this way without a second extract. Showing them here with '
              'invented proportions would be the easiest and worst mistake in this report.', NOTE)]

SEG = [('has_user_account', 'Registered — mobile exists in users'),
       ('guest_record_only', 'Guest record only'),
       ('no_record', 'No record in either table')]
rows = [[Paragraph(c, THW) for c in
         ['Journey · segment', 'Payments', 'Abandoned', 'Failed at gateway', 'Stuck', 'Success rate']]]
for j in ['3_recharge', '4_invoice']:
    for key, lab in SEG:
        c = IDO[j][key]; t = c['total']
        if not t: continue
        rows.append([Paragraph(f'{JL[j]} · {lab}', TD), Paragraph(k(t), TDR),
                     Paragraph(pc(c['never_attempted'], t), TDR),
                     Paragraph(pc(c['failed'], t), TDR),
                     Paragraph(k(c['stuck_callback']), TDR),
                     Paragraph(pc(c['success'], t), TDR)])
tb = mtable(rows, [62*mm, 24*mm, 22*mm, 28*mm, 17*mm, 22*mm])
story += [tb, Spacer(1, 6)]

_r3h = IDO['3_recharge']['has_user_account']; _r3n = IDO['3_recharge']['no_record']
story += [Paragraph(
    f'<b>Registered customers do not fail less — they abandon less.</b> On ③ Recharge a mobile with '
    f'an account succeeds {pc(_r3h["success"], _r3h["total"])} of the time against '
    f'{pc(_r3n["success"], _r3n["total"])} for a mobile with no record at all, and almost the whole '
    f'gap is abandonment ({pc(_r3h["never_attempted"], _r3h["total"])} vs '
    f'{pc(_r3n["never_attempted"], _r3n["total"])}) rather than gateway failure '
    f'({pc(_r3h["failed"], _r3h["total"])} vs {pc(_r3n["failed"], _r3n["total"])}). A saved card and a '
    f'known number remove steps; they do not make the bank more likely to approve.', BODY)]

rows = [[Paragraph(c, THW) for c in ['Month'] +
         ['③ registered', '③ guest rec', '③ no record', '④ registered', '④ guest rec', '④ no record']]]
for m in months:
    cells = []
    for j in ['3_recharge', '4_invoice']:
        for key, _ in SEG:
            c = IDOM[(j, key)][m]; t = c['total']
            cells.append(pc(c['failed'], t) if t else '—')
    rows.append([Paragraph(ml(m), TD)] + [Paragraph(x, TDR) for x in cells])
cells = []
for j in ['3_recharge', '4_invoice']:
    for key, _ in SEG:
        c = IDO[j][key]; cells.append(pc(c['failed'], c['total']) if c['total'] else '—')
rows.append([Paragraph('<b>12-month</b>', TD)] + [Paragraph('<b>' + x + '</b>', TDR) for x in cells])
tb = mtable(rows, [19*mm, 26*mm, 26*mm, 26*mm, 26*mm, 26*mm, 26*mm])
tb.setStyle(TableStyle([('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E8F1EC'))]))
story += [KeepTogether([Paragraph('Gateway failure rate by identity segment, by month', SUBH), tb]),
          Spacer(1, 5),
          Paragraph(
              'Failure rate here is failed ÷ all payments in that segment and month, so it is '
              'comparable down a column and across the row. The segments move together every month, '
              'which is what you would expect if the acquirer treats them identically — as it should.',
              CAP)]

# ---- 4 reasons + the limitation
story += [PageBreak(),
          Paragraph('4 · Why payments failed — and the limit of what the app can tell us', H2),
          Paragraph(
              f'<b>Of {k(F["failed"])} failed payments, the application recorded a reason for only '
              f'{k(WITH_MSG)} — {pc(WITH_MSG, F["failed"])}.</b> The remaining {k(NO_MSG)} carry no '
              f'message at all, because the app does not persist the acquirer response. This is the '
              f'same limitation the 20 August catalog identified and worked around: for that report '
              f'every one of the 20,525 failed references was resolved individually at the UPG '
              f'gateway, which is where the reasons actually live. That join is not feasible at '
              f'{k(F["failed"])} failures across 12 months.', BODY),
          Paragraph(
              'Consequently this report does <b>not</b> restate the 96% business / 4% technical split '
              'over 12 months. That figure was earned by the gateway pass and cannot be reproduced '
              'from app-side data; extrapolating it across a year would be presenting an assumption '
              'as a measurement. What follows is the reasons the app did record.', NOTE),
          img('reasons'), Spacer(1, 6)]

rows = [['Reason recorded by the app', 'Failures', 'Share of reasoned']]
for r, n in [(r, n) for r, n in REASON.most_common(16) if r != '(no message)'][:12]:
    rows.append([r[:74], k(n), pc(n, WITH_MSG)])
story += [table([[Paragraph(c, TH if i == 0 else TD) for c in r] for i, r in enumerate(rows)],
                [108*mm, 33*mm, 34*mm], align_right=[1, 2]), Spacer(1, 7),
          Paragraph(
              'Read this table as a shape, not a total. Where a reason exists, declines dominate — '
              'format errors, authorisation-system refusals, amount exceeding credit and abandoned '
              'authentication together account for most of it. All are customer- or bank-side '
              'outcomes, which is consistent with the 20 August finding that platform faults are a '
              'small minority of failures.', BODY)]

# ---- 4b reasons, month by month
story += [PageBreak(),
          Paragraph('4b · Recorded reasons, month by month', SUBH),
          Paragraph(
              'The coverage caveat above applies to every cell below. These are counts of the '
              'failures where the app stored a message — never a picture of all failures in that '
              'month. Coverage itself moves between months, so a rise in one reason may be a rise in '
              'logging, not a rise in the fault.', NOTE),
          img('reason_monthly'), Spacer(1, 6)]

rows = [[Paragraph(c, THW) for c in
         ['Month', 'Failed', 'With reason', 'Coverage'] + [short(r) for r in TOP_REASONS]]]
for m in months:
    fl = data[m]['funnel']['failed']
    wm = sum(v for r, v in RM[m].items() if r != '(no message)')
    rows.append([ml(m), k(fl), k(wm), pc(wm, fl)] + [k(RM[m].get(r, 0)) for r in TOP_REASONS])
rows.append(['12-month', k(F['failed']), k(WITH_MSG), pc(WITH_MSG, F['failed'])] +
            [k(REASON[r]) for r in TOP_REASONS])
tb = mtable(rows, [15*mm, 19*mm, 20*mm, 18*mm] + [17.16*mm] * len(TOP_REASONS),
            align_right=list(range(1, 4 + len(TOP_REASONS))), fs=6.8)
tb.setStyle(TableStyle([('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E8F1EC')),
                        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold')]))
story += [tb, Spacer(1, 5),
          Paragraph(
              '<b>Coverage is not stable, and that governs how this table may be read.</b> It ranges '
              'from 0.07% (Aug 2026) to 6.7% (Jul 2026) — a hundredfold difference between months. July '
              'therefore contributes a large share of every reason column, not because July failed '
              'differently but because more of July was logged. Compare reasons WITHIN a month by '
              'share; do not compare a reason\'s count ACROSS months.', NOTE),
          Paragraph('Column headings are shortened. In full: ' +
                    ' · '.join(f'<b>{short(r)}</b> = {r}' for r in TOP_REASONS) + '.', CAP)]

# ---- 4c the family view + why coverage is a vendor question
story += [PageBreak(),
          Paragraph('4c · Every failure placed in a category — and why most of them are unreadable', SUBH),
          Paragraph(
              '<b>Reason coverage is a vendor gap, not an application limitation.</b> Split the same '
              f'{k(F["failed"])} failures by the gateway that handled them: HyperPay wrote an acquirer '
              'message into our record on 6,775 of 6,775 failures (100%) and Tap on 141 of 141 (100%), '
              'while UPG wrote one on 25 of 546,013 (0.0%) and Tamara on 0 of 563. The app stores '
              'whatever the vendor returns; two vendors return it and two do not. That is why the 20 '
              'August catalog had to query UPG directly to classify anything.', BODY),
          Paragraph(
              'This is worth raising with UPG as an integration item. Until it changes, no amount of '
              'app-side analysis will explain 98.7% of failures, and every future request like this '
              'one will need a gateway pass.', NOTE),
          img('families'), Spacer(1, 6)]

kind = dict(ORDER)
rows = [[Paragraph(c, THW) for c in ['Failure family', 'Payments', 'Share', 'Reading']]]
READ = {
 'Abandoned — never engaged': 'Payment record created, customer never engaged the payment page. '
                              'Customer-side, and the largest block in the dataset by far.',
 'No acquirer message (UPG)': 'Reached a gateway and failed, but the vendor returned no readable '
                              'message. Not a cause — a gap in what we are told.',
 'Card / bank decline': 'Insufficient funds, wrong CVV, expired card, issuer refusal. '
                        'Customer- or bank-side.',
 'Authentication / 3DS': 'Authentication cancelled, abandoned or rejected. Mostly customer-side; a '
                         'small technical tail in the 3DS stack.',
 'Acquirer configuration': 'Format errors, invalid configuration, transaction type not supported. '
                           'OUR side or the acquirer\'s — willing payers turned away.',
 'Timeout / gateway technical': 'Risk timeouts, acquirer down, gateway errors. Platform-side.',
 'Stuck after gateway answer': 'The gateway answered but our record was never finalised — money may '
                               'have moved. The genuine technical bucket.',
 'Cancelled by user': 'Explicitly cancelled at the payment page.',
 'Unspecified failure': 'Vendor said only "failed".',
 'Other / unclassified': 'Did not match any family rule.'}
for f in FAMS:
    rows.append([Paragraph(f, TD), Paragraph(k(FAM_TOT[f]), TDR),
                 Paragraph(pc(FAM_TOT[f], FAM_UNIV), TDR), Paragraph(READ[f], TD)])
story += [mtable(rows, [40*mm, 20*mm, 15*mm, 100*mm]), Spacer(1, 7)]

_cfg = FAM_TOT['Acquirer configuration']
story += [Paragraph(
    f'<b>Among failures we can actually read, acquirer configuration is the single largest family</b> '
    f'— {k(_cfg)} of {k(WITH_MSG)} reasoned failures ({pc(_cfg, WITH_MSG)}), ahead of card declines. '
    f'It is dominated by one message, "transaction declined (format error)" (2,994), with '
    f'"invalid configuration data" (185) and "Transaction Type not Supported" (18) behind it. This is '
    f'the same class of finding as the MADA configuration issue in the shared analysis: willing '
    f'payers turned away by configuration rather than by their bank. It is the most actionable thing '
    f'in this report — but it is measured on the instrumented 1.3%, so treat it as a lead to '
    f'investigate at the gateway, not as a sized problem.', BODY)]

rows = [[Paragraph(c, THW) for c in ['Month'] + [g for g, _ in GROUPS] + ['Total']]]
for m in months:
    c = FAM_MON[m]
    rows.append([Paragraph(ml(m), TD)] + [Paragraph(k(grp(c, ks)), TDR) for _, ks in GROUPS] +
                [Paragraph(k(sum(c.values())), TDR)])
rows.append([Paragraph('<b>12-month</b>', TD)] +
            [Paragraph('<b>' + k(grp(FAM_TOT, ks)) + '</b>', TDR) for _, ks in GROUPS] +
            [Paragraph('<b>' + k(FAM_UNIV) + '</b>', TDR)])
tb = mtable(rows, [17*mm, 26*mm, 24*mm, 20*mm, 20*mm, 18*mm, 21*mm, 15*mm, 24*mm])
tb.setStyle(TableStyle([('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E8F1EC'))]))
story += [KeepTogether([Paragraph('All journeys — failure category by month', SUBH), tb]), Spacer(1, 8)]

story += [PageBreak(),
          Paragraph('4d · Reason by card rail — the instrumented subset only', SUBH),
          Paragraph(
              f'The shared analysis broke reasons down by rail (CARD / APPLE_PAY / STC_PAY). That is '
              f'reproducible here only for HyperPay and Tap, and only for the '
              f'{k(sum(INSTR.values()))} failures they reported — because card_type is real for those '
              f'vendors and hardcoded for UPG. Verified: on HyperPay rows card_type reads STC Pay '
              f'42.3%, mada 26.9%, Credit card 18.9%, Apple Pay 11.6%; on UPG rows it reads '
              f'"Credit card" 99.3%. The first is a rail; the second is a default.', BODY),
          img('instrumented'), Spacer(1, 6),
          Paragraph(
              f'<b>The single largest bar is a configuration message on a wallet rail:</b> '
              f'"transaction declined (format error)" on STC Pay, {k(INSTR[("transaction declined (format error)", "STC Pay")])} '
              f'failures — more than every card decline in this subset combined. Format errors also '
              f'appear on mada ({k(INSTR[("transaction declined (format error)", "mada")])}) and card '
              f'({k(INSTR[("transaction declined (format error)", "Credit card")])}). This is the same '
              f'shape as the MADA "Transaction Type not Supported" finding in the shared analysis: a '
              f'rail-specific configuration fault turning away payers who were willing and able. It is '
              f'the most concrete lead in this report and it is worth putting to HyperPay directly.', BODY),
          Paragraph(
              'Read the rest as the shape of a small, well-instrumented corner — not as the shape of '
              'Salam\'s payment failures. It cannot be scaled up: the vendors that report are not a '
              'random sample of the vendors that do not.', NOTE)]

# ---- 5 method
story += [PageBreak(), Paragraph('5 · Method, coverage and known gaps', H2)]
meth = [
    ('Period', 'Sep 2025 – Aug 2026, 12 complete months. <b>Not the 20 months requested.</b> The '
               'payments table starts 2025-02-14 and then contains no rows at all for March–August '
               '2025 before resuming complete in September. onboarding_orders (from 2022-01) and '
               'checkouts (from 2022-06) have no such gap, so this is specific to payments and is '
               'most likely the archival job — the table carries archived / archived_at columns. '
               'If those six months can be restored, the same extract covers them with a date change.'),
    ('Source', 'Production replica, read-only. One aggregated pass per month, index-driven, '
               'throttled between months. No row-level extract of 5.4M rows, and no query in this '
               'pipeline reached the live database.'),
    ('Journey mapping', '① OnboardingOrder + number_order_type=0 · ② OnboardingOrder + '
                        'number_order_type=1 · ③ recharge + postpaid_service_recharge · '
                        '④ bill + advanced_postpaid_payment · ⑤ Checkout. Only 23 payments in 5.2M '
                        'could not be resolved to New SIM or MNP.'),
    ('never_attempted', 'Pending with no gateway answer — the payment page was never reached or '
                        'never finished. A funnel gap, not a failure. Counting it as an error '
                        'overstates the failure rate roughly fourfold.'),
    ('stuck_callback', 'Pending, but the gateway did answer — money may have been taken while our '
                       'record was never finalised. This is the genuine technical bucket.'),
    ('Card rail', 'Not charted at 12-month scale, and the reason is narrower than first stated: '
                  'card_type is hardcoded on UPG rows (99.3% "Credit card") but genuinely varies on '
                  'HyperPay rows (STC Pay 42.3% · mada 26.9% · card 18.9% · Apple Pay 11.6%) and Tap. '
                  'So the rail is reported for the instrumented subset in 4d and withheld everywhere '
                  'else. The 20 Aug gateway-derived catalog found 4,369 Apple Pay failures in 19 '
                  'days against card_type\'s 801 across 12 months — that gap is UPG traffic, which '
                  'is exactly where the column is a default rather than a fact.'),
    ('Refunds', 'refunded (21,165 payments) is a fifth outcome, excluded from the failure families '
                'in 2c / 3c / 4c: a refund is a completed payment reversed later, not a payment that '
                'failed. It is the entire difference between the family universe (2,558,790) and '
                '(total − success).'),
    ('August 2026', 'Partial month. The identity tables were extracted minutes after the main '
                    'tables, so August differs between them by 193 payments out of 213,000 (0.09%). '
                    'Every other month reconciles exactly. Month-on-month analysis should end at July.'),
]
story += [table([[Paragraph(f'<b>{a}</b>', ParagraphStyle('m', parent=BODY, fontSize=8, leading=10.5, spaceAfter=0)),
                  Paragraph(b, ParagraphStyle('m2', parent=BODY, fontSize=8, leading=10.5, spaceAfter=0))]
                 for a, b in meth], [36*mm, 139*mm], header=False)]
story += [Spacer(1, 8),
          Paragraph('Companion workbook: Salam-Payment-Errors-Sep2025-Aug2026.xlsx — 13 sheets with '
                    'the per-month tables behind every figure here, including the full reason list '
                    'and the vendor and platform cuts. Reproducible on demand from the Digital Console.', CAP)]


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 7); canvas.setFillColor(colors.HexColor(GREY))
    canvas.drawString(18 * mm, 12 * mm, 'Salam · Digital Operations · payment errors, Sep 2025 – Aug 2026')
    canvas.drawRightString(A4[0] - 18 * mm, 12 * mm, str(doc.page))
    canvas.restoreState()


doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=18*mm, rightMargin=17*mm,
                        topMargin=15*mm, bottomMargin=18*mm,
                        title='Salam — Payment Errors, Sep 2025 – Aug 2026',
                        author='Yosri A Yahmed · Digital Operations')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(f'✓ {OUT}')
