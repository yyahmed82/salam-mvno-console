/* Metric registry — computed from the selfcare prod-replica DB.
 * Each metric: { key, label, unit, higherIsBad, sourceTables, dims, compute(src, now, windowHours) }
 * compute() returns rows: [{ dim:{...}, value:Number|null, sample:Number }]
 * Timestamps in the source are UTC; KSA = UTC+3 (used for off-hours / working-hours).
 *
 * Success / failure definitions are centralized here so they can be tuned:
 *  - payments.status: 'success' vs 'failed' (pending excluded from rate denominator)
 *  - activation_logs.state boolean = success
 *  - eligibility_logs.state boolean = eligible/allowed
 *  - nafath_logs.status: from Nafath JWT — success='COMPLETED', failed IN (EXPIRED,REJECTED);
 *    pending (new/waiting) excluded from the rate denominator.  [callbacks_controller.rb]
 *  - change_plan_logs.status int enum {pending:0, success:1, failed:2}  [change_plan_log.rb]
 *  - delivery_requests.delivery_state: failed = cancelled+refused state lists;
 *    completed = MAPPED_COMPLETED_STATES (exact case).  [delivery_request.rb]
 *  - payments reported to ZATCA  ⇔  extra->>'zatca' is present.  [payment.rb#reported_to_zatca]
 */

// Nafath terminal states (lowercased for comparison)
const NAFATH_SUCCESS = ['completed'];
const NAFATH_FAILED  = ['expired', 'rejected', 'failed', 'cancelled', 'denied'];
// Delivery state lists — verbatim from DeliveryRequest (case-sensitive)
const DELIVERY_CANCELLED = ['cancelled','canceled','deleted','RTO','CANCELLED','PUX43','returned','reverseReturned','shipmentCanceled','reverseShipmentCanceled'];
const DELIVERY_REFUSED   = ['REFUSED','onhold','pickup_failed','DEX93','RD','DEX07-3','DEX07-4','DEX07-5','DEX07-6','DEX07-7','DEX07-8','DEX93-1','DEX93-2','DEX93-3','DEX93-4','DEX07'];
const DELIVERY_FAILED    = [...DELIVERY_CANCELLED, ...DELIVERY_REFUSED];
const DELIVERY_COMPLETED = ['complete','completed','DELIVERED','DL','DEX09','POD','Delivered','delivered'];

// helper: run a grouped rate/count query and shape rows
async function q(src, sql, params) {
  const r = await src.query(sql, params);
  return r.rows;
}
const rate = (num, den) => (den > 0 ? Number(num) / Number(den) : null);

/* --- Semati (TCC) provider connectivity — incident #28713 signatures ---
 * Semati is called from BOTH activation_logs and eligibility_logs (api ILIKE '%semati%').
 * status_code holds the code; the full body is in response (jsonb). Two failure layers:
 *   715  "Service is not available"                          → provider app up but refusing (APP layer)
 *   5002 "I/O error … Connection reset / SSLException", 408  → transport / TLS (INFRA layer)
 * These are distinct from semati_fail_rate (provisioning state=false). */
const SEMATI_UNION = `
  SELECT api, status_code, response, state, created_at FROM activation_logs
   WHERE api ILIKE '%semati%' AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
  UNION ALL
  SELECT api, status_code, response, state, created_at FROM eligibility_logs
   WHERE api ILIKE '%semati%' AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`;
const SEM_TRANSPORT = `(COALESCE(status_code,'') IN ('5002','408')
   OR response::text ILIKE '%Connection reset%' OR response::text ILIKE '%SSLException%'
   OR response::text ILIKE '%I/O error%' OR response::text ILIKE '%"responseCode":"5002"%'
   OR response::text ILIKE '%[408]%')`;
const SEM_UNAVAIL = `(COALESCE(status_code,'')='715'
   OR response::text ILIKE '%"responseCode":"715"%' OR response::text ILIKE '%not available%')`;
const SEM_ENDPOINT = `CASE WHEN api ILIKE '%login%' THEN 'login'
                           WHEN api ILIKE '%eligib%' THEN 'eligibility' ELSE 'other' END`;

