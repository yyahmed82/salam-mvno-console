#!/usr/bin/env python3
"""build_complete.py — the weekly *Enterprise Platforms & Application Operations* deck (the "complete" deck).

    python3 build_complete.py manifest.json out.pptx

The manifest names the Salam templates, the week, and per domain the vendor files and which of their slides go in
(1-based, inclusive ranges "2-7", lists "2,4,9-12", or "all"). A PDF source (a report that only exists as a mail or a PDF)
is placed page by page as full-slide pictures — needs `pdftoppm` (poppler: `brew install poppler` on a Mac).

Layout of the deck, as in the 25 Sep 2026 template:
  cover (date) · Enterprise Platforms Operations Domains · per domain a divider slide then the vendor's own slides on the
  Salam master · Thank you. Every domain is a PowerPoint section, so the deck opens with a navigable outline.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pptxmerge import Merger, Pkg  # noqa: E402

SLIDE_W, SLIDE_H = 12192000, 6858000


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def pick(spec, n):
    if spec in (None, 'all'):
        return list(range(1, n + 1))
    out = []
    for part in str(spec).split(','):
        part = part.strip()
        if '-' in part:
            a, b = part.split('-')
            out += list(range(int(a), min(int(b), n) + 1))
        elif part:
            out.append(int(part))
    return [i for i in out if 1 <= i <= n]


def png_size(data):
    return int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')


def pdf_pages(path, pages):
    tmp = tempfile.mkdtemp()
    args = ['pdftoppm', '-png', '-r', '110']
    if pages and pages != 'all':
        nums = pick(pages, 9999)
        args += ['-f', str(min(nums)), '-l', str(max(nums))]
    subprocess.run(args + [path, os.path.join(tmp, 'p')], check=True)
    files = sorted(os.listdir(tmp), key=lambda f: int(re.findall(r'(\d+)\.png$', f)[0]))
    return [open(os.path.join(tmp, f), 'rb').read() for f in files]


def picture_slide(data, name):
    w, h = png_size(data)
    margin = 180000
    scale = min((SLIDE_W - 2 * margin) / w, (SLIDE_H - 2 * margin - 300000) / h)
    cx, cy = int(w * scale), int(h * scale)
    x, y = (SLIDE_W - cx) // 2, (SLIDE_H - 300000 - cy) // 2
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
            '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
            '<p:pic><p:nvPicPr><p:cNvPr id="2" name="%s" descr="%s"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
            '<p:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
            '<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
            '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>') % (esc(name), esc(name), x, y, cx, cy)


def main(manifest_path, out_path):
    m = json.load(open(manifest_path))
    base_dir = os.path.dirname(os.path.abspath(manifest_path))
    P = lambda p: p if os.path.isabs(p) else os.path.join(base_dir, p)
    M = Merger(P(m['base']))                 # the Salam exec template: masters, layouts, theme
    TPL = Pkg(P(m['template']))              # the complete-deck template: cover, domains, divider
    BASE = Pkg(P(m['base']))
    tpl_slides = M.source_slides(TPL)
    base_slides = M.source_slides(BASE)
    report = []

    # cover
    d = m['date']                            # {"day": "3", "suffix": "rd ", "rest": "Oct 2026"}
    def cover(x):
        x = x.replace('<a:t>25</a:t>', '<a:t>%s</a:t>' % esc(d['day']), 1)
        x = x.replace('<a:t>th </a:t>', '<a:t>%s</a:t>' % esc(d['suffix']), 1)
        return x.replace('<a:t>Sept 2026</a:t>', '<a:t>%s</a:t>' % esc(d['rest']), 1)
    M.add_slide(TPL, tpl_slides[0], 'Cover', reuse_layout_by_name=True, edit=cover)
    M.add_slide(TPL, tpl_slides[1], 'Cover', reuse_layout_by_name=True)
    divider = tpl_slides[2]
    title_layout = M.find_layout('Title Slide', 1)

    for dom in m['domains']:
        name = dom['name']
        section = name.replace('\n', ' – ')
        def div(x, name=name, note=dom.get('note')):
            x = x.replace('<a:t>MVNO - Legacy</a:t>', '<a:t>%s</a:t>' % '</a:t></a:r><a:br><a:rPr lang="en-US" dirty="0"/></a:br><a:r><a:t>'.join(esc(l) for l in name.split('\n')), 1)
            if note:
                x = x.replace('<a:endParaRPr lang="en-AE" sz="4400" dirty="0"/></a:p>',
                              '<a:endParaRPr lang="en-AE" sz="4400" dirty="0"/></a:p><a:p><a:r><a:rPr lang="en-US" sz="1600" b="0" dirty="0"/><a:t>%s</a:t></a:r></a:p>' % esc(note), 1)
            return x
        M.add_slide(TPL, divider, section, reuse_layout_by_name=True, edit=div)
        n_dom = 0
        for src in dom.get('sources', []):
            path = P(src['file'])
            if not os.path.exists(path):
                report.append('MISSING %s — %s' % (section, src['file']))
                continue
            if path.lower().endswith('.pdf'):
                for i, png in enumerate(pdf_pages(path, src.get('slides'))):
                    M.add_raw_slide(picture_slide(png, '%s p%d' % (os.path.basename(path), i + 1)), title_layout, {'rIdImg': (png, 'png')}, section)
                    n_dom += 1
                continue
            S = Pkg(path)
            slides = M.source_slides(S)
            for i in pick(src.get('slides'), len(slides)):
                M.add_slide(S, slides[i - 1], section)
                n_dom += 1
        report.append('%-55s %3d slides' % (section, n_dom))

    M.add_slide(BASE, base_slides[-1], 'Close', reuse_layout_by_name=True)   # Thank you!
    M.finish(out_path)
    print('\n'.join(report))
    print('→ %s · %d slides' % (out_path, len(M.order)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
