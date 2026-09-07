-- converge.sql — additive schema for the data convergence (v2.0.0-alpha.13, 6 Sep 2026)
-- Applied by scripts/converge-import.cjs before any import. Idempotent, additive-only:
-- an older build still boots on this schema (deploy rollback stays 1 minute).
--
-- Two ideas:
--   1. PROVENANCE — every row that came from a legacy console carries source + legacy_id, so you can always
--      answer "where did this come from" and re-run the import safely (unique index → ON CONFLICT DO NOTHING).
--   2. ARCHIVE tables (legacy_*) — history from sda_ops that has no home in the unified model. They are a
--      SNAPSHOT for the day sda_ops is retired; live pages keep reading the OPS pool until cutover, so
--      nothing is duplicated in the UI.

-- ---------- provenance ----------
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS source      text;             -- digital | operations | both | unified
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS legacy_ref  jsonb NOT NULL DEFAULT '{}';   -- {digital_id, ops_id}
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS imported_at timestamptz;

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS source    text NOT NULL DEFAULT 'unified';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS legacy_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_legacy ON audit_log (source, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_source ON audit_log (source, at DESC);

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source    text NOT NULL DEFAULT 'unified';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS legacy_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_legacy ON alerts (source, legacy_id) WHERE legacy_id IS NOT NULL;

ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS source    text NOT NULL DEFAULT 'unified';
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS legacy_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_snap_legacy ON metric_snapshots (source, legacy_id) WHERE legacy_id IS NOT NULL;

ALTER TABLE console_tickets ADD COLUMN IF NOT EXISTS source    text NOT NULL DEFAULT 'unified';
ALTER TABLE console_tickets ADD COLUMN IF NOT EXISTS legacy_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_legacy ON console_tickets (source, legacy_id) WHERE legacy_id IS NOT NULL;

ALTER TABLE analytics_dashboards ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'unified';

-- ---------- archives (snapshot of sda_ops console history; live reads still go to the OPS pool) ----------
CREATE TABLE IF NOT EXISTS legacy_incident_log (
  incident_number text PRIMARY KEY,
  segment         text,
  priority        text,
  status          text,
  sla_status      text,
  sla_missed      boolean NOT NULL DEFAULT false,
  theme           text,
  ticket_type     text,
  assigned_group  text,
  description     text,
  submitted_at    timestamptz,
  resolved_at     timestamptz,
  resolve_hours   numeric,
  created_at      timestamptz,
  imported_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legacy_inc_submitted ON legacy_incident_log (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_legacy_inc_theme ON legacy_incident_log (theme);

CREATE TABLE IF NOT EXISTS legacy_ops_docs (
  slug             text PRIMARY KEY,
  kind             text NOT NULL,
  title            text NOT NULL,
  body             text NOT NULL DEFAULT '',
  related_rule_key text,
  builtin          boolean NOT NULL DEFAULT false,
  updated_by       text,
  created_at       timestamptz,
  updated_at       timestamptz,
  imported_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legacy_alert_rules (
  rule_key    text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  team        text,
  severity    integer,
  metric      text,
  operator    text,
  threshold   numeric,
  window_hours integer,
  min_sample  integer,
  channel     text,
  params      jsonb NOT NULL DEFAULT '{}',
  enabled     boolean,
  builtin     boolean,
  created_at  timestamptz,
  updated_at  timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- one row per import run — what ran, with which options, and what it wrote
CREATE TABLE IF NOT EXISTS converge_runs (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  mode        text NOT NULL,              -- dry-run | apply
  options     jsonb NOT NULL DEFAULT '{}',
  result      jsonb NOT NULL DEFAULT '{}',
  ok          boolean,
  error       text
);
