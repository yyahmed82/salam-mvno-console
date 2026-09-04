# Business vs Technical error segregation — console-wide rollout spec
L2 roadmap item #1 (agreed session 2, 2026-08-11). Foundation SHIPPED: `server/src/errclass.js`
(classifier + SQL CASE builder + color standard) — unit-verified on 14 real cases.

## The rule (one sentence)
The API answered "no" = **BUSINESS** (blue #3b82f6). The API failed to answer = **TECHNICAL**
(red #ef4444). Success stays green #10b981. Matches the Grafana dealer dashboards exactly.

## Color standard (add once, use everywhere)
CSS vars in index.html palette: `--ok:#10b981; --err-biz:#3b82f6; --err-tec:#ef4444` (+ bg tints
#e7f8ef / #e9f1fe / #fdeceb). A shared badge helper in ops.js:
`clsBadge(cls)` → pill "Business" (blue) / "Technical" (red) / "Success" (green).

## Wiring plan — in order
1. **errors.js feed (Troubleshoot)** — attach `err_class` to every feed row: call
   `errclass.classifyClass({ok, status_code, response, detail})` at row-build time (server).
   For set-based tile counts use `classCaseSql(codeCol, textExpr)` per source table
   (activation_logs/eligibility_logs: status_code+response; payments: gateway decline present ⇒
   business by definition; delivery: state lists; nafath: EXPIRED/REJECTED ⇒ business).
2. **Troubleshoot UI (ops.js)** — top strip: 3 KPI tiles Success/Business/Technical (counts +
   rate); every error tile splits its count "N (B: x · T: y)"; feed rows get the class badge;
   add filter chips [All | Business | Technical] next to the existing gateway chips.
3. **Dashboard KPI (home.js + /api/home)** — split the "3,920 ERRORS" card into two cards:
   "Business errors" (blue, expected/informational) and "Technical errors" (red, needs-a-look →
   drill to Troubleshoot pre-filtered class=technical).
4. **Timeline drawers (errors.js timeline + sub360.js)** — each failed event gets the badge next
   to its status; drawer header shows class + reason (classifier returns `reason` = matched signal).
5. **Analytics (analytics.js server)** — add `err_class` dim to failure-capable datasets via
   classCaseSql; preset panel "Errors by class over time" (stacked blue/red).
6. **Alerts** — new metrics `technical_error_burst` (count, windowed, min_sample 0 — outage
   signal) vs `business_error_share` (informational P3). KEY WIN: technical-only alerting stops
   business noise (declines, ineligibles) from polluting P1/P2; recalibrate existing rate rules
   that currently mix both (activation_fail_rate note in seedRules already flags this).
7. **Yusr** — customer pack `recent_failures` rows gain `class`; SYSTEM_BASE rule: "state the
   class: business (expected outcome — explain to customer) vs technical (platform issue —
   escalate)". Case memory tags inherit it.
8. **Journeys/Topology docs (roadmap #2)** — per-API tables get a Class column (which codes are
   business vs technical per endpoint), starting with /bss/crm/update-resource-reservation.

## Classification reference (from errclass.js — keep in sync)
- TECHNICAL codes: 1500, 5002, 408, 5xx, 715 · text: timeouts, conn reset/refused, SSL, I/O,
  OSB-382000, CRMException, SOAP fault, "service not available", gateway errors, unreachable.
- BUSINESS codes: 727, 726, 706, 738, 708, 823, 824, 736, 804, 776 · text: not eligible, expired,
  invalid, already exists/used, not found, declined/insufficient (ALL payment declines), limits,
  wrong OTP, duplicates, no price plan.
- Fallback: failed + readable answer ⇒ business; failed + empty/garbage ⇒ technical.

## Deploy
errclass.js/errors.js/api.js/analytics.js baked → full deploy.sh; ops.js/home.js/sub360.js/index.html
mounted → hard refresh. Verify: Troubleshoot 3-way strip sums to old total; BSS-1500 rows red;
"Not Eligible" rows blue; dashboard errors card split reconciles.
