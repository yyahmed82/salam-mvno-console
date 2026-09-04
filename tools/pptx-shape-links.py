#!/usr/bin/env python3
"""Make a pptxgenjs 'button' clickable across its WHOLE shape, not just its letters.

    python3 tools/pptx-shape-links.py <file.pptx>

WHY THIS EXISTS
pptxgenjs attaches a hyperlink to TEXT RUNS. On a pill-shaped button that means only the glyphs are
clickable — on a projector, at speed, that is a button that mostly does not work.

Its shape-level option is worse: passing `hyperlink` in the top-level options of an addText that
carries `shape:` emits

    <p:cNvPr id="11" name="Text 9"><a:hlinkClick r:id="rIdundefined"/></p:cNvPr>

— a relationship id that was never registered. That is invalid OOXML: PowerPoint opens the file
with "Repaired" in the title bar and silently strips EVERY hyperlink in the deck. The buttons then
look perfect and do nothing, which is the worst of the three outcomes.

WHAT THIS DOES
For each shape that already contains a valid run-level <a:hlinkClick r:id="rIdN">, it copies that
same rIdN onto the shape's own <p:cNvPr>. The relationship already exists and is already correct,
so nothing new has to be registered and nothing can dangle. Result: the entire pill is a click
target, the text link still works, and the XML stays valid.

Safe to re-run — a shape that already has a shape-level link is skipped.
"""
import re, shutil, sys, zipfile, os

SLIDE = re.compile(r'ppt/slides/slide\d+\.xml$')
SP = re.compile(r'<p:sp>.*?</p:sp>', re.S)
RUN_LINK = re.compile(r'<a:hlinkClick[^>]*r:id="(rId\d+)"')
CNVPR_OPEN = re.compile(r'(<p:cNvPr\b[^>]*?)(/>|>)')


def patch_shape(sp):
    """Copy the run-level hyperlink target onto the shape itself."""
    if '<p:cNvPr' not in sp:
        return sp, False
    head = sp.split('</p:nvSpPr>')[0]
    if 'hlinkClick' in head:            # already shape-linked — leave it alone
        return sp, False
    m = RUN_LINK.search(sp)
    if not m:
        return sp, False
    rid = m.group(1)
    link = f'<a:hlinkClick xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="{rid}"/>'

    def repl(mm):
        attrs, close = mm.group(1), mm.group(2)
        # <p:cNvPr .../>  ->  <p:cNvPr ...>link</p:cNvPr>   ·   <p:cNvPr ...>  ->  inject after
        return f'{attrs}>{link}</p:cNvPr>' if close == '/>' else f'{attrs}>{link}'

    return CNVPR_OPEN.sub(repl, sp, count=1), True


def main(path):
    tmp = path + '.tmp'
    n_shapes = 0
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if SLIDE.match(item.filename):
                xml = data.decode('utf-8')
                out, count = [], 0
                last = 0
                for m in SP.finditer(xml):
                    new, done = patch_shape(m.group(0))
                    if done:
                        count += 1
                        out.append(xml[last:m.start()]); out.append(new); last = m.end()
                if count:
                    out.append(xml[last:])
                    xml = ''.join(out)
                    n_shapes += count
                data = xml.encode('utf-8')
            zout.writestr(item, data)
    shutil.move(tmp, path)
    print(f'✓ {os.path.basename(path)} — {n_shapes} shapes made fully clickable')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else sys.exit('usage: pptx-shape-links.py <file.pptx>'))
