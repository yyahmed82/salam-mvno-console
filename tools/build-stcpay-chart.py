#!/usr/bin/env python3
"""STC Pay chart for the removal request — two panels, one story, nothing else.

  # paste the CHART-JSON line from `node src/stcPayFigures.js` into a file, then:
  python3 tools/build-stcpay-chart.py stcpay.json "STC-Pay-monthly.png"

PANEL 1 (bars)  share of all payments carried by STC Pay, per month
PANEL 2 (lines) STC Pay success rate per month, with all-other-rails as the reference line

Design rule: the y-axis of panel 2 starts at a floor computed from the data, never at 0 — a
success-rate chart pinned to 0 flattens every real movement into a straight line. The floor is
printed on the axis so nobody can mistake it for a zero-based chart."""
import json, sys, os

PUR='#5b2d8e'; GREY='#94a3b8'; DARK='#0b3b2e'; INK='#11241d'; MUTED='#5f6f69'
LINE='#dde7e1'; GREEN='#0e9f5a'; RED='#b3261e'

def build(rows, out):
    rows = [r for r in rows if r.get('stc')]
    if not rows: sys.exit('no STC Pay rows in the JSON')
    W,H = 1180, 620
    s=[f'<rect width="{W}" height="{H}" fill="#ffffff"/>']
    tot_stc=sum(r['stc'] for r in rows); tot_all=sum(r['all'] for r in rows)
    s.append(f'<text x="34" y="40" font-size="21" font-weight="700" fill="{DARK}" font-family="Helvetica">'
             f'STC Pay - share of payments and success rate, {rows[0]["mo"]} to {rows[-1]["mo"]}</text>')
    s.append(f'<text x="34" y="63" font-size="13" fill="{MUTED}" font-family="Helvetica">'
             f'Salam payment records | STC Pay carried {tot_stc:,} of {tot_all:,} payments '
             f'({100*tot_stc/tot_all:.1f}%) over the period. Success = of attempted payments.</text>')

    # ---------- panel 1: share bars ----------
    px,py,pw,ph = 40, 100, W-80, 190
    s.append(f'<text x="{px}" y="{py-8}" font-size="13" font-weight="700" fill="{DARK}" font-family="Helvetica">'
             f'① SHARE OF ALL PAYMENTS CARRIED BY STC PAY (%)</text>')
    mx=max(r['share'] for r in rows)*1.25 or 1
    bw=pw/len(rows)
    for i,r in enumerate(rows):
        h=ph*r['share']/mx
        x=px+i*bw+bw*0.18; w=bw*0.64
        s.append(f'<rect x="{x:.1f}" y="{py+ph-h:.1f}" width="{w:.1f}" height="{h:.1f}" rx="3" fill="{PUR}"/>')
        s.append(f'<text x="{x+w/2:.1f}" y="{py+ph-h-7:.1f}" font-size="11.5" font-weight="700" fill="{PUR}" '
                 f'text-anchor="middle" font-family="Helvetica">{r["share"]:.1f}%</text>')
        s.append(f'<text x="{x+w/2:.1f}" y="{py+ph+16:.1f}" font-size="10.5" fill="{MUTED}" '
                 f'text-anchor="middle" font-family="Helvetica">{r["mo"][2:]}</text>')
        s.append(f'<text x="{x+w/2:.1f}" y="{py+ph+30:.1f}" font-size="9.5" fill="#b6bfbb" '
                 f'text-anchor="middle" font-family="Helvetica">{r["stc"]:,}</text>')
    s.append(f'<line x1="{px}" y1="{py+ph}" x2="{px+pw}" y2="{py+ph}" stroke="{LINE}" stroke-width="1.5"/>')

    # ---------- panel 2: success lines ----------
    qy, qh = 380, 170
    vals=[r['succ'] for r in rows if r['succ'] is not None]+[r['other_succ'] for r in rows if r.get('other_succ') is not None]
    lo=max(0, min(vals)-4); hi=min(100, max(vals)+2)
    if hi-lo < 6: lo, hi = max(0, lo-3), min(100, hi+3)
    s.append(f'<text x="{px}" y="{qy-8}" font-size="13" font-weight="700" fill="{DARK}" font-family="Helvetica">'
             f'② SUCCESS RATE OF ATTEMPTED PAYMENTS (%) - axis starts at {lo:.0f}%, not 0, to make movement visible</text>')
    def Y(v): return qy+qh-(qh*(v-lo)/(hi-lo))
    for g in range(5):
        v=lo+(hi-lo)*g/4
        s.append(f'<line x1="{px}" y1="{Y(v):.1f}" x2="{px+pw}" y2="{Y(v):.1f}" stroke="{LINE}" stroke-dasharray="3 4"/>')
        s.append(f'<text x="{px-8}" y="{Y(v)+4:.1f}" font-size="10.5" fill="{MUTED}" text-anchor="end" font-family="Helvetica">{v:.0f}%</text>')
    def series(key, col, dash, label):
        pts=[(px+i*bw+bw/2, Y(r[key])) for i,r in enumerate(rows) if r.get(key) is not None]
        if len(pts)<2: return
        s.append(f'<polyline points="{" ".join(f"{a:.1f},{b:.1f}" for a,b in pts)}" fill="none" '
                 f'stroke="{col}" stroke-width="3" {dash}/>')
        for a,b in pts: s.append(f'<circle cx="{a:.1f}" cy="{b:.1f}" r="4" fill="{col}"/>')
    series('other_succ', GREY, 'stroke-dasharray="6 5"', 'other')
    series('succ', PUR, '', 'stc')
    for i,r in enumerate(rows):
        if r.get('succ') is None: continue
        s.append(f'<text x="{px+i*bw+bw/2:.1f}" y="{Y(r["succ"])-11:.1f}" font-size="10.5" font-weight="700" '
                 f'fill="{PUR}" text-anchor="middle" font-family="Helvetica">{r["succ"]:.1f}</text>')
        s.append(f'<text x="{px+i*bw+bw/2:.1f}" y="{qy+qh+16:.1f}" font-size="10.5" fill="{MUTED}" '
                 f'text-anchor="middle" font-family="Helvetica">{r["mo"][2:]}</text>')
    s.append(f'<line x1="{px}" y1="{qy+qh}" x2="{px+pw}" y2="{qy+qh}" stroke="{LINE}" stroke-width="1.5"/>')
    ly=qy+qh+42
    s.append(f'<rect x="{px}" y="{ly}" width="14" height="4" rx="2" fill="{PUR}"/>')
    s.append(f'<text x="{px+22}" y="{ly+6}" font-size="12.5" fill="{INK}" font-family="Helvetica">STC Pay</text>')
    s.append(f'<rect x="{px+110}" y="{ly}" width="14" height="4" rx="2" fill="{GREY}"/>')
    s.append(f'<text x="{px+132}" y="{ly+6}" font-size="12.5" fill="{MUTED}" font-family="Helvetica">All other rails (card, mada, ...)</text>')
    first=next((r['succ'] for r in rows if r.get('succ') is not None), None)
    last=next((r['succ'] for r in reversed(rows) if r.get('succ') is not None), None)
    if first is not None and last is not None:
        d=last-first; col=RED if d<-0.5 else (GREEN if d>0.5 else MUTED)
        word='down' if d<-0.5 else ('up' if d>0.5 else 'flat')
        s.append(f'<text x="{px+pw}" y="{ly+6}" font-size="12.5" font-weight="700" fill="{col}" '
                 f'text-anchor="end" font-family="Helvetica">{rows[0]["mo"][2:]} {first:.1f}% -> {rows[-1]["mo"][2:]} {last:.1f}%  ({word} {abs(d):.1f} pts)</text>')
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{"".join(s)}</svg>'
    try:
        import cairosvg; cairosvg.svg2png(bytestring=svg.encode(), write_to=out, output_width=W*2, output_height=H*2)
    except ImportError:
        out=os.path.splitext(out)[0]+'.svg'; open(out,'w').write(svg)
    print('wrote', out)

if __name__ == '__main__':
    src=sys.argv[1] if len(sys.argv)>1 else 'stcpay.json'
    out=sys.argv[2] if len(sys.argv)>2 else 'STC-Pay-monthly.png'
    txt=open(src).read().strip()
    i=txt.find('[');  txt=txt[i:txt.rfind(']')+1] if i>=0 else txt   # tolerate pasted surrounding text
    build(json.loads(txt), out)
