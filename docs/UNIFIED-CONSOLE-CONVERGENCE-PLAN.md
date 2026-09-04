# Salam Unified Console — Convergence Plan

**Goal:** one observability platform for Fixed and MVNO at `https://salam.sa/unified-console`, built on the **mvno-console codebase** (Digital Console lineage) and absorbing every capability of the **salam-dealer-ops beta** (Operations Console, `/operations-console-beta`, port 4500).
**Written:** 4 September 2026 · **Author:** Yosri (with Claude) · **Capacity assumption:** Yosri + Claude Code, evenings/weekends — every phase is sized to ship in 1–2 weeks of part-time work and is independently deployable.
**Supersedes / amends:** `RUNBOOK-fixed-on-console.md` (22 Aug) — the *codebase* decision there stands (Fixed lives inside the mvno-console code, not a fork); what changes is the *deployment*: a third URL, not an in-place upgrade of `/digital-console`.

---

## 0 · The decisions, recorded

| # | Decision | Why |
|---|---|---|
| D1 | **One codebase: mvno-console.** The unified console *is* the next major version (v2.x) of mvno-console. salam-dealer-ops is a *feature donor*, never a second runtime. | mvno-console already carries 80 % of the platform: OTP/session/roles-with-caps, audit, 49 metrics / 62 rules alert engine with correlation + anomaly + escalation + ChatOps, error board with Business/Technical SSOT, Sub360, analytics engine, SLO, Yusr, tickets, ServiceNow, prod-sync. dealer-ops has 12 metrics / 15 rules and none of the rest. Porting the smaller into the larger is the only direction that does not lose function. |
| D2 | **Vanilla JS + Express + pg stays.** No Next.js, no Prisma, no build step in the unified console. | Host 152 has **no internet and no psql**; the Next/Prisma bundle needs a Docker build with an npm mirror and a pinned `rhel-openssl-1.1.x` engine. mvno-console deploys with `tar + scp + pm2 restart`. Every dealer-ops feature is a tRPC procedure over SQL on a Postgres read model — it ports 1:1 to an Express route + `pg` query. |
| D3 | **Three URLs during convergence, one at the end.** `/digital-console` and `/operations-console` stay frozen (hotfix-only) until cutover; `/unified-console` is where all new work lands. | Zero risk to L1/L2 who use the two consoles daily (L1 sessions ran 24 & 26 Aug). |
| D4 | **Two DBs in stage 1, one DB at stage 2.** Stage 1: unified console owns `unified_console` (clone of `mvno_console` schema) and *reads* `sda_ops_beta` (the dealer-ops read model) through a read-only pool, with the existing `opsb-ingest-watch` PM2 process left running untouched. Stage 2: the nexus/payments ingest is ported into the unified server, writes `fixed_*` tables in `unified_console`, and `sda_ops*` is retired. | Reusing the working ingester buys Fixed data on day one without rewriting 6,300 lines of TypeScript first. The rewrite happens *after* the UI is proven, against a known-good reference to diff against (`sync-check` pattern). |
| D5 | **Namespace everything Fixed with `fixed_` / `/api/fixed/` / `#fixed`, and add `segment` (`mvno` \| `fixed`) as a first-class dimension on every *shared* feature** (alerts, error board, analytics, Sub360, SLO, tickets, audit). | The alert engine addresses metrics by string key; a collision silently overwrites an MVNO metric (see runbook §3). The `segment` column is what lets one alert page, one error board and one Customer 360 serve both businesses. |
| D6 | **Google Maps is in scope** (reversing the July "🚫 excluded" line in `FEATURE_PARITY.md`). | Dealers/QR maps are the most-used Operations Console screens; `GMAPS_KEY` and an SVG fallback already exist in `api.js:1512`, and `dealers-map-runbook.md` is a written port guide. |
| D7 | **Fixed/FTTH new-connection and relocation observability is in scope after the beta port**, not before. | The beta gives the data model (`order_attempts` with odb/iccid/cpe/serviceNo, `salamHomeRelocation*` workflows, 25-category error taxonomy). Relocation/ODB metrics are a Phase 6 extension of that model, not a prerequisite. |

---

## 1 · Where we start from (measured, not assumed)

