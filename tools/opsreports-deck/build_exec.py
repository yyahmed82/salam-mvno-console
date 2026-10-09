#!/usr/bin/env python3
"""build_exec.py — the *Enterprise Platforms & Operations · Weekly Executive Report* from the Salam template.

    python3 build_exec.py exec-content.json template-exec.pptx out.pptx

The template has five slides: cover · executive brief · executive areas table · focus for next week · thank you.
Only their text is replaced (every run keeps the template's font, size and colour). The content JSON:
  { "cover_sub": "Weekly Executive Report · 27 Sep – 3 Oct 2026",
    "brief_title": "...", "brief": "...", "headlines": ["...", ...],
    "rows": [["Executive Area", "Weekly Outcome", "Leadership Attention"], ...  (6 rows)],
    "focus": ["...", ...] }
"""
import json
import re
import sys
import zipfile


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def main(content_path, tpl_path, out_path):
    c = json.load(open(content_path))
    zin = zipfile.ZipFile(tpl_path)
    files = {n: zin.read(n) for n in zin.namelist()}
    S = lambda n: files['ppt/slides/slide%d.xml' % n].decode('utf8')
    put = lambda n, x: files.__setitem__('ppt/slides/slide%d.xml' % n, x.encode('utf8'))

    # 1 · cover
    x = S(1).replace('<a:t>Weekly Executive Report</a:t>', '<a:t>%s</a:t>' % esc(c['cover_sub']), 1)
    put(1, x)

    # 2 · executive brief (+ headline lines in the same text box, same white 14 pt runs)
    x = S(2)
    x = re.sub(r'<a:t>Executive Weekly Brief \|[^<]*</a:t>', '<a:t>%s</a:t>' % esc(c['brief_title']), x, count=1)
    x = re.sub(r'<a:t>Operations remained under control\.[^<]*</a:t>', '<a:t>%s</a:t>' % esc(c['brief']), x, count=1)
    run = '<a:r><a:rPr lang="en-US" sz="1400" dirty="0"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:rPr><a:t>%s</a:t></a:r>'
    extra = '<a:p><a:endParaRPr lang="en-US" sz="1000" dirty="0"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:endParaRPr></a:p>'
    for h in c.get('headlines', []):
        extra += '<a:p><a:spcBef><a:spcPts val="300"/></a:spcBef>' + (run % esc(h)) + '</a:p>'
    extra = extra.replace('<a:p><a:spcBef><a:spcPts val="300"/></a:spcBef>', '<a:p><a:pPr><a:spcBef><a:spcPts val="300"/></a:spcBef></a:pPr>')
    i = x.find(esc(c['brief']))
    j = x.find('</a:p>', i) + len('</a:p>')
    put(2, x[:j] + extra + x[j:])

    # 3 · executive areas table — the 6 template rows, 3 cells each, replaced in order
    x = S(3)
    rows = c['rows']
    trs = re.findall(r'<a:tr\b.*?</a:tr>', x, re.S)
    body = trs[1:]
    for k, tr in enumerate(body):
        if k >= len(rows):
            x = x.replace(tr, '', 1)
            continue
        cells = rows[k]
        it = iter(cells)
        new = re.sub(r'(<a:tc>.*?<a:t>)[^<]*(</a:t>)', lambda m: m.group(1) + esc(next(it, '')) + m.group(2), tr, flags=re.S)
        x = x.replace(tr, new, 1)
    put(3, x)

    # 4 · focus for next week — one bullet paragraph per item, template paragraph style
    x = S(4)
    paras = re.findall(r'<a:p><a:r><a:rPr lang="en-US" sz="1400"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:rPr><a:t>• [^<]*</a:t></a:r></a:p>', x)
    tpl = paras[0]
    new = ''.join(re.sub(r'<a:t>• [^<]*</a:t>', '<a:t>• %s</a:t>' % esc(f), tpl) for f in c['focus'])
    start = x.find(paras[0]); end = x.find(paras[-1]) + len(paras[-1])
    put(4, x[:start] + new + x[end:])

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in zin.namelist():
            z.writestr(n, files[n])
    print('→', out_path)


if __name__ == '__main__':
    main(*sys.argv[1:4])
