# MVNO Console — backend (metrics watcher + alert engine)

Reads the restored **selfcare prod-replica DB** (`salam_development_11`), computes
metrics per window, evaluates alert rules, and stores firing alerts in a separate
**console DB** (`mvno_console`). Serves the static console + a JSON API, and can
**replay historical data as live traffic**.

## Architecture
```
salam_development_11 (prod replica, read-only)
        │  metrics.js  (15 metrics: payment/nafath/semati/eligibility/delivery/
        │               conversion/dealer/off-hours … SQL per window)
        ▼
   sync.js  ──► metric_snapshots ──► alertRunner.js ──► alerts
                                          ▲
                                    alert_rules (17 built-in, seedRules.js)
        simulate.js advances a virtual clock across the data window
        api.js exposes /api/* and serves the console (Live Alerts tab)
```
The dump is a static snapshot, so "now" is virtual: the **simulator** steps the
clock across the historical window, so real anomalies surface as a live alert stream.

## Run with Docker (recommended)
The console reuses the same Postgres container as selfcare-backend.
```bash
# 1) selfcare db must be up (holds salam_development_11)
cd ../selfcare-backend && docker compose up -d db

# 2) create + seed the console DB and replay history once
cd ../mvno-console
docker compose -f docker-compose.console.yml run --rm console-init

# 3) start API + watcher, open the console
docker compose -f docker-compose.console.yml up console
#   → http://localhost:4600   (go to the "Live Alerts" tab)
```

## Run locally (Node)
```bash
cd server
npm install
export SOURCE_DATABASE_URL=postgres://postgres:postgres@localhost:5432/salam_development_11
export CONSOLE_DATABASE_URL=postgres://postgres:postgres@localhost:5432/mvno_console
createdb -h localhost -U postgres mvno_console     # or: node src/ensureDb.js
node src/cli.js init             # schema + seed 17 rules + 15 metrics
node src/cli.js simulate 3 56    # replay: 56 ticks × 3h ≈ last 7 days → alerts
node src/api.js                  # serve http://localhost:4600
```

## CLI
| command | does |
|---------|------|
| `node src/cli.js init [--reset]` | create schema, seed metric catalog + built-in rules |
| `node src/cli.js sync [iso]` | one metrics sync + alert eval at `iso` (default now) |
| `node src/cli.js simulate [stepH] [steps]` | replay history as live traffic |
| `node src/cli.js bounds` | print source data time range |

## API
`GET /api/health` · `GET /api/rules` · `GET /api/alerts?status=open|all` ·
`GET /api/alerts/summary` · `GET /api/metrics/latest` · `GET /api/metrics/series?key=&window=` ·
`POST /api/sync {sim_now?}` · `POST /api/simulate {stepHours,steps}` · `PATCH /api/rules/:id`

## Metrics (15) & rules (17)
Metrics in `src/metrics.js`; success/failure definitions are centralized there and
tunable. Rules in `src/seedRules.js` (P1 storms, P2 spikes/drops, P3 watch), mirroring
the Salam Ops rule set: payment failure storm/spike, ZATCA gap, activation/Semati
storms, Nafath/eligibility/plan-change/delivery spikes, conversion drop, off-hours
activity, dealer working-hours drop, abandoned surge, volume drop. Active-hours (KSA)
gating and `min_sample` guards are enforced by the runner.

## Live Alerts UI (console → "Live Alerts" tab)
- **Open alerts** — current firings, severity-sorted, with observed vs threshold.
- **History** — open + resolved alerts with first→last / resolved times.
- **Metric charts** — dependency-free SVG sparklines per metric over the sim timeline,
  with the rule threshold(s) drawn as dashed reference lines and breach points marked red.
- **Alert rules** — all rules with live enable/disable toggles (PATCH /api/rules/:id).
- Buttons: **Sync now** (one tick at real now) and **Simulate replay** (56×3h history).

## Roles, sync modes & Error Board (from the ops-console deck)
**Sync modes** (Settings tab, needs `manageSync`): **Manual** (buttons only), **Auto · Replay**
(advance a virtual clock every N sec — recommended for the static dump, simulates live traffic),
**Auto · Live** (sync at real wall-clock). Enable/disable toggle; a background scheduler runs it.
`POST /api/sync` now clamps real-now past the data end to the last data point.

**5 roles** (`roles.js`): Super Admin · Admin · Report Manager · Errors Manager · Events Manager.
Least-privilege view scoping + capability gates (`editRules, manageSync, manageUsers, unmaskPII,
export, ackErrors`). Nav tabs hide by role. PII is **masked by default everywhere**; only Super
Admin can **unmask** (live, per-request, audited — never stored). Users managed by Super Admin at
`/api/users`; seed via `CONSOLE_SUPER_ADMINS` env. Acting role/user via `X-Console-Role` /
`X-Console-User` headers (the UI sets them after sign-in / role switch).

**Error Control Board** (`errors.js`): failures categorized by owner team (payment, activation,
semati, nafath, eligibility, change_plan, delivery) — KPI tiles, team/window filters, search by
mobile / order / ICCID / national ID. Click any row → **per-transaction end-to-end timeline**
assembling the full story across payments, activation, nafath, eligibility, delivery, change_plan.
Timeline lookup uses server-side row resolution so the client never holds raw PII.
Endpoints: `/api/errors/summary`, `/api/errors/feed`, `/api/transaction?row=|id=[&unmask=1]`,
`/api/settings/sync`, `/api/roles`, `/api/me`, `/api/users`. All mutations audited to `audit_log`.

## Login, theme & access gate
- **Login gate + email OTP**: unauthenticated users hit a full-screen sign-in. Email-only,
  restricted to **@salam.sa / @salammobile.sa**. Two steps: enter email → we email a 6-digit code
  → verify. Same pattern as dealers ops:
    - **dev/local (no SMTP env)**: the code is printed to the server log (`[OTP] …`), stored in
      `login_otps`, and returned in the response so local sign-in works — the login screen shows it.
    - **prod (SMTP_* env set)**: the code is emailed via SMTP and never returned by the API.
  Env: `SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM`. Codes expire 10 min,
  single-use, rate-limited (5 / 10 min). Session persisted in localStorage; sign-out returns to the gate.
- **Branding**: Salam logo (salam.sa CDN) in header + login, colored on light, white (CSS filter)
  on dark, with an "S" badge fallback if the image can't load.
- **Role resolution (server-hardened)**: the acting role comes from the user's email in
  `console_users`; unknown/other emails default to least-privilege `report_manager`. A genuine
  Super Admin may preview another role via `X-Console-Role`; non-super users **cannot escalate**
  by sending that header (verified: 403 on users/sync/rule-edit even with a spoofed header).
- **Theme**: light / dark toggle in the header (☾ / ☀), auto-by-time default (dark 19:00–06:00),
  persisted. Fully themed across all 7 views incl. the SVG topology/sequence diagrams and charts
  (re-render on theme change). No flash — theme applied in a head script before first paint.

## Notes / tuning — definitions pinned to the model code
- `change_plan_logs.status` enum `{pending:0, success:1, failed:2}` → failed=2, denom=(1,2).
- Nafath: success=`COMPLETED`, failed IN (EXPIRED,REJECTED,…); pending (new/waiting) excluded.
- Delivery failed/completed use `DeliveryRequest::MAPPED_*_STATES` verbatim (case-sensitive).
- ZATCA reported ⇔ `extra->>'zatca'` present (matches `Payment.reported_to_zatca`).
- All queries are read-only against the replica; nothing writes back to it.
