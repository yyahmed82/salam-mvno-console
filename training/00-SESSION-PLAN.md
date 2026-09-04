# Salam Digital Console — Workshop Session Plan
**20 modules · 4 sessions · ~10 hours total** — but sessions are *containers, not calendars*.
Run one session per sitting, or merge two if the room is fast. Every module is self-contained.

---

## Choose your shape

| Shape | Sittings | Fits |
|---|---|---|
| **Standard** | 4 × 2.5h | The default. One session per sitting, a few days apart. |
| **Intensive** | 2 × 5h | Sessions 1+2 one day, 3+4 the next. Needs a long break mid-day. |
| **Drip** | 8 × 75min | One half-session per week. Best retention, slowest rollout. |
| **Role-split** | 2 shared + 2 split | Everyone does Sessions 1–2. L1s stop; L2/L3 continue to 3–4. |

---

## Module index

| # | Module | Mins | Lab | Poll | Who most needs it |
|---|---|---|---|---|---|
| **SESSION 1 — Foundations** | | | | | |
| M1 | Why this exists — four blind spots | 20 | | | everyone |
| M2 | Architecture & the data pipeline | 15 | | | everyone |
| M3 | Access, roles & PII | 20 | LAB 1, 2 | | everyone |
| M4 | Dashboard anatomy | 20 | LAB 3 | | everyone |
| M5 | Order status flow | 15 | LAB 4 | POLL 1 | everyone |
| **SESSION 2 — Troubleshooting** | | | | | |
| M6 | Troubleshoot & the 10 categories | 20 | LAB 5 | | L1, L2 |
| M7 | Payment forensics — failed / stuck / abandoned | 25 | LAB 6 | | **L1 critical** |
| M8 | The failover trap (INC0014859) | 20 | | | L2 |
| M9 | Timeline & Subscriber 360 | 15 | LAB 7 | | L1 |
| M10 | BSS read-path faults (OSB 1500) | 15 | | POLL 2 | L1 BSS, L2 BSS |
| **SESSION 3 — Alerting & response** | | | | | |
| M11 | Alerts, metrics & the golden rule | 20 | | | everyone |
| M12 | Correlation & suppression | 15 | | | L2 |
| M13 | Escalation & guided response | 20 | LAB 8 | | L1, L2 |
| M14 | SLA targets & error budget | 15 | | | leads |
| M15 | Anomaly detection | 15 | | POLL 3 | L2, L3 |
| **SESSION 4 — Depth & ownership** | | | | | |
| M16 | Analytics & building panels | 25 | LAB 9 | | leads, L2 |
| M17 | Growth & attribution traps | 20 | | | leads |
| M18 | Rule tuning discipline | 20 | LAB 10 | | L2, L3 |
| M19 | Yusr AI assistant | 15 | | | everyone |
| M20 | Platform internals & handover | 20 | | POLL 4 | L3 |

**If you only have one hour with someone:** M1 → M7 → M13. That's why it exists, the idea that
saves customers money, and what to do when it pages you.

---

## Running the competitive quizzes

Two ways — use both.

### In-deck polls (no setup)
Each poll is **two slides**: the question, then the reveal. Show the question, everyone answers
(fingers A/B/C/D on a count of three, or via the app), *then* advance. Never reveal before they commit —
a guess they've committed to is what makes the correction stick.

### Kahoot / Slido (scored, competitive)
`Salam-Console-Quiz-Kahoot.xlsx` — 4 rounds × 6 questions, pre-validated against Kahoot's import rules
(question ≤120 chars, answers ≤75, legal time limits).

**Kahoot:** Create → Import spreadsheet → upload one sheet per round.
**Slido / Mentimeter / MS Forms:** same content, paste per question.

Run one round at the end of each session and keep a **running leaderboard across all four**. The
competition is the point: people argue about answers, and arguing is when they learn.

> **Facilitator rule:** after every question — right or wrong — ask *"why?"*. A right answer for the
> wrong reason is a wrong answer that hasn't failed yet.

---

## Per-session prep (2 minutes, every time)

```bash
ssh yosri@172.31.38.152 && sudo su -
cd /apps/console/server && set -a; . ../.env; set +a
node sync-watchdog.cjs          # data fresh? exit=0 wanted
node healthcheck.cjs | tail -20 # indexes, timings, cache
```

Then pull today's live examples for the labs — the script is in
`01-FACILITATOR-GUIDE.md` → *"finding today's examples"*. **Scenarios die if the example returns
"not found".**

---

## Materials

| File | Use |
|---|---|
| `Salam-Console-Workshop.pptx` | **The deck** — 39 slides, diagram-heavy, polls built in |
| `Salam-Console-Quiz-Kahoot.xlsx` | Import into Kahoot/Slido for the scored rounds |
| `00-SESSION-PLAN.md` | This file |
| `01-FACILITATOR-GUIDE.md` | What to say, prep script, recovery when demos break |
| `02-LAB-GUIDE.md` | Every lab, step by step, hand to attendees |
| `03-SCENARIOS.md` | The five scenarios + **L1 cheat-sheet (Appendix A — print it)** |
| `04-QUIZZES.md` | Written quizzes + full answer keys with explanations |
| `05-USER-SETUP-RUNBOOK.md` | Account creation & verification (do this in Session 1) |
| `06-TEAMS-AND-CERTIFICATES.md` | **Teams setup before Session 1 · certificate issue after the last one** |
| `workshop.config.json` | **All links, signatories and certificate thresholds — edit here, not in the slides** |
| `attendees.csv` | The roster the certificates are built from |
| `build_workshop.py` · `deckkit.py` | Rebuild the deck; drop screenshots into `shots/` |
| `build_quiz_import.py` | Rebuild the quiz spreadsheet |
| `build_certificates.py` | Generate certificates + the verification register |

---

## Certificates

Two grades, decided from the register — not handed out for turning up:

| Grade | Requires |
|---|---|
| **Certificate of Completion** | all 4 sessions **and** quiz ≥ 70% |
| **Certificate of Attendance** | at least 3 sessions |

Each certificate carries a unique ID recorded in `certificates/register.csv`, so a claim can be
checked rather than believed. Full process in `06-TEAMS-AND-CERTIFICATES.md`.

---

## What "done" looks like

| Outcome | How you know |
|---|---|
| Everyone has access at the right role | The verification table in `05-USER-SETUP-RUNBOOK.md` §3 is fully ticked |
| L1 can triage a payment case alone | They complete Scenario A unaided and use the cheat-sheet wording |
| L1/L2 can run an incident | They complete Scenario D and the handover names rule + numbers + checks |
| L2/L3 can change the system | They tune a rule (Scenario E) and can say what it still catches |
| The team owns it | Three things agreed in the room: who checks daily · where feedback goes · when rules get reviewed |