### 1.1 mvno-console (Digital Console) — the base
Prod: `ruh-salam-site03` 172.31.38.152, PM2 `salam-console`, port 4600, `/apps/console`, nginx on 172.31.38.115 (`location /digital-console/`). DBs on 172.31.15.121: `SOURCE_DATABASE_URL` (selfcare replica, fed by `prodSync.js` every 5 min from 172.31.43.123) + `CONSOLE_DATABASE_URL` = `mvno_console` (35 tables + 6 runtime). Optional pools: `UPG_DATABASE_URL`, `DMS_DB_URL` (Clara MariaDB), `OSB_LOG_URL`, `API_TRAFFIC_URL`, ServiceNow, Ollama, Redis. Size: `server/src` 99 files / 25.7k lines (`api.js` = 6,023 lines, 229 routes); frontend 46 root scripts / 17.4k lines, no bundler. Roles: 11 roles × 10 views × 8 caps, editable at runtime (`rolesmatrix.js`, `console_settings.role_perms`).

Two facts that shape Phase 0: the URL prefix `/digital-console` is **hard-coded in 28 frontend files + `notify.js`, `alertReport.js`, `deploy.sh`**; and the working tree has **180 uncommitted files** — prod is ahead of git and `CHANGELOG.md` stops at 1.0.0 (22 Jul).

### 1.2 salam-dealer-ops beta (Operations Console) — the donor
Prod: same host, PM2 `ops-web` :4400 (`/apps/salam-ops`, DB `sda_ops`) and beta `opsb-*` :4500 (`/apps/salam-ops-beta`, DB `sda_ops_beta`). Sources: `nexus` (RO `nexus_reader`; `workflow_states` + `api_logs` + `staff`), `payments_v2` (**grant still blocked** — DBA ask open), Unifonic balance, CTT incidents CSV. Read model (Prisma, 14 models): `dealers`, `order_attempts` (id = nexus `workflow_state_id`, lat/lng, odb/iccid/cpe/msisdn/serviceNo/custCode/customerId, outcome, stepReached, channel `sda|epurchase|salamhome`, workflow enum incl. `salamHome*`), `api_calls`, `error_events` (25-category taxonomy), `leads`, `users`, `app_settings`, `alert_rules/_revisions/_events`, `incident_log`, `ops_docs`, `ingest_state`, `audit_log`. Size ≈ 35k lines TS (api 9.2k, ingest 6.3k, web 15.1k).

Beta features that exist today (uncommitted since 22 Aug): `B2C_ADMIN` role, `/b2c` page (Funnel / Journey 360 / Payments), `payments-db.ts`, `b2c` router (overview, funnel, journey360, paymentsHealth, paymentsSummary), PULSE→`salamhome` channel mapping, `includeConsumerDirect` filter. **Not yet built in the beta:** `b2c_*` alert metrics, salamHome step-detail (SelectODB/CheckCoverage), errors-board `salamhome` filter, payment-link tables, BSS reconciliation, Yusr for Fixed.

### 1.3 Feature map — donor → unified target

