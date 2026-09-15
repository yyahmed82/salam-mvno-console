# Unified Console Change Runbook: OSB, SLO, Vendor SLA Governance

Generated: 2026-09-15, Asia/Riyadh

Target application: Salam Unified Console
Target host: server 152, `/apps/unified`
Public URL: `https://salam.sa/unified-console/`
PM2 process: `salam-unified`
Port: `4701`
Current local release marker after this work: `2.0.0-alpha.37`

## 1. Purpose

This runbook documents the work completed in the recent change set and how to operate it safely:

- OSB/BSS archive import and correlation.
- OSB details in Monitoring, Mobile dashboard, Customer 360 and Yusr.
- Super Admin SLO target definition page for Fixed and MVNO.
- Home and Fixed CTA drill-down fixes.
- Vendor and contract control center for Sigma and TCS.
- Contract SLA reminders/escalation per vendor contract.
- Safe CLI mail preview for vendor SLA reminders.
- Phase 4 evidence connectors and phase 5 operational rollout.
- Candidate-only penalty model for vendor SLA governance.

The goal is to make the console more useful for L1, L2, call center, vendor governance and management without creating accidental production side effects.

## 2. Safety Boundaries

These changes are designed to be safe in production:

- No existing Digital Console or Operations Console process is modified.
- Unified Console stays isolated in `/apps/unified`, PM2 `salam-unified`, port `4701`.
- Vendor contract data is stored in `console_settings.vendor_contracts`, with no schema migration.
- SLO definitions are stored in `console_settings.slo_config` and mirrored to legacy `slo_targets` for existing consumers.
- Vendor SLA reminders/escalation are reference/configuration only unless future enforcement is explicitly enabled.
- Vendor SLA test mail requires one explicit `--to` address and ignores configured team/management recipients.
- Penalty output is candidate-only. It is not an automatic deduction, invoice credit, vendor charge, or live enforcement workflow.
- OSB correlation labels must stay honest: exact when ECID or identifier evidence exists, probable when only subscriber and time-window matching is possible.

## 3. What Was Done

### 3.1 OSB/BSS Archive Import And Correlation

Files:

- `server/src/osbArchive.js`
- `server/src/osbResolve.js`
- `monitoring.js`
- `home.js`
- `sub360.js`
- `server/src/assist.js`
- `server/src/api.js`

What changed:

- Added parsing/import of OSB SFTP archive files from server 152 upload roots such as `/sftp_data/uploads`.
- Added archive batch tracking with checksum status, imported row counts and covered time window.
- Added OSB access events and pipeline events into the console database.
- Added event de-duplication with stable hashes for payload rows.
- Normalized MSISDN identifiers in `05...`, `5...` and `9665...` formats.
- Added ECID-based joins between OSB access rows and OSB pipeline payload rows.
- Added OSB business stories:
  - recharge/voucher
  - MNP
  - onboarding/inventory
  - Remedy tickets
  - billing/invoices
  - SADAD/payment notifications
  - Nafath
  - balance/bundle reads
  - plan options
  - profile reads

Important correlation rule:

- OSB access row to OSB payload row is exact only when both carry the same ECID.
- OSB payload to selected subscriber is high-confidence when the payload contains the MSISDN or normalized identifier.
- Digital/APIGW to OSB exact trace is not available from the current archive unless a shared trace id appears. Use selected subscriber plus timestamp as probable correlation.

### 3.2 Monitoring OSB Section

Files:

- `monitoring.js`
- `server/src/api.js`
- `server/src/osbArchive.js`

What changed:

- Monitoring tab has `OSB - ORACLE BUS` from imported archive data.
- Date filters are applied to OSB archive results.
- URI rows are clickable.
- Drill-down shows:
  - sampled OSB access rows
  - ECID
  - same-ECID OSB hops
  - joined pipeline payload snippets
  - archive batch
  - top MSISDN query-string hits
- The panel shows the archive coverage window and explicitly states when the selected date range is outside imported data.

### 3.3 Mobile Dashboard BSS Findings

Files:

- `home.js`
- `server/src/api.js`
- `server/src/osbArchive.js`

What changed:

