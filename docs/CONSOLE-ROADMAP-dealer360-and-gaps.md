# Console roadmap — Dealer 360 + the data we hold but don't show

*Grounded in a full sweep of the 14 replicated tables against every query the console runs
(2026-08-09), plus a real Sales-Ops request: INC0017182.*

---

## 1 · The case for Dealer 360

**What happened:** Sales Ops asked for a dealer wallet report (تقرير محفظة) for `dsp_004053`.
The path it took: email → Operation Center → P4 ticket INC0017182 → L1 → assigned to L2 →
Sreekanth manually extracted 520 wallet transactions from TRMS → emailed an xlsx back.
**Fri 20:01 → Sun 12:24. A day and a half of four teams' time for a read-only data pull.**

**The goal:** L1 answers this from the console in two minutes, exports the file, attaches it to the
ticket. L2 never sees it.

### What the request actually contains

The returned xlsx (`transaction-history-dsp_004053.xlsx`): `id, amount, transaction_type
(HYPERPAY_TOPUP / WALLET_TRANSFER), source_system (HYPERPAY / TRMS), account_to, account_from,
created_on, status (PAID), comments` — the dealer's **wallet ledger**. That data lives in **TRMS**,
not in our replica. So the feature splits honestly into two phases:

### Phase 1 — buildable today (replica only)

A **Dealer 360** view: search a dealer → one page with

| Block | Source (already synced) |
|---|---|
| Profile — name, username, type (indirect/partner), group | `sellers` |
| Commissioned orders over time + total | `seller_deductions` (DISTINCT order ids) |
| **Commission paid (SAR)** | `seller_deductions.amount` (halalas ÷ 100 — never displayed anywhere today) |
| Commission failures | `seller_deductions.commission_response` (parse fail states) |
| The dealer's orders + activation outcome | `onboarding_orders.seller_id` (already used by dashboard.js) |
| Physical SIM stock coverage | `onboarding_orders.physical_sim_iccid` |
| **Export CSV/XLSX** button | everything above, formatted for a ticket reply |

First step shipped today: `dealers` is now a first-class Analytics dataset and a preset board
(**Dealers (DMS)** — 4 stat tiles + 4 charts). Add any of its panels to the home Dashboard via
✦ Customize.

### Phase 2 — the wallet ledger (needs one read-only grant)

Same playbook that just worked for `uil_logs`:

1. `yosri.a` on **172.31.43.72** can already see the `tec_trms` and `dms_v1` schemas —
   run the discovery script variant against `%wallet%` / `%transaction%` tables to locate the
   ledger, or ask the TRMS owner directly which schema.table backs `transaction-history`.
2. Request `SELECT` for a service account on that one table (reuse
   `deploy152/OSB-mysql-grant-request.md` as the template).
3. Console reads it like `osbLog.js` reads `uil_logs` — read-only pool, env-gated, inert until
   configured. Dealer 360 then shows the full wallet history with an export identical to the file
   L2 produced by hand.

