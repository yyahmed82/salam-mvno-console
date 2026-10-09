# Weekly operations decks (Salam templates)

> Since alpha.157 the console builds both decks by itself (`server/src/opsDeck.js` · `opsReportsDecks.js`, template `server/templates/opsreports-deck-template.pptx`) as soon as every team is in — Operations reports › This week › Weekly decks. These Python scripts stay for a one-off build outside the console.

Two decks per reporting week (Sun → Sat), in the Salam templates ITSM uses:

| Deck | Builder | Input |
|---|---|---|
| **Operational Weekly Executive Report** (5 slides) | `build_exec.py` | `exec-content.json` (brief, headline lines, the 6 executive areas, focus for next week) |
| **Application Operational weekly status report** (complete, ~210 slides) | `build_complete.py` | `manifest.json` (vendor files per domain, which slides) |

```bash
cd "Claude outputs/opsreports-week-2026-09-27/inputs"
python3 ../../../tools/opsreports-deck/build_exec.py exec-content.json salam-exec-template.pptx ../Operational_Weekly_Executive_Report.pptx
python3 ../../../tools/opsreports-deck/build_complete.py manifest.json ../Application_Operational_weekly_status_report.pptx
```

## How the complete deck is made

- **Cover:** the date is replaced, then the "Enterprise Platforms Operations Domains" slide follows.
- **Each domain:** a divider slide, then the vendor's own slides (`"slides": "2-16"`).
- **Vendor slides** are copied the way PowerPoint's *Use destination theme* paste copies them:
  - each slide keeps its own arrangement, charts, tables and pictures;
  - each slide takes the Salam theme and the leaf logo (master 1).
- **Speaker notes and comments** are not carried over.
- **PDF sources** (a report that only exists as a mail or a PDF) go in page by page as pictures. This needs `pdftoppm` (`brew install poppler`).
- **Sections:** every domain becomes a PowerPoint section.

Only the Python standard library is used. Check a deck with the pptx skill's `validate.py`.
