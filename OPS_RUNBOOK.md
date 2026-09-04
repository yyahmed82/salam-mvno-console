# Salam Digital Console — Proactive Ops Runbook (SOP)

**Audience:** L1 NOC / L2 Ops · **Scope:** Semati, Nafath, Payments (UPG), BSS error codes, Delivery, Eligibility, Plan change, ZATCA, and console/sync health.
**Golden rule:** an *alert* fires on **change from normal**, not on the normal baseline. The steady-state (e.g. Semati ~55%) lives on the **SLA** page; the **Alerts** page is for things that just got worse.

---

## 1. How you get notified (channels)

| Channel | Status | Set up in | Notes |
|---|---|---|---|
| **Teams** | ✅ live | Settings → Notifications & escalation (Incoming Webhook URL) | Primary channel; per-incident card with severity + link |
| **Email** | ✅ live | Per-user: toggle *Mail alert* on the user; needs `SMTP_HOST` | Alert digest + 08:00/20:00 sync-health |
| **Slack** | ✅ live | Settings → Notifications (webhook URL) | Same payload as Teams |
| **WhatsApp** | ✅ live | Settings → Notifications (Meta Cloud API: phone-id, token, group-id) | Official Business group |
| **SMS** | ❌ not yet | — | Can be added via Salam's SMS gateway (or Unifonic/Twilio) — give me the API endpoint + creds and I'll wire it as a channel |

**Severity gate:** `minSeverity` (default P2) — only alerts ≥ this level are pushed. **Escalation:** P1 incidents walk the on-call ladder (role-based) until acked. Configure the rota under Notifications & escalation.

**Getting *specific* alerts per team:** every rule carries a `team` (BSS Ops / Digital Ops / Sales Ops) and posts the rule name. Today all channels receive all incidents ≥ minSeverity; if you want *per-team channel routing* (Semati → Digital-Ops Teams channel, Payments → BSS-Ops channel), that's a small add — ask and I'll wire per-team webhooks.

---

## 2. One-time setup checklist (do this once)

1. **Teams webhook** set + chatops **enabled**, `minSeverity = P2`.
2. **On-call rota** per role configured (for P1 escalation).
3. **Gateway alerts ON**: `curl .../api/anomaly/config` → `"gatewayAlerts":true`.
4. **Sync live** (VPN up) — real-time alerting only works on fresh data; the **sync-liveness alert** now pings Teams if the console goes blind.
5. **Email**: turn on *Mail alert* for the L1/L2 distribution users; set `SMTP_HOST`.
6. **Error-code labels** loaded (Settings → Sync engine → Error codes) so BSS codes read as "1500 - <meaning>".

---

## 3. Proactive monitoring rhythm

- **Every shift start:** open **Dashboard** → read the **NOC banner** (green/amber/red + headline), the **anomaly strip**, and the **On-call** view (`#oncall`) on mobile.
- **Continuously:** the console pushes to Teams on any new incident — no need to stare. Trust the banner colour.
- **SLA page:** weekly — review chronic state (Semati, activation, eligibility) and error-budget burn.
- **Sync health:** if the **sync-liveness** alert fires ("console is BLIND"), watch prod directly until it clears.

---

## 4. Per-issue SOPs

Each issue = **the alert that fires → where to look → first response → who to escalate.**

### 4.1 Payments — UPG gateway down (failover to HyperPay)
- **Alert:** `Gateway down · UPG (salam)` — **P1** (per-gateway volume drop to ~0 vs seasonal norm). Note: aggregate payment success stays healthy on failover, so the `payment_fail_rate` rule stays quiet — the **gateway detector** is what catches this.
- **Where:** NOC banner (red) → Alerts (open P1) → Dashboard → *Gateway volume — hourly* (red drop band + exact KSA start/end).
- **First response:** confirm the UPG (`salam`) line dropped and HyperPay absorbed. Confirm business impact (usually none on clean failover). Open the P1 bridge; page the **Payments/UPG** team.
- **Escalate:** BSS Ops → UPG vendor team.

