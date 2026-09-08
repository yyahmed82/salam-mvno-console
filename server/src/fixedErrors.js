/* fixedErrors.js — Fixed "Errors" page: the Live Error Control Board of the Operations Console
 * (salam-dealer-ops packages/api/src/routers/errors.ts) ported 1:1 onto the unified console.
 *
 * Data (READ-ONLY): error_events · order_attempts · api_calls · dealers from TWO read models of the same nexus stream:
 *   · db.ops     = prod sda_ops.public (ops-ingest-watch)  — the dealer world: SDA journeys and QR / referral e-purchase.
 *     Its ingest still folds the Salam Home app (nexus channel PULSE) into "epurchase" without a referral code, which
 *     is why "consumer-direct e-purchase" was hidden there: it was a mix of web orders and app journeys.
 *   · db.opsBeta = sda_ops_beta (opsb-ingest-watch) — the B2C read model: PULSE → channel "salamhome", consumer-direct
 *     e-purchase STORED, salamHome* workflows mapped. Coverage from 2026-01-01 (backfilled).
 * The board covers all four channels by PARTITIONING the two sources — each channel bucket comes from exactly one:
 *   sda, qr  ← db.ops      (channel 'sda' · channel 'epurchase' WITH referral code)
 *   web, app ← db.opsBeta  (channel 'epurchase' WITHOUT referral code = Web e-purchase · channel 'salamhome' = Salam Home app)
 * so nothing is counted twice and nothing is hidden. Without OPS_BETA_DATABASE_URL every bucket is read from db.ops.
 * Channel and product TYPE are derived in SQL (CHANNEL_EXPR / TYPE_EXPR — the type from the attempt's workflow, then
 * its plan text) so the board can show, filter, count and export them.
 * Acks never touch either DB: they live in the console's own DB (fixed_error_acks) keyed by the deterministic event id
 * (hash of attempt · step · code · time — identical in both read models) and are merged in.
 * Unmask (cap unmaskPII + ?unmask=1): raw api_logs / workflow_states from db.nexus, audited pii.unmask.
 * Routes (all under /api/fixed/errors/*, gated by deps.gate = requireView('fixed')):
 *   GET  summary  ?range|from|to&channel&type&provider&openOnly&find&tech&odb&iccid&cpe&msisdn&serviceNo&custCode&customerId&workflowId
 *                 channel = sda | qr | web | salamhome (legacy: epurchase = qr + web) · type = ftth | fttb | 5gwl | 5gfwa | 5g | lead | unknown
 *   GET  live     …same + &team&priority&category&limit&cursor   (cursor = ISO time of the last row — sources are merged)
 *   GET  detail   ?id[&src=ops|beta][&unmask=1]
 *   GET  export   ?format=xlsx|pdf …same filters as live   (cap export) — filters, period, summary, every row
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
const WINDOW_HOURS = { '1h': 1, '3h': 3, '6h': 6, '24h': 24, '32h': 32, '48h': 48, '72h': 72, 'today': null, '7d': 168, '30d': 720, '90d': 2160, '365d': 8760 };
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
  const sub = `e.attempt_id IN (SELECT oa.id FROM order_attempts oa WHERE ${preds.join(' AND ')} LIMIT 5000)`;
  // "any" and workflow id also match the event row itself (order / referral / dealer / attempt id), so an error whose
  // attempt row was not ingested (or was trimmed) is still found — same reach as the prod board.
  const direct = [];
  if (any) { P.push(like(any)); const d = P.length; direct.push(`e.order_number ILIKE $${d}`, `e.attempt_id ILIKE $${d}`, `e.referral_code ILIKE $${d}`, `e.dealer_code ILIKE $${d}`); }
  if (q.workflowId && Object.keys(cols).every(k => k === 'workflowId' || !q[k]) && !q.tech) { P.push(like(q.workflowId)); direct.push(`e.attempt_id ILIKE $${P.length}`); }
  return direct.length ? `(${sub} OR ${direct.join(' OR ')})` : sub;
}

/* ---- provider (DAWIYAT / TLS / STC …) — not a column: the failing call's request body carries it
 * ("provider": "DAWIYAT" on feasibility / appointment / order calls). Extracted with one regex so the
 * board can filter and count by provider; events whose request has no provider land in the "no provider"
 * bucket (value "-"). Bounded by the window WHERE, so the regex only runs on the rows already selected. */
const PROVIDER_EXPR = `upper(substring(e.req_body from '"provider"\\s*:\\s*"([^"]+)"'))`;

