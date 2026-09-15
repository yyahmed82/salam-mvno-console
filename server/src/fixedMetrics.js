/* Fixed / Salam Home metric registry — merged into metrics.js METRICS at boot (plan §2.1: every key
 * MUST start with `fixed_`). Same entry shape as the MVNO metrics:
 *   { label, unit, higherIsBad, sourceTables, segment:'fixed', compute(src, now, windowHours) → [{ dim, value, sample }] }
 *
 * DATA SOURCE — the sync loop calls compute(db.source, …) with the SELFCARE replica pool. Fixed
 * metrics IGNORE `src` and read the prod dealer-ops read model through require('./db').ops
 * (OPS_DATABASE_URL → sda_ops.public: order_attempts, dealers, error_events, incident_log).
 * When db.ops is null (env not set) every compute returns [] — exactly what a metric with no
 * rows does today: no metric_snapshots row is written, alertRunner reports "no data in window"
 * and the rule never fires. Never a throw, never a 500.
 *
 * SQL is ported 1:1 from salam-dealer-ops packages/api/src/alert-engine.ts (Prisma → pg).
 * KSA hour filters use `AT TIME ZONE 'Asia/Riyadh'` (the donor extracted the hour in the session
 * tz, i.e. UTC — this port fixes that so "01:00–06:00 KSA" really is KSA; expect small deltas).
 *
 * Donor rule `params` (windowMin, spike, offStart/offEnd, baselineDays, minDays…) are not wired
 * through the unified compute(src, now, w) signature, so the donor DEFAULTS are pinned here as
 * FIXED_PARAMS and echoed on each rule's `params` column for documentation only.
 *
 * Scoped ticket metrics (incident_*) emit one row per known scope with dim {scope}; the seeded
 * rules carry the same dim so alertRunner's subset dim-match selects the right row.
 *
 * fixed_sms_balance: the donor scrapes the Unifonic balance from a source api_logs file. There is
 * no such feed here — the metric returns [] unless FIXED_SMS_BALANCE_URL is set to a JSON endpoint
 * answering { "balance": <number>, "at": <iso>?, "recentSends": <number>? } (GET, 5 s timeout).
 * Nothing is fabricated when the env is absent. */

const FIXED_PARAMS = {
  errorSpike: 15, errorWindowMin: 60,     // error_p0p1_categories
  timeoutWindowMin: 30,                   // timeout_dealers
  offStart: 1, offEnd: 6,                 // offhours_sda_attempts (KSA)
  baselineDays: 7,                        // workhours_activity_ratio
  minDays: 3, minBaseline: 5, minWindowAttempts: 3 // dealer_stagnation_count
};
// theme keywords the seeded ticket rules scope on (donor BUILTIN_RULES.scope) — ILIKE '%scope%' on incident_log.theme
const TICKET_SCOPES = ['API error', 'Payment', 'Gateway'];
const FIVE_G = ['fiveGWhiteLabel', 'fiveGFWA'];

// Error taxonomy severity — mirror of the donor's ERR_SEV (error-taxonomy.ts) for the P0/P1 metric.
const ERR_SEV = {
  PAYMENT_NOT_NOTIFIED: { sev: 1, money: true }, PROVISION_NO_ORDER: { sev: 1, money: true },
  PAYMENT_FAILED: { sev: 2, money: true }, OSS_EXCEPTION: { sev: 2, money: false },
  LANDLINE_LOCK_FAILED: { sev: 2, money: false }, NAFATH_TIMEOUT: { sev: 2, money: false },
  SEMATI_FAILED: { sev: 2, money: false }, YAKEEN_FAILED: { sev: 3, money: false },
  NAFATH_REJECTED: { sev: 3, money: false }, MOBILE_EXISTS: { sev: 3, money: false },
  FEASIBILITY_FAILED: { sev: 3, money: false }, APPOINTMENT_FAILED: { sev: 3, money: false },
  TIMEOUT: { sev: 3, money: false }, OTHER: { sev: 3, money: false },
  OUTSTANDING_DUE: { sev: 4, money: false }, GEO_DENIED: { sev: 4, money: false }
};
function effSev(base, count, money, spike) {
  let s = base;
  if (count >= spike) s -= 1;
  if (count >= spike * 3) s -= 1;
  if (money && count >= spike) s = 0;
  return Math.max(0, s);
}