| Operations Console (beta) feature | Donor code | Unified console target | Phase |
|---|---|---|---|
| Passwordless OTP, one-session-per-user (jti), consent gate, block/attempt caps, security envelope in DB | `routers/auth.ts`, `users.ts`, `settings.ts`, `RUNBOOK-user-management.md` | **Keep mvno-console's** `otp.js`/`sessions.js`/`roles.js`; adopt three donor ideas: session `jti` (kick-out), `app_settings` security envelope → `console_settings`, consent gate. Migrate users. | 1 |
| Roles SUPER_ADMIN/ADMIN/DEALERS_ADMIN/QR_ADMIN/REPORT_ADMIN/B2C_ADMIN | `UserRole` enum | New **views** `fixed`, `maps`, `b2c`; new **roles** `fixed_ops`, `sales_ops` (= existing `report_manager` label), `b2c_admin`; matrix editable as today | 1 |
| Home KPI recap, since-last-visit, needs-attention | `Home.tsx` | `#fixed` home (`fixed.js`) + Fixed cards on the unified `#dashboard` | 1 |
| Dealers dashboard, QR dashboard, integrations health (Nafath/Semati/Manafith) | `routers/dashboards.ts`, `activity.ts` | `/api/fixed/dashboard/{dealers,qr,integrations}` via `fixed360.js` reading `sda_ops_beta` | 1 |
| Dealers map + QR map, dealer panel, roster, funnel, trace modal, saved views, Ctrl+1/2/3 | `Map/GoogleMap.tsx`, `Sidebar/DealerPanel/Roster/Funnel/TraceModal` | `#fixed-map` page (`fixedmap.js`) — Google Maps JS + MarkerClusterer from CDN, SVG fallback when `GMAPS_KEY` unset; `/api/fixed/map/{attempts,dealer,roster,funnel}` (2,000-marker cap kept) | 2 |
| Order trace (step timeline + api_calls, masked; live unmask from nexus, audited) | `routers/trace.ts`, `source-db.ts`, `journey-guide.ts` | Extend the **existing transaction timeline** (`/api/trace/:id`, `errors.js`) with a `fixed:` id space; unmask goes through the existing `unmaskPII` cap + `pii.unmask` audit | 2 |
| Live Error Control Board (severity tiles, category filter, feed, history, similar cases) | `routers/errors.ts`, `error-taxonomy.ts`, `ERROR-CONTROL-BOARD-DESIGN.md` | Existing `#troubleshoot` board gains a **segment switch** (MVNO / Fixed / All); the 25 Fixed categories are registered in `errclass.js` with Business/Technical class so the SSOT stays one | 2 |
| Alert rules manager (12 metrics, 15 built-ins, revisions, rollback, test), alert history, incidents (CTT) | `alert-engine.ts`, `routers/alerts.ts`, `incidents-import.ts` | `metrics.js` += 12 `fixed_*` metrics; `seedRules.js` += 15 `fixed_*` rules (team + segment); revisions already exist as `config-changes`; `fixed_incidents` table + importer | 3 |
| KPI digest report (inline SVG charts + coverage map), 08:00 daily | `report.ts` (1,636 lines) | `reportScheduler.js` (already 08:00/20:00 KSA) gains a Fixed section; coverage map via Static Maps `STATIC_MAPS_KEY` | 3 |
| Playbook docs (SLA/OLA/action plans, per-rule), diagrams gallery, journeys explorer | `ops_docs`, `public/playbook/*.html`, `build-journeys-explorer.mjs` | `console_docs` (also feeds Yusr KB); Fixed journeys added to `data2.js`-style Journeys Explorer with a segment filter; payments diagrams under `#topology2` | 3 |
| B2C page (Funnel / Journey 360 / Payments), payments_v2 health | `routers/b2c.ts`, `payments-db.ts`, `app/b2c` | `#b2c` page; **Journey 360 folds into Sub360 → "Customer 360"** with a Fixed tab (serviceNo / custCode / customerId lookup) | 4 |
| Users, audit, settings, profile, export CSV/JSON, role manuals in welcome mail | `users.ts`, `audit.ts`, `api/export`, `manuals.ts` | Already present in mvno-console; port the role manuals into `training/` | 1 |
| Healthcheck / sync-check CLIs | `healthcheck.ts`, `sync-check.ts` | `syncHealth.js` extended with the `sda_ops` cursor freshness; drift check reused in Phase 5 as the ingest-port oracle | 3, 5 |
| nexus + api_logs adaptive watcher, transform, taxonomy, geo, masking-at-ingest | `db-watch.ts`, `db-transform.ts`, `sink.ts`, `cities.ts` | **Phase 5 only:** `server/src/fixedIngest.js` writing `fixed_dealers`, `fixed_order_attempts`, `fixed_api_calls`, `fixed_error_events` in `unified_console` | 5 |

---

## 2 · Target architecture (end state)

```
                   ┌──────────────────────── unified-console (Express + pg, PM2 salam-unified :4700) ────────────────────────┐
 MVNO sources      │  prodSync.js ─► selfcare replica ─┐                                                                      │
  172.31.43.123 ──►│  upg / dms(Clara) / osb / apigw   ├─► metrics.js (mvno_* + fixed_*) ─► alertRunner · correlation · anomaly │
                   │                                   │      │                                                               │
 Fixed sources     │  fixedIngest.js ─► fixed_* tables ┘      ├─► errors.js (segment) · sub360 (Customer 360) · analytics · SLO │
  nexus (RO) ─────►│  payments_v2 (RO)                        └─► notify / chatops / escalation / ServiceNow / tickets / Yusr   │
                   │                                                                                                          │
                   │  one DB: unified_console  · one role matrix · one audit_log · one deploy.sh                                │
                   └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 nginx 172.31.38.115:  /unified-console/ → :4700     (/digital-console/ → :4600 and /operations-console/ → :4400 until cutover, then 301)
```

Stage-1 differs only in the Fixed data path: `fixed360.js` reads `sda_ops_beta` through `OPS_DATABASE_URL` while `opsb-ingest-watch` keeps writing it.

