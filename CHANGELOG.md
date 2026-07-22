# Changelog

All notable changes to the Salam MVNO Digital Console are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/); this project uses [SemVer](https://semver.org/).

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