const ops = () => require('./db').ops || null;
const rate = (n, d) => (Number(d) > 0 ? Number(n) / Number(d) : null);
const hours = w => Math.max(0.01, Number(w) || 1);
function ksaHour(nowIso) { return (new Date(nowIso).getUTCHours() + 3) % 24; }

// Every compute is wrapped: no pool → []; SQL error → [] with a log line (sync.js also catches).
function guarded(fn) {
  return async function compute(_src, now, w) {
    const pool = ops();
    if (!pool) return [];
    try { return await fn(pool, now, hours(w)); }
    catch (e) { console.error(`[fixedMetrics] ${e.message}`); return []; }
  };
}

const WIN = `started_at >= $1::timestamptz - ($2||' hours')::interval AND started_at <= $1::timestamptz`;

const FIXED_METRICS = {

  fixed_error_p0p1_categories: {
    label: 'Fixed · open error categories at P0/P1', unit: 'count', higherIsBad: true, segment: 'fixed',
    sourceTables: 'sda_ops.error_events',
    compute: guarded(async (pool, now) => {
      const { rows } = await pool.query(
        `SELECT category, count(*)::int AS c FROM error_events
          WHERE occurred_at >= $1::timestamptz - ($2||' minutes')::interval AND occurred_at < $1::timestamptz
            AND resolved = false GROUP BY category`, [now, FIXED_PARAMS.errorWindowMin]);
      const firing = rows.filter(r => {
        const m = ERR_SEV[r.category] || { sev: 3, money: false };
        return effSev(m.sev, Number(r.c), m.money, FIXED_PARAMS.errorSpike) <= 1;
      });
      const totalOpen = rows.reduce((s, r) => s + Number(r.c), 0);
      return [{ dim: {}, value: firing.length, sample: totalOpen }];
    })
  },

  fixed_timeout_dealers: {
    label: 'Fixed · dealers hitting timeouts (30 min)', unit: 'count', higherIsBad: true, segment: 'fixed',
    sourceTables: 'sda_ops.error_events',
    compute: guarded(async (pool, now) => {
      const { rows } = await pool.query(
        `SELECT COALESCE(dealer_code, dealer_id, 'unknown') AS dealer, count(*)::int AS c
           FROM error_events
          WHERE occurred_at >= $1::timestamptz - ($2||' minutes')::interval AND occurred_at < $1::timestamptz
            AND category IN ('TIMEOUT','NAFATH_TIMEOUT')
          GROUP BY 1`, [now, FIXED_PARAMS.timeoutWindowMin]);
      const events = rows.reduce((s, r) => s + Number(r.c), 0);
      return [{ dim: {}, value: rows.length, sample: events }];
    })
  },

  fixed_nafath_fail_rate: {
    label: 'Fixed · Nafath failure rate (5G)', unit: 'rate', higherIsBad: true, segment: 'fixed',
    sourceTables: 'sda_ops.order_attempts',
    compute: guarded(async (pool, now, w) => {
      const r = (await pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE nafath_outcome <> 'COMPLETED')::int AS failed
           FROM order_attempts
          WHERE ${WIN} AND nafath_outcome IS NOT NULL AND workflow::text = ANY($3::text[])`, [now, w, FIVE_G])).rows[0];
      return [{ dim: {}, value: rate(r.failed, r.total), sample: r.total }];
    })
  },

  fixed_semati_fail_rate: {
    label: 'Fixed · Semati provisioning failure rate (5G)', unit: 'rate', higherIsBad: true, segment: 'fixed',
    sourceTables: 'sda_ops.order_attempts',
    compute: guarded(async (pool, now, w) => {
      // denominator = attempts that reached a Semati verdict (COMPLETED / FAILED / MOBILE_EXISTS)
      const r = (await pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE nafath_outcome IN ('FAILED','MOBILE_EXISTS'))::int AS failed
           FROM order_attempts
          WHERE ${WIN} AND workflow::text = ANY($3::text[])
            AND nafath_outcome IN ('COMPLETED','FAILED','MOBILE_EXISTS')`, [now, w, FIVE_G])).rows[0];
      return [{ dim: {}, value: rate(r.failed, r.total), sample: r.total }];
    })
  },

  fixed_conversion_drop_pp: {
    label: 'Fixed · SDA conversion drop vs 7-day baseline', unit: 'pp', higherIsBad: true, segment: 'fixed',
    sourceTables: 'sda_ops.order_attempts',
    compute: guarded(async (pool, now, w) => {
      const r = (await pool.query(
        `WITH b AS (SELECT $1::timestamptz AS t, ($2||' hours')::interval AS win)
         SELECT count(*) FILTER (WHERE started_at >= t - win)::int AS win_total,
                count(*) FILTER (WHERE started_at >= t - win AND outcome::text = 'COMPLETED')::int AS win_done,
                count(*) FILTER (WHERE started_at <  t - win)::int AS base_total,
                count(*) FILTER (WHERE started_at <  t - win AND outcome::text = 'COMPLETED')::int AS base_done
           FROM order_attempts, b
          WHERE channel = 'sda' AND started_at >= t - win - interval '7 days' AND started_at <= t`, [now, w])).rows[0];
      const winConv = rate(r.win_done, r.win_total), baseConv = rate(r.base_done, r.base_total);
      const value = (winConv == null || baseConv == null) ? null : baseConv - winConv;
      return [{ dim: {}, value, sample: r.win_total }];
    })
  },

  fixed_manafith_deny_rate: {
    label: 'Fixed · Manafith denial rate', unit: 'rate', higherIsBad: true, segment: 'fixed',
    sourceTables: 'sda_ops.order_attempts',
    compute: guarded(async (pool, now, w) => {
      const r = (await pool.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE dealer_validation = 'DENIED')::int AS denied
           FROM order_attempts WHERE ${WIN} AND dealer_validation IS NOT NULL`, [now, w])).rows[0];
      return [{ dim: {}, value: rate(r.denied, r.total), sample: r.total }];
    })
  },

  fixed_workhours_activity_ratio: {
    label: 'Fixed · SDA hourly activity vs same-hour baseline', unit: 'ratio', higherIsBad: false, segment: 'fixed',
    sourceTables: 'sda_ops.order_attempts',
    compute: guarded(async (pool, now) => {
      const H = (ksaHour(now) + 23) % 24;                       // last fully-elapsed KSA hour
      const days = FIXED_PARAMS.baselineDays;
      const { rows } = await pool.query(
        `SELECT ((started_at AT TIME ZONE 'Asia/Riyadh')::date)::text AS ksa_date, count(*)::int AS c,
                (($1::timestamptz AT TIME ZONE 'Asia/Riyadh')::date)::text AS today
           FROM order_attempts
          WHERE channel = 'sda'
            AND started_at >= $1::timestamptz - (($2::int + 1)||' days')::interval AND started_at <= $1::timestamptz
            AND EXTRACT(HOUR FROM started_at AT TIME ZONE 'Asia/Riyadh')::int = $3
          GROUP BY 1 ORDER BY 1 DESC`, [now, days, H]);
      let todayCount = 0, baseSum = 0;
      for (const r of rows) { if (r.ksa_date === r.today) todayCount = Number(r.c); else baseSum += Number(r.c); }
      const baseAvg = days > 0 ? baseSum / days : 0;
      const ratio = baseAvg > 0 ? todayCount / baseAvg : 1;
      return [{ dim: {}, value: ratio, sample: Math.round(baseAvg) }];
    })
  },

  fixed_offhours_sda_attempts: {
    label: 'Fixed · off-hours SDA attempts (KSA 01–06)', unit: 'count', higherIsBad: true, segment: 'fixed',
    sourceTables: 'sda_ops.order_attempts',
    compute: guarded(async (pool, now, w) => {
      const r = (await pool.query(
        `SELECT count(*)::int AS c FROM order_attempts
          WHERE channel = 'sda' AND ${WIN}
            AND EXTRACT(HOUR FROM started_at AT TIME ZONE 'Asia/Riyadh')::int >= $3
            AND EXTRACT(HOUR FROM started_at AT TIME ZONE 'Asia/Riyadh')::int <  $4`,
        [now, w, FIXED_PARAMS.offStart, FIXED_PARAMS.offEnd])).rows[0];
      return [{ dim: {}, value: r.c, sample: r.c }];
    })
  },

  fixed_dealer_stagnation_count: {
    label: 'Fixed · stagnating dealers (active, 0 completions)', unit: 'count', higherIsBad: true, segment: 'fixed',
    sourceTables: 'sda_ops.order_attempts · dealers',
    compute: guarded(async (pool, now, w) => {
      const p = FIXED_PARAMS;
      const { rows } = await pool.query(
        `WITH b AS (SELECT $1::timestamptz AS t, $1::timestamptz - ($2||' hours')::interval AS ws,
                           $1::timestamptz - ($2||' hours')::interval - ($3::int||' days')::interval AS bs)
         SELECT d.id,
                count(*) FILTER (WHERE oa.started_at >= b.bs AND oa.started_at < b.ws)::int AS baseline,
                count(*) FILTER (WHERE oa.started_at >= b.ws AND oa.started_at <= b.t)::int AS win
           FROM order_attempts oa JOIN dealers d ON d.id = oa.dealer_id, b
          WHERE oa.channel = 'sda' AND oa.started_at >= b.bs AND oa.started_at <= b.t
          GROUP BY d.id, b.bs, b.ws, b.t
         HAVING count(*) FILTER (WHERE oa.started_at >= b.bs AND oa.started_at < b.ws) >= $4
            AND count(*) FILTER (WHERE oa.started_at >= b.ws AND oa.started_at <= b.t) >= $5
            AND count(*) FILTER (WHERE oa.started_at >= b.ws AND oa.started_at <= b.t AND oa.outcome::text = 'COMPLETED') = 0`,
        [now, w, p.minDays, p.minBaseline, p.minWindowAttempts]);
      return [{ dim: {}, value: rows.length, sample: rows.length }];
    })
  },

  fixed_incident_sla_breach_rate: {
    label: 'Fixed · incident SLA-breach rate (tickets)', unit: 'rate', higherIsBad: true, segment: 'fixed',
    sourceTables: 'sda_ops.incident_log',
    dims: ['scope'],
    compute: guarded(async (pool, now, w) => {
      const out = [];
      for (const scope of [null, ...TICKET_SCOPES]) {
        const r = (await pool.query(
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE sla_missed)::int AS missed
             FROM incident_log
            WHERE submitted_at >= $1::timestamptz - ($2||' hours')::interval AND submitted_at <= $1::timestamptz
              AND ($3::text IS NULL OR theme ILIKE '%' || $3 || '%')`, [now, w, scope])).rows[0];
        out.push({ dim: scope ? { scope } : {}, value: rate(r.missed, r.total), sample: r.total });
      }
      return out;
    })
  },

  fixed_incident_ticket_count: {
    label: 'Fixed · incident ticket volume (tickets)', unit: 'count', higherIsBad: true, segment: 'fixed',
    sourceTables: 'sda_ops.incident_log',
    dims: ['scope'],
    compute: guarded(async (pool, now, w) => {
      const out = [];
      for (const scope of [null, ...TICKET_SCOPES]) {
        const r = (await pool.query(
          `SELECT count(*)::int AS c FROM incident_log
            WHERE submitted_at >= $1::timestamptz - ($2||' hours')::interval AND submitted_at <= $1::timestamptz
              AND ($3::text IS NULL OR theme ILIKE '%' || $3 || '%')`, [now, w, scope])).rows[0];
        out.push({ dim: scope ? { scope } : {}, value: r.c, sample: r.c });
      }
      return out;
    })
  },

  fixed_sms_balance: {
    label: 'Fixed · Unifonic SMS balance (units)', unit: 'count', higherIsBad: false, segment: 'fixed',
    sourceTables: 'FIXED_SMS_BALANCE_URL (JSON feed) — no data unless configured',
    async compute() {
      const url = process.env.FIXED_SMS_BALANCE_URL;
      if (!url || typeof fetch !== 'function') return [];
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
        const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } }).finally(() => clearTimeout(t));
        if (!r.ok) return [];
        const j = await r.json();
        const bal = Number(j && j.balance);
        if (!Number.isFinite(bal)) return [];
        return [{ dim: {}, value: bal, sample: Number(j.recentSends) || 0 }];
      } catch (e) { console.error(`[fixedMetrics] sms balance feed: ${e.message}`); return []; }
    }
  }
};

