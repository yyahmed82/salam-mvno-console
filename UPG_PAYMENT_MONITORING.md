# UPG Payments — Monitoring, Alerting & L1 Playbook

Covers the two issues raised by MVNO-MS-Apps-L2 (Sreekanth, 15 Jul 2026):
**(1) Duplicate amount deduction** and **(2) Payment status mismatch (app "Initiated" vs Tap "Successful").**
Goal: make the Digital Console detect both *before* customers complain, show them on the dashboard and
Troubleshoot page, and notify the on-call by mail / SMS / Teams.

---

## 1. What is actually going wrong

Both issues live at the **UPG ↔ Tap ↔ app** boundary — the app and the gateway disagree about a payment.

**Issue 2 — Status mismatch (app "Initiated", Tap "CAPTURED").** Example ref `jgtv4jqpgcki`.
Tap captured the money (000 / Captured) but the confirmation callback that flips the app record to
`success` never landed, so the payment sits at **`Initiated`/`pending`** forever. The customer is charged
but the app thinks they didn't pay → the recharge/activation never completes → refund + complaint.

**Issue 1 — Duplicate deduction.** Example ref `sn2awf3rx44t`.
The app has **one** payment row (97.75, success) but Tap has **two CAPTURED charges** for the *same order id*
(two `chg_` ids, two auth codes). The gateway captured twice — usually a retry/idempotency defect on the
UPG↔Tap path. The customer is debited twice for one purchase.

### The blind spot we just closed
The existing `payment_failure_rate` metric counts only `status IN ('success','fail','failed')` —
**`pending`/`initiated` are excluded from the denominator.** So a payment Tap captured but the app left
"Initiated" was counted as *neither* success *nor* failure: it fell through silently. That is exactly why
issue 2 never showed on any dashboard. The new metric below counts these directly.

---

## 2. What was added to the console

Two new metrics (`server/src/metrics.js`) + alert rules (`server/src/seedRules.js`), Digital Ops:

| Metric | What it counts | Rules (tune with **Test now**) |
|---|---|---|
| `payment_stuck_initiated` | Payments in `pending`/`initiated` **older than 30 min** (per vendor) — should already have resolved | `payment_stuck_spike` P2 ≥15/3h · `payment_stuck_storm` P1 ≥40/3h |
| `payment_duplicate_suspect` | Groups of **same customer + amount + target** charged `success` **2+ times within 30 min** | `payment_duplicate` P1 ≥5/6h |

Both carry a **runbook** (shown on the incident) with the exact triage steps.

Troubleshoot / Error Control Board (`server/src/errors.js`) gained two drill-down categories so L1 can pull the
**actual payment references**:
- **Payment stuck (unconfirmed)** — lists `vendor · amount · stuck Nm · ref <payment_reference_id>`.
- **Payment duplicate (suspected)** — lists `N× amount · vendor · refs …`.

(The `Payment / gateway` category was also moved from *BSS Ops* to *Digital Ops* to match the alert rules.)

---

## 3. How each issue now reflects across the console

1. **Dashboard (Alerts → Metric charts):** both metrics appear as cards with the seasonal expected-range band;
   a breach shows red dots + the severity-coloured threshold line, and the card sorts to the top (breaching-first).
2. **Troubleshoot page:** the two new categories show live counts (KPI tiles) and a searchable feed — type a
   reference like `jgtv4jqpgcki` and jump straight to the stuck/duplicate row.
3. **Alerts board:** when a rule trips, an incident opens with its runbook, ack/assign/snooze, and (once wired)
   the correlated ServiceNow tickets.
4. **Notifications (already wired via ChatOps):** P2+ → **Teams**, P1 → **SMS** (on-call), plus the **mail** digest.
   No extra code — the new rules ride the existing pipeline. (Prereqs still open: standard-channel Teams webhook,
   a valid Unifonic SMS AppSid, SMTP for mail.)

---

## 4. L1 proactive playbook

**Every shift / on a page:**
1. Home → check the **Payments** KPIs and the NOC banner for a stuck/duplicate spike.
2. Alerts → **Metric charts**, filter **Breaching only** — is `payment_stuck_initiated` or
   `payment_duplicate_suspect` above its line and outside the expected band?
3. If yes, open the incident → follow the **runbook**:
   - **Stuck "Initiated":** confirm the Tap/UPG callback endpoint is returning 200; in Troubleshoot →
     *Payment stuck*, copy the `payment_reference_id`s; reconcile each against Tap (was it CAPTURED?);
     replay/settle the confirmation so the app flips to `success`, or refund if Tap did **not** capture.
     If the callback pipeline is down, page BSS/Payments L2.
   - **Duplicate:** Troubleshoot → *Payment duplicate*; for each group look up the order id in Tap — two
     CAPTURED charges = a real double-charge → refund the extra capture and log it. Rising volume → engage
     UPG/Tap on the retry/idempotency root cause.

**Severity guide:** a handful of stuck/duplicates = P2 (watch + reconcile); a surge (callback pipeline down,
or many customers double-charged) = P1 (page on-call, money at risk).

---

## 5. Recommendation — close the reconciliation gap (authoritative detection)

The app replica alone **cannot** see Tap's second capture (issue 1) or confirm that a stuck "Initiated" was
actually captured (issue 2) — Tap is the source of truth. The app-side heuristics above are an early-warning
proxy. For authoritative, zero-false-positive detection, add a **Tap reconciliation feed**:

- Pull Tap charges (by `order id` / `payment_reference_id`) on a schedule and compare to app `payments`:
  - **order id with >1 CAPTURED in Tap** → confirmed duplicate.
  - **Tap CAPTURED but app not `success`** → confirmed mismatch.
- Surface those as first-class metrics (`payment_recon_duplicate`, `payment_recon_mismatch`) that supersede the
  heuristics. This is the same pattern as the prod-DB sync — a scheduled pull + compare.

Also worth doing: **fix at the source** — enforce idempotency on the UPG→Tap capture call (issue 1) and add a
callback retry / periodic settle-sweep on the app side (issue 2) so stuck payments self-heal.

---

## 6. Deploy & tune

All of the above is **server-side** — rebuild to activate:

```
docker compose up -d --build console
```

Then in Alerts → **Alert rules**, open each new rule → **Test now** to see the current value against live data,
and adjust the thresholds (15 / 40 / 5 are conservative first guesses). The stuck metric is also broken down by
vendor (salam=UPG, tap, hyperpay) so you can tell whether it's UPG-specific.
