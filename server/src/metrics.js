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

// Business/Technical split — classCaseSql is the console-wide SSOT (errclass.js); used by the
// *_technical / *_business metric variants so alert rules can be enabled per class.
const { classCaseSql } = require('./errclass');

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

/* Payment-gateway normaliser — kept identical to GW_EXPR in errors.js so the metric,
 * the Troubleshoot feed and the gateway breakdown all bucket a transaction the same way.
 * If you edit one, edit the other. */
const GW_CASE = `CASE
    WHEN lower(coalesce(vendor,'')) LIKE '%samsung%' OR lower(coalesce(payment_method,'')) LIKE '%samsung%' THEN 'Samsung Pay'
    WHEN lower(coalesce(vendor,'')) LIKE '%merchalink%' OR lower(coalesce(vendor,'')) LIKE '%upg%' OR lower(coalesce(vendor,'')) = 'salam' THEN 'UPG'
    WHEN lower(coalesce(vendor,'')) LIKE '%hyperpay%' THEN 'HyperPay'
    WHEN lower(coalesce(vendor,'')) LIKE '%tap%' THEN 'Tap'
    WHEN lower(coalesce(vendor,'')) LIKE '%tamara%' THEN 'Tamara'
    WHEN lower(coalesce(vendor,'')) LIKE '%emkan%' THEN 'Emkan'
    WHEN lower(coalesce(payment_method,'')) LIKE '%apple%' THEN 'Apple Pay'
    WHEN lower(coalesce(payment_method,'')) LIKE '%stc%' THEN 'STC Pay'
    ELSE COALESCE(NULLIF(vendor,''),'Other') END`;

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

  /* Per-gateway successful-payment volume — the zero-success watchdog metric.
   * INC0014859 (UPG down, auto-failover to HyperPay) taught us that a *blended* fail-rate or
   * volume metric can't see a single gateway going dark: HyperPay absorbs the traffic, so the
   * platform totals stay healthy while UPG produces zero successes. This mirrors the ServiceNow
   * "UPG Payment Graph – No Success" monitor and the Semati zero-success watchdog.
   *
   * Emits one row per gateway with value = that gateway's successful count, but sample = TOTAL
   * successful payments across ALL gateways. Gating on the platform total (not the gateway's own
   * count) is the whole point: the rule fires when the platform is clearly live (>= min_sample
   * successes elsewhere) yet this gateway contributes zero — i.e. it's down and being failed over,
   * NOT "quiet at 3am". Primary gateways are always emitted (even at zero rows) so the watchdog can
   * actually fire on a hard zero instead of silently having no row to evaluate. */
  gateway_success_volume: {
    label: 'Successful payments by gateway', unit: 'count', higherIsBad: false,
    sourceTables: 'payments',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT (${GW_CASE}) AS gw,
               count(*) FILTER (WHERE status='success') AS ok
        FROM payments
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
        GROUP BY 1`, [now, w]);
      const okByGw = new Map();
      let total = 0;
      for (const r of rows) { const n = Number(r.ok) || 0; okByGw.set(r.gw, n); total += n; }
      // Always evaluate the real gateways, even when they produced zero rows in the window,
      // so a hard-zero (the outage signature) has a row for the rule to fire on.
      for (const gw of ['UPG', 'HyperPay', 'Tap']) if (!okByGw.has(gw)) okByGw.set(gw, 0);
      // Per-gateway rows only — no blended {} row (payment_volume already covers the platform total,
      // and no rule reads the blended dim here), so we write one fewer snapshot per sync tick.
      const out = [];
      for (const [gw, ok] of okByGw) out.push({ dim: { gateway: gw }, value: ok, sample: total });
      return out;
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
   * directly: non-terminal payments older than 30 min that should already have resolved. Counts ONLY
   * rows with a real commit response (gateway responded) — abandonment (pending, no commit = the
   * customer reached the page and left) is excluded, matching Payment#actual_pending? in selfcare. */
  payment_stuck_initiated: {
    label: 'Payments stuck (gateway committed, app unconfirmed)', unit: 'count', higherIsBad: true,
    sourceTables: 'payments',
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT grouping(vendor) AS gv, vendor, count(*) AS n
        FROM payments
        WHERE lower(status) IN ('pending','initiated')
          -- genuinely stuck only: gateway committed but app never finalised. A pending row with no
          -- commit response is the backend's "initiated" = customer reached the page and abandoned
          -- (NORMAL, not stuck). Mirrors Payment#actual_pending? in selfcare-backend.
          AND payment_commit_response IS NOT NULL
          AND payment_commit_response::text NOT IN ('', '{}', 'null')
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
      // BUSINESS refusals only (SEMATI_FAILED / MOBILE_EXISTS …): rows matching the 715
      // "Service Not Available" or transport signatures are excluded from BOTH numerator and
      // denominator — 715/transport now live exclusively in the technical metrics
      // (semati_provider_error_rate / semati_transport_error_rate / semati_success_volume),
      // so a provider outage can no longer inflate this rate. Mirrors eligibility_deny_rate.
      const prov = `(${SEM_TRANSPORT} OR ${SEM_UNAVAIL})`;
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE state = false AND NOT ${prov}) AS failed,
               count(*) FILTER (WHERE NOT ${prov})                   AS total
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

  /* Flapping — ok→provider-error transitions in the window. Catches the "success + Service Not
   * Available intermittently" pattern a flat threshold sails past. TECHNICAL by construction:
   * only flips INTO a 715 / transport row count (a flip into a business refusal like
   * MOBILE_EXISTS is just the chronic provisioning noise, not provider instability), so the
   * semati_flapping rule can carry alert_class 'technical' honestly. */
  semati_flapping: {
    label: 'Semati flapping (ok→provider-error transitions)', unit: 'count', higherIsBad: true,
    sourceTables: 'activation_logs,eligibility_logs',
    async compute(src, now, w) {
      const rows = await q(src, `
        WITH s AS (
          SELECT (state = false AND (${SEM_TRANSPORT} OR ${SEM_UNAVAIL})) AS provfail,
                 lag(state) OVER (ORDER BY created_at) AS prev
          FROM (${SEMATI_UNION}) u )
        SELECT count(*) FILTER (WHERE provfail AND prev=true) AS flips, count(*) AS total FROM s`, [now, w]);
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

  /* --- Activation failure rate split by error class (Semati excluded) ----------------------
   * Replaces the old MIXED activation_fail_storm rule: activation_fail_rate blended BSS platform
   * faults with Semati refusals, so no single alert_class was honest. These two variants classify
   * each failed row via classCaseSql (errclass.js SSOT: 1500/5xx/408/715 codes, timeouts, SOAP
   * faults, OSB-382000 → technical; well-formed refusals → business). Semati apis are EXCLUDED
   * from numerator AND denominator — Semati has its own dedicated rule family, and its chronic
   * ~45-55% refusal noise is exactly what forced the old rule up to 70%. Denominator is shared
   * (all non-Semati calls), so technical + business = bss_write_fail_rate. */
  activation_fail_rate_technical: {
    label: 'Activation (BSS) technical-failure rate (Semati excluded)', unit: 'rate', higherIsBad: true,
    sourceTables: 'activation_logs',
    async compute(src, now, w) {
      const cls = classCaseSql('status_code', `coalesce(response::text,'')`);
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE state IS DISTINCT FROM true AND (${cls}) = 'technical') AS failed,
               count(*) AS total
        FROM activation_logs
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
          AND COALESCE(api,'') NOT ILIKE '%semati%'`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  activation_fail_rate_business: {
    label: 'Activation (BSS) business-failure rate (Semati excluded)', unit: 'rate', higherIsBad: true,
    sourceTables: 'activation_logs',
    async compute(src, now, w) {
      const cls = classCaseSql('status_code', `coalesce(response::text,'')`);
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE state IS DISTINCT FROM true AND (${cls}) = 'business') AS failed,
               count(*) AS total
        FROM activation_logs
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
          AND COALESCE(api,'') NOT ILIKE '%semati%'`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  /* --- BSS-only activation health (Semati excluded) ---------------------------------------
   * WHY THIS EXISTS (2026-08-06, BSS 1500 / firewall-upgrade incident):
   * activation_fail_rate mixes BSS calls with Semati calls. Semati fails ~45-55% chronically, so
   * the storm rule had to sit at 70% to avoid crying wolf — which made it blind to a real BSS
   * degradation at 46%. Excluding Semati gives a near-zero baseline, so a modest threshold works.
   * Semati problems are NOT lost: they fire on semati_unavailable / semati_flapping instead. */
  bss_write_fail_rate: {
    label: 'BSS activation failure rate (Semati excluded)', unit: 'rate', higherIsBad: true,
    sourceTables: 'activation_logs',
    dims: ['api'],
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT grouping(api) AS ga, regexp_replace(api, '^/', '') AS api,
               count(*) FILTER (WHERE state IS DISTINCT FROM true) AS failed, count(*) AS total
        FROM activation_logs
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
          AND COALESCE(api,'') NOT ILIKE '%semati%'
        GROUP BY GROUPING SETS ((), (api))`, [now, w]);
      return rows.map(r => ({
        dim: Number(r.ga) === 1 ? {} : { api: r.api || 'unknown' },
        value: rate(r.failed, r.total), sample: Number(r.total) }));
    }
  },

  /* Absolute failure COUNT, not a rate. At 07:00 KSA the console saw n=13 activation calls — far
   * below any sane min_sample, so every rate rule sat out the incident. A count has no denominator
   * to be starved of: "6 BSS failures in 30 min" is a real signal at 03:00 and at 13:00 alike.
   * sample is set to the count itself so min_sample can never gate this metric out. */
  bss_fail_burst: {
    label: 'BSS activation failures (count, Semati excluded)', unit: 'count', higherIsBad: true,
    sourceTables: 'activation_logs',
    dims: ['api'],
    async compute(src, now, w) {
      const rows = await q(src, `
        SELECT grouping(api) AS ga, regexp_replace(api, '^/', '') AS api,
               count(*) FILTER (WHERE state IS DISTINCT FROM true) AS failed
        FROM activation_logs
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
          AND COALESCE(api,'') NOT ILIKE '%semati%'
        GROUP BY GROUPING SETS ((), (api))`, [now, w]);
      return rows.map(r => {
        const f = Number(r.failed || 0);
        return { dim: Number(r.ga) === 1 ? {} : { api: r.api || 'unknown' }, value: f, sample: f };
      });
    }
  },

  /* --- BSS SOAP fault 1500 on the WRITE path (INC0016809, 2026-08-06) ----------------------
   * IMPORTANT DISTINCTION — there are TWO different 1500s and only one of them is invisible here:
   *
   *   READ path   list-invoices / get-account / get-sub  → "OSB-382000 Client received SOAP Fault"
   *               logged in logs.uil_logs (OSB layer). NOT in this replica. Needs OSB_LOG_URL.
   *   WRITE path  createSubscriptionTransaction          → "unexpected XML tag … but found: Fault"
   *               THIS IS IN activation_logs. We can see it. INC0016809 was this one.
   *
   * INC0016809: a Cyber-Security firewall upgrade (CRQ000000190352) completed 05:00 KSA broke the
   * SOAP transport 172.20.10.194 → 172.20.8.56; BSS started returning a SOAP Fault where the
   * createSubscriptionTransactionResponse was expected. Ticket raised 06:23. The console showed
   * nothing, because no rule read the response code.
   *
   * Matched three ways because the payload shape varies (top-level key, nested, or string-encoded).
   * Absolute COUNT, not a rate — this fault is never normal, so one is interesting and five is an
   * incident regardless of traffic volume. */
  bss_soap_fault: {
    label: 'BSS SOAP faults (1500 — write path)', unit: 'count', higherIsBad: true,
    sourceTables: 'activation_logs',
    dims: ['api'],
    async compute(src, now, w) {
      const FAULT = `(
           COALESCE(status_code,'') = '1500'
        OR response->>'responseCode' = '1500'
        OR response::text ILIKE '%"responseCode":"1500"%'
        OR response::text ILIKE '%unexpected XML tag%'
        OR response::text ILIKE '%soap/envelope}Fault%')`;
      const rows = await q(src, `
        SELECT grouping(api) AS ga, regexp_replace(api, '^/', '') AS api, count(*) AS n
        FROM activation_logs
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
          AND ${FAULT}
        GROUP BY GROUPING SETS ((), (api))`, [now, w]);
      if (!rows.length) return [{ dim: {}, value: 0, sample: 0 }];
      return rows.map(r => {
        const n = Number(r.n || 0);
        return { dim: Number(r.ga) === 1 ? {} : { api: r.api || 'unknown' }, value: n, sample: n };
      });
    }
  },

  /* One BSS error code suddenly dominating is the signature of an upstream fault (a firewall change,
   * an OSB timeout, a Siebel deploy) rather than scattered per-customer errors. Reports the SHARE
   * held by the single most common failure code, with the code carried in the dim so the alert names
   * it — on 06 Aug that code would have read '1500'. */
  bss_top_error_share: {
    label: 'BSS dominant error code share', unit: 'rate', higherIsBad: true,
    sourceTables: 'activation_logs',
    dims: ['code'],
    async compute(src, now, w) {
      const rows = await q(src, `
        WITH f AS (
          SELECT COALESCE(NULLIF(status_code,''), response->>'responseCode', 'unknown') AS code
          FROM activation_logs
          WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz
            AND COALESCE(api,'') NOT ILIKE '%semati%'
            AND state IS DISTINCT FROM true)
        SELECT code, count(*) AS n, (SELECT count(*) FROM f) AS total
        FROM f GROUP BY code ORDER BY n DESC LIMIT 1`, [now, w]);
      if (!rows.length) return [{ dim: {}, value: null, sample: 0 }];
      const r = rows[0], total = Number(r.total || 0), n = Number(r.n || 0);
      // sample = the failing count, so the rule gates on "enough failures", not enough traffic
      return [{ dim: { code: r.code }, value: rate(n, total), sample: n }];
    }
  },

  /* --- API Gateway node reachability -------------------------------------------------------
   * Counts gateway nodes that USED TO BE reachable and no longer are. Baseline-relative on
   * purpose: two of the four gateway nodes (172.31.42.23/.24) have never been opened to this
   * host, so an absolute "any node unreachable" rule would fire forever and be muted within a
   * week. Same lesson as Semati's 55% baseline — alert on change from normal, not on a constant.
   *
   * Reads the CONSOLE db (apigw_probe_log), not the replica: this is our own probe's output.
   * A node is "known good" if it answered at least once in the last 7 days. */
  apigw_nodes_unreachable: {
    label: 'API GW nodes unreachable (was reachable)', unit: 'count', higherIsBad: true,
    sourceTables: 'apigw_probe_log',
    dims: ['label'],
    async compute(src, now, w) {
      const db = require('./db');
      const r = await db.console.query(`
        WITH latest AS (
          SELECT DISTINCT ON (host, port) host, port, label, state
          FROM apigw_probe_log
          WHERE probed_at >= $1::timestamptz - ($2||' hours')::interval AND probed_at < $1::timestamptz
          ORDER BY host, port, probed_at DESC
        ), baseline AS (
          SELECT host, port, bool_or(state = 'ok') AS ever_ok
          FROM apigw_probe_log
          WHERE probed_at >= $1::timestamptz - interval '7 days' AND probed_at < $1::timestamptz
          GROUP BY host, port
        )
        SELECT l.label, l.state, b.ever_ok
        FROM latest l JOIN baseline b ON b.host = l.host AND b.port = l.port`, [now, w]);
      const known = r.rows.filter(x => x.ever_ok);
      if (!known.length) return [{ dim: {}, value: null, sample: 0 }];
      const down = known.filter(x => x.state !== 'ok');
      const out = [{ dim: {}, value: down.length, sample: known.length }];
      // per-node rows so a rule can target one gateway, and so the alert names it
      for (const k of known) out.push({ dim: { label: k.label }, value: k.state === 'ok' ? 0 : 1, sample: 1 });
      return out;
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

  /* Change Plan failure rate split by error class — replaces the old MIXED change_plan_fail_spike.
   * change_plan_logs has no status_code, but final_step_message carries the real error text
   * ("Failed, Net::ReadTimeout…", "Failed, Error 16 - Unable to update Subscription…",
   * "Customer nationality returned empty from BSS" — change_plan_manager.rb / failure_handler.rb),
   * so classCaseSql can split honestly: timeouts/SOAP/transport → technical; well-formed BSS/policy
   * refusals → business. Shared denominator (status IN success,failed) so the two variants sum to
   * change_plan_fail_rate. */
  change_plan_fail_rate_technical: {
    label: 'Change Plan technical-failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'change_plan_logs',
    async compute(src, now, w) {
      const cls = classCaseSql('NULL::text', `coalesce(final_step_message,'')`);
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE status = 2 AND (${cls}) = 'technical') AS failed,
               count(*) FILTER (WHERE status IN (1,2)) AS total
        FROM change_plan_logs
        WHERE created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  change_plan_fail_rate_business: {
    label: 'Change Plan business-failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'change_plan_logs',
    async compute(src, now, w) {
      const cls = classCaseSql('NULL::text', `coalesce(final_step_message,'')`);
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE status = 2 AND (${cls}) = 'business') AS failed,
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

  /* Reseller courier NOT created — a PAID reseller (tygo/soob) order that required courier delivery
   * (apollo_require_delivery not explicitly false) yet has NO delivery_requests row. Backend
   * (commit_worker.rb) dispatches resellers through the SAME oto/tam carriers as everyone, so a
   * missing row is a real dispatch backlog, not self-fulfilment (proven on live data 2026-08-10:
   * 106 such orders in one day, hidden inside the old "Partner" box). `w` is the GRACE age in hours:
   * only orders older than `w` count, so freshly-paid orders the worker hasn't processed yet don't
   * false-alarm. Bounded to the last 24h so ancient cruft can't inflate a live outage signal. */
  courier_backlog: {
    label: 'Reseller courier not dispatched (paid, no delivery request)', unit: 'count', higherIsBad: true,
    sourceTables: 'onboarding_orders,payments,delivery_requests',
    async compute(src, now, w) {
      const RESELLERS = ['tygo', 'soob'];
      const rows = await q(src, `
        SELECT count(*) AS n
        FROM onboarding_orders oo
        WHERE lower(coalesce(oo.external_service_name,'')) = ANY($3::text[])     -- reseller (tygo/soob)
          AND coalesce(oo.sim_type,0) <> 1                                       -- physical SIM (not eSIM)
          AND lower(coalesce(oo.extra->>'apollo_require_delivery','')) <> 'false' -- courier required:
          AND lower(coalesce(oo.extra->>'apollo_require_delivery','')) <> 'f'     --   flag not explicitly
          AND lower(coalesce(oo.extra->>'apollo_require_delivery','')) <> '0'     --   false (true/absent)
          AND oo.created_at >= $1::timestamptz - interval '24 hours'             -- recent window only
          AND oo.created_at <  $1::timestamptz - ($2||' hours')::interval        -- older than grace age
          AND EXISTS (SELECT 1 FROM payments p WHERE p.payment_on_type='OnboardingOrder'
                        AND p.payment_on_id = oo.id::text AND p.status='success') -- paid
          AND NOT EXISTS (SELECT 1 FROM delivery_requests d
                           WHERE d.delivery_on_id = oo.id::text)                  -- no courier row
        `, [now, w, RESELLERS]);
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
                       WHERE p.payment_on_type = 'Checkout'
                         AND p.id::text = change_plan_logs.payment_id AND c.checkout_type = 5)
          AND created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  /* Ownership-transfer failure rate split by error class — replaces the old MIXED
   * ownership_fail_spike. Same table + join as ownership_fail_rate (change_plan_logs scoped to
   * checkout_type=5), same final_step_message split as the change_plan variants: the Nafath
   * transfer_ownership refusals and BSS policy "no"s classify business; timeouts / SOAP / BSS
   * transport faults classify technical. Two variants sum to ownership_fail_rate. */
  ownership_fail_rate_technical: {
    label: 'Ownership-transfer technical-failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'change_plan_logs',
    async compute(src, now, w) {
      const cls = classCaseSql('NULL::text', `coalesce(final_step_message,'')`);
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE status = 2 AND (${cls}) = 'technical') AS failed,
               count(*) FILTER (WHERE status IN (1,2)) AS total
        FROM change_plan_logs
        WHERE EXISTS (SELECT 1 FROM payments p JOIN checkouts c ON c.id::text = p.payment_on_id
                       WHERE p.payment_on_type = 'Checkout'
                         AND p.id::text = change_plan_logs.payment_id AND c.checkout_type = 5)
          AND created_at >= $1::timestamptz - ($2||' hours')::interval AND created_at < $1::timestamptz`, [now, w]);
      return [{ dim: {}, value: rate(rows[0].failed, rows[0].total), sample: Number(rows[0].total) }];
    }
  },

  ownership_fail_rate_business: {
    label: 'Ownership-transfer business-failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'change_plan_logs',
    async compute(src, now, w) {
      const cls = classCaseSql('NULL::text', `coalesce(final_step_message,'')`);
      const rows = await q(src, `
        SELECT count(*) FILTER (WHERE status = 2 AND (${cls}) = 'business') AS failed,
               count(*) FILTER (WHERE status IN (1,2)) AS total
        FROM change_plan_logs
        WHERE EXISTS (SELECT 1 FROM payments p JOIN checkouts c ON c.id::text = p.payment_on_id
                       WHERE p.payment_on_type = 'Checkout'
                         AND p.id::text = change_plan_logs.payment_id AND c.checkout_type = 5)
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
        WHERE p.payment_on_type = 'Checkout'   -- polymorphic: never join payment_on_id without its type
          AND c.checkout_type = 6
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
    label: 'Dealer (DMS) commissioned orders', unit: 'count', higherIsBad: false,
    sourceTables: 'seller_deductions',
    async compute(src, now, w) {
      // count DISTINCT orders, not deduction rows: an order can carry multiple seller_deductions
      // (commission retry/adjustment), which inflated the count exactly when commissioning misbehaved.
      const rows = await q(src, `
        SELECT count(DISTINCT onboarding_order_id) AS n, count(DISTINCT seller_id) AS dealers
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
  },

  /* ---------------- DIGITAL API TRAFFIC (SSH collector PG · fallback grafana MySQL) --------
   * Source dispatch lives in apiTraffic.js: with API_LOG_HOSTS set, p95Stats/techFailStats read
   * the console-DB api_traffic_events table (filled by apiLogCollector.js over SSH, err_class
   * precomputed); otherwise the Grafana "Digital-API traffic" MySQL DB fed by the api_logger
   * cron parser. NOT the replica: `src`/`now` are ignored — the traffic source is
   * LIVE-anchored (windows end at UTC now), so replay/simulate ticks read the current window.
   * Both metrics return [] when neither source is configured or the source errors: the rule then
   * sees "no data in window" and stays quiet — same inert-until-configured UX as the OSB watcher.
   *
   * THRESHOLD DESIGN (api_latency_p95): snapshots store value = p95 / effective-threshold, where
   * the effective threshold comes from console_settings 'api_latency_thresholds'
   * ({ globalMs, perApi:{path:ms} } — edited on the Monitoring page, manageSync + audited).
   * That keeps the alertRunner comparator untouched: the rule is a plain 'gte 1.0' (unit ratio →
   * renders as %, i.e. 120% = 20% over ITS OWN threshold), and each per-API dim row breaches its
   * own override while the {} row tracks the global threshold. Row order matters: the GLOBAL row
   * is emitted FIRST so a rule with an empty dim latches onto it (established console convention),
   * and a '(worst)' row carries the max per-API ratio so one rule covers every override. */
  api_latency_p95: {
    label: 'Digital-API p95 latency vs threshold', unit: 'ratio', higherIsBad: true,
    sourceTables: 'api_traffic_events (collector) / transaction_logs (grafana MySQL)',
    dims: ['api'],
    async compute(src, now, w) {
      const at = require('./apiTraffic');
      if (!at.configured()) return [];
      try {
        const th = await at.latencyThresholds();
        const s = await at.p95Stats({ hours: Math.max(1, Math.round(w)) });
        const rows = [];
        if (s.global && s.global.p95 != null)
          rows.push({ dim: {}, value: s.global.p95 / th.globalMs, sample: s.global.count });
        let worst = null;
        for (const r of s.byApi) {
          if (r.p95 == null) continue;
          const lim = th.perApi[r.api] > 0 ? th.perApi[r.api] : th.globalMs;
          const ratio = r.p95 / lim;
          rows.push({ dim: { api: r.api }, value: ratio, sample: r.count });
          if (!worst || ratio > worst.value) worst = { dim: { api: '(worst)', offender: r.api }, value: ratio, sample: r.count };
        }
        if (worst) rows.push(worst);
        return rows;
      } catch (e) { console.error('api_latency_p95 skipped: ' + e.message); return []; }
    }
  },

  /* Share of Digital-API calls failing with TECHNICAL signatures (errclass mirror on
   * response_code + response_message: 1500/5xx/408/715, timeouts, SOAP/OSB faults, transport).
   * Global {} row first, then per-API rows for drill-down/rule targeting. */
  api_technical_fail_rate: {
    label: 'Digital-API technical-failure rate', unit: 'rate', higherIsBad: true,
    sourceTables: 'api_traffic_events (collector) / transaction_logs (grafana MySQL)',
    dims: ['api'],
    async compute(src, now, w) {
      const at = require('./apiTraffic');
      if (!at.configured()) return [];
      try {
        const s = await at.techFailStats({ hours: Math.max(1, Math.round(w)) });
        const rows = [{ dim: {}, value: s.global.rate, sample: s.global.total }];
        for (const r of s.byApi) rows.push({ dim: { api: r.api }, value: r.rate, sample: r.total });
        return rows;
      } catch (e) { console.error('api_technical_fail_rate skipped: ' + e.message); return []; }
    }
  },

  /* ---- App error-log metrics (api_error_events ← api_error_logger on 17/18) --------------
   * Counts per window, categorized via appErrCatalog (source-derived). All PROVISIONAL
   * thresholds in seedRules — calibrate against the live baselines after a few days. */
  app_ip_block_count: {
    label: 'IP rate-limit blocks (-704)', unit: 'count', higherIsBad: true,
    sourceTables: 'api_error_events (app error log)',
    async compute(src, now, w) {
      try { const db = require('./db');
        const r = await db.console.query(
          `SELECT count(*)::int n FROM api_error_events WHERE rate_limit='ip_retrial' AND ts > now() - ($1||' hours')::interval`, [Math.max(1, Math.round(w))]);
        return [{ dim: {}, value: r.rows[0].n, sample: r.rows[0].n }];
      } catch (e) { return []; }
    }
  },
  /* RECHARGE / BILL-PAY LOOKUP (27 Sep 2026 — the CIO's "We detected an error!" on my.salammobile.sa › Recharge
   * number). Failures of Api::V1::RechargeController#validate_details / #validate_details_with_account in the app
   * error log, EXCLUDING the IP-limiter blocks (-704 — app_ip_block_* own them). The recharge funnel used to start at
   * the payment row (recharge_fail_rate, checkout_type 6): a customer refused at the lookup step never reaches it.
   * The app logs failures only, so this is a COUNT per window with the code as a dimension:
   *   -112 unknown number · -512 "suspended" = ANY gateway/BSS failure on the profile read (or a profile without
   *   accountID) · -513 still PENDING (10-min profile cache after activation) · -501 backend error = the postpaid
   *   due-amount path (/bss/account/get-account-profile/v2 + execute-account-blnc-query). A true rate needs the app to
   *   log successes for this endpoint (one line in the app; the collector already parses the file). */
  recharge_lookup_failures: {
    label: 'Recharge / bill-pay lookup failures (validate_details, excl. IP blocks)', unit: 'count', higherIsBad: true,
    sourceTables: 'api_error_events (app error log)', dims: ['code'],
    async compute(src, now, w) {
      try { const db = require('./db');
        const r = await db.console.query(
          `SELECT error_code::text AS code, count(*)::int n FROM api_error_events
            WHERE controller = 'Api::V1::RechargeController'
              AND coalesce(action, action_name, '') IN ('validate_details', 'validate_details_with_account')
              AND coalesce(rate_limit, '') <> 'ip_retrial' AND coalesce(error_code, 0) <> -704
              AND ts >= $1::timestamptz - ($2||' hours')::interval AND ts < $1::timestamptz
            GROUP BY 1`, [now, Math.max(1, Math.round(w))]);
        const tot = r.rows.reduce((a, x) => a + x.n, 0);
        return [{ dim: {}, value: tot, sample: tot }, ...r.rows.map(x => ({ dim: { code: x.code }, value: x.n, sample: x.n }))];
      } catch (e) { return []; }
    }
  },
  /* REFUND EXPOSURE (25 Sep 2026, refundRadar.js): money the platform already owes customers, detected before the
   * complaint — paid-not-activated, port-in twice, change plan charged then failed, SIM replacement paid, delivery
   * failed on a paid order, charged twice. Counts NEW candidates detected in the window (surge = a broken flow), and
   * the OPEN backlog (nobody refunding). */
  refund_exposure_new: {
    label: 'Refund exposure — new candidates detected', unit: 'count', higherIsBad: true,
    sourceTables: 'refund_candidates (console, from payments/orders/activation/change_plan/delivery)',
    async compute(src, now, w) {
      try { const db = require('./db');
        const r = await db.console.query(`SELECT kind, count(*)::int n, coalesce(sum(amount),0)::float sar FROM refund_candidates WHERE detected_at >= $1::timestamptz - ($2||' hours')::interval AND detected_at < $1::timestamptz GROUP BY 1`, [now, w]);
        const tot = r.rows.reduce((a, x) => a + x.n, 0);
        return [{ dim: {}, value: tot, sample: tot }, ...r.rows.map(x => ({ dim: { kind: x.kind }, value: x.n, sample: x.n }))];
      } catch (e) { return []; }
    }
  },
  refund_exposure_open_sar: {
    label: 'Refund exposure — open backlog (SAR)', unit: 'count', higherIsBad: true,
    sourceTables: 'refund_candidates (console)',
    async compute(src, now, w) {
      try { const db = require('./db');
        const r = await db.console.query(`SELECT count(*)::int n, coalesce(sum(amount),0)::float sar FROM refund_candidates WHERE status = 'open'`);
        return [{ dim: {}, value: Math.round(r.rows[0].sar), sample: r.rows[0].n }];
      } catch (e) { return []; }
    }
  },
  /* THE DESK SLAs (26 Sep 2026, Teams management › Refund desks — refundDesk.slaStatus): the two clocks of the Mobile
   * desk. approval = cases in a sent approval request with no decision after approve_within_h (default 24 h);
   * execution = approved cases the proxycms register does not show refunded after refund_within_h (default 48 h).
   * value = overdue now, sample = waiting now. Both rules are P4 — internal tickets chased by the ack ladder. */
  refund_sla_approval_overdue: {
    label: 'Refund approval overdue — request sent, no decision within the desk SLA', unit: 'count', higherIsBad: true,
    sourceTables: 'refund_candidates + refund_batches (console)',
    async compute(src, now, w) {
      try { const desk = require('./refundDesk'); const s = await desk.slaStatus(await desk.getPolicy('mobile'));
        return [{ dim: {}, value: s.approval.overdue, sample: s.approval.waiting }]; } catch (e) { return []; }
    }
  },
  refund_sla_execution_overdue: {
    label: 'Refund execution overdue — approved, not posted in proxycms within the desk SLA', unit: 'count', higherIsBad: true,
    sourceTables: 'refund_candidates (console) ↔ refunds (replica of proxycms, via the radar correlation)',
    async compute(src, now, w) {
      try { const desk = require('./refundDesk'); const s = await desk.slaStatus(await desk.getPolicy('mobile'));
        return [{ dim: {}, value: s.execution.overdue, sample: s.execution.waiting }]; } catch (e) { return []; }
    }
  },
  /* THE LEDGER SIDE (26 Sep 2026): proxycms `refunds` rows whose gateway request FAILED (status 'fail' — Refund#update_response
   * puts the payment back to 'success' and the customer still has no money). Replica table, present once prodSync has
   * copied it; before that the metric simply returns nothing. */
  refund_gateway_failed: {
    label: 'Refunds failed at the gateway (proxycms)', unit: 'count', higherIsBad: true,
    sourceTables: 'refunds (replica of proxycms)',
    async compute(src, now, w) {
      try { const db = require('./db');
        const ok = await db.source.query(`SELECT to_regclass('public.refunds') r`); if (!ok.rows[0] || !ok.rows[0].r) return [];
        const r = await db.source.query(`SELECT count(*)::int n, count(*) FILTER (WHERE status = 'fail')::int failed FROM refunds WHERE updated_at >= $1::timestamp - ($2||' hours')::interval AND updated_at < $1::timestamp`, [now, w]);
        return [{ dim: {}, value: r.rows[0].failed, sample: r.rows[0].n }];
      } catch (e) { return []; }
    }
  },
  /* ONBOARDING FLOW GUARD (29 Sep 2026, flowGuard.js — TKT-000068): orders placed through a flow the business never
   * approved, read from the console's flow_findings. value = findings ACTIVATED in the window (a customer went through),
   * sample = every finding incl. attempts the purchase step refused. The *_attempts variants count the attempts. */
  onboarding_flow_vanity_prepaid: {
    label: 'Vanity number activated on a prepaid plan', unit: 'count', higherIsBad: true,
    sourceTables: 'flow_findings (console, from numbers + onboarding_orders + plans)',
    async compute(src, now, w) { try { return await require('./flowGuard').metric('vanity_prepaid', now, w); } catch (e) { return []; } }
  },
  onboarding_flow_vanity_prepaid_attempts: {
    label: 'Vanity number chosen with a prepaid plan (attempts, activated or not)', unit: 'count', higherIsBad: true,
    sourceTables: 'flow_findings (console)',
    async compute(src, now, w) { try { return await require('./flowGuard').metric('vanity_prepaid', now, w, { attempts: true }); } catch (e) { return []; } }
  },
  onboarding_flow_plan_disabled: {
    label: 'Order activated on a plan disabled at order time', unit: 'count', higherIsBad: true,
    sourceTables: 'flow_findings + plan_state_history (console)',
    async compute(src, now, w) { try { return await require('./flowGuard').metric('plan_disabled', now, w); } catch (e) { return []; } }
  },
  onboarding_flow_plan_disabled_attempts: {
    label: 'Orders placed on a plan disabled at order time (attempts, activated or not)', unit: 'count', higherIsBad: true,
    sourceTables: 'flow_findings + plan_state_history (console)',
    async compute(src, now, w) { try { return await require('./flowGuard').metric('plan_disabled', now, w, { attempts: true }); } catch (e) { return []; } }
  },
  onboarding_flow_class_mismatch: {
    label: 'Number class ↔ plan mismatch activated (data SIM vs voice)', unit: 'count', higherIsBad: true,
    sourceTables: 'flow_findings (console)',
    async compute(src, now, w) { try { return await require('./flowGuard').metric('class_mismatch', now, w); } catch (e) { return []; } }
  },
  app_crash_count: {
    label: 'App crashes (unhandled exceptions → -501)', unit: 'count', higherIsBad: true,
    sourceTables: 'api_error_events (app error log)',
    async compute(src, now, w) {
      try { const db = require('./db');
        const r = await db.console.query(
          `SELECT count(*)::int n FROM api_error_events WHERE error_code=-501 AND exception_class IS NOT NULL AND ts > now() - ($1||' hours')::interval`, [Math.max(1, Math.round(w))]);
        return [{ dim: {}, value: r.rows[0].n, sample: r.rows[0].n }];
      } catch (e) { return []; }
    }
  },
  app_auth_fail_count: {
    label: 'Auth/session failures (tokens · logins)', unit: 'count', higherIsBad: true,
    sourceTables: 'api_error_events (app error log)',
    async compute(src, now, w) {
      try { const db = require('./db');
        const r = await db.console.query(
          `SELECT count(*)::int n FROM api_error_events WHERE error_code IN (-201,-202,-203,-204,-205,-300,-301,-612) AND ts > now() - ($1||' hours')::interval`, [Math.max(1, Math.round(w))]);
        return [{ dim: {}, value: r.rows[0].n, sample: r.rows[0].n }];
      } catch (e) { return []; }
    }
  },
  app_backend_err_count: {
    label: 'Backend/provider errors (Optiva · TCC · unreachable)', unit: 'count', higherIsBad: true,
    sourceTables: 'api_error_events (app error log)',
    async compute(src, now, w) {
      try { const db = require('./db');
        const r = await db.console.query(
          `SELECT count(*)::int n FROM api_error_events WHERE (error_code IN (-500,-702,-20003) OR (error_code=-501 AND exception_class IS NULL)) AND ts > now() - ($1||' hours')::interval`, [Math.max(1, Math.round(w))]);
        return [{ dim: {}, value: r.rows[0].n, sample: r.rows[0].n }];
      } catch (e) { return []; }
    }
  },
  /* OTP funnel (replica otps — needs 'otps' in prod-sync DEFAULT_TABLES) */
  otp_verify_rate: {
    label: 'OTP verify rate (sent → verified)', unit: 'rate', higherIsBad: false,
    sourceTables: 'otps (replica)',
    async compute(src, now, w) {
      try {
        const r = await src.query(
          `SELECT count(*)::int sent, count(*) FILTER (WHERE verified)::int ok
           FROM otps WHERE delivery_method='sms' AND created_at > now() - ($1||' hours')::interval`, [Math.max(1, Math.round(w))]);
        const { sent, ok } = r.rows[0];
        if (!sent) return [];
        return [{ dim: {}, value: ok / sent, sample: sent }];
      } catch (e) { return []; }
    }
  },
  /* SMS gateway reachability (sms_probe_events ← curl from the API hosts) */
  sms_probe_fail_count: {
    label: 'SMS gateway probe failures (Unifonic unreachable)', unit: 'count', higherIsBad: true,
    sourceTables: 'sms_probe_events (probe)',
    async compute(src, now, w) {
      try { const db = require('./db');
        const r = await db.console.query(
          `SELECT count(*)::int n, count(*) FILTER (WHERE http_code IS NULL)::int fails
           FROM sms_probe_events WHERE ts > now() - ($1||' hours')::interval`, [Math.max(1, Math.round(w))]);
        if (!r.rows[0].n) return [];   // probe not configured / no checks yet
        return [{ dim: {}, value: r.rows[0].fails, sample: r.rows[0].n }];
      } catch (e) { return []; }
    }
  }
};

/* ---------------- FIXED / SALAM HOME (unified console) ----------------
 * Computed from db.ops (sda_ops), not the selfcare replica — see fixedMetrics.js. Merged here so
 * the catalog seed (seedRules.CATALOG), sync.js and /api/rules/test pick them up unchanged.
 * Boot-time guards: every key must be `fixed_`-prefixed (plan §2.1) and unique across segments. */
{
  const FIXED = require('./fixedMetrics').METRICS;
  for (const k of Object.keys(FIXED)) {
    if (!k.startsWith('fixed_')) throw new Error(`fixedMetrics: key "${k}" must start with fixed_`);
    if (Object.prototype.hasOwnProperty.call(METRICS, k)) throw new Error(`metric key registered twice: ${k}`);
    METRICS[k] = FIXED[k];
  }
}

/* SQL fragments shared with alertCases.js (the row-level twin of every compute) — keep them in ONE place */
const SQL = { SEMATI_UNION, SEM_TRANSPORT, SEM_UNAVAIL, SEM_ENDPOINT, GW_CASE, NAFATH_SUCCESS, NAFATH_FAILED, DELIVERY_FAILED, DELIVERY_COMPLETED };
module.exports = { METRICS, SQL };