const METRICS = {

  /* ---------------- PAYMENTS ---------------- */
  payment_fail_rate: {
    label: 'Payment failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'payments',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT grouping(platform) AS gp, grouping(vendor) AS gv,
               platform, vendor,
               count(*) FILTER (WHERE status IN ('fail','failed'))  AS failed,
               count(*) FILTER (WHERE status IN ('success','fail','failed')) AS total
        FROM payments
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
        GROUP BY GROUPING SETS ((), (platform), (vendor))`, [now, w]);
      return rows.map(r => {
        let d = {};
        if (Number(r.gv) === 0) d = { vendor: r.vendor || 'unknown' };
        else if (Number(r.gp) === 0) d = { platform: r.platform || 'unknown' };
        return { dim: d, value: rate(r.failed, r.total), sample: Number(r.total) };
      });
    }
  },

  payment_volume: {
    label: 'Successful payment volume', unit: 'count', higherIsBad: false,
    sourceTables: 'payments',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT grouping(platform) AS gp, platform,
               count(*) FILTER (WHERE status='success') AS ok
        FROM payments
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
        GROUP BY GROUPING SETS ((),(platform))`, [now, w]);
      return rows.map(r => ({ dim: Number(r.gp) === 1 ? {} : { platform: r.platform || 'unknown' }, value: Number(r.ok), sample: Number(r.ok) }));
    }
  },

  zatca_unreported: {
    label: 'Successful payments not reported to ZATCA', unit: 'count', higherIsBad: true,
    sourceTables: 'payments',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) AS n
        FROM payments
        WHERE status='success'
          AND created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
          AND COALESCE(NULLIF(extra->>'zatca',''), NULL) IS NULL`, [now, w]);
      return [{ dim: {}, value: Number(rows[0].n), sample: Number(rows[0].n) }];
    }
  },

  /* Issue #2 — "Payment Status Mismatch": app stays 'Initiated'/'pending' while Tap shows CAPTURED.
   * The Tap→app confirmation callback failed, so money is taken but the app shows unpaid. These rows
   * are INVISIBLE to payment_fail_rate (pending is excluded from its denominator), so we count them
   * directly: non-terminal payments older than 30 min that should already have resolved. */
  payment_stuck_initiated: {
    label: 'Payments stuck "Initiated" (never confirmed)', unit: 'count', higherIsBad: true,
    sourceTables: 'payments',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT grouping(vendor) AS gv, vendor, count(*) AS n
        FROM payments
        WHERE lower(status) IN ('pending','initiated')
          AND created_at >= $1::timestamptz - ($2||' hours')::interval
          AND created_at <  $1::timestamptz - interval '30 minutes'
        GROUP BY GROUPING SETS ((),(vendor))`, [now, w]);
      return rows.map(r => ({ dim: Number(r.gv) === 1 ? {} : { vendor: r.vendor || 'unknown' }, value: Number(r.n), sample: Number(r.n) }));
    }
  },

  /* Issue #1 — "Duplicate Amount Deduction": the same customer + amount + target charged successfully
   * 2+ times within 30 min = suspected double deduction (UPG/Tap captured twice for one order). This is
   * an APP-SIDE heuristic; the authoritative check is a Tap reconciliation feed (see the runbook). */
  payment_duplicate_suspect: {
    label: 'Suspected duplicate charges (same customer/amount)', unit: 'count', higherIsBad: true,
    sourceTables: 'payments',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) AS n FROM (
          SELECT customer_mobile_number, amount, payment_on_type, payment_on_id
          FROM payments
          WHERE status = 'success'
            AND created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
          GROUP BY customer_mobile_number, amount, payment_on_type, payment_on_id
          HAVING count(*) > 1 AND (max(created_at) - min(created_at)) < interval '30 minutes'
        ) d`, [now, w]);
      return [{ dim: {}, value: Number(rows[0].n), sample: Number(rows[0].n) }];
    }
  },

  /* ---------------- IDENTITY ---------------- */
  nafath_fail_rate: {
    label: 'Nafath verification failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'nafath_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE lower(status) = ANY($3)) AS failed,
               count(*) FILTER (WHERE lower(status) = ANY($3) OR lower(status) = ANY($4)) AS total
        FROM nafath_logs
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`,
        [now, w, NAFATH_FAILED, NAFATH_SUCCESS]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  semati_fail_rate: {
    label: 'Semati / MSISDN provisioning failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'activation_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE state = false) AS failed, count(*) AS total
        FROM activation_logs
        WHERE api ILIKE '%semati%'
          AND created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  /* Provider-connectivity health — the incident #28713 signal set. Headline metric:
   * share of Semati calls that are provider-unavailable (715) OR transport-failed
   * (5002 / Connection reset / SSLException / 408). Broken out per endpoint (login gates
   * everything downstream), so a rule can target dim:{endpoint:'login'}. */
  semati_provider_error_rate: {
    label: 'Semati provider errors (715 / connection reset)', unit: 'rate', higherIsBad: true,
    sourceTables: 'activation_logs,eligibility_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        WITH s AS (
          SELECT ${SEM_ENDPOINT} AS endpoint, (${SEM_TRANSPORT} OR ${SEM_UNAVAIL}) AS bad
          FROM (${SEMATI_UNION}) u )
        SELECT grouping(endpoint) AS ge, endpoint,
               count(*) FILTER (WHERE bad) AS bad, count(*) AS total
        FROM s GROUP BY GROUPING SETS ((),(endpoint))`, [now, w]);
      return rows.map(r => ({ dim: Number(r.ge) === 1 ? {} : { endpoint: r.endpoint || 'other' },
        value: rate(r.bad, r.total), sample: Number(r.total) }));
    }
  },

  /* Transport/TLS-only slice (5002 / Connection reset / SSLException / 408) — separated
   * from 715 because it points at network/TLS/provider-infra, not the provider app. */
  semati_transport_error_rate: {
    label: 'Semati transport errors (reset / SSL / 408)', unit: 'rate', higherIsBad: true,
    sourceTables: 'activation_logs,eligibility_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE ${SEM_TRANSPORT}) AS bad, count(*) AS total
        FROM (${SEMATI_UNION}) u`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].bad, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  /* HTTP 408 timeouts — the leading indicator (latency climbs → timeouts → connection resets). */
  semati_timeout_count: {
    label: 'Semati timeouts (HTTP 408)', unit: 'count', higherIsBad: true,
    sourceTables: 'activation_logs,eligibility_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) AS n FROM (${SEMATI_UNION}) u
        WHERE COALESCE(status_code,'')='408' OR response::text ILIKE '%[408]%' OR response::text ILIKE '%timeout%'`, [now, w]);
      return [{ dim: {}, value: Number(rows[0].n), sample: Number(rows[0].n) }];
    }
  },

  /* Zero-success watchdog — successful Semati calls in the window. Paired with a min_sample
   * rule (need N attempts) so operator 'lte 0' fires only on a hard-down with real traffic,
   * never on a quiet period. */
  semati_success_volume: {
    label: 'Semati successful calls', unit: 'count', higherIsBad: false,
    sourceTables: 'activation_logs,eligibility_logs',
    async compute(src, now, w) {
      const rows = await q(src, `SELECT count(*) FILTER (WHERE state=true) AS ok, count(*) AS total FROM (${SEMATI_UNION}) u`, [now, w]);
      return [{ dim: {}, value: Number(rows[0].ok), sample: Number(rows[0].total) }];
    }
  },

  /* Flapping — ok→fail transitions in the window. Catches the "success + Service Not Available
   * intermittently" pattern a flat threshold sails past. */
  semati_flapping: {
    label: 'Semati flapping (ok→fail transitions)', unit: 'count', higherIsBad: true,
    sourceTables: 'activation_logs,eligibility_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        WITH s AS (
          SELECT state, lag(state) OVER (ORDER BY created_at) AS prev
          FROM (${SEMATI_UNION}) u )
        SELECT count(*) FILTER (WHERE state=false AND prev=true) AS flips, count(*) AS total FROM s`, [now, w]);
      return [{ dim: {}, value: Number(rows[0].flips), sample: Number(rows[0].total) }];
    }
  },

  /* Composite: Semati AND Nafath both degraded = shared TCC/CITC upstream, not our side.
   * value = LEAST(semati_provider_error_rate, nafath_fail_rate) so it's high only when BOTH
   * are high; sample = min(totals) so the rule needs traffic on both. */
  citc_upstream_degraded: {
    label: 'CITC upstream degraded (Semati + Nafath together)', unit: 'rate', higherIsBad: true,
    sourceTables: 'activation_logs,eligibility_logs,nafath_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        WITH sem AS (
          SELECT count(*) FILTER (WHERE ${SEM_TRANSPORT} OR ${SEM_UNAVAIL}) AS bad, count(*) AS total
          FROM (${SEMATI_UNION}) u ),
        naf AS (
          SELECT count(*) FILTER (WHERE lower(status) = ANY($3)) AS bad,
                 count(*) FILTER (WHERE lower(status) = ANY($3) OR lower(status) = ANY($4)) AS total
          FROM nafath_logs
          WHERE created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz )
        SELECT CASE WHEN sem.total>0 THEN sem.bad::float/sem.total END AS sem_rate,
               CASE WHEN naf.total>0 THEN naf.bad::float/naf.total END AS naf_rate,
               LEAST(sem.total, naf.total) AS min_total
        FROM sem, naf`, [now, w, NAFATH_FAILED, NAFATH_SUCCESS]);
      const r = rows[0] || {};
      const sem = r.sem_rate == null ? null : Number(r.sem_rate);
      const naf = r.naf_rate == null ? null : Number(r.naf_rate);
      const val = (sem == null || naf == null) ? null : Math.min(sem, naf);
      return [{ dim: {}, value: val, sample: Number(r.min_total || 0) }];
    }
  },

  activation_fail_rate: {
    label: 'Activation (BSS) failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'activation_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT grouping(platform) AS gp, platform,
               count(*) FILTER (WHERE state=false) AS failed, count(*) AS total
        FROM activation_logs
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
        GROUP BY GROUPING SETS ((),(platform))`, [now, w]);
      return rows.map(r => ({ dim: Number(r.gp) === 1 ? {} : { platform: r.platform || 'unknown' }, value: rate(r.failed, r.total), sample: Number(r.total) }));
    }
  },

  eligibility_deny_rate: {
    label: 'Eligibility denial rate (CITC)', unit: 'rate', higherIsBad: true,
    sourceTables: 'eligibility_logs',
    async compute(src, now, w) {
      // A Semati provider error (715 / transport / timeout) is NOT a CITC "DENIED" — it's an outage.
      // Exclude those rows from BOTH numerator and denominator so a Semati outage can't inflate the
      // eligibility denial rate (they surface under the Semati provider alerts instead).
      const prov = `(${SEM_TRANSPORT} OR ${SEM_UNAVAIL})`;
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE state=false AND NOT ${prov}) AS denied,
               count(*) FILTER (WHERE NOT ${prov})               AS total
        FROM eligibility_logs
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].denied, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  /* ---------------- ONBOARDING / CONVERSION ---------------- */
  onboarding_created: {
    label: 'Onboarding orders created', unit: 'count', higherIsBad: false,
    sourceTables: 'onboarding_orders',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT grouping(delivery_type) AS gd, COALESCE(NULLIF(delivery_type,''),'—') AS dt, count(*) AS n
        FROM onboarding_orders
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
        GROUP BY GROUPING SETS ((),(delivery_type))`, [now, w]);
      return rows.map(r => ({ dim: Number(r.gd) === 1 ? {} : { delivery_type: r.dt }, value: Number(r.n), sample: Number(r.n) }));
    }
  },

  onboarding_conversion: {
    label: 'Onboarding conversion (completed / created)', unit: 'ratio', higherIsBad: false,
    sourceTables: 'onboarding_orders',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE completed) AS done, count(*) AS total
        FROM onboarding_orders
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].done, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  onboarding_abandoned: {
    label: 'Abandoned onboarding orders', unit: 'count', higherIsBad: true,
    sourceTables: 'onboarding_orders',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) AS n
        FROM onboarding_orders
        WHERE completed = false AND activated = false
          AND created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: Number(rows[0].n), sample: Number(rows[0].n) }];
    }
  },

  /* ---------------- PLAN CHANGE ---------------- */
  change_plan_fail_rate: {
    label: 'Change Plan failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'change_plan_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE status = 2) AS failed,
               count(*) FILTER (WHERE status IN (1,2)) AS total
        FROM change_plan_logs
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  /* ---------------- DELIVERY ---------------- */
  delivery_fail_rate: {
    label: 'Delivery failure/return rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'delivery_requests',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT grouping(vendor) AS gv, vendor,
               count(*) FILTER (WHERE delivery_state = ANY($3)) AS failed,
               count(*) AS total
        FROM delivery_requests
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
        GROUP BY GROUPING SETS ((),(vendor))`, [now, w, DELIVERY_FAILED]);
      return rows.map(r => ({ dim: Number(r.gv) === 1 ? {} : { vendor: r.vendor || 'unknown' }, value: rate(r.failed, r.total), sample: Number(r.total) }));
    }
  },

  delivery_stuck: {
    label: 'Deliveries submitted but stuck (> window)', unit: 'count', higherIsBad: true,
    sourceTables: 'delivery_requests',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) AS n
        FROM delivery_requests
        WHERE submitted = true
          AND COALESCE(delivery_state,'') <> ALL($3)   -- not completed
          AND COALESCE(delivery_state,'') <> ALL($4)   -- not failed/cancelled/refused
          AND created_at < $1::timestamptz - ($2||' hours')::interval`, [now, w, DELIVERY_COMPLETED, DELIVERY_FAILED]);
      return [{ dim: {}, value: Number(rows[0].n), sample: Number(rows[0].n) }];
    }
  },

  /* ---------------- CHANGE OWNERSHIP (checkout_type=5) ---------------- */
  // Ownership transfer = an OWNERSHIP_TRANSFER checkout (type 5) that produces a change_plan_log for
  // the new owner. Same join the Troubleshoot "Change Ownership" tile uses. status enum {0 pending,1 ok,2 fail}.
  ownership_fail_rate: {
    label: 'Ownership-transfer failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'change_plan_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE status = 2) AS failed,
               count(*) FILTER (WHERE status IN (1,2)) AS total
        FROM change_plan_logs
        WHERE EXISTS (SELECT 1 FROM payments p JOIN checkouts c ON c.id::text = p.payment_on_id
                       WHERE p.id::text = change_plan_logs.payment_id AND c.checkout_type = 5)
          AND created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  /* ---------------- RECHARGE / RENEWAL (checkout_type=6) ---------------- */
  // Plan renewal / recharge = a RENEWAL_TYPE checkout paid via a payment. Success ⇔ the payment succeeds.
  recharge_fail_rate: {
    label: 'Recharge / renewal payment failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'payments,checkouts',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE p.status IN ('fail','failed')) AS failed,
               count(*) FILTER (WHERE p.status IN ('success','fail','failed')) AS total
        FROM payments p JOIN checkouts c ON c.id::text = p.payment_on_id
        WHERE c.checkout_type = 6
          AND p.created_at >= $1::timestamptz - ($2||' hours')::interval AND p.created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  /* ---------------- SAMSUNG PAY (new integration) ---------------- */
  // Detected broadly: payment_method OR vendor matching '%samsung%'. New method launched recently, so
  // volume can be low — the rules use small min-samples to catch a bad launch/regression early.
  samsung_pay_fail_rate: {
    label: 'Samsung Pay failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'payments',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE status IN ('fail','failed')) AS failed,
               count(*) FILTER (WHERE status IN ('success','fail','failed')) AS total
        FROM payments
        WHERE (payment_method ILIKE '%samsung%' OR vendor ILIKE '%samsung%')
          AND created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  /* ---------------- COURIER PARTNER HEALTH ---------------- */
  // Worst single courier's failure/return rate (among couriers with a meaningful sample) — catches a
  // single-partner outage the blended delivery rate would hide. Per-vendor detail lives on Troubleshoot → Delivery.
  courier_worst_fail_rate: {
    label: 'Worst courier failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'delivery_requests',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT vendor,
               count(*) FILTER (WHERE delivery_state = ANY($3)) AS failed,
               count(*) AS total
        FROM delivery_requests
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
        GROUP BY vendor`, [now, w, DELIVERY_FAILED]);
      let worst = null;
      for (const r of rows) { const tot = Number(r.total); if (tot < 20) continue; const v = rate(r.failed, tot);
        if (v != null && (worst == null || v > worst.value)) worst = { value: v, sample: tot, vendor: r.vendor || 'unknown' }; }
      return [worst ? { dim: {}, value: worst.value, sample: worst.sample, vendor: worst.vendor } : { dim: {}, value: null, sample: 0 }];
    }
  },

  /* ---------------- DEALER / DMS ---------------- */
  dealer_activity: {
    label: 'Dealer (DMS) completed orders', unit: 'count', higherIsBad: false,
    sourceTables: 'seller_deductions',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) AS n, count(DISTINCT seller_id) AS dealers
        FROM seller_deductions
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: Number(rows[0].n), sample: Number(rows[0].dealers) }];
    }
  },

  offhours_orders: {
    label: 'Orders during KSA dead window (01:00–06:00)', unit: 'count', higherIsBad: true,
    sourceTables: 'onboarding_orders',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT count(*) AS n
        FROM onboarding_orders
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
          AND EXTRACT(hour FROM created_at + interval '3 hours') >= 1
          AND EXTRACT(hour FROM created_at + interval '3 hours') < 6`, [now, w]);
      return [{ dim: {}, value: Number(rows[0].n), sample: Number(rows[0].n) }];
    }
  }
};

module.exports = { METRICS };
