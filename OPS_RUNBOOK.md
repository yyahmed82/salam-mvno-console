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
