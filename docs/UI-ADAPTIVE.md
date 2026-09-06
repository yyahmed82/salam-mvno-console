# UI foundations — tokens, dark mode, adaptive shell (6 Sep 2026)

## Tokens (index.html `:root` / `[data-theme="dark"]`)
Surfaces `--bg --card --card2 --line --line-soft` · text `--ink --ink-soft --muted` · brand `--green --violet --blue …` ·
tint boxes `--tint-{green,blue,amber,red,violet}` + `-fg` · lines `--green-line --amber-line --red-line --blue-line --indigo-line` ·
semantic text `--good --warn-fg --bad-fg` · inverted chip `--solid / --solid-fg` · tooltip `--tip-bg / --tip-fg` ·
overlays `--overlay --scrim` · code panes `--panel-dark / --panel-dark-fg` · aliases `--panel --panel2 --fg` · layout `--hdr --safe-b --safe-t`.

Rules: never hard-code a light hex in a module (`#fff`, `#f8fafc`, `#fee2e2`, `#64748b`…) — use the token. Never use `var(--ink)` as a
background (it is near-white in dark mode) — use `var(--solid)`. Colours that get an alpha suffix (`${col}22`) must stay hex.
SVG presentation attributes accept `fill="var(--x)"`.

## Base controls
`:where(input,select,textarea)` and `:where(button:not([class]))` carry a themed baseline at zero specificity — any class rule wins, but nothing
renders browser-default. Custom select arrow, dark pickers, themed scrollbars.

## Adaptive shell (`adaptive.js` + "ADAPTIVE UI LAYER" CSS)
| width | shell |
|---|---|
| > 1140 | nav in the header (needs ~1125 px) |
| ≤ 1140 | burger → slide-in drawer (`header>nav`), scrim (`body.nav-open`), Esc / hashchange close |
| ≤ 700 | bottom tab bar `#appTabs` (mirrors nav visibility incl. business scope), compact header, bottom-sheet modals (z 1300), full-screen drawers / Yusr, 2-up KPI tiles |
| ≤ 420 | KPI grids stay 2-up, tab labels shrink |

Runtime helpers (run after every DOM change, debounced): `fitGrids()` stacks inline `grid-template-columns` only when a column would be
< 150 px (`.g-stack` / `.g-two`; `data-nofit` opts out); `wrapTables()` wraps overflowing tables in `.tscroll`.
Module CSS breakpoints for class grids live in the same index.html block (`#fxErr .fe-grid`, `.fxc-*`, `.ld-*`, `.t2-doc2`, `.td-wrap`).
Sticky in-page bars use `top:var(--hdr)`; page wrappers use `padding:0 var(--fx-pad,18px)` (`--fx-pad:0` on phones).
