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
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ack_reminder_level integer NOT NULL DEFAULT 0;   -- acknowledgement SLA: highest reminder sent (0..3)
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ack_reminder_at    timestamptz;                   -- last reminder / escalation send
-- Acknowledgement-SLA reminder log (ackSla.js): one row per reminder / escalation mail
CREATE TABLE IF NOT EXISTS alert_reminders (
  id          bigserial PRIMARY KEY,
  alert_id    bigint NOT NULL,
  level       smallint NOT NULL,
  business    text NOT NULL,
  severity    text,
  elapsed_min integer NOT NULL,
  recipients  integer NOT NULL DEFAULT 0,
  management  integer NOT NULL DEFAULT 0,
  channels    jsonb NOT NULL DEFAULT '[]'::jsonb,
  mail_ok     boolean,
  error       text,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alert_reminders_alert ON alert_reminders (alert_id, sent_at DESC);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS esc_last_at   timestamptz;
-- ServiceNow link (snTicket.js): one INC per alert, state refreshed by the poller
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS sn_number     text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS sn_sys_id     text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS sn_state      text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS sn_synced_at  timestamptz;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS sn_created_by text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS sn_created_at timestamptz;
CREATE INDEX IF NOT EXISTS alerts_sn_sys_id_idx ON alerts (sn_sys_id) WHERE sn_sys_id IS NOT NULL;
-- incident comms mails sent from the console (the L1 "Critical Incident Notification" and its updates)
CREATE TABLE IF NOT EXISTS incident_comms (
  id        bigserial PRIMARY KEY,
  alert_id  bigint NOT NULL,
  kind      text NOT NULL DEFAULT 'initial',      -- initial | update | resolved
  subject   text,
  sent_to   text[] NOT NULL DEFAULT '{}',
  sent_by   text,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  fields    jsonb,
  ok        boolean NOT NULL DEFAULT true,
  error     text
);
CREATE INDEX IF NOT EXISTS incident_comms_alert_idx ON incident_comms (alert_id, sent_at DESC);
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS runbook   text;   -- what to do when this fires (text or URL)
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS alert_class text; -- technical | business (errclass.js split; 'mixed' retired 2026-08-11)
-- unified console: which segment a rule / firing belongs to (plan §2.1) — 'mvno' (default) | 'fixed'
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'mvno';
ALTER TABLE alerts      ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'mvno';
CREATE INDEX IF NOT EXISTS idx_alerts_segment_fired ON alerts (segment, fired_at DESC);
-- business segregation (8 Sep 2026): a fixed_* rule / firing is Fixed whatever the column says — backfill so the
-- Mobile pages and the Mobile digest can filter on segment alone.
UPDATE alert_rules SET segment='fixed' WHERE key LIKE 'fixed\_%' AND segment <> 'fixed';
UPDATE alerts      SET segment='fixed' WHERE rule_key LIKE 'fixed\_%' AND segment <> 'fixed';

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
-- business scope (6 Sep 2026): which side of the console the user works on — 'mobile' | 'fixed' | 'both'.
-- Applied on top of roles: a role's views are intersected with the business at session time (roles.scopeViews).
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS business    text NOT NULL DEFAULT 'both';
-- ack holders (8 Sep 2026): who may take / receive an acknowledgement hand-over on each side. Settings → Users →
-- ACK · MOBILE / ACK · FIXED. Seeded once from the existing "Mail alert" opt-in + business (the on-call people), then
-- admin-managed. A hand-over to someone without the flag is refused.
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS ack_mobile boolean;
ALTER TABLE console_users ADD COLUMN IF NOT EXISTS ack_fixed  boolean;
UPDATE console_users SET ack_mobile = (mail_alert AND business IN ('mobile','both')) WHERE ack_mobile IS NULL;
UPDATE console_users SET ack_fixed  = (mail_alert AND business IN ('fixed','both'))  WHERE ack_fixed  IS NULL;

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

-- Server-side login sessions (token auth). The token itself is never stored — only its SHA-256.
CREATE TABLE IF NOT EXISTS console_sessions (
  token_hash text PRIMARY KEY,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON console_sessions (email);

-- Yusr feedback loop: one row per 👍/👎 on a reply. Question/reply text is NOT stored here
-- (PII governance — same rule as the audit trail); only the verdict + dimensions for the KPIs.
CREATE TABLE IF NOT EXISTS assist_feedback (
  id       bigserial PRIMARY KEY,
  actor    text,
  intent   text,
  degraded boolean,
  helpful  boolean NOT NULL,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assist_feedback_at ON assist_feedback (at DESC);

-- Yusr case memory: PII-SCRUBBED problem→resolution pairs saved on 👍 (or manually). Retrieved
-- like runbook chunks for future similar questions — this is how Yusr "learns from use" without
-- touching model weights. problem_hash dedupes repeat saves; helpful_votes ranks retrieval.
CREATE TABLE IF NOT EXISTS assist_cases (
  id            bigserial PRIMARY KEY,
  problem_hash  text UNIQUE NOT NULL,
  title         text NOT NULL,
  problem       text NOT NULL,
  resolution    text NOT NULL,
  tags          text,
  source        text NOT NULL DEFAULT 'thumbs_up',
  actor         text,
  helpful_votes int NOT NULL DEFAULT 1,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assist_cases_at ON assist_cases (at DESC);

-- Digital-API traffic events, one row per API call, pulled over SSH from the api hosts'
-- api_logger.production.log by apiLogCollector.js (COLLECTOR mode — replaces the Grafana MySQL
-- read path when API_LOG_HOSTS is set; MySQL stays available as fallback). err_class is the
-- errclass.classifyClass() verdict computed at ingest ('success' | 'business' | 'technical').
-- RETENTION: the collector purges rows older than 7 days on every cycle — this table is a
-- rolling operational window, not an archive.
CREATE TABLE IF NOT EXISTS api_traffic_events (
  id               bigserial PRIMARY KEY,
  ts               timestamptz NOT NULL,      -- response-header Date (UTC)
  host             text NOT NULL,             -- which api host the line came from (17 / 18)
  path             text NOT NULL,             -- request.path
  transaction_id   text,
  response_code    text,
  response_message text,                      -- MSISDN/NID digit-runs masked BEFORE storage
  duration_ms      integer,
  err_class        text                       -- success | business | technical (errclass.js)
);
CREATE INDEX IF NOT EXISTS idx_api_traffic_events_ts ON api_traffic_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_api_traffic_events_path_ts ON api_traffic_events (path, ts);
-- per-transaction lookup (apigwTrace end-to-end correlation: app ⇄ gateway ⇄ uil_logs)
CREATE INDEX IF NOT EXISTS idx_api_traffic_events_txn ON api_traffic_events (transaction_id)
  WHERE transaction_id IS NOT NULL;

-- API-Gateway TCP reachability, one row per target per probe. Persisted (rather than kept in
-- memory) so reachability becomes a normal METRIC: charts, history, replay, and the existing rule
-- engine's ack/snooze/escalation all work on it for free.
CREATE TABLE IF NOT EXISTS apigw_probe_log (
  id        bigserial PRIMARY KEY,
  probed_at timestamptz NOT NULL DEFAULT now(),
  node      text NOT NULL,
  label     text NOT NULL,
  host      text NOT NULL,
  port      integer NOT NULL,
  state     text NOT NULL,            -- ok | refused | timeout | error
  ms        integer
);
CREATE INDEX IF NOT EXISTS idx_apigw_probe_time ON apigw_probe_log (probed_at DESC);
CREATE INDEX IF NOT EXISTS idx_apigw_probe_target ON apigw_probe_log (host, port, probed_at DESC);

-- Internal console tickets / feedback. Any authed console user raises a suggestion (enhancement) or
-- a problem (issue), optionally with screenshot(s) + a description. Screenshots are stored ON DISK
-- under UPLOAD_DIR/tickets (default /apps/console/uploads/tickets) — the DB keeps metadata only.
-- Board (manageUsers cap) drives status: open | under_evaluation | in_progress | closed | rejected.
-- Descriptions are the user's OWN report — deliberately NOT PII-masked (the board is admin-only).
CREATE TABLE IF NOT EXISTS console_tickets (
  id          bigserial PRIMARY KEY,
  ref         text UNIQUE NOT NULL,               -- human reference, e.g. TKT-000123
  kind        text NOT NULL DEFAULT 'issue',      -- enhancement | issue
  title       text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'open',       -- open | under_evaluation | in_progress | closed | rejected
  priority    text NOT NULL DEFAULT 'normal',     -- low | normal | high | urgent
  created_by  text,
  evaluator   text,                               -- admin who last worked the ticket
  resolution  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);
-- business segment (unified console, alpha.8): mobile | fixed. Every ticket raised before the Fixed side existed was
-- about the MVNO console, so the default backfills them as 'mobile'.
ALTER TABLE console_tickets ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'mobile';
CREATE INDEX IF NOT EXISTS idx_console_tickets_segment ON console_tickets (segment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_console_tickets_status ON console_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_console_tickets_creator ON console_tickets (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_console_tickets_created ON console_tickets (created_at DESC);

CREATE TABLE IF NOT EXISTS console_ticket_files (
  id         bigserial PRIMARY KEY,
  ticket_id  bigint NOT NULL REFERENCES console_tickets(id) ON DELETE CASCADE,
  filename   text NOT NULL,                       -- original client name (display only — NEVER used as a path)
  path       text NOT NULL,                       -- absolute path on disk under UPLOAD_DIR/tickets
  mime       text NOT NULL,
  size       integer NOT NULL DEFAULT 0,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_console_ticket_files_ticket ON console_ticket_files (ticket_id, at);

CREATE TABLE IF NOT EXISTS console_ticket_comments (
  id         bigserial PRIMARY KEY,
  ticket_id  bigint NOT NULL REFERENCES console_tickets(id) ON DELETE CASCADE,
  author     text,
  body       text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_console_ticket_comments_ticket ON console_ticket_comments (ticket_id, at);

-- L2 Workbench · Docs hub. L2 uploads .md/.txt/.pdf runbooks; files live ON DISK under
-- UPLOAD_DIR/docs (default /apps/console/uploads/docs) — the DB keeps metadata + extracted text.
-- text_content is the parsed plain text: raw for .md/.txt; for .pdf it is filled via `pdftotext`
-- when present on PATH, else left NULL and marked "extraction pending" (NO new npm deps).
-- shared=true docs are additionally ingested by Yusr's KB (assist.js loadKb) as searchable chunks,
-- so an uploaded runbook becomes Yusr-answerable. Descriptions/content are the uploader's OWN
-- material — the section is L2+/admin only, so this text is deliberately NOT PII-masked.
CREATE TABLE IF NOT EXISTS console_docs (
  id           bigserial PRIMARY KEY,
  title        text NOT NULL,
  filename     text NOT NULL,                       -- original client name (display only — NEVER a path)
  path         text NOT NULL,                       -- absolute path on disk under UPLOAD_DIR/docs
  mime         text NOT NULL,
  size         integer NOT NULL DEFAULT 0,
  text_content text,                                -- parsed plain text (NULL = pdf extraction pending)
  uploaded_by  text,
  at           timestamptz NOT NULL DEFAULT now(),
  shared       boolean NOT NULL DEFAULT true        -- shared → ingested into Yusr's KB
);
CREATE INDEX IF NOT EXISTS idx_console_docs_at ON console_docs (at DESC);
CREATE INDEX IF NOT EXISTS idx_console_docs_uploader ON console_docs (uploaded_by, at DESC);

-- App error-log events (api_error_logger.production.log on the API hosts, pulled by
-- apiErrLogCollector over the same SSH channel as api_traffic_events). Powers the
-- Monitoring "App errors / rate limiting" panel: -704 = IpRetrial IP_RETRIES_EXCEEDED.
CREATE TABLE IF NOT EXISTS api_error_events (
  id           bigserial PRIMARY KEY,
  ts           timestamptz NOT NULL,
  host         text NOT NULL,
  level        text,
  error_code   integer,
  http_status  integer,
  source       text,
  controller   text,
  action       text,
  platform     text,
  app_version  text,
  ip_address   text,
  user_type    text,
  rate_limit   text,               -- context.rate_limit (e.g. 'ip_retrial')
  retry_count  integer,            -- context.retry_count at block time
  action_name  text,               -- context.action_name (voucher / validate_details…)
  message      text,
  request_id   text
);
CREATE INDEX IF NOT EXISTS idx_api_error_events_ts   ON api_error_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_api_error_events_code ON api_error_events (error_code, ts);

-- SMS gateway reachability probe (curl executed FROM the API hosts over the collector's SSH
-- channel — the app's own vantage point; 152 itself has no internet). Powers Monitoring ④.
CREATE TABLE IF NOT EXISTS sms_probe_events (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  host      text NOT NULL,            -- API host the curl ran from
  target    text NOT NULL,            -- probed URL
  http_code integer,                  -- NULL = transport failure (timeout/DNS/conn refused)
  ms        integer,
  error     text
);
CREATE INDEX IF NOT EXISTS idx_sms_probe_events_ts ON sms_probe_events (ts DESC);

-- Case-analyzer columns on the app-error events (trace_id = what the mobile app shows as
-- "Device ID" in its error dialog — the join key for CCO escalations)
ALTER TABLE api_error_events ADD COLUMN IF NOT EXISTS trace_id text;
ALTER TABLE api_error_events ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE api_error_events ADD COLUMN IF NOT EXISTS exception_class text;
ALTER TABLE api_error_events ADD COLUMN IF NOT EXISTS frame text;
CREATE INDEX IF NOT EXISTS idx_api_error_events_trace ON api_error_events (trace_id);
-- the case analyzer queries trace_id OR request_id OR device_id — all three need indexes for a
-- BitmapOr, one missing = sequential scan of the whole table on every Analyze click
CREATE INDEX IF NOT EXISTS idx_api_error_events_req ON api_error_events (request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_error_events_dev ON api_error_events (device_id)
  WHERE device_id IS NOT NULL;

-- Alert transparency (L2 request TKT-000002): which error codes / conditions trigger a rule.
-- Free text, shown on the Rules table, the rule editor and the alert detail.
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS trigger_codes text;

-- ── APIGW distributed traces (Zipkin on MVNO-DIGAPI-GWP01/02) ─────────────────────────────
-- The gateways run Spring Cloud Sleuth → Zipkin 2.23.2 with IN-MEMORY storage: ~4,100 spans/min
-- (~250k/hour) and a hard ceiling around 500k spans, measured as ~1–3h of retention. Traces
-- therefore VANISH unless pulled. 6M spans/day is far too much to keep raw, so the collector:
--   • ALWAYS writes per-minute aggregates (below) — cheap, permanent, powers panels + alerts
--   • writes FULL spans only for outliers (error tag or slow) — what L2 actually opens
-- Aggregate grain: minute × host × service × normalised path (numeric/uuid segments → :id).
CREATE TABLE IF NOT EXISTS apigw_trace_stats (
  bucket      timestamptz NOT NULL,        -- minute bucket (UTC)
  host        text NOT NULL,               -- gateway that served it
  service     text NOT NULL,               -- localEndpoint.serviceName
  path        text NOT NULL,               -- normalised http.path ('-' when absent)
  method      text,
  calls       integer NOT NULL,
  errors      integer NOT NULL DEFAULT 0,  -- error tag or http.status_code >= 400
  ms_p50      integer,
  ms_p95      integer,
  ms_p99      integer,
  ms_max      integer,
  ms_sum      bigint,
  PRIMARY KEY (bucket, host, service, path, method)
);
CREATE INDEX IF NOT EXISTS idx_apigw_stats_bucket ON apigw_trace_stats (bucket DESC);
CREATE INDEX IF NOT EXISTS idx_apigw_stats_path   ON apigw_trace_stats (path, bucket DESC);

-- Outlier spans kept in full for drill-down (join key to the app side: uil_transaction_id).
CREATE TABLE IF NOT EXISTS apigw_slow_spans (
  id           bigserial PRIMARY KEY,
  ts           timestamptz NOT NULL,
  host         text NOT NULL,
  trace_id     text NOT NULL,
  span_id      text,
  parent_id    text,
  service      text,
  kind         text,                       -- SERVER / CLIENT / CONSUMER / PRODUCER
  name         text,
  path         text,
  method       text,
  status_code  text,
  duration_ms  integer,
  remote_ip    text,
  remote_service text,
  error        text,
  uil_transaction_id text,                 -- ties APIGW ⇄ uil_logs (OSB/BSS read path)
  tags         jsonb
);
CREATE INDEX IF NOT EXISTS idx_apigw_spans_ts    ON apigw_slow_spans (ts DESC);
CREATE INDEX IF NOT EXISTS idx_apigw_spans_trace ON apigw_slow_spans (trace_id);
CREATE INDEX IF NOT EXISTS idx_apigw_spans_uil   ON apigw_slow_spans (uil_transaction_id);

-- ===== DMS JOURNEYS (31 Aug 2026) — dealer journey KPIs distilled from Clara dms_audit_logs =====
-- Same philosophy as apigw_trace_stats: aggregate per hour forever (tiny), keep FULL rows only
-- for notable events (failures), masked at ingest. Fed by dmsJourneys.js via id-watermark pulls
-- (never a time scan on the 365M-row tables — id is the PK, always indexed).
CREATE TABLE IF NOT EXISTS dms_journey_stats (
  bucket      timestamptz NOT NULL,          -- hour bucket (UTC)
  journey     text NOT NULL,                 -- registry key (activation, mnp, sim_swap, …)
  calls       integer NOT NULL DEFAULT 0,
  errors      integer NOT NULL DEFAULT 0,    -- conservative: response code looks 4xx/5xx/ERR
  dealers     integer NOT NULL DEFAULT 0,    -- distinct channel users seen in the bucket
  codes       jsonb,                         -- {"200":123,"E102":4,…} top response codes
  PRIMARY KEY (bucket, journey)
);
CREATE INDEX IF NOT EXISTS idx_dmsj_stats_bucket ON dms_journey_stats (bucket DESC);

CREATE TABLE IF NOT EXISTS dms_journey_state (
  journey     text PRIMARY KEY,
  last_id     bigint NOT NULL DEFAULT 0,     -- watermark on the source table's PK
  src         text,                          -- schema.table actually resolved
  rows_done   bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  note        text                           -- last error / resolution info, human-readable
);

CREATE TABLE IF NOT EXISTS dms_journey_events (   -- recent failures, PII masked at ingest
  id          bigserial PRIMARY KEY,
  journey     text NOT NULL,
  src_id      bigint,
  at          timestamptz,
  dealer      text,
  msisdn      text,                          -- masked
  customer    text,                          -- masked national id
  code        text,
  message     text,
  ref         text,                          -- logs_reference_id — cross-journey correlation key
  api         text
);
CREATE INDEX IF NOT EXISTS idx_dmsj_events ON dms_journey_events (journey, at DESC);
CREATE INDEX IF NOT EXISTS idx_dmsj_events_ref ON dms_journey_events (ref);

-- 31 Aug 2026 (evening): two more dimensions per bucket, captured at sync time — which APIs and
-- which dealers were behind each hour. jsonb like codes; idempotent ALTERs (schema.sql re-runs at boot).
ALTER TABLE dms_journey_stats ADD COLUMN IF NOT EXISTS apis jsonb;
ALTER TABLE dms_journey_stats ADD COLUMN IF NOT EXISTS top_dealers jsonb;

-- LIVE CUSTOMER VIEW snapshot cache (Sub360 · 2 Sep 2026). jsonb is TOAST-compressed by PG.
-- Also created at runtime by liveBss.ensure() so a deploy without db-init still works.
CREATE TABLE IF NOT EXISTS live_snapshots (
  id bigserial PRIMARY KEY, cust text NOT NULL, panel text NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(), ms integer, http integer, ok boolean,
  endpoint text, request jsonb, response jsonb);
CREATE INDEX IF NOT EXISTS idx_live_snap ON live_snapshots (cust, panel, taken_at DESC);
