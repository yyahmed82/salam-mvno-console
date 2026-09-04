WITH th(path, ms) AS (VALUES
  ('/bss/invoices/list-invoices',                              30000),
  ('/bss/mnp/create-port-order',                               25000),
  ('/bss/account/create-individual-subscriber',                15000),
  ('/bss/crm/list-resources',                                  12000),
  ('/bss/account/convert-billing-type',                        12000),
  ('/bss/subscription/update-subscription-price-plan-options',  9000),
  ('/bss/subscription/update-subscription-card-package',        9000),
  ('/bss/balance/validate-and-run-base-renewal',                9000),
  ('/bss/subscription/update-subscription-with-state-transition',9000),
  ('/semati/new-mobile-number',                                 6000),
  ('/semati/transfer-operator',                                 5000),
  ('/bss/subscription/update-subscription-recharge-voucher',    4500),
  ('/semati/check-eligibility',                                 4000),
  ('/bss/account/create-account',                               4000),
  ('/bss/card-package/list-card-packages-rest',                 4000)
),
s AS (
  SELECT path, count(*) AS n,
         round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric) AS p95
  FROM api_traffic_events
  WHERE duration_ms IS NOT NULL AND ts > now() - interval '12 hours'
  GROUP BY path
),
g AS (
  SELECT count(*) AS n,
         round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric) AS p95
  FROM api_traffic_events
  WHERE duration_ms IS NOT NULL AND ts > now() - interval '12 hours'
)
SELECT * FROM (
  SELECT '« GLOBAL »' AS path, g.n, g.p95, 3000 AS threshold_ms,
         round(100.0 * g.p95 / 3000) AS pct,
         CASE WHEN g.p95 >= 3000 THEN 'BREACH' WHEN g.p95 >= 2400 THEN 'WATCH' ELSE 'ok' END AS status
  FROM g
  UNION ALL
  SELECT s.path, s.n, s.p95, coalesce(th.ms, 3000),
         round(100.0 * s.p95 / coalesce(th.ms, 3000)),
         CASE WHEN s.p95 >= coalesce(th.ms, 3000) THEN 'BREACH'
              WHEN s.p95 >= 0.8 * coalesce(th.ms, 3000) THEN 'WATCH'
              ELSE 'ok' END
  FROM s LEFT JOIN th ON th.path = s.path
) x
ORDER BY (path <> '« GLOBAL »'), pct DESC;
