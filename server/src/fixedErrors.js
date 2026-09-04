/* fixedErrors.js — Fixed "Errors" page: the Live Error Control Board of the Operations Console
 * (salam-dealer-ops packages/api/src/routers/errors.ts) ported 1:1 onto the unified console.
 *
 * Data: db.ops (prod sda_ops.public) — error_events · order_attempts · api_calls · dealers. READ-ONLY.
 * Acks never touch sda_ops: they live in the console's own DB (fixed_error_acks) and are merged in.
 * Unmask (cap unmaskPII + ?unmask=1): raw api_logs / workflow_states from db.nexus, audited pii.unmask.
 * Routes (all under /api/fixed/errors/*, gated by deps.gate = requireView('fixed')):
 *   GET  summary  ?range|from|to&channel&openOnly&find&tech&odb&iccid&cpe&msisdn&serviceNo&custCode&customerId&workflowId
 *   GET  live     …same + &team&priority&category&limit
 *   GET  detail   ?id[&unmask=1]
 *   POST resolve  {id[, undo]}                     (cap ackErrors)
 */

/* ---- taxonomy — copied from packages/ingest/src/error-taxonomy.ts (single source of truth there) ----
 * severity = base priority 0..4 (P0 most severe); moneyAtRisk categories pin to P0 on a spike. */
const TAXONOMY = [
  { key: 'PAYMENT_NOT_NOTIFIED', label: 'Paid — BSS not notified',    team: 'BSS',      clientSide: false, tone: 'red',   severity: 1, moneyAtRisk: true },
  { key: 'PROVISION_NO_ORDER',   label: 'Paid — order not created',   team: 'OSS',      clientSide: false, tone: 'red',   severity: 1, moneyAtRisk: true },
  { key: 'PAYMENT_FAILED',       label: 'Payment failure',            team: 'BSS',      clientSide: false, tone: 'red',   severity: 2, moneyAtRisk: true },
  { key: 'OSS_EXCEPTION',        label: 'OSS / STC order exception',  team: 'OSS',      clientSide: false, tone: 'red',   severity: 2, moneyAtRisk: false },
  { key: 'LANDLINE_LOCK_FAILED', label: 'Failed to lock landline',    team: 'OSS',      clientSide: false, tone: 'red',   severity: 2, moneyAtRisk: false },
  { key: 'NAFATH_TIMEOUT',       label: 'Nafath timeout / no callback', team: 'IDENTITY', clientSide: false, tone: 'amber', severity: 2, moneyAtRisk: false },
  { key: 'SEMATI_FAILED',        label: 'Semati failure',             team: 'IDENTITY', clientSide: false, tone: 'red',   severity: 2, moneyAtRisk: false },
  { key: 'YAKEEN_FAILED',        label: 'Yakeen validation failed',   team: 'IDENTITY', clientSide: false, tone: 'red',   severity: 3, moneyAtRisk: false },
  { key: 'NAFATH_REJECTED',      label: 'Nafath rejected',            team: 'IDENTITY', clientSide: false, tone: 'red',   severity: 3, moneyAtRisk: false },
  { key: 'MOBILE_EXISTS',        label: 'Mobile already exists',      team: 'IDENTITY', clientSide: false, tone: 'amber', severity: 3, moneyAtRisk: false },
  { key: 'FEASIBILITY_FAILED',   label: 'Feasibility / coverage failed', team: 'OSS',   clientSide: false, tone: 'red',   severity: 3, moneyAtRisk: false },
  { key: 'APPOINTMENT_FAILED',   label: 'Appointment failed',         team: 'OSS',      clientSide: false, tone: 'amber', severity: 3, moneyAtRisk: false },
  { key: 'TIMEOUT',              label: 'Response timeout',           team: 'PLATFORM', clientSide: false, tone: 'amber', severity: 3, moneyAtRisk: false },
  { key: 'OTHER',                label: 'Other failure',              team: 'PLATFORM', clientSide: false, tone: 'muted', severity: 3, moneyAtRisk: false },
  { key: 'OUTSTANDING_DUE',      label: 'Outstanding due (business)', team: 'BSS',      clientSide: false, tone: 'muted', severity: 4, moneyAtRisk: false, businessRule: true },
  { key: 'GEO_DENIED',           label: 'Location denied (client)',   team: 'CLIENT',   clientSide: true,  tone: 'muted', severity: 4, moneyAtRisk: false, businessRule: true },
];
const META = Object.fromEntries(TAXONOMY.map(c => [c.key, c]));
const TEAMS = ['OSS', 'IDENTITY', 'BSS', 'CLIENT', 'PLATFORM'];
const SPIKE = 15;   // mirror of the ERR_SPIKE alert default
const meta = cat => META[cat] || { key: cat, label: cat, team: 'PLATFORM', clientSide: false, tone: 'muted', severity: 3, moneyAtRisk: false };
function effectiveSeverity(base, countInWindow, moneyAtRisk) {
  let sev = base;
  if (countInWindow >= SPIKE) sev -= 1;
  if (countInWindow >= SPIKE * 3) sev -= 1;
  if (moneyAtRisk && countInWindow >= SPIKE) sev = 0;
  return Math.max(0, sev);
}

