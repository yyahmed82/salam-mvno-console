/* fixed360.js — Fixed / Salam Home domain queries (stage 1: READ the dealer-ops read model in
 * sda_ops.<schema> — dealers · order_attempts · error_events · ingest_state — through db.ops).
 *
 * SQL is a straight port of salam-dealer-ops packages/api/src/routers/{dashboards,activity,errors}.ts,
 * Prisma → pg. Same definitions so the numbers match /operations-console-beta:
 *   attempts      = rows in order_attempts inside the window (started_at)
 *   completed     = outcome = 'COMPLETED'      conversion = completed / attempts
 *   active dealers= COUNT(DISTINCT dealer_id)
 *   consumer-direct e-purchase (channel='epurchase' AND referral_code IS NULL) is EXCLUDED by default,
 *                   exactly like the beta's includeConsumerDirect=false; pass consumerDirect=1 to include.
 * PII: sda_ops is masked at rest for bodies; identifiers we return are additionally cut down here
 * (last digits only). Full values → Phase 2 unmask via nexus + cap unmaskPII. */
const db = require('./db');

const WORKFLOW_LABEL = {
  ftth: 'FTTH (fiber)', fttb: 'FTTB', fiveGWhiteLabel: '5G white-label', fiveGFWA: '5G FWA', promoters: 'Promoters',
  ePurchaseFTTH: 'e-purchase FTTH', salamHomeFreeze: 'Salam Home · Freeze', salamHomeUnFreeze: 'Salam Home · Unfreeze',
  salamHomeRelocationFTTH: 'Salam Home · Relocation FTTH', salamHomeRelocationWL: 'Salam Home · Relocation 5G WL',
  salamHomeRelocationOwn: 'Salam Home · Relocation 5G own CPE', salamHomeChangePlan: 'Salam Home · Change plan',
  salamHomeChangePlanPre2Post: 'Salam Home · Pre→Post', salamHomeRenew: 'Salam Home · Renew', unknown: 'unknown' };

function notConfigured() { const e = new Error('Fixed data source not configured (OPS_DATABASE_URL)'); e.status = 503; return e; }

/* ---- window + scope parsing (shared by every route) ---- */
/* Which sda_ops schema answers a request: Salam Home app rows exist only in the beta schema (stage 1),
 * dealers / e-purchase live in prod public. Channel-aware so every Fixed page can be scoped to Salam Home. */
function poolFor(channel) {
  if (channel === 'salamhome') return db.opsBeta || db.ops;
  return db.ops;
}

function parseScope(q = {}) {
  const now = Date.now();
  const H = 3600e3;
  const RANGES = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720, '90d': 2160 };
  let to = q.to ? new Date(q.to) : new Date(now);
  let from = q.from ? new Date(q.from) : new Date(to.getTime() - (RANGES[q.range] || 168) * H);
  if (isNaN(from) || isNaN(to)) { from = new Date(now - 168 * H); to = new Date(now); }
  const channel = ['sda', 'epurchase', 'salamhome'].includes(q.channel) ? q.channel : null;
  const consumerDirect = q.consumerDirect === '1' || q.consumerDirect === 'true';
  const workflow = q.workflow ? String(q.workflow).replace(/[^a-zA-Z0-9]/g, '') : null;
  const region = q.region ? String(q.region).slice(0, 60) : null;
  const dealerId = q.dealerId ? String(q.dealerId).slice(0, 40) : null;
  // WHERE fragment + params; alias `oa` = order_attempts
  const params = [from.toISOString(), to.toISOString()];
  const parts = ['oa.started_at >= $1', 'oa.started_at < $2'];
  if (channel) { params.push(channel); parts.push(`oa.channel = $${params.length}`); }
  if (!consumerDirect) parts.push(`NOT (oa.channel = 'epurchase' AND oa.referral_code IS NULL)`);
  if (workflow) { params.push(workflow); parts.push(`oa.workflow::text = $${params.length}`); }
  if (region) { params.push(region); parts.push(`COALESCE(oa.region, d.region) = $${params.length}`); }
  if (dealerId) { params.push(dealerId); parts.push(`oa.dealer_id = $${params.length}`); }
  return { from, to, channel, consumerDirect, workflow, region, dealerId, where: 'WHERE ' + parts.join(' AND '), params };
}
const FROM = `FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id`;
const n = v => Number(v) || 0;
const pct = (a, b) => b > 0 ? Math.round((a / b) * 1000) / 10 : 0;

