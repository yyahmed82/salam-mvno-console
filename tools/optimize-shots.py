#!/usr/bin/env python3
"""Shrink deck screenshots so the .pptx fits an email attachment limit.

WHY: 41 full-size PNG screenshots make a 21 MB deck. Outlook here rejects >20 MB.

WHAT IT DOES: writes a .jpg beside every .png — downscaled to 1700 px wide and saved at
quality 85 with NO chroma subsampling (4:4:4). The build scripts prefer the .jpg when it
exists, so nothing else changes.

WHY THESE SETTINGS:
  1700 px  — the widest a screenshot is ever placed is 8.5 in, so 1700 px = 200 DPI. Above
             that the extra pixels are thrown away by PowerPoint anyway.
  q85      — visually lossless on flat UI colour at this scale.
  4:4:4    — the default 4:2:0 subsampling smears coloured text (red error counts, green
             status chips) into a halo. Keeping full chroma costs ~8% size and fixes it.

Palette-quantised PNG lands at a similar size but dithers the gradients in the dark modals
and the gauge rings, so JPEG wins here.

Usage:  python3 tools/optimize-shots.py <dir> [<dir> ...]
        (re-run after adding screenshots; existing .jpg files are overwritten)
"""
import sys, os, glob
from PIL import Image

MAX_W = 1700
QUALITY = 85

def run(d):
    files = sorted(glob.glob(os.path.join(d, '*.png')))
    if not files:
        print(f'{d}: no PNGs'); return
    before = after = 0
    for f in files:
        im = Image.open(f).convert('RGB')
        w, h = im.size
        if w > MAX_W:
            im = im.resize((MAX_W, round(h * MAX_W / w)), Image.LANCZOS)
        out = os.path.splitext(f)[0] + '.jpg'
        im.save(out, quality=QUALITY, optimize=True, subsampling=0)
        before += os.path.getsize(f); after += os.path.getsize(out)
    mb = lambda b: f'{b / 1048576:.1f} MB'
    print(f'{d}: {len(files)} images  {mb(before)} -> {mb(after)}  '
          f'({100 - after * 100 // before}% smaller)')

if __name__ == '__main__':
    dirs = sys.argv[1:] or ['.']
    for d in dirs:
        run(d)
