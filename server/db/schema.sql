-- MVNO Console DB schema (target: database `mvno_console`)
-- Separate from the selfcare prod-replica DB. Safe to drop/recreate.

CREATE TABLE IF NOT EXISTS metric_catalog (
  key           text PRIMARY KEY,
  label         text NOT NULL,
  description   text,
  unit          text NOT NULL DEFAULT 'count',   -- count | rate | ratio | pp
  higher_is_bad boolean NOT NULL DEFAULT true,
  source_tables text
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id           bigserial PRIMARY KEY,
  key          text UNIQUE NOT NULL,
  name         text NOT NULL,
  description  text,
  metric_key   text NOT NULL REFERENCES metric_catalog(key),
  operator     text NOT NULL,                    -- gt gte lt lte eq
  threshold    numeric NOT NULL,
  window_hours numeric NOT NULL DEFAULT 1,
  min_sample   integer NOT NULL DEFAULT 0,
  team         text,
  severity     text NOT NULL DEFAULT 'P3',        -- P1 P2 P3 P4
  channel      text,                              -- any | app | web | sda | posa | partner
  dim          jsonb NOT NULL DEFAULT '{}',       -- dimension filter, e.g. {"platform":"web"}
  active_from  integer,                           -- KSA hour 0-23 (null = always)
  active_to    integer,
  params       jsonb NOT NULL DEFAULT '{}',
  enabled      boolean NOT NULL DEFAULT true,
  builtin      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id           bigserial PRIMARY KEY,
  metric_key   text NOT NULL,
  dim          jsonb NOT NULL DEFAULT '{}',
  window_hours numeric NOT NULL,
  value        numeric,
  sample       integer NOT NULL DEFAULT 0,
  sim_now      timestamptz NOT NULL,              -- the virtual "now" this was computed at
  computed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snap_lookup ON metric_snapshots (metric_key, window_hours, sim_now DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id            bigserial PRIMARY KEY,
  rule_id       bigint REFERENCES alert_rules(id) ON DELETE SET NULL,
  rule_key      text NOT NULL,
  name          text NOT NULL,
  severity      text NOT NULL,
  team          text,
  status        text NOT NULL DEFAULT 'open',     -- open | resolved
  metric_key    text NOT NULL,
  operator      text NOT NULL,
  threshold     numeric NOT NULL,
  observed_value numeric,
  sample        integer,
  window_hours  numeric,
  dim           jsonb NOT NULL DEFAULT '{}',
  context       jsonb NOT NULL DEFAULT '{}',
  message       text,
  fired_at      timestamptz NOT NULL,             -- sim_now when it opened
  last_seen_at  timestamptz NOT NULL,             -- sim_now of most recent breach
  resolved_at   timestamptz,
  peak_value    numeric,
  breach_count  integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts (status, rule_key);
CREATE INDEX IF NOT EXISTS idx_alerts_fired ON alerts (fired_at DESC);
-- incident lifecycle fields on a firing (idempotent)
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ack_by        text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ack_at        timestamptz;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS assignee      text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS note          text;
-- on-call escalation tracking (real wall-clock timing, independent of the sim clock)
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS opened_wall   timestamptz NOT NULL DEFAULT now();
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS esc_level     integer NOT NULL DEFAULT 0;   -- tiers already paged
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS esc_last_at   timestamptz;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS runbook   text;   -- what to do when this fires (text or URL)

-- incident discussion thread
CREATE TABLE IF NOT EXISTS incident_comments (
  id         bigserial PRIMARY KEY,
  alert_id   bigint NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  author     text,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incident_comments_alert ON incident_comments (alert_id, created_at);

-- hourly rollups (pre-aggregated so dashboards don't scan the big source tables)
CREATE TABLE IF NOT EXISTS rollup_hourly (
  hour     timestamptz NOT NULL,
  journey  text NOT NULL,     -- onboarding|checkout|payment|activation|semati|eligibility|nafath|change_plan|delivery
  outcome  text NOT NULL,     -- ok|fail|pending|total
  platform text NOT NULL DEFAULT '',
  cnt      bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, journey, outcome, platform)
);
CREATE INDEX IF NOT EXISTS idx_rollup_hour ON rollup_hourly (hour);
CREATE INDEX IF NOT EXISTS idx_rollup_journey ON rollup_hourly (journey, hour);

-- vendor/partner rollups (payment gateways, couriers) for the vendor SLA board
CREATE TABLE IF NOT EXISTS rollup_vendor_hourly (
  hour     timestamptz NOT NULL,
  journey  text NOT NULL,     -- payment | delivery
  vendor   text NOT NULL DEFAULT '',
  outcome  text NOT NULL,     -- ok|fail|pending
  cnt      bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, journey, vendor, outcome)
);
CREATE INDEX IF NOT EXISTS idx_rollup_vendor_hour ON rollup_vendor_hourly (hour);
CREATE INDEX IF NOT EXISTS idx_rollup_vendor ON rollup_vendor_hourly (journey, vendor, hour);

-- SLO targets per journey (success-rate target over a window) for the SLA board
CREATE TABLE IF NOT EXISTS slo_targets (
  id          bigserial PRIMARY KEY,
  journey     text UNIQUE NOT NULL,
  label       text NOT NULL,
  target      numeric NOT NULL,           -- 0..1 success-rate target
  window_days integer NOT NULL DEFAULT 30,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS console_settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- per-user personal edits of analytics dashboards (overlaid on the shared board at read time)
CREATE TABLE IF NOT EXISTS user_dashboards (
  email      text NOT NULL,
  key        text NOT NULL,
  spec       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, key)
);

-- captured application errors (reliability: error tracking sink)
CREATE TABLE IF NOT EXISTS console_errors (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  level    text NOT NULL DEFAULT 'error',   -- info | warn | error | fatal
  message  text NOT NULL,
  stack    text,
  route    text,
  actor    text,
  ip       text,
  meta     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_console_errors_at ON console_errors (at DESC);

CREATE TABLE IF NOT EXISTS console_users (
  id         bigserial PRIMARY KEY,
  email      text UNIQUE NOT NULL,
  name       text,
  role       text NOT NULL DEFAULT 'report_manager',
  team       text,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- richer user-management fields (idempotent; safe on existing DBs)
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS roles       text[] NOT NULL DEFAULT '{}';
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS mobile      text;
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS dashboard   jsonb NOT NULL DEFAULT '{}';   -- per-user home dashboard prefs
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS tags        text[] NOT NULL DEFAULT '{}';
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS mail_report boolean NOT NULL DEFAULT false;
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS mail_alert  boolean NOT NULL DEFAULT false;
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS tour_seen   boolean NOT NULL DEFAULT false;
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS last_login  timestamptz;

-- prod → local replica incremental-sync progress (one row per table)
CREATE TABLE IF NOT EXISTS prod_sync_state (
  table_name   text PRIMARY KEY,
  watermark    timestamptz,      -- last (max) created_at/updated_at pulled
  last_id      text,             -- keyset cursor tie-breaker
  rows_synced  bigint NOT NULL DEFAULT 0,
  last_run_at  timestamptz,
  last_status  text,             -- ok | running | error | dry-run
  last_error   text
);

CREATE TABLE IF NOT EXISTS login_otps (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL,
  code       text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_lookup ON login_otps (email, consumed, expires_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  actor      text,
  role       text,
  action     text NOT NULL,
  target     text,
  detail     jsonb NOT NULL DEFAULT '{}',
  at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ua text;
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action, at DESC);

CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id         bigserial PRIMARY KEY,
  key        text UNIQUE NOT NULL,
  name       text NOT NULL,
  spec       jsonb NOT NULL DEFAULT '{}',   -- {panels:[...], filters:{...}}
  builtin    boolean NOT NULL DEFAULT false,
  owner      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id             bigserial PRIMARY KEY,
  sim_now        timestamptz NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  metrics_written integer NOT NULL DEFAULT 0,
  alerts_opened  integer NOT NULL DEFAULT 0,
  alerts_resolved integer NOT NULL DEFAULT 0,
  note           text
);

-- Ops event timeline: deploys, campaigns, maintenance windows, known incidents.
-- Rendered as markers on all time-series charts so L1/L2 can answer "what changed at HH:MM?".
CREATE TABLE IF NOT EXISTS ops_events (
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL DEFAULT 'deploy',   -- deploy | campaign | maintenance | incident | note
  title      text NOT NULL,
  area       text,                             -- optional journey/area tag (payment, nafath, delivery, ...)
  note       text,
  at         timestamptz NOT NULL,
  ends_at    timestamptz,                       -- optional window end (maintenance/campaign)
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_events_at_idx ON ops_events (at DESC);

-- Editable BSS/activation error-code labels (shown as "code - meaning" on error charts).
CREATE TABLE IF NOT EXISTS error_codes (
  code       text PRIMARY KEY,
  label      text NOT NULL,
  area       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