/* ---- masking helpers (identifiers only; bodies are already masked at ingest) ---- */
const tail = (s, k) => s == null || s === '' ? null : '…' + String(s).slice(-k);
function maskAttempt(r) {
  return { ...r,
    msisdn: tail(r.msisdn, 4), iccid: tail(r.iccid, 6), cpe: tail(r.cpe, 4), service_no: tail(r.service_no, 6),
    cust_code: tail(r.cust_code, 4), customer_id: tail(r.customer_id, 4) };
}

/* ---- freshness: is the beta watcher alive? ---- */
async function freshness(pool = db.ops) {
  const r = await pool.query(`SELECT
      (SELECT last_ts   FROM ingest_state WHERE source='replica' LIMIT 1) AS cursor_ts,
      (SELECT updated_at FROM ingest_state WHERE source='replica' LIMIT 1) AS cursor_updated,
      (SELECT max(started_at) FROM order_attempts)                          AS newest_attempt,
      (SELECT max(occurred_at) FROM error_events)                           AS newest_error,
      current_schema() AS schema, current_database() AS db, now() AS server_now`);
  const f = r.rows[0] || {};
  const lagMin = f.cursor_updated ? Math.round((Date.now() - new Date(f.cursor_updated).getTime()) / 60000) : null;
  return { ...f, lag_min: lagMin, stale: lagMin == null || lagMin > 30 };
}

/* ---- the dashboard ---- */
/* MEMO (16 Sep 2026): 11 scans of order_attempts per call, requested by Home, the Fixed hub and the exec pages for the
 * same range. Fresh ≤ 60 s served as is, ≤ 10 min served while one refresh runs in the background. Keyed on the whole
 * scope (range / from-to rounded to the minute / channel / filters); `fresh=1` bypasses. */