/* ---- windows (errors.ts WINDOWS) — "today" = KSA day boundary; the rest are rolling ---- */
const WINDOW_HOURS = { '1h': 1, '3h': 3, '6h': 6, '24h': 24, 'today': null, '7d': 168, '30d': 720, '90d': 2160, '365d': 8760 };
const KSA = 3 * 3600e3;
function parseWindow(q = {}) {
  const now = new Date();
  let to = q.to ? new Date(q.to) : now;
  let from;
  const w = String(q.range || q.window || 'today');
  if (q.from) from = new Date(q.from);
  else if (w === 'today') { const k = new Date(now.getTime() + KSA); k.setUTCHours(0, 0, 0, 0); from = new Date(k.getTime() - KSA); }
  else from = new Date(now.getTime() - (WINDOW_HOURS[w] || 24) * 3600e3);
  if (isNaN(from) || isNaN(to)) { from = new Date(now.getTime() - 24 * 3600e3); to = now; }
  return { from, to, window: w };
}

/* ---- identifier search (errors.ts identifierSql) — correlates by attempt_id, no FK ---- */
const odbTerm = v => String(v).replace(/^\s*(odb|plate)\s*(?:no\.?|number)?\s*[:#-]?\s*/i, '').trim() || String(v).trim();
const like = v => '%' + String(v).trim() + '%';
function identifierSql(q, P) {
  const preds = [];
  const any = q.find || q.anyId;
  if (any) {
    P.push(like(any)); const v = P.length; P.push(like(odbTerm(any))); const o = P.length;
    preds.push(`(oa.odb ILIKE $${o} OR oa.service_no ILIKE $${v} OR oa.iccid ILIKE $${v} OR oa.cpe ILIKE $${v} OR oa.msisdn ILIKE $${v}
      OR oa.cust_code ILIKE $${v} OR oa.customer_id ILIKE $${v} OR oa.order_number ILIKE $${v} OR oa.referral_code ILIKE $${v} OR oa.id ILIKE $${v})`);
  }
  const cols = { odb: 'oa.odb', iccid: 'oa.iccid', cpe: 'oa.cpe', msisdn: 'oa.msisdn', serviceNo: 'oa.service_no', custCode: 'oa.cust_code', customerId: 'oa.customer_id', workflowId: 'oa.id' };
  for (const [k, col] of Object.entries(cols)) if (q[k]) { P.push(like(k === 'odb' ? odbTerm(q[k]) : q[k])); preds.push(`${col} ILIKE $${P.length}`); }
  // access-tech chip (FTTX = ftth/fttb workflows · 5G = fiveG* workflows)
  if (q.tech === 'fttx') preds.push(`oa.workflow::text IN ('ftth','fttb','ePurchaseFTTH')`);
  else if (q.tech === '5g') preds.push(`oa.workflow::text ILIKE 'fiveG%'`);
  if (!preds.length) return null;
  return `e.attempt_id IN (SELECT oa.id FROM order_attempts oa WHERE ${preds.join(' AND ')} LIMIT 5000)`;
}

/* ---- shared WHERE for summary/live (alias e = error_events) ---- */
function baseWhere(q) {
  const w = parseWindow(q);
  const P = [w.from.toISOString(), w.to.toISOString()];
  const parts = ['e.occurred_at >= $1', 'e.occurred_at < $2', `NOT (e.channel = 'epurchase' AND e.referral_code IS NULL)`];
  const channel = ['sda', 'epurchase', 'salamhome'].includes(q.channel) ? q.channel : null;
  if (channel) { P.push(channel); parts.push(`e.channel = $${P.length}`); }
  if (q.region) { P.push(String(q.region).slice(0, 60)); parts.push(`e.region = $${P.length}`); }
  if (q.dealerId) { P.push(String(q.dealerId).slice(0, 40)); parts.push(`e.dealer_id = $${P.length}`); }
  const ident = identifierSql(q, P);
  if (ident) parts.push(ident);
  return { ...w, channel, P, where: 'WHERE ' + parts.join(' AND ') };
}
const n = v => Number(v) || 0;
const parseJson = s => { if (s == null) return null; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch (_) { return s; } };

function mount(app, deps) {
  const { gate, wrap, audit, db } = deps;
  const ops = () => { if (!db.ops) { const e = new Error('Fixed data source not configured (OPS_DATABASE_URL)'); e.status = 503; throw e; } return db.ops; };

  /* acks live in the console DB — sda_ops stays read-only */
  let ackReady = null;
  async function ackTable() {
    if (!db.console) return null;
    if (!ackReady) ackReady = db.console.query(`CREATE TABLE IF NOT EXISTS fixed_error_acks (id text PRIMARY KEY, actor text, at timestamptz DEFAULT now())`).catch(e => { ackReady = null; throw e; });
    await ackReady; return db.console;
  }
  async function acksFor(ids) {
    if (!ids.length) return {};
    try { const c = await ackTable(); if (!c) return {};
      const r = await c.query(`SELECT id, actor, at FROM fixed_error_acks WHERE id = ANY($1::text[])`, [ids]);
      return Object.fromEntries(r.rows.map(x => [x.id, { actor: x.actor, at: x.at }]));
    } catch (_) { return {}; }
  }

  /* per-category last-3h volume → effective priority (same escalation as the prod board) */
  async function effByCategory() {
    const r = await ops().query(`SELECT category, count(*)::int AS n FROM error_events e
      WHERE e.occurred_at >= now() - interval '3 hours' AND NOT (e.channel = 'epurchase' AND e.referral_code IS NULL) GROUP BY 1`);
    const last3h = Object.fromEntries(r.rows.map(x => [x.category, n(x.n)]));
    const eff = {}; for (const c of TAXONOMY) eff[c.key] = effectiveSeverity(c.severity, last3h[c.key] || 0, c.moneyAtRisk);
    for (const k of Object.keys(last3h)) if (!(k in eff)) eff[k] = effectiveSeverity(3, last3h[k], false);
    return eff;
  }

  // ---- GET /api/fixed/errors/summary ----
  async function summary(q) {
    const s = baseWhere(q);
    const r = await ops().query(`SELECT e.category, count(*)::int AS total, count(*) FILTER (WHERE NOT e.resolved)::int AS open,
        count(*) FILTER (WHERE e.occurred_at >= now() - interval '3 hours')::int AS last3h
      FROM error_events e ${s.where} GROUP BY 1 ORDER BY 2 DESC LIMIT 100`, s.P);
    const openOnly = q.openOnly === '1' || q.openOnly === 'true';
    const byCategory = r.rows.map(x => { const m = meta(x.category);
      return { category: x.category, label: m.label, team: m.team, tone: m.tone, clientSide: m.clientSide, moneyAtRisk: m.moneyAtRisk,
        basePriority: m.severity, priority: effectiveSeverity(m.severity, n(x.last3h), m.moneyAtRisk), open: n(x.open), total: n(x.total), last3h: n(x.last3h) }; });
    const byTeam = Object.fromEntries(TEAMS.map(t => [t, { open: 0, total: 0 }]));
    const byPriority = Object.fromEntries([0, 1, 2, 3, 4].map(p => [p, { open: 0, total: 0 }]));
    for (const c of byCategory) { byTeam[c.team].open += c.open; byTeam[c.team].total += c.total; byPriority[c.priority].open += c.open; byPriority[c.priority].total += c.total; }
    return { window: s.window, from: s.from, to: s.to, channel: s.channel, openOnly,
      total: byCategory.reduce((a, c) => a + c.total, 0), open: byCategory.reduce((a, c) => a + c.open, 0),
      byCategory: openOnly ? byCategory.filter(c => c.open > 0) : byCategory, byTeam, byPriority, taxonomy: TAXONOMY, spike: SPIKE };
  }

  // ---- GET /api/fixed/errors/live ----
  async function live(q, req) {
    const s = baseWhere(q);
    const P = s.P.slice(); const extra = [];
    if (q.openOnly === '1' || q.openOnly === 'true') extra.push('NOT e.resolved');
    if (q.category) { P.push(String(q.category).slice(0, 60)); extra.push(`e.category = $${P.length}`); }
    let cats = null;
    if (q.team && TEAMS.includes(q.team)) cats = TAXONOMY.filter(c => c.team === q.team).map(c => c.key);
    const eff = await effByCategory();
    if (q.priority !== undefined && q.priority !== '') {
      const p = Number(q.priority);
      const pc = Object.keys(eff).filter(k => eff[k] === p);
      cats = cats ? cats.filter(k => pc.includes(k)) : pc;
      // categories unknown to the taxonomy (and quiet in the last 3h) are PLATFORM / P3
      if (p === 3 && (!q.team || q.team === 'PLATFORM')) { P.push(Object.keys(eff)); extra.push(`(e.category = ANY($${P.length + 1}::text[]) OR e.category <> ALL($${P.length}::text[]))`); P.push(cats); cats = null; }
    }
    if (cats) { if (!cats.length) return { window: s.window, from: s.from, to: s.to, rows: [] }; P.push(cats); extra.push(`e.category = ANY($${P.length}::text[])`); }
    if (q.cursor) { P.push(String(q.cursor)); extra.push(`e.occurred_at < (SELECT occurred_at FROM error_events WHERE id = $${P.length})`); }
    const lim = Math.min(200, Math.max(10, Number(q.limit) || 100));
    P.push(lim + 1);
    const r = await ops().query(`SELECT e.id, e.attempt_id, e.order_number, e.acct_masked, e.cust_masked, e.category, e.code, e.message, e.client_side,
        e.channel, e.dealer_id, e.dealer_code, e.referral_code, e.region, e.step, e.occurred_at, e.resolved, e.resolved_at, e.signature
      FROM error_events e ${s.where} ${extra.length ? 'AND ' + extra.join(' AND ') : ''} ORDER BY e.occurred_at DESC LIMIT $${P.length}`, P);
    const rows = r.rows.slice(0, lim);
    const acks = await acksFor(rows.map(x => x.id));
    if (audit && (q.find || q.anyId)) audit(req, 'fixed.errors.search', String(q.find || q.anyId).slice(0, 40), { rows: rows.length });
    return { window: s.window, from: s.from, to: s.to, nextCursor: r.rows.length > lim ? rows[rows.length - 1].id : null,
      rows: rows.map(x => { const m = meta(x.category); const a = acks[x.id];
        return { ...x, label: m.label, team: m.team, tone: m.tone, priority: eff[x.category] != null ? eff[x.category] : m.severity,
          acked: !!a, acked_by: a ? a.actor : null, acked_at: a ? a.at : null }; }) };
  }

  // ---- "Similar cases" (errors.ts history) ----
  async function similar(signature, category, excludeId) {
    const key = signature ? 'signature = $1' : 'category = $1';
    const P = [signature || category]; let ex = '';
    if (excludeId) { P.push(excludeId); ex = ` AND id <> $${P.length}`; }
    const [rows, biggest] = await Promise.all([
      ops().query(`SELECT count(*)::int AS "all",
          count(*) FILTER (WHERE occurred_at >= now() - interval '30 days')::int AS d30,
          count(*) FILTER (WHERE occurred_at >= now() - interval '7 days')::int AS d7,
          max(occurred_at) AS last_seen,
          count(DISTINCT attempt_id) FILTER (WHERE occurred_at::date = current_date)::int AS affected_today,
          (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - occurred_at)) / 60.0)
             FILTER (WHERE resolved AND resolved_at IS NOT NULL))::int AS median_resolve_mins
        FROM error_events WHERE ${key}${ex}`, P),
      ops().query(`SELECT occurred_at::date AS day, count(*)::int AS n FROM error_events WHERE ${key}${ex} GROUP BY 1 ORDER BY n DESC LIMIT 1`, P),
    ]);
    const r = rows.rows[0] || {}; const b = biggest.rows[0];
    return { all: n(r.all), d30: n(r.d30), d7: n(r.d7), lastSeen: r.last_seen || null, affectedToday: n(r.affected_today),
      medianResolveMins: r.median_resolve_mins == null ? null : n(r.median_resolve_mins),
      biggestDay: b ? { day: new Date(b.day).toISOString().slice(0, 10), count: n(b.n) } : null };
  }

  /* raw api_logs match (source-db.ts bestRawMatch): same endpoint path, closest created_at */
  const urlPath = u => { try { return new URL(u).pathname; } catch (_) { const nq = String(u || '').split('?')[0]; return nq.replace(/^https?:\/\/[^/]+/i, '') || nq; } };
  const asBody = v => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));
  function requestDisplay(m) {
    const body = (m.payload || '').trim();
    if (body && body !== '{}' && body !== 'null') return m.payload;
    const qi = m.url.indexOf('?'); if (qi < 0) return m.payload;
    const obj = {}; for (const [k, v] of new URLSearchParams(m.url.slice(qi + 1))) obj[k] = v;
    if (!Object.keys(obj).length) return m.payload;
    return '// GET — no request body; URL query parameters:\n' + JSON.stringify(obj, null, 2);
  }
  function bestRawMatch(raws, step, at) {
    const cand = step ? raws.filter(r => r.endpoint === step) : raws;
    const pool = cand.length ? cand : raws; if (!pool.length) return null;
    if (!at) return pool[0];
    let best = null, bd = Infinity;
    for (const r of pool) { const d = r.createdAt ? Math.abs(r.createdAt.getTime() - at.getTime()) : Number.MAX_SAFE_INTEGER; if (d < bd) { bd = d; best = r; } }
    return best;
  }

  // ---- GET /api/fixed/errors/detail ----
  async function detail(q, req) {
    const id = String(q.id || '').slice(0, 80); if (!id) { const e = new Error('id required'); e.status = 400; throw e; }
    const r = await ops().query(`SELECT e.*, d.dealer_name, d.staff_name, d.staff_code FROM error_events e LEFT JOIN dealers d ON d.id = e.dealer_id WHERE e.id = $1 LIMIT 1`, [id]);
    const ev = r.rows[0]; if (!ev) { const e = new Error('error event not found'); e.status = 404; throw e; }
    const m = meta(ev.category);
    const [sim, calls, acks] = await Promise.all([
      similar(ev.signature, ev.category, ev.id),
      ev.attempt_id ? ops().query(`SELECT id, method, endpoint, status, duration_ms, error_class, error_msg, info, created_at
          FROM api_calls WHERE attempt_id = $1 ORDER BY created_at ASC LIMIT 200`, [ev.attempt_id]) : { rows: [] },
      acksFor([ev.id]),
    ]);
    const out = { event: { ...ev, req_body: undefined, res_body: undefined, label: m.label, team: m.team, tone: m.tone, basePriority: m.severity, acked: !!acks[ev.id], acked_by: acks[ev.id] ? acks[ev.id].actor : null },
      request: parseJson(ev.req_body), response: parseJson(ev.res_body), masked: true,
      similar: sim, timeline: calls.rows, unmaskAvailable: !!db.nexus };
    // ---- audited unmask: raw request/response of the failing step from nexus.api_logs ----
    if (q.unmask === '1' && req && req.caps && req.caps.unmaskPII) {
      if (!db.nexus || !ev.attempt_id) { out.unmask = { unmaskAvailable: false }; return out; }
      try {
        const [logs, ws] = await Promise.all([
          db.nexus.query(`SELECT endpoint, payload, response, created_at FROM api_logs WHERE workflow_state_id = $1 ORDER BY created_at ASC, id ASC LIMIT 50`, [ev.attempt_id]),
          db.nexus.query(`SELECT context FROM workflow_states WHERE id = $1 LIMIT 1`, [ev.attempt_id]).catch(() => ({ rows: [] })),
        ]);
        const raws = logs.rows.map(x => ({ endpoint: urlPath(String(x.endpoint || '')), url: String(x.endpoint || ''), payload: asBody(x.payload), response: asBody(x.response), createdAt: x.created_at ? new Date(x.created_at) : null }));
        const match = bestRawMatch(raws, ev.step, ev.occurred_at ? new Date(ev.occurred_at) : null);
        if (audit) await audit(req, 'pii.unmask', ev.attempt_id, { errorId: ev.id, step: ev.step, matched: !!match, page: 'fixed.errors' });
        out.unmask = { unmaskAvailable: true, matched: !!match,
          request: match ? parseJson(requestDisplay(match)) : null, response: match ? parseJson(match.response) : null,
          endpoint: match ? match.url : null, at: match ? match.createdAt : null,
          context: ws.rows[0] ? ws.rows[0].context : null, calls: raws.length };
      } catch (e) { out.unmask = { unmaskAvailable: false, error: e.message }; }
    }
    return out;
  }

  // ---- POST /api/fixed/errors/resolve — ack in the console DB (sda_ops is read-only) ----
  async function resolve(q, req) {
    if (!req.caps || !req.caps.ackErrors) { const e = new Error(`role ${req.roleName} lacks ackErrors`); e.status = 403; throw e; }
    const b = req.body || {}; const id = String(b.id || q.id || '').slice(0, 80);
    if (!id) { const e = new Error('id required'); e.status = 400; throw e; }
    const c = await ackTable(); if (!c) { const e = new Error('console DB unavailable'); e.status = 503; throw e; }
    const undo = b.undo === true || b.undo === 1 || b.undo === '1';
    if (undo) await c.query(`DELETE FROM fixed_error_acks WHERE id = $1`, [id]);
    else await c.query(`INSERT INTO fixed_error_acks (id, actor) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, req.actor || null]);
    if (audit) audit(req, undo ? 'fixed.errors.unack' : 'fixed.errors.ack', id, {});
    return { ok: true, id, acked: !undo, actor: req.actor || null };
  }

  app.get('/api/fixed/errors/summary', gate, wrap(q => summary(q)));
  app.get('/api/fixed/errors/live',    gate, wrap((q, req) => live(q, req)));
  app.get('/api/fixed/errors/detail',  gate, wrap((q, req) => detail(q, req)));
  app.post('/api/fixed/errors/resolve', gate, wrap((q, req) => resolve(q, req)));
  app.get('/api/fixed/errors/taxonomy', gate, (req, res) => res.json({ taxonomy: TAXONOMY, teams: TEAMS, spike: SPIKE }));
}

module.exports = { mount, TAXONOMY, TEAMS, SPIKE, effectiveSeverity, parseWindow };
