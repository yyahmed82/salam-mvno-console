# Data convergence — merging the two prod consoles into `unified_console`

_v2.0.0-alpha.13 · 6 Sep 2026 · script `server/scripts/converge-import.cjs`, schema `server/db/converge.sql`_

Stage 1 of the convergence plan keeps three databases alive. This document covers the **one-way merge of the
people and the history** that cannot be regenerated, so that when the two prod consoles are switched off nothing
is lost — and so the unified console stops looking "younger" than they are.

## 1 · What moves, what stays, what is never touched

| | Source | Target | Why |
|---|---|---|---|
| **Users** | `mvno_console.console_users` + `sda_ops.users` | `console_users` (union by e-mail) | one identity per person, with the business scope derived |
| **Audit trail** | both `audit_log`s | `audit_log` (+ `source`, `legacy_id`) | who did what, one searchable history |
| **Alert history** | `mvno_console.alerts` · `sda_ops.alert_events` | `alerts` (`segment` mvno / fixed) | one incident history across both businesses |
| **Metric snapshots** | `mvno_console.metric_snapshots` | `metric_snapshots` | **this is what the anomaly baselines are built from** — without it the unified console compares today against a few hours of its own history |
| **Tickets** | `mvno_console.console_tickets` (+ comments, files) | same tables, refs prefixed `D-` | feedback history and its thread |
| **Dashboards** | `analytics_dashboards`, `user_dashboards`, `slo_targets`, `error_codes` | same tables | boards people built, SLO targets, the error-code catalogue |
| **Incidents** | `sda_ops.incident_log` | `legacy_incident_log` (archive) | Fixed pages still read the live table through the OPS pool; this is the retirement copy |
| **Playbooks** | `sda_ops.ops_docs` | `legacy_ops_docs` (archive) | same — `fixed_playbook_overrides` already layers edits on top of the live rows |
| **Fixed alert rules** | `sda_ops.alert_rules` | `legacy_alert_rules` (archive) | unified runs its **own** `fixed_*` rules (`alert_rules.segment='fixed'`); importing the legacy definitions would give you two engines for one signal |
| Fixed operational data | `dealers`, `order_attempts`, `error_events`, `api_calls`, `leads` | — stays in `sda_ops` | the unified console reads it read-only; copying it would fork the source of truth |
| Credentials | `password_hash`, `otp_code`, `current_jti`, sessions | **never imported** | this console is OTP-only; a copied hash is a liability with no use |
| Secrets in settings | any key matching `secret|token|password|webhook|smtp|api_key|credential|bearer` | **skipped** | prod secrets belong in `.env`, not in a copied settings row |

## 2 · The merge rules that matter

**Business scope is derived from where the account exists** — this is the elegant part: the account is in the
digital console only → `mobile`; in sda_ops only → `fixed`; in both → `both`. One import populates the business
scope for everyone, no spreadsheet needed.

**Roles are mapped, never inherited blindly.**

| sda_ops role | unified role |
|---|---|
| `SUPER_ADMIN` | `admin` — **unless** the e-mail is passed in `--super-admins` |
| `ADMIN` | `admin` |
| `DEALERS_ADMIN` · `QR_ADMIN` · `REPORT_ADMIN` · `B2C_ADMIN` | `report_manager` |

A legacy database must not be able to mint a super admin in the new one; that is why `SUPER_ADMIN` lands as
`admin` by default. If a person exists in both consoles, the **digital** role wins (it is the same role
vocabulary as here).

The script checks the merged role map (`role_perms` / `custom_roles` in `console_settings`) and warns when
fixed-only users are about to land on a role that holds **no Fixed view** — they would sign in and see an empty
console. Fix that in Settings → Roles & permissions before letting them in.

**Nothing already in the unified console is overwritten.** Existing users keep their role, enabled flag,
business scope and mail settings; only `name`, `tags` and provenance are filled in. Re-run with
`--refresh-business` when you deliberately want the derivation to win over hand edits.