### 2.1 Namespacing contract (enforced from Phase 1)

| Artefact | MVNO (existing) | Fixed (new) | Shared (never duplicated) |
|---|---|---|---|
| Console tables | `onboarding_orders`… (replica) | `fixed_order_attempts`, `fixed_dealers`, `fixed_api_calls`, `fixed_error_events`, `fixed_incidents`, `fixed_ingest_state` | `alerts`, `alert_rules`, `audit_log`, `console_users`, `console_settings`, `console_docs`, `console_tickets`, `analytics_dashboards`, `slo_targets` |
| Domain modules | `dealer360.js`, `errors.js` | `fixed360.js`, `fixedMap.js`, `fixedTrace.js`, `fixedErrors.js`, `fixedIngest.js`, `b2c.js` | `roles.js`, `alertRunner.js`, `notify.js`, `chatops.js`, `assist.js` |
| Routes | `/api/dms/…`, `/api/errors/…` | `/api/fixed/…`, `/api/b2c/…` | `/api/alerts`, `/api/trace/:id` (id prefix `fixed:`), `/api/subscriber` (segment param) |
| Metric / rule keys | `payment_fail_rate` | `fixed_nafath_fail_rate`, `fixed_conversion_drop_pp`… | rule fields gain `segment` |
| Views / hash routes | `dms` / `#dms` | `fixed` / `#fixed`, `maps` / `#fixed-map`, `b2c` / `#b2c` | `alerts`, `errors`, `settings`, `users` |
| Env vars | `DMS_DB_URL`, `UPG_DATABASE_URL` | `OPS_DATABASE_URL` (stage 1), `NEXUS_DATABASE_URL`, `PAYMENTS_DATABASE_URL`, `FIXED_ENABLED`, `GMAPS_KEY`, `STATIC_MAPS_KEY` | `CONSOLE_DATABASE_URL`, `CONSOLE_BASE_PATH` |

Rule of thumb from the runbook still applies: every Fixed pool is optional and env-gated — absent env means the feature is simply off, never a 500.

### 2.2 Two conventions that must be reconciled once, in Phase 1
- **Time:** both stacks pin `TZ=UTC`, but `sda_ops` columns are `timestamptz` (migrated 30 Jun) while the selfcare replica stores naive UTC. `fixed360.js` reads timestamptz and converts to KSA in the same helper the rest of the console uses (`ksatime.js`); never mix the two in one query.
- **PII:** dealer-ops masks **at ingest** (`maskBody` by key name) and unmasks by live nexus fetch; mvno-console masks **at response** (`roles.maskDeep`) and unmasks under the `unmaskPII` cap. Unified rule: Fixed data stays masked-at-rest (it already is in `sda_ops`); unmask is a live nexus lookup behind `requireCap('unmaskPII')` + `audit('pii.unmask')`. Same UX, one audit trail.

---

## 3 · Phases

Each phase ends with a deploy to `/unified-console`, a CHANGELOG entry and a version tag (`VERSIONING.md` discipline restored). Nothing in Phases 1–4 touches `/digital-console` or `/operations-console`.

### Phase 0 — Fork-in-place and stand up the third URL (≈ 1 week)
1. **Commit what prod actually runs.** In mvno-console: commit the 180 modified files as `v1.1.0: digital-console as deployed 2026-09-04`, tag it, and create branch `release/digital-console` (hotfix-only). In salam-dealer-ops: commit the beta work as `v1.1.0-beta` so the donor is frozen and diffable. Move `.env.prod-sync` and the passwords in `DEPLOY-PROD-SDA-OPS.md` out of git in the same commit.
2. **Copy the project** to `…/Claude/Projects/Operations Console/unified-console` (keep the `.git` history — it is a copy of the repo, not a re-init). `VERSION` → `2.0.0-alpha`, `main` = unified line.
3. **Parameterise the base path.** Replace the 28 frontend occurrences of `location.pathname.startsWith("/digital-console") ? "/digital-console" : ""` with one `window.CONSOLE_BASE` computed in `app.js` (first path segment when it matches `/(digital|unified)-console`), served value also in `/api/version`. `notify.js`/`alertReport.js` read `CONSOLE_PUBLIC_URL` from env. `deploy.sh` takes `--target unified` (dir `/apps/unified`, PM2 `salam-unified`, port 4700).
4. **Database:** `CREATE DATABASE unified_console` on 172.31.15.121; run `init.js` (schema + seed rules); point `SOURCE_DATABASE_URL` at the *same* selfcare replica (read-only — two consumers is safe; only `indexSource.js` writes DDL and it is idempotent). Copy `console_users`, `console_settings`, `analytics_dashboards`, `slo_targets`, `console_docs` from `mvno_console` with a one-off `pg_dump -t` so users keep their roles and dashboards.
5. **nginx** on 115: `location /unified-console/ { proxy_pass http://172.31.38.152:4700/; }` + firewalld rich rule; `CONSOLE_BASE_PATH=/unified-console`.
6. Feature flag `FIXED_ENABLED=false` at first boot. **Gate:** unified-console == digital-console feature-for-feature, same users log in, alerts fire identically for 48 h (compare `alerts` tables).

