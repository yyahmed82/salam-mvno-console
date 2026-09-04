-- Timeline lookup indexes for the local replica (db.source = salam_development_11).
-- These speed the per-transaction "Transaction timeline" drawer, which looks up a customer's
-- events by mobile / national id / order id across several tables.
--
-- SAFE: CREATE INDEX CONCURRENTLY takes NO table lock (reads/writes continue). It is the
-- best-practice way to add an index to a live/large table. Run each statement on its own —
-- CONCURRENTLY cannot run inside a transaction block (so do NOT wrap in BEGIN/COMMIT).
-- These persist across prod-syncs (the sync writes data rows, not schema).
--
-- Run (from the console host, against the replica):
--   psql "$SOURCE_DATABASE_URL" -f server/db/timeline_indexes.sql
-- If a CONCURRENTLY build is interrupted it can leave an INVALID index; just DROP and re-run.

-- Nafath lookup by national id (58k rows, currently a seq scan)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nafath_logs_nid
  ON nafath_logs (nationality_id_number);

-- Plan-change lookup by mobile
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_change_plan_logs_mobile
  ON change_plan_logs (mobile_number);

-- Delivery lookup by receiver mobile (delivery_on_id already has a composite index)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_delivery_requests_receiver_mobile
  ON delivery_requests (receiver_mobile);

-- Payment lookup by the customer mobile (payment_on_id + target_mobile_number are already indexed)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_customer_mobile
  ON payments (customer_mobile_number);

-- Activation + eligibility lookups (added 17 Aug 2026 — the timeline now queries BOTH by
-- onboarding_order_id AND by msisdn, because BSS activation rows often carry a NULL order id.
-- The trgm GIN indexes serve ILIKE only; equality needs these B-trees.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activation_logs_msisdn
  ON activation_logs (msisdn);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activation_logs_order
  ON activation_logs (onboarding_order_id) WHERE onboarding_order_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eligibility_logs_msisdn
  ON eligibility_logs (msisdn);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eligibility_logs_order
  ON eligibility_logs (onboarding_order_id) WHERE onboarding_order_id IS NOT NULL;

-- OTP journey steps (timeline queries otp_for = ANY(mobile variants); the trgm GIN serves ILIKE only)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_otps_otp_for
  ON otps (otp_for);

-- Verify afterwards:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename IN ('nafath_logs','change_plan_logs','delivery_requests','payments',
--                       'activation_logs','eligibility_logs','otps')
--     AND indexname LIKE 'idx_%';