**Mail stays off.** Every imported account lands with `mail_alert = mail_report = false` unless listed in
`--mail-allow`. During the shadow period the two prod consoles are still mailing; nobody should get a report twice.

**Re-running is a no-op.** Everything imported carries `(source, legacy_id)` behind a unique index, so the
import is idempotent — rehearsed over three consecutive runs.

## 3 · Runbook

Prerequisite — a **read-only** connection to the digital console's database. Ask the DBA for a reader on
`mvno_console`, then add it to `/apps/unified/.env`:

```
DIGITAL_DATABASE_URL=postgresql://<reader>:<pass>@172.31.15.121:5432/mvno_console
```

(If it is absent the script falls back to `CONSOLE_DATABASE_URL` with the database name swapped — convenient
when `console_app` may read both, and it says so in its header so you always know which route it took.)

```bash
# 1 · deploy the script + schema with the next milestone
cd /apps/unified/server

# 2 · dry run — nothing is written, every number is printed
node scripts/converge-import.cjs

# 3 · one section at a time, still dry
node scripts/converge-import.cjs --only=users
node scripts/converge-import.cjs --only=snapshots --months=12

# 4 · apply, in the same order you reviewed
node scripts/converge-import.cjs --apply --only=users --super-admins=y.yahmed.sns@salam.sa
node scripts/converge-import.cjs --apply --only=audit,alerts,snapshots
node scripts/converge-import.cjs --apply --only=tickets,docs,incidents,dashboards

# 5 · ticket attachments (the DB rows point at files on disk)
rsync -a /apps/console/uploads/tickets/ /apps/unified/uploads/tickets/
node scripts/converge-import.cjs --apply --only=tickets --with-ticket-files
```

`settings` is deliberately **not** in the default set: a copied `role_perms` row can change who sees what. Run
`--only=settings` on its own, after reading the dry-run list.

Every `--apply` run writes a row to `converge_runs` (mode, options, per-section counts, ok/error) — that table is
the record of what was merged and when.

## 4 · After the import

1. **Users** — Settings → Users: check the BUSINESS column, spot-check a fixed-only person, and confirm nobody
   unexpected holds `admin`.
2. **Roles** — if the script warned about "no Fixed view", grant `fixed` to that role before people sign in.
3. **Baselines** — the anomaly banner and "vs seasonal norm" figures should stop disagreeing with the digital
   console within one scheduler cycle, because they now read the same snapshot history.
4. **Audit** — the Audit page should show both consoles' history; `source` tells them apart
   (`digital` / `operations` / `unified`).
5. **Mail** — `SELECT email FROM console_users WHERE mail_alert OR mail_report;` should return only your testers.

## 5 · Rollback

The import only ever inserts, and everything it inserted is labelled:

```sql
DELETE FROM audit_log        WHERE source IN ('digital','operations');
DELETE FROM alerts           WHERE source IN ('digital','operations');
DELETE FROM metric_snapshots WHERE source = 'digital';
DELETE FROM console_tickets  WHERE source = 'digital';   -- comments/files cascade
DELETE FROM console_users    WHERE source IS NOT NULL AND imported_at IS NOT NULL;
TRUNCATE legacy_incident_log, legacy_ops_docs, legacy_alert_rules;
```

Check `console_users` first — a person who has since signed in and been given a role should be kept, not deleted.

## 6 · What is still ahead (phase 2)

This merge makes `unified_console` self-sufficient for **people and history**. The operational Fixed data still
lives in `sda_ops` and is read through the OPS pool. The switch-off sequence is: point the Fixed ingest at the
unified DB → move `dealers` / `order_attempts` / `error_events` / `api_calls` → retire `ops-web` → drop the OPS
pool from `.env`. Until then the archives (`legacy_*`) are snapshots, not the live read path, so nothing is shown
twice in the UI.