- Mobile dashboard now includes BSS findings from OSB / Oracle Bus archive data.
- It shows OSB transactions, pipeline records, faults and business-story cards.
- The card is designed for management and L2 summary use, not raw payload investigation.

### 3.4 Customer 360 And Yusr OSB Context

Files:

- `sub360.js`
- `server/src/api.js`
- `server/src/assist.js`
- `server/src/osbResolve.js`
- `server/src/osbArchive.js`

What changed:

- Customer 360 can show an OSB/BSS-side story for the selected customer line.
- Yusr receives compact OSB archive evidence for subscriber lookups.
- The summary separates:
  - pipeline payload records
  - same-ECID backend hops
  - direct backend hits by query MSISDN
  - faults
  - archive coverage window
  - confidence/correlation note

Operator meaning:

- If OSB evidence exists, L1/L2 can confirm the selected customer reached a BSS/OSB backend path during the imported window.
- If no OSB evidence exists, do not conclude "BSS was never called". It may mean the archive window does not cover the journey, payload did not carry the identifier, or the call did not reach OSB.

### 3.5 Super Admin SLO Definitions

Files:

- `slo.js`
- `server/src/slo.js`
- `server/src/api.js`
- `index.html`
- `settingsmenu.js`
- `router.js`
- `ops.js`

What changed:

- Added dedicated Super Admin page `#slo-settings`.
- Moved SLO target editing out of the live SLA page.
- SLO definitions support Fixed and MVNO labels.
- Super Admin can define:
  - SLO enabled/disabled
  - target value
  - warning band
  - window days
  - unit
  - met/near/breached operator messages
- Existing live SLA/dashboard cards read from the shared SLO config.

Safety:

- Access is Super Admin only.
- Changes are audited.
- Reset-to-defaults exists.
- Existing dashboard consumers continue using compatible target rows.

### 3.6 Home And Fixed CTA Drill-Down Fixes

Files:

- `home.js`
- `fixed.js`
- `fixed-dash.js`
- `fixed-errors.js`
- `landing.js`
- `router.js`
- `index.html`

What changed:

- Home Fixed CTA tiles now open the correct Fixed page and tab.
- Fixed hash routes now activate the destination view instead of only changing the nav chip.
- Fixed drill-down filters are consumed by the correct page.
- `Recent attempts` was moved to the end of the Fixed Operations Dashboard page.

Expected behavior:

- Fixed completed orders -> Fixed Operations Dashboard with matching completed/order filters.
- Nafath failures -> Fixed map / dashboard with failed-Nafath and 5G filters.
- Open errors -> Fixed troubleshoot/errors with the exact category and 24h/open window.

### 3.7 Vendors And Contracts Page

Files:

- `server/src/vendorContracts.js`
- `vendor-contracts.js`
- `server/src/api.js`
- `index.html`
- `settingsmenu.js`
- `router.js`
- `ops.js`

What changed:

- Added Super Admin-only page `#vendor-contracts`.
- Seeded vendors:
  - Sigma
  - TCS
- Seeded contract references:
  - Sigma signed contract reference
  - TCS MVNO IT Operations Managed Services proposal/reference
- Added tabs:
  - Obligations
  - Evidence connectors
  - Reminders & escalation
  - Operational rollout
  - Penalty model
  - Contracts
  - Assignments
  - Advanced JSON
- Added responsive and dark-mode safe UI.

Important note:

The contract PDFs were used as reference material only. Exact legal penalty clauses, fee bases, exclusions and commercial terms must be confirmed by the contract owner before formal use.

### 3.8 Contract SLA Reminders And Escalation

Files:

- `server/src/vendorContracts.js`
- `vendor-contracts.js`

What changed:

- Added contract-level escalation flow for each vendor contract.
- Each SLA obligation has configurable:
  - enabled/on
  - breach/escalation message
  - P1/P2/P3/P4 reminder 1 timing
  - reminder 2 timing
  - reminder 3 timing
  - repeat R3 cadence
  - inform-management flag
- Each contract has:
  - owner group
  - management recipients
  - mail/Teams/WhatsApp/management-mail channel flags

Management recipient meaning:

- The field `Management recipients` is the list used when a row's `Inform management` flag is enabled.
- Management mail is separate from team recipients.
- If the management list is empty, the page warns that management is not configured.

### 3.9 Safe Vendor SLA Mail Preview