### Phase 1 — Fixed read path, roles, home dashboards (≈ 1–2 weeks)
1. `db.js`: add optional pool `db.ops` (`OPS_DATABASE_URL` → `sda_ops_beta`, RO role `sda_ops_ro`, max 3, statement_timeout 15 s) and `db.nexus` (`NEXUS_DATABASE_URL`, RO `nexus_reader`, for live unmask only).
2. `fixed360.js`: port `dashboards.summary/qr/integrations`, `activity.aggregate/funnel/dealerSummary`, `dealers.search/list`, `referrals.search/summary` — same SQL, `pg` instead of Prisma, the shared filter schema (`filters.ts`) becomes one `parseFixedFilters(req)` helper with the `scopeFiltersToRole` channel pinning.
3. Routes `/api/fixed/*` mounted from a new `server/src/routes/fixed.js` (start the split of `api.js` here; do not refactor the MVNO routes yet).
4. `roles.js`: views `fixed`, `maps`, `b2c`; roles `fixed_ops` (views fixed+maps+errors+alerts), `sales_ops` (fixed+maps+analytics, no PII), `b2c_admin` (b2c+fixed). Migration script `server/scripts/importOpsUsers.js`: `sda_ops.users` → `console_users` with role mapping (SUPER_ADMIN→super_admin, ADMIN→admin, DEALERS_ADMIN/QR_ADMIN→fixed_ops, REPORT_ADMIN→sales_ops, B2C_ADMIN→b2c_admin), `tags` copied, `mail_report`/`mail_alert` copied. Adopt `jti` one-session and the consent gate from `RUNBOOK-user-management.md` §0 (small, well-specified).
5. Frontend `fixed.js` + `#fixed` route + nav tab (role-gated) rendering: KPI recap, needs-attention, dealers dashboard, QR dashboard, integration tiles, export CSV/JSON via existing `xlsxout.js`. Unified `#dashboard` gets a "Fixed" card row when `FIXED_ENABLED`.
6. **Gate:** numbers on `#fixed` match `/operations-console-beta` dashboards for the same window (screenshot pair in `docs/PARITY-P1.md`).

### Phase 2 — Maps, order trace, error board segment (≈ 1–2 weeks)
1. `fixedMap.js` + `/api/fixed/map/attempts` (2,000 newest with coords, filters), `/dealer/:id`, `/roster`, `/funnel`. Frontend `fixedmap.js`: Google Maps JS + `@googlemaps/markerclusterer` from CDN (browser side has internet; the server does not need it), SVG-KSA fallback when key absent, sidebar filters shared with `#fixed`, saved views in `console_users.dashboard`, Ctrl+1/2/3 shortcuts, trace modal. Follow `dealers-map-runbook.md` §3–5 for the marker/panel contract.
2. `fixedTrace.js`: `/api/trace/fixed:<workflow_state_id>` returns the step timeline (`stepDetail` JSON + `api_calls`) in the **same shape** the MVNO timeline drawer already renders; `journey-guide.ts` step explanations become `fixedJourneyGuide.js`. Unmask = live nexus lookup, `unmaskPII` cap, audited.
3. `fixedErrors.js`: `/api/fixed/errors/{summary,feed,history,similar}` over `error_events`; `errclass.js` registers the 25 Fixed categories with their Business/Technical class; `#troubleshoot` gets the segment switch and Fixed severity tiles (P0–P4 table from `ERROR-CONTROL-BOARD-DESIGN.md`). `ackErrors` cap applies.
4. **Gate:** an L1 can resolve a Fixed ODB/ICCID/order search end-to-end on `/unified-console` without opening `/operations-console`.