### 4.2 Payments — real failure spike
- **Alerts:** `Payment failure storm` **P1** (≥40%/1h) · `Payment failure spike` **P2** (≥30%/3h) · `Web checkout failure spike` **P2** (≥35%/3h, web only).
- **Where:** Dashboard → *Failure rate over time*, *Gateway success rate — hourly*; Troubleshoot → payment failures feed; **Decline reasons** for the fail_reason mix.
- **First response:** isolate gateway vs card vs platform (web/app) using the per-vendor + platform charts; check a sample failed txn via **Subscriber 360**.
- **Escalate:** BSS Ops.

### 4.3 Semati (MSISDN provisioning)
- **Alerts:** `Semati provisioning storm` **P1** (≥75%/1h) · `Semati spike` **P2** (≥65%/24h). *(Baseline ~55% — thresholds sit above it so only real deterioration pages.)*
- **Where:** SLA → Semati; Analytics → Activation Success → *Semati success rate*; Troubleshoot → SEMATI_FAILED / MOBILE_EXISTS.
- **First response:** check Semati API health; look at the status-code mix; is it MOBILE_EXISTS (data) vs SEMATI_FAILED (integration)?
- **Escalate:** Digital Ops → Semati integration team.

### 4.4 Nafath (identity verification)
- **Alerts:** `Nafath failure storm` **P1** (≥50%/1h) · `Nafath spike` **P2** (≥25%/1h).
- **Where:** SLA → Nafath; Analytics → *Nafath outcomes* (completed/pending/failed) and *Nafath failure rate*; the home **Nafath KPI** shows the completed/pending/failed split.
- **First response:** Nafath (Absher) session expiry vs rejection? Spike in EXPIRED = user-side/timeouts; REJECTED = eligibility. Check Absher status.
- **Escalate:** Digital Ops → Nafath/Absher liaison.

### 4.5 BSS error codes (e.g. 1500)
- **Signal:** BSS `status_code` values on `activation_logs`. Aggregate covered by `Activation failure storm` **P1** (≥70%/1h).
- **Where:** Troubleshoot; Analytics → Error Codes → *Activation error codes* (now shows "1500 - <meaning>" once labels are loaded) and *Errors by API*.
- **First response:** identify the dominant code; use the labelled meaning; if a *new* code appears vs the last 7 days, treat as a fresh signal.
- **Make a specific code page you:** if a single code (e.g. 1500) is business-critical, tell me and I'll add a dedicated rule (`status_code = 1500 rate ≥ X`). Today only the aggregate activation rate alerts.
- **Escalate:** Digital Ops → BSS team.

### 4.6 Eligibility (CITC)
- **Alert:** `Eligibility denials` **P2** (≥50%/24h). *(Baseline ~37%.)*
- **Where:** Analytics → Eligibility; funnel drop-off (Eligibility step is often the bottleneck).
- **First response:** CITC/Semati eligibility service health; dealer-validation failures vs genuine denials.
- **Escalate:** Sales Ops.

### 4.7 Delivery / couriers
- **Alerts:** `Delivery failure/return spike` **P2** (≥25%/24h) · `Deliveries stuck` **P2** (≥60,000/48h) · per-courier `Gateway down · <courier>` (volume drop).
- **Where:** Analytics → Delivery (states, by vendor); **Incomplete / stuck orders** widget for the actual stuck records with "Stuck for" age + View 360.
- **First response:** courier callback pipeline vs genuine returns; check the states breakdown.
- **Escalate:** Digital Ops → courier vendor.

### 4.8 Plan change / onboarding conversion / ZATCA / off-hours
- `Plan change failure spike` **P2** (≥30%/24h) → BSS plan migration.
- `Onboarding conversion drop` **P2** (≤2%/24h) → funnel/paywall issue.
- `ZATCA reporting gap` **P1** (≥800/3h) → e-invoicing pipeline stalled (compliance).
- `Off-hours unusual activity` **P2** (01:00–06:00, ≥30) → test/automation/fraud.