Files:

- `server/src/vendorContractMail.js`
- `server/src/cli.js`

What changed:

- Added CLI command:

```bash
node src/cli.js vendor-sla-mail-test --to <email> [--contract <id>] [--severity P1] [--step r1] [--matrix] [--all-items] [--dry-run] [--limit 8]
```

Safety:

- The command requires exactly one explicit `--to` email.
- It sends only to that address.
- It ignores all configured team and management recipients.
- It allows `salam.sa` and `salammobile.sa` by default.
- External recipient testing requires explicit env override and should not be used for production tests.

### 3.10 Phase 4 Evidence Connectors

Files:

- `server/src/vendorContracts.js`
- `vendor-contracts.js`

What changed:

- Phase 4 is now marked ready.
- Each SLA/SLO obligation has an evidence mapping:
  - source connectors
  - primary source
  - metric
  - calculation
  - readiness
  - confidence
  - controls
  - next step
- Evidence sources are classified as live, partial or planned.

Evidence source examples:

- `ack_sla`: live
- `alerts`: live
- `rollups`: live
- `apigw`: partial
- `osb_archive`: partial
- `itsm`: planned
- `vendor_reports`: planned

### 3.11 Phase 5 Operational Rollout

Files:

- `server/src/vendorContracts.js`
- `vendor-contracts.js`

What changed:

- Phase 5 is now marked ready.
- Rollout surfaces are mapped:
  - SLA dashboard vendor health
  - Yusr support answer context
  - incident details and escalation trail
  - Customer 360 / subscriber story
  - Monitoring drill-downs
  - monthly governance pack
  - CLI test mail preview

Control:

- These are informational rollout surfaces.
- Enforcement, penalties and real vendor paging remain locked until UAT, evidence confidence review and vendor-owner sign-off.

### 3.12 Candidate Penalty Model

Files:

- `server/src/vendorContracts.js`
- `vendor-contracts.js`
- `server/src/api.js`
- `VERSION`
- `CHANGELOG.md`
- `index.html`

What changed:

- Added `Penalty model` tab.
- Added candidate-only penalty rules for each seeded Sigma/TCS obligation.
- Added contract inputs:
  - eligible monthly fee in SAR
  - monthly cap percent
  - penalty mode
- Added rule inputs:
  - enabled/on
  - flat weight percent or severity weights
  - required evidence
  - exclusions
  - approval status
  - notes
- Added estimated candidate exposure and capped exposure.

Penalty formula:

```text
candidate_penalty = eligible_monthly_fee * applicable_weight_percent * breach_factor
monthly_total = min(sum(candidate_penalties), eligible_monthly_fee * contract_cap_percent)
```

Governance rule:

- Treat all outputs as candidate estimates.
- Do not use for invoice deduction until evidence, exclusions, SLA owner, vendor owner, commercial/legal owner and contract clause validation are complete.

## 4. Data And Configuration

### 4.1 Console Settings

Vendor contract governance:

```text
console_settings.key = vendor_contracts
```

SLO definitions:

```text
console_settings.key = slo_config
```

Legacy SLO target compatibility:

```text
slo_targets
```

### 4.2 OSB Archive Tables

Created idempotently by `server/src/osbArchive.js`:

```text
osb_access_events
osb_pipeline_events
osb_archive_batches
```

These tables are additive and live in the Unified Console database.

## 5. Deployment Runbook

### 5.1 Local Pre-Deploy Checks

Run from the Mac:

```bash
cd "/Users/yosriyahmed/Documents/Claude/Projects/Salam DMS/unified-console"
git status --short
node --check server/src/vendorContracts.js
node --check vendor-contracts.js
node --check server/src/vendorContractMail.js
node --check server/src/api.js
npm test --prefix server
```

Expected:

- No syntax errors.
- `npm test` finishes with `all syntax checks passed`.

### 5.2 Important Deploy Mode

Use full deploy for this change:

```bash
DEPLOY_TARGET=unified bash deploy152/deploy.sh
```

Do not use `--web-only` for this change because server code changed.

Use `--web-only` only for a future frontend-only edit where no `server/src/*` file changed.

### 5.3 Server Post-Deploy Checks

SSH to server 152:

```bash
ssh yosri@172.31.38.152
sudo su -
cd /apps/unified/server
pm2 list
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4701/
curl -s http://127.0.0.1:4701/api/version
pm2 logs salam-unified --lines 80 --nostream
```

Expected:

- `salam-unified` is online.
- Local HTTP status is `200`.
- `/api/version` shows the deployed release marker.
- No boot crash or repeated route/module errors in logs.

Run the bundled post-deploy check:

```bash
node /apps/unified/server/postdeploy-check.cjs
```

### 5.4 OSB Import Checks On Server 152

Prepare env:

```bash
cd /apps/unified/server
set -a
. ../.env
set +a
```

Check archive status:

```bash
node src/osbArchive.js status
```

Scan upload root:

```bash
node src/osbArchive.js scan /sftp_data/uploads
```

Import new archive batches:

```bash
node src/osbArchive.js import-uploads /sftp_data/uploads
```

Expected:

- Already-imported archives remain stable.
- New archive batches show imported file count, access rows, pipeline rows, window low/high and checksum status.
- Large imports can take time. Watch progress lines every 10 files.

## 6. Post-Deployment Functional Tests

### 6.1 Version And Basic Health

Steps:

1. Open `https://salam.sa/unified-console/`.
2. Confirm login works.
3. Open browser dev tools or server curl `/api/version`.
4. Confirm current release marker.

Expected:

- App loads.
- No blank screen.
- User session/OTP flow works.

### 6.2 OSB Monitoring

Steps:

1. Open `https://salam.sa/unified-console/#monitoring?tab=gateway`.
2. Set date range to a window covered by the imported OSB archive.
3. Find `OSB - ORACLE BUS`.
4. Confirm business-story cards appear.
5. Click a raw OSB endpoint row.

Expected:

- Archive window is visible.
- Endpoint rows show calls, average, p95 and max.
- Drill-down shows sampled transactions.
- Same-ECID hops and payload records appear where ECID exists.
- Correlation note is visible and honest.

### 6.3 Mobile Dashboard BSS Findings

Steps:

1. Open Mobile dashboard.
2. Set date range to the imported archive window.
3. Find `BSS findings - OSB / Oracle Bus archive`.

Expected:

- OSB transaction count appears.
- Payload record count appears.
- Fault counts by kind appear.
- Business-story cards give useful summary for L2/management.

### 6.4 Customer 360 OSB Story

Steps:

1. Open Customer 360.
2. Search a known National ID or MSISDN that exists in the imported OSB archive.
3. Open `Logs & Diagnostics`.
4. Open or refresh the OSB block.

Expected:

- The selected line is used for OSB matching.
- Direct hits, pipeline records, backend hops and faults are counted separately.
- If no records exist, the message explains possible reasons and does not claim BSS was never called.

### 6.5 Yusr OSB Context

Steps:

1. Open Yusr on a Customer 360 page.
2. Ask about the selected subscriber status or last failed step.
3. Check the OSB/BSS context in the answer.

Expected:

- Yusr mentions OSB/BSS archive only when context exists.
- It separates exact ECID evidence from probable subscriber/time correlation.
- It does not invent an end-to-end APIGW-to-OSB trace when shared trace id is missing.

### 6.6 SLO Definitions

Steps:

1. Sign in as Super Admin.
2. Open Settings -> SLO definitions or go to `#slo-settings`.
3. Confirm Fixed and MVNO groups render.
4. Record an existing value.
5. Make a small temporary change.
6. Save and refresh.
7. Restore the original value and save again.

Expected:

- Only Super Admin can access the page.
- Values persist after refresh.
- Existing SLA and dashboard cards still load.
- Audit log records the config update.

### 6.7 Home And Fixed CTA Links

Steps:

1. Open `#home`.
2. Click Fixed KPI/alert boxes:
   - Fixed open errors
   - Nafath failing
   - Fixed completed trend
3. Observe the destination hash and page body.

Expected:

- The correct Fixed page opens, not Home.
- The target tab/filter matches the KPI.
- No stale filter from previous Fixed page visit remains.

### 6.8 Fixed Recent Attempts Placement

Steps:

1. Open Fixed -> Operations Dashboard.
2. Scroll through the page.

Expected:

- `Recent attempts` table is at the end of the page.
- Upper KPI, SLO and trend sections remain visible first.

### 6.9 Vendors And Contracts Access

Steps:

1. Sign in as Super Admin.
2. Open Settings -> Vendors & contracts or go to `#vendor-contracts`.
3. Select Sigma and TCS.
4. Open each tab.

Expected:

- Summary cards render.
- Five phases show ready/next status.
- Sigma and TCS reference data appears.
- Tabs work in light and dark mode.
- Page is usable at desktop and narrow/mobile width.

### 6.10 Vendor Contract Escalation Flow

Steps:

1. Open `#vendor-contracts`.
2. Select Sigma.
3. Open `Reminders & escalation`.
4. Enter your own email in Management recipients.
5. Adjust one temporary reminder value.
6. Save and refresh.
7. Restore the original value and save again.

Expected:

- Management recipient list persists.
- Per-priority reminder timings persist.
- The row-level `Inform management` flag clearly uses the contract management list.
- Existing ACK SLA page is unchanged.

### 6.11 Vendor SLA Mail Preview

Run on server 152 after deployment:

```bash
cd /apps/unified/server
set -a
. ../.env
set +a
node src/cli.js vendor-sla-mail-test --to y.yahmed.sns@salam.sa --contract sigma-2024 --severity P1 --step r1 --dry-run
node src/cli.js vendor-sla-mail-test --to y.yahmed.sns@salam.sa --contract sigma-2024 --severity P1 --step r1
node src/cli.js vendor-sla-mail-test --to y.yahmed.sns@salam.sa --contract tcs-2026-mvno-itops --matrix --all-items --limit 8
```

Expected:

- Dry run lists planned cases and sends nothing.
- Real run sends only to `y.yahmed.sns@salam.sa`.
- Subject contains `[TEST ONLY]`.
- Body shows vendor, contract, SLA item, priority, timing, target, evidence plan and escalation ladder.
- No team or management distribution list receives the test.

### 6.12 Penalty Model

Steps:

1. Open `#vendor-contracts`.
2. Select TCS.
3. Open `Penalty model`.
4. Enter temporary `Eligible monthly fee = 1000000`.
5. Confirm TCS monthly cap is `5`.
6. Review severity weights.
7. Save and refresh.
8. Restore temporary values if they were test-only.

Expected:

- Candidate sum and capped exposure calculate.
- Blank weights stay governance-only.
- Approval status remains commercial/evidence/manual.
- No live enforcement starts.

## 7. Regression Checklist

After deployment, confirm these still work:

- `#home`
- `#dashboard`
- `#monitoring`
- `#subscriber`
- `#sla`
- `#slo-settings`
- `#vendor-contracts`
- `#fixed`
- `#fixed?tab=dash`
- `#fixed?tab=map`
- `#fixed?tab=errors`
- Settings menu opens and shows Super Admin items only for Super Admin users.
- User management and audit log still load.
- ACK SLA settings still load.
- Healthcheck still runs.

Server API checks:

```bash
curl -s http://127.0.0.1:4701/api/version
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4701/
```

Authenticated browser checks:

- `/api/slo/config`
- `/api/vendor-contracts`
- `/api/osb/archive/status`
- `/api/osb/archive/stories`

## 8. Rollback Plan

### 8.1 Preferred Code Rollback

Redeploy the previous known-good release/tag.

Example:

```bash
cd "/Users/yosriyahmed/Documents/Claude/Projects/Salam DMS/unified-console"
git checkout <previous-good-tag-or-branch>
DEPLOY_TARGET=unified bash deploy152/deploy.sh
```

Then verify:

```bash
ssh yosri@172.31.38.152
sudo su -
cd /apps/unified/server
pm2 list
curl -s http://127.0.0.1:4701/api/version
pm2 logs salam-unified --lines 80 --nostream
```

### 8.2 Config-Only Rollback

Use when the code is good but vendor/SLO values were edited incorrectly.

For vendor contracts:

1. Open `#vendor-contracts` as Super Admin.
2. Click `Reset defaults`.
3. Refresh the page.
4. Confirm Sigma/TCS seeded values return.

For SLO config:

1. Open `#slo-settings` as Super Admin.
2. Click reset/defaults if available.
3. Confirm dashboard/SLA cards return to expected target values.