/* ---- channel buckets — derived from the event row (alias e). The app always wins over the referral code. ---- */
const CHANNELS = [
  { key: 'sda',       label: 'SDA (dealer)',    short: 'SDA',  src: 'ops',  desc: 'dealer app journeys' },
  { key: 'qr',        label: 'QR codes',        short: 'QR',   src: 'ops',  desc: 'e-purchase web flow opened from a dealer / campaign QR (referral code)' },
  { key: 'web',       label: 'Web e-purchase',  short: 'Web',  src: 'beta', desc: 'public e-purchase web flow, consumer-direct (no referral code)' },
  { key: 'salamhome', label: 'Salam Home app',  short: 'App',  src: 'beta', desc: 'Salam Home (Pulse) app — buy FTTH + manage-line journeys' },
];
const CHAN = Object.fromEntries(CHANNELS.map(c => [c.key, c]));
const CHANNEL_EXPR = `CASE WHEN e.channel = 'sda' THEN 'sda' WHEN e.channel = 'salamhome' THEN 'salamhome' WHEN e.referral_code IS NOT NULL THEN 'qr' ELSE 'web' END`;
/* which buckets each source serves when BOTH read models are configured (see header) */
const SRC_BUCKETS = { ops: ['sda', 'qr'], beta: ['web', 'salamhome'] };
const bucketSql = keys => `${CHANNEL_EXPR} IN (${keys.map(k => `'${k}'`).join(',')})`;
/* q.channel → bucket list: new keys, the legacy hub values, or everything */
function channelBuckets(q) {
  const c = String(q.channel || '').toLowerCase();
  if (!c) return CHANNELS.map(x => x.key);
  if (c === 'epurchase') return ['qr', 'web'];
  if (c === 'app') return ['salamhome'];
  return CHAN[c] ? [c] : CHANNELS.map(x => x.key);
}

/* ---- product TYPE — from the attempt's workflow (alias oa = order_attempts, LEFT JOINed), then its plan text.
 * Journeys of the Salam Home app carry the product they act on (relocation FTTH = fibre, relocation WL / Own = 5G);
 * manage-line journeys without a plan hint (freeze / renew …) stay 'unknown' rather than guessing. ---- */
const TYPES = [
  { key: 'ftth',    label: 'FTTH',         desc: 'fibre to the home — ftth · ePurchaseFTTH · salamHomeRelocationFTTH · plan ~ fiber' },
  { key: 'fttb',    label: 'FTTB',         desc: 'fibre to the building (business) — fttb · plan ~ FTTB / business' },
  { key: '5gwl',    label: '5G HomeFi',    desc: 'fiveGWhiteLabel · salamHomeRelocationWL / Own' },
  { key: '5gfwa',   label: '5G FWA',       desc: 'fiveGFWA' },
  { key: '5g',      label: '5G (plan)',    desc: 'workflow does not say — the plan text says 5G' },
  { key: 'lead',    label: 'Lead',         desc: 'promoters (lead capture, no order)' },
  { key: 'unknown', label: 'Unknown',      desc: 'no attempt row or no product hint' },
];
const TYPE = Object.fromEntries(TYPES.map(t => [t.key, t]));
const TYPE_EXPR = `CASE
  WHEN oa.workflow::text IN ('ftth','ePurchaseFTTH','salamHomeRelocationFTTH') THEN 'ftth'
  WHEN oa.workflow::text = 'fttb' THEN 'fttb'
  WHEN oa.workflow::text IN ('fiveGWhiteLabel','salamHomeRelocationWL','salamHomeRelocationOwn') THEN '5gwl'
  WHEN oa.workflow::text = 'fiveGFWA' THEN '5gfwa'
  WHEN oa.workflow::text = 'promoters' THEN 'lead'
  WHEN oa.plan ILIKE '%5g%' THEN '5g'
  WHEN oa.plan ILIKE '%fttb%' OR oa.plan ILIKE '%business%' THEN 'fttb'
  WHEN oa.plan ILIKE '%ftth%' OR oa.plan ILIKE '%fiber%' OR oa.plan ILIKE '%fibre%' THEN 'ftth'
  ELSE 'unknown' END`;
const WF_LABEL = { ftth: 'New line', fttb: 'New line', fiveGWhiteLabel: 'New line', fiveGFWA: 'New line', promoters: 'Lead', ePurchaseFTTH: 'New line',
  salamHomeFreeze: 'Freeze', salamHomeUnFreeze: 'Unfreeze', salamHomeRelocationFTTH: 'Relocation', salamHomeRelocationWL: 'Relocation', salamHomeRelocationOwn: 'Relocation',
  salamHomeChangePlan: 'Change plan', salamHomeChangePlanPre2Post: 'Pre → post', salamHomeRenew: 'Renew', unknown: '' };
const JOIN_OA = 'LEFT JOIN order_attempts oa ON oa.id = e.attempt_id';

/* ---- shared WHERE for summary/live (alias e = error_events, oa = order_attempts) ----
 * opts.skip = a dimension ('provider' | 'channel' | 'type') to leave OUT so its chips keep their counts while selected. */