### Phase 3 — Alerts, report, playbooks, incidents (≈ 1–2 weeks)
1. `metrics.js` += `fixed_error_p0p1_categories, fixed_timeout_dealers, fixed_nafath_fail_rate, fixed_semati_fail_rate, fixed_conversion_drop_pp, fixed_manafith_deny_rate, fixed_workhours_activity_ratio, fixed_offhours_sda_attempts, fixed_dealer_stagnation_count, fixed_incident_sla_breach_rate, fixed_incident_ticket_count, fixed_sms_balance` (compute against `db.ops`; `sourceTables` prefixed). `seedRules.js` += the 15 built-ins with `segment='fixed'`, teams mapped to the console's existing team tags (SALES_OPS→sales, OSS_OPS→oss, …). Alert history, ack/assign/snooze, ChatOps, escalation ladder, ServiceNow correlation (`SN_GROUP` per segment) all come for free.
2. `alert_rules` + `alerts` + `console_tickets` get a `segment` column (default `mvno`); alert pages get a segment filter.
3. `reportScheduler.js`: Fixed section (KPIs, funnel, top dealers, coverage map via Static Maps) reusing `report.ts` chart helpers ported to `pdfout.js`/inline SVG.
4. `ops_docs` → `console_docs` (kind SLA/OLA/ACTION_PLAN/PLAYBOOK, `relatedRuleKey`) so Guided Response on a Fixed alert shows the Fixed playbook and Yusr indexes it. `public/playbook/*.html` (payments flows/journey/topology, journeys explorer) under `#topology2` gallery; Fixed journeys as `data2.js` entries with `segment:'fixed'`.
5. `fixed_incidents` + `importIncidents.js` (CTT CSV, 05:00 cron via the in-process scheduler, no PM2 cron).
6. **Gate:** for one week both alert engines run; every alert fired by `opsb-alerts` has a matching `fixed_*` alert in unified (diff script in `tools/`). Then `opsb-alerts` mail goes to Yosri only.

### Phase 4 — B2C and Customer 360 (≈ 1–2 weeks; needs the payments_v2 grant)
1. Chase the DBA ask first (RO login on 172.31.15.121 with SELECT on `payments_v2.applications/invoices/payments`) — it blocks half of this phase.
2. `b2c.js`: overview, funnel (STEP_ORDER per `salamHome*` workflow), paymentsHealth, paymentsSummary (halalas, PAID/CAPTURED, 1-SAR test exclusion, `referenceId='undefined'` = paid-no-order). `#b2c` page.
3. **Customer 360:** `sub360.js` becomes segment-aware — lookup by mobile/ID (MVNO, as today) or serviceNo/custCode/customerId/orderNumber (Fixed: attempts + payments + error events + incidents). One screen for call-center.
4. Close the beta's own gaps here, not in dealer-ops: `fixed_b2c_paid_no_order`, `fixed_b2c_payment_fail_rate`, `fixed_b2c_freeze_spike`, `fixed_b2c_5g_relocation_zero_payment` metrics + rules; salamHome step-detail (SelectODB/CheckCoverage); `salamhome` channel filter on the error board. Record the 9 unsigned decisions from `docs/B2C-DEFINITIONS.md` as signed in `docs/B2C-DEFINITIONS.md` of the unified repo.
5. **Gate:** `/operations-console-beta` has no screen the unified console lacks → **beta instance retired** (PM2 `opsb-web` stopped; `opsb-ingest-watch` keeps running for stage-1 data).