Also required for L1 self-serve: mapping `dsp_004053` (DSP dealer ref) ↔ `sellers.id` /
wallet `account` number — confirm with Sreekanth where that mapping lives (likely a column in
TRMS's dealer table).

**Workflow note:** the console stays read-only. L1 *answers* the ticket with an export; nothing in
the console writes to TRMS or the DSP.

---

## 2 · Shipped in this pass

- **`dealers` dataset** (analytics.js) — metrics: commissioned orders (DISTINCT), active dealers,
  commission SAR, deduction rows; dims: dealer name, dealer group; filterable by seller.
- **Dealers (DMS) preset board** (analyticsPresets.js) — auto-published on next boot; panels can be
  added to the home Dashboard per-user via Customize.
- **Bug fix:** `checkout_type` 0 (= normal) was missing from both the label map and the CASE
  expression, so **plain checkouts have been bucketed as "other"** in every checkout chart.

## 3 · Bugs the sweep surfaced (fix before they bite)

| Where | Problem |
|---|---|
| `delivery_requests` joins | `delivery_on_id` is joined **without** `delivery_on_type` everywhere (api.js, errors.js). Checkout and OnboardingOrder ids can collide in principle — add the type predicate. |
| Metric-charts alerting badge | Card evaluates catalog thresholds ignoring whether the rule is **enabled** (the disabled dealer rule painted amber). Show "rule disabled" instead. |
| `eligibility_logs` | Not an Analytics dataset at all — the only log table missing. Eligibility denials can't be charted by process/api. |

## 4 · Top opportunities — data present in the replica, displayed nowhere

Ordered by (value ÷ effort). Each is a column set that is **already synced**.

| # | What | From | Would give | Page |
|---|---|---|---|---|
| 1 | **Failure rate by app version** | `activation/eligibility/nafath_logs.app_version, platform` | "Did the last app release break onboarding?" in one chart | Troubleshoot + Analytics |
| 2 | **Geography** | `delivery_city_id/area_id`, `delivery_lat/lng`, `receiver_lat/long` | Orders, activation rate, delivery-fail **by city**; demand-vs-fulfilment map. Zero geo exists today | Analytics (new board) |
| 3 | **Exact-step funnel** | `onboarding_orders.aasm_state` (11 states) | True drop-off per step — current funnel collapses to 4 coarse stages | Analytics (Funnel boards) |
| 4 | **Eligibility by ID type** | `nationality_id_type` (Saudi/iqama/visitor), `nationality_id` | Explains the flat denial rate; visitor-flow health | Analytics (Eligibility) |
| 5 | **BNPL / shop mix** | `checkouts.extra`: `payment_plan`, `payment_vendor` (Tamara/Tasheel/Emkan), `sku`, `pay_with` | Whole installments + shop dimension, invisible today | Analytics (new board) |
| 6 | **Cycle times** | `checkouts.completed_at`, `delivery_requests.delivered_at` vs `delivery_time` (promised) | Median completion time; courier promised-vs-actual SLA | SLA + Analytics |
| 7 | **Identity by provider/channel** | `nafath_logs.auth_type` (nafath/absher), `channel_id→channels.name` | Nafath vs Absher success split; `channels` finally used for something | Analytics + Troubleshoot |
| 8 | **Abandonment recovery** | `status='abandoned'`, `abandon_notification_level` | Does the recovery notification actually bring customers back? | Analytics + Dashboard |
| 9 | **Fraud/velocity tile** | `payments.user_ip`, `card_type`, `customer_` vs `target_mobile_number` | Many cards/MSISDNs from one IP; third-party top-ups | Troubleshoot |
| 10 | **True paid attribution** | `extra->'adjust_attributions'` (network/campaign/adgroup) | Growth currently infers paid vs organic from utm_source alone; backend defines organic = adjust IS NULL | Growth |
| 11 | **Plan catalogue health** | `plans.enabled, bundle_type, deposit, popular…` (22 of 27 cols unused) | Enabled plans with zero orders; revenue by voice/data | Analytics (new board) |
| 12 | **Language split** | `extra->>'lang'` | Conversion ar vs en | Analytics |
| 13 | **Customer mix** | `gender`, `dob` (filled by Semati) | Demographics by plan/channel | Analytics |
| 14 | **MNP friction** | `tcc_verified` per `mnp_operator` | Pairs with the existing donor board: where porting sticks | Troubleshoot |
| 15 | **Churn view** | `terminated_at`, `archived_at` | No termination/churn number exists anywhere in the console | Dashboard |

Also: the `settings` table (VAT, delivery fee, replacement fees) is synced and never read — money
tiles hardcode what it contains.

## 5 · Suggested order

1. **Dealer 360 phase 1** (this week — rides the momentum of INC0017182, saves L2 time immediately)
2. App-version failure chart (#1 — cheapest high-value chart in the list)
3. Exact-step funnel (#3 — improves a page people already use daily)
4. TRMS wallet grant request in parallel (procurement lead time)
5. The rest via the L2 review backlog — let session 3's ranked list decide

*Sources: full column-level sweep with file:line references available on request; enum meanings
verified against selfcare-backend models, not guessed.*