function baseWhere(q, opts = {}) {
  const w = parseWindow(q);
  const P = [w.from.toISOString(), w.to.toISOString()];
  const parts = ['e.occurred_at >= $1', 'e.occurred_at < $2'];
  const buckets = opts.skip === 'channel' ? CHANNELS.map(x => x.key) : channelBuckets(q);
  if (q.region) { P.push(String(q.region).slice(0, 60)); parts.push(`e.region = $${P.length}`); }
  if (q.dealerId) { P.push(String(q.dealerId).slice(0, 40)); parts.push(`e.dealer_id = $${P.length}`); }
  if (q.provider && opts.skip !== 'provider') {
    if (q.provider === '-') parts.push(`${PROVIDER_EXPR} IS NULL`);
    else { P.push(String(q.provider).toUpperCase().slice(0, 40)); parts.push(`${PROVIDER_EXPR} = $${P.length}`); }
  }
  const type = TYPE[String(q.type || '').toLowerCase()] ? String(q.type).toLowerCase() : null;
  if (type && opts.skip !== 'type') { P.push(type); parts.push(`${TYPE_EXPR} = $${P.length}`); }
  const ident = identifierSql(q, P);
  if (ident) parts.push(ident);
  return { ...w, channel: q.channel || null, buckets, type, P, parts };
}
/* the WHERE for one source: the shared parts + this source's slice of the requested buckets (null = nothing to ask) */
function whereFor(s, src, split) {
  const mine = split ? s.buckets.filter(b => SRC_BUCKETS[src].includes(b)) : s.buckets;
  if (!mine.length) return null;
  const parts = s.parts.slice();
  if (mine.length < CHANNELS.length) parts.push(bucketSql(mine));
  return 'WHERE ' + parts.join(' AND ');
}
const n = v => Number(v) || 0;
const parseJson = s => { if (s == null) return null; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch (_) { return s; } };