/* ================= APP-LOG metrics — SMART thresholds (15 Sep 2026) =================
 * Source: unified_console.fixed_app_events (fixedAppLogCollector.js ← combined.log on 146). These do not use the
 * sda_ops pool: they read the console DB directly. Principle: no static "> N errors" — every failing SIGNATURE
 * (channel · step · reason class) is compared to ITS OWN history:
 *   baseline = median + MAD of the same signature's hourly counts, same hour-of-day over the last 14 days when
 *              ≥ 5 such hours exist, else all hours of the last 7 days; robust z = (now − median) / max(1.4826·MAD, √median, 1)
 *   the rule fires on the worst z (threshold 3.5, min count 10). A signature with NO history at all (first seen
 *   in the last hour, ≥ 5 events) is a separate metric — "new error" — because z is undefined for it.
 * The snapshot's dim.note names the signature so the incident text says WHAT spiked, not just "z=6". */
const consoleDb = () => require('./db').console;
const APPLOG_SIG = `coalesce(channel,'other') || ' · ' || coalesce(regexp_replace(path,'^(sda|ePurchase|salamApp|paymentOptimization)\\.(actions\\.)?',''),kind,'?') || ' · ' || coalesce(reason_class,'?')`;
function robust(values) {
  if (!values.length) return null;
  const a = values.slice().sort((x, y) => x - y); const med = a[Math.floor(a.length / 2)];
  const dev = a.map(v => Math.abs(v - med)).sort((x, y) => x - y); const mad = dev[Math.floor(dev.length / 2)];
  return { med, mad, n: a.length };
}
async function applogAnomaly(now, cls) {
  const C = consoleDb();
  const cur = (await C.query(`SELECT ${APPLOG_SIG} AS sig, count(*)::int AS n, count(DISTINCT request_id)::int AS requests, (array_agg(left(reason,90) ORDER BY ts DESC))[1] AS reason
      FROM fixed_app_events WHERE ok IS NOT TRUE AND reason_class = $2 AND ts >= $1::timestamptz - interval '60 minutes' AND ts < $1::timestamptz
      GROUP BY 1 HAVING count(*) >= 10 ORDER BY 2 DESC LIMIT 40`, [now, cls])).rows;
  if (!cur.length) return [];
  const hod = new Date(new Date(now).getTime() + 3 * 3600e3).getUTCHours();
  const hist = (await C.query(`SELECT ${APPLOG_SIG} AS sig, date_trunc('hour', ts) AS h, count(*)::int AS n
      FROM fixed_app_events WHERE ok IS NOT TRUE AND reason_class = $2 AND ts >= $1::timestamptz - interval '14 days' AND ts < $1::timestamptz - interval '60 minutes'
        AND ${APPLOG_SIG} = ANY($3::text[]) GROUP BY 1,2`, [now, cls, cur.map(c => c.sig)])).rows;
  const oldest = (await C.query(`SELECT min(ts) AS t FROM fixed_app_events`)).rows[0].t;
  const coverageH = oldest ? (new Date(now) - new Date(oldest)) / 3600e3 : 0;
  let worst = null;
  for (const c of cur) {
    const rows = hist.filter(h => h.sig === c.sig);
    const sameHour = rows.filter(h => ((new Date(h.h).getUTCHours() + 3) % 24) === hod).map(h => h.n);
    /* hours with ZERO events are real samples too: fill the covered span with zeros */
    const spanH = Math.min(24 * 14, Math.max(1, Math.floor(coverageH) - 1));
    const all = rows.map(h => h.n); while (all.length < spanH) all.push(0);
    const sameFilled = sameHour.slice(); const sameSpan = Math.floor(spanH / 24); while (sameFilled.length < sameSpan) sameFilled.push(0);
    const b = sameFilled.length >= 5 ? robust(sameFilled) : robust(all);
    if (!b || coverageH < 3) continue;                     // under 3 h of history there is no baseline yet — the "new error" metric covers it
    const scale = Math.max(1.4826 * b.mad, Math.sqrt(b.med), 1);
    const z = (c.n - b.med) / scale;
    if (!worst || z > worst.z) worst = { z, c, b };
  }
  if (!worst) return [];
  const { z, c, b } = worst;
  return [{ dim: { note: `${c.sig} — ${c.n} in the last 60 min vs typical ${b.med}/h${c.requests ? ` · ${c.requests} requests` : ''} · “${(c.reason || '').replace(/\s+/g, ' ')}”` }, value: Math.round(z * 10) / 10, sample: c.n }];
}
Object.assign(FIXED_METRICS, {
  fixed_applog_anomaly_technical: {
    label: 'Fixed · app-log TECHNICAL failure anomaly (robust z, worst signature)', unit: 'count', higherIsBad: true, segment: 'fixed',
    sourceTables: 'unified_console.fixed_app_events',
    compute: async (_src, now) => { try { return await applogAnomaly(now, 'technical'); } catch (e) { console.error(`[fixedMetrics] applog anomaly: ${e.message}`); return []; } }
  },
  fixed_applog_anomaly_business: {
    label: 'Fixed · app-log BUSINESS refusal anomaly (robust z, worst signature)', unit: 'count', higherIsBad: true, segment: 'fixed',
    sourceTables: 'unified_console.fixed_app_events',
    compute: async (_src, now) => { try { return await applogAnomaly(now, 'business'); } catch (e) { console.error(`[fixedMetrics] applog anomaly: ${e.message}`); return []; } }
  },
  fixed_applog_new_signature: {
    label: 'Fixed · NEW failing signatures (never seen in 14 d, ≥5 in the last hour)', unit: 'count', higherIsBad: true, segment: 'fixed',
    sourceTables: 'unified_console.fixed_app_events',
    compute: async (_src, now) => {
      try {
        const C = consoleDb();
        const cov = (await C.query(`SELECT min(ts) AS t FROM fixed_app_events`)).rows[0].t;
        if (!cov || (new Date(now) - new Date(cov)) < 24 * 3600e3) return [];   // needs a day of history before "never seen" means anything
        const rows = (await C.query(`WITH cur AS (SELECT ${APPLOG_SIG} AS sig, count(*)::int AS n, (array_agg(left(reason,80) ORDER BY ts DESC))[1] AS reason
              FROM fixed_app_events WHERE ok IS NOT TRUE AND ts >= $1::timestamptz - interval '60 minutes' AND ts < $1::timestamptz GROUP BY 1 HAVING count(*) >= 5)
            SELECT c.* FROM cur c WHERE NOT EXISTS (SELECT 1 FROM fixed_app_events e WHERE e.ok IS NOT TRUE AND e.ts >= $1::timestamptz - interval '14 days' AND e.ts < $1::timestamptz - interval '60 minutes' AND ${APPLOG_SIG.replace(/\b(channel|path|kind|reason_class)\b/g, 'e.$1')} = c.sig)
            ORDER BY n DESC LIMIT 5`, [now])).rows;
        const total = rows.reduce((a, r) => a + r.n, 0);
        return [{ dim: { note: rows.length ? rows.map(r => `${r.sig} ×${r.n} “${r.reason || ''}”`).join(' | ').slice(0, 220) : '' }, value: rows.length, sample: total }];
      } catch (e) { console.error(`[fixedMetrics] new signature: ${e.message}`); return []; }
    }
  },
  fixed_applog_retry_loop: {
    label: 'Fixed · retry loops (a worker failing the same way on a schedule)', unit: 'count', higherIsBad: true, segment: 'fixed',
    sourceTables: 'unified_console.fixed_app_events',
    compute: async (_src, now) => {
      try {
        const rows = (await consoleDb().query(`WITH g AS (SELECT coalesce(path,kind) AS path, left(reason,80) AS reason, count(*)::int AS n, min(ts) AS first, max(ts) AS last,
              count(DISTINCT date_trunc('hour', ts) + (floor(extract(minute FROM ts)/5)*5) * interval '1 minute')::int AS buckets, count(DISTINCT request_id)::int AS requests
            FROM fixed_app_events WHERE ok IS NOT TRUE AND reason IS NOT NULL AND ts >= $1::timestamptz - interval '3 hours' AND ts < $1::timestamptz GROUP BY 1,2)
          SELECT * FROM g WHERE n >= 30 AND requests <= 1 AND last - first >= interval '20 minutes' AND buckets >= 0.6 * ceil(extract(epoch FROM (last - first)) / 300.0)
            AND last >= $1::timestamptz - interval '20 minutes' ORDER BY n DESC LIMIT 5`, [now])).rows;
        return [{ dim: { note: rows.map(r => `${r.path} “${r.reason}” ×${r.n}`).join(' | ').slice(0, 220) }, value: rows.length, sample: rows.reduce((a, r) => a + r.n, 0) }];
      } catch (e) { console.error(`[fixedMetrics] retry loop: ${e.message}`); return []; }
    }
  },
  fixed_yakeen_technical_rate: {
    label: 'Fixed · Yakeen / ELM technical failure rate (app log, 60 min)', unit: 'rate', higherIsBad: true, segment: 'fixed',
    sourceTables: 'unified_console.fixed_app_events',
    compute: async (_src, now) => {
      try {
        const r = (await consoleDb().query(`SELECT count(*)::int AS calls, count(*) FILTER (WHERE ok IS NOT TRUE AND reason_class='technical')::int AS tech,
              (array_agg(left(reason,80) ORDER BY ts DESC) FILTER (WHERE ok IS NOT TRUE AND reason_class='technical'))[1] AS reason
            FROM fixed_app_events WHERE kind IN ('yakeen','yakeen_address') AND ts >= $1::timestamptz - interval '60 minutes' AND ts < $1::timestamptz`, [now])).rows[0];
        if (!r || !r.calls) return [];
        return [{ dim: { note: r.tech ? `${r.tech} of ${r.calls} Yakeen calls failed technically · “${r.reason || ''}”` : '' }, value: r.tech / r.calls, sample: r.calls }];
      } catch (e) { console.error(`[fixedMetrics] yakeen rate: ${e.message}`); return []; }
    }
  },
  fixed_yakeen_probe_down: {
    label: 'Fixed · Yakeen / ELM synthetic probe not answering (latest run)', unit: 'count', higherIsBad: true, segment: 'fixed',
    sourceTables: 'unified_console.yakeen_probe_runs',
    compute: async (_src, now) => {
      try {
        const r = (await consoleDb().query(`SELECT verdict, ok_count, total, run_at, results FROM yakeen_probe_runs WHERE run_at >= $1::timestamptz - interval '8 hours' ORDER BY run_at DESC LIMIT 1`, [now])).rows[0];
        if (!r) return [];
        const bad = (r.results || []).filter(x => x.cls === 'technical').map(x => `${x.label}: ${x.message || ''}`).join(' | ');
        return [{ dim: { note: bad.slice(0, 220) }, value: (r.verdict === 'down' || r.verdict === 'degraded') ? 1 : 0, sample: r.total }];
      } catch (e) { if (!/does not exist/.test(e.message)) console.error(`[fixedMetrics] yakeen probe: ${e.message}`); return []; }
    }
  },
});

// NB: the metric map is exported under METRICS (not as the module itself) so helpers never leak into the registry.
module.exports = { METRICS: FIXED_METRICS, FIXED_PARAMS, TICKET_SCOPES };