### Phase 5 — Ingest convergence: two DBs → one (≈ 2 weeks)
1. `fixedIngest.js`: port `db-watch.ts` (keyset cursor on `updated_at,id`, adaptive 10 s / 60 s poll, KSA active hours, `DB_PAGE_SIZE` — remember the OOM lesson), `db-transform.ts` (`mapWorkflowId`, `mapChannel`, `outcomeFromStep`, Nafath/Semati/Manafith outcomes, identifiers, `coordsOf` + nearest city, `stepDetailFromContext`, `classifyStateErrors`, `maskBody`) and `sink.ts` (batched upserts) into Node/pg. Tables `fixed_dealers`, `fixed_order_attempts`, `fixed_api_calls`, `fixed_error_events`, `fixed_ingest_state` created by `init.js` (DDL from `schema.prisma`, plus the 16 `migrations/*.sql` already folded in). Runs in-process at boot like `dmsJourneys.js`, gated by `NEXUS_DATABASE_URL`.
2. Backfill from `--since 2026-01-01`, then run **both** writers for ≥ 7 days. Port `sync-check.ts` as `tools/fixedDrift.js`: per-day counts and per-id field diff `sda_ops_beta.order_attempts` vs `unified_console.fixed_order_attempts`. Accept at zero drift over 3 consecutive days.
3. Flip `fixed360.js`/`fixedMap.js`/`fixedErrors.js`/metrics from `db.ops` to `db.console` (a single `FIXED_SOURCE=console|ops` switch, so rollback is an env change).
4. Stop `opsb-ingest-watch`, `ops-ingest-watch`; keep `sda_ops`, `sda_ops_beta` read-only for 30 days, then drop. `OPS_DATABASE_URL` removed. **One DB.**
5. Carry the 5 Sep lesson into `fixed_order_attempts`: `odb` is a list in some nexus contexts (6.5 KB seen) — store `odb` truncated to the first plate + `odb_count`, and index with `WHERE length(odb) < 1000`. Until then, apply the same partial index to `public.order_attempts_odb_idx` on prod (DBA change) so the prod watcher cannot hit the beta's 22 Aug failure.

### Phase 6 — Cutover and retirement (≈ 1 week + 30-day watch)
1. Announce to L1/L2 (reuse the L1 session mail format); role manuals regenerated for the unified nav.
2. nginx: `/operations-console/` → `301 /unified-console/#fixed`; `/digital-console/` → `301 /unified-console/`. Keep the PM2 apps `salam-console`, `ops-web` stopped-but-present for 30 days, then remove; `mvno_console` dropped after `unified_console` has 30 days of its own alert history.
3. `release/digital-console` branch archived; `VERSION` = `2.0.0`.

### Phase 7 — Extend MVNO-grade capabilities to Fixed (continuous, after cutover)
This is the payoff the convergence was for; each item is a small, independent release:
- **Analytics engine:** Fixed datasets (`fixed_orders`, `fixed_errors`, `fixed_payments`, `fixed_relocation`) in `analytics.js` whitelist + presets (Fixed Payments, New Connection Trends, Integration Health, Relocation).
- **SLO / error budgets** per Fixed journey; **anomaly baselines** (168-bucket hour-of-week) on `fixed_*` metrics; **root-cause correlation** rules for Nafath/Semati outages that already page MVNO (one provider outage → one alert, both segments listed).
- **FTTH new-connection & relocation observability (D7):** metrics `fixed_relocation_odb_stall_rate`, `fixed_relocation_funnel_drop`, `fixed_feasibility_fail_rate`, `fixed_appointment_fail_rate`, `fixed_yakeen_fail_rate`, `fixed_provision_no_order`; a Relocation funnel panel on `#fixed`; ODB/feasibility step detail in the trace; the `Relocation_*` analyses from Aug become live panels instead of xlsx.
- **Fixed inventory (runbook §2):** probe 172.31.38.145 and the Fixed OSS/BSS logs recorded in `OSS_BSS_API_Report_2026-09-04.pdf`; where a source proves alive, add it as an env-gated pool (`FIXED_OSS_URL`…) — same seven-step spine.
- **Yusr** intents for Fixed customers/alerts; KB = the ported playbooks.
- **Sub360 → Customer 360** ships one lookup box for both businesses (call-center role).

---

## 4 · Timeline at part-time pace

| Phase | Effort | Calendar (evenings/weekends) | Exit gate |
|---|---|---|---|
| 0 Fork + third URL | ~6 sessions | Weeks 1 | unified == digital-console, 48 h alert parity |
| 1 Read path + roles + dashboards | ~8 sessions | Weeks 2–3 | dashboard parity with beta |
| 2 Maps + trace + error board | ~8 sessions | Weeks 4–5 | L1 Fixed case solved on unified only |
| 3 Alerts + report + playbooks | ~8 sessions | Weeks 6–7 | 1-week alert diff clean |
| 4 B2C + Customer 360 | ~6 sessions (+ DBA wait) | Weeks 8–9 | beta instance retired |
| 5 Ingest port, one DB | ~10 sessions | Weeks 10–12 | 3 days zero drift |
| 6 Cutover | ~3 sessions + 30-day watch | Week 13 | old URLs 301, PM2 apps removed |
| 7 Extend | rolling | Week 14 → | per-release |

About one quarter to a single console, three months of which the old consoles are untouched.

