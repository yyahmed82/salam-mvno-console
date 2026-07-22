/* Dealers & QR/partner dashboards + integration health — from the replica.
 * flow_type enum: normal:0 indirect:1 posa:2 apollo:3 ownership_transfer:4 partner:5 visitor_hajj:6 qr_posa:7
 * Dealer/DMS orders = seller_id IS NOT NULL. QR/POSA = flow_type IN (2,7). Partner = flow_type IN (3,5). */
const db = require('./db');
const NAFATH_SUCCESS = ['completed'];
const NAFATH_FAILED = ['expired', 'rejected', 'failed', 'cancelled', 'denied'];

const win = (n, w) => [n, w];
const rate = (a, b) => (b > 0 ? Number(a) / Number(b) : null);

async function dealerKpis(now, w) {
  const r = await db.source.query(`
    SELECT count(*) AS attempts,
           count(*) FILTER (WHERE completed) AS completed,
           count(*) FILTER (WHERE activated) AS activated,
           count(DISTINCT seller_id) AS active_dealers,
           count(*) FILTER (WHERE NOT completed AND created_at < $1::timestamptz - interval '6 hours') AS stalled
    FROM onboarding_orders
    WHERE seller_id IS NOT NULL
      AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, win(now, w));
  const x = r.rows[0];
  return { attempts: +x.attempts, completed: +x.completed, activated: +x.activated,
    active_dealers: +x.active_dealers, stalled: +x.stalled, conversion: rate(x.completed, x.attempts) };
}

async function ordersOverTime(now, w) {
  const r = await db.source.query(`
    SELECT date_trunc('day', created_at) AS d,
           count(*) AS created, count(*) FILTER (WHERE completed) AS completed
    FROM onboarding_orders
    WHERE seller_id IS NOT NULL
      AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
    GROUP BY 1 ORDER BY 1`, win(now, w));
  return r.rows.map(x => ({ day: x.d, created: +x.created, completed: +x.completed }));
}

async function topDealers(now, w, limit = 10) {
  const r = await db.source.query(`
    SELECT o.seller_id, s.name AS seller_name,
           count(*) AS attempts, count(*) FILTER (WHERE o.completed) AS completed
    FROM onboarding_orders o LEFT JOIN sellers s ON s.id = o.seller_id
    WHERE o.seller_id IS NOT NULL
      AND o.created_at >= $1::timestamptz-($2||' hours')::interval AND o.created_at < $1::timestamptz
    GROUP BY o.seller_id, s.name ORDER BY completed DESC, attempts DESC LIMIT $3`, [now, w, limit]);
  return r.rows.map(x => ({ seller_id: x.seller_id, name: x.seller_name || ('Seller #' + x.seller_id),
    attempts: +x.attempts, completed: +x.completed, conversion: rate(x.completed, x.attempts) }));
}

async function planMix(now, w, scope = 'dealer') {
  const where = scope === 'qr' ? 'flow_type IN (2,7)' : scope === 'partner' ? 'flow_type IN (3,5)' : 'seller_id IS NOT NULL';
  const r = await db.source.query(`
    SELECT o.plan_id, p.name AS plan_name, count(*) AS n
    FROM onboarding_orders o LEFT JOIN plans p ON p.id = o.plan_id
    WHERE ${where} AND o.plan_id IS NOT NULL
      AND o.created_at >= $1::timestamptz-($2||' hours')::interval AND o.created_at < $1::timestamptz
    GROUP BY o.plan_id, p.name ORDER BY n DESC LIMIT 12`, win(now, w));
  return r.rows.map(x => ({ plan_id: x.plan_id, plan: x.plan_name || ('Plan #' + x.plan_id), count: +x.n }));
}

async function qrKpis(now, w) {
  const r = await db.source.query(`
    SELECT count(*) AS attempts,
           count(*) FILTER (WHERE completed) AS completed,
           count(*) FILTER (WHERE activated) AS activated,
           count(*) FILTER (WHERE flow_type=7) AS qr_posa,
           count(*) FILTER (WHERE flow_type=2) AS posa
    FROM onboarding_orders
    WHERE flow_type IN (2,7)
      AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, win(now, w));
  const x = r.rows[0];
  return { attempts: +x.attempts, completed: +x.completed, activated: +x.activated,
    qr_posa: +x.qr_posa, posa: +x.posa, conversion: rate(x.completed, x.attempts) };
}

