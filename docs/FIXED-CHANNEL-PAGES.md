# Fixed › E-purchase and Fixed › Salam Home — channel dashboards

_v2.0.0-alpha.7 · 5 Sep 2026_

Two pages, one renderer (`fixed-channel.js` → `window.FIXED_PAGES.epurchase / .salamhome`), one API
(`server/src/fixedChannel.js` → `GET /api/fixed/channel/:channel/all?range=…[&segment=ftth|5g]`, plus one route per
section). Modelled on the MVNO Dashboard: **customisable sections** (⚙ Customize — pick + order, saved per user in
`console_users.dashboard.fixed.<channel>`, localStorage fallback) and **every section split FTTX (FTTH | FTTB, always apart) | 5G home**
(product toggle: FTTX + 5G side by side / FTTH / FTTB / 5G). Business and technical **findings** are generated from the
numbers of the window and compared with the previous window of the same length.

| Channel | Rows | Notes |
|---|---|---|
| `epurchase` | `order_attempts.channel='epurchase'` **including consumer-direct** (no referral code) | the Overview excludes consumer-direct by default; this page must not |
| `salamhome` | `order_attempts.channel='salamhome'` (nexus channel PULSE) | buy FTTH + manage-line journeys: freeze / unfreeze / relocation / change plan / renew |

Source pool: `sda_ops.beta` when configured (it carries the PULSE→salamhome mapping), else prod public. The header
shows `data since <coverage.oldest>` so nobody reads a short history as a trend.

## Segment (product) rule
`5g` = workflow ∈ {fiveGWhiteLabel, fiveGFWA, salamHomeRelocationWL, salamHomeRelocationOwn} or plan ~ '5G' ·
`fttb` = workflow fttb or plan ~ FTTB / business · `ftth` = workflow ∈ {ftth, ePurchaseFTTH, salamHomeRelocationFTTH, promoters} or plan ~ fiber/FTTH · **FTTX** = FTTH + FTTB as a family, never merged in a chart ·
`other` = manage-line journeys with no product hint (shown as "product not recorded", never hidden).

## Sections ↔ Grafana panels we replace
| Section | What it shows | Grafana panel(s) it replaces |
|---|---|---|
| KPIs | attempts / completed / conversion / BSS orders / median time / Nafath fail — per product, Δ vs previous window; Saudi vs non-Saudi (NID 1 / Iqama 2); prepaid vs postpaid; cancelled by pay type; all-channels context bar; Nafath/Semati outcome chips | Total Orders by source · Saudi / Non-Saudi · Total Cancelled (Prepaid / Post-Paid / per channel) · Eligible / Non-eligible SEMATI · Packages ordered · Total 5G/FTTH orders last N days (daily sparkline) |
| Findings | business (volume, conversion, drop-offs, payments) and technical (faults, integrations, money at risk) sentences, P1–P3 | — (new) |
| Journeys | workflow × product: attempts, Δ, completed, conversion, stalled, in progress, abandoned, BSS order %, median, with error | Orders (FTTH & 5G) pie · 5G Orders · FTTH Orders |
| Flows | funnel per journey (reached / left / −%), biggest drop highlighted, stop-step table; **stops per day stacked by step** | Total Order with Current Step · Total Order Cancelled – by steps · Total Order Cancelled (time series) |
| Plans | plan × product: attempts, share, completed, conversion, BSS orders | Count by plan · Top FTTH / 5G subscribed plans |
| Campaigns | referral/QR vs consumer-direct per product, top codes | (QR page + new) |
| Payments | per product: success rate, collected, methods, apps; platform panel: success / failure rate, avg & median processing time, status counts (PAID, CAPTURED, FAILED, AUTHORIZED, VOIDED, REFUNDED, INITIATED), by method (MADA/VISA/MC + collected), by source (CARD/APPLE_PAY/SAMSUNG_PAY/TAMARA), per plan (invoice description), peak hours (KSA), daily / monthly / yearly trends with revenue, latest failed payments (masked), decline reasons, paid-with-no-order, by application | the whole "Payments" board |
| Errors | categories × product with business-rule vs fault class, team, open; events per day stacked by product; **unsuccessful OTP per day**; by step; top messages (ids folded) | TRPC error series · Total Un-Successful OTP · error tables |
| Integrations | systems (Fixed BSS ZSmart, Identity, Payments…): calls, fail %, p95; endpoint families: calls, fail %, 5xx, timeouts, p50 / p95 / max; **API errors per endpoint per day strips** | API Errors / FTTH API Errors / 5G API Errors |
| Regions | region × product: attempts, conversion, no-coverage, no-appointment | — |

Not in these pages (by design): **SDA dashboard** (leads, per-user counts, dealer errors) lives in Fixed › SDA map /
Reports; **Unifonic SMS points** is the `fixed_sms_balance` metric (needs `FIXED_SMS_BALANCE_URL`) — belongs on the
Fixed Overview / Alerts, not a channel page; **host CPU / RAM / disk** (node-exporter) needs a Prometheus read — not a
console data source today (candidate: `PROM_URL` panel on the Fixed Overview).

## Caveats to keep honest
- Payments "linked" = payments_v2 rows whose invoice carries an order / service / customer key of this channel's
  attempts in the window; the platform panel is every Fixed payment (all channels). 1.00 SAR test transactions are
  excluded. Application "Payment Optimization" is a routing layer, not a channel.
- api_calls: beta stopped ingesting `api_logs` (DB_WATCH_API_LOGS=0) — the Integrations section falls back to prod, which
  maps the Salam Home app into channel epurchase; the header of the section says which source was used.
- Step order for salamHome journeys comes from the beta's measured STEP_ORDER; unknown workflows order steps by frequency
  and say so.