---

## 5 · Risks and how the plan absorbs them

| Risk | Mitigation built into the plan |
|---|---|
| Two ingest writers drifting during Phase 5 | Read-only reference DB kept; `fixedDrift.js` oracle; `FIXED_SOURCE` env switch for instant rollback |
| Metric/rule key collision silently firing an MVNO P1 on Fixed data | `fixed_` prefix mandatory; `metrics.js` boot-time assertion that no key is registered twice; `segment` on rules |
| `api.js` monolith grows past 7k lines | Fixed routes live in `server/src/routes/fixed.js` from Phase 1; MVNO split is optional later |
| Host 152 has no internet | Vanilla JS: Maps/clusterer are loaded by the *browser*; nothing new to install server-side; deploy remains tar+scp |
| PII leak through a Fixed panel | Data masked at rest in `sda_ops`/`fixed_*`; unmask only via cap + audit; `maskDeep` still applied on every response |
| payments_v2 grant never lands | Phase 4 items 2–4 degrade to "not configured" (env-gated pool); everything else proceeds |
| Users confused by three consoles | Phases 1–5 are invisible to L1 (unified is opt-in for testers); one announcement at cutover; 301s keep old bookmarks working |
| Versioning lapse repeats | Phase 0 step 1 restores tags; every phase ends with a CHANGELOG entry (`VERSIONING.md`) |
| Credentials in git (`.env.prod-sync`, deploy docs) | Removed in the Phase 0 freeze commit; `.env` files stay on 152 only |
| Beta ingester (`opsb-ingest-watch`) crash-loops and orphans Prisma query-engine children, each holding a `sda_ops_beta` connection until the role's 20-cap is hit (root cause of the 22 Aug outage; found again 5 Sep with 34 orphans) | Short term: `DB_WATCH_API_LOGS=0`, kill `ppid 1` engines under `/apps/salam-ops-beta`; permanent: Phase 5 replaces it with the in-process Node/pg ingester (no child engine) |

---

## 6 · Brief for the first Claude Code session (Phase 0)

Paste this as the opening message in the `unified-console` repo:

> Working in `unified-console` (copy of mvno-console v1.1.0). Read `docs/UNIFIED-CONSOLE-CONVERGENCE-PLAN.md` §0, §2.1 and §3 Phase 0. Tasks, in order: (1) introduce `window.CONSOLE_BASE` in `app.js` and replace every `"/digital-console"` literal in the 28 root JS files with it — grep to prove zero remain; (2) `notify.js` and `alertReport.js` read `CONSOLE_PUBLIC_URL`; (3) `deploy152/deploy.sh --target unified` → `/apps/unified`, PM2 `salam-unified`, port 4700; add `ecosystem.unified.config.js`; (4) `server/src/db.js`: optional `ops` and `nexus` pools, env-gated like `upg`; (5) `FIXED_ENABLED` flag read by `roles.js` to hide the `fixed`/`maps`/`b2c` views when false; (6) bump `VERSION` to `2.0.0-alpha.1` and add the CHANGELOG entry. Do not touch metrics, rules or any MVNO page. `node --check` everything; no build step exists.

---

## 7 · Reference — the two donors' facts used above
- mvno-console: `server/src/db.js` pools · `roles.js` (11 roles / 10 views / 8 caps) · `metrics.js` (49) · `seedRules.js` (62) · `server/db/schema.sql` (35 tables) · `router.js` ROUTES/VIEW_REQ · `deploy152/deploy.sh` · `ecosystem.prod.config.js` (`salam-console`, :4600) · `api.js:1512` `GMAPS_KEY`.
- salam-dealer-ops: `packages/db/prisma/schema.prisma` (14 models, `Workflow` incl. `salamHome*`) · `packages/api/src/routers/{auth,users,settings,dealers,activity,dashboards,referrals,trace,errors,alerts,audit,report,b2c}.ts` · `alert-engine.ts` (12 metrics / 15 rules) · `report.ts` · `packages/ingest/src/{db-watch,db-transform,sink,error-taxonomy,cities}.ts` · `apps/web/src/app/{page,errors,alerts,docs,diagrams,b2c,report,users,audit,settings}` · `ecosystem.prod.config.js` (`ops-web` :4400, `opsb-*` :4500) · sibling runbooks `RUNBOOK-b2c-on-salam-ops.md`, `RUNBOOK-user-management.md`, `dealers-map-runbook.md`.