async function partnerKpis(now, w) {
  const r = await db.source.query(`
    SELECT count(*) AS attempts, count(*) FILTER (WHERE completed) AS completed,
           count(*) FILTER (WHERE activated) AS activated
    FROM onboarding_orders WHERE flow_type IN (3,5)
      AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, win(now, w));
  const x = r.rows[0];
  return { attempts: +x.attempts, completed: +x.completed, activated: +x.activated, conversion: rate(x.completed, x.attempts) };
}

// source leaderboard (utm_source) — the closest non-map "per-partner" view
async function sourceLeaderboard(now, w, limit = 10) {
  const r = await db.source.query(`
    SELECT COALESCE(NULLIF(utm_source,''),'—') AS source,
           count(*) AS attempts, count(*) FILTER (WHERE completed) AS completed
    FROM onboarding_orders
    WHERE created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz
    GROUP BY 1 ORDER BY completed DESC, attempts DESC LIMIT $3`, [now, w, limit]);
  return r.rows.map(x => ({ source: x.source, attempts: +x.attempts, completed: +x.completed, conversion: rate(x.completed, x.attempts) }));
}

async function integrationHealth(now, w) {
  const naf = await db.source.query(`
    SELECT count(*) FILTER (WHERE lower(status)=ANY($3)) AS ok,
           count(*) FILTER (WHERE lower(status)=ANY($3) OR lower(status)=ANY($4)) AS total
    FROM nafath_logs WHERE created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`,
    [now, w, NAFATH_SUCCESS, NAFATH_FAILED]);
  const sem = await db.source.query(`
    SELECT count(*) FILTER (WHERE state) AS ok, count(*) AS total FROM activation_logs
    WHERE api ILIKE '%semati%' AND created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, win(now, w));
  const elig = await db.source.query(`
    SELECT count(*) FILTER (WHERE state) AS ok, count(*) AS total FROM eligibility_logs
    WHERE created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, win(now, w));
  const act = await db.source.query(`
    SELECT count(*) FILTER (WHERE state) AS ok, count(*) AS total FROM activation_logs
    WHERE created_at >= $1::timestamptz-($2||' hours')::interval AND created_at < $1::timestamptz`, win(now, w));
  const pct = (o, t) => ({ ok: +o, total: +t, health: rate(o, t) });
  return {
    nafath: pct(naf.rows[0].ok, naf.rows[0].total),
    semati: pct(sem.rows[0].ok, sem.rows[0].total),
    eligibility: pct(elig.rows[0].ok, elig.rows[0].total),   // eligibility / CITC
    activation: pct(act.rows[0].ok, act.rows[0].total)
  };
}

async function dealersDashboard(now, w) {
  const [kpis, over, top, mix, health] = await Promise.all([
    dealerKpis(now, w), ordersOverTime(now, w), topDealers(now, w), planMix(now, w, 'dealer'), integrationHealth(now, w)]);
  return { kpis, ordersOverTime: over, topDealers: top, planMix: mix, integrationHealth: health };
}
async function qrDashboard(now, w) {
  const [kpis, partner, board, mix] = await Promise.all([
    qrKpis(now, w), partnerKpis(now, w), sourceLeaderboard(now, w), planMix(now, w, 'qr')]);
  return { kpis, partner, leaderboard: board, planMix: mix };
}

module.exports = { dealersDashboard, qrDashboard, integrationHealth };
