# Changelog

All notable changes to the Salam MVNO Digital Console are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/); this project uses [SemVer](https://semver.org/).

## [2.0.0-alpha.2] — 2026-09-05 — Phase 1 (first cut): Fixed tab + product name
### Added
- **Fixed tab** (`#fixed`, view `fixed`, `fixed.js`): freshness strip (ingest cursor / watcher lag), KPIs (attempts,
  completed, conversion, BSS orders, active dealers, avg time), outcome mix + per-day bars, by workflow, by channel,
  Nafath outcomes, Manafith denials, regions, top dealers, error categories, Salam Home app (B2C) journeys,
  recent attempts with find (ODB / order / service / ICCID / mobile). Channel + range filters persisted.
- `server/src/fixed360.js` + routes `/api/fixed/{summary,b2c,attempts,dealers,errors}` — SQL ported 1:1 from
  salam-dealer-ops (dashboards/activity/errors routers) over `sda_ops.beta`; consumer-direct e-purchase excluded by
  default like the beta; identifiers returned as last digits only. All routes gated by `requireView('fixed')`;
  searches audited as `fixed.search`.
- `ROLLUP_BACKFILL_DAYS`, `PG_APP_NAME`, `APIGW_PROBE_AUTO=0` for local runs; tunnel forwards UPG :5434.
### Changed
- Product name is **Salam Operations Console** (header chrome, login, title, e-mails, i18n en/ar).
- `roPool()` honours Prisma-style `?schema=` (search_path) and strips Prisma-only params — required for `sda_ops.beta`.

## [2.0.0-alpha.1] — 2026-09-05 — Unified Console, Phase 0
The Digital Console codebase becomes the **Salam Unified Console** (Fixed + MVNO). Plan: `docs/UNIFIED-CONSOLE-CONVERGENCE-PLAN.md`.
The frozen digital-console line is tag `v1.1.0-digital-console-freeze` / branch `release/digital-console`.

### Added
- `base.js`: single source of truth for the URL prefix (`window.CONSOLE_BASE`, `window.API_BASE`); works under
  `/unified-console`, `/digital-console` or root (local). Replaced the hard-coded `/digital-console` in 28 files.
- `server/src/db.js`: optional read-only pools `ops` (sda_ops_beta), `nexus`, `payments` (payments_v2) via
  `OPS_/NEXUS_/PAYMENTS_DATABASE_URL`; distinct `application_name`s for the DBA.
- `server/src/fixed.js` + `GET /api/fixed/ping`: Fixed-side connectivity/status probe; `/api/health` and
  `/api/version` now report the Fixed pools, `FIXED_ENABLED`, and the public URL.
- `roles.js`: views `fixed`, `maps`, `b2c` exist only when `FIXED_ENABLED=1` (super_admin + admin get them).
- Local dev kit: `docker-compose.unified.yml` (local `unified_console` DB on :5700), `tools/local/tunnel-152.sh`
  (152 as passerelle to 172.31.15.121 and friends), `tools/local/env-from-152.sh` (builds `.env.local` from the
  two prod env files, hosts rewritten to the tunnel, prod-only side effects dropped), `tools/local/dev.sh`.
- `deploy152/deploy.sh` `DEPLOY_TARGET=unified|digital`; `ecosystem.prod.config.js` reads `PM2_NAME`/`PORT` from `.env`.
- `CLAUDE.md` working notes for the build sessions.

### Changed
- Product name in UI/e-mails: "Salam Unified Console"; e-mail links use `CONSOLE_PUBLIC_URL`
  (default `https://salam.sa/unified-console/`).
- `VERSION` 2.0.0-alpha.1; `server/package.json` renamed `unified-console-server`.

## [1.1.0] — 2026-09-04
Freeze of the Digital Console exactly as deployed on 152 (180 files changed since 1.0.0; see git history).

## [1.0.0] — 2026-07-22
Initial import of the Salam MVNO Digital Console (NOC / ops dashboard for the MVNO).

### Dashboard & journeys
- Real-time NOC status banner, journey-health strip, and live order-status flow tree (New SIM / MNP → eligibility → payment → activation/delivery), reconciled to the Orders KPI.
- Configurable home sections (per-user pick + reorder), date-range filter, role presets.

### Alerts engine
- Metric registry + rule catalog (P1–P3) evaluated over the prod replica; seasonal-baseline anomaly detection.
- Root-cause correlation / suppression: provider outages page once (root) with symptoms grouped, not a storm.
- Guided Response on alerts (runbook + notify on-call + related tickets), runbooks on all rules.
- ChatOps notifications (Teams/Slack/WhatsApp/SMS) + on-call escalation ladder.

### Providers & troubleshooting
- Semati/CITC provider-outage detection (715 / transport / flapping / zero-success / CITC composite) + synthetic canary.
- Troubleshoot error control board: per-category tiles, code·message breakdowns (Semati / Nafath / Payment), per-category shareable URLs, transaction timeline.
- Payments RCA reference + UPG correlation; Samsung Pay proactive detection; decline code·message drill-down.

### Growth analytics
- Resellers (flow_type funnel + tygo/soob channel breakdown), Campaigns (UTM source/medium/campaign with humanized labels), and an acquisition × distribution correlation matrix. Home summary cards + full Growth dashboard.

### Data trust & ops
- Loud replica-staleness banner, Settings health self-check, in-container prod-sync scheduler.
- ServiceNow read-only ticket correlation; Yusr (يُسر) local-LLM assistant.

[1.0.0]: https://github.com/yyahmed82/salam-mvno-console/releases/tag/v1.0.0