### 4.9 Console / sync health (you're blind)
- **Alert:** `Console sync DOWN — live alerting is BLIND` (Teams) after ~2 failed VPN checks; `RESTORED` when back.
- **First response:** the console can't see prod → **watch prod dashboards directly** until restored. On recovery it auto-catches-up (watermark + overlap); verify with `POST /api/sync` + the per-table freshness query.
- **Escalate:** Infra / VPN owner.

---

## 5. When an incident fires — standard flow

1. **See it** — Teams card / NOC banner red / anomaly badge.
2. **Triage** — open Alerts → the incident → its metric chart; use the per-issue SOP above.
3. **Acknowledge** in the console (stops re-paging; starts MTTR clock).
4. **Investigate** — drill via Analytics / Troubleshoot / Subscriber 360; add an **event-timeline** marker for any deploy/change.
5. **Communicate** — the P1 bridge (email template like INC000003205104).
6. **Resolve** — the alert auto-resolves when the metric returns to normal; add the RCA note.

---

## 6. What's not yet automated (ask to add)
- **SMS** channel (needs Salam's SMS gateway API).
- **Per-team channel routing** (Semati → Digital-Ops channel, etc.).
- **Per-error-code rules** (e.g. alert specifically on BSS 1500).
- **Correlation hints** on charts ("payment fail ↑ when UPG dropped").

*Thresholds current as of 2026-07-13 (baseline+headroom tuning). Revisit after observing a week of live data.*

## 7. Monitoring page (connectivity strip + Digital-API traffic)

The **Monitoring** tab (after Dashboard, `#monitoring`) has two blocks:

1. **Connectivity & health strip** — one card per console dependency, checked live in parallel:
   Console API, Replica DB (+ prod-sync age), Console DB, Yusr LLM (Ollama), OSB MySQL (uil_logs),
   API GW nodes (TCP probe), ServiceNow, and the API-traffic DB. Green = OK, amber = degraded,
   red = down, **grey = not configured** (set the matching env var — see deploy152/env.template).

2. **API health** — mirrors the ops Grafana "Digital-API traffic" dashboard by reading its source
   directly (MySQL `grafana`.`transaction_logs` on 172.31.43.175, fed every 5 min from
   api_logger.production.log). Gauges (total/success/failure), response-code distribution,
   AVG/MAX duration trend, top-20 slow calls, and a per-API table with the errclass
   business-vs-technical failure split and p95 latency. Enable with `API_TRAFFIC_URL`
   (read-only MySQL account); the page shows a friendly "not configured" card until then.

**Latency alerting:** the panel at the bottom sets a GLOBAL p95 threshold (ms) plus per-API
overrides (saved in console_settings `api_latency_thresholds`, Manage-sync capability, audited).
The `api_latency_p95` metric stores **p95 ÷ threshold**, so the rules stay simple ratios:
`api_latency_breach` (P2 at 100%), `api_latency_storm` (P1 at 200%), `api_latency_per_api`
(P2 — worst single API vs its own override). `api_technical_fail_rate` alerts
(`api_technical_fail_spike` 10% / `api_technical_fail_storm` 25%, both class technical) fire on
1500/5xx/408/timeout/SOAP-fault signatures at the API surface. All thresholds are PROVISIONAL —
calibrate against a week of live data. When `API_TRAFFIC_URL` is absent these metrics emit no
rows, so the rules sit silently on "no data in window".

---

## Login & session — what the platform actually records

Read from the app source (`selfcare-backend`), not inferred from data:
`app/controllers/api/v1/users/authentication_controller.rb`, `app/models/user.rb`,
`app/models/concerns/trackable.rb`, `config/initializers/api_guard.rb`,
`app/services/optiva/account.rb`.

### The flow, step by step

| # | Step | Endpoint | What it writes |
|---|------|----------|----------------|
| ① | Profile check | `users/sign_in` → `find_resource` | nothing. Calls Optiva `get_subscription_profile`. DEACTIVATED → **-512** (and the app row is deleted), PENDING → **-513**, lookup raises → **-112** |
| ② | Password | same request | nothing. Wrong password / no account → **-300** |
| ③ | Plan check | same request | nothing. No current plan → **-705** |
| ④ | **Sign-in tracking** | same request | **the only DB write in the whole login**: `users.current_sign_in_at`, `last_sign_in_at`, `current_sign_in_ip`, `last_sign_in_ip`, `sign_in_count + 1`, `platform`, `app_version`, `os_version` |
| ⑤ | OTP sent | same request, if `Current.new_registration && Setting.login_otp` | **nothing in the database.** `has_one_time_password(length: 4, interval: 5.minutes)` — the code is a **TOTP** derived from `users.otp_secret_key`. SMS goes out through `Notifier::SmsWorker` (Sidekiq, fire-and-forget). If the flag is off, a token is issued immediately and there is no OTP step at all |
| ⑥ | OTP verify | `users/verify` | **nothing at all** — not even tracked fields. `authenticate_otp(code, drift: 180)`; wrong/expired → **-103**. On success the access token is issued. **This is the real "logged in" moment** |
| ⑦ | Balance | `POST /bss/account/execute-account-blnc-query` | `uil_logs`. First authenticated call the app makes after login |

### Three consequences that trip people up

1. **`current_sign_in_at` means "password accepted", not "logged in."** It is written at ④,
   before the OTP is even sent. A customer who abandons at the OTP screen still gets a fresh
   timestamp and `sign_in_count + 1`.
2. **The login OTP is never stored.** It is a TOTP. Finding no row in `otps` for a login proves
   nothing — that table serves registration, change-plan and other stored-OTP flows.
3. **"Logged in right now" is not a fact the platform holds.** `api_guard` is configured
   `token_validity = 1.year`, there is no session table, and nothing is written on logout. Once
   issued, a token is simply valid for a year. Only *last authentication* and *last activity*
   are answerable.

### Where to look in the console

- **Monitoring ③ → Login funnel** — password → OTP verify → balance, from `api_traffic_events`,
  with the failure codes per step and the **OTP abandonment** (accepted passwords minus OTP
  submissions). This is the only measurement of that drop-off, because step ⑥ writes nothing.
- **Monitoring ③ → Who was blocked?** — enter an MSISDN or national ID: last authentication per
  line, device, sign-in IP, plus the rate-limiter verdict for those IPs.
- API: `GET /api/login/funnel?hours=24` · `GET /api/login/state?q=<msisdn|nid>`.

### Replica caveat (this cost us a wrong conclusion once)

`users` is the only table a login writes to. Until 21 Aug 2026 it was **not** in
`prodSync.DEFAULT_TABLES`, so its sign-in columns were frozen at the last full copy — which reads
exactly like "Devise trackable is broken platform-wide". It was not: the app writes on every
accepted password; the write simply never reached the replica. `users` is now synced, with
`password_digest` and `otp_secret_key` excluded at the source query (`prodSync.SKIP_COLUMNS`) —
the console needs to know *when* someone signed in, never *what* would let anyone sign in as them.
Always read the "Data feed" line in the login card before drawing conclusions from a stale
timestamp.

### Login error codes (`app/controllers/concerns/error_codes.rb`)

| Code | Constant | Step | Meaning |
|------|----------|------|---------|
| -300 | INVALID_LOGIN_CREDENTIALS | password | wrong password, or no app account for that number |
| -103 | INVALID_OTP | otp | wrong or expired code (5-min TOTP window, ±180 s drift) |
| -112 | INVALID_MOBILE_NUMBER | profile | malformed number **or** the Optiva lookup raised — a BSS fault surfaces as this code |
| -512 | ACCOUNT_SUSPENDED | profile | Optiva state DEACTIVATED |
| -513 | ACCOUNT_PENDING | profile | Optiva state PENDING — activation unfinished |
| -705 | PLAN_NOT_REGISTERED | plan | password correct but no current plan |
| -102 | INVALID_CUSTOMER_INFO | save | the user row failed to save after the Optiva sync |
| -704 | IP_RETRIES_EXCEEDED | limiter | blocked by IpRetrial before any login logic ran |