### 8.3 Emergency UI Hide

Use only if a page causes frontend issues but server routes are healthy.

Actions:

- Remove or hide the `Vendors & contracts` menu item.
- Remove or hide the `SLO definitions` menu item if needed.
- Revert the `vendor-contracts.js` script reference from `index.html` if required.
- Deploy with `--web-only` only if no server file was changed.

Command:

```bash
DEPLOY_TARGET=unified bash deploy152/deploy.sh --web-only
```

### 8.4 Emergency Full Rollback

Use if a server module causes boot/runtime errors.

Actions:

- Restore previous `server/src/api.js`.
- Remove or restore previous versions of:
  - `server/src/vendorContracts.js`
  - `server/src/vendorContractMail.js`
  - `vendor-contracts.js`
  - `server/src/osbResolve.js` if the rollback target predates OSB resolver work
- Restore previous `index.html` script references.
- Run full deploy.

Command:

```bash
DEPLOY_TARGET=unified bash deploy152/deploy.sh
```

### 8.5 OSB Data Rollback

OSB archive import tables are additive. Normally do not delete imported OSB rows during code rollback.

If an imported batch is wrong:

1. Identify the batch in `osb_archive_batches`.
2. Confirm with DBA/owner before deleting data.
3. Delete only the affected batch rows from `osb_access_events`, `osb_pipeline_events` and `osb_archive_batches`.
4. Re-import the corrected archive.

Do not run destructive SQL without a backup and explicit approval.

## 9. Known Limits And Next Steps

### 9.1 OSB Correlation Limits

Current archive does not provide a guaranteed shared Digital/APIGW request id for every OSB transaction.

Needed for exact Digital -> APIGW -> OSB trace:

- Shared trace id or transaction id propagated from app/API gateway into OSB logs.
- Consistent ECID capture in both access and pipeline logs.
- Daily SFTP feed with day-1 lag.
- Coverage monitoring for missing archive days.

### 9.2 ITSM/Remedy Limits

Vendor SLA response/restoration/resolution needs Remedy/ITSM evidence to become formal.

Needed:

- Incident opened timestamp.
- Acknowledged timestamp.
- Restored/resolved timestamp.
- Vendor owner/assignment.
- Priority and priority-change history.
- Clock-stop/exclusion reason.
- RCA submitted timestamp for P1/P2.

### 9.3 Penalty Limits

Penalty model is not formal until commercial/legal validation.

Needed:

- Eligible monthly fee per contract.
- Confirmed monthly cap.
- Confirmed penalty tiering/weighting table.
- Approved exclusions.
- Vendor owner sign-off.
- SLA owner approval.
- Commercial/legal approval.
- Evidence appendix.

### 9.4 Vendor Governance Pack

Next useful phase:

- Monthly vendor SLA report export.
- Evidence appendix per breach candidate.
- Exclusion register.
- Penalty candidate register.
- Vendor response/RCA tracking.
- Management summary with confidence labels.

## 10. File Map

Core OSB:

- `server/src/osbArchive.js`
- `server/src/osbResolve.js`
- `monitoring.js`
- `home.js`
- `sub360.js`
- `server/src/assist.js`

SLO:

- `server/src/slo.js`
- `slo.js`
- `server/src/api.js`

Vendor contracts:

- `server/src/vendorContracts.js`
- `vendor-contracts.js`
- `server/src/vendorContractMail.js`
- `server/src/cli.js`

Navigation and shell:

- `index.html`
- `settingsmenu.js`
- `router.js`
- `ops.js`

Fixed CTA and dashboard placement:

- `home.js`
- `fixed.js`
- `fixed-dash.js`
- `fixed-errors.js`
- `landing.js`

Release notes:

- `CHANGELOG.md`
- `VERSION`

## 11. Operator Summary

Use this mental model:

- OSB gives the BSS-side story.
- APIGW gives the digital/API gateway story.
- Customer 360/Yusr combine the support-safe story for one subscriber.
- Monitoring gives the L2/system story.
- SLO settings define what "good" means.
- Vendor contracts define who owns the obligation.
- Escalation config defines who is reminded and when.
- Penalty model estimates candidate exposure, but never makes a formal deduction by itself.