function mount(app, deps) {
  const { gate, wrap, audit, db } = deps;
  /* ---- the read models. split = both configured, different AND the beta model is FRESH → partition (header);
   * otherwise one pool (prod) serves every bucket. Freshness is decided from data, not config: the beta watcher
   * (opsb-ingest-watch) stopped writing on 22 Aug 2026 without anyone noticing, and a partition that trusts a dead
   * model would show "Web e-purchase · 0" while prod holds a thousand rows. Rule: beta is used only while its newest
   * event is within BETA_STALE_MIN (default 120) of prod's newest event; re-checked every 60 s. ---- */
  const BETA_STALE_MIN = Number(process.env.OPS_BETA_STALE_MIN) || 120;
  const both = () => !!(db.ops && db.opsBeta && db.opsBeta !== db.ops);
  const splitState = { at: 0, value: false, opsLatest: null, betaLatest: null, reason: 'not checked' };
  const split = () => splitState.value;
  async function refreshSplit() {
    if (!both()) { splitState.value = false; splitState.reason = 'one read model'; return false; }
    if (Date.now() - splitState.at < 60000) return splitState.value;
    const latest = async pool => { try { const r = await pool.query(`SELECT max(occurred_at) AS m FROM error_events WHERE occurred_at >= now() - interval '30 days'`); return r.rows[0] && r.rows[0].m ? new Date(r.rows[0].m) : null; } catch (_) { return null; } };
    const [o, b] = await Promise.all([latest(db.ops), latest(db.opsBeta)]);
    splitState.at = Date.now(); splitState.opsLatest = o; splitState.betaLatest = b;
    const ref = o || new Date();
    const fresh = !!b && (ref.getTime() - b.getTime()) <= BETA_STALE_MIN * 60000;
    if (fresh !== splitState.value) console.log(`[fixed-errors] beta read model ${fresh ? 'fresh — Web + Salam Home app served from sda_ops_beta' : `stale (newest ${b ? b.toISOString() : 'none'} vs prod ${ref.toISOString()}) — every channel served from sda_ops`}`);
    splitState.value = fresh; splitState.reason = fresh ? 'beta fresh' : (b ? `beta stale: newest event ${b.toISOString()}` : 'beta empty');
    return fresh;
  }
  function sources() {
    const list = [];
    if (db.ops) list.push({ src: 'ops', pool: db.ops });
    if (db.opsBeta && (!db.ops || db.opsBeta !== db.ops)) list.push({ src: 'beta', pool: db.opsBeta });
    if (!list.length) { const e = new Error('Fixed data source not configured (OPS_DATABASE_URL)'); e.status = 503; throw e; }
    return list;
  }
  const poolOf = src => (src === 'beta' && db.opsBeta) ? db.opsBeta : (db.ops || db.opsBeta);
  /* run `fn(pool, where, src)` on every source that has something to answer for this filter set; results in source order */
  /* the sources that ANSWER right now: both when the partition is on, else prod alone (never both unsplit — that doubles) */
  const active = () => { const all = sources(); return split() ? all : [all.find(x => x.src === 'ops') || all[0]]; };
  async function each(s, fn) {
    const sp = await refreshSplit();
    const jobs = active().map(x => { const w = whereFor(s, x.src, sp); return w ? fn(x.pool, w, x.src).then(r => ({ src: x.src, r })) : null; }).filter(Boolean);
    return Promise.all(jobs);
  }
  /* the partition predicate alone (no user filters) — for the 3h escalation counts and freshness */
  const sliceOnly = src => { if (!split()) return ''; return 'AND ' + bucketSql(SRC_BUCKETS[src]); };

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

  /* per-category last-3h volume → effective priority (same escalation as the prod board), summed over the sources */
  async function effByCategory() {
    await refreshSplit();
    const last3h = {};
    await Promise.all(active().map(async x => {
      const r = await x.pool.query(`SELECT category, count(*)::int AS n FROM error_events e
        WHERE e.occurred_at >= now() - interval '3 hours' ${sliceOnly(x.src)} GROUP BY 1`);
      for (const row of r.rows) last3h[row.category] = (last3h[row.category] || 0) + n(row.n);
    }));
    const eff = {}; for (const c of TAXONOMY) eff[c.key] = effectiveSeverity(c.severity, last3h[c.key] || 0, c.moneyAtRisk);
    for (const k of Object.keys(last3h)) if (!(k in eff)) eff[k] = effectiveSeverity(3, last3h[k], false);
    return eff;
  }

  /* one GROUP BY over every source, merged by key: [{key, total, open}] sorted by total desc */
  async function grouped(q, expr, skip, limit) {
    const s = baseWhere(q, { skip });
    const parts = await each(s, (pool, where) => pool.query(`SELECT ${expr} AS k, count(*)::int AS total, count(*) FILTER (WHERE NOT e.resolved)::int AS open
      FROM error_events e ${JOIN_OA} ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}`, s.P));
    const acc = {};
    for (const p of parts) for (const row of p.r.rows) { const k = row.k == null ? '-' : String(row.k); (acc[k] = acc[k] || { key: k, total: 0, open: 0 }); acc[k].total += n(row.total); acc[k].open += n(row.open); }
    return Object.values(acc).sort((a, b) => b.total - a.total);
  }

  // ---- GET /api/fixed/errors/summary ----
  async function summary(q) {
    const s = baseWhere(q);
    const openOnly = q.openOnly === '1' || q.openOnly === 'true';
    await refreshSplit();
    const [catParts, provs, chans, types, fresh] = await Promise.all([
      each(s, (pool, where) => pool.query(`SELECT e.category, count(*)::int AS total, count(*) FILTER (WHERE NOT e.resolved)::int AS open,
          count(*) FILTER (WHERE e.occurred_at >= now() - interval '3 hours')::int AS last3h
        FROM error_events e ${JOIN_OA} ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 100`, s.P)),
      grouped(q, PROVIDER_EXPR, 'provider', 20).catch(() => []),
      grouped(q, CHANNEL_EXPR, 'channel', 10).catch(() => []),
      grouped(q, TYPE_EXPR, 'type', 10).catch(() => []),
      Promise.all(sources().map(async x => { try { const r = await x.pool.query(`SELECT max(occurred_at) AS latest FROM error_events e WHERE e.occurred_at >= now() - interval '30 days' ${sliceOnly(x.src)}`);
        const served = split() ? SRC_BUCKETS[x.src] : (x.src === 'ops' ? CHANNELS.map(c => c.key) : []);
        return { src: x.src, buckets: served, latest: r.rows[0] && r.rows[0].latest || null, stale: x.src === 'beta' && both() && !split(), reason: x.src === 'beta' ? splitState.reason : undefined }; } catch (e) { return { src: x.src, error: e.message }; } })),
    ]);
    const cat = {};
    for (const p of catParts) for (const x of p.r.rows) { const c = cat[x.category] = cat[x.category] || { category: x.category, total: 0, open: 0, last3h: 0 }; c.total += n(x.total); c.open += n(x.open); c.last3h += n(x.last3h); }
    const byCategory = Object.values(cat).sort((a, b) => b.total - a.total).map(x => { const m = meta(x.category);
      return { category: x.category, label: m.label, team: m.team, tone: m.tone, clientSide: m.clientSide, moneyAtRisk: m.moneyAtRisk,
        basePriority: m.severity, priority: effectiveSeverity(m.severity, x.last3h, m.moneyAtRisk), open: x.open, total: x.total, last3h: x.last3h }; });
    const byTeam = Object.fromEntries(TEAMS.map(t => [t, { open: 0, total: 0 }]));
    const byPriority = Object.fromEntries([0, 1, 2, 3, 4].map(p => [p, { open: 0, total: 0 }]));
    for (const c of byCategory) { byTeam[c.team].open += c.open; byTeam[c.team].total += c.total; byPriority[c.priority].open += c.open; byPriority[c.priority].total += c.total; }
    /* chips are counted WITHOUT their own filter so every chip keeps its number while one is selected */
    const byProvider = provs.map(x => ({ provider: x.key, label: x.key === '-' ? 'no provider' : x.key, open: x.open, total: x.total }));
    const byChannel = CHANNELS.map(c => { const x = chans.find(y => y.key === c.key) || { open: 0, total: 0 }; return { channel: c.key, label: c.label, short: c.short, desc: c.desc, open: x.open, total: x.total }; });
    const byType = TYPES.map(t => { const x = types.find(y => y.key === t.key) || { open: 0, total: 0 }; return { type: t.key, label: t.label, desc: t.desc, open: x.open, total: x.total }; });
    return { window: s.window, from: s.from, to: s.to, channel: q.channel || '', type: s.type || '', openOnly, provider: q.provider || '',
      byProvider, byChannel, byType, sources: fresh, split: split(), splitReason: splitState.reason,
      total: byCategory.reduce((a, c) => a + c.total, 0), open: byCategory.reduce((a, c) => a + c.open, 0),
      byCategory: openOnly ? byCategory.filter(c => c.open > 0) : byCategory, byTeam, byPriority, taxonomy: TAXONOMY, spike: SPIKE, channels: CHANNELS, types: TYPES };
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
    // cursor = ISO time of the last row served (the sources are merged, so an id would only be valid in one of them)
    if (q.cursor) { const c = new Date(String(q.cursor)); if (!isNaN(c)) { P.push(c.toISOString()); extra.push(`e.occurred_at < $${P.length}::timestamptz`); } }
    const lim = Math.min(200, Math.max(10, Number(q.limit) || 100));
    P.push(lim + 1);
    const parts = await each({ ...s, P }, (pool, where, src) => pool.query(`SELECT e.id, e.attempt_id, e.order_number, e.acct_masked, e.cust_masked, e.category, e.code, e.message, e.client_side,
        e.channel, e.dealer_id, e.dealer_code, e.referral_code, e.region, e.step, e.occurred_at, e.resolved, e.resolved_at, e.signature,
        ${CHANNEL_EXPR} AS chan, ${TYPE_EXPR} AS type, oa.workflow::text AS workflow, oa.plan, '${src}'::text AS src
      FROM error_events e ${JOIN_OA} ${where} ${extra.length ? 'AND ' + extra.join(' AND ') : ''} ORDER BY e.occurred_at DESC LIMIT $${P.length}`, P));
    const all = [].concat(...parts.map(p => p.r.rows)).sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
    const rows = all.slice(0, lim);
    const acks = await acksFor(rows.map(x => x.id));
    if (audit && (q.find || q.anyId)) audit(req, 'fixed.errors.search', String(q.find || q.anyId).slice(0, 40), { rows: rows.length });
    return { window: s.window, from: s.from, to: s.to, nextCursor: all.length > lim && rows.length ? new Date(rows[rows.length - 1].occurred_at).toISOString() : null,
      rows: rows.map(x => { const m = meta(x.category); const a = acks[x.id];
        return { ...x, label: m.label, team: m.team, tone: m.tone, priority: eff[x.category] != null ? eff[x.category] : m.severity,
          chanLabel: (CHAN[x.chan] || {}).label || x.chan, typeLabel: (TYPE[x.type] || {}).label || x.type, journey: WF_LABEL[x.workflow] || '',
          acked: !!a, acked_by: a ? a.actor : null, acked_at: a ? a.at : null }; }) };
  }

  // ---- "Similar cases" (errors.ts history) ----
  async function similar(signature, category, excludeId, pool) {
    const key = signature ? 'signature = $1' : 'category = $1';
    const P = [signature || category]; let ex = '';
    if (excludeId) { P.push(excludeId); ex = ` AND id <> $${P.length}`; }
    const [rows, biggest] = await Promise.all([
      pool.query(`SELECT count(*)::int AS "all",
          count(*) FILTER (WHERE occurred_at >= now() - interval '30 days')::int AS d30,
          count(*) FILTER (WHERE occurred_at >= now() - interval '7 days')::int AS d7,
          max(occurred_at) AS last_seen,
          count(DISTINCT attempt_id) FILTER (WHERE occurred_at::date = current_date)::int AS affected_today,
          (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - occurred_at)) / 60.0)
             FILTER (WHERE resolved AND resolved_at IS NOT NULL AND resolved_at >= occurred_at))::int AS median_resolve_mins
        FROM error_events WHERE ${key}${ex}`, P),
      pool.query(`SELECT occurred_at::date AS day, count(*)::int AS n FROM error_events WHERE ${key}${ex} GROUP BY 1 ORDER BY n DESC LIMIT 1`, P),
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
    const DSQL = `SELECT e.*, d.dealer_name, d.staff_name, d.staff_code, ${CHANNEL_EXPR} AS chan, ${TYPE_EXPR} AS type, oa.workflow::text AS workflow, oa.plan
      FROM error_events e LEFT JOIN dealers d ON d.id = e.dealer_id ${JOIN_OA} WHERE e.id = $1 LIMIT 1`;
    // the row's own source first (the board passes src=); the same id may exist in both read models with a different channel label
    const order = sources().sort((a, b) => (a.src === q.src ? -1 : 0) - (b.src === q.src ? -1 : 0));
    let ev = null, pool = null;
    for (const x of order) { const r = await x.pool.query(DSQL, [id]); if (r.rows.length) { ev = r.rows[0]; pool = x.pool; ev.src = x.src; break; } }
    if (!ev) { const e = new Error('error event not found'); e.status = 404; throw e; }
    const m = meta(ev.category);
    const [sim, calls, acks] = await Promise.all([
      similar(ev.signature, ev.category, ev.id, pool),
      ev.attempt_id ? pool.query(`SELECT id, method, endpoint, status, duration_ms, error_class, error_msg, info, created_at
          FROM api_calls WHERE attempt_id = $1 ORDER BY created_at ASC LIMIT 200`, [ev.attempt_id]) : { rows: [] },
      acksFor([ev.id]),
    ]);
    const out = { event: { ...ev, req_body: undefined, res_body: undefined, label: m.label, team: m.team, tone: m.tone, basePriority: m.severity, acked: !!acks[ev.id], acked_by: acks[ev.id] ? acks[ev.id].actor : null,
        chanLabel: (CHAN[ev.chan] || {}).label || ev.chan, typeLabel: (TYPE[ev.type] || {}).label || ev.type, journey: WF_LABEL[ev.workflow] || '' },
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

  /* ---- export (team request, alpha.15): the board as the team sees it — every filter, the period, the summary
   * and every error row with endpoint, request, response, date/time and response time.
   *   GET /api/fixed/errors/export?format=xlsx|pdf&<every board filter>      (cap: export, audited)
   * Rows come through live() page by page (identical filter semantics, acks merged), then one query adds the
   * request / response bodies and one joins api_calls for the failing step's duration (response time) and
   * HTTP status. xlsx: up to 5 000 rows; pdf: up to 400 rows (bodies trimmed) — the sheet is the full record. */
  const ksaStr = iso => { try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', ''); } catch (_) { return String(iso || ''); } };
  const provOf = body => { const m = /"provider"\s*:\s*"([^"]+)"/.exec(String(body || '')); return m ? m[1].toUpperCase() : ''; };
  const oneLine = (v, max) => { const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
  const WIN_LABEL = { '1h': 'Last 1h', '3h': 'Last 3h', '6h': 'Last 6h', '24h': 'Last 24h', '32h': 'Last 32h', '48h': 'Last 48h', '72h': 'Last 72h', today: 'Today (KSA)', '7d': 'Last 7d', '30d': '1 month', '90d': '3 months', '365d': '1 year' };
  const CHAN_LABEL = { '': 'All channels (SDA · QR · Web · Salam Home app)', epurchase: 'QR + Web e-purchase', app: 'Salam Home app' };
  const chanLabel = c => CHAN_LABEL[c || ''] || (CHAN[c] ? CHAN[c].label : c);

  async function exportData(q, req, cap) {
    const sum = await summary(q);
    const rows = [];
    let cursor = null;
    while (rows.length < cap) {
      const page = await live({ ...q, limit: 200, cursor: cursor || undefined }, req);
      rows.push(...page.rows);
      if (!page.nextCursor || !page.rows.length) break;
      cursor = page.nextCursor;
    }
    const out = rows.slice(0, cap);
    // bodies and api_calls come from the row's own read model (rows carry src)
    const bodies = [], calls = [];
    for (const src of [...new Set(out.map(r => r.src))]) {
      const mine = out.filter(r => r.src === src), pool = poolOf(src);
      const ids = mine.map(r => r.id), attempts = [...new Set(mine.map(r => r.attempt_id).filter(Boolean))];
      if (ids.length) bodies.push(...(await pool.query(`SELECT id, req_body, res_body FROM error_events WHERE id = ANY($1::text[])`, [ids])).rows);
      if (attempts.length) calls.push(...(await pool.query(
        `SELECT DISTINCT ON (attempt_id, endpoint) attempt_id, endpoint, method, status, duration_ms
           FROM api_calls WHERE attempt_id = ANY($1::text[]) ORDER BY attempt_id, endpoint, created_at DESC`, [attempts])).rows);
    }
    const bodyById = Object.fromEntries(bodies.map(b => [b.id, b]));
    const callKey = {}; for (const c of calls) callKey[c.attempt_id + '|' + c.endpoint] = c;
    const callFor = r => { if (!r.attempt_id) return null; if (r.step && callKey[r.attempt_id + '|' + r.step]) return callKey[r.attempt_id + '|' + r.step];
      const tail = r.step ? calls.find(c => c.attempt_id === r.attempt_id && (c.endpoint.endsWith(r.step) || r.step.endsWith(c.endpoint))) : null; return tail || null; };
    const flat = out.map(r => { const b = bodyById[r.id] || {}; const c = callFor(r);
      return { when: r.occurred_at, priority: r.priority, team: r.team, category: r.label || r.category, code: r.code || '', message: r.message || '',
        endpoint: r.step || (c && c.endpoint) || '', method: (c && c.method) || '', http: c && c.status != null ? c.status : '', ms: c && c.duration_ms != null ? c.duration_ms : '',
        chan: r.chan || '', channel: r.chanLabel || r.chan || r.channel || '', type: r.typeLabel || r.type || '', journey: r.journey || '', workflow: r.workflow || '',
        dealer: r.chan === 'qr' && r.referral_code ? 'QR ' + r.referral_code : (r.dealer_code || (r.chan === 'web' ? 'consumer-direct' : r.chan === 'salamhome' ? 'app' : '')), region: r.region || '',
        order: r.order_number || '', attempt: r.attempt_id || '', status: r.resolved ? 'resolved' : (r.acked ? 'acked' : 'open'), acked_by: r.acked_by || '',
        provider: provOf(b.req_body) || '', request: b.req_body || '', response: b.res_body || '' }; });
    const filters = [
      ['Period', `${WIN_LABEL[sum.window] || sum.window} — ${ksaStr(sum.from)} → ${ksaStr(sum.to)} KSA`],
      ['Channel', chanLabel(q.channel)], ['Type', q.type && TYPE[q.type] ? TYPE[q.type].label : 'All types'],
      ['Open only', (q.openOnly === '1' || q.openOnly === 'true') ? 'yes' : 'no (open + resolved)'],
      ['Team', q.team || 'All teams'], ['Priority', q.priority !== undefined && q.priority !== '' ? 'P' + q.priority : 'All'],
      ['Provider', q.provider === '-' ? 'no provider' : (q.provider || 'All')], ['Category', q.category ? (meta(q.category).label || q.category) : 'All'],
      ['Access tech', q.tech && q.tech !== 'all' ? q.tech.toUpperCase() : 'All'],
      ['Search', [q.find, q.odb && 'ODB ' + q.odb, q.iccid && 'ICCID ' + q.iccid, q.cpe && 'CPE ' + q.cpe, q.msisdn && 'MSISDN ' + q.msisdn, q.serviceNo && 'service ' + q.serviceNo,
        q.custCode && 'custCode ' + q.custCode, q.customerId && 'customer ' + q.customerId, q.workflowId && 'workflow ' + q.workflowId].filter(Boolean).join(' · ') || '—'],
      ['Rows', `${flat.length}${rows.length > cap ? ` (capped at ${cap} — narrow the window for the rest)` : ''}`],
      ['Generated', `${ksaStr(new Date().toISOString())} KSA by ${req.sessionEmail || req.actor || 'console'}`],
    ];
    return { sum, flat, filters, capped: rows.length > cap };
  }

  function exportXlsx(d) {
    const xlsx = require('./xlsx');
    const HEAD = ['Time (KSA)', 'Priority', 'Team', 'Category', 'Code', 'Message', 'Endpoint', 'Method', 'HTTP', 'Response time (ms)', 'Provider', 'Channel', 'Type', 'Journey', 'Workflow', 'Dealer / QR', 'Region', 'Order #', 'Workflow id (attempt)', 'Status', 'Acked by', 'Request', 'Response'];
    const body = d.flat.map(r => [ksaStr(r.when), 'P' + r.priority, r.team, r.category, r.code, r.message, r.endpoint, r.method, r.http, r.ms, r.provider, r.channel, r.type, r.journey, r.workflow, r.dealer, r.region, r.order, r.attempt, r.status, r.acked_by, oneLine(r.request, 32000), oneLine(r.response, 32000)]);
    const S = d.sum, sumRows = [['Live error control board — export'], []];
    d.filters.forEach(([k, v]) => sumRows.push([k, v]));
    sumRows.push([], ['Totals', 'Open', 'Total'], ['All', S.open, S.total], []);
    sumRows.push(['By category', 'Open', 'Total', 'Last 3h', 'Priority', 'Team']); S.byCategory.forEach(c => sumRows.push([c.label, c.open, c.total, c.last3h, 'P' + c.priority, c.team]));
    sumRows.push([], ['By team', 'Open', 'Total']); Object.entries(S.byTeam).forEach(([t, v]) => sumRows.push([t, v.open, v.total]));
    sumRows.push([], ['By priority', 'Open', 'Total']); Object.entries(S.byPriority).forEach(([p, v]) => sumRows.push(['P' + p, v.open, v.total]));
    sumRows.push([], ['By provider', 'Open', 'Total']); (S.byProvider || []).forEach(p => sumRows.push([p.label, p.open, p.total]));
    sumRows.push([], ['By channel', 'Open', 'Total']); (S.byChannel || []).forEach(c => sumRows.push([c.label, c.open, c.total]));
    sumRows.push([], ['By type', 'Open', 'Total']); (S.byType || []).filter(t => t.total > 0).forEach(t => sumRows.push([t.label, t.open, t.total]));
    return xlsx.build([
      { name: 'Errors', rows: [HEAD, ...body], numericCols: [8, 9], widths: [19, 8, 10, 26, 14, 40, 44, 8, 7, 12, 10, 16, 11, 11, 20, 14, 10, 14, 22, 9, 22, 60, 60] },
      { name: 'Summary', rows: sumRows, numericCols: [1, 2, 3], widths: [34, 30, 12, 10, 10, 12] },
    ]);
  }

  function exportPdf(d) {
    const pdfout = require('./pdfout');
    const doc = pdfout.doc({ footer: `Salam Operations Console - Fixed error control board - generated ${ksaStr(new Date().toISOString())} KSA` });
    const CC = doc.colors, S = d.sum;
    const top = doc.band(64, CC.dark);
    doc.at(46, top + 24, 'FIXED - LIVE ERROR CONTROL BOARD', { size: 9, bold: true, color: [0.5, 0.83, 0.65] });
    doc.at(46, top + 44, `${S.open} open - ${S.total} total - ${WIN_LABEL[S.window] || S.window}`, { size: 15, bold: true, color: CC.white });
    doc.space(10);
    doc.h2('Filters'); doc.kv(d.filters, { boldVal: true });
    doc.h2('Summary - by category');
    doc.table([{ label: 'Category', w: 30 }, { label: 'Team', w: 12 }, { label: 'Prio', w: 8 }, { label: 'Open', w: 10, align: 'right' }, { label: 'Total', w: 10, align: 'right' }, { label: 'Last 3h', w: 10, align: 'right' }],
      S.byCategory.map(c => [c.label, c.team, 'P' + c.priority, String(c.open), String(c.total), String(c.last3h)]),
      { rowColor: ri => S.byCategory[ri].priority <= 1 ? CC.red : (S.byCategory[ri].priority === 2 ? CC.amber : null) });
    doc.h2('Summary - by team / priority / provider');
    doc.table([{ label: 'Team', w: 20 }, { label: 'Open', w: 10, align: 'right' }, { label: 'Total', w: 10, align: 'right' }], Object.entries(S.byTeam).map(([t, v]) => [t, String(v.open), String(v.total)]));
    doc.table([{ label: 'Priority', w: 20 }, { label: 'Open', w: 10, align: 'right' }, { label: 'Total', w: 10, align: 'right' }], Object.entries(S.byPriority).map(([p, v]) => ['P' + p, String(v.open), String(v.total)]));
    if ((S.byProvider || []).length) doc.table([{ label: 'Provider', w: 20 }, { label: 'Open', w: 10, align: 'right' }, { label: 'Total', w: 10, align: 'right' }], S.byProvider.map(p => [p.label, String(p.open), String(p.total)]));
    doc.h2('Summary - by channel / type');
    doc.table([{ label: 'Channel', w: 24 }, { label: 'Open', w: 10, align: 'right' }, { label: 'Total', w: 10, align: 'right' }], (S.byChannel || []).map(c => [c.label, String(c.open), String(c.total)]));
    doc.table([{ label: 'Type', w: 24 }, { label: 'Open', w: 10, align: 'right' }, { label: 'Total', w: 10, align: 'right' }], (S.byType || []).filter(t => t.total > 0).map(t => [t.label, String(t.open), String(t.total)]));
    doc.h2(`Errors - ${d.flat.length} row(s)${d.capped ? ' (PDF capped - the xlsx export holds the full list)' : ''}`);
    doc.table([{ label: 'Time (KSA)', w: 12 }, { label: 'P', w: 4 }, { label: 'Category / code', w: 15 }, { label: 'Channel', w: 8 }, { label: 'Type', w: 8 }, { label: 'Endpoint', w: 17 }, { label: 'ms', w: 5, align: 'right' }, { label: 'Dealer', w: 7 }, { label: 'Status', w: 6 }, { label: 'Request', w: 19 }, { label: 'Response', w: 19 }],
      d.flat.map(r => [ksaStr(r.when), 'P' + r.priority, `${r.category}${r.code ? ' - ' + r.code : ''}`, (CHAN[r.chan] || {}).short || r.channel, r.type + (r.journey ? ' - ' + r.journey : ''), r.endpoint || '—', r.ms === '' ? '—' : String(r.ms), r.dealer || '—', r.status, oneLine(r.request, 140) || '—', oneLine(r.response, 140) || '—']),
      { size: 6.8, rowColor: ri => d.flat[ri].priority <= 1 ? CC.red : (d.flat[ri].priority === 2 ? CC.amber : null) });
    doc.p('Identifiers are masked as on the board; full bodies and end-to-end traces stay in the console (Fixed > Errors > open a row > Open full trace).', { color: CC.muted, size: 8 });
    return doc.buffer();
  }

  app.get('/api/fixed/errors/export', gate, async (req, res) => {
    if (!(req.caps && req.caps.export)) return res.status(403).json({ error: `role ${req.roleName} lacks export` });
    const q = req.query || {}; const format = q.format === 'pdf' ? 'pdf' : 'xlsx';
    try {
      const d = await exportData(q, req, format === 'pdf' ? 400 : 5000);
      if (audit) audit(req, 'fixed.errors.export', format, { rows: d.flat.length, range: q.range || null, channel: q.channel || null, type: q.type || null, provider: q.provider || null, category: q.category || null });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      res.setHeader('Content-Disposition', `attachment; filename="fixed-errors_${q.range || 'today'}_${stamp}.${format}"`);
      if (format === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.send(exportPdf(d)); }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.send(exportXlsx(d));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get('/api/fixed/errors/summary', gate, wrap(q => summary(q)));
  app.get('/api/fixed/errors/live',    gate, wrap((q, req) => live(q, req)));
  app.get('/api/fixed/errors/detail',  gate, wrap((q, req) => detail(q, req)));
  app.post('/api/fixed/errors/resolve', gate, wrap((q, req) => resolve(q, req)));
  app.get('/api/fixed/errors/taxonomy', gate, (req, res) => res.json({ taxonomy: TAXONOMY, teams: TEAMS, spike: SPIKE, channels: CHANNELS, types: TYPES }));
}

module.exports = { mount, TAXONOMY, TEAMS, SPIKE, CHANNELS, TYPES, CHANNEL_EXPR, TYPE_EXPR, effectiveSeverity, parseWindow };