const MEMO = {}, FRESH_MS = 60e3, STALE_MS = 600e3;
async function summary(q) {
  const qq = Object.assign({}, q || {}); const fresh = qq.fresh; delete qq.fresh;
  for (const k of ['from', 'to']) if (qq[k]) qq[k] = String(qq[k]).slice(0, 16);
  const key = JSON.stringify(qq, Object.keys(qq).sort());
  const m = MEMO[key] || (MEMO[key] = {});
  const age = m.data ? Date.now() - m.at : Infinity;
  if (!fresh && m.data && age < FRESH_MS) return m.data;
  const run = () => { if (!m.promise) m.promise = summaryRaw(q).then(d => { m.data = d; m.at = Date.now(); m.promise = null; return d; }, e => { m.promise = null; throw e; }); return m.promise; };
  if (!fresh && m.data && age < STALE_MS) { run().catch(e => console.error('[fixed360] background refresh failed:', e.message)); return m.data; }
  const d = await run();
  const keys = Object.keys(MEMO); if (keys.length > 200) for (const k of keys.slice(0, 100)) delete MEMO[k];   // ad-hoc from/to scopes must not pile up
  return d;
}
async function summaryRaw(q) {
  const s = parseScope(q);
  const pool = poolFor(s.channel); if (!pool) throw notConfigured();
  const P = s.params, W = s.where;
  const Q = (sql, extra = []) => pool.query(sql, P.concat(extra));
  const [kpi, outcomes, byWf, byCh, byRegion, byDay, topDealers, naf, dv, errs, fresh] = await Promise.all([
    Q(`SELECT count(*)::int AS attempts, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
              count(DISTINCT oa.dealer_id)::int AS active_dealers,
              count(*) FILTER (WHERE oa.order_number IS NOT NULL)::int AS with_order,
              round(avg(oa.duration_s) FILTER (WHERE oa.outcome='COMPLETED'))::int AS avg_duration_s
         ${FROM} ${W}`),
    Q(`SELECT oa.outcome::text AS outcome, count(*)::int AS n ${FROM} ${W} GROUP BY 1 ORDER BY 2 DESC`),
    Q(`SELECT oa.workflow::text AS workflow, count(*)::int AS n, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed
         ${FROM} ${W} GROUP BY 1 ORDER BY 2 DESC`),
    Q(`SELECT oa.channel, count(*)::int AS n, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed
         ${FROM} ${W} GROUP BY 1 ORDER BY 2 DESC`),
    Q(`SELECT COALESCE(oa.region, d.region, '—') AS region, count(*)::int AS n,
              count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
              count(*) FILTER (WHERE oa.nafath_outcome IS NOT NULL AND oa.nafath_outcome<>'COMPLETED')::int AS nafath_failed,
              count(*) FILTER (WHERE oa.dealer_validation='DENIED')::int AS manafith_denied
         ${FROM} ${W} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
    Q(`SELECT date_trunc('day', oa.started_at AT TIME ZONE 'Asia/Riyadh') AS day, count(*)::int AS n,
              count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed
         ${FROM} ${W} GROUP BY 1 ORDER BY 1`),
    Q(`SELECT d.id, d.staff_code, d.staff_name, d.dealer_code, d.dealer_name, d.region, d.role::text AS role,
              count(*)::int AS n, count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
              max(oa.started_at) AS last_seen
         ${FROM} ${W} AND oa.dealer_id IS NOT NULL GROUP BY d.id ORDER BY n DESC LIMIT 10`),
    Q(`SELECT oa.nafath_outcome AS outcome, count(*)::int AS n ${FROM} ${W}
          AND oa.channel='sda' AND oa.nafath_outcome IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
    Q(`SELECT oa.dealer_validation AS outcome, count(*)::int AS n ${FROM} ${W}
          AND oa.channel='sda' AND oa.dealer_validation IS NOT NULL GROUP BY 1`),
    // error_events has its own timestamp; reuse the window + channel only
    pool.query(`SELECT category, count(*)::int AS n, count(*) FILTER (WHERE NOT resolved)::int AS open,
                         max(occurred_at) AS last_at
                    FROM error_events WHERE occurred_at >= $1 AND occurred_at < $2 ${s.channel ? 'AND channel = $3' : ''}
                   GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, s.channel ? [P[0], P[1], s.channel] : [P[0], P[1]]),
    freshness(pool),
  ]);
  const k = kpi.rows[0] || {};
  const nafTotal = naf.rows.reduce((a, r) => a + n(r.n), 0);
  const nafOk = n((naf.rows.find(r => r.outcome === 'COMPLETED') || {}).n);
  const dvTotal = dv.rows.reduce((a, r) => a + n(r.n), 0);
  const denied = n((dv.rows.find(r => r.outcome === 'DENIED') || {}).n);
  return {
    stage: 'read-model', source: `${fresh.db}.${fresh.schema}`, window: { from: s.from, to: s.to },
    scope: { channel: s.channel, consumerDirect: s.consumerDirect, workflow: s.workflow, region: s.region, dealerId: s.dealerId },
    freshness: fresh,
    kpis: { attempts: n(k.attempts), completed: n(k.completed), conversion: pct(n(k.completed), n(k.attempts)),
            activeDealers: n(k.active_dealers), withOrder: n(k.with_order), avgDurationS: k.avg_duration_s },
    outcomes: outcomes.rows,
    byWorkflow: byWf.rows.map(r => ({ ...r, label: WORKFLOW_LABEL[r.workflow] || r.workflow, conversion: pct(r.completed, r.n) })),
    byChannel: byCh.rows.map(r => ({ ...r, conversion: pct(r.completed, r.n) })),
    byRegion: byRegion.rows,
    byDay: byDay.rows,
    topDealers: topDealers.rows.map(r => ({ ...r, conversion: pct(r.completed, r.n) })),
    integrations: {
      nafath: { total: nafTotal, completed: nafOk, failRate: pct(nafTotal - nafOk, nafTotal), breakdown: naf.rows },
      manafith: { total: dvTotal, denied, deniedRate: pct(denied, dvTotal) },
    },
    errors: errs.rows,
  };
}

/* ---- Salam Home app (B2C) journeys — the beta's /b2c overview, per workflow ---- */
async function b2cOverview(q) {
  const pool = db.opsBeta || db.ops;   // Salam Home app rows exist only in the beta schema (stage 1)
  if (!pool) throw notConfigured();
  const s = parseScope({ ...q, channel: 'salamhome' });
  const r = await pool.query(`SELECT oa.workflow::text AS workflow, count(*)::int AS n,
        count(*) FILTER (WHERE oa.outcome='COMPLETED')::int AS completed,
        count(*) FILTER (WHERE oa.outcome='STALLED')::int AS stalled,
        count(*) FILTER (WHERE oa.outcome='IN_PROGRESS')::int AS in_progress,
        count(*) FILTER (WHERE oa.order_number IS NOT NULL)::int AS with_order
      ${FROM} ${s.where} GROUP BY 1 ORDER BY 2 DESC`, s.params);
  const stops = await pool.query(`SELECT oa.workflow::text AS workflow, oa.step_reached AS step, count(*)::int AS n
      ${FROM} ${s.where} AND oa.outcome <> 'COMPLETED' GROUP BY 1,2 ORDER BY 1, 3 DESC`, s.params);
  return { window: { from: s.from, to: s.to }, provisional: 'B2C definitions unsigned (docs/B2C-DEFINITIONS.md) — figures provisional',
    byWorkflow: r.rows.map(x => ({ ...x, label: WORKFLOW_LABEL[x.workflow] || x.workflow, conversion: pct(x.completed, x.n) })),
    stopSteps: stops.rows };
}

/* ---- lists ---- */
async function attempts(q) {
  const s = parseScope(q);
  const pool = poolFor(s.channel); if (!pool) throw notConfigured();
  const lim = Math.min(500, Math.max(10, Number(q.limit) || 100));
  const P = s.params.slice(); let extra = '';
  if (q.outcome) { P.push(String(q.outcome).toUpperCase()); extra += ` AND oa.outcome::text = $${P.length}`; }
  if (q.find) {   // ODB / order # / service # / ICCID / msisdn — tolerant contains-match on the identifier columns
    P.push('%' + String(q.find).trim() + '%'); const i = P.length;
    extra += ` AND (oa.order_number ILIKE $${i} OR oa.odb ILIKE $${i} OR oa.service_no ILIKE $${i} OR oa.iccid ILIKE $${i} OR oa.msisdn ILIKE $${i} OR oa.cust_code ILIKE $${i} OR oa.id ILIKE $${i})`;
  }
  P.push(lim);
  const r = await pool.query(`SELECT oa.id, oa.workflow::text AS workflow, oa.plan, oa.channel, oa.referral_code, oa.order_number, oa.odb,
        oa.iccid, oa.cpe, oa.msisdn, oa.service_no, oa.cust_code, oa.customer_id, oa.nafath_outcome, oa.dealer_validation,
        oa.outcome::text AS outcome, oa.step_reached, oa.last_error_category, oa.last_error_at, oa.lat, oa.lng,
        COALESCE(oa.region, d.region) AS region, oa.started_at, oa.completed_at, oa.duration_s,
        d.staff_code, d.staff_name, d.dealer_code, d.dealer_name
      ${FROM} ${s.where} ${extra} ORDER BY oa.started_at DESC LIMIT $${P.length}`, P);
  return { window: { from: s.from, to: s.to }, rows: r.rows.map(maskAttempt) };
}

async function dealers(q) {
  if (!db.ops) throw notConfigured();
  const term = '%' + String(q.q || '').trim() + '%';
  const r = await db.ops.query(`SELECT d.id, d.staff_code, d.staff_name, d.dealer_code, d.dealer_name, d.role::text AS role, d.city, d.region, d.is_active,
        (SELECT count(*)::int FROM order_attempts oa WHERE oa.dealer_id = d.id AND oa.started_at > now() - interval '30 days') AS attempts_30d,
        (SELECT max(started_at) FROM order_attempts oa WHERE oa.dealer_id = d.id) AS last_seen
      FROM dealers d
      WHERE d.staff_code ILIKE $1 OR d.staff_name ILIKE $1 OR d.dealer_code ILIKE $1 OR d.dealer_name ILIKE $1
      ORDER BY attempts_30d DESC NULLS LAST LIMIT 25`, [term]);
  return { rows: r.rows };
}

async function errorFeed(q) {
  const s = parseScope(q);
  const pool = poolFor(s.channel); if (!pool) throw notConfigured();
  const lim = Math.min(300, Math.max(10, Number(q.limit) || 80));
  const P = [s.from.toISOString(), s.to.toISOString()]; let extra = '';
  if (s.channel) { P.push(s.channel); extra += ` AND channel = $${P.length}`; }
  if (q.category) { P.push(String(q.category)); extra += ` AND category = $${P.length}`; }
  P.push(lim);
  const r = await pool.query(`SELECT id, attempt_id, order_number, acct_masked, cust_masked, category, code, message, client_side,
        channel, dealer_code, referral_code, region, step, occurred_at, resolved, signature
      FROM error_events WHERE occurred_at >= $1 AND occurred_at < $2 ${extra} ORDER BY occurred_at DESC LIMIT $${P.length}`, P);
  return { window: { from: s.from, to: s.to }, rows: r.rows };
}

module.exports = { summary, b2cOverview, attempts, dealers, errorFeed, freshness, parseScope, poolFor, WORKFLOW_LABEL };
